// QA r4 (life-feel) L4-09 (br#4): a partner named with 16 very wide glyphs ('﷽' x 16, which cleanName accepts). On a
// 360 x 640 phone the farmer's name plate became a strip wider than the screen (1,103 px: white-space nowrap, no
// max-width), the arrival toast grew to 258 x 328 px with its last words out of the bubble, and the HUD chip's portrait
// stretched into a wide rectangle. Now:
//   - the plate's name ends in an ellipsis at 10em (render/avatars-view.js);
//   - a farmer's name in a toast is one span that ends in an ellipsis at 10em (ui/toasts.js named(), css/feel.css);
//   - the HUD face's grid track is the face itself, so one wide initial no longer widens the portrait (css/shell.css,
//     ui-shell's .players .face and .slot .face; feel.css carried a copy until ui-shell applied the patch).
// The sizes on screen (plate, toast and chip each inside 360 px, the toast at most 120 px tall) are the browser proof in
// docs/qa/release/qa-r4/fix-life-feel.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { installDom, textOf } from './ui-qa2-dom.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIDE = '﷽'.repeat(16);
const document = installDom();
document.documentElement = { lang: 'bg' };
const realCreate = document.createElement.bind(document);
document.createElement = (tag) => {
  if (tag !== 'canvas') return realCreate(tag);
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => ({ addColorStop() {} })), set: (o, k, v) => { o[k] = v; return true; } });
  return { width: 0, height: 0, style: {}, getContext: () => ctx };
};
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.innerWidth = 360;
globalThis.innerHeight = 640;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

// no model files here: the rig's "failed to load; trying again" is expected and kept out of the output
const warn = console.warn;
console.warn = (...a) => { if (!/failed to load|manifest/.test(String(a[0]))) warn(...a); };
const { setFetcher } = await import('../public/js/render/assets.js');
setFetcher(async () => ({ ok: false, status: 404 }));
const { createAvatarsView } = await import('../public/js/render/avatars-view.js');
const { h } = await import('../public/js/ui/dom.js');
const { createToasts } = await import('../public/js/ui/toasts.js');

test('L4-09: the name plate\'s name ends in an ellipsis at 10em (it was a strip wider than the screen)', () => {
  {
    const overlay = realCreate('div');
    const layers = { avatars: new THREE.Group(), ui3d: new THREE.Group(), fx: new THREE.Group() };
    const v = createAvatarsView(layers, overlay, () => ({ x: 100, y: 100, visible: true }));
    v.setPlayers({ p1: { name: 'Ана', color: '#FF7A6B', avatar: { body: 'farmer_a' } }, p2: { name: WIDE, color: '#4A7FE8', avatar: { body: 'farmer_b' } } }, 'p1');
    const plate = overlay.children.find((el) => el.className === 'nameplate' && textOf(el) === WIDE);
    assert.ok(plate, 'p2\'s plate');
    const label = plate.label ?? plate.children[1];
    const css = String(label.style.cssText).replace(/\s+/g, '');
    for (const want of ['max-width:10em', 'overflow:hidden', 'text-overflow:ellipsis', 'min-width:0']) assert.ok(css.includes(want), `the label's style has ${want}: "${label.style.cssText}"`);
  }
});

function toasts() {
  document.body.replaceChildren(h('div#toasts'), h('div#banners'));
  const state = { players: { p1: { name: 'Ана' }, p2: { name: WIDE } } };
  return createToasts({ store: { state, pid: 'p1' }, ui: { panels: { top: () => null, on: () => () => {} } } }, (c) => c);
}

test('L4-09: a farmer\'s name in a toast is one span of its own (the span ends in an ellipsis), the words around it stay', () => {
  const T = toasts();
  const el = T.toast(`${WIDE} дойде във фермата 🌻`, { kind: 'love', ms: 3500 });
  const spans = el.querySelectorAll('.tx-name');
  assert.equal(spans.length, 1, 'one name span');
  assert.equal(textOf(spans[0]), WIDE);
  assert.equal(textOf(el.querySelector('.tx')), `${WIDE} дойде във фермата 🌻`, 'the line reads the same');
  const two = T.toast('Ана и Бо: Ана засади', {});
  assert.equal(two.querySelectorAll('.tx-name').length, 2, 'every time the name comes');
  const inWord = T.toast('Анастасия засади', {});
  assert.equal(inWord.querySelectorAll('.tx-name').length, 0, 'a name inside a longer word is not a name');
});

test('L4-09: the stylesheet clamps the name span (feel.css), and the HUD face\'s grid track is the face (shell.css)', () => {
  const css = (f) => fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleIn = (src, sel) => [...src.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].split(',').map((x) => x.trim()).includes(sel)).map((m) => m[2]).join(';');
  const name = ruleIn(css('feel.css'), '.toast .tx-name');
  for (const want of [/max-width:\s*10em/, /overflow:\s*hidden/, /text-overflow:\s*ellipsis/, /white-space:\s*nowrap/]) assert.match(name, want);
  const shell = css('shell.css');
  for (const face of ['.players .face', '.slot .face']) {
    assert.match(ruleIn(shell, face), /grid-template-columns:\s*minmax\(0,\s*100%\)/, face);
    assert.match(ruleIn(shell, face), /grid-template-rows:\s*minmax\(0,\s*100%\)/, face);
  }
  assert.match(ruleIn(shell, '.face > .ltr'), /max-width:\s*100%/);
  assert.match(ruleIn(shell, '.face > .ltr'), /overflow:\s*hidden/);
});
