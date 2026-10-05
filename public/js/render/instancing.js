// Batches: one BatchedMesh per material family (GDD §8.6, App. F: BatchedMesh + vertex colours by default),
// keyed by models.js keys. Owned by the render-world lane.
//
//   createBatch({ name, material, instances, vertices, indices, castShadow, receiveShadow }) -> batch
//     batch.mesh                    the THREE.BatchedMesh (add it to a layer)
//     batch.add(key, matrix, color?) -> handle      one instance of the model `key`
//     batch.setKey(handle, key)     swap the model (a crop stage change is one call, tech §10.3)
//     batch.setMatrix(handle, m) / batch.setColor(handle, color) / batch.setVisible(handle, bool)
//     batch.remove(handle)
//     batch.keyOf(handle) / batch.count / batch.stats()
//     batch.onSwap(fn(key))         a key's placeholder was replaced by the real model (bounds changed)
//     batch.define(key, geometry)   a procedural geometry under a key of our own ('hh:fence_rail' ...)
//     batch.onChange(fn)            any add / remove / setKey / setMatrix / setColor / setVisible (static batches:
//                                   index.js refreshes the shadow cache and the cull list on it)
//   Geometry comes from models.geometryFor(key) once it is prepared; until then a placeholder box of the
//   key's footprint stands in and is swapped in place when models.ready(key) resolves. Capacity grows by
//   doubling (BatchedMesh.setInstanceCount / setGeometrySize), never by rebuilding the batch.
//   The batch draws everything in one multi-draw call (plus one per shadow pass when it casts shadows).
import * as THREE from 'three';
import { models } from './models.js';

/**
 * Mirror every instance of `src` into `dst` under `mapKey(key)` (RD-13, QA wave 2: the static shadow map is drawn from
 * the buildings' far-band twins, a quarter of their triangles, in a pass of its own). add / setKey / setMatrix /
 * setVisible / remove / define on `src` are wrapped in place; `dst` keeps one twin per live `src` handle.
 * `src.setMatrixOwn(h, m)` moves only the source instance (animated parts: the twin's shadow stays static).
 */
export function mirrorBatch(src, dst, mapKey) {
  const twin = new Map();
  const { add, setKey, setMatrix, setVisible, remove, define } = src;
  src.define = (key, g) => { define(key, g); dst.define(key, g); };
  src.add = (key, m, c) => { const h = add(key, m, c); twin.set(h, dst.add(mapKey(key), m)); return h; };
  src.setKey = (h, key) => { setKey(h, key); const t = twin.get(h); if (t !== undefined) dst.setKey(t, mapKey(key)); };
  src.setMatrix = (h, m) => { setMatrix(h, m); const t = twin.get(h); if (t !== undefined) dst.setMatrix(t, m); };
  // a part that moves every frame (the windmill's sails) keeps its twin where it was: mirroring the spin re-drew the
  // whole static shadow map on every frame (mobile wave: 31 of 31 frames on the L20 farm)
  src.setMatrixOwn = (h, m) => setMatrix(h, m);
  src.setVisible = (h, v) => { setVisible(h, v); const t = twin.get(h); if (t !== undefined) dst.setVisible(t, v); };
  src.remove = (h) => { remove(h); const t = twin.get(h); if (t !== undefined) { dst.remove(t); twin.delete(h); } };
  return { twinOf: (h) => twin.get(h), get count() { return twin.size; } };
}

/** Next capacity for `need` slots starting from `cap` (doubling; exported for tests). */
/**
 * Level of detail for a batch (GDD §8.3 / §8.6): an instance draws under `mapKey(key)` (its far-band twin, a quarter
 * of the triangles) while the whole view is in the far band (`set(true)`), or while the instance itself stands `far`
 * metres or more from the eye (`setEye`, +-5 % hysteresis per instance: a busy L40 farm at 65 m, still the mid band,
 * was 311-367k triangles with every building and crop at full detail). `keyOf` keeps answering the logical key, so
 * callers that compare keys never notice; `add` / `setKey` / `setMatrix` / `remove` are wrapped in place.
 */
