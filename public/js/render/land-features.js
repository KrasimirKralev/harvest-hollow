// The named features of the M2 land (GDD §2.2, §2.4, §3.9 "Reveals", §6.2 #21): what each expansion from Bee Glade
// on reveals around the farm. The farm board stays flat (GDD §2.4): the features stand in the decorative ring next to
// their parcel, where the terrain is shaped for them (ground.js: POND, TERRACES, SUMMIT, the paddock and picnic
// pads), while the parcel itself gets its own ground (ground.js PARCEL_GROUND: clover, poppies, pebbles ...).
//   * Willow Pond (#9): the pond west of the parcel with a fishing dock out of a gap in the fence, a rowing boat,
//     weeping willows, lily pads and reeds. The dock is the fishing place (GDD §6.2 #21).
//   * Stable Paddock (#11): the oval riding track and the horse-show ring with its jumps and judges' box.
//   * Walnut Grove (#12): a picnic clearing under two old walnut trees, a rope swing on a bough.
//   * Olive Terrace (#13): dry-stone terraces climbing the hill, olive trees on every band, stone steps up the middle.
//   * Maple Ridge (#14): red maples along the ridge "with autumn colours all year", a wooden lookout on the crest.
//   * Sunset Hill (#15): the round grassy crest behind the gazebo, a lone oak, a bench facing the farm, a path up.
//   * Goat Rocks (#10): the rocky outcrop the goats would love, ledges and hardy pines. Pig Woods (#8): the oak edge
//     with ferns and a fallen log. Fairground Lane (#6): a fingerpost and the ribbon shelf at the corner.
// Before a parcel is the farm's, its feature zone is wild (young forest, brambles, a pond's reeds); buying it clears
// the zone with a puff of dust per tree and the feature appears. Zones keep the forest wall out (scene.js). Static:
// everything is in the scenery batches (the near, shadow-casting `scenery` for trees and buildings, the non-casting
// `mid` for small things). Deterministic (hashes, no Math.random). Owned by the render-world lane.
//
//   createLandFeatures({ scenery, mid, glows, fx }) -> lf
//     lf.setState(state, now) / lf.sync(ids, topics, state, now) / lf.update(dt, now, { motion }) -> 0 | 1
//     lf.places() -> [{ place: 'fishing', args: { pond: 'willow_pond', seats: [{ x, z, f }] (tiles) }, box, live },
//                     { place: 'horseshow', args: {}, box, live }]
//     lf.owners() -> Set of owned expansion ids (+ 'restore:<id>' of done projects): ground.setFeatures
//     lf.onEvent(ev) -> a cast or a catch at the dock: rings on the pond where the line went in
//     lf.ripples() -> ripple sources on the pond (the dock's piles, a cast's float) [ax, az, bx, bz, r]
//   FEATURE_ZONES { id: [x0, z0, x1, z1] }  inFeatureZone(x, z)   where the features stand (metres, pure)
//   featureItems(id, owned) -> [{ key, x, z, yaw, s, y?, mid?, color? }]   what a zone shows (pure, tested)
//   dockSeats() -> [{ x, z, face }]          where two farmers sit on the dock end (metres; render-life's sit pose)
import * as THREE from 'three';
import { CONTENT } from '../../../shared/content/index.js';
import { TILE_M } from '../../../shared/content/config.js';
import { heightAt, WATER_Y, POND, POND_DOCK, TERRACES, terraceRisers, SUMMIT, RIDING, PLACES } from './ground.js';
import { box, cyl, cone, ball, gable, flag, ring, merge, modelKey, geoPart, lin } from './world-kit.js';
import { featureLive } from './world-state.js';
import { willowGeometry } from './river.js';
import { models } from './models.js';

