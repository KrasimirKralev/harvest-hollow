// Client clock estimate, server monotonic clock, presence interpolation (tech §4, §6.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClockSync, JUMP_MS } from '../shared/net/clock.js';
import { PresenceBuffer } from '../shared/net/interp.js';
import { ServerClock } from '../server/clock.js';
import { LIMITS } from '../shared/net/protocol.js';
import { mulberry32 } from './helpers.js';

test('ClockSync converges under jittery, asymmetric RTTs and keeps the min-RTT sample', () => {
  const OFFSET = 1_790_000_000_000;               // server epoch - client perf time
  const rng = mulberry32(5);
  const c = new ClockSync();
  let perf = 1000;
  for (let i = 0; i < 40; i++) {
    const up = 1 + rng() * 30;                     // asymmetric: up and down legs differ
    const down = 1 + rng() * 5;
    const s = perf + up + OFFSET;
    c.add(perf, s, perf + up + down);
    perf += 200;
  }
  const err = Math.abs(c.serverNow(perf) - (perf + OFFSET));
  assert.ok(err < 20, `estimate within the min-RTT bound (err ${err})`);
});

test('ClockSync jumps on a large error and slews on a small one', () => {
  const c = new ClockSync();
  c.seed(10_000, 0);
  assert.equal(c.serverNow(5), 10_005);
  c.add(100, 10_101 + JUMP_MS + 500, 102);         // server warped ahead (rtt 2)
  assert.equal(c.serverNow(101), 10_101 + JUMP_MS + 500);
  const before = c.offset;
  c.add(200, 200 + before + 50, 200);              // better sample (rtt 0), small drift: slew 20 %
  assert.ok(Math.abs(c.offset - (before + 10)) < 1e-9);
});

test('ServerClock never runs backwards and keeps warp offsets', () => {
  let wall = 1000;
  const side = { lastNow: 0 };
  const warn = [];
  const k = new ServerClock(side, { wall: () => wall, dev: true, log: { warn: (m) => warn.push(m) } });
  assert.equal(k.now(), 1000);
  wall = 900;
  assert.equal(k.now(), 1000, 'frozen while the wall clock is behind');
  wall = 1100;
  assert.equal(k.now(), 1100);
  assert.equal(k.warp(60_000), 61_100);
  assert.equal(side.devOffset, 60_000);
  wall = -10_000;
  k.now();
  assert.equal(warn.length, 1);
  assert.throws(() => new ServerClock({ lastNow: 0 }, { wall: () => 0 }).warp(5), /dev-only/);
});

test('ServerClock KEEPS a persisted dev offset in production and refuses new warps (review-m0 M7)', () => {
  const warn = [];
  const k = new ServerClock({ lastNow: 0, devOffset: 99_999 }, { wall: () => 5, log: { warn: (m) => warn.push(m) } });
  assert.equal(k.now(), 100_004);
  assert.equal(warn.length, 1, 'the kept offset is logged');
  assert.throws(() => k.warp(1), /dev-only/);
});

test('after a dev warp, a production boot on the same data dir has a running clock (review-m0 M7)', () => {
  let wall = 1_790_000_000_000;
  const sidecar = { lastNow: 0, devOffset: 0 };
  const quiet = { warn() {} };
  const dev = new ServerClock(sidecar, { wall: () => wall, dev: true, log: quiet });
  dev.warp(4 * 3600 * 1000);
  dev.now();
  const saved = JSON.parse(JSON.stringify(sidecar));
  wall += 60_000;
  const prod = new ServerClock(saved, { wall: () => wall, dev: false, log: quiet });
  const t1 = prod.now();
  wall += 10 * 60_000;
  assert.equal(prod.now() - t1, 600_000, 'ten real minutes are ten game minutes');
});

test('a big backward wall step is absorbed (game time continues), a small one holds briefly', () => {
  let wall = 1_000_000;
  const k = new ServerClock({ lastNow: 0 }, { wall: () => wall, log: { warn() {} } });
  assert.equal(k.now(), 1_000_000);
  wall -= 2000;                                    // small: hold
  assert.equal(k.now(), 1_000_000);
  wall += 2000 + 100;
  assert.equal(k.now(), 1_000_100);
  wall -= 3_600_000;                               // an hour back: absorbed
  assert.equal(k.now(), 1_000_100);
  wall += 1000;
  assert.equal(k.now(), 1_001_100, 'runs on from where it was, at wall speed');
});

test('PresenceBuffer interpolates in the past, extrapolates briefly, then holds', () => {
  const b = new PresenceBuffer();
  b.push(1000, 0, 0, 0, 1, 5, 5);
  b.push(1066, 1, 0, Math.PI - 0.1, 1, 6, 5);
  b.push(1050, 99, 99, 0, 0);                      // out of order: dropped
  const mid = b.sample(1033);
  assert.ok(Math.abs(mid.x - 0.5) < 1e-9);
  assert.ok(Math.abs(mid.cx - 5.5) < 1e-9);
  const ex = b.sample(1066 + 66);
  assert.ok(Math.abs(ex.x - 2) < 1e-9, 'extrapolated with the last velocity');
  const held = b.sample(1066 + 10_000);
  assert.ok(Math.abs(held.x - (1 + LIMITS.EXTRAPOLATE_MS / 66)) < 1e-9, 'capped');
  assert.deepEqual(b.at(1000 + LIMITS.INTERP_DELAY_MS).x, 0);
  const wrap = new PresenceBuffer();
  wrap.push(0, 0, 0, Math.PI - 0.1, 0);
  wrap.push(100, 0, 0, -Math.PI + 0.1, 0);
  assert.ok(Math.abs(Math.abs(wrap.sample(50).f) - Math.PI) < 1e-9, 'shortest arc through pi');
});

test('ClockSync adopts a consistent offset change (a suspend) within two samples (review-m0 L1)', () => {
  const k = new ClockSync();
  const server = (perf, shift) => 1_790_000_000_000 + perf + shift;
  let perf = 1000;
  for (let i = 0; i < 6; i++) { k.add(perf, server(perf + 1, 0), perf + 2); perf += 200; }
  const errs = [];
  for (let i = 0; i < 4; i++) {
    perf += 10_000;
    k.add(perf, server(perf + 2, 20_000), perf + 4);
    errs.push(server(perf + 4, 20_000) - k.serverNow(perf + 4));
  }
  assert.ok(Math.abs(errs[1]) < 50 && Math.abs(errs[3]) < 50, `errors ${errs}`);
});
