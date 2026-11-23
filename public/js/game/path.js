// Walking routes for my farmer (click-to-walk, and the cosmetic walk to whatever was acted on): A* over the tile grid,
// then string-pulled into a few straight legs. Pure and DOM-free (test/sync.path.test.js). Owned by the client-core
// lane.
//
// The farmer walks on the farm's own land (the owned expansions and restored land), never through buildings, homes,
// fences, trees, debris or decor; dirt paths are a little preferred, tilled plots are crossed only when going round
// them costs much more (a field is walkable, but a farmer walks along it, not through the crops), and a Giant is solid.
//
//   walkGrid(state) -> grid          { n, cost: Float32Array (0 = solid), plot: Uint8Array } (cached per farm layout)
//   findPath(grid, from, to) -> { points: [{x, z}, ...], reached, length } | null
//        from/to: float tiles; points excludes `from`, ends at `to` (or, when `to` cannot be reached, at the reachable
//        point nearest to it: reached false); null when the farmer cannot move at all
//   route(state, from, to) -> findPath(walkGrid(state), from, to)
//   escapeTile(grid, from) -> tile index | null   the open tile nearest to a farmer standing inside a footprint
import { WORLD_TILES } from '../../../shared/content/config.js';
import { defOf } from '../../../shared/content/index.js';
import { getGrid, inLand } from '../../../shared/rules/grid.js';

export const COST = Object.freeze({ path: 0.8, grass: 1, plot: 3.5 });
/** Half the farmer's width in tiles: a straight leg keeps this far from anything solid on both sides. */
export const CLEARANCE = 0.26;
const SQRT2 = Math.SQRT2;

let cache = { key: null, grid: null };

/** The walk cost of every tile of the world (0 = solid or off the farm's land). */
export function walkGrid(state) {
  const tiles = getGrid(state);
  const key = `${state.farm.expansions.join(',')}|${JSON.stringify(state.farm.restore ?? null)}`;
  if (cache.grid && cache.tiles === tiles && cache.key === key) return cache.grid;
  const n = WORLD_TILES;
  const cost = new Float32Array(n * n);
  const plot = new Uint8Array(n * n);
  const objs = state.farm.objects;
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      if (!inLand(state, x, z)) continue;
      const id = tiles.object[i];
      if (id) {
        const o = Object.hasOwn(objs, id) ? objs[id] : null;
        const def = o && defOf(o.def);
        // a tilled plot can be crossed (slowly, so the route goes round a field when it can); a Giant cannot
        if (def && def.kind === 'plot' && !(o.crop && typeof o.crop.giant === 'string')) { cost[i] = COST.plot; plot[i] = 1; }
        continue;
      }
      cost[i] = tiles.ground[i] ? COST.path : COST.grass;
    }
  }
  const grid = { n, cost, plot };
  cache = { key, tiles, grid };
  return grid;
}

const tileOf = (v) => Math.floor(v);

/** Every tile a segment of width 2 * CLEARANCE touches is walkable (and no plot unless `plots`). */
export function clear(grid, a, b, plots = false) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / 0.2));
  const nx = len > 0 ? (-dz / len) * CLEARANCE : 0;
  const nz = len > 0 ? (dx / len) * CLEARANCE : 0;
  for (const k of [0, 1, -1]) {
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = tileOf(a.x + dx * t + nx * k);
      const z = tileOf(a.z + dz * t + nz * k);
      if (x < 0 || z < 0 || x >= grid.n || z >= grid.n) return false;
      const i = z * grid.n + x;
      // the start and the end tile themselves may be anything (a farmer standing next to a coop, a click on a bed)
      if ((x === tileOf(a.x) && z === tileOf(a.z)) || (x === tileOf(b.x) && z === tileOf(b.z))) continue;
      if (grid.cost[i] === 0 || (!plots && grid.plot[i])) return false;
    }
  }
  return true;
}

/** A tiny binary heap of [priority, node]. */
function heap() {
  const a = [];
  return {
    get size() { return a.length; },
    push(p, v) {
      a.push([p, v]);
      let i = a.length - 1;
      while (i > 0) {
        const j = (i - 1) >> 1;
        if (a[j][0] <= a[i][0]) break;
        [a[i], a[j]] = [a[j], a[i]];
        i = j;
      }
    },
    pop() {
      const top = a[0];
      const last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < a.length && a[l][0] < a[m][0]) m = l;
          if (r < a.length && a[r][0] < a[m][0]) m = r;
          if (m === i) break;
          [a[i], a[m]] = [a[m], a[i]];
          i = m;
        }
      }
      return top[1];
    },
  };
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];

/**
 * A* from tile (sx, sz) toward (gx, gz), 8-connected without cutting a solid corner. Returns the tile list from the
 * start to the goal, or to the reached tile nearest the goal when the goal cannot be reached.
 */
