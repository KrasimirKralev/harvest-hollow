// HTTP: static client, shared modules, vendored three.js, status, and dev routes (HH_DEV=1, loopback only).
//
// Caching and compression (SV-05) and the build identity (SV-03): server/static.js. In short: index.html is
// rendered with the build hash and an import map that gives every module a content-hashed URL (cached for a year,
// `immutable`); other `?v=` URLs are immutable too; anything unversioned revalidates (`no-cache` + ETag), so a
// reload after a server update always picks up new code; /vendor/three without a version is cached for a week;
// text-like files, GLB and WAV are served gzip'ed; model families and the sounds also come as one pack each (qa2 SV-03).
import path from 'node:path';
import express from 'express';
import { CONTENT_HASH } from '../shared/content/index.js';
import { RULES_VERSION } from '../shared/rules/index.js';
import { PROTOCOL_VERSION } from '../shared/net/protocol.js';
import { StaticFiles, REVALIDATE } from './static.js';

const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

/** express.static options: the Cache-Control decided by StaticFiles.serveFiles (res.locals), else revalidate. */
const staticOpts = { etag: true, lastModified: true,
  setHeaders: (res) => res.setHeader('Cache-Control', res.locals.cacheControl || REVALIDATE) };

/** The /api/status body (also logged by tools): no secrets, safe on the LAN. */
export function status(hh) {
  const now = hh.clock.now();
  const ps = hh.persist.stats;
  return {
    ok: !hh.engine.degraded && !ps.lastError,
    degraded: hh.engine.degraded,
    version: hh.cfg.version,
    proto: PROTOCOL_VERSION,
    rules: RULES_VERSION,
    contentHash: CONTENT_HASH,
    buildHash: hh.static ? hh.static.build : null,
    schema: hh.engine.state.schema,
    v: hh.engine.v,
    serverNow: now,
    startedAt: hh.startedAt,
    uptimeS: Math.floor((Date.now() - hh.startedAt) / 1000),
    tz: hh.engine.state.meta.tz,
    dev: hh.cfg.dev,
    slots: hh.sessions.slotList(),
    online: hh.sessions.onlinePids().sort(),
    connections: hh.sessions.conns.size,
    save: { lastAt: ps.lastSaveAt, lastV: ps.lastSaveV, lastBackupAt: ps.lastBackupAt, lastError: ps.lastError,
      journaled: ps.journaled },
    nextSystemDueAt: hh.scheduler.dueAt,
    // where server time goes (qa2 SV-02, server/perf.js): act, output wait, due wake-ups, loop delay, snapshots
    perf: hh.perf ? hh.perf.status(ps.timing || null) : null,
  };
}

/** @param {object} hh  the server context ({ cfg, engine, sessions, clock, scheduler, persist, static? }) */
export function createApp(hh) {
  const { root } = hh.cfg;
  hh.static ??= new StaticFiles({ root, log: hh.log });
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
  app.use(hh.static.serveIndex());
  app.use(hh.static.servePacks());          // /assets/packs/<id>.bin: a model family or the sounds in one response (qa2 SV-03)
  app.use(hh.static.serveFiles());
  app.use('/vendor/three', express.static(path.join(root, 'node_modules', 'three'), staticOpts));
  app.use('/shared', express.static(path.join(root, 'shared'), staticOpts));
  app.use(express.static(path.join(root, 'public'), staticOpts));

  app.get('/api/status', (_req, res) => res.json(status(hh)));

  if (hh.cfg.dev) {
    const dev = express.Router();
    dev.use((req, res, next) => (isLoopback(req.socket.remoteAddress) ? next() : res.status(403).json({ error: 'loopback only' })));
    dev.use(express.json({ limit: '4kb' }));
    // Jump game time forward. Due system actions run at once, as the scheduler would have run them.
    dev.post('/warp', (req, res) => {
      const ms = Number(req.body && req.body.ms);
      if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 400 * 86_400_000) return res.status(400).json({ error: 'ms' });
      const now = hh.clock.warp(ms);
      hh.engine.runDue();
      hh.scheduler.arm();
      return res.json({ ok: true, serverNow: now });
    });
    // Cut a player's sockets (simulated sleep / Wi-Fi drop); the client reconnects on its own.
    dev.post('/drop', (req, res) => {
      const pid = req.body && req.body.pid;
      if (typeof pid !== 'string') return res.status(400).json({ error: 'pid' });
      return res.json({ ok: true, dropped: hh.sessions.drop(pid) });
    });
    // Force a snapshot now (tests use it before a restart).
    dev.post('/save', async (_req, res) => {
      await hh.scheduler.save();
      res.json({ ok: true, v: hh.engine.v });
    });
    app.use('/api/dev', dev);
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
  return app;
}
