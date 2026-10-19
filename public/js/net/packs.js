// Asset packs (qa2 SV-03, server/static.js): a model family or the Ogg sounds in ONE response instead of one request
// per file (a cold load asked for ~90 GLB and 87 OGG files, six at a time over HTTP/1.1). The server inlines the index
// into index.html (<script type="application/json" id="hh-packs">). fromPack(path) answers a member's bytes from its
// pack (one shared fetch per pack, cached for a year: the URL carries the pack's content version), or null when the
// path is in no pack, the page has no index (tests, tools), the family loads per member (below) or the pack did not
// load (a pack URL of an older version answers 404): the caller then fetches the single file exactly as before.
// Owned by the infra lane (release 1.0).
//
// Scheduling (release 1.0 O4; perf-a11y#3, #4, astra#1, option2#13). On a slow link every pack shares one pipe, so
// fetching them all at once made the first view (crops, homes, the buildings in view) arrive last:
//   - at most MAX_PACKS packs in flight; the families of the first view (setFirstView, from the welcome state) first,
//     then PRIO's order, decor and town last; the sounds only when no model pack is in flight or waiting
//   - per-member loading: a family's requests are collected for COLLECT_MS; when they are less than SINGLE_SHARE of
//     the family's bytes (sizes from the inlined index), the family loads file by file for this page (a new farm
//     reads 4 of 113 decor models), otherwise as its pack. The browser keeps that decision per family and pack version
//     (localStorage 'hh.packModes', '.host' on a host page): the next boot decides the same way at once and finds those
//     bytes in its cache (a warm reload that decided otherwise took a 1.8 MB pack from the host while the files sat
//     cached)
//   - option 2: packs come from the public host's ROOT at their own content version (an unchanged family stays cached
//     across deploys); a host pack that fails is fetched again from this server (net/asset-base.js data fallback)
//   - the first view's own files (QA r2 I2-C1, self path): on the owners' cold boot over the Funnel the in-view
//     buildings and trees waited for two 1.3 MB packs that shared the link with ~35 other files, so the farmhouse and
//     the barn were tan boxes 50 s after the welcome and the curtain lifted onto them. Now, on a boot that has not
//     decided a family yet, the first view's members of it (setFirstView's `files`, what the view shows after its first
//     setState) are fetched as files of their own, FV_MAX at a time: the `lead` files first (the farmhouse and the barn,
//     which the curtain waits for), the rest smallest first (a field of crops is three small files: most boxes go
//     first, the big trees last); nothing else of the models (another family's pack, a member out of view) starts
//     until they are in (at most FV_MAX_WAIT_MS). Such a family then loads the rest of what the farm uses file by file:
//     its pack would bring the first view's members a second time and every unused member with them. Variants (in no
//     pack) load as before.
//
//   packOf(path) -> { id, p, at } | null      fromPack(path, fetcher?, single?) -> Promise<ArrayBuffer | null>
//                       `single`: the file's own (versioned) URL, for the first view's members fetched alone
//   setFirstView(ids, files?, lead?)  pack ids to start first, in order (null: keep them); the first view's files
//                       (firstViewFiles), the first `lead` of them before the rest
//   firstViewPacks(state, at, fileOf, radius?) -> ids   firstViewFiles(state, at, fileOf, { radius, lead, after, seen }) -> paths
//   rememberFirstView(ids) / prefetchRemembered(fetcher?, hint?)   the first-view packs start as soon as main.js runs,
//                       before the welcome (high-use families only, never decor or town): the page's hint (option 2's host
//                       page names them: <meta name="hh-first-packs">) or this browser's memory of the last welcome; the
//                       curtain waits for those models, and on the host path that link is idle until the welcome otherwise
//   packStats() -> { active, queued, started: [id], modes: { id: 'pack'|'single' }, split: [id],
//                    own: { done, active, queued } }   (tests, tools/boot-perf)
//   resetPacks(ix)      tests: use index `ix` (undefined: read the page again), forget everything
import { ASSET_BASE, assetPath, fetchAsset } from './asset-base.js';
import { PRIO, PREFETCHABLE, SINGLE_SHARE, firstViewPacks, firstViewFiles, modelPath } from '../../../shared/net/packs-plan.js';

