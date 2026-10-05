// Renders every sound effect, instrument sample and ambience loop of Harvest Hollow to WAV with a small offline
// DSP kit (no samples, no dependencies; the approach of ~/wow-arena/tools/make-sfx.js). Deterministic: a fixed
// seed, so a re-run produces byte-identical files.
//
//   node tools/make-sfx.mjs            -> public/assets/audio/*.wav + *.ogg (Opus) + public/assets/audio/manifest.json
//   node tools/make-sfx.mjs --no-ogg   WAVs only (no Chrome needed; the manifest then lists no .ogg)
//   node tools/make-sfx.mjs --list     print the names only
//
// GDD §8.5 / visual-ux-juice §3.11: SFX are 70-150 ms where possible, soft, never harsh; the invalid "bonk" is a
// round wooden knock, never a buzzer. Instruments are single notes the runtime pitches with playbackRate for the
// generative music (public/js/audio.js): pluck (fingerpicked guitar), banjo, bass (upright), mallet
// (glockenspiel), marimba, piano (night). Ambience loops crossfade seamlessly (end blended into start).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 32000;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'assets', 'audio');

let seed = 0x48484f4c;                                   // 'HHOL'
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const TAU = Math.PI * 2;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// ---- envelopes ---------------------------------------------------------------------------------------------
const expDecay = (tau) => (t) => Math.exp(-t / tau);
/** attack (s) then exponential decay with time constant tau */
const ad = (a, tau) => (t) => (t < a ? t / a : Math.exp(-(t - a) / tau));
/** attack, hold at 1, release over r, total dur */
const ahr = (a, dur, r) => (t) => (t < a ? t / a : t > dur - r ? Math.max(0, (dur - t) / r) : 1);
/** smooth bell-shaped swell over dur */
const swell = (dur) => (t) => Math.sin(Math.PI * clamp01(t / dur)) ** 2;

// ---- generators (all ADD into `out`) -------------------------------------------------------------------------
/** Oscillator with an exponential pitch glide f0 -> f1 over dur, optional vibrato. */
function osc(out, { type = 'sine', f0 = 440, f1 = f0, dur = 0.3, gain = 0.3, start = 0, env = expDecay(dur / 4),
  vib = 0, vibRate = 6, glide = null, phase0 = 0 }) {
  let phase = phase0;
  const n0 = Math.floor(start * SR);
  for (let i = 0; i < dur * SR && n0 + i < out.length; i++) {
    const t = i / SR;
    const k = glide ? glide(clamp01(t / dur)) : clamp01(t / dur);
    const f = f0 * (f1 / f0) ** k * (1 + vib * Math.sin(TAU * vibRate * t));
    phase += f / SR;
    const p = phase % 1;
    let v;
    switch (type) {
      case 'saw': v = 2 * p - 1; break;
      case 'square': v = p < 0.5 ? 1 : -1; break;
      case 'tri': v = 4 * Math.abs(p - 0.5) - 1; break;
      case 'pulse': v = p < 0.25 ? 1 : -0.33; break;
      default: v = Math.sin(TAU * p);
    }
    out[n0 + i] += v * gain * env(t);
  }
}

/**
 * Biquad (RBJ cookbook) as a function x -> y, with `.tune(f, q?)` to retune the coefficients WITHOUT resetting the
 * delay state (a sweep must not click). type: lp | hp | bp | peak
 */
function biquad(type, f, q, gainDb = 0) {
  let b0, b1, b2, a1, a2;
  let qq = q;
  const tune = (freq, nq = qq) => {
    qq = nq;
    const w0 = (TAU * Math.min(freq, SR * 0.45)) / SR;
    const alpha = Math.sin(w0) / (2 * qq);
    const cw = Math.cos(w0);
    const A = 10 ** (gainDb / 40);
    let c0, c1, c2, d0, d1, d2;
    if (type === 'lp') { c0 = (1 - cw) / 2; c1 = 1 - cw; c2 = (1 - cw) / 2; d0 = 1 + alpha; d1 = -2 * cw; d2 = 1 - alpha; }
    else if (type === 'hp') { c0 = (1 + cw) / 2; c1 = -(1 + cw); c2 = (1 + cw) / 2; d0 = 1 + alpha; d1 = -2 * cw; d2 = 1 - alpha; }
    else if (type === 'peak') { c0 = 1 + alpha * A; c1 = -2 * cw; c2 = 1 - alpha * A; d0 = 1 + alpha / A; d1 = -2 * cw; d2 = 1 - alpha / A; }
    else { c0 = alpha; c1 = 0; c2 = -alpha; d0 = 1 + alpha; d1 = -2 * cw; d2 = 1 - alpha; }
    b0 = c0 / d0; b1 = c1 / d0; b2 = c2 / d0; a1 = d1 / d0; a2 = d2 / d0;
  };
  tune(f, q);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const fn = (x0) => {
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    return y0;
  };
  fn.tune = tune;
  return fn;
}

/** Filtered noise with a sweeping centre frequency (retuned every 16 samples, state kept: no zipper noise). */
function noise(out, { dur = 0.3, f0 = 1000, f1 = f0, q = 1, type = 'bp', gain = 0.3, start = 0, env = expDecay(dur / 4),
  color = 'white' }) {
  const n0 = Math.floor(start * SR);
  const filt = biquad(type, f0, q);
  let brown = 0;
  for (let i = 0; i < dur * SR && n0 + i < out.length; i++) {
    const t = i / SR;
    if (f1 !== f0 && i % 16 === 0) filt.tune(f0 * (f1 / f0) ** clamp01(t / dur));
    let x = rnd() * 2 - 1;
    if (color === 'brown') { brown = (brown + 0.02 * x) / 1.02; x = brown * 3.5; }
    out[n0 + i] += filt(x) * gain * env(t);
  }
}

/** Karplus-Strong plucked string: bright = 0..1 (pick position / damping), decay multiplier per period. */
function pluck(out, { f = 220, dur = 1.5, gain = 0.4, start = 0, bright = 0.5, decay = 0.996, body = true }) {
  const n0 = Math.floor(start * SR);
  const N = Math.max(2, Math.round(SR / f));
  const line = new Float32Array(N);
  // excitation: filtered noise burst (darker for lower `bright`)
  let lp = 0;
  for (let i = 0; i < N; i++) { lp += (rnd() * 2 - 1 - lp) * (0.25 + 0.7 * bright); line[i] = lp; }
  let idx = 0;
  let prev = 0;
  const bodyF = body ? biquad('peak', 180, 1.2, 5) : (x) => x;
  const air = body ? biquad('peak', 2400, 1.0, 2) : (x) => x;
  const total = Math.floor(dur * SR);
  for (let i = 0; i < total && n0 + i < out.length; i++) {
    const cur = line[idx];
    const nxt = (cur + prev) * 0.5 * decay;              // averaging lowpass in the loop
    prev = cur;
    line[idx] = nxt;
    idx = (idx + 1) % N;
    const fade = i > total - SR * 0.03 ? (total - i) / (SR * 0.03) : 1;
    out[n0 + i] += air(bodyF(cur)) * gain * fade;
  }
}

/** Additive partials (ratio, amp, decay tau) — bells, mallets, piano. */
function partials(out, { f = 440, list, dur = 1, gain = 0.3, start = 0, attack = 0.002 }) {
  for (const [ratio, amp, tau] of list) {
    osc(out, { f0: f * ratio, dur, gain: gain * amp, start, env: ad(attack, tau), phase0: rnd() });
  }
}

/** FM bell: carrier f, modulator f*ratio, index decaying with the amplitude. */
function fmBell(out, { f = 880, ratio = 1.4, index = 3, dur = 1, gain = 0.3, start = 0, tau = 0.4 }) {
  const n0 = Math.floor(start * SR);
  let pc = 0;
  let pm = 0;
  for (let i = 0; i < dur * SR && n0 + i < out.length; i++) {
    const t = i / SR;
    const e = t < 0.002 ? t / 0.002 : Math.exp(-t / tau);
    pm += (f * ratio) / SR;
    pc += f / SR;
    out[n0 + i] += Math.sin(TAU * pc + index * e * Math.sin(TAU * pm)) * gain * e;
  }
}

/** Formant voice: a glottal-ish pulse train through parallel band-passes (animal calls). */
function voice(out, { f0 = 200, f1 = f0, dur = 0.5, gain = 0.3, start = 0, env = ahr(0.02, 0.5, 0.15), formants = [[700, 6, 1], [1200, 8, 0.6]],
  vib = 0, vibRate = 6, glide = null, breath = 0.05 }) {
  const n0 = Math.floor(start * SR);
  const bank = formants.map(([f, q, a]) => ({ fn: biquad('bp', f, q), a }));
  let phase = 0;
  for (let i = 0; i < dur * SR && n0 + i < out.length; i++) {
    const t = i / SR;
    const k = glide ? glide(clamp01(t / dur)) : clamp01(t / dur);
    const f = f0 * (f1 / f0) ** k * (1 + vib * Math.sin(TAU * vibRate * t));
    phase += f / SR;
    const p = phase % 1;
    const src = (p < 0.4 ? Math.sin((Math.PI * p) / 0.4) : 0) * 2 - 0.5 + breath * (rnd() * 2 - 1);
    let y = 0;
    for (const b of bank) y += b.fn(src) * b.a;
    out[n0 + i] += y * gain * env(t);
  }
}

/** Short broadband click (transients). */
function click(out, { start = 0, gain = 0.3, f = 3000, len = 0.004 }) {
  const n0 = Math.floor(start * SR);
  const n = Math.floor(len * SR);
  const hp = biquad('hp', f, 0.7);
  for (let i = 0; i < n && n0 + i < out.length; i++) out[n0 + i] += hp(rnd() * 2 - 1) * gain * (1 - i / n) ** 2;
}

// ---- post -----------------------------------------------------------------------------------------------------
/** Small-room Schroeder reverb; returns a longer buffer. */
function reverb(inp, { wet = 0.2, decay = 0.72, tail = 0.6, damp = 0.35 } = {}) {
  const out = new Float32Array(inp.length + Math.floor(tail * SR));
  out.set(inp);
  const scale = SR / 44100;
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d: Math.round(d * scale), b: new Float32Array(Math.round(d * scale)), i: 0, lp: 0 }));
  const aps = [225, 556].map((d) => ({ d: Math.round(d * scale), b: new Float32Array(Math.round(d * scale)), i: 0 }));
  for (let n = 0; n < out.length; n++) {
    const x = n < inp.length ? inp[n] : 0;
    let s = 0;
    for (const c of combs) {
      const y = c.b[c.i];
      c.lp = y * (1 - damp) + c.lp * damp;
      c.b[c.i] = x + c.lp * decay;
      c.i = (c.i + 1) % c.d;
      s += y;
    }
    s /= combs.length;
    for (const a of aps) { const y = a.b[a.i]; const v = s + y * 0.5; a.b[a.i] = v; a.i = (a.i + 1) % a.d; s = y - 0.5 * v; }
    out[n] = out[n] * (1 - wet * 0.4) + s * wet;
  }
  return out;
}
const lowpass = (o, f, q = 0.707) => { const fl = biquad('lp', f, q); for (let i = 0; i < o.length; i++) o[i] = fl(o[i]); return o; };
const highpass = (o, f, q = 0.707) => { const fl = biquad('hp', f, q); for (let i = 0; i < o.length; i++) o[i] = fl(o[i]); return o; };
const softClip = (o, drive = 1) => { for (let i = 0; i < o.length; i++) o[i] = Math.tanh(o[i] * drive); return o; };
const normalize = (o, peak = 0.89) => { let m = 0; for (const v of o) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < o.length; i++) o[i] *= peak / m; return o; };
/** Trim trailing near-silence (keeps files small) and fade the last 15 ms. */
function trim(o, floor = 0.0015) {
  let end = o.length;
  while (end > SR * 0.05 && Math.abs(o[end - 1]) < floor) end--;
  const r = o.slice(0, Math.min(o.length, end + Math.floor(SR * 0.01)));
  const n = Math.min(r.length, Math.floor(SR * 0.015));
  for (let i = 0; i < n; i++) r[r.length - 1 - i] *= i / n;
  return r;
}
/** Make a loop seamless: crossfade the last `xf` seconds into the beginning; returns the shortened loop. */
function seamless(o, xf = 0.5) {
  const n = Math.floor(xf * SR);
  const len = o.length - n;
  const r = o.slice(0, len);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    r[i] = r[i] * Math.sqrt(k) + o[len + i] * Math.sqrt(1 - k);
  }
  return r;
}
/** Final mix: remove DC (Karplus-Strong excitations carry some), normalise to `peak`, trim the silent tail. */
const mixTo = (o, peak) => trim(normalize(highpass(o, 25), peak));

