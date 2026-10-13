// A local stand-in for the endpoints of Sign in with ChatGPT (open-source token sharing) and the Responses API, as
// the docs describe them (developers.openai.com/siwc/token-sharing-open-source/*). No test ever calls the real
// services. It checks what a real server would refuse (PKCE, redirect_uri, client ids, rotating refresh tokens,
// store:false + stream:true) and records every call for assertions.
//
//   const oa = await startMockOpenAI();     oa.base (auth base), oa.api (api base = base + '/v1'), oa.close()
//   oa.consent(authorizeUrl, { deny?, scope?, clientId? }) -> the final redirect URL the browser would land on
//   oa.script = [(body) => [items...] | { status, body } ...]   the Responses turns, one per request
import http from 'node:http';
import crypto from 'node:crypto';

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const FULL_SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

export function signJwt(claims, { privateKey, kid, alg = 'RS256' }) {
  const header = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = alg === 'none' ? '' : b64url(crypto.sign('sha256', Buffer.from(`${header}.${body}`), privateKey));
  return `${header}.${body}.${sig}`;
}

export async function startMockOpenAI({ email = 'farmer@example.com', sub = 'user-sub-1' } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'k1';
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' };
  const st = {
    calls: [], authorize: [], tokenCalls: [], revoked: [], responses: [], issued: 0,
    codes: new Map(), access: new Map(), refresh: new Map(), clients: new Set(),
    sub, email, accessTtl: 3600,
    idTokenTweak: null,                 // (claims) => claims | { sign: 'other' | 'none' }
    tokenError: null,                   // { status, body } once for the next token call
    refreshError: null,
    responsesErrors: [],                // [{ status, body, headers? } | { sse: [...] }] consumed before the script
    modelsErrors: [],                   // [{ status, body, headers? }] consumed before GET /models answers
    models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' }, { slug: 'internal-x', display_name: 'X', visibility: 'hide' }],
  };
  let base = '';
  const mock = { state: st, script: [], privateKey, kid };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

  function idToken(clientId, nonce) {
    let claims = { iss: base, aud: clientId, sub: st.sub, email: st.email, nonce, iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600 };
    let sign = { privateKey, kid };
    if (st.idTokenTweak) {
      const t = st.idTokenTweak(claims);
      if (t && t.sign === 'other') sign = { privateKey: other.privateKey, kid };
      else if (t && t.sign === 'none') sign = { privateKey, kid, alg: 'none' };
      else if (t) claims = t;
    }
    return signJwt(claims, sign);
  }

  function issueTokens(clientId, scope, nonce) {
    const access = `at_${crypto.randomBytes(12).toString('hex')}`;
    const refresh = `rt_${crypto.randomBytes(12).toString('hex')}`;
    st.access.set(access, { clientId, exp: Date.now() + st.accessTtl * 1000, scope });
    st.refresh.set(refresh, { clientId, scope, used: false, nonce });
    return { access_token: access, refresh_token: refresh, id_token: idToken(clientId, nonce), token_type: 'Bearer',
      expires_in: st.accessTtl, scope };
  }

  function bearer(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    const a = m && st.access.get(m[1]);
    return a && a.exp > Date.now() ? a : null;
  }

  const sse = (res, events) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    res.end();
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, base);
    st.calls.push(`${req.method} ${u.pathname}`);
    if (u.pathname === '/.well-known/openid-configuration') {
      return send(res, 200, { issuer: base, jwks_uri: `${base}/.well-known/jwks.json`, authorization_endpoint: `${base}/api/accounts/authorize`,
        token_endpoint: `${base}/api/accounts/oauth/token`, revocation_endpoint: `${base}/oauth/revoke` });
    }
    if (u.pathname === '/.well-known/jwks.json') return send(res, 200, { keys: [jwk] });
    if (u.pathname === '/oauth/revoke' && req.method === 'POST') {
      const f = new URLSearchParams(await readBody(req));
      st.revoked.push(Object.fromEntries(f));
      const r = st.refresh.get(f.get('token'));
      if (r) r.used = true;
      res.writeHead(200);
      return res.end();
    }
    if (u.pathname === '/api/accounts/oauth/token' && req.method === 'POST') {
      const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
      st.tokenCalls.push(f);
      if (st.tokenError) { const e = st.tokenError; st.tokenError = null; return send(res, e.status, e.body); }
      if (f.resource !== 'https://api.openai.com/v1') return send(res, 400, { error: 'invalid_target' });
      if (f.grant_type === 'authorization_code') {
        const c = st.codes.get(f.code);
        if (!c || c.used) return send(res, 400, { error: 'invalid_grant' });
        c.used = true;
        const challenge = b64url(crypto.createHash('sha256').update(f.code_verifier || '').digest());
        if (challenge !== c.challenge || f.redirect_uri !== c.redirect || f.client_id !== c.clientId) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, issueTokens(c.clientId, c.scope, c.nonce));
      }
      if (f.grant_type === 'refresh_token') {
        if (st.refreshError) { const e = st.refreshError; st.refreshError = null; return send(res, e.status, e.body); }
        const r = st.refresh.get(f.refresh_token);
        if (!r) return send(res, 400, { error: 'invalid_grant' });
        if (r.used) return send(res, 400, { error: 'refresh_token_reused' });
        if (r.clientId !== f.client_id) return send(res, 400, { error: 'invalid_client' });
        if (f.scope !== undefined) return send(res, 400, { error: 'invalid_scope' });
        r.used = true;
        return send(res, 200, issueTokens(r.clientId, r.scope, r.nonce));
      }
      return send(res, 400, { error: 'unsupported_grant_type' });
    }
    if (u.pathname === '/v1/models' && req.method === 'GET') {
      if (!bearer(req)) return send(res, 401, { detail: 'unauthorized' });
      const forced = st.modelsErrors.shift();
      if (forced) return send(res, forced.status, forced.body, forced.headers);
      return send(res, 200, { models: st.models });
    }
    if (u.pathname === '/v1/responses' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      st.responses.push({ body, auth: req.headers.authorization });
      const a = bearer(req);
      if (!a) return send(res, 401, { error: { code: 'subscription_sharing_invalid_user', message: 'no' } });
      if (body.store !== false || body.stream !== true) return send(res, 400, { error: { code: 'invalid_request', param: 'store' } });
      if (body.input && body.input.some((i) => i.role === 'system')) return send(res, 400, { error: { code: 'invalid_request', param: 'input' } });
      const forced = st.responsesErrors.shift();
      if (forced && forced.status) return send(res, forced.status, forced.body, forced.headers);
      if (forced && forced.sse) return sse(res, forced.sse);
      const turn = mock.script.shift();
      const items = turn ? turn(body) : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] }];
      const events = [{ type: 'response.created', response: { id: 'resp_1' } }];
      for (const item of items) {
        if (item.type === 'message') {
          for (const c of item.content || []) events.push({ type: 'response.output_text.delta', delta: c.text || '' });
        }
        events.push({ type: 'response.output_item.done', item: { ...item, status: 'completed' } });
      }
      events.push({ type: 'response.completed', response: { id: 'resp_1', status: 'completed' } });
      return sse(res, events);
    }
    return send(res, 404, { error: 'not_found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  /** What the browser does at the authorize URL: the player consents (or not); returns the redirect it lands on. */
  mock.consent = (authorizeUrl, { deny = false, scope = FULL_SCOPE, clientId = null, omitClientId = false } = {}) => {
    const q = new URL(authorizeUrl).searchParams;
    st.authorize.push(Object.fromEntries(q));
    const redirect = new URL(q.get('redirect_uri'));
    redirect.searchParams.set('state', q.get('state'));
    if (deny) { redirect.searchParams.set('error', 'access_denied'); return redirect.href; }
    let issued = q.get('client_id');
    if (issued === 'dynamic_agent_client') { issued = clientId || `oaiapp_${++st.issued}`; st.clients.add(issued); }
    else if (clientId) issued = clientId;
    const code = `code_${crypto.randomBytes(8).toString('hex')}`;
    st.codes.set(code, { clientId: issued, challenge: q.get('code_challenge'), redirect: q.get('redirect_uri'), scope, nonce: q.get('nonce') });
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('scope', scope);
    if (!omitClientId) redirect.searchParams.set('client_id', issued);
    return redirect.href;
  };
  mock.base = base;
  mock.api = `${base}/v1`;
  mock.close = () => new Promise((resolve) => server.close(resolve));
  /** Expire every access token now (the next call must refresh). */
  mock.expireAccess = () => { for (const a of st.access.values()) a.exp = 0; };
  return mock;
}

/** A function_call item as the Responses stream returns it. */
export const fnCall = (name, args, id = crypto.randomBytes(4).toString('hex')) =>
  ({ type: 'function_call', id: `fc_${id}`, call_id: `call_${id}`, name, arguments: JSON.stringify(args) });
