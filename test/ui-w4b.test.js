// ui+client lane, wave 4b (owner wishes 2026-10-05): the adapter to the new rules (w4b-rules.js), the queue's reorder and
// per-item finish in the workshop panel, the drag maths, the loot card's words, tree ages, the Acorn treasures and the
// Goal Tracker's "saving for", the crate verb and tooltip, the home's room step, and the phone's compact system card. Farms
// are built by the real rules; panels mount in the ui tests' tiny DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';
import { ACTIONS } from '../shared/rules/index.js';
import * as C from '../shared/content/index.js';
import { farmAt, put, actOk, MONDAY, HOUR, DAY } from './helpers/rules-goals.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

let W;
let M;
before(async () => {
  W = await import('../public/js/ui/panels/w4b-rules.js');
  M = {
    hub: await import('../public/js/ui/panels/w4b.js'),
    drag: await import('../public/js/ui/panels/queue-drag.js'),
    building: await import('../public/js/ui/panels/building.js'),
    tree: await import('../public/js/ui/panels/tree.js'),
    animals: await import('../public/js/ui/panels/animals.js'),
    shop: await import('../public/js/ui/panels/relic-shop.js'),
    tracker: await import('../public/js/ui/tracker.js'),
    feed: await import('../public/js/ui/feed.js'),
    hud: await import('../public/js/ui/hud.js'),
    toasts: await import('../public/js/ui/toasts.js'),
    targets: await import('../public/js/game/targets.js'),
  };
});

