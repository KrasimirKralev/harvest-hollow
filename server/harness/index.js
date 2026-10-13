// The in-game helper's router (Harness Hollow, docs/agent-notes/harness-contract.md §4.1, §7): auth, the HarnessCtx
// every lane's factory gets, and the mounting of the mods, agent and telemetry lanes' routes.
//
//   REST base  single: /api/harness     multi: /api/f/:id/harness       (JSON, no-store, same origin, 8 KB bodies)
//   Auth       Authorization: Bearer <the farmer's key>: single = the slot token (sessions.slotOfToken), multi = a seated
//              member's secret (invite, creator-only and rejoin tokens are refused). 401 AUTH without, 403 AUTH wrong.
//              The identity { farmKey, pid } rides on req.harness; a request never names another pid.
//   GET /state { enabled, providers, job, active, consent: { telemetry, sending }, limits }  (HH_HARNESS=off: { enabled: false })
//   Mods       GET /history, POST /undo (server/mods/index.js); icons GET [/f/:id]/mods/:hash/icons/:size/:id.png
//   Agent      /jobs/..., /providers/... (server/agent), its loopback routes and /auth/callback
//   Telemetry  GET/POST /consent (server/telemetry); the receiver POST /api/telemetry (multi, or HH_TELEMETRY_RECEIVE=1),
//              mounted even when the helper is off
// A lane whose factory is missing gets a stub that answers 503 UNAVAILABLE, so every lane can be tested alone.
//
// HarnessCtx = { cfg, log, mode, auth(req), dirOf(fk), hostDir, host(fk), push(fk, msg, { pid? }), toWorker?(fk, o),
//                mods, agent, telemetry, reg?, limiters? }
import path from 'node:path';
import express from 'express';
import { createMods } from '../mods/index.js';
import { LocalFarm } from '../farm-host.js';
import { harnessConfig } from '../config.js';
import { installOverlay } from '../../shared/mod/install.js';
import { MSG } from '../../shared/net/protocol.js';

const KEY_RE = /^[A-Za-z0-9_-]{16,256}$/;
const FARM_RE = /^[a-z2-7]{12}$/;

/** The farmer's key of a request: `Authorization: Bearer <key>` (also X-HH-Key). */
export function bearerOf(req) {
  const auth = req.headers.authorization;
  const m = typeof auth === 'string' ? /^Bearer\s+(\S+)$/i.exec(auth) : null;
  const k = m ? m[1] : req.headers['x-hh-key'];
  return typeof k === 'string' && KEY_RE.test(k) ? k : null;
}

const fail = (status, error) => Object.assign(new Error(error), { status, error });

function sameOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
    let ok = false;
    try { ok = new URL(origin).host === req.headers.host; } catch { ok = false; }
    if (!ok) return res.status(403).json({ error: 'ORIGIN' });
  }
  return next();
}

/** A lane that is not there yet: its routes answer 503 UNAVAILABLE. */
function stubAgent() {
  return {
    routes(router) {
      router.use(['/jobs', '/providers'], (_req, res) => res.status(503).json({ error: 'UNAVAILABLE' }));
    },
    state: async () => ({ enabled: true, providers: [], job: null, limits: null }),
    loopbackRoutes() {},
    listening() {},
    stop() {},
    onFarmDeleted() {},
    stub: true,
  };
}
function stubTelemetry() {
  return {
    consent: () => ({ telemetry: null, at: null, sending: false, install: null }),
    setConsent: () => { throw fail(503, 'UNAVAILABLE'); },
    record: async () => ({ queued: false, reason: 'OFF' }),
    routes(router) { router.use('/consent', (_req, res) => res.status(503).json({ error: 'UNAVAILABLE' })); },
    receiverRoutes() {},
    sweep: async () => 0,
    stop() {},
    onFarmDeleted() {},
    stub: true,
  };
}

