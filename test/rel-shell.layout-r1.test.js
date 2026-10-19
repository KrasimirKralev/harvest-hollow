// QA r1, ui-shell: the layout fixes whose proof is on screen (docs/qa/release/build/ui-shell/qr1/, the probe numbers in
// docs/qa/release/qa-r1/fix-ui-shell.md). These pin the rules and hooks that make them, so a later edit cannot drop one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const SHELL = strip(read('public/css/shell.css'));
const MOBILE = strip(read('public/css/mobile.css'));

test('S-25: before Orders opens the phone bar has four even slots (no hole where Orders will come)', () => {
  assert.match(read('public/js/ui/hud.js'), /document\.body\.dataset\.bar = String\(2 \+ shownBig\.filter\(\(d\) => d\.name !== 'build'\)\.length\)/);
  assert.match(MOBILE, /body\[data-bar="4"\] \{ --slot: calc\(\(100vw - 12px - var\(--sal\) - var\(--sar\)\) \/ 4\); \}/);
});

test('S-34: the tool slot\'s word wears the doors\' label style (white, outlined) in the phone bar', () => {
  const rules = [...MOBILE.matchAll(/#toolbar \.tool-cur \.name \{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(rules.length >= 2, 'portrait and landscape');
  for (const r of rules) { assert.match(r, /color: #fff/); assert.match(r, /text-shadow:/); }
});

test('S-07: a phone tool name shrinks to fit by measure (no scaleX that leaves the last letter cut)', () => {
  assert.doesNotMatch(MOBILE, /\.tool \.name\.long \{[^}]*scaleX/, 'HEAD: scaleX(.86) inside overflow: hidden');
  assert.match(read('public/js/ui/toolbar.js'), /if \(isPhone\(\)\) fitLabel\(nameEl\);/);
  assert.match(read('public/js/ui/dom.js'), /export function fitLabel\(el/);
});

test('S-19: the join card\'s six colours share one row at 360 (they shrink a little rather than wrap)', () => {
  assert.match(MOBILE, /\.slot \.swatches \.swatch \{ flex: 1 1 0; min-width: 0; max-width: 44px; height: auto; aspect-ratio: 1; \}/);
});

test('S-14: on a phone the Undo chip stands above Grandma\'s card (tutorial.js measures the card)', () => {
  assert.match(MOBILE, /body\.coach-on \.hud-bl \{ bottom: calc\(var\(--bar-h\) \+ var\(--sab\) \+ 20px \+ var\(--coach-h, 0px\)\); \}/);
  assert.match(read('public/js/ui/tutorial.js'), /document\.body\.style\.setProperty\('--coach-h'/);
});

test('S-15: an off-screen target gets an edge arrow with no ring; S-22: no hover card over the celebration', () => {
  assert.match(SHELL, /\.pointer\.edge \.halo \{ display: none; \}/);
  assert.match(SHELL, /\.pointer\.edge \.arrow \{ animation: edge-nudge/);
  assert.match(SHELL, /body\.celebrating #tip \{ visibility: hidden; \}/);
  assert.match(read('public/js/ui/hud.js'), /partyPick = worldPick/, 'the card comes back on the next pointer move');
});

test('S-23: the stacked farmer dots reach out and down for a finger', () => {
  assert.match(MOBILE, /\.players li:first-child:not\(:only-child\) \.farmer::before \{ inset: -12px -10px -1px; \}/);
  assert.match(MOBILE, /\.players li:last-child:not\(:only-child\) \.farmer::before \{ inset: -1px -10px -12px; \}/);
});

test('S-33: the Farm book fits its captions to their column; the together captions are real elements', () => {
  assert.match(read('public/js/ui/layout.js'), /export function fitCaptions\(root\)/);
  assert.doesNotMatch(SHELL, /\.social-btn::after \{ content: attr\(data-label\)/, 'HEAD: an unmeasurable ::after caption');
  assert.match(read('public/js/ui/social.js'), /cap = h\('span\.lbl', \{ 'aria-hidden': 'true' \}\)/);
});

test('S-37: a sheet\'s entrance runs once (is-opening leaves when it ends, so a rotation does not replay it)', () => {
  const src = read('public/js/ui/index.js');
  assert.match(src, /e\.frame\.addEventListener\('animationend', settle\);/);
  assert.match(src, /if \(e\.openGen === gen\) e\.frame\.classList\.remove\('is-opening'\);/);
});

test('S-09: the coach docks left of whatever is open over the toolbar (a tray is wider than the toolbar of 3)', () => {
  const src = read('public/js/ui/toolbar.js');
  assert.match(src, /const shown = \[bar, tray, btray, fly, strip\]\.filter/);
  assert.match(read('public/js/ui/tutorial.js'), /const strip = uiEl\.closest\('#build-tray, #seed-tray'\);/, 'the step\'s card scrolls into the tray');
});

test('S-29: the second click of a double click opens nothing shut: not on a door, not on the scrim behind its panel', () => {
  const hud = read('public/js/ui/hud.js');
  assert.match(hud, /if \(!\(e\.detail >= 2\) \|\| !e\.target\?\.closest\?\.\(TOGGLE_DOORS\)\) return;/);
  assert.match(hud, /const TOGGLE_DOORS = '\.dock-btn, \.m-menu-btn, \.dock-mini, #hx-dock button/);
  assert.match(read('public/js/ui/index.js'), /if \(ev\.detail >= 2 \|\| \(e && performance\.now\(\) - \(e\.openedAt \?\? 0\) < 400\)\) return;/);
  assert.match(read('tools/e2e-coop.mjs'), /S-29: a double click on Market leaves the Market open/);
});
