// The first evening's two tutorial tracks (GDD §7.4; content: shared/content/tutorial.js TUTORIAL). Owned by
// rules-goals. A guidance layer only: it never gates anything, and every step can be skipped.
//
// players[pid].tut = { track: null | 'fields' | 'barnyard', i, n, skip }   the player's current track, step index,
//                    progress of that step; null track = not assigned yet (or all done: i past the end of both)
// farm.tut = { s, t, n, fin: { fields?: pid, barnyard?: pid } }
//   s = step index of TUTORIAL.start (welcome, name the farm), t / n = step index and progress of TUTORIAL.together
//   (the shared steps: flour together, say hello, apple tree, Golden Hour), fin = who finished each track
// Assignment (GDD §7.4 "auto-assigned by who acts first and swappable"): a player's first deed that matches the
// first step of a track takes that track, and the partner, if they have none, gets the other one. A solo player
// gets the other track as soon as theirs is done (if nobody did it). tutSwap swaps (with the partner, or alone).
// Steps count the track holder's own deeds; together steps count anyone's (a solo player completes them alone).
// A step with `level` waits for that farm level. Steps whose deed only the client sees (task null, 'ping') are
// marked with tutDone.
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { TUTORIAL, levelFromXp } from '../../content/index.js';
import { hasPlayer, othersOf, playerIds } from '../coop.js';

const TRACKS = TUTORIAL.tracks;
const CLIENT_VERBS = new Set(['ping']);
const other = (track) => (track === 'fields' ? 'barnyard' : 'fields');

export const initialTut = () => ({ track: null, i: 0, n: 0, skip: false });
export const initialFarmTut = () => ({ s: 0, t: 0, n: 0, fin: {} });

const stepMatches = (step, d) => step && step.task && step.task.verb === d.verb && step.task.ref === d.ref;
const gateOpen = (state, step) => !step.level || levelFromXp(state.farm.xp) >= step.level;

/** The step a player is on (or null when their tutorial is finished / skipped). */
export function currentStep(state, pid) {
  const t = state.players[pid]?.tut;
  if (!t || !t.track || t.skip) return null;
  return TUTORIAL[t.track][t.i] ?? null;
}

/** The farm-level step now: a start step first, then the together steps. */
export function currentFarmStep(state) {
  const ft = state.farm.tut;
  if (!ft) return null;
  if (ft.s < TUTORIAL.start.length) return { list: 'start', step: TUTORIAL.start[ft.s] };
  if (ft.t < TUTORIAL.together.length) return { list: 'together', step: TUTORIAL.together[ft.t] };
  return null;
}

function emitStep(tx, pid, track, step, done) {
  tx.emit({ e: 'tutorialStep', pid, track, step: step.id, done });
}

/** Advance a player's track by a deed (and assign a track on their first matching deed). */
export function tutorialDeed(tx, ctx, run, d) {
  if (!tx.state.farm.tut) return;
  trackDeed(tx, d);
  settleQuestSteps(tx);
}

/**
 * A step keyed to a story card that is already finished teaches nothing any more (the partner collected the eggs,
 * an older farm did it long ago): it completes for every player who is on it, so a coach card never waits on a
 * deed the farm has already done. Deterministic: player ids in sorted order.
 */
function settleQuestSteps(tx) {
  const done = tx.state.farm.quests?.done;
  if (!done) return;
  for (const pid of playerIds(tx.state)) {
    for (let guard = 0; guard < 16; guard++) {
      const t = tx.state.players[pid]?.tut;
      const step = t && t.track && !t.skip ? TUTORIAL[t.track][t.i] : null;
      if (!step || !step.quest || !Object.hasOwn(done, step.quest)) break;
      advance(tx, pid, t, step);
    }
  }
}

function trackDeed(tx, d) {
  const state = tx.state;
  farmDeed(tx, d);
  const pid = d.by;
  if (!hasPlayer(state, pid)) return;
  let t = state.players[pid].tut;
  if (!t || t.skip) return;
  if (!t.track) {
    const pick = TRACKS.find((tr) => !state.farm.tut.fin[tr] && stepMatches(TUTORIAL[tr][0], d)
      && !othersOf(state, pid).some((p) => state.players[p].tut?.track === tr));
    if (!pick) return;
    tx.set(['players', pid, 'tut'], { ...t, track: pick, i: 0, n: 0 });
    for (const p of othersOf(state, pid)) {
      const pt = state.players[p].tut;
      if (pt && !pt.track && !pt.skip && !state.farm.tut.fin[other(pick)]) {
        tx.set(['players', p, 'tut'], { ...pt, track: other(pick), i: 0, n: 0 });
      }
    }
    t = tx.state.players[pid].tut;
  }
  const step = TUTORIAL[t.track][t.i];
  if (!step || !stepMatches(step, d) || !gateOpen(state, step)) return;
  const n = Math.min(step.task.qty, t.n + d.n);
  if (n < step.task.qty) {
    tx.set(['players', pid, 'tut', 'n'], n);
    return;
  }
  advance(tx, pid, t, step);
}

