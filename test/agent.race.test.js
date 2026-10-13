// One job per farm under concurrency (verifier 2026-10-13, defect 1): two farmers (or two tabs) pressing Ask at the
// same moment must never start two jobs on one farm. The farm's slot is claimed in the same synchronous step as the
// BUSY and rate checks, before any wait, and released on every failure path; "ask for changes" claims its job the
// same way, so a second round, an apply or a discard that arrive meanwhile are refused instead of running alongside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createAgent } from '../server/agent/index.js';
import { stubCtx, tmpRoot, waitFor } from './helpers/agent-harness.js';

const FK = 'local';

async function setup(env = {}, { signed = ['p1', 'p2'] } = {}) {
  const h = stubCtx({ root: tmpRoot('race'), env: { HH_MOCK_STEP_MS: '30', ...env } });
  const agent = createAgent(h.ctx, { pushMs: 5 });
  for (const pid of signed) {
    const u = agent.runtime.userOf(FK, pid);
    await agent.providers.mock.signIn.start(u);
    await agent.providers.mock.signIn.continue(u, { code: 'ok' });
  }
  return { ...h, agent, rt: agent.runtime };
}

const settled = async (calls) => {
  const out = await Promise.allSettled(calls);
  return {
    ok: out.filter((o) => o.status === 'fulfilled').map((o) => o.value),
    refused: out.filter((o) => o.status === 'rejected').map((o) => o.reason),
  };
};
const jobDirs = (h) => {
  try { return fs.readdirSync(path.join(h.ctx.dirOf(FK), 'jobs')).filter((n) => /^[0-9a-f]{16}$/.test(n)); } catch { return []; }
};
const until = (rt, states) => waitFor(async () => {
  const j = await rt.current(FK);
  return j && states.includes(j.state) ? j : null;
}, 8000, `job state ${states.join('|')}`);

test('two farmers press Ask at once: exactly one job starts, the other is 409 BUSY with that job', async (t) => {
  const s = await setup();
  t.after(() => s.agent.stop());
  const { ok, refused } = await settled([
    s.rt.start(FK, 'p1', { prompt: 'melons', provider: 'mock' }),
    s.rt.start(FK, 'p2', { prompt: 'pumpkins', provider: 'mock' }),
  ]);
  assert.equal(ok.length, 1, `${ok.length} jobs started on one farm`);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].status, 409);
  assert.equal(refused[0].body.error, 'BUSY');
  assert.equal(refused[0].body.job.id, ok[0].id, 'the refusal names the job that holds the farm');
  const cur = await s.rt.current(FK);
  assert.equal(cur.id, ok[0].id, 'the started job is the farm\'s current job (nothing orphaned)');
  assert.deepEqual(jobDirs(s), [ok[0].id], 'one job folder');
  await until(s.rt, ['ready']);
});

test('the rate count is claimed with the slot: with a limit of one, three starts at once start one job', async (t) => {
  const s = await setup({ HH_HARNESS_JOBS_PER_HOUR: '1', HH_HARNESS_JOBS_PER_DAY: '1' });
  t.after(() => s.agent.stop());
  const { ok, refused } = await settled([
    s.rt.start(FK, 'p1', { prompt: 'one', provider: 'mock' }),
    s.rt.start(FK, 'p1', { prompt: 'two', provider: 'mock' }),
    s.rt.start(FK, 'p2', { prompt: 'three', provider: 'mock' }),
  ]);
  assert.equal(ok.length, 1, `${ok.length} jobs started with a limit of 1`);
  assert.ok(refused.every((e) => e.status === 409 || e.status === 429), refused.map((e) => e.body?.error).join());
  const j = await until(s.rt, ['ready']);
  await s.rt.discard(FK, j.by, j.id);
  // the day's one job is used: the next start is RATE, not a second job
  await assert.rejects(s.rt.start(FK, 'p2', { prompt: 'four', provider: 'mock' }), (e) => e.status === 429 && e.body.error === 'RATE');
  assert.equal((await s.rt.limits(FK, 'p1')).usedDay, 1);
});

test('a start refused after the claim (not signed in) frees the slot and the rate count again', async (t) => {
  const s = await setup({ HH_HARNESS_JOBS_PER_HOUR: '1' }, { signed: ['p1'] });
  t.after(() => s.agent.stop());
  const { ok, refused } = await settled([
    s.rt.start(FK, 'p2', { prompt: 'not signed in', provider: 'mock' }),
    s.rt.start(FK, 'p2', { prompt: 'again', provider: 'mock' }),
  ]);
  assert.equal(ok.length, 0);
  assert.deepEqual(refused.map((e) => e.body.error).sort(), ['BUSY', 'SIGN_IN']);
  assert.equal(await s.rt.current(FK), null, 'no job was left behind');
  assert.deepEqual(jobDirs(s), [], 'no job folder was left behind');
  assert.equal((await s.rt.limits(FK, 'p2')).usedHour, 0, 'a refused start does not count');
  // the slot is free: p1 starts at once
  const j = await s.rt.start(FK, 'p1', { prompt: 'melons', provider: 'mock' });
  assert.equal((await s.rt.current(FK)).id, j.id);
  await until(s.rt, ['ready']);
});

test('"ask for changes" twice at once runs one round; an apply that arrives meanwhile is refused', async (t) => {
  const s = await setup();
  t.after(() => s.agent.stop());
  const job = await s.rt.start(FK, 'p1', { prompt: 'melons', provider: 'mock' });
  await until(s.rt, ['ready']);
  const { ok, refused } = await settled([
    s.rt.revise(FK, 'p1', job.id, { prompt: 'and a lantern' }),
    s.rt.revise(FK, 'p1', job.id, { prompt: 'and a lantern, please' }),
    s.rt.apply(FK, 'p1', job.id),
    s.rt.discard(FK, 'p2', job.id),
  ]);
  assert.equal(ok.length, 1, `${ok.length} actions went through on one ready job`);
  assert.equal(ok[0].round, 2);
  assert.ok(refused.every((e) => e.status === 409), refused.map((e) => `${e.status} ${e.body?.error}`).join());
  const cur = await s.rt.current(FK);
  assert.equal(cur.round, 2, 'one more round, not two');
  assert.equal(cur.prompts.length, 2);
  const back = await until(s.rt, ['ready']);
  assert.equal(back.round, 2);
  assert.equal(s.ctx.mods.f(FK).active, null, 'nothing was applied while the round ran');
});

test('"ask for changes" refused for sign-in hands the job back as it was', async (t) => {
  const s = await setup();
  t.after(() => s.agent.stop());
  const job = await s.rt.start(FK, 'p1', { prompt: 'melons', provider: 'mock' });
  await until(s.rt, ['ready']);
  await s.agent.providers.mock.signIn.signOut(s.agent.runtime.userOf(FK, 'p1'));
  await assert.rejects(s.rt.revise(FK, 'p1', job.id, { prompt: 'more' }), (e) => e.status === 428);
  const cur = await s.rt.current(FK);
  assert.equal(cur.state, 'ready');
  assert.equal(cur.round, 1);
  // and the farmer can still apply it
  const out = await s.rt.apply(FK, 'p1', job.id);
  assert.equal(out.active.n, 1);
});
