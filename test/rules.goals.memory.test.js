// The Memory Book (GDD §5.9, Our Story ribbon): auto pages at the GDD's moments, offered pages kept by the players,
// at most two offered pages a player a day counting for the ribbon, and no page from a rename.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { memoryRows, MEMORY } from '../shared/rules/actions/memory.js';
import { farmAt, put, credit, act, actOk, valid, forceM1bGoals, T0, MIN, DAY, HOUR } from './helpers/rules-goals.js';
import { xpForLevel } from '../shared/content/index.js';

before(forceM1bGoals);

test('auto pages: the farm\'s first name, an animal\'s first name, every 5th level, the first prized animal', () => {
  const s = farmAt(4);
  actOk(s, 'nameFarm', { name: 'Sunny Acres' }, { now: T0 });
  actOk(s, 'nameFarm', { name: 'Sunny Acres 2' }, { now: T0 + MIN });
  const coop = put(s, 'coop');
  const hen = put(s, 'chicken', { home: coop });
  actOk(s, 'nameAnimal', { id: hen, name: 'Clover' }, { now: T0 + 2 * MIN, pid: 'p2' });
  actOk(s, 'nameAnimal', { id: hen, name: 'Daisy' }, { now: T0 + 3 * MIN });
  s.farm.xp = xpForLevel(5) - 1;
  credit(s, [{ e: 'cleared', id: 'x', def: 'weed', xp: 1, coins: 0 }], { now: T0 + 4 * MIN });
  credit(s, [{ e: 'prized', id: hen, animal: 'chicken' }, { e: 'prized', id: hen, animal: 'chicken' }],
    { now: T0 + 5 * MIN });
  const kinds = memoryRows(s).map((r) => r.k).reverse();
  assert.deepEqual(kinds.filter((k) => k !== 'season'), ['farm', 'animal', 'level', 'prized']);
  assert.equal(memoryRows(s).find((r) => r.k === 'animal').by, 'p2', 'who named it');
  assert.equal(s.farm.stats.memoryPages, s.farm.memory.n);
  valid(s);
});

test('offered pages: kept every time, counted for Our Story at most twice a player a day', () => {
  const s = farmAt(10);
  const n0 = s.farm.stats.memoryPages ?? 0;
  for (let i = 0; i < 5; i++) actOk(s, 'memoryPage', { k: 'photo', text: `shot ${i}` }, { now: T0 + i * MIN });
  actOk(s, 'memoryPage', { k: 'golden' }, { now: T0 + 6 * MIN, pid: 'p2' });
  assert.equal(memoryRows(s).filter((r) => r.k === 'photo').length, 5, 'every page is kept');
  const seasonPages = memoryRows(s).filter((r) => r.k === 'season').length;
  assert.equal((s.farm.stats.memoryPages ?? 0) - n0, 2 + 1 + seasonPages, 'two of p1 and one of p2 count');
  actOk(s, 'memoryPage', { k: 'photo' }, { now: T0 + DAY + HOUR });
  assert.equal((s.farm.stats.memoryPages ?? 0) - n0, 4 + seasonPages, 'a new day counts again');
  assert.equal(act(s, 'memoryPage', { k: 'level' }, { now: T0 }).code, 'BAD_ARGS', 'auto kinds are the rules\'');
  assert.ok(MEMORY.max >= 100);
  valid(s);
});

test('Our Story: ten pages reach Bronze for both players (T)', () => {
  const s = farmAt(10);
  for (let d = 0; d < 6; d++) {
    for (const pid of ['p1', 'p2']) actOk(s, 'memoryPage', { k: 'photo' }, { now: T0 + d * DAY + MIN, pid });
  }
  assert.ok(s.farm.ribbons.our_story?.t >= 1);
  valid(s);
});
