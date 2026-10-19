// QA r1 S-01 (fbp#2): a stroke that starts on a planted or growing plot used to pan the camera and plant nothing.
// With a field tool in hand (the Hand holding a seed, the Seed Bag, the Sickle) a drag from a plot is a paint stroke:
// it plants (or harvests) every plot it crosses that can take the verb and never moves the camera. A press that
// does not move is still a click (its refusal, its card), mouse and touch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropOf } from '../shared/content/index.js';
import { controllerRig, plotsSorted, PX } from './helpers/ui-shell.js';

const WHEAT = cropOf('wheat');

/** The first row of plots (same z), left to right, at least `n` long. */
function rowOf(state, n = 4) {
  const plots = plotsSorted(state);
  const o = (id) => state.farm.objects[id];
  const rows = new Map();
  for (const id of plots) { const z = o(id).z; if (!rows.has(z)) rows.set(z, []); rows.get(z).push(id); }
  const row = [...rows.values()].find((r) => r.length >= n);
  assert.ok(row, `a row of ${n} plots: ${[...rows.values()].map((r) => r.length)}`);
  return row.sort((a, b) => o(a).x - o(b).x);
}

function spyPan(w) {
  const pans = [];
  w.view.camera.pan = (dx, dz) => pans.push([dx, dz]);
  return pans;
}

test('S-01 mouse: a drag from a growing plot with the armed Hand plants the empty plots it crosses, no pan', async () => {
  const { store, c, ptr, w } = await controllerRig();
  const o = (id) => store.state.farm.objects[id];
  const row = rowOf(store.state);
  assert.equal(c.plantWith('wheat', row[0]).ok, true, 'the picker plant');
  assert.deepEqual([c.tool.id, c.tool.crop, c.tool.seeding], ['hand', 'wheat', true]);
  const pans = spyPan(w);
  const z = o(row[0]).z;
  ptr.down(o(row[0]).x, z);
  for (let i = 1; i <= 3; i += 1) { ptr.move(o(row[i]).x, z); w.frame(); }
  ptr.up(o(row[3]).x, z);
  w.frame();
  assert.deepEqual(row.slice(1, 4).map((id) => o(id).crop?.def ?? null), ['wheat', 'wheat', 'wheat'], 'three planted');
  assert.equal(pans.length, 0, `the camera never moved: ${JSON.stringify(pans)}`);
});

test('S-01 mouse: the Sickle dragged from a growing plot harvests the ripe ones it crosses', async () => {
  const { h, store, c, ptr, w } = await controllerRig();
  const o = (id) => store.state.farm.objects[id];
  const row = rowOf(store.state);
  c.setTool('seed_bag', { crop: 'wheat' });
  for (const id of row.slice(1, 4)) ptr.click(o(id).x, o(id).z);
  h.flush();
  h.clock.advance(WHEAT.growMs + 1000);
  c.setTool('seed_bag', { crop: 'wheat' });
  ptr.click(o(row[0]).x, o(row[0]).z);                        // the first plot: just planted, growing
  h.flush();
  assert.ok(o(row[0]).crop && o(row[0]).crop.readyAt > store.now(), 'the first plot grows');
  c.setTool('sickle');
  const pans = spyPan(w);
  const z = o(row[0]).z;
  ptr.down(o(row[0]).x, z);
  for (let i = 1; i <= 3; i += 1) { ptr.move(o(row[i]).x, z); w.frame(); }
  ptr.up(o(row[3]).x, z);
  assert.deepEqual(row.slice(1, 4).map((id) => o(id).crop?.def ?? null), [null, null, null], 'three harvested');
  assert.ok(o(row[0]).crop, 'the growing plot keeps its crop');
  assert.equal(pans.length, 0, `the camera never moved: ${JSON.stringify(pans)}`);
});

