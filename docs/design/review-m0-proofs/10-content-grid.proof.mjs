// PROOF (RED on M0): (a) the content registry Maps are writable by any importer, (b) the grid supports only the
// two layers 'object' and 'ground', so GDD animals ("live in their home building", §3.4) cannot be grid objects
// without either crashing getGrid or breaking the overlap invariant, (c) place/canPlace ignore `retired`.
// Run: node --test docs/design/review-m0-proofs/10-content-grid.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT, PLACEABLES } from '../../../shared/content/index.js';
import { getGrid, canPlace } from '../../../shared/rules/grid.js';
import { resetGrid } from '../../../shared/rules/grid-cache.js';
import { validateState } from '../../../shared/rules/state.js';
import { makeFarm, run } from '../../../test/helpers.js';

test('content Maps are read-only (a stray .set/.delete in one module cannot change the rules)', () => {
  const wheat = CONTENT.crops.get('wheat');
  let threw = false;
  try { CONTENT.crops.set('wheat', { ...wheat, seed: 1, sell: 999 }); } catch { threw = true; }
  console.log('CONTENT.crops.set threw?', threw, '| wheat.sell is now', CONTENT.crops.get('wheat').sell);
  CONTENT.crops.set('wheat', wheat);                 // restore for the other tests
  assert.ok(threw, 'CONTENT.crops is a plain mutable Map');
});

test('an animal def on its own layer can be indexed by the grid', () => {
  const s = makeFarm();
  PLACEABLES.set('hen', { id: 'hen', kind: 'animal', layer: 'animal', size: [1, 1], unlock: 1 });
  s.farm.objects['zz.1.0'] = { def: 'hen', x: 20, z: 30, rot: 0, placedAt: 0, by: 'p1' };
  resetGrid(s);
  let err = null;
  try { getGrid(s); } catch (e) { err = e.message; }
  PLACEABLES.delete('hen');
  console.log('getGrid with a third layer ->', err);
  assert.equal(err, null);
});

test('an animal standing inside its coop footprint is a valid state', () => {
  const s = makeFarm();
  PLACEABLES.set('coop', { id: 'coop', kind: 'home', layer: 'object', size: [3, 3], unlock: 1 });
  PLACEABLES.set('hen', { id: 'hen', kind: 'animal', layer: 'object', size: [1, 1], unlock: 1 });
  s.farm.objects['zz.1.0'] = { def: 'coop', x: 30, z: 26, rot: 0, placedAt: 0, by: 'p1' };
  s.farm.objects['zz.2.0'] = { def: 'hen', x: 31, z: 27, rot: 0, placedAt: 0, by: 'p1' };
  resetGrid(s);
  const problems = validateState(s);
  const canBuyHen = canPlace(s, 'hen', 31, 27, 0);
  PLACEABLES.delete('coop'); PLACEABLES.delete('hen');
  console.log('validateState ->', problems, '| canPlace(hen in coop) ->', canBuyHen);
  assert.deepEqual(problems, []);
});

test('a retired placeable cannot be bought', () => {
  const s = makeFarm();
  PLACEABLES.set('old_plot', { ...PLACEABLES.get('plot'), id: 'old_plot', retired: true });
  const r = run(s, 'place', { def: 'old_plot', x: 24, z: 33, rot: 0 });
  PLACEABLES.delete('old_plot');
  console.log('place retired def ->', r.ok ? 'ACCEPTED' : r.code);
  assert.equal(r.ok, false);
});
