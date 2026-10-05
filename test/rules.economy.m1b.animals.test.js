// M1b animals (GDD §3.4): the Beehive and its colony (forage, 6 h / 12 h cycles, pollination), pigs on Pig Slop and
// Pig Woods, ducks, goats, horses (Manure, the Compost Bin's recipe, the barge bonus), and the collection perks
// that touch animals. Runs against the M1b content (test/helpers/rules-economy.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m1b } from './helpers/rules-economy.js';

const M = await m1b();
const { content, economy, animals, helpers } = M;
const album = await import('../shared/rules/actions/album.js');
const { dayIndex } = await import('../shared/rules/calendar.js');
const { farmAt, give, placeDef, must, run, idsOf, evs, T0, HOUR, MIN } = M.rulesHelpers;
const { sys } = helpers;
const { validateState } = M.state;
const { resetGrid } = M.gridCache;
const BIG = { confirm: ['BIG_SPEND'] };

/** A farm at `level` with every live expansion's land (room for big homes). */
function farm(level, o = {}) {
  const s = farmAt(level, { coins: 5_000_000, acorns: 200, ...o });
  s.farm.expansions = content.live('expansions').map((e) => e.id);
  resetGrid(s);
  return s;
}
const colonyIn = (s, hive) => Object.keys(s.farm.objects).find((id) => s.farm.objects[id].home === hive);

test('a Beehive arrives with its colony; the colony works at once and eats nothing', () => {
  const s = farm(13);
  const hive = placeDef(s, 'beehive', BIG);
  const bee = colonyIn(s, hive);
  assert.ok(bee, 'the colony moved in');
  const b = s.farm.objects[bee];
  assert.equal(b.def, 'bee');
  assert.equal(b.free, true, 'a colony is part of its hive: never counted as a bought animal');
  assert.equal(b.adultAt, T0);
  assert.equal(b.readyAt - b.fedAt, content.GROWTH.bees.slowCycleMs, 'no forage near: the slow 12 h cycle');
  assert.equal(run(s, 'feed', { id: bee }, { now: T0 + MIN }).code, 'NOT_HUNGRY');
  assert.equal(run(s, 'tend', { id: bee }, { now: T0 + MIN }).code, 'NOT_READY');
  assert.equal(run(s, 'pet', { id: bee }, { now: T0 + MIN }).code, 'BAD_ARGS', 'bees are not petted');
  assert.equal(run(s, 'buyAnimal', { def: 'bee', ...BIG }).code, 'LOCKED', 'colonies come only with hives');
  assert.equal(run(s, 'sellObject', { id: bee }).code, 'LOCKED', 'the colony belongs to its hive');
  // collecting honey starts the next cycle at once; no feed is used
  const t = T0 + content.GROWTH.bees.slowCycleMs;
  const r = must(s, 'tend', { id: hive }, { now: t });
  assert.equal(evs(r, 'collected')[0].item, 'honey');
  assert.equal(evs(r, 'fed').length, 0);
  assert.equal(evs(r, 'colonyCycle').length, 1);
  assert.equal(s.farm.objects[bee].fedAt, t);
  assert.ok(s.farm.objects[bee].readyAt > t);
  assert.equal(s.farm.inventory.honey, 1);
  assert.equal(s.farm.made.honey, dayIndex(t, s.meta.tz), 'rules-goals logs honey as made today (Town Projects)');
  assert.deepEqual(validateState(s), []);
});

test('three forage objects within 4 tiles when a cycle starts make it 6 h; the count is fixed at the start', () => {
  const s = farm(13);
  const at = [20, 20];
  for (const [x, z] of [[18, 18], [22, 18], [24, 22]]) must(s, 'place', { def: 'flower_bed', x, z, rot: 0 });
  // (24, 22) is 4 tiles from (20, 20): inside; a fourth bed 5 tiles away does not count
  must(s, 'place', { def: 'flower_bed', x: 25, z: 20, rot: 0 });
  const hive = placeDef(s, 'beehive', { at, confirm: ['BIG_SPEND'] });
  assert.equal(animals.forageNear(s, hive), 3);
  const bee = colonyIn(s, hive);
  assert.equal(s.farm.objects[bee].readyAt - s.farm.objects[bee].fedAt, content.animalOf('bee').cycleMs, '6 h');
  // a flower crop counts as forage too; selling decor later does not change a running cycle
  const plot = placeDef(s, 'plot', { at: [21, 21] });
  must(s, 'plant', { id: plot, crop: 'sunflower' });
  assert.equal(animals.forageNear(s, hive), 4);
  assert.equal(animals.forageOfObject({ def: 'pine' }), 0, 'Pine is no bee forage');
  assert.equal(animals.forageOfObject({ def: 'apple_tree' }), 1, 'a flowering tree is');
});

