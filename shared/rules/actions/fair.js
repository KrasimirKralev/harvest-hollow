// The County Fair (GDD §5.6; content: shared/content/weekly.js FAIR). Owned by rules-goals. The NPC league and the
// Platinum tier (M2) live in actions/league.js; the ceremony here runs the league step once per closed week.
//
// Week: Monday 00:00 -> Sunday 20:00 in the farm's zone; the results ceremony is Sunday 20:00 (`_fair`), shown on
// both screens and queued for a partner who is away (the ceremony record keeps who has seen it).
//
// farm.fair = {
//   cur:  null | { w, W, L, p, by: { pid: p }, ent: { [item]: n }, open, lg? }   this week's Fair
//           w = the farm week (calendar weekIndex), W = the weekly target in points, frozen when the week opened
//           (Monday's farm level), p = points x 10 (one decimal, stored as an integer), by = each player's share,
//           ent = entries per item this week (at most entryLimit(state)), open = false after the ceremony,
//           lg = the NPC league tier this week is played in (M2, league.js; absent before the league)
//   last: null | Ceremony                                                   the newest ceremony
//   unseen?: { pid: [Ceremony] }   the ceremonies each farmer has not seen yet, oldest first, at most
//                                  FAIR_UNSEEN_MAX (a partner away for two Sundays still sees the first: wave-2 QA
//                                  RC-14); absent in older saves (read as "last, unless last.seen[pid]")
// }
// Ceremony = { w, W, p, medal: medalId | null, rank (0 none, 1 Bronze I ... 10 Platinum), coins, acorns, trophy,
//              at, seen: { pid: 1 }, by, lg?: league Result (league.js), banner?: decor id (Platinum) }
//
// Points (x10, each unit rounded to one decimal on its own, so entering 10 at once equals 10 entries of one):
//   a blue-ribbon crop harvest       plot gross / 100              (progress.js on `harvested` with ribbon)
//   a blue-ribbon fruit              3 + V / 100                   (progress.js on `picked` with ribbon)
//   an entered blue-ribbon animal good   2 x V / 100 (the Show Ribbon x 2 more from the horse show level)
//   an entered T3 / T4 / duet good   V / 100, duet goods x 2, hampers (T4) x 2 from FAIR.points.hamperFrom (once the
//                                    feature hamper_double plays, M2)
//   + the Fair Rosettes set's perk (album.js perkOf 'fairPointsBp')
// Medals are fractions of W (FAIR.medals atBp); a medal pays 1.5 x the value of its threshold
// (atBp x W x pointValue x payBp, earned coins), Silver +2 Acorns, Gold +4 Acorns + a trophy, Platinum (M2, with
// the Town Fair Grounds restored) +6 Acorns, the champion banner and a 24 h Golden Hour from the next Monday.
// A league week (M2) also pays tier x 1 Acorn and moves the league (league.js).
//
//   fairEnter { item, qty }   enter goods at the Fair tent (consumed: a goods sink). LOCKED before the Fair's level,
//                             NOT_READY while the Fair is closed (Sunday 20:00 -> Monday), CAP past the per-item limit
//                             this week (10, +1 with the Town Fair Grounds), RESERVED (soft) below the item's Keep N.
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import {
  FAIR, MEDAL_RANKS, CONTENT, itemOf, cropOf, levelFromXp, levelRow, featureOf, isLive,
} from '../../content/index.js';
import { available, consume, unkept, earn, projectDone } from '../economy.js';
import { sortedKeys } from '../order.js';
import { systemLive, weekOf, dayOf, localAt, weekStartDay, hasPlayer, playerIds } from '../coop.js';
import { payReward, giveObject } from '../progress.js';
import { feedAdd } from '../feed.js';
import { perkOf } from './album.js';
import { leagueClose, weekTier, leagueUnlocked, doneReward, leagueTier, leagueTable, LEAGUE } from './league.js';
import { addPage } from './memory.js';

const BP = 10_000;

/** True when the Fair plays in this build and the farm has its level. */
export const fairUnlocked = (state) => systemLive(FAIR) && levelFromXp(state.farm.xp) >= FAIR.unlock;

/** Sunday 20:00 of week `w` (the ceremony) in the farm's zone. */
export const fairCloseAt = (state, w) => localAt(state.meta.tz, weekStartDay(w) + FAIR.closeDay, FAIR.closeHour);

