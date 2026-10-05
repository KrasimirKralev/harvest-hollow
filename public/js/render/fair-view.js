// The County Fair grounds (GDD §5.6; §2.2 "Fairground Lane (road)", §3.9 #6): a striped marquee on a mown field
// beyond the farm's lower-left corner, by the lane. Before the fair opens (L14) the marquee stands alone with a
// "coming soon" board; from then on bunting and string lights run along the path, two judging stalls flank it,
// an arch greets the lane, and the pennant on the marquee's mast flies the colour of the medal the couple reached
// this week (bronze, silver, gold; cream before the first). On Sunday 20:00, when the judges close the week,
// fireworks burst over the tent for ten minutes. Static parts live in the scenery batch; the pennant is one
// instance whose colour changes. Owned by the render-world lane.
//
// Wave 3 (M2): Restoration 5, the Town Fair Grounds (GDD §5.9 #5: Platinum, the top league): timber for a grandstand,
// its frame, then the grandstand and a grand entrance banner, and once restored a turning Ferris wheel strung with
// lights and silver-and-white Platinum bunting.
//   createFair({ scenery, dyn, glows, fx }) -> fair
//     fair.setState(state, now) / fair.sync(ids, topics, state, now) / fair.update(dt, now, { motion }) -> 0 | 1
//     fair.places() -> [{ place: 'fair', args: {}, box, live }]
//   FAIR_LAYOUT                                  where everything stands (metres, pure)
//   medalColor(rank) -> '#hex'                   the pennant colour of a medal rank (pure, tested)
//   fireworksOn(now, tz) -> bool                 the ten minutes after Sunday 20:00 (pure, tested)
import * as THREE from 'three';
import { FAIR } from '../../../shared/content/index.js';
import { PLACES } from './ground.js';
import { box, cyl, cone, flag, merge, modelKey, lin, gable, ring, geoPart } from './world-kit.js';
import { fairView, localWeekMs, restorationView } from './world-state.js';
import { models } from './models.js';

const F = PLACES.fair;
export const FAIR_LAYOUT = Object.freeze({
  tent: Object.freeze([F.x, F.z - 4.5]),
  stalls: Object.freeze([Object.freeze([F.x - 8, F.z + 4, 0.5]), Object.freeze([F.x + 8, F.z + 4, -0.5])]),
  // RD-12 (QA wave 2): three distinct booths (preserves, bakers, games), the judges' seating facing the podium, and
  // villagers (more of them on Sunday, the judging day)
  booths: Object.freeze([Object.freeze(['prop:fair_booth_jam', F.x - 8, F.z + 4, 0.5]), Object.freeze(['prop:fair_booth_pie', F.x + 8, F.z + 4, -0.5]),
    Object.freeze(['prop:fair_booth_games', F.x - 10, F.z - 3.5, 1.25])]),
  podium: Object.freeze([F.x + 7.5, F.z - 3, -0.35]),
  folk: Object.freeze([[F.x - 3.2, F.z + 4.2, 0.4, 1], [F.x - 6.4, F.z + 2.4, 2.2, 2], [F.x + 1.8, F.z + 8.5, 3.6, 3]]),
  sundayFolk: Object.freeze([[F.x + 4.6, F.z - 0.8, 2.6, 2], [F.x - 2.2, F.z - 0.2, 1.1, 1], [F.x + 3.2, F.z + 3.4, 5.0, 3], [F.x - 8.6, F.z - 0.6, 0.2, 1]]),
  arch: Object.freeze([F.x, F.z + 11.5]),
  bales: Object.freeze([[F.x - 10.5, F.z + 7.5], [F.x - 11.6, F.z + 6.2], [F.x + 10.8, F.z + 7.2], [F.x - 6, F.z - 9], [F.x + 6.5, F.z - 9.5]]),
  // bunting lines: pole to pole (x0, z0, x1, z1)
  bunting: Object.freeze([[F.x - 3, F.z + 11, F.x - 9.5, F.z + 1.5], [F.x + 3, F.z + 11, F.x + 9.5, F.z + 1.5],
    [F.x - 9.5, F.z + 1.5, F.x - 6, F.z - 6], [F.x + 9.5, F.z + 1.5, F.x + 6, F.z - 6]]),
});

