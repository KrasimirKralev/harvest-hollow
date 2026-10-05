// Mobile wave, input lane: the touch model (game/touch.js + the controller's touch path), haptics, the device and
// viewport helpers, the touch build bar's placement, the audio unlock gestures and the web app manifest. The
// controller runs for real on the real SyncStore and rules (coopHarness) behind a fake canvas whose picks are tiles,
// as in sync.controller.test.js; touches are pointer events with pointerType 'touch'.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { xpForLevel } from '../shared/content/index.js';
import { tileOwner, canPlace } from '../shared/rules/grid.js';
import { coopHarness, plain } from './helpers/client.js';
import { TOUCH, tapSlop, pair, angleDelta, twist, isDoubleTap, groundAt, flingStep } from '../public/js/game/touch.js';
import { createHaptics, PULSES } from '../public/js/game/haptics.js';
import { createDevice } from '../public/js/game/device.js';
import { createViewport } from '../public/js/game/viewport.js';
import { UNLOCK_EVENTS } from '../public/js/audio.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PX = 10;                               // one tile = 10 css px on the fake canvas
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- pure helpers ------------------------------------------------------------------------------------------------
test('touch: the tap slop is a few CSS px, a little wider on dense 3x phones', () => {
  assert.ok(tapSlop(1) >= 8 && tapSlop(1) <= 10, String(tapSlop(1)));
  assert.ok(tapSlop(3) > tapSlop(2) && tapSlop(2) >= tapSlop(1));
  assert.ok(tapSlop(3) <= 16);
  assert.equal(tapSlop(undefined), tapSlop(1));
  assert.ok(tapSlop(1) > 6, 'wider than the mouse click threshold (6 px)');
});

test('touch: pair, angleDelta and the twist snap', () => {
  const p = pair({ x: 0, y: 0 }, { x: 100, y: 0 });
  assert.deepEqual([p.x, p.y, p.dist, p.ang], [50, 0, 100, 0]);
  assert.ok(Math.abs(angleDelta(3.1, -3.1) - (2 * Math.PI - 6.2)) < 1e-9, 'across ±π: the short way');
  assert.ok(Math.abs(angleDelta(-3.1, 3.1) + (2 * Math.PI - 6.2)) < 1e-9);
  // a slow clockwise twist accumulates and snaps once past TOUCH.snapRad, then counts again
  let acc = 0;
  const turns = [];
  for (let i = 0; i < 10; i++) { const r = twist(acc, TOUCH.snapRad / 4, 200); acc = r.acc; if (r.turn) turns.push(r.turn); }
  assert.deepEqual(turns, [1, 1], 'ten quarter-snaps of twist turn the view twice');
  assert.deepEqual(twist(0, -TOUCH.snapRad - 0.01, 200), { acc: 0, turn: -1 }, 'anticlockwise');
  assert.deepEqual(twist(0.2, 1, 20), { acc: 0.2, turn: 0 }, 'fingers too close: their angle is noise');
});

test('touch: a double tap is close in time and place', () => {
  assert.equal(isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 200, x: 20, y: 18 }), true);
  assert.equal(isDoubleTap({ t: 0, x: 10, y: 10 }, { t: TOUCH.doubleMs + 1, x: 10, y: 10 }), false, 'too slow');
  assert.equal(isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 100, x: 80, y: 10 }), false, 'too far');
  assert.equal(isDoubleTap(null, { t: 0, x: 0, y: 0 }), false);
});

test('touch: the ground projection matches what view.pick returned in an emulated iPhone 13 (390 x 844)', () => {
  // read off a real page: view.camera.get() and view.pick(ndc).px/pz (render/picking.js, a ray on y = 0)
  const cam = { tx: 56, tz: 64, dist: 55, yaw: Math.PI / 4, pitch: 0.7897614865274342 };
  for (const [x, y, px, pz] of [[0, 0, 28, 32], [0.5, 0.5, 25.158, 26.382], [-0.7, -0.6, 30.343, 37.251], [0.8, 0.9, 21.854, 20.791]]) {
    const g = groundAt(cam, { x, y }, 390 / 844, 30);
    assert.ok(Math.abs(g.x / 2 - px) < 0.002 && Math.abs(g.z / 2 - pz) < 0.002, `${x},${y}: ${g.x / 2},${g.z / 2} vs ${px},${pz}`);
  }
  assert.equal(groundAt({ ...cam, pitch: undefined }, { x: 0, y: 0 }, 1, 30), null, 'an incomplete camera: no guess');
  assert.equal(groundAt({ ...cam, pitch: 0.05 }, { x: 0, y: 1 }, 1, 30), null, 'above the horizon');
});

