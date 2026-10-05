// The farmhouse interior (GDD §5.9 Restoration 6 "Grandma's Farmhouse": interior decorating, the Memory Book wall,
// Grandma's duet table, her visit; content farmhouse.js INTERIOR / FURNITURE; rules-economy actions/interior.js): a
// cozy room the couple steps into, drawn as a dollhouse cut-away (the two front walls left open toward the camera) in
// its own scene, with its own camera and light: warm window light by day, the fire and the lamps at night, the sky in
// the window following the farm's day. The room's shell carries four of content's fixed pieces as built-ins (the
// Stone Hearth, Grandma's Keepsake Dresser, the Memory Book Wall and the Garden Window, at content's cells and slots);
// every other piece (Grandma's movable duet table, the Ribbon Wall, the couple's furniture) is drawn from the rules'
// items: floor and object pieces on the 1 m grid, wall pieces on their wall slots. The farmers stand by the fire (the
// partner only when the client says they are inside too); Grandma stands by her duet table while she visits and is in
// the parlour (or it is night). Owned by the render-world lane; the furniture models are render-life's
// (`furniture:<id>`: footprint centre on the floor, front +z; wall pieces with their back on the wall at z = 0 and
// absolute heights), with stand-ins here.
//
//   createInterior({ renderer }) -> interior            (render/index.js makes it on the first enter)
//     interior.scene / interior.camera                  rendered instead of the farm while inside
//     interior.setState(state, { me, now }) / interior.sync(ids, topics, state, now)
//     interior.update(dt, now, sky, { motion }) -> 0 | 1 | 2   sky: daynight's current state (night, horizon, top)
//     interior.pick(ndc) -> { kind: 'floor', x, z, inside } | { kind: 'item', id, def } | { kind: 'spot', id, item? }
//          | { kind: 'wall', wall, at } | null
//          spots: 'door' (leave), 'fire', 'memory_wall', 'window' (the built-in fixed pieces; `item` = their rules id),
//          'grandma' (during her visit). Floor x/z are integer cells; a wall pick gives the wall and the slot.
//     interior.ghost(defId | null, { x, z, rot } | { wall, at } | null, valid)   the furniture placement preview
//     interior.rotate(dir) / interior.zoom(factor) / interior.resize(aspect) / interior.focus()
//     interior.setPresent(pids)                         who stands inside (default: only me)
//     interior.stats() -> { items, figures, visit }
//   ROOM { w, d, h, cell }   BUILT_IN cells   BUILT_IN_DEFS   itemPlacement(o, def, absolute?) -> { x, z, y, yaw, wall }
import * as THREE from 'three';
import { defOf, INTERIOR, CONTENT } from '../../../shared/content/index.js';
import { box, cyl, cone, ball, gable, ring, merge, geoPart } from './world-kit.js';
import { models } from './models.js';
import { createBatch } from './instancing.js';
import { interiorView, grandmaVisit, furnitureDef } from './world-state.js';
import { CHIBI } from './avatars-view.js';

/** The room: w x d metres of floor (1 m cells), walls h high. The back walls are z = 0 and x = 0 (content INTERIOR). */
export const ROOM = Object.freeze({ w: INTERIOR?.grid?.[0] ?? 10, d: INTERIOR?.grid?.[1] ?? 8, h: 3.3, cell: 1 });
const FIXED = Array.isArray(INTERIOR?.fixed) ? INTERIOR.fixed : [];
const fixedOf = (def) => FIXED.find((f) => f.def === def) || null;
const sizeOf = (def) => CONTENT.furniture?.get?.(def)?.size || [1, 1];
/** Where the shell draws content's fixed pieces (metres), read from INTERIOR so the drawn room and the rules' grid can
 *  never drift apart: the hearth's and the dresser's centres on the back wall, the Memory Book wall's and the window's
 *  centres on the left wall, the door's centre on the back wall. */
export const LAYOUT = Object.freeze((() => {
  const c = (def, dflt) => { const f = fixedOf(def); if (!f) return dflt; const [w] = sizeOf(def); return (f.wall ? f.at : f.x) + w / 2; };
  const door = INTERIOR?.door ? INTERIOR.door.at + (INTERIOR.door.w || 2) / 2 : 9;
  return { fire: c('fireplace', 5), dresser: c('keepsake_shelf', 2), memory: c('memory_wall', 2.5), window: c('farmhouse_window', 5.5), door };
})());
/** Floor cells the shell's pieces and the rules' keep-clear rects take [x, z] (content INTERIOR.fixed + keepClear; the
 *  movable duet table is a rules item). */
export const BUILT_IN = Object.freeze((() => {
  const out = [];
  for (const f of FIXED) {
    if (f.wall || f.movable) continue;
    const [w, d] = sizeOf(f.def);
    for (let x = f.x; x < f.x + w; x++) for (let z = f.z; z < f.z + d; z++) out.push([x, z]);
  }
  for (const [x0, z0, w, d] of INTERIOR?.keepClear || []) for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) out.push([x, z]);
  if (!out.length) out.push([4, 0], [5, 0], [1, 0], [2, 0], [8, 0], [9, 0], [8, 1], [9, 1]);
  const seen = new Set();
  return out.filter(([x, z]) => { const k = `${x},${z}`; if (seen.has(k)) return false; seen.add(k); return true; }).map((c) => Object.freeze(c));
})());
/** Content's fixed pieces the shell draws itself (their rules items are not drawn again), and their click spot. */
export const BUILT_IN_DEFS = Object.freeze({ fireplace: 'fire', keepsake_shelf: null, memory_wall: 'memory_wall', farmhouse_window: 'window' });
/** The room's fixed places (metres): what a click on them means. */
export const SPOTS = Object.freeze({
  door: Object.freeze({ box: [LAYOUT.door - 0.7, 0, -0.1, LAYOUT.door + 0.7, 2.4, 0.4] }),
  fire: Object.freeze({ box: [LAYOUT.fire - 1.2, 0, -0.1, LAYOUT.fire + 1.2, 1.6, 0.8] }),
  memory_wall: Object.freeze({ box: [-0.1, 1.0, LAYOUT.memory - 1.4, 0.25, 2.8, LAYOUT.memory + 1.4] }),
  window: Object.freeze({ box: [-0.1, 0.9, LAYOUT.window - 1.2, 0.3, 2.6, LAYOUT.window + 1.2] }),
});
/** The keepsake dresser's box (a pick on it is its rules item). */
const DRESSER_BOX = Object.freeze([LAYOUT.dresser - 0.9, 0, 0, LAYOUT.dresser + 0.9, 2.4, 0.65]);

