// mobile wave, layout lane: the phone and tablet layouts must never reach a desktop window, the JS and the CSS must
// agree on which layout a window gets, and the farm menu must give the HUD's buttons back exactly where they were.
// The look itself is checked with screenshots (docs/qa/mobile/layout/); this file checks what decides it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDom } from './ui-qa2-dom.js';
import { makeFarm } from './helpers.js';
import { LAYOUT_Q, layoutOf, menuBadge, menuNames } from '../public/js/ui/layout.js';
import { sheetDismiss } from '../public/js/ui/index.js';
import { PHONE_Q, phoneCoins } from '../public/js/ui/hud.js';
import { ensureStylesheet } from '../public/js/ui/dom.js';

const read = (p) => fs.readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');
const MOBILE_CSS = read('css/mobile.css');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** A media query list like '(max-width: 600px), (max-height: 500px)' evaluated for a w x h window. */
function mqMatches(q, w, h, { hover = true } = {}) {
  return q.split(',').some((part) => part.trim().split(/\s+and\s+/).every((cond) => {
    const m = /^\((min|max)-(width|height):\s*(\d+)px\)$/.exec(cond.trim());
    if (m) {
      const v = m[2] === 'width' ? w : h;
      return m[1] === 'min' ? v >= Number(m[3]) : v <= Number(m[3]);
    }
    if (cond.trim() === '(hover: none)') return !hover;
    throw new Error(`unknown media condition ${cond}`);
  }));
}

/** The top-level blocks of a stylesheet: [{ prelude, body }]. */
function topBlocks(css) {
  const out = [];
  let depth = 0;
  let start = 0;
  let prelude = '';
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (depth === 0) { prelude = css.slice(start, i).trim(); start = i + 1; } depth++; }
    else if (css[i] === '}') { depth--; if (depth === 0) { out.push({ prelude, body: css.slice(start, i) }); start = i + 1; } }
  }
  assert.equal(depth, 0, 'braces balance');
  assert.equal(css.slice(start).trim(), '', 'nothing after the last block');
  return out;
}

const DESKTOPS = [[1366, 768], [1920, 1080], [1440, 900], [1536, 864], [1280, 720], [2560, 1440], [1280, 1024]];
const ALLOWED = new Set([...Object.values(LAYOUT_Q), '(hover: none)']);

test('mobile.css: every rule sits in a named layout query, and no desktop window matches any of them', () => {
  const blocks = topBlocks(noComments(MOBILE_CSS));
  assert.ok(blocks.length >= 6);
  for (const b of blocks) {
    const m = /^@media\s+(.+)$/.exec(b.prelude);
    assert.ok(m, `a top-level rule outside a media query: "${b.prelude.slice(0, 60)}"`);
    assert.ok(ALLOWED.has(m[1]), `an unnamed media query: ${m[1]} (add it to ui/layout.js LAYOUT_Q)`);
    for (const [w, h] of DESKTOPS) {
      assert.equal(mqMatches(m[1], w, h, { hover: true }), false, `${m[1]} must not match a ${w} x ${h} desktop`);
    }
  }
  // and the queries the JS uses all appear in the stylesheet, verbatim
  for (const [name, q] of Object.entries(LAYOUT_Q)) {
    if (name === 'touch' || name === 'dockless' || name === 'phone' || name === 'portrait' || name === 'land' || name === 'tablet' || name === 'tabletWide') {
      assert.ok(MOBILE_CSS.includes(`@media ${q} {`), `css/mobile.css has the ${name} query`);
    }
  }
});

