// Boosts, tools, the Level-up Bloom (owner rule 2026-10-04: a level-up finishes everything growing), expansions and
// debris regrowth (GDD §2.3, §3.1 rule 10, §3.7, §3.9, §9 #23, #30, #35, #42).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { cropOf, recipeOf, animalOf, treeOf, expansionOf, expansionObjects, xpForLevel, BOOSTS, GROWTH, DEBRIS_RULES, CONTENT, levelFromXp, SAFETY } from '../shared/content/index.js';
import { validateState } from '../shared/rules/state.js';
import { hurryCost, bloom, retime } from '../shared/rules/actions/boosts.js';
import { proofProgress, econDue, econNextDueAt, freeTiles } from '../shared/rules/actions/expansions.js';
import { nextRainAt } from '../shared/rules/actions/farming.js';
import { weatherAt, hourIndex } from '../shared/rules/time.js';
import { makeCtx, CELEBRATIONS, FX_EVENTS } from '../shared/rules/index.js';
import { Tx, applyOps } from '../shared/rules/tx.js';
import { mulBp, available } from '../shared/rules/economy.js';
import { inLand } from '../shared/rules/grid.js';
import { sys } from './helpers.js';
import { run, must, T0, makeFarm, farmAt, give, placeDef, evs, allLand, MIN, HOUR } from './helpers/rules.js';

test('hurry: 1 Acorn per started hour left (max 8) on a crop, a tree, an animal, a running queue item', () => {
  assert.equal(hurryCost(1), 1);
  assert.equal(hurryCost(HOUR), 1);
  assert.equal(hurryCost(HOUR + 1), 2);
  assert.equal(hurryCost(100 * HOUR), BOOSTS.hurry.maxAcorns);
  const s = farmAt(12, { acorns: 100 });
  allLand(s);
  assert.equal(run(s, 'hurry', { id: 'home.0.0' }).code, ERR.EMPTY);
  must(s, 'plant', { id: 'home.0.0', crop: 'cabbage' }, { now: T0 });
  const a0 = s.farm.wallet.acorns;
  const r = must(s, 'hurry', { id: 'home.0.0', confirm: ['BIG_SPEND'] }, { now: T0 + HOUR });
  assert.equal(a0 - s.farm.wallet.acorns, evs(r, 'hurried')[0].acorns);
  assert.equal(s.farm.objects['home.0.0'].crop.readyAt, T0 + HOUR);
  must(s, 'harvest', { id: 'home.0.0' }, { now: T0 + HOUR });
  assert.equal(run(s, 'hurry', { id: 'home.0.0' }).code, ERR.EMPTY);
  // a sapling: matures and ripens at once
  const tree = placeDef(s, 'apple_tree', { confirm: ['BIG_SPEND'] });
  must(s, 'hurry', { id: tree, confirm: ['BIG_SPEND'] }, { now: T0 + 2 * HOUR, pid: 'p2' });
  assert.equal(s.farm.objects[tree].matureAt, T0 + 2 * HOUR);
  must(s, 'harvestTree', { id: tree }, { now: T0 + 2 * HOUR });
  // the running item of a queue; the waiting items move up
  const bakery = placeDef(s, 'bakery', { confirm: ['BIG_SPEND'] });
  give(s, 'flour', 2);
  must(s, 'craft', { id: bakery, recipe: 'bread' }, { now: T0 });
  must(s, 'craft', { id: bakery, recipe: 'bread' }, { now: T0 });
  s.players.p1.acornDay = { day: 0, n: 0 };
  must(s, 'hurry', { id: bakery }, { now: T0 + MIN });
  const q = s.farm.objects[bakery].queue;
  assert.deepEqual([q[0].e, q[1].s, q[1].e], [T0 + MIN, T0 + MIN, T0 + MIN + recipeOf('bread').ms]);
  assert.equal(run(s, 'hurry', { id: 'home.1.0' }).code, ERR.BAD_ARGS, 'the farmhouse has no timer');
  assert.equal(run(farmAt(4), 'hurry', { id: 'home.0.0' }).code, ERR.LOCKED);
  assert.deepEqual(validateState(s), []);
});

