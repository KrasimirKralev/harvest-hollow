// Wave 4b (the owners' wish list of 2026-10-05), the rules and content half: balloon loot crates (`_crate`,
// openCrate), the Acorn shop's relics (buyRelic, waterAll, farmhand, turnTime and the passive ones), animal homes
// that grow with their flock, tree ages, production queues reordered (reorder) and finished item by item
// (hurry {id, k}), the Goal Tracker's cards, older saves backfilled, and RULES_VERSION.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farmAt, give, must, run, evs, placeDef, idsOf, obj, T0, HOUR, MIN, allLand, freeSpot } from
  './helpers/rules.js';
import { sys, plain } from './helpers.js';
import { ERR } from '../shared/net/protocol.js';
import {
  CRATES, RELICS, HOME_GROWTH, TREE_AGE, BOOSTS, GROWTH, defOf, treeOf, xpForLevel, eHours, levelRow, relicOf,
  validateContent, cloneTables, CONTENT,
} from '../shared/content/index.js';
import { RULES_VERSION, makeCtx, runAction } from '../shared/rules/index.js';
import { validateState, createFarm } from '../shared/rules/state.js';
import { resetGrid } from '../shared/rules/grid-cache.js';
import {
  capacityOf, occupantsOf, homeMaxOf, sizeOf, objTiles, tileOwner, getGrid, canFit,
} from '../shared/rules/grid.js';
import { barnCap, mulBp } from '../shared/rules/economy.js';
import { barnCapacity } from '../shared/content/index.js';
import { dueSystemActions, nextSystemDueAt } from '../shared/rules/system.js';
import {
  passOf, dropMomentOf, crateDue, crateLoot, cratesOn, crateNextAt, crateSpot,
} from '../shared/rules/actions/crates.js';
import { relicView, hasRelic, relicLuckBp } from '../shared/rules/relics.js';
import { waterAllTargets, farmhandTargets, turnerTargets } from '../shared/rules/actions/relics.js';
import { homeGrowth, animalBuyPlan, animalPrice } from '../shared/rules/actions/animals.js';
import { treeAgeOf, rainbowFruits, treeHarvestOf } from '../shared/rules/actions/trees.js';
import { harvestOf } from '../shared/rules/actions/farming.js';
import { queueView, hurryCost } from '../shared/rules/actions/boosts.js';
import { rotateSpot, resaleOf } from '../shared/rules/actions/decor.js';
import { goals, w4bCandidates } from '../shared/rules/goals.js';
import { backfill } from '../server/migrations.js';

const DAY = 24 * HOUR;
const BIG = { confirm: ['BIG_SPEND'] };
const idOf = (s, def) => idsOf(s, def)[0];
const ctxOf = (s, o = {}) => makeCtx(s, { now: T0, pid: 'p1', cid: 'tstcid', seq: 1, ...o });

// ---- balloon crates -------------------------------------------------------------------------------------------

/** A farm at `level` whose last handled pass is the one before `now`'s. */
function crateFarm(level = 12, now = T0) {
  const s = farmAt(level);
  s.farm.crates.k = passOf(now) - 1;
  return s;
}

/** Run `_crate` at the drop moments of the passes after `from` until one drops a crate; returns [r, now]. */
function dropOne(s, from = passOf(T0)) {
  for (let k = from + 1; k < from + 200; k++) {
    const now = dropMomentOf(k);
    if (!crateDue(s, now)) continue;
    const r = sys(s, '_crate', {}, now);
    assert.equal(r.ok, true, r.code);
    if (evs(r, 'crateDropped').length) return [r, now];
  }
  throw new Error('no crate in 200 passes');
}

test('crates: the balloon schedule is the renderer\'s (10 min, mid-flight drop); a new farm starts at its pass', () => {
  assert.equal(CRATES.everyMs, 10 * MIN);
  assert.ok(CRATES.dropAtMs > 0 && CRATES.dropAtMs < CRATES.flightMs && CRATES.flightMs < CRATES.everyMs);
  const s = createFarm(7, T0);
  assert.equal(s.farm.crates.k, passOf(T0), 'no catch-up for the time before the farm existed');
  assert.equal(dropMomentOf(passOf(T0)) <= T0, true);
  assert.equal(dropMomentOf(passOf(T0) + 1) > T0, true);
  assert.deepEqual(s.farm.relics, {});
});

test('crates: _crate is due once a pass from its level, clears its condition; nextSystemDueAt names the next', () => {
  const low = crateFarm(CRATES.unlock - 1);
  assert.equal(crateDue(low, T0), false, 'below the unlock level: no balloon crates');
  const s = crateFarm(12);
  assert.equal(crateDue(s, T0), true);
  assert.ok(dueSystemActions(s, T0).some((d) => d.type === '_crate'));
  const r = sys(s, '_crate', {}, T0);
  assert.equal(r.ok, true);
  assert.equal(s.farm.crates.k, passOf(T0));
  assert.equal(crateDue(s, T0), false);
  assert.equal(sys(s, '_crate', {}, T0).code, ERR.ALREADY_DONE);
  const next = crateNextAt(s, T0);
  assert.ok(next <= dropMomentOf(passOf(T0) + 1));
  assert.ok(nextSystemDueAt(s, T0) <= next);
  assert.equal(crateDue(s, dropMomentOf(passOf(T0) + 1) - 1), cratesOn(s).some((id) => obj(s, id).until
    <= dropMomentOf(passOf(T0) + 1) - 1));
  assert.equal(crateDue(s, dropMomentOf(passOf(T0) + 1)), true);
});

