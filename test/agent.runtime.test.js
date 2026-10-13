// The job runtime (harness contract §4.2-§4.5) with the scripted mock provider and a fake of the mods lane: the whole
// life of a job, the fix rounds, one job per farm, rate limits, sign-in, sandbox, timeouts, restart recovery,
// pushes and the telemetry hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createAgent } from '../server/agent/index.js';
import { Runtime } from '../server/agent/runtime.js';
import { stubCtx, tmpRoot, waitFor } from './helpers/agent-harness.js';

const FK = 'local';

async function setup(env = {}, extra = {}) {
  const root = tmpRoot('rt');
  const h = stubCtx({ root, env, ...extra });
  const agent = createAgent(h.ctx, { pushMs: 5 });
  const user = (pid) => agent.runtime.userOf(FK, pid);
  await agent.providers.mock.signIn.start(user('p1'));
  await agent.providers.mock.signIn.continue(user('p1'), { code: 'ok' });
  return { ...h, root, agent, rt: agent.runtime, user };
}

const until = (rt, states, ms = 5000) => waitFor(async () => {
  const j = await rt.current(FK);
  return j && states.includes(j.state) ? j : null;
}, ms, `job state ${states.join('|')}`);

test('a request becomes a ready, validated candidate while the farm keeps playing; apply makes it active', async (t) => {
  const { rt, agent, pushes, records, ctx } = await setup();
  t.after(() => agent.stop());
  const job = await rt.start(FK, 'p1', { prompt: 'Add a moon melon', provider: 'mock', lang: 'bg' });
  assert.equal(job.state, 'starting');
  assert.equal(job.priv, undefined, 'the private part never leaves the server');
  const ready = await until(rt, ['ready']);
  assert.equal(ready.result.candidate, 1);
  assert.equal(ready.result.parent, 0);
  assert.equal(ready.result.validation.ok, true);
  assert.equal(ready.result.validation.full, true);
  assert.deepEqual(ready.result.changes.map((c) => c.id).sort(), ['x_melon_pie', 'x_moon_melon']);
  assert.match(ready.result.summary.bg, /лунни пъпеши/);
  // the pill walked through the steps
  const steps = ready.progress.map((p) => p.step);
  for (const s of ['reading', 'building', 'testing', 'ready']) assert.ok(steps.includes(s), s);
  assert.ok(ready.progress.every((p) => typeof p.note === 'string' && !p.note.includes('/')), 'notes carry no paths');
  // the agent called validate (quick) and the runtime the full check
  const v = ctx.mods.f(FK).validations;
  assert.ok(v.some((x) => !x.full) && v.some((x) => x.full));
  // pushes go to the whole farm (the partner sees the passive pill)
  await waitFor(() => pushes.some((p) => p.msg.e === 'job' && p.msg.job.state === 'ready'), 2000, 'ready push');
  assert.ok(pushes.every((p) => p.msg.t === 'hx' && !(p.msg.job && p.msg.job.priv)));
  await waitFor(() => records.at(-1) && records.at(-1).ev.event === 'job.ready', 2000, 'ready record');
  // apply
  const out = await rt.apply(FK, 'p1', ready.id);
  assert.equal(out.active.n, 1);
  assert.equal((await rt.current(FK)).state, 'applied');
  await waitFor(() => records.at(-1).ev.event === 'job.applied', 2000, 'applied record');
  // the input server/telemetry/payload.js buildPayload reads: the public job, the mod files, the outcome
  const ev = records.at(-1).ev;
  assert.equal(records.at(-1).pid, 'p1');
  assert.deepEqual(ev.job.prompts.map((p) => p.text), ['Add a moon melon']);
  assert.deepEqual(ev.job.result.changes.map((c) => c.id).sort(), ['x_melon_pie', 'x_moon_melon']);
  assert.ok(ev.files['content/crops/x_moon_melon.json']);
  assert.equal(ev.job.provider, 'mock');
  assert.equal(ev.job.priv, undefined);
  assert.equal(ev.outcome.state, 'applied');
  assert.equal(JSON.stringify(ev).includes('mock-signin'), false);
});

