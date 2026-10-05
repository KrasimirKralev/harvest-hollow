// Owner request 2026-10-04 on the client: the Hammer picks up the Barn (and every other landmark) instead of a red
// "That spot isn't free" ghost; the ghost carries it, a click puts it down (predicted at once), the partner sees it;
// a plot inside the Old Greenhouse lifts the whole frame; debris is still cleared, not moved.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { xpForLevel, defOf } from '../shared/content/index.js';
import { canFit, tileOwner } from '../shared/rules/grid.js';
import { coopHarness, eventTarget, fakeController } from './helpers/client.js';
import { allLand } from './helpers/rules.js';

beforeEach(() => { globalThis.window = eventTarget(); });

const idOf = (s, def) => Object.keys(s.farm.objects).sort().find((k) => s.farm.objects[k].def === def);

test('the Hammer over the Barn offers to pick it up; a click lifts it, a click on a free spot puts it there', async () => {
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) s.farm.xp = xpForLevel(4);
  const barn = idOf(h.state, 'barn');
  const o = { ...h.state.farm.objects[barn] };
  const a = await fakeController(h.a);
  const builds = [];
  a.ctl.on('build', (e) => builds.push(e));
  a.ctl.setTool('hammer');
  a.move(o.x + 1, o.z + 1);
  assert.equal(builds.at(-1)?.pickUp, barn, 'a pick-up hint, not a red ghost');
  a.click(o.x + 1, o.z + 1);
  assert.equal(a.ctl.tool.build?.moveId, barn, 'the Barn is in hand');
  assert.equal(a.toasts.length, 0, `no refusal toast: ${JSON.stringify(a.toasts)}`);
  // a free spot: the ghost centres the 4 x 4 footprint on the hovered tile (min corner one up-left of it)
  let to = null;
  for (let z = 8; z < 56 && !to; z++) for (let x = 8; x < 56 && !to; x++) {
    if (Math.abs(x - o.x) > 4 && canFit(h.state, 'barn', x, z, 0, barn) === null) to = { x, z };
  }
  a.move(to.x + 1, to.z + 1);
  a.click(to.x + 1, to.z + 1);
  assert.deepEqual([h.a.store.state.farm.objects[barn].x, h.a.store.state.farm.objects[barn].z], [to.x, to.z], 'predicted at once');
  h.flush();
  assert.deepEqual([h.b.store.state.farm.objects[barn].x, h.b.store.state.farm.objects[barn].z], [to.x, to.z], 'the partner sees it');
  assert.equal(tileOwner(h.state, to.x, to.z), barn);
  assert.deepEqual(h.state.farm.objects[barn].prev && [h.state.farm.objects[barn].prev.x, h.state.farm.objects[barn].prev.z], [o.x, o.z]);
  // and the partner's Hammer over it offers "Move back"
  const b = await fakeController(h.b);
  const bb = [];
  b.ctl.on('build', (e) => bb.push(e));
  b.ctl.setTool('hammer');
  b.move(to.x + 1, to.z + 1);
  assert.equal(bb.at(-1)?.moveBack, barn);
  assert.equal(b.ctl.moveBack(barn).ok, true);
  h.flush();
  assert.deepEqual([h.state.farm.objects[barn].x, h.state.farm.objects[barn].z], [o.x, o.z]);
});

test('every Homestead landmark can be lifted; debris is cleared, not moved', async () => {
  const h = coopHarness();
  const a = await fakeController(h.a);
  a.ctl.setTool('hammer');
  for (const def of ['farmhouse', 'barn', 'well', 'mailbox', 'market_stand', 'order_board']) {
    const id = idOf(h.state, def);
    const o = h.state.farm.objects[id];
    a.ctl.cancel();
    a.ctl.setTool('hammer');
    a.move(o.x, o.z);
    a.click(o.x, o.z);
    assert.equal(a.ctl.tool.build?.moveId, id, `${def} is in hand`);
  }
  a.ctl.cancel();
  a.ctl.setTool('hammer');
  const weed = Object.keys(h.state.farm.objects).sort().find((k) => defOf(h.state.farm.objects[k].def).kind === 'debris');
  const w = h.state.farm.objects[weed];
  a.move(w.x, w.z);
  a.click(w.x, w.z);
  assert.notEqual(a.ctl.tool.build?.moveId, weed);
});

test('a plot inside the Old Greenhouse lifts the whole frame (they move together)', async () => {
  assert.ok(defOf('greenhouse'), 'the Old Greenhouse is live (M1b+)');
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) { s.farm.xp = xpForLevel(20); s.farm.storage.greenhouse = 1; allLand(s); }
  let spot = null;
  for (let z = 8; z < 56 && !spot; z++) for (let x = 8; x < 56 && !spot; x++) if (canFit(h.state, 'greenhouse', x, z, 0) === null) spot = { x, z };
  assert.equal(h.a.store.act('place', { def: 'greenhouse', ...spot, rot: 0 }).ok, true);
  h.flush();
  const frame = idOf(h.state, 'greenhouse');
  const plot = Object.keys(h.state.farm.objects).sort().find((k) => h.state.farm.objects[k].gh === frame);
  const p = h.state.farm.objects[plot];
  const a = await fakeController(h.a);
  const builds = [];
  a.ctl.on('build', (e) => builds.push(e));
  a.ctl.setTool('hammer');
  a.move(p.x, p.z);
  assert.equal(builds.at(-1)?.pickUp, frame);
  a.click(p.x, p.z);
  assert.equal(a.ctl.tool.build?.moveId, frame);
});