/** Monday 00:00 of week `w`. */
export const fairOpenAt = (state, w) => localAt(state.meta.tz, weekStartDay(w), 0);

/** 2 significant digits, then a multiple of 5 for small values (the economy model's nice(), integers only). */
export function niceInt(n) {
  if (n < 20) return Math.max(1, n);
  if (n < 100) return Math.floor((2 * n + 5) / 10) * 5;
  let p = 1;
  for (let x = n; x >= 100; x = Math.floor(x / 10)) p *= 10;
  return Math.floor((n + Math.floor(p / 2)) / p) * p;
}

/** The weekly target W in points at level L: nice(E(L) x 0.3 h / 100). */
export function fairTarget(L) {
  const E = levelRow(L).E;
  const den = BP * FAIR.pointValue;
  return niceInt(Math.floor((E * FAIR.targetHoursBp + Math.floor(den / 2)) / den));
}

/**
 * Medals that play in this build, lowest first. Platinum (M2) needs its project (the Town Fair Grounds) restored on
 * THIS farm: without `state` it is left out (a medal ladder drawn before the farm is known).
 */
export const liveMedals = (state = null) => FAIR.medals.filter((m) => systemLive(m)
  && (!m.needsProject || (state !== null && projectDone(state, m.needsProject))));

/** Rank of a medal id (1 Bronze I ... 10 Platinum), 0 for none. */
export const medalRank = (id) => (id ? MEDAL_RANKS.indexOf(id) + 1 : 0);

/** The best medal `p` points (x10) reach against target W on this farm (`state`: Platinum's project), or null. */
export function medalFor(p, W, state = null) {
  let best = null;
  for (const m of liveMedals(state)) if (p * BP >= m.atBp * W * 10) best = m;
  return best;
}

/** Points x10 a threshold needs (to show "12.5 points to Silver I"). */
export const medalNeed10 = (m, W) => Math.ceil((m.atBp * W * 10) / BP);

/** Coins a medal pays: 1.5 x the value of its threshold (atBp x W x 100 coins x 1.5). */
export const medalCoins = (m, W) => Math.floor((m.atBp * W * FAIR.pointValue * FAIR.payBp) / (BP * BP));

const withPerk = (state, p10) => p10 + Math.floor((p10 * perkOf(state, 'fairPointsBp')) / BP);

/** True when a feature (features.js) is part of this build: its milestone (tests may force it, coop.js). */
const featureLive = (id) => {
  const f = featureOf(id);
  return Boolean(f) && (isLive(f) || systemLive(f));
};

/** True when the horse-show feature is part of this build (features.js horse_show; its milestone). */
const horseShowLive = () => featureLive('horse_show');

/**
 * Points x10 ONE unit of `item` earns when entered at the tent at level L, or 0 when it cannot be entered: T3, T4
 * and duet goods (V / 100; duet x 2; T4 hampers x 2 from FAIR.points.hamperFrom), blue-ribbon animal goods
 * (2 x V / 100; the horse show doubles the Show Ribbon from its level). Raw crops and fruit score by harvest only.
 */
export function entryPoints10(state, item, L = levelFromXp(state.farm.xp)) {
  const it = itemOf(item);
  if (!it || !systemLive(it)) return 0;
  const P = FAIR.points;
  let p10 = 0;
  if (it.kind === 'premium') {
    p10 = Math.floor((P.prizedAnimalGoodMul * it.sell * 10 + Math.floor(P.entryDiv / 2)) / P.entryDiv);
    // the horse show doubles it only once the show exists (feature horse_show, M2: wave-2 QA RC-16)
    if (it.id === 'show_ribbon' && L >= P.horseShowFrom && horseShowLive()) p10 *= P.horseShowMul;
  } else if (it.kind === 'craft' && (it.tier === 'T3' || it.tier === 'T4' || it.tier === 'duet')) {
    p10 = Math.floor((it.sell * 10 + Math.floor(P.entryDiv / 2)) / P.entryDiv);
    if (it.tier === 'duet') p10 *= P.duetMul;
    if (it.tier === 'T4' && L >= P.hamperFrom && featureLive('hamper_double')) p10 *= P.hamperMul;
  }
  return p10 > 0 ? withPerk(state, p10) : 0;
}

