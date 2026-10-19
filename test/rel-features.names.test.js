// Release 1.0, D4 "Named animals on the farm" (features#F4), the rules side: names already live in farm.names (who
// named, when), and the ✎ prompt on a newborn may reach whoever sees it first: either farmer names any animal, the
// first name is the Memory Book's page, a later one a rename. (The tags and floats are life-feel's, the tooltip
// ui-shell's M20.) Nothing in the rules had to change: this test pins it so 1.0 keeps it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farmAt, put, actOk, evs, valid, T0 } from './helpers/rules-goals.js';

test('D4: either farmer names a newborn bought by the other; the first name is the page, a later one a rename', () => {
  const s = farmAt(8);
  const home = put(s, 'coop');
  const chick = put(s, 'chicken', { home, by: 'p1', adultAt: T0 + 3_600_000, fedAt: null, readyAt: null, cycle: 0, cut: 0 });
  const r = actOk(s, 'nameAnimal', { id: chick, name: 'Clover' }, { pid: 'p2' });
  assert.equal(evs(r, 'named')[0].first, true);
  assert.deepEqual(s.farm.names[chick], { name: 'Clover', by: 'p2', at: T0 });
  const r2 = actOk(s, 'nameAnimal', { id: chick, name: 'Daisy' }, { pid: 'p1', now: T0 + 1000 });
  assert.equal(evs(r2, 'named')[0].first, false);
  assert.equal(s.farm.names[chick].by, 'p1');
  valid(s);
});
