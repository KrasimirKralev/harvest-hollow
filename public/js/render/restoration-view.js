// The Restoration Ledger in the world (GDD §5.9, projects 1-3 of M1b): three ruins by the river that come back to
// life bundle by bundle, so the couple can SEE what their donations do.
//   * Grandma's Old Greenhouse, between the lane and the river below the Old Orchard: a brick base and a bare frame
//     with a few panes left, then scaffolding and new glass bundle by bundle, then the whole glasshouse with its
//     green beds showing through the roof.
//   * The old water mill on the far bank, facing the farm: roofless walls and a broken, still wheel; then rafters,
//     shingles and new paddles; restored, its wheel turns and splashes (Feed Mill and Windmill run 20 % faster).
//   * The Stone Bridge where the lane crosses the river: the old piers under a makeshift wooden walkway; the arches
//     are rebuilt one by one under scaffolding; restored, the stone bridge carries the lane (and the Hollow Meadow
//     beyond the north-west edge becomes farm land: ground.js).
// Stage = bundles finished (0..4, 4 = restored) from world-state.js. Static parts live in the scenery batch; the mill
// wheel turns in the dynamic batch. A stage reached while this screen watches plays render-life's fx (`bundleDone`,
// `restored`). Before the Ledger opens (L16) the ruins are just scenery (no click). Owned by the render-world lane.
//
//   createRestoration({ scenery, dyn, glows, fx }) -> restoration
//     restoration.setState(state, now) / sync(ids, topics, state, now) / update(dt, now, { motion }) -> 0 | 1
//     restoration.places() -> [{ place: 'restoration', args: { id }, box, live }]
//     restoration.stages -> { greenhouse, mill_wheel, stone_bridge }
//   SITES                                       where the three projects stand (metres, pure)
import * as THREE from 'three';
import { PLACES, BRIDGE_X, riverZ, riverHalf, heightAt, ORCHARD_POND, WATER_Y } from './ground.js';
import { TILE_M, WORLD_TILES } from '../../../shared/content/config.js';
import { defOf } from '../../../shared/content/index.js';
import { footprint, getGrid } from '../../../shared/rules/grid.js';
import { box, cyl, cone, gable, ball, flag, ring, merge, modelKey, geoPart } from './world-kit.js';
import { restorationView } from './world-state.js';
import { models } from './models.js';

// Wave 3 (M2): Restoration 4-6.
//   * The Orchard Pond (4) in the north-east corner: a silted hollow and a fallen windpump; dug out, the tower goes up,
//     the tank and the stone channel to the farm, then the wheel turns in the wind (every tree ripens 10 % faster).
//   * The Town Fair Grounds (5) are the Fair's own (fair-view.js reads the stage).
//   * Grandma's Farmhouse (6): scaffolding round the farmhouse while the bundles come in, then flower beds and potted
//     bay trees along its front; the interior opens (interior-view.js).
export const SITES = Object.freeze({
  // the windpump's fan faces the farm (west); its channel runs from the tank to the farm's north-east corner
  orchard_pond: Object.freeze({ x: ORCHARD_POND.x - 6.6, z: ORCHARD_POND.z - 0.8, yaw: -Math.PI / 2 }),
  greenhouse: Object.freeze({ x: PLACES.greenhouse.x, z: PLACES.greenhouse.z, yaw: Math.PI }),
  // on the far bank, its wheel side to the river and the farm: our stand-in has the wheel on +z (turned half way),
  // render-life's on +x (turned a quarter)
  mill_wheel: Object.freeze({ x: PLACES.mill.x, z: PLACES.mill.z, yaw: Math.PI, realYaw: Math.PI / 2 }),
  stone_bridge: Object.freeze({ x: BRIDGE_X, z: riverZ(BRIDGE_X), yaw: 0, len: riverHalf(BRIDGE_X) * 2 + 8 }),
});

const BRICK = '#B5543F';
const CAP = '#E8DCC2';
const FRAME = '#F4F1E8';
const GLASS = '#BFE3EA';
const GLASS_D = '#9CCFD8';
const STONE = '#B8B0A2';
const STONE_D = '#9A9184';
const WOOD = '#B9814A';
const WOOD_D = '#8A5A35';

// ---------------------------------------------------------------------------------------------------
// Grandma's greenhouse, 12 x 8 m, the door (+z in the model) faces the farm across the lane
function scaffoldParts(w, d, h) {
  const parts = [];
  for (const sx of [-w / 2 - 0.5, 0, w / 2 + 0.5]) for (const sz of [-d / 2 - 0.5, d / 2 + 0.5]) parts.push(cyl(0.06, 0.06, h, 5, '#C99257', { x: sx, z: sz }));
  for (const y of [h * 0.45, h * 0.9]) for (const sz of [-d / 2 - 0.5, d / 2 + 0.5]) parts.push(box(w + 1, 0.08, 0.45, WOOD, { y, z: sz }));
  return parts;
}

