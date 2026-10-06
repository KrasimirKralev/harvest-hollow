// Ideas from players (owner request 2026-10-05: "people can give ideas for implementations, so we can gather them,
// review later and maybe merge them"). Multi-farm mode only (server/multi.js mounts it); a self-hosted single farm
// links to GitHub Discussions instead and has none of these routes.
//
//   POST /api/ideas               { category, text, name?, contact?, farm?, lang?, website? }
//                                 -> 201 { ok, id } | 400 { error: 'BAD_ARGS', field } | 403 ORIGIN
//                                 | 429 { error: 'RATE', retryAfter } (5 an hour, 20 a day per address)
//                                 | 503 { error: 'FULL' } (the global daily cap, HH_IDEAS_PER_DAY)
//   GET  /api/admin/ideas         ?status=new (default) | all | liked | planned | done | declined [&limit=n]
//                                 -> { ok, total, counts, ideas: [{ id, at, category, text, name, contact, farm, lang, ua,
//                                    status, note, statusAt }] } newest first
//   POST /api/admin/ideas/:id     { status, note? } -> { ok, idea } | 400 | 404
//   DELETE /api/admin/ideas/:id   -> { ok, id } | 404: the idea and its status rows are gone for good (both files
//                                 rewritten atomically): a player's "please delete my idea"
//
// Privacy requests (public/privacy.html's form): the same shape, their own store and limits.
//   POST /api/privacy             { kind, text, contact?, lang?, website? } -> 201 { ok, id } | 400 { field } | 403 ORIGIN
//                                 | 429 { error: 'RATE', retryAfter } (5 an hour, 20 a day per address) | 503 FULL
//                                 kind: 'idea' (delete my idea) | 'farm' (delete a farm I lost access to) | 'copy' (a copy
//                                 of my data) | 'other'
//   GET  /api/admin/privacy       ?status=new (default) | done | all -> { ok, total, counts, requests: [...] } newest first
//   POST /api/admin/privacy/:id   { status: 'new' | 'done', note? } -> { ok, request }
//   DELETE /api/admin/farms/:id   -> { ok } | 404: a farm deleted on request (its screens hear DELETED; server/farms.js)
//   Admin: `Authorization: Bearer <HH_ADMIN_TOKEN>` (constant-time compare; 401 without a bearer, 403 for a wrong one,
//   429 after 10 failures from one address in 15 minutes). Unset (or shorter than 24 characters): no admin routes at
//   all, so they answer the API's plain 404.
//
// Storage under the data dir (the host's volume): ideas/ideas.jsonl (one idea per line, append-only, fsync'ed) and
// ideas/status.jsonl (the append-only status log: { id, at, status, note }; the newest row of an id wins);
// privacy/requests.jsonl and privacy/status.jsonl likewise. Every file is 0600, every directory 0700. A torn last line
// (a crash mid-append) is skipped when the files are read back at boot.
//
// Retention: the farm registry's hourly sweep (server/farms.js `sweepers`) deletes ideas and privacy requests older
// than KEEP_MS (365 days) with their status rows; a deletion rewrites the files atomically (tmp + fsync + rename).
//
// Privacy: no address and no full user agent ever reach the disk: the per-address limits key on a salted HMAC of the
// address that lives in memory only (a new salt per process), and the user agent is reduced to "Safari on iOS"
// (ideas only; a privacy request keeps no browser at all).
// Plain text only: control characters, direction overrides and terminal escapes are dropped at intake; markup stays
// as typed and is never rendered as HTML anywhere (the admin list is JSON with `<` escaped and a no-script CSP; the
// CLI tools/ideas.mjs strips control characters again before printing).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { WindowLimiter, clientIp } from './ip-limits.js';
import { ID_RE } from './farms.js';

