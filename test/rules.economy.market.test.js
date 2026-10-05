// Market, store, Barn and the shared-money nets (GDD §3.6, §4.3 "Selling and buying", §4.10, §6.3 Keep N and
// Wishlist, §9 #6, #8, #15, #17, #25, #44).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { itemOf, cropOf, CONTENT, MARKET, SAFETY, xpForLevel, isLive } from '../shared/content/index.js';
import { validateState } from '../shared/rules/state.js';
import { saleOf, unitPrice, demandOf, available, barnCap, stockOf, overflowOf, keptOf, mulBp } from '../shared/rules/economy.js';
import { surplusOf } from '../shared/rules/actions/market.js';
import { buyPrice } from '../shared/rules/actions/decor.js';
import { dayIndex } from '../shared/rules/calendar.js';
import { sys } from './helpers.js';
import { econDue, econNextDueAt } from '../shared/rules/actions/expansions.js';
import { run, must, T0, makeFarm, farmAt, give, evs, ledgerBalanced, HOUR } from './helpers/rules.js';

const WHEAT = cropOf('wheat');
const DAY = 24 * HOUR;

test('sell: content price, overflow drains first and the Barn refills from it; every check code', () => {
  const s = makeFarm();
  s.farm.inventory.wheat = 3;
  s.farm.overflow.wheat = 2;
  assert.equal(run(s, 'sell', { item: 'wheat', qty: 6 }).code, ERR.NO_ITEMS);
  assert.equal(run(s, 'sell', { item: 'carrot', qty: 1 }).code, ERR.NO_ITEMS);
  give(s, 'chicken_feed', 3);
  assert.equal(run(s, 'sell', { item: 'chicken_feed', qty: 1 }).code, ERR.LOCKED, 'feed is upkeep, never sold (R5)');
  const coins = s.farm.wallet.coins;
  const r = must(s, 'sell', { item: 'wheat', qty: 4 });
  assert.equal(s.farm.wallet.coins - coins, 4 * unitPrice(s, 'wheat', T0));
  assert.equal(evs(r, 'sold')[0].coins, 4 * unitPrice(s, 'wheat', T0));
  assert.equal(Object.hasOwn(s.farm.overflow, 'wheat'), false);
  assert.equal(s.farm.inventory.wheat, 1);
  assert.equal(s.farm.ledger.rows[String(s.farm.ledger.n - 1)].reason, 'sell');
});

test('price: mastery ★1 +5 %, in season +10 %, multiplied, integers only', () => {
  const s = farmAt(9);
  const p = cropOf('pumpkin');                          // autumn: in season on T0
  assert.equal(unitPrice(s, 'pumpkin', T0), Math.floor(p.sell * 11_000 / 10_000));
  s.farm.mastery.pumpkin = p.mastery[0];
  assert.equal(unitPrice(s, 'pumpkin', T0), Math.floor((p.sell * 10_500 * 11_000) / 100_000_000));
  assert.equal(unitPrice(s, 'wheat', T0), WHEAT.sell, 'wheat is winter');
  s.farm.xp = xpForLevel(6);
  assert.equal(unitPrice(s, 'pumpkin', T0), Math.floor(p.sell * 11_000 / 10_000), 'stars count from L7 only');
});

test('Market Demand (L11): one raw + one crafted item, +50 % for the first 50 units a day, never the same twice running', () => {
  const s = farmAt(11);
  const d = demandOf(s, T0);
  assert.ok(d.raw && d.crafted);
  assert.ok(['crop', 'fruit', 'animal'].includes(itemOf(d.raw).kind));
  assert.equal(itemOf(d.crafted).kind, 'craft');
  for (const id of [d.raw, d.crafted]) assert.ok(itemOf(id).unlock <= 10, 'unlocked for at least a level');
  let prev = d;
  for (let k = 1; k < 30; k++) {
    const next = demandOf(s, T0 + k * DAY);
    assert.notEqual(next.raw, prev.raw);
    assert.notEqual(next.crafted, prev.crafted);
    prev = next;
  }
  assert.equal(demandOf(farmAt(10), T0), null);
  give(s, d.raw, 60);
  const unit = unitPrice(s, d.raw, T0);
  const q = saleOf(s, d.raw, 60, T0);
  assert.deepEqual(q, { coins: unit * 10 + mulBp(unit, 15_000) * 50, demand: 50 });
  const r = must(s, 'sell', { item: d.raw, qty: 30 });
  assert.equal(evs(r, 'sold')[0].demand, 30);
  assert.deepEqual(s.farm.demand, { day: dayIndex(T0, s.meta.tz), n: { [d.raw]: 30 } });
  assert.equal(saleOf(s, d.raw, 30, T0).demand, 20, '50 a day, farm-wide');
  must(s, 'sell', { item: d.raw, qty: 30 });
  assert.equal(s.farm.demand.n[d.raw], 50);
  assert.equal(saleOf(s, d.raw, 1, T0 + DAY).demand, demandOf(s, T0 + DAY).raw === d.raw ? 1 : 0, 'a new day');
});

