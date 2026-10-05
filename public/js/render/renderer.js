// WebGL renderer, quality tiers with auto-adjust, and demand-driven frame pacing (tech §10.1, §10.4, §10.11;
// visual-ux-juice §4.2). Owned by the render lane.
//
//   QUALITY                        tier knobs (pixel ratio cap, MSAA, shadow map, ambient fps, tufts, particles)
//   loadTier(requested) -> 'high' | 'medium' | 'low'   an explicit tier as asked; 'auto' boots on a downgrade only
//        when the auto tier settled on it in two sessions in a row (one contended session never sticks), else high
//   noteAutoTier(tier)             record where the auto tier settled this session (see loadTier)
//   createRenderer(canvas, tier) -> { renderer, quality, tier }
//   applyTier(renderer, sun, tier)                          runtime knobs (MSAA only applies on the next boot)
//   createAutoTier(start) -> { feed(gpuMs, dtS) -> newTier | null, tier, p90 }   pure state machine (tested):
//        fed with the GPU time of rendered frames (EXT_disjoint_timer_query_webgl2), never with frame intervals
//        (those measure vsync and CPU contention, not the GPU): down a tier when the GPU p90 stays above 12 ms for
//        5 s, up when it stays below 6 ms for 30 s, never back up to a tier that failed this session
//   createIntervalTier(start)      the fallback without the timer extension: only a sustained < 30 fps drops a tier
//   createGpuTimer(renderer) -> { begin(), end(t), poll() -> [[gpuMs, t], ...] } | null   timer queries
//   startLoop({ renderer, want, frame, isDirty, clearDirty, ambientFps, interactiveFps, calmFps?, idleMs?, napMs?,
//        blurred, onRendered }) -> stop; stop.kick(): input happened: render on the very next animation frame and
//        stay interactive 2 s; stop.wake(): look again at once (a sleeping loop restarts its animation frames)
//        The cap is decided BEFORE any work: a display frame that will not render runs no tick (a 144 Hz monitor
//        costs no more than 60 Hz). want(dt, t) -> 2 interactive (60 fps + a 2 s tail) | WANT.MOVING ambient that
//        travels across the screen (the partner walking, a pet following its farmer: tier fps) | 1 slow ambient
//        (sway, breathing, a pulsing pin: calmFps, and idleFps once nobody gave input for idleMs) | 0 static
//        (polled at 4 Hz, renders only when dirty). dt is the time since the previous tick, and frame() and the
//        onFrame consumers get the time since the previous RENDERED frame (walking, panning and presence stay in
//        wall time on any display). A blurred window gets at most 10 fps unless the player is giving input; a
//        hidden tab no frames at all (no rAF). With napMs > 0 a loop whose next frame is far off stops its
//        animation frames and checks isDirty() every napMs instead (qa2 CL-03: an empty 60 Hz rAF still costs the
//        main thread a BeginMainFrame per display frame).
//        stop.pause(reason) / stop.resume(reason): no frames while any reason holds (mobile wave: 'hidden' is
//        automatic: a hidden page renders nothing and runs no timers; index.js pauses for 'lost', a lost context)
//
// Mobile wave (render lane): phones and tablets get a device PROFILE on top of the tier.
//   deviceProfile({ coarse, fine, touchPoints, w, h, memory, cores, gpu }) -> { kind: 'desktop'|'phone'|'tablet',
//        gpu: 'low'|'mid'|'high' }   pure (tested): a coarse primary pointer is a touch device; the short screen side
//        < 600 CSS px is a phone; deviceMemory, cores and the GPU name (WEBGL_debug_renderer_info) rank the GPU
//   PROFILES                       per kind and tier: the pixel ratio cap (phones 1.5, tablets 2), shadows (phones
//        none: the ground's soft footprint AO grounds every object), tufts, particles, scenery density, ambient life,
//        skinned animals, the LOD scale (zoom bands pulled in) and whether shadows may refresh mid-pan
//   qualityOf(tier, kind) -> knobs  the tier's QUALITY merged with the profile (desktop: QUALITY[tier] unchanged)
//   bootTier(requested, profile)   the tier a touch device boots with: never above what its GPU rank allows
//   gpuName(renderer) -> string    the unmasked renderer string ('' when the browser hides it)
import * as THREE from 'three';

