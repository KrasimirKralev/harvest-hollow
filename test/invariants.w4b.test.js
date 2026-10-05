// The economy invariants fuzz (test/invariants.test.js) with the wave-4b actions in the mix (balloon crates and the
// `_crate` system action, the Acorn shop's relics, saveFor and the three used by hand, queue reorder, per-item finish,
// homes that grow when a full one gets one more animal): an L22 farm with the M1b set-up, Acorns to spend, three relics
// already owned (the Time Turner used today), a crate on the ground and two long queues. Same checks: key-reversed
// twin, classified events, round trips, validity, ledger, Barn, plot cap; and the two-client convergence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzz, converge, startFarm, enableW4b, W4B_FUZZED } from './helpers/econ-fuzz.js';
import { give, placeDef, must } from './helpers/rules.js';
import { T0 } from './helpers.js';

const HOUR = 3_600_000;
import { CRATES, defOf, recipesOf } from '../shared/content/index.js';
import { crateSpot } from '../shared/rules/actions/crates.js';
import { resetGrid } from '../shared/rules/grid-cache.js';
import { dayIndex } from '../shared/rules/calendar.js';

enableW4b();

function start(seed) {
  const s = startFarm(seed, { level: 22, m1b: true });
  const BIG = { confirm: ['BIG_SPEND'] };
  s.farm.wallet.coins = 1_500_000;
  s.farm.wallet.acorns = 2000;
  for (const def of ['bakery', 'kitchen']) {
    if (!Object.values(s.farm.objects).some((o) => o.def === def)) placeDef(s, def, BIG);
  }
  for (const id of ['farmhand', 'golden_can']) s.farm.relics[id] = { at: T0, by: 'p1' };
  // the Time Turner already used today: the long queues below wait for the reorders until tomorrow
  s.farm.relics.time_turner = { at: T0, by: 'p2', d: dayIndex(T0, s.meta.tz) };
  const spot = crateSpot(s, 1, () => 0.37);
  if (spot) {
    s.farm.objects['crate.1'] = { def: CRATES.def, x: spot[0], z: spot[1], rot: 0, placedAt: T0, by: 'sys', k: 1,
      until: T0 + CRATES.keepMs };
  }
  s.farm.crates.k = Math.floor((T0 - CRATES.dropAtMs) / CRATES.everyMs);
  resetGrid(s);
  give(s, 'flour', 20);
  give(s, 'egg', 20);
  give(s, 'milk', 20);
  // two workshops with their longest recipe queued five times (hours of waiting items), so reorder, the per-item
  // finish and the Time Turner have work for most of the run
  const shops = Object.keys(s.farm.objects).sort().filter((id) => defOf(s.farm.objects[id].def)?.kind === 'building');
  let n = 0;
  for (const id of shops) {
    const r = recipesOf(s.farm.objects[id].def).filter((x) => x.inputs && x.unlock <= 22 && !x.duet)
      .sort((x, y) => y.ms - x.ms)[0];
    if (!r || n >= 2) continue;
    s.farm.objects[id].slots = 6;
    for (const [item, q] of Object.entries(r.inputs)) give(s, item, q * 5);
    for (let i = 0; i < 5; i++) must(s, 'craft', { id, recipe: r.id }, { now: T0 });
    // setup only: six hours an item, so the waiting items outlast the fuzz's time jumps for a good part of the run
    s.farm.objects[id].queue = s.farm.objects[id].queue.map((q, i) => ({ ...q, s: T0 + i * 6 * HOUR,
      e: T0 + (i + 1) * 6 * HOUR }));
    n++;
  }
  return s;
}

test('W4b fuzz: key order, classified events, round trips, validity and the economy invariants', () => {
  const accepted = fuzz({ seeds: [2, 4, 8, 10], steps: 180, start, roundTripEvery: 6 });
  const never = W4B_FUZZED.filter((t) => !accepted.has(t));
  assert.deepEqual(never, [], `wave-4b actions never accepted: ${never.join(', ')}`);
  assert.ok(accepted.has('_crate'), 'the balloon never dropped a crate');
});

test('W4b prediction == server: random interleavings of two clients through the engine converge', () => {
  converge({ seeds: [2, 4, 8], steps: 90, start });
});
