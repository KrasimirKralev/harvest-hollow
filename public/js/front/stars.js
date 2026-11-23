// The GitHub star count for the landing page's star button, from THIS site's server (GET /api/stars, server/stars.js):
// the server asks GitHub at most once an hour, so the visitor's browser never talks to GitHub (public/privacy.html).
// Silent on any failure (the server has no number yet, offline, a single-farm server without the route): the button
// simply shows no number. Nothing is stored on the device (the answer's own HTTP caching covers a revisit).
//
//   starCount({ fetcher }) -> Promise<number | null>      never throws
//   shortCount(n) -> '42' | '1.2k'                        pure
export const STARS_PATH = '/api/stars';

export async function starCount({ fetcher = (u, o) => globalThis.fetch(u, o) } = {}) {
  try {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 5000) : 0;
    const res = await fetcher(STARS_PATH, { headers: { accept: 'application/json' }, signal: ctl?.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const n = (await res.json())?.stars;
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  } catch { return null; }
}

export const shortCount = (n) => (n >= 1000 ? `${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}k` : String(n));
