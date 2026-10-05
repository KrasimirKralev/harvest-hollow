// Daily and weekly systems (GDD §5.8): Daily Gift, Farm Weeks, the Almanac and its Together task, the Couple
// Challenge, the rollover catch-up. Times are the farm's local calendar (Europe/Sofia).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { ALMANAC, DAILY_GIFT, FARM_WEEKS, COUPLE_CHALLENGE, eHours, cropOf, xpForLevel, levelFromXp } from '../shared/content/index.js';
import { dayOf, weekOf } from '../shared/rules/coop.js';
import { giftReward, almanacLiveSlot } from '../shared/rules/daily.js';
import { farmAt, put, give, credit, runDue, act, actOk, evs, valid, T0, MIN, HOUR, DAY, MONDAY } from './helpers/rules-goals.js';

const harvested = (crop, qty = cropOf(crop).yield, o = {}) => ({ e: 'harvested', id: 'home.0.0', crop, qty, planter: 'p1',
  xp: cropOf(crop).xp, fresh: false, ribbon: false, bonus: 0, star: 0, ...o });

test('Daily Gift: once per farm day from L3, either partner; a missed day only pauses the calendar', () => {
  const s = farmAt(2, { now: MONDAY });
  assert.equal(act(s, 'claimGift', {}, { now: MONDAY }).code, ERR.LOCKED);
  s.farm.xp = xpForLevel(3);
  const r = actOk(s, 'claimGift', {}, { now: MONDAY, pid: 'p2' });
  assert.equal(evs(r, 'gift')[0].day, 1);
  assert.equal(act(s, 'claimGift', {}, { now: MONDAY + HOUR }).code, ERR.ALREADY_DONE, 'the partner too');
  runDue(s, MONDAY + 3 * DAY);                                   // two days away: paused, not reset
  const r2 = actOk(s, 'claimGift', {}, { now: MONDAY + 3 * DAY });
  assert.equal(evs(r2, 'gift')[0].day, 2);
  assert.equal(s.farm.daily.gift.n, 2);
  valid(s);
});

test('Daily Gift rewards follow the calendar; locked rewards pay the day\'s coins instead', () => {
  const s = farmAt(3, { now: MONDAY });
  s.farm.daily.gift.n = 2;                                        // day 3: 3 Compost (locked until L8)
  const r = giftReward(s, MONDAY);
  assert.equal(r.day, 3);
  assert.equal(r.items, null);
  assert.equal(r.coins, eHours(3, DAILY_GIFT.fallbackCoinsBp));
  s.farm.xp = xpForLevel(8);
  assert.deepEqual(giftReward(s, MONDAY).items, { compost: 3 });
  s.farm.daily.gift.n = 6;                                        // day 7: 2 Acorns
  const acorns = s.farm.wallet.acorns;
  actOk(s, 'claimGift', {}, { now: MONDAY });
  assert.equal(s.farm.wallet.acorns, acorns + 2);
  s.farm.daily.gift.n = 27;                                       // day 28: 5 Acorns + the season's decor (October)
  const r28 = giftReward(s, MONDAY);
  assert.equal(r28.acorns, 5);
  assert.equal(r28.decor, DAILY_GIFT.seasonDecor.autumn);
  s.farm.daily.gift.n = 28;                                       // the calendar cycles
  assert.equal(giftReward(s, MONDAY).day, 1);
});

