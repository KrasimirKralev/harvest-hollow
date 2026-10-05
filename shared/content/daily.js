// Daily and weekly systems (GDD §5.8, §6.2 #15): Daily Gift, Farm Weeks, the Daily Almanac with its Together task,
// the Couple Challenge and the morning recap. Hand-authored rule numbers. Coins sized in "E-hours" are basis points
// of one hour of E(level) (10_000 = 1 h); eHours(level, bp) in index.js turns them into coins.

/**
 * Daily Gift calendar (L3): a 28-day farm calendar, claimed by either partner once per play day; a missed day
 * pauses it (never resets). Days 7/14/21 pay 2 Acorns (14 also a decor), day 28 pays 5 Acorns and the season's
 * decor; other days pay E x 0.1 h coins, or 3 Compost every 3rd day, or a seed packet every 5th day. A reward
 * whose system is not unlocked yet (Compost L8, seed packets L10) pays the coins instead.
 */
const giftDay = (day) => {
  if (day === 28) return { day, acorns: 5, decor: 'season' };
  if (day % 7 === 0) return day === 14 ? { day, acorns: 2, decor: 'picnic_table' } : { day, acorns: 2 };
  if (day % 5 === 0) return { day, seedPacket: 1 };
  if (day % 3 === 0) return { day, items: { compost: 3 } };
  return { day, coinsBp: 1000 };
};
export const DAILY_GIFT = {
  unlock: 3,
  m: 'M1a',
  days: Array.from({ length: 28 }, (_, i) => giftDay(i + 1)),
  fallbackCoinsBp: 1000,
  unlocks: { compost: 8, seedPacket: 10 },
  seasonDecor: { spring: 'tulip_planter', summer: 'sunflower_planter', autumn: 'pumpkin_lanterns',
    winter: 'snow_lantern' },
};

/**
 * Farm Weeks (L3, GDD §5.8 v2 G3): the streak counts weeks (Monday start, farm time zone) in which the farm was
 * played on at least `minDays` days (either partner, >= `minMinutes` minutes). One free skip week per `skipEvery`
 * streak weeks, at most `skipMax` held, used automatically. Breaking it costs only the counter. Milestones upgrade
 * the farm-gate signpost (cosmetic).
 */
export const FARM_WEEKS = {
  unlock: 3, m: 'M1a', minDays: 2, minMinutes: 5, skipEvery: 4, skipMax: 2, milestones: [4, 12, 52, 104],
};

/**
 * Daily Almanac (L3, GDD §5.8; L8 before wave 2): per player, 4 personal micro-tasks of 2-8 minutes that refresh
 * when completed.
 * Only the first `paidPerDay` completions per player per day pay (coins E x 0.02 h, XP E x 0.02 h / 8); later ones
 * count for the ribbon only. The two players' tasks are complementary (different targets, never the same target
 * class); while both are online an action by either counts for both players' tasks of that type. Finishing the
 * day's first 4 opens the Daily chest. One free reroll per player per day.
 *
 * Template: { id, verb, domain, target, qty: [lo, hi], unlock, m } where `target` is the kind of ref the task picks
 * (a live, unlocked, producible one; G-VALID) and qty is drawn in [lo, hi]. `domain` (fields, barnyard, workshop,
 * orchard, market, farm) keeps the two players' tasks apart (complementary rule).
 */
