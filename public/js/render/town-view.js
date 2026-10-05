// The Hollow Village across the river (GDD §2.1, §5.9 Town Projects, §8.4 "the village across the river glows"):
// a sleepy row of cottages round a green, its windows lit every evening. Each finished Town Project adds its
// landmark in its own spot (the Ferry Landing on the bank, the Little Chapel, the Bandstand on the green, the
// Schoolhouse ... 24 spots in all), with lamp posts that light up at night; while a project waits for "tomorrow"
// a scaffold and a timber pile stand in its spot. Static: everything is in the far scenery batch (no shadow pass),
// rebuilt only when the built set changes. Owned by the render-world lane.
//
//   createTown({ scenery, glows, fx }) -> town
//     town.setState(state, now) / town.sync(ids, topics, state, now) / town.update(dt, now) -> 0
//     town.places() -> [{ place: 'town', args: {}, box, live }]
//   TOWN_SLOTS[projectId] -> [x, z, yaw, scale]   where each landmark stands (metres; yaw PI faces the farm)
//   PAVILION_SLOT [x, z, yaw, scale]               the Festival Pavilion on the village green (Town Projects 25+, M2)
// Wave 3 (M2): the twenty M2 landmarks have stand-ins of their own (town-landmarks.js, lit at night), and the Festival
// Pavilion grows a tier per repeat (frame, bunting, lantern roof, dance floor, bandstand wing, garlands, bell, vane).
//   COTTAGES                                         the sleepy village (pure, tested: none on a slot or the street)
import * as THREE from 'three';
import { CONTENT } from '../../../shared/content/index.js';
import { heightAt, WATER_Y } from './ground.js';
import { box, cyl, cone, gable, flag, ball, ring, merge, modelKey, lin } from './world-kit.js';
import { townView, pavilionView } from './world-state.js';
import { models } from './models.js';
import { LANDMARKS, LIGHTS, pavilionGeometry, PAVILION_LIGHTS, PAVILION_TIERS } from './town-landmarks.js';

const N = Math.PI;               // facing the farm (north, -z)
// RD-07 (QA wave 2): the four M1b landmarks stand where the farm's camera sees them (the near half of the village,
// z <= 168 m), each a size larger than a cottage, so "two" and "all four" read differently from the farm
const FIXED = {
  ferry_landing: [84, 147.5, N, 1.1], chapel: [90, 163.5, -Math.PI / 2, 1.3], bandstand: [74, 166, N, 1.3], schoolhouse: [48.5, 166, N + 0.1, 1.2],
  lighthouse: [142, 151, N, 1], village_carousel: [54, 189, N, 1], village_bakery: [52, 163, N + 0.1, 1], millpond_bridge: [118, 174, N - 0.4, 1],
  library: [86, 185, N, 1], flower_market: [57.5, 160, N, 1], post_office: [100, 176, N - 0.25, 1], tea_room: [36, 166, N + 0.3, 1],
  clock_square: [70, 177, N, 1], watermill: [18, 172, N + 0.5, 1], boathouse: [126, 150, N, 1], village_green: [80, 177, N, 1],
  music_hall: [110, 186, N - 0.2, 1], harbour_inn: [116, 154, N - 0.3, 1], observatory: [40, 190, N + 0.2, 1], craft_hall: [28, 184, N + 0.4, 1],
  glasshouse_garden: [126, 166, N - 0.5, 1], skating_pond: [47, 182.5, N, 1], orchard_walk: [16, 167, N + 0.6, 1], festival_arch: [66.5, 199.5, N, 1],
};
/** The Festival Pavilion's spot: on the river road east of the bridge, in the farm camera's reach across the river
 *  (a cottage there gives way when the first tier is built). */
export const PAVILION_SLOT = Object.freeze([104.5, 167, Math.PI, 1]);
/** Where each Town Project's landmark stands. */
export const TOWN_SLOTS = Object.freeze(Object.fromEntries([...CONTENT.townProjects.values()].map((p, i) => [p.id,
  Object.freeze(FIXED[p.id] || [30 + (i % 6) * 16, 160 + Math.floor(i / 6) * 10, N, 1])])));
/** The sleepy village's cottages [x, z, yaw, variant]: along the main street from the bridge, the river road and
 *  a back lane, facing the street. A cottage gives way when a later landmark is built on its spot. */
