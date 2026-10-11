// The owners' wish list of 2026-10-06 (wave 5), content half: the spices and their Spice Mill, Quail, Bison, the
// pen babies' numbers, and the land sold as fewer, bigger parcels with the old -> new map. The first test is the
// live-farm guard: nothing the couple already reached may move (levels, E, prices of what exists).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT, PEN_BABIES, HOME_GROWTH, LAND_MIGRATION, itemOf, usesOf, validateContent, isLive, levelRow, plotCapOf,
  parcelOf, parcelOfPiece, landAfterMigration, parcelsOwned, nextParcel, proofAfterMigration, expansionObjects,
  pluralOf, featureOf, unlocksAt, animalOf,
} from '../shared/content/index.js';
import BG_NAMES from '../public/js/i18n/bg/names.js';
import BG_TEXT from '../public/js/i18n/bg/text.js';

const NEW = {
  crops: ['paprika', 'savory', 'chili', 'cumin'], trees: ['cinnamon_tree'], animals: ['quail', 'bison'],
  homes: ['quail_coop', 'bison_range'], feeds: ['prairie_hay'], buildings: ['spice_mill'],
  recipes: ['ground_paprika', 'sharena_sol', 'grill_spice', 'ground_cinnamon', 'lyutenitsa', 'salted_bread',
    'village_potatoes', 'cinnamon_rolls', 'spiced_cider', 'quail_canapes', 'mini_quiche', 'bison_yarn', 'bison_blanket',
    'felt_slippers'],
};
const NEW_ITEMS = ['cinnamon', 'quail_egg', 'speckled_egg', 'bison_wool', 'bison_down'];
const PARCELS = ['creek_hill', 'orchard_lane', 'sunny_glade', 'riverside_woods', 'willow_meadow', 'rocky_grove',
  'sunset_ridge'];

test('live-farm guard: the level table, E and the prices of what exists did not move', () => {
  // [level, cumulative XP, E] before wave 5 (= before wave 4: economy-model.mjs --json at f3863f5)
  const BEFORE = [[5, 680, 9300], [10, 7960, 25_000], [12, 15_160, 40_000], [15, 45_060, 70_000],
    [17, 110_060, 89_000], [20, 248_060, 120_000], [25, 710_060, 170_000], [30, 1_870_060, 220_000],
    [35, 3_560_060, 270_000], [40, 5_730_060, 320_000]];
  for (const [L, xp, E] of BEFORE) assert.deepEqual([levelRow(L).xp, levelRow(L).E], [xp, E], `L${L}`);
  assert.equal(CONTENT.homes.get('cow_barn').cost, 5300);
  assert.equal(CONTENT.buildings.get('kitchen').cost, 14_000);
  assert.equal(CONTENT.items.get('egg').sell, itemOf('egg').sell);
  // the plot cap stays +6 per land PIECE owned (a parcel of two pieces = +12)
  assert.equal(plotCapOf(17, 3), levelRow(17).plotCap + 18);
});

test('every new def exists, is live, and arrives near the live couple (L15-19, they are L17)', () => {
  for (const [fam, ids] of Object.entries(NEW)) {
    for (const id of ids) {
      const d = CONTENT[fam].get(id);
      assert.ok(d, `${fam}.${id}`);
      assert.ok(isLive(d), `${fam}.${id} is live`);
      assert.ok(d.unlock >= 15 && d.unlock <= 19, `${fam}.${id} at L${d.unlock}`);
    }
  }
  // the owners play it the same day: quail, paprika, savory, the Spice Mill and the bison are open at L17
  for (const id of ['quail', 'bison']) assert.ok(animalOf(id).unlock <= 17, id);
  for (const id of ['paprika', 'savory']) assert.ok(CONTENT.crops.get(id).unlock <= 17, id);
  assert.ok(CONTENT.buildings.get('spice_mill').unlock <= 17);
  assert.deepEqual(CONTENT.animals.get('bison').homes, ['bison_range']);
  assert.deepEqual(CONTENT.animals.get('quail').homes, ['quail_coop']);
  assert.equal(CONTENT.animals.get('bison').feed, 'prairie_hay');
  assert.equal(CONTENT.animals.get('quail').feed, 'chicken_feed');
  assert.equal(CONTENT.homes.get('bison_range').size.join('x'), '5x4', 'a big paddock');
  assert.equal(CONTENT.trees.get('cinnamon_tree').product, 'cinnamon');
  for (const id of NEW.crops) assert.ok(CONTENT.crops.get(id).classes.includes('spice'), id);
  for (const h of ['quail_coop', 'bison_range']) assert.ok(HOME_GROWTH.homes[h], `${h} grows with its flock`);
  assert.deepEqual(validateContent(), []);
});

