// The helper's REST client (Harness Hollow, ui lane; docs/agent-notes/harness-contract.md §4.3, §5). Every call is
// relative to the farm's harness base (single mode `/api/harness`, multi mode `/api/f/<id>/harness`), JSON both ways,
// `Authorization: Bearer <the farmer's key>` (single: the slot token, multi: the member secret).
//
//   harnessBase(farm) -> '/api/harness' | '/api/f/<id>/harness'
//   createHarnessApi({ base, auth, fetcher }) -> api           auth() -> token | null (read at every call)
//     every method resolves { ok: true, status, data } | { ok: false, status, code, data }; it never throws.
//     code: the body's `error` ('BUSY', 'SIGN_IN', 'STALE', ...), else 'HTTP_<status>'; 'NET' when nothing answered,
//     'AUTH' before any request when there is no key yet.
//     state() jobs: start(body) current() revise(id, prompt) apply(id) discard(id) cancel(id)
//     history() undo(to?) consent() setConsent(bool)
//     providers() models(provider) signIn(provider, { method? }) signInContinue(provider, { code? , redirectUrl? })
//     (method: one of Claude Code's own login methods, 'claudeai' | 'console' | 'sso'; absent = the binary's default)
//     signInStatus(provider) signOut(provider)
//   unwrapSignIn(data) -> SignInState | null     the provider routes answer { signin } (or a bare SignInState)
//
// The provider routes are not spelled out in the contract (4.3 "see 5.3"): ROUTES below is the one place that names
// them (docs/agent-notes/hh-ui.md has the proposal sent to the agent lane).

const JSON_TYPE = 'application/json';

export const ROUTES = Object.freeze({
  state: ['GET', '/state'],
  start: ['POST', '/jobs'],
  current: ['GET', '/jobs/current'],
  revise: ['POST', '/jobs/:job/revise'],
  apply: ['POST', '/jobs/:job/apply'],
  discard: ['POST', '/jobs/:job/discard'],
  cancel: ['POST', '/jobs/:job/cancel'],
  history: ['GET', '/history'],
  undo: ['POST', '/undo'],
  consent: ['GET', '/consent'],
  setConsent: ['POST', '/consent'],
  providers: ['GET', '/providers'],
  models: ['GET', '/providers/:provider/models'],
  signIn: ['POST', '/providers/:provider/signin'],
  signInContinue: ['POST', '/providers/:provider/signin/continue'],
  signInStatus: ['GET', '/providers/:provider/signin'],
  signOut: ['POST', '/providers/:provider/signout'],
});

/** The harness base of a farm scope (net/farm.js `farm`). Pure. */
export function harnessBase(scope) {
  return scope && scope.multi && scope.id ? `/api/f/${encodeURIComponent(scope.id)}/harness` : '/api/harness';
}

/** '/jobs/:job/apply' with { job: 'ab12' } -> '/jobs/ab12/apply' (every part URI-encoded). Pure. */
export function fillPath(path, params = {}) {
  return path.replace(/:(\w+)/g, (_, k) => encodeURIComponent(String(params[k] ?? '')));
}

/** A SignInState from a provider route's body: `{ signin }` or the state itself. Pure. */
export function unwrapSignIn(data) {
  if (!data || typeof data !== 'object') return null;
  const s = data.signin && typeof data.signin === 'object' ? data.signin : data;
  return typeof s.state === 'string' ? s : null;
}

export function createHarnessApi({ base = '/api/harness', auth = () => null, fetcher = (...a) => globalThis.fetch(...a) } = {}) {
  async function call(route, params = {}, body = undefined) {
    const [method, path] = ROUTES[route];
    const token = auth();
    if (!token) return { ok: false, status: 0, code: 'AUTH', data: null };
    const headers = { accept: JSON_TYPE, authorization: `Bearer ${token}` };
    const opts = { method, headers, cache: 'no-store', credentials: 'same-origin' };
    if (method !== 'GET') {
      headers['content-type'] = JSON_TYPE;
      opts.body = JSON.stringify(body ?? {});
    }
    let res;
    try {
      res = await fetcher(`${base}${fillPath(path, params)}`, opts);
    } catch {
      return { ok: false, status: 0, code: 'NET', data: null };
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.ok) return { ok: true, status: res.status, data };
    const code = data && typeof data.error === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(data.error) ? data.error : `HTTP_${res.status}`;
    return { ok: false, status: res.status, code, data };
  }

  return {
    base,
    state: () => call('state'),
    start: ({ prompt, provider, model = null, lang }) => call('start', {}, { prompt, provider, ...(model ? { model } : {}), lang }),
    current: () => call('current'),
    revise: (job, prompt) => call('revise', { job }, { prompt }),
    apply: (job) => call('apply', { job }),
    discard: (job) => call('discard', { job }),
    cancel: (job) => call('cancel', { job }),
    history: () => call('history'),
    undo: (to) => call('undo', {}, Number.isInteger(to) ? { to } : {}),
    consent: () => call('consent'),
    setConsent: (telemetry) => call('setConsent', {}, { telemetry: Boolean(telemetry) }),
    providers: () => call('providers'),
    models: (provider) => call('models', { provider }),
    signIn: (provider, { method } = {}) => call('signIn', { provider }, typeof method === 'string' && method ? { method } : {}),
    signInContinue: (provider, { code, redirectUrl } = {}) => call('signInContinue', { provider },
      typeof redirectUrl === 'string' ? { redirectUrl } : { code: String(code ?? '') }),
    signInStatus: (provider) => call('signInStatus', { provider }),
    signOut: (provider) => call('signOut', { provider }),
  };
}