test('Farm Weeks: a week counts with two play days of 5+ minutes; skip weeks cover gaps; breaking costs only the counter', () => {
  const s = farmAt(3, { now: MONDAY });
  const play = (t, minutes = 6) => {
    credit(s, [], { now: t, pid: 'p1' });
    credit(s, [], { now: t + minutes * MIN, pid: 'p2' });
  };
  let w = MONDAY;
  for (let week = 0; week < FARM_WEEKS.skipEvery; week++) {
    runDue(s, w);
    play(w);
    play(w + DAY);
    w += 7 * DAY;
  }
  runDue(s, w);
  assert.equal(s.farm.daily.weeks.streak, FARM_WEEKS.skipEvery);
  assert.equal(s.farm.daily.weeks.skips, 1, 'one skip week per 4 streak weeks');
  // a week with one short session (3 minutes): not counted, the skip week is used
  play(w, 3);
  w += 7 * DAY;
  runDue(s, w);
  assert.equal(s.farm.daily.weeks.streak, FARM_WEEKS.skipEvery);
  assert.equal(s.farm.daily.weeks.skips, 0);
  // the next empty week breaks it; the best is kept
  w += 7 * DAY;
  runDue(s, w);
  assert.equal(s.farm.daily.weeks.streak, 0);
  assert.equal(s.farm.daily.weeks.best, FARM_WEEKS.skipEvery);
  assert.ok(s.farm.ribbons.farm_weeks, 'Farm Weeks Bronze at a 4-week best');
  valid(s);
});

test('one rollover catches up any number of missed days; the server never replays days one by one', () => {
  const s = farmAt(8, { now: MONDAY });
  runDue(s, MONDAY);
  const ran = runDue(s, MONDAY + 40 * DAY);
  assert.equal(ran.filter((t) => t === '_rollover').length, 1);
  assert.equal(s.farm.daily.day, dayOf(s, MONDAY + 40 * DAY));
  assert.equal(s.farm.daily.week, weekOf(s, MONDAY + 40 * DAY));
  assert.equal(act(s, 'claimGift', {}, { now: MONDAY + 40 * DAY }).ok, true);
});

test('Almanac: 4 tasks each from L8, complementary between the partners, refresh on completion, 4 paid a day', () => {
  const s = farmAt(8, { now: MONDAY });
  put(s, 'coop');
  runDue(s, MONDAY);
  const a1 = s.players.p1.almanac;
  const a2 = s.players.p2.almanac;
  assert.equal(Object.keys(a1.tasks).length, ALMANAC.tasksPerPlayer);
  assert.equal(Object.keys(a2.tasks).length, ALMANAC.tasksPerPlayer);
  const targets = (a) => Object.values(a.tasks).map((t) => `${t.verb}:${t.ref}`);
  for (const t of targets(a2)) assert.ok(!targets(a1).includes(t), `both players got ${t}`);
  // complete p1's tasks repeatedly with matching deeds: the first 4 pay, later ones count for the ribbon only
  let paid = 0;
  let done = 0;
  let coins = 0;
  for (let round = 0; round < 12; round++) {
    const slot = almanacLiveSlot(s.players.p1.almanac);              // one live task at a time (wave-2 QA RC-12)
    const t = s.players.p1.almanac.tasks[slot];
    const ev = deedEvent(t);
    if (!ev) { actOk(s, 'almanacReroll', { slot: Number(slot) }, { now: MONDAY }); continue; }
    const tx = credit(s, Array(t.qty).fill(ev), { now: MONDAY + round, pid: 'p1' });
    for (const d of tx.events.filter((e) => e.e === 'almanacDone' && e.pid === 'p1')) { done++; if (d.paid) { paid++; coins += d.coins; } }
  }
  assert.ok(done >= 5, `${done} tasks done`);
  assert.equal(paid, ALMANAC.paidPerDay);
  assert.equal(coins, ALMANAC.paidPerDay * eHours(8, ALMANAC.coinsBp));
  assert.equal(s.players.p1.almanac.chest, true, 'the day\'s first four open the Daily chest');
  assert.equal(s.players.p1.stats.almanacDone, done);
  assert.equal(Object.keys(s.players.p1.almanac.tasks).length, ALMANAC.tasksPerPlayer, 'tasks refresh when completed');
  valid(s);
});

