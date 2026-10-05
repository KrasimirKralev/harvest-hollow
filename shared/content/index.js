// Content registry (FROZEN CONTRACT, tech-architecture §8.1). Builds own-key Maps over the frozen data tables,
// validates them at import time and hashes them. Server, client, tests and the simulator all read content ONLY
// through this module.
//
// Contract (M0 names kept; everything below "Added in wave 1" is additive):
//   CONTENT.<family>         READ-ONLY Map<id, def> (frozen defs; set/delete/clear throw, review-m0 #13). Families:
//                            crops, plots, items, expansions (M0) + trees, feeds, animals, homes, buildings,
//                            recipes, decor, landmarks, debris, quests, ribbons, npcs, tools, features, collections
//   CONTENT.levels           frozen array sorted by level (index 0 = level 1); rows
//                            { level, xp, xpToNext, E, coins, acorns, plotCap, personalXp, minutes }
//   CONTENT.barn             frozen Barn upgrades [{ n, unlock, capacity, cost, planks, crates, m }]
//   CONTENT.titles           frozen personal titles [{ level, title, m }]
//   CONTENT_HASH             8-hex FNV-1a over a canonical sorted-key JSON of every table and config value, and of
//                            RULES_VERSION (shared/rules/version.js): a content or rules change reloads open tabs
//   PLACEABLES               READ-ONLY Map<id, def> of every def an object can have: plots, trees, animals, homes,
//                            buildings, decor, landmarks, debris. Each has `kind` and `layer`: 'object' | 'ground'
//                            with `size: [w, d]`, or 'none' (kind 'animal' only: no size, `homes: [defId]`, lives
//                            inside a home object; review-m0 #9). `shop: true` marks the defs a player may BUY;
//                            landmarks, debris, colonies and reward decor are `shop: false`.
//   validateContent(tables?) -> string[]   problems (empty = valid); runs at import and throws on failure
//   cloneTables()            a mutable deep copy of the tables validateContent() reads (for tests)
//   placeableProblems(family, def) -> string[]
//   defOf(id)                the placeable def for an object's `def` id (any milestone), or undefined
//   cropOf(id), itemOf(id)   own-key lookups (any milestone), undefined when unknown
//   levelFromXp(xp)          farm level for a cumulative XP total (derived, never stored); Legacy past the table
//   levelRow(level)          the levels row for a level (the last row beyond the table)
//   xpForLevel(level)        XP at which a level starts (extrapolated past the table)
//   lookup(kind, id)         own-key lookup of a LIVE def (kind = a Map family or 'placeables'); the action schema
//                            validator ['content', kind] uses it, so no action can name content of a later milestone
//   contentKinds()           names of the Map families (+ 'placeables')
//   ID_RE, CONFIG
//
// Added in wave 1 (content lane):
//   MILESTONE, MILESTONES    'M1a' and the ordered milestone list; every shipped def carries `m`
//   isLive(def)              def.m is at or before MILESTONE (defs without `m`, i.e. test fixtures, are live)
//   live(family)             frozen array of the live defs of a Map family, in table order
//   liveAt(family, level)    live defs with unlock <= level (shop lists, seed tray, unlock checks)
//   unlocksAt(level)         [{ family, id }] of every live def and system that unlocks exactly at `level`
//   lookups                  treeOf animalOf homeOf buildingOf recipeOf feedOf decorOf questOf ribbonOf npcOf
//                            expansionOf toolOf featureOf collectionOf (own-key, any milestone)
//   recipesOf(buildingId)    live recipes of a building (+ the feeds for the Feed Mill), by unlock then time
//   classMembers(cls)        live item ids of an ingredient class ('grain', 'root', 'produce'), cheapest first
//   usesOf(itemId)           live recipe / feed / animal ids that consume an item
//   plotCapOf(level, n)      plot cap at `level` with `n` purchased expansions (GDD §3.10)
//   plotPrice(n)             price of the n-th plot (1-based; the first PLOTS.free are free)
//   eHours(level, bp)        coins worth bp/10000 hours of E(level) (quests, chests, gifts sized in E-hours)
//   masteryStars(def, count, level)  0..3 stars (4 = Gold, from L30 when Gold is live)
//   personalLevelFromXp(xp), titleFor(personalLevel)
//   orderSlotsAt(level), barnCapacity(upgrades), treeCapAt(treeDef, level), homeCountAt(homeDef, level)
//   expansionObjects(expansionId)  the objects that arrive with a purchased expansion, with their object ids
//   ORDERS DAILY_GIFT FARM_WEEKS ALMANAC COUPLE_CHALLENGE RECAP COOP SAFETY FEED GROWTH BOOSTS MASTERY MARKET
//   TUTORIAL DRIP_FEED DEBRIS_RULES QUEST_VERBS STORY_BEATS RIBBON_REWARDS RIBBON_WALL MEDAL_RANKS
//   COLLECTION_RULES MODEL   the hand-authored rule numbers (frozen) for the rules, UI and tests
//   FAIR BARGE TOWNSFOLK TOWN_PROJECT_RULES FARM_BEAUTY MASTERWORK SEASONAL_TRACK LEGACY HEARTS_SHOP PERKS PETS
//   NURSERY BREEDING          M1b/M2 rule data (isLive(...) is false for them in M1a)
//   CONTENT.restoration, CONTENT.townProjects, CONTENT.decorSets, CONTENT.festivals   M1b-M3 families (data)
//
// Added in wave 2 (content lane, additive):
//   COLLECTION_SOURCES       the closed vocabulary of a collection set's `from` tokens (`verb` or `verb:arg`) and the
//                            milestone each verb's system arrives in; COLLECTION_RULES.longCropMs / oldCoinRollCoins
//   TOWNSFOLK.friendship.rewards   per townsperson, the gift of each `rewardEvery` step ({ decor } | { card })
//   CONTENT.townProjects[].text    what a Town Project brings to the village
//   CONTENT.landmarks 'greenhouse' the Old Greenhouse frame (Restoration 1's reward, `greenhouse: { plots }`)
//   ORDERS.quick.refillMs / readyMinutes, ALMANAC.chest.coinsBp / ALMANAC.unlocks   the first evening (RC-01)
//   validateContent also checks decor sets (on demand, one set per piece, completable in their milestone),
//   collection sources, townsfolk gifts and likes, and unique album item ids.
//
// Added in wave 3 (content lane, additive; M2 data, live once MILESTONE is 'M2'):
//   CONTENT.furniture, furnitureOf(id)   the farmhouse interior catalog (farmhouse.js; not PLACEABLES: it lives in
//                            the interior grid INTERIOR, not on the farm)
//   FISHING DUEL RESTED INTERIOR GRANDMA_VISIT FESTIVAL_PAVILION   the Fishing Dock, Friendly Duel, rested XP, the
//                            farmhouse room, Grandma's visit and the repeatable Town Project tiers
//   SEASONAL_TRACK.rewards, LEGACY.pool / from, BREEDING.seasonCoats / species, FAIR.league.npcs / names /
//                            start / topNeedsProject, FAIR.horseShow   the concrete M2 rewards and names
//   validateContent also checks the furniture catalog and the interior layout, the M2 reward shapes (track, Legacy,
//   duel, Grandma's gift, quest `furniture` rewards) and that every M2 rule object names content that exists.
//
// Added in wave 4 (content lane, additive; the owners' wish list of 2026-10-04):
//   UPGRADES WEEDS AVATAR_LOOKS   Homestead upgrade tiers (farmhouse, Well, Market Stand, benches), the clearable wild
//                            weeds' reward and the character look catalog (upgrades.js)
//   GROWTH.fertilizer, PETS.kinds[].breeds / PETS.sleep / PETS.breedChange, PERKS.respecAcorns / refundAcornsPerPoint,
//                            MARKET.refunds.giftDecorBp   Fertilizer, pet breeds and sleep, Acorn respecs, decor resale
//   New defs, in level order in their generated tables and kept out of E(L) by the model's OWNER4 (no level
//                            threshold or E-hour price moved): crops raspberry rose coffee, tree pomegranate_tree, feed
//                            rabbit_greens, animal rabbit, home hutch, 12 recipes incl. fertilizer (consumable)
//
// Added in wave 4b (content lane, additive; the owners' wish list of 2026-10-05, shared/content/wishes4b.js):
//   CRATES RELICS HOME_GROWTH TREE_AGE QUEUE_FINISH   the balloon's loot crates, the Acorn shop's unique items, animal
//                            homes that grow with their flock, tree ages, the per-item finish price of a queue
//   relicOf(id)              a RELICS row by id (own key), or undefined
//   New placeable defs: decor golden_sprinkler / growth_totem (tier 'reward', `relic: true`), tree rainbow_tree
//                            (`shop: false`, `relic: true`, `rainbow: true`), landmark-family loot_crate (kind 'crate')
//   Decor effect keys gain `grow` { radius, bp } (crops planted near grow faster) and `water.trees` (trees too)
//
// Rules for content data: plain objects, no functions, no Math.random, no Date, integer math only (percentages in
// basis points, durations in ms). Ids match ID_RE. Generated tables (header "GENERATED") come from
// tools/gen-content.mjs; never edit them by hand.
import * as CONFIG from './config.js';
import { CROPS } from './crops.js';
import { TREES } from './trees.js';
import { FEEDS } from './feeds.js';
import { ANIMALS } from './animals.js';
import { HOMES } from './homes.js';
import { BUILDINGS } from './buildings.js';
import { RECIPES } from './recipes.js';
import { ITEMS } from './items.js';
import { DECOR } from './decor.js';
import { PLOTS } from './plots.js';
import { LEVELS } from './levels.js';
import { EXPANSIONS } from './expansions.js';
import { BARN_UPGRADES } from './barn.js';
import { QUESTS } from './quests.js';
import { EXPANSION_DEBRIS } from './layout.js';
import { MODEL } from './model.js';
import { LANDMARKS, DEBRIS, DEBRIS_RULES } from './landmarks.js';
import { TROPHIES, COLLECTION_DISPLAYS, TOWN_SOUVENIRS } from './trophies.js';
import { FAIR, BARGE, TOWNSFOLK } from './weekly.js';
import {
  RESTORATION, RESTORATION_SPECIALS, TOWN_PROJECT_RULES, TOWN_PROJECTS, FARM_BEAUTY, DECOR_SETS, MASTERWORK,
  SEASONAL_TRACK, LEGACY, FESTIVAL_PAVILION,
} from './projects.js';
import { FESTIVALS } from './festivals.js';
import { HEARTS_SHOP, PERKS, PETS, NURSERY, BREEDING, RESTED } from './personal.js';
import { FISHING, DUEL } from './leisure.js';
import { INTERIOR, FURNITURE, GRANDMA_VISIT } from './farmhouse.js';
import { UPGRADES, WEEDS, AVATAR_LOOKS } from './upgrades.js';
import {
  CRATES, CRATE_DEF, RELICS, RELIC_DECOR, RELIC_TREES, HOME_GROWTH, TREE_AGE, QUEUE_FINISH,
} from './wishes4b.js';
import { NPCS, PORTRAIT_STYLES } from './npcs.js';
import { QUEST_VERBS, SPECIAL_REFS, LETTER_ART, QUEST_STORY, STORY_BEATS } from './story.js';
import { RIBBONS, HIDDEN_RIBBONS, MEDAL_RANKS, RIBBON_REWARDS, RIBBON_WALL } from './ribbons.js';
import { ORDERS } from './orders.js';
import { DAILY_GIFT, FARM_WEEKS, ALMANAC, COUPLE_CHALLENGE, RECAP } from './daily.js';
import { COOP, SAFETY, FEED } from './coop.js';
import { GROWTH, BOOSTS, MASTERY } from './boosts.js';
import { TOOLS } from './tools.js';
import { MARKET } from './market.js';
import { FEATURES, DRIP_FEED } from './features.js';
import { TITLES } from './titles.js';
import { TUTORIAL } from './tutorial.js';
import { COLLECTIONS, COLLECTION_RULES, COLLECTION_SOURCES } from './collections.js';
import { RULES_VERSION } from '../rules/version.js';

