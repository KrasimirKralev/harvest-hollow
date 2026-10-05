// A lost race seen locally (TRIAGE CL-04, ui-ux-20): on a LAN the partner's delta usually lands before my click, so
// my own dry run refuses (EMPTY / NOT_READY ...) and the server never sees the attempt. Within 10 s of the partner's
// action on that object, the controller says "Mia got there first ♥" (the ui's race toast: `by` = the partner) with
// no shake and no bonk; anything else stays an ordinary refusal.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cropOf } from '../shared/content/index.js';
import { ERR } from '../shared/net/protocol.js';
import { coopHarness, eventTarget, fakeController } from './helpers/client.js';

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
  b.click(o.x, o.z);
  assert.deepEqual(b.toasts.map(([code, opts]) => [code, opts.by]), [[ERR.EMPTY, undefined]]);
  assert.equal(b.calls.fx.filter((e) => e.e === 'invalid').length, 1, 'the usual shake');
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
