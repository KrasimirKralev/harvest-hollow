// render-life: the shipped models and icons cover the content tables, keep their budgets, and load through
// models.js into the canonical BatchedMesh-ready geometry (tests read the committed files; no build tools).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { fileURLToPath } from 'node:url';
import { CONTENT, PLACEABLES, isLive } from '../shared/content/index.js';
import { setFetcher, setManifest, resetAssetCache } from '../public/js/render/assets.js';
import { models, addShaderPatch, canonicalGeometry, wrapLighting } from '../public/js/render/models.js';
import { iconUrl, initIcons, hasIcon, setIconFetcher, FALLBACK_ICON } from '../public/js/render/icons.js';

// not test/helpers.js: it pulls in the whole rules engine, which other lanes edit concurrently
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = path.join(ROOT, 'public', 'assets', 'models');
const ICONS = path.join(ROOT, 'public', 'assets', 'icons');
const manifest = JSON.parse(fs.readFileSync(path.join(MODELS, 'manifest.json'), 'utf8'));
const iconMan = JSON.parse(fs.readFileSync(path.join(ICONS, 'manifest.json'), 'utf8'));

// Node has no fetch for local paths: serve /assets/... from disk.
const diskFetch = async (url) => {
  const rel = decodeURIComponent(url.split('?')[0]).replace(/^\/assets\//, '');
  const file = path.join(ROOT, 'public', 'assets', rel);
  if (!fs.existsSync(file)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(file);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

test('every placeable def of every milestone has a model; footprints match the content sizes', () => {
  for (const [id, def] of PLACEABLES) {
    const d = manifest.defs[id];
    const alias = manifest.aliases[id];
    assert.ok(d || alias, `no model for ${id} (${def.m})`);
    if (!d || !def.size) continue;
    const keys = d.keys.filter((k) => !manifest.keys[k].part);
    for (const k of keys) assert.deepEqual(manifest.keys[k].footprint, def.size, `${k} footprint vs content size of ${id}`);
  }
});

test('crops have all four visual stages, trees all their states, animals adults (and baby variants)', () => {
  for (const id of CONTENT.crops.keys()) {
    for (let s = 0; s < 4; s++) assert.ok(manifest.keys[`crop:${id}:${s}`], `crop:${id}:${s}`);
    assert.ok(manifest.keys[`crop:${id}:3`].sway > manifest.keys[`crop:${id}:1`].sway, `${id}: ready sways harder than a sprout`);
  }
  for (const id of CONTENT.trees.keys()) for (const st of ['sapling', 'young', 'mature', 'ready']) assert.ok(manifest.keys[`tree:${id}:${st}`], `tree:${id}:${st}`);
  assert.ok(manifest.keys['tree:pine:stump'], 'the woodlot regrows from a stump');
  for (const id of CONTENT.animals.keys()) assert.ok(manifest.keys[`animal:${id}`], `animal:${id}`);
  for (const id of ['chicken', 'duck']) assert.ok(manifest.keys[`animal:${id}:baby`], `${id} chick`);
  for (const body of ['farmer_a', 'farmer_b']) {
    const e = manifest.keys[`avatar:${body}`];
    assert.equal(e.kind, 'skinned');
    for (const clip of ['Idle', 'Walk', 'Run', 'Interact', 'Wave']) assert.ok(e.anim.includes(clip), `${body} ${clip}`);
    assert.ok(!e.anim.some((c) => /Punch|Kick|Sword|Gun|Death/.test(c)), `${body}: no fighting clips`);
    assert.ok(e.tint, `${body} has a player-colour material`);
  }
  for (const id of ['cow', 'sheep']) {
    const e = manifest.keys[`animal:${id}`];
    assert.equal(e.kind, 'skinned');
    assert.ok(e.rigidNode, `${id} has a rigid twin for far / instanced use`);
  }
});

test('homes publish a yard inside their footprint; the windmill sails publish a pivot', () => {
  for (const id of CONTENT.homes.keys()) {
    const e = manifest.keys[`home:${id}`];
    const [w, d] = e.footprint;
    const [x0, z0, x1, z1] = e.yard;
    assert.ok(x0 < x1 && z0 < z1, `${id} yard`);
    assert.ok(x0 >= -w && x1 <= w && z0 >= -d && z1 <= d, `${id} yard inside the ${w}x${d} footprint`);
  }
  const s = manifest.keys['building:mill:sails'];
  assert.equal(s.pivot.length, 3);
  assert.ok(s.pivot[1] > 1, 'the hub is up on the building');
});

test('budgets: payload <= 25 MB, triangles per ready crop plot, models sit on the ground', () => {
  const bytes = Object.values(manifest.files).reduce((a, f) => a + f.bytes, 0);
  assert.ok(bytes <= 25 * 1024 * 1024, `${(bytes / 1048576).toFixed(1)} MB`);
  for (const [file, f] of Object.entries(manifest.files)) assert.equal(fs.statSync(path.join(MODELS, file)).size, f.bytes, file);
  // performance-03: a ripe plot <= 640 triangles (QA wave 2 RD-04: fuller mature crops; was 500), a growing one <= 250,
  // the far-band twin ~120
  for (const id of CONTENT.crops.keys()) {
    assert.ok(manifest.keys[`crop:${id}:3`].tris <= 640, `crop ${id} ripe: ${manifest.keys[`crop:${id}:3`].tris} tris`);
    for (const s of [0, 1, 2]) assert.ok(manifest.keys[`crop:${id}:${s}`].tris <= 250, `crop ${id}:${s}: ${manifest.keys[`crop:${id}:${s}`].tris} tris`);
    for (const s of [2, 3]) assert.ok(manifest.keys[`crop:${id}:${s}:far`] && manifest.keys[`crop:${id}:${s}:far`].tris <= 200, `crop ${id}:${s}:far`);
  }
  for (const [k, e] of Object.entries(manifest.keys)) {
    if (k.startsWith('tree:')) assert.ok(e.tris <= 1200, `${k}: ${e.tris} tris (visual-16)`);
    // wave 2 (VISUAL-AFTER C1): the 3.8k cap destroyed dormers and trims; detail-capped reduction keeps them at
    // up to 9k, and every heavy building has a <= 2.4k far-band twin (render-world swaps it like crop:*:far)
    if (k.startsWith('building:') && !e.part) {
      assert.ok(e.tris <= 9000, `${k}: ${e.tris} tris`);
      if (e.tris > 3000) assert.ok(manifest.keys[`${k}:far`] && manifest.keys[`${k}:far`].tris <= 2400, `${k}:far twin`);
    }
  }
  assert.ok(manifest.keys['decor:flower_bed'].tris <= 600, 'flower bed <= 600');
  assert.ok(manifest.keys['debris:weed'].tris <= 150, 'weeds <= 150');
  assert.ok(manifest.keys['prop:lilypad'].tris <= 120, 'lily pads <= 120');
  for (const [k, e] of Object.entries(manifest.keys)) {
    if (k.startsWith('crop:') || e.part || k.startsWith('tool:')) continue;
    // water props (barge, jetty, ferry landing, the bridge) stand in the river: their posts reach below the bank
    // (wave 3: the farmhouse's wall pieces hang at their own height on the wall)
    if (!e.water && e.layer !== 'wall') assert.ok(e.min[1] > -0.35 && e.min[1] < 0.2, `${k} rests on the ground (min y ${e.min[1]})`);
    // world scenery (restoration sites, the village) is placed by render-world, not on the farm grid
    if (e.footprint && !/^(tree|decor|prop|animal|avatar|restore|town):/.test(k)) {
      const [w, d] = e.footprint;
      assert.ok(e.size[0] <= w * 2 * 1.02 + 0.05 && e.size[2] <= d * 2 * 1.02 + 0.05, `${k} fits its ${w}x${d} footprint (${e.size})`);
    }
  }
});

test('every item, live placeable, tool and currency has a 128 px and a 64 px icon', () => {
  const need = new Set([...CONTENT.items.keys(), ...CONTENT.tools.keys(), 'coins', 'acorns', 'xp', 'hearts', FALLBACK_ICON]);
  for (const [id, def] of PLACEABLES) if (isLive(def)) need.add(id);
  for (const id of need) {
    assert.ok(iconMan.ids[id], `icon manifest lists ${id}`);
    assert.ok(fs.existsSync(path.join(ICONS, `${id}.png`)), `${id}.png`);
    assert.ok(fs.existsSync(path.join(ICONS, '64', `${id}.png`)), `64/${id}.png`);
  }
  const png = fs.readFileSync(path.join(ICONS, 'wheat.png'));
  assert.equal(png.readUInt32BE(16), 128, 'width');
  assert.equal(png.readUInt32BE(20), 128, 'height');
  assert.equal(png[25], 6, 'RGBA (transparent)');
});

test('iconUrl: known ids, the fallback for unknown or unsafe ids, cache-busting hash', async () => {
  setIconFetcher(diskFetch);
  assert.equal(iconUrl('wheat'), '/assets/icons/wheat.png', 'works before the manifest loads');
  await initIcons();
  assert.ok(hasIcon('egg'));
  assert.match(iconUrl('egg'), /^\/assets\/icons\/egg\.png\?v=[0-9a-f]+$/);
  assert.match(iconUrl('egg', 64), /^\/assets\/icons\/64\/egg\.png/);
  assert.match(iconUrl('no_such_item'), /\/_fallback\.png/);
  assert.match(iconUrl('../../etc/passwd'), /\/_fallback\.png/);
});

test('models.js loads GLBs into the canonical attribute set (BatchedMesh-compatible) and clones skinned models', async () => {
  resetAssetCache();
  setFetcher(diskFetch);
  setManifest(manifest);
  const keys = ['crop:wheat:3', 'tree:apple_tree:ready', 'building:bakery', 'home:coop', 'animal:cow', 'avatar:farmer_b', 'plot'];
  await models.ready(keys);
  for (const k of ['crop:wheat:3', 'tree:apple_tree:ready', 'building:bakery', 'home:coop', 'plot', 'animal:cow']) {
    const g = models.geometryFor(k);
    assert.ok(g, k);
    assert.ok(g.index, `${k} indexed`);
    for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['sway', 1]]) {
      const a = g.getAttribute(name);
      assert.ok(a && a.array instanceof Float32Array && a.itemSize === size, `${k}.${name}`);
    }
    const b = models.boundsOf(k);
    const e = manifest.keys[k];
    assert.ok(Math.abs(b.max.y - e.max[1]) < 0.05, `${k} bounds match the manifest (${b.max.y} vs ${e.max[1]})`);
  }
  const sway = models.geometryFor('crop:wheat:3').getAttribute('sway').array;
  let lo = Infinity; let hi = 0;
  for (const v of sway) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(hi > 1.2 && hi <= 1.6 + 1e-3 && lo < 0.02, `roots stay planted, ready tips bend x1.6 (${lo}..${hi})`);
  const sprout = models.geometryFor('crop:wheat:1') || (await models.ready('crop:wheat:1'), models.geometryFor('crop:wheat:1'));
  assert.ok(sprout.getAttribute('sway').array.every((v) => v <= 0.3 + 1e-3), 'sprouts barely move');
  const cow = models.clone('animal:cow');
  assert.ok(cow.skinned && cow.clips.has('Walk') && cow.clips.has('Eat'));
  let skinned = 0;
  cow.object.traverse((o) => { if (o.isSkinnedMesh) { skinned++; assert.equal(o.frustumCulled, false); } });
  assert.equal(skinned, 1, 'one skinned draw call per animal');
  const her = models.clone('avatar:farmer_b', { tint: { White: '#FF7A6B' } });
  let tinted = 0; let meshes = 0;
  her.object.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    assert.ok(o.geometry.getAttribute('_tint'), 'the clothing is a vertex mask');
    const u = o.material.userData.tint;
    if (u && u.value.getHexString() === new THREE.Color('#FF7A6B').getHexString()) tinted++;
  });
  assert.equal(meshes, 1, 'one skinned mesh per farmer: 2 draw calls with the ring, not 9 (performance-12)');
  assert.ok(tinted > 0, 'the clothing takes the player colour');
  const him = models.clone('avatar:farmer_b', { tint: { White: '#2BB3A3' } });
  him.object.traverse((o) => { if (o.isMesh) assert.notEqual(o.material, her.object.getObjectByProperty('isMesh', true).material, 'each farmer has its own tint'); });
  assert.equal(models.keyOf('wheat', 3), 'crop:wheat:3');
  assert.equal(models.keyOf('apple_tree', 'ready'), 'tree:apple_tree:ready');
  assert.equal(models.keyOf('bakery'), 'building:bakery');
  assert.equal(models.keyOf('nope'), null);
  assert.equal(models.geometryFor('crop:unknown:3'), null);
  assert.ok(models.placeholder('crop:unknown:3').getAttribute('sway'), 'placeholders share the attribute set');
});

