// The Memory Book's pictures (GDD §5.9, rules-goals actions/memory.js): a page is a record in the replicated state;
// its PICTURE is a snapshot of the farm this browser takes when the page is made and keeps locally (IndexedDB
// 'hh-memory', keyed by the farm seed and the page number), never sent anywhere. Each partner keeps the farm as their
// own screen showed it at that moment. Owned by the client lane.
//
//   const mem = createMemory({ store, view, idb? })
//   mem.picture(n) -> Promise<string | null>   an object URL of page n's picture (cached), or null when this browser
//                                              has none (another device, cleared storage, a page from before)
//   mem.photo(blob)                             the photo just taken with P: a 'photo' page asked for within two
//                                               minutes keeps THIS picture instead of a new snapshot
//   mem.count() -> number                       pictures kept this session (tests)
//
// When: the CONFIRMED `memoryPage` event (a delta, never the prediction: a refused page must leave no picture), at
// most once per page number. Size: the capture is scaled to MAX_W pixels wide as a JPEG (a page is ~60-120 KB, the
// ring of 200 pages stays far under any quota).
const DB = 'hh-memory';
const STORE = 'pics';
const MAX_W = 640;
const PHOTO_MS = 120_000;

/** A small promise wrapper around one IndexedDB object store; a Map when IndexedDB is missing or blocked. */
export function openPictures(idb = typeof indexedDB !== 'undefined' ? indexedDB : null) {
  const mem = new Map();
  let dbp = null;
  if (idb) {
    dbp = new Promise((resolve) => {
      try {
        const req = idb.open(DB, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  const tx = async (mode, fn) => {
    const db = dbp ? await dbp : null;
    if (!db) return fn(null);
    return new Promise((resolve) => {
      try {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
        t.onerror = () => resolve(undefined);
        t.onabort = () => resolve(undefined);
      } catch { resolve(undefined); }
    });
  };
  return {
    async put(key, blob) {
      mem.set(key, blob);
      await tx('readwrite', (s) => (s ? s.put(blob, key) : null));
    },
    async get(key) {
      if (mem.has(key)) return mem.get(key);
      const v = await tx('readonly', (s) => (s ? s.get(key) : null));
      if (v) mem.set(key, v);
      return v ?? null;
    },
  };
}

/** Scale a picture down to MAX_W wide as a JPEG (in a browser); the blob as it is elsewhere. */
async function shrink(blob) {
  if (!blob || typeof document === 'undefined' || typeof createImageBitmap !== 'function') return blob;
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, MAX_W / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return await new Promise((resolve) => c.toBlob((b) => resolve(b ?? blob), 'image/jpeg', 0.82));
  } catch {
    return blob;
  }
}

export function createMemory({ store, view, idb } = {}) {
  const pics = openPictures(idb);
  const done = new Set();
  const urls = new Map();
  let lastPhoto = null;                       // { blob, at }
  let kept = 0;
  const keyOf = (n) => `${store.state?.meta?.farmSeed ?? 0}:${n}`;

  async function keep(n, ev) {
    let blob = null;
    // a photo page by me keeps the photo I just took (P), not a new snapshot of whatever is on screen now
    if (ev.k === 'photo' && ev.by === store.pid && lastPhoto && Date.now() - lastPhoto.at < PHOTO_MS) {
      blob = lastPhoto.blob;
      lastPhoto = null;
    } else if (typeof view.capture === 'function') {
      blob = await view.capture();
    }
    if (!blob) return;
    await pics.put(keyOf(n), await shrink(blob));
    kept++;
  }

  store.on('fx', ({ ev, local }) => {
    if (local || !ev || ev.e !== 'memoryPage' || !Number.isSafeInteger(ev.n) || done.has(ev.n)) return;
    done.add(ev.n);
    keep(ev.n, ev).catch((err) => console.warn('memory book: the picture was not kept', err));
  });

  return {
    async picture(n) {
      if (urls.has(n)) return urls.get(n);
      const blob = await pics.get(keyOf(n));
      if (!blob) return null;
      const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : null;
      if (url) urls.set(n, url);
      return url;
    },
    photo(blob) { if (blob) lastPhoto = { blob, at: Date.now() }; },
    count: () => kept,
  };
}
