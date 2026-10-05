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
import { ASSET_ROOT, pageBuild } from './assets.js';

export const FALLBACK_ICON = '_fallback';
const BASE = `${ASSET_ROOT}icons/`;
let manifest = null;
let promise = null;
let fetcher = (url, opts) => fetch(url, opts);

/** Test seam (Node has no fetch for local files). */
export function setIconFetcher(fn) { fetcher = fn; }

export function initIcons() {
  if (!promise) {
    promise = (async () => {
      // versioned by the page's build hash (immutable, SV-05); without one, revalidated
      const build = pageBuild();
      const res = await fetcher(`${BASE}manifest.json${build ? `?v=${build}` : ''}`, build ? {} : { cache: 'no-cache' });
      if (!res.ok) throw new Error(`icon manifest: HTTP ${res.status}`);
      manifest = await res.json();
    })();
    promise.catch((err) => {
      console.error('icon manifest failed to load; icons are requested by id without a check', err);
      promise = null;
    });
  }
  return promise;
}

export function hasIcon(id) { return !!(manifest && Object.hasOwn(manifest.ids, id)); }

export function iconIds() { return manifest ? Object.keys(manifest.ids) : []; }

export function iconUrl(id, size = 128) {
  const known = !manifest || Object.hasOwn(manifest.ids, id);
  const name = known && typeof id === 'string' && /^[a-z0-9_]{1,40}$/.test(id) ? id : FALLBACK_ICON;
  const v = manifest && manifest.hash ? `?v=${manifest.hash}` : '';
  return size <= 64 ? `${BASE}64/${name}.png${v}` : `${BASE}${name}.png${v}`;
}
