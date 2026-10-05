// Prepared models: every 3D asset of the game behind one key scheme, ready for BatchedMesh / InstancedMesh
// (static geometry with baked vertex colours) or as skinned clones with their clips (animals, avatars), plus
// the shared Lambert look (wrap lighting + warm rim) and a composable shader-patch hook. Owned by the
// render-life lane; render-world consumes it (objects, crops, trees, buildings, decor). Built by
// tools/build-assets.mjs into public/assets/models/ (manifest.json + one GLB per def family member).
//
// UNITS AND FRAMES. Metres (1 tile = TILE_M = 2 m). Y up. Every model's origin is the CENTRE of its
// footprint at ground level (y = 0 is the soil line; crop roots may dip below it). Models face +Z at rot 0
// (doors, animal heads). A def with size [w, d] fills about 0.9 of w x d tiles; render-world places an
// object at the centre of its (rotated) footprint and rotates it by rot * 90 degrees about Y.
//
// KEY SCHEME (manifest keys; `models.keyOf(defId, variant)` builds them from content ids):
//   plot                         tilled soil mound (1 x 1 tile)
//   crop:<cropId>:<s>            s = 0..3, the index returned by shared/rules/time.js stage():
//                                0 seeded (soil specks + seedlings), 1 sprout, 2 growing, 3 ready (produce
//                                visible, saturated). ONE geometry per plot: the jittered cluster of 1-9
//                                plants is baked in, so a plot is one instance.
//   tree:<treeId>:<state>        state = sapling | young | mature | ready   (pine also: stump)
//                                sapling = first cycle, young = second cycle (GDD §3.2 rule 3), mature =
//                                cycle running (no ripe fruit), ready = ripe fruit on the canopy
//   animal:<animalId>[:baby]     skinned or rigid (see `info(key).kind`), adult or baby (wave 3: every breedable
//                                species has a rigid `:baby` with a baby's proportions, info.baby = true)
//   furniture:<id>               the farmhouse interior's pieces (wave 3; content FURNITURE, 1 interior tile = 1 m)
//   building:<id>                production buildings, barn (+ building:barn:1..3 upgrades), farmhouse,
//                                market_stand, order_board, compost_bin ...
//   home:<homeId>                coop, cow_barn, pasture, beehive, pig_pen, duck_pond, goat_yard, stable, paddock
//   decor:<decorId>              decorations (GDD §3.8)
//   debris:<kind>                weed, rock, stump, log, boulder
//   prop:<name>                  signpost (for sale), fence_post, fence_rail, crate_stack, hay_bale, mailbox ...
//   avatar:<body>                farmer_a (him), farmer_b (her): skinned, with clips
//   tool:<toolId>                hand-held tools for the avatars (sickle, watering_can, basket ...)
//   `models.keys(prefix)` lists what exists; `models.has(key)` checks one. Unknown keys get a placeholder.
//
// STATIC GEOMETRY CONTRACT (geometryFor): a shared THREE.BufferGeometry, indexed, attributes
//   position (Float32 x3, metres), normal (Float32 x3; creased at 40 degrees on organic models, flat on
//   architecture), color (Float32 x3, LINEAR rgb, the material colours baked in, saturation already boosted),
//   sway (Float32 x1: bend weight, 0 at the root / on rigid parts, rising with height^2 up to the key's
//   amplitude `info(key).sway`: 0 seeded, 0.3 sprout, 0.7 growing, 1.6 ready crops; 0.35 canopies, 0.3 pines;
//   1 for grass/flower tufts and other keys without an amplitude). Every static key has the same
//   attribute set and types, so any mix of them fits one BatchedMesh. Exception (wave 3): `animal:*` keys (and
//   skinned animals) also carry `_coat` (Float32 x3: coat mask, spot mask, lightness / 2) for the bred coats of
//   animals-view; they are never batched with other keys. A skinned key's geometryFor() is its
//   rigid bind-pose twin (for far, instanced animals). Never dispose or mutate a shared geometry.
//
// API (all methods on the exported `models` object; stable):
//   init() -> Promise<void>              loads the manifest (call once at boot; cheap)
//   ready(keys | key) -> Promise<void>   loads the files holding these keys (lazy per family file); unknown
//                                        keys resolve at once (they stay placeholders)
//   isReady(key) -> boolean              prepared and cached
//   has(key) / keys(prefix?) / info(key) manifest lookups ({ file, kind: 'static'|'skinned'|'rigid',
//                                        family, def, footprint, size, min, max, tris, anim, sway, doubleSided })
//   keyOf(defId, variant?) -> key        content id -> key via manifest.defs / aliases ('wheat', 3) ->
//                                        'crop:wheat:3'; ('apple_tree', 'ready'); ('cow', 'baby')
//   cropKey(cropId, stageIndex) / treeKey(treeId, state)   explicit helpers
//   geometryFor(key) -> BufferGeometry | null   null until ready(key) resolved (use placeholder())
//   placeholder(key) -> BufferGeometry   a soft box filling the key's footprint (same attribute set)
//   boundsOf(key) -> THREE.Box3          model-space bounds (picking proxies, badges height)
//   clone(key, { tint? }) -> { object, clips: Map<name, AnimationClip>, skinned } | null
//                                        an independent Object3D (SkeletonUtils clone for skinned keys,
//                                        a Mesh for static ones); tint: { materialName: '#hex' } recolours
//                                        named source materials (avatars' clothes in the player colour). A
//                                        one-mesh skinned model carries the tinted part as a vertex mask
//                                        (`_tint`, performance-12): its material mixes toward the tint colour
//   material(name = 'standard') -> shared MeshLambertMaterial (vertexColors, wrap lighting + rim)
//                                        names: 'standard', 'foliage' (DoubleSide), 'ghost' (transparent)
//   createMaterial(opts) -> a NEW patched Lambert (opts: any MeshLambertMaterial params + { wrap, rim })
//   dispose(key?)                        drop prepared data (all when key omitted)
// Named exports:
//   LOOK                    shared uniforms { uWrap, uRim, uRimColor } of every material made here (tune
//                           in look-dev; night can lower uRim)
//   addShaderPatch(material, name, fn(shader, renderer), cacheKey?)   composable onBeforeCompile: patches
//                           run in insertion order; each gets the program cache key `name:cacheKey`.
//                           render-world adds its sway/wind patch with this instead of overwriting
//                           onBeforeCompile (which would drop the wrap lighting).
//   wrapLighting(material)  adds the LOOK patch to any Lambert material (idempotent)
//   Night lights (wave 4, owner wish 11): the LOOK patch also carries LAMPS: up to LAMP_N warm point lights (view-space
//   positions written per frame by render/index.js for the lamps nearest the view, uLampK = night strength; one uniform
//   branch skips them by day) and the night glow of window glass (vertex colour GLASS) and lamp glass (LAMP_GLASS)
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { loadManifest, getManifest, loadGLB } from './assets.js';

