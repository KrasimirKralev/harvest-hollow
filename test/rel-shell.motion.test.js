// Release 1.0, ui-shell M25 (critique#4, perf-a11y#14): reduced motion follows the device until the player picks;
// HEAD stored motion 'full' on every settings save (it cannot be told apart from a pick), so a stored 'full' without
// the versioned field reads as "follow the system"; an explicit pick is stored in the versioned field and kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const S = await import('../public/js/ui/settings.js');

test('M25: the default is "system"; HEAD\'s stored "full" reads as "system"; a 1.0 pick stays', () => {
  const { sanitize, DEFAULTS } = S;
  assert.equal(DEFAULTS.motion, 'system');
  assert.equal(sanitize({ motion: 'full', volume: { master: 50 } }).motion, 'system', "HEAD's stored 'full' is not a pick");
  assert.equal(sanitize({ motion: 'still' }).motion, 'still', 'a HEAD "still" was a pick (the default never stored it)');
  assert.equal(sanitize({ motion2: 'full' }).motion, 'full', 'a 1.0 pick of "full" is kept');
  assert.equal(sanitize({ motion2: 'system', motion: 'reduced' }).motion, 'system');
  assert.equal(sanitize(null).motion, 'system');
});

test('M25: "system" follows the device, re-read every time; a pick wins', () => {
  const { motionOf } = S;
  assert.equal(typeof motionOf, 'function', 'settings.js motionOf(settings, prefersReduced)');
  assert.equal(motionOf({ motion: 'system' }, true), 'reduced');
  assert.equal(motionOf({ motion: 'system' }, false), 'full');
  assert.equal(motionOf({ motion: 'full' }, true), 'full', 'the player chose full motion');
  assert.equal(motionOf({ motion: 'still' }, false), 'still');
});