const MEDAL = { bronze: '#D08A4E', silver: '#D9E1E8', gold: '#FFC83D', platinum: '#EAF4FF' };
export const medalColor = (rank) => MEDAL[rank] || '#FFF3D6';

/** The ten minutes after the judges close the week (Sunday 20:00 farm time): fireworks. */
export function fireworksOn(now, tz) {
  const t = localWeekMs(now, tz);
  const close = FAIR.closeDay * 86_400_000 + FAIR.closeHour * 3_600_000;
  return t >= close && t < close + 10 * 60_000;
}

// ---------------------------------------------------------------------------------------------------
// Stand-ins
const RED = '#D2483C';
const CREAM = '#F6EBD3';
const WOOD = '#B9814A';

/** A round striped marquee, 8 m across: walls, a peaked roof in alternating gores, a scalloped valance, a door. */
function tentGeometry() {
  const parts = [];
  const N = 16; const R = 4; const wall = 2.3; const peak = 3.4;
  for (let i = 0; i < N; i++) {
    const a = ((i + 0.5) / N) * Math.PI * 2;
    const w = 2 * R * Math.sin(Math.PI / N) + 0.04;
    parts.push(box(w, wall, 0.08, i % 2 ? RED : CREAM, { x: Math.sin(a) * R, z: Math.cos(a) * R, ry: a }));
    // valance: a hanging scallop under the eave
    const g = new THREE.BufferGeometry();
    const a0 = (i / N) * Math.PI * 2; const a1 = ((i + 1) / N) * Math.PI * 2; const am = (a0 + a1) / 2;
    const r = R + 0.18;
    g.setAttribute('position', new THREE.Float32BufferAttribute([Math.sin(a0) * r, wall + 0.05, Math.cos(a0) * r, Math.sin(am) * r, wall - 0.42, Math.cos(am) * r,
      Math.sin(a1) * r, wall + 0.05, Math.cos(a1) * r], 3));
    parts.push({ g, c: lin(i % 2 ? CREAM : RED), sway: 0, shade: false });
  }
  // roof gores from the eave ring up to the peak
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2; const a1 = ((i + 1) / N) * Math.PI * 2;
    const r = R + 0.25;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([Math.sin(a0) * r, wall + 0.05, Math.cos(a0) * r, Math.sin(a1) * r, wall + 0.05, Math.cos(a1) * r,
      0, wall + peak, 0], 3));
    g.computeVertexNormals();
    parts.push({ g, c: lin(i % 2 ? RED : CREAM), sway: 0, shade: true });
  }
  // the door: a dark opening with the flaps tied back, a step
  parts.push(box(1.6, 1.9, 0.12, '#5A3A2A', { z: R + 0.02 }, { shade: false }));
  for (const sx of [-1, 1]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([sx * 0.8, 2.0, R + 0.12, sx * 1.25, 0, R + 0.18, sx * 0.85, 0, R + 0.14], 3));
    parts.push({ g, c: lin(CREAM), sway: 0, shade: false });
  }
  parts.push(box(2.0, 0.12, 0.7, WOOD, { z: R + 0.4 }));
  // the mast through the peak with a gilt finial (the medal pennant is its own instance)
  parts.push(cyl(0.07, 0.09, 1.6, 6, '#E8DCC2', { y: wall + peak - 0.2 }));
  parts.push(cone(0.16, 0.3, 6, '#FFC83D', { y: wall + peak + 1.38 }));
  // guy ropes and pegs
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    parts.push(cyl(0.025, 0.025, 2.4, 3, '#D9C59A', { x: Math.sin(a) * (R + 0.7), y: 0.05, z: Math.cos(a) * (R + 0.7), rx: Math.cos(a) * 0.62, rz: -Math.sin(a) * 0.62 }));
  }
  return merge(parts);
}