export const ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

// ---- milestones ---------------------------------------------------------------------------------------------
/** The milestone this build plays. Content of later milestones exists as data but is never reachable in play. */
export const MILESTONE = 'M2';
export const MILESTONES = Object.freeze(['M1a', 'M1b', 'M2', 'M3']);
const RANK = Object.freeze({ M1a: 0, M1b: 1, M2: 2, M3: 3 });
/** True when a def belongs to this build's milestone or an earlier one (test fixtures without `m` are live). */
export const isLive = (def) => Boolean(def) && (def.m === undefined || RANK[def.m] <= RANK[MILESTONE]);

// ---- assembly ------------------------------------------------------------------------------------------------
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

const QUEST_DEFS = QUESTS.map((q) => {
  const s = QUEST_STORY[q.id];
  return s ? { ...q, letter: s.letter, done: s.done, rewards: s.rewards ?? {} } : { ...q };
});

/** Every table and rule object, by name: what validateContent checks and CONTENT_HASH covers. */
/**
 * What a decor card SAYS to the players (wave-1 QA RC-27). The generated table carries the designer's notes ("(§6.2)",
 * "pure juice", "bee forage" before bees ship); these player texts replace them. A def missing here keeps its text.
 */
export const PLAYER_TEXT = Object.freeze({
  flower_bed: 'A splash of colour by the path',
  sunset_bench: 'A seat for Golden Hour, for the two of you',
  wind_chime: 'Chimes when you point at it',
  wheelbarrow: 'Grandma\'s old barrow, full of flowers',
  dog_house: 'A home for the farm dog',
  rose_arch: 'A rose arch to walk under',
  windmill_toy: 'Spins with the wind',
  beehive_skep: 'An old straw hive, for the look of it',
  greenhouse_frame: 'Crops within 2 tiles count as in season',
  cherry_blossom: 'Petals drift in the breeze',
  flower_maze: 'A flower maze the two of you can walk',
});
const playerText = (d) => (Object.hasOwn(PLAYER_TEXT, d.id) ? { ...d, text: PLAYER_TEXT[d.id] } : d);

const TABLES = {
  crops: CROPS, trees: [...TREES, ...RELIC_TREES], feeds: FEEDS, animals: ANIMALS, homes: HOMES, buildings: BUILDINGS,
  recipes: RECIPES,
  items: ITEMS, decor: [...DECOR.map(playerText), ...TROPHIES, ...COLLECTION_DISPLAYS,
    ...TOWN_SOUVENIRS, ...RELIC_DECOR], plots: PLOTS, landmarks: [...LANDMARKS, CRATE_DEF],
  debris: DEBRIS, expansions: EXPANSIONS, levels: LEVELS, barn: BARN_UPGRADES, quests: QUEST_DEFS,
  ribbons: [...RIBBONS, ...HIDDEN_RIBBONS], npcs: NPCS, tools: TOOLS, features: FEATURES, titles: TITLES,
  collections: COLLECTIONS, expansionDebris: EXPANSION_DEBRIS, restoration: RESTORATION, townProjects: TOWN_PROJECTS,
  decorSets: DECOR_SETS, festivals: FESTIVALS, furniture: FURNITURE,
  rules: {
    FAIR, BARGE, TOWNSFOLK, RESTORATION_SPECIALS, TOWN_PROJECT_RULES, FARM_BEAUTY, MASTERWORK, SEASONAL_TRACK, LEGACY,
    HEARTS_SHOP, PERKS, PETS, NURSERY, BREEDING, RESTED, FISHING, DUEL, INTERIOR, GRANDMA_VISIT, FESTIVAL_PAVILION,
    ORDERS, DAILY_GIFT, FARM_WEEKS, ALMANAC, COUPLE_CHALLENGE, RECAP, COOP, SAFETY, FEED, GROWTH, BOOSTS, MASTERY,
    MARKET, TUTORIAL, DRIP_FEED, DEBRIS_RULES, QUEST_VERBS, SPECIAL_REFS, LETTER_ART, STORY_BEATS, PORTRAIT_STYLES,
    RIBBON_REWARDS, RIBBON_WALL, MEDAL_RANKS, COLLECTION_RULES, COLLECTION_SOURCES, MODEL,
    UPGRADES, WEEDS, AVATAR_LOOKS,
    CRATES, RELICS, HOME_GROWTH, TREE_AGE, QUEUE_FINISH,
  },
};
deepFreeze(TABLES);

/** Families whose defs can be objects on the grid (PLACEABLES). */
const PLACEABLE_FAMILIES = ['plots', 'trees', 'animals', 'homes', 'buildings', 'decor', 'landmarks', 'debris'];
/** Families exposed as Maps on CONTENT (and as ['content', kind] for action schemas). */
const MAP_FAMILIES = ['crops', 'plots', 'items', 'expansions', 'trees', 'feeds', 'animals', 'homes', 'buildings',
  'recipes', 'decor', 'landmarks', 'debris', 'quests', 'ribbons', 'npcs', 'tools', 'features', 'collections',
  'restoration', 'townProjects', 'decorSets', 'festivals', 'furniture'];

// ---- validation ----------------------------------------------------------------------------------------------
const isPosInt = (n) => Number.isSafeInteger(n) && n > 0;
const isNonNegInt = (n) => Number.isSafeInteger(n) && n >= 0;
const isBp = (n) => Number.isSafeInteger(n) && n >= 0;
const HUE_RE = /^#[0-9A-Fa-f]{6}$/;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const DECOR_TIERS = ['coin', 'acorn', 'grand', 'reward'];
const EFFECT_KEYS = new Set(['forage', 'bonus', 'water', 'inSeason', 'seats', 'heartsPerGoldenHour', 'pathBonusBp',
  'autojoin', 'petHome', 'cosmetic', 'grow']);
const ITEM_KINDS = ['crop', 'fruit', 'material', 'feed', 'animal', 'premium', 'craft', 'consumable'];
const TIERS = ['T2', 'T3', 'T4', 'duet'];
const RIBBON_MODES = ['sum', 'distinct', 'state'];
const TUTORIAL_VERBS = ['name', 'tend', 'ping', 'sit'];
const increasing = (a) => Array.isArray(a) && a.every((v, i) => isPosInt(v) && (i === 0 || v > a[i - 1]));
const msOk = (m) => Object.hasOwn(RANK, m);
const later = (a, b) => RANK[a] > RANK[b];

/**
 * Problems of one placeable def (every family that joins PLACEABLES runs its defs through this).
 * @param {string} family @param {object} d
 * @returns {string[]}
 */
export function placeableProblems(family, d) {
  const errs = [];
  if (typeof d.kind !== 'string') errs.push(`${family}.${d.id}.kind`);
  if (d.layer === 'none') {
    if (d.kind !== 'animal') errs.push(`${family}.${d.id}: layer 'none' is only for kind 'animal'`);
    if (d.size !== undefined) errs.push(`${family}.${d.id}: a layer 'none' def has no size`);
    if (!Array.isArray(d.homes) || d.homes.length === 0 || !d.homes.every((h) => typeof h === 'string')) {
      errs.push(`${family}.${d.id}.homes must list the home def ids`);
    }
  } else {
    if (d.layer !== 'object' && d.layer !== 'ground') errs.push(`${family}.${d.id}.layer`);
    if (!Array.isArray(d.size) || d.size.length !== 2 || !d.size.every(isPosInt)) errs.push(`${family}.${d.id}.size`);
  }
  return errs;
}

const REWARD_KEYS = new Set(['coinsHoursBp', 'items', 'goldenSeeds', 'seedPacket', 'hearts', 'acorns', 'decor', 'coat']);
const FURNITURE_LAYERS = ['object', 'floor', 'wall'];

/**
 * The M2 rule data (wave 3): the furniture catalog and the interior room, Grandma's visit, the Fishing Dock, the
 * Friendly Duel, rested XP, the Seasonal Ribbon Track and Legacy rewards, the Festival Pavilion and the NPC league.
 * Every reference resolves and every shape is one the rules can pay without guessing.
 */
