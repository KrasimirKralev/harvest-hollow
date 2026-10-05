// Wave-1 QA regressions for the rules (docs/qa/wave1/TRIAGE.md, rules-content section). One test per task id; the
// story-graph task RC-01 lives in rules.wave1-story.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { SAFETY, ORDERS, questOf, xpForLevel, unlocksAt, CONTENT, isLive } from '../shared/content/index.js';
import { producers, canMake } from '../shared/rules/orders-board.js';
import { sys } from './helpers.js';
import { goals } from '../shared/rules/goals.js';
import { blockerOf } from '../shared/rules/actions/quests.js';
import { farmAt, allLand, placeDef, give, must, run, idsOf, freeSpot, T0, MIN } from './helpers/rules.js';
import { animalPrice } from '../shared/rules/actions/animals.js';
import { buyPrice } from '../shared/rules/actions/decor.js';
import { runDue, credit } from './helpers/rules-goals.js';

test('RC-05: an "own 2 Apple Trees" land proof does not count a tree inside its undo window', () => {
  const s = farmAt(7, { coins: 100_000 });
  must(s, 'openExpansion', { expansion: 'old_orchard' }, { now: T0 });
  s.farm.proofs.old_orchard.n['1'] = 3;
  give(s, 'planks', 2);
  allLand(s);
  s.farm.expansions = ['home', 'creekside'];
  placeDef(s, 'apple_tree', { now: T0 });
  placeDef(s, 'apple_tree', { now: T0 });
  assert.equal(run(s, 'expand', { expansion: 'old_orchard', confirm: ['BIG_SPEND'] }, { now: T0 + 1000 }).code,
    ERR.NOT_READY);
  must(s, 'expand', { expansion: 'old_orchard', confirm: ['BIG_SPEND'] }, { now: T0 + SAFETY.undoMs });
});

test('RC-05: D1 "Cherry on Top" waits until the second tree is settled, then completes on the next minute', () => {
  const s = farmAt(11, { coins: 100_000 });
  allLand(s);
  s.farm.quests.active = { d1: { at: T0, n: { 1: 1 } } };
  const first = placeDef(s, 'cherry_tree', { now: T0 - 30 * MIN });
  delete s.farm.objects[first].rcpt;
  placeDef(s, 'cherry_tree', { now: T0 });
  assert.equal(Object.hasOwn(s.farm.quests.done, 'd1'), false, 'a refundable tree does not finish the card');
  // any action a minute after the receipt expired re-checks the card (the settle touch)
  must(s, 'keep', { item: 'wheat', n: 5 }, { now: T0 + SAFETY.undoMs + MIN });
  assert.ok(Object.hasOwn(s.farm.quests.done, 'd1'));
  assert.ok(idsOf(s, 'cherry_tree').length === 2);
});

test('RC-07: a stale order intent (old order number) never fills, discards, pins or flags the NEW order', () => {
  const s = farmAt(3);
  runDue(s, T0);
  const first = s.farm.orders.slots['0'].order;
  for (const [it, q] of Object.entries(first.items)) give(s, it, q);
  must(s, 'orderFill', { slot: 0, n: first.n }, { pid: 'p1', now: T0 + 1 });
  runDue(s, T0 + ORDERS.refillMs + 2);
  const next = s.farm.orders.slots['0'].order;
  assert.ok(next && next.n !== first.n, 'the slot holds a new order');
  for (const [it, q] of Object.entries(next.items)) give(s, it, q);
  const later = { pid: 'p2', now: T0 + ORDERS.refillMs + 3 };
  for (const type of ['orderFill', 'orderDiscard', 'orderPin', 'orderFlag']) {
    assert.equal(run(s, type, { slot: 0, n: first.n }, later).code, ERR.NOT_FOUND, type);
  }
  assert.equal(run(s, 'orderFill', { slot: 0 }, later).code, ERR.BAD_ARGS, 'the order number is required');
  assert.deepEqual(s.farm.orders.slots['0'].order, next, 'the new order is untouched');
  must(s, 'orderFill', { slot: 0, n: next.n }, later);
});

