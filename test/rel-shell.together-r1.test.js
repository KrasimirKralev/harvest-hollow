// QA r1, ui-shell: the Together menu after the tester round.
//   S-10 (oib#1): in the phone's Farm book the Together row lost all five buttons on any touch inside the book (a
//        drag that scrolls it, its heading): "Leave a surprise", the gift's only phone door, could not be pressed.
//   S-27 (ap#5, P9): on a desktop the open menu stayed open: Escape did nothing once the focus had left it, and panels
//        opened over it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { createFarm } from '../shared/rules/state.js';
import { xpForLevel } from '../shared/content/index.js';
import { T0 } from './helpers.js';

const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const id = realTimeout(fn, ms, ...a); id?.unref?.(); return id; };

/** A listener table that dispatches capture listeners first (enough for document / window here). */
function listeners(obj) {
  const fns = [];
  obj.addEventListener = (type, fn, opt) => fns.push({ type, fn, capture: opt === true || Boolean(opt?.capture) });
  obj.removeEventListener = () => {};
  obj.fire = (type, ev) => {
    let stopped = false;
    const e = { type, preventDefault() { e.defaultPrevented = true; }, defaultPrevented: false, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; }, ...ev };
    for (const l of [...fns.filter((x) => x.capture), ...fns.filter((x) => !x.capture)]) { if (l.type === type && !stopped) l.fn(e); }
    return e;
  };
}

function rig() {
  const document = installDom();
  document.querySelector = (sel) => document.body.querySelector(sel);
  const proto = Object.getPrototypeOf(document.createElement('i'));
  if (!proto.hiddenReflects) {
    const set = proto.setAttribute;
    proto.setAttribute = function setAttribute(k, v) { if (k === 'hidden') this.hidden = true; return set.call(this, k, v); };
    proto.hiddenReflects = true;
  }
  listeners(document);
  globalThis.window = {};
  listeners(globalThis.window);
  for (const [tag, id] of [['div', 'hud'], ['div', 'social'], ['canvas', 'world']]) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.append(el);
  }
  globalThis.innerWidth = 1366;
  globalThis.innerHeight = 768;
  const state = createFarm(7, T0);
  state.farm.xp = xpForLevel(6);
  state.players.p1 = { ...state.players.p1, name: 'Ana' };
  state.players.p2 = { ...(state.players.p2 ?? state.players.p1), name: 'Bo' };
  const store = { state, pid: 'p1', now: () => T0, subscribe() { return () => {}; }, on() { return () => {}; } };
  const panelFns = [];
  const ui = { toast() {}, panels: { has: (n) => n === 'notes', open() {}, toggle() {}, top: () => null, on: (n, fn) => { panelFns.push([n, fn]); return () => {}; } } };
  const controller = { input: 'touch', tool: { id: 'hand' }, on() { return () => {}; }, setTool() {} };
  const openPanel = (name) => { for (const [n, fn] of panelFns) if (n === 'open') fn(name); };
  return { document, openPanel, S: { store, controller, ui, view: { avatars: null, onFrame() {} } } };
}

test('S-10: inside the phone\'s Farm book a touch on the book\'s heading or a drag keeps the five Together buttons', async () => {
  const { createSocial } = await import('../public/js/ui/social.js');
  const r = rig();
  createSocial(r.S);
  const { document } = r;
  // the Farm book borrows #social and un-hides its menu (ui/layout.js)
  const book = document.createElement('section');
  book.className = 'hh-panel farm-book';
  const heading = document.createElement('h2');
  book.append(heading);
  document.body.append(book);
  const social = document.getElementById('social');
  book.append(social);
  const menu = social.querySelector('#together-menu');
  menu.hidden = false;
  const shown = () => menu.hidden ? 0 : menu.querySelectorAll('.social-btn').filter((b) => !b.hidden).length;
  assert.equal(shown(), 5, 'five Together buttons in the book');
  document.fire('pointerdown', { target: heading });
  assert.equal(shown(), 5, 'a touch on the heading keeps them (HEAD: 5 -> 0)');
  document.fire('pointerdown', { target: book });
  assert.equal(shown(), 5, 'a drag that scrolls the book keeps them');
  r.openPanel('menu');
  assert.equal(shown(), 5, 'the book opening itself keeps them');
  window.fire('keydown', { key: 'Escape', target: book });
  assert.equal(shown(), 5, 'Escape is the book\'s (it closes the sheet), not the menu\'s');
});

test('S-27: on the HUD, Escape closes the open Together menu wherever the focus is; a panel opening closes it', async () => {
  const { createSocial } = await import('../public/js/ui/social.js');
  const r = rig();
  r.S.controller.input = 'mouse';
  createSocial(r.S);
  const { document } = r;
  const social = document.getElementById('social');
  const btn = social.querySelector('#together-btn');
  const menu = social.querySelector('#together-menu');
  btn.click();
  assert.equal(menu.hidden, false, 'open');
  // the focus went on to the toolbar: the menu's own key handler never sees the key
  const elsewhere = document.createElement('button');
  document.body.append(elsewhere);
  document.activeElement = elsewhere;
  const e = window.fire('keydown', { key: 'Escape', target: elsewhere });
  assert.equal(menu.hidden, true, 'Escape closed it (HEAD: it stayed open)');
  assert.equal(e.defaultPrevented, true, 'the key stops there');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  btn.click();
  assert.equal(menu.hidden, false);
  r.openPanel('market');
  assert.equal(menu.hidden, true, 'the Market opening over the farm put it away (HEAD: open across 8 panels)');
  btn.click();
  social.dispatch('focusout', { relatedTarget: elsewhere });
  assert.equal(menu.hidden, true, 'Tab out of the box closes it');
});