// ---- the sounds -----------------------------------------------------------------------------------------------
// Each entry: () => Float32Array. `peak` levels are set by ear relative to each other (UI softest, fanfares loudest).
const C5 = hz(72);
const SOUNDS = {
  // Farming ---------------------------------------------------------------------------------------------------
  plant: () => {                                      // soil squash + seed tick
    const o = buf(0.22);
    noise(o, { dur: 0.16, f0: 420, f1: 160, q: 0.9, type: 'lp', gain: 0.9, env: ad(0.006, 0.05), color: 'brown' });
    osc(o, { f0: 150, f1: 85, dur: 0.12, gain: 0.35, env: ad(0.004, 0.04) });
    osc(o, { f0: 2300, f1: 1700, dur: 0.035, gain: 0.12, start: 0.025, env: ad(0.001, 0.012) });
    click(o, { start: 0.024, gain: 0.08, f: 4000 });
    return mixTo(o, 0.55);
  },
  pluck: () => {                                      // harvest pitch ladder base note (C5); runtime pitches it
    const o = buf(0.55);
    pluck(o, { f: C5, dur: 0.55, gain: 0.7, bright: 0.75, decay: 0.993 });
    osc(o, { f0: C5 * 2, dur: 0.12, gain: 0.08, env: ad(0.002, 0.05) });
    return mixTo(reverb(o, { wet: 0.12, tail: 0.25 }), 0.6);
  },
  pop: () => {                                        // plants pop out of the soil
    const o = buf(0.14);
    osc(o, { f0: 260, f1: 980, dur: 0.07, gain: 0.5, env: ad(0.002, 0.025), glide: (k) => k ** 0.5 });
    click(o, { start: 0, gain: 0.12, f: 2500 });
    noise(o, { dur: 0.08, f0: 900, q: 0.8, gain: 0.15, env: ad(0.002, 0.02) });
    return mixTo(o, 0.5);
  },
  water: () => {                                      // watering-can plinks
    const o = buf(0.45);
    noise(o, { dur: 0.35, f0: 4500, f1: 2500, q: 0.7, type: 'bp', gain: 0.18, env: swell(0.35) });
    [0, 0.07, 0.15, 0.22].forEach((s, i) => {
      const f = 700 + rnd() * 500 + i * 60;
      osc(o, { f0: f, f1: f * 2.1, dur: 0.06, gain: 0.32, start: s, env: ad(0.002, 0.018), glide: (k) => k ** 0.6 });
    });
    return mixTo(reverb(o, { wet: 0.15, tail: 0.2 }), 0.5);
  },
  compost: () => {                                    // soft, earthy thud
    const o = buf(0.25);
    noise(o, { dur: 0.2, f0: 300, f1: 120, q: 0.8, type: 'lp', gain: 1, env: ad(0.008, 0.06), color: 'brown' });
    osc(o, { f0: 95, f1: 60, dur: 0.18, gain: 0.5, env: ad(0.005, 0.06) });
    return mixTo(o, 0.55);
  },
  uproot: () => {                                     // root yank + pop
    const o = buf(0.3);
    noise(o, { dur: 0.16, f0: 300, f1: 1400, q: 1.5, type: 'bp', gain: 0.6, env: ad(0.01, 0.06) });
    osc(o, { f0: 180, f1: 420, dur: 0.14, gain: 0.25, env: ad(0.01, 0.05), type: 'tri' });
    osc(o, { f0: 330, f1: 1100, dur: 0.06, gain: 0.4, start: 0.15, env: ad(0.002, 0.02) });
    click(o, { start: 0.15, gain: 0.15 });
    return mixTo(o, 0.5);
  },
  shake: () => {                                      // tree rustle + two fruit bounces
    const o = buf(0.8);
    const n = buf(0.6);
    noise(n, { dur: 0.6, f0: 3200, f1: 5200, q: 0.6, gain: 0.5, env: swell(0.6) });
    for (let i = 0; i < n.length; i++) n[i] *= 0.55 + 0.45 * Math.sin((TAU * 13 * i) / SR + Math.sin((TAU * 3 * i) / SR));
    o.set(n);
    [0.32, 0.5].forEach((s, i) => osc(o, { f0: 210 - i * 30, f1: 120, dur: 0.12, gain: 0.45 - i * 0.15, start: s, env: ad(0.003, 0.03) }));
    return mixTo(o, 0.5);
  },
  chop1: () => chop(240),
  chop2: () => chop(205),
  chop3: () => chop(275),
  poof: () => {                                       // debris disappears
    const o = buf(0.4);
    noise(o, { dur: 0.35, f0: 2400, f1: 250, q: 0.7, type: 'lp', gain: 0.9, env: ad(0.01, 0.1) });
    osc(o, { f0: 420, f1: 900, dur: 0.12, gain: 0.12, start: 0.02, env: ad(0.003, 0.04) });
    return mixTo(o, 0.5);
  },
  weed: () => {                                       // weed pull: zip + tiny pop
    const o = buf(0.25);
    noise(o, { dur: 0.12, f0: 800, f1: 4200, q: 2, gain: 0.5, env: ad(0.005, 0.04) });
    osc(o, { f0: 500, f1: 1300, dur: 0.05, gain: 0.35, start: 0.11, env: ad(0.002, 0.018) });
    return mixTo(o, 0.48);
  },
  build: () => {                                      // wood thunk + dust
    const o = buf(0.5);
    pluck(o, { f: 165, dur: 0.35, gain: 0.8, bright: 0.25, decay: 0.95, body: true });
    osc(o, { f0: 120, f1: 60, dur: 0.25, gain: 0.6, env: ad(0.003, 0.07) });
    noise(o, { dur: 0.3, f0: 600, f1: 300, q: 0.6, type: 'lp', gain: 0.35, start: 0.02, env: ad(0.02, 0.1), color: 'brown' });
    click(o, { gain: 0.25, f: 1800, len: 0.006 });
    return mixTo(reverb(o, { wet: 0.12, tail: 0.25 }), 0.75);
  },
  munch: () => {                                      // three crunchy bites
    const o = buf(0.45);
    [0, 0.13, 0.27].forEach((s) => {
      noise(o, { dur: 0.08, f0: 1800 + rnd() * 600, q: 1.1, gain: 0.7, start: s, env: ad(0.004, 0.025) });
      osc(o, { f0: 140, f1: 90, dur: 0.05, gain: 0.25, start: s, env: ad(0.002, 0.02) });
    });
    return mixTo(o, 0.45);
  },
  hop: () => {                                        // happy jig hop
    const o = buf(0.25);
    osc(o, { f0: 330, f1: 660, dur: 0.1, gain: 0.35, env: ad(0.003, 0.04), type: 'tri' });
    osc(o, { f0: 440, f1: 880, dur: 0.1, gain: 0.3, start: 0.11, env: ad(0.003, 0.04), type: 'tri' });
    return mixTo(o, 0.4);
  },
  // Animals -----------------------------------------------------------------------------------------------------
  cluck: () => {                                      // "buk-buk-bukaak"
    const o = buf(0.62);
    const syl = [[0, 0.07, 620, 520], [0.11, 0.07, 640, 540], [0.24, 0.22, 600, 820]];
    for (const [s, d, a, b] of syl) {
      voice(o, { f0: a, f1: b, dur: d, gain: 0.5, start: s, env: ahr(0.006, d, d * 0.5),
        formants: [[1100, 5, 1], [2300, 7, 0.55], [3400, 9, 0.2]], breath: 0.15, glide: (k) => (b > a ? k ** 2 : k) });
    }
    return mixTo(o, 0.5);
  },
  moo: () => {                                        // a friendly cartoon moo
    const o = buf(1.0);
    voice(o, { f0: 118, f1: 96, dur: 0.95, gain: 0.6, env: ahr(0.12, 0.95, 0.35), vib: 0.012, vibRate: 5,
      formants: [[330, 4, 1], [720, 5, 0.6], [2400, 8, 0.08]], glide: (k) => Math.sin(k * Math.PI * 0.8), breath: 0.03 });
    voice(o, { f0: 236, f1: 192, dur: 0.95, gain: 0.12, env: ahr(0.15, 0.95, 0.35), formants: [[600, 4, 1]] });
    return mixTo(lowpass(o, 3500), 0.55);
  },
  baa: () => {                                        // a bleat with tremolo
    const o = buf(0.7);
    voice(o, { f0: 390, f1: 350, dur: 0.62, gain: 0.55, env: (t) => ahr(0.03, 0.62, 0.2)(t) * (0.72 + 0.28 * Math.sin(TAU * 9 * t)),
      vib: 0.03, vibRate: 9, formants: [[820, 5, 1], [1250, 6, 0.7], [2600, 8, 0.25]], breath: 0.08 });
    return mixTo(o, 0.5);
  },
  rooster: () => {                                    // cock-a-doodle-doo at dawn
    const o = buf(1.35);
    const syl = [[0, 0.12, 700, 800], [0.15, 0.12, 820, 900], [0.3, 0.16, 900, 1050], [0.5, 0.75, 1050, 760]];
    for (const [s, d, a, b] of syl) {
      voice(o, { f0: a, f1: b, dur: d, gain: 0.45, start: s, env: ahr(0.015, d, Math.min(0.25, d * 0.5)), vib: 0.02, vibRate: 11,
        formants: [[1400, 4, 1], [2600, 6, 0.5]], breath: 0.12 });
    }
    return mixTo(reverb(o, { wet: 0.2, tail: 0.5 }), 0.45);
  },
  // Buildings and production -------------------------------------------------------------------------------------
  done: () => {                                       // a recipe is ready: two glock notes
    const o = buf(0.9);
    mallet(o, hz(79), 0, 0.5);
    mallet(o, hz(84), 0.12, 0.6);
    return mixTo(reverb(o, { wet: 0.2, tail: 0.4 }), 0.5);
  },
  craft: () => {                                      // a recipe starts: bubbling pot + soft whoosh
    const o = buf(0.6);
    noise(o, { dur: 0.3, f0: 600, f1: 1800, q: 0.7, gain: 0.25, env: swell(0.3) });
    for (let i = 0; i < 6; i++) {
      const f = 300 + rnd() * 400;
      osc(o, { f0: f, f1: f * 1.8, dur: 0.05, gain: 0.25, start: 0.1 + i * 0.07 + rnd() * 0.03, env: ad(0.003, 0.015) });
    }
    return mixTo(o, 0.45);
  },
  // Economy -------------------------------------------------------------------------------------------------------
  coin: () => {                                       // one coin: a two-note "bling"
    const o = buf(0.4);
    partials(o, { f: hz(95), list: [[1, 1, 0.08], [2.76, 0.4, 0.05], [5.4, 0.15, 0.03]], dur: 0.12, gain: 0.35 });
    partials(o, { f: hz(100), list: [[1, 1, 0.14], [2.76, 0.4, 0.08], [5.4, 0.15, 0.04]], dur: 0.35, gain: 0.35, start: 0.06 });
    return mixTo(o, 0.42);
  },
  register: () => {                                   // cash-register ding + drawer
    const o = buf(1.0);
    noise(o, { dur: 0.18, f0: 900, f1: 500, q: 0.8, gain: 0.35, env: ad(0.01, 0.06) });
    click(o, { start: 0.12, gain: 0.3, f: 2500, len: 0.008 });
    fmBell(o, { f: hz(96), ratio: 2.01, index: 2.5, dur: 0.9, gain: 0.45, start: 0.14, tau: 0.32 });
    fmBell(o, { f: hz(103), ratio: 2.01, index: 1.5, dur: 0.6, gain: 0.15, start: 0.14, tau: 0.2 });
    return mixTo(reverb(o, { wet: 0.15, tail: 0.3 }), 0.34);   // frequent (every sale): bright, not loud
  },
  acorn: () => {                                      // Acorn twinkle
    const o = buf(0.5);
    mallet(o, hz(91), 0, 0.3, 0.35);
    mallet(o, hz(96), 0.07, 0.4, 0.35);
    return mixTo(reverb(o, { wet: 0.25, tail: 0.3 }), 0.4);
  },
  xp: () => {                                         // soft XP sparkle
    const o = buf(0.35);
    [84, 88, 91].forEach((m, i) => osc(o, { f0: hz(m), dur: 0.2, gain: 0.25, start: i * 0.035, env: ad(0.002, 0.06) }));
    noise(o, { dur: 0.2, f0: 7000, q: 0.8, type: 'hp', gain: 0.05, env: ad(0.01, 0.05) });
    return mixTo(o, 0.32);
  },
  order: () => {                                      // order delivered: truck honk + engine away
    const o = buf(1.5);
    const honk = (s) => { const h = buf(0.2); osc(h, { type: 'square', f0: 392, dur: 0.16, gain: 0.25, env: ahr(0.005, 0.16, 0.04) });
      osc(h, { type: 'square', f0: 494, dur: 0.16, gain: 0.2, env: ahr(0.005, 0.16, 0.04) }); lowpass(h, 1600); for (let i = 0; i < h.length; i++) o[Math.floor(s * SR) + i] += h[i]; };
    honk(0); honk(0.22);
    osc(o, { type: 'saw', f0: 55, f1: 75, dur: 1.1, gain: 0.25, start: 0.4, env: (t) => swell(1.1)(t) * (0.7 + 0.3 * Math.sin(TAU * 18 * t)) });
    return mixTo(lowpass(o, 2200), 0.55);
  },
  // Progress -------------------------------------------------------------------------------------------------------
  levelup: () => {                                    // 1.5 s fanfare at 240 BPM
    const o = buf(2.0);
    const step = 0.125;
    [72, 76, 79, 84].forEach((m, i) => { pluck(o, { f: hz(m), dur: 0.6, gain: 0.45, start: i * step, bright: 0.8, decay: 0.995 }); mallet(o, hz(m + 12), i * step, 0.5, 0.25); });
    const brass = buf(1.3);
    for (const m of [60, 64, 67, 72]) {
      osc(brass, { type: 'saw', f0: hz(m), dur: 1.25, gain: 0.12, env: ahr(0.06, 1.25, 0.5), vib: 0.004, vibRate: 5.5 });
      osc(brass, { type: 'saw', f0: hz(m) * 1.004, dur: 1.25, gain: 0.08, env: ahr(0.06, 1.25, 0.5) });
    }
    lowpass(brass, 2400, 0.9);
    for (let i = 0; i < brass.length; i++) o[Math.floor(0.5 * SR) + i] += brass[i];
    [84, 88, 91, 96].forEach((m, i) => mallet(o, hz(m), 0.5 + i * 0.06, 0.8, 0.22));
    noise(o, { dur: 1.0, f0: 8000, q: 0.7, type: 'hp', gain: 0.06, start: 0.5, env: ad(0.05, 0.3) });
    return mixTo(reverb(o, { wet: 0.22, tail: 0.6 }), 0.95);   // the biggest moment of the set (GDD §7.2)
  },
  achievement: () => {                                // ribbon ding
    const o = buf(1.4);
    fmBell(o, { f: hz(84), ratio: 3.5, index: 1.2, dur: 1.3, gain: 0.35, tau: 0.5 });
    [88, 91, 96].forEach((m, i) => mallet(o, hz(m), 0.08 + i * 0.07, 0.9, 0.25));
    return mixTo(reverb(o, { wet: 0.25, tail: 0.5 }), 0.7);
  },
  quest: () => {                                      // quest complete flourish
    const o = buf(1.4);
    [67, 69, 72, 74, 76, 79, 84].forEach((m, i) => pluck(o, { f: hz(m), dur: 0.5, gain: 0.35, start: i * 0.06, bright: 0.7, decay: 0.994 }));
    fmBell(o, { f: hz(91), ratio: 2, index: 1.4, dur: 0.9, gain: 0.25, start: 0.42, tau: 0.35 });
    return mixTo(reverb(o, { wet: 0.22, tail: 0.5 }), 0.55);
  },
  mastery: () => {                                    // mastery star chime
    const o = buf(1.1);
    [91, 95, 98].forEach((m, i) => mallet(o, hz(m), i * 0.05, 0.8, 0.3));
    noise(o, { dur: 0.8, f0: 9000, q: 0.6, type: 'hp', gain: 0.05, env: ad(0.05, 0.25) });
    return mixTo(reverb(o, { wet: 0.3, tail: 0.5 }), 0.6);
  },
  expand: () => {                                     // expansion: fence posts pop + chime
    const o = buf(1.2);
    [0, 0.12, 0.24].forEach((s, i) => pluck(o, { f: 180 + i * 30, dur: 0.25, gain: 0.6, start: s, bright: 0.3, decay: 0.95 }));
    [79, 84, 88].forEach((m, i) => mallet(o, hz(m), 0.4 + i * 0.08, 0.7, 0.3));
    return mixTo(reverb(o, { wet: 0.2, tail: 0.4 }), 0.65);
  },
  // Co-op ----------------------------------------------------------------------------------------------------------
  arrive: () => {                                     // partner arrived
    const o = buf(1.0);
    [76, 79, 84].forEach((m, i) => fmBell(o, { f: hz(m), ratio: 2, index: 1, dur: 0.8, gain: 0.25, start: i * 0.11, tau: 0.3 }));
    return mixTo(reverb(o, { wet: 0.3, tail: 0.5 }), 0.55);
  },
  ping_me: () => ping(84, 91),
  ping_partner: () => ping(79, 86),
  emote: () => {                                      // emote bubble pops in
    const o = buf(0.4);
    osc(o, { f0: 420, f1: 1100, dur: 0.07, gain: 0.4, env: ad(0.002, 0.025), glide: (k) => k ** 0.5 });
    mallet(o, hz(88), 0.05, 0.3, 0.25);
    return mixTo(o, 0.42);
  },
  clap: () => {                                       // high-five
    const o = buf(0.7);
    for (const s of [0, 0.012]) noise(o, { dur: 0.09, f0: 1500, f1: 1100, q: 0.9, gain: 0.9, start: s, env: ad(0.001, 0.018) });
    [91, 95, 98, 103].forEach((m, i) => mallet(o, hz(m), 0.08 + i * 0.04, 0.4, 0.15));
    return mixTo(reverb(o, { wet: 0.2, tail: 0.3 }), 0.65);
  },
  duet: () => {                                       // duet bell
    const o = buf(1.6);
    for (const m of [72, 76, 79]) fmBell(o, { f: hz(m), ratio: 1.41, index: 2, dur: 1.5, gain: 0.22, tau: 0.6 });
    return mixTo(reverb(o, { wet: 0.3, tail: 0.6 }), 0.65);
  },
  golden: () => {                                     // Golden Hour swell
    const o = buf(3.0);
    for (const m of [60, 64, 67, 71, 74]) {
      osc(o, { type: 'saw', f0: hz(m), dur: 2.8, gain: 0.08, env: swell(2.8), vib: 0.003, vibRate: 4 });
      osc(o, { type: 'saw', f0: hz(m) * 1.006, dur: 2.8, gain: 0.06, env: swell(2.8) });
    }
    lowpass(o, 1800);
    [84, 88, 91, 95].forEach((m, i) => mallet(o, hz(m), 1.0 + i * 0.15, 1.0, 0.18));
    return mixTo(reverb(o, { wet: 0.35, tail: 0.8 }), 0.6);
  },
  together: () => {                                   // together sparkle (combo)
    const o = buf(0.8);
    [86, 91, 98].forEach((m, i) => mallet(o, hz(m), i * 0.05, 0.6, 0.2));
    return mixTo(reverb(o, { wet: 0.3, tail: 0.4 }), 0.45);
  },
  note: () => {                                       // paper rustle
    const o = buf(0.4);
    noise(o, { dur: 0.35, f0: 2400, f1: 3800, q: 0.9, gain: 0.6, env: (t) => swell(0.35)(t) * (0.5 + 0.5 * Math.abs(Math.sin(TAU * 17 * t + rnd() * 0.1))) });
    return mixTo(o, 0.35);
  },
  thanks: () => {                                     // a heart: warm two-note boop
    const o = buf(0.6);
    osc(o, { f0: hz(76), dur: 0.2, gain: 0.35, env: ad(0.005, 0.07), type: 'tri' });
    osc(o, { f0: hz(84), dur: 0.35, gain: 0.35, start: 0.1, env: ad(0.005, 0.12), type: 'tri' });
    return mixTo(reverb(o, { wet: 0.2, tail: 0.3 }), 0.42);
  },
  // UI ------------------------------------------------------------------------------------------------------------
  click: () => {                                      // button press: soft wooden tick
    const o = buf(0.08);
    osc(o, { f0: 1250, f1: 900, dur: 0.03, gain: 0.4, env: ad(0.001, 0.01) });
    click(o, { gain: 0.15, f: 3500, len: 0.003 });
    return mixTo(o, 0.3);
  },
  tab: () => {
    const o = buf(0.07);
    osc(o, { f0: 900, f1: 750, dur: 0.03, gain: 0.4, env: ad(0.001, 0.01) });
    return mixTo(o, 0.24);
  },
  hover: () => {
    const o = buf(0.04);
    osc(o, { f0: 2100, dur: 0.012, gain: 0.3, env: ad(0.001, 0.004) });
    return mixTo(o, 0.1);
  },
  open: () => {                                       // panel open: paper slide up
    const o = buf(0.3);
    noise(o, { dur: 0.25, f0: 1200, f1: 3200, q: 0.8, gain: 0.5, env: swell(0.25) });
    osc(o, { f0: 500, f1: 800, dur: 0.06, gain: 0.12, start: 0.18, env: ad(0.002, 0.02), type: 'tri' });
    return mixTo(o, 0.3);
  },
  close: () => {                                      // panel close: paper slide down
    const o = buf(0.22);
    noise(o, { dur: 0.18, f0: 2800, f1: 1100, q: 0.8, gain: 0.5, env: swell(0.18) });
    return mixTo(o, 0.26);
  },
  bonk: () => {                                       // invalid: round, soft, wooden — never a buzzer
    const o = buf(0.22);
    osc(o, { f0: 240, f1: 165, dur: 0.16, gain: 0.5, env: ad(0.003, 0.045), vib: 0.03, vibRate: 30 });
    pluck(o, { f: 196, dur: 0.15, gain: 0.25, bright: 0.2, decay: 0.93 });
    return mixTo(o, 0.38);
  },
  toast: () => {
    const o = buf(0.12);
    osc(o, { f0: 600, f1: 950, dur: 0.06, gain: 0.35, env: ad(0.002, 0.02), glide: (k) => k ** 0.5 });
    return mixTo(o, 0.24);
  },
  tooltip: () => {
    const o = buf(0.06);
    osc(o, { f0: 1400, f1: 1700, dur: 0.025, gain: 0.3, env: ad(0.001, 0.008) });
    return mixTo(o, 0.12);
  },
  // Instruments (single notes; the music engine pitches them) ------------------------------------------------------
  i_pluck: () => {                                    // fingerpicked nylon-ish guitar, C4
    const o = buf(2.2);
    pluck(o, { f: hz(60), dur: 2.2, gain: 0.7, bright: 0.45, decay: 0.9985 });
    return mixTo(lowpass(o, 4200), 0.8);
  },
  i_banjo: () => {                                    // bright banjo twang, C4
    const o = buf(1.2);
    pluck(o, { f: hz(60), dur: 1.2, gain: 0.7, bright: 0.8, decay: 0.995, body: false });
    const tw = biquad('peak', 1400, 2.5, 6);
    for (let i = 0; i < o.length; i++) o[i] = tw(o[i]);
    return mixTo(lowpass(o, 5500), 0.75);
  },
  i_bass: () => {                                     // upright bass, C2
    const o = buf(1.8);
    pluck(o, { f: hz(36), dur: 1.8, gain: 0.8, bright: 0.18, decay: 0.9993 });
    osc(o, { f0: hz(36), dur: 1.6, gain: 0.25, env: ad(0.01, 0.5) });
    return mixTo(lowpass(o, 900), 0.85);
  },
  i_mallet: () => { const o = buf(1.4); mallet(o, hz(72), 0, 1.3, 0.8); return mixTo(o, 0.7); },   // glockenspiel, C5
  i_marimba: () => {                                  // warm marimba, C4
    const o = buf(1.2);
    partials(o, { f: hz(60), list: [[1, 1, 0.35], [3.93, 0.28, 0.08], [9.2, 0.06, 0.03]], dur: 1.2, gain: 0.6, attack: 0.001 });
    noise(o, { dur: 0.02, f0: 1800, q: 1, gain: 0.08, env: ad(0.001, 0.005) });
    return mixTo(o, 0.7);
  },
  i_piano: () => {                                    // soft felt piano, C4 (night)
    const o = buf(3.0);
    const f = hz(60);
    const list = [];
    for (let n = 1; n <= 9; n++) list.push([n * Math.sqrt(1 + 0.0004 * n * n), 1 / n ** 1.35, 1.6 / n ** 0.6]);
    partials(o, { f, list, dur: 3.0, gain: 0.5, attack: 0.004 });
    noise(o, { dur: 0.03, f0: 900, q: 0.8, gain: 0.06, env: ad(0.001, 0.008) });
    return mixTo(lowpass(o, 2600), 0.75);
  },
  // Ambience -----------------------------------------------------------------------------------------------------
  amb_bird1: () => bird([[2600, 3400, 0.07], [3000, 3900, 0.07], [2800, 4200, 0.09]], 0.05),
  amb_bird2: () => bird([[3800, 2900, 0.12], [3600, 2700, 0.12]], 0.09),
  amb_bird3: () => bird([[2200, 2600, 0.05], [2200, 2600, 0.05], [2200, 2600, 0.05], [2400, 3300, 0.14]], 0.03),
  amb_bird4: () => bird([[4200, 4600, 0.04], [3900, 4400, 0.04], [4200, 4700, 0.04], [3800, 4300, 0.04], [4100, 4900, 0.06]], 0.025),
  amb_owl: () => {                                    // a soft hoo-hoo at night
    const o = buf(1.3);
    voice(o, { f0: 380, f1: 340, dur: 0.35, gain: 0.5, env: ahr(0.06, 0.35, 0.15), formants: [[400, 3, 1]], breath: 0.15 });
    voice(o, { f0: 400, f1: 330, dur: 0.6, gain: 0.5, start: 0.5, env: ahr(0.08, 0.6, 0.25), formants: [[400, 3, 1]], breath: 0.15 });
    return mixTo(reverb(o, { wet: 0.35, tail: 0.8 }), 0.45);
  },
  amb_crickets: () => {                               // seamless 6 s loop
    const len = 6.5;
    const o = buf(len);
    for (const [carrier, rate, phase, g] of [[4650, 0.9, 0, 0.5], [4380, 0.71, 0.33, 0.4], [4900, 1.13, 0.7, 0.3]]) {
      let p = 0;
      for (let i = 0; i < o.length; i++) {
        const t = i / SR;
        p += carrier / SR;
        const cyc = (t * rate + phase) % 1;              // a chirp group per cycle
        const inGroup = cyc < 0.32;
        const pulse = inGroup ? Math.max(0, Math.sin(TAU * 32 * t)) ** 4 : 0;
        o[i] += Math.sin(TAU * p) * pulse * g;
      }
    }
    return normalize(seamless(highpass(o, 2500), 0.5), 0.5);   // loops: no trim (length is the loop)
  },
  amb_wind: () => {                                   // seamless 8 s loop: leaves in a soft breeze
    const len = 8.6;
    const o = buf(len);
    noise(o, { dur: len, f0: 500, f1: 500, q: 0.5, type: 'lp', gain: 1, env: (t) => 0.55 + 0.45 * Math.sin((TAU * t) / 4.3) ** 2, color: 'brown' });
    noise(o, { dur: len, f0: 2600, f1: 3400, q: 0.5, gain: 0.12, env: (t) => 0.3 + 0.7 * Math.sin((TAU * t) / 2.15 + 1) ** 2 });
    return normalize(seamless(o, 0.6), 0.5);
  },
  amb_rain: () => {                                   // seamless 5 s loop: steady rain + drops
    const len = 5.5;
    const o = buf(len);
    noise(o, { dur: len, f0: 1800, q: 0.4, type: 'bp', gain: 0.6, env: () => 1 });
    noise(o, { dur: len, f0: 6000, q: 0.5, type: 'hp', gain: 0.18, env: () => 1 });
    for (let k = 0; k < 160; k++) {
      const f = 1500 + rnd() * 3000;
      osc(o, { f0: f, f1: f * 1.6, dur: 0.02, gain: 0.05 + rnd() * 0.08, start: rnd() * (len - 0.05), env: ad(0.001, 0.006) });
    }
    return normalize(seamless(o, 0.5), 0.5);
  },
  // ---- M1b (wave 2). Appended AFTER every M1a sound on purpose: the generator is one seeded sequence, so the older
  // sounds stay byte-identical when new ones are added at the end.
  // New animals (GDD §8.5 Animals: oink, quack, bleat, neigh, bee buzz) --------------------------------------------
  oink: () => {                                       // two nasal grunts, a snort first ("hnk-OINK oink")
    const o = buf(0.62);
    noise(o, { dur: 0.09, f0: 700, q: 1.4, type: 'bp', gain: 0.35, env: ad(0.004, 0.03), color: 'brown' });
    for (const [s, d, a, b] of [[0.07, 0.17, 118, 168], [0.31, 0.21, 132, 104]]) {
      voice(o, { f0: a, f1: b, dur: d, gain: 0.6, start: s, env: ahr(0.012, d, d * 0.45), vib: 0.06, vibRate: 31,
        formants: [[340, 4, 1], [1050, 6, 0.75], [2450, 8, 0.25]], breath: 0.22,
        glide: (k) => (b > a ? Math.sin((k * Math.PI) / 2) : k * k) });
    }
    return mixTo(lowpass(o, 3800), 0.52);
  },
  quack: () => {                                      // "quack-quack": buzzy, nasal, the second a little lower
    const o = buf(0.55);
    for (const [s, d, a, b] of [[0, 0.16, 352, 300], [0.22, 0.19, 330, 270]]) {
      voice(o, { f0: a, f1: b, dur: d, gain: 0.55, start: s, env: ahr(0.006, d, d * 0.35), vib: 0.025, vibRate: 22,
        formants: [[1080, 4, 1], [2550, 6, 0.65], [3600, 9, 0.25]], breath: 0.06, glide: (k) => k ** 1.6 });
    }
    return mixTo(o, 0.5);
  },
  bleat: () => {                                      // a goat's "meh-eh-eh": higher and quicker than the sheep's baa
    const o = buf(0.78);
    voice(o, { f0: 540, f1: 470, dur: 0.7, gain: 0.55, vib: 0.045, vibRate: 13,
      env: (t) => ahr(0.02, 0.7, 0.22)(t) * (0.6 + 0.4 * Math.sin(TAU * 13 * t) ** 2),
      formants: [[690, 5, 1], [1750, 6, 0.65], [2900, 8, 0.28]], breath: 0.1 });
    return mixTo(o, 0.48);
  },
  neigh: () => {                                      // a whinny: a high trill sliding down, then a soft blow
    const o = buf(1.45);
    voice(o, { f0: 940, f1: 380, dur: 1.05, gain: 0.5, vib: 0.065, vibRate: 21, glide: (k) => k ** 0.75,
      env: (t) => ahr(0.05, 1.05, 0.35)(t) * (0.7 + 0.3 * Math.sin(TAU * 21 * t)),
      formants: [[880, 3, 1], [1750, 5, 0.55], [3000, 7, 0.2]], breath: 0.12 });
    noise(o, { dur: 0.32, f0: 650, f1: 380, q: 0.9, type: 'lp', gain: 0.45, start: 1.08, env: ad(0.03, 0.09), color: 'brown' });
    return mixTo(reverb(o, { wet: 0.12, tail: 0.3 }), 0.5);
  },
  buzz: () => {                                       // two bees fly past the hive (wing beat ~220 Hz, a little Doppler)
    const o = buf(0.95);
    for (const [s, f, g] of [[0, 218, 0.4], [0.12, 236, 0.28]]) {
      const b = buf(0.8);
      osc(b, { type: 'saw', f0: f, f1: f * 1.08, dur: 0.8, gain: g, glide: (k) => Math.sin(k * Math.PI) * 0.5 + k * 0.5,
        vib: 0.012, vibRate: 9, env: (t) => swell(0.8)(t) * (0.75 + 0.25 * Math.sin(TAU * 11 * t)) });
      const bp = biquad('bp', 1300, 0.7);
      for (let i = 0; i < b.length && Math.floor(s * SR) + i < o.length; i++) o[Math.floor(s * SR) + i] += bp(b[i]);
    }
    return mixTo(o, 0.36);
  },
  // Systems: the County Fair, the River Barge, Restoration and Town Projects, collections (GDD §8.5) -------------------
  fanfare: () => {                                    // the Fair ceremony: snare roll, "ta-ta-ta-TAAA", cymbal, bells
    const o = buf(3.2);
    for (let k = 0; k < 11; k++) noise(o, { dur: 0.05, f0: 2400, q: 0.6, gain: 0.12 + k * 0.015, start: k * 0.042, env: ad(0.001, 0.016) });
    [[67, 0, 0.11], [67, 0.15, 0.11], [67, 0.3, 0.11], [72, 0.46, 1.25]].forEach(([m, s, d]) => {
      brass(o, hz(m), s, d, 0.3);
      brass(o, hz(m - 12), s, d, 0.16);
    });
    for (const m of [60, 64, 67]) brass(o, hz(m), 0.46, 1.3, 0.13);                 // the band joins on the last note
    osc(o, { f0: hz(43), f1: hz(43) * 0.92, dur: 0.5, gain: 0.5, start: 0.3, env: ad(0.003, 0.14) });   // timpani G
    osc(o, { f0: hz(36), f1: hz(36) * 0.92, dur: 0.8, gain: 0.6, start: 0.46, env: ad(0.003, 0.22) });  // timpani C
    noise(o, { dur: 1.6, f0: 5200, q: 0.5, type: 'hp', gain: 0.22, start: 0.46, env: ad(0.002, 0.45) });  // cymbal
    [84, 88, 91, 96, 100].forEach((m, i) => mallet(o, hz(m), 1.05 + i * 0.07, 1.0, 0.22));
    return mixTo(reverb(o, { wet: 0.24, tail: 0.8 }), 0.95);
  },
  barge_horn: () => {                                 // Captain Reed's barge: a short and a long blast, across the water
    const o = buf(2.9);
    for (const [s, d] of [[0, 0.42], [0.62, 1.35]]) {
      const b = buf(d + 0.05);
      for (const [f, g] of [[110, 0.3], [138.6, 0.24], [164.8, 0.2]]) {
        osc(b, { type: 'saw', f0: f * 0.97, f1: f, dur: d, gain: g, glide: (k) => Math.min(1, k * 6), env: ahr(0.07, d, 0.18), vib: 0.004, vibRate: 5 });
      }
      noise(b, { dur: d, f0: 900, q: 0.7, gain: 0.08, env: ahr(0.05, d, 0.15) });
      lowpass(b, 850, 0.8);
      for (let i = 0; i < b.length && Math.floor(s * SR) + i < o.length; i++) o[Math.floor(s * SR) + i] += b[i];
    }
    return mixTo(reverb(o, { wet: 0.4, decay: 0.8, tail: 1.0, damp: 0.5 }), 0.62);
  },
  crate: () => {                                      // a crate thumps onto the barge deck, the lid rattles
    const o = buf(0.42);
    pluck(o, { f: 118, dur: 0.3, gain: 0.8, bright: 0.28, decay: 0.93 });
    osc(o, { f0: 95, f1: 52, dur: 0.22, gain: 0.55, env: ad(0.003, 0.06) });
    click(o, { gain: 0.3, f: 1600, len: 0.006 });
    for (const s of [0.09, 0.15, 0.2]) click(o, { start: s, gain: 0.07, f: 2800, len: 0.004 });
    return mixTo(o, 0.6);
  },
  ferry_bell: () => {                                 // goods go over the river: the little ferry's bell, ding-ding
    const o = buf(1.6);
    for (const s of [0, 0.32]) fmBell(o, { f: hz(81), ratio: 2.76, index: 1.6, dur: 1.2, gain: 0.32, start: s, tau: 0.45 });
    return mixTo(reverb(o, { wet: 0.3, tail: 0.6 }), 0.5);
  },
  find: () => {                                       // a collection item sparkles out
    const o = buf(1.3);
    noise(o, { dur: 0.9, f0: 7500, q: 0.6, type: 'hp', gain: 0.07, env: swell(0.9) });
    [84, 88, 91, 96, 100, 103].forEach((m, i) => mallet(o, hz(m), i * 0.05, 0.7, 0.24));
    fmBell(o, { f: hz(96), ratio: 3.5, index: 1.1, dur: 0.9, gain: 0.22, start: 0.32, tau: 0.35 });
    return mixTo(reverb(o, { wet: 0.3, tail: 0.5 }), 0.55);
  },
  bundle: () => {                                     // a project bundle is complete: a strummed chord + a bell
    const o = buf(1.4);
    [60, 64, 67, 72, 76].forEach((m, i) => pluck(o, { f: hz(m), dur: 1.0, gain: 0.32, start: i * 0.03, bright: 0.6, decay: 0.997 }));
    fmBell(o, { f: hz(84), ratio: 2, index: 1.2, dur: 1.0, gain: 0.22, start: 0.18, tau: 0.4 });
    return mixTo(reverb(o, { wet: 0.22, tail: 0.5 }), 0.6);
  },
  lights_on: () => {                                  // a project is finished: a warm swell and the lanterns light up
    const o = buf(3.0);
    for (const m of [55, 60, 64, 67, 72]) {
      osc(o, { type: 'saw', f0: hz(m), dur: 2.4, gain: 0.07, env: (t) => clamp01(t / 1.2) ** 2 * (t > 1.7 ? Math.max(0, 1 - (t - 1.7) / 0.7) : 1) });
      osc(o, { type: 'tri', f0: hz(m) * 1.005, dur: 2.4, gain: 0.08, env: (t) => clamp01(t / 1.2) ** 2 * (t > 1.7 ? Math.max(0, 1 - (t - 1.7) / 0.7) : 1) });
    }
    lowpass(o, 1600);
    [79, 84, 88, 91, 96].forEach((m, i) => fmBell(o, { f: hz(m), ratio: 2, index: 0.9, dur: 1.2, gain: 0.16, start: 1.15 + i * 0.12, tau: 0.4 }));
    return mixTo(reverb(o, { wet: 0.35, tail: 0.8 }), 0.7);
  },
  giant_fall: () => {                                 // a giant crop topples: a creak, a big soft thud, leaves settle
    const o = buf(1.6);
    noise(o, { dur: 0.42, f0: 420, f1: 230, q: 7, gain: 0.5, env: (t) => swell(0.42)(t) * (0.6 + 0.4 * Math.sin(TAU * 23 * t) ** 2) });
    osc(o, { f0: 78, f1: 38, dur: 0.6, gain: 0.85, start: 0.42, env: ad(0.004, 0.18) });
    noise(o, { dur: 0.5, f0: 320, f1: 120, q: 0.7, type: 'lp', gain: 0.8, start: 0.42, env: ad(0.006, 0.12), color: 'brown' });
    click(o, { start: 0.42, gain: 0.25, f: 900, len: 0.01 });
    noise(o, { dur: 0.7, f0: 3600, f1: 2400, q: 0.6, gain: 0.16, start: 0.55, env: swell(0.7) });
    return mixTo(reverb(o, { wet: 0.15, tail: 0.4 }), 0.8);
  },
  dig: () => {                                        // a pig snuffles, scrapes the soil, and a truffle pops out
    const o = buf(0.9);
    for (const s of [0, 0.11, 0.2, 0.3]) noise(o, { dur: 0.07, f0: 900 + rnd() * 300, q: 2.2, type: 'bp', gain: 0.45, start: s, env: ad(0.006, 0.02) });
    noise(o, { dur: 0.2, f0: 1500, f1: 600, q: 1.1, gain: 0.45, start: 0.42, env: ad(0.01, 0.06), color: 'brown' });
    osc(o, { f0: 300, f1: 980, dur: 0.07, gain: 0.45, start: 0.68, env: ad(0.002, 0.025), glide: (k) => k ** 0.5 });
    click(o, { start: 0.68, gain: 0.12, f: 2500 });
    return mixTo(o, 0.5);
  },
  splash: () => {                                     // a duck paddles into the pond
    const o = buf(0.6);
    noise(o, { dur: 0.3, f0: 2200, f1: 700, q: 0.8, gain: 0.7, env: ad(0.004, 0.08) });
    for (let i = 0; i < 5; i++) {
      const f = 500 + rnd() * 700;
      osc(o, { f0: f, f1: f * 1.9, dur: 0.05, gain: 0.22, start: 0.1 + i * 0.07 + rnd() * 0.03, env: ad(0.002, 0.015), glide: (k) => k ** 0.6 });
    }
    return mixTo(reverb(o, { wet: 0.15, tail: 0.2 }), 0.45);
  },
  hooves: () => {                                     // seamless trot loop while riding: clip-clop, clip-clop
    const len = 1.32;
    const o = buf(len);
    [[0, 920], [0.33, 640], [0.66, 980], [0.99, 600]].forEach(([s, f]) => {
      partials(o, { f, list: [[1, 1, 0.025], [2.31, 0.45, 0.014], [4.1, 0.15, 0.008]], dur: 0.09, gain: 0.5, start: s, attack: 0.0008 });
      noise(o, { dur: 0.06, f0: 500, q: 0.8, type: 'lp', gain: 0.35, start: s, env: ad(0.002, 0.02), color: 'brown' });
    });
    return normalize(o, 0.45);                         // loops: no trim (the length is the loop; the hits end in time)
  },
  sew: () => {                                        // Sewing Table: the treadle machine runs up and stops
    const o = buf(0.85);
    osc(o, { type: 'saw', f0: 70, f1: 98, dur: 0.8, gain: 0.06, glide: (k) => Math.min(1, k * 3), env: ahr(0.08, 0.8, 0.15) });
    for (let t = 0.05, i = 0; t < 0.74; i++) { click(o, { start: t, gain: 0.22, f: 2600, len: 0.005 }); t += 1 / (8 + Math.min(1, i / 4) * 7); }
    return mixTo(lowpass(o, 4500), 0.42);
  },
  oven: () => {                                       // Pie Oven: the door creaks open, a warm whoosh, clunk
    const o = buf(0.75);
    noise(o, { dur: 0.25, f0: 650, f1: 980, q: 9, gain: 0.45, env: (t) => swell(0.25)(t) * (0.5 + 0.5 * Math.sin(TAU * 31 * t) ** 2) });
    noise(o, { dur: 0.35, f0: 500, f1: 900, q: 0.6, type: 'lp', gain: 0.35, start: 0.2, env: swell(0.35), color: 'brown' });
    pluck(o, { f: 130, dur: 0.2, gain: 0.6, bright: 0.25, decay: 0.92, start: 0.5 });
    click(o, { start: 0.5, gain: 0.18, f: 1500, len: 0.006 });
    return mixTo(o, 0.45);
  },
  fizz: () => {                                       // Chandlery: a match strikes, the wick catches with a soft fizz
    const o = buf(0.8);
    noise(o, { dur: 0.09, f0: 3000, f1: 5200, q: 1.1, gain: 0.55, env: ad(0.002, 0.03) });
    noise(o, { dur: 0.6, f0: 900, f1: 1300, q: 0.7, gain: 0.25, start: 0.08, env: (t) => ad(0.06, 0.22)(t) * (0.7 + 0.3 * rnd()) });
    for (let i = 0; i < 7; i++) click(o, { start: 0.12 + rnd() * 0.5, gain: 0.05 + rnd() * 0.05, f: 3500, len: 0.003 });
    return mixTo(o, 0.4);
  },
  tape: () => {                                       // Packing Table: a strip of tape rips off the roll, a pat
    const o = buf(0.55);
    noise(o, { dur: 0.3, f0: 1400, f1: 3600, q: 1.8, gain: 0.6, env: (t) => swell(0.3)(t) * (0.55 + 0.45 * Math.sin(TAU * 90 * t + 4 * Math.sin(TAU * 7 * t)) ** 2) });
    osc(o, { f0: 140, f1: 90, dur: 0.08, gain: 0.35, start: 0.38, env: ad(0.002, 0.025) });
    noise(o, { dur: 0.06, f0: 800, q: 0.8, type: 'lp', gain: 0.3, start: 0.38, env: ad(0.002, 0.02), color: 'brown' });
    return mixTo(o, 0.42);
  },
  // Ambience: water lapping (river, pond) and the village's bells once a Town Project stands (GDD §8.5) ---------------
  amb_water: () => {                                  // seamless 7 s loop: small waves lapping at a bank
    const len = 7.6;
    const o = buf(len);
    const laps = [0.4, 1.9, 3.1, 4.5, 5.6, 6.9];
    const lap = (t) => laps.reduce((a, c) => a + Math.exp(-(((t - c) / 0.28) ** 2)), 0);
    noise(o, { dur: len, f0: 380, q: 0.6, type: 'lp', gain: 1, env: (t) => 0.35 + 0.65 * Math.min(1, lap(t)), color: 'brown' });
    noise(o, { dur: len, f0: 1300, q: 1.2, gain: 0.1, env: (t) => 0.2 + 0.8 * Math.min(1, lap(t - 0.12)) });
    for (let k = 0; k < 18; k++) {
      const f = 600 + rnd() * 900;
      osc(o, { f0: f, f1: f * 1.7, dur: 0.04, gain: 0.04 + rnd() * 0.05, start: rnd() * (len - 0.1), env: ad(0.002, 0.012) });
    }
    return normalize(seamless(o, 0.6), 0.5);
  },
  amb_bells: () => {                                  // a distant village bell, three strokes (hum, prime, tierce, quint)
    const o = buf(5.0);
    const f = hz(64);
    for (const s of [0, 1.15, 2.3]) {
      partials(o, { f, list: [[0.5, 0.55, 1.6], [1, 1, 1.1], [1.19, 0.5, 0.8], [1.5, 0.32, 0.6], [2, 0.38, 0.5], [2.52, 0.14, 0.3]],
        dur: 2.6, gain: 0.28, start: s, attack: 0.002 });
    }
    return mixTo(lowpass(reverb(o, { wet: 0.45, decay: 0.8, tail: 1.2, damp: 0.5 }), 2200), 0.4);
  },
  // Pets (GDD §3.4 Pets, §8.5: dog woof, cat meow) ---------------------------------------------------------------------
  woof: () => {                                       // a friendly "wuff-wuff"
    const o = buf(0.5);
    for (const [s, d, a, g] of [[0, 0.13, 420, 0.6], [0.2, 0.11, 380, 0.45]]) {
      voice(o, { f0: a, f1: a * 0.72, dur: d, gain: g, start: s, env: ahr(0.008, d, d * 0.6), vib: 0.04, vibRate: 35,
        formants: [[680, 3, 1], [1450, 4, 0.6], [2600, 6, 0.25]], breath: 0.3, glide: (k) => k ** 0.7 });
    }
    return mixTo(lowpass(o, 4200), 0.5);
  },
  meow: () => {                                       // "mi-aow": a rise, a fall, the vowel opening
    const o = buf(0.75);
    const d = 0.62;
    const b = buf(d + 0.02);
    voice(b, { f0: 560, f1: 470, dur: d, gain: 0.5, env: ahr(0.09, d, 0.25), vib: 0.02, vibRate: 6,
      glide: (k) => (k < 0.35 ? -0.9 * (k / 0.35) : -0.9 + 1.9 * ((k - 0.35) / 0.65)),
      formants: [[900, 5, 1], [1900, 6, 0.55], [3300, 8, 0.2]], breath: 0.06 });
    const f = biquad('lp', 900, 0.8);                  // the "m": muffled at first, opening into "ow"
    for (let i = 0; i < b.length; i++) { if (i % 16 === 0) f.tune(900 + 3600 * Math.min(1, (i / SR) / 0.2)); o[i] += f(b[i]); }
    return mixTo(o, 0.45);
  },
  // M2 (wave 3): the alpaca, the fishing dock, the horse show, Friendly Duel, the farmhouse interior, the nursery and
  // perks (GDD §8.5 "alpaca hum", "fishing-line plop"). Appended AFTER every older sound: the generator's random
  // sequence runs in this order, so the earlier files stay byte-identical.
  hum: () => {                                        // an alpaca hums: a soft, nasal, closed-mouth "mm-mmm?"
    const o = buf(1.25);
    for (const [s, d, a, b] of [[0, 0.42, 250, 262], [0.5, 0.62, 246, 300]]) {
      voice(o, { f0: a, f1: b, dur: d, gain: 0.5, start: s, env: ahr(0.07, d, 0.2), vib: 0.012, vibRate: 5,
        glide: (k) => (k < 0.6 ? 0 : (k - 0.6) / 0.4), formants: [[260, 2.5, 1], [1000, 7, 0.12], [2300, 9, 0.05]], breath: 0.03 });
    }
    return mixTo(lowpass(o, 1500), 0.42);
  },
  cast: () => {                                       // a fishing cast: the rod whips through the air, the line sings out
    const o = buf(0.75);
    noise(o, { dur: 0.22, f0: 900, f1: 2600, q: 1.4, gain: 0.55, env: swell(0.22) });            // the rod's whoosh
    osc(o, { f0: 2400, f1: 1300, dur: 0.48, gain: 0.07, start: 0.12, env: ad(0.01, 0.2), glide: (k) => k ** 0.6 });
    for (let t = 0.14, i = 0; t < 0.6; i++) { click(o, { start: t, gain: 0.07 * (1 - i / 22), f: 3800, len: 0.002 }); t += 0.018 + i * 0.0016; }
    return mixTo(o, 0.42);
  },
  reel: () => {                                       // seamless reel loop: the ratchet clicks, the spool whirs
    const len = 1.0;
    const o = buf(len);
    for (let k = 0; k < 16; k++) {
      click(o, { start: k / 16, gain: 0.32, f: 2600, len: 0.004 });
      partials(o, { f: 1900, list: [[1, 1, 0.006], [1.7, 0.4, 0.004]], dur: 0.02, gain: 0.08, start: k / 16, attack: 0.0005 });
    }
    osc(o, { type: 'tri', f0: 180, dur: len, gain: 0.03, env: () => 1 });
    return normalize(o, 0.34);                         // loops: no trim
  },
  plop: () => {                                       // the bobber lands: a small round "bloop" and a ring of water
    const o = buf(0.42);
    osc(o, { f0: 380, f1: 1150, dur: 0.07, gain: 0.5, env: ad(0.002, 0.03), glide: (k) => k ** 0.5 });
    noise(o, { dur: 0.16, f0: 1500, f1: 700, q: 0.9, gain: 0.25, start: 0.02, env: ad(0.004, 0.04) });
    for (const s of [0.1, 0.17]) osc(o, { f0: 700, f1: 1300, dur: 0.04, gain: 0.12, start: s, env: ad(0.002, 0.012) });
    return mixTo(reverb(o, { wet: 0.12, tail: 0.2 }), 0.4);
  },
  bite: () => {                                       // a fish bites: the bobber dips twice, a little rising chirp
    const o = buf(0.5);
    for (const s of [0, 0.13]) {
      osc(o, { f0: 520, f1: 980, dur: 0.05, gain: 0.45, start: s, env: ad(0.002, 0.02), glide: (k) => k ** 0.6 });
      noise(o, { dur: 0.06, f0: 1800, q: 1.2, gain: 0.18, start: s, env: ad(0.003, 0.02) });
    }
    mallet(o, hz(88), 0.24, 0.35, 0.22);
    return mixTo(o, 0.5);
  },
  fish_splash: () => {                                // the catch comes out of the water: a splash and falling drops
    const o = buf(0.9);
    noise(o, { dur: 0.32, f0: 2600, f1: 900, q: 0.7, gain: 0.7, env: ad(0.003, 0.09) });
    noise(o, { dur: 0.2, f0: 500, q: 0.7, type: 'lp', gain: 0.4, env: ad(0.004, 0.05), color: 'brown' });
    for (let i = 0; i < 9; i++) {
      const f = 650 + rnd() * 1100;
      osc(o, { f0: f, f1: f * 1.8, dur: 0.045, gain: 0.16, start: 0.16 + i * 0.06 + rnd() * 0.03, env: ad(0.002, 0.014), glide: (k) => k ** 0.6 });
    }
    return mixTo(reverb(o, { wet: 0.14, tail: 0.3 }), 0.5);
  },
  show_fanfare: () => {                               // the horse show: a post-horn call in 6/8 over a trot, then bells
    const o = buf(3.0);
    const q = 0.16;                                   // an eighth at ~125 BPM in 6/8
    [[67, 0, 1], [67, 1, 1], [72, 2, 1], [76, 3, 2], [72, 5, 1], [79, 6, 4]].forEach(([m, s, d]) => brass(o, hz(m), 0.1 + s * q, d * q * 0.92, 0.28));
    for (let k = 0; k < 10; k++) {                    // clip-clop under the call
      partials(o, { f: k % 2 ? 640 : 920, list: [[1, 1, 0.022], [2.31, 0.4, 0.012]], dur: 0.08, gain: 0.22, start: 0.1 + k * 0.2, attack: 0.0008 });
    }
    osc(o, { f0: hz(43), f1: hz(43) * 0.93, dur: 0.6, gain: 0.45, start: 0.1 + 6 * q, env: ad(0.003, 0.18) });
    [84, 88, 91, 96].forEach((m, i) => mallet(o, hz(m), 0.1 + 6 * q + 0.35 + i * 0.07, 0.9, 0.2));
    return mixTo(reverb(o, { wet: 0.26, tail: 0.8 }), 0.9);
  },
  duel_start: () => {                                 // a Friendly Duel begins: a woodblock roll and a bright ding-ding
    const o = buf(1.4);
    for (let k = 0; k < 9; k++) partials(o, { f: 820 + (k % 2) * 160, list: [[1, 1, 0.03], [2.6, 0.3, 0.01]], dur: 0.06, gain: 0.18 + k * 0.02, start: k * 0.055, attack: 0.0008 });
    for (const s of [0.52, 0.78]) fmBell(o, { f: hz(84), ratio: 2.76, index: 1.4, dur: 0.8, gain: 0.3, start: s, tau: 0.3 });
    return mixTo(reverb(o, { wet: 0.2, tail: 0.4 }), 0.55);
  },
  duel_win: () => {                                   // a duel's crown: a glockenspiel run up and a short "ta-daa"
    const o = buf(2.0);
    [72, 76, 79, 84, 88, 91].forEach((m, i) => mallet(o, hz(m), i * 0.07, 0.8, 0.26));
    brass(o, hz(72), 0.48, 0.14, 0.24);
    brass(o, hz(79), 0.66, 0.8, 0.28);
    for (const m of [64, 67]) brass(o, hz(m), 0.66, 0.8, 0.12);
    noise(o, { dur: 0.9, f0: 6500, q: 0.6, type: 'hp', gain: 0.08, start: 0.66, env: swell(0.9) });
    return mixTo(reverb(o, { wet: 0.25, tail: 0.6 }), 0.8);
  },
  amb_interior: () => {                               // seamless 8 s loop indoors: a fire crackles, the clock ticks
    const len = 8.4;
    const o = buf(len);
    noise(o, { dur: len, f0: 220, q: 0.6, type: 'lp', gain: 0.5, env: (t) => 0.8 + 0.2 * Math.sin(TAU * 0.31 * t), color: 'brown' });
    for (let k = 0; k < 70; k++) {                    // crackles and little pops of the logs
      const s = rnd() * (len - 0.05);
      click(o, { start: s, gain: 0.05 + rnd() * 0.12, f: 1200 + rnd() * 2600, len: 0.002 + rnd() * 0.004 });
    }
    for (let t = 0.25; t < len - 0.3; t += 1.0) {     // tick ... tock
      partials(o, { f: t % 2 < 1 ? 2100 : 1750, list: [[1, 1, 0.012], [2.3, 0.4, 0.006]], dur: 0.04, gain: 0.07, start: t, attack: 0.0005 });
    }
    return normalize(seamless(o, 0.4), 0.42);
  },
  door: () => {                                       // the farmhouse door: the latch, a soft creak, the little bell above
    const o = buf(1.3);
    click(o, { gain: 0.35, f: 1800, len: 0.006 });
    pluck(o, { f: 160, dur: 0.2, gain: 0.35, bright: 0.25, decay: 0.92, start: 0.01 });
    noise(o, { dur: 0.42, f0: 520, f1: 760, q: 10, gain: 0.3, start: 0.08, env: (t) => swell(0.42)(t) * (0.5 + 0.5 * Math.sin(TAU * 27 * t) ** 2) });
    for (const s of [0.3, 0.42]) fmBell(o, { f: hz(93), ratio: 2.4, index: 1.1, dur: 0.7, gain: 0.16, start: s, tau: 0.25 });
    return mixTo(reverb(o, { wet: 0.16, tail: 0.3 }), 0.48);
  },
  furnish: () => {                                    // furniture set down indoors: a soft knock on floorboards, a rug pat
    const o = buf(0.45);
    pluck(o, { f: 140, dur: 0.26, gain: 0.7, bright: 0.22, decay: 0.9 });
    osc(o, { f0: 110, f1: 60, dur: 0.14, gain: 0.4, env: ad(0.003, 0.04) });
    noise(o, { dur: 0.12, f0: 700, q: 0.7, type: 'lp', gain: 0.3, start: 0.06, env: ad(0.004, 0.04), color: 'brown' });
    return mixTo(o, 0.5);
  },
  brush: () => {                                      // grooming in the nursery: three soft bristle strokes
    const o = buf(0.8);
    for (const s of [0, 0.24, 0.48]) noise(o, { dur: 0.2, f0: 3200, f1: 2200, q: 0.9, gain: 0.35, start: s, env: swell(0.2) });
    return mixTo(lowpass(o, 6000), 0.32);
  },
  squeak: () => {                                     // play time in the nursery: a rubber toy squeaks twice
    const o = buf(0.5);
    for (const [s, a] of [[0, 1450], [0.2, 1250]]) {
      osc(o, { type: 'tri', f0: a, f1: a * 1.35, dur: 0.12, gain: 0.35, start: s, env: ahr(0.01, 0.12, 0.05), vib: 0.03, vibRate: 30, glide: (k) => Math.sin(k * Math.PI) });
    }
    return mixTo(o, 0.36);
  },
  perk: () => {                                       // a perk chosen: a gentle harp rise and a soft wooden click
    const o = buf(1.3);
    [67, 71, 74, 79].forEach((m, i) => pluck(o, { f: hz(m), dur: 0.9, gain: 0.28, start: i * 0.06, bright: 0.65, decay: 0.998 }));
    click(o, { start: 0.3, gain: 0.12, f: 1400, len: 0.006 });
    fmBell(o, { f: hz(91), ratio: 2, index: 0.9, dur: 0.8, gain: 0.14, start: 0.26, tau: 0.3 });
    return mixTo(reverb(o, { wet: 0.25, tail: 0.5 }), 0.5);
  },
  // Wave 4 (the owners' wish list) -------------------------------------------------------------------------------
  barn_door: () => {                                  // the Barn's big doors swing: an iron latch, a long low creak, a thud
    const o = buf(1.5);
    click(o, { gain: 0.3, f: 1500, len: 0.008 });
    pluck(o, { f: 98, dur: 0.25, gain: 0.3, bright: 0.2, decay: 0.9, start: 0.012 });
    // the hinge: a band of noise whose pitch wanders down as the door swings, rasping at ~19 Hz
    noise(o, { dur: 0.95, f0: 430, f1: 300, q: 12, gain: 0.34, start: 0.1,
      env: (t) => swell(0.95)(t) * (0.45 + 0.55 * Math.sin(TAU * 19 * t) ** 2) });
    noise(o, { dur: 0.9, f0: 160, q: 0.8, type: 'lp', gain: 0.22, start: 0.12, env: swell(0.9), color: 'brown' });   // the rumble
    osc(o, { f0: 72, f1: 48, dur: 0.22, gain: 0.45, start: 1.08, env: ad(0.004, 0.07) });                          // it settles
    noise(o, { dur: 0.16, f0: 600, q: 0.7, type: 'lp', gain: 0.25, start: 1.08, env: ad(0.003, 0.05), color: 'brown' });
    return mixTo(reverb(o, { wet: 0.22, tail: 0.35 }), 0.5);
  },
  bunny: () => {                                      // a rabbit: two quick sniffs, a nibble, a soft hind-foot thump
    const o = buf(0.62);
    for (const s of [0, 0.07]) noise(o, { dur: 0.05, f0: 5200, q: 1.4, gain: 0.25, start: s, env: swell(0.05) });
    for (const s of [0.18, 0.23, 0.28]) click(o, { start: s, gain: 0.16, f: 2600, len: 0.005 });
    osc(o, { f0: 120, f1: 58, dur: 0.16, gain: 0.55, start: 0.4, env: ad(0.003, 0.045) });
    noise(o, { dur: 0.08, f0: 380, q: 0.7, type: 'lp', gain: 0.3, start: 0.4, env: ad(0.002, 0.025), color: 'brown' });
    return mixTo(o, 0.4);
  },
  snore: () => {                                      // a pet asleep: a slow breath in with a little purr, a soft "pff" out
    const o = buf(1.7);
    noise(o, { dur: 0.75, f0: 420, f1: 520, q: 1.6, gain: 0.3, env: (t) => swell(0.75)(t) * (0.6 + 0.4 * Math.sin(TAU * 26 * t) ** 2),
      color: 'brown' });
    osc(o, { type: 'tri', f0: 92, f1: 104, dur: 0.7, gain: 0.12, env: swell(0.7), vib: 0.04, vibRate: 26 });
    noise(o, { dur: 0.55, f0: 1500, f1: 900, q: 0.9, gain: 0.16, start: 0.95, env: (t) => (t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) / 0.16)) });
    return mixTo(lowpass(o, 3000), 0.3);
  },
};

