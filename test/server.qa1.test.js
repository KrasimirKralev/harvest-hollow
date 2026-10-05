// Server regressions from the wave-1 QA triage (docs/qa/wave1/TRIAGE.md, section "server"). One test (or more)
// per task id; each one failed on the build the QA audited (HEAD 637caa3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { coopHarness, T0, ROOT } from './helpers.js';
import { StaticFiles, buildHash, fileOf, importsOf, acceptsGzip } from '../server/static.js';
import { createFarm } from '../shared/rules/state.js';
import { backfill } from '../server/migrations.js';
import { Together, nearTo } from '../server/together.js';
import { testServer, wsClient, join, resume, sleep, quiet, plain, readJournal, writeSave, spawnServer, tmpDataDir, recorder } from './helpers/server.js';
import { MSG, ERR, PROTOCOL_VERSION } from '../shared/net/protocol.js';
import { Sessions, AWAY_GRACE_MS } from '../server/sessions.js';
import { Presence, KEEP_POSE_MS } from '../server/presence.js';
import { loadConfig } from '../server/config.js';
import { START } from '../shared/content/config.js';

const plotsOf = (state, n) => Object.keys(state.farm.objects).filter((id) => state.farm.objects[id].def === 'plot').sort().slice(0, n);

test('SV-02: a lost race inside a drag stroke names the partner who got there first', () => {
  const h = coopHarness();
  const A = { pid: 'p1', cid: 'aaaaaa' };
  const B = { pid: 'p2', cid: 'bbbbbb' };
  const plots = plotsOf(h.state, 4);
  assert.equal(h.engine.act(A, { seq: 1, type: 'plant', args: { ids: plots, crop: 'wheat' } }), null);
  h.clock.advance(61_000);
  assert.equal(h.engine.act(A, { seq: 2, type: 'harvest', args: { ids: plots } }), null, 'A harvests the row as a stroke');
  const lost = h.engine.act(B, { seq: 1, type: 'harvest', args: { ids: plots } });
  assert.equal(lost.t, MSG.REJ);
  assert.equal(lost.by, 'p1', 'the stroke that lost names the winner (else: an error toast and a bonk)');
  // a click that loses to a stroke, and a stroke that overlaps the winner's stroke in one plot only
  assert.equal(h.engine.act(A, { seq: 3, type: 'plant', args: { ids: plots.slice(0, 2), crop: 'wheat' } }), null);
  assert.equal(h.engine.act(B, { seq: 2, type: 'plant', args: { id: plots[1], crop: 'wheat' } }).by, 'p1');
  assert.equal(h.engine.act(B, { seq: 3, type: 'plant', args: { ids: [plots[0]], crop: 'carrot' } }).by, 'p1');
  assert.equal(h.engine.rejectedOf('bbbbbb').at(-1).by, 'p1', 'the remembered rejection keeps `by` (welcome.rejected)');
  // never the actor itself, and never after the 10 s window
  assert.equal(h.engine.act(A, { seq: 4, type: 'plant', args: { ids: plots.slice(0, 2), crop: 'wheat' } }).by, undefined);
  h.clock.advance(10_001);
  assert.equal(h.engine.act(B, { seq: 4, type: 'plant', args: { ids: plots.slice(0, 2), crop: 'wheat' } }).by, undefined);
});

test('SV-02: when both partners touched a target, the most recent one is named', () => {
  const h = coopHarness();
  const plots = plotsOf(h.state, 3);
  h.engine.touch({ ids: [plots[0]] }, 'p2', h.clock.now());
  h.clock.advance(1000);
  h.engine.touch({ id: plots[1] }, 'p3', h.clock.now());
  assert.equal(h.engine.lastToucher({ ids: plots }, h.clock.now(), 'p1'), 'p3');
  assert.equal(h.engine.lastToucher({ ids: plots }, h.clock.now(), 'p3'), 'p2');
  assert.equal(h.engine.lastToucher({ ids: [plots[2]] }, h.clock.now(), 'p1'), undefined);
  assert.equal(h.engine.lastToucher({ ids: 'nope' }, h.clock.now(), 'p1'), undefined, 'garbage args never throw');
});

