// render lane, wave 5 (the owners' wish lists of 2026-10-05): hungry hens wait in the coop, the dog stays home, frogs by
// the water and in the rain's puddles, the land sold by the big parcel, and the models and icons of the bison, the quail
// and the spices. Tests read the committed files and pure helpers (no WebGL, no build tools).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as content from '../shared/content/index.js';
import '../shared/rules/index.js';
import { setManifest } from '../public/js/render/assets.js';
import { models } from '../public/js/render/models.js';
import { INDOOR, INDOOR_HUNGRY, polyWalk, polyTime, outAt, BABY_TINT, DUST_ROLLERS, animalStatus } from '../public/js/render/animals-view.js';
import { STAY, stayActivity, petStaysHome } from '../public/js/render/avatars-view.js';
import { FROGS, frogSpots, frogPick } from '../public/js/render/frogs-view.js';
import { findPuddles, saleSigns, landTiles, parcelCorners } from '../public/js/render/ground.js';
import { ownedLand, isLandRow } from '../public/js/render/world-state.js';
import { packSpecs } from '../server/static.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8'));
const icons = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'icons', 'manifest.json'), 'utf8'));
setManifest(manifest);
await models.init();
const K = manifest.keys;
const { CONTENT, defOf } = content;
const has = (id) => Boolean(defOf(id));

test('wish 4: hungry hens walk up the ramp into their coop; a hen fed comes out on the same schedule on both screens', () => {
  assert.ok(INDOOR_HUNGRY.has('chicken'));
  // every coop model (and its growth tiers) has the door the hens use: foot of the ramp, the sill, a point inside
  for (const k of ['home:coop', 'home:coop:g1', 'home:coop:g2', ...(has('quail_coop') ? ['home:quail_coop', 'home:quail_coop:g1', 'home:quail_coop:g2'] : [])]) {
    const d = K[k]?.door;
    assert.ok(Array.isArray(d) && d.length === 7, `${k} has a door anchor`);
    assert.ok(d[3] > 0.3, `${k}: the sill is up the ramp`);
    const yard = K[k].yard;
    assert.ok(d[1] >= yard[1] - 0.6 && d[1] <= yard[3], `${k}: the foot of the ramp is at the yard`);
    // the grown coop keeps its house in the back-left corner: its door moves with it, its sill height stays
    if (k.endsWith(':g1')) {
      const d0 = K[k.replace(':g1', '')].door;
      assert.ok(Math.abs(d[0] + 1 - d0[0]) < 1e-6 && Math.abs(d[1] + 1 - d0[1]) < 1e-6 && d[3] === d0[3], `${k}: the door moved with the house`);
    }
  }
  // the walk: along the polyline at a steady speed, climbing to the sill, done at the end
  const pts = [{ x: 0, z: 2, y: 0 }, { x: 0, z: 1, y: 0 }, { x: 0, z: 0, y: 0.8 }, { x: 0, z: -0.5, y: 0.8 }];
  assert.equal(polyTime(pts, 0.5), 5);
  const mid = polyWalk(pts, 3, 0.5);
  assert.ok(Math.abs(mid.z - 0.5) < 1e-9 && Math.abs(mid.y - 0.4) < 1e-9 && mid.walking && !mid.done);
  assert.ok(Math.abs(mid.face - Math.PI) < 1e-9, 'heading in (-z)');
  assert.ok(polyWalk(pts, 99, 0.5).done);
  // the way out: the same moment on both screens (server time), a flock files out one by one
  const fedAt = 1_800_000_000_000;
  const outs = ['h1', 'h2', 'h3', 'h4'].map((id) => outAt(id, fedAt));
  for (const o of outs) assert.ok(o >= fedAt + INDOOR.outDelay && o <= fedAt + INDOOR.outDelay + INDOOR.outStagger);
  assert.equal(new Set(outs).size, 4, 'never all at once');
  assert.deepEqual(outs, ['h1', 'h2', 'h3', 'h4'].map((id) => outAt(id, fedAt)), 'deterministic');
  // hungry is the rules' state: an adult with no cycle running (a hen with an egg waiting stays out with its bubble)
  assert.equal(animalStatus({ fedAt: null, readyAt: null, adultAt: 0 }, 10).hungry, true);
  assert.equal(animalStatus({ fedAt: 0, readyAt: 5, adultAt: 0 }, 10).hungry, false);
  assert.equal(animalStatus({ fedAt: null, readyAt: null, adultAt: 99 }, 10).hungry, false, 'a chick is never hungry');
});

