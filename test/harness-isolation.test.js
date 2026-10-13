// Harness Hollow, multi mode (docs/agent-notes/harness-contract.md §2.4): a farm's first mod moves it into its own
// worker thread (its sockets close with CLOSE.MOD_RELOAD and come back with the mod in the welcome); the other farm on
// the same host never sees it (its rules refuse the mod's crop as unknown content); the host's own process never
// installs a mod; a restart loads the modded farm into its worker again; an undo through REST retires the crop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDataDir } from './helpers/server.js';
import { loadConfig, multiConfig } from '../server/config.js';
import { PROTOCOL_VERSION, MSG, CLOSE, ERR } from '../shared/net/protocol.js';
import { CONTENT, cropOf } from '../shared/content/index.js';
import { moonlight } from '../shared/mod/examples.js';

/** The moonlight crop at level 1, so a new farm can plant it at once. */
const earlyMelon = () => {
  const f = moonlight();
  f['content/crops/x_moon_melon.json'].unlock = 1;
  delete f['content/recipes/x_melon_pie.json'];
  return f;
};

async function multiServer(dataDir, extra = {}) {
  const { startServer } = await import('../server/index.js');
  const cfg = { ...loadConfig({}), mode: 'multi', multi: { ...multiConfig({}) }, port: 0, host: '127.0.0.1', dataDir,
    quiet: true, dev: true, awayGraceMs: 0, ...extra };
  const s = await startServer(cfg);
  return { ...s, reg: s.hh.reg, base: `http://127.0.0.1:${s.port}` };
}

async function farmSocket(port, id) {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?farm=${id}`);
  const msgs = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    for (const x of m.t === 'b' ? m.list : [m]) {
      msgs.push(x);
      for (const w of waiters.slice()) if (w.pred(x)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(x); }
    }
  });
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return {
    ws, msgs, closed,
    send: (m) => ws.send(JSON.stringify(m)),
    next(pred, ms = 8000) {
      const seen = msgs.find(pred);
      if (seen) { msgs.splice(msgs.indexOf(seen), 1); return Promise.resolve(seen); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: (m) => { clearTimeout(t); msgs.splice(msgs.indexOf(m), 1); resolve(m); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timeout; got ${JSON.stringify(msgs.map((x) => x.t))}`)); }, ms);
        waiters.push(w);
      });
    },
  };
}

async function post(base, url, { body, headers = {} } = {}) {
  const r = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** A new farm with its creator seated as p1: { id, secret, c, w }. */
async function seated(s, cid) {
  const { id, secret } = (await post(s.base, '/api/farms')).body;
  const c = await farmSocket(s.port, id);
  c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid, token: secret });
  await c.next((m) => m.t === MSG.SLOTS);
  c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid, token: secret, claim: { slot: 'p1', name: 'Rowan' } });
  const w = await c.next((m) => m.t === MSG.WELCOME);
  return { id, secret, c, w };
}

async function resume(s, id, secret, cid) {
  const c = await farmSocket(s.port, id);
  c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid, token: secret });
  const w = await c.next((m) => m.t === MSG.WELCOME || m.t === MSG.DENY);
  return { c, w };
}

const freePlot = (state) => Object.keys(state.farm.objects).sort().find((k) => state.farm.objects[k].def === 'plot' && !state.farm.objects[k].crop);

