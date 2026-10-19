// Option 2 (release 1.0; docs/qa/release/option2.md D1-D3, D7, D9): may this page load its static game files from the
// public host? Only when the public host serves EXACTLY this build (the build-hash handshake), the page was asked for
// under a public name (on the LAN or Tailscale-direct this server is faster than any cloud), the browser has not
// fallen back already (the watchdog's ?assets=self / hh_assets=self), and the browser has proven that it enforces
// import-map integrity (the hh_sri cookie set by /sri-probe, server/static.js): code from the public host runs with the
// farm's and the helper's keys, so it runs only where every module is checked against this server's own hashes.
//
//   new AssetOrigin({ origin, probe?, build, everyMs?, timeoutMs?, fetcher?, now?, log? })
//   .start()            the first check now, then every `everyMs` (never once for the process lifetime)
//   .check()            HEAD <probe>/b/<build>/public/js/main.js: 200 with ACAO * = 'match', 404 = 'mismatch', anything
//                       else (an error, a timeout, a 200 without CORS) = 'down'; concurrent calls share one request
//   .baseFor(req)       '<origin>/b/<build>' for this page request, or null (this server). A request that carries the
//                       fallback marker while the state is 'match' re-checks at once (a browser that just failed is a
//                       fresh sign of a stale handshake), at most once per RECHECK_MS
//   .status             { origin, state: 'unknown'|'match'|'mismatch'|'down', checkedAt } for /api/status
//   .stop()
export const RECHECK_MS = 5000;
export const SELF_COOKIE = 'hh_assets';
export const SUPPORT_COOKIE = 'hh_sri';

/** The value of cookie `name` in a request, or null. */
export function cookieOf(req, name) {
  const raw = String(req?.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * A Host header that names this server on the LAN or over Tailscale directly: loopback, private IPv4 and IPv6,
 * link-local, the Tailscale range 100.64/10, *.local and single-label names (D1). Those pages stay self.
 */
export function isLocalHost(hostHeader) {
  let h = String(hostHeader || '').trim().toLowerCase();
  if (!h) return true;                                         // no Host: a tool, never a browser on the internet
  if (h.startsWith('[')) h = h.slice(1, h.indexOf(']'));       // [v6]:port
  else if ((h.match(/:/g) || []).length === 1) h = h.slice(0, h.indexOf(':'));
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127) || a === 0;
  }
  if (h.includes(':')) return /^(fc|fd|fe8|fe9|fea|feb)/.test(h) || h.startsWith('::ffff:');  // ULA, link-local, mapped
  return !h.includes('.');                                     // a single-label name (MagicDNS short name, a LAN host)
}

export class AssetOrigin {
  /**
   * @param {{ origin: string, probe?: string, build: string, everyMs?: number, timeoutMs?: number,
   *   fetcher?: typeof fetch, now?: () => number, log?: Console }} o
   */
  constructor({ origin, probe = origin, build, everyMs = 60_000, timeoutMs = 4000, fetcher = (u, i) => fetch(u, i),
    now = () => Date.now(), log = console }) {
    this.origin = new URL(origin).origin;
    this.probe = new URL(probe || origin).origin;
    Object.assign(this, { build, everyMs, timeoutMs, fetcher, now, log });
    this.state = 'unknown';
    this.checkedAt = 0;
    this.timer = null;
    this.inflight = null;
    this.recheckAt = -Infinity;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => { this.check(); }, this.everyMs);
    this.timer.unref?.();
    return this.check();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  check() {
    this.inflight ??= (async () => {
      let state;
      try {
        const r = await this.fetcher(`${this.probe}/b/${this.build}/public/js/main.js`,
          { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
        state = r.status === 200 && r.headers.get('access-control-allow-origin') === '*' ? 'match' : r.status === 404 ? 'mismatch' : 'down';
      } catch {
        state = 'down';
      }
      if (state !== this.state) this.log.info?.(`asset host ${this.origin}: ${state}`);
      this.state = state;
      this.checkedAt = this.now();
      return state;
    })().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** '<origin>/b/<build>' when this page may take its game files from the public host, else null (see the header). */
  baseFor(req) {
    const q = req?.query?.assets;
    const pick = typeof q === 'string' ? q : '';
    const fellBack = pick === 'self' || cookieOf(req, SELF_COOKIE) === 'self';
    if (fellBack) {
      if (this.state === 'match' && this.now() - this.recheckAt >= RECHECK_MS) {
        this.recheckAt = this.now();
        this.check();
      }
      return null;
    }
    if (this.state !== 'match') return null;
    if (cookieOf(req, SUPPORT_COOKIE) !== '1') return null;      // the browser has not proven import-map integrity
    if (isLocalHost(req?.headers?.host) && pick !== 'cloud') return null;
    return `${this.origin}/b/${this.build}`;
  }

  get status() {
    return { origin: this.origin, state: this.state, checkedAt: this.checkedAt || null };
  }
}