test('touch: the pan glide decays and dies out', () => {
  let v = { x: 10, z: -5 };
  for (let i = 0; i < 60; i++) v = flingStep(v, 1 / 60);
  assert.ok(Math.hypot(v.x, v.z) < 11.2 * Math.exp(-TOUCH.flingRate) + 1e-9 && Math.hypot(v.x, v.z) > 0);
  assert.deepEqual(flingStep({ x: 1, z: 1 }, 0), { x: 1, z: 1 });
});

test('haptics: off switch, a throttle for strokes, the level-up always buzzes, nothing without the API', () => {
  const calls = [];
  let t = 0;
  let on = true;
  const hp = createHaptics({ nav: { vibrate: (p) => { calls.push(p); return true; } }, enabled: () => on, now: () => t });
  assert.equal(hp.available, true);
  assert.equal(hp.pulse('harvest'), true);
  t += 20;
  assert.equal(hp.pulse('harvest'), false, 'a stroke is a purr, not a stuck motor');
  t += 100;
  assert.equal(hp.pulse('harvest'), true);
  assert.equal(hp.pulse('levelUp'), true, 'never throttled');
  assert.deepEqual(calls.at(-1), [...PULSES.levelUp]);
  on = false;
  t += 1000;
  assert.equal(hp.pulse('harvest'), false, 'the player turned it off');
  assert.equal(hp.pulse('nope'), false);
  assert.equal(createHaptics({ nav: {} }).pulse('tick'), false, 'iOS: no navigator.vibrate');
});

// ---- the controller's touch path -----------------------------------------------------------------------------------
/** A tiny event target: addEventListener + dispatch(type, props) with a plain event object. */
function target() {
  const fns = new Map();
  return {
    style: {},
    addEventListener(t, fn) { if (!fns.has(t)) fns.set(t, []); fns.get(t).push(fn); },
    removeEventListener(t, fn) { fns.set(t, (fns.get(t) || []).filter((f) => f !== fn)); },
    dispatch(t, props = {}) {
      const ev = { type: t, timeStamp: performance.now(), preventDefault() {}, stopPropagation() {}, ...props };
      for (const fn of fns.get(t) || []) fn(ev);
      return ev;
    },
  };
}

beforeEach(() => { globalThis.window = target(); });

async function setup({ camera = null } = {}) {
  const h = coopHarness();
  const store = h.a.store;
  const canvas = Object.assign(target(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 64 * PX, height: 64 * PX, right: 64 * PX, bottom: 64 * PX }),
    setPointerCapture() {},
  });
  const calls = { ghost: [], highlight: [], pan: [], zoom: [], rotate: [], focus: [], hover: [] };
  const frames = new Set();
  const view = {
    pick(ndc) {
      const px = (((ndc.x + 1) / 2) * 64 * PX) / PX;
      const pz = (((1 - ndc.y) / 2) * 64 * PX) / PX;
      const x = Math.floor(px);
      const z = Math.floor(pz);
      const id = tileOwner(store.state, x, z);
      return id ? { kind: 'object', id, x, z, px, pz } : { kind: 'tile', x, z, px, pz };
    },
    ghost: { show: (d, r) => calls.ghost.push(['show', d, r]), hide: () => calls.ghost.push(['hide']), update: (t, v, c) => calls.ghost.push(['update', t, v, c]) },
    grid() {}, objects: { hidden() {} },
    highlight: (tiles, style) => calls.highlight.push([tiles, style]),
    fx: { play() {} },
    camera: camera ?? {
      get: () => ({ tx: 0, tz: 0, dist: 55, yaw: Math.PI / 4 }),
      pan: (r, f) => calls.pan.push([r, f]), zoom: (f, ndc) => calls.zoom.push([f, ndc]), rotate: (d) => calls.rotate.push(d),
    },
    focus: (x, z) => calls.focus.push([x, z]), invalidate() {}, interact() {},
    onFrame(fn) { frames.add(fn); return () => frames.delete(fn); },
    partner: { pose: () => null },
    toScreen: (x, z) => ({ x: x * PX, y: z * PX, visible: true }),
  };
  const avatar = { pose: { x: 0, z: 0 }, goes: [], cursor: null, walkTo() {}, goTo(x, z) { this.goes.push([x, z]); return { x, z, reached: true }; },
    setCursor(c) { this.cursor = c; }, setTool() {} };
  const toasts = [];
  const { createController } = await import('../public/js/game/controller.js');
  const c = createController({ store, view, avatar, canvas, send() {}, toast: (code, o) => toasts.push([code, o]) });
  c.on('hover', (p) => calls.hover.push(p));
  const at = (x, z, id = 1) => ({ clientX: (x + 0.5) * PX, clientY: (z + 0.5) * PX, pointerId: id, pointerType: 'touch', button: 0 });
  const t = {
    down: (x, z, id = 1) => canvas.dispatch('pointerdown', at(x, z, id)),
    move: (x, z, id = 1) => canvas.dispatch('pointermove', at(x, z, id)),
    up: (x, z, id = 1) => canvas.dispatch('pointerup', at(x, z, id)),
    /** a finger at CSS px (not tiles) */
    downPx: (x, y, id = 1) => canvas.dispatch('pointerdown', { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', button: 0 }),
    movePx: (x, y, id = 1) => canvas.dispatch('pointermove', { clientX: x, clientY: y, pointerId: id, pointerType: 'touch' }),
    upPx: (x, y, id = 1) => canvas.dispatch('pointerup', { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', button: 0 }),
    tap(x, z, id = 1) { this.down(x, z, id); this.up(x, z, id); },
  };
  return { h, store, view, c, t, calls, toasts, avatar, canvas, frame: (dt = 0.016) => { for (const fn of frames) fn(dt, 0); } };
}

const plotsSorted = (s) => Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'plot')
  .sort((a, b) => s.farm.objects[a].z - s.farm.objects[b].z || s.farm.objects[a].x - s.farm.objects[b].x);

test('touch: a press does nothing yet; the tap acts on release, with the tool in hand', async () => {
  const { h, store, c, t, calls } = await setup();
  const o = (id) => store.state.farm.objects[id];
  const plot = plotsSorted(store.state)[0];
  c.setTool('seed_bag', { crop: 'wheat' });
  const inputs = [];
  c.on('input', (e) => inputs.push(e.kind));
  t.down(o(plot).x, o(plot).z);
  assert.equal(o(plot).crop, null, 'a finger down may still become a pan, a pinch or a long press');
  assert.equal(c.input, 'touch');
  assert.deepEqual(inputs, ['touch']);
  t.move(o(plot).x, o(plot).z);                       // a jitter inside the slop
  t.up(o(plot).x, o(plot).z);
  assert.equal(o(plot).crop?.def, 'wheat', 'planted on release');
  assert.equal(calls.hover.length, 0, 'a tap never opens the tooltip');
  assert.deepEqual(calls.highlight.at(-1), [[], null], 'the brush leaves with the finger');
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state));
});

