// QA r4 (life-feel) L4-02 (fbp#4): the reason slips at an object (S7, fx.float `kind: 'why'`).
//   - The Axe on the Feed Mill near the left edge at 360 BG: the slip was centred on the mill, at x -45 to 243 ("два: тук
//     ням…", the start off screen), and Grandma's arrow (#pointers, z 30) was drawn over its middle (the slip lived in
//     #overlay, under the HUD).
//   - A blocked placement on an iPhone 13: „Пречи кокошарникът“ floated with its top 8 px under the ⟳ ✕ ✓ bar
//     (game/touch-build.js).
// Now a slip floats in #fx-top (z 60, above the arrow and the HUD), inside [8, innerWidth - 8] (it wraps when it is
// wider), and off the placement bar over its whole rise, on the side of the bar nearer its object.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFxDom, StubEl, stubLayer } from './helpers/life-feel.js';

const dom = installFxDom({ images: 'ok', width: 360, height: 640 });
const { createFx, slipSpot } = await import('../public/js/render/fx.js');

/** A world point whose slip foot projects at screen (sx, sy): stubToScreen maps metres x10 + 100. */
const screenAt = (sx, sy) => ({ x: 0, z: 0, y: 0, sx, sy });
const toScreen = (mx, mz, my) => ({ x: mx, y: mz, visible: true, my });
let ov = null;
function fxAt() {
  ov = new StubEl('div');
  dom.body.appendChild(ov);
  return createFx(stubLayer(), ov, (mx, mz) => toScreen(mx, mz));
}
/** The paper slip the last float drew: its outer (positioned) and inner (the slip), sized w x h like the browser lays it. */
function slip(fx, at, text, w, h) {
  fx.float({ x: at.sx, z: at.sy, y: 0 }, text, { kind: 'why' });
  const top = globalThis.document.getElementById('fx-top');
  const inTop = top?.children.filter((o) => /floater--paper/.test(o.children[0]?.className ?? '')).at(-1);
  const outer = inTop ?? ov.children.at(-1);
  const inner = outer?.children[0];
  return { top: inTop ? top : null, outer, inner, size(wd = w, hg = h) { inner.offsetWidth = wd; inner.offsetHeight = hg; } };
}
/** Where the slip is drawn: the outer's translate3d(x, y) is its bottom centre (translate(-50%, -100%)). */
function rectOf(outer, w, h) {
  const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(outer.style.transform);
  const x = Number(m[1]);
  const y = Number(m[2]);
  return { left: x - w / 2, right: x + w / 2, top: y - h, bottom: y };
}

test('L4-02: a slip at screen x = 20 is drawn inside [8, innerWidth - 8] (it was cut at the left edge), in #fx-top', () => {
  const fx = fxAt();
  const W = 288;
  const H = 31;
  const first = slip(fx, screenAt(150, 300), 'Брадва: тук няма какво да правиш', W, H);
  first.size();
  // the pool's node is measured on its next use: wait for the first to finish, then float at the edge
  first.inner.anims.at(-1)?.onfinish?.();
  const s = slip(fx, screenAt(20, 300), 'Брадва: тук няма какво да правиш', W, H);
  assert.equal(s.inner, first.inner, 'the same pooled slip');
  const r = rectOf(s.outer, W * 1.15, H);          // its pop scales it to 1.15 for a moment
  assert.ok(r.left >= 8 && r.right <= innerWidth - 8, `the slip ${Math.round(r.left)}..${Math.round(r.right)} inside 8..${innerWidth - 8}`);
  assert.ok(s.top, 'the slip floats in #fx-top (above the coach\'s arrow, #pointers z 30), not in the farm overlay');
});

test('L4-02: a slip during a touch placement does not lie on the ⟳ ✕ ✓ bar (iPhone 13: the bar above the slip\'s object)', () => {
  globalThis.innerWidth = 390;
  globalThis.innerHeight = 844;
  const bar = new StubEl('div');
  bar.id = 'touch-build';
  bar.rect = { left: 149, top: 343, width: 212, height: 88 };            // 149-361 x 343-431, as the tester measured
  dom.body.appendChild(bar);
  try {
    const fx = fxAt();
    const W = 188;
    const H = 30;
    const first = slip(fx, screenAt(255, 453), 'Пречи кокошарникът', W, H);
    first.size();
    first.inner.anims.at(-1)?.onfinish?.();
    const s = slip(fx, screenAt(255, 453), 'Пречи кокошарникът', W, H);   // the reported slip: 161-349 x 423-453
    const r = rectOf(s.outer, W * 1.15, H);
    const rise = 16;
    const b = bar.getBoundingClientRect();
    const hit = r.left < b.right && b.left < r.right && r.top - rise < b.bottom && b.top < r.bottom;
    assert.ok(!hit, `the slip ${Math.round(r.left)},${Math.round(r.top - rise)}-${Math.round(r.right)},${Math.round(r.bottom)} (with its rise) clear of the bar ${b.left},${b.top}-${b.right},${b.bottom}`);
    assert.ok(r.top >= b.bottom, 'below the bar: the side nearer its object');
  } finally { bar.remove(); globalThis.innerWidth = 360; globalThis.innerHeight = 640; }
});

test('L4-02: with the phone bar under the placement bar (no room below it), the slip goes above the placement bar', () => {
  globalThis.innerWidth = 390;
  globalThis.innerHeight = 844;
  const bar = new StubEl('div');
  bar.id = 'touch-build';
  bar.rect = { left: 10, top: 624, width: 212, height: 88 };            // 10-222 x 624-712 (the browser, a low ghost)
  const phoneBar = new StubEl('nav');
  phoneBar.id = 'toolbar';
  phoneBar.rect = { left: 0, top: 764, width: 390, height: 80 };
  dom.body.appendChild(bar);
  dom.body.appendChild(phoneBar);
  try {
    const fx = fxAt();
    const first = slip(fx, screenAt(114, 740), 'Пречи кокошарникът', 186, 29);
    first.size();
    first.inner.anims.at(-1)?.onfinish?.();
    const s = slip(fx, screenAt(114, 740), 'Пречи кокошарникът', 186, 29);
    const r = rectOf(s.outer, 186 * 1.15, 29);
    const b = bar.getBoundingClientRect();
    assert.ok(r.bottom <= b.top, `above the placement bar (${Math.round(r.top)}-${Math.round(r.bottom)} vs ${b.top})`);
    assert.ok(r.bottom <= 764, 'never on the phone bar');
  } finally { bar.remove(); phoneBar.remove(); globalThis.innerWidth = 360; globalThis.innerHeight = 640; }
});

test('L4-02: slipSpot keeps a slip that fits where it was, and puts one under a bar above it when there is no room below', () => {
  assert.deepEqual(slipSpot(180, 300, 200, 30, 16, null, 360, 640), [180, 300], 'nothing to move');
  const bar = { left: 100, right: 300, top: 560, bottom: 640 };
  const [, y] = slipSpot(200, 600, 200, 30, 16, bar, 360, 640);
  assert.ok(y <= bar.top - 8, `no room below the bar: above it (${y})`);
});