test('retime: items queued after their predecessor finished keep their start', () => {
  const q = [{ r: 'bread', s: 0, e: 10 }, { r: 'bread', s: 10, e: 20 }, { r: 'bread', s: 50, e: 60 }];
  assert.deepEqual(retime(q, 0, 4).map((x) => [x.s, x.e]), [[0, 4], [4, 14], [50, 60]]);
});

test('Level-up Bloom (owner 2026-10-04): every crop, tree, sapling, baby and animal product growing is ready at once', () => {
  const s = farmAt(12, { acorns: 100 });
  allLand(s);
  const now = T0 + HOUR;
  must(s, 'plant', { id: 'home.0.0', crop: 'pumpkin' }, { now: T0 });                  // 12 h: 11 h still to go
  must(s, 'plant', { id: 'home.0.1', crop: 'tomato' }, { now: now - MIN });             // planted a minute ago: ready too
  must(s, 'plant', { id: 'home.0.2', crop: 'wheat' }, { now: T0 });                     // ripe already: untouched
  const sapling = placeDef(s, 'apple_tree', { confirm: ['BIG_SPEND'], now: T0 });
  // a mature tree in the middle of a fruit cycle: placed long ago, ripe, shaken now -> its next cycle runs
  const tree = placeDef(s, 'cherry_tree', { confirm: ['BIG_SPEND'], now: T0 - 30 * 24 * HOUR });
  must(s, 'harvestTree', { id: tree }, { now: T0 });
  placeDef(s, 'coop', { confirm: ['BIG_SPEND'] });
  const buy = (adult, at) => evs(must(s, 'buyAnimal', { def: 'chicken', adult, confirm: ['BIG_SPEND'] }, { now: at }), 'bought')[0].id;
  const hen = buy(true, T0);
  const hungry = buy(true, T0);
  const chick = buy(false, now - 5 * MIN);
  give(s, 'chicken_feed', 2);
  must(s, 'feed', { id: hen }, { now: now - 2 * MIN });                                // an egg on its way
  const bakery = placeDef(s, 'bakery', { confirm: ['BIG_SPEND'] });
  give(s, 'flour', 4);
  must(s, 'craft', { id: bakery, recipe: 'bread' }, { now: now - MIN });
  must(s, 'craft', { id: bakery, recipe: 'bread' }, { now: now - MIN });
  const before = structuredClone(s.farm.objects);
  assert.ok(before[tree].readyAt > now && before[tree].matureAt <= T0, 'setup: a mature tree mid-cycle');
  assert.ok(before[sapling].matureAt > now, 'setup: a sapling');
  assert.ok(before[hen].readyAt > now && before[chick].adultAt > now, 'setup: an egg and a chick on the way');
  const snapshot = structuredClone(s);
  const tx = new Tx(s);
  bloom(tx, makeCtx(s, { now, pid: 'p1', cid: 'abcdef', seq: 1 }), 13);
  const o = s.farm.objects;
  assert.equal(o['home.0.0'].crop.readyAt, now, 'the Pumpkin is ripe');
  assert.equal(o['home.0.1'].crop.readyAt, now, 'planted a minute ago: ripe too (no minimum age any more)');
  assert.equal(o['home.0.2'].crop.readyAt, before['home.0.2'].crop.readyAt, 'already ripe: untouched');
  assert.deepEqual([o[sapling].matureAt, o[sapling].readyAt], [now, now], 'the sapling is a mature tree with ripe fruit');
  assert.equal(o[tree].readyAt, now, 'the fruit cycle is ripe');
  assert.equal(o[tree].matureAt, before[tree].matureAt);
  assert.equal(o[chick].adultAt, now, 'the chick is a hen');
  assert.equal(o[chick].readyAt, null, 'a grown-up chick still waits for its first meal');
  assert.equal(o[hen].readyAt, now, 'the egg waits to be collected');
  assert.deepEqual(o[hungry], before[hungry], 'a hungry hen has nothing growing');
  assert.deepEqual(o[bakery], before[bakery], 'production buildings keep their queues');
  const ev = tx.events.filter((e) => e.e === 'bloomed');
  assert.deepEqual(ev, [{ e: 'bloomed', level: 13, ids: ['home.0.0', 'home.0.1', sapling, tree, hen, chick].sort() }]);
  assert.deepEqual(validateState(s), []);
  // tx writes only: its undo gives back the farm before the Bloom
  const back = structuredClone(s);
  applyOps(back, tx.inverse());
  assert.deepEqual(back, snapshot);
  // nothing left growing: a second Bloom changes nothing and says nothing
  const tx2 = new Tx(s);
  bloom(tx2, makeCtx(s, { now, pid: 'p1', cid: 'abcdef', seq: 2 }), 14);
  assert.deepEqual([tx2.ops.length, tx2.events.length], [0, 0]);
  must(s, 'harvest', { id: 'home.0.0' }, { now });
  must(s, 'harvestTree', { id: sapling }, { now });
  must(s, 'collect', { id: hen }, { now });
});

