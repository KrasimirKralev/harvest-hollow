// Buying, placing, moving, storing and selling objects (GDD §3.2 rules 1-2, §3.4 homes, §3.5 rule 7, §3.8, §3.10,
// §4.3 "Selling objects", §6.3 undo / trash / move back / pins / BIG_SPEND, §9 #7, #9, #17, #38-#40, #51, R12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { CONTENT, defOf, treeOf, plotCapOf, plotPrice, xpForLevel, SAFETY, MARKET } from '../shared/content/index.js';
import { validateState } from '../shared/rules/state.js';
import { canPlace } from '../shared/rules/grid.js';
import { buyPrice } from '../shared/rules/actions/decor.js';
import { grow, mulBp } from '../shared/rules/economy.js';
import { mulberry32 } from './helpers.js';
import { makeFarm, run, must, T0, farmAt, placeDef, freeSpot, idsOf, evs, allLand, ledgerBalanced, MIN } from './helpers/rules.js';
import { freeHomeTiles, notLiveDef } from './helpers/content.js';

test('plots: the 16 starters fill the L1 cap; the cap grows with levels and +6 per expansion; n-th price', () => {
  const s = makeFarm();
  const [x, z] = freeHomeTiles()[0];
  assert.equal(run(s, 'place', { def: 'plot', x, z, rot: 0 }).code, ERR.CAP);
  s.farm.xp = xpForLevel(3);
  const cap = plotCapOf(3, 0);
  assert.equal(buyPrice(s, 'plot').coins, plotPrice(17));
  for (let n = 16; n < cap; n++) placeDef(s, 'plot');
  assert.equal(idsOf(s, 'plot').length, cap);
  assert.equal(buyPrice(s, 'plot').code, ERR.CAP);
  s.farm.expansions = ['home', 'creekside'];
  assert.equal(buyPrice(s, 'plot').code, null, 'an expansion raises the cap by 6');
  assert.equal(plotCapOf(3, 1), cap + 6);
  assert.equal(run(s, 'place', { def: 'plot', x: 2, z: 2, rot: 0 }).code, ERR.OUT_OF_BOUNDS);
  assert.equal(run(s, 'place', { def: 'plot', x: s.farm.objects['home.0.0'].x, z: s.farm.objects['home.0.0'].z, rot: 0 }).code, ERR.BLOCKED);
  assert.deepEqual(validateState(s), []);
});

test('the build tray: the free Coop and Feed Mill are placed for nothing and never counted twice', () => {
  const s = makeFarm();
  const coins = s.farm.wallet.coins;
  placeDef(s, 'coop');
  placeDef(s, 'feed_mill');
  assert.equal(s.farm.wallet.coins, coins);
  assert.deepEqual(s.farm.storage, {});
  assert.equal(buyPrice(s, 'feed_mill').code, ERR.CAP, 'one Feed Mill until L31');
  assert.equal(buyPrice(s, 'coop').code, ERR.CAP, 'one Coop');
  const s2 = makeFarm();
  assert.equal(buyPrice(s2, 'feed_mill').code, ERR.CAP, 'the tray copy counts as owned');
});

test('landmarks, debris, reward decor and M1b content cannot be bought', () => {
  const s = farmAt(12);
  const spot = freeSpot(s, 'flower_bed');
  for (const def of ['farmhouse', 'weed', 'mastery_sign', 'bunting']) {
    assert.equal(run(s, 'place', { def, x: spot[0], z: spot[1], rot: 0 }).code, ERR.LOCKED, def);
  }
  // a building of a later milestone than this build's (M1a: the Pie Oven; M1b: an M2 building) does not exist yet
  const later = notLiveDef('buildings');
  assert.equal(run(s, 'place', { def: later.id, x: spot[0], z: spot[1], rot: 0 }).code, ERR.BAD_ARGS, 'not live');
  s.farm.storage.mastery_sign = 1;                      // a mastery reward waits in the tray
  must(s, 'place', { def: 'mastery_sign', x: spot[0], z: spot[1], rot: 0 });
  assert.equal(Object.hasOwn(s.farm.storage, 'mastery_sign'), false);
});

