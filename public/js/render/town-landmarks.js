// The Hollow Village's M2 landmarks (GDD §5.9 Town Projects 5-24, content TOWN_PROJECTS) and the Festival Pavilion's
// tiers (content FESTIVAL_PAVILION): procedural stand-ins in the village palette, each a recognisable silhouette from
// across the river (a striped lighthouse, a carousel, a domed library, a clock tower ...). Render-life's `town:<id>`
// models replace any of them by key. Every builder returns ONE merged geometry (world-kit), front on +z, origin at
// the footprint centre, within the 7.2 m landmark square (town-view LANDMARK_HALF). Owned by the render-world lane.
//
//   LANDMARKS[projectId]() -> BufferGeometry          the 20 M2 landmarks
//   pavilionGeometry(tier) -> BufferGeometry           the pavilion with every tier up to `tier` (1..8; more repeats 8)
//   LIGHTS[projectId] -> [[x, y, z, size], ...]        lamps and lit windows in the model's frame (the night glows)
//   PAVILION_LIGHTS(tier) -> same, for the pavilion
import * as THREE from 'three';
import { box, cyl, cone, ball, gable, flag, ring, merge, geoPart } from './world-kit.js';

const CREAM = '#F1E6CF'; const STONE = '#B8B0A2'; const STONE_D = '#9A9184'; const SLATE = '#57758A'; const TERRA = '#B5543F';
const WOOD = '#B9814A'; const WOOD_D = '#8A5A35'; const TRIM = '#7A4B2C'; const GLASS = '#FFE6A8'; const WHITE = '#F6F1E6';

/** A small low-poly bead (20 triangles): flowers, lanterns, garland blooms seen from across the river. */
const bead = (r, hex, t, o) => geoPart(new THREE.IcosahedronGeometry(r, 0), hex, t, { flat: true, ...o });
const win = (x, y, z, ry = 0, w = 0.6, h = 0.72) => [box(w + 0.12, h + 0.12, 0.06, TRIM, { x, y, z, ry }), box(w, h, 0.08, GLASS, { x, y: y + 0.06, z, ry }, { shade: false })];
const door = (x, z, col = '#6E3E2A', h = 1.9, ry = 0) => [box(1.0, h, 0.08, col, { x, z, ry }), box(1.2, 0.12, 0.3, TRIM, { x, y: h, z: z + 0.1, ry })];
/** A striped canopy: n gores from radius r at height y0 up to a point at y1. */
function canopy(n, r, y0, y1, a, b, t = {}) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2; const a1 = ((i + 1) / n) * Math.PI * 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([Math.sin(a0) * r, y0, Math.cos(a0) * r, Math.sin(a1) * r, y0, Math.cos(a1) * r, 0, y1, 0], 3));
    parts.push(geoPart(g, i % 2 ? a : b, t, { flat: true }));
  }
  return parts;
}
/** Bunting along a straight line (x0, y0, z0) -> (x1, y1, z1): little pennants in four colours. */
function bunting(x0, y0, z0, x1, y1, z1, n = 8) {
  const parts = [];
  const C = ['#D2483C', '#FFC83D', '#2BB3A3', '#4AA8E8', '#FF9FB0'];
  const len = Math.hypot(x1 - x0, z1 - z0); const ry = -Math.atan2(z1 - z0, x1 - x0);
  parts.push(box(len, 0.03, 0.03, WHITE, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 0.15, z: (z0 + z1) / 2, ry }));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n; const sag = Math.sin(t * Math.PI) * 0.3;
    parts.push(cone(0.13, 0.32, 3, C[i % C.length], { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t - 0.47 - sag, z: z0 + (z1 - z0) * t, rx: Math.PI, ry }, { shade: false }));
  }
  return parts;
}
/** A little round-crowned tree in blossom or leaf. */
const tree = (x, z, col = '#F4A6C4', s = 1) => [cyl(0.1 * s, 0.14 * s, 1.4 * s, 6, '#6E4C30', { x, z }), ball(0.85 * s, col, { x, y: 1.9 * s, z, sy: 0.85 }), bead(0.55 * s, col, { x: x + 0.45 * s, y: 1.6 * s, z: z + 0.2 * s })];
/** A villager: a simple figure in a coloured coat (the far village is seen from across the river). */
const folk = (x, z, coat, ry = 0) => [cyl(0.16, 0.22, 0.85, 6, coat, { x, z, ry }), ball(0.17, '#FFCFA0', { x, y: 1.05, z }), cone(0.2, 0.14, 6, '#5E4A3A', { x, y: 1.16, z })];

