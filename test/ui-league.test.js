// ui-league lane (wave 3, M2): the readers behind the County League and Platinum, the horse show, the Seasonal Ribbon
// Track, perks and rested XP, Legacy levels and the Friendly Duel, and the "Progress" hub that links them. Every number
// a panel previews is checked against what the REAL rules then do (the ceremony's league step, a medal, a claim, a
// perk, a duel's end), so the UI can never promise something else. The M2 systems are switched on with the goals
// lane's test switch (forceM2Goals), so these tests pass before and after the M2 milestone flip.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT, FAIR, PERKS, SEASONAL_TRACK, DUEL, eHours, levelFromXp, xpForLevel, featureOf } from '../shared/content/index.js';
import { forceLiveForTests, weekOf } from '../shared/rules/coop.js';
import { makeCtx } from '../shared/rules/index.js';
import { Tx } from '../shared/rules/tx.js';
import * as FR from '../shared/rules/actions/fair.js';
import * as LG from '../shared/rules/actions/league.js';
import * as PK from '../shared/rules/actions/perks.js';
import * as TR from '../shared/rules/actions/track.js';
import * as LE from '../shared/rules/actions/legacy.js';
import { farmAt, put, give, runDue, act, actOk, evs, valid, forceM2Goals, MONDAY, HOUR, DAY, MIN } from './helpers/rules-goals.js';
import * as R from '../public/js/ui/panels/league-rules.js';
import { hubView, hubBadge, hubSig, rewardParts, rewardText } from '../public/js/ui/panels/league-kit.js';
import { leagueView, leagueResult, pembertonLine, hubOwner, HUB_DOCK } from '../public/js/ui/panels/league.js';
import { horseShowView } from '../public/js/ui/panels/horseshow.js';
import { seasonTrackView, animalsOf } from '../public/js/ui/panels/season-track.js';
import { perksView } from '../public/js/ui/panels/perks.js';
import { legacyView } from '../public/js/ui/panels/legacy.js';
import { duelView, duelChipView, resultLine, leftWords } from '../public/js/ui/panels/duel.js';