export const LAMP_N = 4;
export const GLASS_LIN = Object.freeze([0.347, 0.651, 0.807]);       // '#9FD3E8' linear: every building's window panes
export const LAMP_GLASS_LIN = Object.freeze([1.0, 0.745, 0.254]);   // '#FFE08A' linear: lanterns, lamp posts, wall lamps

export const LOOK = {
  uWrap: { value: 0.42 },                          // half-Lambert-ish terminator: soft, painterly shadow side
  uRim: { value: 0.16 },                           // warm back-light rim (FV2's painted edge light)
  uRimColor: { value: new THREE.Color('#FFE2B0') },
  // wave 4: the night lights (see the header): view-space lamp positions (w = strength 0..1), range (m), colour, strength
  uLampPos: { value: Array.from({ length: LAMP_N }, () => new THREE.Vector4(0, -1e4, 0, 0)) },
  uLampR: { value: 5.5 },
  uLampColor: { value: new THREE.Color('#FFC27A') },
  uLampK: { value: 0 },
  uGlow: { value: 0 },                              // window and lamp glass glow (0 by day, 1 at night)
};
/** The night-lights GLSL (shared by the models' look and the ground, render/ground.js). Needs `normal`, `vViewPosition`,
 *  `diffuseColor` and `outgoingLight` (the Lambert fragment), and adds warm light from the nearest lamps. */
