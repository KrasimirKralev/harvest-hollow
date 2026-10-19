// QA r1 H-04 (hv#4) and H-12 (hv#13), the server half: "Bring back {title}" (an undo of an undo) is committed as its own
// kind ('revive', History's "Brought back") and its push says so (`revive`, the title, the things that came back);
// every undo push carries each thing's Bulgarian definite form (`bgDef`), so one thing reads "Ламата вече не се продава".
// RED on 7f67efe: the version was kind 'undo', the push { e: 'undone', names: [] } (no word of what came back), no bgDef.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, testServer, writeSave } from './helpers/server.js';

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'agent', 'providers', 'mock-fixtures', `${name}.json`), 'utf8')).files;

test('H-04 / H-12: undo names what left with its definite form; bring back is kind revive and names what came back', { timeout: 60_000 }, async () => {
  const { dir } = writeSave({ level: 21 });
  const s = await testServer({ dataDir: dir });
  try {
    const mods = s.hh.harness.ctx.mods;
    const pushes = [];
    const broadcast = s.hh.sessions.broadcast.bind(s.hh.sessions);
    s.hh.sessions.broadcast = (msg) => { if (msg && msg.t === 'hx') pushes.push(msg); return broadcast(msg); };
    const staged = await mods.stage('local', fixture('hs-16-llama'), { by: 'p1', prompt: 'Add a llama' });
    await mods.apply('local', staged.candidate, { by: 'p1' });
    // undo: the llama leaves; one thing, with its definite form
    const u = await mods.undo('local', { by: 'p1' });
    const undone = pushes.filter((m) => m.e === 'undone').at(-1);
    assert.deepEqual(undone.names.map((x) => [x.id, x.en, x.bg, x.bgDef]), [['x_llama', 'Llama', 'Лама', 'ламата']]);
    assert.equal(undone.revive, undefined, 'a plain undo is not a bring-back');
    assert.equal(u.kind, 'undo');
    // bring back: the undo of the undo
    const b = await mods.undo('local', { by: 'p2' });
    const back = pushes.filter((m) => m.e === 'undone').at(-1);
    assert.equal(back.revive, true);
    assert.deepEqual(back.title, { en: 'Llamas', bg: 'Лами' });
    assert.deepEqual(back.back.map((x) => [x.id, x.bgDef]), [['x_llama', 'ламата']]);
    assert.deepEqual(back.names, [], 'nothing left the shop');
    assert.equal(b.kind, 'revive');
    const hist = mods.history('local');
    assert.deepEqual(hist.versions.map((v) => v.kind), ['revive', 'undo', 'apply']);
    // going back once more is an undo again (not a bring-back of a bring-back)
    await mods.undo('local', { by: 'p1' });
    assert.equal(pushes.filter((m) => m.e === 'undone').at(-1).revive, undefined);
    assert.equal(mods.active('local').kind, 'undo');
  } finally {
    await s.close();
  }
});
