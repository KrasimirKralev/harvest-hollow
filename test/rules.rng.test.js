// The roll contract (tech §2.9; review-m0 #2, #15, #17): pinned hash values, no cross-type collisions,
// client-chosen keys refused, ctx immutable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash32, roll } from '../shared/rules/rng.js';
import { makeCtx } from '../shared/rules/index.js';
import { newId } from '../shared/net/ids.js';
import { makeFarm, T0 } from './helpers.js';

test('golden values: the hash never changes by accident (it would re-roll every farm)', () => {
  assert.equal(hash32(1, 'a', 2), 2068319589);
  assert.equal(hash32('x'), 132031134);
  assert.equal(hash32(0), 3905986028);
  assert.equal(hash32(-1), 592175596);
  assert.equal(roll(42, 'coat', 7), 0.48465626733377576);
});

test('a number key and a string key never hash alike (review-m0 #15)', () => {
  for (const ch of ['x', 'a', '0', '~']) {
    const n = ch.charCodeAt(0) * 2 ** 32 + 0x40000001;   // hi = the char, lo = a 1-char string's length tag
    assert.notEqual(hash32(n), hash32(ch), ch);
  }
});

test('ctx.rng refuses keys the client chose: its cid and ids this action creates (review-m0 #2)', () => {
  const s = makeFarm();
  const ctx = makeCtx(s, { now: T0, pid: 'p1', cid: 'abcdef', seq: 29 });
  assert.throws(() => ctx.rng('coat', ctx.newId(0)), /client-chosen/);
  assert.throws(() => ctx.rng('coat', newId('abcdef', 29, 3)), /client-chosen/);
  assert.throws(() => ctx.rng('abcdef'), /client-chosen/);
  assert.doesNotThrow(() => ctx.rng('coat', 'home.0.1', 4));          // an existing object and its cycle
  assert.doesNotThrow(() => ctx.rng('coat', newId('abcdef', 28, 0)));  // created by an EARLIER (ordered) action
  const sys = makeCtx(s, { now: T0, pid: 'sys', cid: 'sys', seq: 5 });
  assert.doesNotThrow(() => sys.rng('order', sys.newId(0)), 'system ids are not client-chosen');
});

test('ctx and ctx.ext are frozen (ext is journaled; review-m0 #17)', () => {
  const s = makeFarm();
  const ext = { near: true };
  const ctx = makeCtx(s, { now: T0, pid: 'p1', cid: 'abcdef', seq: 1, ext });
  assert.ok(Object.isFrozen(ctx) && Object.isFrozen(ctx.ext));
  assert.throws(() => { 'use strict'; ctx.ext.near = false; });
  assert.equal(ext.near, true, 'the journaled object is a different one');
});