function lighthouse() {
  const parts = [ball(2.6, '#9A9184', { y: 0.2, sy: 0.45 }), ball(1.8, STONE, { x: 1.6, y: 0.1, z: 1.2, sy: 0.4 })];
  for (let i = 0; i < 5; i++) parts.push(cyl(1.15 - i * 0.09, 1.24 - i * 0.09, 2.2, 12, i % 2 ? '#D2483C' : WHITE, { y: 0.9 + i * 2.2 }));
  parts.push(cyl(1.4, 1.4, 0.16, 14, '#3C3A36', { y: 11.9 }));
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; parts.push(box(0.05, 0.6, 0.05, '#3C3A36', { x: Math.sin(a) * 1.35, y: 12.05, z: Math.cos(a) * 1.35 })); }
  parts.push(cyl(0.8, 0.8, 1.3, 10, '#FFE6A8', { y: 12.05 }, { shade: false }), cone(1.0, 1.0, 10, '#D2483C', { y: 13.35 }), ball(0.16, '#E9B83F', { y: 14.4 }));
  parts.push(...win(0, 4.6, 1.02), ...win(0, 7.8, 0.95), ...door(0, 1.13, '#2F5D6B', 1.7));
  // the keeper's cottage beside it
  parts.push(box(3.0, 2.1, 2.4, WHITE, { x: -2.6, z: 1.4 }), gable(3.4, 1.4, 2.9, '#D2483C', { x: -2.6, y: 2.1, z: 1.4 }), ...win(-2.6, 0.9, 2.62), box(0.45, 1.0, 0.45, STONE, { x: -3.5, y: 2.4, z: 1.0 }));
  return merge(parts);
}
function carousel() {
  const parts = [cyl(3.3, 3.4, 0.4, 18, '#E8DCC2'), cyl(3.35, 3.35, 0.08, 18, '#C9A04A', { y: 0.4 }), cyl(0.3, 0.3, 3.6, 10, '#C9A04A', { y: 0.4 })];
  parts.push(...canopy(12, 3.6, 3.3, 5.0, '#D2483C', '#FFF3D6'));
  for (let i = 0; i < 12; i++) { const a = ((i + 0.5) / 12) * Math.PI * 2; parts.push(cone(0.22, 0.32, 3, i % 2 ? '#FFC83D' : '#2BB3A3', { x: Math.sin(a) * 3.55, y: 3.0, z: Math.cos(a) * 3.55, rx: Math.PI, ry: a }, { shade: false })); }
  parts.push(cyl(0.05, 0.05, 1.1, 4, '#C9A04A', { y: 5.0 }), flag(0.8, 0.45, '#2BB3A3', { y: 6.1 }));
  const HC = ['#F6F1E6', '#E9B83F', '#D08A4E', '#F6F1E6', '#8E7AB8', '#E9B83F'];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2; const x = Math.sin(a) * 2.4; const z = Math.cos(a) * 2.4; const ry = a + Math.PI / 2; const y = 1.2 + (i % 2) * 0.35;
    parts.push(cyl(0.04, 0.04, 2.9, 5, '#C9A04A', { x, y: 0.45, z }));
    parts.push(box(0.9, 0.36, 0.3, HC[i], { x, y, z, ry }), box(0.18, 0.55, 0.22, HC[i], { x: x + Math.cos(-ry) * 0.42, y: y + 0.25, z: z + Math.sin(-ry) * 0.42, ry }),
      box(0.12, 0.08, 0.32, '#D2483C', { x, y: y + 0.36, z, ry }));
  }
  return merge(parts);
}
function bakery() {
  const parts = [box(5.6, 3.0, 4.4, '#F4E3C3'), box(5.8, 0.25, 4.6, STONE_D), gable(6.2, 2.0, 5.2, '#9C6A3E', { y: 3.0 })];
  parts.push(box(2.6, 1.4, 0.5, TRIM, { x: -1.0, y: 0.5, z: 2.4 }), box(2.4, 1.2, 0.52, GLASS, { x: -1.0, y: 0.6, z: 2.42 }, { shade: false }));
  for (let k = 0; k < 6; k++) parts.push(box(0.46, 0.06, 1.1, k % 2 ? WHITE : '#D2483C', { x: -2.15 + k * 0.46, y: 2.25, z: 2.75, rx: 0.5 }));
  parts.push(...door(1.6, 2.22), ...win(1.6, 1.2 + 1.2, 2.21));
  parts.push(box(0.6, 1.8, 0.6, STONE, { x: 1.8, y: 3.4, z: -0.8 }));
  // a big loaf on a bracket over the door
  parts.push(box(0.08, 0.08, 0.9, TRIM, { x: 1.6, y: 3.1, z: 2.6 }), ball(0.42, '#D9A15B', { x: 1.6, y: 2.75, z: 3.0, sx: 1.4, sy: 0.75 }));
  for (const [x, z] of [[-2.2, 3.0], [-0.5, 3.1]]) parts.push(cyl(0.3, 0.24, 0.3, 8, '#B98B4E', { x, z }), ball(0.18, '#D9A15B', { x, y: 0.35, z, sx: 1.4 }));
  return merge(parts);
}
function millpondBridge() {
  const parts = [cyl(3.4, 3.5, 0.1, 22, '#7A9A5A', { y: -0.02, sz: 0.75 }), cyl(3.1, 3.1, 0.06, 22, '#5FA7B8', { y: 0.06, sz: 0.72 }, { shade: false })];
  for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; parts.push(box(0.5, 0.18, 0.4, i % 2 ? STONE : STONE_D, { x: Math.sin(a) * 3.2, y: 0, z: Math.cos(a) * 2.4, ry: a })); }
  // the arched footbridge across the pond (along x)
  for (let i = 0; i <= 12; i++) {
    const t = i / 12; const x = -3.6 + t * 7.2; const y = 0.15 + Math.sin(t * Math.PI) * 1.1;
    parts.push(box(0.64, 0.12, 1.2, i % 2 ? WOOD : '#C99257', { x, y, rz: Math.cos(t * Math.PI) * 0.45 }));
    for (const sz of [-0.58, 0.58]) parts.push(box(0.06, 0.7, 0.06, WOOD_D, { x, y, z: sz }));
  }
  for (const sz of [-0.58, 0.58]) for (let i = 0; i < 12; i++) { const t = (i + 0.5) / 12; parts.push(box(0.66, 0.06, 0.06, WOOD_D, { x: -3.6 + t * 7.2, y: 0.85 + Math.sin(t * Math.PI) * 1.1, z: sz, rz: Math.cos(t * Math.PI) * 0.45 })); }
  for (let i = 0; i < 6; i++) parts.push(cone(0.05, 0.9, 4, '#7A9A4A', { x: -2.6 + (i % 3) * 0.3, y: 0, z: 1.6 + Math.floor(i / 3) * 0.25 }));
  parts.push(ball(0.16, WHITE, { x: 1.2, y: 0.18, z: -1.1, sx: 1.5 }), ball(0.09, WHITE, { x: 1.42, y: 0.32, z: -1.1 }), ball(0.16, '#8A6A4A', { x: 1.7, y: 0.18, z: -0.8, sx: 1.5 }));
  return merge(parts);
}
function library() {
  const parts = [box(6.4, 0.7, 5.6, STONE), box(5.8, 3.8, 4.6, '#EDE6D6', { y: 0.7, z: -0.3 }), box(6.2, 0.4, 5.0, STONE, { y: 4.5, z: -0.3 })];
  for (let i = 0; i < 4; i++) parts.push(box(3.0 - i * 0.2, 0.18, 0.5, STONE, { y: 0.52 - i * 0.18 + 0.18 * 0, z: 3.0 + i * 0.4 - 0.4 }));
  for (const x of [-1.9, -0.65, 0.65, 1.9]) parts.push(cyl(0.22, 0.26, 3.5, 10, WHITE, { x, y: 0.7, z: 2.3 }), box(0.6, 0.18, 0.6, WHITE, { x, y: 4.18, z: 2.3 }));
  parts.push(box(4.8, 0.4, 1.4, WHITE, { y: 4.2, z: 2.1 }), gable(5.0, 1.2, 1.6, WHITE, { y: 4.6, z: 2.1, ry: 0 }));
  parts.push(...door(0, 2.0, '#3C5A6B', 2.2), ...win(-2.2, 1.6, 2.0, 0, 0.6, 1.3), ...win(2.2, 1.6, 2.0, 0, 0.6, 1.3));
  parts.push(cyl(1.7, 1.8, 0.8, 16, WHITE, { y: 4.9, z: -0.6 }), ball(1.7, '#7FA7A0', { y: 5.7, z: -0.6, sy: 0.85 }), cyl(0.15, 0.2, 0.6, 8, '#C9A04A', { y: 7.1, z: -0.6 }), ball(0.18, '#C9A04A', { y: 7.8, z: -0.6 }));
  return merge(parts);
}
function flowerMarket() {
  const parts = [];
  const STRIPE = [['#D2483C', WHITE], ['#2BB3A3', WHITE], ['#FFC83D', WHITE], ['#8E7AB8', WHITE]];
  const FL = ['#FF9FB0', '#FFE27A', '#FFFFFF', '#F7A35C', '#B79BE0', '#E2483A'];
  [[-2.4, -1.4, 0.2], [2.4, -1.4, -0.2], [-2.4, 1.9, -0.1], [2.4, 1.9, 0.15]].forEach(([x, z, ry], s) => {
    parts.push(box(2.2, 0.85, 1.1, WOOD, { x, z, ry }));
    for (const [dx, dz] of [[-1.0, -0.5], [1.0, -0.5], [-1.0, 0.5], [1.0, 0.5]]) parts.push(box(0.08, 2.2, 0.08, WOOD_D, { x: x + dx, z: z + dz, ry }));
    for (let k = 0; k < 5; k++) parts.push(box(0.46, 0.05, 1.4, STRIPE[s][k % 2], { x: x - 0.92 + k * 0.46, y: 2.25, z, ry, rx: -0.25 }));
    for (let k = 0; k < 6; k++) {
      const bx = x - 0.85 + (k % 3) * 0.85; const bz = z + (k < 3 ? -0.25 : 0.25);
      parts.push(cyl(0.18, 0.15, 0.3, 7, '#8C8880', { x: bx, y: 0.85, z: bz }), bead(0.22, FL[(k + s) % FL.length], { x: bx, y: 1.25, z: bz }), bead(0.15, FL[(k + s + 2) % FL.length], { x: bx + 0.1, y: 1.4, z: bz + 0.05 }));
    }
  });
  parts.push(cyl(0.06, 0.08, 3.2, 6, '#3C3A36'), box(0.3, 0.4, 0.3, '#3C3A36', { y: 3.2 }), box(0.22, 0.3, 0.22, GLASS, { y: 3.25 }, { shade: false }));
  parts.push(...folk(0.8, 0.4, '#57758A', 0.4), ...folk(-0.9, 0.6, '#B5543F'));
  return merge(parts);
}
function postOffice() {
  const parts = [box(5.4, 4.6, 4.2, '#B5402E'), box(5.6, 0.25, 4.4, STONE), gable(5.9, 1.8, 4.9, SLATE, { y: 4.6 })];
  for (const x of [-1.6, 1.6]) for (const y of [0.9, 2.8]) parts.push(...win(x, y, 2.12));
  parts.push(...door(0, 2.12, '#2F5D6B'), box(1.6, 0.4, 0.1, CREAM, { y: 2.25, z: 2.15 }), box(1.2, 0.2, 0.12, '#D2483C', { y: 2.35, z: 2.18 }, { shade: false }));
  parts.push(box(1.0, 1.0, 0.12, CREAM, { y: 3.9, z: 2.15 }), cyl(0.38, 0.38, 0.06, 16, WHITE, { y: 4.4, z: 2.22, rx: Math.PI / 2 }, { shade: false }), box(0.04, 0.3, 0.04, '#3C3A36', { y: 4.4, z: 2.26 }));
  parts.push(cyl(0.28, 0.3, 1.3, 10, '#D2483C', { x: 2.2, z: 3.0 }), ball(0.3, '#D2483C', { x: 2.2, y: 1.3, z: 3.0, sy: 0.6 }), box(0.3, 0.06, 0.1, '#3C3A36', { x: 2.2, y: 1.0, z: 3.28 }));
  parts.push(cyl(0.05, 0.06, 5.2, 5, WHITE, { x: -2.4, z: 2.8 }), flag(1.0, 0.6, '#4AA8E8', { x: -2.4, y: 5.1, z: 2.8 }));
  return merge(parts);
}
function teaRoom() {
  const parts = [box(5.4, 2.8, 4.0, '#FBEDE6'), box(5.6, 0.25, 4.2, STONE), gable(5.9, 1.9, 4.7, '#C46B7E', { y: 2.8 })];
  parts.push(box(2.4, 1.5, 0.9, WHITE, { x: -1.0, y: 0.25, z: 2.3 }), box(2.2, 1.2, 0.92, GLASS, { x: -1.0, y: 0.45, z: 2.31 }, { shade: false }), box(2.5, 0.12, 1.0, '#C46B7E', { x: -1.0, y: 1.75, z: 2.3 }));
  for (let k = 0; k < 6; k++) parts.push(box(0.5, 0.05, 0.9, k % 2 ? WHITE : '#F4A6C4', { x: -1.25 + k * 0.5 + 1.6, y: 2.25, z: 2.45, rx: 0.5 }));
  parts.push(...door(1.6, 2.02, '#C46B7E'));
  for (const [x, z] of [[-2.1, 3.9], [0.1, 4.1], [2.2, 3.6]]) {
    parts.push(cyl(0.35, 0.35, 0.05, 10, WHITE, { x, y: 0.72, z }), cyl(0.04, 0.05, 0.72, 5, TRIM, { x, z }), cyl(0.03, 0.03, 2.0, 4, '#E8DCC2', { x, z }));
    parts.push(...canopy(8, 1.1, 1.95, 2.35, '#F4A6C4', WHITE, { x, z }));
  }
  return merge(parts);
}
function clockSquare() {
  const parts = [cyl(4.0, 4.0, 0.06, 20, '#C9C0AE', {}, { shade: false })];
  for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; parts.push(box(0.6, 0.08, 0.3, STONE_D, { x: Math.sin(a) * 3.85, y: 0.02, z: Math.cos(a) * 3.85, ry: a }, { shade: false })); }
  parts.push(box(1.9, 0.5, 1.9, STONE_D), box(1.6, 7.6, 1.6, '#E8DCC2', { y: 0.5 }), box(1.8, 0.25, 1.8, STONE, { y: 8.1 }));
  for (const [ry, dx, dz] of [[0, 0, 0.81], [Math.PI / 2, 0.81, 0], [Math.PI, 0, -0.81], [-Math.PI / 2, -0.81, 0]]) {
    parts.push(cyl(0.6, 0.6, 0.06, 16, WHITE, { x: dx, y: 7.2, z: dz, rx: Math.PI / 2, ry }, { shade: false }), box(0.05, 0.42, 0.05, '#3C3A36', { x: dx * 1.04, y: 7.05, z: dz * 1.04, ry }),
      box(0.3, 0.05, 0.05, '#3C3A36', { x: dx * 1.04, y: 7.2, z: dz * 1.04, ry }));
    parts.push(...win(dx * 1.0, 3.2, dz * 1.0, ry, 0.4, 1.0));
  }
  parts.push(cone(1.4, 2.4, 4, SLATE, { y: 8.35, ry: Math.PI / 4 }), ball(0.16, '#C9A04A', { y: 10.8 }));
  for (const [x, z, ry] of [[-2.8, 1.2, 0.4], [2.8, 1.2, -0.4]]) parts.push(box(1.6, 0.1, 0.45, WOOD, { x, y: 0.45, z, ry }), box(1.6, 0.4, 0.08, WOOD, { x, y: 0.55, z: z - 0.2, ry }));
  for (const [x, z] of [[-2.6, -2.4], [2.6, -2.4]]) parts.push(cyl(0.5, 0.4, 0.5, 8, STONE, { x, z }), ball(0.45, '#5E8C45', { x, y: 0.7, z }), ball(0.12, '#FF9FB0', { x: x + 0.2, y: 1.0, z }));
  return merge(parts);
}
function watermill() {
  const parts = [box(4.6, 3.2, 4.0, '#E6D2B5', { x: -0.6 }), box(4.8, 0.3, 4.2, STONE_D, { x: -0.6 }), gable(5.2, 2.0, 4.7, '#9C6A3E', { x: -0.6, y: 3.2 })];
  parts.push(...door(-1.2, 2.02), ...win(0.6, 1.4, 2.02), box(0.5, 1.4, 0.5, STONE, { x: -2.2, y: 3.6, z: -0.6 }));
  // the race and the wheel on the east wall
  parts.push(box(1.4, 0.08, 6.4, '#5FA7B8', { x: 2.4, y: 0.02 }, { shade: false }), box(0.2, 0.4, 6.4, STONE, { x: 1.6 }), box(0.2, 0.4, 6.4, STONE, { x: 3.2 }));
  parts.push(geoPart(new THREE.TorusGeometry(1.5, 0.1, 5, 16), WOOD_D, { x: 2.4, y: 1.6, rz: 0, ry: Math.PI / 2 }));
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; parts.push(box(0.5, 0.08, 0.6, WOOD, { x: 2.4, y: 1.6 + Math.sin(a) * 1.5, z: Math.cos(a) * 1.5, rx: a })); }
  parts.push(cyl(0.12, 0.12, 1.0, 8, '#3C3A36', { x: 2.4 - 0.5, y: 1.6, rz: Math.PI / 2 }));
  return merge(parts);
}
function boathouse() {
  const parts = [box(5.0, 0.25, 6.4, WOOD_D, { z: 0.6 })];
  for (const x of [-2.3, 2.3]) for (const z of [-2.4, 0.6, 3.6]) parts.push(cyl(0.14, 0.16, 2.4, 6, WOOD_D, { x, y: -2.2, z }));
  parts.push(box(0.2, 2.8, 5.6, '#4E7A8A', { x: -2.4, z: 0.2 }), box(0.2, 2.8, 5.6, '#4E7A8A', { x: 2.4, z: 0.2 }), box(5.0, 2.8, 0.2, '#4E7A8A', { z: -2.6 }));
  parts.push(gable(5.6, 2.0, 6.2, '#F1E6CF', { y: 2.8, z: 0.2, ry: Math.PI / 2 }));
  parts.push(box(3.0, 2.2, 0.06, '#2F5D6B', { y: 0.25, z: 3.0 }), box(5.0, 0.6, 0.2, '#4E7A8A', { y: 2.4, z: 3.0 }));
  for (let k = 0; k < 5; k++) parts.push(box(0.08, 2.2, 0.08, WHITE, { x: -1.5 + k * 0.75, y: 0.25, z: 3.05 }));
  // two rowing boats moored on the water in front
  for (const [x, c] of [[-1.4, '#D2483C'], [1.5, '#2F8C86']]) {
    parts.push(ball(0.55, c, { x, y: -0.35, z: 4.9, sx: 0.7, sy: 0.4, sz: 2.2 }), box(0.7, 0.05, 2.2, WOOD, { x, y: -0.1, z: 4.9 }));
  }
  parts.push(box(3.2, 0.12, 1.4, WOOD, { y: 0.1, z: 3.8 }));
  return merge(parts);
}
function villageGreen() {
  const parts = [cyl(4.2, 4.2, 0.04, 22, '#7CB04A', {}, { shade: false })];
  parts.push(cyl(0.1, 0.14, 5.4, 8, WHITE), ball(0.2, '#C9A04A', { y: 5.5 }));
  const RC = ['#D2483C', '#FFC83D', '#2BB3A3', '#4AA8E8', '#FF9FB0', '#8E7AB8'];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const x = Math.sin(a) * 2.2; const z = Math.cos(a) * 2.2; const len = Math.hypot(2.2, 5.0); parts.push(box(0.05, len, 0.12, RC[i], { x: x / 2, y: 0.35, z: z / 2, rx: Math.cos(a) * 0.42, rz: -Math.sin(a) * 0.42 }, { shade: false })); }
  parts.push(geoPart(new THREE.TorusGeometry(0.5, 0.1, 5, 12), '#5E8C45', { y: 4.9, rx: Math.PI / 2 }));
  // cricket stumps and a picnic blanket, a bench
  for (const dx of [-0.15, 0, 0.15]) parts.push(box(0.04, 0.7, 0.04, '#F1E6CF', { x: 3.0 + dx, z: -2.4 }));
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) parts.push(box(0.4, 0.03, 0.4, (i + j) % 2 ? WHITE : '#4AA8E8', { x: -2.8 + i * 0.4, z: 2.2 + j * 0.4 }, { shade: false }));
  parts.push(box(1.8, 0.1, 0.45, WOOD, { x: 2.8, y: 0.45, z: 2.4, ry: -0.5 }), ...folk(-1.0, 1.4, '#B5543F'), ...folk(1.2, -1.4, '#2BB3A3', 1));
  return merge(parts);
}
function musicHall() {
  const parts = [box(6.4, 4.4, 5.0, '#E6D2B5', { z: -0.4 }), box(6.6, 0.3, 5.2, STONE_D, { z: -0.4 })];
  parts.push(box(6.6, 1.2, 0.4, '#C9A04A', { y: 4.4, z: 2.0 }), cyl(1.9, 1.9, 0.35, 16, '#E6D2B5', { y: 3.6, z: 2.0, rx: Math.PI / 2 }, { flat: false }));
  parts.push(gable(6.9, 2.2, 5.6, '#8E3B5E', { y: 4.4, z: -0.4 }));
  parts.push(box(2.4, 2.6, 0.1, '#5E2A3E', { y: 0.3, z: 2.12 }), box(3.6, 0.6, 0.14, '#3C3A36', { y: 3.1, z: 2.15 }), box(3.3, 0.36, 0.16, '#FFE27A', { y: 3.22, z: 2.17 }, { shade: false }));
  for (let k = 0; k < 9; k++) parts.push(bead(0.09, ['#FFE27A', '#FF7A6B', '#4AA8E8'][k % 3], { x: -1.6 + k * 0.4, y: 3.85, z: 2.22 }, { shade: false }));
  for (const x of [-2.6, 2.6]) parts.push(box(0.8, 1.2, 0.06, ['#FFC83D', '#2BB3A3'][x > 0 ? 1 : 0], { x, y: 1.0, z: 2.13 }, { shade: false }), ...win(x, 2.9, 2.12, 0, 0.7, 0.9));
  return merge(parts);
}
function harbourInn() {
  const parts = [box(5.6, 4.8, 4.4, '#F1E6CF'), box(5.8, 0.3, 4.6, STONE_D), gable(6.1, 2.2, 5.1, '#2F5D6B', { y: 4.8 })];
  for (let k = 0; k < 5; k++) parts.push(box(0.12, 4.8, 0.06, TRIM, { x: -2.7 + k * 1.35, z: 2.22 }));
  parts.push(box(5.6, 0.14, 0.08, TRIM, { y: 2.4, z: 2.22 }));
  for (const x of [-1.9, 1.9]) for (const y of [0.9, 3.1]) parts.push(...win(x, y, 2.24));
  parts.push(...door(0, 2.24, '#5A3A2A', 2.1), ...win(0, 3.1, 2.24));
  parts.push(box(1.2, 0.08, 0.08, '#3C3A36', { x: 3.3, y: 3.0, z: 2.0 }), box(0.9, 0.7, 0.06, '#C9A04A', { x: 3.6, y: 2.2, z: 2.0 }), ball(0.2, '#2F5D6B', { x: 3.6, y: 2.55, z: 2.06, sx: 1.5 }));
  parts.push(box(0.6, 2.0, 0.6, STONE, { x: -1.8, y: 5.2, z: -0.8 }));
  for (const [x, z] of [[-2.4, 3.2], [2.0, 3.4]]) parts.push(box(1.6, 0.1, 0.45, WOOD, { x, y: 0.45, z }), cyl(0.3, 0.3, 0.7, 8, WOOD_D, { x: x + 1.2, z: z + 0.3 }));
  return merge(parts);
}
function observatory() {
  const parts = [cyl(2.6, 2.8, 3.6, 16, '#E8DCC2'), cyl(2.8, 2.8, 0.25, 16, STONE, { y: 3.6 })];
  parts.push(ball(2.5, '#C9D2DA', { y: 3.8, sy: 0.9 }));
  parts.push(box(0.9, 2.2, 0.4, '#3C3A36', { y: 4.8, z: 1.7, rx: -0.45 }, { shade: false }), cyl(0.28, 0.35, 2.6, 10, '#8C8880', { y: 5.4, z: 1.2, rx: -0.9 }));
  parts.push(...door(0, 2.62, '#3C5A6B'), ...win(1.8, 1.6, 1.85, 0.75), ...win(-1.8, 1.6, 1.85, -0.75));
  for (let i = 0; i < 4; i++) parts.push(box(1.6 - i * 0.2, 0.15, 0.5, STONE, { y: i * 0.15, z: 3.0 + (3 - i) * 0.35 - 0.6 }));
  return merge(parts);
}
function craftHall() {
  const parts = [box(7.0, 3.0, 4.2, '#D9C6A5'), box(7.2, 0.3, 4.4, STONE_D)];
  for (let k = 0; k < 4; k++) parts.push(gable(1.75, 1.3, 4.6, k % 2 ? '#9C6A3E' : '#B5543F', { x: -2.625 + k * 1.75, y: 3.0, ry: Math.PI / 2 }));
  for (const x of [-2.4, -0.8, 0.8, 2.4]) parts.push(...win(x, 1.3, 2.12, 0, 0.9, 0.9));
  parts.push(box(1.6, 2.2, 0.08, '#6E3E2A', { x: 0, z: 2.12 }));
  for (const [x, z] of [[-3.0, 3.0], [-2.3, 3.2], [2.8, 3.1]]) parts.push(cyl(0.32, 0.3, 0.7, 8, WOOD_D, { x, z }));
  for (const [x, z, c] of [[1.6, 3.2, TERRA], [2.0, 3.4, '#C8643A'], [1.3, 3.5, '#D9A15B']]) parts.push(cyl(0.2, 0.26, 0.45, 8, c, { x, z }));
  for (let k = 0; k < 4; k++) parts.push(box(2.4, 0.2, 0.22, k % 2 ? WOOD : '#C99257', { x: -0.4, y: 0.1 + Math.floor(k / 2) * 0.22, z: 3.2 + (k % 2) * 0.24 }));
  return merge(parts);
}
function glasshouseGarden() {
  const parts = [box(7.0, 0.5, 4.6, STONE)];
  parts.push(box(6.8, 2.6, 4.4, '#BFE3EA', { y: 0.5 }, { shade: false }));
  for (let k = 0; k <= 8; k++) parts.push(box(0.08, 2.6, 4.45, WHITE, { x: -3.4 + k * 0.85, y: 0.5 }), box(0.08, 2.6, 0.08, WHITE, { x: -3.4 + k * 0.85, y: 0.5, z: 2.22 }));
  const roof = new THREE.CylinderGeometry(2.25, 2.25, 6.9, 12, 1, true, -Math.PI / 2, Math.PI);
  roof.rotateZ(Math.PI / 2);
  parts.push(geoPart(roof, '#CFEAF0', { y: 3.1 }, { flat: true }));
  for (let k = 0; k <= 4; k++) parts.push(geoPart(new THREE.TorusGeometry(2.27, 0.05, 4, 12, Math.PI), WHITE, { x: -3.4 + k * 1.7, y: 3.1, ry: Math.PI / 2 }));
  for (const [x, z] of [[-2.0, -0.6], [0.4, 0.5], [2.2, -0.4]]) parts.push(cyl(0.1, 0.12, 2.6, 6, '#8A6A4A', { x, y: 0.5, z }), ...ring(6, (i, a) => cone(0.25, 1.4, 3, '#4E8A3A', { x: x + Math.sin(a) * 0.55, y: 3.0, z: z + Math.cos(a) * 0.55, rx: Math.cos(a) * 1.1, rz: -Math.sin(a) * 1.1 })));
  parts.push(ball(0.22, '#F7A35C', { x: 0.6, y: 2.5, z: 0.4 }), ball(0.2, '#F7A35C', { x: 0.2, y: 2.7, z: 0.7 }));
  return merge(parts);
}
function skatingPond() {
  const parts = [cyl(4.0, 4.0, 0.12, 24, '#E8E4DA', { sz: 0.7 }), cyl(3.6, 3.6, 0.05, 24, '#BFE0EA', { y: 0.1, sz: 0.7 }, { shade: false })];
  for (let i = 0; i < 4; i++) parts.push(box(1.2, 0.02, 0.04, WHITE, { x: -1 + i * 0.6, y: 0.16, z: -0.4 + i * 0.3, ry: i * 0.7 }, { shade: false }));
  parts.push(box(2.0, 1.8, 1.6, '#B5543F', { x: -3.2, z: -2.6 }), gable(2.3, 1.0, 1.9, WHITE, { x: -3.2, y: 1.8, z: -2.6 }), ...win(-3.2, 0.8, -1.79));
  for (const [x, z] of [[2.9, -2.5], [3.6, 0.0]]) parts.push(box(1.4, 0.1, 0.4, WOOD, { x, y: 0.45, z, ry: 1.2 }));
  for (const [x, z] of [[-3.8, 1.6], [3.6, 2.2], [0, -3.2]]) parts.push(cyl(0.05, 0.06, 2.2, 5, '#3C3A36', { x, z }), box(0.28, 0.34, 0.28, GLASS, { x, y: 2.1, z }, { shade: false }));
  parts.push(...folk(0.5, 0.3, '#D2483C', 0.5), ...folk(-0.8, -0.6, '#4AA8E8', 2));
  return merge(parts);
}
function orchardWalk() {
  const parts = [box(1.6, 0.03, 7.2, '#D8B98A', {}, { shade: false })];
  for (let i = 0; i < 4; i++) for (const sx of [-1.7, 1.7]) parts.push(...tree(sx, -2.8 + i * 1.9, i % 2 ? '#F4A6C4' : '#FBD3E2', 0.8));
  // the arbour at the walk's start
  for (const sx of [-0.9, 0.9]) parts.push(box(0.12, 2.4, 0.12, WHITE, { x: sx, z: 3.4 }));
  parts.push(geoPart(new THREE.TorusGeometry(0.9, 0.07, 4, 12, Math.PI), WHITE, { y: 2.4, z: 3.4 }));
  for (let k = 0; k < 7; k++) { const a = (k / 6) * Math.PI; parts.push(bead(0.17, k % 2 ? '#FF9FB0' : '#FFFFFF', { x: Math.cos(a) * 0.92, y: 2.4 + Math.sin(a) * 0.92, z: 3.45 })); }
  return merge(parts);
}
function festivalArch() {
  const parts = [];
  for (const sx of [-3.0, 3.0]) parts.push(box(0.8, 5.0, 0.8, STONE, { x: sx }), box(1.0, 0.3, 1.0, STONE_D, { x: sx, y: 5.0 }), cone(0.5, 0.8, 4, '#C9A04A', { x: sx, y: 5.3, ry: Math.PI / 4 }));
  parts.push(geoPart(new THREE.TorusGeometry(3.0, 0.32, 6, 18, Math.PI), STONE, { y: 4.6 }));
  parts.push(box(4.0, 0.8, 0.2, '#2F5D6B', { y: 6.6 }), box(3.7, 0.5, 0.22, '#FFC83D', { y: 6.75 }, { shade: false }));
  for (let k = 0; k < 9; k++) { const a = (k / 8) * Math.PI; parts.push(bead(0.2, ['#FF7A6B', '#FFE27A', '#4AA8E8'][k % 3], { x: Math.cos(a) * 3.0, y: 4.6 + Math.sin(a) * 3.0 - 0.45, z: 0.35 }, { shade: false })); }
  parts.push(...bunting(-3.0, 4.7, 0.5, -6.5, 3.2, 0.5, 5), ...bunting(3.0, 4.7, 0.5, 6.5, 3.2, 0.5, 5));
  for (const sx of [-6.5, 6.5]) parts.push(cyl(0.06, 0.07, 3.3, 5, WOOD_D, { x: sx, z: 0.5 }));
  return merge(parts);
}

