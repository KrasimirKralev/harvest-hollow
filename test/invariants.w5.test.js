// The economy invariants fuzz (test/invariants.test.js) with the wave-5 actions in the mix: pairings in the pen (pair,
// pairCancel, and the `_pen` system action when a baby is due), the pets told to stay home or come along (petStay).
// An L12 farm with a coop and a cow barn holding adults, both players' pets adopted. Same checks: key-reversed twin,
// classified events, round trips, validity, ledger, Barn, plot cap; and the two-client convergence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzz, converge, startFarm, enableW5, W5_FUZZED } from './helpers/econ-fuzz.js';
import { give, placeDef, must } from './helpers/rules.js';

enableW5();

function start(seed) {
  const s = startFarm(seed, { level: 12 });
  const BIG = { confirm: ['BIG_SPEND'] };
  s.farm.wallet.coins = 1_500_000;
  s.farm.barn = 3;                                         // room for the feed and bottles below
  const homes = Object.keys(s.farm.objects).filter((id) => ['coop', 'cow_barn'].includes(s.farm.objects[id].def));
  if (!homes.some((id) => s.farm.objects[id].def === 'coop')) placeDef(s, 'coop', BIG);
  if (!homes.some((id) => s.farm.objects[id].def === 'cow_barn')) placeDef(s, 'cow_barn', BIG);
  for (let i = 0; i < 3; i++) must(s, 'buyAnimal', { def: 'chicken', adult: true, ...BIG });
  for (let i = 0; i < 2; i++) must(s, 'buyAnimal', { def: 'cow', adult: true, ...BIG });
  give(s, 'chicken_feed', 30);
  give(s, 'baby_bottle', 10);
  if (!s.players.p1.pet) must(s, 'adoptPet', { kind: 'dog', name: 'Rex' });
  if (!s.players.p2.pet) must(s, 'adoptPet', { kind: 'cat', name: 'Mitzi' }, { pid: 'p2' });
  return s;
}

test('W5 fuzz: key order, classified events, round trips, validity and the economy invariants', () => {
  const accepted = fuzz({ seeds: [3, 5, 9], steps: 180, start, roundTripEvery: 6 });
  const never = W5_FUZZED.filter((t) => !accepted.has(t));
  assert.deepEqual(never, [], `wave-5 actions never accepted: ${never.join(', ')}`);
  assert.ok(accepted.has('_pen'), 'no baby was ever born in a pen');
});

test('W5 prediction == server: random interleavings of two clients through the engine converge', () => {
  converge({ seeds: [3, 5, 9], steps: 90, start });
});
