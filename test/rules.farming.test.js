// Crop rules (GDD §3.1 rules 1-10, §3.7, §9 #1-#4, #10, #31, #41, #49): plant strokes, watering and the partner
// tend, compost, harvest yields (blue ribbon, mastery, scarecrow), Freshness, seasons, Uproot, the seed basket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { cropOf, CONTENT, GROWTH, COOP, SAFETY, BOOSTS, xpForLevel, live } from '../shared/content/index.js';
import { READY_GRACE_MS } from '../shared/content/config.js';
import { validateState } from '../shared/rules/state.js';
import { harvestOf } from '../shared/rules/actions/farming.js';
import { hash32, roll } from '../shared/rules/rng.js';
import { makeCtx } from '../shared/rules/index.js';
import { seasonOf } from '../shared/rules/calendar.js';
import { mulBp, cutMs } from '../shared/rules/economy.js';
import { makeFarm, run, must, T0, farmAt, give, placeDef, evs, MIN, obj } from './helpers/rules.js';
import { canPlace } from '../shared/rules/grid.js';
import { notLiveDef } from './helpers/content.js';
import { weatherAt, hourIndex, FRESH_SUNNY_HOURS } from '../shared/rules/time.js';
import { rainHoursDue } from '../shared/rules/actions/farming.js';

/** A free 1x1 tile within `r` tiles (Chebyshev) of some starter plot, and that plot. */
function tileNearPlot(s, def, r) {
  for (const id of PLOTS) {
    const p = s.farm.objects[id];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) if (canPlace(s, def, p.x + dx, p.z + dz, 0) === null) return { at: [p.x + dx, p.z + dz], plot: id };
    }
  }
  throw new Error(`no free tile near a plot for ${def}`);
}
const cheb = (o, [x, z]) => Math.max(Math.abs(o.x - x), Math.abs(o.z - z));

const WHEAT = cropOf('wheat');
const PLOT = 'home.0.0';
const PLOTS = Array.from({ length: 16 }, (_, i) => `home.0.${i}`);
const spent = (s) => s.farm.stats['coins.spent'] ?? 0;

test('plant: pays the seed and stamps server time; the crop record is canonical', () => {
  const s = makeFarm();
  const r = must(s, 'plant', { id: PLOT, crop: 'wheat' }, { now: T0 + 5 });
  assert.equal(spent(s), WHEAT.seed);
  assert.deepEqual(s.farm.objects[PLOT].crop, { def: 'wheat', plantedAt: T0 + 5, readyAt: T0 + 5 + WHEAT.growMs, by: 'p1',
    cycle: 0, cut: 0, paid: WHEAT.seed });
  assert.deepEqual(evs(r, 'planted').map((e) => e.id), [PLOT]);
  assert.deepEqual(validateState(s), []);
});

test('plant: every check code', () => {
  const s = makeFarm();
  assert.equal(run(s, 'plant', { id: 'nope.1.0', crop: 'wheat' }).code, ERR.NOT_FOUND);
  assert.equal(run(s, 'plant', { id: 'home.1.0', crop: 'wheat' }).code, ERR.NOT_FOUND, 'the farmhouse is no plot');
  assert.equal(run(s, 'plant', { id: PLOT, crop: 'carrot' }).code, ERR.LOCKED);        // carrot is L2
  assert.equal(run(s, 'plant', { id: PLOT, crop: notLiveDef('crops').id }).code, ERR.BAD_ARGS, 'a later milestone is not live');
  must(s, 'plant', { id: PLOT, crop: 'wheat' });
  assert.equal(run(s, 'plant', { id: PLOT, crop: 'wheat' }).code, ERR.OCCUPIED);
  s.farm.wallet.coins = WHEAT.seed - 1;
  assert.equal(run(s, 'plant', { id: 'home.0.1', crop: 'wheat' }).code, ERR.NO_COINS);
  assert.equal(run(s, 'plant', { id: 'home.0.1', ids: ['home.0.2'], crop: 'wheat' }).code, ERR.BAD_ARGS, 'id XOR ids');
  assert.equal(run(s, 'plant', { ids: ['home.0.1', 'home.0.1'], crop: 'wheat' }).code, ERR.BAD_ARGS, 'distinct');
  assert.equal(run(s, 'plant', { crop: 'wheat' }).code, ERR.BAD_ARGS);
});