export const LANDMARKS = Object.freeze({
  lighthouse, village_carousel: carousel, village_bakery: bakery, millpond_bridge: millpondBridge, library, flower_market: flowerMarket,
  post_office: postOffice, tea_room: teaRoom, clock_square: clockSquare, watermill, boathouse, village_green: villageGreen, music_hall: musicHall,
  harbour_inn: harbourInn, observatory, craft_hall: craftHall, glasshouse_garden: glasshouseGarden, skating_pond: skatingPond,
  orchard_walk: orchardWalk, festival_arch: festivalArch,
});
/** Lit windows and lamps of each landmark in its own frame [x, y, z, size] (the village glows at night). */
export const LIGHTS = Object.freeze({
  lighthouse: [[0, 12.6, 0, 4.2], [0, 4.6, 1.1, 1.4], [-2.6, 0.9, 2.7, 1.4]], village_carousel: [[0, 3.2, 3.6, 1.6], [0, 3.2, -3.6, 1.6], [3.6, 3.2, 0, 1.6], [-3.6, 3.2, 0, 1.6]],
  village_bakery: [[-1.0, 1.2, 2.7, 2.2], [1.6, 2.4, 2.3, 1.4]], library: [[-2.2, 2.2, 2.1, 1.6], [2.2, 2.2, 2.1, 1.6], [0, 1.2, 2.2, 1.6]], flower_market: [[0, 3.25, 0, 1.6]],
  post_office: [[-1.6, 1.3, 2.2, 1.4], [1.6, 1.3, 2.2, 1.4], [0, 4.4, 2.3, 1.3]], tea_room: [[-1.0, 1.0, 2.8, 2.2]], clock_square: [[0, 7.2, 0.9, 1.6], [0, 7.2, -0.9, 1.6]],
  watermill: [[0.6, 1.8, 2.1, 1.4]], boathouse: [[0, 2.6, 3.2, 1.6]], music_hall: [[0, 3.25, 2.3, 3.0], [-2.6, 2.9, 2.2, 1.3], [2.6, 2.9, 2.2, 1.3]],
  harbour_inn: [[-1.9, 1.3, 2.3, 1.4], [1.9, 1.3, 2.3, 1.4], [0, 3.5, 2.3, 1.4], [3.6, 2.3, 2.1, 1.3]], observatory: [[0, 4.8, 1.8, 1.6]], craft_hall: [[-0.8, 1.7, 2.2, 1.5], [0.8, 1.7, 2.2, 1.5]],
  glasshouse_garden: [[0, 1.8, 2.3, 3.2]], skating_pond: [[-3.8, 2.1, 1.6, 1.4], [3.6, 2.1, 2.2, 1.4], [0, 2.1, -3.2, 1.4]], orchard_walk: [[0, 2.4, 3.5, 1.4]],
  festival_arch: [[0, 7.5, 0.4, 2.0], [-3, 6.0, 0.5, 1.3], [3, 6.0, 0.5, 1.3]], millpond_bridge: [[0, 1.6, 0.6, 1.2]], village_green: [],
});

