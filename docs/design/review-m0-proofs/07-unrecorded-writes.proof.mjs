// PROOF (RED on M0): tx.get() and check(state) hand out LIVE state objects. A rule that writes through them
// (an easy slip for 7 parallel authors) is applied on the server but recorded in neither ops nor undo, so
// clients never see it, rollback cannot restore it, and nothing in runAction or the test helpers notices.
// Run: node --test docs/design/review-m0-proofs/07-unrecorded-writes.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tx, applyOps } from '../../../shared/rules/tx.js';
import { makeFarm, must, plain } from '../../../test/helpers.js';

test('a write through tx.get() is either refused or recorded', () => {
  const s = makeFarm();
  const before = plain(s);
  const tx = new Tx(s);
  const plot = tx.get(['farm', 'objects', 'home.0.0']);
  plot.cycle += 1;                                  // looks innocent; bypasses the recorder
  tx.inc(['farm', 'wallet', 'coins'], 1);
  const client = structuredClone(before);
  applyOps(client, tx.ops);
  console.log('server cycle', s.farm.objects['home.0.0'].cycle, '| client cycle', client.farm.objects['home.0.0'].cycle);
  tx.rollback();
  console.log('after rollback cycle', s.farm.objects['home.0.0'].cycle, '(was', before.farm.objects['home.0.0'].cycle, ')');
  assert.deepEqual(plain(s), before, 'rollback did not restore the unrecorded write');
});

test('the shared test helpers verify every action round-trips (ops replay == state, undo == before)', () => {
  // must() is what every lane's tests use. It should fail loudly on an unrecorded write; today it only runs
  // the action. Evidence: its source has no applyOps / inverse round-trip check.
  const src = must.toString();
  console.log(src);
  assert.match(src, /applyOps|inverse/, 'must() does not check that the action was fully recorded');
});
