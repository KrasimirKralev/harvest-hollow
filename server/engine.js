// The authoritative engine (tech-architecture §3.3): owns the farm in memory and applies every action,
// player or system, strictly in order through the shared runAction(). Single-threaded and with no await
// inside, so two players can never race inside the server.
//
// Pipeline per accepted action: runAction -> journal.append (before broadcast) -> v++ -> onDelta(d)
// Rejections go back to the sender only. Nothing changes the replicated state outside this pipeline.
// A failed append rolls the action back and answers INTERNAL (review-m0 M6): never half-committed.
//
// Journal line: { v, now, pid, cid, seq, type, args, ext, grace, h, srv? }
//   ext    the server-observed facts the action was decided with (server/together.js documents the shape)
//   grace  the readiness grace the action was decided with (replay uses it, not today's config)
//   h      CONTENT_HASH (content + config + RULES_VERSION) the action was accepted under (review-m0 #10)
//   srv    server-private facts that must survive a crash with the action (the token hash of a `_join`,
//          review-m0 H1). Journaled, never broadcast.
//
// System actions due by time (tech §15.1) run in runDue(): before every player action, before every welcome,
// at boot (catch-up after downtime) and from the scheduler's timer. A due action that is REJECTED (a rules bug)
// would otherwise be retried before every player action and make the scheduler spin at 0 ms: it is logged once,
// written to incidents/, and backed off for STUCK_MS before the next attempt.
import { runAction, makeCtx, SERVER_GRACE_MS } from '../shared/rules/index.js';
import { dueSystemActions, nextSystemDueAt } from '../shared/rules/system.js';
import { validateState } from '../shared/rules/state.js';
import { CONTENT_HASH } from '../shared/content/index.js';
import { MSG, ERR } from '../shared/net/protocol.js';

/** Dedupe records of cids with no live socket are kept this long (review-m0 #4: about 50 bytes each). */
export const CID_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A due system action that keeps failing is retried this often (tech §15.1 hot-loop guard). */
export const STUCK_MS = 60_000;
/** runDue() repeats while system actions make further ones due (a rollover that refills orders...). */
export const MAX_DUE_PASSES = 8;
/** Rejections remembered per cid, so a `rej` lost in a disconnect still reaches the player (review-m0 L2). */
const REJECTS_KEPT = 32;
/** A rejection names the partner who acted on one of its targets this recently ("Mia got there first"). */
export const TOUCH_MS = 10_000;
/** Above this many remembered targets, expired ones are dropped. */
const TOUCHED_MAX = 4096;
/** Dev (HH_DEV=1): the whole-state check runs this long after the first unchecked commit (checkSoon). */
export const DEV_CHECK_MS = 50;
/** Targets read from one action (a drag stroke's `ids` is schema-capped far below this). */
const TOUCH_IDS_MAX = 256;

/** The object ids an action names: `args.id` and `args.ids[]` (strings only; never throws on garbage). */
function targetIds(args) {
  const out = [];
  if (!args || typeof args !== 'object') return out;
  if (typeof args.id === 'string') out.push(args.id);
  if (Array.isArray(args.ids)) {
    for (const id of args.ids.slice(0, TOUCH_IDS_MAX)) if (typeof id === 'string') out.push(id);
  }
  return out;
}

const NO_FACTS = Object.freeze({
  player: () => ({ ext: {} }),
  committed() {},
  system: () => ({}),
});

export class Engine {
  /**
   * @param {object} o
   * @param {object} o.state       replicated state (mutated in place)
   * @param {{ clock: object, clients: object, auth: object }} o.server  private sidecar (persisted, never sent)
   * @param {{ now(): number, observe?(t: number): void }} o.clock
   * @param {{ append(line: object): void } | null} [o.journal]
   * @param {(delta: object) => void} [o.onDelta]  broadcast hook
   * @param {boolean} [o.dev]      validate the whole state shortly after every commit (checkSoon, DEV_CHECK_MS)
   * @param {Console} [o.log]
   * @param {{ dueSystemActions: Function, nextSystemDueAt: Function }} [o.due]  injectable for tests
   */
  constructor({ state, server, clock, journal = null, onDelta = () => {}, dev = false, log = console,
    due = { dueSystemActions, nextSystemDueAt } }) {
    this.state = state;
    this.server = server;
    this.clock = clock;
    this.journal = journal;
    this.onDelta = onDelta;
    this.dev = dev;
    this.log = log;
    this.due = due;
    this.dirty = false;
    /** true after a journal append failed: surfaced in /api/status (review-m0 M6) */
    this.degraded = false;
    /** objectId -> { pid, at } of the newest accepted player action on it (args.id and args.ids): in memory only,
     *  makes rejection toasts friendly ("Mia got there first") */
    this.touched = new Map();
    /** cid -> [{ seq, code, by? }]: the newest rejections, in memory only (welcome.rejected) */
    this.rejects = new Map();
    /** system type -> retry-not-before (game ms) after a rejection (hot-loop guard) */
    this.stuck = new Map();
    /** server-observed facts for ctx.ext (server/together.js); none in unit tests unless set */
    this.facts = NO_FACTS;
    /** keep a copy of something a human must look at (persist.incident) */
    this.incident = () => {};
    this.onCommit = () => {};
    this.running = false;
  }

