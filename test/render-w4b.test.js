// render lane, wave 4b (the owners' wish list of 2026-10-05): the balloon's loot crates (their fall, their loot, their
// models), the homes' growth tiers, the trees' ages, the relics' models and icons, the bird bath's drinking visitors.
// Tests read the committed files and pure helpers (no WebGL, no build tools). The rules' own helpers are compared when
// the build has them (the rules lane names them; a build without them keeps today's look).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as content from '../shared/content/index.js';
import * as rules from '../shared/rules/index.js';
import * as grid from '../shared/rules/grid.js';
import { setManifest } from '../public/js/render/assets.js';
import { CRATE, cratesOf, dropMoment, dropPose, isCrateDef, lootOf } from '../public/js/render/crates-view.js';
import { AGE_SCALE_MAX, goldenCupolaGeometry, homeTier, objFootprint, treeScale, visualOf } from '../public/js/render/objects-view.js';
import { VISIT, birdVisit, perchAct, visits } from '../public/js/render/birdbath-view.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8'));
const icons = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'icons', 'manifest.json'), 'utf8'));
setManifest(manifest);
const K = manifest.keys;
const { defOf } = content;
// the actions' modules after the rules index (their import order); absent in a build without wave 4b
const crateRules = await import('../shared/rules/actions/crates.js').catch(() => ({}));
const treeRules = await import('../shared/rules/actions/trees.js').catch(() => ({}));
void rules;

test('wish 1: a crate falls from the balloon on its pass, sways down under its chute and lands on its tile', () => {
  // the drop moment is the rules' (a pass every 10 minutes, 55 s in: the balloon's midpoint)
  if (typeof crateRules.dropMomentOf === 'function') for (const k of [0, 1, 2985268]) assert.equal(dropMoment(k), crateRules.dropMomentOf(k));
  const c = { x: 10, z: 20 };
  const from = { x: 0, y: 30, z: 0 };
  let prevY = Infinity;
  for (let s = 0; s <= CRATE.fall; s += 0.25) {
    const p = dropPose(s, c, from);
    assert.ok(p.y >= 0 && p.y <= prevY + 1e-9, `descends (s ${s})`);
    prevY = p.y;
    if (s < CRATE.out) assert.equal(p.chute, 0, 'the chute is still packed as it leaves the basket');
    if (s > CRATE.out + CRATE.pop && s < CRATE.fall) assert.equal(p.chute, 1, 'open under its canopy');
  }
  const down = dropPose(CRATE.fall, c, from);
  assert.deepEqual([down.x, down.y, down.z, down.landed], [21, 0, 41, true], 'on the centre of its tile (metres)');
  assert.ok(dropPose(CRATE.fall + CRATE.fold / 2, c, from).chute > 0 && dropPose(CRATE.fall + CRATE.fold + 0.1, c, from).chute === 0, 'the chute folds away');
  // high over its tile when the balloon is not flying at that moment
  const lone = dropPose(1, c, null);
  assert.ok(lone.y > 20 && Math.hypot(lone.x - 21, lone.z - 41) < 12);
});

test('wish 1: crates are read from the state as the rules keep them (objects of the crate def; farm.crates holds counters)', () => {
  const def = defOf('loot_crate');
  if (def) assert.ok(isCrateDef(def), 'the content crate def');
  assert.ok(!isCrateDef(defOf('apple_tree')) && !isCrateDef(defOf('coop')));
  const k = 2985268;
  const state = { farm: { crates: { k, n: 3 }, objects: {
    'crate.b': { def: 'loot_crate', x: 3, z: 4, rot: 0, placedAt: dropMoment(k) + 900, by: 'sys', k, until: 9e15 },
    'crate.a': { def: 'loot_crate', x: 5, z: 6, rot: 0, placedAt: dropMoment(k) + 3_600_000, by: 'sys', k, until: 9e15 },
    plot1: { def: 'plot', x: 1, z: 1, rot: 0 },
  } } };
  if (!def) return;
  const list = cratesOf(state);
  assert.deepEqual(list.map((x) => x.id), ['crate.a', 'crate.b'], 'sorted, no counters, no plots');
  assert.equal(list[1].at, dropMoment(k), 'a crate the server placed on time falls from its pass');
  assert.equal(list[0].at, dropMoment(k) + 3_600_000, 'a catch-up crate (placed long after its pass) simply is there');
});

