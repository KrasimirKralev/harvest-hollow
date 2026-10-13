// The helper's REST client (public/js/harness/api.js): the farm's harness base in both modes, the farmer's key in the
// Authorization header only, every route of the contract (docs/agent-notes/harness-contract.md §4.3) with its method and
// body, and the answers told apart (an error code from the body, HTTP_<status>, NET when nothing answered, AUTH before
// any request when there is no key). Never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarnessApi, harnessBase, fillPath, unwrapSignIn, ROUTES } from '../public/js/harness/api.js';

function fakeFetch(answer = { status: 200, body: {} }) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : undefined });
    const a = typeof answer === 'function' ? answer(url, opts) : answer;
    if (a instanceof Error) throw a;
    const status = a.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => { if (a.raw) throw new SyntaxError('not json'); return a.body; } };
  };
  fn.calls = calls;
  return fn;
}

test('the harness base: /api/harness in single mode, /api/f/<id>/harness in multi mode', () => {
  assert.equal(harnessBase({ multi: false, id: null }), '/api/harness');
  assert.equal(harnessBase(null), '/api/harness');
  assert.equal(harnessBase({ multi: true, id: 'abcdefghij23' }), '/api/f/abcdefghij23/harness');
  assert.equal(fillPath('/jobs/:job/apply', { job: 'a/b' }), '/jobs/a%2Fb/apply');
});

test('every route: method, path and body as the contract says; the key rides only in the Authorization header', async () => {
  const f = fakeFetch({ status: 200, body: { ok: true } });
  const api = createHarnessApi({ base: '/api/f/abcdefghij23/harness', auth: () => 'k'.repeat(64), fetcher: f });
  await api.state();
  await api.start({ prompt: 'A blue melon', provider: 'chatgpt', model: 'gpt-x', lang: 'bg' });
  await api.start({ prompt: 'x', provider: 'claude', lang: 'en' });
  await api.current();
  await api.revise('9f2c', 'pinker');
  await api.apply('9f2c');
  await api.discard('9f2c');
  await api.cancel('9f2c');
  await api.history();
  await api.undo();
  await api.undo(5);
  await api.consent();
  await api.setConsent(1);
  await api.providers();
  await api.models('chatgpt');
  await api.signIn('claude');
  await api.signInContinue('claude', { code: 'ABC-123' });
  await api.signInContinue('chatgpt', { redirectUrl: 'http://127.0.0.1:3300/auth/callback?code=c&state=s' });
  await api.signInStatus('chatgpt');
  await api.signOut('claude');
  const B = '/api/f/abcdefghij23/harness';
  const got = f.calls.map((c) => [c.opts.method, c.url.replace(B, ''), c.body]);
  assert.deepEqual(got, [
    ['GET', '/state', undefined],
    ['POST', '/jobs', { prompt: 'A blue melon', provider: 'chatgpt', model: 'gpt-x', lang: 'bg' }],
    ['POST', '/jobs', { prompt: 'x', provider: 'claude', lang: 'en' }],
    ['GET', '/jobs/current', undefined],
    ['POST', '/jobs/9f2c/revise', { prompt: 'pinker' }],
    ['POST', '/jobs/9f2c/apply', {}],
    ['POST', '/jobs/9f2c/discard', {}],
    ['POST', '/jobs/9f2c/cancel', {}],
    ['GET', '/history', undefined],
    ['POST', '/undo', {}],
    ['POST', '/undo', { to: 5 }],
    ['GET', '/consent', undefined],
    ['POST', '/consent', { telemetry: true }],
    ['GET', '/providers', undefined],
    ['GET', '/providers/chatgpt/models', undefined],
    ['POST', '/providers/claude/signin', {}],
    ['POST', '/providers/claude/signin/continue', { code: 'ABC-123' }],
    ['POST', '/providers/chatgpt/signin/continue', { redirectUrl: 'http://127.0.0.1:3300/auth/callback?code=c&state=s' }],
    ['GET', '/providers/chatgpt/signin', undefined],
    ['POST', '/providers/claude/signout', {}],
  ]);
  for (const c of f.calls) {
    assert.equal(c.opts.headers.authorization, `Bearer ${'k'.repeat(64)}`);
    assert.ok(!c.url.includes('kkkk'), 'the key never rides in a URL');
    assert.equal(c.opts.cache, 'no-store');
    if (c.opts.method === 'POST') assert.equal(c.opts.headers['content-type'], 'application/json');
  }
  assert.equal(Object.keys(ROUTES).length, 17);
});

test('answers: the body error code, HTTP_<status>, NET, AUTH without a key (and then no request at all)', async () => {
  const busy = createHarnessApi({ auth: () => 't', fetcher: fakeFetch({ status: 409, body: { error: 'BUSY', job: { id: 'j1' } } }) });
  assert.deepEqual(await busy.start({ prompt: 'p', provider: 'mock', lang: 'en' }), { ok: false, status: 409, code: 'BUSY', data: { error: 'BUSY', job: { id: 'j1' } } });
  const html = createHarnessApi({ auth: () => 't', fetcher: fakeFetch({ status: 502, raw: true }) });
  assert.deepEqual(await html.state(), { ok: false, status: 502, code: 'HTTP_502', data: null });
  const odd = createHarnessApi({ auth: () => 't', fetcher: fakeFetch({ status: 400, body: { error: '<script>' } }) });
  assert.equal((await odd.state()).code, 'HTTP_400', 'only a CODE-shaped error is taken as a code');
  const down = createHarnessApi({ auth: () => 't', fetcher: fakeFetch(new TypeError('Failed to fetch')) });
  assert.deepEqual(await down.history(), { ok: false, status: 0, code: 'NET', data: null });
  const f = fakeFetch();
  const nokey = createHarnessApi({ auth: () => null, fetcher: f });
  assert.equal((await nokey.state()).code, 'AUTH');
  assert.equal(f.calls.length, 0);
  const ok = createHarnessApi({ auth: () => 't', fetcher: fakeFetch({ status: 202, body: { job: { id: 'j2', state: 'starting' } } }) });
  assert.deepEqual(await ok.start({ prompt: 'p', provider: 'mock', lang: 'en' }), { ok: true, status: 202, data: { job: { id: 'j2', state: 'starting' } } });
});

test('unwrapSignIn: the { signin } wrapper or a bare SignInState; anything else is null', () => {
  assert.deepEqual(unwrapSignIn({ signin: { provider: 'claude', state: 'pending' } }), { provider: 'claude', state: 'pending' });
  assert.deepEqual(unwrapSignIn({ provider: 'chatgpt', state: 'signed_in', account: { label: 'k***@x.com' } }).state, 'signed_in');
  assert.equal(unwrapSignIn({ ok: true }), null);
  assert.equal(unwrapSignIn(null), null);
});
