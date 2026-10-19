// Sign in with ChatGPT (open-source token sharing) and the Responses loop, against the local mock of the documented
// endpoints (test/helpers/mock-openai.js): registration, the loopback callback and the pasted address, ID token
// checks, scopes, storage (0600, per issued client id and account), refresh rotation, the errors the docs list, the
// function-tool loop, sign-out with revocation, and that no token ever reaches a log, a job file or telemetry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createAgent } from '../server/agent/index.js';
import { startMockOpenAI, fnCall, FULL_SCOPE } from './helpers/mock-openai.js';
import { stubCtx, tmpRoot, waitFor } from './helpers/agent-harness.js';
import { MOCK_FILES } from '../server/agent/providers/mock.js';

const FK = 'local';

async function setup({ mode = 'single', env = {} } = {}) {
  const oa = await startMockOpenAI();
  const root = tmpRoot('gpt');
  const h = stubCtx({ root, mode, env: { HH_OPENAI_AUTH_BASE: oa.base, HH_OPENAI_API_BASE: oa.api, ...env } });
  const agent = createAgent(h.ctx, { pushMs: 1, retryMs: [5, 5] });
  const app = express();
  agent.loopbackRoutes(app);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  agent.listening(server.address().port);
  const gpt = agent.providers.chatgpt;
  const user = (pid = 'p1') => agent.runtime.userOf(FK, pid);
  const close = async () => { await agent.stop(); await new Promise((r) => server.close(r)); await oa.close(); };
  /** The whole sign-in as the browser on the server's machine does it. */
  const signIn = async (pid = 'p1', consentOpts = {}) => {
    const st = await gpt.signIn.start(user(pid));
    const landing = oa.consent(st.step.url, consentOpts);
    const res = await fetch(landing);
    return { st, landing, page: await res.text(), status: res.status };
  };
  return { ...h, oa, agent, gpt, user, close, signIn, port: server.address().port, root };
}

const recordFile = (u) => {
  const dir = path.join(u.dir, 'openai');
  const cur = JSON.parse(fs.readFileSync(path.join(dir, 'current.json'), 'utf8'));
  return path.join(dir, cur.client_id, cur.file);
};

