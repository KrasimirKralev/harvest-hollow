// Reward decor (GDD §3.8: "achievement trophies, Mastery Signs, Fair ribbons, collection display pieces and Town
// Project souvenirs are free decor earned in play"). Hand-authored. Never sold in the store (shop: false, cost 0);
// they join CONTENT.decor next to the generated coin / Acorn / Grand decor and follow the same placement and
// beauty rules (beauty10 = beauty in tenths). `source` says what grants them.
import { TOWN_PROJECTS } from './projects.js';

const reward = (id, name, m, size, beauty, source, effect = {}, text = '') => ({
  id, name, m, kind: 'decor', layer: 'object', size, unlock: 1, tier: 'reward', shop: false, cost: 0, acorns: 0,
  beauty10: beauty * 10, perTile: false, effect, text, source, model: `decor/${id}`,
});

export const TROPHIES = [
  // quests (story.js rewards)
  reward('jam_shelf', 'Jam-Jar Shelf', 'M1a', [1, 1], 8, 'quest:b3', {}, 'Mabel\'s thank-you for the first jam.'),
  reward('mabel_stall', 'Mabel\'s Stall Sign', 'M1b', [2, 1], 14, 'quest:b5'),
  reward('melon_awning', 'Melon-Stand Awning', 'M2', [2, 1], 20, 'quest:b6'),
  reward('gold_scale', 'Mabel\'s Gold Scale', 'M2', [1, 1], 30, 'quest:b9'),
  reward('pig_mud_bath', 'Pig Mud Bath', 'M1b', [2, 2], 16, 'quest:c4'),
  reward('saddle_rack', 'Saddle Rack', 'M1b', [1, 1], 18, 'quest:c7'),
  reward('olive_jar', 'Olive Jar', 'M2', [1, 1], 22, 'quest:d6'),
  reward('fig_crate', 'Fig Crate', 'M2', [1, 1], 26, 'quest:d9'),
  reward('rope_coil', 'Rope Coil', 'M1b', [1, 1], 14, 'quest:f2'),
  reward('silver_rosette', 'Silver Rosette Stand', 'M1b', [1, 1], 24, 'quest:g3'),
  reward('hamper_rosette', 'Hamper Rosette', 'M2', [1, 1], 28, 'quest:g5'),
  reward('giant_trophy', 'Giant-Pumpkin Trophy', 'M1b', [2, 2], 30, 'quest:h4'),
  // ribbons (GDD §5.4: F Silver = a silver rosette decor, F Gold = a gold trophy decor)
  reward('ribbon_rosette', 'Ribbon Rosette', 'M1a', [1, 1], 10, 'ribbon:silver', {},
    'A silver rosette for a farm ribbon.'),
  reward('ribbon_trophy', 'Ribbon Trophy', 'M1a', [1, 1], 20, 'ribbon:gold', {}, 'A gold trophy for a farm ribbon.'),
  // mastery (GDD §4.8: ★3 Mastery Sign, Gold sign)
  reward('mastery_sign', 'Mastery Sign', 'M1a', [1, 1], 6, 'mastery:3', {},
    'Shows the crop, tree or animal you mastered.'),
  reward('mastery_sign_gold', 'Gold Mastery Sign', 'M2', [1, 1], 12, 'mastery:gold'),
  // Couple Challenge prizes (GDD §5.8: "a decor piece"), one per week in this order, then repeating
  reward('bunting', 'Bunting Line', 'M1a', [2, 1], 8, 'challenge', {}, 'Little flags for a big week.'),
  reward('bird_feeder', 'Bird Feeder', 'M1a', [1, 1], 8, 'challenge', { cosmetic: 'birds' }),
  reward('garden_gnome', 'Garden Gnome', 'M1a', [1, 1], 8, 'challenge'),
  reward('milk_churn', 'Milk Churn', 'M1a', [1, 1], 8, 'challenge'),
  reward('flower_cart', 'Flower Cart', 'M1a', [2, 1], 10, 'challenge', { forage: 1 }),
  reward('lucky_horseshoe', 'Lucky Horseshoe Post', 'M1a', [1, 1], 8, 'challenge'),
  // the weekly systems' own decor, found by `source` (wave 3, rules-goals: fair.js and barge.js pay them)
  reward('fair_trophy', 'County Fair Trophy', 'M1b', [1, 1], 24, 'fair:gold', {},
    'A Gold medal week at the County Fair.'),
  reward('champion_banner', 'Champion Banner', 'M2', [1, 2], 30, 'fair:platinum', {},
    'Platinum at the County Fair: the best farm in the county.'),
  reward('captains_lantern', 'Captain\'s Lantern', 'M1b', [1, 1], 14, 'barge', { cosmetic: 'glow' },
    'From Captain Reed\'s chest. It still smells of the river.'),
  reward('ship_bell', 'Ship\'s Bell', 'M1b', [1, 1], 16, 'barge', {}, 'From Captain Reed\'s chest. Ring it twice for friends.'),
  // M2 (wave 3): Friendly Duel, the Seasonal Ribbon Track, Legacy levels and the Festival Pavilion
  reward('duel_pennant', 'Friendly Duel Pennant', 'M2', [1, 1], 10, 'duel', {},
    'From your first Friendly Duel. Nobody remembers who won.'),
  reward('season_pennant', 'Season Pennant', 'M2', [1, 1], 12, 'track:15', { cosmetic: 'season' },
    'Flies the colours of the season it was won in.'),
  reward('season_trophy', 'Season Ticket Trophy', 'M2', [1, 1], 25, 'track:30', {},
    'A whole Seasonal Ribbon Track, every tier.'),
  reward('legacy_statue', 'Legacy Statue', 'M2', [1, 1], 30, 'legacy', {},
    'A little bronze farmer on a plinth; the plaque shows the Legacy level.'),
  reward('pavilion_souvenir', 'Festival Pavilion Souvenir', 'M2', [1, 1], 20, 'town:festival_pavilion'),
  // Daily Gift (GDD §5.8: day 14 a decor, day 28 a seasonal decor)
  reward('picnic_table', 'Picnic Table', 'M1a', [2, 1], 10, 'daily:14', {}, 'Lunch in the field, for two.'),
  reward('tulip_planter', 'Tulip Planter', 'M1a', [1, 1], 12, 'daily:28:spring', { forage: 1 }),
  reward('sunflower_planter', 'Sunflower Planter', 'M1a', [1, 1], 12, 'daily:28:summer', { forage: 1 }),
  reward('pumpkin_lanterns', 'Pumpkin Lanterns', 'M1a', [1, 1], 12, 'daily:28:autumn', { cosmetic: 'glow' }),
  reward('snow_lantern', 'Snow Lantern', 'M1a', [1, 1], 12, 'daily:28:winter', { cosmetic: 'glow' }),
];