const W = ROOM.w; const D = ROOM.d; const H = ROOM.h;
const hash = (i, k) => {
  let h = Math.imul(i | 0, 2654435761) ^ Math.imul(k | 0, 1597334677);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Where a placed piece stands (metres, pure): a floor or object piece at its turned footprint's centre; a wall piece
 *  (`wall` 'back' | 'left' and slot `at`, `size[0]` slots wide) with its back on that wall, centred on its slots. A
 *  render-life wall model carries its own heights (`absolute`); our stand-ins hang from `wallY` (1.7 m). Floor-layer
 *  pieces (rugs) lift 4 mm off the boards. */
export function itemPlacement(o, def, absolute = false) {
  const [w, d] = Array.isArray(def?.size) ? def.size : [1, 1];
  const wall = o.wall === 'back' || o.wall === 'left' ? o.wall : def?.layer === 'wall' || def?.wall ? (o.wall || 'back') : null;
  if (wall) {
    const at = Number.isFinite(o.at) ? o.at : wall === 'left' ? (o.z ?? 0) : (o.x ?? 0);
    const y = absolute ? 0 : (Number.isFinite(def?.wallY) ? def.wallY : 1.7);
    return wall === 'left' ? { x: 0.06, z: at + w / 2, y, yaw: Math.PI / 2, wall } : { x: at + w / 2, z: 0.06, y, yaw: 0, wall };
  }
  const rot = ((o.rot || 0) % 4 + 4) % 4;
  const fw = rot % 2 ? d : w; const fd = rot % 2 ? w : d;
  return { x: o.x + fw / 2, z: o.z + fd / 2, y: def?.layer === 'floor' ? 0.004 : 0, yaw: rot * (Math.PI / 2), wall: null };
}

// ---------------------------------------------------------------------------------------------------
// The room's own build: floor, walls, the fireplace, the window, the door, the dresser, Grandma's duet table, the
// Memory Book wall's frames (their photos are a texture of their own), beams, sconces and a braided rug
function roomGeometry() {
  const parts = [];
  // the floor: oak boards running along x, staggered, on a dark slab whose cut edge shows (the dollhouse section)
  parts.push(box(W + 0.4, 0.3, D + 0.4, '#5A3A26', { x: W / 2 - 0.2, y: -0.36, z: D / 2 - 0.2 }));
  const woods = ['#B57B48', '#A86E3E', '#C08752', '#AD7442'];
  for (let r = 0; r < D / 0.24; r++) {
    let x = -hash(r, 1) * 1.6;
    for (let k = 0; x < W; k++) {
      const len = 1.4 + hash(r, k + 3) * 1.8;
      const x0 = Math.max(0, x); const x1 = Math.min(W, x + len);
      if (x1 - x0 > 0.05) parts.push(box(x1 - x0 - 0.02, 0.04, 0.23, woods[(r + k) % 4], { x: (x0 + x1) / 2, y: -0.04, z: r * 0.24 + 0.12 }));
      x += len;
    }
  }
  // the two back walls: a panelled wainscot, a dado rail, wallpaper in soft stripes, a crown moulding; their cut tops
  // and front edges in cream
  const paper = (n) => (n % 2 ? '#F1E3C8' : '#EAD6B4');
  for (let k = 0; k < W / 0.5; k++) parts.push(box(0.5, H - 1.05, 0.1, paper(k), { x: 0.25 + k * 0.5, y: 1.05, z: -0.05 }, { shade: false }));
  for (let k = 0; k < D / 0.5; k++) parts.push(box(0.1, H - 1.05, 0.5, paper(k + 1), { x: -0.05, y: 1.05, z: 0.25 + k * 0.5 }, { shade: false }));
  for (let k = 0; k < W / 0.6; k++) parts.push(box(0.56, 1.0, 0.08, k % 2 ? '#8A5A35' : '#94623B', { x: 0.3 + k * 0.6, y: 0, z: 0.0 }));
  for (let k = 0; k < D / 0.6; k++) parts.push(box(0.08, 1.0, 0.56, k % 2 ? '#94623B' : '#8A5A35', { x: 0.0, y: 0, z: 0.3 + k * 0.6 }));
  parts.push(box(W, 0.08, 0.14, '#6E4528', { x: W / 2, y: 1.0, z: 0.04 }), box(0.14, 0.08, D, '#6E4528', { x: 0.04, y: 1.0, z: D / 2 }));
  parts.push(box(W, 0.14, 0.16, '#F6EEDC', { x: W / 2, y: H - 0.14, z: 0.05 }), box(0.16, 0.14, D, '#F6EEDC', { x: 0.05, y: H - 0.14, z: D / 2 }));
  parts.push(box(W + 0.2, 0.06, 0.32, '#F6EEDC', { x: W / 2, y: H, z: -0.12 }), box(0.32, 0.06, D + 0.2, '#F6EEDC', { x: -0.12, y: H, z: D / 2 }));
  parts.push(box(0.32, H + 0.06, 0.32, '#E8DCC2', { x: -0.12, z: -0.12 }));
  // a low front kerb (the cut-away's floor edge) on the two open sides
  parts.push(box(W + 0.4, 0.12, 0.14, '#6E4528', { x: W / 2 - 0.2, y: 0, z: D + 0.13 }), box(0.14, 0.12, D + 0.4, '#6E4528', { x: W + 0.13, y: 0, z: D / 2 - 0.2 }));

  // the fireplace on the back wall: a stone breast, the dark firebox, logs on a grate, a mantel with candles and a clock
  const FX = LAYOUT.fire;
  const stones = ['#B8B0A2', '#A39A8A', '#C9C0AE', '#9A9184'];
  for (let y = 0, row = 0; y < H - 0.1; y += 0.32, row++) {
    for (let x = -1.2 + (row % 2) * 0.2; x < 1.2; x += 0.42) {
      const w = Math.min(0.4, 1.2 - x);
      if (w < 0.08) continue;
      if (y < 1.0 && Math.abs(x + w / 2) < 0.65) continue;            // the firebox opening
      parts.push(box(w - 0.03, 0.29, 0.62, stones[(row + Math.round(x * 7)) & 3], { x: FX + x + w / 2, y, z: 0.31 }));
    }
  }
  parts.push(box(1.3, 1.0, 0.5, '#2A1A12', { x: FX, y: 0, z: 0.26 }, { shade: false }));
  parts.push(box(1.7, 0.08, 0.7, '#9A9184', { x: FX, y: 0, z: 0.85 }), box(1.5, 0.05, 0.4, '#3C3A36', { x: FX, y: 0.05, z: 0.45 }));
  for (const [dx, rz] of [[-0.2, 0.2], [0.2, -0.25]]) parts.push(cyl(0.09, 0.09, 0.8, 7, '#6B4A30', { x: FX + dx, y: 0.14, z: 0.45, rz: Math.PI / 2, ry: rz }));
  parts.push(box(2.7, 0.14, 0.7, '#7A4B2C', { x: FX, y: 1.3, z: 0.4 }));
  parts.push(cyl(0.05, 0.06, 0.26, 7, '#F6F1E6', { x: FX - 1.0, y: 1.44, z: 0.45 }), cyl(0.05, 0.06, 0.2, 7, '#F6F1E6', { x: FX - 0.8, y: 1.44, z: 0.5 }));
  parts.push(box(0.36, 0.42, 0.18, '#7A4B2C', { x: FX + 0.9, y: 1.44, z: 0.45 }), cyl(0.13, 0.13, 0.02, 12, '#F6EEDC', { x: FX + 0.9, y: 1.68, z: 0.55, rx: Math.PI / 2 }, { shade: false }));
  parts.push(cyl(0.12, 0.08, 0.28, 8, '#57758A', { x: FX + 0.3, y: 1.44, z: 0.5 }), ball(0.09, '#FF9FB0', { x: FX + 0.3, y: 1.8, z: 0.5 }), ball(0.08, '#FFE27A', { x: FX + 0.4, y: 1.78, z: 0.45 }));
  // a painting over the mantel: the farm in a gilt frame (painted with vertex colours: sky, hills, a red barn)
  parts.push(box(1.5, 0.95, 0.06, '#C9A04A', { x: FX, y: 1.75, z: 0.64 }));
  parts.push(box(1.32, 0.42, 0.02, '#BFE3F2', { x: FX, y: 2.22, z: 0.68 }, { shade: false }), box(1.32, 0.38, 0.02, '#7CC243', { x: FX, y: 1.84, z: 0.68 }, { shade: false }));
  parts.push(box(0.36, 0.26, 0.02, '#C8473A', { x: FX + 0.2, y: 2.0, z: 0.69 }, { shade: false }), gable(0.42, 0.14, 0.02, '#7A4B3A', { x: FX + 0.2, y: 2.26, z: 0.69 }, { shade: false }));
  parts.push(ball(0.12, '#FFE27A', { x: FX - 0.45, y: 2.42, z: 0.68, sz: 0.1 }, { shade: false }));

  // the window on the left wall: frame, sill with a geranium, gingham curtains on a pole (the glass is its own mesh)
  const WZ = LAYOUT.window;                      // content INTERIOR.fixed: the Garden Window's slots
  parts.push(box(0.18, 0.12, 1.8, '#F6EEDC', { x: 0.05, y: 1.05, z: WZ }), box(0.3, 0.06, 1.9, '#F6EEDC', { x: 0.12, y: 1.12, z: WZ }));
  parts.push(box(0.16, 0.12, 1.8, '#F6EEDC', { x: 0.05, y: 2.55, z: WZ }));
  for (const dz of [-0.9, 0, 0.9]) parts.push(box(0.16, 1.5, 0.1, '#F6EEDC', { x: 0.05, y: 1.08, z: WZ + dz }));
  parts.push(box(0.14, 0.07, 1.8, '#F6EEDC', { x: 0.06, y: 1.8, z: WZ }));
  parts.push(cyl(0.12, 0.09, 0.2, 8, '#C8643A', { x: 0.2, y: 1.15, z: WZ - 0.45 }), ball(0.16, '#4E8A3A', { x: 0.2, y: 1.42, z: WZ - 0.45 }),
    ball(0.07, '#E2483A', { x: 0.25, y: 1.56, z: WZ - 0.4 }), ball(0.06, '#E2483A', { x: 0.17, y: 1.52, z: WZ - 0.55 }));
  parts.push(cyl(0.03, 0.03, 2.6, 6, '#6E4528', { x: 0.25, y: 2.75, z: WZ, rx: Math.PI / 2 }));
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) parts.push(box(0.08, 1.65, 0.16, k % 2 ? '#F4EADB' : '#C8473A', { x: 0.25, y: 1.08, z: WZ + side * (1.05 + k * 0.15) }));
  }
  // a window seat under it with two cushions
  parts.push(box(0.6, 0.45, 2.0, '#94623B', { x: 0.35, y: 0, z: WZ }), box(0.62, 0.12, 2.02, '#7A4B2C', { x: 0.36, y: 0.45, z: WZ }));
  parts.push(box(0.5, 0.14, 0.9, '#57758A', { x: 0.36, y: 0.57, z: WZ - 0.48 }), box(0.5, 0.14, 0.9, '#C99257', { x: 0.36, y: 0.57, z: WZ + 0.48 }));

  // the door on the back wall (the way out, slots 8-9) and its doormat
  const DX = LAYOUT.door;
  parts.push(box(1.12, 2.22, 0.1, '#F6EEDC', { x: DX, y: 0, z: 0.03 }), box(0.96, 2.1, 0.08, '#7A4B2C', { x: DX, y: 0, z: 0.09 }));
  for (const [dy, h] of [[0.15, 0.8], [1.1, 0.85]]) for (const dx of [-0.22, 0.22]) parts.push(box(0.36, h, 0.03, '#8E5A34', { x: DX + dx, y: dy, z: 0.14 }));
  parts.push(ball(0.05, '#E9B83F', { x: DX + 0.36, y: 1.05, z: 0.18 }));
  parts.push(box(1.1, 0.03, 0.62, '#9C6A3E', { x: DX, y: 0, z: 0.55 }, { shade: false }), box(0.9, 0.035, 0.44, '#C99257', { x: DX, y: 0, z: 0.55 }, { shade: false }));

  // Grandma's Keepsake Dresser on the back wall (content: fixed `keepsake_shelf`, floor cells 1-2): a cupboard base,
  // shelves of blue-and-white plates, jars of jam
  const RX = LAYOUT.dresser;
  parts.push(box(1.7, 0.95, 0.55, '#9C6A3E', { x: RX, y: 0, z: 0.3 }), box(1.78, 0.08, 0.6, '#7A4B2C', { x: RX, y: 0.95, z: 0.31 }));
  for (const dx of [-0.42, 0.42]) parts.push(box(0.7, 0.7, 0.03, '#8E5A34', { x: RX + dx, y: 0.12, z: 0.58 }), ball(0.035, '#E9B83F', { x: RX + dx * 0.25, y: 0.5, z: 0.61 }));
  // (its plate-rack hutch is a mesh of its own: dresserHutchGeometry)

  // the Memory Book wall: six frames of different sizes on the left wall (their photos are the photo mesh)
  for (const f of MEMORY_FRAMES) parts.push(box(0.05, f.h + 0.12, f.w + 0.12, f.gilt ? '#C9A04A' : '#7A4B2C', { x: 0.02, y: f.y - (f.h + 0.12) / 2, z: f.z }));
  parts.push(box(0.04, 0.26, 1.5, '#F4EADB', { x: 0.03, y: 3.0 - 0.13 - 0.12, z: LAYOUT.memory + 0.1 }, { shade: false }));
  // two brass sconces, one between the dresser and the hearth, one on the left wall by the door corner (their light is
  // a glow)
  for (const [x, z, ry] of SCONCES) parts.push(box(0.1, 0.3, 0.06, '#B98B4E', { x, y: 1.95, z, ry }), cone(0.13, 0.22, 7, '#F6E2B0', { x: x + (ry ? 0.13 : 0), y: 2.1, z: z + (ry ? 0 : 0.13), rx: Math.PI }));
  return merge(parts);
}
// the Memory Book wall (content: fixed `memory_wall` on left-wall slots 1-3, z 1..4): six frames of different sizes
const MEMORY_FRAMES = Object.freeze([[-0.9, 2.45, 0.62, 0.5, true], [-0.1, 2.6, 0.78, 0.62, false], [0.75, 2.45, 0.56, 0.5, true], [-0.8, 1.8, 0.5, 0.62, false],
  [0, 1.85, 0.7, 0.5, true], [0.85, 1.8, 0.6, 0.6, false]].map(([dz, y, w, h, gilt]) => Object.freeze({ z: LAYOUT.memory + dz, y, w, h, gilt })));
