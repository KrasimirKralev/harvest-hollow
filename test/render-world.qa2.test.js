// QA wave 2 CL-03 (render-world, proposed by the client fixer): the laptop rests. Slow ambient (sway, breathing, a
// pulsing pin) renders at the calm rate and, once nobody gave input for LOOP.idleMs, a frame every 500 ms; anything
// that travels (the partner walking, a pet keeping up with its farmer) keeps the ambient rate; a loop whose next frame
// is far off stops its animation frames and wakes on dirt or input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capFps, startLoop, LOOP, WANT } from '../public/js/render/renderer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('CL-03: calm and idle caps apply to slow ambient only; a change at idle shows at the calm rate', () => {
  const base = { input: false, feedback: false, lastWant: WANT.AMBIENT, dirty: false, blurred: false, ambientFps: 20, interactiveFps: 60,
    calmFps: LOOP.calmFps };
  assert.equal(capFps(base), LOOP.calmFps, 'slow ambient alone: the calm rate');
  assert.equal(capFps({ ...base, idle: true }), LOOP.idleFps, 'and a frame every 500 ms once nobody gave input');
  assert.equal(capFps({ ...base, idle: true, dirty: true }), LOOP.calmFps, 'a store change or a presence row still shows at once');
  assert.equal(capFps({ ...base, lastWant: WANT.MOVING, idle: true }), 20, 'the partner walking: the ambient rate, idle or not');
  assert.equal(capFps({ ...base, lastWant: WANT.INTERACTIVE, idle: true }), 60, 'feedback: interactive');
  assert.equal(capFps({ ...base, input: true, idle: true }), 60, 'input: interactive');
  assert.equal(capFps({ ...base, lastWant: 0, idle: true }), LOOP.pollFps, 'static: the poll');
  assert.ok(LOOP.restFps <= 20 && LOOP.calmFps <= 12 && LOOP.idleFps <= 2 && LOOP.idleMs <= 30_000, 'the CL-03 budget');
});

test('CL-03: a resting loop sleeps between far-apart frames; dirt or input restarts its animation frames', async () => {
  let cb = null;
  const renderer = { setAnimationLoop: (fn) => { cb = fn; } };
  let dirty = false; let renders = 0;
  const stop = startLoop({ renderer, want: () => WANT.AMBIENT, frame: () => { renders++; }, isDirty: () => dirty,
    clearDirty: () => { dirty = false; }, blurred: () => false, ambientFps: () => 20, interactiveFps: () => 60,
    calmFps: () => 12, idleMs: 0, napMs: 10 });
  const frames = async (ms) => { const end = performance.now() + ms; while (performance.now() < end) { if (cb) cb(performance.now()); await sleep(4); } };
  await frames(40);
  assert.equal(renders, 1, 'idle: one frame, then nothing for 500 ms');
  assert.equal(cb, null, 'and no animation frames meanwhile (asleep)');
  dirty = true;
  await sleep(25);
  assert.equal(typeof cb, 'function', 'a store change wakes it');
  await frames(120);
  assert.ok(renders >= 2 && renders <= 3, `and shows within one calm frame (the slot booked at the calm rate may add one): ${renders}`);
  const n = renders;
  await frames(150);
  assert.equal(renders, n, 'then rests again');
  assert.equal(cb, null, 'asleep again');
  stop.kick();
  assert.equal(typeof cb, 'function', 'input wakes it at once');
  await frames(60);
  assert.ok(renders >= 3, 'input renders at once');
  stop();
  assert.equal(cb, null);
});