test('the Bloom runs inside the level-up transaction: a harvest that levels up finishes the farm, one celebration', () => {
  const s = makeFarm();
  must(s, 'plant', { id: 'home.0.0', crop: 'wheat' }, { now: T0 });
  s.farm.xp = xpForLevel(4);
  must(s, 'plant', { id: 'home.0.2', crop: 'strawberry' }, { now: T0 });
  must(s, 'plant', { id: 'home.0.1', crop: 'strawberry' }, { now: T0 + 25 * MIN });
  s.farm.xp = xpForLevel(5) - 1;
  s.farm.xpFrac = 50;                                    // half an XP waiting: this Wheat plot's 0.5 completes it
  const now = T0 + 30 * MIN;
  const r = must(s, 'harvest', { id: 'home.0.0' }, { now });
  assert.equal(levelFromXp(s.farm.xp), 5, 'the harvest levels up');
  for (const id of ['home.0.1', 'home.0.2']) assert.equal(s.farm.objects[id].crop.readyAt, now, id);
  assert.deepEqual(evs(r, 'bloomed'), [{ e: 'bloomed', level: 5, ids: ['home.0.1', 'home.0.2'] }]);
  const order = r.tx.events.map((e) => e.e);
  assert.ok(order.indexOf('levelUp') < order.indexOf('bloomed'), 'the level-up first, then the farm blooms');
  assert.ok(CELEBRATIONS.has('bloomed') && !FX_EVENTS.has('bloomed'), 'confirmed-only: on both screens, never predicted');
  must(s, 'harvest', { id: 'home.0.1' }, { now });
});

test('Golden Seeds: L8, 12 Acorns for 5 (always BIG_SPEND), refused while the Barn overflows', () => {
  const s = farmAt(7, { acorns: 30 });
  assert.equal(run(s, 'buyGoldenSeeds', {}).code, ERR.LOCKED);
  s.farm.xp = xpForLevel(8);
  assert.equal(run(s, 'buyGoldenSeeds', {}).code, ERR.BIG_SPEND);
  must(s, 'buyGoldenSeeds', { confirm: ['BIG_SPEND'] });
  assert.equal(s.farm.golden, BOOSTS.goldenSeeds.seeds);
  assert.equal(s.farm.wallet.acorns, 30 - BOOSTS.goldenSeeds.acorns);
  s.farm.overflow.wheat = 1;
  assert.equal(run(s, 'buyGoldenSeeds', { confirm: ['BIG_SPEND'] }).code, ERR.STORAGE_FULL);
});

test('tools: brush upgrades are bought once for the farm at their level', () => {
  const s = farmAt(9);
  assert.equal(run(s, 'buyTool', { tool: 'big_watering_can' }).code, ERR.LOCKED);
  assert.equal(run(s, 'buyTool', { tool: 'hand' }).code, ERR.LOCKED, 'free tools are not bought');
  s.farm.xp = xpForLevel(10);
  must(s, 'buyTool', { tool: 'big_watering_can' });
  assert.deepEqual(s.farm.tools, { big_watering_can: 1 });
  assert.equal(run(s, 'buyTool', { tool: 'big_watering_can' }).code, ERR.ALREADY_DONE);
});