export const COTTAGES = Object.freeze([[57.5, 167.5, 1.571, 0], [57.5, 160, 1.571, 1], [57.5, 177, 1.571, 2], [70.5, 177, -1.571, 3],
  [57.5, 186, 1.571, 0], [70.5, 186, -1.571, 1], [57.5, 195, 1.571, 2], [70.5, 195, -1.571, 3], [18, 165, 3.142, 0], [28, 165, 3.142, 1],
  [38, 165, 3.142, 2], [44, 174, 3.142, 3], [104, 165, 3.142, 0], [114, 165, 3.142, 1], [124, 165, 3.142, 2], [91, 152, 0, 3],
  [110, 151.5, 0, 0], [22, 184, 3.142, 1], [32, 184, 3.142, 2], [50, 184, 3.142, 3], [86, 184, 3.142, 0], [110, 184, 3.142, 1],
  [122, 184, 3.142, 2]].map((c) => Object.freeze(c)));

/** A cottage's footprint half-extents (metres, its own x / z): the larger of render-life's cottages x 1.25 and our
 *  stand-in with its roof overhang. A landmark's is a generous 3.6 m square. */
export const COTTAGE_HALF = Object.freeze([3.2, 2.6]);
export const LANDMARK_HALF = Object.freeze([3.6, 3.6]);
/** By design on the water's edge (their landings reach out over it). */
const WATERSIDE = new Set(['ferry_landing', 'boathouse', 'harbour_inn', 'lighthouse', 'millpond_bridge', 'watermill']);
/** The lowest ground under a footprint (x, z, yaw, [hx, hz]), sampled on a 9 x 9 grid (pure). */
export function footprintLow(x, z, yaw, [hx, hz]) {
  const c = Math.cos(yaw); const sn = Math.sin(yaw);
  let low = Infinity;
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
    const lx = (i / 4) * hx; const lz = (j / 4) * hz;
    low = Math.min(low, heightAt(x + lx * c + lz * sn, z - lx * sn + lz * c));
  }
  return low;
}
/** Every cottage or (non-waterside) landmark whose footprint reaches the river bank (RD-02: a cottage hung over the
 *  water). Pure; the dev build throws on any at the first build, the tests assert none. */
export function wetFootprints() {
  const out = [];
  for (const [x, z, yaw] of COTTAGES) if (footprintLow(x, z, yaw, COTTAGE_HALF) < WATER_Y + 0.25) out.push(`cottage ${x},${z}`);
  for (const [id, [x, z, yaw]] of Object.entries(TOWN_SLOTS)) {
    if (!WATERSIDE.has(id) && footprintLow(x, z, yaw, LANDMARK_HALF) < WATER_Y + 0.25) out.push(`${id} ${x},${z}`);
  }
  if (footprintLow(PAVILION_SLOT[0], PAVILION_SLOT[1], PAVILION_SLOT[2], [5.5, 4]) < WATER_Y + 0.25) out.push('pavilion');
  return out;
}

/** The little square at the foot of the bridge [key, x, z, yaw] (metres; render-life's props, skipped without them). */
export const SQUARE = Object.freeze([
  ['prop:noticeboard', 59.6, 153.2, Math.PI / 2], ['decor:tulip_planter', 59.4, 155.4, 0], ['prop:bench', 69.4, 152.6, -Math.PI / 2],
  ['prop:bench', 69.4, 154.8, -Math.PI / 2], ['decor:flower_bed', 70.2, 156.9, 0], ['decor:tulip_planter', 68.6, 150.8, 0],
  ['prop:villagers_1', 60.4, 156.0, 0.9], ['prop:villagers_3', 67.9, 161.4, 3.4],
].map((r) => Object.freeze(r)));

// ---------------------------------------------------------------------------------------------------
// Stand-ins (render-life's `town:*` keys replace them when the manifest has them)
const WALLS = ['#F1E6CF', '#EAD9BC', '#F4EEE2', '#E6D2B5'];
const ROOFS = ['#B5543F', '#57758A', '#6E5A7E', '#9C6A3E'];
const TRIM = '#7A4B2C';
const GLASS = '#FFE6A8';

function windowParts(x, y, z, ry = 0) {
  return [box(0.62, 0.72, 0.06, TRIM, { x, y, z, ry }), box(0.5, 0.6, 0.08, GLASS, { x, y: y + 0.06, z, ry }, { shade: false })];
}