export const CATEGORIES = Object.freeze(['content', 'feature', 'bug', 'other']);
export const STATUSES = Object.freeze(['new', 'liked', 'planned', 'done', 'declined']);
export const IDEA_LIMITS = Object.freeze({ textMin: 10, textMax: 1000, nameMax: 40, contactMax: 120, noteMax: 500 });
/** What a privacy request asks for (public/privacy.html's form), its states and limits. */
export const PRIVACY_KINDS = Object.freeze(['idea', 'farm', 'copy', 'other']);
export const PRIVACY_STATUSES = Object.freeze(['new', 'done']);
export const PRIVACY_LIMITS = Object.freeze({ textMin: 10, textMax: 2000, contactMax: 120, perDay: 100 });
/** Ideas and privacy requests are kept this long, then the hourly sweep deletes them. */
export const KEEP_MS = 365 * 86_400_000;
const FIELDS = new Set(['category', 'text', 'name', 'contact', 'farm', 'lang', 'website']);
const PRIVACY_FIELDS = new Set(['kind', 'text', 'contact', 'lang', 'website']);
/** The stored fields each box shows its admin (besides id and at). */
const IDEA_VIEW = Object.freeze(['category', 'text', 'name', 'contact', 'farm', 'lang', 'ua']);
const PRIVACY_VIEW = Object.freeze(['kind', 'text', 'contact', 'lang']);
const ADMIN_FIELDS = new Set(['status', 'note']);
const IDEA_ID = /^[0-9a-f]{16}$/;
const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/i;
const MIN_TOKEN = 24;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** HH_ADMIN_TOKEN and HH_IDEAS_PER_DAY (multi mode). A set but invalid cap falls back to the default. */
export function ideasConfig(env = process.env) {
  const cap = Number(env.HH_IDEAS_PER_DAY);
  return {
    adminToken: env.HH_ADMIN_TOKEN || null,
    perDay: Number.isSafeInteger(cap) && cap > 0 ? cap : 200,
  };
}

