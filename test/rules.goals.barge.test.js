// The River Barge (GDD §5.7): docking Monday 06:00 with rows sized by last week's play, crates from goods made in
// the last 14 days (G-VALID, no shared inputs), payment per crate and per completed row, help flags, the ladder at
// the Sunday 20:00 cast-off, the jetty preview, catch-up after downtime, and the row double-pay guard.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { BARGE, itemOf, eHours, levelFromXp, recipeOf } from '../shared/content/index.js';
import { CELEBRATIONS } from '../shared/rules/index.js';
import {
  dockAt, castOffAt, rowsFor, rowPay, cratePay, bargePool, madeRecently, bargeView, rowsWanted, neverMadePool,
} from '../shared/rules/actions/barge.js';
import { dayOf, weekOf } from '../shared/rules/coop.js';
import {
  farmAt, put, give, runDue, act, actOk, evs, valid, sys, forceM1bGoals, MONDAY, HOUR, DAY, MIN,
} from './helpers/rules-goals.js';

before(forceM1bGoals);

const SUNDAY_BEFORE = MONDAY - DAY;

/** A L15+ farm with producers and a `made` log, so the barge has goods to ask for. */
function bargeFarm(level = 16, { made = ['apple', 'apple_juice', 'pumpkin', 'cheese', 'wool', 'potato'] } = {}) {
  const s = farmAt(level, { now: SUNDAY_BEFORE });
  for (let i = 0; i < 4; i++) put(s, 'apple_tree');
  for (const b of ['juice_press', 'dairy', 'bakery', 'mill', 'feed_mill']) put(s, b);
  const barn = put(s, 'cow_barn');
  for (let i = 0; i < 2; i++) put(s, 'cow', { home: barn });
  const pasture = put(s, 'pasture');
  for (let i = 0; i < 3; i++) put(s, 'sheep', { home: pasture });
  for (const it of made) s.farm.made[it] = dayOf(s, MONDAY);
  return s;
}

test('Captain Reed docks Monday 06:00 and casts off Sunday 20:00 in the farm zone', () => {
  const s = bargeFarm();
  const w = weekOf(s, MONDAY);
  assert.equal(new Date(dockAt(s, w)).toISOString(), '2026-10-05T03:00:00.000Z');     // 06:00 in Sofia (UTC+3)
  assert.equal(new Date(castOffAt(s, w)).toISOString(), '2026-10-11T17:00:00.000Z');  // Sunday 20:00
  runDue(s, MONDAY - 5 * HOUR);                       // Monday 05:00: not yet
  assert.equal(s.farm.barge.docked, false);
  runDue(s, dockAt(s, w));
  assert.equal(s.farm.barge.docked, true);
  assert.equal(s.farm.barge.w, w);
  valid(s);
});

test('rows: one per 3 hours played last week (1-3); the reference couple\'s 3 hours give 1, 4 hours 2', () => {
  // wave-2 QA D2: a row per 3 hours (was 2), so the casual couple can load what the barge brings
  assert.deepEqual([0, 60, 180, 181, 360, 361, 600, -1].map(rowsFor), [1, 1, 1, 2, 2, 3, 3, 1]);
  // play minutes are counted per farm minute: two players acting in the same minute count once
  const s = bargeFarm();
  const start = SUNDAY_BEFORE - 7 * HOUR;
  for (let m = 0; m < 121; m++) {
    for (const pid of ['p1', 'p2']) actOk(s, 'nameFarm', { name: `${pid} ${m}` }, { pid, now: start + m * MIN });
  }
  assert.equal(s.farm.barge.play.n, 121, 'counted twice it would be 242 minutes (3 rows)');
  assert.equal(s.farm.barge.play.w, weekOf(s, SUNDAY_BEFORE));
  actOk(s, 'nameFarm', { name: 'Monday' }, { now: MONDAY + MIN });
  assert.deepEqual(s.farm.barge.play, { w: weekOf(s, MONDAY), m: Math.floor((MONDAY + MIN) / MIN), n: 1, prev: 121 });
  assert.equal(rowsWanted(s, weekOf(s, MONDAY)), 1, '121 minutes last week: one row');
  runDue(s, MONDAY + HOUR);
  assert.ok(s.farm.barge.rows >= 1 && s.farm.barge.rows <= 3, 'as many whole rows as the goods allow');
});

