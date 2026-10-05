// Grid helpers: footprints, the derived tile index, placement checks (tech §2.3). Pure.
// Coordinates are integer tiles; (x, z) is the min corner; rot is quarter turns and odd rot swaps w and d.
// Layers: 'object' and 'ground' hold footprints; 'none' (animals, review-m0 #9) has no footprint: such an
// object lives in its `home` object, is never indexed here and is never placed with canPlace().
import { CONTENT, defOf, levelFromXp, isLive, HOME_GROWTH } from '../content/index.js';
import { WORLD_TILES, START } from '../content/config.js';
import { HOME_LAYOUT } from '../content/authored.js';
import { GRID_CACHE, GRID_VERSION, OBJ_VERSION, hide } from './grid-cache.js';
import { ERR } from '../net/protocol.js';

export { touchGrid, resetGrid } from './grid-cache.js';

/** [w, d] of a def at a rotation. */
export function footprint(def, rot = 0) {
  const [w, d] = def.size;
  return rot % 2 ? [d, w] : [w, d];
}

/** Every tile [x, z] covered by a def placed at (x, z, rot). */
export function tilesOf(def, x, z, rot = 0) {
  return tilesOfSize(def.size, x, z, rot);
}

/** Every tile [x, z] of a [w, d] size placed at (x, z, rot) (odd rot swaps w and d). */
export function tilesOfSize(size, x, z, rot = 0) {
  const [w, d] = rot % 2 ? [size[1], size[0]] : size;
  const out = [];
  for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) out.push([x + dx, z + dz]);
  return out;
}

// ---- animal homes that grow (wave 4b, owner wish 3; content HOME_GROWTH) ----------------------------------------

/** The growth row `{ caps }` of a home def id, or null (no growth: the Beehive, test fixtures). */
export const growthOf = (defId) => (typeof defId === 'string' && Object.hasOwn(HOME_GROWTH.homes, defId)
  ? HOME_GROWTH.homes[defId] : null);

/** The most animals a home of `def` can ever hold: its growth row's last cap, else the def's capacityMax. */
export function homeMaxOf(def) {
  const g = def && growthOf(def.id);
  return g ? g.caps.at(-1) : def?.capacityMax;
}

/** Footprint tier of a home of `def` holding `cap` animals: 0 = the def's own size (up to the old capacityMax). */
export function capTier(def, cap) {
  const g = growthOf(def.id);
  if (!g) return 0;
  const i = g.caps.findIndex((c) => cap <= c);
  return i < 0 ? g.caps.length - 1 : i;
}

/** [w, d] (rot 0) of a home of `def` with capacity `cap`: the def's size grown HOME_GROWTH.grow per tier. */
export function homeSizeAt(def, cap) {
  const t = capTier(def, cap) * HOME_GROWTH.grow;
  return [def.size[0] + t, def.size[1] + t];
}

/** Capacity of home object `o` (its def's capacity + upgradeStep per bought step, at most homeMaxOf). Pure. */
export function capOf(o, def = defOf(o.def)) {
  if (!def || !Number.isSafeInteger(def.capacity)) return 0;
  const up = Number.isSafeInteger(o.up) ? o.up : 0;
  const cap = def.capacity + up * (def.upgradeStep ?? 0);
  const max = homeMaxOf(def);
  return Number.isSafeInteger(max) ? Math.min(cap, max) : cap;
}

/**
 * [w, d] at rot 0 of object `o` ON THE GRID: a growing home's size follows its capacity (homeSizeAt), every other
 * object its def's size. Renderers, picking, the ghost and the Hammer use this, never `def.size`, for homes.
 */
export function sizeOf(o, def = defOf(o.def)) {
  if (def && def.kind === 'home' && growthOf(def.id)) return homeSizeAt(def, capOf(o, def));
  return def.size;
}

/** [w, d] of object `o` at its rotation. */
export function objFootprint(o, def = defOf(o.def)) {
  const [w, d] = sizeOf(o, def);
  return (o.rot ?? 0) % 2 ? [d, w] : [w, d];
}

/** Every tile of object `o` (its own size: a grown home covers its whole paddock). */
export const objTiles = (o, def = defOf(o.def)) => tilesOfSize(sizeOf(o, def), o.x, o.z, o.rot ?? 0);

export const inWorld = (x, z) => x >= 0 && z >= 0 && x < WORLD_TILES && z < WORLD_TILES;