test('buildings: unlock level, one copy (a second from secondCopy.at), receipt; buildings start with their slots', () => {
  const s = farmAt(3);
  allLand(s);
  assert.equal(buyPrice(s, 'bakery').code, ERR.LOCKED);
  const mill = placeDef(s, 'mill');
  assert.deepEqual(s.farm.objects[mill].queue, []);
  assert.equal(s.farm.objects[mill].slots, defOf('mill').slots[0]);
  assert.equal(buyPrice(s, 'mill').code, ERR.CAP);
  s.farm.xp = xpForLevel(12);
  assert.equal(buyPrice(s, 'mill').code, ERR.CAP, 'second Windmill is L16 content');
  const bakery = placeDef(s, 'bakery');
  assert.deepEqual(s.farm.objects[bakery].paid, { coins: defOf('bakery').cost, acorns: 0 });
  assert.equal(s.farm.objects[bakery].rcpt.until, T0 + SAFETY.undoMs);
  assert.deepEqual(validateState(s), []);
});

test('trees: per-species cap, n-th price x 1.45^(n-1); free (tray / expansion) trees never raise the price', () => {
  const s = farmAt(4);
  allLand(s);
  const apple = treeOf('apple_tree');
  const prices = [];
  for (let n = 1; n <= 4; n++) {
    prices.push(buyPrice(s, 'apple_tree').coins);
    placeDef(s, 'apple_tree', { confirm: ['BIG_SPEND'] });
  }
  assert.deepEqual(prices, [1, 2, 3, 4].map((n) => grow(apple.cost, apple.growthBp, n)));
  assert.equal(buyPrice(s, 'apple_tree').code, ERR.CAP, '4 per species below L10');
  s.farm.xp = xpForLevel(10);
  const fifth = buyPrice(s, 'apple_tree');
  assert.equal(fifth.coins, grow(apple.cost, apple.growthBp, 5));
  // a free tree from the tray: placed for nothing, and the next purchase price is unchanged
  s.farm.storage.apple_tree = 1;
  s.farm.xp = xpForLevel(20);
  const id = placeDef(s, 'apple_tree');
  assert.equal(s.farm.objects[id].free, true);
  assert.equal(buyPrice(s, 'apple_tree').coins, grow(apple.cost, apple.growthBp, 5), '§9 #51');
});

test('BIG_SPEND: > 25 % of the treasury and > 1,000 coins, or >= 10 Acorns (also per player per day)', () => {
  const s = farmAt(6, { coins: 10_000, acorns: 60 });
  allLand(s);
  const spot = freeSpot(s, 'sawmill');
  assert.equal(run(s, 'place', { def: 'sawmill', x: spot[0], z: spot[1], rot: 0 }).code, ERR.BIG_SPEND);   // 6,000 > 2,500
  const r = must(s, 'place', { def: 'sawmill', x: spot[0], z: spot[1], rot: 0, confirm: ['BIG_SPEND'] });
  assert.deepEqual(evs(r, 'bigSpend')[0], { e: 'bigSpend', by: 'p1', coins: 6000, acorns: 0, what: 'sawmill' });
  // a small purchase is never BIG_SPEND even when it is > 25 %: below 1,000 coins
  s.farm.wallet.coins = 300;
  placeDef(s, 'flower_bed');
  // Acorns: a purchase that brings one player's Acorns of the day to 10 asks; the other player's day is separate
  s.farm.wallet.coins = 1_000_000;
  must(s, 'plant', { ids: ['home.0.0', 'home.0.1'], crop: 'tomato' }, { now: T0 });
  s.players.p1.acornDay = { day: 0, n: 0 };
  must(s, 'hurry', { id: 'home.0.0' }, { now: T0 + MIN });
  assert.equal(s.players.p1.acornDay.n, 1);
  s.players.p1.acornDay = { ...s.players.p1.acornDay, n: 9 };
  assert.equal(run(s, 'hurry', { id: 'home.0.1' }, { now: T0 + MIN }).code, ERR.BIG_SPEND);
  must(s, 'hurry', { id: 'home.0.1' }, { pid: 'p2', now: T0 + MIN });
  assert.equal(s.players.p1.acornDay.n, 9);
  assert.equal(s.players.p2.acornDay.n, 1);
});

