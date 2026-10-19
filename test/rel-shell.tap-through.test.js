// The tap-through bug (found by the phone-edge lane, 2026-10-19): the second tap of a double tap on a Farm book tile that
// closes the book (Emotes, Chat) landed on the farm under it and acted there (on the owners' farm at 360 x 640 it walked
// the farmer; with another framing it pulled a weed and e2e-mobile S2-05 saw 2 coins). A sheet or panel closed by a press
// (a tile, a ✕, the scrim) now leaves the farm deaf for TOUCH.quietMs: a tap or a mouse press there does nothing, a drag
// still pans. Browser proof: .scratch/phone-edge/tapthrough.mjs (before: "Emotes: walk"; after: nothing reaches it).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tileOwner } from '../shared/rules/grid.js';
import { coopHarness } from './helpers/client.js';
import { TOUCH, createQuiet } from '../public/js/game/touch.js';

const PX = 10;                                       // one tile = 10 css px on the fake canvas
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('createQuiet: a sheet a press closed makes the farm deaf for quietMs; nothing else does', () => {
  assert.equal(TOUCH.quietMs, 400);
  assert.ok(TOUCH.quietMs > TOUCH.doubleMs, 'longer than a double tap');
  const q = createQuiet();
  assert.equal(q.blocks(0), false, 'quiet at the start');
  q.closed(1000);
  assert.equal(q.blocks(1001), false, 'a sheet that closed with no press (Escape, by itself) changes nothing');
  q.press(2000);
  q.closed(2010);                                    // the tile's click closed the book
  assert.equal(q.blocks(2010 + 150), true, 'the twin tap 150 ms later');
  assert.equal(q.blocks(2010 + TOUCH.quietMs - 1), true);
  assert.equal(q.blocks(2010 + TOUCH.quietMs), false, 'then the farm answers again');
  q.press(5000);
  q.closed(5000 + TOUCH.quietLinkMs + 1);
  assert.equal(q.blocks(5000 + TOUCH.quietLinkMs + 2), false, 'a press long before the close is not what closed it');
  q.press(7000);
  q.closed(6990);
  assert.equal(q.blocks(7001), false, 'a close before the press is not from it');
  const custom = createQuiet({ ms: 50, link: 10 });
  custom.press(0);
  custom.closed(5);
  assert.equal(custom.blocks(54), true);
  assert.equal(custom.blocks(55), false);
});

// ---- the controller: a fake canvas, document and panel registry (the shapes of test/mobile-input.test.js) -----------
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

async function setup() {
  const h = coopHarness();
  const store = h.a.store;
  const doc = target();
  globalThis.document = doc;
  const canvas = Object.assign(target(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 64 * PX, height: 64 * PX, right: 64 * PX, bottom: 64 * PX }),
    setPointerCapture() {},
  });
  const pans = [];
  const view = {
    pick(ndc) {
      const px = (((ndc.x + 1) / 2) * 64 * PX) / PX;
      const pz = (((1 - ndc.y) / 2) * 64 * PX) / PX;
      const x = Math.floor(px);
      const z = Math.floor(pz);
      const id = tileOwner(store.state, x, z);
      return id ? { kind: 'object', id, x, z, px, pz } : { kind: 'tile', x, z, px, pz };
    },
    ghost: { show() {}, hide() {}, update() {} },
    grid() {}, objects: { hidden() {} }, highlight() {}, fx: { play() {} },
    camera: { get: () => ({ tx: 0, tz: 0, dist: 55, yaw: Math.PI / 4 }), pan: (r, f) => pans.push([r, f]), zoom() {}, rotate() {} },
    focus() {}, invalidate() {}, interact() {}, onFrame() { return () => {}; }, partner: { pose: () => null },
    toScreen: (x, z) => ({ x: x * PX, y: z * PX, visible: true }),
  };
  const avatar = { pose: { x: 0, z: 0 }, goes: [], cursor: null, walkTo() {}, goTo(x, z) { this.goes.push([x, z]); return { x, z, reached: true }; },
    setCursor(c) { this.cursor = c; }, setTool() {} };
  // the ui's panel registry as far as the controller listens to it
  const closes = new Set();
  const panels = { on(ev, fn) { if (ev === 'close') closes.add(fn); return () => closes.delete(fn); }, isOpen: () => false, top: () => null, has: () => false };
  const closePanel = () => { for (const fn of closes) fn('menu'); };
  const { createController } = await import('../public/js/game/controller.js');
  const c = createController({ store, view, avatar, canvas, ui: { panels }, send() {}, toast() {} });
  const at = (x, z, type = 'touch') => ({ clientX: (x + 0.5) * PX, clientY: (z + 0.5) * PX, pointerId: 1, pointerType: type, button: 0 });
  /** A tap on a Farm book tile that closes the book: its press and click land on the tile (off the canvas). */
  const tileTapThatCloses = () => {
    const tile = { id: 'tile' };
    doc.dispatch('pointerdown', { target: tile });
    doc.dispatch('pointerup', { target: tile });
    doc.dispatch('click', { target: tile });
    closePanel();
  };
  const tap = (x, z) => { canvas.dispatch('pointerdown', { ...at(x, z), target: canvas }); canvas.dispatch('pointerup', { ...at(x, z), target: canvas }); };
  return { store, c, canvas, avatar, pans, doc, at, tap, tileTapThatCloses, closePanel };
}

