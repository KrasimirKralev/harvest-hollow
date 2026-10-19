// QA r2, ui-shell: fields, flyouts and the focus.
//   S2-04 (oib#2): renaming the farm with the keyboard up kept a suggestion chip in view and "Carve it!" under the
//         keyboard: keep-in-view took the first worded button after the field, a chip.
//   S2-11 (oib#3, br#5): the phone's tool pop-up stayed open under a sheet and after its ✕; a double-clicked build tray
//         ignored the global Escape and stayed open under every panel.
//   S2-14 (ap#1, shell half): a keyboard pick in Tools ▸ or the seed strip, or closing the gift sheet, dropped the focus
//         to <body>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { xpForLevel } from '../shared/content/index.js';
import { controllerRig } from './helpers/ui-shell.js';

const UI = await import('../public/js/ui/index.js');

/** The naming card as life-feel builds it (ui/naming.js): field, suggestion chips, then Later and Carve. */
function namingCard(document) {
  const root = document.createElement('section');
  root.className = 'hh-panel';
  const input = document.createElement('input');
  input.className = 'field';
  const chips = document.createElement('div');
  chips.className = 'chips';
  for (const s of ['Малка ливада', 'Слънчева долина', 'Тиха поляна', 'Още']) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = s;
    chips.append(b);
  }
  const acts = document.createElement('div');
  acts.className = 'acts';
  const later = document.createElement('button');
  later.className = 'btn btn--paper';
  later.textContent = 'По-късно';
  const carve = document.createElement('button');
  carve.className = 'btn';
  carve.textContent = 'Издълбай го!';
  acts.append(later, carve);
  root.append(input, chips, acts);
  document.body.append(root);
  return { root, input, chips, later, carve };
}

test('S2-04: the field\'s button is never a suggestion chip after it (Later and Carve share the row under the chips)', () => {
  const document = installDom();
  const c = namingCard(document);
  const b = UI.buttonAfter(c.input, c.root);
  assert.ok(b === c.later || b === c.carve, `the card's own row (HEAD: the chip "${b?.textContent}")`);
  assert.ok(!b.classList.contains('chip'));
  // a field followed by chips only still keeps its first chip in view
  const document2 = installDom();
  const d = namingCard(document2);
  d.acts = d.root.querySelector('.acts');
  d.acts.remove();
  assert.equal(UI.buttonAfter(d.input, d.root)?.textContent, 'Малка ливада');
});

test('S2-14: a closed panel gives the focus back to the visible door of the container its opener sat in', () => {
  assert.equal(typeof UI.focusBackTo, 'function', 'ui/index.js focusBackTo(opener)');
  const document = installDom();
  const proto = Object.getPrototypeOf(document.createElement('i'));
  proto.getClientRects = function getClientRects() { return this._shown ? [1] : []; };
  const social = document.createElement('div');
  social.id = 'social';
  const togetherBtn = document.createElement('button');
  togetherBtn.id = 'together-btn';
  togetherBtn.setAttribute('aria-controls', 'together-menu');
  togetherBtn._shown = true;
  const menu = document.createElement('div');
  menu.id = 'together-menu';
  const gift = document.createElement('button');
  gift.className = 'gift-btn';
  menu.append(gift);
  social.append(togetherBtn, menu);
  document.body.append(social);
  menu.setAttribute('hidden', '');           // the menu closed when the gift sheet opened
  assert.equal(UI.focusBackTo(gift, document), togetherBtn, 'the Together button (HEAD: the focus fell to <body>)');
  // a shown opener keeps it
  gift._shown = true;
  menu.removeAttribute('hidden');
  assert.equal(UI.focusBackTo(gift, document), gift);
  // a phone: the Farm book closed (its frame hidden), the book's button takes it
  const document2 = installDom();
  Object.getPrototypeOf(document2.createElement('i')).getClientRects = function getClientRects() { return this._shown ? [1] : []; };
  const frame = document2.createElement('section');
  frame.id = 'panel-menu';
  const tile = document2.createElement('button');
  frame.append(tile);
  const book = document2.createElement('button');
  book.id = 'm-menu-btn';
  book.setAttribute('aria-controls', 'panel-menu');
  book._shown = true;
  document2.body.append(frame, book);
  frame.setAttribute('hidden', '');
  assert.equal(UI.focusBackTo(tile, document2), book);
});

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
  for (const [tag, id] of [['div', 'tray-wrap'], ['div', 'seed-tray'], ['div', 'build-tray'], ['div', 'stroke-chip'], ['canvas', 'world']]) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.append(el);
  }
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
  const { createToolbar } = await import('../public/js/ui/toolbar.js');
  const tb = createToolbar({ store: r.store, controller: r.c, ui, view: r.w.view, settings: { scale: () => 100 } });
  tb.render();
  const openPanel = (name) => { for (const [ev, fn] of panelFns) if (ev === 'open') fn(name); };
  const key = (k) => {
    const e = { key: k, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, stopPropagation() {} };
    for (const l of docFns) if (l.type === 'keydown') l.fn(e);
    return e;
  };
  return { ...r, document, bar, tb, openPanel, key, focused: () => focused, ui };
}

test('S2-11: a panel coming up puts away the Tools flyout, the phone\'s pop-up and the build tray', async () => {
  const d = await toolbarRig();
  const fly = d.document.getElementById('tools-flyout');
  d.bar.querySelector('[data-slot="tools"]').click();
  assert.equal(fly.hidden, false, 'the Tools flyout is open');
  d.openPanel('market');
  assert.equal(fly.hidden, true, 'a panel closed it (HEAD: it stayed open under the panel)');
  d.tb.openBuild(true);
  assert.equal(d.tb.buildOpen, true);
  d.openPanel('barn');
  assert.equal(d.tb.buildOpen, false, 'the build tray too');
  assert.equal(d.document.getElementById('build-tray').hidden, true);

  const p = await toolbarRig({ phone: true });
  const pop = p.document.getElementById('tools-flyout');
  p.bar.querySelector('[data-slot="tool"]').click();
  assert.equal(pop.hidden, false, 'the phone\'s pop-up is open');
  p.openPanel('market');
  assert.equal(pop.hidden, true, 'the Market sheet put it away (HEAD: it covered 240 px of the farm after the ✕)');
});

test('S2-11: Escape closes the build tray wherever the focus is (a double click on Build left it on Build)', async () => {
  const d = await toolbarRig();
  d.tb.openBuild(true);
  assert.equal(d.tb.buildOpen, true);
  const e = d.key('Escape');
  assert.equal(d.tb.buildOpen, false, 'closed (HEAD: only the tray\'s own keydown closed it)');
  assert.equal(e.defaultPrevented, true, 'the same Escape does not also drop the tool');
});

test('S2-14: a pick in the Tools flyout gives the focus back to the Tools slot', async () => {
  const d = await toolbarRig();
  const slot = d.bar.querySelector('[data-slot="tools"]');
  slot.click();
  const can = d.document.getElementById('tools-flyout').querySelector('[data-tool="watering_can"]');
  assert.ok(can, 'the Watering Can in the flyout');
  can.click();
  assert.equal(d.c.tool.id, 'watering_can');
  assert.equal(d.focused(), slot, `the focus is on the Tools slot (HEAD: <body>; got ${d.focused()?.className})`);
});
