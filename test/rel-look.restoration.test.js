// render-look, QA round 2 R2-01 (docs/qa/release/qa-r2/fix-render-look.md): a bundle of Grandma's Farmhouse
// (Restoration 6) finished while the screen watched threw in the restoration view, because the bundle moment looked
// its place up in SITES (which has no farmhouse) before the stages moved on. Every later sync threw again and the
// scaffolding was never drawn until a reload. Pure: a fake fx, no DOM, no GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT, T0 } from './helpers.js';
import { CONTENT, defOf } from '../shared/content/index.js';
import { TILE_M } from '../shared/content/config.js';
import { footprint } from '../shared/rules/grid.js';
import { setManifest } from '../public/js/render/assets.js';
import * as WS from '../public/js/render/world-state.js';
import { SITES, createRestoration } from '../public/js/render/restoration-view.js';
import { createBatch } from '../public/js/render/instancing.js';
import { models } from '../public/js/render/models.js';

setManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8')));
// node has no model files to fetch: the batches keep their placeholders quietly
models.ready = async () => {};

const lvl = (n) => CONTENT.levels[Math.min(n, CONTENT.levels.length) - 1].xp;
const HOUSE = Object.freeze({ f: Object.freeze({ def: 'farmhouse', x: 17, z: 25, rot: 0 }) });
const farmAt = (restore, objects = HOUSE) => ({
  meta: { farmSeed: 1, tz: 'Europe/Sofia', createdAt: T0 },
  farm: { xp: lvl(40), expansions: ['home'], objects: { ...objects }, restore },
  players: {},
});
const M2 = (fn) => { WS.setLivePredicate((d) => !d || !d.m || ['M1a', 'M1b', 'M2'].includes(d.m)); try { return fn(); } finally { WS.setLivePredicate(null); } };
const batches = () => ({
  scenery: createBatch({ name: 's', material: new THREE.MeshBasicMaterial() }),
  dyn: createBatch({ name: 'd', material: new THREE.MeshBasicMaterial() }),
});
const ONE = { farmhouse: { b: { woodwork: T0 - 1 } } };
const TWO = { farmhouse: { b: { woodwork: T0 - 1, comfort: T0 } } };

test('R2-01: a Farmhouse bundle finished on screen plays its moment at the farmhouse and draws the scaffolding', () => {
  const played = [];
  const fx = { play: (ev, pos) => played.push({ ev, pos: pos.clone() }), burst() {} };
  const r = createRestoration({ ...batches(), fx });
  M2(() => {
    r.setState(farmAt({}), T0);
    assert.equal(r.stages.farmhouse, 0);
    const before = r.stats().instances;
    // the partner funds the Woodwork bundle's last slot: a live sync while this screen watches
    assert.doesNotThrow(() => r.sync([], new Set(['restore']), farmAt(ONE), T0));
    assert.equal(r.stages.farmhouse, 1, 'the stage moves on');
    assert.equal(r.stats().instances, before + 1, 'build() ran: the scaffolding stands round the farmhouse');
    assert.equal(played.length, 1, 'one bundle moment');
    assert.deepEqual(played[0].ev, { e: 'bundleDone', project: 'farmhouse' });
    // at the farmhouse's own place (its footprint's centre), not at a site the farm does not have
    const [w, d] = footprint(defOf('farmhouse'), 0);
    assert.ok(Math.abs(played[0].pos.x - (17 + w / 2) * TILE_M) < 1e-9 && Math.abs(played[0].pos.z - (25 + d / 2) * TILE_M) < 1e-9,
      `the moment plays at the farmhouse (got ${played[0].pos.x}, ${played[0].pos.z})`);
    // any later move (a sale, a plant) syncs cleanly, and the next bundle plays its own moment
    assert.doesNotThrow(() => r.sync([], new Set(['objects']), farmAt(ONE), T0 + 1000));
    assert.doesNotThrow(() => r.sync([], new Set(['restore']), farmAt(TWO), T0 + 2000));
    assert.equal(r.stages.farmhouse, 2);
    assert.equal(played.length, 2);
  });
});

test('R2-01: with no farmhouse on the farm the stage still moves on and no moment plays at an unknown place', () => {
  const played = [];
  const fx = { play: (ev, pos) => played.push({ ev, pos }), burst() {} };
  const r = createRestoration({ ...batches(), fx });
  M2(() => {
    r.setState(farmAt({}, {}), T0);
    assert.doesNotThrow(() => r.sync([], new Set(['restore']), farmAt(ONE, {}), T0));
    assert.equal(r.stages.farmhouse, 1);
    assert.equal(played.length, 0, 'nowhere to play it: skipped');
  });
});

test('R2-01: a bundle moment that fails can never freeze the view (the stages and the build come first)', () => {
  let calls = 0;
  const fx = { play: () => { calls++; throw new Error('fx broke'); }, burst() {} };
  const r = createRestoration({ ...batches(), fx });
  M2(() => {
    r.setState(farmAt({}), T0);
    const before = r.stats().instances;
    try { r.sync([], new Set(['restore']), farmAt(ONE), T0); } catch { /* the store listener logs it once */ }
    assert.equal(r.stages.farmhouse, 1, 'the stage moved on despite the failing moment');
    assert.equal(r.stats().instances, before + 1, 'the scaffolding was drawn despite it');
    assert.doesNotThrow(() => r.sync([], new Set(['objects']), farmAt(ONE), T0 + 1000), 'the next move does not replay it');
    assert.equal(calls, 1);
  });
});

test('R2-01 (sibling guard): every restoration project has a place for its moment', () => {
  // restoration-view plays the moment of every project it tracks; fair-view plays the Fair Grounds' at its stand
  const r = createRestoration(batches());
  for (const p of CONTENT.restoration.values()) {
    const placed = p.id in SITES || p.id === 'farmhouse' || p.id === 'fair_grounds';
    assert.ok(placed, `${p.id} has a place for its bundle moment`);
    if (p.id in r.stages && p.id !== 'farmhouse') assert.ok(p.id in SITES, `${p.id} is tracked here and has a site`);
  }
});
