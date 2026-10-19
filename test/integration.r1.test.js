// Release 1.0, QA round 1 integration: the cross-lane patches the integrator applied and the reds the integrator's
// gate run found on the merged tree. Pixels in docs/qa/release/build/integration/qa-r1/.
//   - P-06 (ui-panels' cross-lane 8): a placed Memory Wall or Keepsake Shelf opens the Journal on its Memories pages.
//   - i18n-shots clipY (ui-panels' cross-lane 5): the phone tool slot's name clipped the feet of its letters
//     ("Ръка", "Тръстика": a 13 px line box, 17 px of outlined letters): only its sides clip now.
//   - The coach's arrow sat on a quest card's words (life-feel's cross-lane 5; the 360 BG coach-wait frame): it steps
//     aside while a card covers it.
//   - The bottom-left column (the Undo chip, the feed lines) lay on a stroke's "Planting Wheat × 4" chip on phones: it
//     steps aside while the chip shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIECE_PANELS, PIECE_TABS } from '../public/js/game/interior.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('P-06: the Memory Book pieces open the Journal on its Memories tab; the Ribbon Wall keeps its own panel', () => {
  for (const id of ['memory_wall', 'keepsake_shelf']) {
    assert.ok(PIECE_PANELS[id], `${id} opens a panel`);
    assert.equal(PIECE_TABS[id], 'memory', `${id} lands on Journal › Memories`);
  }
  assert.equal(PIECE_TABS.ribbon_wall, undefined);
  assert.match(read('public/js/game/interior.js'), /openPanel\(PIECE_PANELS\[def\.id\], PIECE_TABS\[def\.id\] \? \{ tab: PIECE_TABS\[def\.id\] \} : \{\}\)/);
});

test('the phone tool slot name clips only its sides (i18n-shots clipY on "Ръка" 13 / 17 px)', () => {
  const css = noComments(read('public/css/mobile.css'));
  const rules = [...css.matchAll(/\.tool \.name \{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(rules.length >= 2, 'both phone layouts style the name');
  for (const r of rules) {
    assert.match(r, /overflow-y:\s*visible/, `the letters' feet show: ${r.trim()}`);
    assert.match(r, /overflow-x:\s*clip/, `a long name still never spills sideways: ${r.trim()}`);
  }
});

test('the coach arrow steps aside while a quest card covers its plot', () => {
  const css = noComments(read('public/css/shell.css'));
  assert.match(css, /\.pointer\.under-card \{[^}]*opacity:\s*0/);
  const src = read('public/js/ui/tutorial.js');
  // QA r2 S2-08 (ui-shell): the tile arrow may come from below when from above lies on Grandma's card; the quest card
  // is measured against the arrow as it is drawn
  assert.match(src, /el\.classList\.toggle\('under-card', Boolean\(cr && overlaps\(arrowBox\(\.\.\.tileWay\), cr, 0\)\)\)/);
  // set once per placement after the card is measured (a remove first, then the measuring, restarted the fade every frame)
  assert.doesNotMatch(src, /const el = pointer\.el;\n {4}el\.classList\.remove\('under-card'\)/);
  assert.match(src, /setInterval\(\(\) => \{ if \(pointer\) place\(\); \}, 500\)/, 'placed on a timer too: an idle farm draws no frames');
});

test('on a phone the bottom-left column steps aside while a stroke chip shows (not for the Hammer hint)', () => {
  const css = noComments(read('public/css/mobile.css'));
  assert.match(css, /#hud:has\(\.stroke-chip:not\(\.hammer-hint\):not\(\[hidden\]\)\) \.hud-bl \{ visibility: hidden; \}/);
});
