#!/usr/bin/env node
// Harvest Hollow economy model (design tool, not game code).
// Single source of every number in docs/GDD.md. Run:
//   node tools/economy-model.mjs            -> prints all checks (exit 1 on any failure)
//   node tools/economy-model.mjs --md       -> prints the markdown tables used in the GDD
//   node tools/economy-model.mjs --json     -> prints the derived content as JSON (seed for shared/content/*.js)
// Every value is derived from a handful of formulas in section 1. Tune those, never individual numbers.

const ARGS = new Set(process.argv.slice(2));

// ---------------------------------------------------------------------------------------------
// 1. Formulas and constants
// ---------------------------------------------------------------------------------------------
const C = {
  CROP_R: 4.33,         // gross coins per minute of grow time of a level-1 session crop (v2: was 8 x m^0.85)
  SHORT_EXP: 1.0,       // gross ~ minutes^1.0 up to 60 min: no attention premium, so Wheat never dominates (v2, M2)
  LONG_EXP: 0.45,       // gross ~ hours^0.45 beyond 60 min (long crops pay more per cycle, less per hour: "away" crops)
  CROP_LVL: 0.015,      // +1.5 % crop value per unlock level (newer crops are slightly better; mastery keeps old ones alive)
  SEED_SHARE: 0.4,      // seed price = 40 % of the plot's gross
  TREE_MULT: 1.6,       // a tree harvest is worth 1.6 x a crop plot of the same cycle (tree = 2x2 tiles, no seed, no replant)
  TREE_GROWTH: 1.45,    // price of the n-th tree of one species x 1.45^(n-1) (v2, M8)
  FEED_K: 4,            // time value of feed milling (feed is upkeep: no markup)
  ANIMAL_K: 18,         // time value of an animal cycle (capital + care) (v2, M8: was 12)
  CRAFT_K: 12,          // time value of a machine step: value added = CRAFT_K x minutes^CRAFT_EXP x (1 + CRAFT_LVL (L-1))
  CRAFT_EXP: 0.8,       //   (v2: no input markup, so no recipe can dominate another of its building; see GDD §4.3)
  CRAFT_LVL: 0.015,     //   newer recipes +1.5 % per unlock level, like crops
  MIN_ADD: 0.15,        // R3: every recipe adds >= 15 % to the value of its inputs (long recipes for big inputs)
  XP_DIV: 8,            // 1 XP per 8 coins of value created (harvest gross, collection, craft value added, orders)
  ORDER_MULT: 1.5,      // orders pay 1.5 x the market value of the goods
  STORE_MULT: 2.5,      // the General Store sells raw goods / feed at 2.5 x V (never arbitrage)
};

