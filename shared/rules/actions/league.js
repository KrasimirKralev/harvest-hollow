// The County Fair's NPC league and Platinum (GDD §5.6, M2; content: shared/content/weekly.js FAIR.league and the
// Platinum medal). Owned by rules-goals.
//
// Five NPC farms (FAIR.league.farms) score W x (0.6 + step x (league - 1) + 0.7 x hash01(farmSeed, week, npc)) points a
// week, where W is the week's Fair target and step = FAIR.league.npcStepBp (content, wave 3: without it every league
// held the same farms and the ladder meant nothing). The couple always competes TOGETHER against them (their Fair points of the week), never against
// each other. Five leagues: after the Sunday ceremony the top 2 of the six farms move up a league, the last one moves
// down; every league week pays tier x 1 Acorn. The top league (5) opens with the Town Fair Grounds (Restoration
// project 5, reward `topLeague`); until then a top-2 finish in league 4 stays in league 4.
// Anti-frustration (GDD §6.3 "the partner is away for a week: nothing decays"): a week in which the farm scored no
// Fair point at all holds its league and pays nothing (an empty week never demotes).
//
// farm.league = { tier, best, w, hist: [Result] }   tier 1..5 (League 1 is the first), best = the highest ever,
//               w = the last week rolled (-1 none), hist = the newest LEAGUE_HIST results, oldest first
// fair.cur.lg = the league tier the week is played in (stamped when the week opens, or on the level-up into the
//               league mid-week); a week without it is no league week
// Result = { w, tier, rank (1..6), p (the farm's points x10), W, move (-1 | 0 | 1), acorns, to (the new tier),
//            npc: [p10 x 5] (final NPC scores in FAIR.league.farms order) }
//
// Platinum (1.4 W) plays once the Town Fair Grounds is restored: 6 Acorns, the champion banner (reward decor with
// source 'fair:platinum') and a 24 h Golden Hour from the next Monday 00:00 (farm.coop.platinum = { from, until };
// coop.goldenHourBp reads it), a Memory Book page.
import { FAIR, CONTENT, levelFromXp } from '../../content/index.js';
import { hash32 } from '../rng.js';
import { systemLive } from '../coop.js';
import { projectDone } from '../economy.js';

const BP = 10_000;
const TWO32 = 4_294_967_296;

/** The league's content rule object (FAIR.league, M2). */
export const LEAGUE = FAIR.league;

/** How many results the league history keeps. */
export const LEAGUE_HIST = 8;

/** Fresh league state (createFarm and the backfill of older saves). */
export const initialLeague = () => ({ tier: LEAGUE.start ?? 1, best: LEAGUE.start ?? 1, w: -1, hist: [] });

/** True when the league plays in this build (its milestone) and the farm has its level. */
export const leagueUnlocked = (state) => systemLive(LEAGUE) && systemLive(FAIR)
  && levelFromXp(state.farm.xp) >= Math.max(LEAGUE.unlock, FAIR.unlock);

/**
 * Sum of a numeric reward field over the farm's completed Restoration projects that play in this build (the Town
 * Fair Grounds: `fairEntriesPerItem`, `topLeague`, `fairPlatinum`).
 */
export function doneReward(state, key) {
  let n = 0;
  for (const p of CONTENT.restoration.values()) {
    if (!systemLive(p) || !projectDone(state, p.id)) continue;
    const v = p.reward?.[key];
    if (v === true) n += 1;
    else if (Number.isSafeInteger(v)) n += v;
  }
  return n;
}

/** The highest league the farm may reach now (the top one needs the Town Fair Grounds, Restoration 5). */
export const topTier = (state) => (doneReward(state, 'topLeague') > 0 ? LEAGUE.leagues : LEAGUE.leagues - 1);

/** Ui name: the highest league the farm may reach now. */
export const leagueMax = topTier;

/** The league tier the farm plays in now (1 for a farm that never played one). */
export const leagueTier = (state) => state.farm.league?.tier ?? 1;

/**
 * Final score (points x10) of NPC farm `i` (index into FAIR.league.farms) in week `w` of league `tier` against target
 * W: W x (npcMinBp + npcStepBp x (tier - 1) + npcSpreadBp x hash01) / 10,000, the hash keyed on (farmSeed, 'league',
 * w, i) only (server-ordered replicated facts; nothing a client chooses).
 */
export function npcScore10(state, w, i, W, tier = 1) {
  const h = hash32(state.meta.farmSeed, 'league', w, i);
  const bp = LEAGUE.npcMinBp + (LEAGUE.npcStepBp ?? 0) * (Math.max(1, tier) - 1)
    + Math.floor((LEAGUE.npcSpreadBp * h) / TWO32);
  return Math.floor((W * 10 * bp) / BP);
}

/** Ui name of npcScore10 (the tier defaults to the current week's league). */
export const npcPoints10 = (state, w, i, W, tier = state.farm.fair?.cur?.lg ?? leagueTier(state)) =>
  npcScore10(state, w, i, W, tier);