test('multi mode: one farm modded in its own worker, the other farm and the host never see the mod', async () => {
  const dataDir = tmpDataDir('hh-iso');
  let s = await multiServer(dataDir);
  try {
    const A = await seated(s, 'cidaaaa1');
    const B = await seated(s, 'cidbbbb1');
    assert.equal(A.w.mod, undefined, 'no mod yet');
    const mods = s.hh.harness.ctx.mods;
    const v = await mods.validate(A.id, earlyMelon(), { full: true });
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    const staged = await mods.stage(A.id, earlyMelon(), { by: 'p1', prompt: 'a moon melon' });
    assert.equal(s.reg.rec(A.id).host.kind, 'local', 'an unmodded farm runs in the host process');
    const active = await mods.apply(A.id, staged.candidate, { by: 'p1' });
    assert.equal(active.n, staged.candidate);
    assert.equal(await A.c.closed, CLOSE.MOD_RELOAD, 'the page reconnects quietly');
    assert.equal(s.reg.rec(A.id).host.kind, 'worker', 'the modded farm moved into its own worker');
    assert.equal(s.reg.rec(B.id).host.kind, 'local');
    // the host process itself never installs a mod (content is a module singleton)
    assert.equal(CONTENT.crops.has('x_moon_melon'), false);
    assert.equal(cropOf('x_moon_melon'), undefined);

    // farm A: the welcome carries the overlay, the helper's toast follows, the crop can be planted
    const a = await resume(s, A.id, A.secret, 'cidaaaa1');
    assert.equal(a.w.t, MSG.WELCOME);
    assert.equal(a.w.mod.n, staged.candidate);
    assert.ok(a.w.mod.overlay.defs.crops.some((c) => c.id === 'x_moon_melon'));
    const hx = await a.c.next((m) => m.t === MSG.HX && m.e === 'applied');
    assert.deepEqual(hx.names.map((x) => x.id), ['x_moon_melon']);
    const plotA = freePlot(a.w.state);
    a.c.send({ t: MSG.ACT, seq: a.w.lastSeq + 1, type: 'plant', args: { id: plotA, crop: 'x_moon_melon' } });
    const d = await a.c.next((m) => m.t === MSG.DELTA || m.t === MSG.REJ);
    assert.equal(d.t, MSG.DELTA, JSON.stringify(d));

    // farm B, same host: no mod in its welcome, and its rules do not know the crop at all
    B.c.send({ t: MSG.RESYNC });
    const wb = await B.c.next((m) => m.t === MSG.WELCOME);
    assert.equal(wb.mod, undefined);
    B.c.send({ t: MSG.ACT, seq: wb.lastSeq + 1, type: 'plant', args: { id: freePlot(wb.state), crop: 'x_moon_melon' } });
    const rb = await B.c.next((m) => m.t === MSG.REJ || m.t === MSG.DELTA);
    assert.equal(rb.t, MSG.REJ);
    assert.equal(rb.code, ERR.BAD_ARGS, 'unknown content on the unmodded farm');
    B.c.send({ t: MSG.ACT, seq: wb.lastSeq + 2, type: 'plant', args: { id: freePlot(wb.state), crop: 'wheat' } });
    assert.equal((await B.c.next((m) => m.t === MSG.REJ || m.t === MSG.DELTA)).t, MSG.DELTA, 'farm B plays on');
    const st = await (await fetch(`${s.base}/api/status`)).json();
    assert.equal(st.farms.modded, 1);
    a.c.ws.close();
    B.c.ws.close();

    // a restart: the modded farm loads into its worker again, with the crop still in the ground
    await s.close();
    s = await multiServer(dataDir);
    const a2 = await resume(s, A.id, A.secret, 'cidaaaa1');
    assert.equal(s.reg.rec(A.id).host.kind, 'worker');
    assert.equal(a2.w.mod.n, staged.candidate);
    assert.equal(a2.w.state.farm.objects[plotA].crop.def, 'x_moon_melon');
    const b2 = await resume(s, B.id, B.secret, 'cidbbbb1');
    assert.equal(b2.w.mod, undefined);
    assert.equal(s.reg.rec(B.id).host.kind, 'local');

    // undo through REST (a seated farmer's key): the crop is retired, what is planted keeps growing
    assert.equal((await post(s.base, `/api/f/${A.id}/harness/undo`, { body: {} })).status, 401);
    assert.equal((await post(s.base, `/api/f/${A.id}/harness/undo`, { body: {}, headers: { authorization: `Bearer ${B.secret}` } })).status, 403,
      'another farm\'s key');
    const u = await post(s.base, `/api/f/${A.id}/harness/undo`, { body: {}, headers: { authorization: `Bearer ${A.secret}` } });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    const undone = await a2.c.next((m) => m.t === MSG.HX && m.e === 'undone');
    assert.equal(undone.to, 0);
    const w3 = await a2.c.next((m) => m.t === MSG.WELCOME);
    const melon = w3.mod.overlay.graveyard.crops.find((c) => c.id === 'x_moon_melon');
    assert.equal(melon.retired, true);
    assert.equal(w3.state.farm.objects[plotA].crop.def, 'x_moon_melon', 'the planted crop stays');
    const hist = await (await fetch(`${s.base}/api/f/${A.id}/harness/history`, { headers: { authorization: `Bearer ${A.secret}` } })).json();
    assert.deepEqual(hist.versions.map((x) => x.kind), ['undo', 'apply']);
    // the icons are served for this farm's hashes only
    const icon = await fetch(`${s.base}/f/${A.id}/mods/${staged.hash}/icons/128/x_moon_melon.png`);
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get('cache-control'), /immutable/);
    assert.equal((await fetch(`${s.base}/f/${B.id}/mods/${staged.hash}/icons/128/x_moon_melon.png`)).status, 404);
    a2.c.ws.close();
    b2.c.ws.close();
  } finally {
    await s.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('multi mode: a modded farm\'s files stay inside the farm folder, and deleting the farm deletes them', async () => {
  const dataDir = tmpDataDir('hh-iso2');
  const s = await multiServer(dataDir);
  try {
    const A = await seated(s, 'cidcccc1');
    const mods = s.hh.harness.ctx.mods;
    const staged = await mods.stage(A.id, earlyMelon(), { by: 'p1' });
    await mods.apply(A.id, staged.candidate, { by: 'p1' });
    const dir = path.join(dataDir, 'farms', A.id, 'harness', 'mods');
    assert.ok(fs.existsSync(path.join(dir, 'active.json')));
    assert.equal((fs.statSync(path.join(dir, 'active.json')).mode & 0o777), 0o600);
    const r = await post(s.base, `/api/f/${A.id}/delete`, { headers: { authorization: `Bearer ${A.secret}` } });
    assert.equal(r.status, 200);
    assert.equal(fs.existsSync(path.join(dataDir, 'farms', A.id)), false);
  } finally {
    await s.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