test('Keep N: farm-wide; selling below it asks RESERVED naming who set it; Wood keeps 20 by default', () => {
  const s = makeFarm();
  give(s, 'egg', 6);
  must(s, 'keep', { item: 'egg', n: 5 }, { pid: 'p2' });
  assert.deepEqual(keptOf(s, 'egg'), { n: 5, by: 'p2' });
  must(s, 'sell', { item: 'egg', qty: 1 }, { pid: 'p1' });
  assert.equal(run(s, 'sell', { item: 'egg', qty: 1 }, { pid: 'p1' }).code, ERR.RESERVED);
  must(s, 'sell', { item: 'egg', qty: 1, confirm: ['RESERVED'] }, { pid: 'p1' });
  assert.deepEqual(keptOf(s, 'wood'), { n: 20, by: 'sys' });
  give(s, 'wood', 20);
  assert.equal(run(s, 'sell', { item: 'wood', qty: 1 }).code, ERR.RESERVED);
  must(s, 'keep', { item: 'wood', n: 0 });
  assert.deepEqual(keptOf(s, 'wood'), { n: 0, by: 'p1' });
  must(s, 'sell', { item: 'wood', qty: 1 });
  assert.equal(run(s, 'keep', { item: 'wood', n: 0 }).code, ERR.ALREADY_DONE);
  must(s, 'keep', { item: 'egg', n: 0 });
  assert.equal(Object.hasOwn(s.farm.keep, 'egg'), false);
  assert.deepEqual(validateState(s), []);
});

test('Barn: capacity, overflow up to 2 x; upgrades need level, coins, Planks and Crates; overflow moves in', () => {
  const s = farmAt(6);
  assert.equal(barnCap(s), MARKET.barn.start);
  give(s, 'wheat', 250);                                // an old (M0) save with no capacity: setup
  must(s, 'sell', { item: 'wheat', qty: 1 });
  assert.equal(stockOf(s), MARKET.barn.start, 'normalized: inventory never holds more than capacity');
  assert.equal(overflowOf(s), 49);
  const row = CONTENT.barn[0];
  assert.equal(run(s, 'upgradeBarn', {}).code, ERR.NO_ITEMS);
  give(s, 'planks', row.planks);
  must(s, 'upgradeBarn', {});
  assert.equal(barnCap(s), row.capacity);
  assert.equal(overflowOf(s), 0);
  assert.equal(run(s, 'upgradeBarn', {}).code, ERR.LOCKED, 'upgrade 2 is L9');
  s.farm.xp = xpForLevel(12);
  give(s, 'planks', 20);
  give(s, 'wooden_crate', 5);
  must(s, 'upgradeBarn', {}, { now: T0 + 1 });
  must(s, 'upgradeBarn', {}, { now: T0 + 2 });
  assert.equal(s.farm.barn, 3);
  // upgrade 4 is M1b content: past the last row in M1a, an L15 upgrade in M1b
  assert.equal(run(s, 'upgradeBarn', {}).code, isLive(CONTENT.barn[3]) ? ERR.LOCKED : ERR.CAP, 'upgrade 4');
  assert.deepEqual(validateState(s), []);
});

