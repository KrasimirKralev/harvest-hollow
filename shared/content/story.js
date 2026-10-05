// The story layer of the quests (GDD §5.3): what each task verb means, the illustrated letter of every quest, its
// structured extra rewards and the story beats. Hand-authored; the quest numbers (level, tasks, coins, XP) are
// generated in quests.js from the economy model.

/**
 * Quest task verbs (GDD §5.3, counted the way tools/econ-sim.mjs counts them). Every count starts when the card is
 * accepted unless `state` is true (then the farm's current holdings count). `refs` names where `ref` resolves:
 * a content family, or a closed list of special refs.
 */
export const QUEST_VERBS = {
  plant: { refs: ['crops', 'trees'], text: 'Plant', count: 'crop plots planted; for a tree species, trees owned',
    state: false },
  harvest: { refs: ['items', 'special:prized'], text: 'Harvest',
    count: 'units harvested (crops and fruit); prized = blue-ribbon harvests' },
  sell: { refs: ['items', 'special:demand'], text: 'Sell',
    count: 'units sold at the Market Stand; demand = Market Demand units' },
  place: { refs: ['homes', 'buildings', 'special:forage'], text: 'Place', count: 'owned (placed) copies', state: true },
  build: { refs: ['homes', 'buildings'], text: 'Build', count: 'owned (placed) copies', state: true },
  own: { refs: ['trees', 'homes', 'buildings'], text: 'Own', count: 'owned copies', state: true },
  make: { refs: ['items'], text: 'Make', count: 'units crafted and collected (recipes and feed)' },
  collect: { refs: ['items'], text: 'Collect', count: 'units collected from animals or trees' },
  tend: { refs: ['animals'], text: 'Feed', count: 'animals of the species fed (a tend that re-feeds counts)' },
  deliver: { refs: ['items'], text: 'Deliver',
    count: 'units handed in from the Barn when the card completes (consumed)' },
  buy: { refs: ['animals'], text: 'Buy', count: 'animals of the species owned', state: true },
  raise: { refs: ['animals'], text: 'Raise',
    count: 'babies of the species that grow up on the farm (a bought adult does not count)', state: false },
  fill: { refs: ['special:order'], text: 'Fill', count: 'orders filled; a simple order counts 1/4 (R15)' },
  clear: { refs: ['special:debris'], text: 'Clear', count: 'debris pieces cleared' },
  expand: { refs: ['expansions'], text: 'Buy the land', count: 'the expansion is owned', state: true },
  upgrade: { refs: ['special:barn', 'special:slot'], text: 'Upgrade',
    count: 'barn: Barn upgrades owned; slot: building slots bought' },
  empty: { refs: ['buildings'], text: 'Empty', count: 'Compost collected from the Compost Bin' },
  fertilize: { refs: ['special:plot'], text: 'Compost', count: 'plots composted' },
  complete: { refs: ['special:bundle', 'special:project', 'special:town_project'], text: 'Complete',
    count: 'bundles / projects completed' },
  reach: { refs: ['special:beauty_star', 'special:fair_silver', 'special:league'], text: 'Reach',
    count: 'the farm reaches the tier' },
  load: { refs: ['special:crate', 'special:row'], text: 'Load', count: 'barge crates / rows loaded' },
  enter: { refs: ['special:fair', 'special:hamper'], text: 'Enter', count: 'Fair entries (hampers: T4 entries)' },
  together: { refs: ['special:bench', 'special:duet', 'special:help_flag', 'special:giant', 'special:dock'],
    text: 'Together', count: 'joint moments with the partner' },
  breed: { refs: ['animals'], text: 'Breed', count: 'babies born in the Breeding Barn' },
};

/** Special task refs and the milestone whose system makes them meaningful. */
export const SPECIAL_REFS = {
  prized: 'M1a', demand: 'M1a', forage: 'M1b', order: 'M1a', debris: 'M1a', barn: 'M1a', slot: 'M1a', plot: 'M1a',
  bundle: 'M1b', project: 'M1b', town_project: 'M1b', beauty_star: 'M1b', fair_silver: 'M1b', league: 'M2',
  crate: 'M1b', row: 'M1b', fair: 'M1b', hamper: 'M2', bench: 'M1a', duet: 'M1a', help_flag: 'M1a', giant: 'M1b',
  dock: 'M2',
};

/** Illustrations the letter cards can show (inline SVG scenes drawn by the UI; a closed set, validated). */
export const LETTER_ART = ['farmhouse', 'wheat', 'market', 'hens', 'order', 'windmill', 'apple_tree', 'bread',
  'woodpile', 'cow', 'supper', 'cake', 'stall', 'juice', 'jam', 'calendar', 'basket', 'baby', 'compost', 'sheep',
  'pig', 'duck', 'goat', 'horse', 'alpaca', 'cherry', 'bees', 'pie', 'peach', 'plum', 'olive', 'maple', 'cocoa',
  'fig', 'fence', 'barn', 'crate', 'greenhouse', 'flowers', 'bridge', 'ferry', 'village', 'barge', 'rosette',
  'bench', 'hearts', 'giant', 'dock', 'melon', 'pepper', 'rice', 'calf'];