/** One event that advances an Almanac task by one unit, or null when the test farm cannot express it. */
function deedEvent(t) {
  switch (t.verb) {
    case 'harvest': return cropOf(t.ref) ? harvested(t.ref, 1) : null;
    case 'plant': return { e: 'planted', id: 'home.0.0', crop: t.ref };
    case 'water': return { e: 'watered', id: 'home.0.0', kind: 'crop', tend: false, savedMs: 1 };
    case 'collect': return { e: 'collected', id: 'a', animal: 'chicken', item: t.ref, qty: 1, xp: 1, ribbon: false, bonus: 0 };
    case 'pet': return { e: 'petted', ids: ['a'], both: [] };
    case 'make': return { e: 'crafted', id: 'b', building: 'feed_mill', recipe: t.ref, item: t.ref, qty: 1, xp: 1 };
    case 'clear': return { e: 'cleared', id: 'd', def: 'weed', xp: 1, coins: 5 };
    default: return null;
  }
}

test('Almanac: while both are online an action by either counts for both; a reroll is free once a day', () => {
  const s = farmAt(8, { now: MONDAY });
  runDue(s, MONDAY);
  s.players.p1.almanac.tasks['0'] = { tpl: 'harvest', verb: 'harvest', ref: 'wheat', qty: 10, n: 0 };
  s.players.p2.almanac.tasks['0'] = { tpl: 'harvest', verb: 'harvest', ref: 'wheat', qty: 10, n: 0 };
  credit(s, [harvested('wheat', 2)], { pid: 'p1', now: MONDAY });
  assert.equal(s.players.p1.almanac.tasks['0'].n, 2);
  assert.equal(s.players.p2.almanac.tasks['0'].n, 0, 'alone: only my tasks');
  credit(s, [harvested('wheat', 2)], { pid: 'p1', now: MONDAY + 1, ext: { online: ['p1', 'p2'] } });
  assert.equal(s.players.p1.almanac.tasks['0'].n, 4);
  assert.equal(s.players.p2.almanac.tasks['0'].n, 2, 'together: both');
  actOk(s, 'almanacReroll', { slot: 1 }, { now: MONDAY });
  assert.equal(act(s, 'almanacReroll', { slot: 1 }, { now: MONDAY }).code, ERR.COOLDOWN);
  runDue(s, MONDAY + DAY);
  actOk(s, 'almanacReroll', { slot: 1 }, { now: MONDAY + DAY });
});

test('a partner who joins after the Almanac level gets their day at once; a farm reaching it starts it mid-day', () => {
  const L = ALMANAC.unlock;
  const s = farmAt(L - 1, { now: MONDAY, players: ['p1'] });
  runDue(s, MONDAY);
  assert.equal(s.players.p1.almanac.d, -1);
  credit(s, [{ e: 'cleared', id: 'x', def: 'weed', xp: xpForLevel(L) - s.farm.xp, coins: 0 }], { now: MONDAY + HOUR });
  assert.equal(levelFromXp(s.farm.xp), L);
  assert.equal(s.players.p1.almanac.d, dayOf(s, MONDAY));
  assert.ok(s.farm.daily.together);
});

test('Together task: shared counter, 2 Hearts each and 1 Compost when done', () => {
  const s = farmAt(8, { now: MONDAY });
  runDue(s, MONDAY);
  s.farm.daily.together = { d: dayOf(s, MONDAY), tpl: 'harvest_together', qty: 6, n: 0, by: {}, done: false };
  credit(s, [harvested('wheat', 4, { planter: 'p1' })], { pid: 'p1', now: MONDAY });
  const tx = credit(s, [harvested('wheat', 4, { planter: 'p2' })], { pid: 'p2', now: MONDAY + 1 });
  const t = s.farm.daily.together;
  assert.equal(t.done, true);
  assert.deepEqual(t.by, { p1: 4, p2: 2 });
  assert.equal(s.players.p1.hearts, ALMANAC.together.hearts);
  assert.equal(s.farm.inventory.compost, 1);
  assert.equal(tx.events.filter((e) => e.e === 'together' && e.kind === 'task').length, 1);
  credit(s, [harvested('wheat', 4, { planter: 'p2' })], { pid: 'p2', now: MONDAY + 2 });
  assert.equal(s.players.p1.hearts, ALMANAC.together.hearts, 'paid once');
});