test('store: emergency feed at its store price; refused in overflow and when it would not fit (§9 #6)', () => {
  const s = makeFarm();
  const feed = itemOf('chicken_feed');
  const c = s.farm.wallet.coins;
  must(s, 'storeBuy', { item: 'chicken_feed', qty: 2 });
  assert.equal(s.farm.wallet.coins, c - 2 * feed.storePrice);
  assert.equal(run(s, 'storeBuy', { item: 'wheat', qty: 1 }).code, ERR.LOCKED, 'never sells what the Market buys (R5)');
  assert.equal(run(s, 'storeBuy', { item: 'livestock_feed', qty: 1 }).code, ERR.LOCKED, 'L7');
  give(s, 'wheat', MARKET.barn.start - 2);
  assert.equal(run(s, 'storeBuy', { item: 'chicken_feed', qty: 1 }).code, ERR.STORAGE_FULL);
  s.farm.overflow.wheat = 1;
  s.farm.inventory.wheat -= 1;
  assert.equal(run(s, 'storeBuy', { item: 'chicken_feed', qty: 1 }).code, ERR.STORAGE_FULL);
});

test('sell surplus: the 20 lowest-value stacks down to max(10, Keep N), at the plain price', () => {
  const s = farmAt(11);
  give(s, 'wheat', 30);
  give(s, 'egg', 15);
  give(s, 'corn', 8);
  must(s, 'keep', { item: 'egg', n: 12 });
  const rows = surplusOf(s, T0);
  assert.deepEqual(rows.map((r) => [r.item, r.qty]), [['wheat', 20], ['egg', 3]]);
  const r = must(s, 'sellSurplus', {});
  assert.deepEqual(evs(r, 'sold').map((e) => [e.item, e.qty, e.demand]), [['wheat', 20, 0], ['egg', 3, 0]]);
  assert.equal(available(s, 'wheat'), 10);
  assert.equal(run(s, 'sellSurplus', {}).code, ERR.NO_ITEMS);
});

test('Wishlist: deposits leave the spendable treasury; funded wishes buy themselves into the tray', () => {
  const s = farmAt(9, { coins: 20_000 });
  assert.equal(run(s, 'wish', { def: 'heart_arbor' }).code, ERR.BAD_ARGS, 'Acorn decor is not wished for');
  assert.equal(run(s, 'wish', { def: 'apple_tree' }).code, ERR.BAD_ARGS, 'n-th-price objects are bought in the shop');
  const w = must(s, 'wish', { def: 'bakery' }, { pid: 'p1' });
  const id = evs(w, 'wishAdded')[0].id;
  const price = buyPrice(s, 'bakery').coins;
  must(s, 'wishDeposit', { id, coins: 1000 }, { pid: 'p2' });
  assert.equal(s.farm.wallet.coins, 19_000);
  assert.equal(s.farm.wishlist[id].coins, 1000);
  assert.ok(ledgerBalanced(s, 20_000));
  const r = must(s, 'wishDeposit', { id, coins: price }, { pid: 'p1' });
  assert.equal(evs(r, 'wishBought').length, 1);
  assert.equal(s.farm.storage.bakery, 1);
  assert.equal(s.farm.storagePaid.bakery, 1, 'a paid tray copy');
  assert.equal(Object.hasOwn(s.farm.wishlist, id), false);
  assert.equal(s.farm.wallet.coins, 20_000 - price, 'the change came back');
  assert.ok(ledgerBalanced(s, 20_000));
  assert.equal(buyPrice(s, 'bakery').code, ERR.CAP, 'the bought copy in the tray counts');
  assert.deepEqual(validateState(s), []);
});

