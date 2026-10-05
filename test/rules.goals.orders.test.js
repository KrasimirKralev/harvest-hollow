// Mabel's Order Board: slots, the scripted first order, the generator's G-VALID guarantees, golden schedule,
// refill, pins, help flags, the weekly meter (GDD §5.2, §6.2 #3, §9 #11-14, #19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { ORDERS, COOP, CONTENT, itemOf, recipeOf, orderSlotsAt, levelFromXp, xpForLevel, isLive } from '../shared/content/index.js';
import { generateOrder, producers, canMake, openItems, refillMsOf } from '../shared/rules/orders-board.js';
import { blockOf } from '../shared/rules/coop.js';
import { makeCtx } from '../shared/rules/index.js';
import { validateState } from '../shared/rules/state.js';
import { resetGrid } from '../shared/rules/grid-cache.js';
import { nextSystemDueAt } from '../shared/rules/system.js';
import { notLiveDef } from './helpers/content.js';
import {
  farmAt, put, give, runDue, act, actOk, evs, valid, reverseKeys, plain, T0, MIN, HOUR, DAY, MONDAY, mulberry32,
} from './helpers/rules-goals.js';

/** The number of the order in board slot `slot` (what the player saw; RC-07), or 0 for an empty slot. */
const nOf = (st, slot) => st.farm.orders?.slots?.[String(slot)]?.order?.n ?? 0;

const slots = (s) => s.farm.orders.slots;
const orders = (s) => Object.values(slots(s)).map((x) => x.order).filter(Boolean);

test('the board opens at L2 with 3 slots; the first order is the scripted 8 Wheat; never golden', () => {
  const s = farmAt(1);
  assert.equal(runDue(s, T0).length, 0, 'nothing due at L1');
  s.farm.xp = xpForLevel(2);
  runDue(s, T0);
  assert.equal(Object.keys(slots(s)).length, orderSlotsAt(2));
  assert.deepEqual(slots(s)['0'].order.items, ORDERS.first.items);
  assert.equal(slots(s)['0'].order.golden, null);
  assert.equal(s.farm.orders.n, 3);
  valid(s);
});

test('a level that adds a slot fills it at once', () => {
  const s = farmAt(2);
  runDue(s, T0);
  s.farm.xp = xpForLevel(5);
  runDue(s, T0 + 1000);
  assert.equal(Object.keys(slots(s)).length, orderSlotsAt(5));
});

test('fill: all items at once, 1.5 x V as coins + XP, the slot refills after its refill time (quick slot sooner)', () => {
  const s = farmAt(2);
  runDue(s, T0);
  const o = slots(s)['0'].order;
  assert.equal(act(s, 'orderFill', { slot: 0, n: nOf(s, 0) }).code, ERR.NO_ITEMS);
  give(s, 'wheat', 7);
  assert.equal(act(s, 'orderFill', { slot: 0, n: nOf(s, 0) }).code, ERR.NO_ITEMS, 'no partial delivery');
  give(s, 'wheat', 1);
  const coins = s.farm.wallet.coins;
  const xp = s.farm.xp;
  const r = actOk(s, 'orderFill', { slot: 0, n: nOf(s, 0) }, { now: T0 + 1000 });
  assert.equal(s.farm.inventory.wheat, undefined);
  assert.equal(s.farm.wallet.coins - coins, o.coins);
  assert.ok(s.farm.xp - xp >= o.xp);
  assert.equal(o.coins + o.xp * 8 <= o.value + 8, true, 'pay never exceeds 1.5 x V');
  assert.equal(slots(s)['0'].order, null);
  assert.equal(slots(s)['0'].availableAt, T0 + 1000 + refillMsOf(0));
  // the quick slot (0) may refill sooner than the others (RC-01: ORDERS.quick.refillMs when content sets it)
  assert.equal(refillMsOf(0), ORDERS.quick.refillMs ?? ORDERS.refillMs);
  assert.equal(refillMsOf(1), ORDERS.refillMs);
  assert.equal(s.farm.stats['coins.earned'], o.coins, 'order coins are earned');
  assert.equal(s.farm.stats['delivered.wheat'], 8);
  assert.equal(evs(r, 'orderFilled').length, 1);
  // the refill happens exactly at availableAt, not before
  runDue(s, T0 + 1000 + refillMsOf(0) - 1);
  assert.equal(slots(s)['0'].order, null);
  runDue(s, T0 + 1000 + refillMsOf(0));
  assert.ok(slots(s)['0'].order);
  valid(s);
});

