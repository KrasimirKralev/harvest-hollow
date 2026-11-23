// Global tunables shared by server, client, tests and the simulator. Data only: no functions with side
// effects, no clock reads. Changing a value here changes CONTENT_HASH, which makes open clients reload.
import { min } from './units.js';
import { HOME_LAYOUT, SPAWN } from './authored.js';
import { HOME_DEBRIS } from './layout.js';

/** World metres per rule tile. Rules only ever see integer tiles; only the renderer multiplies. */
export const TILE_M = 2;
/** The whole world is WORLD_TILES x WORLD_TILES tiles (GDD §2.1); farmable land is inside [FARM_MIN, FARM_MAX). */
export const WORLD_TILES = 64;
/** Farmable land: 48 x 48 tiles in a 6 x 6 grid of 8 x 8 parcels (GDD §2.1). */
export const FARM_MIN = 8;
export const FARM_MAX = 56;
export const PARCEL_TILES = 8;
/** The last row of the level table; Legacy levels follow at a flat XP step (GDD §4.6). */
export const MAX_LEVEL = 40;
/** Server readiness checks accept this much early arrival (tech §4.3). The client predicts with 0. */
export const READY_GRACE_MS = 250;
/** Refund window of purchase receipts (tech §15.3, GDD §6.3: 10-minute undo, trash and move back). */
export const UNDO_MS = min(10);
/** Window in which a second, different player completes a joint action (tech §15.4, GDD §6.2 mechanic 7). */
export const DUET_MS = 3000;
/** Avatar walking speed in tiles per second; the server allows 1.5x this (tech §6.1). */
export const AVATAR_SPEED = 3;
/** Riding a horse (GDD §3.4, cosmetic): walk speed x1.8; the rider's presence tool is RIDE_TOOL (the server's clamp). */
export const RIDE_SPEED_K = 1.8;
export const RIDE_TOOL = 'horse';
/** farm.ledger is a ring of this many rows (tech §2.5). */
export const LEDGER_MAX = 500;
/** Ids of the two player slots. Order matters: the slot picker lists them in this order. */
export const PLAYER_SLOTS = Object.freeze(['p1', 'p2']);
/** Default colours per slot (GDD §8.2: P1 teal, P2 coral). */
export const SLOT_COLORS = Object.freeze({ p1: '#2BB3A3', p2: '#FF7A6B' });

const freeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) freeze(v);
  }
  return o;
};

// ---- the starter farm (GDD §2.3) ------------------------------------------------------------------------
// v2 makes the GDD and the plot cap agree: 16 tilled plots at start, and the L1 plot cap is 16 (+1.5 a level,
// +6 per expansion, GDD §3.10), so the first extra plot can be placed at L2 — two people can plant side by side
// from minute one, and placing plots is a level-2 reward rather than a minute-one chore.
const { plots: P, fence: F } = HOME_LAYOUT;
const plots = [];
for (let z = P.z; z < P.z + P.d; z++) for (let x = P.x; x < P.x + P.w; x++) plots.push([x, z]);

const fence = [];
for (let z = F.z; z < F.z + F.d; z++) {
  for (let x = F.x; x < F.x + F.w; x++) {
    const ring = x === F.x || z === F.z || x === F.x + F.w - 1 || z === F.z + F.d - 1;
    if (ring && !F.gate.some(([gx, gz]) => gx === x && gz === z)) fence.push([x, z]);
  }
}
const paths = [];
for (const [x0, z0, w, d] of HOME_LAYOUT.paths) {
  for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) paths.push([x, z]);
}

/**
 * Start values of a fresh farm. `plots` are the [x, z] tiles of the tilled starter plots (createFarm names them
 * `home.0.<i>`). `objects` are every other object that exists at minute zero, with their object ids:
 *   home.1.<i>  structures (farmhouse, barn, well, mailbox, Market Stand, Mabel's Order Board): fixed landmarks
 *   home.2.<i>  the picket fence around the plot block (decor: movable, storable)
 *   home.3.<i>  dirt paths (decor on the ground layer)
 *   home.4.<i>  starter debris (weeds, rocks, stumps, logs, boulders; values in debris.js, origin 'home')
 * `tray` lists defs whose first copy waits free in the build tray (GDD §2.3: Chicken Coop and Feed Mill).
 */
export const START = freeze({
  coins: 300,
  acorns: 5,
  expansions: ['home'],
  plots,
  objects: [
    ...HOME_LAYOUT.structures.map((s, i) => ({ id: `home.1.${i}`, def: s.def, x: s.x, z: s.z, rot: 0 })),
    ...fence.map(([x, z], i) => ({ id: `home.2.${i}`, def: 'picket_fence', x, z, rot: 0 })),
    ...paths.map(([x, z], i) => ({ id: `home.3.${i}`, def: 'dirt_path', x, z, rot: 0 })),
    ...HOME_DEBRIS.map((d, i) => ({ id: `home.4.${i}`, def: d.def, x: d.x, z: d.z, rot: 0 })),
  ],
  tray: ['coop', 'feed_mill'],
  // Where each avatar stands at first (the farmhouse porch), in tiles.
  spawn: SPAWN,
});
