// O4 (release 1.0): shared/net/packs-plan.js, the pure planner the client's scheduler and the Farmbox's host page share:
// the first view's families, the share of each family a farm reads, the manifest's def -> file mapping, and the hint
// a host page carries (only families read at least SINGLE_SHARE of, and the farmers' avatars).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstViewPacks, modelFileOf, packShares, SINGLE_SHARE, PREFETCHABLE } from '../shared/net/packs-plan.js';
import { firstPacksHint } from '../server/http.js';

const MANIFEST = {
  defs: { wheat: { family: 'crop', keys: ['crop:wheat:0'] }, barn: { family: 'building', keys: ['building:barn'] }, gazebo: { family: 'decor', keys: ['decor:gazebo'] } },
  aliases: { farmhouse: 'home:farmhouse' },
  keys: { 'crop:wheat:0': { file: 'crops/wheat.glb' }, 'building:barn': { file: 'buildings/barn.glb' }, 'decor:gazebo': { file: 'decor/gazebo.glb' },
    'home:farmhouse': { file: 'homes/farmhouse.glb' } },
};
const INDEX = {
  'models-crops': { dir: '/assets/models/crops/', files: { 'wheat.glb': [0, 10], 'corn.glb': [10, 90] } },
  'models-buildings': { dir: '/assets/models/buildings/', files: { 'barn.glb': [0, 80], 'mill.glb': [80, 20] } },
  'models-homes': { dir: '/assets/models/homes/', files: { 'farmhouse.glb': [0, 50] } },
  'models-decor': { dir: '/assets/models/decor/', files: { 'gazebo.glb': [0, 5], 'arch.glb': [5, 95] } },
};
const STATE = { players: {}, farm: { objects: {
  a: { def: 'plot', x: 10, z: 10, crop: { def: 'wheat' } }, b: { def: 'barn', x: 12, z: 9 }, c: { def: 'farmhouse', x: 9, z: 12 },
  d: { def: 'gazebo', x: 11, z: 11 }, far: { def: 'barn', x: 80, z: 80 },
} } };

test('packs-plan: the manifest mapping, the first view and each family\'s share', () => {
  const fileOf = modelFileOf(MANIFEST);
  assert.equal(fileOf('wheat'), 'crops/wheat.glb');
  assert.equal(fileOf('farmhouse'), 'homes/farmhouse.glb', 'an alias');
  assert.equal(fileOf('nothing'), null);
  assert.deepEqual(firstViewPacks(STATE, [{ x: 10, z: 10 }], fileOf), ['models-crops', 'models-homes', 'models-buildings', 'models-avatars', 'models-decor']);
  assert.deepEqual(firstViewPacks(STATE, [], fileOf), ['models-avatars'], 'no farmer yet: the farmers only');
  const sh = packShares(STATE, fileOf, INDEX);
  assert.equal(sh['models-crops'], 0.1);
  assert.equal(sh['models-buildings'], 0.8);
  assert.equal(sh['models-homes'], 1);
  assert.equal(sh['models-decor'], 0.05);
  assert.ok(SINGLE_SHARE > 0.1 && SINGLE_SHARE < 0.8);
  assert.ok(!PREFETCHABLE.includes('models-decor') && !PREFETCHABLE.includes('models-town'));
});

test('the host page\'s hint: families of the first view the farm reads enough of, and the avatars', async () => {
  const { spawnAt } = await import('../shared/rules/grid.js');
  const { createFarm } = await import('../shared/rules/state.js');
  const state = createFarm(7, 1_800_000_000_000);
  state.players = { p1: {} };
  const at = spawnAt(state, 'p1');
  const near = (o, dx, dz) => ({ ...o, x: Math.round(at.x + dx), z: Math.round(at.z + dz) });
  state.farm.objects = { a: near({ def: 'plot', crop: { def: 'wheat' } }, 1, 1), b: near({ def: 'barn' }, 2, -1),
    c: near({ def: 'farmhouse' }, -1, 2), d: near({ def: 'gazebo' }, 1, -2), far: near({ def: 'barn' }, 70, 70) };
  const hh = { engine: { state },
    static: { modelManifest: () => MANIFEST, packIndex: () => ({ index: INDEX }) } };
  const hint = firstPacksHint(hh);
  assert.ok(hint.includes('models-buildings') && hint.includes('models-homes') && hint.includes('models-avatars'));
  assert.ok(!hint.includes('models-crops'), 'crops at 10 %: file by file, not a whole pack before the welcome');
  assert.ok(!hint.includes('models-decor'), 'never decor');
  assert.deepEqual(firstPacksHint({ engine: null, static: null }), [], 'anything missing: no hint');
});
