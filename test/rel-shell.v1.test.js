// Release 1.0, ui-shell, verify-1 fixes (docs/qa/release/verify-1/fix-ui-shell.md).
// V1-S1 (sibling of the verdict's D-1): the bench chip's "Join" walked the farmer to a bench the screen did not show
// (the chip shows while the partner sits; the bench was off the right edge of a 360 screen and Golden Hour started off
// screen). Join now eases the camera to the bench first, the way the gift door focuses the waiting box (social.js
// openGift).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { createFarm } from '../shared/rules/state.js';
import { xpForLevel } from '../shared/content/index.js';
import { T0 } from './helpers.js';

// the chip re-checks itself when its 2 minutes end: those timers must not keep this test file running
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const id = realTimeout(fn, ms, ...a); id?.unref?.(); return id; };

/** The rig of rel-shell.together.test.js, with one `order` list that the camera and the controller both write to. */
function rig({ seats = {}, now = T0, withSit = true, bench = { x: 20, z: 20 } } = {}) {
  const document = installDom();
  document.querySelector = (sel) => document.body.querySelector(sel);
  const proto = Object.getPrototypeOf(document.createElement('i'));
  if (!proto.hiddenReflects) {
    const set = proto.setAttribute;
    proto.setAttribute = function setAttribute(k, v) {
      if (k === 'hidden') this.hidden = true;
      return set.call(this, k, v);
    };
    proto.hiddenReflects = true;
  }
  for (const [tag, id] of [['div', 'hud'], ['div', 'social'], ['canvas', 'world']]) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.append(el);
  }
  globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
  globalThis.innerWidth = 360;
  globalThis.innerHeight = 640;
  const state = createFarm(7, T0);
  state.farm.xp = xpForLevel(6);
  state.players.p1 = { ...state.players.p1, name: 'Ana' };
  state.players.p2 = { ...(state.players.p2 ?? state.players.p1), name: 'Bo' };
  state.farm.objects.bench9 = { def: 'bench', x: bench.x, z: bench.z, rot: 0, placedAt: T0, by: 'p1' };
  state.farm.coop = { ...state.farm.coop, bench: seats };
  const store = { state, pid: 'p1', now: () => now, subscribe: () => () => {}, on() { return () => {}; } };
  const order = [];
  const controller = {
    input: 'touch', tool: { id: 'hand' }, on() { return () => {}; }, setTool() {},
    actOn: (t) => { order.push(['act', t.id]); },
    ...(withSit ? { sitOn: (id) => { order.push(['sit', id]); return true; } } : {}),
  };
  const panels = { has: () => false, open() {}, toggle() {}, top: () => null, on() { return () => {}; } };
  const ui = { toast() {}, panels };
  const view = { avatars: null, onFrame() {}, focus: (x, z) => { order.push(['focus', x, z]); } };
  return { document, order, S: { store, controller, ui, view } };
}

test('V1-S1: the bench chip\'s Join shows the bench (view.focus on it) before it walks me over to sit', async () => {
  const { createSocial } = await import('../public/js/ui/social.js');
  const r = rig({ seats: { p2: { id: 'bench9', at: T0 - 10_000 } } });
  createSocial(r.S);
  const chip = r.document.getElementById('hud').querySelector('.bench-chip');
  assert.equal(chip.hidden, false, 'the partner sits: the chip shows');
  chip.querySelector('.bc-join').click();
  assert.deepEqual(r.order, [['focus', 20.5, 20.5], ['sit', 'bench9']],
    'Join: the camera eases to the bench first, then the controller walks me there and sits me down');
  assert.equal(chip.hidden, true, 'the chip goes once I join');
});

test('V1-S1: without controller.sitOn (the Hand-on-bench path): focus first, then the Hand acts on it', async () => {
  const { createSocial } = await import('../public/js/ui/social.js');
  const r = rig({ seats: { p2: { id: 'bench9', at: T0 - 10_000 } }, withSit: false, bench: { x: 36, z: 33 } });
  createSocial(r.S);
  r.document.getElementById('hud').querySelector('.bench-chip .bc-join').click();
  assert.deepEqual(r.order, [['focus', 36.5, 33.5], ['act', 'bench9']]);
});

test('V1-S1: a bench that is gone by the time I tap Join moves no camera (the chip re-checks itself)', async () => {
  const { createSocial } = await import('../public/js/ui/social.js');
  const r = rig({ seats: { p2: { id: 'bench9', at: T0 - 10_000 } } });
  createSocial(r.S);
  delete r.S.store.state.farm.objects.bench9;
  r.document.getElementById('hud').querySelector('.bench-chip .bc-join').click();
  assert.deepEqual(r.order, [], 'no focus, no walk');
});
