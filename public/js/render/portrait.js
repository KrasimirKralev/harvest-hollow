// Farmer portraits (wave 4b, owner 2026-10-05: "Give an icon showing the hero farmer person. Some kind of portrait.").
// Owned by the hud lane.
//
// A head-and-shoulders picture of a player's own 3D farmer, in their look (render/avatar-looks.js: hair, hair colour,
// skin, outfit, hat; a player who never chose one keeps the rig's own look in the player colour, exactly as the farm
// shows them), over a warm painted backdrop in the player colour. Used by the HUD farmer chips, the slot picker and
// (through peekPortrait) any big farmer mark.
//
// HOW: drawn ONCE per (rig, look, colour) with the MAIN renderer (no second WebGL context) into a small multisampled
// render target, a three-quarter view under a soft key light, read back (async where the browser can) and finished in a
// 2D canvas: the renderer's own tone mapping and sRGB step (a render target gets neither), the backdrop, a 2x
// downscale (on a CPU canvas, encoded off the main thread where the browser can). Every GPU object of the draw (the
// cloned rig's bone texture, the hat or hair mesh, the target) is disposed at once, its materials (and with them the
// shader program) PORTRAIT.warmMs later, so a look changed again soon draws without a compile; at rest the renderer
// holds exactly what it held before. The result is a small image URL kept in memory and in localStorage, so the next
// session shows a known farmer's portrait at once, without drawing at boot. Requests that arrive together (both farmers
// at the welcome) are drawn in one batch, so the shader compiles once. Nothing runs per frame.
//
//   portraitSpec(pid, player) -> { pid, body, color, avatar }   what a portrait depends on (pure)
//   portraitKey(spec) -> string                                  the cache key: rig, look, colour, PORTRAIT.v (pure)
//   peekPortrait(spec) -> url | null                             the cached picture, synchronously (never draws)
//   lastPortrait(pid, color) -> url | null                       the newest portrait this browser drew of that farmer in
//        that colour, whatever the look (the slot picker, which knows the name and colour but not the look)
//   drawPortrait(renderer, spec) -> Promise<url | null>          cached, or drawn in the next idle moment; null when it
//        cannot be drawn (no rig, a lost context): the caller keeps its letter. A failed key waits PORTRAIT.retryMs.
//   portraitFrame(THREE, camera, centre, points, H0) -> { H, at }   aims the camera so a tall or wide hat stays whole
//   PORTRAIT                                                     size and framing knobs (frozen)
//
// render/index.js exposes it as `view.portrait(spec)` (the ui never sees the renderer).

export const PORTRAIT = Object.freeze({
  v: 2,                 // bump when the drawing changes: every cached portrait is drawn again (a new farmer model is in the key)
                        // (2: hats fitted over the head and hair; the frame grows to hold a tall hat)
  out: 160,             // px of the finished picture (a 48 px chip at DPR 2 x the 130 % UI scale ~ 125 px)
  ss: 1,                // supersampling of the render on top of 4x MSAA (the HUD shows it smaller still: 1 is plenty)
  fov: 24,              // a long lens: no big-nose perspective at this distance
  yaw: 0.5,             // the three-quarter turn (radians; the camera stands at the farmer's front right)
  pitch: 0.12,          // looking a little down at them
  frameK: 4.9,          // frame height in head radii (the head about 40 % of it, a hat's crown and the shoulders fit)
  headAt: 0.45,         // the head centre's height in the frame, from the top
  // a tall or wide hat stays whole in the round chip: the head moves down to headAtMax, then the frame grows, until every
  // point of the head, its hair and its hat projects inside fitTop (NDC, from the centre up), fitSide (left and right)
  // and, above the frame's middle, the chip's circle (fitRound, NDC radius)
  headAtMax: 0.53, fitTop: 0.86, fitSide: 0.94, fitRound: 0.92,
  clip: 'Wave', clipAt: 1.05,   // a still from the wave: the hand up beside the face, a hello
  roll: 0.1, nod: 0.06,         // and the head tilted toward it (radians, on the head bone)
  keep: 8,              // portraits kept in localStorage
  retryMs: 30_000,
  warmMs: 20_000,       // the last draw's materials live this long, so the next look (an editor session) skips the compile
});
const STORE_KEY = 'hh.portraits';
const LOOK_FIELDS = ['hair', 'hairColor', 'skin', 'top', 'bottom', 'hat'];
const HEX = /^#[0-9a-fA-F]{6}$/;

