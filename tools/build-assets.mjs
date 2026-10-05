#!/usr/bin/env node
// Asset pipeline (render-life lane): assets-src/ (CC0 packs, read-only) + procedural models -> optimised GLBs in
// public/assets/models/ and public/assets/models/manifest.json, plus item models for the icon renderer
// (tools/make-icons.mjs) in the build cache. Dev-only; the outputs are committed, so the game never runs this.
//
//   node tools/build-assets.mjs [--only <regex over keys>] [--list] [--no-items] [--clean]
//
// Tools (dev-only, not project dependencies): install them once into any folder and point HH_ASSET_TOOLS at
// its node_modules:
//   npm i --no-save --prefix ~/.cache/hh-asset-tools fbx2gltf @gltf-transform/core @gltf-transform/extensions \
//       @gltf-transform/functions meshoptimizer pngjs
//   HH_ASSET_TOOLS=~/.cache/hh-asset-tools/node_modules node tools/build-assets.mjs
// three.js comes from the project (same version as the client). FBX goes through the FBX2glTF binary that
// the fbx2gltf package ships; conversions are cached in node_modules/.cache/hh-assets/ (keyed by size+mtime).
//
// What it guarantees (render/models.js documents the runtime side):
// - metres, Y up, +Z forward, origin at the footprint centre on the ground; 1 tile = TILE_M = 2 m
// - metalness 0 everywhere (FBX2glTF writes 0.4, which renders dark: assets-catalog §6.1)
// - static models: ONE primitive with POSITION, NORMAL, COLOR_0 (linear, material colours baked, saturation
//   +10..20 %) and _SWAY (bend weight 0..1; the manifest's `sway` is the amplitude), creased normals on organic
//   meshes, flat on architecture; all static keys share one attribute set (BatchedMesh-ready)
// - skinned models: one primitive per skinned mesh (vertex colours, joints, weights), clips renamed and pruned,
//   plus a rigid idle-pose twin node '<key>#rigid' for far/instanced use
// - meshopt compression (EXT_meshopt_compression; three's MeshoptDecoder is vendored with three)
// - manifest.json: { version, hash, units, files, defs, aliases, keys } (models.js header)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { FISHING, CONTENT as CONTENT_TABLES } from '../shared/content/index.js';
import * as CONTENT_NS from '../shared/content/index.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(ROOT, 'assets-src');
export const OUT = path.join(ROOT, 'public', 'assets', 'models');
export const CACHE = path.join(ROOT, 'node_modules', '.cache', 'hh-assets');
export const TILE = 2;   // metres per tile (shared/content/config.js TILE_M)

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };

// ---------------------------------------------------------------------------------------------------
// 0. Tools
let T = null;
export async function tools() {
  if (T) return T;
  const dir = process.env.HH_ASSET_TOOLS || opt('tools', path.join(process.env.HOME || '', '.cache', 'hh-asset-tools', 'node_modules'));
  const req = createRequire(path.join(dir, 'noop.js'));
  const imp = async (name) => {
    try { return await import(pathToFileURL(req.resolve(name)).href); } catch (err) {
      throw new Error(`build-assets: cannot load "${name}" from ${dir} (set HH_ASSET_TOOLS; see the header). ${err.message}`);
    }
  };
  const core = await imp('@gltf-transform/core');
  const ext = await imp('@gltf-transform/extensions');
  const fns = await imp('@gltf-transform/functions');
  const mo = await imp('meshoptimizer');
  const png = await imp('pngjs');
  await mo.MeshoptEncoder.ready;
  await mo.MeshoptSimplifier.ready;
  const fbx = path.join(dir, 'fbx2gltf', 'bin', process.platform === 'darwin' ? 'Darwin' : 'Linux', 'FBX2glTF');
  T = { core, ext, fns, enc: mo.MeshoptEncoder, simp: mo.MeshoptSimplifier, PNG: png.PNG || png.default.PNG, fbx,
    io: new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS) };
  T.io.registerDependencies({ 'meshopt.encoder': mo.MeshoptEncoder, 'meshopt.decoder': mo.MeshoptDecoder });
  T.logger = new core.Logger(core.Logger.Verbosity.WARN);
  T.io.setLogger(T.logger);
  return T;
}

// ---------------------------------------------------------------------------------------------------
// 1. Sources: FBX -> GLB (cached), glTF/GLB read as gltf-transform Documents
fs.mkdirSync(CACHE, { recursive: true });

export async function sourcePath(rel) {
  const abs = path.join(SRC, rel);
  if (!fs.existsSync(abs)) throw new Error(`missing source ${rel}`);
  if (!/\.fbx$/i.test(rel)) return abs;
  const st = fs.statSync(abs);
  const tag = createHash('sha1').update(`${rel}|${st.size}|${st.mtimeMs}|v2`).digest('hex').slice(0, 12);
  const out = path.join(CACHE, 'fbx', `${tag}`);
  if (!fs.existsSync(`${out}.glb`)) {
    const { fbx } = await tools();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync(fbx, ['--binary', '-i', abs, '-o', out], { stdio: 'pipe' });
  }
  return `${out}.glb`;
}

const docCache = new Map();
export async function readDoc(rel) {
  if (!docCache.has(rel)) docCache.set(rel, (async () => (await tools()).io.read(await sourcePath(rel)))());
  return docCache.get(rel);
}

// ---------------------------------------------------------------------------------------------------
// 2. Colour helpers (sRGB hex in, linear out; saturation boost per assets-catalog §5)
export const lin = (hex) => new THREE.Color(hex);            // ColorManagement: '#hex' is sRGB -> linear
const hsl = {};
export function boost(c, sat = 0.15, light = 0) {
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, Math.min(1, hsl.s * (1 + sat)), Math.min(1, Math.max(0, hsl.l + light)), THREE.SRGBColorSpace);
  return c;
}

const pngCache = new Map();
async function decodeImage(image) {
  const key = image;
  if (!pngCache.has(key)) {
    const { PNG } = await tools();
    pngCache.set(key, PNG.sync.read(Buffer.from(image)));
  }
  return pngCache.get(key);
}

// ---------------------------------------------------------------------------------------------------
// 3. Static bake: every primitive of a source -> one THREE geometry (position, normal, color) in source units
//    with node world transforms applied. opts: { recolor: { matName|regex: hex }, sat, light, skipNodes: regex,
//    onlyNodes: regex, skipMats: regex }
const m4 = new THREE.Matrix4();
const n3 = new THREE.Matrix3();

function accessorArray(acc) {
  if (!acc) return null;
  const n = acc.getCount();
  const size = acc.getElementSize();
  const out = new Float32Array(n * size);
  const el = [];
  for (let i = 0; i < n; i++) {
    acc.getElement(i, el);
    for (let k = 0; k < size; k++) out[i * size + k] = el[k];
  }
  return out;
}

function matColor(mat, opts) {
  const name = mat ? mat.getName() : '';
  let c = null;
  if (opts.recolor) {
    for (const [k, hex] of Object.entries(opts.recolor)) {
      const hit = k.startsWith('/') ? new RegExp(k.slice(1, k.lastIndexOf('/'))).test(name) : k === name;
      if (hit) { c = lin(hex); break; }
    }
  }
  if (!c) {
    const f = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
    c = new THREE.Color(f[0], f[1], f[2]);
    boost(c, opts.sat ?? 0.15, opts.light ?? 0);
  } else if (opts.boostRecolor) boost(c, opts.sat ?? 0.15, 0);
  return c;
}

/** A roof part (visual-11): eaves (the main roof planes scaled out about the roof's centre) and a 3-tone shingle
 *  pattern in bands down the slope (per triangle, so the flat-shaded tiles read as rows). Only the big roof
 *  pieces get the eaves: dormer roofs and chimney caps share the roof material, and scaling them about the roof's
 *  centre tore them off their walls (wave-1 VISUAL-AFTER C1, the "triangle flaps"). */
function roofTreatment(g0, { eaves = 1.07, tones = [0.86, 1.0, 1.12], bands = 10, mainShare = 0.06 } = {}) {
  const g = g0.index ? g0.toNonIndexed() : g0;
  const p = g.getAttribute('position'); const c = g.getAttribute('color');
  g.computeBoundingBox();
  const b = g.boundingBox;
  const cx = (b.min.x + b.max.x) / 2; const cz = (b.min.z + b.max.z) / 2;
  if (eaves !== 1) {
    const roofArea = Math.max(1e-6, (b.max.x - b.min.x) * (b.max.z - b.min.z));
    const { list } = components(g);
    for (const comp of list) {
      const area = (comp.box.max.x - comp.box.min.x) * (comp.box.max.z - comp.box.min.z);
      if (area / roofArea < mainShare) continue;                  // a dormer roof, a cap, a ridge tile
      for (const f of comp.faces) for (let j = 0; j < 3; j++) {
        const i = f * 3 + j;
        p.setXYZ(i, cx + (p.getX(i) - cx) * eaves, p.getY(i), cz + (p.getZ(i) - cz) * eaves);
      }
    }
  }
  const h = Math.max(1e-6, b.max.y - b.min.y);
  for (let f = 0; f < p.count / 3; f++) {
    const y = (p.getY(f * 3) + p.getY(f * 3 + 1) + p.getY(f * 3 + 2)) / 3;
    const k = tones[Math.floor(((y - b.min.y) / h) * bands) % tones.length];
    for (let j = 0; j < 3; j++) { const i = f * 3 + j; c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k); }
  }
  g.userData.material = g0.userData.material;
  return g;
}

/** An exporter's placeholder COLOR_0 (every vertex white) carries no colour: the material colour wins. The
 *  Medieval Village Blacksmith ships one, which painted the Oil Press (and anything built on it) white. */
function whiteColors(acc) {
  const el = [];
  for (let i = 0; i < acc.getCount(); i++) { acc.getElement(i, el); if (el[0] < 0.98 || el[1] < 0.98 || el[2] < 0.98) return false; }
  return true;
}

export async function bakeStatic(rel, opts = {}) {
  const doc = await readDoc(rel);
  const parts = [];
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const visit = async (node) => {
    const name = node.getName();
    const skip = opts.skipNodes && opts.skipNodes.test(name);
    const mesh = node.getMesh();
    if (mesh && !skip && (!opts.onlyNodes || opts.onlyNodes.test(name))) {
      m4.fromArray(node.getWorldMatrix());
      n3.getNormalMatrix(m4);
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4) continue;
        const mat = prim.getMaterial();
        const mname = mat ? mat.getName() : '';
        if (opts.skipMats && opts.skipMats.test(mname)) continue;
        const pos = accessorArray(prim.getAttribute('POSITION'));
        const nrm = accessorArray(prim.getAttribute('NORMAL'));
        const uv = accessorArray(prim.getAttribute('TEXCOORD_0'));
        const n = pos.length / 3;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        if (nrm) g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        const idx = prim.getIndices();
        if (idx) g.setIndex(Array.from(idx.getArray()));
        g.applyMatrix4(m4);
        if (!nrm) g.computeVertexNormals();
        const col = new Float32Array(n * 3);
        const base = matColor(mat, opts);
        const tex = mat && mat.getBaseColorTexture();
        const vcol = prim.getAttribute('COLOR_0');
        if (vcol && !opts.ignoreVertexColors && !whiteColors(vcol)) {
          // authored vertex colours (vertexcat animals): linear per glTF, boosted like material colours
          const el = []; const c = new THREE.Color();
          for (let i = 0; i < n; i++) {
            vcol.getElement(i, el);
            c.setRGB(el[0], el[1], el[2]);
            boost(c, opts.sat ?? 0.15, opts.light ?? 0);
            col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
          }
        } else if (tex && uv && !opts.ignoreTextures) {
          const img = await decodeImage(tex.getImage());
          const c = new THREE.Color();
          for (let i = 0; i < n; i++) {
            const u = uv[i * 2] - Math.floor(uv[i * 2]);
            const v = uv[i * 2 + 1] - Math.floor(uv[i * 2 + 1]);
            const x = Math.min(img.width - 1, Math.floor(u * img.width));
            const y = Math.min(img.height - 1, Math.floor(v * img.height));
            const o = (y * img.width + x) * 4;
            c.setRGB(img.data[o] / 255, img.data[o + 1] / 255, img.data[o + 2] / 255, THREE.SRGBColorSpace);
            boost(c, opts.sat ?? 0.12, opts.light ?? 0);
            col[i * 3] = c.r * (opts.recolor ? 1 : 1); col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
          }
        } else {
          for (let i = 0; i < n; i++) { col[i * 3] = base.r; col[i * 3 + 1] = base.g; col[i * 3 + 2] = base.b; }
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.userData.material = mname;
        if (opts.roof && opts.roof.mat.test(mname)) { parts.push(roofTreatment(g, opts.roof)); continue; }
        parts.push(g);
      }
    }
    for (const c of node.listChildren()) await visit(c);
  };
  for (const n of scene.listChildren()) await visit(n);
  if (!parts.length) throw new Error(`bakeStatic ${rel}: no triangles`);
  return mergeAll(parts);
}

// ---------------------------------------------------------------------------------------------------
// 4. Geometry operations (all return new or mutated THREE.BufferGeometry with position/normal/color[/sway])
export function prep(g, hex) {
  // Normalise a three.js primitive (or any geometry) to position + normal + color, indexed.
  const out = g.index ? g : g;
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'color', 'sway'].includes(k)) out.deleteAttribute(k);
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  if (!out.getAttribute('color')) paint(out, hex || '#ffffff');
  return out;
}

export function paint(g, hex, sat = 0) {
  const c = typeof hex === 'string' ? boost(lin(hex), sat) : hex;
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Multiply vertex colours by a vertical gradient (soft AO at the bottom, lighter top). */
export function shade(g, { bottom = 0.75, top = 1.08, y0, y1 } = {}) {
  g.computeBoundingBox();
  const lo = y0 ?? g.boundingBox.min.y;
  const hi = y1 ?? g.boundingBox.max.y;
  const p = g.getAttribute('position');
  const c = g.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    const t = hi > lo ? Math.min(1, Math.max(0, (p.getY(i) - lo) / (hi - lo))) : 1;
    const k = bottom + (top - bottom) * t;
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return g;
}

export function mergeAll(list) {
  // the coat attribute (wave 3: animal coats) survives a merge when every part carries one
  const keepCoat = list.filter(Boolean).every((g) => g.getAttribute('coat'));
  const norm = list.filter(Boolean).map((g) => {
    let x = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'color', 'sway', ...(keepCoat ? ['coat'] : [])].includes(k)) x.deleteAttribute(k);
    if (!x.getAttribute('normal')) x.computeVertexNormals();
    if (!x.getAttribute('color')) paint(x, '#ffffff');
    return x;
  });
  const hasSway = norm.some((g) => g.getAttribute('sway'));
  if (hasSway) for (const g of norm) if (!g.getAttribute('sway')) g.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count), 1));
  const m = mergeGeometries(norm, false);
  if (!m) throw new Error('mergeAll: incompatible geometries');
  return m;
}

export function xform(g, { s = 1, sx, sy, sz, rx = 0, ry = 0, rz = 0, x = 0, y = 0, z = 0 } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx ?? s, sy ?? s, sz ?? s),
  );
  g.applyMatrix4(m);
  return g;
}

export function bounds(g) { g.computeBoundingBox(); return g.boundingBox.clone(); }

/** Centre x/z on 0 and put the lowest point (or the given soil line) on y = 0. */
export function ground(g, { keepY = false } = {}) {
  const b = bounds(g);
  g.translate(-(b.min.x + b.max.x) / 2, keepY ? 0 : -b.min.y, -(b.min.z + b.max.z) / 2);
  return g;
}

/** Scale uniformly so the x/z extent fits w x d metres (and the height ≤ h when given), then ground it. */
export function fit(g, { w, d, h, fill = 0.9, keepY = false } = {}) {
  const b = bounds(g);
  const sx = b.max.x - b.min.x;
  const sz = b.max.z - b.min.z;
  const sy = b.max.y - b.min.y;
  let s = Infinity;
  if (w) s = Math.min(s, (w * fill) / sx);
  if (d) s = Math.min(s, (d * fill) / sz);
  if (h) s = Math.min(s, h / sy);
  if (!Number.isFinite(s)) s = 1;
  g.scale(s, s, s);
  return ground(g, { keepY });
}

export function toHeight(g, h, { keepY = false } = {}) {
  const b = bounds(g);
  const s = h / (b.max.y - b.min.y);
  g.scale(s, s, s);
  return ground(g, { keepY });
}

/** Weld vertices whose attributes agree (quantised) -> indexed geometry. */
export function weld(g, eps = 1e-4) {
  const src = g.index ? g.toNonIndexed() : g;
  const names = Object.keys(src.attributes);
  const attrs = names.map((n) => src.getAttribute(n));
  const n = attrs[0].count;
  const map = new Map();
  const remap = new Uint32Array(n);
  const keep = [];
  const q = (v, k) => Math.round(v / (k === 'position' ? eps : 1e-3));
  for (let i = 0; i < n; i++) {
    let key = '';
    for (let a = 0; a < attrs.length; a++) {
      const at = attrs[a];
      for (let c = 0; c < at.itemSize; c++) key += `${q(at.array[i * at.itemSize + c], names[a])},`;
    }
    let j = map.get(key);
    if (j === undefined) { j = keep.length; map.set(key, j); keep.push(i); }
    remap[i] = j;
  }
  const out = new THREE.BufferGeometry();
  for (let a = 0; a < attrs.length; a++) {
    const at = attrs[a];
    const arr = new Float32Array(keep.length * at.itemSize);
    for (let j = 0; j < keep.length; j++) for (let c = 0; c < at.itemSize; c++) arr[j * at.itemSize + c] = at.array[keep[j] * at.itemSize + c];
    out.setAttribute(names[a], new THREE.BufferAttribute(arr, at.itemSize));
  }
  const idx = keep.length > 65535 ? new Uint32Array(n) : new Uint16Array(n);
  idx.set(remap);
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** Area-weighted normals averaged across faces within `deg` of each other at shared positions (0.1 mm). */
export function crease(g, deg = 40) {
  const src = g.index ? g.toNonIndexed() : g.clone();
  const pos = src.getAttribute('position');
  const n = pos.count;
  const cos = Math.cos((deg * Math.PI) / 180);
  const fn = new Float32Array(n);          // per-face normals (unnormalised: area weight), stored per vertex
  const faceN = [];
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const e1 = new THREE.Vector3(); const e2 = new THREE.Vector3();
  for (let f = 0; f < n / 3; f++) {
    a.fromBufferAttribute(pos, f * 3); b.fromBufferAttribute(pos, f * 3 + 1); c.fromBufferAttribute(pos, f * 3 + 2);
    const nn = e1.subVectors(c, b).cross(e2.subVectors(a, b)).clone();
    faceN.push(nn);
  }
  void fn;
  const key = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let l = groups.get(k);
    if (!l) { l = []; groups.set(k, l); }
    l.push(Math.floor(i / 3));
  }
  const out = new Float32Array(n * 3);
  const t = new THREE.Vector3(); const mine = new THREE.Vector3(); const other = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const f = Math.floor(i / 3);
    mine.copy(faceN[f]).normalize();
    t.set(0, 0, 0);
    for (const of of groups.get(key(i))) {
      other.copy(faceN[of]);
      const len = other.length();
      if (len < 1e-12) continue;
      if (other.dot(mine) / len >= cos) t.add(other);
    }
    if (t.lengthSq() < 1e-20) t.copy(mine);
    t.normalize();
    out[i * 3] = t.x; out[i * 3 + 1] = t.y; out[i * 3 + 2] = t.z;
  }
  src.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return weld(src);
}

/** Flat (faceted) normals, welded where faces agree exactly. */
export function flat(g) {
  const src = g.index ? g.toNonIndexed() : g.clone();
  src.deleteAttribute('normal');
  src.computeVertexNormals();
  return weld(src);
}

/** meshopt simplification to `ratio` of the triangles (colour-aware), then creased normals again. */
export async function simplify(g, ratio, { error = 0.02, deg = 40, lockBorder = true } = {}) {
  const { simp } = await tools();
  const w = weld((() => { const x = g.index ? g.toNonIndexed() : g.clone(); x.deleteAttribute('normal'); return x; })(), 1e-4);
  const pos = w.getAttribute('position').array;
  const col = w.getAttribute('color').array;
  const idx = new Uint32Array(w.index.array);
  const target = Math.max(3, Math.floor((idx.length * ratio) / 3) * 3);
  // open leaf cards are all border: crops pass lockBorder false or nothing can collapse
  const [res] = simp.simplifyWithAttributes(idx, pos, 3, col, 3, [1, 1, 1], null, target, error, lockBorder ? ['LockBorder'] : []);
  const out = new THREE.BufferGeometry();
  for (const k of Object.keys(w.attributes)) out.setAttribute(k, w.getAttribute(k));
  out.setIndex(new THREE.BufferAttribute(res, 1));
  const ni = out.toNonIndexed();
  ni.computeVertexNormals();
  return crease(ni, deg);
}

/**
 * Detail-preserving reduction for architecture (wave-1 VISUAL-AFTER C1): meshopt with an ABSOLUTE error cap in
 * metres, so a collapse never moves a surface by more than `maxErr` anywhere. A relative error (the old 0.03 of an
 * 8 m house = 24 cm) let the simplifier eat dormers, chimney rims and window frames first, because small features
 * are the cheapest to remove. With the cap, bevels and the stones' facets go and the silhouettes stay; the result
 * may stop above `target`, which the caller accepts (a building is better a few hundred triangles over than broken).
 */
export async function detailSimplify(g, target, { maxErr = 0.03, colorWeight = 0.5, deg = 35 } = {}) {
  const { simp } = await tools();
  const w = weld((() => { const x = g.index ? g.toNonIndexed() : g.clone(); x.deleteAttribute('normal'); if (x.getAttribute('sway')) x.deleteAttribute('sway'); return x; })(), 1e-4);
  const pos = w.getAttribute('position').array;
  const col = w.getAttribute('color').array;
  const idx = new Uint32Array(w.index.array);
  const want = Math.max(3, Math.floor(target) * 3);
  const [res] = simp.simplifyWithAttributes(idx, pos, 3, col, 3, [colorWeight, colorWeight, colorWeight], null, want, maxErr, ['ErrorAbsolute']);
  const out = new THREE.BufferGeometry();
  for (const k of Object.keys(w.attributes)) out.setAttribute(k, w.getAttribute(k));
  out.setIndex(new THREE.BufferAttribute(res, 1));
  const ni = out.toNonIndexed();
  ni.computeVertexNormals();
  return flatOrCrease(ni, deg);
}
/** Architecture keeps hard edges: crease at a low angle (flat-ish faces, smooth only on curved parts). */
function flatOrCrease(g, deg) { return crease(g, deg); }

/** Bend weight 0..1 = ((y - y0) / (y1 - y0))^2 for the wind shader (rigid parts: 0). */
export function sway(g, { y0 = 0, y1, rigid = false, weight = 1 } = {}) {
  const p = g.getAttribute('position');
  const top = y1 ?? bounds(g).max.y;
  const a = new Float32Array(p.count);
  if (!rigid) for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (p.getY(i) - y0) / Math.max(1e-3, top - y0)));
    a[i] = t * t * weight;
  }
  g.setAttribute('sway', new THREE.BufferAttribute(a, 1));
  return g;
}

export function tris(g) { return g.index ? g.index.count / 3 : g.getAttribute('position').count / 3; }

/** Connected components (by shared positions, 1 mm) of a geometry: [{ faces: [faceIndex], box: Box3 }]. */
export function components(g) {
  const src = g.index ? g.toNonIndexed() : g;
  const p = src.getAttribute('position');
  const n = p.count / 3;
  const key = (i) => `${Math.round(p.getX(i) * 1000)},${Math.round(p.getY(i) * 1000)},${Math.round(p.getZ(i) * 1000)}`;
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (let i = 0; i < p.count; i++) { const k = key(i); if (!parent.has(k)) parent.set(k, k); }
  for (let f = 0; f < n; f++) { const a = find(key(f * 3)); for (const j of [1, 2]) { const b = find(key(f * 3 + j)); if (a !== b) parent.set(b, a); } }
  const comps = new Map();
  const v = new THREE.Vector3();
  for (let f = 0; f < n; f++) {
    const r = find(key(f * 3));
    let c = comps.get(r);
    if (!c) { c = { faces: [], box: new THREE.Box3() }; comps.set(r, c); }
    c.faces.push(f);
    for (let j = 0; j < 3; j++) c.box.expandByPoint(v.fromBufferAttribute(p, f * 3 + j));
  }
  return { src, list: [...comps.values()] };
}

/** Drop the connected components for which drop(box, faceCount) is true (a source's stray parts). */
export function dropComponents(g, drop) {
  const { src, list } = components(g);
  const keep = [];
  for (const c of list) if (!drop(c.box, c.faces.length)) keep.push(...c.faces);
  keep.sort((a, b) => a - b);
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const a = src.getAttribute(name);
    const arr = new Float32Array(keep.length * 3 * a.itemSize);
    keep.forEach((f, i) => arr.set(a.array.subarray(f * 3 * a.itemSize, (f + 1) * 3 * a.itemSize), i * 3 * a.itemSize));
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  return out;
}

/** Up-facing surfaces take a colour (moss on a rock, snow on a cap): k of the way, by how much they face up. */
export function capColor(g, hex, { k = 0.85, from = 0.45, to = 0.85 } = {}) {
  const src = g.index ? g.toNonIndexed() : g;
  const nrm = src.getAttribute('normal'); const c = src.getAttribute('color');
  const t = lin(hex); const col = new THREE.Color();
  for (let i = 0; i < c.count; i++) {
    const up = Math.min(1, Math.max(0, (nrm.getY(i) - from) / (to - from)));
    col.setRGB(c.getX(i), c.getY(i), c.getZ(i)).lerp(t, up * k);
    c.setXYZ(i, col.r, col.g, col.b);
  }
  return src;
}

// Deterministic noise and RNG for procedural models (build-time only; outputs are committed).
export function rng(seed) {
  let s = (typeof seed === 'string' ? [...seed].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) : seed) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function noise3(x, y, z, seed = 1) {
  const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
  const xf = x - xi; const yf = y - yi; const zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(xf); const v = s(yf); const w = s(zf);
  const L = (a, b, t) => a + (b - a) * t;
  const h = (i, j, k) => hash3(xi + i, yi + j, zi + k, seed);
  return L(L(L(h(0, 0, 0), h(1, 0, 0), u), L(h(0, 1, 0), h(1, 1, 0), u), v),
    L(L(h(0, 0, 1), h(1, 0, 1), u), L(h(0, 1, 1), h(1, 1, 1), u), v), w) * 2 - 1;
}

// ---------------------------------------------------------------------------------------------------
// 5. Output: GLB files + manifest
const manifest = { version: 1, hash: '', units: 'metres; 1 tile = 2 m; origin = footprint centre on the ground; +Z forward', files: {}, defs: {}, aliases: {}, keys: {} };
const outFiles = new Map();       // file -> { statics: [{ key, geometry }], skinned: [...] }

export function addStatic(file, key, geometry, meta = {}) {
  let f = outFiles.get(file);
  if (!f) { f = { statics: [], skinned: [] }; outFiles.set(file, f); }
  const g = geometry;
  if (!g.getAttribute('sway')) sway(g, { rigid: true });
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'sway', 'coat'].includes(k)) g.deleteAttribute(k);
  const indexed = g.index ? g : weld(g);
  f.statics.push({ key, geometry: indexed });
  const b = bounds(indexed);
  manifest.keys[key] = {
    file, node: nodeName(key), kind: 'static', scale: 1, yOffset: meta.soil ?? 0, ...meta,
    size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(r3),
    min: b.min.toArray().map(r3), max: b.max.toArray().map(r3), tris: tris(indexed),
  };
  registerDef(key, meta);
}

function registerDef(key, meta) {
  if (!meta.def) return;
  const d = manifest.defs[meta.def] || (manifest.defs[meta.def] = { family: meta.family, keys: [] });
  if (!d.keys.includes(key)) d.keys.push(key);
}

const r3 = (v) => Math.round(v * 1000) / 1000;
export const nodeName = (key) => key.replace(/[^A-Za-z0-9_-]/g, '-');

function writeAccessor(doc, buffer, array, type) {
  return doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
}

async function writeStaticFile(file, entry, skinnedDoc = null) {
  const t = await tools();
  const doc = skinnedDoc || new t.core.Document().setLogger(t.logger);
  const buffer = doc.getRoot().listBuffers()[0] || doc.createBuffer();
  const scene = doc.getRoot().listScenes()[0] || doc.createScene('scene');
  const mat = doc.createMaterial('vc').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(1);
  for (const { key, geometry: g, nodeSuffix } of entry.statics) {
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', writeAccessor(doc, buffer, new Float32Array(g.getAttribute('position').array), 'VEC3'))
      .setAttribute('NORMAL', writeAccessor(doc, buffer, new Float32Array(g.getAttribute('normal').array), 'VEC3'))
      .setAttribute('COLOR_0', writeAccessor(doc, buffer, new Float32Array(g.getAttribute('color').array), 'VEC3'))
      .setAttribute('_SWAY', writeAccessor(doc, buffer, new Float32Array(g.getAttribute('sway').array), 'SCALAR'))
      .setMaterial(mat);
    if (g.getAttribute('coat')) prim.setAttribute('_COAT', writeAccessor(doc, buffer, new Float32Array(g.getAttribute('coat').array), 'VEC3'));
    const ia = g.index.array;
    let hi = 0;
    for (let i = 0; i < ia.length; i++) if (ia[i] > hi) hi = ia[i];
    prim.setIndices(writeAccessor(doc, buffer, hi > 65535 ? new Uint32Array(ia) : new Uint16Array(ia), 'SCALAR'));
    const mesh = doc.createMesh(nodeName(key)).addPrimitive(prim);
    const node = doc.createNode(nodeName(key) + (nodeSuffix || '')).setMesh(mesh).setExtras({ key: key + (nodeSuffix ? '#rigid' : '') });
    scene.addChild(node);
  }
  await finishDoc(doc, file);
}

async function finishDoc(doc, file) {
  const t = await tools();
  await doc.transform(t.fns.prune(), t.fns.dedup(), t.fns.meshopt({ encoder: t.enc, level: 'medium' }));
  const abs = path.join(OUT, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  await t.io.write(abs, doc);
  const bytes = fs.statSync(abs).size;
  manifest.files[file] = { bytes };
  return bytes;
}

export { manifest, outFiles, writeStaticFile, finishDoc };

// ---------------------------------------------------------------------------------------------------
// 6. Procedural primitives (three.js geometries normalised to position/normal/color)
export function P(g, hex, { creaseDeg = 0, sat = 0 } = {}) {
  g.deleteAttribute('uv');
  const x = g.index ? g.toNonIndexed() : g;
  paint(x, hex, sat);
  if (creaseDeg) return crease(x, creaseDeg);
  x.computeVertexNormals();
  return x;
}
// box / cyl / cone: `y` is the height of the BASE (the shape stands on y), rotations turn about its centre
const base = (h, o) => ({ ...o, y: h / 2 + (o.y || 0) });
export const box = (w, h, d, hex, o = {}) => xform(P(new THREE.BoxGeometry(w, h, d), hex), base(h, o));
export const cyl = (rt, rb, h, seg, hex, o = {}, deg = 50) => xform(P(new THREE.CylinderGeometry(rt, rb, h, seg), hex, { creaseDeg: deg }), base(h, o));
export const cone = (r, h, seg, hex, o = {}) => xform(P(new THREE.ConeGeometry(r, h, seg), hex, { creaseDeg: 50 }), base(h, o));
export const ball = (r, hex, o = {}, detail = 1) => xform(P(new THREE.IcosahedronGeometry(r, detail), hex, { creaseDeg: 70 }), o);
export const torus = (r, t, hex, o = {}, rs = 8, ts = 16) => xform(P(new THREE.TorusGeometry(r, t, rs, ts), hex, { creaseDeg: 60 }), o);

/** A soft lumpy blob (noise-displaced icosphere), smooth-shaded, for canopies, bushes, wool, rocks. */
export function blob(r, hex, { detail = 2, amp = 0.18, freq = 1.6, seed = 1, sx = 1, sy = 1, sz = 1, flatBottom = 0, creaseDeg = 80 } = {}) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3(v.x * freq + 11, v.y * freq + 7, v.z * freq + 3, seed);
    v.multiplyScalar(r * (1 + amp * n));
    v.x *= sx; v.y *= sy; v.z *= sz;
    if (flatBottom && v.y < -r * sy * flatBottom) v.y = -r * sy * flatBottom;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const x = g.toNonIndexed();
  paint(x, hex);
  return crease(x, creaseDeg);
}

/** Lathe from a profile [[radius, y], ...] (bottom to top). */
export function lathe(profile, seg, hex, deg = 50) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  return P(g, hex, { creaseDeg: deg });
}

/** Leaf: a bent diamond card (two-sided via the foliage material), length along +y then tipping toward +z. */
export function leaf(len, wid, hex, { bend = 0.35, seg = 3 } = {}) {
  if (seg <= 1) {
    // a kite: base, the two widest points, the tip (2 triangles; the strip below would be zero-width at both ends)
    const at = (t) => [len * t * (1 - bend * t * 0.5), len * bend * t * t];
    const [ym, zm] = at(0.45); const [yt, zt] = at(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, wid * 0.5, ym, zm, -wid * 0.5, ym, zm,
      -wid * 0.5, ym, zm, wid * 0.5, ym, zm, 0, yt, zt]), 3));
    g.computeVertexNormals();
    paint(g, hex);
    return g;
  }
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = Math.sin(Math.PI * Math.min(1, t * 1.1)) * wid * 0.5 * (1 - t * 0.2);
    const y = len * t * (1 - bend * t * 0.5);
    const z = len * bend * t * t;
    pts.push([w, y, z], [-w, y, z]);
  }
  const pos = [];
  for (let i = 0; i < seg; i++) {
    const [a, b, c, d] = [pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3]];
    pos.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  paint(g, hex);
  return g;
}

// ---------------------------------------------------------------------------------------------------
// 7. Job registry
export const JOBS = [];         // static: { key, file, meta, build }
export const SKINNED = [];      // skinned: { key, file, meta, build }
export const ITEMS = [];        // icon item models: { id, build, ... }
export const ICON_DEFS = [];    // icons rendered from world models: { id, kind, model: { file, key } } (filled after build)
const job = (key, file, meta, build) => JOBS.push({ key, file, meta, build });

const QC = (n) => `quaternius-ultimate-crops/FBX/${n}.fbx`;
const UN = (n) => `quaternius-ultimate-nature/FBX/${n}.fbx`;
const FB = (n) => `quaternius-farm-buildings/FBX/${n}.fbx`;
const MVB = (n) => `quaternius-medieval-village/Buildings/FBX/${n}.fbx`;
const MVP = (n) => `quaternius-medieval-village/Props/FBX/${n}.fbx`;
const KF = (n) => `kenney-food-kit/Models/GLB format/${n}.glb`;
const KS = (n) => `kenney-survival-kit/Models/GLB format/${n}.glb`;
const KT = (n) => `kenney-fantasy-town-kit/Models/GLB format/${n}.glb`;
const KM = (n) => `kenney-mini-market/Models/GLB format/${n}.glb`;
const QF = (n) => `quaternius-ultimate-food/FBX/${n}.fbx`;
const QS = (n) => `quaternius-survival/FBX/${n}.fbx`;

// ---------------------------------------------------------------------------------------------------
// 8. Plot and crops (GDD §3.1, visual-ux-juice §3.6). Crop clusters sit on the plot mound's soil line.
export const PLOT_TOP = 0.12;

function plotMound() {
  // A rounded raised bed 1.84 m square with three furrow ridges running along x; lighter rim.
  const S = 0.92; const H = PLOT_TOP; const N = 22;
  const top = new THREE.PlaneGeometry(S * 2 - 0.16, S * 2 - 0.16, N, N);
  top.rotateX(-Math.PI / 2);
  const p = top.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const z = p.getZ(i);
    const ridge = 0.022 * Math.cos((z / (S * 2 - 0.16)) * Math.PI * 6);   // 3 ridges
    const edge = Math.max(Math.abs(x), Math.abs(z)) / (S - 0.08);
    const n = noise3(x * 3, 0, z * 3, 7) * 0.008;
    p.setY(i, H + ridge * (1 - Math.pow(edge, 6)) + n);
  }
  const t = P(top, '#7A4A2A');
  const c = t.getAttribute('color'); const tp = t.getAttribute('position');
  const soil = lin('#7A4A2A'); const rim = lin('#9B6A3E'); const furrow = lin('#6A3E22'); const col = new THREE.Color();
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i); const z = tp.getZ(i);
    const e = Math.max(Math.abs(x), Math.abs(z)) / (S - 0.08);
    const ridge = Math.cos((z / (S * 2 - 0.16)) * Math.PI * 6);
    col.copy(furrow).lerp(soil, 0.5 + 0.5 * ridge).lerp(rim, Math.pow(Math.min(1, e), 5) * 0.8);
    c.setXYZ(i, col.r, col.g, col.b);
  }
  // Bevelled skirt: an inset rim ring from the top edge down to the ground.
  const ring = [];
  const r0 = S - 0.08; const r1 = S;
  const shape = (r, y) => [[-r, y, -r], [r, y, -r], [r, y, r], [-r, y, r]];
  const a = shape(r0, H); const b = shape(r1 - 0.02, H * 0.55); const g0 = shape(r1, 0);
  const quad = (q0, q1, q2, q3) => ring.push(...q0, ...q1, ...q2, ...q0, ...q2, ...q3);
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    quad(a[k], b[k], b[k2], a[k2]);
    quad(b[k], g0[k], g0[k2], b[k2]);
  }
  const sk = new THREE.BufferGeometry();
  sk.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ring), 3));
  sk.computeVertexNormals();
  paint(sk, '#8E5B33');
  shade(sk, { bottom: 0.7, top: 1.0, y0: 0, y1: H });
  // faces must point outward: flip if the first normal points inward
  const nrm = sk.getAttribute('normal');
  const pp = sk.getAttribute('position');
  if (nrm.getX(0) * pp.getX(0) + nrm.getZ(0) * pp.getZ(0) < 0) {
    const arr = pp.array;
    for (let i = 0; i < arr.length; i += 9) for (let k = 0; k < 3; k++) { const tmp = arr[i + 3 + k]; arr[i + 3 + k] = arr[i + 6 + k]; arr[i + 6 + k] = tmp; }
    sk.computeVertexNormals();
  }
  return weld(mergeAll([t, sk]));
}

// Per-crop recipe: sources per stage (Quaternius), recolours, layout and size. GDD §3.1 hues for ready produce.
// Fields are dense (visual-04): 9-12 plants a plot covering ~20 / 45 / 80 % of it at stages 1 / 2 / 3, and cheap
// (performance-03): a ripe plot <= 500 triangles, a growing one <= 250, plus a ~120-triangle far-band key.
const GREEN = { Green: '#5BB040', DarkGreen: '#3F8F36', DarkGreen2: '#2F7D33', LightGreen: '#9CD45A', Green_Bush: '#4C9A3E' };
const CROPS = {
  wheat: { arch: 'tall', proc: 'grain', h: [0.34, 0.75, 1.1], layout: 'rows12', tuft: 8, tufts: [3, 4, 8], ear: '#D9A845', tip: '#E8C46A', stalk: '#C99A43', leafHex: '#6BB040',
    recolor: { Yellow: '#E8B84A' } },
  carrot: { arch: 'root', proc: 'carrot', h: [0.24, 0.5, 0.62], layout: 'grid9', top: '#F08A2C', leafHex: '#5BB040' },
  corn: { arch: 'tall', proc: 'corn', h: [0.4, 1.05, 1.85], layout: 'rows6', cob: '#F2D04B', leafHex: '#6BB040', noFit: true },
  strawberry: { arch: 'bush', proc: 'strawberry', h: [0.22, 0.34, 0.4], layout: 'grid9', chunk: 1.25, berry: '#E2324C', leafHex: '#5DB24A', crease: 62, cover: 1.15 },
  potato: { arch: 'root', proc: 'potato', h: [0.3, 0.5, 0.62], layout: 'grid9', lift: -0.05, tuber: '#C9A06A', flower: '#D9C6F0', leafHex: '#5DA544', cover: 1.15 },
  tomato: { arch: 'bush', proc: 'tomato', h: [0.34, 0.9, 1.15], layout: 'rows6', fruitHex: '#E8463A', leafHex: '#4FA040', crease: 75, cover: 1.15 },
  sugarcane: { arch: 'tall', proc: 'cane', h: [0.4, 1.0, 1.75], layout: 'grid9', chunk: 1.1, cane: '#B7D86A', node: '#8DB84E', leafHex: '#7FC456' },
  pumpkin: { arch: 'ground', proc: 'gourd', vine: ['Pumpkin_1', 'Pumpkin_3', 'Pumpkin_3'], fruitSrc: 'Pumpkin_Crop',
    h: [0.3, 0.4, 0.45], wide: [0.45, 1.3, 1.5], layout: 'one', recolor: { Orange: '#F2852A' }, fruitSize: [0, 0.24, 0.62], fruits: 3, leafHex: '#4E9A3A' },
  sunflower: { arch: 'flower', proc: 'sunflower', h: [0.34, 1.05, 1.8], layout: 'grid9', chunk: 1.0, leafHex: '#5CB04B' },
  cabbage: { arch: 'ground', proc: 'cabbage', h: [0.18, 0.3, 0.42], layout: 'grid9', head: '#B6E08A', leafHex: '#7FC456' },
  oats: { arch: 'tall', proc: 'grain', h: [0.32, 0.7, 1.0], layout: 'rows12', tuft: 6, tufts: [3, 3, 3], ear: '#D9C88A', tip: '#E8DBA6', stalk: '#B5B06A', leafHex: '#7DBB4E',
    recolor: { Yellow: '#D8C27A', Green: '#7DBB4E' } },
  blueberry: { arch: 'bush', proc: 'berrybush', h: [0.3, 0.6, 0.74], layout: 'tri3', chunk: 1.15, leafHex: '#3F8A4A', berry: '#4A58C8', berryR: 0.075, berries: 16, crease: 76, cover: 1.15 },
  cotton: { arch: 'bush', proc: 'berrybush', h: [0.3, 0.64, 0.8], layout: 'tri3', chunk: 1.15, leafHex: '#557A3A', berry: '#FFFFFF', berryR: 0.06, berries: 10, crease: 76, cover: 1.15 },
  lavender: { arch: 'flower', proc: 'lavender', h: [0.24, 0.5, 0.66], layout: 'grid9', chunk: 1.2, leafHex: '#8FB592' },
  onion: { arch: 'root', proc: 'onion', h: [0.24, 0.5, 0.56], layout: 'grid9', top: '#D9A54A', leafHex: '#6FB04A', crease: 78 },
  watermelon: { arch: 'ground', proc: 'gourd', vine: ['Watermelon_1', 'Watermelon_3', 'Watermelon_3'], fruitSrc: 'Watermelon_Crop',
    h: [0.3, 0.4, 0.45], wide: [0.45, 1.3, 1.5], layout: 'one', recolor: { DarkGreen2: '#2F7A30', Green: '#5DAA45' }, fruitSize: [0, 0.24, 0.66], fruits: 3, leafHex: '#4E9A3A' },
  // wave 3 (M2): bell peppers on glossy bushes in red, orange and yellow; rice in a flooded paddy (a water sheen over the
  // soil) whose clumps nod golden panicles when ripe; the watermelon's stripes run pole to pole along the fruit
  pepper: { arch: 'bush', proc: 'pepper', h: [0.3, 0.6, 0.72], layout: 'grid4', fruitHex: '#E03C2E', leafHex: '#3F8F3A', crease: 70, cover: 1.1 },
  rice: { arch: 'tall', proc: 'rice', h: [0.3, 0.62, 0.86], layout: 'grid9', tufts: [1, 1, 1], leafHex: '#7CB84A', paddy: true },
  // wave 4 (owner wishes 1 and 7): raspberry canes heavy with deep-red berries, rose bushes in bloom, glossy coffee shrubs
  // whose cherries ripen red (section 17: raspberryPlant, rosePlant, coffeePlant)
  raspberry: { arch: 'bush', proc: 'raspberry', h: [0.3, 0.68, 0.84], layout: 'tri3', chunk: 1.1, leafHex: '#4E9A3E', berry: '#C21E48', crease: 70, cover: 1.15 },
  rose: { arch: 'flower', proc: 'rose', h: [0.26, 0.52, 0.66], layout: 'tri3', chunk: 1.1, leafHex: '#2F7A3A', bloom: '#D8243F', crease: 70, cover: 1.1 },
  coffee: { arch: 'bush', proc: 'coffee', h: [0.32, 0.72, 0.92], layout: 'tri3', chunk: 1.05, leafHex: '#2E6E36', cherry: '#C0262E', crease: 70, cover: 1.05 },
};
export const CROP_IDS = Object.keys(CROPS);
const SWAY_AMP = [0.3, 0.7, 1.6];
/** Triangle budgets per plot (performance-03) and the canopy share of the plot per growing stage (visual-04). */
// RD-04 (QA wave 2): a ripe plot may spend 640 (was 500) so mature crops read full: broad leaves, round berries and
// bolls, 12-14 petal sunflowers. A ripe field is a passing state (it is harvested), and 164 ripe plots stay < 105k.
export const CROP_BUDGET = Object.freeze({ seeded: 120, growing: 250, ripe: 640, far: 120 });
const COVER = [0.2, 0.45, 0.8];
const PLOT_AREA = 1.84 * 1.84;

const LAYOUTS = {
  one: [[0, 0]],
  grid4: [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]],
  tri3: [[-0.45, -0.38], [0.45, -0.3], [0, 0.42]],
  rows6: [[-0.5, -0.45], [0, -0.45], [0.5, -0.45], [-0.5, 0.45], [0, 0.45], [0.5, 0.45]],
  rows12: [-0.55, 0, 0.55].flatMap((z) => [-0.6, -0.2, 0.2, 0.6].map((x) => [x, z])),
  grid9: [-0.55, 0, 0.55].flatMap((z) => [-0.55, 0, 0.55].map((x) => [x, z])),
};

/** The footprint width (metres) of one plant so a layout of n plants covers `cover` of the plot. */
export const plantWidth = (n, cover) => 2 * Math.sqrt((cover * PLOT_AREA) / (Math.PI * n));

/** Scale a baked plant to height h (and footprint width w), centre it on x/z; keeps the soil line at y = 0. */
function sizePlant(g, h, w) {
  const b = bounds(g);
  const sy = h / Math.max(1e-3, b.max.y);
  const sxz = w ? w / Math.max(1e-3, Math.max(b.max.x - b.min.x, b.max.z - b.min.z)) : sy;
  g.scale(sxz, sy, sxz);
  const bb = bounds(g);
  g.translate(-(bb.min.x + bb.max.x) / 2, 0, -(bb.min.z + bb.max.z) / 2);
  return g;
}

/** Drop triangles that lie entirely below y (roots under the soil are never visible). */
export function clipBelow(g, y) {
  const src = g.index ? g.toNonIndexed() : g;
  const p = src.getAttribute('position');
  const keep = [];
  for (let f = 0; f < p.count / 3; f++) {
    if (Math.max(p.getY(f * 3), p.getY(f * 3 + 1), p.getY(f * 3 + 2)) >= y) keep.push(f);
  }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const a = src.getAttribute(name);
    const arr = new Float32Array(keep.length * 3 * a.itemSize);
    keep.forEach((f, i) => arr.set(a.array.subarray(f * 3 * a.itemSize, (f + 1) * 3 * a.itemSize), i * 3 * a.itemSize));
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  return out;
}

// ---- Low-poly procedural plants (performance-03 + visual-04): 25-55 triangles each, so a dense 9-plant plot
//      stays under 250 triangles growing and 500 ripe without a simplifier mangling stems and leaves.
/** An open-ended tapered stalk: 2 * seg triangles. */
function stalk(r0, r1, h, hex, seg = 3) { return xform(P(new THREE.CylinderGeometry(r1, r0, h, seg, 1, true), hex, { creaseDeg: 0 }), { y: h / 2 }); }
/** A low lumpy ball (an icosahedron, 20 triangles). */
const lump = (r, hex, o = {}, seed = 1) => xform(blob(r, hex, { detail: 0, amp: 0.12, seed, creaseDeg: 80, ...o.blob }), o);
/** n leaves fanning out from the base. */
function fan(n, len, wid, hexes, r, { bend = 0.6, seg = 2, y = 0, tilt = 0 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(xform(leaf(len * (0.85 + r() * 0.3), wid, hexes[i % hexes.length], { bend, seg }), { ry: (i / n) * Math.PI * 2 + r() * 0.5, y, rx: tilt }));
  return out;
}
function cornPlant(s, r) {
  // corn (RD-04, QA wave 2: "wiry"): a thick stalk carrying 7 broad (0.16-0.2 m), arching leaves in two ranks, and
  // when ripe two fat husked ears and a tassel; rows of 6 plants a plot, ~90 triangles a plant
  const c = CROPS.corn; const h = c.h[s] * (0.92 + r() * 0.16); const L = ['#5BA83E', '#6BB040', '#7CBB4A', '#4E9A38'];
  if (s === 0) return mergeAll([xform(leaf(0.3, 0.09, L[0], { bend: 0.5, seg: 1 }), { ry: r() }), xform(leaf(0.26, 0.09, L[1], { bend: 0.6, seg: 1 }), { ry: 2.4 }), xform(leaf(0.22, 0.08, L[2], { bend: 0.6, seg: 1 }), { ry: 4.4 })]);
  const parts = [stalk(0.065, 0.04, h * 0.94, s === 2 ? '#8FB24A' : '#6FAE45', 4)];
  const nl = s === 1 ? 5 : 7;
  const rank = r() * Math.PI;
  for (let i = 0; i < nl; i++) {
    // two ranks of leaves up the stalk, each arching out and over; the lowest of a ripe plant yellows a little
    const y = h * (0.1 + (0.72 * i) / nl);
    const len = h * (0.6 - 0.2 * (i / nl)) * (0.9 + r() * 0.2);
    const hex = s === 2 && i === 0 ? '#B8B85A' : L[(i + 1) % 4];
    const lf = leaf(len, s === 1 ? 0.2 : 0.3, hex, { bend: 1.0, seg: 2 });
    xform(lf, { rx: 0.55 + r() * 0.25 });
    xform(lf, { ry: rank + (i % 2) * Math.PI + (r() - 0.5) * 0.7, y });
    parts.push(lf);
  }
  if (s === 2) {
    for (const [k, y] of [[0, 0.52], [1, 0.4]]) {
      const a = rank + Math.PI / 2 + k * Math.PI + (r() - 0.5) * 0.5;
      // a fat cob (a 5-sided lathe) in two pale husk leaves, standing out from the stalk
      const cob = lathe([[0, 0], [0.075, 0.07], [0.082, 0.2], [0.05, 0.3], [0, 0.33]], 5, c.cob, 70);
      const ear = mergeAll([cob, xform(leaf(0.32, 0.13, '#A9D06A', { bend: -0.2, seg: 1 }), { y: -0.04, rz: 0.3 }),
        xform(leaf(0.3, 0.12, '#93C25A', { bend: -0.2, seg: 1 }), { y: -0.04, rz: -0.35, ry: Math.PI })]);
      xform(ear, { rz: 0.6 });
      xform(ear, { ry: a, x: Math.sin(a) * 0.06, y: h * y, z: Math.cos(a) * 0.06 });
      parts.push(ear);
    }
    // the tassel: three straw-gold sprays over the top
    for (let k = 0; k < 3; k++) parts.push(xform(leaf(0.24, 0.05, k ? '#E3C25E' : '#D9B04A', { bend: -0.5, seg: 1 }), { rx: 0.5, ry: k * 2.1 + r(), y: h * 0.92 }));
  } else parts.push(xform(leaf(0.16, 0.06, '#9CCB5A', { bend: 0.3, seg: 1 }), { y: h * 0.92 }));
  return mergeAll(parts);
}
function tomatoPlant(s, r, id = 'tomato') {
  // tomato (RD-04): a staked, bushy plant of three leafy masses with its fruit hanging on the outside (rows of six)
  const c = CROPS[id]; const h = c.h[s];
  if (s === 0) return mergeAll(fan(4, 0.2, 0.09, ['#4FA040', '#5DB24A'], r, { seg: 1, bend: 0.8 }));
  const parts = [stalk(0.02, 0.016, h, '#C9A26A')];                                   // the stake
  const masses = s === 1 ? [[0, 0.5, 0.3]] : [[0, 0.62, 0.27], [0.13, 0.36, 0.25], [-0.12, 0.3, 0.23]];
  masses.forEach(([dx, y, rr], i) => {
    const a = r() * Math.PI * 2;
    parts.push(lump(h * rr, i % 2 ? '#5DB24A' : '#4FA040', { x: dx * Math.cos(a) * h * 1.6, y: h * y, z: dx * Math.sin(a) * h * 1.6, blob: { sy: 1.05, amp: 0.16 } }, 3 + Math.floor(r() * 9)));
  });
  const n = s === 1 ? 1 : 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.6; const rad = h * 0.3;
    const hex = s === 2 ? (i === 3 ? '#F08A3A' : c.fruitHex) : '#8DBE4A';
    parts.push(xform(P(new THREE.OctahedronGeometry(c.pepper ? 0.065 : (s === 2 ? 0.1 : 0.06), 0), hex, { creaseDeg: 80 }), { x: Math.cos(a) * rad, y: h * (0.3 + r() * 0.35), z: Math.sin(a) * rad, sy: c.pepper ? 1.6 : 0.88 }));
  }
  return mergeAll(parts);
}
/** A bell pepper (wave 3, M2): a squarish bell, wider at the shoulders, four soft lobes at the bottom, a green cap and
 *  stem; ~30 triangles. */
function bellPepper(hex, sz = 0.07) {
  const g = new THREE.CylinderGeometry(sz, sz * 0.78, sz * 1.5, 6, 1);
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i)); const lobe = 1 + 0.12 * Math.cos(a * 4);
    p.setX(i, p.getX(i) * lobe); p.setZ(i, p.getZ(i) * lobe);
    if (p.getY(i) < -sz * 0.7) p.setY(i, p.getY(i) - 0.012 * Math.cos(a * 4));
  }
  return mergeAll([P(g, hex, { creaseDeg: 70 }), xform(P(new THREE.ConeGeometry(sz * 0.55, sz * 0.25, 5), '#3F7F2A'), { y: sz * 0.8 }), cyl(0.008, 0.01, sz * 0.5, 3, '#4E8A30', { y: sz * 0.85 }, 0)]);
}
function pepperPlant(s, r) {
  // bell pepper (wave 3): two or three glossy dark leafy masses on a short stem, the peppers hanging on the outside where
  // the camera sees them: green while growing, ripe in red with now and then an orange or a yellow one
  const c = CROPS.pepper; const h = c.h[s];
  if (s === 0) return mergeAll(fan(4, 0.18, 0.09, ['#3F8F3A', '#4FA040'], r, { seg: 1, bend: 0.8 }));
  // a small leafy core and a ring of broad glossy leaves arching out; the peppers hang between them, outside
  const parts = [stalk(0.022, 0.015, h * 0.5, '#5E8A34', 3), lump(h * 0.24, '#3F8F3A', { y: h * 0.62, blob: { sy: 0.9, amp: 0.15 } }, 3 + Math.floor(r() * 9))];
  const nl = s === 1 ? 6 : 8;
  for (let i = 0; i < nl; i++) {
    const lf = leaf(h * 0.55, 0.16, i % 2 ? '#4FA040' : '#3F8F3A', { bend: 0.9, seg: 1 });
    xform(lf, { rx: 0.45 + r() * 0.2 });
    xform(lf, { ry: (i / nl) * Math.PI * 2 + r() * 0.3, y: h * (0.32 + (i % 2) * 0.14) });
    parts.push(lf);
  }
  const n = s === 1 ? 2 : 4;
  const ripeCols = [c.fruitHex, '#F28C1E', c.fruitHex, '#F2C230'];
  const a0 = r() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + Math.PI / nl; const rad = h * 0.32;
    const hex = s === 2 ? ripeCols[(i + Math.floor(r() * 2)) % 4] : '#5FA83A';
    parts.push(xform(bellPepper(hex, s === 2 ? 0.085 : 0.055), { x: Math.cos(a) * rad, y: h * (0.22 + (i % 2) * 0.14), z: Math.sin(a) * rad, rz: (r() - 0.5) * 0.3 }));
  }
  return mergeAll(parts);
}
/** Rice (wave 3): a clump of tillers, slim blades fanning out; ripe, golden panicles nod over on their stems. */
function ricePlant(s, r) {
  const c = CROPS.rice; const h = c.h[s] * (0.9 + r() * 0.2);
  const blades = s === 0 ? 4 : s === 1 ? 7 : 6;
  const parts = [];
  const green = s === 2 ? ['#9CB84E', '#B5C25A', '#8FAE48'] : ['#6BB040', '#7CBB4A', '#5BA83E'];
  for (let i = 0; i < blades; i++) {
    const lf = leaf(h * (0.75 + r() * 0.3), 0.045, green[i % 3], { bend: 0.45 + r() * 0.3, seg: 1 });
    xform(lf, { rx: 0.25 + r() * 0.2 });
    xform(lf, { ry: (i / blades) * Math.PI * 2 + r() * 0.4 });
    parts.push(lf);
  }
  if (s >= 1) {
    const np = s === 2 ? 4 : 2;
    for (let k = 0; k < np; k++) {
      const a = (k / np) * Math.PI * 2 + r();
      const st = xform(leaf(h * 0.95, 0.02, s === 2 ? '#C9B85A' : '#7CBB4A', { bend: 0.05, seg: 1 }), { ry: a, rx: 0.12 });
      // the panicle: two crossed drooping cards of grain hanging from the top of the stem
      const pan = mergeAll([0, 1].map((q) => xform(leaf(h * (s === 2 ? 0.34 : 0.22), 0.07, s === 2 ? (q ? '#E3CC6A' : '#D4B654') : '#A8CF6A', { bend: 0.35, seg: 1 }), { ry: q * Math.PI / 2 })));
      xform(pan, { rx: Math.PI - (s === 2 ? 0.55 : 0.25) });
      xform(pan, { ry: a, x: Math.sin(a) * h * 0.1, y: h * 0.92, z: Math.cos(a) * h * 0.1 });
      parts.push(st, pan);
    }
  }
  return mergeAll(parts);
}
/** A round, cupped leaf (cabbage, pumpkin): a fan of 5 triangles over a half-ellipse, the rim lifted, lying along
 *  +y from the base like leaf(). */
function roundLeaf(len, wid, hex, { cup = 0.3, n = 5 } = {}) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI;                                  // half an ellipse from one side round the tip
    const x = Math.cos(t) * wid * 0.5; const y = len * (0.5 + Math.sin(t) * 0.5) * (i === 0 || i === n ? 0.35 : 1);
    pts.push([x, y, Math.abs(x) / (wid * 0.5) * cup * len * 0.4 + (y / len) ** 2 * cup * len * 0.2]);
  }
  const pos = [];
  for (let i = 0; i < n; i++) pos.push(0, 0, 0, ...pts[i], ...pts[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  paint(g, hex);
  return g;
}
function cabbagePlant(s, r) {
  // cabbage (VISUAL-AFTER B1): 6-8 broad, cupped blue-green outer leaves spanning 1.5-1.8x the pale head, the head
  // itself layered from a ball and two wrapping leaves; ~50 triangles
  const c = CROPS.cabbage; const h = c.h[s];
  const outer = ['#6FA86A', '#7DB86E', '#5E9E62'];
  const parts = [];
  const n = s === 0 ? 4 : s === 1 ? 5 : 6;
  for (let i = 0; i < n; i++) {
    const len = (s === 0 ? 0.15 : h * (s === 1 ? 0.95 : 0.9)) * (0.9 + r() * 0.2);
    const wid = len * 0.95;
    const lf = s === 0 ? leaf(len, wid * 0.8, outer[i % 3], { bend: 0.2, seg: 1 }) : roundLeaf(len, wid, outer[i % 3], { cup: 0.55, n: s === 1 ? 3 : 4 });
    xform(lf, { rx: s === 0 ? 1.15 : 1.0 + r() * 0.2 });
    xform(lf, { ry: (i / n) * Math.PI * 2 + r() * 0.4, y: 0.01 });
    parts.push(lf);
  }
  if (s >= 1) {
    const hr = h * (s === 1 ? 0.3 : 0.42);
    parts.push(s === 1 ? xform(P(new THREE.OctahedronGeometry(hr, 0), '#A9D88A', { creaseDeg: 80 }), { y: hr * 0.85, sy: 0.85 })
      : xform(blob(hr, c.head, { detail: 0, amp: 0.06, seed: 5 + Math.floor(r() * 9), sy: 0.9, creaseDeg: 80 }), { y: hr * 0.85 }));
    for (let k = 0; k < 1; k++) {
      const wrap = roundLeaf(hr * 1.7, hr * 1.9, '#9ED07E', { cup: 0.9, n: 4 });
      xform(wrap, { rx: 0.35, y: 0.02 });
      xform(wrap, { ry: k * Math.PI + r() });
      parts.push(wrap);
    }
  }
  return mergeAll(parts);
}
function carrotPlant(s, r, id = 'carrot') {
  // carrot (RD-04): a full, feathery top of broad fronds; when ripe the orange shoulder shows
  const c = CROPS[id]; const h = c.h[s];
  const parts = fan(s === 0 ? 3 : s === 1 ? 5 : 7, h, s === 0 ? 0.05 : s === 1 ? 0.1 : 0.13, ['#5BB040', '#4E9F3A', '#6BBF45'], r, { seg: s === 0 ? 1 : 2, bend: 0.55, tilt: s ? 0.25 : 0 });
  if (s === 2) parts.push(xform(P(new THREE.ConeGeometry(0.09, 0.16, 5, 1, true), c.top, { creaseDeg: 60 }), { rx: Math.PI, y: 0.07 }));   // the shoulder shows
  return mergeAll(parts);
}
function potatoPlant(s, r) {
  // potato (RD-04): a low leafy mound with three branching stems of oval leaflets over it, pale lilac flowers on
  // top, and when ripe a tuber peeking from the soil; ~63 triangles
  const c = CROPS.potato; const h = c.h[s];
  const L = ['#5DA544', '#4E9A3A', '#6BB050'];
  if (s === 0) return mergeAll([0, 1, 2].map((i) => xform(leaf(0.13, 0.09, L[i], { bend: 0.9, seg: 1 }), { rx: 0.5, ry: i * 2.1 + r() })));
  // the ripe plant's low leafy mound covers the soil under the stems
  const parts = s === 2 ? [xform(blob(h * 0.42, '#55A040', { detail: 0, amp: 0.2, seed: 4 + Math.floor(r() * 9), sy: 0.55, flatBottom: 0.3, creaseDeg: 80 }), { y: h * 0.12 })] : [];
  const ns = 3;
  for (let i = 0; i < ns; i++) {
    const a = (i / ns) * Math.PI * 2 + r() * 0.5;
    const len = h * (0.75 + r() * 0.3);
    const lean = 0.35 + r() * 0.25;
    const st = [stalk(0.014, 0.01, len, '#6E9A44', 2)];
    for (const side of [-1, 1]) st.push(xform(leaf(0.15, 0.1, L[(i + (side > 0 ? 1 : 0)) % 3], { bend: 0.3, seg: 1 }), { rz: side * 1.05, y: len * 0.62 }));
    st.push(xform(leaf(0.14, 0.1, L[i % 3], { bend: 0.2, seg: 1 }), { y: len * 0.96 }));
    const g = mergeAll(st);
    xform(g, { rx: lean });
    xform(g, { ry: a });
    parts.push(g);
  }
  if (s >= 1) { const a = r() * Math.PI * 2; parts.push(xform(flatFlower(r() < 0.5 ? '#FFFFFF' : c.flower, 0.06), { x: Math.cos(a) * h * 0.3, y: h * 0.84, z: Math.sin(a) * h * 0.3 })); }
  if (s === 2) parts.push(xform(P(new THREE.OctahedronGeometry(0.08, 0), c.tuber, { creaseDeg: 80 }), { x: h * 0.34, y: 0.03, z: 0.05, sy: 0.7 }));
  return mergeAll(parts);
}
/** Sugarcane (procedural, cheap): a few jointed canes with long arching leaves. */
function canePlant(s, r) {
  const c = CROPS.sugarcane;
  const h = c.h[s];
  const parts = [];
  const n = [2, 3, 3][s];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.5; const d = n > 1 ? 0.06 : 0;
    const hh = h * (0.8 + r() * 0.25);
    const stalk = mergeAll([cyl(0.022, 0.03, hh, 4, c.cane, {}, 0), ...[0.33, 0.66].map((k) => cyl(0.034, 0.034, 0.03, 4, c.node, { y: hh * k }, 0))]);
    xform(stalk, { rz: (r() - 0.5) * 0.18, x: Math.cos(a) * d, z: Math.sin(a) * d });
    parts.push(stalk);
    parts.push(xform(leaf(h * 0.55, 0.06, i % 2 ? '#7FC456' : '#6BB040', { bend: 0.9, seg: 2 }), { ry: a, y: hh * 0.55, x: Math.cos(a) * d, z: Math.sin(a) * d }));
  }
  return mergeAll(parts);
}

function strawberryPlant(s, r) {
  // strawberry (RD-04, QA wave 2: "red squares"): a rosette of broad, cupped leaves; ripe berries are tapered
  // 8-segment cones with a green leafy cap, lying on the leaves so the plot reads red; ~56 triangles
  const c = CROPS.strawberry; const h = c.h[s];
  // the ripe plant: a low, leafy mound (no bare soil under it) with broad leaves fanning over it
  const parts = s === 2 ? [xform(blob(0.17, '#4FA040', { detail: 0, amp: 0.18, seed: 2 + Math.floor(r() * 9), sy: 0.5, flatBottom: 0.3, creaseDeg: 80 }), { y: 0.05 })] : [];
  const nl = [4, 4, 4][s];
  for (let i = 0; i < nl; i++) {
    const len = (s === 0 ? 0.12 : 0.2) * (0.9 + r() * 0.2);
    const lf = s === 0 ? leaf(len, len * 0.7, '#5DB24A', { bend: 0.5, seg: 1 }) : roundLeaf(len * 1.15, len * 1.2, i % 2 ? '#4FA040' : '#5DB24A', { cup: 0.25, n: 3 });
    xform(lf, { rx: s === 2 ? 1.2 + r() * 0.2 : 0.95 + r() * 0.25 });
    xform(lf, { ry: (i / nl) * Math.PI * 2 + r() * 0.4, y: h * 0.25 });
    parts.push(lf);
  }
  if (s === 1) {
    const a = r() * Math.PI * 2;
    parts.push(xform(flatFlower('#FFFDF4', 0.055), { x: Math.cos(a) * 0.1, y: h * 0.8, z: Math.sin(a) * 0.1 }));
  }
  if (s === 2) for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + r() * 0.5; const rad = 0.09 + r() * 0.06;
    // the berry: a plump tapered cone, point down and out, under a 4-lobed green cap, resting on the mound
    const berry = mergeAll([xform(P(new THREE.ConeGeometry(0.075, 0.15, 8, 1, true), c.berry, { creaseDeg: 70 }), { rx: Math.PI, y: -0.075 }),
      xform(P(new THREE.CircleGeometry(0.07, 4), '#3F9A3A'), { rx: -Math.PI / 2, ry: r(), y: 0.004 })]);
    xform(berry, { rx: 1.0 });
    xform(berry, { ry: a, x: Math.sin(a) * rad, y: h * (0.6 + r() * 0.15), z: Math.cos(a) * rad });
    parts.push(berry);
  }
  return mergeAll(parts);
}

function berryBush(id, s, r) {
  // blueberry and cotton bushes (RD-04, QA wave 2: "blue shards", "white stones"): a three-lobed bush; blueberries
  // hang in round clusters of four (smooth-shaded, a pale bloom on one), cotton opens bolls of three white lobes over
  // a brown bract on a dark, red-stemmed bush; <= 160 triangles a bush (4 a plot)
  const c = CROPS[id];
  const h = c.h[s];
  const cotton = id === 'cotton';
  const parts = [];
  // one lumpy, round bush (a subdivided icosphere: a soft silhouette, not a faceted boulder)
  const seed = Math.floor(r() * 1000);
  parts.push(xform(blob(h * 0.5, boost(lin(c.leafHex), 0, 0.04).getStyle(), { seed, amp: 0.22, freq: 2.4, flatBottom: 0.55, sy: 0.82, sx: 1.12, detail: 1 }), { y: h * 0.4 }));
  let g = mergeAll(parts);
  shade(g, { bottom: 0.6, top: 1.12 });
  if (s >= 1) {
    const b = bounds(g);
    const dots = [];
    const k = s === 2 ? 4 : 2;
    for (let i = 0; i < k; i++) {
      // on the outside of the upper half, where the camera sees them
      const u = (i / k) * Math.PI * 2 + r() * 0.6; const v = cotton ? 0.7 + r() * 0.25 : 0.45 + r() * 0.35;
      const rx = (b.max.x - b.min.x) * 0.46; const rz = (b.max.z - b.min.z) * 0.46; const ry = b.max.y;
      const at = { x: Math.cos(u) * rx * Math.sin(v * Math.PI * 0.55 + 0.5), y: ry * (0.35 + 0.62 * v), z: Math.sin(u) * rz * Math.sin(v * Math.PI * 0.55 + 0.5) };
      if (cotton) {
        if (s === 2) {
          // an open boll: three round white lobes (0.14 m across) on a brown star of bracts
          const boll = [xform(P(new THREE.CircleGeometry(0.1, 3), '#7A5A3A'), { rx: -Math.PI / 2, y: -0.01 })];
          for (let q = 0; q < 3; q++) {
            const qa = (q / 3) * Math.PI * 2 + 0.3;
            boll.push(xform(P(new THREE.OctahedronGeometry(0.07, 0), q === 1 ? '#F4F0E6' : '#FFFDF8'), { x: Math.cos(qa) * 0.05, y: 0.04, z: Math.sin(qa) * 0.05, sy: 0.85 }));
          }
          dots.push(xform(mergeAll(boll), { ...at, y: at.y + 0.04, rx: (r() - 0.5) * 0.4 }));
        } else dots.push(xform(P(new THREE.OctahedronGeometry(0.045, 0), '#9DBA6A'), at));
      } else {
        // a cluster of four round berries (dusty blue, one with a lighter bloom)
        const nq = s === 2 ? 3 : 2;
        for (let q = 0; q < nq; q++) {
          const qa = (q / nq) * Math.PI * 2 + i;
          const hex = s === 2 ? (q === 1 ? '#7682D8' : q === 3 ? '#3A47A8' : c.berry) : '#9DBA6A';
          dots.push(xform(P(new THREE.OctahedronGeometry(c.berryR * (s === 2 ? 1 : 0.6), 0), hex), { x: at.x + Math.cos(qa) * c.berryR * 1.1, y: at.y - (q % 2) * 0.04, z: at.z + Math.sin(qa) * c.berryR * 1.1, sy: 0.9 }));
        }
      }
    }
    g = mergeAll([g, ...dots]);
  }
  return g;
}
/** Grain (wheat, oats): blades, then a stalk with an ear that ripens golden and nods (cheap: ~30 tris). */
function grainPlant(id, s, r) {
  // grain (VISUAL-AFTER B6): ripe wheat is a straw stalk under a fat golden ear (1.5x the old width) with a lighter
  // tip; oats hang their pale ears over in a nod. Height varies +-12 %. Five triangles a stalk, so a plot holds
  // 1.4x the stalks of wave 1 within the 500-triangle budget.
  const c = CROPS[id];
  const h = c.h[s] * (0.88 + r() * 0.24);
  if (s === 0) return mergeAll([0, 1, 2].map((i) => xform(leaf(h, 0.05, i % 2 ? '#6BB040' : '#5A9E38', { bend: 0.5, seg: 1 }), { ry: (i / 3) * 6.28 + r() })));
  const ripe = s === 2;
  const oats = id === 'oats';
  const stalkHex = ripe ? c.stalk : '#6FAE45';
  const earHex = ripe ? c.ear : '#9CCB5A';
  const st = xform(leaf(h * 0.8, 0.035, stalkHex, { bend: 0.05, seg: 1 }), { ry: r() * 3 });
  const earLen = h * (oats ? 0.24 : 0.28);
  if (oats && !ripe) {
    // growing oats: two crossed spikelet kites nod from the top of the stalk (6 triangles a stalk)
    const sp = mergeAll([0, 1].map((k) => xform(leaf(earLen, 0.075, k ? earHex : boost(lin(earHex), 0, 0.05).getStyle(), { bend: 0.2, seg: 1 }), { ry: k * Math.PI / 2 })));
    xform(sp, { rx: Math.PI - 0.5 });
    const og = mergeAll([st, xform(sp, { y: h * 0.8, z: 0.02 })]);
    xform(og, { rz: (r() - 0.5) * 0.28 });
    return og;
  }
  if (oats) {
    // ripe oats (RD-04, QA wave 2: "scattered slivers"): an open panicle of six drooping spikelets hanging from branch
    // points along the top of the stalk (14 triangles a stalk, three stalks a spot)
    const pan = [st];
    for (let k = 0; k < 6; k++) {
      const a = k * 2.4 + r() * 0.5; const y = h * (0.66 + 0.04 * (k % 3)) + (k > 2 ? h * 0.08 : 0);
      const sp = leaf(earLen * (0.85 + r() * 0.3), 0.07, k % 2 ? earHex : boost(lin(earHex), 0, 0.06).getStyle(), { bend: 0.25, seg: 1 });
      xform(sp, { rx: Math.PI - 0.75 - r() * 0.3 });
      xform(sp, { ry: a, x: Math.sin(a) * 0.03, y, z: Math.cos(a) * 0.03 });
      pan.push(sp);
    }
    const og = mergeAll(pan);
    xform(og, { rz: (r() - 0.5) * 0.28 });
    return og;
  }
  const ear = xform(P(new THREE.ConeGeometry(0.054, earLen, 3, 1, true), earHex, { creaseDeg: 70 }), { rx: Math.PI });
  // a lighter tip: the ear's apex vertices
  if (ripe) { const cc = ear.getAttribute('color'); const pp = ear.getAttribute('position'); const tip = lin(c.tip || '#E8C46A'); for (let i = 0; i < pp.count; i++) if (pp.getY(i) < -earLen * 0.2) cc.setXYZ(i, tip.r, tip.g, tip.b); }
  const head = mergeAll([ear]);
  xform(head, { y: h * 0.8 + earLen / 2 });
  const g = mergeAll([st, head]);
  xform(g, { rz: (r() - 0.5) * 0.28, rx: ripe ? 0.1 : 0 });
  return g;
}
function onionPlant(s, r) {
  // onion (RD-04, QA wave 2: "yellow lumps"): four tall, hollow blue-green leaves; when ripe a round, tapering bulb
  // (a 5-sided lathe, papery bronze darkening to the root) sits half out of the soil under a narrow neck
  const c = CROPS.onion; const h = c.h[s];
  const parts = [];
  const n = s === 0 ? 2 : 4;
  for (let i = 0; i < n; i++) parts.push(xform(leaf(h * (0.85 + r() * 0.3), 0.05, i % 2 ? '#6FB04A' : '#5E9E52', { bend: 0.25 + r() * 0.35, seg: s === 0 ? 1 : 2 }), { ry: (i / n) * 6.28 + r() * 0.5, y: s === 2 ? 0.13 : 0 }));
  if (s >= 1) {
    const k = s === 2 ? 1 : 0.55;
    const bulb = lathe([[0, -0.02], [0.1 * k, 0.04 * k], [0.115 * k, 0.1 * k], [0.06 * k, 0.17 * k], [0.022, 0.21 * k]], 5, s === 2 ? c.top : '#D9E0A6', 78);
    // a darker root end, a lighter shoulder
    const cc = bulb.getAttribute('color'); const pp = bulb.getAttribute('position');
    const lo = lin(s === 2 ? '#B0702C' : '#C9D08A'); const hi = lin(s === 2 ? '#EAC066' : '#E3E8B8'); const t = new THREE.Color();
    for (let i = 0; i < pp.count; i++) { t.copy(lo).lerp(hi, Math.min(1, Math.max(0, pp.getY(i) / (0.17 * k)))); cc.setXYZ(i, t.r, t.g, t.b); }
    parts.push(xform(bulb, { y: -0.03 }));
  }
  return mergeAll(parts);
}

function lavenderPlant(s, r) {
  // lavender (RD-04, QA wave 2: "flat purple spikes"): a silver-green mound under a clustered fan of eight flower
  // spikes, each a slim grey-green stem with a plump purple head on its top third, so the clump reads as one mass
  // of purple; ~68 triangles
  const h = CROPS.lavender.h[s];
  const parts = [xform(blob(h * 0.34, '#7FA77E', { seed: 3 + Math.floor(r() * 5), amp: 0.25, sy: 0.62, flatBottom: 0.5, detail: 0 }), { y: h * 0.12 })];
  const n = [1, 1, 8][s];
  const P2 = ['#9474D2', '#A98BE0', '#8466C4'];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.4; const lean = 0.12 + r() * 0.36; const len = h * (0.82 + r() * 0.25);
    const st = [leaf(len * 0.7, 0.022, '#7E9E78', { bend: 0.05, seg: 1 })];
    st.push(xform(P(new THREE.ConeGeometry(s === 2 ? 0.05 : 0.03, len * 0.45, 4, 1, true), s === 2 ? P2[i % 3] : '#A9C79A', { creaseDeg: 70 }), { y: len * 0.55 }));
    const sg = mergeAll(st);
    xform(sg, { rz: lean, ry: a });
    parts.push(sg);
  }
  return mergeAll(parts);
}
/** A ribbed pumpkin (8-10 broad ribs, a shaded underside, a curved stem) or a striped watermelon, radius rad. */
function gourd(id, rad, ripe, r) {
  const melon = id === 'watermelon';
  const seg = melon ? 10 : 10; const rows = 6;
  const g = new THREE.SphereGeometry(1, seg, rows);
  g.deleteAttribute('uv');
  // a melon lies on its side: its poles (and so its pole-to-pole stripes, one per longitude slice) run along x
  if (melon) g.rotateZ(Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i); let y = p.getY(i); let z = p.getZ(i);
    const a = Math.atan2(z, x);
    const rib = melon ? 1 : 1 - 0.085 * (1 - Math.abs(Math.cos(a * 5)));
    x *= rib; z *= rib;
    y *= melon ? 0.82 : 0.68;                                    // pumpkins sit squat, melons long-ish
    if (y < -0.5) y = -0.5 + (y + 0.5) * 0.3;                    // a flat-ish bottom on the ground
    p.setXYZ(i, x * rad * (melon ? 1.25 : 1), y * rad, z * rad);
  }
  const x = g.toNonIndexed();
  const col = new Float32Array(x.getAttribute('position').count * 3);
  const base = lin(ripe ? (melon ? '#86C45E' : '#F2852A') : '#8FC456'); const dark = lin(ripe ? (melon ? '#245E28' : '#D86A1E') : (melon ? '#5E9A3A' : '#6FA840'));
  const xp = x.getAttribute('position'); const cc = new THREE.Color();
  for (let i = 0; i < xp.count; i++) {
    let stripe;
    if (melon) {
      // per face: the face's longitude slice round the x axis, every other slice dark (crisp stripes, no speckle)
      const f = Math.floor(i / 3) * 3;
      const cy = (xp.getY(f) + xp.getY(f + 1) + xp.getY(f + 2)) / 3; const cz = (xp.getZ(f) + xp.getZ(f + 1) + xp.getZ(f + 2)) / 3;
      const slice = Math.floor(((Math.atan2(cz, cy) + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / seg));
      stripe = slice % 2 ? 1 : 0.15;
    } else stripe = (1 - Math.abs(Math.cos(Math.atan2(xp.getZ(i), xp.getX(i)) * 5))) ** 2;
    cc.copy(base).lerp(dark, melon ? stripe * 0.92 : stripe * 0.55);
    const k = 0.72 + 0.36 * Math.min(1, Math.max(0, (xp.getY(i) / rad + 0.5)));   // shaded underside
    col[i * 3] = cc.r * k; col[i * 3 + 1] = cc.g * k; col[i * 3 + 2] = cc.b * k;
  }
  x.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const body = crease(x, 70);
  const parts = [body];
  if (!melon) {
    const stem = xform(cyl(rad * 0.09, rad * 0.13, rad * 0.32, 5, ripe ? '#6E7A3A' : '#5E9A3A', {}, 40), { y: rad * 0.6, rz: 0.35 + r() * 0.3 });
    parts.push(stem);
  }
  return mergeAll(parts);
}
async function gourdPlant(id, s, r) {
  // a sprawling vine: broad leaves lying on the soil, a curl of vine, and 1 / 3 fruits (VISUAL-AFTER B8: pumpkins
  // with ribs and a curved stem, leaves beside the fruit rather than over it, sizes 0.8-1.15x)
  const c = CROPS[id];
  const parts = [];
  const nLeaves = [4, 7, 8][s];
  const spread = c.wide[s] * 0.42;
  for (let i = 0; i < nLeaves; i++) {
    const a = (i / nLeaves) * Math.PI * 2 + r() * 0.5;
    const len = (s === 0 ? 0.2 : 0.5) * (0.85 + r() * 0.3);
    const lf = roundLeaf(len, len * 1.05, i % 2 ? '#4E9A3A' : '#5DAA45', { cup: 0.35, n: 4 });
    xform(lf, { rx: 1.2 });
    xform(lf, { ry: a, x: Math.sin(a) * spread * 0.55, y: 0.04, z: Math.cos(a) * spread * 0.55 });
    parts.push(lf);
  }
  if (s >= 1) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      parts.push(xform(cyl(0.018, 0.018, spread * 1.1, 3, '#5E9A3A', {}, 0), { rz: Math.PI / 2 - 0.05, ry: a, x: Math.cos(a) * spread * 0.4, y: 0.03, z: -Math.sin(a) * spread * 0.4 }));
    }
    const spots = s === 2 ? [[-0.34, 0.22, 1.0], [0.36, -0.1, 1.12], [-0.05, -0.42, 0.82]] : [[-0.25, 0.1, 1]];
    for (const [x, z, k] of spots.slice(0, s === 2 ? c.fruits : 1)) {
      const rad = c.fruitSize[s] * 0.5 * k;
      parts.push(xform(gourd(id, rad, s === 2, r), { x, y: rad * 0.42, z, ry: r() * 6.28 }));
    }
  }
  return mergeAll(parts);
}
function addFruit(g, f, s, r) {
  if (s === 0) return g;
  const b = bounds(g);
  const out = [g];
  const n = s === 2 ? f.n : 1;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2; const rad = (b.max.x - b.min.x) * (0.22 + r() * 0.12);
    const y = b.max.y * (0.45 + r() * 0.35);
    const hex = s === 2 ? f.hex : '#7FB547';
    // eight-triangle fruit (an octahedron, creased round): a field of tomatoes stays inside its budget
    const R = f.r * (s === 2 ? 1 : 0.6);
    const geo = xform(P(new THREE.OctahedronGeometry(R, 0), hex, { creaseDeg: 80 }), { x: Math.cos(a) * rad, y, z: Math.sin(a) * rad, sy: f.pepper ? 1.5 : 0.85 });
    out.push(geo);
  }
  return mergeAll(out);
}

async function cropPlant(id, s, r, opts = {}) {
  const c = CROPS[id];
  let g;
  if (c.proc === 'sunflower') g = sunflowerPlant(s, r, opts);
  else if (c.proc === 'cane') g = canePlant(s, r);
  else if (c.proc === 'corn') g = cornPlant(s, r);
  else if (c.proc === 'tomato') g = tomatoPlant(s, r, id);
  else if (c.proc === 'pepper') g = pepperPlant(s, r);
  else if (c.proc === 'rice') g = ricePlant(s, r);
  else if (c.proc === 'cabbage') g = cabbagePlant(s, r);
  else if (c.proc === 'carrot') g = carrotPlant(s, r, id);
  else if (c.proc === 'potato') g = potatoPlant(s, r);
  else if (c.proc === 'strawberry') g = strawberryPlant(s, r);
  else if (c.proc === 'lavender') g = lavenderPlant(s, r);
  else if (c.proc === 'onion') g = onionPlant(s, r);
  else if (c.proc === 'grain') g = grainPlant(id, s, r);
  else if (c.proc === 'berrybush') g = berryBush(id, s, r);
  else if (c.proc === 'raspberry') g = raspberryPlant(s, r, opts);
  else if (c.proc === 'rose') g = rosePlant(s, r);
  else if (c.proc === 'coffee') g = coffeePlant(s, r, opts);
  else if (c.proc === 'gourd') g = await gourdPlant(id, s, r);
  else {
    g = sizePlant(await bakeStatic(QC(c.src[s]), { recolor: { ...GREEN, ...c.recolor }, sat: 0.2 }), c.h[s], c.wide && c.wide[s]);
    if (c.lift) g.translate(0, c.lift[s], 0);
    g = clipBelow(g, -0.02);
  }
  if (c.proc && c.proc !== 'potato') { const b = bounds(g); if (b.min.y > 0) g.translate(0, -b.min.y, 0); }   // plants stand in the soil
  if (c.fruit) g = addFruit(g, c.fruit, s, r);
  if (c.flowers && s >= 1) g = mergeAll([g, ...flowerDots(g, c.flowers, s === 2 ? 3 : 2, r)]);
  return g;
}

/** Potato blossoms (visual-04): small pale-lilac five-petal flowers on top of the leaves, not paper shards. */
function flowerDots(g, hex, n, r) {
  const b = bounds(g);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2; const rad = (0.2 + 0.4 * r()) * (b.max.x - b.min.x) * 0.5;
    out.push(xform(flatFlower(hex, 0.06), { x: Math.cos(a) * rad, y: b.max.y * (0.92 + 0.08 * r()), z: Math.sin(a) * rad }));
  }
  return out;
}

function sunflowerPlant(s, r, { far = false } = {}) {
  // sunflower (VISUAL-AFTER B2): a 15-20 % smaller head of 12 rounded petals around a domed brown centre, facing
  // the default camera +-15 degrees, heights +-10 %, two broad heart-shaped leaves; ~42 triangles. The head is
  // one sheet: crops draw double-sided, so the back of the petals is yellow too (RD-06), the disc brown.
  const h = CROPS.sunflower.h[s] * (0.9 + r() * 0.2);
  const parts = [stalk(0.034, 0.024, h, '#4E9A3A')];
  for (let i = 0; i < 2; i++) {
    const L = leaf(0.24 + 0.08 * s, 0.24 + 0.06 * s, i % 2 ? '#4FA042' : '#5CB04B', { bend: 0.75, seg: 1 });
    xform(L, { ry: (i * Math.PI) + r() * 0.6, y: h * (0.22 + 0.35 * i) });
    parts.push(L);
  }
  const head = s === 2 ? 0.3 : s === 1 ? 0.11 : 0;
  if (head) {
    const face = Math.PI / 4 + (r() - 0.5) * 0.52;
    const tilt = -0.55;
    const petals = [];
    // RD-04 (QA wave 2): 14 broad petals round a dark 12-sided seed disc
    const N = s === 2 ? (far ? 10 : 14) : 4;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const hex = s === 2 ? (k % 2 ? '#FFD66B' : '#F2C443') : '#7DB851';
      // a broad rounded petal: a base, two wide shoulders and a tip (3 triangles), alternating two yellows
      const r0 = head * 0.4; const r1 = head; const w = (Math.PI / N) * 1.15;
      const at = (ang, rad) => [Math.cos(ang) * rad, Math.sin(ang) * rad];
      const b0 = at(a - w * 0.5, r0); const b1 = at(a + w * 0.5, r0); const s0 = at(a - w * 0.62, r1 * 0.8); const s1 = at(a + w * 0.62, r1 * 0.8); const tip = at(a, r1);
      const tri = [b0, s0, tip, b0, tip, b1, tip, s1, b1];
      const zf = 0.006 * (k % 2);
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tri.flatMap(([x, y]) => [x, y, zf])), 3));
      pg.computeVertexNormals();
      paint(pg, hex);
      petals.push(pg);
    }
    // a domed centre: a low cone of 8 segments
    const disc = xform(P(new THREE.ConeGeometry(head * 0.44, head * 0.16, s === 2 ? 12 : 5, 1, true), s === 2 ? '#4A2E18' : '#6E9A44', { creaseDeg: 60 }), { rx: Math.PI / 2, z: head * 0.05 });
    const hd = mergeAll([...petals, disc]);
    // the head plane is xy facing +z: tilt it up a little and turn it toward the camera
    xform(hd, { rx: tilt });
    xform(hd, { ry: face, y: h - head * 0.1, x: 0.04, z: 0.04 });
    parts.push(hd);
  }
  return mergeAll(parts);
}
/** Stage 0, seeded (VISUAL-AFTER B3): a dark, moist dibbed hole in every planting spot with a pale seed in it and,
 *  on about a third of the spots, the first tiny green tips: 0-5 % green, so a sown bed reads "sown" (a regular
 *  grid of dark dimples) without looking like the sprouts of stage 1 (<= 120 triangles). */
function seededCluster(id, r) {
  const c = CROPS[id];
  const parts = [];
  const pts = LAYOUTS[c.layout === 'one' ? 'grid4' : c.layout];
  const hex = c.leafHex || '#6FB04A';
  const light = boost(lin(hex), 0, 0.08).getStyle();
  pts.forEach(([x, z], i) => {
    const jx = x + (r() - 0.5) * 0.08; const jz = z + (r() - 0.5) * 0.08;
    parts.push(xform(P(new THREE.CircleGeometry(0.105, 5), '#4A2A16'), { rx: -Math.PI / 2, ry: r() * 6.28, x: jx, y: PLOT_TOP + 0.026, z: jz }));
    parts.push(xform(P(new THREE.CircleGeometry(0.13, 5), '#8E5B33'), { rx: -Math.PI / 2, ry: r() * 6.28, x: jx, y: PLOT_TOP + 0.022, z: jz }));
    parts.push(xform(P(new THREE.CircleGeometry(0.03, 3), '#E8D5A8'), { rx: -Math.PI / 2, x: jx + 0.02, y: PLOT_TOP + 0.03, z: jz - 0.01 }));
    if (i % 3 === 1) for (const k of [0, 1]) parts.push(xform(leaf(0.07, 0.05, k ? light : hex, { bend: 1.2, seg: 1 }), { ry: k * Math.PI + r(), x: jx, y: PLOT_TOP + 0.026, z: jz }));
  });
  return mergeAll(parts);
}

async function cropCluster(id, s, { tufts = null } = {}) {
  const c = CROPS[id];
  const r = rng(`${id}:${s}`);
  const pts = LAYOUTS[c.layout];
  const parts = [];
  // grain thickens as it grows: 3 / 4 / 6 stalks a spot (the far key: 2)
  const tuft = tufts ?? (c.tufts ? c.tufts[s] : c.tuft ? [Math.ceil(c.tuft / 2), Math.ceil(c.tuft * 2 / 3), c.tuft][s] : 1);
  const budget = s === 2 ? CROP_BUDGET.ripe : CROP_BUDGET.growing;
  const per = (budget * 0.92) / (pts.length * tuft);
  // the canopy covers 20 / 45 / 80 % of the plot (grains are counted by their tufts instead)
  // (tall plants whose broad leaves overlap their neighbours keep their own spread: noFit, RD-04)
  // broadleaf crops close the canopy when ripe (RD-04: 70-85 % foliage cover; their outlines are not full circles)
  const width = c.layout !== 'one' && c.proc !== 'grain' && !(c.noFit && s > 0) ? plantWidth(pts.length, s === 2 && c.cover ? c.cover : COVER[s]) : null;
  // Two plant variants per cluster so neighbours differ a little.
  const variants = [];
  for (let v = 0; v < 2; v++) {
    let p0 = await cropPlant(id, s, rng(`${id}:${s}:v${v}`));
    if (width) {
      const b = bounds(p0);
      const k = Math.min(2.6, Math.max(0.45, width / Math.max(1e-3, Math.max(b.max.x - b.min.x, b.max.z - b.min.z))));
      p0.scale(k, 1, k);
    }
    if (tris(p0) > per * 1.1) p0 = await simplify(p0, Math.max(0.05, per / tris(p0)), { error: 0.04 });
    variants.push(p0);
  }
  let i = 0;
  for (const [x, z] of pts) {
    for (let t = 0; t < tuft; t++) {
      const g = variants[i++ % 2].clone();
      const ph = bounds(g).max.y;
      const k = 0.9 + r() * 0.2;
      const jitter = tuft > 1 ? 0.24 : 0.1;
      const dx = (r() - 0.5) * jitter;
      const dz = (r() - 0.5) * jitter;
      const ry = c.proc === 'sunflower' ? (r() - 0.5) * 0.5 : r() * Math.PI * 2;
      const ck = width ? 1 : (c.chunk || 1);
      xform(g, { sx: k * ck * (s === 2 ? 1.04 : 1), sy: k * (s === 2 ? 1.08 : 1), sz: k * ck * (s === 2 ? 1.04 : 1), ry });
      sway(g, { y0: 0, y1: ph * k, weight: c.arch === 'ground' ? 0.35 : 1 });
      xform(g, { x: x + dx, y: PLOT_TOP, z: z + dz });
      parts.push(g);
    }
  }
  // rice stands in a flooded paddy (wave 3): a sheet of shallow water over the soil, a lighter rim
  if (c.paddy && s >= 0) {
    parts.push(xform(P(new THREE.PlaneGeometry(1.66, 1.66), '#7FBDB8'), { rx: -Math.PI / 2, y: PLOT_TOP + 0.03 }),
      xform(P(new THREE.RingGeometry(0.62, 0.86, 4, 1, Math.PI / 4), '#A9D8D0'), { rx: -Math.PI / 2, y: PLOT_TOP + 0.032, sx: 1.12, sy: 1.12 }));
  }
  // round produce (berries, bolls, bulbs) shades smooth: their crops crease at a wider angle (RD-04)
  let g = crease(mergeAll(parts), c.crease || 45);
  // hard cap per plot (GDD §8.6: a 164-plot field near 120k triangles)
  if (tris(g) > budget) g = await simplify(g, budget / tris(g), { error: 0.05, deg: c.crease || 45 });     // keeps the sway weights
  return g;
}

/** The far-band key of a plot (~120 triangles): four plants of the same kind, spread to the same coverage. */
async function farCluster(id, s) {
  const c = CROPS[id];
  if (c.proc === 'grain') return cropCluster(id, s, { tufts: 1 });
  if (c.layout === 'one') {
    const g = await cropCluster(id, s);
    return tris(g) > CROP_BUDGET.far * 1.5 ? simplify(g, CROP_BUDGET.far / tris(g), { error: 0.1, deg: 45 }) : g;
  }
  const r = rng(`${id}:${s}:far`);
  const parts = [];
  const width = plantWidth(4, COVER[s]);
  for (const [x, z] of LAYOUTS.grid4) {
    const g = await cropPlant(id, s, r, { far: true });
    const b = bounds(g);
    const k = Math.min(3, Math.max(0.45, width / Math.max(1e-3, Math.max(b.max.x - b.min.x, b.max.z - b.min.z))));
    xform(g, { sx: k, sz: k, ry: c.proc === 'sunflower' ? 0 : r() * Math.PI * 2 });
    sway(g, { y0: 0, y1: bounds(g).max.y, weight: c.arch === 'ground' ? 0.35 : 1 });
    xform(g, { x: x * 1.05, y: PLOT_TOP, z: z * 1.05 });
    parts.push(g);
  }
  if (c.paddy) parts.push(xform(P(new THREE.PlaneGeometry(1.66, 1.66), '#7FBDB8'), { rx: -Math.PI / 2, y: PLOT_TOP + 0.03 }));
  let g = crease(mergeAll(parts), c.crease || 45);
  if (tris(g) > CROP_BUDGET.far * 1.6) g = await simplify(g, CROP_BUDGET.far / tris(g), { error: 0.1, deg: c.crease || 45 });
  return g;
}

for (const id of CROP_IDS) {
  job(`crop:${id}:0`, `crops/${id}.glb`, { family: 'crop', def: id, footprint: [1, 1], sway: 0, soil: PLOT_TOP },
    async () => sway(seededCluster(id, rng(`${id}:seed`)), { rigid: true }));
  for (let s = 0; s < 3; s++) {
    job(`crop:${id}:${s + 1}`, `crops/${id}.glb`, { family: 'crop', def: id, footprint: [1, 1], sway: SWAY_AMP[s], soil: PLOT_TOP, doubleSided: true },
      async () => cropCluster(id, s));
  }
  // far-band twins of the tall stages (objects-view swaps them in at the far zoom band); no `def`: not a stage
  for (const s of [1, 2]) {
    job(`crop:${id}:${s + 1}:far`, `crops/${id}.glb`, { family: 'crop', footprint: [1, 1], sway: SWAY_AMP[s], soil: PLOT_TOP, doubleSided: true, part: true },
      async () => farCluster(id, s));
  }
}
job('plot', 'plots/plot.glb', { family: 'plot', def: 'plot', footprint: [1, 1], soil: PLOT_TOP }, async () => plotMound());

// ---- Giant crops (GDD §6.2 mechanic 8, M1b): a 3 x 3 block ripens as ONE trophy-sized crop. The giant sits on a
//      single leafy bed over the nine plots (render-world draws it over the block, footprint 3 x 3, soil at PLOT_TOP):
//      the produce itself, 2.5-3.5 m, lying or standing like the crop does, in the crop's own ready hue, so a giant
//      pumpkin reads as a pumpkin from the far zoom. `:giant:2` is the same giant still green at 70 % size, half
//      hidden in leaves (the "it is going to be a giant" stage). <= 2,500 triangles (nine ripe plots are 4,500).
const GIANT_BUDGET = 2500;
/** The leafy 3x3 bed: a low soil mound 5.6 m across and a ring of big leaves in the crop's leaf green. */
function giantBed(id, r, ripe) {
  const c = CROPS[id];
  const g = new THREE.CylinderGeometry(2.7, 2.85, PLOT_TOP + 0.04, 18, 1);
  const bed = xform(P(g, '#7A4A2A', { creaseDeg: 40 }), { y: (PLOT_TOP + 0.04) / 2 });
  shade(bed, { bottom: 0.75, top: 1.0 });
  const parts = [bed];
  const leafHex = c.leafHex || '#5BB040';
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.3;
    const len = (ripe ? 1.15 : 1.0) * (0.8 + r() * 0.4);
    const lf = roundLeaf(len, len * 0.9, i % 2 ? leafHex : boost(lin(leafHex), 0, 0.06).getStyle(), { cup: 0.65, n: 5 });
    xform(lf, { rx: 1.05 + r() * 0.15 });
    xform(lf, { ry: a, x: Math.sin(a) * 1.15, y: PLOT_TOP + 0.03, z: Math.cos(a) * 1.15 });
    parts.push(lf);
  }
  return mergeAll(parts);
}
/** Recolour a produce model toward an unripe green, keeping its light and shade (the growing giant). */
const greenish = (g) => hueTo(g, '#8FC456', { keepDark: 0.12 });
/** A giant sunflower: a thick stalk, three big heart leaves and a 2.6 m head of petals facing the camera. */
function giantSunflower(r) {
  const parts = [cyl(0.12, 0.2, 2.6, 7, '#4E9A3A')];
  for (let i = 0; i < 3; i++) parts.push(xform(roundLeaf(1.1, 1.0, i % 2 ? '#4FA042' : '#5CB04B', { cup: 0.25, n: 4 }), { rx: 0.9, ry: i * 2.2 + 0.4, y: 0.5 + i * 0.55 }));
  const R = 1.3; const N = 16;
  const petals = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2; const w = (Math.PI / N) * 0.95;
    const at = (ang, rad) => [Math.cos(ang) * rad, Math.sin(ang) * rad];
    const tri = [at(a - w * 0.55, R * 0.42), at(a - w * 0.5, R * 0.86), at(a, R), at(a - w * 0.55, R * 0.42), at(a, R), at(a + w * 0.55, R * 0.42), at(a, R), at(a + w * 0.5, R * 0.86), at(a + w * 0.55, R * 0.42)];
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tri.flatMap(([x, y]) => [x, y, 0.02 * (k % 2)])), 3));
    pg.computeVertexNormals();
    petals.push(paint(pg, k % 2 ? '#FFD66B' : '#E9B83F'));
  }
  const back = xform(P(new THREE.CircleGeometry(R * 0.55, 10), '#5E9A3A'), { z: -0.04, ry: Math.PI });
  const disc = xform(P(new THREE.ConeGeometry(R * 0.45, R * 0.18, 10, 1, false), '#654022', { creaseDeg: 60 }), { rx: Math.PI / 2, z: R * 0.06 });
  const seeds = [0, 1, 2, 3, 4, 5].map((i) => xform(P(new THREE.CircleGeometry(R * 0.05, 4), '#4A2E18'), { x: Math.cos(i) * R * 0.22, y: Math.sin(i * 1.7) * R * 0.22, z: R * 0.1 }));
  const hd = mergeAll([...petals, back, disc, ...seeds]);
  xform(hd, { rx: -0.5 });
  xform(hd, { ry: Math.PI / 4 + (r() - 0.5) * 0.2, y: 2.75 });
  parts.push(hd);
  return mergeAll(parts);
}
/** A giant carrot: a fat orange root sunk to its shoulders and a fountain of big feathery leaves. */
function giantCarrot(r) {
  const root = xform(P(new THREE.ConeGeometry(0.85, 3.0, 9, 3, false), '#F08A2C', { creaseDeg: 50 }), { rx: Math.PI, y: 1.5 });
  shade(root, { bottom: 0.8, top: 1.08 });
  const parts = [root, cyl(0.86, 0.86, 0.12, 9, '#E07A22', { y: 2.95 })];
  for (let i = 0; i < 9; i++) parts.push(xform(leaf(1.9 + r() * 0.4, 0.42, i % 2 ? '#4E9F3A' : '#6BBF45', { bend: 0.5, seg: 3 }), { rx: 0.35 + r() * 0.25, ry: (i / 9) * Math.PI * 2 + r() * 0.3, y: 3.0 }));
  return mergeAll(parts);
}
/** A giant pumpkin (RD-16, QA wave 2: "an orange ball"): nine deep ribs on a squat body with a sunken crown, the
 *  grooves painted darker and the ridges lit, a thick curled stem and a corkscrew tendril (the bed folds its leaves). */
function giantPumpkin(r) {
  const R = 1.55; const ribs = 9;
  const g = new THREE.SphereGeometry(1, 36, 16);
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i); let y = p.getY(i); let z = p.getZ(i);
    const a = Math.atan2(z, x);
    const groove = Math.abs(Math.cos(a * ribs / 2));                 // 1 on a ridge, 0 in a groove
    const k = 1 - 0.16 * (1 - groove ** 0.6) * (1 - Math.abs(y) ** 3);
    x *= k; z *= k;
    y *= 0.66;
    if (y > 0.45) y -= (y - 0.45) * 1.4 * (1 - Math.hypot(x, z));       // the crown sinks toward the stem
    if (y < -0.52) y = -0.52 + (y + 0.52) * 0.3;
    p.setXYZ(i, x * R, y * R, z * R);
  }
  const x = g.toNonIndexed();
  const xp = x.getAttribute('position'); const col = new Float32Array(xp.count * 3);
  const ridge = lin('#F59A3A'); const grooveC = lin('#C4581C'); const cc = new THREE.Color();
  for (let i = 0; i < xp.count; i++) {
    const a = Math.atan2(xp.getZ(i), xp.getX(i));
    const groove = Math.abs(Math.cos(a * ribs / 2));
    cc.copy(grooveC).lerp(ridge, groove ** 0.7);
    const k = 0.74 + 0.34 * Math.min(1, Math.max(0, xp.getY(i) / R + 0.5));
    col[i * 3] = cc.r * k; col[i * 3 + 1] = cc.g * k; col[i * 3 + 2] = cc.b * k;
  }
  x.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const parts = [crease(x, 55)];
  // the stem: four tapering segments curling over to one side
  let sx = 0; let sy = R * 0.5; let ang = 0.15;
  for (let k = 0; k < 4; k++) {
    const len = 0.22; const rr = 0.2 - k * 0.035;
    parts.push(xform(cyl(rr - 0.03, rr, len, 7, k < 2 ? '#6E7A3A' : '#5E6A30', {}, 40), { rz: -ang, x: sx, y: sy }));
    sx += Math.sin(ang) * len; sy += Math.cos(ang) * len; ang += 0.42;
  }
  // a corkscrew tendril beside the stem
  for (let k = 0; k < 10; k++) {
    const t = k / 10; const a = t * Math.PI * 4;
    parts.push(xform(cyl(0.022, 0.022, 0.12, 4, '#5E9A3A', {}, 0), { x: 0.3 + Math.cos(a) * 0.09, y: R * 0.52 + t * 0.35, z: 0.1 + Math.sin(a) * 0.09, rz: 0.6 }));
  }
  void r;
  return mergeAll(parts);
}
/** Giants: the produce model, its largest dimension in metres, how far it sinks into the bed (0..1 of its height),
 *  and an optional turn so it lies the way the crop grows (a carrot sunk to its shoulders, a corn cob lying down). */
const GIANTS = {
  pumpkin: { build: (r) => giantPumpkin(r), size: 3.6 },
  watermelon: { build: (r) => xform(gourd('watermelon', 1.35, true, r), { ry: 0.6 }), size: 3.8 },
  cabbage: { build: () => I.cabbage(), size: 3.2 },
  strawberry: { build: () => I.strawberry(), size: 3.2, ry: 0.5 },
  tomato: { build: () => I.tomato(), size: 3.2 },
  carrot: { build: (r) => giantCarrot(r), size: 5.0, sink: 0.5 },
  potato: { build: () => I.potato(), size: 4.0, sink: 0.15, ry: 0.3 },
  onion: { build: () => I.onion(), size: 3.2, sink: 0.12 },
  corn: { build: () => I.corn(), size: 4.4, rz: 1.35, ry: 0.9 },
  pepper: { build: () => I.pepper(), size: 3.4, ry: 0.4 },
  wheat: { build: () => I.wheat(), size: 4.0, widen: 1.7 },
  oats: { build: () => I.oats(), size: 3.8, widen: 1.7 },
  rice: { build: () => I.wheat(), size: 3.6, widen: 1.7 },
  sugarcane: { build: () => I.sugarcane(), size: 4.0, widen: 1.5 },
  sunflower: { build: (r) => giantSunflower(r), size: 4.4 },
  blueberry: { build: () => I.blueberry(), size: 3.2 },
  cotton: { build: () => I.cotton(), size: 3.2 },
  lavender: { build: () => I.lavender(), size: 4.0, widen: 1.5 },
  // wave 4: a heap of raspberries, a bouquet of roses, a bunch of ripe coffee cherries
  raspberry: { build: () => I.raspberry(), size: 3.2 },
  rose: { build: () => I.rose(), size: 3.8, widen: 1.3 },
  coffee: { build: () => mergeAll([...Array.from({ length: 7 }, (_, i) => ball(0.16, i % 3 ? '#C0262E' : '#D8452E', { x: Math.cos(i * 0.9) * 0.2 * (i ? 1 : 0), y: 0.18 + (i > 3 ? 0.18 : 0), z: Math.sin(i * 0.9) * 0.2 * (i ? 1 : 0) }, 1)),
    ...[0, 1, 2].map((i) => xform(leaf(0.45, 0.2, '#2E6E36', { bend: 0.2 }), { ry: i * 2.1, rx: 1.2, y: 0.1 }))]), size: 3.0 },
};
for (const id of CROP_IDS) {
  const build = async (ripe) => {
    const r = rng(`giant:${id}:${ripe}`);
    const G = GIANTS[id];
    let prod = await G.build(r);
    prod = prod.index ? prod.toNonIndexed() : prod.clone();
    if (G.widen) prod.scale(G.widen, 1, G.widen);
    if (G.rz) xform(prod, { rz: G.rz });
    if (G.ry) xform(prod, { ry: G.ry });
    const b0 = bounds(prod);
    const big = Math.max(b0.max.x - b0.min.x, b0.max.y - b0.min.y, b0.max.z - b0.min.z);
    prod.scale(G.size / big * (ripe ? 1 : 0.7), G.size / big * (ripe ? 1 : 0.7), G.size / big * (ripe ? 1 : 0.7));
    if (!ripe) prod = greenish(prod);
    const b = bounds(prod);
    const sink = (G.sink || 0.04) * (b.max.y - b.min.y) + (ripe ? 0 : 0.2);
    prod.translate(-(b.min.x + b.max.x) / 2, PLOT_TOP + 0.04 - b.min.y - sink, -(b.min.z + b.max.z) / 2);
    prod = clipBelow(prod, PLOT_TOP - 0.05);
    sway(prod, { rigid: true });
    const bed = sway(giantBed(id, r, ripe), { y0: PLOT_TOP, y1: PLOT_TOP + 0.9, weight: 0.4 });
    let g = mergeAll([bed, prod]);
    if (tris(g) > GIANT_BUDGET) g = await simplify(g, GIANT_BUDGET / tris(g), { error: 0.02, deg: 45 });
    return g;
  };
  job(`crop:${id}:giant`, `giants/${id}.glb`, { family: 'crop', footprint: [3, 3], sway: 0.4, soil: PLOT_TOP, giant: true, part: true }, () => build(true));
  job(`crop:${id}:giant:2`, `giants/${id}.glb`, { family: 'crop', footprint: [3, 3], sway: 0.4, soil: PLOT_TOP, giant: true, part: true }, () => build(false));
}

// ---------------------------------------------------------------------------------------------------
// 9. Trees (GDD §3.2): procedural "lollipop" canopies (visual-ux-juice §3.7, §4.5 cheap fallback) with species
//    shape parameters so recolours read as different trees. States: sapling, young, mature, ready (+ pine stump).
// visual-16: 3-5 unequal crown masses with gaps and branches, apples 0.18 m (unripe 60 %, muted green), <= 1,200
// triangles a tree (performance-03)
const TREES = {
  apple_tree: { leaf: '#4FA83E', fruit: '#E2363A', fruitR: 0.19, fruitN: 18, canopy: [1, 0.92, 1], trunk: 1.25, lean: 0.04, blobs: 4 },
  cherry_tree: { leaf: '#3F9A45', fruit: '#C81E3C', fruitR: 0.125, fruitN: 15, canopy: [1.15, 0.8, 1.15], trunk: 1.15, lean: 0.08, blobs: 5, pairs: true },
  // RD-11 (QA wave 2): species silhouettes: citrus dense and round (more, tighter lobes, glossy dark leaves), peach broad
  // and low, plum tall and narrow
  orange_tree: { leaf: '#2A7F3A', fruit: '#F59A23', fruitR: 0.17, fruitN: 16, canopy: [0.95, 1.02, 0.95], trunk: 1.0, lean: 0.02, blobs: 6, dense: true },
  lemon_tree: { leaf: '#3F9440', fruit: '#F5D63B', fruitR: 0.16, fruitN: 16, canopy: [0.88, 1.0, 0.88], trunk: 1.05, lean: 0.05, blobs: 6, oval: true, dense: true },
  peach_tree: { leaf: '#5AAE48', fruit: '#F7A989', fruitR: 0.17, fruitN: 14, canopy: [1.4, 0.66, 1.4], trunk: 0.9, lean: 0.03, blobs: 5 },
  pear_tree: { leaf: '#4E9F44', fruit: '#C9D84A', fruitR: 0.165, fruitN: 14, canopy: [0.78, 1.3, 0.78], trunk: 1.3, lean: 0.02, blobs: 4, pear: true },
  plum_tree: { leaf: '#3E8F4A', fruit: '#8C4FA6', fruitR: 0.15, fruitN: 16, canopy: [0.82, 1.32, 0.82], trunk: 1.25, lean: 0.06, blobs: 4 },
  // wave 3 (M2): every M2 tree reads at the farm zoom by its fruit: walnut shells and split green husks (and a few
  // windfalls under a ripe tree), olives in dark clusters on a gnarled, leaning trunk under a silver crown, two sap
  // buckets on the maple (brimming amber when ready), cocoa pods hanging straight off the trunk below a high dark
  // crown (yellow, orange and maroon), teardrop figs under a broad, low crown
  walnut_tree: { leaf: '#5B9B3A', fruit: '#8A6440', fruitR: 0.15, fruitN: 14, canopy: [1.25, 1.05, 1.25], trunk: 1.45, lean: 0.03, blobs: 5, bark: '#6E4A2E',
    fruitCols: ['#8A6440', '#9AB85A', '#7A5636', '#8A6440'], windfall: 4 },
  olive_tree: { leaf: '#93AB82', fruit: '#3E2A3A', fruitR: 0.075, fruitN: 18, canopy: [1.25, 0.66, 1.25], trunk: 1.0, lean: 0.2, blobs: 6, bark: '#7D6A52', gnarly: true,
    cluster: 3, fruitCols: ['#3E2A3A', '#5A3A4A', '#6B7A2E'] },
  maple_tree: { leaf: '#D2552E', fruit: '#B0702E', fruitR: 0.0, fruitN: 0, canopy: [1.1, 1.08, 1.1], trunk: 1.35, lean: 0.03, blobs: 5, sapBucket: true },
  cocoa_tree: { leaf: '#2F7A3A', fruit: '#E0A030', fruitR: 0.21, fruitN: 9, canopy: [1.1, 0.85, 1.1], trunk: 1.75, lean: 0.04, blobs: 5, pods: true, dense: true,
    fruitCols: ['#E8B83A', '#E07A2A', '#9A3A2A', '#E8B83A', '#C8D04A'] },
  fig_tree: { leaf: '#3F8F3A', fruit: '#6B3A6B', fruitR: 0.13, fruitN: 14, canopy: [1.4, 0.74, 1.4], trunk: 1.0, lean: 0.06, blobs: 6, fig: true,
    fruitCols: ['#6B3A6B', '#7E4A7A', '#5A2E5A'] },
  // wave 4 (owner wish 7): a small, round, slightly leaning tree with glossy dark leaves; the fruit are big ruby globes
  // crowned with a little calyx (fruitGeo `crown`)
  pomegranate_tree: { leaf: '#3B7F36', fruit: '#C4233A', fruitR: 0.17, fruitN: 13, canopy: [1.08, 0.9, 1.08], trunk: 0.9, lean: 0.07, blobs: 5, dense: true,
    crown: true, fruitCols: ['#C4233A', '#D2353F', '#AE1C33'] },
};
const TREE_STATES = ['sapling', 'young', 'mature', 'ready'];

function trunkGeo({ h, r, lean, hex = '#8A5A35', branches = 2, seed = 1 }) {
  const rr = rng(seed);
  const parts = [];
  const segs = 3;
  let x = 0; let z = 0; let y = 0;
  const dir = rr() * Math.PI * 2;
  for (let i = 0; i < segs; i++) {
    const sh = h / segs; const r0 = r * (1 - i * 0.2); const r1 = r * (1 - (i + 1) * 0.2);
    const seg = cyl(r1, r0, sh * 1.04, 7, hex, {}, 55);
    const dx = Math.cos(dir) * lean * sh; const dz = Math.sin(dir) * lean * sh;
    const tilt = Math.atan2(Math.hypot(dx, dz), sh);
    xform(seg, { rx: Math.sin(dir) * tilt, rz: -Math.cos(dir) * tilt });
    xform(seg, { x, y, z });
    parts.push(seg);
    x += dx; y += sh; z += dz;
  }
  // root flare
  parts.push(xform(P(new THREE.ConeGeometry(r * 1.9, r * 2.2, 7), hex, { creaseDeg: 55 }), { y: r * 1.1 }));
  for (let b = 0; b < branches; b++) {
    const a = dir + (b + 0.5) * Math.PI;
    const br = cyl(r * 0.35, r * 0.55, h * 0.45, 5, hex, {}, 55);
    xform(br, { rz: -0.75, ry: a });
    xform(br, { x: x * 0.7, y: h * 0.72, z: z * 0.7 });
    parts.push(br);
  }
  return { geo: mergeAll(parts), top: new THREE.Vector3(x, y, z) };
}

/**
 * A tree crown (wave 2, VISUAL-AFTER A1/B: "tree crowns became balloons"): ONE lumpy surface melted from 6-9 lobes
 * of 0.6-1.3x size that overlap 30-50 % (metaballs through marching cubes, then reduced), so the silhouette is a
 * cloud of foliage with bumps, not a bunch of separate balls. Painted in four leaf tones by low-frequency patches,
 * sun-lit on top, darker in the hollows and underneath; one surface, so no overlapping shells can z-fight into the
 * autumn weave (RD-20). Returns { geo, branches, centres } (centres: lobe centres for the branches, metres).
 */
function metaCrown(lobes, { res = 30, target = 420, seed = 1, wobble = 0.05 } = {}) {
  const mc = new MarchingCubes(res, { flatShading: false }, false, false, 80000);
  mc.reset();
  // a short-range field (subtract 40): lobes melt where they overlap but keep their own bumps on the silhouette
  for (const l of lobes) mc.addBall(l.x, l.y, l.z, 120 * l.r * l.r, 40);
  mc.update();
  const pos = mc.positionArray.slice(0, mc.count * 3);
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g = weld((() => { paint(g, '#ffffff'); g.computeVertexNormals(); g.deleteAttribute('normal'); return g; })(), 1e-4);
  g.computeVertexNormals();
  // leafy irregularity: push vertices along their normals by a little noise
  const p = g.getAttribute('position'); const n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    const k = noise3(p.getX(i) * 7 + seed, p.getY(i) * 7, p.getZ(i) * 7, seed) * wobble;
    p.setXYZ(i, p.getX(i) + n.getX(i) * k, p.getY(i) + n.getY(i) * k, p.getZ(i) + n.getZ(i) * k);
  }
  return g;
}
function paintCrown(g, hex, seed) {
  const base = lin(hex);
  const hs = {}; base.getHSL(hs, THREE.SRGBColorSpace);
  const tone = (dl, dh = 0, ds = 0) => new THREE.Color().setHSL((hs.h + dh + 1) % 1, Math.min(1, Math.max(0, hs.s * (1 + ds))), Math.min(0.92, Math.max(0.05, hs.l + dl)), THREE.SRGBColorSpace);
  // four leaf tones: shade, mid, light and a warm sunlit green (3-4 tones, VISUAL-AFTER A1)
  const tones = [tone(-0.07, 0.005, 0.05), tone(0), tone(0.05, -0.012, -0.02), tone(0.1, -0.03, -0.06)];
  // RD-11: the crown's interior (clefts between lobes, the underside) falls to a deep green #365F35
  const deep = lin('#365F35');
  const src = g.index ? g.toNonIndexed() : g;
  src.computeVertexNormals();
  const p = src.getAttribute('position'); const nrm = src.getAttribute('normal');
  const b = bounds(src); const h = Math.max(1e-6, b.max.y - b.min.y);
  const col = new Float32Array(p.count * 3); const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const patch = noise3(x * 2.2 + seed, y * 2.2, z * 2.2, seed + 7) * 0.5 + 0.5;
    const up = nrm.getY(i);
    let t = patch * 3.0 + up * 0.8 + ((y - b.min.y) / h) * 0.6 - 1.1;
    t = Math.max(0, Math.min(2.999, t));
    const k = Math.floor(t); const f = t - k;
    c.copy(tones[k]).lerp(tones[Math.min(3, k + 1)], f * f * (3 - 2 * f));
    // the underside and the hollows sit in shade
    const ao = Math.min(1, Math.max(0.68, 0.84 + up * 0.22 + ((y - b.min.y) / h) * 0.12));
    const r0 = Math.hypot(x - (b.min.x + b.max.x) / 2, z - (b.min.z + b.max.z) / 2) / Math.max(1e-6, (b.max.x - b.min.x) / 2);
    const inner = Math.min(1, Math.max(0, (0.8 - r0) * 1.6)) * Math.min(1, Math.max(0, 0.4 - up)) + Math.max(0, -up) * 0.55;
    c.lerp(deep, Math.min(0.75, inner));
    col[i * 3] = c.r * ao; col[i * 3 + 1] = c.g * ao; col[i * 3 + 2] = c.b * ao;
  }
  src.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return src;
}
function canopyGeo({ R, scale = [1, 1, 1], hex, blobs = 4, seed = 1, oval = false, bark = '#8A5A35', target = 420, dense = false }) {
  const rr = rng(seed * 31 + 7);
  const [sx, sy, sz] = scale;
  const n = Math.max(2, Math.min(9, blobs + 3));
  // lobes in the marching-cubes unit cube (0.5 = centre): a main mass, a ring of overlapping lobes at uneven
  // angles and heights, and a crown lobe or two on top. RD-11 (QA wave 2: "faceted blobs"): the ring sits further out
  // and the core is smaller, so 3-5 lobes read on the silhouette with clefts between them (dense citrus stays tight)
  const lobes = [{ x: 0.5, y: 0.46, z: 0.5, r: dense ? 0.16 : 0.14 }];
  const ring = n - 2;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + rr() * 0.7;
    const d = (dense ? 0.16 : 0.2) + rr() * 0.05;
    lobes.push({ x: 0.5 + Math.cos(a) * d, y: 0.44 + (rr() - 0.45) * (oval ? 0.16 : 0.13), z: 0.5 + Math.sin(a) * d, r: 0.135 * (0.7 + rr() * 0.55) });
  }
  for (let i = 0; i < 2; i++) {
    const a = rr() * Math.PI * 2;
    lobes.push({ x: 0.5 + Math.cos(a) * 0.07, y: 0.58 + rr() * 0.05, z: 0.5 + Math.sin(a) * 0.07, r: 0.125 * (0.8 + rr() * 0.35) });
  }
  let g = metaCrown(lobes, { seed, target, wobble: 0.06 });
  // to metres: the crown's horizontal radius becomes R (times the species scale)
  const b0 = bounds(g);
  const c0 = b0.getCenter(new THREE.Vector3());
  const half = Math.max(b0.max.x - b0.min.x, b0.max.z - b0.min.z) / 2;
  g.translate(-c0.x, -c0.y, -c0.z);
  g.scale((R / half) * sx, (R / half) * sy * (oval ? 1.12 : 1), (R / half) * sz);
  if (tris(g) > target * 1.1) g = await_simplify_sync(g, target);
  g = paintCrown(g, hex, seed);
  g = crease(g, 80);
  // branches: from below the crown's centre toward the lower lobes (they show in the hollows underneath)
  const k = (R / half);
  const centres = lobes.slice(1, 4).map((l) => new THREE.Vector3((l.x - 0.5) * 2 * k * sx, (l.y - 0.5) * 2 * k * sy - c0.y * k * sy, (l.z - 0.5) * 2 * k * sz));
  const branches = [];
  for (const to of centres) {
    const from = new THREE.Vector3(0, -R * 0.7 * sy, 0);
    const tgt = to.clone().multiplyScalar(0.7); tgt.y = Math.min(tgt.y, -R * 0.15 * sy);
    const len = tgt.distanceTo(from);
    if (len < 0.05) continue;
    const br = cyl(0.03, 0.06, len, 5, bark, {}, 0);
    br.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tgt.clone().sub(from).normalize()));
    br.translate(from.x, from.y, from.z);
    branches.push(br);
  }
  return { geo: g, branches: branches.length ? mergeAll(branches) : null, centres };
}
/** meshopt reduction without the async wrapper (the tools are loaded before any job runs). */
function await_simplify_sync(g, target) {
  const simp = T.simp;
  const w = weld((() => { const x = g.index ? g.toNonIndexed() : g.clone(); x.deleteAttribute('normal'); if (!x.getAttribute('color')) paint(x, '#ffffff'); return x; })(), 1e-4);
  const idx = new Uint32Array(w.index.array);
  const [res] = simp.simplify(idx, w.getAttribute('position').array, 3, Math.max(3, Math.floor(target) * 3), 0.05, []);
  const out = new THREE.BufferGeometry();
  for (const k of Object.keys(w.attributes)) out.setAttribute(k, w.getAttribute(k));
  out.setIndex(new THREE.BufferAttribute(res, 1));
  const ni = out.toNonIndexed(); ni.computeVertexNormals();
  return ni;
}

function fruitGeo(t, r, ripe, i = 0) {
  const R = t.fruitR * (ripe ? 1 : 0.6);
  const hex = ripe ? (t.fruitCols ? t.fruitCols[i % t.fruitCols.length] : t.fruit) : '#9DB86A';   // unripe: smaller and a muted green (visual-16)
  // a ridged cocoa pod hanging from its stalk (wave 3): a five-sided lathe, pointed at both ends
  if (t.pods) return mergeAll([lathe([[0, 0], [R * 0.4, R * 0.25], [R * 0.62, R * 0.8], [R * 0.55, R * 1.4], [R * 0.3, R * 1.85], [0, R * 2.05]], 5, ripe ? hex : '#8DBE4A', 55).translate(0, -R * 2.05, 0),
    cyl(0.012, 0.016, R * 0.35, 3, '#6E4A2E', { y: -0.02 }, 0)]);
  // a teardrop fig (wave 3)
  if (t.fig) return lathe([[0, 0], [R * 0.6, R * 0.12], [R * 0.75, R * 0.6], [R * 0.45, R * 1.1], [0, R * 1.3]], 5, hex, 60).translate(0, -R * 0.55, 0);
  // a cluster of olives (wave 3): three small eight-sided drupes
  if (t.cluster) return mergeAll(Array.from({ length: t.cluster }, (_, k) => xform(P(new THREE.OctahedronGeometry(R, 0), t.fruitCols && ripe ? t.fruitCols[(i + k) % t.fruitCols.length] : hex, { creaseDeg: 80 }),
    { x: Math.cos(k * 2.1) * R * 1.1, y: -k * R * 0.6, z: Math.sin(k * 2.1) * R * 1.1, sy: 1.3 })));
  if (t.pear) return mergeAll([ball(R, hex, { sy: 1.05 }, 0), ball(R * 0.62, hex, { y: R * 0.85 }, 0)]);
  // a pomegranate (wave 4): a round globe with its five-pointed calyx crown on top
  if (t.crown) {
    const g = ball(R, hex, { sy: 0.94 }, 0);
    if (ripe) shade(g, { bottom: 0.8, top: 1.22 });
    return mergeAll([g, xform(P(new THREE.CylinderGeometry(R * 0.32, R * 0.22, R * 0.4, 5, 1, true), ripe ? '#8E1A2A' : '#7E9A4A'), { y: R * 0.95 })]);
  }
  // a 20-triangle ball, smooth-shaded, with a warm highlight on top when ripe
  const g = ball(R, hex, { sy: t.oval ? 1.25 : 0.92 }, 0);
  if (ripe) shade(g, { bottom: 0.82, top: 1.28 });
  return g;
}

/**
 * The Heirloom look (GDD §3.2 rule 8: 60 harvests make a tree an Heirloom for good): an old, gnarled trunk (thicker,
 * leaning, twisting as it rises, two knobbly burls) and a blue prize ribbon tied round it with a bow and a gold
 * button. Returns { geo, top } like trunkGeo; `ribbon` is built separately (heirloomRibbon) so the budget sees it.
 */
function gnarledTrunk({ h, r, lean, hex, seed }) {
  const t = trunkGeo({ h, r: r * 1.5, lean: lean * 1.6 + 0.05, hex, branches: 2, seed });
  // the twist: every ring is pushed sideways along a slow S-curve that grows with the height
  const bend = (y) => [Math.sin(y * 2.6 + seed) * 0.11 * Math.min(1, y / 0.6), Math.cos(y * 2.1 + seed * 0.7) * 0.09 * Math.min(1, y / 0.6)];
  const p = t.geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const [dx, dz] = bend(p.getY(i)); p.setX(i, p.getX(i) + dx); p.setZ(i, p.getZ(i) + dz); }
  t.geo.computeVertexNormals();
  const [tx, tz] = bend(t.top.y);
  t.top.x += tx; t.top.z += tz;
  const rr = rng(`burl${seed}`);
  const burls = [0.38, 0.62].map((k, i) => {
    const y = h * k; const [bx, bz] = bend(y); const a = rr() * 6.28 + i * 2.6; const rad = r * 1.5 * (1 - k * 0.45);
    return xform(blob(r * 0.62, shadeHex(hex, -0.12), { seed: seed + i, sy: 0.8, amp: 0.12, detail: 0 }), { x: bx + Math.cos(a) * rad, y, z: bz + Math.sin(a) * rad });
  });
  // old roots break the ground round the foot: four tapering arms running out and down into the soil
  const roots = [0, 1, 2, 3].map((i) => {
    const a = seed * 0.37 + i * (Math.PI / 2) + (rr() - 0.5) * 0.7; const len = r * 3.4 * (0.8 + rr() * 0.4);
    const g = cyl(r * 0.28, r * 0.72, len, 5, hex, {}, 55);
    g.translate(0, len / 2, 0);                                        // thick end at the origin, thin end up
    xform(g, { rz: -1.9 });                                           // out along +x and down into the soil: a hump
    xform(g, { ry: a, y: r * 0.6 });
    return g;
  });
  return { geo: mergeAll([t.geo, ...burls, ...roots]), top: t.top, bend, r: r * 1.5 };
}

/** The Heirloom's prize ribbon: a blue band round the trunk at `y` (trunk radius `rad` there), a bow and gold button. */
function heirloomRibbon(y, rad, [ox, oz] = [0, 0]) {
  const BLUE = '#2F6FD6'; const DEEP = '#1F4FA8';
  const band = P(new THREE.CylinderGeometry(rad + 0.03, rad + 0.035, 0.15, 10, 1, true), BLUE, { creaseDeg: 0 });
  const loops = [-1, 1].map((sd) => xform(P(new THREE.TorusGeometry(0.12, 0.04, 3, 7), BLUE, { creaseDeg: 40 }), { sx: 1.25, sz: 0.5, x: sd * 0.135, rz: sd * 0.35 }));
  const tails = [-1, 1].map((sd) => box(0.085, 0.34, 0.016, DEEP, { x: sd * 0.08, y: -0.2, rz: sd * 0.3 }));
  const knot = cyl(0.065, 0.065, 0.04, 8, '#FFC83D', { rx: Math.PI / 2 }, 0);
  const bow = mergeAll([...loops, ...tails, knot]);
  xform(bow, { z: rad + 0.07 });                                      // in front, on the band
  return xform(mergeAll([band, bow]), { x: ox, y, z: oz });
}

function shadeHex(hex, k) {
  const c = new THREE.Color(hex);
  return `#${(k < 0 ? c.lerp(new THREE.Color('#000000'), -k) : c.lerp(new THREE.Color('#ffffff'), k)).getHexString()}`;
}

function fruitTree(id, state, heirloom = false) {
  const t = TREES[id];
  const seed = [...id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const r = rng(`${id}:${state}`);
  // an Heirloom is an old tree: a tenth bigger, gnarled, with its ribbon
  const size = { sapling: 0.36, young: 0.62, mature: 1, ready: 1 }[state] * (heirloom ? 1.12 : 1);
  const H = 1.2 * t.trunk * size + 0.25;
  const R = 1.42 * size;
  // grown trees fork (RD-11: "straight trunks"): two boughs leave the trunk below the crown
  const trunkOpts = { h: H, r: 0.13 * Math.max(0.45, size), lean: t.lean, hex: t.bark || '#8A5A35', branches: size > 0.5 ? 2 : 0, seed };
  const trunk = heirloom || t.gnarly ? gnarledTrunk(trunkOpts) : trunkGeo(trunkOpts);
  const ribbon = heirloom ? heirloomRibbon(0.6, trunk.r * 0.86, trunk.bend(0.6)) : null;
  // the crown gets what the 1,200-triangle tree budget leaves after the trunk (and ribbon) and a full crop of fruit
  const fruitTris = t.fruitR ? t.fruitN * (t.pairs ? 2 : 1) * (t.pear ? 40 : t.pods ? 55 : t.fig ? 40 : t.cluster ? 8 * t.cluster : 20) : 0;
  // wave 3: the maple's two sap pails and a ripe walnut's windfalls come out of the crown's share too
  const extras = (t.sapBucket ? 230 : 0) + (t.windfall ? t.windfall * 20 : 0);
  const crownMax = Math.max(heirloom ? 180 : 300, Math.min(540, 1150 - tris(trunk.geo) - (ribbon ? tris(ribbon) : 0) - fruitTris - extras - 80));
  const can = canopyGeo({ R, scale: t.canopy, hex: t.leaf, blobs: size < 0.5 ? 2 : t.blobs, seed, oval: t.oval, dense: t.dense, bark: t.bark || '#8A5A35',
    target: size < 0.5 ? 180 : size < 0.8 ? 380 : crownMax });
  const cy = trunk.top.y + R * t.canopy[1] * (size > 0.5 ? 0.7 : 0.62);
  xform(can.geo, { x: trunk.top.x, y: cy, z: trunk.top.z });
  sway(can.geo, { y0: cy - R * t.canopy[1], y1: cy + R * t.canopy[1] * 1.4, weight: 1 });
  sway(trunk.geo, { rigid: true });
  const parts = [trunk.geo, can.geo];
  if (ribbon) parts.push(sway(ribbon, { rigid: true }));
  if (can.branches && size > 0.5) { xform(can.branches, { x: trunk.top.x, y: cy, z: trunk.top.z }); sway(can.branches, { rigid: true }); parts.push(can.branches); }
  const fruitN = state === 'ready' ? t.fruitN : state === 'mature' ? Math.round(t.fruitN * 0.35) : 0;
  if (fruitN && t.fruitR) {
    const proto = fruitGeo(t, r, state === 'ready');
    // never past the 1,200-triangle tree budget (visual-16): an Heirloom's ribbon and roots come out of the fruit
    const used = parts.reduce((n, g) => n + tris(g), 0) + extras;
    const fit = Math.max(4, Math.floor((1190 - used) / (tris(proto) * (t.pairs && state === 'ready' ? 2 : 1))));
    // Fruit nestles IN the foliage (VISUAL-AFTER A1: "keep fruit partially nested among leaves"): spots on the
    // crown's sides and upper surface, at least a fruit-and-a-half apart, each sunk about 40 % into the leaves.
    const cp = can.geo.getAttribute('position');
    const cn = can.geo.getAttribute('normal');
    const v = new THREE.Vector3();
    const cand = [];
    for (let i = 0; i < cp.count; i++) { const ny = cn.getY(i); if (ny > -0.3 && ny < 0.97) cand.push(i); }
    cand.sort(() => r() - 0.5);
    const spots = [];
    const minD = t.fruitR * 3.2;
    for (const i of cand) {
      v.fromBufferAttribute(cp, i);
      if (spots.some((q) => q.v.distanceTo(v) < minD)) continue;
      spots.push({ i, v: v.clone() });
      if (spots.length >= Math.min(fruitN, fit)) break;
    }
    const nrm = new THREE.Vector3();
    for (let i = 0; i < spots.length; i++) {
      const s0 = spots[i];
      v.fromBufferAttribute(cp, s0.i);
      nrm.fromBufferAttribute(cn, s0.i);
      const f = t.fruitCols ? fruitGeo(t, r, state === 'ready', i) : proto.clone();
      xform(f, { ry: r() * 6.28 });
      let tx; let ty; let tz;
      if (t.pods) {
        // cauliflory: the pods hang straight off the trunk and the forks, below the crown, the front half first
        const k = 0.24 + (i % 5) * 0.1; const a = (i % 2 ? 0.75 : -0.75) + Math.floor(i / 2) * 1.9;
        const tr = 0.13 * Math.max(0.45, size) + t.fruitR * 0.35;
        tx = trunk.top.x * k + Math.sin(a) * tr; ty = H * k + t.fruitR * 0.6; tz = trunk.top.z * k + Math.cos(a) * tr;
      } else {
        const out = t.fruitR * 0.32;
        tx = v.x + nrm.x * out; ty = v.y + nrm.y * out - t.fruitR * 0.12; tz = v.z + nrm.z * out;
      }
      xform(f, { x: tx, y: ty, z: tz });
      sway(f, { rigid: true });
      const sw = f.getAttribute('sway'); const top = cy + R * t.canopy[1] * 1.4; const bot = cy - R * t.canopy[1];
      const k = Math.min(1, Math.max(0, (ty - bot) / (top - bot)));
      for (let q = 0; q < sw.count; q++) sw.setX(q, t.pods ? 0 : k * k);
      parts.push(f);
      if (t.pairs && state === 'ready') {
        const f2 = proto.clone();
        xform(f2, { x: tx + 0.07, y: ty - 0.05, z: tz + 0.05 });
        sway(f2, { rigid: true });
        const s2 = f2.getAttribute('sway'); for (let q = 0; q < s2.count; q++) s2.setX(q, k * k);
        parts.push(f2);
      }
    }
  }
  if (t.sapBucket && (state === 'mature' || state === 'ready')) {
    // two pails hung on spouts on the front of the trunk (wave 3); ready, they brim with amber sap and a jug waits below
    for (const a of [-0.55, 0.65]) {
      const tr = 0.13 * size + 0.13;
      const bucket = mergeAll([cyl(0.14, 0.115, 0.24, 8, '#A7A39A'), cyl(0.15, 0.15, 0.04, 8, '#8C8880', { y: 0.25, z: -0.02 }),
        xform(cyl(0.012, 0.012, 0.16, 3, '#5E5A55', {}, 0), { rx: Math.PI / 2, y: 0.3, z: -0.12 }),
        ...(state === 'ready' ? [cyl(0.13, 0.13, 0.02, 8, '#D08A2A', { y: 0.215 })] : [])]);
      xform(bucket, { ry: a, x: Math.sin(a) * tr, y: 0.5, z: Math.cos(a) * tr });
      sway(bucket, { rigid: true });
      parts.push(bucket);
    }
    if (state === 'ready') parts.push(sway(xform(lathe([[0, 0], [0.1, 0], [0.12, 0.12], [0.06, 0.22], [0.04, 0.3], [0, 0.3]], 6, '#C9A26A'), { x: 0.42, z: 0.36 }), { rigid: true }));
  }
  if (t.windfall && state === 'ready') {
    for (let i = 0; i < t.windfall; i++) { const a = i * 1.7 + 0.4; parts.push(sway(ball(t.fruitR * 0.9, t.fruitCols[i % t.fruitCols.length], { x: Math.sin(a) * 0.9, y: t.fruitR * 0.6, z: Math.cos(a) * 0.9 + 0.2 }, 0), { rigid: true })); }
  }
  if (size < 0.5) {
    // a sapling gets a little support stake and a tie
    const stake = sway(cyl(0.025, 0.03, H * 1.05, 5, '#C9A26A', { x: 0.16, z: 0.05 }, 0), { rigid: true });
    parts.push(stake);
  }
  return mergeAll(parts);
}

function pineTree(state, heirloom = false) {
  if (heirloom) {
    // the old woodlot pine: a tenth taller, its trunk thick and gnarled, the prize ribbon round it
    const g = xform(pineTree(state), { s: 1.1 });
    const trunk = gnarledTrunk({ h: 1.9, r: 0.17, lean: 0.02, hex: '#7A4E2E', seed: 17 });
    const ribbon = heirloomRibbon(0.55, trunk.r * 0.88, trunk.bend(0.55));
    return mergeAll([g, sway(trunk.geo, { rigid: true }), sway(ribbon, { rigid: true })]);
  }
  const r = rng(`pine:${state}`);
  if (state === 'stump') {
    const parts = [cyl(0.32, 0.4, 0.38, 9, '#8A5A35', {}, 50), cyl(0.3, 0.3, 0.02, 12, '#E2C08A', { y: 0.38 }, 0),
      xform(P(new THREE.ConeGeometry(0.55, 0.3, 9), '#7A4E2E', { creaseDeg: 50 }), { y: 0.12 })];
    // the woodlot regrows: a little seedling beside the stump
    for (let i = 0; i < 2; i++) parts.push(cone(0.12 - i * 0.03, 0.22, 6, '#3F7F3A', { x: 0.5, y: 0.08 + i * 0.12, z: 0.3 }));
    return sway(mergeAll(parts), { rigid: true });
  }
  const size = { sapling: 0.34, young: 0.62, mature: 1, ready: 1 }[state];
  const H = 5.2 * size;
  const parts = [sway(cyl(0.09 * size + 0.04, 0.16 * size + 0.05, H * 0.35, 7, '#7A4E2E', {}, 50), { rigid: true })];
  const tiers = size < 0.5 ? 3 : 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const rad = (1.55 - t * 1.05) * size + 0.1;
    const th = (1.5 - t * 0.35) * size + 0.15;
    const g = new THREE.ConeGeometry(rad, th, 9, 2, true);
    g.deleteAttribute('uv');
    const pp = g.getAttribute('position');
    for (let k = 0; k < pp.count; k++) {
      const x = pp.getX(k); const z = pp.getZ(k); const y = pp.getY(k);
      const a = Math.atan2(z, x);
      const wav = 1 + 0.09 * Math.sin(a * 9 + i) * (0.5 - y / th);
      pp.setXYZ(k, x * wav, y - Math.max(0, -y) * 0.15 * Math.cos(a * 9), z * wav);
    }
    const tier = P(g, i % 2 ? '#2F6E3A' : '#357A40', { creaseDeg: 60 });
    // lighter tips at the top of each tier, darker skirt underneath
    shade(tier, { bottom: 0.72, top: 1.15 });
    const y = H * 0.22 + t * H * 0.62 + th / 2;
    xform(tier, { y, ry: r() * 6.28 });
    parts.push(tier);
    // close the tier from below so it reads solid from low angles
    parts.push(xform(P(new THREE.CircleGeometry(rad * 0.98, 9), '#24552D'), { rx: Math.PI / 2, y: y - th / 2 + 0.01 }));
  }
  const g = mergeAll(parts);
  const bb = bounds(g);
  const sw = g.getAttribute('sway');
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) if (p.getY(i) > H * 0.3) { const k = (p.getY(i) - H * 0.3) / (bb.max.y - H * 0.3); sw.setX(i, k * k * 0.6); }
  return g;
}

for (const id of Object.keys(TREES)) {
  for (const st of TREE_STATES) {
    job(`tree:${id}:${st}`, `trees/${id}.glb`, { family: 'tree', def: id, footprint: [2, 2], sway: 0.35 }, async () => fruitTree(id, st));
  }
  // Heirloom trees (isHeirloom(o), rules trees.js): the grown states get the old-tree look, `<state>:heirloom`
  for (const st of ['mature', 'ready']) {
    job(`tree:${id}:${st}:heirloom`, `trees/${id}.glb`, { family: 'tree', def: id, footprint: [2, 2], sway: 0.35, heirloom: true }, async () => fruitTree(id, st, true));
  }
}
for (const st of [...TREE_STATES, 'stump']) {
  job(`tree:pine:${st}`, 'trees/pine.glb', { family: 'tree', def: 'pine', footprint: [2, 2], sway: 0.3 }, async () => pineTree(st));
}
for (const st of ['mature', 'ready']) {
  job(`tree:pine:${st}:heirloom`, 'trees/pine.glb', { family: 'tree', def: 'pine', footprint: [2, 2], sway: 0.3, heirloom: true }, async () => pineTree(st, true));
}

// ---------------------------------------------------------------------------------------------------
// 10. Shared props (fences, crates, sacks, signs) used by buildings, homes and decor
const WOOD = '#D9A15B'; const WOOD_D = '#A8713A'; const TRUNK = '#8A5A35';

/** Load + bake a source, rotate it to face +z, fit to w x d metres (fill) and/or height h. */
async function srcFit(rel, { w, d, h, fill = 1, ry = 0, recolor, sat = 0.15, light = 0, skipNodes, onlyNodes, keepY, boost: boostRe = true,
  roof = null, windows = null, sy = 1, maxTris = 0 } = {}) {
  const pal = rel.includes('medieval-village') ? { ...(typeof MV_PAL === 'undefined' ? {} : MV_PAL), ...recolor } : recolor;
  const g = await bakeStatic(rel, { recolor: pal, sat, light, skipNodes, onlyNodes, boostRecolor: boostRe, roof });
  if (ry) xform(g, { ry });
  if (sy !== 1) g.scale(1, sy, 1);
  // the same uniform fit for an anchor part (the windows), so its points land in the model's final space
  const b = bounds(g);
  let s0 = Infinity;
  if (w) s0 = Math.min(s0, (w * fill) / (b.max.x - b.min.x));
  if (d) s0 = Math.min(s0, (d * fill) / (b.max.z - b.min.z));
  if (h) s0 = Math.min(s0, h / (b.max.y - b.min.y));
  if (!Number.isFinite(s0)) s0 = 1;
  let out = fit(g, { w, d, h, fill, keepY });
  // a small dressing prop (a cart, a cauldron) gets its own budget: its detail is relative to its own size
  if (maxTris && tris(out) > maxTris * 1.1) out = await simplify(out, maxTris / tris(out), { error: 0.02, deg: 40 });
  if (windows) {
    const wg = await bakeStatic(rel, { recolor: pal, sat, skipNodes, onlyNodes, skipMats: new RegExp(`^(?!(${windows.source})$)`) }).catch(() => null);
    if (wg) {
      if (ry) xform(wg, { ry });
      if (sy !== 1) wg.scale(1, sy, 1);
      wg.scale(s0, s0, s0);
      wg.translate(-(b.min.x + b.max.x) / 2 * s0, keepY ? 0 : -b.min.y * s0, -(b.min.z + b.max.z) / 2 * s0);
      const { list } = components(wg);
      const pts = list.map((c0) => c0.box.getCenter(new THREE.Vector3()))
        .filter((p) => p.y > 0.4)
        .sort((a, b2) => b2.z - a.z);                                            // the front (+z) first
      out.anchors = { windows: pts.slice(0, 5).map((p) => [r3(p.x), r3(p.y), r3(p.z)]) };
    }
  }
  return out;
}

/** Rail fence along a polyline of [x, z] points (metres), posts every ~1 m, optional gaps [[x, z, r]]. */
function railFence(points, { h = 0.85, hex = WOOD, post = WOOD_D, gaps = [], pickets = false } = {}) {
  const parts = [];
  const inGap = (x, z) => gaps.some(([gx, gz, r]) => Math.hypot(x - gx, z - gz) < r);
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i]; const [x1, z1] = points[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 1.0));
    const ang = Math.atan2(z1 - z0, x1 - x0);
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n; const z = z0 + ((z1 - z0) * k) / n;
      if (inGap(x, z) && !(k === 0 || k === n)) continue;
      if (inGap(x, z)) continue;
      parts.push(box(0.12, h + 0.08, 0.12, post, { x, z }));
      parts.push(xform(P(new THREE.ConeGeometry(0.09, 0.08, 4), post), { y: h + 0.12, x, z, ry: Math.PI / 4 }));
    }
    for (let k = 0; k < n; k++) {
      const xa = x0 + ((x1 - x0) * (k + 0.5)) / n; const za = z0 + ((z1 - z0) * (k + 0.5)) / n;
      if (inGap(xa, za)) continue;
      const seg = len / n;
      for (const y of pickets ? [0.25, h - 0.15] : [0.32, h - 0.12]) parts.push(box(seg, 0.09, 0.05, hex, { y: y - 0.045, x: xa, z: za, ry: -ang }));
      if (pickets) for (let q = 1; q < 4; q++) {
        const t = (k + q / 4) / n;
        parts.push(box(0.09, h - 0.05, 0.04, hex, { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, ry: -ang }));
      }
    }
  }
  return sway(mergeAll(parts), { rigid: true });
}

/** A rectangle of fence around [-w/2, w/2] x [-d/2, d/2] with a gate at the front (+z) middle and a worn dirt
 *  patch outside it (visual-28: a pen, not a display platform). */
function penFence(w, d, opts = {}) {
  if (GROW) return xform(penFenceAt(w + 2 * GROW, d + 2 * GROW, opts), { x: GROW, z: GROW });
  return penFenceAt(w, d, opts);
}
function penFenceAt(w, d, opts = {}) {
  const hw = w / 2; const hd = d / 2;
  const g = opts.gate ?? 0.75;
  const h = opts.h ?? 0.85;
  const fence = railFence([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]], { gaps: [[0, hd, g]], ...opts });
  // the gate: a lighter frame with a Z brace, between two taller gate posts
  const gw = g * 2 - 0.16;
  const gate = mergeAll([
    box(0.16, h + 0.25, 0.16, WOOD_D, { x: -g + 0.02, z: hd }), box(0.16, h + 0.25, 0.16, WOOD_D, { x: g - 0.02, z: hd }),
    box(gw, 0.09, 0.05, '#E2B877', { y: 0.22, z: hd }), box(gw, 0.09, 0.05, '#E2B877', { y: h - 0.12, z: hd }),
    box(0.08, h - 0.2, 0.05, '#E2B877', { x: -gw / 2 + 0.06, y: 0.17, z: hd }), box(0.08, h - 0.2, 0.05, '#E2B877', { x: gw / 2 - 0.06, y: 0.17, z: hd }),
    xform(box(0.07, Math.hypot(gw, h - 0.35), 0.04, '#D2A464'), { y: 0.2, z: hd + 0.01, rz: Math.atan2(gw, h - 0.35) }),
  ]);
  // worn ground where the animals come and go, just inside the gate
  const worn = xform(blob(0.9, '#B89A6A', { seed: 17, sy: 0.02, sx: 1.2, sz: 0.5, amp: 0.25, detail: 1 }), { y: 0.016, z: hd - 0.38 });
  return sway(mergeAll([fence, gate, worn]), { rigid: true });
}

/** Gable roof: a triangular prism, ridge along z, base width w (x), length d (z), height h, with eaves. */
function gable(w, d, h, hex) {
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(0, h); sh.lineTo(-w / 2, 0);
  const g = P(new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false }), hex);
  return xform(g, { z: -d / 2 });
}

function sack(hex = '#D8C49A') {
  // ~150 triangles (a sack is dressing, five of them must not cost a building's worth)
  return mergeAll([xform(blob(0.28, hex, { seed: 4, amp: 0.1, sy: 0.75, sx: 0.85, flatBottom: 0.6, detail: 1 }), { y: 0.2 }),
    cyl(0.07, 0.1, 0.12, 6, '#B89E6E', { y: 0.38 }), torus(0.07, 0.02, '#8A6A40', { y: 0.42, rx: Math.PI / 2 }, 3, 8)]);
}
function crate(s = 0.6, hex = WOOD) {
  const parts = [box(s, s, s, hex)];
  for (const y of [0.04, s - 0.04]) for (const z of [-1, 1]) parts.push(box(s + 0.02, 0.07, 0.04, WOOD_D, { y: y - 0.035, z: z * s / 2 }));
  for (const x of [-1, 1]) parts.push(box(0.06, s, s + 0.02, WOOD_D, { x: x * (s / 2 - 0.03) }));
  return mergeAll(parts);
}
function barrel(h = 0.9, hex = '#9A6438') {
  return mergeAll([lathe([[0, 0], [0.3, 0], [0.36, h * 0.5], [0.3, h], [0, h]], 12, hex),
    torus(0.33, 0.025, '#5E5A55', { y: h * 0.2, rx: Math.PI / 2 }, 3, 12), torus(0.33, 0.025, '#5E5A55', { y: h * 0.8, rx: Math.PI / 2 }, 3, 12)]);
}
function signBoard(w, h, hex = WOOD, frame = WOOD_D) {
  return mergeAll([box(w, h, 0.08, hex), box(w + 0.1, 0.08, 0.1, frame, { y: h - 0.04 }), box(w + 0.1, 0.08, 0.1, frame, { y: -0.04 })]);
}
function chimney(h = 1.0) { return mergeAll([box(0.45, h, 0.45, '#A7A39A'), box(0.55, 0.12, 0.55, '#8C8880', { y: h - 0.06 })]); }
function hayBale() {
  return mergeAll([xform(P(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 14), '#E3C25E', { creaseDeg: 40 }), { rz: Math.PI / 2, y: 0.45 }),
    xform(P(new THREE.CylinderGeometry(0.4, 0.4, 0.91, 14), '#D4AE45', { creaseDeg: 40 }), { rz: Math.PI / 2, y: 0.45 })]);
}
function trough(len = 1.6, fill = '#E3C25E') {
  return mergeAll([box(len, 0.3, 0.45, WOOD_D, { y: 0.12 }), box(len - 0.12, 0.05, 0.33, fill, { y: 0.4 }),
    box(0.1, 0.15, 0.4, WOOD_D, { x: -len / 2 + 0.1 }), box(0.1, 0.15, 0.4, WOOD_D, { x: len / 2 - 0.1 })]);
}
/** A milk churn (VISUAL-AFTER C8: the old narrow can barely read): a fat body, a shoulder, a neck, a lid with a
 *  knob, two side handles and darker bands. */
function milkCan() {
  const band = (y) => xform(P(new THREE.CylinderGeometry(0.21, 0.21, 0.035, 10, 1, true), '#8E9AA4', { creaseDeg: 50 }), { y });
  return mergeAll([lathe([[0, 0], [0.19, 0], [0.205, 0.04], [0.205, 0.34], [0.12, 0.45], [0.1, 0.52], [0, 0.52]], 10, '#C9D2D9'),
    band(0.1), band(0.3), cyl(0.125, 0.125, 0.05, 10, '#8E9AA4', { y: 0.51 }), cyl(0.04, 0.05, 0.05, 6, '#8E9AA4', { y: 0.56 }),
    ...[-1, 1].map((sd) => xform(torus(0.06, 0.016, '#8E9AA4', {}, 3, 6), { x: sd * 0.2, y: 0.4, ry: Math.PI / 2 }))]);
}
function jar(hex = '#C8473A') {
  return mergeAll([lathe([[0, 0], [0.13, 0], [0.15, 0.08], [0.15, 0.24], [0.11, 0.3], [0, 0.3]], 12, '#BFE3EA'),
    cyl(0.13, 0.13, 0.2, 12, hex, { y: 0.05 }), cyl(0.12, 0.12, 0.06, 12, '#E84A5F', { y: 0.3 }), cyl(0.14, 0.14, 0.02, 12, '#FFFFFF', { y: 0.33 })]);
}
function spool(hex = '#9C7FD0') {
  return mergeAll([cyl(0.32, 0.32, 0.08, 14, WOOD), cyl(0.24, 0.24, 0.5, 14, hex, { y: 0.08 }), cyl(0.32, 0.32, 0.08, 14, WOOD, { y: 0.58 })]);
}
function logPile() {
  const parts = [];
  const rows = [[3, 0.2], [2, 0.55], [1, 0.9]];
  rows.forEach(([n, y]) => { for (let i = 0; i < n; i++) parts.push(xform(cyl(0.2, 0.2, 1.4, 8, TRUNK, {}, 50), { rx: Math.PI / 2, x: (i - (n - 1) / 2) * 0.42, y, z: 0.7 }), xform(cyl(0.17, 0.17, 0.01, 8, '#E2C08A', {}, 0), { rx: Math.PI / 2, x: (i - (n - 1) / 2) * 0.42, y, z: 0.71 })); });
  return mergeAll(parts);
}

// ---- A small cottage kit (wave 2): the M1b buildings, the village landmarks and the restoration sites share one
//      vocabulary with the Medieval Village sources: cream plaster between dark timbers, a stone plinth, shingled
//      roofs with cream bargeboards, framed windows with sills, planked doors. Cheap (200-1,500 triangles a piece).
const K = Object.freeze({ plaster: '#F3E6CC', timber: '#8E5A34', timberL: '#B9824A', stone: '#B5AEA2', stoneD: '#9C958A', trim: '#E8DCC2',
  glass: '#9FD3E8', door: '#7A4B2C', iron: '#5E5A55', brick: '#B5603C', mortar: '#D9C7A8' });

/** A pitched roof, ridge along z: two shingled slabs meeting at height h over a w (x) by d (z) wall box, with an
 *  overhang, cream bargeboards on both gable ends and plaster gable triangles. Base (eave line) at y = 0. */
function pitchedRoof(w, d, h, hex, { oh = 0.32, thick = 0.14, gableHex = K.plaster, trim = K.trim, bands = 8, ridge = true } = {}) {
  const half = w / 2;
  const a = Math.atan2(h, half);
  const L = Math.hypot(half, h) + oh / Math.cos(a);
  const parts = [];
  for (const s of [-1, 1]) {
    const slab = box(L, thick, d + oh * 2, hex);
    slab.translate(0, -thick, 0);                                     // the slab's top surface is its local y = 0
    xform(slab, { rz: -s * a });
    // place so the ridge end of the top surface sits at (0, h)
    xform(slab, { x: s * (Math.cos(a) * L / 2 - 0.0), y: h - Math.sin(a) * L / 2 + 0.02 });
    parts.push(slab);
  }
  const roof = roofTreatment(mergeAll(parts), { eaves: 1, bands, tones: [0.88, 1.0, 1.1] });
  const out = [roof];
  // gable triangles (plaster) and bargeboards (cream) at both ends
  for (const zs of [-1, 1]) {
    const tri = new THREE.Shape(); tri.moveTo(-half, 0); tri.lineTo(half, 0); tri.lineTo(0, h); tri.closePath();
    out.push(xform(P(new THREE.ExtrudeGeometry(tri, { depth: 0.08, bevelEnabled: false }), gableHex), { z: zs * d / 2 - 0.04 }));
    for (const s of [-1, 1]) {
      const bb = box(Math.hypot(half + oh, h + oh * Math.tan(a)), 0.16, 0.06, trim);
      bb.translate(0, -0.15, 0);                                      // covers the slab's edge
      xform(bb, { rz: -s * a });
      xform(bb, { x: s * (half + oh) / 2, y: h / 2 + 0.02 - oh * Math.tan(a) / 2, z: zs * (d / 2 + oh - 0.02) });
      out.push(bb);
    }
  }
  if (ridge) out.push(xform(box(0.16, 0.1, d + oh * 2 + 0.06, boost(lin(hex), 0, -0.08).getStyle()), { y: h - 0.02 }));
  return mergeAll(out);
}

/** A framed window on a wall facing +z (glass, a timber frame with a cross, a sill, optional shutters). */
function windowBox(w = 0.7, h = 0.8, { shutters = null, frame = K.trim, cross = true } = {}) {
  const parts = [box(w, h, 0.06, K.glass), box(w + 0.12, 0.08, 0.1, frame, { y: h }), box(w + 0.12, 0.08, 0.1, frame, { y: -0.08 }),
    box(0.08, h, 0.1, frame, { x: -w / 2 - 0.02 }), box(0.08, h, 0.1, frame, { x: w / 2 + 0.02 }), box(w + 0.24, 0.07, 0.22, frame, { y: -0.12, z: 0.06 })];
  if (cross) parts.push(box(0.05, h, 0.08, frame), box(w, 0.05, 0.08, frame, { y: h / 2 - 0.025 }));
  if (shutters) for (const s of [-1, 1]) parts.push(box(w * 0.5, h + 0.04, 0.05, shutters, { x: s * (w * 0.75 + 0.08), y: -0.02, z: 0.03 }));
  return mergeAll(parts);
}
/** A planked door with a frame and a little step (faces +z). */
function doorBox(w = 0.8, h = 1.5, hex = K.door) {
  const parts = [box(w, h, 0.06, hex), box(w + 0.14, 0.1, 0.1, K.timber, { y: h }), box(0.08, h, 0.1, K.timber, { x: -w / 2 - 0.03 }), box(0.08, h, 0.1, K.timber, { x: w / 2 + 0.03 }),
    box(w + 0.3, 0.12, 0.4, K.stone, { y: -0.12, z: 0.18 }), ball(0.035, '#E9B13A', { x: w * 0.32, y: h * 0.48, z: 0.05 }, 0)];
  for (let i = 1; i < 4; i++) parts.push(box(0.02, h - 0.04, 0.07, boost(lin(hex), 0, -0.06).getStyle(), { x: -w / 2 + (w * i) / 4, y: 0.02 }));
  return mergeAll(parts);
}
/** A timber-framed wall box: plaster walls w x h x d on a stone plinth, corner posts, a girt and braces. */
function timberHouse(w, h, d, { plaster = K.plaster, plinth = 0.3, braces = true } = {}) {
  const parts = [box(w + 0.16, plinth, d + 0.16, K.stoneD), box(w, h, d, plaster, { y: plinth })];
  const t = 0.14;
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(box(t, h, t, K.timber, { x: x * w / 2, y: plinth, z: z * d / 2 }));
  for (const z of [-1, 1]) parts.push(box(w + 0.04, t, 0.06, K.timber, { y: plinth + h * 0.5, z: z * (d / 2 + 0.02) }), box(w + 0.08, t, 0.06, K.timber, { y: plinth + h - t, z: z * (d / 2 + 0.02) }));
  for (const x of [-1, 1]) parts.push(box(0.06, t, d + 0.04, K.timber, { x: x * (w / 2 + 0.02), y: plinth + h * 0.5 }), box(0.06, t, d + 0.08, K.timber, { x: x * (w / 2 + 0.02), y: plinth + h - t }));
  if (braces) for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const len = Math.hypot(d * 0.3, h * 0.45);
    parts.push(xform(box(0.06, len, 0.1, K.timber), { rx: z * Math.atan2(d * 0.3, h * 0.45) * x, x: x * (w / 2 + 0.03), y: plinth + h * 0.27, z: z * d * 0.28 }));
  }
  return mergeAll(parts);
}
/** A chimney stack of stone with a darker cap and a clay pot (sits on y = 0, top at h). */
function stack(h = 1.2, w = 0.5) {
  return mergeAll([box(w, h, w, K.stoneD), box(w + 0.1, 0.12, w + 0.1, '#7F796F', { y: h - 0.12 }), cyl(0.09, 0.11, 0.22, 8, '#B5603C', { y: h })]);
}
/** A striped canvas awning sloping down toward +z (w wide, reaching out d). */
function awning(w, d, cols = ['#FFF8EC', '#C8473A'], n = 7) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(box(w / n + 0.002, 0.04, d, cols[i % cols.length], { x: -w / 2 + (w / n) * (i + 0.5) }));
  const g = mergeAll(parts);
  g.translate(0, 0, d / 2);
  xform(g, { rx: 0.42 });
  // a scalloped valance along the front edge
  const v = [];
  for (let i = 0; i < n; i++) v.push(xform(P(new THREE.CircleGeometry(w / n / 2, 8, Math.PI, Math.PI), cols[i % cols.length]), { x: -w / 2 + (w / n) * (i + 0.5), y: -Math.sin(0.42) * d, z: Math.cos(0.42) * d + 0.01 }));
  return mergeAll([g, ...v]);
}
/** A flower box under a window: a planter of small flat flowers. */
function flowerBox(w = 0.8, cols = ['#FF7A9C', '#FFD21F', '#FFFFFF']) {
  const parts = [box(w, 0.18, 0.2, K.timber)];
  for (let i = 0; i < 5; i++) parts.push(xform(blob(0.07, '#4C9A3E', { seed: i, detail: 0 }), { x: -w / 2 + 0.1 + i * (w - 0.2) / 4, y: 0.2 }),
    xform(flatFlower(cols[i % cols.length], 0.06), { x: -w / 2 + 0.12 + i * (w - 0.2) / 4, y: 0.26, z: 0.03 }));
  return mergeAll(parts);
}
/** A big wooden spool of thread (the Sewing Table's signature). */
function bigSpool(hex = '#E8556F', r = 0.32, h = 0.5) {
  return mergeAll([cyl(r * 1.25, r * 1.25, 0.07, 14, WOOD), cyl(r, r, h, 14, hex, { y: 0.07 }), cyl(r * 1.25, r * 1.25, 0.07, 14, WOOD, { y: h + 0.07 }),
    ...[0.2, 0.45, 0.7].map((k) => torus(r + 0.005, 0.012, boost(lin(hex), 0, -0.08).getStyle(), { y: 0.07 + h * k, rx: Math.PI / 2 }, 4, 14)),
    xform(cyl(0.015, 0.015, 0.5, 4, hex, {}, 0), { rz: 1.1, x: r + 0.18, y: 0.2 })]);
}
/** A dressmaker's form on a stand, in a dress. */
function dressForm(dress = '#7FB8E6') {
  return mergeAll([cyl(0.22, 0.26, 0.05, 10, K.timber), cyl(0.025, 0.025, 0.7, 6, K.timber, { y: 0.05 }),
    lathe([[0.05, 0], [0.3, 0.02], [0.24, 0.35], [0.17, 0.55], [0.2, 0.72], [0.17, 0.82], [0.08, 0.86], [0, 0.86]], 12, dress).translate(0, 0.62, 0),
    xform(cyl(0.035, 0.05, 0.12, 6, '#F3E6CC'), { y: 1.47 }), ball(0.06, '#F3E6CC', { y: 1.62 }, 0)]);
}

// ---------------------------------------------------------------------------------------------------
// 11. Buildings (GDD §3.5, §2.3): a source building fitted to its footprint, a roof-colour rule and a
//     signature prop (GDD §8.1 "Telling things apart"). Moving parts (windmill sails) are separate keys with a
//     pivot in the manifest: key 'building:mill:sails' + info.pivot [x, y, z] + info.axis 'z'.
const ROOF = { RoofTiles: null, RoofTiles_Red: null };
const BUILD = [];
const building = (id, size, build, extra = {}) => BUILD.push({ id, size, build, extra });

const MV_SAT = 0.22;
// Brighter, warmer medieval-village palette (FV2 houses read cream, white and red, not grey stone), with ONE
// restrained roof family (visual-11): every building keeps its own hue, but they belong together on the lawn.
const MV_PAL = { Stone_Dark: '#9C958A', Stone: '#B5AEA2', Stone_Light: '#CFC8BA', Plaster: '#F6E9CF', Beige: '#E8DCC2',
  Wood: '#8E5A34', Wood_Side: '#7A4B2C', Wood_Light: '#B9824A', DarkWood: '#6E4428', Windows: '#9FD3E8', RoofTiles: '#5B6E8C', RoofTiles_Red: '#A84F3D' };
export const ROOFS = Object.freeze({ farmhouse: '#5B6E8C', preserves: '#76576F', weaver: '#88768F', bakery: '#B86740', kitchen: '#A84F3D',
  mill: '#4F8A99', dairy: '#6F93B8', sawmill: '#8E5E48', sewing: '#9A5A6A', pie_oven: '#9C5A3C', chandlery: '#C98F3E', packing: '#5C7D6B' });
/** The building look (visual-11): the roof hue unboosted, cream trim, shingle rows and eaves, window anchors. */
const BLD = (roof, extra = {}) => ({ sat: MV_SAT, boost: false, roof: { mat: /^RoofTiles/, eaves: 1.07 }, windows: { source: 'Windows' },
  recolor: { RoofTiles: roof, RoofTiles_Red: roof }, ...extra });
/** Building triangle budget. Wave 1 forced the 5-8k-triangle sources down to 3.8k with a relative error, which
 *  flattened every trim thinner than ~5 cm into its wall: torn dormers, missing window frames, spiky brackets,
 *  sliver milk cans (VISUAL-AFTER C1, the top-ranked visual defect). Now the reduction is capped by an ABSOLUTE
 *  error (4 mm, then 6 mm; never more), which keeps every trim and frame and drops only bevels and coplanar
 *  splits: 2-8.6k triangles a building (6.6k on average; the GPU cost of the extra
 *  triangles is ~0.1 ms on the Vega iGPU, the fill-rate bound frame does not notice). The far band uses a ~2k `building:<id>:far` twin (render-world's LOD swap,
 *  like crop:*:far), so a heavy farm at the far zoom costs what it did. */
const BUILDING_TRIS = 6000;
const BUILDING_CAP = 9000;
const BUILDING_FAR = 2200;
/** Attach anchors (chimney, windows, counter) to a merged building for the manifest (RD-37). */
const withAnchors = (geo, anchors) => { geo.anchors = anchors; return geo; };
/** The source's own chimney: the highest grey (stone) part in the top third of a fitted building, as the anchor
 *  [x, top, z] for the smoke. Medieval Village houses carry their chimney; adding a second box beside it read as a
 *  stray block (VISUAL-AFTER C1). */
function sourceChimney(g) {
  const { src, list } = components(g);
  const c = src.getAttribute('color');
  const b = bounds(src);
  const H = b.max.y - b.min.y;
  const col = new THREE.Color(); const hs = {};
  let best = null;
  for (const comp of list) {
    if (comp.box.min.y < b.min.y + H * 0.55) continue;
    let r = 0; let gg = 0; let bl = 0;
    for (const f of comp.faces) { r += c.getX(f * 3); gg += c.getY(f * 3); bl += c.getZ(f * 3); }
    const n = comp.faces.length;
    col.setRGB(r / n, gg / n, bl / n).getHSL(hs, THREE.SRGBColorSpace);
    if (hs.s > 0.22 || hs.l < 0.35 || hs.l > 0.85) continue;      // stone grey only (not roof, plaster or timber)
    if (!best || comp.box.max.y > best.max.y) best = comp.box;
  }
  if (!best) return null;
  return [r3((best.min.x + best.max.x) / 2), r3(best.max.y), r3((best.min.z + best.max.z) / 2)];
}
// wave 4 (owner wish B): the red-and-white American farmhouse of the owners' reference picture (section 17, farmhouseW4);
// the Medieval Village House_2 it replaces stays the scaffold's stand-in (restoration-view) and the village's cottages
building('farmhouse', [4, 4], async () => farmhouseW4(0), { aliases: ['farm_house', 'house'] });

const BARN_SRC = ['SmallBarn', 'Barn', 'BigBarn', 'BigBarn'];
/** The barn's door leaves (wave 4, owner wish 8: the doors swing open when the Barn is clicked): the source's door
 *  nodes come out of the body (a dark doorway stays behind each) and become parts of their own, `<barn key>:door<i>`,
 *  modelled about their hinge (manifest `hinge` [x, y, z] in the barn's space, `swing` +1 | -1 the outward turn). */
const BARN_DOORS = { SmallBarn: ['Small_Barn_Door'], Barn: ['Barn_Door', 'Barn_Door2'], BigBarn: ['BigBarn_Door', 'BigBarn_Door2'] };
const barnCache = new Map();
async function barnParts(lvl) {
  if (barnCache.has(lvl)) return barnCache.get(lvl);
  const rel = FB(BARN_SRC[lvl]);
  const o = { recolor: { RoofBlack: '#5B4A44' }, sat: 0.18, boostRecolor: true };
  const whole = await bakeStatic(rel, o);
  const b = bounds(whole);
  const fill = lvl === 0 ? 0.8 : 0.92;
  const sc = Math.min((8 * fill) / (b.max.x - b.min.x), (8 * fill) / (b.max.z - b.min.z));
  const place = (g) => { g.scale(sc, sc, sc); g.translate(-(b.min.x + b.max.x) / 2 * sc, -b.min.y * sc, -(b.min.z + b.max.z) / 2 * sc); return g; };
  const body = place(await bakeStatic(rel, { ...o, skipNodes: /Door/ }));
  const doors = [];
  const ways = [];
  for (const name of BARN_DOORS[BARN_SRC[lvl]]) {
    const g = place(await bakeStatic(rel, { ...o, onlyNodes: new RegExp(`^${name}$`) }));
    const db = bounds(g);
    const left = (db.min.x + db.max.x) / 2 <= 0;
    const hinge = [r3(left ? db.min.x : db.max.x), 0, r3((db.min.z + db.max.z) / 2)];
    g.translate(-hinge[0], 0, -hinge[2]);
    doors.push({ geo: g, hinge, swing: left ? -1 : 1 });
    // the dark barn inside, seen when the leaf swings out
    // (just in front of the wall the leaf lies on, inside the leaf while it is shut: seen only when it swings out), with
    // a glimpse of straw on its floor
    ways.push(box(db.max.x - db.min.x - 0.08, db.max.y - db.min.y - 0.06, 0.02, '#2A1D14', { x: (db.min.x + db.max.x) / 2, y: db.min.y + 0.03, z: db.min.z + 0.03 }),
      box(db.max.x - db.min.x - 0.12, 0.12, 0.022, '#C9A84E', { x: (db.min.x + db.max.x) / 2, y: db.min.y + 0.04, z: db.min.z + 0.035 }));
  }
  const out = { body: mergeAll([body, ...ways]), doors };
  barnCache.set(lvl, out);
  return out;
}
for (let lvl = 0; lvl < 4; lvl++) {
  building(lvl ? `barn:${lvl}` : 'barn', [4, 4], async () => {
    const g = (await barnParts(lvl)).body.clone();
    const parts = [g];
    if (lvl === 3) parts.push(xform(await srcFit(FB('Silo'), { h: 7.5, sat: 0.18 }), { x: 3.1, z: -2.4 }));
    if (lvl >= 1) parts.push(xform(hayBale(), { x: -3.1, z: 3.2 }), xform(crate(0.6), { x: 3.1, z: 3.3 }));
    return mergeAll(parts);
  }, { def: 'barn', family: 'building' });
  const key = lvl ? `building:barn:${lvl}` : 'building:barn';
  BARN_DOORS[BARN_SRC[lvl]].forEach((name, i) => {
    job(`${key}:door${i}`, 'buildings/barn.glb', { family: 'building', footprint: [4, 4], part: true, door: true }, async () => {
      const d = (await barnParts(lvl)).doors[i];
      const meta = JOBS.find((j) => j.key === `${key}:door${i}`).meta;
      meta.hinge = d.hinge; meta.swing = d.swing;
      return sway(d.geo.clone(), { rigid: true });
    });
  });
}

building('market_stand', [2, 2], async () => {
  const st = await srcFit(MVP('MarketStand_1'), { w: 4, d: 4, fill: 0.85, sat: MV_SAT, recolor: { RoofTiles_Red: '#E84A3A', Beige: '#FFF2D6' } });
  const crates = [];
  const fruits = ['#E23B3B', '#F59A23', '#9BD86A', '#F2D04B'];
  for (let i = 0; i < 3; i++) {
    const c = crate(0.5);
    const top = [];
    for (let k = 0; k < 6; k++) top.push(ball(0.09, fruits[(i + k) % 4], { x: ((k % 3) - 1) * 0.14, y: 0.55, z: (Math.floor(k / 3) - 0.5) * 0.15 }, 0));
    crates.push(xform(mergeAll([c, ...top]), { x: -0.9 + i * 0.85, y: 0, z: 1.55 }));
  }
  return mergeAll([st, ...crates]);
}, { aliases: ['market'] });

building('order_board', [2, 1], async () => {
  const parts = [box(0.14, 2.2, 0.14, WOOD_D, { x: -1.5 }), box(0.14, 2.2, 0.14, WOOD_D, { x: 1.5 }),
    box(3.0, 1.3, 0.1, '#7A4B3A', { y: 0.75 }), box(3.3, 0.12, 0.6, '#C8473A', { y: 2.15 }),
    xform(gable(0.8, 3.5, 0.4, '#C8473A'), { ry: Math.PI / 2, y: 2.2 })];
  const notes = ['#FFF8EC', '#FFE9A8', '#FFF8EC', '#D6F1FF', '#FFF8EC', '#FFD9D2'];
  notes.forEach((hex, i) => parts.push(box(0.5, 0.42, 0.03, hex, { x: -1.0 + (i % 3) * 1.0, y: 0.85 + Math.floor(i / 3) * 0.55, z: 0.07, rz: (i % 2 ? 0.06 : -0.05) })));
  return mergeAll(parts);
}, { aliases: ['orders_board', 'orderboard', 'mabel_board'] });

building('mailbox', [1, 1], async () => mergeAll([cyl(0.06, 0.07, 1.1, 6, WOOD_D), xform(P(new THREE.CapsuleGeometry(0.2, 0.45, 3, 10), '#4AA8E8', { creaseDeg: 60 }), { rx: Math.PI / 2, y: 1.22 }),
  box(0.04, 0.3, 0.14, '#E84A3A', { x: 0.22, y: 1.4, z: 0.1 }), box(0.3, 0.25, 0.02, '#FFF8EC', { y: 1.22, z: 0.36 })]));
// wave 4 (wish E): one procedural family so the Well's tiers read as the same well, improved (section 17, wellW4)
building('well', [2, 2], async () => wellW4(0));

building('feed_mill', [3, 3], async () => {
  const g = await srcFit(FB('Silo_House'), { w: 6, d: 6, h: 7.2, fill: 0.86, sat: 0.18 });
  return mergeAll([g, xform(sack('#E3D3A8'), { x: 1.7, z: 2.3 }), xform(sack('#D8C49A'), { x: 2.25, z: 2.0, ry: 0.6 }), xform(sack('#E3D3A8'), { x: 1.95, y: 0.45, z: 2.15 })]);
});

building('mill', [3, 3], async () => {
  const g = await srcFit(MVB('Mill'), { w: 6, d: 6, fill: 0.8, skipNodes: /Blades/, ...BLD(ROOFS.mill) });
  const b = bounds(g);
  // a grain-loading corner (VISUAL-AFTER C9): a cart of sacks by the door, a stack of sacks, a hoist beam and rope
  const cart = await srcFit(MVP('Cart'), { w: 1.7, d: 1.0, sat: 0.2, maxTris: 500 });
  const load = mergeAll([cart, xform(sack('#E8D9AE'), { x: -0.25, y: 0.55, s: 0.8 }), xform(sack('#D8C49A'), { x: 0.25, y: 0.55, s: 0.75, ry: 0.8 })]);
  const hoist = mergeAll([box(0.12, 0.12, 0.9, K.timber, { z: 0.35 }), cyl(0.012, 0.012, 1.6, 4, '#D9B97A', { y: -1.6, z: 0.75 }, 0), xform(sack('#E8D9AE'), { y: -1.95, z: 0.75, s: 0.55 })]);
  return withAnchors(mergeAll([g, xform(load, { x: -1.75, z: b.max.z + 0.25, ry: 0.35 }), xform(sack(), { x: 1.95, z: b.max.z - 0.1 }), xform(sack('#E8D9AE'), { x: 2.25, z: b.max.z - 0.45, ry: 1 }),
    xform(sack(), { x: 2.1, y: 0.42, z: b.max.z - 0.25, s: 0.85, ry: 2 }), xform(hoist, { x: 0.9, y: b.max.y * 0.62, z: b.max.z - 0.5 })]), { windows: g.anchors?.windows });
}, { aliases: ['windmill'] });

building('bakery', [3, 3], async () => {
  const g = await srcFit(MVB('House_1'), { w: 6, d: 6, fill: 0.78, ...BLD(ROOFS.bakery) });
  const b = bounds(g);
  const loaf = await srcFit(KF('loaf-round'), { w: 1.3, d: 1.3, sat: 0.2 });
  return withAnchors(mergeAll([g, xform(signBoard(1.2, 0.9), { x: 1.7, y: 2.1, z: b.max.z + 0.05 }), xform(loaf, { x: 1.7, y: 2.2, z: b.max.z + 0.3 })]),
  { chimney: sourceChimney(g), windows: g.anchors?.windows });
});

building('sawmill', [3, 3], async () => {
  const g = await srcFit(MVB('Sawmill'), { w: 6, d: 6, fill: 0.86, ...BLD(ROOFS.sawmill) });
  return withAnchors(mergeAll([g, xform(logPile(), { x: -1.6, z: 1.1, s: 0.75 })]), { windows: g.anchors?.windows });
});

building('juice_press', [2, 2], async () => {
  const st = await srcFit(KT('stall-green'), { w: 4, d: 4, fill: 0.78, sat: 0.25 });
  return mergeAll([st, xform(barrel(1.1, '#B5743E'), { x: -1.2, z: 1.2 }),
    ...[0, 1, 2, 3, 4].map((i) => ball(0.13, i % 2 ? '#F59A23' : '#E23B3B', { x: -1.25 + (i % 3) * 0.12, y: 1.2, z: 1.15 + Math.floor(i / 3) * 0.12 }, 1)),
    xform(crate(0.55), { x: 1.25, z: 1.25 })]);
});

building('dairy', [3, 3], async () => {
  // the dairy (VISUAL-AFTER C9): a porch counter at the front with grouped churns and a cheese wheel on a barrel,
  // and a hanging sign with a cheese wedge and a milk bottle on it, so it is not just "the blue house"
  const g = await srcFit(MVB('House_2'), { w: 6, d: 6, fill: 0.74, ...BLD(ROOFS.dairy) });
  const b = bounds(g);
  const fz = b.max.z;
  const wedge = (() => { const sh = new THREE.Shape(); sh.moveTo(-0.22, 0); sh.lineTo(0.22, 0); sh.lineTo(0.22, 0.16); sh.lineTo(-0.22, 0.04); sh.closePath();
    return P(new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false }), '#F2C94C'); })();
  const sign = mergeAll([box(0.07, 0.07, 0.8, K.iron, { y: 0.62 }), box(0.03, 0.22, 0.03, K.iron, { y: 0.42, z: 0.62 }),
    xform(signBoard(0.85, 0.5, '#FFF8EC', ROOFS.dairy), { y: -0.12, z: 0.62 }), xform(wedge, { x: -0.16, y: 0.02, z: 0.68 }),
    xform(lathe([[0, 0], [0.07, 0], [0.075, 0.16], [0.03, 0.24], [0.03, 0.29], [0, 0.29]], 8, '#FFFFFF'), { x: 0.22, y: -0.03, z: 0.69 })]);
  const counter = mergeAll([box(1.7, 0.82, 0.6, WOOD), box(1.8, 0.07, 0.7, K.trim, { y: 0.82 }), box(0.07, 1.9, 0.07, K.timber, { x: -0.85, z: 0.3 }), box(0.07, 1.9, 0.07, K.timber, { x: 0.85, z: 0.3 }),
    xform(awning(1.9, 0.6, ['#FFF8EC', ROOFS.dairy], 8), { y: 1.9, z: 0.0 }),
    xform(milkCan(), { x: -0.4, y: 0.89, s: 0.62 }), xform(jar('#FFF8EC'), { x: 0.05, y: 0.89, s: 0.7 }),
    xform(mergeAll([cyl(0.2, 0.2, 0.12, 14, '#F2C94C'), cyl(0.21, 0.21, 0.02, 14, '#E0B23A', { y: 0.05 })]), { x: 0.6, y: 0.89 })]);
  const churns = mergeAll([xform(milkCan(), { x: 0, z: 0 }), xform(milkCan(), { x: 0.44, z: 0.1, ry: 0.6 }),
    xform(barrel(0.75), { x: -0.7, z: 0.05 }), xform(mergeAll([cyl(0.28, 0.28, 0.18, 16, '#F2C94C'), cyl(0.285, 0.285, 0.03, 16, '#E0B23A', { y: 0.075 })]), { x: -0.7, y: 0.75, z: 0.05 })]);
  return withAnchors(mergeAll([g, xform(sign, { x: 1.85, y: 2.15, z: fz - 0.7 }), xform(counter, { x: -1.15, z: fz + 0.15 }), xform(churns, { x: 1.55, z: fz + 0.5 })]),
    { chimney: sourceChimney(g), windows: g.anchors?.windows, counter: [-1.15, 1.6, r3(fz + 0.2)] });
});

building('compost_bin', [2, 2], async () => {
  const parts = [];
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < 4; k++) {
      const slat = box(3.0, 0.16, 0.08, k % 2 ? WOOD : '#C99050', { y: 0.12 + k * 0.24 });
      xform(slat, { z: 1.45 });
      xform(slat, { ry: side * Math.PI / 2 });
      parts.push(slat);
    }
  }
  for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]) parts.push(box(0.16, 1.15, 0.16, WOOD_D, { x, z }));
  parts.push(xform(blob(1.25, '#5A3A22', { seed: 9, amp: 0.15, sy: 0.4, flatBottom: 0.1 }), { y: 0.55 }));
  for (let i = 0; i < 6; i++) parts.push(xform(leaf(0.3, 0.16, i % 2 ? '#7DBB4E' : '#C9A040', { bend: 0.6 }), { x: Math.cos(i) * 0.6, y: 0.95, z: Math.sin(i * 1.3) * 0.5, ry: i }));
  return mergeAll(parts);
}, { aliases: ['compost'] });

building('kitchen', [3, 3], async () => {
  const g = await srcFit(MVB('Inn'), { w: 6, d: 6, fill: 0.84, ...BLD(ROOFS.kitchen) });
  const b = bounds(g);
  const pot = await srcFit(QF('CookingPot_Soup'), { w: 0.9, d: 0.9, sat: 0.2 });
  const ch = [b.max.x * 0.3, b.max.y * 0.8, -0.35];
  return withAnchors(mergeAll([g, xform(stack(1.2, 0.5), { x: ch[0], y: ch[1], z: ch[2] }), xform(pot, { x: 2.3, z: b.max.z + 0.1 })]),
    { chimney: [r3(ch[0]), r3(ch[1] + 1.42), r3(ch[2])], windows: g.anchors?.windows });
}, { aliases: ['farm_kitchen'] });

building('preserves', [3, 3], async () => {
  // a jam shop, not a fortress (visual-11): the stone house 25 % squatter under a plum gable, a shop window with
  // jars in it and a counter in front
  const g = await srcFit(MVB('House_3'), { w: 6, d: 6, fill: 0.74, sat: MV_SAT, boost: false, sy: 0.75 });
  const b = bounds(g);
  const W = b.max.x - b.min.x; const D = b.max.z - b.min.z;
  const roof = mergeAll([xform(gable(D + 0.4, W + 0.45, 1.7, ROOFS.preserves), { ry: Math.PI / 2, y: b.max.y - 0.05 }),
    box(W + 0.5, 0.14, 0.18, '#E8DCC2', { y: b.max.y - 0.1, z: D / 2 + 0.12 }), box(W + 0.5, 0.14, 0.18, '#E8DCC2', { y: b.max.y - 0.1, z: -D / 2 - 0.12 })]);
  roofTreatment(roof, { eaves: 1.0, bands: 7 });
  const win = mergeAll([box(1.7, 1.05, 0.08, '#9FD3E8', { x: 0.9, y: 0.75, z: b.max.z + 0.02 }), box(1.85, 0.12, 0.14, '#E8DCC2', { x: 0.9, y: 0.7, z: b.max.z + 0.05 }),
    box(1.85, 0.12, 0.14, '#E8DCC2', { x: 0.9, y: 1.82, z: b.max.z + 0.05 }), box(0.1, 1.1, 0.12, '#E8DCC2', { x: 0.9, y: 0.75, z: b.max.z + 0.06 }),
    ...['#E83A55', '#F59A23', '#8C4FA6'].map((hex, i) => xform(jar(hex), { x: 0.4 + i * 0.45, y: 0.82, z: b.max.z - 0.08, s: 0.9 }))]);
  const counter = mergeAll([box(1.9, 0.85, 0.55, WOOD, { x: -1.2, z: b.max.z + 0.42 }), box(2.0, 0.08, 0.65, '#E8DCC2', { x: -1.2, y: 0.85, z: b.max.z + 0.42 }),
    ...['#E83A55', '#F59A23', '#E83A55'].map((hex, i) => xform(jar(hex), { x: -1.8 + i * 0.55, y: 0.93, z: b.max.z + 0.42 }))]);
  return withAnchors(mergeAll([g, roof, win, counter]), { windows: [[0.9, 1.25, r3(b.max.z + 0.1)]], counter: [-1.2, 2.2, r3(b.max.z + 0.42)] });
}, { aliases: ['preserves_kitchen'] });

building('weaver', [3, 3], async () => {
  const g = await srcFit(MVB('Stable'), { w: 6, d: 6, fill: 0.86, ...BLD(ROOFS.weaver) });
  const b = bounds(g);
  return withAnchors(mergeAll([g, xform(spool(ROOFS.weaver), { x: -2.1, z: b.max.z + 0.2 }), xform(spool('#FF7A6B'), { x: -1.4, z: b.max.z + 0.3, s: 0.8 }),
    xform(blob(0.3, '#FFFFFF', { seed: 2, detail: 1 }), { x: 2.2, y: 0.3, z: b.max.z + 0.2 })]), { windows: g.anchors?.windows });
}, { aliases: ['weavers_shed', 'weaver_shed'] });

// M1b buildings (wave 2): the cottage kit in the Medieval Village vocabulary, each with its own roof colour and a
// signature you can read from the default zoom (GDD §8.1): a giant spool and a dress form (Sewing Table), a brick
// dome oven with a giant pie (Pie Oven), a giant candle sign and drying candles (Chandlery), a packing shed with
// hampers and a laden cart (Packing Table).
/** Tone a part in horizontal bands (brick courses, mortar rings): per triangle, by height. */
const courses = (g, n = 6, tones = [0.9, 1.06]) => roofTreatment(g, { eaves: 1, bands: n, tones });
/** A pie (crust, filling, lattice) lying flat, diameter 2r. */
function pieGeo(r = 0.3, fill = '#C81E3C', crust = '#E0A858') {
  const parts = [lathe([[0, 0], [r * 0.86, 0], [r * 0.98, r * 0.24], [r, r * 0.3], [0, r * 0.3]], 18, crust, 40), cyl(r * 0.86, r * 0.86, 0.02, 18, fill, { y: r * 0.27 }, 0)];
  for (let i = -1; i <= 1; i++) for (const ry of [0, Math.PI / 2]) parts.push(xform(box(r * 1.72 * Math.sqrt(1 - (i / 2.2) ** 2), 0.035, r * 0.2, crust), { y: r * 0.3 + (ry ? 0.012 : 0), z: (i * r) / 2.2, ry }));
  parts.push(xform(torus(r * 0.92, r * 0.08, boost(lin(crust), 0, 0.04).getStyle(), {}, 5, 20), { rx: Math.PI / 2, y: r * 0.3 }));
  return mergeAll(parts);
}
building('sewing', [2, 2], async () => {
  const W = 2.5; const D = 2.1; const H = 1.95; const P0 = 0.3; const front = D / 2 + 0.03;
  const parts = [timberHouse(W, H, D), xform(pitchedRoof(W, D, 1.3, ROOFS.sewing, { oh: 0.26 }), { y: P0 + H }),
    xform(doorBox(0.7, 1.45, '#9C5268'), { x: -0.6, y: P0, z: front }),
    xform(windowBox(0.8, 0.72, { shutters: '#C86A80' }), { x: 0.58, y: P0 + 0.72, z: front }),
    xform(flowerBox(0.95, ['#FF9FB0', '#FFFFFF', '#FFD21F']), { x: 0.58, y: P0 + 0.5, z: front + 0.1 }),
    xform(windowBox(0.42, 0.42), { y: P0 + H + 0.3, z: front - 0.02 }),
    xform(windowBox(0.7, 0.7, { shutters: '#C86A80' }), { ry: Math.PI / 2, x: W / 2 + 0.03, y: P0 + 0.75 }),
    xform(awning(1.2, 0.55, ['#FFF8EC', '#D2607A']), { x: 0.58, y: P0 + 1.66, z: front }),
    xform(stack(1.0, 0.34), { x: -0.62, y: P0 + H + 0.5, z: -0.45 }),
    // signature: a giant spool of thread on the corner and a dress form on the stoop, bolts of cloth on a bench
    xform(bigSpool('#E8556F', 0.3, 0.46), { x: 1.45, z: 1.45 }),
    xform(dressForm('#7FB8E6'), { x: -1.42, z: 1.35, ry: 0.5 }),
    xform(mergeAll([box(0.9, 0.08, 0.36, WOOD, { y: 0.42 }), box(0.07, 0.42, 0.3, WOOD_D, { x: -0.38 }), box(0.07, 0.42, 0.3, WOOD_D, { x: 0.38 }),
      ...['#9C7FD0', '#FFF2D6', '#4AA8E8'].map((hex, i) => xform(cyl(0.09, 0.09, 0.42, 8, hex), { rz: Math.PI / 2, x: 0, y: 0.59 + (i === 2 ? 0.16 : 0), z: i === 2 ? 0 : (i - 0.5) * 0.19 }))]),
    { x: -0.1, z: 1.55 })];
  return withAnchors(mergeAll(parts), { chimney: [-0.62, r3(P0 + H + 1.72), -0.45], windows: [[0.58, r3(P0 + 1.08), r3(front)], [0, r3(P0 + H + 0.51), r3(front)]],
    counter: [-0.1, 1.2, 1.55] });
});
building('pie_oven', [3, 2], async () => {
  const parts = [box(5.6, 0.16, 3.6, '#C9BFAE')];
  // the oven: a stone base, a brick dome in courses, an arched mouth glowing with embers, a stack at the back
  const ox = -1.3; const base = 0.16 + 0.85;
  parts.push(box(2.5, 0.85, 2.5, K.stone, { x: ox, y: 0.16 }), box(2.62, 0.1, 2.62, K.stoneD, { x: ox, y: base - 0.04 }));
  parts.push(xform(courses(lathe([[0, 0], [1.12, 0], [1.1, 0.3], [0.98, 0.62], [0.78, 0.88], [0.48, 1.05], [0, 1.1]], 16, K.brick, 35), 7), { x: ox, y: base }));
  const arch = (r, h) => { const sh = new THREE.Shape(); sh.moveTo(-r, 0); sh.lineTo(-r, h); sh.absarc(0, h, r, Math.PI, 0, true); sh.lineTo(r, 0); sh.closePath(); return sh; };
  parts.push(xform(P(new THREE.ExtrudeGeometry(arch(0.5, 0.3), { depth: 0.16, bevelEnabled: false, curveSegments: 8 }), '#E2D6C2'), { x: ox, y: base, z: 1.02 }),
    xform(P(new THREE.ExtrudeGeometry(arch(0.38, 0.22), { depth: 0.04, bevelEnabled: false, curveSegments: 8 }), '#2E1C12'), { x: ox, y: base, z: 1.16 }),
    xform(P(new THREE.ExtrudeGeometry(arch(0.26, 0.1), { depth: 0.02, bevelEnabled: false, curveSegments: 6 }), '#FF8A3D'), { x: ox, y: base, z: 1.19 }),
    xform(stack(1.05, 0.42), { x: ox - 0.15, y: base + 0.7, z: -0.55 }),
    xform(logPile(), { x: ox - 1.0, z: 0.6, s: 0.55, ry: Math.PI / 2 }));
  // the bake shed: posts, a shingled roof, a counter with pies cooling, flour and apples
  const sx = 1.35; const sd = 2.8; const sw = 2.5; const ph = 2.05;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(box(0.14, ph, 0.14, K.timber, { x: sx + x * (sw / 2 - 0.1), y: 0.16, z: z * (sd / 2 - 0.1) }));
  parts.push(xform(pitchedRoof(sd, sw, 0.75, ROOFS.pie_oven, { oh: 0.25, gableHex: K.timberL }), { ry: Math.PI / 2, x: sx, y: 0.16 + ph }));
  parts.push(box(sw - 0.2, 0.82, 0.75, WOOD, { x: sx, y: 0.16, z: 0.35 }), box(sw - 0.1, 0.07, 0.85, '#E8DCC2', { x: sx, y: 0.98, z: 0.35 }));
  ['#C81E3C', '#F2852A', '#4D5BD6'].forEach((hex, i) => parts.push(xform(pieGeo(0.26, hex), { x: sx - 0.75 + i * 0.75, y: 1.05, z: 0.38 })));
  parts.push(xform(sack('#FFFDF4'), { x: sx + 1.05, y: 0.16, z: -0.85, s: 0.9 }), xform(sack('#FFFDF4'), { x: sx + 0.6, y: 0.16, z: -1.05, s: 0.8, ry: 1 }),
    xform(basketOf([['#E2363A', -0.12, 0], ['#E2363A', 0.12, 0.05], ['#C9D84A', 0, -0.12]])(), { x: sx - 0.95, y: 0.16, z: 1.4, s: 0.6 }));
  // signature: a giant pie on a sign frame over the shed's gable, facing the front
  const sign = mergeAll([box(0.1, 0.75, 0.1, K.timber, { x: -0.45 }), box(0.1, 0.75, 0.1, K.timber, { x: 0.45 }), box(1.0, 0.1, 0.1, K.timber, { y: 0.7 }),
    xform(pieGeo(0.66, '#C81E3C'), { rx: 0.62, y: 0.82, z: 0.18 })]);
  parts.push(xform(sign, { x: sx, y: 0.16 + ph + 0.4, z: 0.25 }));
  return withAnchors(mergeAll(parts), { chimney: [r3(ox - 0.15), r3(base + 1.97), -0.55], windows: [[ox, r3(base + 0.25), 1.2]], counter: [sx, 1.6, 0.4] });
});
building('chandlery', [3, 3], async () => {
  const g = await srcFit(MVB('Blacksmith'), { w: 6, d: 6, fill: 0.8, ...BLD(ROOFS.chandlery) });
  const b = bounds(g);
  const fz = b.max.z;
  // signature: a giant candle with a flame on a wall bracket, a drying rack of dipped candles, the wax pot
  // a wall bracket holding a big lit candle in a brass dish (it reads as a candle from every side)
  const candleSign = mergeAll([box(0.08, 0.08, 0.95, K.iron, { y: 1.42 }), xform(box(0.06, 0.06, 0.7, K.iron), { rx: 0.75, y: 1.0, z: 0.22 }),
    cyl(0.3, 0.22, 0.08, 14, '#E9B13A', { y: 0.4, z: 0.85 }), cyl(0.2, 0.21, 0.95, 14, '#FFF2C8', { y: 0.47, z: 0.85 }),
    ...[0.62, 0.8, 1.0].map((y, i) => xform(blob(0.045, '#FFF2C8', { seed: i, sy: 1.6, detail: 0 }), { x: Math.cos(i * 2.2) * 0.2, y, z: 0.85 + Math.sin(i * 2.2) * 0.2 })),
    cyl(0.015, 0.015, 0.1, 4, '#3A2A1A', { y: 1.42, z: 0.85 }, 0), xform(blob(0.09, '#FFB52E', { sy: 1.9, seed: 3, detail: 1 }), { y: 1.62, z: 0.85 }),
    xform(blob(0.05, '#FFF3C4', { sy: 1.6, seed: 4, detail: 0 }), { y: 1.58, z: 0.9 })]);
  const rack = [box(0.09, 1.5, 0.09, WOOD_D, { x: -0.75 }), box(0.09, 1.5, 0.09, WOOD_D, { x: 0.75 }), box(1.6, 0.08, 0.08, WOOD_D, { y: 1.42 }), box(1.6, 0.06, 0.06, WOOD_D, { y: 1.1, z: 0.0 })];
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) rack.push(cyl(0.045, 0.05, 0.5, 6, ['#FFF2C8', '#C8B5F0', '#F2C25E', '#FF9FB0'][i % 4], { x: -0.6 + i * 0.2 + s * 0.05, y: 0.88 + (s > 0 ? 0 : 0.02) }, 0));
  const pot = await srcFit(MVP('Cauldron'), { w: 0.9, d: 0.9, sat: 0.2, maxTris: 300 });
  return withAnchors(mergeAll([g, xform(candleSign, { x: 1.15, y: 1.25, z: fz - 0.25 }), xform(mergeAll(rack), { x: -1.75, z: fz + 0.3 }),
    xform(pot, { x: 2.15, z: fz - 0.2 }), xform(mergeAll([box(0.5, 0.45, 0.5, WOOD_D), lathe([[0, 0], [0.32, 0], [0.34, 0.15], [0.28, 0.38], [0.16, 0.52], [0, 0.56]], 12, '#E3C25E').translate(0, 0.45, 0)]), { x: 2.3, z: fz - 1.6 })]),
  { windows: g.anchors?.windows, counter: [-1.9, 1.6, r3(fz + 0.35)] });
});
building('packing', [3, 2], async () => {
  // A lean-to packing shed: a planked back wall with shelves of parcels under a shallow shingled roof, and the long
  // packing counter out in the open in front, so the hampers on it read from the default camera.
  const parts = [box(5.4, 0.16, 3.4, '#B9824A'), box(5.2, 0.02, 3.2, '#C99A5A', { y: 0.16 })];
  for (let i = -6; i <= 6; i++) parts.push(box(0.025, 0.012, 3.2, '#A8713A', { x: i * 0.4, y: 0.175 }));
  const bz = -1.35; const wallH = 2.5;
  parts.push(box(5.0, wallH, 0.14, '#B89468', { y: 0.16, z: bz }));
  for (let i = -6; i <= 6; i++) parts.push(box(0.03, wallH, 0.02, '#94714A', { x: i * 0.38, y: 0.16, z: bz + 0.08 }));
  for (const x of [-2.45, 2.45]) parts.push(box(0.16, wallH + 0.1, 0.16, K.timber, { x, y: 0.16, z: bz }), box(0.14, 1.85, 0.14, K.timber, { x, y: 0.16, z: -0.05 }));
  // the lean-to roof: from the wall top down to the front posts (shallow, so the shelves stay in view)
  const run = 1.6; const drop = wallH - 1.85; const slope = Math.atan2(drop, run);
  const roof = courses(box(5.5, 0.12, Math.hypot(run, drop) + 0.5, ROOFS.packing), 6, [0.88, 1.0, 1.1]);
  roof.translate(0, 0, -(Math.hypot(run, drop) + 0.5) / 2 + 0.25);
  xform(roof, { rx: slope });
  parts.push(xform(roof, { y: 0.16 + 1.85 + 0.02, z: -0.05 }));
  parts.push(box(5.1, 0.14, 0.14, K.timber, { y: 0.16 + 1.8, z: -0.05 }));
  // shelves on the back wall, with wrapped parcels and baskets
  for (const y of [0.9, 1.5]) parts.push(box(4.6, 0.06, 0.42, WOOD_D, { y: 0.16 + y, z: bz + 0.28 }));
  const parcel = (w, h, d) => mergeAll([box(w, h, d, '#C9A06A'), box(w + 0.01, 0.025, d + 0.01, '#8A5A35', { y: h / 2 - 0.012 }), box(0.025, h + 0.01, d + 0.01, '#8A5A35')]);
  [[-1.8, 0.34], [-1.25, 0.28], [-0.7, 0.36], [0.5, 0.3], [1.1, 0.34], [1.7, 0.28]].forEach(([x, s0], i) => {
    parts.push(xform(parcel(s0, s0 * 0.7, s0 * 0.8), { x, y: 0.16 + 1.56, z: bz + 0.28, ry: (i % 2) * 0.2 }));
    parts.push(xform(parcel(s0 * 0.9, s0 * 0.6, s0 * 0.7), { x: x + 0.15, y: 0.16 + 0.96, z: bz + 0.28, ry: (i % 3) * 0.15 }));
  });
  // the packing counter in the open, with two hampers being packed, an open crate with straw, twine and paper
  parts.push(box(3.6, 0.82, 0.85, WOOD, { y: 0.16, z: 0.5 }), box(3.7, 0.07, 0.95, '#E8DCC2', { y: 0.98, z: 0.5 }));
  for (const x of [-1.6, 1.6]) parts.push(box(0.12, 0.82, 0.9, WOOD_D, { x, y: 0.16, z: 0.5 }));
  const hamper = (cols) => mergeAll([basketOf(cols)(), xform(box(0.75, 0.025, 0.6, '#FFF8EC'), { y: 0.43, rz: 0.12, x: -0.05 })]);
  parts.push(xform(hamper([['#F59A23', -0.15, 0], ['#E83A55', 0.15, 0.1], ['#FFFDF4', 0, -0.15]]), { x: -1.05, y: 1.05, z: 0.5, s: 0.66 }),
    xform(hamper([['#9C7FD0', -0.15, 0], ['#FFE58A', 0.15, 0.05], ['#9BD86A', 0, -0.15]]), { x: 0.05, y: 1.05, z: 0.5, s: 0.66 }),
    xform(mergeAll([crate(0.6), xform(blob(0.27, '#E3C25E', { seed: 5, sy: 0.35, sx: 1.1 }), { y: 0.56 })]), { x: 1.05, y: 1.05, z: 0.5 }),
    xform(spool('#C9A06A'), { x: 1.55, y: 1.05, z: 0.75, s: 0.3 }), xform(box(0.5, 0.01, 0.36, '#C9A06A'), { x: -0.5, y: 1.06, z: 0.82, ry: 0.3 }));
  // a hand cart loaded with crates, and a crate stack at the side
  const cart = await srcFit(MVP('Cart'), { w: 1.9, d: 1.1, sat: 0.2, maxTris: 500 });
  parts.push(xform(cart, { x: -1.75, z: 1.35, ry: 0.12 }), xform(crate(0.52), { x: -1.95, y: 0.6, z: 1.35, ry: 0.2 }), xform(crate(0.46), { x: -1.4, y: 0.6, z: 1.4, ry: -0.1 }));
  parts.push(xform(crate(0.6), { x: 2.15, z: 1.2 }), xform(crate(0.6), { x: 2.15, y: 0.6, z: 1.2, ry: 0.25 }), xform(crate(0.52), { x: 1.5, z: 1.4, ry: -0.3 }));
  // the sign over the shelf: a hamper painted on a board
  parts.push(xform(mergeAll([signBoard(1.3, 0.6, '#FFF8EC', K.timber), xform(hamper([['#E83A55', -0.12, 0], ['#F59A23', 0.12, 0]]), { s: 0.4, y: 0.06, z: 0.08 })]), { y: 0.16 + 1.98, z: 0.06, rx: -0.12 }));
  return withAnchors(mergeAll(parts), { counter: [0, 1.7, 0.5] });
});
// wave 3 (M2): built from the cottage kit with their signature props (section 16)
building('oil_press', [3, 3], async () => oilPress());
building('sugar_shack', [3, 3], async () => sugarShack());
building('chocolatier', [3, 3], async () => chocolatier());

for (const bd of BUILD) {
  const key = bd.id.includes(':') ? `building:${bd.id}` : `building:${bd.id}`;
  const def = bd.extra.def || bd.id;
  job(key, `buildings/${def}.glb`, { family: 'building', def, footprint: bd.size }, async () => {
    let g = await bd.build();
    const anchors = g.anchors || null;
    if (tris(g) > BUILDING_TRIS * 1.04) {
      // the smallest absolute error that reaches the cap: details survive (VISUAL-AFTER C1)
      const src = tris(g);
      let best = null;
      for (const maxErr of [0.004, 0.006]) {
        best = await detailSimplify(g, BUILDING_TRIS, { maxErr });
        if (tris(best) <= BUILDING_CAP) break;
      }
      if (process.env.HH_ASSET_VERBOSE) console.error(`${key}: ${src} -> ${tris(best)} tris`);
      g = best;
    }
    if (anchors) {
      const a = Object.fromEntries(Object.entries(anchors).filter(([, v]) => Array.isArray(v) && v.length));
      if (Object.keys(a).length) JOBS.find((j) => j.key === key).meta.anchors = a;
    }
    return sway(g, { rigid: true });
  });
  // the far-band twin (render-world swaps it in at the far LOD band like crop:*:far): ~2k triangles, details gone
  job(`${key}:far`, `buildings/${def}.glb`, { family: 'building', footprint: bd.size, part: true, far: true }, async () => {
    const src = await bd.build();
    let g = src;
    for (const error of [0.05, 0.1, 0.2, 0.4]) {
      if (tris(g) <= BUILDING_FAR * 1.08) break;
      g = await simplify(src, BUILDING_FAR / tris(src), { error, deg: 35, lockBorder: false });
    }
    return sway(g, { rigid: true });
  });
  for (const a of bd.extra.aliases || []) manifest.aliases[a] = key;
}

// Windmill sails: a separate spinning part. pivot = hub in the building's model space; spin about local +z.
async function sails(srcRel, buildingFit) {
  const doc = await readDoc(srcRel);
  const whole = await bakeStatic(srcRel, { sat: MV_SAT });
  const body = await bakeStatic(srcRel, { sat: MV_SAT, skipNodes: /Blades/ });
  const blades = await bakeStatic(srcRel, { sat: MV_SAT, onlyNodes: /Blades/ });
  void whole; void doc;
  // replicate the building's fit transform (same as srcFit with the same options)
  const b = bounds(body);
  const sx = b.max.x - b.min.x; const sz = b.max.z - b.min.z;
  const sc = Math.min((buildingFit.w * buildingFit.fill) / sx, (buildingFit.d * buildingFit.fill) / sz);
  const m = new THREE.Matrix4().makeTranslation(-(b.min.x + b.max.x) / 2 * sc, -b.min.y * sc, -(b.min.z + b.max.z) / 2 * sc).multiply(new THREE.Matrix4().makeScale(sc, sc, sc));
  blades.applyMatrix4(m);
  const hub = bounds(blades).getCenter(new THREE.Vector3());
  blades.translate(-hub.x, -hub.y, -hub.z);
  // broad canvas sails on the lattice arms (VISUAL-AFTER C9: the bare lattice cross did not read as a windmill):
  // the arms are found from the farthest blade vertex, the canvas sits just behind the lattice on the trailing side
  // of each arm, a thin box so it shows from both sides
  const bp = blades.getAttribute('position');
  let R = 0; let a0 = 0;
  for (let i = 0; i < bp.count; i++) { const r = Math.hypot(bp.getX(i), bp.getY(i)); if (r > R) { R = r; a0 = Math.atan2(bp.getY(i), bp.getX(i)); } }
  const canvas = [];
  for (let k = 0; k < 4; k++) {
    const a = a0 + (k * Math.PI) / 2;
    const len = R * 0.62; const wid = R * 0.27;
    const c = box(len, wid, 0.025, k % 2 ? '#F3E6CC' : '#EBDCC0');
    c.translate(0, -wid / 2, 0);
    xform(c, { x: R * 0.6, y: wid * 0.62 });
    xform(c, { rz: a, z: -0.06 });
    canvas.push(c);
  }
  const geo = mergeAll([blades, ...canvas]);
  return { geo: sway(geo, { rigid: true }), pivot: hub.toArray().map(r3) };
}
job('building:mill:sails', 'buildings/mill.glb', { family: 'building', def: 'mill', footprint: [3, 3], part: true, axis: 'z' }, async () => {
  const { geo, pivot } = await sails(MVB('Mill'), { w: 6, d: 6, fill: 0.8 });
  JOBS.find((j) => j.key === 'building:mill:sails').meta.pivot = pivot;
  return geo;
});

// ---------------------------------------------------------------------------------------------------
// 12. Animal homes (GDD §3.4): a fenced yard with the house at the back; animals wander inside `yard`
//     (model-space rect [x0, z0, x1, z1], published in the manifest) and the gate faces +z.
const HOMES = [];
const home = (id, size, build) => HOMES.push({ id, size, build });

// Wave 4b (owner wish 3: homes grow with their flock, content HOME_GROWTH): a home built at growth tier GROW > 0 gets a
// pen GROW tiles (2 x GROW m) wider and deeper. yardGround and penFence build the bigger floor and fence centred on
// (+GROW, +GROW) m and section 18 shifts the whole model by (-GROW, -GROW): the fence ends up centred on the grown
// footprint while the house and every prop keep their place against the back-left corner; the pen opens to the front
// and the right. Only the homes call these two.
let GROW = 0;
function yardGround(w, d, ...rest) {
  return GROW ? xform(yardGroundAt(w + 2 * GROW, d + 2 * GROW, ...rest), { x: GROW, z: GROW }) : yardGroundAt(w, d, ...rest);
}
function yardGroundAt(w, d, hex = '#A8C267', { worn = '#A99162', bedding = '#CCB779', gateZ = 1 } = {}) {
  // the pen floor (VISUAL-AFTER C6): short grass in the pen's hue blended with worn soil and straw bedding where the
  // animals go: about a quarter worn, concentrated at the gate (+z) and in patches; the rim sits almost on the lawn
  const g = new THREE.PlaneGeometry(w, d, 14, 14); g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const edge = Math.max(Math.abs(p.getX(i)) / (w / 2), Math.abs(p.getZ(i)) / (d / 2));
    p.setY(i, edge > 0.97 ? 0.004 : 0.012);
  }
  const x = P(g, hex);
  const c = x.getAttribute('color'); const pp = x.getAttribute('position');
  const grass = lin(hex); const soil = lin(worn); const straw = lin(bedding); const col = new THREE.Color();
  for (let i = 0; i < pp.count; i++) {
    const px = pp.getX(i); const pz = pp.getZ(i);
    const n = noise3(px * 0.55, 0, pz * 0.55, 5) * 0.5 + 0.5;
    const gate = Math.max(0, 1 - Math.hypot(px, pz - gateZ * d / 2) / (Math.min(w, d) * 0.42));
    const wear = Math.min(1, Math.max(0, (n - 0.62) * 3.2) + gate * 0.9);
    col.copy(grass).multiplyScalar(0.94 + noise3(px * 1.7, 1, pz * 1.7, 9) * 0.08).lerp(soil, wear * 0.85);
    const bed = Math.max(0, noise3(px * 0.9 + 7, 2, pz * 0.9, 13) - 0.35) * 1.6;
    col.lerp(straw, Math.min(0.5, bed) * (1 - wear * 0.5));
    c.setXYZ(i, col.r, col.g, col.b);
  }
  return x;
}

home('coop', [3, 3], async () => {
  // the source's two side ramps stuck out of blank walls and read as broken, half-open doors (visual-27): only
  // the front ramp to the door stays
  const coop = dropComponents(await srcFit(FB('ChickenCoop'), { w: 3.4, d: 3.0, fill: 1, sat: 0.2 }),
    (b, n) => n > 40 && b.max.y < 0.9 && (b.min.x > 0.8 || b.max.x < -0.8));
  return { geo: mergeAll([yardGround(5.6, 5.6, '#C9B57A'), penFence(5.8, 5.8, { pickets: true, h: 0.7 }), xform(coop, { x: -1.0, z: -1.1 }),
    xform(trough(1.2, '#E9D36A'), { x: 1.5, z: 1.6 })]), yard: [-2.6, 0.6, 2.6, 2.6], avoid: [[1.5, 1.6, 0.85], [-1.0, 0.55, 0.65]] };
});
home('cow_barn', [4, 3], async () => {
  const shed = await srcFit(FB('OpenBarn'), { w: 4.4, d: 3.0, fill: 1, sat: 0.2 });
  return { geo: mergeAll([yardGround(7.6, 5.6), penFence(7.8, 5.8), xform(shed, { x: -1.5, z: -1.2 }), xform(trough(1.6), { x: 2.5, z: 1.9 }),
    xform(hayBale(), { x: 2.8, z: -1.9 })]), yard: [-3.5, 0.5, 3.5, 2.6], avoid: [[2.5, 1.9, 1.05]] };
});
/** An open field shelter (visual-27): four posts, a back and side walls, a gable roof with a 0.25 m overhang and
 *  straw on the floor, open to the front. */
function fieldShelter(wall = WOOD, roof = '#7A4B3A', w = 2.4, d = 1.6, h = 1.6) {
  const parts = [];
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) parts.push(box(0.14, h, 0.14, WOOD_D, { x: x * 0.97, z: z * 0.97 }));
  parts.push(box(w, h * 0.92, 0.08, wall, { z: -d / 2 + 0.04 }), box(0.08, h * 0.92, d, wall, { x: -w / 2 + 0.04 }), box(0.08, h * 0.92, d, wall, { x: w / 2 - 0.04 }));
  parts.push(xform(gable(d + 0.5, w + 0.5, 0.85, roof), { ry: Math.PI / 2, y: h }));
  parts.push(box(w + 0.5, 0.08, 0.1, '#5A3A22', { y: h - 0.04, z: d / 2 + 0.2 }));
  parts.push(xform(blob(0.8, '#E3C25E', { seed: 12, sy: 0.12, sx: 1.3, flatBottom: 0.2, detail: 1 }), { y: 0.04, z: 0.1 }));
  return mergeAll(parts);
}
home('pasture', [4, 4], async () => {
  const shelter = fieldShelter(WOOD, '#7A4B3A');
  return { geo: mergeAll([yardGround(7.6, 7.6, '#8CC456'), penFence(7.8, 7.8), xform(shelter, { x: -2.3, z: -2.6 }), xform(hayBale(), { x: 2.6, z: -2.6 }),
    xform(trough(1.4), { x: 2.6, z: 2.6, ry: Math.PI / 2 })]), yard: [-3.5, -1.4, 3.5, 3.5], avoid: [[2.6, 2.6, 0.95]] };
});
home('beehive', [1, 1], async () => {
  // a Langstroth hive on a stand (GDD §3.4: "a procedural Langstroth hive"): two supers in cream and butter, a
  // gabled zinc lid, an entrance with a landing board, and a ring of flowers at its feet
  const r = rng('hive');
  const parts = [box(0.1, 0.32, 0.1, WOOD_D, { x: -0.3, z: -0.25 }), box(0.1, 0.32, 0.1, WOOD_D, { x: 0.3, z: -0.25 }), box(0.1, 0.32, 0.1, WOOD_D, { x: -0.3, z: 0.25 }),
    box(0.1, 0.32, 0.1, WOOD_D, { x: 0.3, z: 0.25 }), box(0.78, 0.06, 0.68, WOOD, { y: 0.32 }),
    box(0.66, 0.34, 0.56, '#FFF8EC', { y: 0.38 }), box(0.68, 0.03, 0.58, '#E9D8A6', { y: 0.72 }), box(0.66, 0.3, 0.56, '#FFE7A0', { y: 0.75 }),
    box(0.68, 0.03, 0.58, '#E9D8A6', { y: 1.05 }), xform(gable(0.66, 0.8, 0.22, '#9AA6B0'), { y: 1.08 }), box(0.04, 0.03, 0.84, '#C9CED3', { y: 1.29 }),
    box(0.34, 0.05, 0.03, '#3A2A1A', { y: 0.42, z: 0.285 }), xform(box(0.42, 0.03, 0.16, WOOD), { y: 0.38, z: 0.34, rx: 0.25 })];
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + 0.3; parts.push(xform(flowerClump(r, ['#A98BE0', '#FFFFFF', '#FFD21F', '#FF9FB0'], 3, 0.32), { x: Math.cos(a) * 0.72, z: Math.sin(a) * 0.72, s: 0.65 })); }
  return { geo: mergeAll(parts), yard: [-0.4, -0.4, 0.4, 0.4], hive: [0, 0.45, 0.3] };
});
home('pig_pen', [4, 3], async () => {
  const hut = await srcFit(FB('SmallBarn'), { w: 3.0, d: 2.6, fill: 1, sat: 0.2 });
  const mud = xform(blob(1.2, '#6E4A2E', { seed: 3, sy: 0.04, amp: 0.15 }), { x: 1.6, y: 0.02, z: 0.9 });
  const mudRim = xform(blob(1.4, '#8E6A40', { seed: 3, sy: 0.03, amp: 0.15 }), { x: 1.6, y: 0.012, z: 0.9 });
  return { geo: mergeAll([yardGround(7.6, 5.6, '#A9A36A', { worn: '#9A7A50' }), penFence(7.8, 5.8), xform(hut, { x: -2.0, z: -1.3 }), mudRim, mud, xform(trough(1.4, '#9BBF5A'), { x: 2.3, z: -1.9 }),
    xform(hayBale(), { x: -3.0, z: 1.6, s: 0.8 })]), yard: [-3.5, 0.0, 3.5, 2.6], mud: [1.6, 0.9, 1.05], avoid: [[-3.0, 1.6, 0.7]] };
});
home('duck_pond', [4, 4], async () => {
  const water = xform(blob(2.2, '#4FB7DD', { seed: 8, sy: 0.02, amp: 0.12, detail: 2 }), { y: 0.03, z: 0.4 });
  const rim = xform(blob(2.45, '#C9B57A', { seed: 8, sy: 0.02, amp: 0.12, detail: 2 }), { y: 0.015, z: 0.4 });
  const reeds = [];
  for (let i = 0; i < 9; i++) reeds.push(xform(cyl(0.02, 0.03, 0.9 + (i % 3) * 0.2, 4, '#5C8A3A', {}, 0), { x: -2.4 + (i % 3) * 0.2, z: -1.6 + Math.floor(i / 3) * 0.25, rz: (i % 2 - 0.5) * 0.3 }));
  // a little A-frame duck house on stilts at the water's edge, with a ramp down into the pond
  const house = mergeAll([...[[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]].map(([x, z]) => box(0.08, 0.35, 0.08, WOOD_D, { x, z })), box(1.2, 0.06, 1.0, WOOD, { y: 0.35 }),
    box(1.1, 0.55, 0.9, '#E8D5B0', { y: 0.41 }), xform(gable(1.0, 1.4, 0.55, '#4F8A99'), { ry: Math.PI / 2, y: 0.96 }), box(0.32, 0.36, 0.04, '#3A2A1A', { y: 0.45, z: 0.46 }),
    xform(box(0.36, 0.04, 1.0, WOOD), { y: 0.18, z: 0.92, rx: 0.36 }), ...[0, 1, 2, 3].map((i) => box(0.36, 0.03, 0.03, WOOD_D, { y: 0.06 + i * 0.09, z: 1.3 - i * 0.24 }))]);
  const pads = []; const lr = rng('pads');
  for (let i = 0; i < 5; i++) { const a = lr() * 6.28; const d = 0.6 + lr() * 1.1; pads.push(xform(P(new THREE.CircleGeometry(0.2 + lr() * 0.08, 7, 0.4, Math.PI * 1.8), '#5DAA45'), { rx: -Math.PI / 2, ry: lr() * 6, x: Math.cos(a) * d, y: 0.1, z: 0.4 + Math.sin(a) * d })); }
  const stones = []; const sr = rng('stones');
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + sr() * 0.3; stones.push(xform(blob(0.14 + sr() * 0.08, '#B5AEA2', { seed: i, detail: 0, sy: 0.6 }), { x: Math.cos(a) * 2.45, y: 0.04, z: 0.4 + Math.sin(a) * 2.35 })); }
  return { geo: mergeAll([yardGround(7.6, 7.6, '#8CC456'), rim, water, penFence(7.8, 7.8, { pickets: true, h: 0.7 }), ...reeds, ...pads, ...stones,
    xform(house, { x: 2.3, z: -2.4, ry: -0.6 })]), yard: [-3.4, -3.4, 3.4, 3.4], water: [0, 0.4, 1.95] };
});
home('goat_yard', [4, 4], async () => {
  // goats climb (wave 2): a boulder they stand on, a wooden play platform with a ramp, a small lean-to shelter
  const rocks = await srcFit(UN('Rock_3'), { w: 2.2, d: 2.2, h: 1.0, sat: 0.1, recolor: { Rock: '#B9A98A' } });
  const rockTop = bounds(rocks).max.y;
  const platform = mergeAll([...[[-0.6, -0.5], [0.6, -0.5], [-0.6, 0.5], [0.6, 0.5]].map(([x, z]) => box(0.12, 0.7, 0.12, WOOD_D, { x, z })), box(1.5, 0.1, 1.2, WOOD, { y: 0.7 }),
    ...[-0.4, 0, 0.4].map((z) => box(1.52, 0.02, 0.05, WOOD_D, { y: 0.8, z })), xform(box(0.5, 0.06, 1.3, WOOD), { x: 1.1, y: 0.32, rz: 0.55 }),
    box(0.9, 0.5, 0.9, WOOD, { x: -0.25, y: 0.8, z: -0.1 }), box(0.92, 0.04, 0.92, WOOD_D, { x: -0.25, y: 1.3, z: -0.1 })]);
  const lean = mergeAll([box(0.12, 1.4, 0.12, WOOD_D, { x: -0.9, z: 0.5 }), box(0.12, 1.4, 0.12, WOOD_D, { x: 0.9, z: 0.5 }), box(2.0, 1.6, 0.1, '#C99A5A', { z: -0.5 }),
    xform(box(2.3, 0.08, 1.4, '#7A4B3A'), { y: 1.55, rx: 0.18 }), xform(blob(0.7, '#E3C25E', { seed: 14, sy: 0.12, sx: 1.2, detail: 1 }), { y: 0.04 })]);
  return { geo: mergeAll([yardGround(7.6, 7.6, '#A3BF62'), penFence(7.8, 7.8), xform(rocks, { x: -2.3, z: -2.2 }), xform(platform, { x: 1.9, z: 0.4 }),
    xform(lean, { x: 1.6, z: -2.6 }), xform(trough(1.2), { x: -2.6, z: 2.6, ry: Math.PI / 2 })]), yard: [-3.5, -1.2, 3.5, 3.5], avoid: [[-2.6, 2.6, 0.85], [1.9, 0.4, 1.0], [-2.3, -2.2, 0.9]],
  perches: [[-2.3, -2.2, 0.75, r3(rockTop - 0.05)], [1.65, 0.3, 0.42, 1.34], [1.9, 0.4, 0.6, 0.8]] };
});
home('stable', [4, 3], async () => {
  const st = await srcFit(MVB('Stable'), { w: 7.4, d: 3.2, fill: 1, sat: MV_SAT });
  return { geo: mergeAll([yardGround(7.6, 5.6), penFence(7.8, 5.8), xform(st, { z: -1.3 }), xform(trough(1.6), { x: 2.6, z: 2.0 })]), yard: [-3.5, 0.6, 3.5, 2.6], avoid: [[2.6, 2.0, 1.05]] };
});
// The Alpaca Paddock (wave 3, M2): a rustic shelter with a hay rack, a round dust-bath patch of soft sand the alpacas roll
// in (animals-view: the `dust` anchor), a little grassy knoll they like to stand on (a `perch`), a hay feeder and water
home('paddock', [4, 4], async () => {
  const shelter = mergeAll([fieldShelter('#E8D3A8', '#B5543F', 2.8, 1.7, 1.75),
    xform(mergeAll([box(1.6, 0.08, 0.12, WOOD_D, { y: 0.95 }), box(1.6, 0.08, 0.12, WOOD_D, { y: 0.35 }), ...[-0.6, -0.2, 0.2, 0.6].map((x) => xform(box(0.05, 0.7, 0.05, WOOD), { x, y: 0.32, rx: 0.3 })),
      xform(blob(0.45, '#E3C25E', { seed: 15, sx: 1.6, sy: 0.6, detail: 1 }), { y: 0.95, z: -0.12 })]), { z: -0.5 })]);
  const dust = mergeAll([xform(blob(1.15, '#D9C49A', { seed: 19, sy: 0.03, amp: 0.12, detail: 2 }), { y: 0.02 }), xform(blob(1.0, '#E6D4AC', { seed: 20, sy: 0.03, amp: 0.1, detail: 2 }), { y: 0.03 }),
    ...[0, 1, 2, 3].map((i) => xform(blob(0.07, '#B9A98A', { seed: i, sy: 0.4, detail: 0 }), { x: Math.cos(i * 1.6) * 0.95, y: 0.04, z: Math.sin(i * 1.6) * 0.95 }))]);
  const knoll = mergeAll([xform(mottle(blob(0.95, '#86B850', { seed: 22, sy: 0.32, amp: 0.1, detail: 2, flatBottom: 0.1 }), { seed: 6, lo: 0.9, hi: 1.08 }), { y: 0.0 }),
    ...[0, 1, 2].map((i) => xform(flatFlower(['#FFFFFF', '#FFD21F', '#FF9FB0'][i], 0.07), { x: Math.cos(i * 2.2) * 0.5, y: 0.27, z: Math.sin(i * 2.2) * 0.5 }))]);
  const feeder = mergeAll([box(0.1, 0.9, 0.1, WOOD_D, { x: -0.55 }), box(0.1, 0.9, 0.1, WOOD_D, { x: 0.55 }), xform(box(1.2, 0.5, 0.06, WOOD), { y: 0.55, z: 0.18, rx: -0.4 }), xform(box(1.2, 0.5, 0.06, WOOD), { y: 0.55, z: -0.18, rx: 0.4 }),
    xform(blob(0.4, '#E3C25E', { seed: 16, sx: 1.5, sy: 0.55, detail: 1 }), { y: 0.82 })]);
  return { geo: mergeAll([yardGround(7.6, 7.6, '#8CC456'), penFence(7.8, 7.8), xform(shelter, { x: -2.1, z: -2.55 }), xform(dust, { x: 1.85, z: -1.65 }),
    xform(knoll, { x: -2.35, z: 1.45 }), xform(feeder, { x: 0.55, z: -2.95 }), xform(trough(1.4), { x: 2.75, z: 2.5, ry: Math.PI / 2 })]),
  yard: [-3.5, -1.6, 3.5, 3.5], dust: [1.85, -1.65, 0.95], perches: [[-2.35, 1.45, 0.7, 0.28]], avoid: [[2.75, 2.5, 0.85], [0.55, -2.95, 0.8]] };
});
for (const h of HOMES) {
  job(`home:${h.id}`, `homes/${h.id}.glb`, { family: 'home', def: h.id, footprint: h.size }, async () => {
    const { geo, yard, water, mud, perches, hive, avoid, dust } = await h.build();
    const meta = JOBS.find((j) => j.key === `home:${h.id}`).meta;
    meta.yard = yard;
    // behaviour anchors for animals-view (model metres): the duck pond's water disc [x, z, r], the pig pen's mud
    // [x, z, r], the goat yard's perches [[x, z, r, top y]], the hive mouth [x, y, z]
    if (water) meta.water = water;
    if (mud) meta.mud = mud;
    if (perches) meta.perches = perches;
    if (hive) meta.hive = hive;
    if (avoid) meta.avoid = avoid;              // troughs and ramps the animals keep clear of: [[x, z, r]]
    if (dust) meta.dust = dust;                 // wave 3: the alpacas' dust-bath patch [x, z, r]
    return sway(geo, { rigid: true });
  });
  // RD-13 (QA wave 2): a ~1.8k far-band twin for the heavy homes (the stable is 8k): the far LOD band and the static
  // shadow map (render/index.js renderShadows) draw it instead
  job(`home:${h.id}:far`, `homes/${h.id}.glb`, { family: 'home', footprint: h.size, part: true, far: true }, async () => {
    const { geo } = await h.build();
    let g = geo;
    for (const error of [0.05, 0.1, 0.2, 0.4]) {
      if (tris(g) <= 1800 * 1.08) break;
      g = await simplify(geo, 1800 / tris(geo), { error, deg: 35, lockBorder: false });
    }
    return sway(g, { rigid: true });
  });
}

// ---------------------------------------------------------------------------------------------------
// 13. Decor (GDD §3.8), debris (§2.3) and world props. Footprints in tiles; fences are modular:
//     decor:picket_fence (a straight tile along x), :post and :rail (centre -> +x edge) for auto-joining.
const DECOR = [];
/** The far-band twin budget of a heavy decor piece (wave 3, the Grand decor). */
const DECOR_FAR = 1600;
const decor = (id, size, build, extra = {}) => DECOR.push({ id, size, build, extra });

function flowerHead(hex, r = 0.07) {
  const parts = [ball(r * 0.45, '#FFD84A', { y: 0.01 }, 0)];
  for (let i = 0; i < 5; i++) parts.push(ball(r * 0.5, hex, { x: Math.cos(i * 1.257) * r * 0.6, z: Math.sin(i * 1.257) * r * 0.6, sy: 0.5 }, 0));
  return mergeAll(parts);
}
/** A flat five-petal flower facing up with its yellow eye: 10 triangles (a ball flower is 120). */
function flatFlower(hex, r = 0.07) {
  const petals = xform(P(new THREE.CircleGeometry(r, 5), hex), { rx: -Math.PI / 2 });
  const eye = xform(P(new THREE.CircleGeometry(r * 0.42, 5), '#FFD84A'), { rx: -Math.PI / 2, y: 0.006 });
  return mergeAll([petals, eye]);
}
function flowerClump(r, colors, n = 5, h = 0.35) {
  const parts = [xform(blob(0.22, '#4C9A3E', { seed: Math.floor(r() * 99), sy: 0.6, flatBottom: 0.5, detail: 1 }), { y: 0.08 })];
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28; const d = r() * 0.2; const hh = h * (0.7 + r() * 0.5);
    parts.push(xform(stalk(0.012, 0.01, hh, '#4E8F3A'), { x: Math.cos(a) * d, z: Math.sin(a) * d }));
    parts.push(xform(flatFlower(colors[i % colors.length], 0.075), { x: Math.cos(a) * d, y: hh, z: Math.sin(a) * d }));
  }
  return mergeAll(parts);
}
function scarecrow(gold = false) {
  const shirt = gold ? '#E9B13A' : '#C8473A'; const hat = gold ? '#FFD84A' : '#C9A26A'; const post = gold ? '#C99A3A' : TRUNK;
  return mergeAll([cyl(0.05, 0.06, 2.0, 6, post), box(1.3, 0.08, 0.08, post, { y: 1.45 }),
    xform(blob(0.28, shirt, { seed: 2, sy: 1.3, amp: 0.08 }), { y: 1.35 }), xform(blob(0.2, '#E3C25E', { seed: 3, amp: 0.1 }), { y: 1.85 }),
    ...[-1, 1].map((sd) => xform(blob(0.12, '#E3C25E', { seed: 4, sx: 1.6 }), { x: sd * 0.62, y: 1.45 })),
    cyl(0.34, 0.34, 0.04, 12, hat, { y: 1.98 }), cyl(0.15, 0.18, 0.22, 10, hat, { y: 2.0 }), cyl(0.18, 0.18, 0.04, 10, gold ? '#FF7A6B' : '#7A4B3A', { y: 2.04 }),
    ball(0.03, '#3A2A1A', { x: -0.07, y: 1.9, z: 0.18 }, 0), ball(0.03, '#3A2A1A', { x: 0.07, y: 1.9, z: 0.18 }, 0)]);
}

decor('flower_bed', [1, 1], () => {
  const r = rng('flower_bed');
  const parts = [box(1.7, 0.22, 1.7, WOOD_D), box(1.56, 0.06, 1.56, '#5A3420', { y: 0.2 })];
  // <= 600 triangles (performance-03; was 4,552)
  for (let i = 0; i < 4; i++) parts.push(xform(flowerClump(r, ['#FF7A9C', '#FFD21F', '#FFFFFF', '#A98BE0'], 4), { x: (i % 2 - 0.5) * 0.75, y: 0.2, z: (Math.floor(i / 2) - 0.5) * 0.75 }));
  return mergeAll(parts);
});
decor('picket_fence', [1, 1], () => railFence([[-1, 0], [1, 0]], { pickets: true, h: 0.8 }), { aliases: ['fence'] });
job('decor:picket_fence:post', 'decor/picket_fence.glb', { family: 'decor', def: 'picket_fence', footprint: [1, 1], part: true }, async () =>
  sway(mergeAll([box(0.14, 0.92, 0.14, WOOD_D), xform(P(new THREE.ConeGeometry(0.11, 0.1, 4), WOOD_D), { y: 0.97, ry: Math.PI / 4 })]), { rigid: true }));
job('decor:picket_fence:rail', 'decor/picket_fence.glb', { family: 'decor', def: 'picket_fence', footprint: [1, 1], part: true }, async () => {
  const parts = [box(1.0, 0.09, 0.05, WOOD, { x: 0.5, y: 0.2 }), box(1.0, 0.09, 0.05, WOOD, { x: 0.5, y: 0.62 })];
  for (const x of [0.25, 0.5, 0.75]) parts.push(box(0.09, 0.78, 0.04, WOOD, { x }), xform(P(new THREE.ConeGeometry(0.065, 0.08, 4), WOOD), { x, y: 0.82, ry: Math.PI / 4 }));
  return sway(mergeAll(parts), { rigid: true });
});
decor('dirt_path', [1, 1], () => {
  const r = rng('path');
  const g = new THREE.PlaneGeometry(2, 2, 6, 6); g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, 0.015 + noise3(p.getX(i) * 2, 0, p.getZ(i) * 2, 3) * 0.006);
  const parts = [P(g, '#D8B98A')];
  for (let i = 0; i < 7; i++) parts.push(xform(blob(0.07 + r() * 0.05, '#B9A98A', { seed: i, sy: 0.4 }), { x: (r() - 0.5) * 1.7, y: 0.02, z: (r() - 0.5) * 1.7 }));
  return mergeAll(parts);
}, { layer: 'ground' });
decor('scarecrow', [1, 1], () => scarecrow(false));
decor('golden_scarecrow', [1, 1], () => scarecrow(true));
// The source bench has its backrest on +z; the farm's fronts face +z (doors, the sitters of avatars-view seatOf),
// so it turns round: the farmers sit facing out, the backrest behind them.
decor('sunset_bench', [2, 1], async () => {
  const b = xform(await srcFit(MVP('Bench_1'), { w: 3.4, d: 1.2, fill: 1, sat: 0.2, recolor: { Wood: '#C98A4A' } }), { ry: Math.PI });
  return mergeAll([b, ...[-1.9, 1.9].map((x) => xform(flowerClump(rng(`b${x}`), ['#FF9F43', '#FFD21F']), { x, z: 0.1 }))]);
}, { aliases: ['bench'] });
decor('hay_bales', [1, 1], () => mergeAll([xform(hayBale(), { x: -0.45, ry: 0.2 }), xform(hayBale(), { x: 0.45, ry: -0.15 }), xform(hayBale(), { y: 0.82, ry: 0.05 })]));
decor('wind_chime', [1, 1], () => {
  const parts = [cyl(0.05, 0.06, 1.9, 6, WOOD_D), box(0.8, 0.07, 0.07, WOOD_D, { y: 1.8, x: 0.3 }), cyl(0.18, 0.18, 0.04, 10, '#C8473A', { x: 0.55, y: 1.62 })];
  for (let i = 0; i < 5; i++) parts.push(cyl(0.02, 0.02, 0.3 + (i % 3) * 0.08, 6, '#C9CED3', { x: 0.55 + Math.cos(i * 1.26) * 0.12, y: 1.25 - (i % 3) * 0.08, z: Math.sin(i * 1.26) * 0.12 }, 0));
  return mergeAll(parts);
});
decor('wheelbarrow', [1, 1], () => {
  const r = rng('wb');
  const tub = mergeAll([xform(P(new THREE.CylinderGeometry(0.55, 0.38, 0.4, 4, 1), '#4AA8E8', { creaseDeg: 0 }), { ry: Math.PI / 4, sx: 1.4, y: 0.6 })]);
  const flowers = [0, 1, 2].map((i) => xform(flowerClump(r, ['#FF7A9C', '#FFD21F', '#FFFFFF']), { x: -0.35 + i * 0.35, y: 0.66 }));
  // a real wheel: upright, rolling along the barrow, on an axle held by a two-prong fork (visual-27)
  const wheel = mergeAll([xform(cyl(0.22, 0.22, 0.07, 16, '#3A2A1A', {}, 40), { rx: Math.PI / 2, x: 0.85, y: 0.22 }),
    xform(cyl(0.07, 0.07, 0.09, 10, '#C9CED3', {}, 40), { rx: Math.PI / 2, x: 0.85, y: 0.22 })]);
  const axle = xform(cyl(0.022, 0.022, 0.3, 6, '#5E5A55', {}, 0), { rx: Math.PI / 2, x: 0.85, y: 0.22 });
  const fork = [-0.13, 0.13].map((z) => xform(box(0.55, 0.05, 0.04, WOOD_D), { x: 0.62, y: 0.33, z, rz: 0.55 }));
  return mergeAll([tub, wheel, axle, ...fork, box(1.3, 0.06, 0.06, WOOD_D, { x: -0.3, y: 0.42, z: 0.32 }), box(1.3, 0.06, 0.06, WOOD_D, { x: -0.3, y: 0.42, z: -0.32 }),
    box(0.06, 0.4, 0.06, WOOD_D, { x: -0.5, z: 0.3 }), box(0.06, 0.4, 0.06, WOOD_D, { x: -0.5, z: -0.3 }), ...flowers]);
});
// wave 4 (wish 10): the water's surface is an anchor: the view ripples it and lands birds on the rim (section 17)
decor('bird_bath', [1, 1], () => birdBathW4());
decor('lantern', [1, 1], () => mergeAll([cyl(0.05, 0.07, 1.7, 6, '#3A3A3A'), box(0.34, 0.06, 0.34, '#3A3A3A', { y: 1.66 }), box(0.26, 0.32, 0.26, '#FFE08A', { y: 1.72 }),
  xform(P(new THREE.ConeGeometry(0.26, 0.2, 4), '#3A3A3A'), { y: 2.14, ry: Math.PI / 4 })]), { glow: true });
decor('sprinkler', [1, 1], () => mergeAll([cyl(0.18, 0.22, 0.12, 10, '#7FB547'), cyl(0.04, 0.04, 0.4, 6, '#C9CED3', { y: 0.12 }), box(0.5, 0.05, 0.05, '#C9CED3', { y: 0.5 }),
  ball(0.05, '#4AA8E8', { x: 0.25, y: 0.5 }, 0), ball(0.05, '#4AA8E8', { x: -0.25, y: 0.5 }, 0)]));
// wave 4 (wish D): a proper kennel; the cat's wicker bed (section 17)
decor('dog_house', [2, 2], () => dogHouseW4());
decor('cat_basket', [1, 1], () => catBasketW4());
decor('rose_arch', [2, 1], () => {
  const r = rng('rose');
  const parts = [box(0.14, 2.4, 0.14, '#FFF8EC', { x: -1.3 }), box(0.14, 2.4, 0.14, '#FFF8EC', { x: 1.3 }), xform(torus(1.3, 0.07, '#FFF8EC', {}, 6, 18), { y: 2.4 })];
  const arc = parts[2].getAttribute('position');
  for (let i = 0; i < arc.count; i++) if (arc.getY(i) < 2.4) arc.setY(i, 2.4);
  for (let i = 0; i < 26; i++) {
    const t = r() * Math.PI; const side = r() < 0.4;
    const x = side ? (r() < 0.5 ? -1.3 : 1.3) : Math.cos(t) * 1.3; const y = side ? 0.4 + r() * 2.0 : 2.4 + Math.sin(t) * 1.3;
    parts.push(xform(blob(0.16, '#4C9A3E', { seed: i, detail: 1 }), { x, y, z: (r() - 0.5) * 0.2 }));
    if (i % 2 === 0) parts.push(ball(0.08, i % 4 ? '#E83A55' : '#FF9FB0', { x: x + 0.05, y: y + 0.05, z: 0.15 }, 1));
  }
  return mergeAll(parts);
});
decor('heart_arbor', [2, 1], () => {
  const heart = new THREE.Shape();
  heart.moveTo(0, -0.5); heart.bezierCurveTo(0.9, 0.2, 0.5, 0.9, 0, 0.45); heart.bezierCurveTo(-0.5, 0.9, -0.9, 0.2, 0, -0.5);
  const hg = P(new THREE.ExtrudeGeometry(heart, { depth: 0.12, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 10 }), '#FF7A9C', { creaseDeg: 50 });
  return mergeAll([box(0.14, 2.3, 0.14, '#FFF8EC', { x: -1.3 }), box(0.14, 2.3, 0.14, '#FFF8EC', { x: 1.3 }), box(2.8, 0.14, 0.3, '#FFF8EC', { y: 2.3 }),
    xform(hg, { y: 2.95, z: -0.06 }), xform(box(2.0, 0.08, 0.6, WOOD), { y: 0.5 }), box(2.0, 0.6, 0.08, WOOD, { y: 0.55, z: -0.28 })]);
});
decor('cherry_blossom', [2, 2], () => {
  const save = TREES.cherry_tree;
  TREES.__blossom = { ...save, leaf: '#F4B6CF', fruitN: 0, fruitR: 0, blobs: 7 };
  const g = fruitTree('__blossom', 'mature');
  delete TREES.__blossom;
  return g;
}, { sway: 0.35 });
decor('stone_well', [2, 2], async () => mergeAll([await srcFit(MVP('Well'), { w: 4, d: 4, fill: 0.7, sat: 0.2 }), ...[0, 1, 2].map((i) => xform(flowerClump(rng(`sw${i}`), ['#FF7A9C', '#FFFFFF']), { x: -1.4 + i * 0.3, z: 1.3 }))]));
decor('windmill_toy', [1, 1], async () => {
  const w = await srcFit(KT('windmill'), { h: 1.8, sat: 0.25 });
  return w;
});
decor('beehive_skep', [1, 1], () => mergeAll([box(0.9, 0.5, 0.9, WOOD_D), lathe([[0, 0], [0.42, 0], [0.45, 0.2], [0.38, 0.5], [0.22, 0.7], [0, 0.78]], 14, '#E3C25E')].map((g, i) => (i ? xform(g, { y: 0.5 }) : g))));
decor('bench_swing', [2, 1], async () => mergeAll([box(0.14, 2.4, 0.14, WOOD_D, { x: -1.6 }), box(0.14, 2.4, 0.14, WOOD_D, { x: 1.6 }), box(3.4, 0.14, 0.14, WOOD_D, { y: 2.4 }),
  xform(await srcFit(MVP('Bench_1'), { w: 2.4, d: 0.9, fill: 1, sat: 0.2 }), { y: 0.45, ry: Math.PI })]));
// RD-17 (QA wave 2: the Masterwork fountain did not look premium): a 28-sided limestone basin with a moulded rim, water,
// a sculpted centre (a fluted column, a bowl and a bronze finial) and three restrained jets arcing into the pool
function fountainGeo() {
  const LIME = '#D8C9AA'; const LIME_D = '#BFAF8E'; const WATER = '#71BAC3'; const BRONZE = '#A77A42'; const JET = '#CFEFF2';
  const parts = [];
  parts.push(lathe([[0, 0], [1.72, 0], [1.78, 0.08], [1.78, 0.42], [1.86, 0.5], [1.86, 0.6], [1.62, 0.62], [1.56, 0.25], [0, 0.25]], 28, LIME, 35));
  parts.push(xform(P(new THREE.CircleGeometry(1.58, 28), WATER), { rx: -Math.PI / 2, y: 0.46 }));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; parts.push(box(0.16, 0.36, 0.1, LIME_D, { x: Math.cos(a) * 1.8, y: 0.06, z: Math.sin(a) * 1.8, ry: -a + Math.PI / 2 })); }
  // the sculpted centre: a fluted column, a scalloped bowl, a little upper bowl and a bronze finial (~0.8 m)
  parts.push(lathe([[0, 0], [0.32, 0], [0.32, 0.08], [0.2, 0.14], [0.16, 0.5], [0.24, 0.6], [0, 0.62]], 10, LIME, 40));
  parts.push(xform(lathe([[0, 0], [0.12, 0], [0.5, 0.12], [0.62, 0.22], [0.58, 0.26], [0, 0.18]], 16, LIME, 40), { y: 0.6 }));
  parts.push(xform(P(new THREE.CircleGeometry(0.54, 16), WATER), { rx: -Math.PI / 2, y: 0.82 }));
  parts.push(xform(lathe([[0, 0], [0.08, 0], [0.07, 0.25], [0.2, 0.32], [0.22, 0.38], [0, 0.34]], 10, LIME, 40), { y: 0.84 }));
  parts.push(xform(mergeAll([cyl(0.05, 0.06, 0.16, 8, BRONZE), ball(0.09, BRONZE, { y: 0.22 }, 1), xform(P(new THREE.ConeGeometry(0.05, 0.16, 6), BRONZE), { y: 0.3 })]), { y: 1.18 }));
  // three jets from the upper bowl, arcing out and down into the basin (a chain of small droplets)
  for (let j = 0; j < 3; j++) {
    const a = (j / 3) * Math.PI * 2 + 0.3;
    for (let k = 1; k <= 9; k++) {
      const t = k / 9; const d = 0.2 + t * 1.0; const y = 1.2 + 0.45 * t - 1.25 * t * t;
      parts.push(ball(0.05 - t * 0.015, JET, { x: Math.cos(a) * d, y, z: Math.sin(a) * d }, 0));
    }
    parts.push(xform(torus(0.16, 0.025, JET, {}, 3, 10), { x: Math.cos(a) * 1.2, y: 0.5, z: Math.sin(a) * 1.2, rx: Math.PI / 2 }));
  }
  // bronze rim studs
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; parts.push(cyl(0.07, 0.09, 0.08, 8, BRONZE, { x: Math.cos(a) * 1.74, y: 0.6, z: Math.sin(a) * 1.74 })); }
  return mergeAll(parts);
}
decor('fountain', [2, 2], async () => fountainGeo());
decor('topiary', [1, 1], () => mergeAll([box(0.6, 0.45, 0.6, '#C8643A'), cyl(0.05, 0.06, 0.5, 6, TRUNK, { y: 0.45 }), xform(blob(0.45, '#3F8F36', { seed: 3, amp: 0.05 }), { y: 1.25 }), xform(blob(0.3, '#4C9A3E', { seed: 4, amp: 0.05 }), { y: 1.85 })]));
decor('greenhouse_frame', [2, 1], () => mergeAll([box(3.4, 0.4, 1.6, WOOD), xform(box(3.3, 0.04, 1.7, '#BFE3EA'), { y: 0.62, rx: 0.25 })]));
decor('gazebo', [3, 3], () => gazebo());
decor('pond_dock', [2, 2], () => pondDock());
decor('statue_cow', [2, 2], () => cowStatue(false));
decor('hot_air_balloon', [3, 3], () => hotAirBalloon());
decor('star_lanterns', [3, 1], () => {
  const parts = [cyl(0.05, 0.06, 2.3, 6, WOOD_D, { x: -2.7 }), cyl(0.05, 0.06, 2.3, 6, WOOD_D, { x: 2.7 }), xform(cyl(0.012, 0.012, 5.4, 4, '#5A4A3A', {}, 0), { rz: Math.PI / 2, y: 2.15 })];
  for (let i = 0; i < 9; i++) {
    const x = -2.4 + i * 0.6; const y = 2.15 - Math.sin(((i + 0.5) / 9) * Math.PI) * 0.35;
    const st = new THREE.Shape(); for (let k = 0; k <= 10; k++) { const a = (k / 10) * Math.PI * 2 + Math.PI / 2; const r = k % 2 ? 0.06 : 0.15; if (k) st.lineTo(Math.cos(a) * r, Math.sin(a) * r); else st.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    parts.push(xform(P(new THREE.ExtrudeGeometry(st, { depth: 0.05, bevelEnabled: false }), '#FFE08A'), { x, y: y - 0.2 }), cyl(0.008, 0.008, 0.08, 3, '#5A4A3A', { x, y: y - 0.08 }, 0));
  }
  return mergeAll(parts);
}, { glow: true });
decor('grandma_rocker', [1, 1], () => mergeAll([box(0.8, 0.08, 0.8, '#B5743E', { y: 0.45 }), box(0.8, 0.9, 0.08, '#B5743E', { y: 0.5, z: -0.38 }),
  ...[-0.38, 0.38].map((x) => xform(torus(0.6, 0.04, '#8A5A35', {}, 5, 12), { x, y: 0.62, ry: Math.PI / 2, sy: 0.6 }))]));
decor('golden_cow_statue', [2, 2], () => cowStatue(true));

// --- more decor from the content tables (M1a first; M1b/M2 with cheap generic builders) ---
const flowersBox = (hexes, boxHex = '#C8643A') => () => { const r = rng(hexes.join('')); return mergeAll([box(1.1, 0.5, 1.1, boxHex), box(1.0, 0.05, 1.0, '#5A3420', { y: 0.48 }),
  ...[0, 1, 2, 3].map((i) => xform(flowerClump(r, hexes, 5, 0.45), { x: (i % 2 - 0.5) * 0.45, y: 0.5, z: (Math.floor(i / 2) - 0.5) * 0.45 }))]); };
function tulip(hex) { return mergeAll([cyl(0.012, 0.015, 0.45, 4, '#4E8F3A', {}, 0), xform(lathe([[0, 0], [0.06, 0.02], [0.07, 0.1], [0.04, 0.16], [0, 0.12]], 8, hex), { y: 0.42 }), xform(leaf(0.25, 0.08, '#5BB040'), { ry: 1 })]); }
function trophy(hex, h = 1.0) { return mergeAll([box(0.6, 0.18, 0.6, '#7A4B3A'), lathe([[0, 0], [0.18, 0], [0.12, 0.08], [0.06, 0.25], [0.06, 0.35], [0.3, 0.55], [0.34, 0.85], [0, 0.8]], 16, hex).translate(0, 0.18, 0),
  xform(torus(0.12, 0.025, hex, {}, 5, 12), { x: 0.34, y: 0.85, ry: Math.PI / 2 }), xform(torus(0.12, 0.025, hex, {}, 5, 12), { x: -0.34, y: 0.85, ry: Math.PI / 2 })].map((g) => xform(g, { s: h }))); }
function rosetteStand(hex) { return mergeAll([cyl(0.04, 0.05, 1.2, 6, WOOD_D), box(0.5, 0.06, 0.5, WOOD_D), ...[cyl(0.36, 0.36, 0.05, 18, hex), cyl(0.24, 0.24, 0.07, 18, '#FFC83D'), cyl(0.15, 0.15, 0.08, 18, '#FFF8EC'),
  box(0.12, 0.4, 0.03, hex, { x: -0.1, y: -0.45, rz: 0.2 }), box(0.12, 0.4, 0.03, hex, { x: 0.1, y: -0.45, rz: -0.2 })].map((g) => xform(g, { rx: Math.PI / 2, y: 1.3, z: 0.06 }))]); }
function pedestal(content) { return mergeAll([box(0.9, 0.7, 0.9, '#E9D8B4'), box(1.0, 0.08, 1.0, '#C9A26A', { y: 0.7 }), box(0.8, 0.5, 0.8, '#D6EEF5', { y: 0.78 }), box(0.86, 0.05, 0.86, '#C9A26A', { y: 1.28 }), ...content.map((g) => xform(g, { y: 0.8 }))]); }
function miniHouse(wall, roof) { return mergeAll([box(0.9, 0.12, 0.9, '#C4BFB5'), box(0.55, 0.45, 0.45, wall, { y: 0.12 }), xform(gable(0.7, 0.55, 0.32, roof), { ry: Math.PI / 2, y: 0.57 }), box(0.12, 0.2, 0.02, '#5A3A22', { y: 0.12, z: 0.23 })]); }
decor('jam_shelf', [1, 1], () => mergeAll([box(1.2, 1.4, 0.06, WOOD_D, { z: -0.2 }), box(0.06, 1.4, 0.42, WOOD, { x: -0.6 }), box(0.06, 1.4, 0.42, WOOD, { x: 0.6 }),
  box(1.26, 0.06, 0.46, WOOD, { y: 1.4 }), box(1.2, 0.05, 0.4, WOOD, { y: 0.32 }), box(1.2, 0.05, 0.4, WOOD, { y: 0.82 }),
  ...['#E83A55', '#F59A23', '#8C4FA6', '#4D5BD6', '#E83A55', '#9BD86A'].map((hex, i) => xform(jar(hex), { x: -0.36 + (i % 3) * 0.36, y: i < 3 ? 0.37 : 0.87, z: 0.02, s: 1.1 }))]));
decor('ribbon_rosette', [1, 1], () => rosetteStand('#4AA8E8'));
decor('silver_rosette', [1, 1], () => rosetteStand('#C9CED3'));
decor('hamper_rosette', [1, 1], () => rosetteStand('#9BD86A'));
decor('ribbon_trophy', [1, 1], () => trophy('#FFC83D'));
decor('giant_trophy', [2, 2], () => mergeAll([trophy('#FFC83D', 2.2), xform(ball(0.5, '#F2852A', {}, 2), { y: 2.3, sy: 0.85 })]));
decor('mastery_sign', [1, 1], () => mergeAll([cyl(0.05, 0.06, 1.2, 6, WOOD_D), box(1.0, 0.6, 0.08, '#FFF8EC', { y: 0.9 }), box(1.08, 0.08, 0.1, WOOD, { y: 1.5 }), xform(P(new THREE.CircleGeometry(0.2, 5), '#FFC83D'), { y: 1.2, z: 0.05 })]));
decor('mastery_sign_gold', [1, 1], () => mergeAll([cyl(0.05, 0.06, 1.2, 6, '#C99A3A'), box(1.0, 0.6, 0.08, '#FFE58A', { y: 0.9 }), box(1.08, 0.08, 0.1, '#E9B13A', { y: 1.5 })]));
decor('bunting', [2, 1], () => {
  const parts = [cyl(0.05, 0.06, 2.0, 6, WOOD_D, { x: -1.7 }), cyl(0.05, 0.06, 2.0, 6, WOOD_D, { x: 1.7 })];
  const cols = ['#FF7A6B', '#FFC83D', '#2BB3A3', '#4AA8E8', '#FF9FB0'];
  for (let i = 0; i < 9; i++) {
    const x = -1.5 + i * 0.375; const sag = 1.9 - Math.sin(((i + 0.5) / 9) * Math.PI) * 0.25;
    parts.push(xform(P(new THREE.ConeGeometry(0.15, 0.32, 3), cols[i % 5]), { rx: Math.PI, x, y: sag - 0.16, sz: 0.2 }));
  }
  parts.push(xform(cyl(0.012, 0.012, 3.4, 4, '#FFF8EC', {}, 0), { rz: Math.PI / 2, y: 1.9 }));
  return sway(mergeAll(parts), { y0: 1.2, y1: 2.0, weight: 0.4 });
});
decor('bird_feeder', [1, 1], () => mergeAll([cyl(0.05, 0.06, 1.5, 6, WOOD_D), box(0.6, 0.06, 0.6, WOOD, { y: 1.5 }), cyl(0.18, 0.18, 0.3, 10, '#E9D8A6', { y: 1.56 }),
  xform(gable(0.8, 0.8, 0.35, '#C8473A'), { y: 1.9 }), ...[0, 1, 2].map((i) => cyl(0.03, 0.03, 0.34, 4, WOOD_D, { x: Math.cos(i * 2.1) * 0.25, y: 1.56, z: Math.sin(i * 2.1) * 0.25 }, 0)),
  xform(blob(0.09, '#4AA8E8', { seed: 3 }), { x: 0.2, y: 1.65, z: 0.2 })]));
decor('garden_gnome', [1, 1], () => mergeAll([cyl(0.22, 0.26, 0.4, 12, '#4AA8E8'), xform(ball(0.16, '#F2C29A', {}, 1), { y: 0.55 }), xform(blob(0.17, '#FFFFFF', { seed: 2, sy: 1.3 }), { y: 0.42, z: 0.08 }),
  cone(0.2, 0.45, 12, '#E84A3A', { y: 0.62 }), ball(0.04, '#F59AA0', { y: 0.55, z: 0.15 }, 0), cyl(0.1, 0.12, 0.08, 8, '#5A3A22', { x: -0.1, y: 0 }), cyl(0.1, 0.12, 0.08, 8, '#5A3A22', { x: 0.1, y: 0 })]));
decor('milk_churn', [1, 1], () => xform(milkCan(), { s: 1.8 }));
decor('flower_cart', [2, 1], () => {
  const r = rng('cart');
  return mergeAll([box(2.2, 0.5, 1.1, '#C8473A', { y: 0.5 }), box(2.1, 0.06, 1.0, '#5A3420', { y: 0.98 }),
    xform(torus(0.4, 0.07, WOOD_D, {}, 6, 16), { x: -0.5, y: 0.4, z: 0.62 }), xform(torus(0.4, 0.07, WOOD_D, {}, 6, 16), { x: -0.5, y: 0.4, z: -0.62 }),
    box(1.0, 0.06, 0.06, WOOD_D, { x: 1.55, y: 0.6, z: 0.4, rz: 0.25 }), box(1.0, 0.06, 0.06, WOOD_D, { x: 1.55, y: 0.6, z: -0.4, rz: 0.25 }),
    ...[0, 1, 2, 3, 4, 5].map((i) => xform(flowerClump(r, ['#FF7A9C', '#FFD21F', '#FFFFFF', '#A98BE0'], 5, 0.4), { x: -0.8 + (i % 3) * 0.75, y: 1.0, z: (Math.floor(i / 3) - 0.5) * 0.5 }))]);
});
decor('lucky_horseshoe', [1, 1], () => mergeAll([cyl(0.06, 0.07, 1.4, 6, WOOD_D), xform(torus(0.26, 0.05, '#C9CED3', {}, 6, 16), { y: 1.1, z: 0.08, sx: 0.85 }).translate(0, 0, 0),
  box(0.6, 0.12, 0.1, WOOD, { y: 1.45 })]));
decor('picnic_table', [2, 1], () => mergeAll([box(2.4, 0.08, 1.0, WOOD, { y: 0.78 }), ...[-0.95, 0.95].flatMap((x) => [box(0.08, 0.78, 0.9, WOOD_D, { x, rz: 0 })]),
  box(2.4, 0.06, 0.32, WOOD, { y: 0.45, z: 0.75 }), box(2.4, 0.06, 0.32, WOOD, { y: 0.45, z: -0.75 }),
  box(2.0, 0.02, 0.9, '#E84A3A', { y: 0.83 }), ...[0, 1, 2, 3].map((i) => box(0.25, 0.021, 0.9, '#FFF8EC', { x: -0.75 + i * 0.5, y: 0.834 })), xform(basketOf([['#E23B3B', 0, 0]])(), { s: 0.4, y: 0.84, x: 0.5 })]));
decor('tulip_planter', [1, 1], () => mergeAll([box(1.1, 0.5, 1.1, '#C8643A'), box(1.0, 0.05, 1.0, '#5A3420', { y: 0.48 }),
  ...Array.from({ length: 9 }, (_, i) => xform(tulip(['#E84A5F', '#FFD21F', '#FF9FB0'][i % 3]), { x: (i % 3 - 1) * 0.3, y: 0.5, z: (Math.floor(i / 3) - 1) * 0.3 }))]));
decor('sunflower_planter', [1, 1], () => mergeAll([box(1.1, 0.5, 1.1, '#7A4B3A'), box(1.0, 0.05, 1.0, '#5A3420', { y: 0.48 }),
  ...[0, 1, 2].map((i) => xform(sunflowerPlant(2, rng(`sp${i}`)), { s: 0.7, x: (i - 1) * 0.3, y: 0.5, z: (i % 2) * 0.2 }))]));
decor('pumpkin_lanterns', [1, 1], () => mergeAll([0, 1, 2].map((i) => xform(mergeAll([ball(0.3, '#F2852A', { sy: 0.8 }, 2), cyl(0.04, 0.05, 0.12, 5, '#4E8F35', { y: 0.24 }, 0),
  box(0.08, 0.08, 0.02, '#FFE08A', { x: -0.08, y: 0.05, z: 0.29 }), box(0.08, 0.08, 0.02, '#FFE08A', { x: 0.08, y: 0.05, z: 0.29 }), box(0.18, 0.05, 0.02, '#FFE08A', { y: -0.08, z: 0.28 })]), { x: (i - 1) * 0.55, y: 0.25 + (i === 1 ? 0.35 : 0), z: i === 1 ? -0.15 : 0.1 }))), { glow: true });
decor('snow_lantern', [1, 1], () => mergeAll([cyl(0.3, 0.36, 0.3, 8, '#C4BFB5'), cyl(0.12, 0.15, 0.6, 8, '#B5AEA2', { y: 0.3 }), box(0.45, 0.35, 0.45, '#FFE08A', { y: 0.9 }),
  xform(P(new THREE.ConeGeometry(0.5, 0.35, 4), '#B5AEA2'), { y: 1.42, ry: Math.PI / 4 }), xform(blob(0.32, '#FFFFFF', { seed: 4, sy: 0.35 }), { y: 1.5 })]), { glow: true });
decor('mabel_stall', [2, 1], () => mergeAll([box(0.12, 2.0, 0.12, WOOD_D, { x: -1.5 }), box(0.12, 2.0, 0.12, WOOD_D, { x: 1.5 }), box(3.2, 0.8, 0.1, '#2E4A3A', { y: 1.1 }),
  box(3.3, 0.1, 0.14, WOOD, { y: 1.5 }), box(3.3, 0.1, 0.14, WOOD, { y: 1.05 }), ...[0, 1, 2].map((i) => box(0.6, 0.06, 0.02, '#FFF8EC', { x: -0.9 + i * 0.9, y: 1.3, z: 0.06 }))]));
decor('melon_awning', [2, 1], () => melonAwning());
decor('pig_mud_bath', [2, 2], () => mergeAll([xform(blob(1.6, '#6E4A2E', { seed: 3, sy: 0.05, amp: 0.15 }), { y: 0.03 }), xform(blob(1.8, '#8E6A40', { seed: 3, sy: 0.04, amp: 0.15 }), { y: 0.01 }),
  ...[0, 1, 2].map((i) => xform(blob(0.12, '#7A5233', { seed: i, sy: 0.5 }), { x: Math.cos(i * 2) * 0.8, y: 0.06, z: Math.sin(i * 2) * 0.8 }))]));
decor('saddle_rack', [1, 1], () => mergeAll([box(0.1, 1.0, 0.1, WOOD_D, { x: -0.4 }), box(0.1, 1.0, 0.1, WOOD_D, { x: 0.4 }), box(1.0, 0.1, 0.1, WOOD, { y: 0.9 }),
  xform(blob(0.35, '#8A4A2A', { seed: 2, sx: 1.2, sy: 0.5 }), { y: 1.05 })]));
decor('rope_coil', [1, 1], () => mergeAll([0, 1, 2, 3].map((i) => xform(torus(0.35 - i * 0.02, 0.06, '#D9B97A', {}, 6, 18), { rx: Math.PI / 2, y: 0.07 + i * 0.1 }))));
decor('gold_scale', [1, 1], () => mergeAll([cyl(0.3, 0.35, 0.1, 12, '#E9B13A'), cyl(0.04, 0.05, 1.0, 6, '#E9B13A', { y: 0.1 }), box(1.0, 0.05, 0.05, '#E9B13A', { y: 1.05 }),
  ...[-0.45, 0.45].map((x) => cyl(0.18, 0.12, 0.06, 12, '#FFC83D', { x, y: 0.75 }))]));
decor('olive_jar', [1, 1], () => oliveJar());
decor('fig_crate', [1, 1], () => figCrate());
// displays (collections) and souvenirs (town projects): a pedestal case / a miniature on a plinth
const DISPLAYS = { recipe_cards_display: '#FFF8EC', butterflies_display: '#FF9FB0', lost_tools_display: '#C9CED3', feathers_display: '#FFC83D', heirloom_seeds_display: '#9BD86A',
  pond_treasures_display: '#4AA8E8', fossils_display: '#C99A62', honey_jars_display: '#F2C25E', buttons_display: '#E84A5F', fair_rosettes_display: '#FF7A6B', old_coins_display: '#E9B13A', love_notes_display: '#FF7A9C' };
// Collection display pieces (GDD §5.5, wave 2): each set gets its own piece you can tell apart on the lawn (wave 1
// had one pedestal with three balls hidden in an opaque "glass" box): a display table in the set's colour under a
// light frame, carrying the five finds of the set.
/** A low display table (cloth in the set colour) under an open glass-case frame; `top` items stand on it at y 0. */
function displayTable(hex, top, { frame = true } = {}) {
  const parts = [box(0.95, 0.62, 0.7, WOOD_D), box(1.02, 0.06, 0.77, WOOD, { y: 0.62 }), box(0.97, 0.03, 0.72, hex, { y: 0.68 }),
    box(0.99, 0.18, 0.02, hex, { y: 0.52, z: 0.37 })];
  if (frame) {
    for (const [x, z] of [[-0.46, -0.33], [0.46, -0.33], [-0.46, 0.33], [0.46, 0.33]]) parts.push(box(0.035, 0.5, 0.035, '#E9D8B4', { x, y: 0.71, z }));
    parts.push(box(0.97, 0.035, 0.035, '#E9D8B4', { y: 1.2, z: -0.33 }), box(0.97, 0.035, 0.035, '#E9D8B4', { y: 1.2, z: 0.33 }),
      box(0.035, 0.035, 0.7, '#E9D8B4', { x: -0.46, y: 1.2 }), box(0.035, 0.035, 0.7, '#E9D8B4', { x: 0.46, y: 1.2 }),
      box(0.92, 0.012, 0.64, '#D6EEF5', { y: 1.22 }));
  }
  for (const g of top) parts.push(xform(g, { y: 0.71 }));
  return mergeAll(parts);
}
const butterflyGeo = (a, b, s = 0.13) => mergeAll([xform(blob(s * 0.5, a, { detail: 0, sx: 1.2, sy: 0.15, sz: 0.9, seed: 1 }), { x: -s * 0.45, rz: 0.3 }),
  xform(blob(s * 0.5, a, { detail: 0, sx: 1.2, sy: 0.15, sz: 0.9, seed: 2 }), { x: s * 0.45, rz: -0.3 }), xform(blob(s * 0.3, b, { detail: 0, sx: 1.1, sy: 0.15, seed: 3 }), { x: -s * 0.35, z: -s * 0.35 }),
  xform(blob(s * 0.3, b, { detail: 0, sx: 1.1, sy: 0.15, seed: 4 }), { x: s * 0.35, z: -s * 0.35 }), box(0.02, 0.02, s * 0.8, '#3A2A1A')]);
const DISPLAY_BUILDERS = {
  recipe_cards_display: () => displayTable('#E8556F', [box(0.7, 0.04, 0.4, WOOD, { z: -0.08 }),
    ...['#C8473A', '#F2C94C', '#7FB547', '#4AA8E8', '#A98BE0'].map((h, i) => xform(mergeAll([box(0.17, 0.24, 0.015, '#FFF8EC'), box(0.17, 0.05, 0.017, h, { y: 0.17 })]), { x: -0.36 + i * 0.18, y: 0.04, z: -0.08 + (i % 2) * 0.05, rx: -0.25, ry: (i - 2) * 0.08 }))], { frame: false }),
  butterflies_display: () => displayTable('#7FB8E6', [box(0.86, 0.04, 0.56, '#FFF8EC'),
    ...[['#FFFFFF', '#3A3A3A'], ['#D9542B', '#4A90D9'], ['#F2D04B', '#2A2A2A'], ['#3A7BE0', '#1A2A6A'], ['#F28A1C', '#2A1A0A']].map(([a, b], i) => xform(butterflyGeo(a, b), { x: -0.3 + (i % 3) * 0.3, y: 0.05, z: i < 3 ? -0.12 : 0.14 }))]),
  lost_tools_display: () => mergeAll([box(1.0, 1.3, 0.08, WOOD_D, { z: -0.25 }), box(1.1, 0.08, 0.5, WOOD), box(0.08, 1.3, 0.08, WOOD, { x: -0.5, z: -0.25 }), box(0.08, 1.3, 0.08, WOOD, { x: 0.5, z: -0.25 }),
    xform(mergeAll([cyl(0.02, 0.025, 0.36, 5, '#8A5A35'), xform(P(new THREE.ConeGeometry(0.06, 0.18, 4), '#8C8F94', { creaseDeg: 40 }), { rx: Math.PI, y: -0.06 })]), { x: -0.32, y: 0.75, z: -0.18 }),
    xform(mergeAll([cyl(0.018, 0.018, 0.6, 5, '#8A5A35'), ...[-0.05, 0, 0.05].map((x) => cyl(0.008, 0.008, 0.18, 3, '#8C8F94', { x, y: 0.55 }, 0))]), { x: -0.08, y: 0.45, z: -0.18 }),
    xform(mergeAll([lathe([[0, 0], [0.09, 0], [0.1, 0.1], [0.05, 0.16], [0.012, 0.3], [0, 0.3]], 8, '#C9A23A'), xform(torus(0.06, 0.012, '#A8862A', {}, 3, 8), { x: -0.1, y: 0.1, ry: Math.PI / 2 })]), { x: 0.2, y: 0.08 }),
    xform(cyl(0.07, 0.07, 0.1, 8, '#8C8F94'), { x: -0.2, y: 0.08 }),
    xform(mergeAll([box(0.22, 0.04, 0.05, '#7A4B2C'), box(0.18, 0.012, 0.035, '#D5DADF', { x: 0.18 })]), { x: 0.28, y: 0.95, z: -0.18, rz: 0.4 })]),
  feathers_display: () => mergeAll([box(0.6, 0.55, 0.6, WOOD_D), box(0.66, 0.06, 0.66, WOOD, { y: 0.55 }),
    lathe([[0, 0], [0.13, 0], [0.18, 0.12], [0.12, 0.3], [0.09, 0.4], [0.12, 0.44], [0, 0.44]], 10, '#3E7FB0').translate(0, 0.61, 0),
    ...[['#9A7A5A', -0.35], ['#6A6A6A', -0.15], ['#C8743A', 0.05], ['#FFC83D', 0.22], ['#2BA88A', 0.38]].map(([h, a], i) => xform(mergeAll([leaf(0.55, 0.12, h, { bend: 0.15, seg: 2 }), cyl(0.006, 0.006, 0.55, 3, '#FFF2C8', {}, 0)]), { rz: a, ry: i * 0.9, y: 0.95 }))]),
  heirloom_seeds_display: () => displayTable('#7FB547', [box(0.9, 0.3, 0.08, WOOD, { z: -0.2 }), box(0.9, 0.04, 0.22, WOOD, { y: 0.3, z: -0.12 }),
    ...['#7A3E8A', '#E8E0A0', '#3A5AA8', '#2A2A2A', '#C84A6A'].map((h, i) => xform(mergeAll([cyl(0.075, 0.075, 0.16, 10, '#C9CED3'), cyl(0.077, 0.077, 0.08, 10, h, { y: 0.04 }), cyl(0.08, 0.08, 0.02, 10, '#8C8F94', { y: 0.16 })]), { x: -0.34 + i * 0.17, y: i % 2 ? 0.34 : 0, z: i % 2 ? -0.12 : 0.08 }))], { frame: false }),
  pond_treasures_display: () => displayTable('#4AA8E8', [xform(blob(0.32, '#E3D3A8', { seed: 3, sy: 0.12, detail: 1 }), { y: 0.02 }),
    xform(ball(0.07, '#6FD3B6', { sy: 0.6 }, 0), { x: -0.22, y: 0.05 }), xform(lathe([[0, 0], [0.07, 0], [0.08, 0.18], [0.03, 0.24], [0.025, 0.32], [0, 0.32]], 8, '#7FB8A0'), { x: 0.2, y: 0.03, rz: 1.4 }),
    xform(blob(0.07, '#E3B88A', { seed: 7, detail: 0 }), { x: -0.05, y: 0.08, z: 0.12 }), xform(ball(0.06, '#5DAA45', {}, 0), { x: 0.05, y: 0.08, z: -0.12 })]),
  fossils_display: () => mergeAll([box(0.9, 0.5, 0.6, '#9C958A'), box(0.96, 0.06, 0.66, '#B5AEA2', { y: 0.5 }),
    xform(mergeAll([box(0.7, 0.5, 0.12, '#C9B79A', { y: 0 }), ...Array.from({ length: 10 }, (_, i) => { const a = i * 0.6; const rr = 0.03 + i * 0.012; return xform(ball(0.025 + i * 0.002, '#8A6A40', {}, 0), { x: -0.15 + Math.cos(a) * rr, y: 0.25 + Math.sin(a) * rr, z: 0.07 }); }),
      xform(blob(0.09, '#8A7050', { seed: 5, sx: 1.4, sy: 0.4, detail: 0 }), { x: 0.17, y: 0.3, z: 0.07, rx: Math.PI / 2 })]), { y: 0.56, z: -0.12, rx: -0.15 }),
    ...[-0.25, 0, 0.25].map((x, i) => xform(P(new THREE.ConeGeometry(0.05, 0.12, 3), i === 1 ? '#5A5A5A' : '#8A7A6A', { creaseDeg: 30 }), { x, y: 0.6, z: 0.18, rx: Math.PI / 2, sz: 0.4 }))]),
  honey_jars_display: () => mergeAll([box(1.0, 1.1, 0.08, WOOD_D, { z: -0.22 }), ...[0.0, 0.55].map((y) => box(1.0, 0.05, 0.42, WOOD, { y })), box(0.06, 1.1, 0.42, WOOD, { x: -0.5 }), box(0.06, 1.1, 0.42, WOOD, { x: 0.5 }),
    ...['#F7D86A', '#F2C25E', '#C8B5F0', '#FFC83D', '#C9862E'].map((h, i) => xform(mergeAll([lathe([[0, 0], [0.11, 0], [0.12, 0.05], [0.12, 0.2], [0.08, 0.25], [0, 0.25]], 10, h), cyl(0.085, 0.085, 0.05, 10, '#7A4B2C', { y: 0.24 }), box(0.18, 0.08, 0.02, '#FFF8EC', { y: 0.1, z: 0.11 })]), { x: -0.32 + (i % 3) * 0.32, y: i < 3 ? 0.06 : 0.61, z: 0.02 }))]),
  buttons_display: () => displayTable('#C86A80', [box(0.7, 0.14, 0.45, '#B5743E'), box(0.72, 0.03, 0.47, '#8E5A34', { y: 0.14 }),
    ...[['#8A5A35', 0.08], ['#E9B13A', 0.07], ['#C9CED3', 0.06], ['#E84A5F', 0.07], ['#4AA8E8', 0.06]].map(([h, r0], i) => xform(mergeAll([cyl(r0, r0, 0.025, 10, h), ...[[-1, -1], [1, 1]].map(([a, b]) => cyl(0.01, 0.01, 0.027, 3, '#3A2A1A', { x: a * r0 * 0.3, z: b * r0 * 0.3 }, 0))]), { x: -0.25 + (i % 3) * 0.22, y: 0.18, z: i < 3 ? -0.1 : 0.1 })),
    xform(mergeAll([ball(0.11, '#E8556F', { sy: 0.7 }, 1), ...[0, 1, 2].map((k) => cyl(0.006, 0.006, 0.14, 3, '#D5DADF', { x: (k - 1) * 0.04, y: 0.04 }, 0))]), { x: 0.42, y: 0.12, z: 0.2 })], { frame: false }),
  fair_rosettes_display: () => mergeAll([cyl(0.04, 0.05, 1.3, 6, WOOD_D, { x: -0.45 }), cyl(0.04, 0.05, 1.3, 6, WOOD_D, { x: 0.45 }), box(1.0, 0.7, 0.06, '#E8DCC2', { y: 0.6 }),
    ...['#FFC83D', '#E84A3A', '#4AA8E8', '#9C5AC8', '#FF7A9C'].map((h, i) => xform(mergeAll([cyl(0.12, 0.12, 0.03, 12, h), cyl(0.07, 0.07, 0.035, 12, '#FFF8EC'), box(0.05, 0.16, 0.01, h, { x: -0.03, y: -0.16, rz: 0.2 }), box(0.05, 0.16, 0.01, h, { x: 0.03, y: -0.16, rz: -0.2 })]), { x: -0.32 + (i % 3) * 0.32, y: i < 3 ? 1.12 : 0.78, z: 0.05, rx: Math.PI / 2 }))]),
  old_coins_display: () => displayTable('#E9B13A', [...Array.from({ length: 7 }, (_, i) => cyl(0.06, 0.06, 0.02 + (i % 3) * 0.015, 10, i % 3 === 1 ? '#C9CED3' : i % 3 === 2 ? '#B87333' : '#FFC83D', { x: -0.3 + (i % 4) * 0.2, z: i < 4 ? -0.1 : 0.12 }))]),
  love_notes_display: () => mergeAll([box(0.5, 0.06, 0.4, WOOD_D), box(0.06, 0.9, 0.06, WOOD_D, { y: 0.06 }),
    xform(mergeAll([(() => { const hh = new THREE.Shape(); hh.moveTo(0, -0.3); hh.bezierCurveTo(0.55, 0.12, 0.3, 0.55, 0, 0.27); hh.bezierCurveTo(-0.3, 0.55, -0.55, 0.12, 0, -0.3); return P(new THREE.ExtrudeGeometry(hh, { depth: 0.05, bevelEnabled: false, curveSegments: 8 }), '#FF7A9C'); })(),
      box(0.16, 0.2, 0.01, '#FFF8EC', { x: -0.1, y: -0.05, z: 0.06, rz: 0.15 }), box(0.14, 0.16, 0.01, '#FFFFFF', { x: 0.1, y: -0.02, z: 0.06, rz: -0.1 })]), { y: 1.1 })]),
};
for (const [id, hex] of Object.entries(DISPLAYS)) { void hex; decor(id, [1, 1], DISPLAY_BUILDERS[id]); }
const SOUVENIRS = { ferry_landing_souvenir: ['#C99050', '#4AA8E8'], chapel_souvenir: ['#FFF8EC', '#C8473A'], bandstand_souvenir: ['#FFF8EC', '#2BB3A3'], schoolhouse_souvenir: ['#C8473A', '#7A4B3A'],
  lighthouse_souvenir: ['#FFFFFF', '#E84A3A'], village_carousel_souvenir: ['#FFC83D', '#FF7A6B'], village_bakery_souvenir: ['#F3E2BE', '#C8643A'], millpond_bridge_souvenir: ['#B5AEA2', '#7A4B3A'],
  library_souvenir: ['#C8473A', '#3E9BB5'], flower_market_souvenir: ['#FFF8EC', '#FF9FB0'], post_office_souvenir: ['#4AA8E8', '#C8473A'], tea_room_souvenir: ['#FFE9F2', '#9C7FD0'],
  clock_square_souvenir: ['#C4BFB5', '#3E9BB5'], watermill_souvenir: ['#C99050', '#7A4B3A'], boathouse_souvenir: ['#4AA8E8', '#FFF8EC'], village_green_souvenir: ['#9BD86A', '#C8473A'],
  music_hall_souvenir: ['#A98BE0', '#FFC83D'], harbour_inn_souvenir: ['#F3E2BE', '#2E4A3A'], observatory_souvenir: ['#C4BFB5', '#4D5BD6'], craft_hall_souvenir: ['#D9A15B', '#C8473A'],
  glasshouse_garden_souvenir: ['#D6EEF5', '#9BD86A'], skating_pond_souvenir: ['#D6F1FF', '#4AA8E8'], orchard_walk_souvenir: ['#9BD86A', '#E23B3B'], festival_arch_souvenir: ['#FF9FB0', '#7A4BC2'] };
// wave 3: a souvenir is its landmark in miniature on a plinth (the stand-in miniHouse for any landmark without a builder)
for (const [id, [wall, roof]] of Object.entries(SOUVENIRS)) {
  const town = id.replace(/_souvenir$/, '');
  decor(id, [1, 1], async () => (Object.hasOwn(TOWN_BUILDERS, town) ? souvenirOf(TOWN_BUILDERS[town]) : miniHouse(wall, roof)));
}
decor('pavilion_souvenir', [1, 1], async () => souvenirOf(() => festivalPavilion(8)));
// the County Fair's gold-week trophy and its Platinum champion banner, Captain Reed's lantern and ship's bell (rewards)
decor('fair_trophy', [1, 1], () => mergeAll([box(0.9, 0.3, 0.9, '#7A4B3A'), box(0.96, 0.05, 0.96, GOLD_D, { y: 0.3 }), box(0.4, 0.12, 0.02, BRASS, { y: 0.1, z: 0.46 }),
  lathe([[0, 0], [0.2, 0], [0.12, 0.08], [0.07, 0.3], [0.07, 0.4], [0.32, 0.62], [0.36, 0.95], [0.3, 0.93], [0, 0.85]], 16, '#FFC83D', 40).translate(0, 0.35, 0),
  ...[-1, 1].map((sd) => xform(torus(0.14, 0.03, '#FFC83D', {}, 4, 10), { x: sd * 0.38, y: 1.08, rz: sd * 0.2 })),
  xform(mergeAll([cyl(0.2, 0.2, 0.03, 14, '#2E6FD0'), cyl(0.13, 0.13, 0.035, 14, '#FFC83D'), cyl(0.08, 0.08, 0.04, 12, '#FFF8EC'), box(0.08, 0.28, 0.01, '#D93A3A', { x: -0.05, y: -0.28, rz: 0.15 }), box(0.08, 0.28, 0.01, '#2E6FD0', { x: 0.05, y: -0.28, rz: -0.15 })].map((g) => xform(g, { rx: Math.PI / 2 }))), { y: 0.82, z: 0.33 })]));
decor('champion_banner', [1, 2], () => {
  const PLAT = '#D9DEE4';
  const parts = [box(1.6, 0.25, 3.4, LIMESTONE_D), box(1.5, 0.08, 3.3, LIMESTONE, { y: 0.25 })];
  for (const x of [-0.65, 0.65]) parts.push(cyl(0.05, 0.06, 3.0, 6, '#5E5A55', { x, y: 0.33, z: -1.2 }), ball(0.09, GOLD, { x, y: 3.38, z: -1.2 }, 1));
  parts.push(box(1.4, 0.05, 0.05, '#5E5A55', { y: 3.1, z: -1.2 }), box(1.2, 2.0, 0.04, '#5A3E8E', { y: 1.1, z: -1.2 }), box(1.22, 0.1, 0.05, GOLD, { y: 1.06, z: -1.2 }),
    ...Array.from({ length: 9 }, (_, i) => cyl(0.012, 0.012, 0.16, 3, GOLD, { x: -0.56 + i * 0.14, y: 0.92, z: -1.2 }, 0)),
    xform(mergeAll([cyl(0.36, 0.36, 0.03, 16, PLAT), cyl(0.24, 0.24, 0.04, 16, GOLD), cyl(0.14, 0.14, 0.05, 14, '#FFFFFF')].map((g) => xform(g, { rx: Math.PI / 2 }))), { y: 2.2, z: -1.16 }),
    xform(lathe([[0, 0], [0.24, 0], [0.14, 0.08], [0.08, 0.32], [0.08, 0.42], [0.38, 0.66], [0.42, 1.05], [0.35, 1.03], [0, 0.94]], 16, PLAT, 40), { y: 0.33, z: 0.7 }),
    ...[-1, 1].map((sd) => xform(torus(0.16, 0.035, PLAT, {}, 4, 10), { x: sd * 0.44, y: 1.15, z: 0.7, rz: sd * 0.2 })), ball(0.08, GOLD, { y: 1.42, z: 0.7 }, 1),
    ...[-0.6, 0.6].map((x) => xform(flowerUrn(['#9C7FD0', '#FFFFFF', '#FFD21F']), { x, z: 1.4, s: 0.8 })));
  return mergeAll(parts);
});
decor('captains_lantern', [1, 1], () => mergeAll([cyl(0.06, 0.08, 1.5, 6, '#5A3A26'), box(0.5, 0.06, 0.06, '#5A3A26', { y: 1.45, x: 0.2 }), xform(mergeAll([
  cyl(0.16, 0.18, 0.06, 8, BRASS), cyl(0.15, 0.15, 0.36, 8, '#FFE08A', { y: 0.06 }), ...[0, 1, 2, 3].map((i) => box(0.025, 0.36, 0.025, BRASS, { x: Math.cos(i * 1.571) * 0.15, y: 0.06, z: Math.sin(i * 1.571) * 0.15 })),
  lathe([[0.18, 0], [0.12, 0.12], [0.05, 0.18], [0, 0.2]], 8, BRASS).translate(0, 0.42, 0), xform(torus(0.06, 0.015, BRASS, {}, 3, 8), { y: 0.66 })]), { x: 0.42, y: 0.75 })]), { glow: true });
decor('ship_bell', [1, 1], () => mergeAll([box(0.6, 0.12, 0.6, '#5A3A26'), ...[-0.24, 0.24].map((x) => box(0.08, 1.3, 0.08, '#7A5236', { x, y: 0.12 })), box(0.66, 0.1, 0.12, '#7A5236', { y: 1.4 }),
  xform(lathe([[0, 0], [0.2, 0], [0.19, 0.04], [0.15, 0.12], [0.12, 0.3], [0.08, 0.36], [0, 0.37]], 12, '#C9952E', 40), { y: 0.95 }), cyl(0.02, 0.02, 0.1, 4, '#5E5A55', { y: 1.3 }),
  tube([[0, 0.98, 0], [0.04, 0.8, 0.02], [0.06, 0.55, 0.0]], 0.015, '#D9B97A', { seg: 3, steps: 6 }), xform(torus(0.06, 0.02, '#D9B97A', {}, 3, 8), { x: 0.06, y: 0.5 })]));
// wave 3: the Friendly Duel's pennant (the two farmers' colours and a gold crown), the Seasonal Track's pennant and
// trophy, the Legacy statue (a bronze farmer on a plinth)
decor('duel_pennant', [1, 1], () => mergeAll([box(0.5, 0.18, 0.5, LIMESTONE_D), cyl(0.04, 0.05, 2.3, 6, '#8A5A35', { y: 0.18 }), ball(0.07, GOLD, { y: 2.5 }, 1),
  xform(mergeAll([xform(P(new THREE.ConeGeometry(0.32, 1.1, 3), '#2BB3A3'), { rz: -Math.PI / 2, x: 0.55, y: 0.18, sz: 0.08 }), xform(P(new THREE.ConeGeometry(0.32, 1.1, 3), '#FF7A6B'), { rz: -Math.PI / 2, x: 0.55, y: -0.18, sz: 0.08 }),
    xform(mergeAll([box(0.24, 0.1, 0.03, GOLD), ...[-0.09, 0, 0.09].map((x) => xform(P(new THREE.ConeGeometry(0.04, 0.1, 4), GOLD), { x, y: 0.1, sz: 0.4 }))]), { x: 0.3, z: 0.06 })]), { y: 2.05 })]));
decor('season_pennant', [1, 1], () => sway(mergeAll([box(0.5, 0.18, 0.5, LIMESTONE_D), cyl(0.04, 0.05, 2.2, 6, '#8A5A35', { y: 0.18 }), ball(0.07, GOLD, { y: 2.42 }, 1),
  xform(stripesY(xform(P(new THREE.PlaneGeometry(1.1, 0.7, 4, 4), '#FFF8EC'), {}), 4, ['#F4B6C8', '#F2C46B', '#B5562E', '#DDE8F2']), { x: 0.6, y: 2.0 }), ...[0, 1, 2, 3].map((i) => xform(flatFlower(['#F4B6C8', '#F2C46B', '#B5562E', '#DDE8F2'][i], 0.06), { x: 0.3 + i * 0.2, y: 2.0, z: 0.01, rx: Math.PI / 2 }))]), { y0: 1.6, y1: 2.4, weight: 0.5 }));
decor('season_trophy', [1, 1], () => mergeAll([trophy('#FFC83D', 1.1), ...['#F4B6C8', '#F2C46B', '#B5562E', '#9FD3E8'].map((c, i) => xform(P(new THREE.OctahedronGeometry(0.07, 0), c), { x: Math.sin(i * 1.571 + 0.785) * 0.32, y: 0.12, z: Math.cos(i * 1.571 + 0.785) * 0.32 }))]));
decor('legacy_statue', [1, 1], async () => {
  const t = await tools();
  const doc = await t.io.read(await sourcePath('quaternius-ultimate-modular-men/Individual Characters/glTF/Farmer.gltf'));
  const g = toHeight(bakePose(await parseThree(doc), 'Wave'), 1.35);
  hueTo(g, '#9A6A3A'); mottle(g, { freq: 5, lo: 0.85, hi: 1.12, seed: 4 });
  const st = await simplify(crease(g, 45), 1400 / tris(g), { error: 0.02, deg: 45 });
  return mergeAll([box(1.0, 0.5, 1.0, LIMESTONE), box(1.1, 0.08, 1.1, LIMESTONE_D, { y: 0.5 }), box(0.5, 0.18, 0.02, BRASS, { y: 0.18, z: 0.51 }), xform(st, { y: 0.58 })]);
});
// grand decor (M2): composites of the same families
decor('grand_windmill', [3, 3], () => grandWindmill(), { far: true });
decor('flower_maze', [4, 4], () => flowerMaze(), { far: true });
decor('koi_pond', [3, 3], () => koiPond(), { far: true });
decor('carousel', [4, 4], () => carousel(), { glow: true, far: true });
decor('treehouse', [3, 3], () => treehouse(), { far: true });
decor('clock_tower', [2, 2], () => clockTower(), { far: true });
decor('orangery', [4, 3], () => orangery(), { far: true });
decor('arbor_of_lights', [3, 2], () => arborOfLights(), { glow: true, far: true });
decor('bath_house', [4, 4], () => bathHouse(), { far: true });
decor('golden_gate', [3, 1], () => goldenGate(), { far: true });

for (const dc of DECOR) {
  job(`decor:${dc.id}`, `decor/${dc.id}.glb`, { family: 'decor', def: dc.id, footprint: dc.size, ...(dc.extra.layer ? { layer: dc.extra.layer } : {}), ...(dc.extra.glow ? { glow: true } : {}), ...(dc.extra.sway ? { sway: dc.extra.sway } : {}) },
    async () => {
      const g = await dc.build();
      const b = bounds(g);
      if (b.min.y > 0.01) g.translate(0, -b.min.y, 0);           // nothing floats (rocking chairs, lanterns)
      // anchors (wave 3: the orangery's panes, the bath house's steam, the gate's name plaque) go to the manifest
      if (g.anchors) JOBS.find((j) => j.key === `decor:${dc.id}`).meta.anchors = g.anchors;
      return g.getAttribute('sway') ? g : sway(g, { rigid: true });
    });
  for (const a of dc.extra.aliases || []) manifest.aliases[a] = `decor:${dc.id}`;
  // wave 3: a far-band twin for the heavy showpieces (objects-view's bandKey swaps `<key>:far` in at the far band and
  // uses it for the shadow twin), so ten Grand decor pieces cost what two did at the farm view
  if (dc.extra.far) {
    job(`decor:${dc.id}:far`, `decor/${dc.id}.glb`, { family: 'decor', footprint: dc.size, part: true, far: true }, async () => {
      const src = await dc.build();
      const b = bounds(src);
      if (b.min.y > 0.01) src.translate(0, -b.min.y, 0);
      let g = src;
      for (const error of [0.05, 0.1, 0.2, 0.4]) {
        if (tris(g) <= DECOR_FAR * 1.08) break;
        g = await simplify(src, DECOR_FAR / tris(src), { error, deg: 35, lockBorder: false });
      }
      return sway(g, { rigid: true });
    });
  }
}

// The Old Dutch Windmill's sails: a part of their own, spun about the hub by objects-view (`building:<id>:sails`).
job('building:grand_windmill:sails', 'decor/grand_windmill.glb', { family: 'decor', def: 'grand_windmill', footprint: [3, 3], part: true, axis: 'z' }, async () => {
  JOBS.find((j) => j.key === 'building:grand_windmill:sails').meta.pivot = [0, GWM.hubY, GWM.hubZ];
  return sway(grandWindmillSails(), { rigid: true });
});

// Debris (GDD §2.3): cleared with the Hand or the Axe.
const DEBRIS = {
  // <= 150 triangles (performance-03): a low mound, six leaves, two flat flowers
  // RD-08 (QA wave 2: spiky weeds scattered through the core): 40 % lower, a soft round clump of broad leaves
  weed: [[1, 1], () => {
    const r = rng('weed');
    const parts = [xform(blob(0.3, '#5E9E3A', { seed: 5, sy: 0.45, flatBottom: 0.4, amp: 0.3, detail: 1 }), { y: 0.05 })];
    for (let i = 0; i < 6; i++) parts.push(xform(leaf(0.26 + r() * 0.1, 0.13, i % 2 ? '#4E8F35' : '#6BAA3F', { bend: 0.9, seg: 2 }), { rx: 0.35, ry: (i / 6) * 6.28 + r() * 0.3, y: 0.04 }));
    parts.push(xform(flatFlower('#FFE14A', 0.08), { y: 0.25, x: 0.1 }), xform(flatFlower('#FFFFFF', 0.065), { y: 0.2, x: -0.16, z: 0.1 }));
    return sway(mergeAll(parts), { y1: 0.3 });
  }],
  rock: [[1, 1], async () => srcFit(UN('Rock_2'), { w: 1.3, d: 1.3, sat: 0.1, recolor: { Rock: '#A7A39A' } })],
  stump: [[1, 1], async () => srcFit(UN('TreeStump'), { w: 1.6, d: 1.6, sat: 0.2, recolor: { Wood: '#8A5A35', LightWood: '#E2C08A', Green: '#5E9E3A' } })],
  log: [[2, 1], async () => srcFit(UN('WoodLog'), { w: 3.6, d: 1.4, sat: 0.2, ry: Math.PI / 2, recolor: { Wood: '#8A5A35', Mushroom_Top: '#E84A3A', Mushroom_Bottom: '#FFF2D6' } })],
  // a grey boulder with a mossy cap (visual-17: the ochre one read as a haystack)
  boulder: [[2, 2], async () => capColor(await srcFit(UN('Rock_3'), { w: 3.2, d: 3.2, sat: 0.1, recolor: { Rock: '#9AA0A6' } }), '#6F8F4E', { k: 0.8, from: 0.55, to: 0.9 })],
  big_stump: [[2, 2], async () => srcFit(UN('TreeStump_Moss'), { w: 3.4, d: 3.4, sat: 0.2, recolor: { Wood: '#8A5A35', LightWood: '#E2C08A', Green: '#5E9E3A' } })],
};
for (const [id, [size, build]] of Object.entries(DEBRIS)) {
  job(`debris:${id}`, 'debris/debris.glb', { family: 'debris', def: id, footprint: size }, async () => { const g = await build(); return g.getAttribute('sway') ? g : sway(g, { rigid: true }); });
}

// World props for the decorative ring and dressing (render-world: forest wall, hills, signposts, overflow).
const PROPS = {
  forest_round_1: () => fruitTreeLike('#4C9A3E', 1, 11), forest_round_2: () => fruitTreeLike('#3F8A3A', 1.2, 12), forest_round_3: () => fruitTreeLike('#5BAA45', 0.85, 13),
  forest_pine_1: () => pineTree('mature'), forest_pine_2: () => xform(pineTree('young'), { s: 1.3 }),
  bush_1: () => xform(blob(0.7, '#4C9A3E', { seed: 21, sy: 0.75, flatBottom: 0.5 }), { y: 0.45 }),
  bush_2: () => mergeAll([xform(blob(0.6, '#3F8F36', { seed: 22, sy: 0.8, flatBottom: 0.5 }), { y: 0.4 }), ...[0, 1, 2, 3, 4].map((i) => ball(0.06, '#E83A55', { x: Math.cos(i * 1.3) * 0.5, y: 0.5 + (i % 2) * 0.2, z: Math.sin(i * 1.3) * 0.5 }, 0))]),
  rock_1: async () => srcFit(UN('Rock_1'), { w: 1.2, d: 1.2, sat: 0.1, recolor: { Rock: '#A7A39A' } }),
  rock_2: async () => srcFit(UN('Rock_Moss_1'), { w: 1.6, d: 1.6, sat: 0.1, recolor: { Rock: '#A7A39A', Green: '#5E9E3A' } }),
  grass_tuft: () => { const r = rng('grass'); const parts = []; for (let i = 0; i < 7; i++) parts.push(xform(leaf(0.35 + r() * 0.2, 0.06, i % 2 ? '#6BB040' : '#5A9E38', { bend: 0.5 }), { ry: r() * 6.28, x: (r() - 0.5) * 0.15, z: (r() - 0.5) * 0.15 })); return sway(mergeAll(parts), { y1: 0.5 }); },
  flower_tuft: () => sway(flowerClump(rng('ft'), ['#FF7A9C', '#FFFFFF', '#FFD21F', '#A98BE0']), { y1: 0.45 }),
  reeds: () => { const parts = []; for (let i = 0; i < 9; i++) parts.push(xform(cyl(0.02, 0.03, 0.9 + (i % 3) * 0.25, 4, '#5C8A3A', {}, 0), { x: (i % 3) * 0.15 - 0.15, z: Math.floor(i / 3) * 0.15 - 0.15, rz: ((i % 2) - 0.5) * 0.25 })); return sway(mergeAll(parts), { y1: 1.4 }); },
  lilypad: async () => { const g = await srcFit(UN('Lilypad'), { w: 1.2, d: 1.2, sat: 0.2 }); return tris(g) > 120 ? simplify(g, 110 / tris(g), { error: 0.05 }) : g; },
  signpost_sale: () => mergeAll([cyl(0.06, 0.07, 1.6, 6, WOOD_D), box(1.0, 0.6, 0.08, WOOD, { y: 1.0 }), xform(cyl(0.2, 0.2, 0.05, 16, '#FFC83D'), { rx: Math.PI / 2, y: 1.3, z: 0.06 }),
    xform(box(0.06, 0.24, 0.02, '#B8860B'), { y: 1.18, z: 0.1 })]),
  crate_stack: () => mergeAll([crate(0.7), xform(crate(0.7), { x: 0.75 }), xform(crate(0.7), { x: 0.35, y: 0.7, ry: 0.2 })]),
  mailbox: () => mergeAll([cyl(0.05, 0.06, 1.1, 6, WOOD_D), xform(P(new THREE.CapsuleGeometry(0.18, 0.4, 3, 10), '#4AA8E8', { creaseDeg: 60 }), { rx: Math.PI / 2, y: 1.2 }), box(0.04, 0.25, 0.12, '#E84A3A', { x: 0.2, y: 1.35, z: 0.1 })]),
  hay_bale: () => hayBale(),
  sack: () => sack(),
  barrel: () => barrel(),
  crate: () => crate(0.7),
  milk_can: () => milkCan(),
  trough: () => trough(),
  // wave 3: the Fishing Dock's cosmetic catches (render-world stands one per trophy on the dock)
  fish_trophy: () => fishTrophy('#7FA6B8'), fish_trophy_gold: () => fishTrophy('#E9B13A', '#FFE58A'), fish_trophy_koi: () => fishTrophy('#F28C1E', '#FFF8EC'),
  // wave 3: the balloon on its own (ambient-life flies it over the farm; the decor is the moored one on its green)
  balloon: () => flyingBalloon(),
};
function fruitTreeLike(leafHex, k, seed) {
  TREES.__forest = { leaf: leafHex, fruit: '#000', fruitR: 0, fruitN: 0, canopy: [1.05 * k, 1.0, 1.05 * k], trunk: 1.2 * k, lean: 0.05, blobs: 7 };
  const g = fruitTree('__forest', 'mature');
  delete TREES.__forest;
  void seed;
  return xform(g, { s: 1.15 });
}
for (const [id, build] of Object.entries(PROPS)) {
  job(`prop:${id}`, 'props/props.glb', { family: 'prop', def: `prop_${id}`, footprint: [1, 1] }, async () => { const g = await build(); return g.getAttribute('sway') ? g : sway(g, { rigid: true }); });
}

// ---------------------------------------------------------------------------------------------------
// 13b. M1b places (wave 2): the restored greenhouse (a ground-layer landmark the 12 plots stand in), the three
//      restoration sites in their stages (render-world's restoration-view: 0 = ruin, 1-3 = one more bundle done,
//      scaffolding and new work, 4 = restored), the village landmarks of Town Projects 1-4 with plain cottages and a
//      building site, Captain Reed's barge with its jetty and crates, the County Fair tent, and Masterwork borders.
const WHITE = '#F6F2E8';
/** Scaffolding: poles and planks along x (w) and z (d) up to height h, around a work area. */
function scaffold(w, d, h, { side = 'front' } = {}) {
  const parts = [];
  const zs = side === 'front' ? [d / 2] : side === 'back' ? [-d / 2] : [-d / 2, d / 2];
  for (const z of zs) {
    const n = Math.max(2, Math.round(w / 1.6));
    for (let i = 0; i <= n; i++) for (const dz of [0, 0.7 * Math.sign(z || 1)]) parts.push(cyl(0.035, 0.035, h, 4, '#B9824A', { x: -w / 2 + (w * i) / n, z: z + dz }, 0));
    for (let y = 0.9; y < h; y += 0.9) {
      parts.push(box(w + 0.2, 0.06, 0.06, '#B9824A', { y, z }), box(w + 0.2, 0.06, 0.06, '#B9824A', { y, z: z + 0.7 * Math.sign(z || 1) }));
      parts.push(box(w, 0.04, 0.6, '#D9B97A', { y: y + 0.06, z: z + 0.35 * Math.sign(z || 1) }));
    }
    parts.push(xform(box(0.04, Math.hypot(w, h), 0.04, '#9A6A3A'), { rz: Math.atan2(w, h), y: 0, z: z + 0.7 * Math.sign(z || 1), x: 0 }));
  }
  return mergeAll(parts);
}
/** A pile of timber and a crate of glass (a building site's dressing). */
function sitePile(seed = 1) {
  const r = rng(`pile${seed}`);
  const parts = [];
  for (let i = 0; i < 5; i++) parts.push(box(1.6, 0.1, 0.18, i % 2 ? '#C99A5A' : '#B9824A', { y: Math.floor(i / 3) * 0.1, z: (i % 3) * 0.2 - 0.2, ry: (r() - 0.5) * 0.1 }));
  parts.push(xform(crate(0.55), { x: 1.1 }), xform(mergeAll([box(0.5, 0.4, 0.06, '#BFE3EA'), box(0.5, 0.4, 0.06, '#CFEAF2', { z: 0.08 })]), { x: 1.1, y: 0.55, rx: 0.2 }));
  return mergeAll(parts);
}
/** Weeds and vines on a ruin. */
function ruinGreen(r, n, w, d) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(xform(flowerClump(r, ['#FFFFFF', '#FFD21F'], 2, 0.35), { x: (r() - 0.5) * w, z: (r() - 0.5) * d, s: 0.9 + r() * 0.6 }));
  return parts;
}

// The restored Old Greenhouse (def greenhouse, 6 x 4 tiles, ground layer): brick knee walls, white posts, an open
// rafter roof (the plots inside must stay visible from every camera yaw), glazed gable ends and a ridge crest.
function greenhouseFrame({ stage = 4 } = {}) {
  const W = 11.4; const D = 7.4; const eave = 2.25; const ridge = 3.5;
  const r = rng(`gh${stage}`);
  const parts = [];
  if (stage >= 4) parts.push(box(W + 0.2, 0.025, D + 0.2, '#D9CDB4', { y: 0.005 }));
  // knee walls (a door gap at the front); the ruin has broken runs
  const wall = (len, x, z, ry) => {
    if (stage === 0) {
      const out = [];
      const n = 4;
      for (let k = 0; k < n; k++) { if (r() < 0.3) continue; const h = 0.15 + r() * 0.35; out.push(xform(box(len / n - 0.05, h, 0.24, K.brick), { x: -len / 2 + (len / n) * (k + 0.5) })); }
      return xform(mergeAll(out.length ? out : [box(0.3, 0.2, 0.24, K.brick)]), { x, z, ry });
    }
    return xform(mergeAll([courses(box(len, 0.45, 0.24, K.brick), 3), box(len + 0.04, 0.06, 0.3, K.stone, { y: 0.45 })]), { x, z, ry });
  };
  parts.push(wall(W, 0, -D / 2, 0), wall(D, -W / 2, 0, Math.PI / 2), wall(D, W / 2, 0, Math.PI / 2), wall(W / 2 - 1.0, -W / 4 - 0.5, D / 2, 0), wall(W / 2 - 1.0, W / 4 + 0.5, D / 2, 0));
  // posts every ~1.9 m
  const nx = 6; const nz = 4;
  const posts = [];
  for (let i = 0; i <= nx; i++) for (const z of [-D / 2, D / 2]) posts.push([-W / 2 + (W * i) / nx, z]);
  for (let j = 1; j < nz; j++) for (const x of [-W / 2, W / 2]) posts.push([x, -D / 2 + (D * j) / nz]);
  for (const [x, z] of posts) {
    if (stage === 0) { if (r() < 0.55) continue; parts.push(xform(box(0.1, eave * (0.5 + r() * 0.5), 0.1, WHITE), { x, z, rz: (r() - 0.5) * 0.5, rx: (r() - 0.5) * 0.4 })); continue; }
    parts.push(box(0.14, eave, 0.14, WHITE, { x, z }));
  }
  if (stage >= 2 || stage === 0) {
    // top plates
    if (stage >= 2) for (const z of [-D / 2, D / 2]) parts.push(box(W + 0.16, 0.14, 0.16, WHITE, { y: eave, z }));
    if (stage >= 2) for (const x of [-W / 2, W / 2]) parts.push(box(0.16, 0.14, D + 0.16, WHITE, { x, y: eave }));
  }
  // RD-15 (QA wave 2: "the ruin shows no panes per stage"): the wall glazing comes back bundle by bundle: a few
  // cracked panes on the ruin, then 35 / 60 / 85 % of the bays (the restored greenhouse is a separate glass part)
  if (stage < 4) {
    const share = [0.2, 0.35, 0.6, 0.85][stage];
    const bays = [];
    for (let i = 0; i < nx; i++) for (const z of [-D / 2, D / 2]) bays.push({ x: -W / 2 + (W * (i + 0.5)) / nx, z, w: W / nx - 0.18, ry: 0, front: z > 0 && (i === 2 || i === 3) });
    for (let j = 0; j < nz; j++) for (const x of [-W / 2, W / 2]) bays.push({ x, z: -D / 2 + (D * (j + 0.5)) / nz, w: D / nz - 0.18, ry: Math.PI / 2, front: false });
    const pr = rng(`ghpane${stage}`);
    for (const b of bays) {
      if (b.front || pr() > share) continue;
      const h = stage === 0 ? 0.5 + pr() * 0.8 : eave - 0.62;
      parts.push(xform(box(b.w, h, 0.03, pr() < 0.5 ? '#CFEAF2' : '#BFE3EA'), { x: b.x, y: 0.52, z: b.z, ry: b.ry, rz: stage === 0 ? (pr() - 0.5) * 0.2 : 0 }));
    }
  }
  const slope = Math.atan2(ridge - eave, D / 2); const raft = Math.hypot(ridge - eave, D / 2) + 0.25;
  const rafterAt = (x, z0) => { const g = box(0.08, 0.1, raft, WHITE); g.translate(0, 0, -raft / 2 + 0.25 * 0.5); xform(g, { rx: -Math.sign(z0) * slope }); return xform(g, { x, y: eave, z: z0 + Math.sign(z0) * 0.12 }); };
  const rafters = stage >= 4 ? nx + 1 : stage === 3 ? nx + 1 : stage === 2 ? Math.ceil((nx + 1) / 2) : 0;
  for (let i = 0; i < rafters; i++) {
    const x = -W / 2 + (W * i) / nx;
    for (const z0 of [-D / 2, D / 2]) {
      // a rafter from the eave to the ridge, pointing inward and up
      const g = box(0.11, 0.11, raft, WHITE);
      g.translate(0, 0, raft / 2);
      xform(g, { rx: -slope });
      xform(g, { ry: Math.sign(z0) > 0 ? Math.PI : 0, x, y: eave, z: z0 });
      parts.push(g);
    }
  }
  void rafterAt;
  if (stage >= 3) {
    parts.push(box(W + 0.3, 0.12, 0.14, WHITE, { y: ridge - 0.04 }));
    for (const z0 of [-1, 1]) for (const t of [0.35, 0.7]) parts.push(box(W, 0.06, 0.06, WHITE, { y: eave + (ridge - eave) * t, z: z0 * (D / 2) * (1 - t) }));
    // glazed gable ends
    for (const x0 of [-W / 2, W / 2]) {
      const tri = new THREE.Shape(); tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(0, ridge - eave); tri.closePath();
      const gg = P(new THREE.ExtrudeGeometry(tri, { depth: 0.04, bevelEnabled: false }), '#CFEAF2');
      parts.push(xform(gg, { ry: Math.PI / 2, x: x0 + 0.02, y: eave }));
      parts.push(xform(box(0.06, ridge - eave, 0.06, WHITE), { x: x0, y: eave }));
    }
  }
  if (stage >= 4) {
    // the crest, finials, the arched door frame, a little sign and two planters at the door
    for (let i = 0; i < 12; i++) parts.push(xform(P(new THREE.ConeGeometry(0.05, 0.16, 4), WHITE), { x: -W / 2 + 0.5 + i * ((W - 1) / 11), y: ridge + 0.1 }));
    for (const x0 of [-W / 2, W / 2]) parts.push(xform(mergeAll([cyl(0.05, 0.05, 0.3, 6, WHITE), ball(0.09, '#E9B13A', { y: 0.36 }, 0)]), { x: x0, y: ridge + 0.02 }));
    const arch = new THREE.Shape(); arch.moveTo(-0.95, 0); arch.lineTo(-0.95, 1.9); arch.absarc(0, 1.9, 0.95, Math.PI, 0, true); arch.lineTo(0.95, 0); arch.lineTo(0.8, 0); arch.lineTo(0.8, 1.9); arch.absarc(0, 1.9, 0.8, 0, Math.PI, false); arch.lineTo(-0.8, 0); arch.closePath();
    parts.push(xform(P(new THREE.ExtrudeGeometry(arch, { depth: 0.1, bevelEnabled: false, curveSegments: 6 }), WHITE), { z: D / 2 - 0.05 }));
    // climbing roses on the door frame (inside the 6 x 4 footprint: the plots and the neighbours need the edge)
    const rr = rng('gh-roses');
    for (let i = 0; i < 10; i++) { const a = (i / 9) * Math.PI; parts.push(xform(blob(0.13, '#4C9A3E', { seed: i, detail: 0 }), { x: Math.cos(a) * 0.95, y: 1.9 + Math.sin(a) * 0.95, z: D / 2 + 0.06 }), ball(0.06, rr() < 0.5 ? '#E83A55' : '#FF9FB0', { x: Math.cos(a) * 0.95 + 0.05, y: 1.95 + Math.sin(a) * 0.95, z: D / 2 + 0.14 }, 0)); }
  }
  if (stage === 0) {
    // fallen rafters, shards of glass, weeds and a vine
    for (let i = 0; i < 5; i++) parts.push(xform(box(0.08, 0.08, 2.4 + r(), WHITE), { x: (r() - 0.5) * W * 0.8, y: 0.05, z: (r() - 0.5) * D * 0.6, ry: r() * 3, rz: 0.08 }));
    for (let i = 0; i < 10; i++) parts.push(xform(box(0.3 + r() * 0.3, 0.02, 0.2 + r() * 0.2, '#CFEAF2'), { x: (r() - 0.5) * W * 0.8, y: 0.02, z: (r() - 0.5) * D * 0.7, ry: r() * 3 }));
    parts.push(...ruinGreen(r, 9, W * 0.85, D * 0.8));
  } else if (stage < 4) {
    parts.push(xform(scaffold(4.2, 1.2, stage >= 2 ? 3.2 : 2.2), { x: -2.6, z: D / 2 + 0.2 }), xform(sitePile(stage), { x: 3.4, z: D / 2 + 1.0 }));
    if (stage === 1) parts.push(...ruinGreen(r, 3, W * 0.8, D * 0.6));
  }
  return mergeAll(parts);
}
job('building:greenhouse', 'buildings/greenhouse.glb', { family: 'building', def: 'greenhouse', footprint: [6, 4], layer: 'ground' }, async () => sway(greenhouseFrame({ stage: 4 }), { rigid: true }));
// the glazing as its own part, for a see-through glass material (the opaque frame keeps the plots visible without it)
job('building:greenhouse:glass', 'buildings/greenhouse.glb', { family: 'building', footprint: [6, 4], part: true, glass: true }, async () => {
  const W = 11.4; const D = 7.4; const eave = 2.25; const ridge = 3.5;
  const slope = Math.atan2(ridge - eave, D / 2); const raft = Math.hypot(ridge - eave, D / 2);
  const parts = [];
  for (const z0 of [-1, 1]) { const g = box(W, 0.02, raft, '#CFEAF2'); g.translate(0, 0, raft / 2); xform(g, { rx: -slope }); xform(g, { ry: z0 > 0 ? Math.PI : 0, y: eave, z: z0 * D / 2 }); parts.push(g); }
  for (const z0 of [-1, 1]) parts.push(box(W, eave - 0.5, 0.02, '#CFEAF2', { y: 0.5, z: z0 * D / 2 }));
  for (const x0 of [-1, 1]) parts.push(box(0.02, eave - 0.5, D, '#CFEAF2', { y: 0.5, x: x0 * W / 2 }));
  return sway(mergeAll(parts), { rigid: true });
});
for (let st = 0; st < 4; st++) job(`restore:greenhouse:${st}`, 'restore/greenhouse.glb', { family: 'restore', footprint: [6, 4], stage: st }, async () => sway(greenhouseFrame({ stage: st }), { rigid: true }));

// The Mill Wheel (restoration 2): a stone mill house by the water with an undershot wheel on its +x side; the
// restored wheel is its own part (spins about local +x at info.pivot, like the windmill sails).
const WHEEL = { x: 2.15, y: 1.25, R: 1.25, w: 0.55 };
function millWheelGeo({ broken = 0 } = {}) {
  const r = rng(`wheel${broken}`);
  const parts = [];
  const n = 12;
  for (const sx of [-1, 1]) parts.push(xform(torus(WHEEL.R, 0.06, '#8E5A34', {}, 4, 20), { ry: Math.PI / 2, x: sx * WHEEL.w / 2 }));
  for (let k = 0; k < n; k++) {
    if (broken && r() < broken) continue;
    const a = (k / n) * Math.PI * 2;
    // paddles on the rim and spokes through the hub: built in place, then turned about the axle (x)
    parts.push(xform(box(WHEEL.w, 0.45, 0.08, '#A8713A', { y: WHEEL.R - 0.42 }), { rx: a }));
    if (k % 2 === 0) for (const sx of [-1, 1]) parts.push(xform(box(0.05, WHEEL.R * 2 - 0.1, 0.06, '#8E5A34', { x: sx * WHEEL.w / 2, y: -WHEEL.R + 0.05 }), { rx: a }));
  }
  parts.push(xform(cyl(0.12, 0.12, WHEEL.w + 0.4, 8, K.iron, {}, 40), { rz: Math.PI / 2, x: -(WHEEL.w + 0.4) / 2 }));
  return mergeAll(parts);
}
function millHouse({ stage = 4 } = {}) {
  // RD-06 (QA wave 2: "mill stages 1-3 are the same silhouette"): every bundle changes the outline.
  //   0 the ruin: low broken walls, no roof, the wheel fallen half into the race, rubble and weeds
  //   1 a new stone foundation course and the wheel's timber supports; the old wheel lies on the bank
  //   2 the walls and the whole roof are back (scaffold on the front); the supports wait for a wheel
  //   3 a new wheel, the flume (chute) bringing water to it and a porch over the door; a ladder left
  //   4 the scaffold is gone: sacks, barrels, a hand cart, the MILL sign, a lantern and smoke-ready chimney
  //     (the restored wheel turns: its own part, restore:mill_wheel:wheel; render-world splashes the ripples)
  const r = rng(`mill${stage}`);
  const W = 3.4; const D = 3.0; const H = 2.3;
  const parts = [];
  const plinth = stage >= 1 ? 0.45 : 0.3;
  if (stage >= 1) parts.push(box(W + 0.7, 0.45, D + 0.7, K.stoneD), box(W + 0.82, 0.07, D + 0.82, K.stone, { y: 0.45 }));
  if (stage >= 2) {
    parts.push(xform(timberHouse(W, H, D, { plaster: '#D8CDB8' }), { y: plinth - 0.3 }), xform(doorBox(0.8, 1.5), { x: -0.6, y: plinth, z: D / 2 + 0.03 }),
      xform(windowBox(0.6, 0.6, { shutters: '#5B7E99' }), { x: 0.75, y: plinth + 0.9, z: D / 2 + 0.03 }));
    parts.push(xform(pitchedRoof(W, D, 1.3, stage >= 4 ? '#4F6E8A' : '#5B7E99', { oh: 0.28 }), { y: plinth + H }));
    parts.push(xform(stack(1.1, 0.42), { x: -0.9, y: plinth + H + 0.45, z: -0.5 }));
  } else {
    // broken walls: a stone base and ragged plaster stubs, a fallen corner
    parts.push(box(W + 0.16, 0.3, D + 0.16, K.stoneD, { y: stage >= 1 ? 0.45 : 0 }));
    const y0 = stage >= 1 ? 0.75 : 0.3;
    for (const [w, d, x, z, h] of [[W, 0.16, 0, -D / 2, 1.5], [0.16, D, -W / 2, 0, 1.2], [0.16, D * 0.6, W / 2, -D * 0.2, 0.9], [W * 0.45, 0.16, -W * 0.27, D / 2, 0.8]]) {
      parts.push(box(w, h, d, '#D8CDB8', { x, y: y0, z }));
      for (let k = 0; k < 3; k++) parts.push(box(0.3 + r() * 0.3, 0.2 + r() * 0.3, 0.2, '#D8CDB8', { x: x + (d > w ? 0 : (r() - 0.5) * w * 0.8), y: y0 + h, z: z + (d > w ? (r() - 0.5) * d * 0.8 : 0) }));
    }
    for (const [x, z] of [[-W / 2, -D / 2], [-W / 2, D / 2]]) parts.push(box(0.14, 1.9, 0.14, K.timber, { x, y: y0, z }));
    for (let i = 0; i < 6; i++) parts.push(xform(box(0.4 + r() * 0.3, 0.25, 0.3, K.stone), { x: W / 2 + 0.3 + r() * 0.8, z: D / 2 - r() * 1.8, ry: r() * 3 }));
    if (stage === 0) for (let i = 0; i < 3; i++) parts.push(xform(box(0.08, 0.1, 2.0, '#8E5A34'), { x: -W / 2 + 0.6 + i * 1.0, y: 0.3, z: 0.2, rx: 0.12 + r() * 0.2, ry: (r() - 0.5) * 0.5 }));
    if (stage === 1) for (let i = 0; i < 4; i++) parts.push(xform(box(0.1, 0.1, 2.2, '#C99A5A'), { x: -W / 2 - 1.0, y: 0.06 + (i % 2) * 0.1, z: -0.8 + i * 0.25 }));
  }
  // the wheel's supports (from stage 1): two stout frames either side of the wheel pit, the bearing blocks on top
  if (stage >= 1) {
    for (const sx of [-1, 1]) for (const z of [-0.5, 0.5]) parts.push(box(0.16, WHEEL.y + 0.2, 0.16, '#7A4B2C', { x: WHEEL.x + sx * (WHEEL.w / 2 + 0.25), z }));
    for (const sx of [-1, 1]) parts.push(box(0.36, 0.22, 1.2, '#7A4B2C', { x: WHEEL.x + sx * (WHEEL.w / 2 + 0.25), y: WHEEL.y + 0.1 }));
    parts.push(box(1.2, 0.5, 2.2, K.stoneD, { x: WHEEL.x, z: 0 }));
  }
  // the wheel: fallen into the race (0), lying broken on the bank (1), none (2), new and still (3); 4 is the turning part
  if (stage === 0) parts.push(xform(millWheelGeo({ broken: 0.55 }), { x: WHEEL.x + 0.2, y: WHEEL.y - 0.4, rx: 0.25, rz: 0.35 }));
  if (stage === 1) {
    // lying on the bank beside the house, waiting for the millwright
    const lw = xform(millWheelGeo({ broken: 0.45 }), { rz: Math.PI / 2 - 0.12 });
    const bb = bounds(lw);
    parts.push(lw.translate(-W / 2 - 1.9, -bb.min.y + 0.01, 1.6));
  }
  if (stage === 3) parts.push(xform(millWheelGeo(), { x: WHEEL.x, y: WHEEL.y }));
  // the flume (chute) bringing water to the wheel: from stage 3
  if (stage >= 3) {
    const fy = WHEEL.y + WHEEL.R + 0.15;
    parts.push(box(0.9, 0.12, 4.6, '#8E5A34', { x: WHEEL.x, y: fy, z: -1.4 }), box(0.06, 0.3, 4.6, '#8E5A34', { x: WHEEL.x - 0.45, y: fy, z: -1.4 }), box(0.06, 0.3, 4.6, '#8E5A34', { x: WHEEL.x + 0.45, y: fy, z: -1.4 }));
    parts.push(box(0.8, 0.04, 4.5, '#6FB7D0', { x: WHEEL.x, y: fy + 0.12, z: -1.4 }));
    for (const z of [-3.2, -1.8]) parts.push(box(0.12, fy, 0.12, '#7A4B2C', { x: WHEEL.x + 0.5, z }), box(0.12, fy, 0.12, '#7A4B2C', { x: WHEEL.x - 0.5, z }));
    // the porch over the door: two posts and a little lean-to roof
    parts.push(...[-1.25, 0.05].map((x) => box(0.1, 1.9, 0.1, K.timber, { x, y: plinth, z: D / 2 + 1.0 })));
    parts.push(xform(box(1.8, 0.1, 1.3, '#5B7E99'), { x: -0.6, y: plinth + 2.0, z: D / 2 + 0.55, rx: 0.3 }));
  }
  if (stage === 2) parts.push(xform(scaffold(3.2, 1.0, 3.2), { z: D / 2 + 0.1 }), xform(sitePile(12), { x: -1.8, z: 2.6, s: 0.8 }));
  if (stage === 3) parts.push(xform(mergeAll([...[-0.22, 0.22].map((x) => box(0.06, 2.6, 0.06, K.timberL, { x })), ...[0.4, 0.9, 1.4, 1.9, 2.4].map((y) => box(0.44, 0.05, 0.06, K.timberL, { y }))]), { x: W / 2 + 0.1, z: D / 2 - 0.2, rx: -0.25 }));
  if (stage === 1) parts.push(xform(sitePile(11), { x: -1.8, z: 2.6, s: 0.8 }));
  if (stage === 0) { parts.push(...ruinGreen(r, 6, 5, 4)); for (let i = 0; i < 3; i++) parts.push(xform(box(0.5, 0.06, 0.1, '#A8713A'), { x: WHEEL.x + (r() - 0.5) * 2, y: 0.04, z: 1.2 + r(), ry: r() * 3 })); }
  if (stage >= 4) {
    // the working mill: flour sacks by the door, two barrels, a hand cart, the MILL sign, a lantern, window boxes
    parts.push(xform(sack('#E8D9AE'), { x: -1.6, z: D / 2 + 0.5 }), xform(sack(), { x: -1.25, z: D / 2 + 0.75, ry: 1 }), xform(sack('#F2E6C6'), { x: -1.45, y: 0.4, z: D / 2 + 0.6, ry: 0.4 }));
    parts.push(xform(barrel(0.8), { x: 1.3, z: D / 2 + 0.6 }), xform(barrel(0.7), { x: 1.75, z: D / 2 + 0.2 }));
    const cart = mergeAll([box(1.1, 0.35, 0.7, K.timberL, { y: 0.35 }), ...[-1, 1].map((sd) => xform(torus(0.28, 0.04, K.timber, {}, 4, 10), { x: 0.1, y: 0.3, z: sd * 0.4 })), box(0.06, 0.06, 0.9, K.timber, { x: -0.9, y: 0.5, rz: 0.3 }), xform(sack(), { y: 0.7, s: 0.8 })]);
    parts.push(xform(cart, { x: -W / 2 - 1.2, z: 0.8, ry: 0.5 }));
    parts.push(xform(mergeAll([signBoard(1.1, 0.42, '#FFF8EC', K.timber), box(0.14, 0.12, 0.09, '#5B7E99', { x: -0.38, y: 0.16 }), box(0.14, 0.12, 0.09, '#5B7E99', { x: -0.12, y: 0.16 }), box(0.14, 0.12, 0.09, '#5B7E99', { x: 0.14, y: 0.16 }), box(0.14, 0.12, 0.09, '#5B7E99', { x: 0.38, y: 0.16 })]), { y: plinth + H - 0.2, z: D / 2 + 0.08 }));
    parts.push(xform(lampPost(1.9), { x: 0.6, z: D / 2 + 1.3 }), xform(flowerBox(0.7), { x: 0.75, y: plinth + 0.8, z: D / 2 + 0.12 }));
  }
  return mergeAll(parts);
}
// the mill stands on the bank with its wheel pit in the race (render-world sets it down the bank): a water prop
for (let st = 0; st <= 4; st++) job(`restore:mill_wheel:${st}`, 'restore/mill_wheel.glb', { family: 'restore', footprint: [3, 3], stage: st, water: true }, async () => sway(millHouse({ stage: st }), { rigid: true }));
job('restore:mill_wheel:wheel', 'restore/mill_wheel.glb', { family: 'restore', footprint: [3, 3], part: true, axis: 'x', pivot: [WHEEL.x, WHEEL.y, 0] }, async () => sway(millWheelGeo(), { rigid: true }));

// The Stone Bridge (restoration 3): an arched stone bridge 12 m along x with parapets; 0 = the arch fallen in.
/**
 * The Stone Bridge (Restoration, M1b): 22 m along x over the river at the lane crossing (render-world: ~14 m of water
 * between ~22 m of banks), the deck 0.5 m above the bank at both ends rising to 1.6 m over mid-river. Three arches:
 * a wide one over the channel, a small one either side, on two piers with cut-waters. Stages 0-1: the middle of the
 * big arch has fallen into the river and wooden planks are laid over the gap (the lane crosses all the same); 1 adds
 * the timber centring; 2 the arch is back, the planks still over its raw top; 3 the parapets go back up; 4 restored,
 * paved, with lanterns. Bank at y = 0, water at about -0.45 (manifest `water`: it stands in the river).
 */
export const BRIDGE = Object.freeze({ L: 22, W: 4.4, end: 0.5, crown: 1.6, piers: [3.2, 4.2], side: [4.2, 6.6], gapHalf: 2.2 });
function bridgeDeckY(x) {
  const { L, end, crown } = BRIDGE;
  return end + (crown - end) * Math.cos((Math.PI * Math.min(Math.abs(x), L / 2)) / L) ** 1.3;
}
/** The underside of the bridge at x: the arch intrados over the water, the piers and abutments going down. */
function bridgeUnder(x) {
  const a = Math.abs(x); const [p0, p1] = BRIDGE.piers; const [s0, s1] = BRIDGE.side;
  if (a >= s1) return -0.8;
  if (a >= s0) { const c = (s0 + s1) / 2; const rx = (s1 - s0) / 2; return -0.45 + 0.9 * Math.sqrt(Math.max(0, 1 - ((a - c) / rx) ** 2)); }
  if (a >= p0) return -2.0;
  return -0.45 + 1.55 * Math.sqrt(Math.max(0, 1 - (a / p0) ** 2));
}
/** One extruded slice of the bridge body between x0 < x1 (deck on top, the underside below). */
function bridgeSlice(x0, x1) {
  const { W } = BRIDGE;
  const sh = new THREE.Shape();
  const xs = [];
  const n = Math.max(2, Math.ceil((x1 - x0) / 0.25));
  for (let i = 0; i <= n; i++) xs.push(x0 + ((x1 - x0) * i) / n);
  sh.moveTo(x0, bridgeUnder(x0 + 1e-4));
  for (const x of xs) sh.lineTo(x, bridgeDeckY(x));
  // the underside back from x1 to x0, with both sides of every step (arch springing to pier foot)
  const steps = [-6.6, -4.2, -3.2, 3.2, 4.2, 6.6].filter((b) => b > x0 && b < x1);
  const under = [];
  for (const x of xs) under.push(x);
  for (const b of steps) under.push(b - 1e-4, b + 1e-4);
  under.sort((a, b) => b - a);
  for (const x of under) sh.lineTo(x, bridgeUnder(Math.min(x1 - 1e-4, Math.max(x0 + 1e-4, x))));
  sh.closePath();
  const g = P(new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false, curveSegments: 1 }), K.stone, { creaseDeg: 40 });
  return xform(g, { z: -W / 2 });
}
function stoneBridge({ stage = 4 } = {}) {
  const r = rng(`bridge${stage}`);
  const { L, W, gapHalf } = BRIDGE;
  const broken = stage <= 1;
  const slices = broken ? [[-L / 2, -gapHalf], [gapHalf, L / 2]] : [[-L / 2, -gapHalf], [-gapHalf, gapHalf], [gapHalf, L / 2]];
  let body = mergeAll(slices.map(([a, b]) => bridgeSlice(a, b)));
  body = courses(body, 9, [0.9, 1.0, 1.08]);
  body = capColor(body, stage === 4 ? '#A0978A' : '#B3AA9C', { k: 0.9, from: 0.6, to: 0.9 });  // the deck reads darker than the walls
  const parts = [body];
  // the broken ends of the fallen arch: jagged blocks sticking out of the stubs
  if (broken) for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
    const y = bridgeDeckY(gapHalf) - 0.3 - i * 0.38;
    parts.push(xform(box(0.5 + r() * 0.4, 0.34, 0.9 + r() * 0.6, i % 2 ? K.stoneD : K.stone), { x: sx * (gapHalf + 0.1 + r() * 0.15), y, z: (r() - 0.5) * (W - 1), ry: (r() - 0.5) * 0.4 }));
  }
  // arch rings of dressed stones on both faces (the big one once it is rebuilt)
  const ring = (cx, rx, ry, n) => {
    for (const z of [-W / 2 - 0.03, W / 2 + 0.03]) for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI;
      const ex = Math.cos(a) * (rx + 0.16); const ey = -0.45 + Math.sin(a) * (ry + 0.16);
      if (broken && Math.abs(cx + ex) < gapHalf + 0.2) continue;
      parts.push(xform(box(0.4, 0.3, 0.08, k % 2 ? '#C9C1B2' : '#A9A196'), { x: cx + ex, y: ey, z, rz: Math.atan2(Math.sin(a) * rx, Math.cos(a) * ry) - Math.PI / 2 }));
    }
  };
  ring(0, 3.2, 1.55, 14);
  ring(-5.4, 1.2, 0.9, 7);
  ring(5.4, 1.2, 0.9, 7);
  // cut-waters on the piers, upstream and downstream
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(xform(P(new THREE.CylinderGeometry(0, 0.72, 2.0, 4, 1), K.stoneD, { creaseDeg: 0 }), { x: sx * 3.7, y: -1.3, z: sz * (W / 2 + 0.25), ry: Math.PI / 4, sz: 0.7 }));
  }
  // parapets following the deck, with capstones (crumbled where the arch fell, missing over the raw new arch)
  const segs = 22;
  for (const z of [-W / 2 + 0.15, W / 2 - 0.15]) for (let i = 0; i < segs; i++) {
    const x0 = -L / 2 + (L * i) / segs; const x1 = x0 + L / segs; const xm = (x0 + x1) / 2;
    if (stage <= 2 && Math.abs(xm) < gapHalf + (stage === 0 ? 1.0 : 0.3)) continue;
    if (stage === 0 && r() < 0.3) continue;
    const y0 = bridgeDeckY(x0); const y1 = bridgeDeckY(x1);
    const len = Math.hypot(x1 - x0, y1 - y0);
    parts.push(xform(mergeAll([box(len + 0.02, 0.55, 0.28, K.stoneD), box(len + 0.06, 0.09, 0.36, '#C9C1B2', { y: 0.55 })]), { x: xm, y: (y0 + y1) / 2 - 0.02, z, rz: Math.atan2(y1 - y0, x1 - x0) }));
  }
  if (stage === 0) {
    // the fallen middle lies in the river, with weeds on the stubs
    for (let i = 0; i < 10; i++) parts.push(xform(blob(0.3 + r() * 0.25, i % 3 ? K.stone : K.stoneD, { seed: i, detail: 0, amp: 0.2 }), { x: (r() - 0.5) * 4.2, y: -0.55 + r() * 0.2, z: (r() - 0.5) * W }));
    parts.push(...ruinGreen(r, 6, 3, W - 1).map((g, i) => xform(g, { x: (i % 2 ? 1 : -1) * (gapHalf + 1.2), y: bridgeDeckY(gapHalf + 1.2) })));
  }
  if (stage === 1) {
    // the timber centring that will carry the new arch stones
    for (const z of [-1.3, 0, 1.3]) parts.push(clipBelow(xform(torus(3.0, 0.08, '#B9824A', {}, 4, 16), { y: -0.45, z, sy: 0.5 }), -0.45));
    for (let i = -2; i <= 2; i++) for (const z of [-1.3, 1.3]) {
      const h = 1.5 * Math.sqrt(Math.max(0, 1 - ((i * 1.25) / 3.0) ** 2));
      parts.push(cyl(0.06, 0.06, h + 0.4, 4, '#B9824A', { x: i * 1.25, y: -0.85, z }, 0));
    }
  }
  if (stage >= 1 && stage <= 3) parts.push(xform(scaffold(4.4, 0.8, 2.4), { y: -0.45, z: W / 2 + 0.25 }), xform(sitePile(stage + 20), { x: 9.0, y: bridgeDeckY(9.0) - 0.0, z: W / 2 - 1.2, s: 0.8 }));
  if (stage <= 3) {
    // the plank walkway over the gap (and over the raw top of the new arch): boards across, two stringers, rope rails
    const x0 = -gapHalf - 0.8; const x1 = gapHalf + 0.8; const y = bridgeDeckY(gapHalf + 0.8) + 0.05;
    const n = Math.round((x1 - x0) / 0.34);
    for (let i = 0; i < n; i++) parts.push(box(0.3, 0.08, 2.6, i % 3 === 1 ? '#C99257' : i % 3 ? '#B9814A' : '#D2A066', { x: x0 + 0.17 + i * 0.34, y: y + 0.12, z: 0, ry: (r() - 0.5) * 0.04 }));
    for (const z of [-0.95, 0.95]) parts.push(box(x1 - x0, 0.14, 0.16, '#8A5A35', { x: 0, y: y + 0.01, z }));
    for (const z of [-1.4, 1.4]) {
      for (const x of [x0 + 0.2, 0, x1 - 0.2]) parts.push(cyl(0.05, 0.05, 1.0, 5, '#9C6634', { x, y: y + 0.1, z }, 0));
      parts.push(xform(box(x1 - x0 - 0.3, 0.035, 0.035, '#D9C08A'), { x: 0, y: y + 0.98, z }));
    }
  }
  // newel pillars where the parapets end; restored, each carries a lantern
  for (const sx of [-1, 1]) for (const z of [-W / 2 + 0.15, W / 2 - 0.15]) {
    const x = sx * (L / 2 - 0.3); const y = bridgeDeckY(x);
    parts.push(box(0.5, 0.95, 0.5, K.stoneD, { x, y: y - 0.05, z }), box(0.58, 0.1, 0.58, '#C9C1B2', { x, y: y + 0.9, z }));
    if (stage === 4) {
      parts.push(xform(mergeAll([cyl(0.04, 0.05, 0.5, 6, '#3A3A3A'), box(0.24, 0.28, 0.24, '#FFE08A', { y: 0.5 }), xform(P(new THREE.ConeGeometry(0.2, 0.16, 4), '#3A3A3A'), { y: 0.86, ry: Math.PI / 4 })]),
        { x, y: y + 1.0, z }));
    }
  }
  return mergeAll(parts);
}
/** Flip every triangle whose face normal points toward `centre` (single-sided materials show the outside). */
function outward(g0, centre) {
  const g = g0.index ? g0.toNonIndexed() : g0;
  const p = g.getAttribute('position');
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3(); const n = new THREE.Vector3(); const m = new THREE.Vector3();
  for (let f = 0; f < p.count / 3; f++) {
    a.fromBufferAttribute(p, f * 3); b.fromBufferAttribute(p, f * 3 + 1); c.fromBufferAttribute(p, f * 3 + 2);
    n.subVectors(b, a).cross(m.subVectors(c, a));
    m.copy(a).add(b).add(c).divideScalar(3).sub(centre);
    if (n.dot(m) < 0) for (const attr of Object.values(g.attributes)) {
      const k = attr.itemSize;
      for (let j = 0; j < k; j++) { const t = attr.array[(f * 3 + 1) * k + j]; attr.array[(f * 3 + 1) * k + j] = attr.array[(f * 3 + 2) * k + j]; attr.array[(f * 3 + 2) * k + j] = t; }
    }
  }
  g.computeVertexNormals();
  return g;
}
/** Cut out the middle of a bridge (|x| < half): the fallen arch (stage 0) and the gap under repair (stage 1). */
function clipMiddle(g, half) {
  const src = g.index ? g.toNonIndexed() : g;
  const p = src.getAttribute('position');
  const keep = [];
  for (let f = 0; f < p.count / 3; f++) {
    const cx = (p.getX(f * 3) + p.getX(f * 3 + 1) + p.getX(f * 3 + 2)) / 3;
    if (Math.abs(cx) > half) keep.push(f);
  }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const a = src.getAttribute(name);
    const arr = new Float32Array(keep.length * 3 * a.itemSize);
    keep.forEach((f, i) => arr.set(a.array.subarray(f * 3 * a.itemSize, (f + 1) * 3 * a.itemSize), i * 3 * a.itemSize));
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  return out;
}
for (let st = 0; st <= 4; st++) {
  job(`restore:stone_bridge:${st}`, 'restore/stone_bridge.glb', { family: 'restore', footprint: [11, 2], stage: st, water: true, deck: [BRIDGE.end, BRIDGE.crown] },
    async () => sway(stoneBridge({ stage: st }), { rigid: true }));
}

// ---- The Hollow Village (Town Projects 1-4, M1b): landmarks the village gains, plain cottages, a building site.
// RD-07 (QA wave 2: "the chapel is a tiny red booth, all four barely differs from two"): each landmark has its own
// silhouette seen from across the river (the chapel's belfry and spire, the bandstand's raised two-tier roof, the
// schoolhouse's bell cupola and yard, the ferry's striped canopy and sign), 3-5 props and a few villagers; a project
// under way shows its lower half inside the scaffold (town:construction:<id>).
/** A villager seen from across the river: a coat, a head and a hat or hair (~110 triangles). */
function villager(i, { sit = false } = {}) {
  const coats = ['#C8473A', '#3E6E8E', '#7FB8A0', '#E9B13A', '#8C6AA8', '#5B8C4A'];
  const skin = ['#F2C29A', '#D9A57A', '#B97E58'][i % 3];
  const h = sit ? 0.55 : 0.85;
  const parts = [cyl(0.15, 0.24, h, 6, coats[i % coats.length], {}, 40), ball(0.15, skin, { y: h + 0.13 }, 0)];
  if (i % 2) parts.push(cyl(0.2, 0.2, 0.04, 8, '#5A4A3A', { y: h + 0.22 }, 0), cyl(0.12, 0.13, 0.14, 8, '#5A4A3A', { y: h + 0.24 }, 0));
  else parts.push(xform(ball(0.16, ['#6E4A2E', '#E8C46A', '#2F2A28'][i % 3], { y: h + 0.17, sy: 0.75 }, 0), { z: -0.02 }));
  return mergeAll(parts);
}
function benchGeo(w = 1.4) {
  return mergeAll([box(w, 0.07, 0.4, K.timberL, { y: 0.42 }), box(w, 0.32, 0.06, K.timberL, { y: 0.55, z: -0.18 }),
    ...[-1, 1].map((sd) => box(0.07, 0.42, 0.38, K.timber, { x: sd * (w / 2 - 0.1) }))]);
}
function lampPost(h = 2.2) {
  return mergeAll([cyl(0.05, 0.06, h, 6, '#3A3A3A', {}, 40), box(0.26, 0.3, 0.26, '#FFE08A', { y: h }), xform(P(new THREE.ConeGeometry(0.22, 0.18, 4), '#3A3A3A'), { y: h + 0.39, ry: Math.PI / 4 })]);
}
function yew(h = 2.6) { return mergeAll([cyl(0.08, 0.1, 0.4, 5, '#6E4A2E', {}, 40), xform(cone(0.75, h, 7, '#2F5E36'), { y: 0.25 })]); }

function chapel() {
  const W = 3.6; const D = 5.6; const H = 3.0;
  const parts = [timberHouse(W, H, D, { plaster: '#FBF6EC', braces: false }), xform(pitchedRoof(W, D, 2.3, '#4F6386', { oh: 0.32, gableHex: '#FBF6EC' }), { y: 0.3 + H })];
  // the tower at the front: a tall stone shaft, an open belfry (four posts round the bell) and a slim spire
  const tw = 1.7; const tz = D / 2 + 0.55; const th = H + 2.6;
  parts.push(box(tw, th, tw, '#F3EEE2', { z: tz, y: 0.3 }), box(tw + 0.16, 0.14, tw + 0.16, K.trim, { y: 0.3 + th, z: tz }));
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(box(0.2, 1.1, 0.2, '#F3EEE2', { x: x * (tw / 2 - 0.1), y: 0.44 + th, z: tz + z * (tw / 2 - 0.1) }));
  parts.push(box(tw + 0.2, 0.16, tw + 0.2, K.trim, { y: 1.54 + th, z: tz }));
  parts.push(xform(lathe([[0, 0], [0.24, 0.02], [0.22, 0.2], [0.12, 0.42], [0, 0.46]], 8, '#E9B13A'), { y: 0.62 + th, z: tz }));
  parts.push(xform(cone(tw * 0.78, 3.2, 4, '#4F6386'), { y: 1.7 + th, z: tz, ry: Math.PI / 4 }));
  parts.push(xform(mergeAll([cyl(0.03, 0.03, 0.7, 4, '#E9B13A'), box(0.36, 0.06, 0.06, '#E9B13A', { y: 0.42 })]), { y: 4.85 + th, z: tz }));
  const archW = (w, h, hex = '#7FB8E6') => { const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(-w / 2, h); sh.absarc(0, h, w / 2, Math.PI, 0, true); sh.lineTo(w / 2, 0); sh.closePath(); return P(new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false, curveSegments: 6 }), hex); };
  parts.push(xform(archW(0.7, 0.6), { y: 0.3 + H + 0.9, z: tz + tw / 2 }), xform(archW(1.0, 1.3, '#8C4A3A'), { y: 0.3, z: tz + tw / 2 + 0.02 }));
  for (const z of [-1.6, 0, 1.6]) for (const x of [-1, 1]) parts.push(xform(archW(0.55, 0.9), { x: x * (W / 2 + 0.02), y: 1.1, z, ry: x * Math.PI / 2 }));
  // the churchyard: low stone walls along the sides, two yews, a bench, flowers, villagers at the door
  for (const x of [-1, 1]) parts.push(box(0.35, 0.6, 6.0, K.stone, { x: x * 2.9, z: 0.6 }));
  parts.push(xform(yew(2.8), { x: -2.3, z: tz + 0.3 }), xform(yew(2.4), { x: 2.3, z: tz - 0.1 }), xform(benchGeo(1.3), { x: 2.25, z: -1.2, ry: -Math.PI / 2 }));
  parts.push(...[-1.3, 1.3].map((x) => xform(flowerClump(rng(`ch${x}`), ['#FFFFFF', '#FF9FB0', '#FFD21F']), { x, z: tz + 1.2 })));
  parts.push(xform(villager(1), { x: -0.5, z: tz + 1.5 }), xform(villager(4), { x: 0.45, z: tz + 1.7, ry: 0.6 }));
  return mergeAll(parts);
}
function bandstand() {
  const R = 2.5; const n = 8; const H = 2.5; const base = 0.9;
  const parts = [cyl(R + 0.3, R + 0.45, base, n, K.stone, {}, 30), cyl(R + 0.35, R + 0.35, 0.08, n, K.trim, { y: base }), box(1.3, 0.45, 0.8, K.stone, { z: R + 0.6 })];
  parts.push(box(1.3, 0.2, 0.5, K.stone, { y: 0.45, z: R + 0.45 }));
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n) * Math.PI * 2;
    parts.push(box(0.13, H, 0.13, WHITE, { x: Math.cos(a) * R, y: base + 0.08, z: Math.sin(a) * R }));
    if (k !== 1) parts.push(xform(box(2 * R * Math.sin(Math.PI / n), 0.07, 0.07, WHITE), { x: Math.cos(a + Math.PI / n) * R * 0.92, y: base + 0.7, z: Math.sin(a + Math.PI / n) * R * 0.92, ry: -(a + Math.PI / n) + Math.PI / 2 }));
  }
  // the raised two-tier roof: a wide striped skirt, a drum and a cupola with a gilt finial
  const top = base + 0.08 + H;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2 + Math.PI / n; const a1 = ((k + 1) / n) * Math.PI * 2 + Math.PI / n;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([Math.cos(a0) * (R + 0.6), 0, Math.sin(a0) * (R + 0.6), 0, 1.1, 0, Math.cos(a1) * (R + 0.6), 0, Math.sin(a1) * (R + 0.6)], 3));
    parts.push(xform(P(g, k % 2 ? '#F6EBD3' : '#2E8C86'), { y: top }));
  }
  parts.push(cyl(R + 0.62, R + 0.62, 0.14, n, WHITE, { y: top - 0.08 }));
  parts.push(cyl(0.95, 0.95, 0.55, n, WHITE, { y: top + 0.75 }), xform(cone(1.25, 0.95, n, '#2E8C86'), { y: top + 1.3, ry: Math.PI / n }));
  parts.push(xform(mergeAll([cyl(0.04, 0.04, 0.5, 5, '#E9B13A'), ball(0.12, '#E9B13A', { y: 0.5 }, 0)]), { y: top + 2.2 }));
  // bunting between the posts, musicians on the stand, benches and listeners round it
  const cols = ['#FF7A6B', '#FFC83D', '#2BB3A3', '#4AA8E8'];
  for (let k = 0; k < n * 2; k++) { const a = (k / (n * 2)) * Math.PI * 2; parts.push(xform(P(new THREE.ConeGeometry(0.11, 0.24, 3), cols[k % 4]), { rx: Math.PI, x: Math.cos(a) * (R + 0.4), y: top - 0.25, z: Math.sin(a) * (R + 0.4), sz: 0.25 })); }
  parts.push(xform(villager(3), { x: -0.7, y: base + 0.08, z: 0.2 }), xform(villager(0), { x: 0.6, y: base + 0.08, z: -0.3, ry: 0.4 }));
  for (const [x, z, ry] of [[-4.2, 1.8, 0.9], [4.2, 1.8, -0.9], [0, -4.4, Math.PI]]) parts.push(xform(benchGeo(1.5), { x, z, ry: ry + Math.PI }));
  parts.push(xform(villager(5, { sit: true }), { x: -4.0, y: 0.3, z: 1.9 }), xform(villager(2), { x: 3.4, z: 3.4, ry: -0.6 }));
  parts.push(xform(lampPost(2.4), { x: 2.6, z: 4.0 }));
  return mergeAll(parts);
}
function schoolhouse() {
  const W = 5.2; const D = 3.8; const H = 2.8;
  const parts = [timberHouse(W, H, D, { plaster: '#B5503C', braces: false }), xform(pitchedRoof(D, W, 1.6, '#6E5A4E', { oh: 0.32, gableHex: '#B5503C' }), { ry: Math.PI / 2, y: 0.3 + H })];
  parts.push(xform(doorBox(1.0, 1.8, '#3E6E8E'), { y: 0.3, z: D / 2 + 0.03 }), box(1.6, 0.12, 0.7, WHITE, { y: 2.3, z: D / 2 + 0.35 }));
  for (const x of [-1.7, 1.7]) parts.push(xform(windowBox(0.9, 1.0, { frame: WHITE }), { x, y: 1.0, z: D / 2 + 0.03 }));
  // the bell cupola on the ridge (tall: the school's silhouette), a flag pole, the playground and the yard fence
  const cup = mergeAll([box(1.0, 1.0, 1.0, WHITE), ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => box(0.14, 0.7, 0.14, WHITE, { x: x * 0.43, y: 1.0, z: z * 0.43 })),
    xform(lathe([[0, 0], [0.2, 0.02], [0.18, 0.18], [0.1, 0.34], [0, 0.37]], 8, '#E9B13A'), { y: 1.1 }), box(1.15, 0.1, 1.15, WHITE, { y: 1.7 }), xform(cone(0.85, 1.1, 4, '#6E5A4E'), { y: 1.8, ry: Math.PI / 4 })]);
  parts.push(xform(cup, { y: 0.3 + H + 1.2 }));
  parts.push(cyl(0.04, 0.05, 4.8, 6, '#C9CED3', { x: 3.4, z: D / 2 + 1.0 }), xform(box(0.8, 0.5, 0.02, '#4AA8E8'), { x: 3.82, y: 4.3, z: D / 2 + 1.0 }), xform(box(0.8, 0.16, 0.025, '#FFFFFF'), { x: 3.82, y: 4.37, z: D / 2 + 1.0 }));
  parts.push(xform(railFence([[-3.2, 0], [-0.8, 0]], { pickets: true, h: 0.7, hex: WHITE, post: WHITE }), { z: D / 2 + 2.0 }), xform(railFence([[0.8, 0], [3.0, 0]], { pickets: true, h: 0.7, hex: WHITE, post: WHITE }), { z: D / 2 + 2.0 }));
  // a swing in the yard, a slate board and two children
  const swing = mergeAll([...[-0.7, 0.7].map((x) => xform(box(0.08, 1.8, 0.08, K.timber), { x, rz: x > 0 ? -0.12 : 0.12 })), box(1.7, 0.09, 0.09, K.timber, { y: 1.75 }),
    ...[-0.18, 0.18].map((x) => box(0.02, 1.15, 0.02, '#D9C59A', { x, y: 0.6 })), box(0.5, 0.05, 0.22, '#C8473A', { y: 0.58 })]);
  parts.push(xform(swing, { x: -3.6, z: D / 2 + 0.6, ry: 0.3 }));
  parts.push(xform(mergeAll([box(0.9, 0.6, 0.06, '#2F3A34', { y: 0.6 }), box(1.0, 0.07, 0.1, K.timberL, { y: 1.2 }), ...[-0.4, 0.4].map((x) => box(0.06, 1.2, 0.06, K.timberL, { x }))]), { x: 1.6, z: D / 2 + 1.2 }));
  parts.push(xform(villager(2), { x: -1.0, z: D / 2 + 1.1, s: 0.75 }), xform(villager(1), { x: -2.6, z: D / 2 + 1.4, s: 0.7, ry: 0.5 }));
  return mergeAll(parts);
}
function ferryLanding() {
  const parts = [];
  // a plank jetty running out over the water (+z) on posts, a ticket hut, a striped canopy over the waiting bench,
  // the FERRY sign, a bell post, crates and the ferry boat with a passenger
  parts.push(box(2.6, 0.14, 5.8, '#B9824A', { y: 0.5, z: 0.6 }));
  for (let i = 0; i < 13; i++) parts.push(box(2.62, 0.02, 0.05, '#9A6A3A', { y: 0.64, z: -2.2 + i * 0.45 }));
  for (const z of [-1.8, 0.4, 2.6]) for (const x of [-1.25, 1.25]) parts.push(cyl(0.1, 0.11, 0.9, 6, '#7A4B2C', { x, y: -0.3, z }));
  const hut = mergeAll([box(1.6, 1.7, 1.4, '#7FB8A0'), xform(pitchedRoof(1.6, 1.4, 0.7, '#C8473A', { oh: 0.18, gableHex: '#7FB8A0' }), { y: 1.7 }), xform(windowBox(0.6, 0.45), { y: 0.85, z: 0.72 }), box(1.1, 0.08, 0.32, WOOD, { y: 0.85, z: 0.86 })]);
  parts.push(xform(hut, { x: -2.1, z: -1.7 }));
  // the canopy: four posts and a striped awning roof over the bench at the landward end
  for (const [x, z] of [[-1.15, -1.5], [1.15, -1.5], [-1.15, 0.3], [1.15, 0.3]]) parts.push(box(0.1, 2.1, 0.1, WHITE, { x, y: 0.64, z }));
  const can = []; for (let i = 0; i < 6; i++) can.push(box(2.6 / 6 + 0.002, 0.05, 2.2, i % 2 ? '#FFF8EC' : '#2BB3A3', { x: -1.3 + (2.6 / 6) * (i + 0.5) }));
  parts.push(xform(mergeAll(can), { y: 2.74, z: -0.6, rz: 0 }), xform(benchGeo(1.6), { y: 0.64, z: -1.2 }));
  parts.push(xform(mergeAll([box(1.8, 0.55, 0.08, '#FFF8EC'), box(1.9, 0.08, 0.1, '#2BB3A3', { y: 0.55 }), box(1.9, 0.08, 0.1, '#2BB3A3', { y: -0.04 }), box(0.12, 0.12, 0.09, '#2BB3A3', { x: -0.55, y: 0.21 }), box(0.5, 0.08, 0.09, '#2BB3A3', { x: 0.1, y: 0.24 }), box(0.08, 0.3, 0.09, '#2BB3A3', { x: 0.55, y: 0.12 })]), { y: 2.85, z: -1.5 }));
  parts.push(xform(mergeAll([box(0.1, 1.8, 0.1, '#7A4B2C'), box(0.6, 0.08, 0.08, '#7A4B2C', { y: 1.75 }), xform(lathe([[0, 0], [0.16, 0], [0.13, 0.12], [0.08, 0.24], [0, 0.26]], 8, '#E9B13A'), { x: 0.25, y: 1.42 })]), { x: 1.1, y: 0.64, z: 1.6 }));
  parts.push(xform(crate(0.5), { x: -0.8, y: 0.64, z: 1.6 }), xform(crate(0.42), { x: -0.75, y: 1.14, z: 1.6, ry: 0.4 }), xform(sack(), { x: -0.2, y: 0.64, z: 1.9 }));
  parts.push(xform(villager(4, { sit: true }), { x: -0.4, y: 0.94, z: -1.1 }), xform(villager(0), { x: 0.6, y: 0.64, z: 0.8, ry: Math.PI }));
  const boat = mergeAll([P(new THREE.ExtrudeGeometry((() => { const sh = new THREE.Shape(); sh.moveTo(-1.8, -0.7); sh.lineTo(1.3, -0.7); sh.quadraticCurveTo(2.1, 0, 1.3, 0.7); sh.lineTo(-1.8, 0.7); sh.closePath(); return sh; })(), { depth: 0.6, bevelEnabled: false, curveSegments: 6 }), '#3E7FB0'),
    box(3.3, 0.06, 1.3, '#C99A5A', { y: 0.55 }), box(0.3, 0.1, 1.2, '#C99A5A', { y: 0.6, x: -0.7 }), box(0.3, 0.1, 1.2, '#C99A5A', { y: 0.6, x: 0.6 })]);
  parts.push(xform(boat, { rx: -Math.PI / 2, ry: Math.PI / 2 }).translate(2.3, 0.05, 1.4));
  parts.push(xform(villager(3, { sit: true }), { x: 2.3, y: 0.42, z: 0.8 }));
  parts.push(xform(lampPost(1.8), { x: -1.15, y: 0.64, z: 3.1 }));
  return mergeAll(parts);
}
/** Drop triangles that lie entirely above y (a half-built frame inside its scaffold). */
function clipAbove(g, y) {
  const src = g.index ? g.toNonIndexed() : g;
  const p = src.getAttribute('position');
  const keep = [];
  for (let f = 0; f < p.count / 3; f++) if (Math.min(p.getY(f * 3), p.getY(f * 3 + 1), p.getY(f * 3 + 2)) <= y) keep.push(f);
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const at = src.getAttribute(name);
    const arr = new Float32Array(keep.length * 3 * at.itemSize);
    keep.forEach((f, i) => arr.set(at.array.subarray(f * 3 * at.itemSize, (f + 1) * 3 * at.itemSize), i * 3 * at.itemSize));
    out.setAttribute(name, new THREE.BufferAttribute(arr, at.itemSize));
  }
  return out;
}
/** A project under way: its own lower half (walls to ~45 % of the height, no villagers yet) inside a scaffold, a timber
 *  pile and the sign board, so the coming silhouette already shows. */
function constructionOf(id) {
  const full = TOWN_BUILDERS[id]();
  const b = bounds(full);
  const half = clipAbove(full, b.max.y * (id === 'bandstand' ? 0.38 : 0.45));
  const w = Math.min(7, b.max.x - b.min.x + 0.6); const d = Math.min(7, b.max.z - b.min.z + 0.4);
  return mergeAll([half, box(w + 1.2, 0.05, d + 1.0, '#C9B48A'), xform(scaffold(w, d, Math.max(2.4, b.max.y * 0.6), { side: 'both' }), { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2 }),
    xform(sitePile(31), { x: b.max.x + 0.6, z: b.max.z - 0.4, ry: 0.5 }), xform(signBoard(1.1, 0.6, '#FFF8EC', K.timber), { x: b.min.x - 0.2, y: 0.9, z: b.max.z + 0.3 }), cyl(0.05, 0.05, 0.9, 5, K.timber, { x: b.min.x - 0.2, z: b.max.z + 0.3 })]);
}
function cottage(i) {
  const roofs = ['#A84F3D', '#5B6E8C', '#76576F', '#6F93B8', '#B86740'];
  const walls = ['#F3E6CC', '#FBF6EC', '#E8D5B0', '#F3E6CC', '#EADFC8'];
  const W = [3.0, 3.6, 2.8, 3.4][i % 4]; const D = [2.6, 2.8, 2.6, 3.0][i % 4]; const H = [2.1, 2.3, 2.0, 2.4][i % 4];
  const parts = [timberHouse(W, H, D, { plaster: walls[i % 5] }), xform(pitchedRoof(W, D, 1.3, roofs[i % 5], { oh: 0.28, gableHex: walls[i % 5] }), { y: 0.3 + H }),
    xform(doorBox(0.7, 1.45), { x: -W * 0.22, y: 0.3, z: D / 2 + 0.03 }), xform(windowBox(0.6, 0.6, { shutters: roofs[(i + 2) % 5] }), { x: W * 0.22, y: 1.0, z: D / 2 + 0.03 }),
    xform(flowerBox(0.7), { x: W * 0.22, y: 0.78, z: D / 2 + 0.12 }), xform(stack(0.9, 0.34), { x: W * 0.25, y: 0.3 + H + 0.4, z: -D * 0.2 })];
  return mergeAll(parts);
}
// wave 3 (M2): Town Projects 5-24 (section 16 builds them) join the four M1b landmarks
const TOWN_BUILDERS = { ferry_landing: ferryLanding, chapel, bandstand, schoolhouse, lighthouse, village_carousel: villageCarousel, village_bakery: villageBakery,
  millpond_bridge: millpondBridge, library, flower_market: flowerMarket, post_office: postOffice, tea_room: teaRoom, clock_square: clockSquare, watermill,
  boathouse, village_green: villageGreen, music_hall: musicHall, harbour_inn: harbourInn, observatory, craft_hall: craftHall, glasshouse_garden: glasshouseGarden,
  skating_pond: skatingPond, orchard_walk: orchardWalk, festival_arch: festivalArch };
/** Landmarks whose landing reaches out over the water at +z (town-view's WATERSIDE). */
const TOWN_WATER = new Set(['ferry_landing', 'lighthouse', 'millpond_bridge', 'watermill', 'boathouse', 'harbour_inn']);
for (const [id, build] of Object.entries(TOWN_BUILDERS)) {
  job(`town:${id}`, `town/${id}.glb`, { family: 'town', footprint: [3, 3], glow: true, ...(TOWN_WATER.has(id) ? { water: true } : {}) }, async () => {
    let g = build();
    const anchors = g.anchors;
    g = await townBudget(g);
    if (anchors) JOBS.find((j) => j.key === `town:${id}`).meta.anchors = anchors;
    return sway(g, { rigid: true });
  });
}
// the Festival Pavilion (after the 24th Town Project; content FESTIVAL_PAVILION): tier 1-8, each with everything before it
for (let k = 1; k <= 8; k++) {
  job(`town:festival_pavilion:${k}`, 'town/festival_pavilion.glb', { family: 'town', footprint: [3, 3], glow: true, tier: k }, async () => {
    let g = festivalPavilion(k);
    g = await townBudget(g);
    return sway(g, { rigid: true });
  });
}
job('town:festival_pavilion', 'town/festival_pavilion.glb', { family: 'town', footprint: [3, 3], glow: true, tier: 1 }, async () => sway(festivalPavilion(1), { rigid: true }));
// RD-15: the cottages' window anchors (model metres) for the evening glow: the front window and the door's fanlight
const cottageWindows = (i) => { const W = [3.0, 3.6, 2.8, 3.4][i % 4]; const D = [2.6, 2.8, 2.6, 3.0][i % 4]; return [[r3(W * 0.22), 1.3, r3(D / 2 + 0.06)], [r3(-W * 0.22), 1.55, r3(D / 2 + 0.06)]]; };
for (let i = 1; i <= 4; i++) job(`town:cottage_${i}`, 'town/cottages.glb', { family: 'town', footprint: [3, 3], glow: true, anchors: { windows: cottageWindows(i - 1) } }, async () => sway(cottage(i - 1), { rigid: true }));
for (const id of Object.keys(TOWN_BUILDERS)) {
  job(`town:construction:${id}`, 'town/construction.glb', { family: 'town', footprint: [3, 3], ...(TOWN_WATER.has(id) ? { water: true } : {}) }, async () => {
    let g = constructionOf(id);
    g = await townBudget(g);
    return sway(g, { rigid: true });
  });
}
job('town:construction', 'town/cottages.glb', { family: 'town', footprint: [3, 3] }, async () => sway(mergeAll([box(4.0, 0.08, 3.4, '#C9B48A'), scaffold(3.6, 3.0, 3.2, { side: 'both' }),
  xform(sitePile(31), { x: -0.8, z: 0.2 }), xform(signBoard(1.1, 0.6, '#FFF8EC', K.timber), { x: 1.5, y: 0.9, z: 1.9 }), cyl(0.05, 0.05, 0.9, 5, K.timber, { x: 1.5, z: 1.9 })]), { rigid: true }));

// ---- Captain Reed's River Barge (§5.7) with its jetty and crates (render-world's barge-view sails it).
function bargeGeo() {
  const L = 11; const B = 3.4;
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-L / 2, -B / 2); hullShape.lineTo(L / 2 - 2.0, -B / 2); hullShape.quadraticCurveTo(L / 2 + 0.6, -B / 4, L / 2 + 0.4, 0);
  hullShape.quadraticCurveTo(L / 2 + 0.6, B / 4, L / 2 - 2.0, B / 2); hullShape.lineTo(-L / 2, B / 2); hullShape.closePath();
  const hull = P(new THREE.ExtrudeGeometry(hullShape, { depth: 1.0, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1, curveSegments: 8 }), '#8A4A34', { creaseDeg: 40 });
  xform(hull, { rx: -Math.PI / 2 });
  const parts = [hull];
  const deck = P(new THREE.ShapeGeometry(hullShape, 8), '#C99A5A');
  parts.push(xform(deck, { rx: -Math.PI / 2, y: 1.02 }));
  // a rub rail and the hold coaming
  parts.push(box(L - 1.0, 0.14, 0.12, '#E9D8B4', { x: -0.4, y: 0.7, z: B / 2 + 0.05 }), box(L - 1.0, 0.14, 0.12, '#E9D8B4', { x: -0.4, y: 0.7, z: -B / 2 - 0.05 }));
  parts.push(box(6.2, 0.18, 2.7, '#7A4B2C', { x: 0.6, y: 1.02 }), box(6.0, 0.02, 2.5, '#A8713A', { x: 0.6, y: 1.2 }));
  // the cabin at the stern with windows, a stovepipe and a flag
  const cab = mergeAll([box(2.3, 1.5, 2.6, '#E8DCC2'), xform(pitchedRoof(2.6, 2.3, 0.5, '#2E6E6A', { oh: 0.12, gableHex: '#E8DCC2' }), { ry: Math.PI / 2, y: 1.5 }),
    xform(windowBox(0.45, 0.4), { ry: Math.PI / 2, x: 1.17, y: 0.75 }), xform(windowBox(0.45, 0.4), { x: -0.4, y: 0.75, z: 1.31 }), xform(windowBox(0.45, 0.4), { x: -0.4, y: 0.75, z: -1.31, ry: Math.PI }),
    cyl(0.07, 0.07, 0.6, 6, '#3A3A3A', { x: -0.6, y: 1.8, z: -0.6 })]);
  parts.push(xform(cab, { x: -L / 2 + 1.5, y: 1.02 }));
  parts.push(cyl(0.06, 0.07, 3.4, 6, '#7A4B2C', { x: L / 2 - 1.2, y: 1.02 }), xform(P(new THREE.ConeGeometry(0.35, 1.1, 3), '#C8473A'), { rz: -Math.PI / 2, x: L / 2 - 0.65, y: 4.1, sz: 0.15 }));
  parts.push(xform(torus(0.32, 0.07, '#FFFFFF', {}, 4, 12), { x: -L / 2 + 1.5, y: 1.2, z: 1.75 }), xform(torus(0.32, 0.07, '#E84A3A', {}, 4, 4), { x: -L / 2 + 1.5, y: 1.2, z: 1.76, rz: Math.PI / 4, s: 1.02 }));
  // RD-10 (QA wave 2): Captain Reed at the cabin door (navy coat, white cap) and fenders along the hull
  const captain = mergeAll([cyl(0.17, 0.26, 0.95, 6, '#24406A', {}, 40), ball(0.16, '#E8B48A', { y: 1.09 }, 0), cyl(0.19, 0.19, 0.05, 8, '#FFFFFF', { y: 1.21 }, 0),
    cyl(0.13, 0.14, 0.12, 8, '#FFFFFF', { y: 1.24 }, 0), box(0.2, 0.03, 0.12, '#1E2A3A', { y: 1.2, x: 0.16 }), ball(0.09, '#F2F2F2', { y: 0.98, x: 0.12, sy: 0.6 }, 0)]);
  parts.push(xform(captain, { x: -L / 2 + 3.0, y: 1.02, z: 0.9, ry: -0.6 }));
  for (const x of [-3.2, -0.6, 2.0]) for (const z of [-1, 1]) parts.push(xform(torus(0.2, 0.08, '#2F2F2F', {}, 4, 8), { x, y: 0.55, z: z * (B / 2 + 0.12) }));
  return mergeAll(parts);
}
/** Crate spots on the barge deck (model metres): three rows of three, for render-world's crates. */
const BARGE_SLOTS = [-1.6, 0.6, 2.8].flatMap((x) => [-0.85, 0, 0.85].map((z) => [x, 1.2, z]));
job('prop:barge', 'props/barge.glb', { family: 'prop', footprint: [6, 2], slots: BARGE_SLOTS, deck: 1.2, waterline: 0.55, water: true }, async () => sway(bargeGeo(), { rigid: true }));
job('prop:barge_crate', 'props/barge.glb', { family: 'prop', footprint: [1, 1] }, async () => sway(mergeAll([crate(0.78, '#D9A15B'),
  xform(box(0.5, 0.18, 0.01, '#5A3418'), { y: 0.35, z: 0.4 }), xform(torus(0.36, 0.025, '#D9B97A', {}, 3, 4), { y: 0.4, rx: Math.PI / 2, ry: Math.PI / 4, s: 1.05 })]), { rigid: true }));
job('prop:jetty', 'props/barge.glb', { family: 'prop', footprint: [4, 2], water: true }, async () => {
  const parts = [box(7.6, 0.14, 2.6, '#B9824A', { y: 0.55 })];
  for (let i = 0; i < 17; i++) parts.push(box(0.05, 0.02, 2.62, '#9A6A3A', { x: -3.7 + i * 0.46, y: 0.69 }));
  for (const x of [-3.5, -1.2, 1.2, 3.5]) for (const z of [-1.2, 1.2]) parts.push(cyl(0.12, 0.13, 1.0, 6, '#7A4B2C', { x, y: -0.3, z }));
  for (const x of [-2.8, 2.8]) parts.push(xform(mergeAll([cyl(0.14, 0.16, 0.45, 8, '#3A3A3A'), cyl(0.2, 0.2, 0.06, 8, '#3A3A3A', { y: 0.42 })]), { x, y: 0.69, z: 1.05 }));
  parts.push(xform(mergeAll([0, 1, 2].map((i) => xform(torus(0.3 - i * 0.02, 0.05, '#D9B97A', {}, 4, 12), { rx: Math.PI / 2, y: 0.05 + i * 0.09 }))), { x: 0.6, y: 0.69, z: -0.6 }));
  parts.push(xform(mergeAll([cyl(0.04, 0.05, 1.7, 6, '#3A3A3A'), box(0.24, 0.28, 0.24, '#FFE08A', { y: 1.7 }), xform(P(new THREE.ConeGeometry(0.2, 0.16, 4), '#3A3A3A'), { y: 2.06, ry: Math.PI / 4 })]), { x: -3.4, y: 0.69, z: -1.05 }));
  // RD-10 (QA wave 2): a working jetty: tyre fenders on the end posts, a second rope coil, crates and a barrel waiting,
  // and the captain's noticeboard with the week's manifest pinned up
  for (const z of [-1.25, 1.25]) parts.push(xform(torus(0.22, 0.09, '#2F2F2F', {}, 4, 8), { x: 3.62, y: 0.3, z, ry: Math.PI / 2 }));
  parts.push(xform(mergeAll([0, 1].map((i) => xform(torus(0.24 - i * 0.03, 0.045, '#C9A86A', {}, 4, 10), { rx: Math.PI / 2, y: 0.05 + i * 0.08 }))), { x: 2.4, y: 0.69, z: 0.7 }));
  parts.push(xform(crate(0.55), { x: -1.6, y: 0.69, z: -0.75 }), xform(crate(0.45), { x: -1.55, y: 1.24, z: -0.72, ry: 0.4 }), xform(crate(0.5), { x: -0.95, y: 0.69, z: -0.85, ry: -0.2 }), xform(barrel(0.75), { x: -2.3, y: 0.69, z: -0.8 }));
  parts.push(xform(mergeAll([box(0.1, 1.6, 0.1, '#7A4B2C', { x: -0.55 }), box(0.1, 1.6, 0.1, '#7A4B2C', { x: 0.55 }), box(1.3, 0.85, 0.08, '#B9824A', { y: 0.75 }), box(1.4, 0.1, 0.16, '#7A4B2C', { y: 1.62 }),
    box(0.36, 0.46, 0.02, '#FFF8EC', { x: -0.3, y: 0.95, z: 0.05, rz: 0.06 }), box(0.32, 0.3, 0.02, '#FFE6A8', { x: 0.25, y: 1.05, z: 0.05, rz: -0.08 }), box(0.3, 0.2, 0.02, '#CFE6F2', { x: 0.2, y: 0.85, z: 0.05 })]), { x: -3.9, y: 0.0, z: 0.3, ry: Math.PI / 2 }));
  return sway(mergeAll(parts), { rigid: true });
});

// RD-15 (QA wave 2: stand-in left): the Riverbank's upgraded jetty, in prop:jetty's frame (7.6 m along x, the same
// stretch): a side landing stage along +z at the river end on its own piles, a cargo crane with a crate on its hook,
// two more lanterns and the captain's noticeboard
job('prop:jetty:2', 'props/barge.glb', { family: 'prop', footprint: [4, 2], water: true }, async () => {
  const parts = [box(7.6, 0.14, 2.6, '#B9824A', { y: 0.55 })];
  for (let i = 0; i < 17; i++) parts.push(box(0.05, 0.02, 2.62, '#9A6A3A', { x: -3.7 + i * 0.46, y: 0.69 }));
  for (const x of [-3.5, -1.2, 1.2, 3.5]) for (const z of [-1.2, 1.2]) parts.push(cyl(0.12, 0.13, 1.0, 6, '#7A4B2C', { x, y: -0.3, z }));
  // the side landing stage
  parts.push(box(3.4, 0.14, 2.2, '#C99257', { x: 1.9, y: 0.5, z: 2.4 }));
  for (let i = 0; i < 8; i++) parts.push(box(0.05, 0.02, 2.22, '#9A6A3A', { x: 0.4 + i * 0.44, y: 0.64, z: 2.4 }));
  for (const x of [0.4, 3.4]) parts.push(cyl(0.12, 0.13, 1.0, 6, '#7A4B2C', { x, y: -0.35, z: 3.4 }));
  for (const x of [-2.8, 2.8]) parts.push(xform(mergeAll([cyl(0.14, 0.16, 0.45, 8, '#3A3A3A'), cyl(0.2, 0.2, 0.06, 8, '#3A3A3A', { y: 0.42 })]), { x, y: 0.69, z: 1.05 }));
  // the cargo crane: a post, a jib, a rope and a crate on the hook
  parts.push(cyl(0.12, 0.15, 3.4, 7, '#7A4B2C', { x: 2.6, y: 0.64, z: -0.9 }), xform(box(0.14, 0.14, 2.6, '#7A4B2C'), { x: 2.6, y: 3.9, z: 0.1, rx: 0.22 }));
  parts.push(cyl(0.015, 0.015, 1.4, 4, '#D9C59A', { x: 2.6, y: 2.4, z: 1.2 }), xform(crate(0.5), { x: 2.6, y: 1.9, z: 1.2 }));
  for (const [x, z] of [[-3.4, -1.05], [0.2, 1.05], [3.6, 3.3]]) parts.push(xform(mergeAll([cyl(0.04, 0.05, 1.7, 6, '#3A3A3A'), box(0.24, 0.28, 0.24, '#FFE08A', { y: 1.7 }), xform(P(new THREE.ConeGeometry(0.2, 0.16, 4), '#3A3A3A'), { y: 2.06, ry: Math.PI / 4 })]), { x, y: 0.69, z }));
  parts.push(xform(mergeAll([0, 1, 2].map((i) => xform(torus(0.3 - i * 0.02, 0.05, '#D9B97A', {}, 4, 12), { rx: Math.PI / 2, y: 0.05 + i * 0.09 }))), { x: 0.6, y: 0.69, z: -0.6 }));
  for (const z of [-1.25, 1.25]) parts.push(xform(torus(0.22, 0.09, '#2F2F2F', {}, 4, 8), { x: 3.62, y: 0.3, z, ry: Math.PI / 2 }));
  parts.push(xform(crate(0.55), { x: -1.6, y: 0.69, z: -0.75 }), xform(crate(0.45), { x: -1.55, y: 1.24, z: -0.72, ry: 0.4 }), xform(barrel(0.75), { x: -2.3, y: 0.69, z: -0.8 }), xform(crate(0.55), { x: 1.4, y: 0.64, z: 2.9 }));
  parts.push(xform(mergeAll([box(0.1, 1.6, 0.1, '#7A4B2C', { x: -0.55 }), box(0.1, 1.6, 0.1, '#7A4B2C', { x: 0.55 }), box(1.3, 0.85, 0.08, '#B9824A', { y: 0.75 }), box(1.4, 0.1, 0.16, '#7A4B2C', { y: 1.62 }),
    box(0.36, 0.46, 0.02, '#FFF8EC', { x: -0.3, y: 0.95, z: 0.05, rz: 0.06 }), box(0.32, 0.3, 0.02, '#FFE6A8', { x: 0.25, y: 1.05, z: 0.05, rz: -0.08 })]), { x: -3.9, y: 0.0, z: 0.3, ry: Math.PI / 2 }));
  parts.push(xform(P(new THREE.ConeGeometry(0.28, 0.9, 3), '#2BB3A3'), { rz: -Math.PI / 2, x: 3.05, y: 4.05, z: -0.9, sz: 0.15 }));
  return sway(mergeAll(parts), { rigid: true });
});

// ---- The County Fair (§5.6): the marquee, a judging stall with rosettes and the winners' podium.
function fairTent() {
  const S = 6.6; const H = 2.3; const cols = ['#C8473A', '#FFF8EC'];
  const parts = [];
  // striped walls on three sides, open at the front with the flaps tied back
  const panel = (w, x, z, ry, n = 8) => { const out = []; for (let i = 0; i < n; i++) out.push(box(w / n + 0.002, H, 0.05, cols[i % 2], { x: -w / 2 + (w / n) * (i + 0.5) })); return xform(mergeAll(out), { x, z, ry }); };
  parts.push(panel(S, 0, -S / 2, 0), panel(S, -S / 2, 0, Math.PI / 2), panel(S, S / 2, 0, Math.PI / 2));
  for (const sx of [-1, 1]) parts.push(xform(mergeAll([box(1.4, H, 0.05, cols[0]), box(1.4, 0.06, 0.06, '#E9B13A', { y: H * 0.5 })]), { x: sx * (S / 2 - 0.7), z: S / 2, ry: sx * -0.35 }));
  // RD-12 (QA wave 2: "open the tent entrance"): a striped porch canopy on two poles over the open front, rope barriers
  // guiding visitors in, and a sign over the door
  const porch = []; for (let i = 0; i < 6; i++) porch.push(box(3.0 / 6 + 0.002, 0.05, 1.6, cols[i % 2], { x: -1.5 + (3.0 / 6) * (i + 0.5) }));
  parts.push(xform(mergeAll(porch), { y: H + 0.05, z: S / 2 + 0.75, rx: 0.18 }));
  for (const sx of [-1.5, 1.5]) parts.push(cyl(0.05, 0.05, H + 0.2, 5, '#7A4B2C', { x: sx, z: S / 2 + 1.5 }));
  for (const sx of [-1, 1]) {
    for (const z of [S / 2 + 1.8, S / 2 + 3.0]) parts.push(cyl(0.04, 0.05, 0.8, 5, '#E9B13A', { x: sx * 1.1, z }));
    parts.push(xform(cyl(0.02, 0.02, 1.2, 3, '#C8473A', {}, 0), { rx: Math.PI / 2, x: sx * 1.1, y: 0.72, z: S / 2 + 1.8 }));
  }
  parts.push(xform(signBoard(1.6, 0.4, '#FFF8EC', '#C8473A'), { y: H - 0.15, z: S / 2 + 0.06 }));
  // the roof: a square striped pyramid over the walls with a scalloped valance (fits the 4 x 4 footprint)
  const hw = S / 2 + 0.3; const apex = 2.3;
  const stripes = [];
  const corners = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
  for (let side = 0; side < 4; side++) {
    const [ax, az] = corners[side]; const [bx, bz] = corners[(side + 1) % 4];
    for (let k = 0; k < 4; k++) {
      const t0 = k / 4; const t1 = (k + 1) / 4;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, apex, 0, ax + (bx - ax) * t1, 0, az + (bz - az) * t1, ax + (bx - ax) * t0, 0, az + (bz - az) * t0]), 3));
      g.computeVertexNormals(); paint(g, cols[(k + side) % 2]); stripes.push(g);
    }
    for (let k = 0; k < 6; k++) {
      const t = (k + 0.5) / 6; const x = ax + (bx - ax) * t; const z = az + (bz - az) * t;
      stripes.push(xform(P(new THREE.CircleGeometry(hw / 6.5, 6, Math.PI, Math.PI), cols[k % 2]), { x, y: 0.01, z, ry: -Math.atan2(bz - az, bx - ax) }));
    }
  }
  // the faces must point outward (static materials are single-sided): flip any triangle facing the tent's middle
  const roofG = outward(mergeAll(stripes), new THREE.Vector3(0, -1.5, 0));
  parts.push(xform(roofG, { y: H }));
  parts.push(cyl(0.06, 0.06, H + 3.0, 6, '#7A4B2C'), xform(P(new THREE.ConeGeometry(0.4, 1.2, 3), '#FFC83D'), { rz: -Math.PI / 2, x: 0.6, y: H + 2.75, sz: 0.15 }));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(cyl(0.05, 0.05, H + 0.3, 5, '#7A4B2C', { x: x * S / 2, z: z * S / 2 }));
  // inside: the judging table with entries and a rosette board
  parts.push(box(3.2, 0.82, 0.9, '#FFF8EC', { z: -1.6 }), box(3.25, 0.05, 0.95, '#2BB3A3', { y: 0.8, z: -1.6 }));
  parts.push(xform(pieGeo(0.22, '#C81E3C'), { x: -1.0, y: 0.86, z: -1.6 }), xform(jar('#E83A55'), { x: -0.3, y: 0.86, z: -1.6 }), xform(gourd('pumpkin', 0.25, true, rng('ft')), { x: 0.5, y: 0.97, z: -1.6 }), xform(jar('#F59A23'), { x: 1.1, y: 0.86, z: -1.6 }));
  parts.push(xform(mergeAll([box(2.4, 1.0, 0.06, '#E8DCC2'), ...['#FFC83D', '#C9CED3', '#C9862E'].map((h, i) => xform(mergeAll([cyl(0.18, 0.18, 0.04, 12, h), cyl(0.1, 0.1, 0.05, 12, '#FFF8EC')]), { x: -0.7 + i * 0.7, y: 0.55, z: 0.05, rx: Math.PI / 2 }))]), { y: 1.0, z: -S / 2 + 0.15 }));
  return mergeAll(parts);
}
job('prop:fair_tent', 'props/fair.glb', { family: 'prop', footprint: [4, 4] }, async () => sway(fairTent(), { rigid: true }));
job('prop:fair_stall', 'props/fair.glb', { family: 'prop', footprint: [2, 1] }, async () => sway(mergeAll([box(3.0, 0.82, 0.9, '#FFF8EC'), box(3.05, 0.05, 0.95, '#C8473A', { y: 0.8 }),
  ...['#FFC83D', '#4AA8E8', '#E84A3A'].map((h, i) => xform(rosetteStand(h), { x: -1.0 + i * 1.0, y: 0.85, s: 0.55 })), xform(signBoard(1.6, 0.5, '#FFF8EC', '#C8473A'), { y: 1.9, z: -0.3 }), cyl(0.04, 0.04, 1.9, 5, K.timber, { x: -0.8, z: -0.3 }), cyl(0.04, 0.04, 1.9, 5, K.timber, { x: 0.8, z: -0.3 })]), { rigid: true }));
// RD-12 (QA wave 2: "three distinct booths"): the preserves booth (jars on stepped shelves, a red awning), the bakers'
// booth (pies and a tiered cake, a blue awning) and the games booth (a ring-toss of bottles, a prize shelf, green)
function boothGeo(kind) {
  const aw = { jam: ['#FFF8EC', '#C8473A'], pie: ['#FFF8EC', '#3E7FB0'], games: ['#FFF8EC', '#3E9E5A'] }[kind];
  const parts = [box(2.6, 0.8, 0.9, '#E8DCC2'), box(2.65, 0.05, 0.95, aw[1], { y: 0.8 })];
  for (const sx of [-1.25, 1.25]) for (const sz of [-0.42, 0.42]) parts.push(box(0.08, 2.3, 0.08, K.timber, { x: sx, z: sz }));
  parts.push(xform(awning(2.8, 1.2, aw, 8), { y: 2.3, z: -0.5 }));
  parts.push(xform(signBoard(1.4, 0.36, '#FFF8EC', aw[1]), { y: 2.45, z: 0.48 }));
  if (kind === 'jam') {
    for (let row = 0; row < 3; row++) {
      parts.push(box(2.2, 0.05, 0.28, K.timberL, { y: 0.85 + row * 0.3, z: -0.25 + row * -0.05 }));
      // light jars (an 8-sided body and a cream lid): eighteen of the detailed jar() would be 5,000 triangles
      for (let i = 0; i < 6; i++) parts.push(cyl(0.07, 0.07, 0.17, 8, ['#C8473A', '#E9B13A', '#7A3F7A', '#F59A23'][(i + row) % 4], { x: -0.95 + i * 0.38, y: 0.88 + row * 0.3, z: -0.25 + row * -0.05 }),
        cyl(0.075, 0.075, 0.035, 8, '#F3E6C8', { x: -0.95 + i * 0.38, y: 1.05 + row * 0.3, z: -0.25 + row * -0.05 }));
    }
  } else if (kind === 'pie') {
    for (let i = 0; i < 3; i++) parts.push(xform(pieGeo(0.22, ['#C81E3C', '#7A3F7A', '#E9B13A'][i]), { x: -0.9 + i * 0.6, y: 0.86, z: 0.15 }));
    parts.push(cyl(0.3, 0.3, 0.22, 14, '#FFF3E4', { x: 0.95, y: 0.85 }), cyl(0.22, 0.22, 0.2, 14, '#F7A6C4', { x: 0.95, y: 1.07 }), cyl(0.14, 0.14, 0.18, 14, '#FFF3E4', { x: 0.95, y: 1.27 }), ball(0.06, '#E83A55', { x: 0.95, y: 1.48 }, 0));
  } else {
    for (let i = 0; i < 9; i++) parts.push(cyl(0.05, 0.07, 0.3, 6, ['#3E9E5A', '#4AA8E8', '#E9B13A'][i % 3], { x: -0.8 + (i % 3) * 0.25, y: 0.85, z: -0.25 + Math.floor(i / 3) * 0.22 }));
    parts.push(box(1.0, 0.05, 0.3, K.timberL, { x: 0.65, y: 1.4, z: -0.3 }));
    for (let i = 0; i < 3; i++) parts.push(ball(0.13, ['#FF9FB0', '#FFE27A', '#9BD86A'][i], { x: 0.35 + i * 0.3, y: 1.58, z: -0.3 }, 0));
    for (let i = 0; i < 3; i++) parts.push(xform(torus(0.08, 0.02, ['#C8473A', '#4AA8E8', '#E9B13A'][i], {}, 3, 8), { x: 0.4 + i * 0.25, y: 0.86, z: 0.3, rx: Math.PI / 2 }));
  }
  return mergeAll(parts);
}
for (const kind of ['jam', 'pie', 'games']) job(`prop:fair_booth_${kind}`, 'props/fair.glb', { family: 'prop', footprint: [2, 1] }, async () => sway(boothGeo(kind), { rigid: true }));
// a bench for the fair's seating rows and the village square; the noticeboard with its pinned notes
job('prop:bench', 'props/fair.glb', { family: 'prop', footprint: [1, 1] }, async () => sway(benchGeo(1.6), { rigid: true }));
job('prop:noticeboard', 'props/fair.glb', { family: 'prop', footprint: [1, 1] }, async () => sway(mergeAll([box(0.1, 1.7, 0.1, K.timber, { x: -0.6 }), box(0.1, 1.7, 0.1, K.timber, { x: 0.6 }),
  box(1.4, 0.9, 0.08, K.timberL, { y: 0.8 }), xform(pitchedRoof(1.6, 0.4, 0.25, '#7A4B2C', { oh: 0.08, gableHex: K.timber }), { y: 1.7 }),
  box(0.36, 0.44, 0.02, '#FFF8EC', { x: -0.38, y: 1.05, z: 0.05, rz: 0.05 }), box(0.32, 0.3, 0.02, '#FFE6A8', { x: 0.1, y: 1.15, z: 0.05, rz: -0.07 }), box(0.3, 0.24, 0.02, '#CFE6F2', { x: 0.42, y: 0.95, z: 0.05 }),
  box(0.4, 0.2, 0.02, '#F7C6D4', { x: -0.05, y: 0.92, z: 0.05, rz: 0.04 })]), { rigid: true }));
// little groups of villagers (2-3 people chatting) for the fair, the village square and the landings
for (let g = 1; g <= 3; g++) job(`prop:villagers_${g}`, 'props/fair.glb', { family: 'prop', footprint: [1, 1] }, async () => {
  const spots = [[[-0.35, 0, 0.6], [0.35, 0.1, -2.4]], [[-0.4, -0.1, 0.9], [0.3, 0.25, -2.0], [0.05, -0.45, 3.0]], [[-0.3, 0.15, 1.2], [0.4, -0.05, -1.7]]][g - 1];
  return sway(mergeAll(spots.map(([x, z, ry], i) => xform(villager(g * 2 + i), { x, z, ry, s: i === 2 ? 0.75 : 1 }))), { rigid: true });
});
job('prop:fair_podium', 'props/fair.glb', { family: 'prop', footprint: [2, 1] }, async () => sway(mergeAll([box(1.0, 1.0, 1.0, '#FFF8EC'), box(1.02, 0.12, 1.02, '#FFC83D', { y: 1.0 }),
  box(1.0, 0.7, 1.0, '#FFF8EC', { x: -1.05 }), box(1.02, 0.1, 1.02, '#C9CED3', { x: -1.05, y: 0.7 }), box(1.0, 0.45, 1.0, '#FFF8EC', { x: 1.05 }), box(1.02, 0.1, 1.02, '#C9862E', { x: 1.05, y: 0.45 }),
  ...[['1', 0, 0.55], ['2', -1.05, 0.35], ['3', 1.05, 0.22]].map(([, x, y]) => xform(cyl(0.18, 0.18, 0.03, 10, '#C8473A'), { x, y: Number(y), z: 0.51, rx: Math.PI / 2 }))]), { rigid: true }));

// ---- Masterwork (§5.9): a flat ornamental border laid around a decor's footprint (1 x 1 tile; render-world scales
//      it to the footprint): dressed stone with corner studs (level 1), and with a gold inlay and finials (level 2).
function masterworkBorder(level) {
  const parts = [];
  const S = 1.9; const t = 0.16;
  for (const [x, z, w, d] of [[0, -S / 2, S, t], [0, S / 2, S, t], [-S / 2, 0, t, S], [S / 2, 0, t, S]]) parts.push(box(w, 0.06, d, '#D9D2C2', { x, z }));
  if (level >= 2) for (const [x, z, w, d] of [[0, -S / 2, S - 0.1, 0.05], [0, S / 2, S - 0.1, 0.05], [-S / 2, 0, 0.05, S - 0.1], [S / 2, 0, 0.05, S - 0.1]]) parts.push(box(w, 0.07, d, '#E9B13A', { x, z }));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    // RD-17: shaped corner stones (a bevelled block under a ball finial)
    parts.push(box(0.26, 0.12, 0.26, level >= 2 ? '#E9D8B4' : '#C9C1B2', { x: x * S / 2, z: z * S / 2 }), box(0.18, 0.06, 0.18, level >= 2 ? '#FFC83D' : '#D9D2C2', { x: x * S / 2, y: 0.12, z: z * S / 2 }));
    parts.push(ball(0.07, level >= 2 ? '#FFD84A' : '#D9D2C2', { x: x * S / 2, y: 0.24, z: z * S / 2 }, 0));
    if (level >= 2) parts.push(xform(P(new THREE.ConeGeometry(0.05, 0.12, 6), '#FFD84A', { creaseDeg: 50 }), { x: x * S / 2, y: 0.3, z: z * S / 2 }));
  }
  // planting pockets: a little clump of flowers in the middle of each side
  for (const [x, z] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    parts.push(ball(0.08, '#5E9E3A', { x: x * S / 2, y: 0.07, z: z * S / 2, sy: 0.7 }, 0));
    parts.push(ball(0.035, level >= 2 ? '#FFD84A' : '#FF9FB0', { x: x * S / 2 + 0.03, y: 0.13, z: z * S / 2 }, 0));
  }
  return mergeAll(parts);
}
job('prop:masterwork_1', 'props/masterwork.glb', { family: 'prop', footprint: [1, 1], layer: 'ground' }, async () => sway(masterworkBorder(1), { rigid: true }));
job('prop:masterwork_2', 'props/masterwork.glb', { family: 'prop', footprint: [1, 1], layer: 'ground' }, async () => sway(masterworkBorder(2), { rigid: true }));

// ---------------------------------------------------------------------------------------------------
// 14. Skinned models (animals with clips, the two farmer avatars). gltf-transform edits the skinned document
//     (merge primitives that share a skin, bake vertex colours or keep named materials, creased normals,
//     rename/prune clips), three's GLTFLoader (in Node) measures the posed bounds and bakes the rigid twin.
let GLTFLoaderNode = null;
async function parseThree(doc) {
  const t = await tools();
  if (!GLTFLoaderNode) GLTFLoaderNode = (await import('three/addons/loaders/GLTFLoader.js')).GLTFLoader;
  const glb = await t.io.writeBinary(doc);
  const buf = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
  return new Promise((res, rej) => new GLTFLoaderNode().parse(buf, '', res, rej));
}

function readAttr(acc) { return acc ? accessorArray(acc) : null; }

/**
 * The coat mask of a breedable animal (wave 3, GDD §3.4 Breeding Barn: white / brown / spotted / golden coats and the
 * Seasonal Track's coats): a vec3 attribute `coat` = (coat, spot, tone). coat is 1 on the fleece / hide (the materials
 * matching `mat`, and the wool lobes), 0 on muzzles, hooves, horns, eyes and manes; spot is 1 on the patches a spotted
 * coat paints (low-frequency noise over the bind pose, `share` of the coat); tone (stored halved so the attribute quantises) is the vertex's lightness over the
 * coat's reference colour, so a recoloured coat keeps its belly, its patches and its shading. animals-view's coat
 * patch recolours `coat` vertices to the coat's colours; an animal without a coat draws as built.
 */
export function coatAttribute(g, { isCoat, share = 0.3, freq = 2.4, seed = 21 }) {
  const p = g.getAttribute('position'); const c = g.getAttribute('color');
  const n = p.count; const out = new Float32Array(n * 3);
  const lum = (r, gg, b) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  const ls = [];
  if (c) for (let i = 0; i < n; i++) if (isCoat(i)) ls.push(lum(c.getX(i), c.getY(i), c.getZ(i)));
  ls.sort((a, b) => a - b);
  const L0 = Math.max(0.02, ls.length ? ls[Math.floor(ls.length / 2)] : 0.5);
  const b = new THREE.Box3().setFromBufferAttribute(p); const size = b.getSize(new THREE.Vector3());
  const k = freq / Math.max(size.x, size.y, size.z, 1e-6);
  const vals = new Float32Array(n);
  const coatVals = [];
  for (let i = 0; i < n; i++) {
    vals[i] = noise3((p.getX(i) - b.min.x) * k, (p.getY(i) - b.min.y) * k * 1.3, (p.getZ(i) - b.min.z) * k, seed);
    if (isCoat(i)) coatVals.push(vals[i]);
  }
  coatVals.sort((x, y) => x - y);
  const th = coatVals.length ? coatVals[Math.floor(coatVals.length * (1 - share))] : Infinity;
  for (let i = 0; i < n; i++) {
    const on = isCoat(i);
    out[i * 3] = on ? 1 : 0;
    out[i * 3 + 1] = on && vals[i] >= th ? 1 : 0;
    out[i * 3 + 2] = on && c ? Math.min(1.5, Math.max(0.45, lum(c.getX(i), c.getY(i), c.getZ(i)) / L0)) / 2 : 0.5;
  }
  g.setAttribute('coat', new THREE.BufferAttribute(out, 3));
  return g;
}
/** The coat attribute over a skinned model's primitive list (by source material; the sheep's wool lobes carry their
 *  host's material, horns and beards built on a bone carry none). The noise runs in the whole body's frame and the
 *  spot threshold is one quantile over every coat vertex, so the patches are continuous across the parts. */
function coatMask(list, { mat, share = 0.3, seed = 21, freq = 2.4 }) {
  const box3 = new THREE.Box3(); const v = new THREE.Vector3();
  for (const g of list) { const p = g.getAttribute('position'); for (let i = 0; i < p.count; i++) box3.expandByPoint(v.fromBufferAttribute(p, i)); }
  const size = box3.getSize(new THREE.Vector3()); const k = freq / Math.max(size.x, size.y, size.z, 1e-6);
  const lum = (r, gg, b) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  const ls = [];
  for (const g of list) {
    if (!mat.test(g.userData.material || '')) continue;
    const c = g.getAttribute('color'); if (!c) continue;
    for (let i = 0; i < c.count; i += 3) ls.push(lum(c.getX(i), c.getY(i), c.getZ(i)));
  }
  ls.sort((a, b) => a - b);
  const L0 = Math.max(0.02, ls.length ? ls[Math.floor(ls.length / 2)] : 0.5);
  const per = list.map((g) => {
    const p = g.getAttribute('position'); const on = mat.test(g.userData.material || '');
    const vals = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) vals[i] = noise3((p.getX(i) - box3.min.x) * k, (p.getY(i) - box3.min.y) * k * 1.3, (p.getZ(i) - box3.min.z) * k, seed);
    return { on, vals };
  });
  const all = per.filter((q) => q.on).flatMap((q) => Array.from(q.vals)).sort((a, b) => a - b);
  const th = all.length ? all[Math.floor(all.length * (1 - share))] : Infinity;
  list.forEach((g, gi) => {
    const { on, vals } = per[gi]; const c = g.getAttribute('color'); const n = vals.length;
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      out[i * 3] = on ? 1 : 0; out[i * 3 + 1] = on && vals[i] >= th ? 1 : 0;
      out[i * 3 + 2] = on && c ? Math.min(1.5, Math.max(0.45, lum(c.getX(i), c.getY(i), c.getZ(i)) / L0)) / 2 : 0.5;
    }
    g.setAttribute('coat', new THREE.BufferAttribute(out, 3));
  });
}

/** Cream patches on a cow's coat (visual-22): low-frequency noise over the bind pose, `share` of the coat. */
function cowPatches(g, { hex = '#F6EBD6', share = 0.25, freq = 2.2, seed = 9 }) {
  const p = g.getAttribute('position'); const c = g.getAttribute('color');
  const b = new THREE.Box3().setFromBufferAttribute(p);
  const size = b.getSize(new THREE.Vector3());
  const k = freq / Math.max(size.x, size.y, size.z);
  const vals = [];
  for (let i = 0; i < p.count; i++) vals.push(noise3((p.getX(i) - b.min.x) * k, (p.getY(i) - b.min.y) * k * 1.3, (p.getZ(i) - b.min.z) * k, seed));
  const th = [...vals].sort((x, y) => x - y)[Math.floor(vals.length * (1 - share))];
  const t = lin(hex);
  for (let i = 0; i < p.count; i++) if (vals[i] >= th) c.setXYZ(i, t.r, t.g, t.b);
}

/**
 * A woolly coat on a sheep (wave 2, VISUAL-AFTER C4): 8-12 overlapping fleece masses spread over the shoulders,
 * back and flanks, each buried 60-75 % in the body (its centre sits under the skin along the vertex normal), in a
 * warm ivory that shades darker underneath. The masses are chosen by farthest-point sampling over the upper body,
 * away from the head end, so they cover evenly; each is skinned like its nearest wool vertex. Wave 1 hung eight
 * balls over the back and under the belly ("attached ornaments").
 */
function woolLobes(host0, { n = 16, hex = '#F1EBDD', shadeHex = '#D8D1C2', seed = 3, head = null, rot = null }) {
  // work upright: the source's bind space may be Y-down (the Farm Animal sheep's node is a 180-degree turn about x,
  // which is why wave 1's "over the back" lobes hung under the belly); the lobes go back into bind space at the end
  const R0 = rot || new THREE.Matrix4();
  const Rinv = R0.clone().invert();
  const host = host0.clone(); host.applyMatrix4(R0);
  if (head) head = head.clone().applyMatrix4(R0);
  const src = host.index ? host.toNonIndexed() : host;
  const p = src.getAttribute('position');
  const nrmG = weld((() => { const x = src.clone(); for (const k of Object.keys(x.attributes)) if (k !== 'position') x.deleteAttribute(k); return x; })(), 1e-4);
  nrmG.computeVertexNormals();
  const np = nrmG.getAttribute('position'); const nn = nrmG.getAttribute('normal');
  const b = new THREE.Box3().setFromBufferAttribute(p);
  const size = b.getSize(new THREE.Vector3()); const ctr = b.getCenter(new THREE.Vector3());
  const along = size.z >= size.x ? 'z' : 'x';
  const len = along === 'z' ? size.z : size.x;
  // the head end: where the dark face material sits (passed in), else the +along end
  const headAt = head ? head[along] : (along === 'z' ? b.max.z : b.max.x);
  const r = rng(seed);
  // an even cover: a grid over the body (4 slices from the rump to the shoulders x 4 directions round the top and
  // the flanks); each lobe sits on the outermost wool vertex of its slice in its direction
  const headSign = Math.sign(headAt - (along === 'z' ? ctr.z : ctr.x)) || 1;
  const aMin = (along === 'z' ? b.min.z : b.min.x); const aMax = (along === 'z' ? b.max.z : b.max.x);
  const sideAxis = along === 'z' ? 'x' : 'z';
  const picked = [];
  const us = [0.12, 0.34, 0.56, 0.74];
  const vs = [-1.25, -0.45, 0.45, 1.25];
  for (const [ui, u] of us.entries()) for (const [vi, v0] of vs.entries()) {
    if (picked.length >= n) break;
    const uu = headSign > 0 ? aMin + (aMax - aMin) * u : aMax - (aMax - aMin) * u;
    const v = v0 + (ui % 2 ? 0.2 : -0.2);
    const dy = Math.cos(v); const ds = Math.sin(v);
    let best = -1; let bestD = -Infinity;
    for (let i = 0; i < np.count; i++) {
      const a = along === 'z' ? np.getZ(i) : np.getX(i);
      if (Math.abs(a - uu) > len * 0.09) continue;
      const d = (np.getY(i) - ctr.y) * dy + ((sideAxis === 'x' ? np.getX(i) : np.getZ(i)) - (sideAxis === 'x' ? ctr.x : ctr.z)) * ds;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) picked.push(best);
    void vi;
  }
  const si = src.getAttribute('skinIndex'); const sw = src.getAttribute('skinWeight');
  const R = Math.min(size.x, size.z) * 0.22;
  const parts = [];
  const lightC = lin(hex); const darkC = lin(shadeHex);
  for (const [k, vi] of picked.entries()) {
    const pos = new THREE.Vector3().fromBufferAttribute(np, vi);
    const nrm = new THREE.Vector3().fromBufferAttribute(nn, vi).normalize();
    const rad = R * (0.8 + r() * 0.4);
    pos.addScaledVector(nrm, -rad * (0.35 + r() * 0.15));                // 60-75 % of the mass under the skin
    const g = blob(rad, hex, { detail: 1, amp: 0.18, seed: seed + k, creaseDeg: 80, sy: 0.85 });
    g.translate(pos.x, pos.y, pos.z);
    // shade: ivory on top, a warm grey underneath
    const gp = g.getAttribute('position'); const gc = g.getAttribute('color'); const cc = new THREE.Color();
    for (let q = 0; q < gp.count; q++) { const t = Math.min(1, Math.max(0, (gp.getY(q) - (b.min.y + size.y * 0.3)) / (size.y * 0.6))); cc.copy(darkC).lerp(lightC, t); gc.setXYZ(q, cc.r, cc.g, cc.b); }
    // nearest host vertex (in the un-welded source): its joints and weights
    let best = 0; let bd = Infinity;
    for (let v = 0; v < p.count; v += 2) { const d = (p.getX(v) - pos.x) ** 2 + (p.getY(v) - pos.y) ** 2 + (p.getZ(v) - pos.z) ** 2; if (d < bd) { bd = d; best = v; } }
    const m = gp.count;
    const J = new Float32Array(m * 4); const W = new Float32Array(m * 4);
    for (let v = 0; v < m; v++) for (let q = 0; q < 4; q++) { J[v * 4 + q] = si.getComponent(best, q); W[v * 4 + q] = sw.getComponent(best, q); }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(J, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(W, 4));
    g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(m), 1));
    g.applyMatrix4(Rinv);
    parts.push(g);
  }
  const out = mergeGeometries(parts.map((x) => (x.index ? x.toNonIndexed() : x)), false);
  out.userData.material = host0.userData.material;
  return out;
}

/**
 * Shrink the parts of a skinned mesh that hang on some bones toward the first bone of their chain (wave 2: the
 * Donkey's long ears become a goat's), in bind space: a vertex led by 'Ear3.L' moves toward the bind position of
 * 'Ear1.L' by the factor k. The rigid twin is baked from this mesh, so far goats get the short ears too.
 */
function shrinkBones(list, skin, { bones, k = 0.6, root = (name) => name.replace(/\d+/, '1') }) {
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const el = []; const m = new THREE.Matrix4();
  const bindPos = joints.map((j, i) => { ibm.getElement(i, el); m.fromArray(el).invert(); return new THREE.Vector3().setFromMatrixPosition(m); });
  const names = joints.map((j) => j.getName());
  const target = new Map();
  names.forEach((n, i) => { if (bones.test(n)) { const r = names.indexOf(root(n)); if (r >= 0) target.set(i, bindPos[r]); } });
  const v = new THREE.Vector3();
  for (const g of list) {
    const p = g.getAttribute('position'); const si = g.getAttribute('skinIndex'); const sw = g.getAttribute('skinWeight');
    for (let i = 0; i < p.count; i++) {
      let jMax = -1; let wMax = -1;
      for (let q = 0; q < 4; q++) if (sw.getComponent(i, q) > wMax) { wMax = sw.getComponent(i, q); jMax = si.getComponent(i, q); }
      const t = target.get(jMax);
      if (!t) continue;
      v.fromBufferAttribute(p, i).sub(t).multiplyScalar(k).add(t);
      p.setXYZ(i, v.x, v.y, v.z);
    }
  }
}

/**
 * Parts riding on one bone of a skinned model (wave 2: the goat's horns and beard on the Donkey's head): `build(ctx)`
 * returns geometries in the mesh's bind space; ctx has the bone's vertex box (`box`), the body box (`body`) and the
 * forward direction (`fwd`, body centre -> that bone's vertices). Every new vertex is weighted 1 to the bone.
 */
function boneParts(list, jointIndex, build) {
  const all = new THREE.Box3(); const box3 = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const g of list) {
    const p = g.getAttribute('position'); const si = g.getAttribute('skinIndex'); const sw = g.getAttribute('skinWeight');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); all.expandByPoint(v);
      let jMax = -1; let wMax = -1;
      for (let q = 0; q < 4; q++) if (sw.getComponent(i, q) > wMax) { wMax = sw.getComponent(i, q); jMax = si.getComponent(i, q); }
      if (jMax === jointIndex) box3.expandByPoint(v);
    }
  }
  if (box3.isEmpty()) return [];
  const fwd = box3.getCenter(new THREE.Vector3()).sub(all.getCenter(new THREE.Vector3())); fwd.y = 0; fwd.normalize();
  const geos = build({ box: box3, body: all, fwd });
  return geos.map((g0) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const m = g.getAttribute('position').count;
    const J = new Float32Array(m * 4); const W = new Float32Array(m * 4);
    for (let i = 0; i < m; i++) { J[i * 4] = jointIndex; W[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(J, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(W, 4));
    g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(m), 1));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    return g;
  });
}

/** Merge every primitive that uses the same skin into one mesh: one primitive per material (keepMaterials)
 *  or a single vertex-coloured primitive. Normals are creased; colours boosted. */
/** A darker saddle over the top of a coat (wave 4: the German Shepherd's black saddle on the Wolf): the vertices of the
 *  `mat` parts above `from` of the model's upright height take `hex`, blended over a short band. */
function saddlePaint(list, { mat, hex, from = 0.6, band = 0.06 }, rot) {
  const t = lin(hex); const v = new THREE.Vector3();
  let y0 = Infinity; let y1 = -Infinity;
  for (const g of list) { const p = g.getAttribute('position'); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(rot); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); } }
  const H = Math.max(1e-6, y1 - y0);
  for (const g of list) {
    if (!mat.test(g.userData.material)) continue;
    const p = g.getAttribute('position'); const c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(rot);
      const k = Math.min(1, Math.max(0, ((v.y - y0) / H - from) / band));
      if (k > 0) c.setXYZ(i, c.getX(i) + (t.r - c.getX(i)) * k, c.getY(i) + (t.g - c.getY(i)) * k, c.getZ(i) + (t.b - c.getZ(i)) * k);
    }
  }
}

async function mergeSkinned(doc, { keepMaterials = false, recolor = {}, sat = 0.18, creaseDeg = 45, tintMat = null, patches = null, lobes = null, attach = null, shrink = null, coat = null, saddle = null, parts = null } = {}) {
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const skinned = root.listNodes().filter((n) => n.getMesh() && n.getSkin());
  const bySkin = new Map();
  for (const n of skinned) { const k = n.getSkin(); if (!bySkin.has(k)) bySkin.set(k, []); bySkin.get(k).push(n); }
  const vcMat = keepMaterials ? null : doc.createMaterial('vc').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(1);
  for (const [, nodes] of bySkin) {
    const groups = new Map();   // material key -> list of three geometries
    const mats = new Map();
    for (const node of nodes) {
      for (const prim of node.getMesh().listPrimitives()) {
        const mat = prim.getMaterial();
        const pos = readAttr(prim.getAttribute('POSITION'));
        const n = pos.length / 3;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const nrm = readAttr(prim.getAttribute('NORMAL'));
        if (nrm) g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); else g.computeVertexNormals();
        g.setAttribute('skinIndex', new THREE.BufferAttribute(readAttr(prim.getAttribute('JOINTS_0')), 4));
        g.setAttribute('skinWeight', new THREE.BufferAttribute(readAttr(prim.getAttribute('WEIGHTS_0')), 4));
        const c = matColor(mat, { recolor, sat });
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        // the player-colour mask (one skinned mesh per farmer, the clothing tinted in the shader: performance-12)
        const mname = mat ? mat.getName() : '';
        g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n).fill(tintMat && mname === tintMat ? 1 : 0), 1));
        // wave 4 (owner wish 9): which part of the farmer a vertex is (skin, top, bottom, hair, hat, brows: AV_PART)
        if (parts) g.setAttribute('part', new THREE.BufferAttribute(new Float32Array(n).fill(parts(node.getName(), mname)), 1));
        g.userData.material = mname;
        const idx = prim.getIndices();
        if (idx) g.setIndex(Array.from(idx.getArray()));
        const key = keepMaterials ? (mat ? mat.getName() : 'none') : 'vc';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(g);
        if (keepMaterials && mat) {
          mat.setMetallicFactor(0).setRoughnessFactor(1);
          mat.setBaseColorFactor([c.r, c.g, c.b, 1]);
          mats.set(key, mat);
        }
      }
    }
    const mesh = doc.createMesh('skinned');
    for (const [key, list] of groups) {
      if (patches) for (const g of list) if (patches.mat.test(g.userData.material)) cowPatches(g, patches);
      if (saddle) saddlePaint(list, saddle, new THREE.Matrix4().extractRotation(new THREE.Matrix4().fromArray(nodes[0].getWorldMatrix())));
      if (lobes) {
        const host = list.find((g) => lobes.mat.test(g.userData.material));
        const face = lobes.head ? list.find((g) => lobes.head.test(g.userData.material)) : null;
        const head = face ? new THREE.Box3().setFromBufferAttribute(face.getAttribute('position')).getCenter(new THREE.Vector3()) : null;
        const rot = new THREE.Matrix4().extractRotation(new THREE.Matrix4().fromArray(nodes[0].getWorldMatrix()));
        if (host) list.push(woolLobes(host, { ...lobes, head, rot }));
      }
      if (shrink) shrinkBones(list, nodes[0].getSkin(), shrink);
      if (attach) {
        const skin = nodes[0].getSkin();
        const j = skin.listJoints().findIndex((n) => n.getName() === attach.bone);
        if (j >= 0) list.push(...boneParts(list, j, attach.build).map((g) => { g.userData.material = attach.material || ''; return g; }));
      }
      if (coat) coatMask(list, coat);
      const merged = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
      const geo = creaseDeg ? crease(merged, creaseDeg) : weld(merged);
      const a = (name) => geo.getAttribute(name).array;
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', writeAccessor(doc, buffer, new Float32Array(a('position')), 'VEC3'))
        .setAttribute('NORMAL', writeAccessor(doc, buffer, new Float32Array(a('normal')), 'VEC3'))
        .setAttribute('JOINTS_0', writeAccessor(doc, buffer, Uint16Array.from(a('skinIndex'), (v) => Math.round(v)), 'VEC4'))
        .setAttribute('WEIGHTS_0', writeAccessor(doc, buffer, new Float32Array(a('skinWeight')), 'VEC4'))
        .setMaterial(keepMaterials ? mats.get(key) : vcMat);
      if (!keepMaterials) prim.setAttribute('COLOR_0', writeAccessor(doc, buffer, new Float32Array(a('color')), 'VEC3'));
      if (!keepMaterials && tintMat) prim.setAttribute('_TINT', writeAccessor(doc, buffer, new Float32Array(a('tint')), 'SCALAR'));
      if (parts && geo.getAttribute('part')) prim.setAttribute('_PART', writeAccessor(doc, buffer, new Float32Array(a('part')), 'SCALAR'));
      if (coat && geo.getAttribute('coat')) prim.setAttribute('_COAT', writeAccessor(doc, buffer, new Float32Array(a('coat')), 'VEC3'));
      const ia = geo.index.array;
      prim.setIndices(writeAccessor(doc, buffer, ia.length > 0 && geo.getAttribute('position').count > 65535 ? new Uint32Array(ia) : new Uint16Array(ia), 'SCALAR'));
      mesh.addPrimitive(prim);
    }
    nodes[0].setMesh(mesh);
    for (const n of nodes.slice(1)) n.setMesh(null);
  }
}

/** Bake a skinned three scene, posed at frame 0 of `clip`, into one static geometry (colours from vertex
 *  colours or material colours) in the scene's world space. */
function bakePose(gltf, clipName, { boneScale = null } = {}) {
  const scene = gltf.scene;
  const clip = gltf.animations.find((c) => c.name === clipName) || gltf.animations[0];
  if (clip) {
    const mixer = new THREE.AnimationMixer(scene);
    mixer.clipAction(clip).play();
    mixer.update(0.0);
  }
  // a baby's proportions (wave 3, RD-15): bone scales over the pose (a bigger head, shorter legs); the caller grounds it
  if (boneScale) scene.traverse((o) => { if (o.isBone && Object.hasOwn(boneScale, o.name)) o.scale.multiplyScalar(boneScale[o.name]); });
  scene.updateMatrixWorld(true);
  const parts = [];
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const n = g.getAttribute('position').count;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      if (o.isSkinnedMesh) o.getVertexPosition(i, v); else v.fromBufferAttribute(g.getAttribute('position'), i);
      v.applyMatrix4(o.matrixWorld);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const col = g.getAttribute('color');
    if (col) {
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = col.getX(i); a[i * 3 + 1] = col.getY(i); a[i * 3 + 2] = col.getZ(i); }
      out.setAttribute('color', new THREE.BufferAttribute(a, 3));
    } else paint(out, o.material.color.clone());
    const ca = g.getAttribute('_coat');
    if (ca) { const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = ca.getX(i); a[i * 3 + 1] = ca.getY(i); a[i * 3 + 2] = ca.getZ(i); } out.setAttribute('coat', new THREE.BufferAttribute(a, 3)); }
    if (g.index) out.setIndex(Array.from(g.index.array));
    parts.push(out.index ? out.toNonIndexed() : out);
  });
  const g = mergeAll(parts.map((x) => { x.computeVertexNormals(); return x; }));
  return crease(g, 45);
}

const SKIN = [];
/** A skinned model: rel source, target height (m), clips to keep {srcName: newName}, options. */
function skinnedJob(key, file, rel, { height, clips, keepMaterials = false, recolor = {}, sat = 0.18, rigid = true, idle = 'Idle', meta = {}, postBake,
  tintMat = null, patches = null, lobes = null, attach = null, shrink = null, yaw = 0, coat = null, baby = null, saddle = null, parts = null } = {}) {
  SKIN.push({ key, file, rel, height, clips, keepMaterials, recolor, sat, rigid, idle, meta, postBake, tintMat, patches, lobes, attach, shrink, yaw, coat, baby, saddle, parts });
}

async function buildSkinned(sk) {
  const t = await tools();
  const doc = await t.io.read(await sourcePath(sk.rel));       // a fresh copy: this document is edited
  const root = doc.getRoot();
  for (const c of root.listCameras()) c.dispose();
  // clips: rename "Armature|Walk" -> "Walk", keep only the wanted ones
  for (const anim of root.listAnimations()) {
    const base = anim.getName().replace(/^.*\|/, '');
    if (!Object.hasOwn(sk.clips, base)) anim.dispose(); else anim.setName(sk.clips[base]);
  }
  await mergeSkinned(doc, { keepMaterials: sk.keepMaterials, recolor: sk.recolor, sat: sk.sat, tintMat: sk.tintMat, patches: sk.patches, lobes: sk.lobes, attach: sk.attach, shrink: sk.shrink, coat: sk.coat, saddle: sk.saddle, parts: sk.parts });
  await doc.transform(t.fns.prune(), t.fns.resample(), t.fns.dedup());
  // measure (posed at the idle clip) and normalise: feet on y = 0, centred on x/z, target height
  const g1 = await parseThree(doc);
  const posed = bakePose(g1, sk.clips[sk.idle] || sk.idle);
  // a source modelled facing another way turns to face +z like every other animal (the views walk them along +z)
  const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sk.yaw || 0);
  if (sk.yaw) posed.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(yawQ));
  const b = bounds(posed);
  const s = sk.height / (b.max.y - b.min.y);
  const scene = root.listScenes()[0];
  const top = doc.createNode(nodeName(sk.key)).setExtras({ key: sk.key }).setScale([s, s, s])
    .setTranslation([-(b.min.x + b.max.x) / 2 * s, -b.min.y * s, -(b.min.z + b.max.z) / 2 * s]);
  if (sk.yaw) top.setRotation(yawQ.toArray());
  for (const c of scene.listChildren()) { scene.removeChild(c); top.addChild(c); }
  scene.addChild(top);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...top.getTranslation()), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
  posed.applyMatrix4(m);
  const pb = bounds(posed);
  const entry = { file: sk.file, node: nodeName(sk.key), kind: 'skinned', ...sk.meta, anim: Object.values(sk.clips),
    size: [pb.max.x - pb.min.x, pb.max.y - pb.min.y, pb.max.z - pb.min.z].map(r3), min: pb.min.toArray().map(r3), max: pb.max.toArray().map(r3),
    tris: tris(posed), scale: r3(s) };
  if (sk.rigid) {
    let rigidGeo = posed;
    if (sk.postBake) rigidGeo = sk.postBake(rigidGeo);
    sway(rigidGeo, { rigid: true });
    entry.rigidNode = `${nodeName(sk.key)}-rigid`;
    // static twin in the same file, as its own top-level node (models.js finds it by extras.key '<key>#rigid')
    const statics = [{ key: sk.key, geometry: rigidGeo.index ? rigidGeo : weld(rigidGeo), nodeSuffix: '-rigid' }];
    // the baby (wave 3, RD-15: "piglets, kids and foals are scaled adults"): the idle pose with the baby's bone scales
    // (a bigger head, shorter legs), at the adult's scale and grounded; animals-view draws it at babyScale() and gives
    // a near skinned baby the same bones (BABY_BONES)
    if (sk.baby) {
      // (the document's top node already carries the adult's normalising scale and turn)
      const bg = bakePose(await parseThree(doc), sk.clips[sk.idle] || sk.idle, { boneScale: sk.baby.bones });
      const bb = bounds(bg); bg.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      sway(bg, { rigid: true });
      const bkey = `${sk.key}:baby`;
      statics.push({ key: bkey, geometry: weld(bg) });
      const b2 = bounds(bg);
      manifest.keys[bkey] = { file: sk.file, node: nodeName(bkey), kind: 'rigid', family: 'animal', def: sk.meta.def, baby: true, footprint: [1, 1], speed: sk.meta.speed,
        size: [b2.max.x - b2.min.x, b2.max.y - b2.min.y, b2.max.z - b2.min.z].map(r3), min: b2.min.toArray().map(r3), max: b2.max.toArray().map(r3), tris: tris(bg), scale: 1 };
      registerDef(bkey, { def: sk.meta.def, family: 'animal' });
    }
    await writeStaticFile(sk.file, { statics }, doc);
  } else {
    await finishDoc(doc, sk.file);
  }
  manifest.keys[sk.key] = entry;
  registerDef(sk.key, sk.meta);
}

const UAA_CLIPS = { Idle: 'Idle', Idle_2: 'Idle2', Idle_Headlow: 'Graze', Eating: 'Eat', Walk: 'Walk', Gallop: 'Run', Jump_toIdle: 'Jump', Idle_HitReact1: 'React' };
/** A baby's bone scales (wave 3, RD-15; animals-view BABY_BONES matches them for the near, skinned baby). */
const UAA_BABY = { bones: { Head: 1.5, 'FrontUpperLeg.L': 0.82, 'FrontUpperLeg.R': 0.82, 'BackUpperLeg.L': 0.82, 'BackUpperLeg.R': 0.82, Neck1: 0.85 } };
const FA_BABY = { bones: { Head: 1.45, 'FrontUpLeg.L': 0.85, 'FrontUpLeg.R': 0.85, 'BackUpLeg.L': 0.85, 'BackUpLeg.R': 0.85 } };
skinnedJob('animal:cow', 'animals/cow.glb', 'quaternius-ultimate-animated-animals/glTF/Cow.gltf', { height: 1.35, clips: UAA_CLIPS,
  recolor: { Main: '#B8743E', Main_Light: '#FFF4E2', Muzzle: '#F2B6A8', Horns: '#F3E6C8', Hooves: '#4A3A30' },
  patches: { mat: /^Main$/, hex: '#F6EBD6', share: 0.26 }, coat: { mat: /^Main/, share: 0.34, seed: 5 }, baby: UAA_BABY,
  meta: { family: 'animal', def: 'cow', headBone: 'Head', speed: 0.6, product: 'milk' } });
skinnedJob('animal:sheep', 'animals/sheep.glb', 'quaternius-farm-animals/FBX/Sheep.fbx', { height: 1.0, clips: { Idle: 'Idle', Jump: 'Jump' },
  recolor: { White: '#F1EBDD', Black: '#3A3236' }, lobes: { mat: /^White$/, n: 16, head: /^Black$/ }, coat: { mat: /^White$/, share: 0.3, seed: 7 }, baby: FA_BABY,
  meta: { family: 'animal', def: 'sheep', headBone: 'Head', speed: 0.5, hop: true, product: 'wool' } });
skinnedJob('animal:pig', 'animals/pig.glb', 'quaternius-farm-animals/FBX/Pig.fbx', { height: 0.85, clips: { Idle: 'Idle', Jump: 'Jump' },
  recolor: { 'Material.003': '#F4A7B0', Material: '#E58C9A' }, coat: { mat: /^Material/, share: 0.3, seed: 9 }, baby: FA_BABY,
  meta: { family: 'animal', def: 'pig', headBone: 'Head', speed: 0.5, hop: true, product: 'truffle' } });
skinnedJob('animal:horse', 'animals/horse.glb', 'quaternius-ultimate-animated-animals/glTF/Horse.gltf', { height: 1.75, clips: UAA_CLIPS,
  coat: { mat: /^Main/, share: 0.32, seed: 11 }, baby: UAA_BABY, meta: { family: 'animal', def: 'horse', headBone: 'Head', speed: 0.8, product: 'manure' } });
// The Alpaca (wave 3, M2): a fluffy fleece over the body and up the neck (wool lobes like the sheep's), a pom-pom topknot
// on the head between the ears, a coat (breeding) and a baby of its own (the cria)
function alpacaTopknot({ box: hb, fwd }) {
  const hs = hb.getSize(new THREE.Vector3()); const hc = hb.getCenter(new THREE.Vector3());
  const top = hc.clone().addScaledVector(fwd, -hs.length() * 0.12); top.y = hb.max.y - hs.y * 0.08;
  const r = Math.max(hs.x, hs.z) * 0.32;
  return [xform(blob(r, '#FBF4E6', { seed: 8, amp: 0.25, detail: 1, sy: 0.8 }), { x: top.x, y: top.y, z: top.z }),
    xform(blob(r * 0.7, '#F2E6D2', { seed: 9, amp: 0.25, detail: 1, sy: 0.8 }), { x: top.x - fwd.x * r * 0.6, y: top.y - r * 0.2, z: top.z - fwd.z * r * 0.6 })];
}
skinnedJob('animal:alpaca', 'animals/alpaca.glb', 'quaternius-ultimate-animated-animals/glTF/Alpaca.gltf', { height: 1.7, clips: UAA_CLIPS,
  recolor: { Main: '#F2E6D2', Main_Light: '#FFF8EC', Main_Dark: '#C9B08A', Muzzle: '#3A3030' }, lobes: { mat: /^Main$/, n: 16, head: /^Muzzle$/, hex: '#FBF4E6', shadeHex: '#E2D3BC' },
  attach: { bone: 'Head', build: alpacaTopknot, material: 'Main' }, coat: { mat: /^Main/, share: 0.3, seed: 13 }, baby: UAA_BABY,
  meta: { family: 'animal', def: 'alpaca', headBone: 'Head', speed: 0.6, product: 'alpaca_fiber' } });
/** A goat's horns and beard on the Donkey's head (bind space): two horns sweeping back from the crown, tapering
 *  in four segments, and a little beard under the chin (assets-catalog §3.4: "horn cones and a beard on Head"). */
function goatHead({ box: hb, fwd }) {
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const hs = hb.getSize(new THREE.Vector3()); const hc = hb.getCenter(new THREE.Vector3());
  const H = hs.y; const Wd = Math.max(hs.x, hs.z);
  const out = [];
  const seg = (a, b, r0, r1, hex) => {
    const d = b.clone().sub(a); const len = d.length();
    const g = P(new THREE.CylinderGeometry(r1, r0, len, 5, 1, false), hex, { creaseDeg: 60 });
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.normalize()));
    g.translate(a.x, a.y, a.z);
    return g;
  };
  for (const sgn of [-1, 1]) {
    const base = hc.clone().addScaledVector(fwd, -hs.length() * 0.08).addScaledVector(side, sgn * Wd * 0.16); base.y = hb.max.y - H * 0.08;
    const pts = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      pts.push(base.clone().addScaledVector(up, H * 0.62 * Math.sin(t * 1.25)).addScaledVector(fwd, -H * 0.55 * t * t).addScaledVector(side, sgn * H * 0.08 * t));
    }
    for (let k = 0; k < 4; k++) out.push(seg(pts[k], pts[k + 1], H * 0.13 * (1 - k * 0.22), H * 0.13 * (1 - (k + 1) * 0.22) + 0.001, k === 3 ? '#8E7A5E' : '#C4B08C'));
  }
  // the beard under the chin: a short cone pointing down at the front of the head
  const chin = hc.clone().addScaledVector(fwd, hs.length() * 0.28); chin.y = hb.min.y + H * 0.12;
  const beard = P(new THREE.ConeGeometry(H * 0.1, H * 0.38, 5), '#E9E2D2', { creaseDeg: 60 });
  beard.rotateX(Math.PI); beard.translate(chin.x, chin.y - H * 0.16, chin.z);
  out.push(beard);
  return out;
}
// The goat (wave 2): the UAA Donkey's sturdier body (the Deer read as a deer), cream with a soft crest, horns and a
// beard on its head bone; its long ears are shortened at runtime (animals-view SPECIES_BONES).
skinnedJob('animal:goat', 'animals/goat.glb', 'quaternius-ultimate-animated-animals/glTF/Donkey.gltf', { height: 1.0, clips: UAA_CLIPS,
  recolor: { Main: '#F2ECDF', Main_Light: '#FFFDF6', Main_Dark: '#D9CDB4', Hair: '#E4DACA', Muzzle: '#E8C4B4', Hooves: '#5A4A3A' },
  attach: { bone: 'Head', build: goatHead }, shrink: { bones: /^Ear\d\.[LR]$/, k: 0.55 }, coat: { mat: /^(Main|Hair)/, share: 0.3, seed: 15 }, baby: UAA_BABY,
  meta: { family: 'animal', def: 'goat', headBone: 'Head', speed: 0.6, product: 'goat_milk' } });
// Dog and cat (pets, GDD §3.4 L10)
// wave 4: + the Death clip as 'Lie' (its last frame lies on its side: the pet's sleeping pose at night, avatars-view)
skinnedJob('animal:dog', 'animals/dog.glb', 'quaternius-ultimate-animated-animals/glTF/ShibaInu.gltf', { height: 0.62, clips: { Idle: 'Idle', Idle_2: 'Idle2', Eating: 'Eat', Walk: 'Walk', Gallop: 'Run', Jump_ToIdle: 'Jump', Death: 'Lie' },
  meta: { family: 'animal', def: 'dog', headBone: 'Head', speed: 1.2 } });

// The cat (pets, GDD §3.4 L10; assets-catalog: Quaternius Vol.2 Cat): a ginger tabby with a cream chest.
skinnedJob('animal:cat', 'animals/cat.glb', 'quaternius-animal-pack-vol2/Animal Pack Vol.2 by @Quaternius/FBX/Cat.fbx', { height: 0.42, yaw: -Math.PI / 2,
  clips: { Idle: 'Idle', Walking: 'Walk' }, recolor: { White: '#FFF1DC', Grey: '#E8964A', Pink: '#F4A6A0' },
  meta: { family: 'animal', def: 'cat', headBone: 'Head', speed: 1.1 } });

// The two farmers (GDD §3.5 catalog; avatars keep named materials so a clothing material takes the player colour).
// (no fighting clips: a wholesome farm; the high-five is two raised hands, i.e. Wave toward each other)
const AV_CLIPS = { Idle: 'Idle', Idle_Neutral: 'IdleNeutral', Walk: 'Walk', Run: 'Run', Interact: 'Interact', Wave: 'Wave', Roll: 'Roll', HitRecieve: 'Bonk' };
// One skinned mesh with vertex colours per farmer (performance-12: 8 primitives were 9 draw calls); the clothing
// that takes the player colour is a vertex mask (_TINT) the material mixes toward a per-clone uniform.
/** The farmers' parts for the look editor (wave 4, owner wish 9; avatars-view AV_PART): 1 skin, 2 top (A's shirt, B's
 *  tee), 3 bottom (A's overalls, B's trousers), 4 hair (B's, hideable for another style), 5 hat (A's straw hat, hideable),
 *  6 brows (hair-coloured, never hidden), 0 the rest (boots, shoes, eyes, buttons). */
const AV_PARTS = (node, mat) => (mat === 'Skin' ? 1 : mat === 'Eyebrows' || mat === 'Hair_Brown' ? 6 : /^Hair/.test(mat) ? 4
  : /Head/.test(node) && /^(Beige|Red)$/.test(mat) ? 5 : /Pants|Legs/.test(node) || mat === 'LightBlue' ? 3
    : /Body/.test(node) && (mat === 'Brown' || mat === 'White') ? 2 : 0);
skinnedJob('avatar:farmer_a', 'avatars/farmer_a.glb', 'quaternius-ultimate-modular-men/Individual Characters/glTF/Farmer.gltf', { height: 1.95, clips: AV_CLIPS,
  keepMaterials: false, tintMat: 'LightBlue', rigid: false, sat: 0.15, recolor: { Skin: '#F2C29A' }, parts: AV_PARTS,
  meta: { family: 'avatar', def: 'farmer_a', tint: 'LightBlue', hand: 'WristR', head: 'Head', hair: 'none', hat: 'straw_hat' } });
skinnedJob('avatar:farmer_b', 'avatars/farmer_b.glb', 'quaternius-ultimate-modular-women/Individual Characters/glTF/Casual.gltf', { height: 1.9, clips: AV_CLIPS,
  keepMaterials: false, tintMat: 'White', rigid: false, sat: 0.15, recolor: { Skin: '#F5C7A6' }, parts: AV_PARTS,
  meta: { family: 'avatar', def: 'farmer_b', tint: 'White', hand: 'WristR', head: 'Head', hair: 'long', hat: 'none' } });

// Grandma Hazel (wave 3, content GRANDMA_VISIT: render-world stages her stroll; avatars-view's CHIBI cut gives her the
// farmers' proportions): silver hair in a bun, a lavender dress, a cream cardigan; Idle / Walk / Wave / Interact clips
// and a rigid twin for the far band.
skinnedJob('npc:grandma', 'avatars/grandma.glb', 'quaternius-ultimate-modular-women/Individual Characters/glTF/Formal.gltf', { height: 1.78, clips: AV_CLIPS,
  keepMaterials: false, sat: 0.12, recolor: { Skin: '#F2C8A8', Red: '#DCD8D0', LimeGreen: '#9C7FB8', Brown: '#5A4A3A', Gold: '#E9D6A8' },
  meta: { family: 'npc', def: 'grandma', hand: 'WristR', head: 'Head' } });

// Rigid small animals (procedural motion in animals-view; GDD §8.6 "rigid instanced"): chicken, duck + babies, bee.
/**
 * A hen (wave 2, VISUAL-AFTER C2): the vertexcat hen's parts sorted by their own colour: the plumage (body and
 * wings, low-saturation browns) takes the variant colour keeping its shading; the comb, the wattles and the face
 * (saturated oranges) become a proper red #B94232-ish, the beak a warm #D8A34C, the legs stay yellow, the eyes keep
 * their dark and white. Wave 1 recoloured every brown-to-yellow hue, so the cream hen lost her comb and beak.
 */
function hen(plumageHex = null) {
  return (async () => {
    const g = toHeight(await bakeStatic('vertexcat-farm-animals/ChickenBrown.fbx', { sat: 0.25 }), 0.74);
    const { src, list } = components(g);
    const c = src.getAttribute('color');
    const plumage = new Uint8Array(src.getAttribute('position').count);
    const col = new THREE.Color(); const h = {};
    const t = plumageHex ? lin(plumageHex) : null; const th = {}; if (t) t.getHSL(th, THREE.SRGBColorSpace);
    const red = lin('#C23E30'); const redHi = lin('#E05A44'); const beak = lin('#D8A34C');
    for (const comp of list) {
      // the component's dominant colour decides what it is
      const votes = new Map();
      for (const f of comp.faces) { col.setRGB(c.getX(f * 3), c.getY(f * 3), c.getZ(f * 3)); const k = col.getHex(); votes.set(k, (votes.get(k) || 0) + 1); }
      const dom = new THREE.Color([...votes].sort((a, b) => b[1] - a[1])[0][0]);
      dom.getHSL(h, THREE.SRGBColorSpace);
      const kind = h.l > 0.9 ? 'eye' : h.h > 0.11 ? (comp.faces.length <= 16 ? 'beak' : 'leg') : h.l < 0.32 ? 'eye' : h.s >= 0.6 ? 'red' : 'plumage';
      if (kind === 'eye' || kind === 'leg') continue;
      if (kind === 'plumage') for (const f of comp.faces) for (let j = 0; j < 3; j++) plumage[f * 3 + j] = 1;
      let sumL = 0; let n = 0;
      for (const f of comp.faces) for (let j = 0; j < 3; j++) { col.setRGB(c.getX(f * 3 + j), c.getY(f * 3 + j), c.getZ(f * 3 + j)); col.getHSL(h, THREE.SRGBColorSpace); sumL += h.l; n++; }
      const avg = n ? sumL / n : 0.5;
      for (const f of comp.faces) for (let j = 0; j < 3; j++) {
        const i = f * 3 + j;
        col.setRGB(c.getX(i), c.getY(i), c.getZ(i)); col.getHSL(h, THREE.SRGBColorSpace);
        if (kind === 'red') col.copy(red).lerp(redHi, Math.min(1, Math.max(0, (h.l - avg) * 3 + 0.4)));
        else if (kind === 'beak') col.copy(beak).multiplyScalar(0.85 + 0.3 * (h.l / Math.max(0.1, avg) - 0.5));
        else if (t) col.setHSL(th.h, th.s, Math.min(0.95, Math.max(0.05, th.l * (h.l / avg))), THREE.SRGBColorSpace);
        else continue;
        c.setXYZ(i, col.r, col.g, col.b);
      }
    }
    // wave 3: the plumage takes a bred coat (white, brown, speckled, golden)
    coatAttribute(src, { isCoat: (i) => plumage[i] === 1, share: 0.3, freq: 11, seed: 17 });
    return sway(src, { rigid: true });
  })();
}
job('animal:chicken', 'animals/chicken.glb', { family: 'animal', def: 'chicken', kind: 'rigid', speed: 0.45, product: 'egg', footprint: [1, 1] }, async () => hen(null));
['#9A5B34', '#D2A86A', '#EBDDBB'].forEach((hex, v) => {
  job(`animal:chicken:v${v}`, 'animals/chicken.glb', { family: 'animal', kind: 'rigid', speed: 0.45, footprint: [1, 1], part: true }, async () => hen(hex));
});
/** RD-14 (QA wave 2): the source duck's neck is long for a chunky farm duck: compress the neck band to 70 % and drop
 *  the head with it (rigidly), so the head sits closer to the body. */
function shortNeck(g, { from = 0.5, to = 0.78, k = 0.7 } = {}) {
  const b = bounds(g); const H = b.max.y - b.min.y;
  const y0 = b.min.y + H * from; const yh = b.min.y + H * to;
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > y0) p.setY(i, y - (Math.min(y, yh) - y0) * (1 - k));
  }
  p.needsUpdate = true;
  return crease(g, 50);
}
job('animal:duck', 'animals/duck.glb', { family: 'animal', def: 'duck', kind: 'rigid', speed: 0.45, product: 'duck_egg', footprint: [1, 1] },
  async () => {
    const g = toHeight(shortNeck(await bakeStatic('vertexcat-farm-animals/DuckWhite.fbx', { sat: 0.2 })), 0.6);
    const c = g.getAttribute('color'); const col = new THREE.Color(); const h = {};
    coatAttribute(g, { isCoat: (i) => { col.setRGB(c.getX(i), c.getY(i), c.getZ(i)); col.getHSL(h, THREE.SRGBColorSpace); return h.l > 0.3 && !(h.s > 0.45 && h.h < 0.16); }, share: 0.3, freq: 9, seed: 19 });
    return sway(g, { rigid: true });
  });
function chick(body = '#FFE14A', wing = '#FFD21F') {
  const fluff = (g) => { const n = g.getAttribute('position').count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = 1; a[i * 3 + 2] = 0.5; } g.setAttribute('coat', new THREE.BufferAttribute(a, 3)); return g; };
  const bare = (g) => { const n = g.getAttribute('position').count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a[i * 3 + 2] = 0.5; g.setAttribute('coat', new THREE.BufferAttribute(a, 3)); return g; };
  const g = chickParts(body, wing, fluff, bare);
  const m = g.getAttribute('coat');
  return coatAttribute(g, { isCoat: (i) => m.getX(i) > 0.5, share: 0.35, freq: 6, seed: 23 });
}
function chickParts(body, wing, fluff, bare) {
  return mergeAll([fluff(xform(blob(0.13, body, { seed: 3, amp: 0.06, sy: 0.92 }), { y: 0.14 })), fluff(xform(blob(0.09, body, { seed: 4, amp: 0.05 }), { y: 0.3, z: 0.06 })),
    bare(xform(P(new THREE.ConeGeometry(0.03, 0.06, 6), '#F5A623'), { rx: Math.PI / 2, y: 0.3, z: 0.16 })),
    bare(ball(0.016, '#2A1A10', { x: -0.045, y: 0.33, z: 0.13 }, 0)), bare(ball(0.016, '#2A1A10', { x: 0.045, y: 0.33, z: 0.13 }, 0)),
    fluff(xform(blob(0.06, wing, { seed: 5, sx: 0.5 }), { x: -0.12, y: 0.15 })), fluff(xform(blob(0.06, wing, { seed: 6, sx: 0.5 }), { x: 0.12, y: 0.15 })),
    bare(cyl(0.01, 0.012, 0.05, 4, '#F5A623', { x: -0.04 }, 0)), bare(cyl(0.01, 0.012, 0.05, 4, '#F5A623', { x: 0.04 }, 0))]);
}
job('animal:chicken:baby', 'animals/chicken.glb', { family: 'animal', def: 'chicken', kind: 'rigid', speed: 0.5, footprint: [1, 1] }, async () => sway(xform(chick(), { s: 1.25 }), { rigid: true }));
job('animal:duck:baby', 'animals/duck.glb', { family: 'animal', def: 'duck', kind: 'rigid', speed: 0.5, footprint: [1, 1] }, async () => sway(chick('#FFE9A0', '#F5D76E'), { rigid: true }));
job('animal:bee', 'animals/bee.glb', { family: 'animal', def: 'bee', kind: 'rigid', speed: 1.5, footprint: [1, 1] }, async () => sway(mergeAll([
  xform(blob(0.05, '#FFC83D', { seed: 1, sz: 1.4 }), { y: 0.05 }), xform(torus(0.045, 0.012, '#3A2A1A', {}, 4, 10), { y: 0.05, z: -0.01 }),
  xform(blob(0.035, '#E8F6FF', { seed: 2, sx: 0.4 }), { x: 0.04, y: 0.1 }), xform(blob(0.035, '#E8F6FF', { seed: 3, sx: 0.4 }), { x: -0.04, y: 0.1 })]), { rigid: true }));

// ---------------------------------------------------------------------------------------------------
// 15. Item models for icons (not shipped: tools/make-icons.mjs renders them to PNGs). Generic builders keep
//     families consistent: jars, bottles, sacks, pies, cakes, bowls, yarn, cloth, baskets.
const I = {};   // id -> async () => geometry
const iconOf = new Map();   // id -> { yaw, pitch, margin, src }
const item = (id, build, opt = {}) => { I[id] = build; iconOf.set(id, opt); };
const kf = (n, o = {}) => async () => fit(await bakeStatic(KF(n), { sat: 0.18, ...o }), { w: 1, d: 1, fill: 1 });
const qc = (n, recolor = {}) => async () => fit(await bakeStatic(QC(n), { recolor: { ...GREEN, ...recolor }, sat: 0.2 }), { w: 1, d: 1, fill: 1 });

/** Recolour every vertex toward a target hue/saturation, keeping its lightness (variants of Kenney items). */
function hueTo(g, hex, { keepDark = 0.0 } = {}) {
  const c = g.getAttribute('color'); const t = lin(hex); const th = {}; t.getHSL(th, THREE.SRGBColorSpace);
  const col = new THREE.Color(); const h = {};
  for (let i = 0; i < c.count; i++) {
    col.setRGB(c.getX(i), c.getY(i), c.getZ(i)); col.getHSL(h, THREE.SRGBColorSpace);
    if (h.l < keepDark) continue;
    col.setHSL(th.h, th.s, Math.min(0.95, h.l * 0.5 + th.l * 0.5), THREE.SRGBColorSpace);
    c.setXYZ(i, col.r, col.g, col.b);
  }
  return g;
}
const tinted = (n, hex, o) => async () => hueTo(await kf(n)(), hex, o);

const glassJar = (fill, lid = '#E84A5F', label = '#FFF8EC', top = null) => () => mergeAll([lathe([[0, 0], [0.3, 0], [0.34, 0.1], [0.34, 0.62], [0.26, 0.72], [0, 0.72]], 18, '#D7EEF2'),
  cyl(0.315, 0.315, 0.5, 18, fill, { y: 0.07 }), cyl(0.33, 0.33, 0.24, 18, label, { y: 0.24 }), cyl(0.28, 0.28, 0.12, 18, lid, { y: 0.72 }),
  xform(P(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 8), lid === '#E84A5F' ? '#FFFFFF' : '#FFF8EC'), { y: 0.84 }), ...(top ? top() : [])]);
const bottle = (fill, cap = '#E84A5F', glass = '#D7EEF2') => () => mergeAll([lathe([[0, 0], [0.24, 0], [0.26, 0.08], [0.26, 0.6], [0.12, 0.8], [0.09, 1.0], [0, 1.0]], 16, glass),
  cyl(0.245, 0.245, 0.55, 16, fill, { y: 0.06 }), cyl(0.1, 0.1, 0.1, 12, cap, { y: 0.98 }), cyl(0.27, 0.27, 0.18, 16, '#FFF8EC', { y: 0.3 })]);
// a garnish tells look-alike drinks apart at 64 px (ui-ux-33): an apple wedge, a carrot top ...
const juiceGlass = (fill, garnish = null) => () => mergeAll([cyl(0.23, 0.23, 0.05, 16, '#E2F4F8'), cyl(0.275, 0.225, 0.6, 16, fill, { y: 0.05 }),
  xform(torus(0.275, 0.03, '#F2FBFD', {}, 6, 18), { y: 0.66, rx: Math.PI / 2 }), cyl(0.285, 0.275, 0.1, 16, '#E2F4F8', { y: 0.62 }),
  xform(cyl(0.015, 0.015, 0.7, 6, '#FF7A6B', {}, 0), { rz: 0.35, x: 0.12, y: 0.45 }), ...(garnish ? garnish() : [xform(ball(0.1, fill, { sy: 0.4 }, 1), { x: -0.2, y: 0.74 })])]);
const appleWedge = () => [xform(mergeAll([ball(0.14, '#E2363A', { sy: 0.9 }, 1), ball(0.12, '#FFF3C4', { x: 0.05, sy: 0.85 }, 1)]), { x: -0.2, y: 0.78, rz: 0.4 }),
  xform(leaf(0.12, 0.07, '#5BB040'), { x: -0.24, y: 0.9, rz: -0.6 })];
const carrotTop = () => [xform(P(new THREE.ConeGeometry(0.07, 0.3, 8), '#F07A1C', { creaseDeg: 60 }), { x: -0.2, y: 0.8, rz: 2.6 }),
  ...[0, 1, 2].map((i) => xform(leaf(0.22, 0.06, '#4E9F3A', { bend: 0.3 }), { x: -0.27, y: 0.9, ry: i * 2.1, rz: 0.5 }))];
const lidFruit = (hex, n = 2, r = 0.09) => () => Array.from({ length: n }, (_, i) => ball(r, hex, { x: (i - (n - 1) / 2) * 0.16, y: 0.93 }, 1));
const sackOf = (hex, contents = null, band = '#8A6A40') => () => mergeAll([xform(blob(0.42, hex, { seed: 4, amp: 0.08, sy: 0.9, flatBottom: 0.7 }), { y: 0.38 }),
  cyl(0.24, 0.32, 0.18, 12, hex, { y: 0.72 }), torus(0.26, 0.04, band, { y: 0.8, rx: Math.PI / 2 }),
  ...(contents ? [xform(blob(0.22, contents, { seed: 6, sy: 0.4 }), { y: 0.86 })] : [])]);
const pie = (fill, crust = '#E0A858') => () => mergeAll([lathe([[0, 0], [0.5, 0], [0.56, 0.16], [0.6, 0.2], [0, 0.2]], 20, crust), cyl(0.5, 0.5, 0.05, 20, fill, { y: 0.15 }),
  ...[0, 1, 2, 3].map((i) => box(1.0, 0.04, 0.07, crust, { y: 0.2, ry: (i * Math.PI) / 4 }))]);
const tart = (fill) => () => mergeAll([lathe([[0, 0], [0.5, 0], [0.55, 0.14], [0, 0.14]], 20, '#E0A858'), cyl(0.47, 0.47, 0.04, 20, fill, { y: 0.11 }),
  ...[0, 1, 2, 3, 4, 5].map((i) => ball(0.09, fill, { x: Math.cos(i) * 0.28, y: 0.16, z: Math.sin(i) * 0.28, sy: 0.6 }, 1))]);
const cake = (body, icing = '#FFF8EC', top = '#E83A55', tiers = 1) => () => {
  const parts = [];
  for (let t = 0; t < tiers; t++) {
    const r = 0.5 - t * 0.14; const y = t * 0.36;
    parts.push(cyl(r, r, 0.3, 20, body, { y }), cyl(r + 0.01, r + 0.01, 0.07, 20, icing, { y: y + 0.28 }));
  }
  for (let i = 0; i < 5; i++) parts.push(ball(0.06, top, { x: Math.cos(i * 1.26) * 0.18, y: tiers * 0.36 - 0.02, z: Math.sin(i * 1.26) * 0.18 }, 1));
  return mergeAll(parts);
};
const bowl = (fill, bits = []) => () => mergeAll([lathe([[0, 0], [0.3, 0], [0.5, 0.18], [0.56, 0.36], [0.5, 0.36], [0.3, 0.12], [0, 0.12]], 20, '#FFF8EC'),
  cyl(0.5, 0.5, 0.04, 20, fill, { y: 0.3 }), ...bits.map(([hex, x, z]) => ball(0.08, hex, { x, y: 0.34, z, sy: 0.6 }, 1))]);
const yarnBall = (hex) => () => {
  const parts = [ball(0.42, hex, { y: 0.42 }, 2)];
  for (let i = 0; i < 4; i++) parts.push(xform(torus(0.42, 0.025, boost(lin(hex), 0, -0.08), {}, 4, 24), { y: 0.42, rx: i * 0.8, ry: i * 1.1 }));
  parts.push(xform(cyl(0.025, 0.025, 0.4, 5, hex, {}, 0), { rz: 1.2, x: 0.5, y: 0.12 }));
  return mergeAll(parts);
};
const fluff = (hex) => () => mergeAll([0, 1, 2, 3, 4, 5].map((i) => xform(blob(0.26, hex, { seed: i, amp: 0.15 }), { x: Math.cos(i * 1.2) * 0.22 * (i ? 1 : 0), y: 0.3 + (i % 2) * 0.12, z: Math.sin(i * 1.2) * 0.22 * (i ? 1 : 0) })));
const cloth = (hex, stripe = '#FFF8EC') => () => mergeAll([0, 1, 2].map((i) => box(0.9, 0.12, 0.7, i % 2 ? stripe : hex, { y: i * 0.13 })).concat([box(0.92, 0.03, 0.15, stripe, { y: 0.39, z: -0.2 })]));
const basketOf = (contents) => () => mergeAll([lathe([[0, 0], [0.45, 0], [0.56, 0.4], [0.5, 0.42], [0.42, 0.06], [0, 0.06]], 16, '#C99A5A'),
  xform(torus(0.42, 0.04, '#B5843E', {}, 6, 18), { y: 0.42, sx: 1.1 }), xform(torus(0.4, 0.035, '#B5843E', {}, 6, 18), { y: 0.42, rx: Math.PI / 2, sx: 1.1, sy: 1.1 }),
  ...contents.map(([hex, x, z, r = 0.14]) => ball(r, hex, { x, y: 0.42, z }, 1))]);
const candle = (hex, deco = null) => () => mergeAll([cyl(0.22, 0.22, 0.7, 16, hex), cyl(0.01, 0.01, 0.12, 4, '#3A2A1A', { y: 0.7 }, 0), xform(blob(0.05, '#FFB52E', { sy: 1.6 }), { y: 0.86 }),
  ...(deco ? [cyl(0.23, 0.23, 0.12, 16, deco, { y: 0.25 })] : []), cyl(0.32, 0.36, 0.06, 16, '#C9A26A')]);
const soap = (hex) => () => mergeAll([box(0.8, 0.32, 0.5, hex), box(0.82, 0.08, 0.2, '#FFF8EC', { y: 0.12 }), ...[0, 1, 2].map((i) => ball(0.06, '#FFFFFF', { x: 0.3 + i * 0.07, y: 0.4, z: 0.1 * i }, 0))]);
const mug = (fill) => () => mergeAll([lathe([[0, 0], [0.32, 0], [0.34, 0.6], [0.3, 0.6], [0.28, 0.06], [0, 0.06]], 16, '#FF7A6B'), cyl(0.3, 0.3, 0.02, 16, fill, { y: 0.52 }),
  xform(torus(0.16, 0.05, '#FF7A6B', {}, 6, 12), { x: 0.36, y: 0.32 }), xform(blob(0.15, '#FFFFFF', { seed: 2, sy: 0.6 }), { y: 0.58 })]);
const plate = (bits) => () => mergeAll([lathe([[0, 0], [0.4, 0], [0.56, 0.08], [0.58, 0.1], [0, 0.1]], 20, '#FFF8EC'), ...bits.map((b) => b())]);
const lumps = (hex, n = 3, r = 0.24, seed = 1) => () => mergeAll(Array.from({ length: n }, (_, i) => xform(blob(r, hex, { seed: seed + i, amp: 0.25, sy: 0.8 }), { x: (i - (n - 1) / 2) * r * 1.3, y: r * 0.8, z: (i % 2) * r * 0.5 })));
const present = (box1, ribbon) => () => mergeAll([box(0.8, 0.6, 0.8, box1), box(0.84, 0.62, 0.14, ribbon), box(0.14, 0.62, 0.84, ribbon), xform(torus(0.12, 0.04, ribbon, {}, 5, 10), { y: 0.68, x: -0.1 }), xform(torus(0.12, 0.04, ribbon, {}, 5, 10), { y: 0.68, x: 0.1 })]);
const rosette = (hex) => () => mergeAll([cyl(0.42, 0.42, 0.06, 16, hex), cyl(0.28, 0.28, 0.08, 16, '#FFC83D'), cyl(0.2, 0.2, 0.09, 16, '#FFF8EC'),
  box(0.16, 0.5, 0.04, hex, { x: -0.12, y: -0.45, rz: 0.2 }), box(0.16, 0.5, 0.04, hex, { x: 0.12, y: -0.45, rz: -0.2 })].map((g) => xform(g, { rx: Math.PI / 2 })));
const featherOf = (hex) => () => mergeAll([xform(leaf(1.0, 0.36, hex, { bend: 0.25, seg: 5 }), { rz: 0.5 }), xform(cyl(0.015, 0.02, 1.0, 5, '#FFF2C8', {}, 0), { rz: 0.5 })]);

// crops
const sheaf = (head, stalk) => () => {
  const r = rng(`sheaf${head}`);
  const parts = [];
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2; const rr = (i % 3) * 0.06; const lean = 0.08 + (i % 3) * 0.05;
    const st = mergeAll([cyl(0.014, 0.016, 0.9, 4, stalk, {}, 0), xform(P(new THREE.CapsuleGeometry(0.035, 0.2, 2, 6), head, { creaseDeg: 60 }), { y: 0.98 })]);
    xform(st, { rz: Math.cos(a) * lean, rx: Math.sin(a) * lean, x: Math.cos(a) * rr, z: Math.sin(a) * rr });
    parts.push(st);
    void r;
  }
  parts.push(cyl(0.11, 0.11, 0.08, 10, '#C8473A', { y: 0.38 }));
  return mergeAll(parts);
};
item('wheat', sheaf('#E8B84A', '#D9A23A'), { pitch: 20 });
item('carrot', kf('carrot'));
item('corn', kf('corn'));
item('strawberry', kf('strawberry'));
item('potato', lumps('#C9A06A', 3, 0.26, 2));
item('tomato', kf('tomato'));
item('sugarcane', () => mergeAll([0, 1, 2].map((i) => xform(mergeAll([cyl(0.07, 0.07, 1.3, 7, '#9BD86A'), ...[0.3, 0.65, 1.0].map((y) => cyl(0.08, 0.08, 0.04, 7, '#6FA84A', { y }))]), { x: (i - 1) * 0.16, rz: (i - 1) * 0.15 }))));
item('pumpkin', kf('pumpkin'));
item('sunflower', () => { const h = sunflowerPlant(2, rng('sf')); return fit(h, { w: 1, d: 1 }); }, { yaw: 45, pitch: 15 });
item('cabbage', kf('cabbage'));
item('oats', sheaf('#E3D49A', '#C9B577'), { pitch: 20 });
item('blueberry', () => mergeAll(Array.from({ length: 9 }, (_, i) => ball(0.16, '#4D5BD6', { x: Math.cos(i * 0.7) * 0.25 * (i ? 1 : 0), y: 0.16 + (i > 5 ? 0.22 : 0), z: Math.sin(i * 0.7) * 0.25 * (i ? 1 : 0) }, 1)).concat([cone(0.08, 0.05, 5, '#3E8A35', { y: 0.5 })])));
item('cotton', () => mergeAll([xform(blob(0.2, '#7A5A3A', { seed: 2, sy: 0.6 }), { y: 0.2 }), ...[0, 1, 2, 3].map((i) => xform(blob(0.24, '#FFFFFF', { seed: i }), { x: Math.cos(i * 1.57) * 0.18, y: 0.42, z: Math.sin(i * 1.57) * 0.18 })), xform(blob(0.24, '#FFFFFF', { seed: 9 }), { y: 0.62 })]));
item('lavender', () => { const st = []; for (let i = 0; i < 7; i++) st.push(xform(mergeAll([cyl(0.015, 0.02, 1.0, 4, '#6E9A6A', {}, 0), xform(P(new THREE.CapsuleGeometry(0.05, 0.3, 2, 6), '#A98BE0', { creaseDeg: 70 }), { y: 0.9 })]), { rz: (i - 3) * 0.1, x: (i - 3) * 0.03 })); st.push(xform(torus(0.06, 0.025, '#FF7A9C', {}, 5, 10), { y: 0.3, rx: Math.PI / 2 })); return mergeAll(st); });
item('onion', kf('onion'));
item('watermelon', kf('watermelon'));
item('pepper', kf('paprika'));
item('rice', () => mergeAll([bowl('#FFFFFF')(), xform(blob(0.36, '#FFFDF4', { seed: 2, sy: 0.55, amp: 0.08 }), { y: 0.32 })]));
// tree products
item('apple', kf('apple'));
item('wood', () => mergeAll([[0, 0.2, -0.22], [0, 0.2, 0.22], [0, 0.56, 0]].flatMap(([x, y, z]) => [xform(cyl(0.2, 0.2, 1.0, 9, TRUNK, {}, 50), { rz: Math.PI / 2, x, y, z }),
  xform(cyl(0.17, 0.17, 0.02, 9, '#E2C08A', {}, 0), { rz: Math.PI / 2, x: 0.5, y, z }), xform(cyl(0.17, 0.17, 0.02, 9, '#E2C08A', {}, 0), { rz: Math.PI / 2, x: -0.5, y, z })])));
item('cherry', kf('cherries'));
item('orange', kf('orange'));
item('lemon', kf('lemon'));
item('peach', () => mergeAll([ball(0.42, '#F7A989', { y: 0.42 }, 2), xform(leaf(0.3, 0.16, '#4FA040', { bend: 0.2 }), { y: 0.8, rz: -0.8 }), cyl(0.02, 0.03, 0.12, 5, '#6B4A2A', { y: 0.8 }, 0)]));
item('pear', kf('pear'));
item('plum', () => mergeAll([ball(0.4, '#8C4FA6', { y: 0.4, sy: 1.1 }, 2), cyl(0.02, 0.03, 0.14, 5, '#6B4A2A', { y: 0.86 }, 0), xform(leaf(0.28, 0.14, '#4FA040', { bend: 0.2 }), { y: 0.9, rz: 0.9 })]));
item('walnut', lumps('#B98C5A', 3, 0.25, 7));
item('olive', () => mergeAll([xform(cyl(0.02, 0.02, 0.9, 5, '#6E8B3D', {}, 0), { rz: 1.2, y: 0.5 }), ...[0, 1, 2, 3].map((i) => ball(0.17, i % 2 ? '#4B5320' : '#6E7A2E', { x: -0.3 + i * 0.2, y: 0.32 + (i % 2) * 0.1, sy: 1.25 }, 1)), xform(leaf(0.4, 0.12, '#8FA77A'), { y: 0.55, x: 0.3, rz: -1.1 })]));
item('maple_sap', () => mergeAll([cyl(0.36, 0.3, 0.6, 14, '#A7A39A'), cyl(0.33, 0.33, 0.02, 14, '#C8862E', { y: 0.56 }), xform(torus(0.3, 0.03, '#8C8880', {}, 4, 14), { y: 0.62, rx: Math.PI / 2 })]));
item('cocoa', () => mergeAll([xform(P(new THREE.CapsuleGeometry(0.25, 0.5, 3, 10), '#C8762E', { creaseDeg: 50 }), { rz: 1.3, y: 0.3 }), cyl(0.03, 0.03, 0.2, 5, '#6B4A2A', { x: 0.55, y: 0.38, rz: 1.3 }, 0)]));
item('fig', () => mergeAll([lathe([[0, 0], [0.25, 0.05], [0.38, 0.3], [0.3, 0.6], [0.08, 0.85], [0, 0.9]], 14, '#6B3A6B'), cyl(0.02, 0.03, 0.12, 5, '#4F7A3A', { y: 0.88 }, 0)]));
// feed and animal goods
item('chicken_feed', sackOf('#F2D78A', '#E8B84A'));
item('livestock_feed', sackOf('#B9D38A', '#C9A06A', '#5A7A3A'));
item('pig_slop', () => mergeAll([cyl(0.4, 0.34, 0.55, 14, '#8C8880'), cyl(0.38, 0.38, 0.03, 14, '#9B7A4A', { y: 0.5 }), ...[0, 1, 2].map((i) => ball(0.08, ['#F08A2C', '#9BD86A', '#E23B3B'][i], { x: (i - 1) * 0.15, y: 0.54 }, 0))]));
item('egg', kf('egg'));
item('golden_egg', tinted('egg', '#FFC83D'));
item('milk', bottle('#FFFFFF', '#4AA8E8'));
item('cream_top_milk', bottle('#FFF6D8', '#FFC83D'));
item('wool', fluff('#FFFBF2'));
item('silk_wool', fluff('#F3E8FF'));
item('honey', kf('honey'));
item('royal_jelly', glassJar('#FFF0B0', '#FFC83D'));
item('truffle', lumps('#5A3E2E', 2, 0.3, 3));
item('black_truffle', lumps('#2E2622', 2, 0.3, 4));
item('duck_egg', () => mergeAll([xform(ball(0.32, '#CDEBEF', {}, 2), { y: 0.38, sy: 1.25 })]));
item('golden_feather', featherOf('#FFC83D'));
item('goat_milk', bottle('#FFFDF4', '#7FB547'));
item('aged_goat_cheese', () => mergeAll([cyl(0.5, 0.5, 0.36, 20, '#F3E6C8'), cyl(0.51, 0.51, 0.06, 20, '#C9A26A', { y: 0.33 })]));
item('manure', lumps('#6E4A2E', 3, 0.22, 11));
item('show_ribbon', rosette('#4AA8E8'), { pitch: 8 });
item('alpaca_fiber', fluff('#F2E6D2'));
item('royal_fiber', fluff('#FFE9F2'));
// mill, bakery, sawmill, dairy, compost
item('flour', sackOf('#FFFDF4', '#FFFFFF', '#C9A26A'));
item('cornmeal', sackOf('#F7E7A6', '#F2D04B', '#C9A26A'));
item('sugar', () => mergeAll([bowl('#FFFFFF')(), ...[0, 1, 2, 3, 4].map((i) => box(0.16, 0.16, 0.16, '#FFFFFF', { x: Math.cos(i * 1.3) * 0.18, y: 0.34, z: Math.sin(i * 1.3) * 0.18, ry: i }))]));
item('oat_flakes', bowl('#E9D8A6', [['#D8C27A', 0.1, 0.1], ['#D8C27A', -0.15, 0.05], ['#D8C27A', 0.05, -0.15]]));
item('bread', kf('loaf'));
item('corn_bread', tinted('loaf-round', '#F2D04B'));
item('carrot_muffin', kf('muffin'));
item('pancakes', kf('pancakes'));
item('cookies', kf('cookie'));
item('sweetheart_cake', cake('#FFB3C1', '#FFF8EC', '#E83A55', 2));
item('blueberry_muffin', tinted('muffin', '#7D86D9', { keepDark: 0.5 }));
item('granola_bar', () => mergeAll([box(0.9, 0.22, 0.4, '#C99A5A'), ...[0, 1, 2, 3, 4].map((i) => ball(0.06, i % 2 ? '#E83A55' : '#8A5A35', { x: -0.3 + i * 0.15, y: 0.22, z: (i % 2) * 0.1 }, 0))]));
item('pizza', kf('pizza'));
item('walnut_cookies', tinted('cookie', '#B98C5A'));
item('olive_bread', tinted('loaf', '#C9A06A'));
// its own art (ui-ux-33): the pancake stack under a glossy pour of maple syrup with a maple leaf
item('maple_pancakes', async () => {
  const p = await kf('pancakes')();
  const b = bounds(p);
  const leafSh = new THREE.Shape();
  for (let k = 0; k <= 10; k++) { const a = (k / 10) * Math.PI * 2 + Math.PI / 2; const r0 = k % 2 ? 0.07 : 0.17; const x = Math.cos(a) * r0; const y = Math.sin(a) * r0; if (k) leafSh.lineTo(x, y); else leafSh.moveTo(x, y); }
  return mergeAll([p, xform(blob(0.3, '#B8661E', { seed: 5, sy: 0.18, amp: 0.25 }), { y: b.max.y + 0.02 }),
    ...[0, 1, 2].map((i) => xform(blob(0.07, '#B8661E', { seed: 9 + i, sy: 1.6 }), { x: Math.cos(i * 2) * 0.32, y: b.max.y * 0.6, z: Math.sin(i * 2) * 0.32 })),
    xform(P(new THREE.ShapeGeometry(leafSh), '#D9542B'), { rx: -Math.PI / 2.4, y: b.max.y + 0.12, x: 0.15, z: 0.05 })]);
});
item('planks', async () => fit(await bakeStatic(KS('resource-planks'), { sat: 0.2 }), { w: 1, d: 1 }));
item('wooden_crate', () => crate(0.9));
item('bird_house', () => mergeAll([box(0.5, 0.6, 0.5, '#4AA8E8'), xform(gable(0.7, 0.62, 0.34, '#C8473A'), { y: 0.6 }), xform(cyl(0.09, 0.09, 0.02, 12, '#3A2A1A', {}, 0), { rx: Math.PI / 2, y: 0.38, z: 0.26 }), cyl(0.04, 0.04, 0.5, 6, WOOD_D, { y: -0.5 })]));
item('toy_horse', () => mergeAll([box(0.8, 0.35, 0.3, '#C8473A', { y: 0.45 }), box(0.25, 0.45, 0.25, '#C8473A', { x: 0.4, y: 0.75, rz: -0.3 }), box(0.06, 0.4, 0.06, WOOD, { x: -0.3, y: 0.1 }), box(0.06, 0.4, 0.06, WOOD, { x: 0.3, y: 0.1 }),
  xform(torus(0.6, 0.04, WOOD, {}, 5, 16), { y: 0.0, sy: 0.3, rx: Math.PI / 2 })]));
item('baby_bottle', () => mergeAll([lathe([[0, 0], [0.2, 0], [0.22, 0.6], [0, 0.6]], 14, '#FFFFFF'), cyl(0.21, 0.21, 0.1, 14, '#FF9FB0', { y: 0.6 }), lathe([[0, 0], [0.08, 0], [0.06, 0.18], [0, 0.22]], 10, '#F5C78A').translate(0, 0.7, 0)]));
item('cream', kf('whipped-cream'));
item('butter', () => mergeAll([box(0.9, 0.36, 0.56, '#FFE58A'), box(1.1, 0.06, 0.72, '#FFF8EC', { y: -0.03 })]));
item('yogurt', () => mergeAll([lathe([[0, 0], [0.28, 0], [0.34, 0.6], [0, 0.6]], 16, '#FFFFFF'), cyl(0.33, 0.33, 0.05, 16, '#FF9FB0', { y: 0.58 }), cyl(0.345, 0.3, 0.2, 16, '#E83A55', { y: 0.2 })]));
item('cheese', kf('cheese'));
item('ice_cream', kf('ice-cream-cup'));
item('goat_cheese', () => mergeAll([cyl(0.45, 0.45, 0.3, 20, '#FFFDF4'), xform(leaf(0.4, 0.2, '#6E9A6A', { bend: 0.1 }), { y: 0.31, rx: -Math.PI / 2 })]));
item('compost', sackOf('#8A6A40', '#5A3A22', '#3A2A1A'));
// kitchen
item('omelette', plate([() => xform(blob(0.32, '#FFE14A', { seed: 3, sy: 0.3, sx: 1.4 }), { y: 0.14 }), () => ball(0.05, '#5DB24A', { x: 0.1, y: 0.22 }, 0)]));
item('veggie_soup', bowl('#E8952C', [['#F08A2C', 0.15, 0.1], ['#9BD86A', -0.1, 0.15], ['#E8463A', 0.05, -0.18]]));
item('pumpkin_soup', bowl('#F2852A', [['#FFF8EC', 0, 0]]));
item('dog_biscuit', () => mergeAll([box(0.7, 0.16, 0.22, '#C99A5A'), ...[[-0.35, -0.1], [-0.35, 0.1], [0.35, -0.1], [0.35, 0.1]].map(([x, z]) => cyl(0.13, 0.13, 0.16, 10, '#C99A5A', { x, z }))]));
item('cat_treat', () => mergeAll([xform(blob(0.3, '#FF9F80', { sx: 1.6, sy: 0.5, seed: 4 }), { y: 0.15 }), xform(P(new THREE.ConeGeometry(0.2, 0.3, 3), '#FF9F80'), { rz: Math.PI / 2, x: -0.55, y: 0.15 })]));
item('popcorn', () => mergeAll([lathe([[0, 0], [0.3, 0], [0.42, 0.7], [0, 0.7]], 12, '#E84A3A'), ...Array.from({ length: 9 }, (_, i) => ball(0.12, '#FFF6D8', { x: Math.cos(i) * 0.22, y: 0.75 + (i % 3) * 0.06, z: Math.sin(i) * 0.22 }, 0))]));
item('roasted_seeds', bowl('#6B4423', [['#8A6A40', 0.1, 0.1], ['#8A6A40', -0.12, 0], ['#8A6A40', 0, -0.12]]));
item('coleslaw', kf('salad'));
item('potato_gratin', () => mergeAll([box(1.0, 0.3, 0.7, '#E8D5C0'), box(0.9, 0.06, 0.6, '#F2C25E', { y: 0.27 }), ...[0, 1, 2].map((i) => ball(0.07, '#C9862E', { x: -0.25 + i * 0.25, y: 0.33 }, 0))]));
item('harvest_feast', () => mergeAll([box(1.0, 0.04, 0.8, WOOD), xform(pie('#E8952C')(), { s: 0.5, x: -0.2 }), xform(bowl('#E8952C')(), { s: 0.4, x: 0.25, z: 0.1 })]));
item('truffle_pasta', bowl('#F7E7A6', [['#5A3E2E', 0.1, 0.05], ['#5A3E2E', -0.08, -0.1]]));
item('custard', kf('pudding'));
item('french_onion_soup', bowl('#C9862E', [['#FFE58A', 0, 0]]));
item('wedding_cake', cake('#FFFFFF', '#FFF8EC', '#FF9FB0', 3));
item('watermelon_salad', bowl('#FF6B6B', [['#3E8E3A', 0.1, 0.1], ['#FFFDF4', -0.1, 0]]));
item('potato_chips', () => mergeAll([box(0.7, 0.9, 0.24, '#FFC83D'), box(0.72, 0.12, 0.26, '#E84A3A', { y: 0.8 }), ...[0, 1].map((i) => xform(blob(0.12, '#F2D04B', { seed: i, sy: 0.3 }), { x: -0.15 + i * 0.3, y: 0.95 }))]));
item('stuffed_peppers', plate([() => xform(kfSync('#E03C2E'), { y: 0.1 })]));
item('maple_fudge', () => mergeAll([0, 1, 2].map((i) => box(0.36, 0.25, 0.36, '#9B6A3E', { x: (i - 1) * 0.4, ry: i * 0.2 }))));
item('rice_pudding', bowl('#FFF6D8', [['#B9824A', 0, 0]]));
item('risotto', bowl('#F7EBC2', [['#5A3E2E', 0.1, 0]]));
item('hot_cocoa', mug('#6B3A2A'));
// preserves
item('ketchup', kf('bottle-ketchup'));
item('strawberry_jam', glassJar('#E83A55', '#E84A5F', '#FFF8EC', () => [xform(P(new THREE.ConeGeometry(0.11, 0.18, 8), '#E83A55', { creaseDeg: 70 }), { rx: Math.PI, y: 0.98 }),
  xform(P(new THREE.ConeGeometry(0.08, 0.05, 6), '#3E8A35', { creaseDeg: 70 }), { y: 1.07 })]));
item('cherry_jam', glassJar('#7E1328', '#5A1A3A', '#FFE9F2', () => [...lidFruit('#B0122E', 2, 0.085)(), xform(cyl(0.01, 0.01, 0.22, 4, '#4E8F35', {}, 0), { y: 0.98, rz: 0.5 })]));
item('sauerkraut', kf('plate-sauerkraut'));
item('orange_marmalade', glassJar('#F59A23', '#FFC83D'));
item('blueberry_jam', glassJar('#4D5BD6', '#4AA8E8'));
item('peach_jam', glassJar('#F7A989', '#FF7A6B'));
item('plum_jam', glassJar('#6B2E7A', '#8C4FA6'));
item('pickled_peppers', glassJar('#9BD86A', '#7FB547'));
item('fig_jam', glassJar('#6B3A6B', '#8C4FA6'));
// weaver, sewing
item('yarn', yarnBall('#FF9FB0'));
item('cotton_cloth', cloth('#FFFDF4', '#D6F1FF'));
item('lavender_dye', bottle('#A98BE0', '#8C4FA6'));
item('alpaca_yarn', yarnBall('#F2E6D2'));
item('scarf', () => mergeAll([xform(torus(0.35, 0.12, '#E84A3A', {}, 8, 20), { y: 0.3, rx: Math.PI / 2, sy: 0.7 }), box(0.25, 0.7, 0.06, '#E84A3A', { x: 0.25, y: -0.1, rz: 0.15 }), box(0.25, 0.08, 0.07, '#FFF8EC', { x: 0.3, y: -0.35, rz: 0.15 })]));
item('cotton_tote', () => mergeAll([box(0.8, 0.8, 0.2, '#F3E6C8'), xform(torus(0.25, 0.04, '#C9A26A', {}, 5, 12), { y: 0.8 }), xform(cyl(0.12, 0.12, 0.01, 12, '#E83A55'), { rx: Math.PI / 2, y: 0.4, z: 0.11 })]));
item('wool_pillow', () => xform(blob(0.5, '#9C7FD0', { seed: 3, sy: 0.4, amp: 0.05 }), { y: 0.2 }));
item('picnic_blanket', cloth('#E84A3A', '#FFFFFF'));
item('sweater', () => mergeAll([box(0.8, 0.8, 0.3, '#9C7FD0'), box(0.25, 0.7, 0.28, '#9C7FD0', { x: -0.5, y: 0.05, rz: 0.3 }), box(0.25, 0.7, 0.28, '#9C7FD0', { x: 0.5, y: 0.05, rz: -0.3 }), box(0.82, 0.1, 0.32, '#FFF8EC', { y: 0.3 })]));
item('quilt', () => { const parts = []; const cols = ['#FF9FB0', '#FFF8EC', '#A98BE0', '#9BD86A']; for (let i = 0; i < 9; i++) parts.push(box(0.3, 0.12, 0.3, cols[i % 4], { x: (i % 3 - 1) * 0.3, z: (Math.floor(i / 3) - 1) * 0.3 })); parts.push(box(0.95, 0.1, 0.95, '#C9A26A', { y: -0.1 })); return mergeAll(parts); });
item('alpaca_plush', () => mergeAll([xform(blob(0.3, '#F2E6D2', { seed: 2 }), { y: 0.3 }), xform(blob(0.17, '#F2E6D2', { seed: 3 }), { y: 0.72, z: 0.1 }), ball(0.03, '#3A2A1A', { x: -0.06, y: 0.76, z: 0.25 }, 0), ball(0.03, '#3A2A1A', { x: 0.06, y: 0.76, z: 0.25 }, 0)]));
item('alpaca_shawl', cloth('#C9B08A', '#FFF2D6'));
// pie oven
item('apple_pie', kf('pie'));
item('pumpkin_pie', pie('#F2852A'));
item('cherry_pie', pie('#C81E3C'));
item('lemon_cake', cake('#FFF2A8', '#FFF8EC', '#F5D63B'));
item('blueberry_pie', pie('#4D5BD6'));
item('peach_cobbler', tart('#F7A989'));
item('pear_tart', tart('#C9D84A'));
item('lemon_meringue_pie', () => mergeAll([pie('#F5D63B')(), xform(blob(0.35, '#FFF8EC', { seed: 3, sy: 0.6 }), { y: 0.3 })]));
item('plum_cake', cake('#8C4FA6', '#E8D5F2', '#6B2E7A'));
item('walnut_honey_cake', cake('#C99A5A', '#FFC83D', '#8A5A35'));
item('chocolate_cake', cake('#6B3A2A', '#4A2A1A', '#E83A55'));
item('fig_tart', tart('#6B3A6B'));
// juice press, chandlery, packing, oil press, sugar shack, chocolatier
item('carrot_juice', juiceGlass('#F07A1C', carrotTop));
item('apple_juice', juiceGlass('#E2D46A', appleWedge));
item('orange_juice', juiceGlass('#F59A23'));
item('lemonade', juiceGlass('#FFF2A8'));
item('pear_nectar', juiceGlass('#D9E28A'));
item('watermelon_juice', juiceGlass('#FF6B7A'));
item('beeswax', () => mergeAll([box(0.8, 0.4, 0.55, '#F2C25E'), ...[0, 1, 2].map((i) => box(0.2, 0.05, 0.2, '#E8A83A', { x: -0.25 + i * 0.25, y: 0.4 }))]));
item('honey_candle', candle('#F2C25E'));
item('lavender_candle', candle('#C8B5F0', '#A98BE0'));
item('lavender_soap', soap('#C8B5F0'));
item('breakfast_hamper', basketOf([['#F59A23', -0.15, 0], ['#E83A55', 0.15, 0.1], ['#FFFDF4', 0, -0.15]]));
item('picnic_basket', basketOf([['#E23B3B', -0.15, 0], ['#FFE58A', 0.15, 0.05], ['#F2C25E', 0, -0.15]]));
item('spa_basket', basketOf([['#C8B5F0', -0.15, 0], ['#A98BE0', 0.15, 0.05], ['#FFFFFF', 0, -0.15]]));
item('cozy_winter_gift', present('#E84A3A', '#FFF8EC'));
item('harvest_hamper', basketOf([['#F2852A', -0.15, 0, 0.18], ['#E23B3B', 0.15, 0.1], ['#C9A06A', 0, -0.15]]));
item('gourmet_hamper', basketOf([['#6B3A2A', -0.15, 0], ['#FFFDF4', 0.15, 0.1], ['#4B5320', 0, -0.15]]));
item('sunflower_oil', bottle('#F7D94A', '#FFC83D'));
item('olive_oil', bottle('#B5B84A', '#4B5320'));
item('truffle_oil', bottle('#C9A06A', '#2E2622'));
item('maple_syrup', bottle('#B5602A', '#D9542B'));
item('chocolate', kf('chocolate'));
item('chocolate_truffles', () => mergeAll([box(1.0, 0.1, 0.7, '#E84A5F'), ...[0, 1, 2, 3, 4, 5].map((i) => ball(0.15, i % 2 ? '#6B3A2A' : '#4A2A1A', { x: (i % 3 - 1) * 0.3, y: 0.2, z: (Math.floor(i / 3) - 0.5) * 0.3 }, 1))]));
// boosts, currencies, misc
item('golden_seeds', () => mergeAll([box(0.7, 0.9, 0.12, '#FFC83D'), box(0.72, 0.18, 0.14, '#E9A23A', { y: 0.72 }), xform(blob(0.16, '#FFE58A', { seed: 2 }), { y: 0.4, z: 0.1 })]));
item('seed_packet', () => mergeAll([box(0.7, 0.9, 0.12, '#9BD86A'), box(0.72, 0.18, 0.14, '#5DA544', { y: 0.72 }), xform(flowerHead('#FF7A9C', 0.18), { y: 0.38, z: 0.08, rx: Math.PI / 2 })]));
const coin = () => mergeAll([cyl(0.4, 0.4, 0.09, 26, '#E09A1E', {}, 30), cyl(0.36, 0.36, 0.1, 26, '#FFD54A', {}, 30), cyl(0.27, 0.27, 0.11, 26, '#F2B22A', {}, 30),
  cyl(0.2, 0.2, 0.12, 26, '#FFE27A', {}, 30)]);
item('coins', () => mergeAll([0, 1, 2].map((i) => xform(coin(), { y: i * 0.1, x: -0.12 + i * 0.03, z: 0.05 - i * 0.03, ry: i })).concat([xform(coin(), { rx: -Math.PI / 2.6, x: 0.32, y: 0.4, z: -0.1 })])), { pitch: 30, yaw: 20 });
// the fallback must not look like a real item (ui-ux-33): a grey-lilac crate with a white "?"
item('_fallback', () => {
  const q = new THREE.Shape();
  q.absarc(0, 0.12, 0.18, Math.PI, -Math.PI * 0.25, true);
  q.lineTo(0.05, -0.08); q.lineTo(0.05, -0.16); q.lineTo(-0.05, -0.16); q.lineTo(-0.05, -0.04); q.lineTo(0.08, 0.04);
  q.absarc(0, 0.12, 0.09, -Math.PI * 0.25, Math.PI, false);
  q.closePath();
  const glyph = P(new THREE.ExtrudeGeometry(q, { depth: 0.04, bevelEnabled: false, curveSegments: 6 }), '#FFFFFF');
  const dot = box(0.1, 0.1, 0.04, '#FFFFFF', { y: -0.32 });
  return mergeAll([crate(0.9, '#B9B2C9'), ...[0.455, -0.455].flatMap((z) => [xform(mergeAll([glyph.clone(), dot.clone()]), { y: 0.48, z, ry: z < 0 ? Math.PI : 0 })])]);
}, { kind: 'fallback' });
item('acorns', () => mergeAll([xform(blob(0.32, '#C9862E', { seed: 1, amp: 0.04, sy: 1.2 }), { y: 0.35 }), xform(blob(0.34, '#7A4E2E', { seed: 2, sy: 0.55, amp: 0.1 }), { y: 0.68 }), cyl(0.04, 0.05, 0.18, 5, '#5A3A22', { y: 0.85 }, 0)]));
item('xp', () => { const sh = new THREE.Shape(); for (let i = 0; i <= 10; i++) { const r = i % 2 ? 0.2 : 0.5; const a = (i / 10) * Math.PI * 2 + Math.PI / 2; const x = Math.cos(a) * r; const y = Math.sin(a) * r; if (i) sh.lineTo(x, y); else sh.moveTo(x, y); } return P(new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 }), '#4AA8E8', { creaseDeg: 40 }); }, { yaw: 15, pitch: 10 });
item('hearts', () => { const h = new THREE.Shape(); h.moveTo(0, -0.5); h.bezierCurveTo(0.9, 0.2, 0.5, 0.9, 0, 0.45); h.bezierCurveTo(-0.5, 0.9, -0.9, 0.2, 0, -0.5); return P(new THREE.ExtrudeGeometry(h, { depth: 0.22, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3, curveSegments: 12 }), '#FF5A7A', { creaseDeg: 40 }); }, { yaw: 15, pitch: 10 });
item('hurry', () => mergeAll([cyl(0.36, 0.36, 0.08, 16, WOOD), cyl(0.36, 0.36, 0.08, 16, WOOD, { y: 0.92 }), lathe([[0.3, 0.08], [0.06, 0.5], [0.3, 0.92]], 14, '#D7EEF2'), xform(cone(0.2, 0.18, 12, '#F2D04B'), { y: 0.1 }), ...[0, 1, 2].map((i) => cyl(0.03, 0.03, 0.84, 5, WOOD_D, { x: Math.cos(i * 2.1) * 0.3, y: 0.08, z: Math.sin(i * 2.1) * 0.3 }, 0))]));
// tools (GDD §3.7)
function sickleGeo() {
  // a crescent blade whose heel sits on top of the handle
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.quadraticCurveTo(0.05, 0.62, -0.42, 0.58);
  sh.quadraticCurveTo(-0.62, 0.5, -0.6, 0.36);
  sh.quadraticCurveTo(-0.42, 0.46, -0.24, 0.42);
  sh.quadraticCurveTo(-0.04, 0.36, -0.06, 0.0);
  sh.lineTo(0, 0);
  const blade = P(new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 1, curveSegments: 10 }), '#D5DADF', { creaseDeg: 30 });
  return mergeAll([xform(blade, { y: 0.56, x: 0.03, z: -0.02 }), cyl(0.045, 0.05, 0.56, 7, '#B5743E'), cyl(0.055, 0.055, 0.06, 7, '#8C8880', { y: 0.52 })]);
}
function wateringCan() {
  return mergeAll([cyl(0.3, 0.32, 0.5, 16, '#4AA8E8'), cyl(0.31, 0.31, 0.04, 16, '#3A8CC8', { y: 0.5 }), xform(cyl(0.04, 0.06, 0.55, 8, '#4AA8E8'), { rz: -0.9, x: 0.42, y: 0.38 }),
    xform(cyl(0.09, 0.05, 0.08, 8, '#3A8CC8'), { rz: -0.9, x: 0.66, y: 0.56 }), xform(torus(0.2, 0.035, '#3A8CC8', {}, 6, 12), { x: -0.18, y: 0.55, rx: 0, ry: 0 })]);
}
function scoop(fill) { return mergeAll([lathe([[0, 0], [0.24, 0], [0.3, 0.3], [0.26, 0.3], [0.2, 0.04], [0, 0.04]], 12, '#C9CED3'), cyl(0.24, 0.24, 0.02, 12, fill, { y: 0.25 }), xform(cyl(0.035, 0.035, 0.4, 6, WOOD, {}, 0), { rz: 1.2, x: 0.42, y: 0.25 })]); }
const TOOLS = {
  hand: () => { const g = mergeAll([xform(blob(0.28, '#F2C29A', { seed: 2, sx: 1.0, sy: 1.2, sz: 0.55 }), { y: 0.35 }), ...[0, 1, 2, 3].map((i) => xform(P(new THREE.CapsuleGeometry(0.07, 0.22, 2, 6), '#F2C29A', { creaseDeg: 60 }), { x: -0.2 + i * 0.135, y: 0.72 + (i === 1 || i === 2 ? 0.05 : 0) })), xform(P(new THREE.CapsuleGeometry(0.07, 0.18, 2, 6), '#F2C29A', { creaseDeg: 60 }), { x: 0.32, y: 0.32, rz: -0.9 }), box(0.6, 0.18, 0.36, '#2BB3A3', { y: 0.02 })]); return g; },
  seed_bag: () => sackOf('#C9A06A', '#9BD86A')(),
  sickle: () => sickleGeo(),
  watering_can: () => wateringCan(),
  feed_scoop: () => scoop('#E8B84A'),
  basket: () => basketOf([['#E23B3B', -0.12, 0], ['#F59A23', 0.12, 0.05]])(),
  compost_scoop: () => scoop('#5A3A22'),
  axe: async () => fit(await bakeStatic(KS('tool-axe'), { sat: 0.2 }), { h: 1 }),
  hammer: async () => fit(await bakeStatic(KS('tool-hammer'), { sat: 0.2 }), { h: 1 }),
  hoe: async () => fit(await bakeStatic(KS('tool-hoe'), { sat: 0.2 }), { h: 1 }),
  big_watering_can: () => xform(mergeAll([wateringCan(), xform(cyl(0.12, 0.12, 0.05, 12, '#FFC83D'), { y: 0.25, z: 0.3, rx: Math.PI / 2 })]), { s: 1.0 }),
  wide_sickle: () => mergeAll([sickleGeo(), xform(sickleGeo(), { x: 0.25, z: -0.2 })]),
  seed_spreader: () => mergeAll([cyl(0.35, 0.2, 0.5, 12, '#7FB547', { y: 0.3 }), xform(torus(0.18, 0.05, '#3A2A1A', {}, 6, 12), { y: 0.18, ry: Math.PI / 2 }), xform(cyl(0.03, 0.03, 0.9, 6, WOOD, {}, 0), { rz: 0.9, x: -0.4, y: 0.6 })]),
  grand_sickle: () => xform(mergeAll([sickleGeo(), cyl(0.06, 0.06, 0.1, 8, '#FFC83D', { x: 0.4, y: 0.66 })]), { s: 1.1 }),
  fishing_rod: () => fishingRod(),
};
/** The fishing rod (wave 3, the Fishing Dock): a cork grip with a brass reel at the butt, a tapering cane blank with
 *  three line guides, the tip at (0, 2, 0) (avatars-view hangs the line from there). */
function fishingRod() {
  return mergeAll([cyl(0.028, 0.032, 0.36, 7, '#C9A06A'), cyl(0.034, 0.034, 0.04, 7, '#8A5A35', { y: 0.36 }),
    xform(mergeAll([cyl(0.07, 0.07, 0.05, 10, '#C9A23A'), cyl(0.012, 0.012, 0.09, 4, '#5E5A55', { y: 0.05 }), xform(cyl(0.01, 0.01, 0.07, 4, '#5E5A55'), { rz: Math.PI / 2, x: 0.04, y: 0.12 })]), { rz: Math.PI / 2, x: 0.05, y: 0.22 }),
    cyl(0.009, 0.022, 1.6, 6, '#6E4A2E', { y: 0.4 }, 30), ...[0.9, 1.4, 1.85].map((y) => xform(torus(0.022, 0.005, '#C9CED3', {}, 3, 8), { y, x: 0.025, ry: Math.PI / 2 })),
    cyl(0.006, 0.009, 0.05, 4, '#E8513C', { y: 1.97 }, 0)]);
}
for (const [id, build] of Object.entries(TOOLS)) item(id, build, { kind: 'tool' });

// ---- Collection finds (M1b album, GDD §6.3; shared/content/collections.js): sixty small keepsakes. The album draws
// its own stickers; these icons are what flies out of a find (fx pop), the banners and the trade list.
const PAPER = '#FFF8EC'; const INK = '#6A4A3A';
/** A recipe card standing slightly back: cream card, a coloured header, three ruled lines and a little motif. */
const recipeCard = (hdr, motif) => () => xform(mergeAll([box(0.9, 0.62, 0.03, PAPER), box(0.9, 0.12, 0.035, hdr, { y: 0.5 }),
  ...[0.14, 0.24, 0.34].map((y) => box(0.42, 0.018, 0.036, '#C9B89A', { x: 0.15, y })), ...motif().map((g) => xform(g, { x: -0.24, y: 0.16, z: 0.03 }))]), { rx: -0.2 });
const cardMotifs = {
  bread: () => [xform(blob(0.12, '#D9A15B', { seed: 2, sx: 1.4, sy: 0.7, sz: 0.5, detail: 1 }), { y: 0.08 }), box(0.03, 0.02, 0.02, '#B5743E', { y: 0.15 })],
  jam: () => [cyl(0.08, 0.08, 0.16, 10, '#C81E3C', { z: 0.02 }), cyl(0.085, 0.085, 0.04, 10, '#FFFFFF', { y: 0.16, z: 0.02 })],
  pie: () => [xform(cyl(0.13, 0.13, 0.05, 14, '#E0A858'), { rx: Math.PI / 2, y: 0.12, z: 0.02 }), xform(cyl(0.1, 0.1, 0.055, 14, '#8C4FA6'), { rx: Math.PI / 2, y: 0.12, z: 0.025 })],
  soup: () => [xform(lathe([[0, 0], [0.06, 0], [0.13, 0.08], [0.13, 0.1], [0, 0.1]], 12, '#FFFFFF'), { y: 0.04, z: 0.02 }), cyl(0.12, 0.12, 0.01, 12, '#E8963A', { y: 0.12, z: 0.02 })],
  cake: () => [cyl(0.11, 0.11, 0.1, 12, '#F2C29A', { y: 0.04, z: 0.02 }), cyl(0.115, 0.115, 0.04, 12, '#FF9FB0', { y: 0.13, z: 0.02 }), ball(0.025, '#E83A55', { y: 0.2, z: 0.02 }, 0)],
};
item('recipe_bread', recipeCard('#D9A15B', cardMotifs.bread), { kind: 'find' });
item('recipe_jam', recipeCard('#C81E3C', cardMotifs.jam), { kind: 'find' });
item('recipe_pie', recipeCard('#8C4FA6', cardMotifs.pie), { kind: 'find' });
item('recipe_soup', recipeCard('#E8963A', cardMotifs.soup), { kind: 'find' });
item('recipe_cake', recipeCard('#FF7A9C', cardMotifs.cake), { kind: 'find' });

/** A butterfly seen from above and a little behind: fore and hind wings, spots, a dark body and antennae. */
const butterflyItem = (fore, hind, spot = null, edge = null) => () => {
  const wing = (r, hex, x, z, rz, seed) => xform(blob(r, hex, { detail: 1, amp: 0.08, sx: 1.25, sy: 0.12, sz: 0.85, seed }), { x, z, ry: rz });
  const parts = [];
  for (const sd of [-1, 1]) {
    parts.push(wing(0.36, fore, sd * 0.36, -0.12, sd * 0.35, 1), wing(0.25, hind, sd * 0.26, 0.24, -sd * 0.4, 2));
    if (edge) parts.push(wing(0.34, edge, sd * 0.38, -0.13, sd * 0.35, 1).translate(0, -0.012, 0).scale(1.06, 1, 1.06));
    if (spot) parts.push(ball(0.07, spot, { x: sd * 0.42, y: 0.05, z: -0.18, sy: 0.3 }, 1));
  }
  parts.push(xform(blob(0.07, '#2A2018', { sx: 0.8, sy: 0.8, sz: 4, detail: 1, amp: 0.02 }), { y: 0.03, z: 0.02 }));
  for (const sd of [-1, 1]) parts.push(xform(cyl(0.008, 0.008, 0.3, 3, '#2A2018', {}, 0), { rx: -1.2, ry: sd * 0.4, z: -0.3, y: 0.06 }));
  return mergeAll(parts);
};
item('cabbage_white', butterflyItem('#FAFAF2', '#F2F0E0', '#3A3A3A'), { kind: 'find', pitch: 58 });
item('peacock_butterfly', butterflyItem('#C8402A', '#9A3020', '#4A7AE0'), { kind: 'find', pitch: 58 });
item('swallowtail', butterflyItem('#F2D04B', '#E8C23A', '#2A2A2A', '#2A2A2A'), { kind: 'find', pitch: 58 });
item('blue_morpho', butterflyItem('#3A7BE0', '#2A5AC0', null, '#1A1A3A'), { kind: 'find', pitch: 58 });
item('monarch', butterflyItem('#F28A1C', '#E07A12', '#FFFFFF', '#2A1A0A'), { kind: 'find', pitch: 58 });

// the lost tools (found with the Hammer or while clearing): old, a little rusty
const RUST = '#B5673A';
item('rusty_trowel', () => mergeAll([xform(mergeAll([xform(P(new THREE.ConeGeometry(0.28, 0.75, 4), RUST, { creaseDeg: 30 }), { sz: 0.22, rx: Math.PI, y: -0.37 }),
  cyl(0.03, 0.03, 0.22, 6, '#8C8880', { y: 0 }), cyl(0.07, 0.06, 0.5, 8, '#8A5A35', { y: 0.2 })]), { y: 0.62, rz: 0.6 })]), { kind: 'find' });
item('old_pitchfork', () => xform(mergeAll([cyl(0.035, 0.035, 1.3, 6, '#9C7048'), box(0.42, 0.05, 0.05, '#8C8880', { y: 1.28 }),
  ...[-0.19, 0, 0.19].map((x) => xform(P(new THREE.ConeGeometry(0.025, 0.5, 5), '#7E7A74', { creaseDeg: 40 }), { x, y: 1.55 }))]), { rz: 0.45 }), { kind: 'find' });
item('brass_oil_can', () => mergeAll([lathe([[0, 0], [0.32, 0], [0.34, 0.06], [0.34, 0.3], [0.2, 0.42], [0.08, 0.48], [0.07, 0.6], [0, 0.6]], 16, '#D9A63A'),
  xform(cyl(0.02, 0.05, 0.85, 8, '#C9952E'), { rz: -0.95, x: 0.36, y: 0.72 }), xform(torus(0.14, 0.03, '#A8862A', {}, 5, 12), { x: -0.32, y: 0.3, ry: Math.PI / 2 })]), { kind: 'find' });
item('nail_tin', () => mergeAll([cyl(0.38, 0.38, 0.32, 18, '#8FA0A8'), cyl(0.4, 0.4, 0.08, 18, '#6E7E86', { y: 0.32 }), cyl(0.39, 0.39, 0.14, 18, '#C8473A', { y: 0.1 }),
  xform(P(new THREE.TorusGeometry(0.16, 0.045, 5, 14, Math.PI * 1.3), '#5E5A55', { creaseDeg: 60 }), { y: 0.42, rx: Math.PI / 2, rz: Math.PI * 1.35 }),
  ...[0, 1, 2].map((i) => xform(mergeAll([cyl(0.012, 0.004, 0.3, 4, '#9A9A9A', {}, 0), box(0.06, 0.02, 0.03, '#9A9A9A', { y: 0.3 })]), { x: 0.2 + i * 0.07, y: 0.4, rz: 1.45 + i * 0.1, ry: i }))]), { kind: 'find' });
// Grandpa's pocket knife, opened: a chunky wooden handle with brass bolsters, the blade out at an angle
const knifeBlade = () => { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.7, 0.02); sh.quadraticCurveTo(0.66, 0.2, 0.0, 0.2); sh.closePath();
  return P(new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false, curveSegments: 6 }), '#D5DADF'); };
item('pocket_knife', () => xform(mergeAll([box(0.8, 0.22, 0.16, '#8A5A35'), box(0.82, 0.03, 0.17, '#6E4A2E', { y: 0.1 }),
  ...[-0.38, 0.38].map((x) => box(0.08, 0.24, 0.18, '#E9B13A', { x, y: -0.01 })), ...[-0.2, 0, 0.2].map((x) => cyl(0.025, 0.025, 0.17, 8, '#E9B13A', { x, y: 0.1, rx: Math.PI / 2, z: -0.085 })),
  xform(knifeBlade(), { x: 0.38, y: 0.12, z: -0.015, rz: 0.45 })]), { rz: 0.2, x: -0.2 }), { kind: 'find', yaw: 10, pitch: 28 });

/** A feather with its pattern painted along the vane (spots, bars, an eye at the tip). */
const patternedFeather = (hex, mark = null) => () => {
  const vane = xform(leaf(1.0, 0.36, hex, { bend: 0.25, seg: 5 }), { rz: 0.5 });
  if (mark) {
    const p = vane.getAttribute('position'); const c = vane.getAttribute('color'); const col = new THREE.Color();
    for (let i = 0; i < p.count; i++) { const m = mark(p.getX(i), p.getY(i)); if (m) { col.set(m).convertSRGBToLinear(); c.setXYZ(i, col.r, col.g, col.b); } }
  }
  const parts = [vane, xform(cyl(0.015, 0.02, 1.0, 5, '#FFF2C8', {}, 0), { rz: 0.5 })];
  return mergeAll(parts);
};
item('speckled_feather', () => mergeAll([patternedFeather('#9A7A5A')(), ...[[0.12, 0.25], [0.2, 0.42], [0.28, 0.6], [0.06, 0.48], [0.18, 0.7]].map(([x, y], i) => ball(0.035, '#F2E6CF', { x: -x, y, z: 0.06 + (i % 2) * 0.02, sy: 0.4 }, 0))]), { kind: 'find' });
item('barred_feather', patternedFeather('#8A8A8A', (x, y) => (Math.floor(Math.hypot(x, y) * 9) % 2 ? '#3E3E42' : null)), { kind: 'find' });
item('copper_feather', patternedFeather('#C8743A', (x, y) => (Math.hypot(x, y) > 0.82 ? '#7A3A1A' : null)), { kind: 'find' });
item('golden_feather_piece', () => mergeAll([patternedFeather('#FFC83D', (x, y) => (Math.hypot(x, y) > 0.7 ? '#FFE58A' : null))(), xform(flowerHead('#FFF3C4', 0.12), { x: -0.32, y: 0.78, z: 0.08, rx: Math.PI / 2 })]), { kind: 'find' });
item('peacock_feather', () => mergeAll([patternedFeather('#2BA88A')(), xform(mergeAll([ball(0.17, '#1F6A9A', { sy: 1.3, sz: 0.3 }, 1), ball(0.11, '#E9B13A', { sy: 1.3, sz: 0.32, z: 0.01 }, 1), ball(0.06, '#1A2A6A', { sy: 1.3, sz: 0.34, z: 0.02 }, 1)]), { x: -0.42, y: 0.78, z: 0.06, rz: 0.5 })]), { kind: 'find' });

/** An heirloom seed tin: a silver canister, the variety's colour band and a little picture of the crop on the lid. */
const seedTin = (band, crop) => () => mergeAll([cyl(0.34, 0.34, 0.62, 18, '#C9CED3'), cyl(0.35, 0.35, 0.3, 18, band, { y: 0.14 }), cyl(0.355, 0.355, 0.06, 18, PAPER, { y: 0.22 }),
  cyl(0.36, 0.36, 0.1, 18, '#8C8F94', { y: 0.6 }), ...crop().map((g) => xform(g, { y: 0.72 }))]);
item('purple_carrot_tin', seedTin('#7A3E8A', () => [xform(P(new THREE.ConeGeometry(0.1, 0.42, 8), '#7A3E8A', { creaseDeg: 50 }), { rz: Math.PI / 2 + 0.3, y: 0.08 }), xform(leaf(0.2, 0.06, '#4E9F3A'), { x: 0.24, y: 0.12, rz: -1.3 })]), { kind: 'find' });
item('moon_melon_tin', seedTin('#E8E0A0', () => [ball(0.2, '#F2E8A8', { y: 0.16, sy: 0.85 }, 2), ...[0, 1, 2, 3].map((i) => ball(0.03, '#C8B860', { x: Math.cos(i * 1.6) * 0.12, y: 0.3, z: Math.sin(i * 1.6) * 0.12 + 0.05, sy: 0.4 }, 0))]), { kind: 'find' });
item('blue_corn_tin', seedTin('#3A5AA8', () => [xform(mergeAll([xform(blob(0.09, '#3A5AA8', { sy: 2.6, detail: 1, amp: 0.05 }), {}), xform(leaf(0.4, 0.1, '#C8D88A'), { rz: 0.2, y: -0.2 })]), { rz: Math.PI / 2 - 0.2, y: 0.1 })]), { kind: 'find' });
item('black_tomato_tin', seedTin('#2A2A2A', () => [ball(0.17, '#3A2A2E', { y: 0.15, sy: 0.85 }, 2), xform(flowerHead('#4E9F3A', 0.09), { y: 0.3 })]), { kind: 'find' });
item('striped_beet_tin', seedTin('#C84A6A', () => [xform(lathe([[0, 0], [0.12, 0.05], [0.17, 0.16], [0.12, 0.28], [0, 0.3]], 10, '#C84A6A'), { y: 0.02 }), torus(0.15, 0.015, '#FFE0E8', { y: 0.16, rx: Math.PI / 2 }, 3, 12),
  ...[0, 1].map((i) => xform(leaf(0.22, 0.08, '#4E9F3A'), { y: 0.3, ry: i * 2.5, rz: 0.3 }))]), { kind: 'find' });

// pond treasures
item('sea_glass', () => mergeAll([xform(blob(0.38, '#7FD8C0', { seed: 4, sy: 0.45, amp: 0.2, detail: 2 }), { y: 0.18 }), xform(blob(0.16, '#B8F0E0', { seed: 9, sy: 0.3, detail: 1 }), { x: -0.08, y: 0.32, z: 0.06 })]), { kind: 'find', pitch: 40 });
item('snail_shell', () => { const parts = []; for (let i = 0; i < 4; i++) parts.push(xform(torus(0.3 - i * 0.07, 0.11 - i * 0.022, i % 2 ? '#C89A6A' : '#E3B88A', {}, 8, 18), { y: 0.3 + i * 0.08, x: i * 0.03 })); parts.push(ball(0.06, '#B5743E', { x: 0.1, y: 0.62 }, 1)); return xform(mergeAll(parts), { rz: Math.PI / 2.4 }); }, { kind: 'find' });
item('old_bottle', () => xform(mergeAll([lathe([[0, 0], [0.26, 0], [0.28, 0.08], [0.28, 0.62], [0.12, 0.8], [0.09, 1.0], [0.11, 1.04], [0, 1.04]], 14, '#5A9A6A'),
  cyl(0.085, 0.07, 0.14, 8, '#C9A06A', { y: 1.0 }), box(0.3, 0.26, 0.02, '#E8DCC2', { y: 0.28, z: 0.28 })]), { rz: 0.5 }), { kind: 'find' });
item('frog_figurine', () => mergeAll([xform(blob(0.34, '#5DAA45', { seed: 2, sx: 1.15, sy: 0.75, detail: 2, amp: 0.06 }), { y: 0.26 }), xform(blob(0.2, '#E8F0B0', { seed: 3, sx: 1.2, sy: 0.5, detail: 1 }), { y: 0.2, z: 0.18 }),
  ...[-1, 1].map((sd) => mergeAll([ball(0.11, '#5DAA45', { x: sd * 0.17, y: 0.5, z: 0.08 }, 1), ball(0.06, '#FFFFFF', { x: sd * 0.17, y: 0.54, z: 0.16 }, 1), ball(0.03, '#1A1A1A', { x: sd * 0.17, y: 0.55, z: 0.21 }, 0)])),
  ...[-1, 1].map((sd) => xform(blob(0.12, '#4A9A3A', { sx: 1.4, sy: 0.5, detail: 1, seed: 5 }), { x: sd * 0.3, y: 0.08, z: 0.12 })), cyl(0.36, 0.38, 0.06, 16, '#C9B79A')]), { kind: 'find' });
item('silver_spoon', () => xform(mergeAll([xform(lathe([[0, 0], [0.16, 0.02], [0.22, 0.08], [0.2, 0.1], [0.14, 0.05], [0, 0.04]], 14, '#D5DADF'), { sz: 1.35, z: 0.42 }),
  box(0.08, 0.035, 0.8, '#C9CED3', { z: -0.18, y: 0.05, rx: -0.12 }), xform(ball(0.08, '#C9CED3', { sy: 0.4 }, 1), { z: -0.6, y: 0.14 })]), { ry: -1.0 }), { kind: 'find', pitch: 50 });

// fossils
const slab = (hex = '#C9B79A') => xform(blob(0.5, hex, { seed: 7, sy: 0.18, amp: 0.15, detail: 1, flatBottom: 0.8 }), { y: 0.05 });
item('ammonite', () => {
  // a stone disc with the coiled shell standing proud of its face: a spiral of ribs growing outward
  const parts = [cyl(0.46, 0.46, 0.16, 22, '#C9B08A', { rx: Math.PI / 2, z: -0.08 }, 40)];
  for (let i = 0; i < 34; i++) {
    const a = i * 0.42; const r = 0.05 + i * 0.0115; const w = 0.035 + i * 0.0022;
    parts.push(xform(box(w * 0.7, w * 2.0, 0.07, i % 2 ? '#A8865A' : '#D8BE92'), { x: Math.cos(a) * r, y: Math.sin(a) * r - 0.035, z: 0.02, rz: a }));
  }
  return xform(mergeAll(parts), { y: 0.46 });
}, { kind: 'find' });
item('trilobite', () => mergeAll([slab(), xform(blob(0.28, '#8A7050', { sx: 0.8, sy: 0.25, sz: 1.2, detail: 1, seed: 2 }), { y: 0.14 }),
  ...Array.from({ length: 6 }, (_, i) => box(0.42 - Math.abs(i - 2) * 0.05, 0.03, 0.04, '#6A5438', { y: 0.2, z: -0.2 + i * 0.08 })), xform(ball(0.12, '#8A7050', { sx: 1.6, sy: 0.4 }, 1), { y: 0.18, z: 0.32 })]), { kind: 'find', pitch: 50 });
item('arrowhead', () => xform(mergeAll([xform(P(new THREE.ConeGeometry(0.32, 0.8, 4), '#6A6A70', { creaseDeg: 20 }), { sz: 0.25, y: 0.45 }), box(0.14, 0.18, 0.06, '#5A5A60', { y: -0.04 })]), { rz: 0.5 }), { kind: 'find' });
item('shark_tooth', () => mergeAll([xform(P(new THREE.ConeGeometry(0.3, 0.7, 3), '#F2EEE2', { creaseDeg: 20 }), { sz: 0.35, y: 0.55 }), xform(blob(0.26, '#8A6A50', { sx: 1.3, sy: 0.5, sz: 0.4, detail: 1 }), { y: 0.16 })]), { kind: 'find' });
item('fern_fossil', () => mergeAll([slab('#B5AEA2'), xform(mergeAll([box(0.03, 0.02, 0.7, '#6A5A48'), ...Array.from({ length: 7 }, (_, i) => [-1, 1].map((sd) => xform(box(0.2 - i * 0.02, 0.02, 0.04, '#6A5A48'), { x: sd * (0.1 - i * 0.01), z: -0.28 + i * 0.09, ry: sd * 0.5 }))).flat()]), { y: 0.13 })]), { kind: 'find', pitch: 55 });

// honey jars: the glass jar of the produce family, each honey its colour, the lid cloth the flower's
// (the honey IS the jar's colour: a clear jar over a fill hides the fill)
const honeyJar = (honey, cloth, flower) => () => mergeAll([lathe([[0, 0], [0.28, 0], [0.32, 0.1], [0.32, 0.78], [0.25, 0.86], [0, 0.86]], 18, honey),
  cyl(0.325, 0.325, 0.24, 18, PAPER, { y: 0.26 }), xform(heartGeo(0.2, cloth), { y: 0.39, z: 0.33 }),
  lathe([[0, 0.83], [0.31, 0.83], [0.36, 0.74], [0.35, 0.8], [0.26, 0.93], [0, 0.95]], 12, cloth), torus(0.27, 0.018, '#C9A06A', { y: 0.86, rx: Math.PI / 2 }, 3, 16),
  xform(flowerHead(flower, 0.11), { y: 0.96 })]);
item('clover_jar', honeyJar('#F7D86A', '#E86A9A', '#FFFFFF'), { kind: 'find' });
item('blossom_jar', honeyJar('#F2C25E', '#FFB6C8', '#FFDDE6'), { kind: 'find' });
item('lavender_jar', honeyJar('#E8C878', '#9C7FD0', '#B9A0E8'), { kind: 'find' });
item('sunflower_jar', honeyJar('#FFC83D', '#F2A81C', '#FFD84A'), { kind: 'find' });
item('heather_jar', honeyJar('#B9773A', '#8E4A8A', '#D88AC8'), { kind: 'find' });

// sewing box finds
// a sewing button: a raised rim round a dished middle with four holes close together and the thread through them
const buttonOf = (hex, rim) => () => xform(mergeAll([cyl(0.44, 0.44, 0.08, 24, rim, {}, 30), cyl(0.33, 0.33, 0.09, 24, hex, {}, 30), xform(torus(0.39, 0.06, rim, {}, 6, 24), { y: 0.08, rx: Math.PI / 2 }),
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => cyl(0.04, 0.04, 0.1, 8, '#2A1A10', { x: a * 0.075, z: b * 0.075 }, 0)),
  box(0.2, 0.025, 0.035, '#F2E6CF', { y: 0.09, ry: Math.PI / 4 }), box(0.2, 0.025, 0.035, '#F2E6CF', { y: 0.09, ry: -Math.PI / 4 })]), { rx: Math.PI / 2 - 0.35 });
item('wooden_button', buttonOf('#B5743E', '#8A5A35'), { kind: 'find' });
item('brass_button', buttonOf('#E9B13A', '#C9952E'), { kind: 'find' });
item('thimble', () => mergeAll([lathe([[0, 0], [0.3, 0], [0.31, 0.08], [0.27, 0.5], [0.2, 0.62], [0, 0.66]], 16, '#D5DADF'),
  ...Array.from({ length: 10 }, (_, i) => ball(0.025, '#9AA0A8', { x: Math.cos(i * 0.63) * 0.29, y: 0.28, z: Math.sin(i * 0.63) * 0.29 }, 0)), torus(0.31, 0.025, '#E9B13A', { y: 0.06, rx: Math.PI / 2 }, 4, 18)]), { kind: 'find' });
item('pincushion', () => mergeAll([xform(blob(0.38, '#E84A5F', { seed: 3, sy: 0.75, amp: 0.05, detail: 2 }), { y: 0.3 }), ...[0, 1, 2, 3, 4, 5].map((i) => xform(cyl(0.012, 0.012, 0.42, 4, '#3A2A1A', {}, 0), { y: 0.3, ry: i, rx: Math.PI }).translate(0, 0, 0)),
  ...[0, 1, 2, 3].map((i) => mergeAll([cyl(0.008, 0.008, 0.3, 3, '#C9CED3', {}, 0), ball(0.04, ['#FFC83D', '#4AA8E8', '#FFFFFF', '#9BD86A'][i], { y: 0.3 }, 0)]).rotateX(-0.4 + i * 0.25).rotateY(i * 1.6).translate(0, 0.52, 0)),
  xform(cyl(0.3, 0.32, 0.12, 14, '#E9B13A'), {}), xform(flowerHead('#4E9F3A', 0.1), { y: 0.6 })]), { kind: 'find' });
// a silver needle threaded with red, beside its little spool
item('silver_needle', () => mergeAll([xform(mergeAll([cyl(0.035, 0.006, 1.2, 8, '#D5DADF', {}, 0), xform(torus(0.04, 0.012, '#D5DADF', {}, 4, 10), { y: 1.18 })]), { rz: 0.75, x: 0.15, y: 0.08 }),
  ...Array.from({ length: 14 }, (_, i) => { const a = i * 0.45; return ball(0.03, '#E84A5F', { x: -0.68 + Math.cos(a) * 0.1 + i * 0.035, y: 0.95 - i * 0.045, z: Math.sin(a) * 0.1 }, 0); }),
  cyl(0.2, 0.2, 0.06, 14, '#C9A06A', { x: 0.42, z: 0.25 }), cyl(0.16, 0.16, 0.3, 14, '#E84A5F', { x: 0.42, y: 0.06, z: 0.25 }), cyl(0.2, 0.2, 0.06, 14, '#C9A06A', { x: 0.42, y: 0.36, z: 0.25 })]), { kind: 'find' });

// County Fair rosettes (the rainbow one is ringed in every colour)
/** A prize rosette standing up, facing the viewer: a ring of pleats, an inner ring, the gold centre, two tails. */
const prizeRosette = (pleat, tails = [pleat, pleat], inner = '#FFF8EC') => () => {
  const cols = Array.isArray(pleat) ? pleat : [pleat];
  const parts = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    parts.push(xform(box(0.13, 0.2, 0.05, cols[i % cols.length]), { x: Math.cos(a) * 0.36, y: Math.sin(a) * 0.36 - 0.1, z: (i % 2) * 0.02, rz: a - Math.PI / 2 }).translate(0, 0.1, 0));
  }
  parts.push(xform(cyl(0.3, 0.3, 0.07, 20, cols[0]), { rx: Math.PI / 2, z: 0.0 }).translate(0, 0, 0.03));
  parts.push(xform(cyl(0.22, 0.22, 0.08, 20, inner), { rx: Math.PI / 2 }).translate(0, 0, 0.06), xform(cyl(0.13, 0.13, 0.09, 16, '#FFC83D'), { rx: Math.PI / 2 }).translate(0, 0, 0.09));
  tails.forEach((h, i) => parts.push(xform(box(0.16, 0.55, 0.03, h), { x: (i ? 1 : -1) * 0.14, y: -0.95, z: -0.04, rz: (i ? -1 : 1) * 0.22 })));
  return xform(mergeAll(parts), { y: 0.95 });
};
item('yellow_rosette', prizeRosette('#FFC83D', ['#FFC83D', '#E9B13A']), { kind: 'find' });
item('red_rosette', prizeRosette('#E84A3A', ['#E84A3A', '#C8302A']), { kind: 'find' });
item('blue_rosette', prizeRosette('#4A7AE0', ['#4A7AE0', '#2F5FC0']), { kind: 'find' });
item('purple_rosette', prizeRosette('#9C5AC8', ['#9C5AC8', '#7A3EA8']), { kind: 'find' });
item('rainbow_rosette', prizeRosette(['#E84A3A', '#F28A1C', '#FFC83D', '#7FB547', '#4A7AE0', '#9C5AC8'], ['#E84A3A', '#4A7AE0']), { kind: 'find' });

// old coins: struck discs with a rim, a head and the edge milled; the lucky one has a four-leaf clover cut in it
const oldCoin = (face, rim, mark) => () => xform(mergeAll([cyl(0.42, 0.42, 0.09, 26, rim, {}, 30), cyl(0.37, 0.37, 0.1, 26, face, {}, 30), ...mark().map((g) => xform(g, { y: 0.1 }))]), { rx: Math.PI / 2 - 0.4, y: 0.4 });
const head = (hex) => () => [xform(blob(0.13, hex, { sx: 0.8, sy: 0.18, sz: 1.0, detail: 1, seed: 3 }), { x: 0.02 }), xform(ball(0.06, hex, { sy: 0.2 }, 0), { x: -0.06, z: -0.13 })];
item('copper_penny', oldCoin('#C8743A', '#9A5428', head('#A85A30')), { kind: 'find' });
item('silver_sixpence', () => xform(oldCoin('#D5DADF', '#A8AEB5', head('#B5BBC2'))(), { s: 0.8 }), { kind: 'find' });
item('old_florin', oldCoin('#C9CED3', '#9AA0A8', () => [box(0.32, 0.03, 0.06, '#9AA0A8'), box(0.06, 0.03, 0.32, '#9AA0A8'), ...[0, 1, 2, 3].map((i) => ball(0.05, '#9AA0A8', { x: Math.cos(i * 1.57) * 0.2, z: Math.sin(i * 1.57) * 0.2, sy: 0.4 }, 0))]), { kind: 'find' });
item('gold_sovereign', oldCoin('#FFD54A', '#E09A1E', head('#E9B13A')), { kind: 'find' });
item('lucky_coin', oldCoin('#FFD54A', '#7FB547', () => [0, 1, 2, 3].map((i) => ball(0.09, '#4E9F3A', { x: Math.cos(i * 1.57 + 0.78) * 0.1, z: Math.sin(i * 1.57 + 0.78) * 0.1, sy: 0.3 }, 1))), { kind: 'find' });

// love notes (keepsakes of the two farmers): paper things standing a little back
const heartGeo = (s, hex) => { const hh = new THREE.Shape(); hh.moveTo(0, -0.3 * s); hh.bezierCurveTo(0.55 * s, 0.12 * s, 0.3 * s, 0.55 * s, 0, 0.27 * s); hh.bezierCurveTo(-0.3 * s, 0.55 * s, -0.55 * s, 0.12 * s, 0, -0.3 * s);
  return P(new THREE.ExtrudeGeometry(hh, { depth: 0.03, bevelEnabled: false, curveSegments: 6 }), hex); };
item('first_note', () => xform(mergeAll([box(0.8, 0.56, 0.02, PAPER), xform(box(0.8, 0.3, 0.02, '#F2E6CF'), { y: 0.28, z: 0.06, rx: -0.6 }),
  ...[0.12, 0.2].map((y) => box(0.5, 0.015, 0.025, INK, { y })), xform(heartGeo(0.3, '#E84A5F'), { x: 0.24, y: 0.06, z: 0.015 })]), { rx: -0.2 }), { kind: 'find' });
item('pressed_flower', () => xform(mergeAll([box(0.72, 0.9, 0.02, '#F2E6CF'), cyl(0.008, 0.008, 0.5, 3, '#4E9F3A', { y: 0.12, z: 0.02 }, 0),
  ...[[-0.06, 0.3, 0.6], [0.07, 0.42, -0.5]].map(([x, y, rz]) => xform(leaf(0.16, 0.07, '#5DAA45', { seg: 1 }), { x, y, z: 0.02, rz })),
  xform(flatFlower('#C8A0E8', 0.13), { y: 0.66, z: 0.03, rx: Math.PI / 2 })]), { rx: -0.2 }), { kind: 'find' });
item('ticket_stub', () => xform(mergeAll([box(0.9, 0.42, 0.02, '#FF9FB0'), box(0.2, 0.42, 0.021, '#FFC8D4', { x: 0.36 }), ...Array.from({ length: 6 }, (_, i) => cyl(0.018, 0.018, 0.03, 5, '#FFFFFF', { x: 0.25, y: 0.03 + i * 0.07, rx: Math.PI / 2 }, 0)),
  box(0.5, 0.05, 0.025, '#C8405A', { x: -0.12, y: 0.28 }), box(0.36, 0.03, 0.025, '#C8405A', { x: -0.19, y: 0.16 }), xform(heartGeo(0.18, '#C8405A'), { x: 0.36, y: 0.2, z: 0.012 })]), { rx: -0.25, rz: 0.12 }), { kind: 'find' });
item('polaroid', () => xform(mergeAll([box(0.7, 0.84, 0.03, '#FFFFFF'), box(0.6, 0.56, 0.035, '#8FD0F0', { y: 0.2 }), box(0.6, 0.18, 0.036, '#7CC243', { y: 0.2 }),
  xform(ball(0.07, '#FFE27A', { sz: 0.2 }, 1), { x: 0.16, y: 0.62 }), ...[-0.1, 0.06].map((x, i) => mergeAll([box(0.07, 0.16, 0.04, i ? '#FF7A6B' : '#2BB3A3', { x, y: 0.36 }), ball(0.045, '#F2C29A', { x, y: 0.56, sz: 0.4 }, 0)]))]), { rx: -0.2, rz: -0.08 }), { kind: 'find' });
item('ribbon_letter', () => xform(mergeAll([box(0.9, 0.6, 0.06, '#F2E6CF'), xform(P(new THREE.ConeGeometry(0.52, 0.32, 3), '#E8D8B8', { creaseDeg: 0 }), { y: 0.44, z: 0.03, sz: 0.06, rz: Math.PI }),
  box(0.92, 0.07, 0.07, '#E84A5F', { y: 0.27 }), box(0.07, 0.62, 0.07, '#E84A5F', { x: 0.1 }), ...[-1, 1].map((sd) => xform(torus(0.08, 0.025, '#E84A5F', {}, 3, 7), { x: 0.1 + sd * 0.09, y: 0.33, z: 0.05, sx: 1.3 })),
  xform(heartGeo(0.16, '#C8405A'), { x: -0.25, y: 0.08, z: 0.035 })]), { rx: -0.25 }), { kind: 'find' });
for (const t of ['sickle', 'watering_can', 'basket', 'feed_scoop', 'seed_bag', 'axe', 'hammer', 'hoe', 'compost_scoop']) {
  job(`tool:${t}`, 'tools/tools.glb', { family: 'tool', def: `tool_${t}`, footprint: [1, 1] }, async () => sway(fit(await I[t](), { h: t === 'basket' || t === 'seed_bag' || t === 'feed_scoop' || t === 'compost_scoop' || t === 'watering_can' ? 0.42 : 0.75 }), { rigid: true }));
}
// wave 3: the fishing rod, 2 m from the butt to the tip (manifest `tip`: avatars-view hangs the line there)
job('tool:fishing_rod', 'tools/tools.glb', { family: 'tool', def: 'tool_fishing_rod', footprint: [1, 1], tip: [0, 2, 0] }, async () => sway(fishingRod(), { rigid: true }));
function kfSync(hex) { return mergeAll([xform(P(new THREE.CapsuleGeometry(0.18, 0.2, 3, 8), hex, { creaseDeg: 60 }), { y: 0.2 }), cyl(0.03, 0.04, 0.1, 5, '#4E8F35', { y: 0.45 }, 0)]); }
// wave 3: the Fishing Dock's fish (content FISHING.fish: never items, but the dock panel shows each species' record)
function fishModel(hue, joke = false) {
  if (joke) return mergeAll([box(0.36, 0.42, 0.22, '#5A4030', { x: -0.05 }), box(0.62, 0.16, 0.24, '#4A3424', { x: 0.08 }), box(0.66, 0.05, 0.26, '#2E2018', { x: 0.08, y: -0.02 }),
    ...[0, 1, 2].map((i) => cyl(0.012, 0.012, 0.06, 4, '#D9C59A', { x: -0.05, y: 0.3 + i * 0.05, z: 0.11 }, 0))]);
  return mergeAll([xform(blob(0.3, hue, { seed: 7, sx: 1.9, sy: 0.85, sz: 0.5, amp: 0.05, detail: 2 }), {}), xform(blob(0.22, '#F2F0E6', { seed: 8, sx: 1.6, sy: 0.5, sz: 0.46, detail: 1 }), { y: -0.1 }),
    xform(P(new THREE.ConeGeometry(0.24, 0.4, 4), hue), { rz: Math.PI / 2, x: -0.7, sz: 0.2 }), xform(P(new THREE.ConeGeometry(0.12, 0.26, 3), hue), { y: 0.22, sz: 0.15 }),
    ball(0.05, '#1A1A1A', { x: 0.4, y: 0.07, z: 0.13 }, 0), ball(0.05, '#1A1A1A', { x: 0.4, y: 0.07, z: -0.13 }, 0)]);
}
for (const f of (FISHING && FISHING.fish) || []) item(`fish_${f.id}`, () => fishModel(f.hue, !!f.joke), { kind: 'fish', yaw: 70 });
export const ITEM_IDS = () => Object.keys(I);
/** Item builders by id (the preview tooling renders them without a full build). */
export const ITEM_BUILDERS = I;

async function buildItems() {
  // Item models go to the build cache only; make-icons renders them. One small GLB per item.
  const dir = path.join(CACHE, 'items');
  fs.mkdirSync(dir, { recursive: true });
  const list = [];
  const failures = [];
  for (const [id, build] of Object.entries(I)) {
    try {
      const g = await build();
      const geo = fit(g.index ? g : weld(g), { w: 1, d: 1, h: 1, fill: 1 });
      sway(geo, { rigid: true });
      const file = `${id}.glb`;
      const t = await tools();
      const doc = new t.core.Document().setLogger(t.logger);
      const out = { statics: [{ key: `item:${id}`, geometry: geo }] };
      const saveOut = manifest.files;
      await writeStaticFileTo(doc, out, path.join(dir, file));
      void saveOut;
      list.push({ id, file, key: `item:${id}`, tris: tris(geo), kind: iconOf.get(id)?.kind || 'item', ...iconOf.get(id) });
    } catch (err) { failures.push(`item ${id}: ${err.message}`); }
  }
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify(list, null, 1));
  return { list, failures };
}

async function writeStaticFileTo(doc, entry, abs) {
  const t = await tools();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('scene');
  const mat = doc.createMaterial('vc').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(1);
  for (const { key, geometry: g } of entry.statics) {
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', writeAccessor(doc, buffer, new Float32Array(g.getAttribute('position').array), 'VEC3'))
      .setAttribute('NORMAL', writeAccessor(doc, buffer, new Float32Array(g.getAttribute('normal').array), 'VEC3'))
      .setAttribute('COLOR_0', writeAccessor(doc, buffer, new Float32Array(g.getAttribute('color').array), 'VEC3'))
      .setIndices(writeAccessor(doc, buffer, new Uint32Array(g.index.array), 'SCALAR')).setMaterial(mat);
    scene.addChild(doc.createNode(nodeName(key)).setMesh(doc.createMesh(nodeName(key)).addPrimitive(prim)).setExtras({ key }));
  }
  await t.io.write(abs, doc);
}

// ---------------------------------------------------------------------------------------------------
// 16. Wave 3 (M2, L26-40). The Grand decor (GDD §3.8: the ten showcase pieces, the luxury tier: each has to look like
//     the best thing on the farm), the M2 decor and the Fishing Dock, the M2 crops, trees and buildings, the Town
//     Projects 5-24 with the Festival Pavilion, and the farmhouse interior. The builders are function declarations
//     (hoisted), so the registrations in the sections above can name them.
const GOLD = '#E9B13A'; const GOLD_L = '#FFD45A'; const GOLD_D = '#B8862B'; const IRON = '#3E3A40';
const PAINT = '#FFF8EC'; const LIMESTONE = '#D8C9AA'; const LIMESTONE_D = '#BFAF8E'; const TERRACOTTA = '#C8643A';
const LEAF = '#4C9A3E'; const LEAF_D = '#3B8A35'; const LEAF_L = '#6BB040'; const WATER_DEEP = '#2F7F94'; const WATER_SHALLOW = '#7DB9B5';

/** n copies round a circle of radius r; fn(i, angle) builds one at the origin facing +z (turned to face outward). */
function around(n, r, fn, { y = 0, a0 = 0, face = true } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const g = fn(i, a);
    if (g) out.push(xform(g, { x: Math.sin(a) * r, y, z: Math.cos(a) * r, ry: face ? a : 0 }));
  }
  return out;
}
/** A tube along [[x, y, z], ...] (ropes, scrollwork, garlands, cords). */
function tube(points, r, hex, { seg = 5, steps = null, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
  return P(new THREE.TubeGeometry(curve, steps || Math.max(3, points.length * 4), r, seg, closed), hex, { creaseDeg: 60 });
}
/** A string of warm bulbs sagging from a to b (the decor's `glow` lights the night). */
function lightString(a, b, n, { sag = 0.3, bulb = 0.055, cord = '#4A3A2A', cols = ['#FFE08A', '#FFD39B', '#FFF3C4'] } = {}) {
  const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
  const parts = [tube(Array.from({ length: 7 }, (_, i) => at(i / 6)), 0.011, cord, { seg: 3, steps: 12 })];
  for (let i = 1; i <= n; i++) { const p = at(i / (n + 1)); parts.push(ball(bulb, cols[i % cols.length], { x: p[0], y: p[1] - bulb, z: p[2] }, 0)); }
  return mergeAll(parts);
}
/** Tone a geometry's vertex colours by low-frequency noise (leaf clumps, weathered stone), k in [lo, hi]. */
function mottle(g, { freq = 2, lo = 0.84, hi = 1.12, seed = 1 } = {}) {
  const p = g.getAttribute('position'); const c = g.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    const n = noise3(p.getX(i) * freq + 3, p.getY(i) * freq + 5, p.getZ(i) * freq + 7, seed);
    const k = lo + (hi - lo) * Math.min(1, Math.max(0, n * 0.5 + 0.5));
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return g;
}
/** A clipped hedge block w x h x d standing on y = 0: puffed, rounded at the top, two-tone leaf clumps. */
function hedgeBlock(w, h, d, { seed = 1, hex = LEAF_D } = {}) {
  const g = new THREE.BoxGeometry(w, h, d, Math.max(1, Math.round(w / 0.7)), Math.max(1, Math.round(h / 0.6)), Math.max(1, Math.round(d / 0.7)));
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i); let y = p.getY(i); let z = p.getZ(i);
    const t = (y + h / 2) / h;
    const n = noise3(x * 2.1 + seed, y * 2.1, z * 2.1, seed);
    const k = (1 + n * 0.07) * (t > 0.8 ? 1 - (t - 0.8) * 0.45 : 1);
    x *= k; z *= k; y = y + h / 2 + (t > 0.05 ? n * 0.05 : 0);
    p.setXYZ(i, x, y, z);
  }
  const x = P(g, hex);
  return crease(mottle(x, { freq: 2.4, seed, lo: 0.82, hi: 1.16 }), 75);
}
/** Flat five-petal flowers dotted over a box region (on hedges, beds). */
function flowersOver(n, [x0, x1], [y0, y1], [z0, z1], cols, { seed = 1, r = 0.07, up = true } = {}) {
  const rr = rng(`fo${seed}`);
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = flatFlower(cols[i % cols.length], r * (0.8 + rr() * 0.4));
    out.push(xform(f, { x: x0 + (x1 - x0) * rr(), y: y0 + (y1 - y0) * rr(), z: z0 + (z1 - z0) * rr(), rx: up ? 0 : Math.PI / 2 }));
  }
  return out;
}
/** A wooden or stone post railing round a polygon (closed), posts every `step` metres. */
function railing(points, { h = 0.75, post = PAINT, rail = PAINT, step = 0.6, r = 0.035, closed = true, gaps = [] } = {}) {
  const parts = [];
  const pts = closed ? [...points, points[0]] : points;
  const inGap = (x, z) => gaps.some(([gx, gz, gr]) => Math.hypot(x - gx, z - gz) < gr);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i]; const [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0); const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const x = x0 + ((x1 - x0) * k) / n; const z = z0 + ((z1 - z0) * k) / n;
      if (!inGap(x, z)) parts.push(cyl(r, r, h, 5, post, { x, z }, 0));
    }
    const mx = (x0 + x1) / 2; const mz = (z0 + z1) / 2;
    if (!inGap(mx, mz)) for (const y of [h - 0.04, h * 0.45]) parts.push(xform(box(len, 0.05, 0.05, rail), { x: mx, y, z: mz, ry: -Math.atan2(z1 - z0, x1 - x0) }));
  }
  return mergeAll(parts);
}
/** A regular polygon's corner points (radius r, n sides, the first corner at angle a0 from +z). */
const polygon = (n, r, a0 = 0) => Array.from({ length: n }, (_, i) => [Math.sin(a0 + (i / n) * Math.PI * 2) * r, Math.cos(a0 + (i / n) * Math.PI * 2) * r]);
/** Paint every triangle of a cone/cylinder side by its angular sector (n stripes in `cols`). */
function stripes(g, n, cols) {
  const x = g.index ? g.toNonIndexed() : g;
  const p = x.getAttribute('position'); const c = x.getAttribute('color');
  const lc = cols.map((h) => lin(h));
  for (let f = 0; f < p.count / 3; f++) {
    const cx = (p.getX(f * 3) + p.getX(f * 3 + 1) + p.getX(f * 3 + 2)) / 3; const cz = (p.getZ(f * 3) + p.getZ(f * 3 + 1) + p.getZ(f * 3 + 2)) / 3;
    const a = (Math.atan2(cx, cz) + Math.PI * 2) % (Math.PI * 2);
    const col = lc[Math.floor((a / (Math.PI * 2)) * n) % lc.length];
    for (let j = 0; j < 3; j++) c.setXYZ(f * 3 + j, col.r, col.g, col.b);
  }
  return x;
}
/** A white-painted Versailles planter box with a lollipop orange tree (the orangery's, the tea room's). */
function orangeTub(s = 1) {
  const parts = [box(0.62, 0.55, 0.62, PAINT), box(0.7, 0.06, 0.7, PAINT, { y: 0.55 }), ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ball(0.05, GOLD, { x: x * 0.31, y: 0.62, z: z * 0.31 }, 0)),
    box(0.54, 0.03, 0.54, '#5A3420', { y: 0.56 }), cyl(0.04, 0.05, 0.75, 6, TRUNK, { y: 0.56 })];
  parts.push(xform(mottle(blob(0.42, '#3F8A3A', { seed: 7, amp: 0.1, detail: 1 }), { freq: 3, seed: 4 }), { y: 1.55 }));
  const rr = rng('orangetub');
  for (let i = 0; i < 9; i++) { const a = rr() * 6.28; const y = 1.3 + rr() * 0.5; const rad = 0.38 * Math.sqrt(1 - ((y - 1.55) / 0.45) ** 2); parts.push(ball(0.06, '#F28C1E', { x: Math.sin(a) * rad, y, z: Math.cos(a) * rad }, 0)); }
  return xform(mergeAll(parts), { s });
}
/** A stone urn on a square foot, brimming with flowers. */
function flowerUrn(cols = ['#FF7A9C', '#FFFFFF', '#FFD21F'], stone = LIMESTONE) {
  return mergeAll([box(0.42, 0.18, 0.42, LIMESTONE_D), lathe([[0, 0], [0.12, 0], [0.1, 0.12], [0.16, 0.2], [0.3, 0.42], [0.33, 0.5], [0, 0.5]], 14, stone, 40).translate(0, 0.18, 0),
    xform(blob(0.3, LEAF, { seed: 11, sy: 0.55, detail: 1 }), { y: 0.72 }), ...flowersOver(7, [-0.22, 0.22], [0.82, 0.86], [-0.22, 0.22], cols, { seed: 3, r: 0.07 })]);
}
/** A red paper lantern (the bath house's, the pavilion's) hanging from y = 0 down. */
function paperLantern(hex = '#E8513C', h = 0.42) {
  return mergeAll([cyl(0.012, 0.012, 0.12, 3, IRON, { y: -0.12 }, 0), cyl(0.09, 0.09, 0.04, 8, '#3A2A1A', { y: -0.16 }),
    xform(lathe([[0, 0], [0.14, 0.02], [0.19, h * 0.25], [0.2, h * 0.5], [0.19, h * 0.75], [0.14, h - 0.02], [0, h]], 10, hex, 60), { y: -0.16 - h }),
    cyl(0.09, 0.09, 0.04, 8, '#3A2A1A', { y: -0.2 - h }), cyl(0.015, 0.015, 0.14, 3, '#E9B13A', { y: -0.34 - h }, 0)]);
}

// ---- The Old Dutch Windmill (L20, 3 x 3): a red smock mill on a brick base, a white gallery round it, a boat-shaped
//      cap and four lattice sails with canvas (a part of their own: `building:grand_windmill:sails`, spun by
//      objects-view about the hub like the Windmill's), tulip beds round the foot.
const GWM = Object.freeze({ hubY: 6.3, hubZ: 2.05 });
function grandWindmill() {
  const RED = '#A84B3A'; const CAP = '#5C4A3E';
  const parts = [];
  const B0 = 1.95; const B1 = 2.1; const G = 2.55; const Y0 = 1.1; const S0 = 1.72; const S1 = 1.15; const SH = 4.2;
  parts.push(courses(xform(cyl(B0, B1, Y0, 8, '#C9B49A', {}, 25), { ry: Math.PI / 8 }), 5, [0.88, 1.04]));
  parts.push(xform(cyl(G, G, 0.12, 8, WOOD, { y: Y0 }, 0), { ry: Math.PI / 8 }));
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
    parts.push(xform(box(0.12, 0.5, 0.22, WOOD_D, { y: 0.62 }), { x: Math.sin(a) * (G - 0.2), z: Math.cos(a) * (G - 0.2), ry: a, rx: -0.6 }));   // brackets
  }
  parts.push(railing(polygon(8, G - 0.08, Math.PI / 8), { h: 0.7, step: 0.45, post: PAINT, rail: PAINT }).translate(0, Y0 + 0.12, 0));
  // the smock: an octagonal frustum of red shingles with cream corner ribs (a face looks to the front)
  const YS = Y0 + 0.12;
  parts.push(courses(xform(cyl(S1, S0, SH, 8, RED, { y: YS }, 25), { ry: Math.PI / 8 }), 15, [0.85, 1.0, 1.1]));
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
    parts.push(tube([[Math.sin(a) * (S0 + 0.04), YS, Math.cos(a) * (S0 + 0.04)], [Math.sin(a) * (S1 + 0.04), YS + SH, Math.cos(a) * (S1 + 0.04)]], 0.06, '#F3E6CC', { seg: 4, steps: 1 }));
  }
  parts.push(xform(cyl(S1 + 0.1, S1 + 0.1, 0.14, 8, '#F3E6CC', { y: YS + SH - 0.07 }, 0), { ry: Math.PI / 8 }));
  // front: a door onto the gallery and two windows up the smock; a door in the brick base
  const slope = Math.atan2(S0 - S1, SH);
  const onFace = (g, y) => { const r = S0 - (S0 - S1) * ((y - YS) / SH); return xform(g, { y, z: r * Math.cos(Math.PI / 8) + 0.02, rx: -slope }); };
  parts.push(onFace(doorBox(0.66, 1.3, '#5E7F55'), YS + 0.02), onFace(windowBox(0.44, 0.54, { shutters: '#5E7F55' }), YS + 1.8), onFace(windowBox(0.36, 0.44), YS + 3.2));
  parts.push(xform(doorBox(0.7, 0.9, '#7A4B2C'), { x: -1.0, z: B1 * Math.cos(Math.PI / 8) - 0.35, ry: 0.4 }));
  // the boat-shaped cap, the windshaft and a little weathervane
  const YC = YS + SH;
  parts.push(courses(xform(clipBelow(xform(P(new THREE.CapsuleGeometry(1.2, 1.1, 4, 12), CAP, { creaseDeg: 50 }), { rx: Math.PI / 2 }), -0.02), { y: YC - 0.02, sy: 0.85 }), 6, [0.86, 1.0, 1.1]),
    xform(cyl(1.28, 1.28, 0.1, 12, '#F3E6CC', { y: YC - 0.06 }, 0), { sz: 1.45 }));
  parts.push(xform(box(0.5, 0.5, 0.9, CAP), { y: GWM.hubY - 0.25, z: 1.2 }), tube([[0, GWM.hubY, 1.2], [0, GWM.hubY, GWM.hubZ - 0.05]], 0.15, '#6B6258', { seg: 8, steps: 1 }));
  parts.push(xform(mergeAll([cyl(0.04, 0.05, 1.0, 5, IRON), xform(P(new THREE.ConeGeometry(0.2, 0.12, 3), '#E8513C'), { rz: -Math.PI / 2, x: 0.14, y: 0.9, sz: 0.2 })]), { y: YC + 0.95, z: -0.6 }));
  // tulip beds round the foot (red, yellow, pink on dark soil), and sacks of flour by the door
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (i - 3) * 0.6;
    const bed = mergeAll([xform(blob(0.5, '#5A3A26', { seed: 30 + i, sy: 0.12, sx: 1.3, detail: 1 }), { y: 0.02 }),
      ...Array.from({ length: 7 }, (_, k) => xform(tulip(['#E8443A', '#FFD21F', '#FF8FB0'][i % 3]), { x: (k - 3) * 0.17, z: (k % 2) * 0.16 - 0.08, s: 0.9 }))]);
    parts.push(xform(bed, { x: Math.sin(a) * 2.45, z: Math.cos(a) * 2.45, ry: a + Math.PI / 2 }));
  }
  parts.push(xform(sack('#FFFDF4'), { x: -1.75, z: 1.45 }), xform(sack('#FFFDF4'), { x: -2.05, z: 1.1, ry: 0.8, s: 0.85 }));
  return mergeAll(parts);
}
/** The sails, centred on the hub in the plane z = 0 (spin about +z): four stocks with lattice and canvas. */
function grandWindmillSails() {
  const parts = [cyl(0.32, 0.32, 0.22, 12, '#6B6258', {}, 40).rotateX(Math.PI / 2).translate(0, 0, 0.1), ball(0.16, '#5A524A', { z: 0.24 }, 1)];
  for (let k = 0; k < 4; k++) {
    const arm = [box(0.17, 3.95, 0.15, '#8A5A35', { y: 0.05 })];
    const L0 = 0.95; const L1 = 3.85; const W0 = 0.12; const W1 = 0.82;
    for (const x of [W0, W1]) arm.push(box(0.05, L1 - L0, 0.06, '#D9C29A', { x, y: L0, z: 0.05 }));
    for (let y = L0; y <= L1 + 1e-6; y += 0.32) arm.push(box(W1 - W0 + 0.05, 0.045, 0.05, '#D9C29A', { x: (W0 + W1) / 2, y, z: 0.06 }));
    arm.push(box(W1 - W0 - 0.02, L1 - L0 - 0.15, 0.025, k % 2 ? '#F3EAD6' : '#EADDC3', { x: (W0 + W1) / 2, y: L0 + 0.08, z: -0.03 }));
    // a little twist: the canvas tips into the wind
    parts.push(xform(mergeAll(arm), { rz: (k * Math.PI) / 2 + 0.3, ry: 0 }));
  }
  return mergeAll(parts);
}

// ---- The Flower Maze (L23, 4 x 4): clipped hedges on a gravel floor in three rings with offset gaps (the farmers can
//      walk it), roses on the hedges, topiary balls on the corners, a white rose arch at the gate and a sundial with a
//      bench at the heart.
function flowerMaze() {
  const S = 3.7; const T = 0.5; const H = 1.2;
  const parts = [xform(mottle(box(S * 2, 0.05, S * 2, '#DCCBA6'), { freq: 3, lo: 0.9, hi: 1.08, seed: 2 }), { y: 0 })];
  const pebbles = rng('mazepeb');
  for (let i = 0; i < 16; i++) parts.push(xform(blob(0.05 + pebbles() * 0.04, '#B9A98A', { seed: i, sy: 0.4, detail: 0 }), { x: (pebbles() - 0.5) * S * 1.9, y: 0.05, z: (pebbles() - 0.5) * S * 1.9 }));
  // walls: [x0, z0, x1, z1] in metres (axis-aligned), the rings with gaps
  const walls = [];
  const ring = (r, gap) => {
    // gap: { side: 'n'|'s'|'e'|'w', at: offset along the side, w: width }
    const sides = { s: [[-r, r], [r, r]], n: [[-r, -r], [r, -r]], w: [[-r, -r], [-r, r]], e: [[r, -r], [r, r]] };
    for (const [name, [[ax, az], [bx, bz]]] of Object.entries(sides)) {
      const g = gap.find((q) => q.side === name);
      if (!g) { walls.push([ax, az, bx, bz]); continue; }
      const horiz = az === bz;
      const lo = (horiz ? ax : az); const hi = (horiz ? bx : bz);
      const g0 = g.at - g.w / 2; const g1 = g.at + g.w / 2;
      if (g0 > lo) walls.push(horiz ? [lo, az, g0, bz] : [ax, lo, bx, g0]);
      if (g1 < hi) walls.push(horiz ? [g1, az, hi, bz] : [ax, g1, bx, hi]);
    }
  };
  ring(S - T / 2, [{ side: 's', at: 0, w: 1.3 }]);
  ring(2.35, [{ side: 'n', at: -0.9, w: 1.1 }, { side: 'e', at: 1.2, w: 1.0 }]);
  ring(1.1, [{ side: 'w', at: 0.3, w: 0.9 }]);
  walls.push([1.45, 2.35, 1.45, 3.45], [-2.35, 0.2, -3.45, 0.2], [1.5, -2.35, 1.5, -3.45]);        // dead-end spurs
  walls.forEach(([x0, z0, x1, z1], i) => {
    const horiz = Math.abs(z1 - z0) < 1e-6;
    const len = horiz ? Math.abs(x1 - x0) + T : Math.abs(z1 - z0) + T;
    const hb = hedgeBlock(horiz ? len : T, H - (i % 3) * 0.04, horiz ? T : len, { seed: i + 3 });
    parts.push(xform(hb, { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }));
    const n = Math.round(len * 1.5);
    parts.push(...flowersOver(n, horiz ? [Math.min(x0, x1), Math.max(x0, x1)] : [(x0 + x1) / 2 - 0.2, (x0 + x1) / 2 + 0.2], [H - 0.02, H + 0.04],
      horiz ? [z0 - 0.2, z0 + 0.2] : [Math.min(z0, z1), Math.max(z0, z1)], i % 2 ? ['#FF7A9C', '#FFFFFF', '#E83A55'] : ['#FFD21F', '#FFFFFF', '#FF9FB0'], { seed: i, r: 0.085 }));
  });
  // topiary balls on the four outer corners, on stone feet
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(xform(mergeAll([box(0.5, 0.25, 0.5, LIMESTONE_D), xform(mottle(blob(0.42, '#3F8F36', { seed: 9, amp: 0.05, detail: 1 }), { freq: 4, seed: 3 }), { y: 0.66 })]), { x: x * (S - 0.25), y: H, z: z * (S - 0.25) }));
  // the white rose arch over the gate
  const arch = [box(0.12, 2.2, 0.12, PAINT, { x: -0.72, z: S - 0.25 }), box(0.12, 2.2, 0.12, PAINT, { x: 0.72, z: S - 0.25 }), clipBelow(xform(torus(0.72, 0.06, PAINT, {}, 5, 18), { y: 2.2, z: S - 0.25 }), 2.18)];
  const ar = rng('maze-arch');
  for (let i = 0; i < 16; i++) { const t = ar() * Math.PI; const x = Math.cos(t) * 0.72; const y = 2.2 + Math.sin(t) * 0.72; arch.push(xform(blob(0.15, LEAF, { seed: i, detail: 0 }), { x, y, z: S - 0.25 }), ball(0.075, i % 3 ? '#E83A55' : '#FF9FB0', { x: x + 0.04, y: y + 0.06, z: S - 0.13 }, 0)); }
  parts.push(...arch);
  // the heart: a sundial on a column and a little curved bench
  parts.push(mergeAll([cyl(0.35, 0.42, 0.12, 12, LIMESTONE_D), lathe([[0.16, 0], [0.12, 0.1], [0.1, 0.7], [0.2, 0.8], [0.3, 0.86], [0, 0.86]], 12, LIMESTONE, 40).translate(0, 0.12, 0),
    cyl(0.3, 0.3, 0.03, 16, '#C9A26A', { y: 0.98 }), xform(P(new THREE.ConeGeometry(0.16, 0.22, 3), GOLD), { y: 1.01, rz: 0.0, sz: 0.15 })]).translate(0, 0, 0.22));
  parts.push(xform(mergeAll([box(1.1, 0.07, 0.36, PAINT, { y: 0.42 }), box(1.1, 0.4, 0.06, PAINT, { y: 0.48, z: -0.16 }), box(0.08, 0.42, 0.3, PAINT, { x: -0.48 }), box(0.08, 0.42, 0.3, PAINT, { x: 0.48 })]), { z: -0.48 }));
  return mergeAll(parts);
}

// ---- The Koi Pond (L26, 3 x 3): a kidney-shaped pond in a ring of rounded stones, deep teal shading to shallows,
//      lily pads with pink lotus, five koi, a red arched bridge over the narrow end, a stone lantern, iris and a
//      two-seat bench on the front edge facing the water (Golden Hour seat; avatars-view SEATS).
function pondOutline(r0, a = 0.14, b = 0.07, seed = 0) { return (t) => r0 * (1 + a * Math.sin(2 * t + seed) + b * Math.cos(3 * t + seed * 2)); }
/** A flat water disc following r(t), deep at the middle and shallow at the rim (polar mesh: rings x segments). */
function waterSurface(rf, { y = 0.1, rings = 4, seg = 36, deep = WATER_DEEP, shallow = WATER_SHALLOW, k = 1 } = {}) {
  const pos = []; const col = [];
  const cd = lin(deep); const cs = lin(shallow); const c = new THREE.Color();
  const pt = (ri, s) => { const t = (s / seg) * Math.PI * 2; const r = rf(t) * k * (ri / rings); return [Math.sin(t) * r, y, Math.cos(t) * r]; };
  const tone = (ri) => c.copy(cd).lerp(cs, Math.pow(ri / rings, 1.6));
  for (let ri = 0; ri < rings; ri++) for (let s = 0; s < seg; s++) {
    const a = pt(ri, s); const b2 = pt(ri, s + 1); const cc = pt(ri + 1, s); const d = pt(ri + 1, s + 1);
    const tris2 = ri === 0 ? [[a, cc, d]] : [[a, cc, d], [a, d, b2]];
    for (const tr of tris2) for (const v of tr) { pos.push(...v); const ri2 = v === a || v === b2 ? ri : ri + 1; tone(ri2); col.push(c.r, c.g, c.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
/** A ring of rounded stones along r(t) (pond and pool rims). */
function stoneRim(rf, n, { seed = 1, size = 0.32, cols = ['#B9B2A4', '#A7A096', '#C9C1B0', '#9C958A'], y = 0.02 } = {}) {
  const rr = rng(`rim${seed}`);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2 + rr() * 0.05; const r = rf(t) * 1.02;
    const s = size * (0.75 + rr() * 0.5);
    out.push(xform(blob(s, cols[i % cols.length], { seed: seed * 50 + i, sy: 0.55, amp: 0.22, detail: 1, flatBottom: 0.4 }), { x: Math.sin(t) * r, y: y + s * 0.2, z: Math.cos(t) * r, ry: rr() * 6 }));
  }
  return out;
}
function koiFish(base, spot) {
  return mergeAll([xform(blob(0.11, base, { seed: 3, sx: 0.55, sy: 0.38, sz: 1.5, amp: 0.05, detail: 1 }), {}),
    xform(blob(0.06, spot, { seed: 4, sx: 0.6, sy: 0.4, sz: 1.2, amp: 0.1, detail: 0 }), { y: 0.025, z: 0.02 }),
    xform(P(new THREE.ConeGeometry(0.08, 0.14, 4), base), { rx: -Math.PI / 2, z: -0.2, sx: 1, sy: 0.2 }),
    xform(P(new THREE.ConeGeometry(0.04, 0.08, 3), spot), { rz: Math.PI / 2, x: 0.08, z: 0.04, sy: 0.25 }), xform(P(new THREE.ConeGeometry(0.04, 0.08, 3), spot), { rz: -Math.PI / 2, x: -0.08, z: 0.04, sy: 0.25 })]);
}
function lilyPad(r, hex = '#5E9E3A') { return xform(P(new THREE.CircleGeometry(r, 10, 0.3, Math.PI * 2 - 0.6), hex), { rx: -Math.PI / 2 }); }
function lotus(hex = '#FF9FB8') {
  return mergeAll([...Array.from({ length: 6 }, (_, i) => xform(P(new THREE.ConeGeometry(0.05, 0.14, 4), i % 2 ? hex : '#FFD3DF'), { rx: 0.5, ry: (i / 6) * Math.PI * 2, y: 0.06 })),
    ball(0.03, '#FFE14A', { y: 0.08 }, 0)]);
}
function stoneLantern() {
  return mergeAll([box(0.36, 0.1, 0.36, LIMESTONE_D), cyl(0.07, 0.09, 0.55, 6, LIMESTONE, { y: 0.1 }), box(0.34, 0.08, 0.34, LIMESTONE, { y: 0.65 }), box(0.24, 0.24, 0.24, '#FFE08A', { y: 0.73 }),
    ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => box(0.05, 0.24, 0.05, LIMESTONE, { x: x * 0.12, y: 0.73, z: z * 0.12 })),
    xform(P(new THREE.ConeGeometry(0.34, 0.2, 4), LIMESTONE_D), { y: 1.07, ry: Math.PI / 4 }), ball(0.05, LIMESTONE, { y: 1.2 }, 0)]);
}
function koiPond() {
  const rf = pondOutline(2.1, 0.16, 0.06, 0.4);
  const parts = [xform(blob(2.75, '#8FB25C', { seed: 21, sy: 0.02, detail: 2, amp: 0.1 }), { y: 0.0 }), waterSurface(rf, { y: 0.1, k: 0.98 }), ...stoneRim(rf, 30, { seed: 2 })];
  const fish = [['#F4F1EA', '#E8513C'], ['#F28C1E', '#FFF8EC'], ['#E9B13A', '#FFE58A'], ['#2E2A2A', '#F28C1E'], ['#E8513C', '#FFF8EC']];
  fish.forEach(([a, b2], i) => { const t = 0.6 + i * 1.25; const r = rf(t) * (0.35 + (i % 3) * 0.15); parts.push(xform(koiFish(a, b2), { x: Math.sin(t) * r, y: 0.115, z: Math.cos(t) * r, ry: t + 1.8 + i })); });
  [[0.9, -0.6, 0.32], [1.2, -0.1, 0.24], [-0.7, -0.9, 0.3], [-1.1, -0.5, 0.2], [0.2, -1.2, 0.26]].forEach(([x, z, r], i) => {
    parts.push(xform(lilyPad(r, i % 2 ? '#5E9E3A' : '#6BAA3F'), { x, y: 0.125, z, ry: i * 1.7 }));
    if (i % 2 === 0) parts.push(xform(lotus(), { x: x + r * 0.2, y: 0.12, z: z - r * 0.1 }));
  });
  // the red bridge over the narrow end (x < 0): an arched deck with two rails
  const bridge = [];
  const span = 2.2; const rise = 0.45;
  for (let i = 0; i < 9; i++) { const t = i / 8 - 0.5; const y = 0.25 + rise * (1 - (2 * t) ** 2); bridge.push(box(0.26, 0.06, 0.82, '#B5452E', { x: t * span, y, ry: 0 })); }
  for (const z of [-0.38, 0.38]) {
    bridge.push(tube(Array.from({ length: 9 }, (_, i) => { const t = i / 8 - 0.5; return [t * span, 0.88 + rise * (1 - (2 * t) ** 2) * 0.85, z]; }), 0.035, '#C9503A', { seg: 5, steps: 20 }));
    for (let i = 0; i < 5; i++) { const t = i / 4 - 0.5; bridge.push(cyl(0.03, 0.03, 0.62, 5, '#B5452E', { x: t * span * 0.9, y: 0.25 + rise * (1 - (2 * t) ** 2) * 0.95, z }, 0)); }
  }
  parts.push(xform(mergeAll(bridge), { x: -1.55, z: 0.15, ry: Math.PI / 2 + 0.25 }));
  parts.push(xform(stoneLantern(), { x: 1.95, z: -1.55, s: 1.15 }));
  // iris and reeds at the back, a few pebbles
  for (let i = 0; i < 6; i++) { const t = Math.PI + (i - 2.5) * 0.32; const r = rf(t) * 1.12; parts.push(xform(mergeAll([...Array.from({ length: 5 }, (_, k) => xform(leaf(0.55, 0.06, LEAF, { bend: 0.15, seg: 2 }), { ry: k * 1.25, rx: 0.1 })), ...(i % 2 ? [] : [xform(flatFlower('#7A6BD6', 0.08), { y: 0.56, rx: 0.5 })])]), { x: Math.sin(t) * r, z: Math.cos(t) * r })); }
  // the bench on the front edge, its back to the camera: the couple looks over the water
  parts.push(xform(mergeAll([box(1.5, 0.08, 0.42, '#8A5A35', { y: 0.44 }), box(1.5, 0.42, 0.06, '#8A5A35', { y: 0.52, z: -0.2 }), ...[-0.62, 0.62].map((x) => box(0.08, 0.44, 0.38, '#5E3A22', { x }))]), { z: 2.72, ry: Math.PI }));
  return mergeAll(parts);
}

// ---- The Carousel (L29, 4 x 4): a round deck with a painted skirt and two steps, a mirrored centre column, eight
//      galloping horses on twisted gold poles at two heights, a red-and-cream striped canopy with a scalloped valance
//      and a ring of bulbs, a cupola and a pennant on top. Glows at night (`glow`).
function carouselHorse(hex, saddle, mane = '#FFF8EC') {
  const parts = [];
  parts.push(xform(P(new THREE.CapsuleGeometry(0.16, 0.4, 2, 7), hex, { creaseDeg: 60 }), { rx: Math.PI / 2 }));      // body along z
  parts.push(xform(P(new THREE.CapsuleGeometry(0.085, 0.28, 2, 6), hex, { creaseDeg: 60 }), { rx: -0.55, y: 0.2, z: 0.3 }));  // neck
  parts.push(xform(P(new THREE.CapsuleGeometry(0.075, 0.2, 2, 6), hex, { creaseDeg: 60 }), { rx: 0.95, y: 0.38, z: 0.47 }));  // head
  parts.push(...[-1, 1].map((sx) => xform(P(new THREE.ConeGeometry(0.03, 0.09, 4), hex), { x: sx * 0.04, y: 0.5, z: 0.4 })));
  parts.push(tube([[0, 0.18, 0.18], [0, 0.34, 0.3], [0, 0.46, 0.38]], 0.045, mane, { seg: 4, steps: 6 }));
  for (const [x, z, a, b2] of [[-0.09, 0.22, -1.2, 0.9], [0.09, 0.2, -0.9, 1.3], [-0.09, -0.22, 0.6, -0.5], [0.09, -0.22, 0.9, -0.3]]) {
    const up = [x, -0.06, z]; const knee = [x, -0.06 - 0.2 * Math.cos(a), z + 0.2 * Math.sin(a)]; const hoof = [knee[0], knee[1] - 0.18 * Math.cos(b2), knee[2] + 0.18 * Math.sin(b2)];
    parts.push(tube([up, knee, hoof], 0.035, hex, { seg: 3, steps: 3 }), ball(0.04, GOLD, { x: hoof[0], y: hoof[1], z: hoof[2] }, 0));
  }
  parts.push(tube([[0, 0.05, -0.36], [0, -0.05, -0.5], [0, -0.25, -0.55]], 0.04, mane, { seg: 4, steps: 6 }));
  parts.push(xform(box(0.36, 0.06, 0.32, saddle), { y: 0.14, z: 0.02, sx: 1 }), box(0.37, 0.025, 0.33, GOLD, { y: 0.135, z: 0.02 }), xform(blob(0.05, '#FF7AA8', { seed: 2, sy: 1.8, detail: 0 }), { y: 0.56, z: 0.38 }));
  return mergeAll(parts);
}
function carousel() {
  const R = 3.45; const parts = [];
  parts.push(cyl(R + 0.25, R + 0.3, 0.16, 32, LIMESTONE_D, {}, 30), cyl(R, R, 0.42, 32, PAINT, { y: 0.16 }, 30));
  parts.push(stripes(cyl(R + 0.01, R + 0.01, 0.3, 32, '#E8513C', { y: 0.2 }, 30), 16, ['#E8513C', PAINT]));
  parts.push(torus(R + 0.02, 0.04, GOLD, { y: 0.58, rx: Math.PI / 2 }, 4, 48), torus(R + 0.02, 0.04, GOLD, { y: 0.2, rx: Math.PI / 2 }, 4, 48));
  parts.push(cyl(R - 0.05, R - 0.05, 0.04, 32, '#C9A06A', { y: 0.58 }, 0));
  parts.push(xform(box(1.4, 0.2, 0.5, LIMESTONE), { z: R + 0.38 }), xform(box(1.2, 0.2, 0.4, LIMESTONE), { y: 0.2, z: R + 0.22 }));
  // the centre column: mirror panels between gold bands
  parts.push(stripes(cyl(0.55, 0.6, 2.95, 12, '#7FC4E8', { y: 0.62 }, 40), 12, ['#7FC4E8', GOLD_L]), cyl(0.68, 0.68, 0.14, 12, GOLD, { y: 0.62 }), cyl(0.66, 0.66, 0.12, 12, GOLD, { y: 3.45 }));
  // horses on twisted gold poles
  const cols = [['#FFFFFF', '#E8513C'], ['#F2D7A8', '#2BB3A3'], ['#FFFFFF', '#9C7FD0'], ['#3A2A1A', '#FFC83D'], ['#FFFFFF', '#4AA8E8'], ['#D6A06A', '#E8513C'], ['#FFFFFF', '#FF7AA8'], ['#B8B2AC', '#2BB3A3']];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2; const r = 2.4; const hy = i % 2 ? 1.75 : 1.35;
    const pole = tube(Array.from({ length: 9 }, (_, k) => [Math.sin(k * 1.4) * 0.025, 0.62 + k * 0.37, Math.cos(k * 1.4) * 0.025]), 0.04, GOLD, { seg: 4, steps: 12 });
    const horse = xform(carouselHorse(cols[i][0], cols[i][1]), { y: hy, ry: Math.PI / 2, s: 1.3 });
    parts.push(xform(mergeAll([pole, horse]), { x: Math.sin(a) * r, z: Math.cos(a) * r, ry: a }));
  }
  // the canopy: a striped cone over a scalloped valance with a ring of bulbs, a cupola and a pennant
  const top = 3.6;
  parts.push(cyl(R + 0.1, R + 0.1, 0.12, 32, GOLD, { y: top }, 30));
  parts.push(stripes(cone(R + 0.3, 1.5, 32, '#E8513C', { y: top + 0.12 }), 16, ['#E8513C', PAINT]));
  for (let i = 0; i < 16; i++) {
    const a = ((i + 0.5) / 16) * Math.PI * 2;
    parts.push(xform(P(new THREE.CircleGeometry(0.62, 10, Math.PI, Math.PI), i % 2 ? '#E8513C' : PAINT), { x: Math.sin(a) * (R + 0.12), y: top + 0.1, z: Math.cos(a) * (R + 0.12), ry: a }));
  }
  parts.push(...around(24, R + 0.16, () => ball(0.06, '#FFF0B8', {}, 0), { y: top + 0.05, face: false }));
  parts.push(cyl(0.45, 0.5, 0.45, 12, PAINT, { y: top + 1.55 }), stripes(cone(0.62, 0.55, 12, '#E8513C', { y: top + 2.0 }), 6, ['#E8513C', PAINT]),
    ball(0.12, GOLD, { y: top + 2.62 }, 1), cyl(0.02, 0.02, 0.6, 4, GOLD, { y: top + 2.6 }, 0), xform(P(new THREE.ConeGeometry(0.16, 0.42, 3), '#2BB3A3'), { rz: -Math.PI / 2, x: 0.22, y: top + 3.05, sz: 0.15 }));
  return mergeAll(parts);
}

// ---- The Treehouse (L31, 3 x 3): a broad old oak with a cabin on a railed deck among its boughs, a rope ladder, a
//      rope swing and a pennant; the couple sits on the deck's front edge (a two-seat lookout, SEATS).
const TREEHOUSE = Object.freeze({ deck: 2.55, front: 1.25 });
function treehouse() {
  const parts = [];
  const D = TREEHOUSE.deck;
  parts.push(mergeAll([lathe([[0.62, 0], [0.5, 0.25], [0.4, 0.8], [0.36, 2.0], [0.38, 3.2], [0, 3.3]], 9, '#7A5236', 40), ...[0, 1, 2, 3].map((i) => xform(blob(0.22, '#6E4A2E', { seed: i, sx: 1.8, sy: 0.4, detail: 0 }), { x: Math.sin(i * 1.57 + 0.4) * 0.6, y: 0.06, z: Math.cos(i * 1.57 + 0.4) * 0.6, ry: i * 1.57 + 0.4 }))]));
  for (const [ax, az, len, up] of [[-1, -0.3, 1.9, 0.7], [1, -0.5, 1.8, 0.8], [0.2, -1, 1.5, 1.0]]) {
    const n = Math.hypot(ax, az);
    parts.push(tube([[0, 2.9, 0], [ax / n * len * 0.5, 2.9 + up * 0.6, az / n * len * 0.5], [ax / n * len, 2.9 + up, az / n * len]], 0.16, '#7A5236', { seg: 6, steps: 8 }));
  }
  // the crown: lobes round and above the cabin, open at the front so the house shows
  const crown = [[-1.7, 4.1, -0.6, 1.25], [1.6, 4.2, -0.7, 1.2], [0, 5.0, -1.0, 1.4], [-0.9, 5.5, 0.1, 1.05], [0.95, 5.4, 0.2, 1.05], [-1.9, 3.5, 0.9, 0.85], [1.9, 3.6, 0.8, 0.85], [0, 4.4, -1.9, 1.1]];
  crown.forEach(([x, y, z, r], i) => parts.push(xform(mottle(paintCrown(blob(r, '#4C9A3E', { seed: 40 + i, amp: 0.14, detail: 2 }), '#4C9A3E', i), { freq: 1.8, seed: i, lo: 0.88, hi: 1.12 }), { x, y, z })));
  // the deck, its railing and the cabin
  parts.push(box(2.8, 0.14, 2.5, WOOD, { y: D - 0.14 }), ...[[-1.3, -1.1], [1.3, -1.1], [1.3, 1.1], [-1.3, 1.1]].map(([x, z]) => box(0.12, D, 0.12, WOOD_D, { x, z })));
  for (let i = -6; i <= 6; i++) parts.push(box(0.2, 0.02, 2.5, i % 2 ? '#C9914F' : WOOD, { x: i * 0.21, y: D - 0.01 }));
  parts.push(railing([[-1.38, -1.2], [1.38, -1.2], [1.38, 1.2], [-1.38, 1.2]], { h: 0.62, post: WOOD_D, rail: WOOD, step: 0.45, gaps: [[0.75, 1.2, 0.4]] }).translate(0, D, 0));
  const cab = [box(1.9, 1.5, 1.6, '#C99A62', { y: D, z: -0.35 })];
  for (let i = 0; i < 6; i++) cab.push(box(1.92, 0.04, 1.62, '#A8713A', { y: D + 0.12 + i * 0.25, z: -0.35 }));
  cab.push(xform(pitchedRoof(1.9, 1.6, 0.85, '#B5543F', { oh: 0.25, gableHex: '#C99A62' }), { y: D + 1.5, z: -0.35 }));
  cab.push(xform(doorBox(0.55, 1.1, '#5E7F55'), { x: -0.45, y: D, z: 0.47 }), xform(mergeAll([torus(0.22, 0.05, K.timber, {}, 5, 14), xform(P(new THREE.CircleGeometry(0.2, 14), K.glass), { z: 0.01 })]), { x: 0.45, y: D + 0.95, z: 0.47 }));
  cab.push(xform(mergeAll([cyl(0.02, 0.02, 0.9, 4, IRON), xform(P(new THREE.ConeGeometry(0.16, 0.4, 3), '#FFC83D'), { rz: -Math.PI / 2, x: 0.2, y: 0.78, sz: 0.15 })]), { x: 0.7, y: D + 2.25, z: -0.35 }));
  parts.push(mergeAll(cab));
  // the rope ladder from the deck's gap down to the grass, and a plank swing from the right bough
  const lad = [];
  for (const x of [0.55, 0.95]) lad.push(tube([[x, D, 1.2], [x, D * 0.5, 1.45], [x, 0.05, 1.55]], 0.025, '#D9B97A', { seg: 4, steps: 8 }));
  for (let k = 1; k <= 7; k++) { const t = k / 8; lad.push(box(0.46, 0.05, 0.08, WOOD, { x: 0.75, y: D * (1 - t), z: 1.2 + 0.35 * t })); }
  parts.push(...lad);
  parts.push(tube([[1.25, 3.6, -0.55], [1.25, 2.0, -0.55], [1.25, 0.55, -0.55]], 0.02, '#D9B97A', { seg: 3, steps: 4 }), tube([[1.75, 3.7, -0.55], [1.75, 2.0, -0.55], [1.75, 0.55, -0.55]], 0.02, '#D9B97A', { seg: 3, steps: 4 }),
    box(0.65, 0.06, 0.26, WOOD, { x: 1.5, y: 0.52, z: -0.55 }));
  return mergeAll(parts);
}

// ---- The Clock Tower (L33, 2 x 2): a brick tower with limestone quoins on a stepped base, a clock face on each side
//      (cream dials, gold rims, hands at ten past ten), an open belfry with a bell, a verdigris spire and a gold
//      weathervane; flower boxes round the foot.
function clockFace(r = 0.7) {
  const parts = [cyl(r + 0.08, r + 0.08, 0.06, 24, GOLD, {}, 30), cyl(r, r, 0.08, 24, '#FFF6E2', {}, 30)];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; parts.push(box(i % 3 ? 0.04 : 0.07, 0.03, i % 3 ? 0.12 : 0.18, '#3A2A1A', { x: Math.sin(a) * (r - 0.12), y: 0.08, z: Math.cos(a) * (r - 0.12), ry: a })); }
  parts.push(xform(box(0.05, 0.03, r * 0.55, '#2A1A10'), { y: 0.1, ry: -Math.PI / 3, z: 0 }).translate(Math.sin(-Math.PI / 3) * r * 0.27, 0, Math.cos(-Math.PI / 3) * r * 0.27));
  parts.push(xform(box(0.04, 0.03, r * 0.8, '#2A1A10'), { y: 0.11, ry: Math.PI / 3 }).translate(Math.sin(Math.PI / 3) * r * 0.38, 0, Math.cos(Math.PI / 3) * r * 0.38));
  parts.push(cyl(0.06, 0.06, 0.06, 8, GOLD, { y: 0.1 }));
  return xform(mergeAll(parts), { rx: Math.PI / 2 });                 // stands up facing +z
}
function clockTower() {
  const W = 2.5; const parts = [];
  parts.push(box(3.7, 0.25, 3.7, LIMESTONE_D), box(3.3, 0.25, 3.3, LIMESTONE, { y: 0.25 }));
  parts.push(courses(box(W, 5.6, W, K.brick, { y: 0.5 }), 22, [0.9, 1.06]));
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) for (let k = 0; k < 11; k++) parts.push(box(k % 2 ? 0.34 : 0.24, 0.28, k % 2 ? 0.24 : 0.34, LIMESTONE, { x: x * (W / 2 - 0.08), y: 0.5 + k * 0.5, z: z * (W / 2 - 0.08) }));
  parts.push(box(W + 0.3, 0.2, W + 0.3, LIMESTONE, { y: 6.1 }));
  // the clock stage
  parts.push(box(W + 0.1, 1.9, W + 0.1, LIMESTONE, { y: 6.3 }), box(W + 0.35, 0.18, W + 0.35, LIMESTONE_D, { y: 8.2 }));
  for (let s = 0; s < 4; s++) parts.push(xform(clockFace(0.78), { y: 7.25, z: W / 2 + 0.06 }).rotateY((s * Math.PI) / 2));
  // the belfry: corner piers, arched openings, the bell
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(box(0.5, 1.6, 0.5, LIMESTONE, { x: x * 1.05, y: 8.38, z: z * 1.05 }));
  for (let s = 0; s < 4; s++) parts.push(xform(clipBelow(xform(torus(0.62, 0.16, LIMESTONE, {}, 4, 12), { y: 9.35, z: 1.08 }), 9.35), {}).rotateY((s * Math.PI) / 2));
  parts.push(box(W + 0.3, 0.2, W + 0.3, LIMESTONE_D, { y: 9.95 }));
  parts.push(xform(lathe([[0, 0], [0.42, 0], [0.4, 0.08], [0.3, 0.3], [0.24, 0.55], [0.12, 0.62], [0, 0.62]], 12, '#C9952E', 40), { y: 8.75 }), cyl(0.03, 0.03, 0.5, 4, IRON, { y: 9.35 }, 0));
  // the spire, its gold ball and the weathervane (an arrow and a cockerel's tail)
  parts.push(courses(xform(cone(2.05, 3.0, 4, '#5E9E8E', { y: 10.15 }), { ry: Math.PI / 4 }), 9, [0.9, 1.05]));
  parts.push(ball(0.16, GOLD, { y: 13.2 }, 1), cyl(0.025, 0.025, 1.0, 4, GOLD, { y: 13.2 }, 0), box(0.9, 0.04, 0.04, GOLD, { y: 13.85 }),
    xform(P(new THREE.ConeGeometry(0.1, 0.22, 3), GOLD), { rz: -Math.PI / 2, x: 0.5, y: 13.87, sz: 0.3 }), xform(box(0.22, 0.2, 0.03, GOLD), { x: -0.42, y: 13.82 }));
  // the door (an arched one with stone steps), two slit windows, flower boxes
  parts.push(xform(doorBox(0.9, 1.7, '#5A3A26'), { y: 0.5, z: W / 2 + 0.02 }), xform(clipBelow(xform(torus(0.5, 0.1, LIMESTONE, {}, 4, 12), { y: 2.2 }), 2.2), { z: W / 2 + 0.04 }));
  parts.push(xform(windowBox(0.32, 0.8), { y: 3.6, z: W / 2 + 0.02 }), xform(windowBox(0.32, 0.8), { y: 3.6, x: W / 2 + 0.02, ry: Math.PI / 2 }));
  for (const x of [-0.95, 0.95]) parts.push(xform(flowerBox(0.7, ['#E8443A', '#FFFFFF', '#FFD21F']), { x, y: 0.5, z: W / 2 + 0.25 }));
  return mergeAll(parts);
}

// ---- The Glass Orangery (L35, 4 x 3): a white-framed Victorian glasshouse on a brick plinth, a hipped glass roof with
//      a raised lantern and cresting, glass double doors under a pediment, orange trees in Versailles boxes along the
//      front. Its panes are its window anchors: lit from inside at night.
function glassWall(w, h, { cols = 6, frame = PAINT, glass = '#CDEDF0', glass2 = '#B8E2EA', arched = true } = {}) {
  const parts = [];
  const pw = w / cols;
  for (let i = 0; i < cols; i++) {
    const x = -w / 2 + pw * (i + 0.5);
    parts.push(box(pw - 0.06, h - 0.1, 0.04, i % 2 ? glass : glass2, { x, y: 0.05 }));
    parts.push(box(0.07, h, 0.1, frame, { x: -w / 2 + pw * i }), box(0.04, h - 0.1, 0.08, frame, { x, y: 0.05 }), box(pw, 0.04, 0.08, frame, { x, y: h * 0.62 }));
    if (arched) parts.push(xform(clipBelow(xform(torus(pw / 2 - 0.05, 0.03, frame, {}, 3, 10), { y: h - pw / 2 }), h - pw / 2), { x }));
  }
  parts.push(box(0.07, h, 0.1, frame, { x: w / 2 }), box(w + 0.07, 0.09, 0.12, frame, { y: h - 0.05 }), box(w + 0.07, 0.07, 0.12, frame));
  return mergeAll(parts);
}
function orangery() {
  const W = 6.8; const D = 4.6; const P0 = 0.55; const H = 2.5;
  const parts = [courses(box(W + 0.2, P0, D + 0.2, K.brick), 4, [0.92, 1.05]), box(W + 0.36, 0.08, D + 0.36, LIMESTONE, { y: P0 })];
  for (const s of [-1, 1]) {
    parts.push(xform(glassWall(W, H, { cols: 8 }), { y: P0 + 0.08, z: s * D / 2, ry: s > 0 ? 0 : Math.PI }));
    parts.push(xform(glassWall(D, H, { cols: 5 }), { y: P0 + 0.08, x: s * W / 2, ry: s * Math.PI / 2 }));
  }
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(box(0.26, H + 0.15, 0.26, PAINT, { x: x * W / 2, y: P0, z: z * D / 2 }), ball(0.13, GOLD, { x: x * W / 2, y: P0 + H + 0.35, z: z * D / 2 }, 1));
  parts.push(box(W + 0.3, 0.18, D + 0.3, PAINT, { y: P0 + H + 0.05 }));
  // the hipped glass roof (four slopes of panes on white glazing bars) and the raised lantern with its own little roof
  const top = P0 + H + 0.23; const RH = 1.15;
  const hip = (w, d, h, inset) => {
    const g = new THREE.BufferGeometry();
    const a = [-w / 2, 0, -d / 2]; const b = [w / 2, 0, -d / 2]; const c = [w / 2, 0, d / 2]; const e = [-w / 2, 0, d / 2];
    const r0 = [-w / 2 + inset, h, 0]; const r1 = [w / 2 - inset, h, 0];
    const pos = [...e, ...c, ...r1, ...e, ...r1, ...r0, ...b, ...a, ...r0, ...b, ...r0, ...r1, ...c, ...b, ...r1, ...a, ...e, ...r0];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return paint(g, '#C4E7EE');
  };
  parts.push(xform(hip(W + 0.2, D + 0.2, RH, D / 2), { y: top }));
  const Dh = D / 2 + 0.1; const rh = (W + 0.2) / 2 - D / 2;
  for (let i = -5; i <= 5; i++) {
    const x = i * (W / 11); const over = Math.max(0, Math.abs(x) - rh);
    const end = [x, top + RH * (1 - over / Dh) + 0.02, 0];
    for (const sz of [-1, 1]) parts.push(tube([[x, top + 0.03, sz * Dh], [x, end[1], sz * over]], 0.03, PAINT, { seg: 3, steps: 1 }));
  }
  parts.push(box(W - D + 1.4, 0.75, 1.3, '#CDEDF0', { y: top + RH - 0.1 }), box(W - D + 1.5, 0.08, 1.4, PAINT, { y: top + RH - 0.12 }), box(W - D + 1.5, 0.08, 1.4, PAINT, { y: top + RH + 0.62 }),
    xform(hip(W - D + 1.6, 1.5, 0.55, 0.75), { y: top + RH + 0.68 }));
  for (let i = -6; i <= 6; i++) parts.push(xform(mergeAll([cyl(0.015, 0.015, 0.22, 3, PAINT, {}, 0), ball(0.035, GOLD, { y: 0.24 }, 0)]), { x: i * 0.22, y: top + RH + 1.22 }));
  parts.push(ball(0.12, GOLD, { y: top + RH + 1.3, x: (W - D + 1.6) / 2 - 0.75 }, 1), ball(0.12, GOLD, { y: top + RH + 1.3, x: -((W - D + 1.6) / 2 - 0.75) }, 1));
  // the doors under a pediment, steps, orange trees in boxes
  parts.push(box(1.5, H + 0.25, 0.14, PAINT, { y: P0, z: D / 2 + 0.06 }), box(1.25, H - 0.15, 0.06, '#B8E2EA', { y: P0 + 0.06, z: D / 2 + 0.12 }), box(0.05, H - 0.15, 0.08, PAINT, { y: P0 + 0.06, z: D / 2 + 0.14 }),
    ball(0.04, GOLD, { x: -0.1, y: P0 + 1.1, z: D / 2 + 0.18 }, 0), ball(0.04, GOLD, { x: 0.1, y: P0 + 1.1, z: D / 2 + 0.18 }, 0));
  const ped = new THREE.Shape(); ped.moveTo(-1.0, 0); ped.lineTo(1.0, 0); ped.lineTo(0, 0.55); ped.closePath();
  parts.push(xform(P(new THREE.ExtrudeGeometry(ped, { depth: 0.2, bevelEnabled: false }), PAINT), { y: P0 + H + 0.25, z: D / 2 - 0.02 }));
  for (let k = 0; k < 3; k++) parts.push(box(2.0 - k * 0.3, 0.18, 0.4, LIMESTONE, { y: k * 0.18, z: D / 2 + 0.7 - k * 0.3 }));
  for (const x of [-2.6, -1.55, 1.55, 2.6]) parts.push(xform(orangeTub(1.0), { x, z: D / 2 + 0.75 }));
  const out = mergeAll(parts);
  out.anchors = { windows: [[-2.2, 1.9, r3(D / 2 + 0.1)], [0, 1.9, r3(D / 2 + 0.2)], [2.2, 1.9, r3(D / 2 + 0.1)], [r3(W / 2 + 0.1), 1.9, 0], [r3(-W / 2 - 0.1), 1.9, 0]] };
  return out;
}

// ---- The Great Arbor of Lights (L37, 3 x 2): a white pergola walk of four arches under climbing roses and wisteria,
//      strings of warm bulbs along it, a swing bench in the middle (two seats). Glows at night.
function arborOfLights() {
  const L = 5.6; const Wd = 2.6; const H = 2.5; const parts = [];
  parts.push(xform(mottle(box(L + 0.3, 0.04, Wd + 0.3, '#DCCBA6'), { freq: 3, seed: 5, lo: 0.9, hi: 1.08 }), {}));
  const xs = [-2.6, -0.87, 0.87, 2.6];
  for (const x of xs) {
    for (const z of [-Wd / 2, Wd / 2]) parts.push(box(0.16, H, 0.16, PAINT, { x, z }), box(0.26, 0.12, 0.26, PAINT, { x, z }));
    parts.push(clipBelow(xform(torus(Wd / 2, 0.07, PAINT, {}, 5, 20), { x, y: H, ry: Math.PI / 2 }), H - 0.01));
  }
  for (const z of [-Wd / 2, Wd / 2]) parts.push(box(L + 0.4, 0.12, 0.12, PAINT, { y: H + 0.02, z }));
  for (let i = -6; i <= 6; i++) parts.push(box(0.08, 0.1, Wd + 0.5, PAINT, { x: i * 0.45, y: H + 0.12 }));
  // roses and wisteria: leafy clumps over the beams and up the posts, pink and white roses, hanging lilac racemes
  const rr = rng('arbor');
  for (let i = 0; i < 34; i++) {
    const onTop = i < 20;
    const x = onTop ? (rr() - 0.5) * L : xs[i % 4] + (rr() - 0.5) * 0.2; const z = onTop ? (rr() - 0.5) * Wd * 1.1 : (i % 2 ? 1 : -1) * Wd / 2 + (rr() - 0.5) * 0.15;
    const y = onTop ? H + 0.2 + rr() * 0.25 : 0.3 + rr() * (H - 0.3);
    parts.push(xform(blob(onTop ? 0.3 : 0.2, i % 3 ? LEAF : LEAF_L, { seed: 60 + i, detail: 1, amp: 0.2 }), { x, y, z }));
    if (i % 2 === 0) parts.push(ball(0.085, i % 4 ? '#FF7A9C' : '#FFFFFF', { x: x + 0.1, y: y + 0.12, z: z + 0.08 }, 0));
  }
  for (let i = 0; i < 14; i++) { const x = -2.4 + (i / 13) * 4.8; const z = (i % 2 ? 1 : -1) * (0.45 + rr() * 0.6); parts.push(xform(cone(0.09, 0.5, 6, i % 3 ? '#B9A3E8' : '#D8C8F5', { rx: Math.PI }), { x, y: H + 0.1, z })); }
  // strings of bulbs along both sides and across the arches
  for (const z of [-Wd / 2 + 0.1, Wd / 2 - 0.1]) for (let k = 0; k < 3; k++) parts.push(lightString([xs[k], H - 0.05, z], [xs[k + 1], H - 0.05, z], 6, { sag: 0.3 }));
  for (const x of xs) parts.push(lightString([x, H - 0.05, -Wd / 2 + 0.1], [x, H - 0.05, Wd / 2 - 0.1], 5, { sag: 0.25 }));
  // the swing bench, hung from the middle beams
  parts.push(...[-0.62, 0.62].map((x) => cyl(0.015, 0.015, H - 0.65, 3, '#D9B97A', { x, y: 0.65, z: -0.1 }, 0)));
  parts.push(box(1.5, 0.08, 0.5, '#FFF8EC', { y: 0.58, z: -0.1 }), box(1.5, 0.5, 0.07, '#FFF8EC', { y: 0.66, z: -0.38 }), xform(blob(0.16, '#FF9FB0', { seed: 3, sx: 1.4, sy: 0.6 }), { x: -0.4, y: 0.7, z: -0.15 }),
    xform(blob(0.16, '#B9A3E8', { seed: 4, sx: 1.4, sy: 0.6 }), { x: 0.4, y: 0.7, z: -0.15 }));
  return mergeAll(parts);
}

// ---- The Hot-Spring Bath House (L39, 4 x 4): a timber bath house with a sweeping dark roof and a noren curtain on a
//      deck, a stone-rimmed hot pool beside it (steam: the `steam` anchor), red paper lanterns, a bamboo screen, two
//      wooden stools at the water (two seats).
function sweepRoof(w, d, h, hex, { oh = 0.45, lift = 0.28 } = {}) {
  // a hipped roof whose eaves turn up at the corners (the soft East Asian sweep)
  const seg = 8; const pos = [];
  const pt = (u, v) => {                                           // u, v in [-1, 1]: the roof surface over the footprint
    const x = u * (w / 2 + oh); const z = v * (d / 2 + oh);
    const m = Math.max(Math.abs(u), Math.abs(v) * 0.92);
    const corner = Math.abs(u) * Math.abs(v);
    return [x, h * (1 - m) + lift * corner * corner * 1.4 + lift * 0.25 * Math.max(0, m - 0.8) * 5, z];
  };
  for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
    const u0 = -1 + (2 * i) / seg; const u1 = -1 + (2 * (i + 1)) / seg; const v0 = -1 + (2 * j) / seg; const v1 = -1 + (2 * (j + 1)) / seg;
    pos.push(...pt(u0, v0), ...pt(u0, v1), ...pt(u1, v1), ...pt(u0, v0), ...pt(u1, v1), ...pt(u1, v0));
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  const top = paint(g, hex);
  const under = paint(new THREE.BufferGeometry().copy(g), '#4A3A30');
  under.translate(0, -0.08, 0);
  const ridge = box(w * 0.25, 0.14, 0.16, '#3A2E28', { y: h - 0.05 });
  return mergeAll([courses(top, 9, [0.86, 1.0, 1.1]), under, ridge]);
}
function bathHouse() {
  const parts = [];
  parts.push(xform(mottle(blob(3.7, '#9FBF6A', { seed: 77, sy: 0.02, detail: 2, amp: 0.1 }), { seed: 3, lo: 0.92, hi: 1.06 }), {}));
  // the house at the back-left on a deck
  const hx = -1.2; const hz = -1.4; const hw = 4.2; const hd = 3.2; const hh = 2.2; const dy = 0.35;
  parts.push(box(hw + 1.2, dy, hd + 1.0, '#A8713A', { x: hx, z: hz + 0.2 }));
  for (let i = 0; i < 13; i++) parts.push(box(0.4, 0.02, hd + 1.0, i % 2 ? '#B9824A' : '#A8713A', { x: hx - (hw + 1.2) / 2 + 0.2 + i * 0.42, y: dy, z: hz + 0.2 }));
  parts.push(box(hw, hh, hd, '#F2E6CC', { x: hx, y: dy, z: hz }));
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(box(0.2, hh + 0.1, 0.2, '#5A3A26', { x: hx + x * hw / 2, y: dy, z: hz + z * hd / 2 }));
  for (let i = -3; i <= 3; i++) parts.push(box(0.06, hh - 0.2, 0.06, '#7A5236', { x: hx + i * (hw / 7), y: dy + 0.1, z: hz + hd / 2 + 0.02 }));
  parts.push(box(hw + 0.1, 0.16, 0.12, '#5A3A26', { x: hx, y: dy + hh * 0.66, z: hz + hd / 2 + 0.04 }));
  // the noren curtain at the door: two blue cloths with a white wave line
  for (const s of [-1, 1]) parts.push(box(0.5, 0.75, 0.03, '#2E5E8E', { x: hx + s * 0.27, y: dy + hh - 0.95, z: hz + hd / 2 + 0.08 }), box(0.5, 0.06, 0.035, '#FFFFFF', { x: hx + s * 0.27, y: dy + hh - 0.62, z: hz + hd / 2 + 0.08 }));
  parts.push(xform(sweepRoof(hw, hd, 1.5, '#4E5A66', { oh: 0.55, lift: 0.3 }), { x: hx, y: dy + hh, z: hz }));
  // the hot pool: a stone-rimmed oval at the front right, steaming water, a few rocks in it
  const px = 1.55; const pz = 1.35;
  const rf = pondOutline(1.7, 0.1, 0.06, 1.3);
  parts.push(xform(mergeAll([waterSurface(rf, { y: 0.12, deep: '#4FA6B8', shallow: '#A6DCE0' }), ...stoneRim(rf, 24, { seed: 9, size: 0.3, cols: ['#8E8A84', '#A7A39A', '#7F7A72', '#B5AEA2'] })]), { x: px, z: pz }));
  parts.push(xform(blob(0.32, '#8E8A84', { seed: 2, sy: 0.6 }), { x: px + 0.4, y: 0.1, z: pz - 0.3 }));
  // the bamboo screen on the right and back of the pool
  for (let i = 0; i < 18; i++) { const t = i / 17; const x = px - 1.2 + t * 3.0; const z = pz - 2.05 + Math.sin(t * 1.4) * 0.2; parts.push(cyl(0.05, 0.055, 1.7 + (i % 3) * 0.08, 6, i % 2 ? '#B5B96A' : '#A6AD5A', { x, z }, 40)); }
  parts.push(box(3.1, 0.06, 0.06, '#7A6A3A', { x: px + 0.3, y: 1.2, z: pz - 1.95 }), box(3.1, 0.06, 0.06, '#7A6A3A', { x: px + 0.3, y: 0.5, z: pz - 1.95 }));
  // lanterns: two hanging from the eaves, two on posts by the pool
  for (const s of [-1, 1]) parts.push(xform(paperLantern('#E8513C'), { x: hx + s * 1.5, y: dy + hh + 0.15, z: hz + hd / 2 + 0.45 }));
  for (const [x, z] of [[px - 1.9, pz + 0.6], [px + 1.9, pz + 0.4]]) parts.push(cyl(0.05, 0.06, 1.75, 6, '#5A3A26', { x, z }), box(0.5, 0.05, 0.05, '#5A3A26', { x: x + 0.2, y: 1.72, z }), xform(paperLantern('#F28C1E', 0.36), { x: x + 0.38, y: 1.7, z }));
  // stepping stones from the deck to the pool, two stools at the water
  for (let k = 0; k < 4; k++) parts.push(xform(blob(0.24, '#B5AEA2', { seed: 70 + k, sy: 0.25, detail: 1 }), { x: hx + 1.6 + k * 0.45, y: 0.06, z: hz + 2.2 + k * 0.3 }));
  for (const s of [-1, 1]) parts.push(xform(mergeAll([cyl(0.2, 0.18, 0.04, 10, '#C99A62', { y: 0.36 }), ...[0, 1, 2].map((i) => cyl(0.025, 0.025, 0.36, 4, '#8A5A35', { x: Math.sin(i * 2.1) * 0.13, z: Math.cos(i * 2.1) * 0.13 }, 0))]), { x: px + s * 0.55, z: pz + 1.95 }));
  const out = mergeAll(parts);
  out.anchors = { steam: [r3(px), 0.3, r3(pz)], windows: [[r3(hx), r3(dy + 1.2), r3(hz + hd / 2 + 0.1)]] };
  return out;
}

// ---- The Golden Farm Gate (L40, 3 x 1): two limestone pillars with gilded ball finials and lamps, wrought gates with
//      spear tips and scrolls, a gilded arch with a name plaque (`plaque` anchor: the farm's name goes there in gold
//      leaf), urns of flowers and low hedge wings.
function scroll(r, hex = GOLD, turns = 1.3) {
  const pts = [];
  for (let i = 0; i <= 16; i++) { const t = (i / 16) * turns * Math.PI * 2; const rr = r * (1 - i / 22); pts.push([Math.cos(t) * rr, Math.sin(t) * rr, 0]); }
  return tube(pts, 0.022, hex, { seg: 3, steps: 16 });
}
function goldenGate() {
  const parts = [];
  for (const s of [-1, 1]) {
    const x = s * 2.55;
    parts.push(box(0.75, 0.25, 0.75, LIMESTONE_D, { x }), box(0.6, 2.5, 0.6, LIMESTONE, { x, y: 0.25 }), box(0.72, 0.16, 0.72, LIMESTONE_D, { x, y: 2.75 }));
    for (let k = 0; k < 5; k++) parts.push(box(0.62, 0.04, 0.62, LIMESTONE_D, { x, y: 0.55 + k * 0.45 }));
    parts.push(cyl(0.16, 0.2, 0.18, 10, GOLD, { x, y: 2.91 }), ball(0.27, GOLD_L, { x, y: 3.36 }, 2));
    parts.push(xform(mergeAll([box(0.05, 0.05, 0.35, IRON, { y: 0.0, z: 0.15 }), box(0.26, 0.34, 0.26, '#FFE08A', { y: -0.36, z: 0.38 }), xform(P(new THREE.ConeGeometry(0.22, 0.18, 4), IRON), { y: -0.02, z: 0.38, ry: Math.PI / 4 })]), { x, y: 2.2, z: 0.3 }));
    parts.push(xform(flowerUrn(['#FFD21F', '#FFFFFF', '#E8443A']), { x: x + s * 0.85, z: 0.35 }));
    // a low clipped hedge wing
    parts.push(xform(hedgeBlock(1.4, 0.7, 0.5, { seed: 5 + s }), { x: x + s * 1.75, z: -0.05 }));
  }
  // the two gate leaves, slightly open toward the farm
  for (const s of [-1, 1]) {
    const leafP = [];
    const lw = 2.05;
    leafP.push(box(lw, 0.07, 0.07, IRON, { x: -s * lw / 2, y: 0.25 }), box(lw, 0.07, 0.07, IRON, { x: -s * lw / 2, y: 1.95 }), box(lw, 0.06, 0.06, GOLD, { x: -s * lw / 2, y: 1.25 }));
    for (let i = 0; i <= 9; i++) {
      const x = -s * (0.08 + i * (lw - 0.16) / 9); const h = 2.2 + Math.sin((i / 9) * Math.PI) * 0.35 * (s > 0 ? 1 : 1);
      leafP.push(cyl(0.022, 0.022, h - 0.25, 4, IRON, { x, y: 0.25 }, 0), xform(P(new THREE.ConeGeometry(0.05, 0.14, 4), GOLD), { x, y: h }));
    }
    for (let i = 0; i < 3; i++) leafP.push(xform(scroll(0.17), { x: -s * (0.4 + i * 0.6), y: 1.6, ry: 0 }), xform(scroll(0.13), { x: -s * (0.4 + i * 0.6), y: 0.6, rz: Math.PI }));
    parts.push(xform(mergeAll(leafP), { x: s * 2.2, ry: s * -0.35 }));
  }
  // the gilded arch and the name plaque between the pillars
  parts.push(clipBelow(xform(torus(2.2, 0.06, GOLD, {}, 5, 28), { y: 2.75, sy: 0.35 }), 2.74), clipBelow(xform(torus(2.0, 0.04, GOLD_D, {}, 4, 28), { y: 2.75, sy: 0.3 }), 2.74));
  for (let i = 0; i < 6; i++) parts.push(xform(scroll(0.16, GOLD, 1.1), { x: -1.6 + i * 0.64, y: 3.05, rz: i % 2 ? 0 : Math.PI }));
  parts.push(box(1.9, 0.5, 0.1, '#2E3A2E', { y: 3.2, z: 0.08 }), box(2.0, 0.07, 0.12, GOLD, { y: 3.2, z: 0.08 }), box(2.0, 0.07, 0.12, GOLD, { y: 3.66, z: 0.08 }), ball(0.13, GOLD_L, { y: 3.95 }, 1));
  const out = mergeAll(parts);
  out.anchors = { plaque: [0, 3.45, 0.14, 1.8, 0.4] };
  return out;
}

// ---- The Garden Gazebo (L26, 3 x 3): a white octagonal gazebo on a stone step, lattice railings, a teal shingled roof
//      with a gold finial, hanging flower baskets and a bench inside (two seats, also a Sunset Bench).
function gazebo() {
  const R = 2.3; const F = 0.35; const H = 2.35; const parts = [];
  parts.push(xform(cyl(R + 0.25, R + 0.35, F, 8, LIMESTONE, {}, 20), { ry: Math.PI / 8 }), xform(cyl(R + 0.05, R + 0.05, 0.04, 8, '#C9A06A', { y: F }, 0), { ry: Math.PI / 8 }));
  parts.push(box(1.2, 0.17, 0.45, LIMESTONE, { z: R + 0.4 }));
  const corners = polygon(8, R, Math.PI / 8);
  for (const [x, z] of corners) parts.push(cyl(0.07, 0.08, H, 6, PAINT, { x, y: F, z }), box(0.2, 0.12, 0.2, PAINT, { x, y: F, z }));
  // lattice railings between the posts (open at the front)
  for (let i = 0; i < 8; i++) {
    const [x0, z0] = corners[i]; const [x1, z1] = corners[(i + 1) % 8];
    const mx = (x0 + x1) / 2; const mz = (z0 + z1) / 2;
    if (mz > R * 0.85) continue;
    const len = Math.hypot(x1 - x0, z1 - z0); const ang = -Math.atan2(z1 - z0, x1 - x0);
    const panel = [box(len, 0.06, 0.07, PAINT, { y: 0.78 }), box(len, 0.05, 0.06, PAINT, { y: 0.12 })];
    for (let k = -3; k <= 3; k++) { panel.push(xform(box(0.03, 0.85, 0.03, PAINT), { x: k * 0.2, y: 0.1, rz: 0.6 }), xform(box(0.03, 0.85, 0.03, PAINT), { x: k * 0.2, y: 0.1, rz: -0.6 })); }
    parts.push(xform(clipBelow(mergeAll(panel), 0.1), { x: mx, y: F, z: mz, ry: ang }));
    // a fretwork bracket under the eave
    parts.push(xform(clipBelow(xform(torus(len / 2 - 0.05, 0.035, PAINT, {}, 3, 12), { y: H - 0.12, rx: 0 }), H - 0.13).rotateX(Math.PI).translate(0, 2 * H - 0.25, 0), { x: mx, y: F, z: mz, ry: ang }));
  }
  // the roof: an octagonal cone of teal shingles with a deep eave, a cupola and a gold finial
  parts.push(xform(cyl(R + 0.25, R + 0.25, 0.16, 8, PAINT, { y: F + H }, 0), { ry: Math.PI / 8 }));
  parts.push(courses(xform(lathe([[R + 0.62, 0], [R + 0.3, 0.22], [R * 0.78, 0.62], [R * 0.5, 1.15], [R * 0.3, 1.6], [0.32, 1.95], [0, 2.0]], 8, '#3F8E86', 30), { y: F + H + 0.14, ry: Math.PI / 8 }), 8, [0.86, 1.0, 1.1]));
  parts.push(xform(cyl(0.3, 0.34, 0.4, 8, PAINT, { y: F + H + 1.95 }), { ry: Math.PI / 8 }), xform(cone(0.46, 0.42, 8, '#3F8E86', { y: F + H + 2.35 }), { ry: Math.PI / 8 }),
    ball(0.1, GOLD, { y: F + H + 2.82 }, 1), cone(0.05, 0.3, 6, GOLD, { y: F + H + 2.9 }));
  // the bench (two seats) at the back, cushions, hanging baskets between the front posts
  parts.push(box(1.7, 0.08, 0.5, '#8A5A35', { y: F + 0.42, z: -0.85 }), box(1.7, 0.5, 0.07, '#8A5A35', { y: F + 0.5, z: -1.1 }), box(0.07, 0.42, 0.45, '#5E3A22', { x: -0.78, y: F, z: -0.85 }), box(0.07, 0.42, 0.45, '#5E3A22', { x: 0.78, y: F, z: -0.85 }),
    xform(blob(0.18, '#9C7FD0', { seed: 6, sx: 1.6, sy: 0.45 }), { x: -0.4, y: F + 0.55, z: -0.82 }), xform(blob(0.18, '#FF9FB0', { seed: 7, sx: 1.6, sy: 0.45 }), { x: 0.4, y: F + 0.55, z: -0.82 }));
  for (const [x, z] of corners) {
    if (z < 0) continue;
    parts.push(cyl(0.008, 0.008, 0.35, 3, IRON, { x: x * 0.92, y: F + H - 0.45, z: z * 0.92 }, 0), xform(mergeAll([lathe([[0, 0], [0.16, 0.02], [0.2, 0.16], [0, 0.16]], 8, '#C99A5A'), xform(blob(0.18, LEAF, { seed: 9, sy: 0.6, detail: 1 }), { y: 0.18 }), ...flowersOver(4, [-0.12, 0.12], [0.24, 0.28], [-0.12, 0.12], ['#FF7A9C', '#FFFFFF', '#A98BE0'], { seed: x * 10 | 0 })]), { x: x * 0.92, y: F + H - 0.65, z: z * 0.92 }));
  }
  return mergeAll(parts);
}

// ---- The Hot-air Balloon Mooring (L38, 3 x 3): a striped balloon tethered over its wicker basket on a little landing
//      green with sandbags, stakes and ropes (photo-mode backdrop).
/** The balloon alone (envelope, burner, basket, sandbags), its basket's floor at y = 0: ambient-life's sky balloon. */
function flyingBalloon() {
  const parts = [courses(cyl(0.62, 0.55, 0.9, 12, '#C99A5A', { y: 0.0 }, 30), 6, [0.88, 1.06]), torus(0.63, 0.07, '#8A5A35', { y: 0.9, rx: Math.PI / 2 }, 5, 16),
    ...around(4, 0.66, () => xform(sack('#D8C49A'), { s: 0.5, rx: 0.2 }), { y: 0.25, a0: Math.PI / 4 })];
  const bY = 2.1;
  parts.push(...around(4, 0.5, () => cyl(0.02, 0.02, bY - 0.9, 4, '#5A4A3A', {}, 0), { y: 0.9, a0: Math.PI / 4, face: false }), cyl(0.18, 0.22, 0.25, 8, '#8E9AA4', { y: bY - 0.05 }));
  const env = lathe([[0.45, 0], [0.9, 0.35], [1.7, 1.15], [2.15, 2.1], [2.25, 2.85], [2.05, 3.65], [1.5, 4.3], [0.7, 4.65], [0, 4.72]], 24, '#E8513C', 30);
  parts.push(xform(stripes(env, 12, ['#E8513C', '#FFD45A', '#2BB3A3', '#FFF8EC']), { y: bY }), xform(torus(2.2, 0.06, '#FFF8EC', {}, 4, 32), { y: bY + 2.5, rx: Math.PI / 2 }));
  return mergeAll(parts);
}
function hotAirBalloon() {
  const parts = [xform(blob(2.6, '#8FB25C', { seed: 41, sy: 0.03, detail: 2, amp: 0.08 }), {})];
  // the basket: woven wicker in bands, a padded rim, sandbags hanging round it
  parts.push(courses(cyl(0.62, 0.55, 0.9, 12, '#C99A5A', { y: 0.05 }, 30), 6, [0.88, 1.06]), torus(0.63, 0.07, '#8A5A35', { y: 0.95, rx: Math.PI / 2 }, 5, 16));
  parts.push(...around(4, 0.66, () => xform(sack('#D8C49A'), { s: 0.5, rx: 0.2 }), { y: 0.3, a0: Math.PI / 4 }));
  // burner frame and ropes up to the envelope
  const bY = 2.15;
  parts.push(...around(4, 0.5, () => cyl(0.02, 0.02, bY - 0.95, 4, '#5A4A3A', {}, 0), { y: 0.95, a0: Math.PI / 4, face: false }), cyl(0.18, 0.22, 0.25, 8, '#8E9AA4', { y: bY - 0.05 }));
  // the envelope: 12 gores in alternating colours, a band at the equator, a crown ring
  const env = lathe([[0.45, 0], [0.9, 0.35], [1.7, 1.15], [2.15, 2.1], [2.25, 2.85], [2.05, 3.65], [1.5, 4.3], [0.7, 4.65], [0, 4.72]], 24, '#E8513C', 30);
  parts.push(xform(stripes(env, 12, ['#E8513C', '#FFD45A', '#2BB3A3', '#FFF8EC']), { y: bY }));
  parts.push(xform(torus(2.2, 0.06, '#FFF8EC', {}, 4, 32), { y: bY + 2.5, rx: Math.PI / 2 }), xform(torus(0.46, 0.05, '#8A5A35', {}, 4, 16), { y: bY + 0.02, rx: Math.PI / 2 }));
  // tether ropes to stakes on the ground
  for (const [x, z] of [[-2.2, -1.8], [2.2, -1.6], [-2.1, 2.0], [2.3, 1.9]]) {
    parts.push(tube([[x * 0.35, bY + 0.6, z * 0.35], [x * 0.7, bY * 0.55, z * 0.7], [x, 0.3, z]], 0.018, '#D9B97A', { seg: 3, steps: 6 }), xform(cyl(0.05, 0.06, 0.4, 5, WOOD_D), { x, z, rx: 0.2 }));
  }
  return mergeAll(parts);
}


// ---- The Fishing Dock (L28, 2 x 2; GDD §6.2 mechanic 21): its own little round pond, a plank dock reaching out over
//      it from the front edge, reeds and lily pads, a bucket, a tackle box and a rod rack. Both farmers sit on the dock's
//      end, legs over the water, facing the pond (avatars-view SEATS.pond_dock; the cast and reel are theirs).
const DOCK = Object.freeze({ pondZ: -0.35, pondR: 1.5, deckY: 0.36, endZ: 0.05 });
function pondDock() {
  const parts = [xform(blob(2.05, '#8FB25C', { seed: 33, sy: 0.02, detail: 2, amp: 0.08 }), {})];
  const rf = pondOutline(DOCK.pondR, 0.08, 0.05, 2.1);
  parts.push(xform(mergeAll([waterSurface(rf, { y: 0.1 }), ...stoneRim(rf, 18, { seed: 4, size: 0.24 })]), { z: DOCK.pondZ }));
  [[0.75, -0.9, 0.24], [-0.85, -0.6, 0.2], [0.4, -1.35, 0.18]].forEach(([x, z, r], i) => {
    parts.push(xform(lilyPad(r, i % 2 ? '#5E9E3A' : '#6BAA3F'), { x, y: 0.122, z, ry: i * 2.1 }));
    if (i === 0) parts.push(xform(lotus('#FFFFFF'), { x: x + 0.05, y: 0.12, z }));
  });
  for (const [x, z] of [[-1.35, -1.0], [1.3, -1.25], [-1.0, -1.65]]) parts.push(xform(mergeAll(Array.from({ length: 6 }, (_, k) => cyl(0.018, 0.025, 0.75 + (k % 3) * 0.2, 4, k % 2 ? '#5C8A3A' : '#6E9A44', { x: (k % 3 - 1) * 0.08, z: (k > 2 ? 0.07 : -0.05), rz: (k - 2.5) * 0.06 }, 0))), { x, z }));
  // the dock: four posts, stringers, planks from the front edge (z 1.95) to its end over the water
  const z0 = 1.95; const z1 = DOCK.endZ; const W = 1.15; const Y = DOCK.deckY;
  for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) for (const z of [z1 + 0.08, (z0 + z1) / 2, z0 - 0.1]) parts.push(cyl(0.07, 0.08, Y + (z === z1 + 0.08 ? 0.35 : 0), 6, '#7A5236', { x, z }));
  for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) parts.push(box(0.08, 0.1, z0 - z1, '#7A5236', { x, y: Y - 0.12, z: (z0 + z1) / 2 }));
  const n = Math.round((z0 - z1) / 0.2);
  for (let i = 0; i < n; i++) parts.push(box(W, 0.06, 0.18, i % 2 ? '#C9914F' : WOOD, { y: Y - 0.04, z: z1 + 0.1 + i * ((z0 - z1) / n) }));
  // a rope along the end posts, a lantern post, the bucket, the tackle box and a rod rack with two rods
  parts.push(tube([[-W / 2 + 0.06, Y + 0.32, z1 + 0.08], [0, Y + 0.18, z1 + 0.06], [W / 2 - 0.06, Y + 0.32, z1 + 0.08]], 0.02, '#D9B97A', { seg: 3, steps: 6 }));
  parts.push(xform(mergeAll([cyl(0.04, 0.05, 1.45, 5, '#5A3A26'), box(0.3, 0.04, 0.04, '#5A3A26', { x: 0.12, y: 1.4 }), box(0.18, 0.22, 0.18, '#FFE08A', { x: 0.24, y: 1.14 }), xform(P(new THREE.ConeGeometry(0.16, 0.12, 4), IRON), { x: 0.24, y: 1.36, ry: Math.PI / 4 })]), { x: W / 2 - 0.06, y: Y, z: z0 - 0.35 }));
  parts.push(xform(mergeAll([lathe([[0, 0], [0.15, 0], [0.18, 0.28], [0, 0.28]], 10, '#8E9AA4'), torus(0.16, 0.012, '#5E5A55', { y: 0.36, rx: 0 }, 3, 8)]), { x: -0.32, y: Y, z: z0 - 0.45 }));
  parts.push(xform(mergeAll([box(0.42, 0.2, 0.26, '#2E6B8E'), box(0.44, 0.04, 0.28, '#24597A', { y: 0.2 }), box(0.14, 0.04, 0.03, '#C9CED3', { y: 0.22 })]), { x: -0.25, y: Y, z: z0 - 0.95, ry: 0.3 }));
  const rack = [box(0.06, 0.8, 0.06, '#7A5236', { x: -0.25 }), box(0.06, 0.8, 0.06, '#7A5236', { x: 0.25 }), box(0.6, 0.05, 0.05, '#7A5236', { y: 0.7 })];
  for (const x of [-0.12, 0.12]) rack.push(xform(cyl(0.012, 0.02, 1.6, 4, '#C99A5A', {}, 0), { x, y: 0.05, rz: x * 0.6 }), xform(torus(0.05, 0.012, '#5E5A55', {}, 3, 8), { x, y: 0.35, rx: Math.PI / 2 }));
  parts.push(xform(mergeAll(rack), { x: -W / 2 - 0.35, z: z0 - 0.4 }));
  return mergeAll(parts);
}
/** A mounted fish trophy on a little board (the dock's cosmetic catches; render-world stands them on the dock). */
function fishTrophy(hex = '#7FA6B8', belly = '#E8EEF2') {
  return mergeAll([cyl(0.04, 0.05, 0.75, 5, '#5A3A26'), box(0.62, 0.36, 0.05, '#8A5A35', { y: 0.7 }), box(0.66, 0.04, 0.07, GOLD, { y: 0.68 }),
    xform(mergeAll([xform(blob(0.12, hex, { seed: 5, sx: 2.2, sy: 0.9, sz: 0.4, detail: 1 }), {}), xform(blob(0.08, belly, { seed: 6, sx: 1.8, sy: 0.5, sz: 0.38, detail: 0 }), { y: -0.05 }),
      xform(P(new THREE.ConeGeometry(0.1, 0.16, 4), hex), { rz: Math.PI / 2, x: -0.3, sz: 0.25 }), ball(0.02, '#1A1A1A', { x: 0.2, y: 0.03, z: 0.04 }, 0)]), { y: 0.88, z: 0.05 })]);
}

// ---- Statues (L32 cow statue, L30 golden cow): the farm's own cow, posed, cut in stone or cast in gold on a plinth.
async function posedAnimal(rel, clip, height) {
  const t = await tools();
  const doc = await t.io.read(await sourcePath(rel));
  const g = bakePose(await parseThree(doc), clip);
  return toHeight(g, height);
}
async function cowStatue(gold = false) {
  const cow = await posedAnimal('quaternius-ultimate-animated-animals/glTF/Cow.gltf', 'Idle', 1.75);
  hueTo(cow, gold ? '#E9B13A' : '#B9B4AA');
  if (gold) mottle(cow, { freq: 3, lo: 0.92, hi: 1.12, seed: 5 }); else mottle(cow, { freq: 4, lo: 0.88, hi: 1.06, seed: 3 });
  const plinth = gold
    ? [box(2.7, 0.16, 1.6, '#F2EEE6'), box(2.5, 0.36, 1.4, '#E8E2D6', { y: 0.16 }), box(2.7, 0.1, 1.6, '#F2EEE6', { y: 0.52 }), box(0.9, 0.2, 0.03, GOLD, { y: 0.24, z: 0.71 }),
      ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ball(0.08, GOLD, { x: x * 1.25, y: 0.68, z: z * 0.7 }, 1))]
    : [box(2.7, 0.16, 1.6, LIMESTONE_D), box(2.5, 0.36, 1.4, LIMESTONE, { y: 0.16 }), box(2.7, 0.1, 1.6, LIMESTONE_D, { y: 0.52 })];
  const flowers = gold ? [] : [xform(flowerClump(rng('stc1'), ['#FF7A9C', '#FFFFFF']), { x: -1.2, z: 1.05 }), xform(flowerClump(rng('stc2'), ['#FFD21F', '#FFFFFF']), { x: 1.2, z: 1.05 })];
  return mergeAll([...plinth, xform(crease(cow, 45), { y: 0.62, ry: Math.PI / 2 - 0.35, s: 1 }), ...flowers]);
}

// ---- The Melon Awning (2 x 1, Watermelon decor): a market stall under a green-and-cream striped awning, striped
//      melons heaped on a sloping board, two halves showing their red flesh, a chalk sign.
function watermelon(r = 0.28, { stripes: n = 10 } = {}) {
  const g = blob(r, '#5E9E4A', { seed: 13, sx: 1.25, amp: 0.04, detail: 2 });
  const p = g.getAttribute('position'); const c = g.getAttribute('color');
  const dark = lin('#2F6B2F'); const lite = lin('#78B85A');
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getY(i), p.getZ(i)) + noise3(p.getX(i) * 6, p.getY(i) * 6, p.getZ(i) * 6, 4) * 0.35;
    const band = (Math.sin(a * n) + 1) / 2;
    const col = band > 0.55 ? dark : lite;
    c.setXYZ(i, col.r, col.g, col.b);
  }
  return g;
}
function melonHalf(r = 0.28) {
  const rind = clipBelow(watermelon(r), 0);
  const flesh = xform(P(new THREE.CircleGeometry(r * 0.92, 14), '#E8473F'), { rx: -Math.PI / 2, y: 0.002, sx: 1.25 });
  const seeds = Array.from({ length: 7 }, (_, i) => xform(P(new THREE.CircleGeometry(0.018, 4), '#2A1A10'), { rx: -Math.PI / 2, x: Math.cos(i * 0.9) * r * 0.55, y: 0.004, z: Math.sin(i * 0.9) * r * 0.45 }));
  return mergeAll([xform(rind, { rx: Math.PI }), flesh, xform(P(new THREE.RingGeometry(r * 0.88, r * 0.98, 14), '#F2F0D8'), { rx: -Math.PI / 2, y: 0.003, sx: 1.25 }), ...seeds]);
}
function melonAwning() {
  const parts = [box(3.3, 0.7, 1.1, WOOD), box(3.4, 0.06, 1.2, '#C9914F', { y: 0.7 })];
  for (let i = -3; i <= 3; i++) parts.push(box(0.02, 0.66, 0.02, WOOD_D, { x: i * 0.45, y: 0.02, z: 0.56 }));
  const slope = xform(box(3.1, 0.06, 0.95, '#C9914F'), { rx: -0.35, y: 0.95, z: 0.05 });
  parts.push(slope);
  const rr = rng('melons');
  for (let i = 0; i < 9; i++) parts.push(xform(watermelon(0.26 + rr() * 0.05), { x: -1.25 + (i % 5) * 0.6 + (i > 4 ? 0.3 : 0), y: 1.05 + (i > 4 ? 0.22 : 0), z: i > 4 ? -0.15 : 0.2, ry: rr() * 3 }));
  parts.push(xform(melonHalf(0.27), { x: -1.0, y: 0.73, z: 0.48, ry: 0.3 }), xform(melonHalf(0.25), { x: 1.15, y: 0.73, z: 0.45, ry: -0.2 }));
  for (const x of [-1.55, 1.55]) parts.push(box(0.1, 2.3, 0.1, WOOD_D, { x, z: 0.5 }), box(0.1, 2.5, 0.1, WOOD_D, { x, z: -0.5 }));
  parts.push(xform(awning(3.4, 1.4, ['#FFF8EC', '#5EA04A'], 9), { y: 2.45, z: -0.6 }));
  parts.push(xform(mergeAll([box(0.7, 0.45, 0.04, '#2E3A2E'), box(0.76, 0.04, 0.06, WOOD_D, { y: 0.45 }), box(0.76, 0.04, 0.06, WOOD_D)]), { x: 1.4, y: 0.9, z: 0.62, rx: -0.2 }));
  return mergeAll(parts);
}
function amphora(hex = TERRACOTTA, h = 1.0) {
  return mergeAll([lathe([[0, 0], [0.1, 0], [0.16, 0.06], [0.34, 0.3], [0.38, 0.5], [0.3, 0.75], [0.15, 0.85], [0.13, 0.98], [0.18, 1.02], [0, 1.02]].map(([r, y]) => [r * h, y * h]), 16, hex, 45),
    xform(torus(0.36 * h, 0.03 * h, '#3A2A1A', {}, 3, 16), { y: 0.48 * h, rx: Math.PI / 2 }), xform(torus(0.35 * h, 0.02 * h, '#F3E6CC', {}, 3, 16), { y: 0.56 * h, rx: Math.PI / 2 }),
    ...[-1, 1].map((s) => tube([[s * 0.14 * h, 0.9 * h, 0], [s * 0.32 * h, 0.88 * h, 0], [s * 0.3 * h, 0.66 * h, 0]], 0.025 * h, hex, { seg: 4, steps: 6 }))]);
}
function oliveSprig() {
  const parts = [];
  for (const [bx, bz, lean] of [[0.14, 0.02, 0.3], [-0.12, 0.05, -0.35], [0.0, -0.12, 0.05]]) {
    const tip = [bx, 0.4, bz];
    parts.push(tube([[0, 0, 0], [bx * 0.5, 0.2, bz * 0.5], tip], 0.012, '#7A6A4A', { seg: 3, steps: 5 }));
    for (let i = 0; i < 7; i++) { const t = 0.25 + i * 0.11; parts.push(xform(leaf(0.13, 0.035, i % 2 ? '#7E9A6A' : '#93AE7E', { bend: 0.2, seg: 1 }), { x: bx * t, y: 0.4 * t, z: bz * t, rz: (i % 2 ? 1.0 : -1.0) + lean, ry: i * 1.3 })); }
  }
  for (let i = 0; i < 6; i++) parts.push(xform(blob(0.03, i % 2 ? '#3E4A2A' : '#5A6B2E', { seed: i, sy: 1.3, detail: 0 }), { x: Math.cos(i * 1.7) * 0.07, y: 0.16 + (i % 3) * 0.06, z: Math.sin(i * 1.7) * 0.07 }));
  return mergeAll(parts);
}
function oliveJar() {
  return mergeAll([box(0.9, 0.12, 0.9, LIMESTONE_D), amphora(TERRACOTTA, 1.05).translate(0, 0.12, 0), xform(oliveSprig(), { y: 1.1, s: 1.25 }),
    xform(amphora('#B9763E', 0.42), { x: 0.42, y: 0.12, z: 0.25 }), xform(mergeAll([lathe([[0, 0], [0.12, 0], [0.13, 0.12], [0, 0.12]], 10, '#E9D8A6'), ...Array.from({ length: 6 }, (_, i) => ball(0.035, i % 2 ? '#3E4A2A' : '#5A6B2E', { x: Math.cos(i) * 0.06, y: 0.14, z: Math.sin(i) * 0.06 }, 0))]), { x: -0.38, y: 0.12, z: 0.32 })]);
}
function fig(hex = '#6B3A6B') {
  return mergeAll([lathe([[0, 0], [0.055, 0.005], [0.08, 0.035], [0.075, 0.07], [0.045, 0.1], [0.018, 0.12], [0, 0.125]], 8, hex, 60), cyl(0.009, 0.012, 0.035, 3, '#6E8A3A', { y: 0.12 }, 0)]);
}
function figCrate() {
  const parts = [crate(0.85)];
  const rr = rng('figs');
  for (let i = 0; i < 20; i++) parts.push(xform(fig(i % 4 ? '#6B3A6B' : '#8A5A7A'), { x: (rr() - 0.5) * 0.66, y: 0.8 + rr() * 0.06, z: (rr() - 0.5) * 0.66, rx: (rr() - 0.5) * 1.4, rz: (rr() - 0.5) * 1.4, s: 1.15 }));
  // a fig cut open on the lid: pink flesh with seeds
  parts.push(xform(mergeAll([xform(clipBelow(fig('#6B3A6B'), 0), {}), xform(P(new THREE.CircleGeometry(0.07, 8), '#E87A8A'), { rx: -Math.PI / 2, y: 0.002 })]), { x: 0.55, y: 0.0, z: 0.35, s: 1.6, rz: Math.PI / 2 }));
  parts.push(xform(mergeAll([...Array.from({ length: 3 }, (_, i) => xform(leaf(0.3, 0.2, '#5E9E3A', { bend: 0.4, seg: 2 }), { ry: i * 2.1, rx: 1.0 }))]), { x: -0.3, y: 0.86, z: 0.3 }));
  return mergeAll(parts);
}


// ---- The M2 production buildings (GDD §3.5: Oil Press L30, Sugar Shack L34, Chocolatier L36), each with its signature
//      prop on the open front so it reads from the far zoom: the stone olive mill, the sugar house's steam cupola and
//      woodpile, the chocolatier's shop window and awning.
function oilPress() {
  const W = 3.4; const D = 2.6; const H = 2.1; const P0 = 0.25; const parts = [];
  parts.push(box(6.0, 0.12, 5.6, '#D9C7A8'));
  for (let i = 0; i < 18; i++) parts.push(xform(blob(0.2 + (i % 3) * 0.05, '#C9B49A', { seed: 80 + i, sy: 0.15, detail: 0 }), { x: -2.6 + (i % 6) * 1.0 + (i % 2) * 0.3, y: 0.1, z: -2.3 + Math.floor(i / 6) * 2.0 }));
  // the mill house at the back: warm plastered stone, stone quoins, a terracotta roof, a green door and shutters
  const hx = -0.9; const hz = -0.9;
  parts.push(box(W + 0.16, P0, D + 0.16, K.stoneD, { x: hx, y: 0.12, z: hz }), box(W, H, D, '#F0E2C4', { x: hx, y: 0.12 + P0, z: hz }));
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) for (let k = 0; k < 5; k++) parts.push(box(k % 2 ? 0.34 : 0.24, 0.36, k % 2 ? 0.24 : 0.34, '#CDBFA6', { x: hx + x * (W / 2 - 0.06), y: 0.12 + P0 + k * 0.42, z: hz + z * (D / 2 - 0.06) }));
  parts.push(xform(pitchedRoof(W, D, 1.1, TERRACOTTA, { oh: 0.3, gableHex: '#F0E2C4', trim: '#E8D6B4', bands: 9 }), { x: hx, y: 0.12 + P0 + H, z: hz }));
  parts.push(xform(doorBox(0.8, 1.55, '#4E7A5A'), { x: hx - 0.7, y: 0.12 + P0, z: hz + D / 2 + 0.03 }), xform(windowBox(0.62, 0.7, { shutters: '#4E7A5A' }), { x: hx + 0.75, y: 0.12 + P0 + 0.85, z: hz + D / 2 + 0.03 }),
    xform(windowBox(0.5, 0.55, { shutters: '#4E7A5A' }), { x: hx + W / 2 + 0.03, y: 0.12 + P0 + 0.9, ry: Math.PI / 2 }));
  parts.push(xform(flowerBox(0.8, ['#FF7A9C', '#FFFFFF', '#E8443A']), { x: hx + 0.75, y: 0.12 + P0 + 0.62, z: hz + D / 2 + 0.14 }));
  // the press yard at the front right: a pergola of beams under a vine (open from above, so the mill reads from afar)
  const sx = 1.35; const sz = 1.0; const sw = 2.6; const sd = 2.4; const ph = 2.1;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(box(0.16, ph, 0.16, K.timber, { x: sx + x * (sw / 2 - 0.1), y: 0.12, z: sz + z * (sd / 2 - 0.1) }));
  for (const z of [-1, 1]) parts.push(box(sw + 0.3, 0.14, 0.14, K.timber, { x: sx, y: 0.12 + ph, z: sz + z * (sd / 2 - 0.1) }));
  for (let i = 0; i < 6; i++) parts.push(box(0.1, 0.1, sd + 0.4, K.timberL, { x: sx - sw / 2 + 0.1 + i * ((sw - 0.2) / 5), y: 0.12 + ph + 0.14 }));
  const vr = rng('oilvine');
  for (let i = 0; i < 9; i++) parts.push(xform(blob(0.28, i % 2 ? LEAF : '#5E9E3A', { seed: 90 + i, sy: 0.55, detail: 1 }), { x: sx - sw / 2 + vr() * sw, y: 0.12 + ph + 0.28, z: sz + (i % 2 ? -1 : 1) * (sd / 2 - 0.15) + (vr() - 0.5) * 0.4 }));
  for (const [x, z] of [[1, 1], [-1, 1]]) parts.push(tube([[sx + x * (sw / 2 - 0.1), 0.15, sz + z * (sd / 2 - 0.1) + 0.1], [sx + x * (sw / 2 - 0.05), 1.1, sz + z * (sd / 2 - 0.1) + 0.12], [sx + x * (sw / 2 - 0.1), 0.12 + ph, sz + z * (sd / 2 - 0.1) + 0.1]], 0.035, '#6E5A3A', { seg: 4, steps: 6 }));
  // the olive mill: a round stone basin, an upright millstone on its axle round a centre post, a push beam
  const mill = [cyl(0.95, 1.0, 0.5, 18, '#B9B2A4', {}, 35), cyl(0.82, 0.82, 0.04, 18, '#5E5A2A', { y: 0.47 }), cyl(0.85, 0.85, 0.06, 18, '#A7A096', { y: 0.5 }),
    cyl(0.1, 0.12, 1.4, 8, K.timber, { y: 0.5 }), xform(cyl(0.5, 0.5, 0.26, 16, '#C9C1B0', {}, 35), { rz: Math.PI / 2, x: 0.38, y: 0.98 }),
    xform(torus(0.5, 0.03, '#A7A096', {}, 3, 16), { ry: Math.PI / 2, x: 0.51, y: 0.98 }), xform(box(1.9, 0.1, 0.1, K.timber), { x: 0.2, y: 1.0 }),
    ...[0, 1, 2, 3, 4].map((i) => ball(0.05, '#3E2A3A', { x: Math.cos(i * 1.3) * 0.55, y: 0.52, z: Math.sin(i * 1.3) * 0.55 }, 0))];
  parts.push(xform(mergeAll(mill), { x: sx, y: 0.12, z: sz + 0.1, ry: 0.5 }));
  // the oil: amphorae along the house wall, a rack of golden bottles, olive crates, a potted olive, the sign
  [[-2.55, 0.65, 1.0], [-2.1, 0.85, 0.85], [-2.55, 1.2, 0.7]].forEach(([x, z, k]) => parts.push(xform(amphora(TERRACOTTA, k), { x, y: 0.12, z })));
  const rack = [box(1.0, 0.06, 0.32, WOOD_D, { y: 0.5 }), box(1.0, 0.06, 0.32, WOOD_D, { y: 0.95 }), box(0.06, 1.0, 0.3, WOOD_D, { x: -0.48 }), box(0.06, 1.0, 0.3, WOOD_D, { x: 0.48 })];
  for (let i = 0; i < 5; i++) for (const y of [0.56, 1.01]) rack.push(xform(mergeAll([lathe([[0, 0], [0.06, 0], [0.065, 0.16], [0.025, 0.22], [0.025, 0.28], [0, 0.28]], 6, '#E9B83A', 60), cyl(0.028, 0.028, 0.04, 5, '#4E7A5A', { y: 0.27 })]), { x: -0.36 + i * 0.18, y }));
  parts.push(xform(mergeAll(rack), { x: hx + 0.2, y: 0.12, z: hz + D / 2 + 0.38 }));
  for (const [x, z, ry] of [[2.55, -0.55, 0.2], [2.45, -1.25, -0.1]]) parts.push(xform(mergeAll([crate(0.55), ...Array.from({ length: 9 }, (_, i) => ball(0.06, i % 3 ? '#3E2A3A' : '#6B7A2E', { x: (i % 3 - 1) * 0.15, y: 0.56, z: (Math.floor(i / 3) - 1) * 0.15 }, 0))]), { x, y: 0.12, z, ry }));
  parts.push(xform(mergeAll([lathe([[0, 0], [0.26, 0], [0.32, 0.4], [0.3, 0.42], [0, 0.42]], 10, TERRACOTTA), cyl(0.05, 0.06, 0.6, 5, '#7D6A52', { y: 0.4 }),
    xform(mottle(blob(0.42, '#93AB82', { seed: 5, sy: 0.7, detail: 1 }), { seed: 2 }), { y: 1.2 })]), { x: -2.6, y: 0.12, z: -2.2 }));
  const sign = mergeAll([box(0.1, 1.9, 0.1, K.timber), box(0.9, 0.1, 0.1, K.timber, { x: 0.4, y: 1.8 }), xform(signBoard(0.85, 0.5, '#F3E6CC', K.timber), { x: 0.42, y: 1.2 }),
    xform(oliveSprig(), { x: 0.3, y: 1.27, z: 0.07, rz: -1.2, s: 0.9 }), xform(lathe([[0, 0], [0.08, 0.06], [0.07, 0.14], [0, 0.24]], 8, '#E9B83A', 60), { x: 0.62, y: 1.32, z: 0.08 })]);
  parts.push(xform(sign, { x: 1.95, y: 0.12, z: 2.4 }));
  return withAnchors(mergeAll(parts), { windows: [[r3(hx + 0.75), r3(0.12 + P0 + 1.2), r3(hz + D / 2 + 0.06)]], counter: [r3(sx), 1.6, r3(sz)] });
}

function sugarShack() {
  const W = 3.6; const D = 2.8; const H = 2.0; const P0 = 0.3; const parts = [];
  parts.push(box(6.0, 0.1, 5.6, '#B9A88A'));
  const hx = -0.3; const hz = -0.7; const PLANK = '#9A5A3A';
  parts.push(box(W + 0.16, P0, D + 0.16, K.stoneD, { x: hx, y: 0.1, z: hz }), box(W, H, D, PLANK, { x: hx, y: 0.1 + P0, z: hz }));
  // board-and-batten walls: battens up every 0.32 m on all four sides
  for (let i = 0; i <= Math.floor(W / 0.32); i++) for (const z of [-1, 1]) parts.push(box(0.05, H, 0.04, '#7A4430', { x: hx - W / 2 + i * 0.32, y: 0.1 + P0, z: hz + z * (D / 2 + 0.01) }));
  for (let i = 0; i <= Math.floor(D / 0.32); i++) for (const x of [-1, 1]) parts.push(box(0.04, H, 0.05, '#7A4430', { x: hx + x * (W / 2 + 0.01), y: 0.1 + P0, z: hz - D / 2 + i * 0.32 }));
  const RY = 0.1 + P0 + H;
  parts.push(xform(pitchedRoof(W, D, 1.25, '#4E6E58', { oh: 0.32, gableHex: PLANK, trim: '#E8DCC2', bands: 8 }), { x: hx, y: RY, z: hz, ry: Math.PI / 2 }));
  // the steam cupola on the ridge: a louvred box under its own little roof (the sugar house's signature)
  const cu = [box(0.9, 0.7, 1.6, '#E8DCC2', { y: 0 })];
  for (let k = 0; k < 4; k++) for (const s of [-1, 1]) cu.push(xform(box(0.92, 0.06, 0.08, '#7A4430'), { y: 0.12 + k * 0.15, z: s * 0.81, rx: s * 0.4 }));
  for (let k = 0; k < 4; k++) for (const s of [-1, 1]) cu.push(xform(box(0.08, 0.06, 1.62, '#7A4430'), { x: s * 0.46, y: 0.12 + k * 0.15, rz: -s * 0.4 }));
  cu.push(xform(pitchedRoof(1.0, 1.7, 0.45, '#4E6E58', { oh: 0.15, gableHex: '#E8DCC2', trim: '#E8DCC2', bands: 4 }), { y: 0.7, ry: Math.PI / 2 }));
  parts.push(xform(mergeAll(cu), { x: hx, y: RY + 1.0 }));
  // a stovepipe at the back, the door with a maple-leaf sign, a window
  parts.push(xform(mergeAll([cyl(0.12, 0.12, 1.6, 8, '#5E5A55'), cyl(0.18, 0.18, 0.08, 8, '#4A4642', { y: 1.6 }), xform(P(new THREE.ConeGeometry(0.24, 0.18, 8), '#4A4642'), { y: 1.78 })]), { x: hx + 1.1, y: RY + 0.2, z: hz - 0.7 }));
  parts.push(xform(doorBox(0.85, 1.55, '#5A3A26'), { x: hx - 0.6, y: 0.1 + P0, z: hz + D / 2 + 0.04 }), xform(windowBox(0.6, 0.6, { shutters: '#4E6E58' }), { x: hx + 0.8, y: 0.1 + P0 + 0.85, z: hz + D / 2 + 0.04 }));
  const leafSign = new THREE.Shape();
  const pts = [[0, 0.5], [0.12, 0.28], [0.36, 0.38], [0.28, 0.12], [0.46, 0.04], [0.2, -0.1], [0.24, -0.3], [0.03, -0.2], [0.03, -0.42], [-0.03, -0.42], [-0.03, -0.2], [-0.24, -0.3], [-0.2, -0.1], [-0.46, 0.04], [-0.28, 0.12], [-0.36, 0.38], [-0.12, 0.28]];
  leafSign.moveTo(...pts[0]); for (const q of pts.slice(1)) leafSign.lineTo(...q); leafSign.closePath();
  parts.push(xform(mergeAll([box(0.95, 0.7, 0.06, '#F3E6CC'), xform(P(new THREE.ExtrudeGeometry(leafSign, { depth: 0.04, bevelEnabled: false }), '#D2552E'), { y: 0.36, z: 0.03, s: 0.62 })]), { x: hx - 0.6, y: 0.1 + P0 + 1.75, z: hz + D / 2 + 0.06 }));
  // the woodpile along the side, a sap tank on a sled, buckets, jugs of syrup on a bench
  parts.push(xform(logPile(), { x: hx + W / 2 - 0.4, y: 0.1, z: hz - 0.2, ry: Math.PI / 2, s: 0.8 }), xform(logPile(), { x: hx + W / 2 - 0.4, y: 0.1, z: hz + 0.75, ry: Math.PI / 2, s: 0.65 }));
  const tank = [xform(cyl(0.42, 0.42, 1.3, 12, '#8E9AA4', {}, 40), { rz: Math.PI / 2, y: 0.62 }), box(1.6, 0.08, 0.15, WOOD_D, { y: 0.15, z: 0.32 }), box(1.6, 0.08, 0.15, WOOD_D, { y: 0.15, z: -0.32 }),
    xform(box(0.25, 0.08, 0.15, WOOD_D), { x: 0.86, y: 0.22, z: 0.32, rz: 0.5 }), xform(box(0.25, 0.08, 0.15, WOOD_D), { x: 0.86, y: 0.22, z: -0.32, rz: 0.5 }),
    cyl(0.1, 0.1, 0.1, 8, '#5E5A55', { y: 1.02 }), torus(0.43, 0.02, '#5E5A55', { x: -0.4, y: 0.62, ry: Math.PI / 2 }, 3, 14), torus(0.43, 0.02, '#5E5A55', { x: 0.4, y: 0.62, ry: Math.PI / 2 }, 3, 14)];
  parts.push(xform(mergeAll(tank), { x: 1.55, y: 0.1, z: 1.7, ry: -0.3 }));
  for (const [x, z] of [[-2.4, 1.5], [-2.0, 1.85], [-2.55, 2.1]]) parts.push(xform(mergeAll([cyl(0.14, 0.115, 0.26, 10, '#A7A39A'), cyl(0.13, 0.13, 0.02, 10, '#D08A2A', { y: 0.23 })]), { x, y: 0.1, z }));
  const bench = [box(1.3, 0.07, 0.4, WOOD, { y: 0.48 }), box(0.07, 0.48, 0.36, WOOD_D, { x: -0.58 }), box(0.07, 0.48, 0.36, WOOD_D, { x: 0.58 })];
  for (let i = 0; i < 4; i++) bench.push(xform(mergeAll([lathe([[0, 0], [0.09, 0], [0.1, 0.12], [0.05, 0.2], [0.035, 0.27], [0, 0.27]], 8, '#C8862E', 60), xform(torus(0.04, 0.015, '#C8862E', {}, 3, 8), { x: 0.07, y: 0.17, ry: Math.PI / 2 })]), { x: -0.45 + i * 0.3, y: 0.55 }));
  parts.push(xform(mergeAll(bench), { x: hx + 0.8, y: 0.1, z: hz + D / 2 + 0.55 }));
  return withAnchors(mergeAll(parts), { chimney: [r3(hx + 1.1), r3(RY + 2.0), r3(hz - 0.7)], windows: [[r3(hx + 0.8), r3(0.1 + P0 + 1.15), r3(hz + D / 2 + 0.07)]], counter: [r3(hx + 0.8), 1.4, r3(hz + D / 2 + 0.55)] });
}

function chocolatier() {
  const W = 3.8; const D = 2.8; const H = 2.3; const P0 = 0.3; const parts = [];
  parts.push(box(6.0, 0.1, 5.4, '#D8C9AA'));
  for (let i = -7; i <= 7; i++) parts.push(box(0.36, 0.012, 2.0, i % 2 ? '#CDBDA0' : '#D8C9AA', { x: i * 0.38, y: 0.1, z: 1.9 }));
  const hz = -0.8; const PINK = '#F6DCD2'; const CHOC = '#6B3A2A'; const CREAM = '#FFF4E2';
  parts.push(box(W + 0.16, P0, D + 0.16, '#B9A894', { y: 0.1, z: hz }), box(W, H, D, PINK, { y: 0.1 + P0, z: hz }));
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(box(0.16, H, 0.16, CREAM, { x: x * W / 2, y: 0.1 + P0, z: hz + z * D / 2 }));
  parts.push(box(W + 0.2, 0.14, D + 0.2, CREAM, { y: 0.1 + P0 + H - 0.1, z: hz }));
  const RY = 0.1 + P0 + H;
  parts.push(xform(pitchedRoof(W, D, 1.35, CHOC, { oh: 0.3, gableHex: PINK, trim: CREAM, bands: 8 }), { y: RY, z: hz }));
  // a dormer with a round window, a chimney
  parts.push(xform(mergeAll([box(0.9, 0.7, 0.8, PINK), xform(pitchedRoof(0.9, 0.8, 0.45, CHOC, { oh: 0.1, gableHex: PINK, trim: CREAM, bands: 3 }), { y: 0.7, ry: Math.PI / 2 }),
    xform(mergeAll([torus(0.2, 0.04, CREAM, {}, 4, 14), xform(P(new THREE.CircleGeometry(0.18, 12), K.glass), { z: -0.01 })]), { y: 0.38, z: 0.41 })]), { x: -0.8, y: RY + 0.2, z: hz + 0.75 }));
  parts.push(xform(stack(1.3, 0.45), { x: 1.15, y: RY + 0.2, z: hz - 0.5 }));
  // the shop front: a bay window with a gold frame and a display of chocolates, the door, a striped awning
  const fz = hz + D / 2;
  const bay = [box(1.8, 0.5, 0.55, CREAM, { y: 0.1 + P0 }), box(1.7, 1.2, 0.45, '#BFE3EA', { y: 0.1 + P0 + 0.5 }), box(1.86, 0.08, 0.6, GOLD, { y: 0.1 + P0 + 0.5 }),
    box(1.86, 0.1, 0.6, CREAM, { y: 0.1 + P0 + 1.7 }), ...[-0.85, -0.28, 0.28, 0.85].map((x) => box(0.06, 1.2, 0.5, GOLD, { x, y: 0.1 + P0 + 0.5 }))];
  // the display: a chocolate cake on a stand, boxes with pink bows, a jar of truffles
  bay.push(xform(mergeAll([cyl(0.18, 0.2, 0.05, 12, CREAM), cyl(0.03, 0.03, 0.12, 5, CREAM), cyl(0.26, 0.26, 0.05, 14, CREAM, { y: 0.12 }), cyl(0.22, 0.22, 0.22, 14, '#5A2E20', { y: 0.17 }),
    cyl(0.23, 0.23, 0.03, 14, '#FFE9F2', { y: 0.39 }), ball(0.035, '#E8443A', { y: 0.43 }, 0)]), { x: -0.45, y: 0.1 + P0 + 0.55, z: 0.32 }));
  for (const [x, c] of [[0.2, '#FF9FB8'], [0.55, '#FFFFFF']]) bay.push(xform(mergeAll([box(0.28, 0.12, 0.2, CHOC), box(0.29, 0.13, 0.04, c), box(0.04, 0.13, 0.21, c), ball(0.04, c, { y: 0.14 }, 0)]), { x, y: 0.1 + P0 + 0.55, z: 0.32 }));
  parts.push(xform(mergeAll(bay), { x: -0.75, z: fz }));
  parts.push(xform(doorBox(0.85, 1.75, '#7A3A2E'), { x: 1.15, y: 0.1 + P0, z: fz + 0.03 }), xform(windowBox(0.5, 0.5), { x: 1.15, y: 0.1 + P0 + 2.05, z: fz + 0.03 }));
  parts.push(xform(awning(2.2, 1.0, [CHOC, '#FF9FB8'], 8), { x: -0.75, y: RY - 0.25, z: fz + 0.02 }));
  // the hanging sign: a chocolate bar in its gold foil under a heart
  const heart = new THREE.Shape(); heart.moveTo(0, -0.22); heart.bezierCurveTo(0.4, 0.1, 0.22, 0.4, 0, 0.2); heart.bezierCurveTo(-0.22, 0.4, -0.4, 0.1, 0, -0.22);
  const bar = [box(0.62, 0.36, 0.06, CHOC)];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) bar.push(box(0.17, 0.14, 0.03, '#7E4A36', { x: -0.2 + i * 0.2, y: 0.04 + j * 0.16, z: 0.04 }));
  bar.push(box(0.64, 0.14, 0.08, GOLD, { y: -0.02 }));
  parts.push(xform(mergeAll([xform(box(0.85, 0.06, 0.06, IRON), { x: 0.42 }), cyl(0.008, 0.008, 0.2, 3, IRON, { x: 0.15, y: -0.2 }, 0), cyl(0.008, 0.008, 0.2, 3, IRON, { x: 0.7, y: -0.2 }, 0),
    xform(mergeAll(bar), { x: 0.42, y: -0.62 }), xform(P(new THREE.ExtrudeGeometry(heart, { depth: 0.05, bevelEnabled: false }), '#FF7A9C'), { x: 0.42, y: -0.2, s: 0.7 })]), { x: 1.75, y: 0.1 + P0 + 2.05, z: fz + 0.35, ry: Math.PI / 2 }));
  // the cocoa sacks by the door, a café table with two chairs and cups, flower tubs
  for (const [x, z, ry] of [[2.3, fz + 0.6, 0.3], [2.6, fz + 0.25, -0.4]]) parts.push(xform(mergeAll([sack('#C9A06A'), ...[0, 1, 2].map((i) => ball(0.05, '#6B3A2A', { x: (i - 1) * 0.08, y: 0.45, z: 0.02 }, 0))]), { x, y: 0.1, z, ry }));
  const cafe = [cyl(0.32, 0.32, 0.04, 14, CREAM, { y: 0.74 }), cyl(0.03, 0.03, 0.74, 5, IRON), cyl(0.2, 0.22, 0.04, 10, IRON),
    ...[-1, 1].map((sd) => xform(mergeAll([cyl(0.18, 0.18, 0.04, 10, '#FF9FB8', { y: 0.45 }), cyl(0.025, 0.025, 0.45, 4, IRON), box(0.32, 0.36, 0.03, IRON, { y: 0.5, z: -0.17 })]), { x: sd * 0.55, ry: sd * Math.PI / 2 })),
    ...[-0.12, 0.12].map((x) => mergeAll([cyl(0.05, 0.04, 0.08, 8, CREAM, { x, y: 0.78 }), cyl(0.045, 0.045, 0.01, 8, '#6B3A2A', { x, y: 0.86 })]))];
  parts.push(xform(mergeAll(cafe), { x: -0.9, y: 0.1, z: fz + 1.55 }));
  for (const x of [-2.35, 0.45]) parts.push(xform(flowerUrn(['#FF9FB8', '#FFFFFF', '#E8443A']), { x, y: 0.1, z: fz + 0.55 }));
  return withAnchors(mergeAll(parts), { chimney: [1.15, r3(RY + 1.75), r3(hz - 0.5)], windows: [[-0.75, r3(0.1 + P0 + 1.1), r3(fz + 0.5)], [1.15, r3(0.1 + P0 + 2.3), r3(fz + 0.06)]], counter: [-0.75, 1.6, r3(fz + 0.4)] });
}


// ---- The farmhouse interior (wave 3, content farmhouse.js INTERIOR / FURNITURE: 1 interior tile = 1 m; render-world
//      builds the room scene). `furniture:<id>`: origin at the centre of the piece's floor footprint (w x d metres),
//      the front toward +z (into the room); a wall piece (layer 'wall', size [slots, 1]) has its back on the wall at
//      z = 0, the centre of its slots at x = 0, and hangs at its own height (y absolute, 0 = the floor). Grandma's
//      cottage palette: honey oak, cream paint, rose and sage textiles, brass. `interior:room` is the shell (floor,
//      back and left walls, beams; front and right open: a dollhouse cut).
const OAK = '#B98048'; const OAK_D = '#8A5A35'; const OAK_L = '#D6A766'; const CREAM = '#F3E6CC'; const ROSE = '#D9727E'; const SAGE = '#8FAE88';
const BRASS = '#C9A23A'; const TEAL = '#2E8C86';
const FURN = [];
const furn = (id, size, build, extra = {}) => FURN.push({ id, size, build, extra });
/** Four turned legs under a w x d top at height h (inset). */
function legs4(w, d, h, hex = OAK_D, inset = 0.06, r = 0.035) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => lathe([[r * 0.8, 0], [r, h * 0.1], [r * 0.7, h * 0.45], [r * 1.1, h * 0.55], [r * 0.8, h * 0.9], [r, h], [0, h]], 6, hex, 50).translate(x * (w / 2 - inset), 0, z * (d / 2 - inset)));
}
/** A soft cushion (a rounded, puffed box) w x h x d sitting on y = 0. */
function cushion(w, h, d, hex, seed = 1) {
  const g = new THREE.BoxGeometry(w, h, d, 3, 2, 3); g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2); const y = p.getY(i) / (h / 2); const z = p.getZ(i) / (d / 2);
    const k = 1 - 0.12 * (x * x * z * z); const puff = 1 + 0.25 * (1 - x * x) * (1 - z * z);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * (y > 0 ? puff : 1), p.getZ(i) * k);
  }
  g.translate(0, h / 2, 0);
  return mottle(P(g, hex, { creaseDeg: 70 }), { freq: 6, lo: 0.94, hi: 1.05, seed });
}
/** A picture frame on the wall (back at z = 0): outer w x h, a moulded frame, the picture's colour bands. */
function frameOnWall(w, h, { frame = BRASS, bands = ['#9FD3E8', '#7DB04A'], y = 1.6, oval = false } = {}) {
  const parts = [];
  if (oval) {
    parts.push(xform(torus(0.5, 0.06, frame, {}, 5, 20), { y, z: 0.04, sx: w, sy: h }), xform(P(new THREE.CircleGeometry(0.5, 20), bands[0]), { y, z: 0.03, sx: w * 0.96, sy: h * 0.96 }));
    if (bands[1]) parts.push(xform(P(new THREE.CircleGeometry(0.22, 12), bands[1]), { y: y - h * 0.08, z: 0.035, sx: w, sy: h * 1.1 }));
    return mergeAll(parts);
  }
  parts.push(box(w, h, 0.05, frame, { y: y - h / 2 }), box(w + 0.04, 0.05, 0.07, boost(lin(frame), 0, -0.06).getStyle(), { y: y + h / 2 - 0.03 }));
  const iw = w - 0.12; const ih = h - 0.12;
  bands.forEach((c, i) => parts.push(box(iw, ih / bands.length, 0.02, c, { y: y + ih / 2 - (ih / bands.length) * (i + 1), z: 0.04 })));
  return mergeAll(parts);
}
function book(hex, h = 0.26, t = 0.05) { return mergeAll([box(t, h, 0.18, hex), box(t + 0.002, 0.02, 0.182, '#F3E6CC', { y: h * 0.72 })]); }
function teacup(hex = '#FFFFFF') { return mergeAll([lathe([[0, 0], [0.03, 0], [0.045, 0.05], [0.04, 0.055], [0, 0.01]], 8, hex), cyl(0.06, 0.06, 0.008, 8, hex), cyl(0.032, 0.032, 0.004, 8, '#B5743E', { y: 0.045 })]); }
function teapot(hex = '#FFFFFF') {
  return mergeAll([lathe([[0, 0], [0.08, 0], [0.1, 0.06], [0.09, 0.12], [0.05, 0.15], [0, 0.16]], 10, hex), ball(0.02, hex, { y: 0.17 }, 0),
    xform(cyl(0.012, 0.02, 0.1, 5, hex), { rz: -0.9, x: 0.12, y: 0.09 }), xform(torus(0.04, 0.012, hex, {}, 3, 8), { x: -0.1, y: 0.09 })]);
}
function vase(hex, flowers = ['#FF7A9C', '#FFFFFF', '#FFD21F']) {
  return mergeAll([lathe([[0, 0], [0.05, 0], [0.07, 0.08], [0.04, 0.16], [0.05, 0.2], [0, 0.2]], 10, hex), ...flowers.map((c, i) => xform(mergeAll([cyl(0.006, 0.006, 0.16, 3, '#4E8F3A', {}, 0), xform(flatFlower(c, 0.05), { y: 0.16 })]), { x: (i - 1) * 0.04, y: 0.18, rz: (i - 1) * 0.25 }))]);
}
function taper(h = 0.25) { return mergeAll([cyl(0.025, 0.025, h, 8, '#FFF6E2'), cyl(0.004, 0.004, 0.03, 3, '#3A2A1A', { y: h }, 0), xform(blob(0.02, '#FFC14A', { sy: 1.7, detail: 0 }), { y: h + 0.045 })]); }
function chair(seatHex = OAK, back = 'ladder') {
  const parts = [...legs4(0.44, 0.42, 0.45, OAK_D, 0.04, 0.025), box(0.46, 0.05, 0.44, seatHex, { y: 0.45 })];
  for (const x of [-0.2, 0.2]) parts.push(box(0.04, 0.55, 0.04, OAK_D, { x, y: 0.45, z: -0.2 }));
  if (back === 'ladder') for (let k = 0; k < 3; k++) parts.push(box(0.38, 0.05, 0.03, OAK, { y: 0.62 + k * 0.13, z: -0.2 }));
  return mergeAll(parts);
}

// fixed pieces
furn('memory_wall', [3, 1], ({ w = 3 } = {}) => {
  const k = w / 3;
  const parts = [box(2.8 * k, 0.05, 0.22, OAK_D, { y: 0.98 }), xform(mergeAll([box(0.32, 0.06, 0.24, ROSE), box(0.3, 0.02, 0.22, '#FFF8EC', { y: 0.06 })]), { x: 0.9 * k, y: 1.03, z: 0.12 })];
  const frames = [[-1.05, 1.75, 0.55, 0.42, BRASS], [-0.35, 1.9, 0.4, 0.55, OAK_D], [0.3, 1.72, 0.5, 0.4, '#FFFFFF'], [0.95, 1.85, 0.42, 0.5, BRASS], [-0.75, 1.3, 0.38, 0.3, OAK], [0.0, 1.38, 0.32, 0.28, BRASS],
    [0.62, 1.32, 0.4, 0.3, OAK_D], [-1.2, 2.35, 0.3, 0.3, OAK], [0.0, 2.45, 0.6, 0.32, BRASS], [1.1, 2.4, 0.34, 0.28, '#FFFFFF']];
  const pics = [['#9FD3E8', '#7DB04A'], ['#FFE6B0', '#F2852A'], ['#BFE3F5', '#E8848C'], ['#9FD3E8', '#D9C49A'], ['#F7D2DC', '#FFFFFF'], ['#FFE58A', '#8FAE88'], ['#9FD3E8', '#3F8F36'], ['#E8D8F8', '#9C7FD0'], ['#FFD39B', '#B5543F'], ['#BFE3F5', '#FFFFFF']];
  frames.forEach(([x, y, fw, h, f], i) => parts.push(xform(frameOnWall(fw, h, { frame: f, bands: pics[i], y }), { x: x * k })));
  return mergeAll(parts);
}, { layer: 'wall' });
furn('ribbon_wall', [2, 1], ({ w = 2 } = {}) => {
  const bw = w - 0.4; const cols4 = Math.max(2, Math.round(bw / 0.6));
  const parts = [box(bw, 1.2, 0.04, '#3F6E4A', { y: 1.25 }), box(bw + 0.1, 0.06, 0.07, OAK_D, { y: 2.45 }), box(bw + 0.1, 0.06, 0.07, OAK_D, { y: 1.22 }), box(bw + 0.1, 0.05, 0.24, OAK_D, { y: 1.0 })];
  const cols = ['#2E6FD0', '#D93A3A', '#F2C230', '#FFFFFF', '#9C7FD0', '#2BB3A3'];
  for (let i = 0; i < cols4 * 2; i++) {
    const c = cols[i % cols.length];
    parts.push(xform(mergeAll([cyl(0.13, 0.13, 0.025, 12, c), cyl(0.08, 0.08, 0.03, 12, '#FFC83D'), cyl(0.05, 0.05, 0.035, 10, '#FFF8EC'),
      box(0.06, 0.2, 0.01, c, { x: -0.04, y: -0.26, rz: 0.15 }), box(0.06, 0.2, 0.01, c, { x: 0.04, y: -0.26, rz: -0.15 })].map((g) => xform(g, { rx: Math.PI / 2 }))), { x: -bw / 2 + 0.3 + (i % cols4) * ((bw - 0.6) / Math.max(1, cols4 - 1)), y: i < cols4 ? 2.05 : 1.6, z: 0.05 }));
  }
  parts.push(xform(trophy('#FFC83D', 0.4), { x: -bw * 0.22, y: 1.03, z: 0.11 }), xform(trophy('#C9CED3', 0.32), { x: bw * 0.22, y: 1.03, z: 0.11 }));
  return mergeAll(parts);
}, { layer: 'wall' });
furn('keepsake_shelf', [2, 1], () => {
  // Grandma's Keepsake Dresser: a low sage sideboard, its shelf of keepsakes on top and a little framed mirror
  const parts = [box(1.7, 0.8, 0.5, SAGE, { y: 0.08 }), box(1.76, 0.05, 0.56, OAK, { y: 0.88 }), ...legs4(1.64, 0.44, 0.08, OAK_D, 0.04, 0.03),
    ...[-0.42, 0.42].map((x) => mergeAll([box(0.75, 0.6, 0.02, '#A8C5A2', { x, y: 0.18, z: 0.25 }), ball(0.02, BRASS, { x: x + (x < 0 ? 0.28 : -0.28), y: 0.5, z: 0.27 }, 0)])),
    box(1.5, 0.45, 0.06, OAK_D, { y: 0.93, z: -0.22 }), box(1.5, 0.04, 0.2, OAK, { y: 1.15, z: -0.14 })];
  parts.push(xform(jar('#E8848C'), { x: -0.6, y: 0.93, s: 0.7 }), xform(vase('#7FB8E6'), { x: -0.25, y: 0.93 }), xform(mergeAll([box(0.2, 0.12, 0.14, ROSE), box(0.21, 0.025, 0.15, '#FFF8EC', { y: 0.12 })]), { x: 0.2, y: 0.93 }));
  // a little teddy bear, letters tied with ribbon, a candle on the top shelf
  parts.push(xform(mergeAll([ball(0.07, '#C99A62', { y: 0.08 }, 1), ball(0.05, '#C99A62', { y: 0.18 }, 1), ball(0.02, '#C99A62', { x: -0.035, y: 0.22 }, 0), ball(0.02, '#C99A62', { x: 0.035, y: 0.22 }, 0)]), { x: 0.6, y: 0.93 }),
    xform(mergeAll([box(0.22, 0.05, 0.15, '#FFF8EC'), box(0.23, 0.052, 0.02, ROSE)]), { x: -0.3, y: 1.19, z: -0.14 }), xform(taper(0.18), { x: 0.4, y: 1.19, z: -0.14 }));
  return mergeAll(parts);
});
furn('farmhouse_window', [3, 1], ({ w = 3 } = {}) => {
  const gw = Math.min(2.2, w - 0.9); const hw = gw / 2;
  const parts = [box(gw, 1.25, 0.03, '#BFE3F5', { y: 0.95 }), box(gw, 0.35, 0.031, '#8FC86A', { y: 0.95 }), box(gw, 0.12, 0.032, '#6FA850', { y: 0.95 })];
  for (const x of [-hw - 0.03, hw + 0.03]) parts.push(box(0.1, 1.45, 0.12, CREAM, { x, y: 0.85 }));
  parts.push(box(gw + 0.16, 0.1, 0.12, CREAM, { y: 2.25 }), box(gw + 0.2, 0.08, 0.26, CREAM, { y: 0.82, z: 0.06 }), ...[-1, 0, 1].slice(gw > 1.6 ? 0 : 1, gw > 1.6 ? 3 : 2).map((i) => box(0.06, 1.25, 0.08, CREAM, { x: gw > 1.6 ? i * gw / 3 + (i ? 0 : 0) : 0, y: 0.95 })), box(gw, 0.06, 0.08, CREAM, { y: 1.55 }));
  // gingham curtains on a rail, a geranium box on the sill
  parts.push(xform(cyl(0.02, 0.02, gw + 0.6, 6, BRASS), { rz: Math.PI / 2, x: hw + 0.3, y: 2.38, z: 0.14 }));
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) parts.push(box(0.11, 1.5, 0.02, k % 2 ? '#F4D2D6' : ROSE, { x: s * (hw + 0.12 + k * 0.1), y: 0.88, z: 0.14 + (k % 2) * 0.02 }));
  parts.push(xform(flowerBox(gw * 0.8, ['#E8443A', '#FF7A9C', '#E8443A']), { y: 0.88, z: 0.14 }));
  return mergeAll(parts);
}, { layer: 'wall' });
furn('fireplace', [2, 1], () => {
  const parts = [courses(box(1.9, 3.0, 0.7, '#B5AEA2', { z: -0.15 }), 12, [0.9, 1.05]), box(2.0, 0.12, 0.85, OAK_D, { y: 1.25, z: -0.05 }), box(1.95, 0.08, 0.9, LIMESTONE_D, { z: 0.1 })];
  parts.push(box(1.1, 0.9, 0.3, '#2A1E18', { y: 0.1, z: 0.06 }), box(1.25, 0.08, 0.34, '#8C8880', { y: 1.0, z: 0.06 }));
  // the fire: logs and flames (bright: they glow at night)
  for (const [x, r] of [[-0.18, 0.12], [0.18, -0.1]]) parts.push(xform(cyl(0.07, 0.07, 0.6, 6, '#6E4A2E'), { rz: Math.PI / 2, ry: r, x, y: 0.2, z: 0.1 }));
  for (let i = 0; i < 5; i++) parts.push(xform(blob(0.09 - i * 0.008, i % 2 ? '#FFB52E' : '#FF7A2A', { sy: 2.2, seed: i, detail: 0 }), { x: -0.24 + i * 0.12, y: 0.42 - (i % 2) * 0.05, z: 0.12 }));
  parts.push(xform(mergeAll([cyl(0.12, 0.1, 0.18, 10, '#2A2A2A'), cyl(0.006, 0.006, 0.4, 3, '#2A2A2A', { y: 0.18 }, 0)]), { x: 0.35, y: 0.3, z: 0.1 }));
  // the mantel: a clock, candles, a jug of dried flowers
  parts.push(xform(mergeAll([box(0.22, 0.26, 0.1, OAK), xform(cyl(0.07, 0.07, 0.02, 12, '#FFF8EC'), { rx: Math.PI / 2, y: 0.16, z: 0.06 })]), { y: 1.37, z: 0.05 }),
    xform(taper(0.24), { x: -0.55, y: 1.37, z: 0.05 }), xform(taper(0.18), { x: -0.45, y: 1.37, z: 0.08 }), xform(vase('#C9A06A', ['#E3C25E', '#C8643A', '#E3C25E']), { x: 0.6, y: 1.37, z: 0.05 }));
  return mergeAll(parts);
}, { glow: true });
furn('duet_table', [2, 2], () => {
  const parts = [...legs4(1.6, 1.0, 0.82, OAK_D, 0.08, 0.05), box(1.75, 0.07, 1.15, OAK_L, { y: 0.82 }), box(1.6, 0.12, 1.0, OAK, { y: 0.7 })];
  parts.push(xform(lathe([[0, 0], [0.16, 0.02], [0.22, 0.12], [0.2, 0.14], [0, 0.05]], 14, '#FFF8EC'), { x: -0.4, y: 0.89, z: -0.1 }), xform(blob(0.12, '#F3E6CC', { seed: 3, sy: 0.4 }), { x: -0.4, y: 0.96, z: -0.1 }));
  parts.push(xform(cyl(0.035, 0.035, 0.5, 8, OAK_L), { rz: Math.PI / 2, x: 0.3, y: 0.92, z: 0.15 }), xform(pieGeo(0.18, '#C81E3C'), { x: 0.45, y: 0.89, z: -0.25 }));
  parts.push(xform(box(0.5, 0.01, 0.4, '#FFFFFF'), { x: 0.1, y: 0.89, z: 0.2, ry: 0.3 }));
  for (const [x, z, ry] of [[-0.45, 0.85, Math.PI], [0.45, -0.85, 0]]) parts.push(xform(chair(OAK), { x, z, ry }));
  return mergeAll(parts);
});
// seating
furn('armchair', [1, 1], () => mergeAll([box(0.8, 0.12, 0.75, OAK_D, { y: 0.1 }), cushion(0.7, 0.2, 0.62, ROSE, 2).translate(0, 0.22, 0.04), xform(cushion(0.72, 0.7, 0.18, ROSE, 3), { y: 0.3, z: -0.3 }),
  ...[-1, 1].map((s) => xform(cushion(0.14, 0.45, 0.7, ROSE, 4 + s), { x: s * 0.36, y: 0.2 })), ...legs4(0.72, 0.66, 0.12, OAK_D, 0.04, 0.03),
  xform(cushion(0.5, 0.06, 0.45, '#F2E6CC', 6), { y: 0.43, z: 0.05, ry: 0.2 }), xform(blob(0.11, '#8FAE88', { seed: 5, sx: 1.4, sy: 0.6 }), { x: 0.2, y: 0.46, z: 0.15 })]));
furn('sofa', [3, 1], () => mergeAll([box(2.5, 0.14, 0.8, OAK_D, { y: 0.08 }), cushion(2.2, 0.22, 0.62, TEAL, 7).translate(0, 0.22, 0.05), xform(cushion(2.3, 0.6, 0.2, TEAL, 8), { y: 0.3, z: -0.32 }),
  ...[-1, 1].map((s) => xform(cushion(0.2, 0.5, 0.8, TEAL, 9), { x: s * 1.18, y: 0.2 })), ...legs4(2.4, 0.7, 0.1, OAK_D, 0.06, 0.035),
  ...[-0.7, 0, 0.7].map((x, i) => xform(cushion(0.42, 0.35, 0.12, ['#F2C46B', '#FFF8EC', ROSE][i], 10 + i), { x, y: 0.42, z: -0.18, rx: -0.25 })),
  xform(box(0.6, 0.02, 0.5, '#F4D2D6'), { x: 0.8, y: 0.45, z: 0.0, ry: 0.3 })]));
furn('window_seat', [2, 1], () => mergeAll([box(1.8, 0.42, 0.65, CREAM), box(1.82, 0.03, 0.67, OAK, { y: 0.42 }), cushion(1.7, 0.12, 0.58, SAGE, 12).translate(0, 0.45, 0),
  ...[-0.6, 0, 0.6].map((x) => box(0.5, 0.3, 0.02, '#E8DCC2', { x, y: 0.06, z: 0.33 })), ...[-0.55, 0.55].map((x, i) => xform(cushion(0.4, 0.34, 0.12, i ? ROSE : '#F2C46B', 13 + i), { x, y: 0.57, z: -0.22, rx: -0.2 })),
  xform(mergeAll([book('#C8473A', 0.2, 0.06), xform(book('#2E6FD0', 0.2, 0.06), { y: 0.06 })]).rotateZ(Math.PI / 2), { x: 0.2, y: 0.6 })]));
furn('footstool', [1, 1], () => mergeAll([...[0, 1, 2, 3].map((i) => ball(0.05, OAK_D, { x: Math.cos(i * 1.571 + 0.785) * 0.2, y: 0.04, z: Math.sin(i * 1.571 + 0.785) * 0.2 }, 0)),
  lathe([[0, 0], [0.27, 0], [0.31, 0.06], [0.32, 0.18], [0.29, 0.26], [0.18, 0.3], [0, 0.31]], 16, SAGE, 50).translate(0, 0.06, 0),
  ...[0, 1, 2, 3, 4, 5].map((i) => ball(0.018, BRASS, { x: Math.cos(i * 1.047) * 0.15, y: 0.355, z: Math.sin(i * 1.047) * 0.15 }, 0)), ball(0.02, BRASS, { y: 0.37 }, 0)]));
furn('rocking_horse', [1, 1], () => {
  // two bow rockers (the bottom arcs of a big circle), a crossbar each end, the horse on two posts
  const runner = (z) => clipAbove(xform(torus(1.4, 0.03, OAK_D, {}, 4, 64), { y: 1.45, z }), 0.2);
  return mergeAll([runner(-0.14), runner(0.14), ...[-0.42, 0.42].map((x) => box(0.05, 0.05, 0.32, OAK_D, { x, y: 0.1 })), ...[-0.22, 0.22].map((x) => cyl(0.025, 0.025, 0.42, 5, OAK_D, { x, y: 0.1 })),
    xform(carouselHorse('#E8D8B8', ROSE, '#8A5A35'), { y: 0.62, ry: Math.PI / 2, s: 1.15 })]);
});
// tables
furn('dining_table', [3, 2], () => {
  const parts = [...legs4(2.4, 1.1, 0.78, OAK_D, 0.1, 0.05), box(2.6, 0.07, 1.25, OAK_L, { y: 0.78 }), box(2.4, 0.1, 1.05, OAK, { y: 0.68 }), box(2.6, 0.01, 0.4, '#F4D2D6', { y: 0.855 })];
  parts.push(xform(vase('#FFFFFF', ['#FF7A9C', '#FFD21F', '#FFFFFF']), { y: 0.86 }), xform(teapot('#7FB8E6'), { x: 0.6, y: 0.86, z: 0.2 }), ...[-0.8, 0.8].map((x) => xform(teacup(), { x, y: 0.86, z: 0.3 })));
  for (const [x, z, ry] of [[-0.75, 0.75, Math.PI], [0, 0.75, Math.PI], [0.75, 0.75, Math.PI], [-0.75, -0.75, 0], [0, -0.75, 0], [0.75, -0.75, 0]]) parts.push(xform(chair(OAK), { x, z, ry }));
  return mergeAll(parts);
});
furn('side_table', [1, 1], () => mergeAll([lathe([[0.18, 0], [0.04, 0.05], [0.04, 0.55], [0.06, 0.6], [0, 0.6]], 8, OAK_D), cyl(0.3, 0.3, 0.04, 16, OAK_L, { y: 0.6 }), xform(teacup(ROSE), { x: 0.1, y: 0.64 }), xform(book('#2BB3A3', 0.22, 0.05).rotateZ(Math.PI / 2), { x: -0.08, y: 0.64 })]));
furn('writing_desk', [2, 1], () => mergeAll([...legs4(1.4, 0.6, 0.75, OAK_D, 0.05, 0.035), box(1.5, 0.05, 0.7, OAK, { y: 0.75 }), box(1.4, 0.16, 0.6, OAK_D, { y: 0.6 }),
  ...[-0.4, 0.4].map((x) => mergeAll([box(0.5, 0.1, 0.02, OAK_L, { x, y: 0.63, z: 0.3 }), ball(0.015, BRASS, { x, y: 0.68, z: 0.32 }, 0)])),
  box(1.3, 0.35, 0.25, OAK, { y: 0.8, z: -0.22 }), box(1.32, 0.03, 0.27, OAK_D, { y: 1.15, z: -0.22 }), ...[-0.3, 0, 0.3].map((x) => box(0.24, 0.12, 0.02, OAK_L, { x, y: 0.85, z: -0.09 })),
  xform(box(0.3, 0.005, 0.22, '#FFF8EC'), { y: 0.78, z: 0.1, ry: 0.2 }), cyl(0.03, 0.035, 0.05, 8, '#2A2A3A', { x: 0.45, y: 0.78, z: 0.05 }), xform(leaf(0.18, 0.04, '#FFFFFF', { seg: 1 }), { x: 0.47, y: 0.82, z: 0.05, rz: -0.3 }),
  xform(chair(OAK), { z: 0.55, ry: Math.PI })]));
furn('tea_trolley', [1, 1], () => mergeAll([box(0.7, 0.03, 0.45, OAK, { y: 0.72 }), box(0.7, 0.03, 0.45, OAK, { y: 0.3 }), ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => mergeAll([cyl(0.015, 0.015, 0.78, 5, BRASS, { x: x * 0.33, y: 0.05, z: z * 0.2 }), xform(cyl(0.05, 0.05, 0.02, 10, '#2A2A2A'), { rx: Math.PI / 2, x: x * 0.33, y: 0.05, z: z * 0.2 })])),
  xform(teapot('#FFFFFF'), { x: -0.15, y: 0.75 }), ...[0.15, 0.27].map((x, i) => xform(teacup(i ? ROSE : '#7FB8E6'), { x, y: 0.75, z: i * 0.1 - 0.05 })), xform(mergeAll([cyl(0.14, 0.1, 0.04, 12, '#FFFFFF'), ...[0, 1, 2, 3].map((i) => ball(0.03, '#C99A62', { x: Math.cos(i * 1.6) * 0.07, y: 0.05, z: Math.sin(i * 1.6) * 0.07 }, 0))]), { y: 0.33 })]));
// comfort and storage
furn('daybed', [3, 2], () => {
  const parts = [...legs4(2.3, 1.1, 0.25, OAK_D, 0.06, 0.04), box(2.4, 0.15, 1.2, OAK, { y: 0.25 }), cushion(2.3, 0.18, 1.1, '#FFF8EC', 15).translate(0, 0.4, 0),
    box(0.12, 0.8, 1.2, OAK, { x: -1.16, y: 0.25 }), box(0.12, 0.6, 1.2, OAK, { x: 1.16, y: 0.25 }), box(2.4, 0.5, 0.1, OAK, { y: 0.4, z: -0.58 })];
  // a patchwork quilt: squares in the farm's colours
  const qc = [ROSE, '#F2C46B', SAGE, '#7FB8E6', '#FFF8EC', '#E8848C'];
  for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) parts.push(box(0.25, 0.03, 0.25, qc[(i + j * 3) % qc.length], { x: -0.85 + i * 0.25, y: 0.58, z: -0.35 + j * 0.25 }));
  parts.push(...[-0.75, -0.3].map((x, i) => xform(cushion(0.42, 0.18, 0.32, i ? ROSE : '#FFFFFF', 16 + i), { x, y: 0.6, z: -0.3, rx: -0.4 })));
  return mergeAll(parts);
});
furn('hope_chest', [2, 1], () => mergeAll([box(1.4, 0.55, 0.6, OAK_D), box(1.44, 0.08, 0.64, OAK, { y: 0.55 }), box(1.36, 0.06, 0.56, OAK_L, { y: 0.63 }),
  ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => box(0.08, 0.6, 0.08, BRASS, { x: x * 0.68, z: z * 0.28 })), box(0.12, 0.14, 0.02, BRASS, { y: 0.45, z: 0.31 }),
  ...[-0.4, 0.4].map((x) => xform(flatFlower(ROSE, 0.1), { x, y: 0.28, z: 0.305, rx: Math.PI / 2 }))]));
furn('bookcase', [2, 1], () => {
  const parts = [box(1.6, 2.1, 0.06, OAK_D, { z: -0.17 }), ...[-0.78, 0.78].map((x) => box(0.06, 2.1, 0.4, OAK, { x })), box(1.66, 0.08, 0.42, OAK, { y: 2.1 })];
  const cols = ['#C8473A', '#2E6FD0', '#F2C230', '#3F8F36', '#9C7FD0', '#E8848C', '#8A5A35', '#2BB3A3', '#FFF8EC'];
  const rr = rng('books');
  for (let sh = 0; sh < 4; sh++) {
    const y = 0.1 + sh * 0.5;
    parts.push(box(1.5, 0.04, 0.36, OAK, { y }));
    let x = -0.72;
    while (x < 0.66) { const t = 0.04 + rr() * 0.04; const h = 0.26 + rr() * 0.14; parts.push(xform(book(cols[Math.floor(rr() * cols.length)], h, t), { x: x + t / 2, y: y + 0.04, z: 0.02, rz: rr() < 0.08 ? 0.3 : 0 })); x += t + 0.005; }
  }
  return mergeAll(parts);
});
furn('dresser', [2, 1], () => mergeAll([box(1.4, 0.85, 0.5, '#9CC3D6', { y: 0.1 }), box(1.46, 0.05, 0.55, CREAM, { y: 0.95 }), ...legs4(1.36, 0.46, 0.1, OAK_D, 0.04, 0.03),
  ...[0.2, 0.47, 0.74].flatMap((y) => [-0.34, 0.34].map((x) => mergeAll([box(0.62, 0.22, 0.02, '#B5D6E4', { x, y, z: 0.25 }), ball(0.02, BRASS, { x, y: y + 0.11, z: 0.27 }, 0)]))),
  xform(mergeAll([box(0.06, 0.6, 0.06, CREAM, { x: -0.35 }), box(0.06, 0.6, 0.06, CREAM, { x: 0.35 }), xform(frameOnWall(0.6, 0.55, { frame: CREAM, bands: ['#D6EEF5', '#BFE3EA'], y: 0.55 }), {})]), { y: 1.0, z: -0.15 }),
  xform(lathe([[0, 0], [0.07, 0], [0.09, 0.08], [0.06, 0.18], [0.07, 0.22], [0, 0.22]], 10, '#FFFFFF'), { x: 0.45, y: 0.98 }), xform(vase('#E8848C'), { x: -0.45, y: 0.98 })]));
// kitchen corner
furn('range_stove', [2, 1], () => mergeAll([box(1.5, 0.8, 0.65, '#2E2A2A', { y: 0.08 }), ...legs4(1.4, 0.55, 0.08, '#2E2A2A', 0.05, 0.035), box(1.55, 0.04, 0.7, '#3E3A3A', { y: 0.88 }),
  ...[-0.35, 0.35].map((x) => mergeAll([box(0.5, 0.4, 0.02, '#3A3636', { x, y: 0.2, z: 0.33 }), box(0.3, 0.03, 0.03, BRASS, { x, y: 0.52, z: 0.35 })])), box(1.5, 0.04, 0.04, BRASS, { y: 0.8, z: 0.34 }),
  ...[-0.4, 0.15].map((x) => cyl(0.16, 0.16, 0.02, 12, '#1E1A1A', { x, y: 0.92 })), xform(lathe([[0, 0], [0.12, 0], [0.14, 0.16], [0.08, 0.2], [0, 0.22]], 10, '#C8473A'), { x: -0.4, y: 0.93 }),
  xform(mergeAll([cyl(0.13, 0.12, 0.15, 12, '#8E9AA4'), xform(cyl(0.012, 0.012, 0.3, 4, '#5E5A55'), { rz: Math.PI / 2, x: 0.25, y: 0.12 })]), { x: 0.15, y: 0.93 }),
  cyl(0.08, 0.08, 1.9, 8, '#2E2A2A', { x: 0.55, y: 0.9, z: -0.2 }), cyl(0.1, 0.1, 0.06, 8, '#3E3A3A', { x: 0.55, y: 1.5, z: -0.2 })]), { glow: true });
furn('kitchen_hutch', [2, 1], () => {
  const parts = [box(1.5, 0.85, 0.55, SAGE, { y: 0.05 }), box(1.56, 0.05, 0.6, OAK, { y: 0.9 }), box(1.4, 1.2, 0.04, SAGE, { y: 0.95, z: -0.2 }), ...[-0.72, 0.72].map((x) => box(0.06, 1.25, 0.3, SAGE, { x, y: 0.95, z: -0.1 })),
    box(1.5, 0.08, 0.32, OAK, { y: 2.18, z: -0.08 }), ...[1.35, 1.75].map((y) => box(1.4, 0.04, 0.26, OAK_L, { y, z: -0.1 }))];
  for (const y of [1.39, 1.79]) for (let i = 0; i < 5; i++) parts.push(xform(mergeAll([cyl(0.12, 0.12, 0.015, 14, '#FFFFFF'), cyl(0.08, 0.08, 0.016, 14, i % 2 ? '#2E6FD0' : '#E8848C')]), { x: -0.56 + i * 0.28, y: y + 0.13, z: -0.17, rx: Math.PI / 2 - 0.15 }));
  for (let i = 0; i < 4; i++) parts.push(xform(teacup(i % 2 ? '#7FB8E6' : '#FFFFFF'), { x: -0.45 + i * 0.3, y: 0.94, z: 0.0 }));
  parts.push(...[-0.36, 0.36].map((x) => mergeAll([box(0.6, 0.65, 0.02, '#A8C5A2', { x, y: 0.15, z: 0.28 }), ball(0.02, BRASS, { x: x + (x < 0 ? 0.22 : -0.22), y: 0.5, z: 0.3 }, 0)])));
  return mergeAll(parts);
});
furn('butter_churn', [1, 1], () => mergeAll([courses(lathe([[0, 0], [0.22, 0], [0.2, 0.6], [0.16, 0.7], [0, 0.7]], 12, OAK_L, 35), 4, [0.88, 1.06]), torus(0.215, 0.02, BRASS, { y: 0.12, rx: Math.PI / 2 }, 3, 12), torus(0.2, 0.02, BRASS, { y: 0.55, rx: Math.PI / 2 }, 3, 12),
  cyl(0.17, 0.17, 0.03, 12, OAK, { y: 0.7 }), cyl(0.02, 0.02, 0.6, 5, OAK_D, { y: 0.72 }), cyl(0.04, 0.04, 0.05, 6, OAK_D, { y: 1.3 })]));
// music
furn('piano', [2, 1], () => mergeAll([box(1.5, 1.3, 0.55, '#3A2418', { y: 0.05 }), box(1.56, 0.06, 0.6, '#4A3020', { y: 1.35 }), box(1.4, 0.1, 0.28, '#3A2418', { y: 0.72, z: 0.32 }),
  box(1.3, 0.025, 0.12, '#FFFFF4', { y: 0.82, z: 0.4 }), ...Array.from({ length: 18 }, (_, i) => (i % 7 === 2 || i % 7 === 6 ? null : box(0.035, 0.02, 0.07, '#1A1A1A', { x: -0.6 + i * 0.07, y: 0.845, z: 0.37 }))).filter(Boolean),
  ...legs4(1.4, 0.5, 0.06, '#3A2418', 0.06, 0.04), box(0.6, 0.35, 0.02, '#FFF8EC', { y: 0.95, z: 0.29, rx: -0.2 }),
  xform(mergeAll([cyl(0.08, 0.1, 0.03, 10, BRASS), cyl(0.012, 0.012, 0.28, 5, BRASS, { y: 0.03 }), box(0.3, 0.015, 0.015, BRASS, { y: 0.3 }), ...[-0.14, 0, 0.14].map((x) => xform(taper(0.14), { x, y: 0.31 }))]), { x: -0.5, y: 1.4 }),
  xform(mergeAll([...legs4(0.6, 0.35, 0.45, '#3A2418', 0.04, 0.03), cushion(0.62, 0.08, 0.36, '#7A2E3A', 18).translate(0, 0.45, 0)]), { z: 0.75 })]), { glow: true });
furn('gramophone', [1, 1], () => mergeAll([box(0.5, 0.65, 0.45, OAK_D), box(0.54, 0.05, 0.49, OAK, { y: 0.65 }), cyl(0.18, 0.18, 0.03, 16, '#1A1A1A', { y: 0.72 }), cyl(0.05, 0.05, 0.035, 10, '#E8848C', { y: 0.72 }),
  xform(cyl(0.015, 0.015, 0.3, 4, BRASS), { y: 0.75, x: 0.15, rz: 0.4 }), xform(lathe([[0.02, 0], [0.05, 0.15], [0.12, 0.3], [0.26, 0.42], [0.3, 0.44], [0.29, 0.45], [0, 0.2]], 12, BRASS, 40), { x: 0.05, y: 0.95, rz: -1.0, z: -0.05 })]));
// lights and plants
furn('floor_lamp', [1, 1], () => mergeAll([cyl(0.18, 0.2, 0.04, 12, BRASS), cyl(0.02, 0.02, 1.45, 6, BRASS, { y: 0.04 }), lathe([[0.32, 0], [0.25, 0.3], [0.12, 0.32], [0, 0.32]], 14, '#F7E6C4', 30).translate(0, 1.32, 0),
  ...Array.from({ length: 14 }, (_, i) => cyl(0.006, 0.006, 0.08, 3, ROSE, { x: Math.cos(i * 0.449) * 0.31, y: 1.24, z: Math.sin(i * 0.449) * 0.31 }, 0)), ball(0.06, '#FFF3C4', { y: 1.42 }, 0)]), { glow: true });
furn('candle_stand', [1, 1], () => mergeAll([cyl(0.14, 0.18, 0.05, 10, BRASS), lathe([[0.04, 0], [0.02, 0.2], [0.035, 0.5], [0.02, 0.9], [0.04, 1.1], [0, 1.1]], 8, BRASS).translate(0, 0.05, 0),
  box(0.5, 0.02, 0.03, BRASS, { y: 1.15 }), ...[-0.22, 0, 0.22].map((x) => mergeAll([cyl(0.04, 0.03, 0.04, 8, BRASS, { x, y: 1.16 }), xform(taper(0.22), { x, y: 1.2 })]))]), { glow: true });
furn('fern_pot', [1, 1], () => {
  const parts = [lathe([[0.1, 0], [0.15, 0.4], [0.12, 0.45], [0.0, 0.45]], 8, OAK_D).translate(0, 0, 0), lathe([[0, 0], [0.16, 0], [0.2, 0.22], [0.18, 0.24], [0, 0.2]], 12, TERRACOTTA).translate(0, 0.45, 0)];
  for (let i = 0; i < 14; i++) parts.push(xform(leaf(0.42 + (i % 3) * 0.08, 0.11, i % 2 ? LEAF : LEAF_L, { bend: 0.75, seg: 3 }), { ry: (i / 14) * Math.PI * 2 + (i % 2) * 0.2, y: 0.66, rx: 0.35 + (i % 3) * 0.15 }));
  return mergeAll(parts);
}, { doubleSided: true });
furn('lemon_pot', [1, 1], () => {
  const g = orangeTub(1.0);
  const c = g.getAttribute('color'); const t = lin('#F5D63B'); const o = lin('#F28C1E');
  for (let i = 0; i < c.count; i++) if (Math.abs(c.getX(i) - o.r) < 0.02 && Math.abs(c.getY(i) - o.g) < 0.02) c.setXYZ(i, t.r, t.g, t.b);
  return g;
});
furn('pet_bed', [1, 1], () => mergeAll([lathe([[0, 0], [0.38, 0], [0.42, 0.16], [0.36, 0.2], [0.3, 0.06], [0, 0.06]], 16, '#C99A62'), cushion(0.56, 0.08, 0.56, ROSE, 19).translate(0, 0.05, 0),
  xform(mergeAll([cyl(0.025, 0.025, 0.14, 6, '#FFF8EC'), ...[-1, 1].flatMap((s) => [ball(0.03, '#FFF8EC', { y: s * 0.07, x: 0.02 }, 0), ball(0.03, '#FFF8EC', { y: s * 0.07, x: -0.02 }, 0)])]), { x: 0.3, y: 0.05, z: 0.32, rz: Math.PI / 2, ry: 0.5 })]));
// rugs (floor)
function braid(rx, rz, rings, cols, y = 0.01) { return mergeAll(Array.from({ length: rings }, (_, i) => xform(torus(1, 0.5 / rings, cols[i % cols.length], {}, 3, 28), { rx: Math.PI / 2, y, sx: rx * (1 - i / rings), sy: rz * (1 - i / rings), sz: 0.04 }))); }
furn('rag_rug', [2, 2], () => braid(0.88, 0.7, 7, [ROSE, '#F2C46B', SAGE, '#7FB8E6', '#FFF8EC']), { layer: 'floor' });
furn('braided_rug', [3, 3], () => mergeAll([braid(1.4, 1.4, 9, ['#8A5A35', '#C99A62', '#E8848C', '#F3E6CC', SAGE]), cyl(0.12, 0.12, 0.02, 12, '#8A5A35')]), { layer: 'floor' });
furn('hall_runner', [1, 3], () => mergeAll([box(0.8, 0.015, 2.8, '#9A3A3A'), box(0.66, 0.017, 2.66, '#C8643A'), ...Array.from({ length: 7 }, (_, i) => xform(box(0.2, 0.019, 0.2, '#F2C46B'), { z: -1.2 + i * 0.4, ry: Math.PI / 4 })),
  ...[-1.4, 1.4].flatMap((z) => Array.from({ length: 8 }, (_, i) => box(0.015, 0.012, 0.06, '#F3E6CC', { x: -0.35 + i * 0.1, z: z + (z > 0 ? 0.03 : -0.03) })))]), { layer: 'floor' });
// walls
furn('valley_painting', [2, 1], () => {
  const parts = [box(1.5, 1.0, 0.05, BRASS, { y: 1.15 }), box(1.36, 0.86, 0.02, '#BFE3F5', { y: 1.22, z: 0.04 })];
  parts.push(xform(P(new THREE.CircleGeometry(0.5, 12, 0, Math.PI), '#7DB04A'), { x: -0.3, y: 1.35, z: 0.055, sx: 1.2, sy: 0.5 }), xform(P(new THREE.CircleGeometry(0.55, 12, 0, Math.PI), '#5E9E3A'), { x: 0.35, y: 1.3, z: 0.056, sx: 1.1, sy: 0.45 }),
    box(1.36, 0.3, 0.021, '#8FC86A', { y: 1.22, z: 0.057 }), xform(box(1.36, 0.06, 0.022, '#7DB9B5'), { y: 1.3, z: 0.058, rz: 0.05 }), box(0.12, 0.1, 0.023, '#C8473A', { x: 0.3, y: 1.38, z: 0.06 }), xform(P(new THREE.ConeGeometry(0.1, 0.06, 4), '#7A4B3A'), { x: 0.3, y: 1.51, z: 0.06, sz: 0.2 }),
    xform(P(new THREE.CircleGeometry(0.06, 10), '#FFE27A'), { x: -0.5, y: 1.52, z: 0.058 }));
  return mergeAll(parts);
}, { layer: 'wall' });
furn('cuckoo_clock', [1, 1], () => mergeAll([box(0.4, 0.45, 0.16, OAK_D, { y: 1.55 }), xform(gable(0.24, 0.52, 0.2, OAK), { ry: Math.PI / 2, y: 2.0 }), xform(cyl(0.12, 0.12, 0.02, 12, '#FFF8EC'), { rx: Math.PI / 2, y: 1.72, z: 0.09 }),
  box(0.08, 0.08, 0.02, '#3A2A1A', { y: 1.88, z: 0.08 }), ...[-0.1, 0.1].map((x) => mergeAll([cyl(0.004, 0.004, 0.5, 3, BRASS, { x, y: 1.05 }, 0), xform(cone(0.03, 0.12, 6, '#7A5236'), { x, y: 0.95, rx: Math.PI })])),
  ...[-0.22, 0.22].map((x) => xform(leaf(0.18, 0.1, '#3F8F36', { seg: 1 }), { x, y: 1.95, z: 0.08, rz: x > 0 ? -0.9 : 0.9 }))]), { layer: 'wall' });
furn('quilt_hanging', [2, 1], () => {
  const parts = [xform(cyl(0.02, 0.02, 1.7, 6, OAK), { rz: Math.PI / 2, y: 2.2, z: 0.05 }), ...[-0.85, 0.85].map((x) => ball(0.035, OAK_D, { x, y: 2.2, z: 0.05 }, 0))];
  const qc = [ROSE, '#F2C46B', SAGE, '#7FB8E6', '#FFF8EC', '#9C7FD0'];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) parts.push(box(0.25, 0.25, 0.03, qc[(i * 2 + j) % qc.length], { x: -0.625 + i * 0.25, y: 0.95 + j * 0.25, z: 0.05 }));
  return mergeAll(parts);
}, { layer: 'wall' });
furn('oval_mirror', [1, 1], () => mergeAll([xform(frameOnWall(0.55, 0.75, { frame: GOLD, bands: ['#D6EEF5', '#EAF6FA'], y: 1.6, oval: true }), {}), ball(0.04, GOLD, { y: 2.0, z: 0.04 }, 0)]), { layer: 'wall' });
furn('plate_rack', [2, 1], () => {
  const parts = [box(1.6, 0.05, 0.18, OAK, { y: 1.3 }), box(1.6, 0.05, 0.18, OAK, { y: 1.75 }), box(1.6, 0.6, 0.03, OAK_D, { y: 1.3, z: -0.07 }), ...[-0.8, 0.8].map((x) => box(0.05, 0.65, 0.18, OAK, { x, y: 1.28 }))];
  for (let i = 0; i < 5; i++) parts.push(xform(mergeAll([cyl(0.14, 0.14, 0.015, 14, '#FFFFFF'), cyl(0.1, 0.1, 0.016, 14, ['#2E6FD0', '#E8848C', SAGE][i % 3]), cyl(0.05, 0.05, 0.017, 10, '#FFFFFF')]), { x: -0.6 + i * 0.3, y: 1.48, z: -0.02, rx: Math.PI / 2 - 0.2 }));
  return mergeAll(parts);
}, { layer: 'wall' });
furn('couple_photo', [1, 1], () => {
  const g = frameOnWall(0.42, 0.52, { frame: OAK_D, bands: ['#BFE3F5', '#BFE3F5', '#8FC86A'], y: 1.55 });
  const two = [-0.07, 0.07].map((x, i) => mergeAll([box(0.07, 0.15, 0.01, i ? '#FF7A6B' : '#2BB3A3', { x, y: 1.43, z: 0.055 }), ball(0.04, '#F2C29A', { x, y: 1.63, z: 0.055, sz: 0.3 }, 0)]));
  return mergeAll([g, ...two, xform(heartGeo(0.05, '#E84A5F'), { y: 1.72, z: 0.056 })]);
}, { layer: 'wall' });
furn('hazel_portrait', [1, 1], () => mergeAll([xform(frameOnWall(0.5, 0.65, { frame: GOLD, bands: ['#E8D8C0', null], y: 1.6, oval: true }), {}),
  xform(mergeAll([box(0.18, 0.2, 0.01, '#9C7FB8', { y: -0.2 }), ball(0.08, '#F2C29A', { sz: 0.3 }, 1), ball(0.09, '#D9D4CC', { y: 0.04, z: -0.005, sz: 0.3 }, 1), ball(0.05, '#D9D4CC', { y: 0.12, z: -0.005, sz: 0.3 }, 0)]), { y: 1.62, z: 0.04 })]), { layer: 'wall' });
furn('memory_frame', [2, 1], () => mergeAll([box(1.5, 0.9, 0.06, GOLD, { y: 1.2 }), box(1.4, 0.8, 0.07, GOLD_D, { y: 1.25 }), box(1.3, 0.7, 0.02, '#FFD7A0', { y: 1.3, z: 0.06 }),
  xform(P(new THREE.CircleGeometry(0.55, 14, 0, Math.PI), '#7DB04A'), { y: 1.3, z: 0.075, sx: 1.15, sy: 0.4 }), xform(P(new THREE.CircleGeometry(0.12, 12), '#FF9F43'), { y: 1.48, z: 0.072 }),
  xform(mergeAll([box(0.3, 0.02, 0.01, '#8A5A35'), ...[-0.06, 0.06].map((x) => box(0.04, 0.08, 0.01, '#3A2A1A', { x, y: 0.02 }))]), { x: 0.35, y: 1.36, z: 0.078 })]), { layer: 'wall' });

/** The room shell (12 x 8 m): oak floorboards, a cream back wall and left wall over a sage wainscot with a dado rail and
 *  skirting, beam ends resting on the walls, a doormat by the door (x 5-6 of the front). Origin at the room's
 *  corner tile (0, 0) north-west: the floor spans x 0..12, z 0..8 (render-world's room grid). */
function roomShell() {
  const W = 12; const D = 8; const H = 3.2; const parts = [];
  for (let i = 0; i < W / 0.3; i++) parts.push(box(0.3, 0.06, D, i % 3 === 0 ? '#C08A52' : i % 3 === 1 ? '#B98048' : '#C99258', { x: i * 0.3 + 0.15, y: -0.06, z: D / 2 }));
  for (let i = 0; i < 24; i++) parts.push(box(0.012, 0.062, 0.3, '#8A5A35', { x: (i % 12) + 0.7 * (i > 11 ? 1 : 0.3), y: -0.059, z: 0.8 + (i * 1.37) % 7 }));
  const wall = (len, rot, x0, z0) => {
    const w = [box(len, H, 0.12, '#F1E2C6', { x: len / 2, z: -0.06 }), box(len, 1.0, 0.04, SAGE, { x: len / 2, z: 0.02 }), box(len, 0.06, 0.08, CREAM, { x: len / 2, y: 1.0, z: 0.04 }),
      box(len, 0.14, 0.05, '#7A9A74', { x: len / 2, z: 0.04 }), box(len, 0.12, 0.1, CREAM, { x: len / 2, y: H - 0.12, z: 0.0 })];
    for (let i = 0; i < len / 0.5; i++) w.push(box(0.02, 0.86, 0.045, '#9DBA96', { x: 0.25 + i * 0.5, y: 0.12, z: 0.03 }));
    // a faint wallpaper sprig pattern
    for (let i = 0; i < len / 0.6; i++) for (let j = 0; j < 3; j++) w.push(xform(flatFlower(j % 2 ? '#E8C8B8' : '#D8D0A8', 0.05), { x: 0.3 + i * 0.6 + (j % 2) * 0.3, y: 1.4 + j * 0.55, z: 0.001, rx: Math.PI / 2 }));
    return xform(mergeAll(w), { x: x0, z: z0, ry: rot });
  };
  parts.push(wall(W, 0, 0, 0), wall(D, -Math.PI / 2, 0, 0));
  // beam ends resting on the back wall (the room is a dollhouse cut: no beams across the view)
  for (let i = 0; i < 6; i++) parts.push(box(0.22, 0.24, 0.6, '#7A5236', { x: 1 + i * 2, y: H - 0.24, z: 0.3 }), box(0.18, 0.3, 0.12, '#6A4630', { x: 1 + i * 2, y: H - 0.54, z: 0.06 }));
  for (let i = 0; i < 4; i++) parts.push(box(0.6, 0.24, 0.22, '#7A5236', { x: 0.3, y: H - 0.24, z: 1 + i * 2 }));
  parts.push(box(1.6, 0.02, 0.9, '#8A6A42', { x: 6, y: 0.0, z: 7.4 }), box(1.4, 0.022, 0.75, '#A8844F', { x: 6, y: 0.0, z: 7.4 }));
  return mergeAll(parts);
}

for (const fu of FURN) {
  // the content's catalog decides the size and the layer (shared/content/farmhouse.js FURNITURE): a builder adapts its
  // width where it can, and anything still too big shrinks to fit (1 interior tile = 1 m)
  const cd = CONTENT_TABLES.furniture && CONTENT_TABLES.furniture.get(fu.id);
  const size = cd ? cd.size : fu.size; const layer = cd ? cd.layer : (fu.extra.layer || 'object');
  job(`furniture:${fu.id}`, `furniture/${fu.id}.glb`, { family: 'furniture', def: fu.id, footprint: size, layer, ...(fu.extra.glow || (cd && cd.glow) ? { glow: true } : {}),
    ...(fu.extra.doubleSided ? { doubleSided: true } : {}) },
    async () => {
      let g = await fu.build({ w: size[0], d: size[1], layer });
      let b = bounds(g);
      const kx = (size[0] * 0.97) / (b.max.x - b.min.x); const kz = layer === 'wall' ? Infinity : (size[1] * 0.97) / (b.max.z - b.min.z);
      const k = Math.min(1, kx, kz);
      if (k < 1) { g.scale(k, k, k); b = bounds(g); }
      g.translate(-(b.min.x + b.max.x) / 2, 0, layer === 'wall' ? -b.min.z : 0);
      if (layer !== 'wall' && b.min.y > 0.01) g.translate(0, -b.min.y, 0);
      return g.getAttribute('sway') ? g : sway(g, { rigid: true });
    });
}
job('interior:room', 'furniture/room.glb', { family: 'interior', footprint: [12, 8], origin: 'corner' }, async () => sway(roomShell(), { rigid: true }));


// ---- The Hollow Village grows (Town Projects 5-24, M2; render-world's town-view stands `town:<id>` on its slot,
//      yaw PI facing the farm): each landmark keeps inside a 7.2 m square (LANDMARK_HALF), its own silhouette for
//      the far bank, 2-5 props and villagers; the waterside ones (lighthouse, millpond bridge, watermill, boathouse,
//      harbour inn) reach out over the water at +z like the ferry landing. `town:construction:<id>` is each one's
//      half-built frame in its scaffold, `town:festival_pavilion:<1-8>` the Festival Pavilion tier by tier.
const PASTEL = { pink: '#F6D2D6', mint: '#CFE8D2', sky: '#CFE2F2', butter: '#F7E6B0', lilac: '#E2D6F0' };
function lighthouse() {
  const parts = [];
  for (let i = 0; i < 9; i++) parts.push(xform(blob(0.7 + (i % 3) * 0.2, i % 2 ? '#9C958A' : '#B5AEA2', { seed: 120 + i, sy: 0.55, detail: 1 }), { x: Math.cos(i * 0.9) * 1.6, y: 0.1, z: 1.2 + Math.sin(i * 0.9) * 1.2 }));
  // the tower: white with red bands, a gallery, the lantern room and its red cap
  const T = 7.4;
  parts.push(stripesY(lathe([[1.15, 0], [1.05, T * 0.5], [0.85, T], [0, T]], 12, '#FFFFFF', 40), 5, ['#FFFFFF', '#D9433A']).translate(0, 0, 0.6));
  parts.push(cyl(1.15, 1.15, 0.14, 12, '#3A3A3A', { y: T, z: 0.6 }), railing(polygon(12, 1.1), { h: 0.5, post: '#3A3A3A', rail: '#3A3A3A', step: 0.5 }).translate(0, T + 0.14, 0.6));
  parts.push(cyl(0.62, 0.62, 0.9, 10, '#FFE08A', { y: T + 0.14, z: 0.6 }), ...around(6, 0.63, () => box(0.05, 0.9, 0.05, '#3A3A3A'), { y: T + 0.14, face: false }).map((g) => g.translate(0, 0, 0.6)),
    xform(cone(0.85, 0.75, 10, '#D9433A'), { y: T + 1.04, z: 0.6 }), ball(0.12, '#3A3A3A', { y: T + 1.85, z: 0.6 }, 0));
  parts.push(xform(doorBox(0.7, 1.4, '#3E6E8E'), { y: 0.0, z: 1.75 }), ...[2.4, 4.2, 5.8].map((y) => xform(windowBox(0.3, 0.42), { y, z: 0.6 + 1.08 - (y / T) * 0.25 })));
  // the keeper's cottage at the foot, a bench and a lamp
  parts.push(xform(cottage(1), { x: -2.0, z: -1.4, s: 0.7, ry: 0.4 }), xform(benchGeo(1.2), { x: 1.9, z: -1.6, ry: -0.5 }), xform(villager(5), { x: 1.4, z: 2.4, ry: 0.3 }));
  return mergeAll(parts);
}
/** Stripe a lathe/cylinder in horizontal bands (n bands over its height). */
function stripesY(g, n, cols) {
  const x = g.index ? g.toNonIndexed() : g; const p = x.getAttribute('position'); const c = x.getAttribute('color');
  x.computeBoundingBox(); const b = x.boundingBox; const lc = cols.map((h) => lin(h));
  for (let f = 0; f < p.count / 3; f++) {
    const y = (p.getY(f * 3) + p.getY(f * 3 + 1) + p.getY(f * 3 + 2)) / 3;
    const col = lc[Math.floor(((y - b.min.y) / (b.max.y - b.min.y + 1e-6)) * n) % lc.length];
    for (let j = 0; j < 3; j++) c.setXYZ(f * 3 + j, col.r, col.g, col.b);
  }
  return x;
}
function villageCarousel() {
  return mergeAll([xform(carousel(), { s: 0.78 }), ...[[-3.0, 2.2, 0.8], [3.0, 2.4, -0.8]].map(([x, z, ry]) => xform(benchGeo(1.3), { x, z, ry: ry + Math.PI })),
    xform(villager(2), { x: -2.4, z: 2.9 }), xform(villager(4), { x: 2.6, z: -2.6, ry: 2 }), xform(lampPost(2.3), { x: 3.1, z: 3.1 })]);
}
function villageBakery() {
  const W = 4.6; const D = 3.4; const H = 2.5;
  const parts = [timberHouse(W, H, D, { plaster: '#F7E6C4' }), xform(pitchedRoof(W, D, 1.5, '#B86740', { oh: 0.3, gableHex: '#F7E6C4' }), { y: 0.3 + H }), xform(stack(1.3, 0.5), { x: 1.4, y: 0.3 + H + 0.5, z: -0.6 })];
  parts.push(xform(doorBox(0.85, 1.7, '#7A4B2C'), { x: 1.4, y: 0.3, z: D / 2 + 0.03 }), xform(awning(2.6, 0.9, ['#FFF8EC', '#B86740'], 7), { x: -0.8, y: 0.3 + H - 0.15, z: D / 2 }));
  // the bay window full of loaves, a giant pretzel on a bracket, a bread cart out front
  parts.push(box(2.3, 0.4, 0.5, '#C99A62', { x: -0.8, y: 0.3, z: D / 2 + 0.25 }), box(2.2, 1.1, 0.4, K.glass, { x: -0.8, y: 0.7, z: D / 2 + 0.25 }));
  for (let i = 0; i < 6; i++) parts.push(xform(blob(0.13, i % 2 ? '#D99A52' : '#C8843E', { seed: 130 + i, sx: 1.6, sy: 0.7, detail: 0 }), { x: -1.7 + i * 0.36, y: 0.82, z: D / 2 + 0.46 }));
  const pretzel = mergeAll([tube([[-0.3, 0, 0], [-0.32, 0.25, 0], [0, 0.4, 0], [0.32, 0.25, 0], [0.3, 0, 0], [0.05, 0.12, 0], [-0.15, 0.32, 0]], 0.07, '#C8843E', { seg: 5, steps: 24 }),
    tube([[0.3, 0, 0], [-0.05, 0.12, 0], [0.15, 0.32, 0]], 0.07, '#C8843E', { seg: 5, steps: 8 })]);
  parts.push(xform(mergeAll([box(0.06, 0.06, 0.9, K.iron, { z: 0.45 }), xform(pretzel, { y: -0.6, z: 0.85 })]), { x: 2.0, y: 2.6, z: D / 2 }));
  parts.push(xform(mergeAll([box(1.2, 0.5, 0.7, '#C8473A', { y: 0.45 }), ...[-0.4, 0.4].map((x) => xform(torus(0.3, 0.05, K.timber, {}, 4, 12), { x, y: 0.35, z: 0.38 })),
    ...[0, 1, 2, 3].map((i) => xform(blob(0.12, '#D99A52', { seed: 140 + i, sx: 1.7, sy: 0.6, detail: 0 }), { x: -0.35 + i * 0.24, y: 1.0 }))]), { x: -2.6, z: D / 2 + 1.5, ry: 0.3 }));
  parts.push(xform(villager(3), { x: 0.4, z: D / 2 + 1.4, ry: 2.6 }), xform(villager(0), { x: -0.6, z: D / 2 + 1.8, ry: 0.3 }));
  const out = mergeAll(parts); out.anchors = { chimney: [1.4, r3(0.3 + H + 1.8), -0.6] }; return out;
}
function millpondBridge() {
  const parts = [xform(blob(3.3, '#8CB45A', { seed: 81, sy: 0.03, detail: 2, amp: 0.08 }), { z: 0.8 }), xform(waterSurface(pondOutline(3.0, 0.1, 0.05, 2), { y: 0.14 }), { z: 0.8 })];
  // a stone humpback bridge across the pond (along x), its arch, parapets, two lamps at the ends
  const L = 6.4;
  for (let i = 0; i < 13; i++) { const t = i / 12 - 0.5; const y = 0.35 + 1.0 * (1 - (2 * t) ** 2); parts.push(box(0.5, 0.25, 1.6, i % 2 ? '#B5AEA2' : '#A7A096', { x: t * L, y: y - 0.2, z: 0.6 })); }
  for (const z of [-0.15, 1.35]) for (let i = 0; i < 13; i++) { const t = i / 12 - 0.5; const y = 0.35 + 1.0 * (1 - (2 * t) ** 2); parts.push(box(0.5, 0.45, 0.16, '#C4BCAE', { x: t * L, y, z })); }
  parts.push(clipBelow(xform(torus(1.1, 0.2, '#8C857A', {}, 4, 16), { y: 0.05, z: 0.6, sz: 4 }), 0.05).translate(0, 0, 0));
  for (const x of [-L / 2 - 0.2, L / 2 + 0.2]) parts.push(xform(lampPost(1.9), { x, z: -0.2 }));
  parts.push(...[[-2.4, 2.2], [2.1, 2.6], [-1.0, 3.0]].map(([x, z], i) => xform(lilyPad(0.3), { x, y: 0.07, z, ry: i })), ...stoneRim(pondOutline(3.0, 0.1, 0.05, 2), 20, { seed: 31, size: 0.3, y: 0.08 }).map((g) => g.translate(0, 0, 0.8)));
  parts.push(xform(villager(1), { x: 0.3, y: 1.35, z: 0.5 }), xform(villager(5), { x: -0.5, y: 1.3, z: 0.7, ry: Math.PI }));
  return mergeAll(parts);
}
function library() {
  const W = 5.4; const D = 3.8; const H = 3.0; const LIME = '#E8DFCC';
  const parts = [box(W + 0.6, 0.4, D + 0.6, LIMESTONE_D), box(W, H, D, LIME, { y: 0.4 }), box(W + 0.3, 0.3, D + 0.3, LIMESTONE, { y: 0.4 + H })];
  parts.push(xform(pitchedRoof(W + 0.2, D + 0.2, 1.0, '#4F6386', { oh: 0.15, gableHex: LIME, trim: LIMESTONE }), { y: 0.7 + H }));
  // a portico: four columns, a pediment, three broad steps; tall arched windows; a little dome on top
  for (let i = 0; i < 4; i++) parts.push(lathe([[0.22, 0], [0.18, 0.15], [0.16, 2.6], [0.22, 2.75], [0, 2.75]], 10, '#FBF6EC', 40).translate(-1.35 + i * 0.9, 0.4, D / 2 + 0.8));
  parts.push(box(3.4, 0.25, 1.2, LIMESTONE, { y: 3.15, z: D / 2 + 0.5 }));
  const ped = new THREE.Shape(); ped.moveTo(-1.85, 0); ped.lineTo(1.85, 0); ped.lineTo(0, 0.85); ped.closePath();
  parts.push(xform(P(new THREE.ExtrudeGeometry(ped, { depth: 0.25, bevelEnabled: false }), '#FBF6EC'), { y: 3.4, z: D / 2 + 0.95 }));
  for (let k = 0; k < 3; k++) parts.push(box(3.6 - k * 0.3, 0.14, 0.5, LIMESTONE, { y: k * 0.14, z: D / 2 + 1.6 - k * 0.3 }));
  for (const x of [-2.0, 2.0]) parts.push(xform(windowBox(0.7, 1.5, { frame: '#FBF6EC' }), { x, y: 1.1, z: D / 2 + 0.03 }));
  parts.push(xform(doorBox(1.0, 2.0, '#2E4A3A'), { y: 0.4, z: D / 2 + 0.03 }));
  parts.push(cyl(0.9, 0.9, 0.6, 12, LIME, { y: 1.7 + H }), xform(lathe([[1.0, 0], [0.9, 0.4], [0.55, 0.75], [0, 0.85]], 12, '#5E9E8E', 40), { y: 2.3 + H }), ball(0.12, GOLD, { y: 3.2 + H }, 0));
  // an open book on a lectern sign, benches, a reader
  parts.push(xform(mergeAll([cyl(0.04, 0.05, 1.0, 5, K.timber), xform(mergeAll([box(0.5, 0.04, 0.35, '#FFF8EC', { x: -0.26, rz: 0.15 }), box(0.5, 0.04, 0.35, '#FFF8EC', { x: 0.26, rz: -0.15 }), box(0.04, 0.05, 0.36, '#8A3A2E')]), { y: 1.05 })]), { x: -2.8, z: D / 2 + 1.8 }));
  parts.push(xform(benchGeo(1.3), { x: 2.6, z: D / 2 + 1.6, ry: Math.PI }), xform(villager(4, { sit: true }), { x: 2.4, y: 0.3, z: D / 2 + 1.6 }));
  return mergeAll(parts);
}
function flowerMarket() {
  const parts = [box(7.0, 0.05, 6.0, '#D8C9AA')];
  const stall = (cols, flowers) => {
    const s = [box(2.0, 0.7, 0.9, K.timberL), ...[-0.9, 0.9].map((x) => box(0.08, 2.0, 0.08, K.timber, { x, z: 0.4 })), ...[-0.9, 0.9].map((x) => box(0.08, 2.2, 0.08, K.timber, { x, z: -0.4 })), xform(awning(2.2, 1.0, cols, 6), { y: 2.2, z: -0.45 })];
    for (let i = 0; i < 4; i++) s.push(xform(mergeAll([cyl(0.18, 0.15, 0.3, 8, '#8E9AA4'), xform(flowerClump(rng(`fm${flowers}${i}`), [flowers[i % flowers.length], '#FFFFFF'], 5, 0.4), { y: 0.25 })]), { x: -0.7 + i * 0.47, y: 0.7, z: 0.1 }));
    return mergeAll(s);
  };
  parts.push(xform(stall(['#FFF8EC', '#E8848C'], ['#FF7A9C', '#E83A55']), { x: -2.2, z: -1.4 }), xform(stall(['#FFF8EC', '#7FB8E6'], ['#A98BE0', '#4AA8E8']), { x: 2.2, z: -1.4 }),
    xform(stall(['#FFF8EC', '#F2C46B'], ['#FFD21F', '#F28C1E']), { x: 0, z: 1.2, ry: Math.PI }));
  parts.push(xform(fountainGeo(), { x: 0, z: -1.2, s: 0.55 }), xform(villager(1), { x: -1.0, z: 0.0 }), xform(villager(3), { x: 1.3, z: 0.2, ry: 2.5 }), xform(villager(5), { x: 2.8, z: 2.4, ry: 1 }));
  parts.push(xform(flowerCartGeo(), { x: -2.6, z: 2.3, ry: 0.4 }));
  return mergeAll(parts);
}
function flowerCartGeo() {
  const r = rng('vcart');
  return mergeAll([box(1.6, 0.4, 0.9, '#7FB8E6', { y: 0.4 }), ...[-1, 1].map((s) => xform(torus(0.32, 0.05, WOOD_D, {}, 4, 14), { x: -0.3, y: 0.32, z: s * 0.5 })),
    ...[0, 1, 2, 3].map((i) => xform(flowerClump(r, ['#FF7A9C', '#FFD21F', '#FFFFFF', '#A98BE0'], 5, 0.35), { x: -0.55 + (i % 2) * 0.6, y: 0.8, z: (Math.floor(i / 2) - 0.5) * 0.4 }))]);
}
function postOffice() {
  const W = 4.2; const D = 3.2; const H = 2.6; const BR = '#B5603C';
  const parts = [courses(box(W, H, D, BR, { y: 0.3 }), 14, [0.92, 1.05]), box(W + 0.16, 0.3, D + 0.16, K.stoneD), xform(pitchedRoof(W, D, 1.3, '#4F5A66', { oh: 0.28, gableHex: BR, trim: '#FBF6EC' }), { y: 0.3 + H })];
  parts.push(xform(doorBox(0.9, 1.8, '#2E5A8E'), { x: -0.9, y: 0.3, z: D / 2 + 0.03 }), xform(windowBox(1.2, 1.0, { frame: '#FBF6EC' }), { x: 0.9, y: 1.0, z: D / 2 + 0.03 }));
  parts.push(xform(mergeAll([box(2.2, 0.5, 0.08, '#2E5A8E'), box(2.3, 0.06, 0.1, '#E9B13A', { y: 0.5 }), box(2.3, 0.06, 0.1, '#E9B13A', { y: -0.04 }), xform(mergeAll([box(0.4, 0.28, 0.02, '#FFFFFF'), xform(box(0.42, 0.04, 0.025, '#C8473A'), { rz: 0.6 }), xform(box(0.42, 0.04, 0.025, '#C8473A'), { rz: -0.6 })]), { y: 0.11, z: 0.05 })]), { y: 0.3 + H - 0.65, z: D / 2 + 0.05 }));
  // the red pillar box, a bicycle with a mail bag, parcels on the step
  parts.push(xform(mergeAll([cyl(0.28, 0.3, 1.25, 12, '#D9433A'), xform(lathe([[0.3, 0], [0.33, 0.06], [0.28, 0.18], [0, 0.22]], 12, '#D9433A'), { y: 1.25 }), box(0.3, 0.04, 0.1, '#2A2A2A', { y: 1.0, z: 0.27 })]), { x: 1.9, z: D / 2 + 1.0 }));
  const bike = mergeAll([...[-0.45, 0.45].map((x) => xform(torus(0.3, 0.025, '#2A2A2A', {}, 3, 16), { x, y: 0.32 })), box(0.95, 0.04, 0.04, '#2E8C86', { y: 0.55 }), box(0.04, 0.4, 0.04, '#2E8C86', { x: 0.4, y: 0.35, rz: 0.3 }),
    box(0.35, 0.3, 0.25, '#8A5A35', { x: -0.45, y: 0.65 })]);
  parts.push(xform(bike, { x: -2.0, z: D / 2 + 0.8, ry: 0.2 }), xform(crate(0.4, '#C9A06A'), { x: 0.2, z: D / 2 + 0.6 }), xform(villager(0), { x: 0.9, z: D / 2 + 1.6, ry: 3 }));
  return mergeAll(parts);
}
function teaRoom() {
  const W = 4.0; const D = 3.2; const H = 2.3;
  const parts = [timberHouse(W, H, D, { plaster: PASTEL.pink, braces: false }), xform(pitchedRoof(W, D, 1.3, '#7FB8A0', { oh: 0.3, gableHex: PASTEL.pink }), { y: 0.3 + H })];
  parts.push(xform(doorBox(0.8, 1.6, '#7FB8A0'), { y: 0.3, z: D / 2 + 0.03 }), ...[-1.3, 1.3].map((x) => xform(windowBox(0.75, 0.8, { shutters: '#7FB8A0' }), { x, y: 1.0, z: D / 2 + 0.03 })), ...[-1.3, 1.3].map((x) => xform(flowerBox(0.85, ['#FF9FB0', '#FFFFFF']), { x, y: 0.78, z: D / 2 + 0.12 })));
  // the giant teapot sign on the roof's gable, the garden with tables under parasols, a picket fence
  parts.push(xform(mergeAll([xform(teapot('#FFFFFF'), { s: 4.2 }), box(0.06, 0.6, 0.06, K.iron, { y: -0.5 })]), { y: 0.3 + H + 1.5, z: D / 2 + 0.25 }));
  for (const [x, z, c] of [[-1.8, D / 2 + 1.6, '#FF9FB0'], [1.6, D / 2 + 1.7, '#7FB8A0']]) {
    parts.push(xform(mergeAll([cyl(0.4, 0.4, 0.04, 12, '#FFFFFF', { y: 0.72 }), cyl(0.03, 0.03, 0.72, 5, K.iron), cyl(0.02, 0.02, 1.9, 4, K.iron, { y: 0.72 }), xform(stripes(cone(0.9, 0.35, 8, c, { y: 2.3 }), 8, [c, '#FFFFFF']), {}),
      ...[-0.55, 0.55].map((dx) => xform(chair('#FFFFFF', 'none'), { x: dx, ry: dx > 0 ? -Math.PI / 2 : Math.PI / 2 })), xform(teapot(), { y: 0.76, s: 0.8 }), xform(teacup(), { x: 0.15, y: 0.76, z: 0.1 })]), { x, z }));
  }
  parts.push(xform(railFence([[-3.3, 0], [-0.7, 0]], { pickets: true, h: 0.6, hex: '#FFFFFF', post: '#FFFFFF' }), { z: D / 2 + 2.8 }), xform(railFence([[0.7, 0], [3.3, 0]], { pickets: true, h: 0.6, hex: '#FFFFFF', post: '#FFFFFF' }), { z: D / 2 + 2.8 }));
  parts.push(xform(villager(4, { sit: true }), { x: -2.3, y: 0.2, z: D / 2 + 1.6 }), xform(villager(1, { sit: true }), { x: 2.1, y: 0.2, z: D / 2 + 1.7 }));
  return mergeAll(parts);
}
function clockSquare() {
  const parts = [box(7.0, 0.06, 7.0, '#C9BFAE')];
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) if ((i + j) % 2) parts.push(box(0.98, 0.065, 0.98, '#D8CFBE', { x: -3 + i, z: -3 + j }));
  // the clock pillar: a fluted column, a four-faced clock in a cast-iron case, a gilt crown
  parts.push(box(1.2, 0.4, 1.2, LIMESTONE_D), lathe([[0.35, 0], [0.25, 0.2], [0.22, 3.0], [0.3, 3.1], [0, 3.1]], 10, '#2E4A3A', 40).translate(0, 0.4, 0));
  parts.push(box(1.0, 1.0, 1.0, '#2E4A3A', { y: 3.5 }));
  for (let sd = 0; sd < 4; sd++) parts.push(xform(clockFace(0.38), { y: 4.0, z: 0.52 }).rotateY((sd * Math.PI) / 2));
  parts.push(xform(cone(0.75, 0.6, 4, '#2E4A3A', { y: 4.5 }), { ry: Math.PI / 4 }), ball(0.14, GOLD, { y: 5.15 }, 1));
  for (const [x, z, ry] of [[-2.5, 0, Math.PI / 2], [2.5, 0, -Math.PI / 2], [0, -2.6, 0]]) parts.push(xform(benchGeo(1.5), { x, z, ry }));
  for (const [x, z] of [[-2.8, -2.8], [2.8, -2.8], [-2.8, 2.8], [2.8, 2.8]]) parts.push(xform(flowerUrn(['#FF7A9C', '#FFD21F', '#FFFFFF']), { x, z }));
  parts.push(xform(lampPost(2.4), { x: 1.6, z: 2.2 }), xform(lampPost(2.4), { x: -1.6, z: 2.2 }), xform(villager(2), { x: 1.0, z: 1.1, ry: 3.5 }), xform(villager(5, { sit: true }), { x: -2.5, y: 0.3, z: 0.3 }));
  return mergeAll(parts);
}
function watermill() {
  const g = millHouse({ stage: 4 });
  const w = xform(millWheelGeo({ broken: 0 }), { x: 2.15, y: 1.25 });
  return mergeAll([xform(mergeAll([g, w]), { ry: Math.PI / 2, s: 1.15 }), xform(waterSurface(pondOutline(2.2, 0.15, 0.05, 3), { y: 0.05 }), { x: 0.0, z: 2.8, sx: 1.4 }), xform(villager(3), { x: -2.6, z: 1.8 })]);
}
function boathouse() {
  const parts = [];
  // a wooden boathouse on stilts over the water, its big door open to the river (+z), a pier, two rowboats, oars
  for (const x of [-1.6, 1.6]) for (const z of [-0.5, 1.2, 2.9]) parts.push(cyl(0.12, 0.13, 1.0, 6, '#6E4A2E', { x, y: -0.4, z }));
  parts.push(box(3.6, 0.15, 3.8, '#9A6A3A', { y: 0.5, z: 1.2 }));
  const wallH = 2.4;
  parts.push(box(3.6, wallH, 0.12, '#5E7F96', { y: 0.65, z: -0.7 }), ...[-1.74, 1.74].map((x) => box(0.12, wallH, 3.8, '#5E7F96', { x, y: 0.65, z: 1.2 })));
  for (let i = 0; i < 12; i++) parts.push(box(0.04, wallH, 0.13, '#4E6E86', { x: -1.65 + i * 0.3, y: 0.65, z: -0.69 }));
  parts.push(xform(pitchedRoof(3.6, 3.8, 1.5, '#C8473A', { oh: 0.3, gableHex: '#FFF8EC' }), { y: 0.65 + wallH, z: 1.2 }));
  parts.push(box(1.4, 1.6, 0.08, '#2A3A4A', { y: 0.65, z: 3.12 }));
  const rowboat = (hex) => xform(mergeAll([lathe([[0, 0], [0.42, 0.04], [0.5, 0.3], [0, 0.3]], 10, hex, 40), box(0.7, 0.04, 0.2, WOOD, { y: 0.22 })]), { sz: 3.2 });
  parts.push(xform(rowboat('#E8F0F4'), { x: 0, y: 0.05, z: 1.8 }), xform(rowboat('#2BB3A3'), { x: 2.6, y: 0.05, z: 3.0, ry: 0.3 }));
  parts.push(box(1.0, 0.12, 3.0, '#B9824A', { x: 2.5, y: 0.45, z: 0.6 }), xform(cyl(0.03, 0.03, 1.8, 4, WOOD), { x: -1.3, y: 1.2, z: -0.55, rz: 0.2 }), xform(cyl(0.03, 0.03, 1.8, 4, WOOD), { x: -1.1, y: 1.2, z: -0.55, rz: 0.25 }));
  parts.push(xform(mergeAll([box(1.4, 0.4, 0.06, '#FFF8EC'), box(1.5, 0.05, 0.08, '#2BB3A3', { y: 0.4 })]), { y: 3.1, z: 3.15 }), xform(villager(1), { x: 2.5, y: 0.57, z: 1.2 }));
  return mergeAll(parts);
}
function villageGreen() {
  const parts = [xform(mottle(blob(3.4, '#7DB04A', { seed: 150, sy: 0.02, detail: 2 }), { seed: 5, lo: 0.92, hi: 1.08 }), {})];
  // the maypole with its ribbons, a ring of dancers, picnic blankets, two trees, a bench
  parts.push(cyl(0.08, 0.1, 4.5, 8, '#FFF8EC'), cyl(0.25, 0.25, 0.12, 10, GOLD, { y: 4.4 }), xform(flowerClump(rng('maypole'), ['#FF7A9C', '#FFFFFF', '#FFD21F'], 6, 0.3), { y: 4.5 }));
  const cols = ['#FF7A6B', '#FFC83D', '#2BB3A3', '#4AA8E8', '#FF9FB0', '#9C7FD0'];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; parts.push(tube([[0, 4.35, 0], [Math.sin(a) * 1.2, 2.6, Math.cos(a) * 1.2], [Math.sin(a + 0.4) * 1.9, 1.0, Math.cos(a + 0.4) * 1.9]], 0.03, cols[i], { seg: 3, steps: 8 })); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.4; parts.push(xform(villager(i), { x: Math.sin(a) * 1.9, z: Math.cos(a) * 1.9, ry: a + Math.PI / 2 })); }
  for (const [x, z, c] of [[-2.6, 2.0, '#E8848C'], [2.4, 2.4, '#7FB8E6']]) parts.push(xform(mergeAll([box(1.4, 0.02, 1.2, c), ...[0, 1, 2].map((i) => box(0.42, 0.021, 1.2, '#FFFFFF', { x: -0.47 + i * 0.47 })), xform(basketOf([['#E23B3B', 0, 0]])(), { s: 0.4, y: 0.02 })]), { x, z, ry: x * 0.2 }));
  parts.push(xform(fruitTreeLike('#4C9A3E', 1.0, 5), { x: -2.6, z: -2.4 }), xform(fruitTreeLike('#5BAA45', 0.85, 6), { x: 2.8, z: -2.2 }), xform(benchGeo(1.5), { x: 0, z: -3.0 }));
  return mergeAll(parts);
}
function musicHall() {
  const W = 5.6; const D = 4.0; const H = 3.2; const WALL = '#E8D6B4';
  const parts = [box(W + 0.3, 0.3, D + 0.3, LIMESTONE_D), box(W, H, D, WALL, { y: 0.3 }), box(W + 0.3, 0.25, D + 0.3, '#FBF6EC', { y: 0.3 + H })];
  parts.push(xform(pitchedRoof(W, D, 1.4, '#6E4A6E', { oh: 0.2, gableHex: WALL, trim: '#FBF6EC' }), { y: 0.55 + H }));
  // the great arched window over the doors, posters, a gilt treble clef, the bandstand drum on top
  const arch = (w, h, hex) => { const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(-w / 2, h); sh.absarc(0, h, w / 2, Math.PI, 0, true); sh.lineTo(w / 2, 0); sh.closePath(); return P(new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false, curveSegments: 10 }), hex); };
  parts.push(xform(arch(2.0, 1.6, '#FBF6EC'), { y: 1.2, z: D / 2 }), xform(arch(1.8, 1.5, '#FFD98A'), { y: 1.25, z: D / 2 + 0.03 }), xform(doorBox(1.2, 1.0, '#6E3A3A'), { y: 0.3, z: D / 2 + 0.05 }));
  for (const [x, c] of [[-2.0, '#E8848C'], [2.0, '#7FB8E6']]) parts.push(box(0.8, 1.1, 0.04, c, { x, y: 1.0, z: D / 2 + 0.03 }), box(0.6, 0.15, 0.045, '#FFF8EC', { x, y: 1.6, z: D / 2 + 0.03 }));
  const clef = mergeAll([tube([[0, -0.4, 0], [0.05, -0.55, 0], [-0.1, -0.6, 0], [-0.12, -0.45, 0], [0, -0.3, 0], [0.05, 0.3, 0], [-0.1, 0.55, 0], [-0.18, 0.35, 0], [0.18, 0.0, 0], [0.15, -0.25, 0], [-0.15, -0.25, 0], [-0.18, 0.0, 0], [0.05, 0.1, 0]], 0.04, GOLD, { seg: 4, steps: 40 })]);
  parts.push(xform(clef, { y: 0.55 + H + 0.75, z: D / 2 + 0.3, s: 1.2 }));
  parts.push(cyl(0.9, 0.9, 0.7, 10, '#FBF6EC', { y: 1.55 + H, z: -0.6 }), xform(lathe([[1.0, 0], [0.8, 0.45], [0.3, 0.75], [0, 0.8]], 10, '#6E4A6E', 40), { y: 2.25 + H, z: -0.6 }));
  parts.push(xform(lampPost(2.2), { x: -2.9, z: D / 2 + 0.8 }), xform(villager(2), { x: 1.2, z: D / 2 + 1.4 }), xform(villager(4), { x: 0.5, z: D / 2 + 1.7, ry: 0.5 }));
  return mergeAll(parts);
}
function harbourInn() {
  const W = 4.2; const D = 3.4; const H = 2.6;
  const parts = [timberHouse(W, H * 1.6, D, { plaster: '#F3E6CC' }), xform(pitchedRoof(W, D, 1.6, '#2E4A3A', { oh: 0.3 }), { y: 0.3 + H * 1.6 }), xform(stack(1.1, 0.5), { x: -1.2, y: 0.3 + H * 1.6 + 0.6, z: -0.5 })];
  parts.push(xform(doorBox(0.85, 1.7, '#2E4A3A'), { y: 0.3, z: D / 2 + 0.03 }), ...[-1.3, 1.3].flatMap((x) => [xform(windowBox(0.7, 0.75, { shutters: '#2E4A3A' }), { x, y: 1.0, z: D / 2 + 0.03 }), xform(windowBox(0.6, 0.65, { shutters: '#2E4A3A' }), { x, y: 2.8, z: D / 2 + 0.03 })]));
  // the deck over the water with tables, the hanging sign with an anchor, barrels, lanterns
  parts.push(box(W + 1.6, 0.14, 2.2, '#9A6A3A', { y: 0.35, z: D / 2 + 1.3 }), ...[-2.6, 2.6].flatMap((x) => [0.6, 2.1].map((z) => cyl(0.1, 0.1, 1.2, 5, '#6E4A2E', { x, y: -0.8, z: D / 2 + z }))));
  parts.push(railing([[-2.9, D / 2 + 2.4], [2.9, D / 2 + 2.4]], { h: 0.6, post: '#6E4A2E', rail: '#9A6A3A', closed: false, step: 0.6 }).translate(0, 0.49, 0));
  const anchor = mergeAll([cyl(0.04, 0.04, 0.6, 5, '#3A3A3A'), xform(torus(0.06, 0.02, '#3A3A3A', {}, 3, 8), { y: 0.65 }), box(0.3, 0.04, 0.04, '#3A3A3A', { y: 0.5 }), clipAbove(xform(torus(0.25, 0.035, '#3A3A3A', {}, 3, 12), { y: 0.25 }), 0.2)]);
  parts.push(xform(mergeAll([box(0.06, 0.06, 0.8, K.iron, { z: 0.4 }), xform(signBoard(0.8, 0.7, '#2E4A3A', '#E9B13A'), { y: -0.75, z: 0.8 }), xform(anchor, { y: -0.75, z: 0.86, s: 1.2 })]), { x: 1.9, y: 2.3, z: D / 2 }));
  for (const [x, z] of [[-1.6, D / 2 + 1.0], [1.4, D / 2 + 1.4]]) parts.push(xform(mergeAll([cyl(0.35, 0.35, 0.04, 10, WOOD, { y: 0.72 }), cyl(0.04, 0.04, 0.72, 4, K.timber), xform(barrel(0.5), { x: 0.6 }), xform(villager(x > 0 ? 3 : 5, { sit: true }), { x: -0.5, y: 0.0 })]), { x, y: 0.49, z }));
  parts.push(xform(barrel(0.9), { x: -2.6, y: 0.49, z: D / 2 + 0.6 }), xform(lampPost(1.8), { x: 2.7, y: 0.49, z: D / 2 + 0.4 }));
  return mergeAll(parts);
}
function observatory() {
  const parts = [cyl(2.0, 2.1, 0.3, 14, LIMESTONE_D), cyl(1.7, 1.75, 3.2, 14, '#F2EEE6', { y: 0.3 }, 30), cyl(1.85, 1.85, 0.2, 14, LIMESTONE, { y: 3.5 })];
  // the dome with its open slit and the telescope poking out, a little door and windows, a bench under the stars
  const dome = clipBelow(xform(P(new THREE.SphereGeometry(1.75, 16, 8), '#C9CED3', { creaseDeg: 40 }), { y: 3.7 }), 3.7);
  const p = dome.getAttribute('position'); const keep = [];
  for (let f = 0; f < p.count / 3; f++) { const cx = (p.getX(f * 3) + p.getX(f * 3 + 1) + p.getX(f * 3 + 2)) / 3; const cz = (p.getZ(f * 3) + p.getZ(f * 3 + 1) + p.getZ(f * 3 + 2)) / 3; if (!(Math.abs(cx) < 0.35 && cz > 0)) keep.push(f); }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(dome.attributes)) { const at = dome.getAttribute(name); const arr = new Float32Array(keep.length * 3 * at.itemSize); keep.forEach((f, i) => arr.set(at.array.subarray(f * 3 * at.itemSize, (f + 1) * 3 * at.itemSize), i * 3 * at.itemSize)); out.setAttribute(name, new THREE.BufferAttribute(arr, at.itemSize)); }
  parts.push(out, ...[-0.36, 0.36].map((x) => box(0.08, 0.08, 1.8, '#9AA0A6', { x, y: 4.6, rx: -0.9 }).translate(0, 0, 0.2)));
  parts.push(xform(mergeAll([cyl(0.18, 0.22, 2.0, 10, '#E9B13A'), cyl(0.24, 0.24, 0.12, 10, '#3A3A3A', { y: 2.0 })]), { y: 3.9, z: 0.3, rx: 0.85 }));
  parts.push(xform(doorBox(0.8, 1.6, '#4D5BD6'), { y: 0.3, z: 1.73 }), ...[-1, 1].map((s) => xform(windowBox(0.4, 0.6), { x: s * 1.2, y: 2.0, z: 1.25, ry: s * 0.75 })));
  for (let i = 0; i < 5; i++) parts.push(xform(P(new THREE.OctahedronGeometry(0.1, 0), '#FFE27A'), { x: -1.8 + i * 0.9, y: 0.9 + (i % 2) * 0.4, z: 2.6, sy: 1.4 }));
  parts.push(xform(benchGeo(1.4), { x: -2.4, z: 1.9, ry: Math.PI + 0.6 }), xform(villager(4), { x: 2.2, z: 2.2, ry: -0.6 }));
  return mergeAll(parts);
}
function craftHall() {
  const W = 6.0; const D = 3.6; const H = 2.4;
  const parts = [timberHouse(W, H, D, { plaster: '#F3E6CC' }), xform(pitchedRoof(D, W, 1.6, '#8E5E48', { oh: 0.3 }), { ry: Math.PI / 2, y: 0.3 + H })];
  // the big barn doors open, a loom and a potter's wheel inside the door, banners, the giant spool sign
  parts.push(box(1.8, 1.9, 0.06, '#3A2A1A', { y: 0.3, z: D / 2 + 0.01 }), ...[-1.4, 1.4].map((x) => xform(box(0.9, 1.9, 0.08, '#8E5A34', { y: 0.3 }), { x, z: D / 2 + 0.3, ry: x > 0 ? -1.1 : 1.1 })));
  parts.push(xform(mergeAll([box(0.9, 0.8, 0.5, K.timberL), ...[0, 1, 2, 3, 4].map((i) => box(0.02, 0.5, 0.02, ['#E8848C', '#7FB8E6', '#F2C46B', '#8FAE88', '#9C7FD0'][i], { x: -0.3 + i * 0.15, y: 0.8 }))]), { x: -0.4, y: 0.3, z: D / 2 - 0.4 }));
  for (const [x, c] of [[-2.4, '#C8473A'], [2.4, '#2BB3A3']]) parts.push(xform(mergeAll([box(0.05, 1.6, 0.05, K.iron), xform(box(0.6, 1.0, 0.03, c), { x: 0.32, y: 0.55 }), xform(P(new THREE.ConeGeometry(0.3, 0.3, 3), c), { x: 0.32, y: 0.05, rz: Math.PI, sz: 0.1 })]), { x, y: 0.9, z: D / 2 + 0.08 }));
  parts.push(xform(bigSpool('#E8556F', 0.42, 0.7), { x: 0, y: 0.3 + H + 1.5, z: D / 2 - 0.4, rx: Math.PI / 2 }));
  parts.push(xform(villager(1), { x: 1.0, z: D / 2 + 1.2 }), xform(villager(5), { x: -1.6, z: D / 2 + 1.5, ry: 0.6 }), xform(crate(0.5), { x: 2.6, z: D / 2 + 0.6 }));
  return mergeAll(parts);
}
function glasshouseGarden() {
  return mergeAll([xform(orangery(), { s: 0.62, z: -0.8 }), ...[[-2.6, 2.4], [0, 2.8], [2.6, 2.4]].map(([x, z], i) => xform(mergeAll([box(1.6, 0.3, 0.9, K.brick), box(1.5, 0.05, 0.8, '#5A3420', { y: 0.3 }),
    ...[0, 1, 2].map((k) => xform(flowerClump(rng(`gg${i}${k}`), [['#FF7A9C', '#FFD21F', '#A98BE0'][(i + k) % 3], '#FFFFFF'], 5, 0.4), { x: -0.5 + k * 0.5, y: 0.3 }))]), { x, z })), xform(villager(2), { x: 1.4, z: 3.4, ry: 3 })]);
}
function skatingPond() {
  const rf = pondOutline(2.8, 0.1, 0.05, 4);
  const parts = [waterSurface(rf, { y: 0.05, deep: '#D6EEF5', shallow: '#F2FAFC' }), ...stoneRim(rf, 26, { seed: 41, size: 0.26, cols: ['#E8EEF2', '#D6DEE4', '#C9D2D9'] })];
  // skaters gliding, a warming hut with smoke, a string of lights round the pond, a sledge
  for (let i = 0; i < 4; i++) { const a = i * 1.6; parts.push(xform(villager(i), { x: Math.sin(a) * 1.4, y: 0.05, z: Math.cos(a) * 1.4, ry: a + Math.PI / 2, rz: 0.15 })); }
  parts.push(xform(mergeAll([box(1.8, 1.6, 1.4, '#9A5A3A'), xform(pitchedRoof(1.8, 1.4, 0.8, '#FFFFFF', { oh: 0.2, gableHex: '#9A5A3A' }), { y: 1.6 }), xform(stack(0.7, 0.3), { x: 0.5, y: 2.0 }), xform(doorBox(0.6, 1.2), { z: 0.72 })]), { x: -2.6, z: -2.6, ry: 0.6 }));
  for (let k = 0; k < 4; k++) { const a0 = (k / 4) * Math.PI * 2; const a1 = ((k + 1) / 4) * Math.PI * 2; const r = rf(a0) * 1.15; const r1 = rf(a1) * 1.15; parts.push(lightString([Math.sin(a0) * r, 1.6, Math.cos(a0) * r], [Math.sin(a1) * r1, 1.6, Math.cos(a1) * r1], 6, { sag: 0.3 }), cyl(0.04, 0.04, 1.6, 4, '#3A3A3A', { x: Math.sin(a0) * r, z: Math.cos(a0) * r })); }
  parts.push(xform(mergeAll([box(0.9, 0.06, 0.4, '#C8473A', { y: 0.2 }), ...[-0.15, 0.15].map((z) => xform(box(1.1, 0.04, 0.04, '#8A5A35'), { y: 0.06, z }))]), { x: 2.8, z: 2.4, ry: 0.5 }));
  const out = mergeAll(parts); out.anchors = { chimney: [-2.2, 2.7, -2.3] }; return out;
}
function orchardWalk() {
  const parts = [box(1.4, 0.03, 7.0, '#D8C49A')];
  for (const z of [-2.6, -0.6, 1.4]) for (const s of [-1, 1]) {
    const blossom = (z + s) % 2 === 0;
    parts.push(xform(fruitTreeLike(blossom ? '#F4B6CF' : '#4FA83E', 0.65, 7 + z), { x: s * 2.0, z }));
  }
  parts.push(xform(mergeAll([box(0.14, 2.4, 0.14, '#FFF8EC', { x: -0.8 }), box(0.14, 2.4, 0.14, '#FFF8EC', { x: 0.8 }), clipBelow(xform(torus(0.8, 0.06, '#FFF8EC', {}, 4, 16), { y: 2.4 }), 2.38),
    ...Array.from({ length: 10 }, (_, i) => { const t = (i / 9) * Math.PI; return xform(blob(0.14, i % 3 ? LEAF : '#F4B6CF', { seed: 160 + i, detail: 0 }), { x: Math.cos(t) * 0.8, y: 2.4 + Math.sin(t) * 0.8 }); })]), { z: 3.1 }));
  parts.push(xform(benchGeo(1.3), { x: -1.3, z: 0.4, ry: Math.PI / 2 }), xform(villager(4), { x: 0.2, z: -0.4 }), xform(villager(2), { x: -0.2, z: -0.1, ry: 0.3 }), xform(basketOf([['#E23B3B', 0, 0], ['#E23B3B', 0.1, 0.1]])(), { x: 1.1, z: 1.9, s: 0.5 }));
  return mergeAll(parts);
}
function festivalArch() {
  const parts = [];
  for (const s of [-1, 1]) parts.push(box(0.9, 4.2, 0.9, '#E8D6B4', { x: s * 2.6 }), box(1.1, 0.25, 1.1, LIMESTONE_D, { x: s * 2.6, y: 4.2 }), ...[0.6, 1.8, 3.0].map((y) => box(0.95, 0.08, 0.95, '#C8473A', { x: s * 2.6, y })),
    xform(mergeAll([cyl(0.03, 0.03, 1.2, 4, IRON), xform(P(new THREE.ConeGeometry(0.3, 0.8, 3), s > 0 ? '#2BB3A3' : '#E8848C'), { rz: -Math.PI / 2, x: 0.4, y: 0.95, sz: 0.1 })]), { x: s * 2.6, y: 4.45 }));
  parts.push(clipBelow(xform(torus(2.6, 0.32, '#E8D6B4', {}, 6, 28), { y: 3.6, sy: 0.65 }), 3.58), clipBelow(xform(torus(2.6, 0.1, GOLD, {}, 4, 28), { y: 3.6, z: 0.3, sy: 0.65 }), 3.58));
  parts.push(xform(signBoard(2.6, 0.6, '#C8473A', GOLD), { y: 4.6, z: 0.35 }), ...Array.from({ length: 5 }, (_, i) => box(0.3, 0.3, 0.02, '#FFF8EC', { x: -0.9 + i * 0.45, y: 4.75, z: 0.42 })));
  for (let k = 0; k < 2; k++) parts.push(lightString([-2.3, 3.2 - k * 0.5, 0.5], [2.3, 3.2 - k * 0.5, 0.5], 8, { sag: 0.6 }));
  const bunt = []; const cols = ['#FF7A6B', '#FFC83D', '#2BB3A3', '#4AA8E8', '#FF9FB0'];
  for (let i = 0; i < 11; i++) { const t = i / 10; const x = -2.3 + t * 4.6; bunt.push(xform(P(new THREE.ConeGeometry(0.14, 0.3, 3), cols[i % 5]), { rx: Math.PI, x, y: 2.5 - Math.sin(t * Math.PI) * 0.4, z: -0.4, sz: 0.2 })); }
  parts.push(...bunt, xform(villager(0), { x: -1.0, z: 1.6 }), xform(villager(3), { x: 1.2, z: 1.9, ry: 2.6 }));
  return mergeAll(parts);
}
/** The Festival Pavilion, tier by tier (content FESTIVAL_PAVILION.tiers): 1 the frame, 2 bunting and pennants, 3 the
 *  lantern roof, 4 the dance floor, 5 the bandstand wing, 6 flower garlands, 7 the festival bell, 8 the golden
 *  weathervane; tier n shows everything up to n (render-world shows min(tier, 8)). */
function festivalPavilion(tier = 1) {
  const W = 6.0; const D = 5.0; const H = 3.0; const parts = [];
  parts.push(box(W + 0.6, 0.2, D + 0.6, LIMESTONE_D));
  for (let i = 0; i < 4; i++) for (const z of [-1, 1]) parts.push(box(0.22, H, 0.22, '#F3E6CC', { x: -W / 2 + 0.1 + i * ((W - 0.2) / 3), y: 0.2, z: z * (D / 2 - 0.1) }));
  for (const z of [-1, 1]) parts.push(box(W + 0.2, 0.22, 0.24, '#8E5A34', { y: 0.2 + H, z: z * (D / 2 - 0.1) }));
  for (let i = 0; i < 5; i++) parts.push(box(0.16, 0.18, D + 0.2, '#B9824A', { x: -W / 2 + 0.3 + i * ((W - 0.6) / 4), y: 0.42 + H }));
  if (tier < 3) parts.push(xform(scaffold(W, D, 1.2, { side: 'front' }), { y: 0.2 }), xform(sitePile(41), { x: W / 2 + 0.9, z: 1.5, ry: 1.2 }));
  if (tier >= 2) {
    const cols = ['#FF7A6B', '#FFC83D', '#2BB3A3', '#4AA8E8', '#FF9FB0', '#9C7FD0'];
    for (const z of [-1, 1]) for (let i = 0; i < 15; i++) { const t = i / 14; parts.push(xform(P(new THREE.ConeGeometry(0.13, 0.3, 3), cols[i % 6]), { rx: Math.PI, x: -W / 2 + t * W, y: H + 0.05 - Math.sin(t * Math.PI * 3) ** 2 * 0.25, z: z * (D / 2 + 0.02), sz: 0.2 })); }
    for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) parts.push(xform(mergeAll([cyl(0.025, 0.025, 1.0, 4, IRON), xform(P(new THREE.ConeGeometry(0.2, 0.6, 3), cols[(x + z + 10) % 6 | 0]), { rz: -Math.PI / 2, x: 0.3, y: 0.85, sz: 0.1 })]), { x, y: 0.62 + H, z }));
  }
  if (tier >= 3) {
    // the lantern roof: a shallow pitched roof of red tiles with rows of paper lanterns hanging under its eaves
    parts.push(xform(pitchedRoof(W + 0.2, D + 0.2, 1.4, '#B5452E', { oh: 0.35, gableHex: '#8E5A34' }), { y: 0.6 + H }));
    for (const z of [-1.2, 0, 1.2]) for (let i = 0; i < 5; i++) parts.push(xform(paperLantern(['#E8513C', '#F28C1E', '#FFD45A'][(i + Math.round(z)) % 3 | 0], 0.32), { x: -2.2 + i * 1.1, y: 0.42 + H, z }));
  }
  if (tier >= 4) for (let i = 0; i < 14; i++) parts.push(box(0.4, 0.04, D - 0.4, i % 2 ? '#C99258' : '#B98048', { x: -W / 2 + 0.4 + i * 0.4, y: 0.2 }));
  if (tier >= 5) {
    // the bandstand wing at the back: a raised stage with a shell and musicians
    parts.push(box(W - 1.0, 0.5, 1.6, '#8E5A34', { y: 0.2, z: -D / 2 - 0.6 }), xform(clipBelow(xform(P(new THREE.SphereGeometry(2.2, 14, 8), '#FFF8EC', { creaseDeg: 40 }), { sz: 0.45 }), 0), { y: 0.7, z: -D / 2 - 1.1 }));
    parts.push(xform(villager(3), { x: -0.8, y: 0.7, z: -D / 2 - 0.6 }), xform(villager(0), { x: 0.8, y: 0.7, z: -D / 2 - 0.6 }));
  }
  if (tier >= 6) for (let i = 0; i < 4; i++) for (const z of [-1, 1]) { const x = -W / 2 + 0.1 + i * ((W - 0.2) / 3); parts.push(...Array.from({ length: 6 }, (_, k) => xform(blob(0.12, k % 2 ? LEAF : ['#FF7A9C', '#FFD21F', '#FFFFFF'][k % 3], { seed: 170 + i * 6 + k, detail: 0 }), { x: x + Math.sin(k * 1.3) * 0.14, y: 0.6 + k * 0.42, z: z * (D / 2 - 0.1) + Math.cos(k * 1.3) * 0.14 }))); }
  if (tier >= 7) parts.push(xform(mergeAll([box(0.9, 0.9, 0.9, '#F3E6CC'), xform(lathe([[0, 0], [0.3, 0], [0.28, 0.1], [0.2, 0.35], [0.1, 0.5], [0, 0.52]], 10, '#C9952E', 40), { y: 0.15 }), xform(cone(0.75, 0.7, 4, '#B5452E'), { y: 0.9, ry: Math.PI / 4 })]), { y: 2.0 + H }));
  if (tier >= 8) parts.push(xform(mergeAll([cyl(0.03, 0.03, 0.9, 4, GOLD), box(0.6, 0.04, 0.04, GOLD, { y: 0.55 }), xform(blob(0.16, GOLD_L, { seed: 9, sx: 1.4, sy: 1.1, detail: 1 }), { y: 0.95 }), xform(P(new THREE.ConeGeometry(0.12, 0.25, 4), GOLD), { y: 1.1, x: -0.2, rz: 0.8, sz: 0.3 })]), { y: 3.6 + H }));
  if (tier >= 4) parts.push(xform(villager(1), { x: -1.0, y: 0.24, z: 0.6, ry: 0.5 }), xform(villager(4), { x: -0.5, y: 0.24, z: 0.9, ry: -2.5 }), xform(villager(5), { x: 1.4, y: 0.24, z: 0.2 }));
  return mergeAll(parts);
}
/** A Town Project's souvenir (decor, 1 x 1): the landmark in miniature on a little plinth with a brass plaque. */
async function souvenirOf(build, s = 0.26) {
  const g = build(); const b = bounds(g);
  const k = Math.min(s, 1.62 / Math.max(b.max.x - b.min.x, b.max.z - b.min.z), 1.9 / (b.max.y - b.min.y));
  let m = xform(g, { s: k }); m.translate(-((b.min.x + b.max.x) / 2) * k, 0, -((b.min.z + b.max.z) / 2) * k);
  m = clipBelow(m, -0.001);
  // a miniature keeps its silhouette in ~550 triangles (a 1 x 1 decor; the landmark itself is 1-6k)
  if (tris(m) > SOUVENIR_TRIS) m = await simplify(m, SOUVENIR_TRIS / tris(m), { error: 0.04, deg: 40, lockBorder: false });
  return mergeAll([box(1.7, 0.14, 1.7, '#C9A26A'), box(1.76, 0.04, 1.76, '#8A5A35', { y: 0.14 }), box(0.5, 0.08, 0.02, BRASS, { y: 0.03, z: 0.86 }), xform(m, { y: 0.18 })]);
}
const SOUVENIR_TRIS = 550;
/** Simplify a town model to its budget: detail-preserving first, then a coarser pass if that could not reach it. */
async function townBudget(g) {
  if (tris(g) <= TOWN_TRIS * 1.05) return g;
  let out = await detailSimplify(g, TOWN_TRIS, { maxErr: 0.012 });
  if (tris(out) > TOWN_TRIS * 1.25) out = await simplify(out, TOWN_TRIS / tris(out), { error: 0.03, deg: 40 });
  return out;
}
/** A town landmark's budget (far scenery: 24 of them stand across the river). */
const TOWN_TRIS = 3200;

// ---------------------------------------------------------------------------------------------------
// 17. Wave 4 (the owners' wish list, 2026-10-04; render lane): the American farmhouse (wish B) and the upgrade tiers of
//     the farmhouse, the Well, the Market Stand and the benches (wish E: `objects[id].up` 1..3; objects-view draws
//     `<key>:<tier>`). Every tier is its own file, so a farm loads only the tiers it shows. The new doghouse (D), the
//     rabbit hutch (3) and the bird bath's water anchor (10) are here too; crops, trees, animals and items follow.
const FH = Object.freeze({ red: '#B23A2F', redD: '#922F28', white: '#F4F1EA', roof: '#8F959D', stone: '#A9A296', deck: '#BF9466',
  deckD: '#99714E', door: '#3F5F86', brick: '#A3493A', shutter: '#2F5A44' });
/** Tier 1's "fresh paint": a brighter barn red and crisper white. */
const FH_FRESH = Object.freeze({ ...FH, red: '#C4402F', redD: '#A2352A', white: '#FFFDF6' });
/** The farmhouse layout (metres, model space; the front faces +z). PL plinth; M main block; W side wing. */
const FHL = Object.freeze({ PL: 0.36, MX: 1.15, MZ: -0.9, MW: 3.9, MD: 3.8, MH: 4.3, WX: -2.05, WZ: -0.75, WW: 2.4, WD: 3.0, WH: 2.5, ZF: 2.35 });

/** A clapboard wall block w x h x d (centre x, z; standing on y0): the boards' shadow lines every 0.3 m on its four
 *  faces, white corner boards and a white frieze under the eaves. */
function clapboard(w, h, d, pal, { x = 0, y0 = 0, z = 0 } = {}) {
  const parts = [box(w, h, d, pal.red, { x, y: y0, z })];
  for (let y = y0 + 0.32; y < y0 + h - 0.32; y += 0.3) {
    for (const s of [-1, 1]) {
      parts.push(box(w - 0.12, 0.03, 0.02, pal.redD, { x, y, z: z + s * (d / 2 + 0.008) }));
      parts.push(box(0.02, 0.03, d - 0.12, pal.redD, { x: x + s * (w / 2 + 0.008), y, z }));
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.17, h, 0.17, pal.white, { x: x + sx * (w / 2 - 0.02), y: y0, z: z + sz * (d / 2 - 0.02) }));
  parts.push(box(w + 0.06, 0.2, d + 0.06, pal.white, { x, y: y0 + h - 0.2, z }));
  return mergeAll(parts);
}
/** A window on a wall facing `face` ('front' +z, 'back', 'left' -x, 'right' +x) whose plane is at `at` (z or x). */
function fhWindow(pal, face, u, at, y, { w = 0.8, h = 1.1, shutters = false } = {}) {
  const g = windowBox(w, h, { frame: pal.white, shutters: shutters ? pal.shutter : null });
  const ry = { front: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 }[face];
  const o = face === 'front' || face === 'back' ? { x: u, z: at } : { x: at, z: u };
  return xform(g, { ry, y, ...o });
}
/** The front door: a painted door with a glass light, a white frame and a transom (faces +z). */
function fhDoor(pal) {
  return mergeAll([box(0.9, 1.95, 0.06, pal.door), box(0.62, 0.42, 0.07, K.glass, { y: 1.3 }), box(1.12, 0.1, 0.1, pal.white, { y: 1.95 }),
    box(0.1, 1.95, 0.1, pal.white, { x: -0.5 }), box(0.1, 1.95, 0.1, pal.white, { x: 0.5 }), box(0.9, 0.24, 0.06, K.glass, { y: 2.05 }),
    box(1.12, 0.08, 0.1, pal.white, { y: 2.29 }), ball(0.045, '#E9B13A', { x: 0.3, y: 0.95, z: 0.06 }, 0), box(0.8, 0.02, 0.5, '#8A6A40', { y: 0, z: 0.35 })]);
}
/** A black wall lantern with a warm glass (its glass is a night light: manifest anchor `lamps`). */
function wallLamp() {
  return mergeAll([box(0.06, 0.06, 0.16, '#2E2E2E', { y: 0.36, z: -0.06 }), box(0.18, 0.05, 0.18, '#2E2E2E', { y: 0.06 }), box(0.13, 0.24, 0.13, '#FFE08A', { y: 0.1 }),
    xform(P(new THREE.ConeGeometry(0.14, 0.12, 4), '#2E2E2E'), { y: 0.4, ry: Math.PI / 4 })]);
}
/** A round flowering shrub for the foundation beds. */
function fhBush(seed, r = 0.42, cols = ['#FF7A9C', '#FFFFFF']) {
  const parts = [xform(blob(r, seed % 2 ? LEAF : LEAF_D, { seed, amp: 0.2, detail: 1, flatBottom: 0.5, sy: 0.85 }), { y: r * 0.55 })];
  for (let i = 0; i < 5; i++) { const a = i * 1.3 + seed; parts.push(xform(flatFlower(cols[i % cols.length], 0.07), { x: Math.cos(a) * r * 0.62, y: r * (0.95 + (i % 2) * 0.12), z: Math.sin(a) * r * 0.62 })); }
  return mergeAll(parts);
}
/** A run of porch (deck, posts, rails, lean-to roof) along a wall at z = zWall from x0 to x1, `depth` deep; steps at x =
 *  `gap` (no rail there). The roof meets the wall at roofY + 0.42 and the posts at roofY. */
function porchRun(x0, x1, zWall, depth, pal, { roofY = 2.75, gap = null, deckY = 0.42, rails = true } = {}) {
  const w = x1 - x0; const cx = (x0 + x1) / 2; const zf = zWall + depth;
  const parts = [box(w, deckY, depth, pal.deck, { x: cx, z: zWall + depth / 2 })];
  const nb0 = Math.max(2, Math.round(w / 0.32));
  for (let k = 1; k < nb0; k++) parts.push(box(0.02, 0.006, depth - 0.05, pal.deckD, { x: x0 + (k * w) / nb0, y: deckY, z: zWall + depth / 2 }));
  const nPost = Math.max(2, Math.round(w / 1.25) + 1);
  const posts = Array.from({ length: nPost }, (_, k) => x0 + 0.1 + (k * (w - 0.2)) / (nPost - 1));
  for (const px of posts) parts.push(box(0.14, roofY - deckY, 0.14, pal.white, { x: px, y: deckY, z: zf - 0.1 }));
  if (rails) for (let k = 0; k < posts.length - 1; k++) {
    const a = posts[k] + 0.07; const b = posts[k + 1] - 0.07; const m = (a + b) / 2; const len = b - a;
    if (gap !== null && gap > a - 0.3 && gap < b + 0.3) continue;
    parts.push(box(len, 0.07, 0.09, pal.white, { x: m, y: deckY + 0.78, z: zf - 0.1 }), box(len, 0.05, 0.06, pal.white, { x: m, y: deckY + 0.1, z: zf - 0.1 }));
    const nb = Math.max(2, Math.round(len / 0.24));
    for (let q = 1; q < nb; q++) parts.push(box(0.045, 0.66, 0.045, pal.white, { x: a + (q * len) / nb, y: deckY + 0.14, z: zf - 0.1 }));
  }
  if (gap !== null) parts.push(box(1.0, deckY * 0.66, 0.34, pal.deck, { x: gap, z: zf + 0.17 }), box(1.0, deckY * 0.33, 0.34, pal.deck, { x: gap, z: zf + 0.5 }));
  // the lean-to roof (a shingled slab), the beam over the posts and the white fascia
  const drop = 0.42; const run = depth + 0.32; const L = Math.hypot(run, drop); const ang = Math.atan2(drop, run);
  parts.push(xform(box(w + 0.3, 0.1, L, pal.roof), { x: cx, y: roofY + drop / 2 - 0.05, z: zWall + run / 2, rx: ang }));
  parts.push(box(w + 0.02, 0.16, 0.12, pal.white, { x: cx, y: roofY - 0.16, z: zf - 0.1 }), box(w + 0.3, 0.14, 0.05, pal.white, { x: cx, y: roofY - 0.1, z: zf + 0.21 }));
  return mergeAll(parts);
}
/** A porch swing hung from the porch beam (two seats' width), facing +z. */
function porchSwing(pal) {
  return mergeAll([box(1.3, 0.07, 0.45, pal.white, { y: 0.55 }), box(1.3, 0.42, 0.06, pal.white, { y: 0.62, z: -0.2, rx: -0.12 }),
    ...[-1, 1].map((s) => box(0.06, 0.32, 0.4, pal.white, { x: s * 0.62, y: 0.6 })), box(1.1, 0.1, 0.36, '#E8A0A8', { y: 0.62 }),
    ...[-1, 1].flatMap((s) => [box(0.02, 1.5, 0.02, '#5E5A55', { x: s * 0.6, y: 0.62, z: 0.15 }), box(0.02, 1.5, 0.02, '#5E5A55', { x: s * 0.6, y: 0.62, z: -0.18 })])]);
}
/** A dormer on a roof slope facing +z: walls, its own little gable roof and a window (base at y = 0, front at z = 0). */
function dormer(pal, w = 0.95, h = 0.85, d = 1.2) {
  return mergeAll([box(w, h, d, pal.red, { z: -d / 2 }), ...[-1, 1].map((s) => box(0.1, h, 0.1, pal.white, { x: s * (w / 2 - 0.03), z: -0.03 })),
    xform(pitchedRoof(w + 0.1, d + 0.1, 0.5, pal.roof, { oh: 0.12, gableHex: pal.red, trim: pal.white, bands: 3, ridge: false }), { y: h, z: -d / 2 + 0.05 }),
    xform(windowBox(0.5, 0.55, { frame: pal.white }), { y: 0.15, z: 0.02 })]);
}
/** A rooster weathervane on a post (stands on y = 0). */
function weathervane() {
  const IRONK = '#3A3A3A'; const GILT = '#C87533';
  const sh = new THREE.Shape();
  sh.moveTo(-0.28, 0); sh.lineTo(0.18, 0); sh.lineTo(0.22, 0.12); sh.lineTo(0.3, 0.18); sh.lineTo(0.26, 0.3); sh.lineTo(0.16, 0.26);
  sh.lineTo(0.12, 0.14); sh.lineTo(-0.05, 0.2); sh.lineTo(-0.2, 0.36); sh.lineTo(-0.26, 0.18); sh.lineTo(-0.28, 0);
  const bird = xform(P(new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false }), GILT), { y: 0.62, z: -0.015 });
  return xform(mergeAll([cyl(0.02, 0.02, 1.0, 5, IRONK, {}, 0), box(0.4, 0.02, 0.02, IRONK, { y: 0.45 }), box(0.02, 0.02, 0.4, IRONK, { y: 0.45 }), bird]), { s: 0.85 });
}
/**
 * The farmhouse (wish B, after the owners' reference picture): a red two-storey American farmhouse with white
 * clapboard trim and corner boards, a steep grey gabled roof whose gable faces the yard, a smaller one-storey side wing
 * with the front door under its porch, a brick chimney (it smokes: anchor `chimney`) and flowering shrubs at the
 * foundation. The tiers follow content's UPGRADES.farmhouse `look` (cumulative): 1 'porch_swing': fresh paint, the
 * porch wrapping round the front of the main house with a porch swing, shutters and flower boxes; 2 'sunroom': the
 * wing's porch glazed into a sunroom, two dormers on the wing; 3 'weathervane': a copper rooster on the ridge, lamp
 * posts lighting the path to the steps (night lights), string lights on the porch, a bay window and a second chimney.
 */
function farmhouseW4(tier = 0) {
  const L = FHL; const pal = tier >= 1 ? FH_FRESH : FH;
  const parts = []; const windows = []; const lamps = [];
  const mFront = L.MZ + L.MD / 2; const wFront = L.WZ + L.WD / 2;
  // stone foundations under both blocks
  parts.push(box(L.MW + 0.14, L.PL, L.MD + 0.14, FH.stone, { x: L.MX, z: L.MZ }), box(L.WW + 0.14, L.PL, L.WD + 0.14, FH.stone, { x: L.WX, z: L.WZ }));
  parts.push(clapboard(L.MW, L.MH, L.MD, pal, { x: L.MX, y0: L.PL, z: L.MZ }), clapboard(L.WW + 0.1, L.WH, L.WD, pal, { x: L.WX - 0.05, y0: L.PL, z: L.WZ }));
  // a white band between the storeys of the main house
  parts.push(box(L.MW + 0.04, 0.12, L.MD + 0.04, pal.white, { x: L.MX, y: L.PL + 2.05, z: L.MZ }));
  parts.push(xform(pitchedRoof(L.MW, L.MD, 2.35, pal.roof, { oh: 0.34, gableHex: pal.red, trim: pal.white, bands: 9 }), { x: L.MX, y: L.PL + L.MH, z: L.MZ }));
  parts.push(xform(pitchedRoof(L.WD, L.WW + 0.3, 1.45, pal.roof, { oh: 0.3, gableHex: pal.red, trim: pal.white, bands: 6 }), { ry: Math.PI / 2, x: L.WX - 0.15, y: L.PL + L.WH, z: L.WZ }));
  // windows: the main house's front (two a floor and one in the gable), its right side, its back; the wing's
  const sh = tier >= 1;
  for (const dx of [-0.95, 0.95]) {
    for (const [y, h] of [[L.PL + 0.75, 1.1], [L.PL + 2.6, 1.05]]) {
      parts.push(fhWindow(pal, 'front', L.MX + dx, mFront + 0.01, y, { h, shutters: sh }));
      windows.push([L.MX + dx, y + h / 2, mFront + 0.06]);
    }
    parts.push(fhWindow(pal, 'back', L.MX + dx, L.MZ - L.MD / 2 - 0.01, L.PL + 0.75), fhWindow(pal, 'back', L.MX + dx, L.MZ - L.MD / 2 - 0.01, L.PL + 2.6, { h: 1.05 }));
  }
  parts.push(fhWindow(pal, 'front', L.MX, mFront + 0.01, L.PL + L.MH + 0.45, { w: 0.6, h: 0.75 }));
  for (const dz of [-0.85, 0.8]) for (const y of [L.PL + 0.75, L.PL + 2.6]) {
    if (tier >= 3 && y < 2 && dz > 0) continue;                         // the bay window takes this spot
    parts.push(fhWindow(pal, 'right', L.MZ + dz, L.MX + L.MW / 2 + 0.01, y, { h: y > 2 ? 1.05 : 1.1 }));
  }
  parts.push(fhWindow(pal, 'front', L.WX + 0.62, wFront + 0.01, L.PL + 0.7, { w: 0.75, h: 1.05 }));
  windows.splice(2, 0, [L.WX + 0.62, L.PL + 1.22, wFront + 0.06]);
  parts.push(fhWindow(pal, 'left', L.WZ, L.WX - L.WW / 2 - 0.06, L.PL + 0.7, { w: 0.75, h: 1.05 }), fhWindow(pal, 'back', L.WX, L.WZ - L.WD / 2 - 0.01, L.PL + 0.7, { w: 0.75, h: 1.05 }));
  // the front door on the wing, a wall lantern beside it
  parts.push(xform(fhDoor(pal), { x: L.WX - 0.45, y: L.PL + 0.06, z: wFront + 0.01 }));
  parts.push(xform(wallLamp(), { x: L.WX + 0.12, y: L.PL + 1.55, z: wFront + 0.12 }));
  lamps.push([r3(L.WX + 0.12), r3(L.PL + 1.7), r3(wFront + 0.14)]);
  // the brick chimney through the main roof's back slope
  const chX = L.MX + 0.95; const chZ = L.MZ - 0.75; const chTop = L.PL + L.MH + 2.35 + 0.45;
  parts.push(box(0.62, chTop - (L.PL + L.MH), 0.62, FH.brick, { x: chX, y: L.PL + L.MH, z: chZ }), box(0.76, 0.14, 0.76, '#7F7A72', { x: chX, y: chTop, z: chZ }));
  for (let y = L.PL + L.MH + 1.2; y < chTop - 0.1; y += 0.26) parts.push(box(0.64, 0.025, 0.64, '#8E3D30', { x: chX, y, z: chZ }));
  const chimneyAnchor = [r3(chX), r3(chTop + 0.16), r3(chZ)];
  // porches: the wing's (glazed into a sunroom at tier 3), and from tier 1 the main house's (with a swing)
  if (tier < 2) parts.push(porchRun(L.WX - L.WW / 2, L.WX + L.WW / 2, wFront, L.ZF - wFront, pal, { gap: L.WX - 0.45, roofY: L.PL + 2.12 }));
  if (tier >= 1) {
    parts.push(porchRun(L.WX + L.WW / 2, L.MX + L.MW / 2, mFront, L.ZF - mFront, pal, { gap: tier >= 2 ? L.MX - 0.2 : null, roofY: L.PL + 2.12 }));
    parts.push(xform(porchSwing(pal), { x: L.MX + 0.7, y: L.PL + 0.06, z: mFront + 0.55 }));
    // flower boxes under the ground-floor windows of the main front
    for (const dx of [-0.95, 0.95]) parts.push(xform(mergeAll([box(0.95, 0.22, 0.24, pal.white), ...[0, 1, 2, 3, 4].map((i) => xform(flatFlower(['#FF7A9C', '#FFD21F', '#FFFFFF'][i % 3], 0.075), { x: -0.36 + i * 0.18, y: 0.26, z: 0.02 })),
      ...[0, 1, 2].map((i) => xform(blob(0.09, LEAF, { seed: i + 3, detail: 0 }), { x: -0.3 + i * 0.3, y: 0.22 }))]), { x: L.MX + dx, y: L.PL + 0.48, z: mFront + 0.14 }));
    // hanging baskets of flowers between the porch posts
    for (const x of [L.WX - 0.2, L.MX - 0.6]) parts.push(xform(mergeAll([cyl(0.006, 0.006, 0.35, 3, '#5E5A55', { y: 0.2 }, 0), xform(lathe([[0, 0], [0.16, 0.02], [0.2, 0.16], [0, 0.16]], 8, '#C99A5A'), {}),
      xform(blob(0.17, LEAF, { seed: 9, detail: 1, sy: 0.7 }), { y: 0.18 }), xform(flatFlower('#FF5A7A', 0.07), { y: 0.3, z: 0.08, rx: 0.6 })]), { x, y: L.PL + 1.45, z: L.ZF - 0.12 }));
  }
  if (tier >= 3) {
    // a bay window on the main house's right side and a lean-to at the back
    const bx = L.MX + L.MW / 2;
    const bay = [box(0.55, 1.35, 1.7, pal.red, { x: bx + 0.27, y: L.PL + 0.05, z: L.MZ + 0.8 }), box(0.7, 0.12, 1.86, pal.white, { x: bx + 0.3, y: L.PL + 1.4, z: L.MZ + 0.8 }),
      xform(box(0.8, 0.08, 2.0, pal.roof), { x: bx + 0.33, y: L.PL + 1.54, z: L.MZ + 0.8, rz: -0.35 })];
    for (const dz of [-0.5, 0, 0.5]) bay.push(xform(windowBox(0.4, 0.85, { frame: pal.white, cross: false }), { ry: Math.PI / 2, x: bx + 0.56, y: L.PL + 0.35, z: L.MZ + 0.8 + dz }));
    parts.push(...bay);
    const lz = L.MZ - L.MD / 2;
    parts.push(clapboard(2.6, 2.1, 0.95, pal, { x: L.MX - 0.2, y0: L.PL, z: lz - 0.47 }), box(2.8, 0.36, 1.0, FH.stone, { x: L.MX - 0.2, z: lz - 0.47 }),
      xform(box(2.9, 0.1, 1.3, pal.roof), { x: L.MX - 0.2, y: L.PL + 2.25, z: lz - 0.52, rx: -0.45 }), fhWindow(pal, 'back', L.MX - 0.2, lz - 0.96, L.PL + 0.7, { w: 0.7, h: 0.9 }));
  }
  if (tier >= 2) {
    // the wing's porch glazed into a sunroom: a clapboard knee wall, white mullions, pale glass walls and a glass roof
    const x0 = L.WX - L.WW / 2; const x1 = L.WX + L.WW / 2; const z0 = wFront; const z1 = L.ZF; const cx = (x0 + x1) / 2; const cz = (z0 + z1) / 2;
    const GL = '#CFE7EE';
    parts.push(box(x1 - x0, L.PL + 0.06, z1 - z0, FH.stone, { x: cx, z: cz }), clapboard(x1 - x0, 0.62, z1 - z0, pal, { x: cx, y0: L.PL + 0.05, z: cz }));
    const gh = 1.65; const gy = L.PL + 0.67;
    parts.push(box(x1 - x0 - 0.04, gh, 0.05, GL, { x: cx, y: gy, z: z1 - 0.05 }), box(0.05, gh, z1 - z0 - 0.05, GL, { x: x0 + 0.04, y: gy, z: cz }));
    for (let k = 0; k <= 5; k++) parts.push(box(0.07, gh, 0.09, pal.white, { x: x0 + 0.05 + (k * (x1 - x0 - 0.1)) / 5, y: gy, z: z1 - 0.05 }));
    for (let k = 0; k <= 2; k++) parts.push(box(0.09, gh, 0.07, pal.white, { x: x0 + 0.04, y: gy, z: z0 + 0.05 + (k * (z1 - z0 - 0.1)) / 2 }));
    parts.push(box(x1 - x0 + 0.04, 0.1, z1 - z0 + 0.04, pal.white, { x: cx, y: gy + gh, z: cz }));
    const run = z1 - z0 + 0.15; const drop = 0.35; const ang = Math.atan2(drop, run);
    parts.push(xform(box(x1 - x0 + 0.2, 0.06, Math.hypot(run, drop), GL), { x: cx, y: gy + gh + drop / 2 + 0.06, z: z0 + run / 2, rx: ang }));
    for (let k = 0; k <= 4; k++) parts.push(xform(box(0.06, 0.08, Math.hypot(run, drop), pal.white), { x: x0 + (k * (x1 - x0)) / 4, y: gy + gh + drop / 2 + 0.08, z: z0 + run / 2, rx: ang }));
    // plants inside, seen through the glass
    for (const [px, pz] of [[x0 + 0.45, z1 - 0.45], [x1 - 0.5, z1 - 0.4]]) parts.push(xform(mergeAll([cyl(0.2, 0.15, 0.3, 8, '#C8643A'), xform(blob(0.32, LEAF, { seed: Math.round(px * 10), detail: 1 }), { y: 0.55 })]), { x: px, y: L.PL + 0.06, z: pz }));
    for (const dx of [-0.55, 0.6]) parts.push(xform(dormer(pal), { x: L.WX + dx, y: L.PL + L.WH + 0.28, z: wFront - 0.42 }));
  }
  if (tier >= 3) {
    parts.push(xform(stack(1.5, 0.5), { x: L.WX - 0.7, y: L.PL + L.WH + 0.6, z: L.WZ - 0.75 }));
    parts.push(xform(weathervane(), { x: L.MX, y: L.PL + L.MH + 2.35, z: L.MZ + L.MD / 2 - 0.25 }));
    // the lamp-lit path: two lamp posts either side of the main steps and one by the wing (each a night light)
    for (const [lx, lz] of [[L.MX - 0.95, L.ZF + 0.95], [L.MX + 0.55, L.ZF + 0.95], [L.WX - 0.45, L.ZF + 1.05]]) {
      parts.push(xform(lampPost(1.75), { x: lx, z: lz }));
      lamps.push([r3(lx), 1.9, r3(lz)]);
    }
    // string lights along the main porch's eave (each bulb a little night light)
    const ax = L.WX + L.WW / 2 + 0.1; const bx = L.MX + L.MW / 2 - 0.1; const ly = L.PL + 2.05; const lz = L.ZF + 0.16;
    parts.push(lightString([ax, ly, lz], [bx, ly, lz], 9, { sag: 0.22 }));
    lamps.push([r3((ax + bx) / 2), r3(ly - 0.25), r3(lz)]);
  }
  // flowering shrubs along the foundations
  const bushes = [[L.MX + L.MW / 2 + 0.35, L.ZF - 0.2], [L.WX - L.WW / 2 - 0.3, wFront - 0.2], [L.MX - 0.9, L.ZF + 0.42], [L.MX + 1.3, L.ZF + 0.4]];
  bushes.forEach(([x, z], i) => { if (tier < 1 && i >= 2) return; parts.push(xform(fhBush(i + 3, i >= 2 ? 0.34 : 0.42, i % 2 ? ['#FFD21F', '#FFFFFF'] : ['#FF7A9C', '#FFFFFF']), { x, z })); });
  if (tier < 1) parts.push(xform(fhBush(8, 0.36), { x: L.MX - 0.6, z: mFront + 0.35 }), xform(fhBush(9, 0.36, ['#FFD21F', '#FFFFFF']), { x: L.MX + 1.0, z: mFront + 0.35 }));
  return withAnchors(mergeAll(parts), { chimney: chimneyAnchor, windows: windows.slice(0, 5).map((p) => p.map(r3)), lamps });
}

/**
 * The Well (wish E): one model family so each tier reads as the same well, improved (content UPGRADES.well `look`):
 * 0 a fieldstone well, two posts and a beam with a rope and a pail; 1 'stone_rim': a dressed limestone cap and a
 * flagstone apron; 2 'crank': a windlass drum with a crank handle and a big bucket; 3 'roof': a shingled roof, flowers.
 */
function wellW4(tier = 0) {
  const STONES = ['#A9A296', '#9A9387', '#B7B0A3', '#8F887D'];
  const parts = [];
  const R = 0.88; const H = 0.82;
  // the round wall: three courses of stones laid round, each course offset half a stone
  for (let c = 0; c < 3; c++) {
    const n = 12; const h = H / 3;
    for (let i = 0; i < n; i++) {
      const a = ((i + (c % 2) * 0.5) / n) * Math.PI * 2;
      parts.push(xform(box((2 * Math.PI * R) / n - 0.03, h - 0.025, 0.26, STONES[(i * 7 + c * 3) % 4]), { x: Math.cos(a) * R, y: c * h, z: Math.sin(a) * R, ry: -a + Math.PI / 2 }));
    }
  }
  parts.push(cyl(R - 0.12, R - 0.12, 0.04, 14, '#2F4F5A', { y: H - 0.32 }, 0));            // dark water deep inside
  if (tier >= 1) {
    parts.push(xform(torus(R + 0.02, 0.12, '#D9D0BE', {}, 4, 18), { y: H + 0.02, rx: Math.PI / 2, sy: 1, sz: 0.7 }));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.2; const rr = R + 0.55 + (i % 2) * 0.12;
      parts.push(xform(blob(0.32, ['#A9A193', '#9C9486', '#B4AC9D'][i % 3], { seed: 30 + i, amp: 0.25, sy: 0.08, detail: 1 }), { x: Math.cos(a) * rr, y: 0.02, z: Math.sin(a) * rr }));
    }
  } else parts.push(xform(torus(R, 0.08, '#9A9387', {}, 4, 14), { y: H, rx: Math.PI / 2 }));
  // the frame: two posts and a plain beam with the rope and a pail (tier 2 'crank': a windlass drum, a crank handle and a
  // big bucket hanging ready)
  for (const s0 of [-1, 1]) parts.push(box(0.14, 2.0, 0.14, WOOD_D, { x: s0 * (R + 0.05), y: 0.1 }));
  const bucket = (k = 1) => mergeAll([cyl(0.17 * k, 0.13 * k, 0.26 * k, 10, '#9A6438'), torus(0.16 * k, 0.012, '#5E5A55', { y: 0.24 * k, rx: Math.PI / 2 }, 3, 10), xform(torus(0.16 * k, 0.01, '#5E5A55', {}, 3, 10), { y: 0.3 * k, sy: 1.2 })]);
  if (tier >= 2) {
    parts.push(xform(cyl(0.08, 0.08, 2 * R + 0.3, 8, WOOD), { rz: Math.PI / 2, y: 1.6 }), xform(cyl(0.12, 0.12, 0.72, 10, '#C9A26A'), { rz: Math.PI / 2, y: 1.6 }),
      ...[-0.2, 0, 0.2].map((x) => xform(torus(0.122, 0.012, '#B58A4A', {}, 3, 10), { x, y: 1.6, ry: Math.PI / 2 })));
    parts.push(box(0.05, 0.32, 0.05, WOOD_D, { x: R + 0.22, y: 1.44 }), box(0.24, 0.05, 0.05, WOOD_D, { x: R + 0.32, y: 1.42 }));
    parts.push(cyl(0.012, 0.012, 0.6, 3, '#C9B48A', { y: 1.0 }, 0), xform(bucket(1.35), { y: 0.68 }));
  } else {
    parts.push(box(2 * R + 0.3, 0.12, 0.12, WOOD_D, { y: 1.62 }), cyl(0.012, 0.012, 0.7, 3, '#C9B48A', { y: 0.95 }, 0), xform(bucket(0.9), { y: 0.72 }));
  }
  if (tier >= 3) {
    // the little shingled roof on the frame, flowers at its foot
    parts.push(xform(pitchedRoof(2 * R + 0.5, 1.5, 0.75, '#A84F3D', { oh: 0.18, gableHex: WOOD, trim: '#F3E6CC', bands: 4 }), { ry: Math.PI / 2, y: 2.08 }));
    parts.push(box(2 * R + 0.42, 0.1, 0.12, WOOD_D, { y: 2.0 }));
    parts.push(xform(flowerClump(rng('well3a'), ['#FF7A9C', '#FFFFFF']), { x: -R - 0.55, z: 0.7 }), xform(flowerClump(rng('well3b'), ['#FFD21F', '#9C7FD0']), { x: R + 0.6, z: 0.8 }));
  }
  return mergeAll(parts);
}

/** The Market Stand's tiers (wish E, content `look`): the stand as before plus 1 'awning': a striped awning over the
 *  front and bunting; 2 'chalkboard': a chalkboard price sign, a brass hanging scale and more crates; 3 'cart': a
 *  flower cart beside the stand and flower boxes along the counter. */
async function marketStandW4(tier) {
  const st = await srcFit(MVP('MarketStand_1'), { w: 4, d: 4, fill: 0.85, sat: MV_SAT, recolor: { RoofTiles_Red: '#E84A3A', Beige: '#FFF2D6' } });
  const b = bounds(st);
  const parts = [st];
  const fruits = ['#E23B3B', '#F59A23', '#9BD86A', '#F2D04B', '#9C4FA6'];
  const crateOf = (i) => { const c = crate(0.5); const top = []; for (let k = 0; k < 6; k++) top.push(ball(0.09, fruits[(i + k) % 5], { x: ((k % 3) - 1) * 0.14, y: 0.55, z: (Math.floor(k / 3) - 0.5) * 0.15 }, 0)); return mergeAll([c, ...top]); };
  for (let i = 0; i < 3; i++) parts.push(xform(crateOf(i), { x: -0.9 + i * 0.85, z: 1.55 }));
  if (tier >= 1) {
    parts.push(xform(awning(b.max.x - b.min.x + 0.2, 0.9, ['#FFF8EC', '#2BA39A'], 9), { y: b.max.y * 0.72, z: b.max.z - 0.15 }));
    const cols = ['#FF7A6B', '#FFC83D', '#2BB3A3', '#4AA8E8', '#FF9FB0'];
    for (let i = 0; i < 9; i++) { const t = i / 8; parts.push(xform(P(new THREE.ConeGeometry(0.1, 0.24, 3), cols[i % 5]), { rx: Math.PI, x: b.min.x + 0.2 + t * (b.max.x - b.min.x - 0.4), y: b.max.y * 0.7 - 0.2 - Math.sin(t * Math.PI) * 0.18, z: b.max.z + 0.62, sz: 0.2 })); }
  }
  if (tier >= 2) {
    // an A-frame chalkboard at the front corner, two more crates stacked at the side
    parts.push(xform(mergeAll([xform(box(0.7, 0.9, 0.05, '#2E3B33'), { rx: -0.22, z: 0.12 }), xform(box(0.7, 0.9, 0.05, '#2E3B33'), { rx: 0.22, z: -0.12 }),
      xform(box(0.78, 0.06, 0.08, WOOD), { y: 0.88 }), ...[0.25, 0.45, 0.62].map((y, i) => xform(box(0.42 - i * 0.1, 0.04, 0.01, '#F2F0E6'), { y, z: 0.2, rx: -0.22 }))]), { x: b.max.x + 0.15, z: b.max.z + 0.45, ry: -0.4 }));
    parts.push(xform(crateOf(3), { x: b.min.x - 0.15, z: 0.9, ry: 0.2 }), xform(crateOf(4), { x: b.min.x - 0.15, y: 0.6, z: 0.9, ry: -0.1 }), xform(crateOf(1), { x: b.min.x - 0.2, z: 0.25, ry: 0.4 }));
  }
  if (tier >= 2) {
    const BR = '#C9952E';
    parts.push(xform(mergeAll([cyl(0.01, 0.01, 0.5, 3, '#5E5A55', { y: 0.32 }, 0), cyl(0.16, 0.16, 0.12, 12, BR, { y: 0.22 }), cyl(0.12, 0.12, 0.13, 12, '#F2F0E6', { y: 0.215, z: 0.01 }),
      cyl(0.01, 0.01, 0.2, 3, '#5E5A55', { y: 0.02 }, 0), xform(lathe([[0, 0], [0.18, 0], [0.2, 0.06], [0, 0.05]], 10, BR), { y: -0.04 })]), { x: 0.6, y: b.max.y * 0.62, z: b.max.z - 0.35 }));
  }
  if (tier >= 3) {
    for (const x of [-0.95, 0.95]) parts.push(xform(mergeAll([box(1.0, 0.22, 0.24, '#2BA39A'), ...[0, 1, 2, 3, 4].map((i) => xform(flatFlower(['#FF7A9C', '#FFD21F', '#FFFFFF'][i % 3], 0.08), { x: -0.38 + i * 0.19, y: 0.27, z: 0.02 })),
      ...[0, 1, 2].map((i) => xform(blob(0.1, LEAF, { seed: i + 7, detail: 0 }), { x: -0.32 + i * 0.32, y: 0.22 }))]), { x, y: 0.15, z: b.max.z + 0.08 }));
    // the flower cart: a wooden barrow on two wheels, its bed full of potted flowers, at the stand's side
    const cart = [box(1.3, 0.35, 0.8, WOOD, { y: 0.45 }), box(1.36, 0.06, 0.86, WOOD_D, { y: 0.8 }), box(1.1, 0.06, 0.06, WOOD_D, { x: -1.05, y: 0.62, z: 0.3, rz: 0.25 }),
      box(1.1, 0.06, 0.06, WOOD_D, { x: -1.05, y: 0.62, z: -0.3, rz: 0.25 }), box(0.1, 0.45, 0.1, WOOD_D, { x: 0.55, z: 0.3 }), box(0.1, 0.45, 0.1, WOOD_D, { x: 0.55, z: -0.3 })];
    for (const z of [-0.45, 0.45]) cart.push(xform(cyl(0.32, 0.32, 0.06, 14, '#8A5A35', {}, 40), { rx: Math.PI / 2, x: 0.05, y: 0.32, z }), xform(cyl(0.08, 0.08, 0.08, 8, '#5E5A55', {}, 40), { rx: Math.PI / 2, x: 0.05, y: 0.32, z }));
    for (let i = 0; i < 6; i++) cart.push(xform(mergeAll([cyl(0.12, 0.09, 0.16, 8, '#C8643A'), xform(flowerClump(rng(`cart${i}`), [['#FF7A9C', '#FFD21F'], ['#FFFFFF', '#9C7FD0'], ['#FF5A5A', '#FFC83D']][i % 3], 4, 0.22), { y: 0.14 })]), { x: -0.4 + (i % 3) * 0.4, y: 0.84, z: -0.2 + Math.floor(i / 3) * 0.4 }));
    parts.push(xform(mergeAll(cart), { x: b.max.x + 0.18, z: 0.05, ry: -1.35, s: 0.72 }));
  }
  return mergeAll(parts);
}

/** A bench's tiers (wish E, `UPGRADES.bench.defs`, content `look`): 1 'cushions'; 2 'planters': a flower planter at
 *  each end; 3 'lantern_arch': an arch of white posts with roses climbing it and a lantern at its apex (a night light,
 *  anchor `lamps`). `seat` = [seat height, seat half-width, seat z]. */
function benchExtras(tier, { seat = [0.5, 1.2, 0], w = 3.4, swing = false } = {}) {
  const parts = []; const lamps = [];
  const [sy, hw, sz] = seat;
  if (tier >= 1) for (const s0 of [-1, 1]) {
    parts.push(xform(blob(0.32, s0 < 0 ? '#E86A7A' : '#F2C14A', { seed: s0 + 5, amp: 0.08, sy: 0.32, sx: 1.4, detail: 1 }), { x: s0 * hw * 0.48, y: sy + 0.08, z: sz }));
    parts.push(xform(blob(0.24, s0 < 0 ? '#F2C14A' : '#E86A7A', { seed: s0 + 9, amp: 0.08, sz: 0.4, detail: 1 }), { x: s0 * hw * 0.7, y: sy + 0.32, z: sz - 0.24, rx: -0.2 }));
  }
  if (tier >= 2) for (const s0 of [-1, 1]) {
    const planter = mergeAll([box(0.62, 0.42, 0.62, '#B5603C'), box(0.68, 0.06, 0.68, '#9A4E30', { y: 0.42 }), box(0.56, 0.04, 0.56, '#5A3420', { y: 0.4 }),
      xform(flowerClump(rng(`planter${s0}${swing}`), s0 < 0 ? ['#FF7A9C', '#FFFFFF', '#FFD21F'] : ['#9C7FD0', '#FFFFFF', '#FF9F43'], 6, 0.36), { y: 0.42 }),
      xform(blob(0.22, LEAF, { seed: s0 + 21, detail: 1, sy: 0.6 }), { y: 0.5 })]);
    parts.push(xform(planter, { x: s0 * (w / 2 + (swing ? 0.3 : 0.18)), z: swing ? 0.05 : 0.12, s: 0.9 }));
  }
  if (tier >= 3) {
    // an arch of white posts with roses climbing it, and a lantern hanging at its apex
    const ah = swing ? 2.75 : 2.3; const half = w / 2 + 0.05;
    const arch = [box(0.1, ah, 0.1, '#FFF8EC', { x: -half, z: -0.55 }), box(0.1, ah, 0.1, '#FFF8EC', { x: half, z: -0.55 })];
    const curve = xform(torus(half, 0.05, '#FFF8EC', {}, 5, 20), { y: ah, z: -0.55 });
    const cp = curve.getAttribute('position'); for (let i = 0; i < cp.count; i++) if (cp.getY(i) < ah) cp.setY(i, ah);
    arch.push(xform(curve, { sy: 0.5 }).translate(0, ah * 0.5, 0));
    const r = rng(`rosecanopy${swing}`);
    for (let i = 0; i < 16; i++) {
      const t = i / 15; const a = Math.PI * t;
      const px = -Math.cos(a) * half; const py = t < 0.15 || t > 0.85 ? ah * (0.35 + r() * 0.6) : ah + Math.sin(a) * half * 0.5;
      arch.push(xform(blob(0.2, i % 3 ? LEAF : LEAF_D, { seed: 60 + i, detail: 0 }), { x: px, y: py, z: -0.55 }));
      if (i % 2 === 0) arch.push(ball(0.09, ['#E83A55', '#FF7A9C', '#FFFFFF'][i % 3], { x: px + 0.08, y: py + 0.1, z: -0.4 }, 0));
    }
    const top = ah + half * 0.5;
    arch.push(cyl(0.008, 0.008, 0.25, 3, '#3A3A3A', { y: top - 0.25, z: -0.3 }, 0), xform(paperLantern('#F2A23A', 0.34), { y: top - 0.24, z: -0.3 }));
    lamps.push([0, r3(top - 0.55), -0.3]);
    parts.push(...arch);
  }
  return { parts, lamps };
}

/**
 * The doghouse (wish D): a proper little wooden kennel on a low plinth: vertical plank walls in warm honey, white corner
 * trim, a steep red shingled roof with white bargeboards, an arched door with a dark inside, the dog's name board with a
 * painted bone, a water bowl and a food bowl on a mat, and a chewed bone. Anchor `bed` [x, y, z] is where the dog lies.
 */
function dogHouseW4() {
  const WALL = '#D9A15B'; const PLANK = '#C08848'; const TRIM = '#FFF8EC'; const ROOF = '#C8473A';
  const W = 1.7; const D = 1.9; const H = 1.15; const parts = [];
  parts.push(box(W + 0.2, 0.14, D + 0.2, '#A39A8C'), box(W, H, D, WALL, { y: 0.14 }));
  for (let i = 1; i < 8; i++) { const x = -W / 2 + (i * W) / 8; for (const s of [-1, 1]) parts.push(box(0.025, H - 0.06, 0.02, PLANK, { x, y: 0.17, z: s * (D / 2 + 0.006) })); }
  for (let i = 1; i < 9; i++) { const z = -D / 2 + (i * D) / 9; for (const s of [-1, 1]) parts.push(box(0.02, H - 0.06, 0.025, PLANK, { x: s * (W / 2 + 0.006), y: 0.17, z })); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.1, H, 0.1, TRIM, { x: sx * (W / 2 - 0.01), y: 0.14, z: sz * (D / 2 - 0.01) }));
  parts.push(xform(pitchedRoof(W, D, 0.95, ROOF, { oh: 0.22, gableHex: WALL, trim: TRIM, bands: 5 }), { y: 0.14 + H }));
  // the arched doorway: a dark opening with a white surround
  const dw = 0.72; const dh = 0.82;
  const sh = new THREE.Shape(); sh.moveTo(-dw / 2, 0); sh.lineTo(dw / 2, 0); sh.lineTo(dw / 2, dh - dw / 2); sh.absarc(0, dh - dw / 2, dw / 2, 0, Math.PI, false); sh.lineTo(-dw / 2, 0);
  parts.push(xform(P(new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false, curveSegments: 8 }), '#2A1D14'), { y: 0.15, z: D / 2 + 0.005 }));
  const rim = new THREE.Shape(); rim.moveTo(-dw / 2 - 0.09, 0); rim.lineTo(dw / 2 + 0.09, 0); rim.lineTo(dw / 2 + 0.09, dh - dw / 2); rim.absarc(0, dh - dw / 2, dw / 2 + 0.09, 0, Math.PI, false); rim.lineTo(-dw / 2 - 0.09, 0);
  rim.holes.push(sh);
  parts.push(xform(P(new THREE.ExtrudeGeometry(rim, { depth: 0.04, bevelEnabled: false, curveSegments: 8 }), TRIM), { y: 0.15, z: D / 2 }));
  // the name board over the door with a painted bone
  parts.push(box(0.8, 0.2, 0.05, '#FFF8EC', { y: 0.14 + H + 0.12, z: D / 2 + 0.06 }), box(0.32, 0.05, 0.02, '#A8713A', { y: 0.14 + H + 0.195, z: D / 2 + 0.09 }),
    ...[-1, 1].flatMap((s) => [ball(0.04, '#A8713A', { x: s * 0.17, y: 0.14 + H + 0.24, z: D / 2 + 0.09, sz: 0.4 }, 0), ball(0.04, '#A8713A', { x: s * 0.17, y: 0.14 + H + 0.19, z: D / 2 + 0.09, sz: 0.4 }, 0)]));
  // the mat, two bowls (water, kibble) and a bone in front
  parts.push(box(1.0, 0.02, 0.55, '#7FA6C9', { x: 0.25, z: D / 2 + 0.55 }), box(0.9, 0.021, 0.08, '#FFF8EC', { x: 0.25, z: D / 2 + 0.55 }));
  const bowl = (fill) => mergeAll([lathe([[0, 0], [0.16, 0], [0.2, 0.09], [0.17, 0.09], [0.13, 0.02], [0, 0.02]], 12, '#4AA8E8'), cyl(0.15, 0.15, 0.02, 12, fill, { y: 0.06 }, 0)]);
  parts.push(xform(bowl('#8FD3E6'), { x: 0.75, y: 0.02, z: D / 2 + 0.6 }), xform(bowl('#A0663A'), { x: 0.32, y: 0.02, z: D / 2 + 0.68 }));
  parts.push(xform(mergeAll([cyl(0.025, 0.025, 0.28, 6, '#F5EFE0'), ...[-1, 1].flatMap((s) => [ball(0.045, '#F5EFE0', { x: 0.03, y: s > 0 ? 0.28 : 0, sz: 1 }, 0), ball(0.045, '#F5EFE0', { x: -0.03, y: s > 0 ? 0.28 : 0 }, 0)])]),
    { rz: Math.PI / 2, rx: 0.5, x: -0.7, y: 0.04, z: D / 2 + 0.75 }));
  return withAnchors(mergeAll(parts), { bed: [-0.25, 0.02, r3(D / 2 + 0.55)] });
}

/** The cat's basket: a woven wicker bed with a rolled rim, a plaid cushion and a ball of yarn. Anchor `bed`. */
function catBasketW4() {
  const parts = [lathe([[0, 0], [0.5, 0], [0.6, 0.18], [0.62, 0.3], [0.56, 0.32], [0.48, 0.1], [0, 0.1]], 14, '#C99A5A')];
  for (let i = 0; i < 2; i++) parts.push(xform(torus(0.6 - i * 0.02, 0.018, '#A87A40', {}, 3, 14), { y: 0.1 + i * 0.1, rx: Math.PI / 2 }));
  parts.push(xform(torus(0.6, 0.06, '#B5843E', {}, 4, 14), { y: 0.31, rx: Math.PI / 2 }));
  parts.push(xform(blob(0.46, '#7FA6C9', { seed: 6, sy: 0.22, amp: 0.06, detail: 1 }), { y: 0.16 }));
  for (const a of [0, Math.PI / 2]) parts.push(xform(box(0.8, 0.012, 0.05, '#E8E4DA'), { y: 0.24, ry: a }));
  parts.push(ball(0.11, '#E86A7A', { x: 0.62, y: 0.11, z: 0.42 }, 1), xform(torus(0.11, 0.012, '#C84A5A', {}, 3, 10), { x: 0.62, y: 0.11, z: 0.42, ry: 0.6 }));
  return withAnchors(mergeAll(parts), { bed: [0, 0.2, 0] });
}

/** The bird bath (wish 10): a pedestal and a wide shallow basin; the water's surface is anchor `water` [x, y, z, r] (the
 *  view ripples it and lands the birds on its rim). */
function birdBathW4() {
  const parts = [lathe([[0, 0], [0.34, 0], [0.32, 0.1], [0.14, 0.2], [0.11, 0.76], [0.16, 0.84], [0.54, 0.92], [0.58, 1.02], [0.52, 1.04], [0.46, 0.98], [0, 0.98]], 16, '#C9C3B8'),
    cyl(0.47, 0.47, 0.02, 16, '#79C3D3', { y: 0.985 }, 0)];
  parts.push(xform(torus(0.13, 0.02, '#B5AFA4', {}, 3, 12), { y: 0.5, rx: Math.PI / 2 }), xform(flowerClump(rng('bb1'), ['#9C7FD0', '#FFFFFF'], 4, 0.3), { x: 0.42, z: 0.32 }));
  return withAnchors(mergeAll(parts), { water: [0, 1.01, 0, 0.47] });
}

/**
 * The Rabbit Hutch (wish 3, content `hutch`, 3 x 2 tiles = 6 x 4 m): a two-storey timber hutch on legs at the back (a
 * mesh-fronted run upstairs, a closed sleeping box with a heart cut-out, a ramp down), a fenced grass run in front with a
 * tunnel, a carrot patch, a water bottle and a hay rack. `yard` is where the rabbits hop.
 */
function rabbitHutch() {
  const W = 5.6; const D = 3.6; const parts = [];
  parts.push(xform(yardGround(W, D, '#9CC067', { worn: '#B5A273', bedding: '#D8C690', gateZ: 1 }), {}));
  parts.push(penFence(W, D, { h: 0.6, pickets: true }));
  // the hutch at the back left: four legs, a floor at 0.7 m, the run (mesh front) and the sleeping box, a shingled roof
  const hx = -1.05; const hz = -1.05; const hw = 2.8; const hd = 1.0; const fy = 0.65; const hh = 0.95;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(box(0.1, fy, 0.1, WOOD_D, { x: hx + sx * (hw / 2 - 0.05), z: hz + sz * (hd / 2 - 0.05) }));
  parts.push(box(hw, 0.08, hd, WOOD_D, { x: hx, y: fy, z: hz }), box(hw, hh, 0.06, WOOD, { x: hx, y: fy + 0.08, z: hz - hd / 2 + 0.03 }));
  // the sleeping box (closed, a heart window) on the left third, the mesh run on the right two thirds
  const bw = hw * 0.36;
  parts.push(box(bw, hh, hd, '#E8C08A', { x: hx - hw / 2 + bw / 2, y: fy + 0.08, z: hz }));
  parts.push(xform(heartGeo(0.42, '#3A2A1A'), { x: hx - hw / 2 + bw / 2, y: fy + 0.55, z: hz + hd / 2 + 0.005 }));
  const rx0 = hx - hw / 2 + bw; const rw = hw - bw;
  for (let i = 0; i <= 6; i++) parts.push(box(0.025, hh, 0.025, '#B9BEC2', { x: rx0 + (i * rw) / 6, y: fy + 0.08, z: hz + hd / 2 - 0.02 }));
  for (let j = 1; j < 4; j++) parts.push(box(rw, 0.02, 0.02, '#B9BEC2', { x: rx0 + rw / 2, y: fy + 0.08 + (j * hh) / 4, z: hz + hd / 2 - 0.02 }));
  for (const x of [rx0, hx + hw / 2]) parts.push(box(0.08, hh, 0.08, WOOD_D, { x, y: fy + 0.08, z: hz + hd / 2 - 0.04 }));
  parts.push(box(0.06, hh, hd, WOOD, { x: hx + hw / 2 - 0.03, y: fy + 0.08, z: hz }));
  parts.push(xform(pitchedRoof(hd + 0.1, hw + 0.1, 0.5, '#5C8A5A', { oh: 0.16, gableHex: WOOD, trim: '#FFF8EC', bands: 4 }), { ry: Math.PI / 2, x: hx, y: fy + 0.08 + hh, z: hz }));
  // the ramp down from the run's door, with cleats
  const ramp = xform(box(0.42, 0.04, 1.15, WOOD), { x: hx + hw / 2 - 0.45, y: fy * 0.5 - 0.02, z: hz + hd / 2 + 0.45, rx: -0.62 });
  parts.push(ramp);
  for (let i = 0; i < 4; i++) parts.push(xform(box(0.42, 0.03, 0.03, WOOD_D), { x: hx + hw / 2 - 0.45, y: fy - 0.12 - i * 0.14, z: hz + hd / 2 + 0.12 + i * 0.2, rx: -0.62 }));
  // the run: a wooden tunnel log, a hay rack on the fence, a water bottle, a little carrot patch
  parts.push(xform(cyl(0.3, 0.3, 0.9, 12, '#B58A5A'), { rz: Math.PI / 2, x: 1.6, y: 0.0, z: -0.9 }), xform(cyl(0.22, 0.22, 0.92, 12, '#3A2A1A'), { rz: Math.PI / 2, x: 1.6, y: 0.08, z: -0.9 }));
  parts.push(xform(mergeAll([box(0.9, 0.5, 0.08, WOOD_D), xform(blob(0.3, '#E3C25E', { seed: 4, sx: 1.4, sy: 0.6 }), { y: 0.35, z: 0.06 })]), { x: 2.3, y: 0.15, z: -D / 2 + 0.12 }));
  for (let i = 0; i < 5; i++) {
    const x = 0.6 + (i % 3) * 0.32; const z = 0.7 + Math.floor(i / 3) * 0.32;
    parts.push(box(0.2, 0.03, 0.2, '#6E4A2A', { x, z }), xform(mergeAll(fan(4, 0.22, 0.05, ['#4E9F3A', '#6BB040'], rng(`car${i}`), { bend: 0.4 })), { x, y: 0.03, z }), cone(0.04, 0.06, 6, '#F08A2C', { x, y: 0.02, z }));
  }
  parts.push(xform(mergeAll([cyl(0.05, 0.05, 0.28, 8, '#D7EEF2'), cyl(0.045, 0.045, 0.18, 8, '#8FD3E6', { y: 0.02 }), cyl(0.012, 0.012, 0.1, 4, '#C9CED3', { y: -0.08 }, 0)]), { x: -W / 2 + 0.12, y: 0.25, z: 0.8 }));
  return { geo: mergeAll(parts), yard: [-W / 2 + 0.3, -0.3, W / 2 - 0.3, D / 2 - 0.3], avoid: [[1.6, -0.9, 0.55], [hx + hw / 2 - 0.45, hz + hd / 2 + 0.45, 0.4]] };
}

/** Register a tiered variant (`<key>:<tier>` + its far twin) in a file of its own; anchors go to the manifest. */
function tierJob(key, file, meta, build, { far = BUILDING_FAR, cap = BUILDING_CAP } = {}) {
  job(key, file, meta, async () => {
    let g = await build();
    const anchors = g.anchors || null;
    if (tris(g) > cap * 1.04) g = await detailSimplify(g, cap, { maxErr: 0.006 });
    if (anchors) JOBS.find((j) => j.key === key).meta.anchors = anchors;
    return sway(g, { rigid: true });
  });
  if (far) {
    job(`${key}:far`, file, { family: meta.family, footprint: meta.footprint, part: true, far: true }, async () => {
      const src = await build();
      let g = src;
      for (const error of [0.05, 0.1, 0.2, 0.4]) {
        if (tris(g) <= far * 1.08) break;
        g = await simplify(src, far / tris(src), { error, deg: 35, lockBorder: false });
      }
      return sway(g, { rigid: true });
    });
  }
}
for (const t of [1, 2, 3]) {
  tierJob(`building:farmhouse:${t}`, `buildings/farmhouse-${t}.glb`, { family: 'building', def: 'farmhouse', footprint: [4, 4] }, async () => farmhouseW4(t));
  tierJob(`building:well:${t}`, `buildings/well-${t}.glb`, { family: 'building', def: 'well', footprint: [2, 2] }, async () => wellW4(t), { far: 0 });
  tierJob(`building:market_stand:${t}`, `buildings/market_stand-${t}.glb`, { family: 'building', def: 'market_stand', footprint: [2, 2] }, async () => marketStandW4(t));
  // the benches (sources as in section 13: the Sunset Bench turned round, the swing's frame and seat)
  tierJob(`decor:sunset_bench:${t}`, `decor/sunset_bench-${t}.glb`, { family: 'decor', def: 'sunset_bench', footprint: [2, 1] }, async () => {
    const b = xform(await srcFit(MVP('Bench_1'), { w: 3.4, d: 1.2, fill: 1, sat: 0.2, recolor: { Wood: '#C98A4A' } }), { ry: Math.PI });
    const ex = benchExtras(t, { seat: [0.48, 1.5, 0.05], w: 3.4 });
    const g = mergeAll([b, ...[-1.9, 1.9].map((x) => xform(flowerClump(rng(`b${x}`), ['#FF9F43', '#FFD21F']), { x, z: 0.1 })), ...ex.parts]);
    const bb = bounds(g); if (bb.min.y > 0.01) g.translate(0, -bb.min.y, 0);
    return ex.lamps.length ? withAnchors(g, { lamps: ex.lamps }) : g;
  }, { far: 0 });
  tierJob(`decor:bench_swing:${t}`, `decor/bench_swing-${t}.glb`, { family: 'decor', def: 'bench_swing', footprint: [2, 1] }, async () => {
    const ex = benchExtras(t, { seat: [0.93, 1.1, 0.05], w: 3.2, swing: true });
    const g = mergeAll([box(0.14, 2.4, 0.14, WOOD_D, { x: -1.6 }), box(0.14, 2.4, 0.14, WOOD_D, { x: 1.6 }), box(3.4, 0.14, 0.14, WOOD_D, { y: 2.4 }),
      xform(await srcFit(MVP('Bench_1'), { w: 2.4, d: 0.9, fill: 1, sat: 0.2 }), { y: 0.45, ry: Math.PI }), ...ex.parts]);
    return ex.lamps.length ? withAnchors(g, { lamps: ex.lamps }) : g;
  }, { far: 0 });
}

// The Rabbit Hutch (content `hutch`) and its far twin
job('home:hutch', 'homes/hutch.glb', { family: 'home', def: 'hutch', footprint: [3, 2] }, async () => {
  const { geo, yard, avoid } = rabbitHutch();
  const meta = JOBS.find((j) => j.key === 'home:hutch').meta;
  meta.yard = yard; meta.avoid = avoid;
  return sway(geo, { rigid: true });
});
job('home:hutch:far', 'homes/hutch.glb', { family: 'home', footprint: [3, 2], part: true, far: true }, async () => {
  const { geo } = rabbitHutch();
  let g = geo;
  for (const error of [0.05, 0.1, 0.2, 0.4]) { if (tris(g) <= 1800 * 1.08) break; g = await simplify(geo, 1800 / tris(geo), { error, deg: 35, lockBorder: false }); }
  return sway(g, { rigid: true });
});

// ---- Crops (wave 4): each a few hundred triangles a plant (CROP_BUDGET caps a plot), stages 0..2 = sprout, growing, ripe
/** Raspberry canes (wish 1): four or five arching canes with toothed leaves; white blossom and hard green drupes while
 *  growing, then hanging clusters of deep-red berries. */
function raspberryPlant(s, r, { far = false } = {}) {
  const c = CROPS.raspberry; const h = c.h[s];
  const parts = [];
  // a leafy mound under the canes (the plot reads green and full, not as bare sticks)
  if (s >= 1) parts.push(xform(blob(h * 0.34, c.leafHex, { seed: Math.floor(r() * 99), amp: 0.25, freq: 2.2, detail: far || s === 1 ? 0 : 1, flatBottom: 0.5, sx: 1.15 }), { y: h * 0.22 }));
  if (far && s >= 1) {
    // the far twin (~45 triangles a plant): the mound and three big berries (or blossoms) on top, no canes
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + r(); const at = { x: Math.cos(a) * h * 0.18, y: h * (0.5 + r() * 0.12), z: Math.sin(a) * h * 0.18 };
      parts.push(xform(P(new THREE.OctahedronGeometry(0.07, 0), s === 2 ? c.berry : '#F4F0E0', { creaseDeg: 80 }), at));
    }
    return mergeAll(parts);
  }
  // the growing stage stays inside its 250-triangle plot budget: three canes, one leaf and one blossom each
  const n = s === 2 ? 5 : 3;
  const tips = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.5;
    const lean = 0.18 + r() * 0.22; const hh = h * (0.78 + r() * 0.28);
    const cane = stalk(0.016, 0.009, hh, '#8A5A3A', 3);
    xform(cane, { rx: Math.cos(a) * lean, rz: -Math.sin(a) * lean });
    parts.push(cane);
    const tip = new THREE.Vector3(0, hh, 0).applyEuler(new THREE.Euler(Math.cos(a) * lean, 0, -Math.sin(a) * lean, 'YXZ'));
    tips.push(tip);
    if (!far) for (let k = 0; k < (s === 2 ? 2 : 1); k++) {
      const t = 0.5 + k * 0.25; const p = tip.clone().multiplyScalar(t);
      parts.push(xform(leaf(0.15 * (s === 0 ? 0.8 : 1), 0.1, k % 2 ? '#5BAA45' : c.leafHex, { bend: 0.4, seg: 1 }), { rx: 1.1, ry: a + k * 2.2, x: p.x, y: p.y, z: p.z }));
    }
  }
  if (s >= 1) for (const tip of tips) {
    const m = s === 2 ? 3 : 2;
    for (let q = 0; q < m; q++) {
      const at = { x: tip.x * 0.9 + Math.cos(q * 2.1) * 0.05, y: tip.y * 0.88 - q * 0.05, z: tip.z * 0.9 + Math.sin(q * 2.1) * 0.05 };
      if (s === 2) {
        const b = ball(far ? 0.05 : 0.042, q === 1 ? '#D7345A' : c.berry, { ...at, sy: 1.18 }, 0);
        shade(b, { bottom: 0.78, top: 1.2 });
        parts.push(b);
      } else if (q === 0) parts.push(xform(flatFlower('#FFFDF4', 0.055), at));
    }
  }
  return mergeAll(parts);
}
/** Roses (wish 7): a dark, glossy rose bush; closed buds tipped with red while growing, then open red blooms. */
function rosePlant(s, r) {
  const c = CROPS.rose; const h = c.h[s];
  const parts = [];
  if (s === 0) {
    for (const lf of fan(4, 0.13, 0.08, [c.leafHex, '#3F8F3A'], r, { bend: 0.5, seg: 1, tilt: 0.6 })) parts.push(lf);
    parts.push(stalk(0.012, 0.009, h * 0.9, '#3F6E2E', 3));
    return mergeAll(parts);
  }
  parts.push(xform(blob(h * 0.38, c.leafHex, { seed: Math.floor(r() * 99), amp: 0.24, freq: 2.2, detail: 0, flatBottom: 0.45, sx: 1.1 }), { y: h * 0.32 }));
  parts.push(xform(blob(h * 0.24, '#3F8F3A', { seed: Math.floor(r() * 99), amp: 0.2, detail: 0 }), { y: h * 0.55, x: (r() - 0.5) * 0.08 }));
  const nb = s === 2 ? 3 : 3;
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + r() * 0.6; const rad = h * (0.12 + r() * 0.16);
    const at = { x: Math.cos(a) * rad, y: h * (0.78 + r() * 0.2), z: Math.sin(a) * rad };
    parts.push(xform(stalk(0.008, 0.007, at.y - h * 0.4, '#3F6E2E', 3), { x: at.x * 0.8, y: h * 0.4, z: at.z * 0.8 }));
    if (s === 1) parts.push(cone(0.035, 0.08, 5, '#3F8F3A', at), cone(0.022, 0.05, 5, c.bloom, { ...at, y: at.y + 0.045 }));
    else {
      // an open bloom: five cupped outer petals round a tight darker heart
      const bloom = [];
      for (let q = 0; q < 5; q++) { const pa = (q / 5) * Math.PI * 2; bloom.push(xform(P(new THREE.OctahedronGeometry(0.045, 0), q % 2 ? c.bloom : '#E8384F'), { x: Math.cos(pa) * 0.04, z: Math.sin(pa) * 0.04, sy: 0.55, ry: pa })); }
      bloom.push(xform(P(new THREE.ConeGeometry(0.035, 0.06, 5), '#A8152E', { creaseDeg: 60 }), { y: 0.01 }));
      parts.push(xform(mergeAll(bloom), { ...at, rx: (r() - 0.5) * 0.5 }));
    }
  }
  return mergeAll(parts);
}
/** Coffee (wish 7): a straight-stemmed shrub with tiers of paired glossy dark leaves; cherries cluster along the
 *  branches, green while growing, red (a few still orange) when ripe. */
function coffeePlant(s, r, { far = false } = {}) {
  const c = CROPS.coffee; const h = c.h[s];
  const parts = [stalk(0.02, 0.012, h * 0.5, '#7A5A3A', 3)];
  if (s === 0) {
    for (let k = 0; k < 4; k++) parts.push(xform(leaf(0.13, 0.06, k % 2 ? '#3E8A3E' : c.leafHex, { bend: 0.25, seg: 1 }), { rx: 1.2, ry: (k / 4) * Math.PI * 2, y: h * 0.45 }));
    return mergeAll(parts);
  }
  // the shrub: a tall, slightly conical crown of glossy dark leaves (a lighter top where the sun catches it)
  const crown = xform(blob(h * 0.36, c.leafHex, { seed: Math.floor(r() * 99), amp: 0.22, freq: 2.4, detail: far ? 0 : 1, sy: 1.35, flatBottom: 0.6 }), { y: h * 0.52 });
  shade(crown, { bottom: 0.72, top: 1.25 });
  parts.push(crown);
  if (!far) for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + r(); parts.push(xform(leaf(0.16, 0.07, '#3E8A3E', { bend: 0.3, seg: 1 }), { rx: 1.35, ry: a, y: h * (0.35 + (k % 3) * 0.15) })); }
  // cherries in clusters of three on the crown's outside: green while growing, red (one orange) when ripe
  const b = bounds(crown);
  if (far) {
    // the far twin (~42 triangles a plant): the crown and two big cherries
    for (let i = 0; i < 2; i++) { const u = i * Math.PI + r(); parts.push(xform(P(new THREE.OctahedronGeometry(0.06, 0), s === 2 ? c.cherry : '#8DBE4A', { creaseDeg: 80 }), { x: Math.cos(u) * (b.max.x - b.min.x) * 0.45, y: (b.min.y + b.max.y) / 2, z: Math.sin(u) * (b.max.z - b.min.z) * 0.45 })); }
    return mergeAll([crown, parts[0], ...parts.slice(2)]);
  }
  const nc = s === 2 ? 5 : 3;
  for (let i = 0; i < nc; i++) {
    const u = (i / nc) * Math.PI * 2 + r() * 0.5; const v = 0.3 + r() * 0.45;
    const rx = (b.max.x - b.min.x) * 0.5; const rz = (b.max.z - b.min.z) * 0.5;
    const y = b.min.y + (b.max.y - b.min.y) * v; const k = Math.sin(Math.PI * (0.25 + v * 0.6));
    for (let q = 0; q < 3; q++) {
      const hex = s === 2 ? (q === 2 && i === 0 ? '#E8742E' : q === 1 ? '#D33A2E' : c.cherry) : '#8DBE4A';
      parts.push(xform(P(new THREE.OctahedronGeometry(far ? 0.05 : 0.036, 0), hex, { creaseDeg: 80 }), { x: Math.cos(u) * rx * k * 1.02 + (q - 1) * 0.035, y: y - (q % 2) * 0.03, z: Math.sin(u) * rz * k * 1.02, sy: 1.1 }));
    }
  }
  return mergeAll(parts);
}

// ---- The rabbit (wish 3): a round angora with long ears, a cotton tail and a twitchy nose; rigid (animals-view hops it
//      along: `hop`); the kit has a bigger head and shorter ears. The coat attribute lets breeding/season coats tint it.
function rabbitGeo({ baby = false } = {}) {
  const COAT = '#EFE7DC'; const INNER = '#F6B8B8';
  const fluff = (g) => { const n = g.getAttribute('position').count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = 1; a[i * 3 + 2] = 0.5; } g.setAttribute('coat', new THREE.BufferAttribute(a, 3)); return g; };
  const bare = (g) => { const n = g.getAttribute('position').count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a[i * 3 + 2] = 0.5; g.setAttribute('coat', new THREE.BufferAttribute(a, 3)); return g; };
  const hk = baby ? 1.28 : 1; const ek = baby ? 0.72 : 1;
  const parts = [
    fluff(xform(blob(0.2, COAT, { seed: 3, amp: 0.08, sx: 0.92, sy: 0.82, sz: 1.12, detail: 1 }), { y: 0.19, z: -0.04 })),
    fluff(xform(blob(0.13 * hk, COAT, { seed: 5, amp: 0.05, detail: 1, sz: 1.05 }), { y: 0.32 + (hk - 1) * 0.05, z: 0.15 })),
    fluff(xform(blob(0.07, '#FFFFFF', { seed: 7, amp: 0.2, detail: 0 }), { y: 0.22, z: -0.27 })),
    // cheek fluff, the hind feet, the front paws
    ...[-1, 1].map((sd) => fluff(xform(blob(0.06 * hk, COAT, { seed: 9 + sd, detail: 0 }), { x: sd * 0.07 * hk, y: 0.27, z: 0.21 }))),
    ...[-1, 1].map((sd) => fluff(xform(blob(0.07, COAT, { seed: 11 + sd, sx: 0.6, sy: 0.45, sz: 1.5, detail: 0 }), { x: sd * 0.12, y: 0.035, z: -0.06 }))),
    ...[-1, 1].map((sd) => fluff(xform(blob(0.04, COAT, { seed: 13 + sd, detail: 0 }), { x: sd * 0.06, y: 0.03, z: 0.14 }))),
  ];
  // the ears: long, a pink inside, leaning back a little and apart
  for (const sd of [-1, 1]) {
    const ear = mergeAll([fluff(xform(P(new THREE.CapsuleGeometry(0.035, 0.2 * ek, 2, 6), COAT, { creaseDeg: 60 }), { sz: 0.55 })),
      bare(xform(P(new THREE.CapsuleGeometry(0.022, 0.16 * ek, 1, 5), INNER, { creaseDeg: 60 }), { z: 0.016, sz: 0.4 }))]);
    parts.push(xform(ear, { x: sd * 0.05 * hk, y: 0.48 + (hk - 1) * 0.06 - (1 - ek) * 0.05, z: 0.1, rz: -sd * 0.18, rx: -0.28 }));
  }
  const eyeY = 0.35 + (hk - 1) * 0.05; const eyeZ = 0.15 + 0.11 * hk;
  parts.push(...[-1, 1].map((sd) => bare(ball(0.022 * hk, '#1E1612', { x: sd * 0.07 * hk, y: eyeY, z: eyeZ }, 0))),
    ...[-1, 1].map((sd) => bare(ball(0.007 * hk, '#FFFFFF', { x: sd * 0.07 * hk + 0.008, y: eyeY + 0.01, z: eyeZ + 0.016 }, 0))),
    bare(ball(0.018 * hk, '#E88A90', { y: eyeY - 0.045, z: 0.15 + 0.135 * hk, sx: 1.3 }, 0)));
  const g = mergeAll(parts);
  const m = g.getAttribute('coat');
  return coatAttribute(g, { isCoat: (i) => m.getX(i) > 0.5, share: 0.3, freq: 5, seed: 31 });
}
job('animal:rabbit', 'animals/rabbit.glb', { family: 'animal', def: 'rabbit', kind: 'rigid', speed: 0.55, hop: true, product: 'angora_wool', footprint: [1, 1] },
  async () => sway(rabbitGeo(), { rigid: true }));
job('animal:rabbit:baby', 'animals/rabbit.glb', { family: 'animal', def: 'rabbit', kind: 'rigid', speed: 0.6, hop: true, baby: true, footprint: [1, 1] },
  async () => sway(xform(rabbitGeo({ baby: true }), { s: 0.62 }), { rigid: true }));

// ---- Pet breeds (wish 6, rules `players[pid].pet.breed`; absent = the first): dog shiba (animal:dog) | husky |
//      shepherd (the UAA Wolf painted tan with a black saddle); cat orange tabby (animal:cat) | black | white. Each breed is
//      a file of its own, loaded only when a farmer's pet wears it.
const DOG_CLIPS = { Idle: 'Idle', Idle_2: 'Idle2', Eating: 'Eat', Walk: 'Walk', Gallop: 'Run', Jump_ToIdle: 'Jump', Death: 'Lie' };
skinnedJob('animal:dog:husky', 'animals/dog-husky.glb', 'quaternius-ultimate-animated-animals/glTF/Husky.gltf', { height: 0.66, clips: DOG_CLIPS,
  recolor: { Material: '#5D646D', 'Material.001': '#F7F5F0', 'Material.006': '#1E1E22' }, meta: { family: 'animal', headBone: 'Head', speed: 1.2, breed: 'husky' } });
skinnedJob('animal:dog:shepherd', 'animals/dog-shepherd.glb', 'quaternius-ultimate-animated-animals/glTF/Wolf.gltf', { height: 0.68, clips: DOG_CLIPS,
  recolor: { Main: '#B8743A', Main_Light: '#D9A766', Nose: '#1E1A18' }, saddle: { mat: /^Main$/, hex: '#2A2320', from: 0.6 },
  meta: { family: 'animal', headBone: 'Head', speed: 1.2, breed: 'shepherd' } });
skinnedJob('animal:cat:black', 'animals/cat-black.glb', 'quaternius-animal-pack-vol2/Animal Pack Vol.2 by @Quaternius/FBX/Cat.fbx', { height: 0.42, yaw: -Math.PI / 2,
  clips: { Idle: 'Idle', Walking: 'Walk' }, recolor: { White: '#3B3538', Grey: '#26222A', Pink: '#E59AA0' }, sat: 0.05,
  meta: { family: 'animal', headBone: 'Head', speed: 1.1, breed: 'black' } });
skinnedJob('animal:cat:white', 'animals/cat-white.glb', 'quaternius-animal-pack-vol2/Animal Pack Vol.2 by @Quaternius/FBX/Cat.fbx', { height: 0.42, yaw: -Math.PI / 2,
  clips: { Idle: 'Idle', Walking: 'Walk' }, recolor: { White: '#FFFFFF', Grey: '#F4F1EC', Pink: '#F4A6A0' }, sat: 0.05,
  meta: { family: 'animal', headBone: 'Head', speed: 1.1, breed: 'white' } });

// ---- Items (wave 4): the new crops and fruit, Fertilizer, the rabbit's wool and feed, and the new recipes
const raspberryBerry = (hex = '#C21E48', s = 1) => { const b = blob(0.13 * s, hex, { seed: 3, amp: 0.22, freq: 5, detail: 2, sy: 1.15 }); shade(b, { bottom: 0.78, top: 1.18 }); return b; };
const roseHead = (hex = '#D8243F', s = 1) => {
  const parts = [];
  for (let ring = 0; ring < 2; ring++) for (let q = 0; q < 5; q++) {
    const pa = (q / 5) * Math.PI * 2 + ring * 0.6; const rr = (0.16 - ring * 0.07) * s;
    parts.push(xform(blob(0.11 * s * (1 - ring * 0.25), ring ? '#B81C38' : hex, { seed: q + ring * 5, amp: 0.1, detail: 1, sy: 0.5, sx: 1.2 }), { x: Math.cos(pa) * rr, y: ring * 0.05 * s, z: Math.sin(pa) * rr, ry: -pa, rz: 0.5 - ring * 0.3 }));
  }
  parts.push(xform(blob(0.07 * s, '#9E1430', { seed: 3, detail: 1, sy: 1.2 }), { y: 0.08 * s }));
  return mergeAll(parts);
};
const pomegranateFruit = (s = 1) => mergeAll([(() => { const g = ball(0.36 * s, '#C4233A', { sy: 0.93 }, 2); shade(g, { bottom: 0.78, top: 1.2 }); return g; })(),
  xform(P(new THREE.CylinderGeometry(0.12 * s, 0.08 * s, 0.14 * s, 6, 1, true), '#8E1A2A'), { y: 0.38 * s })]);
const coffeeBean = (hex = '#6B3E22') => mergeAll([xform(ball(0.09, hex, {}, 1), { sx: 1.0, sy: 0.6, sz: 1.35 }), box(0.012, 0.012, 0.2, '#3A2214', { y: 0.05 })]);
item('raspberry', () => mergeAll([raspberryBerry('#C21E48'), xform(raspberryBerry('#D7345A'), { x: 0.24, z: 0.1 }), xform(raspberryBerry('#B01840'), { x: -0.2, z: 0.12 }),
  xform(raspberryBerry('#C21E48', 0.9), { x: 0.04, y: 0.2, z: 0.02 }), xform(leaf(0.4, 0.22, '#4E9A3E', { bend: 0.2 }), { rx: -1.3, ry: 0.5, x: -0.05, z: -0.22 })]).translate(0, 0.14, 0));
item('rose', () => {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const a = (i - 1) * 0.28;
    parts.push(xform(mergeAll([cyl(0.018, 0.02, 0.85, 5, '#3F7A2E', {}, 0), xform(roseHead('#D8243F', 0.8), { y: 0.88 }), xform(leaf(0.18, 0.1, '#3F8F3A', { bend: 0.3 }), { y: 0.45, rz: 0.9 })]), { rz: a, x: Math.sin(a) * 0.1 }));
  }
  parts.push(xform(torus(0.06, 0.025, '#FFC83D', {}, 5, 10), { y: 0.3, rx: Math.PI / 2 }), xform(box(0.05, 0.18, 0.01, '#FFC83D'), { y: 0.12, x: 0.04, rz: 0.3 }));
  return mergeAll(parts);
}, { pitch: 18 });
item('coffee', () => mergeAll([sackOf('#C9A06A', '#6B3E22')(), ...Array.from({ length: 7 }, (_, i) => xform(coffeeBean(i % 3 ? '#6B3E22' : '#7E4C2A'), { x: -0.35 + (i % 4) * 0.22, y: 0.05, z: 0.42 + Math.floor(i / 4) * 0.14, ry: i * 0.9 }))]));
item('pomegranate', () => mergeAll([pomegranateFruit(), xform(leaf(0.32, 0.16, '#3B7F36', { bend: 0.2 }), { rx: -1.2, ry: -0.6, x: 0.25, y: 0.05, z: -0.2 })]).translate(0, 0.33, 0));
// Fertilizer: a green bag with a sprout on its label, tied, a scoop of rich dark crumbs spilling in front (never Compost's brown sack)
item('fertilizer', () => mergeAll([sackOf('#5E9C3A', '#3A2618', '#2E5A22')(), xform(cyl(0.2, 0.2, 0.02, 14, '#FFF8EC'), { rx: Math.PI / 2, y: 0.42, z: 0.4 }),
  xform(mergeAll([cyl(0.012, 0.012, 0.12, 4, '#4E9F3A', {}, 0), xform(leaf(0.12, 0.07, '#5DBB45', { bend: 0.3 }), { y: 0.1, rz: 0.8 }), xform(leaf(0.12, 0.07, '#5DBB45', { bend: 0.3 }), { y: 0.1, rz: -0.8 })]), { y: 0.33, z: 0.42, rx: Math.PI / 2 - 0.1 }),
  xform(blob(0.18, '#3A2618', { seed: 4, sy: 0.35, amp: 0.3 }), { x: 0.42, y: 0.03, z: 0.35 })]));
item('rabbit_greens', () => mergeAll([...[0, 1, 2, 3, 4].map((i) => xform(leaf(0.62, 0.3, i % 2 ? '#7FC456' : '#5DAA45', { bend: 0.35 }), { ry: i * 1.26, rx: 0.3 })),
  xform(P(new THREE.ConeGeometry(0.08, 0.5, 8), '#F08A2C', { creaseDeg: 60 }), { rz: Math.PI / 2 + 0.2, x: 0.3, y: 0.12, z: 0.25 }), torus(0.1, 0.03, '#E84A5F', { y: 0.15, rx: Math.PI / 2 }, 4, 10)]), { pitch: 30 });
item('angora_wool', () => mergeAll([fluff('#FFF7F2')(), xform(blob(0.12, '#FFE4E8', { seed: 9, amp: 0.25 }), { x: 0.3, y: 0.5 })]));
item('cloud_angora', () => mergeAll([fluff('#F8F4FF')(), torus(0.3, 0.035, '#E9B13A', { y: 0.3, rx: Math.PI / 2 }, 4, 18), xform(P(new THREE.OctahedronGeometry(0.1, 0), '#FFE27A'), { x: 0.35, y: 0.75 })]));
item('raspberry_jam', glassJar('#A8173A', '#C21E48', '#F6D7C2', () => [0, 1, 2].map((i) => xform(raspberryBerry('#C21E48', 0.55), { x: (i - 1) * 0.15, y: 0.93 }))));
item('raspberry_tart', tart('#C21E48'));
item('rose_jelly', glassJar('#F27A98', '#FF9FB0', '#FDE2EA', () => [xform(roseHead('#E8384F', 0.6), { y: 0.92 })]));
item('rose_candle', candle('#F7B8C8', '#D8243F'));
item('pomegranate_juice', juiceGlass('#B5172E', () => [xform(pomegranateFruit(0.32), { x: -0.2, y: 0.74 })]));
item('grenadine', bottle('#C8102E', '#8E1A2A', '#D8284A'));     // red glass: the syrup is the bottle's colour
item('farm_coffee', () => mergeAll([mug('#5A3420')(), ...[0, 1].map((i) => xform(coffeeBean(), { x: -0.45 + i * 0.2, y: 0.01, z: 0.3, ry: i * 1.4, s: 0.9 }))]));
item('coffee_cake', cake('#B07A4A', '#F2E6CF', '#6B3E22'));
item('angora_yarn', yarnBall('#FFF0F4'));
/** A mitten: a rounded hand and a thumb in one colour, a white cuff. */
const mitten = (hex) => mergeAll([xform(P(new THREE.CapsuleGeometry(0.16, 0.22, 4, 10), hex, { creaseDeg: 60 }), { y: 0.38, sz: 0.55 }),
  xform(P(new THREE.CapsuleGeometry(0.06, 0.1, 3, 8), hex, { creaseDeg: 60 }), { x: 0.17, y: 0.34, rz: -0.6, sz: 0.6 }), cyl(0.15, 0.15, 0.14, 12, '#FFFFFF', { y: 0.06, sz: 0.6 }),
  xform(heartGeo(0.18, '#E86A7A'), { y: 0.4, z: 0.09 })]);
item('angora_mittens', () => mergeAll([xform(mitten('#F4C6D0'), { x: -0.2, rz: 0.15 }), xform(mitten('#F4C6D0'), { x: 0.22, z: -0.1, rz: -0.15, ry: Math.PI })]));
/** A bunny slipper: a plush pink shoe, a white fluffy rim, two ears and two little eyes on the toe. */
const slipper = () => mergeAll([xform(P(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), '#F7C3CF', { creaseDeg: 60 }), { rx: Math.PI / 2, y: 0.14, sy: 1, sx: 1, sz: 1 }),
  xform(torus(0.13, 0.05, '#FFFFFF', {}, 5, 12), { y: 0.26, z: -0.12, rx: Math.PI / 2, sx: 1.1 }),
  ...[-1, 1].map((sd) => xform(P(new THREE.CapsuleGeometry(0.045, 0.22, 3, 8), '#FFFFFF', { creaseDeg: 60 }), { x: sd * 0.07, y: 0.4, z: 0.16, rz: -sd * 0.25, rx: -0.4, sz: 0.5 })),
  ...[-1, 1].map((sd) => ball(0.025, '#2A1A10', { x: sd * 0.06, y: 0.27, z: 0.32 }, 0)), ball(0.03, '#F28AA0', { y: 0.23, z: 0.37 }, 0)]);
item('bunny_slippers', () => mergeAll([xform(slipper(), { x: -0.2, ry: 0.15 }), xform(slipper(), { x: 0.22, z: -0.08, ry: -0.1 })]));

// ---------------------------------------------------------------------------------------------------
// 18. Wave 4b (the owners' wish list of 2026-10-05; render lane): the balloon's loot crate and its parachute (wish 1:
//     render/crates-view.js animates the three parts), the Acorn shop's relics (wish 2: the Golden Sprinkler with its
//     spinning head, the Growth Totem, the Rainbow Tree, and item icons for the charms), and the animal homes' growth
//     tiers (wish 3: `home:<id>:g<t>`, the pen t tiles bigger each way; see GROW in section 12). Every new file has a '-'
//     in its name, so it is no member of its family's boot pack: it loads only when a farm shows it (server/static.js).
const CR = Object.freeze({ wood: '#E3A65E', woodL: '#F2C27E', woodD: '#A8703A', iron: '#5A5E6A', gold: '#FFD23F', goldD: '#E8A420',
  red: '#E8473A', redD: '#C23A2E', cream: '#FFF4E0', rope: '#E8D7B0', inside: '#3A2614' });

/** The loot crate's body (prop:loot_crate, 1 x 1): a 1.3 m plank box 0.86 m tall, iron corner posts and bands, a cross
 *  brace front and back, a gold latch plate with a star, rope handles on the sides and a dark inside under the lid. */
function lootCrateBody() {
  const S = 1.3; const H = 0.86; const parts = [box(S, H, S, CR.wood)];
  for (let y = 0.2; y < H - 0.1; y += 0.22) {
    for (const sg of [-1, 1]) parts.push(box(S - 0.06, 0.025, 0.02, CR.woodD, { y, z: sg * (S / 2 + 0.005) }), box(0.02, 0.025, S - 0.06, CR.woodD, { y, x: sg * (S / 2 + 0.005) }));
  }
  for (const sg of [-1, 1]) parts.push(xform(box(1.5, 0.12, 0.04, CR.woodL), { y: H / 2, z: sg * (S / 2 + 0.015), rz: sg * 0.52 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.12, H + 0.02, 0.12, CR.iron, { x: sx * (S / 2 - 0.03), z: sz * (S / 2 - 0.03) }));
  for (const y of [0.02, H - 0.1]) {
    for (const sg of [-1, 1]) parts.push(box(S + 0.04, 0.08, 0.05, CR.iron, { y, z: sg * (S / 2 + 0.01) }), box(0.05, 0.08, S + 0.04, CR.iron, { y, x: sg * (S / 2 + 0.01) }));
  }
  parts.push(box(0.3, 0.26, 0.05, CR.gold, { y: H - 0.32, z: S / 2 + 0.03 }));
  parts.push(xform(P(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 5), CR.goldD), { rx: Math.PI / 2, y: H - 0.19, z: S / 2 + 0.06 }));
  for (const sg of [-1, 1]) parts.push(xform(P(new THREE.TorusGeometry(0.13, 0.025, 4, 8, Math.PI), CR.rope, { creaseDeg: 60 }), { x: sg * (S / 2 + 0.03), y: H * 0.5, ry: Math.PI / 2 }));
  // the open crate's inside: a dark hollow just over the planked top (the closed lid covers it) and a glint of gold coins
  parts.push(box(S - 0.16, 0.012, S - 0.16, CR.inside, { y: H + 0.002 }));
  const coin = (x, z, y, t) => xform(cyl(0.11, 0.11, 0.03, 10, t ? CR.goldD : CR.gold), { x, y: H + 0.014 + y, z, rx: t, rz: t * 0.6 });
  parts.push(coin(-0.25, 0.1, 0, 0), coin(-0.05, 0.22, 0, 0), coin(0.2, -0.05, 0, 0), coin(-0.12, -0.2, 0.0, 0), coin(0.05, 0.02, 0.03, 0.25),
    coin(0.3, 0.25, 0, 0), coin(-0.32, -0.28, 0, 0), ball(0.07, '#7CC4FF', { x: 0.28, y: H + 0.06, z: -0.3 }, 0));
  return mergeAll(parts);
}
/** The lid (prop:loot_crate:lid): its origin ON the hinge at the back top edge, reaching forward along +z (1.42 m);
 *  iron rim, a gold hasp over the latch, a red ribbon crossing it with a bow on top (the gift look). */
function lootCrateLid() {
  const S = 1.42; const parts = [box(S, 0.16, S, CR.woodL, { z: S / 2 })];
  for (let x = -S / 2 + 0.28; x < S / 2 - 0.1; x += 0.28) parts.push(box(0.025, 0.02, S - 0.06, CR.woodD, { x, y: 0.16, z: S / 2 }));
  for (const sg of [-1, 1]) {
    parts.push(box(S + 0.02, 0.06, 0.1, CR.iron, { y: 0.05, z: S / 2 + sg * (S / 2 - 0.04) }), box(0.1, 0.06, S + 0.02, CR.iron, { x: sg * (S / 2 - 0.04), y: 0.05, z: S / 2 }));
  }
  parts.push(box(0.16, 0.2, 0.04, CR.gold, { y: -0.12, z: S }), box(S + 0.02, 0.025, 0.12, CR.red, { y: 0.17, z: S / 2 }), box(0.12, 0.025, S + 0.02, CR.red, { y: 0.172, z: S / 2 }));
  for (const sg of [-1, 1]) parts.push(ball(0.12, CR.red, { x: sg * 0.13, y: 0.24, z: S / 2, sx: 1.3, sy: 0.6, sz: 0.8 }, 1));
  parts.push(ball(0.06, CR.redD, { y: 0.24, z: S / 2 }, 0));
  return mergeAll(parts);
}
/** The parachute (prop:parachute): a red-and-cream canopy of eight gores, 3.5 m across, on eight cords that meet at the
 *  origin (the crate's top), with a vent cap. The dynamic batch's material is double-sided (seen from below too). */
function parachuteW4b() {
  const R = 1.75; const top = 2.6; const parts = [];
  for (let i = 0; i < 8; i++) {
    parts.push(xform(P(new THREE.SphereGeometry(R, 2, 4, (i * Math.PI) / 4, Math.PI / 4, 0.18, 1.0), i % 2 ? CR.cream : CR.red), { y: top - R * 0.62, sy: 0.62 }));
  }
  const rimY = top - R * 0.62 + Math.cos(1.18) * R * 0.62; const rimR = Math.sin(1.18) * R;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    const to = new THREE.Vector3(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR);
    const len = to.length();
    const cord = new THREE.CylinderGeometry(0.014, 0.014, len, 3).translate(0, len / 2, 0);
    cord.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().normalize()));
    parts.push(P(cord, CR.rope));
  }
  parts.push(cyl(0.16, 0.2, 0.06, 8, CR.red, { y: top - 0.02 }));
  return mergeAll(parts);
}
job('prop:loot_crate', 'props/loot-crate.glb', { family: 'prop', def: 'loot_crate', footprint: [1, 1] }, async () => sway(lootCrateBody(), { rigid: true }));
job('prop:loot_crate:lid', 'props/loot-crate.glb', { family: 'prop', footprint: [1, 1], part: true }, async () => sway(lootCrateLid(), { rigid: true }));
job('prop:parachute', 'props/loot-crate.glb', { family: 'prop', footprint: [2, 2], part: true, doubleSided: true }, async () => sway(parachuteW4b(), { rigid: true }));
// the crate's icon: closed, its parachute folded on top
item('loot_crate', () => mergeAll([lootCrateBody(), xform(lootCrateLid(), { y: 0.86, z: -0.71 }),
  xform(blob(0.3, CR.red, { seed: 5, sx: 1.4, sy: 0.55, detail: 1 }), { x: 0.25, y: 1.18, z: -0.2 }),
  xform(blob(0.22, CR.cream, { seed: 6, sx: 1.3, sy: 0.5, detail: 1 }), { x: 0.12, y: 1.27, z: -0.28 })]), { yaw: 30, pitch: 24 });

// ---- the relics (content RELICS) -----------------------------------------------------------------------------------------
/** The Golden Sprinkler (relic, 1 x 1): a gilded standpipe on a mossy stone pad ringed with flowers; its three-armed head
 *  is a part of its own (`decor:golden_sprinkler:spin`, turned about +y round `pivot` by objects-view, which also throws
 *  its water: the `spray` anchor is the head, `reach` the watered radius in metres). */
const SPRINKLER_PIVOT = [0, 0.92, 0];
function goldenSprinklerBase() {
  const r = rng('gspr');
  return mergeAll([cyl(0.5, 0.56, 0.12, 14, '#B5AEA2'), cyl(0.45, 0.45, 0.03, 14, '#7FB547', { y: 0.12 }),
    cyl(0.12, 0.1, 0.07, 10, GOLD_D, { y: 0.12 }), cyl(0.065, 0.085, 0.74, 10, GOLD, { y: 0.18 }),
    xform(torus(0.095, 0.028, GOLD_D, {}, 4, 12), { y: 0.48, rx: Math.PI / 2 }), xform(torus(0.085, 0.022, GOLD_L, {}, 4, 12), { y: 0.84, rx: Math.PI / 2 }),
    ...[0, 1, 2, 3].map((i) => xform(flowerClump(r, ['#FFD21F', '#FFFFFF', '#6FC3F0'], 3, 0.22), { x: Math.cos(i * 1.57 + 0.6) * 0.36, y: 0.13, z: Math.sin(i * 1.57 + 0.6) * 0.36, s: 0.6 }))]);
}
function goldenSprinklerHead() {
  const parts = [ball(0.11, GOLD_L, {}, 1), cone(0.05, 0.14, 8, GOLD, { y: 0.07 }), ball(0.045, '#6FD3E6', { y: 0.23 }, 0)];
  for (let i = 0; i < 3; i++) {
    const arm = mergeAll([box(0.36, 0.035, 0.05, GOLD, { x: 0.22, y: -0.017 }), xform(cyl(0.03, 0.04, 0.1, 8, GOLD_D), { x: 0.41, y: -0.02, rz: -0.5 }),
      ball(0.036, '#6FD3E6', { x: 0.45, y: 0.06 }, 0)]);
    parts.push(xform(arm, { ry: (i * Math.PI * 2) / 3 }));
  }
  return mergeAll(parts);
}
job('decor:golden_sprinkler', 'decor/relic-golden_sprinkler.glb', { family: 'decor', def: 'golden_sprinkler', footprint: [1, 1] }, async () => {
  JOBS.find((j) => j.key === 'decor:golden_sprinkler').meta.anchors = { spray: SPRINKLER_PIVOT, reach: 7 };
  return sway(goldenSprinklerBase(), { rigid: true });
});
job('decor:golden_sprinkler:spin', 'decor/relic-golden_sprinkler.glb', { family: 'decor', footprint: [1, 1], part: true, axis: 'y', pivot: SPRINKLER_PIVOT, speed: 1.4 },
  async () => sway(goldenSprinklerHead(), { rigid: true }));
item('golden_sprinkler', () => mergeAll([goldenSprinklerBase(), xform(goldenSprinklerHead(), { x: SPRINKLER_PIVOT[0], y: SPRINKLER_PIVOT[1], z: SPRINKLER_PIVOT[2] })]), { pitch: 24 });

/** The Growth Totem (relic, 1 x 1, ~2 m): three carved drums on a mossy stone (a sleepy root face, a collar of leaves
 *  with two leaf wings, a sun with gold rays), a gold cap and a big green gem (`gem` anchor: objects-view breathes a
 *  green ring over the 3-tile radius and lets leaves drift up from it); a vine climbs it, mushrooms at its foot. */
function growthTotem() {
  const r = rng('totem');
  const parts = [cyl(0.48, 0.52, 0.1, 12, '#A9A296'), cyl(0.42, 0.42, 0.03, 12, LEAF_L, { y: 0.1 })];
  // the root drum with its sleepy face
  parts.push(cyl(0.25, 0.3, 0.55, 10, '#8E5E3A', { y: 0.12 }));
  for (const sx of [-1, 1]) parts.push(xform(P(new THREE.TorusGeometry(0.05, 0.016, 3, 6, Math.PI), '#3A2614'), { x: sx * 0.09, y: 0.46, z: 0.265, rz: Math.PI }));
  parts.push(xform(P(new THREE.TorusGeometry(0.07, 0.018, 3, 8, Math.PI), '#3A2614'), { y: 0.33, z: 0.27, rz: Math.PI }), ball(0.035, '#F2A0A0', { x: -0.17, y: 0.36, z: 0.22 }, 0), ball(0.035, '#F2A0A0', { x: 0.17, y: 0.36, z: 0.22 }, 0));
  // the leaf drum: a collar of leaves and two broad leaf wings
  parts.push(cyl(0.23, 0.25, 0.5, 10, '#B5824E', { y: 0.67 }));
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; parts.push(xform(leaf(0.26, 0.14, i % 2 ? LEAF : LEAF_L, { bend: 0.5 }), { x: Math.sin(a) * 0.2, y: 0.7, z: Math.cos(a) * 0.2, ry: a, rx: 1.0 })); }
  for (const sx of [-1, 1]) parts.push(xform(leaf(0.62, 0.3, LEAF_L, { bend: 0.25, seg: 3 }), { x: sx * 0.22, y: 0.98, rz: sx * -1.15, ry: sx * 0.2 }));
  // the sun drum with gold rays
  parts.push(cyl(0.19, 0.22, 0.42, 10, '#D2A160', { y: 1.17 }), xform(P(new THREE.CircleGeometry(0.13, 10), GOLD_L), { y: 1.38, z: 0.205 }));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; parts.push(xform(cone(0.035, 0.12, 4, GOLD), { x: Math.sin(a) * 0.205, y: 1.33, z: Math.cos(a) * 0.205, rx: Math.PI / 2, ry: a })); }
  // the cap and the gem
  parts.push(cone(0.25, 0.14, 10, GOLD_D, { y: 1.59 }), xform(torus(0.09, 0.025, GOLD, {}, 4, 10), { y: 1.75, rx: Math.PI / 2 }));
  parts.push(xform(P(new THREE.OctahedronGeometry(0.16, 0), '#45D483', { creaseDeg: 10 }), { y: 1.92, sy: 1.35 }));
  // a vine climbing round it, mushrooms and a sprout at its foot
  for (let i = 0; i < 10; i++) { const a = i * 1.1; const y = 0.18 + i * 0.13; const rad = y < 0.67 ? 0.29 : y < 1.17 ? 0.25 : 0.22;
    parts.push(xform(leaf(0.12, 0.07, i % 2 ? LEAF_D : LEAF, { bend: 0.4, seg: 1 }), { x: Math.sin(a) * rad, y, z: Math.cos(a) * rad, ry: a + 1.2, rx: 0.6 })); }
  for (let i = 0; i < 3; i++) {
    const a = 2.3 + i * 0.9; const x = Math.sin(a) * 0.4; const z = Math.cos(a) * 0.4; const s = 0.8 + r() * 0.4;
    parts.push(cyl(0.025 * s, 0.03 * s, 0.1 * s, 6, '#F4EEDF', { x, y: 0.12, z }), xform(P(new THREE.SphereGeometry(0.07 * s, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), i === 1 ? '#F2C24A' : '#E0483A'), { x, y: 0.12 + 0.1 * s, z }));
  }
  return withAnchors(mergeAll(parts), { gem: [0, 1.95, 0], reach: 7 });
}
job('decor:growth_totem', 'decor/relic-growth_totem.glb', { family: 'decor', def: 'growth_totem', footprint: [1, 1] }, async () => {
  const g = growthTotem();
  JOBS.find((j) => j.key === 'decor:growth_totem').meta.anchors = g.anchors;
  return sway(g, { rigid: true });
});

/** The Rainbow Tree (relic tree, 2 x 2): a lollipop tree like the others, its fruit every colour of the rainbow (each
 *  harvest is a random fruit of the farm's trees); its own file, not a boot-pack member. */
TREES.rainbow_tree = { leaf: '#58AE4A', fruit: '#E2363A', fruitR: 0.165, fruitN: 18, canopy: [1.12, 1.02, 1.12], trunk: 1.05, lean: 0.02, blobs: 5,
  bark: '#9A6A45', fruitCols: ['#E2363A', '#F59A23', '#F5D63B', '#7CC64A', '#4AA8E8', '#8C4FA6', '#FF8FB0'] };
for (const st of TREE_STATES) {
  job(`tree:rainbow_tree:${st}`, 'trees/rainbow_tree-relic.glb', { family: 'tree', def: 'rainbow_tree', footprint: [2, 2], sway: 0.35 }, async () => fruitTree('rainbow_tree', st));
}
for (const st of ['mature', 'ready']) {
  job(`tree:rainbow_tree:${st}:heirloom`, 'trees/rainbow_tree-relic.glb', { family: 'tree', def: 'rainbow_tree', footprint: [2, 2], sway: 0.35, heirloom: true },
    async () => fruitTree('rainbow_tree', st, true));
}

// the charms' icons (no world model: they work farm-wide)
/** A four-leaf clover: four heart leaves round a gold-dotted centre on a curved stem, tipped toward the camera. */
item('lucky_clover', () => {
  // each heart's tip at the centre, its lobes outward, a little gap between the four, a pale vein down each
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const th = Math.PI / 4 + (i * Math.PI) / 2;
    const leafG = mergeAll([heartGeo(0.42, i % 2 ? '#3FAE4A' : '#52C45C'), xform(box(0.012, 0.2, 0.01, '#8BE07A'), { y: -0.1, z: 0.006 })]);
    parts.push(xform(leafG, { rz: th - Math.PI / 2, x: Math.cos(th) * 0.135, y: Math.sin(th) * 0.135, z: i * 0.002 }));
  }
  parts.push(ball(0.04, '#FFD45A', { z: 0.02 }, 1));
  const head = xform(mergeAll(parts), { rx: -0.9, y: 0.62 });
  const stem = xform(cyl(0.022, 0.028, 0.62, 6, '#3B8A35', {}, 0), { rz: 0.15 });
  return mergeAll([head, stem]);
}, { yaw: 10, pitch: 20 });
/** The Golden Watering Can: the can in polished gold with a sparkle-blue rose. */
item('golden_can', () => mergeAll([cyl(0.3, 0.32, 0.5, 16, GOLD), cyl(0.31, 0.31, 0.04, 16, GOLD_D, { y: 0.5 }), xform(cyl(0.04, 0.06, 0.55, 8, GOLD), { rz: -0.9, x: 0.42, y: 0.38 }),
  xform(cyl(0.1, 0.05, 0.08, 8, GOLD_L), { rz: -0.9, x: 0.66, y: 0.56 }), xform(cyl(0.095, 0.095, 0.01, 10, '#6FD3E6'), { rz: -0.9, x: 0.7, y: 0.59 }),
  xform(torus(0.2, 0.035, GOLD_D, {}, 6, 12), { x: -0.18, y: 0.55 }), cyl(0.315, 0.315, 0.05, 16, GOLD_L, { y: 0.18 })]), { yaw: 30 });
/** The Farmhand: a straw hat with a red band resting on a hay bale, a pitchfork leaning on it. */
item('farmhand', () => {
  const hat = mergeAll([cyl(0.42, 0.42, 0.04, 16, '#E8C766'), cyl(0.2, 0.24, 0.24, 14, '#E3BF5E', { y: 0.04 }), cyl(0.245, 0.245, 0.06, 14, '#D2453A', { y: 0.06 })]);
  const fork = mergeAll([cyl(0.025, 0.025, 1.3, 6, '#B5743E'), box(0.3, 0.04, 0.04, '#8C8880', { y: 1.3 }),
    ...[-0.12, -0.04, 0.04, 0.12].map((x) => cyl(0.012, 0.008, 0.28, 4, '#8C8880', { x, y: 1.32 }, 0))]);
  return mergeAll([xform(hayBale(), { s: 0.8 }), xform(hat, { y: 0.72, rz: 0.12, x: -0.05 }), xform(fork, { x: 0.42, z: -0.2, rz: -0.32 })]);
}, { yaw: 20 });
/** The Time Turner: a gold-framed hourglass with blue glass and golden sand, a little clock face on its stand. */
item('time_turner', () => {
  const glass = mergeAll([lathe([[0.02, 0], [0.26, 0.02], [0.3, 0.2], [0.05, 0.48], [0.3, 0.76], [0.26, 0.94], [0.02, 0.96]], 14, '#A9DDF2'),
    xform(cone(0.2, 0.22, 12, '#F2C24A'), { y: 0.03 }), xform(cone(0.12, 0.16, 10, '#F2C24A'), { y: 0.62, rx: Math.PI })]);
  return mergeAll([cyl(0.38, 0.38, 0.08, 6, GOLD_D), cyl(0.38, 0.38, 0.08, 6, GOLD_D, { y: 1.08 }), xform(glass, { y: 0.1 }),
    ...[0, 1, 2].map((i) => xform(cyl(0.03, 0.03, 1.0, 6, GOLD), { x: Math.cos(i * 2.09) * 0.33, y: 0.08, z: Math.sin(i * 2.09) * 0.33 })),
    xform(P(new THREE.CircleGeometry(0.18, 16), '#FFF8EC'), { y: 0.62, z: 0.36 }), xform(torus(0.18, 0.025, GOLD_L, {}, 4, 16), { y: 0.62, z: 0.36 }),
    xform(box(0.02, 0.12, 0.01, '#3A2A1A'), { y: 0.62, z: 0.37 }), xform(box(0.09, 0.02, 0.01, '#3A2A1A'), { x: 0.045, y: 0.62, z: 0.37 })]);
}, { yaw: 15 });
/** The Golden Barn: a little red barn with a gilded roof, cupola and star. */
item('golden_barn', () => mergeAll([box(1.1, 0.75, 0.9, '#C8473A'), xform(gable(1.25, 1.0, 0.5, GOLD), { y: 0.75 }), box(0.42, 0.55, 0.02, '#FFF8EC', { z: 0.46 }),
  xform(box(0.04, 0.68, 0.02, '#FFF8EC'), { y: 0.02, z: 0.47, rz: 0.62 }), xform(box(0.04, 0.68, 0.02, '#FFF8EC'), { y: 0.02, z: 0.47, rz: -0.62 }),
  box(0.26, 0.24, 0.26, '#FFF8EC', { y: 1.15 }), xform(cone(0.24, 0.22, 4, GOLD_L), { y: 1.39, ry: Math.PI / 4 }),
  xform(P(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 5), GOLD_L), { rx: Math.PI / 2, y: 0.95, z: 0.47 })]), { yaw: 30 });

// ---- the Golden Barn (relic): the barn's `ridge` anchor, where objects-view stands its gilded cupola -------------------------
// the highest roof line of the barn's own body (a level-3 barn's silo is not its roof): the centroid of its top vertices
for (let lvl = 0; lvl < 4; lvl++) {
  const key = lvl ? `building:barn:${lvl}` : 'building:barn';
  const j = JOBS.find((x) => x.key === key);
  if (!j) continue;
  const orig = j.build;
  j.build = async () => {
    const g = await orig();
    const p = (await barnParts(lvl)).body.getAttribute('position');
    let top = -Infinity;
    for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i));
    let sx = 0; let sz = 0; let n = 0;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > top - 0.04) { sx += p.getX(i); sz += p.getZ(i); n++; }
    j.meta.anchors = { ...(j.meta.anchors || {}), ridge: [r3(sx / n), r3(top), r3(sz / n)] };
    return g;
  };
}

// ---- animal homes that grow (content HOME_GROWTH: a tier adds `grow` tiles to both sides) --------------------------------
/** The growth tiers of a home id: 1..n (n = its caps beyond the first), none without a growth row. */
function growthTiers(id) {
  const g = CONTENT_NS.HOME_GROWTH;
  const row = g && g.homes && g.homes[id];
  return row ? Array.from({ length: Math.max(0, row.caps.length - 1) }, (_, i) => (i + 1) * (g.grow || 1)) : [];
}
/** The anchors of a home shifted with its contents (-t, -t), the yard opened to the new front and right, and room left
 *  for the grown pen's own extras (a hay bale in the back-right corner from tier 1, a second trough on the right from 2). */
async function grownHome(build, size, t) {
  GROW = t;
  let r;
  try { r = await build(); } finally { GROW = 0; }
  const geo = r.geo.translate(-t, 0, -t);
  const hw = size[0] + t; const hd = size[1] + t;                 // half the grown pen (metres: tiles x 2 / 2)
  const sh = (a) => (a ? [a[0] - t, a[1] - t, ...a.slice(2)] : a);
  const extras = [xform(hayBale(), { x: hw - 0.95, z: -hd + 0.95, ry: 0.4, s: 0.85 })];
  const avoid = [...(r.avoid || []).map(sh), [hw - 0.95, -hd + 0.95, 0.75]];
  if (t >= 2) { extras.push(xform(trough(1.4), { x: hw - 0.75, z: 0.2, ry: Math.PI / 2 })); avoid.push([hw - 0.75, 0.2, 0.95]); }
  const out = { geo: mergeAll([geo, ...extras]), yard: r.yard && [r.yard[0] - t, r.yard[1] - t, r.yard[2] + t, r.yard[3] + t], avoid };
  for (const k of ['water', 'mud', 'dust']) if (r[k]) out[k] = sh(r[k]);
  if (r.perches) out.perches = r.perches.map(sh);
  return out;
}
for (const h of [...HOMES, { id: 'hutch', size: [3, 2], build: async () => rabbitHutch() }]) {
  for (const t of growthTiers(h.id)) {
    const key = `home:${h.id}:g${t}`; const file = `homes/${h.id}-g${t}.glb`; const fp = [h.size[0] + t, h.size[1] + t];
    job(key, file, { family: 'home', footprint: fp, grown: t }, async () => {
      const g = await grownHome(h.build, h.size, t);
      const meta = JOBS.find((j) => j.key === key).meta;
      for (const k of ['yard', 'water', 'mud', 'perches', 'avoid', 'dust']) if (g[k]) meta[k] = g[k];
      return sway(g.geo, { rigid: true });
    });
    job(`${key}:far`, file, { family: 'home', footprint: fp, part: true, far: true }, async () => {
      const { geo } = await grownHome(h.build, h.size, t);
      let g = geo;
      for (const error of [0.05, 0.1, 0.2, 0.4]) { if (tris(g) <= 1900 * 1.08) break; g = await simplify(geo, 1900 / tris(geo), { error, deg: 35, lockBorder: false }); }
      return sway(g, { rigid: true });
    });
  }
}

// ---------------------------------------------------------------------------------------------------
// 99. Main
async function main() {
  const only = opt('only', null) ? new RegExp(opt('only')) : null;
  if (flag('list')) { for (const j of JOBS) console.log(j.key, j.file); return; }
  try { await tools(); } catch (err) {
    console.error(err.message);
    console.log(JSON.stringify({ ok: false, error: 'dev tools missing (see the header of tools/build-assets.mjs)' }));
    process.exitCode = 1;
    return;
  }
  const t0 = Date.now();
  const prevPath = path.join(OUT, 'manifest.json');
  const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : null;
  const selected = JOBS.filter((j) => !only || only.test(j.key));
  // A file is rebuilt as a whole: include every job of a touched file.
  const files = new Set(selected.map((j) => j.file));
  const run = JOBS.filter((j) => files.has(j.file));
  const failures = [];
  for (const j of run) {
    try {
      const g = await j.build();
      addStatic(j.file, j.key, g, j.meta);
    } catch (err) {
      failures.push(`${j.key}: ${err.message}`);
      console.error(`FAIL ${j.key}: ${err.stack}`);
    }
  }
  const skinFiles = new Set();
  for (const sk of SKIN) {
    if (only && !only.test(sk.key)) continue;
    try { await buildSkinned(sk); skinFiles.add(sk.file); } catch (err) { failures.push(`${sk.key}: ${err.message}`); console.error(`FAIL ${sk.key}: ${err.stack}`); }
  }
  for (const [file, entry] of outFiles) {
    if (skinFiles.has(file)) throw new Error(`${file}: a skinned file cannot also hold static jobs`);
    await writeStaticFile(file, entry);
  }
  for (const f of skinFiles) files.add(f);
  // Merge with the previous manifest for files not rebuilt in this run.
  if (prev && only) {
    for (const [k, e] of Object.entries(prev.keys)) if (!files.has(e.file) && !manifest.keys[k]) { manifest.keys[k] = e; registerDef(k, e); }
    for (const [f, e] of Object.entries(prev.files)) if (!manifest.files[f]) manifest.files[f] = e;
    Object.assign(manifest.aliases, prev.aliases, manifest.aliases);
  }
  if (!flag('no-items') && (!only || only.test('item:'))) {
    const r = await buildItems();
    failures.push(...r.failures);
  }
  const h = createHash('sha1');
  for (const f of Object.keys(manifest.files).sort()) {
    const abs = path.join(OUT, f);
    if (fs.existsSync(abs)) h.update(fs.readFileSync(abs)); else delete manifest.files[f];
  }
  manifest.hash = h.digest('hex').slice(0, 10);
  // visual stage lists per def (brief: manifest `stages`): crops 0..3, trees sapling..ready (+ stump)
  const ORDER = ['0', '1', '2', '3', 'sapling', 'young', 'mature', 'ready', 'stump'];
  for (const d of Object.values(manifest.defs)) {
    if (d.family !== 'crop' && d.family !== 'tree') continue;
    d.stages = d.keys.slice().sort((a, b) => ORDER.indexOf(a.split(':').pop()) - ORDER.indexOf(b.split(':').pop()));
  }
  const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const out = { ...manifest, files: sortObj(manifest.files), defs: sortObj(manifest.defs), aliases: sortObj(manifest.aliases), keys: sortObj(manifest.keys) };
  fs.writeFileSync(prevPath, `${JSON.stringify(out, null, 1)}\n`);
  writeIconList(out);
  const bytes = Object.values(out.files).reduce((a, f) => a + f.bytes, 0);
  console.log(JSON.stringify({ ok: failures.length === 0, keys: Object.keys(out.keys).length, built: run.length, files: Object.keys(out.files).length, bytes, ms: Date.now() - t0, failures }));
  if (failures.length) process.exitCode = 1;
}

/** The icon list for tools/make-icons.mjs: every item model plus every placeable def (rendered from its world
 *  model: trees ready, animals in their idle pose, buildings, homes, decor, debris, the plot). */
function writeIconList(m) {
  const itemsFile = path.join(CACHE, 'items', 'items.json');
  const items = fs.existsSync(itemsFile) ? JSON.parse(fs.readFileSync(itemsFile, 'utf8')) : [];
  const have = new Set(items.map((i) => i.id));
  const list = [...items];
  const pick = { tree: (id) => (id === 'pine' ? 'tree:pine:mature' : `tree:${id}:ready`), animal: (id) => `animal:${id}`, building: (id) => `building:${id}`,
    home: (id) => `home:${id}`, decor: (id) => `decor:${id}`, debris: (id) => `debris:${id}`, plot: () => 'plot', furniture: (id) => `furniture:${id}` };
  for (const [id, d] of Object.entries(m.defs)) {
    if (have.has(id) || !pick[d.family]) continue;
    const key = pick[d.family](id);
    const e = m.keys[key];
    if (!e) continue;
    const view = { tree: { pitch: 18 }, animal: { yaw: 40, pitch: 14 }, home: { pitch: 34 }, debris: { pitch: 28 }, furniture: { pitch: 16 } }[d.family] || {};
    list.push({ id, kind: d.family, model: { file: e.file, key: e.kind === 'skinned' ? `${key}#rigid` : key }, ...view });
  }
  // the barn's upgrade levels and the windmill sails are not separate icons
  fs.mkdirSync(path.dirname(itemsFile), { recursive: true });
  fs.writeFileSync(path.join(CACHE, 'items', 'icons.json'), JSON.stringify(list, null, 1));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