test('layoutOf agrees with the media queries for every window size', () => {
  const phones = [[360, 740], [390, 844], [390, 664], [412, 915], [430, 932], [844, 390], [844, 340], [915, 412], [740, 360]];
  for (const [w, h] of phones) assert.match(layoutOf(w, h), /^phone/, `${w} x ${h} is a phone`);
  assert.equal(layoutOf(768, 1024), 'tablet');
  assert.equal(layoutOf(1024, 768), 'tablet');
  for (const [w, h] of DESKTOPS) assert.equal(layoutOf(w, h), 'desktop', `${w} x ${h}`);
  for (let w = 300; w <= 2000; w += 23) {
    for (let h = 280; h <= 1400; h += 29) {
      const touch = mqMatches(LAYOUT_Q.touch, w, h);
      const want = mqMatches(LAYOUT_Q.land, w, h) ? 'phone-land' : mqMatches(LAYOUT_Q.portrait, w, h) ? 'phone'
        : touch ? 'tablet' : 'desktop';
      assert.equal(layoutOf(w, h), want, `${w} x ${h}`);
      // the tablet queries are exactly the touch layouts that are not phones
      assert.equal(mqMatches(LAYOUT_Q.tablet, w, h), want === 'tablet', `tablet query at ${w} x ${h}`);
      assert.equal(mqMatches(LAYOUT_Q.phone, w, h), want === 'phone' || want === 'phone-land', `phone query at ${w} x ${h}`);
      if (mqMatches(LAYOUT_Q.tabletWide, w, h)) assert.equal(want, 'tablet');
      if (mqMatches(LAYOUT_Q.dockless, w, h)) assert.notEqual(want, 'desktop');
    }
  }
  assert.equal(PHONE_Q, LAYOUT_Q.phone, 'hud.js keeps the same phone query');
});

test('mobile.css: no text under 13 px (body text at 14 px and more)', () => {
  const size = /font:\s*(?:\d{3}\s+)?(?:italic\s+)?([\d.]+)(rem|px)|font-size:\s*([\d.]+)(rem|px)/g;
  const small = [];
  noComments(MOBILE_CSS).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(size)) {
      const px = Number(m[1] ?? m[3]) * ((m[2] ?? m[4]) === 'rem' ? 16 : 1);
      if (px < 13) small.push(`mobile.css:${i + 1} ${px}px`);
    }
  });
  assert.deepEqual(small, []);
});

test('the desktop never draws the phone controls; the page is ready for notches and links mobile.css last', () => {
  const shell = noComments(read('css/shell.css'));
  const base = topBlocks(shell).find((b) => b.prelude === '.m-menu-btn, .tracker-chip-wrap, .hh-sheet-grip');
  assert.ok(base && /display:\s*none/.test(base.body), 'shell.css hides the menu button, the tracker chip and the sheet grip');
  const html = read('index.html');
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover/);
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(sheets.at(-1), '/css/mobile.css', 'mobile.css is the last stylesheet');
  assert.match(read('css/style.css'), /--sab: env\(safe-area-inset-bottom, 0px\)/);
});

test('sheetDismiss: a third of the way or a flick closes a sheet, a wobble never does', () => {
  assert.equal(sheetDismiss(10, 50, 600), false, 'a wobble');
  assert.equal(sheetDismiss(24, 10, 600), false, 'never under 24 px, however quick');
  assert.equal(sheetDismiss(120, 600, 600), false, 'a slow pull under a third');
  assert.equal(sheetDismiss(181, 900, 600), true, 'past the 160 px cap');
  assert.equal(sheetDismiss(100, 600, 300), true, 'a third of a short sheet');
  assert.equal(sheetDismiss(60, 80, 700), true, 'a flick');
  assert.equal(sheetDismiss(NaN, 10, 600), false);
});

test('phoneCoins: exact up to 99,999, then short', () => {
  assert.equal(phoneCoins(0), '0');
  assert.equal(phoneCoins(99_999), '99,999');
  assert.equal(phoneCoins(100_000), '100k');
  assert.equal(phoneCoins(735_457), '735k');
  assert.equal(phoneCoins(1_250_000), '1.3M');
});