  get v() { return this.state.meta.version; }

  /**
   * The dedupe record of a client id (created on its first hello, refreshed on every hello and close).
   * Returns null when the cid is already bound to ANOTHER player: a record is never overwritten, because
   * resetting lastSeq to 0 would let re-sent actions run twice (review-m0 #4).
   */
  client(cid, pid, now) {
    const c = this.server.clients;
    if (!Object.hasOwn(c, cid)) c[cid] = { pid, lastSeq: 0, seenAt: now };
    else if (c[cid].pid !== pid) return null;
    if (now > c[cid].seenAt) c[cid].seenAt = now;
    return c[cid];
  }

  /** True when a dedupe record exists for this cid. */
  knows(cid) { return Object.hasOwn(this.server.clients, cid); }

  /** Drop dedupe records not seen for CID_TTL_MS, never those of a connected cid (review-m0 M1). */
  pruneClients(now, live = new Set()) {
    for (const [cid, c] of Object.entries(this.server.clients)) {
      if (!live.has(cid) && now - c.seenAt > CID_TTL_MS) {
        delete this.server.clients[cid];
        this.rejects.delete(cid);
      }
    }
  }

  /** The remembered rejections of a cid (sent in `welcome.rejected`). */
  rejectedOf(cid) { return (this.rejects.get(cid) || []).slice(); }

  /**
   * A player intent. Returns the message for the sender only ({t:'rej'} or {t:'ack'}), or null when the
   * action was accepted (its delta went to everyone through onDelta) or the frame was garbage.
   * @param {{ pid: string, cid: string }} who
   * @param {{ seq: number, type: string, args: object }} act
   */
  act(who, { seq, type, args }) {
    if (!Number.isSafeInteger(seq) || seq < 1) return null;
    const c = Object.hasOwn(this.server.clients, who.cid) ? this.server.clients[who.cid] : null;
    if (!c || c.pid !== who.pid) return { t: MSG.REJ, seq, code: ERR.NOT_JOINED };
    if (seq <= c.lastSeq) return { t: MSG.ACK, seq, v: this.v };   // duplicate after a reconnect
    this.runDue();
    const now = this.clock.now();
    const facts = this.facts.player(who.pid, { type, args }, this.state, now);
    const ctx = makeCtx(this.state, { now, pid: who.pid, cid: who.cid, seq, ext: facts.ext, grace: SERVER_GRACE_MS });
    const r = runAction(this.state, { type, args }, ctx);
    c.lastSeq = seq;          // advanced even on reject, so a re-sent reject is not re-run
    if (now > c.seenAt) c.seenAt = now;
    if (r.ok && this.commit(r.tx, { now, pid: who.pid, cid: who.cid, seq, type, args, ext: ctx.ext, grace: ctx.grace })) {
      this.facts.committed(who.pid, { type, args }, facts, now);
      return null;
    }
    const code = r.ok ? ERR.INTERNAL : r.code;
    if (code === ERR.INTERNAL && r.err) {
      this.log.error('rule threw', { type, pid: who.pid, cid: who.cid, seq, args: JSON.stringify(args) }, r.err);
    }
    const rej = { t: MSG.REJ, seq, code };
    const by = this.lastToucher(args, now, who.pid);
    if (by) rej.by = by;
    this.remember(who.cid, rej);
    return rej;
  }

  remember(cid, rej) {
    let list = this.rejects.get(cid);
    if (!list) this.rejects.set(cid, (list = []));
    list.push({ seq: rej.seq, code: rej.code, ...(rej.by ? { by: rej.by } : {}) });
    if (list.length > REJECTS_KEPT) list.shift();
  }