const CLOSE = MONDAY + 6 * DAY + 10 * HOUR;          // Sunday 20:00 local of MONDAY's week (Europe/Sofia)
const noJunk = (t) => assert.ok(typeof t === 'string' && t.length > 0 && !/undefined|null|NaN|\[object/.test(t), `bad text: ${t}`);

before(async () => {
  await forceM2Goals();
  // features the goals switch leaves to the lanes that read them
  forceLiveForTests(['friendly_duel', 'rested_xp'].map((id) => featureOf(id)).filter(Boolean));
});

/** An L30 farm on MONDAY with this week's Fair (a league week) opened by the real scheduler. */
function leagueFarm(level = 30, { tier = 1 } = {}) {
  const s = farmAt(level);
  if (tier > 1) s.farm.league.tier = tier;
  runDue(s, MONDAY);
  assert.equal(s.farm.fair.cur.lg, tier, 'the week is a league week in the tier the farm plays');
  return s;
}

// ---- the hub ------------------------------------------------------------------------------------------------------

test('hub: nothing before its levels, then each system as the farm reaches it; one dock button rides on the first', () => {
  const low = farmAt(10);
  assert.ok(hubView(low, 'p1', MONDAY).every((e) => !e.open), 'nothing opens at level 10');
  assert.equal(hubOwner(low, 'p1', MONDAY), null, 'no dock button before anything opens');
  assert.equal(hubBadge(low, 'p1', MONDAY), null);
  const s = leagueFarm(30);
  const v = Object.fromEntries(hubView(s, 'p1', MONDAY).map((e) => [e.name, e]));
  assert.deepEqual(['seasonTrack', 'league', 'horseShow', 'perks', 'duel'].filter((n) => v[n].open),
    ['seasonTrack', 'league', 'horseShow', 'perks', 'duel'], 'L30 with two farmers opens everything but Legacy');
  assert.equal(v.legacy.open, false);
  assert.equal(v.legacy.build, true, 'Legacy is in the build, so the strip names it as the next goal');
  assert.equal(v.legacy.at, R.MAX_LEVEL);
  assert.equal(hubOwner(s, 'p1', MONDAY), 'seasonTrack', 'the dock button rides on the first open panel');
  assert.equal(HUB_DOCK.mini, true);
  // one farmer: no duel (the rules need two)
  const solo = farmAt(30, { players: ['p1'] });
  assert.equal(Object.fromEntries(hubView(solo, 'p1', MONDAY).map((e) => [e.name, e.open])).duel, false);
});

test('hub badge: unspent perk points count calmly; a duel invitation is a "!" for the invited farmer only', () => {
  const s = leagueFarm(30);
  s.players.p1.xp = CONTENT.levels[19].personalXp;             // personal level 20: 10 points, none spent
  assert.equal(R.perksOf(s, 'p1', MONDAY).free, PK.perkPoints(s, 'p1'));
  assert.equal(hubBadge(s, 'p1', MONDAY), PK.perkPoints(s, 'p1'));
  actOk(s, 'duelInvite', { kind: 'orders' }, { pid: 'p2', now: MONDAY + HOUR });
  const v1 = Object.fromEntries(hubView(s, 'p1', MONDAY + HOUR).map((e) => [e.name, e.badge]));
  const v2 = Object.fromEntries(hubView(s, 'p2', MONDAY + HOUR).map((e) => [e.name, e.badge]));
  assert.equal(v1.duel, '!', 'the invited farmer sees the invitation');
  assert.equal(v2.duel, null, 'the inviter has nothing to answer');
  assert.notEqual(hubSig(s, 'p1', MONDAY + HOUR), hubSig(s, 'p2', MONDAY + HOUR));
});

// ---- the County League --------------------------------------------------------------------------------------------

test('league: the table is the rules\' live table; the couple\'s row, zones and the week\'s acorns', () => {
  const s = leagueFarm(30, { tier: 3 });
  give(s, 'cookies', 6);
  actOk(s, 'fairEnter', { item: 'cookies', qty: 6 }, { pid: 'p2', now: MONDAY + 2 * HOUR });
  const now = MONDAY + 3 * DAY;
  const v = leagueView(s, 'p1', now);
  assert.equal(v.open, true);
  const rules = LG.leagueTable(s, now, FR.fairOpenAt(s, s.farm.fair.cur.w), FR.fairCloseAt(s, s.farm.fair.cur.w));
  assert.deepEqual(v.table.rows.map((r) => [r.us ? null : r.name, r.p10, r.zone]), rules.rows.map((r) => [r.name, r.p10, r.zone]));
  assert.equal(v.table.us.p10, s.farm.fair.cur.p, 'the couple\'s score is the Fair\'s points, together');
  assert.equal(v.tier, 3);
  assert.equal(v.acorns, 3 * FAIR.league.acornsPerTier);
  assert.equal(v.name, FAIR.league.names[2]);
  assert.equal(v.top, FAIR.league.leagues - 1, 'the top league waits for the Town Fair Grounds');
  for (const r of v.table.rows) if (!r.us) { assert.ok(r.npc && r.npc.i >= 0, r.name); noJunk(r.npc.farmer); }
  noJunk(v.line);
  assert.equal(R.leagueOpen(farmAt(FAIR.league.unlock - 1)), false);
});

test('league: "N more points secure a promotion place" is exactly the ceremony\'s threshold (one point less is not)', () => {
  const s = leagueFarm(30, { tier: 2 });
  const v = leagueView(s, 'p1', MONDAY + HOUR);
  const need = v.table.upTo10;
  assert.ok(need > 0);
  assert.equal(need, [...LG.npcFinals(s, s.farm.fair.cur.w, s.farm.fair.cur.W, 2)].sort((a, b) => b - a)[1], 'the second-best NPC final');
  const short = structuredClone(s);
  s.farm.fair.cur.p = need;
  short.farm.fair.cur.p = need - 1;
  assert.equal(leagueView(s, 'p1', MONDAY + HOUR).table.secured, true, 'reaching it reads as secured');
  assert.equal(leagueView(s, 'p1', MONDAY + HOUR).table.upTo10, 0);
  runDue(s, CLOSE + MIN);
  runDue(short, CLOSE + MIN);
  const a = s.farm.league.hist.at(-1);
  const b = short.farm.league.hist.at(-1);
  assert.ok(a.rank <= FAIR.league.promote, `rank ${a.rank}`);
  assert.equal(a.move, 1, 'promoted');
  assert.equal(s.farm.league.tier, 3);
  assert.equal(b.rank, FAIR.league.promote + 1, 'one point less finishes third');
  assert.equal(b.move, 0);
  const r = leagueResult(s);
  assert.deepEqual([r.from, r.to, r.move, r.rank, r.acorns], [2, 3, 1, a.rank, a.acorns]);
  assert.equal(r.acorns, 2 * FAIR.league.acornsPerTier, 'the week pays the tier it was played in');
  valid(s);
});

test('league: "N more points keep you off the bottom" is exactly the drop threshold', () => {
  const s = leagueFarm(30, { tier: 3 });
  const v = leagueView(s, 'p1', MONDAY + HOUR);
  const finals = LG.npcFinals(s, s.farm.fair.cur.w, s.farm.fair.cur.W, 3);
  assert.equal(v.table.safe10, Math.min(...finals));
  const low = structuredClone(s);
  s.farm.fair.cur.p = v.table.safe10;
  low.farm.fair.cur.p = v.table.safe10 - 1;
  runDue(s, CLOSE + MIN);
  runDue(low, CLOSE + MIN);
  assert.equal(s.farm.league.hist.at(-1).move, 0, 'safe');
  assert.equal(low.farm.league.hist.at(-1).move, -1, 'one point less: last place, down a league');
  assert.equal(leagueResult(low).to, 2);
  noJunk(pembertonLine(leagueView(low, 'p1', MONDAY + HOUR).table ?? { open: false }, null));
});

test('league: an empty week holds the league and pays nothing; the card says so', () => {
  const s = leagueFarm(30, { tier: 2 });
  runDue(s, CLOSE + MIN);
  const r = leagueResult(s);
  assert.equal(r.empty, true);
  assert.equal(r.move, 0);
  assert.equal(r.acorns, 0);
  assert.equal(s.farm.league.tier, 2);
  const h = leagueView(s, 'p1', CLOSE + 2 * MIN).history;
  assert.equal(h[0].w, r.w, 'history newest first');
});

// ---- Platinum ----------------------------------------------------------------------------------------------------

test('platinum: waits for the Town Fair Grounds; then its threshold and pay are the ceremony\'s', () => {
  const s = leagueFarm(30);
  assert.equal(R.platinumOf(s, MONDAY + HOUR).open, false);
  s.farm.restore = { ...(s.farm.restore ?? {}), fair_grounds: { ...(s.farm.restore?.fair_grounds ?? {}), done: MONDAY - DAY } };
  const p = R.platinumOf(s, MONDAY + HOUR);
  assert.equal(p.open, true);
  assert.equal(p.need10, FR.medalNeed10(R.PLATINUM, s.farm.fair.cur.W));
  assert.equal(p.coins, FR.medalCoins(R.PLATINUM, s.farm.fair.cur.W));
  assert.equal(p.toGo10, p.need10);
  s.farm.fair.cur.p = p.need10;
  assert.equal(R.platinumOf(s, MONDAY + HOUR).got, true);
  runDue(s, CLOSE + MIN);
  assert.equal(s.farm.fair.last.medal, 'platinum', 'the ceremony agrees');
  assert.equal(s.farm.fair.last.coins, p.coins);
  const buff = R.platinumOf(s, CLOSE + 2 * MIN).buff;
  assert.ok(buff && buff.from >= CLOSE, 'the 24-hour Golden Hour waits for Monday');
  assert.equal(buff.until - buff.from, R.PLATINUM.goldenHourMs);
});

// ---- the horse show ------------------------------------------------------------------------------------------------

test('horse show: a Show Ribbon\'s preview is what the entry scores (double), the cap is the Fair\'s, horses by ribbon', () => {
  const s = leagueFarm(30);
  const stable = put(s, 'stable');
  const a = put(s, 'horse', { home: stable, cycle: 23 });
  put(s, 'horse', { home: stable, cycle: 7 });
  s.farm.names[a] = { name: 'Clover', by: 'p1', at: MONDAY };
  give(s, 'show_ribbon', 3);
  const v = horseShowView(s, 'p1', MONDAY + HOUR);
  assert.equal(v.open, true);
  assert.equal(v.show.each, FR.entryPoints10(s, 'show_ribbon'));
  assert.equal(v.show.mul, FAIR.points.horseShowMul);
  assert.equal(v.show.cap, FR.entryLimit(s));
  assert.deepEqual(v.horses.map((x) => [x.name, x.prized]), [['Clover', true], [null, false]]);
  assert.equal(v.prized, 1);
  const before0 = s.farm.fair.cur.p;
  const r = actOk(s, R.actFor('showEnter'), R.ARGS.showEnter('show_ribbon', 2), { pid: 'p2', now: MONDAY + 2 * HOUR });
  assert.equal(s.farm.fair.cur.p - before0, 2 * v.show.each);
  assert.equal(evs(r, 'fairEntered')[0].p10, 2 * v.show.each);
  const after = horseShowView(s, 'p1', MONDAY + 2 * HOUR);
  assert.equal(after.show.entered, 2);
  assert.equal(after.show.left, after.show.cap - 2);
  assert.equal(after.total10, 2 * v.show.each);
  noJunk(after.line);
});

// ---- the Seasonal Ribbon Track -----------------------------------------------------------------------------------

test('track: the season\'s view is the rules\'; a claim pays exactly the previewed prize', () => {
  const s = farmAt(30);
  runDue(s, MONDAY);
  const v0 = seasonTrackView(s, 'p1', MONDAY);
  assert.equal(v0.open, true);
  assert.equal(v0.need, TR.trackNeed(s, levelFromXp(s.farm.xp)));
  assert.equal(v0.name, 'Autumn');
  assert.ok(v0.start < MONDAY && v0.end > MONDAY);
  assert.equal(v0.tiers.length, SEASONAL_TRACK.tiers);
  assert.ok(v0.tiers.filter((x) => x.milestone).map((x) => x.n).includes(SEASONAL_TRACK.tiers));
  s.farm.track.xp = v0.need * 4 + 7;
  const v = seasonTrackView(s, 'p1', MONDAY + HOUR);
  assert.equal(v.tier, 4);
  assert.equal(v.claimable, 4);
  assert.equal(v.toNext, v.need - 7);
  const coinTier = v.tiers.find((x) => x.claimable && x.reward.coinsHoursBp);
  assert.ok(coinTier, 'one of the first tiers pays coins');
  const preview = rewardParts(coinTier.reward, { level: levelFromXp(s.farm.xp), season: v.season }).find((p) => p.kind === 'coins');
  const r = actOk(s, R.actFor('trackClaim'), R.ARGS.trackClaim(coinTier.n), { pid: 'p2', now: MONDAY + HOUR });
  const paid = evs(r, 'trackClaimed')[0].reward.coins;
  assert.equal(paid, eHours(levelFromXp(s.farm.xp), coinTier.reward.coinsHoursBp));
  assert.ok(preview.text.includes(paid >= 10_000 ? String(Math.floor(paid / 1000)) : String(paid)), `${preview.text} vs ${paid}`);
  const v2 = seasonTrackView(s, 'p1', MONDAY + HOUR);
  assert.equal(v2.tiers[coinTier.n - 1].got.by, 'p2');
  assert.equal(v2.claimable, 3);
  assert.equal(act(s, 'trackClaim', { tier: 5 }, { now: MONDAY + HOUR }).code, 'NOT_READY', 'a tier not reached is refused');
  for (const t of v.tiers) noJunk(rewardText(t.reward, { level: 30, season: v.season }));
  valid(s);
});

test('track: the season coat is offered to an animal the farm owns, and the rules put it on', () => {
  const s = farmAt(30);
  runDue(s, MONDAY);
  const coop = put(s, 'coop');
  const hen = put(s, 'chicken', { home: coop });
  s.farm.track.coats = ['russet'];
  const v = seasonTrackView(s, 'p1', MONDAY);
  assert.deepEqual(v.coats, ['russet']);
  assert.deepEqual(animalsOf(s).map((a) => a.id), [hen]);
  actOk(s, 'coatWear', { id: hen, coat: 'russet' }, { now: MONDAY });
  assert.equal(s.farm.objects[hen].coat, 'russet');
  assert.deepEqual(seasonTrackView(s, 'p1', MONDAY).coats, []);
});

// ---- perks and rested XP ------------------------------------------------------------------------------------------

test('perks: points and trees are the rules\'; the Learn button\'s args pass the check and learn the next perk', () => {
  const s = farmAt(30);
  s.players.p1.xp = CONTENT.levels[13].personalXp;          // personal level 14: 7 points
  const v = perksView(s, 'p1', MONDAY);
  assert.equal(v.open, true);
  assert.equal(v.points, PK.perkPoints(s, 'p1'));
  assert.equal(v.points, 7);
  assert.equal(v.free, 7);
  assert.equal(v.nextPoint, 16);
  assert.equal(v.trees.length, 4);
  for (const t of v.trees) for (const p of t.perks) { noJunk(p.text); noJunk(p.name); }
  // learn the Grower tree to its 4th perk (1 + 1 + 2 + 2 = 6 points), then the 5th (3) is not affordable
  for (let i = 0; i < 4; i++) {
    const next = perksView(s, 'p1', MONDAY).trees.find((t) => t.id === 'grower').perks.find((p) => p.next);
    assert.equal(next.i, i);
    assert.equal(next.afford, true);
    actOk(s, R.actFor('perkPick'), R.ARGS.perkPick('grower'), { now: MONDAY });
  }
  const after = perksView(s, 'p1', MONDAY);
  const g = after.trees.find((t) => t.id === 'grower');
  assert.equal(g.owned, 4);
  assert.equal(after.free, 1);
  assert.equal(g.perks[4].afford, false);
  assert.equal(act(s, 'perkPick', R.ARGS.perkPick('grower'), { now: MONDAY }).code, 'CAP', 'the rules agree: not enough points');
  assert.equal(after.partner.pid, 'p2');
  assert.equal(after.partner.spent, 0, 'perks are personal: the partner\'s trees are untouched');
  // a free respec, then not again within the week
  assert.equal(after.respecFree, true);
  actOk(s, R.actFor('perkRespec'), R.ARGS.perkRespec(), { now: MONDAY + HOUR });
  const r = perksView(s, 'p1', MONDAY + 2 * HOUR);
  assert.equal(r.free, 7);
  assert.equal(r.respecFree, false);
  assert.equal(r.respecAt, MONDAY + HOUR + PERKS.respecMs);
  valid(s);
});

test('rested XP: the pool and its cap are the rules\' (150 % of a personal level)', () => {
  const s = farmAt(30);
  s.players.p2.xp = CONTENT.levels[19].personalXp;
  s.players.p2.rested = { xp: 1234, at: MONDAY };
  const r = R.restedOf(s, 'p2');
  const step = CONTENT.levels[20].personalXp - CONTENT.levels[19].personalXp;
  assert.equal(r.live, true);
  assert.equal(r.xp, 1234);
  assert.equal(r.cap, Math.floor((step * 15_000) / 10_000));
  s.players.p2.rested.xp = r.cap + 50;
  assert.equal(R.restedOf(s, 'p2').xp, r.cap, 'never shown above its cap');
  assert.equal(R.restedOf(s, 'p1').xp, 0);
});

// ---- Legacy levels -----------------------------------------------------------------------------------------------

test('legacy: levels past 40, the XP to the next and the rewards ahead are the rules\'', () => {
  const s = farmAt(42);
  s.farm.xp += 1000;
  const v = legacyView(s);
  assert.equal(v.open, true);
  assert.equal(v.n, LE.legacyLevel(s));
  assert.equal(v.n, 2);
  assert.equal(v.into + v.toNext, v.step, 'the bar adds up');
  assert.equal(v.into, 1000);
  assert.equal(v.step, xpForLevel(R.MAX_LEVEL + 1) - xpForLevel(R.MAX_LEVEL));
  assert.deepEqual(v.next.map((x) => x.L), [43, 44, 45, 46, 47]);
  assert.deepEqual(v.next.map((x) => x.reward), [3, 4, 5, 6, 7].map((n) => LE.legacyReward(n)));
  for (const x of v.next) noJunk(rewardText(x.reward, { level: 42 }));
  // a paid reward shows newest first
  const tx = new Tx(s);
  LE.legacyRecord(tx, makeCtx(s, { now: MONDAY, pid: 'p1', cid: 'x', seq: 1 }), 42, { goldenSeeds: 1 });
  assert.equal(legacyView(s).rows[0].L, 42);
  const before40 = legacyView(farmAt(33));
  assert.equal(before40.open, false);
  assert.equal(before40.toLegacy, xpForLevel(LE.legacyFrom()) - farmAt(33).farm.xp);
});

// ---- the Friendly Duel --------------------------------------------------------------------------------------------

test('duel: invite and answer on both screens, the live score and its chip, the end and the result line', () => {
  const s = farmAt(30);
  actOk(s, R.actFor('duelInvite'), R.ARGS.duelInvite('pies'), { pid: 'p2', now: MONDAY });
  assert.equal(duelView(s, 'p2', MONDAY).phase, 'asked');
  const inv = duelView(s, 'p1', MONDAY);
  assert.equal(inv.phase, 'invited');
  assert.equal(inv.kind.id, 'pies');
  assert.equal(inv.theirName, s.players.p2.name);
  assert.deepEqual(duelChipView(s, 'p1', MONDAY), { mode: 'invite', kind: inv.kind, from: s.players.p2.name });
  assert.equal(duelChipView(s, 'p2', MONDAY), null, 'the inviter sees no invitation chip');
  actOk(s, R.actFor('duelAccept'), R.ARGS.duelAccept(), { pid: 'p1', now: MONDAY + HOUR });
  s.farm.duel.cur.s = { p1: 4, p2: 6 };
  const live = duelView(s, 'p1', MONDAY + 2 * HOUR);
  assert.equal(live.phase, 'live');
  assert.equal(live.lead, 'them');
  assert.equal(live.mineText, '4');
  const chip = duelChipView(s, 'p2', MONDAY + 2 * HOUR);
  assert.deepEqual([chip.mode, chip.mine, chip.theirs, chip.lead], ['live', '6', '4', 'me'], 'both screens, each from its own side');
  noJunk(leftWords(chip.left));
  runDue(s, CLOSE + MIN);
  const end = duelView(s, 'p1', CLOSE + 2 * MIN);
  assert.equal(end.phase, 'none');
  assert.equal(end.last.win, 'p2');
  assert.equal(end.unseen, true);
  assert.deepEqual(end.crown, ['p2']);
  assert.equal(resultLine(end), `${s.players.p2.name} won the ${end.last.kind.name}, 6 to 4`);
  const seen = R.ARGS.duelSeen(end.last.end);
  actOk(s, 'markSeen', seen, { pid: 'p1', now: CLOSE + 3 * MIN });
  assert.equal(duelView(s, 'p1', CLOSE + 3 * MIN).unseen, false);
  assert.equal(duelView(s, 'p2', CLOSE + 3 * MIN).unseen, true, 'seen flags are per farmer');
  valid(s);
});

test('duel: an order rush counts quarters; a tie crowns both; a kind opens at its level', () => {
  assert.equal(R.duelScoreText(9, 4), '2¼');
  assert.equal(R.duelScoreText(2, 4), '½');
  assert.equal(R.duelScoreText(8, 4), '2');
  assert.equal(R.duelScoreText(7, 1), '7');
  const s = farmAt(30);
  actOk(s, 'duelInvite', { kind: 'orders' }, { pid: 'p1', now: MONDAY });
  actOk(s, 'duelAccept', {}, { pid: 'p2', now: MONDAY + MIN });
  s.farm.duel.cur.s = { p1: 10, p2: 10 };
  assert.equal(duelView(s, 'p1', MONDAY + HOUR).mineText, '2½');
  runDue(s, CLOSE + MIN);
  const v = duelView(s, 'p1', CLOSE + MIN);
  assert.equal(v.last.tie, true);
  assert.deepEqual([...v.crown].sort(), ['p1', 'p2']);
  noJunk(resultLine(v));
  const kinds = duelView(farmAt(10), 'p1', MONDAY).kinds;
  for (const k of DUEL.kinds) assert.equal(kinds.find((x) => x.id === k.id).open, 10 >= (k.unlock ?? 1));
});

test('adapter: every rules helper the panels read exists (a rename in the rules fails here, not in the browser)', () => {
  for (const [mod, names] of [[LG, ['leagueUnlocked', 'leagueTable', 'npcFinals', 'topTier', 'platinumOpen']],
    [PK, ['perksView', 'perksLive', 'perkPoints']], [TR, ['trackView', 'trackUnlocked', 'trackNeed']],
    [LE, ['legacyLive', 'legacyLevel', 'legacyReward', 'legacyRows', 'legacyRecord']]]) {
    for (const n of names) assert.equal(typeof mod[n], 'function', n);
  }
  for (const key of Object.keys(R.ACT)) {
    if (key === 'showEnter') continue;            // horseShowEnter or fairEnter: either is fine
    assert.equal(R.canAct(key), true, `${key}: no action named ${R.ACT[key].join(' / ')}`);
  }
  assert.equal(weekOf(farmAt(1), MONDAY), weekOf(farmAt(1), MONDAY + 6 * DAY), 'MONDAY..Sunday is one Fair week');
});
