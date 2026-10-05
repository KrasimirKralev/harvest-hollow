// PROOF (RED on M0): regenValue() loses a unit when `now` is earlier than `at` (a client whose clock estimate is a
// few ms behind the server that wrote `at`), so the client predicts / displays less than it has.
// Run: node --test docs/design/review-m0-proofs/05-regen-negative.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regenValue, regenSpend } from '../../../shared/rules/time.js';

test('a regenerating value never drops below the stored amount', () => {
  const r = { amount: 5, at: 1_000_000 };            // written by the server at its now = 1_000_000
  const clientNow = 1_000_000 - 3;                   // client estimate 3 ms behind (normal on a LAN)
  const v = regenValue(r, 20, 60_000, clientNow);
  console.log('stored 5, client sees', v);
  assert.equal(v, 5);
});

test('spending at the boundary on a lagging client keeps the amount consistent', () => {
  const r = { amount: 1, at: 1_000_000 };
  const v = regenValue(r, 20, 60_000, 999_999);
  console.log('stored 1, local check sees', v, '-> a 1-unit spend is refused locally (would pass on the server)');
  const after = regenSpend(r, 20, 60_000, 999_999, 0);
  console.log('regenSpend(.., n=0) ->', after);
  assert.equal(v, 1);
  assert.ok(after.at <= 999_999 + 60_000 && after.amount === 1);
});
