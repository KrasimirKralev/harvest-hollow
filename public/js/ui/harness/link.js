// How the helper's screens reach the rest of the game (Harness Hollow, ui lane): the harness bus (`hx` pushes and the
// `content` event, public/js/harness/bus.js, mods lane), the installed overlay (shared/mod/install.js, mods lane; the
// letters of a change) and the farmer's key for the REST calls.
//
//   inImportMap(url, doc?) -> bool         the server lists in the page's import map every module that exists (and only
//                                          those: server/static.js), so this asks "is the harness installed?" without a
//                                          request (a 404 would be a console error on every page of a build without it)
//   loadBus() -> Promise<bus | null>       { onHarness(fn) -> off, harnessAuth() } when the build has it
//   loadOverlayApi() -> Promise<{ installedOverlay } | null>
//   farmerKey({ bus, scope, session, pid, storage }) -> token | null
//                                          the bus's key (main.js fills it at each welcome), else this page's own: multi
//                                          mode the member secret (net/farm.js session), single mode the slot's token

import { lazyImport } from '../../net/lazy.js';

/** Does the page's import map name this module (server-versioned, so it exists)? */
export function inImportMap(url, doc = globalThis.document) {
  try {
    const el = doc?.querySelector?.('script[type="importmap"]');
    const map = el ? JSON.parse(el.textContent || '{}') : null;
    return Boolean(map && map.imports && Object.hasOwn(map.imports, url));
  } catch {
    return false;
  }
}

export async function loadBus(doc) {
  if (!inImportMap('/js/harness/bus.js', doc)) return null;
  try {
    const m = await lazyImport('harvey-bus', () => import('../../harness/bus.js'));
    return typeof m.onHarness === 'function' ? m : null;
  } catch (err) {
    console.warn('helper: the harness bus did not load', err);
    return null;
  }
}

export async function loadOverlayApi(doc) {
  if (!inImportMap('/shared/mod/install.js', doc)) return null;
  try {
    const m = await lazyImport('mod-install', () => import('../../../../shared/mod/install.js'));
    return typeof m.installedOverlay === 'function' ? m : null;
  } catch {
    return null;
  }
}

/** The key the helper's REST calls carry (see the header). */
export function farmerKey({ bus = null, scope = null, session = null, pid = null, storage = globalThis.localStorage } = {}) {
  try {
    const a = bus && typeof bus.harnessAuth === 'function' ? bus.harnessAuth() : null;
    const token = typeof a === 'string' ? a : a && typeof a.token === 'string' ? a.token : null;
    if (token) return token;
  } catch { /* fall back to the page's own key */ }
  if (scope && scope.multi) return session && typeof session.secret === 'string' ? session.secret : null;
  if (!pid) return null;
  try {
    const tokens = JSON.parse(storage?.getItem('hh.tokens') || 'null');
    return tokens && typeof tokens[pid] === 'string' ? tokens[pid] : null;
  } catch {
    return null;
  }
}
