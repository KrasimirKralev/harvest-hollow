// Sign in with ChatGPT, open-source token sharing (developers.openai.com/siwc/token-sharing-open-source/*, read
// 2026-10-13). The protocol pieces only; storage and the sign-in states live in providers/chatgpt.js.
//
// What the docs say and this file does:
//   - public client, PKCE S256 (verifier 32 random bytes, base64url; challenge = base64url(sha256(verifier)), no pad);
//   - authorize `<auth>/api/accounts/authorize`: response_type=code, client_id (`dynamic_agent_client` on a first
//     registration, else the account's issued `oaiapp_…`), ext_agent_host_id, agent_name_hint (registration only),
//     redirect_uri (loopback 127.0.0.1), scope `openid profile email offline_access resource.invoke
//     chatgpt.tokens.use.direct`, resource=https://api.openai.com/v1, state, nonce, code_challenge(+_method=S256);
//     reauthorization adds id_token_hint / login_hint of the same account;
//   - token `<auth>/api/accounts/oauth/token`, form-encoded: authorization_code (client_id, code, code_verifier,
//     redirect_uri, resource) and refresh_token (client_id, refresh_token, resource; no scope: keep the grant);
//   - the ID token is verified against the published JWKS (found through `<auth>/.well-known/openid-configuration`,
//     which also names the revocation endpoint): signature, iss, aud = the issued client_id, exp, nonce;
//   - revocation: form POST token + token_type_hint=refresh_token + client_id; an empty 200 is success.
// Not in the docs (implemented defensively): the JWKS URL itself (from discovery), the ID token's signing algorithm
// (RS256/RS384/RS512/PS256/ES256 accepted, `none`/HS* refused), the token error body (`{ error, error_description }`
// per OAuth 2.0).
import crypto from 'node:crypto';

export const RESOURCE = 'https://api.openai.com/v1';
export const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
export const DYNAMIC_CLIENT = 'dynamic_agent_client';
export const NAME_HINT = 'Harness Hollow';
const SKEW_S = 120;
const HTTP_TIMEOUT_MS = 15_000;