test('wish L2-3: a pet told to stay home keeps to its bed, napping, sniffing about and greeting its farmer (server time)', () => {
  assert.equal(petStaysHome({ kind: 'dog', stay: true }), true);
  assert.equal(petStaysHome({ kind: 'dog' }), false);
  assert.equal(petStaysHome(null), false);
  assert.deepEqual(stayActivity('p1', 123, 2), { act: 'greet' }, 'its farmer near: it greets');
  const seen = new Set();
  for (let k = 0; k < 400; k++) {
    const a = stayActivity('p1', k * STAY.spell + 10);
    seen.add(a.act);
    assert.deepEqual(a, stayActivity('p1', k * STAY.spell + 4000), 'one activity a spell, the same on both screens');
    if (a.act === 'sniff') assert.ok(a.at > 0 && a.at <= STAY.sniff * 1.1 && Math.abs(a.a) <= 1.2, 'it pads about in front of its house');
  }
  assert.deepEqual([...seen].sort(), ['mat', 'nap', 'sniff']);
});

test('wish 3: frogs sit at the water (the river bank, the pond, duck ponds, bird baths), a few more from dusk', () => {
  const now = 0;
  const state = { farm: { expansions: ['home'], objects: {} } };
  const base = frogSpots(state);
  const by = (l, src) => l.filter((s) => s.src === src);
  assert.equal(by(base, 'river').length, FROGS.river.x.length + FROGS.river.dusk.length);
  assert.equal(by(base, 'pond').length, FROGS.pond + FROGS.pondDusk);
  assert.ok(base.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z) && Number.isFinite(s.face)));
  assert.ok(base.some((s) => s.kind === 1) && base.some((s) => s.kind === 0), 'some only from dusk');
  // the river frogs sit on the farm's bank, south of the farm, never on it
  for (const s of by(base, 'river')) assert.ok(s.z > 56 * 2, 'outside the farm');
  // a duck pond and a bird bath bring their own frogs (from their models' water anchors), in a stable order
  const objects = {};
  if (has('duck_pond')) objects.dp = { def: 'duck_pond', x: 20, z: 30, rot: 0 };
  if (has('bird_bath')) objects.bb = { def: 'bird_bath', x: 30, z: 30, rot: 0 };
  const more = frogSpots({ farm: { expansions: ['home'], objects } }, { info: (k) => models.info(k), keyOf: (d) => models.keyOf(d) });
  if (has('duck_pond')) {
    const duck = by(more, 'duck');
    assert.equal(duck.length, FROGS.duck + FROGS.duckDusk);
    for (const s of duck) assert.ok(s.x > 40 && s.x < 48 && s.z > 60 && s.z < 68, 'on the duck pond\'s rim');
  }
  if (has('bird_bath')) assert.equal(by(more, 'bath').length, FROGS.bath + FROGS.bathDusk);
  assert.deepEqual(more, frogSpots({ farm: { expansions: ['home'], objects } }, { info: (k) => models.info(k), keyOf: (d) => models.keyOf(d) }), 'deterministic');
  void now;
});

test('wish 3: at a tier\'s cap the farm\'s own water keeps its frogs, and a rain\'s puddles come before the dusk-only ones', () => {
  // the owners' farm (2026-10-07 save): two bird baths, no duck or koi pond; the low tier (a weak phone) draws 10 frogs
  const objects = { bb1: { def: 'bird_bath', x: 30, z: 30, rot: 0 }, bb2: { def: 'bird_bath', x: 36, z: 22, rot: 0 } };
  const spots = frogSpots({ farm: { expansions: ['home'], objects } }, { info: (k) => models.info(k), keyOf: (d) => models.keyOf(d) });
  const baths = spots.filter((s) => s.src === 'bath');
  assert.equal(baths.length, 2 * (FROGS.bath + FROGS.bathDusk));
  const low = frogPick(spots, [], FROGS.cap.low);
  assert.equal(low.length, FROGS.cap.low);
  for (const b of baths) assert.ok(low.includes(b), 'each bird bath keeps its dusk frog on a low-tier phone');
  assert.ok(low.filter((s) => s.kind === 0).length >= Math.min(FROGS.cap.low - baths.length, spots.filter((s) => s.kind === 0).length),
    'the always-out frogs still come first');
  // after a rain: the puddles' frogs before the dusk-only ones (they are what the rain brought out)
  const puddles = [0, 1, 2].map((i) => ({ x: 70 + i * 9, z: 70, y: 0.03, face: 0, kind: 2, src: 'puddle' }));
  const wet = frogPick(spots, puddles, FROGS.cap.low);
  const always = spots.filter((s) => s.kind === 0).length;
  assert.equal(wet.filter((s) => s.kind === 2).length, Math.min(puddles.length, FROGS.cap.low - always), 'the puddles fill what the always-out frogs leave');
  assert.ok(puddles.every((p) => frogPick(spots, puddles, FROGS.cap.medium).includes(p)), 'every puddle frog from the medium tier');
  // the same list at a roomy cap: everything, and the order is stable
  assert.equal(frogPick(spots, puddles, 99).length, spots.length + puddles.length);
  assert.deepEqual(frogPick(spots, puddles, FROGS.cap.low), wet, 'deterministic');
});