export const LAMPS_PARS = /* glsl */`
uniform vec4 uLampPos[ ${LAMP_N} ];
uniform float uLampR;
uniform vec3 uLampColor;
uniform float uLampK;
`;
export const LAMPS_FRAG = /* glsl */`
if ( uLampK > 0.001 ) {
  vec3 hhP = - vViewPosition;
  vec3 hhN = normalize( normal );
  vec3 hhAcc = vec3( 0.0 );
  for ( int i = 0; i < ${LAMP_N}; i ++ ) {
    vec3 hhL = uLampPos[ i ].xyz - hhP;
    float hhD = length( hhL );
    float hhA = clamp( 1.0 - hhD / uLampR, 0.0, 1.0 );
    hhA *= hhA * uLampPos[ i ].w;
    hhAcc += hhA * ( 0.35 + 0.65 * clamp( dot( hhN, hhL / max( hhD, 1e-3 ) ), 0.0, 1.0 ) );
  }
  outgoingLight += uLampColor * diffuseColor.rgb * hhAcc * uLampK * 0.95;
}
`;

const PATCHES = Symbol('hhPatches');

/** Compose shader patches on one material (each patch edits the shader source in order). */
export function addShaderPatch(material, name, fn, cacheKey = '') {
  let list = material[PATCHES];
  if (!list) {
    list = [];
    material[PATCHES] = list;
    material.onBeforeCompile = (shader, renderer) => {
      for (const p of list) p.fn(shader, renderer);
    };
    material.customProgramCacheKey = () => list.map((p) => `${p.name}:${p.cacheKey}`).join('|');
  }
  const i = list.findIndex((p) => p.name === name);
  if (i >= 0) list[i] = { name, fn, cacheKey }; else list.push({ name, fn, cacheKey });
  material.needsUpdate = true;
  return material;
}

const WRAP_FRAG_PARS = /* glsl */`
uniform float uWrap;
uniform float uRim;
uniform vec3 uRimColor;
uniform float uGlow;
${LAMPS_PARS}
`;
const GLOW_FRAG = /* glsl */`
#ifdef USE_COLOR
if ( uGlow > 0.001 ) {
  // window panes and lamp glass light up at night (their vertex colours are the shared GLASS / LAMP_GLASS swatches)
  vec3 hhG1 = abs( vColor.rgb - vec3( ${GLASS_LIN.join(', ')} ) );
  vec3 hhG2 = abs( vColor.rgb - vec3( ${LAMP_GLASS_LIN.join(', ')} ) );
  float hhWin = step( max( hhG1.r, max( hhG1.g, hhG1.b ) ), 0.014 );
  float hhLamp = step( max( hhG2.r, max( hhG2.g, hhG2.b ) ), 0.014 );
  outgoingLight = mix( outgoingLight, vec3( 1.0, 0.78, 0.42 ) * 1.25, hhWin * uGlow * 0.92 );
  outgoingLight = mix( outgoingLight, vec3( 1.0, 0.86, 0.55 ) * 1.6, hhLamp * uGlow );
}
#endif
`;

