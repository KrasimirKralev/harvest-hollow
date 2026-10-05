// The starter farm and the land (GDD §2.1-§2.3, §3.9): geometry, debris totals, object ids, room to build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT, CONFIG, DEBRIS_RULES, defOf, isLive, expansionObjects } from '../shared/content/index.js';
import { freeHomeTiles } from './helpers/content.js';

const { START } = CONFIG;
const OBJ_ID_RE = /^[a-z0-9.]{1,40}$/;
const debrisDef = (id) => CONTENT.debris.get(id);

test('the Homestead: 16 tilled plots in the 4x4 block at offset (8, 6), 300 coins, 5 Acorns (GDD §2.3)', () => {
  assert.equal(START.plots.length, 16);
  assert.equal(START.plots.length, CONTENT.plots.get('plot').free);
  assert.equal(START.plots.length, CONTENT.levels[0].plotCap, 'the L1 plot cap equals the starter plots');
  const xs = START.plots.map(([x]) => x);
  const zs = START.plots.map(([, z]) => z);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)], [24, 27, 30, 33]);
  assert.deepEqual([START.coins, START.acorns, START.expansions], [300, 5, ['home']]);
  assert.deepEqual(START.tray, ['coop', 'feed_mill']);
});

test('starter structures sit where GDD §2.3 puts them (offsets from the north-west corner 16, 24)', () => {
  const at = Object.fromEntries(START.objects.filter((o) => o.id.startsWith('home.1.')).map((o) => [o.def, [o.x - 16,
    o.z - 24]]));
  assert.deepEqual(at, { farmhouse: [1, 1], barn: [17, 1], well: [13, 2], mailbox: [5, 4], market_stand: [2, 12],
    order_board: [5, 13] });
});

test('starter debris: 8 weeds, 6 rocks, 4 stumps, 4 logs, 2 boulders = 40 XP, 200 coins, 20 Wood', () => {
  const debris = START.objects.filter((o) => debrisDef(o.def));
  const count = {};
  for (const o of debris) count[o.def] = (count[o.def] ?? 0) + 1;
  assert.deepEqual(count, { weed: 8, rock: 6, stump: 4, log: 4, boulder: 2 });
  const xp = debris.reduce((s, o) => s + debrisDef(o.def).xp.home, 0);
  assert.equal(xp, 40);
  assert.equal(xp * DEBRIS_RULES.coinsPerXp, 200);
  assert.equal(debris.reduce((s, o) => s + debrisDef(o.def).wood, 0), 20);
});

test('every expansion brings 15 debris pieces = 68 XP, 340 coins, 12 Wood (GDD §2.3, §4.5); M2 land a Big Stump', () => {
  for (const e of CONTENT.expansions.values()) {
    if (e.k === 0) continue;
    const debris = expansionObjects(e.id).filter((o) => o.origin === 'expansion');
    assert.equal(debris.length, 15, e.id);
    const xp = debris.reduce((s, o) => s + debrisDef(o.def).xp.expansion, 0);
    // wave 3: the M2 woodland (expansions 11-15) trades one stump for a Big Stump, a together chop (§6.2 #8)
    const m2 = e.m === 'M2';
    assert.equal(debris.filter((o) => o.def === 'big_stump').length, m2 ? 1 : 0, e.id);
    assert.equal(xp, m2 ? 90 : 68, e.id);
    assert.equal(xp * DEBRIS_RULES.coinsPerXp, m2 ? 450 : 340, e.id);
    assert.equal(debris.reduce((s, o) => s + debrisDef(o.def).wood, 0), m2 ? 14 : 12, e.id);
  }
});

test('object ids are valid, unique and never collide with action-created ids', () => {
  const ids = [...START.plots.map((_, i) => `home.0.${i}`), ...START.objects.map((o) => o.id)];
  for (const e of CONTENT.expansions.values()) ids.push(...expansionObjects(e.id).map((o) => o.id));
  for (const id of ids) {
    assert.match(id, OBJ_ID_RE);
    // ids an action creates are `${cid}.${seq36}.${i}` with a 6-character cid; ours start with 'home' or 'expN'
    assert.ok(id.split('.')[0].length !== 6, id);
  }
  assert.equal(new Set(ids).size, ids.length);
});

test('every starter object is live and on the Homestead; nothing overlaps; the porch is free', () => {
  for (const o of START.objects) assert.ok(isLive(defOf(o.def)), o.def);
  assert.ok(freeHomeTiles().length > 100, 'plenty of free land around the starter objects');
  const free = new Set(freeHomeTiles().map(([x, z]) => `${x},${z}`));
  for (const p of Object.values(START.spawn)) assert.ok(free.has(`${Math.floor(p.x)},${Math.floor(p.z)}`),
    'spawn tile free');
});

test('the dirt paths connect the porch, the plot gate, the market road and the barn door', () => {
  const path = new Set(START.objects.filter((o) => o.def === 'dirt_path').map((o) => `${o.x},${o.z}`));
  const seen = new Set(['20,29']);
  const queue = [[20, 29]];
  while (queue.length) {
    const [x, z] = queue.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${z + dz}`;
      if (path.has(k) && !seen.has(k)) { seen.add(k); queue.push([x + dx, z + dz]); }
    }
  }
  assert.equal(seen.size, path.size, 'one connected path network');
  for (const k of ['22,31', '22,32', '20,35', '34,29']) assert.ok(seen.has(k), `path reaches ${k}`);
});

test('there is room for the free Coop and Feed Mill (3x3 each) on minute one, without clearing anything', () => {
  const free = new Set(freeHomeTiles().map(([x, z]) => `${x},${z}`));
  const spots = [];
  const fits = (x, z) => {
    for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) if (!free.has(`${x + dx},${z + dz}`)) return false;
    return true;
  };
  for (let z = 24; z < 40; z++) {
    for (let x = 16; x < 40; x++) {
      if (!fits(x, z)) continue;
      spots.push([x, z]);
      for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) free.delete(`${x + dx},${z + dz}`);
    }
  }
  assert.ok(spots.length >= 2, `only ${spots.length} 3x3 spots`);
});

test('the parcel map: 15 expansions + the Homestead tile the 48x48 farm in 8x8 parcels', () => {
  let tiles = 0;
  for (const e of CONTENT.expansions.values()) {
    for (const [x, z, w, d] of e.rects) {
      assert.equal(x % 8, 0, e.id);
      assert.equal(z % 8, 0, e.id);
      assert.equal(w % 8, 0, e.id);
      assert.equal(d % 8, 0, e.id);
      tiles += w * d;
    }
  }
  assert.equal(tiles, 48 * 48);
  assert.deepEqual(CONTENT.expansions.get('creekside').rects, [[40, 24, 8, 16]],
    'expansion 1 is east of the Homestead');
});
