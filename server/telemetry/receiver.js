// The receiving end of shared helper events (docs/agent-notes/harness-contract.md §6), mounted on the public multi-farm
// host (and on a single server with HH_TELEMETRY_RECEIVE=1).
//
//   POST /api/telemetry           one event (payload.js shape, <= 64 KB JSON)
//                                 -> 202 { ok, id } | 400 { error: 'BAD_ARGS', field } | 413 { error: 'TOO_BIG' }
//                                 | 429 { error: 'RATE', retryAfter } (60 an hour per address; 200 a day per install)
//                                 | 503 { error: 'FULL' } (all senders together, HH_TELEMETRY_PER_DAY a day)
//   GET    /api/admin/telemetry   ?limit=50&event=job.applied&since=<ms>&install=<id>
//                                 -> { ok, total, counts, matched, events } newest first
//   DELETE /api/admin/telemetry/:id            -> { ok, id } | 404
//   DELETE /api/admin/telemetry?install=<id>   -> { ok, install, deleted } (a privacy request: every event of an install)
//   Admin: `Authorization: Bearer <HH_ADMIN_TOKEN>` exactly like the ideas admin (constant-time compare; 401 / 403;
//   429 after 10 failures from one address in 15 minutes). No token (or a short one): no admin routes at all.
//
// Servers send these, not browsers: no Origin is required, no cookie is read or set. Nothing about the sender is
// stored: the per-address limit keys on a salted HMAC of the address that lives in memory only (a new salt per
// process); the stored row is the checked payload (every string scrubbed again) plus the time it arrived.
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { WindowLimiter, clientIp } from '../ip-limits.js';
import { sameSecret } from '../ideas.js';
import { checkPayload, EVENTS } from './payload.js';
import { TelemetryStore } from './store.js';
import { MAX_PAYLOAD_BYTES, RECEIVE_LIMITS, TELEMETRY_KEEP_MS } from './config.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MIN_TOKEN = 24;
const HEX128 = /^[0-9a-f]{32}$/;

/** Failures per key in a sliding window (admin auth), as in server/ideas.js. */
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

function safeJson(res, status, body) {
  res.status(status).type('application/json').send(JSON.stringify(body).replace(/</g, '\\u003c'));
}

/**
 * Mount the receiver and its admin routes on `app`. Options: { dataDir, log, perDay?, adminToken?, trustProxy?, wall?,
 * limiters?: [] (the host's prune list), sweepers?: [] (the farm registry's hourly sweep; else an own hourly timer) }.
 * Returns { store, ingest(payload) -> Promise<{ status, body, retryAfter? }>, sweep(now), stop() }; `ingest` stores an
 * event built on this very server (multi mode on the official host: no HTTP round trip to itself), through the same
 * checks and limits as a POST.
 */
