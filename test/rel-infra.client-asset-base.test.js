// Option 2 on the client (option2#D11 test 4, release 1.0 O1/O4): a page with <meta name="hh-assets"> builds every
// static URL on the public host, finds pack members by their root path, fetches packs at the host's root, and falls
// back to this server's copy when the host fails (the data fallback), telling the page once. The pack scheduler: at
// most two packs in flight, the first view first, the sounds last, low-use families file by file.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'https://hh.example.app/b/0123456789abcdef/public';
const events = [];
globalThis.CustomEvent ??= class CustomEvent { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } };
globalThis.dispatchEvent = (e) => { events.push(e); return true; };
globalThis.location = { href: 'https://farm.example.net/?slot=p1', origin: 'https://farm.example.net' };
const SRI = { '/css/panels-w4.css': 'sha256-abc=' };
const PACKS_META = { getAttribute: () => `${BASE}/assets/packs/index.json` };
let packsMeta = null;
globalThis.document = {
  querySelector: (sel) => (sel === 'meta[name="hh-assets"]' ? { getAttribute: () => `${BASE}/` } : sel === 'meta[name="hh-packs"]' ? packsMeta : null),
  getElementById: (id) => (id === 'hh-sri' ? { textContent: JSON.stringify(SRI) } : null),
};
const ab = await import('../public/js/net/asset-base.js');
const packs = await import('../public/js/net/packs.js');
const res = (status, bytes = [1]) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => new Uint8Array(bytes).buffer,
  json: async () => ({ hash: 'h', keys: {}, defs: {} }) });
const quiet = () => { const w = console.warn; console.warn = () => {}; return () => { console.warn = w; }; };

test('asset base: root paths move to the host, the inverse strips it, the integrity of a lazy stylesheet', () => {
  assert.equal(ab.ASSET_BASE, BASE, 'trailing slash dropped');
  assert.equal(ab.assetUrl('/assets/icons/coins.png'), `${BASE}/assets/icons/coins.png`);
  assert.equal(ab.assetUrl('/css/x.css?v=1'), `${BASE}/css/x.css?v=1`);
  for (const u of ['//cdn/x', 'https://a/b', 'data:x', 'rel/x.png', 7]) assert.equal(ab.assetUrl(u), u);
  assert.equal(ab.assetPath(`${BASE}/assets/x.png`), '/assets/x.png');
  assert.equal(ab.assetPath('/assets/x.png'), '/assets/x.png');
  assert.equal(ab.assetIntegrity('/css/panels-w4.css'), 'sha256-abc=');
  assert.equal(ab.assetIntegrity(`${BASE}/css/panels-w4.css?v=9`), 'sha256-abc=');
  assert.equal(ab.assetIntegrity('/css/other.css'), '');
  assert.equal(ab.onHost('https://hh.example.app/assets/packs/models-crops.bin?v=1'), true, 'the host root counts (packs)');
  assert.equal(ab.onHost('/api/status'), false, 'the farm itself never');
  assert.equal(ab.selfUrl(`${BASE}/assets/x.png?v=2`), '/assets/x.png?v=2');
  assert.equal(ab.selfUrl('https://hh.example.app/assets/packs/models-crops.bin?v=1'), '/assets/packs/models-crops.bin?v=1');
});

test('fetchAsset: the host first; a 404, a 5xx or a network error fetches the same file from this server, once noted', async () => {
  const restore = quiet();
  try {
    const seen = [];
    const fetcher = async (u) => { seen.push(u); if (u.startsWith('https://hh.example.app')) { if (u.includes('boom')) throw new TypeError('Failed to fetch'); return res(u.includes('gone') ? 404 : 200); } return res(200, [9]); };
    assert.equal((await ab.fetchAsset(`${BASE}/assets/a.json`, undefined, fetcher)).status, 200);
    assert.deepEqual(seen, [`${BASE}/assets/a.json`], 'a host that answers: nothing else');
    seen.length = 0;
    const r = await ab.fetchAsset(`${BASE}/assets/gone.json?v=1`, undefined, fetcher);
    assert.deepEqual(seen, [`${BASE}/assets/gone.json?v=1`, '/assets/gone.json?v=1']);
    assert.equal(r.status, 200);
    seen.length = 0;
    await ab.fetchAsset(`${BASE}/assets/boom.glb`, undefined, fetcher);
    assert.deepEqual(seen, [`${BASE}/assets/boom.glb`, '/assets/boom.glb']);
    seen.length = 0;
    await ab.fetchAsset('/api/status', undefined, fetcher);
    assert.deepEqual(seen, ['/api/status'], 'never the API');
    assert.equal(events.filter((e) => e.type === 'hh:assets-failed').length, 1, 'the page hears it once');
  } finally {
    restore();
  }
});

