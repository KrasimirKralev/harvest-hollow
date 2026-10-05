// Presence relay: bounds, speed clamp with catch-up, changed-only batches, the rest repeat (tech §6.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Presence, REST_MS } from '../server/presence.js';
import { AVATAR_SPEED, START, RIDE_SPEED_K, RIDE_TOOL } from '../shared/content/config.js';
import { PresenceBuffer } from '../shared/net/interp.js';
import { LIMITS, parseClientMessage } from '../shared/net/protocol.js';
import { fakeClock, mulberry32 } from './helpers.js';

function setup() {
  const clock = fakeClock(1000);
  const sent = [];
  const p = new Presence(clock, (m) => sent.push(m));
  p.join('p1');
  return { clock, sent, p };
}

test('join places the avatar at its slot spawn and the first flush announces it', () => {
  const { p, sent } = setup();
  p.flush();
  assert.deepEqual(sent[0].list, [['p1', START.spawn.p1.x, START.spawn.p1.z, 0, 0, null, null, 1000, null, 0]]);
});

test('a teleport is clamped, then the relayed pose catches up at 1.5x speed', () => {
  const { p, clock, sent } = setup();
  p.flush();
  clock.advance(100);
  p.move('p1', { x: START.spawn.p1.x + 10, z: START.spawn.p1.z, f: 0, a: 1 });
  const e = p.p.get('p1');
  assert.ok(e.x - START.spawn.p1.x < 1, `clamped (${e.x})`);
  for (let i = 0; i < 60; i++) { clock.advance(66); p.flush(); }
  assert.equal(p.p.get('p1').x, START.spawn.p1.x + 10);
  const xs = sent.flatMap((m) => m.list.map((r) => r[1]));
  // From the third sample on, the flushes are 66 ms apart: speed budget + slack + rounding.
  const maxStep = (AVATAR_SPEED * 1.5 * 66) / 1000 + 0.1 + 0.05;
  for (let i = 2; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] <= maxStep, `step ${xs[i] - xs[i - 1]}`);
});

test('bounds and rounding; nothing is sent once the avatar rests (after one repeat)', () => {
  const { p, clock, sent } = setup();
  clock.advance(60_000);
  p.move('p1', { x: -500, z: 31.234, f: 1.23456, a: 0, cx: 999, cz: 2.01 });
  const e = p.p.get('p1');
  assert.equal(e.x, -1);
  assert.equal(e.z, 31.25);
  assert.equal(e.cx, 65);
  assert.equal(e.f, 1.23);
  p.flush();
  clock.advance(66); p.flush();                    // one missed mv mid-walk is not a stop (review-m0 M3)
  assert.equal(sent.length, 1, 'no repeat within REST_MS');
  clock.advance(REST_MS); p.flush(); clock.advance(66); p.flush(); clock.advance(66); p.flush();
  assert.equal(sent.length, 2, 'the change, then exactly one rest repeat');
  assert.deepEqual(sent[0].list.map((r) => r.slice(0, 7)), sent[1].list.map((r) => r.slice(0, 7)));
  assert.ok(sent[1].list[0][7] > sent[0].list[0][7], 'the repeat is stamped when it is sent');
});

// ---- review-m0 M3: a partner walking at a constant speed renders smoothly ---------------------------------
// Drives the real Presence and the real PresenceBuffer with the avatar.js send rule (a fixed PRESENCE_HZ
// accumulator) over a 4 s walk at AVATAR_SPEED, rendered at 60 Hz, with +-1 ms frame jitter and 2 ms latency.
function simulateWalk({ fps, jitterMs = 1, walkMs = 4000, latencyMs = 2, seed = 1 }) {
  const rnd = mulberry32(seed);
  const clock = { t: 1_000_000, now() { return this.t; } };
  const sent = [];
  const pres = new Presence(clock, (m) => sent.push(m));
  pres.join('p2');
  const buf = new PresenceBuffer();
  const t0 = clock.t;
  const SEND_S = 1 / LIMITS.PRESENCE_HZ;
  let x = 20;
  let acc = SEND_S;
  let lastKey = '';
  const inbox = [];
  const deliveries = [];
  const frameDt = 1000 / fps;
  let nextFrame = t0;
  let lastFrame = t0;
  let nextFlush = t0 + 1000 / LIMITS.PRESENCE_HZ;
  const end = t0 + walkMs + 1500;
  const rendered = [];
  let nextRender = t0 + 500;
  for (let t = t0; t <= end; t += 0.25) {
    clock.t = Math.floor(t);
    if (t >= nextFrame) {
      const dt = (t - lastFrame) / 1000;
      lastFrame = t;
      const walking = t - t0 < walkMs;
      if (walking) x += AVATAR_SPEED * dt;
      acc = Math.min(acc + dt, SEND_S * 2);
      if (acc >= SEND_S) {
        acc -= SEND_S;
        const mv = { x: Math.round(x * 20) / 20, z: 30, f: 1.57, a: walking ? 1 : 0 };
        const key = JSON.stringify(mv);
        if (key !== lastKey) { lastKey = key; inbox.push([t + latencyMs, mv]); }
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
      for (const [, px, pz, f, a, cx, cz, rts] of m.list) buf.push(rts ?? m.ts, px, pz, f, a, cx, cz);
    }
    if (t >= nextRender) {
      const p = buf.at(clock.t);
      if (p) rendered.push([t, p.x]);
      nextRender += 1000 / 60;
    }
  }
  const speeds = [];
  for (let i = 1; i < rendered.length; i++) {
    const rt = rendered[i][0] - LIMITS.INTERP_DELAY_MS;
    if (rt < t0 + 400 || rt > t0 + walkMs - 200) continue;
    speeds.push(((rendered[i][1] - rendered[i - 1][1]) / (rendered[i][0] - rendered[i - 1][0])) * 1000);
  }
  const xs = sent.flatMap((m) => m.list.map((r) => [m.ts, r[1]]));
  let repeats = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i][0] - t0 < walkMs - 100 && xs[i][1] === xs[i - 1][1]) repeats++;
  const stalled = speeds.filter((s) => s < AVATAR_SPEED * 0.5).length;
  const rushed = speeds.filter((s) => s > AVATAR_SPEED * 1.5).length;
  const finalX = buf.at(end + 1000).x;
  return { frames: speeds.length, stalled, rushed, repeats, finalX, x };
}