test('orders never expire, and a server that was off for days refills every slot in one action', () => {
  const s = farmAt(5);
  runDue(s, T0);
  for (const k of Object.keys(slots(s))) {
    for (const [i, q] of Object.entries(slots(s)[k].order.items)) give(s, i, q);
    actOk(s, 'orderFill', { slot: Number(k), n: nOf(s, Number(k)) }, { now: T0 + 10 });
  }
  const kept = plain(slots(s));
  const ran = runDue(s, T0 + 5 * DAY);
  assert.equal(ran.filter((t) => t === '_orders').length, 1);
  for (const k of Object.keys(kept)) assert.ok(slots(s)[k].order, `slot ${k} refilled`);
});

test('discard: refills in 15 min; a partner\'s "I\'m on it" pin asks a soft confirm', () => {
  const s = farmAt(2);
  runDue(s, T0);
  actOk(s, 'orderPin', { slot: 1, n: nOf(s, 1) }, { pid: 'p2' });
  assert.equal(slots(s)['1'].pin, 'p2');
  assert.equal(act(s, 'orderPin', { slot: 1, n: nOf(s, 1) }, { pid: 'p1' }).code, ERR.OCCUPIED);
  assert.equal(act(s, 'orderDiscard', { slot: 1, n: nOf(s, 1) }, { pid: 'p1' }).code, ERR.PINNED);
  actOk(s, 'orderDiscard', { slot: 1, n: nOf(s, 1), confirm: ['PINNED'] }, { pid: 'p1', now: T0 + 5 });
  assert.equal(slots(s)['1'].order, null);
  assert.equal(slots(s)['1'].pin, null);
  assert.equal(slots(s)['1'].availableAt, T0 + 5 + ORDERS.refillMs);
  // my own pin: no confirm; pin toggles off
  runDue(s, T0 + 5 + ORDERS.refillMs);
  actOk(s, 'orderPin', { slot: 1, n: nOf(s, 1) }, { pid: 'p1' });
  actOk(s, 'orderPin', { slot: 1, n: nOf(s, 1) }, { pid: 'p1' });
  assert.equal(slots(s)['1'].pin, null);
  actOk(s, 'orderPin', { slot: 1, n: nOf(s, 1) }, { pid: 'p1' });
  actOk(s, 'orderDiscard', { slot: 1, n: nOf(s, 1) }, { pid: 'p1', now: T0 + 6 + ORDERS.refillMs });
  assert.equal(act(s, 'orderDiscard', { slot: 1, n: nOf(s, 1) }).code, ERR.EMPTY);
  assert.equal(act(s, 'orderDiscard', { slot: 9, n: nOf(s, 9) }).code, ERR.NOT_FOUND);
});

test('help flags: the OTHER player filling it gets +10 % XP and a Heart each; self-fill pays the normal reward', () => {
  const s = farmAt(2);
  runDue(s, T0);
  const o = slots(s)['0'].order;
  actOk(s, 'orderFlag', { slot: 0, n: nOf(s, 0) }, { pid: 'p1' });
  assert.equal(slots(s)['0'].flag, 'p1');
  give(s, 'wheat', 8);
  const r = actOk(s, 'orderFill', { slot: 0, n: nOf(s, 0) }, { pid: 'p2' });
  const filled = evs(r, 'orderFilled')[0];
  assert.equal(filled.xp, o.xp + Math.floor((o.xp * COOP.helpFlags.xpBonusBp) / 10_000));
  assert.equal(filled.helped, 'p1');
  assert.equal(s.players.p1.hearts, 1);
  assert.equal(s.players.p2.hearts, 1);
  assert.equal(s.farm.stats.partnerFlagsFilled, 1);
  assert.equal(s.players.p2.stats.partnerFlagsFilled, 1);
  // self-fill of my own flag: no bonus, no Hearts (GDD §9 #19)
  const o2 = slots(s)['1'].order;
  actOk(s, 'orderFlag', { slot: 1, n: nOf(s, 1) }, { pid: 'p2' });
  for (const [i, q] of Object.entries(o2.items)) give(s, i, q);
  const r2 = actOk(s, 'orderFill', { slot: 1, n: nOf(s, 1) }, { pid: 'p2' });
  assert.equal(evs(r2, 'orderFilled')[0].helped, null);
  assert.equal(evs(r2, 'orderFilled')[0].xp, o2.xp);
  assert.equal(s.players.p2.hearts, 1);
});

