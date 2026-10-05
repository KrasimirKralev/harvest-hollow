// Achievements, "Ribbons" (GDD §5.4). Hand-authored from the GDD table; every tier value is the GDD's.
// Owner wave 4 (2026-10-04): the "every one of a family" Gold tiers follow the new crops, the Pomegranate Tree, the
// Rabbit and the twelve new recipes (Rainbow Harvest and Crop Master 21, Orchardist 14, Full Barnyard 10, Recipe Box 117).
//
// Ribbon shape:
//   { id, n, name, m, scope, stat, mode, tiers: [bronze, silver, gold], text, title, bound?, scale?, hidden? }
//   scope  'F' farm (shared counter) | 'P' personal (each player's own counter) | 'T' together (a farm counter
//          fed by both players; each player's part is shown; both get the P reward, the farm the F reward once)
//   stat   the stats key the counter reads (farm.stats for F/T, players[pid].stats for P). Keys ending in '.*'
//          name a family of keys (`harvest.<crop>`); mode 'distinct' counts the keys of that family above 0.
//   mode   'sum' a counter that only grows · 'distinct' distinct keys of a family · 'state' a value derived from
//          the current farm (species owned, stars, level) whose best-ever value counts (a tier once earned stays)
//   scale  the counter holds `scale` units per counted thing (orders: simple orders count 1/4, R15)
//   bound  the most that can ever exist ({ family } = the size of a content family, or a number): R11 checks
//          that every Gold tier is reachable
//   title  the farm title (F/T) or personal title (P) granted with Gold
// Counting rules (exploit-proof, GDD §5.4): only produced goods count (never bought or refunded); "coins earned"
// is sales, orders, townsfolk, barge, Fair and quests; refunds and grants never count; gifts count once per item
// instance and at most one per giver per day; help counts only when the OTHER player fills a flag.

const r = (n, id, name, m, scope, stat, mode, tiers, text, title, extra = {}) =>
  ({ id, n, name, m, scope, stat, mode, tiers, text, title, ...extra });

