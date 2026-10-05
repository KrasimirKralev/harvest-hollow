// Placed objects: plots and crops, trees, buildings, homes, landmarks, decor, fences and debris (tech §10.3,
// §10.5; GDD §8.6, App. F). Owned by the render-world lane.
//
// Everything is drawn by four BatchedMeshes with vertex colours (one multi-draw call each):
//   soil     plot mounds and ground-layer pieces (receive shadows; wet / composted tint per instance)
//   crops    one cluster geometry per plot and stage, double-sided, wind + cursor sway, no shadow casting
//   trees    trees, sway like breathing canopies, cast shadows
//   statics  buildings, homes, landmarks, large decor, fences, big debris (+ the windmill sails part), cast shadows
//   smalls   1 x 1 decor and small debris: drawn like statics but cast no shadow (RD-13, QA wave 2: 300+ decor pieces
//            were most of the 27.7 ms static shadow refresh on an L25 farm; their footprint AO grounds them)
// Time-driven looks never poll: every object's next visual change (crop stage, ripe tree, finished craft) sits
// in a min-heap keyed by time; a frame pops only what came due (tech §10.5). A store change re-reads exactly
// the changed ids.
//
//   visualOf(o, def, now, { barnLevel }) -> { key, crop?, ready, working, done, nextAt, ... }   pure (tested)
//   createHeap() -> { push(at, id), popDue(now, fn), size, peek }                               (tested)
//   createObjectsView(layers, { fx, badges, now }) -> objects
//     setState(state) / sync(ids, topics, state) / update(dt, tMs) -> 0|1|2
//     worldPosOf(id) -> Vector3 | null (metres, footprint centre, y = 0)   topOf(id) -> metres
//     shake(id) / hidden(id, bool) / hover(id | null) / tint(id, color | null)
//     proxies() -> [{ id, box: Box3 }] of tall objects (picking)   onStaticChange(fn) (shadow cache)
//     inspect(id) -> { kind, key, cropKey, ready, working, nextAt, twinkle, ... } (tests, dev tools)
//     setMotion(mode) / setBand(band) / stats()
//     setMe(pid) / setRaining(bool)     who looks (the partner-tend pin) and the weather (no water pins in rain)
//     needs() -> { ready, water }       counts of things asking for the player (the calm, tidy board: RD-40)
//     noteAt(x, z) -> noteId | null      a note pinned to a tile (picking)
// Wave 4b (render lane, the owners' wish list of 2026-10-05):
//   homes grow (wish 3): a home's footprint is the rules' own (grid.objFootprint: a grown home covers its whole paddock);
//     it draws `home:<id>:g<t>` (the pen t tiles bigger each way, the house where it stood) and, without that model, its
//     base model stretched over the footprint; objFootprint(o, def) / homeTier(o, def) are exported (pure)
//   trees age (wish 4): a tree shows its age stage's size (rules treeAgeOf: young / mature / grand, content TREE_AGE
//     scaleBp, capped at AGE_SCALE_MAX) and grows into it with a little spring when it comes of age; treeScale(o) (pure)
//   the relics (wish 2): the Golden Sprinkler's head turns (`<key>:spin`, a part like the windmill's sails, about +y) and
//     throws three arcs of water now and then; the Growth Totem breathes a soft green ring over its reach and lets a few
//     leaves drift up from its gem; the Golden Barn (farm.relics.golden_barn) wears a gilded cupola on its ridge
// Ready plots get three staggered warm glints (keys `<id>#0..2`) and a warm soil tint; dry crops and trees that
// can be watered get a teardrop pin (visual-05, ui-ux-06); production buildings get a few cosmetic props at their
// door side on free tiles (visual-23); notes are paper sprites in the author's colour (coop-robust-16).
import * as THREE from 'three';
import { defOf, cropOf, itemOf, CONTENT, GROWTH } from '../../../shared/content/index.js';
import { TILE_M, WORLD_TILES } from '../../../shared/content/config.js';
import { footprint } from '../../../shared/rules/grid.js';
import * as grid from '../../../shared/rules/grid.js';
import * as content from '../../../shared/content/index.js';
import { stage, isReady, nextVisualChangeAt } from '../../../shared/rules/time.js';
import { models, addShaderPatch } from './models.js';
import { bandKeys, createBatch, mirrorBatch } from './instancing.js';
import { LOD } from './lod.js';
import { landTiles, cheapShadows } from './ground.js';
import { giantBlocks, setsOfDef, decorSetsOf, isHeirloomTree } from './world-state.js';
import { flag, cyl, merge, modelKey, boundsOfKey, ball, cone, box, geoPart } from './world-kit.js';
import { greenhouseGeometry } from './restoration-view.js';
import { isCrateDef } from './crates-view.js';
import { WORLD, addSway, addFoliageTint } from './world-uniforms.js';

const N = WORLD_TILES;
const HALF_PI = Math.PI / 2;

// ---------------------------------------------------------------------------------------------------
// Pure helpers

/** The decor Fishing Dock's own little pool (GDD §6.2 #21, decor `pond_dock` L28, effect.cosmetic 'fishing'): a round
 *  pond within its 2 x 2 footprint under the dock's water end, with a stone and reed rim and two lily pads (wave 3). */
export function dockPoolGeometry() {
  const parts = [cyl(1.85, 1.95, 0.05, 20, '#6E7A4A', { x: 0.35, y: 0 }), cyl(1.65, 1.65, 0.05, 20, '#3F8FA6', { x: 0.35, y: 0.02 }, { shade: false }),
    cyl(1.0, 1.0, 0.05, 16, '#357C95', { x: 0.5, y: 0.03 }, { shade: false })];
  for (let k = 0; k < 11; k++) {
    const a = 0.7 + (k / 11) * Math.PI * 1.65;
    parts.push(ball(0.16 + (k % 3) * 0.04, ['#B8B0A2', '#A39A8A', '#C9C0AE'][k % 3], { x: 0.35 + Math.cos(a) * 1.78, y: 0.04, z: Math.sin(a) * 1.78, sy: 0.55 }));
    if (k % 3 === 1) for (let j = 0; j < 3; j++) parts.push(cone(0.035, 0.55 + j * 0.12, 4, '#6E8A3A', { x: 0.35 + Math.cos(a + 0.12) * 1.62 + j * 0.06, y: 0.04, z: Math.sin(a + 0.12) * 1.62 }));
  }
  for (const [x, z] of [[0.9, -0.9], [1.3, 0.55]]) parts.push(cyl(0.22, 0.22, 0.02, 8, '#4E8A3A', { x, y: 0.075, z }, { shade: false }));
  parts.push(ball(0.06, '#F7D6E2', { x: 1.3, y: 0.12, z: 0.55 }, { shade: false }));
  void box; void geoPart;
  return merge(parts);
}

/** The Golden Barn's gilded cupola (wave 4b relic, farm.relics.golden_barn): a white louvred lantern with a gold
 *  pyramid roof, a gold ball and a star vane, standing on the barn's ridge (origin = its foot). */
export function goldenCupolaGeometry() {
  const G = '#F2C230'; const GL = '#FFE07A'; const W = '#FFF8EC';
  const parts = [box(1.0, 0.18, 1.0, '#C8473A', { y: 0 }), box(0.86, 0.72, 0.86, W, { y: 0.16 })];
  for (const [rx, x, z] of [[0, 0, 0.44], [0, 0, -0.44], [HALF_PI, 0.44, 0], [HALF_PI, -0.44, 0]]) {
    for (let k = 0; k < 4; k++) parts.push(box(0.5, 0.04, 0.03, '#7A5A40', { x, y: 0.3 + k * 0.11, z, ry: rx }));
  }
  parts.push(cone(0.74, 0.55, 4, G, { y: 0.88, ry: Math.PI / 4 }), box(0.98, 0.06, 0.98, GL, { y: 0.86 }), ball(0.11, GL, { y: 1.5 }));
  parts.push(cyl(0.02, 0.02, 0.6, 4, G, { y: 1.5 }), box(0.5, 0.025, 0.025, G, { y: 1.85 }), box(0.025, 0.025, 0.5, G, { y: 1.85 }));
  const star = new THREE.CylinderGeometry(0.16, 0.16, 0.03, 5).rotateX(HALF_PI);
  parts.push(geoPart(star, GL, { y: 2.06 }), ball(0.05, G, { y: 1.85, x: 0.27 }), ball(0.05, G, { y: 1.85, x: -0.27 }));
  return merge(parts);
}

/** FNV-1a 32 of a string (stable per object id on both screens). */
export function hashId(s, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return h >>> 0;
}

/** Min-heap of (at, id); stale entries are skipped by the caller (lazy deletion). */
export function createHeap() {
  const a = [];
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  };
  const down = (i) => {
    for (;;) {
      const l = i * 2 + 1; const r = l + 1; let m = i;
      if (l < a.length && a[l][0] < a[m][0]) m = l;
      if (r < a.length && a[r][0] < a[m][0]) m = r;
      if (m === i) break;
      [a[m], a[i]] = [a[i], a[m]]; i = m;
    }
  };
  return {
    get size() { return a.length; },
    peek() { return a.length ? a[0][0] : Infinity; },
    push(at, id) { a.push([at, id]); up(a.length - 1); },
    /** Pop every entry with at <= now, calling fn(id, at). */
    popDue(now, fn) {
      let n = 0;
      while (a.length && a[0][0] <= now) {
        const top = a[0];
        const last = a.pop();
        if (a.length) { a[0] = last; down(0); }
        fn(top[1], top[0]);
        n++;
      }
      return n;
    },
    clear() { a.length = 0; },
  };
}

const firstFinite = (...v) => v.find((x) => Number.isFinite(x));

/** [w, d] of object `o` at its rotation (wave 4b): the rules' own footprint (a grown home covers its whole paddock),
 *  else its def's. Pure. */
export function objFootprint(o, def) {
  if (typeof grid.objFootprint === 'function' && def) return grid.objFootprint(o, def);
  return footprint(def, o.rot || 0);
}

/** How many tiles a home has grown each way (wave 4b, owner wish 3): 0 = its def's own pen. Pure. */
export function homeTier(o, def) {
  if (!def || def.kind !== 'home' || typeof grid.sizeOf !== 'function' || !Array.isArray(def.size)) return 0;
  const sz = grid.sizeOf(o, def);
  return Array.isArray(sz) ? Math.max(0, sz[0] - def.size[0]) : 0;
}

/** The biggest a tree grows with age (wave 4b): a grand tree still keeps inside its 2 x 2 tiles. */
export const AGE_SCALE_MAX = 1.3;
/** The size a tree shows for its age (wave 4b, owner wish 4): every harvest is a year (`cycle`), the stage is content
 *  TREE_AGE's (the rules' treeAgeOf reads the same table; its module cannot be imported here without the rules index),
 *  its `scaleBp` the size, capped; 1 in a build without tree ages. Pure. */
export function treeScale(o) {
  const st = content.TREE_AGE && content.TREE_AGE.stages;
  if (!Array.isArray(st) || !st.length) return 1;
  const years = Number.isSafeInteger(o?.cycle) && o.cycle > 0 ? o.cycle : 0;
  let i = 0;
  while (i + 1 < st.length && years >= st[i + 1].from) i++;
  const k = Number.isFinite(st[i].scaleBp) ? st[i].scaleBp / 10_000 : 1;
  return Math.min(AGE_SCALE_MAX, Math.max(1, k));
}

/** The look of a tree: sapling / young (its first cycles), stump (a chopped pine regrowing), mature, ready. */
function treeVisual(o, def, now) {
  const cycleMs = def.cycleMs || 3_600_000;
  const sapMs = (def.saplingCycles ?? 2) * cycleMs;
  const start = firstFinite(o.startedAt, o.placedAt, now);
  const matureAt = o.mature === true ? -Infinity : firstFinite(o.matureAt, o.grownAt, firstFinite(o.placedAt, start) + sapMs);
  if (now < matureAt) {
    const half = matureAt - sapMs / 2;
    return { state: now < half ? 'sapling' : 'young', ready: false, nextAt: now < half ? half : matureAt };
  }
  const ready = o.readyAt !== null && o.readyAt !== undefined && now >= o.readyAt;
  if (ready) return { state: 'ready', ready: true, nextAt: null };
  let state = 'mature';
  let nextAt = Number.isFinite(o.readyAt) ? o.readyAt : null;
  // A chopped woodlot pine shows its stump, then a young pine, while the next cycle grows (GDD §3.2 rule 9).
  if (def.tool === 'axe' && Number.isFinite(o.readyAt) && (o.cycle || 0) > 0 && Number.isFinite(o.startedAt)) {
    const span = o.readyAt - o.startedAt;
    const p = span > 0 ? (now - o.startedAt) / span : 1;
    if (p < 0.3) { state = 'stump'; nextAt = o.startedAt + Math.ceil(span * 0.3); }
    else if (p < 0.65) { state = 'young'; nextAt = o.startedAt + Math.ceil(span * 0.65); }
  }
  return { state, ready: false, nextAt };
}

/** Queue state of a production building: working item, finished items in the tray, next change. */
function buildingVisual(o, now) {
  const q = Array.isArray(o.queue) ? o.queue : [];
  let working = null;
  let done = 0;
  let nextAt = null;
  let doneItem = null;
  for (const it of q) {
    const s = firstFinite(it.s, it.startedAt, it.start);
    const e = firstFinite(it.e, it.readyAt, it.endsAt, it.end);
    if (!Number.isFinite(e)) continue;
    if (e <= now) { done++; if (!doneItem) doneItem = it.r ?? it.recipe ?? null; continue; }
    if (Number.isFinite(s) && s > now) { nextAt = nextAt === null ? s : Math.min(nextAt, s); continue; }
    if (!working) working = it.r ?? it.recipe ?? true;
    nextAt = nextAt === null ? e : Math.min(nextAt, e);
  }
  const tray = Array.isArray(o.tray) ? o.tray.length : (o.tray && typeof o.tray === 'object' ? Object.keys(o.tray).length : 0);
  if (tray && !doneItem) {
    const t0 = Array.isArray(o.tray) ? o.tray[0] : null;
    doneItem = t0 && (t0.r ?? t0.recipe ?? t0.item ?? null);
  }
  return { working, done: done + tray, doneItem, nextAt };
}

/** Manifest key for a def that is not a plot, crop or tree. `tier` (wave 4, wish E: `objects[id].up`, the upgrade
 *  tiers bought) picks `<key>:<tier>` (the highest the manifest has, at most 3) for the farmhouse, the Well, the Market
 *  Stand and the benches. */
