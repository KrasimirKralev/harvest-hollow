// The recording transaction (tech §3.2, §3.5): undo restores, ops reproduce, strict parents, guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tx, applyOps, getAt } from '../shared/rules/tx.js';
import { GRID_VERSION } from '../shared/rules/grid-cache.js';
import { makeFarm, must, plain, T0, assertRecorded } from './helpers.js';
import { xpWithPlotRoom, freeHomeTiles } from './helpers/content.js';

const sample = () => ({ farm: { wallet: { coins: 10 }, inventory: { wheat: 2 }, objects: { a: { def: 'plot', x: 1, z: 2 } } } });

test('apply then undo restores the exact prior state', () => {
  const s = sample();
  const before = structuredClone(s);
  const tx = new Tx(s);
  tx.set(['farm', 'wallet', 'coins'], 4);
  tx.inc(['farm', 'inventory', 'wheat'], -2, { dropZero: true });
  tx.inc(['farm', 'inventory', 'corn'], 3, { dropZero: true });
  tx.set(['farm', 'objects', 'b'], { def: 'plot', x: 3, z: 3 });
  tx.del(['farm', 'objects', 'a']);
  assert.notDeepEqual(plain(s), plain(before));
  applyOps(s, tx.inverse());
  assert.deepEqual(plain(s), plain(before));
});

test('ops replayed on a copy of the prior state reproduce the new state', () => {
  const s = sample();
  const copy = structuredClone(s);
  const tx = new Tx(s);
  tx.set(['farm', 'objects', 'a', 'x'], 9);
  tx.inc(['farm', 'wallet', 'coins'], 5);
  tx.del(['farm', 'inventory', 'wheat']);
  applyOps(copy, JSON.parse(JSON.stringify(tx.ops)));   // through the wire format
  assert.deepEqual(plain(copy), plain(s));
});

test('a real action: undo and ops round-trip', () => {
  const s = makeFarm();
  const before = structuredClone(s);
  const r = must(s, 'plant', { id: 'home.0.0', crop: 'wheat' });
  const replay = structuredClone(before);
  applyOps(replay, r.tx.ops);
  assert.deepEqual(plain(replay), plain(s));
  applyOps(s, r.tx.inverse());
  assert.deepEqual(plain(s), plain(before));
});

test('strict parents: a write under a missing parent throws and records nothing', () => {
  const s = sample();
  const tx = new Tx(s);
  tx.set(['farm', 'wallet', 'coins'], 1);
  assert.throws(() => tx.set(['farm', 'nope', 'x'], 1), /no parent/);
  assert.equal(tx.undo.length, 1);
  assert.equal(tx.ops.length, 1);
  tx.rollback();
  assert.deepEqual(plain(s), plain(sample()));
});

test('an uncloneable value throws before bookkeeping; rollback still works', () => {
  const s = sample();
  const tx = new Tx(s);
  tx.inc(['farm', 'wallet', 'coins'], 1);
  assert.throws(() => tx.set(['farm', 'wallet', 'fn'], () => 1));
  assert.equal(Object.hasOwn(s.farm.wallet, 'fn'), false);
  tx.rollback();
  assert.deepEqual(plain(s), plain(sample()));
});

test('set clones: rules can never alias state', () => {
  const s = sample();
  const v = { def: 'plot', x: 0, z: 0 };
  new Tx(s).set(['farm', 'objects', 'c'], v);
  v.x = 99;
  assert.equal(s.farm.objects.c.x, 0);
});

test('inc guards: negative, unsafe, non-integer and non-numeric targets throw', () => {
  const s = sample();
  const tx = new Tx(s);
  assert.throws(() => tx.inc(['farm', 'wallet', 'coins'], -11), /bad counter/);
  assert.throws(() => tx.inc(['farm', 'wallet', 'coins'], 0.5), /bad increment/);
  assert.throws(() => tx.inc(['farm', 'wallet', 'coins'], Number.MAX_SAFE_INTEGER), /bad counter/);
  assert.throws(() => tx.inc(['farm', 'objects', 'a', 'def'], 1), /not an integer/);
  assert.equal(s.farm.wallet.coins, 10);
});

test('dropZero deletes sparse keys at 0; without it the key stays', () => {
  const s = sample();
  const tx = new Tx(s);
  tx.inc(['farm', 'inventory', 'wheat'], -2, { dropZero: true });
  assert.equal(Object.hasOwn(s.farm.inventory, 'wheat'), false);
  tx.inc(['farm', 'wallet', 'coins'], -10);
  assert.equal(s.farm.wallet.coins, 0);
});

test('del of a missing key is a no-op; getAt never follows the prototype', () => {
  const s = sample();
  const tx = new Tx(s);
  tx.del(['farm', 'objects', 'zzz']);
  assert.equal(tx.ops.length, 0);
  assert.equal(getAt(s, ['farm', 'constructor']), undefined);
  assert.equal(getAt(s, ['farm', '__proto__']), undefined);
});