/**
 * Every unlocked land rect [x, z, w, d]: the owned expansions, then the land a completed Restoration project adds
 * (the Stone Bridge's Hollow Meadow, GDD §5.9). The renderer draws the farm's land from the same list.
 */
export function landRects(state) {
  const out = [];
  for (const id of state.farm.expansions) {
    const e = CONTENT.expansions.get(id);
    if (e) out.push(...e.rects);
  }
  for (const p of LAND_PROJECTS) if (landDone(state, p)) out.push(...p.reward.land.rects);
  return out;
}

/** Restoration projects whose reward is land (live ones only). */
const LAND_PROJECTS = [...CONTENT.restoration.values()].filter((p) => p.reward && p.reward.land && isLive(p));
const landDone = (state, p) => {
  const r = state.farm.restore;
  return Boolean(r) && typeof r === 'object' && Object.hasOwn(r, p.id) && Number.isSafeInteger(r[p.id]?.done);
};
const inRects = (rects, x, z) => rects.some(([rx, rz, rw, rd]) => x >= rx && z >= rz && x < rx + rw && z < rz + rd);

/** True when the tile is inside the union of the farm's unlocked land (landRects). Allocation-free. */
export function inLand(state, x, z) {
  for (const id of state.farm.expansions) {
    const e = CONTENT.expansions.get(id);
    if (e && inRects(e.rects, x, z)) return true;
  }
  for (const p of LAND_PROJECTS) if (landDone(state, p) && inRects(p.reward.land.rects, x, z)) return true;
  return false;
}

/**
 * The derived tile index: { object: Array(W*W) of id|null, ground: Array(W*W) of id|null }.
 * Cached under a Symbol and rebuilt when touchGrid() bumped the version.
 */
export function getGrid(state) {
  const v = state[GRID_VERSION] ?? 0;
  const c = state[GRID_CACHE];
  if (c && c.v === v) return c;
  const n = WORLD_TILES * WORLD_TILES;
  const grid = { v, object: new Array(n).fill(null), ground: new Array(n).fill(null) };
  for (const [id, o] of Object.entries(state.farm.objects)) {
    const def = defOf(o.def);
    if (!def || def.layer === 'none') continue;
    for (const [x, z] of objTiles(o, def)) {
      if (inWorld(x, z)) grid[def.layer][z * WORLD_TILES + x] = id;
    }
  }
  state[GRID_CACHE] = grid;
  return grid;
}

/** The id of the object covering a tile (object layer first, then ground), or null. */
export function tileOwner(state, x, z) {
  if (!inWorld(x, z)) return null;
  const g = getGrid(state);
  const i = z * WORLD_TILES + x;
  return g.object[i] ?? g.ground[i] ?? null;
}

/** Count of objects of a kind (plots, coops, ...). */
export function countKind(state, kind) {
  let n = 0;
  for (const o of Object.values(state.farm.objects)) if (defOf(o.def)?.kind === kind) n++;
  return n;
}

/**
 * Can `defId` be placed at (x, z, rot)? Returns null or an ERR code. The placement ghost and the server
 * both call this (tech §10.7). Cost is checked by the action, not here.
 */
export function canPlace(state, defId, x, z, rot = 0, ignoreId = null) {
  const def = defOf(defId);
  if (!def) return ERR.NOT_FOUND;
  if (def.layer === 'none') return ERR.BAD_ARGS;          // lives in a home: bought with its own action
  if (levelFromXp(state.farm.xp) < def.unlock) return ERR.LOCKED;
  return canFit(state, defId, x, z, rot, ignoreId);
}

/**
 * The footprint part of canPlace(): every tile inside the world and the unlocked land, and free on the def's layer
 * (ignoring `ignoreId`, the object being moved). For EXISTING objects (move, move back, restore), which never
 * need their def's unlock level again. The footprint is `size` when given, else the moved object's own size (a grown
 * home moves with its paddock: sizeOf), else the def's.
 */
