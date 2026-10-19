// QA r3 (life-feel) L3-01 (jde#1, must): with reduced motion on, every action line (Undo, "Show me") flipped between
// two places 2.5 times a second and covered the toolbar (desktop) or the phone bar half the time.
// Cause: style.css gives every element a 1 ms transition on every property under reduced motion (the OS media query
// before the player picks, body.motion-reduced after). toasts.js's watch (every 400 ms) resets the layer's place and
// measures at once; a transition that has just started still reports the old, lifted rect, so nothing was written,
// and 1 ms later the line dropped to its CSS place on the toolbar. The next tick lifted it again.
// The fake layers below draw like that: a change of place shows the old rect until the next frame (`frame()`), unless
// the layer's inline transition is 'none' (as in the browser, transition-property none beats the global duration).
// Measured rects: .scratch/qa-triage-r3/repro-out-a.json and .scratch/r3-life-feel/out/probe-a-before.json.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDom } from './ui-qa2-dom.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const document = installDom();
document.addEventListener = () => {};
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
let phone = false;
globalThis.matchMedia = (q) => ({ matches: phone && /max-width: 600px|pointer: coarse/.test(q), addEventListener() {}, removeEventListener() {} });

const { h } = await import('../public/js/ui/dom.js');
const { createToasts, still } = await import('../public/js/ui/toasts.js');

const box = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t });
function at(el, [l, t, r, b]) {
  el.getBoundingClientRect = () => box(l, t, r, b);
  el.getClientRects = () => [el.getBoundingClientRect()];
  return el;
}
const R = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
const hits = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const num = (v) => Number.parseFloat(v || 0) || 0;

/** A layer drawn under reduced motion: `place()` is where its style puts it; a read shows where it is drawn. */
function lagging(el, place) {
  let drawn = null;
  el.getBoundingClientRect = () => {
    const want = place();
    // a new place starts a 1 ms transition: this read still sees the old rect (none: it jumps)
    if (!drawn || el.style.transition === 'none') drawn = want;
    return drawn;
  };
  el.getClientRects = () => [el.getBoundingClientRect()];
  el.frame = () => { drawn = place(); };          // 1 ms later: the transition has landed
  return el;
}
/** #snacks: fixed at the bottom centre (`nat`), lifted by style.bottom, or in the top slot. */
function snackPlace(el, nat) {
  const hgt = nat[3] - nat[1];
  return () => {
    let top = nat[1];
    if (el.style.top) top = num(el.style.top);
    else if (el.classList.contains('top')) top = 92;
    else if (el.style.bottom) top = innerHeight - num(el.style.bottom) - hgt;
    return box(nat[0], top, nat[2], top + hgt);
  };
}
/** #toasts: top-anchored and centred; margin-top moves it down. */
function columnPlace(el, nat) {
  return () => {
    if (!el.children.length) return box(0, 0, 0, 0);
    const dy = num(el.style.marginTop);
    return box(nat[0], nat[1] + dy, nat[2], nat[3] + dy);
  };
}

function setup({ w, hgt }) {
  globalThis.innerWidth = w;
  globalThis.innerHeight = hgt;
  document.body.replaceChildren(h('canvas#world'), h('div#hud',
    h('header.hud-tl', h('div.buffs#hud-buffs')),
    h('div.tray-wrap#tray-wrap', h('div#coach-slot'), h('nav#toolbar')),
    h('nav.dock#dock'), h('div.toasts#toasts'), h('div.banners#banners')));
  const panels = { top() { return null; }, on() { return () => {}; } };
  return createToasts({ store: { state: null, pid: 'p1' }, ui: { panels } }, (c) => c);
}
/** An Undo line whose layer (#snacks) is drawn at `nat` before any lift, drawn like reduced motion draws it. */
function snack(toasts, nat) {
  const real = document.body.append.bind(document.body);
  document.body.append = (...els) => {
    for (const e of els) if (e && e.classList?.contains('snacks')) lagging(e, snackPlace(e, nat));
    return real(...els);
  };
  toasts.toast('Order skipped: a new one comes in 15m', { action: { label: 'Undo', fn() {} }, ms: 10_000 });
  document.body.append = real;
  return document.querySelector('.snacks');
}

