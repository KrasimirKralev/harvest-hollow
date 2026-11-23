// The Friendly Duel (GDD §6.2 "Also", §6.3; M2, opt-in, off by default; content: shared/content/leisure.js DUEL).
// Owned by rules-goals.
//
// One farmer invites, the other accepts; from the acceptance to the Fair week's close (Sunday DUEL.closeHour, farm
// zone) each farmer's own score counts. The scores are credited so that helping still helps the partner (nobody gains
// by taking the partner's work): pumpkins count for the farmer who PLANTED the plot (whoever harvests it), pies for
// the one who queued them at the Pie Oven (whoever collects), orders for the one who filled them (a simple order is a
// quarter: stored x DUEL kind scale). Nothing about a duel ever touches the farm's coins, goods or XP.
// The end (`_duel`, Sunday close, catch-up safe): the higher score wears the crown on the name card for
// DUEL.crown.ms, a tie crowns both; both get DUEL.rewards.hearts Hearts and the farm's first finished duel the pennant
// decor. A duel nobody scored in ends quietly (no crown, no Hearts). An invitation lapses at the week's close or after
// DUEL.inviteMs. At most one duel at a time; only two distinct players duel (the inviter and the one who accepts).
//
// farm.duel = {
//   cur:   null | { kind, by (inviter), at (invited), ok (accepted), start, end, p: [a, b] | null, s: { pid: n } }
//   last:  null | { kind, s, win: pid | null, tie, end, seen: { pid: 1 } }    the newest finished duel
//   crown: null | { pids: [pid], until }                                     who wears the crown, until when
//   n:     duels finished (the pennant goes with the first one that was scored)
// }
//
//   duelInvite { kind }   LOCKED (not live / below DUEL.unlock or the kind's level / alone on the farm), NOT_READY
//                         (between the week's close and Monday 00:00), OCCUPIED (a duel or an invitation is on)
//   duelAccept {}         NOT_FOUND (no invitation, or it lapsed), SELF_ONLY (your own invitation), ALREADY_DONE
//                         (running)
//   duelDecline {}        the invited farmer says no: NOT_FOUND, SELF_ONLY (use duelCancel), ALREADY_DONE
//   duelCancel {}         the inviter takes it back before an answer: NOT_FOUND, SELF_ONLY (not yours), ALREADY_DONE
//   _duel {}              system: lapse an old invitation, or end a duel at its close
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { DUEL, levelFromXp, CONTENT } from '../../content/index.js';
import { systemLive, hasPlayer, playerIds, weekOf, localAt, weekStartDay } from '../coop.js';
import { sortedKeys } from '../order.js';
import { feedAdd } from '../feed.js';
import { addPage } from './memory.js';
import { giveHearts, giveObject } from '../progress.js';

/** Fresh duel state. */
export const initialDuel = () => ({ cur: null, last: null, crown: null, n: 0 });

/** The kinds that play, in content order. */
export const duelKinds = () => DUEL.kinds.map((k) => ({ ...k }));

const kindOf = (id) => DUEL.kinds.find((k) => k.id === id) ?? null;

/** True when duels play in this build, the farm has the level, and there is someone to duel. */
export const duelUnlocked = (state) => systemLive(DUEL) && levelFromXp(state.farm.xp) >= DUEL.unlock
  && playerIds(state).length >= 2;

/** The week's close (Sunday DUEL.closeHour) of week `w`. */
export const duelCloseAt = (state, w) => localAt(state.meta.tz, weekStartDay(w) + DUEL.closeDay, DUEL.closeHour);

/** When an invitation lapses (the earlier of its week's close and inviteMs after it was sent). */
export const lapseAt = (cur) => Math.min(cur.end, cur.at + DUEL.inviteMs);

/** True while a duel runs at `now` (accepted, before its end). */
export const duelRunning = (state, now) => {
  const c = state.farm.duel?.cur;
  return Boolean(c && c.ok && now < c.end);
};

/** The player(s) wearing the duel crown at `now`. */
export function crownsOf(state, now) {
  const c = state.farm.duel?.crown;
  return c && now < c.until ? c.pids.filter((p) => hasPlayer(state, p)) : [];
}

