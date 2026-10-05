// PROOF (review-m0 L1): ClockSync picks the min-RTT sample of the last 8 regardless of AGE, so after a
// discontinuity of the client's monotonic clock (OS suspend with the socket still alive: Chrome's
// performance.now() does not advance during suspend on Linux/macOS, w3c/hr-time#115) an old low-RTT
// sample keeps the stale offset for up to 8 more samples (~80 s at PING_EVERY_MS = 10 s). Timers on
// screen and every prediction (plant readyAt, the local NOT_READY check) are off by the suspend length.
// Run: node --test docs/design/review-m0-sync-proofs/clock-stale.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClockSync } from '../../../shared/net/clock.js';

test('a consistent 20 s offset change is adopted within two samples', () => {
  const k = new ClockSync();
  const server = (perf, shift) => 1_790_000_000_000 + perf + shift;
  let perf = 1000;
  for (let i = 0; i < 6; i++) { k.add(perf, server(perf + 1, 0), perf + 2); perf += 200; }   // 2 ms RTT burst
  const shift = 20_000;                           // 20 s suspend: perf did not move, server time did
  const errs = [];
  for (let i = 0; i < 4; i++) {
    perf += 10_000;
    k.add(perf, server(perf + 2, shift), perf + 4);  // normal 4 ms RTT samples after resume
    errs.push(server(perf + 4, shift) - k.serverNow(perf + 4));
  }
  console.log(`OBSERVED estimate error after each of 4 post-resume pings (ms): ${errs.join(', ')}`);
  assert.ok(Math.abs(errs[1]) < 50, 'adopted by the second sample');
});
