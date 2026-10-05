// Wave 4 (the owners' wish list, 2026-10-04), the rules half: decor sales (placed gifts and tray copies, with the
// 10-minute trash), Homestead upgrades and their bonuses, Fertilizer, clearable weeds, pet breeds, the player's look,
// paid respecs and perk refunds, the Rotate helper, the Goal Tracker cards, and older saves backfilled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farmAt, give, must, run, evs, placeDef, idsOf, obj, T0, HOUR, MIN, ledgerBalanced, freeSpot } from
  './helpers/rules.js';
import { sys, plain } from './helpers.js';
import { xpForLevel, defOf, cropOf, itemOf, MARKET, COOP, PERKS, RESTED } from '../shared/content/index.js';
import { WORLD_TILES } from '../shared/content/config.js';
import { validateState, createFarm, createPlayer } from '../shared/rules/state.js';
import { resetGrid } from '../shared/rules/grid-cache.js';
import { inLand } from '../shared/rules/grid.js';
import { barnCap, demandLeft, demandOf, unitPrice } from '../shared/rules/economy.js';
import { resaleOf, sellStoredValue, rotateSpot, GIFT_DECOR_BP } from '../shared/rules/actions/decor.js';
import { upgradeView } from '../shared/rules/actions/upgrades.js';
import { UPGRADES, upgradeBonus, benchGoldenMs } from '../shared/rules/upgrades.js';
import { FERTILIZER, waterPlan } from '../shared/rules/actions/farming.js';
import { WEEDS, weeded } from '../shared/rules/actions/weeds.js';
import { petBreeds, breedOf } from '../shared/rules/actions/pets.js';
import { RESPEC_ACORNS, REFUND_ACORNS_PER_POINT, perksView } from '../shared/rules/actions/perks.js';
import { restedFor } from '../shared/rules/actions/rested.js';
import { goals, SPEND_ROTATE_MS } from '../shared/rules/goals.js';
import { dueSystemActions } from '../shared/rules/system.js';
import { backfill } from '../server/migrations.js';

const DAY = 24 * HOUR;
const BIG = ['BIG_SPEND', 'RESERVED'];
const idOf = (s, def) => idsOf(s, def)[0];
const tierRow = (target, n) => UPGRADES[target].tiers[n - 1];
/** Give the materials and level a tier needs. */
function stock(s, target, n) {
  const row = tierRow(target, n);
  for (const [item, q] of Object.entries(row.items ?? {})) give(s, item, q);
  if (s.farm.xp < xpForLevel(row.unlock)) s.farm.xp = xpForLevel(row.unlock);
}

// ---- A: decor sales ---------------------------------------------------------------------------------------------

test('A: a starter (gift) fence sells for the gift share of its price; a bought piece for half of what was paid', () => {
  const s = farmAt(12, { coins: 10_000 });
  const fence = idOf(s, 'picket_fence');
  const price = defOf('picket_fence').cost;
  assert.equal(GIFT_DECOR_BP, MARKET.refunds.giftDecorBp ?? 2500);
  assert.deepEqual(resaleOf(obj(s, fence), T0), { coins: Math.floor((price * GIFT_DECOR_BP) / 10_000), acorns: 0,
    undo: false });
  const before = s.farm.wallet.coins;
  const r = must(s, 'sellObject', { id: fence }, { pid: 'p2' });
  assert.equal(evs(r, 'removed')[0].coins, Math.floor((price * GIFT_DECOR_BP) / 10_000));
  assert.equal(s.farm.wallet.coins, before + Math.floor((price * GIFT_DECOR_BP) / 10_000));
  assert.ok(s.farm.trash[fence], 'the sale waits 10 minutes in the trash');
  must(s, 'restore', { id: fence }, { now: T0 + MIN });
  assert.equal(s.farm.wallet.coins, before);
  // a bought flower bed: 100 % inside the undo window, the decor share after it
  const bed = placeDef(s, 'flower_bed');
  const paid = obj(s, bed).paid.coins;
  assert.equal(resaleOf(obj(s, bed), T0).undo, true);
  assert.equal(resaleOf(obj(s, bed), T0 + 11 * MIN).coins, Math.floor((paid * MARKET.refunds.decorBp) / 10_000));
  assert.ok(resaleOf(obj(s, bed), T0 + 11 * MIN).coins < defOf('flower_bed').cost, 'never a buy / sell profit');
  assert.deepEqual(validateState(s), []);
});