/** The five NPC finals of a week in league `tier`, in content order. */
export const npcFinals = (state, w, W, tier = 1) => LEAGUE.farms.map((_, i) => npcScore10(state, w, i, W, tier));

/**
 * The farm's rank among the six (1 = best) for points p10 against the NPC finals. A tie goes to the couple (the
 * NPCs are friendly neighbours).
 */
export const rankOf = (p10, npcs) => 1 + npcs.filter((n) => n > p10).length;

/**
 * The league result of a closed week: rank, the move (+1 for the top 2 below the top tier, -1 for the last one above
 * League 1, 0 otherwise or for an empty week) and the Acorns (tier x acornsPerTier; none for an empty week).
 */
export function leagueOutcome(state, cur) {
  const tier = Number.isSafeInteger(cur.lg) ? cur.lg : leagueTier(state);
  const npc = npcFinals(state, cur.w, cur.W, tier);
  const rank = rankOf(cur.p, npc);
  const empty = !(cur.p > 0);
  let move = 0;
  if (!empty && rank <= LEAGUE.promote && tier < topTier(state)) move = 1;
  else if (!empty && rank > npc.length + 1 - LEAGUE.demote && tier > 1) move = -1;
  const acorns = empty ? 0 : tier * LEAGUE.acornsPerTier;
  return { w: cur.w, tier, rank, p: cur.p, W: cur.W, move, acorns, to: tier + move, npc };
}

/**
 * The ceremony's league step (fair.js calls it once per closed week that was a league week): the result is stored,
 * the tier moves, the Acorns are returned for the ceremony to pay. Returns the Result, or null (no league week).
 */
export function leagueClose(tx, ctx, cur) {
  if (!Number.isSafeInteger(cur.lg) || !tx.state.farm.league || !systemLive(LEAGUE)) return null;
  const lg = tx.state.farm.league;
  if (lg.w >= cur.w) return null;                      // a week is rolled once (a replayed or repeated close)
  const r = leagueOutcome(tx.state, cur);
  tx.set(['farm', 'league'], { tier: r.to, best: Math.max(lg.best, r.to), w: cur.w,
    hist: [...lg.hist, r].slice(-LEAGUE_HIST) });
  return r;
}

/** Past league weeks, newest last, each with `p10` (the farm's points x10) for the panels. */
export const leagueHistory = (state) => (state.farm.league?.hist ?? []).map((r) => ({ ...r, p10: r.p }));

/** True when Platinum can be won on this farm (the medal plays and the Town Fair Grounds is restored). */
export const platinumOpen = (state) => {
  const m = FAIR.medals.find((x) => x.id === 'platinum');
  return Boolean(m) && systemLive(m) && (!m.needsProject || projectDone(state, m.needsProject));
};

/** The tier to stamp on a week that opens now (null when the league does not play yet). */
export const weekTier = (state) => (leagueUnlocked(state) && state.farm.league ? leagueTier(state) : null);

/**
 * The league table of the current week for the UI: the five NPC farms and the couple, best first. An NPC's score
 * grows through the week in step with the clock (its final at the ceremony), so the table moves while the couple
 * plays. `zone`: 'up' for the promotion places, 'down' for the last place.
 * @returns {null | { tier, best, top, w, open, rows: [{ name, p10, farm: boolean, zone }], promote, demote,
 *   acorns, last: Result | null }}
 */
export function leagueTable(state, now, openAt, closeAt) {
  const lg = state.farm.league;
  if (!lg || !leagueUnlocked(state)) return null;
  const cur = state.farm.fair?.cur;
  const last = lg.hist.at(-1) ?? null;
  const tier = lg.tier;
  const top = topTier(state);
  if (!cur || !Number.isSafeInteger(cur.lg)) {
    return { tier, best: lg.best, top, w: cur?.w ?? -1, open: false, rows: [], promote: LEAGUE.promote,
      demote: LEAGUE.demote, acorns: tier * LEAGUE.acornsPerTier, last };
  }
  const span = Math.max(1, closeAt - openAt);
  const t = Math.min(span, Math.max(0, now - openAt));
  const rows = LEAGUE.farms.map((name, i) => {
    const fin = npcScore10(state, cur.w, i, cur.W, cur.lg);
    return { name, p10: cur.open ? Math.floor((fin * t) / span) : fin, farm: false };
  });
  rows.push({ name: null, p10: cur.p, farm: true });
  // best first; the couple ahead of an NPC on a tie; NPCs in content order on a tie
  rows.sort((a, b) => b.p10 - a.p10 || (a.farm ? -1 : b.farm ? 1 : LEAGUE.farms.indexOf(a.name)
    - LEAGUE.farms.indexOf(b.name)));
  rows.forEach((r, i) => {
    r.zone = i < LEAGUE.promote && cur.lg < top ? 'up' : i >= rows.length - LEAGUE.demote && cur.lg > 1 ? 'down'
      : null;
  });
  return { tier: cur.lg, best: lg.best, top, w: cur.w, open: Boolean(cur.open), rows, promote: LEAGUE.promote,
    demote: LEAGUE.demote, acorns: cur.lg * LEAGUE.acornsPerTier, last };
}
