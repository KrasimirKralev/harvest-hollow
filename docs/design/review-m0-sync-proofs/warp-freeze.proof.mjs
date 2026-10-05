// PROOF (review-m0 M7): a dev time warp freezes the PRODUCTION game clock for the warped duration.
// `npm run dev` and `npm start` share ./data by default. A warp raises server.clock.lastNow (persisted in
// the snapshot); a non-dev boot zeroes devOffset (clock.js:294) but keeps lastNow, so now() returns the
// frozen lastNow until the wall clock catches up: with a 4 h warp nothing grows for 4 h, and the warp
// route accepts up to 400 days.
// Run: node --test docs/design/review-m0-sync-proofs/warp-freeze.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServerClock } from '../../../server/clock.js';

test('after a dev warp, a production boot on the same data dir has a running clock', () => {
  let wall = 1_790_000_000_000;
  const sidecar = { lastNow: 0, devOffset: 0 };
  const dev = new ServerClock(sidecar, { wall: () => wall, dev: true, log: { warn() {} } });
  dev.warp(4 * 3600 * 1000);                     // the designer tests a 4 h crop
  dev.now();
  const saved = JSON.parse(JSON.stringify(sidecar));   // snapshot on shutdown
  wall += 60_000;                                // restart a minute later with `npm start`
  const prod = new ServerClock(saved, { wall: () => wall, dev: false, log: { warn() {} } });
  const t1 = prod.now();
  wall += 10 * 60_000;                           // ten real minutes of play
  const t2 = prod.now();
  console.log(`OBSERVED game time advanced ${t2 - t1} ms during 600000 ms of real time`);
  assert.equal(t2 - t1, 600_000);
});

test('while game time is frozen (warp hangover or a wall clock stepped back), the partner avatar still moves', async () => {
  const { Presence } = await import('../../../server/presence.js');
  const { PresenceBuffer } = await import('../../../shared/net/interp.js');
  const frozen = { now: () => 1_790_000_000_000 };          // ServerClock.now() returns lastNow while frozen
  const sent = [];
  const p = new Presence(frozen, (m) => sent.push(m));
  p.join('p2');
  const buf = new PresenceBuffer();
  for (let i = 1; i <= 10; i++) {
    p.move('p2', { x: 20 + i * 0.1, z: 30, f: 0, a: 1 });
    p.flush();
    for (const m of sent.splice(0)) for (const [, x, z, f, a] of m.list) buf.push(m.ts, x, z, f, a);
  }
  console.log(`OBSERVED 10 walking steps relayed, partner buffer kept ${buf.s.length} sample(s) at x=${buf.s.map((s) => s.x)}`);
  assert.ok(buf.s.length > 1);
});
