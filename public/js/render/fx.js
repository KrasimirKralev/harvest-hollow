// World feedback ("juice", GDD §7.2, visual-ux-juice §3.8, §4.10, §4.13): pooled GPU particles, ready-crop
// twinkles, produce pops that bounce and fly into the HUD, DOM floaters, ground rings, rain. Owned by the
// render-life lane. Everything is cosmetic and starts in the same frame as the predicted action.
//
// createFx(layer, overlay, toScreenM) -> fx            (signature kept from M0; render/index.js creates it)
//   layer: THREE.Group (scene layer 'fx'); overlay: DOM element above the canvas; toScreenM(mx, mz, my) ->
//   { x, y, visible } in CSS px (metres in).
//
// fx.play(ev, pos?, meta?)      a domain event ({ e: 'harvested', id, crop, qty, ... }) at pos (THREE.Vector3,
//                               metres; null = no world position: only HUD flights). meta { by, local }: own
//                               actions fly to the HUD and bump it; the partner's fly to their avatar.
//                               Known events: planted harvested watered tended composted fertilized uprooted
//                               placed built bought moved removed stored sold levelUp joined fed collected
//                               petted shaken treeHarvested chopped cleared queued crafted trayCollected expanded
//                               achievement questDone duet together highFive goldenHour blueRibbon delivered;
//                               wave 2 (M1b): chopHit giantFormed giantFelled heirloom prized grewUp colonyCycle
//                               masterworked beautyStar decorSet donated bundleDone projectDone townBuilt townReady
//                               townFunded townGiven fairOpened fairEntered fairPoints fairCeremony bargeDocked
//                               bargeLoaded bargeRow bargeCastOff albumFind albumSet friendship befriended
//                               memoryPage pet* bloomed (a celebration without a position plays at the camera's target);
//                               wave 3 (M2): fairCeremony.league (promotion), bred breedStarted nursed nurseDone coatWorn
//                               fishCast fishCaught (avatars-view plays them) fishTogether duelInvited duelAccepted
//                               duelEnded trackTier perkPicked perksReset grandmaArrived grandmaLeft interiorOpened
//                               furnished furnishMoved townBuilt.tier (the Festival Pavilion);
//                               wave 4: weedsCleared (cells) upgraded soldStored petBreed avatarChanged, fertilized of its own
//                               (unknown events get a small sparkle; add more with fx.recipe()).
// fx.update(dt) -> 0|1|2        per rendered frame; 2 while feedback is in flight (interactive frame rate),
//                               1 while only ambient life is visible (twinkles, rain, smoke, petals, snow: the
//                               ambient cap), 0 when idle
// fx.burst(kind, pos, { n, color, speed, up, size, life, spread, grav, additive, alpha, ambient })   raw particles;
//                               kinds: sparkle glow leaf petal dust heart confetti droplet feather coin note snow
//                               ring dirt star streak. ambient: true for the world's own life (chimney smoke,
//                               petals, rain splashes, snow): it never asks for the interactive frame rate
//                               (performance-01); alpha scales the particle's peak opacity (smoke 0.3)
// fx.float(pos, text, { color, size, icon, rise, delay })      floating text ("+3 Wheat", "-15 %")
// fx.pop(itemId, pos, { qty, to, by, local, delay })           produce launches 1.2 m, bounces, flies to `to`
// fx.preload(itemIds)                                          load icon textures before their first pop
// fx.fly(kind|itemId, from {x, y} | Vector3, { qty, to, by, local, delay })   DOM icon flight to the HUD
//                               to: 'barn' | 'coins' | 'acorns' | 'xp' | {x, y} | Element (default by kind)
// fx.ring(pos, { color, radius, duration, width, additive })   expanding ground ring (bloom, ping, dust)
// fx.twinkle(key, pos | null, { color, size, phase })          persistent glint (ready crops); null removes. Glints
//                               are warm gold with a cream core (visual-05); objects-view sets three per ripe plot
// fx.rain(intensity 0..1, { strength, near, wind }?) / fx.setFocus(x, z)   streak rain around the camera target (metres);
//                               wave 4: strength (drizzle 0.45 .. downpour 1), the near layer's centre, the wind's slant;
//                               fx.setEaves(fn) roofs and canopies drip
// fx.setMe(pid) / fx.setLocator(fn(pid) -> {x, y} | null)      partner flights end at their avatar
// fx.setTargets({ barn, coins, acorns, xp })                   HUD targets (selector or Element)
// fx.setMotion('full' | 'reduced' | 'still') / fx.setQuality('high' | 'medium' | 'low')
// fx.recipe(name, fn(fx, ev, pos, meta)) / fx.stats() -> { particles, ambient, floaters, flights, twinkles }
// fx.warmup(on) / fx.materials()   shader warm-up at boot (render/index.js): every lazily created mesh exists,
//                               hidden, so renderer.compileAsync() compiles its program before the first harvest
// Arrivals dispatch window 'hh:fly-arrive' { detail: { kind, item, qty, by, local } } (the UI rolls counters).
import * as THREE from 'three';
import { CONTENT, TREE_AGE, cropOf, itemOf } from '../../../shared/content/index.js';
import { TILE_M, WORLD_TILES } from '../../../shared/content/config.js';
import { iconUrl } from './icons.js';
import { loadTexture } from './assets.js';
import { EASE, createTweener } from './tweens.js';
import { t, tn, Q, name as cname, ctext, lang } from '../i18n/index.js';

// ---------------------------------------------------------------------------------------------------
// Pure helpers (exported for tests)
export const ATLAS = Object.freeze({ sparkle: 0, glow: 1, leaf: 2, petal: 3, dust: 4, heart: 5, confetti: 6, droplet: 7, feather: 8,
  coin: 9, note: 10, snow: 11, ring: 12, dirt: 13, star: 14, streak: 15 });
const ADDITIVE = new Set(['sparkle', 'glow', 'star', 'ring']);
export const CAPS = Object.freeze({ high: 768, medium: 512, low: 256 });   // two pools: <= 1536 live (GDD §8.6 budget 1500)
export const DEFAULT_TARGETS = Object.freeze({ barn: '#hud-barn-pill', coins: '#hud-coins-pill', acorns: '#hud-acorns-pill', xp: '#hud-level-star' });

/** Ring-buffer slot allocator over `cap` slots: returns the next `n` indices (oldest overwritten). */
export function createRing(cap) {
  let next = 0;
  return {
    cap,
    take(n) {
      const out = [];
      for (let i = 0; i < Math.min(n, cap); i++) { out.push(next); next = (next + 1) % cap; }
      return out;
    },
  };
}

/**
 * What the particle pools ask of the render loop (pure, tested): feedback particles (a harvest burst) want the
 * interactive rate, ambient ones (smoke, petals, rain splashes, snow) only the ambient cap (performance-01).
 * pools: [{ aliveUntil, ambientUntil }], busy: other feedback in flight (pops, flights, floaters, tweens).
 */
export function particleWant(pools, time, { busy = false, twinkles = 0, rain = 0, motion = 'full' } = {}) {
  if (busy || pools.some((p) => time < p.aliveUntil)) return 2;
  if (pools.some((p) => time < p.ambientUntil)) return 1;
  return (twinkles && motion !== 'still') || rain > 0 ? 1 : 0;
}

/** Which HUD target an item flies to. */
export function targetFor(kind) {
  if (kind === 'coins' || kind === 'coin') return 'coins';
  if (kind === 'acorns' || kind === 'acorn') return 'acorns';
  if (kind === 'xp') return 'xp';
  return 'barn';
}

/** Collection finds by id (they are not items): { name, set }. */
const FINDS = new Map();
for (const set of (CONTENT.collections ? CONTENT.collections.values() : [])) for (const it of set.items || []) FINDS.set(it.id, { name: it.name, set: set.id });

/** Display name for an item id (content first, then a collection find, then a readable fallback). */
export function itemName(id) {
  const it = typeof id === 'string' ? itemOf(id) : null;
  if (it && it.name) return cname(id, { family: 'items' });
  // a collection find's name is content (lane B: i18n/bg/text-b.js finds.<id>.name)
  if (typeof id === 'string' && FINDS.has(id)) return ctext('finds', id, 'name', FINDS.get(id).name);
  return typeof id === 'string' ? id.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '';
}

/**
 * A bought upgrade tier's own name ("Soft Cushions") in the language in effect: the rules' `upgraded { target, tier,
 * name }` carries the English one; Bulgarian is the content text (lane B: i18n/bg/text-b.js upgrades['<target>.<n>']).
 */
export function upgradeTierName(ev) {
  return ev && ev.name ? ctext('upgrades', `${ev.target}.${ev.tier}`, 'name', ev.name) : null;
}

/** A tree age's word ("Mature") in the language in effect (content TREE_AGE.stages; the event carries the id). */
export function treeAgeName(stage) {
  const en = TREE_AGE?.stages?.find((s) => s.id === stage)?.name ?? stage;
  return ctext('TREE_AGE', stage, 'name', en);
}

/** "+3 Wheat" over the farm: English as always (the bare name), Bulgarian with the count form ("+12 моркова"). */
function gotText(id, n) {
  return itemOf(id) ? t('game.fx.got', { q: Q(id, n, 'items') }) : `+${n} ${itemName(id)}`;
}

/** Fair medal colours (bronze I-III, silver, gold, platinum): rosette, centre, sparkle. */
export const MEDAL_COLORS = Object.freeze({ bronze: ['#C9862E', '#FFE3B0', '#E8A85A'], silver: ['#C9CED3', '#FFFFFF', '#E6EEF5'],
  gold: ['#FFC83D', '#FFF3C4', '#FFE27A'], platinum: ['#9FD8E8', '#FFFFFF', '#D6F4FF'] });
/** The medal family of a fairCeremony event (`medal` may be 'gold_2', 'Gold II', 'silver' ...). */
export function medalFamily(medal) {
  const m = String(medal || '').toLowerCase();
  return m.startsWith('plat') ? 'platinum' : m.startsWith('gold') ? 'gold' : m.startsWith('silver') ? 'silver' : m.startsWith('bronze') ? 'bronze' : null;
}

const colorCache = new Map();
function col(hex) {
  let c = colorCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); }
  return c;
}

