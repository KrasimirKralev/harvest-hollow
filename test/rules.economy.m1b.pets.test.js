// M1b pets (GDD §3.4 Pets, §6.2 #14): one pet each, a treat a day, the morning find, the both-petted treasure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m1b } from './helpers/rules-economy.js';

const M = await m1b();
const { content } = M;
const { farmAt, give, must, run, evs, T0, HOUR } = M.rulesHelpers;
const { sys } = M.helpers;
const { validateState } = M.state;
const pets = await import('../shared/rules/actions/pets.js');
const DAY = 24 * HOUR;

test('each player adopts one pet from L10 and names it', () => {
  const s = farmAt(9);
  assert.equal(run(s, 'adoptPet', { kind: 'dog', name: 'Rex' }).code, 'LOCKED');
  s.farm.xp = content.xpForLevel(10);
  const r = must(s, 'adoptPet', { kind: 'dog', name: '  Rex<b>  ' });
  assert.deepEqual(evs(r, 'petAdopted')[0], { e: 'petAdopted', pid: 'p1', kind: 'dog', name: 'Rexb', by: 'p1' });
  assert.equal(run(s, 'adoptPet', { kind: 'cat', name: 'Tom' }).code, 'ALREADY_DONE');
  assert.equal(run(s, 'adoptPet', { kind: 'cat', name: '   ' }, { pid: 'p2' }).code, 'BAD_ARGS');
  assert.equal(run(s, 'adoptPet', { kind: 'horse', name: 'X' }, { pid: 'p2' }).code, 'BAD_ARGS');
  must(s, 'adoptPet', { kind: 'cat', name: 'Mitzi' }, { pid: 'p2' });
  assert.deepEqual(validateState(s), []);
});

test('one treat a day (anyone may give it); the find comes the next morning, once', () => {
  const s = farmAt(10);
  must(s, 'adoptPet', { kind: 'dog', name: 'Rex' });
  assert.equal(run(s, 'feedPet', { owner: 'p1' }).code, 'NO_ITEMS');
  give(s, 'dog_biscuit', 3);
  const r = must(s, 'feedPet', { owner: 'p1' }, { pid: 'p2' });
  assert.deepEqual(evs(r, 'petFed')[0], { e: 'petFed', pid: 'p1', pet: 'dog', by: 'p2' });
  assert.equal(run(s, 'feedPet', { owner: 'p1' }, { now: T0 + HOUR }).code, 'ALREADY_DONE');
  assert.equal(pets.petFindsDue(s, T0 + HOUR).length, 0, 'not the same day');
  const next = pets.nextPetFindAt(s, T0);
  assert.ok(next > T0 && next <= T0 + DAY, 'the scheduler wakes at the farm-day change');
  assert.ok(M.expansions.econNextDueAt(s, T0) <= next);
  assert.equal(pets.petFindsDue(s, next).length, 1);
  assert.ok(M.expansions.econDue(s, next).some((a) => a.type === '_petFind'));
  const f = sys(s, '_petFind', {}, next);
  const ev = evs(f, 'petFind');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].pid, 'p1');
  assert.equal(ev[0].treasure, false);
  assert.equal(s.players.p1.pet.fed, null);
  assert.equal(sys(s, '_petFind', {}, next + HOUR).code, 'NOT_READY', 'once');
  must(s, 'feedPet', { owner: 'p1' }, { now: next + HOUR });          // and a new treat that day
  assert.deepEqual(validateState(s), []);
});

test('a find is a seed packet, 3 Compost or a collection roll, rolled on a replicated counter', () => {
  const kinds = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const s = farmAt(10, { seed });
    must(s, 'adoptPet', { kind: 'cat', name: 'Mitzi' });
    give(s, 'cat_treat', 1);
    must(s, 'feedPet', { owner: 'p1' });
    const f = evs(sys(s, '_petFind', {}, T0 + DAY), 'petFind')[0];
    kinds.add(f.find);
    if (f.find === 'seeds') {
      assert.equal(s.farm.seeds[f.crop], f.n);
      assert.ok(content.cropOf(f.crop).unlock <= 10);
    }
    if (f.find === 'items') assert.equal(s.farm.inventory.compost, 3);
    if (f.find === 'roll') assert.equal(f.roll, true);
    assert.equal(s.farm.rolls.pet, 1);
  }
  assert.deepEqual([...kinds].sort(), ['items', 'roll', 'seeds']);
});

test('both players petting both pets on a day: each pet digs up a second find next morning', () => {
  const s = farmAt(10);
  must(s, 'adoptPet', { kind: 'dog', name: 'Rex' });
  must(s, 'adoptPet', { kind: 'cat', name: 'Mitzi' }, { pid: 'p2' });
  give(s, 'dog_biscuit', 1);
  give(s, 'cat_treat', 1);
  must(s, 'feedPet', { owner: 'p1' });
  must(s, 'feedPet', { owner: 'p2' });
  must(s, 'petPet', { owner: 'p1' });
  assert.equal(run(s, 'petPet', { owner: 'p1' }).code, 'ALREADY_DONE');
  must(s, 'petPet', { owner: 'p2' });
  must(s, 'petPet', { owner: 'p1' }, { pid: 'p2' });
  const last = must(s, 'petPet', { owner: 'p2' }, { pid: 'p2' });
  assert.equal(evs(last, 'petTreasure').length, 1);
  const f = evs(sys(s, '_petFind', {}, T0 + DAY), 'petFind');
  assert.equal(f.length, 4, 'two pets, two finds each');
  assert.equal(f.filter((e) => e.treasure).length, 2);
  // solo petting never makes a treasure
  const s2 = farmAt(10);
  must(s2, 'adoptPet', { kind: 'dog', name: 'Rex' });
  must(s2, 'petPet', { owner: 'p1' });
  must(s2, 'petPet', { owner: 'p1' }, { pid: 'p2' });
  assert.equal(s2.players.p1.pet.treasure, null, 'one pet is not both pets');
});

test('the treat below its Keep N asks first (soft RESERVED), like feeding animals', () => {
  const s = farmAt(10);
  must(s, 'adoptPet', { kind: 'dog', name: 'Rex' });
  give(s, 'dog_biscuit', 2);
  s.farm.keep.dog_biscuit = { n: 2, by: 'p2' };
  assert.equal(run(s, 'feedPet', { owner: 'p1' }).code, 'RESERVED');
  must(s, 'feedPet', { owner: 'p1', confirm: ['RESERVED'] });
});
