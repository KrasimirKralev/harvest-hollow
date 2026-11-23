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
// Errors: a failed file rejects its promise and is dropped from the cache, so a later call retries. A network failure
// is a warning, not a program error (perf-a11y#6), once per file while it keeps failing (QA r3 R3-01). Option 2
// (release 1.0): ASSET_ROOT is on the public host when the page has an asset base (net/asset-base.js); a file the host fails is fetched again from this server (the data
// fallback), the manifest and the GLBs through fetchAsset, textures by a second load of the same path here.
// Owned by the infra lane from release 1.0 (release-scope §6).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { fromPack } from '../net/packs.js';
import { assetUrl, fetchAsset, onHost, selfUrl, noteHostFailure } from '../net/asset-base.js';

export const ASSET_ROOT = assetUrl('/assets/');
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
const warned = new Set();         // files warned about while they keep failing

const linkFailure = (err) => err instanceof TypeError || /HTTP \d+/.test(String(err?.message));
function firstFailure(key) {
  if (warned.has(key)) return false;
  warned.add(key);
  return true;
}

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
      const res = await fetchAsset(src, build ? {} : { cache: 'no-cache' }, fetcher);
      if (!res.ok) throw new Error(`manifest ${url}: HTTP ${res.status}`);
      manifest = await res.json();
      return manifest;
    })());
    manifestPromise.then(() => warned.delete('manifest'), (err) => {
      manifestPromise = null;
      if (!linkFailure(err)) console.error('model manifest failed to load; every model falls back to a placeholder box', err);
      else if (firstFailure('manifest')) console.warn('model manifest failed to load; placeholder boxes until it arrives', err?.message || err);
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
      // one request per model family (qa2 SV-03), a first-view member alone and in its order (QA r2 I2-C1), else
      // the single file
      let buf = await fromPack(`${MODELS}${file}`, (u) => fetcher(u), url);
      if (!buf) {
        const res = await fetchAsset(url, undefined, fetcher);
        if (!res.ok) throw new Error(`model ${file}: HTTP ${res.status}`);
        buf = await res.arrayBuffer();
      }
      if (!loader) loader = makeLoader();
      return new Promise((resolve, reject) => loader.parse(buf, MODELS, resolve, reject));
    })());
    glbCache.set(url, p);
    p.then(() => warned.delete(file), (err) => {
      // a network failure (a dropped link, a 404 mid-deploy) is not a program error; a file that does not parse is
      if (!linkFailure(err)) console.error(`model ${file} failed to load`, err);
      else if (firstFailure(file)) console.warn(`model ${file} failed to load`, err?.message || err);
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
    const load = (u) => new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(u, (t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        resolve(t);
      }, undefined, reject);
    });
    p = track(url, load(url).catch((err) => {
      if (!onHost(url)) throw err;
      noteHostFailure(`texture ${selfUrl(url)}`);
      return load(selfUrl(url));                 // the data fallback: the same file from this server
    }));
    texCache.set(key, p);
    p.then(() => warned.delete(key), (err) => {
      // a texture that does not arrive is a network matter (perf-a11y#6: console.warn); the next call retries
      if (firstFailure(key)) console.warn(`texture ${url} failed to load`, err?.message || err?.type || err);
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
  warned.clear();
  manifestPromise = null;
  manifest = null;
  loaded = 0;
  total = 0;
}