test('plant stroke: partial success in stroke order; stops paying when the coins run out', () => {
  const s = makeFarm();
  must(s, 'plant', { id: 'home.0.1', crop: 'wheat' });
  s.farm.wallet.coins = WHEAT.seed * 3;
  const r = must(s, 'plant', { ids: ['home.0.0', 'home.0.1', 'nope.1.0', 'home.0.2', 'home.0.3', 'home.0.4'], crop: 'wheat' });
  assert.deepEqual(evs(r, 'planted').map((e) => e.id), ['home.0.0', 'home.0.2', 'home.0.3']);
  assert.equal(s.farm.wallet.coins, 0);
  assert.equal(s.farm.objects['home.0.4'].crop, null);
  assert.equal(run(s, 'plant', { ids: ['home.0.4', 'home.0.5'], crop: 'wheat' }).code, ERR.NO_COINS, 'nothing planted: the first reason');
  const ledgerRows = Object.values(s.farm.ledger.rows).filter((row) => row.reason === 'seed');
  assert.equal(ledgerRows.length, 2, 'one ledger row per stroke, not per plot');
});

test('plant: free plantings (seed packets, the seed basket) are used first; golden seeds ride along', () => {
  const s = farmAt(8);
  s.farm.seeds.wheat = 2;
  s.farm.golden = 1;
  const before = spent(s);
  const r = must(s, 'plant', { ids: ['home.0.0', 'home.0.1', 'home.0.2'], crop: 'wheat' });
  assert.equal(spent(s) - before, WHEAT.seed, 'two packets, one paid');
  assert.equal(Object.hasOwn(s.farm.seeds, 'wheat'), false);
  assert.deepEqual(evs(r, 'planted').map((e) => Boolean(e.packet)), [true, true, false]);
  assert.equal(run(s, 'plant', { ids: ['home.0.3', 'home.0.4'], crop: 'wheat', golden: true }).ok, true);
  assert.equal(s.farm.golden, 0);
  assert.equal(s.farm.objects['home.0.3'].crop.golden, true);
  assert.equal(s.farm.objects['home.0.4'].crop, null, 'no golden seed left for the second plot');
  assert.equal(run(s, 'plant', { id: 'home.0.5', crop: 'wheat', golden: true }).code, ERR.NO_ITEMS);
});

test('plant: in season (fixed at planting) and mastery ★2 cut the grow time, never below half', () => {
  const s = farmAt(9);
  const crop = 'pumpkin';                               // autumn crop; T0 is 21 September
  assert.equal(seasonOf(T0, s.meta.tz), 'autumn');
  must(s, 'plant', { id: PLOT, crop });
  const c = s.farm.objects[PLOT].crop;
  assert.equal(c.season, true);
  assert.equal(c.cut, GROWTH.season.timeBp);
  assert.equal(c.readyAt - c.plantedAt, cutMs(cropOf(crop).growMs, GROWTH.season.timeBp));
  s.farm.mastery[crop] = cropOf(crop).mastery[1];        // ★2: -10 % more
  must(s, 'plant', { id: 'home.0.1', crop });
  assert.equal(s.farm.objects['home.0.1'].crop.cut, GROWTH.season.timeBp + 1000);
  assert.equal(cutMs(1000, 9000), 500, 'cuts add with a 50 % floor (GDD §4.8)');
  must(s, 'plant', { id: 'home.0.2', crop: 'wheat' });
  assert.equal(s.farm.objects['home.0.2'].crop.season, undefined, 'wheat is a winter crop');
});