test('the farm menu badge: red when something inside needs you, calm when there is only something to do', () => {
  const list = [
    { name: 'market', dock: { label: 'Market' }, badge: null },
    { name: 'barn', dock: { label: 'Barn' }, badge: '!', badgeTone: null },
    { name: 'orders', dock: { label: 'Orders' }, badge: 2, badgeTone: 'calm' },
    { name: 'journal', dock: { label: 'Journal' }, badge: null },
    { name: 'fair', dock: { label: 'Fair', mini: true }, badge: null },
    { name: 'settings', dock: null, badge: '!' },
  ];
  assert.deepEqual(menuNames(list, false).map((p) => p.name), ['orders', 'journal', 'fair'], 'a tablet keeps Market and Barn in its bar');
  assert.deepEqual(menuNames(list, true).map((p) => p.name), ['market', 'barn', 'orders', 'journal', 'fair']);
  assert.deepEqual(menuBadge(list, true), { text: '!', tone: 'red' }, 'the Barn spills: red');
  assert.deepEqual(menuBadge(list, false), { text: '1', tone: 'calm' }, 'on a tablet the Barn is in the bar');
  assert.equal(menuBadge(list.map((p) => ({ ...p, badge: null })), true), null);
  assert.deepEqual(menuBadge([{ name: 'pets', dock: { mini: true }, badge: 'New' }], false), { text: 'New', tone: 'new' });
});

test('ensureStylesheet: a versioned link counts, so a panel sheet is never linked twice after mobile.css', () => {
  const links = [{ href: '/css/panels.css?v=370c939606a9' }];
  const appended = [];
  const doc = {
    head: { append: (el) => { appended.push(el); links.push(el); } },
    querySelectorAll: () => links.map((l) => ({ getAttribute: (k) => (k === 'href' ? l.href : null) })),
    createElement: () => ({}),
  };
  const saved = globalThis.document;
  globalThis.document = doc;
  try {
    ensureStylesheet('/css/panels.css');
    assert.equal(appended.length, 0, 'the versioned link is the same sheet');
    ensureStylesheet('/css/panels-weekly.css');
    assert.equal(appended.length, 1);
    assert.equal(appended[0].href, '/css/panels-weekly.css');
    ensureStylesheet('/css/panels-weekly.css');
    assert.equal(appended.length, 1, 'idempotent');
  } finally {
    globalThis.document = saved;
  }
  assert.doesNotThrow(() => ensureStylesheet('/css/x.css'), 'no document: nothing to do');
});

