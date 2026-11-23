// Co-op primitives (GDD §6.2, §6.3; tech §4.5 period counters, §15.4 joint actions, §15.6 buff windows). Owned by
// rules-goals. Pure helpers shared by progress.js and the goals actions: the farm calendar seen from a state,
// per-player daily caps, Hearts, the Golden Hour window, the Together Combo test and the shared joint-slot logic.
//
// Everything here is deterministic in (state, args, ctx): days and hours come from the farm's IANA zone
// (state.meta.tz), never the browser's; presence facts come only from ctx.ext (server-observed, journaled).
import { COOP, isLive } from '../content/index.js';
import { dayIndex, weekIndex, seasonOf } from './calendar.js';

const HOUR_FMT = new Map();

// ---- system gates (M1b goals systems) --------------------------------------------------------------------------
// The weekly and album systems (County Fair, River Barge, townsfolk board, collections, chains F-H) are content rule
// objects with a milestone (`m`). They run when that milestone is live. Tests of these systems must run in the build
// before the flip as well as after it, so a test may switch a rule object on here; the game never calls
// forceLiveForTests, and the switch is per process (node --test runs every test file in its own process).
const FORCED = new Set();
let forcedVersion = 0;

/** True when a goals system (a content rule object or def with `m`) plays in this build. */
export const systemLive = (def) => isLive(def) || (FORCED.size > 0 && FORCED.has(def));

/** Tests only: play (or stop playing) these content objects regardless of MILESTONE. */
export function forceLiveForTests(defs, on = true) {
  for (const d of defs) if (on) FORCED.add(d); else FORCED.delete(d);
  forcedVersion++;
}

/** Changes whenever forceLiveForTests does (caches of live content key on it). */
export const liveVersion = () => forcedVersion;

/** The farm's local calendar day for `now`. */
export const dayOf = (state, now) => dayIndex(now, state.meta.tz);

/** The farm's Monday-start week for `now`. */
export const weekOf = (state, now) => weekIndex(dayOf(state, now));

/** Local hour 0-23 of `now` in the farm's zone (Early Bird, Night Owls, the 6-hour golden-order schedule). */
export function localHour(now, tz) {
  let f = HOUR_FMT.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' });
    HOUR_FMT.set(tz, f);
  }
  for (const p of f.formatToParts(now)) if (p.type === 'hour') return Number(p.value) % 24;
  return 0;
}

const DAY_MS = 86_400_000;
const AT = new Map();

/**
 * The first epoch ms of local `hour`:00 on the farm's local calendar `day` (dayIndex), DST-safe: a binary search on
 * the farm calendar (a local midnight lies within 15 hours of the UTC one; a DST change on a Sunday moves 20:00 by an
 * hour against midnight + 20 h). Used for the weekly deadlines (Sunday 20:00, Monday 06:00).
 */
export function localAt(tz, day, hour = 0) {
  const key = `${tz}|${day}|${hour}`;
  const hit = AT.get(key);
  if (hit !== undefined) return hit;
  let lo = day * DAY_MS - 15 * 3_600_000;
  let hi = day * DAY_MS + 15 * 3_600_000;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (dayIndex(mid, tz) >= day) hi = mid; else lo = mid;
  }
  let t = hi;
  if (hour > 0) {
    lo = t;
    hi = t + 26 * 3_600_000;
    while (hi - lo > 1) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (dayIndex(mid, tz) > day || localHour(mid, tz) >= hour) hi = mid; else lo = mid;
    }
    t = hi;
  }
  if (AT.size > 256) AT.clear();
  AT.set(key, t);
  return t;
}

/** The first local day (dayIndex) of week `w` (weeks start on Monday). */
export const weekStartDay = (w) => 7 * w - 3;

/**
 * The calendar year a season instance belongs to, from a local day index (winter Dec-Feb counts as the year of its
 * December). Integer civil-date math (Howard Hinnant's days-to-civil).
 */
export function seasonYear(day, season) {
  const z = day + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return season === 'winter' && month <= 2 ? year - 1 : year;
}

/**
 * The real season instance at `now` in the farm's zone, `<year>-<season>`: '2026-autumn', '2026-winter' (December
 * 2026 to February 2027: a winter is keyed by its December).
 */
export function seasonKey(state, now) {
  const season = seasonOf(now, state.meta.tz);
  return `${seasonYear(dayOf(state, now), season)}-${season}`;
}