const round = Math.round;
const nice = (n) => {           // 2 significant digits, then to a multiple of 5 for small values
  if (n < 20) return Math.max(1, round(n));
  if (n < 100) return round(n / 5) * 5;
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return round(n / p) * p;
};
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : n);
const hm = (min) => {
  if (min < 1) return `${round(min * 60)} s`;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

// value a machine adds in `min` minutes for a recipe unlocked at `lvl` (inputs keep their own value)
export function craftTime(min, lvl) {
  return C.CRAFT_K * min ** C.CRAFT_EXP * (1 + C.CRAFT_LVL * (lvl - 1));
}

export function cropGross(min, lvl) {
  const base = min <= 60
    ? C.CROP_R * min ** C.SHORT_EXP
    : C.CROP_R * 60 ** C.SHORT_EXP * (min / 60) ** C.LONG_EXP;
  return base * (1 + C.CROP_LVL * (lvl - 1));
}

// ---------------------------------------------------------------------------------------------
// 2. Content definitions (ids are permanent; see GDD §3)
// ---------------------------------------------------------------------------------------------
// [id, name, unlock, growMin, yield, classes, readyHue, archetype]
const CROPS_RAW = [
  ['wheat', 'Wheat', 1, 1, 2, ['grain'], '#E8B84A', 'tall'],
  ['carrot', 'Carrot', 2, 2, 2, ['root', 'veg'], '#F08A2C', 'root'],
  ['corn', 'Corn', 3, 10, 3, ['grain'], '#F2D04B', 'tall'],
  ['strawberry', 'Strawberry', 4, 60, 3, ['fruit'], '#E83A55', 'bush'],
  ['potato', 'Potato', 5, 240, 3, ['root', 'veg'], '#C9A06A', 'root'],
  ['tomato', 'Tomato', 6, 30, 3, ['veg'], '#E8463A', 'bush'],
  ['sugarcane', 'Sugarcane', 8, 45, 2, ['cane'], '#9BD86A', 'tall'],
  ['pumpkin', 'Pumpkin', 9, 720, 2, ['veg'], '#F2852A', 'ground'],
  ['sunflower', 'Sunflower', 11, 360, 2, ['grain', 'flower'], '#FFD21F', 'flower'],
  ['cabbage', 'Cabbage', 12, 1440, 2, ['veg'], '#B7E36E', 'ground'],
  // owner wish list 2026-10-04 (wave 4): Raspberry (#1), Roses and Coffee Beans (#7) sit in level order; OWNER4 below
  // keeps them out of E(L), so the level table, every E-hour price and every quest reward stay as they were
  ['raspberry', 'Raspberry', 12, 150, 3, ['fruit'], '#C7234A', 'bush'],
  ['oats', 'Oats', 13, 20, 3, ['grain'], '#D8C27A', 'tall'],
  ['rose', 'Roses', 13, 90, 2, ['flower'], '#D6284B', 'flower'],
  ['blueberry', 'Blueberry', 14, 180, 3, ['fruit'], '#4D5BD6', 'bush'],
  ['cotton', 'Cotton', 16, 600, 2, ['fibre'], '#FFFFFF', 'bush'],
  ['coffee', 'Coffee Beans', 16, 300, 3, ['bean'], '#A3262A', 'bush'],
  ['lavender', 'Lavender', 18, 120, 2, ['flower'], '#A98BE0', 'flower'],
  ['onion', 'Onion', 24, 90, 3, ['root', 'veg'], '#E7C8A0', 'root'],
  ['watermelon', 'Watermelon', 27, 960, 2, ['fruit'], '#3E8E3A', 'ground'],
  ['pepper', 'Bell Pepper', 31, 300, 3, ['veg'], '#E03C2E', 'bush'],
  ['rice', 'Rice', 35, 480, 3, ['grain'], '#CFE59A', 'tall'],
];

// [id, name, unlock, cycleMin, yield, productId, productName, flowering]
const TREES_RAW = [
  ['apple_tree', 'Apple Tree', 4, 240, 5, 'apple', 'Apple', true],
  ['pine', 'Pine (woodlot)', 6, 480, 8, 'wood', 'Wood', false],
  ['cherry_tree', 'Cherry Tree', 11, 360, 5, 'cherry', 'Cherry', true],
  ['orange_tree', 'Orange Tree', 13, 480, 6, 'orange', 'Orange', true],
  ['pomegranate_tree', 'Pomegranate Tree', 14, 660, 5, 'pomegranate', 'Pomegranate', true],    // owner wish 7 (wave 4)
  ['lemon_tree', 'Lemon Tree', 15, 480, 6, 'lemon', 'Lemon', true],
  ['peach_tree', 'Peach Tree', 17, 180, 4, 'peach', 'Peach', true],
  ['pear_tree', 'Pear Tree', 19, 600, 6, 'pear', 'Pear', true],
  ['plum_tree', 'Plum Tree', 23, 420, 5, 'plum', 'Plum', true],
  ['walnut_tree', 'Walnut Tree', 26, 720, 6, 'walnut', 'Walnut', false],
  ['olive_tree', 'Olive Tree', 30, 720, 6, 'olive', 'Olive', true],
  ['maple_tree', 'Maple Tree', 34, 600, 6, 'maple_sap', 'Maple Sap', false],
  ['cocoa_tree', 'Cocoa Tree', 36, 960, 6, 'cocoa', 'Cocoa Pod', true],
  ['fig_tree', 'Fig Tree', 39, 540, 5, 'fig', 'Fig', true],
];

// Feed recipes (Feed Mill). Inputs are ingredient CLASSES; value uses the cheapest member.
// [id, name, unlock, min, out, [[classOrItem, qty]]]
const FEEDS_RAW = [
  ['chicken_feed', 'Chicken Feed', 1, 5, 6, [['grain', 3]]],
  ['livestock_feed', 'Livestock Feed', 7, 10, 6, [['grain', 2], ['root', 1]]],
  // owner wish 3 (wave 4): rabbits eat carrots and greens
  ['rabbit_greens', 'Rabbit Greens', 14, 10, 6, [['root', 2], ['veg', 1]]],
  ['pig_slop', 'Pig Slop', 17, 10, 6, [['produce', 2]]],
];

// [id, name, unlock, home, capStart, capMax, feedId|null, feedQty, cycleMin, productId, productName, outQty,
//  babyMin, prizedAt, premiumId, premiumName]
const ANIMALS_RAW = [
  ['chicken', 'Chicken', 1, 'coop', 6, 12, 'chicken_feed', 1, 20, 'egg', 'Egg', 1, 30, 60, 'golden_egg', 'Golden Egg'],
  ['cow', 'Cow', 7, 'cow_barn', 4, 8, 'livestock_feed', 1, 60, 'milk', 'Milk', 1, 120, 40, 'cream_top_milk', 'Cream-Top Milk'],
  ['sheep', 'Sheep', 12, 'pasture', 4, 8, 'livestock_feed', 2, 240, 'wool', 'Wool', 1, 360, 25, 'silk_wool', 'Silk Wool'],
  ['bee', 'Bee Colony', 13, 'beehive', 1, 1, null, 0, 360, 'honey', 'Honey', 1, 0, 25, 'royal_jelly', 'Royal Jelly'],
  // owner wish 3 (2026-10-04, wave 4): rabbits in a hutch, angora wool
  ['rabbit', 'Rabbit', 14, 'hutch', 4, 8, 'rabbit_greens', 1, 120, 'angora_wool', 'Angora Wool', 1, 90, 40, 'cloud_angora', 'Cloud Angora'],
  ['pig', 'Pig', 17, 'pig_pen', 4, 8, 'pig_slop', 1, 240, 'truffle', 'Truffle', 1, 240, 25, 'black_truffle', 'Black Truffle'],
  ['duck', 'Duck', 19, 'duck_pond', 4, 8, 'chicken_feed', 1, 90, 'duck_egg', 'Duck Egg', 1, 60, 40, 'golden_feather', 'Golden Feather'],
  ['goat', 'Goat', 22, 'goat_yard', 4, 8, 'livestock_feed', 2, 180, 'goat_milk', 'Goat Milk', 1, 240, 25, 'aged_goat_cheese', 'Aged Goat Cheese'],
  ['horse', 'Horse', 25, 'stable', 2, 4, 'livestock_feed', 2, 360, 'manure', 'Manure', 2, 480, 20, 'show_ribbon', 'Show Ribbon'],
  ['alpaca', 'Alpaca', 33, 'paddock', 4, 8, 'livestock_feed', 2, 300, 'alpaca_fiber', 'Alpaca Fibre', 1, 360, 25, 'royal_fiber', 'Royal Fibre'],
];

// Production buildings: [id, name, unlock, slotsStart, slotsMax, size, buildHours (price in hours of E(L))]
const BUILDINGS_RAW = [
  ['feed_mill', 'Feed Mill', 1, 3, 6, [3, 3], 0.25],
  ['mill', 'Windmill', 3, 2, 6, [3, 3], 0.4],
  ['bakery', 'Bakery', 4, 2, 6, [3, 3], 0.5],
  ['sawmill', 'Sawmill', 6, 2, 5, [3, 3], 0.5],
  ['dairy', 'Dairy', 7, 2, 6, [3, 3], 0.6],
  ['compost_bin', 'Compost Bin', 8, 1, 3, [2, 2], 0.3],
  ['kitchen', 'Farm Kitchen', 9, 2, 6, [3, 3], 0.6],
  ['preserves', 'Preserves Kitchen', 11, 2, 6, [3, 3], 0.6],
  ['weaver', "Weaver's Shed", 12, 2, 5, [3, 3], 0.6],
  ['sewing', 'Sewing Table', 14, 2, 5, [2, 2], 0.6],
  ['pie_oven', 'Pie Oven', 15, 2, 6, [3, 2], 0.7],
  ['juice_press', 'Juice Press', 6, 2, 6, [2, 2], 0.6],
  ['chandlery', 'Chandlery', 16, 2, 5, [3, 3], 0.7],
  ['packing', 'Packing Table', 20, 2, 4, [3, 2], 0.8],
  ['oil_press', 'Oil Press', 30, 2, 5, [3, 3], 0.8],
  ['sugar_shack', 'Sugar Shack', 34, 2, 4, [3, 3], 0.8],
  ['chocolatier', 'Chocolatier', 36, 2, 5, [3, 3], 0.9],
];

// Recipes: [id, name, building, unlock, minutes, outQty, {inputs}, tier, duet?]
// Tier: T2 intermediate, T3 crafted good, T4 premium. DUET = two-player recipe (solo slow-cook takes 2x).
const RECIPES_RAW = [
  // Windmill
  ['flour', 'Flour', 'mill', 3, 5, 1, { wheat: 3 }, 'T2'],
  ['cornmeal', 'Cornmeal', 'mill', 3, 10, 1, { corn: 2 }, 'T2'],
  ['sugar', 'Sugar', 'mill', 8, 20, 1, { sugarcane: 1 }, 'T2'],
  ['oat_flakes', 'Oat Flakes', 'mill', 13, 10, 1, { oats: 2 }, 'T2'],
  // Bakery
  ['bread', 'Bread', 'bakery', 4, 5, 1, { flour: 1 }, 'T3'],
  ['corn_bread', 'Corn Bread', 'bakery', 4, 30, 1, { cornmeal: 1, egg: 1 }, 'T3'],
  ['carrot_muffin', 'Carrot Muffin', 'bakery', 4, 20, 1, { flour: 1, carrot: 2, egg: 1 }, 'T3'],
  ['pancakes', 'Pancakes', 'bakery', 8, 30, 1, { flour: 1, egg: 2, milk: 1 }, 'T3'],
  ['cookies', 'Cookies', 'bakery', 10, 45, 1, { flour: 1, egg: 1, sugar: 1 }, 'T3'],
  ['blueberry_muffin', 'Blueberry Muffin', 'bakery', 14, 40, 1, { flour: 1, egg: 1, blueberry: 2 }, 'T3'],
  ['granola_bar', 'Granola Bar', 'bakery', 15, 40, 1, { oat_flakes: 1, honey: 1, strawberry: 1 }, 'T3'],
  ['pizza', 'Pizza', 'bakery', 20, 60, 1, { flour: 1, tomato: 2, cheese: 1 }, 'T3'],
  ['walnut_cookies', 'Walnut Cookies', 'bakery', 26, 45, 1, { flour: 1, walnut: 1, butter: 1 }, 'T3'],
  ['olive_bread', 'Olive Bread', 'bakery', 30, 30, 1, { flour: 1, olive: 2 }, 'T3'],
  ['maple_pancakes', 'Maple Pancakes', 'bakery', 34, 30, 1, { flour: 1, egg: 2, maple_syrup: 1 }, 'T3'],
  ['sweetheart_cake', 'Sweetheart Cake', 'bakery', 10, 60, 1, { flour: 2, egg: 2, butter: 1, strawberry: 2 }, 'DUET', true],
  // Sawmill
  ['planks', 'Planks', 'sawmill', 6, 10, 2, { wood: 1 }, 'T2'],
  ['wooden_crate', 'Wooden Crate', 'sawmill', 6, 20, 1, { planks: 2 }, 'T3'],
  ['bird_house', 'Bird House', 'sawmill', 9, 60, 1, { planks: 3 }, 'T3'],
  ['toy_horse', 'Toy Horse', 'sawmill', 12, 120, 1, { planks: 2, yarn: 1 }, 'T3'],
  // Dairy
  ['cream', 'Cream', 'dairy', 7, 20, 1, { milk: 1 }, 'T2'],
  ['butter', 'Butter', 'dairy', 7, 30, 1, { cream: 1 }, 'T2'],
  ['baby_bottle', 'Baby Bottle', 'dairy', 7, 10, 2, { milk: 1 }, 'T2'],
  ['cheese', 'Cheese', 'dairy', 10, 60, 1, { milk: 3 }, 'T3'],
  ['yogurt', 'Strawberry Yogurt', 'dairy', 7, 45, 1, { milk: 1, strawberry: 1 }, 'T3'],
  ['ice_cream', 'Ice Cream', 'dairy', 18, 60, 1, { cream: 1, sugar: 1, blueberry: 1 }, 'T3'],
  ['goat_cheese', 'Goat Cheese', 'dairy', 22, 90, 1, { goat_milk: 2 }, 'T3'],
  // Compost bin (manure route; the collector route is free, see GDD)
  ['compost', 'Compost', 'compost_bin', 25, 120, 3, { manure: 1 }, 'T2'],
  // Kitchen
  ['omelette', 'Omelette', 'kitchen', 9, 20, 1, { egg: 2, milk: 1 }, 'T3'],
  ['veggie_soup', 'Veggie Soup', 'kitchen', 9, 40, 1, { carrot: 2, potato: 1, tomato: 1 }, 'T3'],
  ['pumpkin_soup', 'Pumpkin Soup', 'kitchen', 9, 45, 1, { pumpkin: 2, cream: 1, carrot: 1 }, 'T3'],
  ['popcorn', 'Popcorn', 'kitchen', 10, 30, 1, { corn: 2, butter: 1 }, 'T3'],
  ['dog_biscuit', 'Dog Biscuit', 'kitchen', 10, 15, 1, { flour: 1, egg: 1, milk: 1 }, 'T3'],
  ['cat_treat', 'Cat Treat', 'kitchen', 10, 15, 1, { cream: 1, egg: 1 }, 'T3'],
  ['roasted_seeds', 'Roasted Sunflower Seeds', 'kitchen', 11, 30, 1, { sunflower: 2 }, 'T3'],
  ['coleslaw', 'Coleslaw', 'kitchen', 12, 30, 1, { cabbage: 2, carrot: 2 }, 'T3'],
  ['potato_gratin', 'Potato Gratin', 'kitchen', 12, 60, 1, { potato: 2, cheese: 1, cream: 1 }, 'T3'],
  ['harvest_feast', 'Harvest Feast', 'kitchen', 15, 60, 1, { veggie_soup: 1, corn_bread: 1, apple_pie: 1 }, 'DUET', true],
  ['truffle_pasta', 'Truffle Pasta', 'kitchen', 17, 90, 1, { flour: 1, egg: 1, truffle: 1, butter: 1 }, 'T4'],
  ['french_onion_soup', 'French Onion Soup', 'kitchen', 24, 60, 1, { onion: 2, cheese: 1, bread: 1 }, 'T3'],
  ['watermelon_salad', 'Watermelon Salad', 'kitchen', 27, 45, 1, { watermelon: 2, goat_cheese: 1 }, 'T3'],
  ['potato_chips', 'Potato Chips', 'kitchen', 30, 45, 1, { potato: 2, sunflower_oil: 1 }, 'T3'],
  ['stuffed_peppers', 'Stuffed Peppers', 'kitchen', 31, 60, 1, { pepper: 2, tomato: 1, cheese: 1 }, 'T3'],
  ['maple_fudge', 'Maple Walnut Fudge', 'kitchen', 34, 60, 1, { maple_syrup: 1, walnut: 1, butter: 1 }, 'T3'],
  ['risotto', 'Truffle Risotto', 'kitchen', 35, 90, 1, { rice: 2, truffle: 1, butter: 1 }, 'T4'],
  ['custard', 'Custard', 'kitchen', 19, 45, 1, { duck_egg: 2, milk: 1, sugar: 1 }, 'T3'],
  ['rice_pudding', 'Rice Pudding', 'kitchen', 35, 45, 1, { rice: 2, milk: 1, sugar: 1 }, 'T3'],
  ['hot_cocoa', 'Hot Cocoa', 'kitchen', 36, 30, 1, { chocolate: 1, milk: 1 }, 'T3'],
  ['wedding_cake', 'Wedding Cake', 'kitchen', 25, 120, 1, { flour: 3, egg: 4, butter: 2, sugar: 2, cream: 1 }, 'DUET', true],
  // Preserves
  ['strawberry_jam', 'Strawberry Jam', 'preserves', 11, 60, 1, { strawberry: 3, sugar: 1 }, 'T3'],
  ['ketchup', 'Ketchup', 'preserves', 11, 45, 1, { tomato: 3, sugar: 1 }, 'T3'],
  ['cherry_jam', 'Cherry Jam', 'preserves', 11, 60, 1, { cherry: 3, sugar: 1 }, 'T3'],
  ['sauerkraut', 'Sauerkraut', 'preserves', 12, 240, 1, { cabbage: 2, carrot: 1 }, 'T3'],
  ['orange_marmalade', 'Orange Marmalade', 'preserves', 13, 75, 1, { orange: 3, sugar: 1 }, 'T3'],
  ['blueberry_jam', 'Blueberry Jam', 'preserves', 14, 60, 1, { blueberry: 3, sugar: 1 }, 'T3'],
  ['peach_jam', 'Peach Jam', 'preserves', 17, 60, 1, { peach: 3, sugar: 1 }, 'T3'],
  ['plum_jam', 'Plum Jam', 'preserves', 23, 60, 1, { plum: 3, sugar: 1 }, 'T3'],
  ['fig_jam', 'Fig Jam', 'preserves', 39, 60, 1, { fig: 3, sugar: 1 }, 'T3'],
  ['pickled_peppers', 'Pickled Peppers', 'preserves', 31, 120, 1, { pepper: 3, onion: 1 }, 'T3'],
  // Weaver's Shed
  ['yarn', 'Yarn', 'weaver', 12, 30, 1, { wool: 1 }, 'T2'],
  ['cotton_cloth', 'Cotton Cloth', 'weaver', 16, 45, 1, { cotton: 2 }, 'T2'],
  ['lavender_dye', 'Lavender Dye', 'weaver', 18, 30, 1, { lavender: 2 }, 'T2'],
  ['alpaca_yarn', 'Alpaca Yarn', 'weaver', 33, 40, 1, { alpaca_fiber: 1 }, 'T2'],
  // Sewing Table
  ['scarf', 'Wool Scarf', 'sewing', 14, 60, 1, { yarn: 2 }, 'T3'],
  ['cotton_tote', 'Cotton Tote', 'sewing', 16, 60, 1, { cotton_cloth: 2 }, 'T3'],
  ['picnic_blanket', 'Picnic Blanket', 'sewing', 17, 150, 1, { cotton_cloth: 2, yarn: 1 }, 'T3'],
  ['sweater', 'Sweater', 'sewing', 18, 120, 1, { yarn: 2, lavender_dye: 1 }, 'T3'],
  ['wool_pillow', 'Wool Pillow', 'sewing', 16, 90, 1, { wool: 2, cotton_cloth: 1 }, 'T3'],
  ['quilt', 'Quilt', 'sewing', 20, 240, 1, { cotton_cloth: 3, yarn: 2, lavender_dye: 1 }, 'T4'],
  ['alpaca_plush', 'Alpaca Plush', 'sewing', 33, 90, 1, { alpaca_fiber: 2, cotton_cloth: 1 }, 'T3'],
  ['alpaca_shawl', 'Alpaca Shawl', 'sewing', 33, 180, 1, { alpaca_yarn: 2, lavender_dye: 1 }, 'T4'],
  // Pie Oven
  ['apple_pie', 'Apple Pie', 'pie_oven', 15, 120, 1, { flour: 1, apple: 3, butter: 1 }, 'T3'],
  ['pumpkin_pie', 'Pumpkin Pie', 'pie_oven', 15, 150, 1, { flour: 1, pumpkin: 2, cream: 1, egg: 1 }, 'T3'],
  ['cherry_pie', 'Cherry Pie', 'pie_oven', 15, 120, 1, { flour: 1, cherry: 3, sugar: 1 }, 'T3'],
  ['lemon_cake', 'Lemon Cake', 'pie_oven', 15, 180, 1, { flour: 1, lemon: 2, butter: 1, sugar: 1 }, 'T3'],
  ['blueberry_pie', 'Blueberry Pie', 'pie_oven', 16, 120, 1, { flour: 1, blueberry: 3, butter: 1 }, 'T3'],
  ['peach_cobbler', 'Peach Cobbler', 'pie_oven', 17, 120, 1, { flour: 1, peach: 3, butter: 1 }, 'T3'],
  ['pear_tart', 'Pear Tart', 'pie_oven', 19, 120, 1, { flour: 1, pear: 2, butter: 1 }, 'T3'],
  ['lemon_meringue_pie', 'Lemon Meringue Pie', 'pie_oven', 19, 150, 1, { flour: 1, lemon: 2, duck_egg: 2, sugar: 1 }, 'T3'],
  ['plum_cake', 'Plum Cake', 'pie_oven', 23, 150, 1, { flour: 1, plum: 3, egg: 1, sugar: 1 }, 'T3'],
  ['walnut_honey_cake', 'Walnut Honey Cake', 'pie_oven', 26, 240, 1, { flour: 1, walnut: 2, honey: 1, egg: 1 }, 'T3'],
  ['fig_tart', 'Fig & Goat Cheese Tart', 'pie_oven', 39, 150, 1, { flour: 1, fig: 3, goat_cheese: 1 }, 'T3'],
  ['chocolate_cake', 'Chocolate Cake', 'pie_oven', 36, 180, 1, { flour: 1, chocolate: 1, egg: 2, butter: 1 }, 'T3'],
  // Juice Press
  ['apple_juice', 'Apple Juice', 'juice_press', 6, 30, 1, { apple: 3 }, 'T3'],
  ['orange_juice', 'Orange Juice', 'juice_press', 13, 30, 1, { orange: 3 }, 'T3'],
  ['lemonade', 'Lemonade', 'juice_press', 15, 30, 1, { lemon: 2, sugar: 1 }, 'T3'],
  ['carrot_juice', 'Carrot Juice', 'juice_press', 6, 20, 1, { carrot: 4 }, 'T3'],
  ['pear_nectar', 'Pear Nectar', 'juice_press', 19, 30, 1, { pear: 3 }, 'T3'],
  ['watermelon_juice', 'Watermelon Juice', 'juice_press', 27, 30, 1, { watermelon: 2 }, 'T3'],
  // Chandlery
  ['beeswax', 'Beeswax', 'chandlery', 16, 30, 1, { honey: 1 }, 'T2'],
  ['honey_candle', 'Honey Candle', 'chandlery', 16, 45, 1, { beeswax: 2 }, 'T3'],
  ['lavender_candle', 'Lavender Candle', 'chandlery', 18, 60, 1, { beeswax: 1, lavender: 1 }, 'T3'],
  ['lavender_soap', 'Lavender Soap', 'chandlery', 22, 60, 1, { lavender: 2, goat_milk: 1 }, 'T3'],
  // Packing Table (T4 hampers, assembly only)
  ['breakfast_hamper', 'Breakfast Hamper', 'packing', 20, 90, 1,
    { wooden_crate: 1, pancakes: 1, strawberry_jam: 1, orange_juice: 1 }, 'T4'],
  ['picnic_basket', 'Picnic Basket', 'packing', 23, 180, 1,
    { wooden_crate: 1, bread: 1, cheese: 1, lemonade: 1, picnic_blanket: 1 }, 'T4'],
  ['spa_basket', 'Spa Basket', 'packing', 26, 180, 1,
    { wooden_crate: 1, lavender_soap: 1, lavender_candle: 1, cotton_tote: 1 }, 'T4'],
  ['cozy_winter_gift', 'Cozy Winter Gift', 'packing', 28, 180, 1,
    { wooden_crate: 1, sweater: 1, honey_candle: 1, cookies: 2 }, 'T4'],
  ['harvest_hamper', 'Harvest Festival Hamper', 'packing', 32, 270, 1,
    { wooden_crate: 1, pumpkin_pie: 1, truffle_oil: 1, lavender_candle: 1, walnut_honey_cake: 1 }, 'T4'],
  ['gourmet_hamper', 'Gourmet Hamper', 'packing', 37, 240, 1,
    { wooden_crate: 1, chocolate_cake: 1, goat_cheese: 1, maple_fudge: 1, olive_bread: 1 }, 'T4'],
  // Oil Press
  ['sunflower_oil', 'Sunflower Oil', 'oil_press', 30, 60, 1, { sunflower: 3 }, 'T2'],
  ['olive_oil', 'Olive Oil', 'oil_press', 30, 90, 1, { olive: 4 }, 'T2'],
  ['truffle_oil', 'Truffle Oil', 'oil_press', 32, 180, 1, { truffle: 1, olive_oil: 1 }, 'T4'],
  // Sugar Shack, Chocolatier
  ['maple_syrup', 'Maple Syrup', 'sugar_shack', 34, 60, 1, { maple_sap: 2 }, 'T2'],
  ['chocolate', 'Chocolate', 'chocolatier', 36, 60, 1, { cocoa: 2, sugar: 1, milk: 1 }, 'T2'],
  ['chocolate_truffles', 'Chocolate Truffles', 'chocolatier', 37, 45, 1, { chocolate: 1, cream: 1 }, 'T3'],
  // Owner wish list 2026-10-04 (wave 4): at least one use for every new good (R4 asks two for a raw good), and the
  // Fertilizer (#2): Compost enriched with crushed eggshells, a consumable spread on a plot or a tree
  ['fertilizer', 'Fertilizer', 'compost_bin', 10, 30, 1, { compost: 2, egg: 1 }, 'T2'],
  ['raspberry_jam', 'Raspberry Jam', 'preserves', 12, 70, 1, { raspberry: 3, sugar: 1 }, 'T3'],
  ['raspberry_tart', 'Raspberry Tart', 'pie_oven', 15, 100, 1, { flour: 1, raspberry: 3, butter: 1 }, 'T3'],
  ['rose_jelly', 'Rose Petal Jelly', 'preserves', 13, 90, 1, { rose: 3, sugar: 1 }, 'T3'],
  ['rose_candle', 'Rose Candle', 'chandlery', 16, 50, 1, { beeswax: 1, rose: 2 }, 'T3'],
  ['pomegranate_juice', 'Pomegranate Juice', 'juice_press', 14, 35, 1, { pomegranate: 3 }, 'T3'],
  ['grenadine', 'Grenadine Syrup', 'preserves', 14, 50, 1, { pomegranate: 2, sugar: 1 }, 'T3'],
  ['farm_coffee', 'Farmhouse Coffee', 'kitchen', 16, 25, 1, { coffee: 2, milk: 1 }, 'T3'],
  ['coffee_cake', 'Coffee Cake', 'pie_oven', 16, 160, 1, { flour: 1, coffee: 2, egg: 1, sugar: 1 }, 'T3'],
  ['angora_yarn', 'Angora Yarn', 'weaver', 14, 35, 1, { angora_wool: 1 }, 'T2'],
  ['angora_mittens', 'Angora Mittens', 'sewing', 14, 75, 1, { angora_yarn: 2 }, 'T3'],
  ['bunny_slippers', 'Bunny Slippers', 'sewing', 16, 100, 1, { angora_wool: 2, cotton_cloth: 1 }, 'T3'],
];
// The owners' wave-4 additions (2026-10-04). E(L) is the design income model the level table and every E-hour price
// were fitted to on a farm that is already live; these defs are left out of it so no threshold, price or quest
// reward moves under the couple's feet. They are priced by the same formulas as everything else.
export const OWNER4 = new Set(['raspberry', 'rose', 'coffee', 'pomegranate_tree', 'rabbit', 'fertilizer',
  'raspberry_jam', 'raspberry_tart', 'rose_jelly', 'rose_candle', 'pomegranate_juice', 'grenadine', 'farm_coffee',
  'coffee_cake', 'angora_yarn', 'angora_mittens', 'bunny_slippers']);
const inE = (x) => !OWNER4.has(x.id);

// ---------------------------------------------------------------------------------------------
// 3. Derivation
// ---------------------------------------------------------------------------------------------
const V = new Map();           // item -> market value (coins, integer)
const ITEM = new Map();        // item -> { name, kind, unlock, source }
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

const crops = CROPS_RAW.map(([id, name, unlock, min, yld, classes, hue, arch]) => {
  const gross = cropGross(min, unlock);
  const v = Math.max(1, round(gross / yld));
  const g = v * yld;
  const seed = Math.max(2, round(g * C.SEED_SHARE));
  const xp = Math.max(1, round(g / C.XP_DIV));
  V.set(id, v);
  ITEM.set(id, { name, kind: 'crop', unlock, source: 'field' });
  return { id, name, unlock, min, yield: yld, classes, hue, arch, v, gross: g, seed, xp };
});

const trees = TREES_RAW.map(([id, name, unlock, cycle, yld, product, productName, flowering]) => {
  const harvest = cropGross(cycle, unlock) * C.TREE_MULT;
  const v = round(harvest / yld);
  V.set(product, v);
  ITEM.set(product, { name: productName, kind: 'fruit', unlock, source: id });
  const xp = Math.max(1, round((v * yld) / C.XP_DIV));
  return { id, name, unlock, cycle, yield: yld, product, productName, flowering, v, harvest: v * yld, xp };
});

const classMembers = (cls) => {
  if (cls === 'produce') return [...crops.map((c) => c.id), ...trees.filter((t) => t.product !== 'wood').map((t) => t.product)];
  return crops.filter((c) => c.classes.includes(cls)).map((c) => c.id);
};
const cheapest = (cls) => Math.min(...classMembers(cls).map((i) => V.get(i)));

const feeds = FEEDS_RAW.map(([id, name, unlock, min, out, inputs]) => {
  const inVal = inputs.reduce((s, [cls, q]) => s + cheapest(cls) * q, 0);
  const v = round((inVal + C.FEED_K * Math.sqrt(min)) / out);
  V.set(id, v);
  ITEM.set(id, { name, kind: 'feed', unlock, source: 'feed_mill' });
  return { id, name, unlock, min, out, inputs, v, inVal };
});

/** Collections the FIRST bought copy of a species repays in (the rest: 10). Only the first-evening hen. */
const FIRST_COPY = { chicken: 7 };
const animals = ANIMALS_RAW.map(([id, name, unlock, home, capStart, capMax, feed, feedQty, cycle, product,
  productName, out, babyMin, prizedAt, premium, premiumName]) => {
  const feedVal = feed ? V.get(feed) * feedQty : 0;
  const v = round((feedVal + C.ANIMAL_K * Math.sqrt(cycle)) / out);
  V.set(product, v);
  ITEM.set(product, { name: productName, kind: 'animal', unlock, source: home });
  V.set(premium, v * 4);
  ITEM.set(premium, { name: premiumName, kind: 'premium', unlock, source: home });
  const net = v * out - feedVal;
  const xp = Math.max(1, round((v * out) / C.XP_DIV));
  // price: a baby repays itself in 10 collections of net value; adult costs 1.6x the baby. The first BOUGHT hen
  // repays in FIRST_COPY collections (wave-1 QA RC-28: measured ~4 h of tended play at 800, the target is <= 3 h);
  // later copies keep the n-th-copy curve from the normal price
  const baby = nice(net * 10);
  const k = FIRST_COPY[id];
  const first = k ? { n: k, baby: nice(net * k), adult: nice(nice(net * k) * 1.6) } : null;
  return { id, name, unlock, home, capStart, capMax, feed, feedQty, cycle, product, productName, out, babyMin,
    prizedAt, premium, premiumName, v, net, feedVal, xp, baby, adult: nice(baby * 1.6), first };
});

// recipes in dependency order (inputs must already have V)
const recipes = [];
const pending = RECIPES_RAW.map(([id, name, building, unlock, min, out, inputs, tier, duet]) =>
  ({ id, name, building, unlock, min, out, inputs, tier, duet: !!duet }));
let guard = 0;
while (pending.length && guard++ < 1000) {
  const r = pending.shift();
  if (!Object.keys(r.inputs).every((i) => V.has(i))) { pending.push(r); continue; }
  const inVal = Object.entries(r.inputs).reduce((s, [i, q]) => s + V.get(i) * q, 0);
  const v = round((inVal + craftTime(r.min, r.unlock)) / r.out);
  V.set(r.id, v);
  ITEM.set(r.id, { name: r.name, kind: r.tier, unlock: r.unlock, source: r.building });
  const added = v * r.out - inVal;
  const xp = Math.max(1, round(added / C.XP_DIV * (r.duet ? 1.25 : 1)));
  recipes.push({ ...r, inVal, v, ratio: (v * r.out) / inVal, added, xp });
}
check(pending.length === 0, `unresolved recipes: ${pending.map((r) => r.id).join(', ')}`);

// ---------------------------------------------------------------------------------------------
// 4. Checks: the "perfect logic" contract (GDD §4.9)
// ---------------------------------------------------------------------------------------------
// Compost also drops from the Compost Bin's collector from the bin's level (GDD §3.4 rule 8), long before its Manure
// recipe: a recipe may use it from there (the Fertilizer, owner wish #2)
const unlockOf = (item) => (item === 'compost' ? BUILDINGS_RAW.find((b) => b[0] === 'compost_bin')[2]
  : ITEM.get(item)?.unlock ?? 99);
const bld = new Map(BUILDINGS_RAW.map(([id, name, unlock, s0, s1, size, hrs]) =>
  [id, { id, name, unlock, slotsStart: s0, slotsMax: s1, size, hrs }]));

for (const r of recipes) {
  check(r.ratio >= 1 + C.MIN_ADD, `R3 ${r.id}: value ${r.v * r.out} is only ${r.ratio.toFixed(2)}x inputs ${r.inVal}`);
  check(bld.has(r.building), `${r.id}: unknown building ${r.building}`);
  check(bld.get(r.building).unlock <= r.unlock, `${r.id}: unlocks before its building`);
  for (const i of Object.keys(r.inputs)) {
    check(ITEM.has(i), `${r.id}: unknown input ${i}`);
    check(unlockOf(i) <= r.unlock, `${r.id} (L${r.unlock}) needs ${i} (L${unlockOf(i)})`);
  }
}
for (const c of crops) check(c.seed < c.gross, `${c.id}: seed >= gross`);
for (const a of animals) check(a.net > 0, `${a.id}: negative net`);

// R4: every raw good has >= 2 uses (recipes, feed classes) and every final good is orderable (all are)
const uses = new Map();
const addUse = (i, u) => { if (!uses.has(i)) uses.set(i, new Set()); uses.get(i).add(u); };
for (const r of recipes) for (const i of Object.keys(r.inputs)) addUse(i, r.id);
for (const f of feeds) for (const [cls] of f.inputs) for (const m of (ITEM.has(cls) ? [cls] : classMembers(cls))) addUse(m, f.id);
for (const a of animals) if (a.feed) addUse(a.feed, a.id);
// construction materials: wood and planks are also spent on building, barn and expansion upgrades (GDD §3.7)
addUse('wood', 'construction'); addUse('planks', 'construction'); addUse('wooden_crate', 'construction');
const raws = [...crops.map((c) => c.id), ...trees.map((t) => t.product), ...animals.map((a) => a.product)];
for (const i of raws) {
  const n = uses.get(i)?.size ?? 0;
  // manure is a consumable route to compost; honey/wool etc. must have 2 uses
  check(n >= (i === 'manure' ? 1 : 2), `R4 ${i} has only ${n} use(s): ${[...(uses.get(i) ?? [])].join(', ')}`);
}
// unlock order: an item's first use must arrive within 3 levels of the item itself
for (const i of raws) {
  const first = Math.min(...[...(uses.get(i) ?? [])].map((u) => ITEM.get(u)?.unlock ?? animals.find((a) => a.id === u)?.unlock ?? 99));
  check(first - unlockOf(i) <= 3, `${i} (L${unlockOf(i)}) has no use until L${first}`);
}

// G-TIMERS: from level 12 every horizon band has a crop
const BANDS = [[0, 3], [10, 60], [120, 360], [480, 960], [1440, 1e9]];
for (let L = 12; L <= 40; L++) {
  for (const [a, b] of BANDS) {
    check(crops.some((c) => c.unlock <= L && c.min >= a && c.min <= b), `G-TIMERS: L${L} has no crop in ${a}-${b} min`);
  }
}

// ---------------------------------------------------------------------------------------------
// 5. Levels, plots, income model E(L) and XP table
// ---------------------------------------------------------------------------------------------
const MAX_LEVEL = 40;
// Level at which each land expansion unlocks (§3.9); each owned expansion adds 6 to the plot cap (v2, G2).
const EXP_LEVELS = [5, 7, 9, 11, 13, 15, 17, 19, 21, 24, 27, 30, 33, 36, 39];
const expOwnedAt = (L) => EXP_LEVELS.filter((x) => x <= L).length;
export const plotCapOf = (L, expansions) => 16 + Math.floor(1.5 * (L - 1)) + 6 * expansions;
const plotsCap = (L) => plotCapOf(L, expOwnedAt(L));
// Design pacing (v2): target minutes of play from level L to L+1 for the reference couple, who play
// 3 evenings a week x 60 min together (the owner's brief). L5 at 45 min (first evening), L10 at 3 h (end of week 1),
// L20 at 13 h (about a month), L30 at ~56 h (about 4-5 months), L40 at ~141 h (about a year): a long-term goal.
const TARGET_MIN = [0, 3, 6, 12, 24, 24, 26, 28, 28, 29, 30, 40, 45, 50, 55, 60, 70, 75, 85, 90];
const targetMin = (L) => (L < TARGET_MIN.length ? TARGET_MIN[L] : L < 30 ? 120 + 30 * (L - 20) : 420 + 20 * (L - 30));
// Calibration (v2, C1a/C1b). K(L) scales the hand model of E(L) below to what the simulator measures for the
// reference couple (production income per play-hour, tools/econ-sim.mjs "E check"); X(L) converts E/8 into the
// XP actually earned per play-hour from every source (quests, mastery, almanac, orders). Piecewise-linear anchors.
const K_ANCHORS = [[1, 1], [4, 1], [7, 1.05], [12, 1.3], [17, 1.85], [22, 2.44], [27, 2.75], [32, 2.98], [37, 3.18], [40, 3.26]];
// Final pass (2026-10-04), after the owner's Level-up Bloom (a level-up finishes everything growing):
// - L1-14 keep their thresholds (a live farm never loses a level it has reached), except +100/+200 XP at L8/L9,
//   taken back at L11, so the Bloom's faster first week still lands L10 near the third evening (econ-sim 2.5 h);
// - L15-19 hold the time the Bloom saves earlier (the real rules reach L15 at ~4.5 h, not 6.7 h), so L20 stays at
//   about a month (real-sim day 26-28, econ-sim day 29); L20-24 are fitted to the XP the real rules earn there
//   (tools/real-sim.mjs: ~30-35k an evening), so L22 / L24 / L25 arrive by day 42 / 58 / 72;
// - L25-39 sit between econ-sim's couple (43-54k XP an hour) and the real-rules bots (32-45k an hour, without the M2
//   systems), with no spike at L38-39: L30 at ~4 months, L40 at ~9-11 months, a Legacy level about every month.
const X_ANCHORS = [[1, 1.75], [4, 1.75], [7, 1.52], [8, 1.714], [9, 1.793], [10, 1.728], [11, 1.6875], [12, 1.85],
  [14, 1.922], [15, 3.429], [16, 3.158], [17, 2.876], [18, 2.706], [19, 2.521], [20, 2.067], [21, 1.723], [22, 1.981],
  [23, 1.676], [24, 1.365], [25, 2.09], [26, 1.87], [27, 1.67], [29, 1.6], [32, 1.5], [35, 1.37], [39, 1.2], [40, 1.2]];
const lerp = (anchors, L) => {
  for (let i = 1; i < anchors.length; i++) {
    const [l0, k0] = anchors[i - 1], [l1, k1] = anchors[i];
    if (L <= l1) return k0 + ((k1 - k0) * (L - l0)) / (l1 - l0);
  }
  return anchors[anchors.length - 1][1];
};

function E(L) {
  // crops: average in-session (<= 60 min) net per plot-hour among unlocked crops, 45 % utilisation
  const sess = crops.filter((c) => inE(c) && c.unlock <= L && c.min <= 60);
  const perPlotHour = sess.reduce((s, c) => s + ((c.gross - c.seed) * 60) / c.min, 0) / sess.length;
  // plus one "away" cycle per day (planted at the end of the evening) on 60 % of the plots, spread over ~2 h of
  // play per day; the best net among unlocked crops of >= 4 h
  const away = crops.filter((c) => inE(c) && c.unlock <= L && c.min >= 240).map((c) => c.gross - c.seed);
  const awayPart = away.length ? (plotsCap(L) * Math.max(...away) * 0.6) / 2 : 0;
  const cropPart = plotsCap(L) * perPlotHour * 0.45 + awayPart;
  // animals: housing filled two levels at a time, 70 % collection utilisation
  let animalPart = 0;
  for (const a of animals) {
    if (a.unlock > L || !inE(a)) continue;
    const n = a.id === 'bee' ? Math.min(8, 2 + Math.floor((L - a.unlock) / 3))
      : Math.min(a.capMax, a.capStart + Math.floor((L - a.unlock) / 2));
    animalPart += n * (a.net * 60) / a.cycle * 0.7;
  }
  // trees: owned ~2 per unlocked species, 3 harvests a day spread over ~2 h of play a day
  let treePart = 0;
  for (const t of trees) if (t.unlock <= L && inE(t)) treePart += 2 * t.harvest * Math.min(3, 1440 / t.cycle) / 2 * 0.5;
  // crafting: each built building runs ~1 slot of its median unlocked recipe at 60 % utilisation
  let craftPart = 0;
  for (const b of bld.values()) {
    if (b.unlock > L) continue;
    const rs = recipes.filter((r) => inE(r) && r.building === b.id && r.unlock <= L).map((r) => (r.added * 60) / r.min).sort((x, y) => x - y);
    if (rs.length) craftPart += rs[Math.floor(rs.length / 2)] * 0.6;
  }
  const raw = cropPart + animalPart + treePart + craftPart;
  return { L, total: round(raw * 1.2), cropPart: round(cropPart), animalPart: round(animalPart),
    treePart: round(treePart), craftPart: round(craftPart) };
}

const levels = [];
let cum = 0;
for (let L = 1; L <= MAX_LEVEL; L++) {
  const e = E(L);
  const k = lerp(K_ANCHORS, L), x = lerp(X_ANCHORS, L);
  const prev = levels[L - 2];
  const total = Math.max(nice(e.total * k), prev?.E ?? 0);          // E never falls from one level to the next
  const xpRate = (total / C.XP_DIV) * x;              // XP per engaged hour, all sources
  let toNext = L < MAX_LEVEL ? nice((xpRate * targetMin(L)) / 60) : null;
  if (toNext && prev && toNext <= prev.toNext) toNext = nice(prev.toNext * 1.04);   // R9: strictly increasing
  levels.push({ L, E: total, parts: e, k, x, xpRate: round(xpRate), toNext, cumAt: cum, plots: plotsCap(L),
    coins: nice(total * 0.15), acorns: L % 5 === 0 ? 5 : 2, minutes: targetMin(L) });
  if (toNext) cum += toNext;
}
for (let i = 1; i < levels.length - 1; i++) check(levels[i].toNext > levels[i - 1].toNext, `XP table not increasing at L${i + 1}`);
const legacyXp = levels[MAX_LEVEL - 2].toNext;  // Legacy levels: flat, equal to the 39->40 requirement

// ---------------------------------------------------------------------------------------------
// 6. Prices (everything in hours of E at the unlock level, so every unlock is affordable on arrival)
// ---------------------------------------------------------------------------------------------
const EL = (L) => levels[Math.min(MAX_LEVEL, Math.max(1, L)) - 1].E;
// The Feed Mill arrives free at L1 and Grandma's Windmill is repaired free (quest A5, v2 F2): both cost 0.
const FREE_BUILDINGS = new Set(['feed_mill', 'mill']);
// Second copies (price x 2): Windmill L16, Dairy L18 (v2, M1), Feed Mill L31, Pie Oven L33.
export const SECOND_COPIES = { mill: 16, dairy: 18, feed_mill: 31, pie_oven: 33 };
const buildings = [...bld.values()].map((b) => ({ ...b, cost: FREE_BUILDINGS.has(b.id) ? 0 : nice(EL(b.unlock) * b.hrs),
  second: SECOND_COPIES[b.id] ?? null,
  slotCost: (k) => nice(EL(b.unlock) * 0.25 * 1.6 ** (k - 1)) }));
const HOMES = {
  coop: ['Chicken Coop', 1, [3, 3]], cow_barn: ['Cow Barn', 7, [4, 3]], pasture: ['Sheep Pasture', 12, [4, 4]],
  beehive: ['Beehive', 13, [1, 1]], hutch: ['Rabbit Hutch', 14, [3, 2]] /* owner wish 3 */, pig_pen: ['Pig Pen', 17, [4, 3]],
  duck_pond: ['Duck Pond', 19, [4, 4]], goat_yard: ['Goat Yard', 22, [4, 4]], stable: ['Stable', 25, [4, 3]],
  paddock: ['Alpaca Paddock', 33, [4, 4]],
};
const homes = Object.entries(HOMES).map(([id, [name, unlock, size]]) =>
  ({ id, name, unlock, size, cost: unlock <= 2 ? 0 : id === 'beehive' ? animals.find((a) => a.id === 'bee').baby : nice(EL(unlock) * 0.35),
    upgrade: nice(EL(unlock) * 0.2) }));
// first tree of a species repays itself in 6 harvests; the n-th costs x1.45^(n-1); at most 4 per species (one Grove)
// + 1 per 10 farm levels, max 8 (v2, M8)
export const treeCap = (L) => Math.min(8, 4 + Math.floor(L / 10));
const treePrices = trees.map((t) => ({ ...t, price: nice(t.harvest * 6) }));
const plotPrice = (n) => (n <= 16 ? 0 : nice(25 * 1.04 ** (n - 16)));

// Land expansions: [id, name, level, proof task, reveals]. Coins = E(level) x (0.6 + 0.2k) hours.
const EXPANSIONS_RAW = [
  ['creekside', 'Creekside Meadow', 5, 'Harvest 30 Wheat and collect 10 Eggs', 'creek bank with reeds, 3 log debris (Wood), a wild Pine (free, mature)'],
  ['old_orchard', 'Old Orchard', 7, 'Own 2 Apple Trees and press 3 Apple Juice', '2 wild Apple Trees (free, mature), 4 stumps (Wood)'],
  ['cow_hill', 'Cow Hill', 9, 'Collect 10 Milk and churn 3 Butter', 'gentle hill with a dry-stone wall, wildflower patch (bee forage)'],
  ['sunflower_rise', 'Sunflower Rise', 11, 'Make 3 Strawberry Jam', 'old fence line, scarecrow (free decor), Grandma\'s seed box (collection item)'],
  ['bee_glade', 'Bee Glade', 13, 'Spin 4 Yarn and own 1 Sheep Pasture', 'clover glade (bee forage x2), wild hive (1 free Bee Colony)'],
  ['fair_lane', 'Fairground Lane', 15, 'Bake 2 Apple Pies and fill 10 orders', 'road to the County Fair grounds, ribbon shelf'],
  ['riverbank', 'Riverbank', 17, 'Make 3 Cotton Tote or Wool Pillow', 'River Barge jetty upgrade (row bonuses +25 %), willow trees'],
  ['pig_woods', 'Pig Woods', 19, 'Dig up 5 Truffles', 'oak edge, 2 truffle spots (pigs here dig +10 % faster)'],
  ['willow_pond', 'Willow Pond', 21, 'Collect 8 Duck Eggs', 'large pond with dock, fishing-spot decor, lily pads'],
  ['goat_rocks', 'Goat Rocks', 24, 'Make 3 Goat Cheese', 'rocky outcrop goats climb (idle animation), stone bench'],
  ['stable_paddock', 'Stable Paddock', 27, 'Pack 2 Picnic Baskets', 'riding track, horse-show ring for the Fair'],
  ['walnut_grove', 'Walnut Grove', 30, 'Harvest 30 Walnuts', 'old walnut trees (2 free), picnic clearing'],
  ['olive_terrace', 'Olive Terrace', 33, 'Press 4 Olive Oil', 'terraced slope, stone steps'],
  ['maple_ridge', 'Maple Ridge', 36, 'Boil 3 Maple Syrup', 'red-maple ridge with autumn colours all year, lookout'],
  ['sunset_hill', 'Sunset Hill', 39, 'Pack 2 Gourmet Hampers', 'the hilltop gazebo overlooking the farm (Golden Hour +10 min there)'],
];
// v2 (H5 + X6): construction materials halved; 1 Wood -> 2 Planks in 20 min, 2 Planks -> 1 Crate in 30 min.
const EXP_PLANKS = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const EXP_CRATES = [0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3];
const BARN_PLANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const BARN_CRATES = [0, 0, 1, 1, 1, 1, 2, 2, 2, 2];
const expansions = EXPANSIONS_RAW.map(([id, name, level, proof, reveals], i) => {
  const k = i + 1;
  check(level === EXP_LEVELS[i], `expansion ${id}: level ${level} differs from EXP_LEVELS`);
  return { k, id, name, level, proof, reveals, coins: nice(EL(level) * (0.6 + 0.2 * k)), planks: EXP_PLANKS[i], crates: EXP_CRATES[i] };
});

// Barn (storage) upgrades: n = 1..10, +120 capacity each (v2: plots grow with land, so the Barn grows faster)
const barnUpgrades = Array.from({ length: 10 }, (_, i) => {
  const n = i + 1, gate = 3 + 3 * n;
  return { n, gate, cap: 200 + 120 * n, coins: nice(EL(gate) * 0.3 * 1.15 ** (n - 1)), planks: BARN_PLANKS[i], crates: BARN_CRATES[i] };
});

// Decorations: [id, name, unlock, beauty, size, bonus]. Coins = beauty x 40 x (1 + 4 % per unlock level).
// Acorn decor: [.., acorns] luxury items, coins = 0.
const DECOR_RAW = [
  ['flower_bed', 'Flower Bed', 1, 4, [1, 1], 'Counts as bee forage'],
  ['picket_fence', 'Picket Fence (per tile)', 1, 1, [1, 1], 'Auto-joins; pens and gardens'],
  ['dirt_path', 'Dirt Path (per tile)', 1, 0.5, [1, 1], 'Beauty path bonus: +10 % beauty to decor touching a path'],
  ['sunset_bench', 'Sunset Bench', 4, 6, [2, 1], 'Golden Hour seat (§6.2)'],
  ['scarecrow', 'Scarecrow', 3, 8, [1, 1], 'Crops within 3 tiles: +5 % chance of +1 unit (does not stack)'],
  ['hay_bales', 'Hay Bale Stack', 5, 5, [1, 1], '—'],
  ['wind_chime', 'Porch Wind Chime', 6, 6, [1, 1], 'Chimes on hover (pure juice)'],
  ['wheelbarrow', 'Flower Wheelbarrow', 7, 10, [1, 1], 'Counts as bee forage'],
  ['bird_bath', 'Bird Bath', 8, 12, [1, 1], 'Trees within 3 tiles: +5 % chance of +1 fruit (does not stack)'],
  ['lantern', 'Garden Lantern', 9, 10, [1, 1], 'Glows at night'],
  ['sprinkler', 'Sprinkler', 10, 4, [1, 1], 'Waters every crop within 2 tiles at the moment it is planted'],
  ['dog_house', 'Dog House', 10, 12, [2, 2], 'Home of the farm dog (pets, §3.4)'],
  ['cat_basket', 'Cat Basket', 10, 10, [1, 1], 'Home of the farm cat'],
  ['rose_arch', 'Rose Arch', 12, 18, [2, 1], 'Counts as bee forage; walkway'],
  ['stone_well', 'Wishing Well', 14, 20, [2, 2], '—'],
  ['windmill_toy', 'Garden Windmill', 15, 16, [1, 1], 'Spins with the wind uniform'],
  ['beehive_skep', 'Straw Skep', 16, 14, [1, 1], 'Counts as bee forage'],
  ['bench_swing', 'Porch Swing', 18, 24, [2, 1], 'Two-seat: also a Sunset Bench'],
  ['fountain', 'Stone Fountain', 20, 40, [2, 2], '—'],
  ['topiary', 'Topiary Bush', 22, 22, [1, 1], '—'],
  ['greenhouse_frame', 'Cold Frame', 24, 20, [2, 1], 'Crops within 2 tiles count as in-season (§3.1)'],
  ['gazebo', 'Garden Gazebo', 26, 60, [3, 3], 'Two-seat: also a Sunset Bench'],
  ['pond_dock', 'Fishing Dock', 28, 30, [2, 2], 'Collection spot: Pond Treasures'],
  ['statue_cow', 'Cow Statue', 32, 50, [2, 2], '—'],
  ['hot_air_balloon', 'Hot-air Balloon Mooring', 38, 90, [3, 3], 'Photo-mode backdrop'],
];
const ACORN_DECOR = [
  ['golden_scarecrow', 'Golden Scarecrow', 10, 30, 25, 'As Scarecrow, radius 4'],
  ['heart_arbor', 'Sweetheart Arbor', 8, 35, 30, 'Two-seat Sunset Bench; +1 Heart each per Golden Hour'],
  ['cherry_blossom', 'Cherry Blossom Tree', 12, 40, 30, 'Bee forage x2; petals drift'],
  ['star_lanterns', 'String of Star Lanterns', 15, 25, 15, 'Night glow over a 3-tile line'],
  ['grandma_rocker', "Grandma's Rocking Chair", 20, 30, 20, 'Story decor; plays a memory line'],
  ['golden_cow_statue', 'Golden Cow Statue', 30, 80, 60, 'Showcase piece'],
];
// v2 (H4): Grand decor — ten showcase pieces priced in hours of E at their level (a late-game coin sink)
// [id, name, unlock, hours of E, beauty, size, effect]
const GRAND_DECOR_RAW = [
  ['grand_windmill', 'Old Dutch Windmill', 20, 0.5, 80, [3, 3], 'Sails turn with the wind'],
  ['flower_maze', 'Flower Maze', 23, 0.8, 100, [4, 4], 'Bee forage x3; the avatars can walk it'],
  ['koi_pond', 'Koi Pond', 26, 1.0, 120, [3, 3], 'Two-seat bench at the edge (Golden Hour seat)'],
  ['carousel', 'Carousel', 29, 1.4, 150, [4, 4], 'Turns at night with lights; Memory Book backdrop'],
  ['treehouse', 'Treehouse', 31, 1.8, 170, [3, 3], 'Two-seat lookout (Golden Hour seat)'],
  ['clock_tower', 'Clock Tower', 33, 2.2, 190, [2, 2], 'Chimes the hour'],
  ['orangery', 'Glass Orangery', 35, 2.6, 210, [4, 3], 'Lit from inside at night'],
  ['arbor_of_lights', 'Great Arbor of Lights', 37, 3.0, 230, [3, 2], 'Two-seat; fireflies all night'],
  ['bath_house', 'Hot-Spring Bath House', 39, 3.5, 250, [4, 4], 'Steam and lanterns; two seats'],
  ['golden_gate', 'Golden Farm Gate', 40, 4.0, 300, [3, 1], 'Shows the farm name in gold leaf'],
];
const grandDecor = GRAND_DECOR_RAW.map(([id, name, unlock, hours, beauty, size, bonus]) =>
  ({ id, name, unlock, hours, beauty, size, bonus, coins: nice(EL(unlock) * hours) }));

const decor = DECOR_RAW.map(([id, name, unlock, beauty, size, bonus]) =>
  ({ id, name, unlock, beauty, size, bonus, coins: nice(Math.max(5, beauty * 40 * (1 + 0.04 * (unlock - 1)))) }));


// Quests: [id, chain, giver, level, title, [[verb, id, qty]...], minutes of play it represents, extra reward]
// Reward: coins = E(L) x minutes/60 x 0.5; XP = coins / 8. Every referenced id must be unlocked at the quest level.
const QUESTS_RAW = [
  ['a1', 'A', 'Grandma Hazel', 1, 'Welcome Home', [['plant', 'wheat', 6], ['harvest', 'wheat', 6]], 3, '—'],
  ['a2', 'A', 'Grandma Hazel', 1, 'Market Morning', [['sell', 'wheat', 10]], 3, '—'],
  // A3 is the Barnyard track (GDD §7.4): Coop, feed, feed the hens. The eggs (20 min later) are A6's, so the first
  // evening never waits on a hen cycle (wave-1 QA RC-01).
  ['a3', 'A', 'Grandma Hazel', 1, 'Feathered Friends', [['place', 'coop', 1], ['make', 'chicken_feed', 1], ['tend', 'chicken', 2]], 6, '2 Chickens (free); the Barnyard tutorial track'],
  ['a4', 'A', 'Grandma Hazel', 2, 'First Customer', [['fill', 'order', 1]], 4, '—'],
  ['a5', 'A', 'Grandma Hazel', 3, 'The Old Windmill', [['place', 'mill', 1], ['make', 'flour', 3]], 8, 'Grandma\'s Windmill: placed at 0 coins; first Flour made together'],
  ['a6', 'A', 'Grandma Hazel', 4, "Grandma's Apple Tree", [['plant', 'apple_tree', 1], ['plant', 'strawberry', 6], ['collect', 'egg', 2]], 10, 'Grandma\'s Apple Tree sapling and the Sunset Bench (wave-2 RC-01), given when the quest starts'],
  // wave-2 RC-01: three loaves, no Corn Bread: a 30-min bake behind a Cornmeal + Egg chain was the last card of the
  // first evening and finished after the couple had logged off
  ['a7', 'A', 'Grandma Hazel', 5, "Bread Like Grandma's", [['build', 'bakery', 1], ['make', 'bread', 3]], 15, "Recipe card 'Grandma's Bread' (collection item)"],
  ['a8', 'A', 'Grandma Hazel', 6, 'Wood for Winter', [['clear', 'debris', 4], ['make', 'planks', 4]], 20, '1 Pine sapling (free)'],
  ['a9', 'A', 'Grandma Hazel', 7, 'A Cow Named Clover', [['buy', 'cow', 1], ['collect', 'milk', 3], ['make', 'butter', 1]], 25, 'The couple names the first cow'],
  ['a10', 'A', 'Grandma Hazel', 9, 'Supper at the Farmhouse', [['build', 'kitchen', 1], ['make', 'veggie_soup', 2], ['make', 'omelette', 1]], 30, '—'],
  ['a11', 'A', 'Grandma Hazel', 10, "Grandma's Long Letter", [['make', 'sweetheart_cake', 1]], 45, 'Story beat "Two Pairs of Hands"; 5 Acorns'],
  ['b1', 'B', 'Mabel', 3, 'Open for Business', [['fill', 'order', 3]], 10, '—'],
  ['b2', 'B', 'Mabel', 6, 'Juice Stand', [['build', 'juice_press', 1], ['make', 'apple_juice', 2], ['deliver', 'apple_juice', 1]], 30, '—'],
  ['b3', 'B', 'Mabel', 11, 'Jam Session', [['build', 'preserves', 1], ['make', 'strawberry_jam', 3], ['sell', 'demand', 1]], 45, 'Jam-jar shelf decor'],
  ['b4', 'B', 'Mabel', 14, 'Busy Week', [['fill', 'order', 15]], 120, '3 Acorns'],
  ['b5', 'B', 'Mabel', 20, 'Breakfast in a Basket', [['build', 'packing', 1], ['make', 'breakfast_hamper', 1], ['deliver', 'breakfast_hamper', 1]], 120, "Mabel's Stall decor"],
  // wave-2 RC-01: Dr. Fern's first call is at L5, a Barnyard card for the stretch after level 5 when the Bakery and
  // the first land are saving goals (the first evening had no card the barnyard partner could finish)
  ['c0', 'C', 'Dr. Fern', 5, 'Hen House Calls', [['collect', 'egg', 4], ['make', 'chicken_feed', 2]], 9, '—'],
  ['c1', 'C', 'Dr. Fern', 7, 'Baby Steps', [['make', 'baby_bottle', 2], ['raise', 'cow', 1]], 30, '—'],
  ['c2', 'C', 'Dr. Fern', 8, 'Good Soil', [['empty', 'compost_bin', 2], ['fertilize', 'plot', 6]], 40, '6 Compost'],
  ['c3', 'C', 'Dr. Fern', 12, 'Shearing Day', [['build', 'pasture', 1], ['buy', 'sheep', 2], ['collect', 'wool', 4]], 60, '—'],
  ['c4', 'C', 'Dr. Fern', 17, 'Truffle Trouble', [['build', 'pig_pen', 1], ['make', 'pig_slop', 6], ['collect', 'truffle', 3]], 90, 'Pig mud-bath decor'],
  ['c5', 'C', 'Dr. Fern', 19, 'Duck Pond Days', [['build', 'duck_pond', 1], ['collect', 'duck_egg', 5], ['make', 'custard', 1]], 90, '—'],
  ['c6', 'C', 'Dr. Fern', 22, 'Mountain Goats', [['build', 'goat_yard', 1], ['collect', 'goat_milk', 4], ['make', 'goat_cheese', 1]], 90, '—'],
  ['c7', 'C', 'Dr. Fern', 25, 'Horse Sense', [['build', 'stable', 1], ['buy', 'horse', 1], ['make', 'compost', 2]], 120, 'Saddle-rack decor; the couple names the horse'],
  ['d1', 'D', 'Juniper', 11, 'Cherry on Top', [['plant', 'cherry_tree', 2], ['make', 'cherry_jam', 1]], 60, '—'],
  ['d2', 'D', 'Juniper', 13, 'The Buzz', [['place', 'beehive', 1], ['place', 'forage', 3], ['collect', 'honey', 2]], 90, '1 Flower Wheelbarrow'],
  ['d3', 'D', 'Juniper', 15, 'Pie Day', [['build', 'pie_oven', 1], ['make', 'apple_pie', 1], ['make', 'cherry_pie', 1]], 120, '—'],
  ['d4', 'D', 'Juniper', 17, 'Peach Season', [['plant', 'peach_tree', 2], ['make', 'peach_cobbler', 1]], 120, '—'],
  ['d5', 'D', 'Juniper', 23, 'Plum Perfect', [['plant', 'plum_tree', 2], ['make', 'plum_jam', 2]], 150, '—'],
  ['d6', 'D', 'Juniper', 30, 'Liquid Gold', [['build', 'oil_press', 1], ['make', 'olive_oil', 2]], 180, 'Olive-jar decor'],
  ['e1', 'E', 'Ollie', 5, 'Beyond the Fence', [['expand', 'creekside', 1]], 30, '—'],
  ['e2', 'E', 'Ollie', 6, 'More Room', [['upgrade', 'barn', 1]], 30, '—'],
  ['e3', 'E', 'Ollie', 9, 'Slots and Sawdust', [['upgrade', 'slot', 1], ['make', 'wooden_crate', 2]], 45, '—'],
  ['e4', 'E', 'Ollie', 16, 'The Old Greenhouse', [['complete', 'bundle', 2]], 120, '—'],
  ['e5', 'E', 'Ollie', 18, 'Pretty as a Picture', [['reach', 'beauty_star', 2]], 90, 'Rose Arch decor'],
  // wave-2 QA RC-11: the bundles count first, so the card shows progress every evening, not 0/1 for three
  ['e6', 'E', 'Ollie', 22, 'Bridge to the Meadow', [['complete', 'bundle', 2], ['complete', 'project', 1]], 240, '—'],
  ['f1', 'F', 'Captain Reed', 15, 'The Barge Arrives', [['load', 'crate', 3]], 60, '—'],
  ['f2', 'F', 'Captain Reed', 17, 'Full Row', [['load', 'row', 1]], 120, 'Rope-coil decor'],
  ['f3', 'F', 'Captain Reed', 23, 'Ship Shape', [['load', 'row', 2]], 300, '3 Acorns'],
  ['g1', 'G', 'Judge Pemberton', 14, 'Entry Form', [['enter', 'fair', 3]], 45, '—'],
  ['g2', 'G', 'Judge Pemberton', 16, 'Blue Ribbon Crops', [['harvest', 'prized', 3]], 90, '—'],
  ['g3', 'G', 'Judge Pemberton', 20, 'Silver Lining', [['reach', 'fair_silver', 1]], 300, 'Silver rosette decor'],
  ['h1', 'H', "Grandma's Journal", 4, 'Golden Hour', [['together', 'bench', 1]], 10, '1 Heart each; Memory Book page'],
  ['h2', 'H', "Grandma's Journal", 10, 'Recipe for Two', [['together', 'duet', 1]], 60, '2 Hearts each'],
  ['h3', 'H', "Grandma's Journal", 12, 'Helping Hands', [['together', 'help_flag', 3]], 60, '2 Hearts each'],
  ['h4', 'H', "Grandma's Journal", 20, 'Giants of the Field', [['together', 'giant', 1]], 90, 'Giant-pumpkin trophy decor'],
  // v2 (G1): chapters for L25-40, so the quest book never runs dry
  ['b6', 'B', 'Mabel', 27, 'Watermelon Summer', [['make', 'watermelon_juice', 2], ['make', 'watermelon_salad', 1]], 180, 'Melon-stand awning decor'],
  ['b7', 'B', 'Mabel', 31, 'Peppers and Pickles', [['make', 'pickled_peppers', 2], ['make', 'stuffed_peppers', 1]], 180, '—'],
  ['b8', 'B', 'Mabel', 35, 'Sunday Rice', [['make', 'rice_pudding', 2], ['make', 'risotto', 1]], 240, '—'],
  ['b9', 'B', 'Mabel', 37, 'The Gourmet Basket', [['make', 'gourmet_hamper', 1], ['deliver', 'gourmet_hamper', 1]], 300, "Mabel's gold scale decor; 3 Acorns"],
  ['c8', 'C', 'Dr. Fern', 28, 'New Coats', [['breed', 'cow', 1]], 180, 'The couple names the calf'],
  ['c9', 'C', 'Dr. Fern', 33, 'Alpaca Hill', [['build', 'paddock', 1], ['buy', 'alpaca', 2], ['make', 'alpaca_yarn', 1]], 240, '—'],
  ['d7', 'D', 'Juniper', 34, 'Sweet Sap', [['plant', 'maple_tree', 1], ['build', 'sugar_shack', 1], ['make', 'maple_syrup', 2]], 240, '—'],
  ['d8', 'D', 'Juniper', 36, 'Cocoa Dreams', [['plant', 'cocoa_tree', 1], ['build', 'chocolatier', 1], ['make', 'chocolate_cake', 1]], 300, '—'],
  ['d9', 'D', 'Juniper', 39, 'Figs at Sunset', [['plant', 'fig_tree', 1], ['make', 'fig_tart', 1]], 300, 'Fig-crate decor'],
  ['e7', 'E', 'Ollie', 23, 'The Ferry Landing', [['complete', 'town_project', 1]], 240, 'Story beat "Lights Across the River"'],
  ['e8', 'E', 'Ollie', 28, 'A Village Wakes', [['complete', 'town_project', 3]], 300, '3 Acorns'],
  ['e9', 'E', 'Ollie', 34, "Grandma's Farmhouse", [['complete', 'bundle', 2]], 300, '—'],
  ['e10', 'E', 'Ollie', 38, 'Grandma Comes Home', [['complete', 'project', 1]], 360, 'Story beat: Grandma visits; 5 Acorns'],
  ['g4', 'G', 'Judge Pemberton', 27, 'League Night', [['reach', 'league', 2]], 180, '—'],
  ['g5', 'G', 'Judge Pemberton', 32, 'Hamper Show', [['enter', 'hamper', 2]], 180, 'Hamper rosette decor'],
  ['h5', 'H', "Grandma's Journal", 25, 'A Cake for Two', [['together', 'duet', 1]], 120, '2 Hearts each; Memory Book page'],
  ['h6', 'H', "Grandma's Journal", 30, 'Gone Fishing', [['together', 'dock', 1]], 120, '2 Hearts each'],
  ['h7', 'H', "Grandma's Journal", 39, 'Golden Hour on the Hill', [['together', 'bench', 1]], 120, 'Memory Book frame; 3 Hearts each'],
];
const SPECIAL_REFS = new Set(['order', 'debris', 'demand', 'plot', 'forage', 'barn', 'slot', 'bundle', 'beauty_star',
  'project', 'crate', 'row', 'barge', 'fair', 'prized', 'fair_silver', 'bench', 'duet', 'help_flag', 'giant',
  'town_project', 'league', 'hamper', 'dock']);
const quests = QUESTS_RAW.map(([id, chain, giver, level, title, tasks, minutes, extra]) => {
  for (const [, ref] of tasks) {
    if (SPECIAL_REFS.has(ref)) continue;
    const u = ITEM.get(ref)?.unlock ?? bld.get(ref)?.unlock ?? trees.find((t) => t.id === ref)?.unlock
      ?? animals.find((a) => a.id === ref)?.unlock ?? HOMES[ref]?.[1] ?? expansions.find((x) => x.id === ref)?.level;
    check(u !== undefined, `quest ${id}: unknown ref ${ref}`);
    check(u === undefined || u <= level, `quest ${id} (L${level}) needs ${ref} (L${u})`);
  }
  const coins = nice((EL(level) * minutes) / 60 * 0.5);
  return { id, chain, giver, level, title, tasks, minutes, extra, coins, xp: nice(coins / C.XP_DIV) };
}).sort((a, b) => a.chain.localeCompare(b.chain) || a.level - b.level);

// Feature unlocks (systems), by level. Content unlocks are derived from the tables above.
const FEATURES = {
  1: 'Market Stand, Barn (200), free Chicken Coop and Feed Mill, two tutorial tracks (Fields, Barnyard), quest book, activity feed, pings, emotes, high-five, debris clearing, Uproot',
  2: 'Orders Board (3 slots), help flags and "I\'m on it" pins',
  3: 'Daily Gift calendar, Daily Almanac (wave-2 RC-01: was L8) and Farm Weeks (weekly streak)',
  4: 'Golden Hour (Sunset Bench)',
  5: 'Land expansions (+6 plot cap each), 4th order slot',
  6: 'Barn upgrades, weekly Couple Challenge (from the first Monday after L6)',
  7: 'Crop and animal mastery, baby animals',
  8: 'Compost and blue-ribbon crops',
  9: '5th order slot, Wishlist',
  10: 'Pets (one each), duet recipes, Collections album, Big Watering Can',
  11: 'Market Demand of the day',
  12: 'Specialisation perks (M2), Wide Sickle (2×2)',
  13: 'Bee forage and pollination',
  14: 'County Fair (weekly), 6th order slot, Seed Spreader (2×2)',
  15: 'River Barge (weekly)',
  16: 'Restoration Ledger (6 projects), second Windmill allowed',
  17: 'Truffle hunting (pigs)',
  18: 'Farm Beauty rating, decor sets, Masterwork decor, second Dairy allowed',
  19: 'Animal Nursery (personality and specialty), Restoration project 2',
  20: 'Giant crops, 7th order slot, Town Projects (Hollow Village across the river)',
  21: 'Townsfolk Friendship and the weekly townsfolk board',
  22: 'Heirloom trees show their blue-ribbon fruit, Restoration project 3',
  23: 'Help flags on Restoration bundle slots',
  24: 'Seasonal Ribbon Track',
  25: 'Horse show at the Fair, Restoration project 4',
  26: 'Grand Sickle (3×3)',
  27: 'Fair NPC league',
  28: 'Breeding Barn (coat variants), 8th order slot, Restoration project 5',
  29: 'Carousel decor set',
  30: 'Gold mastery tier',
  31: 'Second Feed Mill allowed',
  32: 'Hampers score double at the Fair',
  33: 'Second Pie Oven allowed',
  34: 'Restoration project 6 (Grandma\'s Farmhouse)',
  35: '9th order slot',
  37: 'Gourmet orders (one T4 good, 1.7 × V)',
  38: 'Showcase beauty beyond 5 stars',
  39: 'Sunset Hill gazebo (Golden Hour +10 min)',
  40: 'Legacy levels',
};
const unlocksAt = (L) => {
  const u = [];
  for (const c of crops) if (c.unlock === L) u.push(`crop ${c.name}`);
  for (const t of trees) if (t.unlock === L) u.push(`tree ${t.name}`);
  for (const a of animals) if (a.unlock === L) u.push(`animal ${a.name}`);
  for (const b of buildings) if (b.unlock === L) u.push(`building ${b.name}`);
  const rs = recipes.filter((r) => r.unlock === L).map((r) => r.name);
  if (rs.length) u.push(`recipes ${rs.join(', ')}`);
  for (const d of decor) if (d.unlock === L) u.push(`decor ${d.name}`);
  for (const d of grandDecor) if (d.unlock === L) u.push(`grand decor ${d.name}`);
  for (const x of expansions) if (x.level === L) u.push(`expansion ${x.name}`);
  for (const b of barnUpgrades) if (b.gate === L) u.push(`barn upgrade ${b.n}`);
  if (FEATURES[L]) u.push(`feature: ${FEATURES[L]}`);
  return u;
};
for (let L = 1; L <= MAX_LEVEL; L++) check(unlocksAt(L).length > 0, `level ${L} unlocks nothing`);
// no content category goes more than 3 levels without something new (crop/tree/animal/building)
for (let L = 4; L <= MAX_LEVEL; L++) {
  const any = [L - 3, L - 2, L - 1, L].some((k) => unlocksAt(k).some((x) => /^(crop|tree|animal|building)/.test(x)));
  check(any, `no crop/tree/animal/building between L${L - 3} and L${L}`);
}

// R11 (v2, X4): every achievement tier and collection item is reachable from the content, finite sources counted.
// [ribbon, gold tier, what bounds it]
const FINITE_RIBBONS = [
  ['Rainbow Harvest (different crops)', 18, crops.length],
  ['Orchardist (tree species)', 13, trees.length],
  ['Full Barnyard (animal species)', 9, animals.length],
  ['Recipe Box (different recipes)', recipes.length, recipes.length],
  ['Room to Grow (expansions)', 15, expansions.length],
  ['Restorer (bundles)', 24, 6 * 4],
  ['Hollow Reborn (projects)', 6, 6],
  ['Collector (sets)', 12, 12],
  ['Album Pages (collection items)', 60, 12 * 5],
  ['Picture Perfect (beauty stars)', 5, 5],
  ['League Climber (NPC leagues)', 5, 5],
  // debris: 24 at the start + 15 per expansion are finite; regrowth (1 an hour, 12 waiting at most) makes 400 reachable
  ['Clearing the Way (debris)', 400, Infinity],
];
for (const [name, gold, max] of FINITE_RIBBONS) check(gold <= max, `R11 ${name}: Gold needs ${gold}, only ${max} exist`);
// R13 (v2, X3): every bonus variant is worth at least its base variant. Giant crop = 2 x 9 x (yield + 1) units vs the same
// 9 plots composted normally (yield + 1 each, + the 10 % prized unit).
for (const c of crops) check(2 * 9 * (c.yield + 1) >= 9 * (c.yield + 1 + 0.1), `R13 giant ${c.id} yields less than 9 composted plots`);
for (const a of animals) check(a.v * 4 >= a.v, `R13 premium ${a.premium}`);

// R18 (v2): no dominated item. A recipe is dominated if a recipe of the same building unlocked no later beats it per
// building-hour AND per craft; a crop if a crop unlocked no later beats it per plot-hour AND per planting.
for (const r of recipes) {
  const perH = (x) => (x.added * 60) / x.min;
  const by = recipes.filter((o) => o !== r && o.building === r.building && o.unlock <= r.unlock && perH(o) > perH(r) && o.added > r.added);
  check(!by.length, `R18 recipe ${r.id} is dominated by ${by.map((o) => o.id).join(', ')}`);
}
for (const c of crops) {
  const net = (x) => x.gross - x.seed, netH = (x) => (net(x) * 60) / x.min;
  const by = crops.filter((o) => o !== c && o.unlock <= c.unlock && netH(o) > netH(c) && net(o) > net(c));
  check(!by.length, `R18 crop ${c.id} is dominated by ${by.map((o) => o.id).join(', ')}`);
}
for (let i = 1; i < levels.length; i++) check(levels[i].E >= levels[i - 1].E, `R9 E falls at L${i + 1}`);

// ---------------------------------------------------------------------------------------------
// 7. Output
// ---------------------------------------------------------------------------------------------
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.map(fmt).join(' | ')} |`)].join('\n');

const mastery = (min) => {
  const f = Math.min(2.5, Math.max(0.5, (60 / min) ** 0.35));
  return [20, 100, 300, 1000].map((b) => nice(b * f));
};

if (ARGS.has('--md')) {
  const out = [];
  out.push('### crops');
  out.push(table(['Id', 'Crop', 'Lvl', 'Grow', 'Seed', 'Yield', 'Sell/unit', 'Plot gross', 'Net/plot', 'Net/plot-h', 'XP', 'Mastery ★1/★2/★3/Gold', 'Ready hue', 'Model archetype'],
    crops.map((c) => [`\`${c.id}\``, c.name, c.unlock, hm(c.min), c.seed, c.yield, c.v, c.gross, c.gross - c.seed,
      round(((c.gross - c.seed) * 60) / c.min), c.xp, mastery(c.min).join(' / '), c.hue, c.arch])));
  out.push('### trees');
  out.push(table(['Id', 'Tree', 'Lvl', 'Price', 'Cycle', 'Sapling', 'Yield (mature)', 'Product', 'Sell/unit', 'Harvest value', 'XP', 'Payback (harvests)', 'Bee forage'],
    treePrices.map((t) => [`\`${t.id}\``, t.name, t.unlock, t.price, hm(t.cycle), hm(t.cycle * 2), t.yield,
      `\`${t.product}\``, t.v, t.harvest, t.xp, (t.price / t.harvest).toFixed(1), t.flowering ? 'yes' : 'no'])));
  out.push('### feeds');
  out.push(table(['Id', 'Feed', 'Lvl', 'Inputs', 'Time', 'Out', 'Value/unit (upkeep, not sold)'],
    feeds.map((f) => [`\`${f.id}\``, f.name, f.unlock, f.inputs.map(([c, q]) => `${q} ${c}`).join(' + '), hm(f.min), f.out, f.v])));
  out.push('### animals');
  out.push(table(['Id', 'Animal', 'Lvl', 'Home (cap start→max)', 'Baby price', 'Adult price', 'Baby grows', 'Eats', 'Cycle', 'Product', 'Sell', 'Net/collection', 'Net/h', 'XP', 'Blue ribbon after', 'Blue-ribbon good (10 % chance)'],
    animals.map((a) => [`\`${a.id}\``, a.name, a.unlock, a.id === 'bee' ? 'Beehive (1 colony per hive)' : `${HOMES[a.home][0]} (${a.capStart}→${a.capMax})`,
      a.id === 'bee' ? 'in hive price' : a.baby, a.id === 'bee' ? '—' : a.adult,
      a.babyMin ? hm(a.babyMin) : '—', a.feed ? `${a.feedQty} ${a.feed}` : 'flowers in range', hm(a.cycle),
      `${a.out} \`${a.product}\``, a.v, a.net, round((a.net * 60) / a.cycle), a.xp, a.prizedAt, `\`${a.premium}\` (${a.v * 4})`])));
  out.push('### homes');
  out.push(table(['Id', 'Housing', 'Lvl', 'Size (tiles)', 'Cost', 'Capacity upgrade (+2 animals; +1 hive slot for beehives)'],
    homes.map((h) => [`\`${h.id}\``, h.name, h.unlock, h.size.join('×'), h.cost, h.id === 'beehive' ? `each further hive ${fmt(h.cost)} × 1.1^(n−1)` : h.upgrade])));
  out.push('### buildings');
  out.push(table(['Id', 'Building', 'Lvl', 'Size', 'Cost', 'Slots start→max', 'Slot upgrade cost (k = 1, 2, 3 …)'],
    buildings.map((b) => [`\`${b.id}\``, b.name, b.unlock, b.size.join('×'), b.cost, `${b.slotsStart}→${b.slotsMax}`,
      Array.from({ length: b.slotsMax - b.slotsStart }, (_, k) => b.slotCost(k + 1)).join(' / ')])));
  out.push('### recipes');
  const byB = (id) => recipes.filter((r) => r.building === id).sort((a, b) => a.unlock - b.unlock || a.min - b.min);
  for (const b of buildings) {
    const rs = byB(b.id);
    if (!rs.length) continue;
    out.push(`#### ${b.name} (\`${b.id}\`)`);
    out.push(table(['Id', 'Recipe', 'Lvl', 'Inputs', 'Time', 'Out', 'Input value', 'Sell/unit', '× inputs', 'XP', 'Tier'],
      rs.map((r) => [`\`${r.id}\``, r.name, r.unlock, Object.entries(r.inputs).map(([i, q]) => `${q} ${i}`).join(' + '),
        r.duet ? `${hm(r.min)} duet / ${hm(r.min * 2)} solo` : hm(r.min), r.out, r.inVal, r.v, r.ratio.toFixed(2), r.xp, r.duet ? 'Duet' : r.tier])));
  }
  out.push('### levels');
  out.push(table(['Lvl', 'XP to next', 'Cumulative XP at level', 'Target play to next', 'Income target E (coins/h)', 'XP/h', 'Plot cap', 'Level-up coins', 'Acorns'],
    levels.map((l) => [l.L, l.toNext ?? `Legacy: ${fmt(legacyXp)} each`, l.cumAt, l.L < MAX_LEVEL ? hm(l.minutes) : '—', l.E, l.xpRate, l.plots, l.coins, l.acorns])));
  out.push('### income-parts');
  out.push(table(['Lvl', 'Crops', 'Animals', 'Trees', 'Crafting', 'Total E (×1.2 orders premium)'],
    levels.filter((l) => [1, 5, 10, 15, 20, 25, 30, 35, 40].includes(l.L)).map((l) =>
      [l.L, l.parts.cropPart, l.parts.animalPart, l.parts.treePart, l.parts.craftPart, l.E])));
  out.push('### plots');
  const PLOT_COLS = [17, 20, 30, 40, 60, 80, 100, 120, 140, 164];
  out.push(table(['Plot #', ...PLOT_COLS.map(String)], [['Price', ...PLOT_COLS.map(plotPrice)]]));
  out.push('### expansions');
  out.push(table(['#', 'Id', 'Expansion', 'Lvl', 'Coins', 'Planks', 'Crates', 'Proof task', 'Reveals'],
    expansions.map((x) => [x.k, `\`${x.id}\``, x.name, x.level, x.coins, x.planks, x.crates, x.proof, x.reveals])));
  out.push('### barn');
  out.push(table(['Upgrade', 'From lvl', 'Capacity after', 'Coins', 'Planks', 'Crates'],
    [['Start', 1, 200, 0, 0, 0], ...barnUpgrades.map((b) => [b.n, b.gate, b.cap, b.coins, b.planks, b.crates])]));
  out.push('### decor');
  out.push(table(['Id', 'Decoration', 'Lvl', 'Cost', 'Beauty', 'Size', 'Effect'],
    [...decor.map((d) => [`\`${d.id}\``, d.name, d.unlock, d.coins, d.beauty, d.size.join('×'), d.bonus]),
      ...ACORN_DECOR.map(([id, name, unlock, beauty, acorns, bonus]) => [`\`${id}\``, name, unlock, `${acorns} Acorns`, beauty, '—', bonus])]));
  out.push('### grand-decor');
  out.push(table(['Id', 'Grand decor', 'Lvl', 'Cost', 'Beauty', 'Size', 'Effect'],
    grandDecor.map((d) => [`\`${d.id}\``, d.name, d.unlock, d.coins, d.beauty, d.size.join('×'), d.bonus])));
  out.push('### quests');
  out.push(table(['#', 'Giver', 'Lvl', 'Quest', 'Tasks', 'Coins', 'XP', 'Extra reward'],
    quests.map((q) => [q.id.toUpperCase(), q.giver, q.level, q.title,
      q.tasks.map(([v, r, n]) => `${v} ${n} ${r}`).join('; '), q.coins, q.xp, q.extra])));
  out.push('### unlocks');
  out.push(table(['Lvl', 'Unlocks'], levels.map((l) => [l.L, unlocksAt(l.L).join('; ')])));
  out.push('### values');
  out.push([...V.entries()].map(([k, v]) => `${k}=${v}`).join(', '));
  console.log(out.join('\n\n'));
} else if (ARGS.has('--json')) {
  console.log(JSON.stringify({ C, crops, trees: treePrices, feeds, animals, recipes, buildings: buildings.map(({ slotCost, ...b }) => b), homes, levels,
    expansions, barnUpgrades, quests, grandDecor, owner4: [...OWNER4], secondCopies: SECOND_COPIES, expLevels: EXP_LEVELS, kAnchors: K_ANCHORS, xAnchors: X_ANCHORS,
    targetMin: Array.from({ length: MAX_LEVEL }, (_, i) => targetMin(i + 1)) }, null, 2));
} else {
  console.log(`items ${V.size}, crops ${crops.length}, trees ${trees.length}, animals ${animals.length}, recipes ${recipes.length}, buildings ${buildings.length}`);
  for (const l of levels) console.log(`L${l.L} E=${l.E} xp/h=${l.xpRate} next=${l.toNext} cum=${l.cumAt} plots=${l.plots}`);
  if (fails.length) { console.log(`\nFAILED ${fails.length} checks:`); for (const f of fails) console.log(' -', f); process.exit(1); }
  console.log('\nall checks passed');
}
