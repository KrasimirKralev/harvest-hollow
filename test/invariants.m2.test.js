// The economy invariants fuzz (test/invariants.test.js) against the M2 content: L34 farms with the M1b set-up plus
// the Alpaca Paddock, a Fishing Dock, room in every home, a baby to nurse, bottle items and the farmhouse room open,
// so the Nursery, the Breeding Barn, the Fishing Dock and the interior are accepted along the way. Same checks:
// key-reversed twin, classified events, round trips, validity, ledger, Barn, plot cap; and two-client convergence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m2 } from './helpers/rules-economy-m2.js';

await m2();
const { fuzz, converge, startFarm, M2_FUZZED } = await import('./helpers/econ-fuzz.js');

const start = (seed) => startFarm(seed, { level: 34, m1b: true, m2: true });

test('M2 fuzz: key order, classified events, round trips, validity and the economy invariants', () => {
  const accepted = fuzz({ seeds: [2, 4, 6, 8], steps: 220, start, roundTripEvery: 10 });
  const never = M2_FUZZED.filter((t) => !accepted.has(t));
  assert.ok(never.length <= 2, `wave-3 actions never accepted: ${never.join(', ')}`);   // each has its unit tests
});

test('M2 prediction == server: random interleavings of two clients through the engine converge', () => {
  converge({ seeds: [2, 4, 6], steps: 90, start });
});
