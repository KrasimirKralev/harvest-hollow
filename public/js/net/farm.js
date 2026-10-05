// Multi-farm hosted mode (docs/agent-briefs/multi-farm.md; the wire details in docs/agent-notes/mf-client.md): which
// farm this page plays, the farm-scoped names of its storage keys, API paths and socket, the device's list of farms,
// and the links (personal link, invite link) and the two farm-making calls (start a farm, make an invite).
//
// A page at /f/<farmId> plays that farm (multi mode). Every other path (/, /index.html) is the single farm, and then
// key(), api(), wsUrl() and idb() return exactly what the page used before: single mode is untouched.
//
//   farm                         { id, multi, key(k), api(path), wsUrl(loc), idb(name), path } for this page
//   session                      { pid, secret } of this page's farmer (set by main.js at each welcome)
//   createFarmScope(id)          the same for any farm id (the landing page stores a new farm's secret with it)
//   farmIdOf(pathname)           '/f/abc123def4' -> 'abc123def4', else null
//   readLaunch(loc)              { key, join } from '#k=<secret>' and '?join=<token>' (validated, else null)
//   cleanUrl(loc, { join })      the address without '#k=' (and without '?join=' when join is true)
//   personalLink / inviteLink    the two links the Settings and the invite card show
//   farmLabel(state)             the list's name for a farm (its own, else "Rowan & Mia's farm")
//   rememberFarm / farmsOnDevice / forgetFarm   localStorage 'hh.farms' = [{ id, name, lastOpen }] (no secrets)
//   startFarm(fetch, { tz })     POST /api/farms { tz } -> { ok, id, secret } | { ok: false, code: 'RATE'|'FULL'|'NET', retryAfter? }
//   createInvite(fetch, id, secret) -> { ok, token, expiresAt } | { ok: false, code: 'FULL'|'AUTH'|'RATE'|'NET' }
//   ttlDays(status)              the retention in days (GET /api/f/:id/status `ttlDays`, default 7)

/** A farm id in a page path: the server's ids are >= 10 base32 characters; accept the URL-safe alphabet. */
export const FARM_PATH = /^\/f\/([A-Za-z0-9_-]{6,64})\/?$/;
/** Secrets and invite tokens: URL-safe, at least 16 characters (>= 128 bits as hex, base32 or base64url). */
const SECRET_RE = /^[A-Za-z0-9_-]{16,256}$/;
export const TTL_DAYS = 7;
const LIST_KEY = 'hh.farms';
const LIST_MAX = 12;

/** Storage keys that belong to a farm: identity, the tab's farmer, tips and drafts seen there, the camera. */
const FARM_KEYS = new Set(['hh.tokens', 'hh.key', 'hh.slot', 'hh.unsaved', 'hh.reloadedFor', 'hh.camera', 'hh.invite', 'hh.inviteNudge']);
const FARM_PREFIXES = ['hh.tips.', 'hh.coach.hidden.', 'hh.duelSeen.', 'hh.naming.later.', 'hh.notesSeen.', 'hh.saving.',
  'hh.seen.', 'hh.story.', 'hh.tracker.', 'hh.weeds.'];
const farmOwned = (k) => FARM_KEYS.has(k) || FARM_PREFIXES.some((p) => k.startsWith(p));

export const validSecret = (s) => (typeof s === 'string' && SECRET_RE.test(s) ? s : null);

export const farmIdOf = (pathname) => {
  const m = FARM_PATH.exec(String(pathname ?? ''));
  return m ? m[1] : null;
};