const JUNK = /undefined|NaN|\[object|null\b/;
const objOf = (s, def) => Object.keys(s.farm.objects).sort().find((k) => s.farm.objects[k].def === def);

function ctxOf(state, { pid = 'p1', now = MONDAY + HOUR, args = {} } = {}) {
  const acts = [];
  const toasts = [];
  const body = document.createElement('div');
  document.body.append(body);
  const store = { state, pid, now: () => now, on: () => () => {}, act: (t, a) => { acts.push([t, a]); return { ok: true }; } };
  const ctx = {
    name: 'x', args, store, body, el: body, now: () => now, tab: null,
    ui: { panels: { open: () => true, has: () => true }, toast: (t, o) => toasts.push([t, o]) },
    every: () => () => {}, on: () => () => {}, subscribe: () => () => {},
    act: (t, a) => { acts.push([t, a]); return { ok: true }; },
    open() {}, close() {}, setTitle() {}, refreshTabs() {},
    controller: { input: 'mouse', do: (t, a) => { acts.push([t, a]); return { ok: true }; } },
  };
  return { ctx, body, acts, toasts, store };
}

// ---- 5: the workshop queue --------------------------------------------------------------------------------------------

test('queue: waiting items, moving a key, the drop index among wrapped rows', () => {
  const o = { queue: [{ k: 0, s: 0, e: 100 }, { k: 1, s: 100, e: 200 }, { k: 2, s: 200, e: 300 }, { k: 3, s: 300, e: 400 }] };
  assert.deepEqual(W.waitingOf(o, 150).map((x) => x.k), [2, 3]);
  assert.deepEqual(W.moveKey([2, 3, 4], 4, 0), [4, 2, 3]);
  assert.deepEqual(W.moveKey([2, 3, 4], 2, 9), [3, 4, 2]);
  assert.equal(W.keyed([{ k: 1 }, { k: undefined }]), false);
  // two rows of two cards (100 wide, 120 tall): reading order
  const R = [{ left: 0, top: 0, width: 100, height: 120 }, { left: 110, top: 0, width: 100, height: 120 },
    { left: 0, top: 130, width: 100, height: 120 }, { left: 110, top: 130, width: 100, height: 120 }];
  assert.equal(M.drag.insertionIndex(R, 10, 50), 0, 'left half of the first card');
  assert.equal(M.drag.insertionIndex(R, 80, 50), 1, 'right half of the first card');
  assert.equal(M.drag.insertionIndex(R, 200, 60), 2, 'end of the first row');
  assert.equal(M.drag.insertionIndex(R, 5, 200), 2, 'start of the second row');
  assert.equal(M.drag.insertionIndex(R, 400, 400), 4, 'after the last');
});

/** A Windmill with a running item and three waiting ones (the real craft action). */
function millFarm() {
  const s = farmAt(30);
  const mill = objOf(s, 'mill') ?? put(s, 'mill');
  s.farm.objects[mill].slots = 6;
  s.farm.inventory.wheat = 200;
  s.farm.inventory.sugarcane = 50;
  const now = MONDAY + HOUR;
  for (const r of ['flour', 'flour', 'sugar', 'flour']) actOk(s, 'craft', { id: mill, recipe: r }, { now });
  return { s, mill, now };
}

test('queue: reorder sends the waiting keys in their new order; finish names one item and quotes the rules\' price', (t) => {
  if (!ACTIONS.reorder) { t.skip('this build has no reorder'); return; }
  const { s, mill, now } = millFarm();
  const store = { state: s, pid: 'p1', now: () => now + 1000 };
  const wait = W.waitingOf(s.farm.objects[mill], now + 1000);
  assert.equal(wait.length, 3);
  const keys = W.moveKey(wait.map((x) => x.k), wait[2].k, 0);
  const it = W.reorderIntent(store, mill, keys);
  assert.equal(it.type, 'reorder');
  assert.deepEqual(it.args, { id: mill, keys });
  assert.equal(it.code, undefined, 'the rules take it');
  // the per-item finish: hurry {id, k}, priced at what Hurry costs when it runs (its whole time)
  const f = W.finishIntent(store, mill, wait[1]);
  assert.deepEqual(f.args, { id: mill, k: wait[1].k });
  const q = W.finishQuote(store, mill, wait[1], now + 1000);
  const hours = Math.max(1, Math.ceil((wait[1].e - wait[1].s) / HOUR));
  assert.equal(q.acorns, Math.min(C.BOOSTS.hurry.maxAcorns, hours * C.BOOSTS.hurry.acornsPerHour));
  assert.equal(q.exact, true);
});

test('queue: the panel shows a finish price under every waiting item and ◀ ▶ that reorder it', (t) => {
  if (!ACTIONS.reorder) { t.skip('this build has no reorder'); return; }
  const { s, mill, now } = millFarm();
  const r = ctxOf(s, { now: now + 1000, args: { id: mill } });
  r.ctx.name = 'building';
  M.building.buildingPanel.mount(r.body, r.ctx);
  const text = textOf(r.body);
  assert.ok(!JUNK.test(text), text.slice(0, 200));
  const waiting = r.body.querySelectorAll('.pn-slot.queued');
  assert.equal(waiting.length, 3);
  for (const w of waiting) assert.ok(w.querySelector('.pn-finish'), 'a price under each waiting item');
  // ◀ on the last waiting item: one step sooner
  const last = waiting.at(-1);
  last.querySelector('[data-move="-1"]').click();
  const sent = r.acts.find(([type]) => type === 'reorder');
  assert.ok(sent, 'reorder sent');
  const keys = [...waiting].map((w) => Number(w.dataset.k));
  assert.deepEqual(sent[1].keys, [keys[0], keys[2], keys[1]]);
});

// ---- 4: trees age -----------------------------------------------------------------------------------------------------

test('trees: age in years from the harvest counter, the stage and the next one, the card title', () => {
  assert.equal(W.treeAgeOf({ cycle: 7 }), 7);
  assert.equal(W.treeAgeOf({}), 0);
  const stages = W.ageStages();
  assert.ok(stages.length >= 2 && stages[0].from === 0);
  const last = stages.at(-1);
  assert.equal(W.treeStageOf(last.from + 5).stage.id, last.id);
  assert.equal(W.treeStageOf(last.from + 5).next, null);
  assert.equal(W.treeStageOf(0).index, 0);
  assert.equal(W.ageLine('Apple Tree', 7), 'Apple Tree · 7 years');
  assert.equal(W.ageLine('Apple Tree', 1), 'Apple Tree · 1 year');
  assert.equal(W.ageLine('Apple Tree', 0, true), 'Apple Tree · sapling');
  if (C.TREE_AGE) assert.equal(W.ageBonusOf({ cycle: last.from }), last.bonus);
});

test('trees: the tree card says its age and the way to the next stage; the tooltip title too', () => {
  const s = farmAt(20);
  const id = put(s, 'apple_tree', { matureAt: MONDAY - DAY, readyAt: MONDAY + 2 * HOUR, startedAt: MONDAY - HOUR, cycle: 12 });
  const r = ctxOf(s, { args: { id } });
  M.tree.treePanel.mount(r.body, r.ctx);
  const text = textOf(r.body);
  assert.match(text, /12 years old/);
  assert.ok(!JUNK.test(text));
  const tip = M.hud.worldTip(s, { kind: 'object', id }, MONDAY + HOUR, 'p1');
  assert.match(tip.title, /Apple Tree · 12 years/);
});

// ---- 1: balloon crates ------------------------------------------------------------------------------------------------

test('crates: the Hand (any tool but the Hammer) opens one; one press, never a drag', () => {
  const t = { kind: 'crate', crate: true, def: { kind: 'crate' } };
  assert.deepEqual(M.targets.verbsFor('hand', t), ['openCrate']);
  assert.deepEqual(M.targets.verbsFor('basket', t), ['openCrate']);
  assert.deepEqual(M.targets.verbsFor('hammer', t), []);
  assert.ok(M.targets.ONCE_VERBS.has('openCrate'));
  assert.ok(M.targets.VERBS.openCrate.one.some(([type]) => type === 'openCrate'));
});

test('crates: the loot card lists coins, XP and the extra; one line for the partner and the feed', () => {
  const ev = { e: 'crateOpened', id: 'crate.x', coins: 1240, xp: 85, acorns: 2, by: 'p1' };
  assert.deepEqual(M.hub.lootThings(ev).map((x) => x.name), ['+1,240 coins', '+85 XP', '+2 Acorns']);
  assert.equal(M.hub.lootText(ev), '1,240 coins, 85 XP and 2 Acorns');
  const fert = { e: 'crateOpened', coins: 10, xp: 5, item: 'fertilizer', qty: 2 };
  assert.deepEqual(W.lootOf(fert).items, [{ id: 'fertilizer', n: 2 }]);
  assert.deepEqual(W.lootOf({ goldenSeeds: 1 }).items, [{ id: 'golden_seeds', n: 1 }]);
  assert.deepEqual(W.lootOf({ decor: 'garden_gnome' }).decor, ['garden_gnome']);
  const st = { players: { p1: { name: 'Rowan' }, p2: { name: 'Mia' } } };
  assert.match(M.feed.feedText({ k: 'crate', by: 'p1', c: 1240, a: 2 }, st, 'p2').text, /opened a balloon crate: 1,240 coins and 2 Acorns/);
  assert.match(M.feed.feedText({ k: 'crate', by: 'sys', c: 300, auto: 1 }, st, 'p2').text, /nobody opened went to the Barn/);
});

test('crates: the tooltip says how to open it and when it goes to the Barn', () => {
  if (!C.CRATES) return;
  const s = farmAt(10);
  s.farm.objects['crate.t1'] = { def: C.CRATES.def, x: 30, z: 30, rot: 0, placedAt: MONDAY, by: 'sys', k: 5, until: MONDAY + 3 * HOUR };
  const tip = M.hud.worldTip(s, { kind: 'object', id: 'crate.t1' }, MONDAY + HOUR, 'p1');
  assert.equal(tip.title, 'Balloon Crate');
  assert.match(tip.lines.join(' '), /open it/);
  assert.match(tip.lines.join(' '), /Barn in 2h/);
  assert.equal(W.cratesOf(s).length, 1);
});

// ---- 2: the Acorn treasures -------------------------------------------------------------------------------------------

test('treasures: the shop rows (owned, locked, saving up), the buy intent, the Goal Tracker card without the rules\' saveFor', () => {
  if (!C.RELICS) return;
  const s = farmAt(30);
  s.farm.wallet.acorns = 40;
  const rows = M.hub.relicRows(s, 'p1', MONDAY);
  assert.equal(rows.length, C.RELICS.length);
  assert.ok(rows.every((r) => r.name && r.acorns > 0 && r.text));
  assert.ok(rows.some((r) => r.code === 'SAVING'));
  const buy = W.buyIntent(rows[0].id);
  if (ACTIONS.buyRelic) assert.deepEqual(buy, { type: 'buyRelic', args: { relic: rows[0].id } });
  // a farmer's own pick: the rules' players[pid].save when present, else this browser's
  s.players.p1.save = rows.at(-1).id;
  assert.equal(W.savingOf(s, 'p1'), rows.at(-1).id);
  const card = M.tracker.savingCard(s, 'p1');
  assert.match(card.title, /Saving for the /);
  assert.match(card.sub, /40 \/ \d+ Acorns/);
  assert.deepEqual(card.target, { panel: 'market', args: { tab: 'acorn', focus: rows.at(-1).id } });
  // the rules' own relic goal opens the Market's Acorn shop at that card
  const cards = M.tracker.cardsFromGoals({ soon: { kind: 'relic', ref: rows[1].id, text: `Saving for the ${rows[1].name}: 4 / 90 Acorns`,
    have: 4, need: 90, target: { panel: 'relics', args: { relic: rows[1].id } } } }, s, 'p1', MONDAY);
  assert.deepEqual(cards[0].target, { panel: 'market', args: { tab: 'acorn', focus: rows[1].id } });
});

test('treasures: owned ones say who bought them and offer their daily use', () => {
  if (!C.RELICS || !ACTIONS.buyRelic) return;
  const s = farmAt(30);
  s.farm.wallet.acorns = 500;
  actOk(s, 'buyRelic', { relic: 'golden_can', confirm: ['BIG_SPEND'] }, { now: MONDAY });
  const r = ctxOf(s, { now: MONDAY + HOUR });
  const kit = { button: (spec) => { const b = document.createElement('button'); b.textContent = spec.label; const w = document.createElement('span'); w.append(b); w.button = b; return w; }, refresh() {} };
  const sec = M.shop.relicSection(r.ctx, kit);
  const text = textOf(sec.el);
  assert.match(text, /Bought by you/);
  assert.match(text, /Water everything/);
  assert.ok(!JUNK.test(text));
});

// ---- 3: homes grow ----------------------------------------------------------------------------------------------------

test('homes: the room step from the rules, the tiles a growth adds or that are in the way', () => {
  const s = farmAt(30);
  const coop = objOf(s, 'coop') ?? put(s, 'coop');
  const g = W.homeGrowth(s, coop);
  assert.ok(g && Number.isSafeInteger(g.cap) && g.max >= g.cap);
  const tiles = W.growthTiles(s, coop, { ...g, grows: true, code: null, size: [3, 3], nextSize: [4, 4], x: s.farm.objects[coop].x, z: s.farm.objects[coop].z, rot: 0 });
  assert.equal(tiles.add.length + tiles.blocked.length, 7, 'a 3x3 grown to 4x4 adds seven tiles');
});

test('homes: the Market sells an animal for a full home that can grow, at the folded price; a boxed-in one says why', async () => {
  const model = await import('../public/js/ui/panels/model.js');
  const AN = await import('../shared/rules/actions/animals.js');
  const GR = await import('../shared/rules/grid.js');
  const s = farmAt(30);
  s.farm.wallet.coins = 5_000_000;
  for (const id of Object.keys(s.farm.objects)) if (['coop', 'chicken'].includes(s.farm.objects[id].def)) delete s.farm.objects[id];
  const coop = put(s, 'coop', { x: 30, z: 30, up: (C.defOf('coop').capacityMax - C.defOf('coop').capacity) / C.defOf('coop').upgradeStep });
  for (let i = 0; i < 40 && GR.occupantsOf(s, coop).length < GR.capacityOf(s, coop); i++) actOk(s, 'buyAnimal', { def: 'chicken', adult: true, home: coop, confirm: ['BIG_SPEND'] });
  const plan = AN.animalBuyPlan(s, 'chicken', true);
  assert.equal(plan.code, null);
  const card = model.storeCards(s, 'animals').find((c) => c.kind === 'animal' && c.id === 'chicken' && c.adult);
  assert.equal(card.code, null, 'not "The Chicken Coop is full": buying makes the room');
  assert.equal(card.price.coins, plan.coins);
  assert.deepEqual(card.grow, { step: plan.step, home: coop });
  // a fence ring all round: no room to grow, and the card says so
  const o = s.farm.objects[coop];
  const [w, d] = GR.sizeOf(o);
  for (let z = o.z - 1; z <= o.z + d; z++) for (let x = o.x - 1; x <= o.x + w; x++) {
    if (x >= o.x && x < o.x + w && z >= o.z && z < o.z + d) continue;
    put(s, 'picket_fence', { x, z });
  }
  const boxed = model.storeCards(s, 'animals').find((c) => c.kind === 'animal' && c.id === 'chicken' && c.adult);
  assert.equal(boxed.code, 'CAP');
  assert.match(boxed.hint.text, /no room to grow/);
});

// ---- the phone's compact system card ---------------------------------------------------------------------------------

test('phone: a drip-fed system card folds into a chip; unlocks, invites and desktops keep the full card', () => {
  assert.equal(M.toasts.compactCard('card', { phone: true }), true);
  assert.equal(M.toasts.compactCard('card', { phone: false }), false);
  assert.equal(M.toasts.compactCard('unlock', { phone: true }), false);
  assert.equal(M.toasts.compactCard('card', { phone: true, urgent: true }), false);
  assert.equal(M.toasts.compactCard('loot', { phone: true }), false);
});