const IX = {
  'models-crops': { dir: '/assets/models/crops/', v: 'c1', files: { 'corn.glb': [0, 3], 'wheat.glb': [3, 2] } },
  'models-homes': { dir: '/assets/models/homes/', v: 'h1', files: { 'farmhouse.glb': [0, 4] } },
  'models-trees': { dir: '/assets/models/trees/', v: 't1', files: { 'apple.glb': [0, 2] } },
  'models-decor': { dir: '/assets/models/decor/', v: 'd1', files: { 'a.glb': [0, 10], 'b.glb': [10, 10], 'c.glb': [20, 80] } },
  audio: { dir: '/assets/audio/', v: 'a1', files: { 'pop.ogg': [0, 4] } },
};

test('packs: a host-prefixed member is found; the pack comes from the host ROOT; a failed host pack comes from here', async () => {
  const restore = quiet();
  try {
    packs.resetPacks(IX);
    assert.deepEqual(packs.packOf(`${BASE}/assets/models/crops/wheat.glb?v=x`).at, [3, 2]);
    const urls = [];
    const fetcher = async (u) => { urls.push(u); return u.startsWith('https://') ? res(404) : res(200, [1, 1, 1, 2, 2]); };
    const [corn, wheat] = await Promise.all([packs.fromPack(`${BASE}/assets/models/crops/corn.glb`, fetcher),
      packs.fromPack(`${BASE}/assets/models/crops/wheat.glb`, fetcher)]);
    assert.deepEqual([...new Uint8Array(corn)], [1, 1, 1]);
    assert.deepEqual([...new Uint8Array(wheat)], [2, 2]);
    assert.deepEqual(urls, ['https://hh.example.app/assets/packs/models-crops.bin?v=c1', '/assets/packs/models-crops.bin?v=c1'],
      'the host root at its content version, then the same pack from this server');
  } finally {
    restore();
    packs.resetPacks(null);
  }
});

test('O4: at most two packs at once, the first view first, decor after the rest, the sounds after every model pack', async () => {
  packs.resetPacks(IX);
  const open = new Map();
  let most = 0;
  const order = [];
  const fetcher = (u) => {
    const id = /packs\/([\w-]+)\.bin/.exec(u)[1];
    order.push(id);
    most = Math.max(most, open.size + 1);
    return new Promise((resolve) => { open.set(id, () => { open.delete(id); resolve(res(200, new Array(100).fill(1))); }); });
  };
  packs.setFirstView(['models-trees']);
  const want = [['decor', 'c.glb'], ['crops', 'corn.glb'], ['crops', 'wheat.glb'], ['homes', 'farmhouse.glb'], ['trees', 'apple.glb']]
    .map(([f, n]) => packs.fromPack(`/assets/models/${f}/${n}`, fetcher));
  const sound = packs.fromPack('/assets/audio/pop.ogg', fetcher);
  await new Promise((r) => setTimeout(r, packs.COLLECT_MS + 50));
  const drain = async () => { for (let i = 0; i < 20 && (open.size || packs.packStats().queued); i++) { for (const f of [...open.values()]) f(); await new Promise((r) => setTimeout(r, 5)); } };
  await drain();
  await Promise.all([...want, sound]);
  assert.equal(most, 2, 'never more than two packs in flight');
  assert.deepEqual(order, ['models-trees', 'models-crops', 'models-homes', 'models-decor', 'audio'], `order ${order}`);
  packs.resetPacks(null);
});

test('O4: a family read for less than 35 % of its bytes loads file by file (no pack); more than that, its pack', async () => {
  packs.resetPacks(IX);
  const urls = [];
  const fetcher = async (u) => { urls.push(u); return res(200, new Array(100).fill(1)); };
  const a = await Promise.all([packs.fromPack('/assets/models/decor/a.glb', fetcher), packs.fromPack('/assets/models/decor/b.glb', fetcher)]);
  assert.deepEqual(a, [null, null], '20 of 100 bytes: the caller fetches the two files');
  assert.equal(urls.length, 0, 'no pack request');
  assert.equal(packs.packStats().modes['models-decor'], 'single');
  assert.equal(await packs.fromPack('/assets/models/decor/c.glb', fetcher), null, 'decided once for the page');
  const corn = await packs.fromPack('/assets/models/crops/corn.glb', fetcher);
  assert.ok(corn, '3 of 5 bytes of crops: the pack');
  assert.deepEqual(urls, ['https://hh.example.app/assets/packs/models-crops.bin?v=c1'], 'from the host root on a host page');
  packs.resetPacks(null);
});

