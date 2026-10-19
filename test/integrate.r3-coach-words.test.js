// QA r3 integration (F3-10, features' Cross-lane patch for ui-shell's tutorial.js): Grandma's card kept saying "Place the
// windmill" for the whole flour job, and "together" on a farm of one. Her words now come from the rules' stepWords, the
// same call the tracker's mirror of the coach makes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { TUTORIAL } from '../shared/content/index.js';
import { farmAt, put } from './helpers/rules-goals.js';
import { allAreas } from '../public/js/i18n/catalogs.js';
import * as I from '../public/js/i18n/index.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
const { stepText } = await import('../public/js/ui/tutorial.js');
const AREAS = await allAreas();
const BG = Object.fromEntries((await Promise.all(AREAS.map(async ([, , load]) => Object.entries((await load()).default)))).flat());
await I.__loadForTest('bg');
I.__setForTest('en');
const inBg = (fn) => { I.__setForTest('bg', BG); try { return fn(); } finally { I.__setForTest('en'); } };

const step = TUTORIAL.together.find((x) => x.id === 'flour_together');

test('F3-10: once the Windmill stands Grandma stops saying "Place"; a farm of one hears no "together"', () => {
  assert.equal(typeof stepText, 'function', 'ui/tutorial.js stepText(step, state)');
  const two = farmAt(3);
  put(two, 'mill');
  const en = stepText(step, two);
  const bg = inBg(() => stepText(step, two));
  assert.doesNotMatch(en, /\bplace\b/i, en);
  assert.doesNotMatch(bg, /Сложи/, bg);
  const solo = farmAt(3, { players: ['p2'] });
  put(solo, 'mill');
  assert.doesNotMatch(stepText(step, solo), /together|\bplace\b/i);
  assert.doesNotMatch(inBg(() => stepText(step, solo)), /заедно|Сложи/);
  // without a state (or before the mill on a farm of two) the step keeps its own words
  assert.equal(stepText(step), stepText(step, farmAt(3)));
});