/**
 * One entry per quest id. `letter`: { greeting, body: [paragraphs], signoff, art } shown on the illustrated card;
 * `done`: the line shown when it completes. `rewards` (beyond the generated coins and XP), all optional:
 *   acorns: n            farm Acorns                 hearts: n          Hearts to EACH player
 *   items: { id: n }     goods into the Barn          decor: [defId]     free decor into the build tray
 *   animalsAtStart: { species: n }  free adult animals given when the card is accepted (they move into their
 *                        home as soon as one is placed)
 *   giftAtStart: [defId] free saplings given when the card is accepted
 *   collection: itemId   a collection item (when collections are live, M1b)
 *   gift: [defId]        free saplings / objects at completion (trees do not count toward the n-th price)
 *   name: species        the couple names an animal   beat: id           a story beat (STORY_BEATS)
 *   memory: true         a Memory Book page is offered
 *   furniture: [id]      a farmhouse furniture piece (CONTENT.furniture, M2) into the room's storage
 */
export const QUEST_STORY = {
  a1: {
    letter: { greeting: 'My dears,', art: 'farmhouse', signoff: 'All my love, Grandma Hazel', body: [
      'The farm is yours now. Both of you. I always hoped it would be, and the old place has been waiting a '
        + 'long time for some laughter.',
      'Start small, the way I did. The field by the porch is tilled and ready. Wheat grows in a minute, so drag '
        + 'a row of seeds across it and watch.',
    ] },
    done: 'Your first harvest! Grandpa would have whistled.',
  },
  a2: {
    letter: { greeting: 'Dear farmers,', art: 'market', signoff: 'Grandma Hazel', body: [
      'Mabel keeps the Market Stand down by the road. She will buy anything you grow, any amount, on the spot.',
      'Take her ten Wheat. The first coins a farm earns always feel like the best ones.',
    ] },
    done: 'Coins in the tin. That is how it starts.',
  },
  a3: {
    letter: { greeting: 'Dearest two,', art: 'hens', signoff: 'Love, Grandma (and the hens)', body: [
      'A farm is not a farm without a few hens. My old Coop is waiting in the build tray: place it wherever you '
        + 'like, it costs nothing.',
      'Hens eat Chicken Feed, and the Feed Mill makes it from three grains. Feed them, and they will lay. Eggs '
        + 'wait for you as long as you need, so never worry about being late.',
    ] },
    done: 'Fed and clucking. Grandma\'s note on the coop door: "Be nice to these two. They are mischief."',
    // the hens arrive with the letter (the card asks to feed them); they move into the Coop as soon as it is placed
    rewards: { animalsAtStart: { chicken: 2 } },
  },
  a4: {
    letter: { greeting: 'Hello you two,', art: 'order', signoff: 'Grandma Hazel', body: [
      'Mabel has put up her Order Board. Orders pay half again what the market does, and they never, ever expire.',
      'Fill one together. She notices who her good customers are.',
    ] },
    done: 'Mabel says you are "very promising". From her, that is a medal.',
  },
  a5: {
    letter: { greeting: 'My dears,', art: 'windmill', signoff: 'Grandma Hazel', body: [
      'Grandpa built that Windmill the summer we married. The sails are stiff but the stones still turn. Put it '
        + 'back up; it is yours for nothing.',
      'Wheat becomes Flour there, and Flour becomes nearly everything good. Make the first batch together, one '
        + 'of you at the hopper and one at the sails.',
    ] },
    done: 'The sails are turning again. I could almost hear it from the seaside.',
  },
  a6: {
    letter: { greeting: 'Dear ones,', art: 'apple_tree', signoff: 'Grandma Hazel', body: [
      'I am sending you a sapling from my old Apple Tree. Plant it somewhere sunny: trees take hours, not minutes, '
        + 'but they never wither and they give forever.',
      'While you wait, try Strawberries; the farm keeps growing while you are away, and that is half the magic. And '
        + 'bring me news of the hens: two Eggs in the Barn and I will know they forgave you for the move.',
      'Ollie has dragged our old bench out of the loft; it is in your build tray. Sit on it together before you go '
        + 'in, and watch the sun go down.',
    ] },
    done: 'An apple tree on the farm again. Juniper will be thrilled.',
    // wave-2 RC-01: Grandpa's bench comes with the card (at L4, with the tutorial's Golden Hour step), so the first
    // evening's last ritual (GDD §7.4) never waits on a 270-coin purchase
    rewards: { giftAtStart: ['apple_tree', 'sunset_bench'] },
  },
  a7: {
    letter: { greeting: 'My bakers,', art: 'bread', signoff: 'Flour on my nose, Grandma', body: [
      'Build a Bakery and I will tell you a secret: my bread was never fancy. Good Flour, a little patience and '
        + 'someone to share it with.',
      'Bake three loaves. Eat one warm. That is not optional.',
    ] },
    done: 'The whole farm smells of bread. I have tucked my recipe card in with this letter.',
    rewards: { collection: 'recipe_bread' },
  },
  a8: {
    letter: { greeting: 'Hello my dears,', art: 'woodpile', signoff: 'Grandma Hazel', body: [
      'The old stumps and logs around the yard are good wood, not rubbish. Clear a few and saw the wood into '
        + 'Planks at a Sawmill.',
      'Ollie says Planks build everything worth building. He is usually right, though do not tell him I said so.',
    ] },
    done: 'Wood for winter, and a little Pine for the future: I have sent you a sapling.',
    rewards: { gift: ['pine'] },
  },
  a9: {
    letter: { greeting: 'Dearest two,', art: 'cow', signoff: 'Grandma Hazel', body: [
      'Every farm needs a cow, and every cow needs a name. Buy one, milk her, churn a little Butter.',
      'Our first cow was called Clover. You may choose whatever you like, but you must choose it together.',
    ] },
    done: 'A cow with a name and a farm with butter. Things are looking very civilised.',
    rewards: { name: 'cow', memory: true },
  },
  a10: {
    letter: { greeting: 'My dears,', art: 'supper', signoff: 'Hungry from here, Grandma', body: [
      'Supper at the farmhouse was always the best hour of my day. Build a Kitchen and cook something from your '
        + 'own field.',
      'Veggie Soup and an Omelette, please. Set two places. Light the lantern.',
    ] },
    done: 'Supper for two at the old table. That table has missed this.',
  },
  a11: {
    letter: { greeting: 'My darlings,', art: 'cake', signoff: 'With all my heart, Grandma Hazel', body: [
      'This is a long letter, so put the kettle on. When Grandpa and I took on this farm we argued about '
        + 'everything except one thing: some things are only worth doing together.',
      'The Sweetheart Cake is one of them. Press "Cook together" at the Bakery at the same moment, and it bakes '
        + 'in half the time. Alone it still bakes, slowly, like everything worth waiting for.',
    ] },
    done: 'Two pairs of hands. I knew it.',
    rewards: { acorns: 5, beat: 'two_pairs', memory: true },
  },
  b1: {
    letter: { greeting: 'Well hello,', art: 'stall', signoff: 'Mabel, Mabel\'s Market', body: [
      'Mabel here. Your Grandma said you would be good for business, and I take Hazel\'s word on most things.',
      'Fill three orders for me and I will tell the whole village where the good produce comes from.',
    ] },
    done: 'Three orders, all on time! I am telling everyone. I tell everyone everything.',
  },
  b2: {
    letter: { greeting: 'Hello dears,', art: 'juice', signoff: 'Mabel', body: [
      'The schoolchildren keep asking for apple juice and I keep having none. Build a Juice Press, press a '
        + 'couple of bottles and bring me one.',
      'Cold, if you can manage it. Cold is good for business.',
    ] },
    done: 'Gone in ten minutes. You may have created a monster.',
  },
  b3: {
    letter: { greeting: 'Dears,', art: 'jam', signoff: 'Mabel', body: [
      'Jam. Everybody wants jam. Build a Preserves Kitchen and make me three Strawberry Jam.',
      'And keep an eye on my chalkboard by the stand: whatever is in demand today sells for half again. Sell me '
        + 'one thing from it and we will call it a jam session.',
    ] },
    done: 'Here: a shelf for your jars. Show them off, they are very good jars.',
    rewards: { decor: ['jam_shelf'] },
  },
  b4: {
    letter: { greeting: 'Dears,', art: 'calendar', signoff: 'Mabel, run off her feet', body: [
      'Busiest week of the year: the Fair crowd is in town and my order book is overflowing onto the floor. '
        + 'Fifteen orders, dears. Proper orders count whole; the small quick ones I count as a quarter each.',
      'Pin the ones you take so you do not both bake the same bread. I have seen it happen. I tell everyone '
        + 'about it.',
    ] },
    done: 'Fifteen! I owe you. Here are three Acorns; I have been saving them for somebody who deserves them.',
    rewards: { acorns: 3 },
  },
  b5: {
    letter: { greeting: 'Dears,', art: 'basket', signoff: 'Mabel', body: [
      'A Breakfast Hamper is the finest gift in the county: a Wooden Crate, Pancakes, a jar of Strawberry Jam '
        + 'and Orange Juice, all packed in straw. Build a Packing Table and pack me one.',
      'Bring it to the stand when it is done. I know exactly who it is for, and so do you, I expect.',
    ] },
    done: 'Perfect. It goes to the seaside on the morning cart. You may keep my old stall sign as a thank-you.',
    rewards: { decor: ['mabel_stall'], beat: 'basket_for_hazel' },
  },
  b6: {
    letter: { greeting: 'Dears,', art: 'melon', signoff: 'Mabel, melting slightly', body: [
      'It is too hot to think and the whole village wants something cold. Watermelon, dears. Sixteen hours in the '
        + 'field, and worth every one of them on a day like this.',
      'Press two jugs of Watermelon Juice and make one Watermelon Salad with a little Goat Cheese crumbled on top. '
        + 'I will put them in the shade and charge the tourists double. Not the locals. Mostly.',
    ] },
    done: 'Sold before the ice melted! Have my old awning for a melon stand of your own. Stripes are very in.',
    rewards: { decor: ['melon_awning'] },
  },
  b7: {
    letter: { greeting: 'Dears,', art: 'pepper', signoff: 'Mabel', body: [
      'My customers have gone adventurous. Mrs Pike asked for "something with a kick" and then asked for it '
        + 'again the next day. Bell Peppers, dears: red, shiny and very good at kicking.',
      'Two jars of Pickled Peppers from the Preserves Kitchen and one tray of Stuffed Peppers from the Kitchen. '
        + 'Pickling takes two hours, so start that first and stuff the rest while you wait.',
    ] },
    done: 'Gone by noon, and Mrs Pike wants the recipe. I told her it is a family secret. Your family\'s.',
  },
  b8: {
    letter: { greeting: 'Dears,', art: 'rice', signoff: 'Mabel, with a ladle', body: [
      'Sunday lunch at the market is a village tradition, and this year I have promised rice: Rice Pudding for '
        + 'the little ones, a Truffle Risotto for the grown-ups who pretend not to want pudding.',
      'Two puddings and one risotto, please. The risotto wants a Truffle, so ask your pigs nicely. The puddings '
        + 'want Milk and Sugar, so ask your cows. Everybody contributes on a Sunday.',
    ] },
    done: 'Every bowl scraped clean. Somebody licked the pudding pot, and I will not say who. It was the vicar.',
  },
  b9: {
    letter: { greeting: 'Dears,', art: 'basket', signoff: 'Mabel, in her best hat', body: [
      'Judge Pemberton is coming to dinner, and I have told him the finest basket in the county comes from your '
        + 'farm. Do not make a liar of me.',
      'One Gourmet Hamper: a crate, a Chocolate Cake, Goat Cheese, Maple Fudge and Olive Bread, packed so it '
        + 'shines. Pack it at the Packing Table and bring it to the stall. Four hours of packing; I will wait.',
    ] },
    done: 'He asked who made it. I said "the best farm in the county", and he wrote it down. Have my gold scale: '
      + 'you have outweighed me.',
    rewards: { decor: ['gold_scale'], acorns: 3 },
  },
  c0: {
    letter: { greeting: 'Good morning,', art: 'hens', signoff: 'Dr. Fern, Hollow Vet', body: [
      'Dr. Fern, the vet. Hazel asked me to look in on her hens, and I am told they have new people. Lucky hens.',
      'Doctor\'s orders: collect four eggs and make two batches of Chicken Feed. A fed hen lays, a '
        + 'waiting egg never spoils, and nobody is ever late on this farm.',
    ] },
    done: 'Bright eyes, glossy feathers, very full nests. A clean bill of health for the whole coop.',
  },
  c1: {
    letter: { greeting: 'Good morning,', art: 'baby', signoff: 'Dr. Fern, Hollow Vet', body: [
      'Dr. Fern again. Babies grow up all on their own, but a Baby Bottle from the Dairy speeds them along, '
        + 'and it is lovely to watch.',
      'Make two bottles and raise a calf to a cow. Take notes. I will want details.',
    ] },
    done: 'A healthy young cow. I may have cried a little. Professionally.',
  },
  c2: {
    letter: { greeting: 'Good morning,', art: 'compost', signoff: 'Dr. Fern', body: [
      'Every animal you tend feeds the Compost Bin. Empty it twice and spread Compost on six plots.',
      'Composted plots give an extra unit, and sometimes a blue-ribbon harvest. Soil remembers kindness.',
    ] },
    done: 'Good soil, happy farm. Here is some Compost to keep going.',
    rewards: { items: { compost: 6 } },
  },
  c3: {
    letter: { greeting: 'Good morning,', art: 'sheep', signoff: 'Dr. Fern', body: [
      'Sheep are gentle, a little stubborn and very good at standing in fields. Build a Pasture, bring two home '
        + 'and collect four Wool.',
    ] },
    done: 'Two woolly friends and a basket of Wool. They like you, I can tell.',
  },
  c4: {
    letter: { greeting: 'Good morning,', art: 'pig', signoff: 'Dr. Fern, Hollow Vet', body: [
      'Pigs are cleverer than most people I treat, and they have better noses. Build a Pig Pen and they will dig '
        + 'up Truffles, which are worth their weight in gold.',
      'They eat Pig Slop from the Feed Mill: two of anything from the field. Make six, so the slop never runs '
        + 'out mid-dig. I have seen the faces. It is not pretty.',
    ] },
    done: 'Three truffles and three very proud pigs. Here is a mud bath for them. Prescription: daily.',
    rewards: { decor: ['pig_mud_bath'] },
  },
  c5: {
    letter: { greeting: 'Good morning,', art: 'duck', signoff: 'Dr. Fern', body: [
      'Ducks need a pond, a little patience and the same Chicken Feed your hens like. Build them a Duck Pond and '
        + 'collect five eggs.',
      'Duck eggs make the silkiest custard in the county: two eggs, Milk and Sugar in the Kitchen. Make one and '
        + 'save me a spoon. For scientific purposes.',
    ] },
    done: 'Quack. That is the professional opinion. The custard was excellent, also professionally.',
  },
  c6: {
    letter: { greeting: 'Good morning,', art: 'goat', signoff: 'Dr. Fern', body: [
      'Goats climb everything, eat everything and regret nothing. Build them a Goat Yard with something to '
        + 'climb on, and collect four Goat Milk.',
      'Two of those make a wheel of Goat Cheese at the Dairy. It takes an hour and a half. The goats will '
        + 'supervise.',
    ] },
    done: 'Goat cheese, made at home. Delightful. The goats would like it noted that they helped.',
  },
  c7: {
    letter: { greeting: 'Good morning,', art: 'horse', signoff: 'Dr. Fern', body: [
      'A horse is a friend for twenty years, so choose a name you will both like saying every morning. Build a '
        + 'Stable and bring one home.',
      'Horses pull the cart down to Captain Reed\'s jetty, which pays better, and they leave Manure behind, which '
        + 'the Compost Bin turns into gold. Make two batches of Compost. Romance and manure: that is farming.',
    ] },
    done: 'What a beautiful horse. Here is a saddle rack for the stable. I am not crying; it is hay fever.',
    rewards: { decor: ['saddle_rack'], name: 'horse', beat: 'horse_sense', memory: true },
  },
  c8: {
    letter: { greeting: 'Good morning,', art: 'calf', signoff: 'Dr. Fern, Hollow Vet', body: [
      'The Breeding Barn is ready, and I have been reading about coats until two in the morning. White, brown, '
        + 'spotted, and once in a long while a golden one. Nobody knows which until the calf arrives.',
      'Choose two grown cows and let them meet in the barn. The parents carry on exactly as before; the calf '
        + 'takes a while and asks nothing of you. Then you name it. Together, please. I keep a list.',
    ] },
    done: 'A brand-new coat on the farm. Name the calf together. I have already written "adorable" in my notes.',
    rewards: { name: 'cow', memory: true },
  },
  c9: {
    letter: { greeting: 'Good morning,', art: 'alpaca', signoff: 'Dr. Fern', body: [
      'Alpacas hum when they are happy. It is the most calming sound I know, and I have listened to a great many '
        + 'contented cows. Build them an Alpaca Paddock up on the hill and bring two home.',
      'Their fleece is softer than wool. Spin one skein of Alpaca Yarn at the Weaver\'s Shed and hold it against '
        + 'your cheek. Then tell me I am exaggerating.',
    ] },
    done: 'Humming alpacas and a skein of yarn like a cloud. Best sound on the farm. Clinically proven, by me.',
  },
  d1: {
    letter: { greeting: 'Hello, hello,', art: 'cherry', signoff: 'Juniper, the orchard', body: [
      'Juniper, from the orchard. Cherry trees are the first to blossom and the last to forget who watered them.',
      'Plant two, and when they fruit, make a jar of Cherry Jam. The bees will thank you in spring.',
    ] },
    done: 'Cherries! The orchard is humming again.',
  },
  d2: {
    letter: { greeting: 'Hello, hello,', art: 'bees', signoff: 'Juniper, humming', body: [
      'The bees came back with the clover this spring. They would love a hive of their own on your farm, '
        + 'and flowers to visit: three within four tiles of it, beds or blossoms or a flowering tree.',
      'With flowers a hive fills every six hours; without, it dawdles for twelve. Place one, plant the forage, '
        + 'and wait for the first golden jar.',
    ] },
    done: 'Honey! The whole orchard smells of it. Have a wheelbarrow of flowers for the bees.',
    rewards: { decor: ['wheelbarrow'] },
  },
  d3: {
    letter: { greeting: 'Hello, hello,', art: 'pie', signoff: 'Juniper', body: [
      'Autumn whispers it every year: apples and cherries want to be pie. Build a Pie Oven and let them.',
      'One Apple Pie, one Cherry Pie. Pies are slow, two hours or so, so put them in before you sit down for '
        + 'supper and they will be golden by the time you get up.',
    ] },
    done: 'Pie Day is my favourite day. Today it is also yours.',
  },
  d4: {
    letter: { greeting: 'Hello, hello,', art: 'peach', signoff: 'Juniper', body: [
      'Peach trees grow wide and low and full of summer. They fruit faster than any other tree in the valley, '
        + 'every three hours, as if they cannot wait.',
      'Plant two side by side, and when they bear, bake a Peach Cobbler in the Pie Oven.',
    ] },
    done: 'Sunshine in a dish. The peaches agree.',
  },
  d5: {
    letter: { greeting: 'Hello, hello,', art: 'plum', signoff: 'Juniper', body: [
      'Plums are patient fruit. They blossom late, ripen slowly and taste of the whole year at once.',
      'Plant two Plum Trees and make two jars of Plum Jam. Water them now and then; a tree remembers who '
        + 'looked after it.',
    ] },
    done: 'Purple and perfect. The orchard is nearly whole again.',
  },
  d6: {
    letter: { greeting: 'Hello, hello,', art: 'olive', signoff: 'Juniper, the orchard', body: [
      'Olive trees are older than stories. Some of them in the south were already old when the stories began. '
        + 'Ours are young, silver-leaved and in no hurry at all.',
      'Build an Oil Press and press two batches of Olive Oil, four olives to a bottle. Hold the first one up to '
        + 'the light. You will see why the old people called it liquid gold.',
    ] },
    done: 'Liquid gold, just as they said. Here is a jar for the kitchen windowsill, to catch the morning.',
    rewards: { decor: ['olive_jar'], beat: 'liquid_gold' },
  },
  d7: {
    letter: { greeting: 'Hello, hello,', art: 'maple', signoff: 'Juniper', body: [
      'A maple keeps its sweetness in the cold and gives it up slowly, like some people I know. Plant a Maple '
        + 'Tree and it will be red as a fox all year.',
      'Its sap boils down at a Sugar Shack, two buckets to a bottle. Build the shack and make two bottles of '
        + 'Maple Syrup. The whole valley will smell of breakfast.',
    ] },
    done: 'Sweet as anything, and the air smells of pancakes. The bees are very confused. So am I, happily.',
  },
  d8: {
    letter: { greeting: 'Hello, hello,', art: 'cocoa', signoff: 'Juniper, who loves chocolate', body: [
      'I have a confession: I have always wanted a cocoa tree. They like it warm and sheltered and talked to '
        + 'kindly, so I think yours will be very happy.',
      'Plant one, build a Chocolatier for its beans, and bake the farm\'s first Chocolate Cake in the Pie Oven. '
        + 'I will bring the forks. I will also bring a second fork, in case.',
    ] },
    done: 'Chocolate cake from our own trees. I had three slices and I am not sorry. Not one bit.',
  },
  d9: {
    letter: { greeting: 'Hello, hello,', art: 'fig', signoff: 'Juniper, the orchard', body: [
      'Figs come last. They wait until every other tree has fruited, then they ripen all at once in the evening '
        + 'light, soft and purple and a little bit smug.',
      'Plant a Fig Tree, the last tree the valley knows, and bake one Fig and Goat Cheese Tart. Eat it on the '
        + 'hill at sunset. That is not part of the task. It is just good advice.',
    ] },
    done: 'Thirteen kinds of tree, and every one of them loved. The orchard is complete. Have a crate of figs to '
      + 'remember it.',
    rewards: { decor: ['fig_crate'] },
  },
  e1: {
    letter: { greeting: 'Afternoon,', art: 'fence', signoff: 'Ollie, carpenter', body: [
      'Ollie here. That meadow past the east fence is for sale. Creekside, folk call it. Good soil, a creek, a '
        + 'wild pine.',
      'Every new piece of land lets you till six more plots. Have a look at the "For sale" sign when you are ready.',
    ] },
    done: 'New land. Smells like possibility. And a bit like creek.',
  },
  e2: {
    letter: { greeting: 'Afternoon,', art: 'barn', signoff: 'Ollie', body: [
      'That Barn is bursting. Bring me a couple of Planks and some coins and I will make it bigger.',
      'A full Barn never loses anything, mind: extra goods stack by the door. But a tidy barn is a happy barn.',
    ] },
    done: 'Bigger barn. Same old creaky door. I left the creak in on purpose.',
  },
  e3: {
    letter: { greeting: 'Afternoon,', art: 'crate', signoff: 'Ollie', body: [
      'A building with one more slot works through the night for you. Buy a slot anywhere you like.',
      'And make me two Wooden Crates while the Sawmill is warm. Expansions and barns need them.',
    ] },
    done: 'Slots and sawdust. My two favourite things.',
  },
  e4: {
    letter: { greeting: 'Afternoon,', art: 'greenhouse', signoff: 'Ollie, carpenter', body: [
      'Your Grandma\'s old greenhouse is falling down, and that is a crime against good glass. I have opened a '
        + 'ledger in the Journal: four bundles of goods, and each one needs only some of its slots filled.',
      'Two bundles and I can start on the frames. Finish all four and you get twelve plots under glass, on top '
        + 'of your usual, and every one of them in season all year.',
    ] },
    done: 'Glass in, frames straight. She will stand another fifty years.',
  },
  e5: {
    letter: { greeting: 'Afternoon,', art: 'flowers', signoff: 'Ollie', body: [
      'A pretty farm makes for a happy farmer. Every bit of decor counts toward the farm\'s beauty, and so does '
        + 'every building and tree.',
      'Get it up to two beauty stars. Put the nice things next to the paths; folk notice them more there.',
    ] },
    done: 'Pretty as a picture. Have a rose arch, built properly, with real joints.',
    rewards: { decor: ['rose_arch'] },
  },
  e6: {
    letter: { greeting: 'Afternoon,', art: 'bridge', signoff: 'Ollie', body: [
      'The old stone bridge over the brook to the meadow fell in before your time. With the right bundles I can '
        + 'set it back up, stone by stone.',
      'Finish one whole Restoration project, and then we cross it together and see what grows on the other side.',
    ] },
    done: 'The bridge stands. The meadow is ours, and the wildflowers are taller than I am.',
  },
  e7: {
    letter: { greeting: 'Afternoon,', art: 'ferry', signoff: 'Ollie', body: [
      'Across the river there is a whole village that has been asleep for years. The ferry landing is the first '
        + 'thing it needs, so folk can come and go.',
      'Bring goods and coins to the project board and I will build it the very next day. One project at a time, '
        + 'mind. Good work is never rushed.',
    ] },
    done: 'The lights are on across the river. I may have stood and watched for a while.',
    rewards: { beat: 'lights_across' },
  },
  e8: {
    letter: { greeting: 'Afternoon,', art: 'village', signoff: 'Ollie, carpenter', body: [
      'The ferry runs, the chapel bell rings, and people are asking about the empty cottages across the river. '
        + 'A village does not wake all at once. It wakes one window at a time.',
      'Three more Town Projects and I reckon it is properly awake. Same as before: the goods first, then the '
        + 'coins, and I build it the very next day. Measure twice, build once.',
    ] },
    done: 'A village again. Who would have thought. There are children on the bridge, fishing for nothing in '
      + 'particular. Three Acorns, for the trouble.',
    rewards: { acorns: 3 },
  },
  e9: {
    letter: { greeting: 'Afternoon,', art: 'farmhouse', signoff: 'Ollie', body: [
      'I have been round the old farmhouse with a lamp and a notebook. The bones are good. The rest needs '
        + 'quilts, candles, a full larder and about a mile of planks.',
      'It is the last page of Grandma\'s Ledger. Finish two more bundles, on whichever page you are, and we will '
        + 'know it can be done. Any of the slots will do in each bundle, same as always.',
    ] },
    done: 'Two bundles in, and the house feels warmer already. I swear the chimney sighed.',
  },
  e10: {
    letter: { greeting: 'Afternoon,', art: 'farmhouse', signoff: 'Ollie, with sawdust in his beard', body: [
      'One more push and Grandma\'s farmhouse is whole: the comfort, the larder, the sweets and the woodwork. '
        + 'Finish the project and the rooms inside are yours to furnish.',
      'And I will tell you a secret, since you have earned it. When it is done, a certain somebody is coming '
        + 'home for a visit. She made me promise not to say. I have not said. You guessed.',
    ] },
    done: 'Grandma is home for a visit. Go and say hello. I will be by the gate, pretending I have something in my '
      + 'eye.',
    rewards: { acorns: 5, beat: 'grandma_visits', memory: true },
  },
  f1: {
    letter: { greeting: 'Ahoy,', art: 'barge', signoff: 'Captain Reed', body: [
      'Captain Reed of the river barge. I dock at your jetty every Monday at six bells and cast off Sunday at '
        + 'eight in the evening, sharp as a cleat.',
      'Each crate on my manifest wants one good from your farm. Load three and we are friends, mateys. Load a '
        + 'whole row and there is an Acorn and a share of my chest in it, port and starboard.',
    ] },
    done: 'Three crates aboard and stowed shipshape. Same time next week, fore and aft.',
  },
  f2: {
    letter: { greeting: 'Ahoy,', art: 'barge', signoff: 'Captain Reed', body: [
      'A row is three crates side by side, and a full row is a proper cargo. Load one complete row this week, '
        + 'mateys, before the tide.',
      'Flag a crate if you want your other half to load it. I do not mind who carries it, as long as it is '
        + 'aboard by Sunday, anchor and all.',
    ] },
    done: 'Full row! Have a coil of good rope for the jetty. Mind the knots, starboard.',
    rewards: { decor: ['rope_coil'] },
  },
  f3: {
    letter: { greeting: 'Ahoy,', art: 'barge', signoff: 'Captain Reed', body: [
      'Two full rows in one week and I will call you sailors. The more you played last week, the more rows I '
        + 'bring, so there will be room on deck.',
      'Fill every row I offer and my chest gets richer next week. Miss one and it is no shame; the river '
        + 'forgives, aye, and so do I. Anchors aweigh.',
    ] },
    done: 'Sailors, both of you. I will blow the horn when I pass the farm, from stem to stern.',
    rewards: { acorns: 3, beat: 'ship_shape' },
  },
  g1: {
    letter: { greeting: 'Greetings,', art: 'rosette', signoff: 'Judge Pemberton, Chief Judge, County Fair', body: [
      'The County Fair is open for entries from Monday until Sunday at eight in the evening, when I announce '
        + 'the medals myself. In a hat.',
      'Bring your finest crafted goods to the Fair tent. Three entries, if you please. Variety impresses the '
        + 'bench; ten of the same jam does not.',
    ] },
    done: 'Hmm. Hmm! Promising. I have made a note. In ink.',
  },
  g2: {
    letter: { greeting: 'Greetings,', art: 'rosette', signoff: 'Judge Pemberton', body: [
      'A blue-ribbon crop is one grown on composted soil, cared for, and blessed with a little luck. They score '
        + 'at the Fair the moment you harvest them.',
      'Bring in three such harvests. Compost the plots first. I cannot stress the compost enough. I have been '
        + 'told I stress it too much.',
    ] },
    done: 'Ribbon-worthy. Indeed. I have pinned a fourth rosette to my lapel in your honour.',
  },
  g3: {
    letter: { greeting: 'Greetings,', art: 'rosette', signoff: 'Judge Pemberton', body: [
      'Silver is awarded to a farm that reaches six tenths of the week\'s target. Entries, blue ribbons, '
        + 'duet goods counted double: it all adds up on my ledger.',
      'Earn a Silver medal in any one week. I believe in you. Moderately. With growing conviction.',
    ] },
    done: 'Silver! A rosette for the farm, and I pinned it on the gate myself.',
    rewards: { decor: ['silver_rosette'], beat: 'silver_lining' },
  },
  g4: {
    letter: { greeting: 'Greetings,', art: 'rosette', signoff: 'Judge Pemberton, Chief Judge, County Fair', body: [
      'The county has a league, and your farm is in it. Five neighbouring farms bring their best to my tent every '
        + 'week, and on Sunday I rank you all. The top two move up a league. The last moves down. I do the moving.',
      'Climb into the Meadow League, the second of five. You compete together, as one farm, against the rest '
        + 'of the county. Never against each other. I will not have squabbling at my Fair.',
    ] },
    done: 'Promoted! The Bramble sisters are furious. Delightfully so. Onwards and, I trust, upwards.',
  },
  g5: {
    letter: { greeting: 'Greetings,', art: 'basket', signoff: 'Judge Pemberton', body: [
      'The Hamper Show is the jewel of my calendar. From now on a hamper entered at the Fair tent scores double, '
        + 'and I expect to see the best packing in the county.',
      'Enter two hampers in any week, or over several. Straw tidy, ribbons straight, nothing squashed. I check. '
        + 'I have a small ruler for the purpose.',
    ] },
    done: 'Exquisite packing. Exquisite! A rosette for the hampers, and my small ruler is satisfied.',
    rewards: { decor: ['hamper_rosette'] },
  },
  h1: {
    letter: { greeting: 'From Grandma\'s journal:', art: 'bench', signoff: '(pressed between the pages: a daisy)',
      body: [
        '"Every evening we sat on the bench by the fence and watched the sun go down. Ten quiet seconds side by '
          + 'side, and the whole farm seemed to work a little faster."',
        '"He said it was the light. I said it was us. We never settled it."',
      ] },
    done: 'Golden Hour, together. A page for the Memory Book.',
    rewards: { hearts: 1, memory: true },
  },
  h2: {
    letter: { greeting: 'From Grandma\'s journal:', art: 'cake', signoff: '(a flour fingerprint)', body: [
      '"Recipes for two: one stirs, one tastes. Both press the button at the same moment, or it does not count."',
      '"Our first one was a disaster. The second one we ate on the porch with two forks."',
    ] },
    done: 'Cooked together, eaten together.',
    rewards: { hearts: 2 },
  },
  h3: {
    letter: { greeting: 'From Grandma\'s journal:', art: 'hearts', signoff: '(a little drawn heart)', body: [
      '"When one of us put up a flag for help, the other came running. Orders, crates, the odd stubborn bundle."',
      '"Three times is a habit. A good habit is a kind of love letter."',
    ] },
    done: 'Helping hands, three times over.',
    rewards: { hearts: 2 },
  },
  h4: {
    letter: { greeting: 'From Grandma\'s journal:', art: 'giant', signoff: '(a pumpkin seed taped in)', body: [
      '"The year we composted a whole square of the field and planted it in one go, something enormous came up '
        + 'in the middle of it."',
      '"It took both of us to bring it down, one swing each, turn and turn about. Alone it would have taken all '
        + 'afternoon."',
    ] },
    done: 'A giant, felled together. Somebody will be eating soup for a month.',
    rewards: { decor: ['giant_trophy'], beat: 'giants' },
  },
  h5: {
    letter: { greeting: 'From Grandma\'s journal:', art: 'cake', signoff: '(a ribbon)', body: [
      '"A cake for two, on a day for two. Three tiers, because we could not agree on two."',
      '"Make it together, at the Kitchen, at the same moment. Some recipes are only worth making that way."',
    ] },
    done: 'Another page for the book, and cake for days.',
    rewards: { hearts: 2, memory: true },
  },
  h6: {
    letter: { greeting: 'From Grandma\'s journal:', art: 'dock', signoff: '(a fishing line knot)', body: [
      '"We used to sit on the end of the dock with two rods and one thermos. He said we were fishing. I said we '
        + 'were sitting. We were both right."',
      '"Cast at the same time and wait. We never caught much. That was never the point."',
    ] },
    done: 'Two lines in the water, and nobody in a hurry. Gone fishing, together.',
    rewards: { hearts: 2 },
  },
  h7: {
    letter: { greeting: 'From Grandma\'s journal:', art: 'bench', signoff: '(the last page, signed by both of us)',
      body: [
        '"From the top of the hill you can see the whole farm: every field, every roof, the river and the lights '
          + 'of the village. We used to climb up there on our anniversary and not say very much."',
        '"Sit there together when the sun goes down. Bring someone you love. Bring a blanket, too; it gets cold."',
      ] },
    done: 'Golden Hour on the hill. The last page of the journal, and a gilded frame for the Memory Book wall.',
    rewards: { hearts: 3, memory: true, furniture: ['memory_frame'] },
  },
};

