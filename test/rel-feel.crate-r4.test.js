// QA r4 (life-feel) L4-01 (oib#1): the balloon's "A crate fell on the farm · Show me" line (a toast with an action, so
// it lives in #snacks above the sheets) lay on the Market's "Продай 10" on an iPhone 13 (12,751-378,828 over the button
// at 28,782-362,828) and at 360; a tap aimed at Sell only sent the line away. On its side (844 x 390) it ran across the
// side sheet. Now a line with a button that no press of this farmer raised waits while an open sheet leaves it no
// place off its body, and shows as the sheet closes; in landscape the action line goes into the free farm left of a
// sheet docked right (as #toasts does since L3-03). A line the farmer's own press raised (an Undo) shows at once.
// The rectangles are the browser's on 289b672 (.scratch/r4-life-feel/probe.mjs c head).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const document = installDom();
const docListeners = {};
document.addEventListener = (type, fn) => { (docListeners[type] ||= []).push(fn); };
const fire = (type, ev) => { for (const fn of docListeners[type] || []) fn({ type, ...ev }); };
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
let mode = 'portrait';
globalThis.matchMedia = (q) => ({ matches: mode === 'land' ? /max-height: 500px/.test(q) : /max-width: 600px|pointer: coarse/.test(q),
  addEventListener() {}, removeEventListener() {} });

const { h } = await import('../public/js/ui/dom.js');
const { createToasts } = await import('../public/js/ui/toasts.js');

// a DOMRect's fields are getters on its prototype (a spread of one copies nothing): the rects here are the same
class Rect { constructor(l, t, r, b) { this._ = [l, t, r, b]; } get left() { return this._[0]; } get top() { return this._[1]; }
  get right() { return this._[2]; } get bottom() { return this._[3]; } get width() { return this._[2] - this._[0]; }
  get height() { return this._[3] - this._[1]; } get x() { return this._[0]; } get y() { return this._[1]; } }
Object.defineProperty(Rect.prototype, '_', { enumerable: false, writable: true });
const box = (l, t, r, b) => new Rect(l, t, r, b);
function at(el, [l, t, r, b]) {
  el.getBoundingClientRect = () => box(l, t, r, b);
  el.getClientRects = () => [el.getBoundingClientRect()];
  return el;
}
const R = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
const hits = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const num = (v) => Number.parseFloat(v || 0) || 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** #snacks drawn at `nat` before any move; its style moves it like the CSS would (bottom, top, a room's left / width). */
function snackModel(el, nat) {
  const hgt = nat[3] - nat[1];
  el.getBoundingClientRect = () => {
    if (!el.children.length) return box(0, 0, 0, 0);
    let top = nat[1];
    if (el.style.top && el.style.top !== 'auto') top = num(el.style.top);
    else if (el.classList.contains('top')) top = 92;
    else if (el.style.bottom && el.style.bottom !== 'auto') top = innerHeight - num(el.style.bottom) - hgt;
    const left = el.style.left ? num(el.style.left) : nat[0];
    const w = Math.min(nat[2] - nat[0], el.style.maxWidth ? num(el.style.maxWidth) : Infinity);
    return box(left, top, left + w, top + hgt);
  };
  el.getClientRects = () => (el.children.length ? [el.getBoundingClientRect()] : []);
}

// the layer #snacks is made by toasts.js when its first line comes: it gets the model of the current case
let NAT = null;
const realAppend = document.body.append.bind(document.body);
document.body.append = (...els) => { for (const e of els) if (e && e.classList?.contains('snacks')) snackModel(e, NAT); return realAppend(...els); };

