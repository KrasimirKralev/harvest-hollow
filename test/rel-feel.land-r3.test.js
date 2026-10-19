// QA r3 (life-feel) L3-03 (oib#3): on an iPhone 13 on its side (844 x 390) the Orders sheet is docked at the right
// (x 344-844). Delivering an order: the feed line in the bottom-left corner ran under the sheet ("You filled an order:
// +1,03…", "Ти продаде 10 яйца за 860 мо…"), and the toast raised over the open sheet sat on the sheet's title band,
// over its name ("Поръчки"). About 215 px of farm lay free between the tool column and the sheet.
// Fix: with a landscape side sheet open (LAYOUT_Q.land), modal or not, both go in the free width left of the sheet,
// past the tool column and below the top HUD, their width capped there (they wrap rather than run under it).
// Rects measured on the tested head: .scratch/r3-life-feel/out/probe-l-before.json.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const document = installDom();
document.addEventListener = () => {};
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
let land = false;
globalThis.matchMedia = (q) => ({
  matches: land && (q.includes('max-height: 500px') || q.includes('pointer: coarse')), addEventListener() {}, removeEventListener() {},
});
globalThis.window ??= globalThis;

const { h } = await import('../public/js/ui/dom.js');
const { createToasts } = await import('../public/js/ui/toasts.js');
const { createFeed } = await import('../public/js/ui/feed.js');
const { makeFarm, T0 } = await import('./helpers.js');

const box = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t });
function at(el, [l, t, r, b]) {
  el.getBoundingClientRect = () => box(l, t, r, b);
  el.getClientRects = () => [el.getBoundingClientRect()];
  return el;
}
const num = (v) => Number.parseFloat(v || 0) || 0;
const hits = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** A line layer of the phone CSS: left/right anchored (8 px, the edge lane), top 60; inline left/right/top move it. */
function anchored(el, { left = 8, right = 72, top = 60, hgt = 47 } = {}) {
  el.getBoundingClientRect = () => {
    if (!el.children.length) return box(0, 0, 0, 0);
    const l = el.style.left ? num(el.style.left) : left;
    const r = innerWidth - (el.style.right ? num(el.style.right) : right);
    const t = el.style.top && el.style.top !== 'auto' ? num(el.style.top) : top;
    return box(l, t, r, t + hgt);
  };
  el.getClientRects = () => (el.children.length ? [el.getBoundingClientRect()] : []);
  return el;
}

const W = 844;
const H = 390;
const SHEET = [344, 0, 844, 390];
const TOOLS = [0, 54, 78, 384];
const TRACKER = [84, 55, 340, 100];

function setupLand({ modal = true, insets = true } = {}) {
  land = true;
  globalThis.innerWidth = W;
  globalThis.innerHeight = H;
  document.body.replaceChildren(h('canvas#world'), h('div#hud',
    h('header.hud-tl', h('div.buffs#hud-buffs')),
    at(h('aside#tracker'), TRACKER),
    h('div.tray-wrap#tray-wrap', h('div#coach-slot'), at(h('nav#toolbar'), TOOLS)),
    h('div.toasts#toasts'), h('div.banners#banners'),
    h('section.hud-bl', h('ol#feed'))));
  const frame = at(h('section#panel-orders', { 'aria-modal': String(modal) }), SHEET);
  frame.append(at(h('header.hh-panel-title'), [500, 10, 690, 60]), at(h('div.hh-panel-body'), [356, 58, 836, 384]));
  document.body.append(frame);
  const listeners = {};
  const panels = { top: () => 'orders', on(ev, fn) { (listeners[ev] ||= []).push(fn); return () => {}; } };
  // ui-shell's layout.insets() in phone-land: left = the tool column's right, top = the top HUD's bottom
  const layout = insets ? { insets: () => ({ top: 100, right: 0, bottom: 0, left: 78 }) } : undefined;
  return { panels, layout, listeners };
}

