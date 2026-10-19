// Release 1.0, M24 (critique#1): the owners' Harvey mod survives 1.0. The Farmbox farm has no mods/ (the lead, 2026-10-13),
// so the stored versions are synthetic, written by HEAD fdafb9c's own code (.scratch/rb-harvey/gen/make-owners-mod.mjs
// on the HEAD tree): v1 "Sweet Autumn" (Caramel Apples, look.palette, text.tips, a golden sky), v2 on top (a lantern,
// the barn colour, a letter, two tips). On this build: the active version recompiles, not suspended, with the removed
// knobs left out and a warning; undo and "Bring back" to every stored version compile; the farm boots again.
// RED on fdafb9c: the stored overlay kept look.palette and text.tips (nothing was ever left out), so H2's removal would
// have turned every such version into a compile failure and a suspended mod.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, testServer, tmpDataDir, writeSave } from './helpers/server.js';
import { ModStore } from '../server/mods/store.js';
import { loadActive } from '../server/mods/hot.js';
import { recompileFor } from '../server/mods/index.js';
import { CONTENT_HASH } from '../shared/content/index.js';
import { validateState } from '../shared/rules/state.js';

const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'rel-harvey', 'owners-mod', 'mods');
const SAVE = path.join(ROOT, '.scratch', 'box-save-1013');
const haveSave = fs.existsSync(path.join(SAVE, 'farm.json'));

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
    else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}

/** A harness dir holding a copy of the stored versions. */
function harnessCopy() {
  const dir = path.join(tmpDataDir('rh-m24'), 'harness');
  copyDir(FIXTURE, path.join(dir, 'mods'));
  return dir;
}

function capture() {
  const lines = [];
  const rec = (level) => (msg, data) => lines.push({ level, msg, data });
  return { lines, info: rec('info'), warn: rec('warn'), error: rec('error'), log: rec('info') };
}

test('M24: the fixture is a version stored before 1.0: it uses look.palette, text.tips and "Caramel Apples"', () => {
  const s = new ModStore(harnessCopy());
  assert.deepEqual(s.versions(), [1, 2]);
  assert.equal(s.active().n, 2);
  const f = s.files(2);
  assert.ok(f['look.json'].palette.barn);
  assert.equal(f['text/tips.json'].length, 2);
  assert.equal(f['content/recipes/x_caramel_apples.json'].text.en.name, 'Caramel Apples');
  assert.notEqual(s.overlay(2).base, CONTENT_HASH, 'compiled for another game version: the boot recompiles it');
});

test('M24: loadActive recompiles it, not suspended; the palette and the tips are left out with a warning', () => {
  const s = new ModStore(harnessCopy());
  const log = capture();
  const r = loadActive(s, { log, recompile: recompileFor(ROOT) });
  assert.equal(r.suspended, false, JSON.stringify(log.lines));
  assert.equal(r.overlay.base, CONTENT_HASH);
  assert.ok(r.overlay.defs.recipes.some((d) => d.id === 'x_caramel_apples'), 'Caramel Apples are still for sale');
  assert.ok(r.overlay.defs.decor.some((d) => d.id === 'x_caramel_lantern'));
  assert.equal(r.overlay.look.sky, 'golden', 'what still works stays');
  assert.equal(r.overlay.text.letters.length, 1);
  assert.equal(r.overlay.look.palette, undefined, 'the palette is left out');
  assert.deepEqual(r.overlay.text.tips, [], 'the tips are left out');
  const warned = log.lines.filter((l) => l.level === 'warn').map((l) => `${l.data?.file}:${l.data?.path}`).sort();
  assert.deepEqual(warned, ['look.json:palette', 'text/tips.json:']);
  // the stored files are untouched: an older build could still read them
  assert.ok(s.files(2)['look.json'].palette);
  assert.equal(s.active().n, 3, 'the rebuilt overlay is a new version');
});

test('M24: undo and "Bring back" to every stored version compile; the farm boots again unsuspended', { timeout: 120_000 }, async () => {
  const dir = tmpDataDir('rh-m24-srv');
  let owners = false;
  if (haveSave) {
    // the owners' save, a copy (sha256 of the original checked unchanged at the end)
    for (const f of fs.readdirSync(SAVE)) if (fs.statSync(path.join(SAVE, f)).isFile()) fs.copyFileSync(path.join(SAVE, f), path.join(dir, f));
    owners = true;
  } else writeSave({ dir, level: 21 });
  const sum = haveSave ? crypto.createHash('sha256').update(fs.readFileSync(path.join(SAVE, 'farm.json'))).digest('hex') : null;
  copyDir(FIXTURE, path.join(dir, 'harness', 'mods'));
  const tz = JSON.parse(fs.readFileSync(path.join(dir, 'farm.json'), 'utf8')).state.meta.tz;
  let s = await testServer({ dataDir: dir, keep: true, tz });
  try {
    const mods = s.hh.harness.ctx.mods;
    const a = mods.active('local');
    assert.equal(a.suspended, false, 'the owners\' mod runs on 1.0');
    assert.deepEqual(validateState(s.hh.engine.state), []);
    // every stored version, the game as it was, and back to the newest
    for (const to of [1, 2, 0, 3]) {
      const out = await mods.undo('local', { by: 'p1', to });
      assert.equal(out.suspended, false, `undo to ${to}`);
      assert.deepEqual(validateState(s.hh.engine.state), [], `the farm after undo to ${to}`);
    }
    // the plain "Undo the last change"
    const last = await mods.undo('local', { by: 'p1' });
    assert.equal(last.suspended, false);
    await s.close();
    s = await testServer({ dataDir: dir, keep: true, tz });
    assert.equal(s.hh.harness.ctx.mods.active('local').suspended, false, 'boots again on its own version');
    assert.deepEqual(validateState(s.hh.engine.state), []);
  } finally {
    await s.close();
  }
  if (owners) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(SAVE, 'farm.json'))).digest('hex'), sum, 'the original save is unchanged');
});