test('rush: the first instant refill of a farm day is free, then 1 Acorn each', () => {
  const s = farmAt(2);
  runDue(s, T0);
  give(s, 'wheat', 8);
  actOk(s, 'orderFill', { slot: 0, n: nOf(s, 0) }, { now: T0 + 1 });
  assert.equal(act(s, 'orderRush', { slot: 1 }).code, ERR.ALREADY_DONE, 'a slot with an order needs no rush');
  const acorns = s.farm.wallet.acorns;
  actOk(s, 'orderRush', { slot: 0 }, { now: T0 + 2 });
  assert.equal(s.farm.wallet.acorns, acorns);
  assert.equal(nextSystemDueAt(s, T0 + 2), T0 + 2, 'the scheduler refills at once, not at the next player action');
  runDue(s, T0 + 2);
  assert.ok(slots(s)['0'].order);
  actOk(s, 'orderDiscard', { slot: 0, n: nOf(s, 0) }, { now: T0 + 3 });
  actOk(s, 'orderRush', { slot: 0 }, { now: T0 + 4 });
  assert.equal(s.farm.wallet.acorns, acorns - ORDERS.refillAcorns);
  s.farm.wallet.acorns = 0;
  runDue(s, T0 + 4);
  actOk(s, 'orderDiscard', { slot: 0, n: nOf(s, 0) }, { now: T0 + 5 });
  assert.equal(act(s, 'orderRush', { slot: 0 }, { now: T0 + 6 }).code, ERR.NO_ACORNS);
});

test('golden orders follow the 6-hour schedule: discarding cannot fish for one (GDD §9 #12)', () => {
  const s = farmAt(6);
  runDue(s, T0);
  const goldenNow = () => orders(s).filter((o) => o.golden).length;
  assert.equal(goldenNow(), 1, 'the first board after a boundary has one golden order (the scripted first is plain)');
  // discard and refill every slot many times inside the same 6-hour block: no new golden order
  let t = T0;
  const block = blockOf(s, t);
  for (let round = 0; round < 6; round++) {
    for (const k of Object.keys(slots(s))) {
      if (!slots(s)[k].order) continue;
      actOk(s, 'orderDiscard', { slot: Number(k), n: nOf(s, Number(k)), confirm: ['PINNED'] }, { now: t });
    }
    t += ORDERS.refillMs;
    if (blockOf(s, t) !== block) break;
    runDue(s, t);
    assert.equal(orders(s).filter((o) => o.golden).length, 0, `round ${round}: a discard produced a golden order`);
  }
  // after the next boundary the first generated order is golden again
  const next = T0 + 6 * HOUR;
  runDue(s, next);
  assert.equal(orders(s).filter((o) => o.golden).length, 1);
  const g = orders(s).find((o) => o.golden);
  assert.equal(g.golden.acorns, ORDERS.golden.acorns);
  const acorns = s.farm.wallet.acorns;
  for (const [i, q] of Object.entries(g.items)) give(s, i, q);
  const k = Object.keys(slots(s)).find((x) => slots(s)[x].order?.n === g.n);
  actOk(s, 'orderFill', { slot: Number(k), n: nOf(s, Number(k)) }, { now: next + 1 });
  assert.equal(s.farm.wallet.acorns, acorns + 1);
});

/** A random mid-game farm: buildings, homes, animals and trees of the levels reached, some stock. */
function randomFarm(seed) {
  const rnd = mulberry32(seed);
  const L = 2 + Math.floor(rnd() * 11);
  const s = farmAt(L, { seed });
  let x = 9;
  for (const b of CONTENT.buildings.values()) {
    if (isLive(b) && b.unlock <= L && rnd() < 0.7) put(s, b.id, { x: (x += 3), z: 50 });
  }
  for (const h of CONTENT.homes.values()) {
    if (!isLive(h) || h.unlock > L || rnd() < 0.3) continue;
    const home = put(s, h.id, { x: (x += 4), z: 54 });
    for (const sp of h.species) {
      for (let i = 0; i < 1 + Math.floor(rnd() * 3); i++) put(s, sp, { home, adultAt: rnd() < 0.8 ? T0 - 1 : T0 + HOUR });
    }
  }
  for (const t of CONTENT.trees.values()) {
    if (isLive(t) && t.unlock <= L && rnd() < 0.6) put(s, t.id, { x: (x += 2), z: 58, matureAt: rnd() < 0.7 ? T0 - 1 : T0 + DAY });
  }
  for (const it of CONTENT.items.values()) if (isLive(it) && it.unlock <= L && rnd() < 0.2) give(s, it.id, 1 + Math.floor(rnd() * 20));
  return s;
}