test('Ctrl+Z with the Hammer resting where the partner just put the Barn: the Barn goes back, not my last purchase', async () => {
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) s.farm.xp = xpForLevel(6);
  const barn = idOf(h.state, 'barn');
  const o = { ...h.state.farm.objects[barn] };
  let to = null;
  for (let z = 16; z < 48 && !to; z++) for (let x = 16; x < 48 && !to; x++) if (Math.abs(x - o.x) > 4 && canFit(h.state, 'barn', x, z, 0, barn) === null) to = { x, z };
  let fb = null;
  for (let z = 47; z > 16 && !fb; z--) for (let x = 47; x > 16 && !fb; x--) {
    if (canFit(h.state, 'flower_bed', x, z, 0) === null && (x < to.x - 1 || x > to.x + 5 || z < to.z - 1 || z > to.z + 5)) fb = { x, z };
  }
  const a = await fakeController(h.a);
  assert.equal(h.a.store.act('place', { def: 'flower_bed', ...fb, rot: 0 }).ok, true, 'a fresh purchase: my newest undo');
  h.flush();
  const bed = idOf(h.state, 'flower_bed');
  const builds = [];
  a.ctl.on('build', (e) => builds.push(e));
  a.ctl.setTool('hammer');
  a.move(to.x + 1, to.z + 1);                              // bare ground: the hover is a tile
  assert.equal(h.b.store.act('move', { id: barn, ...to, rot: 0 }).ok, true);
  h.flush();
  assert.equal(builds.at(-1)?.moveBack, barn, 'the hint offers the Barn\'s Move back (Ctrl+Z)');
  a.ctl.undo();
  h.flush();
  assert.deepEqual([h.state.farm.objects[barn].x, h.state.farm.objects[barn].z], [o.x, o.z], 'the Barn went back');
  assert.ok(h.state.farm.objects[bed], 'my flower bed was not refunded');
});

test('Ctrl+Z follows the Hammer hint: a step off the moved Barn while its hint still shows; nothing in hand over a moved Well', async () => {
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) s.farm.xp = xpForLevel(6);
  const barn = idOf(h.state, 'barn');
  const o = { ...h.state.farm.objects[barn] };
  let to = null;
  for (let z = 16; z < 48 && !to; z++) for (let x = 16; x < 48 && !to; x++) if (Math.abs(x - o.x) > 4 && canFit(h.state, 'barn', x, z, 0, barn) === null) to = { x, z };
  let fb = null;
  for (let z = 47; z > 16 && !fb; z--) for (let x = 47; x > 16 && !fb; x--) {
    if (canFit(h.state, 'flower_bed', x, z, 0) === null && (x < to.x - 1 || x > to.x + 5 || z < to.z - 1 || z > to.z + 5)) fb = { x, z };
  }
  const a = await fakeController(h.a);
  assert.equal(h.a.store.act('place', { def: 'flower_bed', ...fb, rot: 0 }).ok, true);
  assert.equal(h.b.store.act('move', { id: barn, ...to, rot: 0 }).ok, true);
  h.flush();
  const bed = idOf(h.state, 'flower_bed');
  a.ctl.setTool('hammer');
  a.move(to.x + 1, to.z + 1);
  a.ctl.setHint(barn);                                    // the toolbar's hint: "Barn: click to move it · Move back (Ctrl+Z)"
  a.move(to.x - 2, to.z - 2);                             // a step off it: the hint lingers 1.5 s
  a.ctl.undo();
  h.flush();
  assert.deepEqual([h.state.farm.objects[barn].x, h.state.farm.objects[barn].z], [o.x, o.z], 'the Barn the hint named went back');
  assert.ok(h.state.farm.objects[bed], 'my flower bed was not refunded');
  // a purchase ghost in hand over a moved Well: no hint offers its Move back, so Ctrl+Z does not move it either
  const well = idOf(h.state, 'well');
  const w = { ...h.state.farm.objects[well] };
  let wto = null;
  for (let z = 16; z < 48 && !wto; z++) for (let x = 16; x < 48 && !wto; x++) if (Math.abs(x - w.x) > 3 && canFit(h.state, 'well', x, z, 0, well) === null) wto = { x, z };
  assert.equal(h.b.store.act('move', { id: well, ...wto, rot: 0 }).ok, true);
  h.flush();
  a.ctl.setHint(null);
  assert.equal(a.ctl.place('flower_bed'), true, 'a purchase in hand');
  a.move(wto.x, wto.z);
  a.ctl.undo();
  h.flush();
  assert.deepEqual([h.state.farm.objects[well].x, h.state.farm.objects[well].z], [wto.x, wto.z], 'the Well stays where the partner put it');
});
