// Item and def icons: transparent PNGs rendered from the 3D models by tools/make-icons.mjs (same 3/4 camera
// and soft light for all), so the HUD, panels and the 3D badges share one look. Owned by the render-life
// lane; ui and render-world consume it.
//
// Files: public/assets/icons/<id>.png (128 px) and public/assets/icons/64/<id>.png (64 px), listed in
// public/assets/icons/manifest.json { version, hash, size: [128, 64], ids: { <id>: { kind, name? } } }.
// Ids are content ids: every item id (wheat, egg, flour, golden_egg ...), every placeable def id that is not
// an item (apple_tree, bakery, coop, chicken, flower_bed, plot ...), tool ids (hand, seed_bag, sickle,
// watering_can, feed_scoop, basket, compost_scoop, axe, hammer, big_watering_can, wide_sickle ...) and the
// currencies coins, acorns, xp, hearts.
//
// API (stable):
//   initIcons() -> Promise<void>      loads the icon manifest once (optional: iconUrl works before it)
//   iconUrl(id, size = 128) -> string URL of the icon; an id the manifest does not know (after init) gets
//                                     the fallback icon (a plain crate), never a broken image
//   hasIcon(id) -> boolean            known to the manifest (false before init)
//   iconIds() -> string[]             every id with an icon (empty before init)
//   FALLBACK_ICON                     '_fallback'
//   setIconOverlay({ [id]: url128 }, { [id]: url64 })   (additive, Harness Hollow mods lane; harness contract §2.6) a
//                                     farm's mod things: iconUrl() answers their server-made icons (immutable URLs by
//                                     overlay hash), hasIcon() is true for them, iconIds() lists them; replaces the map
import { ASSET_ROOT, pageBuild } from './assets.js';
import { fetchAsset } from '../net/asset-base.js';

export const FALLBACK_ICON = '_fallback';
const BASE = `${ASSET_ROOT}icons/`;
let manifest = null;
let promise = null;
let iconWarned = false;
let fetcher = (url, opts) => fetch(url, opts);

/** Test seam (Node has no fetch for local files). */
export function setIconFetcher(fn) { fetcher = fn; }

export function initIcons() {
  if (!promise) {
    promise = (async () => {
      // versioned by the page's build hash (immutable, SV-05); without one, revalidated
      const build = pageBuild();
      // on a host page from the public host, from this server when that fails (option 2's data fallback)
      const res = await fetchAsset(`${BASE}manifest.json${build ? `?v=${build}` : ''}`, build ? {} : { cache: 'no-cache' }, fetcher);
      if (!res.ok) throw new Error(`icon manifest: HTTP ${res.status}`);
      manifest = await res.json();
    })();
    promise.then(() => { iconWarned = false; }, (err) => {
      promise = null;
      const link = err instanceof TypeError || /HTTP \d+/.test(String(err?.message));   // QA r3 R3-01: a warning, once
      if (!link) console.error('icon manifest failed to load; icons are requested by id without a check', err);
      else if (!iconWarned) console.warn('icon manifest failed to load; icons are requested by id without a check', err?.message || err);
      iconWarned ||= link;
    });
  }
  return promise;
}

let modBig = {};
let modSmall = {};
export function setIconOverlay(big = {}, small = {}) {
  modBig = { ...big };
  modSmall = { ...small };
}

export function hasIcon(id) { return Object.hasOwn(modBig, id) || !!(manifest && Object.hasOwn(manifest.ids, id)); }

export function iconIds() { return [...(manifest ? Object.keys(manifest.ids) : []), ...Object.keys(modBig)]; }

export function iconUrl(id, size = 128) {
  if (typeof id === 'string' && Object.hasOwn(modBig, id)) return size <= 64 ? modSmall[id] ?? modBig[id] : modBig[id];
  const known = !manifest || Object.hasOwn(manifest.ids, id);
  const name = known && typeof id === 'string' && /^[a-z0-9_]{1,40}$/.test(id) ? id : FALLBACK_ICON;
  const v = manifest && manifest.hash ? `?v=${manifest.hash}` : '';
  return size <= 64 ? `${BASE}64/${name}.png${v}` : `${BASE}${name}.png${v}`;
}
