// The owners' wish list of 2026-10-04 (wave 4), content half: the new crops, tree, animal, feed and recipes, the
// Fertilizer, the Homestead upgrade tiers, the decor resale shares, the weeds' reward, perk Acorn prices, pet breeds,
// the look catalog and the drip-fed cards. The first test is the live-farm guard: nothing the couple already reached
// may move (levels, E, prices of what exists).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT, GROWTH, MARKET, PERKS, PETS, UPGRADES, WEEDS, AVATAR_LOOKS, COOP, itemOf, usesOf, validateContent, isLive,
  levelRow, live,
} from '../shared/content/index.js';

const NEW = {
  crops: ['raspberry', 'rose', 'coffee'], trees: ['pomegranate_tree'], animals: ['rabbit'], homes: ['hutch'],
  feeds: ['rabbit_greens'],
  recipes: ['fertilizer', 'raspberry_jam', 'raspberry_tart', 'rose_jelly', 'rose_candle', 'pomegranate_juice',
    'grenadine', 'farm_coffee', 'coffee_cake', 'angora_yarn', 'angora_mittens', 'bunny_slippers'],
};
// the model's own rounding (economy-model.mjs §1); a tool-side helper, so float math is fine here
const nice = (n) => {
  if (n < 20) return Math.max(1, Math.round(n));
  if (n < 100) return Math.round(n / 5) * 5;
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
};

test('live-farm guard: the level table and E did not move (the new defs stay out of E(L))', () => {
  // [level, cumulative XP, E] before wave 4 (economy-model.mjs --json at f3863f5)
  const BEFORE = [[5, 680, 9300], [10, 7960, 25_000], [12, 15_160, 40_000], [15, 45_060, 70_000],
    [20, 248_060, 120_000], [25, 710_060, 170_000], [30, 1_870_060, 220_000], [35, 3_560_060, 270_000],
    [40, 5_730_060, 320_000]];
  for (const [L, xp, E] of BEFORE) assert.deepEqual([levelRow(L).xp, levelRow(L).E], [xp, E], `L${L}`);
  // and a few prices that hang off E(L)
  assert.equal(CONTENT.homes.get('cow_barn').cost, 5300);
  assert.equal(CONTENT.buildings.get('kitchen').cost, 14_000);
  assert.equal(CONTENT.quests.get('a10').coins > 0, true);
});

test('every new def exists, is live, and arrives near the live couple (L10-16)', () => {
  for (const [fam, ids] of Object.entries(NEW)) {
    for (const id of ids) {
      const d = CONTENT[fam].get(id);
      assert.ok(d, `${fam}.${id}`);
      assert.ok(isLive(d), `${fam}.${id} is live`);
      assert.ok(d.unlock >= 10 && d.unlock <= 16, `${fam}.${id} at L${d.unlock}`);
    }
  }
  assert.equal(CONTENT.crops.get('rose').name, 'Roses');
  assert.equal(CONTENT.crops.get('coffee').name, 'Coffee Beans');
  assert.deepEqual(CONTENT.animals.get('rabbit').homes, ['hutch']);
  assert.equal(CONTENT.animals.get('rabbit').feed, 'rabbit_greens');
  assert.equal(CONTENT.animals.get('rabbit').product, 'angora_wool');
  assert.equal(CONTENT.trees.get('pomegranate_tree').product, 'pomegranate');
  assert.deepEqual(validateContent(), []);
});

test('every new good has a source (item hints) and at least one recipe use; raw goods two', () => {
  const raws = ['raspberry', 'rose', 'coffee', 'pomegranate', 'angora_wool'];
  for (const id of [...raws, 'cloud_angora', ...NEW.recipes]) {
    const it = itemOf(id);
    assert.ok(it, `item ${id}`);
    assert.ok(it.source, `${id} names where it comes from`);
  }
  for (const id of raws) {
    const recipeUses = usesOf(id).filter((u) => CONTENT.recipes.has(u));
    assert.ok(recipeUses.length >= 1, `${id}: a recipe uses it`);
    assert.ok(usesOf(id).length >= 2, `${id}: two uses (R4)`);
    assert.ok(itemOf(id).sellable, `${id} sells`);
  }
  // Rabbit Greens are made of carrots and greens (root + veg classes)
  assert.deepEqual(CONTENT.feeds.get('rabbit_greens').classes.map((c) => c.cls), ['root', 'veg']);
});