test('RC-10: a waiting story card says what it waits for (Dairy, Cow Barn, land proof)', () => {
  const s = farmAt(7);
  const c1 = questOf('c1');
  assert.deepEqual(blockerOf(s, c1.tasks[0], T0), { kind: 'building', ref: 'dairy', text: 'build the Dairy first' });
  assert.equal(blockerOf(s, c1.tasks[1], T0).text, 'build the Cow Barn first');
  allLand(s);
  placeDef(s, 'dairy', { confirm: ['BIG_SPEND'] });
  assert.equal(blockerOf(s, c1.tasks[0], T0).text, 'build the Cow Barn first', 'Baby Bottles need milk, milk a cow');
  // e1: the land card's first open proof task
  const t = farmAt(5);
  must(t, 'openExpansion', { expansion: 'creekside' }, { now: T0 });
  t.farm.proofs.creekside.n['0'] = 18;
  const e1 = questOf('e1');
  assert.equal(blockerOf(t, e1.tasks[0], T0).text, 'first harvest 12 more Wheat');
  assert.equal(blockerOf(t, { verb: 'make', ref: 'flour', qty: 1 }, T0).text, 'build the Windmill first');
});

test('RC-14: every reachable level pays a non-coin reward; an empty level pays a Legacy item', () => {
  for (let L = 2; L <= 20; L++) {
    const s = farmAt(L - 1);
    s.farm.xp = xpForLevel(L) - 1;
    s.farm.quests.active = {};
    const acorns = s.farm.wallet.acorns;
    const golden = s.farm.golden;
    const tx = credit(s, [{ e: 'cleared', id: 'x', def: 'weed', xp: 1, coins: 0 }]);
    const up = tx.events.find((e) => e.e === 'levelUp' && e.scope === 'farm');
    assert.equal(up.level, L);
    const nonCoin = up.unlocks.length > 0 || s.farm.wallet.acorns > acorns || s.farm.golden > golden;
    assert.ok(nonCoin, `L${L} gives nothing but coins`);
    if (!unlocksAt(L).length) {
      assert.deepEqual(up.legacy, L % 2 ? { acorns: 10 } : { goldenSeeds: 5 });
      const big = goals(s, 'p1', T0).big;
      if (big.kind === 'level' && !unlocksAt(L + 1).length) assert.match(big.text, /Evening One is complete/);
    }
  }
});

test('RC-16: the weekly Couple Challenge is G-VALID: recipe counts fit the farm, animal goods need adults', () => {
  const DAY = 86_400_000;
  const bad = [];
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const s = farmAt(6, { seed });
    allLand(s);
    placeDef(s, 'mill');
    placeDef(s, 'bakery', { confirm: ['BIG_SPEND'] });
    s.farm.inventory.egg = 5;
    const now = T0 + 8 * DAY;
    if (!sys(s, '_rollover', {}, now).ok) continue;
    const cur = s.farm.challenge.cur;
    if (!cur) continue;
    seen.add(cur.tpl);
    const P = producers(s, now);
    const memo = new Map();
    const makeable = [...CONTENT.recipes.values()].filter((x) => isLive(x) && x.unlock <= 6 && !x.duet
      && canMake(s, P, x.id, memo)).length;
    if (cur.tpl === 'recipes_distinct' && makeable < cur.target) bad.push({ seed, target: cur.target, makeable });
    if (cur.tpl === 'collect_value') bad.push({ seed, tpl: cur.tpl, adults: [...P.adults.values()] });
  }
  assert.deepEqual(bad, []);
  assert.ok(seen.size >= 2, 'other templates still roll');
});

test('RC-18: the second buyer of an n-th copy never pays more than the price on their screen', () => {
  const s = farmAt(4, { coins: 100_000 });
  allLand(s);
  const coop = placeDef(s, 'coop');
  const seen = animalPrice(s, 'chicken', false);
  must(s, 'buyAnimal', { def: 'chicken', home: coop, max: seen, confirm: ['BIG_SPEND'] }, { pid: 'p1' });
  const coins = s.farm.wallet.coins;
  const r = run(s, 'buyAnimal', { def: 'chicken', home: coop, max: seen, confirm: ['BIG_SPEND'] }, { pid: 'p2' });
  assert.equal(r.code, 'PRICE');
  assert.equal(s.farm.wallet.coins, coins, 'nothing charged');
  must(s, 'buyAnimal', { def: 'chicken', home: coop, max: animalPrice(s, 'chicken', false), confirm: ['BIG_SPEND'] },
    { pid: 'p2' });
  // objects: the n-th plot
  const t = farmAt(12, { coins: 1_000_000 });
  allLand(t);
  let p = buyPrice(t, 'plot').coins;
  for (let i = 0; i < 30 && buyPrice(t, 'plot').coins === p; i++) {
    p = buyPrice(t, 'plot').coins;
    placeDef(t, 'plot');
  }
  assert.ok(buyPrice(t, 'plot').coins > p, 'the next plot costs more');
  const spot = freeSpot(t, 'plot');
  assert.equal(run(t, 'place', { def: 'plot', x: spot[0], z: spot[1], rot: 0, max: p }).code, 'PRICE');
});

