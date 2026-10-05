// Hand-authored per-id data that tools/gen-content.mjs folds into the GENERATED tables (crops.js, trees.js,
// decor.js, expansions.js, ...). Numbers that come from the economy model never live here: only what the
// model does not know (seasons, looks, effects in machine-readable form, land rectangles, proof tasks and the
// starter layout). After editing this file run `node tools/gen-content.mjs`; `test/content.gen.test.js`
// fails while a generated table is stale.
//
// No imports: the generator and config.js both read this file.

/** GDD §3.1 season table (Northern hemisphere): in season = -10 % grow time, +10 % sell price. */
export const SEASONS = Object.freeze({
  carrot: 'spring', strawberry: 'spring', lavender: 'spring', onion: 'spring',
  corn: 'summer', tomato: 'summer', sunflower: 'summer', blueberry: 'summer', watermelon: 'summer', pepper: 'summer',
  potato: 'autumn', pumpkin: 'autumn', oats: 'autumn', cotton: 'autumn', rice: 'autumn',
  wheat: 'winter', sugarcane: 'winter', cabbage: 'winter',
  // owner wish list 2026-10-04: raspberries ripen in summer, roses bloom in late spring, coffee is picked in winter
  raspberry: 'summer', rose: 'spring', coffee: 'winter',
});

/**
 * Tree looks (GDD §3.2 asset mapping): shape parameters so recolours read as different species, the fruit
 * colour (`hue`), the leaf colour and the harvest tool (Pine is chopped, the rest are shaken with the Basket).
 */
export const TREE_LOOKS = Object.freeze({
  apple_tree: { shape: { canopy: [1, 1, 1], trunk: 1, lean: 0 }, hue: '#E23B3B', leaf: '#4E9A3A', tool: 'basket' },
  pine: { shape: { canopy: [0.9, 1.45, 0.9], trunk: 1.1, lean: 0 }, hue: '#8A5A33', leaf: '#2F6B3C', tool: 'axe' },
  cherry_tree: { shape: { canopy: [1.05, 0.95, 1.05], trunk: 0.95, lean: 0.04 },
    hue: '#B5122E', leaf: '#5DA544', tool: 'basket' },
  orange_tree: { shape: { canopy: [1, 1, 1], trunk: 0.9, lean: 0 }, hue: '#F28C1E', leaf: '#3F8F3A', tool: 'basket' },
  lemon_tree: { shape: { canopy: [0.95, 1.05, 0.95], trunk: 0.9, lean: 0.02 },
    hue: '#F5D63D', leaf: '#4A9A3E', tool: 'basket' },
  peach_tree: { shape: { canopy: [1.3, 0.8, 1.3], trunk: 0.8, lean: 0.03 },
    hue: '#F7A26B', leaf: '#62A848', tool: 'basket' },
  pear_tree: { shape: { canopy: [0.8, 1.3, 0.8], trunk: 1.2, lean: 0 },
    hue: '#C9D14A', leaf: '#4C9440', tool: 'basket' },
  plum_tree: { shape: { canopy: [1.05, 1, 1.05], trunk: 1, lean: 0.05 },
    hue: '#6B2A6E', leaf: '#4F8E3C', tool: 'basket' },
  walnut_tree: { shape: { canopy: [1.25, 1.1, 1.25], trunk: 1.2, lean: 0.02 },
    hue: '#8B6B43', leaf: '#4A853A', tool: 'basket' },
  olive_tree: { shape: { canopy: [1.2, 0.75, 1.2], trunk: 0.75, lean: 0.08 },
    hue: '#6F7D3A', leaf: '#9AAE8C', tool: 'basket' },
  maple_tree: { shape: { canopy: [1.1, 1.2, 1.1], trunk: 1.1, lean: 0 },
    hue: '#C8452B', leaf: '#D9542C', tool: 'basket' },
  cocoa_tree: { shape: { canopy: [0.9, 1.1, 0.9], trunk: 0.9, lean: 0.04 },
    hue: '#8A4B2A', leaf: '#3E7F38', tool: 'basket' },
  fig_tree: { shape: { canopy: [1.15, 0.9, 1.15], trunk: 0.85, lean: 0.06 },
    hue: '#5B3A5E', leaf: '#5C9B45', tool: 'basket' },
  // owner wish #7: a small, rounded, slightly leaning tree with glossy dark leaves and red fruit
  pomegranate_tree: { shape: { canopy: [1.1, 0.9, 1.1], trunk: 0.8, lean: 0.05 },
    hue: '#C0213A', leaf: '#3F7F36', tool: 'basket' },
});

