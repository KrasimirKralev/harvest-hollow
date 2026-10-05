// PROOF (review-m0 H1): a slot claimed within one snapshot interval (30 s) before a crash is locked out
// for good. `_join` is journaled, but the token hash (server.auth) lives only in the snapshot, so replay
// recreates the player without a way to resume it: the saved token is BAD_TOKEN and a re-claim is
// SLOT_TAKEN. README: "kill -9 loses nothing".
// Run: node --test docs/design/review-m0-sync-proofs/auth-crash.proof.mjs   (spawns servers on port 3302)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, tmpDataDir, join, wsClient } from '../../../test/helpers.js';
import { MSG } from '../../../shared/net/protocol.js';

const PORT = 3302;

function spawnServer(dataDir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    env: { ...process.env, PORT: String(PORT), HH_HOST: '127.0.0.1', HH_DATA_DIR: dataDir, HH_DEV: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { out += d; if (out.includes(`localhost:${PORT}`)) resolve(); });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => reject(new Error(`server exited ${code}: ${out}`)));
  });
  const exited = new Promise((r) => child.once('exit', r));
  return { child, ready, exited };
}

test('a farmer who claimed a slot, played 1 action and then the server was SIGKILLed can resume', async () => {
  const dataDir = tmpDataDir('proof-auth');
  try {
    const a = spawnServer(dataDir);
    await a.ready;
    const { c, w } = await join(PORT, 'p1', 'Rowan');
    assert.equal(w.t, MSG.WELCOME);
    c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    await c.next((m) => m.t === MSG.DELTA && m.seq === 1);
    a.child.kill('SIGKILL');
    await a.exited;

    const b = spawnServer(dataDir);
    await b.ready;
    try {
      const r = await wsClient(PORT);
      r.send({ t: 'hello', proto: 1, cid: 'p1cid2', token: w.token });
      const resume = await r.next((m) => m.t === MSG.WELCOME || m.t === MSG.DENY);
      r.send({ t: 'hello', proto: 1, cid: 'p1cid3', claim: { slot: 'p1', name: 'Rowan' } });
      const reclaim = await r.next((m) => m.t === MSG.WELCOME || m.t === MSG.DENY);
      const snap = JSON.parse(fs.readFileSync(path.join(dataDir, 'farm.json'), 'utf8'));
      console.log(`OBSERVED resume=${resume.t}/${resume.code} reclaim=${reclaim.t}/${reclaim.code}`
        + ` players=${Object.keys(snap.state.players)} auth=${JSON.stringify(Object.keys(snap.server.auth))}`
        + ` plantedSurvived=${Boolean(snap.state.farm.objects['home.0.0'].crop)}`);
      r.close();
      assert.equal(resume.t, MSG.WELCOME, 'the saved token resumes the slot after the crash');
    } finally {
      b.child.kill('SIGTERM');
      await b.exited;
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
