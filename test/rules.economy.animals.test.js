// Animals (GDD §3.4 rules 1-9, §6.2 #13, §9 #5, #33, #52): homes and capacity, buying babies and adults at the
// n-th price, tend / feed / collect, bottles, petting, blue ribbons with their goods, the Compost Bin's points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { animalOf, defOf, GROWTH, COOP, MARKET, SAFETY } from '../shared/content/index.js';
import { validateState } from '../shared/rules/state.js';
import { capacityOf, occupantsOf, homeMaxOf } from '../shared/rules/grid.js';
import { animalPrice, collectOf, giveAnimals, homeGrowth } from '../shared/rules/actions/animals.js';
import { grow, mulBp, available } from '../shared/rules/economy.js';
import { makeCtx } from '../shared/rules/index.js';
import { roll } from '../shared/rules/rng.js';
import { Tx } from '../shared/rules/tx.js';
import { run, must, T0, farmAt, give, placeDef, evs, allLand, ledgerBalanced, MIN, HOUR } from './helpers/rules.js';

const HEN = animalOf('chicken');

function coopFarm(level = 1, n = 0, { adult = true } = {}) {
  const s = farmAt(level);
  allLand(s);
  const coop = placeDef(s, 'coop');
  const hens = [];
  for (let i = 0; i < n; i++) {
    const r = must(s, 'buyAnimal', { def: 'chicken', adult, home: coop, confirm: ['BIG_SPEND'] });
    hens.push(evs(r, 'bought')[0].id);
  }
  return { s, coop, hens };
}

test('buyAnimal: into a home with room, n-th price x 1.1^(n-1), adults 1.6 x; capacity and home checks', () => {
  const { s, coop } = coopFarm(1);
  const prices = [];
  for (let i = 0; i < HEN.homes.length + 5; i++) {
    prices.push(animalPrice(s, 'chicken', false));
    must(s, 'buyAnimal', { def: 'chicken', confirm: ['BIG_SPEND'] });
  }
  // the first bought hen has its own price (RC-28: it repays in 7 collections), then the curve from the normal one
  assert.deepEqual(prices, [HEN.first.baby, ...[2, 3, 4, 5, 6].map((n) => grow(HEN.baby, HEN.growthBp, n))]);
  assert.ok(HEN.first.baby < HEN.baby && HEN.first.adult < HEN.adult);
  assert.equal(occupantsOf(s, coop).length, capacityOf(s, coop));
  // wave 4b (owner wish 3): a full home takes one more room step with the purchase, its price folded in (no CAP until
  // the home is full grown: test/rules.w4b.test.js)
  const step = homeGrowth(s, coop);
  const c0 = s.farm.wallet.coins;
  const r7 = must(s, 'buyAnimal', { def: 'chicken', confirm: ['BIG_SPEND'] });
  assert.equal(c0 - s.farm.wallet.coins, grow(HEN.baby, HEN.growthBp, 7) + step.coins);
  assert.equal(evs(r7, 'homeGrew')[0].capacity, defOf('coop').capacity + defOf('coop').upgradeStep);
  assert.equal(run(s, 'buyAnimal', { def: 'chicken', home: 'home.0.0' }).code, ERR.NOT_FOUND, 'a plot is no coop');
  assert.equal(run(s, 'buyAnimal', { def: 'cow' }).code, ERR.LOCKED);
  assert.equal(animalPrice(s, 'chicken', true), grow(HEN.adult, HEN.growthBp, 8));
  assert.deepEqual(validateState(s), []);
});

test('buyAnimal without a home: NOT_FOUND; the receipt is an undo while the animal was never fed', () => {
  const s = farmAt(1);
  assert.equal(run(s, 'buyAnimal', { def: 'chicken' }).code, ERR.NOT_FOUND);
  placeDef(s, 'coop');
  const c0 = s.farm.wallet.coins;
  const r = must(s, 'buyAnimal', { def: 'chicken' });
  const id = evs(r, 'bought')[0].id;
  must(s, 'refund', { id });
  assert.equal(s.farm.wallet.coins, c0);
});

test('babies grow on their own; a bottle (chicks: Chicken Feed) cuts 30 % of what remains', () => {
  const { s, hens: [id] } = coopFarm(1, 1, { adult: false });
  const o = s.farm.objects[id];
  assert.equal(o.adultAt, T0 + HEN.babyMs);
  assert.equal(run(s, 'tend', { id }, { now: T0 + MIN }).code, ERR.NOT_READY, 'babies only grow');
  assert.equal(run(s, 'bottle', { id }, { now: T0 + MIN }).code, ERR.NO_ITEMS);
  give(s, 'chicken_feed', 1);
  const r = must(s, 'bottle', { id }, { now: T0 + MIN });
  const saved = mulBp(T0 + HEN.babyMs - (T0 + MIN), GROWTH.babyBottle.bp);
  assert.equal(s.farm.objects[id].adultAt, T0 + HEN.babyMs - saved);
  assert.equal(evs(r, 'bottled')[0].savedMs, saved);
  assert.equal(run(s, 'bottle', { id }, { now: T0 + HEN.babyMs }).code, ERR.ALREADY_DONE, 'adults take no bottle');
});

