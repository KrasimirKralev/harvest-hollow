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
import { AssetOrigin } from './asset-origin.js';
import { firstViewPacks, modelFileOf, packShares, PREFETCHABLE, SINGLE_SHARE } from '../shared/net/packs-plan.js';
import { spawnAt } from '../shared/rules/grid.js';
import { farmMethods } from './farm-host.js';

export const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

/**
 * WebSocket compression for big frames only (release 1.0 O5, option2#11): the welcome and resyncs (the owners'
 * farm: a 153 KB welcome deflates to ~29 KB) are the slow link's whole job once option 2 moves the game files, on every
 * boot and every reconnect; small deltas and pongs (< 8 KB) are sent as they are and keep their latency. A small window
 * and memLevel keep the per-socket zlib memory low; two compressions at once at most. Both servers use it.
 * This replaces tech-architecture decision 9 ("LAN bandwidth is free"): the owners play over a 85 KB/s link.
 */
export const WS_DEFLATE = Object.freeze({ threshold: 8192, concurrencyLimit: 2, serverMaxWindowBits: 13,
  zlibDeflateOptions: Object.freeze({ level: 6, memLevel: 7 }) });

/** express.static options: the Cache-Control decided by StaticFiles.serveFiles (res.locals), else revalidate. */
export const staticOpts = { etag: true, lastModified: true,
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
    // option 2: where the game files come from (null: this server only; server/asset-origin.js)
    assets: hh.assetOrigin ? hh.assetOrigin.status : null,
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

/**
 * The game's files after the page itself: option 2's /b/<build>/ guard first (both modes; `host: false` is
 * HH_ASSET_HOST=off), asset packs, versioned/gzip'ed files, vendored three.js, shared modules, public/. Shared by the
 * single-farm app and the multi-farm host (server/multi.js).
 */
export function mountAssets(app, staticFiles, root, { host = true } = {}) {
  app.use(staticFiles.serveBuild({ enabled: host }));
  app.use(staticFiles.servePacks());        // /assets/packs/<id>.bin: a model family or the sounds in one response (qa2 SV-03)
  app.use(staticFiles.serveFiles());
  app.use('/vendor/three', express.static(path.join(root, 'node_modules', 'three'), staticOpts));
  app.use('/shared', express.static(path.join(root, 'shared'), staticOpts));
  app.use(express.static(path.join(root, 'public'), staticOpts));
}

/**
 * Dev routes (HH_DEV=1, loopback only). `farmOf(req)` resolves the farm context a request acts on (the one farm in
 * single mode; /api/f/:id/dev/... in multi mode), or null for 404.
 */
export function devRouter(farmOf) {
  const dev = express.Router({ mergeParams: true });
  dev.use((req, res, next) => (isLoopback(req.socket.remoteAddress) ? next() : res.status(403).json({ error: 'loopback only' })));
  dev.use(express.json({ limit: '4kb' }));
  const withFarm = (fn) => async (req, res) => {
    const hh = await farmOf(req);
    if (!hh) return res.status(404).json({ error: 'not found' });
    return fn(hh, req, res);
  };
  // `hh` is a FarmHost (server/farm-host.js; a modded multi-mode farm runs in a worker) or a plain farm context.
  const call = (hh, m, ...a) => (typeof hh.call === 'function' ? hh.call(m, ...a) : farmMethods(hh)[m](...a));
  // Jump game time forward. Due system actions run at once, as the scheduler would have run them.
  dev.post('/warp', withFarm(async (hh, req, res) => {
    const ms = Number(req.body && req.body.ms);
    if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 400 * 86_400_000) return res.status(400).json({ error: 'ms' });
    const now = await call(hh, 'devWarp', ms);
    return res.json({ ok: true, serverNow: now });
  }));
  // Cut a player's sockets (simulated sleep / Wi-Fi drop); the client reconnects on its own.
  dev.post('/drop', withFarm(async (hh, req, res) => {
    const pid = req.body && req.body.pid;
    if (typeof pid !== 'string') return res.status(400).json({ error: 'pid' });
    return res.json({ ok: true, dropped: await call(hh, 'devDrop', pid) });
  }));
  // Force a snapshot now (tests use it before a restart).
  dev.post('/save', withFarm(async (hh, _req, res) => {
    const v = await call(hh, 'devSave');
    res.json({ ok: true, v });
  }));
  return dev;
}

/**
 * Option 2's first-view hint: the high-use model families near every farmer's spawn on this farm (shared/net/packs-plan.js),
 * which a host page starts before the welcome: only families this farm reads at least SINGLE_SHARE of (the others load
 * file by file, the client's per-member rule) and the farmers' avatars. [] when anything is missing (the page then waits
 * for the welcome).
 */
export function firstPacksHint(hh) {
  try {
    const state = hh.engine.state;
    const points = Object.keys(state.players || {}).map((pid) => spawnAt(state, pid));
    const fileOf = modelFileOf(hh.static.modelManifest());
    const shares = packShares(state, fileOf, hh.static.packIndex().index);
    return firstViewPacks(state, points, fileOf).filter((id) => PREFETCHABLE.includes(id)
      && (id === 'models-avatars' || (shares[id] ?? 0) >= SINGLE_SHARE));
  } catch {
    return [];
  }
}

/** @param {object} hh  the server context ({ cfg, engine, sessions, clock, scheduler, persist, static? }) */
export function createApp(hh) {
  const { root } = hh.cfg;
  hh.static ??= new StaticFiles({ root, log: hh.log });
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
  // option 2 (HH_ASSET_ORIGIN): the public host's build, checked now and every HH_ASSET_CHECK_MS; each page request
  // gets the host variant only when server/asset-origin.js says so, and a self page that may one day get it carries
  // the once-per-browser integrity probe
  const assets = hh.cfg.assets;
  if (assets?.origin && !hh.assetOrigin) {
    hh.assetOrigin = new AssetOrigin({ origin: assets.origin, probe: assets.probe, build: hh.static.build, everyMs: assets.checkMs,
      timeoutMs: assets.timeoutMs, log: hh.log });
    hh.assetOrigin.start();
  }
  app.use(hh.static.serveIndex((req) => {
    if (!hh.assetOrigin) return null;
    const base = hh.assetOrigin.baseFor(req);
    return { base, probe: true, hint: base ? firstPacksHint(hh) : null };
  }));
  app.use(hh.static.serveSriProbe());
  mountAssets(app, hh.static, root, { host: assets?.host !== false });

  app.get('/api/status', (_req, res) => res.json(status(hh)));

  if (hh.cfg.dev) app.use('/api/dev', devRouter(() => hh));
  // the in-game helper (Harness Hollow, server/harness): its REST base, the mod icons, the telemetry receiver
  if (hh.harness) {
    hh.harness.receiverRoutes(app);                // first: the agent's /api/harness/mock/... and loopback routes
    app.use('/api/harness', hh.harness.router);
    hh.harness.mountAssets(app);
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
  return app;
}
