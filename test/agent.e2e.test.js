// End to end in a real server process (single mode, HH_HARNESS_MOCK=1): the scripted agent's mod goes through the
// mods lane's real validator (schema, meaning, the boot test on a copy of the farm, render), is staged, applied and
// answers in /state, and the job's progress reaches the farm's socket as `hx` frames while the farmer plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnServer, writeSave, resume, sleep } from './helpers/server.js';

test('a farmer asks, keeps playing, gets a validated mod and applies it (real server, real validator)', { timeout: 120_000 }, async (t) => {
  const { dir, tokens } = writeSave({ level: 16, coins: 100_000 });
  const srv = spawnServer(dir, { HH_HARNESS_MOCK: '1', HH_MOCK_STEP_MS: '1', HH_CLAUDE_BIN: '/nonexistent/claude', HH_TELEMETRY: 'off' });
  t.after(async () => { srv.child.kill('SIGTERM'); await srv.exit; });
  const port = await srv.port;
  const base = `http://127.0.0.1:${port}/api/harness`;
  const call = async (method, p, body, token = tokens.p1) => {
    const res = await fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  // the farmer is in the game (a socket), so the job's pushes have somewhere to go
  const { c, w } = await resume(port, tokens.p1, 'e2ecid');
  assert.equal(w.t, 'welcome');
  const st0 = await call('GET', '/state');
  assert.equal(st0.status, 200, JSON.stringify(st0.json));
  assert.equal(st0.json.enabled, true);
  const mock = st0.json.providers.find((p) => p.id === 'mock');
  assert.equal(mock.available, true);
  const si = await call('POST', '/providers/mock/signin', {});
  assert.equal(si.json.state, 'pending');
  const page = await fetch(`http://127.0.0.1:${port}${si.json.step.url}`);
  assert.equal(page.status, 200);
  const start = await call('POST', '/jobs', { prompt: 'Add a moon melon and a melon pie', provider: 'mock', lang: 'bg' });
  assert.equal(start.status, 202, JSON.stringify(start.json));
  let job = null;
  for (let i = 0; i < 400; i++) {
    job = (await call('GET', '/jobs/current')).json.job;
    if (['ready', 'failed'].includes(job.state)) break;
    await sleep(150);
  }
  assert.equal(job.state, 'ready', JSON.stringify({ error: job.error, errors: job.result && job.result.validation && job.result.validation.errors }));
  assert.equal(job.result.validation.ok, true);
  // the agent was told the farm's level and the language
  const request = fs.readFileSync(path.join(dir, 'harness', 'jobs', job.id, 'work', 'request.md'), 'utf8');
  assert.match(request, /The farm is at level 16\./);
  assert.match(request, /Bulgarian \(bg\)/);
  assert.equal(job.result.validation.full, true);
  assert.ok(job.result.changes.some((x) => x.id === 'x_moon_melon' && x.op === 'add'));
  assert.ok(job.result.changes.some((x) => x.id === 'x_melon_pie' && x.op === 'add'));
  // the progress reached the game's socket as hx frames
  const hx = await c.next((m) => m.t === 'hx' && m.e === 'job', 5000);
  assert.equal(hx.job.id, job.id);
  const applied = await call('POST', `/jobs/${job.id}/apply`);
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
  assert.equal(applied.json.active.n, job.result.candidate);
  const st1 = await call('GET', '/state');
  assert.equal(st1.json.active.n, job.result.candidate);
  assert.equal(st1.json.job.state, 'applied');
  c.close();
});

test('Claude Code (a fake binary) end to end in a real server: relayed sign-in, MCP bridge on the real port, applied', { timeout: 120_000 }, async (t) => {
  const { dir, tokens } = writeSave({ level: 16, coins: 100_000 });
  const fake = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'fake-claude.mjs');
  const conf = path.join(dir, 'fake-conf.json');
  fs.writeFileSync(conf, JSON.stringify({ log: path.join(dir, 'fake-log') }));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\nexec env FAKE_CLAUDE_CONF='${conf}' '${process.execPath}' '${fake}' "$@"\n`, { mode: 0o755 });
  const srv = spawnServer(dir, { HH_CLAUDE_BIN: bin, HH_TELEMETRY: 'off' });
  t.after(async () => { srv.child.kill('SIGTERM'); await srv.exit; });
  const port = await srv.port;
  const base = `http://127.0.0.1:${port}/api/harness`;
  const call = async (method, p, body) => {
    const res = await fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${tokens.p1}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const st = await call('GET', '/state');
  const claude = st.json.providers.find((p) => p.id === 'claude');
  assert.deepEqual([claude.available, claude.signedIn], [true, false]);
  assert.equal(st.json.providers.some((p) => p.id === 'mock'), false, 'no mock without HH_HARNESS_MOCK');
  const si = await call('POST', '/providers/claude/signin', {});
  assert.equal(si.json.step.kind, 'open_url');
  assert.match(si.json.step.url, /^https:\/\/claude\.ai\//);
  const done = await call('POST', '/providers/claude/signin/continue', { code: 'good-code-123' });
  assert.equal(done.json.state, 'signed_in');
  const start = await call('POST', '/jobs', { prompt: 'Add a moon melon', provider: 'claude', lang: 'en' });
  assert.equal(start.status, 202, JSON.stringify(start.json));
  let job = null;
  for (let i = 0; i < 400; i++) {
    job = (await call('GET', '/jobs/current')).json.job;
    if (['ready', 'failed'].includes(job.state)) break;
    await sleep(150);
  }
  assert.equal(job.state, 'ready', JSON.stringify({ error: job.error, errors: job.result && job.result.validation && job.result.validation.errors }));
  const v = JSON.parse(JSON.parse(fs.readFileSync(path.join(dir, 'fake-log', 'validate.json'), 'utf8')).content[0].text);
  assert.equal(v.ok, true, 'the bridge reached the real validator through the server\'s real port');
  const applied = await call('POST', `/jobs/${job.id}/apply`);
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
});
