// Per-connection output queue (lane brief item 1): strict order, per-tick coalescing, back-pressure.
//
// Every server message to a connection goes through its Outbox, so the connection sees one ordered stream:
//   - Coalescing: what is queued within one server tick goes out together. A client that announced
//     caps ['b'] in its hello gets ONE `b` frame { t: 'b', list: [...] } per tick; any other client gets the same
//     messages as separate frames, corked into one socket write. An idle connection is flushed at once
//     (setImmediate: the frames read in this I/O turn are batched, nothing waits); a busy one at most once per
//     TICK_MS (16 ms, one animation frame), so the added latency is bounded by one tick.
//   - Urgent messages (pong, welcome) flush now: a pong that waited a tick would skew the clock estimate.
//   - Back-pressure (the client stopped reading: Wi-Fi stall, laptop lid): above SOFT bytes of unsent data the
//     droppable traffic is HELD and MERGED (presence keeps the newest row per player, a build ghost the newest
//     frame per player); deltas, rejections and acks are never dropped or reordered. Above HARD bytes the
//     connection is closed (CLOSE.OVERFLOW): its client reconnects and receives a fresh welcome, which is cheaper
//     than queueing an unbounded backlog of deltas it cannot read.
import { performance } from 'node:perf_hooks';
import { MSG, LIMITS } from '../shared/net/protocol.js';

export const SOFT_BYTES = 256 * 1024;
export const HARD_BYTES = 8 * 1024 * 1024;
/** While held traffic waits for the socket to drain, re-check this often. */
const RECHECK_MS = 50;

export class Outbox {
  /**
   * @param {{ readyState: number, bufferedAmount: number, send(s: string): void, _socket?: object }} ws
   * @param {{ batch?: boolean, tickMs?: number, soft?: number, hard?: number, onOverflow?: () => void,
   *   now?: () => number, onWait?: (ms: number) => void }} [o]
   *   onWait: called at every flush that writes frames, with how long the oldest non-urgent frame waited (server/perf.js)
   */
  constructor(ws, { batch = false, tickMs = LIMITS.TICK_MS, soft = SOFT_BYTES, hard = HARD_BYTES,
    onOverflow = () => {}, now = () => performance.now(), onWait = null } = {}) {
    Object.assign(this, { ws, batch, tickMs, soft, hard, onOverflow, now, onWait });
    /** when the oldest non-urgent frame still queued was pushed (null: none) */
    this.waitFrom = null;
    /** queue items: a JSON frame (string), or a placeholder for merged presence / a latest-wins ghost */
    this.q = [];
    this.pr = null;               // { kind: 'pr', ts, rows: Map<pid, row> } while a presence frame is pending
    this.ghosts = new Map();      // pid -> { kind: 'ghost', pid, s }
    this.handle = null;           // pending flush: { immediate } | { timeout }
    this.lastFlush = -Infinity;
    this.closed = false;
    this.frames = 0;              // frames written (tests and /api/status)
  }

  /** Queue one serialized message. */
  push(s, urgent = false) {
    if (this.closed) return;
    if (!urgent && this.waitFrom === null && this.onWait) this.waitFrom = this.now();
    this.q.push(s);
    this.schedule(urgent);
  }

  /** Merge presence rows ([pid, ...]) into the pending presence frame. */
  presence(ts, rows) {
    if (this.closed) return;
    if (!this.pr) {
      this.pr = { kind: 'pr', ts, rows: new Map() };
      this.q.push(this.pr);
    }
    this.pr.ts = ts;
    for (const r of rows) this.pr.rows.set(r[0], r);
    this.schedule(false);
  }

  /** Latest-wins build ghost of `pid`. */
  ghost(pid, s) {
    if (this.closed) return;
    const g = this.ghosts.get(pid);
    if (g) g.s = s;
    else {
      const item = { kind: 'ghost', pid, s };
      this.ghosts.set(pid, item);
      this.q.push(item);
    }
    this.schedule(false);
  }

  /** A player left: drop their held presence row and ghost, so nothing of theirs follows the `peer` offline. */
  forget(pid) {
    if (this.pr) this.pr.rows.delete(pid);
    const g = this.ghosts.get(pid);
    if (g) { g.s = null; this.ghosts.delete(pid); }
  }

  schedule(urgent) {
    if (this.closed) return;
    if (this.handle) {
      // A pending tick (or immediate) flush covers this item, unless it is urgent; a re-check for held traffic
      // must not delay a delta, so it is replaced by a normal tick flush.
      if (this.handle.immediate || (!urgent && !this.handle.recheck)) return;
      clearTimeout(this.handle.timeout);
      this.handle = null;
    }
    const wait = urgent ? 0 : this.lastFlush + this.tickMs - this.now();
    if (wait <= 0) this.handle = { immediate: setImmediate(() => this.flush()) };
    else this.handle = { timeout: setTimeout(() => this.flush(), Math.ceil(wait)) };
  }

  flush() {
    this.handle = null;
    if (this.closed) return;
    const ws = this.ws;
    if (ws.readyState !== 1) {          // closing: nothing more can be delivered; close() follows
      this.q = [];
      this.waitFrom = null;
      return;
    }
    const buffered = ws.bufferedAmount;
    if (buffered > this.hard) {
      this.close();
      this.onOverflow(buffered);
      return;
    }
    const pressured = buffered > this.soft;
    const out = [];
    const held = [];
    for (const it of this.q) {
      if (typeof it === 'string') out.push(it);
      else if (pressured) held.push(it);
      else if (it.kind === 'pr') {
        if (it.rows.size) out.push(JSON.stringify({ t: MSG.PRESENCE, ts: it.ts, list: [...it.rows.values()] }));
        this.pr = null;
      } else {
        if (it.s) out.push(it.s);
        this.ghosts.delete(it.pid);
      }
    }
    this.q = held;
    if (held.length) this.handle = { timeout: setTimeout(() => this.flush(), RECHECK_MS), recheck: true };
    if (!out.length) return;
    this.lastFlush = this.now();
    if (this.waitFrom !== null) {
      const waited = this.lastFlush - this.waitFrom;
      this.waitFrom = null;
      try { this.onWait(waited); } catch { /* a metric never breaks delivery */ }
    }
    // This runs from a timer: a throw here would be uncaught and stop the server. A socket that cannot take a
    // frame is dead; its 'close' event does the bookkeeping.
    try {
      if (this.batch && out.length > 1) {
        ws.send(`{"t":"${MSG.BATCH}","list":[${out.join(',')}]}`);
        this.frames++;
        return;
      }
      const sock = ws._socket;
      if (out.length > 1 && sock && typeof sock.cork === 'function') sock.cork();
      try {
        for (const s of out) { ws.send(s); this.frames++; }
      } finally {
        if (out.length > 1 && sock && typeof sock.uncork === 'function') sock.uncork();
      }
    } catch {
      this.close();
      try { ws.terminate(); } catch { /* already gone */ }
    }
  }

  close() {
    this.closed = true;
    this.waitFrom = null;
    if (this.handle) {
      if (this.handle.immediate) clearImmediate(this.handle.immediate);
      else clearTimeout(this.handle.timeout);
      this.handle = null;
    }
    this.q = [];
    this.pr = null;
    this.ghosts.clear();
  }
}