// ---- recipes shared by several sounds ---------------------------------------------------------------------------
/** A brass voice: saw + a slightly sharp saw through a low-pass that opens with the loudness ("brassy" attack). */
function brass(o, f, start, dur, gain = 0.3) {
  const b = buf(dur + 0.12);
  const env = ahr(0.035, dur + 0.1, 0.12);
  osc(b, { type: 'saw', f0: f, dur: dur + 0.1, gain, env, vib: 0.005, vibRate: 5.5 });
  osc(b, { type: 'saw', f0: f * 1.004, dur: dur + 0.1, gain: gain * 0.6, env });
  const lp = biquad('lp', 600, 0.9);
  const n0 = Math.floor(start * SR);
  for (let i = 0; i < b.length && n0 + i < o.length; i++) {
    if (i % 16 === 0) lp.tune(500 + 3200 * env(i / SR));
    o[n0 + i] += lp(b[i]);
  }
}
function mallet(o, f, start, dur, gain = 0.5) {     // glockenspiel bar: bright inharmonic partials
  partials(o, { f, list: [[1, 1, dur * 0.45], [2.76, 0.32, dur * 0.18], [5.4, 0.12, dur * 0.08], [8.93, 0.05, dur * 0.05]], dur, gain, start, attack: 0.0015 });
}
function chop(f) {                                  // axe into wood: thock + chips
  const o = buf(0.35);
  pluck(o, { f, dur: 0.22, gain: 0.8, bright: 0.35, decay: 0.92 });
  noise(o, { dur: 0.1, f0: 1600, q: 1.2, gain: 0.6, env: ad(0.001, 0.02) });
  click(o, { gain: 0.35, f: 2200, len: 0.005 });
  for (let i = 0; i < 4; i++) click(o, { start: 0.04 + rnd() * 0.12, gain: 0.08, f: 3500 });
  return mixTo(o, 0.62);
}
function ping(a, b) {                               // map ping: two bright notes with a bounce
  const o = buf(0.9);
  fmBell(o, { f: hz(a), ratio: 2, index: 1.2, dur: 0.5, gain: 0.35, tau: 0.18 });
  fmBell(o, { f: hz(b), ratio: 2, index: 1.2, dur: 0.7, gain: 0.35, start: 0.1, tau: 0.25 });
  return mixTo(reverb(o, { wet: 0.25, tail: 0.4 }), 0.42);
}
function bird(notes, gap) {                         // FM-ish chirp sequence with a little reverb
  const total = notes.reduce((s, [, , d]) => s + d + gap, 0) + 0.1;
  const o = buf(total);
  let t = 0;
  for (const [a, b, d] of notes) {
    osc(o, { f0: a, f1: b, dur: d, gain: 0.4, start: t, env: (x) => Math.sin(Math.PI * clamp01(x / d)) ** 1.5, vib: 0.015, vibRate: 40 });
    t += d + gap;
  }
  return mixTo(reverb(o, { wet: 0.25, tail: 0.5 }), 0.4);
}

