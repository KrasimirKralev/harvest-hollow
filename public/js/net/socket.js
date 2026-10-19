// Reconnecting WebSocket with per-task act batching and the clock-sync ping loop (tech §3.7, §4.2, §4.6).
// Owned by the client-core lane.
//
//   const socket = new Socket({ url, clock, onMessage, onStatus, onOpen })
//   socket.connect()
//   onMessage(msg)          one call per server message; `b` batch frames (hello caps ['b']) are unpacked here,
//                           in order, so callers never see MSG.BATCH
//   socket.send(msg)        acts are coalesced into one `acts` frame per task and PACED to 90 % of the server's
//                           act bucket (LIMITS.BUCKETS.act): excess acts wait in the batch and go out as tokens
//                           refill, so a long drag-paint stroke is never answered RATE (review-m0 M2).
//                           Predictions stay instant; only the wire is paced. Frames are DROPPED while
//                           disconnected (the SyncStore re-sends pending actions after the next welcome)
//   socket.ping()           one clock sample now
//   socket.stop()           close for good, no reconnect (multi-farm mode: a private farm, a used-up invite)
//   close code CLOSE.MOD_RELOAD (4010, Harness Hollow): the farm moved into its own worker for its first mod; the
//                           socket reconnects at once and quietly ('reconnecting' only if it is not back within 3 s)
//   status: 'connecting' | 'open' | 'reconnecting'
//   liveness (release 1.0 M14, perf-a11y#1): a socket can die without a close (a phone moving from Wi-Fi to mobile
//                           data: no FIN, no RST), and the browser keeps it "open" until the OS gives up, many minutes
//                           later, with "Saving..." spinning. Every received frame stamps `lastRx`; a socket open with
//                           nothing received for DEAD_AFTER_MS is treated as closed (detached first, then the normal
//                           reconnect path: 'reconnecting', backoff, the store re-sends its pending actions after the
//                           next welcome). On `online` and when the page becomes visible it pings at once and expects
//                           an answer within PONG_DEADLINE_MS. A hidden page is never judged (its timers are throttled
//                           to a minute: a healthy link would look dead). A connect that never opens is abandoned after
//                           CONNECT_TIMEOUT_MS (a black-holed network). All of this starts at the welcome: before it the
//                           server says nothing but its answer to the hello (and ignores pings), a modded farm's worker
//                           on a loaded host can take a while to welcome, and a farmer may sit on the slot picker for
//                           minutes; judging that silence dropped a slow welcome every 22 s, for ever.
import { MSG, LIMITS, CLOSE } from '../../../shared/net/protocol.js';

/** A quiet reconnect (CLOSE.MOD_RELOAD) shows 'reconnecting' only after this long. */
export const QUIET_RECONNECT_MS = 3000;
/**
 * Silence (nothing received) after which an open socket is dead. The pings come every PING_EVERY_MS and each one is
 * answered, so two pings without an answer is a dead link; 2.2 pings and a check every LIVENESS_TICK_MS keep the
 * worst case (the link dies right after a frame arrived) inside the 25 s budget (release-scope §8), with one late pong
 * tolerated.
 */
export const DEAD_AFTER_MS = Math.round(2.2 * LIMITS.PING_EVERY_MS);
export const LIVENESS_TICK_MS = 1000;
/** After `online` or the page becoming visible: a ping, and this long for any answer. */
export const PONG_DEADLINE_MS = 5000;
/**
 * A socket still connecting after this long is abandoned and tried again (a black-holed network). Longer than the
 * slowest legitimate handshake: a multi-mode farm that moves into its worker for a mod is accepted only once its boot
 * test has run (server HH_MOD_BOOT_TIMEOUT_MS, 20 s by default), and giving up earlier would only restart that wait.
 */
export const CONNECT_TIMEOUT_MS = 45_000;

