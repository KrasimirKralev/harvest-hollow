// The owners' save crosses into wave 2: a level-12 farm played on the M1a build (RULES_VERSION 3, before wave 2)
// boots on the M1b build without degradation: every new field is backfilled, the state validates, and once the farm
// levels into M1b the weekly systems open and run through two weeks of server catch-up (GDD §10 M1b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backfill } from '../server/migrations.js';
import { validateState } from '../shared/rules/state.js';
import { xpForLevel, levelFromXp } from '../shared/content/index.js';
import { runDue, actOk } from './helpers/rules-goals.js';

const DAY = 24 * 3_600_000;
const load = () => JSON.parse(readFileSync(new URL('./fixtures/save-m1a-l12.json', import.meta.url), 'utf8'));

test('a wave-1 save gets every M1b field from backfill and validates', () => {
  const { state, now } = load();
  assert.equal(levelFromXp(state.farm.xp), 12);
  assert.ok(validateState(state).length > 0, 'the old save lacks the M1b fields');
  const filled = backfill(state, { now, tz: 'Europe/Sofia' });
  for (const k of ['farm.beauty', 'farm.restore', 'farm.town', 'farm.fair', 'farm.barge', 'farm.album', 'farm.folk',
    'farm.made', 'farm.memory', 'players.p1.pet', 'players.p2.pet']) assert.ok(filled.includes(k), k);
  assert.deepEqual(validateState(state), []);
  // nothing the couple owned moved or vanished
  const before = load().state;
  assert.deepEqual(Object.keys(state.farm.objects).sort(), Object.keys(before.farm.objects).sort());
  assert.equal(state.farm.wallet.coins, before.farm.wallet.coins);
  assert.deepEqual(state.farm.inventory, before.farm.inventory);
});

test('the migrated farm levels into M1b: the Fair and the Barge open and two weeks of catch-up stay valid', () => {
  const { state, now } = load();
  backfill(state, { now, tz: 'Europe/Sofia' });
  runDue(state, now);
  state.farm.xp = xpForLevel(16);                      // the couple plays on to L16 (Fair L14, Barge L15)
  for (let t = now + DAY; t <= now + 14 * DAY; t += DAY) runDue(state, t);
  assert.deepEqual(validateState(state), []);
  assert.ok(state.farm.fair.cur || state.farm.fair.last, 'a Fair week opened');
  assert.ok(state.farm.barge.w >= 0, 'the barge came to the jetty');
  // and a player action of the new systems goes through on it
  const t = now + 14 * DAY + 3_600_000;
  runDue(state, t);
  actOk(state, 'adoptPet', { kind: 'dog', name: 'Rex' }, { now: t, pid: 'p1' });
  assert.deepEqual(validateState(state), []);
});