function cottageGeometry(v) {
  const w = 5 + (v % 2) * 0.8; const d = 4.2; const h = 2.8 + (v === 2 ? 0.6 : 0);
  const parts = [box(w, h, d, WALLS[v % 4]), box(w + 0.2, 0.25, d + 0.2, '#A89A86')];
  parts.push(gable(w + 0.6, 2.0 + (v % 3) * 0.3, d + 0.8, ROOFS[v % 4], { y: h }));
  parts.push(box(0.6, 1.6, 0.6, '#8C7A6A', { x: w * 0.28, y: h + 0.4, z: -0.6 }), box(0.72, 0.14, 0.72, '#6E5E50', { x: w * 0.28, y: h + 2.0, z: -0.6 }));
  parts.push(box(0.9, 1.7, 0.08, '#6E3E2A', { x: -w * 0.18, z: d / 2 + 0.02 }), box(1.2, 0.12, 0.5, TRIM, { x: -w * 0.18, y: 1.8, z: d / 2 + 0.2 }));
  parts.push(...windowParts(w * 0.22, 1.0, d / 2 + 0.02), ...windowParts(-w * 0.32, 1.0, -d / 2 - 0.02));
  if (v % 2) parts.push(...windowParts(w / 2 + 0.02, 1.0, 0, Math.PI / 2));
  // a flower box under the front window and a little picket of garden
  parts.push(box(0.8, 0.22, 0.25, TRIM, { x: w * 0.22, y: 0.78, z: d / 2 + 0.15 }));
  for (let i = 0; i < 4; i++) parts.push(ball(0.11, ['#FF9FB0', '#FFE27A', '#FFFFFF', '#F7A35C'][(i + v) % 4], { x: w * 0.22 - 0.3 + i * 0.2, y: 1.04, z: d / 2 + 0.17 }));
  return merge(parts);
}

function ferryGeometry() {
  // a timber ferry house on the bank, a plank landing over the water and the flat ferry with its rail and bell
  const parts = [box(5.2, 2.6, 3.6, '#C99257'), box(5.4, 0.2, 3.8, '#8A5A35')];
  parts.push(gable(5.8, 1.7, 4.4, '#2F5D6B', { y: 2.6 }));
  parts.push(box(1.0, 1.8, 0.08, '#5A3A2A', { z: 1.82 }), box(2.2, 0.5, 0.1, '#E8DCC2', { y: 2.15, z: 1.84 }));
  parts.push(...windowParts(-1.6, 1.1, 1.82), ...windowParts(1.6, 1.1, 1.82));
  for (let i = 0; i < 16; i++) parts.push(box(2.6, 0.12, 0.42, i % 2 ? '#B9814A' : '#C99257', { y: 0.2, z: 2.2 + i * 0.45 }));
  for (const z of [3, 6.2, 9]) for (const sx of [-1.25, 1.25]) parts.push(cyl(0.13, 0.15, 2.4, 6, '#8A5A35', { x: sx, y: -2.1, z }));
  parts.push(box(4.6, 0.3, 2.6, '#8A5A35', { x: 0, y: -0.38, z: 10.2 }), box(4.4, 0.08, 2.4, '#C99257', { y: -0.08, z: 10.2 }));
  for (const sx of [-2.2, 2.2]) parts.push(box(0.06, 0.8, 2.4, '#E8DCC2', { x: sx, y: -0.05, z: 10.2 }));
  parts.push(cyl(0.05, 0.06, 1.8, 5, '#8A5A35', { x: 1.8, y: -0.05, z: 9.3 }), cone(0.2, 0.3, 8, '#E9B83F', { x: 1.8, y: 1.35, z: 9.3, rx: Math.PI }));
  parts.push(flag(0.7, 0.4, '#2BB3A3', { x: 1.8, y: 1.75, z: 9.3 }));
  return merge(parts);
}