/** The rig a player's farmer uses (avatars-view bodyFor: their chosen build, else farmer 2 is B and everyone else A). */
function bodyOf(pid, player) {
  const b = player && player.avatar && player.avatar.body;
  if (b === 'farmer_a' || b === 'farmer_b') return b;
  return pid === 'p2' ? 'farmer_b' : 'farmer_a';
}

/** What a farmer's portrait depends on. Pure. */
export function portraitSpec(pid, player) {
  const color = player && typeof player.color === 'string' && HEX.test(player.color) ? player.color.toUpperCase() : '#2BB3A3';
  return { pid: String(pid), body: bodyOf(pid, player), color, avatar: (player && player.avatar) || null };
}

// The farmer model's manifest entry goes into the key, so a rebuilt farmer (another mesh, size or own hat) is drawn again
// instead of showing a stored picture of the old one. render/models.js is already loaded by the view; it is reached
// lazily so this module stays import-free (the ui and its node tests import it).
let rigInfo = null;
if (typeof document !== 'undefined') import('./models.js').then((m) => { rigInfo = (k) => m.models.info(k); }, () => {});
function rigSig(body) {
  const e = rigInfo ? rigInfo(`avatar:${body}`) : null;
  return e ? [e.tris, e.scale, (e.size || []).join('x'), e.hair, e.hat].join(':') : '?';
}

/** The cache key of a spec: the rig (and its model), the look's fields and the colour (never the name: a portrait has
 *  no letters). Pure for a given farmer model. */
export function portraitKey(spec) {
  const a = spec && spec.avatar && typeof spec.avatar === 'object' ? spec.avatar : {};
  const look = LOOK_FIELDS.map((k) => (typeof a[k] === 'string' ? (HEX.test(a[k]) ? a[k].toUpperCase() : a[k]) : '')).join(',');
  const body = spec && spec.body ? spec.body : bodyOf(spec && spec.pid, { avatar: a });
  return `p${PORTRAIT.v}|${body}@${rigSig(body)}|${String(spec && spec.color || '').toUpperCase()}|${look}`;
}

// ---- the caches -----------------------------------------------------------------------------------------------
const mem = new Map();            // key -> url (this session)
const failed = new Map();         // key -> time it failed (no retry storm while a context is lost)
const inflight = new Map();       // key -> Promise<url | null>
let stored = null;                // key -> { u, pid, c, t } (localStorage, read once)

function readStore() {
  if (stored) return stored;
  stored = {};
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(STORE_KEY);
    const o = raw ? JSON.parse(raw) : null;
    if (o && typeof o === 'object') {
      for (const [k, e] of Object.entries(o)) if (k.startsWith(`p${PORTRAIT.v}|`) && e && typeof e.u === 'string' && e.u.startsWith('data:image/')) stored[k] = e;
    }
  } catch { /* storage blocked or a bad entry: draw again */ }
  return stored;
}
function writeStore(key, url, spec) {
  const s = readStore();
  s[key] = { u: url, pid: spec.pid, c: String(spec.color).toUpperCase(), t: Date.now() };
  const keys = Object.keys(s).sort((a, b) => s[b].t - s[a].t);
  for (const k of keys.slice(PORTRAIT.keep)) delete s[k];
  try { globalThis.localStorage && globalThis.localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* full or blocked: memory only */ }
}

/** The cached portrait of a spec, or null. Never draws. */
export function peekPortrait(spec) {
  const key = portraitKey(spec);
  if (mem.has(key)) return mem.get(key);
  const e = readStore()[key];
  if (e) { mem.set(key, e.u); return e.u; }
  return null;
}

