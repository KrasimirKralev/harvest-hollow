// Release 1.0, QA round 1 (features lane; docs/qa/release/qa-r1/fix-features.md): F-01 Plant for later fills the field
// within half the coins or does not show, and a big stroke asks first; F-02 its clock is the planted crop's (season,
// mastery, rain) and its price the one `plant` charges; F-03 no "Harvest N first" variant that never reached NOW; F-04
// the h3 card names what counts; F-05 the surprise box stands beside the porch steps; F-06 / F-07 / F-09 the coach and
// letter lines; F-08 the gift sheet closes after a send and says what waits; the patch requests L-01 (the sheet's Open
// it plays in view; the note on the surprise feed rows) and I-02 (no bidi controls in typed texts).
// RED on 7f67efe (the tested head): see docs/qa/release/qa-r1/fix-features.md, each item's status.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';
import { CONTENT, TUTORIAL, questOf, cropOf, defOf } from '../shared/content/index.js';
import { QUEST_STORY as STORY } from '../shared/content/story.js';
import { goals } from '../shared/rules/goals.js';
import { enText, taskMsg, taskLabelMsg } from '../shared/rules/goal-text.js';
import { MAX_BATCH } from '../shared/rules/economy.js';
import * as Farming from '../shared/rules/actions/farming.js';
import { giftSpot } from '../shared/rules/actions/coop.js';
import { readyClock, localHour } from '../shared/rules/calendar.js';
import { rainingAt } from '../shared/rules/time.js';
import { parseArgs, V } from '../shared/rules/schema.js';
import { resetGrid } from '../shared/rules/grid.js';
import { ERR } from '../shared/net/protocol.js';
import { farmAt, put, give, act, actOk, mulberry32, T0, MIN, HOUR } from './helpers/rules-goals.js';
import BG_FEAT from '../public/js/i18n/bg/feat.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

let T = null;          // public/js/ui/tracker.js (after the fake DOM)
let G = null;          // public/js/ui/panels/gift.js
before(async () => {
  T = await import('../public/js/ui/tracker.js');
  G = await import('../public/js/ui/panels/gift.js');
});

const TZ = 'Europe/Sofia';
/** A Sofia wall-clock time in October 2026 (EEST, UTC+3, until 04:00 on 25 Oct; EET, UTC+2, after). */
const at = (day, h, m = 0) => {
  const guess = Date.UTC(2026, 9, day, h - 3, m);
  return localHour(guess, TZ) === h ? guess : Date.UTC(2026, 9, day, h - 2, m);
};
const plotIds = (s) => Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'plot').sort();
const emptyIds = (s) => plotIds(s).filter((id) => !s.farm.objects[id].crop);

/** A quiet farm at `level` holding `coins`, `n` empty plots (the owners' field has 82), no chores. */
function field(level, coins, n = 82) {
  const s = farmAt(level);
  s.farm.wallet.coins = coins;
  for (const id of Object.keys(s.farm.objects)) if (CONTENT.debris.has(s.farm.objects[id].def)) delete s.farm.objects[id];
  while (plotIds(s).length < n) put(s, 'plot');
  for (const id of plotIds(s)) s.farm.objects[id].crop = null;
  for (const p of Object.values(s.players)) p.almanac.tasks = {};
  s.farm.quests.active = {};
  resetGrid(s);
  return s;
}
const laterOf = (s, now) => goals(s, 'p1', now, { all: true }).all.find((c) => c.kind === 'later') ?? null;

test('F-01: on L9-L15 farms with real-sim\'s treasury, Plant for later fills >= 90 % of the empty plots within half the coins, or does not show', () => {
  // the coins real-sim's reference couple holds at the end of an evening (seed 7), the owners' 308k, a mid farm
  const cases = [[9, 1_139], [11, 3_082], [14, 226], [14, 800], [15, 10_182], [15, 60_000], [21, 308_377]];
  let shown = 0;
  for (const [L, coins] of cases) {
    for (const h of [14, 21]) {
      const s = field(L, coins);
      const now = at(14, h);
      const idle = emptyIds(s).length;
      const c = laterOf(s, now);
      const tag = `L${L} ${coins} coins ${h}:00`;
      if (!c) {
        // the plain card names every empty plot (never "plant 1 plot with Potatoes")
        const g = goals(s, 'p1', now).now;
        assert.equal(g.kind, 'plant', `${tag}: no later card, so the plain plant card`);
        assert.equal(g.need, idle, tag);
        continue;
      }
      shown++;
      const n = c.target.args.ids.length;
      assert.ok(n >= Math.min(idle, MAX_BATCH) * 0.9, `${tag}: "${c.text}" plants ${n} of ${idle} empty plots`);
      assert.ok(c.cost <= coins / 2, `${tag}: "${c.text}" costs ${c.cost} of ${coins}`);
      actOk(s, 'plant', { ...c.target.args, confirm: ['BIG_SPEND'] }, { pid: 'p1', now });
      assert.equal(emptyIds(s).length, idle - n, tag);
      assert.ok(s.farm.wallet.coins >= coins / 2, `${tag}: ${s.farm.wallet.coins} left of ${coins}`);
    }
  }
  assert.ok(shown >= 4, `the card still shows where the farm can fill its field (${shown})`);
  // the starter field (16 plots, 300 coins) at L9: "Plant 16 plots", as before 1.0
  const s = field(9, 300, 16);
  const g = goals(s, 'p1', at(14, 21)).now;
  assert.equal(g.kind, 'plant');
  assert.equal(g.need, 16);
});

