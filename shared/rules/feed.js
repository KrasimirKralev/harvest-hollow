// The activity feed and the "While you were away" recap (GDD §6.4, §5.8 morning recap, tech §4.4). Owned by
// rules-goals.
//
// farm.feed = { n, rows: { [n % FEED.historyMax]: Row } }: a ring object like the ledger (one small op per line,
// never a re-sent array). n counts every line ever written; the newest row is at slot (n - 1) % max.
// Row = { at, by, k, ...fields }
//   k (kind)  fields                         line ("Mia harvested 24 Wheat")
//   harvest   item, q (units), p (plots)     coalesced per stroke: same actor + kind + item within FEED.coalesceMs
//   tree      item, q                        coalesced
//   collect   item, q                        coalesced (animal goods)
//   tend      q (animals fed)                coalesced
//   water     q (partner tends)              coalesced
//   craft     item, q                        coalesced (goods collected from trays)
//   sell      item, q, c (coins)             coalesced
//   order     c (coins), x (xp), g (golden)  one per filled order
//   level     level                          farm level-up (by = whoever's action crossed it)
//   buy       what?, def, c (coins), a (acorns)  purchases over FEED.bigPurchase coins (or any Acorns); what =
//                                            'slot' (a building slot of def) | 'hurry' (Acorns to finish def now;
//                                            q = things hurried, coalesced per stroke like a harvest, a summed)
//   expand    def                            land expansion
//   ribbon    id, t (tier)                   achievement (F, T, or the player's own P)
//   quest     id                             quest completed
//   keepsake  item, to                       a keepsake gift
//   note      x, z                           a note pinned to a tile
//   golden    -                              Golden Hour started (by = 'sys', both players)
//   hf        a, b                           a high-five
//   gift      day                            Daily Gift claimed
//   chest     what ('meter' | 'almanac' | 'challenge' | 'together'), i
//   name      what ('farm' | 'animal'), text
//   wish      what ('bought' | 'deposit' | 'withdraw' | 'asked' | 'denied'), def, id?, c   the Wishlist
//   keep      item, q                        Keep N changed (q = the new n)
//   fair      item, q, p (points x 10)       Fair entries (coalesced per item); or medal, p, c: the ceremony (by 'sys')
//   barge     item, q, c                     a crate loaded; or row, c, a: a barge row completed
//   folk      npc, c                         a townsfolk request filled
//   album     set, item | set, done: 1       a collection find / a set completed
//   giant     crop, q                        a Giant felled
//   restore   project, bundle | project, done: 1   a Restoration bundle / project completed
//   town      id                             a Town Project built (by 'sys')
//   crate     c, a?, g?, item?, q?, def?, auto?   a balloon crate opened (wave 4b): coins, Acorns, Golden Seeds,
//                                            goods (item, q: Fertilizer) or a decor piece (a collection find has its own
//                                            `album` line); auto: 1 = nobody opened it, its loot went to the Barn
//                                            by itself (by 'sys')
//   relic     def, a? | def, q               an Acorn shop relic bought (a = Acorns), or a once-a-day relic used: def
//                                            'farmhand' (q animals tended) / 'time_turner' (q queue items finished)
//   key       what ('new' | 'back'), pid      multi-farm hosting (`_key`): `by` made a new key for farmer `pid`, or
//                                            `pid` came back with it (by = pid)
// Optional: ty = pid who said thanks (one thanks per line, from someone other than the actor).
import { FEED, RECAP } from '../content/index.js';
import { ceremonyQueue, openFair, fairStanding } from './actions/fair.js';
import { dockedBarge, castOffAt } from './actions/barge.js';
import { folkView } from './actions/folk.js';

const MAX = FEED.historyMax;

// a Hurry row also names what was hurried, so "finished crops early" never merges into a building's hurry
const same = (a, b) => a.by === b.by && a.k === b.k && a.item === b.item
  && (a.k !== 'buy' || (a.what === b.what && a.def === b.def));

/** The newest row, or null. */
export function lastRow(state) {
  const f = state.farm.feed;
  if (!f || f.n === 0) return null;
  return f.rows[String((f.n - 1) % MAX)] ?? null;
}

/**
 * Add a line. Kinds listed in `COALESCE` merge into the actor's current stroke row: the newest row of the same
 * actor, kind and item younger than FEED.coalesceMs, looking past the few lines this very action wrote in between
 * (a level-up or a quest card finished mid-drag must not split the stroke). Counts add and `at` moves on.
 * @returns {{ fresh: boolean, row: object }} fresh = a NEW row was written (a new stroke); row = the stroke's row
 */