export function canFit(state, defId, x, z, rot = 0, ignoreId = null, size = null) {
  const def = defOf(defId);
  if (!def) return ERR.NOT_FOUND;
  if (def.layer === 'none') return ERR.BAD_ARGS;
  const g = getGrid(state);
  const self = ignoreId !== null && Object.hasOwn(state.farm.objects, ignoreId) ? state.farm.objects[ignoreId] : null;
  const sz = size ?? (self && self.def === defId ? sizeOf(self, def) : def.size);
  for (const [tx, tz] of tilesOfSize(sz, x, z, rot)) {
    if (!inWorld(tx, tz) || !inLand(state, tx, tz)) return ERR.OUT_OF_BOUNDS;
    const i = tz * WORLD_TILES + tx;
    const owner = g[def.layer][i];
    if (owner !== null && owner !== ignoreId) return ERR.BLOCKED;
    // the Greenhouse (GDD §5.9, a ground-layer frame) holds only its own plots: nothing else stands inside it, and
    // it needs the object layer free too (its plots are created there; a moved greenhouse ignores its own plots)
    if (def.greenhouse) {
      const o = g.object[i];
      if (o !== null && !(ignoreId !== null && state.farm.objects[o]?.gh === ignoreId)) return ERR.BLOCKED;
    } else if (def.layer === 'object' && g.ground[i] !== null && isGreenhouse(state, g.ground[i])) return ERR.BLOCKED;
  }
  return null;
}

/** True when object `id` is a Greenhouse frame (its def carries `greenhouse`). */
export const isGreenhouse = (state, id) => Boolean(defOf(state.farm.objects[id]?.def)?.greenhouse);

/**
 * The tiles of a Greenhouse's plots at (x, z, rot), in plot order: the two inner rows of its frame (a 6 x 4 frame
 * holds 2 rows of 6; walls and the aisle are the outer rows). `def.greenhouse.plots` plots in all.
 */
export function greenhousePlotTiles(def, x, z, rot = 0) {
  const [w, d] = def.size;
  const n = def.greenhouse.plots;
  const cols = w;
  const rows = Math.ceil(n / cols);
  const z0 = Math.floor((d - rows) / 2);
  const out = [];
  for (let k = 0; k < n; k++) {
    const lx = k % cols;
    const lz = z0 + Math.floor(k / cols);
    // quarter turns: odd rot swaps the footprint (footprint()); the local grid turns with it
    const [px, pz] = rot === 0 ? [lx, lz] : rot === 1 ? [d - 1 - lz, lx]
      : rot === 2 ? [w - 1 - lx, d - 1 - lz] : [lz, w - 1 - lx];
    out.push([x + px, z + pz]);
  }
  return out;
}

/**
 * How many animals the home object `homeId` can hold (review-m0 #9): its def's `capacity` plus `upgradeStep` per
 * bought capacity step (`obj.up`), at most homeMaxOf (wave 4b: the growth row's last cap, else `capacityMax`); 0 when
 * unknown. validateState and the buy action use it.
 */
export function capacityOf(state, homeId) {
  const o = Object.hasOwn(state.farm.objects, homeId) ? state.farm.objects[homeId] : null;
  return o ? capOf(o) : 0;
}

/** Count of objects whose def id is `defId` and that satisfy `pred` (default: all). Order-independent. */
const SPOTS = Symbol('hh.spots');

/**
 * True when `defId` fits somewhere on the unlocked land now (either rotation). Cached on the state per grid version
 * (a Symbol: never replicated), so the Goal Tracker can ask for every build it might suggest (wave-2 QA RC-10a).
 */
export function hasSpot(state, defId) {
  const v = state[GRID_VERSION] ?? 0;
  let c = state[SPOTS];
  if (!c || c.v !== v) hide(state, SPOTS, c = { v, m: new Map() });
  if (c.m.has(defId)) return c.m.get(defId);
  const def = defOf(defId);
  let ok = false;
  if (def && def.layer !== 'none') {
    const rects = landRects(state);
    const rots = def.size && def.size[0] !== def.size[1] ? [0, 1] : [0];
    const fits = (x, z) => rots.some((r) => canFit(state, defId, x, z, r) === null);
    for (const [x0, z0, w, d] of rects) {
      for (let z = z0; z < z0 + d && !ok; z++) for (let x = x0; x < x0 + w && !ok; x++) ok = fits(x, z);
      if (ok) break;
    }
  }
  c.m.set(defId, ok);
  return ok;
}

const BY_DEF = Symbol('hh.byDef');

/**
 * The farm's objects grouped by def, cached per OBJ_VERSION (any write under farm.objects rebuilds it). The scan
 * of a big farm (6,000+ objects) ran on every countDef; it showed up as 69 ms in a stroke profile (wave-2 QA RC-20).
 */