test('water: -15 % of the base time once, the OTHER player adds -5 %; fast crops cannot be watered', () => {
  const s = farmAt(6);
  const tomato = cropOf('tomato');                       // 30 min: waterable
  must(s, 'plant', { id: PLOT, crop: 'tomato' }, { now: T0 });
  must(s, 'plant', { id: 'home.0.1', crop: 'wheat' }, { now: T0 });
  assert.equal(run(s, 'water', { id: 'home.0.1' }).code, ERR.NOT_NEEDED, 'no click tax on the fast loop (RC-18)');
  assert.equal(run(s, 'water', { id: 'home.0.2' }).code, ERR.EMPTY);
  const ready0 = s.farm.objects[PLOT].crop.readyAt;
  const r = must(s, 'water', { id: PLOT }, { pid: 'p1', now: T0 + MIN });
  assert.equal(s.farm.objects[PLOT].crop.readyAt, ready0 - mulBp(tomato.growMs, GROWTH.water.cropBp));
  assert.deepEqual(evs(r, 'watered')[0], { e: 'watered', id: PLOT, kind: 'crop', by: 'p1', tend: false,
    savedMs: mulBp(tomato.growMs, GROWTH.water.cropBp) });
  assert.equal(run(s, 'water', { id: PLOT }, { pid: 'p1', now: T0 + MIN }).code, ERR.SELF_ONLY, 'no double watering');
  must(s, 'water', { id: PLOT }, { pid: 'p2', now: T0 + MIN });
  assert.equal(s.farm.objects[PLOT].crop.readyAt, ready0 - mulBp(tomato.growMs, GROWTH.water.cropBp + COOP.partnerTend.bp));
  assert.equal(s.farm.objects[PLOT].crop.tend, 'p2');
  assert.equal(run(s, 'water', { id: PLOT }, { pid: 'p2', now: T0 + MIN }).code, ERR.ALREADY_DONE);
  assert.equal(run(s, 'water', { id: PLOT }, { now: s.farm.objects[PLOT].crop.readyAt }).code, ERR.ALREADY_DONE);
  assert.deepEqual(validateState(s), []);
});

test('water: cuts honour the 50 % floor of the base time (season + mastery + water + tend)', () => {
  const s = farmAt(12);
  const crop = cropOf('pumpkin');
  s.farm.mastery.pumpkin = crop.mastery[2];              // ★3 (includes ★2's -10 %)
  must(s, 'plant', { id: PLOT, crop: 'pumpkin' });
  const c0 = s.farm.objects[PLOT].crop;
  assert.equal(c0.cut, 2000);
  must(s, 'water', { id: PLOT }, { pid: 'p1' });
  must(s, 'water', { id: PLOT }, { pid: 'p2' });
  const c = s.farm.objects[PLOT].crop;
  assert.equal(c.cut, 2000 + 1500 + 500);
  assert.equal(c.readyAt - c.plantedAt, cutMs(crop.growMs, 4000));
  assert.ok(c.readyAt - c.plantedAt >= crop.growMs / 2);
});

test('a Sprinkler waters crops planted near it, at planting; either player may then tend', () => {
  const s = farmAt(10);
  const { at, plot: near } = tileNearPlot(s, 'sprinkler', 2);
  placeDef(s, 'sprinkler', { at });
  const far = PLOTS.find((k) => cheb(s.farm.objects[k], at) > 2);
  assert.ok(far, 'some starter plot is out of reach');
  must(s, 'plant', { ids: [near, far], crop: 'tomato' });
  assert.equal(s.farm.objects[near].crop.water, 'sys');
  assert.equal(s.farm.objects[far].crop.water, undefined);
  must(s, 'water', { id: near }, { pid: 'p1' });
  assert.equal(s.farm.objects[near].crop.tend, 'p1');
});

