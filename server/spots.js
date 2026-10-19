// Spots raced like objects (QA r2 I2-01, the sibling of r1's I-01 in shared/net/targets.js). Two farmers placing on
// the same free tile at the same moment: one object is placed, the other action is refused BLOCKED (OCCUPIED in the
// farmhouse room). The refused action names no object id and no board row, so the engine's `touch` / `lastToucher`
// had nothing to match and the loser heard "This spot is not free" instead of "<partner> got there first ♥". The
// engine now also remembers the spots an accepted action took and looks up the spots a refused one wanted.
//
// A spot key is `tile:<layer>:<x>,<z>` on the farm board or `room:<layer>:<x>,<z>` in the farmhouse room (a wall
// piece: `room:wall:<slot>,<wall>`). Like a board row it holds a ':', which an object id never does. The layer is part
// of the key: a Dirt Path (ground) the partner just laid never takes the blame for an old scarecrow (object) that
// blocks a piece over it. A Greenhouse frame (ground) keeps the object layer clear too (grid.js canFit), so it takes
// and wants both layers.
//
// Server only: the client's controller already names the blocker of a local refusal by its object id (blockerOf),
// which the partner's `placed` / `moved` events record, so it needs no spot key.
import { defOf, furnitureOf } from '../shared/content/index.js';
import { tilesOfSize, sizeOf } from '../shared/rules/grid.js';
import { interiorCells } from '../shared/rules/interior-cells.js';

/** The action types that put something on a spot. */
export const SPOT_TYPES = new Set(['place', 'move', 'moveBack', 'restore', 'furnish', 'furnishMove']);
/** At most this many cells per action (the largest footprint is far below it). */
const SPOTS_MAX = 256;

const own = (o, k) => Boolean(o) && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const int = (v) => Number.isSafeInteger(v);
const rotOf = (v) => (int(v) ? v : 0);
const NONE = Object.freeze([]);

/** The farm-board layers a def takes: its own, and the object layer as well for a Greenhouse frame. */
const layersOf = (def) => (def.greenhouse ? ['ground', 'object'] : [def.layer]);

/** Keys of def `def` with size `size` at (x, z, rot) on the farm board. */
function farmKeys(def, size, x, z, rot) {
  if (!def || def.layer === 'none' || !Array.isArray(size) || !int(x) || !int(z)) return NONE;
  const tiles = tilesOfSize(size, x, z, rotOf(rot));
  if (tiles.length > SPOTS_MAX) return NONE;
  const out = [];
  for (const layer of layersOf(def)) for (const [tx, tz] of tiles) out.push(`tile:${layer}:${tx},${tz}`);
  return out;
}

/** Keys of furniture def `def` at `spot` ({ x, z, rot } or { wall, at }) in the farmhouse room. */
function roomKeys(def, spot) {
  if (!def || !spot) return NONE;
  const wall = def.layer === 'wall';
  if (wall ? !(int(spot.at) && typeof spot.wall === 'string') : !(int(spot.x) && int(spot.z))) return NONE;
  const out = [];
  for (const [layer, cells] of interiorCells(def, wall ? { wall: spot.wall, at: spot.at } : { x: spot.x, z: spot.z, rot: rotOf(spot.rot) })) {
    if (cells.length > SPOTS_MAX) return NONE;
    for (const [a, b] of cells) out.push(`room:${layer}:${a},${b}`);
  }
  return out;
}

const objectOf = (state, id) => (typeof id === 'string' && own(state.farm.objects, id) ? state.farm.objects[id] : null);
/** An object's keys where it stands now. */
function standing(o) {
  const def = o && defOf(o.def);
  return def ? farmKeys(def, sizeOf(o, def), o.x, o.z, o.rot) : NONE;
}

/**
 * The spot keys of action `type` with `args` on `state`. `after: false` (a refused action, the state as it refused):
 * the spot the action WANTED. `after: true` (an accepted action, the state after its commit): the spot it TOOK, where
 * a moved-back or restored object now stands. Never throws on garbage; [] for every other action type.
 * @param {object} state @param {string} type @param {unknown} args @param {{ after?: boolean }} [o]
 * @returns {readonly string[]}
 */
export function spotKeys(state, type, args, { after = false } = {}) {
  if (!SPOT_TYPES.has(type) || !args || typeof args !== 'object' || !state || !state.farm) return NONE;
  try {
    switch (type) {
      case 'place': {
        const def = typeof args.def === 'string' ? defOf(args.def) : null;
        return def ? farmKeys(def, def.size, args.x, args.z, args.rot) : NONE;
      }
      case 'move': {
        const o = objectOf(state, args.id);
        const def = o && defOf(o.def);
        return def ? farmKeys(def, sizeOf(o, def), args.x, args.z, args.rot) : NONE;
      }
      case 'moveBack': {
        const o = objectOf(state, args.id);
        if (after) return standing(o);
        const def = o && o.prev && defOf(o.def);
        return def ? farmKeys(def, sizeOf(o, def), o.prev.x, o.prev.z, o.prev.rot) : NONE;
      }
      case 'restore': {
        if (after) return standing(objectOf(state, args.id));
        const t = typeof args.id === 'string' && own(state.farm.trash, args.id) ? state.farm.trash[args.id] : null;
        return t && t.obj ? standing(t.obj) : NONE;
      }
      case 'furnish':
        return roomKeys(typeof args.def === 'string' ? furnitureOf(args.def) : null, args);
      case 'furnishMove': {
        const items = state.farm.interior && state.farm.interior.items;
        const it = typeof args.id === 'string' && own(items, args.id) ? items[args.id] : null;
        return roomKeys(it ? furnitureOf(it.def) : null, args);
      }
      default:
        return NONE;
    }
  } catch {
    return NONE;                                  // a friendlier toast is never worth a failed act
  }
}
