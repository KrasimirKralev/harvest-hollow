// QA r1 I-01 (infra's patch IX-2): an order, a townsfolk request or a barge crate someone already handed in, with no
// partner to name, says "Already delivered" / "Already loaded", not the harvest error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const document = installDom();
document.querySelector = (s) => document.body.querySelector(s);
document.querySelectorAll = (s) => document.body.querySelectorAll(s);
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.innerWidth = 1366;
globalThis.innerHeight = 768;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { h } = await import('../public/js/ui/dom.js');
const { createToasts } = await import('../public/js/ui/toasts.js');

test('I-01: an order someone already filled, with nobody to name, says "Already delivered", not the harvest error', () => {
  document.body.replaceChildren(h('div#hud', h('div.toasts#toasts'), h('div.banners#banners')));
  const panels = { top: () => null, on: () => () => {} };
  const S = { store: { state: { players: { p1: { name: 'A' }, p2: { name: 'B' } } }, pid: 'p1' }, ui: { panels } };
  const toasts = createToasts(S, (code) => `text of ${code}`);
  const text = (el) => { const s = el.textContent; document.querySelector('#toasts').replaceChildren(); return s; };
  assert.match(text(toasts.toast('EMPTY', { type: 'orderFill', args: { slot: 0, n: 1 } })), /Already delivered\./);
  assert.match(text(toasts.toast('NOT_FOUND', { type: 'orderFill' })), /Already delivered\./);
  assert.match(text(toasts.toast('ALREADY_DONE', { type: 'bargeLoad' })), /Already loaded\./);
  assert.match(text(toasts.toast('EMPTY', { type: 'harvest' })), /text of EMPTY/, 'a plot keeps its own sentence');
  assert.match(text(toasts.toast('NO_ITEMS', { type: 'orderFill' })), /text of NO_ITEMS/, 'other codes keep theirs');
  assert.match(text(toasts.toast('EMPTY', { type: 'orderFill', by: 'p2' })), /B/, 'with a partner to name: the race line');
});