// ---- output -----------------------------------------------------------------------------------------------------
function wav(data) {
  const bytes = Buffer.alloc(44 + data.length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + data.length * 2, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SR, 24); bytes.writeUInt32LE(SR * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2);
  return bytes;
}

/** Loops are flagged in the manifest so the runtime plays them with loop = true. */
const LOOPS = new Set(['amb_crickets', 'amb_wind', 'amb_rain', 'amb_water', 'hooves', 'reel', 'amb_interior']);

// ---- Ogg Opus (SV-05: the 63 WAVs were 4.2 MB of a 6 MB cold load) ---------------------------------------------------
// This machine has no Opus encoder (no ffmpeg / opusenc / oggenc), but Chrome carries libopus behind WebCodecs: each
// sound is resampled to 48 kHz and encoded by `AudioEncoder` in a headless Chrome page, and the packets are muxed into
// an Ogg Opus file here (RFC 7845: OpusHead, OpusTags, audio pages whose granule positions count 48 kHz samples
// including the pre-skip; the last page's granule trims the encoder's padding, so a decoded sound has exactly its
// original length). A loop is encoded with its own tail in front and a pre-skip that hides it, so the codec starts
// warm on exactly the samples the loop ends with and the seam stays seamless. The WAVs stay as the fallback for a
// browser that cannot decode Ogg Opus (audio.js asks `canPlayType` and falls back per file).
const OPUS_RATE = 48_000;
const OPUS_KBPS = (name) => (/^i_|^pluck$/.test(name) ? 96 : LOOPS.has(name) && name.startsWith('amb_') ? 48 : 64);
const LOOP_WARM_S = 0.25;
const LOOKAHEAD = 312;                                 // libopus at 48 kHz (the encoder's OpusHead confirms it per file)
const FRAME = 960;                                     // 20 ms packets