test('A: Acorn decor gives back the decor share in Acorns', () => {
  const s = farmAt(12, { acorns: 100 });
  const arbor = placeDef(s, 'heart_arbor', { confirm: BIG });
  const acorns = s.farm.wallet.acorns;
  const r = must(s, 'sellObject', { id: arbor }, { now: T0 + 11 * MIN });
  const back = Math.floor((defOf('heart_arbor').acorns * MARKET.refunds.decorBp) / 10_000);
  assert.equal(evs(r, 'removed')[0].acorns, back);
  assert.equal(s.farm.wallet.acorns, acorns + back);
});

test('A: sellStored sells one tray copy (paid copies first), goes to the trash, and restore puts it back', () => {
  const s = farmAt(12, { coins: 10_000 });
  const start = s.farm.wallet.coins + (s.farm.stats['coins.spent'] ?? 0) - (s.farm.stats['coins.granted'] ?? 0)
    - (s.farm.stats['coins.refunded'] ?? 0) - (s.farm.stats['coins.earned'] ?? 0);
  const bed = placeDef(s, 'flower_bed');
  must(s, 'store', { id: bed });
  s.farm.storage.flower_bed += 1;                      // and one gift copy (a quest reward)
  assert.equal(s.farm.storagePaid.flower_bed, 1);
  assert.equal(run(s, 'sellStored', { def: 'coop' }).code, 'LOCKED', 'buildings are moved, not sold');
  assert.equal(run(s, 'sellStored', { def: 'scarecrow' }).code, 'NOT_FOUND');
  const cost = defOf('flower_bed').cost;
  assert.deepEqual(sellStoredValue(s, 'flower_bed'), { coins: Math.floor((cost * MARKET.refunds.decorBp) / 10_000),
    acorns: 0, paid: true });
  const r1 = must(s, 'sellStored', { def: 'flower_bed' }, { pid: 'p2', now: T0 + MIN, seq: 901 });
  const ev = evs(r1, 'soldStored')[0];
  assert.equal(ev.coins, Math.floor((cost * MARKET.refunds.decorBp) / 10_000));
  assert.equal(s.farm.storage.flower_bed, 1);
  assert.equal(s.farm.storagePaid.flower_bed, undefined, 'the paid copy went first');
  assert.deepEqual(validateState(s), []);
  const r2 = must(s, 'sellStored', { def: 'flower_bed' }, { now: T0 + 2 * MIN, seq: 902 });
  assert.equal(evs(r2, 'soldStored')[0].coins, Math.floor((cost * GIFT_DECOR_BP) / 10_000));
  assert.equal(s.farm.storage.flower_bed, undefined);
  assert.equal(run(s, 'sellStored', { def: 'flower_bed' }).code, 'NOT_FOUND');
  // the undo: the paid copy comes back as a paid copy (it resells at the same share), the coins go back
  must(s, 'restore', { id: ev.id }, { now: T0 + 5 * MIN });
  assert.equal(s.farm.storage.flower_bed, 1);
  assert.equal(s.farm.storagePaid.flower_bed, 1);
  assert.equal(run(s, 'restore', { id: evs(r2, 'soldStored')[0].id }, { now: T0 + 13 * MIN }).code, 'NOT_FOUND',
    'the trash forgets after 10 minutes');
  assert.ok(ledgerBalanced(s, start));
  assert.deepEqual(validateState(s), []);
});

// ---- E: upgrades ------------------------------------------------------------------------------------------------

