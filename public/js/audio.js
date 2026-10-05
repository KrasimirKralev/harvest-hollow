// Audio engine (GDD §8.5, visual-ux-juice §3.11): WebAudio buses, sample SFX with pitch/pan/voice limits, a music
// director that plays composed tracks (below), a generative music engine as its fallback (calm 60-80 BPM, pentatonic,
// fingerpicked plucks + pads + upright bass + glockenspiel; day, night and Golden Hour variants) and ambience
// layers (birds by day, crickets and an owl at night, a breeze, rain, water, village bells). Samples come from
// tools/make-sfx.mjs (public/assets/audio/*.ogg, Opus, with *.wav as the per-file fallback, + manifest.json). Owned by
// the client lane.
//
// Music director (owner request 2026-10-04: "improve the music to be not so much generic"). Composed CC0 acoustic and
// folk tracks (public/assets/audio/music/: tracks.json is the one list the director and Settings > Credits read;
// CREDITS.md says where each came from and how the files were made). The director:
//   - picks a scene (musicContext: title > fair > evening (Golden Hour) > rain > night > evening (dusk) > day), then a
//     track from that scene's pool (pickTrack: never the track that just played, never a failed one; a pool with
//     nothing left borrows from MUSIC_FALLBACK, and with nothing at all the generative engine plays one piece);
//   - plays a track to its end, then rests 30-60 s (GDD §8.5); a scene the playing track does not fit cross-fades
//     (4 s) to one that does: at once for an event (the Fair, Golden Hour, the title screen ending), after the change
//     has held 8 s for the time of day and the weather (no flapping on a rain shower's edge);
//   - festive() fades the current track out under the fanfare, then the Fair's track plays once.
// Why streaming and not decodeAudioData: a decoded 3-minute stereo track is ~60 MB of float32, two of them during a
// cross-fade ~120 MB, too much for a phone. Two HTMLAudioElements (decks A and B) stream instead, each wired once
// through createMediaElementSource -> its own fade gain -> the music bus, so volume, mute and duck() apply exactly as
// they did to the generative bed. Elements are reused by swapping src (an element can be wired to WebAudio once).
// iOS: a media element may start sound by itself only after one play() inside a user gesture; the existing unlock
// gesture "blesses" both decks by playing a 50 ms silent WAV on each, so later track starts need no gesture. Format:
// Ogg Vorbis where canPlayType says so, else AAC in MP4 (Safari); a track that does not decode (or load) is tried in
// the other format for that attempt (the next track starts with the best format again). A track that still does not load is
// marked failed (2 minutes after a network error, 10 after a decode error: a restarting server heals) and another one
// plays; the generative engine plays only when no track can. On a phone the
// active deck pauses with the page hidden or the context interrupted and resumes after. Muted or music at 0: no track
// streams at all.
//
//   audio.init({ now, dayMode? }) -> Promise   creates the (suspended) AudioContext, fetches + decodes every sample;
//                                            the context resumes on the first pointer/key gesture (autoplay policy)
//   audio.play(name, { pan, rate, gain, bus, partner, at }) -> boolean   one SFX ('sfx' bus by default, 'ui' for
//                                            UI blips); pan -1..1; ±4 % random pitch unless `rate` is given;
//                                            partner: true = the partner's action (-6 dB, GDD §7.2)
//   audio.ladder(step, opts)                 the pentatonic pluck ladder of a drag stroke (C D E G A c d e ...)
//   audio.coins(n, opts)                     up to 8 coin dings staggered 40 ms (GDD §7.2 "Sell")
//   audio.duck(seconds)                      music -6 dB under a fanfare
//   audio.setScene({ golden?, rain?, wet?, birdbath?, animals?, water?, village?, interior? })   Golden Hour variant / rain
//                                            (wave 4: rain 0..1 = drizzle .. downpour, two layers; wet 0..1 = drips from
//                                            the roofs after it; birdbath 1 = a bath on screen: a bird lands and splashes
//                                            now and then) / distant
//                                            animal calls (every species on the farm) / water lapping 0..1 (a pond or the
//                                            river near the camera) / village bells now and then once Town Projects stand /
//                                            interior: true while my farmer is inside the farmhouse (M2): the fire and the
//                                            clock indoors, the outdoor layers muffled through the walls
//   audio.festive({ show? })                 the County Fair ceremony (GDD §5.6): a fanfare now, and the next music piece
//                                            is the festive 'fair' variant (the current one ends at its phrase boundary);
//                                            show: the horse show ran this week (M2): its post-horn call follows
//   audio.loop(name, on, { gain })           a looping sample on the sfx bus (the hooves while riding), faded in / out
//   audio.setDayMode('cycle' | 'day' | 'real')     follows the sky setting (game/daycycle.js)
//   audio.setVolume(channel, 0..1) / audio.volumes() / audio.setMuted(bool) / audio.muted
//        channels: master music ambience sfx ui (GDD §8.5 defaults 0.8 0.35 0.5 0.7 0.6); persisted per browser
//        in localStorage 'hh.audio'
//   audio.setScene({ title })                true / false: the title screen (default: the slot picker is showing);
//                                            null: back to that default
//   audio.info() -> { ready, unlocked, state, loaded, music: { mode, playing, track, title, context, variant, bar,
//                                            piece, format, failed, ... }, voices }   mode 'tracks' | 'generative'
//                                            ('pending' while the track list loads)
//   audio.force(variant | null, { generative?, trace?, ahead? })   dev/test: pin the music scene ('day' 'evening'
//                                            'night' 'rain' 'fair' 'title'; 'golden' = 'evening') or one track by id
//                                            ('rain-inn') and start it now; generative / trace / ahead: the generative
//                                            engine with that variant ('day' 'night' 'golden' 'fair'); null: follow
//                                            the scene again
//   audio.record(seconds)                    dev/test: capture the master output
//   audio.unlock()                           resume now (called from the first gesture; safe to call again)
// Phones (mobile wave 2026-10-03): the context resumes on any activating gesture, touchend / pointerup / click
// included (iOS Safari does not let a touchstart or a touch pointerdown start audio), and comes back after an iOS
// interruption (a call, Siri) on the next touch. On a touch-first device the context is suspended while the page is
// hidden (a locked phone must not play music in a pocket) and resumed when it shows again.
import { fromPack } from './net/packs.js';
import { dayPhase } from './game/daycycle.js';

const DEFAULTS = Object.freeze({ master: 0.8, music: 0.35, ambience: 0.5, sfx: 0.7, ui: 0.6 });
const STORE_KEY = 'hh.audio';
const MAX_VOICES = 28;
const MIN_GAP_S = 0.028;                        // the same sound twice within this gap is skipped (drag storms)
const PENTA = [0, 2, 4, 7, 9];                  // major pentatonic degrees
const BASE = { i_pluck: 60, i_banjo: 60, i_bass: 36, i_mallet: 72, i_marimba: 60, i_piano: 60, pluck: 72 };
/** The music engine's make-up gain: at the default music volume (0.35) the bed sits ~10 dB under the SFX. */
const MUSIC_GAIN = 1.6;
/** Gestures that may start audio: iOS Safari takes only the activating ones (touchend, pointerup, click, keydown). */
export const UNLOCK_EVENTS = Object.freeze(['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown']);
/** A phone or tablet (no hover, coarse pointer): its audio sleeps while the page is hidden. */
const touchFirst = () => { try { return Boolean(window.matchMedia?.('(hover: none) and (pointer: coarse)').matches); } catch { return false; } };

const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* private mode */ } };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const S = {
  ctx: null, now: () => Date.now(), dayMode: 'cycle', buffers: new Map(), manifest: null, ready: false,
  unlocked: false, bus: {}, last: new Map(), voices: 0, settings: { ...DEFAULTS, muted: false },
  scene: { golden: false, rain: 0, wet: 0, birdbath: 0, animals: [], water: 0, village: 0, fair: false, interior: false }, music: null, amb: null,
  timer: null,
  reverb: null, forced: null, loops: new Map(),
  trace: null, traceT0: 0,
  dir: null, q: '',
};

// ---- music director: the pure part (test/audio-music.test.js) -------------------------------------------------------
/** The scenes the director plays for, most specific first (musicContext). */
export const MUSIC_CONTEXTS = Object.freeze(['title', 'fair', 'evening', 'rain', 'night', 'day']);
/** Where a scene borrows a track when its own pool has nothing playable (failed, or the one that just played). */
export const MUSIC_FALLBACK = Object.freeze({
  title: Object.freeze(['day']), fair: Object.freeze(['evening', 'day']), evening: Object.freeze(['day']),
  rain: Object.freeze(['night', 'evening']), night: Object.freeze(['rain', 'evening']), day: Object.freeze(['evening']),
});
/** The generative engine's variant for a scene (the fallback, and force() with { generative: true }). */
const GEN_VARIANT = Object.freeze({ title: 'day', day: 'day', evening: 'golden', night: 'night', rain: 'night', fair: 'fair' });