test('touch: a one-finger drag from a plot paints the row (one press action + one batched frame)', async () => {
  const { h, store, c, t } = await setup();
  const o = (id) => store.state.farm.objects[id];
  const plots = plotsSorted(store.state);
  const row = plots.filter((id) => o(id).z === o(plots[0]).z);
  c.setTool('seed_bag', { crop: 'wheat' });
  const seq0 = store.seq;
  t.down(o(row[0]).x, o(row[0]).z);
  t.move(o(row.at(-1)).x, o(row.at(-1)).z);
  t.up(o(row.at(-1)).x, o(row.at(-1)).z);
  for (const id of row) assert.equal(o(id).crop?.def, 'wheat', `${id} planted`);
  assert.equal(store.seq - seq0, 2, 'the stroke started at the press point when the finger moved: press + swipe');
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state));
});

test('touch: a drag from open ground pans (grab the ground), never paints; it glides on after a quick flick', async () => {
  const cam = { tx: 0, tz: 0, dist: 55, yaw: Math.PI / 4 };
  const pans = [];
  const { store, c, t, frame } = await setup({
    camera: { get: () => ({ ...cam }), pan: (r, f) => { pans.push([r, f]); cam.tx += r; cam.tz += f; }, zoom() {}, rotate() {} },
  });
  c.setTool('seed_bag', { crop: 'wheat' });
  const crops0 = Object.values(store.state.farm.objects).filter((x) => x.crop).length;
  t.down(12, 50);
  t.move(14, 52);
  await sleep(30);
  t.move(18, 55);
  assert.ok(pans.length >= 2, 'panned while the finger moved');
  t.up(18, 55);
  const n = pans.length;
  frame(); frame();
  assert.ok(pans.length > n, 'the view glides on after the finger lets go');
  t.down(12, 50);                                      // a new touch stops the glide
  const m = pans.length;
  frame();
  assert.equal(pans.length, m);
  t.up(12, 50);
  assert.equal(Object.values(store.state.farm.objects).filter((x) => x.crop).length, crops0, 'nothing planted');
});

