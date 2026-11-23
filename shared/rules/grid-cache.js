// Grid-cache invalidation (part of the Tx contract). The grid index (grid.js) is derived from
// farm.objects and farm.expansions and cached on the state under Symbol keys, which JSON.stringify and
// structuredClone skip, so the cache never leaks into saves or deltas (tech §2.3). Every write path that can
// change a footprint calls touchGrid(), which bumps the version; getGrid() rebuilds lazily on mismatch.

export const GRID_VERSION = Symbol('hh.gridVersion');
export const GRID_CACHE = Symbol('hh.gridCache');
/**
 * Bumped by ANY write under farm.objects (or a wholesale replace): the key of the caches that read objects beyond
 * their footprints (grid.js countDef's index, orders-board.js producers(): wave-2 QA RC-20).
 */
export const OBJ_VERSION = Symbol('hh.objVersion');

// `up` (wave 4: an object's upgrade tier) bumps it too: rules/upgrades.js caches the farm-wide upgrade bonuses on the
// grid version, so a watering stroke reads them once instead of re-scanning the farm per plot
const GRID_FIELDS = new Set(['x', 'z', 'rot', 'def', 'up']);

/** Bump the grid version if a write at `path` can move, add or remove a footprint or unlocked land. */
export function touchGrid(state, path) {
  if (!state || typeof state !== 'object') return;
  const hit = path.length < 2
    ? path.length === 0 || path[0] === 'farm'
    : path[0] === 'farm' && (path[1] === 'expansions'
      || (path[1] === 'objects' && (path.length <= 3 || (path.length === 4 && GRID_FIELDS.has(path[3])))));
  if (hit) state[GRID_VERSION] = (state[GRID_VERSION] ?? 0) + 1;
  const objs = path.length < 2 ? hit : path[0] === 'farm' && path[1] === 'objects';
  if (objs) hide(state, OBJ_VERSION, (state[OBJ_VERSION] ?? 0) + 1);
}

/** Force a rebuild (after replacing state wholesale, e.g. a welcome). */
export function resetGrid(state) {
  state[GRID_VERSION] = (state[GRID_VERSION] ?? 0) + 1;
  hide(state, OBJ_VERSION, (state[OBJ_VERSION] ?? 0) + 1);
}

/**
 * Keep a derived value on the state under a Symbol, NON-enumerable: deep-equal comparisons of states (tests, the
 * invariants' twin runs) never see the caches of wave-2 QA RC-20.
 */
export function hide(state, key, value) {
  if (Object.hasOwn(state, key)) state[key] = value;
  else Object.defineProperty(state, key, { value, writable: true, configurable: true, enumerable: false });
}