// ---------------------------------------------------------------------------------------------------
// The particle atlas (4 x 4 cells, drawn once on a canvas: white shapes, tinted per particle)
function drawAtlas() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S * 4; c.height = S * 4;
  const g = c.getContext('2d');
  const cell = (i, fn) => { g.save(); g.translate((i % 4) * S + S / 2, Math.floor(i / 4) * S + S / 2); fn(); g.restore(); };
  const radial = (r, a0 = 1, a1 = 0) => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, `rgba(255,255,255,${a0})`); gr.addColorStop(1, `rgba(255,255,255,${a1})`); return gr; };
  g.fillStyle = '#fff';
  cell(ATLAS.sparkle, () => {
    g.fillStyle = radial(40, 0.9); g.beginPath(); g.arc(0, 0, 40, 0, 7); g.fill();
    g.fillStyle = '#fff';
    for (let k = 0; k < 4; k++) { g.rotate(Math.PI / 2); g.beginPath(); g.moveTo(0, -58); g.quadraticCurveTo(6, -6, 0, 0); g.quadraticCurveTo(-6, -6, 0, -58); g.fill(); }
  });
  cell(ATLAS.glow, () => { g.fillStyle = radial(60, 1); g.beginPath(); g.arc(0, 0, 60, 0, 7); g.fill(); });
  cell(ATLAS.leaf, () => {
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -50); g.quadraticCurveTo(38, -10, 0, 50); g.quadraticCurveTo(-38, -10, 0, -50); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, -40); g.lineTo(0, 44); g.stroke();
  });
  cell(ATLAS.petal, () => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, 0, 22, 44, 0, 0, 7); g.fill(); });
  cell(ATLAS.dust, () => {
    for (const [x, y, r] of [[0, 6, 36], [-24, 14, 26], [24, 12, 28], [-8, -14, 26], [14, -10, 24]]) { g.fillStyle = radial(r, 0.85, 0); g.save(); g.translate(x, y); g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.restore(); }
  });
  cell(ATLAS.heart, () => {
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, 46); g.bezierCurveTo(-70, -6, -32, -60, 0, -22); g.bezierCurveTo(32, -60, 70, -6, 0, 46); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.0)';
  });
  cell(ATLAS.confetti, () => { g.fillStyle = '#fff'; g.fillRect(-26, -16, 52, 32); });
  cell(ATLAS.droplet, () => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -46); g.quadraticCurveTo(34, 10, 0, 40); g.quadraticCurveTo(-34, 10, 0, -46); g.fill(); });
  cell(ATLAS.feather, () => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, 0, 16, 50, 0.3, 0, 7); g.fill(); });
  cell(ATLAS.coin, () => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 44, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 32, 0, 7); g.stroke();
  });
  cell(ATLAS.note, () => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(-10, 26, 20, 15, -0.4, 0, 7); g.fill(); g.fillRect(4, -40, 9, 66); g.fillRect(4, -40, 30, 10); });
  cell(ATLAS.snow, () => { g.strokeStyle = '#fff'; g.lineWidth = 9; g.lineCap = 'round'; for (let k = 0; k < 3; k++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(-44, 0); g.lineTo(44, 0); g.stroke(); } });
  cell(ATLAS.ring, () => { g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(0, 0, 50, 0, 7); g.stroke(); });
  cell(ATLAS.dirt, () => { g.fillStyle = '#fff'; g.beginPath(); for (let k = 0; k < 7; k++) { const a = (k / 7) * 6.28; const r = 26 + (k % 2) * 10; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill(); });
  cell(ATLAS.star, () => {
    g.fillStyle = '#fff'; g.beginPath();
    for (let k = 0; k <= 10; k++) { const a = (k / 10) * Math.PI * 2 - Math.PI / 2; const r = k % 2 ? 22 : 54; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.fill();
  });
  cell(ATLAS.streak, () => { const gr = g.createLinearGradient(0, -60, 0, 60); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)'); g.fillStyle = gr; g.fillRect(-4, -60, 8, 120); });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

const PARTICLE_VS = /* glsl */`
uniform float uTime;
attribute vec3 aStart; attribute vec3 aVel; attribute vec4 aMisc;   // birth, life, frame, spin
attribute vec4 aColor; attribute vec4 aSize;                        // rgb + peak alpha; size start, size end, gravity, drag
varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
void main() {
  float age = uTime - aMisc.x;
  float t = age / aMisc.y;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float dragK = aSize.w > 0.0 ? (1.0 - exp(-aSize.w * age)) / aSize.w : age;
  vec3 p = aStart + aVel * dragK + vec3(0.0, -4.9 * aSize.z, 0.0) * age * age;
  float size = mix(aSize.x, aSize.y, t);
  float fr = aMisc.z;
  vec4 mv;
  if (fr >= 16.0) {
    // a flat quad lying on the ground (rain ripples), not a billboard
    fr -= 16.0;
    mv = modelViewMatrix * vec4(p + vec3(position.x, 0.0, position.y) * size, 1.0);
  } else {
    mv = modelViewMatrix * vec4(p, 1.0);
    float c = cos(aMisc.w * age), s = sin(aMisc.w * age);
    mv.xy += mat2(c, -s, s, c) * position.xy * size;
  }
  gl_Position = projectionMatrix * mv;
  vUv = (position.xy * vec2(1.0, -1.0) + 0.5 + vec2(mod(fr, 4.0), floor(fr / 4.0))) / 4.0;
  vUv.y = 1.0 - vUv.y;
  vAlpha = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.65, 1.0, t)) * aColor.a;
  vColor = aColor.rgb;
}`;
const PARTICLE_FS = /* glsl */`
uniform sampler2D uAtlas;
varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  float a = tex.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * tex.rgb, a);
  #include <colorspace_fragment>
}`;

function createPool(cap, additive, atlas, uTime) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const mk = (n) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  const attrs = { aStart: mk(3), aVel: mk(3), aMisc: mk(4), aColor: mk(4), aSize: mk(4) };
  for (let i = 0; i < cap; i++) attrs.aMisc.array[i * 4] = -1e6;     // never born
  for (const [k, a] of Object.entries(attrs)) geo.setAttribute(k, a);
  geo.instanceCount = 0;                          // drawn up to the high-water mark only (performance-13)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime, uAtlas: { value: atlas } }, vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;                           // nothing alive: no draw at all (performance-13)
  mesh.renderOrder = additive ? 11 : 10;
  return { mesh, attrs, ring: createRing(cap), dirtyLo: Infinity, dirtyHi: -1, aliveUntil: 0, ambientUntil: 0, high: 0 };
}

// ---------------------------------------------------------------------------------------------------
export function createFx(layer, overlay, toScreenM) {
  const uTime = { value: 0 };
  const atlas = drawAtlas();
  let cap = CAPS.high;
  const pools = { alpha: createPool(CAPS.high, false, atlas, uTime), add: createPool(CAPS.high, true, atlas, uTime) };
  layer.add(pools.alpha.mesh, pools.add.mesh);
  const tw = createTweener();
  let time = 0;
  let motion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
  let me = null;
  let locator = () => null;
  const targets = { ...DEFAULT_TARGETS };
  const recipes = new Map();
  const v3 = new THREE.Vector3();
  const rand = () => Math.random();          // cosmetic only: each screen may scatter its own particles
  let streak = { n: 0, at: -10 };            // drag-paint streak (every 10th harvest: a sparkle burst)

  // -------------------------------------------------------------------------------------------------
  // particles
  function burst(kind, pos, { n = 10, color = '#ffffff', colors = null, speed = 2.5, up = 2.5, size = 0.35, sizeEnd = null, life = 0.8,
    spread = 0.25, grav = 0.6, drag = 0, spin = 3, additive = null, delay = 0, y = 0.3, alpha = 1, ambient = false, flat = false } = {}) {
    if (!pos) return;
    const scale = motion === 'full' ? 1 : motion === 'reduced' ? 0.35 : 0.15;
    const count = Math.max(1, Math.round(n * scale));
    const pool = (additive ?? ADDITIVE.has(kind)) ? pools.add : pools.alpha;
    const frame = (ATLAS[kind] ?? ATLAS.sparkle) + (flat ? 16 : 0);
    const slots = pool.ring.take(count);
    const a = pool.attrs;
    for (const i of slots) {
      const ang = rand() * Math.PI * 2;
      const sp = speed * (0.4 + rand() * 0.6);
      a.aStart.array.set([pos.x + Math.cos(ang) * spread * rand(), pos.y + y + rand() * 0.1, pos.z + Math.sin(ang) * spread * rand()], i * 3);
      a.aVel.array.set([Math.cos(ang) * sp, up * (0.6 + rand() * 0.5), Math.sin(ang) * sp], i * 3);
      a.aMisc.array.set([time + delay + rand() * 0.04, life * (0.75 + rand() * 0.5), frame, (rand() - 0.5) * 2 * spin], i * 4);
      const c = col(colors ? colors[Math.floor(rand() * colors.length)] : color);
      a.aColor.array.set([c.r, c.g, c.b, alpha], i * 4);
      const s0 = size * (0.7 + rand() * 0.6);
      a.aSize.array.set([s0, sizeEnd ?? s0 * 0.6, grav, drag], i * 4);
      pool.dirtyLo = Math.min(pool.dirtyLo, i);
      pool.dirtyHi = Math.max(pool.dirtyHi, i);
      pool.high = Math.max(pool.high, i + 1);
    }
    const until = time + delay + life * 1.3;
    if (ambient) pool.ambientUntil = Math.max(pool.ambientUntil, until);
    else pool.aliveUntil = Math.max(pool.aliveUntil, until);
  }

  function flushPool(pool) {
    pool.mesh.visible = time < Math.max(pool.aliveUntil, pool.ambientUntil);
    // all dead: restart the ring at slot 0, so the next burst draws a handful of quads, not up to the old mark
    if (!pool.mesh.visible && pool.high && pool.dirtyHi < 0) { pool.high = 0; pool.ring = createRing(cap); }
    pool.mesh.geometry.instanceCount = pool.mesh.visible ? pool.high : 0;
    if (pool.dirtyHi < 0) return;
    const lo = pool.dirtyLo; const n = pool.dirtyHi - lo + 1;
    for (const a of Object.values(pool.attrs)) {
      a.clearUpdateRanges();
      a.addUpdateRange(lo * a.itemSize, n * a.itemSize);
      a.needsUpdate = true;
    }
    pool.dirtyLo = Infinity; pool.dirtyHi = -1;
  }

  // -------------------------------------------------------------------------------------------------
  // rings on the ground (bloom ripple, ping, dust ring)
  const ringGeo = new THREE.RingGeometry(0.8, 1, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  function ring(pos, { color = '#ffffff', radius = 3, duration = 0.8, width = 0.2, additive = true, opacity = 0.8, delay = 0 } = {}) {
    if (!pos || motion === 'still') return;
    let r = rings.find((x) => !x.busy);
    if (!r) {
      if (rings.length >= 12) return;
      const m = new THREE.Mesh(ringGeo.clone(), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.renderOrder = 9;
      layer.add(m);
      r = { mesh: m, busy: false };
      rings.push(r);
    }
    r.busy = true;
    const m = r.mesh;
    m.material.color.set(color);
    m.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.position.set(pos.x, (pos.y || 0) + 0.06, pos.z);
    // ring width as a fraction: inner/outer = 1 - width/radius (geometry is 0.8..1; scale x/z only)
    m.scale.setScalar(0.01);
    m.visible = delay <= 0;
    tw.tween({ duration, delay, ease: EASE.outCubic, onUpdate: (e) => {
      m.visible = true;
      m.scale.set(radius * Math.max(0.02, e), 1, radius * Math.max(0.02, e));
      m.material.opacity = opacity * (1 - e) * (1 - e);
    }, onDone: () => { m.visible = false; r.busy = false; } });
    void width;
  }

  // -------------------------------------------------------------------------------------------------
  // ready-crop twinkles (RD-09, QA wave 2): a lead glint flashes briefly once every 3-6 s (its own period, so a field
  // sparkles here and there instead of pulsing together), small sizes are drifting motes that glow softly
  const TW_VS = /* glsl */`
  uniform float uTime;
  attribute vec3 aPos; attribute vec3 aCol; attribute vec2 aPhase;     // phase, size
  varying vec2 vUv; varying vec3 vColor; varying float vA;
  void main() {
    float mote = step(aPhase.y, 0.25);
    float period = 3.0 + 3.0 * fract(aPhase.x * 7.31 + 0.17);
    float t = fract(uTime / period + aPhase.x);
    float glint = pow(max(0.0, sin(t * 6.28318)), 10.0);
    float soft = 0.5 + 0.5 * sin(uTime * 1.6 + aPhase.x * 6.28);
    vec4 mv = modelViewMatrix * vec4(aPos + vec3(0.0, mote * 0.12 * sin(uTime * 0.7 + aPhase.x * 9.0), 0.0), 1.0);
    float a = uTime * 0.6 + aPhase.x * 6.28;
    mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
    mv.xy += r * position.xy * aPhase.y * mix(0.15 + 1.1 * glint, 0.7 + 0.3 * soft, mote);
    gl_Position = projectionMatrix * mv;
    vUv = (position.xy * vec2(1.0, -1.0) + 0.5) / 4.0; vUv.y = 1.0 - vUv.y;
    vColor = aCol; vA = mix(0.12 + 0.88 * glint, 0.3 + 0.3 * soft, mote);
  }`;
  // a warm gold glint with a cream core (visual-05: readable over green crops, never the crop's own hue)
  const TW_FS = /* glsl */`
  uniform sampler2D uAtlas; uniform vec3 uCore; varying vec2 vUv; varying vec3 vColor; varying float vA;
  void main() {
    vec4 t = texture2D(uAtlas, vUv); float a = t.a * vA; if (a < 0.01) discard;
    float core = 1.0 - smoothstep(0.06, 0.2, length(vUv * 4.0 - 0.5));
    gl_FragColor = vec4(mix(vColor, uCore, core) * t.rgb, a);
    #include <colorspace_fragment>
  }`;
  const uCore = { value: new THREE.Color('#FFF3C4') };
  const twinkles = { map: new Map(), cap: 0, mesh: null, dirty: false };
  function buildTwinkleMesh(capN) {
    if (twinkles.mesh) { layer.remove(twinkles.mesh); twinkles.mesh.geometry.dispose(); }
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(capN * 3), 3));
    geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(capN * 3), 3));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(capN * 2), 2));
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ uniforms: { uTime, uAtlas: { value: atlas }, uCore }, vertexShader: TW_VS, fragmentShader: TW_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    layer.add(mesh);
    twinkles.mesh = mesh;
    twinkles.cap = capN;
    twinkles.dirty = true;
  }
  function twinkle(key, pos, { color = '#FFE6A0', size = 0.38, phase } = {}) {
    if (!pos) { if (twinkles.map.delete(key)) twinkles.dirty = true; return; }
    const prev = twinkles.map.get(key);
    twinkles.map.set(key, { x: pos.x, y: pos.y, z: pos.z, color, size, phase: phase ?? prev?.phase ?? rand() });
    twinkles.dirty = true;
  }
  function flushTwinkles() {
    if (!twinkles.dirty) return;
    twinkles.dirty = false;
    const n = twinkles.map.size;
    if (n > twinkles.cap) buildTwinkleMesh(Math.max(64, 2 ** Math.ceil(Math.log2(n))));
    if (!twinkles.mesh) return;
    const g = twinkles.mesh.geometry;
    const p = g.getAttribute('aPos'); const c = g.getAttribute('aCol'); const ph = g.getAttribute('aPhase');
    let i = 0;
    for (const t of twinkles.map.values()) {
      p.setXYZ(i, t.x, t.y, t.z);
      const cc = col(t.color); c.setXYZ(i, cc.r, cc.g, cc.b);
      ph.setXY(i, t.phase, motion === 'still' ? t.size * 0.6 : t.size);
      i++;
    }
    p.needsUpdate = true; c.needsUpdate = true; ph.needsUpdate = true;
    g.instanceCount = n;
  }

  // -------------------------------------------------------------------------------------------------
  // rain (wave 4, owner wish 12): world-anchored streaks in ONE instanced draw, in two layers for depth: most drops
  // fill a 70 m box round the view's target, one in four falls through an 18 m box a third of the way from the camera
  // (big, fast, faint: they slide across the view). Each streak is drawn along its own fall line (the wind slants it)
  // between its head and its tail projected to the screen, fading toward the tail like motion blur. A drizzle is
  // fewer, shorter, thinner drops; a downpour the full count.
  const RAIN_VS = /* glsl */`
  uniform float uTime; uniform vec3 uFocus; uniform float uBox; uniform vec3 uNear; uniform float uStrength; uniform vec2 uSlant;
  attribute vec4 aSeed;
  varying float vA; varying vec2 vQ;
  void main() {
    bool near = aSeed.w < 0.25;
    float box = near ? 18.0 : uBox;
    vec3 c = near ? uNear : uFocus;
    float h = near ? 18.0 : 13.0;
    float y0 = near ? c.y - 9.0 : 0.0;
    float speed = ( near ? 16.0 : 11.0 ) + aSeed.w * 4.0;
    vec3 p;
    p.xz = c.xz + ( fract( ( aSeed.xz * box - c.xz ) / box ) - 0.5 ) * box;
    float fall = mod( aSeed.y * h - uTime * speed, h );
    p.y = y0 + fall;
    // the wind carries the drop sideways as it falls (the same slant for every drop: rain leans together)
    vec2 sl = uSlant * ( 0.85 + 0.3 * aSeed.z );
    p.xz -= sl * fall;
    float len = ( near ? 1.6 : 0.55 + 0.5 * fract( aSeed.w * 7.13 + aSeed.x ) ) * ( 0.55 + 0.45 * uStrength );
    // the streak trails up and back along the way it came (it moves +sl as it falls)
    vec3 tail = p + normalize( vec3( -sl.x, 1.0, -sl.y ) ) * len;
    vec4 a = modelViewMatrix * vec4( p, 1.0 );
    vec4 b = modelViewMatrix * vec4( tail, 1.0 );
    // n is the streak's right-hand side: the quad keeps PlaneGeometry's winding (the left-hand side mirrored it, and every
    // streak was culled as a back face: only the splashes showed; integration wave 4)
    vec2 d = b.xy - a.xy; float dl = max( length( d ), 1e-4 ); vec2 n = vec2( d.y, -d.x ) / dl;
    float w = ( near ? 0.065 : 0.034 ) * ( 0.6 + 0.4 * uStrength );
    vec4 mv = mix( a, b, position.y + 0.5 );
    mv.xy += n * position.x * w;
    gl_Position = projectionMatrix * mv;
    vQ = vec2( position.x * 2.0, position.y + 0.5 );
    vA = ( near ? 0.16 : 0.2 + 0.3 * aSeed.w ) * ( 0.65 + 0.35 * uStrength );
  }`;
  const RAIN_FS = /* glsl */`varying float vA; varying vec2 vQ;
  void main() { float k = ( 1.0 - vQ.y * vQ.y ) * ( 1.0 - 0.45 * vQ.x * vQ.x ); gl_FragColor = vec4( 0.8, 0.87, 0.97, vA * k ); }`;
  const rain = { mesh: null, intensity: 0, strength: 1, focus: { value: new THREE.Vector3(64, 0, 64) }, near: { value: new THREE.Vector3(64, 20, 64) },
    slant: { value: new THREE.Vector2(0.12, 0.05) }, uStrength: { value: 1 }, max: 1600, splashAcc: 0, dripAcc: 0, eaves: null };
  function setRain(intensity, { strength = rain.strength, near = null, wind = null } = {}) {
    rain.intensity = Math.max(0, Math.min(1, intensity || 0));
    rain.strength = Math.max(0.2, Math.min(1.2, strength));
    rain.uStrength.value = rain.strength;
    if (near) rain.near.value.copy(near);
    if (wind) rain.slant.value.set(wind.x, wind.z);
    if (rain.intensity > 0 && !rain.mesh) {
      const quad = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = quad.index;
      geo.setAttribute('position', quad.getAttribute('position'));
      const seed = new Float32Array(rain.max * 4);
      for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
      const mat = new THREE.ShaderMaterial({ uniforms: { uTime, uFocus: rain.focus, uBox: { value: 70 }, uNear: rain.near, uStrength: rain.uStrength, uSlant: rain.slant },
        vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      rain.mesh = new THREE.Mesh(geo, mat);
      rain.mesh.frustumCulled = false;
      rain.mesh.renderOrder = 13;
      layer.add(rain.mesh);
    }
    if (rain.mesh) {
      rain.mesh.visible = rain.intensity > 0;
      // a drizzle draws about half the drops of a downpour
      rain.mesh.geometry.instanceCount = Math.round(rain.max * rain.intensity * Math.min(1, 0.35 + 0.65 * rain.strength) * (cap / CAPS.high));
    }
  }

  // -------------------------------------------------------------------------------------------------
  // DOM: floaters and flights
  const floaters = [];
  function float(pos, text, { color = '#ffffff', size = 1.25, rise = 48, delay = 0, icon = null, life = 900, dy = 0 } = {}) {
    if (!pos) return;
    const s = toScreenM(pos.x, pos.z, (pos.y || 0) + 1.6);
    if (!s.visible) return;
    let f = floaters.find((x) => !x.busy);
    if (!f) {
      if (floaters.length >= 24) return;
      const outer = document.createElement('div');
      outer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;will-change:transform';
      const inner = document.createElement('div');
      inner.className = 'floater';
      // a chunky cartoon outline (8-way text-shadow) so floaters read on bright grass and on soil
      inner.style.cssText = 'position:relative;white-space:nowrap;font-weight:800;letter-spacing:.02em;display:flex;align-items:center;gap:4px;transform-origin:50% 100%;'
        + 'text-shadow:2px 0 0 #5A3418,-2px 0 0 #5A3418,0 2px 0 #5A3418,0 -2px 0 #5A3418,1.5px 1.5px 0 #5A3418,-1.5px 1.5px 0 #5A3418,1.5px -1.5px 0 #5A3418,-1.5px -1.5px 0 #5A3418,0 4px 0 rgba(60,30,10,.45)';
      outer.appendChild(inner);
      overlay.appendChild(outer);
      f = { outer, inner, busy: false, anim: null };
      floaters.push(f);
    }
    f.busy = true;
    f.inner.textContent = '';
    if (icon) {
      const img = document.createElement('img');
      img.src = iconUrl(icon, 64); img.alt = ''; img.width = 26; img.height = 26;
      f.inner.appendChild(img);
    }
    f.inner.appendChild(document.createTextNode(text));
    f.inner.style.color = color;
    f.inner.style.fontSize = `${size}rem`;
    f.outer.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y + dy)}px, 0) translate(-50%, -100%)`;
    const bouncy = motion === 'full';
    f.anim = f.inner.animate(bouncy ? [
      { transform: 'translateY(0) scale(0.6)', opacity: 0 },
      { transform: `translateY(${-rise * 0.3}px) scale(1.15)`, opacity: 1, offset: 0.28 },
      { transform: `translateY(${-rise * 0.7}px) scale(1)`, opacity: 1, offset: 0.7 },
      { transform: `translateY(${-rise}px) scale(1)`, opacity: 0 },
    ] : [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: life, delay, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' });
    f.anim.onfinish = () => { f.busy = false; f.outer.style.transform = 'translate3d(-999px,-999px,0)'; };
  }

  const flights = [];
  let flying = 0;
  const centres = new Map();          // HUD target key -> { at, point, el } (qa2 CL-05: one layout read per 400 ms)
  globalThis.addEventListener?.('resize', () => centres.clear());
  function resolveTarget(to, kind, meta) {
    if (to && typeof to === 'object' && 'x' in to) return { point: to, el: null };
    if (to instanceof Element) return { point: centerOf(to), el: to };
    if (meta && meta.by && me && meta.by !== me && meta.local === false) {
      const p = locator(meta.by);
      if (p) return { point: p, el: null };
    }
    const key = typeof to === 'string' ? to : targetFor(kind);
    const now = performance.now();
    const hit = centres.get(key);
    if (hit && now - hit.at < 400 && (!hit.el || hit.el.isConnected)) return hit;
    const sel = targets[key];
    const el = sel instanceof Element ? sel : (typeof sel === 'string' ? document.querySelector(sel) : null);
    const out = el && el.getClientRects().length ? { point: centerOf(el), el } : { point: null, el: null };
    centres.set(key, { ...out, at: now });
    return out;
  }
  function centerOf(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  function fly(kind, from, { qty = 1, to = null, by = null, local = true, delay = 0, item = null, size = 40 } = {}) {
    let start = from;
    if (from && from.isVector3) { const s = toScreenM(from.x, from.z, from.y || 0); if (!s.visible) start = null; else start = s; }
    if (!start) start = { x: innerWidth / 2, y: innerHeight * 0.6 };
    const meta = { by, local };
    const { point, el } = resolveTarget(to, kind, meta);
    const icon = item || (kind === 'coins' ? 'coins' : kind === 'xp' ? 'xp' : kind === 'acorns' ? 'acorns' : kind);
    let f = flights.find((x) => !x.busy);
    if (!f) {
      if (flights.length >= 20) return;
      const outer = document.createElement('div');
      outer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;will-change:transform';
      const img = document.createElement('img');
      img.alt = '';
      img.style.cssText = 'display:block;will-change:transform;filter:drop-shadow(0 2px 2px rgba(60,30,10,.4))';
      outer.appendChild(img);
      overlay.appendChild(outer);
      f = { outer, img, busy: false };
      flights.push(f);
    }
    f.busy = true;
    flying++;
    f.img.src = iconUrl(icon, 64);
    f.img.width = size; f.img.height = size;
    f.img.style.marginLeft = `${-size / 2}px`; f.img.style.marginTop = `${-size / 2}px`;
    const end = point || { x: start.x, y: start.y - 60 };
    const dur = motion === 'full' ? 450 : 250;
    // two nested tracks: X eases in, Y eases out -> a curved arc (visual-ux-juice §4.13)
    const ax = f.outer.animate([{ transform: `translate3d(${start.x}px,0,0)` }, { transform: `translate3d(${end.x}px,0,0)` }],
      { duration: dur, delay, easing: 'cubic-bezier(.55,.06,.68,.19)', fill: 'both' });
    const a = f.img.animate([{ transform: `translate3d(0,${start.y}px,0) scale(1)`, opacity: 1 }, { transform: `translate3d(0,${end.y}px,0) scale(${point ? 0.55 : 0.8})`, opacity: point ? 1 : 0 }],
      { duration: dur, delay, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' });
    a.onfinish = () => {
      f.busy = false;
      flying--;
      f.outer.style.transform = 'translate3d(-999px,0,0)';
      a.cancel();                       // its own two tracks: getAnimations() would flush the styles (CL-05)
      ax.cancel();
      if (el && motion !== 'still') el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
      try { dispatchEvent(new CustomEvent('hh:fly-arrive', { detail: { kind: targetFor(kind), item: icon, qty, by, local } })); } catch { /* no window in tests */ }
    };
  }

  // -------------------------------------------------------------------------------------------------
  // produce pop: a billboard of the item icon launches, bounces once, then flies to the HUD
  const pops = [];
  const iconTex = new Map();
  // a soft round placeholder while an icon texture loads (a square sprite looks broken)
  const dotTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 12, 0, Math.PI * 2); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  function texFor(id) {
    let t = iconTex.get(id);
    if (!t) {
      t = { tex: null };
      iconTex.set(id, t);
      loadTexture(iconUrl(id, 128)).then((x) => {
        t.tex = x;
        for (const p of pops) if (p.busy && p.item === id) { p.sprite.material.map = x; p.sprite.material.color.set('#ffffff'); p.sprite.material.needsUpdate = true; }
      })
        .catch(() => { /* fallback icon stays a coloured dot */ });
    }
    return t.tex;
  }
  /** Start loading item icon textures ahead of their first pop (e.g. when a crop is planted). */
  function preload(ids) { for (const id of [].concat(ids || [])) if (typeof id === 'string') texFor(id); }

  function pop(item, pos, { qty = 1, to = null, by = null, local = true, delay = 0, n = null } = {}) {
    if (!pos) { fly(item, null, { qty, to, by, local, item }); return; }
    const count = n ?? Math.min(3, Math.max(1, qty));
    for (let k = 0; k < count; k++) {
      let p = pops.find((x) => !x.busy);
      if (!p) {
        if (pops.length >= 24) { fly(item, pos, { qty, to, by, local, item }); continue; }
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false }));
        sprite.renderOrder = 14;
        layer.add(sprite);
        p = { sprite, busy: false };
        pops.push(p);
      }
      const tex = texFor(item);
      p.busy = true;
      p.item = item;
      p.sprite.material.map = tex || dotTex;
      p.sprite.material.color.set(tex ? '#ffffff' : (cropOf(item)?.hue || '#ffd34a'));
      p.sprite.material.needsUpdate = true;
      p.sprite.visible = false;
      const ang = rand() * Math.PI * 2;
      p.x = pos.x; p.z = pos.z; p.y = (pos.y || 0) + 0.3;
      p.vx = Math.cos(ang) * (0.4 + rand() * 0.5); p.vz = Math.sin(ang) * (0.4 + rand() * 0.5);
      p.vy = 4.85 + rand() * 0.5;                    // ~1.2 m up (GDD §7.2)
      p.t = -(delay + k * 0.06);
      p.bounced = false;
      p.done = false;
      p.meta = { qty: k === 0 ? qty : 0, to, by, local };
    }
  }
  function stepPops(dt) {
    let any = false;
    for (const p of pops) {
      if (!p.busy) continue;
      any = true;
      p.t += dt;
      if (p.t < 0) continue;
      p.sprite.visible = true;
      p.vy -= 9.8 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.25 && p.vy < 0 && !p.bounced) { p.y = 0.25; p.vy = -p.vy * 0.38; p.vx *= 0.6; p.vz *= 0.6; p.bounced = true; }
      if (p.y < 0.25) { p.y = 0.25; p.vy = 0; }
      const s = 0.62 * (p.t < 0.12 ? 0.4 + 5 * p.t : 1);
      p.sprite.scale.set(s, s, s);
      p.sprite.position.set(p.x, p.y + s * 0.5, p.z);
      if (p.t >= 0.6) {
        p.busy = false;
        p.sprite.visible = false;
        v3.set(p.x, p.y + s * 0.5, p.z);
        fly(p.item, v3.clone(), { ...p.meta, item: p.item, qty: p.meta.qty });
      }
    }
    return any;
  }

  // -------------------------------------------------------------------------------------------------
  // event recipes (GDD §7.2). Positions are the object's centre on the ground (metres).
  const up = (pos, y) => (pos ? new THREE.Vector3(pos.x, (pos.y || 0) + y, pos.z) : null);
  const leafColors = ['#5BB040', '#3F8F36', '#8FD05A'];
  const confetti = ['#FF7A6B', '#2BB3A3', '#FFC83D', '#4AA8E8', '#A98BE0', '#FF9FB0'];
  const R = recipes;
  R.set('planted', (f, ev, pos) => { if (ev.crop) preload(ev.crop); f.burst('dirt', pos, { n: 6, color: '#7A4A2A', speed: 1.4, up: 2.2, size: 0.16, grav: 0.9, life: 0.6, y: 0.15 }); });
  R.set('uprooted', (f, ev, pos) => {
    f.burst('leaf', pos, { n: 6, colors: leafColors, speed: 1.6, up: 3, size: 0.24, grav: 0.5, life: 0.9 });
    f.burst('dust', pos, { n: 3, color: '#B5916A', speed: 0.6, up: 0.6, size: 0.6, sizeEnd: 1.1, grav: 0, life: 0.7 });
  });
  R.set('harvested', (f, ev, pos, meta) => {
    const item = ev.item || ev.crop;
    const qty = ev.qty ?? 1;
    f.burst('leaf', pos, { n: 5, colors: leafColors, speed: 1.4, up: 2.6, size: 0.22, grav: 0.45, life: 0.9 });
    f.pop(item, pos, { qty, by: meta.by, local: meta.local });
    f.float(pos, gotText(item, qty), { color: '#FFFFFF', icon: null });
    if (ev.xp) f.float(pos, t('game.fx.xp', { n: ev.xp }), { color: '#BFE6FF', delay: 120, size: 1.0, dy: -28 });
    if (ev.fresh) f.float(pos, t('game.fx.fresh'), { color: '#9BE36E', delay: 200, size: 1.0, dy: ev.xp ? -54 : -28 });
    if (ev.ribbon || ev.blueRibbon) R.get('blueRibbon')(f, ev, pos, meta);
    // drag-paint streak: every 10th plot of a stroke gets a sparkle burst
    streak = time - streak.at < 1.6 ? { n: streak.n + 1, at: time } : { n: 1, at: time };
    if (streak.n % 10 === 0) f.burst('sparkle', pos, { n: 14, color: '#FFE27A', speed: 2.2, up: 3, size: 0.45, grav: 0.2, life: 0.9 });
  });
  R.set('blueRibbon', (f, ev, pos) => {
    f.burst('sparkle', pos, { n: 18, color: '#7CC4FF', speed: 2.4, up: 3.2, size: 0.5, grav: 0.15, life: 1.1 });
    f.ring(pos, { color: '#4AA8E8', radius: 2.2, duration: 0.7 });
    f.float(up(pos, 1.2), t('game.fx.blueRibbon'), { color: '#7CC4FF', delay: 300 });
  });
  R.set('watered', (f, ev, pos, meta) => {
    f.burst('droplet', up(pos, 1.6), { n: 10, color: '#6FD3E6', speed: 0.5, up: -0.5, size: 0.2, grav: 0.9, life: 0.55, spread: 0.6, spin: 0 });
    f.burst('droplet', pos, { n: 6, color: '#BFEFFF', speed: 1.4, up: 1.6, size: 0.12, grav: 0.8, life: 0.45, delay: 0.35, y: 0.15 });
    const pct = ev.pct ?? (ev.partner ? 5 : 15);
    f.float(up(pos, 0.3), ev.partner || (meta && ev.tend) ? `-${pct} % ♥` : `-${pct} %`, { color: '#BFEFFF', delay: 150 });
  });
  R.set('composted', (f, ev, pos) => {
    f.burst('dust', pos, { n: 4, color: '#7A5233', speed: 0.8, up: 0.8, size: 0.55, sizeEnd: 1.0, grav: 0, life: 0.7 });
    f.burst('sparkle', pos, { n: 6, color: '#FFE27A', speed: 0.8, up: 1.2, size: 0.22, grav: 0.1, life: 0.9, delay: 0.15 });
  });
  // wave 4 (owner wish 2): Fertilizer reads apart from Compost: dark rich crumbs and a green-gold shimmer rising
  R.set('fertilized', (f, ev, pos) => {
    f.burst('dirt', up(pos, 0.9), { n: 10, color: '#3A2618', speed: 0.7, up: -0.4, size: 0.12, grav: 1.0, life: 0.6, spread: 0.6 });
    f.burst('sparkle', pos, { n: 10, colors: ['#B8E86A', '#FFE27A', '#7FD06A'], speed: 0.9, up: 1.8, size: 0.26, grav: -0.05, life: 1.1, delay: 0.2 });
    f.ring(pos, { color: '#9BD86A', radius: 1.3, duration: 0.6, opacity: 0.6 });
  });
  // Hurry / "Finish now" (live requests 2026-10-04): golden stars, a ring and "Ready!" where the timer was cut
  R.set('hurried', (f, ev, pos) => {
    const small = ev.kind === 'plot';
    f.burst('star', up(pos, small ? 0.5 : 1), { n: small ? 12 : 18, colors: ['#FFE27A', '#FFFFFF', '#F5C542'], speed: 2.4, up: 3.4, size: 0.42, grav: 0.3, drag: 0.6, life: 1.0 });
    f.burst('sparkle', up(pos, 0.2), { n: 10, color: '#FFE9A8', speed: 1.3, up: 2, size: 0.3, grav: 0.1, life: 0.9, delay: 0.08 });
    f.ring(pos, { color: '#FFC83D', radius: small ? 1.4 : 2.6, duration: 0.6, opacity: 0.75 });
    f.float(up(pos, 0.3), t('hud.tip.ready'), { color: '#FFE58A', delay: 140 });
  });
  const dustRing = (f, pos, big = 1) => {
    if (!pos) return;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      f.burst('dust', new THREE.Vector3(pos.x + Math.cos(a) * 1.2 * big, pos.y || 0, pos.z + Math.sin(a) * 1.2 * big),
        { n: 1, color: '#E3CFA8', speed: 0.9, up: 0.5, size: 0.9 * big, sizeEnd: 1.6 * big, grav: 0, life: 0.8, y: 0.1, spread: 0 });
    }
    f.ring(pos, { color: '#F3E2BE', radius: 2.4 * big, duration: 0.6, additive: false, opacity: 0.6 });
  };
  R.set('placed', (f, ev, pos) => dustRing(f, pos, ev.def === 'plot' ? 0.6 : 1));
  R.set('built', R.get('placed'));
  R.set('bought', (f, ev, pos) => { if (pos) dustRing(f, pos, 1); });
  R.set('moved', (f, ev, pos) => dustRing(f, pos, 0.6));
  R.set('removed', (f, ev, pos) => f.burst('dust', pos, { n: 8, color: '#E3CFA8', speed: 1.2, up: 1, size: 0.8, sizeEnd: 1.4, grav: 0, life: 0.7 }));
  R.set('stored', R.get('removed'));
  R.set('sold', (f, ev, pos, meta) => {
    const n = Math.min(8, Math.max(1, Math.ceil((ev.coins || 1) / 25)));
    for (let i = 0; i < n; i++) f.fly('coins', pos || null, { qty: i === 0 ? ev.coins : 0, by: meta.by, local: meta.local, delay: i * 40, size: 34 });
    if (pos) f.float(pos, tn('game.fx.coins', ev.coins), { color: '#FFE58A' });
  });
  R.set('delivered', (f, ev, pos, meta) => {
    R.get('sold')(f, { coins: ev.coins || 0 }, pos, meta);
    if (ev.xp) for (let i = 0; i < 3; i++) f.fly('xp', pos || null, { qty: i ? 0 : ev.xp, by: meta.by, local: meta.local, delay: 120 + i * 60, size: 34 });
  });
  R.set('levelUp', (f, ev, pos) => {
    // 240 BPM: four confetti pulses 250 ms apart, sparkles, a Bloom ripple across the fields (GDD §7.2)
    for (let k = 0; k < 4; k++) {
      f.burst('confetti', up(pos, 2), { n: 46, colors: confetti, speed: 5.5, up: 7.5, size: 0.5, grav: 0.35, drag: 0.6, life: 2.2, spread: 2, delay: k * 0.25, spin: 8 });
      f.burst('star', up(pos, 1.5), { n: 10, colors: ['#FFE27A', '#FFFFFF'], speed: 4, up: 5, size: 0.6, grav: 0.2, drag: 1, life: 1.4, delay: k * 0.25 });
    }
    f.ring(pos, { color: '#FFE9A8', radius: 45, duration: 2.0, opacity: 0.35 });
    f.ring(pos, { color: '#FFFFFF', radius: 20, duration: 1.2, opacity: 0.3, delay: 0.25 });
  });
  R.set('expanded', (f, ev, pos) => {
    f.burst('confetti', up(pos, 1.5), { n: 50, colors: confetti, speed: 6, up: 6, size: 0.35, grav: 0.35, drag: 0.6, life: 2.0, spread: 4 });
    f.ring(pos, { color: '#9BE36E', radius: 18, duration: 1.4, opacity: 0.6 });
  });
  const celebrate = (f, ev, pos) => {
    f.burst('sparkle', up(pos, 1.2), { n: 22, colors: ['#FFE27A', '#FFFFFF', '#FF9FB0'], speed: 2.5, up: 3.5, size: 0.5, grav: 0.15, life: 1.2 });
    f.burst('heart', up(pos, 1.6), { n: 6, colors: ['#FF5A7A', '#FF9FB0'], speed: 1, up: 2, size: 0.4, grav: -0.05, life: 1.4 });
  };
  R.set('achievement', celebrate);
  R.set('questDone', celebrate);
  R.set('duet', celebrate);
  R.set('together', celebrate);
  R.set('highFive', (f, ev, pos) => {
    f.burst('star', up(pos, 1.8), { n: 12, colors: ['#FFE27A', '#FFFFFF'], speed: 3, up: 2.5, size: 0.4, grav: 0.2, life: 0.8 });
    f.ring(up(pos, 1.6), { color: '#FFE27A', radius: 1.6, duration: 0.5 });
  });
  R.set('goldenHour', (f, ev, pos) => {
    f.burst('heart', up(pos, 1.2), { n: 12, colors: ['#FF5A7A', '#FFC83D', '#FF9FB0'], speed: 1.2, up: 2.5, size: 0.45, grav: -0.05, life: 2.0 });
    f.burst('glow', up(pos, 1.0), { n: 16, color: '#FFE27A', speed: 1.5, up: 0.5, size: 0.25, grav: -0.02, drag: 0.5, life: 3.0, spread: 3 });
  });
  // a lost race during a Together Combo: a small shared heart instead of a toast (GDD §6.2 #6, §6.3)
  R.set('heartSpark', (f, ev, pos) => {
    f.burst('heart', up(pos, 0.9), { n: 4, colors: ['#FF5A7A', '#FF9FB0', '#FFC83D'], speed: 0.8, up: 1.9, size: 0.34, grav: -0.08, life: 1.2, spin: 0.4 });
  });
  R.set('joined', (f, ev, pos) => { f.burst('dust', pos, { n: 8, color: '#FFFFFF', speed: 1.5, up: 1, size: 0.8, sizeEnd: 1.4, grav: 0, life: 0.6 }); f.burst('sparkle', up(pos, 1), { n: 8, color: '#FFE27A', speed: 1.5, up: 2, size: 0.35, life: 0.8 }); });
  R.set('petted', (f, ev, pos) => {
    f.burst('heart', up(pos, 1.0), { n: ev.both ? 5 : 3, colors: ['#FF5A7A', '#FF9FB0'], speed: 0.6, up: 1.8, size: 0.32, grav: -0.08, life: 1.1, spin: 0.5 });
  });
  R.set('tended', (f, ev, pos, meta) => {
    if (ev.feed && pos) {
      // the feed icon flies from the Barn button to the animal (250 ms), then hearts and the product
      const { point } = resolveTarget('barn', 'barn', meta);
      const s = toScreenM(pos.x, pos.z, 0.8);
      if (point && s.visible) f.fly(ev.feed, point, { to: s, qty: 0, item: ev.feed, size: 30 });
    }
    f.burst('heart', up(pos, 1.0), { n: 3, colors: ['#FF5A7A', '#FF9FB0'], speed: 0.6, up: 1.6, size: 0.3, grav: -0.08, life: 1.1, delay: 0.25 });
    if (ev.product || ev.item) R.get('collected')(f, ev, pos, meta);
  });
  R.set('fed', (f, ev, pos) => {
    f.burst('dirt', pos, { n: 5, color: '#E8B84A', speed: 0.8, up: 1.0, size: 0.1, grav: 0.8, life: 0.5, y: 0.6 });
    f.burst('heart', up(pos, 1.0), { n: 2, colors: ['#FF5A7A', '#FF9FB0'], speed: 0.6, up: 1.6, size: 0.3, grav: -0.08, life: 1.1, delay: 0.3 });
  });
  R.set('collected', (f, ev, pos, meta) => {
    const item = ev.product || ev.item;
    if (!item) return;
    const qty = ev.qty ?? 1;
    f.pop(item, up(pos, 0.4), { qty, by: meta.by, local: meta.local });
    f.float(pos, gotText(item, qty), { color: '#FFFFFF' });
    if (ev.ribbon || ev.premium) R.get('blueRibbon')(f, ev, pos, meta);
  });
  R.set('trayCollected', (f, ev, pos, meta) => {
    const items = ev.items ? Object.entries(ev.items) : (ev.item ? [[ev.item, ev.qty ?? 1]] : []);
    items.forEach(([id, qty], i) => { f.pop(id, up(pos, 1.2), { qty, by: meta.by, local: meta.local, delay: i * 0.08 }); });
    if (items.length) f.float(up(pos, 1.5), items.map(([id, q]) => gotText(id, q)).join('  '), { color: '#FFFFFF' });
  });
  R.set('shaken', (f, ev, pos, meta) => {
    f.burst('leaf', up(pos, 3.2), { n: 12, colors: leafColors, speed: 1.6, up: 0.4, size: 0.3, grav: 0.18, drag: 1.2, life: 1.8, spread: 1.4, spin: 4 });
    const item = ev.item || ev.product;
    if (item) {
      f.pop(item, up(pos, 2.2), { qty: ev.qty ?? 1, by: meta.by, local: meta.local, n: Math.min(4, ev.qty ?? 1) });
      f.float(up(pos, 2), gotText(item, ev.qty ?? 1), { color: '#FFFFFF' });
    }
  });
  R.set('treeHarvested', R.get('shaken'));
  R.set('chopped', (f, ev, pos, meta) => {
    f.burst('dirt', up(pos, 0.5), { n: 8, color: '#C9A06A', speed: 2, up: 2.5, size: 0.14, grav: 0.9, life: 0.6 });
    if (ev.final || ev.cleared) R.get('cleared')(f, ev, pos, meta);
  });
  R.set('cleared', (f, ev, pos, meta) => {
    f.burst('dust', pos, { n: 8, color: '#E3CFA8', speed: 1.4, up: 1.2, size: 0.8, sizeEnd: 1.5, grav: 0, life: 0.7 });
    f.burst('leaf', pos, { n: 4, colors: leafColors, speed: 1.6, up: 2.5, size: 0.22, grav: 0.5, life: 0.8 });
    if (ev.wood) f.pop('wood', pos, { qty: ev.wood, by: meta.by, local: meta.local });
    if (ev.coins) f.fly('coins', pos, { qty: ev.coins, by: meta.by, local: meta.local });
    if (ev.xp) f.float(up(pos, 0.3), t('game.fx.xp', { n: ev.xp }), { color: '#BFE6FF' });
  });
  // ---- wave 4 (the owners' wish list) ----
  // weeds pulled with the Hand (wish F, rules `weedsCleared { cells: [z * WORLD_TILES + x], coins, by }`): a puff of
  // grass and a flower or two at each tile, the tiny reward flying to the purse
  R.set('weedsCleared', (f, ev, pos, meta) => {
    const cells = Array.isArray(ev.cells) ? ev.cells : [];
    const at = cells.slice(0, 40).map((c) => new THREE.Vector3(((c % WORLD_TILES) + 0.5) * TILE_M, 0, (Math.floor(c / WORLD_TILES) + 0.5) * TILE_M));
    if (!at.length && Number.isFinite(ev.x) && Number.isFinite(ev.z)) at.push(new THREE.Vector3((ev.x + 0.5) * TILE_M, 0, (ev.z + 0.5) * TILE_M));
    if (!at.length && pos) at.push(pos);
    for (const p0 of at) {
      f.burst('leaf', p0, { n: 4, colors: ['#5BB040', '#93BE5E', '#3F6B2E'], speed: 1.3, up: 2.2, size: 0.2, grav: 0.55, life: 0.8, y: 0.2 });
      f.burst('petal', p0, { n: 2, colors: ['#FFD76A', '#FFF3C4'], speed: 1.0, up: 1.8, size: 0.16, grav: 0.3, life: 0.9, y: 0.3 });
      f.burst('dust', p0, { n: 2, color: '#C9B48A', speed: 0.5, up: 0.4, size: 0.5, sizeEnd: 0.9, grav: 0, life: 0.5, y: 0.05 });
    }
    if (ev.coins && at.length) f.fly('coins', at[at.length - 1], { qty: ev.coins, by: meta.by, local: meta.local, size: 30 });
  });
  // an upgrade tier bought (wish E, `upgraded { id, def, tier, name }`): hammer dust round the piece, confetti, the tier's name
  R.set('upgraded', (f, ev, pos) => {
    const c = here(pos);
    dustRing(f, c, 1.1);
    f.burst('confetti', up(c, 2.5), { n: 22, colors: confetti, speed: 2.6, up: 3.4, size: 0.36, grav: 0.35, drag: 0.6, life: 1.5, spread: 1.4, delay: 0.15 });
    f.burst('star', up(c, 1.5), { n: 10, colors: ['#FFE27A', '#FFFFFF'], speed: 2, up: 2.6, size: 0.4, grav: 0.2, life: 1.0, delay: 0.2 });
    const tier = upgradeTierName(ev);
    f.float(up(c, 3.2), tier ? t('game.fx.upgradedTier', { name: tier }) : t('game.fx.upgraded'), { color: '#FFE58A', size: 1.15, delay: 250 });
  });
  // ---- wave 4b (the owners' wish list of 2026-10-05) ----
  // a tree came of age (`treeAged { stage }`): it grows (objects-view), leaves fly, its new age floats up
  R.set('treeAged', (f, ev, pos) => {
    if (!pos) return;
    f.burst('leaf', up(pos, 3), { n: 16, colors: leafColors, speed: 1.8, up: 1.4, size: 0.3, grav: 0.2, drag: 1, life: 1.6, spread: 1.6, spin: 4 });
    f.burst('sparkle', up(pos, 2.6), { n: 12, colors: ['#FFE27A', '#FFFFFF'], speed: 1.6, up: 2.2, size: 0.4, grav: 0.2, life: 1.0, delay: 0.2 });
    const st = typeof ev.stage === 'string' ? ev.stage : '';
    f.float(up(pos, 3.4), st ? t('game.fx.treeAged', { stage: treeAgeName(st) }) : t('game.fx.older'), { color: '#B9F27A', size: 1.15, delay: 300 });
  });
  // a home grew its pen (`homeGrew`): the dust of the new fence, confetti, "Bigger pen!" (only when it really grew)
  R.set('homeGrew', (f, ev, pos) => {
    if (!pos) return;
    const c = here(pos);
    if (ev.grows) dustRing(f, c, 1.6);
    f.burst('confetti', up(c, 2), { n: ev.grows ? 20 : 10, colors: confetti, speed: 2.4, up: 3, size: 0.32, grav: 0.35, drag: 0.6, life: 1.4, spread: 1.6, delay: 0.1 });
    f.float(up(c, 2.6), ev.grows ? t('game.fx.biggerPen') : t('game.fx.moreRoom'), { color: '#FFE58A', size: 1.1, delay: 250 });
  });
  // the Golden Watering Can (`wateredAll`): render/index.js gathers the crops of the same moment into ev.positions (metres,
  // nearest the farmer first): a wave of water rolls out over them, every crop a few drops and a ripple, one line of text
  R.set('wateredAll', (f, ev, pos) => {
    const ps = Array.isArray(ev.positions) ? ev.positions : [];
    ps.forEach((p, i) => {
      const d = Math.min(1.6, (p.d || 0) / 14);
      f.burst('droplet', up(p, 1.5), { n: 4, colors: ['#6FD3E6', '#BFEFFF'], speed: 0.4, up: -0.4, size: 0.18, grav: 0.9, life: 0.5, spread: 0.5, spin: 0, delay: d });
      if (i % 2 === 0) f.burst('sparkle', up(p, 0.8), { n: 1, color: '#FFE27A', speed: 0.3, up: 0.8, size: 0.25, grav: 0, life: 0.6, delay: d + 0.1 });
    });
    const at = pos || ps[0];
    if (at) f.float(up(at, 0.6), t('game.fx.watered', { n: ev.n ?? ps.length }), { color: '#BFEFFF', size: 1.15, delay: 200 });
  });
  // the Farmhand (`farmhandDone`): hearts and feed over every animal it tended (ev.positions), the goods it gathered fly
  // home in one pop per kind (ev.items from the batch's `collected`), "Farmhand: N animals"
  R.set('farmhandDone', (f, ev, pos, meta) => {
    const ps = Array.isArray(ev.positions) ? ev.positions : [];
    ps.forEach((p, i) => {
      const d = Math.min(1.4, i * 0.05);
      f.burst('heart', up(p, 1.0), { n: 1, colors: ['#FF5A7A', '#FF9FB0'], speed: 0.4, up: 1.4, size: 0.3, grav: -0.08, life: 1.0, delay: d });
      f.burst('dirt', p, { n: 2, color: '#E8B84A', speed: 0.6, up: 0.8, size: 0.1, grav: 0.8, life: 0.45, y: 0.5, delay: d });
    });
    const at = pos || ps[0] || null;
    Object.entries(ev.items || {}).forEach(([item, qty], i) => f.pop(item, at ? up(at, 0.5) : null, { qty, by: meta.by, local: meta.local, delay: 0.3 + i * 0.12 }));
    if (at) f.float(up(at, 1.2), tn('game.fx.farmhand', ev.n ?? ps.length), { color: '#FFFFFF', delay: 150 });
  });
  // the Time Turner (`timeTurned { ids }`): a golden swirl over every workshop it finished (ev.positions)
  R.set('timeTurned', (f, ev) => {
    (Array.isArray(ev.positions) ? ev.positions : []).forEach((p, i) => {
      const d = i * 0.12;
      f.burst('star', up(p, 3), { n: 8, colors: ['#FFE27A', '#FFFFFF', '#F2C230'], speed: 1.8, up: 1.2, size: 0.35, grav: 0.1, life: 1.0, spread: 0.6, spin: 6, delay: d });
      f.burst('glow', up(p, 3), { n: 2, color: '#FFE9A8', speed: 0, up: 0.3, size: 1.4, sizeEnd: 0.4, life: 0.9, grav: 0, delay: d });
      f.ring(up(p, 0), { color: '#FFD45A', radius: 3, duration: 0.8, width: 0.3, delay: d });
      if (i === 0) f.float(up(p, 3.6), t('game.fx.done'), { color: '#FFE58A', size: 1.15, delay: 200 });
    });
  });
  // a relic bought (`relicBought`): golden sparkles where the buyer looks (the Golden Barn shows its cupola itself)
  R.set('relicBought', (f, ev, pos) => {
    if (!pos) return;
    f.burst('sparkle', up(pos, 1.5), { n: 20, colors: ['#FFE27A', '#FFFFFF', '#F2C230'], speed: 2.4, up: 3, size: 0.45, grav: 0.25, life: 1.2, spread: 1.2 });
    f.burst('confetti', up(pos, 2), { n: 14, colors: confetti, speed: 2.2, up: 3, size: 0.3, grav: 0.35, drag: 0.6, life: 1.3, spread: 1.2, delay: 0.1 });
  });
  // the Lucky Clover's blue ribbons (render/index.js adds it to a ribbon harvest while the farm owns the clover)
  R.set('luckyClover', (f, ev, pos) => {
    if (!pos) return;
    f.burst('leaf', up(pos, 1.6), { n: 8, colors: ['#3FAE4A', '#4FC25A', '#8BE07A'], speed: 1.4, up: 2.2, size: 0.32, grav: 0.2, drag: 1, life: 1.3, spread: 0.6, spin: 3 });
    f.float(up(pos, 1.6), t('game.fx.lucky'), { color: '#9BE36E', size: 1.0, delay: 550, dy: -28 });
  });
  // the loot crates play in render/crates-view.js (the fall, the shake, the lid, the loot's flights)
  R.set('crateDropped', () => {});
  R.set('crateOpened', () => {});

  // a decor piece sold from the build tray (wish A, `soldStored { coins, acorns }`): the coins fly, no world position
  R.set('soldStored', (f, ev, pos, meta) => {
    R.get('sold')(f, { coins: ev.coins || 0 }, pos, meta);
    if (ev.acorns && meta.local) f.fly('acorns', pos || null, { qty: ev.acorns, by: meta.by, local: meta.local, delay: 120, size: 34 });
  });
  // a pet's new breed (wish 6, avatars-view plays it at the pet) and a farmer's new look (wish 9, at the farmer)
  R.set('petBreed', (f, ev, pos) => {
    if (!pos) return;                    // render/index.js plays it without a place; avatars-view at the pet
    f.burst('sparkle', up(here(pos), 0.5), { n: 16, colors: ['#FFFFFF', '#FFE27A', '#FF9FB0'], speed: 1.6, up: 2.2, size: 0.34, grav: 0.1, life: 1.1, spread: 0.5 });
    f.burst('heart', up(here(pos), 0.8), { n: 4, colors: ['#FF5A7A', '#FF9FB0'], speed: 0.8, up: 1.6, size: 0.3, grav: -0.06, life: 1.2 });
  });
  R.set('avatarChanged', (f, ev, pos) => {
    if (!pos) return;                    // avatars-view plays it at the farmer
    const c = pos;
    f.burst('sparkle', up(c, 1.0), { n: 18, colors: ['#FFFFFF', '#FFE27A', '#BFE6FF'], speed: 1.8, up: 2.4, size: 0.36, grav: 0.1, life: 1.1, spread: 0.6 });
    f.ring(c, { color: '#FFF3C4', radius: 1.6, duration: 0.7 });
  });
  R.set('queued', (f, ev, pos, meta) => {
    // ingredients fly from the barn button into the building (reverse flight), then a puff
    if (!pos) return;
    const s = toScreenM(pos.x, pos.z, 2);
    const ins = ev.inputs ? Object.keys(ev.inputs) : [];
    const { point } = resolveTarget('barn', 'barn', meta);
    ins.slice(0, 4).forEach((id, i) => { if (point) f.fly(id, point, { to: s, qty: 0, delay: i * 70, item: id, size: 32 }); });
    f.burst('dust', up(pos, 2.5), { n: 3, color: '#FFFFFF', speed: 0.3, up: 1, size: 0.7, sizeEnd: 1.4, grav: -0.05, life: 1.0, delay: 0.4 });
  });
  R.set('crafted', (f, ev, pos) => { f.burst('sparkle', up(pos, 2.5), { n: 10, color: '#FFE27A', speed: 1.4, up: 2, size: 0.4, grav: 0.1, life: 1.0 }); });
  R.set('ping', (f, ev, pos) => { f.ring(pos, { color: ev.color || '#FFC83D', radius: 2.5, duration: 0.8 }); });

  // ---- wave 2 (M1b) ----------------------------------------------------------------------------------------
  // where a celebration without a world position plays: the middle of the screen (the camera's ground target)
  const here = (pos) => pos || new THREE.Vector3(rain.focus.value.x, 0, rain.focus.value.z);
  // a point on the screen (CSS px) for flights with nowhere in the world to go
  const screenAt = (fx0, fy0) => ({ x: (typeof innerWidth === 'number' ? innerWidth : 1280) * fx0, y: (typeof innerHeight === 'number' ? innerHeight : 720) * fy0 });
  const TILE = 2;
  const chips = (f, pos, n = 8, hex = '#C9A06A') => f.burst('dirt', up(pos, 0.6), { n, colors: [hex, '#E2C08A', '#8A5A35'], speed: 2.4, up: 2.6, size: 0.15, grav: 0.9, life: 0.7, spin: 6 });
  // a chop on standing debris, or on a Giant (giant: true): chips fly; the Giant shows the damage of this chop
  // (15 when it was a teamwork chop: the previous one was the partner's)
  const giantHp = new Map();
  R.set('chopHit', (f, ev, pos) => {
    if (ev.giant) {
      const c = pos ? new THREE.Vector3(pos.x + TILE, 0, pos.z + TILE) : null;
      chips(f, c, 14, (cropOf(ev.def) || {}).hue || '#C9A06A');
      f.burst('leaf', up(c, 1.4), { n: 6, colors: leafColors, speed: 2.2, up: 2.4, size: 0.3, grav: 0.5, life: 1.0 });
      const prev = giantHp.get(ev.id); giantHp.set(ev.id, ev.hp);
      const hit = Number.isFinite(prev) && Number.isFinite(ev.hp) ? prev - ev.hp : null;
      if (hit) f.float(up(c, 1.6), hit >= 15 ? t('game.fx.chopTogether', { n: hit }) : `-${hit}`, { color: hit >= 15 ? '#FFB3C1' : '#FFFFFF', size: hit >= 15 ? 1.2 : 1.05 });
      return;
    }
    chips(f, pos);
  });
  // the last planting of a composted 3 x 3 block rolled a Giant: a golden swirl rises over the block
  R.set('giantFormed', (f, ev, pos) => {
    const c = pos ? new THREE.Vector3(pos.x + TILE, 0, pos.z + TILE) : here(null);
    for (let k = 0; k < 3; k++) f.burst('sparkle', up(c, 0.4), { n: 16, colors: ['#FFE27A', '#FFFFFF', '#9BE36E'], speed: 2.6, up: 3.2, size: 0.45, grav: 0.1, drag: 0.6, life: 1.5, spread: 2.4, delay: k * 0.25 });
    f.ring(c, { color: '#FFE9A8', radius: 4.2, duration: 1.1, opacity: 0.7 });
    f.float(up(c, 2.2), t('game.fx.giantGrowing'), { color: '#FFE58A', size: 1.25, life: 1400 });
  });
  // a Giant felled: a 3 x 3 dust ring, a fountain of the produce, confetti; together = hearts too
  R.set('giantFelled', (f, ev, pos, meta) => {
    const c = pos ? new THREE.Vector3(pos.x + TILE, 0, pos.z + TILE) : here(null);
    dustRing(f, c, 2.2);
    f.burst('leaf', up(c, 1.2), { n: 22, colors: leafColors, speed: 3.6, up: 4.5, size: 0.4, grav: 0.45, life: 1.6, spread: 2 });
    f.burst('confetti', up(c, 2), { n: 50, colors: confetti, speed: 5, up: 7, size: 0.45, grav: 0.35, drag: 0.6, life: 2.0, spread: 2.5, spin: 8 });
    const item = ev.crop || ev.item;
    if (item) {
      for (let k = 0; k < 6; k++) f.pop(item, new THREE.Vector3(c.x + (Math.random() - 0.5) * 3, 0.2, c.z + (Math.random() - 0.5) * 3), { qty: k === 0 ? ev.qty ?? 0 : 0, by: meta.by, local: meta.local, delay: 0.1 + k * 0.08, n: 1 });
      f.float(up(c, 2.4), t('game.fx.giant', { item: itemName(item), n: ev.qty ?? '' }), { color: '#FFE58A', size: 1.4, life: 1600 });
    }
    if (ev.team || ev.pair) { f.burst('heart', up(c, 2.2), { n: 10, colors: ['#FF5A7A', '#FF9FB0', '#FFC83D'], speed: 1.4, up: 2.4, size: 0.45, grav: -0.05, life: 1.8 }); f.float(up(c, 3.2), t('game.fx.felled'), { color: '#FFB3C1', delay: 400 }); }
    f.ring(c, { color: '#FFFFFF', radius: 7, duration: 1.0, opacity: 0.45 });
  });
  // harvesting the nine plots of a felled Giant: the giant's own show plays, the plots only drop leaves
  const plainHarvest = R.get('harvested');
  R.set('harvested', (f, ev, pos, meta) => {
    if (ev.giant) { f.burst('leaf', pos, { n: 3, colors: leafColors, speed: 1.2, up: 2.0, size: 0.22, grav: 0.45, life: 0.8 }); return; }
    plainHarvest(f, ev, pos, meta);
  });
  R.set('picked', R.get('shaken'));
  R.set('heirloom', (f, ev, pos) => {
    f.burst('star', up(pos, 2.8), { n: 14, colors: ['#FFE27A', '#FFFFFF'], speed: 2, up: 2.2, size: 0.45, grav: 0.15, life: 1.3, spread: 1.4 });
    f.float(up(pos, 3), t('game.fx.heirloom'), { color: '#FFE58A', delay: 200 });
  });
  R.set('prized', R.get('blueRibbon'));
  R.set('grewUp', (f, ev, pos) => { f.burst('sparkle', up(pos, 0.8), { n: 10, color: '#FFE27A', speed: 1.4, up: 2, size: 0.32, life: 0.9 }); f.burst('heart', up(pos, 1), { n: 3, colors: ['#FF5A7A', '#FF9FB0'], speed: 0.6, up: 1.6, size: 0.3, grav: -0.08, life: 1.1 }); });
  R.set('colonyCycle', (f, ev, pos) => { f.burst('glow', up(pos, 0.9), { n: 6, color: '#FFE27A', speed: 0.8, up: 0.6, size: 0.12, grav: 0, life: 1.0 }); });
  // Masterwork: gold dust and a ring round the decor; level 2 is grander
  R.set('masterworked', (f, ev, pos) => {
    const big = (ev.level ?? 1) >= 2;
    f.burst('sparkle', up(pos, 0.8), { n: big ? 30 : 18, colors: ['#FFD84A', '#FFF3C4', '#E9B13A'], speed: 2, up: 3, size: 0.42, grav: 0.12, life: 1.4, spread: 0.8 });
    f.ring(pos, { color: '#FFD84A', radius: big ? 3.2 : 2.2, duration: 0.9 });
    if (big) f.ring(pos, { color: '#FFFFFF', radius: 4.2, duration: 1.2, opacity: 0.5, delay: 0.2 });
    f.float(up(pos, 1.6), t('game.fx.masterwork', { stars: big ? '★★' : '★' }), { color: '#FFE58A', delay: 150 });
  });
  // Farm Beauty: petals drift down over the middle of the farm, a star for every new beauty star
  R.set('beautyStar', (f, ev, pos) => {
    const c = here(pos);
    f.burst('petal', up(c, 6), { n: 40, colors: ['#FF9FB0', '#FFFFFF', '#FFE27A', '#C8B5F0'], speed: 1.6, up: -0.3, size: 0.32, grav: 0.06, drag: 0.8, life: 3.5, spread: 9, spin: 3 });
    const n = Math.max(1, Math.min(5, ev.stars || 1));
    for (let k = 0; k < n; k++) f.burst('star', up(c, 2.5), { n: 4, colors: ['#FFE27A', '#FFFFFF'], speed: 2.5, up: 3.5, size: 0.6, grav: 0.2, life: 1.4, delay: k * 0.25 });
    f.float(up(c, 3), t('game.fx.beauty', { stars: '★'.repeat(n) }), { color: '#FFE58A', size: 1.3, life: 1500 });
  });
  // a decor set completed: a soft glow ring under every piece (render-world passes ev.positions), else here
  R.set('decorSet', (f, ev, pos) => {
    const spots = Array.isArray(ev.positions) && ev.positions.length ? ev.positions.map((p) => new THREE.Vector3(p.x, p.y || 0, p.z)) : [here(pos)];
    spots.forEach((p, i) => { f.ring(p, { color: '#FFE9A8', radius: 2.4, duration: 1.0, opacity: 0.7, delay: i * 0.12 }); f.burst('sparkle', up(p, 0.6), { n: 8, colors: ['#FFE27A', '#FFFFFF'], speed: 1.4, up: 2, size: 0.32, life: 1.0, delay: i * 0.12 }); });
    f.float(up(spots[0], 2), t('game.fx.setDone'), { color: '#FFE58A', size: 1.2 });
  });
  // the Level-up Bloom (owner rule 2026-10-04: a new level finishes everything growing): a sparkle wave rolls out from
  // the middle of the view with the level-up's ripple, over every crop, tree and animal that just finished (render-world
  // passes ev.positions, metres), and a green ring follows it. Each pool holds `cap` particles (by quality): the wave
  // takes at most 60 % of it (fewer sparkles per spot on a big farm, at least two, on at most cap * 0.3 spots), so it
  // never pushes the level-up's own stars and confetti out of the pools.
  R.set('bloomed', (f, ev, pos) => {
    const c = here(pos);
    const spots = Array.isArray(ev.positions) ? ev.positions.slice(0, Math.floor(cap * 0.3)) : [];
    const n = Math.max(2, Math.min(9, Math.floor((cap * 0.6) / Math.max(1, spots.length))));
    for (const p of spots) {
      const at = Math.min(1.8, Math.hypot(p.x - c.x, p.z - c.z) / 26);   // seconds: the wave rolls out at 26 m/s
      f.burst('sparkle', up(p, 0.5), { n, colors: ['#FFE27A', '#FFFFFF', '#B8F28A'], speed: 1.1, up: 2.6, size: 0.42, grav: 0.12, life: 1.1, delay: at });
      f.burst('leaf', up(p, 0.3), { n: 2, colors: leafColors, speed: 1, up: 2, size: 0.2, grav: 0.4, life: 0.9, delay: at });
    }
    f.ring(c, { color: '#B8F28A', radius: 48, duration: 2.2, opacity: 0.45, delay: 0.15 });
  });
  // the Restoration Ledger: a bundle tied off sparkles at the site; the whole project gets the "ta-da": a cloud of
  // builder's dust hides the swap, then confetti, stars and two rings
  R.set('donated', (f, ev, pos, meta) => {
    if (ev.item && meta.local) f.fly(ev.item, null, { qty: 0, to: pos ? null : screenAt(0.5, 0.5), item: ev.item, size: 34 });
    if (pos) f.burst('sparkle', up(pos, 1.2), { n: 6, color: '#FFE27A', speed: 1, up: 1.5, size: 0.3, life: 0.8 });
  });
  R.set('bundleDone', (f, ev, pos) => {
    const c = here(pos);
    f.burst('sparkle', up(c, 1.5), { n: 24, colors: ['#FFE27A', '#FFFFFF', '#9BE36E'], speed: 2.4, up: 3, size: 0.45, grav: 0.12, life: 1.3, spread: 1.5 });
    f.ring(c, { color: '#9BE36E', radius: 4, duration: 0.9 });
    f.float(up(c, 2.5), t('game.fx.bundleDone'), { color: '#BFF0A8' });
  });
  R.set('projectDone', (f, ev, pos) => {
    const c = here(pos);
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; f.burst('dust', new THREE.Vector3(c.x + Math.cos(a) * 3, 0, c.z + Math.sin(a) * 3), { n: 2, color: '#F3E2BE', speed: 1.2, up: 1.6, size: 1.6, sizeEnd: 2.8, grav: -0.02, life: 1.4, y: 0.3, spread: 0.5 }); }
    for (let k = 0; k < 3; k++) {
      f.burst('confetti', up(c, 3), { n: 60, colors: confetti, speed: 6, up: 8, size: 0.5, grav: 0.35, drag: 0.6, life: 2.4, spread: 3, delay: 0.6 + k * 0.3, spin: 8 });
      f.burst('star', up(c, 3), { n: 12, colors: ['#FFE27A', '#FFFFFF'], speed: 4.5, up: 5, size: 0.6, grav: 0.2, drag: 1, life: 1.5, delay: 0.6 + k * 0.3 });
    }
    f.ring(c, { color: '#FFE9A8', radius: 14, duration: 1.6, opacity: 0.5, delay: 0.6 });
    f.ring(c, { color: '#FFFFFF', radius: 8, duration: 1.1, opacity: 0.4, delay: 0.85 });
    f.float(up(c, 3.5), t('game.fx.restored'), { color: '#FFE58A', size: 1.6, delay: 700, life: 1800 });
  });
  R.set('restorationDone', R.get('projectDone'));
  // Town Projects: lights come on in the village, confetti over it
  R.set('townBuilt', (f, ev, pos) => {
    const c = here(pos);
    f.burst('glow', up(c, 2), { n: 30, colors: ['#FFE08A', '#FFD39B', '#FFFFFF'], speed: 2, up: 1.5, size: 0.4, grav: -0.03, drag: 0.6, life: 2.4, spread: 4 });
    f.burst('confetti', up(c, 4), { n: 50, colors: confetti, speed: 5, up: 6, size: 0.5, grav: 0.35, drag: 0.6, life: 2.2, spread: 3, spin: 8, delay: 0.3 });
    f.ring(c, { color: '#FFE08A', radius: 10, duration: 1.4, opacity: 0.5 });
    f.float(up(c, 4), t('game.fx.village'), { color: '#FFE58A', size: 1.3, delay: 300, life: 1600 });
  });
  R.set('townReady', (f, ev, pos) => { f.burst('sparkle', up(here(pos), 2), { n: 14, color: '#FFE27A', speed: 2, up: 2.5, size: 0.4, life: 1.1 }); });
  R.set('townFunded', (f, ev, pos, meta) => { if (ev.coins && meta.local) f.fly('coins', null, { qty: 0, to: screenAt(0.5, 0.35), size: 34 }); });
  R.set('townGiven', (f, ev, pos, meta) => { if (ev.item && meta.local) f.fly(ev.item, null, { qty: 0, to: screenAt(0.5, 0.35), item: ev.item, size: 34 }); });
  // the County Fair: an entry flies to the tent; the Sunday ceremony bursts rosettes in the medal's colours
  R.set('fairEntered', (f, ev, pos, meta) => {
    if (ev.item && pos) f.pop(ev.item, up(pos, 1), { qty: 0, to: screenAt(0.5, 0.4), by: meta.by, local: meta.local, n: 1 });
    const pts = Number.isFinite(ev.p10) ? ev.p10 / 10 : null;
    if (pts !== null) f.float(up(here(pos), 1.6), t('game.fx.fairPoints', { n: Math.round(pts * 10) / 10 }), { color: '#BFE6FF' });
    f.burst('sparkle', up(here(pos), 1.2), { n: 10, colors: ['#7CC4FF', '#FFFFFF'], speed: 1.6, up: 2, size: 0.35, life: 0.9 });
  });
  R.set('fairPoints', (f, ev, pos) => {
    const pts = Number.isFinite(ev.p10) ? ev.p10 / 10 : null;
    if (pos && pts !== null) f.float(up(pos, 0.8), t('game.fx.fair', { n: Math.round(pts * 10) / 10 }), { color: '#7CC4FF', size: 0.95, delay: 250, dy: -28 });
  });
  R.set('fairCeremony', (f, ev, pos, meta) => {
    const c = here(pos);
    const fam = medalFamily(ev.medal);
    const [rose, core, glint] = MEDAL_COLORS[fam || 'gold'];
    for (let k = 0; k < (fam ? 4 : 2); k++) {
      f.burst('confetti', up(c, 3), { n: 40, colors: [rose, core, glint, '#FF7A6B', '#2BB3A3'], speed: 5.5, up: 7.5, size: 0.5, grav: 0.35, drag: 0.6, life: 2.4, spread: 2.5, delay: k * 0.25, spin: 8 });
      f.burst('star', up(c, 2), { n: 10, colors: [glint, '#FFFFFF'], speed: 4, up: 5, size: 0.6, grav: 0.2, drag: 1, life: 1.4, delay: k * 0.25 });
    }
    f.burst('glow', up(c, 2), { n: 24, color: glint, speed: 3, up: 2, size: 0.5, grav: -0.02, drag: 0.8, life: 2.4, spread: 2 });
    f.ring(c, { color: rose, radius: 12, duration: 1.6, opacity: 0.5 });
    if (fam) f.float(up(c, 3.4), t(`game.fx.medal.${fam}`), { color: core === '#FFFFFF' ? '#E6EEF5' : core, size: 1.6, life: 1800 });
    if (ev.coins) for (let i = 0; i < 6; i++) f.fly('coins', up(c, 1), { qty: i ? 0 : ev.coins, by: meta.by, local: meta.local ?? true, delay: 600 + i * 60, size: 34 });
    if (ev.acorns) for (let i = 0; i < Math.min(5, ev.acorns); i++) f.fly('acorns', up(c, 1), { qty: i ? 0 : ev.acorns, by: meta.by, local: meta.local ?? true, delay: 900 + i * 80, size: 34 });
  });
  R.set('fairOpened', (f, ev, pos) => { f.burst('confetti', up(here(pos), 3), { n: 24, colors: confetti, speed: 3, up: 4, size: 0.4, grav: 0.35, drag: 0.6, life: 1.8, spread: 2 }); });
  // the River Barge: docking splashes; loading thumps a crate and pays; a row pops confetti; casting off blows
  // the horn (white puffs over the cabin) and leaves a wake of ripples
  const splash = (f, c) => {
    f.burst('droplet', up(c, 0.4), { n: 18, colors: ['#BFEFFF', '#FFFFFF', '#6FD3E6'], speed: 2.4, up: 3, size: 0.18, grav: 0.9, life: 0.8, spread: 1.6 });
    for (let k = 0; k < 3; k++) f.burst('ring', up(c, 0.05), { n: 1, color: '#E4F4FF', speed: 0, up: 0, size: 0.4, sizeEnd: 3.2, grav: 0, spin: 0, life: 1.2, spread: 0.2, alpha: 0.6, flat: true, additive: false, delay: k * 0.2 });
  };
  R.set('bargeDocked', (f, ev, pos) => { const c = here(pos); splash(f, c); f.float(up(c, 3), t('game.fx.barge'), { color: '#BFEFFF', size: 1.2 }); });
  R.set('bargeLoaded', (f, ev, pos, meta) => {
    const c = here(pos);
    f.burst('dust', up(c, 0.3), { n: 6, color: '#E3CFA8', speed: 1.2, up: 0.8, size: 0.7, sizeEnd: 1.2, grav: 0, life: 0.6 });
    if (ev.item) f.pop(ev.item, up(c, 0.8), { qty: 0, by: meta.by, local: meta.local, n: 1 });
    if (ev.coins) { f.fly('coins', up(c, 1), { qty: ev.coins, by: meta.by, local: meta.local, size: 34 }); f.float(up(c, 1.5), tn('game.fx.coins', ev.coins), { color: '#FFE58A' }); }
  });
  R.set('bargeRow', (f, ev, pos, meta) => {
    const c = here(pos);
    f.burst('confetti', up(c, 2.5), { n: 44, colors: confetti, speed: 5, up: 6, size: 0.45, grav: 0.35, drag: 0.6, life: 2.0, spread: 2.5, spin: 8 });
    f.ring(c, { color: '#6FD3E6', radius: 8, duration: 1.2, opacity: 0.5 });
    if (ev.acorns) for (let i = 0; i < Math.min(4, ev.acorns); i++) f.fly('acorns', up(c, 1), { qty: i ? 0 : ev.acorns, by: meta.by, local: meta.local ?? true, delay: 300 + i * 80, size: 34 });
    if (ev.coins) f.fly('coins', up(c, 1), { qty: ev.coins, by: meta.by, local: meta.local ?? true, delay: 200, size: 34 });
    f.float(up(c, 3), t('game.fx.rowLoaded'), { color: '#BFEFFF', size: 1.25 });
  });
  R.set('bargeCastOff', (f, ev, pos) => {
    const c = here(pos);
    for (let k = 0; k < 4; k++) f.burst('dust', up(c, 4.2), { n: 2, color: '#FFFFFF', speed: 0.5, up: 2.2, size: 0.8, sizeEnd: 2.2, grav: -0.05, life: 1.6, delay: k * 0.18, alpha: 0.8 });
    for (let k = 0; k < 5; k++) f.burst('ring', new THREE.Vector3(c.x - k * 1.6, 0.05, c.z), { n: 1, color: '#E4F4FF', speed: 0, up: 0, size: 0.6, sizeEnd: 3.5, grav: 0, spin: 0, life: 1.6, spread: 0.3, alpha: 0.55, flat: true, additive: false, delay: 0.3 + k * 0.25 });
    f.float(up(c, 4.5), t('game.fx.voyage'), { color: '#BFEFFF', size: 1.3, delay: 200 });
  });
  // collections: a find rises out of a parchment-coloured sparkle column and flies to the HUD; a set completes big
  R.set('albumFind', (f, ev, pos, meta) => {
    const c = here(pos);
    f.burst('sparkle', up(c, 0.4), { n: 22, colors: ['#FFF3C4', '#FFE27A', '#FFFFFF'], speed: 0.8, up: 4.5, size: 0.4, grav: 0.05, drag: 0.6, life: 1.4, spread: 0.5 });
    f.ring(c, { color: '#FFF3C4', radius: 2.4, duration: 0.8 });
    if (ev.item) {
      f.pop(ev.item, up(c, 1.4), { qty: 1, by: meta.by, local: meta.local ?? true, n: 1, delay: 0.25 });
      f.float(up(c, 2.6), t(ev.dup ? 'game.fx.another' : 'game.fx.found', { item: itemName(ev.item) }), { color: '#FFE58A', size: 1.25, delay: 250, life: 1400 });
    }
  });
  R.set('albumSet', (f, ev, pos) => {
    const c = here(pos);
    for (let k = 0; k < 3; k++) f.burst('confetti', up(c, 3), { n: 40, colors: ['#FFE27A', '#FFF3C4', '#FF9FB0', '#9BE36E', '#7CC4FF'], speed: 5.5, up: 7, size: 0.45, grav: 0.35, drag: 0.6, life: 2.2, spread: 2, delay: k * 0.25, spin: 8 });
    f.ring(c, { color: '#FFE27A', radius: 10, duration: 1.4, opacity: 0.5 });
    f.float(up(c, 3.2), t('game.fx.collectionDone'), { color: '#FFE58A', size: 1.4, life: 1700 });
  });
  R.set('friendship', (f, ev, pos) => { f.burst('heart', up(here(pos), 2), { n: 10, colors: ['#FF5A7A', '#FF9FB0'], speed: 1.4, up: 2.4, size: 0.42, grav: -0.05, life: 1.6, spread: 1 }); });
  R.set('befriended', R.get('friendship'));
  R.set('memoryPage', (f, ev, pos) => { const c = here(pos); f.ring(c, { color: '#FFFFFF', radius: 16, duration: 0.5, opacity: 0.6 }); f.float(up(c, 2.5), t('game.fx.memory'), { color: '#FFF3C4' }); });
  // ---- wave 3 (M2) ----------------------------------------------------------------------------------------
  // the NPC league rides on the ceremony: a promotion is a second, rising burst and the new league's name
  const ceremony = R.get('fairCeremony');
  R.set('fairCeremony', (f, ev, pos, meta) => {
    ceremony(f, ev, pos, meta);
    const lg = ev.league;
    if (!lg || !lg.move) return;
    const c = here(pos);
    // Bulgarian names the league ("Лига „Градина“"); English keeps "League 3"
    const leagueName = ctext('FAIR', `league.${lg.to}`, 'name', String(lg.to));
    if (lg.move > 0) {
      f.burst('star', up(c, 1), { n: 18, colors: ['#FFE27A', '#FFFFFF', '#9FD8E8'], speed: 2.2, up: 7, size: 0.55, grav: 0.1, drag: 0.5, life: 1.8, delay: 1.0 });
      f.float(up(c, 4.4), t('game.fx.promoted', { league: lg.to, leagueName }), { color: '#BFEFFF', size: 1.35, delay: 1100, life: 1800 });
    } else f.float(up(c, 4.4), t('game.fx.leagueNext', { league: lg.to, leagueName }), { color: '#E6EEF5', size: 1.1, delay: 1100 });
  });
  // the Breeding Barn: a baby comes home in its coat (a golden one with a shower of gold), the Nursery's care steps
  const COAT_SPARK = { white: ['#FFFFFF', '#F4F0E7'], brown: ['#C8864E', '#FFE3B0'], spotted: ['#FFFFFF', '#5A4636'], golden: ['#FFE27A', '#FFC83D', '#FFFFFF'] };
  R.set('bred', (f, ev, pos) => {
    const c = here(pos);
    const cols = COAT_SPARK[ev.coat] || ['#FFE27A', '#FFFFFF'];
    f.burst('heart', up(c, 1), { n: 8, colors: ['#FF5A7A', '#FF9FB0'], speed: 1.2, up: 2.2, size: 0.4, grav: -0.05, life: 1.6, spread: 0.6 });
    f.burst('sparkle', up(c, 0.6), { n: ev.golden ? 40 : 16, colors: cols, speed: ev.golden ? 2.6 : 1.6, up: ev.golden ? 4 : 2.4, size: 0.4, grav: 0.1, life: ev.golden ? 1.8 : 1.2, spread: 0.6 });
    if (ev.golden) { f.ring(c, { color: '#FFE27A', radius: 4, duration: 1.2, opacity: 0.6 }); f.burst('confetti', up(c, 2), { n: 30, colors: ['#FFE27A', '#FFC83D', '#FFFFFF'], speed: 4, up: 5, size: 0.4, grav: 0.35, drag: 0.6, life: 2, spin: 8 }); }
    // the species id reads as its name ("cow"); a coat's own word is content (lane B: ctext('coats', id))
    const sp = ev.species ? (lang() === 'en' ? ev.species : cname(ev.species, { form: 'lc' })) : t('game.fx.baby');
    const coat = ev.coat ? ctext('coats', ev.coat, 'name', ev.coat) : '';
    f.float(up(c, 2.2), ev.golden ? t('game.fx.goldenBaby', { sp }) : coat ? t('game.fx.newCoat', { coat, sp }) : t('game.fx.newBaby', { sp }),
      { color: ev.golden ? '#FFE58A' : '#FFFFFF', size: ev.golden ? 1.4 : 1.15, life: 1700 });
  });
  R.set('breedStarted', (f, ev, pos) => { f.burst('heart', up(here(pos), 1.4), { n: 6, colors: ['#FF5A7A', '#FF9FB0'], speed: 1, up: 1.8, size: 0.36, grav: -0.05, life: 1.4, spread: 1 }); });
  R.set('nursed', (f, ev, pos) => {
    if (!pos) return;
    f.burst('heart', up(pos, 0.7), { n: 4, colors: ['#FF5A7A', '#FF9FB0'], speed: 0.7, up: 1.6, size: 0.32, grav: -0.06, life: 1.2 });
    f.burst('sparkle', up(pos, 0.4), { n: 6, colors: ['#BFEFFF', '#FFFFFF'], speed: 1, up: 1.4, size: 0.26, life: 0.8 });
    if (Number.isFinite(ev.n) && Number.isFinite(ev.of)) f.float(up(pos, 1.3), `${ev.step ? ctext('nurseSteps', ev.step, 'name', ev.step) : t('game.fx.care')} ${ev.n}/${ev.of}`, { color: '#FFFFFF', size: 0.95 });
  });
  R.set('nurseDone', (f, ev, pos) => {
    const c = here(pos);
    f.burst('confetti', up(c, 1.4), { n: 24, colors: ['#FF9FB0', '#BFEFFF', '#FFE27A', '#B8F28A'], speed: 3, up: 4, size: 0.36, grav: 0.35, drag: 0.6, life: 1.8, spin: 8 });
    if (ev.personality) {
      const p = ctext('personalities', ev.personality, 'name', ev.personality);
      f.float(up(c, 2), `${p[0].toUpperCase()}${p.slice(1)}!`, { color: '#FFE58A', size: 1.2 });
    }
  });
  R.set('coatWorn', (f, ev, pos) => { const c = here(pos); f.burst('sparkle', up(c, 0.6), { n: 18, colors: ['#FFFFFF', '#FFE27A', '#F4B6C8', '#DDE8F2'], speed: 1.6, up: 2.6, size: 0.38, grav: 0.1, life: 1.3, spread: 0.6 }); f.ring(c, { color: '#FFF3C4', radius: 2.2, duration: 0.9 }); });
  // the Fishing Dock: the farmer's cast and catch play on the avatar (avatars-view); fishing together pops hearts
  R.set('fishCast', () => {});
  R.set('fishCaught', () => {});
  R.set('fishTogether', (f, ev, pos) => {
    const c = here(pos);
    f.burst('heart', up(c, 1.2), { n: 10, colors: ['#FF5A7A', '#FF9FB0', '#FFC83D'], speed: 1.2, up: 2.2, size: 0.42, grav: -0.05, life: 1.8, spread: 1.2 });
    f.float(up(c, 2.4), t('game.fx.fishTogether'), { color: '#FFB3C1', size: 1.2 });
  });
  // the Friendly Duel: the invitation and the start in both farmers' colours, the end a crown of gold over the winner
  const DUEL_COLS = ['#2BB3A3', '#FF7A6B', '#FFC83D', '#FFFFFF'];
  R.set('duelInvited', (f, ev, pos) => { const c = here(pos); f.burst('sparkle', up(c, 1.5), { n: 12, colors: DUEL_COLS, speed: 1.6, up: 2.4, size: 0.36, life: 1.0, spread: 1 }); });
  R.set('duelAccepted', (f, ev, pos) => {
    const c = here(pos);
    f.burst('confetti', up(c, 2.5), { n: 36, colors: DUEL_COLS, speed: 4.5, up: 5.5, size: 0.42, grav: 0.35, drag: 0.6, life: 2, spread: 2, spin: 8 });
    f.float(up(c, 3), t('game.duel.on'), { color: '#FFE58A', size: 1.35, life: 1500 });
  });
  R.set('duelEnded', (f, ev, pos) => {
    if (!ev.scored) return;
    const c = here(pos);
    for (let k = 0; k < 3; k++) f.burst('confetti', up(c, 3), { n: 40, colors: DUEL_COLS, speed: 5, up: 7, size: 0.46, grav: 0.35, drag: 0.6, life: 2.3, spread: 2.4, delay: k * 0.25, spin: 8 });
    f.burst('star', up(c, 2.5), { n: 16, colors: ['#FFE27A', '#FFFFFF'], speed: 4, up: 5, size: 0.6, grav: 0.2, drag: 1, life: 1.5 });
    f.ring(c, { color: '#FFE27A', radius: 10, duration: 1.4, opacity: 0.5 });
    f.float(up(c, 3.6), ev.tie ? t('game.fx.duelTie') : t('game.fx.duelWin'), { color: '#FFE58A', size: 1.5, life: 1900 });
  });
  for (const e of ['duelDeclined', 'duelCancelled', 'duelLapsed']) R.set(e, () => {});
  // the Seasonal Ribbon Track: a ribbon of the season's colours unfurls and the tier floats up
  R.set('trackTier', (f, ev, pos) => {
    const c = here(pos);
    f.burst('confetti', up(c, 2.5), { n: 30, colors: ['#F4B6C8', '#F2C46B', '#B5562E', '#9FD3E8', '#FFFFFF'], speed: 4, up: 5.5, size: 0.42, grav: 0.35, drag: 0.6, life: 2, spread: 2, spin: 8 });
    f.ring(c, { color: '#FFF3C4', radius: 6, duration: 1.0, opacity: 0.5 });
    if (Number.isFinite(ev.tier)) f.float(up(c, 3), t('game.fx.seasonTier', { n: ev.tier }), { color: '#FFE58A', size: 1.3 });
  });
  R.set('perkPicked', (f, ev, pos) => { const c = here(pos); f.burst('star', up(c, 1.4), { n: 10, colors: ['#FFE27A', '#BFEFFF', '#FFFFFF'], speed: 1.8, up: 2.6, size: 0.42, grav: 0.1, life: 1.2, spread: 0.6 }); });
  R.set('perksReset', (f, ev, pos) => { f.burst('glow', up(here(pos), 1.2), { n: 12, color: '#BFEFFF', speed: 1.2, up: 1.6, size: 0.36, grav: 0, life: 1.0, spread: 0.8 }); });
  // Grandma Hazel's visit: petals and hearts at the farmhouse when she arrives, a wave of hearts when she goes home
  R.set('grandmaArrived', (f, ev, pos) => {
    const c = here(pos);
    f.burst('petal', up(c, 4), { n: 36, colors: ['#FF9FB0', '#FFFFFF', '#FFE27A', '#C8B5F0'], speed: 1.6, up: -0.2, size: 0.32, grav: 0.06, drag: 0.8, life: 3.2, spread: 6, spin: 3 });
    f.burst('heart', up(c, 1.6), { n: 12, colors: ['#FF5A7A', '#FF9FB0'], speed: 1.2, up: 2.4, size: 0.42, grav: -0.05, life: 1.8, spread: 1.4 });
    f.float(up(c, 3), t('game.fx.grandma'), { color: '#FFB3C1', size: 1.35, life: 1800 });
  });
  R.set('grandmaLeft', (f, ev, pos) => { const c = here(pos); f.burst('heart', up(c, 1.6), { n: 16, colors: ['#FF5A7A', '#FF9FB0', '#FFE27A'], speed: 1.4, up: 2.8, size: 0.42, grav: -0.05, life: 2.2, spread: 2 }); });
  // the farmhouse room opens (Grandma's Farmhouse restored): the restoration's own ta-da
  R.set('interiorOpened', R.get('projectDone'));
  R.set('furnished', (f, ev, pos) => { if (pos) f.burst('dust', pos, { n: 4, color: '#F3E2BE', speed: 0.8, up: 0.8, size: 0.6, sizeEnd: 1.1, grav: 0, life: 0.6 }); });
  R.set('furnishMoved', R.get('furnished'));
  // the Festival Pavilion grows a tier (townBuilt with `tier`): lanterns of light over the green
  const townBuilt = R.get('townBuilt');
  R.set('townBuilt', (f, ev, pos, meta) => {
    if (!Number.isFinite(ev.tier)) { townBuilt(f, ev, pos, meta); return; }
    const c = here(pos);
    f.burst('glow', up(c, 2.5), { n: 36, colors: ['#FFE08A', '#FF9F43', '#FFFFFF'], speed: 2, up: 2, size: 0.42, grav: -0.04, drag: 0.6, life: 2.6, spread: 4 });
    f.burst('confetti', up(c, 4), { n: 50, colors: confetti, speed: 5, up: 6, size: 0.5, grav: 0.35, drag: 0.6, life: 2.2, spread: 3, spin: 8, delay: 0.3 });
    f.float(up(c, 4), t('game.fx.pavilion', { n: ev.tier }), { color: '#FFE58A', size: 1.3, delay: 300, life: 1700 });
  });

  // a pet's hearts rise from the pet (avatars-view passes its position); a find also sparkles
  for (const e of ['petAdopted', 'petFed', 'petPetted', 'petTreasure', 'petFind']) {
    R.set(e, (f, ev, pos) => {
      if (!pos) return;
      f.burst('heart', up(pos, 0.8), { n: e === 'petPetted' || e === 'petAdopted' ? 6 : 4, colors: ['#FF5A7A', '#FF9FB0', '#FF7A9C'], speed: 0.8, up: 1.7,
        size: 0.42, sizeEnd: 0.24, grav: -0.08, life: 1.3, spread: 0.25 });
      if (e === 'petFind' || e === 'petTreasure') f.burst('sparkle', up(pos, 0.5), { n: 10, colors: ['#FFE27A', '#FFFFFF'], speed: 1.6, up: 1.2, size: 0.3, grav: 0.6, life: 0.9 });
    });
  }


  // -------------------------------------------------------------------------------------------------
  function play(ev, pos, meta = {}) {
    if (!ev || typeof ev.e !== 'string') return;
    const m = { by: meta.by ?? ev.by ?? null, local: meta.local ?? (ev.by ? ev.by === me : true) };
    const r = recipes.get(ev.e);
    try {
      if (r) r(api, ev, pos || null, m);
      else if (pos) burst('sparkle', pos, { n: 6, color: '#FFE27A', speed: 1.2, up: 1.5, size: 0.3, life: 0.7 });
    } catch (err) { console.error(`fx ${ev.e} failed`, err); }
  }

  function update(dt) {
    time += Math.max(0, dt || 0);
    uTime.value = time;
    tw.update(time);
    flushPool(pools.alpha);
    flushPool(pools.add);
    const poppers = stepPops(dt || 0);
    flushTwinkles();
    if (rain.intensity > 0 && motion !== 'still') {
      // splashes and flat ripples on the ground, more of them in a downpour (the ground shader ripples the puddles)
      rain.splashAcc += dt * rain.intensity * (8 + 12 * rain.strength) * (cap / CAPS.high);
      while (rain.splashAcc >= 1) {
        rain.splashAcc -= 1;
        const fc = rain.focus.value;
        v3.set(fc.x + (rand() - 0.5) * 40, 0, fc.z + (rand() - 0.5) * 40);
        burst('droplet', v3, { n: 2, color: '#D6F1FF', speed: 0.8, up: 1.2 * (0.6 + 0.4 * rain.strength), size: 0.08, grav: 0.8, life: 0.3, y: 0.02, ambient: true });
        // and a ripple spreading flat on the ground (visual-13)
        burst('ring', v3, { n: 1, color: '#E4F4FF', speed: 0, up: 0, size: 0.06, sizeEnd: 0.55, grav: 0, spin: 0, life: 0.55, y: 0.03,
          spread: 0, alpha: 0.55, ambient: true, flat: true, additive: false });
      }
      // drips off the eaves and the canopies near the view (wave 4): a drop falls from a roof edge and splashes below
      const boxes = rain.eaves ? rain.eaves() : null;
      if (boxes && boxes.length && rain.intensity > 0.3) {
        rain.dripAcc += dt * rain.intensity * 7 * (cap / CAPS.high);
        while (rain.dripAcc >= 1) {
          rain.dripAcc -= 1;
          const fc = rain.focus.value;
          for (let tries = 0; tries < 4; tries++) {
            const b = boxes[Math.floor(rand() * boxes.length)].box;
            if (!b) continue;
            const cx = (b.min.x + b.max.x) / 2; const cz = (b.min.z + b.max.z) / 2;
            if (Math.abs(cx - fc.x) > 26 || Math.abs(cz - fc.z) > 26) continue;
            // a point on the footprint's edge, at the eaves (about half the height of a roofed box)
            const side = Math.floor(rand() * 4); const u = rand();
            const x = side < 2 ? b.min.x + (b.max.x - b.min.x) * u : side === 2 ? b.min.x - 0.1 : b.max.x + 0.1;
            const z = side >= 2 ? b.min.z + (b.max.z - b.min.z) * u : side === 0 ? b.min.z - 0.1 : b.max.z + 0.1;
            const y = b.min.y + (b.max.y - b.min.y) * 0.52;
            v3.set(x, 0, z);
            burst('droplet', v3, { n: 1, color: '#E4F4FF', speed: 0.05, up: -0.3, size: 0.09, grav: 1.4, life: Math.min(1.1, 0.25 + Math.sqrt(y / 7)), y, spread: 0, ambient: true });
            break;
          }
        }
      }
    }
    const busy = poppers || flying > 0 || tw.isAnimating() || floaters.some((x) => x.busy);
    return particleWant([pools.alpha, pools.add], time, { busy, twinkles: twinkles.map.size, rain: motion === 'still' ? 0 : rain.intensity, motion });
  }

  // Shader warm-up (performance-06): build every lazily created mesh now, hidden, so one compileAsync at boot
  // compiles its program instead of the first harvest, the first rain or the first ring stalling a frame.
  const warm = [];
  function warmup(on = true) {
    if (on) {
      if (!twinkles.mesh) buildTwinkleMesh(64);
      if (!rain.mesh) { setRain(0.0001); setRain(0); }
      if (!rings.length) { ring(new THREE.Vector3(), { duration: 0.001 }); }
      if (!pops.length) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false }));
        sprite.renderOrder = 14; sprite.visible = false; layer.add(sprite);
        pops.push({ sprite, busy: false });
      }
      for (const p of Object.values(pools)) { p.mesh.visible = true; warm.push(p.mesh); }
      for (const r of rings) { r.mesh.visible = true; warm.push(r.mesh); }
      if (twinkles.mesh) warm.push(twinkles.mesh);
      if (rain.mesh) { rain.mesh.visible = true; warm.push(rain.mesh); }
      for (const p of pops) { p.sprite.visible = true; warm.push(p.sprite); }
    } else {
      for (const m of warm) m.visible = false;
      warm.length = 0;
      for (const r of rings) r.busy = false;
      for (const p of Object.values(pools)) p.mesh.visible = false;
    }
  }

  const api = {
    play,
    update,
    burst,
    float,
    pop,
    preload,
    fly,
    ring,
    twinkle,
    rain: setRain,
    setFocus(x, z) { rain.focus.value.set(x, 0, z); },
    /** Wave 4: where roofs and canopies drip in the rain: fn() -> [{ box: Box3 }] (render/index.js: the picking proxies). */
    setEaves(fn) { rain.eaves = typeof fn === 'function' ? fn : null; },
    setMe(pid) { me = pid; },
    setLocator(fn) { locator = typeof fn === 'function' ? fn : () => null; },
    setTargets(t) { Object.assign(targets, t); },
    setMotion(mode) {
      motion = mode === 'still' || mode === 'reduced' ? mode : 'full';
      twinkles.dirty = true;
      // Still means still: the world's own smoke, petals and rain stop at once (feedback bursts play out)
      if (motion === 'still') for (const p of Object.values(pools)) p.ambientUntil = Math.min(p.ambientUntil, time);
    },
    setQuality(q) {
      cap = CAPS[q] || CAPS.high;
      for (const p of Object.values(pools)) { p.ring = createRing(cap); p.high = Math.min(p.high, cap); }
      setRain(rain.intensity);
    },
    warmup,
    recipe(name, fn) { recipes.set(name, fn); },
    stats() {
      return { particles: (time < pools.alpha.aliveUntil ? 1 : 0) + (time < pools.add.aliveUntil ? 1 : 0),
        ambient: (time < pools.alpha.ambientUntil ? 1 : 0) + (time < pools.add.ambientUntil ? 1 : 0),
        drawn: pools.alpha.mesh.geometry.instanceCount + pools.add.mesh.geometry.instanceCount, time,
        until: [pools.alpha.aliveUntil, pools.alpha.ambientUntil, pools.add.aliveUntil, pools.add.ambientUntil],
        floaters: floaters.filter((x) => x.busy).length, flights: flying, twinkles: twinkles.map.size, pops: pops.filter((x) => x.busy).length };
    },
    dispose() {
      for (const p of Object.values(pools)) { layer.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
      atlas.dispose();
      for (const f of [...floaters, ...flights]) f.outer.remove();
    },
  };
  return api;
}
