// The agent lane's HTTP surface (harness contract §4.3, §5.2, §5.3, §5.5).
//
// Farm routes (mounted by server/harness/index.js under /api/harness or /api/f/:id/harness; JSON, no-store, 8 KB):
//   GET  /jobs/current                         { job }
//   POST /jobs                { prompt, provider, model?, lang }   202 { job } · 409 BUSY · 428 SIGN_IN · 429 RATE · 400 · 503
//   POST /jobs/:jobId/revise  { prompt }       202 { job } · 409 NOT_READY · 403 NOT_YOURS
//   POST /jobs/:jobId/apply                    200 { active } · 409 STALE · 409 NOT_READY · 403 NOT_YOURS
//   POST /jobs/:jobId/discard                  200 { job }
//   POST /jobs/:jobId/cancel                   200 { job }
//   GET  /providers                            { providers: Provider[] }
//   GET  /providers/:id/models                 { models: [{ id, label }] }
//   GET  /providers/:id/signin                 SignInState
//   POST /providers/:id/signin    { method? }  SignInState (claude: method claudeai|console|sso, all the binary offers)
//   POST /providers/:id/signin/continue { code? | redirectUrl? }  SignInState
//   POST /providers/:id/signout                SignInState
//   POST /providers/:id/signin/cancel          SignInState (release 1.0, H4: a pending sign-in nobody finished ends; a
//                                              Claude Code login child is killed; a signed-in account is kept)
// Global routes (loopbackRoutes(app)):
//   POST /internal/agent/:jobId/(validate|preview)   the MCP bridge; loopback callers with the job's token only
//   GET  /auth/callback                              Sign in with ChatGPT's loopback redirect (matched by `state`)
//   GET  /api/harness/mock/signin?state=             the mock provider's sign-in page (HH_HARNESS_MOCK=1 only)
import express from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, publicJob } from './runtime.js';
import { isLoopback } from '../http.js';

const CALLBACK_PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'harness-callback.html');
const CODES = new Set(['DENIED', 'EXPIRED', 'BAD_CODE', 'STATE', 'USAGE_LIMIT', 'UNAVAILABLE', 'INTERNAL']);

/** A sliding-window counter per key (sign-in starts spawn processes / open OAuth flows: keep them few). */
function windowLimiter(max, ms, now = Date.now) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const list = (hits.get(key) || []).filter((x) => t - x < ms);
    if (list.length >= max) { hits.set(key, list); return Math.ceil((list[0] + ms - t) / 1000); }
    list.push(t);
    hits.set(key, list);
    if (hits.size > 10_000) hits.delete(hits.keys().next().value);
    return 0;
  };
}

function sameOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (origin && req.method !== 'GET') {
    let ok = false;
    try { ok = new URL(origin).host === req.headers.host; } catch { ok = false; }
    if (!ok) return res.status(403).json({ error: 'ORIGIN' });
  }
  return next();
}

/** Serve the callback page with the outcome stamped on <body> (the page shows it in the device's language). */
export async function sendCallbackPage(res, { ok, code }) {
  let html;
  try { html = await fsp.readFile(CALLBACK_PAGE, 'utf8'); } catch { html = '<!doctype html><title>Harness Hollow</title><body data-result="RESULT" data-code="CODE"></body>'; }
  // success stamps OK, a code no "what went wrong" line answers to (QA r1 H-02: an empty code showed the INTERNAL line
  // under "You are signed in")
  const safeCode = ok ? 'OK' : CODES.has(code) ? code : 'INTERNAL';
  html = html.replace('data-result="RESULT"', `data-result="${ok ? 'ok' : 'error'}"`).replace('data-code="CODE"', `data-code="${safeCode}"`);
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self'; font-src 'self'; frame-ancestors 'none'" });
  res.status(ok ? 200 : 400).type('html').send(html);
}

/**
 * @param {{ ctx: object, runtime: import('./runtime.js').Runtime, providers: Record<string, object>, log: object,
 *   pushSignIn: (fk: string, pid: string, provider: string, state: object) => void }} o
 */