// C0 controls but \n and \t, DEL, C1, the bidi embeddings / overrides / isolates and marks, zero-width space and BOM.
// The zero-width joiner (U+200D) stays: emoji sequences need it.
// eslint-disable-next-line no-control-regex
const DROP = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Plain text: line ends unified, invisible and control characters dropped, whitespace tidied. Pure. */
export function cleanText(s, { multiline = false } = {}) {
  let t = String(s).normalize('NFC').replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(DROP, '');
  if (!multiline) return t.replace(/\s+/g, ' ').trim();
  t = t.replace(/\t/g, ' ').split('\n').map((l) => l.replace(/[  ]+$/g, '')).join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

const chars = (s) => [...s].length;

/** "Safari on iOS": the browser and system families only, never a version or a device model. Pure. */
export function uaFamily(ua) {
  if (typeof ua !== 'string' || !ua.trim()) return null;
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'ChromeOS'
    : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari' : null;
  if (!browser) return 'Other';
  return os ? `${browser} on ${os}` : browser;
}

const bad = (field) => ({ ok: false, field });

/** An optional single-line string field: null when absent or empty; else cleaned, within `max` characters. */
function optLine(v, max) {
  if (v === undefined || v === null) return { ok: true, v: null };
  if (typeof v !== 'string') return { ok: false };
  const t = cleanText(v);
  if (chars(t) > max) return { ok: false };
  return { ok: true, v: t || null };
}

/**
 * The checked fields of a submitted idea: { ok, idea: { category, text, name, contact, farm, lang }, trap } or
 * { ok: false, field }. `trap`: the honeypot was filled (a bot). Pure.
 */
export function checkIdea(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('body');
  for (const k of Object.keys(body)) if (!FIELDS.has(k)) return bad(k);
  if (typeof body.category !== 'string' || !CATEGORIES.includes(body.category)) return bad('category');
  if (typeof body.text !== 'string') return bad('text');
  const text = cleanText(body.text, { multiline: true });
  if (chars(text) < IDEA_LIMITS.textMin || chars(text) > IDEA_LIMITS.textMax) return bad('text');
  const name = optLine(body.name, IDEA_LIMITS.nameMax);
  if (!name.ok) return bad('name');
  const contact = optLine(body.contact, IDEA_LIMITS.contactMax);
  if (!contact.ok) return bad('contact');
  if (body.farm !== undefined && body.farm !== null && (typeof body.farm !== 'string' || !ID_RE.test(body.farm))) return bad('farm');
  if (body.lang !== undefined && body.lang !== null && typeof body.lang !== 'string') return bad('lang');
  if (body.website !== undefined && body.website !== null && typeof body.website !== 'string') return bad('website');
  const lang = typeof body.lang === 'string' && body.lang.length <= 35 && LANG_RE.test(body.lang) ? body.lang.toLowerCase() : null;
  return {
    ok: true,
    trap: typeof body.website === 'string' && body.website.trim() !== '',
    idea: { category: body.category, text, name: name.v, contact: contact.v, farm: body.farm || null, lang },
  };
}

/**
 * The checked fields of a privacy request: { ok, request: { kind, text, contact, lang }, trap } or { ok: false, field }.
 * Pure.
 */
export function checkPrivacy(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('body');
  for (const k of Object.keys(body)) if (!PRIVACY_FIELDS.has(k)) return bad(k);
  if (typeof body.kind !== 'string' || !PRIVACY_KINDS.includes(body.kind)) return bad('kind');
  if (typeof body.text !== 'string') return bad('text');
  const text = cleanText(body.text, { multiline: true });
  if (chars(text) < PRIVACY_LIMITS.textMin || chars(text) > PRIVACY_LIMITS.textMax) return bad('text');
  const contact = optLine(body.contact, PRIVACY_LIMITS.contactMax);
  if (!contact.ok) return bad('contact');
  if (body.lang !== undefined && body.lang !== null && typeof body.lang !== 'string') return bad('lang');
  if (body.website !== undefined && body.website !== null && typeof body.website !== 'string') return bad('website');
  const lang = typeof body.lang === 'string' && body.lang.length <= 35 && LANG_RE.test(body.lang) ? body.lang.toLowerCase() : null;
  return { ok: true, trap: typeof body.website === 'string' && body.website.trim() !== '', request: { kind: body.kind, text, contact: contact.v, lang } };
}

/** The first language tag of an Accept-Language header ("bg-BG,bg;q=0.9" -> "bg-bg"), or null. */
function headerLang(h) {
  const first = typeof h === 'string' ? h.split(',')[0].split(';')[0].trim() : '';
  return first && first.length <= 35 && LANG_RE.test(first) ? first.toLowerCase() : null;
}

/** Every JSON line of a file; a line that does not parse (a torn append) is skipped. */
function readLines(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* torn */ }
  }
  return out;
}

/** tmp (0600) + fsync + rename + dir fsync: `file` holds exactly `rows` (JSON lines), or is unchanged after a crash. */
async function rewriteLines(file, rows) {
  const tmp = `${file}.tmp`;
  const fh = await fs.promises.open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
    await fh.sync();
  } finally { await fh.close(); }
  await fs.promises.rename(tmp, file);
  try {
    const d = await fs.promises.open(path.dirname(file), 'r');
    try { await d.sync(); } finally { await d.close(); }
  } catch { /* a filesystem that refuses a directory fsync: the rename is still atomic */ }
}

/**
 * The ideas (or the privacy requests) and their status log on disk, mirrored in memory (a few hundred a day at most).
 * `file` / `statusFile` name the two files under `dir`; `statuses` the states an entry may take; `fields` what the admin
 * sees of an entry besides its id and time.
 */
export class IdeaBox {
  constructor(dir, { wall = Date.now, file = 'ideas.jsonl', statusFile = 'status.jsonl', statuses = STATUSES, fields = IDEA_VIEW } = {}) {
    this.dir = dir;
    this.file = path.join(dir, file);
    this.statusFile = path.join(dir, statusFile);
    this.statuses = statuses;
    this.fields = fields;
    this.wall = wall;
    /** id -> idea (as stored) */
    this.ideas = new Map();
    /** id -> newest { status, note, at } */
    this.status = new Map();
    this.queue = Promise.resolve();
  }

