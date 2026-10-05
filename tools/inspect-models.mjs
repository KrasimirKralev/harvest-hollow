#!/usr/bin/env node
// Inventory 3D model files without a renderer: triangle counts, animation clips, skins,
// materials, textures and world-space bounding boxes.
//   node tools/inspect-models.mjs <dir> [--json out.json] [--fbx2gltf /path/FBX2glTF] [--tmp dir]
// glTF/GLB are parsed directly. FBX is converted to GLB with FBX2glTF into --tmp first (this also
// proves the file converts). OBJ is counted from its face lines.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const root = args[0];
const jsonOut = opt('--json');
const fbx2gltf = opt('--fbx2gltf');
const tmpDir = opt('--tmp', '/tmp/inspect-models');
const SKIP_DIRS = /(^|\/)(Blends?|Blender|__MACOSX)(\/|$)/i;

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function readGltf(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) === 0x46546c67) {
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
    const binStart = 20 + jsonLen + 8;
    const bin = buf.length > binStart ? buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen)) : null;
    return { json, buffers: [bin] };
  }
  const json = JSON.parse(buf.toString('utf8'));
  const buffers = (json.buffers || []).map((b) => {
    if (!b.uri) return null;
    if (b.uri.startsWith('data:')) return Buffer.from(b.uri.split(',')[1], 'base64');
    const p = path.join(path.dirname(file), decodeURIComponent(b.uri));
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  });
  return { json, buffers };
}

function accessorMax(g, idx) {
  const a = g.json.accessors[idx];
  if (a.max) return a.max[0];
  // Fall back to scanning float data (animation input accessors normally carry min/max).
  const bv = g.json.bufferViews[a.bufferView];
  const buf = g.buffers[bv.buffer];
  if (!buf || a.componentType !== 5126) return 0;
  let m = 0;
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  for (let i = 0; i < a.count; i++) m = Math.max(m, buf.readFloatLE(off + i * 4));
  return m;
}

// Minimal column-major 4x4 math for node transforms.
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

function inspectGltf(file) {
  const g = readGltf(file);
  const j = g.json;
  let tris = 0;
  const meshTris = (j.meshes || []).map((m) => m.primitives.reduce((s, p) => {
    const mode = p.mode ?? 4;
    if (mode !== 4) return s;
    const n = p.indices != null ? j.accessors[p.indices].count : j.accessors[p.attributes.POSITION].count;
    return s + n / 3;
  }, 0));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const sceneRoots = j.scenes?.[j.scene ?? 0]?.nodes ?? (j.nodes || []).map((_, i) => i);
  // World matrices of every node, needed to pose skinned meshes in their bind pose.
  const world = new Map();
  const fill = (ni, parent) => { const m = mul(parent, trs(j.nodes[ni])); world.set(ni, m); for (const c of j.nodes[ni].children || []) fill(c, m); };
  for (const r of sceneRoots) fill(r, ident());
  const bindMatrix = (skin) => {
    const sk = j.skins[skin];
    const jw = world.get(sk.joints[0]);
    if (!jw) return ident();
    if (sk.inverseBindMatrices == null) return jw;
    const a = j.accessors[sk.inverseBindMatrices];
    const bv = j.bufferViews[a.bufferView];
    const buf = g.buffers[bv.buffer];
    if (!buf) return ident();
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const ibm = Array.from({ length: 16 }, (_, k) => buf.readFloatLE(off + k * 4));
    return mul(jw, ibm);
  };
  const visit = (ni, parent) => {
    const n = j.nodes[ni];
    const m = mul(parent, trs(n));
    if (n.mesh != null) {
      tris += meshTris[n.mesh];
      for (const p of j.meshes[n.mesh].primitives) {
        const a = j.accessors[p.attributes.POSITION];
        if (!a.min || !a.max) continue;
        // Skinned meshes ignore their node matrix (glTF rule); pose them by joint world x inverse bind.
        const mm = n.skin != null ? bindMatrix(n.skin) : m;
        for (const cx of [a.min[0], a.max[0]]) for (const cy of [a.min[1], a.max[1]]) for (const cz of [a.min[2], a.max[2]]) {
          const v = apply(mm, [cx, cy, cz]);
          for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
        }
      }
    }
    for (const c of n.children || []) visit(c, m);
  };
  for (const r of sceneRoots) visit(r, ident());
  const anims = (j.animations || []).map((a) => {
    let dur = 0;
    for (const s of a.samplers) dur = Math.max(dur, accessorMax(g, s.input));
    return { name: a.name, dur: +dur.toFixed(2) };
  });
  const imgs = (j.images || []).map((im) => im.uri && !im.uri.startsWith('data:') ? im.uri : im.mimeType || 'embedded');
  const size = max.map((v, k) => +(v - min[k]).toFixed(3));
  return {
    tris: Math.round(tris),
    anims,
    skins: (j.skins || []).length,
    joints: (j.skins || []).reduce((s, k) => Math.max(s, k.joints.length), 0),
    materials: (j.materials || []).map((m) => m.name),
    textures: imgs,
    vertexColors: (j.meshes || []).some((m) => m.primitives.some((p) => p.attributes.COLOR_0 != null)),
    size: Number.isFinite(size[0]) ? size : null,
    minY: Number.isFinite(min[1]) ? +min[1].toFixed(3) : null,
  };
}