// ---- SV-01: after a crash nobody stays seated, and lastSeenAt is stamped ------------------------------------------

test('SV-01: a boot after a crash stands both farmers up before the catch-up (no Golden Hour with nobody online)', async () => {
  const now = Date.now();
  let saved = 0;
  const { dir } = writeSave({ place: ['sunset_bench'], now, edit(state, server, ids) {
    saved = state.meta.version;
    // both sat down 20 minutes before the crash (Golden Hour is long due), and were active until a minute ago
    state.farm.coop.bench = { p1: { id: ids.sunset_bench, at: now - 20 * 60_000 }, p2: { id: ids.sunset_bench, at: now - 20 * 60_000 } };
    server.clients = { aaaaaa: { pid: 'p1', lastSeq: 0, seenAt: now - 60_000 }, bbbbbb: { pid: 'p2', lastSeq: 0, seenAt: now - 90_000 } };
  } });
  const rec = recorder();
  const s = await testServer({ dataDir: dir, log: rec.log });
  try {
    const st = s.hh.engine.state;
    assert.deepEqual(plain(st.farm.coop.bench), {}, 'stood up at boot');
    assert.equal(st.farm.coop.golden ?? null, null, 'no Golden Hour while nobody is online');
    for (const pid of ['p1', 'p2']) assert.ok(st.players[pid].lastSeenAt >= now - 90_000, `${pid}: lastSeenAt is the crash, not the claim`);
    assert.ok(rec.lines.some(([, m]) => /^2 player\(s\) marked as away/.test(m)), 'one _seen per player');
    assert.ok(s.hh.engine.v > saved);
    for (const pid of ['p1', 'p2']) assert.ok(st.players[pid].lastSeenAt <= s.hh.clock.now(), 'never a future lastSeenAt');
    assert.equal(s.hh.sessions.awayAtBoot(), 0, 'idempotent: a second pass finds nobody present');
  } finally {
    await s.close();
  }
});

test('SV-01: a clean save (everyone left with _seen, nobody seated) gets no boot _seen', async () => {
  const now = Date.now();
  const { dir } = writeSave({ now, edit(state, server) {
    server.clients = { aaaaaa: { pid: 'p1', lastSeq: 0, seenAt: state.players.p1.lastSeenAt } };
  } });
  const rec = recorder();
  const s = await testServer({ dataDir: dir, log: rec.log });
  try {
    assert.ok(!rec.lines.some(([, m]) => /marked as away/.test(m)), 'no _seen');
  } finally {
    await s.close();
  }
});

test('SV-01: lastActive is the newest of the tabs\' records and the last snapshot\'s online list', () => {
  const h = coopHarness();
  const sessions = new Sessions({ engine: h.engine, clock: h.clock, presence: new Presence(h.clock, () => {}), cfg: {}, log: quiet });
  h.server.clients.cccccc = { pid: 'p1', lastSeq: 0, seenAt: h.clock.now() + 50 };
  assert.equal(sessions.lastActive('p1'), h.clock.now() + 50);
  h.server.live = { at: h.clock.now() + 900, online: ['p1'] };
  assert.equal(sessions.lastActive('p1'), h.clock.now() + 900);
  assert.equal(sessions.lastActive('p2'), h.server.clients.bbbbbb.seenAt, 'p2 was not online at the snapshot');
  assert.equal(sessions.lastActive('p9'), -Infinity);
});

// ---- SV-06: a Wi-Fi blip is silent --------------------------------------------------------------------------------