  load() {
    for (const r of readLines(this.file)) {
      if (r && typeof r.id === 'string' && IDEA_ID.test(r.id) && Number.isSafeInteger(r.at)) this.ideas.set(r.id, r);
    }
    for (const r of readLines(this.statusFile)) {
      if (r && this.ideas.has(r.id) && this.statuses.includes(r.status)) this.status.set(r.id, { status: r.status, note: r.note ?? null, at: r.at });
    }
    return this;
  }

  /** Ideas stored in the last `ms` (the global daily cap). */
  recent(ms = DAY) {
    const since = this.wall() - ms;
    let n = 0;
    for (const r of this.ideas.values()) if (r.at > since) n++;
    return n;
  }

  /** Run `fn` after every write before it (appends and rewrites never interleave). */
  serial(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /** One JSON line appended and flushed to disk; appends run one at a time. */
  append(file, row) {
    const line = `${JSON.stringify(row)}\n`;
    return this.serial(async () => {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      // a torn last line (a crash mid-append) must not swallow this one: start on a fresh line
      let lead = '';
      try {
        const st = fs.statSync(file);
        if (st.size > 0) {
          const fd = fs.openSync(file, 'r');
          try {
            const b = Buffer.alloc(1);
            fs.readSync(fd, b, 0, 1, st.size - 1);
            if (b[0] !== 0x0a) lead = '\n';
          } finally { fs.closeSync(fd); }
        }
      } catch { /* a new file */ }
      const fh = await fs.promises.open(file, 'a', 0o600);
      try {
        await fh.appendFile(lead + line);
        await fh.datasync();
      } finally { await fh.close(); }
    });
  }

  /**
   * Delete every entry `gone(row)` picks, for good: both files are rewritten without them (atomically; their status rows
   * go too) and memory follows. Resolves the deleted ids.
   */
  drop(gone) {
    return this.serial(async () => {
      const ids = new Set([...this.ideas.values()].filter(gone).map((r) => r.id));
      if (!ids.size) return [];
      // from the files themselves: a status row's history and any row memory skipped stay as they were
      if (fs.existsSync(this.file)) await rewriteLines(this.file, readLines(this.file).filter((r) => !(r && ids.has(r.id))));
      if (fs.existsSync(this.statusFile)) await rewriteLines(this.statusFile, readLines(this.statusFile).filter((r) => !(r && ids.has(r.id))));
      for (const id of ids) { this.ideas.delete(id); this.status.delete(id); }
      return [...ids];
    });
  }

  /** Delete one entry for good: true when it was there. */
  async remove(id) {
    return (await this.drop((r) => r.id === id)).length > 0;
  }

  /** The retention: every entry stored before `cutoff` is deleted. Resolves how many. */
  async expire(cutoff) {
    return (await this.drop((r) => !(r.at >= cutoff))).length;
  }

  newId() {
    let id;
    do id = crypto.randomBytes(8).toString('hex'); while (this.ideas.has(id));
    return id;
  }

  async add(fields) {
    const row = { id: this.newId(), at: this.wall(), ...fields };
    await this.append(this.file, row);
    this.ideas.set(row.id, row);
    return row;
  }

  async setStatus(id, status, note = null) {
    if (!this.ideas.has(id)) return null;
    const row = { id, at: this.wall(), status, note };
    await this.append(this.statusFile, row);
    this.status.set(id, { status, note, at: row.at });
    return this.view(id);
  }

  /** An entry as the admin list shows it: the stored fields plus its newest status. */
  view(id) {
    const r = this.ideas.get(id);
    if (!r) return null;
    const s = this.status.get(id);
    return { id: r.id, at: r.at, ...Object.fromEntries(this.fields.map((f) => [f, r[f] ?? null])),
      status: s ? s.status : 'new', note: s ? s.note : null, statusAt: s ? s.at : null };
  }

  /** Newest first; `status` 'all' or one of the box's statuses. */
  list({ status = 'new', limit = 200 } = {}) {
    const all = [...this.ideas.keys()].map((id) => this.view(id)).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
    const counts = Object.fromEntries(this.statuses.map((s) => [s, 0]));
    for (const i of all) counts[i.status]++;
    const pick = status === 'all' ? all : all.filter((i) => i.status === status);
    return { total: all.length, counts, ideas: pick.slice(0, limit) };
  }
}

/** Constant-time comparison of two strings of any length (both hashed first, so lengths do not leak). */
export function sameSecret(a, b) {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b)) && typeof a === 'string' && typeof b === 'string';
}

