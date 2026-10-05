// QA wave 2 integration: the cross-lane notes the lead applied (docs/agent-notes/integration-qa2.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farmAt, put, act, actOk, runDue, freeSpot, T0, MIN, MONDAY } from './helpers/rules-goals.js';   // first: loads the rules in order
import { beautyOf } from '../shared/rules/actions/beauty.js';
import { goals } from '../shared/rules/goals.js';
import { almanacLiveSlot } from '../shared/rules/daily.js';
import { almanacView } from '../public/js/ui/panels/goals-model.js';
import { live, defOf } from '../shared/content/index.js';
import { resetGrid } from '../shared/rules/grid.js';

const fresh = (s, now, o) => beautyOf(structuredClone(s), now, o);   // a clone carries no Symbol-keyed memo

test('SV-02 #3: the memoised Farm Beauty equals a fresh one after placements, removals and receipts settling', () => {
  const s = farmAt(22, { coins: 5_000_000 });
  const early = T0 + MIN;
  const later = T0 + 30 * MIN;                                       // past every undo receipt
  const check = (now) => {
    for (const settledOnly of [false, true]) {
      assert.deepEqual(beautyOf(s, now, { settledOnly }), fresh(s, now, { settledOnly }), `now ${now} ${settledOnly}`);
    }
  };
  check(early);
  const [x, z] = freeSpot(s, defOf('flower_bed'));
  actOk(s, 'place', { def: 'flower_bed', x, z, rot: 0, confirm: ['BIG_SPEND'] }, { now: T0 });
  check(early);                                                      // unsettled: counts live, not settled
  const a = beautyOf(s, early, { settledOnly: true }).score;
  check(later);                                                      // the receipt settled: the memo must not hold
  const b = beautyOf(s, later, { settledOnly: true }).score;
  assert.ok(b > a, `settled beauty rises once the receipt settles (${a} -> ${b})`);
  check(early);                                                      // and back again for an earlier clock
  put(s, 'fountain');                                                // a direct write (resetGrid) is seen too
  check(later);
});

test('RC-01 sibling: the land card names every good a list proof accepts', () => {
  const s = farmAt(22);
  s.farm.expansions = live('expansions').filter((e) => e.k < 7).map((e) => e.id);
  s.farm.proofs.riverbank = { at: T0, n: {} };
  for (const id of Object.keys(s.farm.objects)) delete s.farm.objects[id];   // nothing else to do: the land card leads
  resetGrid(s);
  actOk(s, 'adoptPet', { kind: 'dog', name: 'Rex' }, { now: T0 });       // the adopt card would lead otherwise
  // M2: unspent perk points are a NOW card of their own; spend them as a player would
  for (let k = 0; k < 20 && act(s, 'perkPick', { tree: 'grower' }, { now: T0 }).ok; k++);
  // spending cards take turns (every 4 minutes): look across a few
  const texts = [];
  for (let k = 0; k < 6; k++) texts.push(goals(s, 'p1', T0 + k * 30 * MIN).now?.text);
  const land = texts.find((t) => t && t.startsWith('Riverbank:'));
  assert.ok(land, texts.join(' | '));
  assert.equal(land, 'Riverbank: Make 3 more Cotton Totes or Wool Pillows');
});

test('RC-12 (ui half): the Journal marks the one Almanac task that counts now', () => {
  const s = farmAt(10, { now: MONDAY });
  put(s, 'coop');
  runDue(s, MONDAY);
  const a = s.players.p1.almanac;
  assert.ok(a && a.tasks && Object.keys(a.tasks).length > 1, 'the fixture has Almanac tasks');
  const v = almanacView(s, 'p1');
  const live = v.tasks.filter((t) => t.live);
  assert.equal(live.length, 1);
  assert.equal(String(live[0].slot), almanacLiveSlot(a));
});

test('a land card never asks for Planks the farm cannot make: it names the Sawmill to build first', () => {
  const s = farmAt(12);
  s.farm.wallet.coins = 40_000;
  s.farm.expansions = live('expansions').filter((e) => e.k < 2).map((e) => e.id);
  const land = live('expansions').find((e) => e.k === 2);
  for (const id of Object.keys(s.farm.objects)) delete s.farm.objects[id];      // nothing else to do: land leads
  resetGrid(s);
  s.farm.proofs[land.id] = { at: T0 - 60 * MIN, n: {} };
  land.proof.forEach((t, i) => {
    if (t.verb === 'own') for (let k = 0; k < t.qty; k++) put(s, t.ref, { placedAt: T0 - 60 * MIN });
    else s.farm.proofs[land.id].n[String(i)] = t.qty;
  });
  delete s.farm.inventory.planks;
  resetGrid(s);
  if (!s.players.p1.pet) actOk(s, 'adoptPet', { kind: 'dog', name: 'Rex' }, { now: T0 });
  const texts = [];
  for (let k = 0; k < 12; k++) texts.push(goals(s, 'p1', T0 + k * 4 * MIN).now?.text);   // spend cards take turns
  assert.ok(!texts.some((t) => /Make \d+ more Planks/.test(t ?? '')), texts.join(' | '));
  assert.ok(texts.some((t) => t && t.startsWith(`${land.name} needs`) && /Sawmill/.test(t)), texts.join(' | '));
});
