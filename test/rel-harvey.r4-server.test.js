// QA r4 (docs/qa/release/qa-r4/fix-harvey.md), the server half:
//   H4-03 (hv#2) a refused Ask over the request limit carries which cap it hit (the farm's shared day or the farmer's
//         hour), the cap and the wait: the client says "You can ask again at 21:40" instead of "a little later"
//   H4-04 (hv#3) "Bring back {title}" can take a thing out of the shop: History's undo plan says what leaves and what
//         comes back (the confirm names both), and the bring-back's push names what left (the toast says it)
//   H4-07 (hv#5) History offers "Go back to this" only where it can work: each version carries the server's word (`go`),
//         from the same compile the undo runs (a version with the active one's effect is NO_CHANGE)
// RED on 289b672: see docs/qa/release/qa-r4/fix-harvey.md (each item's RED line).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, testServer, writeSave } from './helpers/server.js';
import { createAgent } from '../server/agent/index.js';
import { stubCtx, tmpRoot, waitFor } from './helpers/agent-harness.js';
import { recipeOf, defOf } from '../shared/content/index.js';

const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'rel-harvey', 'owners-mod', 'mods');
const FK = 'local';

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
    else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}
const pushesOf = (s) => {
  const pushes = [];
  const broadcast = s.hh.sessions.broadcast.bind(s.hh.sessions);
  s.hh.sessions.broadcast = (msg) => { if (msg && msg.t === 'hx') pushes.push(msg); return broadcast(msg); };
  return pushes;
};
const ids = (list) => (Array.isArray(list) ? list.map((x) => x.id) : list);
const retired = (id) => Boolean((defOf(id) ?? recipeOf(id))?.retired);

// ---- H4-03 -----------------------------------------------------------------------------------------------------------
async function agentWith(env) {
  const h = stubCtx({ root: tmpRoot('r4-rate'), env: { HH_MOCK_STEP_MS: '20', ...env } });
  const agent = createAgent(h.ctx, { pushMs: 5 });
  for (const pid of ['p1', 'p2']) {
    const u = agent.runtime.userOf(FK, pid);
    await agent.providers.mock.signIn.start(u);
    await agent.providers.mock.signIn.continue(u, { code: 'ok' });
  }
  return { ...h, agent, rt: agent.runtime };
}
const ended = (rt) => waitFor(async () => { const j = await rt.current(FK); return j && j.state === 'ready' ? j : null; }, 8000, 'a ready job');

test('H4-03: the farm\'s day of wishes used up: the 429 says it is the farm\'s day, its size and the wait', async (t) => {
  const s = await agentWith({ HH_HARNESS_JOBS_PER_HOUR: '10', HH_HARNESS_JOBS_PER_DAY: '2' });
  t.after(() => s.agent.stop());
  for (const [pid, prompt] of [['p1', 'one'], ['p2', 'two']]) {
    await s.rt.start(FK, pid, { prompt, provider: 'mock' });
    const j = await ended(s.rt);
    await s.rt.discard(FK, j.by, j.id);
  }
  // the second farmer asked once: the cap she meets is the farm's, shared
  await assert.rejects(s.rt.start(FK, 'p2', { prompt: 'three', provider: 'mock' }), (e) => {
    assert.equal(e.status, 429);
    assert.equal(e.body.error, 'RATE');
    assert.equal(e.body.limit, 'day', JSON.stringify(e.body));
    assert.equal(e.body.max, 2);
    assert.ok(Number.isInteger(e.body.retryAfter) && e.body.retryAfter > 86_000 && e.body.retryAfter <= 86_400, `wait ${e.body.retryAfter} s`);
    return true;
  });
});

test('H4-03: one farmer\'s hour used up: the 429 says it is the hour', async (t) => {
  const s = await agentWith({ HH_HARNESS_JOBS_PER_HOUR: '1', HH_HARNESS_JOBS_PER_DAY: '30' });
  t.after(() => s.agent.stop());
  await s.rt.start(FK, 'p1', { prompt: 'one', provider: 'mock' });
  const j = await ended(s.rt);
  await s.rt.discard(FK, j.by, j.id);
  await assert.rejects(s.rt.start(FK, 'p1', { prompt: 'two', provider: 'mock' }), (e) => {
    assert.equal(e.body.limit, 'hour', JSON.stringify(e.body));
    assert.equal(e.body.max, 1);
    assert.ok(e.body.retryAfter > 3500 && e.body.retryAfter <= 3600, `wait ${e.body.retryAfter} s`);
    return true;
  });
  // the other farmer's hour is her own
  await s.rt.start(FK, 'p2', { prompt: 'three', provider: 'mock' });
});

