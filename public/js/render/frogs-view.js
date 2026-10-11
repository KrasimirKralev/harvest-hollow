// Frogs (wave 5, owner wish list 1 #3: "ambient frogs near water (river, pond, bird bath, puddles after rain) that hop,
// sit and croak, more at dusk and after rain; cheap (instanced, no per-frame allocations), never on paths you click").
// Owned by the render lane. Purely cosmetic: frogs are never picked (a click goes through them to what is behind), and
// they sit only on water's edges (the river's farm bank, the Willow Pond, duck ponds, bird baths and koi ponds) and in
// the puddles a rain leaves on the lawn (off the paths and every footprint: ground.puddleSpots).
//
// Cost: ONE instanced draw for every frog (a ~180-triangle frog, the shared Lambert look with vertex colours), culled
// off screen and beyond FROGS.far m of the camera target; hop, sit, breathe and croak are all in the vertex shader (no
// per-frame JS per frog; the tick writes four uniforms). JS rebuilds the instance list only when the water places
// change (state sync) or a rain's puddles appear. Every frog hops between four points of its spot (heights from the
// terrain), facing the water while it sits; a frog's croak puffs its throat sac. Dusk brings out more frogs and more
// croaking; a rain brings frogs to the puddles until they dry; winter sends them to sleep (none), Still keeps them still.
//
//   createFrogs({ layer, ground }) -> frogs
//     frogs.setState(state) / frogs.sync(ids, topics, state)
//     frogs.update(dt, nowMs, { dusk, wet, season, motion, focus: { x, z, dist }, quality }) -> 0 | 1
//     frogs.stats() -> { frogs, visible }      frogs.warmup() -> [Object3D]
//   frogSpots(state, { has, info, keyOf, owned }) -> [{ x, z, y, face, kind, src }]   the water places (pure, tested)
//   FROGS                                     the tuning (counts per place, caps per tier, distances)
import * as THREE from 'three';
import { defOf } from '../../../shared/content/index.js';
import { TILE_M } from '../../../shared/content/config.js';
import { footprint } from '../../../shared/rules/grid.js';
import { heightAt, riverZ, riverHalf, WATER_Y, POND } from './ground.js';
import { box, geoPart, merge } from './world-kit.js';
import { models, wrapLighting, addShaderPatch } from './models.js';
import { ownedLand } from './world-state.js';

/** Counts per place (kind 0 = always out, 1 = out from dusk, 2 = out after rain), caps per quality tier, the camera
 *  distance beyond which the (tiny) frogs are not drawn at all, and a frog's size (m, nose to tail). */
export const FROGS = Object.freeze({
  river: Object.freeze({ x: Object.freeze([22, 46, 70, 94, 112]), dusk: Object.freeze([34, 82]) }),
  pond: 3, pondDusk: 2, duck: 1, duckDusk: 1, bath: 0, bathDusk: 1, koi: 1, koiDusk: 1, puddles: 5,
  cap: Object.freeze({ high: 26, medium: 18, low: 10 }), far: 72, size: 0.5,
});

