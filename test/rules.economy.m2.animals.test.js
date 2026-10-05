// M2 animal life (GDD §3.4, §6.2 #12): the Alpaca, the partner bottle, the Nursery and the Breeding Barn with its
// coats, deterministic inheritance and pity; exploit and determinism checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m2 } from './helpers/rules-economy-m2.js';

const M = await m2();
const { content, breeding, animals } = M;
const { farmAt, give, placeDef, must, run, evs, T0, HOUR, MIN } = M.rulesHelpers;
const { validateState } = M.state;
const { resetGrid } = M.gridCache;
const BIG = { confirm: ['BIG_SPEND'] };
const { BREEDING, NURSERY, COOP } = content;

function farm(level, o = {}) {
  const s = farmAt(level, { coins: 50_000_000, acorns: 200, ...o });
  s.farm.expansions = content.live('expansions').map((e) => e.id);
  resetGrid(s);
  return s;
}
const ids = (r) => evs(r, 'bought').map((e) => e.id);
/** A cow barn with `adults` adult cows and `babies` baby cows (bought by p1 at T0). */
function barnyard(level, { adults = 2, babies = 0, species = 'cow', home = 'cow_barn' } = {}) {
  const s = farm(level);
  const h = placeDef(s, home, BIG);
  const a = [];
  const b = [];
  for (let i = 0; i < adults; i++) a.push(...ids(must(s, 'buyAnimal', { def: species, adult: true, ...BIG })));
  for (let i = 0; i < babies; i++) b.push(...ids(must(s, 'buyAnimal', { def: species, ...BIG })));
  return { s, h, a, b };
}

test('the Alpaca: an L33 animal in its own paddock; it eats livestock feed and gives Alpaca Fiber', () => {
  const s = farm(32);
  assert.equal(run(s, 'buyAnimal', { def: 'alpaca', adult: true, ...BIG }).code, 'LOCKED');
  s.farm.xp = content.xpForLevel(33);
  assert.equal(run(s, 'buyAnimal', { def: 'alpaca', adult: true, ...BIG }).code, 'NOT_FOUND', 'no paddock yet');
  placeDef(s, 'paddock', BIG);
  const id = ids(must(s, 'buyAnimal', { def: 'alpaca', adult: true, ...BIG }))[0];
  give(s, 'livestock_feed', 4);
  must(s, 'tend', { id });
  const def = content.animalOf('alpaca');
  const r = must(s, 'tend', { id }, { now: T0 + def.cycleMs });
  assert.equal(evs(r, 'collected')[0].item, 'alpaca_fiber');
  assert.deepEqual(validateState(s), []);
});

test('partner bottle: the OTHER player\'s bottle within the hour cuts 20 % more, once per baby per hour', () => {
  const { s, b } = barnyard(12, { adults: 0, babies: 1, species: 'sheep', home: 'pasture' });
  const id = b[0];
  give(s, 'baby_bottle', 10);
  const def = content.animalOf('sheep');
  const at0 = s.farm.objects[id].adultAt;
  const r1 = must(s, 'bottle', { id }, { now: T0 + MIN });
  assert.equal(evs(r1, 'bottled')[0].partner, undefined);
  assert.equal(evs(r1, 'bottled')[0].savedMs, Math.floor(((at0 - T0 - MIN) * 3000) / 10_000));
  assert.equal(run(s, 'bottle', { id }, { now: T0 + 2 * MIN }).code, 'COOLDOWN', 'one bottle per player an hour');
  // stretch the growth (setup) so the 50 % floor does not cap the cuts this test measures
  s.farm.objects[id].adultAt = T0 + 20 * HOUR;
  s.farm.objects[id].placedAt = T0;
  const left = s.farm.objects[id].adultAt - (T0 + 2 * MIN);
  const r2 = must(s, 'bottle', { id }, { pid: 'p2', now: T0 + 2 * MIN });
  const e2 = evs(r2, 'bottled')[0];
  assert.equal(e2.partner, true);
  assert.equal(e2.savedMs, animals.bottleSaves({ ...s.farm.objects[id], adultAt: T0 + 20 * HOUR }, def,
    T0 + 2 * MIN, 3000 + COOP.partnerBottle.bp));
  assert.ok(e2.savedMs > Math.floor((left * 3000) / 10_000), 'more than a plain bottle');
  assert.equal(s.farm.objects[id].pb, T0 + 2 * MIN);
  // p1 again after their hour: p2 bottled 59 minutes ago, but the last partner bonus was 59 minutes ago too
  s.farm.objects[id].adultAt = T0 + 20 * HOUR;
  const r3 = must(s, 'bottle', { id }, { now: T0 + HOUR + MIN });
  assert.equal(evs(r3, 'bottled')[0].partner, undefined, 'a partner bonus inside the hour of the last one');
  // an hour after the last partner bonus, p2 bottling after p1 gets it again
  s.farm.objects[id].adultAt = T0 + 20 * HOUR;
  assert.equal(evs(must(s, 'bottle', { id }, { pid: 'p2', now: T0 + HOUR + 3 * MIN }), 'bottled')[0].partner, true);
  s.farm.objects[id].adultAt = T0 + def.babyMs;
  // never below the 50 % floor of the whole growth
  assert.ok(s.farm.objects[id].adultAt >= T0 + def.babyMs / 2);
  assert.deepEqual(validateState(s), []);
});

