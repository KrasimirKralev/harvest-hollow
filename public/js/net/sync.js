// SyncStore: the client's one game state, predicted and reconciled by undo-log rebase
// (FROZEN CONTRACT, tech-architecture §3.4). DOM-free, so node tests drive it directly.
//
//   act(type, args)  runs the shared rule at once against the predicted state (zero-latency feel), keeps
//                    the undo ops as a pending entry and sends the intent; returns the runAction result
//                    ({ ok:false, code } when the local check fails: nothing is sent, show the reason)
//   onServer(msg)    'd' | 'rej' | 'ack': rewind every pending action, apply the authoritative change,
//                    replay the still-pending actions with their ORIGINAL predicted `now`
//   reset(welcome)   full state: drop pending already applied (seq <= lastSeq), replay + re-send the rest.
//                    welcome.known === false (the server had no dedupe record for this cid): the outcome of
//                    every pending action is unknowable, so they are DROPPED (event 'lost'), never re-sent:
//                    applying one twice is worse than losing it (review-m0 #4)
//   setOnline(bool)  the socket's state. Input blocks with ERR.OFFLINE after MAX_OFFLINE_MS offline, or while
//                    the oldest pending action has gone unanswered that long (tech §3.7, review-m0 L3)
// Additive (wave 1, client-core):
//   onServerBatch(list)  every 'd'/'rej'/'ack' of one animation frame with ONE rewind, all changes, ONE replay
//                    (GDD App. F delta coalescing); identical outcome to onServer() per message. main.js feeds
//                    it from a per-frame inbox; onServer(msg) is onServerBatch([msg])
//   health()         { ready, online, resyncing, stale, pending, oldestMs, offlineMs, v } for the pending /
//                    connection indicator and the F3 overlay
// Additive (wave 1 QA, CL-07 / performance-16):
//   act(type, args, { hold: true })   predict NOW (the same zero-latency feel), send LATER: the action waits in the
//                    outbox until release(). A drag stroke holds its frames for ~250 ms, so a 15-plot stroke is a
//                    handful of acts and journal lines instead of one per frame. An act without hold releases first,
//                    so the server always sees the player's order
//   release() -> n   send the outbox: consecutive held actions of one stroke type ({ id } / { ids } with the same
//                    other args, schema with `ids`) merge into ONE `ids` action (renumbered seqs: nothing held was
//                    ever sent). The rules apply a stroke target by target with partial success (economy.planBatch),
//                    so the merged action has the effect of the separate ones. A welcome sends the outbox too
//
// Events (store.on(name, fn) -> unsubscribe):
//   'change'    { ids: Set<objId>, topics: Set<topic>, source, pending }  after every state change;
//               views re-read only these ids/topics. source: 'local' | 'server' | 'reject' | 'welcome'
//   'fx'        { ev, by, local }   world feedback (planted, harvested, sold, placed, ...): predicted
//               instantly for own actions, from deltas for the partner's and system actions. Never
//               includes celebrations.
//   'celebrate' { ev, by }          CONFIRMED-ONLY celebrations (the closed set progress.CELEBRATIONS, imported
//               from the rules): only from server deltas, never predicted, so nothing celebratory is taken
//               back (tech §0 #15, §3.6). After a reconnect or resync, farm level-ups that happened while
//               this tab missed the deltas are celebrated from the welcome ({ ev: { e:'levelUp', ...,
//               catchUp: true } }), so "on both screens" holds (review-m0 M8).
//   'reject'    { seq, type, args, code, by, local }  a prediction failed (server race) or a local check failed;
//               also for a pending action whose `rej` was lost in a disconnect (welcome.rejected, L2)
//   'lost'      { actions: [{ seq, type, args }] }    pending actions dropped on a welcome with known: false
//   'welcome'   { pid, peers, v }   after reset()
//   'resync'    { cause }           a gap or divergence was detected; a fresh welcome was requested. While no
//               welcome arrives, the request is repeated every RESYNC_RETRY_MS (review-m0 H3)
//   'delta'     the raw `d` message after it was applied (debug overlays, activity feed)
//   'pending'   { n, oldestAt }     the number of unconfirmed predictions changed (additive, wave 1): the HUD's
//               "saving..." indicator; oldestAt = predicted server time of the oldest one (null when n = 0)
//
// Topics (op path -> topic): farm.objects -> 'objects' (+ the id), farm.wallet -> 'wallet',
// farm.inventory / farm.overflow -> 'inventory', farm.xp -> 'xp', farm.<k> -> k, players -> 'players',
// meta -> 'meta'. 'welcome' changes carry the topic '*' (everything).
import { runAction, makeCtx, CELEBRATIONS, ACTIONS } from '../../../shared/rules/index.js';
import { MAX_BATCH } from '../../../shared/rules/economy.js';
import { applyOps } from '../../../shared/rules/tx.js';
import { resetGrid } from '../../../shared/rules/grid-cache.js';
import { levelFromXp, levelRow } from '../../../shared/content/index.js';
import { MSG, ERR, LIMITS } from '../../../shared/net/protocol.js';