test('bottles: one per baby per player per hour, never below 50 % of the growth, no feed used at the floor (RC-03)',
  () => {
    const { s, hens: [id] } = coopFarm(1, 1, { adult: false });
    give(s, 'chicken_feed', 20);
    must(s, 'bottle', { id }, { pid: 'p1', now: T0 + 1 });
    assert.equal(run(s, 'bottle', { id }, { pid: 'p1', now: T0 + 2 }).code, ERR.COOLDOWN, 'one an hour per player');
    must(s, 'bottle', { id }, { pid: 'p2', now: T0 + 3 });
    // spam through the hours of a calf-length growth: the chick never grows faster than half its time
    for (let t = T0 + 3_600_000; t < T0 + 6 * 3_600_000; t += 3_600_000) {
      for (const pid of ['p1', 'p2']) run(s, 'bottle', { id }, { pid, now: t });
    }
    assert.ok(s.farm.objects[id].adultAt - T0 >= HEN.babyMs / 2, 'the 50 % floor holds');
    // a long baby: two players bottling every hour still need half of the growth
    const calf = farmAt(7);
    allLand(calf);
    const pen = placeDef(calf, 'cow_barn');
    const bought = must(calf, 'buyAnimal', { def: 'cow', home: pen, confirm: ['BIG_SPEND'] }, { now: T0 });
    const c = evs(bought, 'bought')[0].id;
    give(calf, 'baby_bottle', 20);
    let used = 0;
    for (let t = T0 + 1; t < T0 + animalOf('cow').babyMs; t += 3_600_000) {
      for (const pid of ['p1', 'p2']) if (run(calf, 'bottle', { id: c }, { pid, now: t }).ok) used++;
    }
    assert.ok(calf.farm.objects[c].adultAt - T0 >= animalOf('cow').babyMs / 2, 'a calf never matures before 60 min');
    const left = available(calf, 'baby_bottle');
    assert.equal(left, 20 - used, 'a refused bottle consumes nothing');
  });

test('tend: feed starts the cycle, the product waits on the animal, collect + re-feed in one click', () => {
  const { s, coop, hens: [id] } = coopFarm(1, 1);
  assert.equal(run(s, 'tend', { id }).code, ERR.NO_ITEMS, 'hungry and no feed');
  give(s, 'chicken_feed', 2);
  let r = must(s, 'tend', { id }, { now: T0 });
  assert.equal(s.farm.objects[id].readyAt, T0 + HEN.cycleMs);
  assert.equal(evs(r, 'fed').length, 1);
  assert.equal(run(s, 'tend', { id }, { now: T0 + HEN.cycleMs - 251 }).code, ERR.NOT_READY);
  assert.equal(run(s, 'feed', { id }, { now: T0 + HEN.cycleMs }).code, ERR.NOT_HUNGRY);
  r = must(s, 'tend', { id: coop }, { now: T0 + HEN.cycleMs + HOUR * 30 });   // a pen stroke: the home's animals
  const c = evs(r, 'collected')[0];
  assert.equal(c.item, 'egg');
  assert.ok(c.qty >= HEN.out);
  assert.equal(c.xp, HEN.xp);
  assert.equal(s.farm.inventory.egg, c.qty);
  assert.equal(evs(r, 'fed').length, 1, 're-fed in the same click');
  assert.equal(s.farm.objects[id].cycle, 1);
  r = must(s, 'collect', { id }, { now: T0 + HEN.cycleMs * 3 + HOUR * 30 });
  assert.equal(evs(r, 'fed').length, 0, 'collect only (split tending)');
  assert.equal(s.farm.objects[id].readyAt, null);
  assert.deepEqual(validateState(s), []);
});

test('tend stroke: partial success, feed below Keep N asks RESERVED once for the whole stroke', () => {
  const { s, hens } = coopFarm(1, 3);
  give(s, 'chicken_feed', 3);
  must(s, 'keep', { item: 'chicken_feed', n: 2 }, { pid: 'p2' });
  assert.equal(run(s, 'tend', { ids: hens }).code, ERR.RESERVED);
  const r = must(s, 'tend', { ids: hens, confirm: ['RESERVED'] });
  assert.equal(evs(r, 'fed').length, 3);
  assert.equal(s.farm.inventory.chicken_feed, undefined);
  give(s, 'chicken_feed', 1);
  must(s, 'keep', { item: 'chicken_feed', n: 0 }, { pid: 'p2' });
  const r2 = must(s, 'tend', { ids: hens }, { now: T0 + HEN.cycleMs });
  assert.equal(evs(r2, 'collected').length, 3);
  assert.equal(evs(r2, 'fed').length, 1, 'feed for one; the others collected and wait hungry');
});