/** The newest portrait of farmer `pid` in colour `color` this browser has drawn, whatever their look; or null. */
export function lastPortrait(pid, color) {
  const s = readStore();
  const c = String(color || '').toUpperCase();
  let best = null;
  for (const e of Object.values(s)) if (e.pid === pid && e.c === c && (!best || e.t > best.t)) best = e;
  return best ? best.u : null;
}

// ---- drawing ---------------------------------------------------------------------------------------------------
let queue = [];
// the materials of the last draw: while they live their shader program stays compiled, so a look changed again soon (the
// "Your look" editor, a hat after a hat) draws without compiling; after PORTRAIT.warmMs they go and the program with them
let warm = [];
let warmT = 0;
function keepWarm(mats) {
  const old = warm;
  warm = mats;
  for (const m of old) m.dispose();               // after the new ones took the program: it is not released
  clearTimeout(warmT);
  warmT = setTimeout(() => { for (const m of warm) m.dispose(); warm = []; }, PORTRAIT.warmMs);
}
let scheduled = false;

/** A spec's portrait: cached at once, else drawn in the next idle moment (batched). Resolves null when it cannot be. */
export function drawPortrait(renderer, spec) {
  const key = portraitKey(spec);
  const hit = peekPortrait(spec);
  if (hit) return Promise.resolve(hit);
  if (inflight.has(key)) return inflight.get(key);
  if (failed.has(key) && Date.now() - failed.get(key) < PORTRAIT.retryMs) return Promise.resolve(null);
  const p = new Promise((resolve) => { queue.push({ spec, key, resolve }); });
  inflight.set(key, p);
  if (!scheduled) {
    scheduled = true;
    // after the boot's own work (the welcome builds the farm): an idle slot, or a short timeout where there is none (Safari)
    const go = () => { scheduled = false; const batch = queue; queue = []; runBatch(renderer, batch); };
    if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(go, { timeout: 1200 });
    else setTimeout(go, 250);
  }
  return p;
}

async function runBatch(renderer, batch) {
  let urls = [];
  try {
    urls = await renderBatch(renderer, batch.map((b) => b.spec));
  } catch (err) {
    console.warn('portrait: not drawn, the letter stays', err);
  }
  batch.forEach((b, i) => {
    const url = urls[i] || null;
    inflight.delete(b.key);
    if (url) { mem.set(b.key, url); failed.delete(b.key); writeStore(b.key, url, b.spec); } else failed.set(b.key, Date.now());
    b.resolve(url);
  });
}

// sRGB encode (the renderer's output step) as a 4096-entry table
let SRGB = null;
function srgbLut() {
  if (SRGB) return SRGB;
  SRGB = new Uint8ClampedArray(4096);
  for (let i = 0; i < 4096; i++) {
    const c = i / 4095;
    SRGB[i] = Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  }
  return SRGB;
}
/** three's NeutralToneMapping (exposure 1), in place on a linear [r, g, b]. */
function neutral(c) {
  const x = Math.min(c[0], c[1], c[2]);
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c[0] -= off; c[1] -= off; c[2] -= off;
  const peak = Math.max(c[0], c[1], c[2]);
  const start = 0.76;
  if (peak < start) return c;
  const d = 1 - start;
  const np = 1 - (d * d) / (peak + d - start);
  const k = np / peak;
  const g = 1 - 1 / (0.15 * (peak - np) + 1);
  for (let i = 0; i < 3; i++) c[i] = c[i] * k * (1 - g) + np * g;
  return c;
}

const mixHex = (hex, to, k) => {
  const n = parseInt(hex.slice(1), 16);
  const t = to === 'white' ? 255 : 0;
  const ch = (v) => Math.round(v + (t - v) * k);
  return `rgb(${ch(n >> 16 & 255)}, ${ch(n >> 8 & 255)}, ${ch(n & 255)})`;
};

