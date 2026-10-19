// Day/night cycle (GDD §8.4, visual-ux-juice §3.10): cosmetic, shared (derived from server time only, so both
// screens show the same sky) and slow: a 40-minute cycle of 4 min dawn, 26 min day, 4 min dusk and 6 min
// moonlit night. Night is blue-lavender and never dark. Personal modes: 'cycle' (default), 'day' (always
// day) and 'real' (the local clock). Golden Hour (the co-op buff) tints the sky golden for its window.
// Owned by the render-world lane.
//
//   skyAt(now, { mode = 'cycle', localHour?, gold = 0, weather? }) -> Sky   pure (tested)
//     Sky: { phase, k, night, sunDir: [x,y,z], sunColor, sunI, hemiSky, hemiGround, hemiI, top, horizon, fog,
//            exposure, rim, windows, grade: { vib, split, curve } }   colours are LINEAR rgb triples, light
//            intensities in three units; grade = the tone-mapping chunk's colour grade (renderer.js GRADE, release 1.0)
//   phaseAt(now) -> { phase, k }    position in the 40-minute cycle
//   skyClock(now, createdAt) -> ms  the cycle runs from the farm's birth, offset so a new farm opens in morning
//                                   light whatever the wall clock (RD-04: "the farm fades in at golden light");
//                                   both screens share createdAt. phaseAt(skyClock(now, createdAt)) is THE phase.
//   CYCLE                           segment lengths (ms)
//   createDayNight({ scene, sun, hemi, sky, renderer, look?, grade? }) -> dn   (grade: renderer.js GRADE uniforms)
//     dn.update(now, opts) -> { changed, sunMoved }   applies skyAt() to the lights, sky, fog and exposure;
//                                     sunMoved when the sun stepped >= 0.5 degrees (static shadow refresh)
//     dn.current -> Sky
import * as THREE from 'three';
// a mod's sky preset (Harness Hollow, docs/agent-notes/hh-mods.md): identity when no mod sets one
import { skyFilter, currentLook, SKY_PRESETS } from '../mod/look.js';

const MIN = 60_000;
export const CYCLE = Object.freeze({ dawn: 4 * MIN, day: 26 * MIN, dusk: 4 * MIN, night: 6 * MIN, total: 40 * MIN });
const ORDER = ['dawn', 'day', 'dusk', 'night'];

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** '#RRGGBB' -> linear rgb triple. */
export function hexLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smooth = (t) => t * t * (3 - 2 * t);
const DEG = Math.PI / 180;