/** Collection display pieces (GDD §5.5): one per set, granted on completion. */
export const COLLECTION_DISPLAYS = [
  ['recipe_cards', 'Recipe Card Frame', 'M1b'], ['butterflies', 'Butterfly Case', 'M1b'],
  ['lost_tools', 'Old Tool Rack', 'M1b'], ['feathers', 'Feather Vase', 'M1b'], ['heirloom_seeds', 'Seed Tin Shelf',
    'M1b'],
  ['pond_treasures', 'Pond Treasure Box', 'M2'], ['fossils', 'Fossil Cabinet', 'M1b'], ['honey_jars',
    'Honey Jar Shelf', 'M1b'],
  ['buttons', 'Button Jar', 'M1b'], ['fair_rosettes', 'Rosette Board', 'M2'], ['old_coins', 'Coin Display', 'M2'],
  ['love_notes', 'Love Note Box', 'M2'],
].map(([set, name, m]) => reward(`${set}_display`, name, m, [1, 1], 15, `collection:${set}`));

/** Town Project souvenirs (GDD §5.9): one per Hollow Village landmark. */
export const TOWN_SOUVENIRS = TOWN_PROJECTS.map((p) => reward(p.souvenir, `${p.name} Souvenir`, p.m, [1, 1], 20,
  `town:${p.id}`));
