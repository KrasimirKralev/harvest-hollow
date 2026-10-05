// PROOF (review-m0 H2): one journal line that fails on replay destroys every later line for good.
// loadFarm() stops at the failing line (correct), files ONLY that line as an incident, and then the boot
// snapshot rotates the whole journal to farm.journal.upto-<lastGoodV>.jsonl and deletes it as "redundant"
// (persist.js:176-179). Lines after the failure (accepted, acknowledged actions) exist nowhere afterwards.
// Realistic triggers: a content edit between a crash and the restart (unlock level, seed price, growMs),
// a non-deterministic rule, a migration bug, a gap left by a failed append (M6).
// Run: node --test docs/design/review-m0-sync-proofs/replay-failure.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { testServer, join } from '../../../test/helpers.js';
import { MSG } from '../../../shared/net/protocol.js';

const allText = (dir) => {
  let s = '';
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile() && !p.endsWith('.gz')) s += fs.readFileSync(p, 'utf8');
  }
  return s;
};

test('a replay failure keeps the lines after it (journal copied to incidents/, not deleted)', async () => {
  const s1 = await testServer({ keep: true });
  const { dataDir } = s1;
  try {
    const { c, cid } = await join(s1.port, 'p1', 'Rowan');
    c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    const d = await c.next((m) => m.t === MSG.DELTA && m.seq === 1);
    c.close();
    await s1.close();                                       // clean stop: snapshot at d.v, empty journal
    const v = d.v;
    const now = d.now + 1000;
    // What the crashed process had journaled after that snapshot:
    const lines = [
      { v: v + 1, now, pid: 'p1', cid, seq: 2, type: 'plant', args: { id: 'home.0.1', crop: 'wheat' }, ext: {} },
      // accepted under the old content; fails under the new (e.g. carrot's unlock level was raised)
      { v: v + 2, now, pid: 'p1', cid, seq: 3, type: 'plant', args: { id: 'home.0.2', crop: 'carrot' }, ext: {} },
      { v: v + 3, now, pid: 'p1', cid, seq: 4, type: 'plant', args: { id: 'home.0.3', crop: 'wheat' }, ext: {} },
      { v: v + 4, now, pid: 'p1', cid, seq: 5, type: 'plant', args: { id: 'home.0.4', crop: 'wheat' }, ext: {} },
    ];
    fs.writeFileSync(path.join(dataDir, 'farm.journal.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

    const s2 = await testServer({ dataDir, keep: true });
    const atV = s2.hh.engine.v;
    await s2.close();
    const text = allText(dataDir);
    const survivors = [v + 3, v + 4].filter((n) => text.includes(`"v":${n},`));
    console.log(`OBSERVED booted at v${atV} (journal had up to v${v + 4}); files now: ${fs.readdirSync(dataDir).join(', ')};`
      + ` incidents: ${fs.readdirSync(path.join(dataDir, 'incidents')).join(', ')};`
      + ` lines v${v + 3}/v${v + 4} still on disk: ${JSON.stringify(survivors)}`);
    assert.deepEqual(survivors, [v + 3, v + 4], 'the accepted actions after the failing line are kept somewhere');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
