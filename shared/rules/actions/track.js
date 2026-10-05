// The Seasonal Ribbon Track (GDD §5.9, L24, M2; content: shared/content/projects.js SEASONAL_TRACK). Owned by
// rules-goals.
//
// One free 30-tier track per real season (the farm's calendar: Mar-May, Jun-Aug, Sep-Nov, Dec-Feb). Points = the
// farm XP earned in the season (both farmers' XP, every source); a tier needs nice(tierHours x XP/h at the farm level
// when the season's track opened) = niceInt(E(L) x tierHours / 8). A reached tier is claimed by either farmer for the
// farm (`trackClaim`); its reward is content's SEASONAL_TRACK.rewards[tier - 1]. The season's coat (`{ coat: 'season' }`)
// goes to the farm's coat chest and is put on one animal the couple chooses (`coatWear`, cosmetic).
// At the season's end (`_track`, or the first action of the new season) every reached tier still unclaimed is paid
// (a reward is never lost), and the points left convert to coins: E(level now) x leftoverCoinsHoursBp per unfinished
// tier's worth, never more than the tiers left. Then the new season's track opens at the current level.
//
// farm.track = { s: season key ('2026-autumn') | null, L, need, xp, got: { [tier]: { by, at } }, coats: [coatId] }
//   s = null before the track opened; L / need frozen when it opened; xp = points this season; got = claimed tiers;
//   coats = season coats won and not yet worn
//
//   trackClaim { tier }       claim a reached tier: LOCKED (track not live / below its level), NOT_READY (not reached
//                             yet), ALREADY_DONE (claimed)
//   coatWear { id, coat }     put a won season coat on animal `id`: NOT_FOUND (no such animal), NO_ITEMS (the coat
//                             is not in the chest), BAD_ARGS (a bee colony); the animal's previous season coat goes
//                             back to the chest, a bred coat is kept underneath (`bcoat`) and `coat: <bcoat>` puts
//                             it back on; selling the animal returns its season coat to the chest
//   _track {}                 system: close the season that ended and open the current one (catch-up safe: one action
//                             closes the last open season whatever the downtime; a season nobody played never opened)
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { SEASONAL_TRACK, BREEDING, DAILY_GIFT, levelFromXp, levelRow, eHours, animalOf } from '../../content/index.js';
import { systemLive, seasonKey, nextSeasonAt } from '../coop.js';
import { seasonOf } from '../calendar.js';
import { payPrize, bumpStat } from '../progress.js';
import { grant } from '../economy.js';
import { niceInt } from './fair.js';
import { feedAdd } from '../feed.js';
import { isColony } from './animals.js';

const T = SEASONAL_TRACK;

/** Fresh track state (createFarm and the backfill of older saves). */
export const initialTrack = () => ({ s: null, L: 0, need: 0, xp: 0, got: {}, coats: [] });

/** True when the track plays in this build and the farm has its level. */
export const trackUnlocked = (state) => systemLive(T) && levelFromXp(state.farm.xp) >= T.unlock;

/** XP one tier needs at level L: niceInt(E(L) x tierHours / 8) (one hour of play's XP). */
export const trackNeed = (state, L = levelFromXp(state.farm.xp)) => niceInt(Math.max(1,
  Math.floor((levelRow(L).E * (T.tierHours ?? 1)) / 8)));

/** Tiers per season. */
export const trackTiers = () => T.tiers;

/** The content reward of a tier (1-based), a copy. */
export const trackReward = (tier) => ({ ...(T.rewards?.[tier - 1] ?? (T.acornTiers.includes(tier)
  ? { acorns: T.acorns } : {})) });

/** Tiers reached by a track's points (0..tiers). */
export const reachedOf = (tr) => (tr && tr.need > 0 ? Math.min(T.tiers, Math.floor(tr.xp / tr.need)) : 0);

/** The track of the current season, or null (not open, or the season it holds has ended). */
export function currentTrack(state, now) {
  const tr = state.farm.track;
  return tr && tr.s !== null && tr.s === seasonKey(state, now) ? tr : null;
}

/** The season coat of a season ('autumn' -> 'russet'), or null. */
export const seasonCoat = (season) => BREEDING.seasonCoats?.find((c) => c.season === season)?.id ?? null;

/** Pay one tier (claim or the season's end): the reward, the season coat into the chest. Returns what was paid. */
function payTier(tx, ctx, tier, by, season) {
  const r = trackReward(tier);
  // the season's planter is the TRACK's season: a season-end auto-claim runs in the next season already
  const pr = r.decor === 'season' ? { ...r, decor: DAILY_GIFT.seasonDecor?.[season] ?? r.decor } : r;
  const paid = payPrize(tx, ctx, null, pr, 'track');
  if (r.coat === 'season') {
    const coat = seasonCoat(season);
    if (coat) {
      tx.set(['farm', 'track', 'coats'], [...tx.state.farm.track.coats, coat]);
      paid.coat = coat;
    }
  }
  tx.set(['farm', 'track', 'got', String(tier)], { by, at: ctx.now });
  return paid;
}

