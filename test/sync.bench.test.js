// Golden Hour from the UI (coop-robust-01, TRIAGE CL-01): a bench seat is per viewer, so the second farmer's Hand
// SITS next to the first one instead of "standing up" someone else; the farmer walks over before sitting.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { describe, verbsFor, resolve, seatText } from '../public/js/game/targets.js';
import { dueSystemActions } from '../shared/rules/system.js';
import { xpForLevel, COOP } from '../shared/content/index.js';
import { canPlace, tileOwner } from '../shared/rules/grid.js';
import { coopHarness, eventTarget, fakeController } from './helpers/client.js';

/** A coop harness whose farm has a Sunset Bench (placed by A through the real rules), level 5. */
function benchFarm() {
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) { s.farm.xp = xpForLevel(5); s.farm.wallet.coins = 5000; }
  let spot = null;
  for (let z = 10; z < 40 && !spot; z++) for (let x = 10; x < 40 && !spot; x++) if (canPlace(h.state, 'sunset_bench', x, z, 0) === null) spot = { x, z };
  const r = h.a.store.act('place', { def: 'sunset_bench', ...spot, rot: 0 });
  assert.equal(r.ok, true, `bench placed: ${r.code}`);
  h.flush();
  const id = tileOwner(h.state, spot.x, spot.z);
  return { h, id, spot };
}

test('bench seats are per viewer: A sits, B\'s Hand sits next to her (not "stand"), A\'s Hand stands up', () => {
  const { h, id } = benchFarm();
  const A = h.a.store;
  const B = h.b.store;
  const tA = describe(A.state, id, A.now(), 'p1');
  assert.deepEqual(verbsFor('hand', tA), ['sit']);
  const ra = resolve(A, 'sit', tA, {});
  assert.equal(ra.type, 'sit');
  assert.equal(A.act(ra.type, ra.args).ok, true);
  h.flush();
  assert.equal(h.state.farm.coop.bench.p1.id, id);
  // B: A is seated, B is not -> the Hand offers B a seat
  const tB = describe(B.state, id, B.now(), 'p2');
  assert.equal(tB.mySeat, false);
  assert.equal(tB.seatsTaken, 1);
  assert.deepEqual(verbsFor('hand', tB), ['sit'], 'the second farmer sits down');
  const rb = resolve(B, 'sit', tB, {});
  assert.equal(rb.code, undefined, `B's sit resolves (${rb.code})`);
  assert.equal(B.act(rb.type, rb.args).ok, true);
  h.flush();
  assert.equal(h.state.farm.coop.bench.p2.id, id, 'both seated');
  // Golden Hour is due once both have sat for seatMs
  const at = Math.max(h.state.farm.coop.bench.p1.at, h.state.farm.coop.bench.p2.at) + COOP.goldenHour.seatMs;
  assert.ok(dueSystemActions(h.state, at).some((a) => a.type === '_golden'), '_golden is due');
  // and each farmer's Hand now stands only themselves up
  assert.deepEqual(verbsFor('hand', describe(A.state, id, A.now(), 'p1')), ['stand']);
  assert.deepEqual(verbsFor('hand', describe(B.state, id, B.now(), 'p2')), ['stand']);
});

test('seatText: the tooltip line names who is waiting, per viewer', () => {
  const { h, id } = benchFarm();
  const A = h.a.store;
  assert.equal(seatText(A.state, id, 'p1'), 'Sit here together for Golden Hour');
  A.act('sit', { id });
  h.flush();
  assert.equal(seatText(h.b.store.state, id, 'p2'), 'Rowan is waiting on the bench. Sit together');
  assert.equal(seatText(A.state, id, 'p1'), 'You are sitting here. Click to stand up');
  h.b.store.act('sit', { id });
  h.flush();
  assert.match(seatText(A.state, id, 'p1'), /Sitting together/);
  const plot = Object.keys(h.state.farm.objects).find((k) => h.state.farm.objects[k].def === 'plot');
  assert.equal(seatText(A.state, plot, 'p1'), null, 'not a bench');
});

// ---- the controller: walk over, then sit ------------------------------------------------------------------------
beforeEach(() => { globalThis.window = eventTarget(); });
const controllerFor = (c) => fakeController(c);

test('the Hand on the bench walks the farmer over first and sits on arrival; both farmers end up seated', async () => {
  const { h, id, spot } = benchFarm();
  const a = await controllerFor(h.a);
  const seq0 = h.a.store.seq;
  a.click(spot.x, spot.z);
  assert.equal(h.a.store.seq, seq0, 'nothing is sent while the farmer walks over');
  assert.equal(a.walks.length, 1);
  assert.equal(typeof a.walks[0].onArrive, 'function');
  a.walks[0].onArrive();
  assert.equal(h.a.store.state.farm.coop.bench.p1?.id, id, 'A sits on arrival (predicted)');
  h.flush();
  const b = await controllerFor(h.b);
  b.click(spot.x, spot.z);
  b.walks.at(-1).onArrive();
  h.flush();
  assert.equal(h.state.farm.coop.bench.p2?.id, id, 'B sat down next to A (server)');
  assert.equal(h.state.farm.coop.bench.p1?.id, id, 'A is still seated');
  assert.equal(b.toasts.length, 0, `no refusal toast: ${JSON.stringify(b.toasts)}`);
});

test('a sit is re-checked on arrival, and another click on the way cancels it', async () => {
  const { h, id, spot } = benchFarm();
  const a = await controllerFor(h.a);
  a.click(spot.x, spot.z);
  const first = a.walks.at(-1);
  // the player clicks the bench again on the way (a second walk replaces the first one's onArrive in avatar.js);
  // here: the store already shows A seated (another tab of A sat) -> the arrival sends nothing
  h.a.store.act('sit', { id });
  const seq = h.a.store.seq;
  first.onArrive();
  assert.equal(h.a.store.seq, seq, 'already seated: nothing more is sent');
});
