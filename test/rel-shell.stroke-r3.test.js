// QA r3, ui-shell: what a press and a drag do on the farm.
//   S3-06 (fbp#7): a Seed Bag stroke along a ripe row harvested it and left it bare (8 of 16 plots bare after four
//         strokes); D3: "one stroke plants (harvest first if ripe)".
//   S3-09 (fbp#10): a tool that does nothing on a plot was silent: the Feed on an empty plot, no toast, no float (a 20 s
//         stall); every tool on an empty plot now acts, asks which seed, or says why at the plot.
//   S3-17 (br#2): a double click on the Undo chip undid two things: the named Picket Fence and the Scarecrow nobody
//         named; the chip undoes exactly what it names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropOf, xpForLevel } from '../shared/content/index.js';
import { canPlace } from '../shared/rules/grid.js';
import { controllerRig, plotsSorted } from './helpers/ui-shell.js';

const WHEAT = cropOf('wheat');

/** Four plots of one row, planted with Wheat and ripe. */
async function ripeRow() {
  const r = await controllerRig();
  const { h, store, c, ptr } = r;
  const o = (id) => store.state.farm.objects[id];
  const first = plotsSorted(store.state)[0];
  const row = plotsSorted(store.state).filter((id) => o(id).z === o(first).z).sort((a, b) => o(a).x - o(b).x).slice(0, 4);
  assert.equal(row.length, 4, 'a row of four plots');
  c.setTool('seed_bag', { crop: 'wheat' });
  for (const id of row) ptr.click(o(id).x, o(id).z);
  h.flush();
  h.clock.advance(WHEAT.growMs + 1000);
  for (const id of row) assert.ok(o(id).crop && o(id).crop.readyAt <= store.now(), 'ripe');
  return { ...r, row, o };
}

test('S3-06: a Seed Bag stroke over four ripe plots harvests them and plants them again', async () => {
  const { h, store, c, ptr, row, o, w } = await ripeRow();
  const wheat0 = store.state.farm.inventory.wheat ?? 0;
  c.setTool('seed_bag', { crop: 'wheat' });
  const z = o(row[0]).z;
  ptr.down(o(row[0]).x, z);
  for (const id of row.slice(1)) { ptr.move(o(id).x, z); w.frame(); }
  ptr.up(o(row.at(-1)).x, z);
  h.flush();
  const planted = row.filter((id) => o(id).crop && o(id).crop.readyAt > store.now());
  assert.equal(planted.length, 4, `four planted plots (HEAD: ${planted.length}, the row was left bare)`);
  assert.equal((store.state.farm.inventory.wheat ?? 0) - wheat0, 4 * WHEAT.yield, 'the harvest in the Barn');
});

test('S3-06: a stroke that starts on an empty plot plants the ripe ones it crosses too; the Hand still only harvests', async () => {
  const { h, store, c, ptr, row, o, w } = await ripeRow();
  // the first plot harvested by hand: the Seed Bag's stroke starts on an empty plot
  c.setTool('hand');
  ptr.click(o(row[0]).x, o(row[0]).z);
  h.flush();
  assert.equal(o(row[0]).crop, null);
  c.setTool('seed_bag', { crop: 'wheat' });
  const z = o(row[0]).z;
  ptr.down(o(row[0]).x, z);
  for (const id of row.slice(1)) { ptr.move(o(id).x, z); w.frame(); }
  ptr.up(o(row.at(-1)).x, z);
  h.flush();
  assert.equal(row.filter((id) => o(id).crop && o(id).crop.readyAt > store.now()).length, 4);
  // the armed Hand (M2: a ripe plot harvests) keeps harvesting only
  const r2 = await ripeRow();
  r2.c.plantWith('wheat', plotsSorted(r2.store.state).find((id) => !r2.o(id).crop));
  r2.ptr.click(r2.o(r2.row[0]).x, r2.o(r2.row[0]).z);
  r2.h.flush();
  assert.equal(r2.o(r2.row[0]).crop, null, 'the Hand harvests and leaves it to the player');
});

test('S3-09: every tool on an empty plot acts, asks which seed, or says why at the plot', async () => {
  for (const tool of ['sickle', 'watering_can', 'feed_scoop', 'basket', 'compost_scoop', 'axe']) {
    const { store, c, ptr, w, toasts, commands } = await controllerRig();
    for (const s of [store.state]) s.farm.xp = xpForLevel(30);
    if (!c.setTool(tool)) continue;                         // not in this build
    const floats = [];
    w.view.fx.float = (at, text) => floats.push(text);
    const plot = plotsSorted(store.state).find((id) => !store.state.farm.objects[id].crop);
    const p = store.state.farm.objects[plot];
    const before = JSON.stringify(p);
    ptr.click(p.x, p.z);
    const acted = JSON.stringify(store.state.farm.objects[plot]) !== before;
    const asked = commands.some((x) => x.cmd === 'seedPicker' && x.id === plot);
    assert.ok(acted || asked || floats.length || toasts.length, `${tool}: silent on an empty plot (HEAD: a shake, nothing else)`);
    if (asked) assert.equal(c.tool.id, 'hand', `${tool}: the Hand comes back for the seed`);
  }
});