test('wish 3: after a rain the frogs find the lawn\'s puddles: the ground shader\'s field, on owned land, off paths and footprints', () => {
  // a synthetic noise: channel B high in one spot; the ground map: a path through another
  const NS = 256;
  const noise = new Uint8Array(NS * NS * 4).fill(60);
  const GMS = 256;
  const gm = new Uint8Array(GMS * GMS * 4);
  for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) { const k = (j * NS + i) * 4; noise[k + 2] = 250; noise[k + 3] = 250; noise[k + 1] = 128; }
  // everything is "deep" (B high): every owned cell is a candidate; the path column and a footprint are refused
  for (let j = 0; j < GMS; j++) for (let i = 0; i < GMS; i++) { const k = (j * GMS + i) * 4; if (i >= 80 && i < 90) gm[k + 1] = 255; if (i >= 120 && i < 130 && j >= 120 && j < 130) gm[k] = 255; }
  const owned = (x, z) => x >= 30 && x < 100 && z >= 30 && z < 100;
  const spots = findPuddles(noise, gm, GMS, false, owned, 8, 8);
  assert.ok(spots.length >= 4 && spots.length <= 8);
  for (const s of spots) {
    assert.ok(owned(s.x, s.z), 'on owned land');
    assert.ok(!(s.x >= 40 - 1 && s.x < 45 + 1), 'never on the path (gm g)');
    assert.ok(!(s.x >= 59 && s.x < 66 && s.z >= 59 && s.z < 66), 'never under a footprint (gm r)');
  }
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z) >= 8, 'apart');
  assert.deepEqual(spots, findPuddles(noise, gm, GMS, false, owned, 8, 8), 'deterministic');
  // a dry lawn (B low) has none
  assert.deepEqual(findPuddles(new Uint8Array(NS * NS * 4).fill(40), gm, GMS, false, owned, 8, 8), []);
});

test('wish L2-4: land is sold by the big parcel: one sign a parcel, an old parcel\'s features follow its land by geometry', () => {
  const E = CONTENT.expansions;
  // a retired small row is never sold, signed or overgrown on its own
  assert.equal(isLandRow({ id: 'x', retired: true }), false);
  // the pieces of a parcel share one sign (content groups them with `parcel`)
  const owned = ['home'];
  const signs = saleSigns(owned);
  const groups = new Set();
  for (const e of E.values()) if (isLandRow(e) && !owned.includes(e.id)) groups.add(typeof e.parcel === 'string' ? `p:${e.parcel}` : e.id);
  assert.equal(signs.length, groups.size);
  // survey stakes at every parcel's corners: a rectangle has 4, an L or a step more; every group has its own
  const corners = parcelCorners(owned);
  const per = new Map();
  for (const c of corners) per.set(c.group, (per.get(c.group) ?? 0) + 1);
  assert.equal(per.size, groups.size);
  for (const n of per.values()) assert.ok(n >= 4 && n % 2 === 0, 'a closed outline');
  // an old parcel counts as owned when all of its tiles are (whichever rows own it): ownedLand by geometry
  const ids = [...E.keys()];
  const all = ownedLand(ids);
  for (const id of ids) assert.ok(all.has(id));
  // a fixture: a big row covering two small ones; owning the big one owns both small ones
  const fx = [{ id: 'w5t_small_a', rects: [[2, 2, 2, 2]], retired: true }, { id: 'w5t_small_b', rects: [[4, 2, 2, 2]], retired: true },
    { id: 'w5t_big', rects: [[2, 2, 4, 2]] }];
  try {
    for (const r of fx) Map.prototype.set.call(E, r.id, r);
    assert.equal(parcelCorners(['home']).filter((c) => c.group === 'w5t_big').length, 4, 'a rectangle: four stakes');
    const set = ownedLand(['w5t_big']);
    assert.ok(set.has('w5t_small_a') && set.has('w5t_small_b'));
    assert.ok(!ownedLand(['w5t_small_a']).has('w5t_big'), 'half of it is not all of it');
    // the big row is sold (its tiles for sale, one sign), the retired small rows never on their own
    assert.equal(landTiles(['home'])[2 * 64 + 2], 2, 'sold as part of the big row');
    const s2 = saleSigns(['home']);
    assert.ok(s2.some((s) => s.id === 'w5t_big') && !s2.some((s) => s.id.startsWith('w5t_small')));
    Map.prototype.delete.call(E, 'w5t_big');
    assert.notEqual(landTiles(['home'])[2 * 64 + 2], 2, 'a retired row alone is not for sale');
  } finally { for (const r of fx) Map.prototype.delete.call(E, r.id); }
});

