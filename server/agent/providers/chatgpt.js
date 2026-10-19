// ChatGPT provider: Sign in with ChatGPT (open-source token sharing) + the Responses API with our six function tools
// (harness contract §5.3; PROVIDER RULES in docs/agent-briefs/harness-overview.md; the protocol: ../oauth-openai.js).
//
// Storage (per farmer, never logged, never in telemetry or a job file):
//   <users/<pid>>/openai/current.json                      { client_id, file }  the selected account
//   <users/<pid>>/openai/<issued client_id>/<sub>.json     the token record (0600, written tmp + rename)
//   <host dir>/openai-client.json                          { ext_agent_host_id: 'urn:uuid:<v4>' }, one per server
// The docs key a registration (its issued `oaiapp_…` client id) to one ChatGPT account, so the issued client id is
// kept per farmer and account (the contract's single host-wide client id would pair one account's registration with
// another account's tokens, which the docs forbid); the host id stays one per server.
//
// Sign-in: start() answers `open_url` (the authorize URL) with `paste: { field: 'redirect_url' }`: the page that opens
// on the server's own machine finishes through GET /auth/callback; on any other device the player pastes the final
// address and continue({ redirectUrl }) takes code + state from it. `state` is single-use, per farmer, 10 minutes.
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createOpenAIAuth, OAuthError, DYNAMIC_CLIENT, DIRECT_SCOPE, DEAD_REFRESH, pkce, randomToken, scopesOf, decodeJwt }
  from '../oauth-openai.js';
import { ensureDir, readJson, writeJson } from '../fsutil.js';
import { TOOL_SPECS } from '../tools.js';
import { SYSTEM_PROMPT, FIRST_MESSAGE } from '../workspace.js';

const PENDING_MS = 10 * 60_000;
const MAX_TURNS = 40;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const userKey = (u) => `${u.farmKey}/${u.pid}`;

/** 'f***@example.com' — enough for a farmer to recognise the account, nothing more. */
export function maskEmail(email) {
  const m = /^([^@\s]{1,64})@([^@\s]{1,255})$/.exec(String(email || ''));
  return m ? `${m[1][0]}***@${m[2]}` : 'ChatGPT';
}

/** A provider-side failure carried to the runtime / routes as a SignInState error or a RunEnd code. */
class ProviderError extends Error {
  constructor(code, detail) { super(detail || code); this.code = code; this.detail = detail || null; }
}

/** Parse a fetch Response's SSE body into { event, data } objects. */
export async function* sse(body) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      let event = null;
      const data = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (!data.length) continue;
      const raw = data.join('\n');
      if (raw === '[DONE]') return;
      let json = null;
      try { json = JSON.parse(raw); } catch { continue; }
      yield { event: event || (json && json.type), data: json };
    }
  }
}

/**
 * @param {{ cfg: object, log: object, hostDir: string, mode?: 'single'|'multi', redirectPort?: () => number,
 *   fetch?: typeof fetch, now?: () => number, retryMs?: number[] }} o
 */
/**
 * The default model by a preference list of known tool-capable models (harvey#13: the first one the API happens to list
 * was called "Recommended"), the full model before its mini or nano sibling; falls back to the list's first. Pure.
 */
export const MODEL_PREFERENCE = Object.freeze([/^gpt-6(?:[.\d]*)(?:-(?!mini|nano)[a-z]+)?$/, /^gpt-5\.5(?:-(?!mini|nano)[a-z]+)?$/,
  /^gpt-5(?:[.\d]*)(?:-(?!mini|nano)[a-z]+)?$/, /^gpt-6/, /^gpt-5/, /^gpt-4\.1/, /^o4/, /^o3/]);
export function defaultModel(list) {
  const ms = Array.isArray(list) ? list.filter((m) => m && typeof m.id === 'string') : [];
  for (const re of MODEL_PREFERENCE) {
    const hit = ms.find((m) => re.test(m.id));
    if (hit) return hit;
  }
  return ms[0] ?? null;
}