export function feedAdd(tx, ctx, row) {
  const f = tx.get(['farm', 'feed']);
  const line = { at: ctx.now, by: ctx.pid, ...row };
  if (!f) return { fresh: false, row: line };
  if (coalesces(line)) {
    for (let i = f.n - 1; i >= 0 && i >= f.n - LOOKBACK; i--) {
      const slot = String(i % MAX);
      const prev = f.rows[slot];
      if (!prev) break;
      if (same(prev, line)) {
        if (ctx.now - prev.at > FEED.coalesceMs || ctx.now < prev.at) break;
        const merged = { ...prev, at: ctx.now };
        for (const key of ['q', 'p', 'c', 'a']) {
          if (Number.isSafeInteger(line[key])) merged[key] = (prev[key] ?? 0) + line[key];
        }
        tx.set(['farm', 'feed', 'rows', slot], merged);
        return { fresh: false, row: merged };
      }
      // only lines written by this same action (same instant) may sit between the stroke and its next plot, and the
      // actor's own companion stroke (one click on a pen both collects and re-feeds: "collected 3 Eggs" and "tended 3
      // animals" grow side by side instead of alternating line by line)
      const companion = coalesces(prev) && prev.by === line.by && ctx.now - prev.at <= FEED.coalesceMs;
      if (!companion && (prev.at !== ctx.now || coalesces(prev))) break;
    }
  }
  tx.set(['farm', 'feed', 'rows', String(f.n % MAX)], line);
  tx.inc(['farm', 'feed', 'n'], 1);
  return { fresh: true, row: line };
}

/** How far back a stroke may sit behind lines its own action wrote (level-up, quest, ribbon, chest). */
const LOOKBACK = 6;

const COALESCE = new Set(['harvest', 'tree', 'collect', 'tend', 'craft', 'sell', 'water', 'fair']);
// "Finish all growing Pumpkins" sends one hurry per plot: one stroke row, never one row per plot (a 60-plot batch
// evicted the whole 60-row ring, the partner's lines and their recap with it)
const coalesces = (row) => COALESCE.has(row.k) || (row.k === 'buy' && row.what === 'hurry');

/** Rows newest first (at most `limit`), as [index, row] where index is the row's absolute number. */
export function feedRows(state, limit = MAX) {
  const f = state.farm.feed;
  if (!f) return [];
  const out = [];
  for (let i = f.n - 1; i >= 0 && i >= f.n - MAX && out.length < limit; i--) {
    const r = f.rows[String(i % MAX)];
    if (r) out.push([i, r]);
  }
  return out;
}

/** The row with absolute number `i`, if it is still in the ring. */
export function feedRow(state, i) {
  const f = state.farm.feed;
  if (!f || !Number.isSafeInteger(i) || i < 0 || i >= f.n || i < f.n - MAX) return null;
  return f.rows[String(i % MAX)] ?? null;
}

/**
 * The recap's "Fair and barge" lines (GDD §5.8): a ceremony this player has not seen, this week's Fair standing, the
 * barge at the jetty (or its last cast-off since the visit), the townsfolk requests still open. [] when none plays.
 */
function weeklyStatus(state, pid, now, since) {
  const out = [];
  const cer = ceremonyQueue(state, pid)[0];          // the oldest ceremony this farmer missed (RC-14)
  if (cer) out.push({ what: 'ceremony', ...cer });
  const fair = openFair(state, now) ? fairStanding(state, now) : null;
  if (fair) out.push({ what: 'fair', p10: fair.p10, W: fair.W, medal: fair.medal, next: fair.next });
  const b = state.farm.barge;
  if (b && dockedBarge(state, now)) {
    const crates = Object.keys(b.crates).length;
    const loaded = Object.values(b.crates).filter((c) => c.by !== null).length;
    out.push({ what: 'barge', rows: b.rows, done: Object.keys(b.paid).length, crates, loaded, t: b.t });
  } else if (b && b.log && castOffAt(state, b.log.w) > since) out.push({ what: 'bargeLeft', ...b.log });
  const folk = folkView(state, now);
  if (folk && folk.unlocked && folk.posts.some((p) => p.done === null)) {
    out.push({ what: 'folk', open: folk.posts.filter((p) => p.done === null).length });
  }
  return out;
}

/**
 * "While you were away" (GDD §5.8, RECAP.sections): what this player missed since their last visit. Pure; the
 * client calls it on welcome with its own pid and the server clock. Sections that have nothing are omitted.
 * @param {object} state @param {string} pid @param {number} now
 * @param {{ since?: number, unlocks?: Array, beats?: Array, ripened?: object }} [extra]  the caller may pass the
 *   derived lists it already has (unseen unlocks, story beats, ripened counts) so they appear in RECAP order
 */
export function recap(state, pid, now, extra = {}) {
  const me = state.players[pid];
  if (!me) return { since: 0, sections: [] };
  const since = extra.since ?? me.lastSeenAt;
  const rows = feedRows(state).filter(([, r]) => r.at > since && r.at <= now).reverse();
  const partnerDid = rows.filter(([, r]) => r.by !== pid).slice(-RECAP.maxFeedLines).map(([i, r]) => ({ i, ...r }));
  const keepsakes = rows.filter(([, r]) => r.k === 'keepsake' && r.to === pid).map(([i, r]) => ({ i, ...r }));
  const notes = Object.entries(state.farm.notes ?? {}).filter(([, n]) => n.by !== pid && n.at > since)
    .sort((a, b) => a[1].at - b[1].at || (a[0] < b[0] ? -1 : 1)).map(([id, n]) => ({ id, ...n }));
  const parts = {
    ripened: extra.ripened ?? null,
    partnerDid,
    keepsakes,
    notes,
    newUnlocks: extra.unlocks ?? [],
    storyBeats: extra.beats ?? [],
    fairAndBarge: weeklyStatus(state, pid, now, since),
  };
  const sections = [];
  for (const name of RECAP.sections) {
    const v = parts[name];
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    sections.push({ name, items: v });
  }
  return { since, sections };
}
