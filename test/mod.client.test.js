// The client side of a farm's mod (harness contract §2.6): the overlay installed from the welcome without a reload,
// the models / icons / names hooks, the look, the helper bus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneTables, CONTENT_HASH, cropOf } from '../shared/content/index.js';
import { RULES_VERSION } from '../shared/rules/version.js';
import { compileMod } from '../shared/mod/compile.js';
import { installedOverlay } from '../shared/mod/install.js';
import { recolorColors } from '../public/js/mod/recolor.js';
import { skyFilter, applyLook, SKY_PRESETS, currentLook, setLookAudio } from '../public/js/mod/look.js';
import { syncOverlay, iconUrls, assetBaseOf, installedMod } from '../public/js/mod/overlay.js';
import { emitHarness, onHarness, setHarnessAuth, harnessAuth, lastHarness } from '../public/js/harness/bus.js';
import { iconUrl, hasIcon } from '../public/js/render/icons.js';
import { models } from '../public/js/render/models.js';
import { pickTrack } from '../public/js/audio.js';
import { everything } from '../shared/mod/examples.js';

const overlay = compileMod({ tables: cloneTables(), hash: CONTENT_HASH, rules: RULES_VERSION }, everything(), { n: 4 }).overlay;

test('syncOverlay installs the welcome\'s mod once, points icons and models at it, tells the bus; none puts the base back', (t) => {
  t.after(() => syncOverlay(null));
  const seen = [];
  const off = onHarness((m) => seen.push(m.e));
  assert.deepEqual(syncOverlay({ n: 4, hash: overlay.hash, overlay }, { assetBase: '/f/abcdefghijkl' }), { changed: true, n: 4 });
  assert.deepEqual(syncOverlay({ n: 4, hash: overlay.hash, overlay }), { changed: false, n: 4 }, 'a repeated welcome changes nothing');
  assert.equal(installedOverlay(), overlay);
  assert.deepEqual(installedMod(), { n: 4, hash: overlay.hash });
  assert.equal(cropOf('x_moon_melon').sell, 124);
  assert.equal(iconUrl('x_moon_melon'), `/f/abcdefghijkl/mods/${overlay.hash}/icons/128/x_moon_melon.png`);
  assert.equal(iconUrl('x_moon_melon', 64), `/f/abcdefghijkl/mods/${overlay.hash}/icons/64/x_moon_melon.png`);
  assert.equal(hasIcon('x_moon_hen'), true);
  assert.equal(lastHarness('content').n, 4);
  syncOverlay(undefined);
  assert.equal(installedOverlay(), null);
  assert.equal(cropOf('x_moon_melon'), undefined);
  assert.equal(hasIcon('x_moon_melon'), false);
  off();
  assert.deepEqual(seen, ['content', 'content']);
});

test('models: a key naming a mod thing is its anchor\'s model, recoloured (real manifest and GLBs)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { ROOT } = await import('./helpers.js');
  const { setManifest, setFetcher } = await import('../public/js/render/assets.js');
  setManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8')));
  setFetcher(async (url) => {
    const f = path.join(ROOT, 'public', url.split('?')[0]);
    if (!fs.existsSync(f)) return { ok: false, status: 404 };
    const b = fs.readFileSync(f);
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), json: async () => JSON.parse(b) };
  });
  await models.init();
  models.setOverlay(overlay.look.models);
  try {
    const k = models.keyOf('x_moon_melon', 3);
    assert.equal(k, 'crop:watermelon:3~x_moon_melon.BFE3FF');
    assert.equal(models.has('crop:x_moon_melon:3'), true, 'a view that builds the key itself gets it too');
    assert.equal(models.info('animal:x_moon_hen'), models.info('animal:chicken'));
    await models.ready([k, 'animal:x_moon_hen', models.keyOf('x_moon_lantern')]);
    const mine = models.geometryFor('crop:x_moon_melon:3');
    const anchor = models.geometryFor('crop:watermelon:3');
    assert.ok(mine && anchor && mine !== anchor);
    assert.equal(mine.getAttribute('position'), anchor.getAttribute('position'), 'the shape is shared');
    assert.notDeepEqual([...mine.getAttribute('color').array.slice(0, 3)], [...anchor.getAttribute('color').array.slice(0, 3)]);
    assert.ok(models.clone('animal:x_moon_hen'), 'the breed is drawn');
    assert.ok(models.isReady(models.keyOf('x_moon_lantern')));
    models.setOverlay({});
    assert.equal(models.keyOf('x_moon_melon', 3), null, 'gone with the overlay');
  } finally {
    models.setOverlay({});
  }
});