function chapelGeometry() {
  const parts = [box(4.6, 3.4, 7.2, '#F6F1E6'), box(4.8, 0.3, 7.4, '#A89A86')];
  parts.push(gable(7.8, 2.8, 5.4, '#57758A', { y: 3.4, ry: Math.PI / 2 }));
  // the bell tower at the front with its spire and a gilt weathercock
  parts.push(box(2.0, 5.6, 2.0, '#F6F1E6', { z: 3.4 }), box(2.2, 0.2, 2.2, '#A89A86', { y: 5.6, z: 3.4 }));
  parts.push(box(1.0, 1.0, 2.04, '#3C3A36', { y: 4.3, z: 3.4 }, { shade: false }), box(2.04, 1.0, 1.0, '#3C3A36', { y: 4.3, z: 3.4 }, { shade: false }));
  parts.push(cone(1.45, 4.2, 4, '#57758A', { y: 5.8, z: 3.4, ry: Math.PI / 4 }));
  parts.push(cyl(0.04, 0.04, 0.9, 4, '#E9B83F', { y: 10, z: 3.4 }), box(0.5, 0.08, 0.06, '#E9B83F', { y: 10.6, z: 3.4 }));
  parts.push(box(1.1, 2.1, 0.08, '#6E3E2A', { z: 4.42 }), cyl(0.55, 0.55, 0.08, 12, '#FFE6A8', { y: 2.9, z: 4.42, rx: Math.PI / 2 }, { flat: true, shade: false }));
  for (const z of [-2.4, -0.6, 1.2]) for (const sx of [-2.32, 2.32]) parts.push(box(0.08, 1.5, 0.7, '#9CC9E8', { x: sx, y: 1.3, z }, { shade: false }));
  // a low churchyard wall and two yews
  for (const sx of [-3.6, 3.6]) parts.push(box(0.4, 0.7, 8.6, '#B8B0A2', { x: sx, z: 0.6 }));
  for (const sx of [-2.9, 2.9]) parts.push(cone(0.7, 2.6, 7, '#3F6B2E', { x: sx, y: 0.1, z: 5.3 }));
  return merge(parts);
}

function bandstandGeometry() {
  const parts = [cyl(3.1, 3.3, 0.7, 8, '#E8DCC2'), cyl(3.3, 3.35, 0.12, 8, '#A89A86', { y: 0.68 })];
  parts.push(...ring(8, (i, a) => [box(0.16, 2.6, 0.16, '#FFFFFF', { x: Math.sin(a) * 2.9, y: 0.75, z: Math.cos(a) * 2.9 }),
    box(2.2, 0.08, 0.08, '#FFFFFF', { x: Math.sin(a + Math.PI / 8) * 2.7, y: 1.5, z: Math.cos(a + Math.PI / 8) * 2.7, ry: a + Math.PI / 8 })]));
  const gore = (a0, a1, col) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([Math.sin(a0) * 3.6, 3.3, Math.cos(a0) * 3.6, Math.sin(a1) * 3.6, 3.3, Math.cos(a1) * 3.6, 0, 5.2, 0], 3));
    g.computeVertexNormals();
    return { g, c: lin(col), sway: 0, shade: true };
  };
  for (let i = 0; i < 8; i++) parts.push(gore((i / 8) * Math.PI * 2, ((i + 1) / 8) * Math.PI * 2, i % 2 ? '#D2483C' : '#F6EBD3'));
  parts.push(...ring(8, (i, a) => box(2.5, 0.3, 0.06, '#FFFFFF', { x: Math.sin(a + Math.PI / 8) * 3.45, y: 3.05, z: Math.cos(a + Math.PI / 8) * 3.45, ry: a + Math.PI / 8 })));
  parts.push(cyl(0.05, 0.05, 1.1, 4, '#E9B83F', { y: 5.1 }), flag(0.8, 0.45, '#2BB3A3', { y: 6.2 }));
  return merge(parts);
}

function schoolGeometry() {
  const parts = [box(7.2, 3.2, 5, '#B5402E'), box(7.4, 0.28, 5.2, '#A89A86')];
  parts.push(gable(7.9, 2.2, 5.8, '#57758A', { y: 3.2 }));
  for (const sx of [-2.5, -1.2, 1.2, 2.5]) parts.push(...windowParts(sx, 1.3, 2.52));
  parts.push(box(1.2, 2.1, 0.08, '#F6F1E6', { z: 2.52 }), box(1.6, 0.3, 0.12, '#F6F1E6', { y: 2.4, z: 2.56 }));
  for (const sx of [-3.62, 3.62]) parts.push(box(0.12, 3.2, 0.12, '#F6F1E6', { x: sx, z: 2.52 }));
  // the bell cupola on the ridge and a flag pole in the yard
  parts.push(box(1.1, 1.0, 1.1, '#F6F1E6', { y: 4.9 }), cone(0.95, 1.1, 4, '#57758A', { y: 5.9, ry: Math.PI / 4 }), cone(0.18, 0.28, 8, '#E9B83F', { y: 5.15, rx: Math.PI }));
  parts.push(cyl(0.05, 0.06, 5.2, 5, '#E8DCC2', { x: 4.6, z: 3.6 }), flag(1.0, 0.6, '#FF7A6B', { x: 4.6, y: 5.1, z: 3.6 }));
  return merge(parts);
}