/** True when `_track` has work: the track should open (or roll into a new season). */
export function trackDue(state, now) {
  if (!state.farm.track || !trackUnlocked(state)) return false;
  return state.farm.track.s !== seasonKey(state, now);
}

/** The next moment `_track` gets work: the next season's start (Infinity before the track's level). */
export const trackNextAt = (state, now) => (state.farm.track && trackUnlocked(state) ? nextSeasonAt(state, now)
  : Infinity);

/**
 * Close the ended season (auto-claim, leftover coins) and open the current one. Idempotent: a no-op when the track
 * already holds the current season. Called by `_track` and before any XP is counted (trackAdd).
 */
export function trackRoll(tx, ctx) {
  if (!trackDue(tx.state, ctx.now)) return;
  const tr = tx.state.farm.track;
  const key = seasonKey(tx.state, ctx.now);
  let leftover = 0;
  let auto = 0;
  if (tr.s !== null) {
    const season = tr.s.slice(tr.s.indexOf('-') + 1);
    const reached = reachedOf(tr);
    for (let t = 1; t <= reached; t++) {
      if (Object.hasOwn(tx.state.farm.track.got, String(t))) continue;
      payTier(tx, ctx, t, 'sys', season);
      auto++;
    }
    // the points left: their share of an unfinished tier's worth, never more than the tiers left (GDD §5.9)
    const left = Math.min(Math.max(0, tr.xp - reached * tr.need), (T.tiers - reached) * tr.need);
    if (left > 0 && tr.need > 0) {
      const perTier = eHours(levelFromXp(tx.state.farm.xp), T.leftoverCoinsHoursBp ?? 0);
      leftover = Math.floor((perTier * left) / tr.need);
      if (leftover > 0) grant(tx, ctx, leftover, 'track');
    }
    tx.emit({ e: 'trackClosed', s: tr.s, tiers: reached, auto, coins: leftover, by: ctx.pid });
    feedAdd(tx, { ...ctx, pid: 'sys' }, { k: 'track', s: tr.s, t: reached, c: leftover });
  }
  const L = levelFromXp(tx.state.farm.xp);
  tx.set(['farm', 'track'], { s: key, L, need: trackNeed(tx.state, L), xp: 0, got: {},
    coats: [...tx.state.farm.track.coats] });
  tx.emit({ e: 'trackOpened', s: key, need: tx.state.farm.track.need, by: ctx.pid });
}

/**
 * Farm XP earned (progress.addFarmXp): the season's points. Rolls the season first (an XP gain at the first second of
 * a new season counts for the new one); every tier reached bumps the lifetime Season Ticket counter.
 */
export function trackAdd(tx, ctx, run, n) {
  if (!(n > 0) || !tx.state.farm.track || !trackUnlocked(tx.state)) return;
  trackRoll(tx, ctx);
  const tr = tx.state.farm.track;
  if (tr.s === null) return;
  const before = reachedOf(tr);
  tx.set(['farm', 'track', 'xp'], tr.xp + n);
  const after = reachedOf(tx.state.farm.track);
  for (let t = before + 1; t <= after; t++) {
    bumpStat(tx, run, null, 'seasonTiers');
    tx.emit({ e: 'trackTier', tier: t, s: tr.s, by: ctx.pid });
  }
}

export const trackClaim = {
  schema: { tier: V.int(1, 99) },
  check(state, a, ctx) {
    if (!trackUnlocked(state)) return ERR.LOCKED;
    const tr = currentTrack(state, ctx.now);
    if (!tr || a.tier > T.tiers) return ERR.NOT_READY;
    if (Object.hasOwn(tr.got, String(a.tier))) return ERR.ALREADY_DONE;
    return a.tier <= reachedOf(tr) ? null : ERR.NOT_READY;
  },
  apply(tx, a, ctx) {
    const s = tx.state.farm.track.s;
    const paid = payTier(tx, ctx, a.tier, ctx.pid, seasonOf(ctx.now, tx.state.meta.tz));
    tx.emit({ e: 'trackClaimed', tier: a.tier, s, reward: paid, by: ctx.pid });
  },
};

/** True for a season coat of the track (a chest item), false for a Breeding Barn coat (the animal's own). */
export const isSeasonCoat = (c) => typeof c === 'string' && Boolean(BREEDING.seasonCoats?.some((x) => x.id === c));