/** The Market open on Sell: its frame, title band, body and the slip's Sell button (iPhone 13 portrait or on its side). */
function market({ w, hgt, frameR, titleR, bodyR, sellR, toolbarR, nat }) {
  globalThis.innerWidth = w;
  globalThis.innerHeight = hgt;
  document.body.replaceChildren(h('canvas#world'), h('div#hud', h('header.hud-tl', h('div.buffs#hud-buffs')),
    h('div.tray-wrap#tray-wrap', h('div#coach-slot'), h('nav#toolbar')), h('nav.dock#dock'), h('div.toasts#toasts'), h('div.banners#banners')));
  at(document.getElementById('toolbar'), toolbarR);
  const panels = { name: 'market', top() { return this.name; }, on(ev, fn) { (this.l ||= {})[ev] = fn; return () => {}; } };
  const toasts = createToasts({ store: { state: { players: { p1: { name: 'Ана' }, p2: { name: 'Бо' } } }, pid: 'p1' }, ui: { panels } }, (c) => c);
  const frame = at(h('section#panel-market', { 'aria-modal': 'true' }), frameR);
  const sell = at(h('button.pn-sell-btn'), sellR);
  frame.append(at(h('header.hh-panel-title'), titleR), at(h('div.hh-panel-scroll', at(h('section.pn-slip'), [bodyR[0], sellR[1] - 160, bodyR[2], bodyR[3]]), sell), bodyR));
  document.body.append(frame);
  NAT = nat;
  return { toasts, panels, sell, close: () => { panels.name = null; frame.remove(); panels.l?.close?.(); } };
}
const crate = (toasts) => toasts.toast('The balloon dropped a crate on the farm! 🎈', { kind: 'info', icon: 'coins', ms: 6000, action: { label: 'Show me', fn() {} } });
const layer = () => document.getElementById('snacks');
const line = () => layer()?.children.find((x) => x.classList.contains('toast') && !x.classList.contains('leaving')) ?? null;

const PORTRAIT = { w: 390, hgt: 844, frameR: [0, 10, 390, 844], titleR: [110, 22, 280, 80], bodyR: [8, 90, 382, 844],
  sellR: [28, 782, 362, 828], toolbarR: [0, 764, 390, 844], nat: [12, 751, 378, 828] };
const LAND = { w: 844, hgt: 390, frameR: [344, 0, 844, 390], titleR: [500, 8, 700, 56], bodyR: [352, 64, 836, 390],
  sellR: [620, 310, 816, 356], toolbarR: [4, 40, 62, 340], nat: [172, 313, 672, 374] };

test('L4-01: iPhone 13 portrait, the Market open on Sell: the crate line never lies on Sell; it shows once the Market closes', async () => {
  mode = 'portrait';
  const m = market(PORTRAIT);
  crate(m.toasts);
  const l = line();
  assert.ok(!l || !hits(R(layer()), PORTRAIT.sellR), `the line ${l ? R(layer()) : '-'} on "Продай 10" ${PORTRAIT.sellR}`);
  m.close();
  await sleep(500);
  assert.ok(line(), 'the line shows within 500 ms of the Market closing');
  assert.match(line().textContent, /crate/);
});

test('L4-01: iPhone 13 on its side, the Market docked right: the crate line is in the free farm left of the sheet, off Sell', () => {
  mode = 'land';
  const m = market(LAND);
  crate(m.toasts);
  const l = line();
  assert.ok(l, 'there is room left of the sheet: the line shows now');
  const r = R(layer());
  assert.ok(!hits(r, LAND.sellR), `the line ${r} off Sell ${LAND.sellR}`);
  assert.ok(r[2] <= LAND.frameR[0], `and left of the sheet (${r[2]} <= ${LAND.frameR[0]})`);
  m.close();
  mode = 'portrait';
});

test('L4-01: a line the farmer\'s own press raised (an Undo) shows at once, as before (the Undo window is short)', () => {
  mode = 'portrait';
  const m = market(PORTRAIT);
  fire('pointerdown', { clientX: 195, clientY: 400 });
  m.toasts.toast('Order skipped: a new one comes in 15m', { kind: 'info', ms: 10000, action: { label: 'Undo', fn() {} } });
  assert.ok(line(), 'the Undo line is up while the sheet is open');
  m.close();
});