export function objectsByDef(state) {
  const v = state[OBJ_VERSION] ?? 0;
  const objs = state.farm.objects;
  const c = state[BY_DEF];
  if (c && c.v === v && c.objs === objs) return c.m;
  const m = new Map();
  for (const id of Object.keys(objs)) {
    const o = objs[id];
    let list = m.get(o.def);
    if (!list) m.set(o.def, list = []);
    list.push(o);
  }
  hide(state, BY_DEF, { v, objs, m });
  return m;
}

export function countDef(state, defId, pred = () => true) {
  let n = 0;
  for (const o of objectsByDef(state).get(defId) ?? []) if (pred(o)) n++;
  return n;
}

/**
 * Ids of the grid objects (object and ground layers) with a tile within Chebyshev distance `r` of the rect
 * (x, z, w, d): "within r tiles" of GDD §2.4/§3.8 effects. Sorted, so callers never depend on scan order.
 */
export function idsAround(state, x, z, w, d, r) {
  const g = getGrid(state);
  const out = new Set();
  for (let tz = z - r; tz < z + d + r; tz++) {
    for (let tx = x - r; tx < x + w + r; tx++) {
      if (!inWorld(tx, tz)) continue;
      const i = tz * WORLD_TILES + tx;
      if (g.object[i] !== null) out.add(g.object[i]);
      if (g.ground[i] !== null) out.add(g.ground[i]);
    }
  }
  return [...out].sort();
}

/** Ids of the objects living in home `homeId`, sorted (key order is not replicated; index.js rule 3). */
export function occupantsOf(state, homeId) {
  const out = [];
  for (const [id, o] of Object.entries(state.farm.objects)) if (o.home === homeId) out.push(id);
  return out.sort();
}

/** Own-key object lookup (never follows the prototype chain), or undefined. */
export const objectOf = (state, id) => (typeof id === 'string' && Object.hasOwn(state.farm.objects, id)
  ? state.farm.objects[id] : undefined);

/** The farmhouse's starting spot (GDD §2.3): the porch spawns are authored relative to it. */
const HOUSE0 = HOME_LAYOUT.structures.find((st) => st.def === 'farmhouse');

/**
 * Where a farmer appears (float tiles): on the farmhouse porch, WHEREVER the farmhouse stands now (the owner's rule
 * 2026-10-04: the landmarks move), turned with it; on the nearest open tile of the farm's land when something stands
 * on that spot (the Barn moved over the porch). The server's presence and the client's avatar both start here, so
 * the partner never sees a walk from the old porch. START.spawn when the farm has no farmhouse.
 */
export function spawnAt(state, pid) {
  const sp = START.spawn[pid] || START.spawn.p1;
  const objs = state?.farm?.objects;
  const def = defOf('farmhouse');
  if (!objs || !def || !HOUSE0) return { x: sp.x, z: sp.z };
  let house = null;
  for (const id of Object.keys(objs).sort()) if (objs[id].def === 'farmhouse' && Number.isFinite(objs[id].x)) { house = objs[id]; break; }
  if (!house) return { x: sp.x, z: sp.z };
  const [w0, d0] = def.size;
  // the porch relative to the farmhouse's centre at rot 0, turned the way the renderer turns the model (yaw = rot x
  // 90 degrees about +Y: local (dx, dz) -> (dz, -dx) per quarter turn)
  let dx = sp.x - (HOUSE0.x + w0 / 2);
  let dz = sp.z - (HOUSE0.z + d0 / 2);
  for (let r = 0; r < ((house.rot ?? 0) & 3); r++) [dx, dz] = [dz, -dx];
  const [w, d] = footprint(def, house.rot ?? 0);
  const at = { x: house.x + w / 2 + dx, z: house.z + d / 2 + dz };
  const open = (tx, tz) => inWorld(tx, tz) && inLand(state, tx, tz) && getGrid(state).object[tz * WORLD_TILES + tx] === null;
  const tx0 = Math.floor(at.x);
  const tz0 = Math.floor(at.z);
  if (open(tx0, tz0)) return at;
  for (let r = 1; r <= 12; r++) {
    let best = null;
    for (let tz = tz0 - r; tz <= tz0 + r; tz++) {
      for (let tx = tx0 - r; tx <= tx0 + r; tx++) {
        if (Math.max(Math.abs(tx - tx0), Math.abs(tz - tz0)) !== r || !open(tx, tz)) continue;
        // ring order: the first open tile scanning rows then columns (deterministic on both sides)
        best = best ?? { x: tx + 0.5, z: tz + 0.5 };
      }
    }
    if (best) return best;
  }
  return { x: sp.x, z: sp.z };
}