function inspectObj(file) {
  const txt = fs.readFileSync(file, 'utf8');
  let tris = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const mats = new Set();
  for (const line of txt.split('\n')) {
    if (line.startsWith('f ')) tris += line.trim().split(/\s+/).length - 3;
    else if (line.startsWith('v ')) {
      const v = line.trim().split(/\s+/).slice(1, 4).map(Number);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
    } else if (line.startsWith('usemtl ')) mats.add(line.slice(7).trim());
  }
  return { tris, anims: [], skins: 0, joints: 0, materials: [...mats], textures: [], size: max.map((v, k) => +(v - min[k]).toFixed(3)), minY: +min[1].toFixed(3) };
}

function inspectFbx(file) {
  if (!fbx2gltf) return { note: 'FBX (pass --fbx2gltf to inspect)' };
  const rel = path.relative(root, file).replace(/[\\/ ]/g, '_').replace(/\.fbx$/i, '');
  const out = path.join(tmpDir, rel);
  const glb = `${out}.glb`;
  if (!fs.existsSync(glb)) {
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      execFileSync(fbx2gltf, ['--binary', '--input', file, '--output', out], { stdio: 'pipe', timeout: 120000 });
    } catch (e) {
      return { error: `FBX2glTF failed: ${String(e.stderr || e.message).slice(0, 200)}` };
    }
  }
  if (!fs.existsSync(glb)) return { error: 'FBX2glTF produced no GLB' };
  return { ...inspectGltf(glb), convertedVia: 'FBX2glTF' };
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.test(path.relative(root, p))) walk(p, out); } else out.push(p);
  }
  return out;
}

const files = walk(root).filter((f) => /\.(glb|gltf|fbx|obj)$/i.test(f)).sort();
const results = [];
for (const f of files) {
  const ext = path.extname(f).slice(1).toLowerCase();
  let info;
  try {
    info = ext === 'fbx' ? inspectFbx(f) : ext === 'obj' ? inspectObj(f) : inspectGltf(f);
  } catch (e) {
    info = { error: e.message };
  }
  results.push({ file: path.relative(root, f), format: ext, bytes: fs.statSync(f).size, ...info });
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
for (const r of results) {
  const a = r.anims?.length ? ` anims[${r.anims.length}]: ${r.anims.map((x) => x.name).join(', ')}` : '';
  const sz = r.size ? ` size ${r.size.join('x')}` : '';
  const err = r.error ? ` ERROR ${r.error}` : '';
  console.log(`${r.file} | ${r.format} | ${r.tris ?? '?'} tris |${sz}${a}${err}`);
}
