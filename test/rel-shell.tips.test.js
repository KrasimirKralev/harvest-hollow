// Release 1.0, ui-shell: the world card (hud.js worldTip). M20 (features#F4): a named animal's card says its name,
// read from farm.names (the name tag records who named it), never only from the object.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFarm } from '../shared/rules/state.js';
import { T0 } from './helpers.js';
import { worldTip } from '../public/js/ui/hud.js';

/** A farm with one cow in a pen-less test home, named in farm.names (the rules' nameAnimal shape). */
function namedCow(name) {
  const s = createFarm(7, T0);
  s.farm.objects.cow1 = { def: 'cow', home: 'pen1', placedAt: T0, by: 'p1' };
  if (name) s.farm.names.cow1 = { name, by: 'p2', at: T0 };
  return s;
}

test('M20: hovering a named cow says its name (farm.names), an unnamed one says "Cow"', () => {
  const named = worldTip(namedCow('Rada Petrova'), { kind: 'object', id: 'cow1' }, T0, 'p1');
  assert.ok(named, 'a card');
  assert.match(named.title, /Rada Petrova/);
  const plain = worldTip(namedCow(null), { kind: 'object', id: 'cow1' }, T0, 'p1');
  assert.equal(plain.title, 'Cow');
});
