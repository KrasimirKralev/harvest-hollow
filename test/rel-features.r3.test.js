// Release 1.0, QA round 3 (features lane; docs/qa/release/qa-r3/fix-features.md): F3-01 the Ribbon Track that opens at
// a pre-1.0 farm's first 1.0 boot is introduced right after "New in 1.0"; F3-02 the Bulgarian build and slot cards split
// at the sentence, not at "В касата:"; F3-03 the giver's sheet offers the next wrap from the next farm day and says why
// it waits on the day of a wrap; F3-04 a gift box never stands where a building hides it, and a fenced yard is used
// first; F3-05 a half of a same-day Together task is told to both farmers; F3-06 a Together letter opens the Journal's
// Together tab; F3-07 a wild tuft pulled during "clear the weeds" counts; F3-08 the partner cards wait for a partner;
// F3-09 the workshop tip says the queue rule; F3-10 the flour step stops saying "place the Windmill" once it stands;
// F3-11 a shelved surprise is named once in the recap; F3-12 the brush card's documented order; and the patches other
// lanes sent: S3-19 the tracker says when it opens, S3-21 the duel winner's own line, S3-23 arrow keys in the gift
// grid, S3-C1 the reveal's "♥ Thanks" takes the focus after "Open it", I3-C1 no mark stacks through a joiner.
// RED on a328923 (the tested head): the RED lines are in docs/qa/release/qa-r3/fix-features.md, item by item.
import { test, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installDom } from './ui-qa2-dom.js';
import { CONTENT, COOP, TUTORIAL, DUEL, live, defOf } from '../shared/content/index.js';
import * as GOALS from '../shared/rules/goals.js';
import { goals } from '../shared/rules/goals.js';
import { enText, msg, name } from '../shared/rules/goal-text.js';
import * as Social from '../shared/rules/actions/social.js';
import * as TutR from '../shared/rules/actions/tutorial.js';
import { porchSteps, giftSpot } from '../shared/rules/actions/coop.js';
import { recap, feedRows } from '../shared/rules/feed.js';
import { dayOf } from '../shared/rules/coop.js';
import { check } from '../shared/rules/schema.js';
import { localHour } from '../shared/rules/calendar.js';
import { resetGrid, inLand, objTiles } from '../shared/rules/grid.js';
import { WORLD_TILES } from '../shared/content/config.js';
import { farmAt, put, give, act, actOk, evs, valid, runDue, T0, MIN, HOUR } from './helpers/rules-goals.js';
import { ROOT } from './helpers.js';

installDom();
globalThis.requestAnimationFrame ??= () => 0;
globalThis.innerHeight ??= 768;
globalThis.innerWidth ??= 1366;
{
  // the fake DOM reads "a > b" as "a b" (the tracker's '.mini > i'), and remembers what took the focus
  const proto = Object.getPrototypeOf(document.createElement('div'));
  const qsa = proto.querySelectorAll;
  proto.querySelectorAll = function querySelectorAll(sel) { return qsa.call(this, String(sel).replace(/\s*>\s*/g, ' ')); };
  proto.focus = function focus() { document.activeElement = this; };
}

let T = null;          // public/js/ui/tracker.js (after the fake DOM)
let G = null;          // public/js/ui/panels/gift.js
let I18N = null;       // public/js/i18n/index.js
before(async () => {
  T = await import('../public/js/ui/tracker.js');
  G = await import('../public/js/ui/panels/gift.js');
  I18N = await import('../public/js/i18n/index.js');
});

const TZ = 'Europe/Sofia';
/** A Sofia wall-clock time in October 2026 (EEST, UTC+3, until 04:00 on 25 Oct). */
const at = (day, h, m = 0) => {
  const guess = Date.UTC(2026, 9, day, h - 3, m);
  return localHour(guess, TZ) === h ? guess : Date.UTC(2026, 9, day, h - 2, m);
};

/** A panel ctx over a plain state (what the shell hands a panel), recording what the panel asks for. */
function ctxOf(state, { pid = 'p1', now = T0 + HOUR } = {}) {
  const acts = [];
  const body = document.createElement('div');
  document.body.append(body);
  const store = { state, pid, now: () => now, on: () => () => {}, act: (t, a) => { acts.push([t, a]); return { ok: true }; } };
  const ctx = {
    name: 'gift', args: {}, store, body, el: body, now: () => now, tab: null,
    every: () => () => {}, on: () => () => {}, subscribe: () => () => {},
    act: (t, a) => { acts.push([t, a]); return { ok: true }; },
    close() { ctx.closed = true; }, setTitle() {}, refreshTabs() {},
    view: { focus() {} },
    ui: { panels: { open: () => true, has: () => true }, toast() {} },
  };
  return { ctx, body, acts };
}