test('footprint writes bump the grid version; other writes do not', () => {
  const s = makeFarm({ now: T0 });
  const v0 = s[GRID_VERSION] ?? 0;
  must(s, 'plant', { id: 'home.0.0', crop: 'wheat' });
  assert.equal(s[GRID_VERSION] ?? 0, v0, 'planting changes no footprint');
  s.farm.xp = xpWithPlotRoom();                         // the 16 starter plots fill the L1 cap (GDD §3.10)
  const [x, z] = freeHomeTiles()[0];
  must(s, 'place', { def: 'plot', x, z, rot: 0 });
  assert.ok((s[GRID_VERSION] ?? 0) > v0);
  assert.equal(JSON.stringify(s).includes('gridVersion'), false, 'symbols never serialize');
});

// ---- review-m0 #1: arrays are written whole ---------------------------------------------------------------
test('a write or delete inside an array throws and records nothing; whole-array writes round-trip', () => {
  const s = { farm: { objects: { b1: { def: 'bakery', queue: [{ r: 'bread', s: 1, e: 2 }] } } } };
  const before = structuredClone(s);
  const tx = new Tx(s);
  const q = tx.get(['farm', 'objects', 'b1', 'queue']);
  assert.throws(() => tx.set(['farm', 'objects', 'b1', 'queue', q.length], { r: 'bread', s: 2, e: 3 }), /inside an array/);
  assert.throws(() => tx.del(['farm', 'objects', 'b1', 'queue', 0]), /inside an array/);
  assert.throws(() => applyOps(s, [{ o: 's', p: ['farm', 'objects', 'b1', 'queue', 0], v: 1 }]), /inside an array/);
  assert.equal(tx.ops.length + tx.undo.length, 0);
  tx.set(['farm', 'objects', 'b1', 'queue'], [...q, { r: 'bread', s: 2, e: 3 }]);
  const wire = structuredClone(before);
  applyOps(wire, JSON.parse(JSON.stringify(tx.ops)));
  assert.deepEqual(wire, s);
  tx.rollback();
  assert.deepEqual(s, before);
  assert.equal(s.farm.objects.b1.queue.length, 1);
  assert.equal(JSON.stringify(s), JSON.stringify(before), 'no hole, no stray null');
});

// ---- review-m0 #5: values are plain JSON; events are cloned ------------------------------------------------
test('Tx.set refuses every value JSON would change or cannot encode, before bookkeeping', () => {
  const cases = {
    map: new Map([['egg', 2]]), set: new Set(['p1']), date: new Date(0), undef: undefined, nan: NaN, inf: Infinity,
    negZero: -0, sparse: [1, , 3], bigint: 10n, fn: () => 1, sym: Symbol('x'), cls: new (class A {})(),   // eslint-disable-line no-sparse-arrays
    nested: { a: [{ b: NaN }] },
  };
  for (const [name, value] of Object.entries(cases)) {
    const s = { farm: {} };
    const tx = new Tx(s);
    assert.throws(() => tx.set(['farm', 'x'], value), /tx: /, name);
    assert.equal(Object.hasOwn(s.farm, 'x'), false, name);
    assert.equal(tx.undo.length, 0, name);
  }
  const s = { farm: {} };
  const tx = new Tx(s);
  tx.set(['farm', 'ok'], { n: 0, s: '', b: false, z: null, a: [1, { c: 2 }], o: Object.assign(Object.create(null), { k: 1 }) });
  assert.doesNotThrow(() => JSON.stringify(s));
});

test('emit clones the event (it is broadcast after later writes) and refuses non-JSON events', () => {
  const s = { farm: { objects: { a: { def: 'plot', crop: { def: 'wheat' } } } } };
  const tx = new Tx(s);
  tx.emit({ e: 'harvested', obj: tx.get(['farm', 'objects', 'a']) });
  tx.set(['farm', 'objects', 'a', 'crop'], null);
  assert.deepEqual(tx.events[0].obj.crop, { def: 'wheat' });
  assert.throws(() => tx.emit({ e: 'x', when: new Date(0) }), /non-plain/);
  assert.throws(() => tx.emit({ noName: 1 }), /string `e`/);
});

// ---- review-m0 #6: the shared helpers catch writes that bypass the recorder --------------------------------
test('assertRecorded (run/must) fails an action that writes through a live reference', () => {
  const s = makeFarm();
  const before = plain(s);
  const tx = new Tx(s);
  tx.get(['farm', 'objects', 'home.0.0']).cycle += 1;     // the slip: bypasses the recorder
  tx.inc(['farm', 'wallet', 'coins'], 1);
  assert.throws(() => assertRecorded('sneaky', before, s, { ok: true, tx }), /outside tx.ops/);
  const s2 = makeFarm();
  const before2 = plain(s2);
  s2.farm.wallet.coins += 1;                              // a check() that wrote, then rejected
  assert.throws(() => assertRecorded('sneaky', before2, s2, { ok: false, code: 'NO_COINS' }), /rejected action changed/);
});