test('Fertilizer: a Compost Bin consumable that is clearly better than Compost on a long crop', () => {
  const r = CONTENT.recipes.get('fertilizer');
  assert.equal(r.building, 'compost_bin');
  assert.deepEqual(r.inputs, { compost: 2, egg: 1 });
  const it = itemOf('fertilizer');
  assert.equal(it.name, 'Fertilizer');
  assert.equal(it.kind, 'consumable');
  assert.equal(it.sellable, false);
  assert.equal(it.orderable, false);
  const F = GROWTH.fertilizer;
  assert.equal(F.item, 'fertilizer');
  assert.ok(F.timeBp > 0 && F.timeBp <= 3000, 'a quarter sooner, never more than the floor allows');
  assert.ok(F.bonusUnits > GROWTH.compost.bonusUnits, 'more than Compost');
  assert.ok(F.unlock >= CONTENT.buildings.get('compost_bin').unlock && F.unlock === r.unlock);
});

test('Homestead upgrades: four targets, three tiers each, ordered, priced from E(L), all first tiers by L11', () => {
  assert.deepEqual(Object.keys(UPGRADES).sort(), ['bench', 'farmhouse', 'market_stand', 'well']);
  const HOURS = { farmhouse: 0.6, well: 0.3, market_stand: 0.4, bench: 0.2 };
  const BONUS = { farmhouse: ['barnCap', 'restedBp'], well: ['waterBp'], market_stand: ['demandUnits', 'sellBp'],
    bench: ['goldenMs'] };
  for (const [t, u] of Object.entries(UPGRADES)) {
    assert.ok(u.name && Array.isArray(u.defs) && u.defs.length, t);
    for (const d of u.defs) assert.ok(CONTENT.landmarks.get(d) || CONTENT.decor.get(d), `${t}: def ${d}`);
    assert.equal(u.tiers.length, 3, t);
    assert.ok(u.tiers[0].unlock <= 11, `${t}: the live couple (L11) can start`);
    let prev = null;
    for (const row of u.tiers) {
      assert.ok(row.name && row.text && row.look, `${t}: names`);
      assert.equal(row.coins, nice(levelRow(row.unlock).E * HOURS[t]), `${t} ${row.name}: E-hours price`);
      for (const [item, n] of Object.entries(row.items)) {
        assert.ok(itemOf(item) && Number.isSafeInteger(n) && n > 0, `${t}: ${item}`);
        assert.ok(row.unlock >= itemOf(item).unlock, `${t}: ${item} exists by L${row.unlock}`);
      }
      for (const k of Object.keys(row.bonus)) assert.ok(BONUS[t].includes(k), `${t}: bonus key ${k}`);
      if (prev) {
        assert.ok(row.unlock > prev.unlock && row.coins > prev.coins, `${t}: tiers climb`);
        for (const k of Object.keys(prev.bonus)) assert.ok(row.bonus[k] >= prev.bonus[k], `${t}: ${k} never drops`);
      }
      prev = row;
    }
  }
  // small, sensible bonuses: never more than a Golden Hour's half, a 2 % sale edge, 7.5 % more watering
  assert.ok(UPGRADES.bench.tiers.at(-1).bonus.goldenMs <= COOP.goldenHour.durationMs / 2);
  assert.ok(UPGRADES.market_stand.tiers.at(-1).bonus.sellBp <= 200);
  assert.ok(UPGRADES.well.tiers.at(-1).bonus.waterBp <= GROWTH.water.cropBp / 2);
});