/**
 * Animal extras (GDD §3.4): what a baby takes to grow faster (chicks and ducklings take Chicken Feed, the rest a
 * Baby Bottle; bees have no babies) and the species sound for petting / tending feedback (§7.2).
 */
export const ANIMAL_EXTRAS = Object.freeze({
  chicken: { bottle: 'chicken_feed', sound: 'cluck' },
  cow: { bottle: 'baby_bottle', sound: 'moo' },
  sheep: { bottle: 'baby_bottle', sound: 'baa' },
  bee: { bottle: null, sound: 'buzz' },
  pig: { bottle: 'baby_bottle', sound: 'oink' },
  duck: { bottle: 'chicken_feed', sound: 'quack' },
  goat: { bottle: 'baby_bottle', sound: 'bleat' },
  horse: { bottle: 'baby_bottle', sound: 'neigh' },
  alpaca: { bottle: 'baby_bottle', sound: 'hum' },
  // owner wish #3: kits nibble Rabbit Greens to grow faster; a rabbit "says" a soft hind-foot thump
  rabbit: { bottle: 'rabbit_greens', sound: 'thump' },
});

/**
 * Decor effects in machine-readable form (GDD §3.8 "Effect" column). Keys:
 *   forage: n                     counts as n bee-forage objects (§3.4 Bees)
 *   bonus: { target, radius, bp } `target` 'crops' | 'trees' within `radius` tiles (Chebyshev distance from the
 *                                 footprint) get bp/10000 chance of +1 unit; never stacks with itself (§3.8)
 *   water: { radius }             waters every crop planted within `radius` tiles at the moment it is planted
 *   inSeason: { radius }          crops within `radius` tiles count as in season (§3.1 rule 8)
 *   seats: 2                      a two-seat Golden Hour bench (§6.2 mechanic 9)
 *   heartsPerGoldenHour: n        +n Hearts each per Golden Hour on this seat
 *   pathBonusBp: bp               decor touching this path tile gets +bp/10000 beauty (§5.9)
 *   autojoin: true                fence pieces join their neighbours (render)
 *   petHome: 'dog' | 'cat'        home of a pet (§3.4 Pets, L10)
 *   cosmetic: string              a pure-juice effect for the renderer (glow, chime, spin, petals, ...)
 */
export const DECOR_EFFECTS = Object.freeze({
  flower_bed: { forage: 1 },
  picket_fence: { autojoin: true },
  dirt_path: { pathBonusBp: 1000 },
  sunset_bench: { seats: 2 },
  scarecrow: { bonus: { target: 'crops', radius: 3, bp: 500 } },
  hay_bales: {},
  wind_chime: { cosmetic: 'chime' },
  wheelbarrow: { forage: 1 },
  bird_bath: { bonus: { target: 'trees', radius: 3, bp: 500 } },
  lantern: { cosmetic: 'glow' },
  sprinkler: { water: { radius: 2 } },
  dog_house: { petHome: 'dog' },
  cat_basket: { petHome: 'cat' },
  rose_arch: { forage: 1, cosmetic: 'walkway' },
  stone_well: { cosmetic: 'coins' },
  windmill_toy: { cosmetic: 'spin' },
  beehive_skep: { forage: 1 },
  bench_swing: { seats: 2 },
  fountain: { cosmetic: 'water' },
  topiary: {},
  greenhouse_frame: { inSeason: { radius: 2 } },
  gazebo: { seats: 2 },
  pond_dock: { cosmetic: 'fishing' },
  statue_cow: {},
  hot_air_balloon: { cosmetic: 'photo' },
  golden_scarecrow: { bonus: { target: 'crops', radius: 4, bp: 500 } },
  heart_arbor: { seats: 2, heartsPerGoldenHour: 1 },
  cherry_blossom: { forage: 2, cosmetic: 'petals' },
  star_lanterns: { cosmetic: 'glow' },
  grandma_rocker: { cosmetic: 'memory' },
  golden_cow_statue: {},
  grand_windmill: { cosmetic: 'spin' },
  flower_maze: { forage: 3, cosmetic: 'walkway' },
  koi_pond: { seats: 2 },
  carousel: { cosmetic: 'night_lights' },
  treehouse: { seats: 2 },
  clock_tower: { cosmetic: 'chime' },
  orangery: { cosmetic: 'glow' },
  arbor_of_lights: { seats: 2, cosmetic: 'fireflies' },
  bath_house: { seats: 2, cosmetic: 'steam' },
  golden_gate: { cosmetic: 'farm_name' },
});