test('G-VALID fuzz: every generated order is makeable now, sized, deduplicated and fair (GDD §5.1, §5.2)', () => {
  let simple = 0;
  let total = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const s = randomFarm(seed);
    let t = T0 + seed * 7 * HOUR;
    for (let round = 0; round < 6; round++) {
      runDue(s, t);
      const L = levelFromXp(s.farm.xp);
      const P = producers(s, t);
      for (const o of orders(s)) {
        total++;
        if (o.simple) simple++;
        const items = Object.keys(o.items);
        assert.ok(items.length >= 1 && items.length <= ORDERS.maxTypes);
        let craftMin = 0;
        for (const i of items) {
          const it = itemOf(i);
          assert.ok(it.orderable, `${i} is not orderable`);
          assert.ok(it.kind !== 'feed' && it.kind !== 'consumable', `${i}: feed/consumables are never ordered`);
          assert.ok(it.unlock <= L, `${i} unlocks at ${it.unlock} > L${L}`);
          assert.ok(it.tier !== 'duet' || o.golden, `${i}: duet goods only in golden orders`);
          assert.ok(canMake(s, P, i) || (s.farm.inventory[i] ?? 0) > 0, `seed ${seed}: ${i} cannot be made`);
          if (it.kind === 'craft') craftMin += Math.ceil(o.items[i] / recipeOf(i).out) * Math.max(1, Math.round(recipeOf(i).ms / MIN));
        }
        if (!o.simple) assert.ok(craftMin <= ORDERS.caps.orderMachineMinutes || items.length === 1, `seed ${seed}: ${craftMin} machine-minutes`);
        for (let a = 0; a < items.length; a++) {
          for (let b = a + 1; b < items.length; b++) {
            const ia = Object.keys(recipeOf(items[a])?.inputs ?? {});
            const ib = Object.keys(recipeOf(items[b])?.inputs ?? {});
            assert.ok(!ia.some((z) => ib.includes(z)), `seed ${seed}: ${items[a]} and ${items[b]} share an input`);
          }
        }
        assert.ok(o.coins >= 1 && o.xp >= 1);
      }
      for (const [i, n] of openItems(s)) assert.ok(n <= ORDERS.maxOpenPerItem, `${i} in ${n} open orders`);
      // fill what we can, discard the rest, move on
      for (const k of Object.keys(slots(s))) {
        const o = slots(s)[k].order;
        if (!o) continue;
        if (round % 2) { for (const [i, q] of Object.entries(o.items)) give(s, i, q); actOk(s, 'orderFill', { slot: Number(k), n: nOf(s, Number(k)) }, { now: t }); }
        else actOk(s, 'orderDiscard', { slot: Number(k), n: nOf(s, Number(k)), confirm: ['PINNED'] }, { now: t });
      }
      t += ORDERS.refillMs + 1;
    }
    // fixtures sit on tiles the economy would not allow (outside the land, overlapping): only the goals fields count
    assert.deepEqual(validateState(s).filter((m) => !/^objects\./.test(m)), [], `seed ${seed}`);
  }
  assert.ok(total > 500, `${total} orders`);
  assert.ok(simple / total < 0.6, `${simple} of ${total} orders were simple`);
});

test('the generator never depends on key order, never on the client (same order on a key-reversed twin)', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const s = randomFarm(seed);
    const twin = reverseKeys(plain(s));
    const ctx = makeCtx(s, { now: T0, pid: 'sys', cid: 'sys', seq: 1 });
    const a = generateOrder(s, T0, ctx.rng);
    const b = generateOrder(twin, T0, makeCtx(twin, { now: T0, pid: 'sys', cid: 'sys', seq: 1 }).rng);
    assert.deepEqual(a, b);
  }
});

test('Mabel\'s meter: counts order VALUE (simple orders 1/4) Monday to Sunday; chests at 0.75 / 1.5 / 2.5 E-hours', () => {
  const s = farmAt(5);
  runDue(s, MONDAY);
  const m = s.farm.orders.meter;
  assert.ok(m, 'the meter exists from L5');
  assert.equal(m.v, 0);
  let t = MONDAY;
  let chests = 0;
  for (let i = 0; i < 400 && s.farm.orders.meter.c < 3; i++) {
    for (const k of Object.keys(slots(s))) {
      const o = slots(s)[k].order;
      if (!o) continue;
      for (const [it, q] of Object.entries(o.items)) give(s, it, q);
      const v0 = s.farm.orders.meter.v;
      const r = actOk(s, 'orderFill', { slot: Number(k), n: nOf(s, Number(k)) }, { now: t });
      assert.equal(s.farm.orders.meter.v - v0, o.simple ? Math.floor(o.value / 4) : o.value);
      chests += evs(r, 'meterChest').length;
    }
    t += ORDERS.refillMs;
    runDue(s, t);
  }
  assert.equal(chests, 3);
  const e = s.farm.orders.meter.e;
  assert.ok(s.farm.orders.meter.v * 10_000 >= e * ORDERS.meter.chests[2].atBp);
  // a new week resets it
  runDue(s, MONDAY + 7 * DAY);
  assert.equal(s.farm.orders.meter.v, 0);
  assert.equal(s.farm.orders.meter.c, 0);
});