test('O4: a browser loads a family the way it did last time (same pack version), so a warm reload finds it cached', async () => {
  // e2e-assets v3/v4 (throttled, iPhone 13): the cold boot loaded the animals file by file, the warm reload decided
  // "pack" (its first 150 ms saw other requests) and took 1.8 MB from the host instead of the cached files
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  try {
    const urls = [];
    const fetcher = async (u) => { urls.push(u); return res(200, new Array(100).fill(1)); };
    packs.resetPacks(IX);
    assert.equal(await packs.fromPack('/assets/models/decor/a.glb', fetcher), null, 'cold: 10 of 100 bytes, file by file');
    packs.resetPacks(IX);
    assert.equal(await packs.fromPack('/assets/models/decor/c.glb', fetcher), null,
      'warm: c.glb alone (80 of 100 bytes) would say "pack"; this browser has the files: file by file again');
    assert.equal(urls.length, 0, 'no pack request');
    assert.equal(packs.packStats().modes['models-decor'], 'single');
    // a new version of the pack (its files changed): decided afresh, and that decision is kept
    const IX2 = { ...IX, 'models-decor': { ...IX['models-decor'], v: 'd2' } };
    packs.resetPacks(IX2);
    assert.ok(await packs.fromPack('/assets/models/decor/c.glb', fetcher), 'd2: 80 of 100 bytes, its pack');
    assert.deepEqual(urls, ['https://hh.example.app/assets/packs/models-decor.bin?v=d2']);
    packs.resetPacks(IX2);
    assert.ok(await packs.fromPack('/assets/models/decor/a.glb', fetcher), 'then a.glb alone: the pack again (cached)');
    // the head start skips a family this browser loads file by file
    assert.ok(store.has('hh.packModes.host') && !store.has('hh.packModes'), 'a host page keeps its own memory (its own cache keys)');
    store.set('hh.packModes.host', JSON.stringify({ 'models-crops': ['single', 'c1'] }));
    packs.resetPacks(IX);
    assert.deepEqual(await packs.prefetchRemembered(fetcher, ['models-crops', 'models-trees']), ['models-trees']);
    store.set('hh.packModes.host', 'not json');
    packs.resetPacks(IX);
    assert.equal(await packs.fromPack('/assets/models/decor/a.glb', fetcher), null, 'a broken memory: decided as usual');
  } finally {
    delete globalThis.localStorage;
    packs.resetPacks(null);
  }
});

test('O4: the first view comes from the welcome state (the objects near the farmer, the crops on them, the farmers)', () => {
  const state = { farm: { objects: {
    a: { def: 'plot', x: 10, z: 10, crop: { def: 'wheat' } },
    b: { def: 'farmhouse', x: 12, z: 8 },
    c: { def: 'gazebo', x: 60, z: 60 },
  } } };
  const files = { plot: 'plots/plot.glb', wheat: 'crops/wheat.glb', farmhouse: 'homes/farmhouse.glb', gazebo: 'decor/gazebo.glb' };
  assert.deepEqual(packs.firstViewPacks(state, { x: 10, z: 10 }, (d) => files[d]), ['models-crops', 'models-homes', 'models-avatars', 'models-plots']);
});

test('render/assets: models and the manifest come from the host and fall back to this server', async () => {
  const restore = quiet();
  try {
    const assets = await import('../public/js/render/assets.js');
    assert.equal(assets.ASSET_ROOT, `${BASE}/assets/`);
    const urls = [];
    assets.setFetcher(async (u) => { urls.push(u); return u.startsWith('https://') ? res(503) : res(200); });
    const m = await assets.loadManifest();
    assert.ok(m);
    assert.deepEqual(urls, [`${BASE}/assets/models/manifest.json`, '/assets/models/manifest.json']);
  } finally {
    restore();
  }
});