test('SV-06: a reconnect within the grace sends no peer message and no _seen; after the grace the partner hears once', async () => {
  const s = await testServer({ awayGraceMs: 300 });
  try {
    const a = await join(s.port, 'p1', 'Rowan', 'blipaa');
    const b = await join(s.port, 'p2', 'Mia', 'blipbb');
    await sleep(50);
    b.c.msgs.length = 0;
    a.c.ws.terminate();                                   // the Wi-Fi drops
    await sleep(100);
    assert.deepEqual(s.hh.sessions.onlinePids().sort(), ['p1', 'p2'], 'still online within the grace');
    const again = await resume(s.port, a.w.token, 'blipaa');
    assert.equal(again.w.t, MSG.WELCOME);
    assert.equal(again.w.peers.find((p) => p.pid === 'p2').online, true);
    await sleep(400);
    assert.deepEqual(b.c.msgs.filter((m) => m.t === MSG.PEER), [], 'the partner heard nothing about the blip');
    assert.equal(readJournal(s.dataDir).filter((l) => l.type === '_seen').length, 0, 'no _seen for a blip');
    const t0 = s.hh.clock.now();
    again.c.close();
    await sleep(100);
    assert.deepEqual(b.c.msgs.filter((m) => m.t === MSG.PEER), [], 'not yet: the grace');
    const off = await b.c.next((m) => m.t === MSG.PEER, 1000);
    assert.deepEqual([off.pid, off.online], ['p1', false]);
    const seen = readJournal(s.dataDir).filter((l) => l.type === '_seen');
    assert.equal(seen.length, 1);
    assert.ok(seen[0].args.at === undefined || (seen[0].args.at >= t0 && seen[0].args.at < t0 + 100), 'stamped when the socket closed');
    assert.deepEqual(s.hh.sessions.onlinePids(), ['p2']);
    b.c.close();
  } finally {
    await s.close();
  }
});