function m2Problems(t, list, maps, placeableSeen, inLevels) {
  const errs = [];
  const R = t.rules ?? {};
  const { INTERIOR, GRANDMA_VISIT, FISHING, DUEL, RESTED, SEASONAL_TRACK, BREEDING, LEGACY, FESTIVAL_PAVILION,
    FAIR } = R;
  if (!INTERIOR || !GRANDMA_VISIT || !FISHING || !DUEL || !RESTED || !SEASONAL_TRACK || !BREEDING || !LEGACY
    || !FESTIVAL_PAVILION || !FAIR) return ['rules: an M2 rule object is missing'];
  const bad = (msg) => errs.push(msg);
  const decorOk = (id) => maps.decor.has(id);
  const reward = (where, r, { season = false } = {}) => {
    if (!r || typeof r !== 'object' || !Object.keys(r).length) { bad(`${where}: empty reward`); return; }
    for (const [k, v] of Object.entries(r)) {
      if (!REWARD_KEYS.has(k)) bad(`${where}: unknown reward key ${k}`);
      else if (k === 'items') {
        for (const [id, n] of Object.entries(v)) if (!maps.items.has(id) || !isPosInt(n)) bad(`${where}: item ${id}`);
      } else if (k === 'decor') {
        if (!(season && v === 'season') && !decorOk(v)) bad(`${where}: decor ${v}`);
      } else if (k === 'coat') {
        if (v !== 'season') bad(`${where}: coat must be 'season'`);
      } else if (!isPosInt(v)) bad(`${where}: ${k} must be a positive integer`);
    }
  };
  // the interior room and its catalog
  const [gw, gd] = INTERIOR.grid;
  for (const f of list('furniture')) {
    if (placeableSeen.has(f.id)) bad(`furniture.${f.id}: the id is also a placeable`);
    if (f.kind !== 'furniture' || !FURNITURE_LAYERS.includes(f.layer)) bad(`furniture.${f.id}: kind/layer`);
    if (!Array.isArray(f.size) || f.size.length !== 2 || !f.size.every(isPosInt)) { bad(`furniture.${f.id}.size`); continue; }
    if (f.layer === 'wall' && (f.size[1] !== 1 || f.size[0] > Math.max(INTERIOR.walls.back, INTERIOR.walls.left))) {
      bad(`furniture.${f.id}: a wall piece is [slots, 1]`);
    }
    if (f.layer !== 'wall' && (f.size[0] > gw || f.size[1] > gd)) bad(`furniture.${f.id}: larger than the room`);
    if (f.shop ? !isPosInt(f.cost) : f.cost !== 0) bad(`furniture.${f.id}: a shop piece costs coins, a gift 0`);
    if (!isPosInt(f.max)) bad(`furniture.${f.id}.max`);
  }
  if (!maps.restoration.has(INTERIOR.needsProject)) bad('INTERIOR.needsProject');
  const floor = { object: new Map(), floor: new Map() };
  const wall = { back: new Map(), left: new Map() };
  for (const [side, at] of Object.entries(INTERIOR.wallBlocked)) for (const i of at) wall[side].set(i, 'blocked');
  const clear = new Set();
  for (const [x0, z0, w, dd] of INTERIOR.keepClear) for (let z = z0; z < z0 + dd; z++) for (let x = x0; x < x0 + w; x++) clear.add(`${x},${z}`);
  for (const fx of INTERIOR.fixed) {
    const f = maps.furniture.get(fx.def);
    if (!f?.fixed) { bad(`INTERIOR.fixed: ${fx.def} is no fixed furniture`); continue; }
    if (f.layer === 'wall') {
      const n = INTERIOR.walls[fx.wall];
      if (!isPosInt(n) || !isNonNegInt(fx.at) || fx.at + f.size[0] > n) { bad(`INTERIOR.fixed: ${fx.def} off the wall`); continue; }
      for (let i = fx.at; i < fx.at + f.size[0]; i++) {
        if (wall[fx.wall].has(i)) bad(`INTERIOR.fixed: ${fx.def} overlaps ${wall[fx.wall].get(i)}`);
        wall[fx.wall].set(i, fx.def);
      }
    } else {
      for (let z = fx.z; z < fx.z + f.size[1]; z++) {
        for (let x = fx.x; x < fx.x + f.size[0]; x++) {
          const k = `${x},${z}`;
          if (x < 0 || z < 0 || x >= gw || z >= gd) bad(`INTERIOR.fixed: ${fx.def} leaves the room`);
          if (clear.has(k)) bad(`INTERIOR.fixed: ${fx.def} stands on a keep-clear tile`);
          if (floor[f.layer].has(k)) bad(`INTERIOR.fixed: ${fx.def} overlaps ${floor[f.layer].get(k)}`);
          floor[f.layer].set(k, fx.def);
        }
      }
    }
  }
  for (const f of list('furniture')) {
    if (f.fixed && !INTERIOR.fixed.some((x) => x.def === f.id)) bad(`furniture.${f.id}: fixed but not in the room`);
  }
  // Grandma's visit
  const gv = GRANDMA_VISIT;
  if (!maps.quests.has(gv.quest)) bad('GRANDMA_VISIT.quest');
  if (!STORY_BEATS.some((b) => b.id === gv.beat)) bad('GRANDMA_VISIT.beat');
  const gift = maps.furniture.get(gv.gift?.furniture);
  if (!gift || gift.shop) bad('GRANDMA_VISIT.gift must be a furniture piece that is never sold');
  for (const k of ['arrive', ...gv.stops, 'leave']) {
    const ls = gv.lines?.[k];
    if (!Array.isArray(ls) || !ls.length || !ls.every((x) => typeof x === 'string' && x.length > 10)) {
      bad(`GRANDMA_VISIT.lines.${k}`);
    }
  }
  if (!isPosInt(gv.stayMs) || !isPosInt(gv.strollMs) || !LETTER_ART.includes(gv.letter?.art)) bad('GRANDMA_VISIT');
  // the Fishing Dock
  const fsh = FISHING;
  const pond = maps.expansions.get(fsh.spots.expansion);
  if (!pond?.feature?.fishingSpot) bad('FISHING.spots.expansion has no fishing spot');
  if (!decorOk(fsh.spots.decor) || maps.decor.get(fsh.spots.decor).unlock !== fsh.spots.decorFrom) {
    bad('FISHING.spots.decor');
  }
  if (pond && pond.unlock !== fsh.unlock) bad('FISHING.unlock is the pond\'s level');
  if (fsh.fish.reduce((a, f) => a + f.weightBp, 0) !== 10_000) bad('FISHING.fish weights must sum to 10000');
  for (const f of fsh.fish) {
    if (!ID_RE.test(f.id) || !isPosInt(f.cm?.[0]) || !(f.cm[1] >= f.cm[0]) || !HUE_RE.test(f.hue)) bad(`FISHING.fish.${f.id}`);
  }
  if (!(fsh.gradeFloorBp.length === 3 && fsh.gradeFloorBp.every((v, i, a) => isNonNegInt(v) && v < 10_000
    && (i === 0 || v > a[i - 1])))) bad('FISHING.gradeFloorBp');
  const pondSet = maps.collections.get(fsh.collectionSet);
  if (!pondSet?.from.includes('fish')) bad('FISHING.collectionSet must be found by fishing');
  if (!(fsh.biteMs[0] < fsh.biteMs[1] && fsh.biteMs[1] < fsh.castMs && fsh.perfectMs < fsh.goodMs)) bad('FISHING timing');
  // the Friendly Duel
  if (!inLevels(DUEL.unlock) || !decorOk(DUEL.rewards.firstDecor)) bad('DUEL unlock/decor');
  for (const k of DUEL.kinds) {
    const [verb, ref] = k.count.split(':');
    const ok = verb === 'harvest' ? maps.crops.has(ref) : verb === 'craft' ? maps.buildings.has(ref)
      : verb === 'fill' && ref === 'order';
    if (!ok) bad(`DUEL.${k.id}: count ${k.count}`);
    if (!(k.unlock <= DUEL.unlock) || !isPosInt(k.scale)) bad(`DUEL.${k.id}: unlock/scale`);
  }
  // rested XP
  for (const k of ['unlock', 'bp', 'perMs', 'capBp', 'bonusMul']) if (!isPosInt(RESTED[k])) bad(`RESTED.${k}`);
  // the Seasonal Ribbon Track and Legacy levels
  if (SEASONAL_TRACK.rewards.length !== SEASONAL_TRACK.tiers) bad('SEASONAL_TRACK: one reward per tier');
  SEASONAL_TRACK.rewards.forEach((r, i) => reward(`SEASONAL_TRACK tier ${i + 1}`, r, { season: true }));
  for (const t of SEASONAL_TRACK.acornTiers) {
    if (SEASONAL_TRACK.rewards[t - 1]?.acorns !== SEASONAL_TRACK.acorns) bad(`SEASONAL_TRACK: tier ${t} pays Acorns`);
  }
  if (!SEASONAL_TRACK.rewards.some((r) => r.coat === 'season')) bad('SEASONAL_TRACK: no season coat');
  if (new Set(BREEDING.seasonCoats.map((c) => c.season)).size !== 4) bad('BREEDING.seasonCoats: one per season');
  for (const id of BREEDING.species) if (!isPosInt(maps.animals.get(id)?.baby)) bad(`BREEDING.species: ${id}`);
  LEGACY.pool.forEach((r, i) => reward(`LEGACY.pool[${i}]`, r));
  if (LEGACY.from !== (list('levels').at(-1)?.level ?? 0) + 1) bad('LEGACY.from is the first level past the table');
  // the Festival Pavilion and the NPC league
  if (!decorOk(FESTIVAL_PAVILION.souvenir) || !FESTIVAL_PAVILION.tiers.length) bad('FESTIVAL_PAVILION');
  if (FESTIVAL_PAVILION.after !== list('townProjects').length) bad('FESTIVAL_PAVILION.after = the Town Projects');
  const lg = FAIR.league;
  if (lg.npcs.length !== lg.farms.length || lg.npcs.some((n, i) => n.name !== lg.farms[i] || !HUE_RE.test(n.hue))) {
    bad('FAIR.league.npcs must match farms');
  }
  if (lg.names.length !== lg.leagues || !maps.restoration.has(lg.topNeedsProject)) bad('FAIR.league names/top');
  return errs;
}

/**
 * The wave-4b rule data (the owners' wish list of 2026-10-05): the crates' loot table, the Acorn shop's relics and
 * their defs, the home growth tiers and the tree ages. Every reference resolves; weights and ranges are usable
 * integers.
 */
function w4bProblems(t, list, maps, inLevels) {
  const errs = [];
  const bad = (msg) => errs.push(msg);
  const R = t.rules ?? {};
  const { CRATES: C, RELICS: RL, HOME_GROWTH: HG, TREE_AGE: TA } = R;
  if (!C || !Array.isArray(RL) || !HG || !TA) return ['rules: a wave-4b rule object is missing'];
  const range = (r) => Array.isArray(r) && r.length === 2 && isNonNegInt(r[0]) && r[1] >= r[0] && isPosInt(r[1]);
  for (const k of ['unlock', 'everyMs', 'flightMs', 'dropAtMs', 'dropBp', 'maxOpen', 'keepMs']) {
    if (!isPosInt(C[k])) bad(`CRATES.${k}`);
  }
  if (!(C.dropAtMs < C.flightMs && C.flightMs < C.everyMs) || C.dropBp > 10_000) bad('CRATES timing / dropBp');
  if (!inLevels(C.unlock)) bad('CRATES.unlock');
  const crate = maps.landmarks.get(C.def);
  if (!crate || crate.kind !== 'crate' || crate.shop !== false || crate.movable !== false) bad('CRATES.def');
  if (!range(C.coinsBp) || !range(C.xpBp)) bad('CRATES coinsBp / xpBp');
  const kinds = new Set(['none', 'acorns', 'goldenSeeds', 'fertilizer', 'collection', 'decor']);
  for (const x of C.extras ?? []) {
    if (!kinds.has(x.k) || !isPosInt(x.w)) bad(`CRATES.extras ${x.k}`);
    if (['acorns', 'goldenSeeds', 'fertilizer'].includes(x.k) && !range(x.n)) bad(`CRATES.extras ${x.k}.n`);
    if (x.item !== undefined && !maps.items.has(x.item)) bad(`CRATES.extras ${x.k}.item`);
    if (x.k === 'decor' && !(Array.isArray(x.pool) && x.pool.length && x.pool.every((id) => maps.decor.get(id)?.tier
      === 'reward'))) bad('CRATES.extras decor.pool must name reward decor');
  }
  const seen = new Set();
  for (const r of RL) {
    if (!ID_RE.test(r.id ?? '') || seen.has(r.id)) bad(`RELICS: bad or duplicate id ${r.id}`);
    seen.add(r.id);
    if (!isPosInt(r.acorns) || !inLevels(r.unlock) || !msOk(r.m) || typeof r.name !== 'string') bad(`RELICS.${r.id}`);
    if (!['placed', 'charm'].includes(r.kind)) bad(`RELICS.${r.id}.kind`);
    if (r.kind === 'placed') {
      const d = maps.decor.get(r.def) ?? maps.trees.get(r.def);
      if (!d || d.relic !== true || d.shop !== false || d.unlock !== r.unlock) bad(`RELICS.${r.id}.def`);
    }
  }
  for (const d of [...list('decor'), ...list('trees')]) {
    if (d.relic && !RL.some((r) => r.def === d.id)) bad(`${d.id}: a relic def no RELICS row sells`);
  }
  for (const d of list('decor')) {
    const g = d.effect?.grow;
    if (g !== undefined && !(isPosInt(g.radius) && isPosInt(g.bp) && g.bp <= 5000)) bad(`decor.${d.id}: grow effect`);
  }
  if (!isPosInt(HG.grow) || !Array.isArray(HG.stepCostBp) || !HG.stepCostBp.every(isPosInt)) bad('HOME_GROWTH');
  for (const [id, g] of Object.entries(HG.homes ?? {})) {
    const h = maps.homes.get(id);
    if (!h) { bad(`HOME_GROWTH.${id}: no such home`); continue; }
    if (!increasing(g.caps) || g.caps[0] !== h.capacityMax || g.caps.length > HG.stepCostBp.length) {
      bad(`HOME_GROWTH.${id}.caps must start at capacityMax and increase`);
    }
    if (!(h.upgradeStep > 0) || g.caps.some((c) => (c - h.capacity) % h.upgradeStep !== 0)) {
      bad(`HOME_GROWTH.${id}: every cap is reached in whole steps`);
    }
  }
  const st = TA.stages ?? [];
  if (!st.length || st[0].from !== 0 || !st.every((s, i) => isNonNegInt(s.bonusUnits) && isPosInt(s.scaleBp)
    && (i === 0 || (s.from > st[i - 1].from && s.bonusUnits >= st[i - 1].bonusUnits)))) bad('TREE_AGE.stages');
  return errs;
}