test('an order holding an item that is no longer live is replaced (G-VALID again on boot)', () => {
  const s = farmAt(3);
  runDue(s, T0);
  const later = notLiveDef('items', (i) => i.kind === 'crop').id;          // a crop of a later milestone
  slots(s)['1'].order = { ...slots(s)['1'].order, items: { [later]: 3 } };
  runDue(s, T0 + 1);
  assert.ok(!(later in slots(s)['1'].order.items));
});

test('the safety net: an empty board is not "hard"; a board of only far-off orders gets one simple order', () => {
  const s = randomFarm(3);
  s.farm.xp = xpForLevel(8);
  s.farm.orders.slots = {};
  runDue(s, T0);
  const firstRound = orders(s);
  assert.ok(firstRound.some((o) => !o.simple), 'a fresh board asks for real orders');
  // make every open order far off: 99 Pumpkins each (12 h crop, nothing in stock)
  for (const k of Object.keys(slots(s))) slots(s)[k].order = { ...slots(s)[k].order, items: { pumpkin: 99 }, simple: false };
  actOk(s, 'orderDiscard', { slot: 0, n: nOf(s, 0), confirm: ['PINNED'] }, { now: T0 + 1 });
  runDue(s, T0 + 1 + ORDERS.refillMs);
  assert.equal(slots(s)['0'].order.simple, true, 'the rescue order');
  const [item, qty] = Object.entries(slots(s)['0'].order.items)[0];
  assert.ok((s.farm.inventory[item] ?? 0) >= qty || CONTENT.crops.get(item).growMs <= ORDERS.safety.simpleCropMin * MIN);
});

test('G-VALID: a sapling is no producer, so no order asks for Apple Juice before a tree bears (RC-12)', () => {
  const s = farmAt(9);
  s.farm.wallet.coins = 1e7;
  const tree = put(s, 'apple_tree', { matureAt: T0 + 12 * HOUR, readyAt: T0 + 13 * HOUR });
  put(s, 'juice_press');
  const P = producers(s, T0);
  assert.equal(canMake(s, P, 'apple', new Map()), false, 'a sapling bears nothing yet');
  assert.equal(canMake(s, P, 'apple_juice', new Map()), false);
  let asking = 0;
  for (let n = 1; n <= 300; n++) {
    s.farm.orders.n = n;
    s.farm.orders.golden = 1e9;
    s.farm.orders.recent = [];
    const o = generateOrder(s, T0, makeCtx(s, { now: T0, pid: 'sys', cid: 'sys', seq: n }).rng);
    if (o && (o.items.apple_juice || o.items.apple)) asking++;
  }
  assert.equal(asking, 0);
  s.farm.objects[tree].matureAt = T0;
  resetGrid(s);                                     // a direct write (no Tx): drop the derived caches (RC-20)
  assert.equal(canMake(s, producers(s, T0 + 1), 'apple_juice', new Map()), true, 'a bearing tree is');
});

test('the quick slot asks only for goods the farm can have within ORDERS.quick.readyMinutes (RC-01)', async () => {
  const { readyWithin } = await import('../shared/rules/orders-board.js');
  const mins = ORDERS.quick.readyMinutes;
  if (!Number.isSafeInteger(mins)) return;            // content has not opted in
  let checked = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const s = farmAt(3 + (seed % 9), { seed });
    runDue(s, T0);
    const first = s.farm.orders.slots['0'].order;
    for (const [i, q] of Object.entries(first.items)) give(s, i, q);
    actOk(s, 'orderFill', { slot: 0, n: first.n }, { now: T0 + 1 });
    const { refillMsOf } = await import('../shared/rules/orders-board.js');
    runDue(s, T0 + 1 + refillMsOf(0));
    const o = s.farm.orders.slots['0'].order;
    if (!o || o.golden || o.simple) continue;
    checked++;
    for (const item of Object.keys(o.items)) {
      // the pool falls back to everything only when nothing at all is that quick
      assert.ok(readyWithin(s, item, mins), `seed ${seed}: quick order asks for ${item}`);
    }
  }
  assert.ok(checked >= 5, `only ${checked} quick orders looked at`);
});
