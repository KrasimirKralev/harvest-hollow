// The County Fair (GDD §5.6): the week, the target, points, entries, medals, the Sunday 20:00 ceremony queued for an
// absent partner, and the exploit guards (entry spam, ceremony double-claim, catch-up after downtime).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { FAIR, levelRow, xpForLevel, itemOf } from '../shared/content/index.js';
import { CELEBRATIONS as RULE_CELEBRATIONS } from '../shared/rules/index.js';
import {
  fairTarget, niceInt, entryPoints10, fairCloseAt, medalCoins, medalFor, fairStanding, ceremonyUnseen, enterable,
  prizedFruitPoints10, ceremonyQueue,
} from '../shared/rules/actions/fair.js';
import { dueSystemActions, nextSystemDueAt } from '../shared/rules/system.js';
import { weekOf } from '../shared/rules/coop.js';
import {
  farmAt, give, runDue, act, actOk, evs, valid, sys, credit, forceM1bGoals, MONDAY, HOUR, DAY, MIN,
} from './helpers/rules-goals.js';

before(forceM1bGoals);

/** A farm at `level` on Monday MONDAY with this week's Fair open. */
function fairFarm(level = 14) {
  const s = farmAt(level);
  runDue(s, MONDAY);
  assert.ok(s.farm.fair.cur, 'the Fair opened');
  return s;
}

test('the target W is nice(E x 0.16 h / 100), frozen at the level the week opened with', () => {
  assert.deepEqual([niceInt(7), niceInt(23), niceInt(171), niceInt(1234), niceInt(97)], [7, 25, 170, 1200, 95]);
  assert.equal(fairTarget(14), niceInt(Math.round(levelRow(14).E * 0.16 / 100)));     // wave-2 QA D2 (was 0.3)
  const s = fairFarm(14);
  assert.equal(s.farm.fair.cur.W, fairTarget(14));
  s.farm.xp = xpForLevel(18);                         // a level-up mid-week does not move this week's target
  assert.equal(s.farm.fair.cur.W, fairTarget(14));
  valid(s);
});

test('no Fair before its level; a level-up into it opens this week at once', () => {
  const s = farmAt(13);
  assert.deepEqual(runDue(s, MONDAY).filter((t) => t === '_fair'), []);
  assert.equal(s.farm.fair.cur, null);
  give(s, 'bread', 3);
  assert.equal(act(s, 'fairEnter', { item: 'bread', qty: 1 }, { now: MONDAY }).code, 'LOCKED');
  // XP to the edge of L14, then one order's worth of XP crosses it: the Fair opens in the same action
  s.farm.xp = xpForLevel(14) - 1;
  credit(s, [{ e: 'orderFilled', slot: 0, n: 1, coins: 1, xp: 1, acorns: 0, golden: false, giver: null,
    simple: false, value: 1, items: {}, helped: null }], { now: MONDAY + HOUR });
  assert.equal(s.farm.fair.cur?.W, fairTarget(14));
  assert.ok(s.farm.fair.cur.open);
  actOk(s, 'fairEnter', { item: 'bread', qty: 1 }, { now: MONDAY + HOUR });
  valid(s);
});

test('points: entries score V / 100 per unit (one decimal), duet goods x 2, blue-ribbon animal goods 2 V / 100', () => {
  const s = fairFarm();
  assert.equal(entryPoints10(s, 'bread'), 10);                // V 96 -> 0.96 -> 1.0 point
  assert.equal(entryPoints10(s, 'sweetheart_cake'), 2 * 129); // V 1291 -> 12.9, duet x 2
  assert.equal(entryPoints10(s, 'golden_egg'), 66);           // 2 x 328 / 100 = 6.56 -> 6.6
  assert.equal(entryPoints10(s, 'wheat'), 0, 'raw crops score only as blue-ribbon harvests');
  assert.equal(entryPoints10(s, 'flour'), 0, 'T2 goods are no Fair entries');
  give(s, 'bread', 12);
  give(s, 'golden_egg', 1);
  const r = actOk(s, 'fairEnter', { item: 'bread', qty: 3 }, { now: MONDAY + HOUR });
  assert.equal(evs(r, 'fairEntered')[0].p10, 30);
  actOk(s, 'fairEnter', { item: 'golden_egg', qty: 1 }, { now: MONDAY + HOUR, pid: 'p2' });
  assert.equal(s.farm.fair.cur.p, 96);
  assert.deepEqual(s.farm.fair.cur.by, { p1: 30, p2: 66 });
  assert.equal(s.farm.inventory.bread, 9, 'entries are consumed (a goods sink)');
  assert.ok(enterable(s, MONDAY + HOUR).some((x) => x.item === 'bread' && x.left === 7));
  valid(s);
});

