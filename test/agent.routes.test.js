// The agent lane's HTTP surface (harness contract §4.1, §4.3, §5.2, §5.5): REST shapes and codes, auth, the
// same-origin check, the MCP bridge's loopback route and token, the mock sign-in page and the callback page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAgent } from '../server/agent/index.js';
import { stubCtx, tmpRoot, waitFor } from './helpers/agent-harness.js';

async function serve(env = {}) {
  const root = tmpRoot('routes');
  const h = stubCtx({ root, env });
  const agent = createAgent(h.ctx, { pushMs: 1 });
  const app = express();
  agent.loopbackRoutes(app);
  app.use('/api/harness', agent.routes(express.Router()));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = server.address().port;
  agent.listening(port);
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, p, { body, token = 'tok-p1', headers = {} } = {}) => {
    const res = await fetch(`${base}${p}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text, headers: res.headers };
  };
  const close = async () => { await agent.stop(); await new Promise((r) => server.close(r)); };
  return { ...h, agent, base, call, close, port };
}

test('auth: no key 401, a wrong key 403; answers are no-store', async (t) => {
  const s = await serve();
  t.after(s.close);
  assert.equal((await s.call('GET', '/api/harness/jobs/current', { token: null })).status, 401);
  assert.equal((await s.call('GET', '/api/harness/jobs/current', { token: 'nope' })).status, 403);
  const ok = await s.call('GET', '/api/harness/jobs/current');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { job: null });
  assert.equal(ok.headers.get('cache-control'), 'no-store');
});

test('the whole flow over REST with the mock: sign in, start, ready, apply; another site is refused', async (t) => {
  const s = await serve();
  t.after(s.close);
  const list = await s.call('GET', '/api/harness/providers');
  const mock = list.json.providers.find((p) => p.id === 'mock');
  assert.deepEqual([mock.available, mock.signedIn], [true, false]);
  const claude = list.json.providers.find((p) => p.id === 'claude');
  assert.deepEqual([claude.available, claude.reason], [false, 'NO_BINARY']);
  // starting without a sign-in
  const early = await s.call('POST', '/api/harness/jobs', { body: { prompt: 'melons', provider: 'mock', lang: 'en' } });
  assert.equal(early.status, 428);
  assert.equal(early.json.error, 'SIGN_IN');
  // sign in through the mock's page (what the ui opens)
  const st = await s.call('POST', '/api/harness/providers/mock/signin', { body: {} });
  assert.equal(st.json.state, 'pending');
  assert.equal(st.json.step.kind, 'open_url');
  const page = await s.call('GET', st.json.step.url, { token: null });
  assert.equal(page.status, 200);
  assert.match(page.text, /data-result="ok"/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  await waitFor(() => s.pushes.some((p) => p.msg.e === 'signin' && p.pid === 'p1'), 2000, 'signin push');
  assert.equal((await s.call('GET', '/api/harness/providers/mock/signin')).json.state, 'signed_in');
  // another site's page cannot start a job
  const cross = await s.call('POST', '/api/harness/jobs', { body: { prompt: 'x', provider: 'mock' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
  const start = await s.call('POST', '/api/harness/jobs', { body: { prompt: 'melons', provider: 'mock', lang: 'en' } });
  assert.equal(start.status, 202);
  const id = start.json.job.id;
  assert.match(id, /^[0-9a-f]{16}$/);
  const busy = await s.call('POST', '/api/harness/jobs', { body: { prompt: 'again', provider: 'mock' } });
  assert.equal(busy.status, 409);
  assert.equal(busy.json.error, 'BUSY');
  assert.equal(busy.json.job.id, id);
  await waitFor(async () => (await s.call('GET', '/api/harness/jobs/current')).json.job.state === 'ready', 5000, 'ready');
  assert.equal((await s.call('POST', `/api/harness/jobs/${id}/apply`, { token: 'tok-p2' })).status, 403);
  const applied = await s.call('POST', `/api/harness/jobs/${id}/apply`);
  assert.equal(applied.status, 200);
  assert.equal(applied.json.active.n, 1);
  // too big a body
  const huge = await s.call('POST', '/api/harness/jobs', { body: { prompt: 'x'.repeat(9000), provider: 'mock' } });
  assert.equal(huge.status, 413);
});

test('the MCP bridge route: loopback, the live job\'s token only, nothing after the job', async (t) => {
  const s = await serve({ HH_MOCK_STEP_MS: '150' });
  t.after(s.close);
  const u = s.agent.runtime.userOf('local', 'p1');
  await s.agent.providers.mock.signIn.start(u);
  await s.agent.providers.mock.signIn.continue(u, { code: 'x' });
  const job = await s.agent.runtime.start('local', 'p1', { prompt: 'melons', provider: 'mock' });
  const live = await waitFor(() => { const l = s.agent.runtime.live.get(job.id); return l && l.tools ? l : null; }, 3000, 'live tools');
  const bad = await s.call('POST', `/internal/agent/${job.id}/validate`, { token: 'a'.repeat(64), body: {} });
  assert.equal(bad.status, 404);
  const none = await s.call('POST', `/internal/agent/${job.id}/validate`, { token: null, body: {} });
  assert.equal(none.status, 403);
  const good = await s.call('POST', `/internal/agent/${job.id}/validate`, { token: live.token, body: {} });
  assert.equal(good.status, 200);
  assert.equal(typeof good.json.ok, 'boolean');
  assert.equal((await s.call('POST', `/internal/agent/${job.id}/rm`, { token: live.token, body: {} })).status, 404);
  const token = live.token;
  await waitFor(async () => (await s.agent.runtime.current('local')).state === 'ready', 5000, 'ready');
  assert.equal((await s.call('POST', `/internal/agent/${job.id}/validate`, { token, body: {} })).status, 404, 'the token dies with the round');
});

test('the ChatGPT callback with an unknown state shows the error page, never a stack', async (t) => {
  const s = await serve();
  t.after(s.close);
  const r = await s.call('GET', '/auth/callback?code=abc&state=forged', { token: null });
  assert.equal(r.status, 400);
  assert.match(r.text, /data-result="error"/);
  assert.match(r.text, /data-code="STATE"/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
});

test('models and unknown providers', async (t) => {
  const s = await serve();
  t.after(s.close);
  assert.deepEqual((await s.call('GET', '/api/harness/providers/mock/models')).json, { models: [{ id: 'mock-small', label: 'Mock' }] });
  assert.equal((await s.call('GET', '/api/harness/providers/nope/models')).status, 404);
  assert.equal((await s.call('GET', '/api/harness/providers/claude/models')).status, 503);
});