test('L3-03: a toast raised over a landscape side sheet goes in the free farm left of it, not on the sheet\'s title', () => {
  for (const modal of [true, false]) {
    const { panels, layout } = setupLand({ modal });
    const real = document.body.append.bind(document.body);
    document.body.append = (...els) => { for (const e of els) if (e?.id === 'over-panels') anchored(e.querySelector('.over-toasts')); return real(...els); };
    anchored(document.getElementById('toasts'), { left: 8, right: 8, top: 56 });
    const toasts = createToasts({ store: { state: null, pid: 'p1' }, ui: { panels, layout } }, (c) => c);
    const el = toasts.toast('Ти изпълни поръчка: +1 030 монети и +67 опит', { kind: 'ok', ms: 8000 });
    document.body.append = real;
    const layer = el.parentNode;
    const r = layer.getBoundingClientRect();
    const rr = [r.left, r.top, r.right, r.bottom];
    assert.ok(!hits(rr, SHEET), `${modal ? 'modal' : 'non-modal'}: the line ${rr} clear of the sheet ${SHEET}`);
    assert.ok(r.left >= TOOLS[2], `past the tool column (${r.left})`);
    assert.ok(r.top >= TRACKER[3], `below the top HUD (${r.top})`);
    assert.ok(num(layer.style.maxWidth) <= SHEET[0] - TOOLS[2], `its width capped to the room (${layer.style.maxWidth})`);
    assert.ok(layer.classList.contains('beside-sheet'), 'the words wrap inside it (css: .beside-sheet .toast)');
  }
  land = false;
});

test('L3-03: without layout.insets (an older shell) the tool column still bounds the room', () => {
  const { panels } = setupLand({ insets: false });
  const real = document.body.append.bind(document.body);
  document.body.append = (...els) => { for (const e of els) if (e?.id === 'over-panels') anchored(e.querySelector('.over-toasts')); return real(...els); };
  const toasts = createToasts({ store: { state: null, pid: 'p1' }, ui: { panels } }, (c) => c);
  const el = toasts.toast('You filled an order: +1,030 coins and +67 XP', { kind: 'ok', ms: 8000 });
  document.body.append = real;
  const r = el.parentNode.getBoundingClientRect();
  assert.ok(r.left >= TOOLS[2] && r.right <= SHEET[0], `between the tools and the sheet (${r.left}-${r.right})`);
  land = false;
});

test('L3-03: a portrait phone and a centred card keep the old placement (the room is for a sheet docked right)', () => {
  const { panels, layout } = setupLand();
  land = false;                                               // portrait: LAYOUT_Q.land does not match
  const real = document.body.append.bind(document.body);
  document.body.append = (...els) => { for (const e of els) if (e?.id === 'over-panels') anchored(e.querySelector('.over-toasts')); return real(...els); };
  const toasts = createToasts({ store: { state: null, pid: 'p1' }, ui: { panels, layout } }, (c) => c);
  const el = toasts.toast('A line', { ms: 3000 });
  document.body.append = real;
  assert.ok(!el.parentNode.classList.contains('beside-sheet'), 'no room move without the landscape layout');
});

test('L3-03: the feed\'s lines are capped to the free width left of a landscape side sheet, and freed when it closes', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const { panels, listeners } = setupLand();
    const list = at(document.getElementById('feed'), [84, 330, 381, 384]);       // the BG line's rect on the tested head
    const s = makeFarm();
    const S = {
      store: { state: s, pid: 'p1', now: () => T0, on: () => () => {}, subscribe: () => () => {} },
      ui: { panels },
      controller: { do() {} },
      view: { focus() {} },
    };
    createFeed(S);
    for (const fn of listeners.open || []) fn('orders');
    const cap = num(list.style.maxWidth);
    assert.ok(cap > 0 && 84 + cap <= SHEET[0] - 8, `capped: 84 + ${cap} clear of the sheet at ${SHEET[0]}`);
    let open = true;
    panels.top = () => (open ? 'orders' : null);
    open = false;
    for (const fn of listeners.close || []) fn('orders');
    assert.equal(list.style.maxWidth, '', 'the sheet closed: the corner\'s own width again');
  } finally { mock.timers.reset(); land = false; }
});
