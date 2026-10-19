// render-look (release 1.0): the light (G2), the golden hour, dusk and night (G3), the colour grade (G5) and Harvey's
// sky presets (G13). Pure functions of the sky clock; the pixel thresholds live in tools/look-perf.mjs --check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as RN from '../public/js/render/renderer.js';
import * as DN from '../public/js/render/daynight.js';
import { applyLook } from '../public/js/mod/look.js';

const { skyAt, CYCLE } = DN;
const MIN = 60_000;
const base = Math.floor(Date.UTC(2026, 9, 14) / CYCLE.total) * CYCLE.total;
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function hueOf([r, g, b]) {
  const [R, G, B] = [r, g, b].map(toSrgb);
  const mx = Math.max(R, G, B); const mn = Math.min(R, G, B); const d = mx - mn;
  if (d <= 0) return 0;
  let h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
const elOf = (s) => Math.asin(s.sunDir[1]) * 180 / Math.PI;

/** Minutes per 40-minute cycle whose sun is golden: hue 25-45 degrees and elevation 10-25 degrees (critique#8). */
export function goldenMinutes(fn = skyAt) {
  let n = 0;
  const step = 0.1;
  for (let m = 0; m < 40; m += step) {
    const s = fn(base + m * MIN);
    const h = hueOf(s.sunColor); const el = elOf(s);
    if (h >= 25 && h <= 45 && el >= 10 && el <= 25) n++;
  }
  return n * step;
}

test('G3: at least 5 golden minutes in every 40-minute cycle (a pure count over the keyframe function)', () => {
  const g = goldenMinutes();
  assert.ok(g >= 5, `golden minutes per cycle: ${g.toFixed(1)}`);
});

test('G3: dusk is lit like an evening (exposure, fill, a sun at least 20 degrees up, >= 85 % of noon by the light model)', () => {
  // QA r1 R-05: dusk read as a second afternoon at graphics#5's exposure 1.25-1.3; it now has its own softer key under a
  // cool fill, lifted by the exposure (the scope's G3 lines are pixel lines: tools/look-perf.mjs)
  const dusk = skyAt(base + 32.4 * MIN);
  const noon = skyAt(base + 13 * MIN);
  const night = skyAt(base + 37 * MIN);
  assert.ok(dusk.exposure >= 1.25 && dusk.exposure <= 1.8, `dusk exposure ${dusk.exposure.toFixed(2)}`);
  assert.ok(dusk.hemiI >= 1.3, `dusk fill ${dusk.hemiI.toFixed(2)}`);
  assert.ok(elOf(dusk) >= 20, `dusk sun elevation ${elOf(dusk).toFixed(1)}`);
  const lit = (s) => (s.sunI * Math.max(0.25, s.sunDir[1]) + s.hemiI) * s.exposure;
  // (night's own darkening is in the ground and foliage shaders: look-perf --check compares the frames' pixels)
  void night;
  assert.ok(lit(dusk) >= 0.85 * lit(noon), `dusk ${(lit(dusk) / lit(noon) * 100).toFixed(0)} % of noon`);
});

test('G3: the night ground bounce leans blue-grey, not magenta (a red roof stays red: the pixel check is look-perf)', () => {
  const night = skyAt(base + 37 * MIN);
  const h = hueOf(night.hemiGround);
  assert.ok(h >= 200 && h <= 232, `night ground bounce hue ${h.toFixed(0)} (HEAD #52527A = 240, toward #4E5878 = 225)`);
});

test('G2: a stronger key and a lighter fill at noon (shadows and volumes read)', () => {
  const noon = skyAt(base + 13 * MIN);
  assert.ok(noon.sunI / noon.hemiI >= 2.6, `sun / fill ${(noon.sunI / noon.hemiI).toFixed(2)} (HEAD 2.15)`);
  assert.equal(RN.SHADOW_INTENSITY ?? null, 0.8, 'shadow intensity 0.8 (HEAD 0.62)');
});

test('G5: the grade lives in the tone-mapping chunk, its uniforms per phase; Low compiles it out', () => {
  assert.ok(RN.GRADE && RN.GRADE.uGradeVib && RN.GRADE.uGradeSplit && RN.GRADE.uGradeCurve, 'renderer.js exports the GRADE uniforms');
  assert.match(THREE.ShaderChunk.tonemapping_pars_fragment, /uniform float uGradeVib;[\s\S]*vec3 CustomToneMapping\( vec3 color \) \{[\s\S]*NeutralToneMapping/);
  const fake = () => ({ toneMapping: THREE.NeutralToneMapping, setPixelRatio() {}, shadowMap: {} });
  const sun = { castShadow: false, shadow: { mapSize: new THREE.Vector2(1, 1), radius: 0, map: null } };
  const r = fake(); RN.applyTier(r, sun, 'high'); assert.equal(r.toneMapping, THREE.CustomToneMapping, 'high grades');
  const m = fake(); RN.applyTier(m, sun, 'medium'); assert.equal(m.toneMapping, THREE.CustomToneMapping, 'medium grades');
  const l = fake(); RN.applyTier(l, sun, 'low'); assert.equal(l.toneMapping, THREE.NeutralToneMapping, 'low: Neutral only');
  const noon = skyAt(base + 13 * MIN); const night = skyAt(base + 37 * MIN);
  const rain = skyAt(base + 13 * MIN, { weather: { rain: 1, cloud: 1 } });
  for (const s of [noon, night, rain]) assert.ok(Number.isFinite(s.grade?.vib) && Number.isFinite(s.grade?.split) && Number.isFinite(s.grade?.curve), 'skyAt carries the grade');
  assert.ok(night.grade.split < noon.grade.split, 'a less warm split tone at night');
  assert.ok(rain.grade.vib < noon.grade.vib, 'less vibrance in the rain');
});

test('G5: the JS twin of the grade (portraits) lifts a quiet green more than a loud red and is Neutral at zero', () => {
  assert.equal(typeof RN.gradeRgb, 'function');
  const sat = ([r, g, b]) => { const mx = Math.max(r, g, b); return mx ? (mx - Math.min(r, g, b)) / mx : 0; };
  const green = [0.18, 0.3, 0.1];
  const out = RN.gradeRgb([...green], { vib: 0.35, split: 1, curve: 0.25 });
  assert.ok(sat(out) > sat(green), 'vibrance lifts a quiet green');
  const same = RN.gradeRgb([...green], { vib: 0, split: 0, curve: 0 });
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(same[i] - green[i]) < 1e-6, 'zero grade = identity');
});

test('G13: a Harvey sky preset reaches the light on the ground (fill, sun, fog, exposure), not only the unseen sky', () => {
  const plain = skyAt(base + 13 * MIN);
  try {
    applyLook({ sky: 'golden' });
    const gold = skyAt(base + 13 * MIN);
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    assert.ok(d(gold.hemiSky, plain.hemiSky) > 0.05, 'the fill takes the preset');
    assert.ok(d(gold.sunColor, plain.sunColor) > 0.03, 'the sun takes the preset');
    applyLook({ sky: 'stormy' });
    const storm = skyAt(base + 13 * MIN);
    assert.ok(storm.exposure < plain.exposure, 'a stormy preset dims the frame');
  } finally { applyLook(null); }
});

test('G5: phones draw the lite grade (no split tone: the cap is 0.8 ms on the phone buffer); desktops the full one', () => {
  assert.equal(typeof RN.setGradeVariant, 'function');
  try {
    assert.equal(RN.setGradeVariant('lite'), 'lite');
    assert.doesNotMatch(THREE.ShaderChunk.tonemapping_pars_fragment, /\* uGradeSplit;/, 'lite: no split tone');
    assert.match(THREE.ShaderChunk.tonemapping_pars_fragment, /uGradeVib \*/, 'lite keeps the vibrance');
    assert.match(THREE.ShaderChunk.tonemapping_pars_fragment, /uGradeCurve \)/, 'lite keeps the S-curve');
    assert.equal(RN.setGradeVariant('full'), 'full');
    assert.match(THREE.ShaderChunk.tonemapping_pars_fragment, /\* uGradeSplit;/, 'full: the split tone');
  } finally { RN.setGradeVariant('full'); }
});