test('one job per farm: a second start is 409 BUSY with the current job; only the asker applies', async (t) => {
  const { rt, agent } = await setup({ HH_MOCK_STEP_MS: '30' });
  t.after(() => agent.stop());
  const job = await rt.start(FK, 'p1', { prompt: 'melons', provider: 'mock' });
  await assert.rejects(rt.start(FK, 'p1', { prompt: 'again', provider: 'mock' }), (e) => e.status === 409 && e.body.error === 'BUSY' && e.body.job.id === job.id);
  await until(rt, ['ready']);
  await assert.rejects(rt.apply(FK, 'p2', job.id), (e) => e.status === 403 && e.body.error === 'NOT_YOURS');
  await assert.rejects(rt.apply(FK, 'p1', 'ffffffffffffffff'), (e) => e.status === 404);
  // the partner may discard (a job never locks the farm)
  const d = await rt.discard(FK, 'p2', job.id);
  assert.equal(d.state, 'discarded');
  await assert.rejects(rt.apply(FK, 'p1', job.id), (e) => e.status === 409 && e.body.error === 'NOT_READY');
});

test('bad arguments, sign-in and unknown providers are refused before a job exists', async (t) => {
  const { rt, agent } = await setup();
  t.after(() => agent.stop());
  await assert.rejects(rt.start(FK, 'p1', { prompt: '', provider: 'mock' }), (e) => e.status === 400 && e.body.field === 'prompt');
  await assert.rejects(rt.start(FK, 'p1', { prompt: 'x'.repeat(1001), provider: 'mock' }), (e) => e.status === 400);
  await assert.rejects(rt.start(FK, 'p1', { prompt: 'x', provider: 'nope' }), (e) => e.status === 400 && e.body.field === 'provider');
  await assert.rejects(rt.start(FK, 'p1', { prompt: 'x', provider: 'mock', lang: 'fr' }), (e) => e.status === 400 && e.body.field === 'lang');
  await assert.rejects(rt.start(FK, 'p1', { prompt: 'x', provider: 'mock', model: 'a b' }), (e) => e.status === 400 && e.body.field === 'model');
  await assert.rejects(rt.start(FK, 'p2', { prompt: 'x', provider: 'mock' }), (e) => e.status === 428 && e.body.error === 'SIGN_IN');
  assert.equal(await rt.current(FK), null);
});

test('rate limit: 10 jobs an hour per farmer (429 with retryAfter)', async (t) => {
  let now = 1_800_000_000_000;
  const root = tmpRoot('rate');
  const h = stubCtx({ root, env: { HH_HARNESS_JOBS_PER_HOUR: '2' } });
  const agent = createAgent(h.ctx, { pushMs: 1, now: () => now });
  t.after(() => agent.stop());
  const u = agent.runtime.userOf(FK, 'p1');
  await agent.providers.mock.signIn.start(u);
  await agent.providers.mock.signIn.continue(u, { code: 'x' });
  for (let i = 0; i < 2; i++) {
    const j = await agent.runtime.start(FK, 'p1', { prompt: `ask ${i}`, provider: 'mock' });
    await until(agent.runtime, ['ready']);
    await agent.runtime.discard(FK, 'p1', j.id);
  }
  await assert.rejects(agent.runtime.start(FK, 'p1', { prompt: 'third', provider: 'mock' }), (e) => e.status === 429 && e.body.retryAfter > 0);
  now += 3_600_001;
  await agent.runtime.start(FK, 'p1', { prompt: 'later', provider: 'mock' });
});