// [x, z, ry]: beside the hearth on the back wall, and on the left wall's free slot by the front corner
const JAMS = ['#B5543F', '#E9B83F', '#8E3B5E', '#E07A3A', '#B5543F'];
/** The dresser's hutch: a plate rack of blue-and-white plates and a shelf of jam jars, up to 2.4 m. */
export function dresserHutchGeometry() {
  const RX = LAYOUT.dresser;
  const parts = [box(1.7, 1.25, 0.08, '#94623B', { x: RX, y: 1.03, z: 0.08 })];
  for (const y of [1.45, 1.9]) parts.push(box(1.7, 0.05, 0.28, '#7A4B2C', { x: RX, y, z: 0.2 }));
  for (const sx of [-0.86, 0.86]) parts.push(box(0.06, 1.3, 0.3, '#7A4B2C', { x: RX + sx, y: 1.0, z: 0.2 }));
  parts.push(box(1.8, 0.08, 0.34, '#7A4B2C', { x: RX, y: 2.3, z: 0.2 }));
  for (let k = 0; k < 4; k++) parts.push(cyl(0.16, 0.16, 0.02, 12, k % 2 ? '#3E6FA8' : '#F4F1E8', { x: RX - 0.6 + k * 0.4, y: 1.66, z: 0.14, rx: Math.PI / 2 - 0.12 }, { shade: false }));
  for (let k = 0; k < 5; k++) parts.push(cyl(0.07, 0.07, 0.16, 8, JAMS[k], { x: RX - 0.65 + k * 0.32, y: 1.95, z: 0.22 }), cyl(0.075, 0.075, 0.04, 8, '#F4EADB', { x: RX - 0.65 + k * 0.32, y: 2.11, z: 0.22 }));
  return merge(parts);
}
/** The dresser as a low sideboard (a wall piece hangs above it): two plates propped on the top, three jars of jam. */
export function dresserTopGeometry() {
  const RX = LAYOUT.dresser;
  const parts = [];
  for (const [dx, c] of [[-0.55, '#3E6FA8'], [-0.18, '#F4F1E8']]) parts.push(cyl(0.16, 0.16, 0.02, 12, c, { x: RX + dx, y: 1.03 + 0.16, z: 0.12, rx: Math.PI / 2 - 0.2 }, { shade: false }));
  for (let k = 0; k < 3; k++) parts.push(cyl(0.07, 0.07, 0.16, 8, JAMS[k], { x: RX + 0.22 + k * 0.2, y: 1.03, z: 0.3 }), cyl(0.075, 0.075, 0.04, 8, '#F4EADB', { x: RX + 0.22 + k * 0.2, y: 1.19, z: 0.3 }));
  return merge(parts);
}
/** Does a wall piece on the back wall at slot `at`, `w` slots wide, hang where the dresser's hutch stands? */
export const overDresser = (at, w = 1) => Number.isFinite(at) && at < LAYOUT.dresser + 0.9 && at + w > LAYOUT.dresser - 0.9;

const SCONCES = Object.freeze([[LAYOUT.fire - 1.5, 0.03, 0], [0.03, ROOM.d - 0.5, Math.PI / 2]]);

/** Grandma's duet table (content: the fixed, movable `duet_table`, [3, 2] cells; render-life's `furniture:duet_table`
 *  replaces it): a round table with a cloth, a pie, a teapot and two cups, two chairs facing each other. Origin at
 *  the footprint centre. */
export function duetTableGeometry() {
  const parts = [cyl(0.12, 0.2, 0.72, 8, '#7A4B2C'), cyl(0.36, 0.42, 0.06, 10, '#6E4528')];
  parts.push(cyl(0.78, 0.78, 0.06, 18, '#9C6A3E', { y: 0.72 }), cyl(0.8, 0.86, 0.18, 18, '#F4EADB', { y: 0.62 }));
  for (let k = 0; k < 4; k++) parts.push(box(0.16, 0.02, 1.52, '#C8473A', { x: -0.6 + k * 0.4, y: 0.795 }, { shade: false }), box(1.52, 0.02, 0.16, '#C8473A', { y: 0.797, z: -0.6 + k * 0.4 }, { shade: false }));
  parts.push(cyl(0.24, 0.22, 0.08, 12, '#D9A15B', { x: -0.15, y: 0.81, z: 0.1 }), cyl(0.21, 0.21, 0.02, 12, '#8E3B5E', { x: -0.15, y: 0.89, z: 0.1 }));
  parts.push(ball(0.15, '#F4F1E8', { x: 0.3, y: 0.92, z: -0.25, sy: 0.85 }), cyl(0.03, 0.04, 0.16, 5, '#F4F1E8', { x: 0.47, y: 0.92, z: -0.25, rz: -0.9 }));
  for (const [dx, dz] of [[-0.4, -0.35], [0.45, 0.35]]) parts.push(cyl(0.05, 0.04, 0.08, 7, '#FFFFFF', { x: dx, y: 0.79, z: dz }));
  for (const side of [-1, 1]) {
    const cx = side * 1.05;
    parts.push(box(0.5, 0.06, 0.5, '#9C6A3E', { x: cx, y: 0.45 }));
    for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) parts.push(box(0.05, 0.45, 0.05, '#7A4B2C', { x: cx + lx, z: lz }));
    parts.push(box(0.06, 0.6, 0.46, '#7A4B2C', { x: cx + side * 0.24, y: 0.5 }), box(0.42, 0.06, 0.42, side > 0 ? '#57758A' : '#C99257', { x: cx, y: 0.51 }));
  }
  return merge(parts);
}