/** An animal leaving the farm (sold, undone) gives the season coat it wore back to the chest: only this season had it. */
export function coatLeaves(tx, o) {
  const tr = tx.state.farm.track;
  if (tr && Array.isArray(tr.coats) && isSeasonCoat(o.coat)) tx.set(['farm', 'track', 'coats'], [...tr.coats, o.coat].sort());
}

/**
 * The animal `obj` (a clone, about to be put back from the trash) takes its season coat out of the chest again; when
 * the chest no longer has it (it went on another animal), the animal wears its own bred coat or none.
 */
export function coatReturns(tx, obj) {
  if (!isSeasonCoat(obj.coat)) return obj;
  const coats = [...(tx.state.farm.track?.coats ?? [])];
  const i = coats.indexOf(obj.coat);
  if (i >= 0) {
    coats.splice(i, 1);
    tx.set(['farm', 'track', 'coats'], coats);
    return obj;
  }
  const out = { ...obj };
  delete out.coat;
  if (out.bcoat !== undefined) out.coat = out.bcoat;
  delete out.bcoat;
  return out;
}

export const coatWear = {
  schema: { id: V.objId, coat: V.text(24) },
  check(state, a) {
    const o = Object.hasOwn(state.farm.objects, a.id) ? state.farm.objects[a.id] : null;
    if (!o || !animalOf(o.def) || typeof o.home !== 'string') return ERR.NOT_FOUND;
    if (isColony(o)) return ERR.BAD_ARGS;                             // a bee colony wears no coat (the UI hides them)
    if (o.coat === a.coat) return ERR.ALREADY_DONE;
    if (o.bcoat !== undefined && a.coat === o.bcoat) return null;      // back to its own bred coat
    const coats = state.farm.track?.coats ?? [];
    return coats.includes(a.coat) ? null : ERR.NO_ITEMS;
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    const base = ['farm', 'objects', a.id];
    const coats = [...tx.state.farm.track.coats];
    // a season coat the animal wore goes back into the chest
    if (isSeasonCoat(o.coat)) coats.push(o.coat);
    if (o.bcoat !== undefined && a.coat === o.bcoat) {
      tx.del([...base, 'bcoat']);                                      // its own coat again
    } else {
      coats.splice(coats.indexOf(a.coat), 1);
      // a bred coat (a 5 % golden one) is the animal's own: kept under the season coat, never overwritten
      if (typeof o.coat === 'string' && !isSeasonCoat(o.coat)) tx.set([...base, 'bcoat'], o.coat);
    }
    tx.set(['farm', 'track', 'coats'], coats.sort());
    tx.set([...base, 'coat'], a.coat);
    if (o.rcpt !== undefined) tx.del([...base, 'rcpt']);              // a dressed animal is no longer a 100 % undo
    tx.emit({ e: 'coatWorn', id: a.id, coat: a.coat, by: ctx.pid });
  },
};

/** `_track {}`: the season changed (or the track's level was reached): close the old season, open this one. */
export const _track = {
  schema: {},
  check(state, a, ctx) {
    return trackDue(state, ctx.now) ? null : ERR.ALREADY_DONE;
  },
  apply(tx, a, ctx) {
    trackRoll(tx, ctx);
  },
};

/**
 * The track for the UI: { open, s, season, L, need, xp, tier (reached), tiers: [{ n, at, reward, got, claimable }],
 * toNext, inTier, claimable, leftoverCoins (what the season's end would pay now), endsAt, coats }.
 */
export function trackView(state, now) {
  const open = trackUnlocked(state);
  const tr = currentTrack(state, now);
  const season = seasonOf(now, state.meta.tz);
  const L = tr ? tr.L : levelFromXp(state.farm.xp);
  const need = tr ? tr.need : trackNeed(state, L);
  const xp = tr ? tr.xp : 0;
  const tier = tr ? reachedOf(tr) : 0;
  const tiers = [];
  for (let n = 1; n <= T.tiers; n++) {
    const got = tr?.got?.[String(n)] ?? null;
    tiers.push({ n, at: n * need, reward: trackReward(n), got, reached: n <= tier, claimable: n <= tier && !got });
  }
  const left = Math.min(Math.max(0, xp - tier * need), (T.tiers - tier) * need);
  const perTier = eHours(levelFromXp(state.farm.xp), T.leftoverCoinsHoursBp ?? 0);
  return { open, s: tr ? tr.s : seasonKey(state, now), season, L, need, xp, tier, tiers, done: tier >= T.tiers,
    toNext: tier >= T.tiers ? 0 : (tier + 1) * need - xp, inTier: tier >= T.tiers ? need : xp - tier * need,
    claimable: tiers.filter((t) => t.claimable).length, leftoverCoins: need > 0 ? Math.floor((perTier * left) / need) : 0,
    endsAt: nextSeasonAt(state, now), coats: [...(state.farm.track?.coats ?? [])], coat: seasonCoat(season) };
}