test('entry spam: at most 10 of one item a week, the same total whether entered at once or one by one', () => {
  const a = fairFarm();
  const b = fairFarm();
  for (const s of [a, b]) give(s, 'bread', 20);
  actOk(a, 'fairEnter', { item: 'bread', qty: 10 }, { now: MONDAY + HOUR });
  for (let i = 0; i < 10; i++) actOk(b, 'fairEnter', { item: 'bread', qty: 1 }, { now: MONDAY + HOUR + i * MIN });
  assert.equal(a.farm.fair.cur.p, b.farm.fair.cur.p, 'no rounding gain from splitting entries');
  for (const s of [a, b]) {
    assert.equal(act(s, 'fairEnter', { item: 'bread', qty: 1 }, { now: MONDAY + 2 * HOUR }).code, 'CAP');
    assert.equal(act(s, 'fairEnter', { item: 'bread', qty: 1 }, { now: MONDAY + 2 * HOUR, pid: 'p2' }).code, 'CAP',
      'the cap is the farm\'s, not per player');
  }
  // next week the cap starts again
  const next = MONDAY + 7 * DAY;
  runDue(a, next);
  assert.equal(a.farm.fair.cur.w, weekOf(a, next));
  actOk(a, 'fairEnter', { item: 'bread', qty: 10 }, { now: next + HOUR });
  valid(a);
});

test('entries need the goods, ask before using kept goods, and wait while the Fair is closed', () => {
  const s = fairFarm();
  assert.equal(act(s, 'fairEnter', { item: 'bread', qty: 1 }, { now: MONDAY + HOUR }).code, 'NO_ITEMS');
  give(s, 'bread', 2);
  s.farm.keep.bread = { n: 2, by: 'p2' };
  assert.equal(act(s, 'fairEnter', { item: 'bread', qty: 1 }, { now: MONDAY + HOUR }).code, 'RESERVED');
  actOk(s, 'fairEnter', { item: 'bread', qty: 1, confirm: ['RESERVED'] }, { now: MONDAY + HOUR });
  const close = fairCloseAt(s, s.farm.fair.cur.w);
  assert.equal(act(s, 'fairEnter', { item: 'bread', qty: 1, confirm: ['RESERVED'] }, { now: close }).code,
    'NOT_READY', 'Sunday 20:00: the judges are judging');
  assert.equal(act(s, 'fairEnter', { item: 'nope', qty: 1 }, { now: MONDAY + HOUR }).code, 'BAD_ARGS');
});

test('blue-ribbon harvests add points (plot gross / 100, fruit 3 + V / 100) only while the Fair is open', () => {
  const s = fairFarm();
  credit(s, [{ e: 'harvested', id: 'x', crop: 'pumpkin', qty: 2, planter: 'p1', xp: 0, fresh: false, ribbon: true }],
    { now: MONDAY + HOUR });
  assert.equal(s.farm.fair.cur.p, Math.floor((2 * 445 * 10 + 50) / 100));   // 8.9 points
  credit(s, [{ e: 'picked', id: 'y', tree: 'apple_tree', item: 'apple', qty: 5, xp: 0, ribbon: true }],
    { now: MONDAY + HOUR, pid: 'p2' });
  assert.equal(s.farm.fair.cur.by.p2, prizedFruitPoints10(s, 'apple'));
  assert.equal(prizedFruitPoints10(s, 'apple'), 30 + Math.floor((itemOf('apple').sell * 10 + 50) / 100));
  const p = s.farm.fair.cur.p;
  const close = fairCloseAt(s, s.farm.fair.cur.w);
  credit(s, [{ e: 'harvested', id: 'x', crop: 'pumpkin', qty: 2, planter: 'p1', xp: 0, fresh: false, ribbon: true }],
    { now: close + MIN });
  assert.equal(s.farm.fair.cur.p, p, 'after the ceremony time a prize counts for no week');
});

