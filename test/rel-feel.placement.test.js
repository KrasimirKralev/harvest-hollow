// QA r1 (life-feel), where feedback lands next to the shell. Fake DOM with the rectangles measured in the browser
// (docs/agent-notes/rel-life-feel.md, QA r1: .scratch/r1-life-feel/probe-layout.mjs).
// L-04 (va#4, fe#9): a toast with a button (the balloon's "Show me", an Undo) sat at the bottom centre over the phone bar
//   (iPhone 13 [12,735,378,794] on the bar [0,730,390,844]) and the desktop toolbar: the first tap on Market or Orders
//   only sent the toast away. It now sits above whatever bottom HUD lies under it (toolbar, dock, phone bar, coach card).
// L-06 (jde#15): "{partner} arrived" raised over the welcome-back card covered its greeting: over a modal panel a toast
//   goes where the panel is not (below it, else above it), never on the panel's body.
// L-10 (fbp#20): a quest card on a phone covered the first line of the coach card's new instruction: a card that would
//   reach the coach card folds its rewards into one row, and if it still would, the coach card steps aside meanwhile.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const document = installDom();
document.querySelector = (s) => document.body.querySelector(s);
document.querySelectorAll = (s) => document.body.querySelectorAll(s);
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
let phone = false;
globalThis.matchMedia = (q) => ({ matches: phone && /max-width: 600px|pointer: coarse/.test(q), addEventListener() {}, removeEventListener() {} });

const { h } = await import('../public/js/ui/dom.js');
const { createToasts } = await import('../public/js/ui/toasts.js');

/** Give an element a fixed rectangle [left, top, right, bottom] (and a client rect: it is laid out). */
function at(el, [l, t, r, b]) {
  el.getBoundingClientRect = () => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t });
  el.getClientRects = () => [el.getBoundingClientRect()];
  return el;
}
const num = (v) => Number.parseFloat(v);

function setup({ w, hgt, panel = null }) {
  globalThis.innerWidth = w;
  globalThis.innerHeight = hgt;
  document.body.replaceChildren(h('canvas#world'), h('div#hud', h('div.toasts#toasts'), h('div.banners#banners'), h('div#coach-slot'),
    h('div#toolbar'), h('div.dock#dock')));
  const panels = { name: panel, top() { return this.name; }, on() { return () => {}; } };
  const toasts = createToasts({ store: { state: null, pid: 'p1' }, ui: { panels } }, (c) => c);
  return { toasts, panels };
}

test('L-04: an action toast sits above the phone bar (iPhone 13 and 360) and above the desktop toolbar, never over them', () => {
  for (const [dev, w, hgt, bar, dock, toastAt] of [
    ['iphone', 390, 844, [0, 730, 390, 844], [88, 738, 384, 804], [12, 735, 378, 794]],
    ['small', 360, 640, [0, 560, 360, 640], [82, 568, 354, 634], [25, 551, 335, 606]],
    ['desktop', 1366, 768, [579, 703, 787, 784], [920, 689, 1350, 784], [464, 682, 902, 726]],
  ]) {
    phone = dev !== 'desktop';
    const { toasts } = setup({ w, hgt });
    at(document.getElementById('toolbar'), bar);
    at(document.getElementById('dock'), dock);
    // the snack layer is made on the first action toast: give it the rectangle the browser drew it at
    const real = document.body.append.bind(document.body);
    document.body.append = (...els) => { for (const e of els) if (e && e.classList?.contains('snacks')) at(e, toastAt); return real(...els); };
    toasts.toast('The balloon dropped a crate on the farm!', { action: { label: 'Show me', fn() {} }, ms: 8000 });
    document.body.append = real;
    const layer = document.querySelector('.snacks');
    assert.ok(layer, `${dev}: the snack layer`);
    const floor = Math.min(bar[1], toastAt[2] > dock[0] ? dock[1] : Infinity);
    const bottom = num(layer.style.bottom);
    assert.ok(Number.isFinite(bottom), `${dev}: lifted (bottom ${layer.style.bottom || 'unset'})`);
    assert.ok(hgt - bottom <= floor, `${dev}: the toast's foot (${hgt - bottom}) at or above the bar / toolbar top (${floor})`);
  }
  phone = false;
});