/**
 * Pre- and post-roll (source samples) for a loop of n samples. Decoders trim the end only inside the LAST packet
 * (FFmpeg's end trimming is one packet's skip), so the post-roll plus the encoder's padding must stay under one
 * frame: the pre-roll is chosen so the loop ends 240 samples into a frame, and a 480-sample post-roll (10 ms at
 * 48 kHz, longer than the codec's look-ahead) then ends the stream with 720 samples to trim.
 */
export function loopPads(n) {
  const k = OPUS_RATE / SR;
  const data48 = Math.round(n * k);
  const base = Math.round(LOOP_WARM_S * SR) & ~1;
  for (let warm = base; warm < base + 2 * FRAME; warm += 2) {
    const r = (LOOKAHEAD + Math.round(warm * k) + data48) % FRAME;
    if (Math.abs(r - 240) <= 1) return { warm: Math.min(warm, n), post: Math.min(Math.round(480 / k), n) };
  }
  return { warm: Math.min(base, n), post: Math.min(Math.round(480 / k), n) };
}
const VENDOR = 'harvest-hollow make-sfx (libopus via WebCodecs)';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** The Ogg page checksum (CRC-32, polynomial 0x04c11db7, no reflection, initial value 0). */
export function oggCrc(bytes) {
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  return crc >>> 0;
}