export const ALMANAC = {
  // wave-2 RC-01: from L3 (was L8), so the first evening always has a micro-task in reach (GDD §1.4, §5.8)
  unlock: 3,
  m: 'M1a',
  tasksPerPlayer: 4,
  paidPerDay: 4,
  coinsBp: 200,
  xpBp: 200,
  freeRerollsPerDay: 1,
  /** The Daily chest. A part whose system is not unlocked yet (`unlocks`: Compost L8, collections L10) is left out;
   * a chest left empty that way pays `coinsBp` E-hours instead, so the first days' chest is never a blank box. */
  chest: { items: { compost: 3 }, collectionRoll: true, coinsBp: 1000 },
  unlocks: { compost: 8, collectionRoll: 10 },
  templates: [
    { id: 'harvest', verb: 'harvest', domain: 'fields', target: 'crop:session', qty: [10, 30], unlock: 3, m: 'M1a' },
    { id: 'plant', verb: 'plant', domain: 'fields', target: 'crop:session', qty: [8, 20], unlock: 3, m: 'M1a' },
    { id: 'water', verb: 'water', domain: 'fields', target: 'crop:waterable', qty: [5, 15], unlock: 4, m: 'M1a' },
    { id: 'collect', verb: 'collect', domain: 'barnyard', target: 'animal', qty: [3, 8], unlock: 3, m: 'M1a' },
    { id: 'pet', verb: 'pet', domain: 'barnyard', target: 'animal', qty: [3, 3], unlock: 3, m: 'M1a' },
    { id: 'craft', verb: 'make', domain: 'workshop', target: 'recipe:short', qty: [1, 3], unlock: 3, m: 'M1a' },
    { id: 'feed', verb: 'make', domain: 'workshop', target: 'feed', qty: [6, 12], unlock: 3, m: 'M1a' },
    { id: 'fruit', verb: 'harvest', domain: 'orchard', target: 'tree', qty: [1, 2], unlock: 4, m: 'M1a' },
    { id: 'order', verb: 'fill', domain: 'market', target: 'order', qty: [1, 1], unlock: 3, m: 'M1a' },
    { id: 'debris', verb: 'clear', domain: 'farm', target: 'debris', qty: [1, 1], unlock: 3, m: 'M1a' },
    { id: 'fair', verb: 'enter', domain: 'workshop', target: 'fair', qty: [1, 1], unlock: 14, m: 'M1b' },
  ],
  /** Recipes and crops a micro-task may pick: session crops up to this grow time, recipes up to this craft time. */
  sessionCropMinutes: 60,
  shortRecipeMinutes: 30,
  /**
   * The shared Together task (one a day, ~15 minutes of play for two), fed by both players' actions: 2 Hearts each
   * and 1 Compost. Sizes are for two players playing ~15 minutes.
   */
  together: {
    hearts: 2,
    items: { compost: 1 },
    templates: [
      { id: 'harvest_together', verb: 'harvest', text: 'Harvest {n} crops together', qty: 60, unlock: 3, m: 'M1a' },
      { id: 'collect_together', verb: 'collect', text: 'Collect {n} animal goods together', qty: 20, unlock: 3,
        m: 'M1a' },
      { id: 'craft_together', verb: 'make', text: 'Craft {n} goods together', qty: 8, unlock: 3, m: 'M1a' },
      { id: 'water_together', verb: 'water', text: 'Water {n} crops together', qty: 30, unlock: 4, m: 'M1a' },
      { id: 'orders_together', verb: 'fill', text: 'Fill {n} orders together', qty: 3, unlock: 3, m: 'M1a' },
    ],
  },
};

/**
 * Couple Challenge (GDD §5.8): a weekly goal from the first Monday after reaching L6, sized to about 2 engaged
 * hours of the reference couple and finishable alone. Counted by VALUE or production, never by order count (R15):
 * the target is E(level on Monday) x `hoursBp` of value (the template's measure), or `count` distinct things.
 * Reward: 3 Acorns, the week's decor piece (TROPHIES with source 'challenge', in order) and 5 Hearts to each
 * contributor; an "Equal Partners" sticker when both gave >= 10 %.
 */
export const COUPLE_CHALLENGE = {
  unlock: 6,
  m: 'M1a',
  startsMonday: true,
  reward: { acorns: 3, hearts: 5, decorFrom: 'challenge' },
  equalShareBp: 1000,
  templates: [
    { id: 'harvest_value', text: 'Harvest crops worth {coins} together', measure: 'harvestValue', hoursBp: 8000,
      m: 'M1a' },
    // G-VALID at roll time (wave-1 QA RC-16): animal goods only with `minAdults` adult animals on the farm
    { id: 'collect_value', text: 'Collect animal goods worth {coins}', measure: 'collectValue', hoursBp: 5000,
      minAdults: 4, m: 'M1a' },
    { id: 'craft_value', text: 'Craft goods that add {coins} of value', measure: 'craftAdded', hoursBp: 4000,
      m: 'M1a' },
    { id: 'orders_value', text: 'Fill orders worth {coins}', measure: 'orderValue', hoursBp: 10_000, m: 'M1a' },
    // the target is min(count, recipes the farm can make now); skipped below `minCount` makeable recipes (RC-16)
    { id: 'recipes_distinct', text: 'Craft {n} different recipes', measure: 'distinctRecipes', count: 8, minCount: 4,
      m: 'M1a' },
    // M1b: from the Barge's level; the target is min(count, crates the Captain offers this week), so a week with one
    // offered row (a solo week) asks for 3, never for crates that do not exist (G-VALID, finishable alone)
    { id: 'crates', text: 'Load {n} barge crates', measure: 'bargeCrates', count: 6, unlock: 15, capToOffered: true,
      m: 'M1b' },
  ],
};

/** "While you were away" (GDD §5.8): the sections of the morning recap card, in display order. */
export const RECAP = {
  sections: ['ripened', 'partnerDid', 'keepsakes', 'notes', 'newUnlocks', 'storyBeats', 'fairAndBarge'],
  maxFeedLines: 12,
};