/** Footprints the model leaves open: Acorn decor (§3.8 lists "—"). */
export const ACORN_DECOR_SIZE = Object.freeze({
  golden_scarecrow: [1, 1], heart_arbor: [2, 1], cherry_blossom: [2, 2],
  star_lanterns: [3, 1], grandma_rocker: [1, 1], golden_cow_statue: [2, 2],
});

/** Decor that lives on the ground layer (paths); everything else is on the object layer. */
export const GROUND_DECOR = Object.freeze(['dirt_path']);

/**
 * Land expansions (GDD §2.2 parcel map, §3.9). `rects` are [x, z, w, d] in tiles; every expansion touches land
 * owned before it. `proof` is the proof task as quest-style tasks (counted from the first opening of the card).
 * `free` objects arrive with the land; trees marked `mature` skip the sapling cycles and do not count toward
 * the n-th-tree price (ruling X7f). `feature` holds the named feature's rule effect, if it has one.
 */
export const EXPANSION_LAND = Object.freeze({
  creekside: { rects: [[40, 24, 8, 16]], proof: [['harvest', 'wheat', 30], ['collect', 'egg', 10]],
    free: [{ def: 'pine', x: 44, z: 28, mature: true }] },
  old_orchard: { rects: [[16, 40, 16, 8]], proof: [['own', 'apple_tree', 2], ['make', 'apple_juice', 3]],
    free: [{ def: 'apple_tree', x: 18, z: 42, mature: true }, { def: 'apple_tree', x: 20, z: 42, mature: true }] },
  cow_hill: { rects: [[32, 40, 16, 8]], proof: [['collect', 'milk', 10], ['make', 'butter', 3]],
    free: [{ def: 'flower_bed', x: 42, z: 42 }, { def: 'flower_bed', x: 43, z: 42 },
      { def: 'flower_bed', x: 42, z: 43 }] },
  sunflower_rise: { rects: [[16, 16, 16, 8]], proof: [['make', 'strawberry_jam', 3]],
    free: [{ def: 'scarecrow', x: 23, z: 19 }] },
  bee_glade: { rects: [[32, 16, 16, 8]], proof: [['make', 'yarn', 4], ['own', 'pasture', 1]],
    free: [{ def: 'beehive', x: 41, z: 19, colony: true }, { def: 'flower_bed', x: 43, z: 19 },
      { def: 'flower_bed', x: 43, z: 20 }] },
  fair_lane: { rects: [[8, 48, 16, 8]], proof: [['make', 'apple_pie', 2], ['fill', 'order', 10]], free: [] },
  riverbank: { rects: [[24, 48, 16, 8]], proof: [['make', ['cotton_tote', 'wool_pillow'], 3]], free: [],
    feature: { bargeRowBonusBp: 2500 } },
  pig_woods: { rects: [[40, 48, 16, 8]], proof: [['collect', 'truffle', 5]], free: [],
    feature: { truffleSpeedBp: 1000 } },
  // the pond's own dock is the fishing spot of GDD §6.2 mechanic 21 (M2); until then the pond is scenery. The pond
  // lies in the ring west of the parcel (the board stays flat, §2.4); the dock leaves the farm at tile (8, 28)
  // (render/ground.js POND_DOCK, wave 3)
  willow_pond: { rects: [[8, 16, 8, 16]], proof: [['collect', 'duck_egg', 8]], free: [],
    feature: { fishingSpot: { x: 8, z: 28 } } },
  goat_rocks: { rects: [[48, 16, 8, 16]], proof: [['make', 'goat_cheese', 3]],
    free: [{ def: 'sunset_bench', x: 51, z: 22 }] },
  stable_paddock: { rects: [[8, 32, 8, 16]], proof: [['make', 'picnic_basket', 2]], free: [] },
  walnut_grove: { rects: [[48, 32, 8, 16]], proof: [['harvest', 'walnut', 30]],
    free: [{ def: 'walnut_tree', x: 50, z: 36, mature: true }, { def: 'walnut_tree', x: 52, z: 36, mature: true }] },
  olive_terrace: { rects: [[8, 8, 16, 8]], proof: [['make', 'olive_oil', 4]], free: [] },
  maple_ridge: { rects: [[24, 8, 16, 8]], proof: [['make', 'maple_syrup', 3]], free: [] },
  sunset_hill: { rects: [[40, 8, 16, 8]], proof: [['make', 'gourmet_hamper', 2]],
    free: [{ def: 'gazebo', x: 47, z: 10 }], feature: { goldenHourBonusMs: 600_000 } },
});