export function createFarmScope(id) {
  const multi = typeof id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(id);
  const fid = multi ? id : null;
  return Object.freeze({
    id: fid,
    multi,
    /** 'hh.tokens' -> 'hh.f.<id>.tokens' for a farm's own keys in multi mode; device keys and single mode unchanged. */
    key: (k) => (multi && typeof k === 'string' && farmOwned(k) ? `hh.f.${fid}.${k.slice(3)}` : k),
    /** '/api/status' -> '/api/f/<id>/status' in multi mode. */
    api: (p) => (multi && typeof p === 'string' && p.startsWith('/api/') ? `/api/f/${fid}/${p.slice(5)}` : p),
    wsUrl: (loc) => `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws${multi ? `?farm=${encodeURIComponent(fid)}` : ''}`,
    /** An IndexedDB name (the Memory Book's pictures belong to the farm). */
    idb: (name) => (multi ? `${name}.${fid}` : name),
    path: multi ? `/f/${fid}` : '/',
  });
}

export const farm = createFarmScope(typeof location !== 'undefined' ? farmIdOf(location.pathname) : null);

/** This page's farmer on the farm (main.js fills it at each welcome; the invite card and Settings read it). */
export const session = { pid: null, secret: null, ttlDays: TTL_DAYS };


/** The personal key in the fragment (never sent to the server) and the invite token in the query. */
export function readLaunch(loc) {
  const hash = new URLSearchParams(String(loc?.hash ?? '').replace(/^#/, ''));
  const query = new URLSearchParams(String(loc?.search ?? ''));
  return { key: validSecret(hash.get('k')), join: validSecret(query.get('join')) };
}

/** The address bar without the key (always) and without the invite (once it is used). Keeps every other param. */
export function cleanUrl(loc, { join = false } = {}) {
  const query = new URLSearchParams(String(loc?.search ?? ''));
  if (join) query.delete('join');
  const hash = new URLSearchParams(String(loc?.hash ?? '').replace(/^#/, ''));
  hash.delete('k');
  const q = query.toString();
  const hh = hash.toString();
  return `${loc.pathname}${q ? `?${q}` : ''}${hh ? `#${hh}` : ''}`;
}

export const personalLink = (origin, id, secret) => `${origin}/f/${encodeURIComponent(id)}#k=${encodeURIComponent(secret)}`;
export const inviteLink = (origin, id, token) => `${origin}/f/${encodeURIComponent(id)}?join=${encodeURIComponent(token)}`;

// ---- the farms this device has opened (the landing page's list) ---------------------------------------------------
const readList = (st) => {
  try {
    const v = JSON.parse(st?.getItem(LIST_KEY) ?? 'null');
    return Array.isArray(v) ? v.filter((f) => f && typeof f.id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(f.id)) : [];
  } catch { return []; }
};
const writeList = (st, list) => { try { st?.setItem(LIST_KEY, JSON.stringify(list)); } catch { /* storage blocked: the list lasts this page */ } };

/** Newest first. Each row: { id, name, lastOpen } (a name is the farm's own, or null before it has one). */
export const farmsOnDevice = (st) => readList(st).sort((a, b) => (b.lastOpen || 0) - (a.lastOpen || 0));

export function rememberFarm(st, { id, name = null, at = Date.now() }) {
  if (!createFarmScope(id).multi) return;
  const list = readList(st).filter((f) => f.id !== id);
  const old = readList(st).find((f) => f.id === id);
  const nm = typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : old?.name ?? null;
  list.unshift({ id, name: nm, lastOpen: at });
  writeList(st, list.sort((a, b) => (b.lastOpen || 0) - (a.lastOpen || 0)).slice(0, LIST_MAX));
}

/** Every new farm is called this until its farmers rename it (shared/rules/state.js createFarm). */
const DEFAULT_NAME = 'Harvest Hollow';

/**
 * The name a farm goes by in the device's list: its own name once the farmers gave it one, else whose farm it is
 * ("Rowan & Mia's farm"), so a list of new farms is not a column of "Harvest Hollow". Pure; null when unknown.
 */
export function farmLabel(state) {
  const own = typeof state?.farm?.name === 'string' ? state.farm.name.trim() : '';
  if (own && own !== DEFAULT_NAME) return own;
  const names = Object.keys(state?.players ?? {}).sort().map((pid) => state.players[pid]?.name).filter((n) => typeof n === 'string' && n.trim());
  return names.length ? `${names.map((n) => n.trim()).join(' & ')}'s farm` : own || null;
}

/** Drop a farm from the device (its list row and every key it owns): the server deleted it or it is not ours. */
export function forgetFarm(st, id) {
  writeList(st, readList(st).filter((f) => f.id !== id));
  try {
    const pre = `hh.f.${id}.`;
    const keys = [];
    for (let i = 0; i < (st?.length ?? 0); i++) { const k = st.key(i); if (k && k.startsWith(pre)) keys.push(k); }
    for (const k of keys) st.removeItem(k);
  } catch { /* storage blocked */ }
}

/** Does this device hold a way into the farm (a farmer's secret or the creator's)? */
export function hasIdentity(st, id) {
  const sc = createFarmScope(id);
  if (!sc.multi) return false;
  try {
    if (validSecret(JSON.parse(st?.getItem(sc.key('hh.key')) ?? 'null'))) return true;
    const t = JSON.parse(st?.getItem(sc.key('hh.tokens')) ?? 'null');
    return Boolean(t && Object.values(t).some((v) => validSecret(v)));
  } catch { return false; }
}

// ---- the two calls ------------------------------------------------------------------------------------------------
const retryOf = (res, body) => {
  const h = Number(res?.headers?.get?.('retry-after'));
  const b = Number(body?.retryAfter);
  return Number.isFinite(b) && b > 0 ? b : Number.isFinite(h) && h > 0 ? h : null;
};
const jsonOf = async (res) => { try { return await res.json(); } catch { return null; } };
const isFull = (res, body) => res.status === 503 || /full/i.test(String(body?.error ?? body?.code ?? ''));

/** This browser's IANA time zone, or null: a new farm's midnight (daily orders, weekly events) is its creator's. */
export function browserTz() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.length <= 64 && /^[A-Za-z0-9_+\-/]+$/.test(tz) ? tz : null;
  } catch { return null; }
}

/** POST /api/farms { tz? }. Never throws. */
export async function startFarm(fetcher = globalThis.fetch, { tz = browserTz() } = {}) {
  let res;
  try {
    res = await fetcher('/api/farms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tz ? { tz } : {}) });
  } catch { return { ok: false, code: 'NET' }; }
  const body = await jsonOf(res);
  if (res.ok && body && createFarmScope(body.id).multi && validSecret(body.secret)) return { ok: true, id: body.id, secret: body.secret };
  if (res.status === 429) return { ok: false, code: 'RATE', retryAfter: retryOf(res, body) };
  if (isFull(res, body)) return { ok: false, code: 'FULL' };
  return { ok: false, code: 'NET' };
}

/** POST /api/f/:id/invite with the player's secret (a header, and the body for a server that reads that). Never throws. */
export async function createInvite(fetcher, id, secret) {
  if (!createFarmScope(id).multi || !validSecret(secret)) return { ok: false, code: 'AUTH' };
  let res;
  try {
    res = await fetcher(`/api/f/${encodeURIComponent(id)}/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({ secret }),
      cache: 'no-store',
    });
  } catch { return { ok: false, code: 'NET' }; }
  const body = await jsonOf(res);
  if (res.ok && body && validSecret(body.token)) {
    return { ok: true, token: body.token, expiresAt: Number.isFinite(body.expiresAt) ? body.expiresAt : null };
  }
  if (res.status === 409 || /full/i.test(String(body?.error ?? body?.code ?? ''))) return { ok: false, code: 'FULL' };
  if (res.status === 401 || res.status === 403) return { ok: false, code: 'AUTH' };
  if (res.status === 429) return { ok: false, code: 'RATE', retryAfter: retryOf(res, body) };
  return { ok: false, code: 'NET' };
}

export const ttlDays = (status) => {
  const d = Number(status?.ttlDays);
  return Number.isInteger(d) && d > 0 && d < 3650 ? d : TTL_DAYS;
};