async function lane(file, factory, ctx, stub, log) {
  let mod;
  try {
    mod = await import(file);
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).includes(file.replace('../', ''))) return stub();
    log.error(`the helper's ${factory} could not be loaded; that part is unavailable`, err);
    return stub();
  }
  if (typeof mod[factory] !== 'function') return stub();
  return mod[factory](ctx);
}

/**
 * Build the helper for one server. `o`: { cfg, log, mode, dirOf, hostDir, host, auth, push, toWorker?, reg?, limiters?,
 * farmKeyOfAsset(req) }.
 */
export async function buildHarness(o) {
  const { cfg, log, mode } = o;
  const hcfg = cfg.harness ?? harnessConfig({});
  const ctx = {
    cfg: { ...cfg, harness: hcfg }, log, mode, auth: o.auth, dirOf: o.dirOf, hostDir: o.hostDir, host: o.host,
    // no registry for the lanes: the telemetry receiver keeps its own hourly retention timer, because the registry's
    // `sweepers` list is what POST /api/dev/sweep reports (test/server.multi.test.js pins its shape)
    push: o.push, toWorker: o.toWorker ?? null, reg: null, limiters: o.limiters ?? null,
    mods: null, agent: null, telemetry: null,
  };
  ctx.mods = createMods(ctx);
  ctx.telemetry = await lane('../telemetry/index.js', 'createTelemetry', ctx, stubTelemetry, log);
  ctx.agent = await lane('../agent/index.js', 'createAgent', ctx, stubAgent, log);

  const router = express.Router({ mergeParams: true });
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(sameOrigin);
  router.use(express.json({ limit: '8kb' }));
  // who is asking (the lanes' routes read req.harness, or call ctx.auth themselves)
  router.use(async (req, _res, next) => {
    try { req.harness = await ctx.auth(req); } catch (err) { req.harnessError = err; }
    next();
  });
  const requireAuth = (req, res, next) => {
    if (req.harness) return next();
    const e = req.harnessError;
    return res.status(e && e.status ? e.status : 401).json({ error: e && e.error ? e.error : 'AUTH' });
  };
  router.get('/state', async (req, res) => {
    if (!hcfg.enabled) return res.json({ enabled: false });
    if (!req.harness) return requireAuth(req, res);
    const { farmKey: fk, pid } = req.harness;
    try {
      const a = await ctx.agent.state(fk, pid);
      if (a && a.enabled === false) return res.json({ enabled: false });
      const c = ctx.telemetry.consent(fk, pid) ?? {};
      return res.json({ enabled: true, providers: a?.providers ?? [], job: a?.job ?? null, active: ctx.mods.active(fk),
        consent: { telemetry: c.telemetry ?? null, sending: Boolean(c.sending) }, limits: a?.limits ?? null });
    } catch (err) {
      log.error('the helper state failed', err);
      return res.status(500).json({ error: 'INTERNAL' });
    }
  });
  if (hcfg.enabled) {
    const modsRouter = express.Router({ mergeParams: true });
    modsRouter.use(requireAuth);
    ctx.mods.routes(modsRouter);
    router.use(modsRouter);
    ctx.telemetry.routes(router);
    ctx.agent.routes(router);
  } else {
    // the consent choice stays reachable (a farmer may turn sharing off while the helper is off)
    ctx.telemetry.routes(router);
  }
  router.use((_req, res) => res.status(404).json({ error: hcfg.enabled ? 'NOT_FOUND' : 'OFF' }));

  return {
    ctx,
    router,
    enabled: hcfg.enabled,
    /** Mod icons (and nothing else under /mods/): single /mods/..., multi /f/:id/mods/... */
    mountAssets(app) {
      if (mode === 'multi') {
        const r = express.Router({ mergeParams: true });
        ctx.mods.assetRoutes(r, { farmKeyOf: (req) => (FARM_RE.test(req.params.id) && o.reg?.has(req.params.id) ? req.params.id : null) });
        app.use('/f/:id', r);
      } else {
        ctx.mods.assetRoutes(app, { farmKeyOf: () => 'local' });
      }
    },
    /** The telemetry receiver (+ admin) and the agent's loopback / callback routes: mounted before any /api catch-all. */
    receiverRoutes(app) {
      ctx.telemetry.receiverRoutes(app, { reg: null, limiters: o.limiters ?? null });
      if (hcfg.enabled) ctx.agent.loopbackRoutes(app);
    },
    listening(port) { ctx.agent.listening?.(port); },
    onFarmDeleted(fk) {
      for (const l of [ctx.agent, ctx.telemetry, ctx.mods]) {
        try { l.onFarmDeleted?.(fk); } catch (err) { log.error('a helper lane failed to forget a farm', err); }
      }
    },
    sweep: (now) => ctx.telemetry.sweep?.(now),
    async stop() {
      for (const l of [ctx.agent, ctx.telemetry, ctx.mods]) {
        try { await l.stop?.(); } catch (err) { log.error('a helper lane failed to stop', err); }
      }
      // single mode installed the farm's mod into this process's content: tests start many servers in one process
      if (mode === 'single') installOverlay(null);
    },
  };
}