/** Where each feature stands (metres [x0, z0, x1, z1]); the forest wall keeps out of these (scene.js). */
export const FEATURE_ZONES = Object.freeze({
  willow_pond: Object.freeze([-2, 48, 16, 70]),
  stable_paddock: Object.freeze([-15, 71, 13, 96]),
  olive_terrace: Object.freeze([11, -22, 53, 13.5]),
  maple_ridge: Object.freeze([53, -30, 80, 13.5]),
  sunset_hill: Object.freeze([80, -26, 116, 13.5]),
  goat_rocks: Object.freeze([114.5, 33, 132, 63]),
  walnut_grove: Object.freeze([113.5, 69, 130, 91]),
  pig_woods: Object.freeze([113.5, 92, 131, 115]),
  fair_lane: Object.freeze([4, 112.5, 15.5, 117.5]),
});
/** Is (x, z) metres inside a feature zone (pure)? */
export function inFeatureZone(x, z) {
  for (const k in FEATURE_ZONES) {
    const [x0, z0, x1, z1] = FEATURE_ZONES[k];
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------
// Deterministic hashes (both screens and every reload draw the same land)
function hash(i, k) {
  let h = Math.imul(i | 0, 2654435761) ^ Math.imul(k | 0, 1597334677);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const ROCK = [1.02, 0.97, 0.88];
const dry = (x, z, m = 0.15) => heightAt(x, z) > WATER_Y + m;
const pondE = (x, z) => Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz);

/** The dock's planks over the pond: from the fence (x = POND_DOCK.x) west, deck just above the bank. */
const DOCK_DECK = 0.12;
/** Where two farmers sit on the dock end, legs over the water (metres; face = yaw toward the water). */
export function dockSeats() {
  const x = POND_DOCK.x - POND_DOCK.len + 0.7;
  return [{ x, z: POND_DOCK.z - 0.45, face: -Math.PI / 2 }, { x, z: POND_DOCK.z + 0.45, face: -Math.PI / 2 }];
}

// ---------------------------------------------------------------------------------------------------
// The wild zone before the parcel is bought: young forest (pines, round trees, bushes) on dry ground, reeds and a
// fallen willow at the pond; the paddock and the clearing are overgrown meadow with bushes
function wildItems(id) {
  const [x0, z0, x1, z1] = FEATURE_ZONES[id];
  const out = [];
  const CELL = id === 'fair_lane' ? 99 : 4.2;
  for (let gz = z0 + CELL / 2; gz < z1; gz += CELL) {
    for (let gx = x0 + CELL / 2; gx < x1; gx += CELL) {
      const i = Math.round(gx * 13 + gz * 211);
      const x = gx + (hash(i, 1) - 0.5) * CELL * 0.85; const z = gz + (hash(i, 2) - 0.5) * CELL * 0.85;
      if (!dry(x, z, 0.35)) continue;
      // the farm's own fence stays clear (2.5 m), as the forest wall does
      if (x > 13.5 && x < 114.5 && z > 13.5 && z < 114.5) continue;
      const r = hash(i, 3);
      const open = id === 'stable_paddock' || id === 'walnut_grove' || id === 'willow_pond';
      if (r > (open ? 0.42 : 0.82)) continue;
      const yaw = hash(i, 4) * Math.PI * 2;
      const big = 0.75 + hash(i, 5) * 0.55;
      let key;
      if (open) key = r < 0.12 ? 'prop:forest_round_1' : r < 0.32 ? `prop:bush_${1 + (i & 1)}` : 'prop:flower_tuft';
      else key = r < 0.45 ? `prop:forest_pine_${1 + (i & 1)}` : r < 0.66 ? `prop:forest_round_${1 + (i % 3)}` : r < 0.78 ? `prop:bush_${1 + (i & 1)}` : 'prop:rock_1';
      out.push({ key, x, z, yaw, s: key.includes('flower') ? 1.4 : big, mid: key.includes('bush') || key.includes('flower') || key.includes('rock'), wild: true });
    }
  }
  if (id === 'willow_pond') {
    // the wild pond: reeds round the water's edge and one old willow leaning over it
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2 + hash(k, 21) * 0.3;
      const e = 1.0 + hash(k, 22) * 0.12;
      const x = POND.x + Math.cos(a) * POND.rx * e; const z = POND.z + Math.sin(a) * POND.rz * e;
      if (x > 14.5) continue;
      out.push({ key: 'prop:reeds', x, z, yaw: a * 3, s: 0.9 + hash(k, 23) * 0.6, y: Math.max(heightAt(x, z), WATER_Y) - 0.1, mid: true, wild: true });
    }
    out.push({ key: 'prop:willow', x: POND.x - 4.6, z: POND.z - 6.6, yaw: 2.4, s: 0.8, wild: true });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Stand-ins (render-life's keys replace them when the manifest has them)
const BARK = '#7A5636';
/** A lump of foliage (20 triangles, smooth-shaded so it reads round): the ring's many trees stay cheap (GDD §8.6). */
const lump = (r, hex, t, o) => geoPart(new THREE.IcosahedronGeometry(r, 0), hex, t, { sway: 0.22, ...o });
function treeOf(crowns, trunk = BARK, { h = 2.2, r = 0.28, fork = true } = {}) {
  const parts = [cyl(r * 0.7, r, h, 7, trunk)];
  if (fork) {
    parts.push(cyl(r * 0.35, r * 0.55, h * 0.75, 6, trunk, { x: 0.05, y: h * 0.85, z: 0.1, rx: 0.4, rz: -0.35 }));
    parts.push(cyl(r * 0.3, r * 0.5, h * 0.7, 6, trunk, { x: -0.05, y: h * 0.85, z: -0.1, rx: -0.35, rz: 0.4 }));
  }
  for (const [x, y, z, rad, col, sy] of crowns) parts.push(ball(rad, col, { x, y, z, sy: sy ?? 0.82 }, { sway: 0.25 }));
  return merge(parts);
}
/** An olive tree: a gnarled, leaning grey-brown trunk under a loose silvery-green crown. */
export function oliveGeometry() {
  // a short, twisted, split trunk and a loose, open crown of small silvery clumps with sky between them
  const parts = [cyl(0.2, 0.34, 1.1, 7, '#8C7A62', { rz: 0.16 }), cyl(0.13, 0.2, 1.4, 6, '#7E6D57', { x: 0.22, y: 0.95, rz: -0.38 }),
    cyl(0.12, 0.18, 1.3, 6, '#7E6D57', { x: -0.05, y: 1.0, z: 0.1, rx: 0.45, rz: 0.42 }), cyl(0.09, 0.13, 1.1, 5, '#857360', { y: 1.05, z: -0.1, rx: -0.55 })];
  const C = ['#93A67E', '#82996C', '#A5B690', '#8AA076', '#9CAE86'];
  for (let k = 0; k < 9; k++) {
    const a = k * 2.39; const r = 0.35 + (k % 3) * 0.42;
    parts.push(lump(0.46 + (k % 2) * 0.14, C[k % C.length], { x: Math.cos(a) * r, y: 2.05 + (k % 4) * 0.22, z: Math.sin(a) * r, sy: 0.62, ry: k }));
  }
  return merge(parts);
}
/** A red maple: a straight trunk under a lobed crown in reds and copper (autumn all year, GDD §3.9 #14). */
export function mapleGeometry(v = 0) {
  const C = [['#B8503A', '#CF7442', '#A84436', '#C46238', '#D49A48'], ['#A84436', '#C2643A', '#B8503A', '#D08A44', '#9A4034']][v % 2];
  const parts = [cyl(0.17, 0.24, 2.4, 6, '#6E4C30'), cyl(0.08, 0.13, 1.6, 5, '#6E4C30', { x: 0.05, y: 2.0, z: 0.1, rx: 0.4, rz: -0.35 })];
  // a rounded crown: three big round lobes and four small faceted ones (52 of them stand on the ridge)
  for (const [x, y, z, r, i] of [[0, 3.3, 0, 1.35, 0], [0.95, 2.95, 0.3, 0.95, 1], [-0.9, 3.0, -0.25, 1.0, 2]]) parts.push(ball(r, C[i], { x, y, z, sy: 0.85 }, { sway: 0.22 }));
  for (const [x, y, z, r, i] of [[0.2, 4.1, -0.35, 0.95, 3], [-0.3, 2.75, 0.9, 0.8, 4], [0.5, 3.6, 0.8, 0.75, 0], [-0.6, 3.7, -0.8, 0.7, 1]]) parts.push(lump(r, C[i], { x, y, z, sy: 0.85, ry: x * 3 }));
  return merge(parts);
}
/** A broad old oak: a thick trunk, low boughs and a wide dark crown (Pig Woods' edge, Sunset Hill's lone tree). */
export function oakGeometry() {
  return treeOf([[0, 4.0, 0, 2.1, '#4C7A3A'], [1.6, 3.5, 0.5, 1.5, '#3F6B2E'], [-1.5, 3.6, -0.4, 1.6, '#5E8C45'], [0.4, 4.9, -0.9, 1.4, '#557F3F'],
    [-0.6, 3.3, 1.4, 1.3, '#467238'], [0.9, 3.4, -1.5, 1.2, '#4C7A3A']], '#6B4A30', { h: 2.6, r: 0.45 });
}
/** An old walnut: a pale grey trunk forking low under a light, open crown. */
export function walnutGeometry() {
  return treeOf([[0, 3.8, 0, 1.8, '#7FA65A'], [1.4, 3.3, 0.4, 1.25, '#6E9A4C'], [-1.3, 3.4, -0.3, 1.3, '#88B062'], [0.2, 4.6, -0.8, 1.15, '#76A052'],
    [-0.4, 3.2, 1.2, 1.1, '#6E9A4C']], '#9A9184', { h: 2.3, r: 0.4 });
}

/** The fishing dock: planks on piles from the bank out over the pond, a bollard, a lantern post at the end, the rod
 *  rack and a bucket at the land end. Origin at the fence; the dock runs along -x. */
export function dockGeometry() {
  const L = POND_DOCK.len; const W = 1.7;
  const parts = [];
  const n = Math.round(L / 0.36);
  for (let i = 0; i < n; i++) parts.push(box(0.32, 0.1, W, i % 3 ? '#B9814A' : '#C99257', { x: -0.18 - i * 0.36, y: DOCK_DECK - 0.1 }));
  for (const sz of [-W / 2 + 0.1, W / 2 - 0.1]) parts.push(box(L, 0.14, 0.12, '#8A5A35', { x: -L / 2, y: DOCK_DECK - 0.26, z: sz }));
  for (let k = 0; k < 4; k++) for (const sz of [-W / 2 + 0.08, W / 2 - 0.08]) parts.push(cyl(0.09, 0.11, 1.9, 6, '#7A5232', { x: -0.4 - k * (L - 0.6) / 3, y: DOCK_DECK - 1.8, z: sz }));
  // the end: a bollard and a lantern post; the land end: the rod rack, a bucket and a little sign
  parts.push(cyl(0.1, 0.13, 0.36, 7, '#5E4A3A', { x: -L + 0.25, y: DOCK_DECK, z: W / 2 - 0.25 }));
  parts.push(cyl(0.05, 0.06, 1.9, 5, '#7A5232', { x: -L + 0.2, y: DOCK_DECK, z: -W / 2 + 0.15 }));
  parts.push(box(0.26, 0.3, 0.26, '#3C3A36', { x: -L + 0.2, y: DOCK_DECK + 1.88, z: -W / 2 + 0.15 }), box(0.18, 0.2, 0.18, '#FFD27A', { x: -L + 0.2, y: DOCK_DECK + 1.93, z: -W / 2 + 0.15 }, { shade: false }));
  parts.push(box(0.08, 1.1, 0.08, '#7A5232', { x: -0.5, z: W / 2 + 0.3 }), box(0.08, 1.1, 0.08, '#7A5232', { x: -1.3, z: W / 2 + 0.3 }), box(0.95, 0.07, 0.1, '#8A5A35', { x: -0.9, y: 0.9, z: W / 2 + 0.3 }));
  for (let k = 0; k < 3; k++) parts.push(cyl(0.012, 0.015, 1.6, 4, '#D9C59A', { x: -0.62 - k * 0.24, y: 0.05, z: W / 2 + 0.36, rz: 0.12 }));
  parts.push(cyl(0.16, 0.13, 0.3, 8, '#5E8FA8', { x: -1.6, y: DOCK_DECK, z: -0.4 }));
  parts.push(box(0.06, 0.9, 0.06, '#7A5232', { x: 0.35, z: -W / 2 - 0.25 }), box(0.7, 0.36, 0.05, '#E8DCC2', { x: 0.35, y: 0.75, z: -W / 2 - 0.25 }));
  parts.push(box(0.3, 0.08, 0.06, '#2F7AA8', { x: 0.25, y: 0.86, z: -W / 2 - 0.22 }, { shade: false }), cone(0.06, 0.12, 4, '#2F7AA8', { x: 0.45, y: 0.82, z: -W / 2 - 0.22, rz: -Math.PI / 2 }, { shade: false }));
  return merge(parts);
}

/** A little rowing boat: a pointed hull, two thwarts and a pair of oars, painted teal with a cream rim. */
export function rowboatGeometry() {
  // a lofted hull of half-rings from bow to stern, pointed at both ends: the outside in teal (faces outward) and the
  // inside in planking (faces inward, a touch smaller), so the boat reads from above (the inside) and from the side
  const N = 9; const R = 7;
  const hull = (shrink, outward) => {
    const pos = []; const idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N; const x = (t - 0.5) * 2.7 * shrink;
      const k = Math.sin(Math.PI * t) ** 0.7;
      for (let j = 0; j <= R; j++) {
        const a = Math.PI + (j / R) * Math.PI;            // the lower half-ring, port to starboard
        pos.push(x, 0.34 + (Math.sin(a) * 0.36 * (0.35 + 0.65 * k) + (1 - k) * 0.12) * shrink, Math.cos(a) * 0.62 * k * shrink);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < R; j++) {
      const a = i * (R + 1) + j; const b = a + R + 1;
      if (outward) idx.push(a, b, a + 1, a + 1, b, b + 1); else idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  };
  const parts = [geoPart(hull(1, true), '#2F8C86', {}, { flat: true }), geoPart(hull(0.93, false), '#C99257', { y: 0.03 }, { flat: true })];
  // the cream gunwale, two thwarts and a pair of shipped oars
  for (const sz of [-1, 1]) parts.push(box(2.2, 0.07, 0.09, '#F1E6CF', { y: 0.33, z: sz * 0.56, ry: sz * 0.05 }));
  for (const x of [-0.45, 0.45]) parts.push(box(0.2, 0.05, 1.1, '#9C6A3E', { x, y: 0.3 }));
  for (const sz of [-1, 1]) parts.push(box(1.8, 0.04, 0.06, '#D9A15B', { x: 0.1, y: 0.42, z: sz * 0.35, ry: sz * 0.1 }));
  return merge(parts);
}

/** A lily pad with a flower: a flat green disc with a notch and a pink-white flower (the pond's own; the lake has
 *  render-life's `prop:lilypad`). */
export function lilyGeometry(flower = true) {
  const g = new THREE.CircleGeometry(0.42, 9, 0.35, Math.PI * 2 - 0.35);
  g.rotateX(-Math.PI / 2);
  const parts = [geoPart(g, '#4E8A3A', { y: 0.02 }, { flat: true })];
  if (flower) {
    parts.push(...ring(6, (i, a) => cone(0.07, 0.2, 4, i % 2 ? '#F7D6E2' : '#FFFFFF', { x: Math.sin(a) * 0.09, y: 0.04, z: Math.cos(a) * 0.09, rx: Math.cos(a) * 0.9, rz: -Math.sin(a) * 0.9 }, { shade: false })));
    parts.push(ball(0.05, '#F7D24A', { y: 0.1 }, { shade: false }));
  }
  return merge(parts);
}

/** A rocky outcrop of stacked ledges (Goat Rocks, GDD §3.9 #10 "a rocky outcrop goats climb"): broad flat slabs
 *  stepping up and back, each with a mossy top, a few loose stones at the foot. */
export function outcropGeometry(v = 0) {
  const parts = [];
  const C = ['#A39A8A', '#B8B0A2', '#9A9184', '#ADA494'];
  // faceted, flattened boulders as ledges (a natural shelf, never a stack of boxes), each a little higher and further
  // back, with a mossy cap; [x, y, z, rx, ry(height), rz, yaw]
  const steps = [[0, 0.1, 0, 2.7, 0.75, 2.2, 0.1], [0.6, 0.85, -0.6, 2.1, 0.7, 1.7, -0.4], [1.0, 1.55, -1.0, 1.55, 0.62, 1.3, 0.6], [1.3, 2.15, -1.35, 0.95, 0.5, 0.85, -0.2]];
  steps.forEach(([x, y, z, rx, ry, rz, yaw], i) => {
    const k = (i + v) % 4;
    const g = new THREE.IcosahedronGeometry(1, 1);
    parts.push(geoPart(g, C[k], { x, y, z, sx: rx, sy: ry, sz: rz, ry: yaw + v * 0.5 }, { flat: true }));
    // a lesser stone leaning on the ledge: no ledge is a single smooth lump
    parts.push(geoPart(new THREE.IcosahedronGeometry(1, 0), C[(k + 1) % 4], { x: x - rx * 0.6, y: y - ry * 0.1, z: z + rz * 0.45, sx: rx * 0.45, sy: ry * 0.75, sz: rz * 0.4, ry: yaw + 0.8 }, { flat: true }));
    parts.push(geoPart(new THREE.IcosahedronGeometry(1, 1), i % 2 ? '#7E9A52' : '#8AA65C', { x: x + 0.1, y: y + ry * 0.72, z: z - 0.05, sx: rx * 0.62, sy: 0.12, sz: rz * 0.55, ry: yaw }, { flat: true }));
  });
  for (let k = 0; k < 6; k++) { const a = k * 1.15 + v; parts.push(geoPart(new THREE.IcosahedronGeometry(1, 0), C[k % 4], { x: Math.cos(a) * 3.0, y: 0.05, z: Math.sin(a) * 2.6, sx: 0.4 + (k % 3) * 0.12, sy: 0.25, sz: 0.35 + (k % 2) * 0.1, ry: a }, { flat: true })); }
  return merge(parts);
}

/** A white post-and-rail section of the riding track fence: two rails 2.6 m long on a post (origin at the post). */
export function railGeometry(len = 2.6) {
  return merge([box(0.12, 1.15, 0.12, '#F4EFE6'), box(0.16, 0.06, 0.16, '#E2DACB', { y: 1.15 }), box(len, 0.1, 0.06, '#FFFFFF', { x: len / 2, y: 0.95 }),
    box(len, 0.1, 0.06, '#FFFFFF', { x: len / 2, y: 0.55 })]);
}
/** A show jump: two striped wings and three poles (red and white, blue and white). */
export function jumpGeometry(v = 0) {
  const A = v % 2 ? '#2F6FB8' : '#D2483C';
  const parts = [];
  for (const sx of [-1.6, 1.6]) {
    parts.push(box(0.16, 1.4, 0.5, '#FFFFFF', { x: sx }), box(0.2, 0.1, 0.6, A, { x: sx, y: 1.4 }), box(0.5, 0.1, 0.16, '#FFFFFF', { x: sx, y: 0.05 }));
    for (const y of [0.35, 0.75, 1.1]) parts.push(box(0.18, 0.12, 0.52, A, { x: sx, y }));
  }
  for (const [y, z] of [[0.55, 0], [0.95, 0], [1.25, 0]]) for (let k = 0; k < 6; k++) parts.push(box(0.53, 0.09, 0.09, k % 2 ? '#FFFFFF' : A, { x: -1.32 + k * 0.53, y, z }));
  // a flower box at the foot
  parts.push(box(2.6, 0.22, 0.32, '#5E8C45', { z: 0.45 }));
  for (let k = 0; k < 6; k++) parts.push(ball(0.11, ['#FF9FB0', '#FFE27A', '#FFFFFF'][k % 3], { x: -1.1 + k * 0.44, y: 0.28, z: 0.45 }));
  return merge(parts);
}
/** The judges' box by the ring: a raised timber booth under a striped roof, with a flag and a bell. */
export function judgesGeometry() {
  const parts = [box(2.6, 0.9, 2.0, '#C99257'), box(2.8, 0.12, 2.2, '#8A5A35', { y: 0.9 })];
  for (const [sx, sz] of [[-1.25, -0.9], [1.25, -0.9], [-1.25, 0.9], [1.25, 0.9]]) parts.push(box(0.12, 1.75, 0.12, '#F4EFE6', { x: sx, y: 1.0, z: sz }));
  parts.push(box(2.7, 0.55, 0.08, '#FFFFFF', { y: 1.0, z: 1.0 }), box(1.5, 0.3, 0.1, '#2F6FB8', { y: 1.15, z: 1.04 }, { shade: false }));
  // a striped canvas roof: two slopes of red and white bands, a scalloped valance on the front
  for (let k = 0; k < 6; k++) for (const sz of [-1, 1]) parts.push(box(0.5, 0.05, 1.32, k % 2 ? '#FFFFFF' : '#D2483C', { x: -1.25 + k * 0.5, y: 2.75 + 0.27, z: sz * 0.6, rx: sz * 0.42 }));
  for (let k = 0; k < 6; k++) parts.push(cone(0.25, 0.22, 3, k % 2 ? '#FFFFFF' : '#D2483C', { x: -1.25 + k * 0.5, y: 2.55, z: 1.18, rx: Math.PI }));
  parts.push(cyl(0.04, 0.04, 1.4, 4, '#E8DCC2', { x: 1.2, y: 3.0, z: -0.8 }), flag(0.7, 0.42, '#FFC83D', { x: 1.2, y: 4.35, z: -0.8 }));
  parts.push(box(2.2, 0.5, 0.6, '#B9814A', { y: 0, z: 1.5 }));
  return merge(parts);
}
/** A low spectators' bench of planks. */
const benchGeometry = () => merge([box(2.4, 0.1, 0.42, '#B9814A', { y: 0.45 }), box(0.12, 0.45, 0.36, '#8A5A35', { x: -1, y: 0 }), box(0.12, 0.45, 0.36, '#8A5A35', { x: 1, y: 0 }),
  box(2.4, 0.4, 0.08, '#B9814A', { y: 0.6, z: -0.18 })]);

/** A dry-stone wall `len` m long (along x), its stones jittered, a cap course on top (origin at its middle). */
export function stoneWallGeometry(len = 4, h = 1.55, seed = 1) {
  // three courses of big, offset stones and a cap course with a few raised coping stones (~150 triangles a 4 m run:
  // 36 runs climb the terraces)
  const parts = [];
  const C = ['#B8B0A2', '#A39A8A', '#C9C0AE', '#9A9184', '#B0A694'];
  const rows = 3; const rh = (h - 0.2) / rows;
  for (let row = 0; row < rows; row++) {
    let x = -len / 2 + (row % 2) * 0.45;
    if (row % 2) parts.push(box(0.45, rh - 0.03, 0.56, C[(row + seed) % C.length], { x: -len / 2 + 0.225, y: row * rh }));
    for (let k = 0; x < len / 2 - 0.05; k++) {
      const w = Math.min(len / 2 - x, 0.8 + hash(seed * 31 + row * 7 + k, 7) * 0.5);
      parts.push(box(w - 0.04, rh - 0.03, 0.52 + hash(seed + row, k) * 0.1, C[(k + row + seed) % C.length], { x: x + w / 2, y: row * rh, z: (hash(k, row + seed) - 0.5) * 0.05 }));
      x += w;
    }
  }
  parts.push(box(len, 0.16, 0.6, '#9A9184', { y: h - 0.2 }));
  for (let k = 0; k < 4; k++) parts.push(box(0.5, 0.16, 0.42, C[(k + seed) % C.length], { x: -len / 2 + 0.5 + k * 1.0, y: h - 0.06, rz: (hash(k, seed) - 0.5) * 0.3 }));
  return merge(parts);
}
/** A flight of stone steps rising `rise` m over `run` m along +z (origin at the bottom step's front middle). */
export function stepsGeometry(rise = TERRACES.rise, run = 1.6, n = 5, w = 1.6) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(box(w, (rise / n) * (i + 1), run / n + 0.02, i % 2 ? '#B8B0A2' : '#C9C0AE', { z: -(i + 0.5) * (run / n) }));
  for (const sx of [-w / 2 - 0.18, w / 2 + 0.18]) parts.push(box(0.32, rise + 0.3, run, '#9A9184', { x: sx, z: -run / 2 }));
  return merge(parts);
}
/** The lookout on Maple Ridge: a timber tower 5 m tall, a railed platform under a little roof, a ladder. */
export function lookoutGeometry() {
  const parts = [];
  const H = 5;
  for (const [sx, sz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) parts.push(cyl(0.11, 0.14, H + 1.6, 6, '#8A5A35', { x: sx * (1 - 0.0), z: sz }));
  for (const y of [1.4, 3.0]) for (const [a, b] of [[[-1.1, -1.1], [1.1, -1.1]], [[1.1, -1.1], [1.1, 1.1]], [[1.1, 1.1], [-1.1, 1.1]], [[-1.1, 1.1], [-1.1, -1.1]]]) {
    const mx = (a[0] + b[0]) / 2; const mz = (a[1] + b[1]) / 2; const along = a[0] === b[0];
    parts.push(box(along ? 0.08 : 2.2, 0.1, along ? 2.2 : 0.08, '#9C6A3E', { x: mx, y, z: mz }));
    parts.push(box(along ? 0.06 : 2.6, 0.08, along ? 2.6 : 0.06, '#7A5232', { x: mx, y: y + 0.8, z: mz, rx: along ? 0.55 : 0, rz: along ? 0 : 0.55 }));
  }
  parts.push(box(2.8, 0.16, 2.8, '#B9814A', { y: H }));
  for (const [sx, sz, rot] of [[0, -1.35, 0], [0, 1.35, 0], [-1.35, 0, 1], [1.35, 0, 1]]) parts.push(box(rot ? 0.07 : 2.8, 0.08, rot ? 2.8 : 0.07, '#C99257', { x: sx, y: H + 0.95, z: sz }));
  parts.push(gable(3.2, 1.1, 3.2, '#9C3D2E', { y: H + 1.6 }));
  for (let k = 0; k < 9; k++) parts.push(box(0.6, 0.06, 0.08, '#C99257', { x: 1.45, y: 0.3 + k * 0.55, z: 0.6 }));
  for (const sz of [0.3, 0.9]) parts.push(box(0.06, H, 0.06, '#8A5A35', { x: 1.45, z: sz }));
  parts.push(cyl(0.03, 0.03, 1.2, 4, '#E8DCC2', { x: -1.1, y: H + 2.4, z: -1.1 }), flag(0.8, 0.45, '#E0703A', { x: -1.1, y: H + 3.55, z: -1.1 }));
  return merge(parts);
}
/** A picnic: a red-and-cream checked blanket with a wicker basket, a pie and two cups. */
export function picnicGeometry() {
  const parts = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) parts.push(box(0.4, 0.03, 0.4, (i + j) % 2 ? '#F4EADB' : '#C8473A', { x: -1.0 + i * 0.4, z: -0.8 + j * 0.4 }, { shade: false }));
  parts.push(cyl(0.3, 0.26, 0.32, 9, '#B98B4E', { x: 0.55, y: 0.03, z: -0.3 }), box(0.66, 0.06, 0.5, '#9C6A3E', { x: 0.55, y: 0.36, z: -0.3 }));
  parts.push(geoPart(new THREE.TorusGeometry(0.26, 0.025, 4, 10, Math.PI), '#8A5A35', { x: 0.55, y: 0.38, z: -0.3 }));
  parts.push(cyl(0.22, 0.2, 0.08, 10, '#D9A15B', { x: -0.45, y: 0.03, z: 0.15 }), cyl(0.2, 0.2, 0.02, 10, '#B5543F', { x: -0.45, y: 0.11, z: 0.15 }));
  for (const [x, z] of [[0, 0.4], [0.2, 0.55]]) parts.push(cyl(0.05, 0.04, 0.1, 6, '#FFFFFF', { x, y: 0.03, z }));
  return merge(parts);
}
/** A rope swing hanging 3 m from a bough, its plank seat 0.5 m above the grass. */
export function swingGeometry() {
  return merge([cyl(0.02, 0.02, 3.0, 4, '#D9C59A', { x: -0.3, y: 0.55 }), cyl(0.02, 0.02, 3.0, 4, '#D9C59A', { x: 0.3, y: 0.55 }), box(0.8, 0.06, 0.26, '#B9814A', { y: 0.5 })]);
}
/** A log to sit on. */
const logGeometry = () => merge([cyl(0.28, 0.3, 2.4, 8, '#7A5636', { y: 0.3, rz: Math.PI / 2, x: 1.2 }), cyl(0.27, 0.27, 0.02, 8, '#D9B98A', { x: 1.21, y: 0.3, rz: Math.PI / 2 }, { shade: false })]);
/** A fingerpost by the lane: "County Fair" pointing west, the farm's name board east. */
export function fingerpostGeometry() {
  return merge([box(0.14, 2.4, 0.14, '#8A5A35'), box(1.3, 0.3, 0.06, '#F1E6CF', { x: -0.6, y: 2.0 }), cone(0.18, 0.3, 3, '#F1E6CF', { x: -1.3, y: 2.0, rz: Math.PI / 2, rx: Math.PI / 2 }),
    box(1.1, 0.26, 0.06, '#E8DCC2', { x: 0.5, y: 1.6 }), box(0.9, 0.06, 0.07, '#C8473A', { x: -0.6, y: 2.0 }, { shade: false })]);
}
/** The Fairground Lane's ribbon shelf: a little roofed board with blue, red and yellow rosettes. */
export function ribbonShelfGeometry() {
  const parts = [box(0.12, 1.5, 0.12, '#8A5A35', { x: -0.9 }), box(0.12, 1.5, 0.12, '#8A5A35', { x: 0.9 }), box(2.0, 0.9, 0.08, '#B9814A', { y: 0.9 })];
  parts.push(gable(2.3, 0.4, 0.6, '#9C3D2E', { y: 1.85 }));
  [['#2F6FB8', -0.55], ['#D2483C', 0], ['#FFC83D', 0.55]].forEach(([c, x]) => {
    parts.push(cyl(0.2, 0.2, 0.05, 10, c, { x, y: 1.5, z: 0.06, rx: Math.PI / 2 }, { shade: false }), cyl(0.09, 0.09, 0.06, 8, '#FFFFFF', { x, y: 1.5, z: 0.08, rx: Math.PI / 2 }, { shade: false }));
    parts.push(box(0.08, 0.3, 0.02, c, { x: x - 0.06, y: 1.12, z: 0.07 }, { shade: false }), box(0.08, 0.3, 0.02, c, { x: x + 0.06, y: 1.12, z: 0.07 }, { shade: false }));
  });
  return merge(parts);
}

/** Model keys and their stand-ins. Render-life may deliver any `prop:` key; `hh-` keys are ours only. */
export const STAND_INS = Object.freeze({
  'prop:willow': willowGeometry, 'prop:fishing_dock': dockGeometry, 'prop:rowboat': rowboatGeometry, 'hh-lily': () => lilyGeometry(true),
  'hh-lily-pad': () => lilyGeometry(false), 'hh-white-rail': () => railGeometry(), 'prop:show_jump': () => jumpGeometry(0),
  'prop:show_jump:2': () => jumpGeometry(1), 'prop:judges_box': judgesGeometry, 'hh-bench-plank': benchGeometry,
  'hh-stone-wall': () => stoneWallGeometry(4, TERRACES.rise + 0.35, 3), 'hh-stone-steps': () => stepsGeometry(), 'prop:olive_tree': oliveGeometry,
  'prop:red_maple': () => mapleGeometry(0), 'prop:red_maple:2': () => mapleGeometry(1), 'prop:oak': oakGeometry, 'prop:walnut_old': walnutGeometry,
  'prop:lookout': lookoutGeometry, 'prop:picnic': picnicGeometry, 'prop:rope_swing': swingGeometry, 'hh-log': logGeometry,
  'prop:fingerpost': fingerpostGeometry, 'prop:ribbon_shelf': ribbonShelfGeometry, 'prop:outcrop': () => outcropGeometry(0),
  'prop:outcrop:2': () => outcropGeometry(1),
});

// ---------------------------------------------------------------------------------------------------
// What each zone shows once owned (pure layout; metres)
function willowPondItems() {
  const out = [];
  out.push({ key: 'prop:fishing_dock', x: POND_DOCK.x, z: POND_DOCK.z, yaw: 0, s: 1, y: 0 });
  out.push({ key: 'prop:rowboat', x: POND_DOCK.x - 3.4, z: POND_DOCK.z + 1.8, yaw: 0.12, s: 1, y: WATER_Y - 0.12 });
  // two weeping willows on the far bank, leaning over the water (their model leans along +z: turned toward the pond)
  for (const [a, s] of [[2.55, 1.0], [3.75, 0.88]]) {
    const x = POND.x + Math.cos(a) * POND.rx * 1.22; const z = POND.z + Math.sin(a) * POND.rz * 1.22;
    out.push({ key: 'prop:willow', x, z, yaw: Math.atan2(POND.x - x, POND.z - z), s });
  }
  // lily pads in two drifts (some flowering), reeds and stones round the bank (not on the dock's side)
  for (let k = 0; k < 16; k++) {
    const a = 1.2 + (k % 8) * 0.33 + (k >= 8 ? 2.6 : 0) + hash(k, 31) * 0.2;
    const e = 0.45 + hash(k, 32) * 0.4;
    out.push({ key: k % 3 ? 'hh-lily-pad' : 'hh-lily', x: POND.x + Math.cos(a) * POND.rx * e, z: POND.z + Math.sin(a) * POND.rz * e, yaw: hash(k, 33) * 6.28, s: 0.8 + hash(k, 34) * 0.5, y: WATER_Y, mid: true });
  }
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2 + hash(k, 41) * 0.2;
    const x = POND.x + Math.cos(a) * POND.rx * (0.98 + hash(k, 42) * 0.1); const z = POND.z + Math.sin(a) * POND.rz * (0.98 + hash(k, 42) * 0.1);
    if (Math.abs(z - POND_DOCK.z) < 2.2 && x > POND.x) continue;
    out.push({ key: 'prop:reeds', x, z, yaw: a * 3, s: 0.8 + hash(k, 43) * 0.6, y: Math.max(heightAt(x, z), WATER_Y) - 0.1, mid: true });
    if (hash(k, 44) < 0.35) out.push({ key: 'debris:rock', x: x + 0.4, z: z + 0.3, yaw: a, s: 0.35 + hash(k, 45) * 0.2, y: Math.max(heightAt(x, z), WATER_Y - 0.1) - 0.1, mid: true, color: ROCK });
  }
  // a bench on the north bank facing the water, a lantern by it
  out.push({ key: 'prop:bench', x: POND.x + 1.5, z: POND.z - POND.rz * 1.25, yaw: 0, s: 1 });
  out.push({ key: 'decor:lantern', x: POND.x + 3.2, z: POND.z - POND.rz * 1.22, yaw: 0, s: 1, light: 1.9 });
  return out;
}
function paddockItems() {
  const out = [];
  // the white rail fence round the outside of the track, a gate gap toward the farm (east)
  const R = { rx: RIDING.rx + 2.1, rz: RIDING.rz + 2.1 };
  const n = 30;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2; const a1 = ((k + 1) / n) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a0), Math.cos(a0))) < 0.12) continue;           // the gate (+x, toward the farm)
    const x0 = RIDING.x + Math.cos(a0) * R.rx; const z0 = RIDING.z + Math.sin(a0) * R.rz;
    const x1 = RIDING.x + Math.cos(a1) * R.rx; const z1 = RIDING.z + Math.sin(a1) * R.rz;
    const len = Math.hypot(x1 - x0, z1 - z0);
    out.push({ key: 'hh-white-rail', x: x0, z: z0, yaw: -Math.atan2(z1 - z0, x1 - x0), s: 1, sx: len / 2.6 });
  }
  // the show ring inside: three jumps on a figure, the judges' box outside the track, spectators' benches, flags
  out.push({ key: 'prop:show_jump', x: RIDING.x - 3.2, z: RIDING.z - 1.8, yaw: 0.4, s: 1 });
  out.push({ key: 'prop:show_jump:2', x: RIDING.x + 3.0, z: RIDING.z + 1.6, yaw: -0.5, s: 1 });
  out.push({ key: 'prop:show_jump', x: RIDING.x + 0.4, z: RIDING.z - 4.2, yaw: 1.5, s: 0.9 });
  out.push({ key: 'prop:judges_box', x: RIDING.x - 2, z: RIDING.z + R.rz + 2.6, yaw: Math.PI, s: 1 });
  out.push({ key: 'hh-bench-plank', x: RIDING.x + 4.5, z: RIDING.z + R.rz + 1.9, yaw: Math.PI, s: 1 });
  out.push({ key: 'hh-bench-plank', x: RIDING.x + 7.8, z: RIDING.z + R.rz + 1.2, yaw: Math.PI - 0.3, s: 1 });
  out.push({ key: 'prop:trough', x: RIDING.x + R.rx + 1.2, z: RIDING.z - 3.5, yaw: Math.PI / 2, s: 1 });
  out.push({ key: 'prop:hay_bale', x: RIDING.x - R.rx - 1.3, z: RIDING.z - 2, yaw: 0.3, s: 1 });
  out.push({ key: 'prop:hay_bale', x: RIDING.x - R.rx - 1.1, z: RIDING.z - 0.6, yaw: 1.2, s: 1 });
  return out;
}
function oliveTerraceItems() {
  const out = [];
  const T = TERRACES;
  const risers = terraceRisers();
  risers.forEach((rz, i) => {
    // the wall: 4 m sections along the riser (one gap in the middle for the steps)
    for (let x = T.x0 + 2; x < T.x1 - 1; x += 4) {
      if (Math.abs(x - 32) < 1.6) continue;
      out.push({ key: 'hh-stone-wall', x, z: T.z1 - i * T.step - 0.12, yaw: 0, s: 1, y: i * T.rise - 0.05 });
    }
    out.push({ key: 'hh-stone-steps', x: 32, z: T.z1 - i * T.step + 0.95, yaw: 0, s: 1, y: i * T.rise });
    // olive trees on the band above this wall: four to five, a lavender row at the wall's foot
    const zb = rz - T.step * 0.55;
    for (let k = 0; k < 5; k++) {
      const x = T.x0 + 4 + k * 8 + (hash(i, k) - 0.5) * 2.4;
      if (Math.abs(x - 32) < 2.2) continue;
      out.push({ key: 'prop:olive_tree', x, z: zb + (hash(k, i + 5) - 0.5) * 1.6, yaw: hash(i * 7 + k, 9) * 6.28, s: 0.85 + hash(k, i) * 0.3 });
    }
    for (let x = T.x0 + 3; x < T.x1 - 2; x += 1.6) if (Math.abs(x - 32) > 1.4 && hash(Math.round(x * 3), i) < 0.5) {
      out.push({ key: 'prop:flower_tuft', x, z: rz - 0.9, yaw: x, s: 1.2, mid: true, color: [0.85, 0.75, 1.15] });
    }
  });
  // a stone hut with a terracotta roof on the top band, and pots by the steps
  out.push({ key: 'prop:barrel', x: 34.2, z: risers[0] - 1.2, yaw: 0, s: 1, mid: true });
  return out;
}
function mapleRidgeItems() {
  const out = [];
  const [x0, z0, x1, z1] = FEATURE_ZONES.maple_ridge;
  for (let gz = z0 + 2; gz < z1; gz += 4.6) {
    for (let gx = x0 + 2; gx < x1; gx += 4.6) {
      const i = Math.round(gx * 17 + gz * 233);
      const x = gx + (hash(i, 1) - 0.5) * 3.4; const z = gz + (hash(i, 2) - 0.5) * 3.4;
      if (z > 6 && (x < 54 || x > 79)) continue;
      if (Math.hypot(x - LOOKOUT.x, z - LOOKOUT.z) < 4.5) continue;
      if (hash(i, 3) > 0.78) continue;
      out.push({ key: hash(i, 4) < 0.5 ? 'prop:red_maple' : 'prop:red_maple:2', x, z, yaw: hash(i, 5) * 6.28, s: 0.85 + hash(i, 6) * 0.45 });
    }
  }
  out.push({ key: 'prop:lookout', x: LOOKOUT.x, z: LOOKOUT.z, yaw: 0.35, s: 1 });
  out.push({ key: 'prop:bench', x: LOOKOUT.x + 3, z: LOOKOUT.z + 2.5, yaw: 0.2, s: 1 });
  return out;
}
/** The lookout's spot on the ridge (metres). */
export const LOOKOUT = Object.freeze({ x: 65, z: -11 });
function sunsetHillItems() {
  const out = [];
  out.push({ key: 'prop:oak', x: SUMMIT.x - 1.5, z: SUMMIT.z - 1.5, yaw: 0.6, s: 1.15 });
  out.push({ key: 'prop:bench', x: SUMMIT.x + 1.4, z: SUMMIT.z + 2.2, yaw: 0.1, s: 1 });
  out.push({ key: 'decor:lantern', x: SUMMIT.x + 3.1, z: SUMMIT.z + 2.2, yaw: 0, s: 1, light: 1.9 });
  // shrubs and boulders down the flanks, the woods closing in at the sides
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2 + hash(k, 61) * 0.25;
    const r = SUMMIT.top + 3 + hash(k, 62) * (SUMMIT.r - SUMMIT.top);
    const x = SUMMIT.x + Math.cos(a) * r; const z = SUMMIT.z + Math.sin(a) * r;
    if (z > 7 || x < 80 || x > 116) continue;
    const t = hash(k, 63);
    // the path up the south face stays clear
    if (Math.abs(x - 99) < 3 && z > SUMMIT.z) continue;
    if (t < 0.3) out.push({ key: `prop:forest_round_${1 + (k % 3)}`, x, z, yaw: a, s: 0.8 + hash(k, 64) * 0.4 });
    else if (t < 0.55) out.push({ key: 'debris:boulder', x, z, yaw: a, s: 0.5 + hash(k, 65) * 0.3, color: ROCK, sy: 0.75 });
    else out.push({ key: `prop:bush_${1 + (k & 1)}`, x, z, yaw: a, s: 1 + hash(k, 66) * 0.5, mid: true });
  }
  for (let k = 0; k < 18; k++) {
    const a = hash(k, 71) * Math.PI * 2; const r = hash(k, 72) * SUMMIT.top * 1.6;
    out.push({ key: 'prop:flower_tuft', x: SUMMIT.x + Math.cos(a) * r, z: SUMMIT.z + Math.sin(a) * r, yaw: a, s: 1.3, mid: true, color: [1.25, 0.65, 0.5] });
  }
  return out;
}
function goatRocksItems() {
  const out = [];
  // three outcrops of stepped ledges with hardy pines and shrubs among them
  [[120, 38.5, 0.4, 1.0], [123.5, 48.5, 2.2, 1.2], [119.5, 58, 4.1, 0.9]].forEach(([cx, cz, yaw, s], k0) => {
    out.push({ key: k0 % 2 ? 'prop:outcrop:2' : 'prop:outcrop', x: cx, z: cz, yaw, s, y: heightAt(cx, cz) - 0.25 });
    out.push({ key: 'prop:forest_pine_2', x: cx + 3.2, z: cz + 2.6, yaw: k0, s: 0.75 });
    out.push({ key: `prop:bush_${1 + (k0 & 1)}`, x: cx - 3.0, z: cz + 1.8, yaw: k0, s: 1.1, mid: true });
    out.push({ key: 'prop:flower_tuft', x: cx + 1.5, z: cz + 3.2, yaw: k0, s: 1.3, mid: true, color: [0.85, 0.75, 1.15] });
  });
  return out;
}
function walnutGroveItems() {
  const out = [];
  const P = PLACES.picnic;
  const tree = models.has('tree:walnut_tree:mature') ? 'tree:walnut_tree:mature' : 'prop:walnut_old';
  out.push({ key: tree, x: P.x + 2.5, z: P.z - 5.2, yaw: 0.8, s: tree.startsWith('tree:') ? 1.5 : 1.15 });
  out.push({ key: tree, x: P.x + 3.6, z: P.z + 4.8, yaw: 2.2, s: tree.startsWith('tree:') ? 1.35 : 1.05 });
  out.push({ key: 'prop:rope_swing', x: P.x + 2.5 - 1.2, z: P.z - 5.2 + 0.6, yaw: 0.3, s: 1 });
  // flat on the grass (the default sink of 5 cm would bury a blanket)
  out.push({ key: 'prop:picnic', x: P.x - 0.8, z: P.z + 0.4, yaw: 0.25, s: 1, y: heightAt(P.x - 0.8, P.z + 0.4) + 0.01, mid: true });
  out.push({ key: 'hh-log', x: P.x - 1.6, z: P.z - 2.2, yaw: 0.15, s: 1 });
  for (let k = 0; k < 10; k++) {
    const a = hash(k, 81) * Math.PI * 2; const r = 4 + hash(k, 82) * 3;
    out.push({ key: k % 3 ? 'prop:flower_tuft' : `prop:bush_${1 + (k & 1)}`, x: P.x + Math.cos(a) * r, z: P.z + Math.sin(a) * r * 1.1, yaw: a, s: 1.1 + hash(k, 83) * 0.4, mid: true });
  }
  return out;
}
function pigWoodsItems() {
  const out = [];
  for (const [x, z, s] of [[116.5, 95, 1.0], [121.5, 98, 1.15], [117, 103.5, 0.95], [124.5, 106, 1.2], [118.5, 110.5, 1.05], [127, 96.5, 0.9]]) {
    out.push({ key: 'prop:oak', x, z, yaw: x * 1.7, s });
  }
  out.push({ key: 'hh-log', x: 120, z: 101.5, yaw: 0.7, s: 1 });
  for (let k = 0; k < 9; k++) out.push({ key: `prop:bush_${1 + (k & 1)}`, x: 115 + hash(k, 91) * 14, z: 94 + hash(k, 92) * 19, yaw: k, s: 1 + hash(k, 93) * 0.4, mid: true });
  return out;
}
function fairLaneItems() {
  return [{ key: 'prop:fingerpost', x: 13.6, z: 115.6, yaw: Math.PI / 2 - 0.2, s: 1 }, { key: 'prop:ribbon_shelf', x: 8.5, z: 114.6, yaw: Math.PI, s: 1 }];
}
const ITEMS = { willow_pond: willowPondItems, stable_paddock: paddockItems, olive_terrace: oliveTerraceItems, maple_ridge: mapleRidgeItems,
  sunset_hill: sunsetHillItems, goat_rocks: goatRocksItems, walnut_grove: walnutGroveItems, pig_woods: pigWoodsItems, fair_lane: fairLaneItems };