export class OAuthError extends Error {
  /** @param {string} code an OAuth error (`invalid_grant`…) or ours (`STATE`, `ID_TOKEN`, `HTTP`, `NETWORK`) */
  constructor(code, message, status = 0) { super(message || code); this.code = code; this.status = status; }
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

export const randomToken = () => b64url(crypto.randomBytes(16));

/** Scopes from a token response (`scope` is space-separated) as a sorted array. */
export const scopesOf = (s) => [...new Set(String(s || '').split(/\s+/).filter(Boolean))].sort();

/** The JWT's three parts decoded (no verification). */
export function decodeJwt(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw new OAuthError('ID_TOKEN', 'not a JWT');
  try {
    return { header: JSON.parse(fromB64url(parts[0]).toString('utf8')), claims: JSON.parse(fromB64url(parts[1]).toString('utf8')),
      signed: Buffer.from(`${parts[0]}.${parts[1]}`), sig: fromB64url(parts[2]) };
  } catch {
    throw new OAuthError('ID_TOKEN', 'unreadable JWT');
  }
}

const ALGS = {
  RS256: { hash: 'sha256' }, RS384: { hash: 'sha384' }, RS512: { hash: 'sha512' },
  PS256: { hash: 'sha256', padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
  ES256: { hash: 'sha256', dsaEncoding: 'ieee-p1363' },
};

/**
 * @param {{ authBase: string, fetch?: typeof fetch, now?: () => number }} o
 */
export function createOpenAIAuth({ authBase, fetch: fetchFn = globalThis.fetch, now = Date.now }) {
  let disco = null;            // { at, doc }
  let jwks = null;             // { at, keys }

  const http = async (url, init = {}) => {
    try {
      return await fetchFn(url, { ...init, signal: init.signal || AbortSignal.timeout(HTTP_TIMEOUT_MS), redirect: 'error' });
    } catch (err) {
      throw new OAuthError('NETWORK', `cannot reach ${new URL(url).host}: ${err && err.name}`);
    }
  };

  async function discovery() {
    if (disco && now() - disco.at < 3_600_000) return disco.doc;
    const res = await http(`${authBase}/.well-known/openid-configuration`);
    if (!res.ok) throw new OAuthError('HTTP', `discovery answered ${res.status}`, res.status);
    const doc = await res.json();
    if (!doc || typeof doc.jwks_uri !== 'string' || typeof doc.issuer !== 'string') throw new OAuthError('HTTP', 'discovery without jwks_uri/issuer');
    disco = { at: now(), doc };
    return doc;
  }

  async function keys(force = false) {
    if (!force && jwks && now() - jwks.at < 3_600_000) return jwks.keys;
    const { jwks_uri: uri } = await discovery();
    const res = await http(uri);
    if (!res.ok) throw new OAuthError('HTTP', `JWKS answered ${res.status}`, res.status);
    const body = await res.json();
    jwks = { at: now(), keys: Array.isArray(body && body.keys) ? body.keys : [] };
    return jwks.keys;
  }

  /** Verify an ID token; returns its claims. Throws OAuthError('ID_TOKEN', why). */
  async function verifyIdToken(idToken, { clientId, nonce }) {
    const { header, claims, signed, sig } = decodeJwt(idToken);
    const alg = ALGS[header.alg];
    if (!alg) throw new OAuthError('ID_TOKEN', `signing algorithm ${String(header.alg)} refused`);
    const find = (list) => list.find((k) => (header.kid ? k.kid === header.kid : true) && (!k.use || k.use === 'sig'));
    let jwk = find(await keys());
    if (!jwk) jwk = find(await keys(true));                   // a rotated key: fetch the set once more
    if (!jwk) throw new OAuthError('ID_TOKEN', 'no matching signing key');
    let ok = false;
    try {
      const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      ok = crypto.verify(alg.hash, signed, { key, ...(alg.padding ? { padding: alg.padding, saltLength: alg.saltLength } : {}),
        ...(alg.dsaEncoding ? { dsaEncoding: alg.dsaEncoding } : {}) }, sig);
    } catch { ok = false; }
    if (!ok) throw new OAuthError('ID_TOKEN', 'bad signature');
    const { issuer } = await discovery();
    if (claims.iss !== issuer) throw new OAuthError('ID_TOKEN', 'wrong issuer');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(clientId)) throw new OAuthError('ID_TOKEN', 'wrong audience');
    const t = Math.floor(now() / 1000);
    if (!Number.isFinite(claims.exp) || claims.exp + SKEW_S < t) throw new OAuthError('ID_TOKEN', 'expired');
    if (Number.isFinite(claims.iat) && claims.iat - SKEW_S > t) throw new OAuthError('ID_TOKEN', 'issued in the future');
    if (claims.nonce !== nonce) throw new OAuthError('ID_TOKEN', 'nonce mismatch');
    if (typeof claims.sub !== 'string' || !claims.sub) throw new OAuthError('ID_TOKEN', 'no subject');
    return claims;
  }

  function authorizeUrl({ clientId, hostId, redirectUri, state, nonce, challenge, registration, idTokenHint, loginHint, consent }) {
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: SCOPE,
      resource: RESOURCE, state, nonce, code_challenge: challenge, code_challenge_method: 'S256', ext_agent_host_id: hostId });
    if (registration) q.set('agent_name_hint', NAME_HINT);
    if (!registration && idTokenHint) q.set('id_token_hint', idTokenHint);
    if (!registration && loginHint) q.set('login_hint', loginHint);
    if (consent) q.set('prompt', 'consent');          // only when the player asked to enable plan use again
    return `${authBase}/api/accounts/authorize?${q}`;
  }

  async function tokenCall(form) {
    const res = await http(`${authBase}/api/accounts/oauth/token`, { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(form) });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      const code = body && typeof body.error === 'string' ? body.error : body && body.error && body.error.code ? body.error.code : 'HTTP';
      throw new OAuthError(code, `token endpoint answered ${res.status}`, res.status);
    }
    if (!body || typeof body.access_token !== 'string') throw new OAuthError('HTTP', 'token answer without access_token', res.status);
    return body;
  }

  const exchange = ({ clientId, code, verifier, redirectUri }) => tokenCall({ grant_type: 'authorization_code', client_id: clientId,
    code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE });

  const refresh = ({ clientId, refreshToken }) => tokenCall({ grant_type: 'refresh_token', client_id: clientId,
    refresh_token: refreshToken, resource: RESOURCE });

  /** true = revoked (an empty 200, also for an already invalid token); false = not confirmed. Never throws. */
  async function revoke({ clientId, refreshToken }) {
    try {
      const { revocation_endpoint: url } = await discovery();
      if (typeof url !== 'string') return false;
      for (let i = 0; i < 2; i++) {
        const res = await http(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: clientId }) });
        if (res.ok) return true;
        if (res.status < 500) return false;
      }
    } catch { /* not confirmed */ }
    return false;
  }

  return { discovery, verifyIdToken, authorizeUrl, exchange, refresh, revoke };
}

/** Refresh errors after which the token set is unusable (docs: clear it and sign in again with the saved client). */
export const DEAD_REFRESH = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired',
  'refresh_token_invalidated', 'refresh_token_reused']);