test('E: the Well, Market Stand, farmhouse and a bench upgrade tier by tier for coins and materials', () => {
  const s = farmAt(4, { coins: 1_000_000 });
  const well = idOf(s, 'well');
  const stand = idOf(s, 'market_stand');
  const house = idOf(s, 'farmhouse');
  assert.equal(run(s, 'upgradeObject', { id: idOf(s, 'barn') }).code, 'LOCKED', 'the Barn has its own ladder');
  assert.equal(run(s, 'upgradeObject', { id: 'nope.1.0' }).code, 'NOT_FOUND');
  for (const [id, target] of [[well, 'well'], [stand, 'market_stand'], [house, 'farmhouse']]) {
    const tiers = UPGRADES[target].tiers;
    if (s.farm.xp < xpForLevel(tiers[0].unlock)) assert.equal(run(s, 'upgradeObject', { id }).code, 'LOCKED');
    for (let n = 1; n <= tiers.length; n++) {
      s.farm.xp = Math.max(s.farm.xp, xpForLevel(tierRow(target, n).unlock));
      const items = tierRow(target, n).items ?? {};
      if (Object.keys(items).length) assert.equal(run(s, 'upgradeObject', { id }).code, 'NO_ITEMS');
      stock(s, target, n);
      const coins = s.farm.wallet.coins;
      const r = must(s, 'upgradeObject', { id, confirm: BIG });
      assert.deepEqual(evs(r, 'upgraded')[0], { e: 'upgraded', id, def: obj(s, id).def, target, tier: n,
        name: tierRow(target, n).name, coins: tierRow(target, n).coins, items: { ...items }, by: 'p1' });
      assert.equal(s.farm.wallet.coins, coins - tierRow(target, n).coins);
      assert.equal(obj(s, id).up, n);
      for (const item of Object.keys(items)) assert.equal(s.farm.inventory[item] ?? 0, 0);
    }
    assert.equal(run(s, 'upgradeObject', { id, confirm: BIG }).code, 'ALREADY_DONE');
    assert.equal(upgradeView(s, id).next, null);
  }
  assert.deepEqual(validateState(s), []);
});

test('E: materials below Keep N ask first, and a big price asks BIG_SPEND', () => {
  const s = farmAt(30, { coins: 200_000 });
  const house = idOf(s, 'farmhouse');
  stock(s, 'farmhouse', 1);
  const item = Object.keys(tierRow('farmhouse', 1).items)[0];
  if (item) {
    must(s, 'keep', { item, n: 50 });
    assert.equal(run(s, 'upgradeObject', { id: house }).code, 'RESERVED');
  }
  s.farm.wallet.coins = tierRow('farmhouse', 1).coins + 10;
  assert.equal(run(s, 'upgradeObject', { id: house, confirm: ['RESERVED'] }).code, 'BIG_SPEND');
  s.farm.wallet.coins = tierRow('farmhouse', 1).coins - 1;
  assert.equal(run(s, 'upgradeObject', { id: house, confirm: BIG }).code, 'NO_COINS');
});

test('E: the bonuses: Barn space, watering, Demand units and prices, rested XP, a longer Golden Hour', () => {
  const s = farmAt(30, { coins: 2_000_000 });
  const base = { cap: barnCap(s), demand: null };
  const plot = idsOf(s, 'plot')[0];
  must(s, 'plant', { id: plot, crop: 'pumpkin' });
  const water0 = waterPlan(obj(s, plot), 'p1', { now: T0, grace: 0 }, s).bp;
  for (const target of ['farmhouse', 'well', 'market_stand']) {
    for (let n = 1; n <= 3; n++) { stock(s, target, n); must(s, 'upgradeObject', { id: idOf(s, target), confirm: BIG }); }
  }
  const B = (t) => tierRow(t, 3).bonus;
  assert.equal(barnCap(s), base.cap + (B('farmhouse').barnCap ?? 0));
  assert.equal(waterPlan(obj(s, plot), 'p1', { now: T0, grace: 0 }, s).bp, water0 + (B('well').waterBp ?? 0));
  const d = demandOf(s, T0);
  assert.equal(demandLeft(s, d.raw, T0), MARKET.demand.unitsPerDay + (B('market_stand').demandUnits ?? 0));
  const plain0 = farmAt(30);
  const sellBp = B('market_stand').sellBp ?? 0;
  assert.equal(unitPrice(s, 'pumpkin', T0), Math.floor((unitPrice(plain0, 'pumpkin', T0) * (10_000 + sellBp)) / 10_000));
  assert.equal(upgradeBonus(s, 'restedBp'), B('farmhouse').restedBp ?? 0);
  // rested XP: a player away 8 hours comes back with restedBp more
  for (const [st, bp] of [[plain0, 0], [s, upgradeBonus(s, 'restedBp')]]) {
    st.players.p2.lastSeenAt = T0 + MIN;
    st.players.p2.rested = { xp: 0, at: T0 };
    give(st, 'wheat', 1);
    must(st, 'sell', { item: 'wheat', qty: 1 }, { pid: 'p2', now: T0 + 9 * HOUR });
    const want = restedFor(st.players.p2.xp, 8 * HOUR - MIN);
    if (RESTED.unlock <= 30) assert.ok(st.players.p2.rested.xp >= want + Math.floor((want * bp) / 10_000) - 1);
  }
  assert.deepEqual(validateState(s), []);
});

