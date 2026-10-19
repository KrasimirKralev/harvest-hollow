// QA r2 (docs/qa/release/qa-r2/fix-harvey.md), the server half:
//   H2-01 (hv#1) after a game update the boot rebuilds the farm's mod as a new version (kind 'rebuild') whose parent is
//         the old active one: "Undo the last change" went back to that parent, which holds the same files. Nothing
//         changed, yet a version was committed and the farmer was told a change was undone. Rebuilt and paused versions
//         are see-through for undo ("the last change" is the farmer's own), and an undo that would change nothing is
//         refused NO_CHANGE without a version.
//   H2-02 (hv#2) the paused (suspended) version kept the old farmer and the old wish in its meta, so History said
//         "<farmer> · Asked: …" for a pause nobody asked for; and an undo to a version with a damaged file was refused
//         with the job's "did not pass the tests" (INVALID). It is by nobody, has no wish, carries its reason, and the
//         refusal is DAMAGED.
//   H2-07 (hv#11) discarded candidates take version numbers: History numbers what it shows (`no`), in order.
//   sibling of H2-01: the rebuilt and the paused versions had no icons on disk (only `apply` and `undo` rendered them),
//         so every mod thing's icon answered 404 after a game update.
// RED on 5bbfbca: see docs/qa/release/qa-r2/fix-harvey.md (each item's RED line).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, testServer, writeSave, tmpDataDir } from './helpers/server.js';
import { ModStore } from '../server/mods/store.js';
import { loadActive } from '../server/mods/hot.js';
import { recompileFor } from '../server/mods/index.js';
import { defOf, recipeOf } from '../shared/content/index.js';

const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'rel-harvey', 'owners-mod', 'mods');
const quiet = { info() {}, warn() {}, error() {}, log() {} };

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
    else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}

/** A save at level 21 with the M24 fixture's two stored versions (compiled for an older game: the boot rebuilds). */
function savedWithMod({ damage = false } = {}) {
  const { dir, tokens } = writeSave({ level: 21 });
  copyDir(FIXTURE, path.join(dir, 'harness', 'mods'));
  if (damage) {
    // the repro of H2-02: a torn stored file of version 2
    const f = path.join(dir, 'harness', 'mods', 'versions', '2', 'files', 'content', 'recipes', 'x_caramel_apples.json');
    fs.writeFileSync(f, fs.readFileSync(f).subarray(0, 40));
  }
  return { dir, tokens };
}

const pushesOf = (s) => {
  const pushes = [];
  const broadcast = s.hh.sessions.broadcast.bind(s.hh.sessions);
  s.hh.sessions.broadcast = (msg) => { if (msg && msg.t === 'hx') pushes.push(msg); return broadcast(msg); };
  return pushes;
};

test('H2-01: after the rebuild, "Undo the last change" undoes the farmer\'s last change: the lantern leaves and the push names it', { timeout: 60_000 }, async () => {
  const { dir } = savedWithMod();
  const s = await testServer({ dataDir: dir });
  try {
    const mods = s.hh.harness.ctx.mods;
    assert.equal(mods.active('local').kind, 'rebuild', 'the boot rebuilt the stored version');
    assert.ok(defOf('x_caramel_lantern') && !defOf('x_caramel_lantern').retired, 'the lantern is for sale before the undo');
    const pushes = pushesOf(s);
    const out = await mods.undo('local', { by: 'p1' });
    assert.equal(out.kind, 'undo');
    assert.equal(defOf('x_caramel_lantern')?.retired, true, 'the last change (the lantern) left the shop');
    assert.ok(recipeOf('x_caramel_apples') && !recipeOf('x_caramel_apples').retired, 'the change before it (Caramel Apples) stays');
    const undone = pushes.filter((m) => m.e === 'undone').at(-1);
    assert.deepEqual(undone.names.map((x) => x.id), ['x_caramel_lantern'], 'the toast names what left');
    assert.equal(undone.to, 1, 'back to version 1, the one before the farmer\'s last change');
    const hist = mods.history('local');
    assert.equal(hist.versions[0].undoTo, 1);
    // and History's next offer is "Bring back" the change that really left
    assert.equal(hist.versions[0].parent, 3);
  } finally {
    await s.close();
  }
});

