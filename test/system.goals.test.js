// The scheduler contract of shared/rules/system.js (tech §15.1, docs/agent-notes/server.md): every due system action
// passes its own check and clears its condition; nextSystemDueAt agrees with dueSystemActions at the boundary;
// catch-up after downtime is one action per kind; fuzzed over random farms and clocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { COOP, xpForLevel } from '../shared/content/index.js';
import { dueSystemActions, nextSystemDueAt, nextDayStart } from '../shared/rules/system.js';
import { dayIndex } from '../shared/rules/calendar.js';
import { refillMsOf } from '../shared/rules/orders-board.js';
import { createFarm, validateState } from '../shared/rules/state.js';
import { farmAt, put, give, runDue, sys, actOk, mulberry32, T0, MIN, HOUR, DAY, MONDAY } from './helpers/rules-goals.js';

/** The number of the order in board slot `slot` (what the player saw; RC-07), or 0 for an empty slot. */
const nOf = (st, slot) => st.farm.orders?.slots?.[String(slot)]?.order?.n ?? 0;

test('a fresh farm has nothing due; the next due time is the next local midnight', () => {
  const s = createFarm(1, T0);
  assert.deepEqual(dueSystemActions(s, T0), []);
  const next = nextSystemDueAt(s, T0);
  const midnight = nextDayStart(T0, s.meta.tz);
  assert.ok(next > T0 && next <= midnight, 'the next local midnight, or an economy timer before it (debris regrowth)');
  assert.equal(dayIndex(midnight, s.meta.tz), dayIndex(T0, s.meta.tz) + 1);
  assert.equal(dayIndex(midnight - 1, s.meta.tz), dayIndex(T0, s.meta.tz));
});

test('nextDayStart is exact across DST changes (Europe/Sofia: 2026-03-29 and 2026-10-25)', () => {
  for (const [y, m, d] of [[2026, 2, 28], [2026, 9, 24], [2026, 5, 1]]) {
    const noon = Date.UTC(y, m, d, 10);
    const n = nextDayStart(noon, 'Europe/Sofia');
    assert.equal(dayIndex(n, 'Europe/Sofia'), dayIndex(noon, 'Europe/Sofia') + 1);
    assert.equal(dayIndex(n - 1, 'Europe/Sofia'), dayIndex(noon, 'Europe/Sofia'));
  }
});

test('system actions refuse when not due (a stale timer or a replay of a duplicate never double-applies)', () => {
  const s = farmAt(4);
  runDue(s, T0);
  assert.equal(sys(s, '_rollover', {}, T0).code, ERR.ALREADY_DONE);
  assert.equal(sys(s, '_orders', {}, T0).code, ERR.ALREADY_DONE);
  assert.equal(sys(s, '_golden', {}, T0).code, ERR.ALREADY_DONE);
});

test('fuzz: due actions pass, clear their condition, and nextSystemDueAt is never in the past or NaN', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = mulberry32(seed);
    const s = farmAt(1 + Math.floor(rnd() * 12), { seed });
    let now = T0 + Math.floor(rnd() * 7 * DAY);
    const bench = put(s, 'sunset_bench');
    for (let step = 0; step < 40; step++) {
      runDue(s, now);
      const next = nextSystemDueAt(s, now);
      assert.ok(Number.isFinite(next) && next > now, `seed ${seed}: next ${next} <= now ${now}`);
      // the boundary agrees: nothing due just before `next`, something due at it (unless it is a midnight with
      // no work: a rollover is always work)
      assert.deepEqual(dueSystemActions(s, next - 1), [], `seed ${seed}: due before next`);
      assert.ok(dueSystemActions(s, next).length > 0, `seed ${seed}: nothing due at next`);
      // random play between timers
      const r = rnd();
      if (r < 0.3) {
        const k = Object.keys(s.farm.orders.slots).find((x) => s.farm.orders.slots[x].order);
        if (k !== undefined) actOk(s, 'orderDiscard', { slot: Number(k), n: nOf(s, Number(k)), confirm: ['PINNED'] }, { now });
      } else if (r < 0.4) {
        if (!s.farm.coop.bench.p1) actOk(s, 'sit', { id: bench }, { pid: 'p1', now });
        if (!s.farm.coop.bench.p2) actOk(s, 'sit', { id: bench }, { pid: 'p2', now });
      } else if (r < 0.5 && s.farm.coop.bench.p1) actOk(s, 'stand', {}, { pid: 'p1', now });
      else if (r < 0.6) s.farm.xp += Math.floor(rnd() * 2000);
      now = rnd() < 0.5 ? next : now + Math.floor(rnd() * 3 * HOUR);
    }
    assert.deepEqual(validateState(s), [], `seed ${seed}`);
  }
});

test('after a week offline: one _rollover, one _orders, every slot refilled, the meter and challenge restarted', () => {
  const s = farmAt(9, { now: MONDAY });
  runDue(s, MONDAY);
  for (const k of Object.keys(s.farm.orders.slots)) actOk(s, 'orderDiscard', { slot: Number(k), n: nOf(s, Number(k)), confirm: ['PINNED'] }, { now: MONDAY });
  const ran = runDue(s, MONDAY + 9 * DAY);
  assert.deepEqual(ran.filter((t) => ['_orders', '_rollover', '_golden'].includes(t)).sort(), ['_orders', '_rollover']);
  for (const slot of Object.values(s.farm.orders.slots)) assert.ok(slot.order);
  assert.equal(s.farm.orders.meter.v, 0);
  assert.ok(s.farm.challenge.cur);
});

test('the board refill time is a due time; a rushed slot is due at once', () => {
  const s = farmAt(3);
  runDue(s, T0);
  give(s, 'wheat', 8);
  actOk(s, 'orderFill', { slot: 0, n: nOf(s, 0) }, { now: T0 + 10 });
  assert.equal(nextSystemDueAt(s, T0 + 10), T0 + 10 + refillMsOf(0));         // slot 0 is the quick slot (RC-01)
  actOk(s, 'orderRush', { slot: 0 }, { now: T0 + 20 });
  assert.deepEqual(dueSystemActions(s, T0 + 20).map((d) => d.type), ['_orders']);
  assert.ok(COOP && MIN && xpForLevel);
});