test('touch: a long press shows the tooltip and does not act; a tooltip sent early never shows during a drag', async () => {
  const { store, c, t, calls } = await setup();
  const o = (id) => store.state.farm.objects[id];
  const [p1, p2] = plotsSorted(store.state);
  c.setTool('seed_bag', { crop: 'wheat' });
  t.down(o(p1).x, o(p1).z);
  await sleep(TOUCH.longMs + 60);
  assert.equal(calls.hover.at(-1)?.id, p1, 'the tooltip for the held plot');
  t.up(o(p1).x, o(p1).z);
  assert.equal(o(p1).crop, null, 'a long press never plants');
  calls.hover.length = 0;
  t.down(o(p2).x, o(p2).z);
  await sleep(TOUCH.longMs - TOUCH.tipLeadMs + 40);    // the early hover went out ...
  assert.equal(calls.hover.at(-1)?.id, p2);
  t.move(o(p2).x + 4, o(p2).z + 3);                    // ... and the drag takes it back
  assert.equal(calls.hover.at(-1), null);
  t.up(o(p2).x + 4, o(p2).z + 3);
  // a busy phone: the press already turned long when the first move arrives; the stroke takes the tooltip back too
  const p3 = plotsSorted(store.state)[2];
  calls.hover.length = 0;
  t.down(o(p3).x, o(p3).z);
  await sleep(TOUCH.longMs + 60);
  assert.equal(calls.hover.at(-1)?.id, p3);
  t.move(o(p3).x + 4, o(p3).z + 3);
  assert.equal(calls.hover.at(-1), null, 'no long-press card rides along a stroke');
  t.up(o(p3).x + 4, o(p3).z + 3);
});

test('touch: a second finger cancels the first finger\'s tap; pinch zooms, a twist turns the view, two lifts end it', async () => {
  const { store, c, t, calls } = await setup();
  const o = (id) => store.state.farm.objects[id];
  const plot = plotsSorted(store.state)[0];
  c.setTool('seed_bag', { crop: 'wheat' });
  const cx = (o(plot).x + 0.5) * PX;
  const cy = (o(plot).z + 0.5) * PX;
  t.downPx(cx, cy, 1);
  t.downPx(cx + 100, cy, 2);
  // spread the fingers: zoom in (factor < 1)
  t.movePx(cx - 20, cy, 1);
  t.movePx(cx + 140, cy, 2);
  assert.ok(calls.zoom.length > 0 && calls.zoom.every(([f]) => f < 1), JSON.stringify(calls.zoom));
  // twist clockwise round the midpoint by ~60 degrees: one quarter turn, clockwise on screen = rotate(+1)
  const mx = cx + 60;
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 3);
    t.movePx(mx - 80 * Math.cos(a), cy - 80 * Math.sin(a), 1);
    t.movePx(mx + 80 * Math.cos(a), cy + 80 * Math.sin(a), 2);
  }
  assert.deepEqual(calls.rotate, [1]);
  t.upPx(mx, cy, 2);
  t.movePx(mx + 30, cy + 30, 1);                       // the finger left on the glass does nothing ...
  t.upPx(mx + 30, cy + 30, 1);                         // ... not even a tap when it lifts
  assert.equal(o(plot).crop, null, 'the first finger never planted');
});

test('touch: a double tap on the same thing focuses the camera and does not act twice; quick taps on two plots both act', async () => {
  const { store, c, t, calls } = await setup();
  const o = (id) => store.state.farm.objects[id];
  const plots = plotsSorted(store.state);
  const row = plots.filter((id) => o(id).z === o(plots[0]).z);
  c.setTool('seed_bag', { crop: 'wheat' });
  t.tap(o(row[0]).x, o(row[0]).z);
  t.tap(o(row[1]).x, o(row[1]).z);
  assert.equal(o(row[0]).crop?.def, 'wheat');
  assert.equal(o(row[1]).crop?.def, 'wheat', 'tap tap on neighbours: two plantings, no focus');
  assert.equal(calls.focus.length, 0);
  c.setTool('hand');
  const coins = store.state.farm.wallet.coins;
  t.tap(12, 50);
  t.tap(12, 50);
  assert.equal(calls.focus.length, 1, 'the second tap focused');
  assert.equal(store.state.farm.wallet.coins, coins);
});

test('touch: walking follows taps on open ground, with the Hand and with a farming tool', async () => {
  const { c, t, avatar } = await setup();
  t.tap(12, 50);
  assert.deepEqual(avatar.goes.at(-1), [12.5, 50.5]);
  c.setTool('sickle');
  await sleep(TOUCH.doubleMs + 20);
  t.tap(13, 50);
  assert.deepEqual(avatar.goes.at(-1), [13.5, 50.5], 'the sickle on grass walks too');
});