test('Nursery: three care steps, one bottle each, ten minutes apart; then a personality and a specialty', () => {
  const { s, b, a } = barnyard(18, { adults: 1, babies: 1 });
  const id = b[0];
  assert.equal(run(s, 'nurse', { id }).code, 'LOCKED', 'the Nursery opens at L19');
  s.farm.xp = content.xpForLevel(19);
  assert.equal(run(s, 'nurse', { id }).code, 'NO_ITEMS');
  assert.equal(run(s, 'nurse', { id: a[0] }).code, 'ALREADY_DONE', 'an adult gets no card');
  give(s, 'baby_bottle', 3);
  const r1 = must(s, 'nurse', { id });
  assert.deepEqual(evs(r1, 'nursed')[0], { e: 'nursed', id, animal: 'cow', step: 'feed', n: 1, of: 3,
    item: 'baby_bottle', by: 'p1' });
  assert.equal(run(s, 'nurse', { id }, { pid: 'p2', now: T0 + NURSERY.stepGapMs - 1 }).code, 'COOLDOWN');
  assert.equal(run(s, 'nursePick', { id, personality: 'sleepy', specialty: 'tidy' }).code, 'NOT_READY');
  must(s, 'nurse', { id }, { pid: 'p2', now: T0 + NURSERY.stepGapMs });
  // the baby may grow up before the last step: the card still finishes
  const late = s.farm.objects[id].adultAt + MIN;
  const r3 = must(s, 'nurse', { id }, { now: late });
  assert.equal(evs(r3, 'nursed')[0].step, 'groom');
  assert.deepEqual(s.farm.objects[id].nurse.by, ['p1', 'p2']);
  assert.equal(s.farm.inventory.baby_bottle, undefined, 'three bottles used');
  assert.equal(run(s, 'nurse', { id }, { now: late + HOUR }).code, 'ALREADY_DONE');
  assert.equal(run(s, 'nursePick', { id, personality: 'cranky', specialty: 'tidy' }).code, 'BAD_ARGS');
  const r = must(s, 'nursePick', { id, personality: 'playful', specialty: 'tidy' }, { pid: 'p2', now: late });
  assert.deepEqual(evs(r, 'nurseDone')[0].carers, ['p1', 'p2']);
  assert.equal(run(s, 'nursePick', { id, personality: 'sleepy', specialty: 'bountiful' }).code, 'ALREADY_DONE');
  assert.deepEqual(validateState(s), []);
});

test('Nursery specialties: Tidy adds a Compost Bin point a collection, Bountiful a 5 % bonus product', () => {
  const { s, a } = barnyard(19, { adults: 2 });
  placeDef(s, 'compost_bin', BIG);
  const bin = Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'compost_bin');
  s.farm.objects[a[0]].nurse = { n: 3, at: T0, by: ['p1'] };
  s.farm.objects[a[0]].pers = 'sleepy';
  s.farm.objects[a[0]].spec = 'tidy';
  give(s, 'livestock_feed', 10);
  must(s, 'tend', { ids: a });
  const cycle = content.animalOf('cow').cycleMs;
  must(s, 'tend', { ids: a }, { now: T0 + cycle });
  assert.equal(s.farm.objects[bin].pts, 3, 'two collections, one of them Tidy');
  // Bountiful: its own roll ('spec'); over many cycles about 5 % extra on top of the other chances
  assert.equal(animals.specialtyOf({ spec: 'bountiful' }).bonusBp, 500);
  assert.equal(animals.specialtyOf({ spec: 'nope' }), null);
  assert.deepEqual(validateState(s), []);
});

