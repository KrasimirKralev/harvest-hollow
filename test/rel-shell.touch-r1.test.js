// QA r1, ui-shell: words for a finger and a farmer's mark.
//   S-16 (fbp#14, coop#6, ap#7): key hints in brackets reached touch players in Bulgarian ("Посочи място на другия
//        фермер (G)" read to a finger, "Канара: с брадвата (8).") and in the high-five toast in both languages.
//   S-36 (br#6): a farmer whose name starts with an emoji got "�" in every feed mark (one UTF-16 unit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { setLang, lang as curLang } from '../public/js/i18n/index.js';

const DOM = await import('../public/js/ui/dom.js');

test('S-16: no key hint in brackets for a finger, in Bulgarian too; a mouse keeps them', async () => {
  const { dropKeyHints } = await import('../public/js/game/touch.js');
  await setLang('bg');
  assert.equal(curLang(), 'bg', 'Bulgarian is in effect');
  assert.equal(DOM.touchText('Посочи място на другия фермер (G)', true), 'Посочи място на другия фермер', 'HEAD: "(G)" kept in BG');
  assert.equal(DOM.touchText('Канара: с брадвата (8).', true), 'Канара: с брадвата.');
  assert.equal(DOM.touchText('Ана вдига ръка за „дай пет“ ✋ (T)', true), 'Ана вдига ръка за „дай пет“ ✋');
  assert.equal(DOM.touchText('Чака в менюто за строеж (B).', true), 'Чака в менюто за строеж.');
  assert.equal(DOM.touchText('Посочи място на другия фермер (G)', false), 'Посочи място на другия фермер (G)', 'a mouse player keeps the key');
  // a count in brackets is not a key
  assert.equal(DOM.touchText('Пшеница (12)', true), 'Пшеница (12)');
  await setLang('en');
  assert.equal(DOM.touchText('Ana holds up a hand for a high five ✋ (T)', true), 'Ana holds up a hand for a high five ✋');
  assert.equal(typeof dropKeyHints, 'function', 'game/touch.js dropKeyHints (the controller\'s toasts)');
  assert.equal(dropKeyHints('Boulder: use the Axe (8).'), 'Boulder: use the Axe.');
});

test('S-16: the high-five toast and the controller\'s Axe / Giant toasts pass through the finger filter', async () => {
  const fs = await import('node:fs');
  const ui = fs.readFileSync(new URL('../public/js/ui/index.js', import.meta.url), 'utf8');
  assert.match(ui, /touchText\(t\('shell\.highFiveWait'/, 'ui/index.js: the high-five toast');
  const ctl = fs.readFileSync(new URL('../public/js/game/controller.js', import.meta.url), 'utf8');
  assert.match(ctl, /forFinger\(i18n\.t\('game\.debris\.axe'/, 'the boulder toast');
  assert.match(ctl, /forFinger\(i18n\.t\('game\.giant\.fell'/, 'the Giant toast');
});

test('S-36: a name that starts with an emoji keeps the whole emoji in its mark', () => {
  installDom();
  globalThis.localStorage ??= { getItem: () => null, setItem() {} };
  assert.equal(DOM.playerMark('p2', { name: '🐄x', color: '#3B82F6' }).textContent, '🐄', 'HEAD: "\\ud83d"');
  assert.equal(DOM.playerMark('p1', { name: 'ana', color: '#3B82F6' }).textContent, 'A');
  assert.equal(DOM.playerMark('p1', { name: '', color: '#3B82F6' }).textContent, '?');
});
