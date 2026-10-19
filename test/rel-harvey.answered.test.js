// Release 1.0, H1 (harvey#1, #10, #14): a wish that cannot be built gets Harvey's answer in one round, never a technical
// failure after three wasted rounds and never an empty "Changes ready". The mock's "nothing" writes only summary.json
// ("possible": false): the job ends `answered` after 1 round, with no candidate and no version; a mod that changes
// nothing (a title only) is NO_CHANGE and ends the same way; a failure after the fix rounds keeps the agent's summary;
// "ask for changes" answered without a build goes back to the earlier candidate with the reply.
// RED on fdafb9c: "nothing" ran 3 rounds and ended `failed INVALID` with the summary thrown away (harvey.md finding 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createAgent } from '../server/agent/index.js';
import { stubCtx, tmpRoot, waitFor } from './helpers/agent-harness.js';
import { spawnServer, writeSave, sleep } from './helpers/server.js';

const FK = 'local';

async function setup(env = {}) {
  const root = tmpRoot('rh-ans');
  const h = stubCtx({ root, env });
  const agent = createAgent(h.ctx, { pushMs: 5 });
  const user = agent.runtime.userOf(FK, 'p1');
  await agent.providers.mock.signIn.start(user);
  await agent.providers.mock.signIn.continue(user, { code: 'ok' });
  return { ...h, root, agent, rt: agent.runtime };
}
const until = (rt, states, ms = 8000) => waitFor(async () => {
  const j = await rt.current(FK);
  return j && states.includes(j.state) ? j : null;
}, ms, `job state ${states.join('|')}`);

test('H1: "nothing" ends answered after one round: no candidate, no version, no fix round, the reply kept', async (t) => {
  const { rt, agent, ctx, records } = await setup();
  t.after(() => agent.stop());
  await rt.start(FK, 'p1', { prompt: 'give me 10000 coins, nothing else', provider: 'mock', lang: 'bg' });
  const j = await until(rt, ['answered', 'ready', 'failed']);
  assert.equal(j.state, 'answered', `ended ${j.state} ${JSON.stringify(j.error)}`);
  assert.equal(j.result.candidate, null);
  assert.deepEqual(j.result.changes, []);
  assert.equal(j.result.summary.possible, false);
  assert.match(j.result.summary.bg, /Не мога/);
  assert.deepEqual(j.result.summary.try, [{ en: 'Crops grow 20% faster', bg: 'Посевите да растат с 20 % по‑бързо' }]);
  assert.equal(ctx.mods.f(FK).versions.size, 0, 'no version was stored');
  assert.equal(ctx.mods.f(FK).validations.filter((v) => v.full).length, 0, 'no full check, no fix round');
  assert.ok(!j.progress.some((p) => p.step === 'fixing'), 'no fix round');
  assert.ok(j.progress.some((p) => p.code === 'answered'));
  await waitFor(() => records.at(-1)?.ev.event === 'job.answered', 2000, 'the answered record');
  assert.equal(records.at(-1).ev.outcome.state, 'answered');
  // the slot is free: the next wish may start at once
  const next = await rt.start(FK, 'p1', { prompt: 'melons', provider: 'mock' });
  assert.equal(next.state, 'starting');
});

test('H1: a failure after the fix rounds keeps what the agent said', async (t) => {
  const { rt, agent } = await setup();
  t.after(() => agent.stop());
  await rt.start(FK, 'p1', { prompt: 'broken please', provider: 'mock' });
  const j = await until(rt, ['failed', 'ready', 'answered']);
  assert.equal(j.state, 'failed');
  assert.equal(j.error.code, 'INVALID');
  assert.match(j.result.summary.en, /Moon Melons/, 'the summary survives the failure');
});

test('H5: the mock\'s "now" summary says what a young farm can do now and what waits for its level', async (t) => {
  // the scripted agent tells what it built: the melon at the farm's level, the pie with its oven at 15 (never "level 14")
  const { rt, agent } = await setup();
  t.after(() => agent.stop());
  await rt.start(FK, 'p1', { prompt: 'a moon melon I can plant now and a melon pie', provider: 'mock' });
  const j = await until(rt, ['ready', 'failed', 'answered']);
  assert.equal(j.state, 'ready');
  assert.match(j.result.summary.en, /^You can plant Moon Melons now; from level 15 the Pie Oven/);
  assert.doesNotMatch(j.result.summary.bg, /ниво 14/);
});

