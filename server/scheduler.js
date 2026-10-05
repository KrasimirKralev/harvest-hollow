// Timers (tech §15.1, §5.3; lane brief item 2): the one system-action timer, autosave, journal fdatasync.
//
// System actions: the rules say WHAT is due (dueSystemActions) and WHEN the list next grows (nextSystemDueAt);
// the scheduler sets ONE setTimeout to that moment, never polling faster than needed. It re-arms after every
// committed action (debounced to once per event-loop turn, so a 90 acts/s drag stroke re-arms ~once per frame),
// at boot right after the catch-up runDue(), and after a dev warp.
//   - The delay is capped at MAX_DELAY (an hour): setTimeout overflows above 2^31-1 ms (tech §14) and a capped
//     timer also re-reads the rules' answer now and then.
//   - setTimeout runs on the monotonic clock, game time on the wall clock: after a laptop suspend or a forward
//     wall step the timer would fire late. A once-per-second check (the journal-sync tick that runs anyway)
//     compares game time with the armed due time and fires when it has passed.
//   - When something is still due right after runDue(), it is a stuck type backing off in the engine
//     (engine.STUCK_MS): the timer waits for the back-off instead of spinning at 0 ms. If nothing is stuck, the
//     rules' two functions disagree at a boundary: re-check in a second (logged once), never an hour later.
//   - The midnight rollover uses the farm's zone (state.meta.tz = HH_TZ, default the machine's zone).
//
// Autosave: every snapshotMs when something changed, and also while anyone is online (SV-01, SV-07): each snapshot
// writes `server.live = { at, online, together }` into the private sidecar, so after a crash the boot knows who was
// here until when (lastSeenAt) and how much together time was not paid yet.
export const MAX_DELAY = 60 * 60 * 1000;
/** Never re-arm sooner than this for a type that is still due after a run (it is backing off). */
const MIN_STUCK_DELAY = 1000;

export class Scheduler {
  /**
   * @param {object} o
   * @param {() => ({ online: string[], together?: object } | null)} [o.live]  server-observed facts for the sidecar
   */
  constructor({ engine, persist, clock, cfg, log = console, live = null, perf = null }) {
    Object.assign(this, { engine, persist, clock, cfg, log, live, perf });
    this.timer = null;
    this.intervals = [];
    this.armQueued = false;
    /** game time at which the armed timer is due (null when not armed) */
    this.dueAt = null;
    this.fires = 0;
  }

  /** A consistent cut of everything the snapshot holds. */
  cut() {
    if (this.live) {
      try {
        const live = this.live();
        if (live) this.engine.server.live = { at: this.clock.now(), ...live };
      } catch (err) {
        this.log.error('live facts for the snapshot failed', err);
      }
    }
    return { state: this.engine.state, server: this.engine.server, version: this.engine.v };
  }

  /** True while a player is online: their presence is worth a snapshot even when nothing changed. */
  someoneHere() {
    if (!this.live) return false;
    try {
      const l = this.live();
      return Boolean(l && Array.isArray(l.online) && l.online.length);
    } catch {
      return false;
    }
  }

  async save() {
    this.engine.dirty = false;
    try {
      await this.persist.snapshot(() => this.cut());
    } catch (err) {
      this.engine.dirty = true;
      this.log.error('snapshot failed', err);
    }
  }

  /** The next due time per the rules, sanitized (NaN, a non-number or a throw count as "nothing due"). */
  nextDue(now) {
    let t;
    try {
      t = this.engine.due.nextSystemDueAt(this.engine.state, now, this.engine.dueEnv(now));
    } catch (err) {
      if (!this.nextBroken) this.log.error('nextSystemDueAt threw; re-checking hourly', err);
      this.nextBroken = true;
      return now + MAX_DELAY;
    }
    this.nextBroken = false;
    return typeof t === 'number' && !Number.isNaN(t) ? t : Infinity;
  }

  /** Re-arm once the current event-loop turn is done (never inside a commit). */
  requestArm() {
    if (this.armQueued || this.stopped) return;
    this.armQueued = true;
    setImmediate(() => {
      this.armQueued = false;
      if (!this.stopped) this.arm();
    });
  }

  arm() {
    clearTimeout(this.timer);
    this.timer = null;
    let now = this.clock.now();
    let due = this.nextDue(now);
    if (due <= now) {
      // Due already (an action made something due at once, or the timer was late): run it now, then look again.
      this.engine.runDue();
      now = this.clock.now();
      due = this.nextDue(now);
      if (due <= now) {
        // Still due: a type backing off in the engine waits for its back-off. Otherwise the rules' two answers
        // disagree for a moment (`>=` in one, `>` in the other): look again in a second, never an hour later.
        const stuck = this.engine.stuckUntil();
        if (stuck === Infinity && !this.disagree) {
          this.disagree = true;
          this.log.warn('nextSystemDueAt says due but dueSystemActions has nothing; re-checking every second');
        }
        due = stuck === Infinity ? now + MIN_STUCK_DELAY : Math.max(now + MIN_STUCK_DELAY, Math.min(stuck, now + MAX_DELAY));
      } else {
        this.disagree = false;
      }
    }
    const delay = Math.min(Math.max(due - now, 0), MAX_DELAY);
    this.dueAt = now + delay;
    // +1 ms: Node timers may fire up to a millisecond early against the floored game clock, which would cost a
    // second wake-up for nothing.
    this.timer = setTimeout(() => this.fire(), delay ? delay + 1 : 0);
    this.timer.unref?.();
  }

  fire() {
    this.fires++;
    this.timer = null;
    this.dueAt = null;
    if (this.perf) this.perf.time(this.perf.due, () => this.engine.runDue());
    else this.engine.runDue();
    this.arm();
  }

  /** Once per second: durable journal, and the late-timer check (suspend, wall-clock step). */
  tick() {
    this.persist.syncTick();
    if (this.dueAt !== null && this.clock.now() >= this.dueAt) {
      clearTimeout(this.timer);
      this.fire();
    }
  }

  /** Boot: catch up on everything that came due while the server was off, then arm. */
  start() {
    this.stopped = false;
    const n = this.engine.runDue();
    if (n) this.log.info(`caught up on ${n} system action(s) that came due while the server was off`);
    this.arm();
    this.intervals.push(setInterval(() => this.tick(), 1000));
    this.intervals.push(setInterval(() => { if (this.engine.dirty || this.someoneHere()) this.save(); }, this.cfg.snapshotMs));
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.dueAt = null;
    for (const i of this.intervals) clearInterval(i);
    this.intervals = [];
  }
}