test('SV-06: a stopping server ends every grace at once, so _seen lands before the final snapshot', async () => {
  const s = await testServer({ keep: true });
  const { dataDir } = s;
  try {
    assert.equal(AWAY_GRACE_MS, 10_000);
    const a = await join(s.port, 'p1', 'Rowan', 'stopaa');
    const before = s.hh.engine.state.players.p1.lastSeenAt;
    await sleep(20);
    a.c.close();
    await sleep(50);
    assert.ok(s.hh.sessions.away.has('p1'), 'in the grace');
    await s.close();
    const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'farm.json'), 'utf8'));
    assert.ok(disk.state.players.p1.lastSeenAt > before, 'lastSeenAt stamped by the shutdown');
  } finally {
    await s.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// ---- SV-07: together minutes survive a restart --------------------------------------------------------------------

test('SV-07: a graceful restart after 7 idle minutes together keeps the 7 minutes', async () => {
  const s1 = await testServer({ keep: true });
  const { dataDir } = s1;
  try {
    await join(s1.port, 'p1', 'Rowan');
    await join(s1.port, 'p2', 'Mia');
    await sleep(30);
    s1.hh.clock.warp(7 * 60_000 + 30_000);
    await s1.close();
    const s2 = await testServer({ dataDir, keep: true });
    try {
      assert.equal(s2.hh.engine.state.farm.stats.togetherMin, 7, 'paid by the _seen of the stop');
      assert.ok(s2.hh.together.pendingMs(s2.hh.clock.now()) >= 30_000, 'the 30 s left over are kept for next time');
    } finally {
      await s2.close();
    }
  } finally {
    await s1.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

/** Spawned servers of one test, killed whatever happens (a live child would keep the test runner alive). */
function children() {
  const list = [];
  return {
    spawn(dir, env) { const c = spawnServer(dir, env); list.push(c); return c; },
    async killAll() {
      for (const c of list) {
        if (c.child.exitCode === null && c.child.signalCode === null) { c.child.kill('SIGKILL'); await c.exit; }
      }
    },
  };
}

test('SV-07: after kill -9, the together time of the last snapshot is paid once (never twice)', async () => {
  const dataDir = tmpDataDir('together-crash');
  const kids = children();
  try {
    const a = kids.spawn(dataDir, { HH_DEV: '1', HH_SNAPSHOT_MS: '600000' });
    const port = await a.port;
    const api = (p, body) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body) }).then((r) => r.json());
    const A = await join(port, 'p1', 'Rowan');
    await join(port, 'p2', 'Mia');
    await sleep(50);
    await api('/api/dev/warp', { ms: 7 * 60_000 + 10_000 });
    await api('/api/dev/save', {});                       // the snapshot holds 7 unpaid minutes
    await api('/api/dev/warp', { ms: 3 * 60_000 });
    A.c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    const d = await A.c.next((m) => m.t === MSG.DELTA && m.by === 'p1');
    assert.equal(readJournal(dataDir).find((l) => l.v === d.v).ext.togetherMin, 10, 'the plant paid all 10 minutes');
    a.child.kill('SIGKILL');
    await a.exit;
    const b = kids.spawn(dataDir, { HH_DEV: '1' });
    const port2 = await b.port;
    const st = await (await fetch(`http://127.0.0.1:${port2}/api/status`)).json();
    assert.ok(st.v > d.v);
    const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'farm.json'), 'utf8'));
    assert.equal(disk.state.farm.stats.togetherMin, 10, '10 minutes, not 17: the replayed plant already paid the 7 of the snapshot');
  } finally {
    await kids.killAll();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('SV-07: after kill -9 with nobody acting, the boot pays the together minutes of the last snapshot', async () => {
  const dataDir = tmpDataDir('together-idle');
  const kids = children();
  try {
    const a = kids.spawn(dataDir, { HH_DEV: '1', HH_SNAPSHOT_MS: '600000' });
    const port = await a.port;
    const api = (p, body) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body) }).then((r) => r.json());
    await join(port, 'p1', 'Rowan');
    await join(port, 'p2', 'Mia');
    await sleep(50);
    await api('/api/dev/warp', { ms: 7 * 60_000 + 10_000 });
    await api('/api/dev/save', {});
    a.child.kill('SIGKILL');
    await a.exit;
    const b = kids.spawn(dataDir, { HH_DEV: '1' });
    await b.port;
    const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'farm.json'), 'utf8'));
    assert.equal(disk.state.farm.stats.togetherMin, 7);
  } finally {
    await kids.killAll();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// ---- SV-08: no echo of one's own presence row ---------------------------------------------------------------------

test('SV-08: presence rows are never echoed to the player who moved', async () => {
  const s = await testServer();
  try {
    const a = await join(s.port, 'p1', 'Rowan');
    const b = await join(s.port, 'p2', 'Mia');
    for (let i = 0; i < 5; i++) {
      a.c.send({ t: 'mv', x: 20 + i * 0.2, z: 30, f: 0, a: 1 });
      await sleep(70);
    }
    await sleep(300);
    const rows = (c) => c.msgs.filter((m) => m.t === MSG.PRESENCE).flatMap((m) => m.list);
    assert.ok(rows(b.c).some((r) => r[0] === 'p1'), 'the partner sees A move');
    assert.deepEqual(rows(a.c).filter((r) => r[0] === 'p1'), [], 'A never receives its own rows');
    a.c.close(); b.c.close();
  } finally {
    await s.close();
  }
});

// ---- SV-09: a malformed token is answered ---------------------------------------------------------------------------

test('SV-09: a hello with a malformed token is answered deny BAD_TOKEN at once; then a plain hello gets slots', async () => {
  const s = await testServer();
  try {
    const c = await wsClient(s.port);
    const t0 = Date.now();
    c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'abcdef', caps: ['b'], token: 'tokAAAA' });
    assert.deepEqual(await c.next((m) => m.t === MSG.DENY, 1000), { t: MSG.DENY, code: ERR.BAD_TOKEN });
    assert.ok(Date.now() - t0 < 1000);
    c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'abcdef' });
    assert.equal((await c.next((m) => m.t === MSG.SLOTS)).t, MSG.SLOTS);
    // anything else malformed stays garbage (no answer), a bad token with a bad cid too
    const g = await wsClient(s.port);
    g.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'NO', token: 'tokAAAA' });
    await assert.rejects(g.next((m) => m.t === MSG.DENY, 300));
    c.close(); g.close();
  } finally {
    await s.close();
  }
});

// ---- SV-04: the farm's zone never changes silently ----------------------------------------------------------------