test('first sign-in registers through dynamic_agent_client with PKCE and the loopback redirect, exactly as documented', async (t) => {
  const s = await setup();
  t.after(s.close);
  const st = await s.gpt.signIn.start(s.user());
  assert.equal(st.state, 'pending');
  assert.equal(st.step.kind, 'open_url');
  assert.deepEqual(st.step.paste, { field: 'redirect_url' });
  const u = new URL(st.step.url);
  assert.equal(`${u.origin}${u.pathname}`, `${s.oa.base}/api/accounts/authorize`);
  const q = Object.fromEntries(u.searchParams);
  assert.equal(q.client_id, 'dynamic_agent_client');
  assert.equal(q.agent_name_hint, 'Harness Hollow');
  assert.match(q.ext_agent_host_id, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(q.redirect_uri, `http://127.0.0.1:${s.port}/auth/callback`);
  assert.equal(q.scope, FULL_SCOPE);
  assert.equal(q.resource, 'https://api.openai.com/v1');
  assert.equal(q.response_type, 'code');
  assert.equal(q.code_challenge_method, 'S256');
  assert.match(q.code_challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(q.state.length >= 20 && q.nonce.length >= 20 && q.state !== q.nonce);
  assert.equal(q.id_token_hint, undefined);
  // the host id is chosen once per server and kept
  const host = JSON.parse(fs.readFileSync(path.join(s.ctx.hostDir, 'openai-client.json'), 'utf8'));
  assert.equal(host.ext_agent_host_id, q.ext_agent_host_id);
  const again = await s.gpt.signIn.start(s.user('p2'));
  assert.equal(new URL(again.step.url).searchParams.get('ext_agent_host_id'), q.ext_agent_host_id);
});

test('the callback on the server\'s machine completes it: tokens 0600 per issued client and account, label masked', async (t) => {
  const s = await setup();
  t.after(s.close);
  const { page, status } = await s.signIn();
  assert.equal(status, 200);
  assert.match(page, /data-result="ok"/);
  const st = await s.gpt.signIn.status(s.user());
  assert.deepEqual(st, { provider: 'chatgpt', state: 'signed_in', account: { label: 'f***@example.com' } });
  const file = recordFile(s.user());
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.match(file, /openai\/oaiapp_1\/[0-9a-f]{32}\.json$/);
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(rec.client_id, 'oaiapp_1');
  assert.ok(rec.scopes.includes('chatgpt.tokens.use.direct'));
  // the exchange: authorization_code with the verifier, the same redirect and resource, no secret
  const ex = s.oa.state.tokenCalls[0];
  assert.deepEqual(Object.keys(ex).sort(), ['client_id', 'code', 'code_verifier', 'grant_type', 'redirect_uri', 'resource']);
  assert.equal(ex.client_id, 'oaiapp_1');
  // the farmer's page was told
  assert.ok(s.pushes.some((p) => p.msg.e === 'signin' && p.pid === 'p1' && p.msg.state === 'signed_in'));
  // the partner is not signed in
  assert.equal((await s.gpt.signIn.status(s.user('p2'))).state, 'signed_out');
  // the state is single use
  const replay = await fetch(s.oa.state.authorize.length ? `http://127.0.0.1:${s.port}/auth/callback?state=${s.oa.state.authorize[0].state}&code=x` : '');
  assert.equal(replay.status, 400);
});

test('on another device the player pastes the final address; a foreign state is refused', async (t) => {
  const s = await setup();
  t.after(s.close);
  const st1 = await s.gpt.signIn.start(s.user('p1'));
  const st2 = await s.gpt.signIn.start(s.user('p2'));
  const landing2 = s.oa.consent(st2.step.url);
  const wrong = await s.gpt.signIn.continue(s.user('p1'), { redirectUrl: landing2 });
  assert.equal(wrong.error.code, 'STATE');
  const landing1 = s.oa.consent(st1.step.url);
  const ok = await s.gpt.signIn.continue(s.user('p1'), { redirectUrl: `  ${landing1}  ` });
  assert.equal(ok.state, 'signed_in');
  assert.equal((await s.gpt.signIn.continue(s.user('p1'), { redirectUrl: 'not a url' })).error.code, 'BAD_CODE');
});

test('ID token: wrong nonce, audience, issuer, signature or alg "none" is refused and nothing is stored', async (t) => {
  const s = await setup();
  t.after(s.close);
  const cases = [
    (c) => ({ ...c, nonce: 'other' }),
    (c) => ({ ...c, aud: 'oaiapp_someone_else' }),
    (c) => ({ ...c, iss: 'https://evil.example' }),
    (c) => ({ ...c, exp: Math.floor(Date.now() / 1000) - 3600 }),
    () => ({ sign: 'other' }),
    () => ({ sign: 'none' }),
  ];
  for (const tweak of cases) {
    s.oa.state.idTokenTweak = tweak;
    const { page } = await s.signIn();
    assert.match(page, /data-code="STATE"/, String(tweak));
    assert.equal((await s.gpt.signIn.status(s.user())).state, 'signed_out');
  }
  assert.equal(fs.existsSync(path.join(s.user().dir, 'openai', 'current.json')), false);
});

test('declined consent is DENIED; a grant without chatgpt.tokens.use.direct keeps the sign-in but no inference', async (t) => {
  const s = await setup();
  t.after(s.close);
  const denied = await s.signIn('p1', { deny: true });
  assert.match(denied.page, /data-code="DENIED"/);
  assert.equal(s.oa.state.tokenCalls.length, 0, 'no code exchange after access_denied');
  const partial = await s.signIn('p1', { scope: 'openid profile email offline_access' });
  assert.match(partial.page, /data-result="error"/);
  const st = await s.gpt.signIn.status(s.user());
  assert.equal(st.state, 'error');
  assert.equal(st.error.code, 'DENIED');
  await assert.rejects(s.agent.runtime.start(FK, 'p1', { prompt: 'x', provider: 'chatgpt' }), (e) => e.status === 428);
  // signing in again asks for consent again, on the same registration
  const again = await s.gpt.signIn.start(s.user());
  const q = new URL(again.step.url).searchParams;
  assert.equal(q.get('prompt'), 'consent');
  assert.equal(q.get('client_id'), 'oaiapp_1');
});

test('a new registration without an issued client id is incomplete; reauth refuses a different client id', async (t) => {
  const s = await setup();
  t.after(s.close);
  const r1 = await s.signIn('p1', { omitClientId: true });
  assert.match(r1.page, /data-code="STATE"/);
  await s.signIn('p1');
  const issued = JSON.parse(fs.readFileSync(recordFile(s.user()), 'utf8')).client_id;
  assert.match(issued, /^oaiapp_\d+$/);
  const st = await s.gpt.signIn.start(s.user());
  const q = new URL(st.step.url).searchParams;
  assert.equal(q.get('client_id'), issued, 'reauthorization uses the issued client id');
  assert.equal(q.get('agent_name_hint'), null);
  assert.ok(q.get('id_token_hint'));
  assert.equal(q.get('login_hint'), 'farmer@example.com');
  const landing = s.oa.consent(st.step.url, { clientId: 'oaiapp_99' });
  const res = await s.gpt.signIn.continue(s.user(), { redirectUrl: landing });
  assert.equal(res.error.code, 'STATE');
});

/** A scripted agent: write the mod, validate, preview, write the summary, stop. */
function agentScript(oa) {
  oa.script = [
    () => [fnCall('read_file', { path: 'request.md' }), fnCall('list_files', { dir: null })],
    () => [fnCall('write_file', { path: 'mod/mod.json', content: JSON.stringify(MOCK_FILES['mod/mod.json']) }),
      fnCall('write_file', { path: 'mod/content/crops/x_moon_melon.json', content: JSON.stringify(MOCK_FILES.crop) })],
    () => [{ type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'enc' }, fnCall('validate', {})],
    () => [fnCall('preview', {}), fnCall('write_file', { path: 'summary.json', content: JSON.stringify(MOCK_FILES.summary) })],
    () => [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'All done.' }] }],
  ];
}

