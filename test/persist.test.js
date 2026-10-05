// Persistence: snapshot + journal round trip, crash safety, corrupt-file recovery (tech §5, §9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Persist } from '../server/persist.js';
import { loadFarm } from '../server/index.js';
import { MSG, PROTOCOL_VERSION } from '../shared/net/protocol.js';
import { validateState } from '../shared/rules/state.js';
import { ROOT, testServer, wsClient, join, tmpDataDir, plain, coopHarness } from './helpers.js';

const quiet = { log() {}, info() {}, warn() {}, error() {} };

test('Persist: lines after a snapshot cut land in the new journal; load returns only newer lines', async () => {
  const dir = tmpDataDir('cut');
  try {
    const p = new Persist(dir, { log: quiet });
    p.load();
    p.openJournal();
    for (let v = 1; v <= 3; v++) p.append({ v, type: 'x' });
    const state = { schema: 1, n: 3 };
    const saving = p.snapshot(() => ({ state, server: {}, version: 3 }));
    p.append({ v: 4, type: 'x' });                       // accepted while the write is in flight
    await saving;
    p.close();
    const again = new Persist(dir, { log: quiet }).load();
    assert.equal(again.snapshot.version, 3);
    assert.deepEqual(again.lines.map((l) => l.v), [4]);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('upto')), [], 'redundant cut removed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Persist: a torn last journal line is skipped, duplicates dedupe by v', () => {
  const dir = tmpDataDir('torn');
  try {
    fs.writeFileSync(path.join(dir, 'farm.journal.upto-0.jsonl'), '{"v":1,"a":1}\n{"v":2,"a":1}\n');
    fs.writeFileSync(path.join(dir, 'farm.journal.jsonl'), '{"v":2,"a":2}\n{"v":3}\n{"v":4,"tor');
    const { lines, warnings } = new Persist(dir, { log: quiet }).load();
    assert.deepEqual(lines.map((l) => l.v), [1, 2, 3]);
    assert.equal(lines[1].a, 2, 'the live journal wins over an older cut');
    assert.deepEqual(warnings, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('round trip: actions survive a clean restart; tokens resume', async () => {
  const s1 = await testServer({ keep: true });
  const { dataDir } = s1;
  try {
    const { c, w } = await join(s1.port, 'p1', 'Rowan');
    c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    c.send({ t: 'act', seq: 2, type: 'plant', args: { id: 'home.0.1', crop: 'wheat' } });
    await c.next((m) => (m.t === MSG.DELTA || m.t === MSG.REJ) && m.seq === 2).then((m) => assert.equal(m.t, MSG.DELTA, m.code));
    const before = plain(s1.hh.engine.state);
    c.close();
    await s1.close();
    const s2 = await testServer({ dataDir });
    try {
      const r = await wsClient(s2.port);
      r.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'p1cid1', token: w.token });
      const w2 = await r.next((m) => m.t === MSG.WELCOME);
      assert.equal(w2.lastSeq, 2, 'dedupe survives the restart');
      assert.equal(w2.state.farm.objects['home.0.0'].crop.def, 'wheat');
      assert.deepEqual({ ...plain(w2.state), meta: null, players: null }, { ...before, meta: null, players: null });
      r.close();
    } finally {
      await s2.close();
    }
  } finally {
    await s1.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function spawnServer(dataDir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    env: { ...process.env, PORT: '0', HH_HOST: '127.0.0.1', HH_DATA_DIR: dataDir, HH_DEV: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const port = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      out += d;
      const m = /http:\/\/localhost:(\d+)/.exec(out);
      if (m) resolve(Number(m[1]));
    });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => reject(new Error(`server exited ${code}: ${out}`)));
  });
  return { child, port, log: () => out };
}

test('crash test: SIGKILL after N acknowledged actions loses nothing', async () => {
  const dataDir = tmpDataDir('crash');
  try {
    const a = spawnServer(dataDir);
    const portA = await a.port;
    const { c, w } = await join(portA, 'p1', 'Rowan');
    const N = 25;
    for (let i = 1; i <= N; i++) c.send({ t: 'act', seq: i, type: i % 2 ? 'plant' : 'sell', args: i % 2 ? { id: `home.0.${(i >> 1) % 8}`, crop: 'wheat' } : { item: 'wheat', qty: 1 } });
    const deltas = [];
    for (let i = 0; i < N; i++) {
      const m = await c.next((x) => x.t === MSG.DELTA || x.t === MSG.REJ);
      if (m.t === MSG.DELTA) deltas.push(m);
    }
    const v = deltas.at(-1).v;
    a.child.kill('SIGKILL');
    await new Promise((r) => a.child.once('exit', r));
    const b = spawnServer(dataDir);
    const portB = await b.port;
    try {
      const st = await (await fetch(`http://127.0.0.1:${portB}/api/status`)).json();
      // Every acknowledged action, plus the `_seen` the boot runs for the farmer the crash left "online" (SV-01).
      assert.equal(st.v, v + 1, `state at version ${v} after the crash, then the boot's _seen`);
      const snap = JSON.parse(fs.readFileSync(path.join(dataDir, 'farm.json'), 'utf8'));
      assert.equal(snap.version, v + 1, 'boot snapshots the replayed state at once');
      assert.ok(snap.state.players.p1.lastSeenAt >= deltas.at(-1).now, 'lastSeenAt is the crash, not the claim');
      assert.deepEqual(validateState(snap.state), []);
      // Rejections are not journaled, so replay rebuilds lastSeq as the newest ACCEPTED seq (tech §3.7).
      assert.equal(snap.server.clients.p1cid1.lastSeq, deltas.at(-1).seq);
      // The slot claimed seconds before the kill can be resumed: its token hash rode on the `_join` line
      // (review-m0 H1). Before the fix: BAD_TOKEN, then SLOT_TAKEN on a re-claim, a permanent lockout.
      const r = await wsClient(portB);
      r.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'p1cid2', token: w.token });
      const resume = await r.next((m) => m.t === MSG.WELCOME || m.t === MSG.DENY);
      assert.equal(resume.t, MSG.WELCOME, `resume after the crash: ${resume.code}`);
      assert.equal(resume.pid, 'p1');
      r.close();
    } finally {
      b.child.kill('SIGTERM');
      await new Promise((r) => b.child.once('exit', r));
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a corrupt snapshot falls back to the newest backup and files an incident', async () => {
  const s1 = await testServer({ keep: true });
  const { dataDir } = s1;
  try {
    const { c } = await join(s1.port, 'p1', 'Rowan');
    c.close();
    await s1.close();
    assert.equal(fs.readdirSync(path.join(dataDir, 'backups')).length, 1);
    fs.writeFileSync(path.join(dataDir, 'farm.json'), '{ this is not json');
    for (const f of fs.readdirSync(dataDir)) if (f.includes('journal')) fs.rmSync(path.join(dataDir, f));
    const p = new Persist(dataDir, { log: quiet });
    const { engine } = loadFarm(p, { log: quiet });
    assert.ok(engine.state.farm.objects['home.0.0']);
    assert.ok(fs.readdirSync(path.join(dataDir, 'incidents')).some((f) => f.startsWith('farm.corrupt-')));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// ---- review-m0 H2 / #10: a journal that does not replay is quarantined, never silently cut -------------------
function crashedFarm(dir) {
  // a snapshot at v2 (two players joined) plus four acknowledged journal lines
  const h = coopHarness();
  const lines = [];
  h.engine.journal = { append: (l) => lines.push(structuredClone(l)) };
  const snap = { schema: h.state.schema, savedAt: 0, version: h.engine.v, state: structuredClone(h.state), server: structuredClone(h.server) };
  const p1 = { pid: 'p1', cid: 'aaaaaa' };
  h.engine.act(p1, { seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
  h.clock.advance(60_000 - 200);                       // ripe only within the grace
  h.engine.act(p1, { seq: 2, type: 'harvest', args: { id: 'home.0.0' } });
  h.engine.act(p1, { seq: 3, type: 'sell', args: { item: 'wheat', qty: 2 } });
  h.engine.act(p1, { seq: 4, type: 'plant', args: { id: 'home.0.1', crop: 'wheat' } });
  fs.writeFileSync(path.join(dir, 'farm.json'), JSON.stringify(snap));
  const write = () => fs.writeFileSync(path.join(dir, 'farm.journal.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  write();
  return { h, lines, write };
}

test('journal lines carry grace and the content hash; replay decides with the journaled grace', () => {
  const dir = tmpDataDir('grace');
  try {
    const { h, lines, write } = crashedFarm(dir);
    assert.equal(lines[1].grace, 250);
    assert.match(lines[1].h, /^[0-9a-f]{8}$/);
    // The harvest was accepted 200 ms early under a 250 ms grace. Pretend that build ran a 400 ms grace and
    // the harvest came 300 ms early: today's config (250) would refuse it, the journaled grace accepts it.
    lines[1].grace = 400;
    lines[1].now -= 100;
    write();
    const { engine, replayed } = loadFarm(new Persist(dir, { log: quiet }), { log: quiet });
    assert.equal(replayed, 4);
    assert.equal(engine.v, h.engine.v);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a line that no longer replays stops the boot and quarantines every journal (review-m0 H2)', async () => {
  const dir = tmpDataDir('quarantine');
  try {
    const { h, lines, write } = crashedFarm(dir);
    lines[1].now -= 100;                               // the harvest is now NOT_READY on replay
    write();
    assert.throws(() => loadFarm(new Persist(dir, { log: quiet }), { log: quiet }), /HH_REPLAY_ANYWAY/);
    const inc = fs.readdirSync(path.join(dir, 'incidents')).filter((f) => f.endsWith('-replay'));
    assert.equal(inc.length, 1);
    const kept = fs.readFileSync(path.join(dir, 'incidents', inc[0], 'farm.journal.jsonl'), 'utf8');
    assert.equal(kept.trim().split('\n').length, 4, 'every acknowledged line is kept');
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'incidents', inc[0], 'info.json'), 'utf8'));
    assert.equal(info.remaining, 3);
    assert.ok(fs.existsSync(path.join(dir, 'farm.journal.jsonl')), 'nothing on disk was touched');
    // The owner accepts the loss explicitly: the server boots at the last good version.
    const s = await testServer({ dataDir: dir, keep: true, replayAnyway: true });
    try {
      // The farm stops at the last good line (the first plant); the boot may then catch up time-driven system
      // actions (a new farm day, debris regrowth), so `v` can be higher, never lower.
      const objs = s.hh.engine.state.farm.objects;
      assert.ok(objs['home.0.0'].crop, 'the dropped harvest did not happen');
      assert.equal(objs['home.0.1'].crop, null, 'nor the second planting');
      assert.ok(s.hh.engine.v >= h.engine.v - 3);
    } finally {
      await s.close();
    }
    const again = fs.readdirSync(path.join(dir, 'incidents')).filter((f) => f.endsWith('-replay'));
    assert.equal(again.length, 2, 'the anyway-boot quarantined its copy too');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an inherited journal cut is deleted only after a complete replay', async () => {
  const p = new Persist(tmpDataDir('inherit'), { log: quiet });
  try {
    fs.writeFileSync(path.join(p.dir, 'farm.journal.upto-5.jsonl'), '{"v":6}\n');
    p.load();
    p.openJournal();
    await p.snapshot(() => ({ state: { schema: 2 }, server: {}, version: 9 }));
    assert.ok(fs.existsSync(path.join(p.dir, 'farm.journal.upto-5.jsonl')), 'kept: nobody replayed it');
    p.adoptInherited();
    await p.snapshot(() => ({ state: { schema: 2 }, server: {}, version: 9 }));
    assert.ok(!fs.existsSync(path.join(p.dir, 'farm.journal.upto-5.jsonl')));
    p.close();
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('a failed append leaves no torn line in the journal (review-m0 M6)', () => {
  const dir = tmpDataDir('torn-append');
  try {
    const p = new Persist(dir, { log: quiet });
    p.load();
    p.openJournal();
    p.append({ v: 1, type: 'x' });
    const realWrite = fs.writeSync;
    fs.writeSync = (fd, buf) => realWrite(fd, buf.subarray(0, 5));   // a short write (disk full mid-line)
    try {
      assert.throws(() => p.append({ v: 2, type: 'x' }), /short journal write/);
    } finally {
      fs.writeSync = realWrite;
    }
    p.append({ v: 2, type: 'y' });
    p.close();
    const { lines, warnings } = new Persist(dir, { log: quiet }).load();
    assert.deepEqual(lines.map((l) => [l.v, l.type]), [[1, 'x'], [2, 'y']]);
    assert.deepEqual(warnings, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