/**
 * Validate content tables. Pure; returns a list of human-readable problems (empty when valid). The economy-level
 * proofs (GDD §4.9 R1-R18) live in test/economy.test.js; this is the referential and shape integrity every boot
 * checks.
 * @param {object} [t] the tables (default: the shipped ones)
 * @returns {string[]}
 */
export function validateContent(t = TABLES) {
  const errs = [];
  const bad = (msg) => errs.push(msg);
  const list = (k) => (Array.isArray(t[k]) ? t[k] : []);
  const maps = {};
  for (const fam of MAP_FAMILIES) maps[fam] = new Map(list(fam).map((d) => [d && d.id, d]));
  const levels = list('levels');
  const maxLevel = levels.length ? levels.at(-1).level : 0;
  const inLevels = (n) => isPosInt(n) && n <= maxLevel;

  // ids: unique snake_case per family; every placeable id unique across the placeable families
  const placeableSeen = new Map();
  for (const fam of MAP_FAMILIES) {
    const seen = new Set();
    for (const d of list(fam)) {
      if (!d || typeof d.id !== 'string' || !ID_RE.test(d.id)) { bad(`${fam}: bad id ${d && d.id}`); continue; }
      if (seen.has(d.id)) bad(`${fam}: duplicate id ${d.id}`);
      seen.add(d.id);
      if (PLACEABLE_FAMILIES.includes(fam)) {
        if (placeableSeen.has(d.id)) bad(`${fam}: duplicate id ${d.id} (also in ${placeableSeen.get(d.id)})`);
        placeableSeen.set(d.id, fam);
        errs.push(...placeableProblems(fam, d));
      }
      if (!msOk(d.m)) bad(`${fam}.${d.id}.m must be one of ${MILESTONES.join(', ')}`);
      if (typeof d.name !== 'string' && fam !== 'quests' && fam !== 'ribbons') bad(`${fam}.${d.id}.name`);
    }
  }
  const item = (id) => maps.items.get(id);
  // GDD §10: M1a is L1-12, M1b L13-25, M2 L26-40; nothing may be scheduled before its level's milestone
  const levelMilestone = (L) => (L <= 12 ? 'M1a' : L <= 25 ? 'M1b' : 'M2');
  for (const fam of MAP_FAMILIES) {
    for (const d of list(fam)) {
      const L = fam === 'quests' ? d.level : d.unlock;
      if (isPosInt(L) && msOk(d.m) && later(levelMilestone(L), d.m)) bad(`${fam}.${d.id}: ${d.m} but unlocks at L${L}`);
    }
  }
  for (const c of list('crops')) if (item(c.id) && item(c.id).m !== c.m) bad(`crops.${c.id}: item milestone differs`);

  // crops
  for (const c of list('crops')) {
    for (const k of ['unlock', 'growMs', 'yield', 'sell', 'seed', 'xp', 'freshMs']) {
      if (!isPosInt(c[k])) bad(`crops.${c.id}.${k} must be a positive safe integer`);
    }
    if (!inLevels(c.unlock)) bad(`crops.${c.id}.unlock ${c.unlock} beyond the level table (${maxLevel})`);
    if (!Array.isArray(c.stages) || c.stages.length < 2 || c.stages[0] !== 0 || c.stages.at(-1) !== 1
        || c.stages.some((s, i) => i > 0
          && !(s > c.stages[i - 1]))) bad(`crops.${c.id}.stages must increase from 0 to 1`);
    if (!item(c.id)) bad(`crops.${c.id}: no harvest item`);
    // R2 exploit guard: a plot must never pay less than its seed (tech §8.3)
    if (!(c.yield * c.sell > c.seed)) bad(`crops.${c.id}: yield*sell must exceed the seed price`);
    if (typeof c.hue !== 'string' || !HUE_RE.test(c.hue)) bad(`crops.${c.id}.hue must be #RRGGBB`);
    if (!SEASONS.includes(c.season)) bad(`crops.${c.id}.season`);
    if (!increasing(c.mastery) || c.mastery.length !== 4) bad(`crops.${c.id}.mastery must be 4 increasing counts`);
    if (typeof c.waterable !== 'boolean') bad(`crops.${c.id}.waterable`);
  }
  // trees
  for (const tr of list('trees')) {
    for (const k of ['unlock', 'cost', 'cycleMs', 'yield', 'xp', 'saplingCycles', 'heirloomAt', 'growthBp']) {
      if (!isPosInt(tr[k])) bad(`trees.${tr.id}.${k} must be a positive safe integer`);
    }
    if (!inLevels(tr.unlock)) bad(`trees.${tr.id}.unlock`);
    if (!item(tr.product)) bad(`trees.${tr.id}: unknown product ${tr.product}`);
    if (!increasing(tr.mastery)) bad(`trees.${tr.id}.mastery`);
    if (!tr.cap || !isPosInt(tr.cap.base) || !isNonNegInt(tr.cap.per10Levels)
      || !(tr.cap.max >= tr.cap.base)) bad(`trees.${tr.id}.cap`);
    if (!['basket', 'axe'].includes(tr.tool)) bad(`trees.${tr.id}.tool`);
    if (!HUE_RE.test(tr.hue) || !HUE_RE.test(tr.leaf)) bad(`trees.${tr.id}: hue/leaf colours`);
  }
  // feeds: ingredient CLASSES with at least one member unlocked by the feed's level
  const classOk = (cls, lvl) => list('items').some((it) => it.classes?.includes(cls) && it.unlock <= lvl);
  for (const f of list('feeds')) {
    for (const k of ['unlock', 'ms', 'out', 'sell', 'xp', 'storePrice']) if (!isPosInt(f[k])) bad(`feeds.${f.id}.${k}`);
    if (!maps.buildings.has(f.building)) bad(`feeds.${f.id}: unknown building ${f.building}`);
    if (!item(f.id)) bad(`feeds.${f.id}: no item`);
    if (!Array.isArray(f.classes) || !f.classes.length) bad(`feeds.${f.id}.classes`);
    for (const { cls, qty } of f.classes ?? []) {
      if (!isPosInt(qty)) bad(`feeds.${f.id}: qty of ${cls}`);
      if (!classOk(cls, f.unlock)) bad(`feeds.${f.id}: no member of class ${cls} by L${f.unlock}`);
    }
  }
  // animals and their homes
  for (const a of list('animals')) {
    const colony = a.baby === null;
    for (const k of ['unlock', 'cycleMs', 'out', 'xp', 'prizedAt', 'premiumBp', 'growthBp']) {
      if (!isPosInt(a[k])) bad(`animals.${a.id}.${k}`);
    }
    if (!colony && !(isPosInt(a.baby) && a.adult > a.baby
      && isPosInt(a.babyMs))) bad(`animals.${a.id}: baby/adult prices`);
    for (const h of a.homes ?? []) if (!maps.homes.has(h)) bad(`animals.${a.id}: unknown home ${h}`);
    if (a.feed !== null && !maps.feeds.has(a.feed)) bad(`animals.${a.id}: unknown feed ${a.feed}`);
    if (a.feed !== null && !isPosInt(a.feedQty)) bad(`animals.${a.id}.feedQty`);
    for (const k of ['product', 'premium']) if (!item(a[k])) bad(`animals.${a.id}: unknown ${k} ${a[k]}`);
    if (a.bottle !== null && !item(a.bottle)) bad(`animals.${a.id}: unknown bottle ${a.bottle}`);
    if (a.bottle && item(a.bottle) && item(a.bottle).unlock > a.unlock) bad(`animals.${a.id}: bottle unlocks after it`);
    if (!increasing(a.mastery)) bad(`animals.${a.id}.mastery`);
    if (colony === Boolean(a.shop)) bad(`animals.${a.id}: shop must be true exactly when a baby can be bought`);
  }
  for (const h of list('homes')) {
    if (!isNonNegInt(h.cost) || !inLevels(h.unlock)) bad(`homes.${h.id}: cost/unlock`);
    if (!(isPosInt(h.capacity) && h.capacityMax >= h.capacity)) bad(`homes.${h.id}: capacity`);
    if (h.capacityMax > h.capacity && !(isPosInt(h.upgradeStep) && isPosInt(h.upgradeCost)
        && (h.capacityMax - h.capacity) % h.upgradeStep === 0)) bad(`homes.${h.id}: upgrades`);
    for (const s of h.species ?? []) if (!maps.animals.get(s)?.homes.includes(h.id)) bad(`homes.${h.id}: species ${s}`);
    if (!h.count || !isPosInt(h.count.base) || !(h.count.max >= h.count.base)) bad(`homes.${h.id}.count`);
  }
  // buildings and recipes
  for (const b of list('buildings')) {
    if (!isNonNegInt(b.cost) || !inLevels(b.unlock)) bad(`buildings.${b.id}: cost/unlock`);
    const [s0, s1] = b.slots ?? [];
    if (!(isPosInt(s0) && s1 >= s0)) bad(`buildings.${b.id}.slots`);
    if (!Array.isArray(b.slotCosts) || b.slotCosts.length !== s1 - s0
      || !increasing(b.slotCosts)) bad(`buildings.${b.id}.slotCosts`);
    if (b.secondCopy !== null && !(b.secondCopy.at > b.unlock
      && isPosInt(b.secondCopy.cost))) bad(`buildings.${b.id}.secondCopy`);
  }
  for (const r of list('recipes')) {
    const b = maps.buildings.get(r.building);
    for (const k of ['unlock', 'ms', 'out', 'sell', 'xp']) if (!isPosInt(r[k])) bad(`recipes.${r.id}.${k}`);
    if (!b) { bad(`recipes.${r.id}: unknown building ${r.building}`); continue; }
    if (b.unlock > r.unlock) bad(`recipes.${r.id}: unlocks before its building (R6)`);
    if (later(b.m, r.m)) bad(`recipes.${r.id}: live before its building`);
    if (!item(r.id)) bad(`recipes.${r.id}: no output item`);
    if (!TIERS.includes(r.tier)) bad(`recipes.${r.id}.tier`);
    if (r.duet !== (r.tier === 'duet') || (r.duet && !isPosInt(r.duetXp))) bad(`recipes.${r.id}: duet fields`);
    if (!increasing(r.mastery)) bad(`recipes.${r.id}.mastery`);
    let inVal = 0;
    const inputs = Object.entries(r.inputs ?? {});
    if (!inputs.length) bad(`recipes.${r.id}: no inputs`);
    for (const [id, q] of inputs) {
      const it = item(id);
      if (!it || !isPosInt(q)) { bad(`recipes.${r.id}: unknown input ${id}`); continue; }
      if (it.unlock > r.unlock) bad(`recipes.${r.id} (L${r.unlock}) needs ${id} (L${it.unlock}) (R6)`);
      if (later(it.m, r.m)) bad(`recipes.${r.id} (${r.m}) needs ${id} (${it.m})`);
      inVal += it.sell * q;
    }
    // R3 (GDD §4.9): every recipe adds >= 15 % to the value of its inputs; integer form of sell*out >= 1.15 x inputs
    if (r.sell * r.out * 100 < inVal * 115) bad(`recipes.${r.id}: output worth less than 1.15 x its inputs (R3)`);
  }
  // items
  const used = new Set();
  for (const r of list('recipes')) for (const id of Object.keys(r.inputs ?? {})) used.add(id);
  const classes = new Set(list('feeds').flatMap((f) => (f.classes ?? []).map(({ cls }) => cls)));
  for (const it of list('items')) if (it.classes?.some((c) => classes.has(c))) used.add(it.id);
  for (const a of list('animals')) { if (a.feed) used.add(a.feed); if (a.bottle) used.add(a.bottle); }
  used.add('compost'); used.add('wood');   // spent by the Compost Scoop and on construction (barn, expansions)
  used.add(GROWTH.fertilizer.item);         // spread on plots and trees (owner wish #2, GROWTH.fertilizer)
  for (const it of list('items')) {
    if (!isPosInt(it.sell)) bad(`items.${it.id}.sell`);
    if (!ITEM_KINDS.includes(it.kind)) bad(`items.${it.id}.kind`);
    if (!inLevels(it.unlock)) bad(`items.${it.id}.unlock`);
    for (const f of ['sellable', 'orderable', 'giftable']) if (typeof it[f] !== 'boolean') bad(`items.${it.id}.${f}`);
    if (it.orderable && !it.sellable) bad(`items.${it.id}: orderable but not sellable`);
    if (!isNonNegInt(it.keepDefault)) bad(`items.${it.id}.keepDefault`);
    // every item is good for something: a use, or the Market (brief §3)
    if (!it.sellable && !used.has(it.id)) bad(`items.${it.id}: neither sellable nor used`);
    // no buy-low-sell-high loop: whatever the store sells costs more than the Market pays for it (R5)
    if (it.storePrice !== undefined && it.sellable
      && !(it.storePrice > it.sell)) bad(`items.${it.id}: store price <= sell (R5)`);
    if (['feed', 'consumable'].includes(it.kind) && (it.sellable
      || it.orderable)) bad(`items.${it.id}: consumables never sell (R5)`);
  }
  // decor
  for (const d of list('decor')) {
    if (!DECOR_TIERS.includes(d.tier)) bad(`decor.${d.id}.tier`);
    if (!isNonNegInt(d.cost) || !isNonNegInt(d.acorns)
      || !isNonNegInt(d.beauty10)) bad(`decor.${d.id}: cost/acorns/beauty`);
    if (d.tier === 'coin' || d.tier === 'grand') { if (!(d.cost > 0 && d.acorns === 0
      && d.shop)) bad(`decor.${d.id}: coin price`); }
    if (d.tier === 'acorn' && !(d.acorns > 0 && d.cost === 0 && d.shop)) bad(`decor.${d.id}: Acorn price`);
    if (d.tier === 'reward' && (d.cost !== 0 || d.acorns !== 0
      || d.shop !== false)) bad(`decor.${d.id}: reward decor is free and not sold`);
    if (!inLevels(d.unlock)) bad(`decor.${d.id}.unlock`);
    for (const k of Object.keys(d.effect ?? {})) if (!EFFECT_KEYS.has(k)) bad(`decor.${d.id}: unknown effect ${k}`);
    if (d.effect?.bonus && !(['crops', 'trees'].includes(d.effect.bonus.target) && isPosInt(d.effect.bonus.radius)
        && isPosInt(d.effect.bonus.bp))) bad(`decor.${d.id}: bonus effect`);
    if (d.effect?.seats !== undefined && d.effect.seats !== 2) bad(`decor.${d.id}: benches seat two`);
  }
  // landmarks and debris
  for (const l of list('landmarks')) if (l.shop !== false) bad(`landmarks.${l.id}: never sold`);
  for (const d of list('debris')) {
    if (d.shop !== false || !['hand', 'axe'].includes(d.tool) || !isPosInt(d.hp)) bad(`debris.${d.id}: tool/hp/shop`);
    if (!d.xp || !['home', 'expansion', 'regrow'].every((k) => isNonNegInt(d.xp[k]))) bad(`debris.${d.id}.xp`);
    if (!isNonNegInt(d.wood)) bad(`debris.${d.id}.wood`);
  }
  // plots
  for (const p of list('plots')) {
    if (p.kind !== 'plot' || p.layer === 'none') bad(`plots.${p.id}.kind/layer`);
    if (!isNonNegInt(p.free)) bad(`plots.${p.id}.free`);
    let last = 0;
    let lastPrice = 0;
    for (const [n, price] of p.prices ?? []) {
      if (!isPosInt(n) || n <= last || !isPosInt(price)
        || price < lastPrice) bad(`plots.${p.id}.prices must be increasing [n, coins]`);
      last = n;
      lastPrice = price;
    }
    if ((p.prices?.[0]?.[0] ?? 0) !== p.free + 1) bad(`plots.${p.id}: prices must start right after the free plots`);
  }
  // levels (R9: XP to next strictly increases, E never falls)
  levels.forEach((l, i) => {
    if (l.level !== i + 1) bad(`levels[${i}].level must be ${i + 1}`);
    if (!isNonNegInt(l.xp) || (i > 0 && l.xp <= levels[i - 1].xp)) bad(`levels[${i}].xp must strictly increase`);
    if (!isNonNegInt(l.coins) || !isNonNegInt(l.acorns) || !isPosInt(l.plotCap)) bad(`levels[${i}] rewards/cap`);
    if (!isPosInt(l.E) || (i > 0 && l.E < levels[i - 1].E)) bad(`levels[${i}].E must never fall (R9)`);
    if (i > 0 && l.xp - levels[i - 1].xp !== levels[i - 1].xpToNext) bad(`levels[${i}]: xp != previous xp + xpToNext`);
    if (i > 0 && i < levels.length - 1
      && !(l.xpToNext > levels[i - 1].xpToNext)) bad(`levels[${i}].xpToNext must increase (R9)`);
    if (!isNonNegInt(l.personalXp) || (i > 0
      && l.personalXp <= levels[i - 1].personalXp)) bad(`levels[${i}].personalXp`);
    if (i > 0 && l.plotCap < levels[i - 1].plotCap) bad(`levels[${i}].plotCap must not fall`);
  });
  if (levels[0] && levels[0].xp !== 0) bad('levels[0].xp must be 0');
  // Barn upgrades
  list('barn').forEach((b, i, all) => {
    if (b.n !== i + 1 || !inLevels(b.unlock) || !isPosInt(b.cost) || !isNonNegInt(b.planks)
      || !isNonNegInt(b.crates)) bad(`barn[${i}]`);
    if (i > 0 && !(b.capacity > all[i - 1].capacity && b.unlock > all[i - 1].unlock)) bad(`barn[${i}] must grow`);
  });

  // references used by quests, tutorial and proof tasks
  const familyOfRef = (ref) => {
    for (const fam of ['items', 'crops', 'trees', 'animals', 'homes', 'buildings', 'expansions']) {
      if (maps[fam].has(ref)) return fam;
    }
    return null;
  };
  const refDefs = (verb, ref) => {
    const v = QUEST_VERBS[verb];
    if (!v) return { err: `unknown verb ${verb}` };
    const refs = Array.isArray(ref) ? ref : [ref];
    const out = [];
    for (const one of refs) {
      if (v.refs.includes(`special:${one}`)) { out.push({ special: one, m: SPECIAL_REFS[one], unlock: 1 }); continue; }
      const fam = v.refs.find((f) => !f.startsWith('special:') && maps[f]?.has(one));
      if (!fam) return { err: `${verb} cannot target ${one}` };
      const d = maps[fam].get(one);
      out.push({ fam, id: one, m: d.m, unlock: d.unlock ?? 1 });
    }
    return { defs: out };
  };
  const checkTasks = (where, tasks, level, m) => {
    for (const task of tasks) {
      if (!isPosInt(task.qty)) bad(`${where}: qty of ${task.verb} ${task.ref}`);
      const r = refDefs(task.verb, task.ref);
      if (r.err) { bad(`${where}: ${r.err}`); continue; }
      for (const d of r.defs) {
        if (d.unlock > level) bad(`${where} (L${level}) needs ${d.id ?? d.special} (L${d.unlock}) (R6)`);
        if (later(d.m, m)) bad(`${where} (${m}) needs ${d.id ?? d.special} (${d.m})`);
      }
    }
  };
  // quests
  for (const q of list('quests')) {
    if (!maps.npcs.has(q.giver)) bad(`quests.${q.id}: unknown giver ${q.giver}`);
    if (!inLevels(q.level) || !isPosInt(q.coins) || !isPosInt(q.xp)) bad(`quests.${q.id}: level/coins/xp`);
    if (q.after !== null && maps.quests.get(q.after)?.chain !== q.chain) bad(`quests.${q.id}.after`);
    for (const id of q.alsoAfter ?? []) {
      if (maps.quests.get(id)?.chain !== q.chain || later(maps.quests.get(id).m, q.m)) bad(`quests.${q.id}.alsoAfter`);
    }
    for (const t of q.tasks ?? []) {
      if (t.retro !== undefined && (typeof t.retro !== 'string' || QUEST_VERBS[t.verb]?.state)) {
        bad(`quests.${q.id}: retro credit on ${t.verb} ${t.ref}`);
      }
    }
    if (q.after !== null && later(maps.quests.get(q.after)?.m,
      q.m)) bad(`quests.${q.id}: live before the quest it follows`);
    if (later(maps.npcs.get(q.giver)?.m, q.m)) bad(`quests.${q.id}: live before its giver`);
    if (!q.letter || !LETTER_ART.includes(q.letter.art) || !Array.isArray(q.letter.body) || !q.letter.body.length
        || typeof q.done !== 'string') bad(`quests.${q.id}: letter`);
    checkTasks(`quests.${q.id}`, q.tasks ?? [], q.level, q.m);
    const rw = q.rewards ?? {};
    for (const id of [...(rw.decor ?? []), ...(rw.giftAtStart ?? []), ...(rw.gift ?? [])]) {
      const d = maps.decor.get(id) ?? maps.trees.get(id);
      if (!d) bad(`quests.${q.id}: unknown reward ${id}`);
      else if (later(d.m, q.m)) bad(`quests.${q.id}: reward ${id} is ${d.m}`);
    }
    for (const id of Object.keys(rw.items ?? {})) {
      if (!item(id) || later(item(id).m, q.m)) bad(`quests.${q.id}: reward item ${id}`);
    }
    for (const id of rw.furniture ?? []) {
      const f = maps.furniture.get(id);
      if (!f || f.shop || later(f.m, q.m)) bad(`quests.${q.id}: reward furniture ${id}`);
    }
    for (const id of Object.keys(rw.animalsAtStart ?? {})) {
      if (!maps.animals.has(id)) bad(`quests.${q.id}: reward animal ${id}`);
    }
    if (rw.beat && !STORY_BEATS.some((b) => b.id === rw.beat)) bad(`quests.${q.id}: unknown beat ${rw.beat}`);
    const collected = list('collections').some((c) => c.items.some((x) => x.id === rw.collection));
    if (rw.collection && !collected) bad(`quests.${q.id}: unknown collection item`);
  }
  for (const id of Object.keys(QUEST_STORY)) if (!maps.quests.has(id)) bad(`story: letter for unknown quest ${id}`);
  // ribbons (R11: every Gold tier reachable from the content, finite sources counted)
  for (const r of list('ribbons')) {
    if (!['F', 'P', 'T'].includes(r.scope) || !RIBBON_MODES.includes(r.mode) || typeof r.stat !== 'string'
      || !r.stat) bad(`ribbons.${r.id}: scope/mode/stat`);
    if (!increasing(r.tiers) || r.tiers.length !== (r.hidden ? 1 : 3)) bad(`ribbons.${r.id}.tiers`);
    if (r.bound !== undefined) {
      const b = typeof r.bound === 'number' ? r.bound
        : r.bound.items ? list(r.bound.family).reduce((s, c) => s + c.items.length, 0)
          : list(r.bound.family).length - (r.bound.minus ?? 0);
      if (r.tiers.at(-1) > b) bad(`ribbons.${r.id}: Gold needs ${r.tiers.at(-1)}, only ${b} exist (R11)`);
    }
  }
  // npcs
  for (const n of list('npcs')) {
    if (!PORTRAIT_STYLES.hairStyle.includes(n.portrait?.hairStyle)
      || !PORTRAIT_STYLES.accessory.includes(n.portrait?.accessory)) bad(`npcs.${n.id}.portrait`);
    for (const k of ['skin', 'hair', 'outfit',
      'accent']) if (!HUE_RE.test(n.portrait?.[k] ?? '')) bad(`npcs.${n.id}.portrait.${k}`);
    for (const id of n.likes ?? []) if (!item(id) || later(item(id).m, n.m)) bad(`npcs.${n.id}: likes ${id}`);
  }
  // tools and features
  for (const tl of list('tools')) {
    if (!inLevels(tl.unlock) || !isNonNegInt(tl.cost) || !Array.isArray(tl.brush)) bad(`tools.${tl.id}`);
    if (tl.upgrades && !maps.tools.has(tl.upgrades)) bad(`tools.${tl.id}.upgrades`);
  }
  for (const f of list('features')) if (!inLevels(f.unlock)) bad(`features.${f.id}.unlock`);
  // titles
  list('titles').forEach((x, i, all) => { if (!isPosInt(x.level) || (i > 0
    && x.level <= all[i - 1].level)) bad(`titles[${i}]`); });
  if (list('titles')[0]?.level !== 1) bad('titles must start at level 1');
  // expansions: inside the farmable land, disjoint, covering it, each touching land owned before it
  const exps = list('expansions');
  const area = { tiles: new Map() };
  exps.forEach((e, i) => {
    if (!isNonNegInt(e.cost) || !inLevels(e.unlock)) bad(`expansions.${e.id}: cost/unlock`);
    if (i > 0 && !(e.unlock >= exps[i - 1].unlock)) bad(`expansions.${e.id}: out of order`);
    let touches = i === 0;
    for (const r of e.rects ?? []) {
      const [rx, rz, rw, rd] = r;
      if (!Array.isArray(r) || r.length !== 4 || !r.every(isNonNegInt) || rw < 1 || rd < 1
          || rx < CONFIG.FARM_MIN || rz < CONFIG.FARM_MIN || rx + rw > CONFIG.FARM_MAX || rz + rd > CONFIG.FARM_MAX) {
        bad(`expansions.${e.id}: bad rect`);
        continue;
      }
      for (let z = rz; z < rz + rd; z++) {
        for (let x = rx; x < rx + rw; x++) {
          const k = z * CONFIG.WORLD_TILES + x;
          if (area.tiles.has(k)) bad(`expansions.${e.id} overlaps ${area.tiles.get(k)} at ${x},${z}`);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const o = area.tiles.get((z + dz) * CONFIG.WORLD_TILES + x + dx);
            if (o && o !== e.id) touches = true;
          }
        }
      }
      for (let z = rz; z < rz + rd; z++) {
        for (let x = rx; x < rx + rw; x++) area.tiles.set(z * CONFIG.WORLD_TILES + x, e.id);
      }
    }
    if (!touches) bad(`expansions.${e.id} does not touch the land owned before it`);
    checkTasks(`expansions.${e.id}.proof`, e.proof ?? [], e.unlock, e.m);
    const inside = (x, z) => (e.rects ?? []).some(([rx, rz, rw, rd]) => x >= rx && z >= rz && x < rx + rw
      && z < rz + rd);
    const occupied = new Set();
    const debrisOf = t.expansionDebris?.[e.id] ?? [];
    for (const o of [...(e.free ?? []), ...debrisOf]) {
      const d = maps.trees.get(o.def) ?? maps.decor.get(o.def) ?? maps.homes.get(o.def) ?? maps.debris.get(o.def);
      if (!d) { bad(`expansions.${e.id}: unknown object ${o.def}`); continue; }
      if (later(d.m, e.m)) bad(`expansions.${e.id}: ${o.def} is ${d.m}`);
      for (let z = o.z; z < o.z + d.size[1]; z++) {
        for (let x = o.x; x < o.x + d.size[0]; x++) {
          if (!inside(x, z)) bad(`expansions.${e.id}: ${o.def} at ${o.x},${o.z} leaves the land`);
          if (occupied.has(`${x},${z}`)) bad(`expansions.${e.id}: ${o.def} at ${o.x},${o.z} overlaps`);
          occupied.add(`${x},${z}`);
        }
      }
    }
  });
  const farmTiles = (CONFIG.FARM_MAX - CONFIG.FARM_MIN) * (CONFIG.FARM_MAX - CONFIG.FARM_MIN);
  if (exps.length
    && area.tiles.size !== farmTiles) bad(`expansions cover ${area.tiles.size} tiles, the farm has ${farmTiles}`);
  // the starter farm
  const home = exps[0];
  const inHome = (x, z) => (home?.rects ?? []).some(([rx, rz, rw, rd]) => x >= rx && z >= rz && x < rx + rw
    && z < rz + rd);
  const layers = { object: new Map(), ground: new Map() };
  const stamp = (id, def, x, z) => {
    for (let dz = 0; dz < def.size[1]; dz++) {
      for (let dx = 0; dx < def.size[0]; dx++) {
        const k = `${x + dx},${z + dz}`;
        if (!inHome(x + dx, z + dz)) bad(`START: ${id} leaves the Homestead`);
        if (layers[def.layer].has(k)) bad(`START: ${id} overlaps ${layers[def.layer].get(k)}`);
        layers[def.layer].set(k, id);
      }
    }
  };
  const plot = maps.plots.get('plot');
  CONFIG.START.plots.forEach(([x, z], i) => { if (plot) stamp(`home.0.${i}`, plot, x, z); });
  const placeable = (id) => PLACEABLE_FAMILIES.map((f) => maps[f].get(id)).find(Boolean);
  for (const o of CONFIG.START.objects) {
    const d = placeable(o.def);
    if (!d) { bad(`START: unknown def ${o.def}`); continue; }
    if (!isLive(d)) bad(`START: ${o.def} is not live`);
    stamp(o.id, d, o.x, o.z);
  }
  if (plot && CONFIG.START.plots.length !== plot.free) {
    bad(`START: ${CONFIG.START.plots.length} plots but ${plot.free} are free`);
  }
  if (levels[0] && CONFIG.START.plots.length > levels[0].plotCap) bad('START: more plots than the level-1 plot cap');
  for (const [pid, p] of Object.entries(CONFIG.START.spawn)) {
    if (layers.object.has(`${Math.floor(p.x)},${Math.floor(p.z)}`)) bad(`START: spawn of ${pid} is blocked`);
  }
  for (const id of CONFIG.START.expansions) if (!maps.expansions.has(id)) bad(`START.expansions: unknown ${id}`);
  for (const id of CONFIG.START.tray) if (!isPosInt(placeable(id)?.unlock)
    || placeable(id).cost !== 0) bad(`START.tray: ${id}`);
  // tutorial steps
  for (const step of [...TUTORIAL.start, ...TUTORIAL.fields, ...TUTORIAL.barnyard, ...TUTORIAL.together]) {
    if (step.task && !TUTORIAL_VERBS.includes(step.task.verb)) checkTasks(`tutorial.${step.id}`, [step.task],
      step.level ?? 1, 'M1a');
    if (step.quest && !maps.quests.has(step.quest)) bad(`tutorial.${step.id}: unknown quest`);
    if (step.tool && !maps.tools.has(step.tool)) bad(`tutorial.${step.id}: unknown tool`);
  }
  // collections: 5 items each, item ids unique across sets, a display piece, and every `from` token names a source
  // that exists by the set's milestone (COLLECTION_SOURCES), so no live set waits for a system that is not there
  const albumIds = new Set();
  for (const c of list('collections')) {
    if (!Array.isArray(c.items) || c.items.length !== 5) bad(`collections.${c.id}: 5 items`);
    for (const x of c.items ?? []) {
      if (!ID_RE.test(x.id ?? '') || albumIds.has(x.id)) bad(`collections.${c.id}: item id ${x.id}`);
      albumIds.add(x.id);
    }
    if (!maps.decor.has(c.display)) bad(`collections.${c.id}: no display decor`);
    if (!Array.isArray(c.from) || !c.from.length) bad(`collections.${c.id}: no source`);
    for (const tok of c.from ?? []) {
      const [verb, arg] = String(tok).split(':');
      const vm = COLLECTION_SOURCES[verb];
      if (!vm) { bad(`collections.${c.id}: unknown source ${tok}`); continue; }
      if (later(vm, c.m)) bad(`collections.${c.id}: ${tok} is a ${vm} system`);
      if (arg === undefined) continue;
      const argDef = verb === 'craft' ? maps.buildings.get(arg) : verb === 'collect' ? maps.animals.get(arg)
        : verb === 'clear' ? maps.debris.get(arg) : verb === 'enter' && arg === 'fair' ? { m: 'M1b' }
          : verb === 'harvest' && (arg === 'long' || arg === 'flowering_tree') ? { m: 'M1a' }
            : verb === 'harvest' ? list('items').filter((it) => it.kind === 'crop' && it.classes?.includes(arg))
              .sort((a, b) => RANK[a.m] - RANK[b.m])[0] : undefined;
      if (!argDef) bad(`collections.${c.id}: ${tok} names nothing`);
      else if (later(argDef.m, c.m)) bad(`collections.${c.id}: ${tok} is ${argDef.m}`);
    }
  }
  // rule objects: slots and chests ordered, references resolve
  ORDERS.slots.forEach(([lvl, n], i, all) => { if (i > 0 && !(lvl > all[i - 1][0]
    && n > all[i - 1][1])) bad('ORDERS.slots'); });
  for (const day of DAILY_GIFT.days) {
    if (day.decor && day.decor !== 'season' && !maps.decor.has(day.decor)) bad(`DAILY_GIFT day ${day.day} decor`);
  }
  for (const id of Object.values(DAILY_GIFT.seasonDecor)) if (!maps.decor.has(id)) bad(`DAILY_GIFT season decor ${id}`);
  if (!list('decor').some((d) => d.source === 'challenge' && isLive(d))) bad('COUPLE_CHALLENGE: no live prize decor');
  // Restoration bundles, town projects, decor sets, pets, the Fair (M1b/M2 data must still be consistent)
  for (const p of list('restoration')) {
    if (!inLevels(p.unlock) || p.bundles?.length !== 4) bad(`restoration.${p.id}: unlock/bundles`);
    for (const b of p.bundles ?? []) {
      if (!(isPosInt(b.need)
        && b.need <= b.slots.length)) bad(`restoration.${p.id}.${b.id}: need ${b.need} of ${b.slots.length}`);
      for (const sl of b.slots) {
        if (sl.item !== undefined) {
          const it = item(sl.item);
          if (!it || !isPosInt(sl.qty)) bad(`restoration.${p.id}.${b.id}: unknown item ${sl.item}`);
          else if (it.unlock > p.unlock) bad(`restoration.${p.id}.${b.id} (L${p.unlock}): ${sl.item} is L${it.unlock}`);
          else if (later(it.m, p.m)) bad(`restoration.${p.id}.${b.id} (${p.m}) needs ${sl.item} (${it.m})`);
        } else if (sl.special !== undefined) {
          if (!RESTORATION_SPECIALS.includes(sl.special)) bad(`restoration.${p.id}.${b.id}: special ${sl.special}`);
        } else if (!isPosInt(sl.coinsHoursBp)) bad(`restoration.${p.id}.${b.id}: slot`);
      }
    }
  }
  for (const tp of list('townProjects')) {
    if (!maps.decor.has(tp.souvenir)) bad(`townProjects.${tp.id}: no souvenir decor`);
  }
  // decor sets (GDD §3.8: 4-6 pieces): every piece on demand (store decor or a story-quest reward, never a seasonal
  // gift or a weekly prize), in one set at most, and all of them reachable within the set's milestone (wave 2)
  const setOf = new Map();
  const lastLevelOf = (m) => ({ M1a: 12, M1b: 25 })[m] ?? maxLevel;
  for (const ds of list('decorSets')) {
    if (!Array.isArray(ds.pieces) || ds.pieces.length < 4
      || ds.pieces.length > 6) bad(`decorSets.${ds.id}: 4-6 pieces`);
    if (!isPosInt(ds.radius) || !inLevels(ds.unlock)) bad(`decorSets.${ds.id}: radius/unlock`);
    for (const id of ds.pieces ?? []) {
      const d = maps.decor.get(id);
      if (!d) { bad(`decorSets.${ds.id}: unknown piece ${id}`); continue; }
      if (later(d.m, ds.m)) bad(`decorSets.${ds.id}: piece ${id} is ${d.m}`);
      if (setOf.has(id)) bad(`decorSets.${ds.id}: ${id} is also in ${setOf.get(id)}`);
      setOf.set(id, ds.id);
      const quest = typeof d.source === 'string' && d.source.startsWith('quest:') ? maps.quests.get(d.source.slice(6))
        : null;
      if (!d.shop && !quest) bad(`decorSets.${ds.id}: ${id} cannot be had on demand (${d.source})`);
      const at = d.shop ? d.unlock : quest?.level;
      if (at > lastLevelOf(ds.m)) bad(`decorSets.${ds.id}: ${id} arrives at L${at}, after ${ds.m} ends`);
    }
  }
  // townsfolk Friendship (GDD §5.3): every townsperson pays a gift at each `rewardEvery` step up to `max`; decor
  // gifts exist by the board's milestone, cards name one of the townsperson's liked goods
  const fr = TOWNSFOLK.friendship;
  for (const n of list('npcs').filter((x) => x.townsfolk)) {
    const rw = fr.rewards?.[n.id];
    if (!Array.isArray(rw) || rw.length !== fr.max / fr.rewardEvery) {
      bad(`TOWNSFOLK: no Friendship gifts for ${n.id}`);
      continue;
    }
    for (const g of rw) {
      const d = g?.decor !== undefined ? maps.decor.get(g.decor) : null;
      if (g?.decor !== undefined && (!d || later(d.m, TOWNSFOLK.m))) bad(`TOWNSFOLK.${n.id}: decor gift ${g.decor}`);
      else if (g?.decor === undefined && !(n.likes ?? []).includes(g?.card)) bad(`TOWNSFOLK.${n.id}: card ${g?.card}`);
    }
    if (n.likes?.length !== 3) bad(`npcs.${n.id}: a townsperson likes 3 goods`);
  }
  for (const id of Object.keys(fr.rewards ?? {})) {
    if (!maps.npcs.get(id)?.townsfolk) bad(`TOWNSFOLK: ${id} is no townsperson`);
  }
  for (const k of PETS.kinds) if (!maps.decor.has(k.home) || !item(k.treat)) bad(`PETS.${k.id}: home/treat`);
  if (!maps.restoration.has(FAIR.medals.at(-1).needsProject)) bad('FAIR: Platinum needs an unknown project');
  for (const f of list('festivals')) if (f.ladder?.length !== 8) bad(`festivals.${f.id}: 8 ladder steps`);
  errs.push(...m2Problems(t, list, maps, placeableSeen, inLevels));
  errs.push(...w4bProblems(t, list, maps, inLevels));
  // every unlock level is reachable
  for (const fam of ['crops', 'trees', 'animals', 'homes', 'buildings', 'recipes', 'decor', 'tools', 'features']) {
    for (const d of list(fam)) if (d.unlock !== undefined
      && !inLevels(d.unlock)) bad(`${fam}.${d.id}: unlock ${d.unlock} unreachable`);
  }
  return errs;
}

