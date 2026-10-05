// Client estimate of the server clock (FROZEN CONTRACT, tech-architecture §4.2). Cristian/NTP style: keep
// the sample with the smallest round trip, whose error is bounded by +-(RTT - RTTmin)/2. Pure: timestamps
// are parameters (performance.now() on the client), never read here.

export const JUMP_MS = 250;      // a better estimate this far off replaces the offset at once
export const SLEW = 0.2;         // otherwise move 20 % of the way per sample (no visible timer jumps)
export const WINDOW = 8;         // samples kept

export class ClockSync {
  constructor() {
    /** @type {Array<{rtt: number, offset: number}>} */
    this.samples = [];
    /** server epoch ms = perfNow + offset; null until seeded */
    this.offset = null;
    this.rtt = null;
  }

  /** Coarse seed from `welcome.serverNow` before the first pong. */
  seed(serverNow, perfNow) {
    if (this.offset === null) this.offset = serverNow - perfNow;
  }

  /**
   * Add one ping sample.
   * @param {number} c0 perf time at send   @param {number} s server epoch at receipt   @param {number} c1 perf time at pong
   */
  add(c0, s, c1) {
    const rtt = Math.max(0, c1 - c0);
    const sample = { rtt, offset: s - (c0 + c1) / 2 };
    const prev = this.samples.at(-1);
    // Two consecutive samples that agree with each other but not with the estimate: the clock base moved (an
    // OS suspend froze performance.now(), the server stepped). Forget the older samples instead of trusting
    // their lower RTT for up to WINDOW more pings (review-m0 L1).
    if (prev && this.offset !== null && Math.abs(sample.offset - this.offset) > JUMP_MS
      && Math.abs(sample.offset - prev.offset) <= (sample.rtt + prev.rtt) / 2 + 5) this.samples = [prev];
    this.samples.push(sample);
    if (this.samples.length > WINDOW) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.rtt = best.rtt;
    if (this.offset === null || Math.abs(best.offset - this.offset) > JUMP_MS) this.offset = best.offset;
    else this.offset += (best.offset - this.offset) * SLEW;
  }

  /** Forget samples (after a server time warp or reconnect) but keep the offset until a new sample. */
  reset() { this.samples = []; }

  /** Estimated server epoch ms at perf time `perfNow`, rounded to an integer (rules use integer ms). */
  serverNow(perfNow) { return Math.round(perfNow + (this.offset ?? 0)); }
}