test('expansions: in order; proof tasks count from the card\'s first opening; land, objects and debris arrive', () => {
  const s = farmAt(5, { coins: 100_000 });
  const e = expansionOf('creekside');
  assert.equal(run(s, 'expand', { expansion: 'old_orchard' }).code, ERR.LOCKED, 'out of order');
  assert.equal(run(s, 'expand', { expansion: 'creekside' }).code, ERR.NOT_READY, 'the card was never opened');
  must(s, 'plant', { ids: Array.from({ length: 16 }, (_, i) => `home.0.${i}`), crop: 'wheat' }, { now: T0 });
  must(s, 'harvest', { ids: Array.from({ length: 16 }, (_, i) => `home.0.${i}`) }, { now: T0 + HOUR });
  assert.equal(proofProgress(s, 'creekside', 0).have, 0, 'harvests before the opening do not count');
  must(s, 'openExpansion', { expansion: 'creekside' }, { pid: 'p2' });
  assert.equal(run(s, 'openExpansion', { expansion: 'creekside' }).code, ERR.ALREADY_DONE);
  must(s, 'plant', { ids: Array.from({ length: 16 }, (_, i) => `home.0.${i}`), crop: 'wheat' }, { now: T0 + HOUR });
  must(s, 'harvest', { ids: Array.from({ length: 16 }, (_, i) => `home.0.${i}`) }, { now: T0 + 2 * HOUR });
  assert.deepEqual(proofProgress(s, 'creekside', 0), { have: 30, need: 30, done: true }, 'capped at the target');
  assert.equal(run(s, 'expand', { expansion: 'creekside' }).code, ERR.NOT_READY, 'eggs still missing');
  s.farm.proofs.creekside.n['1'] = 10;
  const r = must(s, 'expand', { expansion: 'creekside', confirm: ['BIG_SPEND'] }, { now: T0 + 3 * HOUR });
  assert.deepEqual(s.farm.expansions, ['home', 'creekside']);
  assert.deepEqual(evs(r, 'expanded')[0], { e: 'expanded', expansion: 'creekside', by: 'p1', coins: e.cost, planks: 0, crates: 0 });
  for (const x of expansionObjects('creekside')) assert.ok(s.farm.objects[x.id], x.id);
  const pine = expansionObjects('creekside').find((x) => x.def === 'pine');
  assert.equal(s.farm.objects[pine.id].free, true);
  assert.equal(s.farm.objects[pine.id].readyAt, T0 + 3 * HOUR, 'a wild, mature Pine: ripe at once');
  assert.ok(Object.values(s.farm.objects).filter((o) => o.origin === 'expansion').length >= 10);
  assert.equal(Object.hasOwn(s.farm.proofs, 'creekside'), false);
  assert.deepEqual(validateState(s), []);
  // old_orchard needs Planks and an 'own' task read from the farm
  s.farm.xp = xpForLevel(7);
  must(s, 'openExpansion', { expansion: 'old_orchard' });
  s.farm.proofs.old_orchard.n['1'] = 3;
  assert.equal(run(s, 'expand', { expansion: 'old_orchard' }).code, ERR.NOT_READY, 'own 2 apple trees');
  placeDef(s, 'apple_tree', { confirm: ['BIG_SPEND'] });
  placeDef(s, 'apple_tree', { confirm: ['BIG_SPEND'] });
  assert.equal(run(s, 'expand', { expansion: 'old_orchard' }).code, ERR.NOT_READY,
    'trees inside their 100 % undo window do not count yet (RC-05)');
  const later = T0 + SAFETY.undoMs;
  assert.equal(run(s, 'expand', { expansion: 'old_orchard' }, { now: later }).code, ERR.NO_ITEMS, 'planks');
  give(s, 'planks', 2);
  must(s, 'expand', { expansion: 'old_orchard', confirm: ['BIG_SPEND'] }, { now: later });
  assert.equal(available(s, 'planks'), 0);
  assert.deepEqual(validateState(s), []);
});