export const QUALITY = Object.freeze({
  high: { pixelRatio: 1.25, antialias: true, ambientFps: 30, shadowMap: 2048, shadowRadius: 3, tufts: 'high', particles: 'high' },
  medium: { pixelRatio: 1.0, antialias: true, ambientFps: 24, shadowMap: 1024, shadowRadius: 2, tufts: 'medium', particles: 'medium' },
  low: { pixelRatio: 0.85, antialias: false, ambientFps: 15, shadowMap: 0, shadowRadius: 0, tufts: 'low', particles: 'low' },
});
const ORDER = ['low', 'medium', 'high'];
const AUTO_KEY = 'hh.quality.auto';
// qa2 CL-03 (the laptop never rested: ~20 renders/s at rest, 60 fps 60 % of the time while the pets strolled):
// ambient at most restFps; slow ambient alone at calmFps; after idleMs without input a frame every 500 ms
export const LOOP = Object.freeze({ pollFps: 4, blurredFps: 10, tailMs: 2000, restFps: 20, calmFps: 12, idleMs: 30_000, idleFps: 2, napMs: 50 });
/** Frame wants (subsystem update() return values, combined with Math.max). */
export const WANT = Object.freeze({ STATIC: 0, AMBIENT: 1, MOVING: 1.5, INTERACTIVE: 2 });

// The desktop knobs the profiles below override (QUALITY keeps its frozen shape for the desktop and the tests).
const DESKTOP_EXTRA = Object.freeze({
  high: { scenery: 'high', life: 'high', skinned: 8, lodK: 1, panShadows: true },
  medium: { scenery: 'medium', life: 'high', skinned: 8, lodK: 1, panShadows: true },
  low: { scenery: 'low', life: 'high', skinned: 8, lodK: 1, panShadows: true },
});
/** Phone and tablet knobs per tier (mobile wave). Cut cost, not charm: the look keeps its colours, sway, AO and
 *  feedback; what goes is shadow mapping on phones, half the grass, a third of the ambient specks, distant trees. */
export const PROFILES = Object.freeze({
  phone: Object.freeze({
    high: { pixelRatio: 1.5, antialias: true, shadowMap: 0, shadowRadius: 0, tufts: 'medium', particles: 'medium', scenery: 'medium', life: 'medium', skinned: 4, lodK: 0.8, panShadows: false },
    medium: { pixelRatio: 1.25, antialias: true, shadowMap: 0, shadowRadius: 0, tufts: 'low', particles: 'low', scenery: 'medium', life: 'low', skinned: 3, lodK: 0.8, panShadows: false },
    low: { pixelRatio: 1.0, antialias: false, shadowMap: 0, shadowRadius: 0, tufts: 'low', particles: 'low', scenery: 'low', life: 'low', skinned: 2, lodK: 0.7, panShadows: false },
  }),
  tablet: Object.freeze({
    high: { pixelRatio: 2, antialias: true, shadowMap: 1024, shadowRadius: 2, tufts: 'medium', particles: 'medium', scenery: 'medium', life: 'medium', skinned: 6, lodK: 0.9, panShadows: false },
    medium: { pixelRatio: 1.5, antialias: true, shadowMap: 0, shadowRadius: 0, tufts: 'medium', particles: 'low', scenery: 'medium', life: 'low', skinned: 4, lodK: 0.85, panShadows: false },
    low: { pixelRatio: 1.0, antialias: false, shadowMap: 0, shadowRadius: 0, tufts: 'low', particles: 'low', scenery: 'low', life: 'low', skinned: 3, lodK: 0.75, panShadows: false },
  }),
});

/** A tier's knobs for a device kind (see the header). */
export function qualityOf(tier, kind = 'desktop') {
  const name = QUALITY[tier] ? tier : 'high';
  const p = PROFILES[kind];
  return { ...QUALITY[name], ...DESKTOP_EXTRA[name], ...(p ? p[name] : null), kind: p ? kind : 'desktop' };
}

// GPU names (WEBGL_debug_renderer_info): older or entry Mali / Adreno / PowerVR rank low; Apple and the current
// Adreno 6xx-7xx / Mali-G7x / Immortalis rank high. Anything else (or a hidden name) is mid.
const LOW_GPU = /Mali-(?:[34]\d\d|T\d+|G(?:31|51|52|57|68|71|72))\b|Adreno \(TM\) [2-5]\d\d\b|PowerVR|SGX|Vivante|VideoCore/i;
const HIGH_GPU = /Apple|Adreno \(TM\) (?:6[4-9]\d|7\d\d|8\d\d)|Mali-G(?:7[6-9]|7\d\d|9\d\d|6[1-9]\d)|Immortalis|Xclipse/i;