/**
 * Story beats (GDD §5.3): illustrated letter cards in M1 (vignettes from M3). Shown to both players: "Watch
 * together?" when both are online, otherwise queued for the absent partner and replayable from the Journal.
 */
export const STORY_BEATS = [
  { id: 'two_pairs', m: 'M1a', title: 'Two Pairs of Hands', art: 'cake', from: 'hazel',
    text: 'Grandma\'s long letter ends with a photograph: two young farmers on the porch, flour to the elbows, '
      + 'laughing. On the back, in her handwriting: "Some things are only worth doing together."' },
  { id: 'basket_for_hazel', m: 'M1b', title: 'A Basket for Hazel', art: 'basket', from: 'mabel',
    text: 'Mabel sends the hamper to the seaside. A postcard comes back the next week: "Tell them it was perfect."' },
  { id: 'horse_sense', m: 'M1b', title: 'Horse Sense', art: 'horse', from: 'fern',
    text: 'The horse noses at the paddock gate every morning, waiting for its two favourite people.' },
  { id: 'liquid_gold', m: 'M2', title: 'Liquid Gold', art: 'olive', from: 'juniper',
    text: 'The first olive oil glows like a lantern on the kitchen windowsill.' },
  { id: 'lights_across', m: 'M1b', title: 'Lights Across the River', art: 'ferry', from: 'ollie',
    text: 'One by one, windows light up across the river. The village is waking.' },
  { id: 'grandma_visits', m: 'M2', title: 'Grandma Comes Home', art: 'farmhouse', from: 'hazel',
    text: 'A taxi at the gate. Grandma Hazel steps out, looks at the farm for a long moment, and says: "Well. '
      + 'Look what you two have done."' },
  { id: 'ship_shape', m: 'M1b', title: 'Ship Shape', art: 'barge', from: 'reed',
    text: 'Captain Reed blows the barge horn twice as he passes the farm. He does that only for friends.' },
  { id: 'silver_lining', m: 'M1b', title: 'Silver Lining', art: 'rosette', from: 'pemberton',
    text: 'Judge Pemberton pins a silver rosette on the farm gate himself.' },
  { id: 'giants', m: 'M1b', title: 'Giants of the Field', art: 'giant', from: 'journal',
    text: 'The giant pumpkin rolls, wobbles and settles. Somebody will be eating soup for a month.' },
];