export function staticKey(defId, barnLevel = 0, tier = 0) {
  if (defId === 'barn' && barnLevel > 0) {
    const k = `building:barn:${Math.min(3, barnLevel)}`;
    if (models.has(k)) return k;
  }
  const base = models.keyOf(defId) || null;
  if (base && tier > 0) for (let t = Math.min(3, tier); t >= 1; t--) if (models.has(`${base}:${t}`)) return `${base}:${t}`;
  return base;
}

/**
 * Everything the view shows for one object at one moment. Pure (models' manifest lookups only).
 * Returns null for objects the objects view does not draw (animals live in animals-view).
 */
export function visualOf(o, def, now, { barnLevel = 0 } = {}) {
  if (!def || def.layer === 'none') return null;
  // wave 4b: a balloon loot crate is drawn by crates-view (its fall, hop and opening), never as a static model here
  if (isCrateDef(def)) return null;
  if (def.kind === 'plot') {
    const c = o.crop;
    if (!c) return { kind: 'plot', key: 'plot', crop: null, ready: false, nextAt: null, wet: false, compost: Boolean(o.compost) };
    const cdef = cropOf(c.def);
    const s = cdef ? stage(cdef, c, now) : 0;
    const ready = isReady(c, now);
    // the watering pin: crops of >= 30 min that nobody watered yet; the partner tend when only it is missing
    const waterable = Boolean(cdef) && !ready && cdef.growMs >= GROWTH.water.minCropMs;
    return {
      kind: 'plot', key: 'plot', crop: models.cropKey(c.def, ready && cdef ? cdef.stages.length - 1 : s), cropId: c.def, stage: s,
      ready, nextAt: cdef && !ready ? nextVisualChangeAt(cdef, c, now) : null,
      // rules-economy: crop.water (a pid or 'sys'), crop.tend (the partner tend); compost lives on the PLOT
      wet: Boolean(c.water || c.tend), compost: Boolean(o.compost || c.compost),
      // wave 4 (wish 2): a Fertilizer on the crop (rules `crop.fert` = who spread it; a plot may also carry it)
      fert: Boolean(c.fert || o.fert),
      golden: Boolean(c.golden),
      thirsty: waterable && c.water === undefined, tendBy: waterable && c.water !== undefined && c.tend === undefined ? c.water : null,
    };
  }
  if (def.kind === 'tree') {
    const t = treeVisual(o, def, now);
    const growing = !t.ready && t.state !== 'stump';
    const base = models.treeKey(def.id, t.state);
    // an Heirloom (GDD §3.2 rule 8): the old gnarled tree with its blue ribbon, once grown
    const hk = (t.state === 'mature' || t.state === 'ready') && isHeirloomTree(o) ? `${base}:heirloom` : null;
    return { kind: 'tree', key: hk && models.has(hk) ? hk : base, state: t.state, ready: t.ready, nextAt: t.nextAt, age: treeScale(o),
      wet: Boolean(o.water || o.watered), compost: Boolean(o.compost || o.composted),
      thirsty: growing && o.water === undefined, tendBy: growing && o.water !== undefined && o.tend === undefined ? o.water : null };
  }
  // a home's `up` counts its room steps (rules), never an upgrade tier: its look follows the footprint it has grown to
  const home = def.kind === 'home';
  let key = staticKey(def.id, def.id === 'barn' ? barnLevel : 0, !home && Number.isInteger(o.up) && o.up > 0 ? o.up : 0);
  if (home) {
    const g = homeTier(o, def);
    if (g > 0) {
      const gk = key && models.has(`${key}:g${g}`) ? `${key}:g${g}` : null;
      // without its grown model the base pen is stretched over the bigger footprint (never a pen smaller than its tiles)
      const [w, d] = def.size;
      return { kind: def.kind, key: gk || key, ready: false, nextAt: null, grow: g, stretch: gk ? null : [(w + g) / w, (d + g) / d] };
    }
  }
  if (def.kind === 'building') {
    const b = buildingVisual(o, now);
    const slots = Array.isArray(def.slots) ? def.slots[0] : 2;
    const cap = Number.isFinite(o.slots) ? o.slots : slots;
    return { kind: 'building', key, ready: b.done > 0, working: Boolean(b.working), done: b.done, doneItem: b.doneItem,
      full: b.done > 0 && Array.isArray(o.queue) && o.queue.length >= cap, nextAt: b.nextAt };
  }
  return { kind: def.kind, key, ready: false, nextAt: null };
}

/**
 * The watering pin an object shows to player `me` (pure, tested): 'need' (nobody watered it yet), 'tend' (the
 * partner watered it and my tend still adds -5 %), or null. No pins while it rains (the rain waters crops).
 */
export function waterPin(vis, me, raining = false) {
  if (!vis || raining) return null;
  if (vis.thirsty) return 'need';
  if (vis.tendBy && vis.tendBy !== me) return 'tend';
  return null;
}

/** The glints of a ripe plot (pure, tested): one brief lead glint (fx.js plays it every 3-6 s, staggered per plot) and
 *  two tiny drifting motes in warm cream (RD-09, QA wave 2: the big gold stars outshouted the crops: -58 % size). */
export const GLINT = Object.freeze({ lead: 0.38, golden: 0.5, mote: 0.16, color: '#FFE6A0', gold: '#FFD84A' });
export function glintsOf(h, top, golden = false) {
  const base = (h % 1000) / 1000;
  const color = golden ? GLINT.gold : GLINT.color;
  const lift = Math.max(0.55, top * 0.75);
  return [
    { dx: 0, dz: 0, y: lift + 0.1, size: golden ? GLINT.golden : GLINT.lead, phase: base, color },
    { dx: 0.5, dz: -0.35, y: lift * 0.7, size: GLINT.mote, phase: (base + 0.33) % 1, color },
    { dx: -0.4, dz: 0.45, y: lift * 0.6, size: GLINT.mote, phase: (base + 0.66) % 1, color },
  ];
}

// Each production building keeps ONE working corner by its door (visual-after A3 / C8: props read as used, not
// scattered): the goods it handles, piled against its wall. [key, dx, dz, yaw, scale, y] in tile-local metres
// (dz toward the building wall), from the corner tile's centre.
const PILES = {
  grain: [['prop:sack', -0.35, 0.45, 0.3, 1], ['prop:sack', 0.2, 0.5, -0.4, 0.95], ['prop:barrel', 0.55, -0.05, 0, 0.9], ['prop:sack', -0.15, -0.15, 1.2, 0.9]],
  dairy: [['prop:milk_can', -0.4, 0.4, 0, 1], ['prop:milk_can', 0.12, 0.45, 0.6, 1], ['prop:milk_can', -0.15, -0.1, 1.1, 0.95], ['prop:crate', 0.55, 0.15, 0.2, 0.85]],
  fruit: [['prop:crate', -0.3, 0.35, 0.1, 0.95], ['prop:crate', -0.3, 0.35, -0.2, 0.8, 0.62], ['prop:barrel', 0.5, 0.3, 0, 0.9], ['prop:crate', 0.2, -0.35, 0.5, 0.85]],
  kitchen: [['prop:crate', -0.35, 0.4, -0.1, 0.9], ['prop:sack', 0.25, 0.45, 0.5, 0.95], ['prop:barrel', 0.5, -0.15, 0, 0.85]],
  wood: [['prop:crate_stack', -0.1, 0.4, 0, 0.9], ['prop:barrel', 0.6, -0.1, 0, 0.85], ['prop:crate', -0.55, -0.25, 0.4, 0.8]],
  cloth: [['prop:crate', -0.3, 0.4, 0.2, 0.9], ['prop:hay_bale', 0.45, 0.35, 0, 0.75], ['prop:sack', 0, -0.25, 0.9, 0.9]],
  any: [['prop:crate', -0.3, 0.4, 0.15, 0.95], ['prop:sack', 0.3, 0.45, -0.3, 0.95], ['prop:barrel', 0.45, -0.2, 0, 0.85], ['prop:crate', -0.3, 0.4, -0.25, 0.75, 0.66]],
};
const PILE_OF = { feed_mill: 'grain', mill: 'grain', bakery: 'grain', dairy: 'dairy', juice_press: 'fruit', preserves: 'fruit',
  kitchen: 'kitchen', pie_oven: 'kitchen', sawmill: 'wood', weaver: 'cloth', sewing: 'cloth', chandlery: 'kitchen', packing: 'wood' };

/**
 * The working corner of a production building (visual-23, visual-after A3; pure, tested): its goods piled on ONE
 * free owned tile beside the door (the front corner tiles first, then the sides), pushed against the wall, the door
 * tile itself always clear. `free(x, z)` says whether a tile is owned and empty; a prop only ever stands on a free
 * tile, so the rules never see it and the next placement there simply removes it.
 * Returns [{ key, x, z, y, yaw, s }] in metres.
 */
export function doorProps(o, def, h, free) {
  const [w, d] = footprint(def, o.rot || 0);
  const r = ((o.rot || 0) % 4 + 4) % 4;
  const x0 = o.x; const z0 = o.z; const x1 = o.x + w - 1; const z1 = o.z + d - 1;
  // candidate tiles: [tile x, tile z, push toward the building (dx, dz)]; the door (front middle) stays clear
  const front = [[0, 1], [1, 0], [0, -1], [-1, 0]][r];
  const cand = [];
  const flip = (h >>> 3) & 1;                       // which front corner is the working one: per building
  if (r === 0) cand.push([flip ? x1 : x0, z1 + 1], [flip ? x0 : x1, z1 + 1], [x0 - 1, z1, 1, 0], [x1 + 1, z1, -1, 0]);
  else if (r === 1) cand.push([x1 + 1, flip ? z1 : z0], [x1 + 1, flip ? z0 : z1], [x1, z0 - 1, 0, 1], [x1, z1 + 1, 0, -1]);
  else if (r === 2) cand.push([flip ? x1 : x0, z0 - 1], [flip ? x0 : x1, z0 - 1], [x0 - 1, z0, 1, 0], [x1 + 1, z0, -1, 0]);
  else cand.push([x0 - 1, flip ? z1 : z0], [x0 - 1, flip ? z0 : z1], [x0, z0 - 1, 0, 1], [x0, z1 + 1, 0, -1]);
  let spot = null;
  for (const [tx, tz, px, pz] of cand) {
    if (!free(tx, tz)) continue;
    spot = { tx, tz, px: px ?? -front[0], pz: pz ?? -front[1] };
    break;
  }
  if (!spot) return [];
  const pile = PILES[PILE_OF[def.id] || 'any'];
  // tile-local axes: "in" toward the wall (px, pz), "side" along it; mirrored per building so no two piles match
  const side = (h >>> 5) & 1 ? 1 : -1;
  const cx = (spot.tx + 0.5) * TILE_M; const cz = (spot.tz + 0.5) * TILE_M;
  const out = [];
  pile.forEach(([key, dx, dz, yaw, sc, y = 0], i) => {
    const sx = dx * side; const sin = dz + 0.15;
    out.push({ key, x: cx + spot.px * sin * TILE_M * 0.5 - spot.pz * sx * TILE_M * 0.5, z: cz + spot.pz * sin * TILE_M * 0.5 + spot.px * sx * TILE_M * 0.5,
      y, yaw: yaw + (((h >>> (i * 2 + 7)) & 3) - 1.5) * 0.12 + Math.atan2(spot.px, spot.pz), s: sc * (0.95 + ((h >>> (i + 11)) & 7) / 70) });
  });
  return out;
}

/** Item id a finished recipe yields (for the tray badge icon). */
export function productOf(recipeId) {
  const r = recipeId && CONTENT.recipes.get(recipeId);
  if (r) return r.item || r.id;
  if (recipeId && itemOf(recipeId)) return recipeId;
  const f = recipeId && CONTENT.feeds.get(recipeId);
  return f ? f.id : null;
}

/** Fence auto-join: which of the 4 neighbours (E, S, W, N) also hold a joining fence. */
export function fenceLinks(fenceTiles, x, z) {
  const has = (i, j) => i >= 0 && j >= 0 && i < N && j < N && fenceTiles.has(j * N + i);
  return { e: has(x + 1, z), s: has(x, z + 1), w: has(x - 1, z), n: has(x, z - 1) };
}

/**
 * The tilled plot: a raised soil mound with a lighter beveled rim and furrows across the top (GDD §8.1,
 * visual-ux-juice §3.6 state 0), 76 triangles instead of a ~1k-triangle mesh, so a 164-plot field costs 12k.
 */