/** The device class and GPU rank (pure, tested; see the header). */
export function deviceProfile({ coarse = false, fine = true, touchPoints = 0, w = 1366, h = 768, memory = null, cores = null, gpu = '' } = {}) {
  const touch = Boolean(coarse) || (touchPoints > 0 && !fine);
  if (!touch) return { kind: 'desktop', gpu: 'high' };
  const kind = Math.min(w, h) < 600 ? 'phone' : 'tablet';
  let rank = 'mid';
  if (LOW_GPU.test(gpu || '') || (Number.isFinite(memory) && memory <= 2) || (Number.isFinite(cores) && cores <= 2)) rank = 'low';
  else if (HIGH_GPU.test(gpu || '') || (Number.isFinite(memory) && memory >= 8)) rank = 'high';
  return { kind, gpu: rank };
}

/** The tier a device boots with: desktops as asked (loadTier), touch devices never above their GPU rank. */
export function bootTier(requested, { kind = 'desktop', gpu = 'high' } = {}) {
  const asked = QUALITY[requested] ? requested : loadTier('auto');
  if (kind === 'desktop' || QUALITY[requested]) return asked;
  const cap = gpu === 'low' ? 'low' : gpu === 'mid' ? 'medium' : 'high';
  return ORDER[Math.min(ORDER.indexOf(asked), ORDER.indexOf(cap))];
}

/** The unmasked GPU name, or '' (Chrome may return it from RENDERER directly; Safari says 'Apple GPU'). */
export function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
  } catch { return ''; }
}

function readAuto() {
  try {
    const r = JSON.parse(localStorage.getItem(AUTO_KEY) || 'null');
    return r && QUALITY[r.tier] && Number.isFinite(r.n) ? r : null;
  } catch { return null; }
}

/** The tier to boot with (see the header). */
export function loadTier(requested = 'auto') {
  if (QUALITY[requested]) return requested;
  const r = readAuto();
  return r && r.n >= 2 ? r.tier : 'high';
}

let noted = null;   // the tier already counted for this session
/** The auto tier settled on `tier` in this session: a downgrade counts once per session; high clears it. */
export function noteAutoTier(tier) {
  if (!QUALITY[tier] || noted === tier) return;
  noted = tier;
  try {
    if (tier === 'high') { localStorage.removeItem(AUTO_KEY); return; }
    const r = readAuto();
    localStorage.setItem(AUTO_KEY, JSON.stringify({ tier, n: r && r.tier === tier ? r.n + 1 : 1 }));
  } catch { /* storage blocked: nothing remembered */ }
}

export function createRenderer(canvas, tier = 'high', { dev = false, kind = 'desktop' } = {}) {
  const name = QUALITY[tier] ? tier : 'high';
  const q = qualityOf(name, kind);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
  // checking every new program blocks on getProgramInfoLog (60-300 ms per first use); only dev builds pay it
  renderer.debug.checkShaderErrors = dev;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;          // static casters: refreshed only when the world changes (§10.9)
  renderer.shadowMap.needsUpdate = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  return { renderer, quality: q, tier: name };
}