export function bandKeys(src, mapKey, { far = 60 } = {}) {
  const logical = new Map();                // handle -> logical key
  const pos = new Map();                    // handle -> [x, y, z] (world, from its matrix)
  const farH = new Set();                   // handles beyond `far` of the eye
  const { add, setKey, setMatrix, remove, keyOf } = src;
  let on = false;
  let eye = null;
  let scale = 1;
  const at = (m) => (m && m.elements ? [m.elements[12], m.elements[13], m.elements[14]] : null);
  const dist = (p) => Math.hypot(p[0] - eye.x, p[1] - eye.y, p[2] - eye.z) * scale;
  const rekey = (h) => { const k = logical.get(h); setKey(h, on || farH.has(h) ? mapKey(k) : k); };
  /** Re-judge one instance against the eye; true when its side changed. */
  const judge = (h) => {
    const p = pos.get(h);
    if (!eye || !p) return false;
    const was = farH.has(h);
    const now = dist(p) >= far * (was ? 0.95 : 1.05);
    if (now === was) return false;
    if (now) farH.add(h); else farH.delete(h);
    return true;
  };
  src.add = (key, m, c) => {
    const p = at(m);
    const beyond = Boolean(eye && p && dist(p) >= far * 1.05);
    const h = add(on || beyond ? mapKey(key) : key, m, c);
    logical.set(h, key);
    if (p) pos.set(h, p);
    if (beyond) farH.add(h);
    return h;
  };
  src.setKey = (h, key) => { logical.set(h, key); rekey(h); };
  src.setMatrix = (h, m) => {
    setMatrix(h, m);
    const p = at(m);
    if (!p || !logical.has(h)) return;
    pos.set(h, p);
    if (judge(h) && !on) rekey(h);
  };
  src.keyOf = (h) => (logical.has(h) ? logical.get(h) : keyOf(h));
  src.remove = (h) => { remove(h); logical.delete(h); pos.delete(h); farH.delete(h); };
  return {
    get on() { return on; },
    /** The far band: every instance draws its twin (false: each by its own distance again). */
    set(v) {
      if (Boolean(v) === on) return;
      on = Boolean(v);
      if (!on) for (const h of logical.keys()) judge(h);
      for (const h of logical.keys()) rekey(h);
    },
    /** The eye moved (`s` scales distances like the zoom band's lodDistance): returns how many instances swapped. */
    setEye(e, s = 1) {
      eye = { x: e.x, y: e.y, z: e.z };
      scale = s > 0 ? s : 1;
      if (on) return 0;
      let n = 0;
      for (const h of logical.keys()) if (judge(h)) { rekey(h); n++; }
      return n;
    },
    /** Is this instance drawing its twin now? */
    isFar(h) { return on || farH.has(h); },
  };
}

export function grownCapacity(cap, need) {
  let c = Math.max(1, cap);
  while (c < need) c *= 2;
  return c;
}