test('crates: a drop is a 1 x 1 crate on a free tile of the land, keyed on the pass (same roll on a replay)', () => {
  const s = crateFarm(12);
  const twin = structuredClone(plain(s));
  const [r, now] = dropOne(s);
  const ev = evs(r, 'crateDropped')[0];
  const c = obj(s, ev.id);
  assert.deepEqual({ def: c.def, x: c.x, z: c.z, by: c.by, k: c.k, until: c.until },
    { def: CRATES.def, x: ev.x, z: ev.z, by: 'sys', k: passOf(now), until: now + CRATES.keepMs });
  assert.equal(defOf(c.def).kind, 'crate');
  assert.equal(tileOwner(s, c.x, c.z), ev.id, 'the crate stands on its tile');
  assert.deepEqual(validateState(s), []);
  // the same state and pass give the same crate on the same tile
  const [r2] = dropOne(twin);
  assert.deepEqual(evs(r2, 'crateDropped'), evs(r, 'crateDropped'));
  // and it blocks that tile for a build until it is opened
  assert.equal(canFit(s, 'flower_bed', c.x, c.z, 0), ERR.BLOCKED);
  assert.equal(s.farm.crates.n, 1);
});

test('crates: about dropBp of the passes drop one; at most maxOpen wait; a boot after downtime drops one', () => {
  const s = crateFarm(12);
  let drops = 0;
  const k0 = passOf(T0);
  for (let k = k0 + 1; k <= k0 + 400; k++) {
    const r = sys(s, '_crate', {}, dropMomentOf(k));
    if (!r.ok) continue;
    drops += evs(r, 'crateDropped').length;
    assert.ok(cratesOn(s).length <= CRATES.maxOpen, 'never more than maxOpen crates');
    for (const id of cratesOn(s)) must(s, 'openCrate', { id }, { now: dropMomentOf(k) + MIN });
  }
  const rate = drops / 400;
  assert.ok(Math.abs(rate - CRATES.dropBp / 10_000) < 0.08, `${drops} drops in 400 passes`);
  // nobody opens them: two wait, the third pass finds the farm full
  const f = crateFarm(12);
  let k = passOf(T0);
  while (cratesOn(f).length < CRATES.maxOpen) k = passOf(dropOne(f, k)[1]);
  const busy = sys(f, '_crate', {}, dropMomentOf(k + 1));
  assert.equal(evs(busy, 'crateDropped').length, 0, 'the farm already has two unopened crates');
  // a week offline: one `_crate` run catches up (expired crates to the Barn), at most one new crate
  const later = dropMomentOf(k + 1) + 7 * DAY;
  const r = sys(f, '_crate', {}, later);
  assert.equal(evs(r, 'crateOpened').filter((e) => e.auto).length, CRATES.maxOpen);
  assert.ok(evs(r, 'crateDropped').length <= 1);
  assert.equal(f.farm.crates.k, passOf(later));
  assert.deepEqual(validateState(f), []);
});

test('crates: openCrate pays coins (E-hours) and XP every time, at most one extra; the partner sees who opened', () => {
  const s = crateFarm(14);
  const [, now] = dropOne(s);
  const id = cratesOn(s)[0];
  const L = 14;
  const loot = crateLoot(s, id, ctxOf(s, { now, pid: 'p2' }));
  assert.ok(loot.coins >= eHours(L, CRATES.coinsBp[0]) && loot.coins <= eHours(L, CRATES.coinsBp[1]));
  const toNext = levelRow(L).xpToNext;
  assert.ok(loot.xp >= Math.floor(toNext * CRATES.xpBp[0] / 10_000));
  assert.ok(loot.xp <= Math.ceil(toNext * CRATES.xpBp[1] / 10_000));
  const coins = s.farm.wallet.coins;
  const xp = s.farm.xp;
  const r = must(s, 'openCrate', { id }, { pid: 'p2', now: now + MIN });
  const ev = evs(r, 'crateOpened')[0];
  assert.equal(ev.by, 'p2');
  assert.equal(ev.coins, loot.coins);
  assert.ok(s.farm.wallet.coins - coins >= loot.coins, 'the coins (a level-up on top may add its own)');
  assert.equal(s.farm.xp - xp, loot.xp, 'the crate\'s XP is the farm\'s');
  assert.ok(s.players.p2.xp > 0, 'and the opener\'s personal share');
  if (loot.extra?.k === 'acorns') assert.equal(ev.acorns, loot.extra.n);
  assert.equal(Object.hasOwn(s.farm.objects, id), false, 'the crate is gone');
  const row = Object.values(s.farm.feed.rows).find((x) => x.k === 'crate');
  assert.equal(row.by, 'p2');
  assert.equal(row.c, loot.coins);
  assert.equal(run(s, 'openCrate', { id }, { now: now + MIN }).code, ERR.NOT_FOUND, 'opened once');
  assert.equal(run(s, 'openCrate', { id: idOf(s, 'farmhouse') }).code, ERR.NOT_FOUND, 'only crates open');
  assert.deepEqual(validateState(s), []);
});

test('crates: the extras follow their weights over many crates; prediction (client ctx) equals the server', () => {
  const s = crateFarm(16);
  give(s, 'egg', 1);
  const counts = {};
  const N = 3000;
  const id = 'crate.x';
  for (let k = 0; k < N; k++) {
    s.farm.objects[id] = { def: CRATES.def, x: 30, z: 30, rot: 0, placedAt: T0, by: 'sys', k, until: T0 + HOUR };
    const l = crateLoot(s, id, ctxOf(s));
    const key = l.extra ? l.extra.k : 'none';
    counts[key] = (counts[key] ?? 0) + 1;
    if (l.extra?.n) {
      const row = CRATES.extras.find((x) => x.k === l.extra.k);
      assert.ok(l.extra.n >= row.n[0] && l.extra.n <= row.n[1]);
    }
    if (l.extra?.k === 'decor') assert.ok(CRATES.extras.find((x) => x.k === 'decor').pool.includes(l.extra.decor));
  }
  delete s.farm.objects[id];
  const total = CRATES.extras.reduce((a, x) => a + x.w, 0);
  for (const x of CRATES.extras) {
    const want = (x.w / total) * N;
    assert.ok(Math.abs((counts[x.k] ?? 0) - want) < want * 0.25 + 20, `${x.k}: ${counts[x.k]} vs ~${want.toFixed(0)}`);
  }
  // the client predicts with its own makeCtx (another cid and seq): the roll is keyed on the crate's pass only
  const [, now] = dropOne(s);
  const c = cratesOn(s)[0];
  const a = crateLoot(s, c, makeCtx(s, { now, pid: 'p1', cid: 'aaaaaa', seq: 7 }));
  const b = crateLoot(s, c, makeCtx(s, { now: now + 3000, pid: 'p1', cid: 'bbbbbb', seq: 99 }));
  assert.deepEqual(a, b);
});

