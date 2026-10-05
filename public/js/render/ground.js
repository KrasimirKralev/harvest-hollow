// Terrain, the painted ground, land ownership, water and the build grid (tech §10.2, visual-ux-juice §3.5,
// §4.7, §4.9; GDD §2.1-2.4, §8.1). Owned by the render-world lane.
//
// One terrain mesh (flat farm, gentle hills in the decorative ring, a river along the south edge widening
// into a lake past the south-east corner) drawn with ONE Lambert material whose fragment shader paints the
// ground: two-tone lawn with colour noise, mowing stripes and blade detail on owned land; desaturated, hazy
// wild meadow on land for sale; darker forest floor on the hills; sand banks; worn dirt paths from the
// ground-layer path objects; a soft footprint AO under every placed object; drifting cloud shadows; season
// and rain tints; and, in build mode, the tile grid. No extra draw calls for any of that: it all comes from
// two small data textures. The drag-paint highlight floats above the soil as one instanced draw.
//
//   heightAt(x, z) -> metres            terrain height (pure; 0 on the farm)
//   landTiles(expansionIds, liveIds?, extraRects?) -> Uint8Array(64*64)   0 outside the farm, 1 owned, 2 for sale (a
//                                       live expansion not owned), 3 later land (pure); extraRects = land a restoration
//                                       gave the farm (the Hollow Meadow), owned
//   PLACES / TRACKS / padMask(x, z) / laneZ(x)   the world places' layout and flat pads (wave 2)
//   boundaryEdges(tiles) -> [[x0, z0, x1, z1]]               tile edges between owned and other land (pure)
//   saleSigns(expansionIds) -> [{ id, x, z, rot }]          one signpost per live, unowned expansion (pure)
//   liveUnionDist(x, z) -> metres     distance from a point to the land the farm owns or can buy (every live
//                                       expansion rect), 0 inside it (pure; the forest edge, scene.js)
//   wildOnSale(land, signs) -> [{ key, x, z, yaw, s, exp }]   the overgrowth on live land for sale (pure, tested)
//   cheapShadows(shader)                a 2-tap hardware-PCF shadow lookup instead of three's 5-tap Vogel disk
//                                       (onBeforeCompile helper for the ground, tufts and soil: performance-04)
//   addOcclusionFade(material, groundMap) scenery that stands between the camera and the OWNED farm dithers
//                                       away (the forest wall never hides a plot)
//   createGround(layers, { scenery, quality }) -> ground
//     ground.setState(state) / ground.sync(ids, topics, state) / ground.setFx(fx) (the "clear the forest" moment)
//     ground.grid(visible) / ground.gridFocus(x, z | null) / ground.highlight(tiles, style) / ground.update(dt)
//     ground.setHaze(linearRgb) / ground.setQuality(q) / ground.expansionAt(x, z) -> id | null
//     ground.ownedAt(x, z) -> boolean / ground.bounds() -> { x0, z0, x1, z1 } owned land in tiles
//     ground.setBlobShadows(sunDir [x, y, z] | null)   mobile wave: a device without a shadow map paints a soft blob
//                                       shadow beside every tall object into the footprint AO, cast away from the sun
//                                       (the direction is snapped to 10 deg; null removes them)
//   blobShadow(o, w, d, height, sunDir) -> { cx, cz, ux, uz, la, lb, k } | null   one blob in metres (pure, tested)
import * as THREE from 'three';
import { CONTENT, defOf, isLive } from '../../../shared/content/index.js';
import { TILE_M, WORLD_TILES, FARM_MIN, FARM_MAX } from '../../../shared/content/config.js';
import { footprint } from '../../../shared/rules/grid.js';
import * as grid from '../../../shared/rules/grid.js';
import { models, addShaderPatch, LOOK, LAMPS_PARS, LAMPS_FRAG } from './models.js';
import { WORLD, addSway, addFoliageTint } from './world-uniforms.js';
import { rewardLandRects, liveNow } from './world-state.js';

export const WATER_Y = -0.45;
const W = WORLD_TILES * TILE_M;                 // 128 m
const N = WORLD_TILES;

// ---------------------------------------------------------------------------------------------------
// Deterministic noise (no Math.random: both screens and every reload draw the same world)
function hash2(ix, iz) {
  // murmur3 fmix32 over a linear combination: neighbouring keys decorrelate fully
  let h = (Math.imul(ix | 0, 0x27d4eb2d) + Math.imul(iz | 0, 0x165667b1) + 0x9e3779b9) | 0;
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);
/** Value noise in [0, 1). */
export function noise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
export function fbm(x, z, oct = 4) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  let n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f + i * 17.3, z * f - i * 9.1); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** River centre line (z, metres) at x: along the south edge, past the farm's last row. It swings south below
 *  the greenhouse (x ~ 30) so Grandma's glasshouse has flat ground between the lane and the bank. */
export const riverZ = (x) => 138 + 4.5 * Math.sin(x * 0.024 + 1.3) + 2 * Math.sin(x * 0.061) + 3.5 * Math.exp(-(((x - 30) / 15) ** 2));
export const riverHalf = (x) => 7.5 + 1.6 * Math.sin(x * 0.043 + 0.7);
export const LAKE = Object.freeze({ x: 176, z: 168, r: 30 });
export const ROAD_Z = 120;                       // the country lane between the farm and the river
export const BRIDGE_X = 64;
/** The lane's centre line (z, metres) at x: it wanders a little (the painted lane and everything that avoids it). */
export const laneZ = (x) => ROAD_Z + 1.2 * Math.sin(x * 0.05);

/**
 * The M1b world places around the farm (GDD §2.2, §5.6-5.9), in metres. Each sits on a flat pad (`heightAt`
 * flattens it, the forest keeps off it, the ground shader paints it): the County Fair grounds beyond the lower-left
 * by the lane (Fairground Lane, expansion 6, leads there), Captain Reed's barge jetty on the river below the
 * Riverbank (expansion 7), Grandma's old greenhouse by the river and the old water mill on the far bank (its wheel
 * turns in full view of the farm), the Hollow Meadow beyond
 * the north-west edge (Restoration 3's land) and the Hollow Village across the river. `pad` = [cx, cz, hx, hz, r].
 */
export const PLACES = Object.freeze({
  fair: Object.freeze({ x: -13, z: 106, pad: [-13, 106, 17, 13, 7] }),
  jetty: Object.freeze({ x: 46, z: 127.5, pad: [46, 126, 6, 4, 3] }),
  greenhouse: Object.freeze({ x: 29, z: 128.5, pad: [29, 128.5, 9, 6, 3] }),
  mill: Object.freeze({ x: 100, z: 145.4, pad: [100, 147.5, 6, 3.4, 3] }),
  meadow: Object.freeze({ x: 8, z: 32, pad: [8, 32, 9, 17, 4] }),
  village: Object.freeze({ x: 70, z: 172, pad: [70, 172, 58, 25, 10] }),
  // wave 3 (M2): the Stable Paddock's riding track and horse-show ring west of the farm (GDD §3.9 #11), the Walnut
  // Grove's picnic clearing east of it (#12), and the Orchard Pond's windpump in the north-east corner (Restoration 4)
  paddock: Object.freeze({ x: -1, z: 83, pad: [-1, 83, 13, 11.5, 4] }),
  picnic: Object.freeze({ x: 121, z: 80, pad: [121, 80, 6.5, 8, 3] }),
  orchard: Object.freeze({ x: 121.5, z: 10, pad: [121.5, 10, 9.5, 7, 3] }),
});
/** Dirt tracks from the lane to the places: [x0, z0, x1, z1] (metres), painted ~2.4 m wide. */
export const TRACKS = Object.freeze([
  [46, 121, 46, 131.5], [29, 121.5, 29, 124.6], [100, 148.5, 100, 158.5], [-13, 120.5, -13, 112],
  // the Hollow Village's river road, both sides of the main street
  [14, 159.5, 64, 157.5], [64, 157.5, 128, 159.5],
]);
/** Wave 3 (M2) tracks that appear with their expansion or project: [x0, z0, x1, z1, owner] (owner = expansion id or
 *  'restore:<id>'): the path up the Sunset Hill, through the picnic clearing, round the Willow Pond and to the
 *  Orchard Pond's windpump. Painted like TRACKS, only while their owner is the farm's. */
export const FEATURE_TRACKS = Object.freeze([
  Object.freeze([104, 13, 99, 2, 'sunset_hill']), Object.freeze([99, 2, 96, -6, 'sunset_hill']),
  Object.freeze([113, 84.5, 119, 83.5, 'walnut_grove']), Object.freeze([15.5, 57, 13.6, 51.5, 'willow_pond']),
  Object.freeze([114, 14, 121, 11, 'restore:orchard_pond']),
]);

/** The ground shader's pads, in uniform order: the five M1b places, then the M2 pads that show once owned. */
export const PAD_KEYS = Object.freeze(['fair', 'jetty', 'greenhouse', 'mill', 'village', 'paddock', 'picnic', 'orchard']);
/** Shader-only mown pads (no flattening): the Olive Terrace's bands and Sunset Hill's crest, once owned. */
export const MOWN_PADS = Object.freeze({ terrace: Object.freeze([32, -5.5, 18.5, 13.4, 2]), summit: Object.freeze([97, -7, 6.5, 6.5, 6]) });
/** Who owns each M2 pad (an expansion id or 'restore:<id>'). */
export const PAD_OWNER = Object.freeze({ paddock: 'stable_paddock', picnic: 'walnut_grove', orchard: 'restore:orchard_pond', terrace: 'olive_terrace',
  summit: 'sunset_hill' });
/** The Stable Paddock's oval riding track (centre line, metres) round the horse-show ring, on the paddock pad. */
export const RIDING = Object.freeze({ x: -1, z: 83, rx: 10.2, rz: 8.6 });

/** The Willow Pond (GDD §3.9 #9, "a large pond with dock, lily pads"): an oval carved into the ring beside the
 *  parcel's west edge, south of the Hollow Meadow (the farm board stays flat, GDD §2.4). Metres. */
export const POND = Object.freeze({ x: 7, z: 58.8, rx: 6.3, rz: 7.2 });
/** The Willow Pond's fishing dock (GDD §6.2 #21): it leaves the farm through a gap in the fence on the west edge of
 *  tile (tx, tz) and runs `len` m west over the water; the fishing spot is that edge tile. */
export const POND_DOCK = Object.freeze({ tx: 8, tz: 28, x: 16, z: 57, len: 6.4 });
/** The Orchard Pond (Restoration 4): a round pond on its pad in the north-east corner, fed by a windpump. */
export const ORCHARD_POND = Object.freeze({ x: 127.5, z: 9.5, rx: 4.3, rz: 3.5 });
/** The Olive Terrace (GDD §3.9 #13, "terraced slope, stone steps"): `n` flat bands climbing the hill north of the
 *  parcel, each `rise` m above the last, `step` m deep, with a dry-stone riser at each band's south edge. */
export const TERRACES = Object.freeze({ x0: 14, x1: 50, z1: 7.5, step: 6.5, rise: 1.3, n: 4, feather: 7, riser: 0.1 });
/** Sunset Hill's summit (GDD §2.4 "the hilltop of Sunset Hill", §3.9 #15): a round grassy crest behind the parcel,
 *  flat on top for the lone tree and the bench. */
export const SUMMIT = Object.freeze({ x: 97, z: -7, r: 17, h: 8.5, top: 4 });

/** Where the terraces' risers are (z of each wall's middle, south to north), metres (pure). */
export function terraceRisers() {
  const T = TERRACES;
  return Array.from({ length: T.n }, (_, i) => T.z1 - (i + T.riser * 0.5) * T.step);
}

/** The terrace height at (x, z) given the natural hill height h (pure; h unchanged outside the terraces). */
function terraceAt(h, x, z) {
  const T = TERRACES;
  const u = (T.z1 - z) / T.step;                 // 0 at the first riser, n at the top band's north edge
  if (u < -0.2 || u > T.n + 2 || x < T.x0 - T.feather || x > T.x1 + T.feather) return h;
  const mx = smoothstep(T.x0 - T.feather, T.x0, x) * smoothstep(T.x1 + T.feather, T.x1, x);
  const top = T.n * T.rise;
  let lev;
  if (u <= 0) lev = 0;
  else if (u < T.n) { const i = Math.floor(u); lev = (i + smoothstep(0, T.riser, u - i)) * T.rise; } else lev = top;
  // above the top band the terrace hands back to the hill (never below the top band: no ditch)
  if (u > T.n) lev = Math.max(top, top + (h - top) * smoothstep(T.n, T.n + 1.6, u));
  return h + (lev - h) * mx;
}

/** Ellipse distance (1 on the rim) of (x, z) from a pond. */
const pondE = (P, x, z) => Math.hypot((x - P.x) / P.rx, (z - P.z) / P.rz);
/** Carve a pond into the height h: a soft basin, the bank sloping in from 1.32 of the radius (pure). */
function pondAt(h, P, x, z) {
  const e = pondE(P, x, z);
  if (e > 1.4) return h;
  return h * smoothstep(0.85, 1.35, e) - 1.7 * smoothstep(1.18, 0.5, e);
}