test('the Sunday 20:00 ceremony: the medal pays 1.5 x its threshold once, queued until each player has seen it', () => {
  const s = fairFarm();
  const W = s.farm.fair.cur.W;
  give(s, 'sweetheart_cake', 10);
  actOk(s, 'fairEnter', { item: 'sweetheart_cake', qty: 4 }, { now: MONDAY + HOUR });   // 4 x 25.8 = 103.2 of W 100
  const medal = medalFor(s.farm.fair.cur.p, W);
  assert.equal(medal.id, 'gold2');
  const close = fairCloseAt(s, s.farm.fair.cur.w);
  assert.equal(nextSystemDueAt(s, MONDAY + 2 * HOUR), Math.min(close, nextSystemDueAt(s, MONDAY + 2 * HOUR)));
  assert.deepEqual(dueSystemActions(s, close - 1).filter((d) => d.type === '_fair'), []);
  const coins = s.farm.wallet.coins;
  const acorns = s.farm.wallet.acorns;
  const earned = s.farm.stats['coins.earned'] ?? 0;
  const r = sys(s, '_fair', {}, close);
  assert.ok(r.ok);
  const ev = evs(r, 'fairCeremony')[0];
  assert.equal(ev.medal, 'gold2');
  assert.ok(RULE_CELEBRATIONS.has('fairCeremony'), 'confirmed-only');
  assert.equal(ev.coins, medalCoins(medal, W));
  assert.equal(ev.coins, Math.floor(W * 100 * 1.5));                      // Gold II = 1.00 x W
  assert.equal(s.farm.wallet.coins, coins + ev.coins);
  // Gold: 4 Acorns; Fair Contender reaches Silver (Gold II is rank 8 >= 7): Bronze 1 + Silver 3 Acorns
  assert.equal(s.farm.wallet.acorns, acorns + 4 + 1 + 3);
  assert.equal(s.farm.ribbons.fair_contender.t, 2);
  assert.equal(s.farm.stats['coins.earned'], earned + ev.coins, 'Fair coins are earnings (GDD §5.4)');
  assert.equal(s.farm.stats.bestMedal, 8);
  assert.equal(s.farm.stats.medalWeeks, 1);
  // ceremony double-claim: a second run, a catch-up, a re-sent seen flag pay nothing more
  assert.equal(sys(s, '_fair', {}, close + MIN).code, 'ALREADY_DONE');
  assert.equal(s.farm.wallet.coins, coins + ev.coins);
  assert.ok(ceremonyUnseen(s, 'p1') && ceremonyUnseen(s, 'p2'));
  actOk(s, 'markSeen', { kind: 'fair', id: String(ev.w) }, { now: close + HOUR });
  assert.equal(act(s, 'markSeen', { kind: 'fair', id: String(ev.w) }, { now: close + HOUR }).code, 'ALREADY_DONE');
  assert.ok(!ceremonyUnseen(s, 'p1') && ceremonyUnseen(s, 'p2'), 'Mia still has her ceremony waiting');
  assert.equal(s.farm.wallet.coins, coins + ev.coins);
  // the ribbons: Fair Contender (Bronze at any medal) and the next week opens Monday 00:00
  assert.ok(s.farm.ribbons.fair_contender?.t >= 1);
  runDue(s, MONDAY + 7 * DAY);
  assert.equal(s.farm.fair.cur.w, ev.w + 1);
  assert.equal(s.farm.fair.cur.p, 0);
  valid(s);
});

test('no medal below Bronze I; a medal-less week pays nothing and is not a Fair Regular week', () => {
  const s = fairFarm();
  give(s, 'bread', 3);
  actOk(s, 'fairEnter', { item: 'bread', qty: 3 }, { now: MONDAY + HOUR });
  const r = sys(s, '_fair', {}, fairCloseAt(s, s.farm.fair.cur.w));
  assert.equal(evs(r, 'fairCeremony')[0].medal, null);
  assert.equal(s.farm.stats.medalWeeks ?? 0, 0);
  assert.equal(s.farm.fair.last.coins, 0);
});

test('catch-up: a server off from Saturday to Wednesday holds ONE ceremony and opens the current week', () => {
  const s = fairFarm();
  give(s, 'sweetheart_cake', 4);
  actOk(s, 'fairEnter', { item: 'sweetheart_cake', qty: 4 }, { now: MONDAY + HOUR });
  const wed = MONDAY + 9 * DAY;
  const ran = runDue(s, wed);
  assert.equal(ran.filter((t) => t === '_fair').length, 1);
  assert.equal(s.farm.fair.last.w, weekOf(s, MONDAY));
  assert.equal(s.farm.fair.cur.w, weekOf(s, wed));
  assert.ok(s.farm.fair.cur.open);
  // weeks nobody played hold no ceremony (nothing was entered, no Fair was open)
  const later = wed + 21 * DAY;
  runDue(s, later);
  assert.equal(s.farm.fair.last.w, weekOf(s, wed));
  valid(s);
});