/** A tracker over a fake DOM: the rules' cards from `res`, the shell's calls recorded (rel-features.r2's tracker()). */
function tracker(state, res, { pid = 'p1', now = at(15, 14) } = {}) {
  document.body.replaceChildren();
  const box = document.createElement('div');
  box.id = 'tracker';
  document.body.append(box);
  const calls = { open: [], events: [] };
  const S = {
    store: { state, pid, now: () => now, subscribe() {} },
    view: { focus() {} },
    ui: { panels: { has: () => true, open(n, a) { calls.open.push([n, a]); return true; } }, toast() {}, confirm: () => Promise.resolve(true) },
    controller: { do: () => ({ ok: true }), tool: { id: 'hand' }, TOOLS: [{ id: 'hand' }], setTool() {} },
    tutorial: { flash() {} },
  };
  const realInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.window ??= globalThis;
  globalThis.window.addEventListener ??= () => {};
  globalThis.dispatchEvent = (e) => { calls.events.push(e.type); return true; };
  let tr;
  try { tr = T.createTracker(S); } finally { globalThis.setInterval = realInterval; }
  tr.useRulesGoals(() => res);
  tr.render();
  return { tr, S, calls, box };
}

// ---- F3-01 ----------------------------------------------------------------------------------------------------------

/** The first `n` drip cards `pid` meets, 20 minutes of play apart (the rules' drip, markSeen as the client sends it). */
function dripRun(s, pid, n) {
  const out = [];
  const p = s.players[pid];
  for (let k = 0; k < n; k++) {
    const id = Social.nextSystemCard(s, pid, { helper: true, now: T0 });
    if (!id) break;
    out.push(id);
    p.seen.cards[id] = 1;
    p.play.card = p.play.n;
    p.play.n += 20;
  }
  return out;
}

test('F3-01: a pre-1.0 L21 farm whose Ribbon Track opened at the 1.0 boot meets the track in its first two drip cards', () => {
  const s = farmAt(21);
  delete s.farm.coop.born;                                   // a save from before 1.0
  s.farm.track = { s: '2026-autumn', L: 21, need: 16_000, xp: 0, got: {}, coats: [] };
  for (const p of Object.values(s.players)) {
    // the owners' queue: the level-1 cards seen long ago, every later system card still waiting
    p.seen.cards = {};
    for (const f of CONTENT.features.values()) if (f.card && f.unlock <= 1 && !f.drip) p.seen.cards[f.id] = 1;
    p.play.n = 2000;
    p.play.card = 1000;
  }
  for (const pid of ['p1', 'p2']) {
    const first = dripRun(s, pid, 2);
    assert.equal(first[0], 'new_1_0', `${pid}: "New in 1.0" first`);
    assert.ok(first.includes('seasonal_track'), `${pid}'s first two cards: ${first.join(', ')}`);
  }
  // a farm whose track is not open (L15) keeps the usual order
  const low = farmAt(15);
  delete low.farm.coop.born;
  for (const p of Object.values(low.players)) {
    p.seen.cards = {};
    for (const f of CONTENT.features.values()) if (f.card && f.unlock <= 1 && !f.drip) p.seen.cards[f.id] = 1;
    p.play.n = 2000;
    p.play.card = 1000;
  }
  assert.ok(!dripRun(low, 'p1', 3).includes('seasonal_track'), 'no track card below its level');
});

const LATE = path.join(ROOT, '.scratch/box-save-1013-late');
const noLate = !fs.existsSync(path.join(LATE, 'farm.json')) && 'no late save';

/** Boot a COPY of tonight's owners' save on this build (the original is never touched); the catch-up run. */
async function bootLate() {
  const { Persist } = await import('../server/persist.js');
  const { loadFarm } = await import('../server/app.js');
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'rf3-late-'));
  for (const f of ['farm.json', 'farm.journal.jsonl', 'farm.journal.archive.jsonl']) {
    if (fs.existsSync(path.join(LATE, f))) fs.copyFileSync(path.join(LATE, f), path.join(tmp, f));
  }
  const quiet = { info() {}, warn() {}, error() {}, log() {} };
  const persist = new Persist(tmp, { log: quiet });
  const b = loadFarm(persist, { tz: TZ, log: quiet });
  b.engine.runDue();
  return { ...b, done: () => { persist.close(); fs.rmSync(tmp, { recursive: true, force: true }); } };
}

test('F3-01 on the owners\' late save: both farmers meet the Ribbon Track in their first two drip cards', { skip: noLate }, async () => {
  const b = await bootLate();
  try {
    assert.match(String(b.state.farm.track.s), /-autumn$/, 'the catch-up opened the track');
    for (const pid of ['p1', 'p2']) {
      const p = b.state.players[pid];
      p.play.card = p.play.n - 20;                           // the next drip turn is due
      const first = dripRun(b.state, pid, 2);
      assert.ok(first.includes('seasonal_track'), `${pid}'s first two cards: ${first.join(', ')}`);
    }
  } finally { b.done(); }
});

// ---- F3-02 ----------------------------------------------------------------------------------------------------------