export { PRIO, PREFETCHABLE, SINGLE_SHARE, firstViewPacks, firstViewFiles, modelPath };

/** Packs are versioned by their own content: on a host page they come from the host's root (see the header). */
const PACK_ORIGIN = (() => { try { return ASSET_BASE ? new URL(ASSET_BASE).origin : ''; } catch { return ''; } })();
export const MAX_PACKS = 2;
export const COLLECT_MS = 150;

let index;
let indexLoad = null;           // the index as a file (a host page names it: <meta name="hh-packs">), loaded once
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

/**
 * The index, from the page or (option 2's host page carries a <meta name="hh-packs"> instead, the page budget) from that
 * file once; null without either (tests, tools) or when the file does not come (every model then loads alone).
 */
function loadIndex(fetcher) {
  const ix = readIndex();
  if (ix) return ix;
  if (!indexLoad) {
    const src = typeof document !== 'undefined' ? document.querySelector?.('meta[name="hh-packs"]')?.getAttribute('content') : null;
    if (!src) return null;
    indexLoad = Promise.resolve().then(() => fetchAsset(src, undefined, fetcher)).then((r) => (r && r.ok ? r.json() : null))
      .catch(() => null).then((j) => { if (j && typeof j === 'object') index = j; return index || null; });
  }
  return indexLoad;
}

/** { id, p, at: [offset, length] } of the pack that holds URL path `path` ('/assets/models/crops/wheat.glb'), or null. */
export function packOf(path) {
  const ix = readIndex();
  if (!ix || typeof path !== 'string') return null;
  const clean = assetPath(path).split('?')[0];
  for (const id of Object.keys(ix)) {
    const p = ix[id];
    if (!clean.startsWith(p.dir)) continue;
    const at = Object.hasOwn(p.files, clean.slice(p.dir.length)) ? p.files[clean.slice(p.dir.length)] : null;
    return at ? { id, p, at } : null;
  }
  return null;
}

// ---- the scheduler -----------------------------------------------------------------------------------------------
let firstView = [];
const queue = [];               // [{ id, run, resolve }]
let active = 0;
const started = [];             // pack ids in the order they started (tests, tools)
const modes = new Map();        // id -> Promise<'pack'|'single'> (decided once per page)
let collecting = 0;             // families still in their COLLECT_MS window: nothing starts before they are ranked too
let modelsBusy = () => false;   // main.js: render/assets.js has files loading (single-file models too, not only packs)
let audioRetry = null;
let audioHeldAt = null;
/** The longest the sound pack waits for the models: a model that never finishes must not leave the game silent. */
export const AUDIO_MAX_WAIT_MS = 60_000;

// ---- the first view's own files (QA r2 I2-C1; see the header) ------------------------------------------------------
/** The first view's files in flight at once (each shares the link with the others: the nearest ones finish first). */
export const FV_MAX = 3;
/** The longest anything else waits for the first view's files: a file that never finishes must not stall the farm. */
export const FV_MAX_WAIT_MS = 60_000;
/** Only on the self path: option 2's host is fast, and its first-view packs start before the welcome (the page hint). */
const OWN_FILES = !PACK_ORIGIN;
let firstFiles = new Map();     // URL path -> its place in the first view (0 = first)
let firstLead = 0;              // the first `firstLead` of them start before the rest (the farmhouse and the barn)
// `expect`: first-view paths a family decided to fetch alone whose request has not reached ownFile yet (its fromPack
// continues a microtask later: an out-of-view member resumed first must not read "nothing coming"); `over`: the wait
// for the first view ended (FV_MAX_WAIT_MS after it began: a file that never answers does not stall the farm)
const own = { active: 0, queue: [], done: 0, expect: new Set(), over: false, timer: null };
let ownWaiters = [];