test('wish 1: the loot of every crateOpened shape the rules emit flies to the right place', () => {
  assert.deepEqual(lootOf({ e: 'crateOpened', coins: 5918, xp: 2520 }), [{ kind: 'coins', id: 'coins', qty: 5918 }, { kind: 'xp', id: 'xp', qty: 2520 }]);
  assert.deepEqual(lootOf({ e: 'crateOpened', coins: 10, xp: 2, extra: 'acorns', acorns: 2 }).map((l) => l.kind), ['coins', 'xp', 'acorns']);
  assert.deepEqual(lootOf({ e: 'crateOpened', coins: 10, xp: 2, extra: 'goldenSeeds', goldenSeeds: 2 })[2], { kind: 'item', id: 'golden_seeds', qty: 2 });
  assert.deepEqual(lootOf({ e: 'crateOpened', coins: 10, xp: 2, extra: 'fertilizer', item: 'fertilizer', qty: 2 })[2], { kind: 'item', id: 'fertilizer', qty: 2 });
  assert.deepEqual(lootOf({ e: 'crateOpened', coins: 10, xp: 2, extra: 'decor', decor: 'garden_gnome' })[2], { kind: 'item', id: 'garden_gnome', qty: 1 });
  // every loot icon exists (the HUD flights and the loot card)
  for (const id of ['coins', 'xp', 'acorns', 'golden_seeds', 'fertilizer', 'loot_crate']) assert.ok(icons.ids[id], `icon ${id}`);
});

test('wish 1: the crate, its hinged lid and the parachute ship in one small file outside the boot packs', () => {
  for (const k of ['prop:loot_crate', 'prop:loot_crate:lid', 'prop:parachute']) {
    assert.ok(K[k], k);
    assert.equal(K[k].file, 'props/loot-crate.glb');
  }
  assert.ok(K['prop:loot_crate:lid'].min[2] > -0.05, 'the lid is modelled from its hinge forward');
  assert.ok(K['prop:parachute'].size[0] > 3 && K['prop:parachute'].max[1] > 2.4, 'a canopy that reads from the farm camera');
  assert.ok(manifest.files['props/loot-crate.glb'].bytes < 40_000);
});

test('wish 3: every growing home has a model per growth tier, its pen grown each way, a yard inside, loaded only when shown', () => {
  const HG = content.HOME_GROWTH;
  if (!HG) return;
  for (const [id, row] of Object.entries(HG.homes)) {
    const def = defOf(id);
    for (let i = 1; i < row.caps.length; i++) {
      const t = i * (HG.grow || 1);
      const e = K[`home:${id}:g${t}`];
      assert.ok(e, `home:${id}:g${t}`);
      assert.deepEqual(e.footprint, [def.size[0] + t, def.size[1] + t], `${id} g${t} footprint`);
      assert.ok(e.file.includes('-'), `${id} g${t} is no boot-pack member`);
      const [x0, z0, x1, z1] = e.yard;
      assert.ok(x0 < x1 && z0 < z1 && x0 >= -e.footprint[0] && x1 <= e.footprint[0] && z0 >= -e.footprint[1] && z1 <= e.footprint[1], `${id} g${t} yard`);
      // the yard grows with the pen (the animals have the room they paid for)
      const base = K[`home:${id}`].yard;
      assert.ok((x1 - x0) * (z1 - z0) > (base[2] - base[0]) * (base[3] - base[1]), `${id} g${t} roomier`);
      assert.ok(K[`home:${id}:g${t}:far`] && K[`home:${id}:g${t}:far`].tris <= 2100, `${id} g${t} far twin`);
    }
  }
});

test('wish 3: a grown home draws its tier model over the rules\' own footprint; an ordinary home is unchanged', () => {
  const def = defOf('coop');
  const small = { def: 'coop', x: 10, z: 10, rot: 0 };
  assert.equal(homeTier(small, def), 0);
  assert.deepEqual(objFootprint(small, def), [3, 3]);
  assert.equal(visualOf(small, def, 0).key, 'home:coop');
  if (typeof grid.sizeOf !== 'function' || !content.HOME_GROWTH) return;
  const step = def.upgradeStep;
  const up = (cap) => Math.ceil((cap - def.capacity) / step);
  const caps = content.HOME_GROWTH.homes.coop.caps;
  const g1 = { ...small, up: up(caps[0] + 1) };
  const g2 = { ...small, up: up(caps[1] + 1), rot: 1 };
  assert.equal(homeTier(g1, def), 1);
  assert.equal(homeTier(g2, def), 2);
  assert.deepEqual(objFootprint(g1, def), grid.objFootprint(g1, def));
  assert.equal(visualOf(g1, def, 0).key, 'home:coop:g1');
  assert.equal(visualOf(g2, def, 0).key, 'home:coop:g2');
  assert.equal(visualOf(g2, def, 0).stretch, null, 'its own model, never the stretched stand-in');
});