test('F3-02: every build and slot card splits into "Build the X (c)" / "You have N" in English and Bulgarian', async () => {
  const s = farmAt(21);
  const bad = [];
  try {
    for (const lang of ['en', 'bg']) {
      await I18N.setLang(lang);
      for (const b of CONTENT.buildings.values()) {
        for (const kind of ['build', 'slot']) {
          for (const [c, have] of [[4000, 31_628], [12_000, 1_234_567], [120_000, 316_892]]) {
            const m = msg(`goals.r.${kind}`, { b: name(b.id, b.name), c, have });
            const [card] = T.cardsFromGoals({ now: { slot: 'now', kind: 'build', id: b.id, msg: m } }, s, 'p1', T0);
            const sub = lang === 'bg' ? /^В касата: / : /^You have /;
            if (/(В касата|You have)\b/.test(card.title) || !sub.test(card.sub)) bad.push(`${lang} ${kind} ${b.id}: "${card.title}" / "${card.sub}"`);
          }
        }
      }
    }
  } finally { await I18N.setLang('en'); }
  assert.deepEqual(bad, []);
});

// ---- F3-03 ----------------------------------------------------------------------------------------------------------

test('F3-03: the day after a wrap the giver can wrap again (the older box moves to the shelf, and the sheet says so)', async () => {
  const s = farmAt(14);
  give(s, 'egg', 5);
  const day1 = at(14, 10);
  actOk(s, 'keepsake', { item: 'egg', note: '#thinking' }, { pid: 'p1', now: day1 });
  const day2 = at(15, 11);                                    // the next farm day, the box still waiting (25 h)
  assert.equal(G.giftStatus(s, 'p1', day2).code, 'again', 'a box waits and today\'s wrap is free');
  const { ctx, body } = ctxOf(s, { now: day2 });
  G.giftPanel.mount(body, ctx);
  const form = body.querySelector('.rel-gift-form');
  assert.equal(form.hidden, false, 'the grid and Wrap are offered');
  const line = body.querySelector('[data-gift="again"]');
  assert.ok(line, 'a line says what happens to the waiting box');
  assert.match(line.textContent, /shelf/);
  assert.ok(body.querySelector('[data-gift-mine]'), 'the waiting box still shows');
  // the rules take the wrap: the older box goes to its shelf, nothing lost
  give(s, 'rose', 1);
  const r = actOk(s, 'keepsake', { item: 'rose' }, { pid: 'p1', now: day2 });
  assert.equal(evs(r, 'giftOpened').filter((e) => e.auto).length, 1, 'the Egg went to the shelf');
  valid(s);
});

