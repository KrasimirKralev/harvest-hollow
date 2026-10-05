// The feedback layer (GDD §6.3, §7.2): race toasts coalesced per 500 ms and silent during a Together Combo, soft
// codes handed to the ui's confirm, the partner's BIG_SPEND heads-up, the pitch ladder, partner sounds on screen only.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cropOf, xpForLevel } from '../shared/content/index.js';
import { ERR } from '../shared/net/protocol.js';
import { coopHarness, deliverBatch } from './helpers/client.js';
import { createFeedback, bigSpendLine, hurryBurstLine, HURRY_BURST_MS } from '../public/js/game/feedback.js';

const WHEAT = cropOf('wheat');

function rig({ visible = true } = {}) {
  const h = coopHarness();
  const toasts = [];
  const sounds = [];
  const fx = [];
  const ui = { toast: (code, o = {}) => toasts.push({ code, ...o }) };
  const audio = {
    play: (name, o = {}) => { sounds.push({ name, ...o }); return true; },
    ladder: (step, o = {}) => sounds.push({ name: 'ladder', step, ...o }),
    coins: (n) => sounds.push({ name: 'coins', n }),
    duck() {}, setScene() {},
  };
  const view = { toScreen: () => ({ x: 400, y: 300, visible }), fx: { play: (ev) => fx.push(ev) }, stats: () => ({ weather: 'sunny' }) };
  const controller = { on() { return () => {}; }, stroke: null };
  const fb = { b: createFeedback({ store: h.b.store, controller, view, audio, ui }) };
  return { h, toasts, sounds, fx, fb };
}

function racePlot(h, id) {
  h.a.store.act('plant', { id, crop: 'wheat' });
  h.flush();
  h.clock.advance(WHEAT.growMs);
  h.a.store.act('harvest', { id });
  h.b.store.act('harvest', { id });
  h.deliverToServer(h.a);
  h.deliverToServer(h.b);
}

test('a lost race shows one friendly toast after 500 ms; three at once are one toast with a count', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { h, toasts, sounds, fb } = rig();
    const plots = Object.keys(h.state.farm.objects).filter((id) => h.state.farm.objects[id].def === 'plot').sort();
    racePlot(h, plots[0]);
    deliverBatch(h.b);
    assert.equal(toasts.length, 0, 'coalescing window');
    mock.timers.tick(RACE_MS + 10);
    assert.deepEqual(toasts.map((t) => [t.code, t.by]), [[ERR.EMPTY, 'p1']]);
    assert.ok(!sounds.some((s) => s.name === 'bonk'), 'never an error sound for a lost race');
    for (const id of plots.slice(1, 4)) { h.a.store.act('plant', { id, crop: 'wheat' }); }
    h.flush();
    h.clock.advance(WHEAT.growMs);
    for (const id of plots.slice(1, 4)) { h.a.store.act('harvest', { id }); h.b.store.act('harvest', { id }); }
    h.deliverToServer(h.a);
    h.deliverToServer(h.b);
    deliverBatch(h.b);
    mock.timers.tick(RACE_MS + 10);
    assert.equal(toasts.length, 2);
    assert.match(toasts[1].code, /Rowan got to 3 of these first/);
    fb.b.dispose();
  } finally { mock.timers.reset(); }
});
const RACE_MS = 500;

test('during a Together Combo a lost race shows no toast: a heart spark plays on the plot instead', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { h, toasts, fx, fb } = rig();
    const plots = Object.keys(h.state.farm.objects).filter((id) => h.state.farm.objects[id].def === 'plot').sort();
    // both of us are productive right now: B harvests one plot (confirmed), A harvests the other
    for (const id of plots.slice(0, 2)) h.a.store.act('plant', { id, crop: 'wheat' });
    h.flush();
    h.clock.advance(WHEAT.growMs);
    h.b.store.act('harvest', { id: plots[0] });
    h.flush();
    racePlot(h, plots[1]);
    deliverBatch(h.b);
    mock.timers.tick(RACE_MS + 10);
    assert.equal(toasts.length, 0, 'no "got there first" while both are working together');
    assert.deepEqual(fx.filter((e) => e.e === 'heartSpark').map((e) => e.id), [plots[1]]);
    fb.b.dispose();
  } finally { mock.timers.reset(); }
});

test("a soft refusal from the server goes to the ui's confirm with type and args", () => {
  const { h, toasts, fb } = rig();
  h.b.store.emit('reject', { seq: 9, type: 'sell', args: { item: 'wheat', qty: 3 }, code: ERR.RESERVED, by: undefined, local: false });
  assert.deepEqual(toasts[0], { code: ERR.RESERVED, type: 'sell', args: { item: 'wheat', qty: 3 }, by: undefined });
  fb.b.dispose();
});

test("the partner's big purchase shows a heads-up on my screen (GDD §6.3 BIG_SPEND)", () => {
  const { h, toasts, fb } = rig();
  for (const s of [h.state]) { s.farm.xp = xpForLevel(5); s.farm.wallet.coins = 6000; }
  for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
  let spot = null;
  for (let z = 14; z < 50 && !spot; z++) for (let x = 14; x < 50 && !spot; x++) {
    const r = h.a.store.act('place', { def: 'bakery', x, z, rot: 0, confirm: ['BIG_SPEND'] });
    if (r.ok) spot = { x, z };
  }
  assert.ok(spot);
  h.flush();
  assert.ok(toasts.some((t) => /Rowan is buying a Bakery — 2,600 coins/.test(t.code)), JSON.stringify(toasts));
  assert.equal(toasts.filter((t) => /is buying/.test(t.code)).length, 1, 'exactly one heads-up per purchase');
  const t = toasts.find((x) => /is buying/.test(x.code));
  assert.deepEqual([t.kind, t.icon, t.ms], ['info', 'bakery', 5000]);
  fb.b.dispose();
});

