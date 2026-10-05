// Wave 4, client lane (owner wish H "camera tilt"): the right-drag "Rotate camera" mode, Shift / middle pans in it, the
// tilt keys, and the phone's two-finger vertical tilt told apart from a two-finger pan, a pinch and a twist. The camera
// itself (view.camera.orbit) is render-world's; here a recording stand-in.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { coopHarness } from './helpers.js';
import { eventTarget } from './helpers/client.js';
import { orbitStep, tiltIntent, canOrbit, quarterSteps, ORBIT, TILT_GESTURE, QUARTER_SHARE } from '../public/js/game/camera-input.js';
import { createKeymap } from '../public/js/game/keys.js';

const PX = 10;

test('orbitStep: a drag to the right turns the near ground right (yaw -), a drag down tilts toward top-down (pitch +)', () => {
  const r = orbitStep(100, 0, 800);
  assert.ok(r.yaw < 0 && r.pitch === 0);
  assert.ok(Math.abs(r.yaw + (100 / 800) * ORBIT.yaw) < 1e-12);
  const d = orbitStep(0, 80, 800);
  assert.ok(d.pitch > 0 && Math.abs(d.pitch - (80 / 800) * ORBIT.pitch) < 1e-12);
  // the 55 deg tilt range (30-85) takes a little under half the canvas height
  const k = (55 * Math.PI) / 180 / ORBIT.pitch;
  assert.ok(k > 0.3 && k < 0.5, `share of the height: ${k.toFixed(2)}`);
  const out = { yaw: 9, pitch: 9 };
  assert.equal(orbitStep(-10, -10, 0, out), out, 'writes into the given object (no garbage per pointer move)');
  assert.ok(out.yaw > 0 && out.pitch < 0, 'a missing height falls back to 768 px');
  assert.deepEqual(orbitStep(NaN, NaN, 500), { yaw: 0, pitch: 0 });
});

test('tiltIntent: two fingers side by side moving up or down together tilt; a pan, a pinch, a twist or stacked fingers do not', () => {
  const at = (ax, ay, bx, by) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } });
  const start = at(100, 400, 220, 410);
  assert.equal(tiltIntent(start, at(101, 396, 221, 405)), null, 'barely moved: not told apart yet');
  assert.equal(tiltIntent(start, at(102, 385, 222, 396)), 'tilt', 'both up ~15 px, side by side');
  assert.equal(tiltIntent(start, at(99, 418, 219, 427)), 'tilt', 'both down');
  assert.equal(tiltIntent(start, at(118, 385, 238, 395)), 'free', 'diagonal: a two-finger pan');
  assert.equal(tiltIntent(start, at(130, 400, 250, 410)), 'free', 'sideways: a pan');
  assert.equal(tiltIntent(start, at(80, 400, 240, 410)), 'free', 'apart: a pinch');
  assert.equal(tiltIntent(start, at(100, 385, 220, 425)), 'free', 'one up, one down: a twist');
  const stacked = at(150, 300, 160, 420);
  assert.equal(tiltIntent(stacked, at(150, 285, 160, 405)), 'free', 'one finger above the other: never a tilt');
  assert.equal(tiltIntent(null, start), 'free');
  // the browser reports the fingers one at a time: the first finger alone 12 px up is not yet a verdict
  assert.equal(tiltIntent(start, at(100, 388, 220, 410)), null, 'one finger moved, the other not yet');
  assert.equal(tiltIntent(start, at(100, 388, 220, 398)), 'tilt', 'and then the other');
  assert.equal(tiltIntent(start, at(100, 380, 220, 410)), null, 'a long first step of one finger: still waiting for the other');
  assert.equal(tiltIntent(start, at(100, 380, 220, 390)), 'tilt');
  assert.equal(tiltIntent(start, at(125, 395, 220, 410)), 'free', 'one finger going sideways: a pan or a twist, at once');
  assert.equal(tiltIntent(start, at(100, 340, 220, 410)), 'free', 'one finger alone a long way: no tilt');
  assert.ok(TILT_GESTURE.decidePx >= 8 && TILT_GESTURE.freePx > TILT_GESTURE.decidePx);
});

test('canOrbit and the quarter-step fallback', () => {
  assert.equal(canOrbit({ camera: { orbit() {} } }), true);
  assert.equal(canOrbit({ camera: {} }), false);
  assert.equal(canOrbit(null), false);
  let acc = 0;
  const turns = [];
  for (let i = 0; i < 10; i++) { const q = quarterSteps(acc, 50, 1000); acc = q.acc; if (q.turn) turns.push(q.turn); }
  assert.deepEqual(turns, [-1, -1, -1], `a drag right of 500 px on 1000 turns ${Math.floor(500 / (QUARTER_SHARE * 1000))} quarters back`);
  assert.deepEqual(quarterSteps(0, -200, 1000), { acc: -40, turn: 1 }, 'the rest of the drag counts on');
});