test('F-01: a Plant for later stroke over the BIG_SPEND line asks first; a small one goes straight', () => {
  const now = at(14, 21);
  const big = field(21, 60_000);                 // 82 Pumpkins = 29,192 coins: above 25 % and above 1,000
  const g = goals(big, 'p1', now).now;
  assert.equal(g.kind, 'later');
  const card = T.cardsFromGoals({ now: g }, big, 'p1', now)[0];
  const cardAction = T.cardAction ?? ((cd) => ({ type: cd.target.act, args: cd.target.args }));   // 7f67efe: always sent
  assert.deepEqual(cardAction(card, big, 'p1', now), { ask: ERR.BIG_SPEND, type: 'plant', args: g.target.args });
  assert.equal(g.big, true);
  // the shell's "are you sure?" resends it confirmed: the rules take it
  actOk(big, 'plant', { ...g.target.args, confirm: [ERR.BIG_SPEND] }, { pid: 'p1', now });
  const rich = field(21, 308_377);
  const g2 = goals(rich, 'p1', now).now;
  assert.equal(g2.kind, 'later');
  assert.deepEqual(cardAction(T.cardsFromGoals({ now: g2 }, rich, 'p1', now)[0], rich, 'p1', now), { type: 'plant', args: g2.target.args });
});

test('F-02: the card promises the clock the planted crops keep (in season, mastery stars, rain) and the price plant charges', () => {
  const s = field(21, 308_377);
  s.farm.mastery = { ...(s.farm.mastery ?? {}), pumpkin: 100_000 };          // three stars: -10 % grow time
  s.players.p1.perks = { t: { grower: 2 }, r: 0 };                           // Grower: seeds -10 %
  // 15 Oct 19:00 in Sofia: Before bed, and it rains on this farm (watered at planting: -15 %); pumpkins are autumn's
  const now = at(15, 19);
  assert.ok(rainingAt(s.meta.farmSeed, now, s.meta.createdAt), 'the fixture hour rains');
  const c = laterOf(s, now);
  assert.equal(c.ref, 'pumpkin');
  actOk(s, 'plant', { ...c.target.args, confirm: ['BIG_SPEND'] }, { pid: 'p1', now });
  const crops = c.target.args.ids.map((id) => s.farm.objects[id].crop);
  const last = Math.max(...crops.map((x) => x.readyAt));
  assert.equal(c.readyAt, last, `promised ${new Date(c.readyAt).toISOString()}, ripe ${new Date(last).toISOString()}`);
  assert.ok(last < now + 9 * HOUR, 'season, stars and rain are all in it (12 h base)');
  assert.equal(enText(c.sub), `Ready tomorrow at ${readyClock(now, last - now, TZ).t} · ${c.cost.toLocaleString('en-US')} coins`);
  // the price: what the picker shows (plantPreview, ui-shell's patch) is what the plot was charged
  assert.equal(typeof Farming.plantPreview, 'function', 'actions/farming.js plantPreview(state, crop, at, pid, now)');
  const s2 = field(21, 308_377);
  s2.players.p1.perks = { t: { grower: 2 }, r: 0 };
  const id = emptyIds(s2)[0];
  const p = Farming.plantPreview(s2, 'pumpkin', id, 'p1', now);
  assert.notEqual(p.price, cropOf('pumpkin').seed, 'the fixture has a discount');
  actOk(s2, 'plant', { id, crop: 'pumpkin' }, { pid: 'p1', now });
  assert.equal(s2.farm.objects[id].crop.paid, p.price);
  assert.equal(s2.farm.objects[id].crop.readyAt, p.readyAt);
  // no plot named: the farm-wide clock (the picker's strip)
  assert.equal(Farming.plantPreview(s2, 'pumpkin', null, 'p1', now).readyAt, p.readyAt);
});