/** Local day index of a civil date (Howard Hinnant's days_from_civil; integers). */
export function dayOfCivil(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/** The civil date { y, m, d } of a local day index. */
export function civilOf(day) {
  const z = day + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** The first epoch ms of the next real season (the 1st of March, June, September or December, local midnight). */
export function nextSeasonAt(state, now) {
  const { y, m } = civilOf(dayOf(state, now));
  const next = Math.floor(m / 3) * 3 + 3;           // 1-2 -> 3, 3-5 -> 6, 6-8 -> 9, 9-11 -> 12, 12 -> 15
  const day = next > 12 ? dayOfCivil(y + 1, next - 12, 1) : dayOfCivil(y, next, 1);
  return localAt(state.meta.tz, day, 0);
}

/** 6-hour block index of the farm's local time (00, 06, 12, 18): day * 4 + floor(hour / 6). */
export const blockOf = (state, now) => dayOf(state, now) * 4 + Math.floor(localHour(now, state.meta.tz) / 6);

export const hasPlayer = (state, pid) => typeof pid === 'string' && pid !== 'sys' && Object.hasOwn(state.players, pid);

/** Joined player ids in canonical order. */
export const playerIds = (state) => Object.keys(state.players).sort();

/** The other joined players of `pid`, canonical order. */
export const othersOf = (state, pid) => playerIds(state).filter((p) => p !== pid);

// ---- per-player daily caps (period counters, tech §4.5) -------------------------------------------------------
// players[pid].caps = { d: dayIndex, <key>: n }: one small object per player, rewritten whole when the day
// changes, so no rollover is needed and a counter of yesterday simply reads 0.

/** How much of the daily cap `key` the player has used today. */
export function capUsed(state, pid, key, day) {
  const c = state.players[pid]?.caps;
  return c && c.d === day && Number.isSafeInteger(c[key]) ? c[key] : 0;
}

/**
 * Take `n` units of a daily cap of `max`. Returns how many were granted (0..n); writes only when > 0.
 * @param {import('./tx.js').Tx} tx
 */
export function capTake(tx, pid, key, max, day, n = 1) {
  const used = capUsed(tx.state, pid, key, day);
  const k = Math.max(0, Math.min(n, max - used));
  if (k <= 0) return 0;
  const c = tx.get(['players', pid, 'caps']);
  if (!c || c.d !== day) tx.set(['players', pid, 'caps'], { d: day, [key]: k });
  else tx.set(['players', pid, 'caps', key], used + k);
  return k;
}

/** Hearts are personal; a missing or 'sys' pid is ignored. */
export function addHearts(tx, pid, n) {
  if (n > 0 && hasPlayer(tx.state, pid)) tx.inc(['players', pid, 'hearts'], n);
}

// ---- Golden Hour (GDD §6.2 #9) ------------------------------------------------------------------------------

/**
 * The Golden Hour time reduction in basis points for a process STARTED at `now` (1000 = -10 %), else 0.
 * rules-economy applies it once, when a crop is planted, an animal fed or a recipe queued (tech §15.6: a window
 * fixes the effect at the start; running timers never change).
 */
export function goldenHourBp(state, now) {
  const g = state.farm.coop?.golden;
  if (g && now >= g.from && now < g.until) return COOP.goldenHour.bp;
  // a Platinum Fair's 24 h Golden Hour (M2, actions/fair.js): the same -10 %, never stacked with a bench's
  const pl = state.farm.coop?.platinum;
  return pl && now >= pl.from && now < pl.until ? COOP.goldenHour.bp : 0;
}

/** True when a Golden Hour may start at `now`: at least sessionGapMs after the start of the last one. */
export function goldenHourAllowed(state, now) {
  const last = state.farm.coop?.goldenAt;
  return !Number.isSafeInteger(last) || now - last >= COOP.goldenHour.sessionGapMs;
}

// ---- Together Combo (GDD §6.2 #6, App. F; server/together.js) ---------------------------------------------

/**
 * Action TYPES (server/together.js keys ext.recent by type) that count as "productive" for the Together Combo
 * (GDD §6.2 #6: harvest, tend, collect, craft-collect): the economy's harvest, harvestTree, tend / feed / collect
 * (animals), collectTray (building trays and the Compost Bin) and chop (Pine).
 */
export const PRODUCTIVE = Object.freeze(new Set(['harvest', 'harvestTree', 'tend', 'feed', 'collect', 'collectTray',
  'chop']));

const COMBO_D2 = COOP.combo.radius * COOP.combo.radius;

/**
 * True when another player did a productive action within the combo window on an object within the radius
 * (ctx.ext.recent, server-observed). Two tabs of one player are one pid, so they never combo (§9 #20).
 */
export function comboWith(ctx) {
  const recent = ctx.ext && ctx.ext.recent;
  if (!recent || typeof recent !== 'object') return null;
  for (const pid of Object.keys(recent).sort()) {
    if (pid === ctx.pid) continue;
    const byType = recent[pid];
    if (!byType || typeof byType !== 'object') continue;
    for (const t of PRODUCTIVE) if (Number.isFinite(byType[t]) && byType[t] <= COMBO_D2) return pid;
  }
  return null;
}

/**
 * True while a Together Combo is running (the last combo action was within COOP.combo.windowMs): the client shows
 * no "got there first" toast then (GDD §6.3), only the shared heart spark.
 */
export function comboActive(state, now) {
  const c = state.farm.coop?.combo;
  return Boolean(c) && Number.isSafeInteger(c.at) && now - c.at <= COOP.combo.windowMs;
}

/** The pids the server saw online for this action (sorted); [] when unknown (client prediction, old lines). */
export function onlineOf(ctx) {
  const o = ctx.ext && ctx.ext.online;
  return Array.isArray(o) ? o.filter((p) => typeof p === 'string').sort() : [];
}

/** Avatar distance in tiles x 10 between the actor and `other`, or Infinity when unknown. */
export function avatarDist10(ctx, other) {
  const a = ctx.ext && ctx.ext.avatar;
  const d = a && a[other];
  return Number.isFinite(d) ? d : Infinity;
}

/** XP with a basis-point bonus, floored (integer math only). */
export const withBp = (xp, bp) => xp + Math.floor((xp * bp) / 10_000);