/** Points x10 of one blue-ribbon crop harvest (plot gross / 100). */
export const prizedCropPoints10 = (state, crop) => {
  const c = cropOf(crop);
  if (!c) return 0;
  const gross = c.yield * c.sell;
  return withPerk(state, Math.floor((gross * 10 + Math.floor(FAIR.points.prizedCropPerGross / 2))
    / FAIR.points.prizedCropPerGross));
};

/** Points x10 of one blue-ribbon fruit harvest (3 + V / 100). */
export const prizedFruitPoints10 = (state, item) => {
  const it = itemOf(item);
  if (!it) return 0;
  return withPerk(state, FAIR.points.prizedFruitBase * 10 + Math.floor((it.sell * 10 + 50) / 100));
};

/** Entries of one item allowed per week (the Town Fair Grounds project adds one, M2). Without `state`: the base. */
export const entryLimit = (state = null) => FAIR.points.maxEntriesPerItem
  + (state ? doneReward(state, 'fairEntriesPerItem') : 0);

/** This week's open Fair at `now`, or null (closed, not unlocked, or a stale week). */
export function openFair(state, now) {
  const cur = state.farm.fair?.cur;
  if (!cur || !cur.open || !fairUnlocked(state)) return null;
  if (cur.w !== weekOf(state, now) || now >= fairCloseAt(state, cur.w)) return null;
  return cur;
}

/** What one more entry of `item` would score, and how many it may still take this week (UI and tracker). */
export function entryPreview(state, item, now) {
  const cur = openFair(state, now);
  const p10 = entryPoints10(state, item);
  const left = cur ? Math.max(0, entryLimit(state) - (cur.ent[item] ?? 0)) : 0;
  return { p10, left, have: available(state, item) };
}

/** Goods in the Barn the Fair would take now, best points first: [{ item, p10, left, have }]. */
export function enterable(state, now) {
  const cur = openFair(state, now);
  if (!cur) return [];
  const out = [];
  for (const item of sortedKeys(state.farm.inventory)) {
    const pv = entryPreview(state, item, now);
    if (pv.p10 > 0 && pv.left > 0 && pv.have > 0) out.push({ item, ...pv });
  }
  return out.sort((a, b) => b.p10 - a.p10 || (a.item < b.item ? -1 : 1));
}

/** Add points (x10) to the open Fair for `by` (harvest prizes and entries). */
export function fairAdd(tx, ctx, by, p10) {
  if (!(p10 > 0) || !openFair(tx.state, ctx.now)) return 0;
  const cur = tx.state.farm.fair.cur;
  tx.set(['farm', 'fair', 'cur', 'p'], cur.p + p10);
  if (hasPlayer(tx.state, by)) tx.set(['farm', 'fair', 'cur', 'by', by], (cur.by[by] ?? 0) + p10);
  return p10;
}

export const fairEnter = {
  schema: { item: V.content('items'), qty: V.qty },
  check(state, a, ctx) {
    if (!fairUnlocked(state)) return ERR.LOCKED;
    const cur = openFair(state, ctx.now);
    if (!cur) return ERR.NOT_READY;
    if (entryPoints10(state, a.item) <= 0) return ERR.BAD_ARGS;
    if ((cur.ent[a.item] ?? 0) + a.qty > entryLimit(state)) return ERR.CAP;
    if (available(state, a.item) < a.qty) return ERR.NO_ITEMS;
    // entering goods is like selling them: below the Keep N it asks who kept them (GDD §6.3)
    if (a.qty > unkept(state, a.item) && !confirmed(a, ERR.RESERVED)) return ERR.RESERVED;
    return null;
  },
  apply(tx, a, ctx) {
    const p10 = entryPoints10(tx.state, a.item) * a.qty;
    consume(tx, a.item, a.qty);
    const cur = tx.state.farm.fair.cur;
    tx.set(['farm', 'fair', 'cur', 'ent', a.item], (cur.ent[a.item] ?? 0) + a.qty);
    fairAdd(tx, ctx, ctx.pid, p10);
    tx.emit({ e: 'fairEntered', item: a.item, qty: a.qty, p10, total: tx.state.farm.fair.cur.p, by: ctx.pid });
  },
};

// ---- the week (system action `_fair`) -------------------------------------------------------------------------