test('crates: a crate nobody opens goes to the Barn after keepMs (by sys, no album find), no longer blocking', () => {
  const s = crateFarm(12);
  const [, now] = dropOne(s);
  const id = cratesOn(s)[0];
  const { x, z, until } = obj(s, id);
  assert.equal(until, now + CRATES.keepMs);
  s.farm.crates.k = passOf(until);                       // no new pass in between: only the expiry is due
  assert.equal(crateDue(s, until - 1), false);
  assert.equal(crateDue(s, until), true);
  const coins = s.farm.wallet.coins;
  const r = sys(s, '_crate', {}, until);
  const ev = evs(r, 'crateOpened').find((e) => e.id === id);
  assert.equal(ev.auto, true);
  assert.equal(ev.by, 'sys');
  assert.notEqual(ev.extra, 'collection');
  assert.ok(s.farm.wallet.coins >= coins + ev.coins);
  assert.equal(tileOwner(s, x, z), null);
  const row = Object.values(s.farm.feed.rows).find((f) => f.k === 'crate');
  assert.equal(row.auto, 1);
  assert.deepEqual(validateState(s), []);
});

test('crates: the spot is a tile with nothing on either layer; a full farm gets no crate', () => {
  const s = crateFarm(12);
  const spot = crateSpot(s, 5, () => 0.5);
  const g = getGrid(s);
  assert.equal(g.object[spot[1] * 64 + spot[0]], null);
  assert.equal(g.ground[spot[1] * 64 + spot[0]], null);
  // fill every free tile with a fence: no spot, and the pass still counts as handled
  for (let z = 0; z < 64; z++) {
    for (let xx = 0; xx < 64; xx++) {
      if (canFit(s, 'picket_fence', xx, z, 0) === null) {
        s.farm.objects[`f.${xx}.${z}`] = { def: 'picket_fence', x: xx, z, rot: 0, placedAt: T0, by: 'p1' };
        resetGrid(s);
      }
    }
  }
  assert.equal(crateSpot(s, 5, () => 0.5), null);
  for (let k = passOf(T0) + 1; k < passOf(T0) + 30; k++) {
    const r = sys(s, '_crate', {}, dropMomentOf(k));
    assert.equal(evs(r, 'crateDropped').length, 0);
  }
});

// ---- the Acorn shop's relics ----------------------------------------------------------------------------------

test('relics: eight unique items, priced for weeks of saving, one per farm; content validates them', () => {
  assert.equal(RELICS.length, 8);
  assert.deepEqual(RELICS.map((r) => r.id).sort(), ['farmhand', 'golden_barn', 'golden_can', 'golden_sprinkler',
    'growth_totem', 'lucky_clover', 'rainbow_tree', 'time_turner']);
  for (const r of RELICS) assert.ok(r.acorns >= 80 && r.acorns <= 300, `${r.id}: ${r.acorns} Acorns`);
  assert.deepEqual(validateContent(), []);
  const t = cloneTables();
  t.rules.RELICS[0].acorns = 0;
  t.rules.HOME_GROWTH.homes.coop.caps = [10, 20];
  t.rules.CRATES.extras.push({ k: 'decor', w: 5, pool: ['flower_bed'] });
  const errs = validateContent(t);
  assert.ok(errs.some((e) => e.includes('RELICS.lucky_clover')));
  assert.ok(errs.some((e) => e.includes('HOME_GROWTH.coop')));
  assert.ok(errs.some((e) => e.includes('decor.pool')));
});

test('buyRelic: level, Acorns and BIG_SPEND first; once only; a placed relic waits in the tray, never sold', () => {
  const s = farmAt(9, { acorns: 50 });
  assert.equal(run(s, 'buyRelic', { relic: 'golden_barn' }).code, ERR.LOCKED);
  assert.equal(run(s, 'buyRelic', { relic: 'nope' }).code, ERR.BAD_ARGS);
  assert.equal(run(s, 'buyRelic', { relic: 'lucky_clover' }).code, ERR.NO_ACORNS);
  s.farm.wallet.acorns = 500;
  s.farm.xp = xpForLevel(16);
  assert.equal(run(s, 'buyRelic', { relic: 'lucky_clover' }).code, ERR.BIG_SPEND, '90 Acorns is a big spend');
  const r = must(s, 'buyRelic', { relic: 'lucky_clover', ...BIG }, { pid: 'p2' });
  assert.equal(s.farm.wallet.acorns, 500 - relicOf('lucky_clover').acorns);
  assert.deepEqual(s.farm.relics.lucky_clover, { at: T0, by: 'p2' });
  assert.equal(evs(r, 'relicBought')[0].relic, 'lucky_clover');
  assert.ok(evs(r, 'bigSpend').length, 'the partner hears about it');
  assert.equal(run(s, 'buyRelic', { relic: 'lucky_clover', ...BIG }).code, ERR.ALREADY_DONE);
  must(s, 'buyRelic', { relic: 'golden_sprinkler', ...BIG }, { now: T0 + DAY });
  assert.equal(s.farm.storage.golden_sprinkler, 1);
  assert.equal(run(s, 'sellStored', { def: 'golden_sprinkler' }).code, ERR.LOCKED);
  const id = placeDef(s, 'golden_sprinkler');
  assert.equal(resaleOf(obj(s, id), T0), null);
  assert.equal(run(s, 'sellObject', { id }).code, ERR.LOCKED, 'a relic is for good');
  must(s, 'store', { id });
  assert.equal(s.farm.storage.golden_sprinkler, 1, 'stored, it can be put down again');
  assert.equal(run(s, 'buyRelic', { relic: 'golden_sprinkler', ...BIG }).code, ERR.ALREADY_DONE);
  must(s, 'buyRelic', { relic: 'rainbow_tree', ...BIG }, { now: T0 + 2 * DAY });
  assert.equal(s.farm.storage.rainbow_tree, 1);
  const view = relicView(s, T0);
  assert.deepEqual(view.filter((v) => v.owned).map((v) => v.id).sort(),
    ['golden_sprinkler', 'lucky_clover', 'rainbow_tree']);
  assert.deepEqual(['farmhand', 'golden_can'].map((r) => view.find((v) => v.id === r).code), ['NO_ACORNS', null]);
  assert.equal(view.find((v) => v.id === 'farmhand').have, s.farm.wallet.acorns);
  assert.deepEqual(validateState(s), []);
});