export const RIBBONS = [
  r(1, 'cream_of_the_crop', 'Cream of the Crop', 'M1a', 'F', 'cropsHarvested', 'sum', [500, 5000, 25_000],
    'Harvest plots', 'Harvest Royalty'),
  r(2, 'green_thumb', 'Green Thumb', 'M1a', 'P', 'plantingsHarvested', 'sum', [300, 3000, 12_000],
    'Your plantings harvested (by anyone)', 'Green Thumb'),
  r(3, 'rainbow_harvest', 'Rainbow Harvest', 'M1a', 'F', 'harvest.*', 'distinct', [6, 12, 21],
    'Different crops harvested', 'Keepers of the Rainbow', { bound: { family: 'crops' } }),
  r(4, 'night_shift', 'Night Shift', 'M1a', 'F', 'harvestLong', 'sum', [25, 250, 1500],
    'Harvest crops of 8 h or longer', 'Night Shift Legends'),
  r(5, 'fresh_picker', 'Fresh Picker', 'M1a', 'F', 'freshHarvests', 'sum', [200, 2000, 10_000], 'Fresh harvests',
    'Always Fresh'),
  r(6, 'prize_patch', 'Prize Patch', 'M1a', 'F', 'prizedHarvests', 'sum', [10, 150, 1000], 'Blue-ribbon harvests',
    'Prize Growers'),
  r(7, 'giant_among_us', 'Giant Among Us', 'M1b', 'F', 'giantsFelled', 'sum', [1, 10, 50], 'Giant crops felled',
    'Giant Slayers'),
  r(8, 'in_season', 'In Season', 'M1a', 'F', 'seasonsHundred', 'sum', [1, 4, 8],
    'Seasons with 100+ in-season harvests', 'Farmers for All Seasons'),
  r(9, 'knock_on_wood', 'Knock on Wood', 'M1a', 'F', 'treesHarvested', 'sum', [50, 500, 2500], 'Tree harvests',
    'Orchard Hands'),
  r(10, 'orchardist', 'Orchardist', 'M1a', 'F', 'treeSpecies', 'state', [3, 7, 14], 'Tree species owned',
    'Master Orchardists', { bound: { family: 'trees' } }),
  r(11, 'grove_keeper', 'Grove Keeper', 'M1a', 'F', 'grovesFormed', 'state', [1, 4, 10],
    'Same-species groves formed', 'Grove Keepers'),
  r(12, 'heirloom_keeper', 'Heirloom Keeper', 'M1b', 'F', 'heirloomTrees', 'state', [1, 5, 15], 'Heirloom trees',
    'Heirloom Keepers'),
  r(13, 'busy_bees', 'Busy Bees', 'M1b', 'F', 'collect.honey', 'sum', [20, 200, 1000], 'Honey collected', 'Queen Bees'),
  r(14, 'zoologist', 'Zoologist', 'M1a', 'F', 'animalsCollected', 'sum', [100, 1000, 5000], 'Animal goods collected',
    'Zoologists'),
  r(15, 'nursery', 'Nursery', 'M1a', 'F', 'babiesRaised', 'sum', [3, 15, 50], 'Babies raised to adults',
    'Nursery Nannies'),
  r(16, 'blue_ribbon', 'Blue Ribbon', 'M1a', 'F', 'prizedAnimals', 'state', [1, 5, 15], 'Blue-ribbon animals',
    'Blue-Ribbon Breeders'),
  r(17, 'full_barnyard', 'Full Barnyard', 'M1a', 'F', 'animalSpecies', 'state', [3, 6, 10], 'Animal species owned',
    'Noah\'s Farm', { bound: { family: 'animals' } }),
  r(18, 'name_game', 'Name Game', 'M1a', 'P', 'animalsNamed', 'sum', [3, 15, 40], 'Animals you named',
    'Namer of Names'),
  r(19, 'gentle_hands', 'Gentle Hands', 'M1a', 'P', 'animalsPetted', 'sum', [100, 1000, 5000], 'Animals you petted',
    'Gentle Hands'),
  r(20, 'best_friends', 'Best Friends', 'M1b', 'P', 'petFedDays', 'sum', [7, 30, 100], 'Days your pet was fed',
    'Best Friend'),
  r(21, 'home_cooking', 'Home Cooking', 'M1a', 'F', 'goodsCrafted', 'sum', [50, 500, 2500], 'Goods crafted',
    'Home Cooks'),
  r(22, 'recipe_box', 'Recipe Box', 'M1a', 'F', 'craft.*', 'distinct', [10, 50, 117], 'Different recipes made',
    'Keepers of the Recipe Box', { bound: { family: 'recipes' } }),
  r(23, 'master_chef', 'Master Chef', 'M1a', 'F', 'recipesStar3', 'state', [1, 5, 15], 'Recipes at ★3', 'Master Chefs'),
  r(24, 'mill_runner', 'Mill Runner', 'M1a', 'F', 'feedMade', 'sum', [100, 1000, 5000], 'Feed made', 'Millers'),
  r(25, 'hamper_maker', 'Hamper Maker', 'M1b', 'F', 'premiumGoodsMade', 'sum', [5, 50, 250], 'T4 goods made',
    'Hamper Masters'),
  r(26, 'high_roller', 'High Roller', 'M1a', 'F', 'coins.earned', 'sum', [100_000, 5_000_000, 50_000_000],
    'Coins earned', 'High Rollers'),
  r(27, 'good_business', 'Good Business', 'M1a', 'F', 'ordersQ', 'sum', [25, 250, 1000],
    'Orders filled (simple orders count 1/4)', 'Pillars of the Market', { scale: 4 }),
  r(28, 'captains_friend', 'Captain\'s Friend', 'M1b', 'F', 'bargeRows', 'sum', [3, 25, 100], 'Barge rows completed',
    'Friends of the River'),
  r(29, 'full_steam', 'Full Steam', 'M1b', 'F', 'bargeStreak', 'state', [2, 6, 12],
    'Weeks in a row with a barge row', 'Full Steam Ahead'),
  r(30, 'market_savvy', 'Market Savvy', 'M1a', 'F', 'demandSold', 'sum', [20, 200, 1000],
    'Demand-of-the-day units sold', 'Market Savvy'),
  // distinct things bought through the Wishlist (wave-1 QA RC-15): a count of purchases was a 10-coin loop
  r(31, 'wishful_thinking', 'Wishful Thinking', 'M1a', 'F', 'wish.*', 'distinct', [3, 8, 15],
    'Different things bought through the Wishlist', 'Dreamers'),
  r(32, 'clearing_the_way', 'Clearing the Way', 'M1a', 'F', 'debrisCleared', 'sum', [25, 150, 400],
    'Debris cleared (regrows)', 'Trailblazers'),
  r(33, 'room_to_grow', 'Room to Grow', 'M1a', 'F', 'expansionsBought', 'sum', [1, 6, 15], 'Expansions bought',
    'Landholders', { bound: { family: 'expansions', minus: 1 } }),
  r(34, 'builder', 'Builder', 'M1a', 'F', 'buildsAndSlots', 'sum', [5, 20, 50], 'Buildings built or slots added',
    'Master Builders'),
  r(35, 'picture_perfect', 'Picture Perfect', 'M1b', 'F', 'beautyStars', 'state', [2, 4, 5], 'Farm Beauty stars',
    'Picture Perfect', { bound: 5 }),
  r(36, 'showcase', 'Showcase', 'M2', 'F', 'showcasePoints', 'state', [500, 2000, 6000], 'Beauty Showcase points',
    'Showstoppers'),
  r(37, 'collector', 'Collector', 'M1b', 'F', 'setsCompleted', 'sum', [1, 6, 12], 'Collection sets completed',
    'Collectors', { bound: { family: 'collections' } }),
  r(38, 'album_pages', 'Album Pages', 'M1b', 'F', 'albumItems', 'sum', [10, 30, 60], 'Collection items found',
    'Archivists', { bound: { family: 'collections', items: true } }),
  r(39, 'restorer', 'Restorer', 'M1b', 'F', 'bundlesDone', 'sum', [4, 12, 24], 'Restoration bundles completed',
    'Restorers', { bound: 24 }),
  r(40, 'hollow_reborn', 'Hollow Reborn', 'M1b', 'F', 'projectsDone', 'sum', [1, 3, 6],
    'Restoration projects completed', 'Heart of the Hollow', { bound: 6 }),
  r(41, 'crop_master', 'Crop Master', 'M1a', 'F', 'cropsStar3', 'state', [1, 6, 21], 'Crops at ★3', 'Crop Masters',
    { bound: { family: 'crops' } }),
  r(42, 'golden_touch', 'Golden Touch', 'M2', 'F', 'goldStars', 'state', [1, 5, 15], 'Items at Gold ★', 'Golden Touch'),
  r(43, 'fair_contender', 'Fair Contender', 'M1b', 'F', 'bestMedal', 'state', [1, 7, 10],
    'Best County Fair medal (Bronze / Gold / Platinum)', 'County Champions', { bound: 10 }),
  r(44, 'fair_regular', 'Fair Regular', 'M1b', 'F', 'medalWeeks', 'sum', [4, 15, 40], 'Fair weeks with any medal',
    'Fair Regulars'),
  r(45, 'league_climber', 'League Climber', 'M2', 'F', 'bestLeague', 'state', [2, 4, 5], 'Highest NPC league',
    'League Champions', { bound: 5 }),
  r(46, 'season_ticket', 'Season Ticket', 'M2', 'F', 'seasonTiers', 'sum', [30, 90, 240],
    'Seasonal Ribbon Track tiers (lifetime)', 'Season Ticket Holders'),
  r(47, 'festive', 'Festive', 'M3', 'F', 'festivalsDone', 'sum', [1, 4, 10],
    'Festivals with the final prize claimed', 'Life of the Party'),
  r(48, 'almanac_reader', 'Almanac Reader', 'M1a', 'P', 'almanacDone', 'sum', [50, 500, 2500],
    'Almanac tasks completed', 'Almanac Scholar'),
  r(49, 'farm_weeks', 'Farm Weeks', 'M1a', 'F', 'farmWeeksBest', 'state', [4, 12, 52],
    'Best weekly streak (weeks with 2+ play days)', 'Steady Hands'),
  r(50, 'farmers_calendar', 'Farmer\'s Calendar', 'M1a', 'P', 'daysPlayed', 'sum', [7, 60, 200],
    'Days played (lifetime)', 'Every Day a Farmer'),
  r(51, 'level_up', 'Level Up', 'M1a', 'F', 'level', 'state', [10, 25, 40], 'Farm level', 'Legendary Farm',
    { bound: 40 }),
  r(52, 'seasoned_farmer', 'Seasoned Farmer', 'M1a', 'P', 'personalLevel', 'state', [10, 25, 40], 'Personal level',
    'Seasoned Farmer'),
  r(53, 'helping_hands', 'Helping Hands', 'M1a', 'T', 'partnerFlagsFilled', 'sum', [10, 100, 500],
    'Partner\'s help flags you filled', 'Helping Hands'),
  r(54, 'love_letters', 'Love Letters', 'M1a', 'P', 'keepsakesGiven', 'sum', [10, 75, 300], 'Keepsakes you gave',
    'Sweetheart'),
  r(55, 'duet', 'Duet', 'M1a', 'T', 'duets', 'sum', [3, 30, 150], 'Duet recipes cooked together', 'Perfect Duet'),
  r(56, 'teamwork', 'Teamwork', 'M1b', 'T', 'teamworkFelled', 'sum', [3, 25, 100],
    'Giant crops, big stumps and boulders felled together', 'Dream Team'),
  r(57, 'golden_hour', 'Golden Hour', 'M1a', 'T', 'goldenHours', 'sum', [3, 30, 100], 'Golden Hours together',
    'Sunset Lovers'),
  r(58, 'high_five', 'High Five', 'M1a', 'T', 'highFives', 'sum', [10, 100, 500], 'High-fives', 'High-Five Heroes'),
  r(59, 'side_by_side', 'Side by Side', 'M1a', 'T', 'hoursTogether', 'sum', [5, 50, 250],
    'Hours with both players online', 'Side by Side'),
  r(60, 'our_story', 'Our Story', 'M1b', 'T', 'memoryPages', 'sum', [10, 40, 100], 'Memory Book pages', 'Storytellers'),
  r(61, 'equal_partners', 'Equal Partners', 'M2', 'T', 'equalWeeks', 'sum', [2, 10, 30],
    'Weeks where both loaded a crate of a completed barge row', 'Equal Partners'),
  r(62, 'combo_kings', 'Combo Kings', 'M1a', 'T', 'comboActions', 'sum', [500, 5000, 25_000],
    'Together Combo actions', 'Combo Royalty'),
  r(63, 'village_builders', 'Village Builders', 'M1b', 'F', 'townProjects', 'sum', [1, 8, 24],
    'Town Projects completed', 'Village Founders', { bound: 24 }),
];