/** Integer hash -> [0, 1) (both screens place the same frogs). */
function h1(n) { let x = Math.imul(n | 0, 2654435761) ^ 0x5bd1e995; x ^= x >>> 15; x = Math.imul(x, 2246822507); x ^= x >>> 13; return (x >>> 0) / 4294967296; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/**
 * The water places frogs sit at (metres; `face` = the yaw toward the water; kind 0 always, 1 dusk), in a stable order.
 * deps: models' has/info/keyOf (anchors of duck ponds, bird baths, koi ponds), and the owned-land set (ownedLand).
 * The river's farm bank and the Willow Pond are always there (the pond is wild water before it is the farm's). Pure.
 */
export function frogSpots(state, { info = (k) => models.info(k), keyOf = (d) => models.keyOf(d), owned = ownedLand } = {}) {
  const out = [];
  const bank = (x) => {
    // the river's farm bank: the first dry metre north of the water, facing the river (south, +z)
    const zc = riverZ(x) - riverHalf(x);
    let z = zc;
    for (let k = 0; k < 12 && heightAt(x, z) < WATER_Y + 0.05; k++) z -= 0.5;
    return { x, z, y: Math.max(WATER_Y, heightAt(x, z)), face: 0 };
  };
  FROGS.river.x.forEach((x) => out.push({ ...bank(x), kind: 0, src: 'river' }));
  FROGS.river.dusk.forEach((x) => out.push({ ...bank(x), kind: 1, src: 'river' }));
  // the Willow Pond (wild or the farm's): round its rim, facing the water
  const pondAt = (a) => {
    const c = Math.cos(a); const s = Math.sin(a);
    let k = 1.0;
    for (let i = 0; i < 10 && heightAt(POND.x + c * POND.rx * k, POND.z + s * POND.rz * k) < WATER_Y + 0.05; i++) k += 0.06;
    const x = POND.x + c * POND.rx * k; const z = POND.z + s * POND.rz * k;
    return { x, z, y: Math.max(WATER_Y, heightAt(x, z)), face: Math.atan2(POND.x - x, POND.z - z) };
  };
  const pondOwned = owned(state).has('willow_pond');
  for (let i = 0; i < FROGS.pond + FROGS.pondDusk; i++) {
    // (the farm's pond keeps its dock end free: no frog where the planks leave the bank, east of the pond)
    const a = Math.PI * (0.62 + i * 0.29) + (pondOwned ? 0.2 : 0);
    out.push({ ...pondAt(a), kind: i < FROGS.pond ? 0 : 1, src: 'pond' });
  }
  // the farm's own water: duck ponds (the home's `water` anchor), bird baths and koi ponds (decor anchors `water`)
  const objs = state && state.farm && state.farm.objects;
  if (objs) {
    for (const id of Object.keys(objs).sort()) {
      const o = objs[id];
      if (!o || !Number.isFinite(o.x)) continue;
      const def = defOf(o.def);
      if (!def || (def.kind !== 'home' && def.kind !== 'decor')) continue;
      const key = keyOf(o.def);
      const inf = key ? info(key) : null;
      if (!inf) continue;
      const w = def.kind === 'home' ? inf.water : inf.anchors && inf.anchors.water;
      if (!Array.isArray(w)) continue;
      // [x, z, r] (a home's pond) or [x, y, z, r] (a decor's basin), model metres, turned with the object
      const [fw, fd] = footprint(def, o.rot || 0);
      const cx = (o.x + fw / 2) * TILE_M; const cz = (o.z + fd / 2) * TILE_M;
      const yaw = (o.rot || 0) * (Math.PI / 2); const cs = Math.cos(yaw); const sn = Math.sin(yaw);
      const mx = w[0]; const mz = w.length === 4 ? w[2] : w[1]; const r = w.length === 4 ? w[3] : w[2];
      const wx = cx + mx * cs + mz * sn; const wz = cz - mx * sn + mz * cs;
      const bath = def.kind === 'decor' && r < 0.8;
      const [n0, n1] = def.kind === 'home' ? [FROGS.duck, FROGS.duckDusk] : bath ? [FROGS.bath, FROGS.bathDusk] : [FROGS.koi, FROGS.koiDusk];
      for (let i = 0; i < n0 + n1; i++) {
        const a = (hashStr(`${id}:frog${i}`) % 6283) / 1000;
        // on the rim of a pond; at the foot of a bird bath (it sits on the lawn, looking up at the basin)
        const rr = bath ? 0.75 : r * 1.05 + 0.15;
        const x = wx + Math.cos(a) * rr; const z = wz + Math.sin(a) * rr;
        out.push({ x, z, y: bath ? 0 : 0.02, face: Math.atan2(wx - x, wz - z), kind: i < n0 ? 0 : 1, src: def.kind === 'home' ? 'duck' : bath ? 'bath' : 'koi', id });
      }
    }
  }
  return out;
}

/** The farm's own water (placed by the farmers, where they look): it comes before the wild bank within a kind. */
const FARM_WATER = new Set(['duck', 'bath', 'koi']);
/**
 * The frogs a tier draws, at most `cap` of them: the always-out frogs, then a rain's puddle frogs (there only while the
 * lawn is wet), then the dusk-only ones; within each the farm's own water before the river and the pond, so a low-tier
 * phone (10 frogs) still sees one at each of its bird baths at dusk. Pure; the order is stable.
 */
export function frogPick(spots, puddles, cap) {
  const all = [...spots, ...puddles];
  const of = (kind, farm) => all.filter((s) => s.kind === kind && FARM_WATER.has(s.src) === farm);
  return [...of(0, true), ...of(0, false), ...of(2, false), ...of(2, true), ...of(1, true), ...of(1, false)].slice(0, cap);
}

/** Four hop points round a spot: on the bank either side and a step back, at the terrain's height. */
function hopPoints(s, seed, flat = false) {
  const along = s.face + Math.PI / 2;
  const pts = [[0, 0], [0.45, 0.05], [-0.45, 0.1], [0.12, -0.42]];
  return pts.map(([u, w], i) => {
    const j = (h1(seed * 7 + i) - 0.5) * 0.18;
    const x = s.x + Math.sin(along) * (u + j) + Math.sin(s.face) * w;
    const z = s.z + Math.cos(along) * (u + j) + Math.cos(s.face) * w;
    return [x, flat ? s.y : Math.max(WATER_Y - 0.02, heightAt(x, z)), z];
  });
}

/** The frog (faces +z, origin between its feet; ~210 triangles: a frog is a few centimetres on screen): a part tag per
 *  vertex for the shader (0 body, 1 throat sac, 2 hind legs). Low-poly balls (20-triangle icosahedra, 8-triangle octahedra). */
const ico = (r, hex, t) => geoPart(new THREE.IcosahedronGeometry(r, 0), hex, t, { flat: true });
const oct = (r, hex, t) => geoPart(new THREE.OctahedronGeometry(r, 0), hex, t, { flat: true });
function frogGeometry() {
  const G = '#5FAE3C'; const D = '#3F8A2C'; const B = '#E2EBA6'; const E = '#76C24A';
  const body = merge([
    ico(0.1, G, { y: 0.085, sx: 1.05, sy: 0.6, sz: 1.22 }),
    oct(0.085, B, { y: 0.055, z: 0.01, sx: 0.95, sy: 0.4, sz: 1.1 }),
    ico(0.075, G, { y: 0.11, z: 0.085, sx: 1.12, sy: 0.66, sz: 0.95 }),
    // eyes: green domes with black pupils
    ico(0.034, E, { x: -0.05, y: 0.158, z: 0.085 }), ico(0.034, E, { x: 0.05, y: 0.158, z: 0.085 }),
    oct(0.02, '#141410', { x: -0.058, y: 0.168, z: 0.108 }), oct(0.02, '#141410', { x: 0.058, y: 0.168, z: 0.108 }),
    // two darker spots on the back
    oct(0.026, D, { x: 0.035, y: 0.135, z: -0.02, sy: 0.4 }), oct(0.022, D, { x: -0.04, y: 0.13, z: -0.06, sy: 0.4 }),
    // front legs and their splayed feet
    box(0.024, 0.07, 0.024, G, { x: -0.06, z: 0.075, rz: 0.25 }), box(0.024, 0.07, 0.024, G, { x: 0.06, z: 0.075, rz: -0.25 }),
    oct(0.026, D, { x: -0.07, y: 0.006, z: 0.09, sy: 0.25, sz: 1.3 }), oct(0.026, D, { x: 0.07, y: 0.006, z: 0.09, sy: 0.25, sz: 1.3 }),
  ]);
  const sac = merge([ico(0.05, '#F2EFC0', { y: 0.072, z: 0.12, sx: 1.0, sy: 0.85, sz: 0.8 })]);
  const legs = merge([
    oct(0.05, G, { x: -0.085, y: 0.05, z: -0.06, sx: 0.7, sy: 0.6, sz: 1.35 }), oct(0.05, G, { x: 0.085, y: 0.05, z: -0.06, sx: 0.7, sy: 0.6, sz: 1.35 }),
    oct(0.034, D, { x: -0.1, y: 0.008, z: -0.01, sy: 0.25, sz: 1.6 }), oct(0.034, D, { x: 0.1, y: 0.008, z: -0.01, sy: 0.25, sz: 1.6 }),
  ]);
  const parts = [[body, 0], [sac, 1], [legs, 2]];
  let n = 0;
  for (const [g] of parts) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3); const nor = new Float32Array(n * 3); const col = new Float32Array(n * 3); const tag = new Float32Array(n);
  let o = 0;
  for (const [g, t] of parts) {
    const c = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array, o * 3); nor.set(g.getAttribute('normal').array, o * 3); col.set(g.getAttribute('color').array, o * 3);
    tag.fill(t, o, o + c);
    o += c;
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('fpart', new THREE.BufferAttribute(tag, 1));
  // the scale: the kit's frog is 0.3 m nose to tail; FROGS.size sets the drawn size
  return geo;
}