export const ALL = '*';

/** Events that only ever play from a confirmed server delta: the rules' closed list (progress.js). */
export { CELEBRATIONS };

/** A resync request unanswered this long is repeated (any server message or act() triggers the check). */
export const RESYNC_RETRY_MS = 3000;

const TOPIC_ALIAS = { overflow: 'inventory' };

/** The ids of a stroke action's args ({ id } or { ids }), or null when it has neither. */
const idsOf = (args) => (Array.isArray(args.ids) ? args.ids : typeof args.id === 'string' ? [args.id] : null);
/** A stroke action's args without its targets, as a comparable string (keys sorted). */
const restKey = (args) => JSON.stringify(Object.keys(args).filter((k) => k !== 'id' && k !== 'ids').sort().map((k) => [k, args[k]]));

/**
 * The merged args of two held actions of one stroke, or null when they must stay separate: another type, a schema
 * without `ids`, a soft confirm, different other args, a repeated target or more than MAX_BATCH targets.
 */
export function mergeArgs(type, a, b) {
  const def = ACTIONS[type];
  if (!def || !def.schema || !Object.hasOwn(def.schema, 'ids')) return null;
  if (a.confirm !== undefined || b.confirm !== undefined) return null;
  const ia = idsOf(a);
  const ib = idsOf(b);
  if (!ia || !ib || restKey(a) !== restKey(b)) return null;
  const ids = [...ia, ...ib];
  if (ids.length > MAX_BATCH || new Set(ids).size !== ids.length) return null;
  const out = {};
  for (const k of Object.keys(a)) if (k !== 'id' && k !== 'ids') out[k] = a[k];
  out.ids = ids;
  return out;
}

/** Map op paths to object ids and topics. */
export function touchedBy(opLists) {
  const ids = new Set();
  const topics = new Set();
  for (const ops of opLists) {
    for (const op of ops) {
      const [a, b, c] = op.p;
      if (a === 'farm') {
        if (b === undefined) { topics.add(ALL); continue; }
        topics.add(TOPIC_ALIAS[b] || b);
        if (b === 'objects' && c !== undefined) ids.add(c);
      } else if (a !== undefined) {
        topics.add(a);
      }
    }
  }
  return { ids, topics };
}

export class SyncStore {
  /**
   * @param {object} o
   * @param {string} o.cid                          this page load's client id
   * @param {(msg: object) => void} o.send           transport (drops frames while disconnected; reset() re-sends)
   * @param {() => number} o.now                     estimated server time (ClockSync.serverNow)
   * @param {(err: any) => void} [o.onInternal]      a rule threw locally (logged loudly in dev)
   */
  constructor({ cid, send, now, onInternal = (e) => console.error('rule threw', e) }) {
    this.cid = cid;
    this.send = send;
    this.now = now;
    this.onInternal = onInternal;
    this.state = null;
    this.pid = null;
    this.v = 0;
    this.seq = 0;
    /** @type {Array<{ seq, type, args, now, undo }>} */
    this.pending = [];
    this.resyncing = false;
    this.resyncAt = 0;
    /** farm level of the last CONFIRMED state (catch-up celebrations); null before the first welcome */
    this.confirmedLevel = null;
    this.online = true;
    this.offlineSince = 0;
    this.lastPending = 0;
    /** how many of the LAST pending entries are held (predicted, not sent yet): act(..., { hold }) */
    this.unsent = 0;
    this.listeners = new Map();
  }