/** True while the first view's own files are coming (or families are still deciding which those are). */
function ownBusy() {
  return !own.over && Boolean(own.active || own.queue.length || own.expect.size || collecting);
}
/** The first view's wait has a limit, counted from its first file. */
function armOwn() {
  if (own.timer || own.over) return;
  own.timer = setTimeout(() => { own.over = true; wakeOwn(); }, FV_MAX_WAIT_MS);
  own.timer?.unref?.();
}
/** Resolves once the first view's own files are in (at once when there are none, at the latest FV_MAX_WAIT_MS on). */
function firstViewIn() {
  return ownBusy() ? new Promise((resolve) => ownWaiters.push(resolve)) : Promise.resolve();
}
function wakeOwn() {
  if (ownBusy()) return;
  const list = ownWaiters;
  ownWaiters = [];
  for (const fn of list) fn();
  queueMicrotask(pump);
}
/** Fetch a first-view member (`bytes` long) as its own file (`url`, versioned), in the first view's order (ownOrder);
 *  null when it fails. */
function ownFile(path, url, fetcher, bytes = 0) {
  own.expect.delete(path);
  armOwn();
  return new Promise((resolve) => {
    own.queue.push({ at: firstFiles.has(path) ? firstFiles.get(path) : Infinity, bytes, url, fetcher, resolve });
    queueMicrotask(pumpOwn);
  });
}
/** The lead files in their order, then the smallest first (ties: the first view's order). */
const ownOrder = (a, b) => (a.at < firstLead || b.at < firstLead ? a.at - b.at : a.bytes - b.bytes || a.at - b.at);
function pumpOwn() {
  own.queue.sort(ownOrder);
  while (own.active < FV_MAX && own.queue.length) {
    const q = own.queue.shift();
    own.active++;
    Promise.resolve().then(() => fetchAsset(q.url, undefined, q.fetcher))
      .then((r) => (r && r.ok ? r.arrayBuffer() : null)).catch(() => null)
      .then((buf) => {
        own.active--;
        own.done++;
        q.resolve(buf);
        pumpOwn();
        wakeOwn();
      });
  }
}

const rank = (id) => {
  if (id === 'audio') return 10_000;
  const v = firstView.indexOf(id);
  if (v >= 0) return v;
  const i = PRIO.indexOf(id);
  return i >= 0 ? 100 + i : 500;
};

function pump() {
  if (collecting > 0) return;                                   // a family still being collected may outrank the queue
  queue.sort((a, b) => rank(a.id) - rank(b.id));
  while (active < MAX_PACKS && queue.length) {
    const now = globalThis.performance?.now?.() ?? 0;
    // nothing out of the first view takes the link while the first view's own files come (I2-C1; wakeOwn pumps again)
    if (rank(queue[0].id) >= 100 && ownBusy()) break;
    if (queue[0].id === 'audio' && queue.length === 1 && active === 0 && audioHeldAt !== null && now - audioHeldAt > AUDIO_MAX_WAIT_MS) {
      audioHeldAt = null;                                           // waited long enough: the sounds go now
    } else if (queue[0].id === 'audio' && (active > 0 || safeBusy())) {
      audioHeldAt ??= now;
      // the sounds wait for every model pack AND every model file loading on its own (a low-use family, a variant):
      // on one slow link they would share it with the last models; asked again shortly
      if (!audioRetry && active === 0) audioRetry = setTimeout(() => { audioRetry = null; pump(); }, AUDIO_RETRY_MS);
      break;
    }
    const q = queue.shift();
    active++;
    started.push(q.id);
    Promise.resolve().then(q.run).then(q.resolve, () => q.resolve(null)).finally(() => { active--; pump(); });
  }
}

const AUDIO_RETRY_MS = 400;
function safeBusy() { try { return Boolean(modelsBusy()); } catch { return false; } }

/** main.js: is any model file still loading? (render/assets.js pending() > 0) The sound pack waits for it. */
export function setModelsBusy(fn) { modelsBusy = typeof fn === 'function' ? fn : () => false; }

function schedule(id, run) {
  return new Promise((resolve) => { queue.push({ id, run, resolve }); queueMicrotask(pump); });
}

const REMEMBER_KEY = 'hh.firstViewPacks';