test('"fail": the agent fixes its own error inside the round; "broken": two fix rounds, then failed INVALID', async (t) => {
  const { rt, agent, ctx, records } = await setup();
  t.after(() => agent.stop());
  const a = await rt.start(FK, 'p1', { prompt: 'please fail first', provider: 'mock' });
  const ra = await until(rt, ['ready', 'failed']);
  assert.equal(ra.state, 'ready');
  await rt.discard(FK, 'p1', a.id);
  const b = await rt.start(FK, 'p1', { prompt: 'broken please', provider: 'mock' });
  const rb = await until(rt, ['ready', 'failed']);
  assert.equal(rb.id, b.id);
  assert.equal(rb.state, 'failed');
  assert.equal(rb.error.code, 'INVALID');
  assert.equal(rb.result.validation.ok, false);
  assert.equal(rb.result.validation.errors[0].code, 'NOT_LADDER');
  assert.ok(rb.progress.some((p) => p.step === 'fixing'), 'the pill showed the fix rounds');
  // 1 + 2 fix rounds of full validation
  assert.equal(ctx.mods.f(FK).validations.filter((v) => v.full).length >= 4, true);
  // the telemetry record follows the state change (it never holds the job up)
  await waitFor(() => records.at(-1).ev.event === 'job.failed', 2000, 'failed record');
  assert.deepEqual(records.at(-1).ev.job.result.validation.errors.map((e) => e.code), ['NOT_LADDER']);
  assert.equal(records.at(-1).ev.rounds, 3, 'the request and its two fix rounds');
});

test('"ask for changes" revises the same job on top of the agent\'s own work', async (t) => {
  const { rt, agent } = await setup();
  t.after(() => agent.stop());
  const job = await rt.start(FK, 'p1', { prompt: 'melons', provider: 'mock' });
  await until(rt, ['ready']);
  await assert.rejects(rt.revise(FK, 'p2', job.id, { prompt: 'x' }), (e) => e.status === 403);
  const r = await rt.revise(FK, 'p1', job.id, { prompt: 'and a lantern' });
  assert.equal(r.id, job.id);
  assert.equal(r.round, 2);
  assert.equal(r.state, 'revising');
  const ready = await until(rt, ['ready']);
  assert.equal(ready.result.candidate, 2);
  assert.ok(ready.result.changes.some((c) => c.id === 'x_moon_lantern'));
  assert.ok(ready.result.changes.some((c) => c.id === 'x_moon_melon'));
  assert.deepEqual(ready.prompts.map((p) => p.text), ['melons', 'and a lantern']);
});

test('apply against a farm that moved answers 409 STALE and the job stays ready', async (t) => {
  const { rt, agent, ctx } = await setup();
  t.after(() => agent.stop());
  const job = await rt.start(FK, 'p1', { prompt: 'melons', provider: 'mock' });
  await until(rt, ['ready']);
  ctx.mods.f(FK).stale = true;
  await assert.rejects(rt.apply(FK, 'p1', job.id), (e) => e.status === 409 && e.body.error === 'STALE');
  assert.equal((await rt.current(FK)).state, 'ready');
});

test('cancel stops a running job at once and frees the farm', async (t) => {
  const { rt, agent } = await setup({ HH_MOCK_STEP_MS: '200' });
  t.after(() => agent.stop());
  const job = await rt.start(FK, 'p1', { prompt: 'slow melons', provider: 'mock' });
  await waitFor(async () => (await rt.current(FK)).state === 'working', 2000);
  const c = await rt.cancel(FK, 'p2', job.id);
  assert.equal(c.state, 'cancelled');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await rt.current(FK)).state, 'cancelled', 'nothing overwrote the cancel');
  await rt.start(FK, 'p1', { prompt: 'again', provider: 'mock' });
});

/** A provider for edge cases: does what the test says, signed in always. */
function customProvider(run) {
  return { id: 'custom', available: async () => ({ ok: true }), models: async () => [],
    signIn: { status: async () => ({ provider: 'custom', state: 'signed_in' }), start: async () => ({}), continue: async () => ({}), signOut: async () => ({}) },
    run, cancel() {} };
}