/**
 * The scene the music should fit, from the title screen, the Fair, Golden Hour, the weather and the sky. Pure.
 * @param {{ title?: boolean, fair?: boolean, golden?: boolean, rain?: boolean, light?: number, phase?: string }} [s]
 * @returns {'title'|'fair'|'evening'|'rain'|'night'|'day'}
 */
export function musicContext({ title = false, fair = false, golden = false, rain = false, light = 1, phase = 'day' } = {}) {
  if (title) return 'title';
  if (fair) return 'fair';
  if (golden) return 'evening';
  if (rain) return 'rain';
  if (light < 0.5) return 'night';
  if (phase === 'dusk') return 'evening';
  return 'day';
}

/** The tracks that may play in a scene (manifest order). Pure. */
export function musicPool(tracks, context) {
  return tracks.filter((t) => Array.isArray(t.moods) && t.moods.includes(context));
}

/**
 * The next track for a scene: one of its pool, else of its fallbacks (MUSIC_FALLBACK) in order, never `last` (no track
 * twice in a row) and never one in `failed`; null when none is left (the generative engine plays a piece instead).
 * Deterministic for a given `random` (() => 0 <= r < 1). Pure.
 * @param {Array<{ id: string, moods: string[] }>} tracks
 * @param {string} context
 * @param {{ last?: string|null, failed?: Iterable<string>, random?: () => number }} [o]
 */
export function pickTrack(tracks, context, { last = null, failed = [], random = Math.random } = {}) {
  const bad = new Set(failed);
  for (const c of [context, ...(MUSIC_FALLBACK[context] ?? [])]) {
    const pool = musicPool(tracks, c).filter((t) => t.id !== last && !bad.has(t.id));
    if (pool.length) return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  }
  return null;
}

/**
 * The music formats this browser can stream, best first: Ogg Vorbis, AAC in MP4 (Safari). Empty: generative only. Pure.
 * @param {(type: string) => string} canPlay  an HTMLMediaElement's canPlayType
 * @returns {Array<'ogg'|'m4a'>}
 */
export function musicFormats(canPlay) {
  const ok = (type) => { try { return /probably|maybe/.test(canPlay(type) || ''); } catch { return false; } };
  return [['ogg', 'audio/ogg; codecs="vorbis"'], ['m4a', 'audio/mp4; codecs="mp4a.40.2"']].filter(([, type]) => ok(type)).map(([f]) => f);
}

// ---- graph ------------------------------------------------------------------------------------------------------
function makeImpulse(ctx, seconds = 2.4, decay = 2.6) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** decay * (i < 80 ? i / 80 : 1);
  }
  return ir;
}

function buildGraph(ctx) {
  const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
  const master = g(0);
  master.connect(comp).connect(ctx.destination);
  const music = g(0);
  const duck = g(1);
  music.connect(duck).connect(master);
  const ambience = g(0);
  ambience.connect(master);
  const sfx = g(0);
  sfx.connect(master);
  const ui = g(0);
  ui.connect(master);
  // music reverb send (a generated hall: softens plucks into "cozy")
  const verb = ctx.createConvolver();
  verb.buffer = makeImpulse(ctx);
  const verbIn = g(0.32);
  verbIn.connect(verb).connect(music);
  // distant layer for ambience animal calls (low-passed, quiet)
  const far = ctx.createBiquadFilter();
  far.type = 'lowpass'; far.frequency.value = 1400;
  far.connect(ambience);
  S.bus = { master, music, duck, ambience, sfx, ui, verbIn, far };
  applyVolumes(0.05);
}

function applyVolumes(ramp = 0.15) {
  if (!S.ctx) return;
  const t = S.ctx.currentTime;
  const v = S.settings;
  const set = (node, val) => { node.gain.cancelScheduledValues(t); node.gain.setTargetAtTime(val, t, ramp); };
  set(S.bus.master, v.muted ? 0 : v.master);
  set(S.bus.music, v.music);
  set(S.bus.ambience, v.ambience);
  set(S.bus.sfx, v.sfx);
  set(S.bus.ui, v.ui);
}