test('crates: goods made in the last 14 days, producible now, worth E x 0.12 h, capped by 1 h of one producer', () => {
  const s = bargeFarm();
  const now = MONDAY + HOUR;
  const pool = bargePool(s, now);
  assert.ok(pool.includes('apple') && pool.includes('apple_juice') && pool.includes('cheese'));
  assert.ok(!pool.includes('wheat') && !pool.includes('egg'), 'session crops and fast animal goods are no cargo');
  assert.ok(!pool.includes('bread'), 'not made in the last 14 days');
  s.farm.made.apple = dayOf(s, now) - 15;
  assert.ok(!madeRecently(s, 'apple', now) && !bargePool(s, now).includes('apple'));
  s.farm.made.apple = dayOf(s, now) - 14;
  assert.ok(bargePool(s, now).includes('apple'));
  runDue(s, MONDAY);
  const b = s.farm.barge;
  const L = levelFromXp(s.farm.xp);
  const items = Object.values(b.crates).map((c) => c.item);
  assert.equal(new Set(items).size, items.length, 'one crate per item');
  // at most one crate a week asks for a good the farm has never made (wave-2 QA RC-15)
  const fresh = neverMadePool(s, MONDAY);
  assert.ok(items.filter((i) => !pool.includes(i)).length <= 1);
  for (const c of Object.values(b.crates)) {
    assert.ok(pool.includes(c.item) || fresh.includes(c.item), c.item);
    const v = itemOf(c.item).sell;
    assert.ok(c.qty >= 1 && c.qty * v <= eHours(L, BARGE.crateHoursBp) + v, `${c.item} x ${c.qty}`);
  }
  for (const a of items) {
    for (const z of items) {
      if (a === z) continue;
      const ia = Object.keys(recipeOf(itemOf(a).source)?.inputs ?? {});
      const iz = Object.keys(recipeOf(itemOf(z).source)?.inputs ?? {});
      assert.ok(!ia.includes(z) && !ia.some((x) => iz.includes(x)), `${a} and ${z} share an input`);
    }
  }
  assert.equal(Object.keys(b.crates).length % 3, 0, 'only whole rows are offered');
});

test('loading a crate pays 1.6 x V x qty and XP; a full row pays the row bonus once (row double-pay guard)', () => {
  const s = bargeFarm();
  runDue(s, MONDAY);
  const b = s.farm.barge;
  assert.ok(b.rows >= 1);
  for (const c of Object.values(b.crates)) give(s, c.item, c.qty);
  const c0 = b.crates['0'];
  const pay = cratePay(s, c0, MONDAY + HOUR);
  assert.equal(pay.coins, Math.floor((itemOf(c0.item).sell * c0.qty * 16_000) / 10_000));
  const coins = s.farm.wallet.coins;
  const r = actOk(s, 'bargeLoad', { i: 0 }, { now: MONDAY + HOUR });
  assert.equal(s.farm.wallet.coins, coins + pay.coins);
  assert.equal(evs(r, 'bargeLoaded')[0].xp, pay.xp);
  assert.equal(act(s, 'bargeLoad', { i: 0 }, { now: MONDAY + HOUR, pid: 'p2' }).code, 'ALREADY_DONE');
  actOk(s, 'bargeLoad', { i: 1 }, { now: MONDAY + HOUR, pid: 'p2' });
  const expect = rowPay(s, 0);
  const acorns = s.farm.wallet.acorns;
  const last = actOk(s, 'bargeLoad', { i: 2 }, { now: MONDAY + 2 * HOUR });
  const row = evs(last, 'bargeRow')[0];
  assert.ok(row && CELEBRATIONS.has('bargeRow'));
  assert.equal(row.coins, expect.coins);
  assert.equal(row.acorns, expect.acorns);
  assert.deepEqual(row.loaders, ['p1', 'p2']);
  assert.ok(s.farm.wallet.acorns >= acorns + expect.acorns);
  assert.equal(s.farm.inventory.compost ?? 0, expect.compost);
  assert.equal(s.farm.stats.bargeRows, 1);
  // the same row can never pay again: every crate is loaded, a re-sent load is ALREADY_DONE
  for (const i of [0, 1, 2]) assert.equal(act(s, 'bargeLoad', { i }, { now: MONDAY + 3 * HOUR }).code, 'ALREADY_DONE');
  assert.equal(s.farm.stats.bargeRows, 1);
  valid(s);
});

test('the chest is split in thirds per completed row and sums to (1 + t) Acorns and 3t Compost over three rows', () => {
  const s = bargeFarm();
  s.farm.barge.t = 4;
  let acorns = 0;
  for (let k = 0; k < 3; k++) acorns += rowPay(s, k).acorns - BARGE.row.acorns;
  assert.equal(acorns, 1 + 4);
  assert.equal(rowPay(s, 0).compost * 3, 3 * 4);
});

