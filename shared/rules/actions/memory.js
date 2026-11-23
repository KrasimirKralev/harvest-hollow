// The Memory Book (GDD §5.9, §6.2 #20; the "Our Story" ribbon, M1b). Owned by rules-goals.
//
// A page is a record in the replicated state; its picture is a canvas snapshot the client keeps locally (keyed by the
// page's number `n`), never state. Pages come two ways:
//   auto     the rules add them at the moments GDD §5.9 lists: the farm named, an animal named (its first name), every
//            5th farm level, the first blue-ribbon animal, the first harvest together (the first Together Combo),
//            each Restoration project, each Town Project built, a postcard at the first play of each season, and
//            (M2) each Platinum Fair, Grandma's visit and the end of a Friendly Duel
//   offered  "a Memory Book page is offered" (Golden Hour, a duet, story cards with `memory`, a photo from photo
//            mode): the client asks, and `memoryPage` keeps it. At most MEMORY.manualPerDay offered pages a player a
//            day count for the ribbon (photo mode is free to use; the ribbon cannot be farmed with the shutter).
// The book plays with the ribbon that reads it (Our Story, M1b): before that nothing is written.
//
// farm.memory = { n, season, rows: { [n % MEMORY.max]: { n, k, at, by, ref?, text? } } }
//   n = pages ever made (the ring keeps the newest MEMORY.max); season = the last season postcard's key
//
//   memoryPage { k: 'photo' | 'golden' | 'duet' | 'quest', ref?, text? }   keep an offered page
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { CONTENT } from '../../content/index.js';
import { seasonOf } from '../calendar.js';
import { dayOf, capTake, systemLive } from '../coop.js';

/** Ring size, the offered pages a player may add a day that count, and the caption length. */
export const MEMORY = Object.freeze({ max: 200, manualPerDay: 2, textMax: 60 });

/** Auto page kinds (rules) and offered kinds (`memoryPage`). */
export const MEMORY_AUTO = Object.freeze(['farm', 'animal', 'level', 'prized', 'together', 'project', 'town',
  'season', 'platinum', 'grandma', 'duel']);
export const MEMORY_OFFERED = Object.freeze(['photo', 'golden', 'duet', 'quest']);

/** True when the Memory Book plays (the ribbon that counts it is live). */
export const memoryLive = () => systemLive(CONTENT.ribbons.get('our_story'));

/**
 * Add a page. Returns true when it was written. Callers decide WHEN (progress.js for auto pages); the page counts for
 * Our Story through the `memoryPage` FX event's handler (progress.js bumps `memoryPages`).
 */
export function addPage(tx, ctx, k, { by = ctx.pid, ref = null, text = null, counts = true } = {}) {
  const m = tx.state.farm.memory;
  if (!m || !memoryLive()) return false;
  const row = { n: m.n, k, at: ctx.now, by };
  if (ref !== null) row.ref = String(ref);
  if (text !== null) row.text = text;
  tx.set(['farm', 'memory', 'rows', String(m.n % MEMORY.max)], row);
  tx.set(['farm', 'memory', 'n'], m.n + 1);
  tx.emit({ e: 'memoryPage', n: m.n, k, ref: row.ref ?? null, counts, by });
  return true;
}

/** The season postcard (GDD §5.9 A6): the first action of a new season adds one. */
export function seasonPostcard(tx, ctx) {
  const m = tx.state.farm.memory;
  if (!m || !memoryLive()) return;
  const day = dayOf(tx.state, ctx.now);
  const season = seasonOf(ctx.now, tx.state.meta.tz);
  // a season instance: its name and the year its first day falls in (winter keyed by its December, in days / 365)
  const key = `${season}:${Math.floor((day - (season === 'winter' ? 60 : 0)) / 365)}`;
  if (m.season === key) return;
  tx.set(['farm', 'memory', 'season'], key);
  addPage(tx, ctx, 'season', { by: 'sys', ref: season });
}

export const memoryPage = {
  schema: { k: V.oneOf(...MEMORY_OFFERED), ref: V.opt(V.text(32)), text: V.opt(V.text(MEMORY.textMax)) },
  check(state) {
    return state.farm.memory && memoryLive() ? null : ERR.LOCKED;
  },
  apply(tx, a, ctx) {
    // the page is always kept; only the first MEMORY.manualPerDay of a player's day count for the ribbon
    const counts = capTake(tx, ctx.pid, 'memory', MEMORY.manualPerDay, dayOf(tx.state, ctx.now)) > 0;
    addPage(tx, ctx, a.k, { ref: a.ref ?? null, text: a.text ?? null, counts });
  },
};

/** Pages newest first (at most `limit`), for the book and the Journal. */
export function memoryRows(state, limit = MEMORY.max) {
  const m = state.farm.memory;
  if (!m) return [];
  const out = [];
  for (let i = m.n - 1; i >= 0 && i >= m.n - MEMORY.max && out.length < limit; i--) {
    const r = m.rows[String(i % MEMORY.max)];
    if (r) out.push(r);
  }
  return out;
}