test('the farm menu takes the HUD\'s dock, small dock and together buttons and gives them back exactly in place', async () => {
  const document = installDom();
  document.documentElement = document.createElement('html');
  document.querySelector = (sel) => document.body.querySelector(sel);
  // the tiny DOM has no nextSibling (the menu remembers each node's place by it)
  const nodeProto = Object.getPrototypeOf(Object.getPrototypeOf(document.body));
  Object.defineProperty(nodeProto, 'nextSibling', { configurable: true, get() {
    const p = this.parentNode;
    return p ? p.childNodes[p.childNodes.indexOf(this) + 1] ?? null : null;
  } });
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
    e.append(...kids);
    return e;
  };
  const dock = el('nav', { id: 'dock', class: 'dock wood' }, el('button', { class: 'dock-btn', 'data-dock': 'build' }));
  const minis = el('div', { class: 'dock-minis' }, el('button', { class: 'dock-mini', 'data-dock': 'orders' }));
  const feed = el('ol', { id: 'feed', class: 'feed' });
  const social = el('div', { id: 'social', class: 'social' }, el('button', { class: 'social-btn' }));
  const bl = el('section', { class: 'hud-bl' }, feed, social);
  const tray = el('div', { id: 'tray-wrap', class: 'tray-wrap' });
  const hud = el('div', { id: 'hud' }, dock, minis, bl, tray);
  document.body.append(hud);

  let W = 390;
  let H = 844;
  Object.assign(globalThis, {
    innerWidth: W, innerHeight: H, window: { addEventListener() {} },
    matchMedia: (q) => ({ get matches() { return mqMatches(q, W, H, { hover: false }); }, addEventListener() {} }),
  });
  const specs = {};
  const panels = {
    list: () => [], on: () => () => {}, has: () => false, isOpen: () => false, open() {}, toggle() {}, close() {},
    register(name, spec) { specs[name] = spec; return () => {}; },
  };
  const { state } = makeFarm();
  const { createLayout } = await import('../public/js/ui/layout.js');
  const layout = createLayout({ store: { state, pid: 'p1' }, ui: { panels, toast() {} }, controller: {},
    settings: { get: () => ({ muted: false }), set() {} } });
  assert.equal(layout.mode, 'phone');
  assert.equal(document.documentElement.dataset.layout, 'phone');
  assert.ok(tray.querySelector('#m-menu-btn'), 'the menu button sits in the bottom bar');
  assert.ok(specs.menu, 'the menu registers as a panel (frame, focus trap, Esc and the sheet come with it)');

  const order = () => hud.children.map((c) => c.id || c.className);
  const before = order();
  const body = document.createElement('div');
  let closed = 0;
  const inst = specs.menu.mount(body, { close: () => { closed++; } });
  assert.ok(body.contains(dock) && body.contains(minis) && body.contains(social), 'a phone takes all three in');
  assert.ok(!hud.contains(dock));
  // a chat line opened from the menu goes home with the buttons
  social.before(el('div', { class: 'chat-box' }));
  inst.destroy();
  assert.deepEqual(order(), before, 'the HUD keeps its order');
  assert.equal(social.parentNode, bl);
  assert.deepEqual(bl.children.map((c) => c.className), ['feed', 'chat-box', 'social'], 'feed, the chat line, then the buttons');
  assert.equal(closed, 0);

  // a wide tablet keeps Build / Market / Barn in its bar: only the small dock and the together buttons move
  W = 1024; H = 768;
  const body2 = document.createElement('div');
  const inst2 = specs.menu.mount(body2, { close() {} });
  assert.ok(!body2.contains(dock) && body2.contains(minis) && body2.contains(social));
  inst2.destroy();
  assert.deepEqual(order(), before);
});

test('touch wording: "click" reads "tap" and key hints drop out for a touch player only', async () => {
  const { touchText, touchPlayer } = await import('../public/js/ui/dom.js');
  assert.equal(touchText('Ping your partner (G) or wave (T).', true), 'Ping your partner or wave.');
  assert.equal(touchText('Click the weeds and rocks around the yard.', true), 'Tap the weeds and rocks around the yard.');
  assert.equal(touchText('or click the weeds; clicked, clicking, clicks', true), 'or tap the weeds; tapped, tapping, taps');
  assert.equal(touchText('Pick a seed first (2), then click the plot.', true), 'Pick a seed first, then tap the plot.');
  assert.equal(touchText('Drag across the plots (a Quickclick stays).', true), 'Drag across the plots (a Quickclick stays).');
  assert.equal(touchText('Ping your partner (G) or wave (T).', false), 'Ping your partner (G) or wave (T).', 'a mouse player reads it as written');
  assert.equal(touchText(null, true), null);
  // mobile QA M-07: chorded keys, the wheel and the Hammer's key tip read as a phone works too
  assert.equal(touchText('Move back (Ctrl+Z)', true), 'Move back');
  assert.equal(touchText('Zoom in (wheel)', true), 'Zoom in');
  assert.equal(touchText('R rotates, Esc cancels. Moving keeps every timer running.', true), '⟳ turns it, ✕ cancels. Moving keeps every timer running.');
  assert.equal(touchText('Move back (Ctrl+Z)', false), 'Move back (Ctrl+Z)');
  assert.equal(touchPlayer({ input: 'touch' }), true);
  const saved = globalThis.matchMedia;
  try {
    globalThis.matchMedia = (q) => ({ matches: q === '(pointer: coarse)' });
    assert.equal(touchPlayer({ input: 'mouse' }), true, 'before the first touch the device decides');
    globalThis.matchMedia = () => ({ matches: false });
    assert.equal(touchPlayer({ input: 'mouse' }), false);
  } finally {
    globalThis.matchMedia = saved;
  }
});
