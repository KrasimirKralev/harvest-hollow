// Asset loading: the model manifest, GLB files (GLTFLoader + the vendored MeshoptDecoder), textures, a
// per-URL promise cache and load progress (tech §10.8). Owned by the render-life lane. Most callers want
// `models.js` (prepared geometry, materials, clones); this module is the plumbing underneath it.
//
// API (stable; render-world, ui and the icon tools rely on it):
//   ASSET_ROOT                          '/assets/' (models in ASSET_ROOT + 'models/', icons in + 'icons/')
//   loadManifest(url?) -> Promise<Manifest>   models/manifest.json, fetched once (the same promise every call)
//   getManifest() -> Manifest | null    synchronous, after loadManifest() resolved
//   loadGLB(file) -> Promise<GLTF>      file is relative to models/ ('crops/wheat.glb'); cached per URL; the
//                                       URL carries ?v=<manifest.hash> so a rebuilt asset is never stale
//   loadTexture(url, { srgb = true }) -> Promise<THREE.Texture>   cached per URL
//   onProgress(fn({ loaded, total, url })) -> unsubscribe        every finished file (splash/loading bar)
//   pending() -> number                 files still loading
//   setFetcher(fn) / setLoader(loader)  tests: inject fetch / a GLTFLoader stand-in (Node has no DOM)
//
// Manifest shape (written by tools/build-assets.mjs; models.js documents the key scheme):
//   { version, hash, units, files: { 'crops/wheat.glb': { bytes } },
//     defs: { wheat: { family: 'crop', keys: ['crop:wheat:0', ...] }, ... },
//     aliases: { 'farmhouse': 'building:farmhouse', ... },
//     keys: { 'crop:wheat:3': { file, node, kind, family, def, scale, yOffset, footprint, size, min, max,
//                                tris, anim?, sway?, source }, ... } }
// Errors: a failed file rejects its promise and is dropped from the cache, so a later call retries.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { fromPack } from '../net/packs.js';

export const ASSET_ROOT = '/assets/';
const MODELS = `${ASSET_ROOT}models/`;

let fetcher = (url, opts) => fetch(url, opts);
let loader = null;
let manifestPromise = null;
let manifest = null;
const glbCache = new Map();       // url -> Promise<GLTF>
const texCache = new Map();       // url -> Promise<Texture>
const progressFns = new Set();
let loaded = 0;
let total = 0;

function makeLoader() {
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  return l;
}

function track(url, promise) {
  total++;
  const done = () => {
    loaded++;
    for (const fn of progressFns) {
      try { fn({ loaded, total, url }); } catch (err) { console.error('asset progress listener failed', err); }
    }
  };
  promise.then(done, done);
  return promise;
}

/** Test seam: replace `fetch` (Node tests serve files from disk). */
export function setFetcher(fn) { fetcher = fn; }
/** Test seam: replace the GLTFLoader (anything with `parse(buffer, path, onLoad, onError)`). */
export function setLoader(l) { loader = l; }

/** The server's build hash (<meta name="hh-build">, SV-03), or null (tests, tools). */
export function pageBuild() {
  try { return typeof document !== 'undefined' ? document.querySelector('meta[name="hh-build"]')?.content || null : null; } catch { return null; }
}

/** The model manifest (fetched once). */
export function loadManifest(url = `${MODELS}manifest.json`) {
  if (!manifestPromise) {
    // versioned by the page's build hash: served immutable, no revalidation on a warm reload (SV-05); without
    // one (tests, tools) the manifest is revalidated (ETag -> 304). Its own hash versions every GLB URL.
    const build = pageBuild();
    const src = build ? `${url}${url.includes('?') ? '&' : '?'}v=${build}` : url;
    manifestPromise = track(src, (async () => {
      const res = await fetcher(src, build ? {} : { cache: 'no-cache' });
      if (!res.ok) throw new Error(`manifest ${url}: HTTP ${res.status}`);
      manifest = await res.json();
      return manifest;
    })());
    manifestPromise.catch((err) => {
      console.error('model manifest failed to load; every model falls back to a placeholder box', err);
      manifestPromise = null;
    });
  }
  return manifestPromise;
}

export function getManifest() { return manifest; }

/** Use an already-parsed manifest (tests, tools). */
export function setManifest(m) {
  manifest = m;
  manifestPromise = Promise.resolve(m);
}

/** Load (once) and parse a GLB from models/. */
export function loadGLB(file) {
  const v = manifest && manifest.hash ? `?v=${manifest.hash}` : '';
  const url = `${MODELS}${file}${v}`;
  let p = glbCache.get(url);
  if (!p) {
    p = track(url, (async () => {
      // one request per model family (qa2 SV-03), else the single file
      let buf = await fromPack(`${MODELS}${file}`, (u) => fetcher(u));
      if (!buf) {
        const res = await fetcher(url);
        if (!res.ok) throw new Error(`model ${file}: HTTP ${res.status}`);
        buf = await res.arrayBuffer();
      }
      if (!loader) loader = makeLoader();
      return new Promise((resolve, reject) => loader.parse(buf, MODELS, resolve, reject));
    })());
    glbCache.set(url, p);
    p.catch((err) => {
      console.error(`model ${file} failed to load`, err);
      glbCache.delete(url);
    });
  }
  return p;
}

/** Load (once) a texture; colour textures are sRGB, data textures pass { srgb: false }. */
export function loadTexture(url, { srgb = true } = {}) {
  const key = `${url}|${srgb ? 's' : 'l'}`;
  let p = texCache.get(key);
  if (!p) {
    p = track(url, new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(url, (t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        resolve(t);
      }, undefined, reject);
    }));
    texCache.set(key, p);
    p.catch((err) => {
      console.error(`texture ${url} failed to load`, err);
      texCache.delete(key);
    });
  }
  return p;
}

export function onProgress(fn) {
  progressFns.add(fn);
  return () => progressFns.delete(fn);
}

export function pending() { return total - loaded; }

/** Forget every cached promise (tests; a dev hot-swap after tools/build-assets.mjs). */
export function resetAssetCache() {
  glbCache.clear();
  texCache.clear();
  manifestPromise = null;
  manifest = null;
  loaded = 0;
  total = 0;
}