test('move: keeps id and timers, opens a 10-minute move back; debris does not move (landmarks do since 2026-10-04)', () => {
  const s = farmAt(4);
  must(s, 'plant', { id: 'home.0.0', crop: 'wheat' }, { now: T0 });
  const crop = structuredClone(s.farm.objects['home.0.0'].crop);
  const [x, z] = freeSpot(s, 'plot');
  const from = [s.farm.objects['home.0.0'].x, s.farm.objects['home.0.0'].z];
  const r = must(s, 'move', { id: 'home.0.0', x, z, rot: 0 }, { now: T0 + MIN });
  assert.deepEqual(s.farm.objects['home.0.0'].crop, crop, 'timers kept (§9 #38)');
  assert.deepEqual(evs(r, 'moved')[0].from, [...from, 0]);
  assert.equal(run(s, 'move', { id: 'home.0.0', x, z, rot: 0 }).code, ERR.ALREADY_DONE);
  must(s, 'moveBack', { id: 'home.0.0' }, { pid: 'p2', now: T0 + MIN + SAFETY.moveBackMs - 1 });
  assert.deepEqual([s.farm.objects['home.0.0'].x, s.farm.objects['home.0.0'].z], from);
  assert.equal(run(s, 'moveBack', { id: 'home.0.0' }).code, ERR.NOT_FOUND, 'one move back per move');
  must(s, 'move', { id: 'home.0.0', x, z, rot: 0 }, { now: T0 });
  assert.equal(run(s, 'moveBack', { id: 'home.0.0' }, { now: T0 + SAFETY.moveBackMs }).code, ERR.NOT_REFUNDABLE);
  // the owner's rule (2026-10-04): the farmhouse moves like any building (test/rules.move-structures.test.js)
  const house = idsOf(s, 'farmhouse')[0];
  assert.equal(run(s, 'move', { id: house, x, z, rot: 0 }).code, ERR.BLOCKED, 'onto the plot just moved there');
  const weed = Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'weed');
  assert.equal(run(s, 'move', { id: weed, x, z, rot: 0 }).code, ERR.LOCKED);
  assert.deepEqual(validateState(s), []);
});

test('move back is refused when the old spot was taken meanwhile', () => {
  const s = farmAt(4);
  const fb = placeDef(s, 'flower_bed');
  const old = [s.farm.objects[fb].x, s.farm.objects[fb].z];
  const [x, z] = freeSpot(s, 'flower_bed', 0);
  must(s, 'move', { id: fb, x: x === old[0] && z === old[1] ? x + 1 : x, z, rot: 0 });
  placeDef(s, 'flower_bed', { at: old });
  assert.equal(run(s, 'moveBack', { id: fb }).code, ERR.BLOCKED);
});

test('pinned decor: the other player is asked (PINNED) before moving, storing or selling it', () => {
  const s = farmAt(4);
  const fb = placeDef(s, 'flower_bed');
  must(s, 'pinObject', { id: fb, on: true }, { pid: 'p1' });
  const [x, z] = freeSpot(s, 'flower_bed');
  assert.equal(run(s, 'move', { id: fb, x, z, rot: 0 }, { pid: 'p2' }).code, ERR.PINNED);
  assert.equal(run(s, 'store', { id: fb }, { pid: 'p2' }).code, ERR.PINNED);
  assert.equal(run(s, 'sellObject', { id: fb }, { pid: 'p2' }).code, ERR.PINNED);
  assert.equal(run(s, 'pinObject', { id: fb, on: false }, { pid: 'p2' }).code, ERR.SELF_ONLY);
  must(s, 'move', { id: fb, x, z, rot: 0, confirm: ['PINNED'] }, { pid: 'p2' });
  must(s, 'move', { id: fb, x: x + 1, z, rot: 0 }, { pid: 'p1' });
  must(s, 'pinObject', { id: fb, on: false }, { pid: 'p1' });
  assert.equal(s.farm.objects[fb].pin, undefined);
});

