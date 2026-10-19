// Release 1.0, ui-shell S7 (ux-first#15, #16; feel#7): placement and hover say why. A hover card has one line of what a
// click does with the tool in hand; a refusal on an object floats its specific reason at the object (no top-centre
// toast, so one sound: the bonk); a new placement's ghost starts on the nearest free spot (the Feed Mill next to the
// Coop, the guided "next to it" step).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFarm, T0, must } from './helpers.js';
import { cropOf, xpForLevel } from '../shared/content/index.js';
import { canPlace } from '../shared/rules/grid.js';
import { controllerRig, plotsSorted } from './helpers/ui-shell.js';

const HUD = await import('../public/js/ui/hud.js');
const WHEAT = cropOf('wheat');

test('S7: a hover card says what a click does with the tool in hand', () => {
  assert.equal(typeof HUD.verbLine, 'function', 'hud.js verbLine(state, pick, tool, pid, now, opts)');
  const s = makeFarm();
  const plots = plotsSorted(s);
  const pick = (id) => ({ kind: 'object', id });
  assert.equal(HUD.verbLine(s, pick(plots[0]), 'hand', 'p1', T0), 'Click to choose a seed');
  assert.equal(HUD.verbLine(s, pick(plots[0]), 'hand', 'p1', T0, { seeding: true, crop: 'wheat' }), 'Click to plant Wheat');
  must(s, 'plant', { id: plots[0], crop: 'wheat' });
  assert.equal(HUD.verbLine(s, pick(plots[0]), 'sickle', 'p1', T0 + WHEAT.growMs + 1), 'Click to harvest');
  const barn = Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'barn');
  assert.equal(HUD.verbLine(s, pick(barn), 'hand', 'p1', T0), 'Click to open it');
  const weed = Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'weed');
  if (weed) assert.equal(HUD.verbLine(s, pick(weed), 'hand', 'p1', T0), 'Click to pull it up');
  assert.equal(HUD.verbLine(s, { kind: 'tile', x: 1, z: 1, weed: { x: 1, z: 1 } }, 'hand', 'p1', T0), 'Click to pull it up');
  assert.equal(HUD.verbLine(s, pick(weed ?? barn), 'watering_can', 'p1', T0), weed ? 'The Hand does this' : null);
});

test('S7: a refusal on an object floats its reason at the object ("Wheat · ready in ..."), with no toast', async () => {
  const { store, c, w, ptr, toasts } = await controllerRig();
  const floats = [];
  w.view.fx.float = (at, text) => floats.push([at, text]);
  const plots = plotsSorted(store.state);
  const o = (id) => store.state.farm.objects[id];
  c.setTool('seed_bag', { crop: 'wheat' });
  ptr.click(o(plots[0]).x, o(plots[0]).z);
  c.setTool('sickle');
  ptr.click(o(plots[0]).x, o(plots[0]).z);
  assert.equal(floats.length, 1, `one floater: ${JSON.stringify(floats)} toasts ${JSON.stringify(toasts)}`);
  assert.match(floats[0][1], /^Wheat · ready in /);
  assert.deepEqual(floats[0][0], { x: o(plots[0]).x + 0.5, z: o(plots[0]).z + 0.5 }, 'at the plot');
  assert.deepEqual(toasts, [], 'no top-centre toast');
});

test('S7: a new placement starts its ghost on a free spot; the Feed Mill starts next to the Coop', async () => {
  const { store, c, h } = await controllerRig();
  for (const s of [store.state, h.state]) { s.farm.xp = xpForLevel(4); s.farm.wallet.coins = 50_000; }
  // a Coop with open land round it (the starter fields and paths crowd the middle of the farm)
  let spot = null;
  const open = (x, z) => [[0, 0], [3, 0]].every(([dx, dz]) => canPlace(store.state, 'coop', x + dx, z + dz, 0) === null);
  for (let z = 4; z < 60 && !spot; z++) for (let x = 4; x < 60 && !spot; x++) if (open(x, z)) spot = { x, z };
  assert.ok(spot, 'open land for the test');
  assert.equal(store.act('place', { def: 'coop', ...spot, rot: 0 }).ok, true);
  c.place('feed_mill');
  const hv = c.hover;
  assert.ok(hv, 'the ghost has a spot before the mouse moves');
  const d = Math.max(Math.abs(hv.x - spot.x), Math.abs(hv.z - spot.z));
  assert.ok(d <= 5, `next to the Coop (${d} tiles away)`);
  const b = c.tool.build;
  assert.equal(canPlace(store.state, 'feed_mill', hv.x - Math.floor((2 - 1) / 2), hv.z - Math.floor((2 - 1) / 2), b.rot) === null
    || canPlace(store.state, 'feed_mill', hv.x - 1, hv.z - 1, b.rot) === null || canPlace(store.state, 'feed_mill', hv.x, hv.z, b.rot) === null, true, 'a spot it fits');
});