// ---- H4-04, H4-07 ----------------------------------------------------------------------------------------------------
test('H4-04 + H4-07: on the M24 mod, History says what each go-back and the bring-back would move; the bring-back push names what left', { timeout: 60_000 }, async () => {
  const { dir } = writeSave({ level: 21 });
  copyDir(FIXTURE, path.join(dir, 'harness', 'mods'));
  const s = await testServer({ dataDir: dir });
  try {
    const mods = s.hh.harness.ctx.mods;
    const pushes = pushesOf(s);
    // the boot rebuilt version 2 for this game (version 3): version 2 has the farm's own effect, version 1 has no lantern
    const h0 = mods.history(FK);
    const row = (h, n) => h.versions.find((v) => v.n === n);
    assert.equal(h0.active, 3);
    assert.deepEqual(row(h0, 2).go, { ok: false, code: 'NO_CHANGE' }, 'version 2 is what the farm has now: no "Go back to this"');
    assert.equal(row(h0, 1).go.ok, true);
    assert.deepEqual(ids(row(h0, 1).go.left), ['x_caramel_lantern'], 'going back to version 1 takes the Caramel Lantern out of the shop');
    assert.deepEqual(ids(row(h0, 1).go.back), []);
    assert.equal(row(h0, 3).go, undefined, 'the active version has no word');
    // the tester's four presses (hv#3): History › "Go back to this" on version 1 (the lantern leaves), then on version 2
    // (it comes back: an undo that only adds)
    await mods.undo(FK, { by: 'p1', to: 1 });
    assert.equal(retired('x_caramel_lantern'), true);
    const h1 = mods.history(FK);
    assert.equal(row(h1, 1).go.code, 'NO_CHANGE', 'version 1 is now the farm\'s effect');
    for (const n of [2, 3]) {
      assert.deepEqual(ids(row(h1, n).go.back), ['x_caramel_lantern'], `version ${n} would bring the lantern back`);
      assert.deepEqual(ids(row(h1, n).go.left), []);
    }
    await mods.undo(FK, { by: 'p1', to: 2 });
    assert.equal(retired('x_caramel_lantern'), false);
    const back = mods.history(FK).versions[0];
    assert.equal(back.kind, 'undo');
    assert.ok(back.changes.length && back.changes.every((c) => c.op !== 'retire'), 'it only brought things back (History badges it "Went back")');
    // the top button is now "Bring back Sweet Autumn" (the undo of an undo): it takes the lantern away again, and says so
    const h2 = mods.history(FK);
    assert.equal(h2.undo.revive, true, JSON.stringify(h2.undo));
    assert.deepEqual(ids(h2.undo.left), ['x_caramel_lantern'], 'the bring-back plan names what leaves');
    assert.deepEqual(ids(h2.undo.back), []);
    await mods.undo(FK, { by: 'p1' });
    assert.equal(retired('x_caramel_lantern'), true, 'the bring-back did take the lantern out of the shop');
    const push = pushes.filter((m) => m.e === 'undone').at(-1);
    assert.equal(push.revive, true);
    assert.deepEqual(ids(push.names), ['x_caramel_lantern'], 'the push names what left (the toast says it)');
    assert.equal(push.names[0].bgDef, 'карамеленият фенер');
    // a damaged version says so too (H4-07's sibling): its stored file torn, it cannot come back
    const f = path.join(dir, 'harness', 'mods', 'versions', '2', 'files', 'content', 'recipes', 'x_caramel_apples.json');
    fs.writeFileSync(f, fs.readFileSync(f).subarray(0, 40));
    const h3 = mods.history(FK);
    assert.deepEqual(row(h3, 2).go, { ok: false, code: 'DAMAGED' });
    // what History offers is what the undo does: a row it says is NO_CHANGE is refused NO_CHANGE
    const same = h3.versions.find((x) => x.go?.code === 'NO_CHANGE');
    assert.ok(same, 'a version with the farm\'s own effect');
    await assert.rejects(mods.undo(FK, { by: 'p1', to: same.n }), (e) => e.code === 'NO_CHANGE');
  } finally {
    await s.close();
  }
});