/** Failures per key in a sliding window (admin auth): blocked() before the check, fail() after a wrong token. */
class FailWindow {
  constructor(ms, max, wall) { this.ms = ms; this.max = max; this.wall = wall; this.hits = new Map(); }
  live(key) {
    const now = this.wall();
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.ms);
    if (list.length) this.hits.set(key, list); else this.hits.delete(key);
    return list;
  }
  blocked(key) {
    const list = this.live(key);
    return list.length >= this.max ? Math.max(1, Math.ceil((list[list.length - this.max] + this.ms - this.wall()) / 1000)) : 0;
  }
  fail(key) { this.hits.set(key, [...this.live(key), this.wall()]); }
  prune() { for (const k of [...this.hits.keys()]) this.live(k); }
}

/** JSON with every `<` escaped: a list opened in a browser tab can never become markup. */
function safeJson(res, status, body) {
  res.status(status).type('application/json').send(JSON.stringify(body).replace(/</g, '\\u003c'));
}

/**
 * Mount the ideas routes on the multi-farm host. `hh.cfg.ideas` (tests) overrides the environment (ideasConfig):
 * { adminToken, perDay, wall }.
 */
export function mountIdeas(app, hh, { sameOrigin = (_q, _r, next) => next() } = {}) {
  const { cfg, mc, reg, log } = hh;
  const ic = { ...ideasConfig(process.env), ...(cfg.ideas || {}) };
  const wall = typeof ic.wall === 'function' ? ic.wall : Date.now;
  const box = new IdeaBox(path.join(cfg.dataDir, 'ideas'), { wall }).load();
  hh.ideas = box;
  const requests = new IdeaBox(path.join(cfg.dataDir, 'privacy'), { wall, file: 'requests.jsonl', statusFile: 'status.jsonl',
    statuses: PRIVACY_STATUSES, fields: PRIVACY_VIEW }).load();
  hh.privacy = requests;
  // the limits key on a salted hash of the address, kept in memory only: nothing on disk can be traced to a sender
  const salt = crypto.randomBytes(32);
  const keyOf = (req) => crypto.createHmac('sha256', salt).update(clientIp(req, mc.trustProxy)).digest('base64url').slice(0, 22);
  const perAddress = new WindowLimiter([[HOUR, 5], [DAY, 20]], wall);
  const perAddressPrivacy = new WindowLimiter([[HOUR, 5], [DAY, 20]], wall);
  const fails = new FailWindow(15 * 60_000, 10, wall);
  hh.limiters?.push(perAddress, perAddressPrivacy, fails);
  // retention: the registry's hourly sweep (and the boot sweep) deletes what is older than a year
  reg?.sweepers?.push(async (now) => {
    const ideas = await box.expire(now - KEEP_MS);
    const asked = await requests.expire(now - KEEP_MS);
    if (ideas || asked) log.info('ideas and privacy requests older than 365 days were deleted', { ideas, requests: asked });
    return { ideas, requests: asked };
  });

  app.post('/api/ideas', sameOrigin, express.json({ limit: '4kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const c = checkIdea(req.body);
    if (!c.ok) return res.status(400).json({ error: 'BAD_ARGS', field: c.field });
    if (box.recent(DAY) >= ic.perDay) return res.status(503).json({ error: 'FULL' });
    const r = perAddress.take(keyOf(req));
    if (!r.ok) {
      const s = Math.ceil(r.retryAfterMs / 1000);
      return res.set('Retry-After', String(s)).status(429).json({ error: 'RATE', retryAfter: s });
    }
    // a filled honeypot: answered like a success, so a bot learns nothing, and dropped
    if (c.trap) return res.status(201).json({ ok: true, id: box.newId() });
    const idea = { ...c.idea, farm: c.idea.farm && reg.has(c.idea.farm) ? c.idea.farm : null,
      lang: c.idea.lang ?? headerLang(req.headers['accept-language']), ua: uaFamily(req.headers['user-agent']) };
    try {
      const row = await box.add(idea);
      return res.status(201).json({ ok: true, id: row.id });
    } catch (err) {
      log.error('saving an idea failed', { err: err && err.code ? err.code : String(err && err.message) });
      return res.status(500).json({ error: 'INTERNAL' });
    }
  });

  app.post('/api/privacy', sameOrigin, express.json({ limit: '8kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const c = checkPrivacy(req.body);
    if (!c.ok) return res.status(400).json({ error: 'BAD_ARGS', field: c.field });
    if (requests.recent(DAY) >= PRIVACY_LIMITS.perDay) return res.status(503).json({ error: 'FULL' });
    const r = perAddressPrivacy.take(keyOf(req));
    if (!r.ok) {
      const s = Math.ceil(r.retryAfterMs / 1000);
      return res.set('Retry-After', String(s)).status(429).json({ error: 'RATE', retryAfter: s });
    }
    if (c.trap) return res.status(201).json({ ok: true, id: requests.newId() });
    try {
      const row = await requests.add({ ...c.request, lang: c.request.lang ?? headerLang(req.headers['accept-language']) });
      log.info('a privacy request arrived', { kind: row.kind });
      return res.status(201).json({ ok: true, id: row.id });
    } catch (err) {
      log.error('saving a privacy request failed', { err: err && err.code ? err.code : String(err && err.message) });
      return res.status(500).json({ error: 'INTERNAL' });
    }
  });

  const token = typeof ic.adminToken === 'string' ? ic.adminToken : '';
  if (token.length < MIN_TOKEN) {
    if (token) log.warn(`HH_ADMIN_TOKEN is shorter than ${MIN_TOKEN} characters: the ideas admin routes stay off`);
    return box;
  }
  const adminApi = express.Router();
  adminApi.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const key = keyOf(req);
    const wait = fails.blocked(key);
    if (wait) return res.set('Retry-After', String(wait)).status(429).json({ error: 'RATE', retryAfter: wait });
    const m = typeof req.headers.authorization === 'string' ? /^Bearer\s+(\S+)$/i.exec(req.headers.authorization) : null;
    if (!m) {
      fails.fail(key);
      return res.set('WWW-Authenticate', 'Bearer realm="harvest-hollow-admin"').status(401).json({ error: 'AUTH' });
    }
    if (!sameSecret(m[1], token)) {
      fails.fail(key);
      return res.status(403).json({ error: 'AUTH' });
    }
    return next();
  });
  adminApi.get('/ideas', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'new';
    if (status !== 'all' && !STATUSES.includes(status)) return res.status(400).json({ error: 'BAD_ARGS', field: 'status' });
    const n = Number(req.query.limit ?? 200);
    const limit = Number.isSafeInteger(n) && n > 0 ? Math.min(n, 1000) : 200;
    return safeJson(res, 200, { ok: true, ...box.list({ status, limit }) });
  });
  adminApi.post('/ideas/:id', express.json({ limit: '2kb' }), async (req, res) => {
    const { id } = req.params;
    if (!IDEA_ID.test(id) || !box.ideas.has(id)) return res.status(404).json({ error: 'NOT_FOUND' });
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ error: 'BAD_ARGS', field: 'body' });
    for (const k of Object.keys(b)) if (!ADMIN_FIELDS.has(k)) return res.status(400).json({ error: 'BAD_ARGS', field: k });
    if (typeof b.status !== 'string' || !STATUSES.includes(b.status)) return res.status(400).json({ error: 'BAD_ARGS', field: 'status' });
    let note = null;
    if (b.note !== undefined && b.note !== null) {
      if (typeof b.note !== 'string') return res.status(400).json({ error: 'BAD_ARGS', field: 'note' });
      note = cleanText(b.note, { multiline: true }) || null;
      if (note && chars(note) > IDEA_LIMITS.noteMax) return res.status(400).json({ error: 'BAD_ARGS', field: 'note' });
    }
    try {
      return safeJson(res, 200, { ok: true, idea: await box.setStatus(id, b.status, note) });
    } catch (err) {
      log.error('saving an idea status failed', { err: err && err.code ? err.code : String(err && err.message) });
      return res.status(500).json({ error: 'INTERNAL' });
    }
  });
  adminApi.delete('/ideas/:id', async (req, res) => {
    const { id } = req.params;
    if (!IDEA_ID.test(id) || !box.ideas.has(id)) return res.status(404).json({ error: 'NOT_FOUND' });
    try {
      if (!(await box.remove(id))) return res.status(404).json({ error: 'NOT_FOUND' });
      log.info('an idea was deleted on request');
      return safeJson(res, 200, { ok: true, id });
    } catch (err) {
      log.error('deleting an idea failed', { err: err && err.code ? err.code : String(err && err.message) });
      return res.status(500).json({ error: 'INTERNAL' });
    }
  });
  // a privacy request "delete a farm I lost access to": the whole farm, at once, exactly as its farmers' own button does
  adminApi.delete('/farms/:id', async (req, res) => {
    const rec = reg && ID_RE.test(req.params.id) ? reg.rec(req.params.id) : null;
    if (!rec) return res.status(404).json({ error: 'NOT_FOUND' });
    try {
      if (!(await reg.remove(rec))) return res.status(404).json({ error: 'NOT_FOUND' });
      return safeJson(res, 200, { ok: true });
    } catch (err) {
      log.error('deleting a farm on request failed', { err: err && err.code ? err.code : String(err && err.message) });
      return res.status(500).json({ error: 'INTERNAL' });
    }
  });
  adminApi.get('/privacy', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'new';
    if (status !== 'all' && !PRIVACY_STATUSES.includes(status)) return res.status(400).json({ error: 'BAD_ARGS', field: 'status' });
    const { ideas: list, ...rest } = requests.list({ status, limit: 1000 });
    return safeJson(res, 200, { ok: true, ...rest, requests: list });
  });
  adminApi.post('/privacy/:id', express.json({ limit: '2kb' }), async (req, res) => {
    const { id } = req.params;
    if (!IDEA_ID.test(id) || !requests.ideas.has(id)) return res.status(404).json({ error: 'NOT_FOUND' });
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ error: 'BAD_ARGS', field: 'body' });
    for (const k of Object.keys(b)) if (!ADMIN_FIELDS.has(k)) return res.status(400).json({ error: 'BAD_ARGS', field: k });
    if (typeof b.status !== 'string' || !PRIVACY_STATUSES.includes(b.status)) return res.status(400).json({ error: 'BAD_ARGS', field: 'status' });
    let note = null;
    if (b.note !== undefined && b.note !== null) {
      if (typeof b.note !== 'string') return res.status(400).json({ error: 'BAD_ARGS', field: 'note' });
      note = cleanText(b.note, { multiline: true }) || null;
      if (note && chars(note) > IDEA_LIMITS.noteMax) return res.status(400).json({ error: 'BAD_ARGS', field: 'note' });
    }
    try {
      return safeJson(res, 200, { ok: true, request: await requests.setStatus(id, b.status, note) });
    } catch (err) {
      log.error('saving a privacy request status failed', { err: err && err.code ? err.code : String(err && err.message) });
      return res.status(500).json({ error: 'INTERNAL' });
    }
  });
  app.use('/api/admin', sameOrigin, adminApi);
  log.info('ideas: the admin routes are on (HH_ADMIN_TOKEN is set)');
  return box;
}