test('H2-01: an undo that would change nothing is refused NO_CHANGE and commits no version', { timeout: 60_000 }, async () => {
  const { dir, tokens } = savedWithMod();
  const s = await testServer({ dataDir: dir });
  try {
    const mods = s.hh.harness.ctx.mods;
    const store = mods.store('local');
    const before = store.versions();
    // version 3 is version 2 rebuilt: going back to 2 changes nothing on the farm
    await assert.rejects(mods.undo('local', { by: 'p1', to: 2 }), (err) => err.code === 'NO_CHANGE' && err.status === 409);
    assert.deepEqual(store.versions(), before, 'no version was committed');
    assert.equal(mods.active('local').n, 3);
    // the route says it in the same words
    const res = await fetch(`http://127.0.0.1:${s.port}/api/harness/undo`, { method: 'POST',
      headers: { Authorization: `Bearer ${tokens.p1}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 2 }) });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'NO_CHANGE' });
  } finally {
    await s.close();
  }
});

test('H2-01: a rebuilt undo is see-through too: "the last change" of a rebuilt undo version brings back what it undid', () => {
  // v1 apply, v2 apply, v3 undo (back to v1), then a game update: v4 rebuild of v3. Undo the last change = the undo of v3
  // (back to v2: a bring-back), never v4's parent v3 (the same files).
  const dir = path.join(tmpDataDir('rh-r2-see'), 'harness');
  copyDir(FIXTURE, path.join(dir, 'mods'));
  const s = new ModStore(dir);
  const m = s.meta(2);
  // hand-made v3: an undo of v2 back to v1, as the server writes it
  fs.cpSync(s.vdir(1), s.vdir(3), { recursive: true });
  fs.writeFileSync(path.join(s.vdir(3), 'meta.json'), JSON.stringify({ ...s.meta(1), n: 3, kind: 'undo', parent: 2, undoTo: 1, by: 'p1', prompt: null, title: { en: 'Sweet Autumn' } }));
  s.commit(3, { by: 'p1', kind: 'undo', at: m.at + 1000 });
  const r = loadActive(s, { log: quiet, recompile: recompileFor(ROOT) });
  assert.equal(r.suspended, false);
  assert.equal(s.meta(4).kind, 'rebuild');
  const { undoTarget } = s;
  assert.equal(typeof undoTarget, 'function', 'the store says where "Undo the last change" goes');
  assert.deepEqual(undoTarget.call(s, 4), { to: 2, last: 3, revive: true });
});

test('H2-02: a paused version is by nobody, asks nothing, and says why; an undo to a damaged version is refused DAMAGED', { timeout: 60_000 }, async () => {
  const { dir, tokens } = savedWithMod({ damage: true });
  const s = await testServer({ dataDir: dir });
  try {
    const mods = s.hh.harness.ctx.mods;
    const a = mods.active('local');
    assert.equal(a.suspended, true);
    const store = mods.store('local');
    const m = store.meta(a.n);
    assert.equal(m.kind, 'suspend');
    assert.equal(m.by, null, 'nobody paused it');
    assert.equal(m.prompt ?? null, null, 'no wish');
    assert.equal(m.prompts ?? null, null, 'no wishes');
    assert.equal(m.reason, 'BAD_JSON', 'the reason: a file that does not read');
    const row = mods.history('local').versions[0];
    assert.equal(row.kind, 'suspend');
    assert.equal(row.by, null);
    assert.equal(row.prompt, null);
    assert.equal(row.reason, 'BAD_JSON');
    // going back to the damaged version: its own code, never the job's INVALID
    const res = await fetch(`http://127.0.0.1:${s.port}/api/harness/undo`, { method: 'POST',
      headers: { Authorization: `Bearer ${tokens.p1}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 2 }) });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'DAMAGED' });
    // "Undo the last change" sees through the pause: back to version 1 (whose files read), the lantern is gone
    const out = await mods.undo('local', { by: 'p1' });
    assert.equal(out.suspended, false);
    assert.equal(mods.history('local').versions[0].undoTo, 1);
    assert.ok(recipeOf('x_caramel_apples') && !recipeOf('x_caramel_apples').retired, 'version 1 is live again');
  } finally {
    await s.close();
  }
});

test('H2-07: History numbers what it shows in order; a discarded candidate takes no number', () => {
  const dir = path.join(tmpDataDir('rh-r2-no'), 'harness');
  copyDir(FIXTURE, path.join(dir, 'mods'));
  const s = new ModStore(dir);
  // six discarded candidates between the two applied versions would have made them "Version 1" and "Version 8"
  for (const n of [3, 4, 5, 6, 7, 8]) {
    fs.cpSync(s.vdir(2), s.vdir(n), { recursive: true });
    fs.writeFileSync(path.join(s.vdir(n), 'meta.json'), JSON.stringify({ ...s.meta(2), n, kind: 'candidate' }));
  }
  for (const n of [3, 4, 5, 6, 7]) s.dropCandidate(n);
  fs.writeFileSync(path.join(s.vdir(8), 'meta.json'), JSON.stringify({ ...s.meta(2), n: 8, kind: 'candidate', parent: 2 }));
  s.commit(8, { by: 'p2', kind: 'apply', at: 1791660000000 });
  const h = s.history();
  assert.deepEqual(h.versions.map((v) => [v.n, v.no]), [[8, 3], [2, 2], [1, 1]]);
});

test('H2-01 sibling: the rebuilt version has its things\' icons on disk (the icon route answers, not 404)', { timeout: 60_000 }, async () => {
  const { dir } = savedWithMod();
  const s0 = new ModStore(path.join(dir, 'harness'));
  const want = Object.keys(s0.overlay(2).look?.icons ?? {});
  assert.ok(want.length >= 1, 'the stored version has icon recipes');
  const s = await testServer({ dataDir: dir });
  try {
    const a = s.hh.harness.ctx.mods.active('local');
    assert.equal(a.kind, 'rebuild');
    for (const id of want) {
      const res = await fetch(`http://127.0.0.1:${s.port}/mods/${a.hash}/icons/128/${id}.png`);
      assert.equal(res.status, 200, `${id}: the rebuilt version's icon`);
      assert.equal(res.headers.get('content-type'), 'image/png');
    }
  } finally {
    await s.close();
  }
});

test('H2-02 sibling: the paused version keeps its things\' icons (retired things still sit in barns and on the farm)', { timeout: 60_000 }, async () => {
  const { dir } = savedWithMod({ damage: true });
  const s = await testServer({ dataDir: dir });
  try {
    const mods = s.hh.harness.ctx.mods;
    const a = mods.active('local');
    assert.equal(a.suspended, true);
    const ov = mods.store('local').overlay(a.n);
    const ids = Object.keys(ov.look?.icons ?? {});
    assert.ok(ids.length >= 1);
    for (const id of ids) {
      const res = await fetch(`http://127.0.0.1:${s.port}/mods/${a.hash}/icons/128/${id}.png`);
      assert.equal(res.status, 200, `${id}: the paused version's icon`);
    }
  } finally {
    await s.close();
  }
});

test('H2-03: the applied push names each thing with its level, so the client offers "Show me" only for what the farm can use', { timeout: 60_000 }, async () => {
  const { dir } = writeSave({ level: 21 });
  const s = await testServer({ dataDir: dir });
  try {
    const mods = s.hh.harness.ctx.mods;
    const pushes = pushesOf(s);
    const files = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'agent', 'providers', 'mock-fixtures', 'hs-16-llama.json'), 'utf8')).files;
    const staged = await mods.stage('local', files, { by: 'p1', prompt: 'Add a llama' });
    await mods.apply('local', staged.candidate, { by: 'p1' });
    const applied = pushes.filter((m) => m.e === 'applied').at(-1);
    const llama = applied.names.find((x) => x.id === 'x_llama');
    assert.ok(llama, JSON.stringify(applied.names));
    assert.ok(Number.isInteger(llama.unlock) && llama.unlock > 21, `the llama's level: ${llama.unlock}`);
  } finally {
    await s.close();
  }
});
