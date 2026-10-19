// render-look, QA round 3 (docs/qa/release/qa-r3/fix-render-look.md): R3-02 golden-hour shadow edges, R3-03 the ?stats=1
// readout on phones. Pure logic and fakes: no DOM, no WebGL (the pixel and DOM lines are tools/look-perf.mjs --scene
// stats and the golden close frame).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const R = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });

// the HUD as measured at iPhone 13 (390 x 844) and 360 x 640 by look-perf --scene stats on the owners' late save
const LAYOUTS = {
  'iPhone 13': { readout: [228, 386], pill: R(287, 10, 384, 44), goals: R(4, 57, 262, 103), level: R(8, 8, 150, 40) },
  '360 x 640': { readout: [198, 356], pill: R(257, 10, 354, 44), goals: R(5, 58, 263, 100), level: R(8, 8, 140, 38) },
};

/** A fake page: the readout's rect follows its style.top (px, else the 4 px corner), the HUD's rects are fixed. */
function fakeDoc(layout) {
  const [left, right] = layout.readout;
  const obstacles = [layout.pill, layout.goals, layout.level].map((r) => ({ getBoundingClientRect: () => r }));
  return {
    defaultView: { innerHeight: 844 },
    createElement: () => {
      const el = { style: {}, textContent: '', setAttribute() {} };
      el.getBoundingClientRect = () => { const t = /^\d+(\.\d+)?px$/.test(el.style.top) ? parseFloat(el.style.top) : 4; return R(left, t, right, t + 17); };
      return el;
    },
    querySelectorAll: () => obstacles,
    body: { append() {} },
  };
}

test('R3-03: on a phone the ?stats=1 readout leaves the coin pill (and the goal row under it) uncovered', async () => {
  const { mountStatsHud } = await import('../public/js/render/stats-hud.js');
  for (const [name, layout] of Object.entries(LAYOUTS)) {
    const doc = fakeDoc(layout);
    const timers = [];
    const el = mountStatsHud({ search: '?stats=1', doc, stats: () => ({ fps: 30, tier: 'high', calls: 41 }), setInterval: (fn) => timers.push(fn) });
    timers[0]?.();
    const r = el.getBoundingClientRect();
    assert.ok(!hit(r, layout.pill), `${name}: the readout ${JSON.stringify([r.left, r.top, r.right, r.bottom])} is off the coin pill (HEAD: [${layout.readout[0]}, 4, ${layout.readout[1]}, 21] on it)`);
    assert.ok(!hit(r, layout.goals), `${name}: and off the goal row`);
    assert.ok(r.top < 140, `${name}: still up in the top row's corner (${r.top})`);
  }
});

test('R3-03: clearTop keeps a free corner (desktop) and steps under every control it would cover', async () => {
  const { clearTop } = await import('../public/js/render/stats-hud.js');
  assert.equal(typeof clearTop, 'function', 'stats-hud.js exports clearTop(rect, obstacles)');
  // desktop 1366 x 768: the pills end left of the readout's corner
  assert.equal(clearTop(R(1204, 4, 1362, 21), [R(1009, 22, 1159, 62), R(1181, 22, 1350, 62)]), 4);
  // iPhone 13: under the coin pill (44), then under the goal row (103)
  assert.equal(clearTop(R(228, 4, 386, 21), [R(287, 10, 384, 44), R(4, 57, 262, 103)]), 107);
  assert.equal(clearTop(R(228, 4, 386, 21), [R(287, 10, 384, 44)]), 48);
});

test('R3-02: the shadow lookup takes four taps on a rotated grid (two left the map\'s texels as stairs and a comb)', async () => {
  const THREE = await import('three');
  const G = await import('../public/js/render/ground.js');
  const RN = await import('../public/js/render/renderer.js');
  const taps = (n) => {
    if (G.SHADOW_KERNEL) G.SHADOW_KERNEL.taps = n;
    const shader = { fragmentShader: '#include <shadowmap_pars_fragment>\nvoid main() {}' };
    G.cheapShadows(shader);
    const pcf = shader.fragmentShader.slice(shader.fragmentShader.indexOf('#if defined( SHADOWMAP_TYPE_PCF )'));
    const body = pcf.slice(pcf.indexOf('float getShadow( sampler2DShadow'), pcf.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )'));
    return { n: (body.match(/texture\( shadowMap, vec3\(/g) || []).length, noise: /interleavedGradientNoise\( gl_FragCoord/.test(body) };
  };
  assert.ok(THREE.ShaderChunk.shadowmap_pars_fragment.includes('interleavedGradientNoise'), 'three\'s PCF chunk as patched');
  const desk = taps(4);
  assert.equal(desk.n, 4, `a desktop: four taps (HEAD: ${desk.n})`);
  assert.equal(desk.noise, false, 'no screen-space noise (the crowns\' weave, visual-16)');
  assert.equal(RN.PHONE_SHADOW_TAPS, 4, 'phones too (renderer.js PHONE_SHADOW_TAPS: the switch back is 2)');
  assert.equal(taps(2).n, 2, 'the switch back still builds the 2-tap lookup');
  if (G.SHADOW_KERNEL) G.SHADOW_KERNEL.taps = 4;
  assert.equal(typeof G.shadowKernelKey, 'function', 'the patch\'s program key follows the taps');
  assert.equal(G.shadowKernelKey(), 't4');
  const idx = (await import('node:fs')).readFileSync(new URL('../public/js/render/index.js', import.meta.url), 'utf8');
  assert.match(idx, /SHADOW_KERNEL\.taps = profile\.kind === 'desktop' \? 4 : PHONE_SHADOW_TAPS/, 'index.js picks the taps from the profile before the first frame');
  assert.ok(!/'hh-shadow2', cheapShadows, 'v1'\)/.test(idx), 'every patch site in index.js keys its program by the taps');
});

test('R3-02: under the golden sun (24 degrees) the 4-tap radius widens with the stretch; noon and the 2-tap rule', async () => {
  const IDX = await import('../public/js/render/index.js');
  assert.equal(typeof IDX.shadowSoftness, 'function', 'index.js exports shadowSoftness(el, taps)');
  const g = IDX.shadowSoftness(24, 4);
  assert.ok(g.radiusK > 1.7 && g.radiusK < 1.78, `golden: x${g.radiusK.toFixed(2)} (sin 45 / sin 24)`);
  assert.equal(g.intensity, 0.8, 'the shadows stay as dark (G2)');
  assert.equal(IDX.shadowSoftness(54, 4).radiusK, 1, 'noon: the tier\'s own radius');
  assert.equal(IDX.shadowSoftness(5, 4).radiusK, 2, 'capped at twice');
  // the 2-tap switch: a lighter shadow under a low sun instead of a wider one
  assert.equal(IDX.shadowSoftness(54, 2).intensity, 0.8);
  assert.ok(Math.abs(IDX.shadowSoftness(20, 2).intensity - 0.6) < 1e-9);
  assert.equal(IDX.shadowSoftness(24, 2).radiusK, 1);
});