test('touch build: the ghost starts in view, a tap moves it, a drag carries it above the finger, ✓ places it', async () => {
  const { h, store, c, t, calls } = await setup();
  for (const s of [store.state, h.state]) { s.farm.xp = xpForLevel(5); s.farm.wallet.coins = 50_000; }
  t.tap(5, 60);                                        // the player is on touch (a tap on open ground)
  const builds = [];
  c.on('build', (e) => builds.push(e));
  assert.equal(c.place('coop'), true);
  assert.ok(builds.at(-1) && Number.isFinite(builds.at(-1).x), 'the ghost shows without any hover: the middle of the view');
  let spot = null;
  for (let z = 14; z < 50 && !spot; z++) for (let x = 14; x < 50 && !spot; x++) if (canPlace(store.state, 'coop', x - 1, z - 1, 0) === null) spot = { x, z };
  const count = () => Object.values(store.state.farm.objects).filter((o) => o.def === 'coop').length;
  await sleep(TOUCH.doubleMs + 20);
  t.tap(spot.x, spot.z);
  assert.equal(count(), 0, 'the first tap only moves the ghost');
  assert.deepEqual([builds.at(-1).x, builds.at(-1).z, builds.at(-1).valid], [spot.x - 1, spot.z - 1, true]);
  // carry it with a drag that starts on the ghost: it rides above the finger
  t.down(spot.x, spot.z);
  t.move(spot.x + 3, spot.z + 3);
  const carried = builds.at(-1);
  assert.ok(carried.z < spot.z - 1 + 3, 'the ghost rides above the finger, not under it');
  t.up(spot.x + 3, spot.z + 3);
  assert.equal(count(), 0, 'carrying never places');
  // back to the free spot and confirm (the bar's ✓)
  await sleep(TOUCH.doubleMs + 20);
  t.tap(spot.x, spot.z);
  const res = c.confirm();
  assert.ok(res && res.ok, JSON.stringify(res));
  assert.equal(count(), 1);
  assert.equal(c.tool.id, 'hand', 'a building returns to the Hand');
  assert.ok(calls.ghost.some((g) => g[0] === 'hide'));
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state));
});

test('touch build: a tap on the ghost itself places it; the default Hammer picks a placed thing up with a tap', async () => {
  const { h, store, c, t } = await setup();
  for (const s of [store.state, h.state]) { s.farm.xp = xpForLevel(5); s.farm.wallet.coins = 50_000; }
  t.tap(5, 60);
  c.place('coop');
  let spot = null;
  for (let z = 14; z < 50 && !spot; z++) for (let x = 14; x < 50 && !spot; x++) if (canPlace(store.state, 'coop', x - 1, z - 1, 0) === null) spot = { x, z };
  await sleep(TOUCH.doubleMs + 20);
  t.tap(spot.x, spot.z);
  t.tap(spot.x, spot.z);                               // the same spot again = on the ghost: it goes down
  const coop = Object.keys(store.state.farm.objects).find((id) => store.state.farm.objects[id].def === 'coop');
  assert.ok(coop, 'placed by tapping the ghost');
  c.setTool('hammer');
  const builds = [];
  c.on('build', (e) => builds.push(e));
  await sleep(TOUCH.doubleMs + 20);
  t.tap(spot.x, spot.z);
  assert.equal(c.tool.build?.moveId, coop, 'picked up for a move');
  assert.deepEqual([builds.at(-1).x, builds.at(-1).z], [store.state.farm.objects[coop].x, store.state.farm.objects[coop].z],
    'its ghost starts where it stands');
  c.cancel();
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state));
});

test('touch build: after a plot goes down the ghost moves on to the next free spot, so ✓ ✓ ✓ lays a row', async () => {
  const { h, store, c, t } = await setup();
  for (const s of [store.state, h.state]) { s.farm.xp = xpForLevel(5); s.farm.wallet.coins = 50_000; }
  t.tap(5, 60);
  assert.equal(c.place('plot'), true);
  const plots = () => Object.values(store.state.farm.objects).filter((o) => o.def === 'plot').length;
  const n0 = plots();
  const first = c.confirm();
  assert.ok(first && first.ok, JSON.stringify(first));
  assert.equal(c.tool.build?.def, 'plot', 'plots stay in build mode');
  const second = c.confirm();
  assert.ok(second && second.ok, `the ghost moved to a free spot: ${JSON.stringify(second)}`);
  assert.equal(plots(), n0 + 2);
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state));
});