test('decor resale: a share of the price, never a loop; weeds pay a tiny capped reward', () => {
  const R = MARKET.refunds;
  assert.ok(R.decorBp < 10_000 && R.giftDecorBp === 0, 'paid decor half back, gifts nothing (GDD §9 #51)');
  assert.ok(WEEDS.coins > 0 && WEEDS.coins <= 5 && WEEDS.dailyCap > 0 && WEEDS.dailyCap <= 50);
  assert.equal(WEEDS.xp, undefined, 'no XP for weeds');
});

test('perks: Acorn respec and single-perk refund prices', () => {
  assert.ok(Number.isSafeInteger(PERKS.respecAcorns) && PERKS.respecAcorns > 0);
  assert.ok(Number.isSafeInteger(PERKS.refundAcornsPerPoint) && PERKS.refundAcornsPerPoint > 0);
  // taking back the most expensive perk never costs more than a full respec
  assert.ok(PERKS.refundAcornsPerPoint * Math.max(...PERKS.costs) <= PERKS.respecAcorns);
});

test('pets: three breeds a kind (the owners\' list), with swatches; sleep at night', () => {
  const breeds = Object.fromEntries(PETS.kinds.map((k) => [k.id, k.breeds.map((b) => b.id)]));
  // the first breed is the look of a pet adopted before wave 4: today's models are a Shiba Inu and an orange tabby
  assert.deepEqual(breeds, { dog: ['shiba', 'husky', 'shepherd'], cat: ['orange', 'black', 'white'] });
  for (const k of PETS.kinds) {
    for (const b of k.breeds) for (const c of ['coat', 'accent', 'eyes']) assert.match(b[c], /^#[0-9A-F]{6}$/i);
  }
  assert.deepEqual(PETS.breedChange, { coins: 0, acorns: 0 });
  assert.ok(PETS.sleep.from && PETS.sleep.to);
});

test('look catalog: unique ids, valid swatches, defaults inside the catalog', () => {
  const ID_RE = /^[a-z][a-z0-9_]{0,23}$/;
  const HEX = /^#[0-9A-F]{6}$/;
  for (const k of ['bodies', 'hair', 'hats', 'hairColors', 'skinTones', 'outfitColors']) {
    const ids = AVATAR_LOOKS[k].map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, `${k}: unique`);
    for (const x of AVATAR_LOOKS[k]) assert.ok(ID_RE.test(x.id) && x.name, `${k}.${x.id}`);
    if (!['bodies', 'hair', 'hats'].includes(k)) for (const x of AVATAR_LOOKS[k]) assert.match(x.hex, HEX);
  }
  for (const [slot, d] of Object.entries(AVATAR_LOOKS.defaults)) {
    assert.ok(AVATAR_LOOKS.bodies.some((b) => b.id === d.body), `${slot} body`);
    assert.ok(AVATAR_LOOKS.hair.some((b) => b.id === d.hair), `${slot} hair`);
    assert.ok(AVATAR_LOOKS.hats.some((b) => b.id === d.hat), `${slot} hat`);
    for (const c of ['hairColor', 'skin', 'top', 'bottom']) assert.match(d[c], HEX, `${slot} ${c}`);
  }
});

test('a drip-fed card for each new thing, phone wording where a key or a mouse button is named', () => {
  const ids = ['wild_weeds', 'look_editor', 'rotate_buildings', 'homestead_upgrades', 'camera_tilt', 'sell_decor',
    'fertilizer', 'pet_breeds'];
  for (const id of ids) {
    const f = CONTENT.features.get(id);
    assert.ok(f && isLive(f) && f.card?.title && f.card?.text, id);
    assert.ok(f.unlock >= 2, `${id}: not on the first evening's minute one`);
    for (const t of [f.card.text, f.card.touchText ?? '']) assert.ok(t.length <= 140, `${id}: one card, short`);
    if (/\b(R|Shift|Right-drag|Click)\b/.test(f.card.text)) assert.ok(f.card.touchText, `${id}: touchText`);
  }
  // they reach a farm that is already past their level: the couple's farm is L11-12
  assert.ok(live('features').filter((f) => ids.includes(f.id)).every((f) => f.unlock <= 11));
});