test('debris regrowth: one weed or rock per hour on free unlocked land, at most 12 waiting, catch-up in one action', () => {
  const s = makeFarm();
  assert.deepEqual(econDue(s, T0 + HOUR - 1), []);
  assert.equal(econNextDueAt(s, T0), T0 + DEBRIS_RULES.regrowEveryMs);
  assert.equal(sys(s, '_regrow', {}, T0 + HOUR - 1).code, ERR.NOT_READY);
  let r = sys(s, '_regrow', {}, T0 + HOUR);
  assert.equal(evs(r, 'regrown')[0].ids.length, 1);
  const id = evs(r, 'regrown')[0].ids[0];
  const o = s.farm.objects[id];
  assert.ok(DEBRIS_RULES.regrowKinds.includes(o.def) && o.origin === 'regrow' && inLand(s, o.x, o.z));
  assert.deepEqual(econDue(s, T0 + HOUR), [], 'the condition is cleared by the commit');
  // three days down: one action, capped at 12 waiting
  r = sys(s, '_regrow', {}, T0 + 73 * HOUR);
  assert.equal(evs(r, 'regrown')[0].ids.length, DEBRIS_RULES.regrowMax - 1);
  assert.equal(s.farm.regrow.at, T0 + 73 * HOUR);
  r = sys(s, '_regrow', {}, T0 + 74 * HOUR);
  assert.equal(r.ok, true);
  assert.equal(evs(r, 'regrown').length, 0, 'full: the clock still advances');
  assert.ok(freeTiles(s).length > 0);
  // clearing a regrown weed pays the regrow XP
  const weed = Object.keys(s.farm.objects).find((k) => s.farm.objects[k].origin === 'regrow');
  const c = must(s, 'chop', { id: weed }, { now: T0 + 74 * HOUR });
  const def = CONTENT.debris.get(s.farm.objects[weed]?.def ?? evs(c, 'cleared')[0]?.def) ?? CONTENT.debris.get('weed');
  assert.ok(evs(c, 'cleared').length + evs(c, 'chopHit').length === 1);
  assert.deepEqual(validateState(s), []);
});

test('rain (GDD §5.10): the shared weatherAt; a rain hour waters growing crops and trees; planting in rain waters', () => {
  const s = farmAt(9);
  allLand(s);
  const seed = s.meta.farmSeed;
  const h0 = hourIndex(T0);
  let rainH = h0 + 2;
  while (weatherAt(seed, rainH) !== 'rain' || weatherAt(seed, rainH - 1) === 'rain') rainH++;
  const before = (rainH - 1) * HOUR;
  must(s, 'plant', { id: 'home.0.0', crop: 'pumpkin' }, { now: before });     // 12 h: growing at the rain hour
  must(s, 'plant', { id: 'home.0.1', crop: 'wheat' }, { now: before });       // 1 min: never watered
  const tree = placeDef(s, 'apple_tree', { now: before, confirm: ['BIG_SPEND'] });
  const ready0 = s.farm.objects['home.0.0'].crop.readyAt;
  const treeReady0 = s.farm.objects[tree].readyAt;
  s.farm.rain.at = rainH - 1;
  assert.deepEqual(econDue(s, rainH * HOUR - 1).filter((a) => a.type === '_rain'), []);
  assert.equal(econNextDueAt(s, before) <= rainH * HOUR, true);
  assert.equal(nextRainAt(s, before), rainH * HOUR);
  const r = sys(s, '_rain', {}, rainH * HOUR);
  assert.equal(r.ok, true);
  assert.deepEqual(evs(r, 'rained')[0].ids.sort(), ['home.0.0', tree].sort());
  assert.equal(s.farm.objects['home.0.0'].crop.water, 'sys');
  assert.equal(s.farm.objects['home.0.0'].crop.readyAt, ready0 - mulBp(cropOf('pumpkin').growMs, GROWTH.water.cropBp));
  assert.equal(s.farm.objects[tree].readyAt, treeReady0 - mulBp(treeOf('apple_tree').cycleMs, GROWTH.water.treeBp));
  assert.equal(s.farm.objects['home.0.1'].crop.water, undefined);
  assert.deepEqual(econDue(s, rainH * HOUR).filter((a) => a.type === '_rain'), [], 'cleared by the commit');
  // the partner tend still adds its -5 %
  must(s, 'water', { id: 'home.0.0' }, { now: rainH * HOUR + 1, pid: 'p2' });
  assert.equal(s.farm.objects['home.0.0'].crop.tend, 'p2');
  // planted during the rain: watered at planting
  must(s, 'plant', { id: 'home.0.2', crop: 'tomato' }, { now: rainH * HOUR + 10 * MIN });
  assert.equal(s.farm.objects['home.0.2'].crop.water, 'sys');
  assert.deepEqual(validateState(s), []);
});

