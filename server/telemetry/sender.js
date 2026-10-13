// The sender's outbox (docs/agent-notes/harness-contract.md §6): events a farmer agreed to share wait in
// HD/telemetry-outbox.jsonl (0600) and leave in order, at most SEND_PER_HOUR an hour per server, to HH_TELEMETRY_URL, or
// straight into this process's own receiver (the official multi host). A failed delivery is retried with a growing
// pause; an event still undelivered after 7 days is dropped. A refusal that cannot get better (400, 413) drops the event
// at once. Each line carries `k` = "<farmKey>:<pid>" so a farmer who turns sharing off (or a deleted farm) takes their
// waiting events with them; `k` never leaves this server: only `p`, the payload, is sent.
import fs from 'node:fs';
import path from 'node:path';
import { OUTBOX_MAX, OUTBOX_MAX_AGE_MS, SEND_PER_HOUR } from './config.js';

export const OUTBOX_FILE = 'telemetry-outbox.jsonl';
const HOUR = 3_600_000;
const BACKOFF_MIN_MS = 60_000;
const BACKOFF_MAX_MS = 6 * HOUR;
const SEND_TIMEOUT_MS = 10_000;

function readLines(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* torn */ }
  }
  return out;
}

/** A pause that doubles with every failed try: 1, 2, 4 … minutes, at most 6 hours. */
export const backoff = (tries) => Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, Math.min(tries - 1, 20)));

export class TelemetrySender {
  /**
   * @param {{ hostDir: string, url: string | null, log: object, wall?: () => number, fetcher?: typeof fetch,
   *   local?: () => (null | ((payload: object) => Promise<{ status: number, retryAfter?: number }>)), perHour?: number }} o
   */
  constructor({ hostDir, url, log, wall = Date.now, fetcher = globalThis.fetch, local = () => null, perHour = SEND_PER_HOUR }) {
    this.file = path.join(hostDir, OUTBOX_FILE);
    this.url = url;
    this.log = log;
    this.wall = wall;
    this.fetcher = fetcher;
    this.local = local;
    this.perHour = perHour;
    /** [{ k, q (queued at), tries, next, p }] oldest first */
    this.items = [];
    /** times of the deliveries of the last hour */
    this.sent = [];
    this.queue = Promise.resolve();
    this.timer = null;
    this.soon = null;
  }

  load() {
    this.items = readLines(this.file).filter((r) => r && typeof r.k === 'string' && r.p && typeof r.p === 'object'
      && Number.isSafeInteger(r.q));
    return this;
  }

  /** True when there is somewhere to send to. */
  canSend() { return Boolean(this.url || this.local()); }

  serial(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /** The outbox rewritten (tmp 0600 + fsync + rename); an empty outbox is no file at all. */
  persist() {
    if (!this.items.length) {
      try { fs.unlinkSync(this.file); } catch { /* none */ }
      return;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeFileSync(fd, this.items.map((r) => `${JSON.stringify(r)}\n`).join(''));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
  }

  /** Queue one payload for the farmer `k`; the oldest go when the outbox is full. */
  enqueue(k, p) {
    return this.serial(() => {
      this.items.push({ k, q: this.wall(), tries: 0, next: 0, p });
      if (this.items.length > OUTBOX_MAX) this.items.splice(0, this.items.length - OUTBOX_MAX);
      this.persist();
    });
  }

  /** Drop every waiting event `gone(k)` picks (sharing turned off, a farm deleted). Resolves how many. */
  forget(gone) {
    return this.serial(() => {
      const before = this.items.length;
      this.items = this.items.filter((r) => !gone(r.k));
      if (this.items.length !== before) this.persist();
      return before - this.items.length;
    });
  }

  /** Waiting events older than OUTBOX_MAX_AGE_MS are dropped. Resolves how many. */
  prune(now = this.wall()) {
    return this.serial(() => {
      const before = this.items.length;
      this.items = this.items.filter((r) => now - r.q < OUTBOX_MAX_AGE_MS);
      if (this.items.length !== before) {
        this.persist();
        this.log.info('shared helper events that could not be delivered for 7 days were dropped', { dropped: before - this.items.length });
      }
      return before - this.items.length;
    });
  }

  /** One delivery: { status, retryAfter? } (status 0: nobody answered). */
  async deliver(p) {
    const local = this.local();
    if (local) return local(p);
    if (!this.url) return { status: 0 };
    try {
      const res = await this.fetcher(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(p),
        // a redirect could hand the event to a host nobody chose
        redirect: 'error',
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      const ra = Number(res.headers?.get?.('retry-after'));
      try { await res.arrayBuffer?.(); } catch { /* the body is not needed */ }
      return { status: res.status, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined };
    } catch {
      return { status: 0 };
    }
  }

  /** Send what is due, in order, within the hourly budget. Resolves how many were delivered. */
  flush() {
    return this.serial(async () => {
      let delivered = 0;
      let changed = false;
      const now0 = this.wall();
      const fresh = this.items.filter((r) => now0 - r.q < OUTBOX_MAX_AGE_MS);
      if (fresh.length !== this.items.length) { this.items = fresh; changed = true; }
      while (this.items.length) {
        const now = this.wall();
        this.sent = this.sent.filter((t) => now - t < HOUR);
        if (this.sent.length >= this.perHour) break;
        const r = this.items[0];
        if (r.next > now) break;
        const { status, retryAfter } = await this.deliver(r.p);
        if (status >= 200 && status < 300) {
          this.items.shift();
          this.sent.push(now);
          delivered++;
          changed = true;
          continue;
        }
        if (status === 400 || status === 413) {
          // the receiver will never take this one: retrying cannot help (a 404, a host not updated yet, is retried)
          this.items.shift();
          changed = true;
          this.log.warn('a shared helper event was refused by the receiver and dropped', { status });
          continue;
        }
        r.tries++;
        r.next = now + (status === 429 || status === 503 ? Math.max(backoff(r.tries), (retryAfter || 0) * 1000) : backoff(r.tries));
        changed = true;
        break;
      }
      if (changed) this.persist();
      return delivered;
    });
  }

  /** A flush in a moment (after a new event), and one every `everyMs` (both unref'd: they never keep a process alive). */
  kick(delayMs = 1000) {
    if (this.soon) return;
    this.soon = setTimeout(() => { this.soon = null; this.flush().catch(() => {}); }, delayMs);
    this.soon.unref?.();
  }

  start(everyMs = 60_000) {
    if (this.timer) return;
    this.timer = setInterval(() => { this.flush().catch(() => {}); }, everyMs);
    this.timer.unref?.();
    if (this.items.length) this.kick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.soon) clearTimeout(this.soon);
    this.timer = null;
    this.soon = null;
    return this.queue;
  }
}