test('at 2 x Barn capacity the product waits on the animal (GDD §9 #5)', () => {
  const { s, hens: [id] } = coopFarm(1, 1);
  give(s, 'chicken_feed', 1);
  must(s, 'tend', { id }, { now: T0 });
  s.farm.inventory = { wheat: MARKET.barn.start };
  s.farm.overflow = { wheat: MARKET.barn.start };        // exactly 2 x capacity
  const ready = s.farm.objects[id].readyAt;
  assert.equal(run(s, 'tend', { id }, { now: T0 + HEN.cycleMs }).code, ERR.STORAGE_FULL);
  assert.equal(s.farm.objects[id].readyAt, ready, 'the egg waits; nothing is lost');
  s.farm.overflow.wheat -= 1;
  must(s, 'tend', { id }, { now: T0 + HEN.cycleMs });
  assert.equal(s.farm.overflow.egg >= 1, true, 'above capacity: overflow');
});

test('collect rolls: ★3 double, petting bonus, the prized animal\'s blue-ribbon good; keyed by (id, cycle)', () => {
  const { s, hens: [id] } = coopFarm(12, 1);
  s.farm.mastery.chicken = HEN.mastery[2];
  const o = s.farm.objects[id];
  Object.assign(o, { fedAt: T0, readyAt: T0 + HEN.cycleMs, cycle: HEN.prizedAt });
  let seenGood = false;
  let seenDouble = false;
  for (let cycle = HEN.prizedAt; cycle < HEN.prizedAt + 60; cycle++) {
    o.cycle = cycle;
    const ctx = makeCtx(s, { now: T0 + HEN.cycleMs, pid: 'p1', cid: 'abcdef', seq: 1 });
    const c = collectOf(s, id, ctx);
    const dbl = Math.floor(roll(s.meta.farmSeed, 'double', id, cycle) * 10_000) < 1500;
    const prem = Math.floor(roll(s.meta.farmSeed, 'premium', id, cycle) * 10_000) < GROWTH.prizedAnimal.premiumBp;
    assert.equal(c.qty, HEN.out + (dbl ? HEN.out : 0));
    assert.equal(c.good, prem ? HEN.premium : null);
    seenGood ||= prem;
    seenDouble ||= dbl;
  }
  assert.ok(seenGood && seenDouble);
});

test('petting: a drag pets every animal under it once per player per day; both players = the 20 % chance', () => {
  const { s, coop, hens } = coopFarm(1, 2);
  let r = must(s, 'pet', { id: coop }, { pid: 'p1' });
  assert.deepEqual(evs(r, 'petted')[0].ids, hens);
  assert.equal(run(s, 'pet', { ids: hens }, { pid: 'p1' }).code, ERR.ALREADY_DONE);
  r = must(s, 'pet', { id: hens[0] }, { pid: 'p2' });
  assert.deepEqual(evs(r, 'petted')[0].both, [hens[0]]);
  assert.deepEqual(s.farm.objects[hens[0]].pet.by, ['p1', 'p2']);
  must(s, 'pet', { id: hens[0] }, { pid: 'p1', now: T0 + 24 * HOUR });
  assert.deepEqual(s.farm.objects[hens[0]].pet.by, ['p1'], 'a new day starts over');
  // the pet bonus roll: petted today by both -> COOP.petting.bothBp
  const o = s.farm.objects[hens[1]];
  Object.assign(o, { fedAt: T0, readyAt: T0 + HEN.cycleMs });
  const ctx = makeCtx(s, { now: T0 + HEN.cycleMs, pid: 'p1', cid: 'abcdef', seq: 1 });
  const hit = Math.floor(roll(s.meta.farmSeed, 'pet', hens[1], 0) * 10_000) < COOP.petting.bothBp;
  assert.equal(collectOf(s, hens[1], ctx).bonus >= (hit ? 1 : 0), true);
});