test('undo: 100 % inside the window while pristine; any use voids the receipt (§6.3, tech §15.3)', () => {
  const s = farmAt(4);
  const before = s.farm.wallet.coins;
  const fb = placeDef(s, 'flower_bed');
  must(s, 'refund', { id: fb }, { now: T0 + SAFETY.undoMs - 1 });
  assert.equal(s.farm.wallet.coins, before);
  assert.equal(s.farm.objects[fb], undefined);
  const fb2 = placeDef(s, 'flower_bed');
  assert.equal(run(s, 'refund', { id: fb2 }, { now: T0 + SAFETY.undoMs }).code, ERR.NOT_REFUNDABLE);
  s.farm.xp = xpForLevel(4);
  const plot = (() => { s.farm.xp = xpForLevel(5); return placeDef(s, 'plot'); })();
  must(s, 'plant', { id: plot, crop: 'wheat' });
  assert.equal(run(s, 'refund', { id: plot }).code, ERR.NOT_REFUNDABLE, 'a used plot is not pristine');
  assert.equal(run(s, 'refund', { id: 'home.0.1' }).code, ERR.NOT_REFUNDABLE, 'starter objects have no receipt');
  assert.ok(ledgerBalanced(s, 1_000_000));
});

test('sellObject: decor 50 %, plots 50 % (empty only), trees and buildings are moved, never sold', () => {
  const s = farmAt(5);
  allLand(s);
  const fb = placeDef(s, 'flower_bed');
  const plot = placeDef(s, 'plot');
  const c0 = s.farm.wallet.coins;
  const r = must(s, 'sellObject', { id: fb }, { now: T0 + SAFETY.undoMs });
  assert.equal(s.farm.wallet.coins, c0 + mulBp(defOf('flower_bed').cost, MARKET.refunds.decorBp));
  assert.equal(evs(r, 'removed')[0].reason, 'sell');
  assert.ok(s.farm.trash[fb]);
  must(s, 'plant', { id: plot, crop: 'wheat' });
  assert.equal(run(s, 'sellObject', { id: plot }).code, ERR.OCCUPIED);
  const coop = placeDef(s, 'coop');
  assert.equal(run(s, 'sellObject', { id: coop }, { now: T0 + SAFETY.undoMs }).code, ERR.LOCKED);
  const tree = placeDef(s, 'apple_tree', { confirm: ['BIG_SPEND'] });
  assert.equal(run(s, 'sellObject', { id: tree }, { now: T0 + SAFETY.undoMs }).code, ERR.LOCKED);
  assert.equal(run(s, 'sellObject', { id: 'home.1.0' }).code, ERR.LOCKED, 'the farmhouse');
});

test('trash: either player restores a sold object inside 10 minutes by paying the coins back', () => {
  const s = farmAt(4);
  const fb = placeDef(s, 'flower_bed');
  must(s, 'sellObject', { id: fb }, { now: T0 + SAFETY.undoMs });
  const t = s.farm.trash[fb];
  const c = s.farm.wallet.coins;
  must(s, 'restore', { id: fb }, { pid: 'p2', now: T0 + SAFETY.undoMs + 1 });
  assert.equal(s.farm.wallet.coins, c - t.coins);
  assert.ok(s.farm.objects[fb]);
  assert.equal(Object.hasOwn(s.farm.trash, fb), false);
  must(s, 'sellObject', { id: fb }, { now: T0 + SAFETY.undoMs * 2 });
  assert.equal(run(s, 'restore', { id: fb }, { now: T0 + SAFETY.undoMs * 3 }).code, ERR.NOT_FOUND, 'expired');
  // an expired entry is pruned by the next sale
  const fb2 = placeDef(s, 'flower_bed', { now: T0 + SAFETY.undoMs * 3 });
  must(s, 'sellObject', { id: fb2 }, { now: T0 + SAFETY.undoMs * 5 });
  assert.equal(Object.hasOwn(s.farm.trash, fb), false);
  assert.deepEqual(validateState(s), []);
});

