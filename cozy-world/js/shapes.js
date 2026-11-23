// The miniature-world mesh kit (port of scripts/shapes.gd) on three.js, with the same semantics: a ball is a unit
// sphere scaled to `size`, a box a unit cube scaled to `size`, a cylinder centred on its position. Shared geometries
// and materials keep draw resources modest. Solid shapes register colliders (oriented boxes and circles in the
// ground plane, with a height range) that the player and Swan slide along.
import * as THREE from 'three';

const materials = new Map();
const SPHERE = new THREE.SphereGeometry(0.5, 16, 8);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const cylinders = new Map();

export const colliders = [];

export function mat(hex, glow = false) {
  const key = hex + glow;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.87, metalness: 0 });
    if (glow) { m.emissive = new THREE.Color(hex); m.emissiveIntensity = 0.7; }
    materials.set(key, m);
  }
  return m;
}

function mesh(parent, geo, pos, hex) {
  const n = new THREE.Mesh(geo, mat(hex));
  n.position.set(pos[0], pos[1], pos[2]);
  n.castShadow = true;
  n.receiveShadow = true;
  parent.add(n);
  return n;
}

export function ball(parent, pos, size, hex) {
  const n = mesh(parent, SPHERE, pos, hex);
  n.scale.set(size[0], size[1], size[2]);
  return n;
}

export function box(parent, pos, size, hex, solid = false) {
  const n = mesh(parent, BOX, pos, hex);
  n.scale.set(size[0], size[1], size[2]);
  if (solid) collideBox(parent, pos, size);
  return n;
}

export function cylinder(parent, pos, radius, height, hex, top = -1) {
  const t = top < 0 ? radius : top;
  const key = `${radius.toFixed(3)}:${t.toFixed(3)}:${height.toFixed(3)}`;
  let g = cylinders.get(key);
  if (!g) { g = new THREE.CylinderGeometry(t, radius, height, 12); cylinders.set(key, g); }
  return mesh(parent, g, pos, hex);
}

const UP = new THREE.Vector3(0, 1, 0);
export function rod(parent, a, b, radius, hex) {
  const A = new THREE.Vector3(...a); const B = new THREE.Vector3(...b);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const n = cylinder(parent, [mid.x, mid.y, mid.z], radius, A.distanceTo(B), hex);
  const dir = B.clone().sub(A).normalize();
  if (Math.abs(dir.dot(UP)) < 0.999) n.quaternion.setFromUnitVectors(UP, dir);
  n.castShadow = radius > 0.02;
  return n;
}

export function tube(parent, points, radius, hex) {
  for (let i = 0; i < points.length - 1; i++) rod(parent, points[i], points[i + 1], radius, hex);
}

