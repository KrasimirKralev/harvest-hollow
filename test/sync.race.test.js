// A lost race seen locally (TRIAGE CL-04, ui-ux-20): on a LAN the partner's delta usually lands before my click, so
// my own dry run refuses (EMPTY / NOT_READY ...) and the server never sees the attempt. Within 10 s of the partner's
// action on that object, the controller says "Mia got there first ♥" (the ui's race toast: `by` = the partner) with
// no shake and no bonk; anything else stays an ordinary refusal.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cropOf, xpForLevel } from '../shared/content/index.js';
import { ERR } from '../shared/net/protocol.js';
import { coopHarness, eventTarget, fakeController } from './helpers/client.js';
import { give } from './helpers/rules-goals.js';

const WHEAT = cropOf('wheat');
beforeEach(() => { globalThis.window = eventTarget(); });

function ripePlot(h) {
  const plots = Object.keys(h.state.farm.objects).filter((id) => h.state.farm.objects[id].def === 'plot').sort();
  h.a.store.act('plant', { id: plots[0], crop: 'wheat' });
  h.b.store.act('plant', { id: plots[1], crop: 'wheat' });
  h.flush();
  h.clock.advance(WHEAT.growMs);
  return plots;
}

test('a Sickle click on a plot the partner just harvested: "got there first" with her name, no shake, no bonk', async () => {
  const h = coopHarness();
  const [p0] = ripePlot(h);
  const b = await fakeController(h.b);
  const invalids = [];
  b.ctl.on('invalid', (e) => invalids.push(e));
  h.a.store.act('harvest', { id: p0 });
  h.flush();                                              // Rowan's harvest lands on Mia's screen first
  const o = h.state.farm.objects[p0];
  b.ctl.setTool('sickle');
  b.click(o.x, o.z);
  assert.deepEqual(b.toasts.map(([code, opts]) => [code, opts.by]), [[ERR.EMPTY, 'p1']], 'the race toast names Rowan');
  assert.equal(b.calls.fx.filter((e) => e.e === 'invalid').length, 0, 'no shake on the plot');
  assert.deepEqual(invalids.map((e) => [e.code, e.race, e.by]), [[ERR.EMPTY, true, 'p1']], 'feedback.js skips the bonk');
});

test('the same refusal with no partner action on that object stays an ordinary refusal', async () => {
  const h = coopHarness();
  const [, p1] = ripePlot(h);
  const b = await fakeController(h.b);
  // Mia harvests her own plot, then clicks it again: nobody raced her
  b.ctl.setTool('sickle');
  const o = h.state.farm.objects[p1];
  b.click(o.x, o.z);
  h.flush();
  const commands = [];
  b.ctl.on('command', (c) => commands.push(c));
  b.click(o.x, o.z);
  // nobody raced her: no "got there first"; the Sickle on her own empty plot asks which seed (ui-shell QA r1 S-17)
  assert.deepEqual(b.toasts.filter(([, opts]) => opts?.by), [], 'no race toast');
  assert.equal(commands.filter((c) => c.cmd === 'seedPicker' && c.id === p1).length, 1, 'the seed picker at her plot');
});

test('a panel action (controller.do with ids) refused after the partner\'s harvest is a lost race too', async () => {
  const h = coopHarness();
  const plots = ripePlot(h);
  const b = await fakeController(h.b);
  h.a.store.act('harvest', { ids: plots.slice(0, 2) });
  h.flush();
  const r = b.ctl.do('harvest', { ids: plots.slice(0, 2) });
  assert.equal(r.ok, false);
  assert.deepEqual(b.toasts.map(([code, opts]) => [code, opts.by]), [[r.code, 'p1']]);
});

test('a Deliver refused at once because the partner just filled that order is a lost race too (QA r1 I-01)', async () => {
  const h = coopHarness();
  h.state.farm.xp = xpForLevel(20);
  h.engine.runDue();
  const slot = Object.keys(h.state.farm.orders.slots).find((k) => h.state.farm.orders.slots[k].order);
  assert.ok(slot !== undefined, 'the board has an order');
  const { order } = h.state.farm.orders.slots[slot];
  for (const [item, q] of Object.entries(order.items)) give(h.state, item, 2 * q);
  for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
  const b = await fakeController(h.b);
  const invalids = [];
  b.ctl.on('invalid', (e) => invalids.push(e));
  h.a.store.act('orderFill', { slot: Number(slot), n: order.n });
  h.flush();                                              // the partner's Deliver lands on this screen first
  const r = b.ctl.do('orderFill', { slot: Number(slot), n: order.n });
  assert.equal(r.ok, false);
  assert.deepEqual(b.toasts.map(([code, opts]) => [code, opts.by]), [[r.code, 'p1']], 'the race toast names the partner');
  assert.deepEqual(invalids.map((e) => [e.race, e.by]), [[true, 'p1']], 'no shake, no bonk');
});

test('a Hammer place on a tile the partner just built on is a lost race too (QA r2 I2-01)', async () => {
  const { defOf } = await import('../shared/content/index.js');
  const { freeSpot } = await import('./helpers/rules-goals.js');
  const h = coopHarness();
  h.state.farm.xp = xpForLevel(6);
  h.state.farm.wallet.coins = 100_000;
  for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
  const [x, z] = freeSpot(h.state, defOf('hay_bales'));
  const b = await fakeController(h.b);
  const invalids = [];
  b.ctl.on('invalid', (e) => invalids.push(e));
  h.a.store.act('place', { def: 'hay_bales', x, z, rot: 0 });
  h.flush();                                              // the partner's stack lands on this screen first
  b.ctl.setTool('hammer', { def: 'hay_bales' });
  b.move(x, z);
  b.click(x, z);
  assert.deepEqual(b.toasts.map(([code, opts]) => [code, opts.by]), [[ERR.BLOCKED, 'p1']], 'the race toast names the partner');
  assert.deepEqual(invalids.map((e) => [e.race, e.by]), [[true, 'p1']], 'no shake, no bonk');
});