export function createBatch({ name, material, instances = 256, vertices = 1 << 16, indices = 1 << 17,
  castShadow = false, receiveShadow = true } = {}) {
  let mesh = new THREE.BatchedMesh(instances, vertices, indices, material);
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.sortObjects = false;                 // opaque: sorting only costs (tech §10.12)
  mesh.perObjectFrustumCulled = true;
  mesh.frustumCulled = false;               // the batch spans the farm; per-object culling does the work
  let maxInstances = instances;
  let maxVertices = vertices;
  let maxIndices = indices;
  let usedVertices = 0;
  let usedIndices = 0;
  let live = 0;
  const geoIds = new Map();                 // key -> { id, real }
  const byKey = new Map();                  // key -> Set<handle>
  const keyOfHandle = new Map();            // handle -> key
  const swapFns = new Set();
  const changeFns = new Set();
  const changed = () => { for (const fn of changeFns) fn(); };
  const pendingReady = new Set();

  function reserve(geo) {
    const v = geo.getAttribute('position').count;
    const i = geo.getIndex() ? geo.getIndex().count : 0;
    if (usedVertices + v > maxVertices || usedIndices + i > maxIndices) {
      maxVertices = grownCapacity(maxVertices, usedVertices + v);
      maxIndices = grownCapacity(maxIndices, usedIndices + i);
      mesh.setGeometrySize(maxVertices, maxIndices);
    }
    usedVertices += v;
    usedIndices += i;
  }

  function addGeo(geo) {
    reserve(geo);
    return mesh.addGeometry(geo);
  }

  function swapToReal(key) {
    const g = geoIds.get(key);
    if (!g || g.real) return;
    const geo = models.geometryFor(key);
    if (!geo) return;
    const id = addGeo(geo);
    const old = g.id;
    geoIds.set(key, { id, real: true });
    for (const h of byKey.get(key) || []) mesh.setGeometryIdAt(h, id);
    try { mesh.deleteGeometry(old); } catch { /* still referenced: harmless */ }
    for (const fn of swapFns) fn(key);
  }

  function geometryId(key) {
    let g = geoIds.get(key);
    if (g) return g.id;
    const real = models.geometryFor(key);
    if (real) {
      g = { id: addGeo(real), real: true };
    } else {
      g = { id: addGeo(models.placeholder(key)), real: false };
      if (!pendingReady.has(key) && models.has(key)) {
        pendingReady.add(key);
        models.ready(key).then(() => { pendingReady.delete(key); swapToReal(key); },
          (err) => { pendingReady.delete(key); console.error(`batch ${name}: model ${key} failed; keeping its placeholder`, err); });
      }
    }
    geoIds.set(key, g);
    return g.id;
  }

  function track(handle, key) {
    let set = byKey.get(key);
    if (!set) { set = new Set(); byKey.set(key, set); }
    set.add(handle);
    keyOfHandle.set(handle, key);
  }
  function untrack(handle) {
    const key = keyOfHandle.get(handle);
    if (key === undefined) return;
    byKey.get(key)?.delete(handle);
    keyOfHandle.delete(handle);
  }

  return {
    get mesh() { return mesh; },
    get count() { return live; },
    /** Register a procedural geometry under a key of our own (same attribute set as the models). */
    define(key, geometry) {
      if (geoIds.has(key)) return;
      geoIds.set(key, { id: addGeo(geometry), real: true });
    },
    add(key, matrix, color) {
      const gid = geometryId(key);
      if (live + 1 > maxInstances) {
        maxInstances = grownCapacity(maxInstances, live + 1);
        mesh.setInstanceCount(maxInstances);
      }
      const h = mesh.addInstance(gid);
      live++;
      if (matrix) mesh.setMatrixAt(h, matrix);
      if (color) mesh.setColorAt(h, color);
      track(h, key);
      if (changeFns.size) changed();
      return h;
    },
    setKey(h, key) {
      if (keyOfHandle.get(h) === key) return;
      mesh.setGeometryIdAt(h, geometryId(key));
      untrack(h);
      track(h, key);
      if (changeFns.size) changed();
    },
    keyOf(h) { return keyOfHandle.get(h); },
    setMatrix(h, m) { mesh.setMatrixAt(h, m); if (changeFns.size) changed(); },
    getMatrix(h, m) { return mesh.getMatrixAt(h, m); },
    setColor(h, c) { mesh.setColorAt(h, c); if (changeFns.size) changed(); },
    setVisible(h, v) { mesh.setVisibleAt(h, v); if (changeFns.size) changed(); },
    remove(h) {
      if (!keyOfHandle.has(h)) return;
      untrack(h);
      mesh.deleteInstance(h);
      live--;
      if (changeFns.size) changed();
    },
    onSwap(fn) { swapFns.add(fn); return () => swapFns.delete(fn); },
    onChange(fn) { changeFns.add(fn); return () => changeFns.delete(fn); },
    stats() { return { instances: live, maxInstances, geometries: geoIds.size, vertices: usedVertices, maxVertices }; },
    dispose() { mesh.dispose(); mesh = null; },
  };
}
