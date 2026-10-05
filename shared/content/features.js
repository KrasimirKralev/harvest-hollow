// Systems (features) by unlock level (GDD §4.6 "What unlocks when", feature column) with the one-card explanation
// the drip-feed shows (§7.4 v2 F3: a new SYSTEM is surfaced at most once per ~20 minutes of farm play; systems that
// unlock sooner wait in a queue). Content unlocks (crops, recipes, buildings ...) come from the tables themselves:
// see unlocksAt() in index.js. `card: null` means the system explains itself (it has a tutorial step or a quest).

export const DRIP_FEED = { minGapMs: 1_200_000, m: 'M1a' };

const f = (id, name, unlock, m, card = null, extra = {}) => ({ id, name, unlock, m, card, ...extra });

export const FEATURES = [
  f('market', 'Market Stand', 1, 'M1a'),
  f('barn', 'Barn', 1, 'M1a'),
  f('debris', 'Clearing debris', 1, 'M1a'),
  f('uproot', 'Uproot', 1, 'M1a', { title: 'Changed your mind?',
    text: 'Shift-click a growing crop to pull it up. Inside 10 minutes the seed is refunded in full.' }),
  f('quest_book', 'Quest book', 1, 'M1a'),
  f('activity_feed', 'Activity feed', 1, 'M1a'),
  f('pings', 'Pings and emotes', 1, 'M1a', { title: 'Say hello',
    text: 'Press G to ping a spot for your partner, T for the emote wheel. Notes pinned to a tile wait for them.' }),
  f('high_five', 'High-five', 1, 'M1a', { title: 'High five!',
    text: 'Stand next to each other and both press high-five: a Spark gives you both +10 % XP for 10 minutes.' }),
  f('tutorial', 'Fields and Barnyard tracks', 1, 'M1a'),
  f('orders', 'Orders Board', 2, 'M1a', { title: 'Mabel\'s Order Board',
    text: 'Orders pay more than the market and never expire. A filled slot refills in 15 minutes.' }),
  f('help_flags', 'Help flags and pins', 2, 'M1a', { title: 'I\'m on it',
    text: 'Pin an order you are working on, or flag it "Need help": when your partner fills it you both get '
      + 'a Heart.' }),
  f('daily_gift', 'Daily Gift', 3, 'M1a', { title: 'A gift a day',
    text: 'Claim one gift each day you play. Miss a day and the calendar simply waits.' }),
  // wave-2 RC-01: the Almanac arrives with the Daily Gift (was L8) and is explained before Farm Weeks
  f('almanac', 'Daily Almanac', 3, 'M1a', { title: 'The Almanac',
    text: 'Four small tasks each, every day, plus one to do together. The first four pay coins and XP.' }),
  f('farm_weeks', 'Farm Weeks', 3, 'M1a', { title: 'Farm Weeks',
    text: 'Play on two days of a week and the streak grows. Skip weeks are saved up for busy times.' }),
  f('golden_hour', 'Golden Hour', 4, 'M1a', { title: 'Golden Hour',
    text: 'Sit on the Sunset Bench together for 10 seconds: for 30 minutes everything you start grows 10 % faster.' }),
  f('expansions', 'Land expansions', 5, 'M1a', { title: 'More land',
    text: 'Each expansion adds six plots to your cap and a new corner to explore. Look for the "For sale" signs.' }),
  f('hurry', 'Hurry', 5, 'M1a', { title: 'In a hurry?',
    text: 'Acorns finish any timer: 1 Acorn per started hour left.' }),
  f('mabel_meter', 'Mabel\'s weekly meter', 5, 'M1a', { title: 'Mabel\'s week',
    text: 'Every order you fill fills Mabel\'s weekly meter. Three chests wait on it until Sunday.' }),
  f('barn_upgrades', 'Barn upgrades', 6, 'M1a', { title: 'A bigger Barn',
    text: 'Ollie can enlarge the Barn for coins, Planks and Crates. A full barn never loses anything.' }),
  f('couple_challenge', 'Couple Challenge', 6, 'M1a', { title: 'This week\'s challenge',
    text: 'One goal for the two of you each week. Finish it for Acorns, Hearts and a decor piece.' }),
  f('mastery', 'Mastery', 7, 'M1a', { title: 'Mastery stars',
    text: 'Grow, raise and craft the same thing often and it earns stars: better prices, faster timers, '
      + 'bonus units.' }),
  f('babies', 'Baby animals', 7, 'M1a', { title: 'Babies',
    text: 'Babies grow up on their own. A Baby Bottle from the Dairy speeds them along.' }),
  f('compost', 'Compost and blue ribbons', 8, 'M1a', { title: 'Compost',
    text: 'The Compost Bin fills as you tend animals. Composted plots give an extra unit and sometimes a blue '
      + 'ribbon.' }),
  f('golden_seeds', 'Golden Seeds', 8, 'M1a', { title: 'Golden Seeds',
    text: 'A crop grown from a golden seed is always a blue-ribbon harvest.' }),
  f('wishlist', 'Wishlist', 9, 'M1a', { title: 'Saving up',
    text: 'Put something on the Wishlist and set coins aside for it. It buys itself the moment it is funded.' }),
  f('duets', 'Duet recipes', 10, 'M1a', { title: 'Cook together',
    text: 'Press "Cook together" at the same time and duet recipes bake in half the time with more XP.' }),
  f('pets', 'Pets', 10, 'M1b', { title: 'A pet each',
    text: 'Adopt a dog or a cat. Feed it a treat each day and it brings you a find the next morning.' }),
  f('collections', 'Collections album', 10, 'M1b', { title: 'Collections',
    text: 'Little treasures turn up while you farm. Complete a set for Acorns and a display piece.' }),
  f('market_demand', 'Market Demand', 11, 'M1a', { title: 'Market Demand',
    text: 'Mabel\'s chalkboard names two goods each day that sell for half again, for the first 50 units.' }),
  f('perks', 'Specialisation perks', 12, 'M2', { title: 'Perks of your own',
    text: 'Every two personal levels earn a perk point for four trees: Grower, Rancher, Orchardist, Artisan. '
      + 'Perks help only your own work.' }),
  // wave 3 (M2): GDD §4.7 "Welcome back" ships with the perks, the other personal progression
  f('rested_xp', 'Rested XP', 12, 'M2', { title: 'Welcome back',
    text: 'While you are away, rested XP builds up: your personal XP counts double until it is used. Farm XP '
      + 'never changes.' }),
  f('bees', 'Bee forage and pollination', 13, 'M1b', { title: 'Busy bees',
    text: 'A Beehive makes Honey every 6 hours with 3 flowers within 4 tiles, every 12 without. Nearby crops and '
      + 'trees get pollinated.' }),
  f('county_fair', 'County Fair', 14, 'M1b', { title: 'The County Fair',
    text: 'Enter your crafted goods at the Fair tent all week; blue-ribbon harvests score too. Medals on Sunday at '
      + '20:00.' }),
  f('barge', 'River Barge', 15, 'M1b', { title: 'The River Barge',
    text: 'Captain Reed docks every Monday with crates to fill. Load a whole row for an Acorn and a share of his '
      + 'chest.' }),
  f('restoration', 'Restoration Ledger', 16, 'M1b', { title: 'Restoration',
    text: 'Grandma\'s old greenhouse can be mended. Donate goods to its bundles a little at a time: each bundle '
      + 'needs only some of its slots.' }),
  f('second_windmill', 'Second Windmill', 16, 'M1b', { title: 'A second Windmill',
    text: 'Ollie can raise a second Windmill now: two queues of Flour, Sugar and Oat Flakes.' }),
  f('truffles', 'Truffle hunting', 17, 'M1b', { title: 'Truffle hunting',
    text: 'Pigs eat Pig Slop from the Feed Mill and dig up Truffles. Now and then a pig finds a black one.' }),
  f('farm_beauty', 'Farm Beauty', 18, 'M1b', { title: 'Farm Beauty',
    text: 'Decor, buildings and trees make the farm beautiful. Each beauty star pays 3 Acorns and 1 % more on '
      + 'every order.' }),
  f('decor_sets', 'Decor sets', 18, 'M1b', { title: 'Decor sets',
    text: 'Place every piece of a themed set within 6 tiles of each other: the set shines with 25 % more beauty.' }),
  f('masterwork', 'Masterwork decor', 18, 'M1b', { title: 'Masterwork',
    text: 'Any coin decor can be upgraded twice, to stone and then gilded trim, for 1.5 and 2 times its beauty.' }),
  f('second_dairy', 'Second Dairy', 18, 'M1b', { title: 'A second Dairy',
    text: 'A second Dairy is allowed now: Cream and Butter in two queues at once.' }),
  f('nursery', 'Animal Nursery', 19, 'M2', { title: 'The Nursery',
    text: 'Feed, play with and groom a baby in the Nursery, a Baby Bottle each. Then pick its personality and a '
      + 'small specialty.' }),
  f('giant_crops', 'Giant crops', 20, 'M1b', { title: 'Giant crops',
    text: 'Compost a 3 × 3 block, plant one crop on it within a minute, and it may grow into a Giant. Fell it '
      + 'together: it is quicker.' }),
  // M2: the Grand decor tier opens with the Old Dutch Windmill (GDD §3.8, L20); it waited for the M2 build
  f('grand_decor', 'Grand decor', 20, 'M2', { title: 'Grand decor',
    text: 'Ollie\'s showpieces are in the Market: big decor with the most beauty on the farm, priced in hours of '
      + 'income.' }),
  f('town_projects', 'Town Projects', 20, 'M1b', { title: 'The Hollow Village',
    text: 'Across the river the village is waking. Bring Ollie goods and coins for one project at a time; it is '
      + 'built the next day.' }),
  f('townsfolk', 'Townsfolk Friendship and board', 21, 'M1b', { title: 'The townsfolk board',
    text: 'Every Monday three neighbours pin a request by the Market. Fill them for coins and their friendship.' }),
  // GDD §6.2 mechanic 21: Willow Pond's own dock (L21; the Fishing Dock decor from L28 for a farm without the pond)
  f('fishing', 'Fishing Dock', 21, 'M2', { title: 'Gone fishing',
    text: 'Sit on the dock and cast, once an hour each. Fish are for records and photos; Pond Treasures turn '
      + 'up too.' }),
  f('heirloom_fruit', 'Heirloom blue-ribbon fruit', 22, 'M1b', { title: 'Heirloom trees',
    text: 'A tree picked 60 times becomes an heirloom. Now you can see its blue-ribbon fruit on the branches.' }),
  f('bundle_flags', 'Help flags on bundle slots', 23, 'M1b', { title: 'Help with the bundles',
    text: 'Flag a Restoration slot "Need help": when your partner fills it, you both get a Heart.' }),
  f('seasonal_track', 'Seasonal Ribbon Track', 24, 'M2', { title: 'The season\'s track',
    text: 'Every XP you earn this season fills a 30-tier track of rewards. A fresh track starts with each '
      + 'season.' }),
  f('horse_show', 'Horse show', 25, 'M2', { title: 'The horse show',
    text: 'A blue-ribbon horse brings Show Ribbons. Entered at the Fair tent, a Show Ribbon now scores double.' }),
  f('restoration_4', 'Restoration project 4', 25, 'M2', { title: 'The Orchard Pond',
    text: 'A new page in the Ledger: dig the orchard pond. Once it is full, every tree ripens 10 % faster.' }),
  f('fair_league', 'Fair NPC league', 27, 'M2', { title: 'The county league',
    text: 'Five farms of the county meet you at the Fair each week. Finish in the top two to climb a league; '
      + 'each league pays Acorns.' }),
  f('breeding', 'Breeding Barn', 28, 'M2', { title: 'The Breeding Barn',
    text: 'Pair two grown animals of a kind and a baby with a coat of its own arrives: white, brown, spotted, '
      + 'or golden if you are lucky.' }),
  f('restoration_5', 'Restoration project 5', 28, 'M2', { title: 'The Fair Grounds',
    text: 'Restore the Town Fair Grounds: the Platinum medal, the top league and one more entry per good each '
      + 'week.' }),
  f('friendly_duel', 'Friendly Duel', 29, 'M2', { title: 'A friendly duel',
    text: 'Challenge your partner to a week of pumpkins, pies or orders. The winner wears a crown for a week. '
      + 'Just for fun.' }),
  f('carousel_set', 'Carousel decor set', 29, 'M2', { title: 'The Carousel set',
    text: 'Carousel, Gazebo, Cow Statue and Golden Cow Statue within 6 tiles of each other: music, and 25 % '
      + 'more beauty.' }),
  f('gold_mastery', 'Gold mastery', 30, 'M2', { title: 'Gold stars',
    text: 'Keep going past three stars: a Gold star brings a better blue-ribbon chance, a gold sign and 3 '
      + 'Acorns.' }),
  f('second_feed_mill', 'Second Feed Mill', 31, 'M2', { title: 'A second Feed Mill',
    text: 'A big barnyard can have a second Feed Mill now: two queues of feed at once.' }),
  f('hamper_double', 'Hampers score double at the Fair', 32, 'M2', { title: 'Hampers at the Fair',
    text: 'Hampers entered at the Fair tent now score double.' }),
  f('second_pie_oven', 'Second Pie Oven', 33, 'M2', { title: 'A second Pie Oven',
    text: 'A second Pie Oven is allowed now: two pies in the oven at once.' }),
  f('restoration_6', 'Restoration project 6', 34, 'M2', { title: 'Grandma\'s Farmhouse',
    text: 'The last Restoration project is Grandma\'s farmhouse. Finish it to furnish the rooms inside, and '
      + 'someone special will visit.' }),
  f('gourmet_orders', 'Gourmet orders', 37, 'M2', { title: 'Gourmet orders',
    text: 'Mabel now posts gourmet orders: one hamper or fine dish that pays 1.7 times its value.' }),
  f('showcase', 'Showcase beauty', 38, 'M2', { title: 'Showcase',
    text: 'Five beauty stars and still decorating? Every beauty point past 1,800 counts as Showcase points.' }),
  f('sunset_gazebo', 'Sunset Hill gazebo', 39, 'M2', { title: 'Sunset Hill',
    text: 'Golden Hour at the Sunset Hill gazebo lasts 10 minutes longer. Bring a blanket.' }),
  f('legacy', 'Legacy levels', 40, 'M2', { title: 'Legacy levels',
    text: 'Level 40, and the farm keeps growing. Every Legacy level pays Acorns, seeds, Hearts or a Legacy '
      + 'Statue.' }),
  // The owners' wish list of 2026-10-04 (wave 4): one card for each new thing, so a farm that is already past these
  // levels meets them too (one card per ~20 minutes of play, DRIP_FEED). New farms meet them after the first evening's
  // teaching cards (none at L1). `touchText` is the phone wording.
  f('wild_weeds', 'Pulling wild weeds', 2, 'M1a', { title: 'Pull the weeds',
    text: 'The yellow-flowered weeds on your land come out with the Hand, for good. The first 20 a day pay 2 coins.' }),
  f('look_editor', 'Your look', 3, 'M1a', { title: 'Your own look',
    text: 'Click your name chip to change hair, outfit colours, hat and skin tone. Your partner sees it at once.',
    touchText: 'Tap your name chip to change hair, outfit colours, hat and skin tone. Your partner sees it at once.' }),
  f('rotate_buildings', 'Turning buildings', 4, 'M1a', { title: 'Turn it around',
    text: 'Pick a building up with the Hammer and press Rotate (or R) before you set it down. The Farmhouse turns too.',
    touchText: 'Pick a building up with the Hammer and tap Rotate before you set it down. The Farmhouse turns too.' }),
  f('homestead_upgrades', 'Homestead upgrades', 4, 'M1a', { title: 'Make it yours',
    text: 'The Farmhouse, Well, Market Stand and Sunset Bench have three upgrades each. Click one and choose '
      + 'Upgrade.',
    touchText: 'The Farmhouse, Well, Market Stand and Sunset Bench have three upgrades each. Tap one and choose '
      + 'Upgrade.' }),
  f('camera_tilt', 'Camera tilt', 5, 'M1a', { title: 'A new angle',
    text: 'Settings > Right-drag: Rotate camera. Then drag sideways to turn the farm and up or down to tilt it.',
    touchText: 'Drag two fingers up or down to tilt the camera, from nearly flat to straight down.' }),
  f('sell_decor', 'Selling decor', 6, 'M1a', { title: 'Changed your mind?',
    text: 'Pick a decoration up with the Hammer and choose Sell: half of what you paid back, all of it within 10 '
      + 'minutes.',
    touchText: 'Pick a decoration up with the Hammer and tap Sell: half of what you paid back, all of it within 10 '
      + 'minutes.' }),
  f('fertilizer', 'Fertilizer', 10, 'M1a', { title: 'Fertilizer',
    text: 'The Compost Bin turns 2 Compost and an Egg into Fertilizer. On a growing crop: ripe a quarter sooner, 2 '
      + 'more.' }),
  f('pet_breeds', 'Pet breeds', 10, 'M1b', { title: 'Pick a breed',
    text: 'Husky, German Shepherd or Shiba Inu; an orange, black or white cat. Change it in the pet panel any time.' }),
  // The owners' wish list of 2026-10-05 (wave 4b): one card each, on levels that already unlock something (so no level
  // loses its Legacy-pool reward), drip-fed like wave 4's.
  f('balloon_crates', 'Balloon crates', 3, 'M1a', { title: 'Something fell from the sky',
    text: 'Now and then the hot-air balloon drops a crate on the farm. Click it: coins, XP and sometimes a rare find.',
    touchText: 'Now and then the hot-air balloon drops a crate on the farm. Tap it: coins, XP and sometimes a rare '
      + 'find.' }),
  f('tree_ages', 'Tree ages', 4, 'M1a', { title: 'Trees grow old',
    text: 'Every harvest is a year for a tree. At 10 years it gives one more fruit, at 30 two more, and it grows.' }),
  f('queue_order', 'Queue order', 5, 'M1a', { title: 'What comes next?',
    text: 'In a workshop, drag a waiting item up or down to change what is made next. Each one shows its finish price.',
    touchText: 'In a workshop, press and drag a waiting item (or use the arrows) to change the order. Each shows its '
      + 'price.' }),
  f('growing_homes', 'Growing homes', 7, 'M1a', { title: 'Room to grow',
    text: 'A full coop or barn grows: buy one more animal and its room comes with it. The yard gets bigger as it '
      + 'fills.' }),
  f('acorn_shop', 'Acorn treasures', 8, 'M1a', { title: 'Worth saving for',
    text: 'The Acorn shop has eight treasures, one of each per farm, like the Golden Barn and the Farmhand. Pick one '
      + 'to save for.' }),
];