test('SV-04: an existing farm keeps its own zone unless HH_TZ is set (then the change is logged loudly)', async () => {
  const { dir } = writeSave({ tz: 'Pacific/Kiritimati' });
  const kept = recorder();
  const s1 = await testServer({ dataDir: dir, keep: true, tz: 'Pacific/Pago_Pago', tzExplicit: false, log: kept.log });
  try {
    assert.equal(s1.hh.engine.state.meta.tz, 'Pacific/Kiritimati', 'the machine zone moved; the farm did not');
  } finally {
    await s1.close();
  }
  const moved = recorder();
  const s2 = await testServer({ dataDir: dir, tz: 'Pacific/Pago_Pago', tzExplicit: true, log: moved.log });
  try {
    assert.equal(s2.hh.engine.state.meta.tz, 'Pacific/Pago_Pago', 'HH_TZ set: the farm follows it');
    assert.ok(moved.lines.some(([lvl, m]) => lvl === 'warn' && /FARM TIME ZONE CHANGED: Pacific\/Kiritimati -> Pacific\/Pago_Pago/.test(m)));
  } finally {
    await s2.close();
  }
});

test('SV-04: HH_TZ is "explicit" only when set; a new farm and a schema-1 save take the configured zone', async () => {
  assert.equal(loadConfig({}).tzExplicit, false);
  assert.equal(loadConfig({ HH_TZ: 'Asia/Tokyo' }).tzExplicit, true);
  const fresh = await testServer({ tz: 'Asia/Tokyo', tzExplicit: false });
  try {
    assert.equal(fresh.hh.engine.state.meta.tz, 'Asia/Tokyo');
  } finally {
    await fresh.close();
  }
  const { dir } = writeSave({ edit(state) { state.schema = 1; delete state.meta.tz; delete state.farm.rolls; } });
  const old = await testServer({ dataDir: dir, tz: 'Asia/Tokyo', tzExplicit: false });
  try {
    assert.equal(old.hh.engine.state.meta.tz, 'Asia/Tokyo', 'a save from before zones gets this machine\'s zone once');
  } finally {
    await old.close();
  }
});

// ---- coop-robust-06 (CL-03, server part): a returning player reappears where they left ----------------------------

test('CL-03 server: a player back within KEEP_POSE_MS reappears where they stood, later at the spawn', () => {
  let t = 1000;
  const clock = { now: () => t };
  const p = new Presence(clock, () => {});
  p.join('p1');
  p.move('p1', { x: START.spawn.p1.x + 0.5, z: START.spawn.p1.z, f: 1.5, a: 1, tool: 'sickle' });
  const at = { x: p.p.get('p1').x, z: p.p.get('p1').z };
  p.leave('p1');
  t += KEEP_POSE_MS - 1;
  p.join('p1');
  assert.deepEqual([p.p.get('p1').x, p.p.get('p1').z, p.p.get('p1').f, p.p.get('p1').tool], [at.x, at.z, 1.5, 'sickle']);
  p.leave('p1');
  t += KEEP_POSE_MS + 1;
  p.join('p1');
  assert.deepEqual([p.p.get('p1').x, p.p.get('p1').z], [START.spawn.p1.x, START.spawn.p1.z]);
});

// ---- RC-31 (server part): the actor's distance to the target, observed by the server -----------------------------

test('RC-31 server: ext.near is the actor\'s distance to the target footprint in tenths of a tile', () => {
  const s = createFarm(7, T0);
  s.farm.objects['bench.1'] = { def: 'sunset_bench', x: 20, z: 30, rot: 0, placedAt: T0, by: 'p1' };   // 2 x 1 tiles
  s.farm.objects['bench.2'] = { def: 'sunset_bench', x: 40, z: 30, rot: 1, placedAt: T0, by: 'p1' };   // 1 x 2 rotated
  assert.equal(nearTo(s, { id: 'bench.1' }, { x: 21.5, z: 30.5 }), 0, 'standing on it');
  assert.equal(nearTo(s, { id: 'bench.1' }, { x: 22, z: 30.5 }), 0, 'on its far edge');
  assert.equal(nearTo(s, { id: 'bench.1' }, { x: 25, z: 30.5 }), 30, '3 tiles right of a 2-wide bench');
  assert.equal(nearTo(s, { id: 'bench.1' }, { x: 21, z: 34 }), 30, '3 tiles below');
  assert.equal(nearTo(s, { id: 'bench.2' }, { x: 40.5, z: 33.5 }), 15, 'rotated: 2 tiles deep');
  assert.equal(nearTo(s, { id: 'nope' }, { x: 1, z: 1 }), null);
  assert.equal(nearTo(s, { id: 'bench.1' }, null), null, 'no pose: unknown, never "far"');
  s.farm.objects['a.1'] = { def: 'chicken', home: 'bench.1', placedAt: T0, by: 'p1' };
  assert.equal(nearTo(s, { id: 'a.1' }, { x: 1, z: 1 }), null, 'an animal has no footprint of its own');
  const t = new Together({ online: () => ['p1'], poses: () => new Map([['p1', { x: 30, z: 30.5 }]]) });
  assert.equal(t.player('p1', { type: 'sit', args: { id: 'bench.1' } }, s, T0).ext.near, 80);
  assert.equal(t.player('p1', { type: 'sell', args: { item: 'wheat', qty: 1 } }, s, T0).ext.near, undefined);
});