test('prized: the collection that reaches prizedAt emits `prized`; resale returns 100 % of its own price', () => {
  const { s, hens: [id, id2] } = coopFarm(1, 2);
  give(s, 'chicken_feed', 2);
  const o = s.farm.objects[id];
  Object.assign(o, { fedAt: T0, readyAt: T0 + HEN.cycleMs, cycle: HEN.prizedAt - 1 });
  const r = must(s, 'tend', { id }, { now: T0 + HEN.cycleMs });
  assert.equal(evs(r, 'prized').length, 1);
  const paid = s.farm.objects[id].paid.coins;
  const c0 = s.farm.wallet.coins;
  must(s, 'sellObject', { id }, { now: T0 + SAFETY.undoMs + HEN.cycleMs });
  assert.equal(s.farm.wallet.coins, c0 + paid, 'blue ribbon: the price paid for THIS animal (§9 #52)');
  const c1 = s.farm.wallet.coins;
  const paid2 = s.farm.objects[id2].paid.coins;
  must(s, 'tend', { id: id2 }, { now: T0 + SAFETY.undoMs + HEN.cycleMs });     // used: no undo
  must(s, 'sellObject', { id: id2 }, { now: T0 + SAFETY.undoMs + HEN.cycleMs });
  assert.equal(s.farm.wallet.coins, c1 + mulBp(paid2, MARKET.refunds.animalBp));
  assert.ok(ledgerBalanced(s, 1_000_000));
});

test('home capacity upgrades: +2 each up to the max (wave 4b: the growth max), then CAP', () => {
  const { s, coop } = coopFarm(1);
  const def = defOf('coop');
  for (let cap = def.capacity; cap < homeMaxOf(def); cap += def.upgradeStep) {
    assert.equal(capacityOf(s, coop), cap);
    must(s, 'upgradeHome', { id: coop, confirm: ['BIG_SPEND'] });
  }
  assert.equal(capacityOf(s, coop), homeMaxOf(def));
  assert.equal(run(s, 'upgradeHome', { id: coop }).code, ERR.CAP);
  assert.deepEqual(validateState(s), []);
});

test('quest gifts: giveAnimals places free adults into homes with room; the rest waits owed', () => {
  const { s, coop } = coopFarm(1);
  const ctx = makeCtx(s, { now: T0, pid: 'sys', cid: 'sys', seq: 900 });
  const tx = new Tx(s);
  assert.equal(giveAnimals(tx, ctx, 'chicken', 2), 2);
  const gifts = occupantsOf(s, coop).map((id) => s.farm.objects[id]);
  assert.ok(gifts.every((o) => o.free === true && o.adultAt === T0));
  assert.equal(animalPrice(s, 'chicken', false), HEN.first.baby, 'gifts do not raise the n-th price');
  assert.deepEqual(validateState(s), []);
});

test('Compost Bin: one point per animal collection; every 20 drop 3 Compost; holds 3 batches, then points stop', () => {
  const { s, hens } = coopFarm(8, 6);
  const bin = placeDef(s, 'compost_bin', { confirm: ['BIG_SPEND'] });
  const c = defOf('compost_bin').collector;
  let now = T0;
  give(s, 'chicken_feed', 100);
  let drops = 0;
  for (let round = 0; round < 12; round++) {
    const r = must(s, 'tend', { ids: hens, confirm: ['RESERVED'] }, { now });
    drops += evs(r, 'compostPoints').length;
    now += HEN.cycleMs;
  }
  // 11 collection rounds x 6 hens = 66 points: 3 drops (60 points), then the tray is full and points stop
  assert.equal(drops, c.maxBatches);
  assert.equal(s.farm.objects[bin].ready, c.maxBatches * c.out);
  const pts = s.farm.objects[bin].pts;
  must(s, 'tend', { ids: hens, confirm: ['RESERVED'] }, { now });
  assert.equal(s.farm.objects[bin].pts, pts, 'full: no points');
  const c0 = available(s, 'compost');
  const r = must(s, 'collectTray', { id: bin }, { now });
  assert.equal(evs(r, 'crafted')[0].building, 'compost_bin');
  assert.equal(evs(r, 'crafted')[0].qty, c.maxBatches * c.out);
  assert.ok(available(s, 'compost') - c0 >= c.maxBatches * c.out, 'goals rewards may add more in the same action');
  assert.equal(s.farm.objects[bin].ready, 0);
  assert.equal(run(s, 'upgradeSlot', { id: bin }).code, ERR.LOCKED, 'its slots serve the Manure recipe (M2)');
  assert.deepEqual(validateState(s), []);
});

test('an animal with its product waiting cannot be sold or undone: "Collect its Egg first" (RC-22)', () => {
  const s = farmAt(4, { coins: 5000 });
  const coop = placeDef(s, 'coop');
  const r = must(s, 'buyAnimal', { def: 'chicken', home: coop, adult: true, confirm: ['BIG_SPEND'] }, { now: T0 });
  const hen = evs(r, 'bought')[0].id;
  give(s, 'chicken_feed', 2);
  must(s, 'feed', { id: hen }, { now: T0 });
  const later = T0 + 30 * MIN;
  assert.equal(run(s, 'sellObject', { id: hen }, { now: later }).code, ERR.OCCUPIED);
  must(s, 'tend', { id: hen }, { now: later });
  assert.equal(available(s, 'egg') >= 1, true);
  // re-fed: the next egg is not there yet, so the hen can be sold again
  must(s, 'sellObject', { id: hen }, { now: later + MIN });
});