/** The Memory Book photos: a small painted atlas (six warm snapshots of the farm), mapped onto the frames. */
function photoTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 384; c.height = 256;
  const g = c.getContext('2d');
  const scenes = [['#BFE3F2', '#7CC243', 'barn'], ['#F6C99A', '#9DBF5A', 'sun'], ['#BFE3F2', '#E9B83F', 'wheat'], ['#2B3A6B', '#4C6A3A', 'night'],
    ['#CFE8FF', '#84B452', 'hearts'], ['#F0A48C', '#7CA048', 'tree']];
  scenes.forEach(([sky, field, kind], i) => {
    const x = (i % 3) * 128; const y = Math.floor(i / 3) * 128;
    g.fillStyle = sky; g.fillRect(x, y, 128, 128);
    g.fillStyle = field; g.beginPath(); g.moveTo(x, y + 80); g.quadraticCurveTo(x + 64, y + 58, x + 128, y + 78); g.lineTo(x + 128, y + 128); g.lineTo(x, y + 128); g.fill();
    if (kind === 'barn') { g.fillStyle = '#C8473A'; g.fillRect(x + 70, y + 54, 34, 28); g.fillStyle = '#7A4B3A'; g.beginPath(); g.moveTo(x + 66, y + 56); g.lineTo(x + 87, y + 38); g.lineTo(x + 108, y + 56); g.fill(); }
    if (kind === 'sun' || kind === 'tree') { g.fillStyle = '#FFE27A'; g.beginPath(); g.arc(x + 92, y + 40, 16, 0, 7); g.fill(); }
    if (kind === 'tree') { g.fillStyle = '#6B4A30'; g.fillRect(x + 36, y + 56, 8, 26); g.fillStyle = '#4C7A3A'; g.beginPath(); g.arc(x + 40, y + 50, 20, 0, 7); g.fill(); }
    if (kind === 'wheat') for (let k = 0; k < 12; k++) { g.fillStyle = '#C99A3E'; g.fillRect(x + 8 + k * 10, y + 70, 3, 30); }
    if (kind === 'night') { g.fillStyle = '#F6EEDC'; g.beginPath(); g.arc(x + 96, y + 34, 12, 0, 7); g.fill(); g.fillStyle = '#FFD18A'; g.fillRect(x + 40, y + 70, 10, 8); }
    if (kind === 'hearts') { g.fillStyle = '#FF5A7A'; for (const [hx, hy] of [[44, 42], [78, 50]]) { g.beginPath(); g.arc(x + hx - 6, y + hy, 7, 0, 7); g.arc(x + hx + 6, y + hy, 7, 0, 7); g.moveTo(x + hx - 13, y + hy + 2); g.lineTo(x + hx, y + hy + 16); g.lineTo(x + hx + 13, y + hy + 2); g.fill(); } }
    // two little farmers in the couple's colours
    g.fillStyle = '#2BB3A3'; g.fillRect(x + 20, y + 92, 9, 18); g.fillStyle = '#FF7A6B'; g.fillRect(x + 33, y + 92, 9, 18);
    g.fillStyle = '#FFCFA0'; g.beginPath(); g.arc(x + 24, y + 88, 6, 0, 7); g.arc(x + 38, y + 88, 6, 0, 7); g.fill();
    // a sepia warmth and a white border
    g.fillStyle = 'rgba(255, 220, 160, 0.16)'; g.fillRect(x, y, 128, 128);
    g.strokeStyle = '#F6EEDC'; g.lineWidth = 8; g.strokeRect(x + 4, y + 4, 120, 120);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function photoGeometry() {
  const pos = []; const uv = []; const idx = [];
  MEMORY_FRAMES.forEach((f, i) => {
    const u0 = (i % 3) / 3; const v0 = 1 - (Math.floor(i / 3) + 1) / 2;
    const b = pos.length / 3; const x = 0.055;
    pos.push(x, f.y - f.h, f.z + f.w / 2, x, f.y - f.h, f.z - f.w / 2, x, f.y, f.z - f.w / 2, x, f.y, f.z + f.w / 2);
    uv.push(u0 + 0.02, v0 + 0.02, u0 + 1 / 3 - 0.02, v0 + 0.02, u0 + 1 / 3 - 0.02, v0 + 0.5 - 0.02, u0 + 0.02, v0 + 0.5 - 0.02);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------------
// Furniture stand-ins by the def's name (render-life's models replace them when the manifest has the def)
const FABRIC = ['#B5543F', '#57758A', '#8E5A7E', '#5E8C45', '#C99257'];
function legs(parts, w, d, h, col, inset = 0.06) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.06, h, 0.06, col, { x: sx * (w / 2 - inset), z: sz * (d / 2 - inset) }));
  return parts;
}
const STAND = {
  armchair(c) { const p = [box(0.8, 0.42, 0.8, c), box(0.84, 0.16, 0.8, '#F4EADB', { y: 0.42 }), box(0.84, 0.62, 0.18, c, { y: 0.42, z: -0.33 })]; for (const sx of [-0.38, 0.38]) p.push(box(0.12, 0.28, 0.8, c, { x: sx, y: 0.42 })); return p; },
  sofa(c) { const p = [box(1.8, 0.4, 0.8, c), box(1.6, 0.16, 0.66, '#F4EADB', { y: 0.4, z: 0.04 }), box(1.8, 0.6, 0.18, c, { y: 0.4, z: -0.33 })]; for (const sx of [-0.84, 0.84]) p.push(box(0.14, 0.3, 0.8, c, { x: sx, y: 0.4 })); p.push(box(0.36, 0.3, 0.12, '#E9B83F', { x: -0.5, y: 0.56, z: -0.18, rx: -0.2 })); return p; },
  rocker(c) { const p = [box(0.56, 0.05, 0.56, '#9C6A3E', { y: 0.45 }), box(0.56, 0.06, 0.5, c, { y: 0.5 })]; for (const sx of [-0.25, 0.25]) { p.push(box(0.05, 0.08, 0.95, '#7A4B2C', { x: sx, y: 0.02, rx: 0 })); p.push(box(0.05, 0.45, 0.05, '#7A4B2C', { x: sx, y: 0.05, z: 0.2 }), box(0.05, 1.05, 0.05, '#7A4B2C', { x: sx, y: 0.05, z: -0.24 })); } for (let k = 0; k < 4; k++) p.push(box(0.04, 0.55, 0.04, '#9C6A3E', { x: -0.15 + k * 0.1, y: 0.52, z: -0.24 })); p.push(box(0.56, 0.08, 0.06, '#7A4B2C', { y: 1.08, z: -0.24 })); return p; },
  bed(c) { const p = [box(1.5, 0.3, 2.0, '#9C6A3E'), box(1.4, 0.2, 1.9, '#F4EADB', { y: 0.3 }), box(1.56, 0.9, 0.1, '#7A4B2C', { z: -0.98 }), box(1.56, 0.5, 0.08, '#7A4B2C', { z: 0.98 })]; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) p.push(box(0.36, 0.06, 0.35, [c, '#F4EADB', '#E9B83F', '#57758A'][(i + j) % 4], { x: -0.54 + i * 0.36, y: 0.5, z: -0.1 + j * 0.34 }, { shade: false })); p.push(box(0.55, 0.14, 0.32, '#FFFFFF', { x: -0.33, y: 0.52, z: -0.72 }), box(0.55, 0.14, 0.32, '#FFFFFF', { x: 0.33, y: 0.52, z: -0.72 })); return p; },
  table(c) { const p = [box(1.2, 0.06, 0.8, '#9C6A3E', { y: 0.72 })]; legs(p, 1.2, 0.8, 0.72, '#7A4B2C'); p.push(cyl(0.08, 0.06, 0.18, 8, c, { y: 0.78 }), ball(0.1, '#FF9FB0', { y: 1.0 })); return p; },
  side(c) { const p = [cyl(0.3, 0.3, 0.05, 12, '#9C6A3E', { y: 0.6 }), cyl(0.05, 0.08, 0.6, 7, '#7A4B2C')]; p.push(cyl(0.06, 0.08, 0.1, 8, c, { y: 0.65 }), cone(0.16, 0.2, 10, '#F6E2B0', { y: 0.85 })); return p; },
  shelf(c) { const p = [box(1.2, 1.9, 0.08, '#7A4B2C', { z: -0.16 })]; for (const sx of [-0.58, 0.58]) p.push(box(0.06, 1.9, 0.4, '#8E5A34', { x: sx })); for (const y of [0.05, 0.5, 0.95, 1.4, 1.85]) p.push(box(1.2, 0.05, 0.4, '#8E5A34', { y })); for (let r = 0; r < 4; r++) for (let k = 0; k < 7; k++) p.push(box(0.1 + hash(r, k) * 0.06, 0.28 + hash(k, r) * 0.1, 0.26, [c, '#57758A', '#E9B83F', '#5E8C45', '#F4EADB', '#8E3B5E'][(r + k) % 6], { x: -0.48 + k * 0.155, y: 0.1 + r * 0.45 })); return p; },
  lamp(c) { return [cyl(0.18, 0.2, 0.05, 10, '#5E4A3A'), cyl(0.025, 0.025, 1.45, 6, '#B98B4E'), cone(0.28, 0.34, 10, c, { y: 1.35 }), cyl(0.08, 0.08, 0.04, 8, '#FFE6A8', { y: 1.38 }, { shade: false })]; },
  rug(c) { return ['#F4EADB', c, '#E9B83F', '#F4EADB'].map((col, i) => box(1.9 - i * 0.3, 0.012 + i * 0.002, 1.3 - i * 0.24, col, {}, { shade: false })); },
  plant() { return [cyl(0.2, 0.15, 0.36, 9, '#C8643A'), ball(0.3, '#4E8A3A', { y: 0.62, sy: 1.2 }), ball(0.22, '#5E9A45', { x: 0.15, y: 0.85 }), ball(0.2, '#467A35', { x: -0.14, y: 0.8, z: 0.1 })]; },
  clock() { return [box(0.5, 1.95, 0.32, '#7A4B2C'), box(0.56, 0.1, 0.36, '#6E4528', { y: 1.95 }), cyl(0.18, 0.18, 0.03, 14, '#F6EEDC', { y: 1.6, z: 0.16, rx: Math.PI / 2 }, { shade: false }), box(0.3, 0.6, 0.02, '#C9A04A', { y: 0.55, z: 0.165 }), cyl(0.07, 0.07, 0.02, 10, '#E9B83F', { y: 0.7, z: 0.18, rx: Math.PI / 2 })]; },
  piano(c) { return [box(1.5, 1.2, 0.55, '#3C2A20'), box(1.5, 0.06, 0.3, '#3C2A20', { y: 0.7, z: 0.38 }), box(1.36, 0.05, 0.16, '#F6F1E6', { y: 0.76, z: 0.42 }, { shade: false }), box(0.4, 0.08, 0.06, c, { y: 1.22 }), box(0.7, 0.45, 0.35, '#3C2A20', { y: 0, z: 0.85 })]; },
  cabinet(c) { const p = [box(1.0, 0.85, 0.5, '#9C6A3E'), box(1.06, 0.06, 0.54, '#7A4B2C', { y: 0.85 })]; for (const dx of [-0.24, 0.24]) p.push(box(0.44, 0.7, 0.03, '#8E5A34', { x: dx, y: 0.08, z: 0.26 })); p.push(cyl(0.1, 0.12, 0.25, 8, c, { y: 0.91 })); return p; },
  chest(c) { return [box(1.0, 0.5, 0.55, '#8E5A34'), box(1.04, 0.14, 0.58, c, { y: 0.5 }), box(0.14, 0.12, 0.04, '#E9B83F', { y: 0.42, z: 0.29 })]; },
  wheel(c) { return [box(0.9, 0.08, 0.3, '#9C6A3E', { y: 0.35 }), cyl(0.38, 0.38, 0.05, 16, '#8E5A34', { x: 0.2, y: 0.82, rz: Math.PI / 2 }), ...legs([], 0.8, 0.3, 0.35, '#7A4B2C'), cyl(0.09, 0.09, 0.12, 8, c, { x: -0.3, y: 0.55 })]; },
  horse(c) { return [box(0.9, 0.08, 0.2, '#7A4B2C', { y: 0.04, rz: 0 }), box(0.6, 0.3, 0.2, c, { y: 0.45 }), box(0.18, 0.45, 0.16, c, { x: 0.32, y: 0.62, rz: -0.4 }), box(0.28, 0.16, 0.16, c, { x: 0.46, y: 0.95 }), box(0.08, 0.4, 0.08, '#F4EADB', { x: -0.33, y: 0.4, rz: 0.6 })]; },
  frame(c) { return [box(0.07, 0.6, 0.8, '#C9A04A', { y: -0.3 }), box(0.02, 0.48, 0.68, c, { x: 0.04, y: -0.24 }, { shade: false })]; },
  basket(c) { return [cyl(0.28, 0.22, 0.3, 10, '#B98B4E'), cyl(0.2, 0.2, 0.06, 10, c, { y: 0.28 })]; },
  stool(c) { return [cyl(0.22, 0.22, 0.06, 10, c, { y: 0.45 }), ...legs([], 0.3, 0.3, 0.45, '#7A4B2C', 0.02)]; },
  crate(c) { return [box(0.8, 0.6, 0.6, '#B9814A'), box(0.82, 0.08, 0.62, c, { y: 0.5 })]; },
};
const STAND_WORDS = [['rocker', 'rocker'], ['rocking', 'rocker'], ['armchair', 'armchair'], ['chair', 'armchair'], ['sofa', 'sofa'], ['settee', 'sofa'], ['couch', 'sofa'],
  ['bed', 'bed'], ['quilt', 'bed'], ['side', 'side'], ['table', 'table'], ['desk', 'table'], ['shelf', 'shelf'], ['book', 'shelf'], ['lamp', 'lamp'], ['light', 'lamp'],
  ['rug', 'rug'], ['carpet', 'rug'], ['plant', 'plant'], ['fern', 'plant'], ['pot', 'plant'], ['clock', 'clock'], ['piano', 'piano'], ['cabinet', 'cabinet'],
  ['dresser', 'cabinet'], ['cupboard', 'cabinet'], ['chest', 'chest'], ['trunk', 'chest'], ['spinning', 'wheel'], ['wheel', 'wheel'], ['horse', 'horse'],
  ['frame', 'frame'], ['painting', 'frame'], ['portrait', 'frame'], ['picture', 'frame'], ['basket', 'basket'], ['stool', 'stool']];
/** The stand-in shape for a furniture id (by its words; a crate when nothing matches). Pure. */
export function standKind(id) {
  const s = String(id).toLowerCase();
  for (const [w, k] of STAND_WORDS) if (s.includes(w)) return k;
  return 'crate';
}
const standGeo = new Map();
function standInFor(id) {
  if (!standGeo.has(id)) {
    const c = FABRIC[hashStr(id) % FABRIC.length];
    // a wall piece is always a framed hanging (it hangs from wallY), a rug always lies flat
    const layer = CONTENT.furniture?.get?.(id)?.layer;
    standGeo.set(id, merge(STAND[layer === 'wall' ? 'frame' : layer === 'floor' ? 'rug' : standKind(id)](c)));
  }
  return standGeo.get(id);
}
/** The model key of a furniture def: its manifest key, `furniture:<id>`, else our stand-in under `hh-furn:<id>`. */
function keyOfFurniture(batch, id) {
  const mk = models.keyOf(id);
  if (mk && models.has(mk)) return mk;
  if (models.has(`furniture:${id}`)) return `furniture:${id}`;
  const k = `hh-furn:${id}`;
  batch.define(k, standInFor(id));
  return k;
}

// ---------------------------------------------------------------------------------------------------
/** A posed farmer (or Grandma) for the room or the porch: render-life's rig in a colour, the farm's chibi cut, the
 *  Idle clip playing. Returns at once ({ root, mixer: null, ready: false }); the rig arrives when its model loads.
 *  Grandma: silver hair in a bun, spectacles and a lavender shawl, 0.9 of the farmers' size. */
export function makeFigure(body, color, { scale = 1, grandma = false, onReady = null } = {}) {
  const rec = { root: new THREE.Group(), mixer: null, ready: false, clips: null };
  const mk = `avatar:${body}`;
  if (!models.has(mk)) return rec;
  models.ready([mk]).then(() => {
    const info = models.info(mk);
    const c = models.clone(mk, { tint: info && info.tint ? { [info.tint]: color } : undefined });
    if (!c) return;
    const bones = {};
    c.object.traverse((o) => { if (o.isBone) bones[o.name] = o; if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    c.object.updateMatrixWorld(true);
    const footY = () => Math.min(...['FootL', 'FootR'].map((n) => (bones[n] ? bones[n].getWorldPosition(new THREE.Vector3()).y : 0)));
    const f0 = footY();
    for (const [name, k] of Object.entries(CHIBI)) { const b = bones[name]; if (b) { if (Array.isArray(k)) b.scale.multiply(new THREE.Vector3(...k)); else b.scale.multiplyScalar(k); } }
    c.object.updateMatrixWorld(true);
    c.object.position.y = -(footY() - f0);
    if (grandma && bones.Head) {
      // Grandma: a silver cap of hair over the farmer's own with a bun at the back, round spectacles and a lavender
      // shawl round the shoulders. Built in the figure's own frame (y up, face +z, metres) at the head and the chest,
      // then parented to their bones through the bones' inverse world matrices (any local axes, the chibi scale).
      c.object.updateMatrixWorld(true);
      let skin = null; c.object.traverse((o) => { if (!skin && o.isSkinnedMesh) skin = o; });
      const hp = bones.Head.getWorldPosition(new THREE.Vector3());
      let top = hp.y + 0.45;
      if (skin && skin.computeBoundingBox) { skin.computeBoundingBox(); top = skin.boundingBox.clone().applyMatrix4(skin.matrixWorld).max.y; }
      const span = Math.max(0.2, top - hp.y);
      const r = span * 0.54;
      const attach = (bone, geo, at) => {
        const mesh = new THREE.Mesh(geo, models.createMaterial());
        mesh.castShadow = true;
        mesh.applyMatrix4(new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(new THREE.Matrix4().makeTranslation(at.x, at.y, at.z)));
        bone.add(mesh);
      };
      attach(bones.Head, merge([
        ball(r, '#E6E2DA', { y: span * 0.6, z: -r * 0.15, sx: 1.08, sy: 0.8, sz: 1.1 }),
        ball(r * 0.42, '#DAD5CC', { y: span * 0.9, z: -r * 0.72 }),
        geoPart(new THREE.TorusGeometry(span * 0.11, span * 0.02, 4, 10), '#3C3A36', { x: -span * 0.17, y: span * 0.36, z: span * 0.58 }),
        geoPart(new THREE.TorusGeometry(span * 0.11, span * 0.02, 4, 10), '#3C3A36', { x: span * 0.17, y: span * 0.36, z: span * 0.58 }),
      ]), hp);
      const chest = bones.Spine2 || bones.Chest || bones.Spine1 || bones.Spine;
      if (chest) {
        const cp = chest.getWorldPosition(new THREE.Vector3());
        const sh = Math.max(0.15, (hp.y - cp.y) * 0.9);
        attach(chest, merge([cone(sh * 1.15, sh * 1.1, 12, '#A88BC9', { y: -sh * 0.45 })]), cp);
      }
    }
    rec.root.add(c.object);
    rec.root.scale.setScalar(grandma ? 0.9 * scale : scale);
    rec.mixer = new THREE.AnimationMixer(c.object);
    const idle = c.clips.get('Idle') || c.clips.get('IdleNeutral');
    if (idle) rec.mixer.clipAction(idle).play();
    rec.clips = c.clips;
    rec.ready = true;
    if (onReady) onReady(rec);
  }).catch(() => {});
  return rec;
}

export function createInterior({ renderer = null } = {}) {
  const scene = new THREE.Scene();
  scene.name = 'interior';
  scene.background = new THREE.Color('#2B2019');
  const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.3, 80);
  const target = new THREE.Vector3(W / 2 - 0.4, 0.95, D / 2 - 0.4);
  const goalT = target.clone();
  // zoomK: the player's zoom over the framing that fits the whole room (1); the room's camera never pans (the client's
  // rule), so every turn re-fits the room to the screen and keeps the zoom
  const cam = { yaw: Math.PI / 4, goalYaw: Math.PI / 4, dist: 14.5, goalDist: 14.5, pitch: 0.62, aspect: 16 / 9, zoomK: 1 };
  const LIM = { yaw: [0.42, 1.15], dist: [8, 48], zoomK: 1.12 };

  // light: warm sky and wood-brown bounce, the window's daylight (one static shadow map), the fire, the lamps
  const hemi = new THREE.HemisphereLight('#FFE9CC', '#5A3F2A', 1.15);
  const sun = new THREE.DirectionalLight('#FFF1D6', 1.9);
  sun.position.set(-7, 8, 7.5);
  sun.target.position.set(4.5, 0, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.intensity = 0.55;
  const fireLight = new THREE.PointLight('#FF9A4A', 9, 9, 1.6);
  fireLight.position.set(LAYOUT.fire, 0.7, 1.1);
  scene.add(hemi, sun, sun.target, fireLight);

  const mat = models.createMaterial();
  const room = new THREE.Mesh(roomGeometry(), mat);
  room.castShadow = true;
  room.receiveShadow = true;
  room.name = 'room';
  scene.add(room);
  // the dresser's hutch stands unless a wall piece hangs on the back wall above it (then it is a low sideboard)
  const hutch = new THREE.Mesh(dresserHutchGeometry(), mat);
  hutch.castShadow = true; hutch.receiveShadow = true;
  const sideboard = new THREE.Mesh(dresserTopGeometry(), mat);
  sideboard.castShadow = true; sideboard.receiveShadow = true; sideboard.visible = false;
  scene.add(hutch, sideboard);
  let hungOver = false;            // a rules wall piece above the dresser
  let ghostOver = false;           // the ghost of one being placed there
  function setHutch() {
    const low = hungOver || ghostOver;
    for (const r of items.values()) if (r.dresser) r.box.max.y = low ? 1.3 : DRESSER_BOX[4];
    if (hutch.visible === !low) return;
    hutch.visible = !low; sideboard.visible = low;
    shadowDirty = true;
  }
  // the window glass shows the farm's sky (day blue, dusk rose, a moonlit night)
  const glassMat = new THREE.MeshBasicMaterial({ color: '#CFE8FF', toneMapped: false });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.42), glassMat);
  glass.rotation.y = Math.PI / 2;
  glass.position.set(0.02, 1.8, LAYOUT.window);
  scene.add(glass);
  // the Memory Book photos
  const photoMap = photoTexture();
  if (photoMap) {
    const photos = new THREE.Mesh(photoGeometry(), models.createMaterial({ vertexColors: false, map: photoMap }));
    photos.receiveShadow = true;
    scene.add(photos);
  }
  // the fire: three tongues of flame that flicker, and a soft glow
  const flameMat = new THREE.MeshBasicMaterial({ color: '#FFB347', transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false });
  const flames = new THREE.Group();
  for (const [dx, s, c] of [[-0.2, 0.9, '#FF8A3A'], [0.05, 1.15, '#FFB347'], [0.25, 0.8, '#FFD27A']]) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.16 * s, 0.6 * s, 7), flameMat.clone());
    m.material.color.set(c);
    m.position.set(LAYOUT.fire + dx, 0.32 + 0.3 * s, 0.45);
    m.userData.base = m.position.y;
    flames.add(m);
  }
  scene.add(flames);
  const glowTex = (() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glows = [];
  const glow = (x, y, z, size, color, k = 1) => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    m.position.set(x, y, z); m.scale.setScalar(size); m.userData.k = k;
    scene.add(m); glows.push(m);
    return m;
  };
  const fireGlow = glow(LAYOUT.fire, 0.55, 0.7, 2.2, '#FF9A4A', 1);
  for (const [x, z, ry] of SCONCES) glow(x + (ry ? 0.25 : 0), 2.0, z + (ry ? 0 : 0.25), 0.9, '#FFD18A', 0);
  // the furniture and its ghost
  const furniture = createBatch({ name: 'furniture', material: models.createMaterial(), instances: 64, vertices: 1 << 15, castShadow: true, receiveShadow: true });
  scene.add(furniture.mesh);
  const ghostMat = models.createMaterial({ transparent: true, opacity: 0.55, depthWrite: false, color: 0xbfe8c8 });
  const ghostMesh = new THREE.Mesh(new THREE.BufferGeometry(), ghostMat);
  ghostMesh.visible = false;
  ghostMesh.renderOrder = 5;
  scene.add(ghostMesh);
  const cellMark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#58D66A', transparent: true, opacity: 0.35, depthWrite: false }));
  cellMark.visible = false;
  scene.add(cellMark);

  // the people in the room: the farmers by the fire, Grandma at her table while she visits
  const figures = new Map();        // key -> { root, mixer, pid }
  let present = null;               // pids inside (null = only me)
  let state = null;
  let me = null;
  let items = new Map();            // id -> { h, box, def }
  let lastKey = '';
  let shadowDirty = true;
  let clock = 0;
  let visit = { phase: 'none' };
  const mx = new THREE.Matrix4(); const q = new THREE.Quaternion(); const v = new THREE.Vector3(); const sc = new THREE.Vector3(1, 1, 1);
  const Y = new THREE.Vector3(0, 1, 0);

  function placeCamera() {
    const cp = Math.cos(cam.pitch);
    camera.position.set(target.x + Math.sin(cam.yaw) * cam.dist * cp, target.y + Math.sin(cam.pitch) * cam.dist, target.z + Math.cos(cam.yaw) * cam.dist * cp);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }
  placeCamera();

  // the corners of the floor and the tops of the two standing walls: what "the whole room" means on screen
  const FIT_PTS = [[0, 0, 0], [W, 0, 0], [0, 0, D], [W, 0, D], [0, H + 0.1, 0], [W, H + 0.1, 0], [0, H + 0.1, D]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const fits = new Map();
  const pv = new THREE.Vector3(); const right = new THREE.Vector3(); const up = new THREE.Vector3();
  /** The nearest camera distance (and target) at `yaw` that shows the whole room, its projection centred on screen. */
  function fitFor(yaw) {
    const key = `${yaw.toFixed(3)}|${cam.aspect.toFixed(3)}|${cam.pitch}`;
    if (fits.has(key)) return fits.get(key);
    const keep = { yaw: cam.yaw, dist: cam.dist, t: target.clone() };
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let out = null;
    cam.yaw = yaw;
    for (let d = 9; d <= LIM.dist[1] && !out; d += 0.25) {
      cam.dist = d;
      target.set(W / 2, 1.0, D / 2);
      let b = null;
      for (let it = 0; it < 4; it++) {
        placeCamera();
        b = [Infinity, -Infinity, Infinity, -Infinity];
        for (const p of FIT_PTS) {
          pv.copy(p).project(camera);
          b[0] = Math.min(b[0], pv.x); b[1] = Math.max(b[1], pv.x); b[2] = Math.min(b[2], pv.y); b[3] = Math.max(b[3], pv.y);
        }
        // centre the projection: move the target along the screen's right and up by the offset, in metres at the target
        right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
        const cx = (b[0] + b[1]) / 2; const cy = (b[2] + b[3]) / 2;
        target.addScaledVector(right, cx * d * half * cam.aspect).addScaledVector(up, cy * d * half);
      }
      placeCamera();
      if (b[1] - b[0] <= 2 * 0.92 && b[3] - b[2] <= 2 * 0.9) out = { d, t: target.clone() };
    }
    if (!out) out = { d: LIM.dist[1], t: target.clone() };
    cam.yaw = keep.yaw; cam.dist = keep.dist; target.copy(keep.t);
    placeCamera();
    fits.set(key, out);
    return out;
  }
  /** Aim the camera's goals at the framing for its goal yaw and the player's zoom (`snap`: go there now). */
  function setGoals(snap = false) {
    const f = fitFor(cam.goalYaw);
    cam.goalDist = Math.max(LIM.dist[0], f.d * cam.zoomK);
    goalT.copy(f.t);
    if (snap) { cam.yaw = cam.goalYaw; cam.dist = cam.goalDist; target.copy(goalT); placeCamera(); }
  }

  function figure(key, body, color, opts = {}) {
    if (figures.has(key)) return figures.get(key);
    const rec = makeFigure(body, color, { ...opts, onReady: () => { shadowDirty = true; } });
    rec.root.name = `figure-${key}`;
    scene.add(rec.root);
    figures.set(key, rec);
    return rec;
  }
  function wave(rec) {
    if (!rec || !rec.ready || !rec.clips?.get('Wave')) return;
    const a = rec.mixer.clipAction(rec.clips.get('Wave'));
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.fadeIn(0.2); a.play();
    setTimeout(() => a.fadeOut(0.3), 1600);
  }

  const bodyFor = (pid, p) => { const b = p?.avatar?.body; return b === 'farmer_a' || b === 'farmer_b' ? b : pid === 'p2' ? 'farmer_b' : 'farmer_a'; };
  // where people like to stand (metres, yaw toward the room's front): by the fire first; a spot whose cell holds
  // furniture or the room's own pieces is skipped
  const STANDS = [[6.5, 2.5, 0.6], [3.5, 2.5, -0.2], [7.5, 3.5, 0.9], [4.5, 3.5, 0.3], [6.5, 6.5, 0.7], [8.5, 6.5, 0.9], [5.5, 6.5, 0.2], [7.5, 1.5, 0.8]];
  function freeStands() {
    const taken = new Set(BUILT_IN.map(([x, z]) => `${x},${z}`));
    for (const r of items.values()) {
      const b = r.box;
      for (let x = Math.floor(b.min.x); x < Math.ceil(b.max.x); x++) for (let z = Math.floor(b.min.z); z < Math.ceil(b.max.z); z++) taken.add(`${x},${z}`);
    }
    return STANDS.filter(([x, z]) => !taken.has(`${Math.floor(x)},${Math.floor(z)}`));
  }
  function refreshFigures() {
    const pl = state?.players || {};
    const inside = (present || (me ? [me] : [])).filter((p) => pl[p]);
    const want = new Set(inside.map((p) => `p:${p}`));
    if (visit.phase !== 'none') want.add('grandma');
    for (const [k, rec] of figures) if (!want.has(k)) { rec.root.visible = false; }
    const free = freeStands();
    inside.forEach((pid, i) => {
      const rec = figure(`p:${pid}`, bodyFor(pid, pl[pid]), pl[pid].color || (pid === 'p2' ? '#FF7A6B' : '#2BB3A3'));
      rec.root.visible = true;
      const [x, z, yaw] = free[i] || STANDS[i % STANDS.length];
      rec.root.position.set(x, 0, z);
      rec.root.rotation.y = yaw;
    });
    if (want.has('grandma')) {
      const g = figure('grandma', 'farmer_b', '#8E7AB8', { grandma: true });
      // beside her duet table (wherever the couple moved it), turned toward the room and the fire
      const t = duetAt || { x: 2.5, z: 6 };
      const gx = Math.min(W - 0.6, t.x + 1.9); const gz = Math.max(1.2, t.z - 0.7);
      g.root.position.set(gx, 0, gz);
      g.root.rotation.y = 0.35;
      grandmaBox.set(new THREE.Vector3(gx - 0.45, 0, gz - 0.45), new THREE.Vector3(gx + 0.45, 1.8, gz + 0.45));
      g.root.visible = grandmaInside;
    }
    shadowDirty = true;
  }

  let duetAt = null;                // where Grandma's duet table stands (metres)
  let duetKey = null;
  const spotItem = new Map();       // spot id -> the rules id of the fixed piece the shell draws there
  function rebuildItems() {
    const view = interiorView(state);
    const key = JSON.stringify(view.items);
    if (key === lastKey) return;
    lastKey = key;
    for (const r of items.values()) if (r.h !== null) furniture.remove(r.h);
    items = new Map();
    spotItem.clear();
    duetAt = null;
    for (const o of view.items) {
      const def = furnitureDef(o.def);
      if (Object.hasOwn(BUILT_IN_DEFS, o.def)) {
        // the shell draws it; a click on it is its spot (or, the dresser, its item)
        const spot = BUILT_IN_DEFS[o.def];
        if (spot) spotItem.set(spot, o.id);
        else items.set(o.id, { h: null, def: o.def, dresser: true, box: new THREE.Box3(new THREE.Vector3(...DRESSER_BOX.slice(0, 3)), new THREE.Vector3(...DRESSER_BOX.slice(3))) });
        continue;
      }
      let k;
      let bounds;
      if (o.def === 'duet_table' && !models.has('furniture:duet_table') && !models.has(models.keyOf('duet_table') || '')) {
        if (!duetKey) { duetKey = 'hh-duet-table'; furniture.define(duetKey, duetTableGeometry()); }
        k = duetKey;
        bounds = duetTableGeometry.cached || (duetTableGeometry.cached = duetTableGeometry().boundingBox);
      } else {
        k = keyOfFurniture(furniture, o.def);
        bounds = k.startsWith('hh-furn:') ? standInFor(o.def).boundingBox : models.boundsOf(k);
      }
      const p = itemPlacement(o, def, !k.startsWith('hh-'));
      q.setFromAxisAngle(Y, p.yaw);
      mx.compose(v.set(p.x, p.y, p.z), q, sc);
      const h = furniture.add(k, mx);
      items.set(o.id, { h, box: bounds.clone().applyMatrix4(mx), def: o.def, wall: p.wall });
      if (o.def === 'duet_table') duetAt = p;
    }
    hungOver = view.items.some((o) => o.wall === 'back' && overDresser(o.at, Array.isArray(furnitureDef(o.def)?.size) ? furnitureDef(o.def).size[0] : 1));
    setHutch();
    shadowDirty = true;
  }

  const ray = new THREE.Raycaster();
  const spotBoxes = Object.entries(SPOTS).map(([id, s]) => [id, new THREE.Box3(new THREE.Vector3(s.box[0], s.box[1], s.box[2]), new THREE.Vector3(s.box[3], s.box[4], s.box[5]))]);
  const grandmaBox = new THREE.Box3(new THREE.Vector3(3.5, 0, 4.3), new THREE.Vector3(4.4, 1.8, 5.2));
  let grandmaInside = false;        // she is in the parlour (her stroll's stop) or it is night
  let lastGhost = null;             // the ghost call waiting for its model
  let visitAt = 0;
  const hit = new THREE.Vector3();

  return {
    scene, camera,
    get target() { return target; },
    setState(s, { me: m, now = Date.now() } = {}) {
      state = s;
      if (m) me = m;
      visit = grandmaVisit(s, now);
      rebuildItems();
      refreshFigures();
    },
    sync(ids, topics, s, now = Date.now()) {
      state = s;
      if (topics.has('*') || topics.has('interior') || topics.has('house') || topics.has('restore') || topics.has('objects') || topics.has('quests')) {
        visit = grandmaVisit(s, now);
        rebuildItems();
      }
      if (topics.has('*') || topics.has('players') || topics.has('quests')) refreshFigures();
    },
    setPresent(pids) { present = Array.isArray(pids) ? pids.slice(0, 4) : null; if (state) refreshFigures(); },
    /** A new arrival: the farmers wave hello. */
    greet() { for (const [k, rec] of figures) if (k.startsWith('p:') && rec.root.visible) wave(rec); },
    update(dt, now, sky = null, { motion = 'full' } = {}) {
      // 'still' (GDD §7.5): no flicker, no breathing; the room is drawn once and rests
      if (motion === 'still') dt = 0;
      clock += dt;
      let want = motion === 'still' ? 0 : 1;          // the fire and the breathing farmers: ambient
      const night = sky ? sky.night || 0 : 0;
      // the camera eases to its goal (in 'still' it goes there at once)
      const dy = cam.goalYaw - cam.yaw; const dd = cam.goalDist - cam.dist; const dt2 = goalT.distanceToSquared(target);
      if (Math.abs(dy) > 1e-4 || Math.abs(dd) > 1e-3 || dt2 > 1e-6) {
        const k = motion === 'still' ? 1 : Math.min(1, dt * 8);
        cam.yaw += dy * k; cam.dist += dd * k; target.lerp(goalT, k); placeCamera(); want = Math.max(want, 2);
      }
      // the fire flickers; the lamps and the fire carry the room at night
      const fl = 0.86 + 0.08 * Math.sin(clock * 9.1) + 0.06 * Math.sin(clock * 23.7 + 1.3);
      flames.children.forEach((m, i) => { m.scale.set(1, fl + 0.08 * Math.sin(clock * (7 + i * 3) + i), 1); m.position.y = m.userData.base + 0.02 * Math.sin(clock * 11 + i); });
      fireLight.intensity = (7 + 5 * night) * fl;
      fireGlow.material.opacity = 0.55 + 0.25 * fl;
      for (const g of glows) if (g.userData.k === 0) g.material.opacity = 0.15 + 0.75 * night;
      hemi.intensity = 1.15 - 0.55 * night;
      hemi.color.set('#FFE9CC').lerp(new THREE.Color('#8A93BD'), night * 0.6);
      sun.intensity = 1.9 * (1 - night) + 0.35 * night;
      sun.color.set(night > 0.5 ? '#9FB0E0' : '#FFF1D6');
      if (sky && sky.horizon) glassMat.color.setRGB(...sky.horizon).lerp(new THREE.Color(sky.top ? new THREE.Color(...sky.top) : '#4FA8EE'), 0.35);
      // Grandma's stroll moves by the clock (one stop an hour): she is in here in the parlour hour, and every night
      if (state && Math.abs(now - visitAt) > 5000) {
        visitAt = now;
        const was = visit.phase;
        visit = grandmaVisit(state, now);
        if (visit.phase !== was) refreshFigures();
      }
      const inNow = visit.phase !== 'none' && (visit.stop === 'parlour' || night > 0.5);
      if (inNow !== grandmaInside) { grandmaInside = inNow; const g = figures.get('grandma'); if (g) { g.root.visible = inNow; shadowDirty = true; } }
      for (const rec of figures.values()) if (rec.mixer && rec.root.visible) rec.mixer.update(dt);
      if (shadowDirty && renderer) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
      void now;
      return want;
    },
    pick(ndc) {
      if (!ndc) return null;
      ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
      let best = null;
      const consider = (b, out) => { if (ray.ray.intersectBox(b, hit)) { const d = hit.distanceTo(ray.ray.origin); if (!best || d < best.d) best = { d, out }; } };
      for (const [id, r] of items) consider(r.box, { kind: 'item', id, def: r.def });
      for (const [id, b] of spotBoxes) consider(b, spotItem.has(id) ? { kind: 'spot', id, item: spotItem.get(id) } : { kind: 'spot', id });
      if (visit.phase !== 'none' && grandmaInside) consider(grandmaBox, { kind: 'spot', id: 'grandma' });
      // the two back walls: a wall slot for a wall piece (back: slot = floor x, left: slot = floor z)
      const o = ray.ray.origin; const dr = ray.ray.direction;
      if (dr.z < 0) {
        const t = (0.05 - o.z) / dr.z; const x = o.x + dr.x * t; const y = o.y + dr.y * t;
        if (t > 0 && x >= 0 && x < W && y > 0.4 && y < H) { const d = t; if (!best || d < best.d) best = { d, out: { kind: 'wall', wall: 'back', at: Math.floor(x), py: y } }; }
      }
      if (dr.x < 0) {
        const t = (0.05 - o.x) / dr.x; const z = o.z + dr.z * t; const y = o.y + dr.y * t;
        if (t > 0 && z >= 0 && z < D && y > 0.4 && y < H) { const d = t; if (!best || d < best.d) best = { d, out: { kind: 'wall', wall: 'left', at: Math.floor(z), py: y } }; }
      }
      // the floor plane (always reported as `cell` when the pointer is over the room's floor)
      let cell = null;
      const t = -o.y / dr.y;
      if (t > 0) {
        const fx = o.x + dr.x * t; const fz = o.z + dr.z * t;
        const inside = fx >= 0 && fz >= 0 && fx < W && fz < D;
        const out = { kind: 'floor', x: Math.min(W - 1, Math.max(0, Math.floor(fx))), z: Math.min(D - 1, Math.max(0, Math.floor(fz))), px: fx, pz: fz, inside };
        if (inside) cell = { x: out.x, z: out.z };
        if (inside && (!best || t < best.d)) best = { d: t, out };
      }
      if (!best) return null;
      return best.out.kind === 'floor' || !cell ? best.out : { ...best.out, cell };
    },
    ghost(defId, at, valid = true) {
      lastGhost = null;
      const def = defId && at ? furnitureDef(defId) : null;
      ghostOver = Boolean(def && at.wall === 'back' && overDresser(at.at, Array.isArray(def.size) ? def.size[0] : 1));
      setHutch();
      if (!defId || !at) { ghostMesh.visible = false; cellMark.visible = false; return; }
      let k; let geo;
      if (defId === 'duet_table' && !models.has('furniture:duet_table')) { k = 'hh-duet-table'; geo = duetTableGeometry.ghost || (duetTableGeometry.ghost = duetTableGeometry()); }
      else {
        k = keyOfFurniture(furniture, defId);
        geo = k.startsWith('hh-furn:') ? standInFor(defId) : models.geometryFor(k);
        if (!geo) {
          // the model is not loaded yet: its footprint box now, the model as soon as it arrives (if still the ghost)
          geo = models.placeholder(k);
          const args = [defId, at, valid];
          models.ready([k]).then(() => { if (ghostMesh.visible && lastGhost === args) this.ghost(...args); }).catch(() => {});
          lastGhost = args;
        }
      }
      if (ghostMesh.geometry !== geo) ghostMesh.geometry = geo;
      const p = itemPlacement(at, def, !k.startsWith('hh-'));
      ghostMesh.position.set(p.x, p.y + (p.wall ? 0 : 0.02), p.z);
      ghostMesh.rotation.set(0, p.yaw, 0);
      ghostMat.color.set(valid ? '#BFE8C8' : '#FF8A80');
      ghostMesh.visible = true;
      const [w, d] = Array.isArray(def?.size) ? def.size : [1, 1];
      const rot = ((at.rot || 0) % 4 + 4) % 4;
      cellMark.scale.set(rot % 2 ? d : w, 1, rot % 2 ? w : d);
      cellMark.position.set(p.x, 0.02, p.z);
      cellMark.material.color.set(valid ? '#58D66A' : '#E5534B');
      cellMark.visible = !p.wall;
    },
    rotate(dir) { cam.goalYaw = Math.min(LIM.yaw[1], Math.max(LIM.yaw[0], cam.goalYaw + (dir > 0 ? 0.24 : -0.24))); setGoals(); },
    zoom(f) {
      if (!Number.isFinite(f) || !(f > 0)) return;
      const fit = fitFor(cam.goalYaw).d;
      cam.zoomK = Math.min(LIM.zoomK, Math.max(LIM.dist[0] / fit, cam.zoomK * f));
      setGoals();
    },
    /**
     * Frame the room for a screen shape: the whole room fits (its floor corners and wall tops), centred; a portrait phone
     * looks a little steeper and wider.
     */
    resize(aspect) {
      if (!(aspect > 0)) return;
      cam.aspect = aspect;
      camera.aspect = aspect;
      camera.fov = aspect < 1 ? 44 : 32;
      cam.pitch = aspect < 1 ? 0.95 : 0.62;
      camera.updateProjectionMatrix();
      fits.clear();
      setGoals(true);
      camera.far = Math.max(80, cam.dist * 3);
      camera.updateProjectionMatrix();
    },
    focus() { cam.goalYaw = Math.PI / 4; cam.zoomK = 1; setGoals(); },
    stats() { return { items: items.size, figures: [...figures].filter(([, r]) => r.root.visible).map(([k]) => k), visit: visit.phase, stop: visit.stop ?? null }; },
  };
}
void defOf; void gable; void ring; void geoPart; void hash;