test('S3-09: a tool with nothing to do on a thing says so there (a building opens instead: QA r4 S4-05)', async () => {
  const { store, c, ptr, w, commands } = await controllerRig();
  store.state.farm.xp = xpForLevel(30);
  store.state.farm.wallet.coins = 60_000;
  const floats = [];
  w.view.fx.float = (at, text) => floats.push(text);
  // a decor piece has no panel: the Watering Can says why at it (HEAD: a shake only)
  let spot = null;
  for (let z = 14; z < 50 && !spot; z++) for (let x = 14; x < 50 && !spot; x++) if (canPlace(store.state, 'scarecrow', x, z, 0) === null) spot = { x, z };
  assert.equal(c.do('place', { def: 'scarecrow', x: spot.x, z: spot.z, rot: 0 }).ok, true);
  c.setTool('watering_can');
  ptr.click(spot.x, spot.z);
  assert.equal(floats.length, 1, 'a reason at the Scarecrow (HEAD: a shake only)');
  assert.match(floats[0], /nothing to do here/);
  // the Barn: its panel opens (QA r4 S4-05; r3 said "nothing to do here")
  await new Promise((r) => setTimeout(r, 420));
  const barn = Object.keys(store.state.farm.objects).find((k) => store.state.farm.objects[k].def === 'barn');
  const o = store.state.farm.objects[barn];
  ptr.click(o.x + 1, o.z + 1);
  assert.ok(commands.some((x) => x.cmd === 'panel' && x.name === 'barn'));
});

test('S3-13: a Hand drag from a hungry animal (no feed in the Barn) over ready hens collects them and never pans', async () => {
  const { h, store, c, ptr, w, toasts } = await controllerRig();
  const WORLD = (await import('../shared/rules/grid.js'));
  for (const s of [store.state, h.state]) { s.farm.xp = xpForLevel(8); s.farm.wallet.coins = 60_000; s.farm.inventory.chicken_feed = 4; s.farm.inventory.livestock_feed = 0; }
  // a Coop and a Cow Barn side by side on open land
  let spot = null;
  for (let z = 14; z < 50 && !spot; z++) for (let x = 14; x < 50 && !spot; x++) {
    if (canPlace(store.state, 'coop', x, z, 0) === null && canPlace(store.state, 'cow_barn', x + 3, z, 0) === null) spot = { x, z };
  }
  assert.ok(spot, 'open land');
  assert.equal(c.do('place', { def: 'coop', x: spot.x, z: spot.z, rot: 0 }).ok, true);
  assert.equal(c.do('place', { def: 'cow_barn', x: spot.x + 3, z: spot.z, rot: 0 }).ok, true);
  const coop = WORLD.tileOwner(store.state, spot.x, spot.z);
  const barn = WORLD.tileOwner(store.state, spot.x + 3, spot.z);
  for (let i = 0; i < 2; i++) assert.ok(c.do('buyAnimal', { def: 'chicken', adult: true, home: coop }).ok);
  assert.ok(c.do('buyAnimal', { def: 'cow', adult: true, home: barn }).ok, 'a cow');
  h.flush();
  c.setTool('feed_scoop');
  ptr.click(spot.x + 1, spot.z + 1);                       // the hens fed
  h.flush();
  h.clock.advance(25 * 60_000);                            // and ready
  const eggs0 = store.state.farm.inventory.egg ?? 0;
  c.setTool('hand');
  const pans = [];
  w.view.camera.pan = (dx, dz) => pans.push([dx, dz]);
  // from the hungry cow's barn, across to the Coop
  ptr.down(spot.x + 4, spot.z + 1);
  for (const x of [spot.x + 3, spot.x + 2, spot.x + 1]) { ptr.move(x, spot.z + 1); w.frame(); }
  ptr.up(spot.x + 1, spot.z + 1);
  w.frame();
  h.flush();
  assert.equal(pans.length, 0, `no pan (HEAD: the drag panned ${pans.length} times and tended nothing)`);
  assert.equal((store.state.farm.inventory.egg ?? 0) - eggs0, 2, 'the two hens collected');
  assert.ok(toasts.length >= 1 && toasts.length <= 2, `the refusal said once: ${JSON.stringify(toasts.map(([k]) => k))}`);
});