test('F-03: with ripe plots the later card never says "Harvest N first" (collect has NOW); it plants only empty plots', () => {
  const rnd = mulberry32(5);
  for (let i = 0; i < 200; i++) {
    const s = field(21, 308_377, 40);
    const ids = plotIds(s);
    const ripe = 1 + Math.floor(rnd() * 30);
    for (const id of ids.slice(0, ripe)) s.farm.objects[id].crop = { def: 'carrot', plantedAt: T0, readyAt: T0 + MIN, by: 'p1', cycle: 0 };
    const now = at(14, [9, 14, 21][i % 3]);
    const g = goals(s, 'p1', now, { all: true });
    assert.equal(g.now.kind, 'collect', `#${i}`);
    for (const c of g.all.filter((x) => x.kind === 'later')) {
      assert.equal(c.target.act, 'plant', `#${i}: ${c.text}`);
      assert.ok(c.target.args.ids.every((id) => !s.farm.objects[id].crop), `#${i}`);
    }
  }
});

test('F-04: "Helping Hands" names what counts (a surprise opened, a flagged order filled), EN and BG', () => {
  const t = questOf('h3').tasks[0];
  for (const m of [taskMsg(t), taskLabelMsg(t)]) {
    const en = enText(m);
    assert.doesNotMatch(en, /leave a surprise|flag an order/i, en);
    assert.match(en, /open a surprise/i, en);
    assert.match(en, /fill a flagged order/i, en);
  }
  const bg = [BG_FEAT['feat.r.task.help'].other, BG_FEAT['feat.r.task.help'].one, BG_FEAT['feat.r.label.help']];
  for (const line of bg) {
    assert.doesNotMatch(line, /Остави изненада|: изненада или/, line);
    assert.match(line, /[Оо]твор/, line);
    assert.match(line, /изпълн/, line);
  }
});

/** Where the box stands in the farmhouse's own frame (x along its front, z out of it; tiles from its centre). */
function inHouseFrame(s, spot) {
  const house = Object.values(s.farm.objects).find((o) => o.def === 'farmhouse');
  const rot = house.rot ?? 0;
  const [w, d] = rot % 2 ? [...defOf('farmhouse').size].reverse() : defOf('farmhouse').size;
  let x = spot.x + 0.5 - (house.x + w / 2);
  let z = spot.z + 0.5 - (house.z + d / 2);
  for (let r = 0; r < rot; r++) [x, z] = [-z, x];          // undo the renderer's quarter turns
  return { x, z };
}

test('F-05: the surprise box stands beside the farmhouse\'s porch steps, however the house is turned (and at tier 2)', () => {
  // the model (tools/build-assets.mjs farmhouseW4): the front faces +z; the wing's door and steps at x = -2.5 m (-1.25
  // tiles from the centre), the front face at +2 tiles; from tier 2 the main porch's steps at x = +0.95 m
  for (const [rot, up, doorX] of [[0, 0, -1.25], [1, 0, -1.25], [2, 0, -1.25], [3, 0, -1.25], [0, 2, 0.475], [1, 2, 0.475]]) {
    const s = farmAt(10);
    const house = Object.values(s.farm.objects).find((o) => o.def === 'farmhouse');
    house.rot = rot;
    if (up) house.up = up;
    resetGrid(s);
    const spot = giftSpot(s);
    const local = inHouseFrame(s, spot);
    assert.ok(local.z >= 2.5 && local.z <= 3.5, `rot ${rot} up ${up}: in front of the house (${JSON.stringify(local)})`);
    assert.ok(Math.abs(local.x - doorX) <= 1.5, `rot ${rot} up ${up}: beside the steps (${JSON.stringify(local)})`);
  }
  // (the owners' layout, the farmhouse at (22, 39) turned once, is checked on a copy of their save: its steps face the
  // mailbox at (26, 42) and the box stands at (26, 41); evidence in fix-features.md)
});

test('F-06, F-07, F-09 (and P-07\'s English): the coach and letter lines say what to do and what is true', () => {
  const step = (id) => [...TUTORIAL.fields, ...TUTORIAL.barnyard, ...TUTORIAL.together].find((x) => x.id === id);
  const tree = step('apple_tree');
  assert.match(tree.text, /Apple Tree/);
  assert.match(tree.text, /free/);
  assert.match(tree.text, /Build/);
  const harvest = step('harvest_wheat');
  assert.doesNotMatch(harvest.text, /Sickle/, 'the Hand in hand harvests; the Sickle waits in Tools');
  assert.equal(harvest.tool, 'hand');
  assert.doesNotMatch(STORY.h3.done, /helping hands/i, 'the done line does not repeat the title');
  assert.doesNotMatch(STORY.a4.letter.body.join(' '), /half again/, 'orders pay more in coins and XP (P-07)');
});

