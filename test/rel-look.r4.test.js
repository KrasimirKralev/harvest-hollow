// render-look, QA round 4 (docs/qa/release/qa-r4/fix-render-look.md): R4-01 the golden-hour shadow bands, and ui-shell's
// X4-5 (S4-01, optional): a model swap asks for a frame. Pure logic and source reads: no DOM, no WebGL (the pixel line
// is tools/look-perf.mjs goldenclose / duskclose `edges.porch`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const G = await import('../public/js/render/ground.js');
const IDX = await import('../public/js/render/index.js');
const src = (f) => fs.readFileSync(new URL(`../public/js/render/${f}`, import.meta.url), 'utf8');

/** The PCF lookup cheapShadows builds for `kernel`: its tap offsets and the radius past which the second set counts. */
function lookup(kernel) {
  const keep = { ...G.SHADOW_KERNEL };
  Object.assign(G.SHADOW_KERNEL, kernel);
  try {
    const shader = { fragmentShader: '#include <shadowmap_pars_fragment>\nvoid main() {}' };
    G.cheapShadows(shader);
    const pcf = shader.fragmentShader.slice(shader.fragmentShader.indexOf('#if defined( SHADOWMAP_TYPE_PCF )'));
    const body = pcf.slice(pcf.indexOf('float getShadow( sampler2DShadow'), pcf.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )'));
    const at = body.search(/if \( shadowRadius > /);
    const offs = (s) => [...s.matchAll(/shadowCoord\.xy \+ vec2\( (-?[\d.]+), (-?[\d.]+) \) \* radius/g)].map((m) => [Number(m[1]), Number(m[2])]);
    return {
      body, key: G.shadowKernelKey(),
      base: offs(at < 0 ? body : body.slice(0, at)),
      wide: at < 0 ? [] : offs(body.slice(at)),
      above: at < 0 ? Infinity : Number(body.slice(at).match(/shadowRadius > ([\d.]+)/)[1]),
    };
  } finally { Object.assign(G.SHADOW_KERNEL, keep); }
}
/** The taps (texels) a pixel takes at shadow radius r. */
const tapsAt = (L, r) => (r > L.above ? [...L.base, ...L.wide] : L.base).map(([x, y]) => [x * r, y * r]);
/** Over every edge direction (0.5 degree steps): the widest gap between neighbouring taps' projections (each
 *  hardware-PCF tap ramps over about one texel, so a gap past 1 is a flat band that wide), its mean and its worst;
 *  and the spread (sd of the projections, the blur). */
function gaps(taps) {
  let worst = 0; let sum = 0; let n = 0; let sd = Infinity;
  for (let d = 0; d < 180; d += 0.5) {
    const t = d * Math.PI / 180;
    const p = taps.map(([x, y]) => x * Math.cos(t) + y * Math.sin(t)).sort((a, b) => a - b);
    let g = 0; for (let i = 1; i < p.length; i++) g = Math.max(g, p[i] - p[i - 1]);
    const m = p.reduce((a, b) => a + b, 0) / p.length;
    sd = Math.min(sd, Math.sqrt(p.reduce((a, b) => a + (b - m) ** 2, 0) / p.length));
    worst = Math.max(worst, g); sum += g; n++;
  }
  return { mean: sum / n, worst, sd };
}
// the desktop's kernel as index.js sets it before the first frame (HEAD: 4 taps, no wide set, no cap)
const DESK = { taps: 4, wideAbove: 0, maxRadius: Infinity, ...(G.SHADOW_WIDE || {}) };
const radius = (el) => (IDX.shadowRadiusFor ? IDX.shadowRadiusFor(3, el, DESK) : 3 * IDX.shadowSoftness(el, 4).radiusK);

test('R4-01: under the golden and dusk sun the desktop\'s taps sit at most 2 texels apart on average over every edge direction (bands of about a texel), and blur more than noon', () => {
  const L = lookup(DESK);
  const noon = gaps(tapsAt(L, radius(54)));
  assert.equal(radius(54), 3, 'noon: the High tier\'s own radius');
  for (const [name, el] of [['golden (the key\'s 24 degrees)', 24], ['dusk (20 degrees)', 20]]) {
    const r = radius(el); const g = gaps(tapsAt(L, r));
    // HEAD: golden r 5.22, 4 taps: mean 3.9 / worst 5.8 texels; dusk r 6: 4.5 / 6.7 (the tester's five flat levels)
    assert.ok(g.mean <= 2.0, `${name}: the widest gap between neighbouring taps ${g.mean.toFixed(2)} texels on average over every edge direction (r ${r.toFixed(2)}, ${tapsAt(L, r).length} taps; <= 2.0)`);
    assert.ok(g.worst <= 2.5, `${name}: ${g.worst.toFixed(2)} texels at the worst direction (<= 2.5)`);
    assert.ok(g.sd >= noon.sd, `${name}: still a softer edge than noon's (${g.sd.toFixed(2)} vs ${noon.sd.toFixed(2)} texels): R3-02's stairs stay hidden`);
  }
});

test('R4-01: one lookup on a desktop: the rotated grid, plus the grid turned 45 degrees past 3 texels of radius (a branch on the shadow\'s own uniform: no recompile at sunset); phones keep 4 taps', () => {
  assert.ok(G.SHADOW_WIDE, 'ground.js exports SHADOW_WIDE (the desktop\'s wide kernel)');
  const L = lookup(DESK);
  assert.deepEqual(L.base, [[-0.25, -0.75], [0.75, -0.25], [0.25, 0.75], [-0.75, 0.25]], 'the first four are R3-02\'s rotated grid (noon unchanged)');
  assert.equal(L.wide.length, 4, `four more taps (${L.wide.length})`);
  for (const [x, y] of L.wide) assert.ok(L.base.some(([a, b]) => Math.abs((a - b) * Math.SQRT1_2 - x) < 1e-3 && Math.abs((a + b) * Math.SQRT1_2 - y) < 1e-3), `(${x}, ${y}) is a base tap turned 45 degrees`);
  assert.ok(L.above > 3 && L.above < 3.2, `noon's radius 3 keeps 4 taps; the spread takes 8 (past ${L.above})`);
  assert.match(L.body, /shadow \*= 0\.25;/, 'the 4-tap mean');
  assert.match(L.body, /\* 0\.125;/, 'the 8-tap mean');
  assert.ok(!/interleavedGradientNoise\( gl_FragCoord/.test(L.body), 'no screen-space noise (visual-16\'s weave)');
  assert.match(L.key, /^t4w/, `its own program key (${L.key})`);
  const phone = lookup({ taps: 4, wideAbove: 0, maxRadius: Infinity });
  assert.equal(phone.base.length + phone.wide.length, 4, 'a phone\'s lookup is the 4-tap grid (G4 budget)');
  assert.equal(phone.key, 't4');
  const idx = src('index.js');
  assert.match(idx, /Object\.assign\(SHADOW_KERNEL, profile\.kind === 'desktop' \? SHADOW_WIDE : \{ wideAbove: 0, maxRadius: Infinity \}\)/, 'index.js sets it from the profile before the first frame');
  assert.match(idx, /R\.sun\.shadow\.radius = shadowRadiusFor\(/, 'the sky update takes the capped radius');
});

test('S4-01 (ui-shell X4-5): a model that swaps in for a placeholder asks for a frame, as the scenery and twins do', () => {
  const idx = src('index.js');
  const at = idx.indexOf('objects.onStaticChange(');
  assert.ok(at > 0, 'index.js listens to the objects view\'s static changes');
  const body = idx.slice(at, idx.indexOf('});', at));
  assert.match(body, /\bdirty = true\b/, `the listener sets dirty (HEAD: ${body.trim()})`);
});