/** One Ogg page holding whole packets (Buffers). flags: 2 = first page, 4 = last page. */
export function oggPage({ flags = 0, granule, serial, seq, packets }) {
  const lacing = [];
  for (const p of packets) {
    for (let n = p.length; ; n -= 255) {
      lacing.push(Math.min(255, n));
      if (n < 255) break;
    }
  }
  if (lacing.length > 255) throw new Error('ogg: too many segments on one page');
  const head = Buffer.alloc(27 + lacing.length);
  head.write('OggS', 0, 'latin1');
  head[4] = 0;
  head[5] = flags;
  head.writeBigInt64LE(BigInt(granule), 6);
  head.writeUInt32LE(serial >>> 0, 14);
  head.writeUInt32LE(seq >>> 0, 18);
  head.writeUInt32LE(0, 22);
  head[26] = lacing.length;
  for (let i = 0; i < lacing.length; i++) head[27 + i] = lacing[i];
  const page = Buffer.concat([head, ...packets]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

/** An OpusHead for mono with this pre-skip (RFC 7845 §5.1). */
export function opusHead(preSkip, inputRate = SR) {
  const h = Buffer.alloc(19);
  h.write('OpusHead', 0, 'latin1');
  h[8] = 1;                                            // version
  h[9] = 1;                                            // channels
  h.writeUInt16LE(preSkip, 10);
  h.writeUInt32LE(inputRate, 12);
  h.writeInt16LE(0, 16);                               // output gain
  h[18] = 0;                                           // mapping family 0: mono / stereo
  return h;
}

/**
 * Mux Opus packets into an Ogg Opus file.
 * @param {{ preSkip: number, packets: Buffer[], sizes: number[], samples: number, serial: number, inputRate?: number }} o
 *   sizes: 48 kHz samples per packet; samples: the decoded length wanted at 48 kHz (after the pre-skip)
 */
export function muxOggOpus({ preSkip, packets, sizes, samples, serial, inputRate = SR }) {
  const tags = Buffer.alloc(8 + 4 + Buffer.byteLength(VENDOR) + 4);
  tags.write('OpusTags', 0, 'latin1');
  tags.writeUInt32LE(Buffer.byteLength(VENDOR), 8);
  tags.write(VENDOR, 12, 'utf8');
  tags.writeUInt32LE(0, 12 + Buffer.byteLength(VENDOR));
  const pages = [oggPage({ flags: 2, granule: 0, serial, seq: 0, packets: [opusHead(preSkip, inputRate)] }),
    oggPage({ flags: 0, granule: 0, serial, seq: 1, packets: [tags] })];
  const end = preSkip + samples;
  let cum = 0;
  let cur = [];
  let segs = 0;
  let bytes = 0;
  const flush = (last) => {
    pages.push(oggPage({ flags: last ? 4 : 0, granule: last ? Math.min(cum, end) : cum, serial, seq: pages.length, packets: cur }));
    cur = []; segs = 0; bytes = 0;
  };
  packets.forEach((p, i) => {
    const s = Math.floor(p.length / 255) + 1;
    if (cur.length && (segs + s > 255 || bytes + p.length > 4096)) flush(false);
    cur.push(p); segs += s; bytes += p.length; cum += sizes[i];
  });
  if (cur.length) flush(true);
  if (cum < end) throw new Error(`ogg: the packets hold ${cum} samples, ${end} are needed`);
  return Buffer.concat(pages);
}

/** A stable 32-bit serial number per sound name (Ogg wants one per logical stream). */
const serialOf = (name) => [...name].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

/**
 * Encode every sound to Ogg Opus in one headless Chrome page (WebCodecs), then decode each result there again and
 * compare it with the source: length (exact, +-1 sample at 48 kHz), correlation, and the seam of every loop.
 * @param {Map<string, Float32Array>} sounds
 * @returns {Promise<Map<string, { ogg: Buffer, check: object }>>}
 */
async function encodeOpus(sounds) {
  const http = await import('node:http');
  const { default: puppeteer } = await import('puppeteer-core');
  // WebCodecs needs a secure context: a page from http://127.0.0.1 is one
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><title>sfx</title>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--mute-audio'] });
  const out = new Map();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${srv.address().port}/`);
    for (const [name, data] of sounds) {
      const loop = LOOPS.has(name);
      const { warm, post } = loop ? loopPads(data.length) : { warm: 0, post: 0 };
      // a loop is encoded as [its tail | the loop | its head]: the pre-skip hides the tail and the last page's granule
      // cuts the head, so the codec is warm on both sides of the seam (an encoder that runs into silence at the end
      // smears the last milliseconds toward zero: a click every time the loop wraps)
      const src = loop ? Float32Array.from([...data.subarray(data.length - warm), ...data, ...data.subarray(0, post)]) : data;
      const enc = await page.evaluate(async ({ b64, n, sr, rate, kbps }) => {
        const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const f32 = new Float32Array(raw.buffer);
        const len = Math.round((n * rate) / sr);
        const ctx = new OfflineAudioContext(1, len, rate);
        const ab = ctx.createBuffer(1, n, sr);
        ab.copyToChannel(f32, 0);
        const s = ctx.createBufferSource();
        s.buffer = ab;
        s.connect(ctx.destination);
        s.start();
        const pcm = (await ctx.startRendering()).getChannelData(0);
        const packets = [];
        const sizes = [];
        let head = null;
        let err = null;
        const encoder = new AudioEncoder({
          output: (chunk, meta) => {
            const b = new Uint8Array(chunk.byteLength);
            chunk.copyTo(b);
            let bin = '';
            for (const x of b) bin += String.fromCharCode(x);
            packets.push(btoa(bin));
            sizes.push(Math.round(((chunk.duration ?? 20000) * rate) / 1e6));
            const d = meta && meta.decoderConfig && meta.decoderConfig.description;
            if (d && !head) head = [...new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer)];
          },
          error: (e) => { err = String(e); },
        });
        encoder.configure({ codec: 'opus', sampleRate: rate, numberOfChannels: 1, bitrate: kbps * 1000 });
        encoder.encode(new AudioData({ format: 'f32', sampleRate: rate, numberOfFrames: len, numberOfChannels: 1, timestamp: 0, data: pcm }));
        await encoder.flush();
        encoder.close();
        return { packets, sizes, head, len, err };
      }, { b64: Buffer.from(src.buffer, src.byteOffset, src.byteLength).toString('base64'), n: src.length, sr: SR, rate: OPUS_RATE, kbps: OPUS_KBPS(name) });
      if (enc.err) throw new Error(`${name}: the Opus encoder failed: ${enc.err}`);
      // the encoder's own OpusHead says how many samples its lookahead delays the stream (312 at 48 kHz today)
      const lookahead = enc.head && enc.head.length >= 12 ? enc.head[10] | (enc.head[11] << 8) : 312;
      const warm48 = Math.round((warm * OPUS_RATE) / SR);
      const samples = Math.round((data.length * OPUS_RATE) / SR);
      const ogg = muxOggOpus({ preSkip: lookahead + warm48, packets: enc.packets.map((p) => Buffer.from(p, 'base64')), sizes: enc.sizes,
        samples, serial: serialOf(name) });
      // the round trip, in the same browser: what a player's Chrome will decode
      // decoded at 48 kHz (a typical AudioContext rate: no resampling after the decoder) against the source resampled
      // the same way the encoder's input was
      const check = await page.evaluate(async ({ b64, ref, sr, rate, loop: isLoop }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const src = new Float32Array(Uint8Array.from(atob(ref), (c) => c.charCodeAt(0)).buffer);
        const len = Math.round((src.length * rate) / sr);
        const rs = new OfflineAudioContext(1, len, rate);
        const ab = rs.createBuffer(1, src.length, sr);
        ab.copyToChannel(src, 0);
        const node = rs.createBufferSource();
        node.buffer = ab;
        node.connect(rs.destination);
        node.start();
        const want = (await rs.startRendering()).getChannelData(0);
        const got = (await new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes.buffer)).getChannelData(0);
        const n = Math.min(got.length, want.length);
        let sxy = 0; let sxx = 0; let syy = 0;
        for (let i = 0; i < n; i++) { sxy += got[i] * want[i]; sxx += got[i] * got[i]; syy += want[i] * want[i]; }
        const corr = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 1;
        let seam = null;
        if (isLoop) {
          // the jump across the loop point against the typical step inside the loop
          const steps = [];
          for (let i = 1; i < got.length; i += 7) steps.push(Math.abs(got[i] - got[i - 1]));
          steps.sort((a, b) => a - b);
          const p99 = steps[Math.floor(steps.length * 0.99)] || 1e-9;
          seam = +(Math.abs(got[0] - got[got.length - 1]) / p99).toFixed(3);
        }
        return { length: got.length, want: want.length, corr: +corr.toFixed(4), seam };
      }, { b64: ogg.toString('base64'), ref: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'), sr: SR, rate: OPUS_RATE, loop });
      out.set(name, { ogg, check });
    }
  } finally {
    await browser.close().catch(() => {});
    srv.close();
  }
  return out;
}

async function main() {
  if (process.argv.includes('--list')) {
    console.log(Object.keys(SOUNDS).join('\n'));
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = { sampleRate: SR, sounds: {} };
  const rendered = new Map();
  let bytes = 0;
  for (const [name, make] of Object.entries(SOUNDS)) {
    const data = make();
    for (const v of data) if (!Number.isFinite(v)) throw new Error(`${name}: non-finite sample`);
    // the exact 16-bit samples the WAV holds, so the Ogg encodes (and is checked against) the same signal
    const q = Float32Array.from(data, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767))) / 32767);
    rendered.set(name, q);
    const file = wav(data);
    fs.writeFileSync(path.join(OUT, `${name}.wav`), file);
    bytes += file.length;
    manifest.sounds[name] = { file: `${name}.wav`, ms: Math.round((data.length / SR) * 1000), ...(LOOPS.has(name) ? { loop: true } : {}) };
  }
  let oggBytes = 0;
  const bad = [];
  const worst = { corr: 1, corrOf: null, seam: 0, seamOf: null };
  if (!process.argv.includes('--no-ogg')) {
    const encoded = await encodeOpus(rendered);
    for (const [name, { ogg, check }] of encoded) {
      if (Math.abs(check.length - check.want) > 1) bad.push(`${name}: decodes to ${check.length} samples, ${check.want} wanted`);
      if (check.corr < 0.5) bad.push(`${name}: correlation ${check.corr} with the source`);
      if (check.seam !== null && check.seam > 1.5) bad.push(`${name}: the loop seam jumps ${check.seam} x the 99th-percentile step`);
      if (check.corr < worst.corr) Object.assign(worst, { corr: check.corr, corrOf: name });
      if (check.seam !== null && check.seam > worst.seam) Object.assign(worst, { seam: check.seam, seamOf: name });
      fs.writeFileSync(path.join(OUT, `${name}.ogg`), ogg);
      oggBytes += ogg.length;
      manifest.sounds[name].ogg = `${name}.ogg`;
    }
    if (bad.length) throw new Error(`Ogg Opus round trip failed:\n  ${bad.join('\n  ')}`);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(JSON.stringify({ ok: true, sounds: Object.keys(SOUNDS).length, kb: Math.round(bytes / 1024), oggKb: Math.round(oggBytes / 1024),
    worst, dir: path.relative(ROOT, OUT) }));
}

// run only as a script: test/sync.audio.test.js imports the Ogg muxer
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exitCode = 1; });
}
