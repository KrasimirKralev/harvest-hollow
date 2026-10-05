// Milestone gating (wave-1 brief §2, wave-2 content brief): all content exists as data, the M1a and M1b slices are
// exactly GDD §10, and nothing of a later milestone than the build's can be bought, ordered, quested, unlocked or
// referenced by live content. Every test here holds for MILESTONE 'M1a', 'M1b' and 'M2' alike, so a flip changes no
// test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT, CONFIG, DAILY_GIFT, TUTORIAL, ALMANAC, COUPLE_CHALLENGE, QUEST_VERBS, STORY_BEATS, MILESTONE, MILESTONES,
  isLive, live, lookup, contentKinds, defOf, unlocksAt, expansionObjects,
} from '../shared/content/index.js';
import { SPECIAL_REFS } from '../shared/content/story.js';
import { LAST_LEVEL, upTo } from './helpers/content.js';

const ids = (list) => list.map((d) => d.id);
/** The defs of a family that a build of milestone `m` plays (by their `m` tag, whatever MILESTONE is now). */
const slice = (fam, m) => ids([...CONTENT[fam].values()].filter((d) => upTo(d.m, m)));

// The owners' wave-4 additions (2026-10-04) sit in level order inside their generated tables: Raspberry (L12) is
// M1a; Roses, Coffee Beans, the Pomegranate Tree, the Rabbit and its Hutch (L13-16) are M1b.
const M1A_CROPS = ['wheat', 'carrot', 'corn', 'strawberry', 'potato', 'tomato', 'sugarcane', 'pumpkin', 'sunflower',
  'cabbage', 'raspberry'];
const M1A = {
  crops: M1A_CROPS,
  trees: ['apple_tree', 'pine', 'cherry_tree'],
  animals: ['chicken', 'cow', 'sheep'],
  homes: ['coop', 'cow_barn', 'pasture'],
  buildings: ['feed_mill', 'mill', 'bakery', 'sawmill', 'dairy', 'compost_bin', 'kitchen', 'preserves', 'weaver',
    'juice_press'],
  expansions: ['home', 'creekside', 'old_orchard', 'cow_hill', 'sunflower_rise'],
  quests: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'b1', 'b2', 'b3', 'c0', 'c1', 'c2', 'c3',
    'd1', 'e1', 'e2', 'e3'],
  collections: [], restoration: [], townProjects: [], decorSets: [],
};
// GDD §10 M1b: L13-25 crops, trees and animals, Sewing / Pie Oven / Chandlery / Packing Table, the Harvest Feast and
// Wedding Cake duets, the Fair and the Barge (chains F, G), Restoration 1-3, decor sets, collections (8 sets), Town
// Projects 1-4, quest chains to L25 (and the Together chain H to L25), every ribbon to L25.
const M1B = {
  crops: [...M1A_CROPS, 'oats', 'rose', 'blueberry', 'cotton', 'coffee', 'lavender', 'onion'],
  // + the Rainbow Tree (wave 4b, an Acorn shop relic of L13): appended after the generated table
  trees: [...M1A.trees, 'orange_tree', 'pomegranate_tree', 'lemon_tree', 'peach_tree', 'pear_tree', 'plum_tree',
    'rainbow_tree'],
  animals: [...M1A.animals, 'bee', 'rabbit', 'pig', 'duck', 'goat', 'horse'],
  homes: [...M1A.homes, 'beehive', 'hutch', 'pig_pen', 'duck_pond', 'goat_yard', 'stable'],
  buildings: ['feed_mill', 'mill', 'bakery', 'sawmill', 'dairy', 'compost_bin', 'kitchen', 'preserves', 'weaver',
    'sewing', 'pie_oven', 'juice_press', 'chandlery', 'packing'],
  expansions: [...M1A.expansions, 'bee_glade', 'fair_lane', 'riverbank', 'pig_woods', 'willow_pond', 'goat_rocks'],
  quests: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'b1', 'b2', 'b3', 'b4', 'b5', 'c0', 'c1',
    'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'd1', 'd2', 'd3', 'd4', 'd5', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'f1',
    'f2', 'f3', 'g1', 'g2', 'g3', 'h1', 'h2', 'h3', 'h4', 'h5'],
  collections: ['recipe_cards', 'butterflies', 'lost_tools', 'feathers', 'heirloom_seeds', 'fossils', 'honey_jars',
    'buttons'],
  restoration: ['greenhouse', 'mill_wheel', 'stone_bridge'],
  townProjects: ['ferry_landing', 'chapel', 'bandstand', 'schoolhouse'],
  decorSets: ['cottage_garden', 'harvest_fair', 'winter_lights'],
};
// GDD §10 M2: L26-40 content (Watermelon, Bell Pepper, Rice; Walnut, Olive, Maple, Cocoa, Fig; Alpaca; Oil Press,
// Sugar Shack, Chocolatier; the remaining recipes and hampers), expansions 5-15, Restoration 4-6, Town Projects 5-24,
// the 4 remaining collection sets, every quest chain to L40: everything but the festivals (M3).
const all = (fam) => ids([...CONTENT[fam].values()]);
const M2 = {
  crops: [...M1B.crops, 'watermelon', 'pepper', 'rice'],
  trees: [...M1B.trees.filter((t) => t !== 'rainbow_tree'), 'walnut_tree', 'olive_tree', 'maple_tree', 'cocoa_tree',
    'fig_tree', 'rainbow_tree'],
  animals: [...M1B.animals, 'alpaca'],
  homes: [...M1B.homes, 'paddock'],
  buildings: [...M1B.buildings, 'oil_press', 'sugar_shack', 'chocolatier'],
  expansions: [...M1B.expansions, 'stable_paddock', 'walnut_grove', 'olive_terrace', 'maple_ridge', 'sunset_hill'],
  quests: all('quests'), collections: all('collections'), restoration: all('restoration'),
  townProjects: all('townProjects'), decorSets: all('decorSets'),
};
const SLICES = { M1a: M1A, M1b: M1B, M2 };