/** The duel crown's wearer at `now` (the first of a tie), or null; with `pid`: true when that player wears one. */
export function crownOf(state, now, pid = null) {
  const pids = crownsOf(state, now);
  return pid === null ? pids[0] ?? null : pids.includes(pid);
}

/** The duel as one player sees it (the panel and the tracker). */
export function duelOf(state, pid, now) {
  const d = state.farm.duel;
  if (!d) return null;
  const cur = d.cur;
  let phase = 'none';
  if (cur && !cur.ok) phase = now >= lapseAt(cur) ? 'none' : cur.by === pid ? 'asked' : 'invited';
  else if (cur && cur.ok) phase = now < cur.end ? 'live' : 'over';
  const them = cur?.p ? cur.p.find((p) => p !== pid) ?? null : playerIds(state).find((p) => p !== pid) ?? null;
  return { open: duelUnlocked(state), phase, cur: cur ? { ...cur, s: { ...cur.s } } : null,
    last: d.last ? { ...d.last } : null, crown: crownsOf(state, now), them,
    mine: cur?.s?.[pid] ?? 0, theirs: them ? cur?.s?.[them] ?? 0 : 0, n: d.n,
    unseen: Boolean(d.last && !d.last.seen?.[pid]), lapseAt: cur && !cur.ok ? lapseAt(cur) : null };
}

function inviteCode(state, a, ctx) {
  if (!duelUnlocked(state)) return ERR.LOCKED;
  const k = kindOf(a.kind);
  if (!k || levelFromXp(state.farm.xp) < (k.unlock ?? 1)) return ERR.LOCKED;
  const w = weekOf(state, ctx.now);
  if (ctx.now >= duelCloseAt(state, w)) return ERR.NOT_READY;
  const cur = state.farm.duel.cur;
  if (cur && (cur.ok ? ctx.now < cur.end : ctx.now < lapseAt(cur))) return ERR.OCCUPIED;
  return null;
}

export const duelInvite = {
  schema: { kind: V.oneOf(...DUEL.kinds.map((k) => k.id)) },
  check(state, a, ctx) {
    return inviteCode(state, a, ctx);
  },
  apply(tx, a, ctx) {
    // an old duel past its end that `_duel` has not closed yet closes first (the scheduler would do it a moment later)
    const old = tx.state.farm.duel.cur;
    if (old && old.ok && ctx.now >= old.end) duelEnd(tx, ctx);
    const end = duelCloseAt(tx.state, weekOf(tx.state, ctx.now));
    tx.set(['farm', 'duel', 'cur'], { kind: a.kind, by: ctx.pid, at: ctx.now, ok: false, start: 0, end, p: null,
      s: {} });
    tx.emit({ e: 'duelInvited', kind: a.kind, end, by: ctx.pid });
  },
};

/** The open invitation for `pid` to answer, or an ERR. */
function answerCode(state, pid, now, own) {
  const cur = state.farm.duel?.cur;
  if (!cur || (!cur.ok && now >= lapseAt(cur))) return ERR.NOT_FOUND;
  if (cur.ok) return ERR.ALREADY_DONE;
  if (own ? cur.by !== pid : cur.by === pid) return ERR.SELF_ONLY;
  return null;
}

export const duelAccept = {
  schema: {},
  check(state, a, ctx) {
    if (!systemLive(DUEL)) return ERR.LOCKED;
    return answerCode(state, ctx.pid, ctx.now, false);
  },
  apply(tx, a, ctx) {
    const cur = tx.state.farm.duel.cur;
    const p = [cur.by, ctx.pid].sort();
    tx.set(['farm', 'duel', 'cur'], { ...cur, ok: true, start: ctx.now, p, s: { [p[0]]: 0, [p[1]]: 0 } });
    tx.emit({ e: 'duelAccepted', kind: cur.kind, end: cur.end, a: cur.by, b: ctx.pid, by: ctx.pid });
    feedAdd(tx, ctx, { k: 'duel', what: 'start', kind: cur.kind, to: cur.by });
  },
};

export const duelDecline = {
  schema: {},
  check(state, a, ctx) {
    return answerCode(state, ctx.pid, ctx.now, false);
  },
  apply(tx, a, ctx) {
    const cur = tx.state.farm.duel.cur;
    tx.set(['farm', 'duel', 'cur'], null);
    tx.emit({ e: 'duelDeclined', kind: cur.kind, to: cur.by, by: ctx.pid });
  },
};