// Keyframes. `az` is the sun azimuth in degrees around +Y measured from +X toward +Z; `el` its elevation.
// The base light comes from the upper left of the default camera (yaw 45 deg): offset (-50, 70, 20).
// Night (RD-04, visual-15): a brighter moon, a lavender ground bounce and more exposure, so the night frame keeps
// at least 60 % of noon's mean luminance ("never dark", GDD §8.4). Dusk (visual-14): a real orange sun and a
// strong warm rim, clearly not a dim noon.
// Release 1.0 (render-look; the measured why is in docs/agent-notes/rel-render-look.md): G2 more sun, less flat fill,
// a stronger rim; G3 a GOLDEN key (afternoon -> golden over day k 0.8-1, golden -> dusk over dusk k 0-0.5), an evening
// dusk (>= 85 % of noon), a blue-grey night bounce so red stays red, a golden dawn (>= 5 golden minutes a cycle);
// G5 `grade` per key (renderer.js GRADE).
const K = {
  morning: { az: 170, el: 42, sun: '#FFE7C4', sunI: 2.8, hemiSky: '#D3E6FF', hemiGround: '#8C7A4B', hemiI: 1.11,
    top: '#5AAEF0', horizon: '#DDF2FF', fog: '#D9EFFA', exposure: 1.0, rim: 0.27, grade: [0.26, 0.6, 0.15] },
  noon: { az: 158, el: 54, sun: '#FFF1D6', sunI: 3.14, hemiSky: '#CFE8FF', hemiGround: '#8C7A4B', hemiI: 1.07,
    top: '#4FA8EE', horizon: '#D6F1FF', fog: '#D6EEF9', exposure: 1.0, rim: 0.27, grade: [0.26, 0.6, 0.15] },
  afternoon: { az: 140, el: 34, sun: '#FFE3B8', sunI: 2.95, hemiSky: '#D8E4F8', hemiGround: '#8F7748', hemiI: 1.03,
    top: '#56A2E8', horizon: '#E8EEE6', fog: '#E2EAE6', exposure: 1.02, rim: 0.32, grade: [0.26, 0.6, 0.15] },
  // the golden key (graphics#5): the Golden Hour buff's light every cycle, at the hour the owners play
  // QA r1 R-05: exposure 1.05 (1.22 lifted golden over noon: "a late sunny afternoon")
  golden: { az: 132, el: 24, sun: '#FFD6A0', sunI: 4.9, hemiSky: '#D0DAF7', hemiGround: '#86704A', hemiI: 1.72,
    top: '#F2B55E', horizon: '#FFD7A0', fog: '#F3D6A8', exposure: 1.05, rim: 0.45, grade: [0.26, 0.7, 0.15] },
  // dusk (astra#2): the sun still 20 degrees up, a real fill and exposure: an evening, never darker than night. QA r1
  // R-05 (it read as a second afternoon): its own light, a softer orange key under a cool lavender fill and a harder
  // split tone (warm highlights, blue-violet shadows); the exposure holds it at >= 85 % of noon
  dusk: { az: 126, el: 20, sun: '#FFB45C', sunI: 3.0, hemiSky: '#A0A8E8', hemiGround: '#5E5470', hemiI: 2.0,
    top: '#6F86CF', horizon: '#F7B48E', fog: '#E9B9A2', exposure: 1.65, rim: 0.55, grade: [0.22, 1.3, 0.22] },
  // night (RD-05): a dim moon key and a blue ambient: the farm reads as night (calm, blue, still readable) and the warm
  // windows and lanterns become the focal points; wave 4 (owner wish 11): a ~12 % brighter moon and ambient. 1.0 (G3):
  // the ground bounce leans blue-grey (#4E5878), the fill a little less violet, so a red roof stays red
  night: { az: -20, el: 50, sun: '#B9C2EC', sunI: 1.38, hemiSky: '#949CBE', hemiGround: '#4E5878', hemiI: 1.62,
    top: '#16224E', horizon: '#46508C', fog: '#3E4880', exposure: 1.4, rim: 0.2, grade: [0.05, 0.1, 0.15] },
  // dawn: pale golden light under a cool ambient (its low sun counts as golden too)
  dawn: { az: 195, el: 16, sun: '#F6C9A0', sunI: 2.1, hemiSky: '#C3CBE8', hemiGround: '#6E6258', hemiI: 1.0,
    top: '#7F9FDC', horizon: '#FFD7C2', fog: '#F0D3C6', exposure: 1.04, rim: 0.36, grade: [0.2, 0.6, 0.2] },
};
/** The keyframes, for look-dev scripts and tools/look-perf.mjs --pre only (the game never writes them). */
export const SKY_KEYS = K;

// Golden Hour (RD-05, QA wave 2: "mustard"): the light does it, not a yellow grade on every material. A low, warm key
// (#FFD7A0, the sun 20 degrees lower: long shadows; a touch stronger so the lower sun still lights the ground) against
// a cool, weaker fill (#A8B7CE, 0.8 of noon), a golden sky; greens stay green (the ground and foliage grades are
// light: ground.js, world-uniforms.js)
const GOLD = { sun: '#FFD7A0', hemiSky: '#A8B7CE', top: '#F2B55E', horizon: '#FFD890', fog: '#F3D6A8', el: -20, az: 6 };

/** The sky's clock for a farm (see the header). */
export function skyClock(now, createdAt) {
  return Number.isFinite(createdAt) ? now - createdAt + CYCLE.dawn : now;
}

function lerpKey(a, b, t) {
  const c = (h1, h2) => mix3(hexLinear(h1), hexLinear(h2), t);
  return {
    az: mix(a.az, b.az, t), el: mix(a.el, b.el, t), sunColor: c(a.sun, b.sun), sunI: mix(a.sunI, b.sunI, t),
    hemiSky: c(a.hemiSky, b.hemiSky), hemiGround: c(a.hemiGround, b.hemiGround), hemiI: mix(a.hemiI, b.hemiI, t),
    top: c(a.top, b.top), horizon: c(a.horizon, b.horizon), fog: c(a.fog, b.fog),
    exposure: mix(a.exposure, b.exposure, t), rim: mix(a.rim, b.rim, t),
    grade: { vib: mix(a.grade[0], b.grade[0], t), split: mix(a.grade[1], b.grade[1], t), curve: mix(a.grade[2], b.grade[2], t) },
  };
}

/** Where `now` falls in the 40-minute cycle. */
export function phaseAt(now) {
  let p = ((now % CYCLE.total) + CYCLE.total) % CYCLE.total;
  for (const name of ORDER) {
    if (p < CYCLE[name]) return { phase: name, k: p / CYCLE[name] };
    p -= CYCLE[name];
  }
  return { phase: 'night', k: 1 };
}