export function createProvider({ cfg, log, hostDir, mode = 'single', redirectPort = () => 3300, fetch: fetchFn = globalThis.fetch,
  now = Date.now, retryMs = [1000, 3000] }) {
  const auth = createOpenAIAuth({ authBase: cfg.openaiAuthBase, fetch: fetchFn, now });
  const pending = new Map();        // state -> entry
  const pendingOf = new Map();      // userKey -> state
  const locks = new Map();          // userKey -> Promise (refreshes are serialized per account)
  const modelCache = new Map();     // userKey -> { at, list }

  const openaiDir = (user) => path.join(user.dir, 'openai');

  async function hostId() {
    const file = path.join(hostDir, 'openai-client.json');
    const cur = await readJson(file);
    if (cur && typeof cur.ext_agent_host_id === 'string' && /^urn:uuid:[0-9a-f-]{36}$/.test(cur.ext_agent_host_id)) return cur.ext_agent_host_id;
    // chosen and saved before the first sign-in, opaque, one per server (docs: "agent host")
    const id = `urn:uuid:${crypto.randomUUID()}`;
    await writeJson(file, { ...(cur && typeof cur === 'object' ? cur : {}), ext_agent_host_id: id });
    return id;
  }

  async function loadRecord(user) {
    const cur = await readJson(path.join(openaiDir(user), 'current.json'));
    if (!cur || !SAFE_ID.test(cur.client_id || '') || !/^[a-f0-9]{32}\.json$/.test(cur.file || '')) return null;
    const rec = await readJson(path.join(openaiDir(user), cur.client_id, cur.file));
    return rec && rec.client_id === cur.client_id ? rec : null;
  }

  async function saveRecord(user, rec) {
    const file = `${crypto.createHash('sha256').update(rec.subject).digest('hex').slice(0, 32)}.json`;
    await ensureDir(path.join(openaiDir(user), rec.client_id));
    await writeJson(path.join(openaiDir(user), rec.client_id, file), rec);
    await writeJson(path.join(openaiDir(user), 'current.json'), { client_id: rec.client_id, file });
  }

  const usable = (rec) => Boolean(rec && rec.access_token && Array.isArray(rec.scopes) && rec.scopes.includes(DIRECT_SCOPE));

  function stateOf(user, rec) {
    const st = pendingOf.get(userKey(user));
    const p = st && pending.get(st);
    if (p && p.expiresAt > now()) {
      return { provider: 'chatgpt', state: 'pending', step: { kind: 'open_url', url: p.url, expiresAt: p.expiresAt, paste: { field: 'redirect_url' } } };
    }
    if (usable(rec)) return { provider: 'chatgpt', state: 'signed_in', account: { label: rec.label } };
    if (rec && rec.access_token) return { provider: 'chatgpt', state: 'error', account: { label: rec.label }, error: { code: 'DENIED' } };
    return { provider: 'chatgpt', state: 'signed_out' };
  }

  async function available() {
    if (cfg.chatgptOn === false) return { ok: false, reason: 'OFF' };   // HH_HELPER_CHATGPT=off (the operator's choice)
    if (mode === 'multi' && !cfg.chatgptHosting) return { ok: false, reason: 'HOST_NOT_ALLOWED' };
    return { ok: true };
  }

  async function start(user) {
    const av = await available();
    if (!av.ok) return { provider: 'chatgpt', state: 'error', error: { code: 'UNAVAILABLE' } };
    const rec = await loadRecord(user);
    const registration = !rec || !SAFE_ID.test(rec.client_id || '');
    const clientId = registration ? DYNAMIC_CLIENT : rec.client_id;
    const { verifier, challenge } = pkce();
    const state = randomToken();
    const nonce = randomToken();
    const redirectUri = `http://127.0.0.1:${redirectPort()}/auth/callback`;
    const url = auth.authorizeUrl({ clientId, hostId: await hostId(), redirectUri, state, nonce, challenge, registration,
      idTokenHint: rec && rec.id_token, loginHint: rec && rec.email,
      // the player chose "sign in" again after declining plan use: ask for consent again (docs: only then)
      consent: Boolean(rec && rec.access_token && !usable(rec)) });
    const old = pendingOf.get(userKey(user));
    if (old) pending.delete(old);
    pending.set(state, { user, verifier, nonce, clientId, registration, redirectUri, url, prevSub: rec && rec.subject,
      expiresAt: now() + PENDING_MS });
    pendingOf.set(userKey(user), state);
    return stateOf(user, rec);
  }

  /** Finish a sign-in from the callback's query. Returns { user, state } (the SignInState) or null for an unknown state. */
  async function complete(params) {
    const state = typeof params.state === 'string' ? params.state : '';
    const p = pending.get(state);
    if (!p) return null;
    pending.delete(state);                                  // single use, whatever happens next
    if (pendingOf.get(userKey(p.user)) === state) pendingOf.delete(userKey(p.user));
    const err = (code) => ({ user: p.user, state: { provider: 'chatgpt', state: 'error', error: { code } } });
    if (p.expiresAt <= now()) return err('EXPIRED');
    if (params.error) return err(params.error === 'access_denied' ? 'DENIED' : 'UNAVAILABLE');
    if (typeof params.code !== 'string' || !params.code) return err('BAD_CODE');
    let clientId = p.clientId;
    if (p.registration) {
      // a new registration must come back with its issued client id; never keep `dynamic_agent_client`
      if (typeof params.client_id !== 'string' || params.client_id === DYNAMIC_CLIENT || !SAFE_ID.test(params.client_id)) return err('STATE');
      clientId = params.client_id;
    } else if (params.client_id !== undefined && params.client_id !== p.clientId) {
      return err('STATE');
    }
    let tokens;
    try {
      tokens = await auth.exchange({ clientId, code: params.code, verifier: p.verifier, redirectUri: p.redirectUri });
    } catch (e) {
      log.warn('chatgpt sign-in: code exchange failed', { code: e.code || 'error' });
      return err(e.code === 'invalid_grant' ? 'BAD_CODE' : e.code === 'NETWORK' || e.status >= 500 ? 'UNAVAILABLE' : 'INTERNAL');
    }
    let claims;
    try {
      claims = await auth.verifyIdToken(tokens.id_token, { clientId, nonce: p.nonce });
    } catch (e) {
      log.warn('chatgpt sign-in: ID token refused', { why: e.message });
      return err(e.code === 'NETWORK' ? 'UNAVAILABLE' : 'STATE');
    }
    if (p.prevSub && !p.registration && claims.sub !== p.prevSub) return err('STATE');   // another account: keep the old one
    let scopes = scopesOf(tokens.scope);
    if (!scopes.length) { try { scopes = scopesOf(decodeJwt(tokens.access_token).claims.scope); } catch { scopes = []; } }
    const rec = { issuer: claims.iss, subject: claims.sub, client_id: clientId, email: typeof claims.email === 'string' ? claims.email : null,
      id_token: tokens.id_token, access_token: tokens.access_token, refresh_token: tokens.refresh_token || null,
      token_type: tokens.token_type || 'Bearer', expires_at: now() + (Number(tokens.expires_in) || 3600) * 1000, scopes,
      saved_at: new Date(now()).toISOString(), label: maskEmail(claims.email) };
    await saveRecord(p.user, rec);
    modelCache.delete(userKey(p.user));
    return { user: p.user, state: stateOf(p.user, rec) };
  }

  async function cont(user, { redirectUrl, code } = {}) {
    let params = null;
    if (typeof redirectUrl === 'string' && redirectUrl.length <= 4096) {
      try {
        const u = new URL(redirectUrl.trim());
        params = Object.fromEntries(u.searchParams);
      } catch { params = null; }
    } else if (typeof code === 'string') {
      params = null;                                      // ChatGPT needs the whole address (code + state)
    }
    const mine = pendingOf.get(userKey(user));
    if (!params || !params.state || params.state !== mine) {
      return { provider: 'chatgpt', state: 'error', error: { code: params ? 'STATE' : 'BAD_CODE' } };
    }
    const out = await complete(params);
    return out ? out.state : { provider: 'chatgpt', state: 'error', error: { code: 'EXPIRED' } };
  }

  async function status(user) {
    return stateOf(user, await loadRecord(user));
  }

  /** Release 1.0 (H4): a sign-in the player did not finish (another plan was chosen) is forgotten; a saved one stays. */
  async function cancel(user) {
    const st = pendingOf.get(userKey(user));
    if (st) { pending.delete(st); pendingOf.delete(userKey(user)); }
    return stateOf(user, await loadRecord(user));
  }

  async function signOut(user) {
    const st = pendingOf.get(userKey(user));
    if (st) { pending.delete(st); pendingOf.delete(userKey(user)); }
    const rec = await loadRecord(user);
    let revoked = null;
    if (rec && rec.refresh_token) revoked = await auth.revoke({ clientId: rec.client_id, refreshToken: rec.refresh_token });
    await fsp.rm(openaiDir(user), { recursive: true, force: true });
    modelCache.delete(userKey(user));
    return { provider: 'chatgpt', state: 'signed_out', ...(revoked === false ? { revoked: false } : {}) };
  }

  /** A fresh access token for the farmer (refreshing near expiry, one refresh at a time). Throws ProviderError. */
  function access(user, { force = false } = {}) {
    const key = userKey(user);
    const prev = locks.get(key) || Promise.resolve();
    const run = prev.then(async () => {
      const rec = await loadRecord(user);
      if (!rec || !rec.access_token) throw new ProviderError('SIGN_IN');
      if (!usable(rec)) throw new ProviderError('SIGN_IN', 'plan use not granted');
      if (!force && rec.expires_at - 60_000 > now()) return rec;
      if (!rec.refresh_token) throw new ProviderError('SIGN_IN', 'no refresh token');
      let t;
      try {
        t = await auth.refresh({ clientId: rec.client_id, refreshToken: rec.refresh_token });
      } catch (e) {
        if (e instanceof OAuthError && DEAD_REFRESH.has(e.code)) {
          // unusable: clear the tokens, keep the registration and the hints so the next sign-in reuses the client id
          await saveRecord(user, { ...rec, access_token: null, refresh_token: null, expires_at: 0 });
          throw new ProviderError('SIGN_IN', e.code);
        }
        throw new ProviderError(e.code === 'invalid_client' ? 'PROVIDER' : 'UNAVAILABLE', e.code);
      }
      // rotation: access + refresh + expiry + scopes are replaced together
      const next = { ...rec, access_token: t.access_token, refresh_token: t.refresh_token || rec.refresh_token,
        expires_at: now() + (Number(t.expires_in) || 3600) * 1000, scopes: t.scope ? scopesOf(t.scope) : rec.scopes,
        ...(t.id_token ? { id_token: t.id_token } : {}), saved_at: new Date(now()).toISOString() };
      await saveRecord(user, next);
      if (!usable(next)) throw new ProviderError('SIGN_IN', 'plan use not granted');
      return next;
    });
    const tail = run.then(() => {}, () => {});          // never rejects: the next caller waits, then reads the file again
    locks.set(key, tail);
    tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
    return run;
  }

  const api = (p) => `${cfg.openaiApiBase}${p}`;

  /** The model a job uses when the farmer picked none (harvey#13): see `defaultModel`. */
  const pick = (list) => defaultModel(list);

  async function models(user) {
    const hit = modelCache.get(userKey(user));
    if (hit && now() - hit.at < 600_000) return hit.list;
    const get = async (force) => {
      const rec = await access(user, { force });
      return fetchFn(api('/models'), { headers: { Authorization: `Bearer ${rec.access_token}` }, signal: AbortSignal.timeout(15_000) });
    };
    let res = await get(false);
    // an access token the server stopped accepting before its expiry: one refresh, then ask again (as the Responses
    // loop does); a terminal refresh error inside access() is what confirms the sign-in is gone
    if (res.status === 401) { await res.body?.cancel().catch(() => {}); res = await get(true); }
    if (!res.ok) {
      const { code } = await errorOf(res, 'models');
      if (code) {
        const mapped = mapErrorCode(code, { refreshed: true });
        if (mapped !== 'PROVIDER') throw new ProviderError(mapped, code);
      }
      if (res.status === 401) throw new ProviderError('SIGN_IN');
      throw new ProviderError('PROVIDER', `models answered ${res.status}`);
    }
    const body = await res.json();
    const list = (Array.isArray(body && body.models) ? body.models : Array.isArray(body && body.data) ? body.data : [])
      .filter((m) => m && m.visibility === 'list' && typeof m.slug === 'string')
      .map((m) => ({ id: m.slug, label: typeof m.display_name === 'string' ? m.display_name : m.slug }));
    modelCache.set(userKey(user), { at: now(), list });
    return list;
  }

  const sleep = (ms, signal) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

  /**
   * Read a non-2xx answer: { code, param, detail }. The status, the code and OpenAI's request id go to the server log
   * (the errors page: keep them to diagnose a failure); the body's text and any token never do.
   */
  async function errorOf(res, what = 'responses') {
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    const e = body && body.error && typeof body.error === 'object' ? body.error : null;
    const code = e && typeof e.code === 'string' ? e.code : null;
    const requestId = String(res.headers.get('x-request-id') || res.headers.get('openai-request-id') || '').replace(/[^\w.:-]/g, '').slice(0, 80) || null;
    log.warn('chatgpt: request refused', { what, status: res.status, code, requestId });
    return { code, param: e && e.param, detail: body && typeof body.detail === 'string' ? 'detail' : null };
  }

  const runEndFor = (code, turns, detail) => ({ ok: false, code, turns, ...(detail ? { detail } : {}) });

  /**
   * A documented error code as a RunEnd / ProviderError code (developers.openai.com/siwc/token-sharing-open-source/
   * errors-and-recovery): the usage limit (the ui points to ChatGPT settings > Usage), plan use not available to this
   * account (`NOT_ELIGIBLE`: explained, never retried, no new sign-in), and an account the service could not confirm.
   * `invalid_user` is first diagnosed with one refresh (the caller retries); only a terminal refresh error confirms a
   * revocation (`SIGN_IN`, from access()). After a refresh that worked it is `ACCOUNT_CHECK`: the sign-in is kept.
   */
  function mapErrorCode(code, { refreshed = false } = {}) {
    if (code === 'subscription_sharing_usage_limit_exceeded') return 'USAGE_LIMIT';
    if (code === 'subscription_sharing_user_not_eligible') return 'NOT_ELIGIBLE';
    if (code === 'subscription_sharing_usage_unavailable' || code === 'subscription_sharing_user_unavailable') return 'UNAVAILABLE';
    if (code === 'subscription_sharing_invalid_user') return refreshed ? 'ACCOUNT_CHECK' : 'REFRESH';
    return 'PROVIDER';
  }
  /** Codes that end the run at once: retrying the same request would not change the answer. */
  const FINAL = new Set(['USAGE_LIMIT', 'NOT_ELIGIBLE', 'SIGN_IN', 'ACCOUNT_CHECK']);

  /**
   * One Responses request; returns { items, completed } or a RunEnd-shaped failure { fail }.
   */
  async function respond(user, body, io, state) {
    let refreshed = false;                 // one refresh per request, to tell a stale token from a lost account
    let force = false;                     // refresh before the next try (only right after a refusal asked for it)
    let attempt = 0;
    for (;;) {
      let rec;
      try { rec = await access(user, { force }); } catch (e) { return { fail: runEndFor(e.code || 'SIGN_IN', state.turns, e.detail) }; }
      force = false;
      let res;
      try {
        res = await fetchFn(api('/responses'), { method: 'POST', signal: io.signal,
          headers: { Authorization: `Bearer ${rec.access_token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify(body) });
      } catch (e) {
        if (io.signal && io.signal.aborted) return { fail: runEndFor('CANCELLED', state.turns) };
        if (attempt < retryMs.length) { await sleep(retryMs[attempt++], io.signal); continue; }
        return { fail: runEndFor('PROVIDER', state.turns, 'network') };
      }
      if (res.status === 401 && !refreshed) { refreshed = force = true; await errorOf(res); continue; }
      if (!res.ok) {
        const { code, param } = await errorOf(res);
        const mapped = code ? mapErrorCode(code, { refreshed }) : null;
        if (mapped === 'REFRESH') { refreshed = force = true; continue; }
        if (mapped === 'ACCOUNT_CHECK') return { fail: runEndFor(mapped, state.turns, code) };
        if (res.status === 401) return { fail: runEndFor('SIGN_IN', state.turns, code || 'unauthorized') };
        if (code === 'subscription_sharing_unsupported_capability' && param === 'include' && body.include) {
          delete body.include;                                // the route refuses reasoning items: go without them
          state.noInclude = true;
          continue;
        }
        if (FINAL.has(mapped)) return { fail: runEndFor(mapped, state.turns, code) };
        const transient = res.status === 429 || res.status >= 500;
        if (transient && attempt < retryMs.length) { await sleep(retryMs[attempt++], io.signal); continue; }
        return { fail: runEndFor(mapped === 'UNAVAILABLE' ? mapped : res.status === 503 ? 'UNAVAILABLE' : 'PROVIDER', state.turns,
          code || `http ${res.status}`) };
      }
      const items = [];
      let completed = false;
      let failed = null;
      try {
        for await (const { data } of sse(res.body)) {
          const type = data && data.type;
          if (type === 'response.output_text.delta' && typeof data.delta === 'string') io.emit({ type: 'text', text: data.delta });
          else if (type === 'response.output_item.done' && data.item) items.push(data.item);
          else if (type === 'response.completed') completed = true;
          else if (type === 'response.failed') failed = data.response && data.response.error && data.response.error.code || 'failed';
          else if (type === 'response.incomplete') failed = 'incomplete';
          else if (type === 'error') failed = data.code || (data.error && data.error.code) || 'error';
        }
      } catch {
        if (io.signal && io.signal.aborted) return { fail: runEndFor('CANCELLED', state.turns) };
        failed = 'interrupted';
      }
      if (failed) {
        const mapped = mapErrorCode(failed, { refreshed });
        if (mapped === 'REFRESH') { refreshed = force = true; continue; }  // diagnose with one refresh, then once more
        if (mapped === 'PROVIDER' && failed === 'interrupted' && attempt < retryMs.length) { await sleep(retryMs[attempt++], io.signal); continue; }
        log.warn('chatgpt: response failed', { code: String(failed).slice(0, 80) });
        return { fail: runEndFor(mapped, state.turns, failed) };
      }
      // success only after response.completed (docs); a stream that just stops is an interrupted one
      if (!completed) {
        if (attempt < retryMs.length) { await sleep(retryMs[attempt++], io.signal); continue; }
        return { fail: runEndFor('PROVIDER', state.turns, 'interrupted') };
      }
      return { items };
    }
  }

  /** The agent loop: request, run the function calls, send their outputs back, until a turn makes no call. */
  async function run(job, io) {
    const user = io.user;
    const state = { turns: 0, noInclude: false };
    let model = job.model;
    if (!model) {
      try { model = pick(await models(user))?.id || null; } catch (e) { return runEndFor(e.code || 'PROVIDER', 0, e.detail); }
      if (!model) return runEndFor('PROVIDER', 0, 'no model');
      job.model = model;
    }
    const tools = TOOL_SPECS.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: true }));
    const input = [{ role: 'user', content: [{ type: 'input_text', text: FIRST_MESSAGE }] }];
    while (state.turns < MAX_TURNS) {
      if (io.signal && io.signal.aborted) return runEndFor('CANCELLED', state.turns);
      state.turns++;
      const body = { model, instructions: SYSTEM_PROMPT, input, tools, store: false, stream: true,
        ...(state.noInclude ? {} : { include: ['reasoning.encrypted_content'] }) };
      const out = await respond(user, body, io, state);
      if (out.fail) return out.fail;
      const calls = [];
      for (const item of out.items) {
        const { status: _s, ...keep } = item;
        if (item.type === 'function_call') calls.push(item);
        if (item.type === 'reasoning' && state.noInclude) continue;
        if (item.type === 'function_call' || item.type === 'reasoning' || item.type === 'message') input.push(keep);
      }
      if (!calls.length) return { ok: true, turns: state.turns };
      for (const call of calls) {
        let args = {};
        try { args = call.arguments ? JSON.parse(call.arguments) : {}; } catch { args = null; }
        const tool = Object.prototype.hasOwnProperty.call(io.tools, call.name) ? io.tools[call.name] : null;
        const result = !tool ? { error: { code: 'UNKNOWN_TOOL', message: 'no such tool' } }
          : args === null ? { error: { code: 'BAD_ARGS', message: 'arguments are not JSON' } } : await tool(args);
        let output = JSON.stringify(result);
        if (output.length > 300_000) output = JSON.stringify({ error: { code: 'TOO_BIG', message: 'the answer was too big' } });
        input.push({ type: 'function_call_output', call_id: call.call_id, output });
      }
    }
    return runEndFor('MAX_TURNS', state.turns);
  }

  return {
    id: 'chatgpt',
    available,
    models,
    defaultModel: pick,
    signIn: { start, continue: cont, status, signOut, cancel },
    /** GET /auth/callback hands its query here (agent routes). */
    callback: complete,
    owns: (state) => pending.has(String(state || '')),
    run,
    cancel() { /* run() stops on io.signal */ },
    forget(farmKey) {
      for (const [st, p] of pending) if (p.user.farmKey === farmKey) { pending.delete(st); pendingOf.delete(userKey(p.user)); }
      for (const k of [...modelCache.keys()]) if (k.startsWith(`${farmKey}/`)) modelCache.delete(k);
    },
  };
}

export { ProviderError };
