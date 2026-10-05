// The M2 progression systems of rules-goals (GDD §4.7, §5.9): perks (points, picks in order, the weekly free respec,
// the four XP perks on the owner's own deeds only), rested XP (accrual while away, the cap, personal XP only), Legacy
// levels (the rotating pool, every level paid once, the record) and the Seasonal Ribbon Track (points = farm XP,
// tiers, claims, the season's end with its auto-claim and leftover coins, catch-up, season coats). Exploits: claiming
// twice, a respec loop, rested XP from a reconnect loop, a partner's perk on my numbers.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT, PERKS, SEASONAL_TRACK, LEGACY, RESTED, xpForLevel, levelRow, cropOf, personalLevelFromXp, eHours,
  levelFromXp, BREEDING,
} from '../shared/content/index.js';
import { perkPoints, perkSpent, perkValue, perksView, perkXpBp, respecAt } from '../shared/rules/actions/perks.js';
import { restedFor, personalStep, restedOf } from '../shared/rules/actions/rested.js';
import { legacyReward, legacyLevel, legacyRows, legacyRewardAt } from '../shared/rules/actions/legacy.js';
import {
  trackNeed, trackView, reachedOf, trackReward, currentTrack, seasonCoat,
} from '../shared/rules/actions/track.js';
import { seasonKey, nextSeasonAt } from '../shared/rules/coop.js';
import { niceInt } from '../shared/rules/actions/fair.js';
import { dueSystemActions, nextSystemDueAt } from '../shared/rules/system.js';
import {
  farmAt, put, give, runDue, act, actOk, evs, valid, sys, credit, forceM2Goals, runTwin, T0, HOUR, DAY, MIN,
} from './helpers/rules-goals.js';

before(forceM2Goals);

const harvested = (crop, o = {}) => ({ e: 'harvested', id: 'home.0.0', crop, qty: cropOf(crop).yield, planter: 'p1',
  xp: cropOf(crop).xp, fresh: false, ribbon: false, bonus: 0, star: 0, ...o });
const order = (xp) => ({ e: 'orderFilled', slot: 0, n: 1, coins: 1, xp, acorns: 0, golden: false, giver: null,
  simple: false, value: 1, items: {}, helped: null });

/** A player's personal XP set to the start of personal level L (a fixture). */
const personalAt = (s, pid, L) => { s.players[pid].xp = CONTENT.levels[L - 1].personalXp; };

// ---- perks ---------------------------------------------------------------------------------------------------

test('perk points: 1 per 2 personal levels, at most 20; picks in tree order, priced 1, 1, 2, 2, 3', () => {
  const s = farmAt(14);
  personalAt(s, 'p1', 9);
  assert.equal(perkPoints(s, 'p1'), 4);
  personalAt(s, 'p2', 40);
  assert.equal(perkPoints(s, 'p2'), PERKS.maxPoints);
  actOk(s, 'perkPick', { tree: 'grower' }, { now: T0 });
  actOk(s, 'perkPick', { tree: 'grower' }, { now: T0 });
  actOk(s, 'perkPick', { tree: 'grower' }, { now: T0 });       // 1 + 1 + 2 = 4
  assert.equal(perkSpent(s, 'p1'), 4);
  assert.equal(act(s, 'perkPick', { tree: 'rancher' }, { now: T0 }).code, 'CAP');
  assert.equal(s.players.p1.perks.t.grower, 3);
  assert.equal(perkValue(s, 'p1', 'grower', 'seedBp'), PERKS.trees.grower[1].seedBp);
  assert.equal(perkValue(s, 'p1', 'grower', 'waterBp'), 0, 'the 4th perk is not owned');
  assert.equal(perkValue(s, 'p2', 'grower', 'seedBp'), 0, 'perks are personal');
  const v = perksView(s, 'p1', T0);
  assert.equal(v.free, 0);
  assert.equal(v.trees.find((t) => t.id === 'grower').perks[3].next, true);
  valid(s);
});