test('crates need the whole quantity; adult horses add 5 % each up to 20 %', () => {
  const s = bargeFarm();
  runDue(s, MONDAY);
  const c0 = s.farm.barge.crates['0'];
  give(s, c0.item, c0.qty - 1);
  assert.equal(act(s, 'bargeLoad', { i: 0 }, { now: MONDAY + HOUR }).code, 'NO_ITEMS');
  assert.equal(act(s, 'bargeLoad', { i: 8 }, { now: MONDAY + HOUR }).code, s.farm.barge.rows === 3 ? 'NO_ITEMS'
    : 'NOT_FOUND');
  const base = cratePay(s, c0, MONDAY).coins;
  const stable = put(s, 'stable');
  for (let i = 0; i < 6; i++) put(s, 'horse', { home: stable, adultAt: MONDAY - DAY });
  const withHorses = cratePay(s, c0, MONDAY).coins;
  assert.equal(withHorses, base + Math.floor((base * BARGE.horseMaxBp) / 10_000), 'capped at +20 %');
});

test('help flags: at most three; the OTHER player filling one: +10 % XP and a Heart each; self-fill is normal', () => {
  const s = bargeFarm();
  runDue(s, MONDAY);
  const b = s.farm.barge;
  for (const c of Object.values(b.crates)) give(s, c.item, c.qty * 2);
  actOk(s, 'bargeFlag', { i: 0 }, { now: MONDAY + HOUR, pid: 'p1' });
  actOk(s, 'bargeFlag', { i: 1 }, { now: MONDAY + HOUR, pid: 'p1' });
  assert.equal(act(s, 'bargeFlag', { i: 0 }, { now: MONDAY + HOUR, pid: 'p2' }).code, 'OCCUPIED');
  const pay = cratePay(s, b.crates['0'], MONDAY + HOUR);
  const h1 = s.players.p1.hearts;
  const h2 = s.players.p2.hearts;
  const r = actOk(s, 'bargeLoad', { i: 0 }, { now: MONDAY + HOUR, pid: 'p2' });
  assert.equal(evs(r, 'bargeLoaded')[0].xp, pay.xp + Math.floor(pay.xp / 10));
  assert.equal(s.players.p1.hearts, h1 + 1);
  assert.equal(s.players.p2.hearts, h2 + 1);
  const self = actOk(s, 'bargeLoad', { i: 1 }, { now: MONDAY + HOUR, pid: 'p1' });
  assert.equal(evs(self, 'bargeLoaded')[0].helped, null);
  assert.equal(s.players.p1.hearts, h1 + 1, 'no Heart for filling your own flag');
  if (b.rows >= 2) {
    for (const i of [3, 4]) actOk(s, 'bargeFlag', { i }, { now: MONDAY + HOUR });
    assert.equal(act(s, 'bargeFlag', { i: 5 }, { now: MONDAY + HOUR }).code, 'CAP');
  }
});

test('the ladder: every row loaded raises the tier at the cast-off, a week short lowers it, never below 1', () => {
  const s = bargeFarm();
  runDue(s, MONDAY);
  for (const c of Object.values(s.farm.barge.crates)) give(s, c.item, c.qty);
  for (const i of Object.keys(s.farm.barge.crates)) actOk(s, 'bargeLoad', { i: Number(i) }, { now: MONDAY + HOUR });
  const w = s.farm.barge.w;
  const r = sys(s, '_barge', {}, castOffAt(s, w));
  assert.equal(evs(r, 'bargeCastOff')[0].t, 2);
  assert.equal(s.farm.barge.t, 2);
  assert.equal(s.farm.barge.streak, 1);
  assert.equal(s.farm.stats.bargeStreak, 1);
  assert.ok(s.farm.barge.next && s.farm.barge.next.w === w + 1, 'next week\'s goods are on the jetty');
  assert.equal(sys(s, '_barge', {}, castOffAt(s, w) + MIN).code, 'ALREADY_DONE');
  // next week: dock with the preview, load nothing: the tier drops back
  const next = s.farm.barge.next;
  runDue(s, dockAt(s, w + 1));
  const pairs = (list) => list.map((c) => [c.item, c.qty]);
  assert.deepEqual(pairs(Object.values(s.farm.barge.crates)), pairs(next.crates));
  sys(s, '_barge', {}, castOffAt(s, w + 1));
  assert.equal(s.farm.barge.t, 1);
  assert.equal(s.farm.barge.streak, 0);
  valid(s);
});

test('catch-up: two weeks of downtime cast off once, count the missed week, and dock this week', () => {
  const s = bargeFarm();
  runDue(s, MONDAY);
  s.farm.barge.t = 4;
  const w = s.farm.barge.w;
  const later = dockAt(s, w + 2) + HOUR;
  const ran = runDue(s, later);
  assert.equal(ran.filter((t) => t === '_barge').length, 1);
  assert.equal(s.farm.barge.w, w + 2);
  assert.equal(s.farm.barge.docked, true);
  assert.equal(s.farm.barge.t, 2, 'the unloaded week -1, the missed week -1');
  assert.ok(bargeView(s, later).docked);
  valid(s);
});