/** A judging stall: a table under a striped awning, a rosette board, produce in crates. */
function stallGeometry() {
  const parts = [box(2.8, 0.08, 1.1, '#E8DCC2', { y: 0.85 }), box(2.85, 0.5, 1.15, '#F6EBD3', { y: 0.38 })];
  for (const sx of [-1.3, 1.3]) for (const sz of [-0.45, 0.45]) parts.push(box(0.08, 0.85, 0.08, WOOD, { x: sx, z: sz }));
  for (const sx of [-1.35, 1.35]) parts.push(box(0.1, 2.4, 0.1, WOOD, { x: sx, z: -0.55 }));
  for (let i = 0; i < 7; i++) parts.push(box(0.43, 0.06, 1.3, i % 2 ? RED : CREAM, { x: -1.3 + i * 0.43, y: 2.35, z: -0.05, rx: 0.22 }));
  parts.push(box(1.8, 0.9, 0.06, '#3F6B5A', { y: 1.25, z: -0.56 }));
  const ros = ['#4A8FD9', '#D2483C', '#FFC83D', '#9A6AD0'];
  for (let i = 0; i < 4; i++) {
    parts.push(cyl(0.16, 0.16, 0.04, 10, ros[i], { x: -0.6 + i * 0.4, y: 1.55, z: -0.52, rx: Math.PI / 2 }, { flat: true }));
    parts.push(box(0.08, 0.26, 0.02, ros[i], { x: -0.6 + i * 0.4, y: 1.18, z: -0.5 }, { shade: false }));
  }
  // produce on the table: pumpkins, a cake, a jar row
  parts.push(cyl(0.22, 0.24, 0.3, 8, '#F2852A', { x: -0.9, y: 0.89 }), cyl(0.18, 0.2, 0.26, 8, '#F2852A', { x: -0.55, y: 0.89, z: 0.15 }));
  parts.push(cyl(0.26, 0.26, 0.22, 12, '#FFF3E4', { x: 0.1, y: 0.89 }), cyl(0.2, 0.2, 0.1, 12, '#F7A6C4', { x: 0.1, y: 1.11 }));
  for (let i = 0; i < 3; i++) parts.push(cyl(0.08, 0.08, 0.2, 8, ['#B5402E', '#E9B83F', '#7A3F7A'][i], { x: 0.6 + i * 0.2, y: 0.89, z: -0.15 }));
  return merge(parts);
}

/** The entrance arch over the lane: two posts and a painted sign board with pennants. */
function archGeometry() {
  const parts = [];
  for (const sx of [-2.6, 2.6]) { parts.push(box(0.26, 3.8, 0.26, WOOD, { x: sx })); parts.push(cone(0.22, 0.4, 4, RED, { x: sx, y: 3.8, ry: Math.PI / 4 })); }
  parts.push(box(5.6, 0.75, 0.14, CREAM, { y: 3.0 }), box(5.8, 0.12, 0.2, RED, { y: 3.74 }), box(5.8, 0.12, 0.2, RED, { y: 2.96 }));
  for (let i = 0; i < 6; i++) parts.push(box(0.5, 0.1, 0.02, '#2F5D6B', { x: -1.7 + i * 0.68, y: 3.35, z: 0.08 }, { shade: false }));
  for (let i = 0; i < 9; i++) parts.push(flag(0.32, 0.4, i % 3 === 0 ? RED : i % 3 === 1 ? '#FFC83D' : '#4A8FD9', { x: -2.4 + i * 0.6, y: 2.9, z: 0.1, rz: -Math.PI / 2 }, { sway: 0.6 }));
  return merge(parts);
}

/** The "coming soon" board on two posts (before the fair opens). */
function signGeometry() {
  return merge([box(0.12, 1.5, 0.12, WOOD, { x: -0.6 }), box(0.12, 1.5, 0.12, WOOD, { x: 0.6 }), box(1.6, 0.8, 0.08, CREAM, { y: 0.75 }),
    box(1.7, 0.1, 0.12, RED, { y: 1.55 }), box(1.0, 0.08, 0.02, '#5A3A2A', { y: 1.15, z: 0.05 }, { shade: false }),
    box(0.7, 0.08, 0.02, '#5A3A2A', { y: 0.95, z: 0.05 }, { shade: false })]);
}

