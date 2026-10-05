// My avatar (public/js/game/avatar.js): the walk and the 15 Hz presence accumulator run on their own clock
// (RD-02: a capped render loop on a 144 Hz monitor walked the farmer at 36 % speed), a reconnect re-sends the pose
// as a hop (coop-robust-06), and walkTo's onArrive fires once the final pose has gone out (a bench sit, CL-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAvatar } from '../public/js/game/avatar.js';
import { AVATAR_SPEED } from '../shared/content/config.js';
import { LIMITS } from '../shared/net/protocol.js';

function rig() {
  let t = 1000;
  const frames = [];
  const sent = [];
  const view = { me: { update() {} }, onFrame(fn) { frames.push(fn); } };
  const avatar = createAvatar({ view, send: (m) => sent.push(m), pid: 'p1', clock: () => t });
  /** Advance the clock by ms in rendered frames of `frameMs`, handing the loop a WRONG dt (the per-rAF dt). */
  const run = (ms, frameMs = 1000 / 60, badDt = 1 / 144) => {
    for (let k = 0; k < ms / frameMs; k++) { t += frameMs; for (const f of frames) f(badDt, t); }
  };
  run(20);                                  // first frames: the spawn pose goes out
  return { avatar, sent, run };
}

test('walking speed follows the real clock, not the dt the render loop hands over (144 Hz cap)', () => {
  const { avatar, run } = rig();
  const x0 = avatar.pose.x;
  avatar.walkTo(x0 + 10, avatar.pose.z, 1, 1);
  run(1000, 1000 / 60, 1 / 144);            // 60 rendered frames a second, each told dt = 1/144 s
  const moved = avatar.pose.x - x0;
  assert.ok(Math.abs(moved - AVATAR_SPEED) < 0.1, `walked ${moved.toFixed(2)} tiles in 1 s (speed ${AVATAR_SPEED})`);
});

test('presence goes out at PRESENCE_HZ whatever the frame rate', () => {
  const { avatar, sent, run } = rig();
  avatar.walkTo(avatar.pose.x + 11, avatar.pose.z, 1, 1);     // < 12 tiles: a walk, not a hop
  const n0 = sent.length;
  run(1000, 1000 / 144, 1 / 144);
  const n = sent.length - n0;
  assert.ok(n >= LIMITS.PRESENCE_HZ - 1 && n <= LIMITS.PRESENCE_HZ + 1, `${n} mv in 1 s at 144 fps`);
  const sent30 = sent.length;
  run(1000, 1000 / 30, 1 / 144);                              // still walking (3.5 s for 10.5 tiles)
  const m = sent.length - sent30;
  assert.ok(m >= LIMITS.PRESENCE_HZ - 1 && m <= LIMITS.PRESENCE_HZ + 1, `${m} mv in 1 s at 30 fps`);
});

test('resync: after a reconnect the unchanged pose goes out again, as a hop (the server put me at the porch)', () => {
  const { avatar, sent, run } = rig();
  avatar.place(40, 40);
  run(200);
  const last = sent.at(-1);
  assert.equal(last.x, 40);
  const n = sent.length;
  run(500);
  assert.equal(sent.length, n, 'a resting pose is not re-sent');
  avatar.resync();
  run(100);
  assert.equal(sent.length, n + 1, 'the pose goes out once more');
  assert.deepEqual([sent.at(-1).x, sent.at(-1).z, sent.at(-1).hop], [40, 40, true]);
});

test('walkTo onArrive: fires once the farmer stands there and the final pose went out; a newer walk cancels it', () => {
  const { avatar, sent, run } = rig();
  let arrived = 0;
  avatar.walkTo(avatar.pose.x + 3, avatar.pose.z, 1, 1, () => { arrived++; });
  run(300);
  assert.equal(arrived, 0, 'still walking');
  run(1500);
  assert.equal(arrived, 1);
  assert.equal(sent.at(-1).x, Math.round(avatar.pose.x * 20) / 20, 'the server has the final pose before the action');
  let cancelled = 0;
  avatar.walkTo(avatar.pose.x + 5, avatar.pose.z, 1, 1, () => { cancelled++; });
  run(200);
  avatar.walkTo(avatar.pose.x - 5, avatar.pose.z, 1, 1);
  run(3000);
  assert.equal(cancelled, 0, 'the player went elsewhere: no sit');
  let near = 0;
  avatar.walkTo(avatar.pose.x + 0.45, avatar.pose.z - 0.5, 1, 1, () => { near++; });   // I stand at its edge
  assert.equal(near, 1, 'already there: at once');
  let far = 0;
  avatar.walkTo(avatar.pose.x + 30, avatar.pose.z, 1, 1, () => { far++; });
  assert.equal(far, 1, 'far: a hop, then at once');
  assert.equal(sent.at(-1).hop, true, 'the hop went out before the action');
});

test('a walk that starts after an idle loop (no frames for seconds) does not jump on its first frame', () => {
  let t = 1000;
  const frames = [];
  const avatar = createAvatar({ view: { me: { update() {} }, onFrame(fn) { frames.push(fn); } }, send() {}, pid: 'p1', clock: () => t });
  for (const f of frames) f(0.016, t);
  t += 5000;                                               // the loop slept: nothing to draw
  const x0 = avatar.pose.x;
  avatar.walkTo(x0 + 6, avatar.pose.z, 1, 1);
  t += 16;
  for (const f of frames) f(0.016, t);
  assert.ok(avatar.pose.x - x0 < 0.1, `first frame moved ${(avatar.pose.x - x0).toFixed(2)} tiles`);
});