export class Socket {
  /**
   * @param {object} o
   * @param {string} o.url
   * @param {import('../../../shared/net/clock.js').ClockSync} o.clock
   * @param {(msg: object) => void} o.onMessage
   * @param {(status: string) => void} [o.onStatus]
   * @param {() => void} [o.onOpen]   send the hello here
   * @param {() => number} [o.now]     a monotonic clock in ms (tests); performance.now() by default
   */
  constructor({ url, clock, onMessage, onStatus = () => {}, onOpen = () => {}, now = () => performance.now() }) {
    Object.assign(this, { url, clock, onMessage, onStatus, onOpen, now });
    this.ws = null;
    this.status = 'connecting';
    this.attempt = 0;
    this.batch = [];
    this.flushQueued = false;
    this.pingTimer = null;
    this.burst = 0;
    const [rate, burst] = LIMITS.BUCKETS.act;
    this.pace = { rate: rate * 0.9, burst: Math.floor(burst * 0.9), tokens: Math.floor(burst * 0.9), at: this.now() };
    this.paceTimer = null;
    this.lastRx = this.now();
    this.liveTimer = null;
    this.deadline = null;
    this.connectTimer = null;
    this.welcomed = false;         // the current socket got its welcome: the liveness rules apply from then on
    // After a suspend performance.now() did not advance: drop the old samples and re-measure at once with a
    // burst, instead of trusting a stale offset for up to 8 pings (review-m0 L1). The socket may have died while
    // the page was hidden: the burst's first ping must be answered within PONG_DEADLINE_MS.
    // A hidden page's timers run once a minute at best (and not at all on a locked phone), so silence is only judged
    // while the page is visible: coming back, the silence so far does not count, and the first ping has 5 s.
    globalThis.document?.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.open && this.welcomed) {
        this.lastRx = this.now();
        this.clock.reset();
        this.startPings();
        this.expectAnswer();
      }
    });
    // the network came back (a new Wi-Fi, mobile data): the old socket is probably gone
    globalThis.addEventListener?.('online', () => {
      if (this.open && this.welcomed) { this.ping(); this.expectAnswer(); }
    });
  }

  get open() { return this.ws !== null && this.ws.readyState === WebSocket.OPEN; }

  connect() {
    if (this.stopped) return;      // a reconnect timer that outlived stop() (the close raced the farm's refusal)
    const ws = new WebSocket(this.url);
    this.ws = ws;
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.ws === ws && ws.readyState !== WebSocket.OPEN) this.lost(ws);
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
      this.lastRx = this.now();
      this.welcomed = false;
      this.watch();
      this.attempt = 0;
      clearTimeout(this.quietTimer);
      this.quietTimer = null;
      this.setStatus('open');
      this.clock.reset();
      this.onOpen();
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;  // a detached socket (declared dead) that spoke after all
      this.lastRx = this.now();
      if (this.deadline) { clearTimeout(this.deadline); this.deadline = null; }
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      // `b`: every server message of one server tick, in send order (hello caps ['b']). Unpacked here so the
      // rest of the client sees exactly the frames it would have seen one by one.
      const list = msg.t === MSG.BATCH && Array.isArray(msg.list) ? msg.list : [msg];
      for (const m of list) {
        if (!m || typeof m !== 'object') continue;
        // The clock sample is taken at receipt, never deferred to the next animation frame (main.js inbox).
        if (m.t === MSG.PONG) this.clock.add(m.c, m.s, performance.now());
        if (m.t === MSG.WELCOME) { this.welcomed = true; this.startPings(); }
        this.onMessage(m);
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.closed(e);
    };
    ws.onerror = () => {};
  }

  /**
   * The socket `ws` is dead without a close event (silence, an unanswered probe, a connect that never opened):
   * detach it first, so its late events change nothing, close it, then take the normal reconnect path.
   */
  lost(ws, why = 'silent') {
    if (this.ws !== ws) return;
    this.ws = null;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    try { ws.close(); } catch { /* already gone */ }
    if (why) console.warn(`socket: no answer from the server (${why}); reconnecting`);
    this.closed(null);
  }

  /** What every lost socket goes through: timers off, the batch dropped, then a reconnect (or a quiet one). */
  closed(e) {
    this.ws = null;
    this.welcomed = false;
    clearTimeout(this.pingTimer);
    clearTimeout(this.connectTimer);
    clearTimeout(this.deadline);
    this.connectTimer = null;
    this.deadline = null;
    this.unwatch();
    this.batch = [];             // the store re-sends every pending action after the next welcome
    if (this.stopped) return;    // stop(): the farm said no (multi mode's private page), knocking again changes nothing
    if (e && e.code === CLOSE.MOD_RELOAD) {
      // the farm reloads with its new mod: back at once, and the banner only if that takes a while
      clearTimeout(this.quietTimer);
      this.quietTimer = setTimeout(() => { this.quietTimer = null; if (!this.open) this.setStatus('reconnecting'); }, QUIET_RECONNECT_MS);
      setTimeout(() => this.connect(), 50);
      return;
    }
    this.setStatus('reconnecting');
    const steps = LIMITS.RECONNECT_MS;
    const delay = steps[Math.min(this.attempt++, steps.length - 1)];
    setTimeout(() => this.connect(), delay);
  }

  /** The liveness check while open: nothing received for DEAD_AFTER_MS is a dead socket. */
  watch() {
    this.unwatch();
    this.liveTimer = setInterval(() => {
      if (globalThis.document?.visibilityState === 'hidden') return;   // see the constructor: judged while visible only
      if (this.open && this.welcomed && this.now() - this.lastRx > DEAD_AFTER_MS) this.lost(this.ws, 'silent');
    }, LIVENESS_TICK_MS);
  }

  unwatch() {
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = null;
  }

  /** Any frame within PONG_DEADLINE_MS, or the socket is dead (after `online` / becoming visible). */
  expectAnswer() {
    if (!this.open || this.deadline) return;
    const ws = this.ws;
    this.deadline = setTimeout(() => {
      this.deadline = null;
      if (this.ws === ws) this.lost(ws, 'no pong'); // i18n-ok: a console reason, never shown
    }, PONG_DEADLINE_MS);
  }

  setStatus(s) {
    this.status = s;
    this.onStatus(s);
  }

  /** Send a frame. Acts batch per task so a drag-paint stroke is one frame. */
  send(msg) {
    if (msg.t === MSG.ACT) {
      this.batch.push({ seq: msg.seq, type: msg.type, args: msg.args, ...(Number.isFinite(msg.at) ? { at: Math.round(msg.at) } : {}) });
      if (!this.flushQueued) {
        this.flushQueued = true;
        queueMicrotask(() => this.flush());
      }
      return;
    }
    this.raw(msg);
  }

  flush() {
    this.flushQueued = false;
    const p = this.pace;
    const t = this.now();
    p.tokens = Math.min(p.burst, p.tokens + ((t - p.at) / 1000) * p.rate);
    p.at = t;
    const n = Math.min(this.batch.length, Math.floor(p.tokens));
    const list = this.batch.splice(0, n);
    p.tokens -= n;
    for (let i = 0; i < list.length; i += LIMITS.MAX_ACTS_PER_FRAME) {
      const chunk = list.slice(i, i + LIMITS.MAX_ACTS_PER_FRAME);
      this.raw(chunk.length === 1 ? { t: MSG.ACT, ...chunk[0] } : { t: MSG.ACTS, list: chunk });
    }
    if (this.batch.length && !this.paceTimer) {
      const wait = Math.max(50, ((1 - (p.tokens % 1)) / p.rate) * 1000);   // a few acts per frame
      this.paceTimer = setTimeout(() => { this.paceTimer = null; this.flush(); }, wait);
    }
  }

  raw(msg) {
    if (this.open) this.ws.send(JSON.stringify(msg));
  }

  ping() { this.raw({ t: MSG.PING, c: performance.now() }); }

  /** 5 quick samples after a welcome, then one every PING_EVERY_MS. */
  startPings() {
    clearTimeout(this.pingTimer);
    this.burst = 5;
    const tick = () => {
      this.ping();
      this.pingTimer = setTimeout(tick, this.burst-- > 0 ? 200 : LIMITS.PING_EVERY_MS);
    };
    tick();
  }

  /** Dev/test: close the socket as if the network dropped. */
  drop() { if (this.ws) this.ws.close(); }

  /** Close for good, no reconnect (additive, multi-farm mode: a private farm or a used-up invite). */
  stop() {
    this.stopped = true;
    clearTimeout(this.pingTimer);
    clearTimeout(this.connectTimer);
    clearTimeout(this.deadline);
    this.unwatch();
    if (this.ws) this.ws.close();
  }
}
