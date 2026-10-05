// PROOF (RED on M0): object ids are fully client-chosen (cid at hello, any seq > lastSeq), and the farm seed is
// replicated, so any roll keyed on a NEW object id (ctx.newId) can be ground offline before sending.
// Run: node --test docs/design/review-m0-proofs/02-rng-grinding.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roll } from '../../../shared/rules/rng.js';
import { newId } from '../../../shared/net/ids.js';
import { coopHarness } from '../../../test/helpers.js';

test('the engine refuses seq jumps (a client may not pick its own seq)', () => {
  const h = coopHarness();
  const who = { pid: 'p1', cid: 'aaaaaa' };
  const a = h.engine.act(who, { seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
  const b = h.engine.act(who, { seq: 987654, type: 'plant', args: { id: 'home.0.1', crop: 'wheat' } });
  console.log('seq 1 ->', a ?? 'accepted', '| seq 987654 ->', b ?? 'accepted', '| lastSeq', h.server.clients.aaaaaa.lastSeq);
  assert.notEqual(b, null, 'seq 987654 after seq 1 was accepted: seq (and so newId) is client-chosen');
});

test('a 5 % roll keyed on the new object id can be forced by grinding seq offline', () => {
  const h = coopHarness();
  const farmSeed = h.a.store.state.meta.farmSeed;   // replicated to every client in `welcome`
  const cid = 'aaaaaa';
  let tries = 0;
  let seq = h.server.clients[cid].lastSeq;
  // e.g. Breeding Barn "golden coat 5 %" written the obvious way: ctx.rng('coat', ctx.newId(0)) < 0.05
  do { seq++; tries++; } while (roll(farmSeed, 'coat', newId(cid, seq, 0)) >= 0.05);
  console.log(`golden coat guaranteed with seq=${seq} after ${tries} offline tries (roll=${roll(farmSeed, 'coat', newId(cid, seq, 0)).toFixed(4)})`);
  assert.ok(tries > 1000, `a client can force a 5 % outcome in ${tries} local hashes`);
});