test('every new good has a source and real uses: raw goods two (R4), the Spice Mill grinds every spice', () => {
  const raws = [...NEW.crops, 'cinnamon', 'quail_egg', 'bison_wool'];
  for (const id of [...raws, ...NEW_ITEMS, ...NEW.recipes, 'prairie_hay']) {
    const it = itemOf(id);
    assert.ok(it && it.source, `${id} names where it comes from`);
  }
  for (const id of raws) {
    assert.ok(usesOf(id).filter((u) => CONTENT.recipes.has(u)).length >= 1, `${id}: a recipe uses it`);
    assert.ok(usesOf(id).length >= 2, `${id}: two uses (R4)`);
    assert.ok(itemOf(id).sellable, `${id} sells`);
  }
  // spices go into the existing kitchens too (owner: "uses in existing recipes")
  const elsewhere = NEW.recipes.filter((r) => CONTENT.recipes.get(r).building !== 'spice_mill'
    && Object.keys(CONTENT.recipes.get(r).inputs).some((i) => [...NEW.crops, 'cinnamon', 'sharena_sol',
      'ground_cinnamon'].includes(i)));
  assert.ok(elsewhere.length >= 4, elsewhere.join(', '));
  assert.deepEqual(CONTENT.recipes.get('sharena_sol').inputs, { savory: 2, ground_paprika: 1 }, 'шарена сол');
  // bison wool becomes a warm blanket (owner's example)
  assert.ok(Object.hasOwn(CONTENT.recipes.get('bison_blanket').inputs, 'bison_yarn'));
  assert.equal(pluralOf('Quail', 3), 'Quail');
  assert.equal(pluralOf('Bison', 2), 'Bison');
  assert.equal(pluralOf('Paprika', 5), 'Paprika');
});

test('babies in the pen: from about L8, cheap (one baby food), about the species\' baby time, every species but bees', () => {
  assert.equal(PEN_BABIES.unlock, 8);
  assert.equal(PEN_BABIES.cost, 'bottle');
  assert.equal(PEN_BABIES.qty, 1);
  assert.equal(PEN_BABIES.timeBp, 10_000);
  assert.ok(!PEN_BABIES.species.includes('bee'));
  for (const a of CONTENT.animals.values()) {
    if (a.id === 'bee') continue;
    assert.ok(PEN_BABIES.species.includes(a.id), `${a.id} can have babies in its pen`);
    assert.ok(itemOf(a.bottle), `${a.id} has a baby food`);
  }
  assert.ok(featureOf('pen_babies').unlock === PEN_BABIES.unlock);
});

test('land: 7 parcels (+ the Homestead) over the same 16 pieces, connected, in order, priced as milestones', () => {
  const pars = [...CONTENT.parcels.values()];
  assert.deepEqual(pars.map((p) => p.id), ['home', ...PARCELS]);
  assert.deepEqual(pars.map((p) => p.unlock), [1, 5, 9, 13, 17, 21, 27, 33]);
  const pieces = pars.flatMap((p) => p.pieces);
  assert.deepEqual(pieces.slice().sort(), [...CONTENT.expansions.keys()].sort(), 'every piece exactly once');
  for (const p of pars.slice(1)) {
    assert.ok(p.pieces.length >= 2, `${p.id} is bigger than a piece`);
    assert.ok(p.cost > 0 && p.proof.length >= 1 && p.proofText && p.reveals, p.id);
    for (const id of p.pieces) assert.equal(LAND_MIGRATION[id], p.id);
  }
  // the first parcel arrives before the Sawmill: no Planks
  assert.deepEqual([parcelOf('creek_hill').planks, parcelOf('creek_hill').crates], [0, 0]);
  // a piece keeps its number (its debris ids) and its objects
  assert.deepEqual(expansionObjects('fair_lane').map((o) => o.id).slice(0, 2), ['exp6.0', 'exp6.1']);
  assert.equal(parcelOfPiece('willow_pond').id, 'willow_meadow');
  assert.equal(parcelOfPiece('willow_pond').unlock, CONTENT.expansions.get('willow_pond').unlock);
  // the level-up banner lists the parcel, never its pieces
  assert.ok(unlocksAt(5).some((u) => u.family === 'parcels' && u.id === 'creek_hill'));
  assert.ok(!unlocksAt(5).some((u) => u.family === 'expansions'));
});