for (const fps of [60, 30, 144]) {
  test(`a partner walking at a constant speed renders smoothly (sender at ${fps} fps; review-m0 M3)`, () => {
    for (const seed of [1, 2, 3]) {
      const r = simulateWalk({ fps, seed });
      assert.ok(r.frames > 150, `measured ${r.frames} frames`);
      assert.equal(r.repeats, 0, 'no rest repeat while walking');
      assert.equal(r.stalled + r.rushed, 0, `no frame below 0.5x or above 1.5x the walk speed (${JSON.stringify(r)})`);
      assert.ok(Math.abs(r.finalX - Math.round(r.x * 20) / 20) < 1e-9, 'stops exactly where the sender stopped');
    }
  });
}

// ---- review-m0 M4: hops and the partner's tool travel on the wire ------------------------------------------
test('a hop lands within one relay tick and is flagged; the tool rides along', () => {
  const { p, clock, sent } = setup();
  p.flush();
  clock.advance(66);
  const sp = START.spawn.p1;
  p.move('p1', { x: sp.x + 30, z: sp.z, f: 0, a: 0, hop: true, tool: 'sickle' });
  p.flush();
  const row = sent.at(-1).list[0];
  assert.deepEqual([row[1], row[2]], [sp.x + 30, sp.z], 'no sprint: the pose is there at once');
  assert.equal(row[8], 'sickle');
  assert.equal(row[9], 1, 'hop flag');
  clock.advance(66);
  p.move('p1', { x: sp.x + 30.2, z: sp.z, f: 0, a: 1 });
  p.flush();
  assert.equal(sent.at(-1).list[0][9], 0, 'the flag is sent once');
  assert.equal(sent.at(-1).list[0][8], 'sickle', 'the tool is kept until changed');
  const b = new PresenceBuffer();
  b.push(1000, 0, 0, 0, 1);
  b.push(1066, 1, 0, 0, 1);
  b.clear();
  b.push(1132, 30, 0, 0, 0);
  assert.equal(b.sample(1100).x, 30, 'after a hop the receiver snaps instead of interpolating');
});

test('mv parses hop and tool; anything else in them is refused', () => {
  assert.deepEqual(parseClientMessage({ t: 'mv', x: 1, z: 1, f: 0, a: 0, cx: 2, cz: 2, tool: 'sickle', hop: true }),
    { t: 'mv', x: 1, z: 1, f: 0, a: 0, cx: 2, cz: 2, hop: true, tool: 'sickle' });
  for (const bad of [{ hop: 1 }, { hop: 'yes' }, { tool: 'Sickle' }, { tool: 'x'.repeat(17) }, { tool: 3 }]) {
    assert.equal(parseClientMessage({ t: 'mv', x: 1, z: 1, f: 0, a: 0, ...bad }), null, JSON.stringify(bad));
  }
});

test('an idle sample is never extrapolated (a stopped partner does not overshoot)', () => {
  const b = new PresenceBuffer();
  b.push(1000, 0, 0, 0, 1);
  b.push(1066, 1, 0, 0, 0);                        // the last mv of a walk says a: 0
  assert.equal(b.sample(1066 + 100).x, 1);
});

test('a rider (presence tool horse) is relayed at riding speed; the same stream on foot is clamped', () => {
  const run = (tool) => {
    const { p, clock } = setup();
    p.flush();
    const sp = START.spawn.p1;
    let x = sp.x;
    let lag = 0;
    // 5.4 tiles/s (walking speed x RIDE_SPEED_K) from a sender that only gets a frame out every 400 ms (a busy tab
    // or a bursty link: the per-frame slack no longer covers the difference), for about five seconds
    for (let i = 0; i < 12; i++) {
      clock.advance(400);
      x += (AVATAR_SPEED * RIDE_SPEED_K * 400) / 1000;
      p.move('p1', { x, z: sp.z, f: 0, a: 1, tool });
      p.flush();
      lag = Math.max(lag, x - p.p.get('p1').x);
    }
    return lag;
  };
  assert.ok(run(RIDE_TOOL) < 0.2, `a rider keeps up (${run(RIDE_TOOL)})`);
  assert.ok(run('hand') > 1, `on foot the same stream falls behind (${run('hand')})`);
});
