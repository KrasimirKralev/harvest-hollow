// Server regressions from QA wave 2 (docs/qa/qa2/TRIAGE.md, section "server"). One test (or more) per task id.
// The status of each task (and which tests were RED on HEAD 5bef2a5) is in docs/qa/qa2/status-server.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import express from 'express';
import { WebSocket } from 'ws';
import crypto from 'node:crypto';
import { testServer, join, resume, sleep, readJournal, spawnServer, tmpDataDir, quiet, ROOT } from './helpers/server.js';
import { MSG, PROTOCOL_VERSION } from '../shared/net/protocol.js';
import { CONTENT_HASH } from '../shared/content/index.js';
import { RULES_VERSION } from '../shared/rules/version.js';
import { SyncStore } from '../public/js/net/sync.js';
import { StaticFiles, packSpecs } from '../server/static.js';

const emptyPlots = (state, n) => Object.keys(state.farm.objects).filter((id) => state.farm.objects[id].def === 'plot'
  && state.farm.objects[id].crop === null).sort().slice(0, n);

// ---- SV-01: a client-only deploy must not throw away what was clicked during the restart -------------------------

test('SV-01: every welcome names the rules the server runs (rulesVersion) next to contentHash and buildHash', async () => {
  const s = await testServer();
  try {
    const { c, w, cid } = await join(s.port, 'p1', 'Rowan');
    assert.equal(w.rulesVersion, RULES_VERSION, 'claim welcome');
    assert.equal(w.contentHash, CONTENT_HASH);
    assert.equal(w.buildHash, s.hh.static.build);
    c.send({ t: MSG.RESYNC });
    const r = await c.next((m) => m.t === MSG.WELCOME);
    assert.equal(r.rulesVersion, RULES_VERSION, 'resync welcome');
    c.close();
    await sleep(20);
    const back = await resume(s.port, w.token, cid);
    assert.equal(back.w.rulesVersion, RULES_VERSION, 'resume welcome');
    back.c.close();
  } finally {
    await s.close();
  }
});

/**
 * A real SyncStore over a real socket, as main.js drives it: frames are dropped while the socket is closed and
 * reset() re-sends what is still pending on the next welcome.
 */
function storeClient() {
  const sc = { ws: null, msgs: [], serverNow: () => Date.now() };
  sc.store = new SyncStore({ cid: null, now: () => sc.serverNow(), send: (m) => { if (sc.ws && sc.ws.readyState === WebSocket.OPEN) sc.ws.send(JSON.stringify(m)); },
    onInternal: (e) => { throw e; } });
  sc.connect = (port, hello) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sc.ws = ws;
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      for (const x of m.t === MSG.BATCH ? m.list : [m]) {
        sc.msgs.push(x);
        if (x.t === MSG.WELCOME) { sc.store.reset(x); resolve(x); } else if (x.t === MSG.DELTA || x.t === MSG.REJ || x.t === MSG.ACK) sc.store.onServer(x);
        else if (x.t === MSG.DENY) reject(new Error(`deny ${x.code}`));
      }
    });
    ws.once('open', () => ws.send(JSON.stringify({ t: MSG.HELLO, proto: PROTOCOL_VERSION, ...hello })));
    ws.once('error', reject);
  });
  sc.until = async (pred, ms = 15_000) => {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error('timeout');
      await sleep(10);
    }
  };
  return sc;
}