/** A string of pennants between two poles, `len` metres along +x (each pennant swings in the wind). */
function buntingGeometry(len, colours = null) {
  const parts = [box(0.12, 3.0, 0.12, WOOD, { x: 0 }), box(0.12, 3.0, 0.12, WOOD, { x: len })];
  const n = Math.max(3, Math.round(len / 0.55));
  const cols = colours || [RED, '#FFC83D', '#4A8FD9', CREAM, '#2BB3A3'];
  const sagAt = (t) => 2.9 - 0.55 * Math.sin(t * Math.PI);
  for (let i = 1; i < n; i++) {
    const x = (i / n) * len;
    parts.push(flag(0.3, 0.42, cols[i % cols.length], { x: x - 0.15, y: sagAt(i / n), rz: -Math.PI / 2 }, { sway: 0.5 }));
  }
  // the string follows the same sag, segment by segment
  const seg = 8;
  for (let k = 0; k < seg; k++) {
    const x0 = (k / seg) * len; const x1 = ((k + 1) / seg) * len;
    const y0 = sagAt(k / seg); const y1 = sagAt((k + 1) / seg);
    const L = Math.hypot(x1 - x0, y1 - y0);
    // (a kit cylinder stands on its base: start it at the segment's first point, turned toward the next)
    parts.push(cyl(0.015, 0.015, L, 3, '#D9C59A', { x: x0, y: y0, rz: -Math.PI / 2 + Math.atan2(y1 - y0, x1 - x0) }));
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------------------------------
// Restoration 5 (the Town Fair Grounds): the grandstand by the podium and the Ferris wheel west of the marquee
export const FAIR_GROUNDS = Object.freeze({ stand: Object.freeze([F.x + 13.2, F.z + 4.5, -Math.PI / 2]), wheel: Object.freeze([F.x - 12.5, F.z - 8.5, 0.35]),
  wheelR: 4.6, hubY: 5.6 });
/** The grandstand: four tiers of benches under a striped roof on posts (stage 2: the bare frame). */
export function grandstandGeometry(stage) {
  const parts = [];
  const W = 7.0;
  for (let i = 0; i < 4; i++) {
    parts.push(box(W, 0.45 + i * 0.45, 0.9, stage >= 3 ? '#B9814A' : '#C99257', { z: -i * 0.9 + 1.35 }));
    if (stage >= 3) parts.push(box(W - 0.2, 0.08, 0.5, i % 2 ? '#2F6FB8' : '#F6F1E6', { y: 0.45 + i * 0.45, z: -i * 0.9 + 1.35 }));
  }
  for (const sx of [-W / 2, -W / 6, W / 6, W / 2]) parts.push(box(0.16, 4.6, 0.16, '#F6F1E6', { x: sx, z: -1.9 }), box(0.16, 3.4, 0.16, '#F6F1E6', { x: sx, z: 1.9 }));
  if (stage >= 3) {
    for (let k = 0; k < 10; k++) parts.push(box(W / 10 + 0.02, 0.06, 4.3, k % 2 ? '#FFFFFF' : '#2F6FB8', { x: -W / 2 + (k + 0.5) * W / 10, y: 4.0, z: 0, rx: -0.28 }));
    for (let k = 0; k < 10; k++) parts.push(cone(0.36, 0.3, 3, k % 2 ? '#FFFFFF' : '#2F6FB8', { x: -W / 2 + (k + 0.5) * W / 10, y: 3.45, z: 2.15, rx: Math.PI }, { shade: false }));
    parts.push(box(2.8, 0.6, 0.1, '#F6F1E6', { y: 4.55, z: -2.05 }), box(2.5, 0.36, 0.12, '#C9A04A', { y: 4.67, z: -2.06 }, { shade: false }));
  } else for (const y of [1.5, 3.0]) parts.push(box(W, 0.08, 0.08, '#C99257', { y, z: -1.9 }), box(W, 0.08, 0.08, '#C99257', { y, z: 1.9 }));
  return merge(parts);
}
/** Timber stacked for the works (stage 1) with a surveyor's pennant. */
const timberGeometry = () => merge([...Array.from({ length: 6 }, (_, k) => box(3.2, 0.22, 0.24, k % 2 ? '#B9814A' : '#C99257', { y: 0.11 + Math.floor(k / 3) * 0.24, z: (k % 3) * 0.28 })),
  cyl(0.03, 0.03, 1.6, 4, '#E8DCC2', { x: 2.2 }), flag(0.5, 0.3, '#FFC83D', { x: 2.2, y: 1.6 })]);
/** The Ferris wheel's frame: two A-frames, the axle, a ticket booth and a fence (the wheel itself turns). */
export function ferrisFrameGeometry() {
  const R = FAIR_GROUNDS; const parts = [];
  for (const sz of [-0.9, 0.9]) for (const sx of [-1, 1]) parts.push(box(0.22, R.hubY + 0.6, 0.22, '#F6F1E6', { x: sx * 1.7, z: sz, rz: -sx * 0.3 }));
  parts.push(cyl(0.16, 0.16, 2.2, 8, '#9A9184', { y: R.hubY, rx: Math.PI / 2, z: -1.1 }));
  parts.push(box(1.6, 2.0, 1.2, '#D2483C', { x: 3.4, z: 2.6 }), gable(1.9, 0.8, 1.5, '#F6F1E6', { x: 3.4, y: 2.0, z: 2.6 }), box(0.9, 0.5, 0.06, '#FFE6A8', { x: 3.4, y: 1.1, z: 3.22 }, { shade: false }));
  for (let k = 0; k < 7; k++) parts.push(box(0.06, 0.8, 0.06, '#F6F1E6', { x: -3 + k, z: 3.2 }));
  parts.push(box(6.2, 0.06, 0.06, '#F6F1E6', { y: 0.7, z: 3.2 }));
  return merge(parts);
}
/** The wheel: two rims, spokes and eight drum gondolas (round about the axle, so they never hang upside down). */
export function ferrisWheelGeometry() {
  const R = FAIR_GROUNDS.wheelR; const parts = [];
  for (const sz of [-0.6, 0.6]) parts.push(geoPart(new THREE.TorusGeometry(R, 0.08, 5, 28), '#F6F1E6', { z: sz }), geoPart(new THREE.TorusGeometry(R * 0.3, 0.06, 4, 12), '#F6F1E6', { z: sz }));
  // spokes from the hub out to the rims (a kit box stands on its base: start it at the hub, turned outward)
  parts.push(...ring(16, (i, a) => [box(0.06, R, 0.06, '#E8DCC2', { z: -0.6, rz: a - Math.PI / 2 }), box(0.06, R, 0.06, '#E8DCC2', { z: 0.6, rz: a - Math.PI / 2 })]));
  const GC = ['#D2483C', '#FFC83D', '#2BB3A3', '#4AA8E8', '#FF9FB0', '#8E7AB8', '#F7A35C', '#5E8C45'];
  parts.push(...ring(8, (i, a) => [cyl(0.48, 0.48, 1.0, 10, GC[i], { x: Math.cos(a) * R, y: Math.sin(a) * R, z: -0.5, rx: Math.PI / 2 }), cyl(0.5, 0.5, 0.12, 10, '#F6F1E6', { x: Math.cos(a) * R, y: Math.sin(a) * R, z: 0.5, rx: Math.PI / 2 })]));
  parts.push(...ring(16, (i, a) => cyl(0.07, 0.07, 0.06, 6, i % 2 ? '#FFE27A' : '#FF7A6B', { x: Math.cos(a) * (R + 0.1), y: Math.sin(a) * (R + 0.1), z: 0.65, rx: Math.PI / 2 }, { shade: false })));
  return merge(parts);
}

export function createFair({ scenery, dyn = null, glows = null, fx = null }) {
  let grounds = 0;                  // Restoration 5's stage (0..4)
  let wheel = null;
  let wheelAngle = 0;
  let handles = [];
  let pennant = null;
  let key = '';
  let view = { live: false, medal: null };
  let state = null;
  let fwAt = 0;
  let clock = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  const box3 = new THREE.Box3(new THREE.Vector3(F.x - 13, 0, F.z - 10), new THREE.Vector3(F.x + 13, 7, F.z + 13));
  const add = (k, x, z, yaw = 0, s = 1, y = 0) => {
    q.setFromAxisAngle(Y, yaw);
    m4.compose(v.set(x, y, z), q, sc.setScalar(s));
    const h = scenery.add(k, m4);
    handles.push(h);
    return h;
  };

  let sunday = false;
  let checkedAt = 0;
  function build(live) {
    for (const h of handles) scenery.remove(h);
    handles = [];
    pennant = null;
    const [tx, tz] = FAIR_LAYOUT.tent;
    const tent = modelKey(scenery, 'prop:fair_tent', tentGeometry);
    add(tent.key, tx, tz, 0, tent.real ? 1.2 : 1);
    // the medal pennant at the mast top (a white flag, coloured per instance)
    const fk = modelKey(scenery, 'hh-fair-pennant', () => merge([flag(1.5, 0.85, '#FFFFFF', {}, { sway: 1.8 })]));
    const top = tent.real ? tent.bounds.max.y * 1.2 : 2.3 + 3.4 + 1.38;
    q.setFromAxisAngle(Y, 0);
    m4.compose(v.set(tx + 0.05, top, tz), q, sc.set(1, 1, 1));
    pennant = scenery.add(fk.key, m4, col.set(medalColor(view.medal?.rank)));
    handles.push(pennant);
    const bale = 'prop:hay_bale';
    for (const [bx, bz] of FAIR_LAYOUT.bales) add(bale, bx, bz, (bx * 7 + bz) % 3, 1.1);
    if (!live) {
      add(modelKey(scenery, 'hh-fair-sign', signGeometry).key, F.x, F.z + 9, 0, 1.2);
      if (glows) glows.set('world:fair', null);
      return;
    }
    // three distinct booths (render-life's models), else the two generic judging stalls
    if (FAIR_LAYOUT.booths.every(([k]) => models.has(k))) for (const [k, bx, bz, yaw] of FAIR_LAYOUT.booths) add(k, bx, bz, yaw);
    else { const stall = modelKey(scenery, 'prop:fair_stall', stallGeometry); for (const [sx, sz, yaw] of FAIR_LAYOUT.stalls) add(stall.key, sx, sz, yaw); }
    add(modelKey(scenery, 'hh-fair-arch', archGeometry).key, FAIR_LAYOUT.arch[0], FAIR_LAYOUT.arch[1], 0, 1.15);
    const lights = [];
    const warm = new THREE.Color('#FFD9A0');
    FAIR_LAYOUT.bunting.forEach(([x0, z0, x1, z1], i) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const bk = modelKey(scenery, `hh-fair-bunting-${i}`, () => buntingGeometry(len));
      add(bk.key, x0, z0, -Math.atan2(z1 - z0, x1 - x0));
      // a string of lights along each line for the evenings
      for (let k = 1; k < 6; k++) {
        const t = k / 6;
        lights.push({ pos: new THREE.Vector3(x0 + (x1 - x0) * t, 2.55 - 0.45 * Math.sin(t * Math.PI), z0 + (z1 - z0) * t), size: 0.9, color: warm, billboard: true });
      }
    });
    const rb = 'decor:fair_rosettes_display';
    add(rb, F.x + 3.6, F.z + 8.5, -0.4, 1.3);
    add('prop:crate_stack', F.x - 11.8, F.z + 2.5, 0.6);
    add('prop:barrel', F.x + 11.5, F.z + 3.2, 0);
    add('prop:barrel', F.x + 12.1, F.z + 2.2, 1);
    // the judges' podium beside the marquee (the Sunday ceremony) with two rows of benches facing it, picnic tables for
    // the visitors, lanterns on the path
    const [px0, pz0, pyaw] = FAIR_LAYOUT.podium;
    if (models.has('prop:fair_podium')) add('prop:fair_podium', px0, pz0, pyaw, 1.1);
    if (models.has('prop:bench')) {
      const fx0 = Math.sin(pyaw); const fz0 = Math.cos(pyaw); const sx0 = Math.cos(pyaw); const sz0 = -Math.sin(pyaw);
      for (const d of [2.8, 4.4]) for (const side of [-0.9, 0.9]) add('prop:bench', px0 + fx0 * d + sx0 * side, pz0 + fz0 * d + sz0 * side, pyaw + Math.PI);
    }
    for (const [vx, vz, vyaw, g] of [...FAIR_LAYOUT.folk, ...(sunday ? FAIR_LAYOUT.sundayFolk : [])]) if (models.has(`prop:villagers_${g}`)) add(`prop:villagers_${g}`, vx, vz, vyaw);
    for (const [px, pz, yaw] of [[F.x - 6.5, F.z + 8.6, 0.3], [F.x + 9.5, F.z - 4.5, -1.2]]) add('decor:picnic_table', px, pz, yaw);
    for (const [lx, lz] of [[F.x - 2.6, F.z + 6], [F.x + 2.6, F.z + 6], [F.x - 2.6, F.z + 1], [F.x + 2.6, F.z + 1]]) {
      add('decor:lantern', lx, lz, 0);
      lights.push({ pos: new THREE.Vector3(lx, 2.05, lz), size: 1.4, color: warm, billboard: true },
        { pos: new THREE.Vector3(lx, 0.05, lz), size: 3.2, color: warm, billboard: false });
    }
    lights.push({ pos: new THREE.Vector3(tx, 0.1, tz + 5.5), size: 5, color: warm, billboard: false });
    // Restoration 5 (the Town Fair Grounds)
    const G = FAIR_GROUNDS;
    if (grounds >= 1 && grounds <= 2) add(modelKey(scenery, 'hh-fair-timber', timberGeometry).key, G.stand[0] - 0.5, G.stand[1] + 4.2, 0.2);
    if (grounds >= 2) add(modelKey(scenery, `hh-fair-stand-${grounds >= 3 ? 3 : 2}`, () => grandstandGeometry(grounds)).key, G.stand[0], G.stand[1], G.stand[2]);
    if (grounds >= 4) {
      add(modelKey(scenery, 'hh-ferris-frame', ferrisFrameGeometry).key, G.wheel[0], G.wheel[1], G.wheel[2]);
      const c = Math.cos(G.wheel[2]); const sn = Math.sin(G.wheel[2]);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        lights.push({ pos: new THREE.Vector3(G.wheel[0] + Math.cos(a) * G.wheelR * c + 0.7 * sn, G.hubY + Math.sin(a) * G.wheelR, G.wheel[1] - Math.cos(a) * G.wheelR * sn + 0.7 * c), size: 1.2, color: warm, billboard: true });
      }
      // Platinum bunting: silver and white along the marquee's porch
      for (const [x0, z0, x1, z1] of [[F.x - 5, F.z + 11.2, F.x - 12, F.z + 9], [F.x + 5, F.z + 11.2, F.x + 12, F.z + 9]]) {
        const len = Math.hypot(x1 - x0, z1 - z0);
        add(modelKey(scenery, `hh-plat-bunting-${Math.round(len * 10)}`, () => buntingGeometry(len, ['#EAF4FF', '#C9D2DA', '#FFFFFF'])).key, x0, z0, -Math.atan2(z1 - z0, x1 - x0));
      }
    }
    if (dyn) {
      if (grounds >= 4 && wheel === null) wheel = dyn.add(modelKey(dyn, 'hh-ferris-wheel', ferrisWheelGeometry).key, m4.identity());
      if (grounds < 4 && wheel !== null) { dyn.remove(wheel); wheel = null; }
      placeWheel();
    }
    if (glows) glows.set('world:fair', lights);
  }

  function placeWheel() {
    if (wheel === null) return;
    const G = FAIR_GROUNDS;
    m4.makeTranslation(G.wheel[0], G.hubY, G.wheel[1]).multiply(new THREE.Matrix4().makeRotationY(G.wheel[2])).multiply(new THREE.Matrix4().makeRotationZ(wheelAngle));
    dyn.setMatrix(wheel, m4);
  }

  function apply(s, now) {
    state = s;
    view = fairView(s, now);
    // Sunday, the judging day: the grounds fill with visitors
    const sun = Math.floor(localWeekMs(now, s?.meta?.tz || 'UTC') / 86_400_000) === 6;
    const g = restorationView(s, now).find((p) => p.id === 'fair_grounds');
    const gs = g && g.live ? g.stage : 0;
    const k = `${view.live}|${view.medal?.rank || ''}|${sun}|${gs}`;
    if (k === key) return;
    const [wasLive, , wasSun, wasG] = key.split('|');
    const liveChanged = wasLive !== String(view.live) || wasSun !== String(sun) || wasG !== String(gs);
    if (wasG !== undefined && Number(wasG) < gs && fx) fx.play(gs === 4 ? { e: 'restored', project: 'fair_grounds' } : { e: 'bundleDone', project: 'fair_grounds' }, new THREE.Vector3(FAIR_GROUNDS.stand[0], 0, FAIR_GROUNDS.stand[1]), {});
    grounds = gs;
    key = k;
    sunday = sun;
    if (liveChanged || !pennant) build(view.live);
    else scenery.setColor(pennant, col.set(medalColor(view.medal?.rank)));
  }

  return {
    setState(s, now) { apply(s, now); },
    sync(ids, topics, s, now) { if (topics.has('*') || topics.has('fair') || topics.has('xp') || topics.has('restore')) apply(s, now); },
    update(dt, now, { motion = 'full' } = {}) {
      clock += dt;
      // the Ferris wheel turns slowly (Restoration 5)
      if (wheel !== null && motion !== 'still') { wheelAngle -= dt * 0.18; placeWheel(); }
      // the day turns to Sunday (or back) by itself: look once a minute
      if (state && Math.abs(now - checkedAt) > 60_000) { checkedAt = now; apply(state, now); }
      if (!state || !view.live || !fx || motion === 'still') return wheel !== null && motion !== 'still' ? 1 : 0;
      // the ceremony (rules-goals' `last.at`, else the calendar's Sunday 20:00): ten minutes of fireworks
      const since = Number.isFinite(view.ceremonyAt) ? now - view.ceremonyAt : Infinity;
      if (!(since >= 0 && since < 10 * 60_000) && !fireworksOn(now, state.meta?.tz || 'UTC')) return wheel !== null ? 1 : 0;
      // the ceremony: a firework every 2-3 s over the marquee, in the medal colours
      if (clock >= fwAt) {
        fwAt = clock + 2 + Math.random();
        const [tx, tz] = FAIR_LAYOUT.tent;
        const p = new THREE.Vector3(tx + (Math.random() - 0.5) * 10, 12 + Math.random() * 5, tz + (Math.random() - 0.5) * 6);
        const c = [medalColor(view.medal?.rank), '#FF7A6B', '#2BB3A3', '#FFFFFF', '#FFE27A'];
        fx.burst('sparkle', p, { n: 26, colors: c, speed: 4.2, up: 0.8, size: 0.5, sizeEnd: 0.1, life: 1.5, grav: 0.35, spread: 0.2, y: 0, additive: true, ambient: true });
        fx.burst('glow', p, { n: 1, color: c[0], speed: 0, up: 0, size: 3.5, sizeEnd: 0.5, life: 0.6, grav: 0, spread: 0, y: 0, additive: true, ambient: true });
      }
      return 1;
    },
    places() { return [{ place: 'fair', args: {}, box: box3, live: view.live }]; },
    stats() { return { live: view.live, medal: view.medal?.id || null, grounds, instances: handles.length }; },
  };
}