test('L3-01: under reduced motion the Undo line holds one place above the toolbar (desktop 1366) and the phone bar (iPhone 13)', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    for (const [name, w, hgt, isPhone, barR, nat] of [
      // the tester's frames: the line's CSS place lies on the toolbar (579-787 x 671-752) / the phone bar (764-844)
      ['desktop', 1366, 768, false, [579, 671, 787, 752], [478, 696, 888, 744]],
      ['iPhone 13', 390, 844, true, [0, 764, 390, 844], [12, 767, 378, 814]],
    ]) {
      phone = isPhone;
      const toasts = setup({ w, hgt });
      at(document.getElementById('toolbar'), barR);
      const layer = snack(toasts, nat);
      layer.frame();
      const seen = [];
      // the watch re-places it every 400 ms; the transition lands 1 ms after each
      for (let i = 0; i < 8; i++) {
        mock.timers.tick(400);
        layer.frame();
        seen.push(R(layer));
      }
      const tops = [...new Set(seen.map((r) => r[1]))];
      assert.equal(tops.length, 1, `${name}: one place over 3.2 s (tops ${tops.join(', ')})`);
      assert.ok(!hits(seen.at(-1), barR), `${name}: clear of the bar ${barR} (line ${seen.at(-1)})`);
      assert.equal(layer.style.transition, '', `${name}: its own transition is given back after each measure`);
    }
  } finally { mock.timers.reset(); phone = false; }
});

test('L3-01 (sibling): the top column under a bench chip holds one place too', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    phone = false;
    const toasts = setup({ w: 1366, hgt: 768 });
    const chipR = [563, 94, 803, 134];
    document.getElementById('hud').append(at(h('div.bench-chip'), chipR));
    const col = lagging(document.getElementById('toasts'), columnPlace(document.getElementById('toasts'), [445, 100, 921, 147]));
    toasts.toast('A plain line under a chip that is up', { ms: 6000 });
    col.frame();
    const seen = [];
    for (let i = 0; i < 8; i++) {
      mock.timers.tick(400);
      col.frame();
      seen.push(R(col));
    }
    const tops = [...new Set(seen.map((r) => r[1]))];
    assert.equal(tops.length, 1, `one place (tops ${tops.join(', ')})`);
    assert.ok(!hits(seen.at(-1), chipR), `below the chip (column ${seen.at(-1)})`);
  } finally { mock.timers.reset(); }
});

test('L3-01: still() measures with the transition off, keeps a write, and gives the old transition back', () => {
  const el = { style: { transition: 'opacity 200ms', bottom: '' }, reads: [], getBoundingClientRect() { this.reads.push(this.style.transition); return box(0, 0, 1, 1); } };
  const v = still(el, () => { el.getBoundingClientRect(); el.style.bottom = '120px'; return 7; });
  assert.equal(v, 7);
  assert.deepEqual(el.reads, ['none', 'none'], 'the measure and the commit read both ran with the transition off');
  assert.equal(el.style.transition, 'opacity 200ms');
  assert.equal(el.style.bottom, '120px');
  assert.doesNotThrow(() => still(null, () => {}), 'no layer: nothing to do');
});

test('L3-01: feel.css takes every transition off the three layers, in every motion mode (not inside a media query)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'feel.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // a top-level rule: depth 0 when its selector starts
  let depth = 0;
  let found = null;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      const sel = css.slice(start, i).trim();
      if (depth === 0 && /#snacks/.test(sel) && /#toasts/.test(sel) && /#over-panels \.over-toasts/.test(sel)) found = css.slice(i + 1, css.indexOf('}', i));
      depth++;
      start = i + 1;
    } else if (css[i] === '}') { depth--; start = i + 1; }
  }
  assert.ok(found, 'a top-level rule for #snacks, #toasts and #over-panels .over-toasts');
  assert.match(found, /transition\s*:\s*none\s*!important/);
});
