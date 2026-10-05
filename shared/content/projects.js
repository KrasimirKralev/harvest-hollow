// Long-term systems of M1b/M2 (data only in the M1a build): the Restoration Ledger, Town Projects, Farm Beauty,
// decor sets, Masterwork, the Seasonal Ribbon Track and Legacy levels (GDD §5.9). Hand-authored.
import { h } from './units.js';

// a slot is [item, qty], [specialRef, qty, 'special'] or a number: a coin slot of that many E-hour basis points
const slotOf = (s) => {
  if (typeof s === 'number') return { coinsHoursBp: s };
  return s[2] === 'special' ? { special: s[0], qty: s[1] } : { item: s[0], qty: s[1] };
};
const bundle = (id, name, need, slots) => ({ id, name, need, slots: slots.map(slotOf) });

/**
 * Restoration Ledger (L16). Six projects in order; each has 4 bundles; each bundle is "any `need` of its slots" so no
 * single item can block it. Either partner donates any item, piece by piece; the whole farm gets the permanent reward.
 * A coin slot is E(project level) x coinsHoursBp. Fair-prize slots use special refs.
 */
export const RESTORATION = [
  { id: 'greenhouse', name: 'Old Greenhouse', n: 1, unlock: 16, m: 'M1b', bundles: [
    bundle('seedlings', 'Seedlings', 5, [['wheat', 20], ['carrot', 20], ['corn', 10], ['strawberry', 6], ['tomato',
      9], ['potato', 6], ['pumpkin', 2]]),
    bundle('glass', 'Glass & Frames', 3, [['planks', 12], ['wooden_crate', 2], 5000]),
    // any 3 of 6: two slots the farm already makes at L16 (wave-2 QA D2: no citrus on the farm when the bundle asks)
    bundle('orchard_gift', 'Orchard Gift', 3, [['apple', 10], ['cherry', 8], ['orange', 8], ['lemon', 8],
      ['apple_juice', 4], ['cherry_jam', 2]]),
    bundle('kitchen_garden', 'Kitchen Garden', 3, [['veggie_soup', 3], ['pumpkin_soup', 2], ['coleslaw', 2],
      ['ketchup', 3], ['sauerkraut', 2]]),
  ], reward: { greenhouse: { size: [6, 4], plots: 12, alwaysInSeason: true } },
  text: 'A glasshouse with 12 plots beyond the plot cap, always in season.' },
  { id: 'mill_wheel', name: 'Mill Wheel', n: 2, unlock: 19, m: 'M1b', bundles: [
    bundle('grain', 'Grain', 4, [['wheat', 30], ['corn', 20], ['oats', 15], ['sunflower', 6], ['sugarcane', 10]]),
    bundle('bakehouse', 'Bakehouse', 3, [['bread', 6], ['corn_bread', 3], ['cookies', 3], ['blueberry_muffin', 2],
      ['granola_bar', 2]]),
    bundle('millwright', 'Millwright', 2, [['planks', 16], ['wooden_crate', 4]]),
    bundle('dairy', 'Dairy', 3, [['milk', 8], ['butter', 4], ['cheese', 3], ['yogurt', 3]]),
  ], reward: { buildingTimeBp: { feed_mill: 2000,
    mill: 2000 } }, text: 'Feed Mill and Windmill recipes take 20 % less time.' },
  { id: 'stone_bridge', name: 'Stone Bridge', n: 3, unlock: 22, m: 'M1b', bundles: [
    bundle('timber', 'Timber', 2, [['planks', 24], ['wooden_crate', 6]]),
    bundle('woolly', 'Woolly', 3, [['wool', 6], ['yarn', 6], ['scarf', 2], ['sweater', 1]]),
    bundle('sweet', 'Sweet', 3, [['strawberry_jam', 3], ['cherry_jam', 3], ['orange_marmalade', 3], ['honey', 3],
      ['ice_cream', 2]]),
    bundle('fair_prizes', 'Fair Prizes', 2, [['prized_crop', 3, 'special'], ['prized_animal_good', 1, 'special'],
      ['prized_fruit', 1, 'special']]),
  ], reward: { land: { id: 'hollow_meadow', rects: [[0, 8, 8, 16]], plotCap: 6, forage: 3 } },
  text: 'Hollow Meadow: two extra parcels of wildflowers beyond the north-west edge, +6 plot cap.' },
  { id: 'orchard_pond', name: 'Orchard Pond', n: 4, unlock: 25, m: 'M2', bundles: [
    bundle('fruit', 'Fruit', 4, [['apple', 10], ['cherry', 10], ['peach', 10], ['pear', 10], ['plum', 10], ['lemon',
      10]]),
    bundle('pond', 'Pond', 3, [['duck_egg', 10], ['custard', 2], ['lemon_meringue_pie', 2], ['golden_feather', 1]]),
    bundle('press', 'Press', 3, [['apple_juice', 4], ['orange_juice', 4], ['lemonade', 4], ['pear_nectar', 3]]),
    bundle('candles', 'Candles', 2, [['honey_candle', 3], ['lavender_candle', 3], ['lavender_soap', 2]]),
  ], reward: { treeCycleBp: 1000 }, text: 'Irrigation: every tree ripens 10 % faster.' },
  { id: 'fair_grounds', name: 'Town Fair Grounds', n: 5, unlock: 28, m: 'M2', bundles: [
    bundle('pies', 'Pies', 4, [['apple_pie', 2], ['cherry_pie', 2], ['pumpkin_pie', 2], ['blueberry_pie', 2],
      ['peach_cobbler', 2], ['plum_cake', 2]]),
    bundle('textiles', 'Textiles', 3, [['sweater', 2], ['picnic_blanket', 2], ['quilt', 1], ['wool_pillow', 2]]),
    bundle('hampers', 'Hampers', 2, [['breakfast_hamper', 1], ['picnic_basket', 1], ['spa_basket', 1]]),
    bundle('livestock', 'Livestock', 3, [['golden_egg', 1], ['cream_top_milk', 1], ['silk_wool', 1],
      ['black_truffle', 1]]),
  ], reward: { fairPlatinum: true, topLeague: true, fairEntriesPerItem: 1 },
  text: 'The Fair Platinum tier, the top NPC league and one more Fair entry per item a week.' },
  { id: 'farmhouse', name: 'Grandma\'s Farmhouse', n: 6, unlock: 34, m: 'M2', bundles: [
    bundle('comfort', 'Comfort', 3, [['quilt', 2], ['alpaca_shawl', 2], ['honey_candle', 3], ['wool_pillow', 2]]),
    bundle('larder', 'Larder', 4, [['truffle_oil', 2], ['maple_syrup', 2], ['olive_oil', 2], ['plum_jam', 3],
      ['pickled_peppers', 2], ['goat_cheese', 2]]),
    bundle('sweets', 'Sweets', 3, [['maple_fudge', 2], ['wedding_cake', 2], ['cookies', 3], ['walnut_honey_cake', 2]]),
    bundle('woodwork', 'Woodwork', 3, [['planks', 30], ['wooden_crate', 8], ['toy_horse', 2]]),
  ], reward: { interior: true, kitchenSlots: 1, beat: 'grandma_visits' },
  text: 'Farmhouse interior decorating, the Memory Book wall, Grandma\'s duet table (+1 Kitchen slot) and her visit.' },
];