  /**
   * Run a server-only action ('_join', '_seen', ...). Returns { ok, code? }.
   * @param {string} type @param {object} args @param {object} [ext]
   * @param {{ auth?: object } | null} [srv]  server-private facts journaled with the line (never broadcast)
   */
  system(type, args, ext = {}, srv = null) {
    const now = this.clock.now();
    const seq = this.v + 1;              // system ids are sys.<v>.<i>
    const ctx = makeCtx(this.state, { now, pid: 'sys', cid: 'sys', seq, ext, grace: SERVER_GRACE_MS });
    const r = runAction(this.state, { type, args }, ctx);
    if (!r.ok) {
      this.log.error('system action rejected', { type, code: r.code, args: JSON.stringify(args) }, r.err || '');
      return { ok: false, code: r.code, err: r.err };
    }
    if (!this.commit(r.tx, { now, pid: 'sys', cid: 'sys', seq, type, args, ext: ctx.ext, grace: ctx.grace, srv })) {
      return { ok: false, code: ERR.INTERNAL };
    }
    return { ok: true };
  }

  /**
   * Run every due time-driven system action, in the rules' order, until none is due (catch-up after downtime is
   * a single pass of each, by the rules' design). Deterministic and idempotent: calling it twice at the same
   * time does nothing the second time. Re-entrant calls (a system action committing during runDue) are no-ops.
   * @returns {number} actions committed
   */
  runDue() {
    if (this.running) return 0;
    this.running = true;
    let committed = 0;
    try {
      const doneThisCall = new Set();
      for (let pass = 0; pass < MAX_DUE_PASSES; pass++) {
        const now = this.clock.now();
        const due = this.dueList(now);
        if (!due.length) return committed;
        let progressed = false;
        for (const a of due) {
          if (doneThisCall.has(a.type)) {
            // It succeeded and is STILL due: it does not clear its own condition (a rules bug). Back off, or every
            // player action would journal another copy of it.
            this.markStuck(a, { code: 'STILL_DUE' }, now);
            continue;
          }
          const r = this.system(a.type, a.args || {}, this.facts.system(now));
          if (r.ok) {
            committed++;
            progressed = true;
            doneThisCall.add(a.type);
            this.stuck.delete(a.type);
          } else {
            this.markStuck(a, r, now);
          }
        }
        if (!progressed) return committed;
      }
      this.log.error('system actions still due after the pass limit', { passes: MAX_DUE_PASSES });
      return committed;
    } finally {
      this.running = false;
    }
  }

  /**
   * What the server knows beyond the state when it asks the rules what is due: `{ online }` (sorted pids online,
   * grace included), or {} without presence facts. Passed as an optional third argument to dueSystemActions and
   * nextSystemDueAt, so time-driven rules that need someone present (Golden Hour) can wait for them (SV-01).
   */
  dueEnv(now) {
    const f = this.facts.system(now);
    return f && Array.isArray(f.online) ? { online: f.online } : {};
  }

  /** dueSystemActions(), without types that are backing off; [] when the rules throw (logged once). */
  dueList(now) {
    let list;
    try {
      list = this.due.dueSystemActions(this.state, now, this.dueEnv(now));
    } catch (err) {
      if (!this.dueBroken) {
        this.dueBroken = true;
        this.log.error('dueSystemActions threw; time-driven system actions are paused', err);
        this.incident('due-threw.json', { at: now, v: this.v, error: String(err && err.stack) });
      }
      return [];
    }
    this.dueBroken = false;
    if (!Array.isArray(list)) return [];
    return list.filter((a) => a && typeof a.type === 'string' && !(this.stuck.get(a.type) > now));
  }

  markStuck(a, r, now) {
    const first = !this.stuck.has(a.type);
    this.stuck.set(a.type, now + STUCK_MS);
    this.log.error('due system action did not clear; retrying later', { type: a.type, code: r.code, retryInS: STUCK_MS / 1000 });
    if (first) {
      this.incident(`system-stuck-${a.type}.json`, { at: now, v: this.v, type: a.type, args: a.args || {}, code: r.code,
        error: r.err ? String(r.err.stack || r.err) : null });
    }
  }

  /** Earliest game time at which a backed-off system type may be retried (Infinity when none is stuck). */
  stuckUntil() {
    let t = Infinity;
    for (const u of this.stuck.values()) if (u < t) t = u;
    return t;
  }