test('the Golden Barn: +30 % of the Barn\'s own capacity, at least 150', () => {
  const s = farmAt(16);
  const before = barnCap(s);
  s.farm.relics.golden_barn = { at: T0, by: 'p1' };
  const fx = relicOf('golden_barn').fx;
  assert.equal(barnCap(s), before + Math.max(fx.barnMin, mulBp(barnCapacity(s.farm.barn), fx.barnBp)));
  s.farm.barn = 7;
  assert.equal(barnCap(s) - barnCapacity(7), mulBp(barnCapacity(7), fx.barnBp) + (barnCap(s) - barnCapacity(7)
    - mulBp(barnCapacity(7), fx.barnBp)));
  assert.ok(barnCap(s) - barnCapacity(7) >= mulBp(barnCapacity(7), 3000));
});

test('the Golden Watering Can: one click waters every unwatered growing crop and tree; never a partner tend', () => {
  const s = farmAt(12);
  allLand(s);
  const plots = idsOf(s, 'plot').slice(0, 4);
  must(s, 'plant', { ids: plots, crop: 'potato' });
  const tree = placeDef(s, 'apple_tree');
  must(s, 'water', { id: plots[0] }, { pid: 'p2' });
  assert.equal(run(s, 'waterAll', {}).code, ERR.LOCKED);
  s.farm.relics.golden_can = { at: T0, by: 'p1' };
  const ctx = ctxOf(s);
  const targets = waterAllTargets(s, ctx);
  assert.ok(targets.includes(tree) && !targets.includes(plots[0]));
  const r = must(s, 'waterAll', {}, { now: T0 + MIN });
  assert.equal(evs(r, 'wateredAll')[0].n, targets.length);
  assert.equal(evs(r, 'watered').length, targets.length);
  assert.ok(evs(r, 'watered').every((e) => !e.tend));
  assert.equal(obj(s, plots[1]).crop.water, 'p1');
  assert.equal(obj(s, tree).water, 'p1');
  assert.equal(obj(s, plots[0]).crop.tend, undefined, 'the partner\'s tend stays theirs');
  assert.equal(run(s, 'waterAll', {}, { now: T0 + 2 * MIN }).code, ERR.NOT_NEEDED);
});

test('the Farmhand: once a farm day it tends every animal (goods in, the hungry fed; kept feed untouched)', () => {
  const s = farmAt(12);
  allLand(s);
  const coop = placeDef(s, 'coop');
  for (let i = 0; i < 4; i++) must(s, 'buyAnimal', { def: 'chicken', adult: true, home: coop, ...BIG });
  give(s, 'chicken_feed', 3);
  assert.equal(run(s, 'farmhand', {}).code, ERR.LOCKED);
  s.farm.relics.farmhand = { at: T0, by: 'p2' };
  const r = must(s, 'farmhand', {}, { now: T0 + MIN });
  assert.equal(evs(r, 'farmhandDone')[0].n, 3, 'three fed, the fourth has no feed left');
  assert.equal(evs(r, 'fed').length, 3);
  assert.equal(run(s, 'farmhand', {}, { now: T0 + 2 * HOUR }).code, ERR.COOLDOWN, 'once a farm day');
  // the next day: the products are collected, and Keep N keeps the last 2 feed
  give(s, 'chicken_feed', 2);
  must(s, 'keep', { item: 'chicken_feed', n: 2 });
  const next = T0 + DAY;
  const r2 = must(s, 'farmhand', {}, { now: next });
  assert.equal(evs(r2, 'collected').length, 3);
  assert.equal(evs(r2, 'fed').length, 0, 'kept feed is never used');
  assert.equal(s.farm.inventory.chicken_feed, 2);
  assert.deepEqual(validateState(s), []);
});

test('the Time Turner: once a farm day every queue on the farm finishes now; the chain stays valid', () => {
  const s = farmAt(12);
  allLand(s);
  const mill = placeDef(s, 'mill', BIG);
  const bakery = placeDef(s, 'bakery', BIG);
  give(s, 'wheat', 30);
  give(s, 'flour', 10);
  for (let i = 0; i < 2; i++) must(s, 'craft', { id: mill, recipe: 'flour' });
  must(s, 'craft', { id: bakery, recipe: 'bread' });
  s.farm.relics.time_turner = { at: T0, by: 'p1' };
  assert.deepEqual(turnerTargets(s, T0 + MIN), [bakery, mill].sort());
  const r = must(s, 'turnTime', {}, { now: T0 + MIN });
  assert.equal(evs(r, 'timeTurned')[0].n, 3);
  assert.ok(obj(s, mill).queue.every((q) => q.e <= T0 + MIN));
  assert.deepEqual(validateState(s), []);
  must(s, 'collectTray', { ids: [mill, bakery] }, { now: T0 + MIN });
  assert.equal(run(s, 'turnTime', {}, { now: T0 + 2 * MIN }).code, ERR.COOLDOWN);
  give(s, 'wheat', 3);
  must(s, 'craft', { id: mill, recipe: 'flour' }, { now: T0 + DAY });
  must(s, 'turnTime', {}, { now: T0 + DAY + MIN });
});