test('S-01 mouse: a press on a growing plot that does not move is still a click (its reason, no stroke)', async () => {
  const { store, c, ptr, w, toasts } = await controllerRig();
  const o = (id) => store.state.farm.objects[id];
  const row = rowOf(store.state);
  c.setTool('seed_bag', { crop: 'wheat' });
  ptr.click(o(row[0]).x, o(row[0]).z);
  const fx = [];
  w.view.fx.float = (at, text) => fx.push(text);
  const before = JSON.stringify(row.map((id) => o(id).crop?.def ?? null));
  ptr.click(o(row[0]).x, o(row[0]).z);
  assert.equal(JSON.stringify(row.map((id) => o(id).crop?.def ?? null)), before, 'nothing planted');
  assert.ok(fx.length + toasts.length >= 1, `the click still answers: fx ${JSON.stringify(fx)} toasts ${JSON.stringify(toasts)}`);
});

test('S-01 touch: a finger dragged from the plot just planted plants the next three, no pan', async () => {
  const { store, c, w, commands } = await controllerRig();
  const o = (id) => store.state.farm.objects[id];
  const row = rowOf(store.state);
  const ev = (x, z, extra = {}) => ({ pointerType: 'touch', pointerId: 21, button: 0, isPrimary: true,
    clientX: (x + 0.5) * PX, clientY: (z + 0.5) * PX, timeStamp: performance.now(), ...extra });
  // tap the first plot, pick Wheat in the picker
  w.canvas.dispatch('pointerdown', ev(o(row[0]).x, o(row[0]).z));
  w.canvas.dispatch('pointerup', ev(o(row[0]).x, o(row[0]).z));
  const pick = commands.find((x) => x.cmd === 'seedPicker');
  assert.ok(pick, 'the picker opened');
  assert.equal(c.plantWith('wheat', pick.id).ok, true);
  await new Promise((r) => setTimeout(r, 450));              // past the double-tap window
  const pans = spyPan(w);
  const z = o(row[0]).z;
  w.canvas.dispatch('pointerdown', ev(o(row[0]).x, z, { pointerId: 22 }));
  for (let i = 1; i <= 3; i += 1) { w.canvas.dispatch('pointermove', ev(o(row[i]).x, z, { pointerId: 22 })); w.frame(); }
  w.canvas.dispatch('pointerup', ev(o(row[3]).x, z, { pointerId: 22 }));
  w.frame();
  assert.deepEqual(row.slice(1, 4).map((id) => o(id).crop?.def ?? null), ['wheat', 'wheat', 'wheat'], 'three planted by the finger');
  assert.equal(pans.length, 0, `the camera never moved: ${JSON.stringify(pans)}`);
});

// QA r1 S-17 (fbp#17): with the Sickle in hand after a harvest, a tap on an empty plot only said "Nothing to harvest
// there." and replanting took four taps. Now the plot asks which seed and the Hand comes back (M2's picker path).
test('S-17 touch: the Sickle tapped on an empty plot opens the seed picker and gives the Hand back', async () => {
  const { store, c, w, commands, toasts } = await controllerRig();
  const o = (id) => store.state.farm.objects[id];
  const row = rowOf(store.state);
  c.setTool('sickle');
  const e = { pointerType: 'touch', pointerId: 31, button: 0, isPrimary: true, clientX: (o(row[0]).x + 0.5) * PX, clientY: (o(row[0]).z + 0.5) * PX };
  w.canvas.dispatch('pointerdown', e);
  w.canvas.dispatch('pointerup', { ...e, timeStamp: performance.now() + 40 });
  const pick = commands.find((x) => x.cmd === 'seedPicker');
  assert.ok(pick && pick.id === row[0], `the picker opens at the plot: ${JSON.stringify(commands)}`);
  assert.equal(c.tool.id, 'hand', 'the Hand is back');
  assert.deepEqual(toasts.map(([code]) => code), [], 'no refusal');
  assert.equal(c.plantWith('wheat', pick.id).ok, true, 'the second tap plants');
});

test('S-17 mouse: the same with a click', async () => {
  const { store, c, ptr, commands } = await controllerRig();
  const o = (id) => store.state.farm.objects[id];
  const row = rowOf(store.state);
  c.setTool('sickle');
  ptr.click(o(row[1]).x, o(row[1]).z);
  assert.ok(commands.some((x) => x.cmd === 'seedPicker' && x.id === row[1]));
  assert.equal(c.tool.id, 'hand');
});
