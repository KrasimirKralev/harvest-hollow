// QA r1 S-13 (hv#5, oib#5): with the keyboard up, Harvey's "Ask" stayed under it: the panel frame's keep-in-view
// scrolled to the first button after the field, the 🎙 beside the box, and nothing cleared the bottom fade (Notes'
// "Pin it here" sat under it). The field's own button is the one its box names (data-keep-in-view, Harvey's `ask`),
// else the first button with words; the scroll clears the fade and the visual viewport's bottom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const UI = await import('../public/js/ui/index.js');

function harveyBox(document, { named = true } = {}) {
  const root = document.createElement('section');
  root.className = 'hh-panel';
  const sc = document.createElement('div');
  sc.className = 'hh-panel-scroll';
  root.append(sc);
  const area = document.createElement('textarea');
  if (named) area.dataset.keepInView = 'ask';
  const mic = document.createElement('button');
  mic.className = 'hx-mic';
  mic.textContent = '🎙';
  const close = document.createElement('button');
  close.textContent = '✕';
  const ask = document.createElement('button');
  ask.dataset.act = 'ask';
  ask.textContent = 'Ask Harvey';
  sc.append(area, mic, close, ask);
  document.body.append(root);
  return { root, sc, area, mic, ask };
}

test('S-13: the field\'s button is the one it names, else the first one with words (never the 🎙 or a ✕)', () => {
  const document = installDom();
  const a = harveyBox(document);
  assert.equal(UI.buttonAfter(a.area, a.root), a.ask, 'Harvey\'s box names Ask (HEAD: the 🎙)');
  const b = harveyBox(document, { named: false });
  assert.equal(UI.buttonAfter(b.area, b.root), b.ask, 'unnamed: the first button with words');
});

test('S-13: keep-in-view lifts the button above the bottom fade and the keyboard (the visual viewport)', () => {
  const document = installDom();
  const a = harveyBox(document);
  const fade = document.createElement('div');
  fade.className = 'scroll-fade';
  a.root.append(fade);
  // the sheet's scroller ends at y 640; the keyboard leaves the top 358 px (visualViewport); Ask's box sits at 366-410
  let scrollTop = 0;
  Object.defineProperty(a.sc, 'scrollTop', { get: () => scrollTop, set: (v) => { scrollTop = v; } });
  a.sc.getBoundingClientRect = () => ({ top: 200, bottom: 640, left: 0, right: 360, width: 360, height: 440 });
  a.ask.getBoundingClientRect = () => ({ top: 366 - scrollTop, bottom: 410 - scrollTop, left: 20, right: 200, width: 180, height: 44 });
  a.area.getBoundingClientRect = () => ({ top: 232 - scrollTop, bottom: 338 - scrollTop, left: 20, right: 340, width: 320, height: 106 });
  globalThis.visualViewport = { offsetTop: 0, height: 358 };
  UI.keepInView(a.area, a.root);
  const r = a.ask.getBoundingClientRect();
  assert.ok(r.bottom <= 358 - 8, `Ask ends above the keyboard: ${r.bottom} (scrolled ${scrollTop})`);
  // the field's top comes back only as far as the button allows: the button wins
  assert.ok(a.area.getBoundingClientRect().top >= 200 - 106, 'the field is not scrolled away for nothing');
  // a tall viewport: the fade at the scroller's bottom is the floor
  scrollTop = 0;
  a.ask.getBoundingClientRect = () => ({ top: 590 - scrollTop, bottom: 634 - scrollTop, left: 20, right: 200, width: 180, height: 44 });
  a.area.getBoundingClientRect = () => ({ top: 470 - scrollTop, bottom: 576 - scrollTop, left: 20, right: 340, width: 320, height: 106 });
  globalThis.visualViewport = { offsetTop: 0, height: 844 };
  UI.keepInView(a.area, a.root);
  assert.ok(a.ask.getBoundingClientRect().bottom <= 640 - 22, `Ask clears the fade's dense half: ${a.ask.getBoundingClientRect().bottom}`);
  delete globalThis.visualViewport;
});