test('a tree completes at five perks; two trees fit in 20 points', () => {
  const s = farmAt(14);
  personalAt(s, 'p1', 40);
  for (let i = 0; i < 5; i++) actOk(s, 'perkPick', { tree: 'artisan' }, { now: T0 });
  assert.equal(act(s, 'perkPick', { tree: 'artisan' }, { now: T0 }).code, 'ALREADY_DONE');
  for (let i = 0; i < 5; i++) actOk(s, 'perkPick', { tree: 'orchardist' }, { now: T0 });
  assert.equal(perkSpent(s, 'p1'), 18);
  actOk(s, 'perkPick', { tree: 'grower' }, { now: T0 });
  actOk(s, 'perkPick', { tree: 'grower' }, { now: T0 });
  assert.equal(act(s, 'perkPick', { tree: 'grower' }, { now: T0 }).code, 'CAP');
  assert.equal(perkValue(s, 'p1', 'orchardist', 'heirloomAt'), 45);
});

test('the free respec: once a week; every point comes back; nothing to reset is refused', () => {
  const s = farmAt(14);
  personalAt(s, 'p1', 10);
  assert.equal(act(s, 'perkRespec', {}, { now: T0 }).code, 'ALREADY_DONE');
  actOk(s, 'perkPick', { tree: 'rancher' }, { now: T0 });
  actOk(s, 'perkRespec', {}, { now: T0 + HOUR });
  assert.equal(perkSpent(s, 'p1'), 0);
  assert.equal(respecAt(s, 'p1'), T0 + HOUR + PERKS.respecMs);
  actOk(s, 'perkPick', { tree: 'grower' }, { now: T0 + 2 * HOUR });
  assert.equal(act(s, 'perkRespec', {}, { now: T0 + 3 * HOUR }).code, 'COOLDOWN', 'a respec loop is a week apart');
  actOk(s, 'perkRespec', {}, { now: T0 + HOUR + PERKS.respecMs });
  valid(s);
});

test('perks are locked before their milestone and level', async () => {
  const s = farmAt(11);
  personalAt(s, 'p1', 10);
  assert.equal(act(s, 'perkPick', { tree: 'grower' }, { now: T0 }).code, 'LOCKED');
});

test('the XP perks lift the OWNER\'s own deeds only: +5 % crop XP for the Grower who harvests', () => {
  const s = farmAt(14);
  personalAt(s, 'p1', 10);
  actOk(s, 'perkPick', { tree: 'grower' }, { now: T0 });
  assert.equal(perkXpBp(s, 'p1', 'crop'), 500);
  const crop = cropOf('pumpkin');
  const ev = harvested('pumpkin', { xp: 1000, planter: 'p1' });
  let xp0 = s.farm.xp;
  credit(s, [ev], { pid: 'p1', now: T0 + 5 * MIN });
  assert.equal(s.farm.xp - xp0, 1050, 'my harvest: +5 %');
  xp0 = s.farm.xp;
  credit(s, [{ ...ev, planter: 'p2' }], { pid: 'p2', now: T0 + 6 * MIN });
  assert.equal(s.farm.xp - xp0, 1000, 'the partner\'s harvest is untouched');
  assert.ok(crop);
});

// ---- rested XP -------------------------------------------------------------------------------------------------

test('rested XP accrues while away (5 % of a level per 8 h), capped at 150 %, and doubles personal XP only', () => {
  const s = farmAt(20);
  personalAt(s, 'p1', 12);
  s.players.p1.joinedAt = T0 - DAY;                          // an old hand (a new player has never been away)
  s.players.p1.lastSeenAt = T0;
  const step = personalStep(s.players.p1.xp);
  const away = 16 * HOUR;
  const want = Math.floor((step * Math.floor((away * (RESTED.bp ?? RESTED.accrueBp)) / RESTED.perMs)) / 10_000);
  const r = credit(s, [order(100)], { pid: 'p1', now: T0 + away });
  const ev = r.events.find((e) => e.e === 'rested');
  assert.equal(ev.xp, want);
  assert.equal(restedFor(s.players.p1.xp, away), want);
  // the order's personal XP (100) came doubled out of the pool; the farm got 100
  assert.equal(restedOf(s, 'p1'), want - 100);
  assert.equal(s.players.p1.rested.at, T0 + away);
  // while online nothing accrues again
  const pool = restedOf(s, 'p1');
  const xp0 = s.farm.xp;
  const pxp0 = s.players.p1.xp;
  credit(s, [order(100)], { pid: 'p1', now: T0 + away + HOUR });
  assert.equal(restedOf(s, 'p1'), pool - 100);
  assert.equal(s.players.p1.xp - pxp0, 200, 'doubled personal XP');
  assert.equal(s.farm.xp - xp0, 100, 'farm XP untouched');
  valid(s);
});