test('the Lucky Clover: its points on every harvest: crops even without Compost, fruit, animal goods', () => {
  const s = farmAt(12);
  allLand(s);
  const plot = idOf(s, 'plot');
  must(s, 'plant', { id: plot, crop: 'wheat' });
  const ripe = { now: T0 + HOUR };
  let without = 0;
  let withC = 0;
  const N = 2000;
  for (let c = 0; c < N; c++) {
    obj(s, plot).cycle = c;
    obj(s, plot).crop.cycle = c;
    if (harvestOf(s, plot, ctxOf(s, ripe)).ribbon) without++;
  }
  s.farm.relics.lucky_clover = { at: T0, by: 'p1' };
  assert.equal(relicLuckBp(s), relicOf('lucky_clover').fx.luckBp);
  for (let c = 0; c < N; c++) {
    obj(s, plot).cycle = c;
    obj(s, plot).crop.cycle = c;
    if (harvestOf(s, plot, ctxOf(s, ripe)).ribbon) withC++;
  }
  assert.equal(without, 0, 'no Compost, no Clover: no blue ribbon');
  const want = (N * relicLuckBp(s)) / 10_000;
  assert.ok(Math.abs(withC - want) < want * 0.35, `${withC} ribbons vs ~${want}`);
  const tree = placeDef(s, 'apple_tree');
  let fruit = 0;
  for (let c = 0; c < N; c++) {
    obj(s, tree).cycle = c;
    if (treeHarvestOf(s, tree, ctxOf(s)).ribbon) fruit++;
  }
  assert.ok(fruit > want * 0.6, `${fruit} prized fruit`);
});

test('the Golden Sprinkler waters crops within 3 tiles at planting and trees at each new cycle', () => {
  const s = farmAt(12);
  allLand(s);
  s.farm.storage.golden_sprinkler = 1;
  const at = freeSpot(s, 'golden_sprinkler');
  placeDef(s, 'golden_sprinkler', { at });
  const plotAt = [[at[0] + 3, at[1]], [at[0] + 4, at[1]]].find(([x, z]) => canFit(s, 'plot', x, z, 0) === null);
  assert.ok(plotAt);
  const near = placeDef(s, 'plot', { at: plotAt });
  must(s, 'plant', { id: near, crop: 'potato' });
  assert.equal(obj(s, near).crop.water, plotAt[0] - at[0] <= 3 ? 'sys' : undefined);
  // a tree next to it starts every cycle watered
  const spot = [[at[0] - 2, at[1]], [at[0] + 1, at[1] + 1], [at[0], at[1] + 1], [at[0] - 2, at[1] - 2]]
    .find(([x, z]) => canFit(s, 'apple_tree', x, z, 0) === null);
  const tree = placeDef(s, 'apple_tree', { at: spot });
  const o = obj(s, tree);
  o.matureAt = o.startedAt = o.readyAt = T0;
  const r = must(s, 'harvestTree', { id: tree }, { now: T0 + MIN });
  assert.equal(obj(s, tree).water, 'sys');
  const def = treeOf('apple_tree');
  assert.equal(obj(s, tree).readyAt - (T0 + MIN) < def.cycleMs, true);
  assert.ok(evs(r, 'picked').length);
});

test('the Growth Totem: crops planted within 3 tiles grow 20 % faster (inside the 50 % floor)', () => {
  const s = farmAt(14);
  allLand(s);
  const plot = idOf(s, 'plot');
  const p = obj(s, plot);
  must(s, 'plant', { id: plot, crop: 'potato' });
  const plain0 = p.crop.readyAt - p.crop.plantedAt;
  must(s, 'uproot', { id: plot });
  s.farm.storage.growth_totem = 1;
  const ring = [];
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) ring.push([p.x + dx, p.z + dz]);
  const spot = ring.find(([x, z]) => canFit(s, 'growth_totem', x, z, 0) === null);
  assert.ok(spot, 'a free tile within 3 of the plot');
  placeDef(s, 'growth_totem', { at: spot });
  must(s, 'plant', { id: plot, crop: 'potato' }, { now: T0 + MIN });
  const fast = obj(s, plot).crop.readyAt - obj(s, plot).crop.plantedAt;
  const grow = defOf('growth_totem').effect.grow;
  assert.equal(grow.bp, 2000);
  assert.ok(Math.abs((plain0 - fast) - Math.floor(CONTENT.crops.get('potato').growMs * grow.bp / 10_000)) <= 1,
    `${plain0} -> ${fast}`);
});

test('the Rainbow Tree: each harvest a fruit of the unlocked basket trees, rolled on (id, cycle)', () => {
  const s = farmAt(20);
  allLand(s);
  s.farm.storage.rainbow_tree = 1;
  const id = placeDef(s, 'rainbow_tree');
  assert.equal(obj(s, id).free, true);
  const pool = rainbowFruits(s);
  assert.ok(pool.length >= 5 && pool.includes('apple') && pool.includes('cherry') && !pool.includes('wood'));
  const seen = new Set();
  for (let c = 0; c < 200; c++) {
    obj(s, id).cycle = c;
    const h = treeHarvestOf(s, id, ctxOf(s));
    assert.ok(pool.includes(h.item));
    seen.add(h.item);
    assert.equal(treeHarvestOf(s, id, ctxOf(s, { seq: 9, cid: 'zzzzzz' })).item, h.item, 'same roll on every screen');
  }
  assert.equal(seen.size, pool.length, 'every fruit comes up');
  const o = obj(s, id);
  Object.assign(o, { cycle: 0, matureAt: T0, startedAt: T0, readyAt: T0 });
  const r = must(s, 'harvestTree', { id }, { now: T0 + MIN });
  assert.ok(pool.includes(evs(r, 'picked')[0].item));
  assert.equal(run(s, 'place', { def: 'rainbow_tree', x: 2, z: 2, rot: 0 }).code, ERR.LOCKED, 'never in the tree shop');
});

// ---- homes that grow ------------------------------------------------------------------------------------------