async function customSetup(run, env = {}) {
  const root = tmpRoot('cus');
  const h = stubCtx({ root, env });
  const agent = createAgent(h.ctx, { pushMs: 1, providers: { custom: customProvider(run) } });
  return { ...h, agent, rt: agent.runtime };
}

test('a round that writes outside mod/ fails SANDBOX even when the mod is fine', async (t) => {
  const { rt, agent } = await customSetup(async (job, io) => {
    await io.tools.write_file({ path: 'mod/mod.json', content: '{"format":1}' });
    fs.writeFileSync(path.join(io.cwd, 'docs', 'mod-guide.md'), 'rewritten');
    return { ok: true, turns: 1 };
  });
  t.after(() => agent.stop());
  await rt.start(FK, 'p1', { prompt: 'x', provider: 'custom' });
  const j = await until(rt, ['failed', 'ready']);
  assert.equal(j.state, 'failed');
  assert.equal(j.error.code, 'SANDBOX');
});

test('an agent that goes quiet is stopped (TIMEOUT); a provider that throws is PROVIDER', async (t) => {
  const quiet = await customSetup(async (job, io) => new Promise((resolve) => io.signal.addEventListener('abort', () => resolve({ ok: false, code: 'CANCELLED', turns: 0 }))),
    { HH_AGENT_IDLE_MS: '150' });
  t.after(() => quiet.agent.stop());
  await quiet.rt.start(FK, 'p1', { prompt: 'x', provider: 'custom' });
  const j = await until(quiet.rt, ['failed'], 3000);
  assert.equal(j.error.code, 'TIMEOUT');
  const thrower = await customSetup(async () => { throw new Error('boom'); });
  t.after(() => thrower.agent.stop());
  await thrower.rt.start(FK, 'p1', { prompt: 'x', provider: 'custom' });
  assert.equal((await until(thrower.rt, ['failed'])).error.code, 'PROVIDER');
});

test('a SIGN_IN end tells that farmer (only) to sign in again', async (t) => {
  const { rt, agent, pushes } = await customSetup(async () => ({ ok: false, code: 'SIGN_IN', turns: 0 }));
  t.after(() => agent.stop());
  await rt.start(FK, 'p1', { prompt: 'x', provider: 'custom' });
  assert.equal((await until(rt, ['failed'])).error.code, 'SIGN_IN');
  const s = pushes.find((p) => p.msg.e === 'signin');
  assert.equal(s.pid, 'p1');
  assert.equal(s.msg.state, 'signed_out');
});

test('restart: an active job becomes failed RESTARTED, a ready one survives; 24 h later it expires', async () => {
  let now = 1_800_000_000_000;
  const root = tmpRoot('restart');
  const h = stubCtx({ root });
  const a = createAgent(h.ctx, { pushMs: 1, now: () => now });
  const u = a.runtime.userOf(FK, 'p1');
  await a.providers.mock.signIn.start(u);
  await a.providers.mock.signIn.continue(u, { code: 'x' });
  const job = await a.runtime.start(FK, 'p1', { prompt: 'melons', provider: 'mock' });
  await until(a.runtime, ['ready']);
  await a.stop();
  // a second process over the same folder
  const b = createAgent(h.ctx, { pushMs: 1, now: () => now });
  const j = await b.runtime.current(FK);
  assert.equal(j.id, job.id);
  assert.equal(j.state, 'ready');
  // and an active one on disk
  const file = path.join(h.ctx.dirOf(FK), 'jobs', job.id, 'job.json');
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...disk, state: 'working' }));
  const c = createAgent(h.ctx, { pushMs: 1, now: () => now });
  const k = await c.runtime.current(FK);
  assert.equal(k.state, 'failed');
  assert.equal(k.error.code, 'RESTARTED');
  // expiry of a ready job
  fs.writeFileSync(file, JSON.stringify({ ...disk, state: 'ready' }));
  now += 25 * 3_600_000;
  const d = createAgent(h.ctx, { pushMs: 1, now: () => now });
  assert.equal((await d.runtime.current(FK)).state, 'expired');
  await Promise.all([b.stop(), c.stop(), d.stop()]);
});

