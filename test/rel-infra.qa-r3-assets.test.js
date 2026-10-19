// QA round 3 R3-01, infra's half (render-look's must, docs/qa/release/qa-r3/fix-render-look.md: "one warning per failed
// file, not an error per batch"; perf-a11y#6). render/models.js now asks again for a manifest or a model the link lost,
// 1, 2, 4 ... 30 s apart. render/assets.js said `console.error` for every lost manifest try (render-look's blip run on
// the late save counted 4 errors for one 6 s blip, `.scratch/qr3-render-look/blip-desk-2.json`) and a warning for every
// lost model try. Now a failure the link explains is one warning per file while it keeps failing; a file that does not
// parse is still an error. Its own process: the module state of assets.js is per file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setFetcher, setLoader, loadManifest, loadGLB, resetAssetCache } from '../public/js/render/assets.js';
import { initIcons, setIconFetcher } from '../public/js/render/icons.js';

/** Run fn with console.error / console.warn captured. */
async function captured(fn) {
  const logs = { error: [], warn: [] };
  const { error, warn } = console;
  console.error = (...a) => logs.error.push(a.map((x) => String(x?.message ?? x)).join(' '));
  console.warn = (...a) => logs.warn.push(a.map((x) => String(x?.message ?? x)).join(' '));
  try { await fn(); } finally { console.error = error; console.warn = warn; }
  return logs;
}
const MANIFEST = { version: 1, hash: 'h1', units: 'm', files: {}, defs: {}, aliases: {}, keys: {} };

test('R3-01 (infra): a manifest the link keeps losing is one warning, never an error; one that does not parse is an error', async () => {
  resetAssetCache();
  let mode = 'drop';
  setFetcher(async () => {
    if (mode === 'drop') throw new TypeError('Failed to fetch');
    if (mode === '502') return { ok: false, status: 502 };
    if (mode === 'bad') return { ok: true, status: 200, json: async () => JSON.parse('{nope') };
    return { ok: true, status: 200, json: async () => structuredClone(MANIFEST) };
  });
  const lost = await captured(async () => {
    // what render/models.js's retry does, 1, 2, 4 ... s apart
    for (let i = 0; i < 4; i++) await assert.rejects(loadManifest());
    mode = '502';                                       // a deploy restarting the server
    await assert.rejects(loadManifest());
    mode = 'ok';
    assert.equal((await loadManifest()).hash, 'h1', 'it arrives');
  });
  assert.deepEqual(lost.error, [], 'a lost manifest is no program error (HEAD: one console.error per try)');
  assert.equal(lost.warn.length, 1, `one warning for the whole blip: ${JSON.stringify(lost.warn)}`);
  resetAssetCache();
  mode = 'bad';
  const broken = await captured(() => assert.rejects(loadManifest()));
  assert.equal(broken.error.length, 1, 'a manifest that does not parse is a program error');
  assert.equal(broken.warn.length, 0);
});

test('R3-01 (infra): a model the link keeps losing is one warning per file; a model that does not parse is an error', async () => {
  resetAssetCache();
  let fail = true;
  setFetcher(async () => {
    if (fail) throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
  });
  let parse = 'ok';
  setLoader({ parse: (buf, dir, ok, bad) => (parse === 'ok' ? ok({ scene: { name: 'stub' } }) : bad(new Error('THREE.GLTFLoader: Unsupported asset'))) });
  const lost = await captured(async () => {
    for (let i = 0; i < 3; i++) await assert.rejects(loadGLB('crops/wheat.glb'));
    for (let i = 0; i < 2; i++) await assert.rejects(loadGLB('crops/corn.glb'));
    fail = false;
    assert.equal((await loadGLB('crops/wheat.glb')).scene.name, 'stub', 'it arrives on a later try');
  });
  assert.deepEqual(lost.error, []);
  assert.equal(lost.warn.length, 2, `one warning per file, not per try: ${JSON.stringify(lost.warn)}`);
  assert.ok(/wheat/.test(lost.warn[0]) && /corn/.test(lost.warn[1]));
  parse = 'bad';
  const broken = await captured(() => assert.rejects(loadGLB('crops/pumpkin.glb')));
  assert.equal(broken.error.length, 1, 'a file that does not parse is a program error');
});

test('R3-01 (infra): a lost icon manifest is a warning, not an error (icons are then asked for by id)', async () => {
  let fail = true;
  setIconFetcher(async () => {
    if (fail) throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, json: async () => ({ ids: {} }) };
  });
  const lost = await captured(async () => {
    await assert.rejects(initIcons());
    await assert.rejects(initIcons());
    fail = false;
    await initIcons();
  });
  assert.deepEqual(lost.error, [], 'HEAD: console.error per try');
  assert.equal(lost.warn.length, 1);
});