test('canonicalGeometry dequantises and bakes the node transform', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3, true));
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127]), 3, true));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#ff0000' }));
  mesh.scale.set(2, 2, 2);
  mesh.position.set(1, 0, 0);
  mesh.updateMatrixWorld(true);
  const c = canonicalGeometry(mesh);
  assert.ok(c.getAttribute('position').array instanceof Float32Array);
  assert.ok(Math.abs(c.getAttribute('position').getX(1) - 3) < 1e-3, 'scaled and moved');
  assert.ok(Math.abs(c.getAttribute('normal').getZ(0) - 1) < 1e-2);
  assert.ok(c.getAttribute('color').getX(0) > 0.9 && c.getAttribute('color').getY(0) < 0.05, 'material colour as vertex colour');
  assert.equal(c.getAttribute('sway').getX(2), 0);
});

test('shader patches compose in order and keep a stable program cache key', () => {
  const m = new THREE.MeshLambertMaterial();
  wrapLighting(m);
  wrapLighting(m);
  addShaderPatch(m, 'sway', (sh) => { sh.vertexShader += '\n// sway'; }, 'h1');
  const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <common>\n#include <lights_lambert_pars_fragment>\n#include <opaque_fragment>' };
  m.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /RE_Direct_Wrap/);
  assert.match(shader.vertexShader, /\/\/ sway/);
  assert.ok(shader.uniforms.uWrap && shader.uniforms.uRim);
  assert.equal(m.customProgramCacheKey(), 'hh-look:v2|sway:h1', 'the look patch is not added twice (v2: wave 4 night lights)');
});