for (const sig of ['SIGTERM', 'SIGKILL']) {
  test(`SV-01: actions predicted during a restart (${sig}) are re-sent on the new welcome and applied exactly once`, async () => {
    const dir = tmpDataDir('qa2-sv01');
    const procs = [];
    try {
      const a = spawnServer(dir, { HH_AWAY_GRACE_MS: '0' });
      procs.push(a);
      const sc = storeClient();
      sc.store.cid = 'tabone';
      const w0 = await sc.connect(await a.port, { cid: 'tabone', claim: { slot: 'p1', name: 'Rowan' } });
      const [A, B, C] = emptyPlots(w0.state, 3);
      // 1: confirmed before the restart
      assert.equal(sc.store.act('plant', { ids: [A], crop: 'wheat' }).ok, true);
      await sc.until(() => sc.store.pending.length === 0);
      // 2: applied by the server, but its delta never reached this tab (the restart cut the socket first)
      const deliver = sc.store.onServer.bind(sc.store);
      sc.store.onServer = () => {};
      assert.equal(sc.store.act('plant', { ids: [B], crop: 'wheat' }).ok, true);
      await sc.until(() => sc.msgs.some((m) => m.t === MSG.DELTA && m.seq === 2));
      sc.store.onServer = deliver;
      a.child.kill(sig);
      await a.exit;
      const before = readJournal(dir).filter((l) => l.type === 'plant' && l.cid === 'tabone').map((l) => l.seq);
      assert.deepEqual(before, [1, 2], 'both were journaled before the restart');
      await sc.until(() => sc.ws.readyState === WebSocket.CLOSED);
      // 3: clicked while the server was down (predicted, shown as done, pending)
      assert.equal(sc.store.act('plant', { ids: [C], crop: 'wheat' }).ok, true);
      assert.equal(sc.store.pending.length, 2);
      assert.equal(sc.store.state.farm.objects[C].crop.def, 'wheat', 'the tab shows it done');
      const b = spawnServer(dir, { HH_AWAY_GRACE_MS: '0' });
      procs.push(b);
      const w1 = await sc.connect(await b.port, { cid: 'tabone', token: w0.token });
      // the facts a stale tab decides on (CL-02): same rules -> re-send, then reload
      assert.equal(w1.known, true, 'the server still knows this tab');
      assert.equal(w1.lastSeq, 2, 'seq 2 was applied before the restart: settled, never re-run');
      // (spawned servers hash shared/ at their own boot: compared with this process's constants only in the test above,
      // so an edit to shared/ while the suite runs cannot fail this one)
      assert.equal(typeof w1.contentHash, 'string');
      assert.ok(Number.isSafeInteger(w1.rulesVersion), 'rulesVersion on the welcome after the restart');
      await sc.until(() => sc.store.pending.length === 0);
      const st = sc.store.state;
      for (const id of [A, B, C]) assert.equal(st.farm.objects[id].crop && st.farm.objects[id].crop.def, 'wheat', `${id} planted`);
      b.child.kill('SIGTERM');
      await b.exit;
      // the boot's snapshot + backup moved lines 1-2 out of the journal: what is left is this server's own lines
      const after = readJournal(dir).filter((l) => l.type === 'plant' && l.cid === 'tabone').map((l) => l.seq);
      assert.deepEqual(after, [3], 'only the action clicked during the restart ran on the new server (seq 2 not twice)');
      assert.equal(sc.msgs.filter((m) => m.t === MSG.REJ).length, 0);
    } finally {
      for (const p of procs) if (p.child.exitCode === null && p.child.signalCode === null) p.child.kill('SIGKILL');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

// ---- SV-02: the ack tail; the server's share is measured and kept off the action path ------------------------------

test('SV-02: /api/status splits server time: act, output wait, due wake-ups, loop delay and snapshot cut/write', async () => {
  const s = await testServer();
  try {
    const { c } = await join(s.port, 'p1', 'Rowan');
    for (let seq = 1; seq <= 5; seq++) c.send({ t: MSG.ACT, seq, type: 'sell', args: { item: 'wheat', qty: 1 } });
    await c.next((m) => m.t === MSG.REJ && m.seq === 5);
    await s.hh.scheduler.save();
    await sleep(60);
    const st = await (await fetch(`http://127.0.0.1:${s.port}/api/status`)).json();
    assert.ok(st.perf, 'a perf block');
    assert.equal(st.perf.actMs.n, 5, 'one sample per act');
    assert.equal(st.perf.slowActs.length, 5);
    assert.ok(st.perf.slowActs.every((a) => a.type === 'sell' && a.ms >= 0), 'the slowest acts name their type');
    for (const k of ['p50', 'p90', 'p99', 'max']) assert.equal(typeof st.perf.actMs[k], 'number', `actMs.${k}`);
    assert.ok(st.perf.outWaitMs.n >= 1, 'every flushed batch of answers is timed');
    assert.ok(st.perf.outWaitMs.max <= 1000);
    assert.ok(st.perf.loopMs.n >= 1, 'event-loop delay is sampled');
    assert.ok(st.perf.snapshot.n >= 1 && st.perf.snapshot.lastCutMs >= 0 && st.perf.snapshot.lastWriteMs >= 0 && st.perf.snapshot.bytes > 1000);
    c.close();
  } finally {
    await s.close();
  }
});

test('SV-02: HH_DEV state validation runs after the turn, never inside the commit in front of the delta', async () => {
  const { Engine, DEV_CHECK_MS } = await import('../server/engine.js');
  const { makeFarm } = await import('./helpers.js');
  const errors = [];
  const state = makeFarm({ players: ['p1'] });
  const order = [];
  const engine = new Engine({ state, server: { clock: {}, clients: {}, auth: {} }, clock: { now: () => Date.now() }, dev: true,
    log: { info() {}, warn() {}, error: (m, o) => { errors.push([m, o]); order.push('check'); } }, onDelta: () => order.push('delta') });
  engine.client('tstcid', 'p1', Date.now());
  const plot = emptyPlots(state, 1)[0];
  state.farm.objects.junk = { def: 'no_such_def', x: -50, z: -50 };   // an invariant the next check must report
  assert.equal(engine.act({ pid: 'p1', cid: 'tstcid' }, { seq: 1, type: 'plant', args: { ids: [plot], crop: 'wheat' } }), null);
  assert.ok(order.length >= 1 && !order.includes('check'), 'the deltas are out before any validation (no synchronous validateState)');
  await new Promise((r) => setImmediate(r));
  assert.equal(errors.length, 0, 'not even in the same turn: behind the Outbox tick');
  for (let i = 0; i < 200 && !errors.length; i++) await sleep(DEV_CHECK_MS);
  assert.equal(errors.length, 1, 'still checked, once');
  assert.equal(errors[0][0], 'invariant broken');
  assert.match(errors[0][1].after, /plant@v\d+/, 'names the action(s) of the turn');
});

test('SV-02: the snapshot cut never fdatasyncs on the event loop; the cut file is complete and its fd is closed', async () => {
  const { Persist } = await import('../server/persist.js');
  const dir = tmpDataDir('qa2-cut');
  const realSync = fs.fdatasyncSync;
  let syncCalls = 0;
  fs.fdatasyncSync = (...a) => { syncCalls++; return realSync(...a); };
  try {
    const p = new Persist(dir, { log: { info() {}, warn() {}, error() {} } });
    p.load();
    p.lastBackupAt = Date.now();                        // no backup in this test: the archive keeps every cut line
    p.openJournal();
    for (let v = 1; v <= 4; v++) p.append({ v, type: 'x' });
    const fds = () => fs.readdirSync('/proc/self/fd').length;
    const saving = p.snapshot(() => ({ state: { schema: 1 }, server: {}, version: 4 }));
    assert.equal(syncCalls, 0, 'no fdatasyncSync in the synchronous cut');
    await saving;
    const n0 = fds();
    p.append({ v: 5, type: 'x' });
    await p.snapshot(() => ({ state: { schema: 1 }, server: {}, version: 5 }));
    for (let i = 0; i < 300 && fds() > n0; i++) await sleep(10);          // the async sync + close (a busy disk)
    assert.ok(fds() <= n0, `the cut journal fds are closed once synced (${fds()} > ${n0})`);
    assert.equal(syncCalls, 0);
    p.close();
    const again = new Persist(dir, { log: { info() {}, warn() {}, error() {} } }).load();
    assert.equal(again.snapshot.version, 5);
    const archive = fs.readFileSync(`${dir}/farm.journal.archive.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l).v);
    assert.deepEqual(archive, [1, 2, 3, 4, 5], 'every cut line reached the archive');
  } finally {
    fs.fdatasyncSync = realSync;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- SV-03: a cold load asked for every model and sound one by one; a family (or the sounds) comes as one pack -----

/** A throwaway tree: index.html, two model families and two sounds (never the repo's own public/). */
function packRoot() {
  const root = tmpDataDir('qa2-packs');
  const w = (rel, data) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), data); };
  w('public/index.html', '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  w('public/assets/models/crops/wheat.glb', Buffer.alloc(3000, 1));
  w('public/assets/models/crops/corn.glb', Buffer.alloc(5000, 2));
  w('public/assets/models/crops/manifest.json', '{}');                       // not a member: only .glb
  w('public/assets/models/trees/apple.glb', Buffer.alloc(4000, 3));
  w('public/assets/audio/chime.ogg', crypto.randomBytes(2000));               // incompressible, like Opus
  w('public/assets/audio/chime.wav', Buffer.alloc(9000, 4));                  // the WAV fallback stays a single file
  w('public/assets/audio/pop.ogg', crypto.randomBytes(1000));
  return root;
}

async function serve(st) {
  const app = express();
  app.use(st.serveIndex());
  app.use(st.servePacks());
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const get = (p, headers = {}) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  return { get, close: () => new Promise((r) => server.close(r)) };
}

const indexOf = (html) => JSON.parse(/<script type="application\/json" id="hh-packs">([\s\S]*?)<\/script>/.exec(html)[1]);

test('SV-03: index.html carries the pack index; each pack is its members back to back, served immutable (gzip if smaller)', async () => {
  const root = packRoot();
  const st = new StaticFiles({ root, log: quiet });
  const s = await serve(st);
  try {
    assert.deepEqual(packSpecs(root).map((x) => x.id), ['models-crops', 'models-trees', 'audio']);
    const ix = indexOf(String((await s.get('/')).body));
    assert.deepEqual(Object.keys(ix).sort(), ['audio', 'models-crops', 'models-trees']);
    assert.deepEqual(Object.keys(ix['models-crops'].files), ['corn.glb', 'wheat.glb'], 'members in name order, .glb only');
    assert.deepEqual(Object.keys(ix.audio.files), ['chime.ogg', 'pop.ogg'], 'the Ogg sounds only');
    for (const [id, p] of Object.entries(ix)) {
      const raw = await s.get(`/assets/packs/${id}.bin?v=${p.v}`);
      assert.equal(raw.status, 200, id);
      assert.match(raw.headers['cache-control'], /immutable/);
      const plainBody = await s.get(`/assets/packs/${id}.bin?v=${p.v}`, { 'accept-encoding': 'identity' });
      for (const [name, [off, len]] of Object.entries(p.files)) {
        const file = fs.readFileSync(path.join(root, 'public', p.dir, name));
        assert.ok(plainBody.body.subarray(off, off + len).equals(file), `${id}/${name} sliced back byte for byte`);
      }
      const gz = await s.get(`/assets/packs/${id}.bin?v=${p.v}`, { 'accept-encoding': 'gzip' });
      if (id === 'audio') assert.equal(gz.headers['content-encoding'], undefined, 'Opus does not shrink: sent as is');
      else {
        assert.equal(gz.headers['content-encoding'], 'gzip');
        assert.ok(zlib.gunzipSync(gz.body).equals(plainBody.body));
      }
      const again = await s.get(`/assets/packs/${id}.bin?v=${p.v}`, { 'if-none-match': gz.headers.etag, 'accept-encoding': 'gzip' });
      assert.equal(again.status, 304, 'revalidates by ETag');
    }
    assert.equal((await s.get('/assets/packs/nope.bin?v=1')).status, 404);
    assert.equal((await s.get('/assets/packs/models-crops.bin')).headers['cache-control'], 'no-cache', 'no v: the newest, revalidated');
  } finally {
    await s.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SV-03: a rebuilt model changes only its family\'s pack; the old version answers 404 (its offsets no longer hold)', async () => {
  const root = packRoot();
  const st = new StaticFiles({ root, log: quiet });
  const s = await serve(st);
  try {
    const ix1 = indexOf(String((await s.get('/')).body));
    assert.equal((await s.get(`/assets/packs/models-crops.bin?v=${ix1['models-crops'].v}`)).status, 200);
    const f = path.join(root, 'public/assets/models/crops/wheat.glb');
    fs.writeFileSync(f, Buffer.alloc(3500, 9));
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(f, t, t);
    const ix2 = indexOf(String((await s.get('/')).body));
    assert.notEqual(ix2['models-crops'].v, ix1['models-crops'].v, 'the page names the new crops pack');
    assert.deepEqual(ix2['models-crops'].files['wheat.glb'], [5000, 3500]);
    assert.equal(ix2['models-trees'].v, ix1['models-trees'].v, 'other families keep their cached pack');
    assert.equal((await s.get(`/assets/packs/models-crops.bin?v=${ix1['models-crops'].v}`)).status, 404, 'stale offsets: the loader falls back');
    const fresh = await s.get(`/assets/packs/models-crops.bin?v=${ix2['models-crops'].v}`, { 'accept-encoding': 'identity' });
    assert.ok(fresh.body.subarray(5000, 8500).equals(fs.readFileSync(f)));
  } finally {
    await s.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SV-03: the real tree packs every model family and the sounds; the page index matches the files on disk', () => {
  const st = new StaticFiles({ root: ROOT, log: quiet });
  const ix = indexOf(String(st.indexHtml().body));
  const fams = fs.readdirSync(path.join(ROOT, 'public/assets/models'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `models-${e.name}`);
  for (const id of [...fams, 'audio']) assert.ok(ix[id], `${id} is packed`);
  const glbs = fams.reduce((n, id) => n + Object.keys(ix[id].files).length, 0);
  const all = fs.readdirSync(path.join(ROOT, 'public/assets/models'), { recursive: true }).filter((n) => String(n).endsWith('.glb'));
  // wave 4: a variant (`<key>-<variant>.glb`, an upgrade tier or a pet breed) loads on its own when a farm shows it
  const onDisk = all.filter((n) => !path.basename(String(n)).includes('-')).length;
  assert.equal(glbs, onDisk, 'every GLB but the variants is in exactly one pack');
  for (const id of fams) assert.ok(Object.keys(ix[id].files).every((n) => !n.includes('-')), `${id}: no variant packed`);
  assert.equal(Object.keys(ix.audio.files).length, fs.readdirSync(path.join(ROOT, 'public/assets/audio')).filter((n) => n.endsWith('.ogg')).length);
});

// ---- the live service runs server/index.js through a symlink (a deploy that switches a symlink between snapshots) ---------------------

test('server/index.js starts when it is run through a symlinked checkout, with or without --preserve-symlinks-main', async () => {
  const { isEntry } = await import('../server/index.js');
  const dir = tmpDataDir('qa2-live');
  const link = path.join(dir, 'live');
  fs.symlinkSync(ROOT, link);
  const procs = [];
  try {
    assert.equal(isEntry(path.join(link, 'server/index.js'), path.join(ROOT, 'server/index.js')), true, 'same file by real path');
    assert.equal(isEntry(path.join(ROOT, 'server/config.js'), path.join(ROOT, 'server/index.js')), false);
    assert.equal(isEntry(undefined), false);
    for (const flags of [[], ['--preserve-symlinks-main']]) {
      const data = path.join(dir, `data${flags.length}`);
      fs.mkdirSync(data);
      const { spawn } = await import('node:child_process');
      const child = spawn(process.execPath, [...flags, path.join(link, 'server/index.js')], {
        env: { ...process.env, PORT: '0', HH_HOST: '127.0.0.1', HH_DATA_DIR: data, HH_DEV: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
      procs.push(child);
      let out = '';
      const exited = new Promise((r) => child.once('exit', (code) => r(code)));
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      const started = await Promise.race([
        (async () => { while (!/http:\/\/localhost:\d+/.test(out)) await sleep(20); return true; })(),
        exited.then((code) => `exited ${code} without starting: ${out.slice(-300)}`),
        sleep(20_000).then(() => 'no banner in 20 s'),
      ]);
      assert.equal(started, true, `node ${flags.join(' ')} <symlink>/server/index.js`);
      child.kill('SIGTERM');
      assert.equal(await exited, 0, 'a clean SIGTERM shutdown');
    }
  } finally {
    for (const c of procs) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