test('F3-03: on the day of the wrap the sheet says when the next one can go (not a lone "waiting" card)', () => {
  const s = farmAt(14);
  give(s, 'egg', 5);
  const day1 = at(14, 10);
  actOk(s, 'keepsake', { item: 'egg' }, { pid: 'p1', now: day1 });
  assert.equal(G.giftStatus(s, 'p1', day1 + HOUR).code, 'waiting');
  const { ctx, body } = ctxOf(s, { now: day1 + HOUR });
  G.giftPanel.mount(body, ctx);
  assert.equal(body.querySelector('.rel-gift-form').hidden, true);
  assert.match(body.querySelector('.rel-gift-top').textContent, /Tomorrow/, 'the reason and the time');
  // a desktop sheet with only a card is as tall as its card (r1 F-08's tall empty column)
  const css = fs.readFileSync(new URL('../public/css/panels-rel.css', import.meta.url), 'utf8');
  assert.match(css, /#panel-gift\.size-side:has\(\.rel-gift-form\[hidden\]\)\s*\{[^}]*bottom: auto/);
});

// ---- F3-04 ----------------------------------------------------------------------------------------------------------

/** The kinds of model that hide what stands behind them (and are not walked through). */
const TALL = new Set(['building', 'landmark', 'home', 'tree']);
/** Tile -> the tall object's def standing there (footprints of two tiles or more). */
function tallTiles(s) {
  const m = new Map();
  for (const o of Object.values(s.farm.objects)) {
    const d = Number.isFinite(o.x) ? defOf(o.def) : null;
    if (!d || !TALL.has(d.kind) || Math.max(...d.size) < 2) continue;
    for (const [x, z] of objTiles(o)) m.set(`${x},${z}`, o.def);
  }
  return m;
}
/** What hides a box at (x, z) from the default camera (yaw 45 deg: it looks from +x +z), or null. */
function hiddenBy(s, x, z) {
  const tall = tallTiles(s);
  for (const [dx, dz] of [[1, 0], [0, 1], [1, 1]]) {
    const d = tall.get(`${x + dx},${z + dz}`);
    if (d) return `${d} at ${x + dx},${z + dz}`;
  }
  return null;
}
/** Two boxes the same farm day: p1's for p2, p2's for p1. Their tiles. */
function twoBoxes(s, now) {
  give(s, 'rose', 2);
  const a = evs(actOk(s, 'keepsake', { item: 'rose' }, { pid: 'p1', now }), 'keepsake')[0];
  const b = evs(actOk(s, 'keepsake', { item: 'rose' }, { pid: 'p2', now: now + MIN }), 'keepsake')[0];
  return [a, b].map((e) => ({ x: e.x, z: e.z }));
}

/**
 * The test farm: the farmhouse at (17, 25) faces +z (steps at 17, 29) on the land's north-west corner (x from 16, z
 * from 24). A yard round it: a fence one tile in front of the steps (z 30, x 16-22), and down its east side (x 23, z
 * 24-28; the field's fence already stands at 23, 29); the land's edge closes the rest.
 */
function fencedYard(s, beds) {
  assert.deepEqual(porchSteps(s), { x: 17, z: 29, rot: 0 }, 'the fixture: the farmhouse at (17, 25) faces +z');
  for (let x = 16; x <= 22; x++) put(s, 'picket_fence', { x, z: 30 });
  for (let z = 24; z <= 28; z++) put(s, 'picket_fence', { x: 23, z });
  for (const [x, z] of beds) put(s, 'flower_bed', { x, z });
  resetGrid(s);
}
const inYard = (b) => b.x >= 16 && b.x <= 22 && b.z >= 24 && b.z <= 29;

test('F3-04: a box never stands where a tall model hides it from the camera (a tree right in front of the steps)', () => {
  const s = farmAt(14);
  put(s, 'apple_tree', { x: 19, z: 30 });                     // covers (18, 29), the first tile by the steps
  resetGrid(s);
  for (const b of twoBoxes(s, at(14, 10))) {
    assert.equal(hiddenBy(s, b.x, b.z), null, `the box at ${b.x},${b.z} is hidden by ${hiddenBy(s, b.x, b.z)}`);
    assert.ok(Math.max(Math.abs(b.x - 17), Math.abs(b.z - 29)) <= 2, `the box at ${b.x},${b.z} is by the steps`);
  }
  valid(s);
});

test('F3-04: a farmhouse that turns its back to the camera keeps the box by its steps (r1 F-05: it hides its own porch)', () => {
  for (const rot of [2, 3]) {
    const s = farmAt(14);
    const house = Object.values(s.farm.objects).find((o) => o.def === 'farmhouse');
    house.rot = rot;
    resetGrid(s);
    const steps = porchSteps(s);
    const spot = giftSpot(s);
    assert.ok(Math.max(Math.abs(spot.x - steps.x), Math.abs(spot.z - steps.z)) <= 1, `rot ${rot}: ${JSON.stringify(spot)} by ${JSON.stringify(steps)}`);
  }
});

test('F3-04: a fenced yard with room is used before a tile across the fence (even a nearer one)', () => {
  const s = farmAt(14);
  // the yard tiles next to the steps are taken (flower beds); across the fence, two tiles out, the path is free
  fencedYard(s, [[16, 28], [16, 29], [18, 29], [19, 29]]);
  for (const b of twoBoxes(s, at(14, 10))) {
    assert.ok(inYard(b), `the box at ${b.x},${b.z} is inside the fence`);
    assert.equal(hiddenBy(s, b.x, b.z), null, `the box at ${b.x},${b.z} is hidden by ${hiddenBy(s, b.x, b.z)}`);
  }
  valid(s);
});

test('F3-04 on the owners\' late save: the second box of a day is not hidden by the Preserves Kitchen; both near the porch', { skip: noLate }, async () => {
  const b = await bootLate();
  try {
    const s = b.state;
    const steps = porchSteps(s);
    const boxes = twoBoxes(s, b.clock.now());
    assert.deepEqual(boxes[0], { x: 26, z: 41 }, 'the first: the yard\'s one free tile, beside the steps');
    for (const x of boxes) {
      assert.equal(hiddenBy(s, x.x, x.z), null, `the box at ${x.x},${x.z} is hidden by ${hiddenBy(s, x.x, x.z)}`);
      assert.ok(Math.max(Math.abs(x.x - steps.x), Math.abs(x.z - steps.z)) <= 3, `the box at ${x.x},${x.z} is by the porch ${steps.x},${steps.z}`);
    }
    valid(s);
  } finally { b.done(); }
});

test('F3-04: a box already waiting keeps its tile (determinism, replay); giftSpot is pure', () => {
  const s = farmAt(14);
  const spot = giftSpot(s);
  assert.deepEqual(giftSpot(s), spot, 'the same state, the same tile');
  give(s, 'rose', 1);
  const e = evs(actOk(s, 'keepsake', { item: 'rose' }, { pid: 'p1', now: at(14, 10) }), 'keepsake')[0];
  put(s, 'preserves', { x: e.x - 1, z: e.z + 1 });            // a building put up in front of it later
  resetGrid(s);
  assert.deepEqual({ x: s.farm.objects[e.id].x, z: s.farm.objects[e.id].z }, { x: e.x, z: e.z });
});

// ---- F3-05 ----------------------------------------------------------------------------------------------------------

const H = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'];
/** A farm at quest `qid` with the chain done up to it and `qid` the active card (rel-features.together's atQuest). */
function atQuest(qid) {
  const q = CONTENT.quests.get(qid);
  const s = farmAt(Math.max(q.level, qid === 'h6' ? 30 : 1));
  s.farm.wallet.coins = 50_000_000;
  s.farm.expansions = live('expansions').map((e) => e.id);
  resetGrid(s);
  for (const id of H.slice(0, H.indexOf(qid))) s.farm.quests.done[id] = T0;
  for (const id of Object.keys(s.farm.quests.active)) delete s.farm.quests.active[id];
  s.farm.quests.active[qid] = { at: T0, n: {} };
  return s;
}
/** Every card goals() offers `pid` (all slots, best first). */
const allCards = (s, pid, now) => goals(s, pid, now, { all: true }).all;

test('F3-05: one farmer sat today for "Golden Hour on the Hill": the other is told what is left, the sitter that their half is done', () => {
  const s = atQuest('h7');
  const bench = put(s, 'sunset_bench');
  const morning = at(14, 10);
  actOk(s, 'sit', { id: bench }, { pid: 'p2', now: morning, ext: { near: 5 } });
  actOk(s, 'stand', {}, { pid: 'p2', now: morning + 2 * MIN });
  assert.deepEqual(s.farm.coop.days.sat, { p2: 1 });
  const later = at(14, 15);
  const you = allCards(s, 'p1', later).find((c) => c.kind === 'half');
  assert.ok(you, 'p1 has a card for the half');
  const youText = enText(you.msg);
  assert.match(youText, /Golden Hour on the Hill/);
  assert.match(youText, new RegExp(s.players.p2.name), 'it names who did their half');
  assert.match(youText, /bench/i);
  // QA r4 F4-C1: NOW, not SOON (it is today's only chance; the phone chip and the folded row hid SOON)
  assert.equal(goals(s, 'p1', later).now.kind, 'half', 'NOW: it is today\'s only chance');
  const mine = allCards(s, 'p2', later).find((c) => c.kind === 'half');
  assert.ok(mine, 'the sitter is told too');
  assert.match(enText(mine.msg), new RegExp(s.players.p1.name));
  assert.ok(mine.mine, 'the sitter\'s own card');
  // the halves of today in one pure call (life-feel's toast for the sitter reads it: fix-features.md Cross-lane)
  assert.equal(typeof GOALS.halvesOf, 'function', 'goals.js halvesOf(state, pid, now)');
  assert.deepEqual(GOALS.halvesOf(s, 'p2', later).map((x) => [x.qid, x.half.what, x.half.mine, x.half.other]), [['h7', 'sat', true, 'p1']]);
  assert.deepEqual(GOALS.halvesOf(s, 'p1', later).map((x) => [x.qid, x.half.mine, x.half.other]), [['h7', false, 'p2']]);
  // the next farm day the half is gone
  assert.equal(allCards(s, 'p1', at(15, 10)).find((c) => c.kind === 'half'), undefined);
  assert.deepEqual(GOALS.halvesOf(s, 'p2', at(15, 10)), []);
  // the letter on the tracker says it too
  const story = T.storyCards(s, later, 'p1').find((c) => c.id === 'h7');
  assert.match(story.sub, new RegExp(s.players.p2.name));
});

test('F3-05: the same for "Gone Fishing" (cast a line, each on the same day)', () => {
  const s = atQuest('h6');
  const morning = at(14, 10);
  s.farm.coop.days = { d: dayOf(s, morning), sat: {}, cast: { p1: 1 }, done: {} };
  const you = allCards(s, 'p2', at(14, 15)).find((c) => c.kind === 'half');
  assert.ok(you, 'p2 has a card');
  assert.match(enText(you.msg), /Gone Fishing/);
  assert.match(enText(you.msg), /line|cast/i);
  assert.ok(allCards(s, 'p1', at(14, 15)).find((c) => c.kind === 'half' && c.mine));
  // done by both: no card
  s.farm.coop.days.cast.p2 = 1;
  s.farm.coop.days.done = { dock: 1 };
  assert.equal(allCards(s, 'p2', at(14, 15)).find((c) => c.kind === 'half'), undefined);
});

test('F3-05: the half card is the quest\'s one card on the tracker (its letter is not repeated under STORY)', () => {
  const s = atQuest('h7');
  const bench = put(s, 'sunset_bench');
  const morning = at(14, 10);
  actOk(s, 'sit', { id: bench }, { pid: 'p2', now: morning, ext: { near: 5 } });
  actOk(s, 'stand', {}, { pid: 'p2', now: morning + 2 * MIN });
  const later = at(14, 15);
  const res = goals(s, 'p1', later);
  assert.equal(res.now?.kind, 'half', 'the fixture: the half card is NOW (QA r4 F4-C1)');
  const t = tracker(s, res, { now: later });
  const slots = [...document.querySelectorAll('.goal')].filter((el) => el.dataset.goal === 'h7').map((el) => el.dataset.slot);
  assert.deepEqual(slots, ['now'], `h7 on the tracker as: ${slots.join(', ')}`);
  assert.ok(t.box, 'rendered');
});

test('the phone\'s list closes behind a card that acted, however long the action took (Before bed on 82 plots)', () => {
  // seen in this round's e2e frame e2e-iphone13-bg-later-planted.png: the list stayed open over the planted field. The
  // list closed only when the click reached it within 80 ms of the card's action starting; a big stroke's prediction
  // (or a slow phone) takes longer
  const s = farmAt(14);
  const res = { now: { slot: 'now', kind: 'crate', id: 'c1', msg: msg('goals.r.crate'), target: { act: 'openCrate', args: { id: 'c1' } } },
    soon: null, big: null };
  const t = tracker(s, res);
  t.S.controller.do = () => {
    const end = performance.now() + 120;
    while (performance.now() < end) { /* the stroke's prediction on a slow phone */ }
    return { ok: true };
  };
  document.querySelector('.tracker-chip').click();
  assert.ok(t.box.classList.contains('m-open'), 'the fixture: the list is open');
  const card = [...document.querySelectorAll('.goal')].find((el) => el.dataset.slot === 'now');
  const timeStamp = performance.now();
  // one click: the card's handler, then the same event bubbling up to the tracker (a browser keeps its timeStamp)
  card.dispatch('click', { timeStamp });
  t.box.dispatch('click', { timeStamp });
  assert.equal(t.box.classList.contains('m-open'), false, 'the list closed behind the card');
  // a later click inside the list that acted on nothing leaves it open
  document.querySelector('.tracker-chip').click();
  t.box.dispatch('click', { timeStamp: performance.now() });
  assert.equal(t.box.classList.contains('m-open'), true);
});

test('a deleted farm\'s forgotten keys stay forgotten: the tracker writes its first-look marks once per page', () => {
  // seen in this round's e2e-multi gate (--slow 3): "deleted: … forget the farm (list and keys)" failed on the partner's
  // screen with `keys: ["story.p1"]`: main.js forgetFarm cleared the farm's keys, and the tracker's next 5-second render
  // took the missing marks for a first look and wrote them back
  const mem = new Map();
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
    key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } } });
  try {
    const s = atQuest('h3');
    const t = tracker(s, { now: { slot: 'now', kind: 'calm', msg: msg('feat.r.calm') }, soon: null, big: null }, { now: at(14, 14) });
    const keys = () => [...mem.keys()].filter((k) => /story/.test(k));
    assert.equal(keys().length, 1, 'the fixture: the first look is remembered');
    for (const k of keys()) mem.delete(k);               // the farm was deleted: forgetFarm cleared its keys
    t.tr.render();
    t.tr.render();
    assert.deepEqual(keys(), [], 'nothing written back after the forget');
  } finally {
    if (prev) Object.defineProperty(globalThis, 'localStorage', prev); else delete globalThis.localStorage;
  }
});