/** Signed distance (metres) from a point to a rounded rectangle pad [cx, cz, hx, hz, r] (negative inside). */
export function padDist(x, z, [cx, cz, hx, hz, r]) {
  const qx = Math.abs(x - cx) - hx + r;
  const qz = Math.abs(z - cz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}

/** 1 on a place's flat pad, easing to 0 over `feather` metres outside it (pure). */
export function padMask(x, z, feather = 9) {
  let m = 0;
  for (const p of Object.values(PLACES)) {
    const d = padDist(x, z, p.pad);
    if (d < feather) m = Math.max(m, d <= 0 ? 1 : smoothstep(feather, 0, d));
  }
  return m;
}

/** Terrain height in metres. 0 on the farm and its margin; hills, river and lake outside. Pure. */
export function heightAt(x, z) {
  const m = 10;                                  // flat margin around the farmable square
  const x0 = FARM_MIN * TILE_M - m;
  const x1 = FARM_MAX * TILE_M + m;
  const dx = Math.max(x0 - x, 0, x - x1);
  const dzN = Math.max(x0 - z, 0);
  const dzS = Math.max(z - x1, 0);
  // Hills rise in the west, north and east; the south stays low for the lane, the river and the village.
  const out = Math.hypot(dx, dzN);
  const south = smoothstep(0, 20, dzS);
  // the bank rises right behind the forest edge: depth in every direction (visual-01)
  const hillMask = smoothstep(0, 40, out) * (1 - south * smoothstep(20, 0, dx)) + smoothstep(70, 140, dzS) * 0.8;
  const hills = (0.35 + 0.65 * fbm(x * 0.011, z * 0.011)) * 26 * hillMask;
  const bumps = (fbm(x * 0.06, z * 0.06, 2) - 0.5) * 1.2 * smoothstep(2, 20, Math.max(out, dzS));
  // the world places stand on flat ground (the river and the lake are carved after this)
  let h = (hills + bumps) * (1 - padMask(x, z));
  // wave 3 (M2): the Olive Terrace's bands, Sunset Hill's crest, the Willow Pond and the Orchard Pond
  if (z < 10) {
    h = terraceAt(h, x, z);
    const ds = Math.hypot(x - SUMMIT.x, z - SUMMIT.z);
    if (ds < SUMMIT.r) h = Math.max(h, SUMMIT.h * (1 - smoothstep(SUMMIT.top, SUMMIT.r, ds)) - 0.25 * (fbm(x * 0.2, z * 0.2, 2) - 0.5) * smoothstep(SUMMIT.top, SUMMIT.r, ds));
  }
  if (x > 118 && z < 16) h = pondAt(h, ORCHARD_POND, x, z);
  else if (x < 18 && z > 44 && z < 74) h = pondAt(h, POND, x, z);
  // River: a soft channel with sloping banks.
  const rz = riverZ(x);
  const hw = riverHalf(x);
  const dr = Math.abs(z - rz);
  if (dr < hw + 7) h = h * smoothstep(hw - 1, hw + 7, dr) + -2.3 * smoothstep(hw + 5, hw - 2, dr);
  // Lake past the south-east corner.
  const dl = Math.hypot(x - LAKE.x, (z - LAKE.z) * 1.25) - (LAKE.r + 5 * (noise2(x * 0.05, z * 0.05) - 0.5));
  if (dl < 8) h = Math.min(h, h * smoothstep(-1, 8, dl) + -2.6 * smoothstep(6, -3, dl));
  return h;
}

// ---------------------------------------------------------------------------------------------------
// Land ownership (pure)
function fill(tiles, rects, v, only = null) {
  for (const [x, z, w, d] of rects) {
    for (let j = z; j < z + d; j++) for (let i = x; i < x + w; i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      if (only === null || tiles[j * N + i] === only) tiles[j * N + i] = v;
    }
  }
}

/** Per tile: 0 outside the farmable square, 1 owned, 2 for sale (live, not owned), 3 later land. */
export function landTiles(expansionIds, live = (e) => liveNow(e), extraRects = []) {
  const t = new Uint8Array(N * N);
  fill(t, [[FARM_MIN, FARM_MIN, FARM_MAX - FARM_MIN, FARM_MAX - FARM_MIN]], 3);
  const owned = new Set(expansionIds);
  for (const e of CONTENT.expansions.values()) if (!owned.has(e.id) && live(e)) fill(t, e.rects, 2);
  for (const id of owned) { const e = CONTENT.expansions.get(id); if (e) fill(t, e.rects, 1); }
  if (extraRects && extraRects.length) fill(t, extraRects, 1);
  return t;
}

/** Tile edges where owned land meets anything else: [x0, z0, x1, z1] in tile units (axis-aligned, length 1). */
export function boundaryEdges(tiles) {
  const own = (x, z) => x >= 0 && z >= 0 && x < N && z < N && tiles[z * N + x] === 1;
  const out = [];
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (!own(x, z)) continue;
      if (!own(x, z - 1)) out.push([x, z, x + 1, z]);
      if (!own(x, z + 1)) out.push([x, z + 1, x + 1, z + 1]);
      if (!own(x - 1, z)) out.push([x, z, x, z + 1]);
      if (!own(x + 1, z)) out.push([x + 1, z, x + 1, z + 1]);
    }
  }
  return out;
}

/**
 * One "For sale" signpost per live, unowned expansion, on its tile nearest the owned land's centre, facing it.
 * Returns tiles (float centre) and a rotation in quarter turns.
 */
export function saleSigns(expansionIds) {
  const owned = new Set(expansionIds);
  let cx = 0;
  let cz = 0;
  let n = 0;
  for (const id of owned) {
    const e = CONTENT.expansions.get(id);
    if (!e) continue;
    for (const [x, z, w, d] of e.rects) { cx += (x + w / 2) * w * d; cz += (z + d / 2) * w * d; n += w * d; }
  }
  if (!n) return [];
  cx /= n; cz /= n;
  const out = [];
  for (const e of CONTENT.expansions.values()) {
    if (owned.has(e.id) || !liveNow(e)) continue;
    let best = null;
    for (const [x, z, w, d] of e.rects) {
      // the tile of the rect closest to the owned centre, kept one tile inside the rect
      const tx = Math.min(x + w - 2, Math.max(x + 1, Math.floor(cx)));
      const tz = Math.min(z + d - 2, Math.max(z + 1, Math.floor(cz)));
      const dd = (tx + 0.5 - cx) ** 2 + (tz + 0.5 - cz) ** 2;
      if (!best || dd < best.dd) best = { x: tx + 0.5, z: tz + 0.5, dd };
    }
    if (!best) continue;
    const ang = Math.atan2(cx - best.x, cz - best.z);                 // face the farm
    out.push({ id: e.id, x: best.x, z: best.z, rot: ((Math.round(ang / (Math.PI / 2)) % 4) + 4) % 4, yaw: ang });
  }
  return out;
}

/** Live expansion rects (owned or for sale) in metres [x0, z0, x1, z1]. */
export function liveRects(live = (e) => liveNow(e)) {
  const out = [];
  for (const e of CONTENT.expansions.values()) {
    if (!live(e)) continue;
    for (const [x, z, w, d] of e.rects) out.push([x * TILE_M, z * TILE_M, (x + w) * TILE_M, (z + d) * TILE_M]);
  }
  return out;
}

/** Distance (metres) from a point to the union of rects (0 inside one). Pure. */
export function liveUnionDist(x, z, rects) {
  let best = Infinity;
  for (const [x0, z0, x1, z1] of rects) {
    const dx = Math.max(x0 - x, 0, x - x1);
    const dz = Math.max(z0 - z, 0, z - z1);
    best = Math.min(best, Math.hypot(dx, dz));
    if (best === 0) return 0;
  }
  return best;
}

/**
 * The overgrowth on live land for sale (visual-01: FV2's "clear the forest"): trees and bushes at ~0.6 of the
 * forest's density, 2 tiles clear of the owned land and of the signposts, gone when the parcel is bought.
 * Pure: [{ key, x, z, yaw, s, exp }] in metres; `exp` is the expansion the item stands on.
 */
export function wildOnSale(land, signs, expansionOf) {
  const out = [];
  const CELL = 4.2;
  for (let gz = FARM_MIN * TILE_M; gz < FARM_MAX * TILE_M; gz += CELL) {
    for (let gx = FARM_MIN * TILE_M; gx < FARM_MAX * TILE_M; gx += CELL) {
      const i = Math.round(gx * 13 + gz * 197);
      const x = gx + CELL / 2 + (hash2(i, 711) - 0.5) * CELL * 0.85;
      const z = gz + CELL / 2 + (hash2(i, 712) - 0.5) * CELL * 0.85;
      const tx = Math.floor(x / TILE_M); const tz = Math.floor(z / TILE_M);
      if (tx < 0 || tz < 0 || tx >= N || tz >= N || land[tz * N + tx] !== 2) continue;
      let nearOwned = false;
      for (let dz = -2; dz <= 2 && !nearOwned; dz++) for (let dx = -2; dx <= 2; dx++) {
        const i2 = tx + dx; const j2 = tz + dz;
        if (i2 >= 0 && j2 >= 0 && i2 < N && j2 < N && land[j2 * N + i2] === 1) { nearOwned = true; break; }
      }
      if (nearOwned || signs.some((sg) => Math.hypot(sg.x * TILE_M - x, sg.z * TILE_M - z) < 4)) continue;
      const r = hash2(i, 713);
      if (r > 0.6) continue;
      const key = r < 0.2 ? `prop:forest_pine_${1 + (i & 1)}` : r < 0.32 ? `prop:forest_round_${1 + (i % 3)}` : r < 0.52 ? `prop:bush_${1 + (i & 1)}`
        : r < 0.57 ? `prop:rock_${1 + (i & 1)}` : 'prop:flower_tuft';
      const big = key.includes('pine') ? 0.8 + hash2(i, 714) * 0.5 : key.includes('round') ? 0.7 + hash2(i, 714) * 0.35
        : key.includes('flower') ? 1.4 : 0.85 + hash2(i, 714) * 0.6;
      out.push({ key, x, z, yaw: hash2(i, 715) * Math.PI * 2, s: big, exp: expansionOf(tx, tz) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Painted textures (typed arrays: they run in node too)

/** How long the painted textures took to make at boot (ms; view.stats().groundBootMs, RD-08). */
export const GROUND_BOOT = { detailMs: 0 };

/** Detail, tileable over 7 m: R grass blades (grey around 0.5), G pebbles and grit for the dirt paths at three
 *  repeats (one texture read serves both: performance-04). RD-08 (QA wave 2): a quieter fine layer (the lawn read as a
 *  high-contrast mottle) under soft 0.5-2 m wear patches, painted straight into a typed array (no canvas: the 55,000
 *  canvas strokes cost ~470 ms of boot on the couple's PC; this is ~20 ms) and wrapping seamlessly at the tile edge. */
export function makeDetailTexture() {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const S = 512;
  const lum = new Float32Array(S * S).fill(128);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const at = (x, y) => (((y % S) + S) % S) * S + (((x % S) + S) % S);
  // soft wear patches 0.5-2 m across (73 px a metre): mown and lush, low contrast (a radial falloff, alpha 0.5 -> 0)
  for (let i = 0; i < 46; i++) {
    const cx = rnd() * S; const cy = rnd() * S; const r = 36 + rnd() * 70;
    const v = 128 + (rnd() - 0.5) * 22;
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
        if (d2 >= r2) continue;
        const a = 0.5 * (1 - Math.sqrt(d2) / r);
        const k = at(x, y);
        lum[k] += (v - lum[k]) * a;
      }
    }
  }
  // blade ticks: short strokes with soft edges, light tips and dark gaps, in every direction (the camera turns)
  for (let i = 0; i < 7000; i++) {
    const x0 = rnd() * S; const y0 = rnd() * S;
    const len = 4 + rnd() * 8;
    const ang = rnd() * Math.PI * 2;
    const light = rnd() < 0.5;
    const v = light ? 158 + rnd() * 40 : 74 + rnd() * 28;
    const alpha = light ? 0.5 : 0.42;
    const hw = (1.4 + rnd() * 1.6) / 2;
    const dx = Math.cos(ang) * len; const dy = Math.sin(ang) * len;
    const l2 = dx * dx + dy * dy;
    const minx = Math.floor(Math.min(x0, x0 + dx) - hw - 1); const maxx = Math.ceil(Math.max(x0, x0 + dx) + hw + 1);
    const miny = Math.floor(Math.min(y0, y0 + dy) - hw - 1); const maxy = Math.ceil(Math.max(y0, y0 + dy) + hw + 1);
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5 - x0; const py = y + 0.5 - y0;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / l2));
        const ex = px - dx * t; const ey = py - dy * t;
        const cover = Math.min(1, Math.max(0, hw + 0.5 - Math.sqrt(ex * ex + ey * ey)));
        if (cover <= 0) continue;
        const k = at(x, y);
        lum[k] += (v - lum[k]) * alpha * cover;
      }
    }
  }
  // pebbles: a 3 x 3 repeat of grit and small stones (S / 3 px = 2.33 m per repeat)
  const P = Math.round(S / 3);
  const peb = new Float32Array(P * P).fill(0.5);
  for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) peb[j * P + i] = 0.46 + 0.08 * hash2(i >> 3, j >> 3) + 0.06 * hash2(i, j);
  for (let k = 0; k < 900; k++) {
    const cx = rnd() * P; const cy = rnd() * P; const r = 1 + rnd() * 3.2; const v = rnd() < 0.55 ? 0.82 : 0.24;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.hypot(dx, dy) / r;
      if (d > 1) continue;
      const i = ((Math.floor(cx + dx) % P) + P) % P; const jj = ((Math.floor(cy + dy) % P) + P) % P;
      peb[jj * P + i] = peb[jj * P + i] * d + v * (1 - d);
    }
  }
  const data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const k = (j * S + i) * 4;
      data[k] = Math.round(Math.min(255, Math.max(0, lum[j * S + i])));
      data[k + 1] = Math.round(255 * peb[(j % P) * P + (i % P)]);
      data[k + 2] = 128;
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  GROUND_BOOT.detailMs = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10;
  return t;
}