test('M1b worlds: giants, Heirlooms, restoration stages, the village, the barge and Fair, pets', () => {
  // a Giant crop for every crop the rules can grow giant (growing :giant:2 and ripe :giant)
  for (const id of CONTENT.crops.keys()) for (const k of [`crop:${id}:giant`, `crop:${id}:giant:2`]) assert.ok(manifest.keys[k], k);
  // every tree with an heirloomAt gets the old-tree look in its grown states, within the tree budget (visual-16)
  for (const [id, def] of CONTENT.trees) {
    if (!Number.isSafeInteger(def.heirloomAt)) continue;
    for (const st of ['mature', 'ready']) {
      const e = manifest.keys[`tree:${id}:${st}:heirloom`];
      assert.ok(e && e.heirloom, `tree:${id}:${st}:heirloom`);
      assert.ok(e.tris <= 1200, `tree:${id}:${st}:heirloom ${e.tris} tris`);
    }
  }
  for (let s = 0; s <= 4; s++) for (const p of ['mill_wheel', 'stone_bridge']) assert.ok(manifest.keys[`restore:${p}:${s}`], `restore:${p}:${s}`);
  for (let s = 0; s <= 3; s++) assert.ok(manifest.keys[`restore:greenhouse:${s}`], `restore:greenhouse:${s} (stage 4 is the farm's Greenhouse)`);
  assert.deepEqual(manifest.keys['restore:mill_wheel:wheel'].axis, 'x', 'the wheel turns about its axle');
  const bridge = manifest.keys['restore:stone_bridge:4'];
  assert.ok(bridge.size[0] >= 21 && bridge.size[0] <= 23, `the bridge spans the ~22 m crossing (${bridge.size[0]} m)`);
  assert.ok(bridge.water && Array.isArray(bridge.deck) && Math.abs(bridge.deck[0] - 0.5) < 1e-9, 'deck 0.5 m above the banks');
  for (const k of ['town:chapel', 'town:bandstand', 'town:schoolhouse', 'town:ferry_landing', 'town:construction', 'prop:barge', 'prop:barge_crate',
    'prop:jetty', 'prop:fair_tent', 'prop:fair_stall', 'prop:fair_podium', 'prop:masterwork_1', 'prop:masterwork_2']) assert.ok(manifest.keys[k], k);
  assert.equal(manifest.keys['prop:barge'].slots.length, 9, 'nine crate slots on the barge (3 rows x 3)');
  for (const kind of ['dog', 'cat']) {
    const e = manifest.keys[`animal:${kind}`];
    assert.ok(e && e.kind === 'skinned' && e.anim.includes('Idle') && e.anim.includes('Walk'), `the ${kind} walks after its farmer`);
    assert.ok(e.size[2] > e.size[0], `the ${kind} faces +z like every animal`);
  }
});

test('every album find has an icon (the find pop, banners and the trade list)', () => {
  for (const set of CONTENT.collections.values()) {
    assert.ok(iconMan.ids[set.display], `${set.display} icon`);
    for (const it of set.items) {
      assert.ok(iconMan.ids[it.id], `icon manifest lists ${it.id}`);
      assert.ok(fs.existsSync(path.join(ICONS, `${it.id}.png`)) && fs.existsSync(path.join(ICONS, '64', `${it.id}.png`)), `${it.id}.png`);
    }
  }
});