test('S3-13: a hungry animal\'s card says it is hungry, and that its feed is not in the Barn', async () => {
  const HUD = await import('../public/js/ui/hud.js');
  const { h, store, c } = await controllerRig();
  const WORLD = (await import('../shared/rules/grid.js'));
  for (const s of [store.state, h.state]) { s.farm.xp = xpForLevel(8); s.farm.wallet.coins = 60_000; s.farm.inventory.livestock_feed = 0; }
  let spot = null;
  for (let z = 14; z < 50 && !spot; z++) for (let x = 14; x < 50 && !spot; x++) if (canPlace(store.state, 'cow_barn', x, z, 0) === null) spot = { x, z };
  assert.equal(c.do('place', { def: 'cow_barn', x: spot.x, z: spot.z, rot: 0 }).ok, true);
  const barn = WORLD.tileOwner(store.state, spot.x, spot.z);
  assert.ok(c.do('buyAnimal', { def: 'cow', adult: true, home: barn }).ok);
  const cow = Object.keys(store.state.farm.objects).find((id) => store.state.farm.objects[id].home === barn);
  const tip = HUD.worldTip(store.state, { kind: 'object', id: cow }, store.now(), 'p1');
  assert.ok(tip.lines.some((l) => /Hungry · no Livestock Feed in the Barn/.test(l)), `a state line (HEAD: ${JSON.stringify(tip.lines)})`);
  store.state.farm.inventory.livestock_feed = 3;
  const fed = HUD.worldTip(store.state, { kind: 'object', id: cow }, store.now(), 'p1');
  assert.ok(fed.lines.includes('Hungry'), JSON.stringify(fed.lines));
});

/** A free spot for a 1x1 decor. */
function freeTile(state, def) {
  for (let z = 14; z < 56; z++) for (let x = 14; x < 56; x++) if (canPlace(state, def, x, z, 0) === null) return { x, z };
  return null;
}

test('S3-17: the Undo chip\'s target is undone once: a second press does not undo the one before it', async () => {
  const { h, store, c } = await controllerRig();
  store.state.farm.xp = xpForLevel(12);
  store.state.farm.wallet.coins = 50_000;
  h.state.farm.xp = xpForLevel(12);
  h.state.farm.wallet.coins = 50_000;
  const buy = (def) => {
    const at = freeTile(store.state, def);
    const r = store.act('place', { def, ...at, rot: 0 });
    assert.notEqual(r && r.ok, false, `${def} bought (${r && r.code})`);
    h.flush();
    h.clock.advance(1000);
    return Object.keys(store.state.farm.objects).find((k) => store.state.farm.objects[k].def === def && store.state.farm.objects[k].x === at.x && store.state.farm.objects[k].z === at.z);
  };
  const first = buy('scarecrow');
  const second = buy('picket_fence');
  assert.ok(first && second, 'two purchases');
  const u = c.canUndo();
  assert.equal(u.id, second, 'the chip names the newest');
  const coins0 = store.state.farm.wallet.coins;
  c.undo({ id: u.id, verb: u.verb });
  c.undo({ id: u.id, verb: u.verb });                      // the double press: the same target again
  h.flush();
  assert.equal(store.state.farm.objects[second], undefined, 'the Picket Fence is refunded');
  assert.ok(store.state.farm.objects[first], 'the Scarecrow stays (HEAD: refunded by the second press, unnamed)');
  assert.ok(store.state.farm.wallet.coins > coins0);
  assert.equal(c.canUndo()?.id, first, 'the chip then names the remaining one');
  // Ctrl+Z (no argument) keeps its stack
  c.undo();
  h.flush();
  assert.equal(store.state.farm.objects[first], undefined, 'Ctrl+Z undoes the next one');
});

test('S3-17: the chip drops the second click of a double click and a press within UNDO_GAP_MS', async () => {
  const HUD = await import('../public/js/ui/hud.js');
  assert.equal(typeof HUD.UNDO_GAP_MS, 'number', 'ui/hud.js UNDO_GAP_MS');
  assert.ok(HUD.UNDO_GAP_MS >= 400 && HUD.UNDO_GAP_MS <= 1000);
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../public/js/ui/hud.js', import.meta.url), 'utf8');
  assert.match(src, /if \(e\.detail >= 2 \|\| t0 - undoPressAt < UNDO_GAP_MS\) return;/);
  assert.match(src, /controller\.undo\?\.\(\{ id: undoNamed\.id, verb: undoNamed\.verb \}\)/, 'it undoes the named id (HEAD: controller.undo() with no id)');
});