test('E: an upgraded bench gives a longer Golden Hour, keeps its tier when moved, is never stored, sells honestly', () => {
  const s = farmAt(30, { coins: 500_000 });
  const bench = placeDef(s, 'sunset_bench');
  for (let n = 1; n <= 2; n++) { stock(s, 'bench', n); must(s, 'upgradeObject', { id: bench, confirm: BIG }); }
  assert.equal(benchGoldenMs(s, bench), tierRow('bench', 2).bonus.goldenMs);
  assert.equal(obj(s, bench).rcpt, undefined, 'an upgrade ends the 100 % undo');
  const paid = obj(s, bench).paid.coins;
  assert.equal(paid, defOf('sunset_bench').cost + tierRow('bench', 1).coins + tierRow('bench', 2).coins);
  assert.equal(run(s, 'store', { id: bench }).code, 'LOCKED');
  const [x, z] = freeSpot(s, 'sunset_bench', 1);
  must(s, 'move', { id: bench, x, z, rot: 1 });
  assert.equal(obj(s, bench).up, 2);
  // the Golden Hour: both farmers on it for seatMs
  s.farm.coop.bench = { p1: { id: bench, at: T0 }, p2: { id: bench, at: T0 } };
  const at = T0 + COOP.goldenHour.seatMs + 1;
  assert.ok(dueSystemActions(s, at).some((a) => a.type === '_golden'));
  const r = sys(s, '_golden', {}, at);
  assert.equal(r.ok, true);
  assert.equal(s.farm.coop.golden.until, at + COOP.goldenHour.durationMs + tierRow('bench', 2).bonus.goldenMs);
  assert.equal(evs(r, 'together')[0].until, s.farm.coop.golden.until);
  // selling it pays the decor share of everything paid into it: never more than was paid
  assert.equal(resaleOf(obj(s, bench), at).coins, Math.floor((paid * MARKET.refunds.decorBp) / 10_000));
  assert.deepEqual(validateState(s), []);
});

test('E: the Goal Tracker offers an affordable upgrade among the spend cards, and saving up for one in SOON', () => {
  const s = farmAt(12, { coins: 3000 });
  s.farm.objects = Object.fromEntries(Object.entries(s.farm.objects).filter(([, o]) => o.def !== 'plot'));
  resetGrid(s);
  const seen = new Set();
  for (let k = 0; k < 12; k++) {
    const g = goals(s, 'p1', T0 + k * SPEND_ROTATE_MS, { all: true });
    for (const c of g.all) if (c.kind === 'upgrade') seen.add(`${c.slot}:${c.ref}`);
  }
  const cheap = ['well', 'market_stand', 'farmhouse', 'bench'].filter((t) => idsOf(s, UPGRADES[t].defs[0]).length)
    .map((t) => [t, tierRow(t, 1)]).filter(([, r]) => r.unlock <= 12);
  assert.ok(cheap.length > 0);
  for (const [, r] of cheap) for (const i of Object.keys(r.items ?? {})) give(s, i, 50);
  s.farm.wallet.coins = 1_000_000;
  let now = false;
  for (let k = 0; k < 12 && !now; k++) {
    now = goals(s, 'p1', T0 + k * SPEND_ROTATE_MS, { all: true }).all.some((c) => c.kind === 'upgrade' && c.slot === 'now'
      && c.target.panel === 'upgrades');
  }
  assert.ok(now, 'an affordable upgrade takes its turn on the NOW card');
  assert.ok([...seen].some((x) => x.startsWith('soon:')), `a SOON card while saving up (${[...seen]})`);
});