const f2 = (x) => x.toFixed(2);
/** The frogs' vertex patch: hop between the four points, sit facing the water, breathe, croak (the throat sac). */
const FROG_PARS = /* glsl */`
attribute float fpart;
attribute vec3 aP0; attribute vec3 aP1; attribute vec3 aP2; attribute vec3 aP3;
attribute vec4 aFrog;       // phase (s), seed 0..1, kind (0 always, 1 dusk, 2 rain), sitting yaw (toward the water)
attribute vec3 aTint;
uniform float uFT; uniform float uDusk; uniform float uWetF; uniform float uStill; uniform float uFrogOn;
float hhF1( float n ) { return fract( sin( n * 12.9898 + 4.1414 ) * 43758.5453 ); }
vec3 hhFP( float i ) { return i < 0.5 ? aP0 : i < 1.5 ? aP1 : i < 2.5 ? aP2 : aP3; }
float hhFI( float c, float seed ) { return floor( hhF1( c * 7.13 + seed * 91.7 ) * 3.999 ); }
`;
const FROG_VERT = /* glsl */`
{
  float seed = aFrog.y; float kind = aFrog.z;
  float vis = kind < 0.5 ? 1.0 : kind < 1.5 ? smoothstep( seed * 0.8, seed * 0.8 + 0.2, uDusk ) : smoothstep( seed * 0.6, seed * 0.6 + 0.25, uWetF );
  vis *= uFrogOn;
  float P = 5.5 + seed * 6.5;                       // a hop every 5.5..12 s
  float tt = uFT * ( 1.0 - uStill ) + aFrog.x;
  float c = floor( tt / P ); float u = tt - c * P;
  float i0 = hhFI( c - 1.0, seed ); float i1 = hhFI( c, seed );
  vec3 p0 = hhFP( i0 ); vec3 p1 = hhFP( i1 );
  float hop = 0.42;
  float k = clamp( u / hop, 0.0, 1.0 );
  float air = ( i0 == i1 ) ? 0.0 : sin( k * 3.14159 ) * step( u, hop );
  vec3 at = ( i0 == i1 ) ? p1 : mix( p0, p1, k );
  at.y += air * ( 0.16 + 0.3 * distance( p0.xz, p1.xz ) );
  // facing: along the hop while it hops, then it turns back to the water
  vec2 d = p1.xz - p0.xz;
  float hopYaw = length( d ) > 0.01 ? atan( d.x, d.y ) : aFrog.w;
  float turn = smoothstep( hop, hop + 0.9, u );
  float dy = aFrog.w - hopYaw; dy = dy - 6.28318 * floor( ( dy + 3.14159 ) / 6.28318 );
  float yaw = ( i0 == i1 ) ? aFrog.w : hopYaw + dy * turn;
  // a croak now and then (more at dusk): three puffs of the throat sac, the body lifting a little each time
  float croaks = step( hhF1( c * 5.31 + seed * 17.3 ), 0.3 + 0.55 * uDusk );
  float cu = u - 1.5 - seed * 2.0;
  float sac = croaks * step( 0.0, cu ) * step( cu, 1.9 ) * pow( abs( sin( cu * 4.96 ) ), 0.7 ) * ( 1.0 - uStill );
  float breath = 1.0 + 0.035 * sin( uFT * 4.2 + seed * 40.0 ) * ( 1.0 - uStill );
  vec3 lp = transformed;
  if ( fpart > 0.5 && fpart < 1.5 ) {
    vec3 cs = vec3( 0.0, 0.07, 0.115 );
    lp = cs + ( lp - cs ) * ( 0.62 + 1.25 * sac );
  } else if ( fpart > 1.5 ) {
    // the hind legs kick back in the air
    lp.z -= air * 0.11 * clamp( ( 0.1 - lp.y ) * 9.0, 0.0, 1.0 );
    lp.y += air * 0.02;
  }
  lp.y *= breath * ( 1.0 + sac * 0.06 ) * ( 1.0 - 0.15 * air ) ;
  lp.z *= 1.0 + air * 0.2;
  // the nose up in the air, a little squash as it lands
  float land = ( i0 == i1 ) ? 0.0 : smoothstep( hop, hop + 0.06, u ) * ( 1.0 - smoothstep( hop + 0.06, hop + 0.22, u ) );
  lp.y *= 1.0 - land * 0.18;
  float pitch = -air * 0.45;
  lp = vec3( lp.x, lp.y * cos( pitch ) - lp.z * sin( pitch ), lp.y * sin( pitch ) + lp.z * cos( pitch ) );
  lp *= ${f2(FROGS.size / 0.3)} * ( 0.85 + 0.3 * fract( seed * 7.7 ) ) * vis;
  float cY = cos( yaw ); float sY = sin( yaw );
  transformed = vec3( lp.x * cY + lp.z * sY, lp.y, -lp.x * sY + lp.z * cY ) + at;
}
`;
const FROG_NORMAL = /* glsl */`
{
  // the normals turn with the frog (yaw only: its hop pitch is small)
  float seedN = aFrog.y;
  float PN = 5.5 + seedN * 6.5;
  float ttN = uFT * ( 1.0 - uStill ) + aFrog.x;
  float cN = floor( ttN / PN ); float uN = ttN - cN * PN;
  float j0 = hhFI( cN - 1.0, seedN ); float j1 = hhFI( cN, seedN );
  vec2 dN = hhFP( j1 ).xz - hhFP( j0 ).xz;
  float hy = length( dN ) > 0.01 ? atan( dN.x, dN.y ) : aFrog.w;
  float dyN = aFrog.w - hy; dyN = dyN - 6.28318 * floor( ( dyN + 3.14159 ) / 6.28318 );
  float yawN = ( j0 == j1 ) ? aFrog.w : hy + dyN * smoothstep( 0.42, 1.32, uN );
  float c2 = cos( yawN ); float s2 = sin( yawN );
  objectNormal = vec3( objectNormal.x * c2 + objectNormal.z * s2, objectNormal.y, -objectNormal.x * s2 + objectNormal.z * c2 );
}
`;

