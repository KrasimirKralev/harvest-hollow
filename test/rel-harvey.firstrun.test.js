// Release 1.0, H4 (harvey#4) on the server: a sign-in nobody will finish ends there too. POST
// /providers/:id/signin/cancel kills the waiting `claude auth login` (a spawn spy: the fake binary logs each login's pid)
// and forgets a ChatGPT or mock sign-in; an account already signed in stays signed in. The client calls it when the
// player cancels a sign-in or signs in with another plan (test/rel-harvey.ui.test.js "H4").
// RED on fdafb9c: no cancel route; the only way to stop the login child was "Sign out", which also signs a farmer out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ROOT } from './helpers.js';
import { createAgent } from '../server/agent/index.js';
import { stubCtx, tmpRoot, waitFor } from './helpers/agent-harness.js';

const FK = 'local';
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake-claude.mjs');

function fakeBin(root) {
  const dir = path.join(root, 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const confFile = path.join(root, 'fake-conf.json');
  const log = path.join(root, 'fake-log');
  fs.writeFileSync(confFile, JSON.stringify({ log }));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\nexec env FAKE_CLAUDE_CONF='${confFile}' '${process.execPath}' '${FAKE}' "$@"\n`, { mode: 0o755 });
  const pids = () => { try { return fs.readFileSync(path.join(log, 'logins.log'), 'utf8').trim().split('\n').filter(Boolean).map(Number); } catch { return []; } };
  return { bin, pids };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function setup() {
  const root = tmpRoot('rh-h4');
  const fb = fakeBin(root);
  const h = stubCtx({ root, env: { HH_CLAUDE_BIN: fb.bin } });
  const agent = createAgent(h.ctx, { pushMs: 1 });
  const app = express();
  const router = express.Router();
  router.use((req, res, next) => { req.harness = { farmKey: FK, pid: 'p1' }; next(); });
  agent.routes(router);
  app.use('/api/harness', router);
  agent.loopbackRoutes(app);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  agent.listening(server.address().port);
  const base = `http://127.0.0.1:${server.address().port}/api/harness`;
  const post = async (p, body = {}) => {
    const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  const close = async () => { await agent.stop(); await new Promise((r) => server.close(r)); };
  return { ...h, fb, agent, post, close };
}

test('H4: cancelling a waiting Claude Code sign-in kills its login process; a new start spawns a fresh one', async (t) => {
  const s = await setup();
  t.after(s.close);
  const st = await s.post('/providers/claude/signin');
  assert.equal(st.json.state, 'pending', JSON.stringify(st.json));
  const [pid] = await waitFor(() => (s.fb.pids().length ? s.fb.pids() : null), 5000, 'the login process');
  assert.ok(alive(pid), 'the login waits for a code');
  const c = await s.post('/providers/claude/signin/cancel');
  assert.equal(c.status, 200);
  assert.equal(c.json.state, 'signed_out');
  await waitFor(() => !alive(pid), 5000, 'the login process gone');
  // the farmer's sign-in push says so (the other tabs drop the sign-in steps too)
  assert.ok(s.pushes.some((x) => x.msg.e === 'signin' && x.msg.provider === 'claude' && x.msg.state === 'signed_out' && x.pid === 'p1'));
  // a cancel with nothing waiting changes nothing, and a new start is a new login
  assert.equal((await s.post('/providers/claude/signin/cancel')).json.state, 'signed_out');
  await s.post('/providers/claude/signin');
  await waitFor(() => s.fb.pids().length === 2, 5000, 'a second login');
  await s.post('/providers/claude/signin/cancel');
});

test('H4: a mock (or ChatGPT) sign-in that waits is forgotten; one that finished stays signed in', async (t) => {
  const s = await setup();
  t.after(s.close);
  const st = await s.post('/providers/mock/signin');
  assert.equal(st.json.state, 'pending');
  assert.equal((await s.post('/providers/mock/signin/cancel')).json.state, 'signed_out');
  // finished: cancel is not a sign-out
  await s.agent.providers.mock.signIn.start(s.agent.runtime.userOf(FK, 'p1'));
  await s.agent.providers.mock.signIn.continue(s.agent.runtime.userOf(FK, 'p1'), { code: 'ok' });
  assert.equal((await s.post('/providers/mock/signin/cancel')).json.state, 'signed_in');
  const g = await s.post('/providers/chatgpt/signin');
  assert.equal(g.json.state, 'pending', JSON.stringify(g.json));
  assert.equal((await s.post('/providers/chatgpt/signin/cancel')).json.state, 'signed_out');
});