test('Breeding Barn: two adults of one species, 2 Baby Bottles, a baby after 2 x the baby time', () => {
  const { s, a, b } = barnyard(27, { adults: 3, babies: 1 });
  assert.equal(run(s, 'breed', { a: a[0], b: a[1] }).code, 'LOCKED', 'L28');
  s.farm.xp = content.xpForLevel(28);
  give(s, 'baby_bottle', 4);
  assert.equal(run(s, 'breed', { a: a[0], b: a[1] }).code, 'CAP', 'the barn is full: the baby needs room');
  s.farm.objects[Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'cow_barn')].up = 1;
  s.farm.xp = content.xpForLevel(27);
  assert.equal(run(s, 'breed', { a: a[0], b: a[1] }).code, 'LOCKED', 'L28');
  s.farm.xp = content.xpForLevel(28);
  assert.equal(run(s, 'breed', { a: a[0], b: a[0] }).code, 'BAD_ARGS');
  assert.equal(run(s, 'breed', { a: a[0], b: b[0] }).code, 'NOT_READY', 'a baby cannot breed');
  assert.equal(run(s, 'breed', { a: a[0], b: 'none.1.0' }).code, 'NOT_FOUND');
  const r = must(s, 'breed', { a: a[0], b: a[1] });
  const def = content.animalOf('cow');
  assert.equal(evs(r, 'breedStarted')[0].readyAt, T0 + 2 * def.babyMs);
  assert.equal(s.farm.inventory.baby_bottle, 2);
  assert.equal(run(s, 'breed', { a: a[1], b: a[2] }).code, 'OCCUPIED', 'one pen');
  assert.equal(run(s, 'breedCollect', {}).code, 'NOT_READY');
  // parents are untouched: they still eat, produce and are sold as before
  const before = structuredClone(s.farm.objects[a[0]]);
  const done = T0 + 2 * def.babyMs;
  const c = must(s, 'breedCollect', { name: '  Clover  ' }, { pid: 'p2', now: done });
  const ev = evs(c, 'bred')[0];
  assert.deepEqual(s.farm.objects[a[0]], before);
  const baby = s.farm.objects[ev.id];
  assert.equal(baby.def, 'cow');
  assert.equal(baby.free, true, 'bred, never bought: not counted for n-th copy prices');
  assert.equal(baby.baby, true);
  assert.equal(baby.adultAt, done + def.babyMs);
  assert.ok(BREEDING.coats.some((x) => x.id === baby.coat));
  assert.equal(s.farm.names[ev.id].name, 'Clover');
  assert.equal(evs(c, 'named')[0].text, 'Clover');
  assert.equal(s.farm.breed.n.cow, 1);
  assert.equal(s.farm.breed.cur, null);
  assert.equal(run(s, 'breedCollect', {}).code, 'NOT_FOUND');
  assert.deepEqual(validateState(s), []);
});

test('Breeding: poultry costs Chicken Feed; a cancel gives the feed back; no room means no breeding', () => {
  const { s, a } = barnyard(28, { adults: 6, species: 'chicken', home: 'coop' });
  assert.equal(run(s, 'breed', { a: a[0], b: a[1] }).code, 'CAP', 'the coop is full (6 of 6)');
  const cap = content.defOf('coop');
  must(s, 'upgradeHome', { id: Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'coop'), ...BIG });
  assert.ok(cap.upgradeStep > 0);
  assert.equal(run(s, 'breed', { a: a[0], b: a[1] }).code, 'NO_ITEMS');
  give(s, 'chicken_feed', 2);
  s.farm.keep.chicken_feed = { n: 2, by: 'p2' };
  assert.equal(run(s, 'breed', { a: a[0], b: a[1] }).code, 'RESERVED', 'Keep N asks first');
  must(s, 'breed', { a: a[0], b: a[1], confirm: ['RESERVED'] });
  assert.equal(s.farm.inventory.chicken_feed, undefined);
  const r = must(s, 'breedCancel', {}, { pid: 'p2', now: T0 + MIN });
  assert.equal(evs(r, 'breedCancelled')[0].qty, 2);
  assert.equal(s.farm.inventory.chicken_feed, 2);
  assert.equal(run(s, 'breedCancel', {}).code, 'NOT_FOUND');
  assert.deepEqual(validateState(s), []);
});