export function createRoutes({ ctx, runtime, providers, log, pushSignIn }) {
  const signinLimit = windowLimiter(10, 3_600_000);
  const continueLimit = windowLimiter(30, 3_600_000);

  const who = async (req) => {
    const w = req.harness || req.hx;
    if (w && typeof w.farmKey === 'string' && typeof w.pid === 'string') return w;
    if (req.harnessError) throw req.harnessError;          // the harness router already asked (and was refused)
    return ctx.auth(req);
  };

  const wrap = (fn) => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent && out !== undefined) res.json(out);
    } catch (err) {
      if (res.headersSent) return;
      if (err instanceof HttpError) return res.status(err.status).json(err.body);
      if (err && Number.isInteger(err.status) && typeof err.error === 'string') return res.status(err.status).json({ error: err.error });
      log.error('agent route failed', { path: req.path }, err instanceof Error ? err : undefined);
      res.status(500).json({ error: 'INTERNAL' });
    }
  };

  const providerOf = (id) => {
    if (!Object.prototype.hasOwnProperty.call(providers, id)) throw new HttpError(404, 'NOT_FOUND');
    return providers[id];
  };

  /** Mounts /jobs/... and /providers/... on the harness router (each with its own body parser and checks, so the
   *  other lanes' routes on the same router are untouched). */
  function routes(router) {
    const jobs = express.Router({ mergeParams: true });
    const prov = express.Router({ mergeParams: true });
    for (const r of [jobs, prov]) {
      r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
      r.use(sameOrigin);
      r.use(express.json({ limit: '8kb' }));
    }

    jobs.get('/current', wrap(async (req) => {
      const { farmKey } = await who(req);
      return { job: publicJob(await runtime.current(farmKey)) };
    }));
    jobs.post('/', wrap(async (req, res) => {
      const { farmKey, pid } = await who(req);
      const job = await runtime.start(farmKey, pid, req.body || {});
      res.status(202);
      return { job };
    }));
    jobs.post('/:jobId/revise', wrap(async (req, res) => {
      const { farmKey, pid } = await who(req);
      const job = await runtime.revise(farmKey, pid, req.params.jobId, req.body || {});
      res.status(202);
      return { job };
    }));
    jobs.post('/:jobId/apply', wrap(async (req) => {
      const { farmKey, pid } = await who(req);
      return runtime.apply(farmKey, pid, req.params.jobId);
    }));
    jobs.post('/:jobId/discard', wrap(async (req) => {
      const { farmKey, pid } = await who(req);
      return { job: await runtime.discard(farmKey, pid, req.params.jobId) };
    }));
    jobs.post('/:jobId/cancel', wrap(async (req) => {
      const { farmKey, pid } = await who(req);
      return { job: await runtime.cancel(farmKey, pid, req.params.jobId) };
    }));

    prov.get('/', wrap(async (req) => {
      const { farmKey, pid } = await who(req);
      return { providers: await runtime.providerList(farmKey, pid) };
    }));
    prov.get('/:id/models', wrap(async (req) => {
      const { farmKey, pid } = await who(req);
      const p = providerOf(req.params.id);
      const av = await p.available();
      if (!av.ok) throw new HttpError(503, 'UNAVAILABLE', { reason: av.reason });
      try {
        const list = await p.models(runtime.userOf(farmKey, pid));
        // harvey#13: which one "Recommended" is (the UI says it)
        const def = typeof p.defaultModel === 'function' ? p.defaultModel(list) : null;
        return { models: list, ...(def ? { default: def.id } : {}) };
      } catch (err) {
        if (err && err.code === 'SIGN_IN') throw new HttpError(428, 'SIGN_IN', { provider: p.id });
        throw new HttpError(502, 'PROVIDER');
      }
    }));
    prov.get('/:id/signin', wrap(async (req) => {
      const { farmKey, pid } = await who(req);
      return providerOf(req.params.id).signIn.status(runtime.userOf(farmKey, pid));
    }));
    prov.post('/:id/signin', wrap(async (req) => {
      const { farmKey, pid } = await who(req);
      const p = providerOf(req.params.id);
      const wait = signinLimit(`${farmKey}/${pid}`);
      if (wait) throw new HttpError(429, 'RATE', { retryAfter: wait });
      const method = req.body && typeof req.body.method === 'string' ? req.body.method : undefined;
      return p.signIn.start(runtime.userOf(farmKey, pid), { method });
    }));
    prov.post('/:id/signin/continue', wrap(async (req) => {
      const { farmKey, pid } = await who(req);
      const p = providerOf(req.params.id);
      const wait = continueLimit(`${farmKey}/${pid}`);
      if (wait) throw new HttpError(429, 'RATE', { retryAfter: wait });
      const b = req.body || {};
      const st = await p.signIn.continue(runtime.userOf(farmKey, pid), {
        code: typeof b.code === 'string' ? b.code : undefined, redirectUrl: typeof b.redirectUrl === 'string' ? b.redirectUrl : undefined });
      if (st.state === 'signed_in') pushSignIn(farmKey, pid, p.id, st);
      return st;
    }));
    prov.post('/:id/signin/cancel', wrap(async (req) => {
      const { farmKey, pid } = await who(req);
      const p = providerOf(req.params.id);
      const user = runtime.userOf(farmKey, pid);
      const st = typeof p.signIn.cancel === 'function' ? await p.signIn.cancel(user) : await p.signIn.status(user);
      pushSignIn(farmKey, pid, p.id, st);
      return st;
    }));
    prov.post('/:id/signout', wrap(async (req) => {
      const { farmKey, pid } = await who(req);
      const p = providerOf(req.params.id);
      const st = await p.signIn.signOut(runtime.userOf(farmKey, pid));
      pushSignIn(farmKey, pid, p.id, st);
      return st;
    }));
    jobs.use(bodyErrors);
    prov.use(bodyErrors);
    router.use('/jobs', jobs);
    router.use('/providers', prov);
    return router;
  }

  function loopbackRoutes(app) {
    const loopbackOnly = (req, res, next) => (isLoopback(req.socket.remoteAddress) ? next() : res.status(403).json({ error: 'loopback only' }));
    app.post('/internal/agent/:jobId/:op', loopbackOnly, express.json({ limit: '4kb' }), wrap(async (req) => {
      const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(String(req.headers.authorization || ''));
      res403IfMissing(m);
      return runtime.bridge(req.params.jobId, m[1], req.params.op);
    }), bodyErrors);
    app.get('/auth/callback', async (req, res) => {
      try {
        const p = providers.chatgpt;
        const q = Object.fromEntries(Object.entries(req.query).filter(([, v]) => typeof v === 'string'));
        const out = p && p.owns(q.state) ? await p.callback(q) : null;
        if (!out) return sendCallbackPage(res, { ok: false, code: 'STATE' });
        pushSignIn(out.user.farmKey, out.user.pid, 'chatgpt', out.state);
        return sendCallbackPage(res, { ok: out.state.state === 'signed_in', code: out.state.error && out.state.error.code });
      } catch (err) {
        log.error('agent: sign-in callback failed', err instanceof Error ? err : undefined);
        return sendCallbackPage(res, { ok: false, code: 'INTERNAL' });
      }
    });
    if (providers.mock) {
      app.get('/api/harness/mock/signin', async (req, res) => {
        const out = await providers.mock.callback({ state: typeof req.query.state === 'string' ? req.query.state : '' });
        return sendCallbackPage(res, out ? { ok: true } : { ok: false, code: 'STATE' });
      });
    }
  }

  return { routes, loopbackRoutes };
}

/** A body the JSON parser refused is a plain 413 / 400 answer, not a logged stack. */
// eslint-disable-next-line no-unused-vars
function bodyErrors(err, _req, res, next) {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'TOO_BIG' });
  if (err && (err.type === 'entity.parse.failed' || err.type === 'encoding.unsupported')) return res.status(400).json({ error: 'BAD_ARGS' });
  return next(err);
}

function res403IfMissing(m) {
  if (!m) throw new HttpError(403, 'AUTH');
}
