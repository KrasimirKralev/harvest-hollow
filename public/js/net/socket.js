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
//   status: 'connecting' | 'open' | 'reconnecting'
import { MSG, LIMITS } from '../../../shared/net/protocol.js';

export class Socket {
  /**
   * @param {object} o
   * @param {string} o.url
   * @param {import('../../../shared/net/clock.js').ClockSync} o.clock
   * @param {(msg: object) => void} o.onMessage
   * @param {(status: string) => void} [o.onStatus]
   * @param {() => void} [o.onOpen]   send the hello here
   */
  constructor({ url, clock, onMessage, onStatus = () => {}, onOpen = () => {} }) {
    Object.assign(this, { url, clock, onMessage, onStatus, onOpen });
    this.ws = null;
    this.status = 'connecting';
    this.attempt = 0;
    this.batch = [];
    this.flushQueued = false;
    this.pingTimer = null;
    this.burst = 0;
    const [rate, burst] = LIMITS.BUCKETS.act;
    this.pace = { rate: rate * 0.9, burst: Math.floor(burst * 0.9), tokens: Math.floor(burst * 0.9), at: performance.now() };
    this.paceTimer = null;
    // After a suspend performance.now() did not advance: drop the old samples and re-measure at once with a
    // burst, instead of trusting a stale offset for up to 8 pings (review-m0 L1).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.open) { this.clock.reset(); this.startPings(); }
    });
  }

  get open() { return this.ws !== null && this.ws.readyState === WebSocket.OPEN; }

  connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
      this.clock.reset();
      this.onOpen();
    };
    ws.onmessage = (e) => {
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
        if (m.t === MSG.WELCOME) this.startPings();
        this.onMessage(m);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearTimeout(this.pingTimer);
      this.batch = [];             // the store re-sends every pending action after the next welcome
      this.setStatus('reconnecting');
      const steps = LIMITS.RECONNECT_MS;
      const delay = steps[Math.min(this.attempt++, steps.length - 1)];
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => {};
  }

  setStatus(s) {
    this.status = s;
    this.onStatus(s);
  }

  /** Send a frame. Acts batch per task so a drag-paint stroke is one frame. */
  send(msg) {
    if (msg.t === MSG.ACT) {
      this.batch.push({ seq: msg.seq, type: msg.type, args: msg.args });
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
    const t = performance.now();
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
}