test('store: decor goes back to the tray and comes out again for free; others refuse', () => {
  const s = farmAt(4);
  const fb = placeDef(s, 'flower_bed');
  must(s, 'store', { id: fb });
  assert.equal(s.farm.storage.flower_bed, 1);
  const c = s.farm.wallet.coins;
  placeDef(s, 'flower_bed');
  assert.equal(s.farm.wallet.coins, c);
  assert.equal(run(s, 'store', { id: 'home.0.0' }).code, ERR.LOCKED);
  // a paid copy keeps its resale value through the tray; a starter fence (free) never gains one
  const again = idsOf(s, 'flower_bed')[0];
  assert.deepEqual(s.farm.objects[again].paid, { coins: defOf('flower_bed').cost, acorns: 0 });
  const fence = idsOf(s, 'picket_fence')[0];
  must(s, 'store', { id: fence });
  assert.equal(s.farm.storagePaid.picket_fence, undefined);
  const f2 = placeDef(s, 'picket_fence');
  assert.equal(s.farm.objects[f2].paid, undefined);
  const c1 = s.farm.wallet.coins;
  must(s, 'sellObject', { id: f2 });
  assert.equal(s.farm.wallet.coins, c1, 'a free fence sells for nothing, stored or not');
  assert.deepEqual(validateState(s), []);
});

test('R12: no buy / place / store / undo / sell / restore sequence returns more coins than it cost', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rnd = mulberry32(seed);
    const s = farmAt(12, { coins: 50_000, acorns: 200 });
    let now = T0;
    const start = s.farm.wallet.coins + 0;
    const acorns0 = s.farm.wallet.acorns;
    for (let i = 0; i < 60; i++) {
      now += Math.floor(rnd() * 4 * MIN);
      const decor = idsOf(s, 'flower_bed').concat(idsOf(s, 'heart_arbor'));
      const pick = (l) => l[Math.floor(rnd() * l.length)];
      const k = Math.floor(rnd() * 5);
      const o = { now, pid: rnd() < 0.5 ? 'p1' : 'p2', confirm: ['BIG_SPEND'] };
      if (k === 0) { const sp = freeSpot(s, 'flower_bed'); run(s, 'place', { def: rnd() < 0.5 ? 'flower_bed' : 'heart_arbor', x: sp[0], z: sp[1], rot: 0, confirm: ['BIG_SPEND'] }, o); }
      else if (k === 1 && decor.length) run(s, 'sellObject', { id: pick(decor) }, o);
      else if (k === 2 && decor.length) run(s, 'refund', { id: pick(decor) }, o);
      else if (k === 3 && decor.length) run(s, 'store', { id: pick(decor) }, o);
      else if (k === 4 && Object.keys(s.farm.trash).length) run(s, 'restore', { id: pick(Object.keys(s.farm.trash)) }, o);
      assert.ok(s.farm.wallet.coins <= start, `seed ${seed}: coins grew to ${s.farm.wallet.coins}`);
      assert.ok(s.farm.wallet.acorns <= acorns0, `seed ${seed}: Acorns grew`);
      assert.ok(ledgerBalanced(s, 50_000));
    }
    assert.deepEqual(validateState(s), []);
  }
});

test('buyPrice covers every live shop placeable without throwing', () => {
  const s = farmAt(12);
  for (const def of CONTENT.decor.values()) assert.doesNotThrow(() => buyPrice(s, def.id));
  for (const fam of ['plots', 'trees', 'homes', 'buildings']) for (const d of CONTENT[fam].values()) assert.doesNotThrow(() => buyPrice(s, d.id));
});

test('restore re-applies the plot cap: sell, buy a new plot in its room, restore = CAP (RC-04)', () => {
  const s = farmAt(2, { coins: 10_000 });
  const cap = plotCapOf(2, 0);
  while (idsOf(s, 'plot').length < cap) placeDef(s, 'plot', { now: T0 });
  const last = idsOf(s, 'plot').find((id) => !id.startsWith('home.'));
  const at = [s.farm.objects[last].x, s.farm.objects[last].z];
  must(s, 'sellObject', { id: last }, { now: T0 + 11 * MIN });
  // the new plot goes on ANOTHER tile, so the restore is not merely blocked by the spot
  let spot = null;
  for (let z = 0; z < 64 && !spot; z++) {
    for (let x = 0; x < 64 && !spot; x++) {
      if ((x !== at[0] || z !== at[1]) && canPlace(s, 'plot', x, z, 0) === null) spot = [x, z];
    }
  }
  placeDef(s, 'plot', { now: T0 + 11 * MIN, at: spot });
  const r = run(s, 'restore', { id: last }, { now: T0 + 12 * MIN });
  assert.equal(r.code, ERR.CAP);
  assert.equal(idsOf(s, 'plot').length, cap);
});
