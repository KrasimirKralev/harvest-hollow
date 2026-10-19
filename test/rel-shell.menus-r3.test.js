// QA r3, ui-shell: menus, flyouts, doors and keys.
//   S3-11 (jde#4, ap#4): the gear menu had no close hooks: drawn but dead over a panel that opened on its own (Harvey's
//         ready sheet), and open after the focus Tabbed out (each item was a Tab stop).
//   S3-15 (oib#1): a door reopened its panel on the last tab (the Market on the Acorn shop, Sell off the phone's strip).
//   S3-19 (oib#5): the tool pop-up stayed open behind the Goal Tracker's opened list (a HUD tap is no farm tap).
//   S3-20 (oib#7): Settings › Comfort offered "Key hints" on phones, where every key hint is hidden.
//   S3-23 (ap#5): the seed strip (role toolbar) ignored the arrow keys; leaving 21 seeds took 21 Tabs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDom, textOf } from './ui-qa2-dom.js';
import { xpForLevel } from '../shared/content/index.js';
import { controllerRig } from './helpers/ui-shell.js';

const src = (f) => fs.readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8');

/** A tiny event target with capture flags, and a fire(type, props) that runs the listeners like the DOM. */
function target(obj = {}) {
  const fns = [];
  obj.addEventListener = (type, fn, opt) => fns.push({ type, fn, capture: opt === true || Boolean(opt?.capture) });
  obj.removeEventListener = () => {};
  obj.fire = (type, props = {}) => {
    const e = { type, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, stopPropagation() {}, ...props };
    for (const l of [...fns.filter((x) => x.capture), ...fns.filter((x) => !x.capture)]) if (l.type === type) l.fn(e);
    return e;
  };
  return obj;
}

test('S3-11: the menu close hooks: a panel that opens by itself, a press outside, the focus leaving, Escape anywhere', async () => {
  const DOM = await import('../public/js/ui/dom.js');
  assert.equal(typeof DOM.menuCloseHooks, 'function', 'ui/dom.js menuCloseHooks({ wrap, isOpen, close, panels })');
  const inside = { id: 'item' };
  const outside = { id: 'harvey' };
  const wrap = target({ contains: (n) => n === inside || n === wrap });
  const doc = target({ body: { id: 'body' }, activeElement: inside });
  const win = target();
  const panelFns = [];
  const panels = { on: (ev, fn) => panelFns.push([ev, fn]) };
  let open = true;
  const closed = [];
  const close = ({ focus }) => { open = false; closed.push(focus); };
  DOM.menuCloseHooks({ wrap, isOpen: () => open, close, panels, win, doc });
  // Harvey's ready sheet opens by itself
  for (const [ev, fn] of panelFns) if (ev === 'open') fn('helper');
  assert.deepEqual(closed, [false], 'a panel that opened by itself puts the menu away (HEAD: drawn over the scrim)');
  // the focus Tabs out to Harvey's button
  open = true;
  wrap.fire('focusout', { relatedTarget: outside });
  assert.equal(open, false, 'Tab past the last item closes it (HEAD: open, aria-expanded true)');
  // a press on an item moves no focus out: the menu stays
  open = true;
  wrap.fire('focusout', { relatedTarget: null });
  wrap.fire('focusout', { relatedTarget: inside });
  assert.equal(open, true);
  // a press outside
  doc.fire('pointerdown', { target: outside });
  assert.equal(open, false);
  // Escape wherever the focus is: the focus goes back to the button when it was in the menu
  open = true;
  const e = win.fire('keydown', { key: 'Escape' });
  assert.equal(open, false);
  assert.equal(e.defaultPrevented, true, 'the same Escape does nothing else');
  assert.equal(closed.at(-1), true, 'focus back to the gear');
});

test('S3-11: the gear menu wires the hooks; its items are no Tab stops (arrows, Home, End move)', () => {
  const hud = src('ui/hud.js');
  assert.match(hud, /menuCloseHooks\(\{ wrap: moreWrap, isOpen: \(\) => !menu\.hidden, close: closeMenu, panels: ui\.panels \}\)/);
  assert.match(hud, /type: 'button', role: 'menuitem', tabindex: '-1'/, 'roving: the items are not Tab stops');
  assert.match(hud, /'aria-controls': 'hud-gear-menu'/, 'a closed panel opened from the menu gives the focus back to the gear (focusBackTo)');
  assert.match(hud, /e\.key === 'Home'/);
  assert.match(src('ui/ideas.js'), /role: 'menuitem', tabindex: '-1', id: 'hud-ideas'/, 'the ideas item too');
});