/** The local clock mapped onto the same phases (dawn 5:30-7, day 7-19, dusk 19-20:30, night after). */
export function phaseAtHour(h) {
  const x = ((h % 24) + 24) % 24;
  if (x >= 5.5 && x < 7) return { phase: 'dawn', k: (x - 5.5) / 1.5 };
  if (x >= 7 && x < 19) return { phase: 'day', k: (x - 7) / 12 };
  if (x >= 19 && x < 20.5) return { phase: 'dusk', k: (x - 19) / 1.5 };
  const n = x >= 20.5 ? x - 20.5 : x + 3.5;
  return { phase: 'night', k: n / 9 };
}

/** The sky for a moment. Pure: same inputs, same sky on both screens. */
export function skyAt(now, { mode = 'cycle', localHour = null, gold = 0, weather = null } = {}) {
  let ph;
  if (mode === 'day') ph = { phase: 'day', k: 0.3 };
  else if (mode === 'real' && Number.isFinite(localHour)) ph = phaseAtHour(localHour);
  else ph = phaseAt(now);
  const { phase, k } = ph;
  let s;
  let night = 0;
  if (phase === 'day') {
    // G3: morning -> noon -> afternoon, then the afternoon turns golden over the day's last fifth (k 0.8-1)
    s = k < 0.35 ? lerpKey(K.morning, K.noon, smooth(k / 0.35))
      : k < 0.8 ? lerpKey(K.noon, K.afternoon, smooth((k - 0.35) / 0.45))
        : lerpKey(K.afternoon, K.golden, smooth((k - 0.8) / 0.2));
  } else if (phase === 'dusk') {
    // golden -> dusk over the first half, the dusk key held a moment, then the night comes in (k 0.6-1)
    s = k < 0.5 ? lerpKey(K.golden, K.dusk, smooth(k / 0.5)) : k < 0.6 ? lerpKey(K.dusk, K.dusk, 0) : lerpKey(K.dusk, K.night, smooth((k - 0.6) / 0.4));
    night = k < 0.6 ? 0 : smooth((k - 0.6) / 0.4);
  } else if (phase === 'night') {
    s = lerpKey(K.night, K.night, 0);
    night = 1;
  } else {
    s = k < 0.45 ? lerpKey(K.night, K.dawn, smooth(k / 0.45)) : lerpKey(K.dawn, K.morning, smooth((k - 0.45) / 0.55));
    night = k < 0.45 ? 1 - smooth(k / 0.45) : 0;
  }
  // Golden Hour: warm gold over whatever the cycle shows (stronger by day than at night).
  const g = Math.max(0, Math.min(1, gold)) * (1 - 0.5 * night);
  if (g > 0) {
    // the final release's measurement (V-04): the lower sun lights the ground less (sin el), and with a weaker fill the
    // Golden Hour frame came out 18 % DARKER than plain day and olive. The key now carries the warmth at full strength
    // (within RD-05's 1.2 x noon), the fill dips only a little, and the exposure lifts the frame to plain day's level
    s.sunColor = mix3(s.sunColor, hexLinear(GOLD.sun), g * 0.9);
    s.sunI *= 1 + 0.19 * g;
    s.el = Math.max(18, s.el + GOLD.el * g);
    s.az += GOLD.az * g;
    s.hemiSky = mix3(s.hemiSky, hexLinear(GOLD.hemiSky), g * 0.75);
    s.hemiI *= 1 - 0.03 * g;
    s.top = mix3(s.top, hexLinear(GOLD.top), g * 0.45);
    s.horizon = mix3(s.horizon, hexLinear(GOLD.horizon), g * 0.65);
    s.fog = mix3(s.fog, hexLinear(GOLD.fog), g * 0.35);
    s.rim += 0.26 * g;
    s.exposure *= 1 + 0.32 * g;
  }
  // Weather: rain greys the sky and softens the sun; cloudy dims a little.
  const rain = weather ? Math.max(0, Math.min(1, weather.rain || 0)) : 0;
  const cloud = weather ? Math.max(0, Math.min(1, weather.cloud || 0)) : 0;
  const grey = Math.max(rain, cloud * 0.45);
  if (grey > 0) {
    const greyOf = (c, lift) => { const l = 0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2]; return [l * lift, l * lift, l * lift * 1.06]; };
    // rain reads as rain (visual-13): a grey, soft-lit sky; the fill rises so it is never gloomy
    s.top = mix3(s.top, greyOf(s.top, 0.95), grey * 0.9);
    s.horizon = mix3(s.horizon, greyOf(s.horizon, 0.92), grey * 0.85);
    s.fog = mix3(s.fog, greyOf(s.fog, 0.9), grey * 0.85);
    s.sunI *= 1 - 0.6 * grey;
    s.hemiSky = mix3(s.hemiSky, greyOf(s.hemiSky, 0.92), grey * 0.7);
    s.hemiI *= 1 + 0.12 * grey;
    s.sunColor = mix3(s.sunColor, greyOf(s.sunColor, 1), grey * 0.5);
    s.exposure *= 1 - 0.06 * rain;
    // G5: a grey day is quieter (less vibrance, a softer split)
    s.grade = { vib: s.grade.vib * (1 - 0.6 * grey), split: s.grade.split * (1 - 0.4 * grey), curve: s.grade.curve };
  }
  const az = s.az * DEG;
  const el = s.el * DEG;
  const sunDir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  return presetLight(skyFilter({
    phase, k, night, sunDir, sunColor: s.sunColor, sunI: s.sunI, hemiSky: s.hemiSky, hemiGround: s.hemiGround,
    hemiI: s.hemiI, top: s.top, horizon: s.horizon, fog: s.fog, exposure: s.exposure, rim: s.rim, grade: s.grade,
    windows: Math.max(night, phase === 'dusk' ? smooth(Math.min(1, k / 0.6)) * 0.6 : 0),
  }));
}

