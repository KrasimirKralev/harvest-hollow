// "You moved my building" (GDD §6.3, TRIAGE CL-05, coop-robust-15): the partner's move of MY decor (placed or
// pinned by me) gives me a notice with a one-click Move it back; the Hammer over anyone's moved object offers the
// move back (Ctrl+Z, and the 'build' hint carries moveBack); pins are reachable (controller.pin).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { xpForLevel } from '../shared/content/index.js';
import { canPlace } from '../shared/rules/grid.js';
import { coopHarness, eventTarget, fakeController } from './helpers/client.js';
import { createFeedback } from '../public/js/game/feedback.js';

beforeEach(() => { globalThis.window = eventTarget(); });

/** Level 8, coins; B (Mia) places a Bird Bath. */
async function rig() {
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) { s.farm.xp = xpForLevel(8); s.farm.wallet.coins = 5000; }
  const free = (from) => {
    for (let z = from.z; z < 50; z++) for (let x = from.x; x < 50; x++) if (canPlace(h.state, 'bird_bath', x, z, 0) === null) return { x, z };
    return null;
  };
  const spot = free({ x: 12, z: 12 });
  assert.equal(h.b.store.act('place', { def: 'bird_bath', ...spot, rot: 0 }).ok, true);
  h.flush();
  const id = Object.keys(h.state.farm.objects).find((k) => h.state.farm.objects[k].def === 'bird_bath');
  const b = await fakeController(h.b);
  const notes = [];
  const toasts = [];
  const ui = { toast: (code, o = {}) => toasts.push({ code, ...o }), notice: (text, o = {}) => notes.push({ text, ...o }) };
  const view = { toScreen: () => ({ x: 0, y: 0, visible: true }), fx: { play() {} }, stats: () => ({}) };
  const fb = createFeedback({ store: h.b.store, controller: b.ctl, view, audio: null, ui });
  return { h, id, spot, b, notes, toasts, fb, free };
}

test("Rowan moves Mia's Bird Bath: Mia gets a notice whose button moves it back", async () => {
  const { h, id, spot, notes, fb, free } = await rig();
  const to = free({ x: spot.x + 3, z: spot.z });
  assert.equal(h.a.store.act('move', { id, x: to.x, z: to.z, rot: 0 }).ok, true);
  h.flush();
  assert.deepEqual(notes.map((n) => [n.text, n.action?.label]), [['Rowan moved your Bird Bath.', 'Move it back']]);
  notes[0].action.fn();
  h.flush();
  assert.deepEqual([h.state.farm.objects[id].x, h.state.farm.objects[id].z], [spot.x, spot.z], 'back where Mia had it');
  fb.dispose();
});

test("a pinned decor stored by the partner: the pinner is told where it went", async () => {
  const { h, id, b, toasts, fb } = await rig();
  const r = b.ctl.pin(id);
  assert.equal(r.ok, true, 'Mia pins her Bird Bath through the controller');
  h.flush();
  assert.equal(h.state.farm.objects[id].pin, 'p2');
  assert.equal(h.a.store.act('store', { id, confirm: ['PINNED'] }).ok, true);
  h.flush();
  assert.deepEqual(toasts.map((t) => t.code), ['Rowan put your pinned Bird Bath away. It waits in the build tray (B).']);
  fb.dispose();
});

test('my own moves say nothing', async () => {
  const { h, id, spot, notes, toasts, fb, free } = await rig();
  const to = free({ x: spot.x + 3, z: spot.z });
  h.b.store.act('move', { id, x: to.x, z: to.z, rot: 0 });
  h.flush();
  assert.equal(notes.length + toasts.length, 0);
  fb.dispose();
});

test("the Hammer over an object the PARTNER moved: the hint offers a move back and Ctrl+Z does it", async () => {
  const { h, id, spot, b, fb, free } = await rig();
  const to = free({ x: spot.x + 3, z: spot.z });
  // Rowan moves Mia's bird bath; ROWAN's own Hammer could always undo it, so check from MIA's controller
  h.a.store.act('move', { id, x: to.x, z: to.z, rot: 0 });
  h.flush();
  const builds = [];
  b.ctl.on('build', (e) => builds.push(e));
  b.ctl.setTool('hammer');
  b.move(to.x, to.z);
  assert.equal(builds.at(-1)?.pickUp, id);
  assert.equal(builds.at(-1)?.moveBack, id, 'the hint says it can go back');
  globalThis.window.dispatch('keydown', { code: 'KeyZ', key: 'z', ctrlKey: true, target: {} });
  h.flush();
  assert.deepEqual([h.state.farm.objects[id].x, h.state.farm.objects[id].z], [spot.x, spot.z]);
  fb.dispose();
});

test('rearranging plots says nothing to their planter (the field is shared); pinned or placed decor does', async () => {
  const { h, notes, toasts, fb } = await rig();
  const plot = Object.keys(h.state.farm.objects).find((k) => h.state.farm.objects[k].def === 'plot');
  const o = h.state.farm.objects[plot];
  // make the plot Mia's (placed by p2) in every copy, then Rowan moves it
  for (const s of [h.state, h.a.store.state, h.b.store.state]) s.farm.objects[plot].by = 'p2';
  for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
  let moved = false;
  for (let dz = 3; dz < 20 && !moved; dz++) moved = h.a.store.act('move', { id: plot, x: o.x, z: o.z + dz, rot: 0 }).ok;
  assert.equal(moved, true);
  h.flush();
  assert.equal(notes.length + toasts.length, 0);
  fb.dispose();
});