export function greenhouseGeometry(stage, { open = false } = {}) {
  // open: the farm's own Greenhouse (rules: a ground-layer frame round 12 real plots): knee-high glass, an open roof
  // of ribs (the crops inside stay visible and clickable from the iso camera), no beds of its own
  const W = 11.4; const D = 7.4; const WALL = open ? 1.0 : 2.0; const RISE = open ? 1.2 : 1.9;
  const parts = [];
  // the brick base all round (whatever the stage), with a cream coping and the door gap
  for (const sz of [-D / 2, D / 2]) {
    if (sz > 0) { parts.push(box(W / 2 - 0.8, 0.6, 0.3, BRICK, { x: -W / 4 - 0.4, z: sz }), box(W / 2 - 0.8, 0.6, 0.3, BRICK, { x: W / 4 + 0.4, z: sz })); }
    else parts.push(box(W, 0.6, 0.3, BRICK, { z: sz }));
  }
  for (const sx of [-W / 2, W / 2]) parts.push(box(0.3, 0.6, D, BRICK, { x: sx }));
  parts.push(box(W + 0.1, 0.08, 0.4, CAP, { y: 0.6, z: -D / 2 }), box(0.4, 0.08, D, CAP, { x: -W / 2, y: 0.6 }), box(0.4, 0.08, D, CAP, { x: W / 2, y: 0.6 }));
  // posts every 1.9 m; rafters up to the ridge; how many stand depends on the stage
  const bays = 6;
  const framed = [3, 4, 5, 6, 6][stage];          // bays with posts and rafters
  const glazedWall = [0.3, 0.45, 0.65, 0.85, 1][stage];
  const glazedRoof = [0.15, 0.3, 0.55, 0.8, 1][stage];
  const h = (i) => ((i * 2654435761) >>> 0) / 4294967296;
  for (let i = 0; i <= bays; i++) {
    const x = -W / 2 + (i / bays) * W;
    const stands = i <= framed || stage === 4;
    if (!stands) {
      // a fallen rafter in the grass
      if (stage < 2) parts.push(box(0.12, 0.12, 3.6, FRAME, { x: x - 0.3, y: 0.12, z: 0.8, ry: 0.5 }));
      continue;
    }
    for (const sz of [-D / 2, D / 2]) parts.push(box(0.12, WALL, 0.12, FRAME, { x, y: 0.6, z: sz }));
    for (const sz of [-1, 1]) {
      const len = Math.hypot(D / 2, RISE);
      parts.push(box(0.12, 0.12, len, FRAME, { x, y: 0.6 + WALL + RISE / 2, z: sz * D / 4, rx: sz * Math.atan2(RISE, D / 2) }));
    }
  }
  parts.push(box(stage === 0 ? W * 0.55 : W, 0.14, 0.14, FRAME, { x: stage === 0 ? -W * 0.22 : 0, y: 0.6 + WALL + RISE }));
  for (const sz of [-D / 2, D / 2]) parts.push(box(stage === 0 ? W * 0.6 : W, 0.12, 0.14, FRAME, { x: stage === 0 ? -W * 0.2 : 0, y: 0.6 + WALL, z: sz }));
  // glass: wall panes and roof panes (a few left on the ruin, all of them restored); gaps between roof panes let the
  // green beds show through
  for (let i = 0; i < bays; i++) {
    const x = -W / 2 + ((i + 0.5) / bays) * W;
    const pw = W / bays - 0.16;
    for (const [sz, k] of [[-D / 2, 1], [D / 2, 2]]) {
      if (h(i * 7 + k) < glazedWall && !(sz > 0 && i >= 2 && i <= 3)) parts.push(box(pw, WALL - 0.12, 0.05, h(i + k) < 0.5 ? GLASS : GLASS_D, { x, y: 0.66, z: sz }, { shade: false }));
    }
    for (const sz of [-1, 1]) {
      if (open || h(i * 13 + sz + 5) >= glazedRoof) continue;
      const len = Math.hypot(D / 2, RISE) - 0.25;
      parts.push(box(pw, 0.05, len, sz > 0 ? GLASS : GLASS_D, { x, y: 0.62 + WALL + RISE / 2, z: sz * D / 4, rx: sz * Math.atan2(RISE, D / 2) }, { shade: false }));
    }
  }
  for (const sx of [-W / 2, W / 2]) {
    if ((stage < 2 && sx > 0) || open) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([sx, 0.6 + WALL, -D / 2, sx, 0.6 + WALL, D / 2, sx, 0.6 + WALL + RISE, 0], 3));
    g.computeVertexNormals();
    parts.push({ g, c: new THREE.Color(GLASS_D).toArray(), sway: 0, shade: false });
    for (const sz of [-D / 2 + 0.1, D / 2 - 0.1]) parts.push(box(0.05, WALL - 0.12, D / 2 - 0.2, GLASS, { x: sx, y: 0.66, z: sz / 2 }, { shade: false }));
  }
  // inside: twelve beds (restored: green and in flower; the ruin: weeds); the farm's Greenhouse has real plots instead
  for (let i = 0; i < (open ? 0 : 12); i++) {
    const bx = -W / 2 + 1.1 + (i % 6) * 1.85; const bz = i < 6 ? -1.6 : 1.6;
    parts.push(box(1.5, 0.3, 1.9, stage === 4 ? '#6B4A2E' : '#7A6A4A', { x: bx, z: bz }));
    if (stage === 4) {
      for (let k = 0; k < 3; k++) parts.push(ball(0.32, ['#6EA044', '#84B452', '#5A8C3A'][k], { x: bx - 0.4 + k * 0.4, y: 0.5, z: bz + (k - 1) * 0.35, sy: 0.8 }, { sway: 0.3 }));
      if (i % 3 === 0) parts.push(ball(0.14, ['#FF7A6B', '#FFD166', '#F7A6C4'][i % 3 === 0 ? (i / 3) % 3 : 0], { x: bx + 0.3, y: 0.85, z: bz }));
    } else if (h(i + 40) < 0.6) parts.push(cone(0.35, 0.8, 5, '#6E8F3E', { x: bx, y: 0.2, z: bz }, { sway: (x, y) => y * 0.6 }));
  }
  // the door (restored: a green-painted door; the ruin: an empty frame) and a shelf of pots by it
  parts.push(box(0.12, 2.4, 0.12, FRAME, { x: -0.8, y: 0, z: D / 2 }), box(0.12, 2.4, 0.12, FRAME, { x: 0.8, y: 0, z: D / 2 }), box(1.7, 0.14, 0.14, FRAME, { y: 2.4, z: D / 2 }));
  if (stage === 4 && open) {
    // the door stands open on its hinges; a shelf of pots by it
    parts.push(box(0.05, 2.3, 1.4, '#4F8A6A', { x: -0.78, z: D / 2 + 0.72 }));
    for (let k = 0; k < 3; k++) parts.push(cyl(0.16, 0.12, 0.26, 7, '#C8704A', { x: 2.0 + k * 0.42, y: 0, z: D / 2 + 0.35 }), ball(0.17, ['#FF9FB0', '#FFE27A', '#84B452'][k], { x: 2.0 + k * 0.42, y: 0.36, z: D / 2 + 0.35 }));
  } else if (stage === 4) {
    parts.push(box(1.45, 2.3, 0.05, '#4F8A6A', { z: D / 2 + 0.02 }), box(1.2, 1.0, 0.06, GLASS, { y: 1.15, z: D / 2 + 0.05 }, { shade: false }));
    parts.push(box(1.6, 0.08, 0.5, WOOD, { x: 2.2, y: 0.8, z: D / 2 + 0.45 }));
    for (let k = 0; k < 4; k++) {
      parts.push(cyl(0.16, 0.12, 0.26, 7, '#C8704A', { x: 1.6 + k * 0.4, y: 0.88, z: D / 2 + 0.45 }));
      parts.push(ball(0.18, ['#FF9FB0', '#FFE27A', '#84B452', '#F7A35C'][k], { x: 1.6 + k * 0.4, y: 1.25, z: D / 2 + 0.45 }));
    }
  } else {
    // broken panes in the grass, a rusty watering can
    for (let k = 0; k < 4 - stage; k++) parts.push(box(0.5, 0.03, 0.4, GLASS, { x: 3.2 + k * 0.7, y: 0.03, z: D / 2 + 1 + (k % 2) * 0.5, ry: k }, { shade: false }));
    parts.push(cyl(0.18, 0.2, 0.3, 7, '#8C6A4A', { x: -3.5, z: D / 2 + 0.8 }), box(0.4, 0.05, 0.05, '#8C6A4A', { x: -3.2, y: 0.25, z: D / 2 + 0.8, rz: 0.5 }));
  }
  if (stage >= 1 && stage <= 3) parts.push(...scaffoldParts(W, D, 4.6), flag(0.6, 0.35, '#FFC83D', { x: W / 2 + 0.5, y: 5.0, z: D / 2 + 0.5 }));
  return merge(parts);
}

/** After the restoration the glasshouse moves onto the farm (rules: a Greenhouse in the build tray): Grandma's old
 *  brick base by the river becomes her garden (RD-06, QA wave 2: it used to be a flat soil bed of tiny blobs). The
 *  foundation is kept as the garden wall; inside, a rose arch at the door, a gravel cross path, four raised beds with
 *  flowers in three height bands (tall spikes at the back, round clumps, low edging), a bench, a water butt and pots. */
