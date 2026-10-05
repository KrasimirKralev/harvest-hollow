// Authoritative server clock (tech-architecture §4.1). Epoch ms, monotonic: game time never runs backwards
// even if the wall clock does (NTP, manual change). `sidecar` is the persisted server.clock object
// ({ lastNow, devOffset }), so the guard and the offset survive a restart.
//
// Game time = wall + devOffset. devOffset is the sum of dev time warps and of absorbed backward wall steps.
// It is KEPT on a production boot (review-m0 M7): zeroing it under a save whose timestamps were written with it
// froze every timer and the partner's avatar for the warped duration. A production server refuses new warps.

/** A backward wall step larger than this is absorbed into the offset instead of freezing game time. */
export const STEP_MS = 5000;

export class ServerClock {
  /**
   * @param {{ lastNow: number, devOffset?: number }} sidecar
   * @param {{ dev?: boolean, wall?: () => number, log?: Console }} [opts]
   */
  constructor(sidecar, { dev = false, wall = Date.now, log = console } = {}) {
    this.c = sidecar;
    if (!Number.isFinite(this.c.lastNow)) this.c.lastNow = 0;
    if (!Number.isSafeInteger(this.c.devOffset)) this.c.devOffset = 0;
    this.dev = dev;
    this.wall = wall;
    this.log = log;
    if (!dev && this.c.devOffset !== 0) {
      log.warn(`\x1b[33mgame time runs ${this.c.devOffset} ms ahead of the wall clock (a dev warp or a clock step `
        + 'saved in this data dir); kept so timers continue smoothly\x1b[0m');
    }
  }

  /** Current game time (integer epoch ms). */
  now() {
    const t = Math.floor(this.wall()) + this.c.devOffset;
    const last = this.c.lastNow;
    if (t < last) {
      // Small steps back (NTP slew, jitter) hold game time for their length. A real step (a manual change, an
      // RTC that resynced after resume) is absorbed, so game time continues from where it was (review-m0 M7).
      if (last - t > STEP_MS) {
        this.c.devOffset += last - t;
        this.log.warn(`wall clock went back ${last - t} ms; game time continues from where it was`);
      }
      return last;
    }
    this.c.lastNow = t;
    return t;
  }

  /** Dev-only time warp (HH_DEV=1): jump game time forward by ms. */
  warp(ms) {
    if (!this.dev) throw new Error('warp is dev-only');
    if (!Number.isSafeInteger(ms) || ms <= 0) throw new Error('warp ms must be a positive integer');
    this.c.devOffset += ms;
    return this.now();
  }

  /** Raise the monotonic floor (journal replay restores it). */
  observe(t) { if (t > this.c.lastNow) this.c.lastNow = t; }
}