// G13 (harvey#2): the farm camera never sees the sky, so a mod's sky preset (mod/look.js skyFilter: the sky, horizon
// and fog colours) would not show. Its colour also reaches the light on the ground: the fill and the sun lean toward
// the preset's horizon, the fog a little more, and the exposure follows its mood. The preset table stays harvey's
// (read only); the strength per preset here.
const PRESET_LIGHT = Object.freeze({
  golden: { k: 0.42, sun: 0.3, exposure: 1.06 },
  pastel: { k: 0.7, sun: 0.45, exposure: 1.08 },
  cool: { k: 0.75, sun: 0.55, exposure: 0.94 },
  stormy: { k: 0.45, sun: 0.4, exposure: 0.86 },
});
function presetLight(s) {
  const look = currentLook();
  const name = look && look.sky;
  const P = name && PRESET_LIGHT[name];
  const preset = P && SKY_PRESETS[name];
  if (!P || !preset || !preset.horizon) return s;
  const tint = hexLinear(preset.horizon[0]);
  // the tint keeps the light's own brightness: only its colour leans
  const lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const lean = (c, k) => { const l = lumOf(c); const t = lumOf(tint) || 1; return mix3(c, tint.map((v) => (v * l) / t), k); };
  return { ...s, hemiSky: lean(s.hemiSky, P.k), sunColor: lean(s.sunColor, P.sun), fog: mix3(s.fog, tint, P.k * 0.5),
    exposure: s.exposure * P.exposure };
}

/** Angle in degrees between two unit vectors. */
export function angleDeg(a, b) {
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(d) / DEG;
}

const RIM_DAY = new THREE.Color('#FFE2B0');
const RIM_NIGHT = new THREE.Color('#A8B9E0');

export function createDayNight({ scene, sun, hemi, sky, renderer, look, grade = null }) {
  let current = null;
  let shadowDir = null;
  return {
    get current() { return current; },
    update(now, opts = {}) {
      const s = skyAt(now, opts);
      current = s;
      sun.color.setRGB(...s.sunColor);
      sun.intensity = s.sunI;
      hemi.color.setRGB(...s.hemiSky);
      hemi.groundColor.setRGB(...s.hemiGround);
      hemi.intensity = s.hemiI;
      if (scene.fog) scene.fog.color.setRGB(...s.fog);
      if (sky) sky.set(s);
      renderer.toneMappingExposure = s.exposure;
      if (grade && s.grade) {
        grade.uGradeVib.value = s.grade.vib;
        grade.uGradeSplit.value = s.grade.split;
        grade.uGradeCurve.value = s.grade.curve;
      }
      if (look) {
        look.uRim.value = s.rim;
        // a blue-lavender edge light by night models the farm without lifting the whole frame (visual-after D3)
        if (look.uRimColor) look.uRimColor.value.copy(RIM_DAY).lerp(RIM_NIGHT, s.night);
      }
      let sunMoved = false;
      if (!shadowDir || angleDeg(shadowDir, s.sunDir) >= 0.5) { shadowDir = s.sunDir; sunMoved = true; }
      return { sunMoved, sunDir: shadowDir };
    },
  };
}
