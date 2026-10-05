// PROOF (RED on M0): Tx writes into arrays do not round-trip. Asserts the CORRECT behaviour, so it fails today.
// Run: node --test docs/design/review-m0-proofs/01-tx-arrays.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tx, applyOps } from '../../../shared/rules/tx.js';

const plain = (o) => JSON.parse(JSON.stringify(o));

test('append to a queue array, then rollback, restores the exact array (length included)', () => {
  const s = { farm: { objects: { b1: { def: 'bakery', queue: [{ r: 'bread', s: 1, e: 2 }] } } } };
  const before = structuredClone(s);
  const tx = new Tx(s);
  const q = tx.get(['farm', 'objects', 'b1', 'queue']);
  tx.set(['farm', 'objects', 'b1', 'queue', q.length], { r: 'bread', s: 2, e: 3 });   // the natural "push"
  tx.rollback();
  console.log('after rollback: length', s.farm.objects.b1.queue.length, 'JSON', JSON.stringify(s.farm.objects.b1.queue));
  assert.equal(s.farm.objects.b1.queue.length, 1, 'rollback left a hole: length is still 2');
  assert.deepEqual(plain(s), plain(before));
});

test('client rebase (undo ops) of an append restores the array', () => {
  const s = { a: [1, 2] };
  const tx = new Tx(s);
  tx.set(['a', 2], 3);
  applyOps(s, tx.inverse());                 // exactly what SyncStore.onServer does to rewind a pending action
  console.log('after undo:', s.a, 'JSON', JSON.stringify(s));
  assert.deepEqual(JSON.stringify(s), JSON.stringify({ a: [1, 2] }));
});

test('deleting an array element does not leave a hole that JSON turns into null', () => {
  const s = { a: [{ r: 'x' }, { r: 'y' }] };
  new Tx(s).del(['a', 0]);
  console.log('after del:', s.a, 'JSON', JSON.stringify(s.a));
  // Live server keeps a hole (s.a[0] === undefined); after snapshot + restart it is null: live != restarted.
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'live state differs from its own snapshot');
});