function astar(grid, sx, sz, gx, gz) {
  const { n, cost } = grid;
  const start = sz * n + sx;
  const goal = gz * n + gx;
  const g = new Float32Array(n * n).fill(Infinity);
  const from = new Int32Array(n * n).fill(-1);
  const done = new Uint8Array(n * n);
  const h = (i) => {
    const dx = Math.abs((i % n) - gx);
    const dz = Math.abs(Math.floor(i / n) - gz);
    return COST.path * (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz));
  };
  const open = heap();
  g[start] = 0;
  open.push(h(start), start);
  let best = start;
  let bestH = h(start);
  while (open.size) {
    const i = open.pop();
    if (done[i]) continue;
    done[i] = 1;
    const hi = h(i);
    if (hi < bestH || (hi === bestH && g[i] < g[best])) { best = i; bestH = hi; }
    if (i === goal) break;
    const x = i % n;
    const z = Math.floor(i / n);
    for (const [dx, dz, step] of DIRS) {
      const x2 = x + dx;
      const z2 = z + dz;
      if (x2 < 0 || z2 < 0 || x2 >= n || z2 >= n) continue;
      const j = z2 * n + x2;
      if (done[j] || cost[j] === 0) continue;
      // a diagonal step never squeezes between two solid tiles' corners
      if (dx && dz && (cost[z * n + x2] === 0 || cost[z2 * n + x] === 0)) continue;
      const gj = g[i] + step * cost[j];
      if (gj < g[j]) { g[j] = gj; from[j] = i; open.push(gj + h(j), j); }
    }
  }
  const end = done[goal] ? goal : best;
  const tiles = [];
  for (let i = end; i !== -1; i = from[i]) tiles.push(i);
  tiles.reverse();
  return { tiles, reached: end === goal };
}

/**
 * A walk from `from` to `to` (float tiles): A* on the grid, then string-pulled into straight legs that keep
 * CLEARANCE from anything solid and cross plots only where the grid route did.
 */
export function findPath(grid, from, to) {
  if (![from.x, from.z, to.x, to.z].every(Number.isFinite)) return null;
  const n = grid.n;
  const inside = (v) => Math.min(n - 1, Math.max(0, tileOf(v)));
  let sx = inside(from.x);
  let sz = inside(from.z);
  const gx = inside(to.x);
  const gz = inside(to.z);
  // standing inside something solid (a building moved or placed onto my farmer, the Barn moved over the porch):
  // step straight out to the nearest open tile first, then route from there
  const exit = grid.cost[sz * n + sx] === 0 ? escapeTile(grid, from) : null;
  if (exit !== null) { sx = exit % n; sz = Math.floor(exit / n); }
  const { tiles, reached } = astar(grid, sx, sz, gx, gz);
  const centre = (i) => ({ x: (i % n) + 0.5, z: Math.floor(i / n) + 0.5 });
  const end = reached ? { x: to.x, z: to.z } : centre(tiles[tiles.length - 1]);
  if (tiles.length === 1 && !reached && exit === null) return null;          // nowhere to go from here
  const raw = [{ x: from.x, z: from.z }, ...(exit !== null ? [centre(exit)] : []), ...tiles.slice(1, -1).map(centre), end];
  const onPlot = raw.map((p) => grid.plot[inside(p.z) * n + inside(p.x)] === 1);
  // string pulling: from each corner, the farthest point still in clear sight
  const out = [];
  let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    for (; j > i + 1; j--) {
      let plots = false;
      for (let k = i; k <= j && !plots; k++) plots = onPlot[k];
      if (clear(grid, raw[i], raw[j], plots)) break;
    }
    out.push(raw[j]);
    i = j;
  }
  let length = 0;
  let prev = from;
  for (const p of out) { length += Math.hypot(p.x - prev.x, p.z - prev.z); prev = p; }
  return { points: out, reached, length };
}

/** How far (tiles) a farmer inside a footprint looks for open ground: the biggest footprint is 6 x 6. */
const ESCAPE_TILES = 8;

/**
 * The walkable tile nearest to `from` (float tiles) within ESCAPE_TILES, or null. Ties go to the lower index, so the
 * same spot always steps out the same way.
 */
export function escapeTile(grid, from) {
  const n = grid.n;
  const fx = Math.min(n - 1, Math.max(0, tileOf(from.x)));
  const fz = Math.min(n - 1, Math.max(0, tileOf(from.z)));
  let best = null;
  let bestD = Infinity;
  for (let r = 1; r <= ESCAPE_TILES; r++) {
    for (let z = fz - r; z <= fz + r; z++) {
      for (let x = fx - r; x <= fx + r; x++) {
        if (Math.max(Math.abs(x - fx), Math.abs(z - fz)) !== r || x < 0 || z < 0 || x >= n || z >= n) continue;
        const i = z * n + x;
        if (grid.cost[i] === 0) continue;
        const d = Math.hypot(x + 0.5 - from.x, z + 0.5 - from.z);
        if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && i < best)) { best = i; bestD = d; }
      }
    }
    // a tile of ring r is at least r - 0.5 away (Euclidean), so once r passes the best distance no ring is nearer
    if (best !== null && r > Math.ceil(bestD)) break;
  }
  return best;
}

/** The route on this farm right now. */
export function route(state, from, to) {
  return findPath(walkGrid(state), from, to);
}