/** A deep, mutable copy of every table validateContent() reads (tests mutate it to prove a check fires). */
export const cloneTables = () => structuredClone(TABLES);

const problems = validateContent();
if (problems.length) throw new Error(`Invalid content:\n  ${problems.join('\n  ')}`);

// ---- registry ------------------------------------------------------------------------------------------------
/**
 * A Map whose set/delete/clear throw: a stray `CONTENT.crops.set(...)` in one module would otherwise change
 * the rules on one side only. (Tests that need a fixture def call Map.prototype.set.call(map, ...) on purpose,
 * and delete it again.)
 */
function readOnly(m) {
  for (const k of ['set', 'delete', 'clear']) {
    Object.defineProperty(m, k, { value: () => { throw new TypeError('content is read-only'); } });
  }
  return Object.freeze(m);
}

const mapOf = (list) => readOnly(new Map(list.map((d) => [d.id, d])));

/** Every content family as an own-key Map (plus the ordered level, barn and title tables). */
export const CONTENT = Object.freeze({
  ...Object.fromEntries(MAP_FAMILIES.map((fam) => [fam, mapOf(TABLES[fam])])),
  levels: TABLES.levels,
  barn: TABLES.barn,
  titles: TABLES.titles,
});

/** Every def that can be placed on the grid, by id. */
export const PLACEABLES = readOnly(new Map(PLACEABLE_FAMILIES.flatMap((fam) => [...CONTENT[fam]])));