// ---- F3-06 ----------------------------------------------------------------------------------------------------------

test('F3-06: a Together letter on the tracker opens the Journal\'s Together page; Letters and This week keep theirs', () => {
  assert.equal(typeof T.storyArgs, 'function', 'tracker.js storyArgs(g)');
  assert.deepEqual(T.storyArgs({ id: 'h3' }), { tab: 'stats', focus: 'h3' });
  assert.deepEqual(T.storyArgs({ id: 'a1' }), { tab: 'story', focus: 'a1' });
  const week = [...CONTENT.quests.values()].find((q) => T.journalTabOf(q) === 'week');
  if (week) assert.deepEqual(T.storyArgs({ id: week.id }), { tab: 'week', focus: week.id });
  // the click: the letters chip opens Journal › Together for Helping Hands
  const s = atQuest('h3');
  const t = tracker(s, { now: { slot: 'now', kind: 'calm', msg: msg('feat.r.calm') }, soon: null, big: null }, { now: at(14, 14) });
  t.box.querySelector('.story-sum').click();
  assert.deepEqual(t.calls.open.at(-1), ['quests', { tab: 'stats', focus: 'h3' }]);
});

// ---- F3-07 ----------------------------------------------------------------------------------------------------------

/** An owned tile with nothing on it and no weeding yet. */
function wildTile(s) {
  const busy = new Set(Object.keys(s.farm.weeds?.t ?? {}));
  for (const o of Object.values(s.farm.objects)) if (Number.isFinite(o.x)) for (const [x, z] of objTiles(o)) busy.add(`${x},${z}`);
  for (let z = 0; z < WORLD_TILES; z++) for (let x = 0; x < WORLD_TILES; x++) if (inLand(s, x, z) && !busy.has(`${x},${z}`)) return { x, z };
  return null;
}

