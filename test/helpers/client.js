// Client-core test helpers: batched delivery for the in-process co-op harness (test/helpers.js coopHarness),
// the way main.js's per-frame inbox feeds the store, plus an event recorder.
import { MSG } from '../../shared/net/protocol.js';
import { tileOwner } from '../../shared/rules/grid.js';

export * from '../helpers.js';

/**
 * Deliver up to n queued server frames to client c as ONE animation frame: runs of 'd'/'rej'/'ack' go to
 * store.onServerBatch in one call; a welcome in between is applied in its place (as main.js does).
 * @returns {number} how many frames were delivered
 */
export function deliverBatch(c, n = Infinity) {
  const list = c.toClient.splice(0, Math.min(n, c.toClient.length));
  let run = [];
  const flush = () => { if (run.length) { c.store.onServerBatch(run); run = []; } };
  for (const m of list) {
    if (m.t === MSG.WELCOME) { flush(); c.store.reset(m); } else run.push(m);
  }
  flush();
  return list.length;
}

/** Like h.flush() but every client receives its queue as one batch per round. */
export function flushBatched(h) {
  for (let guard = 0; guard < 10_000; guard++) {
    const busy = [h.a, h.b].some((c) => c.toServer.length || c.toClient.length);
    if (!busy) return;
    for (const c of [h.a, h.b]) h.deliverToServer(c);
    for (const c of [h.a, h.b]) deliverBatch(c);
  }
  throw new Error('harness did not settle');
}

/**
 * Record every store event of interest as plain data, in order.
 * @returns {{ log: Array<[string, object]>, stop(): void }}
 */
export function recordEvents(store, names = ['fx', 'celebrate', 'reject', 'lost', 'pending']) {
  const log = [];
  const offs = names.map((n) => store.on(n, (p) => {
    if (n === 'fx' || n === 'celebrate') log.push([n, { e: p.ev.e, by: p.by ?? null, local: Boolean(p.local), id: p.ev.id ?? null }]);
    else if (n === 'reject') log.push([n, { seq: p.seq, type: p.type ?? null, code: p.code, by: p.by ?? null, local: p.local }]);
    else log.push([n, JSON.parse(JSON.stringify(p))]);
  }));
  return { log, stop: () => offs.forEach((f) => f()) };
}

/** A tiny event target: addEventListener + dispatch(type, props) with a plain event object. */
export function eventTarget() {
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

/**
 * The real controller on harness client c, with a fake canvas (one tile = 10 css px, picks are tiles) and a fake
 * view and avatar that record what they were asked. Needs globalThis.window (eventTarget()) for the key listeners.
 * `peerTool(pid)`: the partner's presence tool (main.js's peers.js); `canvasRect()`: the canvas's client rect.
 * @returns {{ ctl, calls, walks, toasts, sent, canvas, rectCalls, frame(dt?), click(x, z, o?), down, move, up }}
 */
export async function fakeController(c, { onArrive = 'record', view: extra = {}, ui = null, peerTool = undefined, canvasRect = null } = {}) {
  const PX = 10;
  globalThis.window ??= eventTarget();
  let rectCalls = 0;
  const canvas = Object.assign(eventTarget(), {
    getBoundingClientRect: () => { rectCalls++; return canvasRect ? canvasRect() : { left: 0, top: 0, width: 64 * PX, height: 64 * PX }; },
    setPointerCapture() {},
  });
  const store = c.store;
  const calls = { fx: [], highlight: [], ghost: [] };
  const frames = new Set();
  const view = {
    pick(ndc) {
      const px = ((ndc.x + 1) / 2) * 64;
      const pz = ((1 - ndc.y) / 2) * 64;
      const x = Math.floor(px); const z = Math.floor(pz);
      const id = tileOwner(store.state, x, z);
      return id ? { kind: 'object', id, x, z, px, pz } : { kind: 'tile', x, z, px, pz };
    },
    ghost: { show: (...a) => calls.ghost.push(['show', ...a]), hide: () => calls.ghost.push(['hide']), update: (...a) => calls.ghost.push(['update', ...a]) },
    grid() {}, objects: { hidden() {} }, highlight: (...a) => calls.highlight.push(a),
    fx: { play: (ev) => calls.fx.push(ev) }, camera: { get: () => ({ dist: 55, yaw: 0 }), pan() {}, zoom() {}, rotate() {} },
    focus() {}, invalidate() {}, interact() {}, onFrame(fn) { frames.add(fn); return () => frames.delete(fn); },
    partner: { pose: () => null }, toScreen: () => ({ x: 0, y: 0, visible: true }),
    ...extra,
  };
  const walks = [];
  const avatar = {
    pose: { x: 0, z: 0 }, setCursor() {}, setTool() {},
    walkTo(x, z, w, d, fn) { walks.push({ x, z, w, d, onArrive: fn }); if (fn && onArrive === 'now') fn(); },
  };
  const toasts = [];
  const sent = [];
  const { createController } = await import('../../public/js/game/controller.js');
  const ctl = createController({ store, view, avatar, canvas, ui, send: (m) => sent.push(m), toast: (code, o) => toasts.push([code, o]),
    ...(peerTool ? { peerTool } : {}) });
  const at = (x, z) => ({ clientX: (x + 0.5) * PX, clientY: (z + 0.5) * PX, pointerId: 1 });
  const down = (x, z, o = {}) => canvas.dispatch('pointerdown', { button: 0, ...at(x, z), ...o });
  const move = (x, z, o = {}) => canvas.dispatch('pointermove', { ...at(x, z), ...o });
  const up = (x, z, o = {}) => canvas.dispatch('pointerup', { button: 0, ...at(x, z), ...o });
  return {
    ctl, calls, walks, toasts, sent, down, move, up, canvas,
    /** how many times the controller measured the canvas (forced layout per pointer event: qa2 CL-05) */
    get rectCalls() { return rectCalls; },
    click(x, z, o) { down(x, z, o); up(x, z, o); },
    frame: (dt = 0.016) => { for (const fn of frames) fn(dt, 0); },
  };
}