/** A panel ctx over a plain state (what the shell hands a panel), recording what the panel asks for. */
function ctxOf(state, { pid = 'p2', now = T0 + HOUR } = {}) {
  const acts = [];
  const closed = [];
  const toasts = [];
  const focused = [];
  const body = document.createElement('div');
  document.body.append(body);
  const store = { state, pid, now: () => now, on: () => () => {}, act: (t, a) => { acts.push([t, a]); return { ok: true }; } };
  const ctx = {
    name: 'gift', args: {}, store, body, el: body, now: () => now, tab: null,
    every: () => () => {}, on: () => () => {}, subscribe: () => () => {},
    act: (t, a) => { acts.push([t, a]); return { ok: true }; },
    close: () => closed.push(true), setTitle() {}, refreshTabs() {},
    view: { focus: (x, z) => focused.push([x, z]) },
    ui: { panels: { open: () => true, has: () => true }, toast: (text, o) => toasts.push([text, o]) },
  };
  return { ctx, body, acts, closed, toasts, focused };
}
const click = (el) => el.click();

test('F-08: after Wrap it the sheet closes with a line; reopened, it says what was wrapped and that a note went', () => {
  const s = farmAt(12);
  give(s, 'rose', 3);
  const r = ctxOf(s);
  G.giftPanel.mount(r.body, r.ctx);
  click(r.body.querySelector('.rel-gift-grid .pn-stack[data-item="rose"]'));
  click(r.body.querySelector('.rel-gift-notes .chip'));
  click(r.body.querySelector('[data-gift="send"]'));
  assert.deepEqual(r.acts[0][0], 'keepsake');
  assert.equal(r.closed.length, 1, 'the sheet closes after a send');
  assert.equal(r.toasts.length, 1);
  assert.match(r.toasts[0][0], /^Wrapped for /);
  // the rules wrap it; the sheet opened again shows the item and the note's presence
  actOk(s, 'keepsake', r.acts[0][1], { pid: 'p2', now: T0 + HOUR });
  const r2 = ctxOf(s);
  G.giftPanel.mount(r2.body, r2.ctx);
  const card = r2.body.querySelector('.rel-gift-card.mine');
  assert.ok(card);
  assert.match(textOf(card), /Roses? · with your note/);
});

test('L-01 (patch request): the sheet\'s Open it pans to the box, closes the sheet, then opens it', async () => {
  const s = farmAt(12);
  give(s, 'rose', 3);
  actOk(s, 'keepsake', { item: 'rose', note: 'for you' }, { pid: 'p1', now: T0 });
  const id = Object.keys(s.farm.gifts)[0];
  const r = ctxOf(s, { pid: 'p2', now: T0 + MIN });
  G.giftPanel.mount(r.body, r.ctx);
  click(r.body.querySelector('[data-gift="unwrap"]'));
  assert.equal(r.focused.length, 1, 'the camera goes to the box first');
  assert.equal(r.closed.length, 1);
  await new Promise((res) => setTimeout(res, 700));
  assert.deepEqual(r.acts.at(-1), ['openGift', { id }]);
});

test('L-01 (patch request): an opened or shelved surprise\'s feed row carries its note', () => {
  const s = farmAt(12);
  give(s, 'rose', 3);
  actOk(s, 'keepsake', { item: 'rose', note: 'for the morning coffee' }, { pid: 'p1', now: T0 });
  const id = Object.keys(s.farm.gifts)[0];
  actOk(s, 'openGift', { id }, { pid: 'p2', now: T0 + MIN });
  const row = Object.values(s.farm.feed.rows).find((x) => x.k === 'surprise' && x.what === 'opened');
  assert.equal(row.note, 'for the morning coffee');
  const left = Object.values(s.farm.feed.rows).find((x) => x.k === 'surprise' && x.what === 'left');
  assert.equal(left.note, undefined, 'the line for a waiting box never tells the surprise');
});

test('I-02 (patch request): typed texts lose the invisible bidi controls; plain right-to-left letters stay', () => {
  const RLO = '‮';
  assert.deepEqual(parseArgs({ note: V.text(80) }, { note: `${RLO}for you` }), { note: 'for you' });
  assert.deepEqual(parseArgs({ note: V.text(80) }, { note: `a⁦b⁩c‏؜` }), { note: 'abc' });
  assert.deepEqual(parseArgs({ note: V.text(80) }, { note: 'سلام' }), { note: 'سلام' }, 'Arabic letters are text');
  assert.equal(parseArgs({ note: V.text(80) }, { note: RLO.repeat(40) }), null, 'nothing left: refused like a blank note');
  const s = farmAt(3);
  actOk(s, 'nameFarm', { name: `${RLO}Honeybee Acres` }, { pid: 'p1', now: T0 });
  assert.equal(s.farm.name, 'Honeybee Acres');
  give(s, 'wheat', 5);
  assert.equal(act(s, 'keepsake', { item: 'wheat', note: RLO.repeat(40) }, { pid: 'p1', now: T0 }).code, ERR.BAD_ARGS);
});