test('Silver Lining (G3) completes at a Silver ceremony after the card opened', () => {
  const s = fairFarm(20);
  s.farm.quests.done.g1 = MONDAY;
  s.farm.quests.done.g2 = MONDAY;
  // accept G3 (a play tick lets the side chains open)
  give(s, 'sweetheart_cake', 10);
  actOk(s, 'fairEnter', { item: 'sweetheart_cake', qty: 1 }, { now: MONDAY + HOUR });
  assert.ok(s.farm.quests.active.g3, 'G3 opened in the This week tab');
  const W = s.farm.fair.cur.W;
  const per = entryPoints10(s, 'sweetheart_cake');
  const need = Math.ceil((FAIR.medals.find((m) => m.id === 'silver1').atBp * W * 10) / 10_000);
  actOk(s, 'fairEnter', { item: 'sweetheart_cake', qty: Math.min(9, Math.ceil(need / per)) }, { now: MONDAY + HOUR });
  sys(s, '_fair', {}, fairCloseAt(s, s.farm.fair.cur.w));
  assert.ok(s.farm.quests.done.g3, `G3 done at ${s.farm.fair.last.medal}`);
  assert.ok(fairStanding(s, MONDAY + HOUR) !== null);
  valid(s);
});

test('a Giant felled during the Fair week adds its 25 points', () => {
  const s = fairFarm(20);
  credit(s, [{ e: 'giantFelled', id: 'g', ids: [], crop: 'pumpkin', qty: 54, pair: null }], { now: MONDAY + HOUR });
  assert.equal(s.farm.fair.cur.p, 250);
  assert.equal(s.farm.fair.cur.by.p1, 250);
});

test('RC-14: a farmer away for two Sundays sees both ceremonies, oldest first; markSeen clears one at a time', () => {
  const s = farmAt(14);
  runDue(s, MONDAY);
  const w = s.farm.fair.cur.w;
  runDue(s, MONDAY + 7 * DAY);                      // Sunday 20:00 closed week w, Monday opened w + 1
  actOk(s, 'markSeen', { kind: 'fair', id: String(w) }, { now: MONDAY + 7 * DAY + HOUR });           // p1 saw it
  runDue(s, MONDAY + 14 * DAY);                     // week w + 1 closes
  assert.deepEqual(ceremonyQueue(s, 'p2').map((c) => c.w), [w, w + 1], 'p2 missed both');
  assert.deepEqual(ceremonyQueue(s, 'p1').map((c) => c.w), [w + 1]);
  const t = MONDAY + 14 * DAY + HOUR;
  actOk(s, 'markSeen', { kind: 'fair', id: String(w) }, { pid: 'p2', now: t });
  assert.deepEqual(ceremonyQueue(s, 'p2').map((c) => c.w), [w + 1]);
  assert.equal(ceremonyUnseen(s, 'p2'), true);
  actOk(s, 'markSeen', { kind: 'fair', id: String(w + 1) }, { pid: 'p2', now: t });
  assert.equal(ceremonyUnseen(s, 'p2'), false);
  assert.equal(act(s, 'markSeen', { kind: 'fair', id: String(w + 1) }, { pid: 'p2', now: t }).code, 'ALREADY_DONE');
  valid(s);
});

test('RC-14: a save from before the unseen queue keeps its unseen newest ceremony through the next Sunday', () => {
  const s = farmAt(14);
  runDue(s, MONDAY);
  const w = s.farm.fair.cur.w;
  runDue(s, MONDAY + 7 * DAY);
  delete s.farm.fair.unseen;                        // the old shape: only last.seen
  assert.deepEqual(ceremonyQueue(s, 'p2').map((c) => c.w), [w]);
  runDue(s, MONDAY + 14 * DAY);
  assert.deepEqual(ceremonyQueue(s, 'p2').map((c) => c.w), [w, w + 1]);
  valid(s);
});

test('RC-16: the Show Ribbon scores like any blue-ribbon animal good until the horse show (M2) is live', async () => {
  const { featureOf, isLive } = await import('../shared/content/index.js');
  const s = farmAt(25);
  const base = Math.floor((FAIR.points.prizedAnimalGoodMul * itemOf('show_ribbon').sell * 10
    + Math.floor(FAIR.points.entryDiv / 2)) / FAIR.points.entryDiv);
  const want = isLive(featureOf('horse_show')) ? base * FAIR.points.horseShowMul : base;
  assert.equal(entryPoints10(s, 'show_ribbon'), want);
});