test('uproot without a Shift key: canUproot / uproot pull a growing crop up whatever the tool (the touch card)', async () => {
  const { h, store, c } = await setup();
  const plot = plotsSorted(store.state)[0];
  assert.equal(c.canUproot(plot), false, 'an empty plot has nothing to pull');
  c.setTool('seed_bag', { crop: 'wheat' });
  store.act('plant', { id: plot, crop: 'wheat' });
  assert.equal(c.canUproot(plot), true);
  const coins = store.state.farm.wallet.coins;
  const r = c.uproot(plot);
  assert.ok(r && r.ok, JSON.stringify(r));
  assert.equal(store.state.farm.objects[plot].crop, null);
  assert.ok(store.state.farm.wallet.coins >= coins, 'the seed comes back inside the undo window');
  assert.equal(c.uproot(plot), null, 'nothing left to pull');
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state));
});

test('mouse still acts on press (desktop unchanged) and switches the input kind back', async () => {
  const { store, c, canvas } = await setup();
  const o = (id) => store.state.farm.objects[id];
  const plot = plotsSorted(store.state)[0];
  c.setTool('seed_bag', { crop: 'wheat' });
  canvas.dispatch('pointerdown', { button: 0, clientX: (o(plot).x + 0.5) * PX, clientY: (o(plot).z + 0.5) * PX, pointerId: 1, pointerType: 'mouse' });
  assert.equal(o(plot).crop?.def, 'wheat', 'the mouse press plants at once (GDD §7.1)');
  assert.equal(c.input, 'mouse');
  canvas.dispatch('pointerup', { button: 0, clientX: (o(plot).x + 0.5) * PX, clientY: (o(plot).z + 0.5) * PX, pointerId: 1, pointerType: 'mouse' });
});

test('options: haptics and keepAwake default on, persist, and the wake lock re-syncs on a change', async () => {
  const { c } = await setup();
  assert.equal(c.options.haptics, true);
  assert.equal(c.options.keepAwake, true);
  let synced = 0;
  c.device = { wakeLock: { sync: () => { synced++; } } };
  assert.equal(c.setOption('keepAwake', false), true);
  assert.equal(c.options.keepAwake, false);
  assert.equal(synced, 1);
});

// ---- device and viewport ---------------------------------------------------------------------------------------------
function fakeDoc() {
  const doc = Object.assign(target(), {
    visibilityState: 'visible', documentElement: { dataset: {}, style: { props: {}, setProperty(k, v) { this.props[k] = v; } } },
    fullscreenEnabled: true, fullscreenElement: null, activeElement: null,
  });
  doc.documentElement.requestFullscreen = async () => { doc.fullscreenElement = doc.documentElement; doc.dispatch('fullscreenchange'); };
  doc.exitFullscreen = async () => { doc.fullscreenElement = null; doc.dispatch('fullscreenchange'); };
  return doc;
}
const fakeWin = (secure, coarse = true) => Object.assign(target(), {
  isSecureContext: secure, innerWidth: 390, innerHeight: 844, scrollY: 0,
  matchMedia: (q) => ({ matches: q.includes('coarse') ? coarse : false }),
  scrollTo(x, y) { this.scrollY = y; },
});

test('device: no wake lock on the LAN page (http is not a secure context); fullscreen toggles and reports', async () => {
  const doc = fakeDoc();
  const requested = [];
  const nav = { wakeLock: { request: async (k) => { requested.push(k); return { release: async () => {} }; } } };
  const d = createDevice({ win: fakeWin(false), doc, nav });
  assert.equal(d.wakeLock.available, false);
  d.wakeLock.sync();
  assert.equal(requested.length, 0);
  assert.equal(d.fullscreen.available, true);
  const seen = [];
  d.on('fullscreen', (v) => seen.push(v));
  assert.equal(await d.fullscreen.toggle(), true);
  assert.equal(d.fullscreen.active, true);
  assert.equal(await d.fullscreen.toggle(), false);
  assert.deepEqual(seen, [true, false]);
  const iphone = createDevice({ win: fakeWin(false), doc: { ...fakeDoc(), fullscreenEnabled: false, webkitFullscreenEnabled: false }, nav: {} });
  assert.equal(iphone.fullscreen.available, false, 'iPhone Safari: no element fullscreen');
  assert.equal(await iphone.fullscreen.toggle(), false);
});