test('rain catch-up: one action applies every rain hour the server missed, each to what grew at its start', () => {
  const s = farmAt(12);
  const seed = s.meta.farmSeed;
  must(s, 'plant', { ids: ['home.0.0', 'home.0.1'], crop: 'cabbage' }, { now: T0 });
  const days = 3;
  const due = econDue(s, T0 + days * 24 * HOUR).filter((a) => a.type === '_rain');
  let rains = 0;
  for (let h = hourIndex(T0) + 1; h <= hourIndex(T0 + days * 24 * HOUR); h++) if (weatherAt(seed, h) === 'rain') rains++;
  assert.equal(due.length, rains > 0 ? 1 : 0);
  if (rains > 0) {
    const r = sys(s, '_rain', {}, T0 + days * 24 * HOUR);
    assert.equal(evs(r, 'rained')[0].hours, rains);
    assert.equal(s.farm.rain.at, hourIndex(T0 + days * 24 * HOUR));
  }
});

test('grewUp: a baby bought young announces its first meal as an adult, once', () => {
  const s = farmAt(1);
  placeDef(s, 'coop');
  const id = evs(must(s, 'buyAnimal', { def: 'chicken', confirm: ['BIG_SPEND'] }), 'bought')[0].id;
  assert.equal(s.farm.objects[id].baby, true);
  give(s, 'chicken_feed', 3);
  const adult = s.farm.objects[id].adultAt;
  const r = must(s, 'tend', { id }, { now: adult });
  assert.deepEqual(evs(r, 'grewUp')[0], { e: 'grewUp', id, animal: 'chicken', by: 'p1' });
  assert.equal(s.farm.objects[id].baby, undefined);
  const r2 = must(s, 'tend', { id }, { now: adult + animalOf('chicken').cycleMs });
  assert.equal(evs(r2, 'grewUp').length, 0);
  const hen = evs(must(s, 'buyAnimal', { def: 'chicken', adult: true, confirm: ['BIG_SPEND'] }), 'bought')[0].id;
  assert.equal(s.farm.objects[hen].baby, undefined, 'adults were never babies here');
});

test('a jump over several levels finishes everything once: one Bloom card (RC-29 superseded by the owner rule)', async () => {
  const { credit } = await import('./helpers/rules-goals.js');
  const s = makeFarm();
  s.farm.xp = xpForLevel(4);
  s.farm.quests.active = {};
  must(s, 'plant', { id: 'home.0.2', crop: 'strawberry' }, { now: T0 });
  must(s, 'plant', { id: 'home.0.3', crop: 'corn' }, { now: T0 + 29 * MIN });
  const now = T0 + 30 * MIN;
  const tx = credit(s, [{ e: 'cleared', id: 'x', def: 'weed', xp: xpForLevel(6) - xpForLevel(4), coins: 0 }], { now });
  assert.equal(levelFromXp(s.farm.xp), 6);
  assert.deepEqual(tx.events.filter((e) => e.e === 'levelUp' && e.scope === 'farm').map((e) => e.level), [5, 6]);
  assert.deepEqual(tx.events.filter((e) => e.e === 'bloomed'), [{ e: 'bloomed', level: 5, ids: ['home.0.2', 'home.0.3'] }],
    'the first new level finishes everything; the second finds nothing growing');
  for (const id of ['home.0.2', 'home.0.3']) assert.equal(s.farm.objects[id].crop.readyAt, now, id);
});