test('land migration: partial ownership in the player\'s favour, nothing lost, proofs carried (the owners\' save)', () => {
  // the owners' real save (2026-10-06, .scratch/box-save): L17, these pieces, the Sunflower Rise card opened
  const owned = ['home', 'creekside', 'old_orchard', 'cow_hill'];
  const after = landAfterMigration(owned);
  assert.deepEqual(after, ['home', 'creekside', 'old_orchard', 'cow_hill', 'fair_lane']);
  for (const id of owned) assert.ok(after.includes(id), `${id} kept`);
  assert.deepEqual(parcelsOwned(after), ['home', 'creek_hill', 'orchard_lane']);
  assert.equal(nextParcel(after).id, 'sunny_glade');
  assert.deepEqual(proofAfterMigration({ sunflower_rise: { at: 1_791_219_730_146, n: {} } }, after),
    { sunny_glade: { at: 1_791_219_730_146, n: {} } });
  // progress lands on the parcel's matching task; two pieces merge (earliest start, larger count)
  assert.deepEqual(proofAfterMigration({ riverbank: { at: 50, n: { 0: 2 } }, pig_woods: { at: 40, n: { 0: 4 } } },
    after), { riverside_woods: { at: 40, n: { 0: 2, 1: 4 } } });
  // a fresh farm and a fully migrated farm are fixed points; an owned parcel's old card is dropped
  assert.deepEqual(landAfterMigration(['home']), ['home']);
  assert.deepEqual(landAfterMigration(after), after);
  assert.deepEqual(proofAfterMigration({ creekside: { at: 1, n: { 0: 3 } } }, after), {});
  // every piece of a later save maps too: 7 pieces owned (the old L17 schedule) -> 8, never fewer
  const old17 = ['home', 'creekside', 'old_orchard', 'cow_hill', 'sunflower_rise', 'bee_glade', 'fair_lane', 'riverbank'];
  assert.deepEqual(landAfterMigration(old17).slice().sort(), [...old17, 'pig_woods'].sort());
});

test('Bulgarian: every new name, parcel and card has natural Bulgarian with its grammar forms', () => {
  const N = BG_NAMES.names;
  const ids = [...Object.values(NEW).flat(), ...NEW_ITEMS, ...PARCELS];
  for (const id of ids) {
    const e = N[id];
    assert.ok(e && /[а-я]/i.test(e.name) && !/[a-z]/i.test(e.name), `${id}: a Bulgarian name`);
    if (e.g === 'm' && !e.unit && !e.proper) assert.ok(e.count, `${id}: count form`);
    if (!e.proper) assert.ok(e.def, `${id}: definite form`);
  }
  for (const f of ['pen_babies', 'dog_stay', 'spices']) {
    assert.ok(N[`features:${f}`], `feature ${f} name`);
    assert.ok(BG_TEXT.features[f]?.card?.title && BG_TEXT.features[f].card.text, `feature ${f} card`);
  }
  for (const id of PARCELS) {
    assert.ok(BG_TEXT.parcels?.[id]?.proofText, `${id} proofText`);
    assert.ok(BG_TEXT.parcels?.[id]?.reveals, `${id} reveals`);
  }
  assert.equal(N.sharena_sol.name, 'Шарена сол');
  assert.equal(N.paprika.name, 'Червен пипер');
  assert.equal(N.savory.name, 'Чубрица');
});