/** Hidden ribbons (GDD §5.4): one tier, revealed when earned, 3 Acorns each. */
export const HIDDEN_RIBBONS = [
  r(64, 'scarecrows_day_off', 'Scarecrow\'s Day Off', 'M1a', 'F', 'placed.scarecrow', 'sum', [10],
    'Place 10 scarecrows', '', { hidden: true }),
  r(65, 'pumpkin_royalty', 'Pumpkin Royalty', 'M3', 'F', 'festivalPrizedPumpkin', 'sum', [1],
    'A blue-ribbon pumpkin during the Harvest Festival', '', { hidden: true }),
  r(66, 'early_bird', 'Early Bird', 'M1a', 'F', 'earlyHarvests', 'sum', [1], 'Harvest before 07:00', '',
    { hidden: true }),
  r(67, 'night_owls', 'Night Owls', 'M1a', 'T', 'nightOwls', 'sum', [1], 'Both online after midnight', '',
    { hidden: true }),
  r(68, 'chicken_whisperer', 'Chicken Whisperer', 'M1a', 'P', 'named.chicken', 'sum', [12], 'Name 12 chickens', '',
    { hidden: true }),
  r(69, 'thank_you', 'Thank You!', 'M1a', 'P', 'thanksSent', 'sum', [50], 'Send 50 thanks', '', { hidden: true }),
  r(70, 'clean_sweep', 'Clean Sweep', 'M1a', 'P', 'bestHarvestStroke', 'state', [50], 'Harvest 50 plots in one drag',
    '', { hidden: true }),
];

