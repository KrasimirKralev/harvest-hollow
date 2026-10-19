// QA r1 H-01 (hv#1): a stored mod with one unreadable file must never stop the farm from starting. The designed outcome
// of a failed recompile after a game update is "the mod is suspended, the farm plays" (server/mods/hot.js, scope §9
// risk 2); the 1.0 deploy is exactly such an update (overlay.base !== CONTENT_HASH).
// RED on 7f67efe: `store.files()` mapped the truncated file to null, `recompileFor` called compileMod outside its try,
// compileMod read `s.id` on the null spec and the throw reached server start ("Harness Hollow failed to start").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, testServer, tmpDataDir, writeSave, wsClient } from './helpers/server.js';
import { ModStore } from '../server/mods/store.js';
import { loadActive } from '../server/mods/hot.js';
import { recompileFor } from '../server/mods/index.js';
import { CONTENT_HASH } from '../shared/content/index.js';
import { validateState } from '../shared/rules/state.js';
import { PROTOCOL_VERSION } from '../shared/net/protocol.js';

const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'rel-harvey', 'owners-mod', 'mods');
const BAD = path.join('versions', '2', 'files', 'content', 'recipes', 'x_caramel_apples.json');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
    else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}

/** A harness dir holding the stored versions with version 2's recipe cut off mid-file (a torn write, a bad disk). */
function badHarness(dir = path.join(tmpDataDir('rh-h01'), 'harness')) {
  copyDir(FIXTURE, path.join(dir, 'mods'));
  fs.writeFileSync(path.join(dir, 'mods', BAD), '{ "id": "x_caramel_apples", "like": ');
  return dir;
}

function capture() {
  const lines = [];
  const rec = (level) => (msg, data) => lines.push({ level, msg, data });
  return { lines, info: rec('info'), warn: rec('warn'), error: rec('error'), log: rec('info') };
}

test('H-01: the store reports an unreadable file as BAD_JSON, never as a null file', () => {
  const s = new ModStore(badHarness());
  const r = s.readFiles(2);
  assert.equal(Object.hasOwn(r.files, 'content/recipes/x_caramel_apples.json'), false, 'no null spec reaches a compile');
  assert.ok(Object.values(r.files).every((v) => v !== null && v !== undefined));
  assert.deepEqual(r.problems.map((p) => [p.code, p.file]), [['BAD_JSON', 'content/recipes/x_caramel_apples.json']]);
  assert.ok(Object.values(s.files(2)).every((v) => v !== null), 'files() never hands out a null either');
  assert.deepEqual(s.readFiles(1).problems, [], 'the other version reads clean');
});

test('H-01: loadActive suspends a stored version with an unreadable file instead of throwing', () => {
  const s = new ModStore(badHarness());
  const log = capture();
  let r;
  assert.doesNotThrow(() => { r = loadActive(s, { log, recompile: recompileFor(ROOT) }); });
  assert.equal(r.suspended, true);
  assert.equal(r.overlay.base, CONTENT_HASH);
  assert.equal(s.active().n, 3, 'the suspended overlay is stored as a new version');
  assert.equal(s.meta(3).kind, 'suspend');
  assert.ok(log.lines.some((l) => l.level === 'warn'), 'the log says why');
  // a recompile that throws for any other reason suspends too (never reaches server start)
  const s2 = new ModStore(badHarness());
  const r2 = loadActive(s2, { log: capture(), recompile: () => { throw new Error('boom'); } });
  assert.equal(r2.suspended, true);
});

test('H-01: recompileFor answers ok:false for files that cannot compile, never throws', () => {
  const re = recompileFor(ROOT);
  let r;
  assert.doesNotThrow(() => { r = re({ 'mod.json': { format: 1, title: { en: 'X', bg: 'Х' } }, 'content/recipes/x_a.json': null }, null, 1); });
  assert.equal(r.ok, false);
});

test('H-01: the server starts on such a farm, the mod is suspended and the farm plays; undo to the bad version is refused cleanly',
  { timeout: 60_000 }, async () => {
    const dir = tmpDataDir('rh-h01-srv');
    const { tokens } = writeSave({ dir, level: 21 });
    badHarness(path.join(dir, 'harness'));
    const tz = JSON.parse(fs.readFileSync(path.join(dir, 'farm.json'), 'utf8')).state.meta.tz;
    const s = await testServer({ dataDir: dir, tz });
    try {
      const mods = s.hh.harness.ctx.mods;
      assert.equal(mods.active('local').suspended, true);
      assert.deepEqual(validateState(s.hh.engine.state), []);
      // the farm plays: a farmer comes back and gets a welcome that carries the paused mod
      const c = await wsClient(s.port);
      c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'h01cid', token: tokens.p1 });
      const w = await c.next((m) => m.t === 'welcome' || m.t === 'deny');
      assert.equal(w.t, 'welcome', JSON.stringify(w).slice(0, 200));
      assert.equal(w.mod?.overlay?.suspended, true);
      c.close();
      // undo to the version with the unreadable file: a clean 409 with the problem, not a crash (QA r2 H2-02: its own
      // code, DAMAGED, so the farmer reads "a damaged file", not the job's "did not pass the tests")
      await assert.rejects(mods.undo('local', { by: 'p1', to: 2 }), (e) => e.code === 'DAMAGED' && e.status === 409
        && e.problems.some((p) => p.code === 'BAD_JSON'));
      // undo to the clean version works
      const a = await mods.undo('local', { by: 'p1', to: 1 });
      assert.equal(a.suspended, false);
    } finally {
      await s.close();
    }
  });