// ---- 2: Fertilizer -------------------------------------------------------------------------------------------------

test('2: Fertilizer on a growing crop: it ripens sooner (never before now), gives more, and stacks with Compost', () => {
  assert.ok(itemOf(FERTILIZER.item), 'content ships the Fertilizer item');
  const s = farmAt(Math.max(FERTILIZER.unlock ?? 1, itemOf(FERTILIZER.item).unlock ?? 1), { coins: 100_000 });
  const [a, b] = idsOf(s, 'plot');
  assert.equal(run(s, 'fertilize', { id: a }).code, 'EMPTY');
  must(s, 'plant', { ids: [a, b], crop: 'pumpkin' });
  assert.equal(run(s, 'fertilize', { id: a }).code, 'NO_ITEMS');
  give(s, FERTILIZER.item, 3);
  give(s, 'compost', 2);
  must(s, 'compost', { id: a });
  const ready0 = obj(s, a).crop.readyAt;
  const r = must(s, 'fertilize', { id: a }, { pid: 'p2', now: T0 + MIN });
  const grow = cropOf('pumpkin').growMs;
  const saved = Math.floor((grow * FERTILIZER.timeBp) / 10_000);
  assert.deepEqual(evs(r, 'fertilized')[0], { e: 'fertilized', id: a, kind: 'crop', crop: 'pumpkin', by: 'p2',
    savedMs: saved });
  assert.equal(obj(s, a).crop.readyAt, ready0 - saved);
  assert.equal(obj(s, a).crop.fert, 'p2');
  assert.equal(s.farm.inventory[FERTILIZER.item], 2);
  assert.equal(run(s, 'fertilize', { id: a }).code, 'ALREADY_DONE', 'once a cycle');
  // harvest: the yield + Compost's +1 + Fertilizer's units (+ any lucky roll); a new cycle takes it again
  const h = must(s, 'harvest', { id: a }, { now: obj(s, a).crop.readyAt });
  assert.ok(evs(h, 'harvested')[0].qty >= cropOf('pumpkin').yield + 1 + FERTILIZER.bonusUnits);
  assert.deepEqual(validateState(s), []);
});

test('2: quick crops, ripe crops, Giants and trees take no Fertilizer; a stroke skips them; locked before its level', () => {
  const s = farmAt(20, { coins: 100_000 });
  const [a, b, c] = idsOf(s, 'plot');
  give(s, FERTILIZER.item, 5);
  must(s, 'plant', { id: a, crop: 'wheat' });
  must(s, 'plant', { ids: [b, c], crop: 'pumpkin' });
  assert.equal(run(s, 'fertilize', { id: a }).code, 'NOT_NEEDED');
  const late = obj(s, b).crop.readyAt - 1000;
  const r = must(s, 'fertilize', { ids: [a, b, c] }, { now: late });
  assert.deepEqual(evs(r, 'fertilized').map((e) => e.id), [b, c], 'the quick crop is skipped, not refused');
  assert.equal(obj(s, b).crop.readyAt, late, 'never ripe before the moment it was spread');
  assert.equal(evs(r, 'fertilized')[0].savedMs, 1000);
  assert.equal(run(s, 'fertilize', { id: b }, { now: late + 5000 }).code, 'ALREADY_DONE');
  const tree = placeDef(s, 'apple_tree', { confirm: BIG });
  assert.equal(run(s, 'fertilize', { id: tree }).code, 'NOT_FOUND');
  const low = farmAt(Math.max(1, (FERTILIZER.unlock ?? 10) - 1));
  give(low, FERTILIZER.item, 1);
  assert.equal(run(low, 'fertilize', { id: idsOf(low, 'plot')[0] }).code, 'LOCKED');
  assert.deepEqual(validateState(s), []);
});