test('the Responses loop: function tools run in the job folder, outputs go back, store:false + stream:true', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.signIn();
  assert.deepEqual(await s.gpt.models(s.user()), [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }]);
  agentScript(s.oa);
  const job = await s.agent.runtime.start(FK, 'p1', { prompt: 'Add a moon melon', provider: 'chatgpt', lang: 'en' });
  const done = await waitFor(async () => { const j = await s.agent.runtime.current(FK); return ['ready', 'failed'].includes(j.state) ? j : null; }, 8000, 'job end');
  assert.equal(done.state, 'ready', JSON.stringify(done.error));
  assert.equal(done.model, 'gpt-6.1-sol', 'the first listed model when none was chosen');
  const reqs = s.oa.state.responses;
  assert.equal(reqs.length, 5);
  for (const r of reqs) {
    assert.equal(r.body.store, false);
    assert.equal(r.body.stream, true);
    assert.match(r.body.instructions, /^You are Harvey, the helper of the cozy co-op farm game/);
    assert.deepEqual(r.body.tools.map((x) => x.name), ['read_file', 'list_files', 'write_file', 'edit_file', 'validate', 'preview']);
    assert.ok(r.body.tools.every((x) => x.type === 'function' && x.strict === true && x.parameters.additionalProperties === false));
    assert.ok(!r.body.input.some((i) => i.role === 'system'));
    assert.match(r.auth, /^Bearer at_/);
    for (const k of ['previous_response_id', 'temperature', 'max_output_tokens', 'metadata', 'user']) assert.equal(r.body[k], undefined, k);
  }
  const last = reqs[4].body.input;
  const outputs = last.filter((i) => i.type === 'function_call_output');
  assert.equal(outputs.length, 7);
  const validated = JSON.parse(outputs.find((o) => last.find((i) => i.call_id === o.call_id && i.type === 'function_call').name === 'validate').output);
  assert.equal(validated.ok, true);
  assert.ok(last.some((i) => i.type === 'reasoning' && i.encrypted_content === 'enc'), 'reasoning items are sent back');
  assert.ok(last.every((i) => i.status === undefined));
  assert.deepEqual(done.result.changes.map((c) => c.id), ['x_moon_melon']);
  // no token anywhere a person or telemetry could read
  const rec = JSON.parse(fs.readFileSync(recordFile(s.user()), 'utf8'));
  const secrets = [rec.access_token, rec.refresh_token, rec.id_token];
  const jobFile = fs.readFileSync(path.join(s.ctx.dirOf(FK), 'jobs', job.id, 'job.json'), 'utf8');
  const blob = [jobFile, ...s.log.lines, JSON.stringify(s.records), JSON.stringify(s.pushes)].join('\n');
  for (const sec of secrets) assert.equal(blob.includes(sec), false);
  for (const f of fs.readdirSync(path.join(s.ctx.dirOf(FK), 'jobs', job.id, 'work'), { recursive: true })) {
    const full = path.join(s.ctx.dirOf(FK), 'jobs', job.id, 'work', f);
    if (fs.statSync(full).isFile()) for (const sec of secrets) assert.equal(fs.readFileSync(full, 'utf8').includes(sec), false);
  }
});