/** Wrap (soft terminator) lighting + a warm rim on a MeshLambertMaterial. */
export function wrapLighting(material) {
  return addShaderPatch(material, 'hh-look', (shader) => {
    shader.uniforms.uWrap = LOOK.uWrap;
    shader.uniforms.uRim = LOOK.uRim;
    shader.uniforms.uRimColor = LOOK.uRimColor;
    shader.uniforms.uGlow = LOOK.uGlow;
    for (const k of ['uLampPos', 'uLampR', 'uLampColor', 'uLampK']) shader.uniforms[k] = LOOK[k];
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WRAP_FRAG_PARS}`)
      .replace('#include <lights_lambert_pars_fragment>', `#include <lights_lambert_pars_fragment>
        #undef RE_Direct
        void RE_Direct_Wrap( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal,
            const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material,
            inout ReflectedLight reflectedLight ) {
          float dotNL = saturate( ( dot( geometryNormal, directLight.direction ) + uWrap ) / ( 1.0 + uWrap ) );
          reflectedLight.directDiffuse += dotNL * directLight.color * BRDF_Lambert( material.diffuseColor );
        }
        #define RE_Direct RE_Direct_Wrap`)
      .replace('#include <opaque_fragment>', `{
          float rimK = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );
          outgoingLight += uRimColor * diffuseColor.rgb * ( uRim * rimK * rimK * rimK );
        }
        ${LAMPS_FRAG}
        ${GLOW_FRAG}
        #include <opaque_fragment>`);
  }, 'v2');
}

/** The player-colour mask of a one-mesh skinned model: diffuse mixes toward uTintColor where `_tint` is 1. */
export function addTintMask(material, uTint = { value: new THREE.Color(1, 1, 1) }) {
  addShaderPatch(material, 'hh-tintmask', (shader) => {
    shader.uniforms.uTintColor = uTint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float _tint;\nvarying float vTintMask;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTintMask = _tint;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTintColor;\nvarying float vTintMask;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, uTintColor, vTintMask );');
  }, 'v1');
  material.userData.tint = uTint;
  return material;
}

/** A new Lambert material with the shared look. */
function createMaterial(opts = {}) {
  const { wrap = true, ...params } = opts;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, ...params });
  if (wrap) wrapLighting(m);
  return m;
}

