// render lane, wave 4 (the owners' wish list 2026-10-04): the shipped models of the new things and their tiers, the pet
// breeds and their sleep, the barn's hinged doors, the bird baths' visits, the camera tilt, the rain's drizzle /
// downpour / puddles / rainbow. Tests read the committed files and pure helpers (no WebGL, no build tools).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT, PETS } from '../shared/content/index.js';
import { setManifest, setFetcher } from '../public/js/render/assets.js';
import { staticKey, visualOf } from '../public/js/render/objects-view.js';
import { PET, PET_BREEDS, petBreedOf, petKeyOf, petsAsleep } from '../public/js/render/avatars-view.js';
import { birdVisit, VISIT } from '../public/js/render/birdbath-view.js';
import { tiltClamp, tiltFloor, TILT, CAM, createCamera } from '../public/js/render/camera.js';
import { createWeather, rainStyle, weatherAt, HOUR_MS, RAINBOW_MS, setWeatherSource } from '../public/js/render/weather.js';
import { LAMP_N, GLASS_LIN, LAMP_GLASS_LIN, LOOK } from '../public/js/render/models.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8'));
setManifest(manifest);
// Node has no fetch for local paths: serve /assets/... from disk (as test/render-life.assets.test.js does)
setFetcher(async (url) => {
  const rel = decodeURIComponent(url.split('?')[0]).replace(/^\/assets\//, '');
  const file = path.join(ROOT, 'public', 'assets', rel);
  if (!fs.existsSync(file)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(file);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
});
const K = manifest.keys;
const lin = (hex) => { const f = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; const v = parseInt(hex.slice(1), 16); return [f(v >> 16), f((v >> 8) & 255), f(v & 255)]; };

test('wish B/E: the farmhouse, the Well, the Market Stand and the benches have three upgrade tiers, each its own file', () => {
  for (const base of ['building:farmhouse', 'building:well', 'building:market_stand', 'decor:sunset_bench', 'decor:bench_swing']) {
    assert.ok(K[base], base);
    const files = new Set([K[base].file]);
    for (const t of [1, 2, 3]) {
      const e = K[`${base}:${t}`];
      assert.ok(e, `${base}:${t}`);
      assert.deepEqual(e.footprint, K[base].footprint, `${base}:${t} footprint`);
      assert.ok(!files.has(e.file), `${base}:${t} loads only when shown (a file of its own)`);
      files.add(e.file);
      // the 9k building cap and its far twin (render-life budget)
      if (base.startsWith('building:') && e.tris > 3000) assert.ok(K[`${base}:${t}:far`] && K[`${base}:${t}:far`].tris <= 2400, `${base}:${t}:far`);
    }
  }
  // the tiers grow: each shows more than the one before (the visible change)
  assert.ok(K['building:farmhouse:3'].tris > K['building:farmhouse:1'].tris && K['building:farmhouse:1'].tris > K['building:farmhouse'].tris);
  // the farmhouse smokes from its chimney, lights its windows and its lamps at night
  for (const k of ['building:farmhouse', 'building:farmhouse:3']) {
    assert.equal(K[k].anchors.chimney.length, 3, `${k} chimney`);
    assert.ok(K[k].anchors.windows.length >= 4, `${k} windows`);
    assert.ok(K[k].anchors.lamps.length >= 1, `${k} lamps`);
  }
  assert.ok(K['building:farmhouse:3'].anchors.lamps.length > K['building:farmhouse'].anchors.lamps.length, 'the lamp-lit path');
  assert.ok(K['decor:sunset_bench:3'].anchors.lamps.length === 1, "the lantern arch's lantern");
});

test('wish E: staticKey / visualOf pick the tier an object has bought (objects[id].up), the base without one', () => {
  assert.equal(staticKey('farmhouse', 0, 0), 'building:farmhouse');
  assert.equal(staticKey('farmhouse', 0, 2), 'building:farmhouse:2');
  assert.equal(staticKey('well', 0, 7), 'building:well:3', 'past the top tier: the top tier');
  assert.equal(staticKey('sunset_bench', 0, 1), 'decor:sunset_bench:1');
  assert.equal(staticKey('barn', 2, 0), 'building:barn:2', 'the barn keeps its levels');
  const fh = CONTENT.landmarks?.get?.('farmhouse') || { id: 'farmhouse', kind: 'landmark', layer: 'object', size: [4, 4] };
  assert.equal(visualOf({ def: 'farmhouse', x: 1, z: 1, up: 3 }, fh, 0).key, 'building:farmhouse:3');
  assert.equal(visualOf({ def: 'farmhouse', x: 1, z: 1 }, fh, 0).key, 'building:farmhouse');
});

test('wish 8: every barn level has hinged door leaves that swing outward', () => {
  for (const b of ['building:barn', 'building:barn:1', 'building:barn:2', 'building:barn:3']) {
    const doors = Object.keys(K).filter((k) => k.startsWith(`${b}:door`));
    assert.ok(doors.length >= 1, `${b} doors`);
    for (const d of doors) {
      const e = K[d];
      assert.ok(e.part && e.hinge.length === 3 && Math.abs(e.swing) === 1, d);
      assert.ok(Math.abs(e.hinge[0]) < 4 && e.hinge[2] > 2, `${d}: the hinge on the barn's front (${e.hinge})`);
      assert.equal(e.file, K[b].file, `${d} ships with its barn`);
    }
  }
});

test('wishes 1, 3, 7, D, 10: the new crops, tree, rabbit, hutch, doghouse and bird bath, with their anchors', () => {
  for (const id of ['raspberry', 'rose', 'coffee']) {
    for (const s of [0, 1, 2, 3]) assert.ok(K[`crop:${id}:${s}`], `crop:${id}:${s}`);
    assert.ok(K[`crop:${id}:3`].tris <= 640 && K[`crop:${id}:2`].tris <= 250, `${id} budgets`);
    assert.ok(K[`crop:${id}:giant`], `${id} giant`);
  }
  for (const st of ['sapling', 'young', 'mature', 'ready']) assert.ok(K[`tree:pomegranate_tree:${st}`].tris <= 1200, st);
  assert.equal(K['animal:rabbit'].kind, 'rigid');
  assert.ok(K['animal:rabbit'].hop, 'rabbits hop');
  assert.ok(K['animal:rabbit:baby'] && K['animal:rabbit:baby'].size[1] < K['animal:rabbit'].size[1], 'the kit is smaller');
  assert.ok(K['animal:rabbit'].tris <= 700, 'a cheap rigid rabbit');
  const hutch = K['home:hutch'];
  assert.deepEqual(hutch.footprint, [3, 2]);
  assert.ok(Array.isArray(hutch.yard) && hutch.yard[2] - hutch.yard[0] > 3, 'the run is a yard to hop in');
  assert.ok(K['home:hutch:far'], 'the hutch has a far twin');
  assert.equal(K['decor:dog_house'].anchors.bed.length, 3, 'the dog sleeps on its mat');
  assert.equal(K['decor:cat_basket'].anchors.bed.length, 3, 'the cat sleeps in its basket');
  assert.equal(K['decor:bird_bath'].anchors.water.length, 4, 'the bird bath water [x, y, z, r]');
});

test('wish 6: pet breeds map to their own models; a pet without a breed shows its kind\'s first content breed', () => {
  const has = (k) => Boolean(K[k]);
  for (const [kind, map] of Object.entries(PET_BREEDS)) {
    for (const [breed, key] of Object.entries(map)) {
      assert.ok(has(key), `${kind} ${breed}: ${key}`);
      assert.equal(petKeyOf({ kind, breed }, has), key);
    }
    const first = PETS.kinds.find((k) => k.id === kind)?.breeds?.[0]?.id;
    if (first) assert.equal(petBreedOf({ kind }), first, `${kind}: no breed = content's first (${first})`);
    for (const b of PETS.kinds.find((k) => k.id === kind)?.breeds || []) assert.ok(Object.hasOwn(map, b.id), `content breed ${b.id} has a model`);
  }
  assert.equal(petKeyOf({ kind: 'dog', breed: 'poodle' }, has), PET_BREEDS.dog[petBreedOf({ kind: 'dog' })], 'an unknown breed falls back');
  assert.ok(K['animal:dog'].anim.includes('Lie'), 'the dog lies down to sleep (the death clip as Lie)');
  assert.ok(PET.dog.key && PET.cat.key);
});

test('wish 4: pets sleep from late dusk to dawn, with hysteresis at the edge', () => {
  assert.equal(petsAsleep('day', 0.5), false);
  assert.equal(petsAsleep('dawn', 0.1, true), false, 'they wake at dawn');
  assert.equal(petsAsleep('night', 0), true);
  assert.equal(petsAsleep('dusk', 0.3), false, 'early dusk: still up');
  assert.equal(petsAsleep('dusk', 0.6), true, 'late dusk: off to bed');
  assert.equal(petsAsleep('dusk', 0.45, true), true, 'once asleep they stay asleep through a flicker');
});

test('wish 10: bird bath visits are a pure function of the server clock and the bath (both screens agree)', () => {
  const seen = new Set();
  // (wave 4b: a visitor comes now and then, five cycles in seven, so look over a few cycles)
  for (let t = 0; t < VISIT.period * 7; t += 0.25) seen.add(birdVisit(1000 + t, 'bath1', 0).phase);
  assert.deepEqual([...seen].sort(), ['away', 'in', 'out', 'perch']);
  assert.deepEqual(birdVisit(1234.5, 'bath1', 1), birdVisit(1234.5, 'bath1', 1));
  assert.notDeepEqual(birdVisit(1234.5, 'bath1', 0), birdVisit(1234.5, 'bath2', 0), 'baths visit at their own times');
  const perch = birdVisit(0, 'x', 0);
  assert.ok(perch.at >= 0 && perch.at < VISIT.period);
});

test('wish H: the camera turns freely and tilts between 30 and 85 degrees; Q / E turn on from a free yaw', async () => {
  assert.equal(tiltClamp(0), TILT.min);
  assert.equal(tiltClamp(2), TILT.max);
  // the floor rises with the zoom (a far, low view would draw the horizon: client lane's measurement)
  assert.equal(tiltFloor(CAM.minDist), TILT.min);
  assert.ok(Math.abs(tiltFloor(CAM.maxDist) - (44 * Math.PI) / 180) < 1e-9);
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
  const cam = createCamera();
  const y0 = cam.get().yaw;
  cam.orbit(0.3, 0);
  assert.ok(Math.abs(cam.get().yaw - (y0 + 0.3)) < 1e-9 && !cam.get().tilted);
  cam.orbit(0, 1);
  assert.ok(cam.get().tilted && Math.abs(cam.get().pitch - TILT.max) < 1e-9, 'tilted to the top-down limit');
  cam.update(1 / 60);
  assert.ok(cam.camera.position.y > 0);
  cam.rotate(1);
  await new Promise((r) => setTimeout(r, 450));                 // the quarter turn is a 400 ms tween on the wall clock
  cam.update(0.02);
  const q = (cam.get().yaw - Math.PI / 4) / (Math.PI / 2);
  assert.ok(Math.abs(q - Math.round(q)) < 1e-6, 'a quarter turn lands on a quarter');
  // two quick presses turn twice (a turn in progress counts as done)
  const k0 = cam.get().k;
  cam.rotate(1); cam.rotate(1);
  assert.equal(cam.get().k, k0 + 2);
  cam.resetOrbit();
  assert.equal(cam.get().tilted, false);
});

test('wish 12: a rain hour is a drizzle or a downpour; puddles fill and dry; some showers leave a rainbow', () => {
  let down = 0; let bows = 0;
  for (let h = 0; h < 2000; h++) { const st = rainStyle(7, h); if (st.downpour) down++; if (st.rainbow) bows++; }
  assert.ok(down > 700 && down < 1100, `downpours ~45 % (${down})`);
  assert.ok(bows > 950 && bows < 1350, `rainbows ~4 in 7 (${bows})`);
  assert.deepEqual(rainStyle(7, 99), rainStyle(7, 99));
  const seed = 5;
  let h = 0;
  while (weatherAt(seed, h) !== 'sunny' || weatherAt(seed, h + 1) !== 'rain' || weatherAt(seed, h + 2) !== 'sunny' || !rainStyle(seed, h + 1).rainbow) h++;
  setWeatherSource(null);
  const w = createWeather();
  let lv = w.update((h + 1) * HOUR_MS + 1000, 0.016, { farmSeed: seed });
  for (let i = 0; i < 200; i++) lv = w.update((h + 1) * HOUR_MS + 1000 + i * 1000, 1, { farmSeed: seed });
  assert.equal(lv.kind, 'rain');
  assert.ok(lv.puddle > 0.95, `puddles filled (${lv.puddle})`);
  assert.ok(lv.strength > 0.3 && lv.strength < 1.2);
  lv = w.update((h + 2) * HOUR_MS + 60_000, 1, { farmSeed: seed });
  assert.ok(lv.rainbow > 0.9, `a rainbow a minute after the shower (${lv.rainbow})`);
  lv = w.update((h + 2) * HOUR_MS + RAINBOW_MS + 1000, 1, { farmSeed: seed });
  assert.equal(lv.rainbow, 0, 'and gone after three minutes');
  for (let i = 0; i < 120; i++) lv = w.update((h + 2) * HOUR_MS + 200_000 + i * 1000, 1, { farmSeed: seed });
  assert.ok(lv.puddle < 0.9 && lv.puddle > 0.5, `puddles dry over minutes (${lv.puddle})`);
});

test('wish 11: window glass and lamp glass are the shared swatches the night glow keys on; a few real lamps', () => {
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.006);
  assert.ok(close(GLASS_LIN, lin('#9FD3E8')), 'window glass (build-assets K.glass, MV Windows)');
  assert.ok(close(LAMP_GLASS_LIN, lin('#FFE08A')), 'lamp glass (lanterns, lamp posts, wall lamps)');
  assert.ok(LAMP_N >= 2 && LAMP_N <= 4, 'at most ~4 real lights');
  assert.equal(LOOK.uLampPos.value.length, LAMP_N);
});

test('wish 9: every catalog hair style and hat has a look; a player who never chose one keeps the rig as it is', async () => {
  const { lookOf, accessoryGeometry, HAIR_STYLES, HATS } = await import('../public/js/render/avatar-looks.js');
  const C = await import('../shared/content/index.js');
  const cat = C.AVATAR_LOOKS;
  if (cat) {
    for (const h of cat.hair || []) assert.ok(HAIR_STYLES.includes(h.id), `hair ${h.id}`);
    for (const h of cat.hats || []) assert.ok(HATS.includes(h.id), `hat ${h.id}`);
    for (const b of cat.bodies || []) assert.ok(K[`avatar:${b.id}`], `body ${b.id}`);
  }
  const rigA = { hair: K['avatar:farmer_a'].hair, hat: K['avatar:farmer_a'].hat };
  assert.equal(lookOf({ avatar: null }, rigA), null);
  assert.equal(lookOf({ avatar: { body: 'farmer_a' } }, rigA), null, 'a body alone changes nothing else');
  const own = lookOf({ avatar: { top: '#FF7A6B' } }, rigA);
  assert.equal(own.hat, 'straw_hat', "farmer A keeps the rig's straw hat unless another is chosen");
  assert.equal(accessoryGeometry(own, rigA), null, 'the rig in its own hair and hat: no extra mesh, no extra draw');
  const g = accessoryGeometry(lookOf({ avatar: { hair: 'curly', hat: 'cowboy_hat', hairColor: '#D9B26A' } }, rigA), rigA);
  assert.ok(g && g.getAttribute('position').count > 0 && g.getAttribute('color'), 'another hair and hat: one merged mesh');
  assert.equal(lookOf({ avatar: { hairColor: 'red' } }, rigA), null, 'only #rrggbb colours');
  for (const k of ['avatar:farmer_a', 'avatar:farmer_b']) assert.ok(K[k].hair && K[k].hat, `${k} names its own hair and hat`);
});

test('wishes 8, 11, E in the objects view: barn doors are instances that open and close; lamps are light sources; tiers swap', async () => {
  const THREE = await import('three');
  const { createObjectsView } = await import('../public/js/render/objects-view.js');
  const T0 = Date.UTC(2026, 9, 5, 12);
  const layers = Object.fromEntries(['ground', 'crops', 'objects', 'gridFx', 'fx'].map((n) => [n, new THREE.Group()]));
  const view = createObjectsView(layers, { now: () => T0 + 1 });
  const st = (objs, extra = {}) => ({ meta: { farmSeed: 1, tz: 'Europe/Sofia' }, farm: { expansions: ['home'], objects: objs, barn: 1, ...extra }, players: {} });
  const barn = { def: 'barn', x: 20, z: 20, rot: 0, placedAt: T0, by: 'p1' };
  const fh = { def: 'farmhouse', x: 30, z: 30, rot: 0, placedAt: T0, by: 'p1' };
  view.setState(st({ b: barn, f: fh }));
  assert.equal(view.inspect('f').key, 'building:farmhouse');
  assert.equal(view.doors('b', true), true, 'the barn has doors');
  assert.equal(view.doorsOpen('b'), true);
  assert.equal(view.doors('f', true), false, 'the farmhouse has none');
  for (let i = 0; i < 20; i++) view.update(0.05, (T0 % 1e6) + i * 50);
  view.doors('b', false);
  for (let i = 0; i < 30; i++) view.update(0.05, (T0 % 1e6) + 1000 + i * 50);
  assert.equal(view.doorsOpen('b'), false, 'shut again');
  const lamps0 = view.lampSources().length;
  assert.ok(lamps0 >= 1, 'the farmhouse wall lantern is a light');
  const { models } = await import('../public/js/render/models.js');
  await models.ready(['building:farmhouse']);
  await new Promise((r) => setTimeout(r, 0));
  view.sync(['f'], new Set(['objects']), st({ b: barn, f: { ...fh, up: 3 } }));
  // the tier waits for its own file (no placeholder box in between): the drawn key stays until the model is ready
  if (!models.isReady('building:farmhouse:3')) assert.equal(view.inspect('f').key, 'building:farmhouse');
  await models.ready(['building:farmhouse:3']);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(view.inspect('f').key, 'building:farmhouse:3', 'then it swaps');
  assert.ok(view.lampSources().length > lamps0, 'tier 3 lights the path');
});