export function greenhouseGardenGeometry() {
  const W = 11.4; const D = 7.4;
  const parts = [];
  const bud = (r, hex, t, o) => geoPart(new THREE.IcosahedronGeometry(r, 0), hex, t, { flat: true, ...o });
  const h = (i) => ((i * 2654435761) >>> 0) / 4294967296;
  // the kept foundation: low brick walls with their cream coping, open at the door (+z)
  for (const sz of [-D / 2, D / 2]) {
    if (sz > 0) for (const sx of [-1, 1]) parts.push(box(W / 2 - 0.9, 0.5, 0.3, BRICK, { x: sx * (W / 4 + 0.45), z: sz }), box(W / 2 - 0.85, 0.07, 0.42, CAP, { x: sx * (W / 4 + 0.45), y: 0.5, z: sz }));
    else parts.push(box(W, 0.5, 0.3, BRICK, { z: sz }), box(W + 0.1, 0.07, 0.42, CAP, { y: 0.5, z: sz }));
  }
  for (const sx of [-W / 2, W / 2]) parts.push(box(0.3, 0.5, D, BRICK, { x: sx }), box(0.42, 0.07, D, CAP, { x: sx, y: 0.5 }));
  // the lawn inside and a gravel cross path from the door
  parts.push(box(W - 0.3, 0.05, D - 0.3, '#7FAE52'), box(1.2, 0.07, D - 0.3, '#DCCDA8'), box(W - 0.3, 0.07, 1.1, '#DCCDA8'));
  // four raised beds in the quarters: timber sides, dark soil, three height bands of flowers
  const TALL = ['#9474D2', '#FF8FB0', '#FFFFFF', '#6C8EE0'];
  const MID = ['#FF7A6B', '#FFD166', '#F7A6C4', '#FFFFFF', '#F7A35C'];
  const LOW = ['#FFFFFF', '#FFE27A', '#C9A3E6'];
  [[-2.85, -1.85], [2.85, -1.85], [-2.85, 1.85], [2.85, 1.85]].forEach(([bx, bz], b) => {
    const bw = 4.2; const bd = 2.3;
    parts.push(box(bw, 0.42, bd, WOOD_D, { x: bx, z: bz }), box(bw - 0.2, 0.06, bd - 0.2, '#5A3C24', { x: bx, y: 0.4, z: bz }));
    // tall: delphinium / foxglove spikes along the back of the bed
    const zt = bz + (bz < 0 ? -0.6 : 0.6);
    for (let i = 0; i < 8; i++) {
      const x = bx - bw / 2 + 0.3 + i * ((bw - 0.6) / 7);
      const hh = 1.0 + h(b * 13 + i) * 0.55;
      parts.push(cyl(0.04, 0.05, hh * 0.5, 4, '#4E8F3A', { x, y: 0.42, z: zt }), bud(0.2, '#5E9E3A', { x, y: 0.55, z: zt, sy: 0.9 }),
        cone(0.17, hh * 0.62, 5, TALL[(i + b) % 4], { x, y: 0.42 + hh * 0.38, z: zt }, { sway: (px, py) => py * 0.4 }));
    }
    // mid: round flowering clumps, overlapping, filling the bed
    for (let i = 0; i < 6; i++) {
      const mx = bx - bw / 2 + 0.45 + i * ((bw - 0.9) / 5);
      parts.push(bud(0.42, ['#5E9E3A', '#6EA044', '#55963A'][i % 3], { x: mx, y: 0.62, z: bz + (i % 2 ? 0.08 : -0.08), sy: 0.72 }, { sway: 0.25 }));
      for (let k = 0; k < 4; k++) parts.push(bud(0.1, MID[(i + k + b) % 5], { x: mx + ((k % 2) - 0.5) * 0.36, y: 0.88, z: bz + (k < 2 ? -0.16 : 0.16) }, { sway: 0.3 }));
    }
    // low edging along the path side
    const ez = bz + (bz < 0 ? 0.82 : -0.82);
    for (let i = 0; i < 9; i++) {
      const x = bx - bw / 2 + 0.25 + i * ((bw - 0.5) / 8);
      parts.push(bud(0.17, '#6EA044', { x, y: 0.46, z: ez, sy: 0.6 }), bud(0.08, LOW[(i + b) % 3], { x: x + 0.05, y: 0.58, z: ez }));
    }
  });
  // the rose arch over the door gap
  const R = 1.0;
  for (const sx of [-1, 1]) parts.push(box(0.1, 2.0, 0.1, '#F4F1E8', { x: sx * R, z: D / 2 }));
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    parts.push(box(0.1, 0.1, 0.12, '#F4F1E8', { x: Math.cos(a) * R, y: 2.0 + Math.sin(a) * 0.7, z: D / 2 }));
    parts.push(bud(0.13, '#4C9A3E', { x: Math.cos(a) * R, y: 2.05 + Math.sin(a) * 0.7, z: D / 2 + 0.08 }));
    if (i % 2 === 0) parts.push(bud(0.08, i % 4 ? '#E83A55' : '#FF9FB0', { x: Math.cos(a) * R + 0.06, y: 2.12 + Math.sin(a) * 0.7, z: D / 2 + 0.16 }));
  }
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) parts.push(bud(0.12, '#4C9A3E', { x: sx * R + 0.06, y: 0.5 + k * 0.5, z: D / 2 + 0.1 }), bud(0.07, '#E83A55', { x: sx * R + 0.1, y: 0.62 + k * 0.5, z: D / 2 + 0.17 }));
  // Grandma's bench under the back wall, a water butt and pots by the arch
  parts.push(box(1.8, 0.1, 0.5, WOOD, { x: 0, y: 0.45, z: -D / 2 + 0.7 }), box(1.8, 0.45, 0.08, WOOD, { x: 0, y: 0.55, z: -D / 2 + 0.47 }));
  for (const sx of [-0.75, 0.75]) parts.push(box(0.1, 0.45, 0.45, WOOD_D, { x: sx, z: -D / 2 + 0.7 }));
  parts.push(cyl(0.38, 0.34, 0.9, 10, '#8A5A35', { x: W / 2 - 0.7, z: D / 2 - 0.7 }), cyl(0.4, 0.4, 0.06, 10, '#5E4A3A', { x: W / 2 - 0.7, y: 0.9, z: D / 2 - 0.7 }));
  for (let k = 0; k < 3; k++) parts.push(cyl(0.16, 0.12, 0.26, 7, '#C8704A', { x: 1.7 + k * 0.42, y: 0, z: D / 2 + 0.45 }), bud(0.16, ['#FF9FB0', '#FFE27A', '#84B452'][k], { x: 1.7 + k * 0.42, y: 0.36, z: D / 2 + 0.45 }));
  return merge(parts);
}

// ---------------------------------------------------------------------------------------------------
// The old water mill, 6 x 6 m on a stone plinth; the wheel turns on its south (+z) wall in the river
export const MILL_WHEEL = Object.freeze({ x: 0, y: 1.5, z: 3.9, r: 2.3 });
const MILL_Y = -0.35;