/** Remember this welcome's first-view packs for the next boot of this browser (main.js; storage failures are fine). */
export function rememberFirstView(ids) {
  try { globalThis.localStorage?.setItem(REMEMBER_KEY, JSON.stringify((ids || []).filter((id) => PREFETCHABLE.includes(id)).slice(0, 8))); }
  catch { /* private mode: no head start next time */ }
}

// one memory per pack origin, as the HTTP cache keys them: the host's packs (option 2) and this server's are not the same
// URLs, so what one path has cached says nothing about the other
const MODES_KEY = PACK_ORIGIN ? 'hh.packModes.host' : 'hh.packModes';
/** This browser's decisions: { id: ['pack'|'single', packVersion] } ({} without storage or with a broken entry). */
function rememberedModes() {
  try {
    const m = JSON.parse(globalThis.localStorage?.getItem(MODES_KEY) || '{}');
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch {
    return {};
  }
}
/** The remembered mode of pack `id` at version `v`, or null (none, another version: its files changed). */
function rememberedMode(id, v) {
  const r = rememberedModes()[id];
  return Array.isArray(r) && r[1] === v && (r[0] === 'pack' || r[0] === 'single') ? r[0] : null;
}
function rememberMode(id, mode, v) {
  try { globalThis.localStorage?.setItem(MODES_KEY, JSON.stringify({ ...rememberedModes(), [id]: [mode, v] })); }
  catch { /* private mode: decided afresh next time */ }
}

/**
 * Start last time's first-view packs now (before the welcome), through the same scheduler; they count as decided
 * ('pack'). Returns the ids started. A pack whose id the index does not know is skipped.
 */
export async function prefetchRemembered(fetcher = (u) => fetch(u), hint = null) {
  let ids = [];
  try { ids = JSON.parse(globalThis.localStorage?.getItem(REMEMBER_KEY) || '[]'); } catch { ids = []; }
  // the page's own hint (option 2's host page: the farm server knows its farm) wins over this browser's memory
  if (Array.isArray(hint) && hint.length) ids = hint;
  if (!Array.isArray(ids) || !ids.length) return [];
  const ix = readIndex() || await loadIndex(fetcher);
  if (!ix) return [];
  // a family this browser loads file by file (at this version) is not started as a pack: its files are in the cache
  const go = ids.filter((id) => typeof id === 'string' && PREFETCHABLE.includes(id) && Object.hasOwn(ix, id) && !bodies.has(id)
    && rememberedMode(id, ix[id].v) !== 'single');
  if (!firstView.length) firstView = go.slice();
  for (const id of go) {
    if (!modes.has(id)) { modes.set(id, { promise: Promise.resolve('pack'), mode: 'pack' }); rememberMode(id, 'pack', ix[id].v); }
    const hit = { id, p: ix[id] };
    bodies.set(id, schedule(id, () => fetchPack(hit, fetcher)));
  }
  return go;
}

/**
 * Pack ids to start before every other one, in this order (main.js, from the welcome state: firstViewPacks), and the
 * first view's model files (firstViewFiles, after the view's first setState), whose first `lead` start before the rest.
 * With `ids` null the pack ids stay as they were.
 */
export function setFirstView(ids, files = [], lead = 0) {
  if (ids !== null) firstView = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
  firstFiles = new Map((Array.isArray(files) ? files : []).filter((x) => typeof x === 'string').map((f, i) => [f, i]));
  firstLead = Number.isSafeInteger(lead) && lead > 0 ? lead : 0;
  pump();
}

/** 'pack' or 'single' for a family, decided once from the requests of its first COLLECT_MS (see the header). */
function modeOf(hit) {
  let m = modes.get(hit.id);
  if (m) {
    m.paths?.add(hit.key);
    return m.promise;
  }
  if (hit.id === 'audio') {
    m = { promise: Promise.resolve('pack') };
    modes.set(hit.id, m);
    return m.promise;
  }
  const known = rememberedMode(hit.id, hit.p.v);
  if (known) {
    m = { promise: Promise.resolve(known), mode: known };
    modes.set(hit.id, m);
    return m.promise;
  }
  const paths = new Set([hit.key]);
  m = { paths, promise: null, mode: null, split: false };
  collecting++;
  m.promise = new Promise((resolve) => {
    const t = setTimeout(() => {
      collecting--;
      const files = hit.p.files;
      // the first view's members come as files of their own (I2-C1, self path), and then the rest file by file too
      const mine = (name) => OWN_FILES && firstFiles.has(hit.p.dir + name);
      let want = 0;
      let all = 0;
      for (const [name, [, len]] of Object.entries(files)) {
        all += len;
        if (!paths.has(name)) continue;
        if (mine(name)) {
          m.split = true;
          own.expect.add(hit.p.dir + name);
          armOwn();
        }
        want += len;
      }
      m.mode = m.split || (all > 0 && want / all < SINGLE_SHARE) ? 'single' : 'pack';
      m.paths = null;
      rememberMode(hit.id, m.mode, hit.p.v);
      resolve(m.mode);
      queueMicrotask(pump);                                     // the families decided in this window, ranked together
      queueMicrotask(wakeOwn);                                  // the last family decided: a wait may be over
    }, COLLECT_MS);
    t?.unref?.();
  });
  modes.set(hit.id, m);
  return m.promise;
}

/** The pack's bytes: from the host's root on a host page, from this server when that fails. */
async function fetchPack(hit, fetcher) {
  const url = `${PACK_ORIGIN}/assets/packs/${hit.id}.bin?v=${hit.p.v}`;
  try {
    const r = await fetchAsset(url, undefined, fetcher);
    return r && r.ok ? await r.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/**
 * The bytes of `path` (an ArrayBuffer of its own) from its pack or, for a member of the first view, as its own file
 * `single` (its versioned URL; the path itself without one); null: fetch the single file instead.
 * @param {string} path @param {(url: string) => Promise<Response>} [fetcher] @param {string | null} [single]
 */
export async function fromPack(path, fetcher = (u) => fetch(u), single = null) {
  if (!readIndex()) await loadIndex(fetcher);
  const found = packOf(path);
  if (!found) return null;
  const clean = assetPath(path).split('?')[0];
  const hit = { ...found, key: clean.slice(found.p.dir.length) };
  let body = bodies.get(hit.id);
  if (!body) {
    // decided after the family's COLLECT_MS window, so a request made inside the view's first setState (main.js names
    // the first view's files right after it: setFirstView) is still sorted in
    const mode = await modeOf(hit);
    if (OWN_FILES && firstFiles.has(clean) && mode === 'single') {
      return ownFile(clean, single || path, fetcher, hit.at[1]);   // the first view: on its own, in its order
    }
    if (mode === 'single') {
      if (OWN_FILES) await firstViewIn();                      // out of view: after the first view's own files
      return null;
    }
    body = bodies.get(hit.id);
    if (!body) {
      body = schedule(hit.id, () => fetchPack(hit, fetcher));
      bodies.set(hit.id, body);
    }
  }
  const buf = await body;
  if (!buf || buf.byteLength < hit.at[0] + hit.at[1]) return null;
  releaseLater(hit.id);
  return buf.slice(hit.at[0], hit.at[0] + hit.at[1]);
}

export function packStats() {
  const m = {};
  const split = [];
  for (const [id, x] of modes) {
    if (x.mode || id === 'audio') m[id] = x.mode || 'pack';
    if (x.split) split.push(id);
  }
  return { active, queued: queue.length, started: [...started], modes: m, split,
    own: { done: own.done, active: own.active, queued: own.queue.length } };
}

/** Tests: use index `ix` (undefined: read the page again) and forget every fetched pack and decision. */
export function resetPacks(ix) {
  index = ix;
  indexLoad = null;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  bodies.clear();
  modes.clear();
  collecting = 0;
  clearTimeout(audioRetry);
  audioRetry = null;
  audioHeldAt = null;
  modelsBusy = () => false;
  queue.length = 0;
  started.length = 0;
  active = 0;
  firstView = [];
  firstFiles = new Map();
  firstLead = 0;
  clearTimeout(own.timer);
  Object.assign(own, { active: 0, queue: [], done: 0, expect: new Set(), over: false, timer: null });
  for (const fn of ownWaiters) fn();
  ownWaiters = [];
}
