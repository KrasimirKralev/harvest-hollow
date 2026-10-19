// Release 1.0, H9 (critique#21; plan-astra 1.9): the honesty set (docs/harvey-honesty-set.md) through the scripted-fixture
// mock and the REAL validator on a level-21 farm, in English and in Bulgarian: the 9 impossible wishes and the 2 already
// in the game end `answered` in one round with a kind reason and something to try; the 2 placebo colour and tips
// wishes have their knob refused (UNSUPPORTED), taken out, and end `answered`; the golden sky is a real change (G13);
// the 2 wishes above the farm's level are built and say when ("level 33", "level 27"); none ends `failed INVALID`; the
// Bulgarian summaries speak to one player (ти). The pass bar for the lead's live run is the same document's.
// RED on fdafb9c: a wish that builds nothing ran 3 rounds and failed INVALID; a palette or tips mod "applied".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { spawnServer, writeSave, sleep } from './helpers/server.js';
import { FIXTURES } from '../server/agent/providers/mock.js';

const SET = fs.readdirSync(FIXTURES).filter((f) => /^hs-\d\d-/.test(f)).sort()
  .map((f) => ({ name: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8')) }));
const DOC = fs.readFileSync(path.join(ROOT, 'docs', 'harvey-honesty-set.md'), 'utf8');
/** The polite or plural "you" (вие) a UI line to one player must not use (glossary rule 5). */
const PLURAL = /(?<![а-яё])(можете|искате|имате|вие|вашата|вашия|вашите|вашето|посадите|добавите)(?![а-яё])/i;

test('H9: the set is harvey.md\'s 17: 9 impossible, 4 placebo, 2 already in the game, 2 above the level; the doc lists each', () => {
  const groups = SET.reduce((a, f) => ({ ...a, [f.group]: (a[f.group] ?? 0) + 1 }), {});
  assert.deepEqual(groups, { impossible: 9, placebo: 4, already: 2, later: 2 });
  for (const f of SET) {
    assert.ok(DOC.includes(f.wish.en), `the doc has "${f.wish.en}"`);
    assert.ok(DOC.includes(f.wish.bg), `the doc has "${f.wish.bg}"`);
    assert.doesNotMatch(f.summary.bg, PLURAL, `${f.name}: ти, not вие`);
    if (f.expect === 'answered') assert.ok(f.summary.possible === false && f.summary.try?.length, `${f.name}: a reason and something to try`);
  }
  assert.match(DOC, /at least 15 of 17/);
});

test('H9: every wish of the set reaches its honest outcome through the real validator (EN and BG)', { timeout: 300_000 }, async (t) => {
  const { dir, tokens } = writeSave({ level: 21, coins: 100_000 });
  const srv = spawnServer(dir, { HH_HARNESS_MOCK: '1', HH_MOCK_STEP_MS: '1', HH_CLAUDE_BIN: '/nonexistent/claude', HH_TELEMETRY: 'off',
    HH_HARNESS_JOBS_PER_HOUR: '100', HH_HARNESS_JOBS_PER_DAY: '100' });
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
  const results = [];
  for (const lang of ['en', 'bg']) {
    for (const f of SET) {
      const s = await call('POST', '/jobs', { prompt: `${f.wish[lang]} fixture:${f.name}`, provider: 'mock', lang });
      assert.equal(s.status, 202, `${f.name}: ${JSON.stringify(s.json)}`);
      let job = null;
      for (let i = 0; i < 300; i++) {
        job = (await call('GET', '/jobs/current')).json.job;
        if (['ready', 'failed', 'answered'].includes(job.state)) break;
        await sleep(50);
      }
      const row = { name: f.name, lang, state: job.state, rounds: job.round + (job.progress.filter((p) => p.code === 'fix').length) };
      results.push(row);
      assert.notEqual(job.state, 'failed', `${f.name} ${lang} failed: ${JSON.stringify(job.error)} ${JSON.stringify(job.result?.validation?.errors)}`);
      assert.equal(job.state, f.expect, `${f.name} ${lang}: ${job.state}`);
      assert.equal(job.round, 1, 'one round');
      assert.ok(!job.progress.some((p) => p.code === 'fix'), `${f.name}: no fix round`);
      assert.equal(job.result.summary[lang], f.summary[lang]);
      if (f.expect === 'answered') assert.equal(job.result.candidate, null);
      if (f.group === 'later') {
        // built, and honest about when: the change list says the level, the summary names it
        assert.match(f.summary.en, /level (33|27)/);
        assert.ok(f.name !== 'hs-16-llama' || job.result.changes.some((c) => c.id === 'x_llama' && c.numbers.unlock === 33), 'the llama row says 33');
      }
      if (f.name === 'hs-12-golden-sky') assert.ok(job.result.changes.some((c) => c.family === 'look' && c.sky === 'golden'));
      // the slot is free for the next wish
      if (job.state === 'ready') assert.equal((await call('POST', `/jobs/${job.id}/discard`)).status, 200);
    }
  }
  assert.equal(results.length, 34);
  assert.deepEqual(await call('GET', '/history').then((r) => r.json.versions), [], 'nothing was applied');
});