/** The painted backdrop: a pastel of the player colour, a warm light behind the head, a few soft brush dabs. */
function paintBackdrop(g, S, color, headAt = PORTRAIT.headAt) {
  const bg = g.createRadialGradient(S * 0.4, S * 0.3, S * 0.05, S * 0.5, S * 0.5, S * 0.78);
  bg.addColorStop(0, mixHex(color, 'white', 0.8));
  bg.addColorStop(0.55, mixHex(color, 'white', 0.55));
  bg.addColorStop(1, mixHex(color, 'white', 0.18));
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  // brush dabs (fixed: the same farmer always gets the same picture)
  const dabs = [[0.16, 0.2, 0.2, 0.22], [0.86, 0.16, 0.16, 0.16], [0.9, 0.62, 0.22, 0.1], [0.1, 0.72, 0.18, 0.1], [0.62, 0.06, 0.12, 0.14]];
  for (const [x, y, r, a] of dabs) {
    const d = g.createRadialGradient(S * x, S * y, 0, S * x, S * y, S * r);
    d.addColorStop(0, `rgba(255, 252, 240, ${a})`);
    d.addColorStop(1, 'rgba(255, 252, 240, 0)');
    g.fillStyle = d;
    g.fillRect(0, 0, S, S);
  }
  // a warm glow behind the head
  const halo = g.createRadialGradient(S * 0.5, S * headAt, 0, S * 0.5, S * headAt, S * 0.42);
  halo.addColorStop(0, 'rgba(255, 244, 214, 0.75)');
  halo.addColorStop(1, 'rgba(255, 244, 214, 0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, S, S);
  // a soft shade at the bottom: the shoulders sit in the picture instead of floating
  const low = g.createLinearGradient(0, S * 0.7, 0, S);
  low.addColorStop(0, mixHex(color, 'black', 0.2).replace('rgb', 'rgba').replace(')', ', 0)'));
  low.addColorStop(1, mixHex(color, 'black', 0.2).replace('rgb', 'rgba').replace(')', ', 0.35)'));
  g.fillStyle = low;
  g.fillRect(0, 0, S, S);
}

/** Linear premultiplied RGBA (bottom-up rows, lights at half strength) over the backdrop's sRGB pixels, in place. */
function compose(px, img, S) {
  const lut = srgbLut();
  const c = [0, 0, 0];
  const d = img.data;
  for (let y = 0; y < S; y++) {
    const src = (S - 1 - y) * S * 4;
    const dst = y * S * 4;
    for (let x = 0; x < S; x++) {
      const i = src + x * 4;
      const a = px[i + 3];
      if (a === 0) continue;
      const k = 1 / (LIGHT_K * a);         // un-premultiply, and undo the half-strength lights (see LIGHT_K)
      c[0] = px[i] * k; c[1] = px[i + 1] * k; c[2] = px[i + 2] * k;
      neutral(c);
      const o = dst + x * 4;
      const al = a / 255;
      for (let ch = 0; ch < 3; ch++) {
        const v = lut[Math.max(0, Math.min(4095, Math.round(c[ch] * 4095)))];
        d[o + ch] = v * al + d[o + ch] * (1 - al);
      }
    }
  }
}
// The target holds 8 bits of LINEAR light and no tone mapping: the lights (and the look's rim) draw at half strength so
// highlights up to 2.0 survive for the tone curve, and compose() doubles them back.
const LIGHT_K = 0.5;

async function renderBatch(renderer, specs) {
  const gl = renderer && renderer.getContext && renderer.getContext();
  if (!gl || (gl.isContextLost && gl.isContextLost()) || typeof document === 'undefined') return specs.map(() => null);
  const [THREE, M, L, A] = await Promise.all([import('three'), import('./models.js'), import('./avatar-looks.js'), import('./avatars-view.js')]);
  const { models, LOOK, wrapLighting } = M;
  await models.init();
  const keys = [...new Set(specs.map((s) => `avatar:${s.body}`))].filter((k) => models.has(k));
  await models.ready(keys);
  const S = PORTRAIT.out * PORTRAIT.ss;
  const rt = new THREE.WebGLRenderTarget(S, S, { samples: 4 });
  const trash = [rt];
  const rigs = [];
  try {
    // build every farmer first (one scene each), then compile once, then draw and read back
    for (const spec of specs) rigs.push(buildRig(THREE, models, wrapLighting, L, A.CHIBI, spec, trash));
    const lights = (scene) => {
      const hemi = new THREE.HemisphereLight('#FFF4E2', '#9A7A58', 1.35 * LIGHT_K);
      const key = new THREE.DirectionalLight('#FFF1D6', 2.6 * LIGHT_K);
      key.position.set(-2.2, 3.2, 3.4);
      const back = new THREE.DirectionalLight('#FFE2B0', 1.2 * LIGHT_K);
      back.position.set(2.5, 2.0, -2.5);
      scene.add(hemi, key, back);
    };
    for (const r of rigs) if (r) lights(r.scene);
    const out = [];
    for (const r of rigs) {
      if (!r) { out.push(null); continue; }
      out.push(await drawOne(THREE, renderer, LOOK, rt, r, S));
    }
    return out;
  } finally {
    const mats = [];
    for (const r of rigs) if (r) mats.push(...r.dispose());
    for (const t of trash) t.dispose();
    keepWarm(mats);
  }
}

/** One farmer, posed and framed in a scene of its own; dispose() frees what the clone made (never the shared geometry)
 *  and hands back its materials, which keepWarm() disposes a little later. */
function buildRig(THREE, models, wrapLighting, L, CHIBI, spec, trash) {
  const key = `avatar:${spec.body}`;
  if (!models.isReady(key)) return null;
  const info = models.info(key) || {};
  const c = models.clone(key, { tint: info.tint ? { [info.tint]: spec.color } : undefined });
  if (!c || !c.skinned) return null;
  const obj = c.object;
  const bones = {};
  obj.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  for (const [name, k] of Object.entries(CHIBI)) {
    const b = bones[name];
    if (!b) continue;
    if (Array.isArray(k)) b.scale.multiply(new THREE.Vector3(...k)); else b.scale.multiplyScalar(k);
  }
  obj.updateMatrixWorld(true);
  let skin = null;
  obj.traverse((o) => { if (!skin && o.isSkinnedMesh) skin = o; });
  if (!skin) return null;
  const mats = [];
  // every material here is the portrait's own: the tinted one models.clone() made for this clone (userData.tint), else
  // a copy, so nothing the farm's own farmer draws with is ever patched or disposed by a portrait
  const ownMat = (mt) => (info.tint && mt.userData && mt.userData.tint ? mt : wrapLighting(mt.clone()));
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    o.material = Array.isArray(o.material) ? o.material.map(ownMat) : ownMat(o.material);
    mats.push(...(Array.isArray(o.material) ? o.material : [o.material]));
    // a copy of the shared geometry too: an away partner's farmer is not on the GPU, and drawing their portrait from
    // the shared one would leave its buffers there for the session (the copy goes with the draw)
    o.geometry = o.geometry.clone();
    trash.push(o.geometry);
  });
  const head = bones[info.head || 'Head'] || null;
  const frame = head && skin.geometry.getAttribute('_part') ? L.headFrame(skin, head) : null;
  // the rig's own head as measured: a chosen hat is fitted over it (the farm's avatars-view does the same)
  const shape = frame && typeof L.headShape === 'function' ? L.headShape(skin, head, frame) : null;
  const own = { hair: info.hair || null, hat: info.hat || 'none', shape };
  const look = L.lookOf({ avatar: spec.avatar }, own);
  if (skin.geometry.getAttribute('_part')) {
    const parts = L.addPartLook(skin.material);
    const tintU = skin.material.userData.tint || null;
    L.applyLook(parts, look, own, look ? tintU : null, info.tint === 'White' ? L.AV_PART.top : L.AV_PART.bottom);
    if (!look && tintU) tintU.value.set(spec.color);
  }
  let acc = null;
  const g = head && frame ? L.accessoryGeometry(look, own) : null;
  if (g) {
    const m = models.createMaterial();
    acc = new THREE.Mesh(g, m);
    acc.matrixAutoUpdate = false;
    acc.matrix.copy(frame);
    acc.frustumCulled = false;
    head.add(acc);
    mats.push(m);
    trash.push(g);
  }
  // a friendly still from the idle loop
  const mixer = new THREE.AnimationMixer(obj);
  const clip = c.clips.get(PORTRAIT.clip) || c.clips.get('Idle') || null;
  if (clip) { mixer.clipAction(clip).play(); mixer.update(PORTRAIT.clipAt); }
  // a friendly tilt of the head toward the camera
  if (head && (PORTRAIT.roll || PORTRAIT.nod)) {
    head.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(PORTRAIT.nod || 0, 0, PORTRAIT.roll || 0)));
  }
  obj.updateMatrixWorld(true);
  // framing from the head itself: its centre and radius (the unit head frame), else the head bone and the rig's height
  const centre = new THREE.Vector3();
  let r = 0.24;
  if (head && frame) {
    const w = new THREE.Matrix4().multiplyMatrices(head.matrixWorld, frame);
    centre.setFromMatrixPosition(w);
    r = w.getMaxScaleOnAxis();
  } else if (head) {
    head.getWorldPosition(centre);
    centre.y += r * 0.8;
  } else {
    centre.set(0, 1.6, 0);
  }
  const cam = new THREE.PerspectiveCamera(PORTRAIT.fov, 1, 0.01, 100);
  const fit = portraitFrame(THREE, cam, centre, head && frame ? framePoints(THREE, head, frame, shape, look, own, g) : [], r * PORTRAIT.frameK);
  const scene = new THREE.Scene();
  scene.add(obj);
  return {
    scene, cam, color: spec.color, headAt: fit.at,
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(obj);
      if (acc) acc.removeFromParent();
      obj.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose(); });
      scene.clear();
      return mats;
    },
  };
}