export function createFrogs({ layer, ground = null } = {}) {
  let spots = [];
  let puddles = [];
  let mesh = null;
  let cap = 0;
  let count = 0;
  let quality = 'high';
  let lastWet = 0;
  let lastState = null;
  const uniforms = { uFT: { value: 0 }, uDusk: { value: 0 }, uWetF: { value: 0 }, uStill: { value: 0 }, uFrogOn: { value: 1 } };
  const sphere = new THREE.Sphere();
  const box = new THREE.Box3();
  const v3 = new THREE.Vector3();

  function material() {
    const m = models.createMaterial({ vertexColors: true });
    m.name = 'hh-frogs';
    wrapLighting(m);
    addShaderPatch(m, 'hh-frogs', (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${FROG_PARS}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${FROG_NORMAL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FROG_VERT}`)
        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb *= aTint;');
    }, 'f1');
    return m;
  }

  function build(n) {
    cap = Math.max(8, n);
    const geo = frogGeometry();
    for (const k of ['aP0', 'aP1', 'aP2', 'aP3', 'aTint']) geo.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    geo.setAttribute('aFrog', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    if (mesh) { mesh.geometry.dispose(); mesh.geometry = geo; return; }
    mesh = new THREE.Mesh(geo, material());
    mesh.name = 'frogs';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    layer.add(mesh);
  }

  /** The frogs to draw: the water places, then the puddles, within the tier's cap (frogPick). */
  function fill() {
    const list = frogPick(spots, puddles, FROGS.cap[quality] || FROGS.cap.high);
    count = list.length;
    if (!count) { if (mesh) mesh.visible = false; return; }
    if (!mesh || count > cap) build(count);
    const g = mesh.geometry;
    const A = ['aP0', 'aP1', 'aP2', 'aP3'].map((k) => g.getAttribute(k));
    const F = g.getAttribute('aFrog'); const T = g.getAttribute('aTint');
    box.makeEmpty();
    list.forEach((s, i) => {
      const seed = h1(Math.round(s.x * 131) * 7 + Math.round(s.z * 977) + i * 13);
      const pts = hopPoints(s, Math.round(seed * 9973), s.kind === 2);
      pts.forEach((p, k) => { A[k].setXYZ(i, p[0], p[1], p[2]); box.expandByPoint(v3.set(p[0], p[1], p[2])); });
      F.setXYZW(i, seed * 97, seed, s.kind, s.face);
      // a little colour per frog: leaf green, olive, a browner toad-ish one now and then
      const tint = seed < 0.55 ? [1, 1, 1] : seed < 0.85 ? [1.08, 1.0, 0.72] : [1.18, 0.9, 0.62];
      T.setXYZ(i, tint[0], tint[1], tint[2]);
    });
    g.instanceCount = count;
    for (const a of [...A, F, T]) a.needsUpdate = true;
    box.getBoundingSphere(sphere);
    sphere.radius += 1.5;
    g.boundingSphere = sphere.clone();
    mesh.frustumCulled = true;
  }

  function rebuild(state) {
    lastState = state;
    spots = state ? frogSpots(state) : [];
    fill();
  }
  const sig = (l) => l.map((s) => `${s.src}:${s.x.toFixed(1)},${s.z.toFixed(1)}`).join('|');

  return {
    setState(state) { rebuild(state); },
    sync(ids, topics, state) {
      lastState = state;
      if (!topics.has('*') && !topics.has('objects') && !topics.has('expansions')) return;
      const next = frogSpots(state);
      if (sig(next) !== sig(spots)) { spots = next; fill(); }
    },
    setQuality(q) { if (q !== quality) { quality = q; fill(); } },
    /** Per tick: four uniforms; the puddle frogs come with a rain (their spots are found once a shower has wet the lawn). */
    update(dt, nowMs, { dusk = 0, wet = 0, season = 'summer', motion = 'full', focus = null } = {}) {
      if (!mesh && !spots.length) return 0;
      // a rain's puddles: find them once the lawn is wet (ground.puddleSpots caches per land), drop them once it dried
      const wetNow = wet > 0.25;
      if (wetNow && lastWet <= 0.25 && ground && typeof ground.puddleSpots === 'function') {
        puddles = ground.puddleSpots(FROGS.puddles).map((p) => ({ x: p.x, z: p.z, y: 0.03, face: 0, kind: 2, src: 'puddle' }));
        fill();
      } else if (!wetNow && wet < 0.02 && puddles.length && lastWet >= 0.02) { puddles = []; fill(); }
      lastWet = wet;
      if (!mesh || !count) return 0;
      const winter = season === 'winter';
      const far = focus && Number.isFinite(focus.dist) && focus.dist > FROGS.far;
      mesh.visible = !winter && !far;
      if (!mesh.visible) return 0;
      uniforms.uFT.value = (nowMs / 1000) % 86400;
      uniforms.uDusk.value = Math.max(0, Math.min(1, dusk));
      uniforms.uWetF.value = Math.max(0, Math.min(1, wet));
      uniforms.uStill.value = motion === 'still' ? 1 : 0;
      return motion === 'still' ? 0 : 1;
    },
    stats() { return { frogs: count, visible: Boolean(mesh && mesh.visible), puddles: puddles.length }; },
    warmup() {
      if (!mesh) build(8);
      const was = mesh.visible; mesh.visible = true;
      return [{ removeFromParent() { mesh.visible = was && count > 0; } }];
    },
    /** Dev / tests: the frogs' places. */
    debug() { return { spots: spots.map((s) => ({ ...s })), puddles: puddles.map((s) => ({ ...s })), state: Boolean(lastState) }; },
  };
}