export function millGeometry(stage) {
  const parts = [box(6.2, 1.2, 6.2, STONE_D, { y: -1.1 })];
  const full = 3.4;
  // stone walls: the ruin's front corner has fallen; the walls go back up by stage 2
  const wallH = (k) => (stage >= 2 ? full : [full * 0.75, full * 0.85][stage] - (k % 2) * 0.6);
  parts.push(box(6, wallH(0), 0.5, STONE, { z: -2.75 }), box(0.5, wallH(1), 6, STONE, { x: -2.75 }), box(0.5, wallH(2), 6, STONE, { x: 2.75 }));
  parts.push(box(stage >= 2 ? 6 : 3.4, wallH(3), 0.5, STONE, { x: stage >= 2 ? 0 : -1.3, z: 2.75 }));
  if (stage < 2) for (let k = 0; k < 5; k++) parts.push(box(0.5, 0.35, 0.4, STONE, { x: 1.4 + (k % 3) * 0.5, y: 0, z: 3.4 + Math.floor(k / 3) * 0.4, ry: k }));
  // the roof: bare rafters (ruin), boards (stage 2-3), shingles and a chimney (restored)
  if (stage === 0) {
    for (const x of [-2.2, -0.6, 1.4]) parts.push(box(0.14, 0.14, 4.4, WOOD_D, { x, y: full + 0.7, z: -1, rx: 0.6 }));
  } else if (stage === 1) {
    for (const x of [-2.6, -1.3, 0, 1.3, 2.6]) for (const sz of [-1, 1]) parts.push(box(0.14, 0.14, 4.2, WOOD_D, { x, y: full + 0.9, z: sz * 1.5, rx: sz * 0.55 }));
  } else {
    parts.push(gable(6.8, 2.2, 7.0, stage === 4 ? '#9C6A3E' : WOOD, { y: full }));
    if (stage === 4) {
      parts.push(box(0.8, 2.2, 0.8, STONE_D, { x: -1.9, y: full + 0.6, z: -1.4 }), box(0.95, 0.15, 0.95, '#7E766A', { x: -1.9, y: full + 2.8, z: -1.4 }));
      parts.push(box(1.1, 2.0, 0.08, '#6E3E2A', { z: -3.02 }), box(1.3, 0.12, 0.6, WOOD, { y: 2.1, z: -3.2 }));
      for (const sx of [-1.8, 1.8]) parts.push(box(0.7, 0.8, 0.08, '#FFE6A8', { x: sx, y: 1.5, z: -3.02 }, { shade: false }), box(0.9, 0.2, 0.3, WOOD_D, { x: sx, y: 1.05, z: -3.15 }));
      for (let k = 0; k < 4; k++) parts.push(ball(0.12, ['#FF9FB0', '#FFE27A', '#FFFFFF', '#F7A35C'][k], { x: -2.1 + k * 0.2, y: 1.25, z: -3.18 }));
      for (const x of [2.1, 2.6]) parts.push(box(0.5, 0.5, 0.5, '#E8DCC2', { x, y: 0, z: -3.6 }));
    }
  }
  // the axle housing and the millrace chute feeding the wheel
  parts.push(box(0.6, 0.6, 0.8, WOOD_D, { x: MILL_WHEEL.x, y: MILL_WHEEL.y - 0.3, z: 3.0 }));
  parts.push(box(0.9, 0.3, 4.5, WOOD, { x: -2.2, y: MILL_WHEEL.y + MILL_WHEEL.r - 0.2, z: 3.6, rx: 0.08, ry: 1.2 }));
  if (stage >= 1 && stage <= 3) parts.push(...scaffoldParts(6, 6, 5.0), flag(0.6, 0.35, '#FFC83D', { x: 3.5, y: 5.4, z: 3.5 }));
  return merge(parts);
}

/** The water wheel (spins about its local z axle): a rim, spokes and paddles (the ruin's has half its paddles). */
export function wheelGeometry(broken) {
  const R = MILL_WHEEL.r;
  const parts = [];
  parts.push(...ring(16, (i, a) => box(2 * R * Math.sin(Math.PI / 16) + 0.05, 0.14, 0.6, WOOD_D, { x: Math.cos(a) * R * 0.97, y: Math.sin(a) * R * 0.97, rz: a + Math.PI / 2 })));
  parts.push(...ring(8, (i, a) => box(0.12, R, 0.12, WOOD, { rz: a - Math.PI / 2 })));          // hub to rim
  parts.push(...ring(12, (i, a) => (broken && i % 2 ? null : box(0.08, 0.7, 0.75, WOOD, { x: Math.cos(a) * (R + 0.15), y: Math.sin(a) * (R + 0.15), rz: a }))));
  parts.push(cyl(0.22, 0.22, 0.9, 8, '#5E4A3A', { y: -0.45, rx: Math.PI / 2 }));
  return merge(parts);
}

// ---------------------------------------------------------------------------------------------------
// The Stone Bridge, along z over the river (length L), deck rising from the banks to ~1.1 m at mid-river
export function stoneBridgeGeometry(stage, L = SITES.stone_bridge.len) {
  const parts = [];
  const deckY = (z) => 0.15 + 0.95 * Math.cos((Math.PI * z) / L) ** 1.5;
  const spans = [[-L / 2 + 1.5, -3.6], [-3.6, 3.6], [3.6, L / 2 - 1.5]];
  // piers with cut-waters, standing in the river (always: the old piers survived)
  for (const z of [-3.6, 3.6]) {
    parts.push(box(4.6, 3.1, 1.3, STONE_D, { y: -2.6, z }));
    for (const sx of [-1, 1]) parts.push(cone(0.65, 1.0, 4, STONE_D, { x: sx * 2.6, y: -2.6, z, rz: sx * Math.PI / 2, sy: 1, ry: Math.PI / 4 }));
  }
  for (const sz of [-1, 1]) parts.push(box(5.2, 1.6, 2.2, STONE, { y: -1.2, z: sz * (L / 2 - 1.1) }));
  // which spans stand: the ruin keeps the two outer stubs; stage 2 rebuilds the near arch, 3 the far, 4 the middle
  const has = [stage >= 2, stage >= 4, stage >= 3];
  if (stage < 2) {
    parts.push(box(4.4, 0.6, 2.2, STONE, { y: deckY(-L / 2 + 2) - 0.45, z: -L / 2 + 2.6 }), box(4.4, 0.6, 2.0, STONE, { y: deckY(L / 2 - 2) - 0.45, z: L / 2 - 2.5 }));
    // fallen blocks in the water
    for (let k = 0; k < 6; k++) parts.push(box(0.9, 0.6, 0.7, STONE_D, { x: -1.8 + (k % 3) * 1.6, y: -1.2 - (k % 2) * 0.3, z: -1.8 + Math.floor(k / 3) * 3.4, ry: k * 0.7, rz: (k % 3) * 0.2 }));
  }
  spans.forEach(([z0, z1], si) => {
    if (!has[si]) return;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const za = z0 + ((i + 0.5) / n) * (z1 - z0);
      const len = (z1 - z0) / n + 0.06;
      // deck slab, parapets and coping
      parts.push(box(4.6, 0.55, len, STONE, { y: deckY(za) - 0.55, z: za }));
      for (const sx of [-2.2, 2.2]) {
        parts.push(box(0.35, 0.65, len, STONE, { x: sx, y: deckY(za), z: za }));
        parts.push(box(0.45, 0.12, len, '#CFC7B8', { x: sx, y: deckY(za) + 0.65, z: za }));
      }
      // the arch: voussoirs under the deck following a half circle
      const t = (i + 0.5) / n;
      const archY = deckY(za) - 0.55 - Math.sin(t * Math.PI) * 0;
      const spring = -0.9;
      const ay = spring + Math.sin(t * Math.PI) * (archY - spring - 0.25);
      parts.push(box(4.4, Math.max(0.25, archY - ay), len, STONE_D, { y: ay, z: za }));
    }
  });
  // a road surface on the restored bridge
  if (stage === 4) for (let i = 0; i < 18; i++) { const za = -L / 2 + ((i + 0.5) / 18) * L; parts.push(box(3.9, 0.04, L / 18 + 0.04, '#C8B48E', { y: deckY(za) + 0.0, z: za })); }
  if (stage >= 1 && stage <= 3) {
    for (const z of [-2.2, 0, 2.2]) for (const sx of [-2.6, 2.6]) parts.push(cyl(0.06, 0.06, 4.6, 5, '#C99257', { x: sx, y: -2.4, z }));
    for (const y of [-0.6, 0.8]) for (const sx of [-2.6, 2.6]) parts.push(box(0.4, 0.08, 5.0, WOOD, { x: sx, y, z: 0 }));
    parts.push(flag(0.6, 0.35, '#FFC83D', { x: 2.6, y: 2.4, z: 2.2 }));
  }
  return merge(parts);
}