test('coats: deterministic per species counter, near the 40/30/25/5 split, golden by the 20th since the last', () => {
  const ctxOf = (seed) => M.index.makeCtx({ meta: { farmSeed: seed } }, { now: T0, pid: 'p1', cid: 'x', seq: 1 });
  const s = farm(30);
  const tally = {};
  let sinceGolden = 0;
  let longest = 0;
  for (let n = 0; n < 4000; n++) {
    s.farm.breed.n.cow = n;
    s.farm.breed.pity.cow = sinceGolden;
    const c = breeding.coatRoll(s, ctxOf(s.meta.farmSeed), 'cow');
    // the same counter always gives the same coat (no re-roll by reload, cancel or a second tab)
    assert.deepEqual(breeding.coatRoll(s, ctxOf(s.meta.farmSeed), 'cow'), c);
    tally[c.coat] = (tally[c.coat] ?? 0) + 1;
    sinceGolden = c.golden ? 0 : sinceGolden + 1;
    longest = Math.max(longest, sinceGolden);
  }
  assert.ok(longest <= BREEDING.goldenPity - 1, `a golden at the latest every ${BREEDING.goldenPity}th`);
  for (const { id, bp } of BREEDING.coats) {
    const share = (tally[id] * 10_000) / 4000;
    if (id !== 'golden') assert.ok(Math.abs(share - bp) < 400, `${id} ${share} vs ${bp}`);
  }
  assert.ok(tally.golden >= 200, 'pity lifts golden above 5 %');
});

test('the pity counter is per species and survives into the state; the 20th breeding is golden', () => {
  const { s, a } = barnyard(28, { adults: 2 });
  s.farm.objects[Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'cow_barn')].up = 2;
  s.farm.breed.pity.cow = BREEDING.goldenPity - 1;
  give(s, 'baby_bottle', 2);
  must(s, 'breed', { a: a[0], b: a[1] });
  const r = must(s, 'breedCollect', {}, { now: T0 + 2 * content.animalOf('cow').babyMs });
  assert.equal(evs(r, 'bred')[0].coat, 'golden');
  assert.equal(s.farm.breed.pity.cow, 0);
  assert.deepEqual(validateState(s), []);
});

test('bred babies grow like bought ones: bottles and the Nursery work on them', () => {
  const { s, a } = barnyard(28, { adults: 2 });
  give(s, 'baby_bottle', 4);
  must(s, 'breed', { a: a[0], b: a[1] });
  const t = T0 + 2 * content.animalOf('cow').babyMs;
  const id = evs(must(s, 'breedCollect', {}, { now: t }), 'bred')[0].id;
  must(s, 'bottle', { id }, { now: t + MIN });
  must(s, 'nurse', { id }, { now: t + MIN });
  assert.equal(s.farm.objects[id].nurse.n, 1);
  assert.deepEqual(validateState(s), []);
});

test('exploits: a breed-and-cancel loop neither re-rolls the coat nor gains anything; nursing never speeds growth', () => {
  const { s, a } = barnyard(28, { adults: 2 });
  s.farm.objects[Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'cow_barn')].up = 2;
  give(s, 'baby_bottle', 2);
  const ctx = M.index.makeCtx(s, { now: T0, pid: 'p1', cid: 'x', seq: 1 });
  const coat = breeding.coatRoll(s, ctx, 'cow');
  for (let i = 0; i < 5; i++) {
    must(s, 'breed', { a: a[0], b: a[1] }, { now: T0 + i * MIN });
    must(s, 'breedCancel', {}, { now: T0 + i * MIN + 1 });
  }
  assert.equal(s.farm.inventory.baby_bottle, 2, 'the bottles always come back, never more');
  assert.equal(s.farm.breed.n.cow ?? 0, 0);
  assert.deepEqual(breeding.coatRoll(s, ctx, 'cow'), coat, 'the next coat is fixed by the species counter');
  must(s, 'breed', { a: a[0], b: a[1] }, { now: T0 + HOUR });
  const r = must(s, 'breedCollect', {}, { now: T0 + HOUR + 2 * content.animalOf('cow').babyMs });
  assert.equal(evs(r, 'bred')[0].coat, coat.coat);
  // the Nursery's bottles are a cost, not a growth cut (Baby Bottles do that)
  const id = evs(r, 'bred')[0].id;
  const adultAt = s.farm.objects[id].adultAt;
  give(s, 'baby_bottle', 1);
  must(s, 'nurse', { id }, { now: T0 + 2 * HOUR + 2 * content.animalOf('cow').babyMs });
  assert.equal(s.farm.objects[id].adultAt, adultAt);
  // a bred baby is free: selling it pays nothing back (no breed-and-sell coin loop)
  const coins = s.farm.wallet.coins;
  const sold = run(s, 'sellObject', { id, confirm: ['BIG_SPEND'] }, { now: T0 + 3 * HOUR + 2 * content.animalOf('cow').babyMs });
  if (sold.ok) assert.equal(s.farm.wallet.coins, coins, 'a gift resells for nothing');
  assert.deepEqual(validateState(s), []);
});