test('2: Fertilizer counts for the "fertilize" story tasks like Compost', () => {
  const s = farmAt(20, { coins: 100_000 });
  const p = idsOf(s, 'plot')[0];
  must(s, 'plant', { id: p, crop: 'pumpkin' });
  give(s, FERTILIZER.item, 1);
  const before = s.farm.stats.fertilized ?? 0;
  must(s, 'fertilize', { id: p });
  assert.equal(s.farm.stats.fertilized, before + 1);
});

// ---- F: weeds -----------------------------------------------------------------------------------------------------

test('F: weeds on the farm\'s land are pulled for good, for both players, with a tiny daily-capped reward', () => {
  const s = farmAt(12, { coins: 0 });
  const land = [];
  for (let z = 8; z < 56 && land.length < WEEDS.dailyCap + 5; z++) {
    for (let x = 8; x < 56 && land.length < WEEDS.dailyCap + 5; x++) {
      if (inLand(s, x, z)) land.push([x, z]);
    }
  }
  const [x0, z0] = land[0];
  assert.equal(run(s, 'clearWeed', { x: 0, z: 0 }).code, 'OUT_OF_BOUNDS', 'scenery outside the farm stays');
  assert.equal(run(s, 'clearWeed', { x: x0 }).code, 'BAD_ARGS');
  const r = must(s, 'clearWeed', { x: x0, z: z0 }, { pid: 'p2' });
  assert.deepEqual(evs(r, 'weedsCleared')[0], { e: 'weedsCleared', cells: [z0 * WORLD_TILES + x0], coins: WEEDS.coins,
    by: 'p2' });
  assert.ok(weeded(s, x0, z0));
  assert.equal(run(s, 'clearWeed', { x: x0, z: z0 }).code, 'ALREADY_DONE');
  // a drag: new tiles only, paid up to the day's cap
  const cells = land.slice(0, WEEDS.dailyCap + 3).map(([x, z]) => z * WORLD_TILES + x);
  const r2 = must(s, 'clearWeed', { cells: [...cells, 0] });
  assert.equal(evs(r2, 'weedsCleared')[0].cells.length, cells.length - 1);
  assert.equal(s.farm.wallet.coins, WEEDS.coins * WEEDS.dailyCap);
  assert.equal(s.farm.weeds.n, WEEDS.dailyCap);
  // the next farm day pays again
  const r3 = must(s, 'clearWeed', { cells: land.slice(WEEDS.dailyCap + 3).map(([x, z]) => z * WORLD_TILES + x) },
    { now: T0 + DAY });
  assert.ok(evs(r3, 'weedsCleared')[0].coins > 0);
  assert.equal(s.farm.stats['coins.earned'] ?? 0, 0, 'a reward is granted, never earned');
  assert.deepEqual(validateState(s), []);
});

// ---- 6: pet breeds -------------------------------------------------------------------------------------------------

test('6: a pet is adopted with a breed and can change it; older pets show their kind\'s first breed', () => {
  const s = farmAt(12);
  assert.ok(petBreeds('dog').length >= 3 && petBreeds('cat').length >= 3);
  assert.equal(run(s, 'adoptPet', { kind: 'dog', name: 'Rex', breed: 'orange' }).code, 'BAD_ARGS');
  const r = must(s, 'adoptPet', { kind: 'dog', name: 'Rex', breed: petBreeds('dog')[2].id });
  assert.equal(evs(r, 'petAdopted')[0].breed, petBreeds('dog')[2].id);
  must(s, 'adoptPet', { kind: 'cat', name: 'Mitzi' }, { pid: 'p2' });
  assert.equal(breedOf(s.players.p2.pet), petBreeds('cat')[0].id);
  assert.deepEqual(validateState(s), []);
  const b = petBreeds('cat')[1].id;
  const r2 = must(s, 'petBreed', { breed: b }, { pid: 'p2' });
  assert.deepEqual(evs(r2, 'petBreed')[0], { e: 'petBreed', pid: 'p2', kind: 'cat', breed: b, by: 'p2' });
  assert.equal(run(s, 'petBreed', { breed: b }, { pid: 'p2' }).code, 'ALREADY_DONE');
  assert.equal(run(s, 'petBreed', { breed: 'husky' }, { pid: 'p2' }).code, 'BAD_ARGS');
  const s2 = farmAt(12);
  assert.equal(run(s2, 'petBreed', { breed: 'husky' }).code, 'NOT_FOUND');
  assert.deepEqual(validateState(s), []);
  s.players.p2.pet.breed = 'poodle';
  assert.ok(validateState(s).some((m) => m.includes('pet')));
});