/** @returns {string[]} the Map families usable as ['content', kind] in action schemas. */
export function contentKinds() {
  return [...Object.keys(CONTENT).filter((k) => CONTENT[k] instanceof Map), 'placeables'];
}

/**
 * Own-key lookup of a LIVE def in a family ('placeables' included). Defs of later milestones answer undefined,
 * so an action argument naming one fails the schema (BAD_ARGS): nothing of M1b+ can be bought, planted, crafted
 * or sold in an M1a build, whatever a client sends.
 */
export function lookup(kind, id) {
  const m = kind === 'placeables' ? PLACEABLES : CONTENT[kind];
  if (!(m instanceof Map) || typeof id !== 'string') return undefined;
  const d = m.get(id);
  return isLive(d) ? d : undefined;
}

const getter = (fam) => (id) => CONTENT[fam].get(id);
export const defOf = (id) => PLACEABLES.get(id);
export const cropOf = getter('crops');
export const itemOf = getter('items');
export const treeOf = getter('trees');
export const animalOf = getter('animals');
export const homeOf = getter('homes');
export const buildingOf = getter('buildings');
export const recipeOf = getter('recipes');
export const feedOf = getter('feeds');
export const decorOf = getter('decor');
export const questOf = getter('quests');
export const ribbonOf = getter('ribbons');
export const npcOf = getter('npcs');
export const expansionOf = getter('expansions');
export const toolOf = getter('tools');
export const featureOf = getter('features');
export const collectionOf = getter('collections');
export const furnitureOf = getter('furniture');
const RELIC_BY_ID = new Map(TABLES.rules.RELICS.map((r) => [r.id, r]));
/** A RELICS row (the Acorn shop's unique items, wave 4b) by id, own key; undefined when unknown. */
export const relicOf = (id) => (typeof id === 'string' ? RELIC_BY_ID.get(id) : undefined);

