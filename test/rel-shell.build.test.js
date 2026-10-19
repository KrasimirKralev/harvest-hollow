// QA r1 S-06 (fbp#7): after placing Grandma's free Sunset Bench the ghost and the ✓ stayed, and one more ✓ bought a
// second bench for 270 coins with no word. The last free piece of its kind ends build mode (the Hand comes back);
// a bought piece that keeps build mode on (a path, a fence) says its price on the touch ✓ ("Place · 270").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xpForLevel } from '../shared/content/index.js';
import { canPlace } from '../shared/rules/grid.js';
import { controllerRig } from './helpers/ui-shell.js';

async function rig() {
  const r = await controllerRig();
  const builds = [];
  r.c.on('build', (e) => builds.push(e));
  for (const st of [r.store.state, r.h.state]) {
    st.farm.xp = xpForLevel(5);
    st.farm.wallet.coins = 50_000;
  }
  return { ...r, builds };
}

function freeSpot(state, def, w = 1, d = 1) {
  for (let z = 14; z < 50; z++) for (let x = 14; x < 50; x++) {
    if (canPlace(state, def, x - Math.floor((w - 1) / 2), z - Math.floor((d - 1) / 2), 0) === null) return { x, z };
  }
  return null;
}

test('S-06: placing the last free Sunset Bench from the tray ends build mode; nothing is bought', async () => {
  const { h, store, c, ptr } = await rig();
  for (const st of [store.state, h.state]) st.farm.storage = { ...st.farm.storage, sunset_bench: 1 };
  assert.equal(c.place('sunset_bench'), true, 'the hammer takes the bench from the tray');
  const coins0 = store.state.farm.wallet.coins;
  const spot = freeSpot(store.state, 'sunset_bench', 2, 1);
  ptr.move(spot.x, spot.z);
  ptr.click(spot.x, spot.z);
  const benches = () => Object.values(store.state.farm.objects).filter((o) => o.def === 'sunset_bench').length;
  assert.equal(benches(), 1, 'the free bench is placed');
  assert.equal(store.state.farm.wallet.coins, coins0, 'it cost nothing');
  assert.equal(c.tool.build, null, 'build mode ended (HEAD: the ghost stayed for a second, bought bench)');
  assert.equal(c.tool.id, 'hand', 'the Hand is back');
  // the same click again does not buy a second bench
  const spot2 = freeSpot(store.state, 'sunset_bench', 2, 1);
  ptr.click(spot2.x, spot2.z);
  assert.equal(benches(), 1, 'no second bench');
  assert.equal(store.state.farm.wallet.coins, coins0, 'no coins spent');
});

test('S-06: two stored benches: the first keeps build mode (the second is free too), the second ends it', async () => {
  const { h, store, c, ptr } = await rig();
  for (const st of [store.state, h.state]) st.farm.storage = { ...st.farm.storage, sunset_bench: 2 };
  c.place('sunset_bench');
  let spot = freeSpot(store.state, 'sunset_bench', 2, 1);
  ptr.move(spot.x, spot.z);
  ptr.click(spot.x, spot.z);
  assert.ok(c.tool.build, 'one more is waiting in the tray: build mode goes on');
  spot = freeSpot(store.state, 'sunset_bench', 2, 1);
  ptr.move(spot.x, spot.z);
  ptr.click(spot.x, spot.z);
  assert.equal(c.tool.build, null, 'the last free one ends build mode');
});

test('S-06: a bought repeat piece keeps build mode and the ghost carries its price for the ✓', async () => {
  const { store, c, ptr, builds } = await rig();
  c.place('dirt_path');
  const spot = freeSpot(store.state, 'dirt_path');
  ptr.move(spot.x, spot.z);
  const e = builds.filter(Boolean).at(-1);
  assert.equal(e.def, 'dirt_path');
  assert.equal(e.cost, 20, `the ✓ can say "Place · 20": ${JSON.stringify(e)}`);
  ptr.click(spot.x, spot.z);
  assert.ok(c.tool.build, 'paths stay in build mode (paid, one after another)');
});

test('S-06: the touch ✓ shows the price of a bought piece, and no price for a gift', async () => {
  const { installDom } = await import('./ui-qa2-dom.js');
  const document = installDom();
  document.head = document.createElement('head');
  document.documentElement = { clientWidth: 390 };
  const { createTouchBuild } = await import('../public/js/game/touch-build.js');
  const fns = {};
  const controller = { input: 'touch', tool: { build: {} }, on: (n, fn) => { fns[n] = fn; }, confirm() {}, rotate() {}, cancel() {} };
  const view = { onFrame() {}, toScreen: () => ({ x: 100, y: 100 }) };
  const tb = createTouchBuild({ controller, view, doc: document });
  const cap = () => tb.el.querySelector('.tb-place .tb-cap').textContent;
  fns.build({ def: 'sunset_bench', x: 10, z: 10, rot: 0, valid: true, cost: 270 });
  assert.match(cap(), /270/, `the ✓ says the price: ${cap()}`);
  fns.build({ def: 'sunset_bench', x: 10, z: 10, rot: 0, valid: true, cost: 0 });
  assert.doesNotMatch(cap(), /\d/, `a gift: no price: ${cap()}`);
  fns.build({ def: 'sunset_bench', x: 10, z: 10, rot: 0, valid: true, cost: 270, moveId: 'o1' });
  assert.doesNotMatch(cap(), /\d/, 'a move costs nothing');
});
