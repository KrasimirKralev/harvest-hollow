// Install an overlay into the running process's content (contract §2.3): the server (single mode, or inside a farm's
// worker thread) and every browser. Content is a module singleton, so this changes what every rule, lookup and view
// reads, in place, without a reload.
//
//   installOverlay(overlay | null) -> { hash, changed }   restores the base snapshot taken on the first call, then writes
//                                     the overlay's patch, defs and graveyard into the CONTENT Maps and PLACEABLES with
//                                     Map.prototype.set (the documented test path: the Maps' own set still throws for
//                                     everyone else), then resetDerived() and every onOverlay listener. null restores
//                                     the base. Idempotent for the same hash.
//   installedOverlay() -> overlay | null
//   onOverlay(fn(overlay | null)) -> off()
import { CONTENT, PLACEABLES, resetDerived } from '../content/index.js';

const FAMILIES = ['crops', 'trees', 'recipes', 'animals', 'decor', 'items', 'homes'];
const PLACEABLE = new Set(['trees', 'animals', 'decor', 'homes']);
const set = Map.prototype.set;
const clear = Map.prototype.clear;

let snapshot = null;
let current = null;
const listeners = new Set();

function takeSnapshot() {
  snapshot = {
    fams: Object.fromEntries(FAMILIES.map((f) => [f, [...CONTENT[f].entries()]])),
    placeables: [...PLACEABLES.entries()],
  };
}

function restore() {
  for (const f of FAMILIES) {
    const m = CONTENT[f];
    clear.call(m);
    for (const [k, v] of snapshot.fams[f]) set.call(m, k, v);
  }
  clear.call(PLACEABLES);
  for (const [k, v] of snapshot.placeables) set.call(PLACEABLES, k, v);
}

export function installOverlay(overlay) {
  const hash = overlay ? overlay.hash : null;
  if ((current ? current.hash : null) === hash) return { hash, changed: false };
  if (!snapshot) takeSnapshot();
  restore();
  if (overlay) {
    for (const f of FAMILIES) {
      const m = CONTENT[f];
      const write = (d) => {
        set.call(m, d.id, d);
        if (PLACEABLE.has(f)) set.call(PLACEABLES, d.id, d);
      };
      for (const d of overlay.patch?.[f] ?? []) write(d);
      for (const d of overlay.defs?.[f] ?? []) write(d);
      for (const d of overlay.graveyard?.[f] ?? []) write(d);
    }
  }
  current = overlay ?? null;
  resetDerived();
  for (const fn of [...listeners]) {
    try { fn(current); } catch (err) { console.error('an overlay listener failed', err); }
  }
  return { hash, changed: true };
}

export const installedOverlay = () => current;

export function onOverlay(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
