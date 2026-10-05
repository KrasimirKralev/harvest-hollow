// A small procedural kit for the world places (render-world, wave 2): boxes, cylinders, cones, gable roofs and
// flags merged into ONE geometry with the canonical static attribute set (position, normal, colour in LINEAR rgb,
// sway), so a stand-in drops into any static BatchedMesh beside the real models. The real art comes from
// render-life's manifest keys (prop:barge, town:chapel, restore:greenhouse:2 ...); `modelKey()` uses a key when the
// manifest has it and otherwise defines our stand-in under `hh:<key>`, so a place never shows as a grey box.
//
//   lin(hex) -> [r, g, b] linear          box/cyl/cone/ball/gable/flag(dims..., hex, t?, opts?) -> part
//   t = { x, y, z, rx, ry, rz, sx, sy, sz }   opts = { flat = true, sway = 0 | fn(x, y, z) (the part's own coordinates,
//   before t), shade = true }
//   merge(parts) -> BufferGeometry           modelKey(batch, key, fallback) -> { key, bounds: Box3 }
//   ring(n, fn(i, a)) -> parts               spread parts round a circle
import * as THREE from 'three';
import { models } from './models.js';

const tc = new THREE.Color();
export const lin = (hex) => { tc.set(hex); return [tc.r, tc.g, tc.b]; };
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const s = new THREE.Vector3();

function place(g, t = {}) {
  e.set(t.rx || 0, t.ry || 0, t.rz || 0, 'YXZ');
  q.setFromEuler(e);
  m4.compose(v.set(t.x || 0, t.y || 0, t.z || 0), q, s.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1));
  g.applyMatrix4(m4);
  return g;
}

function part(g, hex, t, { flat = true, sway = 0, shade = true } = {}) {
  // merge() lays vertices out in order, so every part is non-indexed (smooth parts keep their generated normals)
  let geo = g;
  if (geo.index) geo = geo.toNonIndexed();
  geo.deleteAttribute('uv');
  // a sway function reads the part's own (untransformed) coordinates: a flag sways at its free end wherever it hangs
  if (typeof sway === 'function') {
    const P = geo.getAttribute('position');
    const w = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) w[i] = sway(P.getX(i), P.getY(i), P.getZ(i));
    geo.setAttribute('hhSway', new THREE.BufferAttribute(w, 1));
  }
  place(geo, t);
  if (flat) geo.computeVertexNormals();
  return { g: geo, c: Array.isArray(hex) ? hex : lin(hex), sway, shade };
}

/** A box w x h x d sitting on y = 0 (before the transform). */
export const box = (w, h, d, hex, t, o) => part(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), hex, t, o);
/** A cylinder (rTop, rBottom, height) standing on y = 0. */
export const cyl = (rt, rb, h, seg, hex, t, o) => part(new THREE.CylinderGeometry(rt, rb, h, seg).translate(0, h / 2, 0), hex, t, { flat: false, ...o });
/** A cone of radius r and height h standing on y = 0. */
export const cone = (r, h, seg, hex, t, o) => part(new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0), hex, t, o);
/** A low-poly ball centred on the origin. */
export const ball = (r, hex, t, o) => part(new THREE.IcosahedronGeometry(r, 1), hex, t, { flat: false, ...o });

/** Any BufferGeometry as a part (smooth normals kept; a custom shape such as an open, flared ring). */
export const geoPart = (g, hex, t, o) => part(g, hex, t, { flat: false, ...o });

/** A gable roof: a triangular prism w (along x, the ridge) x d (along z) x h, eaves on y = 0. */
export function gable(w, h, d, hex, t, o) {
  const hw = w / 2; const hd = d / 2;
  const p = [
    -hw, 0, hd, hw, 0, hd, hw, h, 0, -hw, 0, hd, hw, h, 0, -hw, h, 0,          // front slope
    hw, 0, -hd, -hw, 0, -hd, -hw, h, 0, hw, 0, -hd, -hw, h, 0, hw, h, 0,       // back slope
    -hw, 0, -hd, -hw, 0, hd, -hw, h, 0, hw, 0, hd, hw, 0, -hd, hw, h, 0,       // gable ends
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return part(g, hex, t, o);
}

/** A triangular pennant / flag in the x-y plane (pole at x = 0), swaying at its free end. */
export function flag(w, h, hex, t, { sway = 1.4, ...o } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, w, -h / 2, 0, 0, -h, 0, 0, 0, 0, 0, -h, 0, w, -h / 2, 0], 3));
  return part(g, hex, t, { sway: (x) => Math.max(0, x) / w * sway, shade: false, ...o });
}

/** n parts round a circle: fn(i, angle) -> part | part[] */
export function ring(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) { const r = fn(i, (i / n) * Math.PI * 2); if (Array.isArray(r)) out.push(...r); else if (r) out.push(r); }
  return out;
}

/** Merge parts into one geometry with the canonical static attribute set. */
export function merge(parts) {
  let nv = 0;
  for (const p of parts) nv += p.g.getAttribute('position').count;
  const pos = new Float32Array(nv * 3); const nor = new Float32Array(nv * 3); const col = new Float32Array(nv * 3); const sw = new Float32Array(nv);
  let o = 0;
  for (const p of parts) {
    const P = p.g.getAttribute('position');
    if (!p.g.getAttribute('normal')) p.g.computeVertexNormals();
    const NN = p.g.getAttribute('normal');
    const SW = p.g.getAttribute('hhSway');
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
      pos[(o + i) * 3] = x; pos[(o + i) * 3 + 1] = y; pos[(o + i) * 3 + 2] = z;
      const ny = NN.getY(i);
      nor[(o + i) * 3] = NN.getX(i); nor[(o + i) * 3 + 1] = ny; nor[(o + i) * 3 + 2] = NN.getZ(i);
      // painted look: lit tops, quieter sides, dark undersides
      const k = p.shade ? (ny > 0.5 ? 1.05 : ny < -0.5 ? 0.68 : 0.9) : 1;
      col[(o + i) * 3] = p.c[0] * k; col[(o + i) * 3 + 1] = p.c[1] * k; col[(o + i) * 3 + 2] = p.c[2] * k;
      sw[o + i] = SW ? SW.getX(i) : typeof p.sway === 'number' ? p.sway : 0;
    }
    o += P.count;
  }
  const idx = nv > 65535 ? new Uint32Array(nv) : new Uint16Array(nv);
  for (let i = 0; i < nv; i++) idx[i] = i;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const made = new Map();          // key -> geometry (stand-ins are built once per page)
/**
 * The model to draw for `key` in `batch`: render-life's when the manifest has it, else our stand-in (built by
 * `fallback()` once and defined in the batch under `hh:<key>`). Returns the key to add and its model-space bounds.
 */
export function modelKey(batch, key, fallback) {
  if (models.has(key)) return { key, bounds: models.boundsOf(key), real: true };
  let g = made.get(key);
  if (!g) { g = fallback(); made.set(key, g); }
  batch.define(`hh:${key}`, g);
  return { key: `hh:${key}`, bounds: g.boundingBox.clone(), real: false };
}

/** Bounds of a stand-in or real key (stand-ins first: they are what `modelKey` defined). */
export function boundsOfKey(key) {
  if (key.startsWith('hh:') && made.has(key.slice(3))) return made.get(key.slice(3)).boundingBox.clone();
  return models.boundsOf(key);
}