test('homes: capacity grows past the old capacityMax to the growth max; tier 0 is the def\'s own size', () => {
  for (const [id, g] of Object.entries(HOME_GROWTH.homes)) {
    const def = defOf(id);
    assert.equal(g.caps[0], def.capacityMax, `${id}: tier 0 holds the old max`);
    assert.equal(homeMaxOf(def), g.caps.at(-1));
    assert.ok(homeMaxOf(def) >= 16 && homeMaxOf(def) <= 30, `${id} max ${homeMaxOf(def)}`);
  }
  // an existing save's upgrades: same capacity, same footprint (nobody loses room or coins, nothing moves)
  const s = farmAt(12);
  allLand(s);
  const coop = placeDef(s, 'coop');
  const def = defOf('coop');
  for (let up = 0; up <= (def.capacityMax - def.capacity) / def.upgradeStep; up++) {
    obj(s, coop).up = up || undefined;
    if (!up) delete obj(s, coop).up;
    resetGrid(s);
    assert.equal(capacityOf(s, coop), def.capacity + up * def.upgradeStep);
    assert.deepEqual(sizeOf(obj(s, coop)), def.size);
  }
  assert.deepEqual(validateState(s), []);
});

test('homes: a full home grows with the next purchase (price folded in), into a bigger footprint around itself', () => {
  const s = farmAt(12, { coins: 5_000_000 });
  allLand(s);
  const def = defOf('coop');
  const coop = placeDef(s, 'coop', { at: [20, 20] });
  obj(s, coop).up = (def.capacityMax - def.capacity) / def.upgradeStep;      // an old save's fully upgraded coop
  resetGrid(s);
  while (occupantsOf(s, coop).length < capacityOf(s, coop)) {
    must(s, 'buyAnimal', { def: 'chicken', adult: true, ...BIG });
  }
  const g = homeGrowth(s, coop);
  assert.equal(g.code, null);
  assert.equal(g.grows, true, 'past the old max the coop needs the next footprint tier');
  assert.deepEqual(g.nextSize, [def.size[0] + 1, def.size[1] + 1]);
  assert.equal(g.coins, Math.floor(def.upgradeCost * HOME_GROWTH.stepCostBp[1] / 10_000));
  const plan = animalBuyPlan(s, 'chicken', true);
  assert.equal(plan.coins, animalPrice(s, 'chicken', true) + g.coins);
  assert.equal(run(s, 'buyAnimal', { def: 'chicken', adult: true, max: plan.coins - 1, ...BIG }).code, ERR.PRICE,
    'the folded price is the price shown');
  const c0 = s.farm.wallet.coins;
  const r = must(s, 'buyAnimal', { def: 'chicken', adult: true, max: plan.coins, ...BIG });
  assert.equal(c0 - s.farm.wallet.coins, plan.coins);
  // the feed line names the whole price, room step included ("bought a Chicken for 4,735 coins", not the hen alone)
  const row = Object.values(s.farm.feed.rows).filter((x) => x.k === 'buy' && x.def === 'chicken').sort((a, b) => a.at - b.at).at(-1);
  assert.equal(row.c, plan.coins);
  assert.equal(evs(r, 'bought')[0].step, g.coins);
  const ev = evs(r, 'homeGrew')[0];
  assert.deepEqual({ size: ev.size, grows: ev.grows, x: ev.x, z: ev.z },
    { size: g.nextSize, grows: true, x: g.x, z: g.z });
  assert.deepEqual(sizeOf(obj(s, coop)), g.nextSize);
  assert.equal(objTiles(obj(s, coop)).length, g.nextSize[0] * g.nextSize[1]);
  for (const [x, z] of objTiles(obj(s, coop))) assert.equal(tileOwner(s, x, z), coop);
  assert.deepEqual(validateState(s), []);
  // the grown coop moves and turns with its paddock
  const turn = rotateSpot(s, coop, 1);
  assert.equal(turn.code, null);
  must(s, 'move', { id: coop, x: turn.x, z: turn.z, rot: turn.rot });
  assert.deepEqual(validateState(s), []);
});

test('homes: growth blocked by a neighbour on every side answers BLOCKED and names it; the max answers CAP', () => {
  const s = farmAt(12, { coins: 5_000_000 });
  allLand(s);
  const def = defOf('coop');
  const coop = placeDef(s, 'coop', { at: [20, 20] });
  obj(s, coop).up = (def.capacityMax - def.capacity) / def.upgradeStep;
  resetGrid(s);
  // a fence ring right around the coop: no anchor of the bigger footprint fits
  const fences = [];
  for (let x = 19; x <= 23; x++) for (const z of [19, 23]) fences.push([x, z]);
  for (let z = 20; z <= 22; z++) for (const x of [19, 23]) fences.push([x, z]);
  for (const [x, z] of fences) placeDef(s, 'picket_fence', { at: [x, z] });
  while (occupantsOf(s, coop).length < capacityOf(s, coop)) must(s, 'buyAnimal', { def: 'chicken', ...BIG });
  const g = homeGrowth(s, coop);
  assert.equal(g.code, ERR.BLOCKED);
  assert.ok(g.blockers.length > 0 && g.blockers.every((id) => obj(s, id).def === 'picket_fence'));
  assert.equal(run(s, 'buyAnimal', { def: 'chicken', ...BIG }).code, ERR.BLOCKED);
  assert.equal(run(s, 'upgradeHome', { id: coop, ...BIG }).code, ERR.BLOCKED);
  // full grown: CAP
  obj(s, coop).up = (homeMaxOf(def) - def.capacity) / def.upgradeStep;
  for (const id of idsOf(s, 'picket_fence')) delete s.farm.objects[id];
  resetGrid(s);
  assert.equal(homeGrowth(s, coop).code, ERR.CAP);
});

test('homes: a turned home grows from the corner that keeps its house still (the view\'s back-left corner)', () => {
  // the view turns a home by yaw = rot x 90 degrees (three.js y rotation) about its footprint's centre; the grown
  // models keep the house in their local (-w/2, -d/2) corner, so that world point must not move when the pen grows
  const houseAt = (o) => {
    const [w0, d0] = sizeOf(o);
    const [w, d] = (o.rot ?? 0) % 2 ? [d0, w0] : [w0, d0];
    const cx = o.x + w / 2;
    const cz = o.z + d / 2;
    const [lx, lz] = [-w0 / 2, -d0 / 2];
    const a = (o.rot ?? 0) * (Math.PI / 2);
    return [Math.round((cx + lx * Math.cos(a) + lz * Math.sin(a)) * 1000) / 1000,
      Math.round((cz - lx * Math.sin(a) + lz * Math.cos(a)) * 1000) / 1000];
  };
  const def = defOf('coop');
  for (let rot = 0; rot < 4; rot++) {
    const s = farmAt(12, { coins: 5_000_000 });
    allLand(s);
    const coop = placeDef(s, 'coop', { at: [20, 20], rot });
    obj(s, coop).up = (def.capacityMax - def.capacity) / def.upgradeStep;
    resetGrid(s);
    while (occupantsOf(s, coop).length < capacityOf(s, coop)) must(s, 'buyAnimal', { def: 'chicken', ...BIG });
    const before = houseAt(obj(s, coop));
    const r = must(s, 'buyAnimal', { def: 'chicken', ...BIG });
    assert.equal(evs(r, 'homeGrew')[0].grows, true);
    assert.deepEqual(houseAt(obj(s, coop)), before, `rot ${rot}: the house stays where it was`);
    assert.deepEqual(validateState(s), []);
  }
});

