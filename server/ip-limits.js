// Per-address limits for the multi-farm host (server/multi.js): the client address behind a trusted reverse proxy,
// sliding-window counters (farm creation: 5 an hour and 20 a day per address by default), and open-socket counts.
// Addresses live in memory only (these counters); a log line gets at most maskIp's network (public/privacy.html).
import net from 'node:net';

/** IPv4-mapped IPv6 addresses are the IPv4 address. */
const norm = (ip) => (typeof ip === 'string' && ip.startsWith('::ffff:') ? ip.slice(7) : ip || '');

/** The eight 16-bit groups of an IPv6 address (`::` expanded, a trailing dotted IPv4 folded in). */
function hextets(a) {
  let s = a;
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) {
    const [p0, p1, p2, p3] = v4.slice(1).map(Number);
    s = `${s.slice(0, v4.index)}${((p0 << 8) | p1).toString(16)}:${((p2 << 8) | p3).toString(16)}`;
  }
  const [left, right] = s.split('::');
  const l = left ? left.split(':') : [];
  if (right === undefined) return l.map((x) => parseInt(x, 16));
  const r = right ? right.split(':') : [];
  return [...l, ...Array(8 - l.length - r.length).fill('0'), ...r].map((x) => parseInt(x, 16));
}

/**
 * A client address cut to its network, for an abuse warning in the multi-farm host's log: an IPv4 /24 as x.y.z.0, an
 * IPv6 /48 as a:b:c::/48; 'unknown' for anything else. Never the full address. Pure.
 */
export function maskIp(ip) {
  const a = norm(typeof ip === 'string' ? ip.split('%')[0] : '');
  if (net.isIPv4(a)) return a.replace(/\.\d+$/, '.0');
  if (net.isIPv6(a)) return `${hextets(a).slice(0, 3).map((x) => x.toString(16)).join(':')}::/48`;
  return 'unknown';
}

/**
 * The client's address. With `trust` proxies in front (HH_TRUST_PROXY, Railway / Fly / Render add exactly one),
 * the entry that many hops back in X-Forwarded-For (the one the outermost trusted proxy appended) is used; a
 * client cannot spoof it, because anything it sends itself sits further left.
 * @param {{ headers: object, socket?: { remoteAddress?: string } }} req
 */
export function clientIp(req, trust = 0) {
  const remote = norm(req.socket && req.socket.remoteAddress);
  if (!(trust > 0)) return remote;
  const xff = req.headers && req.headers['x-forwarded-for'];
  const chain = (Array.isArray(xff) ? xff.join(',') : String(xff || '')).split(',').map((s) => s.trim()).filter(Boolean);
  const all = [...chain, remote];
  return norm(all[Math.max(0, all.length - 1 - trust)]);
}

/** Sliding windows per key: every [windowMs, max] must have room for take() to succeed. */
export class WindowLimiter {
  /** @param {Array<[number, number]>} windows  @param {() => number} [wall] */
  constructor(windows, wall = Date.now) {
    this.windows = windows;
    this.wall = wall;
    this.span = Math.max(...windows.map(([ms]) => ms));
    /** key -> sorted timestamps within the longest window */
    this.hits = new Map();
  }

  /** @returns {{ ok: true } | { ok: false, retryAfterMs: number }} (a refused attempt is not counted) */
  take(key) {
    const now = this.wall();
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.span);
    let wait = 0;
    for (const [ms, max] of this.windows) {
      const inWin = list.filter((t) => now - t < ms);
      if (inWin.length >= max) wait = Math.max(wait, inWin[inWin.length - max] + ms - now);
    }
    if (wait > 0) {
      this.hits.set(key, list);
      return { ok: false, retryAfterMs: wait };
    }
    list.push(now);
    this.hits.set(key, list);
    return { ok: true };
  }

  /** Drop keys with nothing in the window (called from a timer). */
  prune() {
    const now = this.wall();
    for (const [k, list] of this.hits) if (!list.some((t) => now - t < this.span)) this.hits.delete(k);
  }
}

/** Open sockets per address. */
export class Counter {
  constructor() { this.n = new Map(); }
  get(key) { return this.n.get(key) || 0; }
  add(key) { this.n.set(key, this.get(key) + 1); }
  drop(key) {
    const v = this.get(key) - 1;
    if (v > 0) this.n.set(key, v);
    else this.n.delete(key);
  }
}
