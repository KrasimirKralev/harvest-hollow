// QA r1, the server half of two harvey items:
//   H-07 (hv#7) a wish for something Harvey already added: nothing changed, and the agent's summary (no `possible`) said
//        "Moon Melons grow in summer … Mabel wrote you a letter" beside "Nothing on your farm changed". An unchanged round
//        keeps the agent's words only when they say `"possible": false`; otherwise the plain "found nothing" answer.
//   H-14 (hv#15) the 1.0 boot's rebuild of a stored mod was committed as kind 'apply' by the old farmer, so History showed
//        it as a change made today. It is kind 'rebuild', by nobody, and names what it left out.
// RED on 7f67efe: H-07 answered with the claim; H-14 kind 'apply', by 'p1', no leftOut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createAgent } from '../server/agent/index.js';
import { stubCtx, tmpRoot, waitFor } from './helpers/agent-harness.js';
import { ROOT, tmpDataDir } from './helpers/server.js';
import { ModStore } from '../server/mods/store.js';
import { loadActive } from '../server/mods/hot.js';
import { recompileFor } from '../server/mods/index.js';

const FK = 'local';

test('H-07: the same wish again (nothing to change) never shows the agent\'s claim that something changed', async (t) => {
  const root = tmpRoot('rh-h07');
  const h = stubCtx({ root });
  const agent = createAgent(h.ctx, { pushMs: 5 });
  t.after(() => agent.stop());
  const user = agent.runtime.userOf(FK, 'p1');
  await agent.providers.mock.signIn.start(user);
  await agent.providers.mock.signIn.continue(user, { code: 'ok' });
  const rt = agent.runtime;
  const until = (states) => waitFor(async () => { const j = await rt.current(FK); return j && states.includes(j.state) ? j : null; }, 8000, states.join('|'));
  const a = await rt.start(FK, 'p1', { prompt: 'melons', provider: 'mock', lang: 'en' });
  const ready = await until(['ready']);
  assert.equal(ready.id, a.id);
  await rt.apply(FK, 'p1', a.id);
  // the Moon Melon is live; the same kind of wish writes the same files: nothing changes
  await rt.start(FK, 'p1', { prompt: 'Moon melons please', provider: 'mock', lang: 'en' });
  const j = await until(['answered', 'ready', 'failed']);
  assert.equal(j.state, 'answered', `${j.state} ${JSON.stringify(j.error)}`);
  assert.equal(j.result.candidate, null);
  assert.equal(j.result.summary, null, `the claim stays out: ${JSON.stringify(j.result.summary)}`);
});

const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'rel-harvey', 'owners-mod', 'mods');
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
    else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}

test('H-14: the 1.0 rebuild of a stored version is kind "rebuild", by nobody, and lists what it left out', () => {
  const dir = path.join(tmpDataDir('rh-h14'), 'harness');
  copyDir(FIXTURE, path.join(dir, 'mods'));
  const s = new ModStore(dir);
  const quiet = { info() {}, warn() {}, error() {}, log() {} };
  const r = loadActive(s, { log: quiet, recompile: recompileFor(ROOT) });
  assert.equal(r.suspended, false);
  const m = s.meta(3);
  assert.equal(m.kind, 'rebuild');
  assert.equal(m.by, null, 'nobody asked for it today');
  assert.deepEqual(m.leftOut, ['palette', 'tips']);
  assert.equal(s.active().by, null);
  const v = s.history().versions.find((x) => x.n === 3);
  assert.equal(v.kind, 'rebuild');
  assert.deepEqual(v.leftOut, ['palette', 'tips']);
  assert.equal(s.history().versions.find((x) => x.n === 2).kind, 'apply', 'the farmer\'s own version keeps its kind');
});