test('S3-15: a door opens a panel on its first tab; only a deep link ({ tab }) picks another', () => {
  const ix = src('ui/index.js');
  assert.doesNotMatch(ix, /if \(e\.args\.tab\) e\.tab = e\.args\.tab;\n\s+renderTabs\(e\);\n\s+mountPanel\(e\);\n\s+e\.frame\.classList\.remove\('is-closing'\)/,
    'HEAD: a fresh open kept the last tab when no tab was asked');
  assert.match(ix, /e\.tab = e\.args\.tab \?\? null;\n\s+renderTabs\(e\);/);
  assert.match(fs.readFileSync(new URL('../tools/tap-count.mjs', import.meta.url), 'utf8'), /sellAgain: 2/, 'tap-count counts the sale after another tab');
});

/** The toolbar over a tiny DOM, with the HUD element round it (the focus-r2 rig). */
async function toolbarRig({ phone = false } = {}) {
  const document = installDom();
  const proto = Object.getPrototypeOf(document.createElement('i'));
  proto.cloneNode ??= function cloneNode() {
    if (this.nodeType === 3) return document.createTextNode(this.data);
    const el = document.createElement(this.tagName.toLowerCase());
    el.className = this.className;
    for (const ch of this.childNodes) el.append(ch.cloneNode(true));
    return el;
  };
  const textProto = Object.getPrototypeOf(document.createTextNode(''));
  textProto.cloneNode ??= function cloneNode() { return document.createTextNode(this.data); };
  proto.toggleAttribute ??= function toggleAttribute(k, on) { if (on ?? !this.hasAttribute(k)) this.setAttribute(k, ''); else this.removeAttribute(k); };
  proto.scrollBy ??= function scrollBy() {};
  let focused = null;
  proto.focus = function focus() { focused = this; };
  const docFns = [];
  document.addEventListener = (type, fn, cap) => docFns.push({ type, fn, cap });
  const hud = document.createElement('div');
  hud.id = 'hud';
  document.body.append(hud);
  for (const [tag, id] of [['div', 'tray-wrap'], ['div', 'seed-tray'], ['div', 'build-tray'], ['div', 'stroke-chip'], ['div', 'tracker']]) {
    const el = document.createElement(tag);
    el.id = id;
    hud.append(el);
  }
  const canvas = document.createElement('canvas');
  canvas.id = 'world';
  document.body.append(canvas);
  const bar = document.createElement('nav');
  bar.id = 'toolbar';
  document.getElementById('tray-wrap').append(bar);
  document.getElementById('seed-tray').hidden = true;
  document.getElementById('build-tray').hidden = true;
  globalThis.innerWidth = phone ? 390 : 1366;
  globalThis.innerHeight = phone ? 844 : 768;
  globalThis.matchMedia = (q) => ({ matches: phone && /max-width: 600px|max-height: 500px|pointer: coarse/.test(q), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  const panelFns = [];
  const ui = { toast() {}, panels: { top: () => null, open() {}, has: () => false, on: (ev, fn) => { panelFns.push([ev, fn]); return () => {}; } } };
  const r = await controllerRig({ ui });
  r.store.state.farm.xp = xpForLevel(12);
  // window events (features' tracker.js dispatches 'tracker-open' on window); Node has no global event target
  const winFns = [];
  const hadAdd = Object.hasOwn(globalThis, 'addEventListener');
  globalThis.addEventListener = (type, fn) => winFns.push({ type, fn });
  const { createToolbar } = await import('../public/js/ui/toolbar.js');
  const tb = createToolbar({ store: r.store, controller: r.c, ui, view: r.w.view, settings: { scale: () => 100 } });
  if (!hadAdd) delete globalThis.addEventListener;
  tb.render();
  const down = (el) => { for (const l of docFns) if (l.type === 'pointerdown') l.fn({ target: el }); };
  const fire = (type) => { for (const l of winFns) if (l.type === type) l.fn({ type }); };
  return { ...r, document, bar, tb, down, fire, focused: () => focused, hud };
}

test('S3-19: a HUD press outside the flyout (the Goal Tracker\'s chip) puts the tool pop-up away; the bar\'s own press does not', async () => {
  const p = await toolbarRig({ phone: true });
  const pop = p.document.getElementById('tools-flyout');
  const slot = p.bar.querySelector('[data-slot="tool"]');
  slot.click();
  assert.equal(pop.hidden, false, 'the pop-up is open');
  // a press on the pop-up's own tiles or on the bar leaves it be
  p.down(pop.querySelector('button'));
  p.down(slot);
  assert.equal(pop.hidden, false);
  const chip = p.document.createElement('button');
  chip.className = 'tracker-chip';
  p.document.getElementById('tracker').append(chip);
  p.down(chip);
  assert.equal(pop.hidden, true, 'closed by the NOW chip\'s press (HEAD: it stayed open under the tracker\'s list)');
  // desktop: the Tools flyout the same
  const d = await toolbarRig();
  const fly = d.document.getElementById('tools-flyout');
  d.bar.querySelector('[data-slot="tools"]').click();
  assert.equal(fly.hidden, false);
  const pill = d.document.createElement('button');
  d.hud.append(pill);
  d.down(pill);
  assert.equal(fly.hidden, true);
  // the tracker's list opened by the keyboard (no press): its 'tracker-open' event puts the pop-up away too
  const k = await toolbarRig({ phone: true });
  const kpop = k.document.getElementById('tools-flyout');
  k.bar.querySelector('[data-slot="tool"]').click();
  assert.equal(kpop.hidden, false);
  k.fire('tracker-open');
  assert.equal(kpop.hidden, true, 'closed by the tracker\'s own event (an Enter on the NOW chip)');
});

function settingsRig({ touchLayout }) {
  const document = installDom();
  const vars = {};
  document.documentElement = { style: { setProperty: (k, v) => { vars[k] = v; }, getPropertyValue: (k) => vars[k] ?? '' } };
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.matchMedia = (q) => ({ matches: touchLayout && /max-width: 1180px/.test(q), addEventListener() {}, removeEventListener() {} });
  const reg = {};
  const S = { ui: { panels: { register: (n, def) => { reg[n] = def; }, has: () => false } }, controller: null, view: null, store: { state: null } };
  return { document, reg, S };
}

test('S3-20: Settings › Comfort shows "Key hints" only where key hints can show (the desktop layout)', async () => {
  const { createSettings } = await import('../public/js/ui/settings.js');
  const phone = settingsRig({ touchLayout: true });
  createSettings(phone.S);
  let body = document.createElement('div');
  phone.reg.settings.mount(body, { tab: 'access' });
  assert.doesNotMatch(textOf(body), /Key hints/i, `a phone: no switch that changes nothing (HEAD: offered) — ${textOf(body).slice(0, 200)}`);
  assert.doesNotMatch(textOf(body), /null/, 'no stray "null" in the list');
  const desk = settingsRig({ touchLayout: false });
  createSettings(desk.S);
  body = document.createElement('div');
  desk.reg.settings.mount(body, { tab: 'access' });
  assert.match(textOf(body), /Key hints/i, 'a desktop keeps it');
});

test('S3-23: the seed strip answers the arrows, Home and End, with one Tab stop', async () => {
  const d = await toolbarRig();
  const proto = Object.getPrototypeOf(d.document.createElement('i'));
  proto.focus = function focus() { d.document.activeElement = this; };
  d.c.setTool('seed_bag', { crop: 'wheat' });
  const { createSeeds } = await import('../public/js/ui/seeds.js');
  const seeds = createSeeds({ store: d.store, controller: d.c, view: d.w.view, ui: { panels: { on() {} }, toast() {} }, toolbar: d.tb });
  d.tb.setSeedFly(true);                                     // the Seeds slot's strip opens
  seeds.renderStrip();
  const strip = d.document.body.querySelectorAll('.seed-strip').find((x) => !x.classList.contains('spread-strip'));
  assert.ok(strip && !strip.hidden, 'the strip is open with the Seed Bag');
  const btns = strip.querySelectorAll('button');
  assert.ok(btns.length >= 3, `seeds in the strip: ${btns.length}`);
  const stops = btns.filter((b) => b.getAttribute('tabindex') !== '-1');
  assert.equal(stops.length, 1, `one Tab stop (HEAD: ${stops.length}: every seed)`);
  assert.equal(stops[0].dataset.crop, 'wheat', 'the seed in hand');
  stops[0].focus();
  const key = (k) => { const e = { key: k, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } }; strip.dispatch('keydown', e); return e; };
  assert.equal(key('ArrowRight').defaultPrevented, true);
  assert.equal(d.document.activeElement, btns[btns.indexOf(stops[0]) + 1], 'ArrowRight moves on (HEAD: it stayed on Wheat)');
  key('End');
  assert.equal(d.document.activeElement, btns.at(-1));
  key('Home');
  assert.equal(d.document.activeElement, btns[0]);
  key('ArrowLeft');
  assert.equal(d.document.activeElement, btns.at(-1), 'wraps round');
  assert.equal(strip.querySelectorAll('button').filter((b) => b.getAttribute('tabindex') === '0').length, 1, 'still one Tab stop');
});