test('refresh: near expiry the tokens rotate together (no scope sent); a dead refresh token asks for a new sign-in', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.signIn();
  const file = recordFile(s.user());
  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...before, expires_at: 0 }));
  s.oa.script = [() => [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'nothing to do' }] }]];
  await s.agent.runtime.start(FK, 'p1', { prompt: 'x', provider: 'chatgpt', model: 'gpt-6.1-sol' });
  await waitFor(async () => ['failed', 'ready'].includes((await s.agent.runtime.current(FK)).state), 8000);
  const call = s.oa.state.tokenCalls.find((c) => c.grant_type === 'refresh_token');
  assert.deepEqual(Object.keys(call).sort(), ['client_id', 'grant_type', 'refresh_token', 'resource']);
  assert.equal(call.client_id, 'oaiapp_1');
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.notEqual(after.access_token, before.access_token);
  assert.notEqual(after.refresh_token, before.refresh_token);
  assert.ok(after.expires_at > Date.now());
  // the old refresh token is spent: reusing it is refused upstream; ours was replaced, so the next refresh works
  s.oa.state.refreshError = { status: 400, body: { error: 'refresh_token_reused' } };
  fs.writeFileSync(file, JSON.stringify({ ...after, expires_at: 0 }));
  await s.agent.runtime.discard(FK, 'p1', (await s.agent.runtime.current(FK)).id).catch(() => {});
  await s.agent.runtime.start(FK, 'p1', { prompt: 'y', provider: 'chatgpt', model: 'gpt-6.1-sol' }).catch((e) => e);
  const j = await waitFor(async () => { const x = await s.agent.runtime.current(FK); return x.prompts[0].text === 'y' && x.state === 'failed' ? x : null; }, 8000, 'failed');
  assert.equal(j.error.code, 'SIGN_IN');
  const cleared = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(cleared.access_token, null);
  assert.equal(cleared.client_id, 'oaiapp_1', 'the registration is kept for the next sign-in');
  assert.equal((await s.gpt.signIn.status(s.user())).state, 'signed_out');
});

