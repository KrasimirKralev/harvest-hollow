// The night's glow (release 1.0, render-look G8, graphics#10): a fake bloom. One instanced additive halo per lit window
// pane and per lamp glass, screen-stable (the same size in CSS pixels at every zoom, like the fireflies), faded by
// LOOK.uGlow (windows warm up through dusk, full at night), a pane's halo dimmed when the pane turns away from the
// camera. It draws only while something glows: 0 draw calls by day; at night one draw of a few hundred small quads
// (+0.1-0.3 ms, measured in tools/look-perf.mjs). Real bloom (UnrealBloomPass) costs +3-5 ms on a phone (release-scope §5).
//
//   glassAnchors(geometry) -> [[x, y, z, nx, nz, size], ...]   pure (tested): the window panes of a static model, from
//        its baked vertex colours (models.js GLASS_LIN, the shader's own glow test): triangles whose three vertices
//        are glass, clustered per pane (0.7 m cells and the facing), area-weighted centres pushed 6 cm out of the wall;
//        tiny slivers and whole glass walls (a greenhouse) are left out
//   createNightGlow(layer, { glow }) -> { set(key, list), update(camera, cssH) , count }
//        list = [{ x, y, z, nx, nz, s }] metres (n = the pane's outward normal in x-z, 0 for an all-round lamp; s =
//        a size factor 0.6-1.4); glow = the shared { value } uniform (LOOK.uGlow)
import * as THREE from 'three';
import { GLASS_LIN } from './models.js';

const TOL = 0.014;
const isGlass = (c, i) => Math.abs(c[i] - GLASS_LIN[0]) <= TOL && Math.abs(c[i + 1] - GLASS_LIN[1]) <= TOL && Math.abs(c[i + 2] - GLASS_LIN[2]) <= TOL;

/** The window panes of a static geometry (see the header). Pure. */
export function glassAnchors(geo, { cell = 0.7, minArea = 0.02, maxArea = 3, max = 16 } = {}) {
  const pos = geo && geo.getAttribute && geo.getAttribute('position');
  const col = geo && geo.getAttribute && geo.getAttribute('color');
  if (!pos || !col) return [];
  const P = pos.array; const C = col.array; const cs = col.itemSize;
  const idx = geo.index ? geo.index.array : null;
  const n = idx ? idx.length : pos.count;
  const clusters = new Map();
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3(); const nrm = new THREE.Vector3();
  for (let t = 0; t + 2 < n; t += 3) {
    const i0 = idx ? idx[t] : t; const i1 = idx ? idx[t + 1] : t + 1; const i2 = idx ? idx[t + 2] : t + 2;
    if (!isGlass(C, i0 * cs) || !isGlass(C, i1 * cs) || !isGlass(C, i2 * cs)) continue;
    a.fromArray(P, i0 * 3); b.fromArray(P, i1 * 3); c.fromArray(P, i2 * 3);
    nrm.subVectors(b, a).cross(c.clone().sub(a));
    const area = nrm.length() / 2;
    if (!(area > 1e-5)) continue;
    nrm.normalize();
    if (Math.abs(nrm.y) > 0.8) continue;                      // skylights and flat glass never face the camera's halo
    const cx = (a.x + b.x + c.x) / 3; const cy = (a.y + b.y + c.y) / 3; const cz = (a.z + b.z + c.z) / 3;
    const face = Math.abs(nrm.x) > Math.abs(nrm.z) ? (nrm.x > 0 ? 'x' : '-x') : (nrm.z > 0 ? 'z' : '-z');
    const key = `${Math.round(cx / cell)},${Math.round(cy / cell)},${Math.round(cz / cell)},${face}`;
    let k = clusters.get(key);
    if (!k) { k = { w: 0, x: 0, y: 0, z: 0, nx: 0, nz: 0 }; clusters.set(key, k); }
    k.w += area; k.x += cx * area; k.y += cy * area; k.z += cz * area; k.nx += nrm.x * area; k.nz += nrm.z * area;
  }
  const out = [];
  for (const k of clusters.values()) {
    if (k.w < minArea || k.w > maxArea) continue;
    const nl = Math.hypot(k.nx, k.nz) || 1;
    const nx = k.nx / nl; const nz = k.nz / nl;
    out.push([k.x / k.w + nx * 0.06, k.y / k.w, k.z / k.w + nz * 0.06, nx, nz, Math.min(1.4, Math.max(0.6, Math.sqrt(k.w) * 1.6)), k.w]);
  }
  out.sort((p, q) => q[6] - p[6]);
  return out.slice(0, max).map((x) => x.slice(0, 6));
}