/** The head's points in the world (the rig's skin, its baked hair and hat while they show, the look's hair and hat),
 *  a few hundred: what the frame must hold. */
function framePoints(THREE, head, frame, shape, look, own, acc) {
  const w = new THREE.Matrix4().multiplyMatrices(head.matrixWorld, frame);
  const out = [];
  const add = (a, step = 3) => { for (let i = 0; a && i + 2 < a.length; i += 3 * step) out.push(new THREE.Vector3(a[i], a[i + 1], a[i + 2]).applyMatrix4(w)); };
  if (shape) {
    add(shape.keep);
    if (!look || !look.hair || look.hair === own.hair) add(shape.hair);
    if (!look || look.hat === own.hat) add(shape.hat);
  }
  if (acc) add(acc.getAttribute('position').array, 2);
  return out;
}

/**
 * Aim the portrait camera `cam` at a head centred on `centre` (world) so the frame holds every point of `pts` (the head,
 * its hair and its hat): a frame H0 high with the head centre PORTRAIT.headAt from the top, the head moved down (to
 * headAtMax), then the frame grown, while a point falls outside fitTop / fitSide / the chip's circle. -> { H, at }.
 * `THREE` is passed in (this module imports nothing at load).
 */
export function portraitFrame(THREE, cam, centre, pts, H0) {
  const aim = (h, a) => {
    const dist = (h / 2) / Math.tan((PORTRAIT.fov * Math.PI) / 360);
    const target = centre.clone();
    target.y -= h * (0.5 - a);
    cam.fov = PORTRAIT.fov; cam.aspect = 1; cam.near = dist * 0.2; cam.far = dist * 4;
    cam.updateProjectionMatrix();
    const cp = Math.cos(PORTRAIT.pitch);
    cam.position.set(target.x + Math.sin(PORTRAIT.yaw) * cp * dist, target.y + Math.sin(PORTRAIT.pitch) * dist, target.z + Math.cos(PORTRAIT.yaw) * cp * dist);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
  };
  let H = H0;
  let at = PORTRAIT.headAt;
  const v = new THREE.Vector3();
  for (let i = 0; i < 24; i++) {
    aim(H, at);
    let top = -Infinity;
    let side = 0;
    let round = 0;
    for (const p of pts) {
      v.copy(p).project(cam);
      top = Math.max(top, v.y); side = Math.max(side, Math.abs(v.x));
      if (v.y > 0) round = Math.max(round, Math.hypot(v.x, v.y));
    }
    if (top <= PORTRAIT.fitTop && side <= PORTRAIT.fitSide && round <= PORTRAIT.fitRound) break;
    if ((top > PORTRAIT.fitTop || round > PORTRAIT.fitRound) && at < PORTRAIT.headAtMax) at = Math.min(PORTRAIT.headAtMax, at + 0.02);
    else H *= 1.04;
  }
  aim(H, at);
  return { H, at };
}