test('documented errors: usage limit, unavailable, a 401 then refresh, and "include" refused', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.signIn();
  const run = async (prompt) => {
    const cur = await s.agent.runtime.current(FK);
    if (cur && cur.state === 'ready') await s.agent.runtime.discard(FK, 'p1', cur.id);
    await s.agent.runtime.start(FK, 'p1', { prompt, provider: 'chatgpt', model: 'gpt-6.1-sol' });
    return waitFor(async () => { const j = await s.agent.runtime.current(FK); return j.prompts[0].text === prompt && ['failed', 'ready'].includes(j.state) ? j : null; }, 8000, prompt);
  };
  s.oa.state.responsesErrors.push({ status: 429, body: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } } });
  assert.equal((await run('a')).error.code, 'USAGE_LIMIT');
  s.oa.state.responsesErrors.push({ sse: [{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_unavailable' } } }] });
  assert.equal((await run('b')).error.code, 'UNAVAILABLE');
  s.oa.state.responsesErrors.push({ status: 503, body: { detail: 'down' } }, { status: 503, body: { detail: 'down' } }, { status: 503, body: { detail: 'down' } });
  assert.equal((await run('c')).error.code, 'UNAVAILABLE');
  // an access token the server stopped accepting: one refresh, then the same request again
  s.oa.expireAccess();
  agentScript(s.oa);
  const n = s.oa.state.tokenCalls.length;
  assert.equal((await run('d')).state, 'ready');
  assert.equal(s.oa.state.tokenCalls.length, n + 1);
  // include refused: retried without it, and reasoning items are no longer sent
  s.oa.state.responsesErrors.push({ status: 400, body: { error: { code: 'subscription_sharing_unsupported_capability', param: 'include' } } });
  s.oa.script = [() => [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }]];
  const before = s.oa.state.responses.length;
  await run('e');
  const sent = s.oa.state.responses.slice(before);
  assert.ok(sent[0].body.include);
  assert.equal(sent[1].body.include, undefined);
});

// developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery (read 2026-10-13; verifier defect 4):
//   subscription_sharing_user_not_eligible (403): explain the restriction; do not repeat the request or loop through OAuth
//   subscription_sharing_invalid_user (401): keep the request id, diagnose the credential failure; ask for a new sign-in
//     only after a confirmed revocation or a terminal refresh error
test('errors page: "not eligible" is explained once, "invalid user" is checked by a refresh before any new sign-in', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.signIn();
  const run = async (prompt) => {
    const cur = await s.agent.runtime.current(FK);
    if (cur && cur.state === 'ready') await s.agent.runtime.discard(FK, 'p1', cur.id);
    await s.agent.runtime.start(FK, 'p1', { prompt, provider: 'chatgpt', model: 'gpt-6.1-sol' });
    return waitFor(async () => { const j = await s.agent.runtime.current(FK); return j.prompts[0].text === prompt && ['failed', 'ready'].includes(j.state) ? j : null; }, 8000, prompt);
  };
  const refreshes = () => s.oa.state.tokenCalls.filter((c) => c.grant_type === 'refresh_token').length;
  const signInPushes = () => s.pushes.filter((p) => p.msg.e === 'signin').length;
  const pushes0 = signInPushes();

  // not eligible: one request, no refresh, no new sign-in, the sign-in kept, the request id in the server log
  let sent = s.oa.state.responses.length;
  let r0 = refreshes();
  s.oa.state.responsesErrors.push({ status: 403, body: { error: { code: 'subscription_sharing_user_not_eligible', message: 'no' } },
    headers: { 'x-request-id': 'req_not_eligible_1' } });
  const ne = await run('a');
  assert.equal(ne.error.code, 'NOT_ELIGIBLE');
  assert.equal(s.oa.state.responses.length - sent, 1, 'the same request is not repeated');
  assert.equal(refreshes(), r0, 'no token or OAuth round for a restriction');
  assert.equal((await s.gpt.signIn.status(s.user())).state, 'signed_in');
  assert.ok(s.log.lines.some((l) => l.includes('req_not_eligible_1')), 'the request id is kept in the log');
  // ...also when the stream reports it
  s.oa.state.responsesErrors.push({ sse: [{ type: 'response.failed', response: { error: { code: 'subscription_sharing_user_not_eligible' } } }] });
  assert.equal((await run('a2')).error.code, 'NOT_ELIGIBLE');

  // invalid user, and the refresh works: not a confirmed revocation, so the sign-in is kept and nobody is asked to sign in
  const before = JSON.parse(fs.readFileSync(recordFile(s.user()), 'utf8'));
  r0 = refreshes();
  s.oa.state.responsesErrors.push(
    { status: 401, body: { error: { code: 'subscription_sharing_invalid_user' } }, headers: { 'x-request-id': 'req_invalid_1' } },
    { status: 401, body: { error: { code: 'subscription_sharing_invalid_user' } }, headers: { 'x-request-id': 'req_invalid_2' } });
  const iu = await run('b');
  assert.equal(iu.error.code, 'ACCOUNT_CHECK');
  assert.equal(refreshes(), r0 + 1, 'one refresh diagnoses the credential');
  const kept = JSON.parse(fs.readFileSync(recordFile(s.user()), 'utf8'));
  assert.ok(kept.access_token && kept.refresh_token && kept.access_token !== before.access_token, 'the rotated tokens are kept');
  assert.equal((await s.gpt.signIn.status(s.user())).state, 'signed_in');
  assert.equal(signInPushes(), pushes0, 'nobody is told to sign in again');
  assert.ok(s.log.lines.some((l) => l.includes('req_invalid_2')), 'the request id is kept in the log');

  // invalid user, then the refresh is refused for good (a confirmed revocation): now, and only now, sign in again
  s.oa.state.responsesErrors.push({ status: 401, body: { error: { code: 'subscription_sharing_invalid_user' } } });
  s.oa.state.refreshError = { status: 400, body: { error: 'invalid_grant' } };
  const rv = await run('c');
  assert.equal(rv.error.code, 'SIGN_IN');
  assert.equal((await s.gpt.signIn.status(s.user())).state, 'signed_out');
  assert.equal(signInPushes(), pushes0 + 1);
});

