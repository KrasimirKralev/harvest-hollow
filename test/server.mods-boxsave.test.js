// The owners' real save (a copy of .scratch/box-save/, never the original: it is local only and skipped where absent)
// boots with every example family applied, plays on, undoes to the game as it was, and boots again after each step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, testServer, tmpDataDir, resume } from './helpers/server.js';
import { MSG } from '../shared/net/protocol.js';
import { validateState } from '../shared/rules/state.js';
import { everything } from '../shared/mod/examples.js';

const SAVE = path.join(ROOT, '.scratch', 'box-save');
const have = fs.existsSync(path.join(SAVE, 'farm.json'));

test('the owners\' save: mod applied, played, undone, restarted (on a copy)', { skip: !have && 'no .scratch/box-save on this machine' }, async () => {
  const dir = tmpDataDir('hh-box');
  for (const f of fs.readdirSync(SAVE)) fs.copyFileSync(path.join(SAVE, f), path.join(dir, f));
  const sum = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(SAVE, f))).digest('hex');
  const before = Object.fromEntries(fs.readdirSync(SAVE).map((f) => [f, sum(f)]));
  // a device token for p1 (the copy's sidecar gets one more hash; the original is never written)
  const token = crypto.randomBytes(32).toString('hex');
  const save = JSON.parse(fs.readFileSync(path.join(dir, 'farm.json'), 'utf8'));
  save.server.auth.p1.extra = [...(save.server.auth.p1.extra ?? []), crypto.createHash('sha256').update(token).digest('hex')];
  fs.writeFileSync(path.join(dir, 'farm.json'), JSON.stringify(save));
  let s = await testServer({ dataDir: dir, keep: true, tz: save.state.meta.tz });
  try {
    assert.deepEqual(validateState(s.hh.engine.state), []);
    const mods = s.hh.harness.ctx.mods;
    const v = await mods.validate('local', everything(), { full: true });
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.equal(v.checks.boot.simHours, 48);
    const staged = await mods.stage('local', everything(), { by: 'p1' });
    await mods.apply('local', staged.candidate, { by: 'p1' });
    assert.deepEqual(validateState(s.hh.engine.state), []);
    const a = await resume(s.port, token, 'boxcid');
    assert.equal(a.w.t, MSG.WELCOME, JSON.stringify(a.w));
    assert.equal(a.w.mod.n, staged.candidate);
    // play on: plant the new crop where there is room, sell something old
    const plot = Object.keys(a.w.state.farm.objects).sort().find((k) => a.w.state.farm.objects[k].def === 'plot' && !a.w.state.farm.objects[k].crop);
    if (plot) {
      a.c.send({ t: MSG.ACT, seq: a.w.lastSeq + 1, type: 'plant', args: { id: plot, crop: 'x_moon_melon' } });
      assert.equal((await a.c.next((m) => m.t === MSG.DELTA || m.t === MSG.REJ)).t, MSG.DELTA);
    }
    a.c.close();
    await s.close();
    s = await testServer({ dataDir: dir, keep: true, tz: save.state.meta.tz });
    assert.equal(s.hh.mod.n, staged.candidate, 'boots with the mod');
    assert.deepEqual(validateState(s.hh.engine.state), []);
    const undone = await s.hh.harness.ctx.mods.undo('local', { by: 'p1' });
    assert.equal(undone.kind, 'undo');
    assert.deepEqual(validateState(s.hh.engine.state), []);
    await s.close();
    s = await testServer({ dataDir: dir, keep: true, tz: save.state.meta.tz });
    assert.equal(s.hh.mod.n, undone.n, 'boots after the undo');
    assert.deepEqual(validateState(s.hh.engine.state), []);
    if (plot) assert.equal(s.hh.engine.state.farm.objects[plot].crop.def, 'x_moon_melon', 'the retired crop still grows');
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(Object.fromEntries(fs.readdirSync(SAVE).map((f) => [f, sum(f)])), before, 'the original save is untouched');
});