test('compost: L8, one per plot (before planting or growing, never once ripe), used up at harvest', () => {
  const s = farmAt(7);
  give(s, 'compost', 2);
  assert.equal(run(s, 'compost', { id: PLOT }).code, ERR.LOCKED);
  s.farm.xp = xpForLevel(8);
  must(s, 'compost', { id: PLOT });
  assert.equal(run(s, 'compost', { id: PLOT }).code, ERR.ALREADY_DONE);
  must(s, 'plant', { id: 'home.0.1', crop: 'wheat' }, { now: T0 });
  assert.equal(run(s, 'compost', { id: 'home.0.1' }, { now: T0 + WHEAT.growMs }).code, ERR.ALREADY_DONE);
  must(s, 'compost', { id: 'home.0.2' });
  assert.equal(run(s, 'compost', { id: 'home.0.3' }).code, ERR.NO_ITEMS);
  must(s, 'plant', { id: PLOT, crop: 'wheat' }, { now: T0 });
  const r = must(s, 'harvest', { id: PLOT }, { now: T0 + WHEAT.growMs });
  const h = evs(r, 'harvested')[0];
  assert.ok(h.qty >= WHEAT.yield + GROWTH.compost.bonusUnits);
  assert.equal(s.farm.objects[PLOT].compost, undefined);
});

test('harvest: yield, Freshness, ribbons and bonus rolls are pure functions of (state, plot, cycle)', () => {
  const s = farmAt(12);
  give(s, 'compost', 16);
  must(s, 'compost', { ids: PLOTS });
  must(s, 'plant', { ids: PLOTS, crop: 'wheat' }, { now: T0 });
  const ctx = makeCtx(s, { now: T0 + WHEAT.growMs, pid: 'p2', cid: 'abcdef', seq: 1, grace: 250 });
  const want = PLOTS.map((id) => harvestOf(s, id, ctx));
  // the same keys on another client: identical rolls
  const twin = JSON.parse(JSON.stringify(s));
  assert.deepEqual(PLOTS.map((id) => harvestOf(twin, id, ctx)), want);
  for (const h of want) {
    assert.ok(h.fresh);
    assert.equal(h.xp100, WHEAT.xp100 + mulBp(WHEAT.xp100, GROWTH.fresh.xpBonusBp));
    assert.equal(h.qty, WHEAT.yield + h.bonus);
    assert.ok(h.bonus >= GROWTH.compost.bonusUnits + (h.ribbon ? 1 : 0));
  }
  const r = must(s, 'harvest', { ids: PLOTS }, { pid: 'p2', now: T0 + WHEAT.growMs });
  const got = evs(r, 'harvested');
  assert.deepEqual(got.map((e) => [e.qty, e.ribbon, e.bonus]), want.map((h) => [h.qty, h.ribbon, h.bonus]));
  assert.equal(s.farm.inventory.wheat, want.reduce((n, h) => n + h.qty, 0));
  // the ribbon roll is exactly the documented key
  for (const [i, id] of PLOTS.entries()) {
    const chance = Math.min(GROWTH.compost.maxBp, GROWTH.compost.ribbonBp);
    assert.equal(got[i].ribbon, Math.floor(roll(s.meta.farmSeed, 'ribbon', id, 0) * 10_000) < chance);
  }
});

test('harvest: a golden seed is a guaranteed blue ribbon (+1 unit)', () => {
  const s = farmAt(8);
  s.farm.golden = 1;
  must(s, 'plant', { id: PLOT, crop: 'wheat', golden: true }, { now: T0 });
  const r = must(s, 'harvest', { id: PLOT }, { now: T0 + WHEAT.growMs });
  const h = evs(r, 'harvested')[0];
  assert.equal(h.ribbon, true);
  assert.ok(h.qty >= WHEAT.yield + GROWTH.compost.ribbonUnits);
});