/** Fair-prize slot refs of the Stone Bridge (counted from produced blue-ribbon goods). */
export const RESTORATION_SPECIALS = ['prized_crop', 'prized_animal_good', 'prized_fruit'];

/**
 * Town Projects, the Hollow Village (L20): one at a time; the couple donates a goods bundle worth about E x 2 h
 * (three goods made in the last 14 days and makeable now, never raw crops; each at most 4 h of the producers owned)
 * and funds E(L) x (10 + 0.5 (n - 1)) hours of coins; the project is built the next day and pays 5 Acorns, a souvenir
 * decor and a Memory Book page. After the 24th the Festival Pavilion repeats at the same formula.
 */
export const TOWN_PROJECT_RULES = {
  unlock: 20, m: 'M1b', goodsHoursBp: 20_000, goods: 3, madeWithinMs: h(24 * 14), coinsHoursBaseBp: 100_000,
  coinsHoursStepBp: 5000, buildMs: h(24), acorns: 5, repeatable: 'festival_pavilion',
  /** A good's quantity cap: what the producers the farm owns make in this long (wave-2 QA RC-02; final pass 4 h ->
   * 2 h: four Sweetheart Cakes, 16 Cat Treats or 72 Eggs held the first project past L23 on the real rules). */
  producerCapMs: h(2),
};
// [id, name, what the village says when it is built] in Ollie's order; the first four are M1b (GDD §10)
const TOWN = [
  ['ferry_landing', 'Ferry Landing', 'The ferry crosses again: the village can reach the farm, and the farm the '
    + 'village.'],
  ['chapel', 'Little Chapel', 'The bell rings on Sundays again, and once more for the two of you.'],
  ['bandstand', 'Bandstand', 'A brass band on summer evenings; you can hear it from the porch.'],
  ['schoolhouse', 'Schoolhouse', 'Children in the lanes again, and a class trip to see the animals.'],
  ['lighthouse', 'Lighthouse', 'A light at the river mouth, so the barge comes home in the dark.'],
  ['village_carousel', 'Village Carousel', 'Painted horses go round on the green every weekend.'],
  ['village_bakery', 'Village Bakery', 'Bread in the village window, baked with your Flour.'],
  ['millpond_bridge', 'Mill Pond Bridge', 'A footbridge over the mill pond for evening walks.'],
  ['library', 'Library', 'Grandma\'s old almanacs find a shelf, and so do a few love stories.'],
  ['flower_market', 'Flower Market', 'Buckets of flowers every Saturday, some of them yours.'],
  ['post_office', 'Post Office', 'Letters arrive the same day now, even from the seaside.'],
  ['tea_room', 'Tea Room', 'Scones, your jam and a window table for two.'],
  ['clock_square', 'Clock Square', 'The square clock keeps the village to time, mostly.'],
  ['watermill', 'Watermill', 'The old wheel turns again on the river.'],
  ['boathouse', 'Boathouse', 'Rowing boats for hire, two seats each.'],
  ['village_green', 'Village Green', 'Picnics, cricket and a maypole in spring.'],
  ['music_hall', 'Music Hall', 'Dances on Friday nights. Someone will insist you go.'],
  ['harbour_inn', 'Harbour Inn', 'Captain Reed finally has somewhere to tell his stories.'],
  ['observatory', 'Observatory', 'A telescope on the hill for clear winter nights.'],
  ['craft_hall', 'Craft Hall', 'Weavers, potters and carpenters share one long workshop.'],
  ['glasshouse_garden', 'Glasshouse Garden', 'Oranges and palms under glass, warm all winter.'],
  ['skating_pond', 'Skating Pond', 'In winter the pond freezes and the whole village skates.'],
  ['orchard_walk', 'Orchard Walk', 'A blossom walk from the village to Juniper\'s orchard.'],
  ['festival_arch', 'Festival Arch', 'Lanterns over the road for every festival of the year.'],
];
export const TOWN_PROJECTS = TOWN.map(([id, name, text], i) => ({ id, name, n: i + 1, m: i < 4 ? 'M1b' : 'M2',
  souvenir: `${id}_souvenir`, text }));