test('the model list maps the documented errors too (not eligible, account not confirmed)', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.signIn();
  s.oa.state.modelsErrors = [{ status: 403, body: { error: { code: 'subscription_sharing_user_not_eligible' } } }];
  await assert.rejects(s.gpt.models(s.user()), (e) => e.code === 'NOT_ELIGIBLE');
  // invalid user twice, the refresh between them works: not confirmed, not "sign in again"
  const invalid = { status: 401, body: { error: { code: 'subscription_sharing_invalid_user' } } };
  s.oa.state.modelsErrors = [invalid, invalid];
  await assert.rejects(s.gpt.models(s.user()), (e) => e.code === 'ACCOUNT_CHECK');
  assert.equal((await s.gpt.signIn.status(s.user())).state, 'signed_in');
  assert.deepEqual((await s.gpt.models(s.user())).map((m) => m.id), ['gpt-6.1-sol']);
});

test('sign-out revokes the refresh token with the issued client id and deletes the farmer\'s folder', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.signIn();
  const rec = JSON.parse(fs.readFileSync(recordFile(s.user()), 'utf8'));
  const st = await s.gpt.signIn.signOut(s.user());
  assert.deepEqual(st, { provider: 'chatgpt', state: 'signed_out' });
  assert.deepEqual(s.oa.state.revoked, [{ token: rec.refresh_token, token_type_hint: 'refresh_token', client_id: 'oaiapp_1' }]);
  assert.equal(fs.existsSync(path.join(s.user().dir, 'openai')), false);
});

test('multi mode: unavailable (HOST_NOT_ALLOWED) unless OpenAI approved the hosted app', async (t) => {
  const s = await setup({ mode: 'multi' });
  t.after(s.close);
  assert.deepEqual(await s.gpt.available(), { ok: false, reason: 'HOST_NOT_ALLOWED' });
  const ok = await setup({ mode: 'multi', env: { HH_CHATGPT_HOSTING: 'approved' } });
  t.after(ok.close);
  assert.deepEqual(await ok.gpt.available(), { ok: true });
});

test('lead: an access token refused by GET /models is refreshed once, then the list comes (no false "sign in again")', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.signIn();
  s.oa.expireAccess();
  const n = s.oa.state.tokenCalls.filter((c) => c.grant_type === 'refresh_token').length;
  const list = await s.gpt.models(s.user());
  assert.ok(list.some((m) => m.id === 'gpt-6.1-sol'), 'the models after one refresh');
  assert.equal(s.oa.state.tokenCalls.filter((c) => c.grant_type === 'refresh_token').length, n + 1);
});