  /** Journal, then publish. Returns false (and rolls the action back) when the journal append fails. */
  commit(tx, { now, pid, cid, seq, type, args, ext, grace, srv = null }) {
    const v = this.v + 1;
    if (this.journal) {
      const line = { v, now, pid, cid, seq, type, args, ext, grace, h: CONTENT_HASH };
      if (srv) line.srv = srv;
      try {
        this.journal.append(line);
      } catch (err) {
        tx.rollback();                  // nothing half-applied: no state change, no `v`, no delta
        this.degraded = true;
        this.log.error('journal append failed; action rolled back', { type, code: err.code || err.message });
        return false;
      }
    }
    this.state.meta.version = v;
    if (srv && srv.auth) Object.assign(this.server.auth, srv.auth);
    if (this.dev) this.checkSoon(type, v);
    if (pid !== 'sys') this.touch(args, pid, now);
    this.dirty = true;
    this.onDelta({ t: MSG.DELTA, v, by: pid, cid, seq, now, ops: tx.ops, ev: tx.events });
    this.onCommit();
    return true;
  }

  /**
   * Dev only (HH_DEV=1): validate the whole state DEV_CHECK_MS after a commit, naming every action committed since
   * the last check. Validating inside every commit cost an L24 farm ~8 ms per action, about half of the server's
   * time per act, and sat in front of every delta the QA runs (all HH_DEV=1) measured (qa2 SV-02).
   */
  checkSoon(type, v) {
    (this.unchecked ??= []).push(`${type}@v${v}`);
    if (this.checkTimer) return;
    // After the turn AND after the Outbox tick (a busy connection flushes from a TICK_MS timer, which a check queued
    // with setImmediate would run in front of): a burst of acts is checked once, behind its deltas.
    this.checkTimer = setTimeout(() => this.checkNow(), DEV_CHECK_MS);
    this.checkTimer.unref?.();
  }

  /** Dev: validate now (tests call it directly); logs `invariant broken` with the actions since the last check. */
  checkNow() {
    clearTimeout(this.checkTimer);
    this.checkTimer = null;
    const acts = (this.unchecked ?? []).splice(0);
    if (!acts.length) return [];
    const problems = validateState(this.state);
    if (problems.length) this.log.error('invariant broken', { after: acts.join(', '), v: this.v, problems: problems.join('; ') });
    return problems;
  }

  /** Remember who acted on each target of an accepted action: `args.id` and every id of a stroke's `args.ids`. */
  touch(args, pid, now) {
    for (const id of targetIds(args)) this.touched.set(id, { pid, at: now });
    // Bounded: entries only matter for TOUCH_MS; sold and removed objects must not pile up for the process lifetime.
    if (this.touched.size > TOUCHED_MAX) {
      for (const [id, t] of this.touched) if (now - t.at >= TOUCH_MS) this.touched.delete(id);
    }
  }

  /**
   * The other player who most recently acted on any target of `args` within TOUCH_MS, or undefined. A rejected
   * click or stroke then says "Mia got there first" instead of an error (GDD §6.3).
   */
  lastToucher(args, now, self) {
    let best;
    for (const id of targetIds(args)) {
      const t = this.touched.get(id);
      if (t && t.pid !== self && now - t.at < TOUCH_MS && (!best || t.at > best.at)) best = t;
    }
    return best ? best.pid : undefined;
  }

  /**
   * Re-run one journal line at boot with its journaled now/pid/cid/seq/ext/grace (deterministic replay).
   * Throws when the line does not apply; the caller stops replaying and quarantines the journal.
   */
  replay(line) {
    if (line.v !== this.v + 1) throw new Error(`journal gap: expected v${this.v + 1}, got v${line.v}`);
    const grace = Number.isSafeInteger(line.grace) ? line.grace : SERVER_GRACE_MS;   // lines before review-m0
    const ctx = makeCtx(this.state, { now: line.now, pid: line.pid, cid: line.cid, seq: line.seq, ext: line.ext || {}, grace });
    const r = runAction(this.state, { type: line.type, args: line.args }, ctx);
    if (!r.ok) throw new Error(`journal v${line.v} (${line.type}) failed on replay: ${r.code}${r.err ? ` ${r.err.message}` : ''}`);
    this.state.meta.version = line.v;
    if (line.srv && line.srv.auth) Object.assign(this.server.auth, line.srv.auth);
    if (line.pid !== 'sys') {
      const c = this.client(line.cid, line.pid, line.now);
      if (c && line.seq > c.lastSeq) c.lastSeq = line.seq;
    }
    if (this.clock.observe) this.clock.observe(line.now);
  }
}