const liveCache = new Map();
/** Frozen array of the live defs of a Map family, in table order. */
export function live(family) {
  if (!liveCache.has(family)) {
    const m = CONTENT[family];
    liveCache.set(family, Object.freeze(m instanceof Map ? [...m.values()].filter(isLive) : []));
  }
  return liveCache.get(family);
}

/** Live defs of a family unlocked at or below `level` (defs without `unlock` count as level 1). */
export const liveAt = (family, level) => live(family).filter((d) => (d.unlock ?? 1) <= level);

/** [{ family, id }] of every live def and system that unlocks exactly at `level` (the level-up banner, R8). */
export function unlocksAt(level) {
  const out = [];
  for (const fam of ['crops', 'trees', 'animals', 'homes', 'buildings', 'recipes', 'feeds', 'decor', 'tools',
    'expansions', 'features']) {
    for (const d of live(fam)) if (d.unlock === level && d.shop !== false && d.k !== 0) out.push({ family: fam,
      id: d.id });
  }
  for (const b of CONTENT.barn) if (isLive(b) && b.unlock === level) out.push({ family: 'barn', id: String(b.n) });
  return out;
}

const byUnlockThenTime = (a, b) => a.unlock - b.unlock || a.ms - b.ms || (a.id < b.id ? -1 : 1);
/** Live recipes of a building (the Feed Mill lists its feeds), by unlock level then craft time. */
export function recipesOf(buildingId) {
  return [...live('recipes'), ...live('feeds')].filter((r) => r.building === buildingId).sort(byUnlockThenTime);
}