// ---- SV-03: the build identity; SV-05: cheap loads and reloads ------------------------------------------------------

/** GET with node:http (fetch would add its own cache headers); resolves { status, headers, body: Buffer }. */
function get(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('SV-03: the server names its build (status, welcome, the page) and the page carries the one it was served with', async () => {
  const s = await testServer();
  try {
    const st = await (await fetch(`http://127.0.0.1:${s.port}/api/status`)).json();
    assert.match(st.buildHash, /^[0-9a-f]{16}$/);
    assert.equal(st.buildHash, buildHash(ROOT));
    const { w, c } = await join(s.port, 'p1', 'Rowan');
    assert.equal(w.buildHash, st.buildHash, 'welcome.buildHash');
    c.close();
    const html = String((await get(s.port, '/')).body);
    assert.ok(html.includes(`<meta name="hh-build" content="${st.buildHash}">`), 'index.html carries the build');
    assert.ok(html.indexOf('<meta charset') < html.indexOf('hh-build'), 'after the charset');
  } finally {
    await s.close();
  }
});

test('SV-03: BUILD_HASH covers every byte of public/ and shared/', () => {
  const root = tmpDataDir('buildroot');
  try {
    fs.mkdirSync(path.join(root, 'public/js'), { recursive: true });
    fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public/js/a.js'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(root, 'shared/b.js'), 'export const b = 1;\n');
    const h1 = buildHash(root);
    const copy = `${root}-2`;
    fs.cpSync(root, copy, { recursive: true });
    fs.writeFileSync(path.join(copy, 'shared/b.js'), 'export const b = 2;\n');
    assert.notEqual(buildHash(copy), h1, 'one changed byte in shared/ is another build');
    fs.rmSync(copy, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SV-05: index.html maps every module to a content-hashed URL, preloads the static graph, versions its own files', async () => {
  const s = await testServer();
  try {
    const r = await get(s.port, '/');
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-cache', 'the page itself always revalidates');
    const html = String(r.body);
    const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]);
    const hashOf = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 12);
    assert.equal(map.imports['/js/main.js'], `/js/main.js?v=${hashOf('public/js/main.js')}`);
    assert.equal(map.imports['/shared/rules/index.js'], `/shared/rules/index.js?v=${hashOf('shared/rules/index.js')}`);
    assert.match(map.imports.three, /^\/vendor\/three\/build\/three\.module\.js\?v=[0-9a-f]{12}$/);
    assert.ok(map.imports['/vendor/three/build/three.core.js'], 'three.module.js imports three.core.js relatively');
    assert.ok(map.imports['/js/ui/panels/index.js'], 'a dynamic import() is mapped (never preloaded)');
    assert.ok(!html.includes('modulepreload" href="/js/ui/panels/index.js'), 'dynamic imports are not preloaded');
    for (const f of fs.readdirSync(path.join(ROOT, 'public/js/net'))) assert.ok(map.imports[`/js/net/${f}`], `/js/net/${f} is mapped`);
    const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
    assert.ok(preloads.length > 50, `the static graph is preloaded (${preloads.length})`);
    assert.ok(preloads.every((u) => /\?v=[0-9a-f]{12}$/.test(u)), 'only versioned preloads (an unversioned one loads a module twice)');
    assert.ok(html.indexOf('type="importmap"') < html.indexOf('rel="modulepreload"'), 'the map comes first');
    assert.match(html, /<script type="module" src="\/js\/main\.js\?v=[0-9a-f]{12}"><\/script>/);
    assert.match(html, /<link rel="stylesheet" href="\/css\/style\.css\?v=[0-9a-f]{12}">/);
    assert.ok(/<link rel="preload" href="\/assets\/fonts\/[a-z0-9-]+\.woff2"/.test(html), 'preloads stay what the CSS asks for');
    const again = await get(s.port, '/', { 'if-none-match': r.headers.etag });
    assert.equal(again.status, 304);
    const gz = await get(s.port, '/', { 'accept-encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(String(zlib.gunzipSync(gz.body)), html);
  } finally {
    await s.close();
  }
});

test('SV-05: a ?v= URL with the current hash is immutable, an old hash or no hash revalidates; assets trust their ?v', async () => {
  const s = await testServer();
  try {
    const html = String((await get(s.port, '/')).body);
    const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]);
    const cur = await get(s.port, map.imports['/js/net/sync.js']);
    assert.equal(cur.status, 200);
    assert.equal(cur.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.match(cur.headers['content-type'], /javascript/);
    assert.equal((await get(s.port, '/js/net/sync.js?v=000000000000')).headers['cache-control'], 'no-cache', 'an old hash');
    assert.equal((await get(s.port, '/js/net/sync.js')).headers['cache-control'], 'no-cache');
    assert.equal((await get(s.port, '/assets/models/manifest.json?v=anything')).headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.match((await get(s.port, '/vendor/three/build/three.module.js')).headers['cache-control'], /max-age=604800/);
    // never outside the mounts, never dotfiles
    assert.equal((await get(s.port, '/shared/%2e%2e/server/index.js')).status, 404);
    assert.equal((await get(s.port, '/js/%2e%2e/%2e%2e/package.json')).status, 404);
    assert.equal(fileOf(ROOT, '/.git/config'), null);
  } finally {
    await s.close();
  }
});

test('SV-05: code, JSON and models are served gzip\'ed when the client accepts it (and revalidate as 304)', async () => {
  const s = await testServer();
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'public/js/main.js'));
    const z = await get(s.port, '/js/main.js', { 'accept-encoding': 'gzip, deflate, br' });
    assert.equal(z.headers['content-encoding'], 'gzip');
    assert.equal(z.headers.vary, 'Accept-Encoding');
    assert.ok(z.body.length < raw.length / 2, `${z.body.length} < ${raw.length}`);
    assert.deepEqual(zlib.gunzipSync(z.body), raw);
    assert.equal((await get(s.port, '/js/main.js', { 'accept-encoding': 'gzip', 'if-none-match': z.headers.etag })).status, 304);
    const plainBody = await get(s.port, '/js/main.js');
    assert.equal(plainBody.headers['content-encoding'], undefined, 'no Accept-Encoding: identity');
    assert.deepEqual(plainBody.body, raw);
    assert.equal((await get(s.port, '/js/main.js', { 'accept-encoding': 'gzip;q=0' })).headers['content-encoding'], undefined);
    assert.equal((await get(s.port, '/js/main.js', { 'accept-encoding': 'gzip', range: 'bytes=0-9' })).headers['content-encoding'], undefined,
      'a Range request is served as is');
    const glb = fs.readdirSync(path.join(ROOT, 'public/assets/models/avatars')).find((f) => f.endsWith('.glb'));
    if (glb) assert.equal((await get(s.port, `/assets/models/avatars/${glb}`, { 'accept-encoding': 'gzip' })).headers['content-encoding'], 'gzip');
    assert.equal((await get(s.port, '/favicon.svg', { 'accept-encoding': 'gzip' })).status, 200);
    assert.equal(acceptsGzip({ headers: { 'accept-encoding': 'br, *;q=0.1' } }), true);
    assert.equal(acceptsGzip({ headers: {} }), false);
  } finally {
    await s.close();
  }
});