test('rested XP: a brand-new player\'s first action accrues nothing (they have never been away)', () => {
  const s = farmAt(20);
  personalAt(s, 'p1', 12);
  assert.equal(s.players.p1.lastSeenAt, s.players.p1.joinedAt, 'the fixture: joined, never left');
  const r = credit(s, [{ e: 'noted', id: 'n', x: 1, z: 1 }], { pid: 'p1', now: s.players.p1.joinedAt + 3 * HOUR });
  assert.equal(r.events.filter((e) => e.e === 'rested').length, 0, 'three hours online since joining are not an absence');
  assert.equal(restedOf(s, 'p1'), 0);
  // once they leave and come back, the absence counts
  sys(s, '_seen', { pid: 'p1' }, s.players.p1.joinedAt + 4 * HOUR);
  credit(s, [{ e: 'noted', id: 'n', x: 1, z: 1 }], { pid: 'p1', now: s.players.p1.joinedAt + 20 * HOUR });
  assert.ok(restedOf(s, 'p1') > 0, 'a real absence accrues');
  valid(s);
});

test('rested XP: the cap, a long absence, and no farming by reconnect loops', () => {
  const s = farmAt(20);
  personalAt(s, 'p1', 12);
  s.players.p1.joinedAt = T0 - DAY;                          // an old hand (a new player has never been away)
  s.players.p1.lastSeenAt = T0;
  const step = personalStep(s.players.p1.xp);
  credit(s, [{ e: 'noted', id: 'n', x: 1, z: 1 }], { pid: 'p1', now: T0 + 60 * DAY });
  assert.equal(restedOf(s, 'p1'), Math.floor((step * RESTED.capBp) / 10_000), 'two months away: the cap');
  // a reconnect loop: _seen then an action a few seconds later, many times, accrues only the seconds away
  const t = createLoopFarm();
  let now = T0;
  for (let i = 0; i < 50; i++) {
    sys(t, '_seen', { pid: 'p1' }, now);
    now += 5000;
    credit(t, [{ e: 'noted', id: 'n', x: 1, z: 1 }], { pid: 'p1', now });
  }
  assert.ok(restedOf(t, 'p1') <= restedFor(t.players.p1.xp, 50 * 5000) + 50, 'only the time really away');
});

function createLoopFarm() {
  const t = farmAt(20);
  personalAt(t, 'p1', 12);
  t.players.p1.joinedAt = T0 - DAY;
  return t;
}

// ---- Legacy levels ---------------------------------------------------------------------------------------------

test('Legacy levels: L41+ pay the rotating pool once each, in order, and keep a record', () => {
  const s = farmAt(40);
  const a0 = s.farm.wallet.acorns;
  const g0 = s.farm.golden ?? 0;
  const h0 = s.players.p1.hearts;
  assert.deepEqual(legacyRewardAt(40), null);
  assert.deepEqual(legacyReward(1), LEGACY.pool[0]);
  // one order worth five Legacy levels: 41 .. 45
  const r = credit(s, [order(xpForLevel(45) - s.farm.xp)], { pid: 'p1', now: T0 });
  const ups = r.events.filter((e) => e.e === 'levelUp' && e.scope === 'farm');
  assert.deepEqual(ups.map((e) => e.level), [41, 42, 43, 44, 45]);
  assert.deepEqual(ups.map((e) => Object.keys(e.legacy).sort()), [['acorns'], ['goldenSeeds'], ['hearts'], ['acorns'],
    ['decor']]);
  assert.equal(legacyLevel(s), 5);
  assert.deepEqual(legacyRows(s).map((x) => x.L), [41, 42, 43, 44, 45]);
  const rows = levelRow(41).acorns * 5;
  assert.equal(s.farm.wallet.acorns - a0 >= 20 + rows, true);
  assert.equal((s.farm.golden ?? 0) - g0, 5, 'one Golden Seed Packet = 5 golden seeds');
  assert.ok(s.players.p1.hearts - h0 >= 10);
  assert.equal(s.farm.storage.legacy_statue, 1);
  valid(s);
});