/** Farm Beauty (L18): score = sum of decor beauty (2nd copy 50 %, later 25 %; +10 % touching a path; sets +25 %;
 * Masterwork x1.5 / x2) + 3 per building + 2 per tree. Each new star: 3 Acorns and +1 % order coins (max +5 %). */
export const FARM_BEAUTY = {
  unlock: 18, m: 'M1b', stars: [50, 150, 400, 900, 1800], copyBp: [10_000, 5000, 2500], pathBp: 1000, setBp: 2500,
  building: 3, tree: 2, starAcorns: 3, orderCoinsBpPerStar: 100, showcaseFrom: 38,
};

/**
 * Decor sets (L18, Carousel at L29): completion within `radius` tiles gives +25 % beauty to the set and a cosmetic.
 * Every piece can be had on demand (store decor or a story-quest reward), never only from a seasonal Daily Gift
 * or a weekly prize: a set that waits for an autumn day 28 is a dead goal. A decor piece belongs to one set at
 * most, so "is this set complete" never depends on which set claimed a shared lantern (wave 2, index.js checks both).
 */
export const DECOR_SETS = [
  { id: 'cottage_garden', name: 'Cottage Garden', unlock: 18, m: 'M1b', radius: 6, cosmetic: 'butterflies',
    pieces: ['flower_bed', 'picket_fence', 'rose_arch', 'bird_bath', 'wheelbarrow'] },
  { id: 'harvest_fair', name: 'Harvest Fair', unlock: 18, m: 'M1b', radius: 6, cosmetic: 'bunting',
    pieces: ['scarecrow', 'hay_bales', 'wind_chime', 'windmill_toy', 'beehive_skep'] },
  { id: 'seaside', name: 'Seaside', unlock: 18, m: 'M2', radius: 6, cosmetic: 'gulls',
    pieces: ['pond_dock', 'rope_coil', 'stone_well', 'fountain'] },
  { id: 'winter_lights', name: 'Winter Lights', unlock: 18, m: 'M1b', radius: 6, cosmetic: 'lanterns',
    pieces: ['lantern', 'star_lanterns', 'topiary', 'bench_swing'] },
  { id: 'carousel_set', name: 'Carousel', unlock: 29, m: 'M2', radius: 6, cosmetic: 'music',
    pieces: ['carousel', 'gazebo', 'statue_cow', 'golden_cow_statue'] },
];

/** Masterwork (L18): every coin decor upgrades twice, for 4 x and 16 x its price, to 1.5 x / 2 x beauty. */
export const MASTERWORK = { unlock: 18, m: 'M1b', priceMul: [4, 16], beautyBp: [15_000, 20_000] };