test('the M1a and the M1b slices are exactly GDD §10 (whatever the build plays)', () => {
  for (const [m, want] of Object.entries(SLICES)) {
    for (const [fam, list] of Object.entries(want)) assert.deepEqual(slice(fam, m), list, `${m} ${fam}`);
    const last = LAST_LEVEL[m];
    const recipes = [...CONTENT.recipes.values()].filter((r) => upTo(r.m, m));
    for (const r of recipes) assert.ok(r.unlock <= last, `${m}: recipe ${r.id} at L${r.unlock}`);
    assert.deepEqual(recipes.filter((r) => r.duet).map((r) => r.id).sort(),
      m === 'M1a' ? ['sweetheart_cake'] : ['harvest_feast', 'sweetheart_cake', 'wedding_cake'], `${m} duets`);
    const shopDecor = [...CONTENT.decor.values()].filter((d) => upTo(d.m, m) && d.shop);
    for (const d of shopDecor) assert.ok(d.unlock <= last, `${m}: decor ${d.id} at L${d.unlock}`);
    assert.equal(shopDecor.some((d) => d.tier === 'grand'), m === 'M2', `${m}: Grand decor is M2`);
    assert.ok(shopDecor.some((d) => d.tier === 'acorn'), `${m}: Acorn decor is in`);
    assert.equal(CONTENT.barn.filter((b) => upTo(b.m, m)).length, { M1a: 3, M1b: 7, M2: 10 }[m], `${m} barn upgrades`);
    assert.deepEqual([...CONTENT.tools.values()].filter((t) => upTo(t.m, m) && t.cost > 0).map((t) => t.id),
      { M1a: ['big_watering_can', 'wide_sickle'], M1b: ['big_watering_can', 'wide_sickle', 'seed_spreader'],
        M2: ['big_watering_can', 'wide_sickle', 'seed_spreader', 'grand_sickle'] }[m]);
  }
  // pets are M1b (their goods and homes wait for them, wave-1 QA RC-30); the Hearts shop waits for M2
  for (const id of ['dog_biscuit', 'cat_treat']) assert.equal(CONTENT.recipes.get(id).m, 'M1b', id);
  for (const id of ['dog_house', 'cat_basket']) assert.equal(CONTENT.decor.get(id).m, 'M1b', id);
  assert.equal(CONTENT.features.get('pets').m, 'M1b');
  // the build plays its own slice
  assert.ok(Object.hasOwn(SLICES, MILESTONE), `MILESTONE ${MILESTONE} has an expected slice here`);
  for (const [fam, list] of Object.entries(SLICES[MILESTONE])) assert.deepEqual(ids(live(fam)), list, `live ${fam}`);
});

test('later milestones exist as data for every family', () => {
  // before the M2 build every family has later data; the M2 build leaves only the festivals (M3) for later
  const fams = MILESTONE === 'M2' ? ['ribbons', 'festivals'] : ['crops', 'trees', 'animals', 'buildings', 'recipes',
    'decor', 'expansions', 'quests', 'ribbons', 'collections', 'restoration', 'townProjects', 'decorSets'];
  for (const fam of fams) {
    assert.ok([...CONTENT[fam].values()].some((d) => !isLive(d)), `${fam} has data beyond ${MILESTONE}`);
  }
  assert.equal(CONTENT.levels.length, 40);
});

test('lookup() refuses every non-live def of every family (so no action can name one)', () => {
  for (const fam of contentKinds().filter((k) => k !== 'placeables')) {
    for (const d of CONTENT[fam].values()) assert.equal(lookup(fam, d.id) !== undefined, isLive(d), `${fam}.${d.id}`);
  }
  for (const d of CONTENT.recipes.values()) if (!isLive(d)) assert.equal(lookup('items', d.id) !== undefined,
    isLive(CONTENT.items.get(d.id)));
  // M2 placeables stay out of reach until the M2 build
  for (const id of ['paddock', 'alpaca', 'oil_press', 'walnut_tree', 'grand_windmill', 'big_stump']) {
    assert.equal(lookup('placeables', id) !== undefined, MILESTONE === 'M2', id);
  }
  assert.equal(lookup('placeables', 'beehive') !== undefined, MILESTONE !== 'M1a');
});