test('BIG_SPEND by the day\'s Acorns (X7a): the second 8-Acorn Hurry gives the partner one heads-up with the day total', async () => {
  const { h, toasts, fb } = rig();
  for (const s of [h.state]) { s.farm.xp = xpForLevel(12); s.farm.wallet.acorns = 40; s.farm.wallet.coins = 5000; }
  for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
  const plots = Object.keys(h.state.farm.objects).filter((id) => h.state.farm.objects[id].def === 'plot').sort();
  for (const id of plots.slice(0, 2)) assert.equal(h.a.store.act('plant', { id, crop: 'cabbage' }).ok, true);
  h.flush();
  assert.equal(h.a.store.act('hurry', { id: plots[0] }).ok, true, 'the first 8 Acorns are not big');
  h.flush();
  assert.equal(toasts.filter((x) => /Hurry/.test(x.code)).length, 0, 'no heads-up below the line');
  assert.equal(h.a.store.act('hurry', { id: plots[1] }).code, ERR.BIG_SPEND, 'the buyer is asked');
  assert.equal(h.a.store.act('hurry', { id: plots[1], confirm: ['BIG_SPEND'] }).ok, true);
  h.flush();
  await new Promise((r) => setTimeout(r, HURRY_BURST_MS + 100));   // a Hurry burst is gathered first
  const lines = toasts.filter((x) => /Hurry/.test(x.code));
  assert.deepEqual(lines.map((x) => x.code), ['Rowan is spending 8 Acorns on a Hurry (16 Acorns today)']);
  fb.b.dispose();
});

test('"Finish all growing" (final release PT-04 / M-2): a burst of the partner\'s Hurries is ONE heads-up with the sum', async () => {
  const { h, toasts, fb } = rig();
  for (const s of [h.state]) { s.farm.xp = xpForLevel(12); s.farm.wallet.acorns = 80; s.farm.wallet.coins = 5000; }
  for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
  const plots = Object.keys(h.state.farm.objects).filter((id) => h.state.farm.objects[id].def === 'plot').sort();
  for (const id of plots.slice(0, 4)) assert.equal(h.a.store.act('plant', { id, crop: 'cabbage' }).ok, true);
  h.flush();
  assert.equal(h.a.store.act('hurry', { id: plots[0] }).ok, true);
  for (const id of plots.slice(1, 4)) assert.equal(h.a.store.act('hurry', { id, confirm: ['BIG_SPEND'] }).ok, true);
  h.flush();
  assert.equal(toasts.filter((x) => /Hurry|finish/.test(x.code)).length, 0, 'nothing before the burst settles');
  await new Promise((r) => setTimeout(r, HURRY_BURST_MS + 100));
  const lines = toasts.filter((x) => /Hurry|finish/.test(x.code));
  assert.deepEqual(lines.map((x) => x.code), ['Rowan is spending 24 Acorns to finish 3 crops early']);
  assert.equal(hurryBurstLine({ who: 'Mia', n: 1, coins: 0, acorns: 8, plot: true, first: 'one line' }), 'one line');
  fb.b.dispose();
});

test('bigSpendLine: one line per kind of spend; nothing without the rules\' verdict', () => {
  const h = coopHarness();
  const st = h.state;
  assert.equal(bigSpendLine([{ e: 'placed', def: 'bakery', coins: 2600 }], st, 'p1', 0), null, 'no bigSpend event: no heads-up');
  const line = (ev, extra = []) => bigSpendLine([...extra, { e: 'bigSpend', by: 'p1', ...ev }], st, 'p1', 0)?.text;
  assert.equal(line({ coins: 2600, acorns: 0, what: 'bakery' }, [{ e: 'placed' }]), 'Rowan is buying a Bakery — 2,600 coins');
  assert.equal(line({ coins: 0, acorns: 12, what: 'golden_seeds' }, [{ e: 'purchased' }]), 'Rowan is buying Golden Seeds — 12 Acorns');
  assert.equal(line({ coins: 3000, acorns: 0, what: 'barn' }, [{ e: 'barnUpgraded' }]), 'Rowan is upgrading the Barn — 3,000 coins');
  assert.match(line({ coins: 4000, acorns: 0, what: 'bakery' }, [{ e: 'slotUpgraded' }]), /^Rowan is buying a new slot for the Bakery — 4,000 coins$/);
  assert.match(line({ coins: 9000, acorns: 0, what: 'nope' }, []), /^Rowan is buying something big — 9,000 coins$/);
});

test('painting climbs the pitch ladder from its first note; the partner is heard only on screen', () => {
  const { h, sounds, fb } = rig();
  const plots = Object.keys(h.state.farm.objects).filter((id) => h.state.farm.objects[id].def === 'plot').sort();
  for (const id of plots.slice(0, 3)) h.b.store.act('plant', { id, crop: 'wheat' });
  assert.deepEqual(sounds.filter((s) => s.name === 'ladder').map((s) => s.step), [0, 1, 2]);
  fb.b.dispose();
  const off = rig({ visible: false });
  off.h.a.store.act('plant', { id: plots[0], crop: 'wheat' });
  off.h.flush();
  assert.equal(off.sounds.length, 0, "the partner's planting off screen is silent");
  off.fb.b.dispose();
});