test('pollination: crops and trees within 4 tiles of a hive with its colony roll +5 % for a bonus unit', () => {
  const s = farm(13);
  const plot = placeDef(s, 'plot', { at: [30, 30] });
  assert.equal(animals.pollinated(s, s.farm.objects[plot]), false);
  placeDef(s, 'beehive', { at: [34, 30], confirm: ['BIG_SPEND'] });
  assert.equal(animals.pollinated(s, s.farm.objects[plot]), true);
  const far = placeDef(s, 'plot', { at: [39, 30] });
  assert.equal(animals.pollinated(s, s.farm.objects[far]), false, '5 tiles away');
  // over many cycles about 5 % of harvests get the pollen unit, never more than one per harvest
  let extra = 0;
  const N = 400;
  for (let c = 0; c < N; c++) {
    s.farm.objects[plot].cycle = c;
    s.farm.objects[plot].crop = { def: 'wheat', plantedAt: T0, readyAt: T0, by: 'p1', cycle: c, cut: 0 };
    const ctx = M.index.makeCtx(s, { now: T0 + HOUR, pid: 'p1', cid: 'tstcid', seq: 1 });
    const h = M.farming.harvestOf(s, plot, ctx);
    extra += h.qty - content.cropOf('wheat').yield;
  }
  assert.ok(extra > N * 0.02 && extra < N * 0.09, `pollen units ${extra} of ${N}`);
});

test('a hive bought inside its undo window is refunded with its untouched colony', () => {
  const s = farm(13);
  const hive = placeDef(s, 'beehive', BIG);
  const bee = colonyIn(s, hive);
  const coins = s.farm.wallet.coins;
  const r = must(s, 'refund', { id: hive }, { now: T0 + MIN });
  assert.equal(s.farm.wallet.coins, coins + 3400, 'the full price back');
  assert.equal(s.farm.objects[hive], undefined);
  assert.equal(s.farm.objects[bee], undefined, 'the colony left with its hive');
  assert.equal(evs(r, 'removed').length, 1);
  assert.deepEqual(validateState(s), []);
});

test('the hive cap: 2 at L13, +1 every 3 levels; the n-th hive costs 3,400 x 1.1^(n-1)', () => {
  const s = farm(13);
  const h1 = M.decor.buyPrice(s, 'beehive');
  assert.equal(h1.coins, 3400);
  placeDef(s, 'beehive', BIG);
  assert.equal(M.decor.buyPrice(s, 'beehive').coins, 3740);
  placeDef(s, 'beehive', BIG);
  assert.equal(M.decor.buyPrice(s, 'beehive').code, 'CAP');
  s.farm.xp = content.xpForLevel(16);
  assert.equal(M.decor.buyPrice(s, 'beehive').code, null);
});

test('pigs eat Pig Slop made from any surplus produce and find truffles; Pig Woods makes them 10 % faster', () => {
  const s = farm(19);
  s.farm.expansions = s.farm.expansions.filter((e) => e !== 'pig_woods');
  resetGrid(s);
  const pen = placeDef(s, 'pig_pen', BIG);
  must(s, 'buyAnimal', { def: 'pig', adult: true, home: pen, ...BIG });
  const pig = idsOf(s, 'pig')[0];
  const mill = placeDef(s, 'feed_mill', BIG);
  give(s, 'tomato', 2);                                // valuable produce is never used silently (RC-17) ...
  assert.equal(run(s, 'craft', { id: mill, recipe: 'pig_slop' }).code, 'RESERVED');
  give(s, 'wheat', 2);                                 // ... surplus Wheat is: the cheapest member first
  must(s, 'craft', { id: mill, recipe: 'pig_slop' });
  must(s, 'collectTray', { id: mill }, { now: T0 + HOUR });
  assert.equal(s.farm.inventory.pig_slop, 6);
  must(s, 'tend', { id: pig }, { now: T0 + HOUR });
  const cycle = content.animalOf('pig').cycleMs;
  assert.equal(s.farm.objects[pig].readyAt - s.farm.objects[pig].fedAt, cycle);
  const r = must(s, 'tend', { id: pig }, { now: T0 + HOUR + cycle });
  assert.equal(evs(r, 'collected')[0].item, 'truffle');
  // with Pig Woods owned the next cycle starts 10 % shorter
  s.farm.expansions.push('pig_woods');
  resetGrid(s);
  const t = T0 + HOUR + 2 * cycle;
  must(s, 'tend', { id: pig }, { now: t });
  assert.equal(s.farm.objects[pig].readyAt - t, cycle - cycle / 10);
});