test('F3-07: a wild tuft pulled during "clear the weeds" counts toward the step; it never picks a track by itself', () => {
  const s = farmAt(1);
  s.players.p1.tut = { track: 'barnyard', i: 0, n: 0, skip: false };
  assert.equal(TutR.currentStep(s, 'p1').id, 'clear_weeds');
  const tile = wildTile(s);
  actOk(s, 'clearWeed', tile, { pid: 'p1', now: T0 + MIN });
  assert.equal(s.players.p1.tut.n, 1, 'one tuft, one of three');
  // a drag across two more tiles finishes the step
  const cells = [];
  for (let x = 0; x < WORLD_TILES && cells.length < 2; x++) {
    for (let z = 0; z < WORLD_TILES && cells.length < 2; z++) {
      if (inLand(s, x, z) && !(x === tile.x && z === tile.z)) cells.push(z * WORLD_TILES + x);
    }
  }
  actOk(s, 'clearWeed', { cells }, { pid: 'p1', now: T0 + 2 * MIN });
  assert.equal(TutR.currentStep(s, 'p1')?.id, 'place_coop', 'the step is done');
  // p2 has no track yet: a tuft is no reason to hand them the Barnyard (the coach teaches planting first)
  assert.equal(s.players.p2.tut.track, null);
  actOk(s, 'clearWeed', wildTile(s), { pid: 'p2', now: T0 + 3 * MIN });
  assert.equal(s.players.p2.tut.track, null);
  valid(s);
});

