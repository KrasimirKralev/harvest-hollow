// PROOF (RED on M0): journal lines carry no rules/content version and no `grace`; replay always uses the CURRENT
// code. After a crash followed by a code/content update (7 agents restart servers all day), a line that no longer
// applies stops replay and every later accepted action is silently dropped while the server keeps serving.
// Run: node --test docs/design/review-m0-proofs/11-replay-versioning.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Persist } from '../../../server/persist.js';
import { loadFarm } from '../../../server/index.js';
import { coopHarness } from '../../../test/helpers.js';

const quiet = { error() {}, warn() {}, info() {}, log() {} };

test('a journal line records what replay needs to be exact (content hash, grace)', () => {
  const h = coopHarness();
  const lines = [];
  h.engine.journal = { append: (l) => lines.push(l) };
  h.engine.act({ pid: 'p1', cid: 'aaaaaa' }, { seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
  console.log('journal line:', JSON.stringify(lines[0]));
  assert.ok('grace' in lines[0] || 'contentHash' in lines[0] || 'rules' in lines[0], 'nothing ties the line to the code that accepted it');
});

test('a line that no longer replays does not silently drop every later action', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-proof-'));
  const h = coopHarness();
  const lines = [];
  h.engine.journal = { append: (l) => lines.push(structuredClone(l)) };
  const snap = { schema: 1, savedAt: 0, version: h.engine.v, state: structuredClone(h.state), server: structuredClone(h.server) };
  const p1 = { pid: 'p1', cid: 'aaaaaa' };
  h.engine.act(p1, { seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
  h.clock.advance(60_000 - 200);                    // ripe within READY_GRACE_MS (250) only
  h.engine.act(p1, { seq: 2, type: 'harvest', args: { id: 'home.0.0' } });
  h.engine.act(p1, { seq: 3, type: 'sell', args: { item: 'wheat', qty: 2 } });
  h.engine.act(p1, { seq: 4, type: 'plant', args: { id: 'home.0.1', crop: 'wheat' } });
  // Simulate "the new build changed the rule" by replaying line 2 with a smaller grace, as a content update
  // to READY_GRACE_MS would (replay hard-codes SERVER_GRACE_MS = the CURRENT config value).
  lines[1].now -= 100;
  fs.writeFileSync(path.join(dir, 'farm.json'), JSON.stringify(snap));
  fs.writeFileSync(path.join(dir, 'farm.journal.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const persist = new Persist(dir, { log: quiet });
  const { engine, replayed } = loadFarm(persist, { log: quiet });
  const incidents = fs.readdirSync(path.join(dir, 'incidents'));
  console.log(`live v${h.engine.v}, booted v${engine.v}, replayed ${replayed}/${lines.length}, incidents: ${incidents}`);
  console.log('live coins', h.state.farm.wallet.coins, '| booted coins', engine.state.farm.wallet.coins,
    '| plot home.0.1 crop live', Boolean(h.state.farm.objects['home.0.1'].crop), 'booted', Boolean(engine.state.farm.objects['home.0.1'].crop));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(engine.v, h.engine.v, 'the server booted and kept serving with accepted actions missing');
});