// ---------------------------------------------------------------------------------------------------
// The Festival Pavilion on the village green (content FESTIVAL_PAVILION.tiers): each tier adds its part
export const PAVILION_TIERS = 8;
export function pavilionGeometry(tier) {
  const t = Math.max(1, Math.min(PAVILION_TIERS, tier | 0));
  const parts = [];
  const PW = 8.4; const PD = 6.2; const PH = 3.6;
  const posts = [];
  for (const sx of [-1, -1 / 3, 1 / 3, 1]) for (const sz of [-1, 1]) posts.push([sx * PW / 2, sz * PD / 2]);
  // 1: the frame: posts and beams on a low stone plinth
  parts.push(box(PW + 0.8, 0.3, PD + 0.8, STONE));
  for (const [x, z] of posts) parts.push(box(0.26, PH, 0.26, t >= 6 ? WHITE : WOOD, { x, y: 0.3, z }));
  for (const sz of [-1, 1]) parts.push(box(PW + 0.3, 0.26, 0.26, WOOD_D, { y: 0.3 + PH, z: sz * PD / 2 }));
  for (const sx of [-1, 1]) parts.push(box(0.26, 0.26, PD + 0.3, WOOD_D, { x: sx * PW / 2, y: 0.3 + PH }));
  parts.push(box(PW + 0.3, 0.2, 0.2, WOOD_D, { y: 0.3 + PH + 1.6 }));
  for (const sx of [-1, -1 / 3, 1 / 3, 1]) for (const sz of [-1, 1]) parts.push(box(0.16, 0.16, Math.hypot(PD / 2, 1.6) + 0.1, WOOD_D, { x: sx * PW / 2, y: 0.3 + PH + 0.8, z: sz * PD / 4, rx: sz * Math.atan2(1.6, PD / 2) }));
  // 4: the dance floor of oak boards
  if (t >= 4) for (let k = 0; k < 14; k++) parts.push(box(PW - 0.2, 0.06, PD / 14 - 0.02, k % 2 ? '#C99257' : '#B9814A', { y: 0.3, z: -PD / 2 + (k + 0.5) * PD / 14 }));
  // 3: the lantern roof: a canvas roof in cream and red with rows of paper lanterns under its eaves
  if (t >= 3) {
    for (let k = 0; k < 10; k++) for (const sz of [-1, 1]) parts.push(box(PW / 10 + 0.02, 0.06, Math.hypot(PD / 2, 1.6) + 0.5, k % 2 ? '#FFF3D6' : '#D2483C', { x: -PW / 2 + (k + 0.5) * PW / 10, y: 0.3 + PH + 0.95, z: sz * PD / 4, rx: sz * Math.atan2(1.6, PD / 2) }));
    const LC = ['#FF7A6B', '#FFE27A', '#FFB347', '#F4A6C4'];
    for (let k = 0; k < 9; k++) for (const sz of [-1, 1]) parts.push(cyl(0.02, 0.02, 0.35, 4, '#3C3A36', { x: -PW / 2 + 0.4 + k * (PW - 0.8) / 8, y: 0.3 + PH - 0.35, z: sz * (PD / 2 - 0.1) }),
      bead(0.23, LC[(k + (sz > 0 ? 1 : 0)) % 4], { x: -PW / 2 + 0.4 + k * (PW - 0.8) / 8, y: 0.3 + PH - 0.55, z: sz * (PD / 2 - 0.1), sy: 1.25 }, { shade: false }));
  }
  // 2: bunting between the posts and pennants along the ridge
  if (t >= 2) {
    for (const sz of [-1, 1]) for (let k = 0; k < 3; k++) {
      const x0 = -PW / 2 + k * PW / 3;
      parts.push(...bunting(x0, 0.3 + PH - 0.1, sz * PD / 2, x0 + PW / 3, 0.3 + PH - 0.1, sz * PD / 2, 5));
    }
    for (let k = 0; k < 7; k++) parts.push(flag(0.5, 0.32, ['#D2483C', '#FFC83D', '#2BB3A3', '#4AA8E8'][k % 4], { x: -PW / 2 + 0.6 + k * (PW - 1.2) / 6, y: 0.3 + PH + 2.3 }));
    for (let k = 0; k < 7; k++) parts.push(cyl(0.025, 0.025, 0.7, 4, '#E8DCC2', { x: -PW / 2 + 0.6 + k * (PW - 1.2) / 6, y: 0.3 + PH + 1.6 }));
  }
  // 5: the bandstand wing: a raised stage on the east side with music stands and a little roof
  if (t >= 5) {
    parts.push(box(2.6, 0.8, 3.6, WOOD, { x: PW / 2 + 1.7 }), box(2.8, 0.1, 3.8, WOOD_D, { x: PW / 2 + 1.7, y: 0.8 }));
    for (const sz of [-1.6, 1.6]) parts.push(box(0.16, 2.8, 0.16, WHITE, { x: PW / 2 + 2.9, y: 0.8, z: sz }));
    parts.push(gable(3.0, 1.0, 4.0, '#2F5D6B', { x: PW / 2 + 1.7, y: 3.6, ry: Math.PI / 2 }));
    for (const z of [-0.9, 0, 0.9]) parts.push(cyl(0.02, 0.02, 1.0, 4, '#3C3A36', { x: PW / 2 + 1.3, y: 0.9, z }), box(0.35, 0.25, 0.04, '#3C3A36', { x: PW / 2 + 1.3, y: 1.9, z, ry: Math.PI / 2 }));
    parts.push(...folk(PW / 2 + 2.1, -0.6, '#2F5D6B'), ...folk(PW / 2 + 2.1, 0.7, '#D2483C'));
  }
  // 6: flower garlands swagged between the (now white) posts and wound up them
  if (t >= 6) {
    const FL = ['#FF9FB0', '#FFFFFF', '#FFE27A', '#F4A6C4', '#B79BE0'];
    for (const [x, z] of posts) for (let k = 0; k < 5; k++) parts.push(bead(0.14, FL[(k + Math.round(x * 3)) % 5], { x: x + Math.sin(k * 2.1) * 0.18, y: 0.6 + k * 0.6, z: z + Math.cos(k * 2.1) * 0.18 }));
    for (const sz of [-1, 1]) for (let k = 0; k < 18; k++) { const tt = (k + 0.5) / 18; parts.push(bead(0.13, FL[k % 5], { x: -PW / 2 + tt * PW, y: 0.3 + PH - 0.3 - Math.sin((tt * 3 % 1) * Math.PI) * 0.45, z: sz * (PD / 2 + 0.08) })); }
  }
  // 7: the festival bell in a cupola on the ridge
  if (t >= 7) {
    parts.push(box(1.3, 0.2, 1.3, WOOD_D, { y: 0.3 + PH + 1.7 }));
    for (const [sx, sz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) parts.push(box(0.1, 1.2, 0.1, WHITE, { x: sx, y: 0.3 + PH + 1.9, z: sz }));
    parts.push(cone(0.42, 0.55, 10, '#C9A04A', { y: 0.3 + PH + 2.35, rx: Math.PI }), cone(1.0, 0.9, 4, '#2F5D6B', { y: 0.3 + PH + 3.1, ry: Math.PI / 4 }));
  }
  // 8: the golden weathervane, a rooster on the top pointing at the farm
  if (t >= 8) {
    const y = 0.3 + PH + (t >= 7 ? 4.0 : 2.0);
    parts.push(cyl(0.035, 0.035, 1.1, 5, '#C9A04A', { y }), box(1.0, 0.04, 0.04, '#C9A04A', { y: y + 0.6 }), box(0.04, 0.04, 1.0, '#C9A04A', { y: y + 0.6 }));
    parts.push(ball(0.22, '#E9B83F', { y: y + 1.25, sx: 1.4 }), ball(0.12, '#E9B83F', { x: 0.25, y: y + 1.45 }), cone(0.06, 0.12, 4, '#D2483C', { x: 0.25, y: y + 1.55 }),
      cone(0.2, 0.4, 4, '#E9B83F', { x: -0.3, y: y + 1.3, rz: 0.8 }));
  }
  return merge(parts);
}
/** The pavilion's glows: the lantern roof (tier 3+) glows across the river, and the bell cupola (7+). */
export function PAVILION_LIGHTS(tier) {
  const out = [];
  if (tier >= 3) for (let k = 0; k < 5; k++) for (const sz of [-1, 1]) out.push([-3.6 + k * 1.8, 3.35, sz * 3.0, 1.6]);
  if (tier >= 5) out.push([6.0, 2.6, 0, 1.8]);
  return out;
}
