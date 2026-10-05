// Onboarding: the first evening (GDD §7.4). Taught by doing, one step at a time, with Grandma's letter as the voice.
// Two parallel tracks from 0:20, auto-assigned by who acts first and swappable: Fields (A1, A2, A4) and Barnyard
// (A3). They meet at A5 for a shared beat ("Make Flour together"). A solo player gets both tracks one after the
// other. Any step can be skipped ("I know farming"). Per-player first-use tips are keyed by player, not by farm
// progress, so a partner who joins at minute 20 still learns everything.
//
// Step: { id, track, text, task: { verb, ref, qty } | null, tool?, level?, quest?, both? }
//   task uses the quest verbs (story.js QUEST_VERBS) plus 'name' (name the farm), 'tend' (feed animals), 'ping'
//   and 'sit' (Golden Hour); `level` = the step waits for this farm level; `quest` = the A-chain card it walks
//   through; `both` = a together step (a solo player completes it alone).

export const TUTORIAL = {
  m: 'M1a',
  tracks: ['fields', 'barnyard'],
  start: [
    // names and colours were picked on the slot picker already (RC-26)
    { id: 'welcome', track: 'together', text: 'The farm is yours, both of you. First, let\'s give it a name.',
      task: null },
    { id: 'name_farm', track: 'together', text: 'Name your farm together. It will be carved on the gate sign.',
      task: { verb: 'name', ref: 'farm', qty: 1 }, both: true },
  ],
  fields: [
    { id: 'plant_wheat', track: 'fields', text: 'Drag across the plots to plant Wheat.', tool: 'seed_bag', quest: 'a1',
      task: { verb: 'plant', ref: 'wheat', qty: 6 } },
    { id: 'harvest_wheat', track: 'fields', text: 'Drag the Sickle across the ripe Wheat. It flies to the Barn.',
      tool: 'sickle', quest: 'a1', task: { verb: 'harvest', ref: 'wheat', qty: 6 } },
    { id: 'sell_wheat', track: 'fields', text: 'Sell 10 Wheat at the Market Stand. Coins fly to the treasury.',
      quest: 'a2', task: { verb: 'sell', ref: 'wheat', qty: 10 } },
    { id: 'first_order', track: 'fields', text: 'Mabel\'s first order: 8 Wheat. Orders pay more than the market.',
      level: 2, quest: 'a4', task: { verb: 'fill', ref: 'order', qty: 1 } },
  ],
  barnyard: [
    { id: 'clear_weeds', track: 'barnyard', text: 'Click the weeds and rocks around the yard.', tool: 'hand',
      task: { verb: 'clear', ref: 'debris', qty: 3 } },
    { id: 'place_coop', track: 'barnyard', text: 'Place Grandma\'s Coop from the build tray. It is free.',
      tool: 'hammer',
      quest: 'a3', task: { verb: 'place', ref: 'coop', qty: 1 } },
    { id: 'place_feed_mill', track: 'barnyard', text: 'Place the Feed Mill next to it. Also free.', tool: 'hammer',
      quest: 'a3', task: { verb: 'place', ref: 'feed_mill', qty: 1 } },
    { id: 'make_feed', track: 'barnyard', text: 'Make Chicken Feed from 3 Wheat (your partner\'s Wheat works too).',
      quest: 'a3', task: { verb: 'make', ref: 'chicken_feed', qty: 1 } },
    { id: 'feed_hens', track: 'barnyard', text: 'Feed the hens. Eggs in 20 minutes, and they wait until you collect.',
      tool: 'feed_scoop', quest: 'a3', task: { verb: 'tend', ref: 'chicken', qty: 2 } },
    // no "Collect 3 Eggs" step: the eggs take 20 minutes, and the track must never wait on them (RC-01; A6 asks)
  ],
  together: [
    { id: 'flour_together', track: 'together', text: 'Grandma\'s Windmill is back. Make Flour together.', level: 3,
      quest: 'a5', task: { verb: 'make', ref: 'flour', qty: 3 }, both: true },
    { id: 'say_hello', track: 'together', text: 'Ping your partner (G) or wave (T).', task: { verb: 'ping',
      ref: 'partner', qty: 1 },
      both: true },
    { id: 'apple_tree', track: 'together', text: 'Some things take hours. The farm keeps growing while you are away.',
      level: 4, quest: 'a6', task: { verb: 'plant', ref: 'apple_tree', qty: 1 } },
    { id: 'golden_hour', track: 'together',
      text: 'Before you log off: sit on the Sunset Bench together for Golden Hour.',
      level: 4, task: { verb: 'sit', ref: 'sunset_bench', qty: 1 }, both: true },
  ],
  /** Shown once per PLAYER the first time they use a tool or open a panel: a 3-second, non-blocking hint. */
  firstUse: [
    { id: 'sickle', text: 'Drag across ripe crops to harvest a whole row.' },
    { id: 'seed_bag', text: 'Drag across empty plots to plant. Each plot costs one seed.' },
    { id: 'feed_scoop', text: 'Drag over a pen to collect and re-feed every animal at once.' },
    { id: 'watering_can', text: 'Water crops of 30 minutes or more: they grow 15 % faster.' },
    { id: 'hammer', text: 'R rotates, Esc cancels. Moving keeps every timer running.' },
    { id: 'building_panel', text: 'Queue up to the slot count. Ingredients are used when an item enters the queue.' },
    { id: 'market_panel', text: 'Pick a stack, slide the amount, sell.' },
    // M1b (wave 2): the new tool and panels. A hint whose system is not live is simply never shown.
    { id: 'seed_spreader', text: 'The Seed Spreader plants a 2x2 patch in one stroke.', m: 'M1b' },
    { id: 'fair_panel', text: 'Entries use up the good. Ten of one kind a week at most: variety scores.', m: 'M1b' },
    { id: 'barge_panel', text: 'Load a crate from the Barn. A full row of three pays an Acorn and a chest share.',
      m: 'M1b' },
    { id: 'restoration_panel', text: 'A bundle needs only some of its slots. Donate a little at a time, either of you.',
      m: 'M1b' },
    { id: 'town_panel', text: 'Bring the three goods and the coins. Ollie builds it the next day.', m: 'M1b' },
    { id: 'townsfolk_panel', text: 'Requests leave on Sunday night, nothing lost. Each one filled is a friend made.',
      m: 'M1b' },
    { id: 'collections_panel', text: 'Finds turn up while you farm. Three spare finds trade for a missing one.',
      m: 'M1b' },
    { id: 'beehive', text: 'Three flowers within 4 tiles of a hive: Honey every 6 hours instead of 12.', m: 'M1b' },
    { id: 'pig_pen', text: 'Pigs dig Truffles after a bowl of Pig Slop. The Feed Mill makes it from any produce.',
      m: 'M1b' },
    // M2 (wave 3): the new tool and panels
    { id: 'grand_sickle', text: 'The Grand Sickle harvests a 3x3 patch in one stroke.', m: 'M2' },
    { id: 'perks_panel', text: 'One point every two personal levels. Your perks help only you; respec once a week.',
      m: 'M2' },
    { id: 'nursery_panel', text: 'One care step at a time, 10 minutes apart. Either of you can do any step.', m: 'M2' },
    { id: 'breeding_panel', text: 'Two grown animals of a kind. The parents stay exactly as they were.', m: 'M2' },
    { id: 'fishing', text: 'Wait for the bite, then reel. Even a slow reel brings something in.', m: 'M2' },
    { id: 'league_panel', text: 'Top two move up on Sunday, last place moves down. You always compete together.',
      m: 'M2' },
    { id: 'track_panel', text: 'Every XP counts toward the track. Either of you can claim a tier once it fills.',
      m: 'M2' },
    { id: 'duel_panel', text: 'A duel never costs the farm anything. Harvesting your partner\'s pumpkins scores for '
      + 'them.', m: 'M2' },
    { id: 'interior', text: 'Pick a piece in the catalog, then a spot in the room. Moving, turning and storing are '
      + 'free.', m: 'M2' },
  ],
  firstUseMs: 3000,
};
