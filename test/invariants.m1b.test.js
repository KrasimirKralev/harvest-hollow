// The economy invariants fuzz (test/invariants.test.js) against the M1b content: L22 farms with the M1b homes,
// buildings, animals, a composted 3 x 3 plot block and a ripening Giant, the Restoration Ledger open and goods made
// for a Town Project, so masterwork, donate, townGive / townFund and the giant chop are accepted along the way; the system
// actions (_beauty, _townPost, _townBuild, _rain, ...) run when due. Same checks: key-reversed twin, classified
// events, round trips, validity, ledger, Barn, plot cap, Giant timers; and two-client convergence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m1b } from './helpers/rules-economy.js';

await m1b();
const { fuzz, converge, startFarm, M1B_FUZZED } = await import('./helpers/econ-fuzz.js');

const start = (seed) => startFarm(seed, { level: 22, m1b: true });

test('M1b fuzz: key order, classified events, round trips, validity and the economy invariants', () => {
  const accepted = fuzz({ seeds: [2, 4, 6], steps: 160, start, roundTripEvery: 10 });
  const never = M1B_FUZZED.filter((t) => !accepted.has(t));
  assert.ok(never.length <= 1, `wave-2 actions never accepted: ${never.join(', ')}`);   // each has its unit tests
  for (const t of ['_beauty', '_townPost']) assert.ok(accepted.has(t), `${t} never ran`);
  assert.ok(accepted.has('giantFelled'), 'the start farm\'s Giant was never felled');
});

test('M1b prediction == server: random interleavings of two clients through the engine converge', () => {
  converge({ seeds: [2, 4, 6], steps: 80, start });
});
