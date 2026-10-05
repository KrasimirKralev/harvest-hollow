// The owners' wave-4b wish list (2026-10-05), the content half. Hand-authored; the rules read it through index.js:
//   CRATES        the hot-air balloon's loot crates (wish 1; shared/rules/actions/crates.js)
//   RELICS        the Acorn shop's unique items (wish 2; shared/rules/relics.js, actions/relics.js) and the two
//                 placeable defs they bring (RELIC_DECOR: the Golden Sprinkler and the Growth Totem; RELIC_TREES: the
//                 Rainbow Tree)
//   HOME_GROWTH   animal homes that grow with their flock (wish 3; shared/rules/grid.js capacityOf / homeSizeOf)
//   TREE_AGE      fruit trees that age a "year" per harvest (wish 4; shared/rules/actions/trees.js treeAgeOf)
//   QUEUE_FINISH  the per-item finish price of a production queue (wish 5; shared/rules/actions/boosts.js)
//   CRATE_DEF     the crate's placeable def (it lands on a tile, so the grid, picking and the Hammer know it)
// Integer data only (basis points, ms). No imports beyond units.js.
import { min, h } from './units.js';

/**
 * Balloon loot crates (owner wish 1). The ambient balloon crosses the farm once every `everyMs` (10 minutes) from
 * server time (public/js/render/ambient-life.js balloonAt uses the same numbers: pass k flies from k * everyMs for
 * `flightMs`); at `dropAtMs` into a pass it may drop ONE crate on a parachute onto a free tile of the farm's land.
 * The rules decide (system action `_crate`, server time, rng keyed on the pass index):
 *   - a pass drops a crate with chance `dropBp` once the farm is at `unlock`, while fewer than `maxOpen` crates wait
 *     (an offline evening never floods the farm: catch-up handles only the latest pass);
 *   - a crate nobody opens is collected into the Barn after `keepMs` (its loot, by 'sys'), so it never blocks a build
 *     spot for long;
 *   - opening it (`openCrate {id}`, either player, predicted) pays: coins (`coinsBp` hundredths of a percent of an
 *     E-hour of the farm's level, rolled in the range), XP (`xpBp` of the level's XP to the next level) and at most
 *     one extra from `extras` by weight (`none` = nothing more). `n` = how many, rolled in [lo, hi].
 * Extras: acorns; goldenSeeds (single Golden Seeds); fertilizer (the item, from its level); collection (a MISSING
 * item of an open album set, as a find); decor (one reward decor piece from `pool` into the build tray).
 */
export const CRATES = {
  unlock: 3,
  m: 'M1a',
  everyMs: min(10),
  flightMs: 110_000,
  dropAtMs: 55_000,
  dropBp: 3500,
  maxOpen: 2,
  keepMs: h(4),
  def: 'loot_crate',
  coinsBp: [250, 500],
  xpBp: [50, 100],
  extras: [
    { k: 'none', w: 4000 },
    { k: 'acorns', w: 1300, n: [1, 2] },
    { k: 'goldenSeeds', w: 700, n: [1, 2] },
    { k: 'fertilizer', w: 2000, n: [1, 2], unlock: 10, item: 'fertilizer' },
    { k: 'collection', w: 1600 },
    { k: 'decor', w: 400, pool: ['lucky_horseshoe', 'garden_gnome', 'bird_feeder', 'bunting'] },
  ],
};

/** The crate on the ground: a 1 x 1 object the rules place and remove (never bought, moved, stored or sold). */
export const CRATE_DEF = {
  id: 'loot_crate', name: 'Balloon Crate', m: 'M1a', kind: 'crate', layer: 'object', size: [1, 1], shop: false,
  movable: false, panel: null, model: 'props/loot_crate',
  text: 'A crate dropped from the hot-air balloon. Open it with a click or a tap.',
};

