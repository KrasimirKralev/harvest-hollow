// PROOF (RED on M0): the soft-confirm round trip (tech §15.2) depends on every purchase action remembering to
// declare `confirm: V.opt(V.confirm)` in its own schema; today's purchase (`place`, which BIG_SPEND covers per
// GDD §6.3) does not, so the "Yes, buy it" resend is refused as BAD_ARGS. check() can also return only a bare code.
// Run: node --test docs/design/review-m0-proofs/12-soft-confirm.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS } from '../../../shared/rules/index.js';
import { makeFarm, run } from '../../../test/helpers.js';

test('a purchase resent with confirm: ["BIG_SPEND"] is not refused as BAD_ARGS', () => {
  const s = makeFarm();
  const r = run(s, 'place', { def: 'plot', x: 24, z: 33, rot: 0, confirm: ['BIG_SPEND'] });
  console.log('place + confirm ->', r.ok ? 'ok' : r.code);
  assert.equal(r.ok, true);
});

test('every player action accepts the optional confirm envelope', () => {
  const missing = Object.entries(ACTIONS).filter(([t, d]) => !t.startsWith('_') && !('confirm' in d.schema)).map(([t]) => t);
  console.log('player actions without confirm:', missing);
  assert.deepEqual(missing, []);
});