// ---- F3-08 ----------------------------------------------------------------------------------------------------------

test('F3-08: the partner cards ("Say hello", "High five!", Golden Hour, help flags) wait for a second farmer', () => {
  const partnerCards = ['pings', 'high_five', 'golden_hour', 'help_flags'];
  const solo = farmAt(5, { players: ['p2'] });
  const p = solo.players.p2;
  for (const f of CONTENT.features.values()) if (f.card && !partnerCards.includes(f.id)) p.seen.cards[f.id] = 1;
  p.play.n = 500;
  p.play.card = 0;
  const met = dripRun(solo, 'p2', 6);
  assert.deepEqual(met.filter((id) => partnerCards.includes(id)), [], `a solo farmer met ${met.join(', ')}`);
  const two = farmAt(5);
  for (const pid of ['p1', 'p2']) {
    const q = two.players[pid];
    for (const f of CONTENT.features.values()) if (f.card && !partnerCards.includes(f.id)) q.seen.cards[f.id] = 1;
    q.play.n = 500;
    q.play.card = 0;
  }
  assert.deepEqual(dripRun(two, 'p1', 6).filter((id) => partnerCards.includes(id)).sort(), [...partnerCards].sort());
});

// ---- F3-09 ----------------------------------------------------------------------------------------------------------

test('F3-09: the workshop\'s first tip says the queue rule (one at a time, in order), never "more at once"', () => {
  const tip = TUTORIAL.firstUse.find((x) => x.id === 'building_panel').text;
  assert.doesNotMatch(tip, /more at once/i);
  assert.match(tip, /in order/i);
  assert.match(tip, /line up/i);
  assert.doesNotMatch(tip, /used when|enters? the queue|ingredient|inputs/i, 'M28: not the panel\'s own line');
});

// ---- F3-10 ----------------------------------------------------------------------------------------------------------

test('F3-10: once the Windmill stands the flour step says "make Flour", "together" only with two farmers', async () => {
  assert.equal(typeof TutR.stepWords, 'function', 'actions/tutorial.js stepWords(state, step)');
  const step = TUTORIAL.together.find((x) => x.id === 'flour_together');
  const two = farmAt(3);
  assert.equal(TutR.stepWords(two, step), null, 'no Windmill yet, two farmers: the step\'s own words (where it is)');
  put(two, 'mill');
  const placed = enText(TutR.stepWords(two, step));
  assert.doesNotMatch(placed, /place/i);
  assert.match(placed, /Flour/);
  assert.match(placed, /together/);
  const solo = farmAt(3, { players: ['p2'] });
  assert.doesNotMatch(enText(TutR.stepWords(solo, step)), /together/i, 'solo, before the mill');
  assert.match(enText(TutR.stepWords(solo, step)), /place it/i);
  put(solo, 'mill');
  assert.doesNotMatch(enText(TutR.stepWords(solo, step)), /together|place/i);
  // every other step keeps its words
  for (const st of [...TUTORIAL.fields, ...TUTORIAL.barnyard, ...TUTORIAL.together.filter((x) => x !== step)]) {
    assert.equal(TutR.stepWords(two, st), null, st.id);
  }
  // Bulgarian has every new line, without "заедно" alone
  const bg = (await import('../public/js/i18n/bg/feat.js')).default;
  for (const k of ['feat.r.coach.flourSolo', 'feat.r.coach.flourMill', 'feat.r.coach.flourMillSolo']) assert.ok(bg[k], k);
  assert.doesNotMatch(JSON.stringify(bg['feat.r.coach.flourMillSolo']), /заедно|Сложи/);
  // the tracker's mirror of the coach uses the same words
  assert.doesNotMatch(T.coachText(step, two), /place/i);
});

// ---- F3-11 ----------------------------------------------------------------------------------------------------------

test('F3-11: a surprise the farm shelved after 48 h is named once in the welcome back card', () => {
  const s = farmAt(14);
  give(s, 'egg', 3);
  const t0 = at(13, 10);
  actOk(s, 'keepsake', { item: 'egg', note: '#thinking' }, { pid: 'p2', now: t0 });
  runDue(s, t0 + 49 * HOUR);
  assert.deepEqual(s.farm.gifts, {}, 'shelved');
  const r = recap(s, 'p1', t0 + 49 * HOUR + MIN, { since: t0 - MIN });
  const named = r.sections.flatMap((sec) => sec.items.map((it) => [sec.name, it]))
    .filter(([, it]) => it.k === 'surprise' || it.k === 'keepsake');
  assert.deepEqual(named.map(([sec, it]) => `${sec}:${it.what ?? it.k}`), ['keepsakes:shelved']);
});

// ---- F3-12 ----------------------------------------------------------------------------------------------------------

test('F3-12: with the Wide Sickle owned the brush card offers the Seed Spreader, then the Big Watering Can', () => {
  const s = farmAt(21);
  s.farm.wallet.coins = 316_892;
  s.farm.tools = { wide_sickle: 1 };
  const now = at(15, 20);
  const brush = (st) => allCards(st, 'p1', now).find((c) => c.kind === 'brush')?.id ?? null;
  assert.equal(brush(s), 'seed_spreader');
  s.farm.tools.seed_spreader = 1;
  assert.equal(brush(s), 'big_watering_can');
  // nothing bought yet: the sickle first (F2-06)
  s.farm.tools = {};
  assert.equal(brush(s), 'wide_sickle');
});