// (QA r2 L2-05 changed this one: a line on an open sheet's rows hid the partner's letter, so it now goes above the
// sheet, the bar under the sheet still not counting)
test('L-04 / L2-05: under an open sheet the bar is hidden and does not count; the line goes above the sheet, off its rows', () => {
  phone = true;
  const { toasts, panels } = setup({ w: 390, hgt: 844 });
  at(document.getElementById('toolbar'), [0, 730, 390, 844]);
  panels.name = 'barn';
  document.body.append(at(h('section#panel-barn', { 'aria-modal': 'false' }), [0, 132, 390, 844]));
  const real = document.body.append.bind(document.body);
  document.body.append = (...els) => { for (const e of els) if (e && e.classList?.contains('snacks')) at(e, [12, 735, 378, 794]); return real(...els); };
  toasts.toast('Stopped keeping Wheat', { action: { label: 'Undo', fn() {} }, ms: 8000 });
  document.body.append = real;
  const foot = 844 - num(document.querySelector('.snacks').style.bottom);
  assert.ok(foot <= 132, `the line's foot (${foot}) above the sheet (132)`);
  assert.ok(foot - 59 >= 4, 'and on screen');
  phone = false;
});

test('L-06: a toast over a modal panel lands below the panel (desktop recap), never on its first line', () => {
  phone = false;
  const { toasts } = setup({ w: 1366, hgt: 768, panel: 'recap' });
  const frame = at(h('section#panel-recap', { 'aria-modal': 'true' }), [293, 69, 1073, 649]);
  frame.append(at(h('header.hh-panel-title'), [551, 49, 815, 101]), at(h('div.hh-panel-scroll'), [307, 115, 1059, 635]));
  document.body.append(frame);
  const el = toasts.toast('Mia arrived', { kind: 'love', ms: 3500 });
  const layer = el.closest('#over-panels .over-toasts');
  assert.ok(layer, 'above the panels');
  at(layer, [604, 82, 762, 125]);                         // where the CSS put it before
  toasts.toast('Mia arrived again', { kind: 'love', ms: 3500 });   // placed on show
  const top = num(layer.style.top);
  assert.ok(Number.isFinite(top) && top >= 649, `below the panel's frame (top ${layer.style.top || 'unset'})`);
});

test('L-06: a phone sheet reaching the bottom: the toast stays above the sheet\'s body (its title band at most)', () => {
  phone = true;
  const { toasts } = setup({ w: 360, hgt: 640, panel: 'recap' });
  const frame = at(h('section#panel-recap', { 'aria-modal': 'true' }), [0, 124, 360, 640]);
  frame.append(at(h('header.hh-panel-title'), [85, 139, 275, 178]), at(h('div.hh-panel-scroll'), [8, 186, 352, 632]));
  document.body.append(frame);
  const el = toasts.toast('Mia arrived', { kind: 'love', ms: 3500 });
  const layer = el.closest('#over-panels .over-toasts');
  at(layer, [62, 160, 234, 207]);                         // a toast that would sit on the body's first line
  toasts.toast('Mia arrived again', { kind: 'love', ms: 3500 });
  const top = num(layer.style.top);
  assert.ok(Number.isFinite(top) && top + 47 <= 186, `its foot (${top + 47}) above the body (186)`);
  phone = false;
});

test('L-10: a card that would reach the coach card folds its rewards (.tight); if it still would, the coach steps aside', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    phone = true;
    const { toasts } = setup({ w: 360, hgt: 640 });
    const coach = at(h('div.coach'), [14, 373, 346, 552]);
    document.getElementById('coach-slot').append(coach);
    // the card is drawn where the browser drew it in fbp#20 (36..387): over the coach card's first line
    const banners = document.getElementById('banners');
    const real = banners.prepend.bind(banners);
    banners.prepend = (el) => { at(el, [12, 93, 318, 387]); return real(el); };
    const { el, close } = toasts.banner({ kind: 'quest', ribbon: 'Quest complete!', message: 'The Old Windmill', things: [{ icon: 'coins', name: '220 coins' }] });
    assert.ok(el.classList.contains('tight'), 'the rewards fold into one row');
    assert.ok(document.body.classList.contains('card-over-coach'), 'still over it: the coach card steps aside meanwhile');
    close();
    mock.timers.tick(400);
    assert.ok(!document.body.classList.contains('card-over-coach'), 'and comes back when the card leaves');
    // a card clear of the coach card changes nothing
    banners.prepend = (e) => { at(e, [12, 108, 288, 334]); return real(e); };
    const r2 = toasts.banner({ kind: 'quest', ribbon: 'Quest complete!', message: 'Short' });
    assert.ok(!r2.el.classList.contains('tight'));
    assert.ok(!document.body.classList.contains('card-over-coach'));
  } finally { phone = false; mock.timers.reset(); }
});