test('a double tap on a tile that closes the book: its twin on the farm does nothing; a tap a moment later walks', async () => {
  const { avatar, tap, tileTapThatCloses } = await setup();
  tap(12, 50);
  assert.deepEqual(avatar.goes.at(-1), [12.5, 50.5], 'a tap on open ground walks (the control)');
  await sleep(TOUCH.doubleMs + 20);
  const n = avatar.goes.length;
  tileTapThatCloses();
  tap(20, 50);                                        // the second tap of the double tap, on the farm under the tile
  assert.equal(avatar.goes.length, n, 'HEAD: the farmer walked to the tile\'s spot');
  await sleep(TOUCH.quietMs + 30);
  tap(21, 50);
  assert.deepEqual(avatar.goes.at(-1), [21.5, 50.5], 'the farm answers again after the quiet moment');
});

test('the twin cannot plant or harvest either (a plot under the tile), and a sheet closed without a press changes nothing', async () => {
  const { store, c, tap, tileTapThatCloses, closePanel } = await setup();
  const o = (id) => store.state.farm.objects[id];
  const plot = Object.keys(store.state.farm.objects).find((id) => o(id).def === 'plot' && !o(id).crop);
  c.setTool('seed_bag', { crop: 'wheat' });
  tileTapThatCloses();
  tap(o(plot).x, o(plot).z);
  assert.equal(o(plot).crop, null, 'nothing planted by the twin');
  await sleep(TOUCH.quietMs + 30);
  closePanel();                                       // a sheet that closes by itself (or by Escape): no press with it
  tap(o(plot).x, o(plot).z);
  assert.equal(o(plot).crop?.def, 'wheat', 'a tap right after a close nobody pressed plants as always');
});

test('mouse: the second click of a double click on a tile that closes the book does not plant; a click later does', async () => {
  const { store, c, canvas, at, avatar, tileTapThatCloses } = await setup();
  const o = (id) => store.state.farm.objects[id];
  const plot = Object.keys(store.state.farm.objects).find((id) => o(id).def === 'plot' && !o(id).crop);
  c.setTool('seed_bag', { crop: 'wheat' });
  tileTapThatCloses();
  const p = { ...at(o(plot).x, o(plot).z, 'mouse'), target: canvas };
  canvas.dispatch('pointerdown', p);
  canvas.dispatch('pointerup', p);
  assert.equal(o(plot).crop, null, 'HEAD: the mouse press planted at once');
  // a drag that starts in the quiet moment moves the camera (no action, no walk)
  tileTapThatCloses();
  const n = avatar.goes.length;
  canvas.dispatch('pointerdown', { ...at(30, 50, 'mouse'), target: canvas });
  canvas.dispatch('pointermove', { ...at(36, 50, 'mouse'), target: canvas });
  canvas.dispatch('pointerup', { ...at(36, 50, 'mouse'), target: canvas });
  assert.equal(avatar.goes.length, n, 'no walk from the drag');
  await sleep(TOUCH.quietMs + 30);
  canvas.dispatch('pointerdown', p);
  canvas.dispatch('pointerup', p);
  assert.equal(o(plot).crop?.def, 'wheat', 'the mouse press plants again after the quiet moment');
});
