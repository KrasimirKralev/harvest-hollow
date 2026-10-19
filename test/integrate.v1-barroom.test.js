// Release 1.0, integration of the verify-1 fix round (docs/agent-notes/rel-integration.md).
// The cross-lane patch of the lead's walk (docs/qa/release/verify-1/fix-lead.md "Cross-lane", W-1) for ui-shell's
// public/js/ui/tutorial.js; the lead left its test to ui-shell, the integrator wrote it with the patch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// verify-1 W-1 (the lead's walk, fix-lead.md "Cross-lane"): on an iPhone 13 with reduced motion the room over the bar
// for Grandma's arrow grew 81 -> 96 -> 131 -> ... to the 220 px cap, because every 500 ms re-measure added the same
// overlap again before the bar's margin (and her card) had moved. It grows again only once the last growth landed.
test('W-1: the room over the bar grows once per landed growth, never stacking the same overlap', async () => {
  const TUT = await import('../public/js/ui/tutorial.js');
  assert.equal(typeof TUT.nextRoom, 'function', 'tutorial.js nextRoom(room, roomOf, over, landed)');
  assert.equal(TUT.nextRoom(0, 'bar', 15), 81, 'the first growth from the stylesheet\'s 66 px');
  assert.equal(TUT.nextRoom(81, 'bar', 15, () => false), 81, 'the margin still 0: no second growth (HEAD 96)');
  assert.equal(TUT.nextRoom(81, 'bar', 15, () => true), 96, 'landed and still overlapping: it grows again');
  assert.equal(TUT.nextRoom(200, 'bar', 50, () => true), 220, 'capped at 220');
  assert.equal(TUT.nextRoom(81, 'bar', 0, () => true), 81, 'no overlap: unchanged');
  assert.equal(TUT.nextRoom(40, 'tray', 15, () => false), 55, 'the tray and the pop-up keep growing as before');
  // the bar's own margin decides "landed" (css/mobile.css body.tut-bar #toolbar { margin-top: var(--tut-room) })
  let calls = 0;
  let room = 0;
  for (let i = 0; i < 6; i += 1) room = TUT.nextRoom(room, 'bar', 15, () => { calls += 1; return false; });
  assert.equal(room, 81, 'six re-measures with the card not moved: one growth (HEAD stacked it to 156)');
  assert.ok(calls >= 5, 'landed() asked on every re-measure after the first growth');
  const src = fs.readFileSync(new URL('../public/js/ui/tutorial.js', import.meta.url), 'utf8');
  assert.match(src, /getComputedStyle\(bar\)\.marginTop/, 'barRoom reads the bar\'s margin');
});
