// Which model packs a farm's first view needs (release 1.0 O4; perf-a11y#3, astra#1): the client's pack scheduler
// (public/js/net/packs.js) starts those first after the welcome, and on option 2's host path the farm server names them in
// the page (server/http.js) so a browser starts them before the welcome. Pure: no DOM, no clock.
//
//   PRIO                  the default order after the first view: what a farm shows most, decor and town last
//   PREFETCHABLE          the families worth starting before the welcome (a farm reads most of them)
//   firstViewPacks(state, points, fileOf, radius?) -> [pack id]   the families of the objects (and the crops on them)
//                         within `radius` tiles of any of `points` (a farmer's spawn), plus the farmers, in PRIO order
//   modelFileOf(manifest) -> (defId) -> 'crops/wheat.glb' | null  a def's model file in render/assets.js's manifest
//   modelPath(file) -> '/assets/models/<file>'   the identifier the packs index a model file by (not a URL)
//   firstViewFiles(state, points, fileOf, { radius?, lead?, after?, seen? }) -> ['/assets/models/buildings/farmhouse.glb', ...]
//                         the model files of the objects on screen (`seen`, else within `radius`): the `lead` defs
//                         first (the home buildings the boot curtain waits for), then `after`, then nearest (QA r2 I2-C1)
//   SINGLE_SHARE          a family the farm reads less of than this (by bytes) loads file by file, not as its pack
//   packShares(state, fileOf, index) -> { [pack id]: share 0..1 }  the bytes of each family the whole farm uses

export const PRIO = ['crops', 'homes', 'buildings', 'avatars', 'animals', 'trees', 'props', 'plots', 'debris', 'tools', 'restore',
  'giants', 'furniture', 'decor', 'town'].map((f) => `models-${f}`);
export const PREFETCHABLE = PRIO.slice(0, PRIO.indexOf('models-props') + 1);
export const SINGLE_SHARE = 0.35;

const order = (id) => (PRIO.indexOf(id) < 0 ? 99 : PRIO.indexOf(id));

export function firstViewPacks(state, points, fileOf, radius = 14) {
  const at = (Array.isArray(points) ? points : [points]).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.z));
  const dirs = new Set(['avatars']);
  const objs = state?.farm?.objects || {};
  for (const o of Object.values(objs)) {
    if (!o || !at.some((p) => Math.hypot((o.x ?? 0) - p.x, (o.z ?? 0) - p.z) <= radius)) continue;
    for (const def of [o.def, o.crop?.def]) {
      if (typeof def !== 'string') continue;
      let f = null;
      try { f = fileOf(def); } catch { f = null; }
      if (typeof f === 'string' && f.includes('/')) dirs.add(f.slice(0, f.indexOf('/')));
    }
  }
  return [...dirs].map((d) => `models-${d}`).sort((a, b) => order(a) - order(b));
}

/**
 * The model files the first view draws (QA r2 I2-C1), as URL paths, each once: the files of the `lead` defs first (the
 * farmhouse and the barn, which the boot curtain waits for), then the `after` paths in their order (the farmers'
 * avatars), then nearest a point first, ties by path. An object is in the first view when `seen(o)` says so (main.js
 * asks the view, after its first setState, what is on screen); without `seen`, when it lies within `radius` tiles of a
 * point. On a self-path boot net/packs.js fetches these before any other model. Never throws on a broken state, a
 * `seen` or a `fileOf` that throws.
 * @param {object} state @param {{x:number,z:number}|Array<{x:number,z:number}>} points @param {(def: string) => string|null} fileOf
 * @param {{ radius?: number, lead?: string[], after?: string[], seen?: ((o: object) => boolean) | null }} [o]
 * @returns {string[]}
 */
/** A model file's path as the packs index it ('buildings/farmhouse.glb' -> '/assets/models/buildings/farmhouse.glb'):
 *  an identifier (net/packs.js strips the asset base before it compares), never a URL to fetch. */
export const modelPath = (file) => `/assets/models/${file}`;

export function firstViewFiles(state, points, fileOf, { radius = 14, lead = [], after = [], seen = null } = {}) {
  const at = (Array.isArray(points) ? points : [points]).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.z));
  const best = new Map();                                       // path -> [group, distance]
  for (const [i, f] of (Array.isArray(after) ? after : []).entries()) if (typeof f === 'string') best.set(f, [1, i]);
  for (const o of Object.values(state?.farm?.objects || {})) {
    if (!o || !Number.isFinite(o.x ?? 0) || !Number.isFinite(o.z ?? 0)) continue;
    const d = at.length ? Math.min(...at.map((p) => Math.hypot((o.x ?? 0) - p.x, (o.z ?? 0) - p.z))) : Infinity;
    let inView = false;
    try { inView = typeof seen === 'function' ? Boolean(seen(o)) : d <= radius; } catch { inView = false; }
    if (!inView) continue;
    for (const def of [o.def, o.crop?.def]) {
      if (typeof def !== 'string') continue;
      let f = null;
      try { f = fileOf(def); } catch { f = null; }
      if (typeof f !== 'string' || !f.includes('/')) continue;
      const path = modelPath(f);
      const k = lead.includes(def) ? [0, d] : [2, d];
      const had = best.get(path);
      if (!had || k[0] < had[0] || (k[0] === had[0] && k[1] < had[1])) best.set(path, k);
    }
  }
  return [...best].sort(([pa, a], [pb, b]) => a[0] - b[0] || a[1] - b[1] || (pa < pb ? -1 : pa > pb ? 1 : 0)).map(([path]) => path);
}

export function modelFileOf(manifest) {
  const m = manifest || {};
  return (def) => {
    const alias = m.aliases?.[def];
    const d = m.defs?.[def];
    const base = d ? `${d.family}:${def}` : null;
    const key = alias ?? (base && m.keys?.[base] ? base : d?.keys?.[0] ?? null);
    return key ? m.keys?.[key]?.file ?? null : null;
  };
}

export function packShares(state, fileOf, index) {
  const used = new Set();
  for (const o of Object.values(state?.farm?.objects || {})) {
    for (const def of [o?.def, o?.crop?.def]) {
      if (typeof def !== 'string') continue;
      let f = null;
      try { f = fileOf(def); } catch { f = null; }
      if (typeof f === 'string') used.add(`/assets/models/${f}`);
    }
  }
  const out = {};
  for (const [id, p] of Object.entries(index || {})) {
    let all = 0;
    let want = 0;
    for (const [name, at] of Object.entries(p?.files || {})) {
      const len = Array.isArray(at) ? at[1] : 0;
      all += len;
      if (used.has(`${p.dir}${name}`)) want += len;
    }
    out[id] = all > 0 ? want / all : 0;
  }
  return out;
}
