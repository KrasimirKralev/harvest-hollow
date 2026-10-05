// The economy invariants fuzz (test/invariants.test.js) with the wave-4 actions in the mix (tray sales, upgrades,
// Fertilizer, weeds, looks, pet breeds): an L22 farm with the M1b set-up, two benches, Fertilizer, decor in the build
// tray, both pets adopted and the upgrade materials. Same checks: key-reversed twin, classified events, round trips,
// validity, ledger, Barn, plot cap; and the two-client prediction == server convergence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzz, converge, startFarm, enableW4, W4_FUZZED } from './helpers/econ-fuzz.js';
import { give, placeDef, must } from './helpers/rules.js';
import { lookup } from '../shared/content/index.js';
import { FERTILIZER } from '../shared/rules/actions/farming.js';

enableW4();

function start(seed) {
  const s = startFarm(seed, { level: 22, m1b: true });
  const BIG = { confirm: ['BIG_SPEND'] };
  s.farm.wallet.coins = 1_500_000;
  for (const def of ['sunset_bench', 'sunset_bench']) placeDef(s, def, BIG);
  for (const def of ['flower_bed', 'scarecrow', 'sunset_bench']) s.farm.storage[def] = (s.farm.storage[def] ?? 0) + 1;
  s.farm.storagePaid.flower_bed = 1;
  for (const pid of ['p1', 'p2']) {
    if (!s.players[pid].pet && lookup('decor', 'dog_house')) {
      must(s, 'adoptPet', { kind: pid === 'p1' ? 'dog' : 'cat', name: 'Bo' }, { pid });
    }
  }
  if (lookup('items', FERTILIZER.item)) give(s, FERTILIZER.item, 12);
  give(s, 'planks', 30);
  give(s, 'wooden_crate', 6);
  give(s, 'wood', 10);
  return s;
}

test('W4 fuzz: key order, classified events, round trips, validity and the economy invariants', () => {
  const accepted = fuzz({ seeds: [2, 4, 6, 8], steps: 200, start, roundTripEvery: 7 });
  const never = W4_FUZZED.filter((t) => !accepted.has(t));
  assert.deepEqual(never, [], `wave-4 actions never accepted: ${never.join(', ')}`);
});

test('W4 prediction == server: random interleavings of two clients through the engine converge', () => {
  converge({ seeds: [2, 4, 6], steps: 90, start });
});