/**
 * The Acorn shop's unique items (owner wish 2): one per farm, for good (never sold; a placed one can be stored and put
 * down again), priced so that saving for one takes weeks (the couple earns roughly 20-30 Acorns a week mid-game: level
 * Acorns, the Fair, the barge, golden orders, mastery stars). Strong but never game-breaking: every time cut stays
 * inside GROWTH.timeFloorBp, the once-a-day helpers are a farm-day each, the luck is a few points of chance.
 *   kind 'placed'  the purchase puts the def (`def`) in the build tray; its effect works where it stands
 *   kind 'charm'   works farm-wide from the moment it is bought (`farm.relics[id]`)
 * Effects (`fx`):
 *   golden_sprinkler  def effect water { radius: 3, trees: true }: waters every crop within 3 tiles at planting and
 *                     every tree within 3 tiles at the start of each fruit cycle (the -15 % / -20 % of a watering)
 *   golden_can        waterAll: one click waters every growing crop and tree on the farm that wants water
 *   farmhand          daily: once a farm day, tends every animal (collects their goods, feeds the hungry ones;
 *                     Keep N is respected: kept feed is never used)
 *   growth_totem      def effect grow { radius: 3, bp: 2000 }: crops planted within 3 tiles grow 20 % faster
 *   lucky_clover      luckBp 500: +5 points of blue-ribbon chance on every harvest (crops even without Compost,
 *                     fruit, animal goods)
 *   time_turner       daily: once a farm day, finishes every production queue on the farm (all queued items)
 *   rainbow_tree      def rainbow_tree: a tree whose every harvest is a random fruit of the farm's unlocked fruit trees
 *   golden_barn       barnBp 3000 (min barnMin 150): the Barn holds 30 % more (at least 150 more)
 */
export const RELICS = [
  { id: 'lucky_clover', name: 'Lucky Clover', kind: 'charm', acorns: 90, unlock: 9, m: 'M1a',
    fx: { luckBp: 500 }, text: 'Every harvest has a 5 % better chance of a blue ribbon: crops, fruit, animal goods' },
  { id: 'golden_sprinkler', name: 'Golden Sprinkler', kind: 'placed', def: 'golden_sprinkler', acorns: 100, unlock: 10,
    m: 'M1a', fx: {}, text: 'Waters every crop and tree within 3 tiles, every time, by itself' },
  { id: 'golden_can', name: 'Golden Watering Can', kind: 'charm', acorns: 120, unlock: 8, m: 'M1a',
    fx: { waterAll: true }, text: 'One click waters every growing crop and tree on the farm' },
  { id: 'rainbow_tree', name: 'Rainbow Tree', kind: 'placed', def: 'rainbow_tree', acorns: 140, unlock: 13, m: 'M1b',
    fx: {}, text: 'A tree that gives a different fruit every harvest' },
  { id: 'growth_totem', name: 'Growth Totem', kind: 'placed', def: 'growth_totem', acorns: 160, unlock: 14, m: 'M1b',
    fx: {}, text: 'Crops planted within 3 tiles grow 20 % faster' },
  { id: 'farmhand', name: 'Farmhand', kind: 'charm', acorns: 200, unlock: 12, m: 'M1a', fx: { daily: 'tend' },
    text: 'Once a day the farmhand feeds every animal and collects their goods' },
  { id: 'time_turner', name: 'Time Turner', kind: 'charm', acorns: 220, unlock: 16, m: 'M1b', fx: { daily: 'queues' },
    text: 'Once a day it finishes everything in every workshop queue' },
  { id: 'golden_barn', name: 'Golden Barn', kind: 'charm', acorns: 250, unlock: 15, m: 'M1b',
    fx: { barnBp: 3000, barnMin: 150 }, text: 'The Barn holds 30 % more (at least 150 more goods)' },
];

/** The placed relics' decor (tier 'reward': never in the coin / Acorn decor shop; RELICS sells them). */
export const RELIC_DECOR = [
  { id: 'golden_sprinkler', name: 'Golden Sprinkler', m: 'M1a', kind: 'decor', layer: 'object', size: [1, 1],
    unlock: 10, tier: 'reward', shop: false, cost: 0, acorns: 0, beauty10: 200, perTile: false, relic: true,
    effect: { water: { radius: 3, trees: true } }, text: 'Waters every crop and tree within 3 tiles, every time',
    model: 'decor/golden_sprinkler' },
  { id: 'growth_totem', name: 'Growth Totem', m: 'M1b', kind: 'decor', layer: 'object', size: [1, 1], unlock: 14,
    tier: 'reward', shop: false, cost: 0, acorns: 0, beauty10: 250, perTile: false, relic: true,
    effect: { grow: { radius: 3, bp: 2000 } }, text: 'Crops planted within 3 tiles grow 20 % faster',
    model: 'decor/growth_totem' },
];