test('files: dirs 0700, job.json 0600, and nothing in the job file but the job', async (t) => {
  const { rt, agent, ctx } = await setup();
  t.after(() => agent.stop());
  const job = await rt.start(FK, 'p1', { prompt: 'melons', provider: 'mock' });
  await until(rt, ['ready']);
  const dir = path.join(ctx.dirOf(FK), 'jobs', job.id);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(dir, 'job.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(dir, 'private')).mode & 0o777, 0o700);
});

test('state(): providers with sign-in, the current job and the limits; HH_HARNESS=off says disabled', async (t) => {
  const { agent } = await setup();
  t.after(() => agent.stop());
  const s = await agent.state(FK, 'p1');
  assert.equal(s.enabled, true);
  const ids = s.providers.map((p) => p.id);
  assert.deepEqual(ids, ['claude', 'chatgpt', 'mock']);
  const mock = s.providers.find((p) => p.id === 'mock');
  assert.equal(mock.signedIn, true);
  assert.equal(s.limits.prompt, 1000);
  const p2 = await agent.state(FK, 'p2');
  assert.equal(p2.providers.find((p) => p.id === 'mock').signedIn, false, 'sign-ins are per farmer');
  const off = await setup({ HH_HARNESS: 'off' });
  t.after(() => off.agent.stop());
  assert.deepEqual(await off.agent.state(FK, 'p1'), { enabled: false });
});

test('the global cap: a job waits for a free helper instead of failing', async (t) => {
  const root = tmpRoot('cap');
  const h = stubCtx({ root, env: { HH_AGENT_MAX_RUNS: '1', HH_MOCK_STEP_MS: '40' } });
  const agent = createAgent(h.ctx, { pushMs: 1 });
  t.after(() => agent.stop());
  const rt = agent.runtime;
  for (const fk of ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']) {
    const u = rt.userOf(fk, 'p1');
    await agent.providers.mock.signIn.start(u);
    await agent.providers.mock.signIn.continue(u, { code: 'x' });
    await rt.start(fk, 'p1', { prompt: 'melons', provider: 'mock' });
  }
  const second = await rt.current('bbbbbbbbbbbb');
  await waitFor(() => second.progress.some((p) => p.code === 'wait'), 2000, 'wait note');
  await waitFor(async () => (await rt.current('aaaaaaaaaaaa')).state === 'ready' && (await rt.current('bbbbbbbbbbbb')).state === 'ready', 8000, 'both ready');
});

test('Runtime is exported for the harness router', () => {
  assert.equal(typeof Runtime, 'function');
});

test('a stage that finds the farm moved (INVALID on the re-check) goes to a fix round, not a crash', async (t) => {
  const { rt, agent, ctx } = await setup();
  t.after(() => agent.stop());
  const stage = ctx.mods.stage;
  let n = 0;
  ctx.mods.stage = async (...a) => {
    if (n++ === 0) {
      const e = new Error('INVALID');
      e.code = 'INVALID';
      e.validation = { ok: false, stage: 'semantic', full: true, errors: [{ stage: 'semantic', code: 'ID_TAKEN', file: 'content/crops/x_moon_melon.json', path: 'id', message: 'm' }] };
      throw e;
    }
    return stage(...a);
  };
  await rt.start(FK, 'p1', { prompt: 'melons', provider: 'mock' });
  const j = await until(rt, ['ready', 'failed']);
  assert.equal(j.state, 'ready');
  assert.ok(j.progress.some((p) => p.code === 'fix'));
  assert.equal(n, 2);
});
