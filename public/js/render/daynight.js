// Day/night cycle (GDD §8.4, visual-ux-juice §3.10): cosmetic, shared (derived from server time only, so both
// screens show the same sky) and slow: a 40-minute cycle of 4 min dawn, 26 min day, 4 min dusk and 6 min
// moonlit night. Night is blue-lavender and never dark. Personal modes: 'cycle' (default), 'day' (always
// day) and 'real' (the local clock). Golden Hour (the co-op buff) tints the sky golden for its window.
// Owned by the render-world lane.
//
//   skyAt(now, { mode = 'cycle', localHour?, gold = 0, weather? }) -> Sky   pure (tested)
//     Sky: { phase, k, night, sunDir: [x,y,z], sunColor, sunI, hemiSky, hemiGround, hemiI, top, horizon, fog,
//            exposure, rim, windows }   colours are LINEAR rgb triples, light intensities in three units
//   phaseAt(now) -> { phase, k }    position in the 40-minute cycle
//   skyClock(now, createdAt) -> ms  the cycle runs from the farm's birth, offset so a new farm opens in morning
//                                   light whatever the wall clock (RD-04: "the farm fades in at golden light");
//                                   both screens share createdAt. phaseAt(skyClock(now, createdAt)) is THE phase.
//   CYCLE                           segment lengths (ms)
//   createDayNight({ scene, sun, hemi, sky, renderer }) -> dn
//     dn.update(now, opts) -> { changed, sunMoved }   applies skyAt() to the lights, sky, fog and exposure;
//                                     sunMoved when the sun stepped >= 0.5 degrees (static shadow refresh)
//     dn.current -> Sky
import * as THREE from 'three';

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
const K = {
  morning: { az: 170, el: 42, sun: '#FFE7C4', sunI: 2.5, hemiSky: '#D3E6FF', hemiGround: '#8C7A4B', hemiI: 1.35,
    top: '#5AAEF0', horizon: '#DDF2FF', fog: '#D9EFFA', exposure: 1.0, rim: 0.16 },
  noon: { az: 158, el: 54, sun: '#FFF1D6', sunI: 2.8, hemiSky: '#CFE8FF', hemiGround: '#8C7A4B', hemiI: 1.3,
    top: '#4FA8EE', horizon: '#D6F1FF', fog: '#D6EEF9', exposure: 1.0, rim: 0.16 },
  afternoon: { az: 140, el: 38, sun: '#FFE3B8', sunI: 2.6, hemiSky: '#D8E4F8', hemiGround: '#8F7748', hemiI: 1.25,
    top: '#56A2E8', horizon: '#E8EEE6', fog: '#E2EAE6', exposure: 1.0, rim: 0.2 },
  // dusk (RD-05, QA wave 2): a rose key light with blue shadows, not an orange wash
  dusk: { az: 128, el: 14, sun: '#F0A48C', sunI: 2.3, hemiSky: '#A9B2D8', hemiGround: '#6E5A52', hemiI: 1.1,
    top: '#6F86CF', horizon: '#F7B48E', fog: '#E9B9A2', exposure: 1.05, rim: 0.42 },
  // night (RD-05): a dim moon key and a blue #7889AD ambient: the farm reads as night (calm, blue, still readable)
  // and the warm windows and lanterns become the focal points; never the old grey-teal wash
  // wave 4 (owner wish 11: "nights a bit brighter"): a ~12 % brighter moon and ambient; the lamps light the rest
  night: { az: -20, el: 50, sun: '#B9C2EC', sunI: 1.38, hemiSky: '#9098C2', hemiGround: '#52527A', hemiI: 1.68,
    top: '#16224E', horizon: '#46508C', fog: '#3E4880', exposure: 1.4, rim: 0.24 },
  // dawn: pale peach light under a cool ambient
  dawn: { az: 195, el: 16, sun: '#F3CDB4', sunI: 1.9, hemiSky: '#C3CBE8', hemiGround: '#6E6258', hemiI: 1.2,
    top: '#7F9FDC', horizon: '#FFD7C2', fog: '#F0D3C6', exposure: 1.02, rim: 0.26 },
};
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
    s = k < 0.35 ? lerpKey(K.morning, K.noon, smooth(k / 0.35)) : lerpKey(K.noon, K.afternoon, smooth((k - 0.35) / 0.65));
  } else if (phase === 'dusk') {
    s = k < 0.6 ? lerpKey(K.afternoon, K.dusk, smooth(k / 0.6)) : lerpKey(K.dusk, K.night, smooth((k - 0.6) / 0.4));
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
  }
  const az = s.az * DEG;
  const el = s.el * DEG;
  const sunDir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  return {
    phase, k, night, sunDir, sunColor: s.sunColor, sunI: s.sunI, hemiSky: s.hemiSky, hemiGround: s.hemiGround,
    hemiI: s.hemiI, top: s.top, horizon: s.horizon, fog: s.fog, exposure: s.exposure, rim: s.rim,
    windows: Math.max(night, phase === 'dusk' ? smooth(Math.min(1, k / 0.6)) * 0.6 : 0),
  };
}

/** Angle in degrees between two unit vectors. */
export function angleDeg(a, b) {
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(d) / DEG;
}

const RIM_DAY = new THREE.Color('#FFE2B0');
const RIM_NIGHT = new THREE.Color('#A8B9E0');

export function createDayNight({ scene, sun, hemi, sky, renderer, look }) {
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
