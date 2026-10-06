// The landing page's GitHub star count, asked by the SERVER (multi mode: GET /api/stars, server/multi.js), so that no
// visitor's browser ever talks to GitHub (public/privacy.html: "no third party but the host"). GitHub is asked at most
// once an hour, whatever the traffic; the answer is kept in memory; a failed refresh keeps the last good number, and
// with none yet the answer is null (the page then shows no number). Nothing of a visitor goes into the request.
//
//   new StarCount({ url, fetcher, wall, ttlMs, timeoutMs, log }).get() -> Promise<number | null>   never throws
export const STARS_URL = 'https://api.github.com/repos/KrasimirKralev/harvest-hollow';
export const STARS_TTL_MS = 60 * 60_000;
const USER_AGENT = 'harvest-hollow-server (+https://github.com/KrasimirKralev/harvest-hollow)';

export class StarCount {
  /**
   * @param {{ url?: string|null, fetcher?: typeof fetch, wall?: () => number, ttlMs?: number, timeoutMs?: number,
   *   log?: { warn: Function } }} [o]  url null: never ask (the answer is always null)
   */
  constructor({ url = STARS_URL, fetcher = (u, o) => globalThis.fetch(u, o), wall = Date.now, ttlMs = STARS_TTL_MS,
    timeoutMs = 5000, log = null } = {}) {
    Object.assign(this, { url, fetcher, wall, ttlMs, timeoutMs, log });
    /** the last good count, or null */
    this.n = null;
    /** when GitHub was last asked (success or not), or null */
    this.askedAt = null;
    this.inflight = null;
    this.asks = 0;
  }

  async get() {
    if (!this.url) return null;
    if (this.inflight) return this.inflight;
    if (this.askedAt !== null && this.wall() - this.askedAt < this.ttlMs) return this.n;
    this.askedAt = this.wall();
    this.inflight = this.ask().then((n) => {
      if (n !== null) this.n = n;
      return this.n;
    }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** One request to GitHub: the count, or null on any failure (logged as a warning, at most once an hour). */
  async ask() {
    this.asks++;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetcher(this.url, { headers: { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT },
        redirect: 'follow', signal: ctl.signal });
      if (!res.ok) {
        this.log?.warn('the GitHub star count is unavailable; the landing page shows no number', { status: res.status });
        return null;
      }
      const n = Number((await res.json())?.stargazers_count);
      return Number.isSafeInteger(n) && n >= 0 ? n : null;
    } catch (err) {
      this.log?.warn('the GitHub star count could not be fetched; the landing page shows no number', { err: err?.name || 'error' });
      return null;
    } finally {
      clearTimeout(t);
    }
  }
}