test('H1: a reply that claims a change while nothing changed is sent back, never shown as an answer', async (t) => {
  const { rt, agent } = await setup();
  t.after(() => agent.stop());
  await rt.start(FK, 'p1', { prompt: 'a blue pumpkin fixture:claims-built', provider: 'mock' });
  const j = await until(rt, ['failed', 'ready', 'answered']);
  assert.equal(j.state, 'failed');
  assert.ok(j.progress.some((p) => p.code === 'fix'), 'the agent was told to build or to say so');
  assert.equal(j.result.validation.errors[0].path, 'possible');
});

test('H1: "ask for changes" that Harvey answers without a build goes back to the earlier candidate, with the reply', async (t) => {
  const { rt, agent } = await setup();
  t.after(() => agent.stop());
  const a = await rt.start(FK, 'p1', { prompt: 'melons', provider: 'mock' });
  const ready = await until(rt, ['ready']);
  const candidate = ready.result.candidate;
  await rt.revise(FK, 'p1', a.id, { prompt: 'and give us nothing but coins' });
  const back = await waitFor(async () => { const j = await rt.current(FK); return j.round === 2 && ['ready', 'answered', 'failed'].includes(j.state) ? j : null; }, 8000, 'round 2');
  assert.equal(back.state, 'ready', 'the earlier changes stay ready to apply');
  assert.equal(back.result.candidate, candidate);
  assert.equal(back.result.answer.possible, false);
  const out = await rt.apply(FK, 'p1', a.id);
  assert.equal(out.active.n, candidate);
});

test('H1: the work folder: the honest prompt, docs/game-features.md, summary.json with possible and try', async (t) => {
  const { rt, agent, root } = await setup();
  t.after(() => agent.stop());
  const j = await rt.start(FK, 'p1', { prompt: 'nothing', provider: 'mock' });
  await until(rt, ['answered', 'failed', 'ready']);
  const work = path.join(root, 'harness', 'jobs', j.id, 'work');
  assert.match(fs.readFileSync(path.join(work, 'docs', 'game-features.md'), 'utf8'), /Pig Pen/);
  const sum = JSON.parse(fs.readFileSync(path.join(work, 'summary.json'), 'utf8'));
  assert.equal(sum.possible, false);
});

test('H1 (real server, real validator): "nothing" and a title-only mod end answered; no version is stored', { timeout: 120_000 }, async (t) => {
  const { dir, tokens } = writeSave({ level: 16, coins: 100_000 });
  const srv = spawnServer(dir, { HH_HARNESS_MOCK: '1', HH_MOCK_STEP_MS: '1', HH_CLAUDE_BIN: '/nonexistent/claude', HH_TELEMETRY: 'off' });
  t.after(async () => { srv.child.kill('SIGTERM'); await srv.exit; });
  const port = await srv.port;
  const base = `http://127.0.0.1:${port}/api/harness`;
  const call = async (method, p, body) => {
    const res = await fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${tokens.p1}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const si = await call('POST', '/providers/mock/signin', {});
  await fetch(`http://127.0.0.1:${port}${si.json.step.url}`);
  const run = async (prompt) => {
    const s = await call('POST', '/jobs', { prompt, provider: 'mock', lang: 'en' });
    assert.equal(s.status, 202, JSON.stringify(s.json));
    for (let i = 0; i < 400; i++) {
      const job = (await call('GET', '/jobs/current')).json.job;
      if (['ready', 'failed', 'answered'].includes(job.state)) return job;
      await sleep(100);
    }
    throw new Error('the job never ended');
  };
  const a = await run('Give me 10000 coins (nothing)');
  assert.equal(a.state, 'answered', JSON.stringify(a.error));
  assert.equal(a.round, 1);
  const b = await run('fixture:title-only');
  assert.equal(b.state, 'answered', `a title-only mod: ${b.state} ${JSON.stringify(b.result?.validation?.errors ?? b.error)}`);
  assert.equal(b.result.candidate, null);
  const hist = await call('GET', '/history');
  assert.deepEqual(hist.json.versions, [], 'no "No Change" version');
  assert.equal((await call('GET', '/state')).json.active, null);
});