test('harvest: Freshness window, timer boundaries with server grace and client grace 0', () => {
  const s = makeFarm();
  must(s, 'plant', { ids: [PLOT, 'home.0.1'], crop: 'wheat' }, { now: T0 });
  const readyAt = T0 + WHEAT.growMs;
  assert.equal(run(s, 'harvest', { id: PLOT }, { now: readyAt - READY_GRACE_MS - 1 }).code, ERR.NOT_READY);
  assert.equal(run(s, 'harvest', { id: PLOT }, { now: readyAt - 1, grace: 0 }).code, ERR.NOT_READY);
  assert.equal(run(s, 'harvest', { id: 'home.0.2' }, { now: readyAt }).code, ERR.EMPTY);
  assert.equal(run(s, 'harvest', { id: 'nope.1.0' }, { now: readyAt }).code, ERR.NOT_FOUND);
  const r = must(s, 'harvest', { id: PLOT }, { now: readyAt - READY_GRACE_MS });
  assert.equal(s.farm.objects[PLOT].crop, null);
  assert.equal(s.farm.objects[PLOT].cycle, 1);
  assert.equal(evs(r, 'harvested')[0].fresh, true);
  const late = must(s, 'harvest', { id: 'home.0.1' }, { now: readyAt + WHEAT.freshMs + 1 });
  assert.equal(evs(late, 'harvested')[0].fresh, false, 'after the Fresh window the crop just waits (no XP bonus)');
  assert.equal(evs(late, 'harvested')[0].xp, WHEAT.xp);
  assert.deepEqual(validateState(s), []);
});

test('harvest: at 2 x Barn capacity the crop waits ripe on the plot (GDD §3.6, §9 #4)', () => {
  const s = makeFarm();
  must(s, 'plant', { ids: PLOTS.slice(0, 4), crop: 'wheat' }, { now: T0 });
  s.farm.inventory.egg = 200;
  s.farm.overflow.egg = 199;                             // 1 below 2 x 200
  const r = must(s, 'harvest', { ids: PLOTS.slice(0, 4) }, { now: T0 + WHEAT.growMs });
  assert.equal(evs(r, 'harvested').length, 1, 'the stroke takes plots while below 2 x capacity');
  assert.equal(s.farm.overflow.wheat, WHEAT.yield, 'everything above capacity is overflow');
  assert.equal(run(s, 'harvest', { id: 'home.0.1' }, { now: T0 + WHEAT.growMs }).code, ERR.STORAGE_FULL);
  assert.notEqual(s.farm.objects['home.0.1'].crop, null, 'nothing destroyed');
});

test('harvest: a Scarecrow adds a 5 % bonus-unit chance to nearby crops (never stacking)', () => {
  const s = farmAt(10);
  const a = tileNearPlot(s, 'scarecrow', 1);
  placeDef(s, 'scarecrow', { at: a.at });
  const b = tileNearPlot(s, 'golden_scarecrow', 1);
  placeDef(s, 'golden_scarecrow', { at: b.at, confirm: ['BIG_SPEND'] });
  const plot = a.plot;
  must(s, 'plant', { id: plot, crop: 'wheat' }, { now: T0 });
  // find the plot cycles where the scarecrow roll hits and check the bonus appears exactly then
  const hits = [];
  for (let cycle = 0; cycle < 40; cycle++) {
    s.farm.objects[plot].cycle = cycle;
    s.farm.objects[plot].crop.cycle = cycle;
    const ctx = makeCtx(s, { now: T0 + WHEAT.growMs, pid: 'p1', cid: 'abcdef', seq: 1 });
    const h = harvestOf(s, plot, ctx);
    const hit = Math.floor(roll(s.meta.farmSeed, 'scarecrow', plot, cycle) * 10_000) < 500;
    assert.equal(h.bonus, hit ? 1 : 0);
    hits.push(hit);
  }
  assert.ok(hits.some(Boolean) && !hits.every(Boolean));
});