test('wishes L1-2, L2-1, L2-2: the bison, the quail and the spices have their models, files of their own, and icons', () => {
  const need = [];
  if (has('bison')) need.push('animal:bison', 'animal:bison:baby', 'home:bison_range', 'home:bison_range:far');
  if (has('quail')) need.push('animal:quail', 'animal:quail:baby', 'home:quail_coop', 'home:quail_coop:far');
  if (has('spice_mill')) need.push('building:spice_mill', 'building:spice_mill:far');
  if (has('cinnamon_tree')) for (const st of ['sapling', 'young', 'mature', 'ready']) need.push(`tree:cinnamon_tree:${st}`);
  for (const id of ['paprika', 'savory', 'chili', 'cumin']) if (CONTENT.crops.has(id)) for (const s of ['0', '1', '2', '3', '2:far', '3:far', 'giant', 'giant:2']) need.push(`crop:${id}:${s}`);
  for (const k of need) assert.ok(K[k], `model ${k}`);
  if (has('bison')) {
    assert.equal(K['animal:bison'].kind, 'skinned');
    assert.ok(K['animal:bison'].size[1] > K['animal:cow'].size[1], 'a bison stands taller than a cow');
    assert.ok(DUST_ROLLERS.has('bison') && Array.isArray(K['home:bison_range'].dust), 'it rolls in its range\'s wallow');
    assert.ok(BABY_TINT.bison, 'a cinnamon calf');
  }
  if (has('quail')) assert.ok(K['animal:quail'].size[1] < K['animal:chicken'].size[1], 'smaller than a hen');
  if (has('spice_mill')) assert.ok(K['building:spice_mill'].anchors?.windows?.length && K['building:spice_mill'].anchors?.chimney, 'its window glows at night, its chimney smokes');
  // the growth tiers of the new homes (content HOME_GROWTH)
  for (const id of ['bison_range', 'quail_coop']) {
    const row = content.HOME_GROWTH?.homes?.[id];
    if (!row) continue;
    for (let t = 1; t < row.caps.length; t++) assert.ok(K[`home:${id}:g${t * (content.HOME_GROWTH.grow || 1)}`], `${id} grows to tier ${t}`);
  }
  // no boot-pack member: every new file has a '-' in its name (server/static.js packs only names without one)
  const files = new Set(need.map((k) => K[k]?.file).filter(Boolean));
  for (const f of files) assert.ok(/-/.test(path.basename(f)), `${f} loads on first use only`);
  assert.ok(packSpecs(ROOT).every((sp) => !sp.variants), 'the packs leave variants out');
  // models sit in their footprint (a 5 x 4 range is 10 x 8 m)
  for (const [k, w, d] of [['home:bison_range', 10, 8], ['home:quail_coop', 4, 4], ['building:spice_mill', 4, 4]]) {
    if (!K[k]) continue;
    assert.ok(K[k].size[0] <= w + 0.05 && K[k].size[2] <= d + 0.05, `${k} inside its ${w} x ${d} m footprint (${K[k].size})`);
  }
  // every new item and def has its icon
  const ids = ['paprika', 'savory', 'chili', 'cumin', 'cinnamon', 'prairie_hay', 'quail_egg', 'speckled_egg', 'bison_wool', 'bison_down', 'ground_paprika',
    'sharena_sol', 'grill_spice', 'ground_cinnamon', 'lyutenitsa', 'salted_bread', 'village_potatoes', 'quail_canapes', 'cinnamon_rolls', 'spiced_cider',
    'mini_quiche', 'bison_yarn', 'bison_blanket', 'felt_slippers', 'bison', 'quail', 'bison_range', 'quail_coop', 'spice_mill', 'cinnamon_tree'];
  for (const id of ids) if (CONTENT.items?.has?.(id) || defOf(id)) assert.ok(icons.ids[id], `icon ${id}`);
  for (const id of ids) if (icons.ids[id]) assert.ok(fs.existsSync(path.join(ROOT, 'public', 'assets', 'icons', `${id}.png`)) && fs.existsSync(path.join(ROOT, 'public', 'assets', 'icons', '64', `${id}.png`)));
});
