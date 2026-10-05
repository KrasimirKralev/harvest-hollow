// Asset packs (qa2 SV-03, server/static.js): a model family or the Ogg sounds in ONE response instead of one request
// per file (a cold load asked for ~90 GLB and 87 OGG files, six at a time over HTTP/1.1). The server inlines the index
// into index.html (<script type="application/json" id="hh-packs">). fromPack(path) answers a member's bytes from its
// pack (one shared fetch per pack, cached for a year: the URL carries the pack's content version), or null when the
// path is in no pack, the page has no index (tests, tools) or the pack did not load (a pack URL of an older version
// answers 404): the caller then fetches the single file exactly as before. Owned by the client-core lane.
let index;
const bodies = new Map();
// A loaded pack is let go RELEASE_MS after its last member was read (integration wave 4): every member is sliced into
// a buffer of its own, so holding the whole pack for the session doubled the models' memory (~26 MB of packs on a
// busy farm). A model wanted later (a new building, a tier) fetches the pack again from the browser's HTTP cache
// (the URL is versioned and immutable). A pack that failed stays remembered (null): no retry storm.
export const RELEASE_MS = 30_000;
const timers = new Map();
function releaseLater(id) {
  clearTimeout(timers.get(id));
  const t = setTimeout(() => { timers.delete(id); bodies.delete(id); }, RELEASE_MS);
  t?.unref?.();
  timers.set(id, t);
}

function readIndex() {
  if (index !== undefined) return index;
  try {
    const el = typeof document !== 'undefined' ? document.getElementById('hh-packs') : null;
    index = el ? JSON.parse(el.textContent) : null;
  } catch {
    index = null;
  }
  return index;
}

/** { id, p, at: [offset, length] } of the pack that holds URL path `path` ('/assets/models/crops/wheat.glb'), or null. */
export function packOf(path) {
  const ix = readIndex();
  if (!ix) return null;
  const clean = path.split('?')[0];
  for (const id of Object.keys(ix)) {
    const p = ix[id];
    if (!clean.startsWith(p.dir)) continue;
    const at = Object.hasOwn(p.files, clean.slice(p.dir.length)) ? p.files[clean.slice(p.dir.length)] : null;
    return at ? { id, p, at } : null;
  }
  return null;
}

/**
 * The bytes of `path` (an ArrayBuffer of its own) from its pack, or null: fetch the single file instead.
 * @param {string} path @param {(url: string) => Promise<Response>} [fetcher]
 */
export async function fromPack(path, fetcher = (u) => fetch(u)) {
  const hit = packOf(path);
  if (!hit) return null;
  let body = bodies.get(hit.id);
  if (!body) {
    body = Promise.resolve().then(() => fetcher(`/assets/packs/${hit.id}.bin?v=${hit.p.v}`))
      .then((r) => (r && r.ok ? r.arrayBuffer() : null)).catch(() => null);
    bodies.set(hit.id, body);
  }
  const buf = await body;
  if (!buf || buf.byteLength < hit.at[0] + hit.at[1]) return null;
  releaseLater(hit.id);
  return buf.slice(hit.at[0], hit.at[0] + hit.at[1]);
}

/** Tests: use index `ix` (undefined: read the page again) and forget every fetched pack. */
export function resetPacks(ix) {
  index = ix;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  bodies.clear();
}