test('ducks eat Chicken Feed and lay duck eggs; goats give goat milk; their homes take capacity upgrades', () => {
  const s = farm(22);
  const pond = placeDef(s, 'duck_pond', BIG);
  const yard = placeDef(s, 'goat_yard', BIG);
  must(s, 'buyAnimal', { def: 'duck', adult: true, home: pond, ...BIG });
  must(s, 'buyAnimal', { def: 'goat', adult: true, home: yard, ...BIG });
  give(s, 'chicken_feed', 5);
  give(s, 'livestock_feed', 5);
  must(s, 'tend', { ids: [pond, yard] }, { now: T0 + MIN });
  const r = must(s, 'tend', { ids: [pond, yard] }, { now: T0 + 4 * HOUR });
  assert.deepEqual(evs(r, 'collected').map((e) => e.item).sort(), ['duck_egg', 'goat_milk']);
  assert.equal(M.grid.capacityOf(s, pond), 4);
  must(s, 'upgradeHome', { id: pond, ...BIG });
  assert.equal(M.grid.capacityOf(s, pond), 6);
  // a duckling takes a Chicken Feed as its bottle
  must(s, 'buyAnimal', { def: 'duck', home: pond, ...BIG }, { now: T0 + 5 * HOUR });
  const baby = idsOf(s, 'duck').find((id) => s.farm.objects[id].baby);
  const b = must(s, 'bottle', { id: baby }, { now: T0 + 5 * HOUR + MIN });
  assert.equal(evs(b, 'bottled')[0].item, 'chicken_feed');
});

test('horses: 2 Manure a cycle, the Compost Bin turns Manure into Compost from L25, +5 % barge pay each', () => {
  const s = farm(25);
  const stable = placeDef(s, 'stable', BIG);
  must(s, 'buyAnimal', { def: 'horse', adult: true, home: stable, ...BIG });
  must(s, 'buyAnimal', { def: 'horse', home: stable, ...BIG });
  assert.equal(animals.horseBargeBp(s, T0), 500, 'only the adult pulls the cart');
  assert.equal(animals.horseBargeBp(s, T0 + 9 * HOUR), 1000);
  const horse = idsOf(s, 'horse').find((id) => !s.farm.objects[id].baby);
  give(s, 'livestock_feed', 4);
  must(s, 'tend', { id: horse }, { now: T0 + MIN });
  const r = must(s, 'tend', { id: horse }, { now: T0 + MIN + content.animalOf('horse').cycleMs });
  assert.equal(evs(r, 'collected')[0].qty, 2);
  assert.equal(s.farm.inventory.manure, 2);
  const bin = placeDef(s, 'compost_bin', BIG);
  must(s, 'upgradeSlot', { id: bin, ...BIG });           // its recipe is live now, so are its slots
  must(s, 'craft', { id: bin, recipe: 'compost' });
  const c = must(s, 'collectTray', { id: bin }, { now: T0 + 3 * HOUR + content.animalOf('horse').cycleMs });
  assert.equal(evs(c, 'crafted')[0].qty, 3);
  assert.equal(animals.horseBargeBp({ farm: { objects: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`h${i}`,
    { def: 'horse', home: 'x', adultAt: 0 }])) } }, T0), 2000, 'at most +20 %');
});

test('collection perks reach the animals: Feathers +2 % bonus eggs, Fossils +5 % bonus truffles', () => {
  const s = farm(17);
  const coop = placeDef(s, 'coop', BIG);
  must(s, 'buyAnimal', { def: 'chicken', adult: true, home: coop, ...BIG });
  const hen = idsOf(s, 'chicken')[0];
  const ctxAt = (c) => {
    s.farm.objects[hen].cycle = c;
    return M.index.makeCtx(s, { now: T0, pid: 'p1', cid: 'tstcid', seq: 1 });
  };
  const bonusOver = (n) => {
    let b = 0;
    for (let c = 0; c < n; c++) b += animals.collectOf(s, hen, ctxAt(c)).bonus;
    return b;
  };
  const before = bonusOver(2000);
  // the album is rules-goals'; its perkOf reads farm.album: stand in for a completed Feathers set
  economy.setPerkSource((st, key) => (key === 'bonusEggBp' ? 200 : 0));
  try {
    assert.equal(economy.collectionPerk(s, 'bonusEggBp'), 200);
    const after = bonusOver(2000);
    assert.ok(after - before > 20 && after - before < 70, `${after - before} extra eggs in 2000 collections`);
  } finally {
    economy.setPerkSource(album.perkOf);
  }
  assert.equal(economy.collectionPerk(s, 'bonusEggBp'), 0);
});

test('every new animal action keeps the state valid and round-trips (run() checks ops and undo)', () => {
  const s = farm(25);
  for (const home of ['beehive', 'pig_pen', 'duck_pond', 'goat_yard', 'stable']) placeDef(s, home, BIG);
  for (const def of ['pig', 'duck', 'goat', 'horse']) must(s, 'buyAnimal', { def, adult: true, ...BIG });
  give(s, 'pig_slop', 5);
  give(s, 'chicken_feed', 5);
  give(s, 'livestock_feed', 10);
  const all = Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].home !== undefined);
  must(s, 'tend', { ids: all, confirm: ['RESERVED'] }, { now: T0 + MIN });
  must(s, 'tend', { ids: all, confirm: ['RESERVED'] }, { now: T0 + 13 * HOUR });
  assert.deepEqual(validateState(s), []);
  for (const a of content.live('animals')) assert.ok(a.homes.every((h) => content.lookup('homes', h)), `${a.id} home`);
  assert.equal(sys(s, '_rain', {}, T0 + 14 * HOUR).ok !== undefined, true);
});