const VERT = /* glsl */`
attribute vec4 aHalo;          // xyz world (metres), w size factor
attribute vec2 aN;             // the pane's outward normal (x-z); 0 = all round (a lamp)
uniform float uK;              // half-size per unit of view depth (screen-stable: CSS px / focal px)
uniform float uTime;
varying vec2 vUv;
varying float vA;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4( aHalo.xyz, 1.0 );
  // a pane facing away from the camera lets little light toward it
  vec3 toCam = cameraPosition - aHalo.xyz;
  float face = length( aN ) > 0.5 ? smoothstep( -0.15, 0.45, dot( normalize( toCam.xz ), aN ) ) : 1.0;
  vA = face * ( 0.92 + 0.08 * sin( uTime * 2.3 + aHalo.x * 1.7 + aHalo.z ) );
  mv.xy += position.xy * ( -mv.z * uK * aHalo.w );
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
uniform float uGlow;
uniform vec3 uColor;
varying vec2 vUv;
varying float vA;
void main() {
  float r = length( vUv - 0.5 ) * 2.0;
  float a = ( pow( max( 0.0, 1.0 - r ), 2.6 ) * 0.6 + smoothstep( 0.32, 0.0, r ) * 0.26 ) * uGlow * vA;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( uColor * a, a );
}`;

export function createNightGlow(layer, { glow = { value: 0 }, time = { value: 0 } } = {}) {
  const base = new THREE.PlaneGeometry(2, 2);
  const uK = { value: 0.012 };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    uniforms: { uGlow: glow, uK, uTime: time, uColor: { value: new THREE.Color(1.0, 0.7, 0.36) } },
    vertexShader: VERT, fragmentShader: FRAG,
  });
  let cap = 0;
  let mesh = null;
  const items = new Map();
  let dirty = false;
  const build = (n) => {
    cap = n;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    geo.setAttribute('aHalo', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('aN', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
    if (mesh) { mesh.geometry.dispose(); mesh.geometry = geo; } else {
      mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 13;
      mesh.name = 'nightGlow';
      mesh.visible = false;
      layer.add(mesh);
    }
  };
  build(64);
  return {
    /** The halos of one source (an object id, 'lamps'); null or [] removes them. */
    set(key, list) {
      if (list && list.length) items.set(key, list); else if (!items.delete(key)) return;
      dirty = true;
    },
    has(key) { return items.has(key); },
    /** Per frame: visible only while it glows; the screen size follows the camera's focal length (CSS px). */
    update(camera, cssH) {
      const on = glow.value > 0.02 && items.size > 0;
      mesh.visible = on;
      if (!on) return;
      if (camera && cssH > 0) {
        const fpx = (cssH / 2) / Math.tan((camera.fov * Math.PI) / 360);
        uK.value = 15 / fpx;                                   // about a 15 CSS px halo radius (size factor 1)
      }
      if (!dirty) return;
      dirty = false;
      let n = 0;
      for (const l of items.values()) n += l.length;
      if (n > cap) build(Math.max(cap * 2, n));
      const h = mesh.geometry.getAttribute('aHalo');
      const nn = mesh.geometry.getAttribute('aN');
      let i = 0;
      for (const l of items.values()) {
        for (const it of l) {
          h.setXYZW(i, it.x, it.y, it.z, it.s ?? 1);
          nn.setXY(i, it.nx || 0, it.nz || 0);
          i++;
        }
      }
      mesh.geometry.instanceCount = i;
      h.needsUpdate = true;
      nn.needsUpdate = true;
    },
    get count() { return mesh.geometry.instanceCount; },
    get mesh() { return mesh; },
  };
}