test('a host page names the pack index on the host: loaded once, then the pack from the host root', async () => {
  packs.resetPacks(undefined);
  packsMeta = PACKS_META;
  const urls = [];
  const fetcher = async (u) => {
    urls.push(u);
    if (u.endsWith('/assets/packs/index.json')) return { ok: true, status: 200, json: async () => IX };
    return res(200, [1, 1, 1, 2, 2]);
  };
  try {
    const [corn, wheat] = await Promise.all([packs.fromPack(`${BASE}/assets/models/crops/corn.glb`, fetcher),
      packs.fromPack(`${BASE}/assets/models/crops/wheat.glb`, fetcher)]);
    assert.deepEqual([...new Uint8Array(corn)], [1, 1, 1]);
    assert.deepEqual([...new Uint8Array(wheat)], [2, 2]);
    assert.deepEqual(urls, [`${BASE}/assets/packs/index.json`, 'https://hh.example.app/assets/packs/models-crops.bin?v=c1'], 'the index once, then the pack');
  } finally {
    packsMeta = null;
    packs.resetPacks(null);
  }
});

test('O4: a returning host page starts last time\'s first-view packs before the welcome (high-use families only)', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  try {
    packs.resetPacks(IX);
    packs.rememberFirstView(['models-crops', 'models-decor', 'models-homes', 'models-nope']);
    assert.deepEqual(JSON.parse(store.get('hh.firstViewPacks')), ['models-crops', 'models-homes'], 'never decor or town');
    const urls = [];
    const fetcher = async (u) => { urls.push(u); return res(200, [1, 1, 1, 2, 2]); };
    assert.deepEqual(await packs.prefetchRemembered(fetcher), ['models-crops', 'models-homes']);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(urls.map((u) => /packs\/([\w-]+)/.exec(u)[1]), ['models-crops', 'models-homes'], 'started at once');
    const corn = await packs.fromPack('/assets/models/crops/corn.glb', fetcher);
    assert.deepEqual([...new Uint8Array(corn)], [1, 1, 1]);
    assert.equal(urls.length, 2, 'the welcome\'s requests reuse the prefetched packs');
    packs.resetPacks(IX);
    urls.length = 0;
    assert.deepEqual(await packs.prefetchRemembered(fetcher, ['models-trees', 'models-decor']), ['models-trees'], 'the page\'s hint wins');
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(urls.map((u) => /packs\/([\w-]+)/.exec(u)[1]), ['models-trees']);
    packs.resetPacks(IX);
    store.set('hh.firstViewPacks', 'not json');
    assert.deepEqual(await packs.prefetchRemembered(fetcher), [], 'a broken memory is no head start');
  } finally {
    delete globalThis.localStorage;
    packs.resetPacks(null);
  }
});

test('O4: the sound pack also waits for model files loading on their own (not only model packs)', async () => {
  packs.resetPacks(IX);
  let busy = true;
  packs.setModelsBusy(() => busy);
  const urls = [];
  const fetcher = async (u) => { urls.push(u); return res(200, [1, 2, 3, 4]); };
  const sound = packs.fromPack('/assets/audio/pop.ogg', fetcher);
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(urls, [], 'held while a model loads');
  busy = false;
  const buf = await sound;
  assert.deepEqual([...new Uint8Array(buf)], [1, 2, 3, 4]);
  assert.equal(urls.length, 1, 'then fetched');
  packs.resetPacks(null);
});

test('O4: a model that never finishes cannot keep the sounds away for more than AUDIO_MAX_WAIT_MS', async () => {
  packs.resetPacks(IX);
  packs.setModelsBusy(() => true);                    // stuck forever
  const realNow = performance.now.bind(performance);
  let shift = 0;
  const desc = Object.getOwnPropertyDescriptor(performance, 'now') ?? { value: performance.now, writable: true, configurable: true };
  Object.defineProperty(performance, 'now', { value: () => realNow() + shift, configurable: true, writable: true });
  try {
    const urls = [];
    const sound = packs.fromPack('/assets/audio/pop.ogg', async (u) => { urls.push(u); return res(200, [7, 7, 7, 7]); });
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(urls.length, 0, 'held');
    shift = packs.AUDIO_MAX_WAIT_MS + 1000;
    await new Promise((r) => setTimeout(r, 900));
    assert.equal(urls.length, 1, 'released after the cap');
    assert.ok(await sound);
  } finally {
    Object.defineProperty(performance, 'now', desc);
    packs.resetPacks(null);
  }
});
