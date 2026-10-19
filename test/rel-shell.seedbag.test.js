// Release 1.0, ui-shell M2 (ux-first#2, ux-phone#5): the Seed Bag never blocks the Hand. After a pick in the seed
// picker the Hand stays in hand with that crop: more empty plots plant, a ripe plot harvests, a building still opens.
// The Seed Bag itself (key 2) harvests a ripe plot instead of answering OCCUPIED. Desktop (mouse) and touch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropOf } from '../shared/content/index.js';
import { verbsFor, describe } from '../public/js/game/targets.js';
import { controllerRig, plotsSorted } from './helpers/ui-shell.js';

const WHEAT = cropOf('wheat');

test('M2: the picker plant keeps the Hand, armed with the crop; more plots plant, a building opens (mouse)', async () => {
  const { store, c, ptr, toasts, commands } = await controllerRig();
  const plots = plotsSorted(store.state);
  const o = (id) => store.state.farm.objects[id];
  assert.equal(c.plantWith('wheat', plots[0]).ok, true);
  assert.deepEqual([c.tool.id, c.tool.crop], ['hand', 'wheat'], 'the Hand stays in hand, with the crop');
  // the next empty plot: one click plants it (no picker again)
  ptr.click(o(plots[1]).x, o(plots[1]).z);
  assert.equal(o(plots[1]).crop?.def, 'wheat', 'the armed Hand plants the next plot');
  assert.equal(commands.filter((x) => x.cmd === 'seedPicker').length, 0, 'no second picker');
  // a building: the Hand opens it (no ui here: the controller announces the panel)
  const barn = Object.keys(store.state.farm.objects).find((k) => o(k).def === 'barn');
  ptr.click(o(barn).x + 1, o(barn).z + 1);
  assert.ok(commands.some((x) => x.cmd === 'panel' && x.name === 'barn'), `the Barn opens: ${JSON.stringify(commands)}`);
  assert.equal(toasts.length, 0, `no refusal: ${JSON.stringify(toasts)}`);
});

test('M2: the armed Hand harvests a ripe plot; H puts the seed away and the next empty plot asks again', async () => {
  const { h, store, c, ptr, toasts, commands } = await controllerRig();
  const plots = plotsSorted(store.state);
  const o = (id) => store.state.farm.objects[id];
  assert.equal(c.plantWith('wheat', plots[0]).ok, true);
  h.flush();
  h.clock.advance(WHEAT.growMs + 1000);
  ptr.click(o(plots[0]).x, o(plots[0]).z);
  assert.equal(o(plots[0]).crop, null, 'harvested');
  assert.equal(toasts.filter(([code]) => code === 'OCCUPIED').length, 0, 'never "Something is already growing there"');
  c.setTool('hand');
  assert.equal(c.tool.seeding, false);
  ptr.click(o(plots[2]).x, o(plots[2]).z);
  assert.equal(o(plots[2]).crop, null, 'the plain Hand plants nothing by itself');
  assert.ok(commands.some((x) => x.cmd === 'seedPicker' && x.id === plots[2]), 'it opens the picker');
});

test('M2: the Seed Bag (key 2) harvests a ripe plot instead of OCCUPIED (and plants it again: QA r3 S3-06)', async () => {
  const { h, store, c, ptr, toasts } = await controllerRig();
  const plots = plotsSorted(store.state);
  const o = (id) => store.state.farm.objects[id];
  c.setTool('seed_bag', { crop: 'wheat' });
  ptr.click(o(plots[0]).x, o(plots[0]).z);
  assert.equal(o(plots[0]).crop?.def, 'wheat');
  h.flush();
  h.clock.advance(WHEAT.growMs + 1000);
  const t = describe(store.state, plots[0], store.now(), store.pid);
  assert.deepEqual(verbsFor('seed_bag', t), ['harvest'], 'the bag harvests what is ripe');
  const wheat0 = store.state.farm.inventory.wheat ?? 0;
  ptr.click(o(plots[0]).x, o(plots[0]).z);
  assert.ok((store.state.farm.inventory.wheat ?? 0) > wheat0, 'harvested with the Seed Bag');
  assert.equal(o(plots[0]).crop?.def, 'wheat', 'and planted again (D3: harvest first if ripe)');
  assert.ok(o(plots[0]).crop.readyAt > store.now(), 'a fresh crop, not the ripe one');
  assert.deepEqual(toasts.map(([code]) => code), [], 'no refusal toast');
});

test('M2 touch: a picker plant by a finger, then a tap on a building opens it', async () => {
  const { store, c, w, commands, toasts } = await controllerRig();
  const plots = plotsSorted(store.state);
  const o = (id) => store.state.farm.objects[id];
  const PX = 10;
  const tap = (x, z, id) => {
    const e = { pointerType: 'touch', pointerId: id, button: 0, clientX: (x + 0.5) * PX, clientY: (z + 0.5) * PX, isPrimary: true };
    w.canvas.dispatch('pointerdown', e);
    w.canvas.dispatch('pointerup', { ...e, timeStamp: performance.now() + 40 });
  };
  tap(o(plots[0]).x, o(plots[0]).z, 11);
  const pick = commands.find((x) => x.cmd === 'seedPicker');
  assert.ok(pick, 'a tap with the Hand on an empty plot opens the picker');
  c.plantWith('wheat', pick.id);
  assert.equal(c.tool.id, 'hand');
  const market = Object.keys(store.state.farm.objects).find((k) => o(k).def === 'market_stand');
  await new Promise((r) => setTimeout(r, 450));              // past the double-tap window
  tap(o(market).x + 1, o(market).z + 1, 12);
  assert.ok(commands.some((x) => x.cmd === 'panel' && x.name === 'market'), `the Market Stand opens: ${JSON.stringify(commands.map((x) => x.cmd + ':' + (x.name ?? '')))}`);
  assert.deepEqual(toasts, []);
});