/** Medal ranks for 'bestMedal' (GDD §5.6): Bronze I = 1 ... Gold III = 9, Platinum = 10. */
export const MEDAL_RANKS = ['bronze1', 'bronze2', 'bronze3', 'silver1', 'silver2', 'silver3', 'gold1', 'gold2', 'gold3',
  'platinum'];

/**
 * Tier rewards by scope (GDD §5.4). F: Acorns + Ribbon Points (+ decor at Silver/Gold + the farm title at Gold).
 * P: Hearts (+ an outfit piece at Silver, the personal title at Gold). T: both players get P, the farm gets F once.
 * Hidden: 3 Acorns.
 */
export const RIBBON_REWARDS = {
  F: [{ acorns: 1, points: 1 }, { acorns: 3, points: 2, decor: 'ribbon_rosette' },
    { acorns: 8, points: 5, decor: 'ribbon_trophy', title: true }],
  P: [{ hearts: 3 }, { hearts: 8, outfit: true }, { hearts: 20, title: true }],
  hidden: { acorns: 3 },
};

/** The Ribbon Wall in the farmhouse: cosmetic tiers unlocked by lifetime Ribbon Points (GDD §5.4). */
export const RIBBON_WALL = [
  { points: 10, unlock: 'frames', name: 'Ribbon frames' },
  { points: 25, unlock: 'gate_arch', name: 'Farm-gate ribbon arch' },
  { points: 60, unlock: 'golden_scarecrow_wall', name: 'Golden scarecrow' },
  { points: 120, unlock: 'bunting_fence', name: 'Ribbon-bunting fence' },
];