/** The makeshift wooden walkway the lane uses until the Stone Bridge is restored. */
function walkwayGeometry(len) {
  const parts = [];
  const planks = Math.round(len / 0.5);
  for (let i = 0; i < planks; i++) parts.push(box(4.2, 0.16, 0.46, i % 2 ? '#B9814A' : '#C99257', { y: 0.55, z: -len / 2 + 0.25 + i * 0.5 }));
  for (const sx of [-2.15, 2.15]) {
    parts.push(box(0.16, 0.12, len, '#A86F3A', { x: sx, y: 1.45 }));
    for (let i = 0; i <= 6; i++) parts.push(box(0.2, 1.1, 0.2, '#9C6634', { x: sx, y: 0.4, z: -len / 2 + (i / 6) * len }));
  }
  parts.push(box(3.8, 0.3, len - 1, '#8A5A35', { y: 0.17 }));
  for (let i = 0; i < 4; i++) parts.push(cyl(0.14, 0.16, 2.6, 6, '#8A5A35', { x: i % 2 ? 1.6 : -1.6, y: -2.2, z: (i < 2 ? -1 : 1) * 1.2 }));
  return merge(parts);
}

// ---------------------------------------------------------------------------------------------------
// The Orchard Pond's windpump (Restoration 4): a lattice tower 6 m tall with a platform, the fan wheel and its tail on
// top (the wheel turns in the dynamic batch once the pond is restored), a stone tank and the channel to the farm
export const PUMP = Object.freeze({ hub: Object.freeze([0, 6.3, 0.55]), r: 1.45 });
export function windpumpGeometry(stage) {
  const parts = [];
  const H = 6.0;
  const ruin = stage <= 1;                           // the old tower broke at half height until it is rebuilt (stage 2)
  const top = ruin ? 3.1 : H;
  const leg = (sx, sz, h, y0 = 0, col = '#B8B0A2') => box(0.12, h, 0.12, col, { x: sx * (0.95 - y0 * 0.06), y: y0, z: sz * (0.95 - y0 * 0.06), rx: -sz * 0.06, rz: sx * 0.06 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(leg(sx, sz, top - (ruin ? (sx + sz + 2) * 0.3 : 0), 0, ruin ? '#8C8880' : '#B8B0A2'));
  for (const y of [1.2, 2.6, 4.0, 5.2]) {
    if (y > top - 0.3) continue;
    const w = 1.9 - y * 0.12;
    for (const [rot, dx, dz] of [[0, 0, -1], [0, 0, 1], [1, -1, 0], [1, 1, 0]]) parts.push(box(rot ? 0.06 : w, 0.06, rot ? w : 0.06, '#9A9184', { x: dx * (w / 2), y, z: dz * (w / 2) }));
  }
  if (ruin) {
    // the fallen top half lies in the grass beside the stump
    for (const dz of [-0.55, 0.55]) parts.push(box(3.0, 0.1, 0.1, '#8C8880', { x: -2.6, y: 0.08, z: dz - 1.2, ry: 0.2 }));
    for (let k = 0; k < 4; k++) parts.push(box(0.06, 0.06, 1.1, '#8C8880', { x: -1.4 - k * 0.8, y: 0.12, z: -1.2 + (k % 2) * 0.1, ry: 0.2 }));
  }
  if (!ruin) {
    parts.push(box(1.2, 0.1, 1.2, WOOD, { y: H - 0.1 }));
    for (const [sx, sz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) parts.push(box(0.05, 0.6, 0.05, WOOD_D, { x: sx, y: H, z: sz }));
    parts.push(cyl(0.14, 0.14, 0.6, 8, '#5E4A3A', { y: H + 0.3, rx: Math.PI / 2, z: 0.2 }));
  }
  if (stage >= 3) {
    // the tail vane (points away from the wind) and the pump rod down the tower
    parts.push(box(0.06, 0.06, 2.0, '#5E4A3A', { y: PUMP.hub[1], z: -1.0 }), box(0.04, 0.9, 1.0, '#D2483C', { y: PUMP.hub[1] - 0.45, z: -2.0 }));
    parts.push(box(0.04, H, 0.04, '#5E4A3A', { y: 0.2 }));
  }
  if (stage === 2) parts.push(...scaffoldParts(2.0, 2.0, 5.5), flag(0.6, 0.35, '#FFC83D', { x: 1.5, y: 5.9, z: 1.5 }));
  // the tank on stone feet toward the farm, its spout over the channel's head
  const T = PUMP_TANK;
  if (stage >= 2) {
    parts.push(box(0.4, 0.8, 0.4, STONE_D, { x: T[0] - 0.6, z: T[1] }), box(0.4, 0.8, 0.4, STONE_D, { x: T[0] + 0.6, z: T[1] }));
    if (stage >= 3) parts.push(cyl(0.95, 0.95, 1.2, 14, '#8A9A8C', { x: T[0], y: 0.8, z: T[1] }), cyl(0.97, 0.97, 0.08, 14, '#5E6A60', { x: T[0], y: 2.0, z: T[1] }));
    else parts.push(cyl(0.95, 0.95, 0.5, 14, '#8A9A8C', { x: T[0], y: 0.8, z: T[1] }));
  }
  // the ruin's fallen wheel in the grass
  if (stage <= 2) {
    for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 1.4; parts.push(box(0.9, 0.04, 0.22, '#9A9184', { x: -2.0 + Math.cos(a) * 0.7, y: 0.05 + k * 0.01, z: 1.6 + Math.sin(a) * 0.7, ry: a })); }
  }
  // stage 1-3: a spade in a heap of silt and the wheelbarrow that dug the pond (on the pond's side)
  if (stage >= 1 && stage <= 3) parts.push(ball(0.8, '#6E5A3A', { x: -2.4, y: -0.2, z: -2.4, sy: 0.5 }), box(0.06, 1.2, 0.06, WOOD_D, { x: -2.3, y: 0.2, z: -2.3, rz: 0.4 }),
    box(0.9, 0.3, 0.6, '#57758A', { x: -1.2, y: 0.35, z: -3.0 }), cyl(0.18, 0.18, 0.08, 8, '#3C3A36', { x: -1.7, y: 0.18, z: -3.0, rx: Math.PI / 2 }));
  // restored: flowers, a bench facing the water
  if (stage === 4) {
    parts.push(box(1.6, 0.1, 0.45, WOOD, { x: -2.6, y: 0.45, z: -2.8, ry: 0.4 }), box(1.6, 0.4, 0.08, WOOD, { x: -2.5, y: 0.55, z: -2.6, ry: 0.4 }));
    for (let k = 0; k < 8; k++) parts.push(ball(0.16, ['#FF9FB0', '#FFE27A', '#FFFFFF', '#F7A35C'][k % 4], { x: 2.2 + (k % 4) * 0.35, y: 0.15, z: 0.4 + Math.floor(k / 4) * 0.35 }));
  }
  return merge(parts);
}
/** The tank's place in the windpump's frame (toward the farm's north-east corner). */
const PUMP_TANK = Object.freeze([1.3, 1.8]);
/** The fan wheel: 14 sheet-metal blades round a hub and a rim (spins about its local z). */
export function pumpWheelGeometry() {
  const parts = [];
  parts.push(...ring(14, (i, a) => box(0.32, PUMP.r * 0.62, 0.03, '#D9DCDD', { x: Math.cos(a) * PUMP.r * 0.62, y: Math.sin(a) * PUMP.r * 0.62, rz: a - Math.PI / 2, ry: 0.35 })));
  parts.push(geoPart(new THREE.TorusGeometry(PUMP.r, 0.035, 4, 20), '#9A9184'), geoPart(new THREE.TorusGeometry(PUMP.r * 0.35, 0.03, 4, 14), '#9A9184'));
  parts.push(cyl(0.14, 0.14, 0.2, 8, '#5E4A3A', { rx: Math.PI / 2, z: -0.1 }));
  return merge(parts);
}
/** The silt over the old pond (stage 0): a muddy, reed-grown skin on the water. */
function siltGeometry() {
  const parts = [cyl(ORCHARD_POND.rx * 1.05, ORCHARD_POND.rx * 1.08, 0.06, 20, '#6E6A44', { sz: ORCHARD_POND.rz / ORCHARD_POND.rx })];
  for (let k = 0; k < 16; k++) { const a = k * 2.4; const r = (k % 5) * 0.8; parts.push(cone(0.06, 0.8 + (k % 3) * 0.3, 4, '#7A8A4A', { x: Math.cos(a) * r, y: 0.05, z: Math.sin(a) * r * 0.8 })); }
  return merge(parts);
}
/** The stone channel from the tank to the farm's north-east corner (restored: water runs in it). */
function channelGeometry(stage) {
  const parts = [];
  // in the windpump's frame: from the tank to the farm's north-east corner (the site turns it a quarter west)
  const pts = [[PUMP_TANK[0], PUMP_TANK[1] + 0.9], [3.2, 4.0], [5.0, 6.2], [6.4, 8.0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i]; const [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0) + 0.2; const ry = -Math.atan2(z1 - z0, x1 - x0);
    const nx = -(z1 - z0) / len; const nz = (x1 - x0) / len;
    for (const off of [-0.35, 0.35]) parts.push(box(len, 0.25, 0.18, STONE, { x: (x0 + x1) / 2 + nx * off, z: (z0 + z1) / 2 + nz * off, ry }));
    parts.push(box(len, 0.06, 0.55, STONE_D, { x: (x0 + x1) / 2, y: -0.02, z: (z0 + z1) / 2, ry }));
    if (stage >= 3) parts.push(box(len, 0.05, 0.52, '#6FB0BA', { x: (x0 + x1) / 2, y: 0.14, z: (z0 + z1) / 2, ry }, { shade: false }));
  }
  return merge(parts);
}

// Grandma's Farmhouse (Restoration 6): what stands round the farmhouse, in its own frame (front = +z, 4 x 4 tiles)
/** `keep` (bit i): which of the restored front's pieces have free ground (0 left bed, 1 right bed, 2 left bay, 3 right
 *  bay, 4 the mat): a piece over something the couple placed is left out. */
export const DRESSING_SPOTS = Object.freeze([[-3.05, 5.0], [3.05, 5.0], [-1.15, 4.8], [1.15, 4.8], [0, 4.75]]);
export function farmhouseDressing(stage, keep = 31) {
  const parts = [];
  const R = 4.25;
  if (stage >= 1 && stage <= 3) {
    // scaffold poles and planks on the sides and the back, a ladder, paint pots and a stack of new shingles
    for (const [x, z] of [[-R, -R], [0, -R], [R, -R], [-R, 0], [R, 0], [-R, R * 0.6], [R, R * 0.6]]) parts.push(cyl(0.06, 0.06, 5.6, 5, '#C99257', { x, z }));
    for (const y of [1.8, 3.6]) {
      parts.push(box(2 * R + 0.3, 0.07, 0.4, WOOD, { y, z: -R }));
      for (const sx of [-R, R]) parts.push(box(0.4, 0.07, R * 1.6, WOOD, { x: sx, y, z: -R * 0.2 }));
    }
    parts.push(box(0.5, 4.0, 0.06, '#9C6A3E', { x: R + 0.5, y: 0.1, z: 1.2, rz: 0.12 }));
    for (let k = 0; k < 8; k++) parts.push(box(0.4, 0.04, 0.06, '#9C6A3E', { x: R + 0.5 - k * 0.06, y: 0.4 + k * 0.48, z: 1.24 }));
    for (const [x, c] of [[R + 0.9, '#F1E6CF'], [R + 1.3, '#7FA7A0']]) parts.push(cyl(0.16, 0.16, 0.3, 8, c, { x, z: 2.6 }));
    for (let k = 0; k < stage + 1; k++) parts.push(box(1.0, 0.12, 0.6, '#7A4B3A', { x: -R - 0.9, y: k * 0.12, z: 2.2 }));
    parts.push(flag(0.6, 0.35, '#FFC83D', { x: R, y: 5.6, z: -R }));
  }
  if (stage === 4) {
    // restored: flower beds along the front either side of the steps, two clipped bay trees in pots by the door and a
    // new doormat (all on the ground in front of the house: the model's own walls are render-life's)
    const FL = ['#FF9FB0', '#FFE27A', '#FFFFFF', '#F7A35C', '#B79BE0'];
    [-1, 1].forEach((side, i) => {
      if (keep & (1 << i)) {
        parts.push(box(1.7, 0.22, 0.7, '#6E5A3A', { x: side * 3.05, z: R + 0.75 }));
        for (let k = 0; k < 6; k++) parts.push(ball(0.15, FL[(k + side + 5) % 5], { x: side * 3.05 - 0.75 + k * 0.3, y: 0.3, z: R + 0.75 + (k % 2) * 0.15 }));
      }
      if (keep & (1 << (2 + i))) parts.push(cyl(0.22, 0.18, 0.42, 8, '#C8643A', { x: side * 1.15, z: R + 0.55 }), cyl(0.04, 0.05, 0.5, 5, '#6E4C30', { x: side * 1.15, y: 0.42, z: R + 0.55 }),
        ball(0.36, '#4E8A3A', { x: side * 1.15, y: 1.1, z: R + 0.55 }));
    });
    if (keep & 16) parts.push(box(1.0, 0.03, 0.55, '#9C6A3E', { z: R + 0.5 }, { shade: false }));
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------------------------------
export function createRestoration({ scenery, dyn = null, glows = null, fx = null }) {
  let handles = [];
  let wheel = null;
  let wheelKey = null;
  let millYaw = 0;
  let stages = { greenhouse: -1, mill_wheel: -1, stone_bridge: -1, orchard_pond: -1, farmhouse: -1 };
  let lives = { greenhouse: false, mill_wheel: false, stone_bridge: false, orchard_pond: false, farmhouse: false };
  let pump = null;                  // the windpump's fan wheel (dynamic) once mounted
  let pumpAngle = 0;
  let house = null;                 // the farmhouse's place (metres, yaw) for Grandma's Farmhouse dressing
  let watched = false;              // fx only for a stage reached while this screen watches
  let angle = 0;
  let splashAt = 0;
  let clock = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3(1, 1, 1);
  const boxes = {
    greenhouse: new THREE.Box3(new THREE.Vector3(SITES.greenhouse.x - 6.5, -0.2, SITES.greenhouse.z - 4.5), new THREE.Vector3(SITES.greenhouse.x + 6.5, 4.8, SITES.greenhouse.z + 4.5)),
    mill_wheel: new THREE.Box3(new THREE.Vector3(SITES.mill_wheel.x - 3.6, -1, SITES.mill_wheel.z - 4.2), new THREE.Vector3(SITES.mill_wheel.x + 3.6, 6.2, SITES.mill_wheel.z + 3)),
    stone_bridge: new THREE.Box3(new THREE.Vector3(BRIDGE_X - 3, -1.5, SITES.stone_bridge.z - SITES.stone_bridge.len / 2), new THREE.Vector3(BRIDGE_X + 3, 2.5, SITES.stone_bridge.z + SITES.stone_bridge.len / 2)),
    orchard_pond: new THREE.Box3(new THREE.Vector3(SITES.orchard_pond.x - 3, -0.5, ORCHARD_POND.z - 5), new THREE.Vector3(ORCHARD_POND.x + ORCHARD_POND.rx + 0.5, 7.5, ORCHARD_POND.z + 5)),
  };
  const add = (k, x, y, z, yaw, s = sc.set(1, 1, 1)) => {
    q.setFromAxisAngle(Y, yaw);
    m4.compose(v.set(x, y, z), q, s);
    const h = scenery.add(k, m4);
    handles.push(h);
    return h;
  };

  function build() {
    for (const h of handles) scenery.remove(h);
    handles = [];
    const g = SITES.greenhouse; const ml = SITES.mill_wheel; const br = SITES.stone_bridge;
    const gs = Math.max(0, stages.greenhouse); const ms = Math.max(0, stages.mill_wheel); const bs = Math.max(0, stages.stone_bridge);
    // stages 0-3: the ruin under repair; restored, the glasshouse is the couple's to place on the farm (the rules put
    // a Greenhouse in the build tray) and its old brick base here blooms
    if (gs < 4) add(modelKey(scenery, `restore:greenhouse:${gs}`, () => greenhouseGeometry(gs)).key, g.x, 0, g.z, g.yaw);
    else add(modelKey(scenery, 'restore:greenhouse:garden', greenhouseGardenGeometry).key, g.x, 0, g.z, g.yaw);
    const mm = modelKey(scenery, `restore:mill_wheel:${ms}`, () => millGeometry(ms));
    millYaw = mm.real ? ml.realYaw : ml.yaw;
    // the mill stands a little down the bank so its wheel dips into the river; render-life's gets a stone foundation
    // down to the water (our stand-in has its own plinth)
    add(mm.key, ml.x, MILL_Y, ml.z, millYaw);
    if (mm.real) add(modelKey(scenery, 'hh-mill-plinth', () => merge([box(5.0, 2.4, 3.3, STONE_D, { y: -2.38 }), box(5.2, 0.1, 3.5, STONE, { y: -0.02 })])).key, ml.x - 0.6, MILL_Y, ml.z + 0.3, 0);
    // the bridge: render-life's model (22 m along x) is turned along the river crossing and scaled to span it; a model
    // shorter than 80 % of the span would flatten its arches into a slab, so the stand-in three-arch bridge is used then
    let bk = modelKey(scenery, `restore:stone_bridge:${bs}`, () => stoneBridgeGeometry(bs));
    if (bk.real && bk.bounds.max.x - bk.bounds.min.x < br.len * 0.8) bk = modelKey(scenery, `hh-stone-bridge-${bs}`, () => stoneBridgeGeometry(bs));
    if (bk.real) {
      const along = Math.max(1, bk.bounds.max.x - bk.bounds.min.x);
      add(bk.key, br.x, 0, br.z, Math.PI / 2, sc.set(br.len / along, 1, 1));
    } else add(bk.key, br.x, 0, br.z, 0);
    // render-life's bridge carries its own planks over the gap (stages 0-3); only the stand-in needs the walkway
    if (bs < 4 && !bk.real) add(modelKey(scenery, 'hh-bridge-walkway', () => walkwayGeometry(br.len)).key, br.x, -0.1, br.z, 0);
    // the wheel (dynamic: it turns once the mill is restored). render-life's stage models carry their own wheel (fallen,
    // on the bank, none, new and still) until the mill is restored, so its turning part shows only at stage 4 (RD-06:
    // an intact wheel stood in front of the ruin's broken one)
    if (dyn) {
      const real = models.has('restore:mill_wheel:wheel');
      const wk = real ? (ms === 4 ? 'restore:mill_wheel:wheel' : null) : (ms >= 3 ? 'hh-mill-wheel' : 'hh-mill-wheel-broken');
      if (wk !== wheelKey) {
        if (wheel !== null) dyn.remove(wheel);
        wheel = null;
        if (wk) wheel = dyn.add(wk === 'restore:mill_wheel:wheel' ? wk : modelKey(dyn, wk, () => wheelGeometry(ms < 3)).key, m4.identity());
        wheelKey = wk;
      }
      placeWheel();
    }
    // Restoration 4: the Orchard Pond (silt over the water until it is dug, the windpump, the tank and the channel)
    const op = SITES.orchard_pond; const os = Math.max(0, stages.orchard_pond);
    if (os === 0) add(modelKey(scenery, 'hh-orchard-silt', siltGeometry).key, ORCHARD_POND.x, WATER_Y + 0.02, ORCHARD_POND.z, 0);
    add(modelKey(scenery, `restore:orchard_pond:${os}`, () => windpumpGeometry(os)).key, op.x, heightAt(op.x, op.z) - 0.05, op.z, op.yaw);
    if (os >= 2) add(modelKey(scenery, `hh-orchard-channel-${os >= 3 ? 'wet' : 'dry'}`, () => channelGeometry(os)).key, op.x, heightAt(op.x, op.z) - 0.05, op.z, op.yaw);
    if (dyn) {
      const wantPump = os >= 3;
      if (wantPump && pump === null) pump = dyn.add(modelKey(dyn, 'hh-pump-wheel', pumpWheelGeometry).key, m4.identity());
      if (!wantPump && pump !== null) { dyn.remove(pump); pump = null; }
      placePump();
    }
    // Restoration 6: Grandma's Farmhouse dressing round the farmhouse itself
    const fs = Math.max(0, stages.farmhouse);
    if (house && fs >= 1) {
      // the restored front: only the pieces whose ground is free of anything the couple placed
      let keep = 31;
      if (fs === 4 && state) {
        const c = Math.cos(house.yaw); const sn = Math.sin(house.yaw);
        const grid = getGrid(state);
        DRESSING_SPOTS.forEach(([lx, lz], i) => {
          const tx = Math.floor((house.x + lx * c + lz * sn) / TILE_M); const tz = Math.floor((house.z - lx * sn + lz * c) / TILE_M);
          if (tx < 0 || tz < 0 || tx >= WORLD_TILES || tz >= WORLD_TILES || grid.object[tz * WORLD_TILES + tx] !== null) keep &= ~(1 << i);
        });
      }
      add(modelKey(scenery, `hh-farmhouse-${fs === 4 ? `done-${keep}` : 'works'}-${fs}`, () => farmhouseDressing(fs, keep)).key, house.x, 0, house.z, house.yaw);
    }
    if (glows) {
      const warm = new THREE.Color('#FFD395');
      const list = [];

      if (ms === 4) for (const sx of [-1.8, 1.8]) list.push({ pos: new THREE.Vector3(ml.x + sx, 1.5, ml.z - 3.1), size: 1.4, color: warm, billboard: true });
      glows.set('world:restore', list);
    }
  }

  function placePump() {
    if (pump === null) return;
    const op = SITES.orchard_pond;
    const [hx, hy, hz] = PUMP.hub;
    // the fan faces into the wind (+z of the tower's frame, which the site turns a quarter)
    m4.makeTranslation(op.x, heightAt(op.x, op.z) - 0.05, op.z).multiply(new THREE.Matrix4().makeRotationY(op.yaw))
      .multiply(new THREE.Matrix4().makeTranslation(hx, hy, hz)).multiply(new THREE.Matrix4().makeRotationZ(pumpAngle));
    dyn.setMatrix(pump, m4);
  }

  function placeWheel() {
    if (wheel === null) return;
    const ml = SITES.mill_wheel;
    const info = wheelKey === 'restore:mill_wheel:wheel' ? models.info(wheelKey) : null;
    const piv = info && Array.isArray(info.pivot) ? info.pivot : [MILL_WHEEL.x, MILL_WHEEL.y, MILL_WHEEL.z];
    // in the mill's own frame: its yaw, then the pivot, then the spin about the wheel's axle (render-life: local x)
    const spin = info && info.axis === 'x' ? new THREE.Matrix4().makeRotationX(angle) : new THREE.Matrix4().makeRotationZ(angle);
    m4.makeTranslation(ml.x, MILL_Y, ml.z).multiply(new THREE.Matrix4().makeRotationY(millYaw))
      .multiply(new THREE.Matrix4().makeTranslation(piv[0], piv[1], piv[2])).multiply(spin);
    dyn.setMatrix(wheel, m4);
  }

  function farmhouseOf(s) {
    const objs = s?.farm?.objects || {};
    for (const id of Object.keys(objs).sort()) {
      const o = objs[id];
      if (o.def !== 'farmhouse' || !Number.isFinite(o.x)) continue;
      const def = defOf('farmhouse');
      const [w, d] = def ? footprint(def, o.rot || 0) : [4, 4];
      return { x: (o.x + w / 2) * TILE_M, z: (o.z + d / 2) * TILE_M, yaw: (o.rot || 0) * (Math.PI / 2) };
    }
    return null;
  }

  let state = null;
  function apply(s, now) {
    state = s;
    const hp = farmhouseOf(s);
    const houseMoved = JSON.stringify(hp) !== JSON.stringify(house);
    house = hp;
    const list = restorationView(s, now);
    const next = {};
    const nextLive = {};
    for (const p of list) if (p.id in stages) { next[p.id] = p.stage; nextLive[p.id] = p.live; }
    lives = { ...lives, ...nextLive };
    let changed = false;
    for (const id of Object.keys(stages)) {
      const was = stages[id];
      const now2 = next[id] ?? 0;
      if (was === now2) continue;
      changed = true;
      if (watched && was >= 0 && now2 > was && fx) {
        const site = SITES[id];
        const pos = new THREE.Vector3(site.x, heightAt(site.x, site.z), site.z);
        fx.play(now2 === 4 ? { e: 'restored', project: id } : { e: 'bundleDone', project: id }, pos, {});
      }
    }
    stages = { ...stages, ...next };
    if (changed || houseMoved) build();
    watched = true;
  }

  return {
    get stages() { return { ...stages }; },
    setState(s, now) { watched = false; apply(s, now); },
    sync(ids, topics, s, now) { if (topics.has('*') || topics.has('restore') || topics.has('xp') || topics.has('objects')) apply(s, now); },
    update(dt, now, { motion = 'full' } = {}) {
      clock += dt;
      // the restored windpump turns in the wind (Restoration 4)
      let pumpWant = 0;
      if (pump !== null && stages.orchard_pond === 4 && motion !== 'still') { pumpAngle -= dt * 1.6; placePump(); pumpWant = 1; }
      if (wheel === null || stages.mill_wheel !== 4 || motion === 'still') return pumpWant;
      angle -= dt * 0.9;
      placeWheel();
      // the restored wheel splashes where its paddles meet the river
      if (fx && clock > splashAt) {
        splashAt = clock + 0.45;
        const ml = SITES.mill_wheel;
        // where the paddles meet the river: the wheel's pivot in the world, at the water line
        const piv = wheelKey === 'restore:mill_wheel:wheel' ? (models.info(wheelKey)?.pivot || [2.15, 1.25, 0]) : [MILL_WHEEL.x, MILL_WHEEL.y, MILL_WHEEL.z];
        const c = Math.cos(millYaw); const sn = Math.sin(millYaw);
        const wx = ml.x + piv[0] * c + piv[2] * sn; const wz = ml.z - piv[0] * sn + piv[2] * c;
        fx.burst('droplet', new THREE.Vector3(wx + (Math.random() - 0.5) * 0.8, -0.42, wz + (Math.random() - 0.5) * 0.8), { n: 3, color: '#D6F1FF', speed: 0.9, up: 1.6, size: 0.1, grav: 0.9, life: 0.5, y: 0, ambient: true });
      }
      return 1;
    },
    places() {
      return Object.keys(boxes).map((id) => ({ place: 'restoration', args: { id }, box: boxes[id], live: lives[id] }));
    },
    stats() { return { ...stages, instances: handles.length }; },
  };
}