// ---- 9: the player's look -------------------------------------------------------------------------------------------

test('9: setAvatar merges a look the partner sees; bad ids and colours are refused', () => {
  const s = farmAt(3);
  assert.equal(s.players.p1.avatar, null);
  assert.equal(run(s, 'setAvatar', {}).code, 'BAD_ARGS');
  assert.equal(run(s, 'setAvatar', { hairColor: 'red' }).code, 'BAD_ARGS');
  assert.equal(run(s, 'setAvatar', { body: 'farmer_z' }).code, 'BAD_ARGS');
  assert.equal(run(s, 'setAvatar', { hair: 'Mohawk!' }).code, 'BAD_ARGS');
  const r = must(s, 'setAvatar', { hair: 'bun', hairColor: '#d9b26a', top: '#2BB3A3' }, { pid: 'p2' });
  assert.deepEqual(s.players.p2.avatar, { hair: 'bun', hairColor: '#D9B26A', top: '#2BB3A3' });
  assert.deepEqual(evs(r, 'avatarChanged')[0].avatar, s.players.p2.avatar);
  must(s, 'setAvatar', { body: 'farmer_a', hat: 'none' }, { pid: 'p2' });
  assert.deepEqual(s.players.p2.avatar, { hair: 'bun', hairColor: '#D9B26A', top: '#2BB3A3', body: 'farmer_a', hat: 'none' });
  assert.equal(run(s, 'setAvatar', { hair: 'bun' }, { pid: 'p2' }).code, 'ALREADY_DONE');
  assert.equal(s.players.p1.avatar, null, 'only my own look');
  assert.deepEqual(validateState(s), []);
});

// ---- G: perks -------------------------------------------------------------------------------------------------------

test('G: after the free weekly respec, a respec costs Acorns; the last perk of a tree comes back for Acorns', () => {
  const s = farmAt(40, { acorns: 100 });
  s.players.p1.xp = 10_000_000;
  must(s, 'perkPick', { tree: 'grower' });
  must(s, 'perkPick', { tree: 'grower' });
  must(s, 'perkPick', { tree: 'grower' });
  // a single perk back: the LAST of the tree, for its points x REFUND_ACORNS_PER_POINT
  const pts = PERKS.costs[2];
  const acorns = s.farm.wallet.acorns;
  const r = must(s, 'perkRefund', { tree: 'grower', confirm: ['BIG_SPEND'] });
  assert.deepEqual(evs(r, 'perkRefunded')[0], { e: 'perkRefunded', pid: 'p1', tree: 'grower', i: 2, points: pts,
    acorns: pts * REFUND_ACORNS_PER_POINT, by: 'p1' });
  assert.equal(s.farm.wallet.acorns, acorns - pts * REFUND_ACORNS_PER_POINT);
  assert.equal(s.players.p1.perks.t.grower, 2);
  assert.equal(run(s, 'perkRefund', { tree: 'artisan' }).code, 'ALREADY_DONE');
  // the free respec, then a paid one
  must(s, 'perkRespec', {});
  assert.equal(s.players.p1.perks.r, T0);
  must(s, 'perkPick', { tree: 'rancher' });
  assert.equal(perksView(s, 'p1', T0 + HOUR).respecCost, RESPEC_ACORNS);
  assert.equal(run(s, 'perkRespec', {}, { now: T0 + HOUR }).code, 'COOLDOWN');
  const a2 = s.farm.wallet.acorns;
  const paid = run(s, 'perkRespec', { paid: true }, { now: T0 + HOUR });
  const r2 = paid.code === 'BIG_SPEND' ? must(s, 'perkRespec', { paid: true, confirm: ['BIG_SPEND'] }, { now: T0 + HOUR })
    : paid;
  assert.equal(evs(r2, 'perksReset')[0].acorns, RESPEC_ACORNS);
  assert.equal(s.farm.wallet.acorns, a2 - RESPEC_ACORNS);
  assert.equal(s.players.p1.perks.r, T0, 'a paid respec leaves the weekly clock alone');
  assert.deepEqual(s.players.p1.perks.t, {});
  s.farm.wallet.acorns = 0;
  must(s, 'perkPick', { tree: 'rancher' }, { now: T0 + 2 * HOUR });
  assert.equal(run(s, 'perkRespec', { paid: true, confirm: ['BIG_SPEND'] }, { now: T0 + 2 * HOUR }).code, 'NO_ACORNS');
  assert.equal(run(s, 'perkRefund', { tree: 'rancher', confirm: ['BIG_SPEND'] }, { now: T0 + 2 * HOUR }).code,
    'NO_ACORNS');
  assert.deepEqual(validateState(s), []);
});