/** True when `_fair` has work: a week to close with its ceremony, or the current week's Fair to open. */
export function fairDue(state, now) {
  const f = state.farm.fair;
  if (!f) return false;
  const cur = f.cur;
  if (cur && cur.open && now >= fairCloseAt(state, cur.w)) return true;
  if (!fairUnlocked(state)) return false;
  const w = weekOf(state, now);
  return (!cur || cur.w < w) && now < fairCloseAt(state, w);
}

/** The next moment `_fair` gets work after `now` (Infinity when the Fair is not unlocked). */
export function fairNextAt(state, now) {
  const f = state.farm.fair;
  if (!f) return Infinity;
  const cur = f.cur;
  if (cur && cur.open) return fairCloseAt(state, cur.w);
  if (!fairUnlocked(state)) return Infinity;
  return fairOpenAt(state, weekOf(state, now) + 1);
}

/** Open this week's Fair (W frozen at the current farm level). */
export function openWeek(tx, ctx) {
  const L = levelFromXp(tx.state.farm.xp);
  const w = weekOf(tx.state, ctx.now);
  const W = fairTarget(L);
  const cur = { w, W, L, p: 0, by: {}, ent: {}, open: true };
  const lg = weekTier(tx.state);
  if (lg !== null) cur.lg = lg;                       // a league week (M2): the tier it is played in
  tx.set(['farm', 'fair', 'cur'], cur);
  tx.emit({ e: 'fairOpened', w, W, by: ctx.pid });
}

/** The ceremony of an open week: medal and pay, the queued card for both players (progress.js counts the stats). */
function ceremony(tx, ctx) {
  const cur = tx.state.farm.fair.cur;
  const medal = medalFor(cur.p, cur.W, tx.state);
  const rank = medalRank(medal?.id);
  let coins = 0;
  let acorns = 0;
  let trophy = null;
  let banner = null;
  if (medal) {
    coins = medalCoins(medal, cur.W);
    acorns = medal.acorns ?? 0;
    if (coins > 0) earn(tx, ctx, coins, 'fair');
    if (medal.trophy) {
      trophy = rewardDecor('fair:gold');
      if (trophy) giveObject(tx, ctx, trophy, 1);
    }
    if (medal.banner) {
      banner = rewardDecor('fair:platinum');
      if (banner) giveObject(tx, ctx, banner, 1);
    }
    if (medal.goldenHourMs > 0) {
      // Platinum: a 24 h Golden Hour from the next Monday 00:00 (from now when the ceremony runs late, after
      // downtime: the reward is never lost); a second one never shortens a window that is still to come
      const from = Math.max(fairOpenAt(tx.state, cur.w + 1), ctx.now);
      const old = tx.state.farm.coop?.platinum;
      if (tx.state.farm.coop && !(old && old.until >= from + medal.goldenHourMs)) {
        tx.set(['farm', 'coop', 'platinum'], { from, until: from + medal.goldenHourMs });
      }
      addPage(tx, ctx, 'platinum', { by: 'sys', ref: String(cur.w) });
    }
  }
  // the NPC league (M2): its result rides on the ceremony; the week's tier x 1 Acorn
  const lg = leagueClose(tx, ctx, cur);
  if (lg) acorns += lg.acorns;
  if (acorns > 0) payReward(tx, ctx, null, { acorns }, 'fair');
  const last = { w: cur.w, W: cur.W, p: cur.p, medal: medal ? medal.id : null, rank, coins, acorns, trophy,
    at: ctx.now, seen: {}, by: { ...cur.by } };      // who brought what, for the partner's catch-up card
  if (lg) last.lg = lg;
  if (banner) last.banner = banner;
  // each farmer's unseen queue gets this ceremony (read before `last` is replaced: an older save keeps its
  // unseen newest ceremony this way)
  const unseen = {};
  for (const pid of playerIds(tx.state)) {
    unseen[pid] = [...ceremonyQueue(tx.state, pid, cur.w), last].slice(-FAIR_UNSEEN_MAX);
  }
  tx.set(['farm', 'fair', 'cur', 'open'], false);
  tx.set(['farm', 'fair', 'last'], last);
  tx.set(['farm', 'fair', 'unseen'], unseen);
  const ev = { e: 'fairCeremony', w: cur.w, W: cur.W, p: cur.p, medal: last.medal, rank, coins, acorns, trophy,
    by: ctx.pid };
  if (lg) ev.league = { tier: lg.tier, rank: lg.rank, move: lg.move, to: lg.to, acorns: lg.acorns };
  if (banner) ev.banner = banner;
  tx.emit(ev);
  const row = { k: 'fair', medal: last.medal, p: cur.p, c: coins };
  if (lg) { row.lg = lg.to; row.mv = lg.move; }
  feedAdd(tx, ctx, row);
}