// ---- sample playback --------------------------------------------------------------------------------------------
/** Start a buffer; returns { src, gain } or null. dest: an AudioNode. */
function voice(name, { rate = 1, gain = 1, pan = 0, at = 0, dest, release = 0, dur = 0, send = 0 }) {
  const buf = S.buffers.get(name);
  if (!buf || !S.ctx || !dest) return null;
  const ctx = S.ctx;
  const when = Math.max(ctx.currentTime, at || 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const amp = ctx.createGain();
  amp.gain.value = gain;
  let tail = amp;
  if (pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    amp.connect(p);
    tail = p;
  }
  src.connect(amp);
  tail.connect(dest);
  if (send > 0 && S.bus.verbIn) {
    const s = ctx.createGain();
    s.gain.value = send;
    tail.connect(s).connect(S.bus.verbIn);
  }
  S.voices++;
  src.onended = () => { S.voices--; try { src.disconnect(); amp.disconnect(); } catch { /* already gone */ } };
  src.start(when);
  if (dur > 0 && release > 0) {                // cut a long sample with a soft release (piano, sustained notes)
    amp.gain.setValueAtTime(gain, when + dur);
    amp.gain.linearRampToValueAtTime(0.0001, when + dur + release);
    src.stop(when + dur + release + 0.02);
  }
  return { src, gain: amp };
}

const midiRate = (inst, midi) => 2 ** ((midi - (BASE[inst] ?? 60)) / 12);
/** Distant calls of the species on the farm (ambience); bees hum softly. */
export const CALLS = Object.freeze({ chicken: 'cluck', cow: 'moo', sheep: 'baa', pig: 'oink', duck: 'quack', goat: 'bleat',
  horse: 'neigh', bee: 'buzz', alpaca: 'hum', rabbit: 'bunny' });
/** Indoors (the farmhouse interior, M2) the outdoor ambience is heard through the walls at this share. */
export const INDOOR_K = 0.28;
/** Rain this hard (0..1) counts as rain for the music and the birds (wave 4: the level follows the weather). */
export const RAIN_ON = 0.15;
/** The drizzle layer: the rain loop played this much faster (lighter, quicker drops). */
const DRIZZLE_RATE = 1.45;

/**
 * The two rain layers' gains for a rain level 0..1 (wave 4, wish 12): a drizzle is the light, quick layer alone; the
 * steady rain fades in from a third of the way and carries a downpour at 1 (its old fixed level was 0.6). Pure.
 * @returns {{ drizzle: number, rain: number }}
 */
export function rainMix(level) {
  const r = Number.isFinite(level) ? clamp(level, 0, 1) : 0;
  const heavy = clamp((r - 0.3) / 0.7, 0, 1);
  return { drizzle: r < 0.02 ? 0 : 0.42 * Math.min(1, r / 0.3) * (1 - 0.6 * heavy), rain: 0.68 * heavy ** 0.8 };
}

/** The sample file for one manifest entry: Ogg Opus when this browser decodes it, else the WAV (SV-05). */
export function sampleFile(entry, oggOk) {
  return oggOk && typeof entry.ogg === 'string' ? entry.ogg : entry.file;
}
function canOgg() {
  try {
    return /probably|maybe/.test(document.createElement('audio').canPlayType('audio/ogg; codecs=opus'));
  } catch {
    return false;
  }
}

// ---- music: a generative piece at a time --------------------------------------------------------------------------
// Chord roots as major-scale degrees with their triads (semitones above the key).
const CHORDS = { I: [0, 4, 7], ii: [2, 5, 9], iii: [4, 7, 11], IV: [5, 9, 12], V: [7, 11, 14], vi: [9, 12, 16] };
const PROGRESSIONS = [
  ['I', 'IV', 'I', 'V'], ['I', 'vi', 'IV', 'V'], ['I', 'V', 'vi', 'IV'], ['I', 'IV', 'V', 'I'], ['vi', 'IV', 'I', 'V'],
  ['I', 'iii', 'IV', 'V'], ['IV', 'I', 'V', 'I'], ['I', 'ii', 'IV', 'V'], ['I', 'IV', 'vi', 'V'],
];
const RHYTHMS = [                                 // 16 eighth-steps (2 bars): 1 = a note starts
  [1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  [1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0],
];
const VARIANTS = {
  // tempo, key choices, instruments, layer densities, pad brightness
  day: { bpm: [68, 76], keys: [60, 62, 65, 67], melody: ['i_banjo', 'i_mallet', 'i_pluck'], arp: 'i_pluck', arpDensity: 0.85,
    padCut: 1100, bass: 'walk', melodyOct: 12, sparkle: 0.12, answer: 'i_marimba' },
  night: { bpm: [58, 64], keys: [60, 62, 65], melody: ['i_piano'], arp: 'i_marimba', arpDensity: 0.35, padCut: 700,
    bass: 'whole', melodyOct: 0, sparkle: 0.04, answer: 'i_piano', lo: 4, hi: 12 },
  golden: { bpm: [66, 72], keys: [62, 65, 67], melody: ['i_mallet', 'i_banjo'], arp: 'i_pluck', arpDensity: 0.75, padCut: 1500,
    bass: 'walk', melodyOct: 12, sparkle: 0.3, answer: 'i_marimba' },
  // the County Fair ceremony (GDD §5.6, §8.5 "1 per festival"): a quick-step banjo tune over an oom-pah bass, bright
  // pads, glockenspiel on most downbeats; one shorter piece (A A' B A), then the evening music returns
  fair: { bpm: [100, 108], keys: [62, 65, 67], melody: ['i_banjo'], arp: 'i_pluck', arpDensity: 0.95, padCut: 1900,
    bass: 'oompah', melodyOct: 12, sparkle: 0.5, answer: 'i_mallet', sections: 4 },
};

/** Build one piece: sections of 4-bar phrases with a motif, its answer, an arp pattern and a progression per section. */
function composePiece(variant) {
  const V = VARIANTS[variant];
  const key = pick(V.keys);
  const bpm = Math.round(rand(V.bpm[0], V.bpm[1]));
  const progA = pick(PROGRESSIONS);
  let progB = pick(PROGRESSIONS);
  if (progB === progA) progB = PROGRESSIONS[(PROGRESSIONS.indexOf(progA) + 3) % PROGRESSIONS.length];
  const lo = V.lo ?? 2;
  const hi = V.hi ?? 11;
  const motif = () => {
    const rhythm = pick(RHYTHMS);
    let idx = lo + 3 + Math.floor(rand(0, 4));    // index into a 3-octave pentatonic ladder
    return rhythm.map((on) => {
      if (!on) return null;
      idx = clamp(idx + pick([-2, -1, -1, 0, 1, 1, 2]), lo, hi);
      return idx;
    });
  };
  const call = motif();
  const answer = motif();
  answer[answer.length - 1] = null;
  const arp = [0, 2, 1, 2, 0, 2, 1, 3];             // Travis-style: thumb on 0/1, fingers on 2/3
  // A A' B A | C (melody rests: the arpeggio breathes) A' B A: 34 bars, about 2 minutes at 70 BPM (GDD §8.5: 2-3 min)
  const sections = [
    { prog: progA, melody: true }, { prog: progA, melody: true, vary: true }, { prog: progB, melody: true, answerOnly: true },
    { prog: progA, melody: true }, { prog: progB, melody: false }, { prog: progA, melody: true, vary: true },
    { prog: progB, melody: true, answerOnly: true }, { prog: progA, melody: true },
  ].slice(0, V.sections ?? 8);
  const melodyInst = pick(V.melody);
  return { variant, V, key, bpm, call, answer, arp, sections, melodyInst, bars: 1 + sections.length * 4 + 2 };
}

function ladderMidi(key, idx, oct) {               // pentatonic index -> midi
  return key + oct + PENTA[idx % 5] + 12 * Math.floor(idx / 5) - 12;
}

/** Pad: detuned oscillators through a low-pass, slow attack/release, one chord per bar. */
function pad(midis, t, dur, cutoff, gain) {
  const ctx = S.ctx;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.4;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.linearRampToValueAtTime(gain, t + Math.min(1.6, dur * 0.4));
  amp.gain.setValueAtTime(gain, t + dur);
  amp.gain.linearRampToValueAtTime(0.0001, t + dur + 1.8);
  lp.connect(amp);
  amp.connect(S.bus.music);
  const send = ctx.createGain();
  send.gain.value = 0.5;
  amp.connect(send).connect(S.bus.verbIn);
  const oscs = [];
  for (const m of midis) {
    for (const [type, cents, g] of [['triangle', -7, 0.5], ['sawtooth', 6, 0.18]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 440 * 2 ** ((m - 69) / 12);
      o.detune.value = cents;
      const og = ctx.createGain();
      og.gain.value = g / midis.length;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + dur + 2);
      oscs.push(o);
    }
  }
  oscs[0].onended = () => { try { lp.disconnect(); amp.disconnect(); send.disconnect(); } catch { /* gone */ } };
}

/** Schedule one bar of the current piece at time t. */
function scheduleBar(m, bar, t) {
  const P = m.piece;
  const V = P.V;
  const beat = 60 / P.bpm;
  const eighth = beat / 2;
  const hum = () => rand(-0.008, 0.008);
  const intro = bar === 0;
  const outro = bar >= P.bars - 2;
  const sIdx = Math.min(P.sections.length - 1, Math.floor(Math.max(0, bar - 1) / 4));
  const sec = P.sections[sIdx];
  const inBar = Math.max(0, bar - 1) % 4;
  const chordName = intro || outro ? 'I' : sec.prog[inBar];
  const chord = CHORDS[chordName].map((s) => P.key + s);
  // phrase dynamics: each 4-bar phrase swells into its third bar and settles; the outro fades
  const swellK = [0.86, 0.96, 1.06, 0.92][inBar];
  const fade = (outro ? (bar === P.bars - 1 ? 0.45 : 0.75) : 1) * (intro ? 0.85 : swellK) * MUSIC_GAIN;
  /** One scheduled note (traced for tests: audio.force(v, { trace: true })). */
  const note = (inst, midi, at, gain, o = {}, role = inst) => {
    if (S.trace) S.trace.push({ t: +(at - S.traceT0).toFixed(3), bar, role, inst, midi, gain: +gain.toFixed(3), chord: chordName, key: P.key });
    voice(inst, { rate: midiRate(inst, midi), gain, at, dest: S.bus.music, ...o });
  };
  // pad (one per bar, overlapping release)
  // the pad adds the 9th for colour, only where it belongs to the key (not over iii, where it would be a sharp)
  const ninth = chord[0] + 2;
  const inKey = [0, 2, 4, 5, 7, 9, 11].includes((((ninth - P.key) % 12) + 12) % 12);
  const padNotes = chord.map((n) => n - 12).concat(intro || !inKey ? [] : [ninth]);
  if (S.trace) for (const n of padNotes) S.trace.push({ t: +(t - S.traceT0).toFixed(3), bar, role: 'pad', inst: 'pad', midi: n, gain: 0.05, chord: chordName, key: P.key });
  pad(padNotes, t, beat * 4, V.padCut, 0.05 * fade);
  // bass
  const root = P.key + CHORDS[chordName][0] - 24;
  if (V.bass === 'whole' || intro) {
    note('i_bass', root, t + hum(), 0.32 * fade, { dur: beat * 3.6, release: 0.5 }, 'bass');
  } else if (V.bass === 'oompah') {
    // oom (root, fifth on 3) - pah (a short chord stab on 2 and 4): the village band
    note('i_bass', root, t + hum(), 0.36 * fade, { dur: beat * 0.8, release: 0.12 }, 'bass');
    note('i_bass', root + 7, t + beat * 2 + hum(), 0.3 * fade, { dur: beat * 0.8, release: 0.12 }, 'bass');
    for (const b of [1, 3]) {
      for (const [i, c] of chord.entries()) {
        note('i_marimba', c - 12, t + beat * b + i * 0.008 + hum(), 0.09 * fade, { send: 0.15, pan: 0.2 }, 'stab');
      }
    }
  } else {
    note('i_bass', root, t + hum(), 0.34 * fade, { dur: beat * 1.8, release: 0.25 }, 'bass');
    note('i_bass', root + 7, t + beat * 2 + hum(), 0.26 * fade, { dur: beat * 1.8, release: 0.25 }, 'bass');
  }
  if (intro) return;
  // arpeggio (Travis-style: the thumb on the low root/fifth, fingers on the third and the octave)
  const tones = [chord[0] - 12, chord[1], chord[2] - 12, chord[0] + 12 > 84 ? chord[0] : chord[0] + 12];
  for (let s = 0; s < 8; s++) {
    if (Math.random() > V.arpDensity * (s % 2 === 0 ? 1 : 0.8)) continue;
    note(V.arp, tones[P.arp[s]], t + s * eighth + hum(), (s % 4 === 0 ? 0.2 : 0.14) * fade, { send: 0.25, pan: s % 2 ? 0.25 : -0.15 }, 'arp');
  }
  // melody: call on bars 0-1 of a phrase, answer on bars 2-3 (or answer instrument only)
  if (sec.melody && !outro) {
    const line = inBar < 2 ? P.call : P.answer;
    const half = inBar % 2;
    const inst = sec.answerOnly || inBar >= 2 ? (P.V.answer || P.melodyInst) : P.melodyInst;
    for (let s = 0; s < 8; s++) {
      let idx = line[half * 8 + s];
      if (idx === null || idx === undefined) continue;
      if (sec.vary && s === 7) idx += pick([-1, 1]);
      let n = ladderMidi(P.key, idx, V.melodyOct);
      // Lean to the chord: strong beats land on a chord tone when one is within a tone, and no note ever sits a
      // semitone from a chord tone (E over the IV chord, C over V): those rub in a lullaby, so they move to the
      // nearest chord tone. Pentatonic + this rule keeps every bar consonant.
      const pcs = chord.map((c) => ((c % 12) + 12) % 12);
      const nearest = chord.map((c) => c + 12 * Math.round((n - c) / 12)).sort((a, b) => Math.abs(a - n) - Math.abs(b - n) || a - b)[0];
      const rubs = !pcs.includes(((n % 12) + 12) % 12) && pcs.some((pc) => [1, 11].includes(((n - pc) % 12 + 12) % 12));
      if (rubs || (s % 4 === 0 && Math.abs(nearest - n) <= 2)) n = nearest;
      const long = inst === 'i_piano';
      note(inst, n, t + s * eighth + hum(), (inst === 'i_mallet' ? 0.16 : 0.22) * fade,
        { send: 0.35, pan: 0.1, dur: long ? beat * 1.5 : 0, release: long ? 0.6 : 0 }, 'melody');
    }
  }
  // glockenspiel sparkle on downbeats now and then: a chord tone, two octaves up
  if (Math.random() < V.sparkle) {
    const n = chord[Math.floor(rand(0, 3))] + 24;
    note('i_mallet', n > 100 ? n - 12 : n, t + beat * pick([0, 1, 2, 3]), 0.09 * fade, { send: 0.5, pan: rand(-0.5, 0.5) }, 'sparkle');
  }
}

function currentVariant() {
  if (S.forced) return S.forced;
  if (S.scene.fair) return 'fair';
  if (S.scene.golden) return 'golden';
  return dayPhase(S.now(), S.dayMode, undefined, S.createdAt).light < 0.5 ? 'night' : 'day';
}

function musicTick(lookahead) {
  const m = S.music;
  const ctx = S.ctx;
  if (!m || !ctx || ctx.state !== 'running') return;
  const horizon = ctx.currentTime + lookahead;
  while (m.nextAt < horizon) {
    if (!m.piece) {
      // a generative piece starts only when the director asks for one (armGenerative): no track could play
      if (!m.armed) return;
      m.armed = false;
      m.piece = composePiece(currentVariant());
      m.bar = 0;
      m.pieces++;
      m.nextAt = Math.max(m.nextAt, ctx.currentTime + 0.05);
    }
    scheduleBar(m, m.bar, m.nextAt);
    m.nextAt += (60 / m.piece.bpm) * 4;
    m.bar++;
    // a Golden Hour (or the Fair ceremony) that starts mid-piece ends this piece at the next phrase boundary
    const want = currentVariant();
    const switchNow = (want === 'golden' || want === 'fair') && m.piece.variant !== want && (m.bar - 1) % 4 === 0
      && m.bar < m.piece.bars - 2;
    if (switchNow) m.piece.bars = m.bar + 2;
    if (m.bar >= m.piece.bars) {
      const was = m.piece.variant;
      m.piece = null;
      const soon = switchNow || S.scene.golden !== m.wasGolden || was === 'fair' || S.scene.fair;
      m.wasGolden = S.scene.golden;
      pieceEnded(was === 'fair' ? 'fair' : null, soon, m.nextAt);    // the director rests from the piece's last bar
      return;
    }
  }
}

// ---- music director: tracks on two streaming decks (see the header) -------------------------------------------------
const MUSIC_DIR = '/assets/audio/music/';
const REST_S = [30, 60];         // GDD §8.5: silence between tracks
const SOON_S = 3;                // after the Fair's piece, or an event that arrives during a rest
const XFADE_S = 4;               // a scene change while a track plays
const HOLD_S = 8;                // a time-of-day or weather change must hold this long before the music follows
const RETRY_S = { network: 120, decode: 600 };   // a failed track may be tried again after this (a server restart heals)
/**
 * Make-up gain of the tracks on the music bus. The files are normalised to -18 LUFS (CREDITS.md). The 2026-10-04 browser
 * check recorded the master through audio.record() with only music audible: the generative bed measured -32.0 dBFS RMS
 * (day) and -32.6 (night); the tracks at gain 1 measured 0.8-1 dB above it on average (whole-track RMS minus the
 * bus's -11.1 dB), so 0.9 sets them level with the bed, and the default Music 0.35 still sits under the effects as it
 * did. A track's own `gain` in tracks.json trims what normalisation cannot (Wooden Inn's quieter file).
 */
const TRACK_GAIN = 0.9;
/** 50 ms of 8 kHz 8-bit silence: what the unlock gesture plays on each deck (iOS "blessing"), and a deck's idle source. */
const SILENT_WAV = (() => {
  const n = 400;
  const b = new Uint8Array(44 + n).fill(128, 44);
  const v = new DataView(b.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return `data:audio/wav;base64,${typeof btoa === 'function' ? btoa(bin) : ''}`;
})();

function newDirector() {
  return { mode: 'pending', list: [], formats: [], formatOk: false, decks: [], active: null, last: null, listRetry: false,
    listAt: 0,
    failed: new Map(), want: null, wantAt: 0, urgent: false, restUntil: Infinity, holdUntil: 0, nextCheck: 0,
    pin: null, pinTrack: null, forceGen: false, blocked: false, silenced: false };
}

/** Two media elements, each wired once into the music bus through its own fade gain. False: none (generative only). */
function makeDecks() {
  const D = S.dir;
  if (typeof Audio !== 'function' || typeof S.ctx.createMediaElementSource !== 'function') return false;
  try {
    for (let i = 0; i < 2; i++) {
      const el = new Audio();
      el.preload = 'none';
      el.setAttribute('playsinline', '');               // iOS: never the full-screen player
      const gain = S.ctx.createGain();
      gain.gain.value = 0;
      S.ctx.createMediaElementSource(el).connect(gain).connect(S.bus.music);
      const deck = { i, el, gain, track: null, context: null, fmt: null, fmtIdx: 0, fade: 0.05, started: false, held: false,
        blessed: false, blessing: false, stopT: 0, attempt: 0 };
      el.addEventListener('playing', () => onDeckPlaying(deck));
      el.addEventListener('ended', () => onDeckEnded(deck));
      el.addEventListener('pause', () => onDeckPaused(deck));
      el.addEventListener('error', () => onDeckError(deck, el.error));
      D.decks.push(deck);
    }
    return true;
  } catch (err) {
    console.warn('audio: no music decks; the generative music plays', err);
    D.decks = [];
    return false;
  }
}

/** Inside a user gesture: play 50 ms of silence on each deck once, so iOS lets it start tracks on its own later. */
function blessDecks() {
  // muted, or Music / Master at 0: no deck plays, not even the blessing (a later slider change is a gesture again)
  if (S.settings.muted || S.settings.music <= 0.001 || S.settings.master <= 0.001) return;
  for (const d of S.dir?.decks ?? []) {
    if (d.blessed || d.blessing || d.track) continue;
    d.blessing = true;
    const done = (ok) => {
      d.blessing = false;
      if (ok) d.blessed = true;
      if (!d.track) { try { d.el.pause(); } catch { /* gone */ } }
    };
    try {
      d.el.src = SILENT_WAV;
      const p = d.el.play();
      if (p && typeof p.then === 'function') p.then(() => done(true), () => done(false));
      else done(true);
    } catch {
      done(false);
    }
  }
}

const trackUrl = (t, fmt) => `${MUSIC_DIR}${encodeURIComponent(t.file)}.${fmt}${S.q}`;
const trackLevel = (t) => TRACK_GAIN * (Number.isFinite(t.gain) ? clamp(t.gain, 0, 2) : 1);
/** Track ids not to pick now (failed within RETRY_S). */
function failedIds(now) {
  const out = [];
  for (const [id, f] of S.dir.failed) if (f.until > now) out.push(id);
  return out;
}

/** Fade a deck out over `fade` s, then pause it and free its stream (the silent WAV takes the track's place). */
function releaseDeck(deck, fade = 0.3) {
  const t = S.ctx.currentTime;
  const g = deck.gain.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0, t + Math.max(0.02, fade));
  deck.track = null;
  deck.context = null;
  deck.held = false;
  clearTimeout(deck.stopT);
  deck.stopT = setTimeout(() => {
    if (deck.track) return;                              // reused for the next track meanwhile
    try { deck.el.pause(); deck.el.src = SILENT_WAV; } catch { /* gone */ }
  }, (Math.max(0.02, fade) + 0.25) * 1000);
  if (S.dir.active === deck) S.dir.active = null;
}

/** Start track `t` for `context` on the free deck; the playing one (if any) cross-fades out over `fade` s. */
function playTrack(t, context, fade) {
  const D = S.dir;
  const old = D.active;
  const deck = D.decks[old ? 1 - old.i : 0];
  if (old) releaseDeck(old, fade);
  clearTimeout(deck.stopT);                              // a deck still fading out from the change before is reused
  const g = deck.gain.gain;
  const now = S.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0, now);
  Object.assign(deck, { track: t, context, fmt: D.formats[0], fmtIdx: 0, fade, started: false, held: false });
  D.active = deck;
  D.last = t.id;
  D.restUntil = Infinity;
  S.music.pieces++;
  deck.el.preload = 'auto';
  loadDeck(deck, trackUrl(t, deck.fmt));
}

/** A new source on a deck, then play: `attempt` tells a stale play() rejection (of the source before) from this one. */
function loadDeck(deck, url) {
  deck.attempt++;
  deck.el.src = url;
  startDeck(deck);
}

function startDeck(deck) {
  const n = deck.attempt;
  try {
    const p = deck.el.play();
    if (p && typeof p.catch === 'function') p.catch((err) => { if (n === deck.attempt) onPlayRejected(deck, err); });
  } catch (err) {
    onPlayRejected(deck, err);
  }
}

/** The fade-in starts when sound really flows (a slow network buffers first), so a cross-fade never dips. */
function onDeckPlaying(deck) {
  if (!deck.track || deck.started) return;
  deck.started = true;
  const D = S.dir;
  D.formatOk = true;
  // a track plays: the network is back, so the tracks that failed for want of it may play again
  for (const [id, f] of D.failed) if (f.kind === 'network') D.failed.delete(id);
  const t = S.ctx.currentTime;
  const g = deck.gain.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(trackLevel(deck.track), t + Math.max(0.05, deck.fade));
}

/**
 * A pause the director did not ask for (media keys, the phone's media controls, headphones pulled out, the lock
 * screen): the piece ends there and the usual rest follows, instead of an "active" deck that stays silent for good.
 * Our own pauses come with the track already let go (releaseDeck) or the deck held (holdDeck); the end of a track
 * fires 'pause' before 'ended' (el.ended).
 */
function onDeckPaused(deck) {
  if (!deck.track || deck.held || deck.el.ended || S.dir?.active !== deck) return;
  const was = deck.context;
  releaseDeck(deck, 0.05);
  pieceEnded(was, false);
}

function onDeckEnded(deck) {
  if (!deck.track || S.dir.active !== deck) return;
  const was = deck.context;
  releaseDeck(deck, 0.05);
  pieceEnded(was, was === 'fair');
}

/** A piece (track or generative) has ended at ctx time `at`: rest, then the next one. */
function pieceEnded(context, soon, at = S.ctx ? S.ctx.currentTime : 0) {
  if (context === 'fair') S.scene.fair = false;          // one festive piece per ceremony, then the evening returns
  if (S.dir) S.dir.restUntil = at + (soon ? SOON_S : rand(REST_S[0], REST_S[1]));
}

function onDeckError(deck, err) {
  if (!deck.track) return;                               // the idle silent source, or a deck already let go
  const D = S.dir;
  const t = deck.track;
  const code = err && err.code;
  // a format this browser claims but cannot decode (code 3 decode, 4 not supported, which Chrome also reports for a
  // source it could not fetch at all): this attempt tries the same track in the other format. Per attempt, never for
  // the session: a network hiccup on the first track must not move a whole session off the browser's best format
  if ((code === 3 || code === 4) && deck.fmtIdx + 1 < D.formats.length) {
    deck.fmtIdx++;
    deck.fmt = D.formats[deck.fmtIdx];
    loadDeck(deck, trackUrl(t, deck.fmt));
    return;
  }
  const now = S.ctx.currentTime;
  // no metadata at all: the file never arrived (a restarting server, a dropped Wi-Fi; Chrome reports that as code 4
  // too), so it is a network failure, retried soon; a decode error once data arrived is the file's own
  const fetched = deck.el.readyState >= 1;
  const kind = (code === 3 || code === 4) && fetched ? 'decode' : 'network';
  D.failed.set(t.id, { until: now + RETRY_S[kind], kind });
  console.warn(`audio: the music track ${t.id} did not play (media error ${code ?? '?'}, ${kind}); another one plays`);
  const was = D.active === deck;
  releaseDeck(deck, 0.05);
  // the next pick after a short pause (it skips the failed one): a server that is down fails every track in a row,
  // and a few seconds between tries keeps that from burning through the whole list at once
  if (was) D.restUntil = now + SOON_S;
}

function onPlayRejected(deck, err) {
  if (!deck.track || (err && err.name === 'AbortError')) return;      // a new src or a pause interrupted it: expected
  if (deck.el.error) return;                             // a source that failed: its 'error' event handles it (onDeckError)
  const D = S.dir;
  const was = D.active === deck;
  if (err && err.name === 'NotAllowedError') {
    // autoplay refused (a deck the gesture could not bless yet): the generative engine plays meanwhile, and the
    // next gesture blesses the decks and lets tracks play again (unlock)
    D.blocked = true;
    releaseDeck(deck, 0.05);
    if (was) armGenerative(0.1);
    return;
  }
  onDeckError(deck, { code: err && err.name === 'NotSupportedError' ? 4 : 2 });
}

/** One generative piece now (or after `delay` s): the fallback when no track can play. */
function armGenerative(delay = 0.05) {
  const m = S.music;
  if (!m || !S.ctx) return;
  m.armed = true;
  m.nextAt = Math.max(m.piece ? m.nextAt : 0, S.ctx.currentTime + delay);
  if (S.dir) S.dir.restUntil = Infinity;                // pieceEnded sets the rest after it
}

/** The next piece for a scene: a track when one can play, else a generative piece. */
function startNext(context, fade) {
  const D = S.dir;
  const now = S.ctx.currentTime;
  let t = null;
  if (D.mode === 'tracks' && !D.blocked && !D.forceGen && D.decks.length) {
    const failed = failedIds(now);
    if (D.pinTrack) t = D.list.find((x) => x.id === D.pinTrack && !failed.includes(x.id)) ?? null;
    D.pinTrack = null;
    t ??= pickTrack(D.list, context, { last: D.last, failed });
  }
  if (t) { playTrack(t, context, fade); return; }
  if (D.active) releaseDeck(D.active, fade);
  armGenerative(Math.min(fade, 1));
}

/** The title screen: the slot picker is showing (ui/index.js), unless setScene({ title }) says otherwise. */
function titleScreen() {
  if (typeof S.scene.title === 'boolean') return S.scene.title;
  try {
    const el = typeof document !== 'undefined' ? document.getElementById('slot-picker') : null;
    return Boolean(el && !el.hidden);
  } catch {
    return false;
  }
}

function wantedContext() {
  if (S.dir.pin) return S.dir.pin;
  const ph = dayPhase(S.now(), S.dayMode, undefined, S.createdAt);
  return musicContext({ title: titleScreen(), fair: S.scene.fair, golden: S.scene.golden, rain: S.scene.rain > RAIN_ON, light: ph.light, phase: ph.phase });
}

/** A change the music answers at once (an event); time of day and weather wait HOLD_S. */
const urgentChange = (from, to) => to === 'fair' || to === 'title' || from === 'title' || (to === 'evening' && S.scene.golden);

/** A phone's hidden page or an interrupted context (a call, Siri): the active deck pauses, and resumes after. */
function holdDeck(hold) {
  const a = S.dir?.active;
  if (!a || !a.track) return;
  if (hold && !a.el.paused) { a.held = true; try { a.el.pause(); } catch { /* gone */ } }
  else if (!hold && a.held) { a.held = false; startDeck(a); }
}

function directorTick() {
  const D = S.dir;
  const ctx = S.ctx;
  if (!D || !ctx) return;
  const running = ctx.state === 'running';
  holdDeck(!running);
  if (!running || !S.unlocked) return;
  const now = ctx.currentTime;
  if (now < D.nextCheck) return;
  D.nextCheck = now + 0.25;
  const want = wantedContext();
  if (want !== D.want) {
    D.urgent = D.want !== null && urgentChange(D.want, want);
    D.want = want;
    D.wantAt = now;
    if (D.urgent && !D.active && !S.music.piece && !S.music.armed) D.restUntil = Math.min(D.restUntil, now + SOON_S);
  }
  // muted, or the Music (or Master) slider at 0: nothing streams; the music comes back soon after
  const silent = S.settings.muted || S.settings.music <= 0.001 || S.settings.master <= 0.001;
  if (silent) {
    if (D.active) releaseDeck(D.active, 0.3);
    D.silenced = true;
    S.scene.fair = false;                                // its dance is not saved for hours later
    return;
  }
  if (D.silenced) { D.silenced = false; D.restUntil = Math.min(D.restUntil, now + 1.5); }
  if (D.mode === 'pending') return;                      // the track list is still on its way
  if (D.listRetry && now - D.listAt >= 60) {
    D.listRetry = false;
    D.listAt = now;
    D.mode = 'pending';
    loadTracks(S.q).finally(() => { if (D.mode === 'generative' && D.listRetry) D.listAt = S.ctx.currentTime; });
    return;
  }
  const a = D.active;
  if (a) {
    // a track fits when it was picked for this scene (a borrowed one too: MUSIC_FALLBACK) or its moods say so
    const fits = a.context === want || a.track.moods.includes(want);
    if (!fits && (D.urgent || now - D.wantAt >= HOLD_S)) startNext(want, XFADE_S);
    return;
  }
  if (S.music.piece || S.music.armed) return;            // a generative piece plays to its end (pieceEnded)
  if (now >= Math.max(D.restUntil, D.holdUntil)) startNext(want, 0.05);
}

// ---- ambience -------------------------------------------------------------------------------------------------
function loopVoice(name, rate = 1) {
  const buf = S.buffers.get(name);
  if (!buf) return null;
  const src = S.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = rate;
  const amp = S.ctx.createGain();
  amp.gain.value = 0;
  src.connect(amp).connect(S.bus.ambience);
  src.start(S.ctx.currentTime + Math.random() * 0.2);
  return amp;
}

function ambienceTick() {
  const ctx = S.ctx;
  if (!ctx || ctx.state !== 'running') return;
  if (!S.amb) {
    // the drizzle is the rain loop played faster (lighter, quicker drops): no second sample to fetch and decode
    S.amb = { wind: loopVoice('amb_wind'), crickets: loopVoice('amb_crickets'), rain: loopVoice('amb_rain'),
      drizzle: loopVoice('amb_rain', DRIZZLE_RATE),
      water: loopVoice('amb_water'), interior: loopVoice('amb_interior'), nextBird: 0, nextOwl: 0, nextAnimal: ctx.currentTime + rand(15, 30),
      nextBells: ctx.currentTime + rand(40, 90), roosterCycle: -1, nextDrip: 0, nextBath: ctx.currentTime + rand(8, 20) };
  }
  const A = S.amb;
  const now = ctx.currentTime;
  const ph = dayPhase(S.now(), S.dayMode, undefined, S.createdAt);
  const night = 1 - ph.light;
  const set = (amp, v) => { if (amp) amp.gain.setTargetAtTime(v, now, 1.5); };
  // indoors (the farmhouse, M2) the fire and the clock play and everything outside is heard through the walls
  const out = S.scene.interior ? INDOOR_K : 1;
  set(A.interior, S.scene.interior ? 0.5 : 0);
  const rain = S.scene.rain;
  const wet = rain > RAIN_ON;
  set(A.wind, (0.13 + 0.12 * rain) * out);                  // a breeze under everything, never a hiss; gusts in a downpour
  set(A.crickets, night * 0.55 * (0.8 + 0.2 * Math.sin(now / 9)) * (1 - 0.7 * rain) * out);
  // the rain follows its intensity (wave 4, wish 12): a drizzle's light patter, a downpour's roar; on the roof indoors
  const mix = rainMix(rain);
  const roof = S.scene.interior ? 0.45 : 1;
  set(A.rain, mix.rain * roof);
  set(A.drizzle, mix.drizzle * roof);
  set(A.water, 0.4 * clamp(S.scene.water, 0, 1) * out);    // a pond or the river near the camera (GDD §8.5)
  // after the rain: drips from the roofs and the trees while the ground is still wet
  if (now >= A.nextDrip) {
    const w = clamp(S.scene.wet, 0, 1) * (rain < 0.1 ? 1 : 0);
    if (w > 0.2) voice('plop', { rate: rand(1.55, 2.2), gain: 0.07 * w * out, pan: rand(-0.85, 0.85), dest: S.bus.ambience });
    A.nextDrip = now + (w > 0.2 ? rand(0.5, 2.6) / w : 4);
  }
  // a bird bath on screen (wave 4, wish 10): now and then a bird comes down, chirps, splashes and flutters off
  if (now >= A.nextBath) {
    if (S.scene.birdbath > 0 && ph.light > 0.35 && !wet) {
      const pan = rand(-0.6, 0.6);
      voice(pick(['amb_bird1', 'amb_bird3']), { rate: rand(1, 1.2), gain: 0.22 * out, pan, dest: S.bus.ambience });
      voice('splash', { rate: rand(1.6, 1.9), gain: 0.14 * out, pan, at: now + rand(0.35, 0.6), dest: S.bus.ambience });
      voice('brush', { rate: rand(1.7, 2.1), gain: 0.1 * out, pan, at: now + rand(1.3, 1.8), dest: S.bus.ambience });
    }
    A.nextBath = now + rand(18, 45);
  }
  if (now >= A.nextBird) {
    const birdGain = ph.light * (wet ? 0.25 : 1) * out;
    if (birdGain > 0.05) {
      voice(pick(['amb_bird1', 'amb_bird2', 'amb_bird3', 'amb_bird4']), { rate: rand(0.88, 1.15), gain: 0.35 * birdGain * rand(0.5, 1), pan: rand(-0.85, 0.85), dest: S.bus.ambience });
      if (Math.random() < 0.3) voice(pick(['amb_bird1', 'amb_bird3']), { rate: rand(0.9, 1.2), gain: 0.2 * birdGain, pan: rand(-0.9, 0.9), at: now + rand(0.3, 0.9), dest: S.bus.ambience });
    }
    A.nextBird = now + rand(2.5, 9);
  }
  if (now >= A.nextOwl) {
    if (night > 0.8 && Math.random() < 0.6) voice('amb_owl', { rate: rand(0.95, 1.05), gain: 0.25 * out, pan: rand(-0.7, 0.7), dest: S.bus.far });
    A.nextOwl = now + rand(25, 60);
  }
  if (now >= A.nextAnimal) {
    const avail = S.scene.animals.map((a) => CALLS[a]).filter((c) => c && S.buffers.has(c));
    if (avail.length && ph.light > 0.3) {
      const c = pick(avail);
      voice(c, { rate: rand(0.92, 1.06), gain: (c === 'buzz' ? 0.14 : c === 'bunny' ? 0.16 : 0.22) * out, pan: rand(-0.8, 0.8), dest: S.bus.far });
    }
    A.nextAnimal = now + rand(20, 60);
  }
  // faint village bells across the river once a Town Project stands (GDD §8.5), by day, every few minutes
  if (now >= A.nextBells) {
    if (S.scene.village > 0 && ph.light > 0.4) {
      voice('amb_bells', { rate: rand(0.97, 1.03), gain: 0.18 * out, pan: rand(-0.6, 0.6), dest: S.bus.far });
    }
    A.nextBells = now + rand(150, 300);
  }
  // the rooster once at each dawn
  if (ph.phase === 'dawn' && ph.t > 0.3) {
    const cycle = Math.floor(S.now() / 2_400_000);
    if (A.roosterCycle !== cycle && S.scene.animals.includes('chicken')) {
      A.roosterCycle = cycle;
      voice('rooster', { gain: 0.3 * out, pan: rand(-0.6, 0.6), dest: S.bus.far });
    }
  }
}

function tick() {
  const look = document.hidden ? 1.6 : 0.25;
  try {
    musicTick(look);
    ambienceTick();
  } catch (err) {
    console.warn('audio tick failed', err);
  }
}

/** Run `fn` until it resolves: up to 5 more tries, 1.5 s, 3 s, 6 s ... apart (a server restarting during the boot). */
async function retrying(fn, tries = 5) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
    }
  }
}

