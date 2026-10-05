// PROOFS (RED on M0) for the low-severity findings: rng cross-type key collision, a permissive validateState,
// a mutable ctx/ext, biased cids, and level-up rewards counted as "coins earned".
// Run: node --test docs/design/review-m0-proofs/13-low.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash32 } from '../../../shared/rules/rng.js';
import { makeCtx } from '../../../shared/rules/index.js';
import { validateState } from '../../../shared/rules/state.js';
import { makeCid } from '../../../shared/net/ids.js';
import { makeFarm, must, T0 } from '../../../test/helpers.js';

test('rng: a number key and a string key never hash the same', () => {
  const n = 120 * 2 ** 32 + 0x40000001;              // hi = 120 ('x'), lo = the 1-char length tag
  console.log(`hash32(${n}) = ${hash32(n)} | hash32('x') = ${hash32('x')}`);
  assert.notEqual(hash32(n), hash32('x'));
});

test('validateState rejects unknown fields and malformed sub-records', () => {
  const s = makeFarm();
  s.farm.junk = { anything: true };
  s.farm.expansions.push('home');                    // duplicate expansion
  s.farm.ledger.rows['0'] = { at: 'yesterday', n: 1.5 };
  s.players.p1.color = 42;
  s.players.p1.lastSeenAt = -5;
  s.farm.objects['home.0.0'].by = { evil: 1 };
  s.meta.contentHash = 7;
  const problems = validateState(s);
  console.log('validateState problems:', problems);
  assert.ok(problems.length >= 7, `only ${problems.length} of 7 planted problems reported`);
});

test('ctx (and ctx.ext, which is journaled) is immutable to rules', () => {
  const s = makeFarm();
  const ctx = makeCtx(s, { now: T0, pid: 'p1', cid: 'abcdef', seq: 1 });
  console.log('frozen? ctx', Object.isFrozen(ctx), 'ext', Object.isFrozen(ctx.ext));
  assert.ok(Object.isFrozen(ctx) && Object.isFrozen(ctx.ext));
});

test('makeCid draws every base-36 character with equal probability', () => {
  let i = 0;
  const counts = new Map();
  const bytes = (n) => { const b = new Uint8Array(n); for (let k = 0; k < n; k++) b[k] = (i++) % 256; return b; };
  for (let r = 0; r < 256 * 100; r++) for (const ch of makeCid(bytes)) counts.set(ch, (counts.get(ch) || 0) + 1);
  const max = Math.max(...counts.values());
  const min = Math.min(...counts.values());
  console.log(`most frequent char ${max}, least ${min} (ratio ${(max / min).toFixed(3)}) over a uniform byte stream`);
  assert.equal(max, min);
});

test('level-up coin rewards do not count as "coins earned" (GDD §5.4: sales, orders, barge, Fair, quests)', () => {
  const s = makeFarm();
  for (let i = 0; i < 8; i++) must(s, 'plant', { id: `home.0.${i}`, crop: 'wheat' }, { now: T0 });
  for (let i = 0; i < 8; i++) must(s, 'harvest', { id: `home.0.${i}` }, { now: T0 + 60_000 });
  console.log('farm xp', s.farm.xp, '| coins.earned', s.farm.stats['coins.earned'], 'without a single sale');
  assert.equal(s.farm.stats['coins.earned'] ?? 0, 0);
});