test('uproot: refunds seeds (and packets, golden seeds) inside the undo window only; never a ripe crop', () => {
  const s = farmAt(8);
  const xp0 = s.farm.xp;
  s.farm.golden = 1;
  must(s, 'plant', { id: PLOT, crop: 'tomato', golden: true }, { now: T0 });
  const coins = s.farm.wallet.coins;
  const r = must(s, 'uproot', { id: PLOT }, { now: T0 + SAFETY.undoMs - 1 });
  assert.equal(s.farm.wallet.coins, coins + cropOf('tomato').seed);
  assert.equal(s.farm.golden, 1);
  assert.deepEqual(evs(r, 'uprooted')[0], { e: 'uprooted', id: PLOT, crop: 'tomato', by: 'p1', refund: cropOf('tomato').seed });
  must(s, 'plant', { id: PLOT, crop: 'tomato' }, { now: T0 });
  const c2 = s.farm.wallet.coins;
  must(s, 'uproot', { id: PLOT }, { now: T0 + SAFETY.undoMs });
  assert.equal(s.farm.wallet.coins, c2, 'after the window: nothing back');
  must(s, 'plant', { id: PLOT, crop: 'wheat' }, { now: T0 });
  assert.equal(run(s, 'uproot', { id: PLOT }, { now: T0 + WHEAT.growMs }).code, ERR.ALREADY_DONE);
  assert.equal(run(s, 'uproot', { id: 'home.0.5' }).code, ERR.EMPTY);
  assert.equal(s.farm.xp, xp0, 'no XP either way (§9 #10)');
});

test('seed basket: only when broke with nothing growing or sellable, once a day', () => {
  const s = makeFarm();
  assert.equal(run(s, 'seedBasket', {}).code, ERR.LOCKED, 'not broke');
  s.farm.wallet.coins = WHEAT.seed - 1;
  give(s, 'wheat', 1);
  assert.equal(run(s, 'seedBasket', {}).code, ERR.LOCKED, 'wheat could be sold');
  s.farm.inventory = {};
  must(s, 'seedBasket', {});
  assert.equal(s.farm.seeds.wheat, BOOSTS.seedBasket.plantings);
  assert.equal(run(s, 'seedBasket', {}).code, ERR.ALREADY_DONE);
  must(s, 'plant', { ids: PLOTS.slice(0, 12), crop: 'wheat' });
  assert.equal(s.farm.wallet.coins, WHEAT.seed - 1, 'the basket plantings are free');
});

test('rng: deterministic, keyed, uniform enough', () => {
  assert.equal(hash32(1, 'a', 2), hash32(1, 'a', 2));
  assert.notEqual(hash32(1, 'ab', 'c'), hash32(1, 'a', 'bc'));
  assert.notEqual(hash32(1, 2 ** 40), hash32(1, 0));
  const s = makeFarm({ seed: 99 });
  const ctx = makeCtx(s, { now: T0, pid: 'p1', cid: 'abcdef', seq: 1 });
  assert.equal(ctx.rng('bonus', PLOT, 3), roll(99, 'bonus', PLOT, 3));
  let sum = 0;
  for (let i = 0; i < 10_000; i++) sum += roll(7, 'u', i);
  assert.ok(Math.abs(sum / 10_000 - 0.5) < 0.02);
  assert.throws(() => hash32(0.5));
});

test('a throwing rule rolls back completely and reports INTERNAL', () => {
  const s = makeFarm();
  give(s, 'wheat', 1);
  s.farm.wallet.coins = Number.MAX_SAFE_INTEGER;        // earning overflows the safe-integer guard
  const snap = JSON.stringify(s);
  const r = run(s, 'sell', { item: 'wheat', qty: 1 });
  assert.equal(r.code, ERR.INTERNAL);
  assert.equal(JSON.stringify(s), snap);
});