/**
 * The reward decor of a Fair prize (content: a reward decor with `source` 'fair:gold' for the Gold trophy,
 * 'fair:platinum' for the champion banner), or null when content has none.
 */
function rewardDecor(source) {
  for (const d of CONTENT.decor.values()) if (d.source === source && systemLive(d)) return d.id;
  return null;
}

/** `_fair` apply: close a finished week with its ceremony (once), then open the current week if it is still open. */
export function fairRoll(tx, ctx) {
  const f = tx.state.farm.fair;
  if (f.cur && f.cur.open && ctx.now >= fairCloseAt(tx.state, f.cur.w)) ceremony(tx, ctx);
  if (!fairUnlocked(tx.state)) return;
  const w = weekOf(tx.state, ctx.now);
  const cur = tx.state.farm.fair.cur;
  if ((!cur || cur.w < w) && ctx.now < fairCloseAt(tx.state, w)) openWeek(tx, ctx);
}

/**
 * A level-up into the Fair opens this week's Fair at once (it is not worth waiting for Monday); a level-up into the
 * NPC league (M2) makes this week's open Fair a league week at once.
 */
export function fairOnLevel(tx, ctx, L) {
  if (!tx.state.farm.fair || !fairUnlocked(tx.state)) return;
  const w = weekOf(tx.state, ctx.now);
  const cur = tx.state.farm.fair.cur;
  if (L === FAIR.unlock && (!cur || cur.w < w) && ctx.now < fairCloseAt(tx.state, w)) openWeek(tx, ctx);
  const open = openFair(tx.state, ctx.now);
  if (L === Math.max(LEAGUE.unlock, FAIR.unlock) && open && !Number.isSafeInteger(open.lg)
    && leagueUnlocked(tx.state) && tx.state.farm.league) {
    tx.set(['farm', 'fair', 'cur', 'lg'], leagueTier(tx.state));
  }
}

/** How many unseen ceremonies a farmer keeps (the oldest drop off). */
export const FAIR_UNSEEN_MAX = 4;

/**
 * The ceremonies `pid` has not seen yet, oldest first (the UI shows them in this order and marks each seen), but
 * none of week `skipW` (the one being closed now). A save from before `unseen` reads the newest ceremony unless seen.
 */
export function ceremonyQueue(state, pid, skipW = null) {
  const f = state.farm.fair;
  if (!f || !hasPlayer(state, pid)) return [];
  const q = f.unseen ? f.unseen[pid] ?? [] : f.last && !f.last.seen[pid] ? [f.last] : [];
  return q.filter((c) => c.w !== skipW);
}

/** True when this player has a ceremony they have not seen yet (the UI shows the ceremony card). */
export function ceremonyUnseen(state, pid) {
  return ceremonyQueue(state, pid).length > 0;
}

/** The current week's standing for the UI: { open, w, W, p10, medal, next: { id, need10 } | null, closeAt, league }. */
export function fairStanding(state, now) {
  const cur = state.farm.fair?.cur;
  if (!cur) return null;
  const medal = medalFor(cur.p, cur.W, state);
  const next = liveMedals(state).find((m) => medalRank(m.id) > medalRank(medal?.id)) ?? null;
  return { open: Boolean(openFair(state, now)), w: cur.w, W: cur.W, p10: cur.p, by: { ...cur.by },
    medal: medal ? medal.id : null, next: next ? { id: next.id, need10: medalNeed10(next, cur.W) - cur.p,
      coins: medalCoins(next, cur.W) } : null, closeAt: fairCloseAt(state, cur.w), day: dayOf(state, now),
    // the NPC league table of the week (M2, league.js leagueTable), null before the league
    league: leagueTable(state, now, fairOpenAt(state, cur.w), fairCloseAt(state, cur.w)) };
}