/**
 * The Rainbow Tree (a relic): a tree like the others (a sapling first, a cycle like the apple tree's, watered,
 * composted, aged), but each harvest is a random fruit of the basket trees the farm has unlocked (rules: trees.js).
 * `product` is its fallback when no fruit is unlocked. Never in the tree shop (`shop: false`, `relic: true`).
 */
export const RELIC_TREES = [
  { id: 'rainbow_tree', name: 'Rainbow Tree', m: 'M1b', kind: 'tree', layer: 'object', size: [2, 2], unlock: 13,
    shop: false, relic: true, rainbow: true, cost: 9000, growthBp: 4500, cap: { base: 1, per10Levels: 0, max: 1 },
    cycleMs: h(5), yield: 5, product: 'apple', xp: 120, saplingCycles: 2, heirloomAt: 60, flowering: true,
    tool: 'basket', mastery: [12, 60, 180, 620], model: 'trees/rainbow_tree',
    shape: { canopy: [1.1, 1.05, 1.1], trunk: 1, lean: 0.02 }, hue: '#E040A0', leaf: '#5FB04A' },
];

/**
 * Animal homes grow with their flock (owner wish 3). A home's capacity is its def's `capacity` + `upgradeStep` per
 * bought step (`obj.up`, unchanged since wave 1), now up to the last `caps` entry instead of `capacityMax`. `caps[i]`
 * is the most animals the home holds at footprint tier i; tier 0 is the def's own size and holds up to the old
 * `capacityMax` (so every existing save keeps its footprint and capacity: nobody loses room or coins), each later
 * tier adds `grow` tiles to both sides of the footprint (a 3 x 3 coop becomes 4 x 4, then 5 x 5).
 * Buying an animal for a full home buys the next step with it (the step's price folded into the purchase); a step
 * costs the def's `upgradeCost` x `stepCostBp[tier of the NEW capacity]` / 10000. A step that needs the bigger
 * footprint grows the home around itself (any anchor whose new rectangle contains the old one, first that fits);
 * when none fits the purchase answers BLOCKED and `homeGrowth()` names what is in the way.
 */
export const HOME_GROWTH = {
  grow: 1,
  stepCostBp: [10_000, 15_000, 20_000],
  homes: {
    coop: { caps: [12, 20, 30] },
    cow_barn: { caps: [8, 16, 24] },
    pasture: { caps: [8, 16, 24] },
    hutch: { caps: [8, 16, 24] },
    pig_pen: { caps: [8, 16, 24] },
    duck_pond: { caps: [8, 16, 24] },
    goat_yard: { caps: [8, 16, 24] },
    stable: { caps: [4, 10, 16] },
    paddock: { caps: [8, 16, 24] },
  },
};

/**
 * Trees age (owner wish 4): every harvest is a "year" (the tree's `cycle`, the harvest counter since it was planted;
 * an old save's trees already carry it). Stages by age: `from` = the first year of the stage, `bonusUnits` more
 * fruit (or wood) per harvest, `scaleBp` the renderer's size hint (capped). The Heirloom's +1 (GDD §3.2 rule 8)
 * stacks.
 */
export const TREE_AGE = {
  stages: [
    { id: 'young', name: 'Young', from: 0, bonusUnits: 0, scaleBp: 10_000 },
    { id: 'mature', name: 'Mature', from: 10, bonusUnits: 1, scaleBp: 11_500 },
    { id: 'grand', name: 'Grand', from: 30, bonusUnits: 2, scaleBp: 13_000 },
  ],
};

/**
 * Production queues (owner wish 5): the waiting items (2nd onwards) can be reordered (`reorder {id, keys}`: the running
 * item stays first, the total time and the inputs never change), and each item can be finished now for Acorns
 * (`hurry {id, k}`). The fairest price is what Hurry would cost when that item runs: the running item its remaining
 * time, a waiting item its whole time (it has not started), 1 Acorn per started hour, at most BOOSTS.hurry.maxAcorns.
 * Finishing a waiting item puts it in the tray at once and the items behind it move up by its time.
 */
export const QUEUE_FINISH = { rule: 'hurry-when-it-runs', m: 'M1a' };