const canvasOf = (n) => {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(n, n);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return c;
};
/** A canvas as a data URL: WebP where the browser writes it (a tenth of the PNG), PNG elsewhere; encoded off the main
 *  thread where the canvas can (OffscreenCanvas.convertToBlob). */
async function encode(c) {
  if (typeof c.convertToBlob === 'function') {
    const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.9 });
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  }
  return c.toDataURL('image/webp', 0.9);
}

/** Draw one prepared farmer into the target, read it back, finish it in 2D; a data URL. */
async function drawOne(THREE, renderer, LOOK, rt, r, S) {
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const info = renderer.info.render;
  const counts = [info.calls, info.triangles, info.points, info.lines];
  // the look's night glow and lamp light belong to the farm's view, not to a portrait; its rim follows LIGHT_K
  const look = [LOOK.uLampK.value, LOOK.uGlow.value, LOOK.uRim.value];
  try {
    renderer.setRenderTarget(rt);
    if (typeof renderer.compileAsync === 'function' && renderer.extensions && renderer.extensions.has('KHR_parallel_shader_compile')) {
      // compiles while this frame goes on (KHR_parallel_shader_compile); the target is set, so the program fits it
      const ready = renderer.compileAsync(r.scene, r.cam);
      renderer.setRenderTarget(prevRT);
      await ready;
      if (renderer.getContext().isContextLost()) return null;
      renderer.setRenderTarget(rt);
    }
    LOOK.uLampK.value = 0; LOOK.uGlow.value = 0; LOOK.uRim.value = look[2] * LIGHT_K;
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(r.scene, r.cam);
  } finally {
    LOOK.uLampK.value = look[0]; LOOK.uGlow.value = look[1]; LOOK.uRim.value = look[2];
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevClear, prevAlpha);
    [info.calls, info.triangles, info.points, info.lines] = counts;     // view.stats() keeps reporting the farm's frame
  }
  const px = new Uint8Array(S * S * 4);
  if (typeof renderer.readRenderTargetPixelsAsync === 'function') await renderer.readRenderTargetPixelsAsync(rt, 0, 0, S, S, px);
  else renderer.readRenderTargetPixels(rt, 0, 0, S, S, px);
  // a CPU-backed 2D canvas (willReadFrequently): a GPU one would make the pixel write and the encode wait on the GPU queue
  const big = canvasOf(S);
  const g = big.getContext('2d', { willReadFrequently: true });
  paintBackdrop(g, S, r.color, r.headAt);
  const img = g.getImageData(0, 0, S, S);
  compose(px, img, S);
  g.putImageData(img, 0, 0);
  let fin = big;
  if (S !== PORTRAIT.out) {
    fin = canvasOf(PORTRAIT.out);
    const sg = fin.getContext('2d', { willReadFrequently: true });
    sg.imageSmoothingEnabled = true;
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(big, 0, 0, PORTRAIT.out, PORTRAIT.out);
  }
  const url = await encode(fin);
  return url && url.startsWith('data:image/') ? url : null;
}
