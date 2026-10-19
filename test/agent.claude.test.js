// The Claude provider with a fake binary (test/fixtures/fake-claude.mjs): the PROVIDER RULES in practice. The binary is
// probed and refused when a restriction flag is missing; the sign-in is the binary's own `auth login` relayed through a
// pseudo-terminal (URL out, code in); runs get a clean env, our MCP bridge, the restricted tool set and the settings;
// and our code never reads a file inside a farmer's private Claude folders (an fs spy proves it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { createAgent } from '../server/agent/index.js';
import { FIRST_MESSAGE } from '../server/agent/workspace.js';
import { stubCtx, tmpRoot, waitFor } from './helpers/agent-harness.js';
import { ROOT } from './helpers.js';

const FK = 'local';
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake-claude.mjs');

/** A `claude` on disk: a shell wrapper that gives the fake its config (the server passes a clean env). */
function fakeBin(root, conf = {}) {
  const dir = path.join(root, 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const confFile = path.join(root, 'fake-conf.json');
  const log = path.join(root, 'fake-log');
  fs.writeFileSync(confFile, JSON.stringify({ log, ...conf }));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\nexec env FAKE_CLAUDE_CONF='${confFile}' '${process.execPath}' '${FAKE}' "$@"\n`, { mode: 0o755 });
  return { bin, log, read: (name) => JSON.parse(fs.readFileSync(path.join(log, name), 'utf8')) };
}

async function setup({ conf = {}, mode = 'single', env = {}, scriptBin } = {}) {
  const root = tmpRoot('claude');
  const fb = fakeBin(root, conf);
  const h = stubCtx({ root, mode, env: { HH_CLAUDE_BIN: fb.bin, ...env } });
  const agent = createAgent(h.ctx, { pushMs: 1, ...(scriptBin !== undefined ? { scriptBin } : {}) });
  const app = express();
  agent.loopbackRoutes(app);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  agent.listening(server.address().port);
  const claude = agent.providers.claude;
  const user = (pid = 'p1') => agent.runtime.userOf(FK, pid);
  const close = async () => { await agent.stop(); await new Promise((r) => server.close(r)); };
  const signIn = async (pid = 'p1') => {
    const st = await claude.signIn.start(user(pid));
    assert.equal(st.state, 'pending', JSON.stringify(st));
    return claude.signIn.continue(user(pid), { code: 'good-code-123' });
  };
  return { ...h, root, fb, agent, claude, user, close, signIn };
}

const endOf = (rt) => waitFor(async () => { const j = await rt.current(FK); return j && ['ready', 'failed'].includes(j.state) ? j : null; }, 15000, 'job end');

test('probe: the version and the restriction flags come from the binary; a missing flag is UNSAFE_VERSION', async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.deepEqual(await s.claude.available(), { ok: true, version: '2.1.296' });
  const p = await s.claude._probe();
  for (const f of ['--tools', '--disallowedTools', '--restricted', '--permission-prompts', '--max-turns']) assert.ok(p.flags.has(f), f);
  const unsafe = await setup({ conf: { help: 'unsafe' } });
  t.after(unsafe.close);
  assert.deepEqual(await unsafe.claude.available(), { ok: false, reason: 'UNSAFE_VERSION' });
  // --restricted confines the file tools to the job folder: a binary without it is never run (verifier, defect 2)
  const loose = await setup({ conf: { help: 'norestricted' } });
  t.after(loose.close);
  assert.deepEqual(await loose.claude.available(), { ok: false, reason: 'UNSAFE_VERSION' });
  const listed = (await loose.agent.runtime.providerList(FK, 'p1')).find((x) => x.id === 'claude');
  assert.deepEqual([listed.available, listed.reason], [false, 'UNSAFE_VERSION'], 'listed as unavailable, with the reason');
  await assert.rejects(loose.agent.runtime.start(FK, 'p1', { prompt: 'melons', provider: 'claude' }),
    (x) => x.status === 503 && x.body.reason === 'UNSAFE_VERSION');
  const none = await setup({ env: { HH_CLAUDE_BIN: '/nonexistent/claude' } });
  t.after(none.close);
  assert.deepEqual(await none.claude.available(), { ok: false, reason: 'NO_BINARY' });
  // the binary is never run with the farmer's or the server's identity: the probe has its own private folders
  assert.ok(fs.existsSync(path.join(s.ctx.hostDir, 'claude-probe', 'config')));
});

test('multi mode needs HH_CLAUDE_HOSTING=accepted (the operator accepted the Commercial Terms)', async (t) => {
  const s = await setup({ mode: 'multi' });
  t.after(s.close);
  assert.deepEqual(await s.claude.available(), { ok: false, reason: 'HOST_NOT_ALLOWED' });
  const ok = await setup({ mode: 'multi', env: { HH_CLAUDE_HOSTING: 'accepted' } });
  t.after(ok.close);
  assert.equal((await ok.claude.available()).ok, true);
});

test('sign-in relay: the binary\'s own login under a pseudo-terminal; only its URL goes out, only the code goes in', async (t) => {
  const s = await setup();
  t.after(s.close);
  const st = await s.claude.signIn.start(s.user());
  assert.equal(st.state, 'pending');
  assert.equal(st.step.kind, 'open_url');
  assert.equal(st.step.url, 'https://claude.ai/oauth/authorize?code=true&client_id=fake-client&state=fake-state');
  assert.deepEqual(st.step.paste, { field: 'code' });
  // a second start while one runs answers the same pending login (no second process)
  assert.equal((await s.claude.signIn.start(s.user())).step.url, st.step.url);
  const bad = await s.claude.signIn.continue(s.user(), { code: 'wrong-code' });
  assert.equal(bad.state, 'error');
  assert.equal(bad.error.code, 'BAD_CODE');
  assert.equal((await s.claude.signIn.status(s.user())).state, 'signed_out');
  // typed input is one line of printable characters, nothing else
  await s.claude.signIn.start(s.user());
  assert.equal((await s.claude.signIn.continue(s.user(), { code: 'abc\n/logout' })).error.code, 'BAD_CODE');
  const ok = await s.claude.signIn.continue(s.user(), { code: 'good-code-123' });
  assert.equal(ok.state, 'signed_in');
  assert.deepEqual(ok.account, { label: 'f***@example.com' });
  assert.ok(s.pushes.some((p) => p.msg.e === 'signin' && p.pid === 'p1' && p.msg.state === 'signed_in'));
  // the login ran with a clean env: no server setting reached it
  const env = s.fb.read('login-env.json');
  assert.equal(env.some((k) => k.startsWith('HH_')), false);
  assert.ok(env.includes('CLAUDE_CONFIG_DIR'));
  // per farmer: the partner is not signed in
  assert.equal((await s.claude.signIn.status(s.user('p2'))).state, 'signed_out');
});

test('two sign-in starts at once share one login process (the check and the claim are one step)', async (t) => {
  const s = await setup();
  t.after(s.close);
  const [a, b] = await Promise.all([s.claude.signIn.start(s.user()), s.claude.signIn.start(s.user())]);
  assert.equal(a.state, 'pending');
  assert.equal(b.state, 'pending');
  assert.equal(a.step.url, b.step.url);
  assert.equal((await s.claude.signIn.continue(s.user(), { code: 'good-code-123' })).state, 'signed_in');
  const logins = fs.readFileSync(path.join(s.fb.log, 'logins.log'), 'utf8').trim().split('\n');
  assert.equal(logins.length, 1, `${logins.length} login processes for one farmer`);
});

test('without util-linux script the relay works over plain pipes', async (t) => {
  const s = await setup({ scriptBin: null });
  t.after(s.close);
  assert.equal((await s.signIn()).state, 'signed_in');
});

test('a run: restricted flags, our MCP bridge, settings, clean env; the bridge reaches the farm\'s validator', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.signIn();
  const job = await s.agent.runtime.start(FK, 'p1', { prompt: 'Add a moon melon', provider: 'claude', model: 'sonnet' });
  const end = await endOf(s.agent.runtime);
  assert.equal(end.state, 'ready', JSON.stringify(end.error));
  assert.deepEqual(end.result.changes.map((c) => c.id), ['x_moon_melon']);
  assert.match(end.result.summary.bg, /лунни пъпеши/);
  const argv = s.fb.read('argv.json');
  const val = (f) => argv[argv.indexOf(f) + 1];
  for (const f of ['-p', '--verbose', '--strict-mcp-config', '--restricted', '--no-session-persistence', '--disable-slash-commands']) assert.ok(argv.includes(f), f);
  assert.equal(val('--output-format'), 'stream-json');
  assert.equal(val('--model'), 'sonnet');
  assert.equal(val('--max-turns'), '40');
  assert.equal(val('--tools'), 'Read,Glob,Grep,Write,Edit');
  // pre-approved only inside the job folder: a bare Read/Write/Edit would approve every path on the machine
  assert.equal(val('--allowedTools'), 'Read(./**),Glob(./**),Grep(./**),Edit(./mod/**),Edit(./summary.json),mcp__hh__validate,mcp__hh__preview');
  assert.equal(val('--disallowedTools'), 'Bash,WebFetch,WebSearch,Task,Agent,NotebookEdit');
  assert.equal(val('--permission-mode'), 'dontAsk');
  assert.equal(val('--permission-prompts'), 'none');
  assert.match(val('--append-system-prompt'), /^You are Harvey, the helper of the cozy co-op farm game/);
  assert.equal(argv.includes('setup-token'), false);
  const priv = path.join(s.ctx.dirOf(FK), 'jobs', job.id, 'private');
  assert.equal(val('--mcp-config'), path.join(priv, 'mcp.json'));
  assert.equal(val('--settings'), path.join(priv, 'settings.json'));
  const settings = JSON.parse(fs.readFileSync(path.join(priv, 'settings.json'), 'utf8'));
  // defence in depth beside --restricted (verifier, defect 2): reads stay in the working folder, writes in mod/ and
  // summary.json (Claude Code checks Write against Edit(...) rules), and the job's private folder and every farmer's
  // sign-in folder are denied by absolute path
  assert.equal(settings.permissions.blockReadsOutsideWorkingDirectories, true);
  assert.deepEqual(settings.permissions.allow.filter((r) => /^(Write|Edit)\b/.test(r)), ['Edit(./mod/**)', 'Edit(./summary.json)']);
  assert.ok(settings.permissions.allow.every((r) => r.includes('(') || r.startsWith('mcp__hh__')), 'no bare tool is pre-approved');
  const usersDir = path.join(s.ctx.dirOf(FK), 'users');
  for (const r of ['Bash', 'WebFetch', 'WebSearch', 'Read(../**)', 'Edit(../**)', 'Read(~/**)', 'Edit(~/**)', `Read(/${priv}/**)`, `Edit(/${priv}/**)`,
    `Read(/${usersDir}/**)`, `Edit(/${usersDir}/**)`]) assert.ok(settings.permissions.deny.includes(r), r);
  assert.equal(s.fb.read('stdin.txt').trim(), FIRST_MESSAGE);
  const env = s.fb.read('env.json');
  assert.equal(env.some((k) => k.startsWith('HH_')), false, 'no server setting in the agent\'s env');
  assert.deepEqual(s.fb.read('mcp-tools.json').tools.map((x) => x.name), ['validate', 'preview']);
  const v = JSON.parse(s.fb.read('validate.json').content[0].text);
  assert.equal(v.ok, true, 'the bridge reached the runtime and the validator');
  // the job token lives only in private/, never in the work folder the agent reads
  const mcp = JSON.parse(fs.readFileSync(path.join(priv, 'mcp.json'), 'utf8'));
  const token = mcp.mcpServers.hh.env.HH_AGENT_TOKEN;
  assert.match(token, /^[0-9a-f]{64}$/);
  const work = path.join(s.ctx.dirOf(FK), 'jobs', job.id, 'work');
  for (const f of fs.readdirSync(work, { recursive: true })) {
    const full = path.join(work, f);
    if (fs.statSync(full).isFile()) assert.equal(fs.readFileSync(full, 'utf8').includes(token), false, f);
  }
  assert.equal(end.priv.isolation, 'restricted', 'the job records the isolation the binary offered');
});

test('runs that break the sandbox or lose the sign-in end honestly', async (t) => {
  const s = await setup({ conf: { tools: ['Bash'] } });
  t.after(s.close);
  await s.signIn();
  await s.agent.runtime.start(FK, 'p1', { prompt: 'melons', provider: 'claude' });
  assert.equal((await endOf(s.agent.runtime)).error.code, 'SANDBOX', 'a session that offers Bash is stopped');
  const e = await setup();
  t.after(e.close);
  await e.signIn();
  await e.agent.runtime.start(FK, 'p1', { prompt: 'melons escape', provider: 'claude' });
  assert.equal((await endOf(e.agent.runtime)).error.code, 'SANDBOX', 'a write outside mod/ fails the round');
  const n = await setup();
  t.after(n.close);
  await assert.rejects(n.agent.runtime.start(FK, 'p1', { prompt: 'melons', provider: 'claude' }), (x) => x.status === 428);
  // signed in, then the login is gone (the binary says "Not logged in")
  await n.signIn();
  fs.rmSync(path.join(n.user().dir, 'claude', 'config', '.credentials.json'));
  await n.agent.runtime.start(FK, 'p1', { prompt: 'melons', provider: 'claude' });
  assert.equal((await endOf(n.agent.runtime)).error.code, 'SIGN_IN');
  const q = await setup();
  t.after(q.close);
  await q.signIn();
  await q.agent.runtime.start(FK, 'p1', { prompt: 'melons noresult', provider: 'claude' });
  assert.equal((await endOf(q.agent.runtime)).error.code, 'PROVIDER');
});

test('cancel kills the agent process group', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.signIn();
  const job = await s.agent.runtime.start(FK, 'p1', { prompt: 'melons hang', provider: 'claude' });
  await waitFor(() => fs.existsSync(path.join(s.fb.log, 'stdin.txt')), 10000, 'agent started');
  await s.agent.runtime.cancel(FK, 'p1', job.id);
  await waitFor(() => !s.agent.runtime.live.has(job.id), 10000, 'run ended');
  assert.equal((await s.agent.runtime.current(FK)).state, 'cancelled');
});

test('our code never reads inside a farmer\'s private Claude folders; sign-out removes them', async (t) => {
  const s = await setup();
  t.after(s.close);
  const base = path.join(s.user().dir, 'claude');
  const below = (p) => typeof p === 'string' && (p.startsWith(`${base}/home/`) || p.startsWith(`${base}/config/`));
  const reads = [];
  const spied = [];
  const spy = (obj, names) => {
    for (const n of names) {
      const orig = obj[n];
      if (typeof orig !== 'function') continue;
      obj[n] = function (p, ...rest) { if (below(String(p))) reads.push(`${n} ${p}`); return orig.call(this, p, ...rest); };
      spied.push(() => { obj[n] = orig; });
    }
  };
  spy(fsp, ['readFile', 'open', 'readdir', 'opendir', 'copyFile', 'cp', 'stat', 'lstat', 'access', 'readlink']);
  spy(fs, ['readFileSync', 'openSync', 'readdirSync', 'createReadStream', 'copyFileSync', 'statSync', 'lstatSync', 'accessSync', 'existsSync']);
  t.after(() => { for (const r of spied) r(); });
  await s.signIn();
  assert.equal((await s.claude.signIn.status(s.user())).state, 'signed_in');
  await s.agent.runtime.start(FK, 'p1', { prompt: 'Add a moon melon', provider: 'claude' });
  assert.equal((await endOf(s.agent.runtime)).state, 'ready');
  await s.agent.runtime.state(FK, 'p1');
  const ours = [...reads];
  // the spy itself works: a read below the folders is caught
  await fsp.readFile(path.join(base, 'config', '.credentials.json')).catch(() => {});
  assert.equal(reads.length, ours.length + 1);
  reads.pop();
  const out = await s.claude.signIn.signOut(s.user());
  for (const r of spied.splice(0)) r();
  assert.deepEqual(reads, []);
  assert.equal(out.state, 'signed_out');
  assert.equal(fs.existsSync(base), false);
});