// ---- the Seasonal Ribbon Track ---------------------------------------------------------------------------------

test('the track opens at L24 for the season: points = farm XP, a tier = nice(E / 8)', () => {
  const s = farmAt(23);
  runDue(s, T0);
  assert.equal(s.farm.track.s, null);
  s.farm.xp = xpForLevel(24);
  assert.ok(dueSystemActions(s, T0).some((d) => d.type === '_track'));
  runDue(s, T0);
  assert.equal(s.farm.track.s, seasonKey(s, T0));
  assert.equal(s.farm.track.need, niceInt(Math.floor(levelRow(24).E / 8)));
  assert.equal(trackNeed(s, 24), s.farm.track.need);
  const need = s.farm.track.need;
  const r = credit(s, [order(need * 2 + 5)], { pid: 'p1', now: T0 + MIN });
  assert.deepEqual(r.events.filter((e) => e.e === 'trackTier').map((e) => e.tier), [1, 2]);
  assert.equal(s.farm.stats.seasonTiers, 2);
  assert.equal(reachedOf(s.farm.track), 2);
  assert.equal(nextSystemDueAt(s, T0 + MIN) <= nextSeasonAt(s, T0 + MIN), true);
  valid(s);
});

test('trackClaim: a reached tier once, by either farmer; its content reward; not before it is reached', () => {
  const s = farmAt(24);
  runDue(s, T0);
  const need = s.farm.track.need;
  assert.equal(act(s, 'trackClaim', { tier: 1 }, { now: T0 }).code, 'NOT_READY');
  credit(s, [order(need * 10)], { pid: 'p1', now: T0 });
  const a0 = s.farm.wallet.acorns;
  const r = actOk(s, 'trackClaim', { tier: 10 }, { pid: 'p2', now: T0 + MIN });
  assert.deepEqual(trackReward(10), SEASONAL_TRACK.rewards[9]);
  assert.equal(s.farm.wallet.acorns - a0, SEASONAL_TRACK.rewards[9].acorns ?? 0);
  assert.equal(evs(r, 'trackClaimed')[0].tier, 10);
  assert.equal(act(s, 'trackClaim', { tier: 10 }, { now: T0 + MIN }).code, 'ALREADY_DONE');
  assert.equal(act(s, 'trackClaim', { tier: 11 }, { now: T0 + MIN }).code, 'NOT_READY');
  assert.equal(act(s, 'trackClaim', { tier: 31 }, { now: T0 + MIN }).code, 'NOT_READY');
  for (let t = 1; t <= 9; t++) actOk(s, 'trackClaim', { tier: t }, { now: T0 + MIN });
  assert.equal(trackView(s, T0 + MIN).claimable, 0);
  valid(s);
});

test('the season ends: unclaimed tiers are paid, the points left become coins, the new track opens (catch-up safe)', () => {
  const s = farmAt(24);
  runDue(s, T0);
  const tr0 = currentTrack(s, T0);
  const need = tr0.need;
  credit(s, [order(need * 3 + Math.floor(need / 2))], { pid: 'p1', now: T0 });
  actOk(s, 'trackClaim', { tier: 1 }, { now: T0 });
  const end = nextSeasonAt(s, T0);
  const coins0 = s.farm.wallet.coins;
  // the server is off across two season changes: one _track closes the season that was played, opens today's
  const back = nextSeasonAt(s, end + DAY) + 3 * DAY;
  const ran = runDue(s, back);
  assert.equal(ran.filter((t) => t === '_track').length, 1);
  assert.deepEqual(Object.keys(s.farm.track.got), [], 'a fresh season');
  assert.equal(s.farm.track.s, seasonKey(s, back));
  const leftover = Math.floor((eHours(levelFromXp(s.farm.xp), SEASONAL_TRACK.leftoverCoinsHoursBp) * Math.floor(need / 2))
    / need);
  assert.ok(s.farm.wallet.coins - coins0 >= leftover, 'the half tier became coins');
  assert.equal(sys(s, '_track', {}, back + HOUR).code, 'ALREADY_DONE');
  valid(s);
});