test('Couple Challenge: starts the first Monday after L6, counts value, pays each contributor; Equal Partners', () => {
  const s = farmAt(6, { now: MONDAY + DAY });                      // L6 reached on a Tuesday
  runDue(s, MONDAY + DAY);
  assert.equal(s.farm.challenge.cur, null);
  runDue(s, MONDAY + 7 * DAY);
  const cur = s.farm.challenge.cur;
  assert.ok(cur, 'a challenge on the next Monday');
  assert.ok(COUPLE_CHALLENGE.templates.some((t) => t.id === cur.tpl && t.m === 'M1a'));
  // force a harvest-value challenge of a small target and finish it with both players
  s.farm.challenge.cur = { ...cur, tpl: 'harvest_value', target: 40, n: 0, by: {}, rec: {}, done: false };
  credit(s, [harvested('corn', 1)], { pid: 'p1', now: MONDAY + 7 * DAY + 1 });   // 15
  const acorns = s.farm.wallet.acorns;
  const tx = credit(s, [harvested('corn', 2, { planter: 'p2' })], { pid: 'p2', now: MONDAY + 7 * DAY + 2 });   // 30 -> 40 capped
  assert.equal(s.farm.challenge.cur.done, true);
  assert.equal(s.farm.wallet.acorns, acorns + COUPLE_CHALLENGE.reward.acorns);
  assert.equal(s.players.p1.hearts, COUPLE_CHALLENGE.reward.hearts);
  assert.equal(s.players.p2.hearts, COUPLE_CHALLENGE.reward.hearts);
  const ev = tx.events.find((e) => e.e === 'together' && e.kind === 'challenge');
  assert.equal(ev.equal, true);
  assert.equal(s.farm.storage.bunting, 1, 'the first prize decor');
  // the next week brings a different template
  runDue(s, MONDAY + 14 * DAY);
  assert.notEqual(s.farm.challenge.cur.tpl, 'harvest_value');
  assert.equal(s.farm.challenge.done, 1);
  valid(s);
});

test('Couple Challenge never counts order COUNT: orders count by value, simple orders by a quarter of it', () => {
  const s = farmAt(6, { now: MONDAY });
  runDue(s, MONDAY);
  runDue(s, MONDAY + 7 * DAY);
  s.farm.challenge.cur = { ...s.farm.challenge.cur, tpl: 'orders_value', target: 100_000, n: 0, by: {}, rec: {} };
  credit(s, [{ e: 'orderFilled', slot: 0, n: 1, coins: 10, xp: 1, acorns: 0, golden: false, simple: true, helped: null,
    value: 25, items: { wheat: 8 } }], { now: MONDAY + 7 * DAY });
  assert.equal(s.farm.challenge.cur.n, 25);
});

test('RC-12: only the live Almanac task counts; the next one opens when it is done', () => {
  const s = farmAt(8, { now: MONDAY });
  put(s, 'coop');
  runDue(s, MONDAY);
  const a = s.players.p1.almanac;
  const live = almanacLiveSlot(a);
  const other = Object.keys(a.tasks).find((k) => k !== live && deedEvent(a.tasks[k])
    && `${a.tasks[k].verb}:${a.tasks[k].ref}` !== `${a.tasks[live].verb}:${a.tasks[live].ref}`);
  if (!other) return;                                     // this farm's day offers no second expressible task
  const t = a.tasks[other];
  credit(s, Array(t.qty).fill(deedEvent(t)), { now: MONDAY + 1, pid: 'p1' });
  assert.equal(s.players.p1.almanac.tasks[other].n, 0, 'a task that is not live yet does not move');
  assert.equal(s.players.p1.almanac.done, a.done);
});