/**
 * Seasonal Ribbon Track (L24): one free 30-tier track per real season (the farm's calendar, calendar.seasonOf).
 * Points = farm XP earned in the season; a tier needs nice(tierHours x XP/h at the farm level when the season
 * started) (CONTENT.levels[L-1].E / 8 x X ~ the "XP/h" column of GDD §4.6). Tier rewards (`rewards[i]` is tier i+1,
 * claimed by either farmer for the farm; `hearts` go to EACH player):
 *   { coinsHoursBp }  coins E(level now) x bp     { items }      goods into the Barn   { goldenSeeds: n } packets
 *   { seedPacket: n } packets of 5 plantings      { hearts: n }  Hearts each           { acorns: n }
 *   { decor: id | 'season' }  a free reward decor ('season' = the season's planter, DAILY_GIFT.seasonDecor)
 *   { coat: 'season' }  the season's coat (BREEDING.seasonCoats) for one animal the couple chooses
 * Points left at the season's end convert to coins: E x leftoverCoinsHoursBp per unfinished tier's worth (GDD:
 * "E x 0.05 h"), never more than the tiers left. The GDD's outfit pieces wait for the wardrobe (Hearts shop, not in
 * the M2 build): their tiers pay Hearts instead, which that shop will spend.
 */
export const SEASONAL_TRACK = {
  unlock: 24, m: 'M2', tiers: 30, tierHours: 1, acornTiers: [10, 20, 30], acorns: 5, leftoverCoinsHoursBp: 500,
  rewards: [
    { hearts: 3 }, { items: { compost: 3 } }, { seedPacket: 1 }, { coinsHoursBp: 1000 },
    { decor: 'season' },
    { hearts: 3 }, { items: { compost: 3 } }, { goldenSeeds: 1 }, { coinsHoursBp: 1500 },
    { acorns: 5 },
    { hearts: 3 }, { seedPacket: 1 }, { items: { compost: 5 } }, { coinsHoursBp: 2000 },
    { decor: 'season_pennant' },
    { hearts: 5 }, { goldenSeeds: 1 }, { items: { compost: 5 } }, { coinsHoursBp: 2500 },
    { acorns: 5 },
    { hearts: 5 }, { seedPacket: 1 }, { coinsHoursBp: 3000 }, { goldenSeeds: 1 }, { coat: 'season' },
    { hearts: 5 }, { items: { compost: 6 } }, { coinsHoursBp: 4000 }, { goldenSeeds: 1 },
    { acorns: 5, decor: 'season_trophy' },
  ],
};

/**
 * Legacy levels (after 40, GDD §5.9): flat XP per level (levelFromXp extrapolates the L39 -> 40 step), the level-up
 * coins and Acorns of the last row, and one reward from a rotating pool: Legacy level n (41, 42, ...) pays
 * `pool[(n - 41) % pool.length]`. Shapes as in SEASONAL_TRACK.rewards. The GDD's outfit piece pays Hearts until the
 * wardrobe ships; its "decor / statue variant" is the Legacy Statue, whose plaque shows the level it was won at.
 */
export const LEGACY = {
  m: 'M2', from: 41,
  pool: [{ acorns: 10 }, { goldenSeeds: 1 }, { hearts: 10 }, { acorns: 10 }, { decor: 'legacy_statue' }],
};

/**
 * The Festival Pavilion (GDD §5.9: "After the 24th, repeatable Festival Pavilion tiers continue at the same
 * formula"): Town Project n >= 25 is Pavilion tier n - 24, with TOWN_PROJECT_RULES' goods and coin formula (n keeps
 * counting), 5 Acorns and a Memory Book page; its souvenir only on the first tier. `tiers` name what each tier adds to
 * the pavilion on the village green (the last one repeats as "tier n" for ever after).
 */
export const FESTIVAL_PAVILION = {
  m: 'M2', after: 24, souvenir: 'pavilion_souvenir',
  tiers: [
    { name: 'The Pavilion Frame', text: 'Posts and beams on the village green, ready for every festival.' },
    { name: 'Bunting and Pennants', text: 'Flags in every colour of the farm.' },
    { name: 'The Lantern Roof', text: 'A roof of paper lanterns that glows across the river.' },
    { name: 'The Dance Floor', text: 'Oak boards for the Friday dances, sanded smooth.' },
    { name: 'The Bandstand Wing', text: 'Room for a brass band and a choir.' },
    { name: 'Flower Garlands', text: 'Fresh garlands every season, some of them from your fields.' },
    { name: 'The Festival Bell', text: 'A bell that rings when a festival begins.' },
    { name: 'The Golden Weathervane', text: 'A golden rooster on top, pointing at the farm.' },
  ],
};