test('SV-05: the page\'s own unversioned modulepreloads are dropped; an edited file gets a new URL at the next load', () => {
  const root = tmpDataDir('staticroot');
  try {
    fs.mkdirSync(path.join(root, 'public/js'), { recursive: true });
    fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public/index.html'), [
      '<!doctype html><html><head><meta charset="utf-8">',
      '<link rel="modulepreload" href="/js/main.js">',
      '<script type="importmap">{ "imports": { "lib": "/js/lib.js" } }</script>',
      '</head><body><script type="module" src="/js/main.js"></script></body></html>'].join('\n'));
    fs.writeFileSync(path.join(root, 'public/js/main.js'), [
      "import { a } from './a.js';",
      "import {",
      "  l,",
      "} from 'lib';",
      "// import { no } from './no.js';",
      "/** @param {import('../../shared/typeonly.js').T} x */",
      "export const later = () => import('../../shared/late.js');",
      "export const x = a + l;"].join('\n'));
    fs.writeFileSync(path.join(root, 'public/js/a.js'), "export const a = 1;\n");
    fs.writeFileSync(path.join(root, 'public/js/lib.js'), "import { s } from '../../shared/s.js';\nexport const l = s;\n");
    fs.writeFileSync(path.join(root, 'shared/s.js'), 'export const s = 1;\n');
    fs.writeFileSync(path.join(root, 'shared/late.js'), 'export const late = 1;\n');
    fs.writeFileSync(path.join(root, 'shared/typeonly.js'), 'export const t = 1;\n');
    const st = new StaticFiles({ root, log: quiet });
    const html = String(st.indexHtml().body);
    const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
    assert.deepEqual(Object.keys(map).sort(), ['/js/a.js', '/js/lib.js', '/js/main.js', '/shared/late.js', '/shared/s.js', 'lib'].sort());
    assert.equal(map.lib, map['/js/lib.js'], 'the bare specifier maps straight to the versioned file');
    const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1].split('?')[0]).sort();
    assert.deepEqual(preloads, ['/js/a.js', '/js/lib.js', '/shared/s.js'], 'static imports only, entry and dynamic excluded');
    assert.ok(!html.includes('<link rel="modulepreload" href="/js/main.js">'), 'the unversioned page preload is gone');
    const v1 = map['/js/a.js'];
    assert.equal(st.indexHtml(), st.indexHtml(), 'memoized while nothing changed');
    fs.writeFileSync(path.join(root, 'public/js/a.js'), 'export const a = 2; // edited while the server runs\n');
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(root, 'public/js/a.js'), t, t);
    const map2 = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(String(st.indexHtml().body))[1]).imports;
    assert.notEqual(map2['/js/a.js'], v1, 'a new URL: never the old immutable copy');
    assert.equal(map2['/js/main.js'], map['/js/main.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SV-05: importsOf reads static, multi-line and dynamic imports, never comments', () => {
  const src = [
    "import a, { b } from './a.js';",
    "import * as T from 'three';",
    "export { c } from \"../c.js\";",
    "import './side.js';",
    "import {",
    "  d,",
    "  e } from './de.js';",
    "  // import x from './commented.js';",
    " * {import('./jsdoc.js').T}",
    "const m = await import('./dyn.js'); const n = 'import x from \"./str.js\"';",
    "export const from = 1;"].join('\n');
  assert.deepEqual(importsOf(src), [
    { spec: './a.js', dynamic: false }, { spec: 'three', dynamic: false }, { spec: '../c.js', dynamic: false },
    { spec: './side.js', dynamic: false }, { spec: './de.js', dynamic: false }, { spec: './dyn.js', dynamic: true }]);
});

test('rules-content #6: a save from before the wave-1 QA fields gets them from backfill (xpFrac = 0)', () => {
  const s = createFarm(7, T0);
  delete s.farm.xpFrac;
  const filled = backfill(s, { now: T0, tz: 'Europe/Sofia' });
  assert.ok(filled.includes('farm.xpFrac'));
  assert.equal(s.farm.xpFrac, 0);
});