test('device: on a secure phone page the wake lock follows touches, the keepAwake option and idleness', async () => {
  const doc = fakeDoc();
  const win = fakeWin(true);
  let t = 0;
  let keep = true;
  const held = [];
  const nav = { wakeLock: { request: async () => { const s = { released: false, release: async () => { s.released = true; } }; held.push(s); return s; } } };
  const d = createDevice({ win, doc, nav, options: () => ({ keepAwake: keep }), idleMs: 1000, now: () => t });
  assert.equal(d.wakeLock.available, true);
  assert.equal(d.wakeLock.active, false, 'nothing before the first touch');
  win.dispatch('pointerdown');
  await sleep(0);
  assert.equal(d.wakeLock.active, true);
  t = 2000;                                            // idle longer than idleMs: the screen may sleep
  d.wakeLock.sync();
  assert.equal(d.wakeLock.active, false);
  assert.equal(held[0].released, true);
  win.dispatch('pointerdown');
  await sleep(0);
  assert.equal(d.wakeLock.active, true);
  keep = false;
  d.wakeLock.sync();
  assert.equal(d.wakeLock.active, false, 'the player turned it off');
  const desk = createDevice({ win: fakeWin(true, false), doc: fakeDoc(), nav });
  const before = held.length;
  desk.wakeLock.sync();
  await sleep(0);
  assert.equal(held.length, before, 'a desktop never holds the screen on');
});

test('viewport: the keyboard and orientation reach CSS; iOS\'s leftover scroll goes back to the top', () => {
  const doc = fakeDoc();
  const vv = Object.assign(target(), { width: 390, height: 844, offsetTop: 0 });
  const win = Object.assign(fakeWin(true), { visualViewport: vv, scrollY: 0 });
  const v = createViewport({ win, doc });
  const css = doc.documentElement.style.props;
  assert.equal(css['--vvh'], '844px');
  assert.equal(css['--kb'], '0px');
  assert.equal(doc.documentElement.dataset.orient, 'portrait');
  doc.activeElement = { tagName: 'INPUT' };
  vv.height = 500;
  win.scrollY = 300;
  vv.dispatch('resize');
  assert.equal(css['--kb'], '344px');
  assert.equal(doc.documentElement.dataset.keyboard, 'open');
  assert.equal(win.scrollY, 300, 'never while typing');
  doc.activeElement = null;
  vv.height = 844;
  vv.dispatch('resize');
  assert.equal(doc.documentElement.dataset.keyboard, undefined);
  assert.equal(win.scrollY, 0, 'scrolled back once the keyboard is gone');
  v.stop();
});

// ---- the build bar, audio, the manifest ------------------------------------------------------------------------------
test('touch build bar: under the ghost, above it near the tool tray, inside the screen', async () => {
  const { barSpot } = await import('../public/js/game/touch-build.js');
  const vp = { width: 390, height: 844, bottomReserve: 110 };
  const bar = { width: 200, height: 66 };
  const mid = barSpot({ left: 150, right: 250, top: 300, bottom: 360 }, bar, vp);
  assert.deepEqual([mid.x, mid.y, mid.above], [200, 374, false]);
  const low = barSpot({ left: 150, right: 250, top: 640, bottom: 700 }, bar, vp);
  assert.equal(low.above, true);
  assert.equal(low.y, 640 - 14 - 66);
  const edge = barSpot({ left: -40, right: 20, top: 100, bottom: 160 }, bar, vp);
  assert.equal(edge.x, 110, 'kept inside the left margin');
  const col = { left: 330, right: 380, top: 280, bottom: 500 };
  const beside = barSpot({ left: 260, right: 330, top: 300, bottom: 350 }, bar, vp, [col]);
  assert.ok(beside.x + bar.width / 2 <= col.left - 6, `slid left of the HUD column: ${beside.x}`);
  const clear = barSpot({ left: 260, right: 330, top: 600, bottom: 640 }, bar, vp, [{ ...col, top: 0, bottom: 100 }]);
  assert.equal(clear.x, 280, 'a column elsewhere changes nothing');
});

test('audio: iOS-activating gestures unlock the context', () => {
  for (const ev of ['touchend', 'pointerup', 'click', 'keydown']) assert.ok(UNLOCK_EVENTS.includes(ev), ev);
});

test('manifest: standalone, theme colours, 192 and 512 px icons (and maskable) that exist at those sizes', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.name, 'Harvest Hollow');
  assert.ok(m.short_name && m.short_name.length <= 15, 'fits under a home-screen icon');
  assert.match(m.theme_color, /^#[0-9A-Fa-f]{6}$/);
  assert.match(m.background_color, /^#[0-9A-Fa-f]{6}$/);
  assert.equal(m.start_url, '/');
  const sizeOf = (file) => {
    const b = fs.readFileSync(file);
    assert.equal(b.toString('ascii', 1, 4), 'PNG', file);
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
  };
  for (const want of ['192x192', '512x512']) {
    for (const purpose of ['any', 'maskable']) {
      const icon = m.icons.find((i) => i.sizes === want && i.purpose === purpose);
      assert.ok(icon, `${want} ${purpose}`);
      assert.equal(sizeOf(path.join(ROOT, 'public', icon.src)), want, icon.src);
    }
  }
  assert.equal(sizeOf(path.join(ROOT, 'public', 'assets', 'pwa', 'apple-touch-icon.png')), '180x180');
});