function landmarkGeometry(n) {
  // the M2 landmarks' stand-in: a handsome two-storey hall in the village palette with a cupola
  const parts = [box(6, 4.4, 5, WALLS[n % 4]), box(6.2, 0.3, 5.2, '#A89A86'), gable(6.6, 2.4, 5.8, ROOFS[(n + 1) % 4], { y: 4.4 })];
  for (const sx of [-1.8, 1.8]) for (const y of [1.0, 2.8]) parts.push(...windowParts(sx, y, 2.52));
  parts.push(box(1.1, 2.0, 0.08, '#6E3E2A', { z: 2.52 }), box(0.9, 0.9, 0.9, '#F6F1E6', { y: 6.4 }), cone(0.8, 1.0, 4, ROOFS[n % 4], { y: 7.3, ry: Math.PI / 4 }));
  return merge(parts);
}

function scaffoldGeometry() {
  const parts = [];
  for (const sx of [-2.6, 0, 2.6]) for (const sz of [-2, 2]) parts.push(cyl(0.07, 0.07, 4.2, 5, '#C99257', { x: sx, z: sz }));
  for (const y of [1.4, 2.8]) {
    parts.push(box(5.6, 0.1, 0.5, '#B9814A', { y, z: 2 }), box(5.6, 0.1, 0.5, '#B9814A', { y, z: -2 }));
    parts.push(cyl(0.04, 0.04, 5.6, 4, '#8A5A35', { y: y + 0.5, z: 2.2, rz: Math.PI / 2 }));
  }
  parts.push(box(5.2, 1.2, 4, '#E6D2B5', { y: 0 }), box(1.2, 0.8, 0.08, '#6E3E2A', { z: 2.02 }));
  for (let i = 0; i < 5; i++) parts.push(box(2.4, 0.22, 0.24, i % 2 ? '#C99257' : '#B9814A', { x: 4.3, y: 0.11 + Math.floor(i / 2) * 0.24, z: -1 + (i % 2) * 0.3 }));
  parts.push(box(0.9, 0.9, 0.9, '#A8733F', { x: -4, y: 0, z: 1.5 }), cyl(0.3, 0.3, 0.6, 8, '#8C8880', { x: -4.2, z: -0.6 }));
  parts.push(flag(0.6, 0.35, '#FFC83D', { x: 2.6, y: 4.6, z: 2 }));
  return merge(parts);
}

const STAND_IN = {
  ferry_landing: ferryGeometry, chapel: chapelGeometry, bandstand: bandstandGeometry, schoolhouse: schoolGeometry, ...LANDMARKS,
};