test('wish 4: a tree shows its age stage\'s size (the rules\' treeAgeOf), never past the cap', () => {
  let prev = 0;
  for (let cycle = 0; cycle <= 60; cycle++) {
    const k = treeScale({ cycle });
    assert.ok(k >= 1 && k <= AGE_SCALE_MAX && k >= prev, `cycle ${cycle}`);
    prev = k;
    if (typeof treeRules.treeAgeOf === 'function') {
      assert.equal(k, Math.min(AGE_SCALE_MAX, treeRules.treeAgeOf({ cycle }).scaleBp / 10_000), `cycle ${cycle} matches the rules`);
    }
  }
  if (content.TREE_AGE) assert.ok(treeScale({ cycle: 60 }) > treeScale({ cycle: 0 }), 'a grand tree is visibly bigger');
  const def = defOf('apple_tree');
  assert.equal(visualOf({ def: 'apple_tree', x: 1, z: 1, rot: 0, placedAt: 0, cycle: 40, readyAt: 1e15, startedAt: 0 }, def, 1e12).age, treeScale({ cycle: 40 }));
});

test('wish 2: the placed relics have their models (the sprinkler\'s turning head, the totem\'s gem) and every relic its icon', () => {
  const spr = K['decor:golden_sprinkler']; const head = K['decor:golden_sprinkler:spin']; const tot = K['decor:growth_totem'];
  assert.ok(spr && head && tot);
  assert.equal(head.axis, 'y');
  assert.equal(head.pivot.length, 3);
  assert.equal(spr.anchors.spray.length, 3);
  assert.equal(tot.anchors.gem.length, 3);
  for (const st of ['sapling', 'young', 'mature', 'ready']) assert.ok(K[`tree:rainbow_tree:${st}`], `rainbow tree ${st}`);
  for (const f of [spr.file, tot.file, K['tree:rainbow_tree:ready'].file]) assert.ok(f.includes('-'), `${f} loads only on a farm that has it`);
  const ids = (content.RELICS || []).map((r) => r.id);
  for (const id of [...ids, 'golden_sprinkler', 'growth_totem', 'rainbow_tree', 'lucky_clover', 'golden_can', 'farmhand', 'time_turner', 'golden_barn']) {
    assert.ok(icons.ids[id] && fs.existsSync(path.join(ROOT, 'public', 'assets', 'icons', `${id}.png`)), `icon ${id}`);
  }
  // the Golden Barn's cupola stands on the ridge of every barn level
  for (const k of ['building:barn', 'building:barn:1', 'building:barn:2', 'building:barn:3']) assert.equal(K[k].anchors.ridge.length, 3, `${k} ridge`);
  const g = goldenCupolaGeometry();
  assert.deepEqual(Object.keys(g.attributes).sort(), ['color', 'normal', 'position', 'sway']);
  assert.ok(g.getAttribute('position').count / 3 < 800, 'a small part');
});

test('wish 6: bird bath visitors come now and then, sip, bathe and shake, the same on every screen', () => {
  let came = 0; let cycles = 0;
  for (let c = 0; c < 700; c++) { cycles++; if (visits(c, c % 7)) came++; }
  assert.ok(came / cycles > 0.6 && came / cycles < 0.8, 'about five visits in seven cycles');
  // the shader's float formula (floor((x + 0.5) / 7)) agrees with the JS for every cycle and seed it can meet
  for (let c = 0; c < 4000; c += 7) {
    for (let seed = 0; seed < 7; seed++) {
      const x = Math.fround(c * 5 + seed);
      const r = Math.fround(x - 7 * Math.floor(Math.fround(Math.fround(x + 0.5) / 7)));
      assert.equal(r >= 1.5, visits(c, seed));
    }
  }
  // one visit in order: in, a look, three sips, the bath, the shake, out
  const acts = [];
  for (let u = 0; u < VISIT.period; u += 0.05) { const a = u >= VISIT.inEnd && u < VISIT.perchEnd ? perchAct(u) : null; if (a && acts.at(-1) !== a) acts.push(a); }
  assert.deepEqual(acts.filter((a) => a !== 'look'), ['drink', 'drink', 'drink', 'bathe', 'shake']);
  // a skipped cycle is away from start to end; both screens see the same thing at the same server second
  let skipped = null;
  for (let t = 1000; t < 1000 + VISIT.period * 14 && !skipped; t += 1) { const v = birdVisit(t, 'bath1', 0); if (v.skipped) skipped = v; }
  assert.ok(skipped && skipped.phase === 'away');
  assert.deepEqual(birdVisit(4321.5, 'bath9', 1), birdVisit(4321.5, 'bath9', 1));
});
