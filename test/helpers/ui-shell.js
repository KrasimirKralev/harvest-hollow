// ui-shell lane test helpers (release 1.0): the controller end to end in node over the real co-op harness, with a
// fake canvas and a fake view whose picks are tiles (the same rig as test/sync.controller.test.js), plus a tiny DOM-free
// event target for `window`.
import { tileOwner } from '../../shared/rules/grid.js';
import { coopHarness } from './client.js';

export const PX = 10;                               // one tile = 10 css px on the fake canvas

/** A tiny event target: addEventListener + dispatch(type, props) with a plain event object. */
export function target() {
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

/** A fake canvas and view over `store`: tile picks, recorded highlight / ghost / fx calls. */
export function fakeWorld(store) {
  const canvas = Object.assign(target(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 64 * PX, height: 64 * PX }),
    setPointerCapture() {},
  });
  const calls = { ghost: [], highlight: [], fx: [], hidden: [], grid: [] };
  const frames = new Set();
  const view = {
    pick(ndc) {
      const cx = ((ndc.x + 1) / 2) * 64 * PX;
      const cy = ((1 - ndc.y) / 2) * 64 * PX;
      const px = cx / PX;
      const pz = cy / PX;
      const x = Math.floor(px);
      const z = Math.floor(pz);
      const id = tileOwner(store.state, x, z);
      return id ? { kind: 'object', id, x, z, px, pz } : { kind: 'tile', x, z, px, pz };
    },
    ghost: { show: (d, r) => calls.ghost.push(['show', d, r]), hide: () => calls.ghost.push(['hide']), update: (t, v, c, b) => calls.ghost.push(['update', t, v, c, b]) },
    grid: (v) => calls.grid.push(v),
    objects: { hidden: (id, h) => calls.hidden.push([id, h]) },
    highlight: (tiles, style) => calls.highlight.push([tiles, style]),
    fx: { play: (ev) => calls.fx.push(ev) },
    camera: { get: () => ({ tx: 0, tz: 0, dist: 55, yaw: Math.PI / 4 }), pan() {}, zoom() {}, rotate() {} },
    focus() {}, invalidate() {}, interact() {},
    onFrame(fn) { frames.add(fn); return () => frames.delete(fn); },
    partner: { pose: () => null },
    toScreen: () => ({ x: 0, y: 0, visible: true }),
  };
  return { canvas, view, calls, frame: (dt = 0.016) => { for (const fn of frames) fn(dt, 0); } };
}

/**
 * A controller for farmer A of a fresh co-op harness, with mouse helpers (tile coordinates) and the toasts and
 * 'command' events it raised. `ui` (optional) is handed to the controller (panels, openBuild).
 */
export async function controllerRig({ ui = null } = {}) {
  globalThis.window ??= target();
  const h = coopHarness();
  const store = h.a.store;
  const w = fakeWorld(store);
  const toasts = [];
  const commands = [];
  const avatar = { pose: { x: 0, z: 0 }, goes: [], walkTo() {}, goTo(x, z) { this.goes.push([x, z]); return { x, z, reached: true }; }, setCursor() {}, setTool() {} };
  const { createController } = await import('../../public/js/game/controller.js');
  const c = createController({ store, view: w.view, avatar, canvas: w.canvas, ui, send: () => {}, toast: (code, o) => toasts.push([code, o]) });
  c.on('command', (x) => commands.push(x));
  const at = (x, z) => ({ clientX: (x + 0.5) * PX, clientY: (z + 0.5) * PX, pointerId: 1 });
  const ptr = {
    down: (x, z, o = {}) => w.canvas.dispatch('pointerdown', { button: 0, ...at(x, z), ...o }),
    move: (x, z, o = {}) => w.canvas.dispatch('pointermove', { ...at(x, z), ...o }),
    up: (x, z, o = {}) => w.canvas.dispatch('pointerup', { button: 0, ...at(x, z), ...o }),
    click(x, z, o) { this.down(x, z, o); this.up(x, z, o); },
  };
  return { h, store, w, c, ptr, toasts, commands, avatar };
}

/** Plot ids in reading order (z, then x). */
export const plotsSorted = (s) => Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'plot')
  .sort((a, b) => s.farm.objects[a].z - s.farm.objects[b].z || s.farm.objects[a].x - s.farm.objects[b].x);