/** A billboard text label (Label3D): `size` is the Godot font size; pixel size 0.009 m. */
export function label(parent, text, pos, size = 28, hex = '#fff5dd') {
  const lines = String(text).split('\n');
  const px = size * 2;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `600 ${px}px "Open Sans", system-ui, sans-serif`;
  const w = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + px;
  const lh = Math.ceil(px * 1.25);
  c.width = w; c.height = lh * lines.length + px * 0.4;
  g.font = `600 ${px}px "Open Sans", system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  lines.forEach((l, i) => {
    const y = lh * (i + 0.5) + px * 0.2;
    g.lineWidth = px * 0.22; g.strokeStyle = '#4b5948'; g.strokeText(l, w / 2, y);
    g.fillStyle = hex; g.fillText(l, w / 2, y);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const k = 0.009 / 2;
  s.scale.set(c.width * k, c.height * k, 1);
  s.position.set(pos[0], pos[1], pos[2]);
  s.renderOrder = 5;
  parent.add(s);
  return s;
}

// ---- colliders: a marker node gives each its world frame once the world is built ----
function marker(parent, pos) {
  const m = new THREE.Object3D();
  m.position.set(pos[0], pos[1], pos[2]);
  parent.add(m);
  return m;
}
export function collideBox(parent, pos, size) {
  colliders.push({ kind: 'box', node: marker(parent, pos), hx: size[0] / 2, hy: size[1] / 2, hz: size[2] / 2 });
}
export function collideCircle(parent, pos, r, h) {
  colliders.push({ kind: 'circle', node: marker(parent, pos), r, hy: h / 2 });
}

/** Bake every collider to world space (call once after the world is built and placed). */
export function bakeColliders() {
  const p = new THREE.Vector3(); const q = new THREE.Quaternion(); const s = new THREE.Vector3(); const e = new THREE.Euler();
  for (const c of colliders) {
    c.node.updateWorldMatrix(true, false);
    c.node.matrixWorld.decompose(p, q, s);
    e.setFromQuaternion(q, 'YXZ');
    c.x = p.x; c.y = p.y; c.z = p.z; c.rot = e.y;
    c.sx = Math.abs(s.x); c.sz = Math.abs(s.z);
  }
}

/** Push a circle (x, z, radius r, feet at y, height h) out of every solid it overlaps. Returns the new [x, z]. */
export function resolve(x, z, r, y, h = 1.6) {
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      if (c.x === undefined) continue;
      const y0 = c.y - c.hy; const y1 = c.y + c.hy;
      if (y + 0.15 > y1 || y + h < y0) continue;
      if (c.kind === 'circle') {
        const dx = x - c.x; const dz = z - c.z; const d = Math.hypot(dx, dz); const m = c.r * c.sx + r;
        if (d < m && d > 1e-6) { x = c.x + (dx / d) * m; z = c.z + (dz / d) * m; }
        continue;
      }
      // an oriented box: the circle in the box's own frame
      const cs = Math.cos(-c.rot); const sn = Math.sin(-c.rot);
      const dx = x - c.x; const dz = z - c.z;
      const lx = dx * cs + dz * sn; const lz = -dx * sn + dz * cs;
      const hx = c.hx * c.sx; const hz = c.hz * c.sz;
      if (Math.abs(lx) > hx + r || Math.abs(lz) > hz + r) continue;
      const qx = Math.max(-hx, Math.min(hx, lx)); const qz = Math.max(-hz, Math.min(hz, lz));
      const ox = lx - qx; const oz = lz - qz; const d = Math.hypot(ox, oz);
      let nx; let nz;
      if (d > 1e-6) { if (d >= r) continue; nx = qx + (ox / d) * r; nz = qz + (oz / d) * r; } else {
        // the centre is inside: out through the nearest face
        const px = hx - Math.abs(lx); const pz = hz - Math.abs(lz);
        if (px < pz) { nx = Math.sign(lx || 1) * (hx + r); nz = lz; } else { nx = lx; nz = Math.sign(lz || 1) * (hz + r); }
      }
      // back to the world: d = R(rot) n
      x = c.x + nx * Math.cos(c.rot) + nz * Math.sin(c.rot);
      z = c.z - nx * Math.sin(c.rot) + nz * Math.cos(c.rot);
    }
  }
  return [x, z];
}

// ---- the miniature props ----
export function tree(parent, pos, size = 1, hex = '#7d9d69', solid = true) {
  const root = new THREE.Group();
  root.position.set(pos[0], pos[1], pos[2]);
  parent.add(root);
  cylinder(root, [0, 1.9 * size, 0], 0.38 * size, 3.8 * size, '#916d50', 0.22 * size);
  for (let j = 0; j < 3; j++) {
    const a = (j * Math.PI * 2) / 3;
    rod(root, [0, 2.1 * size, 0], [Math.cos(a) * size, 3.4 * size, Math.sin(a) * size], 0.16 * size, '#916d50');
  }
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    ball(root, [Math.cos(a) * 0.85 * size, (3.9 + (i % 2) * 0.5) * size, Math.sin(a) * 0.85 * size], [2.8 * size, 2.3 * size, 2.6 * size], hex);
  }
  ball(root, [0, 4.9 * size, 0], [2.9 * size, 2.1 * size, 2.6 * size], hex);
  if (solid) collideCircle(root, [0, 1.75 * size, 0], 0.42 * size, 3.5 * size);
  return root;
}

export function flower(parent, pos, hex, s = 1) {
  const root = new THREE.Group();
  root.position.set(pos[0], pos[1], pos[2]);
  root.scale.setScalar(s);
  parent.add(root);
  rod(root, [0, 0, 0], [0, 0.55, 0], 0.025, '#74955a');
  ball(root, [0.09, 0.23, 0], [0.27, 0.08, 0.12], '#8da964');
  for (let j = 0; j < 5; j++) {
    const a = (j * Math.PI * 2) / 5;
    ball(root, [Math.cos(a) * 0.12, 0.57, Math.sin(a) * 0.12], [0.19, 0.1, 0.19], hex);
  }
  ball(root, [0, 0.62, 0], [0.13, 0.1, 0.13], '#efd589');
  return root;
}

export function bench(parent, pos, angle = 0) {
  const root = new THREE.Group();
  parent.add(root);
  root.position.set(pos[0], pos[1], pos[2]);
  root.rotation.y = angle;
  box(root, [0, 0.55, 0], [1.8, 0.15, 0.55], '#a58060', true);
  box(root, [0, 0.95, -0.24], [1.8, 0.5, 0.12], '#b3926d');
  for (const x of [-0.65, 0.65]) box(root, [x, 0.27, 0], [0.12, 0.55, 0.4], '#6c7357');
  return root;
}

export function lantern(parent, pos) {
  cylinder(parent, [pos[0], pos[1] + 1.2, pos[2]], 0.055, 2.4, '#7a6855');
  const lamp = box(parent, [pos[0], pos[1] + 2.45, pos[2]], [0.38, 0.5, 0.38], '#ebc981');
  lamp.material = mat('#ebc981', true);
  cylinder(parent, [pos[0], pos[1] + 2.77, pos[2]], 0.31, 0.2, '#796c58', 0.03);
  return lamp;
}

/** Remove a node and everything under it (geometries and materials are shared and kept). */
export function clear(node) {
  for (const c of [...node.children]) node.remove(c);
}