test('recolour of baked vertex colours: the anchor colour moves, other colours and greys stay', () => {
  const lin = (hex) => [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const colors = new Float32Array([...lin('#3E8E3A'), ...lin('#808080'), ...lin('#E8463A')]);
  const out = recolorColors(colors, { from: '#3E8E3A', to: '#3A5EC8', kind: 'recolor' });
  assert.ok(out[2] > out[1], 'the green vertex turned blue');
  assert.ok(Math.abs(out[3] - colors[3]) < 1e-6 && Math.abs(out[5] - colors[5]) < 1e-6, 'grey stays');
  assert.ok(Math.abs(out[6] - colors[6]) < 1e-6, 'a red accent stays');
  const tint = recolorColors(new Float32Array([...lin('#FFFFFF'), ...lin('#202020')]), { from: null, to: '#B79CFF', kind: 'tint' });
  assert.ok(tint[2] > tint[1], 'a white coat takes the tint');
});

test('look: sky presets mix at most half; music preferences; no DOM needed', () => {
  for (const p of Object.values(SKY_PRESETS)) for (const [, k] of Object.values(p)) assert.ok(k <= 0.5);
  const sky = { top: [0, 0, 1], horizon: [1, 1, 1], fog: [1, 1, 1], sunI: 1 };
  assert.equal(skyFilter(sky), sky, 'no mod: the sky as it is');
  const prefs = [];
  setLookAudio({ prefer: (ids) => prefs.push(ids) });
  applyLook({ sky: 'stormy', music: { prefer: ['night1'] } });
  assert.equal(currentLook().sky, 'stormy');
  const s2 = skyFilter(sky);
  assert.notDeepEqual(s2.top, sky.top);
  assert.equal(s2.sunI, 1);
  applyLook(null);
  assert.deepEqual(prefs, [['night1'], []]);
  setLookAudio(null);
  const tracks = [{ id: 'a', moods: ['day'] }, { id: 'b', moods: ['day'] }, { id: 'c', moods: ['night'] }];
  assert.equal(pickTrack(tracks, 'day', { prefer: ['b'], random: () => 0 }).id, 'b');
  assert.equal(pickTrack(tracks, 'day', { prefer: ['c'], random: () => 0 }).id, 'a', 'a preference that does not fit the scene is ignored');
});

test('bus: auth for the REST calls, every push to every listener', () => {
  setHarnessAuth({ pid: 'p1', token: 'abc' });
  assert.deepEqual(harnessAuth(), { pid: 'p1', token: 'abc' });
  setHarnessAuth(null);
  assert.equal(harnessAuth(), null);
  const got = [];
  const off = onHarness((m) => got.push(m.e));
  emitHarness({ t: 'hx', e: 'job', job: {} });
  emitHarness({ nonsense: true });
  off();
  emitHarness({ t: 'hx', e: 'applied' });
  assert.deepEqual(got, ['job']);
  assert.equal(assetBaseOf({ pathname: '/f/abcdefghijkl/' }), '/f/abcdefghijkl');
  assert.equal(assetBaseOf({ pathname: '/' }), '');
  assert.deepEqual(Object.keys(iconUrls(overlay)[0]).sort(), Object.keys(overlay.look.icons).sort());
});