/** Live item ids of an ingredient class, cheapest first (the Feed Mill uses the cheapest member first, §3.3). */
export function classMembers(cls) {
  return live('items').filter((it) => it.classes.includes(cls))
    .sort((a, b) => a.sell - b.sell || (a.id < b.id ? -1 : 1)).map((it) => it.id);
}

/** Live recipe, feed and animal ids that consume `itemId` (inputs, feed classes, feed, bottles). */
export function usesOf(itemId) {
  const it = itemOf(itemId);
  if (!it) return [];
  const out = [];
  for (const r of live('recipes')) if (Object.hasOwn(r.inputs, itemId)) out.push(r.id);
  for (const f of live('feeds')) if (f.classes.some(({ cls }) => it.classes.includes(cls))) out.push(f.id);
  for (const a of live('animals')) if (a.feed === itemId || a.bottle === itemId) out.push(a.id);
  return out;
}

// Uncountable last words of item names ("32 Wheat", "6 Chicken Feed", "3 Strawberry Jam", "4 Honey").
const MASS_NOUNS = new Set(['Wheat', 'Corn', 'Wood', 'Milk', 'Wool', 'Flour', 'Cornmeal', 'Sugar', 'Bread', 'Cream',
  'Butter', 'Cheese', 'Yogurt', 'Compost', 'Popcorn', 'Coleslaw', 'Gratin', 'Jam', 'Ketchup', 'Sauerkraut', 'Yarn',
  'Juice', 'Feed', 'Sugarcane', 'Soup', 'Cabbage',
  // M1b / M2 goods (wave 2)
  'Cotton', 'Lavender', 'Rice', 'Sap', 'Slop', 'Honey', 'Jelly', 'Manure', 'Fibre', 'Pasta', 'Risotto', 'Custard',
  'Marmalade', 'Cloth', 'Dye', 'Lemonade', 'Nectar', 'Beeswax', 'Soap', 'Oil', 'Syrup', 'Chocolate', 'Fudge',
  'Cocoa', 'Plush',
  // animals whose plural is the singular ("Buy 2 Sheep")
  'Sheep', 'Fish']);
/** An item or def name for `n` of it: "1 Egg", "3 Eggs", "2 Strawberries", "4 Potatoes", "32 Wheat", "2 Peaches". */
export function pluralOf(name, n) {
  if (n === 1 || typeof name !== 'string' || !name) return name;
  const last = name.split(' ').at(-1);
  if (MASS_NOUNS.has(last) || /s$/.test(last)) return name;
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  if (/[^aeiou]o$/.test(name) || /(ch|sh|x|z)$/.test(name)) return `${name}es`;
  if (/arf$/.test(name)) return `${name.slice(0, -1)}ves`;
  return `${name}s`;
}

/** Farm level for a cumulative XP total. Beyond the table every further level costs the last step (Legacy). */
export function levelFromXp(xp) {
  const L = CONTENT.levels;
  let lo = 0;
  let hi = L.length - 1;
  while (lo < hi) {                     // last row with row.xp <= xp
    const mid = (lo + hi + 1) >> 1;
    if (L[mid].xp <= xp) lo = mid; else hi = mid - 1;
  }
  const top = L.at(-1);
  if (xp < top.xp || L.length < 2) return lo + 1;
  const step = top.xp - L.at(-2).xp;
  return top.level + Math.floor((xp - top.xp) / step);
}

/** The levels row for `level` (the last row stands in for Legacy levels). */
export function levelRow(level) {
  const L = CONTENT.levels;
  return L[Math.min(Math.max(level, 1), L.length) - 1];
}

/** XP at which `level` starts (extrapolated past the table). */
export function xpForLevel(level) {
  const L = CONTENT.levels;
  if (level <= L.length) return L[Math.max(level, 1) - 1].xp;
  const step = L.at(-1).xp - L.at(-2).xp;
  return L.at(-1).xp + (level - L.length) * step;
}

/** Plot cap (GDD §3.10): 16 + floor(1.5 (level - 1)) from the table, + 6 per purchased expansion. */
export const PLOT_CAP_PER_EXPANSION = 6;
export function plotCapOf(level, expansionsOwned) {
  return levelRow(level).plotCap + PLOT_CAP_PER_EXPANSION * Math.max(0, expansionsOwned);
}

/** Price of the n-th plot (1-based): the first PLOTS.free are free, then the step table (GDD §3.10). */
export function plotPrice(n) {
  const def = CONTENT.plots.get('plot');
  if (n <= def.free) return 0;
  let price = def.prices[0][1];
  for (const [from, coins] of def.prices) if (n >= from) price = coins;
  return price;
}

/** Coins worth bp/10000 hours of E(level), rounded (quests, chests, daily gifts are sized in E-hours). */
export function eHours(level, bp) {
  return Math.floor((levelRow(level).E * bp + 5000) / 10_000);
}

/**
 * Mastery stars of a def for a count (GDD §4.8): 0-3, or 4 (Gold) when the Gold tier is live and the farm is at
 * MASTERY.goldFrom or above.
 */
export function masteryStars(def, count, level) {
  const th = def?.mastery;
  if (!Array.isArray(th)) return 0;
  let s = 0;
  while (s < 3 && count >= th[s]) s++;
  if (s === 3 && count >= th[3] && level >= MASTERY.goldFrom && isLive({ m: MASTERY.goldM })) s = 4;
  return s;
}

/** Personal level for a player's XP (GDD §4.7: thresholds 0.6 x the farm table; Legacy past it). */
export function personalLevelFromXp(xp) {
  const L = CONTENT.levels;
  let lo = 0;
  let hi = L.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (L[mid].personalXp <= xp) lo = mid; else hi = mid - 1;
  }
  const top = L.at(-1);
  if (xp < top.personalXp) return lo + 1;
  const step = top.personalXp - L.at(-2).personalXp;
  return top.level + Math.floor((xp - top.personalXp) / step);
}

/** The personal title for a personal level (the last TITLES row at or below it). */
export function titleFor(personalLevel) {
  let t = CONTENT.titles[0];
  for (const row of CONTENT.titles) if (row.level <= personalLevel && isLive(row)) t = row;
  return t.title;
}

/** Order Board slots at a farm level (0 before the board unlocks). */
export function orderSlotsAt(level) {
  let n = 0;
  for (const [from, slots] of ORDERS.slots) if (level >= from) n = slots;
  return n;
}

/** Barn capacity after `upgrades` Barn upgrades. */
export function barnCapacity(upgrades) {
  return upgrades <= 0 ? MARKET.barn.start : CONTENT.barn[Math.min(upgrades, CONTENT.barn.length) - 1].capacity;
}

/** How many trees of one species the farm may own at a level (GDD §3.2 rule 2). */
export function treeCapAt(tree, level) {
  return Math.min(tree.cap.max, tree.cap.base + tree.cap.per10Levels * Math.floor(level / 10));
}

/** How many copies of a home the farm may own at a level (one per species; Beehives 2 at L13, +1 every 3 levels). */
export function homeCountAt(home, level) {
  if (level < home.count.from) return 0;
  if (!home.count.every) return home.count.base;
  return Math.min(home.count.max, home.count.base + Math.floor((level - home.count.from) / home.count.every));
}

/**
 * The objects that arrive with a purchased expansion: its free objects (`mature` trees, the wild hive) and its
 * debris (origin 'expansion'), with object ids `exp<k>.<i>`.
 */
export function expansionObjects(expansionId) {
  const e = expansionOf(expansionId);
  if (!e || e.k === 0) return [];
  const all = [...e.free, ...(TABLES.expansionDebris[e.id] ?? []).map((d) => ({ ...d, origin: 'expansion' }))];
  return all.map((o, i) => ({ id: `exp${e.k}.${i}`, rot: 0, ...o }));
}

// ---- hash -------------------------------------------------------------------------------------------------
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Changes whenever any table or config value changes; clients reload on mismatch (tech §3.7). */
export const CONTENT_HASH = fnv1a(canonical({ tables: TABLES, config: { ...CONFIG }, rules: RULES_VERSION,
  milestone: MILESTONE }));

export {
  CONFIG, ORDERS, DAILY_GIFT, FARM_WEEKS, ALMANAC, COUPLE_CHALLENGE, RECAP, COOP, SAFETY, FEED, GROWTH, BOOSTS,
  MASTERY, MARKET, TUTORIAL, DRIP_FEED, DEBRIS_RULES, QUEST_VERBS, STORY_BEATS, RIBBON_REWARDS, RIBBON_WALL,
  MEDAL_RANKS, COLLECTION_RULES, COLLECTION_SOURCES, MODEL, FAIR, BARGE, TOWNSFOLK, TOWN_PROJECT_RULES, FARM_BEAUTY,
  MASTERWORK, SEASONAL_TRACK, LEGACY, HEARTS_SHOP, PERKS, PETS, NURSERY, BREEDING, RESTED, FISHING, DUEL, INTERIOR,
  GRANDMA_VISIT, FESTIVAL_PAVILION, UPGRADES, WEEDS, AVATAR_LOOKS, CRATES, RELICS, HOME_GROWTH, TREE_AGE, QUEUE_FINISH,
};
