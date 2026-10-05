// Server timing (qa2 SV-02): where an action's time goes on the server, reported in /api/status `perf`, so a slow
// "ack" seen by a client can be split into server work, output coalescing and event-loop stalls without a profiler.
//
//   actMs      engine.act per player intent: the due system actions it runs first, the rule, the journal append and
//              the broadcast (serialization + queueing); synchronous, so this IS the event-loop time of one act
//   slowActs   the SLOW_KEPT slowest acts since boot with their type
//   outWaitMs  per flushed output batch: how long its oldest frame waited in the connection's Outbox (the tick
//              coalescing, TICK_MS, plus anything that blocked the loop meanwhile)
//   dueMs      a scheduler wake-up (time-driven system actions: rollover, weekly systems, Golden Hour...)
//   loopMs     event-loop delay (perf_hooks.monitorEventLoopDelay, 10 ms resolution): p99/max show stalls of ANY
//              origin, a snapshot or a GC included
//   snapshot   the synchronous cut (serialize + journal rotation, blocks the loop) and the asynchronous write
// Each ring keeps the newest RING samples; the summaries are in milliseconds with one decimal. Cost: a
// performance.now() pair per act and per flush.
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

export const RING = 2048;
const r1 = (x) => Math.round(x * 10) / 10;

/** A fixed-size ring of numbers with percentile summaries. */
export class Ring {
  constructor(n = RING) {
    this.buf = new Float64Array(n);
    this.n = 0;               // samples ever added
    this.max = 0;             // max since boot
  }

  add(x) {
    if (!(x >= 0)) return;
    this.buf[this.n % this.buf.length] = x;
    this.n++;
    if (x > this.max) this.max = x;
  }

  /** { n, p50, p90, p99, max (of the kept samples), maxEver } or { n: 0 }. */
  summary() {
    const k = Math.min(this.n, this.buf.length);
    if (!k) return { n: 0 };
    const s = Array.from(this.buf.subarray(0, k)).sort((a, b) => a - b);
    const q = (p) => r1(s[Math.min(k - 1, Math.floor(p * k))]);
    return { n: this.n, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: r1(s[k - 1]), maxEver: r1(this.max) };
  }
}

/** Slowest acts kept with their type (`perf.slowActs`). */
export const SLOW_KEPT = 8;

export class Perf {
  constructor({ loop = true } = {}) {
    this.act = new Ring();
    /** [{ type, ms, at }] the SLOW_KEPT slowest acts since boot, slowest first */
    this.slow = [];
    this.outWait = new Ring();
    this.due = new Ring();
    this.loop = null;
    if (loop) {
      try {
        this.loop = monitorEventLoopDelay({ resolution: 10 });
        this.loop.enable();
      } catch {
        this.loop = null;           // not available on this runtime: the other rings still work
      }
    }
  }

  /** Time fn() (synchronous) into `ring`; returns fn's result. */
  time(ring, fn) {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      ring.add(performance.now() - t0);
    }
  }

  /** Time one player act (engine.act) into `act` and keep it among the slowest when it is one. */
  timeAct(type, fn) {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      const ms = performance.now() - t0;
      this.act.add(ms);
      if (this.slow.length < SLOW_KEPT || ms > this.slow[this.slow.length - 1].ms) {
        this.slow.push({ type: String(type).slice(0, 32), ms: r1(ms), at: Date.now() });
        this.slow.sort((a, b) => b.ms - a.ms);
        this.slow.length = Math.min(this.slow.length, SLOW_KEPT);
      }
    }
  }

  loopSummary() {
    const h = this.loop;
    if (!h || !h.count) return { n: 0 };
    const ms = (ns) => r1(ns / 1e6);
    return { n: h.count, p50: ms(h.percentile(50)), p90: ms(h.percentile(90)), p99: ms(h.percentile(99)), max: ms(h.max) };
  }

  /** The /api/status `perf` block. `snap`: the persistence timings (Persist.stats.timing). */
  status(snap = null) {
    return { actMs: this.act.summary(), slowActs: this.slow.slice(), outWaitMs: this.outWait.summary(), dueMs: this.due.summary(),
      loopMs: this.loopSummary(), ...(snap ? { snapshot: snap } : {}) };
  }

  stop() {
    if (this.loop) this.loop.disable();
  }
}