test('homes: upgradeHome walks every tier to the growth max; the Beehive does not grow', () => {
  const s = farmAt(20, { coins: 50_000_000 });
  allLand(s);
  // a corner with room for the full-grown barn to the +x / +z side
  let at = null;
  for (let z = 0; z < 64 && !at; z++) {
    for (let x = 0; x < 64 && !at; x++) if (canFit(s, 'cow_barn', x, z, 0, null, [8, 8]) === null) at = [x, z];
  }
  const barn = placeDef(s, 'cow_barn', { at, ...BIG });
  const def = defOf('cow_barn');
  const sizes = new Set();
  while (homeGrowth(s, barn).code === null) {
    must(s, 'upgradeHome', { id: barn, ...BIG });
    sizes.add(sizeOf(obj(s, barn)).join('x'));
  }
  assert.equal(capacityOf(s, barn), homeMaxOf(def));
  assert.equal(sizes.size, HOME_GROWTH.homes.cow_barn.caps.length);
  assert.deepEqual(validateState(s), []);
  const hive = placeDef(s, 'beehive', BIG);
  assert.deepEqual(sizeOf(obj(s, hive)), defOf('beehive').size);
  assert.equal(homeGrowth(s, hive).code, ERR.CAP);
});

// ---- trees age ------------------------------------------------------------------------------------------------

test('trees age: a harvest is a year; young -> mature -> grand give more fruit; old saves need no backfill', () => {
  const st = TREE_AGE.stages;
  assert.equal(treeAgeOf({ cycle: 0 }).stage, 'young');
  assert.equal(treeAgeOf({}).years, 0);
  assert.equal(treeAgeOf({ cycle: st[1].from }).stage, st[1].id);
  assert.equal(treeAgeOf({ cycle: st[1].from - 1 }).nextAt, st[1].from);
  assert.equal(treeAgeOf({ cycle: 500 }).stage, st.at(-1).id);
  assert.equal(treeAgeOf({ cycle: 500 }).nextAt, null);
  const s = farmAt(12);
  allLand(s);
  const tree = placeDef(s, 'cherry_tree');
  const o = obj(s, tree);
  const def = treeOf('cherry_tree');
  const yieldAt = (c) => {
    o.cycle = c;
    return treeHarvestOf(s, tree, ctxOf(s)).qty;
  };
  assert.equal(yieldAt(0), def.yield);
  assert.ok(yieldAt(st[1].from) >= def.yield + st[1].bonusUnits);
  assert.ok(yieldAt(st[2].from) >= def.yield + st[2].bonusUnits);
  // the harvest into the next stage says so
  Object.assign(o, { cycle: st[1].from - 1, matureAt: T0, startedAt: T0, readyAt: T0 });
  const r = must(s, 'harvestTree', { id: tree }, { now: T0 + MIN });
  assert.deepEqual(evs(r, 'treeAged').map((e) => [e.stage, e.years]), [[st[1].id, st[1].from]]);
});

// ---- production queues: reorder, finish one item ----------------------------------------------------------------

function millWithQueue(n = 4) {
  const s = farmAt(12);
  allLand(s);
  const mill = placeDef(s, 'mill', BIG);
  obj(s, mill).slots = 6;
  give(s, 'wheat', 3 * n);
  for (let i = 0; i < n; i++) must(s, 'craft', { id: mill, recipe: 'flour' });
  return { s, mill };
}

test('reorder: the waiting items take a new order; the running one stays first; time and inputs never change', () => {
  const { s, mill } = millWithQueue(4);
  const now = T0 + MIN;
  const q0 = obj(s, mill).queue;
  const end0 = q0.at(-1).e;
  const keys = q0.filter((q) => q.s > now).map((q) => q.k);
  assert.equal(keys.length, 3);
  const want = [keys[2], keys[0], keys[1]];
  const r = must(s, 'reorder', { id: mill, keys: want }, { now, pid: 'p2' });
  const q1 = obj(s, mill).queue;
  assert.deepEqual(q1.map((q) => q.k), [q0[0].k, ...want]);
  assert.deepEqual(q1[0], q0[0], 'the running item is untouched');
  assert.equal(q1.at(-1).e, end0, 'the total time is the same');
  for (let i = 1; i < q1.length; i++) assert.equal(q1[i].s, q1[i - 1].e);
  assert.deepEqual(evs(r, 'reordered')[0], { e: 'reordered', id: mill, building: 'mill', keys: want, by: 'p2' });
  assert.equal(run(s, 'reorder', { id: mill, keys: want }, { now }).code, ERR.ALREADY_DONE);
  assert.equal(run(s, 'reorder', { id: mill, keys: [want[1], want[0]] }, { now }).code, ERR.BAD_ARGS, 'all of them');
  assert.equal(run(s, 'reorder', { id: mill, keys: [...want, 999] }, { now }).code, ERR.NOT_FOUND);
  // the partner's screen was a moment behind: an item that started meanwhile is simply dropped from the list
  const late = q1[1].s + 1;
  const r2 = must(s, 'reorder', { id: mill, keys: [want[0], want[2], want[1]] }, { now: late });
  assert.deepEqual(evs(r2, 'reordered')[0].keys, [want[2], want[1]]);
  assert.deepEqual(validateState(s), []);
});