export function mountTelemetryReceiver(app, { dataDir, log, perDay = RECEIVE_LIMITS.perDay, adminToken = null, trustProxy = 0,
  wall = Date.now, limiters = null, sweepers = null }) {
  const store = new TelemetryStore(path.join(dataDir, 'telemetry'), { wall }).load();
  const salt = crypto.randomBytes(32);
  const keyOf = (req) => crypto.createHmac('sha256', salt).update(clientIp(req, trustProxy)).digest('base64url').slice(0, 22);
  const perAddress = new WindowLimiter([[HOUR, RECEIVE_LIMITS.perAddressHour]], wall);
  const fails = new FailWindow(15 * 60_000, 10, wall);
  limiters?.push(perAddress, fails);
  let timer = null;

  const sweep = async (now = wall()) => {
    const telemetry = await store.expire(now - TELEMETRY_KEEP_MS);
    if (telemetry) log.info('shared helper events older than 365 days were deleted', { telemetry });
    return { telemetry };
  };
  if (sweepers) sweepers.push(sweep);
  else {
    sweep().catch((err) => log.error('telemetry retention sweep failed', { err: String(err && err.code || err && err.message) }));
    timer = setInterval(() => { sweep().catch(() => {}); }, HOUR);
    timer.unref?.();
  }

  /** Check and store one event: { status, body }. */
  const take = async (body) => {
    const c = checkPayload(body);
    if (!c.ok) return { status: 400, body: { error: 'BAD_ARGS', field: c.field } };
    if (store.rows.has(c.payload.id)) return { status: 202, body: { ok: true, id: c.payload.id } };   // a retry: stored once
    if (store.recent(DAY) >= perDay) return { status: 503, body: { error: 'FULL' } };
    if (store.recent(DAY, c.payload.install) >= RECEIVE_LIMITS.perInstallDay) {
      return { status: 429, body: { error: 'RATE', retryAfter: 3600 }, retryAfter: 3600 };
    }
    const { row } = await store.add(c.payload);
    return { status: 202, body: { ok: true, id: row.id } };
  };

  const api = express.Router();
  api.post('/', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const r = perAddress.take(keyOf(req));
    if (!r.ok) {
      const s = Math.ceil(r.retryAfterMs / 1000);
      return res.set('Retry-After', String(s)).status(429).json({ error: 'RATE', retryAfter: s });
    }
    return next();
  }, express.json({ limit: MAX_PAYLOAD_BYTES, strict: true }), async (req, res) => {
    try {
      const out = await take(req.body);
      if (out.retryAfter) res.set('Retry-After', String(out.retryAfter));
      return res.status(out.status).json(out.body);
    } catch (err) {
      log.error('saving a shared helper event failed', { err: String(err && err.code || err && err.message) });
      return res.status(500).json({ error: 'INTERNAL' });
    }
  });
  // a body over the limit or not JSON: a plain answer, never express's HTML error page
  api.use((err, req, res, next) => {
    if (!err) return next();
    res.set('Cache-Control', 'no-store');
    if (err.type === 'entity.too.large' || err.status === 413) return res.status(413).json({ error: 'TOO_BIG' });
    return res.status(400).json({ error: 'BAD_ARGS', field: 'body' });
  });
  app.use('/api/telemetry', api);

  const token = typeof adminToken === 'string' ? adminToken : '';
  if (token.length >= MIN_TOKEN) {
    const admin = express.Router();
    admin.use((req, res, next) => {
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
    admin.get('/', (req, res) => {
      const q = req.query;
      const event = typeof q.event === 'string' && q.event ? q.event : null;
      if (event && !EVENTS.includes(event)) return res.status(400).json({ error: 'BAD_ARGS', field: 'event' });
      const install = typeof q.install === 'string' && q.install ? q.install : null;
      if (install && !HEX128.test(install)) return res.status(400).json({ error: 'BAD_ARGS', field: 'install' });
      const n = Number(q.limit ?? 50);
      const limit = Number.isSafeInteger(n) && n > 0 ? Math.min(n, 1000) : 50;
      const s = Number(q.since ?? 0);
      const since = Number.isSafeInteger(s) && s > 0 ? s : null;
      return safeJson(res, 200, { ok: true, ...store.list({ limit, event, since, install }) });
    });
    admin.delete('/', async (req, res) => {
      const install = typeof req.query.install === 'string' ? req.query.install : '';
      if (!HEX128.test(install)) return res.status(400).json({ error: 'BAD_ARGS', field: 'install' });
      try {
        const deleted = await store.removeInstall(install);
        log.info('shared helper events of one install were deleted on request', { deleted });
        return safeJson(res, 200, { ok: true, install, deleted });
      } catch (err) {
        log.error('deleting shared helper events failed', { err: String(err && err.code || err && err.message) });
        return res.status(500).json({ error: 'INTERNAL' });
      }
    });
    admin.delete('/:id', async (req, res) => {
      const { id } = req.params;
      if (!HEX128.test(id) || !store.rows.has(id)) return res.status(404).json({ error: 'NOT_FOUND' });
      try {
        if (!(await store.remove(id))) return res.status(404).json({ error: 'NOT_FOUND' });
        log.info('a shared helper event was deleted on request');
        return safeJson(res, 200, { ok: true, id });
      } catch (err) {
        log.error('deleting a shared helper event failed', { err: String(err && err.code || err && err.message) });
        return res.status(500).json({ error: 'INTERNAL' });
      }
    });
    app.use('/api/admin/telemetry', admin);
  } else if (token) {
    log.warn(`HH_ADMIN_TOKEN is shorter than ${MIN_TOKEN} characters: the telemetry admin routes stay off`);
  }

  return {
    store,
    ingest: take,
    sweep,
    stop() { if (timer) clearInterval(timer); timer = null; return store.queue; },
  };
}