test('the starter farm: 16 free plots, landmarks, fence, paths and debris; Coop and Feed Mill in the tray', () => {
  const s = makeFarm();
  assert.equal(PLOTS.every((id) => obj(s, id).def === 'plot'), true);
  assert.deepEqual(s.farm.storage, { coop: 1, feed_mill: 1 });
  assert.ok(Object.values(s.farm.objects).some((o) => o.def === 'farmhouse'));
  assert.ok(Object.values(s.farm.objects).filter((o) => o.origin === 'home').length >= 20);
  assert.deepEqual(validateState(s), []);
  assert.equal(CONTENT.plots.get('plot').free, 16);
});

test('crop XP accrues in hundredths per farm: Wheat pays 0.5 XP a plot, Fresh +10 % pays on every crop (RC-13)', () => {
  assert.equal(WHEAT.xp100, 50, 'V 2 x yield 2 / 8 = 0.5 XP');
  const s = farmAt(3);
  // only the harvests' own XP is measured: story cards, Almanac tasks and other goals pay XP of their own
  const cropXp = (r) => evs(r, 'harvested').reduce((n, e) => n + e.xp, 0);
  must(s, 'plant', { ids: PLOTS, crop: 'wheat' }, { now: T0 });
  // stale: 16 plots x 0.50 = 8 XP exactly
  const r = must(s, 'harvest', { ids: PLOTS }, { now: T0 + WHEAT.growMs + WHEAT.freshMs + 1 });
  assert.equal(cropXp(r), 8);
  assert.equal(s.farm.xpFrac, 0);
  // fresh: 16 x 0.55 = 8.80 XP: 8 paid, 0.80 carried in farm.xpFrac
  must(s, 'plant', { ids: PLOTS, crop: 'wheat' }, { now: T0 + 10 * MIN });
  const f = must(s, 'harvest', { ids: PLOTS }, { now: T0 + 10 * MIN + WHEAT.growMs });
  assert.equal(cropXp(f), 8);
  assert.equal(s.farm.xpFrac, 80);
  for (const crop of ['wheat', 'carrot', 'corn']) {
    const c = cropOf(crop);
    assert.ok(mulBp(c.xp100, GROWTH.fresh.xpBonusBp) > 0, `Fresh pays on ${crop}`);
  }
  assert.deepEqual(validateState(s), []);
});

test('no crop out-earns the others on XP per plot-minute the way 1-XP Wheat did (RC-13)', () => {
  const per = (c) => c.xp100 / (c.growMs / 60_000);
  const crops = live('crops');
  const wheat = per(cropOf('wheat'));
  const best = Math.max(...crops.filter((c) => c.id !== 'wheat').map(per));
  assert.ok(wheat <= best * 1.05, `Wheat ${wheat / 100} XP/plot-min vs best other ${best / 100}`);
});

test('a new farm\'s first two hours are sunny: no rain on the first arrival, and none waters its first crops', () => {
  // seeds whose creation hour or the next would rain without the rule
  let tried = 0;
  for (let seed = 1; seed < 4000 && tried < 5; seed++) {
    const h0 = hourIndex(T0);
    const wet = [h0, h0 + 1].filter((h) => weatherAt(seed, h) === 'rain');
    if (!wet.length) continue;
    tried++;
    for (const h of [h0, h0 + 1]) assert.equal(weatherAt(seed, h, T0), 'sunny', `seed ${seed} hour ${h - h0}`);
    assert.equal(weatherAt(seed, h0 + FRESH_SUNNY_HOURS, T0), weatherAt(seed, h0 + FRESH_SUNNY_HOURS), 'then as before');
    const s = makeFarm({ seed });
    assert.deepEqual(rainHoursDue(s, (h0 + FRESH_SUNNY_HOURS) * 3_600_000 - 1), [], 'the rain catch-up skips them too');
  }
  assert.equal(tried, 5);
});