/** Apply a tier's runtime knobs (pixel ratio, shadow map); `kind` is the device profile (mobile wave). */
export function applyTier(renderer, sun, tier, kind = 'desktop') {
  const q = qualityOf(tier, kind);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  sun.castShadow = q.shadowMap > 0;
  if (q.shadowMap > 0 && sun.shadow.mapSize.x !== q.shadowMap) {
    sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  sun.shadow.radius = q.shadowRadius;
  renderer.shadowMap.needsUpdate = true;
  return q;
}

/** p-quantile of a small list (copies; the window is ~64 samples). */
export function quantile(list, p) {
  if (!list.length) return NaN;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

export const AUTO = Object.freeze({ dropMs: 12, dropS: 5, climbMs: 6, climbS: 30, window: 64 });

/** GPU-time driven auto tier (see the header). feed(gpuMs, dtS): one rendered frame's GPU time and the seconds
 *  since the previous fed frame. */
export function createAutoTier(start = 'high') {
  let tier = start;
  let above = 0;
  let below = 0;
  let p90 = NaN;
  const win = [];
  const failed = new Set();          // tiers this machine could not hold: never auto-climb back (no ping-pong)
  return {
    get tier() { return tier; },
    get p90() { return p90; },
    feed(gpuMs, dtS) {
      if (!Number.isFinite(gpuMs) || gpuMs < 0 || gpuMs > 500 || !Number.isFinite(dtS) || dtS < 0) return null;
      const dt = Math.min(dtS, 0.25);           // an idle gap between frames is not time spent over budget
      win.push(gpuMs);
      if (win.length > AUTO.window) win.shift();
      if (win.length < 8) return null;
      p90 = quantile(win, 0.9);
      if (p90 > AUTO.dropMs) { above += dt; below = 0; } else if (p90 < AUTO.climbMs) { below += dt; above = 0; } else { above = 0; below = 0; }
      const i = ORDER.indexOf(tier);
      if (above >= AUTO.dropS && i > 0) { failed.add(tier); tier = ORDER[i - 1]; above = 0; win.length = 0; return tier; }
      if (below >= AUTO.climbS && i < ORDER.length - 1 && !failed.has(ORDER[i + 1])) { tier = ORDER[i + 1]; below = 0; win.length = 0; return tier; }
      return null;
    },
  };
}

/** Fallback without a GPU timer: frame intervals cannot tell the GPU from a busy CPU, so only a sustained
 *  sub-30 fps (avg interval > 34 ms for 8 s of interactive frames) drops a tier, and it never climbs. */
export function createIntervalTier(start = 'high') {
  let tier = start;
  let avg = 16.7;
  let above = 0;
  return {
    get tier() { return tier; },
    get p90() { return avg; },
    feed(frameMs, dtS) {
      if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return null;
      avg += (frameMs - avg) * Math.min(1, dtS / 2);
      above = avg > 34 ? above + dtS : 0;
      const i = ORDER.indexOf(tier);
      if (above >= 8 && i > 0) { tier = ORDER[i - 1]; above = 0; avg = 16.7; return tier; }
      return null;
    },
  };
}

/** GPU timer queries around renderer.render (null without EXT_disjoint_timer_query_webgl2). */
export function createGpuTimer(renderer) {
  const gl = renderer.getContext();
  const ext = gl && typeof gl.getExtension === 'function' ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
  if (!ext || typeof gl.createQuery !== 'function') return null;
  const pending = [];
  let open = null;
  return {
    begin() {
      if (open || pending.length > 6) return;        // never queue more than a few frames of queries
      open = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, open);
    },
    end(t) {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push([open, t]);
      open = null;
    },
    /** Finished queries: [[gpuMs, t], ...] (disjoint results dropped). */
    poll() {
      const out = [];
      while (pending.length && gl.getQueryParameter(pending[0][0], gl.QUERY_RESULT_AVAILABLE)) {
        const [q, t] = pending.shift();
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        gl.deleteQuery(q);
        if (!disjoint) out.push([ns / 1e6, t]);
      }
      return out;
    },
  };
}

/**
 * The pacing decision of one display frame (pure, tested): should it tick at all, given the mode the last tick
 * asked for, input and dirtiness. Returns the frame rate cap that applies.
 */
export function capFps({ input, feedback, lastWant, dirty, blurred, ambientFps, interactiveFps, calmFps = Infinity, idle = false }) {
  let mode = input || feedback ? 2 : lastWant >= WANT.INTERACTIVE ? 2 : lastWant >= WANT.AMBIENT ? 1 : 0;
  if (dirty && mode === 0) mode = 1;                 // a store change or a pick shows within one ambient frame
  let fps = mode === 2 ? interactiveFps : mode === 1 ? ambientFps : LOOP.pollFps;
  // only slow ambient animates (nothing travels across the screen): the calm rate, and once nobody gave input for a
  // while a frame every 500 ms; a change (a store change, a pick, a presence row) still shows at the calm rate
  if (mode === 1 && !input && !feedback && lastWant < WANT.MOVING) fps = Math.min(fps, idle && !dirty ? LOOP.idleFps : calmFps);
  if (blurred && !input) fps = Math.min(fps, LOOP.blurredFps);
  return fps;
}

export function startLoop({ renderer, want, frame, isDirty, clearDirty, ambientFps = () => 30, interactiveFps = () => 60,
  calmFps = () => Infinity, idleMs = Infinity, napMs = 0,
  blurred = () => typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus(),
  onRendered = null }) {
  let inputUntil = 0;
  let feedbackUntil = 0;
  let kicked = false;
  let nextAt = 0;
  let lastTick = 0;
  let lastRender = 0;
  let lastWant = 1;
  let inputAt = typeof performance !== 'undefined' ? performance.now() : 0;
  let nap = null;                                      // the timer of a sleeping loop (napMs > 0)
  const paused = new Set();                            // reasons that hold every frame ('hidden', 'lost')
  const wake = () => {
    if (nap === null || paused.size) return;
    clearTimeout(nap);
    nap = null;
    renderer.setAnimationLoop(loop);
  };
  /** No animation frames until `until` (ms, performance clock), a store change or input, whichever comes first. */
  const sleep = (until) => {
    renderer.setAnimationLoop(null);
    const check = () => {
      nap = null;
      if (paused.size) return;
      if (kicked || isDirty() || performance.now() >= until - 20) { renderer.setAnimationLoop(loop); return; }
      nap = setTimeout(check, napMs);
    };
    nap = setTimeout(check, napMs);
  };
  const loop = (t) => {
    const input = kicked || t < inputUntil;
    const fps = capFps({ input, feedback: t < feedbackUntil, lastWant, dirty: isDirty(), blurred: blurred(),
      ambientFps: ambientFps(), interactiveFps: interactiveFps(), calmFps: calmFps(), idle: t - inputAt > idleMs });
    const step = 1000 / fps;
    // a raised cap (input, dirt) must not wait for the slot booked at the old, lower rate
    const due = lastTick ? Math.min(nextAt, lastTick + step) : 0;
    if (!kicked && t < due - 1) {                      // not this display frame: no tick, no render
      if (napMs > 0 && due - t > 2 * napMs) sleep(due);  // and none for a while: stop the empty 60 Hz wake-ups
      return;
    }
    kicked = false;
    nextAt = Math.max(due + step, t);
    // wall time between ticks; a static farm polls at 4 Hz, so the cap must let a poll's 0.25 s through (a 0.1 s
    // cap made ambient particles outlive themselves 2.5x and kept Still rendering)
    const dt = lastTick ? Math.min(0.3, (t - lastTick) / 1000) : 1 / 60;
    lastTick = t;
    const w = want(dt, t);
    lastWant = w;
    if (w >= WANT.INTERACTIVE) feedbackUntil = t + LOOP.tailMs;
    const mode = input || t < feedbackUntil ? 2 : w >= WANT.AMBIENT ? 1 : 0;
    if (!isDirty() && mode === 0) return;
    clearDirty();
    const fdt = lastRender ? Math.min(0.1, (t - lastRender) / 1000) : dt;
    lastRender = t;
    frame(fdt, t, mode);
    if (onRendered) onRendered(t, mode);
  };
  renderer.setAnimationLoop(loop);
  const halt = () => { if (nap !== null) { clearTimeout(nap); nap = null; } renderer.setAnimationLoop(null); };
  /** No frames (and no nap timers) while any reason holds. */
  const pause = (reason) => { paused.add(reason); halt(); };
  /** The reason is gone: frames again on the next animation frame (a fresh dt, never a giant catch-up step). */
  const resume = (reason) => {
    if (!paused.delete(reason) || paused.size) return;
    lastTick = 0; nextAt = 0; lastRender = 0; kicked = true;
    renderer.setAnimationLoop(loop);
  };
  // a hidden page draws nothing at all (mobile wave: 0 fps in the background, and no 1 Hz nap timers either)
  const onVisibility = () => { if (document.hidden) pause('hidden'); else resume('hidden'); };
  const doc = typeof document !== 'undefined' && typeof document.addEventListener === 'function' ? document : null;
  if (doc) {
    doc.addEventListener('visibilitychange', onVisibility);
    if (doc.hidden) pause('hidden');
  }
  const stop = () => { halt(); if (doc) doc.removeEventListener('visibilitychange', onVisibility); };
  stop.pause = pause;
  stop.resume = resume;
  stop.paused = () => paused.size > 0;
  /** The user did something: render the next frame at once and stay interactive for the 2 s tail. */
  stop.kick = () => { kicked = true; inputAt = performance.now(); inputUntil = inputAt + LOOP.tailMs; wake(); };
  /** Something changed outside the loop: a sleeping loop looks again on the next animation frame. */
  stop.wake = wake;
  return stop;
}
