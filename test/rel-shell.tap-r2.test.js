// QA r2 S2-05 (br#1, reproduced at triage): on a phone the second tap of a double tap on the bar's Market door landed on
// the sheet the first tap had just opened and sold a whole stack ("Sell 39": +26,091 coins, 39 Cabbage gone, a sale
// has no undo); a double tap on the gift's "Wrap it" sent it and opened the Barn under the closed sheet; one on the
// Farm book's Pets tile sent petStay. The panel frame now drops the twin of the tap that opened or closed a sheet.
// The browser proof is tools/e2e-mobile.mjs's step "S2-05: a double tap on each bar door and each Farm book tile".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const UI = await import('../public/js/ui/index.js');
const SRC = fs.readFileSync(new URL('../public/js/ui/index.js', import.meta.url), 'utf8');

test('S2-05: the twin of the opening tap (160 ms, same spot) is dropped inside the new sheet', () => {
  assert.equal(typeof UI.tapThrough, 'function', 'ui/index.js tapThrough(click, since, first)');
  const door = { x: 230, y: 790 };
  // iPhone 13 BG, taps 160 ms apart: the second lands on "Продай 39" right where the door was
  assert.equal(UI.tapThrough({ x: 233, y: 786, detail: 1 }, 160, door), true, '160 ms, 5 px away');
  // 360 EN, 250 ms apart
  assert.equal(UI.tapThrough({ x: 226, y: 800, detail: 1 }, 250, door), true, '250 ms');
  // a double click (detail 2) anywhere in the new sheet
  assert.equal(UI.tapThrough({ x: 60, y: 300, detail: 2 }, 200, door), true, 'the second click of a double click');
  // a busy phone handled the twin ~1 s after the sheet opened: the window is in the taps' own time (160 ms apart), and a
  // finger that came down before the sheet opened (since < 0) aimed at something else
  assert.equal(UI.tapThrough({ x: 230, y: 790, detail: 1 }, -40, door), true, 'down before the sheet opened');
});

test('S2-05: a deliberate press goes through: elsewhere, later, by keyboard', () => {
  const door = { x: 230, y: 790 };
  assert.equal(UI.tapThrough({ x: 120, y: 520, detail: 1 }, 200, door), false, 'another control of the sheet');
  assert.equal(UI.tapThrough({ x: 231, y: 789, detail: 1 }, UI.TAP_GUARD.ms + 1, door), false, 'after the sheet settled');
  assert.equal(UI.tapThrough({ x: 0, y: 0, detail: 0 }, 50, door), false, 'Enter or Space (detail 0)');
  assert.equal(UI.tapThrough({ x: 231, y: 789, detail: 1 }, 100, null), false, 'a sheet code opened: no first tap');
  assert.ok(UI.TAP_GUARD.ms >= 400 && UI.TAP_GUARD.px >= 40, `the scrim's window and a finger's slop: ${JSON.stringify(UI.TAP_GUARD)}`);
});

test('S2-05: the frame wires it: the opening tap is kept, an open or a close is remembered, one capture listener drops the twin', () => {
  assert.match(SRC, /e\.openTap = recentTap\(\);/, 'the open keeps the tap that opened it');
  assert.match(SRC, /lastShift = \{ ts: closer\?\.ts \?\? performance\.now\(\), tap: closer \};/, 'a close keeps the tap that closed it');
  assert.match(SRC, /lastShift = \{ ts: e\.openTs, tap: e\.openTap \};/, 'an open too (a door whose sheet leaves it in view)');
  assert.match(SRC, /ts: Number\.isFinite\(ev\.timeStamp\) \? ev\.timeStamp : performance\.now\(\)/, 'the taps\' own time (a busy page handles them late)');
  assert.match(SRC, /document\.addEventListener\('click', \(ev\) => \{[\s\S]{0,600}tapThrough\(click, ts - \(e\.openTs \?\? -Infinity\), e\.openTap\) : tapThrough\(click, ts - lastShift\.ts, lastShift\.tap\);[\s\S]{0,80}ev\.stopPropagation\(\);/,
    'inside an open panel against its opening; outside against the last open or close');
  assert.match(SRC, /\}, true\);/, 'capture: before the button\'s own handler');
  // the e2e step that proves it on a phone
  const mob = fs.readFileSync(new URL('../tools/e2e-mobile.mjs', import.meta.url), 'utf8');
  assert.match(mob, /S2-05: a double tap on each bar door and each Farm book tile/);
});