test('RC-20: feed rows name a slot purchase, the wished thing, and an Acorn Hurry', () => {
  const s = farmAt(10, { coins: 1_000_000, acorns: 50 });
  allLand(s);
  const bakery = placeDef(s, 'bakery', { confirm: ['BIG_SPEND'] });
  must(s, 'upgradeSlot', { id: bakery, confirm: ['BIG_SPEND'] });
  const rows = () => Object.values(s.farm.feed.rows).sort((a, b) => a.at - b.at);
  const slotRow = rows().find((r) => r.k === 'buy' && r.what === 'slot');
  assert.ok(!slotRow || slotRow.def === 'bakery', 'a slot row names the building');
  const w = must(s, 'wish', { def: 'kitchen' }, { pid: 'p1' }).tx.events.find((e) => e.e === 'wishAdded').id;
  must(s, 'wishDeposit', { id: w, coins: 100 }, { pid: 'p1' });
  must(s, 'wishWithdraw', { id: w }, { pid: 'p2' });
  must(s, 'wishAnswer', { id: w, ok: false }, { pid: 'p1' });
  const wish = rows().filter((r) => r.k === 'wish').map((r) => [r.what, r.def]);
  assert.deepEqual(wish, [['deposit', 'kitchen'], ['asked', 'kitchen'], ['denied', 'kitchen']]);
  give(s, 'flour', 2);
  must(s, 'craft', { id: bakery, recipe: 'bread' }, { now: T0 });
  must(s, 'hurry', { id: bakery, confirm: ['BIG_SPEND'] }, { now: T0 + 1000 });
  const hurry = rows().find((r) => r.k === 'buy' && r.what === 'hurry');
  assert.ok(hurry && hurry.def === 'bakery' && hurry.a > 0, JSON.stringify(rows().slice(-3)));
});

test('RC-23: C1 "raise 1 cow" is not met by buying an adult; a calf that grows up does', () => {
  const s = farmAt(7, { coins: 100_000 });
  allLand(s);
  s.farm.quests.active = { c1: { at: T0, n: { 0: 2 } } };   // the two bottles are made
  const barn = placeDef(s, 'cow_barn', { confirm: ['BIG_SPEND'] });
  must(s, 'buyAnimal', { def: 'cow', home: barn, adult: true, confirm: ['BIG_SPEND'] }, { now: T0 });
  must(s, 'keep', { item: 'wheat', n: 5 }, { now: T0 + SAFETY.undoMs + MIN });
  assert.equal(Object.hasOwn(s.farm.quests.done, 'c1'), false, 'a bought adult is not raised');
  const calf = must(s, 'buyAnimal', { def: 'cow', home: barn, confirm: ['BIG_SPEND'] }, { now: T0 })
    .tx.events.find((e) => e.e === 'bought').id;
  give(s, 'livestock_feed', 5);
  const grown = s.farm.objects[calf].adultAt;
  must(s, 'feed', { id: calf }, { now: grown + 1 });
  assert.ok(Object.hasOwn(s.farm.quests.done, 'c1'), 'the calf grew up on the farm');
});

test('RC-24: depositing 60 % of the treasury in a wish asks BIG_SPEND and tells the partner', () => {
  const s = farmAt(10, { coins: 15_000 });
  const w = must(s, 'wish', { def: 'kitchen' }, { pid: 'p1' }).tx.events.find((e) => e.e === 'wishAdded').id;
  assert.equal(run(s, 'wishDeposit', { id: w, coins: 9000 }, { pid: 'p1' }).code, ERR.BIG_SPEND);
  const r = must(s, 'wishDeposit', { id: w, coins: 9000, confirm: ['BIG_SPEND'] }, { pid: 'p1' });
  assert.deepEqual(r.tx.events.find((e) => e.e === 'bigSpend'),
    { e: 'bigSpend', by: 'p1', coins: 9000, acorns: 0, what: 'kitchen' });
  must(s, 'wishDeposit', { id: w, coins: 100 }, { pid: 'p1' });     // a small top-up asks nothing
});