test('a tier is never claimed twice across the season change (old claims stay with the old season)', () => {
  const s = farmAt(24);
  runDue(s, T0);
  credit(s, [order(s.farm.track.need)], { pid: 'p1', now: T0 });
  actOk(s, 'trackClaim', { tier: 1 }, { now: T0 });
  const next = nextSeasonAt(s, T0) + HOUR;
  runDue(s, next);
  assert.equal(act(s, 'trackClaim', { tier: 1 }, { now: next }).code, 'NOT_READY', 'the new season starts at 0');
});

test('the season coat goes to the coat chest; coatWear puts it on an animal; the previous one comes back', () => {
  const s = farmAt(28);
  runDue(s, T0);
  const coatTier = SEASONAL_TRACK.rewards.findIndex((r) => r.coat === 'season') + 1;
  assert.ok(coatTier > 0);
  credit(s, [order(s.farm.track.need * coatTier)], { pid: 'p1', now: T0 });
  actOk(s, 'trackClaim', { tier: coatTier }, { now: T0 });
  const coat = seasonCoat('autumn');
  assert.deepEqual(s.farm.track.coats, [coat]);
  const pen = put(s, 'cow_barn');
  const cow = put(s, 'cow', { home: pen });
  assert.equal(act(s, 'coatWear', { id: cow, coat: 'frost' }, { now: T0 }).code, 'NO_ITEMS');
  assert.equal(act(s, 'coatWear', { id: 'nope.0.0', coat }, { now: T0 }).code, 'NOT_FOUND');
  actOk(s, 'coatWear', { id: cow, coat }, { now: T0 });
  assert.equal(s.farm.objects[cow].coat, coat);
  assert.deepEqual(s.farm.track.coats, []);
  assert.ok(BREEDING.seasonCoats.some((c) => c.id === coat));
  valid(s);
});

test('the track decides the same on a key-reversed twin', () => {
  const s = farmAt(24);
  runDue(s, T0);
  credit(s, [order(s.farm.track.need * 5)], { pid: 'p1', now: T0 });
  runTwin(s, 'trackClaim', { tier: 3 }, { now: T0 + MIN, pid: 'p2' });
  runTwin(s, '_track', {}, { pid: 'sys', cid: 'sys', now: nextSeasonAt(s, T0) + MIN });
});

test('the M1b build: no track, no perks, no rested XP, no Legacy pool (the M2 systems are inert until the flip)',
  async () => {
    const { forceLiveForTests } = await import('../shared/rules/coop.js');
    const C = await import('../shared/content/index.js');
    if (C.MILESTONE === 'M2') return;
    forceLiveForTests([C.SEASONAL_TRACK, C.PERKS, C.RESTED, C.LEGACY], false);
    try {
      const s = farmAt(30);
      assert.deepEqual(runDue(s, T0).filter((t) => t === '_track'), []);
      personalAt(s, 'p1', 20);
      assert.equal(act(s, 'perkPick', { tree: 'grower' }, { now: T0 }).code, 'LOCKED');
      s.players.p1.joinedAt = T0 - DAY;                          // an old hand (a new player has never been away)
  s.players.p1.lastSeenAt = T0;
      credit(s, [order(10)], { pid: 'p1', now: T0 + 2 * DAY });
      assert.equal(restedOf(s, 'p1'), 0);
      assert.equal(legacyRewardAt(41), null);
    } finally {
      forceLiveForTests([C.SEASONAL_TRACK, C.PERKS, C.RESTED, C.LEGACY], true);
    }
  });