// ---- C: rotate ------------------------------------------------------------------------------------------------------

test('C: rotateSpot turns an object about its centre, nudges it to a free spot, and move accepts the answer', () => {
  const s = farmAt(12, { coins: 100_000 });
  const bench = placeDef(s, 'sunset_bench');
  const o = { ...obj(s, bench) };
  const r1 = rotateSpot(s, bench, 1);
  assert.equal(r1.code, null);
  assert.equal(r1.rot, (o.rot + 1) & 3);
  assert.ok(Math.abs(r1.x - o.x) <= 1 && Math.abs(r1.z - o.z) <= 1);
  must(s, 'move', { id: bench, x: r1.x, z: r1.z, rot: r1.rot });
  const back = rotateSpot(s, bench, -1);
  assert.equal(back.rot, o.rot);
  for (let k = 0; k < 4; k++) {
    const r = rotateSpot(s, idOf(s, 'barn'), 1);
    if (r.code) break;
    must(s, 'move', { id: idOf(s, 'barn'), ...{ x: r.x, z: r.z, rot: r.rot } }, { seq: 700 + k });
  }
  assert.equal(rotateSpot(s, idOf(s, 'stump') ?? idOf(s, 'rock'), 1).code, 'LOCKED');
  assert.equal(rotateSpot(s, 'nope.1.0').code, 'NOT_FOUND');
  assert.deepEqual(validateState(s), []);
});

// ---- 3: rabbits (content's animal; the rules are generic) ----------------------------------------------------------

test('3: rabbits live in a hutch, eat their greens and give their product like every animal', () => {
  const rabbit = defOf('rabbit');
  if (!rabbit) return;                                  // content ships it in this wave
  const s = farmAt(Math.max(rabbit.unlock, defOf('hutch').unlock), { coins: 500_000 });
  placeDef(s, 'hutch', { confirm: BIG });
  must(s, 'buyAnimal', { def: 'rabbit', adult: true, confirm: BIG });
  const id = idsOf(s, 'rabbit')[0];
  give(s, rabbit.feed, 5);
  must(s, 'feed', { id });
  const r = must(s, 'collect', { id }, { now: obj(s, id).readyAt });
  assert.ok(evs(r, 'collected').length + evs(r, 'collect').length >= 0);
  assert.ok((s.farm.inventory[rabbit.product] ?? 0) + (s.farm.inventory[rabbit.premium] ?? 0) >= 1);
  assert.deepEqual(validateState(s), []);
});

// ---- older saves -----------------------------------------------------------------------------------------------------

test('an older save gains the wave-4 fields on boot (backfill) and stays valid', () => {
  const s = createFarm(7, T0);
  s.players.p1 = createPlayer('Rowan', '#2BB3A3', T0);
  delete s.farm.weeds;
  delete s.players.p1.avatar;
  s.players.p1.pet = { kind: 'dog', name: 'Rex', at: T0, fed: null, pets: null, treasure: null };
  const filled = backfill(s, { now: T0 + DAY });
  assert.ok(filled.includes('farm.weeds') && filled.includes('players.p1.avatar'));
  assert.deepEqual(validateState(s), []);
  assert.equal(breedOf(s.players.p1.pet), petBreeds('dog')[0].id);
  assert.deepEqual(plain(s.farm.weeds), { t: {}, day: 0, n: 0 });
});
