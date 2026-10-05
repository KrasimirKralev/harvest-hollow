// The "Planting Carrot × 14" chip over the toolbar (wave-4b verifier: opening a balloon crate showed "nullPainting × 1").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../shared/rules/index.js';          // the app loads the rules first (toolbar.js alone enters a rules import cycle)
import { strokeChip } from '../public/js/ui/toolbar.js';
import { ONCE_VERBS } from '../public/js/game/targets.js';

test('strokeChip: a drag stroke names its verb, item and count', () => {
  assert.deepEqual(strokeChip({ verb: 'plant', item: 'carrot', count: 14 }), { item: 'carrot', text: 'Planting Carrot', n: 14 });
  assert.deepEqual(strokeChip({ verb: 'water', item: null, count: 3 }), { item: null, text: 'Watering', n: 3 });
});

test('strokeChip: one-press actions (a crate, a ride, felling a Giant...) show no chip; their own card says it', () => {
  for (const verb of ONCE_VERBS) assert.equal(strokeChip({ verb, item: null, count: 1 }), null, verb);
  assert.equal(strokeChip(null), null);
  assert.equal(strokeChip({ verb: 'plant', count: 0 }), null);
});

test('strokeChip: an unknown verb never reads "Painting" or "null"', () => {
  const c = strokeChip({ verb: 'someNewVerb', item: null, count: 2 });
  assert.ok(c && !/Painting|null/.test(c.text), JSON.stringify(c));
});