const cache = new Map();
/** What a feature zone shows: its feature when the parcel is the farm's, else its wild state (pure, cached). */
export function featureItems(id, owned) {
  const k = `${id}|${owned ? 1 : 0}`;
  if (!cache.has(k)) cache.set(k, owned ? (ITEMS[id] ? ITEMS[id]() : []) : wildItems(id));
  return cache.get(k);
}

// ---------------------------------------------------------------------------------------------------
export function createLandFeatures({ scenery, mid = null, glows = null, fx = null }) {
  const midB = mid || scenery;
  const handles = new Map();         // zone id -> [{ b, h }]
  const ownedNow = new Map();        // zone id -> bool (null before the first look)
  let owners = new Set();
  let fishingLive = false;
  let showLive = false;
  let watched = false;
  let casts = [];                    // { x, z, until } rings on the pond after a cast
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const L = POND_DOCK.len;
  const dockBox = new THREE.Box3(new THREE.Vector3(POND_DOCK.x - L - 0.4, -1, POND_DOCK.z - 1.4), new THREE.Vector3(POND_DOCK.x + 0.6, 2.2, POND_DOCK.z + 1.4));
  const ringBox = new THREE.Box3(new THREE.Vector3(RIDING.x - RIDING.rx - 2.5, -0.5, RIDING.z - RIDING.rz - 2.5), new THREE.Vector3(RIDING.x + RIDING.rx + 2.5, 3, RIDING.z + RIDING.rz + 5));

  const keyFor = (batch, key) => {
    const st = STAND_INS[key];
    if (!st) return key;                               // render-life's own (prop:reeds, debris:boulder ...)
    return modelKey(batch, key, st).key;
  };

  function build(id, owned) {
    for (const { b, h } of handles.get(id) || []) b.remove(h);
    const list = [];
    const lights = [];
    for (const it of featureItems(id, owned)) {
      const b = it.mid ? midB : scenery;
      const key = keyFor(b, it.key);
      if (!STAND_INS[it.key] && !models.has(key)) continue;
      q.setFromAxisAngle(Y, it.yaw || 0);
      const s = it.s || 1;
      sc.set(s * (it.sx || 1), s * (it.sy || 1), s);
      m4.compose(v.set(it.x, it.y ?? heightAt(it.x, it.z) - 0.05, it.z), q, sc);
      list.push({ b, h: b.add(key, m4, it.color ? new THREE.Color(...it.color) : null) });
      if (it.light) lights.push({ pos: new THREE.Vector3(it.x, (it.y ?? heightAt(it.x, it.z)) + it.light, it.z), size: 1.6, color: LAMP, billboard: true },
        { pos: new THREE.Vector3(it.x, (it.y ?? heightAt(it.x, it.z)) + 0.05, it.z), size: 3.2, color: LAMP, billboard: false });
    }
    if (id === 'willow_pond' && owned) {
      // the lantern at the dock's end
      lights.push({ pos: new THREE.Vector3(POND_DOCK.x - L + 0.2, DOCK_DECK + 2.0, POND_DOCK.z - 0.7), size: 1.6, color: LAMP, billboard: true },
        { pos: new THREE.Vector3(POND_DOCK.x - L + 0.4, WATER_Y + 0.05, POND_DOCK.z - 0.7), size: 3.0, color: LAMP, billboard: false });
    }
    if (glows) glows.set(`world:land:${id}`, lights.length ? lights : null);
    handles.set(id, list);
  }

  function apply(state, now) {
    const exp = new Set(Array.isArray(state?.farm?.expansions) ? state.farm.expansions : []);
    const next = new Set(exp);
    for (const p of restoreDone(state, now)) next.add(`restore:${p}`);
    owners = next;
    fishingLive = exp.has('willow_pond') && featureLive(state, 'fishing');
    showLive = exp.has('stable_paddock') && featureLive(state, 'horse_show');
    for (const id of Object.keys(FEATURE_ZONES)) {
      const own = exp.has(id);
      if (ownedNow.get(id) === own) continue;
      const was = ownedNow.get(id);
      // buying the parcel clears its wild zone: a puff of dust per tree (the farm's own clearing moment, ground.js)
      if (watched && was === false && own && fx) {
        featureItems(id, false).filter((w) => !w.mid).slice(0, 18).forEach((w, k) => {
          const pos = new THREE.Vector3(w.x, heightAt(w.x, w.z), w.z);
          setTimeout(() => fx.play({ e: 'cleared' }, pos), k * 50);
        });
      }
      ownedNow.set(id, own);
      build(id, own);
    }
    watched = true;
  }

  return {
    setState(state, now) { watched = false; apply(state, now); },
    sync(ids, topics, state, now) { if (topics.has('*') || topics.has('expansions') || topics.has('xp') || topics.has('restore')) apply(state, now); },
    update(dt, now) {
      if (!casts.length) return 0;
      const t = Date.now();
      casts = casts.filter((c) => c.until > t);
      return casts.length ? 1 : 0;
    },
    places() {
      // the client seats the farmers on the dock's end (fishing.js reads placeArgs.seats: tiles and facing)
      return [{ place: 'fishing', args: { pond: 'willow_pond', seats: dockSeats().map((q) => ({ x: q.x / TILE_M, z: q.z / TILE_M, f: q.face })) }, box: dockBox, live: fishingLive },
        { place: 'horseshow', args: {}, box: ringBox, live: showLive }];
    },
    owners() { return owners; },
    /** A cast or a catch at the dock (rules/fx events whose name speaks of fishing): rings where the float went in. */
    onEvent(ev) {
      if (!ev || typeof ev.e !== 'string' || !/fish|cast|catch|caught|reel/i.test(ev.e)) return false;
      const seat = dockSeats()[casts.length % 2];
      const x = seat.x - 2.2 - Math.random() * 1.2; const z = seat.z + (Math.random() - 0.5) * 2;
      casts.push({ x, z, until: Date.now() + 9000 });
      if (fx) fx.burst?.('droplet', new THREE.Vector3(x, WATER_Y, z), { n: 6, color: '#D6F1FF', speed: 0.8, up: 1.2, size: 0.09, grav: 0.9, life: 0.5, y: 0, ambient: true });
      return true;
    },
    ripples() {
      const out = [];
      // soft rings round the two end piles that stand in the water
      if (ownedNow.get('willow_pond')) for (const sz of [-0.77, 0.77]) { const x = POND_DOCK.x - 0.4 - (L - 0.6); out.push([x, POND_DOCK.z + sz, x, POND_DOCK.z + sz, 0.1]); }
      for (const c of casts.slice(-2)) out.push([c.x, c.z, c.x, c.z, 0.06]);
      return out;
    },
    stats() {
      let n = 0;
      for (const l of handles.values()) n += l.length;
      return { owned: [...ownedNow].filter(([, o]) => o).map(([k]) => k), instances: n, fishing: fishingLive, horseshow: showLive };
    },
  };
}

const LAMP = new THREE.Color('#FFD27A');
/** Restoration projects done (their land features: the Orchard Pond's path), from the state (no import cycle). */
function restoreDone(state, now) {
  const r = state?.farm?.restore || null;
  const out = [];
  if (!r) return out;
  for (const [id, rec] of Object.entries(r)) if (rec && (rec.done === true || (Number.isFinite(rec.done) && rec.done <= now))) out.push(id);
  return out;
}
void CONTENT; void lin;