test('no live def references a def of a later milestone', () => {
  const liveItem = (id) => isLive(CONTENT.items.get(id));
  for (const r of live('recipes')) for (const i of Object.keys(r.inputs)) assert.ok(liveItem(i), `${r.id} <- ${i}`);
  for (const a of live('animals')) {
    for (const k of ['product', 'premium']) assert.ok(liveItem(a[k]), `${a.id}.${k}`);
    if (a.feed) assert.ok(isLive(CONTENT.feeds.get(a.feed)), `${a.id}.feed`);
    if (a.bottle) assert.ok(liveItem(a.bottle), `${a.id}.bottle`);
    for (const h of a.homes) assert.ok(isLive(CONTENT.homes.get(h)), `${a.id}.home`);
  }
  for (const t of live('trees')) assert.ok(liveItem(t.product), t.id);
  const sourceOf = (it) => defOf(it.source) ?? CONTENT.crops.get(it.source) ?? CONTENT.recipes.get(it.source)
    ?? CONTENT.feeds.get(it.source);
  for (const it of live('items')) assert.ok(isLive(sourceOf(it)), `${it.id} comes from ${it.source}`);
  for (const q of live('quests')) {
    for (const t of q.tasks) {
      const refs = Array.isArray(t.ref) ? t.ref : [t.ref];
      for (const ref of refs) {
        const special = QUEST_VERBS[t.verb].refs.includes(`special:${ref}`);
        assert.ok(special ? isLive({ m: SPECIAL_REFS[ref] })
          : isLive(defOf(ref) ?? CONTENT.items.get(ref) ?? CONTENT.crops.get(ref)
          ?? CONTENT.expansions.get(ref)), `${q.id}: ${t.verb} ${ref}`);
      }
    }
    for (const id of [...(q.rewards.decor ?? []), ...(q.rewards.gift ?? []),
      ...(q.rewards.giftAtStart ?? [])]) assert.ok(isLive(defOf(id)), `${q.id} reward ${id}`);
    for (const id of Object.keys(q.rewards.items ?? {})) assert.ok(liveItem(id), `${q.id} reward item ${id}`);
    if (q.rewards.beat) assert.ok(isLive(STORY_BEATS.find((b) => b.id === q.rewards.beat)), `${q.id} beat`);
  }
  for (const e of live('expansions')) {
    for (const t of e.proof) {
      for (const ref of [t.ref].flat()) {
        const special = QUEST_VERBS[t.verb].refs.includes(`special:${ref}`);
        assert.ok(special ? isLive({ m: SPECIAL_REFS[ref] }) : isLive(CONTENT.items.get(ref) ?? defOf(ref)),
          `${e.id} proof ${t.verb} ${ref}`);
      }
    }
    for (const o of expansionObjects(e.id)) assert.ok(isLive(defOf(o.def)), `${e.id}: ${o.def}`);
  }
  for (const o of CONFIG.START.objects) assert.ok(isLive(defOf(o.def)), o.def);
  for (const n of live('npcs')) for (const id of n.likes) assert.ok(liveItem(id), `${n.id} likes ${id}`);
  for (const d of DAILY_GIFT.days) if (d.decor && d.decor !== 'season') assert.ok(isLive(CONTENT.decor.get(d.decor)));
  for (const id of Object.values(DAILY_GIFT.seasonDecor)) assert.ok(isLive(CONTENT.decor.get(id)), id);
  for (const step of [...TUTORIAL.fields, ...TUTORIAL.barnyard, ...TUTORIAL.together]) {
    if (step.quest) assert.ok(isLive(CONTENT.quests.get(step.quest)), step.id);
  }
  for (const t of ALMANAC.templates.filter(isLive)) assert.ok(t.unlock <= LAST_LEVEL[MILESTONE], t.id);
  assert.ok(COUPLE_CHALLENGE.templates.filter(isLive).length >= 4);
  for (const c of live('collections')) assert.ok(isLive(CONTENT.decor.get(c.display)), `${c.id} display`);
  for (const p of live('townProjects')) assert.ok(isLive(CONTENT.decor.get(p.souvenir)), `${p.id} souvenir`);
  for (const set of live('decorSets')) {
    for (const id of set.pieces) assert.ok(isLive(CONTENT.decor.get(id)), `${set.id} ${id}`);
  }
  for (const p of live('restoration')) {
    for (const b of p.bundles) {
      for (const sl of b.slots) if (sl.item) assert.ok(liveItem(sl.item), `${p.id}.${b.id} ${sl.item}`);
    }
  }
});

test('unlock banners only ever list live things', () => {
  for (let L = 1; L <= 40; L++) {
    for (const u of unlocksAt(L)) {
      const d = u.family === 'barn' ? CONTENT.barn[Number(u.id) - 1] : CONTENT[u.family].get(u.id);
      assert.ok(isLive(d), `${u.family}.${u.id} at L${L}`);
    }
  }
  assert.deepEqual(unlocksAt(LAST_LEVEL[MILESTONE] + 1), [], `nothing after L${LAST_LEVEL[MILESTONE]} in ${MILESTONE}`);
  assert.ok(MILESTONES.indexOf(MILESTONE) >= 0);
});