/** Tileable multi-scale value noise: R low, G mid, B high frequency, A cloud field. */
function makeNoiseTexture() {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const per = (x, z, p) => {
    // periodic value noise over a p x p lattice
    const ix = Math.floor(x); const iz = Math.floor(z);
    const fx = fade(x - ix); const fz = fade(z - iz);
    const h = (a, b) => hash2(((a % p) + p) % p, ((b % p) + p) % p);
    const a = h(ix, iz); const b = h(ix + 1, iz); const c = h(ix, iz + 1); const d = h(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
  const oct = (u, v, base, n) => {
    let s = 0; let a = 0.5; let f = base; let tot = 0;
    for (let i = 0; i < n; i++) { s += a * per(u * f, v * f, f); tot += a; a *= 0.5; f *= 2; }
    return s / tot;
  };
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const u = i / S; const v = j / S;
      const k = (j * S + i) * 4;
      data[k] = Math.round(255 * oct(u, v, 4, 3));
      data[k + 1] = Math.round(255 * oct(u + 0.37, v + 0.11, 12, 3));
      data[k + 2] = Math.round(255 * oct(u + 0.71, v + 0.53, 40, 2));
      data[k + 3] = Math.round(255 * oct(u + 0.19, v + 0.83, 3, 4));
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------------------------------
// Terrain mesh: dense (2 m) over the farm and its ring, coarse (8 m) toward the horizon.
// The farm and its margin are flat ([6, 122] m): 8 m cells there; 2-3 m where hills start, the river and the
// lake bend; 8 m toward the horizon.
function axis(fine) {
  const out = [];
  for (let v = -200; v < -40; v += 8) out.push(v);
  for (let v = -40; v < 6; v += 3) out.push(v);
  for (let v = 6; v < 118; v += 8) out.push(v);
  for (let v = 118; v < fine; v += 2) out.push(v);
  for (let v = fine; v <= 336; v += 8) out.push(v);
  return out;
}

/** Extra vertex rows where the M2 land is shaped finer than the 8 m farm grid (wave 3): the ponds' banks and each
 *  terrace riser's foot and lip (a crisp wall, not a 3 m ramp). Sorted, without near-duplicates (pure). */
export function refinedAxis(base, ranges, points = []) {
  const out = [...base, ...points];
  for (const [a, b, st] of ranges) for (let v = a; v <= b + 1e-6; v += st) out.push(Math.round(v * 100) / 100);
  out.sort((p, q) => p - q);
  return out.filter((v, i) => i === 0 || v - out[i - 1] > 0.15);
}
function buildTerrain() {
  const T = TERRACES;
  const risers = [];
  for (let i = 0; i < T.n; i++) { const z = T.z1 - i * T.step; risers.push(z + 0.05, z - T.riser * T.step - 0.05, z - T.riser * T.step * 0.5); }
  const xs = refinedAxis(axis(214), [[POND.x - POND.rx * 1.45, POND.x + POND.rx * 1.45, 1.5], [ORCHARD_POND.x - 7, ORCHARD_POND.x + 7, 1.5]]);
  const zs = refinedAxis(axis(206), [[POND.z - POND.rz * 1.45, POND.z + POND.rz * 1.45, 1.5], [ORCHARD_POND.z - 6, ORCHARD_POND.z + 6, 1.5]], risers);
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3;
      pos[k] = xs[i]; pos[k + 1] = heightAt(xs[i], zs[j]); pos[k + 2] = zs[j];
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let n = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i; const b = a + 1; const c = a + nx; const d = c + 1;
      idx[n++] = a; idx[n++] = c; idx[n++] = b;
      idx[n++] = b; idx[n++] = c; idx[n++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// sRGB hex -> a GLSL vec3 literal of the LINEAR colour, computed once here (the shader used pow(c, 2.2) on
// constants per pixel: performance-04)
const glslLin = (hex) => {
  const c = new THREE.Color(hex);              // ColorManagement: hex is sRGB, the components are linear
  return `vec3( ${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)} )`;
};
// The lawn (visual-02): a meadow green, not neon; HSV saturation <= 0.55 at noon.
export const LAWN = Object.freeze({ grassLit: '#84B452', grassVar: '#6EA044', meadow: '#5A8C3A', shade: '#3F6B2E',
  path: '#D8B98A', sand: '#EED9A6', snow: '#F2F6FB', snowShade: '#B8C8E6' });

const GROUND_PARS_V = /* glsl */`
uniform sampler2D uNoise;
uniform float uTime;
varying vec3 vW;
varying float vCloud;
`;
const GROUND_PARS = /* glsl */`
uniform sampler2D uDetail;
uniform sampler2D uNoise;
uniform sampler2D uGroundMap;
uniform float uTime;
uniform float uGrid;
uniform vec3 uGhost;
uniform float uSeason;
uniform float uWet;
uniform float uPuddle;
uniform float uRainNow;
uniform float uNight;
uniform float uGold;
uniform float uCloudAmt;
uniform float uWaterY;
uniform vec3 uHaze;
uniform vec4 uPads[ 10 ];
uniform float uPadR[ 10 ];
uniform float uPadOn[ 10 ];
uniform vec4 uPondA;
uniform vec4 uPondB;
uniform vec4 uMeadow;
uniform vec4 uTracks[ 11 ];
uniform float uTrackOn[ 11 ];
uniform vec4 uOval;
uniform float uOvalOn;
varying vec3 vW;
varying float vCloud;
float hhPad( vec2 p, vec4 P, float r ) {
  vec2 q = abs( p - P.xy ) - P.zw + r;
  return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - r;
}
vec3 hhDesat( vec3 c, float k ) { float l = dot( c, vec3( 0.3, 0.59, 0.11 ) ); return mix( vec3( l ), c, k ); }
`;

// The painted ground. Owned lawn (most of the screen) takes a short path: the wild / for-sale / hill / lane /
// bank mixes only run where they can show (performance-04). Texture reads per pixel: ground map, two noise
// scales, the detail texture (R blades, G pebbles for the paths) and its big-clump scale; cloud shadows come
// from the vertex shader (they are 80 m blobs; the terrain is 8 m cells).
const GROUND_FRAG = /* glsl */`
{
  vec2 wxz = vW.xz;
  vec2 guv = wxz / ${W.toFixed(1)};
  float inW = step( 0.0, guv.x ) * step( guv.x, 1.0 ) * step( 0.0, guv.y ) * step( guv.y, 1.0 );
  vec4 gm = texture2D( uGroundMap, guv ) * inW;       // r footprint AO, g path, b owned, a for sale
  // The 45-degree "plaid" (visual-after #2): value noise on a lattice aligned to the world axes lines its blotches up
  // with the iso camera. Every lookup runs in its own rotated frame (27, 61, 113 degrees) and, above the low tier,
  // through a slow 18 m domain warp, so no patch edge follows the grid or the camera.
  #ifdef HH_GROUND_LOW
    vec2 wq = wxz;
  #else
    vec2 wq = wxz + ( texture2D( uNoise, wxz * vec2( 0.0066, 0.0071 ) + 0.57 ).ga - 0.5 ) * 18.0;
  #endif
  vec4 nz = texture2D( uNoise, mat2( 0.891, 0.454, -0.454, 0.891 ) * wq / 72.0 );
  vec2 dd = texture2D( uDetail, mat2( -0.391, 0.921, -0.921, -0.391 ) * wxz / 7.0 ).rg;
  float det = dd.r;
  #ifdef HH_GROUND_LOW
    vec4 nz2 = nz.gbar;
    float det2 = dd.g;
    float det3 = 0.5;
  #else
    vec4 nz2 = texture2D( uNoise, mat2( 0.485, 0.875, -0.875, 0.485 ) * wq / 23.0 + 0.31 );
    float det2 = dd.g;
    float det3 = texture2D( uDetail, mat2( 0.891, -0.454, 0.454, 0.891 ) * wq / 19.0 + 0.25 ).r;   // big soft clumps, still visible zoomed out
  #endif

  const vec3 grassLit = ${glslLin(LAWN.grassLit)};
  const vec3 grassVar = ${glslLin(LAWN.grassVar)};
  const vec3 meadow = ${glslLin(LAWN.meadow)};
  const vec3 shade = ${glslLin(LAWN.shade)};
  const vec3 pathC = ${glslLin(LAWN.path)};
  const vec3 sand = ${glslLin(LAWN.sand)};

  // Lawn: two greens in soft macro patches (FV2's clover patches), a 4-8 m patch layer, mowing stripes.
  float patchy = smoothstep( 0.3, 0.7, nz.r * 0.65 + nz2.g * 0.35 );
  vec3 lawn = mix( grassVar, grassLit, patchy );
  // RD-08 (QA wave 2): broad 6-12 m tone regions (shade #476B36, meadow #789746, dry #9DA05B) carry the variation; the
  // fine blade layer below is quiet (the lawn read as a high-contrast mottle)
  float pn = smoothstep( 0.18, 0.82, nz2.r * 0.62 + nz.g * 0.38 );
  vec3 patchC = pn < 0.5 ? mix( ${glslLin('#476B36')}, ${glslLin('#789746')}, smoothstep( 0.0, 0.5, pn ) ) : mix( ${glslLin('#789746')}, ${glslLin('#9DA05B')}, smoothstep( 0.55, 1.0, pn ) );
  lawn = mix( lawn, patchC * 1.1, 0.38 );
  lawn = mix( lawn, shade * 1.1, smoothstep( 0.66, 0.84, nz2.r ) * 0.25 );
  lawn *= 0.95 + 0.1 * nz.g;
  // the sun and the tone curve push greens up: quieten the lawn to FV2's (rendered HSV saturation ~0.75)
  lawn = hhDesat( lawn, 0.93 );
  #ifndef HH_GROUND_LOW
    float st = smoothstep( 0.18, 0.32, abs( fract( wxz.x / 4.0 + 0.25 ) - 0.5 ) );
    lawn *= 1.0 + 0.035 * ( st * 2.0 - 1.0 );
  #endif
  float owned = smoothstep( 0.25, 0.75, gm.b );
  vec3 col = lawn;
  // feathered 0.3-0.6 m edges, the width wandering +-15 % along the path (visual-after A8)
  float pathAll = smoothstep( 0.3, 0.7, gm.g + ( nz2.b - 0.5 ) * 0.42 + ( nz.g - 0.5 ) * 0.3 );
  if ( gm.b < 0.995 || gm.a > 0.005 ) {
    // the farmable square's edge (forest floor inside, open ring outside) feathers over ~8 m behind a noisy line: a
    // hard step drew a long straight diagonal across every view from the farm's edge
    float fe = ( nz.g - 0.5 ) * 5.0;
    float farmable = smoothstep( 12.0, 20.0, wxz.x + fe ) * smoothstep( 116.0, 108.0, wxz.x - fe ) * smoothstep( 12.0, 20.0, wxz.y - fe ) * smoothstep( 116.0, 108.0, wxz.y + fe );
    // Wild meadow beyond the farm: deep, lush; the land for sale a touch quieter (saturation 0.92) behind a
    // ragged, noise-warped edge, so the owned lawn pops and nothing reads as a decal (visual-01)
    vec3 wild = mix( meadow * 0.92, grassVar * 0.86, 0.35 + nz2.r * 0.45 ) * ( 0.9 + 0.18 * nz.b );
    wild = mix( wild, shade, smoothstep( 0.55, 0.85, nz.g ) * 0.4 );
    vec3 forSale = mix( hhDesat( wild, 0.92 ), uHaze, 0.025 );
    // later land is under the forest: forest floor
    float hill = smoothstep( 0.6, 8.0, vW.y );
    vec3 floorC = mix( wild * 0.9, shade * ( 0.82 + 0.25 * nz.r ), 0.55 + 0.3 * hill );
    vec3 ring = mix( wild * 0.97, shade * ( 0.85 + 0.25 * nz.r ), hill * 0.85 );
    vec3 outside = mix( ring, floorC, farmable );
    float sale = smoothstep( 0.25, 0.75, gm.a + ( nz.g - 0.5 ) * 0.7 + ( nz2.b - 0.5 ) * 0.25 );
    outside = mix( outside, forSale, sale );
    // The world places (GDD §5.6-5.9): mown pads for the fair grounds, the jetty, the greenhouse and the mill (a
    // touch drier than the farm lawn, trampled bare in patches at the fair), and the Hollow Meadow beyond the
    // north-west edge, lush and starred with wild flowers until the Stone Bridge makes it farm land.
    float padM = 0.0;
    float fairM = 0.0;
    for ( int i = 0; i < 10; i ++ ) {
      float m = ( 1.0 - smoothstep( -1.2, 1.4, hhPad( wxz, uPads[ i ], uPadR[ i ] ) + ( nz2.b - 0.5 ) * 2.2 ) ) * uPadOn[ i ];
      padM = max( padM, m );
      if ( i == 0 ) fairM = m;
    }
    vec3 mown = lawn * vec3( 1.03, 1.0, 0.88 );
    outside = mix( outside, mown, padM );
    float meadowM = 1.0 - smoothstep( -2.0, 2.5, hhPad( wxz, vec4( uMeadow.xyz, uMeadow.w ), 4.0 ) + ( nz2.b - 0.5 ) * 3.0 );
    if ( meadowM > 0.0 ) {
      vec3 lush = mix( grassLit * 1.02, grassVar * 0.96, nz2.r ) * ( 0.92 + 0.12 * nz.b );
      float speck = smoothstep( 0.7, 0.78, det ) * smoothstep( 0.35, 0.6, nz2.g );
      vec3 bloomC = mix( ${glslLin('#FFE27A')}, ${glslLin('#FFF3E4')}, step( 0.5, fract( det3 * 7.0 ) ) );
      lush = mix( lush, bloomC, speck * 0.75 );
      outside = mix( outside, lush, meadowM );
    }
    #ifndef HH_GROUND_LOW
      // the country lane and the sandy banks
      float laneD = abs( wxz.y - ${ROAD_Z.toFixed(1)} - 1.2 * sin( wxz.x * 0.05 ) );
      float lane = ( 1.0 - smoothstep( 2.0, 3.0, laneD + ( nz2.b - 0.5 ) * 1.2 ) ) * step( -60.0, wxz.x );
      float bridgeD = abs( wxz.x - ${BRIDGE_X.toFixed(1)} );
      lane = max( lane, ( 1.0 - smoothstep( 1.6, 2.6, bridgeD + ( nz2.b - 0.5 ) ) ) * step( ${ROAD_Z.toFixed(1)}, wxz.y ) * step( wxz.y, 200.0 ) );
      pathAll = max( pathAll, lane * ( 1.0 - farmable ) );
      // dirt tracks from the lane to the places, and the fair's trampled ground
      float trk = 0.0;
      for ( int i = 0; i < 11; i ++ ) {
        if ( uTrackOn[ i ] < 0.5 ) continue;
        vec2 pa = wxz - uTracks[ i ].xy; vec2 ba = uTracks[ i ].zw - uTracks[ i ].xy;
        float hT = clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 );
        trk = max( trk, 1.0 - smoothstep( 0.8, 1.5, length( pa - ba * hT ) + ( nz2.b - 0.5 ) * 0.9 ) );
      }
      // the Stable Paddock's oval riding track (wave 3): raked sand-brown dirt 3 m wide
      if ( uOvalOn > 0.5 ) {
        vec2 oq = ( wxz - uOval.xy ) / uOval.zw;
        float od = abs( length( oq ) - 1.0 ) * min( uOval.z, uOval.w );
        trk = max( trk, 1.0 - smoothstep( 1.2, 1.9, od + ( nz2.b - 0.5 ) * 0.6 ) );
      }
      float trampled = fairM * smoothstep( 0.58, 0.76, nz2.r * 0.55 + det2 * 0.25 + nz.g * 0.3 ) * 0.55;
      pathAll = max( pathAll, max( trk, trampled ) * ( 1.0 - farmable ) );
    #endif
    float bank = 1.0 - smoothstep( uWaterY + 0.12, uWaterY + 0.4, vW.y + ( nz2.g - 0.5 ) * 0.18 );
    // the ponds (wave 3) have soft mossy, muddy banks, not a sandy beach
    float pe = min( length( ( wxz - uPondA.xy ) / uPondA.zw ), length( ( wxz - uPondB.xy ) / uPondB.zw ) );
    vec3 bankC = mix( sand * ( 0.92 + 0.1 * nz.b ), mix( ${glslLin('#7E7A4A')}, ${glslLin('#5E7A3A')}, nz2.g ) * ( 0.9 + 0.15 * det ), 1.0 - smoothstep( 1.3, 1.5, pe ) );
    outside = mix( outside, bankC, bank * ( 1.0 - farmable ) );
    col = mix( outside, lawn, owned );
  }
  // Worn dirt paths with pebbles (the detail texture's G channel); the soft aprons trodden in front of doors, gates and
  // troughs (a partial path value) are darker worn earth #B49A69 (RD-08)
  vec3 dirt = mix( ${glslLin('#B49A69')}, pathC, smoothstep( 0.55, 0.95, gm.g ) ) * ( 0.86 + 0.2 * nz2.b ) * ( 0.9 + 0.2 * det2 );
  col = mix( col, dirt, pathAll );
  // Painted blade detail, stronger on grass than on dirt (RD-08: quieter, the tone regions above carry the variation)
  col *= mix( ( 0.85 + 0.3 * det ) * ( 0.92 + 0.16 * det3 ), 1.0, pathAll );
  // Soft contact AO under every placed object.
  col *= 1.0 - 0.42 * gm.r;
  // Drifting cloud shadows (per vertex: they are 80 m wide and move slowly).
  #ifndef HH_GROUND_LOW
    col *= mix( 1.0, 0.8, smoothstep( 0.52, 0.74, vCloud ) * uCloudAmt );
  #endif
  // Seasons: spring's fresh light green starred with daisies, autumn ochre grass, winter snow; rain darkens and
  // quietens; the moonlight grade; Golden Hour.
  float spring = 1.0 - smoothstep( 0.4, 0.9, uSeason );
  if ( spring > 0.0 ) {
    vec3 fresh = hhDesat( col * vec3( 1.05, 1.08, 0.88 ) + vec3( 0.01, 0.014, 0.0 ), 0.94 );
    float daisy = smoothstep( 0.74, 0.8, det ) * smoothstep( 0.45, 0.7, nz2.g ) * ( 1.0 - pathAll );
    fresh = mix( fresh, mix( vec3( 0.95, 0.95, 0.9 ), vec3( 1.0, 0.72, 0.82 ), step( 0.6, det3 ) ), daisy * 0.55 );
    col = mix( col, fresh, spring * ( 1.0 - pathAll * 0.8 ) );
  }
  float autumn = smoothstep( 1.5, 2.0, uSeason ) * ( 1.0 - smoothstep( 2.6, 3.0, uSeason ) );
  if ( autumn > 0.0 ) {
    // autumn (RD-05): a drier, warmer lawn with drifts of ochre grass, straw on the margins (paths' edges, the wild
    // land outside the farm, round every object's footprint)
    float ochreP = smoothstep( 0.4, 0.75, nz.r * 0.55 + nz2.b * 0.45 );
    // the final release (V-05): the lawn stays a lawn, a touch warmer, with ochre in drifts, not mustard wall to wall
    vec3 autumnCol = mix( hhDesat( col, 0.85 ) * vec3( 1.1, 1.0, 0.78 ), ${glslLin('#B5B347')} * ( 0.45 + 0.25 * det ), ochreP * 0.6 );
    float margin = clamp( smoothstep( 0.05, 0.45, gm.g + ( nz2.b - 0.5 ) * 0.3 ) + ( 1.0 - owned ) * 0.6 + gm.r * 0.8, 0.0, 1.0 );
    autumnCol = mix( autumnCol, ${glslLin('#C9B26E')} * ( 0.7 + 0.3 * det ), margin * 0.6 );
    col = mix( col, autumnCol, autumn * ( 1.0 - pathAll ) * 0.7 );
  }
  float winter = smoothstep( 2.5, 3.0, uSeason ) * ( 1.0 - smoothstep( 3.6, 4.0, uSeason ) );
  if ( winter > 0.0 ) {
    // snow, not cement (visual-24): bright snow, blue in the hollows and under things, paths still show at 50 %
    float hollow = clamp( gm.r * 1.4 + ( 0.5 - det ) * 0.5 + ( 0.5 - nz2.g ) * 0.35, 0.0, 1.0 );
    vec3 snowC = mix( ${glslLin(LAWN.snow)}, ${glslLin(LAWN.snowShade)}, hollow ) * ( 0.95 + 0.06 * det );
    col = mix( col, snowC, winter * mix( 0.92, 0.5, pathAll ) );
  }
  if ( uWet > 0.0 ) {
    col = mix( col, hhDesat( col, 0.8 ) * 0.7, uWet );                                   // rain reads as rain (visual-13)
    // wave 4 (owner wish 12): puddles fill the low spots of the lawn (more on the paths) while it rains and dry after;
    // the wet ground and the puddles take a sheen of the sky at grazing angles; the rain rings the puddles
    vec3 hhUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
    float hhFr = pow( 1.0 - clamp( dot( hhUp, normalize( vViewPosition ) ), 0.0, 1.0 ), 3.0 );
    float hhPf = nz2.b * 0.55 + nz.b * 0.45 + gm.g * 0.16;
    float hhPd = uPuddle > 0.0 ? smoothstep( 0.8 - 0.06 * uPuddle, 0.83 - 0.06 * uPuddle, hhPf ) * smoothstep( 0.05, 0.45, uPuddle ) * inW * ( 1.0 - gm.r ) : 0.0;
    // the sheen: a little of the grey sky at grazing angles; a puddle: dark water with the sky's grey in it
    col = mix( col, uHaze * 0.6, clamp( hhFr * uWet * 0.3, 0.0, 0.4 ) );
    col = mix( col, mix( col * 0.42, uHaze * 0.5, 0.45 + 0.3 * hhFr ), hhPd * 0.85 );
    if ( uRainNow > 0.01 && hhPd > 0.02 ) {
      vec2 hhC = floor( wxz / 0.7 );
      vec2 hhF = fract( wxz / 0.7 ) - 0.5;
      float hhH = fract( sin( dot( hhC, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
      vec2 hhO = vec2( fract( hhH * 13.7 ), fract( hhH * 71.3 ) ) - 0.5;
      float hhT = fract( uTime * ( 0.9 + 0.6 * hhH ) + hhH );
      float hhR = length( hhF - hhO * 0.45 );
      float hhRing = smoothstep( 0.035, 0.0, abs( hhR - hhT * 0.42 ) ) * ( 1.0 - hhT );
      col += vec3( 0.75, 0.82, 0.9 ) * hhRing * 0.22 * hhPd * uRainNow;
    }
  }
  // moonlight (RD-05): greens quieten toward a blue-lavender grey (#7889AD), never teal
  if ( uNight > 0.0 ) col = mix( col, vec3( dot( col, vec3( 0.3, 0.59, 0.11 ) ) ) * vec3( 0.92, 0.88, 1.12 ), uNight * 0.62 );
  if ( uGold > 0.0 ) col = mix( col, col * vec3( 1.12, 1.05, 0.96 ), uGold * 0.35 );    // Golden Hour: the light does most of the work (RD-05)

  // Build mode: the tile grid, full strength around the ghost, gone 5 tiles away (visual-25).
  if ( uGrid > 0.0 ) {
    vec2 tc = wxz / ${TILE_M.toFixed(1)};
    vec2 f = fract( tc );
    vec2 aa = fwidth( tc ) * 1.8;
    vec2 gl = smoothstep( vec2( 0.0 ), aa, f ) * smoothstep( vec2( 0.0 ), aa, 1.0 - f );
    float line = 1.0 - gl.x * gl.y;
    float near = uGhost.z > 0.5 ? 1.0 - smoothstep( ${(2 * TILE_M).toFixed(1)}, ${(5 * TILE_M).toFixed(1)}, distance( wxz, uGhost.xy ) ) : 0.4;
    col = mix( col, vec3( 1.0, 1.0, 0.92 ), line * uGrid * 0.16 * near * owned );   // quiet lines: the ghost's footprint leads (visual-after E9)
  }
  diffuseColor.rgb = col;
}
`;

// three's PCF shadow is 5 Vogel-disk taps with a sqrt and a sin/cos each, on every shadow-receiving pixel; the
// shadow map is static and 2048 px, so two hardware-PCF taps keep the soft edge for a fraction of the cost.
let cheapChunk = null;
/** One object's blob shadow (mobile wave): an ellipse from the footprint centre stretched away from the sun, half
 *  its length beyond the footprint; metres, `u` the unit shadow direction. Pure (tested). */
export function blobShadow(o, w, d, height, sunDir) {
  if (!sunDir || !(height > 0.6) || !(sunDir[1] > 0.05)) return null;
  const hx = -sunDir[0]; const hz = -sunDir[2];
  const hl = Math.hypot(hx, hz);
  if (hl < 1e-4) return null;
  const len = Math.min(8, height * (hl / sunDir[1]));         // the shadow's length on the ground, capped
  const r = 0.5 * Math.max(w, d) * TILE_M;
  const ux = hx / hl; const uz = hz / hl;
  const cx = (o.x + w / 2) * TILE_M + ux * len * 0.5;
  const cz = (o.z + d / 2) * TILE_M + uz * len * 0.5;
  return { cx, cz, ux, uz, la: r + len * 0.5, lb: r * 0.95, k: Math.min(0.62, 0.3 + height * 0.06) };
}

export function cheapShadows(shader) {
  if (cheapChunk === null) {
    const src = THREE.ShaderChunk.shadowmap_pars_fragment;
    const out = src.replace(/float phi = interleavedGradientNoise[\s\S]*?\) \* 0\.2;/,
      'shadow = ( texture( shadowMap, vec3( shadowCoord.xy + vec2( 0.45, 0.28 ) * radius, shadowCoord.z ) )'
      + ' + texture( shadowMap, vec3( shadowCoord.xy - vec2( 0.45, 0.28 ) * radius, shadowCoord.z ) ) ) * 0.5;');
    cheapChunk = out === src ? '' : out;
    if (!cheapChunk) console.warn('cheapShadows: three changed its PCF chunk; keeping the 5-tap shadows');
  }
  if (cheapChunk) shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', cheapChunk);
}

/** The occlusion fade's shared switch: index.js sets `moving` to 1 while the camera moves (RD-03). */
export const OCCLUSION = { moving: { value: 0 } };

/**
 * Scenery (the forest, the overgrowth on land for sale) that stands between the camera and the OWNED farm steps
 * aside: a WHOLE instance is hidden when the ground behind its crown (4.2 m above its root) is owned land, while the
 * root itself is not (the farm's own fence and anything on the boundary never hide). The decision is per instance
 * (every vertex computes it from the instance's root), so a tree is either drawn or not: at rest there is no screen-
 * door "ghost" over the farm (RD-03, QA wave 2: the 4x4 Bayer fade stopped at 62 % and left a checkerboard crown over
 * the fence). Only while the camera moves do trees in the transition band dither in and out. Shadows are unaffected.
 */
export function addOcclusionFade(material, groundMap) {
  addShaderPatch(material, 'hh-occlude', (shader) => {
    shader.uniforms.uOccMap = groundMap;
    shader.uniforms.uOccMoving = OCCLUSION.moving;
    const own = `
      float hhOwnAt( vec2 p ) {
        vec2 g = p / ${W.toFixed(1)};
        return texture2D( uOccMap, g ).b * step( 0.0, g.x ) * step( g.x, 1.0 ) * step( 0.0, g.y ) * step( g.y, 1.0 );
      }
      // a soft owned field (5 taps over 1.6 m): the decision never flickers on a single texel
      float hhOwnSoft( vec2 p ) {
        return ( 2.0 * hhOwnAt( p ) + hhOwnAt( p + vec2( 1.6, 0.0 ) ) + hhOwnAt( p - vec2( 1.6, 0.0 ) )
          + hhOwnAt( p + vec2( 0.0, 1.6 ) ) + hhOwnAt( p - vec2( 0.0, 1.6 ) ) ) / 6.0;
      }`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 hhOccW;\nvarying float hhOccI;\nuniform sampler2D uOccMap;\n${own}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_BATCHING
            mat4 hhOccM = modelMatrix * batchingMatrix;
          #else
            mat4 hhOccM = modelMatrix;
          #endif
          hhOccW = ( hhOccM * vec4( transformed, 1.0 ) ).xyz;
          vec3 hhRoot = ( hhOccM * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
          vec3 hhCrown = hhRoot + vec3( 0.0, 4.2, 0.0 );
          vec3 hhV = normalize( hhCrown - cameraPosition );
          hhOccI = 0.0;
          if ( hhV.y < -0.05 ) {
            vec3 hhBehind = hhCrown + hhV * ( hhCrown.y / -hhV.y );
            hhOccI = smoothstep( 0.15, 0.45, hhOwnSoft( hhBehind.xz ) ) * ( 1.0 - smoothstep( 0.05, 0.2, hhOwnSoft( hhRoot.xz ) ) );
          }
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uOccMoving;\nvarying vec3 hhOccW;\nvarying float hhOccI;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if ( hhOccI > 0.001 ) {
          // at rest: drawn or not (no checker); while the camera moves the transition band dithers (4x4 Bayer)
          float thr = 0.5;
          if ( uOccMoving > 0.5 ) {
            vec2 q = mod( floor( gl_FragCoord.xy ), 4.0 );
            vec2 q1 = mod( q, 2.0 ); vec2 q2 = floor( q / 2.0 );
            thr = ( 4.0 * ( q1.x * 2.0 + q1.y * 3.0 - 4.0 * q1.x * q1.y ) + ( q2.x * 2.0 + q2.y * 3.0 - 4.0 * q2.x * q2.y ) + 0.5 ) / 16.0;
          }
          if ( hhOccI > thr ) discard;
        }`);
  }, 'v2');
  return material;
}

/** The same decision on the CPU (pure, tested): is an instance rooted at (x, z) metres hidden from a camera at `eye`
 *  [x, y, z] metres, given ownedAt(x, z) -> 0..1? Mirrors the shader above (nearest taps instead of bilinear). */
export function occludedAt(x, z, eye, ownedAt, rootY = 0) {
  const soft = (px, pz) => (2 * ownedAt(px, pz) + ownedAt(px + 1.6, pz) + ownedAt(px - 1.6, pz) + ownedAt(px, pz + 1.6) + ownedAt(px, pz - 1.6)) / 6;
  const cy = rootY + 4.2;
  const vx = x - eye[0]; const vy = cy - eye[1]; const vz = z - eye[2];
  const l = Math.hypot(vx, vy, vz);
  if (vy / l >= -0.05) return 0;
  const t = cy / -vy;
  const bx = x + vx * t; const bz = z + vz * t;
  return smoothstep(0.15, 0.45, soft(bx, bz)) * (1 - smoothstep(0.05, 0.2, soft(x, z)));
}

// ---------------------------------------------------------------------------------------------------
// Procedural little pieces: grass tufts, flowers, rustic boundary fence (canonical attribute set).
function partsGeometry(parts) {
  const pos = []; const nor = []; const col = []; const sway = []; const idx = [];
  for (const p of parts) {
    const base = pos.length / 3;
    for (let i = 0; i < p.pos.length / 3; i++) {
      pos.push(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]);
      nor.push(...(p.nor ? p.nor.slice(i * 3, i * 3 + 3) : [0, 1, 0]));
      const c = p.colAt ? p.colAt(i) : p.col;
      col.push(c[0], c[1], c[2]);
      sway.push(p.swayAt ? p.swayAt(i) : 0);
    }
    for (const k of p.idx) idx.push(base + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

/** A wooden box (flat-shaded, 24 vertices) as a part. */
function boxPart(w, h, d, cx, cy, cz, hex, shade = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
  const c = lin(hex).map((v) => v * shade);
  const p = g.getAttribute('position').array;
  const n = g.getAttribute('normal').array;
  // darker underside / sides for a painted look
  return { pos: Array.from(p), nor: Array.from(n), idx: Array.from(g.getIndex().array),
    colAt: (i) => { const ny = n[i * 3 + 1]; const k = ny > 0.5 ? 1.08 : ny < -0.5 ? 0.7 : 0.92; return c.map((v) => v * k); } };
}

/** A grass tuft: `n` blades fanning out, dark roots to light tips; sway rises with height squared. */
function tuftGeometry(n, height, base, tip, flower = null) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash2(i, n) * 0.8;
    const lean = 0.3 + hash2(i, 3) * 0.35;
    const h = height * (0.65 + hash2(i, 7) * 0.5);
    const w = 0.09 + hash2(i, 9) * 0.06;
    const cx = Math.cos(a); const cz = Math.sin(a);
    const px = -cz * w; const pz = cx * w;
    const tx = cx * lean * h; const tz = cz * lean * h;
    const cb = lin(base); const ct = lin(tip);
    parts.push({
      pos: [px, 0, pz, -px, 0, -pz, tx, h, tz],
      nor: [0, 1, 0, 0, 1, 0, 0, 1, 0],
      idx: [0, 1, 2],
      colAt: (k) => (k === 2 ? ct : cb),
      swayAt: (k) => (k === 2 ? 1.1 : 0),
    });
  }
  if (flower) {
    const r = 0.13; const y = height * 0.95;
    const pos = [0, y + 0.02, 0];
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; pos.push(Math.cos(a) * r, y, Math.sin(a) * r); }
    const idx = [];
    for (let k = 0; k < 5; k++) idx.push(0, 1 + ((k + 1) % 5), 1 + k);
    const fc = lin(flower);
    const cc = lin('#F7D24A');
    parts.push({ pos, nor: new Array(18).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), idx, colAt: (k) => (k === 0 ? cc : fc), swayAt: () => 1.0 });
    parts.push({ pos: [0.012, 0, 0, -0.012, 0, 0, 0, y, 0], nor: [0, 1, 0, 0, 1, 0, 0, 1, 0], idx: [0, 1, 2], col: lin('#4C9A3E'), swayAt: (k) => (k === 2 ? 1.0 : 0) });
  }
  return partsGeometry(parts);
}

/** Rustic post-and-rail fence pieces (one rail piece spans one tile edge = TILE_M metres along +x). */
function fenceGeometries() {
  const wood = '#C98B4E';
  const post = partsGeometry([
    boxPart(0.2, 1.05, 0.2, 0, 0.525, 0, wood, 0.92),
    boxPart(0.24, 0.08, 0.24, 0, 1.07, 0, '#A86F3A'),
  ]);
  const rail = partsGeometry([
    boxPart(TILE_M + 0.04, 0.12, 0.07, 0, 0.78, 0, wood, 1.05),
    boxPart(TILE_M + 0.04, 0.12, 0.07, 0, 0.42, 0, wood, 1.0),
  ]);
  return { post, rail };
}

/** A flat five-point flower head (5 triangles) at (cx, y, cz). */
function starHead(cx, y, cz, r, hex, centre = '#F7D24A') {
  const pos = [cx, y + 0.01, cz];
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; pos.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r); }
  const idx = [];
  for (let k = 0; k < 5; k++) idx.push(0, 1 + ((k + 1) % 5), 1 + k);
  const fc = lin(hex); const cc = lin(centre);
  return { pos, nor: new Array(18).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), idx, colAt: (k) => (k === 0 ? cc : fc), swayAt: () => 0.8 };
}
/** A small faceted stone (an octahedron, 8 triangles) as a part. */
function stonePart(r, sx, sy, sz, cx, cy, cz, hex) {
  const g = new THREE.OctahedronGeometry(r, 0).toNonIndexed();
  g.scale(sx, sy, sz); g.translate(cx, cy, cz); g.computeVertexNormals();
  const P = Array.from(g.getAttribute('position').array); const N = Array.from(g.getAttribute('normal').array); const c = lin(hex);
  return { pos: P, nor: N, idx: P.map((_, k) => k).slice(0, P.length / 3), colAt: (k) => c.map((v) => v * (N[k * 3 + 1] > 0.5 ? 1.05 : 0.8)) };
}
/** Clover: a low leafy rosette with two round white / pink heads (Bee Glade's clover glade). ~22 triangles. */
function cloverGeometry() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + hash2(i, 31) * 0.5;
    const r = 0.12 + hash2(i, 32) * 0.06;
    const cx = Math.cos(a) * r; const cz = Math.sin(a) * r; const w = 0.08;
    parts.push({ pos: [cx - w, 0.07, cz - w, cx + w, 0.07, cz - w, cx + w, 0.09, cz + w, cx - w, 0.09, cz + w], nor: new Array(12).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)),
      idx: [0, 2, 1, 0, 3, 2], col: lin(i % 2 ? '#5E9A3C' : '#4E8A35'), swayAt: () => 0.2 });
  }
  for (let k = 0; k < 2; k++) {
    const cx = k ? 0.09 : -0.03; const cz = k ? 0.05 : -0.04; const y = 0.2 + k * 0.03;
    parts.push(starHead(cx, y, cz, 0.06, k ? '#F2B6CF' : '#F7F3E6', k ? '#E89AB8' : '#EDE6D0'));
    parts.push({ pos: [0.01 + cx, 0, cz, -0.01 + cx, 0, cz, cx, y, cz], nor: [0, 1, 0, 0, 1, 0, 0, 1, 0], idx: [0, 1, 2], col: lin('#4C8A35'), swayAt: (i) => (i === 2 ? 0.8 : 0) });
  }
  return partsGeometry(parts);
}
/** Pebbles: three small warm-grey stones half sunk in the grass (Goat Rocks, Olive Terrace). 24 triangles. */
function pebbleGeometry() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const a = hash2(i, 41) * Math.PI * 2; const r = 0.08 + hash2(i, 42) * 0.22;
    parts.push(stonePart(0.08 + hash2(i, 43) * 0.07, 1.25, 0.55, 1, Math.cos(a) * r, 0.015, Math.sin(a) * r, ['#B8B0A2', '#A39A8A', '#C9C0AE'][i % 3]));
  }
  return partsGeometry(parts);
}
/** Fallen maple leaves: five flat six-point leaves in red, copper and gold (Maple Ridge, all year). 30 triangles. */
function leafLitterGeometry() {
  const parts = [];
  const C = ['#C8452E', '#E0703A', '#B83A2A', '#E8A23C', '#D35A2C'];
  for (let i = 0; i < 5; i++) {
    const a = hash2(i, 51) * Math.PI * 2; const r = hash2(i, 52) * 0.42;
    const cx = Math.cos(a) * r; const cz = Math.sin(a) * r; const y = 0.025 + i * 0.002;
    const rot = hash2(i, 53) * Math.PI * 2; const sc = 0.08 + hash2(i, 54) * 0.05;
    const pos = [cx, y, cz];
    for (let k = 0; k < 6; k++) { const t = rot + (k / 6) * Math.PI * 2; const rr = sc * (k % 2 ? 0.6 : 1.25); pos.push(cx + Math.cos(t) * rr, y, cz + Math.sin(t) * rr); }
    const idx = [];
    for (let k = 0; k < 6; k++) idx.push(0, 1 + ((k + 1) % 6), 1 + k);
    parts.push({ pos, nor: new Array(21).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), idx, col: lin(C[i % C.length]) });
  }
  return partsGeometry(parts);
}
/** Mushrooms: two cream stalks under a brown and a red cap (Pig Woods' truffle ground, the Walnut Grove). ~36 triangles. */
function mushroomGeometry() {
  const parts = [];
  for (let i = 0; i < 2; i++) {
    const cx = i ? 0.11 : 0; const cz = i ? 0.06 : 0; const h = 0.11 + i * 0.05;
    const st = new THREE.CylinderGeometry(0.025, 0.035, h, 4, 1, true).toNonIndexed();
    st.translate(cx, h / 2, cz);
    const cap = new THREE.ConeGeometry(0.08 + i * 0.03, 0.06, 6).toNonIndexed();
    cap.translate(cx, h + 0.02, cz);
    for (const [g, hex] of [[st, '#F1E6CF'], [cap, i ? '#C8452E' : '#9C6A3E']]) {
      g.computeVertexNormals();
      const P = Array.from(g.getAttribute('position').array);
      parts.push({ pos: P, nor: Array.from(g.getAttribute('normal').array), idx: P.map((_, k) => k).slice(0, P.length / 3), col: lin(hex) });
    }
  }
  return partsGeometry(parts);
}

/**
 * Each parcel's own ground (wave 3, GDD §3.9 "reveals"): on land the farm owns, about `share` of the scattered tufts
 * become the parcel's character. Kinds index the tuft list in createGround: 1 tall grass, 2 cream flower, 3 buttercup,
 * 4 pink flower, 5 clover, 6 poppy, 7 pebbles, 8 maple leaves, 9 mushrooms.
 */
export const PARCEL_GROUND = Object.freeze({
  cow_hill: Object.freeze({ share: 0.3, kinds: Object.freeze([5]) }),
  sunflower_rise: Object.freeze({ share: 0.3, kinds: Object.freeze([3, 3, 2]) }),
  bee_glade: Object.freeze({ share: 0.62, kinds: Object.freeze([5, 5, 5, 4]) }),
  fair_lane: Object.freeze({ share: 0.4, kinds: Object.freeze([2, 2, 3]) }),
  riverbank: Object.freeze({ share: 0.35, kinds: Object.freeze([3, 1]) }),
  pig_woods: Object.freeze({ share: 0.5, kinds: Object.freeze([9, 9, 1]) }),
  willow_pond: Object.freeze({ share: 0.5, kinds: Object.freeze([3, 3, 1, 2]) }),
  goat_rocks: Object.freeze({ share: 0.55, kinds: Object.freeze([7, 7, 4]) }),
  stable_paddock: Object.freeze({ share: 0.45, kinds: Object.freeze([1, 1, 2]) }),
  walnut_grove: Object.freeze({ share: 0.45, kinds: Object.freeze([9, 1, 2]) }),
  olive_terrace: Object.freeze({ share: 0.5, kinds: Object.freeze([7, 4, 2]) }),
  maple_ridge: Object.freeze({ share: 0.6, kinds: Object.freeze([8, 8, 8, 1]) }),
  sunset_hill: Object.freeze({ share: 0.55, kinds: Object.freeze([6, 6, 3]) }),
});
const PARCEL_GROUND_LIST = Object.keys(PARCEL_GROUND).map((k) => PARCEL_GROUND[k]);
const PARCEL_GROUND_IDS = Object.keys(PARCEL_GROUND);

/** Per tile of the world: 1 + the PARCEL_GROUND index of the OWNED parcel covering it, else 0 (pure). */
export function parcelGround(expansionIds) {
  const t = new Uint8Array(N * N);
  for (const id of expansionIds || []) {
    const k = PARCEL_GROUND_IDS.indexOf(id);
    const e = CONTENT.expansions.get(id);
    if (k < 0 || !e) continue;
    fill(t, e.rects, k + 1);
  }
  return t;
}

// ---------------------------------------------------------------------------------------------------
const TUFTS = { high: 3600, medium: 2000, low: 700 };

export function createGround(layers, { scenery = null, quality = 'high' } = {}) {
  const tex = { detail: makeDetailTexture(), noise: makeNoiseTexture() };
  // groundMap: 256 x 256 over the 128 m world (0.5 m texels): r AO, g path, b owned, a for sale.
  const GM = 256;
  const gmData = new Uint8Array(GM * GM * 4);
  const groundMap = new THREE.DataTexture(gmData, GM, GM, THREE.RGBAFormat);
  groundMap.magFilter = THREE.LinearFilter;
  groundMap.minFilter = THREE.LinearFilter;
  groundMap.needsUpdate = true;

  const U = {
    uDetail: { value: tex.detail }, uNoise: { value: tex.noise }, uGroundMap: { value: groundMap },
    uGrid: { value: 0 }, uCloudAmt: { value: 0.35 }, uWaterY: { value: WATER_Y },
    uHaze: { value: new THREE.Color('#D6F1FF') }, uGhost: { value: new THREE.Vector3(0, 0, 0) },
    uPuddle: { value: 0 }, uRainNow: { value: 0 },                     // wave 4: the rain's puddles and rings (setRain)
    uPads: { value: [...PAD_KEYS.map((k) => PLACES[k].pad), ...Object.values(MOWN_PADS)].map((p) => new THREE.Vector4(...p.slice(0, 4))) },
    uPadR: { value: [...PAD_KEYS.map((k) => PLACES[k].pad), ...Object.values(MOWN_PADS)].map((p) => p[4]) },
    // the M1b places are always mown; the M2 pads only once their expansion (or project) is the farm's (setFeatures)
    uPadOn: { value: [...PAD_KEYS, ...Object.keys(MOWN_PADS)].map((k, i) => (i < 5 ? 1 : 0)) },
    uPondA: { value: new THREE.Vector4(POND.x, POND.z, POND.rx, POND.rz) },
    uPondB: { value: new THREE.Vector4(ORCHARD_POND.x, ORCHARD_POND.z, ORCHARD_POND.rx, ORCHARD_POND.rz) },
    uMeadow: { value: new THREE.Vector4(...PLACES.meadow.pad.slice(0, 4)) },
    uTracks: { value: [...TRACKS, ...FEATURE_TRACKS].map((t) => new THREE.Vector4(t[0], t[1], t[2], t[3])) },
    uTrackOn: { value: [...TRACKS.map(() => 1), ...FEATURE_TRACKS.map(() => 0)] },
    uOval: { value: new THREE.Vector4(RIDING.x, RIDING.z, RIDING.rx, RIDING.rz) },
    uOvalOn: { value: 0 },
  };
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, { uTime: WORLD.uTime, uSeason: WORLD.uSeason, uWet: WORLD.uWet, uNight: WORLD.uNight, uGold: WORLD.uGold });
    // wave 4 (owner wish 11): the nearest lamps light the ground at night (models.js LAMPS)
    for (const k of ['uLampPos', 'uLampR', 'uLampColor', 'uLampK']) shader.uniforms[k] = LOOK[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GROUND_PARS_V}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        vCloud = texture2D( uNoise, vW.xz * 0.0042 + uTime * vec2( 0.0021, 0.0011 ) ).a;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_PARS}\n${LAMPS_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GROUND_FRAG}`)
      .replace('#include <opaque_fragment>', `${LAMPS_FRAG}\n#include <opaque_fragment>`);
    cheapShadows(shader);
  };
  mat.customProgramCacheKey = () => `hh-ground-v14-${mat.defines && 'HH_GROUND_LOW' in mat.defines ? 'low' : 'full'}`;
  const groundTier = (qt) => {
    mat.defines = qt === 'low' ? { HH_GROUND_LOW: '' } : {};
    mat.needsUpdate = true;
  };
  groundTier(quality);
  const terrain = new THREE.Mesh(buildTerrain(), mat);
  terrain.name = 'terrain';
  terrain.receiveShadow = true;
  terrain.matrixAutoUpdate = false;
  // drawn after the opaque world (renderOrder 1; the sky is 2): the costly ground shader never runs under a
  // building, a crop or a tree (early depth rejection, performance-04)
  terrain.renderOrder = 1;
  layers.terrain.add(terrain);

  const water = createWater(layers.terrain);

  // Grass tufts and wild flowers (instanced, swaying, cursor-parted).
  const tuftMat = models.createMaterial({ side: THREE.DoubleSide });
  addSway(tuftMat, { stiffness: 0.8, push: 1.3 });
  addFoliageTint(tuftMat, { autumn: 0.75 });   // RD-05: the grass turns with the trees
  addShaderPatch(tuftMat, 'hh-shadow2', cheapShadows, 'v1');
  // grass in the lawn's own palette (visual-02), one flower (cream or butter yellow) per ~6 tufts
  // (the flower kinds have room for Farm Beauty's extra wild flowers and the Hollow Meadow: `room`)
  const tuftKinds = [
    { geo: tuftGeometry(7, 0.6, '#3F6B2E', '#93BE5E'), share: 0.58, room: 0.58 },
    { geo: tuftGeometry(9, 0.8, '#355F27', '#84B452'), share: 0.25, room: 0.25 },
    { geo: tuftGeometry(6, 0.55, '#3F6B2E', '#93BE5E', '#FFF3C4'), share: 0.09, room: 0.3 },
    { geo: tuftGeometry(6, 0.5, '#3F6B2E', '#93BE5E', '#FFD76A'), share: 0.08, room: 0.3 },
    // pink and lavender wild flowers: only in the Hollow Meadow and the Farm Beauty flowers (no share in the meadow
    // scatter)
    { geo: tuftGeometry(6, 0.55, '#3F6B2E', '#93BE5E', '#F4A6C4'), share: 0, room: 0.18 },
    // wave 3 (M2): each parcel's own ground (PARCEL_GROUND): clover heads, poppies, pebbles, fallen maple leaves and
    // mushrooms, only on land the farm owns (a kind with no instance draws nothing)
    { geo: cloverGeometry(), share: 0, room: 0.14 },
    { geo: tuftGeometry(5, 0.62, '#3F6B2E', '#93BE5E', '#E2483A'), share: 0, room: 0.1 },
    { geo: pebbleGeometry(), share: 0, room: 0.1 },
    { geo: leafLitterGeometry(), share: 0, room: 0.1 },
    { geo: mushroomGeometry(), share: 0, room: 0.07 },
  ];
  let tuftCap = TUFTS[quality] || TUFTS.high;
  const tuftMeshes = tuftKinds.map((k) => {
    const m = new THREE.InstancedMesh(k.geo, tuftMat, Math.ceil(TUFTS.high * k.room) + 8);
    m.count = 0;
    m.frustumCulled = false;
    m.receiveShadow = true;
    m.name = 'tufts';
    layers.ground.add(m);
    return m;
  });
  // Candidate spots: deterministic, over the farm and the near ring (never on water or the lane).
  const candidates = [];
  for (let i = 0; candidates.length < 9000 && i < 40000; i++) {
    const x = -14 + hash2(i, 101) * 156;
    const z = -14 + hash2(i, 202) * 146;
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.5 || h > 5) continue;
    if (Math.abs(z - ROAD_Z) < 3.5 || (Math.abs(x - BRIDGE_X) < 3 && z > ROAD_Z)) continue;
    const r = hash2(i, 303);
    let kind = 0;
    let acc = 0;
    for (let k = 0; k < tuftKinds.length; k++) { acc += tuftKinds[k].share; if (r < acc) { kind = k; break; } }
    candidates.push({ x, z, y: h, kind, s: 0.75 + hash2(i, 404) * 0.6, a: hash2(i, 505) * Math.PI * 2, c: hash2(i, 606) });
  }

  let land = null;
  let mown = [];                                  // owned shader-only mown pads (MOWN_PADS): fewer wild tufts there
  let mownSig = '';
  let charOf = null;                              // per tile: 1 + the PARCEL_GROUND_LIST index of an owned parcel, or 0
  let expKey = null;
  let clearing = false;
  let fx = null;
  let ghostAt = null;
  let built = { fence: [], signs: [] };
  let gridGoal = 0;
  let bandK = 1;                                  // tuft density per zoom band (tech §10.12: 100 / 60 / 45 %)
  let flowerBoost = 0;                            // Farm Beauty: the share of lawn tufts that flower (0 .. 0.22)
  let state = null;
  let dirtyMap = false;
  let dirtyTufts = false;
  const occupied = new Uint8Array(N * N);       // tiles holding an object or ground piece (tufts avoid them)
  // wave 4 (owner wish F): wild tufts on the farm's own land are weeds the Hand pulls for good (rules farm.weeds.t
  // {'x,z': 1}); a cleared tile draws none, and `weedAt` tells the pick which owned tiles still have some
  const weedCleared = new Uint8Array(N * N);
  const weedShown = new Uint8Array(N * N);
  let weedSig = '';
  const rims = [];                               // footprints that grow grass clusters along their edges
  const footSig = new Map();                     // id -> def|x|z|rot|size of what the map was last built from
  // wave 4b: an object's own footprint (a grown home covers its paddock: the rules' objFootprint), and its signature
  const footOf = (o, def) => (typeof grid.objFootprint === 'function' && def ? grid.objFootprint(o, def) : footprint(def, o.rot || 0));
  const footSigOf = (o, def) => { const f = def && def.size ? footOf(o, def) : [0, 0]; return `${o.def}|${o.x}|${o.z}|${o.rot || 0}|${f[0]}x${f[1]}`; };

  function rebuildLand(expansions, { clear = false, extra = [] } = {}) {
    const key = `${expansions.join(',')}|${JSON.stringify(extra)}`;
    if (key === expKey) return false;
    clearing = clear && expKey !== null;
    expKey = key;
    land = landTiles(expansions, undefined, extra);
    charOf = parcelGround(expansions);
    // b = owned, a = for sale, written at 4 texels per tile then blurred once (soft 0.5 m edge)
    const raw = new Float32Array(GM * GM * 2);
    for (let j = 0; j < GM; j++) {
      for (let i = 0; i < GM; i++) {
        const t = land[(j >> 2) * N + (i >> 2)];
        raw[(j * GM + i) * 2] = t === 1 ? 1 : 0;
        raw[(j * GM + i) * 2 + 1] = t === 2 ? 1 : 0;
      }
    }
    for (let j = 0; j < GM; j++) {
      for (let i = 0; i < GM; i++) {
        let s0 = 0; let s1 = 0; let n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const x = Math.min(GM - 1, Math.max(0, i + di)); const z = Math.min(GM - 1, Math.max(0, j + dj));
          s0 += raw[(z * GM + x) * 2]; s1 += raw[(z * GM + x) * 2 + 1]; n++;
        }
        gmData[(j * GM + i) * 4 + 2] = Math.round((s0 / n) * 255);
        gmData[(j * GM + i) * 4 + 3] = Math.round((s1 / n) * 255);
      }
    }
    groundMap.needsUpdate = true;
    if (scenery) rebuildFenceAndSigns(expansions);
    dirtyTufts = true;
    return true;
  }

  function rebuildFenceAndSigns(expansions) {
    for (const h of built.fence) scenery.remove(h);
    for (const h of built.signs) scenery.remove(h);
    for (const h of built.wild || []) scenery.remove(h);
    const prevWild = built.wildList || [];
    built = { fence: [], signs: [], wild: [] };
    const fg = fenceGeometries();
    scenery.define('hh:fence_post', fg.post);
    scenery.define('hh:fence_rail', fg.rail);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const posts = new Set();
    const edges = boundaryEdges(land);
    const dockGap = expansions.includes('willow_pond');
    for (const [x0, z0, x1, z1] of edges) {
      const horiz = z0 === z1;
      // the fishing dock leaves the farm through a gap in the fence (wave 3)
      if (dockGap && !horiz && x0 === POND_DOCK.tx && z0 === POND_DOCK.tz) continue;
      // the fence stands just outside the owned land so nothing placed on the edge tile clips it
      const out = 0;
      const mx = ((x0 + x1) / 2) * TILE_M;
      const mz = ((z0 + z1) / 2) * TILE_M;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), horiz ? 0 : Math.PI / 2);
      m4.compose(new THREE.Vector3(mx, out, mz), q, one);
      built.fence.push(scenery.add('hh:fence_rail', m4));
      for (const [px, pz] of [[x0, z0], [x1, z1]]) {
        const k = `${px},${pz}`;
        if (posts.has(k)) continue;
        posts.add(k);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(px, pz) * 0.5 - 0.25);
        m4.compose(new THREE.Vector3(px * TILE_M, 0, pz * TILE_M), q, one);
        built.fence.push(scenery.add('hh:fence_post', m4));
      }
    }
    const signs = saleSigns(expansions);
    for (const s of signs) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      m4.compose(new THREE.Vector3(s.x * TILE_M, 0, s.z * TILE_M), q, new THREE.Vector3(1.7, 1.7, 1.7));
      built.signs.push(scenery.add('prop:signpost_sale', m4));
    }
    // Land for sale is overgrown: young pines, round trees, bushes and the odd rock at ~0.6 of the forest's
    // density (FV2's unbought land). Buying the parcel clears it with a puff of dust per tree (visual-01).
    const list = wildOnSale(land, signs, (tx, tz) => expansionOfTile(tx, tz));
    const sc = new THREE.Vector3();
    for (const w of list) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.yaw);
      m4.compose(new THREE.Vector3(w.x, 0, w.z), q, sc.setScalar(w.s));
      built.wild.push(scenery.add(w.key, m4));
    }
    built.wildList = list;
    if (clearing && fx) {
      const keep = new Set(list.map((w) => `${w.x},${w.z}`));
      const gone = prevWild.filter((w) => !keep.has(`${w.x},${w.z}`) && !w.key.includes('flower'));
      gone.slice(0, 24).forEach((w, k) => {
        const pos = new THREE.Vector3(w.x, 0, w.z);
        setTimeout(() => fx.play({ e: 'cleared' }, pos), k * 45);
      });
    }
  }

  /** The live expansion (owned or not) covering a tile. */
  function expansionOfTile(x, z) {
    for (const e of CONTENT.expansions.values()) {
      if (!liveNow(e)) continue;
      for (const [rx, rz, rw, rd] of e.rects) if (x >= rx && z >= rz && x < rx + rw && z < rz + rd) return e.id;
    }
    return null;
  }

  let blobDir = null;                            // mobile wave: the snapped sun direction of the blob shadows
  const BLOB_KINDS = new Set(['building', 'home', 'landmark', 'tree', 'decor']);
  function blobHeight(def) {
    if (def.kind === 'tree') return 5;
    const key = models.keyOf(def.id);
    const h = key ? models.boundsOf(key).max.y : 0;
    return def.kind === 'decor' ? Math.min(3, h) : Math.min(9, h || 4);
  }
  // Footprint AO + paths from the objects (debounced to one rebuild per frame).
  function rebuildMap() {
    dirtyMap = false;
    for (let i = 0; i < GM * GM; i++) { gmData[i * 4] = 0; gmData[i * 4 + 1] = 0; }
    occupied.fill(0);
    if (!state) { groundMap.needsUpdate = true; return; }
    const ao = new Float32Array(GM * GM);
    const path = new Float32Array(GM * GM);
    footSig.clear();
    rims.length = 0;
    for (const [id, o] of Object.entries(state.farm.objects)) {
      const def = defOf(o.def);
      if (!def || def.layer === 'none' || !Number.isFinite(o.x)) continue;
      // a grown home's footprint is its whole paddock (wave 4b: the rules' objFootprint)
      const [w, d] = footOf(o, def);
      footSig.set(id, footSigOf(o, def));
      for (let j = o.z; j < o.z + d; j++) for (let i = o.x; i < o.x + w; i++) if (i >= 0 && j >= 0 && i < N && j < N) occupied[j * N + i] = 1;
      if (def.layer === 'ground') {
        // paths: fill the tiles (4 texels each); the shader roughs up the edge. A Greenhouse frame (a ground-layer
        // landmark round its own plots) gets a lighter gravel floor instead.
        const v = def.greenhouse ? 0.45 : 1;
        for (let j = o.z * 4; j < (o.z + d) * 4; j++) for (let i = o.x * 4; i < (o.x + w) * 4; i++) if (i >= 0 && j >= 0 && i < GM && j < GM) path[j * GM + i] = v;
        continue;
      }
      // grass grows up against fences and foundations (visual-02): clusters along the outside of the footprint
      if (def.kind !== 'plot' && def.kind !== 'debris') rims.push({ id, x: o.x, z: o.z, w, d });
      // trodden earth in front of every door and gate (visual-after A8): a soft worn patch on the front middle tile
      if (def.kind === 'building' || def.kind === 'home' || def.kind === 'landmark') {
        const r = ((o.rot || 0) % 4 + 4) % 4;
        const fx = [o.x + w / 2, o.x + w + 0.45, o.x + w / 2, o.x - 0.45][r] * 4;
        const fz = [o.z + d + 0.45, o.z + d / 2, o.z - 0.45, o.z + d / 2][r] * 4;
        const R = 6;                                  // RD-08: a 3 m apron of worn earth
        for (let j = Math.floor(fz - R); j <= Math.ceil(fz + R); j++) {
          for (let i = Math.floor(fx - R); i <= Math.ceil(fx + R); i++) {
            if (i < 0 || j < 0 || i >= GM || j >= GM) continue;
            const dd = Math.hypot((i + 0.5 - fx) * 1.2, j + 0.5 - fz) / R;
            if (dd < 1) path[j * GM + i] = Math.max(path[j * GM + i], 0.55 * (1 - dd * dd));
          }
        }
      }
      const blob = blobDir && BLOB_KINDS.has(def.kind) ? blobShadow(o, w, d, blobHeight(def), blobDir) : null;
      if (blob) {
        // texels are 0.5 m: walk the blob's box and add a soft elliptical falloff
        const ext = Math.max(blob.la, blob.lb);
        for (let j = Math.floor((blob.cz - ext) * 2); j <= Math.ceil((blob.cz + ext) * 2); j++) {
          for (let i = Math.floor((blob.cx - ext) * 2); i <= Math.ceil((blob.cx + ext) * 2); i++) {
            if (i < 0 || j < 0 || i >= GM || j >= GM) continue;
            const px = (i + 0.5) / 2 - blob.cx; const pz = (j + 0.5) / 2 - blob.cz;
            const a = (px * blob.ux + pz * blob.uz) / blob.la;
            const b = (px * -blob.uz + pz * blob.ux) / blob.lb;
            const q = 1 - (a * a + b * b);
            if (q <= 0) continue;
            const v = q * q * blob.k;
            ao[j * GM + i] = Math.min(1, ao[j * GM + i] + v * (1 - ao[j * GM + i]));
          }
        }
      }
      const k = def.kind === 'plot' ? 0.45 : def.kind === 'decor' ? 0.5 : def.kind === 'debris' ? 0.55 : def.kind === 'tree' ? 0.7 : 0.9;
      // soft rounded rectangle: the footprint plus ~0.7 m, falling off smoothly
      const cx = (o.x + w / 2) * 4; const cz = (o.z + d / 2) * 4;
      const hx = w * 2 + 0.6; const hz = d * 2 + 0.6;
      const pad = def.kind === 'plot' ? 1.2 : 2.6;
      for (let j = Math.floor(cz - hz - pad); j <= Math.ceil(cz + hz + pad); j++) {
        for (let i = Math.floor(cx - hx - pad); i <= Math.ceil(cx + hx + pad); i++) {
          if (i < 0 || j < 0 || i >= GM || j >= GM) continue;
          const qx = Math.max(Math.abs(i + 0.5 - cx) - hx, 0);
          const qz = Math.max(Math.abs(j + 0.5 - cz) - hz, 0);
          const dd = Math.hypot(qx, qz);
          const inside = Math.max(Math.abs(i + 0.5 - cx) / hx, Math.abs(j + 0.5 - cz) / hz);
          const v = (dd > 0 ? Math.max(0, 1 - dd / pad) ** 2 : 1) * k * (inside < 1 ? 1 : 1);
          ao[j * GM + i] = Math.min(1, ao[j * GM + i] + v * (1 - ao[j * GM + i]));
        }
      }
    }
    // blur the path mask a little so its edge has width for the noise to bite into
    for (let j = 0; j < GM; j++) {
      for (let i = 0; i < GM; i++) {
        let s = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const x = Math.min(GM - 1, Math.max(0, i + di)); const z = Math.min(GM - 1, Math.max(0, j + dj));
          s += path[z * GM + x];
        }
        gmData[(j * GM + i) * 4] = Math.round(ao[j * GM + i] * 255);
        gmData[(j * GM + i) * 4 + 1] = Math.round((s / 9) * 255);
      }
    }
    groundMap.needsUpdate = true;
    dirtyTufts = true;
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const tint = new THREE.Color();
  /** farm.weeds.t ({'x,z': 1}, rules weeds.js) -> the cleared tiles; the tufts rebuild only when the set changed. */
  function readWeeds(s, force = false) {
    const t = s && s.farm && s.farm.weeds && typeof s.farm.weeds.t === 'object' && s.farm.weeds.t ? s.farm.weeds.t : null;
    const keys = t ? Object.keys(t) : [];
    const sig = `${keys.length}|${keys.length ? keys[keys.length - 1] : ''}|${s?.farm?.weeds?.n ?? ''}`;
    if (!force && sig === weedSig) return;
    weedSig = sig;
    weedCleared.fill(0);
    for (const k of keys) {
      const i = k.indexOf(',');
      const x = Number(k.slice(0, i)); const z = Number(k.slice(i + 1));
      if (Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < N && z < N && t[k]) weedCleared[z * N + x] = 1;
    }
    dirtyTufts = true;
  }

  function rebuildTufts() {
    dirtyTufts = false;
    if (!land) return;
    const counts = tuftMeshes.map(() => 0);
    const caps = tuftKinds.map((k) => Math.ceil(tuftCap * k.room));
    weedShown.fill(0);
    const put = (k, x, y, z, sc, a, cc) => {
      if (counts[k] >= caps[k] || counts[k] >= tuftMeshes[k].instanceMatrix.count) return;
      const wx = Math.floor(x / TILE_M); const wz = Math.floor(z / TILE_M);
      if (wx >= 0 && wz >= 0 && wx < N && wz < N && land[wz * N + wx] === 1) {
        if (weedCleared[wz * N + wx]) return;                      // pulled: this tile stays tidy for good
        weedShown[wz * N + wx] = 1;
      }
      q.setFromAxisAngle(yAxis, a);
      s3.setScalar(sc);
      m4.compose(v3.set(x, y, z), q, s3);
      tuftMeshes[k].setMatrixAt(counts[k], m4);
      tint.setRGB(0.88 + cc * 0.24, 0.92 + (sc % 0.1), 0.88 + (1 - cc) * 0.16);
      tuftMeshes[k].setColorAt(counts[k], tint);
      counts[k]++;
    };
    const ownedFree = (tx, tz) => tx >= 0 && tz >= 0 && tx < N && tz < N && land[tz * N + tx] === 1 && !occupied[tz * N + tx];
    // 1) clusters of 3-7 tufts hugging fences and foundations (first: they matter most to the look)
    for (const r of rims) {
      const h0 = hash2(r.x * 31 + r.z, r.w * 7 + r.d);
      const per = 2 * (r.w + r.d) + 4;
      for (let k = 0; k < per; k++) {
        if (hash2(k, Math.floor(h0 * 1e6)) > 0.45) continue;
        // a tile just outside the footprint, walking around it
        const side = k % 4; const t = Math.floor(k / 4);
        const tx = side === 0 ? r.x + Math.min(t, r.w - 1) : side === 1 ? r.x + r.w : side === 2 ? r.x + Math.min(t, r.w - 1) : r.x - 1;
        const tz = side === 0 ? r.z - 1 : side === 1 ? r.z + Math.min(t, r.d - 1) : side === 2 ? r.z + r.d : r.z + Math.min(t, r.d - 1);
        if (!ownedFree(tx, tz)) continue;
        // the cluster's centre: 0.2-0.6 m off the footprint edge, along the edge at random
        const along = hash2(k, 911 + tx) * TILE_M;
        const off = 0.2 + hash2(k, 912 + tz) * 0.4;
        let cx; let cz;
        if (side === 0) { cx = tx * TILE_M + along; cz = (tz + 1) * TILE_M - off; } else if (side === 2) { cx = tx * TILE_M + along; cz = tz * TILE_M + off; }
        else if (side === 1) { cx = tx * TILE_M + off; cz = tz * TILE_M + along; } else { cx = (tx + 1) * TILE_M - off; cz = tz * TILE_M + along; }
        const n = 3 + Math.floor(hash2(tx, tz) * 5);
        for (let i = 0; i < n; i++) {
          const a = hash2(i, tx * 97 + tz) * Math.PI * 2; const rr = 0.12 + hash2(tz, i * 13 + tx) * 0.42;
          const kind = i === n - 1 && hash2(tx + i, tz) < 0.5 ? 2 + (i & 1) : (i % 3 === 0 ? 1 : 0);
          put(kind, cx + Math.cos(a) * rr, 0, cz + Math.sin(a) * rr, 0.7 + hash2(i, tz) * 0.45, a * 3.1, hash2(tx, i));
        }
      }
    }
    // 2) the woodland verge (visual-after A4): clusters of 3-6 tufts just outside the farm fence on about half its
    // edges, with 1-2 m gaps between them, so the farm's rim reads as long grass meeting the trees
    for (const [x0, z0, x1, z1] of boundaryEdges(land)) {
      const hv = hash2(x0 * 53 + x1, z0 * 29 + z1);
      if (hv > 0.5) continue;
      const horiz = z0 === z1;
      // which side is outside: the tile across the edge that is not owned
      const inX = horiz ? x0 : Math.min(x0, x1);
      const ownedBelow = horiz && z0 < N && land[z0 * N + inX] === 1;
      const ownedRight = !horiz && x0 < N && land[z0 * N + x0] === 1;
      const ox = horiz ? 0 : (ownedRight ? -1 : 1);
      const oz = horiz ? (ownedBelow ? -1 : 1) : 0;
      const n = 3 + Math.floor(hv * 8);
      for (let i = 0; i < n; i++) {
        const along = (0.15 + 0.7 * hash2(i, x0 * 7 + z0)) * TILE_M;
        const out = 0.35 + hash2(z0 + i, x0 * 3) * 1.1;
        const px = (horiz ? x0 * TILE_M + along : x0 * TILE_M) + ox * out;
        const pz = (horiz ? z0 * TILE_M : z0 * TILE_M + along) + oz * out;
        put(i % 4 === 3 ? 2 + (i & 1) : (i % 3 === 0 ? 1 : 0), px, 0, pz, 0.8 + hash2(i, z0) * 0.5, hash2(x0, i) * 6.28, hash2(i, x0));
      }
    }
    // 3) the Hollow Meadow (Restoration 3's land, GDD §5.9: "a wildflower meadow"): drifts of wild flowers every
    // ~3 m, before and after it joins the farm (never on a tile something stands on)
    {
      const [mx, mz, hx, hz] = PLACES.meadow.pad;
      for (let gz = mz - hz + 1.5; gz < mz + hz - 1; gz += 3.1) {
        for (let gx = mx - hx + 1.5; gx < mx + hx - 1; gx += 3.1) {
          const k = Math.round(gx * 17 + gz * 131);
          if (hash2(k, 81) < 0.25) continue;                       // a gap here and there
          const cx = gx + (hash2(k, 82) - 0.5) * 2.4; const cz = gz + (hash2(k, 83) - 0.5) * 2.4;
          const tx = Math.floor(cx / TILE_M); const tz = Math.floor(cz / TILE_M);
          if (tx >= 0 && tz >= 0 && tx < N && tz < N && occupied[tz * N + tx]) continue;
          const n = 4 + Math.floor(hash2(k, 84) * 4);
          for (let i = 0; i < n; i++) {
            const a = hash2(k + i, 85) * Math.PI * 2; const r = 0.15 + hash2(k + i, 86) * 0.8;
            put(i % 3 === 0 ? 0 : [2, 3, 4][(k + i) % 3], cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r, 1.1 + hash2(i, k) * 0.5, a * 2.7, hash2(k, i));
          }
        }
      }
    }
    // 3b) each owned parcel's own ground (PARCEL_GROUND): drifts of its character every ~3.6 m, never on a tile something
    // stands on or beside a plot (the field stays tidy)
    if (charOf) {
      for (const e of CONTENT.expansions.values()) {
        const k = PARCEL_GROUND_IDS.indexOf(e.id);
        if (k < 0) continue;
        const ch = PARCEL_GROUND_LIST[k];
        for (const [rx, rz, rw, rd] of e.rects) {
          if (charOf[rz * N + rx] !== k + 1) continue;
          for (let gz = rz * TILE_M + 1.2; gz < (rz + rd) * TILE_M - 0.6; gz += 3.6) {
            for (let gx = rx * TILE_M + 1.2; gx < (rx + rw) * TILE_M - 0.6; gx += 3.6) {
              const h0 = Math.round(gx * 23 + gz * 151);
              if (hash2(h0, 87) > ch.share + 0.15) continue;
              const cx = gx + (hash2(h0, 88) - 0.5) * 2.6; const cz = gz + (hash2(h0, 89) - 0.5) * 2.6;
              const tx = Math.floor(cx / TILE_M); const tz = Math.floor(cz / TILE_M);
              if (!ownedFree(tx, tz)) continue;
              const nb = (dx, dz) => { const x = tx + dx; const z = tz + dz; return x >= 0 && z >= 0 && x < N && z < N && occupied[z * N + x]; };
              if (nb(1, 0) || nb(-1, 0) || nb(0, 1) || nb(0, -1)) continue;
              const n = 2 + Math.floor(hash2(h0, 90) * 3);
              for (let i = 0; i < n; i++) {
                const a = hash2(h0 + i, 91) * Math.PI * 2; const r = 0.1 + hash2(h0 + i, 92) * 0.6;
                const kind = ch.kinds[Math.floor(hash2(h0 + i, 93) * ch.kinds.length)];
                put(kind, cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r, 0.85 + hash2(i, h0) * 0.4, a * 2.3, hash2(h0, i));
              }
            }
          }
        }
      }
    }
    // 4) the scattered meadow: lush on wild land, a light scatter on the owned lawn (visual-02: keep 42 %); Farm Beauty
    // turns some lawn tufts into wild flowers, and the Hollow Meadow is starred with them
    for (const c of candidates) {
      const tx = Math.floor(c.x / TILE_M); const tz = Math.floor(c.z / TILE_M);
      const inside = tx >= 0 && tz >= 0 && tx < N && tz < N;
      const lt = inside ? land[tz * N + tx] : 0;
      let kind = c.kind;
      const meadow = padDist(c.x, c.z, PLACES.meadow.pad) < 0;
      const own = lt === 1 && charOf ? charOf[tz * N + tx] : 0;
      if (lt === 1) {
        if (occupied[tz * N + tx] || c.c > (meadow ? 0.6 : own ? 0.5 : 0.42)) continue;
        // keep a clear rim around plots (the clusters above dress buildings and fences)
        const nb = (dx, dz) => { const x = tx + dx; const z = tz + dz; return x >= 0 && z >= 0 && x < N && z < N && occupied[z * N + x]; };
        if (c.c > 0.12 && (nb(1, 0) || nb(-1, 0) || nb(0, 1) || nb(0, -1))) continue;
        if (kind < 2 && hash2(Math.round(c.x * 10), Math.round(c.z * 10)) < flowerBoost) kind = c.c < 0.14 ? 2 : c.c < 0.28 ? 3 : 4;
      } else if (lt === 0 && c.c > 0.7 && !meadow) continue;
      if (meadow && kind < 2 && c.c < 0.55) kind = c.c < 0.3 ? 2 : 3;
      // the parcel's own ground: about half its tufts become its character (PARCEL_GROUND)
      if (own) {
        const ch = PARCEL_GROUND_LIST[own - 1];
        const r = hash2(Math.round(c.x * 7), Math.round(c.z * 7));
        if (r < ch.share) kind = ch.kinds[Math.floor(hash2(Math.round(c.z * 5), Math.round(c.x * 3)) * ch.kinds.length)];
      }
      if (lt !== 1 && padMask(c.x, c.z, 0) > 0 && !meadow && c.c > 0.25) continue;     // the places' mown pads stay neat
      if (lt !== 1 && mown.length && c.c > 0.3 && mown.some((p) => padDist(c.x, c.z, p) < 0)) continue;
      const big = lt === 1 ? 1.0 : lt === 0 ? 1.15 : 1.25;
      put(kind, c.x, c.y, c.z, c.s * big, c.a, c.c);
    }
    tuftMeshes.forEach((m, i) => {
      m.visible = counts[i] > 0;
      m.userData.full = counts[i];
      m.count = Math.round(counts[i] * bandK);
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  const hlColors = { brush: '#FFFFFF', paint: '#FFFFFF', valid: '#58D66A', invalid: '#E5534B', harvest: '#FFE27A', water: '#6FD3E6' };
  const hl = createHighlight(layers.gridFx);
  let hlTiles = [];

  return {
    terrain,
    water,
    uniforms: U,
    setState(s) {
      state = s;
      rebuildLand(s.farm.expansions, { extra: rewardLandRects(s) });
      dirtyMap = true;
      readWeeds(s, true);
    },
    sync(ids, topics, s) {
      state = s;
      readWeeds(s, topics.has('*'));
      if (topics.has('expansions') || topics.has('restore') || topics.has('*')) rebuildLand(s.farm.expansions, { clear: !topics.has('*'), extra: rewardLandRects(s) });
      if (topics.has('*')) { dirtyMap = true; return; }
      // Only footprints matter here (AO, paths, tuft clearings): planting or harvesting a crop changes
      // nothing, so a drag-harvest over 70 plots never rebuilds the map.
      for (const id of ids) {
        const o = Object.hasOwn(s.farm.objects, id) ? s.farm.objects[id] : null;
        const sig = o && Number.isFinite(o.x) ? footSigOf(o, defOf(o.def)) : null;
        if ((footSig.get(id) ?? null) !== sig) { dirtyMap = true; break; }
      }
    },
    /** Placement grid fades in/out over 250 ms. */
    grid(visible) { gridGoal = visible ? 1 : 0; },
    /** The ghost's centre in tiles (the grid is drawn around it), or null. */
    gridFocus(x, z) {
      if (Number.isFinite(x) && Number.isFinite(z)) U.uGhost.value.set(x * TILE_M, z * TILE_M, 1);
      else U.uGhost.value.z = 0;
    },
    setFx(f) { fx = f; },
    /** Tiles [[x, z], ...] to highlight; style 'brush' | 'valid' | 'invalid' | 'harvest' | 'water' | '#hex'. */
    highlight(tiles, style = 'brush') {
      hlTiles = Array.isArray(tiles) ? tiles.filter((t) => Array.isArray(t) && Number.isInteger(t[0]) && Number.isInteger(t[1])) : [];
      hl.set(hlTiles, hlColors[style] || (typeof style === 'string' && /^#[0-9a-fA-F]{6}$/.test(style) ? style : '#FFFFFF'));
    },
    setHaze(rgb) { U.uHaze.value.setRGB(rgb[0], rgb[1], rgb[2]); },
    /** Wave 3 (M2): which land features are the farm's: `owners` = a Set of expansion ids and 'restore:<id>' keys.
     *  Their pads are mown, their paths painted, the Stable Paddock's riding track raked. */
    setFeatures(owners) {
      const has = (k) => Boolean(owners && owners.has(k));
      [...PAD_KEYS, ...Object.keys(MOWN_PADS)].forEach((k, i) => { if (i >= 5) U.uPadOn.value[i] = has(PAD_OWNER[k]) ? 1 : 0; });
      const sig = [...Object.keys(MOWN_PADS), 'paddock', 'picnic'].filter((k) => has(PAD_OWNER[k])).join(',');
      if (sig !== mownSig) { mownSig = sig; mown = Object.keys(MOWN_PADS).filter((k) => has(PAD_OWNER[k])).map((k) => MOWN_PADS[k]); dirtyTufts = true; }
      FEATURE_TRACKS.forEach((t, i) => { U.uTrackOn.value[TRACKS.length + i] = has(t[4]) ? 1 : 0; });
      U.uOvalOn.value = has('stable_paddock') ? 1 : 0;
    },
    setCloud(amount) { U.uCloudAmt.value = amount; },
    /** Wave 4 (owner wish 12): puddles (0..1, fill and dry with the weather) and the rain on them (0..1: rings). */
    setRain(puddle, rain) { U.uPuddle.value = Math.max(0, Math.min(1, puddle || 0)); U.uRainNow.value = Math.max(0, Math.min(1, rain || 0)); },
    setQuality(qt) { tuftCap = TUFTS[qt] || TUFTS.high; dirtyTufts = true; groundTier(qt); },
    setBlobShadows(dir) {
      let next = null;
      if (Array.isArray(dir) && dir.length === 3 && dir.every(Number.isFinite)) {
        // snapped to 10 deg of azimuth and elevation: a rebuild every couple of minutes as the day turns, not per frame
        const az = Math.round(Math.atan2(dir[2], dir[0]) / (Math.PI / 18)) * (Math.PI / 18);
        const el = Math.max(0.35, Math.round(Math.asin(Math.max(-1, Math.min(1, dir[1] / Math.hypot(...dir)))) / (Math.PI / 18)) * (Math.PI / 18));
        next = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
      }
      const same = (a, b) => (a === b) || (a && b && a.every((x, i) => Math.abs(x - b[i]) < 1e-6));
      if (same(next, blobDir)) return;
      blobDir = next;
      dirtyMap = true;
    },
    /** Farm Beauty stars (0..5): more of the lawn's tufts flower (GDD §5.9 ambience). */
    setBeauty(stars) {
      const k = [0, 0.05, 0.09, 0.13, 0.18, 0.22][Math.max(0, Math.min(5, stars | 0))];
      if (k !== flowerBoost) { flowerBoost = k; dirtyTufts = true; }
    },
    /** Zoom band: tufts are stored in random order, so lowering the count thins them evenly. */
    setBand(band) {
      // the far band keeps 45 % of the tufts: the overview still has grass texture (visual-after #2)
      bandK = band === 'far' ? 0.45 : band === 'mid' ? 0.65 : 1;
      for (const m of tuftMeshes) if (Number.isFinite(m.userData.full)) m.count = Math.round(m.userData.full * bandK);
    },
    ownedAt(x, z) { return Boolean(land && x >= 0 && z >= 0 && x < N && z < N && land[z * N + x] === 1); },
    /** Wave 4 (owner wish F): an owned tile whose wild tufts (weeds) this screen draws and nobody pulled yet. */
    weedAt(x, z) {
      return Boolean(land && Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < N && z < N && land[z * N + x] === 1
        && weedShown[z * N + x] && !weedCleared[z * N + x]);
    },
    landAt(x, z) { return land && x >= 0 && z >= 0 && x < N && z < N ? land[z * N + x] : 0; },
    /** The live expansion for sale that covers tile (x, z), or null. */
    expansionAt(x, z) {
      if (!land || this.landAt(x, z) !== 2) return null;
      for (const e of CONTENT.expansions.values()) {
        if (!liveNow(e) || (state && state.farm.expansions.includes(e.id))) continue;
        for (const [rx, rz, rw, rd] of e.rects) if (x >= rx && z >= rz && x < rx + rw && z < rz + rd) return e.id;
      }
      return null;
    },
    /** Owned land's bounding box in tiles (camera pan bounds). */
    bounds() {
      let x0 = N; let z0 = N; let x1 = 0; let z1 = 0;
      if (land) for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) if (land[z * N + x] === 1) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x + 1); z1 = Math.max(z1, z + 1); }
      return x1 > x0 ? { x0, z0, x1, z1 } : { x0: FARM_MIN, z0: FARM_MIN, x1: FARM_MAX, z1: FARM_MAX };
    },
    update(dt) {
      let want = 0;
      if (dirtyMap) rebuildMap();
      if (dirtyTufts) rebuildTufts();
      const g = U.uGrid.value;
      if (g !== gridGoal) {
        U.uGrid.value = gridGoal > g ? Math.min(gridGoal, g + dt * 4) : Math.max(gridGoal, g - dt * 4);
        want = 2;
      }
      water.update();
      return want;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Drag-paint highlight: rounded tile cards floating just above the soil (plots would hide a ground decal),
// one instanced draw, pulsing gently on the 120 BPM attention beat.
function createHighlight(layer) {
  const base = new THREE.PlaneGeometry(TILE_M, TILE_M);
  base.rotateX(-Math.PI / 2);
  const uColor = { value: new THREE.Color('#FFFFFF') };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    uniforms: { uColor, uTime: WORLD.uTime },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
      void main() {
        vec2 q = abs( vUv - 0.5 );
        float r = length( max( q - 0.36, 0.0 ) ) ;
        float d = max( q.x, q.y );
        float box = 1.0 - smoothstep( 0.44, 0.47, d + r * 0.6 );
        float rim = smoothstep( 0.33, 0.43, d ) * box;
        float pulse = 0.85 + 0.15 * sin( uTime * 12.566 );
        gl_FragColor = vec4( mix( uColor, vec3( 1.0 ), rim * 0.25 ), ( box * 0.3 + rim * 0.75 ) * pulse );
        #include <colorspace_fragment>
      }`,
  });
  let cap = 16;
  let mesh = null;
  const build = (n) => {
    if (mesh) { layer.remove(mesh); mesh.dispose(); }
    cap = n;
    mesh = new THREE.InstancedMesh(base, mat, cap);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.name = 'highlight';
    layer.add(mesh);
  };
  build(cap);
  const m4 = new THREE.Matrix4();
  return {
    set(tiles, color) {
      if (tiles.length > cap) build(Math.max(cap * 2, tiles.length));
      tiles.forEach(([x, z], i) => { m4.makeTranslation((x + 0.5) * TILE_M, 0.2, (z + 0.5) * TILE_M); mesh.setMatrixAt(i, m4); });
      mesh.count = tiles.length;
      mesh.instanceMatrix.needsUpdate = true;
      uColor.value.set(color);
    },
    get count() { return mesh.count; },
  };
}

// ---------------------------------------------------------------------------------------------------
// Water: opaque, unlit-ish, depth baked from the terrain height (no depth pre-pass), foam lip at the shore,
// slow rings and sparkling glints (visual-ux-juice §4.9). Tinted by the sky so night water is moonlit.
/** The water sheets: the river and the lake on a 3 x 2 m grid, and the M2 ponds (the Willow Pond, the Orchard Pond)
 *  on a fine 1 m grid of their own, all in ONE geometry (one draw). [x0, x1, z0, z1, dx, dz] metres. */
export const WATER_SHEETS = Object.freeze([
  Object.freeze([-200, 336, 118, 210, 3, 2]),
  Object.freeze([POND.x - POND.rx * 1.3, POND.x + POND.rx * 1.3, POND.z - POND.rz * 1.3, POND.z + POND.rz * 1.3, 1, 1]),
  Object.freeze([ORCHARD_POND.x - ORCHARD_POND.rx * 1.3, ORCHARD_POND.x + ORCHARD_POND.rx * 1.3, ORCHARD_POND.z - ORCHARD_POND.rz * 1.3,
    ORCHARD_POND.z + ORCHARD_POND.rz * 1.3, 1, 1]),
]);

function createWater(layer) {
  const pos = [];
  const depth = [];
  const idx = [];
  for (const [x0, x1, z0, z1, dx, dz] of WATER_SHEETS) {
    const xs = [];
    for (let v = x0; v <= x1 + 1e-6; v += dx) xs.push(v);
    const zs = [];
    for (let v = z0; v <= z1 + 1e-6; v += dz) zs.push(v);
    const nx = xs.length; const nz = zs.length;
    const base = pos.length / 3;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        pos.push(xs[i], WATER_Y, zs[j]);
        depth.push(Math.max(-0.3, Math.min(1, (WATER_Y - heightAt(xs[i], zs[j])) / 1.5)));
      }
    }
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = base + j * nx + i; const b = a + 1; const c = a + nx; const d = c + 1;
        // skip quads entirely under the bank (saves fill and keeps the far shore clean)
        if (depth[a] < -0.05 && depth[b] < -0.05 && depth[c] < -0.05 && depth[d] < -0.05) continue;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  // RD-10 (QA wave 2): a deeper river #397F94 with muted shallows #78AFAD (the old cyan read as a pool), a quarter of
  // the white sparkle dots, a broken (not ruled) foam line on the banks, and slow rings round the jetty's piles and
  // the barge's hull (setRipples: up to 8 capsules [ax, az, bx, bz, r])
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uShallow: { value: new THREE.Color('#7DB9B5') }, uDeep: { value: new THREE.Color('#3A88A2') },
    uFoam: { value: new THREE.Color('#F4FBF8') }, uLight: { value: new THREE.Color(1, 1, 1) },
    uRip: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0)) }, uRipR: { value: new Array(8).fill(-1) },
  }]);
  uniforms.uTime = WORLD.uTime;
  uniforms.uWet = WORLD.uWet;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: /* glsl */`
      attribute float aDepth;
      varying float vDepth;
      varying vec3 vWorld;
      uniform float uTime;
      #include <fog_pars_vertex>
      void main() {
        vDepth = aDepth;
        vec3 p = position;
        p.y += sin( uTime * 1.5708 + position.x * 0.4 + position.z * 0.3 ) * 0.03;
        vWorld = ( modelMatrix * vec4( p, 1.0 ) ).xyz;
        vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uWet;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uFoam;
      uniform vec3 uLight;
      uniform vec4 uRip[ 8 ];
      uniform float uRipR[ 8 ];
      varying float vDepth;
      varying vec3 vWorld;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float d = clamp( vDepth, 0.0, 1.0 );
        vec3 col = mix( uShallow, uDeep, smoothstep( 0.05, 0.9, d ) );
        // a broken foam line: the lip comes and goes along the bank
        float brk = 0.5 + 0.5 * sin( vWorld.x * 0.83 + sin( vWorld.z * 0.57 + vWorld.x * 0.21 ) * 2.4 );
        float lip = ( 1.0 - smoothstep( 0.0, 0.05 + 0.05 * brk, d ) ) * ( 0.45 + 0.55 * brk );
        float rings = step( 0.93, sin( d * 26.0 - uTime * 1.6 ) ) * ( 1.0 - smoothstep( 0.0, 0.24, d ) ) * step( 0.35, brk );
        // slow rings round piles and hulls
        float rip = 0.0;
        for ( int i = 0; i < 8; i ++ ) {
          if ( uRipR[ i ] < 0.0 ) continue;
          vec2 pa = vWorld.xz - uRip[ i ].xy; vec2 ba = uRip[ i ].zw - uRip[ i ].xy;
          float hT = clamp( dot( pa, ba ) / max( dot( ba, ba ), 1e-4 ), 0.0, 1.0 );
          float e = length( pa - ba * hT ) - uRipR[ i ];
          if ( e > 0.0 && e < 1.8 ) rip = max( rip, step( 0.86, sin( e * 7.0 - uTime * 2.2 ) ) * ( 1.0 - e / 1.8 ) );
        }
        vec2 q = vWorld.xz * 0.9 + vec2( uTime * 0.15, uTime * 0.11 );
        float glint = smoothstep( 0.9, 0.985, sin( q.x * 3.1 ) * sin( q.y * 2.3 + 1.7 ) * sin( ( q.x + q.y ) * 1.3 ) );
        col = mix( col, uFoam, max( max( lip, rings ) * 0.75, rip * 0.45 ) );
        col += glint * 0.12 * ( 1.0 - 0.6 * uWet );
        col *= uLight;
        gl_FragColor = vec4( col, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'water';
  mesh.matrixAutoUpdate = false;
  layer.add(mesh);
  return {
    mesh,
    uniforms,
    /** light: linear rgb multiplier from the sky (night moonlight, dusk warmth). */
    setLight(rgb) { uniforms.uLight.value.setRGB(rgb[0], rgb[1], rgb[2]); },
    /** Ripple sources (metres): [[ax, az, bx, bz, r], ...] capsules (a pile: a = b), at most 8. */
    setRipples(list) {
      for (let i = 0; i < 8; i++) {
        const r = list[i];
        if (r) { uniforms.uRip.value[i].set(r[0], r[1], r[2], r[3]); uniforms.uRipR.value[i] = r[4]; } else uniforms.uRipR.value[i] = -1;
      }
    },
    update() {},
  };
}