export const duelCancel = {
  schema: {},
  check(state, a, ctx) {
    return answerCode(state, ctx.pid, ctx.now, true);
  },
  apply(tx, a, ctx) {
    const cur = tx.state.farm.duel.cur;
    tx.set(['farm', 'duel', 'cur'], null);
    tx.emit({ e: 'duelCancelled', kind: cur.kind, by: ctx.pid });
  },
};

/**
 * A deed that may score in the running duel (progress.js): `who` is the farmer it credits (planter / queuer /
 * filler, per the kind), `n` the units (x the kind's scale). Only the two duellists score, only while it runs.
 */
export function duelScore(tx, ctx, kind, who, n) {
  const cur = tx.state.farm.duel?.cur;
  if (!cur || !cur.ok || cur.kind !== kind || !(n > 0) || ctx.now < cur.start || ctx.now >= cur.end) return;
  if (!Array.isArray(cur.p) || !cur.p.includes(who)) return;
  tx.set(['farm', 'duel', 'cur', 's', who], (cur.s[who] ?? 0) + n);
}

/** True when `_duel` has work: an invitation to lapse, a duel to end. */
export function duelDue(state, now) {
  const cur = state.farm.duel?.cur;
  if (!cur) return false;
  return cur.ok ? now >= cur.end : now >= lapseAt(cur);
}

/** The next moment `_duel` gets work (Infinity when nothing is on). */
export function duelNextAt(state) {
  const cur = state.farm.duel?.cur;
  if (!cur) return Infinity;
  return cur.ok ? cur.end : lapseAt(cur);
}

/** End the running duel: crown, Hearts, the first pennant, the record (exactly once: `cur` is cleared). */
function duelEnd(tx, ctx) {
  const d = tx.state.farm.duel;
  const cur = d.cur;
  const s = { ...cur.s };
  const pids = sortedKeys(s).filter((p) => hasPlayer(tx.state, p));
  const best = Math.max(0, ...pids.map((p) => s[p]));
  const scored = best > 0;
  const top = scored ? pids.filter((p) => s[p] === best) : [];
  const tie = top.length > 1;
  const win = top.length === 1 ? top[0] : null;
  let decor = null;
  if (scored) {
    tx.set(['farm', 'duel', 'crown'], { pids: top, until: cur.end + DUEL.crown.ms });
    for (const p of pids) giveHearts(tx, ctx, p, DUEL.rewards.hearts, 'duel');
    const first = DUEL.rewards.firstDecor;
    if (first && !(d.n > 0) && CONTENT.decor.has(first) && systemLive(CONTENT.decor.get(first))) {
      giveObject(tx, ctx, first, 1);
      decor = first;
    }
    tx.set(['farm', 'duel', 'n'], d.n + 1);
    addPage(tx, ctx, 'duel', { by: 'sys', ref: cur.kind });
  }
  tx.set(['farm', 'duel', 'last'], { kind: cur.kind, s, win, tie, end: cur.end, scored, seen: {} });
  tx.set(['farm', 'duel', 'cur'], null);
  tx.emit({ e: 'duelEnded', kind: cur.kind, s, win, tie, scored, crown: top, decor, by: ctx.pid });
  if (scored) feedAdd(tx, { ...ctx, pid: 'sys' }, { k: 'duel', what: 'end', kind: cur.kind, win, tie: tie ? 1 : 0 });
}

/** `_duel {}`: lapse an unanswered invitation, or end a duel at the week's close (catch-up safe: once). */
export const _duel = {
  schema: {},
  check(state, a, ctx) {
    return duelDue(state, ctx.now) ? null : ERR.ALREADY_DONE;
  },
  apply(tx, a, ctx) {
    const cur = tx.state.farm.duel.cur;
    if (cur.ok) duelEnd(tx, ctx);
    else {
      tx.set(['farm', 'duel', 'cur'], null);
      tx.emit({ e: 'duelLapsed', kind: cur.kind, to: cur.by, by: ctx.pid });
    }
  },
};