test('hurry {id, k}: finish one waiting item now for its whole time in Acorns; the items behind move up', () => {
  const { s, mill } = millWithQueue(3);
  const now = T0 + MIN;
  const q0 = obj(s, mill).queue;
  const view = queueView(obj(s, mill), now);
  assert.deepEqual(view.map((v) => v.state), ['running', 'waiting', 'waiting']);
  assert.equal(view[0].acorns, hurryCost(q0[0].e - now));
  assert.equal(view[2].acorns, hurryCost(q0[2].e - q0[2].s));
  const acorns = s.farm.wallet.acorns;
  const dur = q0[1].e - q0[1].s;
  const r = must(s, 'hurry', { id: mill, k: q0[1].k, ...BIG }, { now });
  assert.equal(acorns - s.farm.wallet.acorns, view[1].acorns);
  assert.equal(evs(r, 'hurried')[0].k, q0[1].k);
  const q1 = obj(s, mill).queue;
  assert.deepEqual(q1.map((q) => q.k), [q0[1].k, q0[0].k, q0[2].k], 'the finished one waits in the tray');
  assert.ok(q1[0].e <= now);
  assert.deepEqual([q1[1].s, q1[1].e], [q0[0].s, q0[0].e], 'the running one keeps its time');
  assert.equal(q1[2].e, q0[2].e - dur, 'the last one moved up by the finished one\'s time');
  assert.deepEqual(validateState(s), []);
  const c = must(s, 'collectTray', { id: mill }, { now });
  assert.equal(evs(c, 'crafted').length, 1);
  // the running item by key is the plain Hurry; a finished or unknown key is refused
  must(s, 'hurry', { id: mill, k: q0[0].k, ...BIG }, { now });
  assert.equal(run(s, 'hurry', { id: mill, k: q0[0].k, ...BIG }, { now }).code, ERR.ALREADY_DONE);
  assert.equal(run(s, 'hurry', { id: mill, k: 777, ...BIG }, { now }).code, ERR.NOT_FOUND);
  assert.equal(run(s, 'hurry', { id: idOf(s, 'plot'), k: 1 }, { now }).code, ERR.BAD_ARGS);
  assert.deepEqual(validateState(s), []);
});

// ---- tracker, backfill, version ---------------------------------------------------------------------------------

test('the Goal Tracker: a waiting crate (NOW), the Farmhand ready (NOW), "saving for" the next relic (SOON)', () => {
  const s = crateFarm(12);
  allLand(s);
  s.farm.wallet.acorns = 40;
  const [, now] = dropOne(s);
  const cards = [];
  const list = () => {
    cards.length = 0;
    w4bCandidates(s, 'p1', now, (c, score) => cards.push({ ...c, score }));
    return cards;
  };
  const crate = list().find((c) => c.kind === 'crate');
  assert.deepEqual(crate.target.act, 'openCrate');
  assert.deepEqual(crate.target.args, { id: cratesOn(s)[0] });
  const save = cards.find((c) => c.kind === 'relic' && c.slot === 'soon');
  assert.equal(save.text, 'Saving for the Lucky Clover: 40 / 90 Acorns');
  assert.deepEqual([save.have, save.need, save.target.panel], [40, 90, 'relics']);
  // the player picks what to save for: the card follows the pick; buying it clears the pick
  must(s, 'saveFor', { relic: 'golden_barn' }, { now });
  assert.equal(s.players.p1.save, 'golden_barn');
  assert.equal(list().find((c) => c.kind === 'relic' && c.slot === 'soon').ref, 'golden_barn');
  assert.equal(run(s, 'saveFor', { relic: 'golden_barn' }, { now }).code, ERR.ALREADY_DONE);
  assert.equal(run(s, 'saveFor', { relic: 'nope' }, { now }).code, ERR.BAD_ARGS);
  must(s, 'saveFor', {}, { now });
  assert.equal(s.players.p1.save, null);
  s.farm.wallet.acorns = 95;
  assert.ok(list().some((c) => c.kind === 'relic' && c.slot === 'now' && c.ref === 'lucky_clover'));
  must(s, 'saveFor', { relic: 'lucky_clover' }, { now, pid: 'p2' });
  must(s, 'buyRelic', { relic: 'lucky_clover', ...BIG }, { now });
  assert.equal(s.players.p2.save, null, 'bought: the partner\'s pick moves on');
  assert.equal(run(s, 'saveFor', { relic: 'lucky_clover' }, { now }).code, ERR.ALREADY_DONE, 'owned already');
  // the Farmhand with hungry animals: a NOW card that sends it, gone once it was used today
  const coop = placeDef(s, 'coop');
  must(s, 'buyAnimal', { def: 'chicken', adult: true, home: coop, ...BIG }, { now });
  give(s, 'chicken_feed', 2);
  s.farm.relics.farmhand = { at: T0, by: 'p1' };
  assert.ok(list().some((c) => c.ref === 'farmhand' && c.target.act === 'farmhand'));
  must(s, 'farmhand', {}, { now });
  assert.ok(!list().some((c) => c.ref === 'farmhand'));
  assert.ok(goals(s, 'p1', now).now, 'the tracker still deals its cards');
});

test('an older save gets `relics` and `crates` from the backfill and stays valid; RULES_VERSION is 11', () => {
  assert.equal(RULES_VERSION, 11);
  const s = farmAt(12);
  delete s.farm.relics;
  delete s.farm.crates;
  const filled = backfill(s, { now: T0 + DAY, tz: s.meta.tz });
  assert.ok(filled.includes('farm.relics') && filled.includes('farm.crates'));
  assert.equal(s.farm.crates.k, passOf(T0 + DAY));
  assert.deepEqual(validateState(s), []);
  assert.equal(hasRelic(s, 'farmhand'), false);
  // the crate never predicts on a client (a system action) and every new action rejects a stranger
  const r = runAction(s, { type: '_crate', args: {} }, ctxOf(s));
  assert.equal(r.code, ERR.UNKNOWN_ACTION);
  assert.ok(farmhandTargets(s, ctxOf(s)).length === 0);
});
