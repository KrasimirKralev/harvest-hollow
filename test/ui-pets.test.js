// The pets page (GDD §3.4 Pets, L10, M1b; integration wave 2): adopt, a treat a day, a pat; and the Goal Tracker's
// pet cards. Every button is the rules' own action (adoptPet / feedPet / petPet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PETS } from '../shared/content/index.js';
import { goals } from '../shared/rules/goals.js';
import { petsView, petsBadge } from '../public/js/ui/panels/pets.js';
import { farmAt, actOk, act, give, T0 } from './helpers/rules-goals.js';

test('pets: adopt once, the treat and the pat, the badge and the tracker cards follow the rules', () => {
  const s = farmAt(9);
  assert.equal(petsView(s, 'p1', T0).open, false, 'pets open at level 10');
  assert.equal(petsBadge(s, 'p1', T0), null);
  const s2 = farmAt(PETS.unlock);
  let v = petsView(s2, 'p1', T0);
  assert.equal(v.open, true);
  assert.deepEqual(v.pets.map((p) => p.pid), ['p1', 'p2'], 'my pet first');
  assert.equal(petsBadge(s2, 'p1', T0), '!', 'my pet is still to adopt');
  // every plot is growing, so the card is not pushed aside by "Plant 16 empty plots"
  for (const o of Object.values(s2.farm.objects)) {
    if (o.def === 'plot') o.crop = { def: 'wheat', plantedAt: T0, readyAt: T0 + 3_600_000, by: 'p1', cycle: 0 };
  }
  let g = goals(s2, 'p1', T0);
  assert.ok([g.now, g.soon, g.big].some((c) => c && c.kind === 'pet'), 'the tracker suggests adopting');
  actOk(s2, 'adoptPet', { kind: 'dog', name: 'Rex' }, { now: T0, pid: 'p1' });
  assert.equal(act(s2, 'adoptPet', { kind: 'cat', name: 'Tom' }, { now: T0, pid: 'p1' }).code, 'ALREADY_DONE');
  give(s2, 'dog_biscuit', 2);
  v = petsView(s2, 'p1', T0);
  assert.equal(v.pets[0].pet.name, 'Rex');
  assert.equal(v.pets[0].fedToday, false);
  assert.equal(v.pets[0].treats, 2);
  for (const p of Object.values(s2.players)) p.almanac.tasks = {};        // no Almanac task in between
  g = goals(s2, 'p1', T0);
  assert.equal(g.now.kind, 'pet', g.now.text);
  assert.match(g.now.text, /^Give Rex a Dog Biscuit/);
  actOk(s2, 'feedPet', { owner: 'p1' }, { now: T0 + 1000, pid: 'p2' });
  actOk(s2, 'petPet', { owner: 'p1' }, { now: T0 + 2000, pid: 'p1' });
  v = petsView(s2, 'p1', T0 + 3000);
  assert.equal(v.pets[0].fedToday, true);
  assert.equal(v.pets[0].pettedByMe, true);
  assert.deepEqual(v.pets[0].pettedBy, ['p1']);
  assert.notEqual(goals(s2, 'p1', T0 + 3000).now.kind, 'pet', 'no treat card once it had today\'s');
});