const sharedMats = new Map();
function material(name = 'standard') {
  let m = sharedMats.get(name);
  if (!m) {
    if (name === 'foliage') m = createMaterial({ side: THREE.DoubleSide });
    else if (name === 'ghost') m = createMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
    else m = createMaterial();
    m.name = `hh-${name}`;
    sharedMats.set(name, m);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------
// Geometry normalisation: whatever the GLB holds (meshopt-quantised Int16/Int8, interleaved, a node
// transform for dequantisation), the result is the canonical Float32 attribute set in model space.
const ATTRS = ['position', 'normal', 'color', 'sway'];

function toFloat(attr, itemSize) {
  const n = attr.count;
  const out = new Float32Array(n * itemSize);
  for (let i = 0; i < n; i++) {
    out[i * itemSize] = attr.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
  }
  return new THREE.BufferAttribute(out, itemSize);
}

/** Canonical static geometry from a mesh (world matrix of the node baked in). Exported for tests. */
export function canonicalGeometry(mesh, matrix = mesh.matrixWorld) {
  const src = mesh.geometry;
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position');
  g.setAttribute('position', toFloat(pos, 3));
  g.setAttribute('normal', src.getAttribute('normal') ? toFloat(src.getAttribute('normal'), 3) : null);
  if (!g.getAttribute('normal')) { g.deleteAttribute('normal'); g.computeVertexNormals(); }
  const col = src.getAttribute('color');
  if (col) g.setAttribute('color', toFloat(col, 3));
  else {
    const c = new THREE.Color(mesh.material && mesh.material.color ? mesh.material.color : 0xffffff);
    const a = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  const sway = src.getAttribute('_sway') || src.getAttribute('sway');
  g.setAttribute('sway', sway ? toFloat(sway, 1) : new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  // an animal's coat mask (wave 3, `_coat` = coat, spot, tone / 2): only animal keys carry it (animals-view's coat patch)
  const coat = src.getAttribute('_coat');
  if (coat) g.setAttribute('_coat', toFloat(coat, 3));
  if (src.index) g.setIndex(new THREE.BufferAttribute(src.index.array.slice(), 1));
  else {
    const idx = pos.count > 65535 ? new Uint32Array(pos.count) : new Uint16Array(pos.count);
    for (let i = 0; i < pos.count; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (matrix) g.applyMatrix4(matrix);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function boxGeometry(w, h, d, hex = '#B9A98A') {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------------------------------
const prepared = new Map();      // key -> { geometry, bounds, template?, clips?, skinned }
const loading = new Map();       // file -> Promise<void>
const placeholders = new Map();  // key -> BufferGeometry

function findByKey(root, key) {
  let hit = null;
  root.traverse((o) => { if (!hit && o.userData && o.userData.key === key) hit = o; });
  return hit;
}

function lambertFrom(src, vertexColors) {
  const m = createMaterial({ vertexColors, color: vertexColors ? 0xffffff : (src && src.color ? src.color.clone() : 0xffffff) });
  m.name = src && src.name ? src.name : 'hh';
  if (src && src.map) { m.map = src.map; m.map.colorSpace = THREE.SRGBColorSpace; }
  if (src && src.transparent) { m.transparent = true; m.opacity = src.opacity; }
  return m;
}

function prepareFile(file, gltf) {
  const m = getManifest();
  gltf.scene.updateMatrixWorld(true);
  for (const [key, e] of Object.entries(m.keys)) {
    if (e.file !== file || prepared.has(key)) continue;
    if (e.kind === 'skinned') {
      const node = findByKey(gltf.scene, key);
      if (!node) { console.error(`model ${key}: node missing in ${file}`); continue; }
      const template = node;
      template.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const masked = !!o.geometry.getAttribute('_tint');
        const conv = mats.map((mt) => { const m = lambertFrom(mt, !!o.geometry.getAttribute('color')); if (masked) addTintMask(m); return m; });
        o.material = Array.isArray(o.material) ? conv : conv[0];
        o.castShadow = false;               // blob shadows for everything that moves (tech §10.9)
        o.receiveShadow = false;
        if (o.isSkinnedMesh) o.frustumCulled = false;
      });
      const wanted = new Set(e.anim || []);
      const clips = new Map();
      for (const c of gltf.animations) if (!wanted.size || wanted.has(c.name)) clips.set(c.name, c);
      const rigidNode = e.rigidNode ? findByKey(gltf.scene, `${key}#rigid`) : null;
      const geometry = rigidNode && rigidNode.isMesh ? canonicalGeometry(rigidNode) : null;
      const bounds = new THREE.Box3(new THREE.Vector3(...e.min), new THREE.Vector3(...e.max));
      prepared.set(key, { geometry, bounds, template, clips, skinned: true });
    } else {
      const node = findByKey(gltf.scene, key);
      if (!node || !node.isMesh) { console.error(`model ${key}: mesh missing in ${file}`); continue; }
      const geometry = canonicalGeometry(node);
      // The file stores the bend weight (0..1); the key's amplitude (0.3 sprout, 0.7 growing, 1.6 ready,
      // ~0.35 canopies) is baked in here so a shader multiplies one attribute and nothing per instance.
      const amp = Number.isFinite(e.sway) ? e.sway : 1;
      if (amp !== 1) {
        const sw = geometry.getAttribute('sway').array;
        for (let i = 0; i < sw.length; i++) sw[i] *= amp;
      }
      prepared.set(key, { geometry, bounds: geometry.boundingBox.clone(), skinned: false });
    }
  }
}

function fileOf(key) {
  const m = getManifest();
  const e = m && m.keys[key];
  return e ? e.file : null;
}

function info(key) {
  const m = getManifest();
  return (m && m.keys[key]) || null;
}

function keyOf(defId, variant) {
  const m = getManifest();
  if (!m) return null;
  const alias = m.aliases && m.aliases[defId];
  if (alias && variant === undefined) return alias;
  const d = m.defs && m.defs[defId];
  const base = d ? `${d.family}:${defId}` : (alias || null);
  if (!base) return null;
  const k = variant === undefined || variant === null ? base : `${base}:${variant}`;
  return m.keys[k] ? k : (variant === undefined ? (m.keys[base] ? base : (d && d.keys[0]) || null) : null);
}

export const models = {
  async init() { await loadManifest(); },

  ready(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const files = new Set();
    for (const k of list) {
      if (prepared.has(k)) continue;
      const f = fileOf(k);
      if (f) files.add(f);
    }
    return Promise.all([...files].map((f) => {
      let p = loading.get(f);
      if (!p) {
        p = loadGLB(f).then((gltf) => prepareFile(f, gltf));
        loading.set(f, p);
        p.catch(() => loading.delete(f));
      }
      return p;
    })).then(() => undefined);
  },

  isReady(key) { return prepared.has(key); },
  has(key) { return !!info(key); },
  keys(prefix = '') {
    const m = getManifest();
    return m ? Object.keys(m.keys).filter((k) => k.startsWith(prefix)) : [];
  },
  info,
  keyOf,
  cropKey(cropId, s) { return `crop:${cropId}:${s}`; },
  treeKey(treeId, state) { return `tree:${treeId}:${state}`; },

  geometryFor(key) {
    const p = prepared.get(key);
    return p ? p.geometry : null;
  },

  placeholder(key) {
    let g = placeholders.get(key);
    if (!g) {
      const e = info(key);
      const [w, d] = e && e.footprint ? e.footprint : [1, 1];
      const h = e && e.size ? Math.max(0.3, e.size[1] * 0.6) : 1;
      g = boxGeometry(w * 2 * 0.8, h, d * 2 * 0.8);
      placeholders.set(key, g);
    }
    return g;
  },

  boundsOf(key) {
    const p = prepared.get(key);
    if (p) return p.bounds;
    const e = info(key);
    if (e && e.min) return new THREE.Box3(new THREE.Vector3(...e.min), new THREE.Vector3(...e.max));
    return new THREE.Box3(new THREE.Vector3(-0.9, 0, -0.9), new THREE.Vector3(0.9, 1, 0.9));
  },

  clone(key, { tint } = {}) {
    const p = prepared.get(key);
    if (!p) return null;
    if (!p.skinned) {
      const mesh = new THREE.Mesh(p.geometry, material(info(key)?.doubleSided ? 'foliage' : 'standard'));
      mesh.name = key;
      return { object: mesh, clips: new Map(), skinned: false };
    }
    const object = SkeletonUtils.clone(p.template);
    object.name = key;
    object.position.set(0, 0, 0);
    object.rotation.set(0, 0, 0);
    object.updateMatrix();
    if (tint) {
      const hexes = Object.values(tint);
      object.traverse((o) => {
        if (!o.isMesh) return;
        if (o.geometry.getAttribute('_tint') && hexes.length) {
          // one mesh: a material of its own whose mask colour is the player's
          const c = o.material.clone();
          wrapLighting(c);
          addTintMask(c, { value: new THREE.Color(hexes[0]) });
          o.material = c;
          return;
        }
        const swap = (mt) => {
          if (!Object.hasOwn(tint, mt.name)) return mt;
          const c = mt.clone();
          c.color = new THREE.Color(tint[mt.name]);
          wrapLighting(c);
          return c;
        };
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
      });
    }
    return { object, clips: p.clips, skinned: true };
  },

  material,
  createMaterial,

  dispose(key) {
    const drop = (k) => {
      const p = prepared.get(k);
      if (!p) return;
      if (p.geometry) p.geometry.dispose();
      prepared.delete(k);
    };
    if (key) drop(key);
    else { for (const k of [...prepared.keys()]) drop(k); loading.clear(); }
  },
};
