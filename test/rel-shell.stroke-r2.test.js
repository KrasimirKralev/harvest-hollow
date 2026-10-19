// QA r2 S2-07 (fbp#3, jde#9): a Hand drag across empty plots panned the camera and planted nothing.
//   - after placing a building the Hand came back without the seed it held ("Пшеница" -> "Ръка"), so the next drag
//     panned; the tool held before build mode (and its seed) comes back now;
//   - on a fresh farm the empty plot's card promised "(drag to plant a row)" and that drag panned: a bare-Hand drag from
//     an empty plot asks which seed there (like a tap), and the card only promises the row to a Hand that holds a seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canPlace } from '../shared/rules/grid.js';
import { controllerRig, plotsSorted, PX } from './helpers/ui-shell.js';

const HUD = await import('../public/js/ui/hud.js');

function freeSpot(state, def, w, d) {
  for (let z = 14; z < 56; z++) for (let x = 14; x < 56; x++) {
    if (canPlace(state, def, x - Math.floor((w - 1) / 2), z - Math.floor((d - 1) / 2), 0) === null) return { x, z };
  }
  return null;
}
const emptyPlots = (s) => plotsSorted(s).filter((id) => !s.farm.objects[id].crop);
function spyPan(w) {
  const pans = [];
  w.view.camera.pan = (dx, dz) => pans.push([dx, dz]);
  return pans;
}

test('S2-07: placing the free Coop gives back the Hand with the Wheat it held', async () => {
  const { h, store, c, ptr } = await controllerRig();
  for (const st of [store.state, h.state]) st.farm.storage = { ...st.farm.storage, coop: 1 };
  const plot = emptyPlots(store.state)[0];
  assert.equal(c.plantWith('wheat', plot).ok, true, 'the picker plant arms the Hand');
  assert.deepEqual([c.tool.id, c.tool.crop, c.tool.seeding], ['hand', 'wheat', true]);
  assert.equal(c.place('coop'), true, 'the Coop from the tray');
  const spot = freeSpot(store.state, 'coop', 3, 3);
  ptr.move(spot.x, spot.z);
  ptr.click(spot.x, spot.z);
  h.flush();
  assert.ok(Object.values(store.state.farm.objects).some((o) => o.def === 'coop'), 'the Coop stands');
  assert.equal(c.tool.build, null, 'build mode ended');
  assert.deepEqual([c.tool.id, c.tool.crop, c.tool.seeding], ['hand', 'wheat', true], 'the Hand holds the Wheat again (HEAD: seeding false)');
});

test('S2-07: cancelling a placement gives the held tool back too', async () => {
  const { store, c } = await controllerRig();
  const plot = emptyPlots(store.state)[0];
  c.plantWith('wheat', plot);
  c.place('feed_mill');
  c.cancel();
  assert.deepEqual([c.tool.id, c.tool.seeding], ['hand', true]);
});

test('S2-07 mouse: a bare-Hand drag from an empty plot opens the seed picker there, no pan', async () => {
  const { store, c, ptr, w, commands } = await controllerRig();
  const o = (id) => store.state.farm.objects[id];
  assert.equal(c.tool.id, 'hand');
  assert.equal(Boolean(c.tool.seeding), false, 'a bare Hand');
  const row = emptyPlots(store.state).filter((id) => o(id).z === o(emptyPlots(store.state)[0]).z).sort((a, b) => o(a).x - o(b).x);
  assert.ok(row.length >= 3, 'a row of empty plots');
  const pans = spyPan(w);
  const z = o(row[0]).z;
  ptr.down(o(row[0]).x, z);
  for (let i = 1; i < 3; i += 1) { ptr.move(o(row[i]).x, z); w.frame(); }
  ptr.up(o(row[2]).x, z);
  w.frame();
  const pick = commands.filter((x) => x.cmd === 'seedPicker');
  assert.equal(pick.length, 1, `the picker once (HEAD: ${pick.length}, the camera panned ${pans.length} times)`);
  assert.equal(pick[0].id, row[0], 'at the stroke\'s first plot');
  assert.equal(pans.length, 0, 'no pan');
});

test('S2-07 touch: the same with a finger', async () => {
  const { store, w, commands } = await controllerRig();
  const o = (id) => store.state.farm.objects[id];
  const first = emptyPlots(store.state)[0];
  const row = emptyPlots(store.state).filter((id) => o(id).z === o(first).z).sort((a, b) => o(a).x - o(b).x);
  const pans = spyPan(w);
  const ev = (x, z, extra = {}) => ({ pointerType: 'touch', pointerId: 41, button: 0, isPrimary: true, clientX: (x + 0.5) * PX, clientY: (z + 0.5) * PX,
    timeStamp: performance.now(), ...extra });
  const z = o(row[0]).z;
  w.canvas.dispatch('pointerdown', ev(o(row[0]).x, z));
  for (let i = 1; i < 3; i += 1) { w.canvas.dispatch('pointermove', ev(o(row[i]).x, z)); w.frame(); }
  w.canvas.dispatch('pointerup', ev(o(row[2]).x, z));
  w.frame();
  assert.equal(commands.filter((x) => x.cmd === 'seedPicker').length, 1, 'the picker at the plot (HEAD: a pan)');
  assert.equal(pans.length, 0);
});

test('S2-07: a drag from grass still pans', async () => {
  const { store, ptr, w, commands } = await controllerRig();
  const pans = spyPan(w);
  // a grass tile far from the field
  let g = null;
  for (let z = 2; z < 60 && !g; z++) for (let x = 2; x < 60 && !g; x++) {
    if (!Object.values(store.state.farm.objects).some((o) => Number.isFinite(o.x) && x >= o.x - 1 && x <= o.x + 4 && z >= o.z - 1 && z <= o.z + 4)) g = { x, z };
  }
  ptr.down(g.x, g.z);
  ptr.move(g.x + 2, g.z);
  w.frame();
  ptr.up(g.x + 2, g.z);
  assert.equal(commands.filter((x) => x.cmd === 'seedPicker').length, 0);
  assert.ok(pans.length > 0, 'a pan');
});

test('S2-07: the empty plot\'s card promises "drag to plant a row" only to a Hand that holds a seed', async () => {
  const { store } = await controllerRig();
  const id = emptyPlots(store.state)[0];
  const bare = HUD.worldTip(store.state, { kind: 'object', id }, store.now(), 'p1', { seeding: false });
  assert.ok(!bare.lines.some((l) => /drag|плъзни/i.test(l)), `bare Hand: ${JSON.stringify(bare.lines)}`);
  const armed = HUD.worldTip(store.state, { kind: 'object', id }, store.now(), 'p1', { seeding: true });
  assert.ok(armed.lines.some((l) => /drag/i.test(l)), 'armed: the row');
});