function advance(tx, pid, t, step) {
  emitStep(tx, pid, t.track, step, true);
  const i = t.i + 1;
  if (i < TUTORIAL[t.track].length) {
    tx.set(['players', pid, 'tut'], { ...t, i, n: 0 });
    return;
  }
  // track finished: a solo player (or one whose partner is busy elsewhere) takes the other track if nobody did it
  tx.set(['farm', 'tut', 'fin', t.track], pid);
  const next = other(t.track);
  const taken = tx.state.farm.tut.fin[next]
    || othersOf(tx.state, pid).some((p) => tx.state.players[p].tut?.track === next);
  if (taken) tx.set(['players', pid, 'tut'], { track: null, i: 0, n: 0, skip: true });
  else tx.set(['players', pid, 'tut'], { track: next, i: 0, n: 0, skip: false });
}

function farmDeed(tx, d) {
  const cur = currentFarmStep(tx.state);
  if (!cur || !stepMatches(cur.step, d) || !gateOpen(tx.state, cur.step)) return;
  const ft = tx.state.farm.tut;
  if (cur.list === 'start') {
    tx.set(['farm', 'tut', 's'], ft.s + 1);
  } else {
    const n = Math.min(cur.step.task.qty, ft.n + d.n);
    if (n < cur.step.task.qty) { tx.set(['farm', 'tut', 'n'], n); return; }
    tx.set(['farm', 'tut'], { ...ft, t: ft.t + 1, n: 0 });
  }
  tx.emit({ e: 'tutorialStep', pid: d.by, track: 'together', step: cur.step.id, done: true });
}

/**
 * `tutDone { step }`: the current farm-level step is done or skipped: the steps only the client can see (the welcome
 * card, "say hello" with a ping), or any step the couple skips ("I know farming"; an older farm already named).
 * Guidance only: nothing is paid, so marking a step done can never be exploited.
 */
export const tutDone = {
  schema: { step: V.text(32) },
  check(state, a) {
    const cur = currentFarmStep(state);
    return cur && cur.step.id === a.step ? null : ERR.NOT_FOUND;
  },
  apply(tx, a, ctx) {
    const ft = tx.state.farm.tut;
    const cur = currentFarmStep(tx.state);
    if (cur.list === 'start') tx.set(['farm', 'tut', 's'], ft.s + 1);
    else tx.set(['farm', 'tut'], { ...ft, t: ft.t + 1, n: 0 });
    const client = !cur.step.task || CLIENT_VERBS.has(cur.step.task.verb);
    tx.emit({ e: 'tutorialStep', pid: ctx.pid, track: 'together', step: a.step, done: true, skipped: !client });
  },
};

/** `tutSkip { all? }`: skip the current step of my track (or my whole tutorial: "I know farming"). */
export const tutSkip = {
  schema: { all: V.opt(V.oneOf('yes')) },
  check(state, a, ctx) {
    const t = state.players[ctx.pid].tut;
    return t && !t.skip && (t.track || a.all) ? null : ERR.ALREADY_DONE;
  },
  apply(tx, a, ctx) {
    const t = tx.get(['players', ctx.pid, 'tut']);
    if (a.all || !t.track) {
      tx.set(['players', ctx.pid, 'tut'], { track: null, i: 0, n: 0, skip: true });
      tx.emit({ e: 'tutorialStep', pid: ctx.pid, track: t.track ?? 'all', step: 'skip', done: true });
      return;
    }
    advance(tx, ctx.pid, t, TUTORIAL[t.track][t.i]);
  },
};

/**
 * `tutRestart {}`: "Show the guide again" (Settings > Farm). My guide starts over: the next deed picks a track again
 * (one nobody finished and the partner does not hold); nothing on the farm changes. Guidance only, nothing is paid, so
 * restarting can never be farmed (wave-1 QA UI-04: "I know farming" used to end the guide for good).
 */
export const tutRestart = {
  schema: {},
  check(state, a, ctx) {
    const t = state.players[ctx.pid].tut;
    return t && (t.skip || t.track || t.i > 0 || t.n > 0) ? null : ERR.ALREADY_DONE;
  },
  apply(tx, a, ctx) {
    tx.set(['players', ctx.pid, 'tut'], initialTut());
    tx.emit({ e: 'tutorialStep', pid: ctx.pid, track: 'all', step: 'restart', done: false });
  },
};

/** `tutSwap {}`: swap tracks with the partner (both keep their step progress per track) or switch alone. */
export const tutSwap = {
  schema: {},
  check(state, a, ctx) {
    const t = state.players[ctx.pid].tut;
    return t && t.track && !t.skip ? null : ERR.NOT_FOUND;
  },
  apply(tx, a, ctx) {
    const t = tx.get(['players', ctx.pid, 'tut']);
    const partner = playerIds(tx.state).find((p) => p !== ctx.pid && tx.state.players[p].tut?.track === other(t.track));
    if (partner) {
      const pt = tx.get(['players', partner, 'tut']);
      tx.set(['players', partner, 'tut'], { ...t, skip: false });
      tx.set(['players', ctx.pid, 'tut'], { ...pt, skip: false });
    } else if (!tx.state.farm.tut.fin[other(t.track)]) {
      tx.set(['players', ctx.pid, 'tut'], { track: other(t.track), i: 0, n: 0, skip: false });
    }
    tx.emit({ e: 'tutorialStep', pid: ctx.pid, track: 'swap', step: 'swap', done: false });
  },
};
