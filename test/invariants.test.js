// Cross-cutting rule invariants, fuzzed over random action sequences of BOTH players (review-m0 #7, M8; the
// rules-economy brief), against the content this build plays (M1a now; test/invariants.m1b.test.js runs the same
// fuzz against the M1b content):
//   - no decision depends on the key order of a state map (index.js rule 3): every action also runs on a copy whose
//     maps have their keys reversed, and outcome, events and resulting values must be equal
//   - every emitted event is classified: FX_EVENTS (predicted feedback) or CELEBRATIONS (confirmed-only)
//   - every accepted action round-trips (run() checks ops and undo) and leaves a valid state
//   - economy: no negative or non-integer count anywhere, the Barn never holds more than its capacity (the rest is
//     overflow, and overflow exists only above capacity), coins are conserved through the ledger, every object
//     sits on unlocked, non-overlapping tiles (validateState), no NaN / Infinity
//   - prediction == server: two clients act in random interleavings through the real engine and SyncStores; after
//     every delivery both stores equal the server state
// The generator and the loops live in test/helpers/econ-fuzz.js. The goals actions are fuzzed the same way by
// rules-goals (test/goals.fuzz.test.js, GOALS_PLAYER_ACTIONS); an optional test/helpers/goals-fuzz.js
// (GOALS_FUZZED + goalsAction(rnd, state)) mixes them into this sequence too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS } from '../shared/rules/index.js';
import { MILESTONE } from '../shared/content/index.js';
import { sortedKeys, sortedEntries, byThenKey } from '../shared/rules/order.js';
import * as farming from '../shared/rules/actions/farming.js';
import * as trees from '../shared/rules/actions/trees.js';
import * as animals from '../shared/rules/actions/animals.js';
import * as crafting from '../shared/rules/actions/crafting.js';
import * as market from '../shared/rules/actions/market.js';
import * as storage from '../shared/rules/actions/storage.js';
import * as decor from '../shared/rules/actions/decor.js';
import * as boosts from '../shared/rules/actions/boosts.js';
import * as expansions from '../shared/rules/actions/expansions.js';
import * as beauty from '../shared/rules/actions/beauty.js';
import * as restoration from '../shared/rules/actions/restoration.js';
import * as town from '../shared/rules/actions/town.js';
import * as pets from '../shared/rules/actions/pets.js';
import * as upgrades from '../shared/rules/actions/upgrades.js';
import * as weeds from '../shared/rules/actions/weeds.js';
import * as avatar from '../shared/rules/actions/avatar.js';
import * as crates from '../shared/rules/actions/crates.js';
import * as relics from '../shared/rules/actions/relics.js';
import { ECON_FUZZED, M1B_FUZZED, M2_FUZZED, W4_FUZZED, W4B_FUZZED, fuzz, converge, reverseKeys } from
  './helpers/econ-fuzz.js';

// rules-goals runs its own actions through the same key-reversed-twin fuzz in test/goals.fuzz.test.js and lists
// them in test/helpers/rules-goals.js; an optional goals-fuzz.js hook (goalsAction) would also mix them in here.
const GOALS = await import('./helpers/rules-goals.js').then((m) => m.GOALS_PLAYER_ACTIONS ?? []).catch(() => []);
let goals = null;
try {
  goals = await import('./helpers/goals-fuzz.js');
} catch {
  goals = null;
}

test('fuzz: key order, classified events, round trips, validity and the economy invariants', () => {
  // the M1b content spreads the picks over more defs; wave 4's M1a crops (raspberry ...) too: a seventh seed
  const accepted = fuzz({ goals, steps: 190, seeds: [1, 2, 3, 4, 5, 6, 7] });
  // the fuzzer must actually exercise the economy: most action types are accepted at least once
  const never = [...ECON_FUZZED].filter((t) => !accepted.has(t));
  // seedBasket needs a broke farm and expand a finished proof card: their unit tests cover them; the wave-2 actions
  // are refused while their milestone is not live (test/invariants.m1b.test.js accepts them)
  // (they join only on an L16+ farm: the L12 farm here keeps the M1a mix)
  // wave 4: test/invariants.w4.test.js accepts every one (Fertilizer and pet breeds need their levels)
  // wave 4b: test/invariants.w4b.test.js accepts every one
  const hard = new Set(['seedBasket', 'expand', ...M1B_FUZZED, ...M2_FUZZED, ...W4_FUZZED, ...W4B_FUZZED]);
  assert.ok(never.filter((t) => !hard.has(t)).length <= 1, `never accepted: ${never.join(', ')}`);
});

test('every registered action is exercised by the fuzzer or is a system action', () => {
  const econ = [farming, trees, animals, crafting, market, storage, decor, boosts, expansions, beauty, restoration,
    town, pets, upgrades, weeds, avatar, crates, relics].flatMap((fam) => Object.entries(fam)
    .filter(([k, v]) => v && typeof v === 'object'
    && typeof v.apply === 'function' && !k.startsWith('_')).map(([k]) => k));
  assert.deepEqual(econ.filter((type) => !ECON_FUZZED.has(type)), [], 'add these to randomAction()');
  const fuzzed = new Set([...ECON_FUZZED, ...GOALS, ...(goals ? goals.GOALS_FUZZED : [])]);
  const missing = Object.keys(ACTIONS).filter((type) => !type.startsWith('_') && !fuzzed.has(type));
  assert.deepEqual(missing, [],
    'fuzz these (randomAction here, or rules-goals: GOALS_PLAYER_ACTIONS + test/goals.fuzz.test.js)');
});

test('prediction == server: random interleavings of two clients through the engine converge', () => {
  converge();
});

test('order helpers sort canonically', () => {
  const o = { b: 2, a: 3, c: 1 };
  assert.deepEqual(sortedKeys(o), ['a', 'b', 'c']);
  assert.deepEqual(sortedEntries(reverseKeys(o)), [['a', 3], ['b', 2], ['c', 1]]);
  assert.deepEqual(sortedEntries({ y: 1, x: 1, z: 0 }).sort(byThenKey(([, v]) => v)).map(([k]) => k), ['z', 'x', 'y']);
});