/** A manifest entry the director can use (the test checks the files; this keeps a hand-edit from breaking the page). */
const usableTrack = (t) => t && typeof t.id === 'string' && typeof t.file === 'string' && /^[a-z0-9-]+$/.test(t.file)
  && Array.isArray(t.moods) && t.moods.some((m) => MUSIC_CONTEXTS.includes(m));

/** The track list (tracks.json) and this browser's format; 'generative' when either is missing. Never throws. */
async function loadTracks(q) {
  const D = S.dir;
  try {
    const probe = document.createElement('audio');
    D.formats = musicFormats((type) => probe.canPlayType(type));
  } catch {
    D.formats = [];
  }
  if (!D.decks.length || !D.formats.length) { D.mode = 'generative'; return; }
  try {
    // two quick retries only: the music waits for this list, and a missing one means the generative engine plays
    const list = await retrying(async () => {
      const res = await fetch(`${MUSIC_DIR}tracks.json${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }, 2);
    D.list = (Array.isArray(list?.tracks) ? list.tracks : []).filter(usableTrack);
    D.mode = D.list.length ? 'tracks' : 'generative';
  } catch (err) {
    console.warn('audio: the music track list did not load; the generative music plays meanwhile', err);
    D.mode = 'generative';
    D.listRetry = true;                                  // directorTick asks again a minute later (a server restart)
  }
}

// ---- public API -----------------------------------------------------------------------------------------------
export const audio = {
  async init({ now, dayMode } = {}) {
    if (S.ctx) return;
    if (typeof now === 'function') S.now = now;
    if (dayMode) S.dayMode = dayMode;
    S.settings = { ...DEFAULTS, muted: false, ...load() };
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      S.ctx = new AC({ latencyHint: 'interactive' });
    } catch (err) {
      console.warn('audio: no AudioContext', err);
      return;
    }
    buildGraph(S.ctx);
    // iOS 16.4+: a playing media element would switch the page to the "playback" audio session (louder than the ring /
    // silent switch, and other apps' audio stops); 'ambient' keeps the game mixing in like its Web Audio always did
    try { if (navigator.audioSession && 'type' in navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch { /* older Safari */ }
    // the music decks exist before the first gesture's unlock() runs (main.js calls it right after init), so that very
    // gesture can bless them for iOS
    S.dir = newDirector();
    makeDecks();
    const unlock = () => audio.unlock();
    // touchend / pointerup / click: the gestures iOS Safari accepts for starting audio (UNLOCK_EVENTS)
    for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, unlock, { capture: true, passive: true });
    if (touchFirst()) {
      document.addEventListener('visibilitychange', () => {
        if (!S.ctx) return;
        // the music deck pauses with the page (not just muted by the suspended context): a locked phone neither plays
        // into a pocket nor streams a track nobody hears
        if (document.hidden) { holdDeck(true); S.ctx.suspend().catch(() => {}); }
        else if (S.unlocked) S.ctx.resume().then(() => holdDeck(false), () => {});
      });
    }
    // the wind chimes ring when the cursor brushes them (render/ambient-life.js, at most once per 1.2 s per chime)
    window.addEventListener('hh:chime', () => audio.play('note', { gain: 0.45, rate: 1.5 + Math.random() * 0.25 }));
    S.music = { piece: null, bar: 0, nextAt: 0, pieces: 0, wasGolden: false, armed: false };
    // the build hash the server stamped into the page versions the samples and the music: `?v=` URLs are cached for a
    // year (SV-05: a warm reload revalidates nothing; a new build gets new URLs)
    const v = document.querySelector('meta[name="hh-build"]')?.content;
    const q = v ? `?v=${encodeURIComponent(v)}` : '';
    S.q = q;
    // the director runs from now on (it needs no samples): the track list loads next to the samples, not after them
    loadTracks(q);
    S.dirTimer = setInterval(() => { try { directorTick(); } catch (err) { console.warn('audio: music director failed', err); } }, 250);
    try {
      S.manifest = await retrying(async () => {
        const res = await fetch(`/assets/audio/manifest.json${q}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      });
      // Ogg Opus first (about a seventh of the WAV bytes); a file that does not fetch or decode falls back to its WAV
      const oggOk = canOgg();
      const get = async (file) => {
        // every Ogg sound in one request (qa2 SV-03, server/static.js packs), else the single file
        let buf = await fromPack(`/assets/audio/${file}`);
        if (!buf) {
          const r = await fetch(`/assets/audio/${file}${q}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          buf = await r.arrayBuffer();
        }
        return S.ctx.decodeAudioData(buf);
      };
      const loadOne = async ([name, s], last) => {
        const first = sampleFile(s, oggOk);
        try {
          S.buffers.set(name, await get(first));
        } catch (err) {
          if (first !== s.file) {
            try { S.buffers.set(name, await get(s.file)); return; } catch { /* reported below */ }
          }
          if (last) console.warn(`audio: ${name} did not load`, err);
        }
      };
      // a server restarting right when the page boots (a deploy, a dev restart) fails every fetch at once: the missing
      // samples are fetched again a few seconds later (three rounds), and the game simply stays quiet meanwhile
      let todo = Object.entries(S.manifest.sounds);
      for (let round = 0; round < 3 && todo.length; round++) {
        if (round) await new Promise((r) => setTimeout(r, 3000 * round));
        await Promise.all(todo.map((e) => loadOne(e, round === 2)));
        todo = todo.filter(([name]) => !S.buffers.has(name));
      }
      S.format = oggOk ? 'ogg' : 'wav';
      S.ready = true;
    } catch (err) {
      console.warn('audio: manifest did not load; the game stays silent', err);
    }
    // Music starts a few seconds after the first gesture (unlock), quietly; nothing nags.
    S.timer = setInterval(tick, 60);
  },

  unlock() {
    if (!S.ctx) return;
    if (S.ctx.state !== 'running') {
      if (typeof document !== 'undefined' && document.hidden) return;     // never wake the speakers of a hidden page
      S.ctx.resume().catch(() => {});
      // older iOS only counts the context as started once a sound starts inside the gesture: one silent sample
      try {
        const src = S.ctx.createBufferSource();
        src.buffer = S.ctx.createBuffer(1, 1, S.ctx.sampleRate || 44100);
        src.connect(S.ctx.destination);
        src.start(0);
      } catch { /* a closed context */ }
    }
    if (S.dir) {
      blessDecks();                                       // iOS: inside this gesture, so the decks may play later
      S.dir.blocked = false;                              // a fresh gesture: tracks may try again after a refusal
    }
    if (!S.unlocked) {
      S.unlocked = true;
      if (S.dir) S.dir.restUntil = S.ctx.currentTime + 2.5;
    }
  },

  play(name, { pan = 0, rate, gain = 1, bus = 'sfx', partner = false, at = 0, force = false } = {}) {
    if (!S.ctx || S.ctx.state !== 'running' || S.settings.muted) return false;
    if (!S.buffers.has(name)) return false;
    const t = S.ctx.currentTime;
    const last = S.last.get(name) ?? -1;
    if (!force && !at && t - last < MIN_GAP_S) return false;
    if (S.voices >= MAX_VOICES && !force) return false;
    S.last.set(name, t);
    const r = rate ?? 1 + rand(-0.04, 0.04);
    return Boolean(voice(name, { rate: r, gain: gain * (partner ? 0.5 : 1), pan, at: at ? t + at : 0, dest: S.bus[bus] || S.bus.sfx }));
  },

  /** step 0, 1, 2 ... climbs C D E G A c d e g a ... (wraps after two octaves). */
  ladder(step, { pan = 0, partner = false, gain = 0.9, at = 0 } = {}) {
    const i = Math.max(0, step) % 10;
    // the ladder climbs in the key of the music that is playing, so a drag plays along with it (C otherwise): a track's
    // `key` in tracks.json, or the generative piece's key
    const tk = S.dir?.active?.track?.key;
    const raw = Number.isInteger(tk) ? tk : S.music && S.music.piece ? S.music.piece.key : 0;
    const key = ((raw % 12) + 12) % 12;
    const shift = key > 6 ? key - 12 : key;
    const semis = PENTA[i % 5] + 12 * Math.floor(i / 5) - 12 + shift;     // around the C5 sample: C4 .. A5
    return audio.play('pluck', { rate: 2 ** (semis / 12) * (1 + rand(-0.01, 0.01)), pan, partner, gain, force: true, at });
  },

  coins(n, { pan = 0, partner = false } = {}) {
    const k = clamp(Math.round(n), 1, 8);
    for (let i = 0; i < k; i++) audio.play('coin', { at: i * 0.04 + 0.001, rate: 1 + i * 0.015 + rand(-0.02, 0.02), gain: 0.8, pan, partner, force: true });
  },

  duck(seconds = 1.5) {
    if (!S.ctx) return;
    const t = S.ctx.currentTime;
    const d = S.bus.duck.gain;
    d.cancelScheduledValues(t);
    d.setTargetAtTime(0.5, t, 0.05);
    d.setTargetAtTime(1, t + seconds, 0.4);
  },

  setScene({ golden, rain, wet, birdbath, animals, createdAt, water, village, interior, title } = {}) {
    if (title !== undefined) S.scene.title = typeof title === 'boolean' ? title : null;   // null: the slot picker decides
    if (Number.isFinite(createdAt)) S.createdAt = createdAt;      // the sky's clock starts at the farm's birth (RD-04)
    if (golden !== undefined) {
      const was = S.scene.golden;
      S.scene.golden = Boolean(golden);
      if (S.scene.golden && !was && S.unlocked) audio.play('golden', { force: true, gain: 0.9 });
    }
    // rain: how hard it rains, 0..1 (wave 4: drizzle .. downpour); a boolean as before (true = steady rain)
    if (rain !== undefined) S.scene.rain = typeof rain === 'number' ? (Number.isFinite(rain) ? clamp(rain, 0, 1) : 0) : rain ? 0.7 : 0;
    if (Number.isFinite(wet)) S.scene.wet = clamp(wet, 0, 1);
    if (Number.isFinite(birdbath)) S.scene.birdbath = clamp(birdbath, 0, 1);
    if (Array.isArray(animals)) S.scene.animals = animals.slice(0, 12);
    if (Number.isFinite(water)) S.scene.water = clamp(water, 0, 1);
    if (Number.isFinite(village)) S.scene.village = Math.max(0, village);
    if (interior !== undefined) S.scene.interior = Boolean(interior);
  },

  /**
   * The County Fair ceremony: the fanfare now; the next piece is the festive one (the current ends at its phrase).
   * show: the horse show ran this week (M2, GDD §5.6): the post-horn call and the trot follow the fanfare.
   */
  festive({ show = false } = {}) {
    audio.duck(show ? 5.4 : 2.6);
    audio.play('fanfare', { force: true });
    if (show) audio.play('show_fanfare', { force: true, at: 2.7 });
    S.scene.fair = true;
    if (S.dir && S.ctx) {
      // the playing track bows out under the fanfare; the Fair's track starts when the fanfare is over (a generative
      // piece that plays ends at its next phrase on its own)
      const hold = show ? 5.4 : 2.6;
      if (S.dir.active) releaseDeck(S.dir.active, hold);
      S.dir.holdUntil = S.ctx.currentTime + hold;
      if (!S.music.piece && !S.music.armed) S.dir.restUntil = S.dir.holdUntil;
    }
  },

  /**
   * Start or stop a looping sample on the sfx bus (the hooves while riding). Idempotent; fades over 0.25 s.
   * @param {string} name @param {boolean} on @param {{ gain?: number, rate?: number }} [o]
   */
  loop(name, on, { gain = 0.5, rate = 1 } = {}) {
    if (!S.ctx || !S.bus.sfx) return false;
    const cur = S.loops.get(name);
    const t = S.ctx.currentTime;
    if (on) {
      if (cur) {
        cur.amp.gain.setTargetAtTime(gain, t, 0.08);
        cur.src.playbackRate.setTargetAtTime(rate, t, 0.1);
        return true;
      }
      const buf = S.buffers.get(name);
      if (!buf) return false;
      const src = S.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = rate;
      const amp = S.ctx.createGain();
      amp.gain.value = 0;
      amp.gain.setTargetAtTime(gain, t, 0.08);
      src.connect(amp).connect(S.bus.sfx);
      src.start(t);
      S.loops.set(name, { src, amp });
      return true;
    }
    if (!cur) return false;
    S.loops.delete(name);
    cur.amp.gain.setTargetAtTime(0, t, 0.08);
    cur.src.stop(t + 0.5);
    cur.src.onended = () => { try { cur.src.disconnect(); cur.amp.disconnect(); } catch { /* gone */ } };
    return true;
  },

  setDayMode(mode) { if (['cycle', 'day', 'real'].includes(mode)) S.dayMode = mode; },

  setVolume(channel, v) {
    if (!(channel in DEFAULTS)) return;
    S.settings[channel] = clamp(Number(v) || 0, 0, 1);
    save(S.settings);
    applyVolumes();
  },
  volumes() { return { ...S.settings }; },
  setMuted(m) { S.settings.muted = Boolean(m); save(S.settings); applyVolumes(); },
  get muted() { return S.settings.muted; },

  /**
   * Dev/test: pin the music and start the next piece now (the rest between pieces is skipped).
   *   force('day' | 'evening' | 'night' | 'rain' | 'fair' | 'title')   a track from that scene's pool ('golden' = 'evening')
   *   force('<track id>')                                               that track now, then its scene's pool
   *   force(v, { generative: true } | { trace: true } | { ahead: s })   the generative engine with variant 'day' |
   *                                                                     'night' | 'golden' | 'fair' (a scene maps to one)
   *   force(null)                                                       follow the scene again, with a fresh pick now
   */
  force(variant = null, { trace = false, ahead = 0, generative = false } = {}) {
    const D = S.dir;
    const track = D?.list.find((t) => t.id === variant) ?? null;
    const scene = track ? track.moods.find((x) => MUSIC_CONTEXTS.includes(x)) : variant === 'golden' ? 'evening' : variant;
    const gen = Boolean(trace || ahead > 0 || generative);
    S.forced = VARIANTS[variant] ? variant : GEN_VARIANT[scene] ?? null;
    S.trace = trace ? [] : null;
    S.traceT0 = S.ctx ? S.ctx.currentTime : 0;
    if (D) {
      D.forceGen = gen;
      D.pin = MUSIC_CONTEXTS.includes(scene) ? scene : null;
      D.pinTrack = track ? track.id : null;
    }
    if (!S.music || !S.ctx) return;
    S.music.piece = null;                       // the generative piece stops here (the notes already scheduled ring out)
    S.music.armed = false;
    if (D && D.mode === 'tracks' && !gen) {
      D.want = wantedContext();
      D.wantAt = S.ctx.currentTime;
      D.urgent = false;
      startNext(D.want, D.active ? 1.5 : 0.05);
      return;
    }
    if (D?.active) releaseDeck(D.active, 0.3);
    armGenerative(0.1);
    if (ahead > 0) musicTick(ahead);            // tests: schedule a whole piece at once and read it from trace()
  },

  /**
   * Dev/test: record `seconds` of the master output (after the compressor) as 16 kHz mono 16-bit PCM, base64.
   * @returns {Promise<{ rate: number, pcm: string } | null>}
   */
  record(seconds = 10) {
    if (!S.ctx || !S.bus.master) return Promise.resolve(null);
    const ctx = S.ctx;
    const tap = ctx.createScriptProcessor(4096, 2, 1);
    const chunks = [];
    const step = ctx.sampleRate / 16000;
    let acc = 0;
    tap.onaudioprocess = (e) => {
      const l = e.inputBuffer.getChannelData(0);
      const r = e.inputBuffer.getChannelData(1);
      const out = [];
      for (; acc < l.length; acc += step) { const i = Math.floor(acc); out.push((l[i] + r[i]) / 2); }
      acc -= l.length;
      chunks.push(Float32Array.from(out));
      e.outputBuffer.getChannelData(0).fill(0);
    };
    const silent = ctx.createGain();
    silent.gain.value = 0;
    S.bus.master.connect(tap);
    tap.connect(silent).connect(ctx.destination);
    return new Promise((resolve) => setTimeout(() => {
      try { S.bus.master.disconnect(tap); tap.disconnect(); silent.disconnect(); } catch { /* gone */ }
      const n = chunks.reduce((a, c) => a + c.length, 0);
      const pcm = new Int16Array(n);
      let k = 0;
      for (const c of chunks) for (const v of c) pcm[k++] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
      const bytes = new Uint8Array(pcm.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      resolve({ rate: 16000, pcm: btoa(bin) });
    }, seconds * 1000));
  },

  /** Dev/test: the notes scheduled since force(v, { trace: true }) ({ t, bar, role, inst, midi, gain, chord, key }). */
  trace() { return S.trace ? S.trace.slice() : null; },

  info() {
    const m = S.music;
    const D = S.dir;
    const a = D?.active ?? null;
    const t = a?.track ?? null;
    const now = S.ctx ? S.ctx.currentTime : 0;
    return {
      ready: S.ready, unlocked: S.unlocked, state: S.ctx ? S.ctx.state : 'none', loaded: S.buffers.size, voices: S.voices,
      format: S.format ?? null, loops: [...S.loops.keys()],
      // mode: what plays now, else what plays next ('pending' while the track list loads); piece counts every piece
      // started, tracks and generative ones
      music: m ? {
        mode: t ? 'tracks' : m.piece || m.armed || !D || D.forceGen ? 'generative' : D.mode,
        playing: Boolean((a && !a.el.paused) || m.piece),
        track: t?.id ?? null, title: t?.title ?? null, artist: t?.artist ?? null,
        context: a?.context ?? D?.want ?? null,
        variant: m.piece?.variant ?? a?.context ?? null,
        position: a ? +a.el.currentTime.toFixed(1) : null,
        bar: m.bar, piece: m.pieces, bpm: m.piece?.bpm ?? null,
        format: D?.formats[0] ?? null, tracks: D?.list.length ?? 0, failed: D ? failedIds(now) : [], last: D?.last ?? null,
        restIn: D && !a && !m.piece && !m.armed && Number.isFinite(D.restUntil)
          ? +Math.max(0, Math.max(D.restUntil, D.holdUntil) - now).toFixed(1) : null,
      } : null,
      scene: { ...S.scene, ...dayPhase(S.now(), S.dayMode, undefined, S.createdAt) },
    };
  },
};