test('Wishlist: withdrawing from the partner\'s wish asks them; unanswered it releases after 12 h', () => {
  const s = farmAt(9, { coins: 5000 });
  const id = evs(must(s, 'wish', { def: 'kitchen' }, { pid: 'p1' }), 'wishAdded')[0].id;
  must(s, 'wishDeposit', { id, coins: 3000, confirm: ['BIG_SPEND'] }, { pid: 'p1' });
  assert.equal(run(s, 'unwish', { id }, { pid: 'p2' }).code, ERR.SELF_ONLY);
  must(s, 'wishWithdraw', { id }, { pid: 'p2', now: T0 });
  assert.equal(s.farm.wishlist[id].coins, 3000, 'only a request');
  assert.equal(run(s, 'wishWithdraw', { id }, { pid: 'p2' }).code, ERR.ALREADY_DONE);
  must(s, 'wishAnswer', { id, ok: false }, { pid: 'p1' });
  must(s, 'wishWithdraw', { id }, { pid: 'p2', now: T0 });
  assert.equal(sys(s, '_wishRelease', {}, T0 + SAFETY.wishlist.autoReleaseMs - 1).code, ERR.NOT_READY);
  assert.deepEqual(econDue(s, T0 + SAFETY.wishlist.autoReleaseMs).map((a) => a.type).includes('_wishRelease'), true);
  assert.equal(econNextDueAt(s, T0) <= T0 + SAFETY.wishlist.autoReleaseMs, true);
  const c = s.farm.wallet.coins;
  const rel = sys(s, '_wishRelease', {}, T0 + SAFETY.wishlist.autoReleaseMs);
  assert.equal(rel.ok, true);
  assert.deepEqual(evs(rel, 'wishWithdrawn')[0], { e: 'wishWithdrawn', id, def: 'kitchen', coins: 3000, by: 'p2' });
  assert.equal(s.farm.wallet.coins, c + 3000);
  assert.equal(s.farm.wishlist[id].coins, 0);
  assert.equal(s.farm.wishlist[id].release, undefined);
  assert.equal(econDue(s, T0 + SAFETY.wishlist.autoReleaseMs).some((a) => a.type === '_wishRelease'), false, 'condition cleared');
  // own wish: instant, any amount
  const id2 = evs(must(s, 'wish', { def: 'dairy' }, { pid: 'p2' }), 'wishAdded')[0].id;
  must(s, 'wishDeposit', { id: id2, coins: 500 }, { pid: 'p2' });
  must(s, 'wishWithdraw', { id: id2, coins: 200 }, { pid: 'p2' });
  assert.equal(s.farm.wishlist[id2].coins, 300);
  must(s, 'unwish', { id: id2 }, { pid: 'p2' });
  assert.ok(ledgerBalanced(s, 5000));
});

test('a wish is LOCKED before L9 and capped at SAFETY.wishlist.maxWishes', () => {
  const s = farmAt(8);
  assert.equal(run(s, 'wish', { def: 'bakery' }).code, ERR.LOCKED);
  s.farm.xp = xpForLevel(9);
  for (let i = 0; i < SAFETY.wishlist.maxWishes; i++) must(s, 'wish', { def: 'flower_bed' });
  assert.equal(run(s, 'wish', { def: 'flower_bed' }).code, ERR.CAP);
});

test('Sell surplus: remembered for 10 minutes; Undo buys it back exactly, and the coins stop counting as earned (RC-25)',
  () => {
    const s = farmAt(5, { coins: 1000 });
    give(s, 'wheat', 60);
    give(s, 'carrot', 30);
    const inv = { ...s.farm.inventory };
    const coins = s.farm.wallet.coins;
    const earned = s.farm.stats['coins.earned'] ?? 0;
    const preview = surplusOf(s, T0);
    const r = must(s, 'sellSurplus', {}, { pid: 'p1', now: T0 });
    const got = s.farm.wallet.coins - coins;
    assert.equal(got, preview.reduce((n, x) => n + x.coins, 0), 'the preview is what is paid');
    assert.deepEqual(s.farm.surplus.rows, preview);
    assert.ok(evs(r, 'sold').every((e) => e.surplus));
    assert.equal(run(s, 'undoSurplus', {}, { pid: 'p2', now: T0 + SAFETY.undoMs }).code, ERR.NOT_REFUNDABLE);
    must(s, 'undoSurplus', {}, { pid: 'p2', now: T0 + SAFETY.undoMs - 1 });
    assert.deepEqual(s.farm.inventory, inv, 'every unit is back');
    assert.equal(s.farm.wallet.coins, coins, 'every coin is gone again');
    assert.equal(s.farm.stats['coins.earned'] ?? 0, earned, 'a sale undone was never earned');
    assert.equal(s.farm.surplus, undefined);
    assert.equal(run(s, 'undoSurplus', {}, { now: T0 + 2 }).code, ERR.NOT_FOUND, 'once');
    assert.deepEqual(validateState(s), []);
  });

test('a surplus sale is no "sell" deed: a sell-and-undo loop never finishes "Sell 10 Wheat" (RC-25)', () => {
  const s = farmAt(1, { coins: 1000 });
  s.farm.quests.active = { a2: { at: T0, n: {} } };
  give(s, 'wheat', 40);
  must(s, 'sellSurplus', {}, { now: T0 });
  assert.equal(s.farm.quests.active.a2?.n?.['0'] ?? 0, 0);
});
