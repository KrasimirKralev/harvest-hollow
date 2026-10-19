// QA r1 H-03 (hv#3): "Rebuild on top" after a partner's undo silently brought the undone thing back. Farmer 1 applies a
// golden sky; farmer 2's change (Early Melon) waits ready on top of it; farmer 1 undoes the sky; farmer 2's Apply is
// STALE and "Rebuild on top" built a candidate that listed the melon AND "Sky: golden", reversing the partner's undo
// with no word about it. The job's work folder kept the old base's files; only the parent moved.
// GREEN: a rebuild (any revise after the farm moved) seeds mod/ from the farm's version as it is now and keeps only this
// job's own changes (a three-way merge: old base, the job's files, the new base).
// RED on 7f67efe: the rebuilt candidate's changes hold { family: 'look', id: 'sky' }.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnServer, writeSave, sleep } from './helpers/server.js';
import { merge3 } from '../server/agent/rebase.js';

test('H-03: a partner\'s undo of X during a job that never touched X leaves X out of the rebuilt candidate', { timeout: 120_000 }, async (t) => {
  const { dir, tokens } = writeSave({ level: 21, coins: 100_000 });
  const srv = spawnServer(dir, { HH_HARNESS_MOCK: '1', HH_MOCK_STEP_MS: '1', HH_CLAUDE_BIN: '/nonexistent/claude', HH_TELEMETRY: 'off',
    HH_HARNESS_JOBS_PER_HOUR: '50', HH_HARNESS_JOBS_PER_DAY: '50' });
  t.after(async () => { srv.child.kill('SIGTERM'); await srv.exit; });
  const port = await srv.port;
  const base = `http://127.0.0.1:${port}/api/harness`;
  const call = async (pid, method, p, body) => {
    const res = await fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${tokens[pid]}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const signIn = async (pid) => {
    const si = await call(pid, 'POST', '/providers/mock/signin', {});
    await fetch(`http://127.0.0.1:${port}${si.json.step.url}`);
  };
  const settle = async (pid, round = 1) => {
    for (let i = 0; i < 400; i++) {
      const job = (await call(pid, 'GET', '/jobs/current')).json.job;
      if (job && job.round === round && ['ready', 'failed', 'answered'].includes(job.state)) return job;
      await sleep(100);
    }
    throw new Error('the job never ended');
  };
  await signIn('p1');
  await signIn('p2');
  // farmer 1: the golden sky, applied
  const a = await call('p1', 'POST', '/jobs', { prompt: 'fixture:hs-12-golden-sky', provider: 'mock', lang: 'en' });
  assert.equal(a.status, 202, JSON.stringify(a.json));
  const ja = await settle('p1');
  assert.equal(ja.state, 'ready');
  assert.equal((await call('p1', 'POST', `/jobs/${ja.id}/apply`)).status, 200);
  // farmer 2: Early Melon, left ready on top of the sky
  const b = await call('p2', 'POST', '/jobs', { prompt: 'fixture:hs-17-watermelons-now', provider: 'mock', lang: 'en' });
  assert.equal(b.status, 202, JSON.stringify(b.json));
  const jb = await settle('p2');
  assert.equal(jb.state, 'ready');
  assert.ok(!jb.result.changes.some((c) => c.family === 'look'), 'the sky is the farm\'s already: not a change of this job');
  // farmer 1 undoes the sky
  assert.equal((await call('p1', 'POST', '/undo', {})).status, 200);
  // farmer 2: Apply is stale; "Rebuild on top"
  const stale = await call('p2', 'POST', `/jobs/${jb.id}/apply`);
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'STALE');
  const rb = await call('p2', 'POST', `/jobs/${jb.id}/revise`, { prompt: 'Please build the same changes again on top of the farm\'s newest version.' });
  assert.equal(rb.status, 202, JSON.stringify(rb.json));
  const j2 = await settle('p2', 2);
  assert.equal(j2.state, 'ready', `${j2.state} ${JSON.stringify(j2.error)}`);
  const rows = j2.result.changes.map((c) => `${c.op} ${c.family} ${c.id}`);
  assert.ok(rows.includes('add crops x_early_melon'), rows.join(' | '));
  assert.ok(!j2.result.changes.some((c) => c.family === 'look'), `the rebuilt candidate brings the sky back: ${rows.join(' | ')}`);
  assert.equal(j2.progress.filter((p) => p.code === 'fix').length, 0, 'no wasted fix round');
  // applied, the farm keeps the partner's undo
  const ok = await call('p2', 'POST', `/jobs/${j2.id}/apply`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const state = (await call('p2', 'GET', '/state')).json;
  assert.ok(!state.mod?.overlay?.look?.sky, 'no golden sky on the farm');
});

test('H-03: merge3 keeps the job\'s own changes and takes the farm\'s for everything the job never touched', () => {
  const base = { 'mod.json': { format: 1, title: { en: 'Golden Sky' } }, 'look.json': { sky: 'golden' }, 'text/letters.json': [{ t: 'a' }] };
  const ours = { 'mod.json': { format: 1, title: { en: 'Early Melons' } }, 'look.json': { sky: 'golden' },
    'content/crops/x_m.json': { id: 'x_m' }, 'text/letters.json': [{ t: 'a' }, { t: 'mine' }] };
  const theirs = { 'mod.json': { format: 1, title: { en: 'The Farm As It Was' } }, 'text/letters.json': [] };
  assert.deepEqual(merge3(base, ours, theirs), {
    'mod.json': { format: 1, title: { en: 'Early Melons' } },          // both changed: the wish being built wins
    'content/crops/x_m.json': { id: 'x_m' },                           // the job's own
    'text/letters.json': [{ t: 'mine' }],                             // the partner's removal stays, the job's letter too
  });
  // a knob inside one file: the job's tuning stays, the partner's music change stays
  assert.deepEqual(merge3({ sky: 'golden', music: 'a' }, { sky: 'golden', music: 'a', x: 1 }, { music: 'b' }), { music: 'b', x: 1 });
  // the job never changed anything: the farm as it is now
  assert.deepEqual(merge3(base, base, theirs), theirs);
});