  // ---- events ---------------------------------------------------------------------------------
  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.listeners.get(name).delete(fn);
  }

  /** Call fn(change) whenever `topic` (or '*') changes. */
  subscribe(topic, fn) {
    return this.on('change', (ch) => { if (ch.topics.has(topic) || ch.topics.has(ALL)) fn(ch); });
  }

  emit(name, payload) {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (err) { console.error(`store listener '${name}' failed`, err); }
    }
  }

  emitChange(opLists, source) {
    const { ids, topics } = touchedBy(opLists);
    if (!ids.size && !topics.size) return;
    this.emit('change', { ids, topics, source, pending: this.pending.length });
  }

  ctx(now, seq) {
    return makeCtx(this.state, { now, pid: this.pid, cid: this.cid, seq, ext: {}, grace: 0 });
  }

  get ready() { return this.state !== null && !this.resyncing; }

  /** The socket's state (Socket.onStatus). */
  setOnline(on) {
    if (on === this.online) return;
    this.online = on;
    this.offlineSince = on ? 0 : this.now();
  }

  /** True when input must block: offline too long, or the oldest prediction is unanswered too long. */
  get stale() {
    const now = this.now();
    if (!this.online && now - this.offlineSince > LIMITS.MAX_OFFLINE_MS) return true;
    return this.pending.length > 0 && now - this.pending[0].now > LIMITS.MAX_OFFLINE_MS;
  }

  // ---- input ----------------------------------------------------------------------------------
  /**
   * Predict and send one intent.
   * @param {string} type @param {object} [args]
   * @param {{ hold?: boolean }} [opts] hold: predict now, send at the next release() (merged with its stroke)
   * @returns {{ ok: boolean, code?: string, tx?: object }}
   */
  act(type, args = {}, { hold = false } = {}) {
    if (!this.ready) {
      if (this.resyncing) this.requestResync('retry');
      return { ok: false, code: ERR.NOT_JOINED };
    }
    if (!hold) this.release();                            // the server sees the player's order
    if (this.stale) return { ok: false, code: ERR.OFFLINE };
    if (this.pending.length >= LIMITS.MAX_PENDING) return { ok: false, code: ERR.RATE };
    const now = this.now();
    const seq = this.seq + 1;
    const r = runAction(this.state, { type, args }, this.ctx(now, seq));
    if (!r.ok) {
      if (r.code === ERR.INTERNAL) this.onInternal(r.err);
      this.emit('reject', { seq: 0, type, args, code: r.code, local: true });
      return r;
    }
    this.seq = seq;
    this.pending.push({ seq, type, args, now, undo: r.tx.inverse() });
    if (hold) this.unsent++;
    else this.send({ t: MSG.ACT, seq, type, args });     // `now` is NOT sent: the server uses its own clock
    this.emitChange([r.tx.ops], 'local');
    this.notePending();
    for (const ev of r.tx.events) if (!CELEBRATIONS.has(ev.e)) this.emit('fx', { ev, by: this.pid, local: true });
    return r;
  }

  /**
   * Merge the held (unsent) tail of `pending` in place: consecutive mergeable actions become one, seqs are
   * renumbered from the first held one (none of them was ever sent). Returns the entries that are now unsent.
   */
  mergeHeld() {
    const n = this.unsent;
    if (!n) return [];
    this.unsent = 0;
    const held = this.pending.splice(this.pending.length - n, n);
    const out = [];
    for (const p of held) {
      const last = out.at(-1);
      const merged = last && last.type === p.type ? mergeArgs(p.type, last.args, p.args) : null;
      if (merged) {
        last.args = merged;
        last.undo = [...p.undo, ...last.undo];            // rewinding undoes the later one first
      } else out.push({ ...p });
    }
    let seq = held[0].seq;
    for (const p of out) p.seq = seq++;
    this.seq = seq - 1;
    this.pending.push(...out);
    return out;
  }

  /** Send the held actions (merged per stroke). Returns how many acts went out. */
  release() {
    const out = this.mergeHeld();
    for (const p of out) this.send({ t: MSG.ACT, seq: p.seq, type: p.type, args: p.args });
    return out.length;
  }

  // ---- server ---------------------------------------------------------------------------------
  /** Full state from `welcome` (first join, reconnect, resync). */
  reset(w) {
    const prevLevel = this.confirmedLevel;
    // held actions were never sent, so the server cannot have seen them: merge them now and send them below with
    // the rest (they are not "lost" even when the server forgot this cid)
    const held = new Set(this.mergeHeld());
    this.state = w.state;
    resetGrid(this.state);
    this.v = w.v;
    this.pid = w.pid;
    this.resyncing = false;
    if (w.lastSeq > this.seq) this.seq = w.lastSeq;
    const settled = this.pending.filter((p) => p.seq <= w.lastSeq);
    let lost = [];
    if (w.known === false) {
      lost = this.pending.filter((p) => p.seq > w.lastSeq && !held.has(p));
      this.pending = this.pending.filter((p) => held.has(p));     // the server accepts any seq above its lastSeq
    } else {
      this.pending = this.pending.filter((p) => p.seq > w.lastSeq);
    }
    // Celebrations this tab missed while its deltas were lost (confirmed: the welcome is authoritative).
    this.confirmedLevel = levelFromXp(this.state.farm.xp);
    const catchUp = [];
    if (prevLevel !== null) {
      for (let L = prevLevel + 1; L <= this.confirmedLevel; L++) {
        const row = levelRow(L);
        catchUp.push({ e: 'levelUp', scope: 'farm', level: L, coins: row.coins, acorns: row.acorns, catchUp: true });
      }
    }
    this.replayPending();
    for (const p of this.pending) this.send({ t: MSG.ACT, seq: p.seq, type: p.type, args: p.args });
    this.emit('change', { ids: new Set(), topics: new Set([ALL]), source: 'welcome', pending: this.pending.length });
    this.notePending();
    this.emit('welcome', { pid: w.pid, peers: w.peers || [], v: w.v });
    // A settled action the server rejected, whose `rej` was lost in the disconnect: say so (review-m0 L2).
    const rejected = new Map((w.rejected || []).map((r) => [r.seq, r]));
    for (const p of settled) {
      const r = rejected.get(p.seq);
      if (r) this.emit('reject', { seq: p.seq, type: p.type, args: p.args, code: r.code, by: r.by, local: false });
    }
    if (lost.length) this.emit('lost', { actions: lost.map(({ seq, type, args }) => ({ seq, type, args })) });
    for (const ev of catchUp) this.emit('celebrate', { ev, by: null });
  }

  /**
   * Ask for a fresh welcome. Repeated (not ignored) when the previous request is older than RESYNC_RETRY_MS:
   * a request lost on the way must not freeze the store until a reload (review-m0 H3).
   * @param {string} [cause]
   */
  requestResync(cause = 'divergence') {
    const now = this.now();
    if (this.resyncing && now - this.resyncAt < RESYNC_RETRY_MS) return;
    const first = !this.resyncing;
    this.resyncing = true;
    this.resyncAt = now;
    this.send({ t: MSG.RESYNC });
    if (first) this.emit('resync', { cause });
  }

  /** Replay every pending action on the current state; doomed ones are skipped (their 'rej' follows). */
  replayPending() {
    const touched = [];
    for (const p of this.pending) {
      const r = runAction(this.state, p, this.ctx(p.now, p.seq));
      p.undo = r.ok ? r.tx.inverse() : [];
      if (r.ok) touched.push(r.tx.ops);
    }
    return touched;
  }

  /** Handle one 'd', 'rej' or 'ack' (a batch of one). */
  onServer(msg) { this.onServerBatch([msg]); }

  /**
   * Handle every 'd' / 'rej' / 'ack' that arrived since the last animation frame, in arrival order, with ONE
   * rewind of the pending actions, all the authoritative changes, and ONE replay (GDD §8.6 / App. F "coalesce
   * deltas per animation frame"): a 70-plot partner drag costs one rebase, not 70. Exactly equivalent to
   * calling onServer() per message (test/sync.coalesce.test.js proves it on random interleavings); events
   * ('change' once, then 'celebrate' / 'fx' / 'delta' / 'reject' per message in order) follow the state change.
   * Other message types in the list are ignored.
   * @param {object[]} list
   */
  onServerBatch(list) {
    if (!this.state || !Array.isArray(list) || !list.length) return;
    const touched = [];
    const after = [];                          // events emitted once the state is final
    let rewound = false;
    let applied = false;
    try {
      for (const msg of list) {
        if (!msg) continue;
        if (msg.t === MSG.DELTA) {
          if (this.resyncing) { this.requestResync('retry'); continue; }   // a fresh welcome is on its way
          if (msg.v <= this.v) continue;                      // already in the state (welcome raced a delta)
          if (msg.v !== this.v + 1) { this.requestResync(`gap: have v${this.v}, got v${msg.v}`); continue; }
        } else if (msg.t !== MSG.REJ && msg.t !== MSG.ACK) {
          continue;
        }
        if (!rewound) {
          rewound = true;
          for (let i = this.pending.length - 1; i >= 0; i--) {    // rewind to the confirmed state, once
            applyOps(this.state, this.pending[i].undo);
            touched.push(this.pending[i].undo);                    // a doomed action's objects must re-sync too
          }
        }
        if (msg.t === MSG.DELTA) {
          applyOps(this.state, msg.ops);
          this.v = msg.v;
          this.state.meta.version = msg.v;       // the server bumps it outside the tx (it is the `v` counter)
          this.confirmedLevel = levelFromXp(this.state.farm.xp);
          touched.push(msg.ops);
          applied = true;
          if (msg.cid === this.cid) this.pending = this.pending.filter((p) => p.seq > msg.seq);
          after.push(() => {
            for (const ev of msg.ev || []) {
              if (CELEBRATIONS.has(ev.e)) this.emit('celebrate', { ev, by: msg.by });
              else if (msg.cid !== this.cid) this.emit('fx', { ev, by: msg.by, local: false });
            }
            this.emit('delta', msg);
          });
        } else {
          let rejected = null;
          const i = this.pending.findIndex((p) => p.seq === msg.seq);
          if (i >= 0) [rejected] = this.pending.splice(i, 1);
          if (msg.t === MSG.ACK) this.pending = this.pending.filter((p) => p.seq > msg.seq);
          if (msg.t === MSG.REJ) {
            after.push(() => this.emit('reject', {
              seq: msg.seq, type: rejected?.type, args: rejected?.args, code: msg.code, by: msg.by, local: false,
            }));
          }
        }
      }
      if (!rewound) return;
      touched.push(...this.replayPending());   // replay once, with each action's ORIGINAL predicted `now`
    } catch (err) {
      // Ops that do not apply mean the copies diverged (a bug): start over from a full state.
      console.error('sync: could not apply server change; resyncing', err);
      this.requestResync(`apply failed: ${err && err.message}`);
      return;
    }
    this.emitChange(touched, applied ? 'server' : 'reject');
    this.notePending();
    for (const fn of after) fn();
  }

  // ---- health (pending indicator, connection quality) -------------------------------------------
  /** Emit 'pending' { n, oldestAt } when the number of unconfirmed predictions changed. */
  notePending() {
    const n = this.pending.length;
    if (n === this.lastPending) return;
    this.lastPending = n;
    this.emit('pending', { n, oldestAt: n ? this.pending[0].now : null });
  }

  /**
   * Snapshot for the HUD's pending/connection indicator and the F3 overlay.
   * @returns {{ ready: boolean, online: boolean, resyncing: boolean, stale: boolean, pending: number,
   *   oldestMs: number, offlineMs: number, v: number }}
   */
  health() {
    const now = this.now();
    return {
      ready: this.ready, online: this.online, resyncing: this.resyncing, stale: this.state ? this.stale : false,
      pending: this.pending.length, oldestMs: this.pending.length ? Math.max(0, now - this.pending[0].now) : 0,
      offlineMs: this.online ? 0 : Math.max(0, now - this.offlineSince), v: this.v,
    };
  }
}
