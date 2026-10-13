// Harness Hollow, single mode (harness contract §2.4-2.6, §4.3-4.6): a mod applied hot (no restart, no reload: a
// server-initiated welcome carries it to both farmers, then the `hx` push), journal lines carry the overlay hash and a
// crash replays them under it, undo and history over REST with the farmer's key, the icons, a restart keeps the mod,
// HH_HARNESS=off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { testServer, writeSave, resume, readJournal, tmpDataDir, quiet } from './helpers/server.js';
import { MSG } from '../shared/net/protocol.js';
import { Persist } from '../server/persist.js';
import { loadFarm, BootRefused } from '../server/index.js';
import { ModStore } from '../server/mods/store.js';
import { replayHooks } from '../server/mods/hot.js';
import { installOverlay } from '../shared/mod/install.js';
import { validateState } from '../shared/rules/state.js';
import { moonlight } from '../shared/mod/examples.js';

const api = (s, url, { method = 'GET', token, body } = {}) => fetch(`http://127.0.0.1:${s.port}/api/harness${url}`, {
  method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const freePlot = (state) => Object.keys(state.farm.objects).sort().find((k) => state.farm.objects[k].def === 'plot' && !state.farm.objects[k].crop);

test('single mode: apply hot to both farmers, mh journaling, a crash replays under the mod, undo, history, icons, restart', async () => {
  const { dir, tokens } = writeSave({ level: 16, coins: 500_000 });
  let s = await testServer({ dataDir: dir, keep: true });
  try {
    // REST auth: the slot token of a seated farmer
    assert.equal((await api(s, '/state')).status, 401);
    assert.equal((await api(s, '/state', { token: 'f'.repeat(64) })).status, 403);
    const st = await api(s, '/state', { token: tokens.p1 });
    assert.equal(st.status, 200);
    assert.equal(st.body.enabled, true);
    assert.equal(st.body.active, null);

    const a = await resume(s.port, tokens.p1, 'kcid01');
    const b = await resume(s.port, tokens.p2, 'mcid01');
    assert.equal(a.w.mod, undefined);
    const mods = s.hh.harness.ctx.mods;
    const v = await mods.validate('local', moonlight(), { full: true });
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.equal(v.stage, 'done');
    assert.equal(v.full, true);
    assert.deepEqual(Object.keys(v.checks), ['schema', 'semantic', 'boot', 'render']);
    assert.equal(v.checks.render.icons, 4, 'two things (their items share the id): 128 and 64 px');
    const staged = await mods.stage('local', moonlight(), { by: 'p1', prompt: 'moon melons', summary: { en: 'Moon Melons!', bg: 'Лунни пъпеши!' } });
    assert.equal(staged.candidate, 1);
    assert.deepEqual(staged.changes.map((c) => `${c.op}:${c.id}`), ['add:x_moon_melon', 'add:x_melon_pie']);
    assert.equal(staged.changes[0].icon, `/mods/${staged.hash}/icons/128/x_moon_melon.png`);
    assert.equal((await mods.preview('local', moonlight())).changes[0].icon, staged.changes[0].icon, 'the preview lists the staged candidate');

    const active = await mods.apply('local', staged.candidate, { by: 'p1' });
    assert.deepEqual([active.n, active.by, active.kind], [1, 'p1', 'apply']);
    for (const c of [a.c, b.c]) {
      const w = await c.next((m) => m.t === MSG.WELCOME);
      assert.equal(w.mod.hash, staged.hash, 'a server-initiated welcome carries the mod');
      const hx = await c.next((m) => m.t === MSG.HX);
      assert.deepEqual([hx.e, hx.by, hx.n], ['applied', 'p1', 1]);
      assert.deepEqual(hx.names.map((x) => x.id).sort(), ['x_melon_pie', 'x_moon_melon']);
      assert.equal(hx.summary.bg, 'Лунни пъпеши!');
    }
    assert.equal(s.hh.engine.modHash, staged.hash);
    assert.equal((await mods.apply('local', staged.candidate, { by: 'p1' }).catch((e) => e)).code, 'NOT_READY', 'once');

    // a farmer plants the new crop: its journal line names the mod it was accepted under
    const plot = freePlot(s.hh.engine.state);
    a.c.send({ t: MSG.ACT, seq: a.w.lastSeq + 1, type: 'plant', args: { id: plot, crop: 'x_moon_melon' } });
    const d = await a.c.next((m) => m.t === MSG.DELTA || m.t === MSG.REJ);
    assert.equal(d.t, MSG.DELTA, JSON.stringify(d));
    const line = readJournal(dir).find((l) => l.type === 'plant');
    assert.equal(line.mh, staged.hash);

    // a crash right now: the snapshot is from the apply, the plant is only in the journal
    const crash = tmpDataDir('hh-crash');
    for (const f of fs.readdirSync(dir)) if (/^farm\./.test(f)) fs.copyFileSync(path.join(dir, f), path.join(crash, f));
    fs.cpSync(path.join(dir, 'harness'), path.join(crash, 'harness'), { recursive: true });
    // RED without the mh-aware replay: the base game does not know the crop, the boot is refused
    installOverlay(null);
    assert.throws(() => loadFarm(new Persist(crash, { log: quiet }), { log: quiet, replay: null }), BootRefused);
    fs.rmSync(crash, { recursive: true, force: true });
    const crash2 = tmpDataDir('hh-crash2');
    for (const f of fs.readdirSync(dir)) if (/^farm\.(json|journal\.jsonl)$/.test(f)) fs.copyFileSync(path.join(dir, f), path.join(crash2, f));
    const hooks = replayHooks(new ModStore(path.join(dir, 'harness')));
    const loaded = loadFarm(new Persist(crash2, { log: quiet }), { log: quiet, replay: { before: hooks.before, after: () => {} } });
    assert.equal(loaded.state.farm.objects[plot].crop.def, 'x_moon_melon', 'the line replayed under its overlay');
    loaded.engine.journal = null;
    fs.rmSync(crash2, { recursive: true, force: true });
    installOverlay(s.hh.mod.overlay);

    // the icons: immutable, only this farm's hashes
    const icon = await fetch(`http://127.0.0.1:${s.port}/mods/${staged.hash}/icons/64/x_moon_melon.png`);
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get('content-type'), 'image/png');
    assert.match(icon.headers.get('cache-control'), /immutable/);
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/mods/00000000/icons/64/x_moon_melon.png`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/mods/${staged.hash}/icons/64/..%2Ffarm.png`)).status, 404);

    // undo over REST by the partner: a new version, the crop retired, what is planted stays
    const u = await api(s, '/undo', { method: 'POST', token: tokens.p2, body: {} });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    assert.deepEqual([u.body.active.n, u.body.active.kind, u.body.active.by], [2, 'undo', 'p2']);
    const undone = await a.c.next((m) => m.t === MSG.HX && m.e === 'undone');
    assert.deepEqual([undone.by, undone.n, undone.to], ['p2', 2, 0]);
    assert.equal(s.hh.engine.state.farm.objects[plot].crop.def, 'x_moon_melon');
    assert.deepEqual(validateState(s.hh.engine.state), []);
    a.c.send({ t: MSG.ACT, seq: a.w.lastSeq + 2, type: 'plant', args: { id: freePlot(s.hh.engine.state), crop: 'x_moon_melon' } });
    assert.equal((await a.c.next((m) => m.t === MSG.REJ || m.t === MSG.DELTA)).code, 'LOCKED', 'a retired crop is not for sale');
    const h = await api(s, '/history', { token: tokens.p1 });
    assert.deepEqual(h.body.versions.map((x) => [x.n, x.kind, x.state]), [[2, 'undo', 'active'], [1, 'apply', 'past']]);
    assert.equal(h.body.versions[1].prompt, 'moon melons');
    assert.equal((await api(s, '/undo', { method: 'POST', token: tokens.p1, body: { to: 'one' } })).status, 400);
    assert.equal((await api(s, '/undo', { method: 'POST', token: tokens.p1, body: { to: 99 } })).status, 404);
    // ... and back to version 1 (redo): the crop is for sale again
    const redo = await api(s, '/undo', { method: 'POST', token: tokens.p1, body: { to: 1 } });
    assert.equal(redo.status, 200);
    assert.equal(s.hh.harness.ctx.mods.active('local').n, 3);
    a.c.close();
    b.c.close();

    // a restart keeps the mod (installed before the farm loads)
    await s.close();
    s = await testServer({ dataDir: dir, keep: true });
    assert.equal(s.hh.mod.n, 3);
    const a2 = await resume(s.port, tokens.p1, 'kcid01');
    assert.equal(a2.w.mod.n, 3);
    assert.equal(a2.w.state.farm.objects[plot].crop.def, 'x_moon_melon');
    a2.c.close();
    for (const f of ['active.json', 'graveyard.json', 'history.jsonl']) {
      assert.equal(fs.statSync(path.join(dir, 'harness', 'mods', f)).mode & 0o777, 0o600, f);
    }
    assert.equal(fs.statSync(path.join(dir, 'harness', 'mods')).mode & 0o777, 0o700);
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a stale candidate: the farm\'s version moved since it was built -> 409 STALE', async () => {
  const { dir } = writeSave({ level: 16 });
  const s = await testServer({ dataDir: dir });
  try {
    const mods = s.hh.harness.ctx.mods;
    const one = await mods.stage('local', moonlight(), { by: 'p1' });
    const other = moonlight();
    other['mod.json'].title.en = 'Moonlight Again';
    delete other['content/recipes/x_melon_pie.json'];
    const two = await mods.stage('local', other, { by: 'p2' });
    await mods.apply('local', two.candidate, { by: 'p2' });
    const err = await mods.apply('local', one.candidate, { by: 'p1' }).catch((e) => e);
    assert.equal(err.code, 'STALE');
    assert.equal(err.status, 409);
  } finally {
    await s.close();
  }
});

test('HH_HARNESS=off: GET /state answers { enabled: false } and nothing else is there', async () => {
  const { loadConfig } = await import('../server/config.js');
  const { dir, tokens } = writeSave({ level: 3 });
  const s = await testServer({ dataDir: dir, harness: loadConfig({ HH_HARNESS: 'off' }).harness });
  try {
    assert.deepEqual((await api(s, '/state', { token: tokens.p1 })).body, { enabled: false });
    assert.equal((await api(s, '/history', { token: tokens.p1 })).status, 404);
  } finally {
    await s.close();
  }
});