/** Single mode: one farm ('local') in this process. */
export function createSingleHarness(hh) {
  const host = new LocalFarm(hh);
  hh.host = host;
  return buildHarness({
    cfg: hh.cfg, log: hh.log, mode: 'single',
    dirOf: () => path.join(hh.cfg.dataDir, 'harness'),
    hostDir: path.join(hh.cfg.dataDir, 'harness-host'),
    host: async () => host,
    async auth(req) {
      const key = bearerOf(req);
      if (!key) throw fail(401, 'AUTH');
      const who = await host.call('whoIs', key);
      if (!who) throw fail(403, 'AUTH');
      return { farmKey: 'local', pid: who.pid };
    },
    push(fk, msg, { pid = null } = {}) { host.methods.push(msg.t ? msg : { t: MSG.HX, ...msg }, { pid }); },
  });
}

/** Multi mode: each farm's harness lives in farms/<id>/harness (deleted with the farm). */
export function createMultiHarness(hh) {
  const { cfg, reg } = hh;
  const hostOf = async (fk) => {
    if (!FARM_RE.test(fk || '')) throw fail(404, 'NOT_FOUND');
    let rec;
    try { rec = await reg.acquire(fk); } catch { throw fail(503, 'UNAVAILABLE'); }
    if (!rec || !rec.host) throw fail(404, 'NOT_FOUND');
    reg.lease(rec);
    return rec.host;
  };
  return buildHarness({
    cfg, log: hh.log, mode: 'multi', reg, limiters: hh.limiters,
    dirOf: (fk) => path.join(cfg.dataDir, 'farms', fk, 'harness'),
    hostDir: path.join(cfg.dataDir, 'harness-host'),
    host: hostOf,
    async auth(req) {
      const fk = req.params && req.params.id;
      if (!FARM_RE.test(fk || '') || !reg.has(fk)) throw fail(404, 'NOT_FOUND');
      const key = bearerOf(req);
      if (!key) throw fail(401, 'AUTH');
      const host = await hostOf(fk);
      const g = await host.call('grantOf', key);
      if (!g || g.kind !== 'member') throw fail(403, 'AUTH');
      return { farmKey: fk, pid: g.pid };
    },
    push(fk, msg, { pid = null } = {}) {
      const rec = reg.rec(fk);
      const frame = msg.t ? msg : { t: MSG.HX, ...msg };
      if (rec && rec.host) rec.host.call('push', frame, { pid }).catch(() => {});
    },
    async toWorker(fk, opts) {
      const rec = reg.rec(fk);
      if (!rec) throw fail(404, 'NOT_FOUND');
      await reg.toWorker(rec, opts);
    },
  });
}
