// PROOF (review-m0 M3): the presence relay makes a partner walking at a constant speed stutter.
// The real server Presence class and the real client PresenceBuffer are driven by a discrete-time
// simulation of the real avatar.js send rule (mv at most every 1000/PRESENCE_HZ ms, frame-quantized).
// Expected (tech §6.2): the receiver renders a constant 3 tiles/s walk. Observed: frames where the
// partner stands still or runs at ~2x, from (a) the "rest repeat" firing mid-walk and (b) every row being
// stamped with the flush time instead of the time the pose was true.
// Run: node --test docs/design/review-m0-sync-proofs/presence-stutter.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Presence } from '../../../server/presence.js';
import { PresenceBuffer } from '../../../shared/net/interp.js';
import { AVATAR_SPEED } from '../../../shared/content/config.js';
import { LIMITS } from '../../../shared/net/protocol.js';
import { mulberry32 } from '../../../test/helpers.js';

const r05 = (n) => Math.round(n * 20) / 20;

function simulate({ fps, jitterMs = 1, walkMs = 4000, latencyMs = 2, seed = 1 }) {
  const rnd = mulberry32(seed);
  const clock = { t: 1_000_000, now() { return this.t; } };
  const sent = [];
  const pres = new Presence(clock, (m) => sent.push(m));
  pres.join('p2');
  const buf = new PresenceBuffer();
  const t0 = clock.t;
  // client state (avatar.js rules)
  let x = 20; let lastSentAt = -1e9; let lastKey = '';
  const inbox = [];              // [arriveAt, mv]
  const deliveries = [];         // [arriveAt, pr]
  const frameDt = 1000 / fps;
  let nextFrame = t0;
  let nextFlush = t0 + 1000 / LIMITS.PRESENCE_HZ;
  const end = t0 + walkMs + 1500;
  const rendered = [];
  let nextRender = t0 + 500;
  for (let t = t0; t <= end; t += 0.25) {
    clock.t = Math.floor(t);
    if (t >= nextFrame) {                                  // sender frame
      const walking = t - t0 < walkMs;
      if (walking) x += (AVATAR_SPEED * frameDt) / 1000;
      if (t - lastSentAt >= 1000 / LIMITS.PRESENCE_HZ) {
        const mv = { x: r05(x), z: 30, f: 1.57, a: walking ? 1 : 0 };
        const key = JSON.stringify(mv);
        if (key !== lastKey) { lastKey = key; lastSentAt = t; inbox.push([t + latencyMs, mv]); }
      }
      nextFrame += frameDt + (rnd() * 2 - 1) * jitterMs;
    }
    while (inbox.length && inbox[0][0] <= t) pres.move('p2', inbox.shift()[1]);
    if (t >= nextFlush) {
      const before = sent.length;
      pres.flush();
      if (sent.length > before) deliveries.push([t + latencyMs, sent.at(-1)]);
      nextFlush += 1000 / LIMITS.PRESENCE_HZ;
    }
    while (deliveries.length && deliveries[0][0] <= t) {
      const [, m] = deliveries.shift();
      for (const [, px, pz, f, a] of m.list) buf.push(m.ts, px, pz, f, a);
    }
    if (t >= nextRender) {                                 // receiver frame at 60 Hz, perfect clock
      const p = buf.at(clock.t);
      if (p) rendered.push([t, p.x]);
      nextRender += 1000 / 60;
    }
  }
  // speed per rendered frame while the render time is inside the walk (skip the start and the stop)
  const speeds = [];
  for (let i = 1; i < rendered.length; i++) {
    const rt = rendered[i][0] - LIMITS.INTERP_DELAY_MS;
    if (rt < t0 + 400 || rt > t0 + walkMs - 200) continue;
    speeds.push(((rendered[i][1] - rendered[i - 1][1]) / (rendered[i][0] - rendered[i - 1][0])) * 1000);
  }
  // pr samples that repeat the previous x while the avatar is still walking
  const xs = sent.flatMap((m) => m.list.map((r) => [m.ts, r[1]]));
  let repeats = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i][0] - t0 < walkMs - 100 && xs[i][1] === xs[i - 1][1]) repeats++;
  const stalled = speeds.filter((s) => s < AVATAR_SPEED * 0.5).length;
  const rushed = speeds.filter((s) => s > AVATAR_SPEED * 1.5).length;
  return { frames: speeds.length, stalled, rushed, repeats, min: Math.min(...speeds).toFixed(2), max: Math.max(...speeds).toFixed(2) };
}

for (const fps of [60, 30]) {
  test(`a partner walking at a constant ${AVATAR_SPEED} tiles/s renders smoothly (sender at ${fps} fps)`, () => {
    const r = simulate({ fps });
    console.log(`OBSERVED fps=${fps}: ${JSON.stringify(r)}`);
    assert.equal(r.repeats, 0, 'no rest-repeat while walking');
    assert.equal(r.stalled + r.rushed, 0, 'no rendered frame below 0.5x or above 1.5x the walk speed');
  });
}