test('the tilt keys are in the keymap (Settings lists them)', () => {
  const km = createKeymap();
  const ev = (code) => ({ code, ctrlKey: false, metaKey: false });
  assert.equal(km.actionOf(ev('PageUp')), 'tiltUp');
  assert.equal(km.actionOf(ev('PageDown')), 'tiltDown');
  assert.equal(km.actionOf(ev('Home')), 'camReset');
  const row = km.list().find((r) => r.action === 'tiltDown');
  assert.deepEqual(row.keys, ['Page Down']);
});

// ---- the controller ----------------------------------------------------------------------------------------------
beforeEach(() => { globalThis.window = eventTarget(); });

async function setup({ orbit = true, saved = null } = {}) {
  const box = new Map(saved ? [['hh.input', JSON.stringify(saved)]] : []);
  globalThis.localStorage = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => box.set(k, v), removeItem: (k) => box.delete(k) };
  const h = coopHarness();
  const store = h.a.store;
  const canvas = Object.assign(eventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 64 * PX, height: 64 * PX, right: 64 * PX, bottom: 64 * PX }),
    setPointerCapture() {},
  });
  const calls = { pan: [], zoom: [], rotate: [], orbit: [], reset: 0 };
  const frames = new Set();
  const camera = {
    get: () => ({ tx: 0, tz: 0, dist: 55, yaw: Math.PI / 4, pitch: 0.8 }),
    pan: (r, f) => calls.pan.push([r, f]), zoom: (f) => calls.zoom.push(f), rotate: (d) => calls.rotate.push(d),
  };
  if (orbit) { camera.orbit = (y, p) => calls.orbit.push([y, p]); camera.resetOrbit = () => { calls.reset++; }; }
  const view = {
    pick(ndc) {
      const px = ((ndc.x + 1) / 2) * 64;
      const pz = ((1 - ndc.y) / 2) * 64;
      return { kind: 'tile', x: Math.floor(px), z: Math.floor(pz), px, pz };
    },
    ghost: { show() {}, hide() {}, update() {} }, grid() {}, objects: { hidden() {} }, highlight() {}, fx: { play() {} },
    camera, focus() {}, invalidate() {}, interact() {}, onFrame(fn) { frames.add(fn); return () => frames.delete(fn); },
    partner: { pose: () => null }, toScreen: (x, z) => ({ x: x * PX, y: z * PX, visible: true }),
  };
  const avatar = { pose: { x: 0, z: 0 }, walkTo() {}, goTo: (x, z) => ({ x, z, reached: true }), setCursor() {}, setTool() {} };
  const { createController } = await import('../public/js/game/controller.js');
  const c = createController({ store, view, avatar, canvas, send() {}, toast() {} });
  const mouse = (type, x, y, o = {}) => canvas.dispatch(type, { clientX: x, clientY: y, pointerId: 7, pointerType: 'mouse', button: 2, ...o });
  const finger = (type, x, y, id) => canvas.dispatch(type, { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', button: 0 });
  const key = (code) => globalThis.window.dispatch('keydown', { code, key: code, target: null });
  return { c, calls, box, mouse, finger, key, frame: () => { for (const fn of frames) fn(0.016, 0); } };
}

test('right-drag pans by default; "Rotate camera" turns and tilts instead (remembered per device); Shift or middle still pan', async () => {
  const s = await setup();
  assert.equal(s.c.options.rotateDrag, false);
  assert.equal(s.c.options.rightDrag, 'pan');
  s.mouse('pointerdown', 200, 200);
  s.mouse('pointermove', 260, 200);
  s.mouse('pointermove', 300, 230);
  s.frame();
  s.mouse('pointerup', 300, 230);
  assert.ok(s.calls.pan.length > 0 && s.calls.orbit.length === 0, 'pan mode: a pan');

  assert.equal(s.c.setOption('rightDrag', 'rotate'), true);
  assert.equal(s.c.options.rotateDrag, true);
  assert.equal(JSON.parse(s.box.get('hh.input')).rotateDrag, true, 'remembered in hh.input');
  s.calls.pan.length = 0;
  s.mouse('pointerdown', 200, 200);
  s.mouse('pointermove', 240, 200);                   // past the click slop: a turn
  s.mouse('pointermove', 280, 260);
  s.frame();
  s.mouse('pointerup', 280, 260);
  assert.equal(s.calls.pan.length, 0, 'no pan in rotate mode');
  const yaw = s.calls.orbit.reduce((a, [y]) => a + y, 0);
  const pitch = s.calls.orbit.reduce((a, [, p]) => a + p, 0);
  assert.ok(yaw < 0, 'right: the near ground turns right');
  assert.ok(pitch > 0, 'down: toward top-down');
  assert.ok(Math.abs(yaw - orbitStep(80, 60, 64 * PX).yaw) < 1e-9 && Math.abs(pitch - orbitStep(80, 60, 64 * PX).pitch) < 1e-9,
    'exactly the drag, applied once per frame');

  s.calls.orbit.length = 0;
  s.mouse('pointerdown', 200, 200, { shiftKey: true });
  s.mouse('pointermove', 260, 200, { shiftKey: true });
  s.frame();
  s.mouse('pointerup', 260, 200, { shiftKey: true });
  assert.ok(s.calls.pan.length > 0 && s.calls.orbit.length === 0, 'Shift + right-drag pans');
  s.calls.pan.length = 0;
  s.mouse('pointerdown', 200, 200, { button: 1 });
  s.mouse('pointermove', 260, 200, { button: 1 });
  s.frame();
  s.mouse('pointerup', 260, 200, { button: 1 });
  assert.ok(s.calls.pan.length > 0 && s.calls.orbit.length === 0, 'middle-drag pans');

  // the next page load on this device starts in rotate mode; the setting goes back with a boolean too
  const t = await setup({ saved: { rotateDrag: true } });
  assert.equal(t.c.options.rightDrag, 'rotate');
  t.c.setOption('rotateDrag', false);
  assert.equal(t.c.options.rightDrag, 'pan');
});

test('a right click still cancels a placement in rotate mode; a view without orbit turns in quarters', async () => {
  const s = await setup({ orbit: false, saved: { rotateDrag: true } });
  s.c.place('picket_fence');
  assert.equal(s.c.tool.build?.def, 'picket_fence');
  s.mouse('pointerdown', 300, 300);
  s.mouse('pointerup', 300, 300);
  assert.equal(s.c.tool.build, null, 'right click: placement cancelled');
  s.mouse('pointerdown', 100, 300);
  for (let x = 110; x <= 400; x += 10) { s.mouse('pointermove', x, 300); s.frame(); }
  s.mouse('pointerup', 400, 300);
  assert.deepEqual(s.calls.rotate, [-1, -1], `a 300 px drag on a 640 px canvas: two quarter turns (${QUARTER_SHARE * 640} px each)`);
});

test('PageUp / PageDown tilt, Home resets; nothing without the camera\'s orbit', async () => {
  const s = await setup();
  s.key('PageDown');
  s.key('PageUp');
  s.key('Home');
  assert.deepEqual(s.calls.orbit, [[0, ORBIT.keyPitch], [0, -ORBIT.keyPitch]]);
  assert.equal(s.calls.reset, 1);
  const t = await setup({ orbit: false });
  t.key('PageDown');
  t.key('Home');
  assert.equal(t.calls.orbit.length + t.calls.reset, 0);
});

test('phone: two fingers side by side dragged down tilt (no pan, no zoom); a diagonal two-finger drag still pans', async () => {
  const s = await setup();
  s.finger('pointerdown', 200, 300, 1);
  s.finger('pointerdown', 330, 305, 2);
  // 18 px a step, one finger's event after the other (as Chrome reports a touchmove)
  for (let i = 1; i <= 8; i++) { s.finger('pointermove', 200, 300 + i * 18, 1); s.finger('pointermove', 330, 305 + i * 18, 2); }
  s.finger('pointerup', 200, 444, 1);
  s.finger('pointerup', 330, 449, 2);
  const pitch = s.calls.orbit.reduce((a, [, p]) => a + p, 0);
  assert.ok(pitch > 0 && s.calls.orbit.every(([y]) => y === 0), `tilted toward top-down (${pitch.toFixed(3)} rad), never turned`);
  assert.equal(s.calls.pan.length, 0, 'no pan');
  assert.equal(s.calls.zoom.length, 0, 'no zoom');

  s.calls.orbit.length = 0;
  s.finger('pointerdown', 200, 300, 3);
  s.finger('pointerdown', 330, 305, 4);
  for (let i = 1; i <= 8; i++) { s.finger('pointermove', 200 + i * 8, 300 + i * 6, 3); s.finger('pointermove', 330 + i * 8, 305 + i * 6, 4); }
  s.finger('pointerup', 264, 348, 3);
  s.finger('pointerup', 394, 353, 4);
  assert.equal(s.calls.orbit.length, 0, 'a diagonal drag never tilts');
  assert.ok(s.calls.pan.length > 0, 'it pans');
});

test('phone without the camera\'s orbit: a two-finger vertical drag pans at once, as before', async () => {
  const s = await setup({ orbit: false });
  s.finger('pointerdown', 200, 300, 1);
  s.finger('pointerdown', 330, 305, 2);
  s.finger('pointermove', 200, 306, 1);
  s.finger('pointermove', 330, 311, 2);
  assert.ok(s.calls.pan.length > 0, 'the first move already pans');
});