test('touch: no browser click after a finger on the farm (a tap that opens the seed picker must not also choose a seed)', async () => {
  const { canvas } = await setup();
  let prevented = 0;
  canvas.dispatch('touchend', { cancelable: true, preventDefault() { prevented++; } });
  assert.equal(prevented, 1, 'touchend on the canvas cancels the compatibility click');
  canvas.dispatch('touchend', { cancelable: false, preventDefault() { prevented++; } });
  assert.equal(prevented, 1, 'an uncancelable touchend (a scroll in progress) is left alone');
  // the click would have taken the focus off a text field: the farm does it instead (the keyboard closes)
  const saved = globalThis.document;
  let blurred = 0;
  const field = { matches: (sel) => sel.includes('input'), blur() { blurred++; } };
  globalThis.document = { activeElement: field, body: {} };
  try {
    canvas.dispatch('touchend', { cancelable: true, preventDefault() {} });
    assert.equal(blurred, 1);
  } finally {
    globalThis.document = saved;
  }
});

test('touch: a Hand drag that starts on bare ground beside a weed pans; a tap there still clears it (mobile QA M-15)', async () => {
  const cam = { tx: 0, tz: 0, dist: 55, yaw: Math.PI / 4 };
  const pans = [];
  const { store, c, t, view } = await setup({
    camera: { get: () => ({ ...cam }), pan: (r, f) => { pans.push([r, f]); cam.tx += r; cam.tz += f; }, zoom() {}, rotate() {} },
  });
  const weeds = Object.keys(store.state.farm.objects).filter((id) => store.state.farm.objects[id].def === 'weed');
  const [w1, w2] = weeds.map((id) => store.state.farm.objects[id]);
  const pick = view.pick;
  // the finger lands on bare ground; the tolerance rings found the weed next to it (render/picking.js pickNear)
  view.pick = (ndc) => { const p = pick(ndc); return p && p.kind === 'object' ? { ...p, near: 10 } : p; };
  c.setTool('hand');
  t.down(w1.x, w1.z);
  t.move(w1.x + 2, w1.z + 2);
  t.move(w1.x + 4, w1.z + 4);
  t.up(w1.x + 4, w1.z + 4);
  assert.ok(pans.length >= 1, 'the drag panned the farm');
  assert.ok(Object.hasOwn(store.state.farm.objects, weeds[0]), 'the weed beside the finger is still there');
  t.tap(w2.x, w2.z);
  assert.equal(Object.hasOwn(store.state.farm.objects, weeds[1]), false, 'a tap beside a weed still clears it');
});

test('touch: a pinch with one finger on a HUD card and one on the farm still zooms, whichever lands first (mobile QA P1-2)', async () => {
  globalThis.document = target();
  try {
    const { c, t, calls } = await setup();
    c.setTool('hand');
    const onCard = { closest: (sel) => (sel.includes('#hud') ? {} : null) };
    const hud = (type, x, y, id) => globalThis.document.dispatch(type, { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', target: onCard });
    // the farm finger first, then a finger on the card: the canvas takes the card finger over
    t.downPx(300, 400, 1);
    hud('pointerdown', 300, 200, 2);
    t.movePx(300, 430, 1);
    t.movePx(300, 170, 2);                             // captured: its moves now reach the canvas
    assert.ok(calls.zoom.length > 0 && calls.zoom.every(([f]) => f < 1), `spread zooms in: ${JSON.stringify(calls.zoom)}`);
    t.upPx(300, 170, 2);
    t.upPx(300, 430, 1);
    hud('pointerup', 300, 170, 2);
    // the card finger first, the farm finger a moment later
    const n = calls.zoom.length;
    hud('pointerdown', 300, 200, 3);
    t.downPx(300, 400, 4);
    t.movePx(300, 380, 4);
    t.movePx(300, 220, 3);
    assert.ok(calls.zoom.length > n && calls.zoom.slice(n).every(([f]) => f > 1), 'pinching in zooms out');
    t.upPx(300, 220, 3);
    t.upPx(300, 380, 4);
    // a finger on the card long after the farm finger is a tap on the card, not a pinch
    const m = calls.zoom.length;
    t.downPx(300, 400, 5);
    await sleep(420);
    hud('pointerdown', 300, 200, 6);
    t.movePx(300, 380, 5);
    assert.equal(calls.zoom.length, m);
    t.upPx(300, 380, 5);
    hud('pointerup', 300, 200, 6);
  } finally {
    delete globalThis.document;
  }
});
