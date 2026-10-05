// Time and yield modifiers, boosts and mastery (GDD §3.1 rules, §3.2, §3.4, §3.7, §4.8). Hand-authored rule
// numbers; percentages are basis points, durations ms. Time reductions ADD and are applied with a floor of
// `timeFloorBp` of the base time (GDD §4.8: -10 % mastery, -10 % in season, -10 % Golden Hour, -15/-20 % watering
// and -5 % partner tend never take a process below half its base time).
import { min, h } from './units.js';

export const GROWTH = {
  timeFloorBp: 5000,
  /** §3.1 rule 4: crops of >= 30 min can be watered once per cycle by anyone (-15 % of the base time); trees -20 %
   * (§3.2 rule 5). The OTHER player's partner tend adds COOP.partnerTend.bp once per cycle. Rain waters too. */
  water: { cropBp: 1500, treeBp: 2000, minCropMs: min(30) },
  /** §3.1 rule 5: one Compost on a plot (before planting or while growing, not once ready): +1 unit at harvest and a
   * blue-ribbon chance of 10 % + 2 points per mastery star (★1-★3) + 5 at Gold + 3 from the Grower perk, at most
   * 24 %. A blue-ribbon harvest gives one more unit. Trees: once per cycle, +1 fruit and a 10 % blue-ribbon fruit. */
  compost: { unlock: 8, bonusUnits: 1, ribbonBp: 1000, perStarBp: 200, goldBp: 500, perkBp: 300, maxBp: 2400,
    ribbonUnits: 1, treeBonusUnits: 1, treeRibbonBp: 1000 },
  /**
   * Fertilizer (owner wish 2, 2026-10-04): the Compost Bin's richer product, 2 Compost + 1 Egg (the crushed shells)
   * in 30 minutes (recipe `fertilizer`, L10). Spread on a GROWING crop of 30 minutes or more (shared/rules
   * actions/farming.js fertilize), once a cycle: it ripens `timeBp` (25 %) of its base grow time sooner (inside
   * GROWTH.timeFloorBp with every other reduction) and gives `bonusUnits` (+2) more at harvest. It stacks with Compost
   * (Compost stays the plain +1 and the blue-ribbon chance), so the pair is worth it on the long crops. The UI names
   * it "Fertilizer" everywhere; Compost stays "Compost".
   */
  fertilizer: { unlock: 10, item: 'fertilizer', bonusUnits: 2, timeBp: 2500, m: 'M1a' },
  /** §3.1 rule 7: harvesting within the Fresh window (crop.freshMs after ripening) pays +10 % XP. */
  fresh: { xpBonusBp: 1000 },
  /** §3.1 rule 8: in season: -10 % grow time (fixed at planting) and +10 % sell price. */
  season: { timeBp: 1000, sellBp: 1000 },
  // §3.1 rule 10, the Level-up Bloom, has no numbers since the owner's rule of 2026-10-04: a level-up finishes everything
  // growing on the farm (rules/actions/boosts.js bloom)
  /** §3.2: Grove = four trees of one species in an exact 2x2 block of trees: +1 fruit each; Heirloom after
   * TREE.heirloomAt harvests: +1 fruit and a 5 % blue-ribbon fruit chance on every harvest. */
  grove: { bonusUnits: 1 },
  heirloom: { bonusUnits: 1, ribbonBp: 500, showFrom: 22, m: 'M1b' },
  /** §3.4 rules 3 and 7: Baby Bottle -30 % of the remaining baby time; a blue-ribbon animal adds a 10 % chance of
   * its blue-ribbon good (4 x V); selling one returns 100 % of the price paid for it (else 50 %). */
  babyBottle: { bp: 3000 },
  prizedAnimal: { premiumBp: 1000, resaleBp: 10_000, normalResaleBp: 5000 },
  /** §3.4 Bees (M1b): 6 h with >= 3 forage objects within 4 tiles when the cycle starts, else 12 h; crops and trees
   * within 4 tiles of a productive hive get +5 % bonus-unit chance (one hive effect per object). */
  bees: { forageNeeded: 3, radius: 4, slowCycleMs: h(12), pollinationBp: 500, m: 'M1b' },
};

/** Boosts the store or rewards hand out (GDD §3.7). */
export const BOOSTS = {
  /** Finish one timer now (plot, tree, animal, the running item of one queue): 1 Acorn per started hour remaining,
   * at most 8. */
  hurry: { unlock: 5, acornsPerHour: 1, maxAcorns: 8, m: 'M1a' },
  /** Golden Seed Packet: 5 golden seeds for 12 Acorns; a plot planted with one is guaranteed blue-ribbon. */
  goldenSeeds: { unlock: 8, acorns: 12, seeds: 5, m: 'M1a' },
  /**
   * A level whose unlock list is empty in this milestone (M1a from L13) pays one item of the GDD §4.6 Legacy pool
   * that exists now: odd levels 10 Acorns, even levels a Golden Seed Packet (wave-1 QA RC-14, R8 "every level gives
   * something").
   */
  legacyLevel: { acorns: 10, goldenSeeds: 5 },
  /** Seed packet: 5 free plantings of one crop (pet finds, Daily Gift, quests). */
  seedPacket: { unlock: 10, plantings: 5, m: 'M1a' },
  /** "Grandma's seed basket" (§9 #31): if coins < the cheapest seed and nothing is growing or sellable, 12 free Wheat
   * plantings appear, once per day. */
  seedBasket: { crop: 'wheat', plantings: 12, perDay: 1, m: 'M1a' },
};

/**
 * Mastery (GDD §4.8): one track per crop, tree species, animal species and recipe, shared by the farm. Thresholds
 * are on each def (`mastery: [★1, ★2, ★3, Gold]`). Gold ★ exists from farm level 30 (M2).
 * Effects by family and star (index 0 = ★1); rewards are capped by hours of E (C1d).
 */
export const MASTERY = {
  unlock: 7,
  m: 'M1a',
  goldFrom: 30,
  goldM: 'M2',
  effects: {
    crops: [{ sellBp: 500 }, { timeBp: 1000 }, { bonusUnitBp: 1500, decor: 'mastery_sign' }, { ribbonBp: 500,
      decor: 'mastery_sign_gold' }],
    trees: [{ sellBp: 500 }, { timeBp: 1000 }, { bonusUnitBp: 1500, decor: 'mastery_sign' }, { ribbonBp: 500,
      decor: 'mastery_sign_gold' }],
    animals: [{ sellBp: 500 }, { timeBp: 1000 }, { doubleBp: 1500, decor: 'mastery_sign' }, { premiumBp: 500,
      decor: 'mastery_sign_gold' }],
    recipes: [{ sellBp: 500 }, { timeBp: 1000 }, { doubleBp: 1000 }, { xpBp: 500 }],
  },
  /** Star rewards: coins = min(coinsV x V, E x coinsHoursBp); XP = min(xpX x item XP, E x xpHoursBp / 8). */
  rewards: [
    { coinsV: 10, coinsHoursBp: 1000, xpX: 10, xpHoursBp: 1000 },
    { coinsV: 20, coinsHoursBp: 2000, xpX: 20, xpHoursBp: 2000 },
    { acorns: 1, xpX: 40, xpHoursBp: 2000 },
    { acorns: 3 },
  ],
};
