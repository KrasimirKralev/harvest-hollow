// Crash safety at every step of a snapshot, and kill -9 while snapshots run constantly (lane brief item 3).
//
// A "crash" at step X: the fs call of step X throws synchronously (the process died there), the Persist object
// is abandoned, and a new boot on the same directory must hold every acknowledged action, exactly; and so must a
// boot of a copy whose farm.json is ALSO corrupt (newest backup + archive + journals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Persist } from '../server/persist.js';
import { loadFarm } from '../server/index.js';
import { validateState } from '../shared/rules/state.js';
import { MSG } from '../shared/net/protocol.js';
import { tmpDataDir, plain, quiet, sleep, join, spawnServer } from './helpers/server.js';

function boot(dir) {
  const persist = new Persist(dir, { log: quiet });
  const r = loadFarm(persist, { log: quiet, tz: 'Europe/Sofia' });
  r.engine.journal = persist;
  persist.openJournal();
  return { persist, ...r, save: () => persist.snapshot(() => ({ state: r.engine.state, server: r.engine.server, version: r.engine.v })) };
}

function plantSome(f, n) {
  if (!Object.hasOwn(f.engine.state.players, 'p1')) f.engine.system('_join', { pid: 'p1', name: 'Rowan' });
  f.engine.client('cidaaa', 'p1', f.clock.now());
  const rec = f.engine.server.clients.cidaaa;
  const ids = Object.keys(f.engine.state.farm.objects).filter((id) => f.engine.state.farm.objects[id].def === 'plot'
    && f.engine.state.farm.objects[id].crop === null).sort().slice(0, n);
  for (const id of ids) assert.equal(f.engine.act({ pid: 'p1', cid: 'cidaaa' }, { seq: rec.lastSeq + 1, type: 'plant', args: { id, crop: 'wheat' } }), null);
}

/** Make the n-th call (1-based) of fsp[name] throw synchronously, as if the process died there. */
function dieAt(name, n, filter = () => true) {
  const real = fsp[name];
  let calls = 0;
  fsp[name] = function patched(...a) {
    if (filter(...a) && ++calls === n) throw Object.assign(new Error(`CRASH in ${name}`), { code: 'CRASH' });
    return real.apply(this, a);
  };
  return () => { fsp[name] = real; };
}

const snapPath = (p) => String(p).endsWith('farm.json.tmp') || String(p).endsWith('farm.json');
const POINTS = [
  ['before the snapshot temp file is written', 'open', 1, (p) => snapPath(p)],
  ['after the temp file, before the rename', 'rename', 1, (p) => snapPath(p)],
  ['after the rename, before the directory fsync', 'open', 2, () => true],
  ['while archiving the journal cut', 'appendFile', 1, () => true],
  ['after archiving, before deleting the cut', 'unlink', 1, (p) => String(p).includes('upto-')],
  ['while writing the backup', 'rename', 1, (p) => String(p).includes('backups')],
];

for (const [label, fn, nth, filter] of POINTS) {
  test(`a crash ${label} loses nothing`, async () => {
    const dir = tmpDataDir('crashpt');
    const copy = `${dir}-corrupt`;
    try {
      const f = boot(dir);
      plantSome(f, 2);
      await f.save();                                  // S1 + backup B1
      plantSome(f, 2);
      if (fn === 'rename' && filter('x/backups/y')) f.persist.lastBackupAt = 0;   // make this save write a backup
      const restore = dieAt(fn, nth, filter);
      try {
        await f.save().then(() => {
          if (fn !== 'rename' || !filter('x/backups/y')) assert.fail('the injected crash did not happen');
        }, (err) => assert.equal(err.code, 'CRASH'));
      } finally {
        restore();
      }
      const ref = { v: f.engine.v, state: plain(f.engine.state) };
      if (f.persist.fd !== null) fs.closeSync(f.persist.fd);   // the process is gone: no final snapshot
      fs.cpSync(dir, copy, { recursive: true });
      fs.writeFileSync(path.join(copy, 'farm.json'), '{ corrupt');
      for (const d of [dir, copy]) {
        const g = boot(d);
        assert.equal(g.engine.v, ref.v, `${d === dir ? 'normal boot' : 'corrupt farm.json'}: version`);
        assert.deepEqual(plain(g.engine.state), ref.state);
        assert.deepEqual(validateState(g.engine.state, { now: g.clock.now() }), []);
        // and the recovered farm keeps working and saving
        plantSome(g, 1);
        await g.save();
        g.persist.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });
}

test('kill -9 at random moments while snapshots run every 15 ms: every acknowledged action survives', async () => {
  for (const killAfter of [7, 23]) {
    const dataDir = tmpDataDir('kill9');
    try {
      const a = spawnServer(dataDir, { HH_SNAPSHOT_MS: '15', HH_DEV: '1' });
      const port = await a.port;
      const { c } = await join(port, 'p1', 'Rowan', 'killer');
      const plots = Object.keys((await (async () => {
        c.send({ t: 'resync' });
        return (await c.next((m) => m.t === MSG.WELCOME)).state;
      })()).farm.objects).filter((id) => id.startsWith('home.0.'));
      let lastAck = 0;
      let acked = 0;
      let seq = 0;
      const warp = () => fetch(`http://127.0.0.1:${port}/api/dev/warp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ms":86400000}' });
      for (let round = 0; acked < killAfter && round < 20; round++) {
        for (const id of plots) c.send({ t: 'act', seq: ++seq, type: 'plant', args: { id, crop: 'wheat' } });
        await sleep(5);
        await warp();
        for (const id of plots) c.send({ t: 'act', seq: ++seq, type: 'harvest', args: { id } });
        const end = Date.now() + 300;
        while (Date.now() < end && acked < killAfter) {
          const m = await c.next((x) => x.t === MSG.DELTA || x.t === MSG.REJ, 300).catch(() => null);
          if (!m) break;
          if (m.t === MSG.DELTA) { lastAck = m.v; acked++; }
        }
      }
      a.child.kill('SIGKILL');
      await a.exit;
      assert.ok(acked >= 1, 'actions were acknowledged before the kill');
      const b = spawnServer(dataDir);
      try {
        await b.port;
        const st = await (await fetch(`http://127.0.0.1:${await b.port}/api/status`)).json();
        assert.ok(st.v >= lastAck, `v ${st.v} >= last acknowledged ${lastAck} (killed after ${acked} acks)`);
        const snap = JSON.parse(fs.readFileSync(path.join(dataDir, 'farm.json'), 'utf8'));
        assert.deepEqual(validateState(snap.state), []);
      } finally {
        b.child.kill('SIGTERM');
        await b.exit;
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }
});
