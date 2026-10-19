// Release 1.0, QA round 1 integration: a line raised while a panel covered its spot goes to the layer above the panels
// (M4, #over-panels); when the last panel closes it goes back to its own place in the HUD. Left where the sheet's edge
// had put it, it lay on the phone bar (the integrator's 360 e2e-harness frame: "Harvey is on it" over Hand, Market, Barn).
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
globalThis.innerWidth = 360;
globalThis.innerHeight = 640;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { h } = await import('../public/js/ui/dom.js');
const { createToasts } = await import('../public/js/ui/toasts.js');

test('a line held above a modal sheet returns to the HUD when the sheet closes', () => {
  const frame = h('div#panel-helper', { 'aria-modal': 'true' });
  document.body.replaceChildren(h('div#hud', h('div.toasts#toasts'), h('div.banners#banners')), frame);
  let top = 'helper';
  const on = {};
  const panels = { top: () => top, on: (ev, fn) => { on[ev] = fn; return () => {}; } };
  const S = { store: { state: { players: { p1: { name: 'A' } } }, pid: 'p1' }, ui: { panels } };
  const toasts = createToasts(S, (code) => `text of ${code}`);
  const el = toasts.toast('Harvey is on it.', { kind: 'ok', ms: 4000 });
  assert.equal(el.parentNode?.classList.contains('over-toasts'), true, 'held above the sheet while it is open');
  top = null;
  on.close();
  assert.equal(el.parentNode?.id, 'toasts', 'back in the HUD once no panel is open');
  clearTimeout(el._t);
});