export function plotGeometry(tiles = 1) {
  const half = 0.92 * tiles + (tiles - 1) * 0.08;   // 1.84 m: the 0.92 fill of a 2 m tile (a giant bed: 3 x 3 tiles)
  const top = half - 0.18;               // plateau half-size
  const h = 0.13 + (tiles - 1) * 0.02;
  const ridges = 3 * tiles - (tiles > 1 ? 2 : 0);
  const seg = 12;
  const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const valley = lin('#5E3820');
  const ridge = lin('#8A5A33');
  const rim = lin('#9B6A3E');
  const base = lin('#6A4428');
  const pos = []; const col = []; const idx = [];
  const yAt = (z) => h + 0.028 * Math.cos(((z + top) / (2 * top)) * ridges * 2 * Math.PI);
  const colAt = (z) => { const k = 0.5 + 0.5 * Math.cos(((z + top) / (2 * top)) * ridges * 2 * Math.PI); return valley.map((v, i) => v + (ridge[i] - v) * k); };
  // top: seg strips along z, each spanning the full width in x
  for (let j = 0; j <= seg; j++) {
    const z = -top + (2 * top * j) / seg;
    for (const x of [-top, top]) { pos.push(x, yAt(z), z); col.push(...colAt(z)); }
  }
  for (let j = 0; j < seg; j++) { const a = j * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  // left and right flanks follow the furrow profile down to the base
  const flank = (sx) => {
    const b0 = pos.length / 3;
    for (let j = 0; j <= seg; j++) {
      const z = -top + (2 * top * j) / seg;
      pos.push(sx * top, yAt(z), z); col.push(...rim);
      pos.push(sx * half, 0, z * (half / top)); col.push(...base);
    }
    for (let j = 0; j < seg; j++) {
      const a = b0 + j * 2;
      if (sx > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  flank(-1); flank(1);
  // front and back slopes (straight edges)
  const slope = (sz) => {
    const b0 = pos.length / 3;
    const y = yAt(sz * top);
    pos.push(-top, y, sz * top, top, y, sz * top, -half, 0, sz * half, half, 0, sz * half);
    for (let k = 0; k < 2; k++) col.push(...rim);
    for (let k = 0; k < 2; k++) col.push(...base);
    if (sz > 0) idx.push(b0, b0 + 2, b0 + 1, b0 + 1, b0 + 2, b0 + 3); else idx.push(b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2);
  };
  slope(-1); slope(1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Night lights: warm additive halos (lantern decor, the glow of windows spilling in front of buildings) whose
 * strength follows WORLD.uNight, so by day they cost one draw of nothing and at night the farm glows (GDD
 * §8.4: windows and lanterns glow, no real point lights). One instanced draw.
 */
export function createGlows(layer) {
  const base = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uNight: WORLD.uNight, uTime: WORLD.uTime },
    vertexShader: /* glsl */`
      attribute vec4 aGlow;          // xyz world, w size (metres)
      attribute vec4 aTint;          // rgb, a = 1 billboard | 0 ground pool
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vFlick;
      void main() {
        vUv = uv;
        vTint = aTint.rgb;
        vFlick = 0.9 + 0.1 * sin( uTime * 7.0 + aGlow.x * 3.1 ) * sin( uTime * 3.3 + aGlow.z );
        if ( aTint.a > 0.5 ) {
          vec4 mv = modelViewMatrix * vec4( aGlow.xyz, 1.0 );
          mv.xy += position.xy * aGlow.w;
          gl_Position = projectionMatrix * mv;
        } else {
          vec3 p = aGlow.xyz + vec3( position.x, 0.0, -position.y ) * aGlow.w;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
        }
      }`,
    fragmentShader: /* glsl */`
      uniform float uNight;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vFlick;
      void main() {
        float r = length( vUv - 0.5 ) * 2.0;
        float a = pow( max( 0.0, 1.0 - r ), 2.2 ) * uNight * vFlick;
        if ( a < 0.003 ) discard;
        gl_FragColor = vec4( vTint * a, a );
      }`,
  });
  let cap = 0;
  let mesh = null;
  const items = new Map();       // key -> [{ pos, size, color, billboard }]
  let dirty = false;
  const build = (n) => {
    cap = n;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    if (mesh) { mesh.geometry.dispose(); mesh.geometry = geo; } else {
      mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 12;
      mesh.name = 'glows';
      layer.add(mesh);
    }
  };
  build(32);
  return {
    set(key, list) {
      if (list && list.length) items.set(key, list); else if (!items.delete(key)) return;
      dirty = true;
    },
    update() {
      if (mesh) mesh.visible = WORLD.uNight.value > 0.01 && items.size > 0;
      if (!dirty) return;
      dirty = false;
      let n = 0;
      for (const l of items.values()) n += l.length;
      if (n > cap) build(Math.max(cap * 2, n));
      const g = mesh.geometry.getAttribute('aGlow');
      const t = mesh.geometry.getAttribute('aTint');
      let i = 0;
      for (const l of items.values()) {
        for (const it of l) {
          g.setXYZW(i, it.pos.x, it.pos.y, it.pos.z, it.size);
          t.setXYZW(i, it.color.r, it.color.g, it.color.b, it.billboard ? 1 : 0);
          i++;
        }
      }
      mesh.geometry.instanceCount = i;
      g.needsUpdate = true;
      t.needsUpdate = true;
    },
  };
}

/**
 * Soft gold rings lying on the ground (decor-set placement glow, GDD §3.8 decor sets): one instanced draw, only
 * while a set piece is being placed. ring(x, z, r, k): centre (metres), radius (metres), strength 0..1.
 */
export function createRings(layer) {
  const base = new THREE.PlaneGeometry(2, 2);
  base.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    uniforms: { uTime: WORLD.uTime, uColor: { value: new THREE.Color('#FFD166') } },
    vertexShader: /* glsl */`
      attribute vec4 aRing;
      varying vec2 vUv; varying float vK; varying float vR;
      void main() {
        vUv = uv; vK = aRing.w; vR = aRing.z;
        vec3 p = vec3( aRing.x, 0.08, aRing.y ) + position * aRing.z;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uColor;
      varying vec2 vUv; varying float vK; varying float vR;
      void main() {
        float d = length( vUv - 0.5 ) * 2.0;
        float w = clamp( 0.35 / vR, 0.01, 0.2 );                 // ~0.35 m wide whatever the radius
        float ring = smoothstep( 1.0, 1.0 - w * 0.5, d ) * smoothstep( 1.0 - w * 2.0, 1.0 - w, d );
        float fill = ( 1.0 - smoothstep( 0.0, 1.0, d ) ) * 0.12;
        float pulse = 0.8 + 0.2 * sin( uTime * 6.2832 );
        float a = ( ring * 0.9 + fill ) * vK * pulse;
        if ( a < 0.01 ) discard;
        gl_FragColor = vec4( mix( uColor, vec3( 1.0 ), ring * 0.35 ), a );
        #include <colorspace_fragment>
      }`,
  });
  let cap = 0;
  let mesh = null;
  const build = (n) => {
    cap = n;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    geo.setAttribute('aRing', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    if (mesh) { mesh.geometry.dispose(); mesh.geometry = geo; } else {
      mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      mesh.name = 'setRings';
      layer.add(mesh);
    }
    mesh.geometry.instanceCount = 0;
  };
  build(16);
  return {
    set(list) {
      if (list.length > cap) build(Math.max(cap * 2, list.length));
      const a = mesh.geometry.getAttribute('aRing');
      list.forEach((r, i) => a.setXYZW(i, r.x, r.z, r.r, r.k));
      a.needsUpdate = true;
      mesh.geometry.instanceCount = list.length;
      mesh.visible = list.length > 0;
    },
    get count() { return mesh.geometry.instanceCount; },
  };
}

// window light, in the pane (visual-15, visual-after D4); RD-05 (QA wave 2): warmer #FFD18A, and its pool on the
// ground 2.2 m across and brighter, so the darker blue night has warm, inhabited focal points
const WARM = new THREE.Color('#FFD18A');
const WARM_SPILL = new THREE.Color('#FFD18A').multiplyScalar(0.6);
const LAMP = new THREE.Color('#FFD27A');

// ---------------------------------------------------------------------------------------------------
const WET = new THREE.Color(0.66, 0.6, 0.58);
const DRY = new THREE.Color(1.07, 1.05, 1.0);       // a thirsty plot's soil: dusty and pale (the quiet "needs water")
const COMPOST = new THREE.Color(0.86, 0.8, 0.74);
const WET_COMPOST = new THREE.Color(0.6, 0.54, 0.5);
// wave 4 (wish 2): a fertilized plot's loam is darker and a little green-gold (rich, fed soil), wet or dry
const FERT = new THREE.Color(0.74, 0.8, 0.6);
const WET_FERT = new THREE.Color(0.52, 0.58, 0.44);
const WHITE = new THREE.Color(1, 1, 1);
const READY = new THREE.Color(1.1, 1.1, 1.06);     // crops: the shader reads r - b > 0.02 as "ripe" (the pulse)
const READY_SOIL = new THREE.Color(1.1, 1.0, 0.84);  // a warm glow in the soil under a ripe field (visual-05)
const HOVER = 1.14;

const outBack = (t) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };
const outCubic = (t) => 1 - (1 - t) ** 3;

export function createObjectsView(layers, { fx = null, badges = null, now: nowFn = () => Date.now() } = {}) {
  let now = nowFn;
  // Materials: render-life's look (wrap lighting + rim) with our sway and season tint on top.
  const soilMat = models.createMaterial();
  addShaderPatch(soilMat, 'hh-shadow2', cheapShadows, 'v1');
  const cropMat = models.createMaterial({ side: THREE.DoubleSide });
  addSway(cropMat, { stiffness: 1, push: 1 });
  addFoliageTint(cropMat, { autumn: 0, winter: 0.25 });
  // ripe crops breathe: a 1 s, 4 % scale pulse on the GPU (visual-05), keyed on the READY instance colour
  addShaderPatch(cropMat, 'hh-ripe', (shader) => {
    shader.uniforms.uRipeTime = WORLD.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uRipeTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #if defined( USE_BATCHING ) && defined( USE_BATCHING_COLOR )
        {
          vec3 hhBc = getBatchingColor( getIndirectIndex( gl_DrawID ) ).rgb;
          float hhRipe = step( 0.02, hhBc.r - hhBc.b );
          float hhPh = dot( batchingMatrix[ 3 ].xz, vec2( 0.37, 0.23 ) );
          transformed *= 1.0 + hhRipe * 0.04 * ( 0.5 + 0.5 * sin( uRipeTime * 6.2832 + hhPh ) );
        }
        #endif`);
  }, 'v1');
  const treeMat = models.createMaterial({ side: THREE.DoubleSide });
  // crowns, trunks and fruit are closed shells: their BACK faces go into the shadow map, so a lit crown never
  // shadows itself (the fine orange "weave" on autumn canopies was shadow acne, visual-16)
  treeMat.shadowSide = THREE.BackSide;
  // and no per-pixel noise in their shadow lookup: three's PCF rotates its taps by screen-space noise, which on a
  // curved crown's terminator read as a fine orange weave in autumn
  addShaderPatch(treeMat, 'hh-shadow2', cheapShadows, 'v1');
  addSway(treeMat, { stiffness: 1.6, push: 0.35 });
  addFoliageTint(treeMat, { autumn: 1 });
  // trees around a hovered pen thin to 30 % (visual-28: a pine must never hide the animals and their bubbles)
  const uTreeFade = { value: new THREE.Vector4(0, 0, 0, 1) };      // x, z (metres), radius, kept share
  addShaderPatch(treeMat, 'hh-treefade', (shader) => {
    shader.uniforms.uTreeFade = uTreeFade;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 hhFadeRoot;\nvarying float hhFadeY;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_BATCHING
          hhFadeRoot = ( modelMatrix * batchingMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
        #else
          hhFadeRoot = vec3( 1e6 );
        #endif
        hhFadeY = transformed.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uTreeFade;\nvarying vec3 hhFadeRoot;\nvarying float hhFadeY;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if ( uTreeFade.w < 1.0 && hhFadeY > 0.5 && distance( hhFadeRoot.xz, uTreeFade.xy ) < uTreeFade.z ) {
          vec2 q = mod( floor( gl_FragCoord.xy ), 4.0 );
          vec2 q1 = mod( q, 2.0 ); vec2 q2 = floor( q / 2.0 );
          float b = ( 4.0 * ( q1.x * 2.0 + q1.y * 3.0 - 4.0 * q1.x * q1.y ) + ( q2.x * 2.0 + q2.y * 3.0 - 4.0 * q2.x * q2.y ) + 0.5 ) / 16.0;
          if ( b > uTreeFade.w ) discard;
        }`);
  }, 'v1');
  const staticMat = models.createMaterial();
  addSway(staticMat, { stiffness: 1.2, push: 0.8 });
  addFoliageTint(staticMat, { autumn: 0.35 });

  const soil = createBatch({ name: 'soil', material: soilMat, instances: 256, vertices: 1 << 16, receiveShadow: true });
  const crops = createBatch({ name: 'crops', material: cropMat, instances: 256, vertices: 1 << 17, receiveShadow: true });
  const trees = createBatch({ name: 'trees', material: treeMat, instances: 64, vertices: 1 << 16, castShadow: true, receiveShadow: true });
  // the statics draw in full but cast through their twins: render/index.js draws the static shadow map in a pass of its
  // own from `shadowTwins` (each building's far-band key when it has one: a quarter of the triangles, RD-13)
  const statics = createBatch({ name: 'statics', material: staticMat, instances: 256, vertices: 1 << 18, castShadow: false, receiveShadow: true });
  const smalls = createBatch({ name: 'smalls', material: staticMat, instances: 256, vertices: 1 << 17, castShadow: false, receiveShadow: true });
  const shadowTwins = createBatch({ name: 'shadowTwins', material: models.createMaterial(), instances: 256, vertices: 1 << 17, castShadow: true, receiveShadow: false });
  const farTwin = (key) => (models.has(`${key}:far`) ? `${key}:far` : key);
  mirrorBatch(statics, shadowTwins, farTwin);
  // level of detail (wave 3): the far band draws the twins in the main pass too, and in the near and mid bands each
  // building and crop beyond LOD.far metres of the eye does (the busy L40 farm was 306-367k triangles at 65-90 m, its
  // full buildings 155k and its full crops ~100k of it)
  const staticsBand = bandKeys(statics, farTwin, { far: LOD.far });
  const cropsBand = bandKeys(crops, farTwin, { far: LOD.far });
  let eyeAt = null;
  // see-through glass (the Greenhouse's panes): one transparent batch, made when the first greenhouse appears
  let glass = null;
  function glassBatch() {
    if (glass) return glass;
    const mat = models.createMaterial({ transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    glass = createBatch({ name: 'glass', material: mat, instances: 8, vertices: 1 << 12, castShadow: false, receiveShadow: false });
    glass.mesh.renderOrder = 6;
    layers.objects.add(glass.mesh);
    return glass;
  }
  soil.define('hh:plot', plotGeometry());
  soil.define('hh:giant_bed', plotGeometry(3));
  layers.ground.add(soil.mesh);
  layers.crops.add(crops.mesh);
  layers.objects.add(trees.mesh, statics.mesh, smalls.mesh);
  const glows = createGlows(layers.fx || layers.objects);
  const rings = createRings(layers.gridFx || layers.ground);
  let setGhost = null;                           // { sets, x, z } while a decor-set piece is being placed
  let setJoin = null;          // Set of object ids the client's set plan would join (view.ghost.setIds)
  let setsDirty = true;                          // decor changed: re-check which decor sets are complete
  let setDone = new Set();                       // complete set ids (the cosmetic shows; fx when one completes)
  let setHandles = [];
  let setsWatched = false;
  let completeSets = [];

  const recs = new Map();                        // id -> record
  const heap = createHeap();
  const anims = new Map();                       // id -> { kind, t0, dur }
  const exits = [];                              // crop instances playing their harvest yank before removal
  const fenceTiles = new Map();                  // tile index -> id (auto-joining fences)
  const staticFns = new Set();
  const smokeAt = new Map();                     // id -> next puff time (s)
  const tierWait = new Set();                    // tier keys being loaded before an object swaps to them (wave 4)
  const ambient = new Set();                     // ids with per-frame life (sails, smoke, petals): no loop over all
  let state = null;
  let hoverId = null;
  let motion = 'full';
  let me = null;
  let raining = false;
  let tool = null;                               // the tool in hand (view.setTool): the full water pins need the can
  let giants = new Map();                        // anchor plot id -> giant block (world-state giantBlocks)
  let giantOf = new Map();                       // member plot id -> anchor id
  let summaryDirty = false;                      // the per-field "needs water" summary drops
  let far = false;
  let timeDriven = false;                        // inside a heap pop: the change came due by itself
  const needs = { ready: new Set(), water: new Set() };
  let bulk = false;                              // setState: no drop animations
  let clockS = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qs = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const col = new THREE.Color();

  const staticChanged = () => { for (const fn of staticFns) fn(); };
  const barnLevel = () => {
    const f = state && state.farm;
    if (!f) return 0;
    const b = f.barn;
    return Number.isFinite(b) ? b : Number.isFinite(b?.n) ? b.n : Number.isFinite(b?.level) ? b.level : (f.barnLevel || 0);
  };

  function placeOf(o, def) {
    const [w, d] = objFootprint(o, def);
    return { x: (o.x + w / 2) * TILE_M, z: (o.z + d / 2) * TILE_M, yaw: (o.rot || 0) * HALF_PI };
  }

  /** Base transform of a record with the current animation applied. */
  function composeBase(rec, extraY = 0, sx = 1, sy = 1, sz = 1, tilt = 0) {
    q.setFromAxisAngle(Y, rec.yaw + (rec.jitterYaw || 0));
    if (tilt) { qs.setFromAxisAngle(Z, tilt); q.multiply(qs); }
    const sc = rec.scale || 1;
    // a grown home without its own model: the base pen stretched over the footprint (wave 4b)
    const st = rec.stretch;
    s3.set(sc * sx * (st ? st[0] : 1), sc * sy, sc * sz * (st ? st[1] : 1));
    m4.compose(v3.set(rec.x, extraY, rec.z), q, s3);
    return m4;
  }

  function batchFor(kind, def) {
    if (kind === 'tree') return trees;
    // a 1 x 1 decor piece or a small weed / rock: no cast shadow (RD-13)
    if ((kind === 'decor' || kind === 'debris') && def && Math.max(...(def.size || [1, 1])) <= 1) return smalls;
    return statics;
  }

  function soilColor(vis) {
    if (vis.ready) return READY_SOIL;
    if (vis.fert) return vis.wet ? WET_FERT : FERT;
    if (vis.thirsty && !raining && !vis.wet) return DRY;
    if (vis.wet && vis.compost) return WET_COMPOST;
    if (vis.wet) return WET;
    if (vis.compost) return COMPOST;
    return WHITE;
  }

  function removeRec(id, rec, { yank = false } = {}) {
    if (rec.soil !== undefined) soil.remove(rec.soil);
    if (rec.gSoil !== undefined) soil.remove(rec.gSoil);
    if (rec.glass !== undefined && glass) glass.remove(rec.glass);
    if (rec.gCrop !== undefined) crops.remove(rec.gCrop);
    if (rec.crop !== undefined) {
      if (yank && motion !== 'still') exits.push({ h: rec.crop, t0: clockS, rec: { ...rec } });
      else crops.remove(rec.crop);
    }
    if (rec.main !== undefined) { rec.batch.remove(rec.main); staticChanged(); }
    for (const h of rec.extra || []) statics.remove(h);
    if (rec.mwH !== undefined) { statics.remove(rec.mwH); rec.mwH = undefined; }
    if (rec.poolH !== undefined) { statics.remove(rec.poolH); rec.poolH = undefined; }
    if (rec.goldH !== undefined) { statics.remove(rec.goldH); rec.goldH = undefined; if (fx) fx.twinkle(`${id}#gold`, null); }
    relicAt.delete(id);
    clearDoors(rec);
    doorAnims.delete(id);
    if (rec.twinkle) clearGlints(id, rec);
    if (badges) { badges.set(id, null); badges.set(`${id}#w`, null); badges.set(`${id}#pin`, null); badges.set(`${id}#duet`, null); }
    needs.ready.delete(id);
    if (needs.water.delete(id)) summaryDirty = true;
    glows.set(id, null);
    if (lampSrc.delete(id)) lampList = null;
    if (rec.fenceTile !== undefined && fenceTiles.get(rec.fenceTile) === id) fenceTiles.delete(rec.fenceTile);
    anims.delete(id);
    smokeAt.delete(id);
    ambient.delete(id);
  }

  function crossFenceResync(tile) {
    const x = tile % N; const z = Math.floor(tile / N);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const id = fenceTiles.get((z + dz) * N + (x + dx));
      if (id && recs.has(id)) syncOne(id, { force: true });
    }
  }

  function drawFence(id, rec, o, def) {
    for (const h of rec.extra || []) statics.remove(h);
    rec.extra = [];
    const L = fenceLinks(new Set(fenceTiles.keys()), o.x, o.z);
    const any = L.e || L.s || L.w || L.n;
    const cx = (o.x + 0.5) * TILE_M; const cz = (o.z + 0.5) * TILE_M;
    if (!any) {
      // a lone piece: the full picket section, turned by its rotation
      if (rec.main === undefined) { rec.main = statics.add('decor:picket_fence', composeBase(rec)); rec.batch = statics; }
      else statics.setMatrix(rec.main, composeBase(rec));
      rec.key = 'decor:picket_fence';
      return;
    }
    if (rec.main !== undefined) { statics.remove(rec.main); rec.main = undefined; }
    rec.key = null;
    const post = (x, z) => { q.identity(); m4.compose(v3.set(x, 0, z), q, s3.set(1, 1, 1)); rec.extra.push(statics.add('decor:picket_fence:post', m4)); };
    post(cx, cz);
    // rails toward E and S (the neighbour to the W / N owns the shared span); each span is two 1 m sections
    for (const [on, ang, dx, dz] of [[L.e, 0, 1, 0], [L.s, -HALF_PI, 0, 1]]) {
      if (!on) continue;
      q.setFromAxisAngle(Y, ang);
      for (const k of [0, 1]) {
        // rail model spans x in [0, 1] from its origin
        m4.compose(v3.set(cx + dx * k, 0, cz + dz * k), q, s3.set(1, 1, 1));
        rec.extra.push(statics.add('decor:picket_fence:rail', m4));
      }
    }
    void def;
  }

  function syncOne(id, { force = false } = {}) {
    const o = state && Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null;
    const def = o ? defOf(o.def) : null;
    let rec = recs.get(id);
    const vis = o ? visualOf(o, def, now(), { barnLevel: barnLevel() }) : null;
    if (!vis || !Number.isFinite(o.x) || !Number.isFinite(o.z)) {
      if (rec) {
        recs.delete(id);
        removeRec(id, rec);
        propsDirty = true;
        if (rec.fenceTile !== undefined) crossFenceResync(rec.fenceTile);
      }
      return;
    }
    const p = placeOf(o, def);
    const isNew = !rec;
    const sig = `${o.def}|${o.x}|${o.z}|${o.rot || 0}|${vis.grow || 0}`;
    if (!rec || rec.sig !== sig) propsDirty = true;
    const moved = rec && (rec.x !== p.x || rec.z !== p.z || rec.yaw !== p.yaw || rec.def !== o.def);
    if (rec && rec.def !== o.def) { removeRec(id, rec); recs.delete(id); rec = null; }
    if (!rec) {
      rec = { id, def: o.def, kind: vis.kind, h: hashId(id) };
      recs.set(id, rec);
    }
    rec.sig = sig;
    Object.assign(rec, p);
    rec.vis = vis;
    if (def.kind === 'plot' && giantOf.has(id)) {
      drawGiant(id, rec, vis);
    } else if (def.kind === 'plot') {
      if (rec.gSoil !== undefined || rec.gCrop !== undefined) clearGiant(id, rec);
      // plots: the soil mound plus the crop cluster (a quarter-turn per plot so a field never looks stamped)
      rec.jitterYaw = 0;
      if (rec.soil === undefined) {
        rec.soil = soil.add('hh:plot', composeBase(rec), soilColor(vis));
        if (!bulk && isNew) anims.set(id, { kind: 'drop', t0: clockS, dur: 0.45 });
      }
      else { soil.setMatrix(rec.soil, composeBase(rec)); soil.setColor(rec.soil, soilColor(vis)); }
      const prevKey = rec.cropKey;
      if (vis.crop) {
        // a quarter-turn per plot so a field never looks stamped; flowers keep facing the default camera (their
        // heads are two-sided, but the face is the better side: visual-03)
        const flower = cropOf(vis.cropId)?.archetype === 'flower';
        const cropRec = { ...rec, jitterYaw: flower ? 0 : (rec.h % 4) * HALF_PI, scale: (0.94 + ((rec.h >>> 8) % 100) / 900) * (vis.fert ? 1.06 : 1) };
        rec.cropRec = cropRec;
        if (rec.crop === undefined) {
          rec.crop = crops.add(vis.crop, composeBase(cropRec), vis.ready ? READY : WHITE);
          if (!bulk) anims.set(id, { kind: 'pop', t0: clockS, dur: 0.32 });
        } else {
          if (prevKey !== vis.crop) {
            crops.setKey(rec.crop, vis.crop);
            // a stage that came due by itself is ambient life (30 fps), not feedback (performance-01)
            if (!bulk && prevKey) anims.set(id, { kind: vis.ready ? 'ripen' : 'pop', t0: clockS + ((rec.h >>> 4) % 100) / 250, dur: 0.32, ambient: timeDriven });
          }
          crops.setMatrix(rec.crop, composeBase(cropRec));
          crops.setColor(rec.crop, vis.ready ? READY : WHITE);
        }
        rec.cropKey = vis.crop;
      } else if (rec.crop !== undefined) {
        const wasReady = rec.twinkle;
        if (wasReady && !bulk && motion !== 'still') exits.push({ h: rec.crop, t0: clockS, rec: { ...rec.cropRec } });
        else crops.remove(rec.crop);
        rec.crop = undefined;
        rec.cropKey = null;
      }
      // ripe: three warm glints over the plot (golden seeds: a bigger, deeper gold lead)
      setGlints(id, rec, vis.ready, vis.golden);
      setWaterPin(id, rec, vis);
    } else if (def.layer === 'ground' && def.greenhouse) {
      // the farm's Greenhouse (Restoration 1): a frame on the ground layer round its own 12 plots: render-life's
      // model when there is one, else the open-roofed stand-in (the crops inside stay visible and clickable)
      const mk = modelKey(statics, staticKey(def.id) || 'landmark:greenhouse', () => greenhouseGeometry(4, { open: true }));
      if (rec.main === undefined) {
        rec.batch = statics;
        rec.main = statics.add(mk.key, composeBase(rec));
        if (!bulk && isNew) anims.set(id, { kind: 'drop', t0: clockS, dur: 0.45 });
        staticChanged();
      } else if (moved) { statics.setMatrix(rec.main, composeBase(rec)); staticChanged(); }
      // its glass (render-life's `:glass` part) is see-through: the crops inside stay visible
      const gk = `${mk.key}:glass`;
      if (mk.real && models.has(gk)) {
        const gb = glassBatch();
        if (rec.glass === undefined) rec.glass = gb.add(gk, composeBase(rec));
        else gb.setMatrix(rec.glass, composeBase(rec));
      }
      rec.key = mk.key;
      rec.ground = true;
    } else if (def.layer === 'ground') {
      // ground pieces (dirt paths) are painted into the ground texture by ground.js; nothing 3D to draw
    } else if (def.effect && def.effect.autojoin) {
      rec.fenceTile = o.z * N + o.x;
      const had = fenceTiles.get(rec.fenceTile) === id;
      fenceTiles.set(rec.fenceTile, id);
      drawFence(id, rec, o, def);
      if (!had || moved || isNew || force) {
        if (!force) crossFenceResync(rec.fenceTile);
      }
      staticChanged();
    } else {
      const batch = batchFor(vis.kind, def);
      let key = vis.key || `missing:${o.def}`;
      // wave 4b: a tree's age size (grand trees stand a third bigger); a grown home's stretch when it has no model of its own
      const scale0 = rec.scale || 1;
      if (vis.kind === 'tree') rec.scale = vis.age || 1;
      const aged = !isNew && vis.kind === 'tree' && rec.scale > scale0 + 1e-3;
      const st0 = rec.stretch;
      rec.stretch = vis.stretch || null;
      const restretched = (st0 ? st0.join() : '') !== (rec.stretch ? rec.stretch.join() : '');
      // a home that grew a tier (its pen rebuilt bigger) settles in with a drop; a plain move of it does not
      const grew = vis.kind === 'home' && rec.growT !== undefined && (vis.grow || 0) !== rec.growT;
      if (vis.kind === 'home') rec.growT = vis.grow || 0;
      // an upgrade tier (wave 4) or a barn level arrives as a new key in a file of its own: the object keeps the look it
      // has until the new model is loaded, then swaps (never a placeholder box in between)
      const drawn = rec.main !== undefined ? batch.keyOf(rec.main) : null;
      if (drawn && drawn !== key && vis.key && !models.isReady(key) && models.has(key)) {
        if (!tierWait.has(key)) {
          tierWait.add(key);
          models.ready([key, `${key}:far`].filter((k) => models.has(k))).then(() => { tierWait.delete(key); if (recs.has(id)) syncOne(id); }, () => tierWait.delete(key));
        }
        key = drawn;
      }
      if (!vis.key) defineMissing(key, def);
      if (rec.main === undefined) {
        rec.batch = batch;
        rec.main = batch.add(key, composeBase(rec));
        if (!bulk && isNew) anims.set(id, { kind: 'drop', t0: clockS, dur: 0.45 });
        staticChanged();
      } else if (batch.keyOf(rec.main) !== key || moved || aged || restretched || grew) {
        if (batch.keyOf(rec.main) !== key) {
          batch.setKey(rec.main, key);
          if (!bulk && vis.kind === 'tree') anims.set(id, { kind: 'pop', t0: clockS, dur: 0.4, ambient: timeDriven });
        }
        // a tree coming of age grows into its new size with a spring (wave 4b); a home that grew settles into its pen
        if (!bulk && aged) anims.set(id, { kind: 'grow', t0: clockS, dur: 0.9, from: scale0 });
        if (!bulk && grew) anims.set(id, { kind: 'drop', t0: clockS, dur: 0.45 });
        batch.setMatrix(rec.main, composeBase(rec));
        staticChanged();
      }
      rec.key = key;
      // Masterwork (GDD §3.8): a stone (1) or gilded (2) border under the piece, scaled to its footprint
      const mwKey = def.kind === 'decor' && (o.mw === 1 || o.mw === 2) ? `prop:masterwork_${o.mw}` : null;
      const mwHas = mwKey && models.has(mwKey) ? mwKey : null;
      if (rec.mwH !== undefined && (rec.mwKey !== mwHas || moved)) { statics.remove(rec.mwH); rec.mwH = undefined; }
      if (mwHas && rec.mwH === undefined) {
        const [w, d] = def.size || [1, 1];
        rec.mwH = statics.add(mwHas, composeBase(rec, 0.01, w, 1, d));
        if (rec.hidden) statics.setVisible(rec.mwH, false);
        staticChanged();
      }
      rec.mwKey = mwHas;
      // the decor Fishing Dock stands over a little pool of its own (wave 3)
      const pool = def.effect && def.effect.cosmetic === 'fishing';
      if (rec.poolH !== undefined && (!pool || moved)) { statics.remove(rec.poolH); rec.poolH = undefined; }
      if (pool && rec.poolH === undefined) {
        statics.define('hh:dock_pool', dockPoolGeometry());
        rec.poolH = statics.add('hh:dock_pool', composeBase(rec, 0.005));
        if (rec.hidden) statics.setVisible(rec.poolH, false);
      }
      // wave 4 (owner wish 8): the barn's door leaves are parts of their own (`<key>:door<i>`, hinged), so they can swing
      setDoors(rec, key, moved);
      // windmill sails: a separate spinning part around the manifest pivot; wave 4b: a part turning about +y (the
      // Golden Sprinkler's head, `<key>:spin`) the same way
      const sailsKey = `building:${def.id}:sails`;
      const spinKey = models.has(sailsKey) ? sailsKey : key && models.has(`${key}:spin`) ? `${key}:spin` : null;
      if (spinKey) {
        if (!rec.extra || !rec.extra.length) rec.extra = [statics.add(spinKey, composeBase(rec))];
        rec.sails = models.info(spinKey);
      }
      // the relics' own life (wave 4b): the sprinkler's water, the totem's breath (their anchors say where)
      const anc = key ? models.info(key)?.anchors : null;
      rec.relic = anc && Array.isArray(anc.spray) ? 'sprinkler' : anc && Array.isArray(anc.gem) ? 'totem' : null;
      if (rec.relic) rec.anchors = anc;
      // the Golden Barn (wave 4b relic): a gilded cupola on the barn's ridge while the farm owns it
      if (def.id === 'barn') setGoldenBarn(rec, key, moved);
      if (vis.kind === 'tree') {
        setGlints(id, rec, vis.ready, false);
        setWaterPin(id, rec, vis);
      }
      glows.set(id, nightLights(rec, def));
      setLampSources(id, rec, def);
      // a decor someone pinned (CL-05): a push-pin in the pinner's colour
      if (badges) {
        const pinBy = o.pin;
        const col = pinBy && state.players?.[pinBy]?.color;
        badges.set(`${id}#pin`, pinBy ? { icon: `_pin:${col || '#FFC83D'}`, style: 'pin', pos: v3.set(rec.x, topOf(rec) + 0.2, rec.z), scale: 0.4 } : null);
      }
      rec.petals = def.effect && def.effect.cosmetic === 'petals';
      if (badges) {
        if (vis.kind === 'building' && vis.ready) {
          const item = productOf(vis.doneItem);
          badges.set(id, { icon: item || 'basket', style: vis.full ? 'full' : 'ready', count: vis.done, pos: badgePos(rec) });
          needs.ready.add(id);
        } else { badges.set(id, null); if (vis.kind === 'building') needs.ready.delete(id); }
      }
    }
    if (rec.hidden) {
      if (rec.twinkle) clearGlints(id, rec);
      if (badges) { badges.set(id, null); badges.set(`${id}#w`, null); }
    }
    if (rec.sails || rec.petals || rec.relic || (vis && vis.working) || rec.def === 'farmhouse') ambient.add(id); else ambient.delete(id);
    // re-schedule the next visual change
    rec.nextAt = vis.nextAt;
    if (Number.isFinite(vis.nextAt)) heap.push(vis.nextAt, id);
    if (hoverId === id) applyHover(id, true);
  }

  // Giant crops (GDD §6.2 #8): the nine plots of a block show ONE 3 x 3 bed and render-life's giant at its centre
  // (`crop:<crop>:giant` ripe, `:giant:2` growing; until those exist the ripe cluster, scaled up). The member plots
  // stay objects for the rules and picking; only their own soil and crop leave the screen.
  function giantKey(b) {
    const ripe = `crop:${b.crop}:giant`;
    const grow = `crop:${b.crop}:giant:2`;
    if (b.ready && models.has(ripe)) return { key: ripe, s: 1 };
    if (!b.ready && models.has(grow)) return { key: grow, s: 0.75 + 0.08 * Math.min(3, b.stage) };
    const c = cropOf(b.crop);
    const last = c ? c.stages.length - 1 : 3;
    return { key: models.cropKey(b.crop, b.ready ? last : Math.max(1, Math.min(last - 1, b.stage))), s: (b.ready ? 2.5 : 1.7 + 0.25 * b.stage), fake: true };
  }
  function clearGiant(id, rec) {
    if (rec.gSoil !== undefined) { soil.remove(rec.gSoil); rec.gSoil = undefined; }
    if (rec.gCrop !== undefined) { crops.remove(rec.gCrop); rec.gCrop = undefined; }
    rec.giantBlock = null;
  }
  function drawGiant(id, rec, vis) {
    // a member's own mound and cluster go; the anchor draws the block
    if (rec.soil !== undefined) { soil.remove(rec.soil); rec.soil = undefined; }
    if (rec.crop !== undefined) { crops.remove(rec.crop); rec.crop = undefined; rec.cropKey = null; }
    if (rec.twinkle) clearGlints(id, rec);
    if (badges) badges.set(`${id}#w`, null);
    needs.water.delete(id);
    const b0 = giants.get(id);
    if (!b0) { clearGiant(id, rec); needs.ready.delete(id); return; }
    // the anchor's own crop says how ripe the giant is (a time-driven stage change re-syncs only the anchor)
    const b = { ...b0, ready: vis.ready, stage: vis.stage ?? b0.stage };
    const g = { ...rec, x: (b.x + 1.5) * TILE_M, z: (b.z + 1.5) * TILE_M, yaw: 0, jitterYaw: 0, scale: 1 };
    if (rec.gSoil === undefined) rec.gSoil = soil.add('hh:giant_bed', composeBase(g), soilColor(vis));
    else { soil.setMatrix(rec.gSoil, composeBase(g)); soil.setColor(rec.gSoil, soilColor(vis)); }
    const k = giantKey(b);
    const cg = { ...g, scale: k.s, jitterYaw: (rec.h % 4) * HALF_PI };
    if (rec.gCrop === undefined) {
      rec.gCrop = crops.add(k.key, composeBase(cg), b.ready ? READY : WHITE);
      if (!bulk) anims.set(id, { kind: 'ripen', t0: clockS, dur: 0.5 });
    } else { crops.setKey(rec.gCrop, k.key); crops.setMatrix(rec.gCrop, composeBase(cg)); crops.setColor(rec.gCrop, b.ready ? READY : WHITE); }
    rec.giantBlock = { ...b, cx: g.x, cz: g.z, key: k.key, s: k.s };
    rec.cropKey = k.key;
    rec.cropRec = cg;
    // ripe: the glints spread over the whole giant
    if (b.ready && fx) {
      needs.ready.add(id);
      const top = models.boundsOf(k.key).max.y * k.s;
      glintsOf(rec.h, top, false).forEach((gl, i) => fx.twinkle(`${id}#${i}`, new THREE.Vector3(g.x + gl.dx * 2.6, gl.y * (i ? 0.8 : 1.05), g.z + gl.dz * 2.6),
        { color: gl.color, size: gl.size * 1.6, phase: gl.phase }));
      rec.twinkle = true;
    } else { needs.ready.delete(id); if (rec.twinkle) clearGlints(id, rec); }
  }
  /** Recompute the giant blocks; re-sync every plot whose membership changed. */
  function refreshGiants() {
    const next = state ? giantBlocks(state, now()) : new Map();
    const of = new Map();
    for (const [a, b] of next) for (const m of b.ids) of.set(m, a);
    const touched = new Set();
    for (const [m, a] of of) if (giantOf.get(m) !== a) touched.add(m);
    for (const [m, a] of giantOf) if (of.get(m) !== a) touched.add(m);
    for (const [a, b] of next) { const old = giants.get(a); if (!old || old.ready !== b.ready || old.stage !== b.stage) touched.add(a); }
    giants = next;
    giantOf = of;
    for (const id of touched) if (recs.has(id) || (state && Object.hasOwn(state.farm.objects, id))) syncOne(id, { force: true });
  }

  // A def without a model (should not happen: render-life covers every def) still gets a soft box.
  const missing = new Set();
  function defineMissing(key, def) {
    if (missing.has(key)) return;
    missing.add(key);
    console.error(`objects-view: no model for ${def.id}; drawing a placeholder box`);
    const [w, d] = def.size || [1, 1];
    const g = new THREE.BoxGeometry(w * TILE_M * 0.8, 1, d * TILE_M * 0.8);
    g.translate(0, 0.5, 0);
    g.deleteAttribute('uv');
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(0.72), 3));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(new Array(n).fill(0), 1));
    for (const b of [statics, smalls, trees]) b.define(key, g);
  }

  /** Night lights of an object (visual-15): a warm halo at each window with a 1.5-2.5 m pool of light on the
   *  ground below it, and a lantern's glow with its pool; the windows come from the manifest's anchors. */
  function nightLights(rec, def) {
    const lamps = rec.key ? models.info(rec.key)?.anchors?.lamps : null;
    const own = nightLightsOf(rec, def);
    if (!Array.isArray(lamps) || !lamps.length) return own;
    // wave 4 (wish 11): every lamp anchor (the farmhouse's wall lantern and lamp-lit path, a bench's arch lantern) glows
    // with a warm halo and lays a soft pool of light on the ground below it
    const out = own ? [...own] : [];
    for (const a of lamps) {
      const p = anchorToWorld(rec, a);
      out.push({ pos: p, size: 1.5, color: LAMP, billboard: true }, { pos: new THREE.Vector3(p.x, 0.05, p.z), size: 3.2, color: LAMP, billboard: false });
    }
    return out;
  }
  function nightLightsOf(rec, def) {
    const cos = def.effect && def.effect.cosmetic;
    const top = topOf(rec);
    if (cos === 'glow' || cos === 'night_lights' || models.info(rec.key || '')?.glow) {
      const p = new THREE.Vector3(rec.x, Math.max(0.6, top * 0.8), rec.z);
      return [{ pos: p, size: 2.2, color: LAMP, billboard: true }, { pos: new THREE.Vector3(rec.x, 0.05, rec.z), size: 2.5, color: LAMP, billboard: false }];
    }
    const lit = def.kind === 'building' || (def.kind === 'landmark' && (def.id === 'farmhouse' || def.id === 'barn' || def.id === 'market_stand'));
    if (!lit || !rec.key) return null;
    const inf = models.info(rec.key);
    const wins = inf?.anchors?.windows ?? inf?.windows;
    const out = [];
    const fx0 = Math.sin(rec.yaw); const fz0 = Math.cos(rec.yaw);
    if (Array.isArray(wins) && wins.length) {
      // the light sits IN the pane (visual-after D4: no floating dots on the foundations): a warm halo at each window and,
      // under a ground-floor window only, a faint 1.6 m spill on the ground just outside the wall
      for (const w of wins.slice(0, 5)) {
        const p = anchorToWorld(rec, w);
        out.push({ pos: p, size: 1.15, color: WARM, billboard: true });
        if (w[1] > 2.4) continue;
        const ox = p.x - rec.x; const oz = p.z - rec.z; const len = Math.hypot(ox, oz) || 1;
        out.push({ pos: new THREE.Vector3(p.x + (ox / len) * 0.75, 0.05, p.z + (oz / len) * 0.75), size: 2.2, color: WARM_SPILL, billboard: false });
      }
      return out;
    }
    // models face +Z at rot 0: the front (door, most windows) is toward +Z, turned with the object
    const b = models.boundsOf(rec.key);
    const front = b.max.z + 0.2;
    for (const side of [-0.28, 0.28]) {
      const sx = Math.cos(rec.yaw) * side * (b.max.x - b.min.x); const sz = -Math.sin(rec.yaw) * side * (b.max.x - b.min.x);
      out.push({ pos: new THREE.Vector3(rec.x + fx0 * front + sx, Math.min(2.2, b.max.y * 0.32), rec.z + fz0 * front + sz), size: 1.1, color: WARM, billboard: true });
    }
    return out;
  }

  /** The real night lights of an object (wave 4, owner wish 11): its lamp anchors and a lantern decor's head, metres.
   *  render/index.js lights the nearest few of them (models.js LAMPS); every one keeps its halo and ground pool. */
  const lampSrc = new Map();                     // id -> [{ x, y, z }]
  let lampList = null;
  function setLampSources(id, rec, def) {
    const out = [];
    const lamps = rec.key ? models.info(rec.key)?.anchors?.lamps : null;
    if (Array.isArray(lamps)) for (const a of lamps) { const p = anchorToWorld(rec, a); out.push({ x: p.x, y: p.y, z: p.z }); }
    const cos = def.effect && def.effect.cosmetic;
    if (!out.length && (cos === 'glow' || cos === 'night_lights' || models.info(rec.key || '')?.glow)) out.push({ x: rec.x, y: Math.max(0.6, topOf(rec) * 0.8), z: rec.z });
    const had = lampSrc.has(id);
    if (out.length) lampSrc.set(id, out); else lampSrc.delete(id);
    if (out.length || had) lampList = null;
  }

  /** A model-space anchor [x, y, z] of an object, in world metres. */
  function anchorToWorld(rec, [ax, ay, az]) {
    const c = Math.cos(rec.yaw); const sn = Math.sin(rec.yaw);
    return new THREE.Vector3(rec.x + ax * c + az * sn, ay, rec.z - ax * sn + az * c);
  }

  /** Where smoke leaves an object: its chimney anchor when the manifest has one, else the roof centre. */
  function smokeOrigin(rec) {
    const inf = rec.key ? models.info(rec.key) : null;
    const a = inf ? (inf.anchors?.chimney ?? inf.smoke) : null;
    if (Array.isArray(a) && a.length === 3) return anchorToWorld(rec, a);
    return new THREE.Vector3(rec.x + ((rec.h % 5) - 2) * 0.15, topOf(rec) - 0.2, rec.z);
  }

  /** Ripe: three staggered warm glints (a tree's spread over its crown), or none. */
  function setGlints(id, rec, on, golden) {
    if (on) needs.ready.add(id); else needs.ready.delete(id);
    if (!fx) return;
    if (!on) { if (rec.twinkle) clearGlints(id, rec); return; }
    const tree = rec.kind === 'tree';
    const top = topOf(rec);
    const k = tree ? 2.2 : 1;
    glintsOf(rec.h, tree ? top * 0.9 : top, golden).forEach((g, i) => {
      fx.twinkle(`${id}#${i}`, new THREE.Vector3(rec.x + g.dx * k, tree ? g.y * (i ? 0.85 : 1) : g.y, rec.z + g.dz * k),
        { color: g.color, size: g.size * (tree ? 1.25 : 1), phase: g.phase });
    });
    rec.twinkle = true;
  }
  function clearGlints(id, rec) {
    if (fx) for (let i = 0; i < 3; i++) fx.twinkle(`${id}#${i}`, null);
    rec.twinkle = false;
  }

  /**
   * The teardrop "needs water" pin (or the partner-tend tint) over a crop or a tree (visual-after A6 / B7: pins were
   * the loudest thing in every field). With the Watering Can in hand every dry crop and tree shows a small pin
   * (~18 px); otherwise only the hovered one does, and each thirsty FIELD shows one summary drop (rebuilt in update).
   */
  function setWaterPin(id, rec, vis) {
    const pin = waterPin(vis, me, raining);
    const was = needs.water.has(id);
    if (pin === 'need') needs.water.add(id); else needs.water.delete(id);
    if (was !== (pin === 'need') && rec.kind === 'plot') summaryDirty = true;
    if (!badges) return;
    const can = tool === 'watering_can';
    if (!pin || rec.hidden || (!can && id !== hoverId)) { badges.set(`${id}#w`, null); return; }
    const top = topOf(rec);
    badges.set(`${id}#w`, { icon: '_water', style: pin, pos: v3.set(rec.x, Math.max(0.5, top) + (rec.kind === 'tree' ? 0.3 : 0.2), rec.z), scale: pin === 'need' ? 0.3 : 0.24 });
  }

  /** One small drop per thirsty field (plots that touch, 8-neighbour), only while the can is NOT in hand. */
  let summaryKeys = [];
  function rebuildSummary() {
    summaryDirty = false;
    if (!badges) return;
    for (const k of summaryKeys) badges.set(k, null);
    summaryKeys = [];
    if (tool === 'watering_can' || raining) return;
    const tiles = new Map();
    for (const id of needs.water) {
      const rec = recs.get(id);
      if (!rec || rec.kind !== 'plot' || rec.hidden) continue;
      const o = state?.farm?.objects?.[id];
      if (o) tiles.set(o.z * N + o.x, rec);
    }
    const seen = new Set();
    for (const [t0, r0] of tiles) {
      if (seen.has(t0)) continue;
      const stack = [t0];
      seen.add(t0);
      let sx = 0; let sz = 0; let n = 0; let top = 0; let minKey = r0.id;
      while (stack.length) {
        const t = stack.pop();
        const r = tiles.get(t);
        sx += r.x; sz += r.z; n++; top = Math.max(top, topOf(r));
        if (r.id < minKey) minKey = r.id;
        const x = t % N; const z = Math.floor(t / N);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const k = (z + dz) * N + (x + dx);
          if ((dx || dz) && tiles.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
        }
      }
      // over the field's most central plot (never in the air between two plots, nor over a giant beside it)
      const mx = sx / n; const mz = sz / n;
      let best = r0; let bd = Infinity;
      for (const [t, r] of tiles) {
        if (!seen.has(t)) continue;
        const d = (r.x - mx) ** 2 + (r.z - mz) ** 2;
        if (d < bd) { bd = d; best = r; }
      }
      const key = `field#${minKey}`;
      badges.set(key, { icon: '_water', style: 'need', pos: v3.set(best.x, Math.max(0.6, topOf(best)) + 0.5, best.z), scale: n > 1 ? 0.36 : 0.3 });
      summaryKeys.push(key);
    }
  }

  function topOf(rec) {
    const key = rec.cropKey || rec.key;
    if (!key) return 1;
    return boundsOfKey(key).max.y * (rec.scale || 1);
  }

  /** A building's product bubble: in front of its door at eave height (the tray it is collected from), never
   *  over the roof peak (visual-06). */
  function badgePos(rec) {
    const a = rec.key ? models.info(rec.key)?.anchors?.counter : null;
    if (Array.isArray(a) && a.length === 3) return anchorToWorld(rec, a);
    const b = rec.key ? models.boundsOf(rec.key) : null;
    const top = topOf(rec);
    if (!b) return new THREE.Vector3(rec.x, top + 0.6, rec.z);
    return anchorToWorld(rec, [0, Math.min(top * 0.62, 3.2) + 0.4, b.max.z * 0.85]);
  }

  function applyHover(id, on) {
    const rec = recs.get(id);
    if (!rec) return;
    if (rec.soil !== undefined) soil.setColor(rec.soil, on ? col.copy(soilColor(rec.vis)).multiplyScalar(HOVER) : soilColor(rec.vis));
    if (rec.crop !== undefined) crops.setColor(rec.crop, col.copy(rec.vis.ready ? READY : WHITE).multiplyScalar(on ? HOVER : 1));
    if (rec.main !== undefined) rec.batch.setColor(rec.main, col.copy(rec.tint || WHITE).multiplyScalar(on ? HOVER : 1));
    for (const h of rec.extra || []) statics.setColor(h, col.copy(rec.tint || WHITE).multiplyScalar(on ? HOVER : 1));
    for (const d of rec.doors || []) statics.setColor(d.h, col.copy(rec.tint || WHITE).multiplyScalar(on ? HOVER : 1));
  }

  // ---- Barn doors (wave 4, owner wish 8): open = swing out ~100 degrees about their hinges (0.6 s, ease out), close the
  //      same way; only this screen (a click is the clicker's own). setMatrixOwn: the shadow twin keeps them shut.
  const DOOR = Object.freeze({ angle: 1.75, openS: 0.6, closeS: 0.75, holdS: 8 });
  const doorAnims = new Map();                   // id -> { goal 0 | 1, k 0..1, until (s) }
  const doorM = new THREE.Matrix4();
  const doorW = new THREE.Matrix4();
  const doorQ = new THREE.Quaternion();
  function clearDoors(rec) {
    for (const d of rec.doors || []) statics.remove(d.h);
    rec.doors = null; rec.doorKey = null;
  }
  function setDoors(rec, key, moved) {
    if (rec.doorKey !== key) {
      clearDoors(rec);
      const list = [];
      for (let i = 0; i < 4 && models.has(`${key}:door${i}`); i++) {
        const inf = models.info(`${key}:door${i}`);
        list.push({ key: `${key}:door${i}`, hinge: inf.hinge || [0, 0, 0], swing: inf.swing || 1, h: statics.add(`${key}:door${i}`, composeBase(rec)) });
      }
      rec.doors = list.length ? list : null;
      rec.doorKey = key;
      if (rec.doors) { placeDoors(rec, composeBase(rec), true); if (rec.hidden) for (const d of rec.doors) statics.setVisible(d.h, false); }
    } else if (moved && rec.doors) placeDoors(rec, composeBase(rec), true);
  }
  /** Each leaf: the object's matrix x T(hinge) x Ry(open angle x swing). `twin`: the shadow twin follows (placing and
   *  moving; while the leaves swing it keeps them shut). */
  function placeDoors(rec, base, twin = false) {
    const a = doorAnims.get(rec.id);
    const k = a ? (a.goal ? outCubic(a.k) : 1 - outCubic(1 - a.k)) : 0;
    for (const d of rec.doors) {
      doorQ.setFromAxisAngle(Y, d.swing * DOOR.angle * k);
      doorM.compose(v3.set(d.hinge[0], d.hinge[1], d.hinge[2]), doorQ, s3.set(1, 1, 1));
      doorW.copy(base).multiply(doorM);
      if (twin || !statics.setMatrixOwn) statics.setMatrix(d.h, doorW); else statics.setMatrixOwn(d.h, doorW);
    }
  }
  function stepDoors(dt) {
    let want = 0;
    for (const [id, a] of doorAnims) {
      const rec = recs.get(id);
      if (!rec || !rec.doors) { doorAnims.delete(id); continue; }
      if (a.goal === 1 && a.k >= 1 && clockS > a.until) a.goal = 0;
      const target = a.goal;
      const step = dt / (target ? DOOR.openS : DOOR.closeS);
      a.k = motion === 'still' ? target : target ? Math.min(1, a.k + step) : Math.max(0, a.k - step);
      placeDoors(rec, composeBase(rec));
      if (a.goal === 0 && a.k <= 0) { doorAnims.delete(id); placeDoors(rec, composeBase(rec)); continue; }
      if ((target === 1 && a.k < 1) || target === 0) want = 2;
      else want = Math.max(want, 0);
    }
    return want;
  }

  function animate(id, a) {
    const rec = recs.get(id);
    if (!rec) return true;
    const k = Math.min(1, (clockS - a.t0) / a.dur);
    if (k < 0) return false;
    let y = 0; let sx = 1; let sy = 1; let tilt = 0;
    if (a.kind === 'pop' || a.kind === 'ripen') {
      // squash-and-stretch: 0.82 -> 1.06 -> 1 (outBack), volume preserving
      const e = outBack(k);
      sy = 0.82 + 0.18 * e;
      sx = 1 / Math.sqrt(sy);
      if (a.kind === 'ripen') sy *= 1 + 0.08 * Math.sin(k * Math.PI);
    } else if (a.kind === 'drop') {
      // drop from 0.6 m and squash on landing (GDD §7.2 buy/place)
      const fall = Math.min(1, k / 0.55);
      y = 0.6 * (1 - fall * fall);
      if (k > 0.55) { const s = (k - 0.55) / 0.45; sy = 1 - 0.14 * Math.sin(s * Math.PI) * (1 - s); sx = 1 / Math.sqrt(sy); }
    } else if (a.kind === 'shake') {
      tilt = Math.sin(k * Math.PI * 4) * 0.06 * (1 - k);
    } else if (a.kind === 'tree') {
      // damped spring, +-6 degrees (GDD §3.2 rule 4, visual-ux-juice §3.7)
      tilt = Math.sin(k * Math.PI * 5) * 0.105 * Math.exp(-3.2 * k);
      sy = 1 + 0.03 * Math.sin(k * Math.PI * 5) * (1 - k);
    } else if (a.kind === 'grow') {
      // wave 4b: a tree coming of age grows from its old size into the new one, overshooting a little (outBack)
      const to = rec.scale || 1;
      const sc = (a.from + (to - a.from) * outBack(k)) / to;
      sx = sc; sy = sc;
      tilt = Math.sin(k * Math.PI * 3) * 0.04 * (1 - k);
    }
    const sz = sx;
    if (rec.crop !== undefined && (a.kind === 'pop' || a.kind === 'ripen' || a.kind === 'shake')) crops.setMatrix(rec.crop, composeBase(rec.cropRec || rec, y, sx, sy, sz, tilt));
    if (rec.soil !== undefined && a.kind === 'shake') soil.setMatrix(rec.soil, composeBase(rec, 0, 1, 1, 1, tilt));
    if (rec.soil !== undefined && a.kind === 'drop') soil.setMatrix(rec.soil, composeBase(rec, y, sx, sy, sz));
    if (rec.main !== undefined && rec.kind !== 'plot') rec.batch.setMatrix(rec.main, composeBase(rec, y, sx, sy, sz, tilt));
    if (rec.doors) placeDoors(rec, composeBase(rec, y, sx, sy, sz, tilt));
    if (k >= 1) {
      if (a.kind === 'drop') staticChanged();
      return true;
    }
    return false;
  }

  // ---- wave 4b: the relics' life and the Golden Barn ------------------------------------------------------------------
  const relicAt = new Map();                     // id -> next emission (clock s)
  /** The Golden Barn's cupola (farm.relics.golden_barn): on the ridge of whichever barn level shows, with a glint. */
  function setGoldenBarn(rec, key, moved) {
    const on = Boolean(state && state.farm.relics && typeof state.farm.relics === 'object' && Object.hasOwn(state.farm.relics, 'golden_barn'));
    if (!on || !key) {
      if (rec.goldH !== undefined) { statics.remove(rec.goldH); rec.goldH = undefined; if (fx) fx.twinkle(`${rec.id}#gold`, null); staticChanged(); }
      return;
    }
    // the barn's ridge (manifest anchor, build-assets section 18), else the top of its bounds over its centre
    const ridge = models.info(key)?.anchors?.ridge;
    const at = anchorToWorld(rec, Array.isArray(ridge) ? ridge : [0, boundsOfKey(key).max.y, 0]);
    at.y -= 0.12;
    const sig = `${key}|${at.x.toFixed(2)}|${at.z.toFixed(2)}|${rec.yaw}`;
    q.setFromAxisAngle(Y, rec.yaw);
    m4.compose(at, q, s3.set(1, 1, 1));
    if (rec.goldH === undefined) {
      const mk = modelKey(statics, 'prop:golden_cupola', goldenCupolaGeometry);
      rec.goldH = statics.add(mk.key, m4);
      if (rec.hidden) statics.setVisible(rec.goldH, false);
      // a brand-new Golden Barn: a shower of gold over the barn
      if (!bulk && fx) fx.burst('sparkle', v3.set(at.x, at.y + 1.2, at.z), { n: 22, colors: ['#FFE27A', '#FFFFFF', '#F2C230'], speed: 2.4, up: 2.6, size: 0.45, grav: 0.3, life: 1.2, spread: 1.4 });
      staticChanged();
    } else if (moved || rec.goldSig !== sig) { statics.setMatrix(rec.goldH, m4); staticChanged(); }
    rec.goldSig = sig;
    if (fx && !rec.hidden) fx.twinkle(`${rec.id}#gold`, v3.set(at.x, at.y + 2.15, at.z), { color: '#FFE27A', size: 0.42 });
  }
  // (sized to read at the farm camera's distance: a sprinkler's water is a few big bright drops and a veil of mist)
  const SPRAY = Object.freeze({ n: 1, colors: ['#E4F6FF', '#FFFFFF', '#B5E4F7'], speed: 0.25, up: 0.1, size: 0.27, sizeEnd: 0.15, grav: 0.8, life: 0.55,
    spread: 0.07, spin: 0, y: 0, ambient: true });
  const MIST = Object.freeze({ n: 1, color: '#EAF8FF', speed: 0.2, up: 0.1, size: 0.8, sizeEnd: 1.4, grav: 0, life: 0.7, spread: 0.25, spin: 0, y: 0,
    alpha: 0.3, ambient: true });
  /** A jet's arc: [distance from the head (m), height over the head] (it peaks near 1.4 m out and lands ~3.6 m away). */
  const JET = [[0.45, 0.18], [0.95, 0.4], [1.5, 0.52], [2.05, 0.48], [2.6, 0.3], [3.1, -0.02], [3.55, -0.45]];
  const RELIC = Object.freeze({ sprayEvery: 16, sprayFor: 6, sprayStep: 0.12, breathEvery: 7, leafEvery: 1.4, near: 75 });
  /**
   * One tick of a relic's life (wave 4b; ambient particles only, never the interactive frame rate; nothing far from the
   * eye): the Golden Sprinkler sprays its three jets for 6 s of every 16 (none in the rain: the rain waters), following
   * the turning head; the Growth Totem lets a leaf drift up from its gem and breathes a soft green ring over its reach.
   */
  function relicLife(id, rec) {
    if (eyeAt && Math.hypot(rec.x - eyeAt.x, rec.z - eyeAt.z) > RELIC.near) return 0;
    const a = rec.anchors;
    if (clockS < (relicAt.get(id) ?? 0)) return 1;
    const c = Math.cos(rec.yaw); const sn = Math.sin(rec.yaw);
    const at = (p) => v3.set(rec.x + p[0] * c + p[2] * sn, p[1], rec.z - p[0] * sn + p[2] * c);
    if (rec.relic === 'sprinkler') {
      if (raining) { relicAt.set(id, clockS + 2); return 0; }
      const u = (clockS + (rec.h % 97) / 10) % RELIC.sprayEvery;
      if (u > RELIC.sprayFor) { relicAt.set(id, clockS + (RELIC.sprayEvery - u)); return 1; }
      relicAt.set(id, clockS + RELIC.sprayStep);
      const head = at(a.spray); const hx = head.x; const hy = head.y; const hz = head.z;
      for (let i = 0; i < 3; i++) {
        // the arm points along the part's +x: turned by the yaw and the head's angle about +y
        const th = rec.yaw + (rec.spinAng || 0) + (i * Math.PI * 2) / 3;
        const dx = Math.cos(th); const dz = -Math.sin(th);
        for (const [r, h] of JET) fx.burst('droplet', v3.set(hx + dx * r, Math.max(0.05, hy + h), hz + dz * r), SPRAY);
        // a veil of mist along the arc and where the jet comes down
        fx.burst('glow', v3.set(hx + dx * 1.8, hy + 0.4, hz + dz * 1.8), MIST);
        fx.burst('glow', v3.set(hx + dx * 3.4, 0.25, hz + dz * 3.4), MIST);
      }
      return 1;
    }
    if (rec.relic === 'totem') {
      relicAt.set(id, clockS + RELIC.leafEvery);
      fx.burst('leaf', at(a.gem), { n: 1, colors: ['#7CE07A', '#B8F09A', '#4FC25A'], speed: 0.25, up: 0.45, size: 0.2, sizeEnd: 0.1, life: 2.6, grav: -0.03,
        spread: 0.15, spin: 1.5, y: 0, ambient: true });
      if ((rec.breathAt ?? 0) <= clockS) {
        rec.breathAt = clockS + RELIC.breathEvery;
        const reach = Number.isFinite(a.reach) ? a.reach : 7;
        fx.burst('glow', at(a.gem), { n: 1, color: '#9CFFB0', speed: 0, up: 0, size: 0.9, sizeEnd: 0.3, life: 1.4, grav: 0, spread: 0, y: 0, alpha: 0.6, ambient: true });
        fx.burst('ring', v3.set(rec.x, 0.04, rec.z), { n: 1, color: '#8BF08A', speed: 0, up: 0, size: 0.6, sizeEnd: reach * 2, grav: 0, spin: 0, life: 2.6, y: 0,
          spread: 0, alpha: 0.3, ambient: true, flat: true, additive: true });
      }
      return 1;
    }
    return 0;
  }

  const sailM = new THREE.Matrix4();
  const pivot = new THREE.Vector3();
  function spinSails(rec, t) {
    if (!rec.extra || !rec.extra.length || !rec.sails) return;
    const p = rec.sails.pivot || [0, 0, 0];
    // a working mill spins faster; a part with its own `speed` (the sprinkler's head) keeps it
    const speed = Number.isFinite(rec.sails.speed) ? rec.sails.speed : rec.vis && rec.vis.working ? 1.6 : 0.45;
    const ang = motion === 'still' ? 0 : t * speed;
    rec.spinAng = ang;
    // world = T(pos) R(yaw) T(pivot) Rz(ang)   (Ry(ang) for a part turning about +y)
    q.setFromAxisAngle(Y, rec.yaw);
    m4.compose(v3.set(rec.x, 0, rec.z), q, s3.set(1, 1, 1));
    (rec.sails.axis === 'y' ? sailM.makeRotationY(ang) : sailM.makeRotationZ(ang)).setPosition(pivot.set(p[0], p[1], p[2]));
    m4.multiply(sailM);
    // the shadow twin keeps the sails still: a spinning twin made the static shadow map re-render every frame
    (statics.setMatrixOwn || statics.setMatrix)(rec.extra[0], m4);
  }

  // Cosmetic door-side props (visual-23): rebuilt as a whole when a footprint or the owned land changes.
  let propsDirty = true;
  let propHandles = [];
  let expKey = null;
  let land = null;
  function rebuildProps() {
    propsDirty = false;
    for (const h of propHandles) statics.remove(h);
    propHandles = [];
    if (!state) return;
    const key = state.farm.expansions.join(',');
    if (key !== expKey) { expKey = key; land = landTiles(state.farm.expansions); }
    const occ = new Uint8Array(N * N);
    for (const o of Object.values(state.farm.objects)) {
      const d = defOf(o.def);
      if (!d || d.layer === 'none' || !Number.isFinite(o.x)) continue;
      const [w, dd] = objFootprint(o, d);
      for (let j = o.z; j < o.z + dd; j++) for (let i = o.x; i < o.x + w; i++) if (i >= 0 && j >= 0 && i < N && j < N) occ[j * N + i] = 1;
    }
    const free = (x, z) => x >= 0 && z >= 0 && x < N && z < N && land[z * N + x] === 1 && !occ[z * N + x];
    for (const [id, rec] of recs) {
      if (rec.kind !== 'building' || rec.hidden || !Object.hasOwn(state.farm.objects, id)) continue;
      const o = state.farm.objects[id];
      for (const pr of doorProps(o, defOf(o.def), rec.h, free)) {
        if (!models.has(pr.key)) continue;
        q.setFromAxisAngle(Y, pr.yaw);
        m4.compose(v3.set(pr.x, pr.y || 0, pr.z), q, s3.setScalar(pr.s));
        propHandles.push(statics.add(pr.key, m4));
      }
    }
    staticChanged();
  }

  // Complete decor sets show their cosmetic (GDD §3.8): bunting strung across a Harvest Fair, lanterns glowing over
  // Winter Lights at night (butterflies over a Cottage Garden are ambient-life's: completeSets feeds it). A set that
  // completes while this screen watches plays render-life's `decorSet` glow.
  const buntingGeo = new Map();
  function buntingKey(len) {
    const L = Math.max(2, Math.round(len));
    const key = `hh:set-bunting-${L}`;
    if (!buntingGeo.has(L)) {
      const parts = [cyl(0.015, 0.015, L, 3, '#D9C59A', { x: L / 2, rz: Math.PI / 2 })];
      const cols = ['#D2483C', '#FFC83D', '#4A8FD9', '#F6EBD3', '#2BB3A3'];
      const n = Math.max(3, Math.round(L / 0.5));
      for (let i = 1; i < n; i++) parts.push(flag(0.26, 0.36, cols[i % cols.length], { x: (i / n) * L - 0.13, y: -0.3 * Math.sin((i / n) * Math.PI), rz: -Math.PI / 2 }, { sway: 0.6 }));
      buntingGeo.set(L, merge(parts));
      statics.define(key, buntingGeo.get(L));
    }
    return { key, L };
  }
  function rebuildSetCosmetics() {
    setsDirty = false;
    for (const h of setHandles) statics.remove(h);
    setHandles = [];
    if (!state) return;
    const list = decorSetsOf(state);
    completeSets = list.filter((st) => st.complete);
    const lamp = [];
    const nowDone = new Set(completeSets.map((st) => st.id));
    for (const st of completeSets) {
      const pts = st.ids.map((id) => recs.get(id)).filter(Boolean);
      if (st.cosmetic === 'bunting' && pts.length >= 2) {
        // across the two pieces farthest apart, at 2.4 m
        let a = pts[0]; let b = pts[1]; let best = -1;
        for (const p1 of pts) for (const p2 of pts) { const d = Math.hypot(p1.x - p2.x, p1.z - p2.z); if (d > best) { best = d; a = p1; b = p2; } }
        const { key, L } = buntingKey(best);
        q.setFromAxisAngle(Y, -Math.atan2(b.z - a.z, b.x - a.x));
        m4.compose(v3.set(a.x, 2.4, a.z), q, s3.set(best / L, 1, 1));
        setHandles.push(statics.add(key, m4));
      }
      if (st.cosmetic === 'lanterns') for (const p1 of pts) lamp.push({ pos: new THREE.Vector3(p1.x, topOf(p1) + 0.5, p1.z), size: 1.6, color: LAMP, billboard: true });
      if (setsWatched && !setDone.has(st.id) && fx) fx.play({ e: 'decorSet', set: st.id }, new THREE.Vector3(st.x * TILE_M, 0, st.z * TILE_M), {});
    }
    glows.set('sets', lamp);
    setDone = nowDone;
    setsWatched = true;
    staticChanged();
  }

  // Notes pinned to tiles (coop-robust-16): a paper slip in the author's colour, one sprite each.
  const notes = new Map();          // noteId -> { sprite, x, z, color }
  const noteTex = new Map();        // colour -> texture
  function noteTexture(color) {
    let t = noteTex.get(color);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(60,30,10,0.25)';
    g.beginPath(); g.ellipse(33, 58, 18, 4, 0, 0, Math.PI * 2); g.fill();
    g.save(); g.translate(32, 30); g.rotate(-0.12);
    g.fillStyle = '#FFF8EC'; g.strokeStyle = '#7A4B2C'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-18, -20); g.lineTo(18, -20); g.lineTo(18, 14); g.lineTo(8, 22); g.lineTo(-18, 22); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(122,75,44,0.55)'; g.lineWidth = 2;
    for (const y of [-8, 0, 8]) { g.beginPath(); g.moveTo(-12, y); g.lineTo(12, y); g.stroke(); }
    g.fillStyle = color; g.strokeStyle = '#5A3418'; g.lineWidth = 2;
    g.beginPath(); g.arc(0, -20, 6, 0, Math.PI * 2); g.fill(); g.stroke();      // the pin, in the author's colour
    g.restore();
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    noteTex.set(color, t);
    return t;
  }
  function syncNotes() {
    const list = state && state.farm.notes ? state.farm.notes : {};
    for (const [id, n] of notes) if (!Object.hasOwn(list, id)) { n.sprite.removeFromParent(); n.sprite.material.dispose(); notes.delete(id); }
    for (const [id, nt] of Object.entries(list)) {
      if (!Number.isFinite(nt.x) || !Number.isFinite(nt.z)) continue;
      const color = state.players?.[nt.by]?.color || '#FFC83D';
      let n = notes.get(id);
      if (!n) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTexture(color), transparent: true, depthWrite: false, fog: false }));
        sprite.renderOrder = 15;
        sprite.scale.set(1.15, 1.15, 1);
        (layers.badges || layers.objects).add(sprite);
        n = { sprite };
        notes.set(id, n);
      } else if (n.color !== color) n.sprite.material.map = noteTexture(color);
      Object.assign(n, { x: nt.x, z: nt.z, color });
      n.sprite.position.set((nt.x + 0.5) * TILE_M, 1.5, (nt.z + 0.5) * TILE_M);
    }
  }

  // Swapped placeholders change bounds: refresh badges/twinkles of that key's owners.
  for (const b of [soil, crops, trees, statics, smalls]) {
    b.onSwap(() => {
      staticChanged();
      for (const [id, rec] of recs) if (rec.twinkle || (badges && rec.vis && rec.vis.ready)) syncOne(id, { force: true });
    });
  }

  return {
    batches: { soil, crops, trees, statics, smalls, shadowTwins },
    setNow(fn) { now = fn; },
    setFx(f) { fx = f; },
    setMe(pid) {
      if (pid === me) return;
      me = pid;
      for (const [id, rec] of recs) if (rec.vis && (rec.vis.thirsty || rec.vis.tendBy)) setWaterPin(id, rec, rec.vis);
    },
    /** The tool in hand: the full water pins show only with the Watering Can (view.setTool). */
    setTool(id) {
      if (id === tool) return;
      tool = id;
      for (const [rid, rec] of recs) if (rec.vis && (rec.vis.thirsty || rec.vis.tendBy)) setWaterPin(rid, rec, rec.vis);
      summaryDirty = true;
    },
    get glows() { return glows; },
    /**
     * Decor-set placement glow (GDD §3.8): while a set piece is being placed (`defId`, its ghost at tile `at`), every
     * placed piece of its set(s) wears a gold ring (brighter within the set radius of the ghost) and a faint ring
     * shows the radius around the ghost. `defId` null clears.
     */
    setSetGlow(defId, at = null, ids = undefined) {
      if (ids !== undefined) setJoin = ids && ids.length ? new Set(ids) : null;
      if (!defId) setJoin = null;
      const sets = defId ? setsOfDef(defId) : [];
      if (!sets.length) { if (setGhost) { setGhost = null; rings.set([]); } return; }
      setGhost = { sets, x: at ? at.x : null, z: at ? at.z : null };
      const list = [];
      const r0 = Math.max(...sets.map((st) => st.radius)) * TILE_M;
      const gx = at ? at.x * TILE_M : null; const gz = at ? at.z * TILE_M : null;
      if (at) list.push({ x: gx, z: gz, r: r0, k: 0.45 });
      const want = new Set(sets.flatMap((st) => st.pieces));
      // per-tile pieces (a picket fence is dozens of tiles) show only their copy nearest the ghost
      const nearest = new Map();
      // with the client's set plan (`ids`: the exact copies this spot would join, the rules' own grouping search)
      // those wear the bright ring and every other copy a faint one
      const kOf = (id, dist) => (setJoin ? (setJoin.has(id) ? 1 : 0.25) : dist <= r0 ? 1 : 0.4);
      for (const [id, rec] of recs) {
        if (!want.has(rec.def) || rec.hidden) continue;
        const d = defOf(rec.def);
        const dist = gx === null ? 0 : Math.hypot(rec.x - gx, rec.z - gz);
        if (d && d.perTile) {
          // one copy per piece: the one the plan joins, else the nearest
          const b = nearest.get(rec.def);
          const rank = setJoin && setJoin.has(id) ? 0 : 1;
          if (!b || rank < b.rank || (rank === b.rank && dist < b.dist)) nearest.set(rec.def, { id, rec, dist, rank });
          continue;
        }
        const [w, dd] = d ? footprint(d, 0) : [1, 1];
        list.push({ x: rec.x, z: rec.z, r: Math.max(w, dd) * TILE_M * 0.62 + 0.25, k: kOf(id, dist) });
      }
      for (const { id, rec, dist } of nearest.values()) list.push({ x: rec.x, z: rec.z, r: TILE_M * 0.62 + 0.25, k: kOf(id, dist) });
      rings.set(list);
    },
    /** The complete decor sets (ambient-life puts the Cottage Garden's butterflies over them). */
    completeSets() { return completeSets; },
    setRaining(on) {
      if (Boolean(on) === raining) return;
      raining = Boolean(on);
      for (const [id, rec] of recs) {
        if (rec.vis && (rec.vis.thirsty || rec.vis.tendBy)) setWaterPin(id, rec, rec.vis);
        if (rec.soil !== undefined && rec.vis) soil.setColor(rec.soil, soilColor(rec.vis));
      }
      summaryDirty = true;
    },
    /** A world marker over an object: 'duet' = the pulsing heart while a "Cook together" invite waits (UI-08). */
    marker(id, name, on) {
      const rec = recs.get(id);
      if (!badges) return;
      if (!rec || !on) { badges.set(`${id}#${name}`, null); return; }
      if (name === 'duet') badges.set(`${id}#duet`, { icon: 'hearts', style: 'tend', pos: v3.set(rec.x, topOf(rec) + 0.6, rec.z), scale: 0.75 });
    },
    /** What still asks for the player: ripe crops / trees / trays and dry crops (the calm board, RD-40). */
    needs() { return { ready: needs.ready.size, water: needs.water.size }; },
    setBadges(b) { badges = b; },
    setState(s) {
      state = s;
      bulk = true;
      heap.clear();
      for (const id of [...recs.keys()]) if (!Object.hasOwn(s.farm.objects, id)) syncOne(id);
      // fences first so the joins see their neighbours
      const ids = Object.keys(s.farm.objects);
      for (const id of ids) {
        const d = defOf(s.farm.objects[id].def);
        if (d && d.effect && d.effect.autojoin) fenceTiles.set(s.farm.objects[id].z * N + s.farm.objects[id].x, id);
      }
      giants = giantBlocks(s, now());
      giantOf = new Map();
      for (const [a, b] of giants) for (const m of b.ids) giantOf.set(m, a);
      for (const id of ids) syncOne(id, { force: true });
      bulk = false;
      propsDirty = true;
      setsDirty = true;
      setsWatched = false;
      syncNotes();
      staticChanged();
    },
    /** The note pinned to a tile (picking: a click opens it), or null. */
    noteAt(x, z) {
      for (const [id, n] of notes) if (n.x === x && n.z === z) return id;
      return null;
    },
    sync(ids, topics, s) {
      state = s;
      if (topics.has('*')) { this.setState(s); return; }
      for (const id of ids) syncOne(id);
      for (const id of ids) { const d = defOf(s.farm.objects[id]?.def); if (!d || d.kind === 'decor') { setsDirty = true; break; } }
      // a plot changed: the giant blocks may have grown, ripened or been felled
      for (const id of ids) { const o = s.farm.objects[id]; if (giantOf.has(id) || (o && o.crop && o.crop.giant)) { refreshGiants(); break; } }
      if (topics.has('notes') || topics.has('players')) syncNotes();
      if (topics.has('expansions')) propsDirty = true;
      // the barn's look follows its upgrades (whichever topic carries them): one object, re-read on every change
      const has = (id) => (typeof ids.has === 'function' ? ids.has(id) : ids.includes(id));   // a Set from the store
      for (const [id, rec] of recs) if (rec.def === 'barn' && !has(id)) syncOne(id, { force: true });
    },
    worldPosOf(id) {
      const rec = recs.get(id);
      return rec ? new THREE.Vector3(rec.x, 0, rec.z) : null;
    },
    topOf(id) { const rec = recs.get(id); return rec ? topOf(rec) : 0; },
    /** Invalid-action shake (200 ms), or the tree-harvest spring shake (600 ms) with kind 'tree'. */
    shake(id, kind = 'shake') {
      if (!recs.has(id)) return;
      anims.set(id, kind === 'tree' ? { kind: 'tree', t0: clockS, dur: 0.6 } : { kind: 'shake', t0: clockS, dur: 0.2 });
    },
    /** Wave 4 (owner wish 11): every real night light of the farm (lamp anchors, lanterns), metres; cached. */
    lampSources() {
      if (!lampList) { lampList = []; for (const l of lampSrc.values()) lampList.push(...l); }
      return lampList;
    },
    /** Wave 4 (owner wish 8): swing an object's doors open (the Barn's) or shut; open doors close by themselves after
     *  DOOR.holdS seconds. Returns false when the object has no doors. */
    doors(id, open = true) {
      const rec = recs.get(id);
      if (!rec || !rec.doors) return false;
      const a = doorAnims.get(id) || { goal: 0, k: 0, until: 0 };
      a.goal = open ? 1 : 0;
      if (open) a.until = clockS + DOOR.holdS;
      doorAnims.set(id, a);
      return true;
    },
    doorsOpen(id) { const a = doorAnims.get(id); return Boolean(a && a.goal === 1); },
    hidden(id, hide) {
      const rec = recs.get(id);
      if (!rec) return;
      rec.hidden = Boolean(hide);
      if (rec.soil !== undefined) soil.setVisible(rec.soil, !hide);
      if (rec.crop !== undefined) crops.setVisible(rec.crop, !hide);
      if (rec.main !== undefined) rec.batch.setVisible(rec.main, !hide);
      if (rec.glass !== undefined && glass) glass.setVisible(rec.glass, !hide);
      for (const h of rec.extra || []) statics.setVisible(h, !hide);
      for (const d of rec.doors || []) statics.setVisible(d.h, !hide);
      if (rec.mwH !== undefined) statics.setVisible(rec.mwH, !hide);
      if (rec.poolH !== undefined) statics.setVisible(rec.poolH, !hide);
      if (rec.goldH !== undefined) statics.setVisible(rec.goldH, !hide);
      if (badges && hide) { badges.set(id, null); badges.set(`${id}#w`, null); }
      if (hide && rec.twinkle) clearGlints(id, rec);
      if (!hide) syncOne(id, { force: true });
      staticChanged();
    },
    hover(id) {
      if (id === hoverId) return;
      const prev = hoverId;
      if (hoverId) applyHover(hoverId, false);
      hoverId = id && recs.has(id) ? id : null;
      if (hoverId) applyHover(hoverId, true);
      // the hovered crop or tree shows its own water pin even without the can
      for (const k of [prev, hoverId]) { const r = k && recs.get(k); if (r && r.vis && (r.vis.thirsty || r.vis.tendBy)) setWaterPin(k, r, r.vis); }
      const rec = hoverId ? recs.get(hoverId) : null;
      if (rec && rec.kind === 'home' && rec.key) {
        const b = models.boundsOf(rec.key);
        const r = Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z) / 2 + 2 * TILE_M;
        uTreeFade.value.set(rec.x, rec.z, r, 0.3);
      } else uTreeFade.value.w = 1;
    },
    /** Tint an object (the ghost's blocker): a THREE.Color-compatible value, or null to clear. */
    tint(id, color) {
      const rec = recs.get(id);
      if (!rec) return;
      rec.tint = color ? new THREE.Color(color) : null;
      applyHover(id, id === hoverId);
    },
    proxies() {
      const out = [];
      for (const [id, rec] of recs) {
        // a ground-layer frame (the Greenhouse) never catches the click meant for a plot inside it
        if (rec.main === undefined || !rec.key || rec.ground) continue;
        const b = boundsOfKey(rec.key);
        if (b.max.y < 1.1) continue;
        const box = b.clone();
        // an aged tree is bigger, a stretched pen wider (wave 4b): the pick box follows the instance's scale
        const kxz = rec.scale || 1;
        if (kxz !== 1 || rec.stretch) {
          const st = rec.stretch || [1, 1];
          box.min.set(box.min.x * kxz * st[0], box.min.y * kxz, box.min.z * kxz * st[1]);
          box.max.set(box.max.x * kxz * st[0], box.max.y * kxz, box.max.z * kxz * st[1]);
        }
        // quarter-turn rotation of an axis-aligned box stays axis-aligned
        const r = ((Math.round(rec.yaw / HALF_PI) % 4) + 4) % 4;
        const { min, max } = box;
        const rot = (x, z) => (r === 0 ? [x, z] : r === 1 ? [z, -x] : r === 2 ? [-x, -z] : [-z, x]);
        const a = rot(min.x, min.z); const c = rot(max.x, max.z);
        box.min.set(Math.min(a[0], c[0]) + rec.x, min.y, Math.min(a[1], c[1]) + rec.z);
        box.max.set(Math.max(a[0], c[0]) + rec.x, max.y, Math.max(a[1], c[1]) + rec.z);
        out.push({ id, box, kind: rec.kind });
      }
      return out;
    },
    onStaticChange(fn) { staticFns.add(fn); return () => staticFns.delete(fn); },
    /** What the view currently shows for an object (tests, dev tools). */
    inspect(id) {
      const rec = recs.get(id);
      if (!rec) return null;
      return { kind: rec.kind, key: rec.key ?? null, cropKey: rec.cropKey ?? null, ready: Boolean(rec.vis?.ready),
        working: Boolean(rec.vis?.working), nextAt: rec.nextAt ?? null, twinkle: Boolean(rec.twinkle), extra: (rec.extra || []).length,
        x: rec.x, z: rec.z, yaw: rec.yaw };
    },
    setMotion(m) { motion = m; },
    /**
     * The camera's eye (world metres) and the zoom band's distance scale (index.js lodDistance): buildings and crops
     * beyond LOD.far of it draw their twins. Re-judged once the eye moved 1.5 m.
     */
    setEye(eye, scale = 1) {
      if (!eye) return 0;
      if (eyeAt && Math.hypot(eye.x - eyeAt.x, eye.y - eyeAt.y, eye.z - eyeAt.z) < 1.5 && eyeAt.s === scale) return 0;
      eyeAt = { x: eye.x, y: eye.y, z: eye.z, s: scale };
      return cropsBand.setEye(eye, scale) + staticsBand.setEye(eye, scale);
    },
    setBand(band) {
      const wasFar = far;
      far = band === 'far';
      // the crops' ~120-triangle twins (performance-03) and the buildings' far twins (wave 3)
      if (far !== wasFar) { cropsBand.set(far); staticsBand.set(far); staticChanged(); }
      // far zoom: almost everything is visible, the per-instance cull loop is pure overhead (tech §10.12)
      const cull = band === 'near';
      for (const b of [crops, soil]) {
        b.mesh.perObjectFrustumCulled = cull;
        // three r186 skips rebuilding the draw list when culling is off and nothing changed: without this the
        // list culled for the last near view would stay in force (whole fields missing after zooming out)
        b.mesh._visibilityChanged = true;
      }
    },
    update(dt, tMs) {
      clockS = tMs / 1000;
      let want = 0;
      if (state) {
        heap.popDue(now(), (id, at) => {
          const rec = recs.get(id);
          if (rec && rec.nextAt === at) { timeDriven = true; syncOne(id); timeDriven = false; }
        });
      }
      for (const [id, a] of anims) {
        if (animate(id, a)) anims.delete(id);
        want = Math.max(want, a.ambient ? 1 : 2);
      }
      for (let i = exits.length - 1; i >= 0; i--) {
        const e = exits[i];
        const k = (clockS - e.t0) / 0.18;
        if (k >= 1) { crops.remove(e.h); exits.splice(i, 1); continue; }
        // the harvest yank: stretch up 25 % and lift, then shrink away (120-180 ms)
        const sy = k < 0.5 ? 1 + 0.5 * k : 1.25 * (1 - (k - 0.5) * 2);
        crops.setMatrix(e.h, composeBase(e.rec, 0.35 * k, Math.max(0.01, 1 - k * 0.6), Math.max(0.01, sy), Math.max(0.01, 1 - k * 0.6)));
        want = 2;
      }
      glows.update();
      if (doorAnims.size) want = Math.max(want, stepDoors(dt));
      if (propsDirty) rebuildProps();
      if (summaryDirty) rebuildSummary();
      if (setsDirty) rebuildSetCosmetics();
      // ambient: windmill sails, smoke from working buildings (60 BPM puffs), cherry petals drifting
      for (const id of ambient) {
        const rec = recs.get(id);
        if (!rec) { ambient.delete(id); continue; }
        if (rec.petals && fx && motion !== 'still') {
          const next = smokeAt.get(id) ?? 0;
          if (clockS >= next) {
            smokeAt.set(id, clockS + 1.6 + (rec.h % 9) / 10);
            fx.burst('petal', new THREE.Vector3(rec.x, topOf(rec) * 0.75, rec.z), {
              n: 2, colors: ['#F7C6D9', '#FBE3EC', '#F4A6C4'], speed: 0.5, up: 0.1, size: 0.22, life: 3.5, grav: 0.06, spread: 1.4, spin: 2, y: 0, ambient: true });
          }
          want = Math.max(want, 1);
        }
        if (rec.sails && motion !== 'still') { spinSails(rec, clockS); want = Math.max(want, 1); }
        if (rec.relic && fx && motion === 'full' && !rec.hidden) want = Math.max(want, relicLife(id, rec));
        // working buildings puff on the 60 BPM grid; the farmhouse chimney smokes gently all the time
        const inf = rec.def === 'farmhouse' && rec.key ? models.info(rec.key) : null;
        const chimney = Boolean(inf && (inf.anchors?.chimney || inf.smoke));
        if (fx && rec.vis && (rec.vis.working || chimney) && motion !== 'still') {
          const next = smokeAt.get(id) ?? 0;
          if (clockS >= next) {
            // thin, warm-grey wisps (visual-07): one small puff a beat, never a white column over the fields
            smokeAt.set(id, clockS + (rec.vis.working ? 0.8 + (rec.h % 5) / 25 : 2.2 + (rec.h % 7) / 20));
            fx.burst('dust', smokeOrigin(rec), {
              n: 1, color: '#E9E4D8', speed: 0.1, up: 0.75, size: 0.28, sizeEnd: 0.8, life: 1.8, grav: -0.04, spread: 0.12, spin: 0.6, y: 0,
              alpha: 0.3, ambient: true });
          }
          want = Math.max(want, 1);
        }
      }
      return want;
    },
    stats() {
      return { objects: recs.size, scheduled: heap.size, soil: soil.stats().instances, crops: crops.stats().instances,
        trees: trees.stats().instances, statics: statics.stats().instances, smalls: smalls.stats().instances, props: propHandles.length, notes: notes.size };
    },
  };
}