export function createTown({ scenery, glows = null, fx = null }) {
  // dev builds (?dev) refuse a village that stands in the river (RD-02); production just draws
  if (typeof location !== 'undefined' && /[?&]dev(=1)?(&|$)/.test(location.search)) {
    const wet = wetFootprints();
    if (wet.length) throw new Error(`town-view: footprints over the river bank: ${wet.join('; ')}`);
  }
  let handles = [];
  let key = null;
  let view = { live: false, built: [], building: null };
  let pav = { live: false, tiers: 0, building: null };
  const pavShown = { tiers: -1 };
  let liveNow = false;
  const shown = new Set();           // landmarks this screen has drawn (the "built" sparkle only for new ones)
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3(1, 1, 1);
  const box3 = new THREE.Box3(new THREE.Vector3(14, -1, 140), new THREE.Vector3(124, 12, 196));
  const warm = new THREE.Color('#FFD39B');
  const spill = new THREE.Color('#FFD39B').multiplyScalar(0.55);
  const add = (k, x, z, yaw, s = 1, y = null) => {
    q.setFromAxisAngle(Y, yaw);
    m4.compose(v.set(x, y ?? heightAt(x, z) - 0.05, z), q, sc.setScalar(s));
    handles.push(scenery.add(k, m4));
  };
  /** Window glows of a model at a placement (the manifest's anchors, else the stand-in's front windows). */
  const windowsOf = (mk, x, z, yaw, s, out, fallback) => {
    // the manifest's window anchors; a real model without them gets two front windows from its bounds
    let wins = mk.real ? (models.info(mk.key)?.anchors?.windows || []) : fallback;
    if (mk.real && !wins.length) {
      const b = mk.bounds;
      const w = b.max.x - b.min.x;
      wins = [[-0.25 * w, b.max.y * 0.32, b.max.z + 0.05], [0.25 * w, b.max.y * 0.32, b.max.z + 0.05]];
    }
    const c = Math.cos(yaw); const sn = Math.sin(yaw);
    const y0 = heightAt(x, z);
    for (const [ax, ay, az] of wins.slice(0, 4)) {
      const wx = x + (ax * c + az * sn) * s; const wz = z + (-ax * sn + az * c) * s;
      // the village is seen from across the river: its windows glow a little larger than the farm's
      out.push({ pos: new THREE.Vector3(wx, y0 + ay * s, wz), size: 2.3, color: warm, billboard: true });
      // and a soft spill on the ground in front of the house
      const ox = wx - x; const oz = wz - z; const len = Math.hypot(ox, oz) || 1;
      out.push({ pos: new THREE.Vector3(wx + (ox / len) * 0.9, y0 + 0.05, wz + (oz / len) * 0.9), size: 3.4, color: spill, billboard: false });
    }
  };

  function build(firstLook) {
    for (const h of handles) scenery.remove(h);
    handles = [];
    const lights = [];
    // the sleepy village: cottages, always there, lit every evening
    const taken = [...view.built.map((b) => TOWN_SLOTS[b.id]), ...(view.building ? [TOWN_SLOTS[view.building.id]] : []),
      ...(pav.tiers > 0 || pav.building !== null ? [[PAVILION_SLOT[0], PAVILION_SLOT[1], 0, 1.2]] : [])];
    COTTAGES.forEach(([x, z, yaw, vnt]) => {
      if (taken.some(([tx, tz, , ts]) => Math.hypot(tx - x, tz - z) < 7.5 * Math.max(1, ts || 1))) return;
      const mk = modelKey(scenery, `town:cottage_${vnt + 1}`, () => cottageGeometry(vnt));
      // render-life's cottages are 3.6 m: a touch bigger reads as a house across the river
      const s = mk.real ? 1.25 : 1;
      add(mk.key, x, z, yaw, s);
      windowsOf(mk, x, z, yaw, s, lights, [[1.2, 1.1, 2.15], [-1.6, 1.1, -2.15]]);
    });
    // the village square where the bridge lands (RD-12, QA wave 2): benches, planters, a noticeboard and villagers
    for (const [k, x, z, yaw] of SQUARE) if (models.has(k)) add(k, x, z, yaw);
    // lamp posts down the main street, lit every evening
    for (const z of [155.5, 172.5, 190.5]) for (const sx of [-1, 1]) {
      const lx = 64 + sx * 3.3; const lz = z + sx * 1.5;
      add('decor:lantern', lx, lz, 0);
      lights.push({ pos: new THREE.Vector3(lx, heightAt(lx, lz) + 2.0, lz), size: 1.5, color: warm, billboard: true },
        { pos: new THREE.Vector3(lx, heightAt(lx, lz) + 0.05, lz), size: 3.2, color: warm, billboard: false });
    }
    // the landmarks of finished projects, and the scaffold of the one being built
    for (const b of view.built) {
      const [x, z, yaw, s] = TOWN_SLOTS[b.id];
      const mk = modelKey(scenery, `town:${b.id}`, () => (STAND_IN[b.id] ? STAND_IN[b.id]() : landmarkGeometry(b.n)));
      add(mk.key, x, z, yaw, s, b.id === 'ferry_landing' ? Math.max(heightAt(x, z), WATER_Y + 0.5) - 0.05 : null);
      windowsOf(mk, x, z, yaw, s, lights, b.id === 'bandstand' ? [[0, 2.6, 0]] : LIGHTS[b.id] ? LIGHTS[b.id].map(([lx, ly, lz]) => [lx, ly, lz]) : [[1.4, 1.4, 2.6], [-1.4, 1.4, 2.6]]);
      // the lighthouse's lamp shines out over the river at night
      if (b.id === 'lighthouse' && !mk.real) lights.push({ pos: new THREE.Vector3(x, heightAt(x, z) + 12.6 * s, z), size: 5.5, color: warm, billboard: true });
      // the village grows a little brighter: two lamp posts by every landmark
      for (const side of [-1, 1]) {
        const lx = x + Math.cos(yaw) * side * 4.2 * s + Math.sin(yaw) * 3.4 * s; const lz = z - Math.sin(yaw) * side * 4.2 * s + Math.cos(yaw) * 3.4 * s;
        add('decor:lantern', lx, lz, yaw);
        lights.push({ pos: new THREE.Vector3(lx, heightAt(lx, lz) + 2.0, lz), size: 1.6, color: warm, billboard: true },
          { pos: new THREE.Vector3(lx, heightAt(lx, lz) + 0.05, lz), size: 3.4, color: warm, billboard: false });
      }
      if (!firstLook && !shown.has(b.id) && fx) fx.play({ e: 'townBuilt', project: b.id }, new THREE.Vector3(x, heightAt(x, z), z), {});
      shown.add(b.id);
    }
    if (view.building) {
      // the project's own half-built frame in its scaffold (render-life's town:construction:<id>), else the generic site
      const [x, z, yaw, s] = TOWN_SLOTS[view.building.id];
      const own = models.has(`town:construction:${view.building.id}`);
      add(modelKey(scenery, own ? `town:construction:${view.building.id}` : 'town:construction', scaffoldGeometry).key, x, z, yaw, own ? s : 1);
    }
    // the Festival Pavilion (M2): every tier built so far, the next one's scaffold while it waits for tomorrow
    if (pav.tiers > 0 || pav.building !== null) {
      const [x, z, yaw, s] = PAVILION_SLOT;
      const tier = Math.min(PAVILION_TIERS, Math.max(1, pav.tiers));
      if (pav.tiers > 0) {
        const mk = modelKey(scenery, `town:festival_pavilion:${tier}`, () => pavilionGeometry(tier));
        add(mk.key, x, z, yaw, s);
        for (const [lx, ly, lz, sz] of PAVILION_LIGHTS(tier)) {
          const c = Math.cos(yaw); const sn = Math.sin(yaw);
          lights.push({ pos: new THREE.Vector3(x + (lx * c + lz * sn) * s, heightAt(x, z) + ly * s, z + (-lx * sn + lz * c) * s), size: sz, color: warm, billboard: true });
        }
        if (!firstLook && pavShown.tiers >= 0 && pav.tiers > pavShown.tiers && fx) fx.play({ e: 'townBuilt', project: 'festival_pavilion' }, new THREE.Vector3(x, heightAt(x, z), z), {});
      }
      if (pav.building !== null) add(modelKey(scenery, 'town:construction', scaffoldGeometry).key, x + (pav.tiers > 0 ? 5.6 : 0), z, yaw, 1);
      pavShown.tiers = pav.tiers;
    }
    if (glows) glows.set('world:town', lights);
  }

  function apply(s, now, firstLook = false) {
    view = townView(s, now);
    pav = pavilionView(s, now);
    liveNow = view.live;
    const k = `${view.built.map((b) => b.id).join(',')}|${view.building?.id || ''}|${pav.tiers}|${pav.building ?? ''}`;
    if (k === key) return;
    key = k;
    build(firstLook);
  }

  let lastCheck = 0;
  let stateRef = null;
  return {
    setState(s, now) { stateRef = s; apply(s, now, true); },
    sync(ids, topics, s, now) { stateRef = s; if (topics.has('*') || topics.has('town') || topics.has('xp')) apply(s, now); },
    // a landmark appears "the next day" by itself: look once a minute
    update(dt, now) {
      if (stateRef && now - lastCheck > 60_000) { lastCheck = now; apply(stateRef, now); }
      return 0;
    },
    places() { return [{ place: 'town', args: {}, box: box3, live: liveNow }]; },
    stats() { return { built: view.built.length, building: view.building?.id || null, pavilion: pav.tiers, instances: handles.length }; },
  };
}