/** Debris mix of every purchased expansion (GDD §2.3: 6 weeds, 4 rocks, 3 stumps, 2 logs = 68 XP, 12 Wood). */
export const EXPANSION_DEBRIS_MIX = Object.freeze({ weed: 6, rock: 4, stump: 3, log: 2 });
/**
 * The M2 land (expansions 11-15) is old woodland: one of its stumps is a Big Stump (GDD §4.5: 30 XP; §6.2 mechanic 8:
 * chopped faster together), so the Big Stump def has a home and every new parcel has one together moment
 * (wave 3: 6 weeds, 4 rocks, 2 stumps, 2 logs, 1 big stump = 90 XP, 450 coins, 14 Wood).
 */
export const EXPANSION_DEBRIS_MIX_M2 = Object.freeze({ big_stump: 1, weed: 6, rock: 4, stump: 2, log: 2 });
/** Starter debris (GDD §2.3: 8 weeds, 6 rocks, 4 stumps, 4 logs, 2 boulders = 40 XP, 200 coins, 20 Wood). */
export const HOME_DEBRIS_MIX = Object.freeze({ weed: 8, rock: 6, stump: 4, log: 4, boulder: 2 });

/**
 * The Homestead (GDD §2.3). Offsets in the GDD are from the Homestead's north-west corner (16, 24); these are
 * absolute tiles. `plots` is the 4x4 block at offset (8, 6). The picket fence rings the block with a two-tile
 * gate on the west side, facing the farmhouse porch. Dirt paths join the porch, the gate, the market road and
 * the barn door. `keepClear` rectangles stay free of starter debris (porch, barn door, market road).
 */
export const HOME_LAYOUT = Object.freeze({
  structures: [
    { def: 'farmhouse', x: 17, z: 25 },
    { def: 'barn', x: 33, z: 25 },
    { def: 'well', x: 29, z: 26 },
    { def: 'mailbox', x: 21, z: 28 },
    { def: 'market_stand', x: 18, z: 36 },
    { def: 'order_board', x: 21, z: 37 },
  ],
  plots: { x: 24, z: 30, w: 4, d: 4 },
  fence: { x: 23, z: 29, w: 6, d: 6, gate: [[23, 31], [23, 32]] },
  paths: [
    [17, 29, 6, 1],     // farmhouse porch
    [22, 30, 1, 5],     // porch -> fence gate -> market road
    [17, 35, 20, 1],    // market road
    [31, 29, 1, 6],     // road -> barn
    [32, 29, 5, 1],     // barn door
  ],
  keepClear: [[16, 29, 8, 1], [32, 29, 6, 1], [17, 34, 8, 2]],
});

/** Where each avatar stands at first (the farmhouse porch), in tiles. */
export const SPAWN = Object.freeze({ p1: Object.freeze({ x: 20.5, z: 29.5 }), p2: Object.freeze({ x: 22, z: 29.5 }) });

/**
 * The first evening's quest graph (GDD §7.4, wave-1 QA RC-01). The model lists the A chain in order; the onboarding
 * runs two PARALLEL tracks: Fields (A1, A2, A4) and Barnyard (A3), meeting at A5. `after` replaces the chain's
 * previous quest; `alsoAfter` lists more quests of the same chain that must be done too. `retro` maps a task index
 * to the farm stat that pre-credits it ONCE when the card is accepted (the scripted first order is filled before
 * A4 can open; Flour made before A5 opens): the card counts what the farm did since the system arrived.
 */
export const QUEST_FLOW = Object.freeze({
  a4: { after: 'a2', retro: { 0: 'ordersQ' } },
  a5: { after: 'a4', alsoAfter: ['a3'], retro: { 1: 'craft.flour' } },
});

/**
 * Defs the GDD level table unlocks in M1a whose purpose ships later (wave-1 QA RC-30): the pet goods and pet homes
 * wait for the pets themselves (M1b; rules-economy builds them in wave 2, shared/rules/actions/pets.js).
 * gen-content moves them to that milestone.
 */
export const MILESTONE_LATER = Object.freeze({
  dog_biscuit: 'M1b', cat_treat: 'M1b', dog_house: 'M1b', cat_basket: 'M1b',
});