test('F1 "load 3 crates" and F2 "load a full row" open in the This week tab and complete from the barge', () => {
  const s = bargeFarm(17);
  runDue(s, MONDAY);
  for (const c of Object.values(s.farm.barge.crates)) give(s, c.item, c.qty);
  const story = Object.keys(s.farm.quests.active).length;
  actOk(s, 'nameFarm', { name: 'Riverside' }, { now: MONDAY + HOUR });     // any action: the side chains open
  assert.ok(s.farm.quests.active.f1, 'F1 opened without a story slot');
  assert.ok(Object.keys(s.farm.quests.active).length > story);
  actOk(s, 'bargeLoad', { i: 0 }, { now: MONDAY + HOUR });
  actOk(s, 'bargeLoad', { i: 1 }, { now: MONDAY + HOUR });
  actOk(s, 'bargeLoad', { i: 2 }, { now: MONDAY + HOUR });
  assert.ok(s.farm.quests.done.f1, 'three crates loaded');
  assert.ok(s.farm.quests.active.f2, 'F2 follows F1');
  valid(s);
});

test('nothing made lately: the barge sails light (no rows, the ladder does not move)', () => {
  const s = bargeFarm(16, { made: [] });
  runDue(s, MONDAY);
  assert.equal(s.farm.barge.docked, true);
  assert.equal(s.farm.barge.rows, 0);
  assert.deepEqual(s.farm.barge.crates, {});
  sys(s, '_barge', {}, castOffAt(s, s.farm.barge.w));
  assert.equal(s.farm.barge.t, 1);
  valid(s);
});

test('the first barge of a farm (or of an old save) takes what the farm has ever made: never empty for a busy farm', () => {
  const s = bargeFarm(16, { made: [] });
  s.farm.stats['craft.apple_juice'] = 40;
  s.farm.stats['pick.apple'] = 12;
  s.farm.stats['collect.wool'] = 9;
  s.farm.stats['harvest.pumpkin'] = 30;
  runDue(s, MONDAY);
  assert.equal(s.farm.barge.rows, 1, Object.values(s.farm.barge.crates).map((c) => c.item).join());
  // from the second week on only the last 14 days count
  sys(s, '_barge', {}, castOffAt(s, s.farm.barge.w));
  assert.equal(s.farm.barge.next.rows, 0, 'nothing in the 14-day log: next week sails light');
});

test('RC-07: a load or flag for last week\'s manifest (or another item) never lands on this week\'s crate', () => {
  const s = bargeFarm();
  runDue(s, MONDAY);
  const b = s.farm.barge;
  assert.equal(b.docked, true);
  const c0 = b.crates['0'];
  give(s, c0.item, c0.qty);
  const now = MONDAY + HOUR;
  assert.equal(act(s, 'bargeLoad', { i: 0, w: b.w - 1, item: c0.item }, { now }).code, 'NOT_FOUND', 'last week');
  assert.equal(act(s, 'bargeFlag', { i: 0, w: b.w - 1, item: c0.item }, { now }).code, 'NOT_FOUND', 'last week flag');
  const other = c0.item === 'apple' ? 'cheese' : 'apple';
  assert.equal(act(s, 'bargeLoad', { i: 0, w: b.w, item: other }, { now }).code, 'NOT_FOUND', 'another item');
  assert.equal(s.farm.barge.crates['0'].by, null);
  actOk(s, 'bargeFlag', { i: 0, w: b.w, item: c0.item }, { now });
  actOk(s, 'bargeLoad', { i: 0, w: b.w, item: c0.item }, { now, pid: 'p2' });
  assert.equal(s.farm.barge.crates['0'].by, 'p2');
});

test('RC-15: a good the farm can make but never made comes up on the barge, one crate a week at most', () => {
  let seen = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const s = bargeFarm(16, { made: ['apple', 'apple_juice', 'cheese', 'wool'] });
    s.meta.farmSeed = seed;
    const fresh = neverMadePool(s, MONDAY);
    assert.ok(fresh.every((i) => !(s.farm.stats[`craft.${i}`] > 0)));
    runDue(s, MONDAY);
    const items = Object.values(s.farm.barge.crates).map((c) => c.item);
    const n = items.filter((i) => fresh.includes(i) && !bargePool(s, MONDAY).includes(i)).length;
    assert.ok(n <= 1, `seed ${seed}: ${items}`);
    seen += n;
  }
  assert.ok(seen > 0, 'a never-made good was asked for at least once in 12 weeks');
});