// ---- patches other lanes sent ---------------------------------------------------------------------------------------

test('S3-19 (ui-shell patch): the tracker says when its list opens (the tool pop-up closes on it)', () => {
  const s = farmAt(14);
  const t = tracker(s, { now: { slot: 'now', kind: 'calm', msg: msg('feat.r.calm') }, soon: null, big: null });
  t.box.parentNode.querySelector('.tracker-chip').click();
  assert.ok(t.calls.events.includes('tracker-open'), `events: ${t.calls.events.join(', ')}`);
});

test('S3-21 (ui-shell patch): the duel has a line for the winner\'s own screen', () => {
  assert.equal(typeof DUEL.lines.winYou, 'string');
  assert.match(DUEL.lines.winYou, /\{duel\}/);
  assert.doesNotMatch(DUEL.lines.winYou, /\{name\}|theirs/);
});

test('S3-23 (ui-shell patch): the gift grid moves on the arrow keys, Home and End, and is one Tab stop', () => {
  const s = farmAt(14);
  for (const [i, n] of [['rose', 2], ['lavender', 2], ['egg', 9], ['wool', 4]]) give(s, i, n);
  const { ctx, body } = ctxOf(s);
  G.giftPanel.mount(body, ctx);
  const grid = body.querySelector('.rel-gift-grid');
  const tiles = grid.querySelectorAll('.pn-stack');
  assert.ok(tiles.length >= 4);
  assert.deepEqual(tiles.map((b) => b.getAttribute('tabindex')), ['0', ...tiles.slice(1).map(() => '-1')], 'one Tab stop');
  tiles[0].focus();
  grid.dispatch('keydown', { key: 'ArrowRight', target: tiles[0] });
  assert.equal(document.activeElement, tiles[1]);
  grid.dispatch('keydown', { key: 'ArrowLeft', target: tiles[1] });
  assert.equal(document.activeElement, tiles[0]);
  grid.dispatch('keydown', { key: 'End', target: tiles[0] });
  assert.equal(document.activeElement, tiles.at(-1));
  grid.dispatch('keydown', { key: 'Home', target: tiles.at(-1) });
  assert.equal(document.activeElement, tiles[0]);
  grid.dispatch('keydown', { key: 'ArrowDown', target: tiles[0] });
  assert.equal(document.activeElement, tiles[1]);
  // the Tab stop follows the focus (Tab leaves the grid in one press, Shift+Tab comes back to the same good)
  assert.equal(tiles[1].getAttribute('tabindex'), '0');
  assert.equal(tiles[0].getAttribute('tabindex'), '-1');
});

test('S3-C1 (ui-shell patch): after "Open it" the reveal card\'s "♥ Thanks" takes the keyboard focus', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const s = farmAt(14);
    give(s, 'rose', 1);
    const r = actOk(s, 'keepsake', { item: 'rose' }, { pid: 'p1', now: at(14, 10) });
    const id = evs(r, 'keepsake')[0].id;
    const { ctx, body, acts } = ctxOf(s, { pid: 'p2', now: at(14, 12) });
    G.giftPanel.mount(body, ctx);
    const open = body.querySelector('[data-gift="unwrap"]');
    assert.ok(open, 'the Open it button');
    open.focus();
    open.click();
    document.activeElement = document.body;                 // the sheet closed under the focus
    mock.timers.tick(700);
    assert.deepEqual(acts.at(-1), ['openGift', { id }]);
    // life-feel's reveal card comes a moment later (feedback.js GIFT_CARD_MS)
    const card = document.createElement('section');
    card.dataset.id = `gift-open-${id}`;
    card.classList.add('unlock-banner');
    const thanks = document.createElement('button');
    thanks.classList.add('btn');
    card.append(thanks);
    document.body.append(card);
    mock.timers.tick(1500);
    assert.equal(document.activeElement, thanks, 'the focus is on "♥ Thanks"');
  } finally { mock.timers.reset(); }
});

test('I3-C1 (infra patch): game text keeps at most two marks per letter whatever stands between them', () => {
  const M = '͓͆';
  const marks = (v) => (v.match(/\p{M}/gu) || []).length;
  for (const [what, sep] of [['nothing', ''], ['LRM', '‎'], ['lone surrogate', '\ud800'], ['ZWJ', '‍'], ['ZWNJ', '‌'],
    ['CGJ', '͏'], ['ZWSP', '​'], ['word joiner', '⁠']]) {
    const r = check(['text', 80], `a${(M + sep).repeat(20)}`);
    assert.ok(r.ok, what);
    assert.ok(marks(r.v) <= 2, `${what}: ${marks(r.v)} marks on one letter`);
  }
  // an emoji's own joiner and variation selector stay
  for (const e of ['❤️‍🔥', '👩‍🌾', '1️⃣']) assert.equal(check(['text', 80], `hi ${e}`).v, `hi ${e}`);
});
