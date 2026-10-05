// Wave 4 integration (the owners' wish list, 2026-10-04): the seams between the lanes that no lane could close alone.
// - wish 2: the Compost Scoop set to Fertilizer spreads Fertilizer (client `spread` tool option, the ui's strip)
// - wish E: the Hand on the Well opens its upgrades
// - wish 6 / 9: nobody looks different after the update (the dog's first breed is today's Shiba; farmer A keeps the hat)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { xpForLevel, PETS, AVATAR_LOOKS } from '../shared/content/index.js';
import { breedOf } from '../shared/rules/actions/pets.js';
import { coopHarness, eventTarget, fakeController } from './helpers/client.js';
import { verbsFor, OPENS } from '../public/js/game/targets.js';
import { PET_BREEDS, PET, petBreedOf } from '../public/js/render/avatars-view.js';
import { DEFAULT_BREEDS } from '../public/js/ui/panels/w4-rules.js';

beforeEach(() => { globalThis.window = eventTarget(); });

const plotsOf = (s) => Object.keys(s.farm.objects).sort().filter((k) => s.farm.objects[k].def === 'plot');

test('wish 2: the scoop set to Fertilizer fertilizes a growing crop; set to Compost it composts, as before', async () => {
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) {
    s.farm.xp = xpForLevel(12);
    s.farm.inventory.fertilizer = 3;
    s.farm.inventory.compost = 3;
    s.farm.wallet.coins = 5000;
  }
  const [p1, p2] = plotsOf(h.state);
  h.a.store.act('plant', { ids: [p1, p2], crop: 'pumpkin' });
  h.flush();
  const a = await fakeController(h.a);
  a.ctl.setTool('compost_scoop', { spread: 'fertilizer' });
  assert.equal(a.ctl.tool.spread, 'fertilizer', 'the choice is part of the public tool (the ui strip reads it)');
  const o1 = h.state.farm.objects[p1];
  a.click(o1.x, o1.z);
  h.flush();
  assert.equal(h.state.farm.objects[p1].crop.fert, 'p1', 'Fertilizer spread by the scoop');
  assert.notEqual(h.state.farm.objects[p1].compost, true, 'and no Compost with it');
  assert.equal(h.b.store.state.farm.objects[p1].crop.fert, 'p1', 'the partner sees it');
  a.ctl.setTool('compost_scoop', { spread: 'compost' });
  const o2 = h.state.farm.objects[p2];
  a.click(o2.x, o2.z);
  h.flush();
  assert.equal(h.state.farm.objects[p2].compost, true, 'Compost again');
  assert.equal(h.state.farm.objects[p2].crop.fert, undefined);
});

test('wish 2: verbsFor follows the spread choice; Fertilizer never goes on a tree or a Giant', () => {
  const plot = { kind: 'plot' };
  const tree = { kind: 'tree', def: { id: 'apple_tree' } };
  assert.deepEqual(verbsFor('compost_scoop', plot), ['compost']);
  assert.deepEqual(verbsFor('compost_scoop', plot, { spread: 'fertilizer' }), ['fertilize']);
  assert.deepEqual(verbsFor('compost_scoop', tree, { spread: 'fertilizer' }), []);
  assert.deepEqual(verbsFor('compost_scoop', { kind: 'plot', giant: 'x' }, { spread: 'fertilizer' }), []);
});

test('wish E: the Hand on the Well opens its upgrades', () => {
  assert.equal(OPENS.well, 'upgrades');
});

test('wishes 6 + 9: nobody looks different after the update (first dog breed = today\'s Shiba, farmer A keeps his hat)', () => {
  const dog = PETS.kinds.find((k) => k.id === 'dog');
  assert.equal(dog.breeds[0].id, 'shiba');
  assert.equal(PET_BREEDS.dog[dog.breeds[0].id], PET.dog.key, 'the first breed draws the pre-wave-4 model');
  assert.equal(breedOf({ kind: 'dog' }), 'shiba');
  assert.equal(petBreedOf({ kind: 'dog' }), 'shiba');
  assert.equal(DEFAULT_BREEDS.dog[0].id, 'shiba', 'the ui\'s fallback list agrees');
  const cat = PETS.kinds.find((k) => k.id === 'cat');
  assert.equal(PET_BREEDS.cat[cat.breeds[0].id], PET.cat.key);
  assert.equal(AVATAR_LOOKS.defaults.p1.hat, 'straw_hat');
});

test('wish 12: the rain streak quad keeps its winding (the mirrored quad was culled: only the splashes showed)', async () => {
  const THREE = await import('three');
  const src = fs.readFileSync(new URL('../public/js/render/fx.js', import.meta.url), 'utf8');
  const m = /vec2 n = vec2\(\s*(-?)d\.(x|y)\s*,\s*(-?)d\.(x|y)\s*\)\s*\/\s*dl/.exec(src);
  assert.ok(m, 'the streak normal is built from its screen direction d');
  const d = { x: 0.15, y: 1 };                               // a streak falling down the screen, its tail up
  const n = { x: (m[1] ? -1 : 1) * d[m[2]], y: (m[3] ? -1 : 1) * d[m[4]] };
  const q = new THREE.PlaneGeometry(1, 1);
  const pos = q.getAttribute('position');
  const [i0, i1, i2] = q.index.array;
  const at = (i) => { const x = pos.getX(i); const y = pos.getY(i); return { x: d.x * (y + 0.5) + n.x * x * 0.03, y: d.y * (y + 0.5) + n.y * x * 0.03 }; };
  const area = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const orig = (i) => ({ x: pos.getX(i), y: pos.getY(i) });
  const doubleSided = /RAIN_FS,[^)]*side:\s*THREE\.DoubleSide/.test(src);
  assert.ok(doubleSided || Math.sign(area(at(i0), at(i1), at(i2))) === Math.sign(area(orig(i0), orig(i1), orig(i2))),
    'a front face on screen (or a double-sided material)');
  assert.equal(Math.sign(area(at(i0), at(i1), at(i2))), Math.sign(area(orig(i0), orig(i1), orig(i2))), 'the winding is kept');
});
