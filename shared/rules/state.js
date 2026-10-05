// The replicated game state: creation and validation (tech-architecture §2). FROZEN CONTRACT for the
// top-level shape; the Rules lane adds fields (always with createFarm + validateState + a migration).
//
// Shape (M0 subset of §2.2; one plain JSON object, no class instances, no Maps):
// {
//   schema: 2,
//   meta:    { farmSeed, createdAt, version, contentHash, tz }   version = count of accepted actions (= `v`);
//                                                       tz = the farm's IANA zone (calendar.js, review-m0 #3)
//   farm: {
//     name, xp,                                         farm level = levelFromXp(xp), derived
//     wallet:    { coins, acorns },                     keys always exist, even at 0
//     inventory: { [item]: n }, overflow: { [item]: n } sparse; a missing key means 0
//     stats:     { [counter]: n },                      sparse flat counters ('harvest.wheat', 'coins.earned')
//     mastery:   { [crop]: harvestCount },
//     rolls:     { [name]: n },                         sparse roll counters: the rng key for rolls on NEW
//                                                       objects (bump in the same tx; review-m0 #2)
//     ledger:    { n, rows: { [n % LEDGER_MAX]: { at, by, n, reason } } }
//     expansions: [expansionId, ...],                   distinct
//     objects:   { [objId]: Obj },
//     barn, storage, storagePaid, keep, trash, demand, tools, seeds, golden, proofs, regrow, basketDay, wishlist,
//     noFeed
//                                                       the economy's fields (wave 1): validateEconomy() below
//     ... rules-goals' fields (orders, quests, ribbons, daily, feed, notes, ...): the goals blocks
//     weeds: { t: { 'x,z': 1 }, day, n }               wave 4: the farm's weeded tiles (actions/weeds.js)
//     relics: { [relicId]: { at, by, d? } }             wave 4b: the Acorn shop's relics (relics.js)
//     crates: { k, n }                                  wave 4b: the last balloon pass handled, crates so far (crates.js)
//   },
//   players: { [pid]: Player },                          created by the `_join` system action on claim
// }
// Obj (plot): { def: 'plot', x, z, rot, placedAt, by, cycle, crop: null | Crop }
// Obj whose def has layer 'none' (animals, review-m0 #9): { def, home, placedAt, by, ... } and no x/z/rot:
//             it lives in the object `home` (whose def id is in the animal def's `homes`); the renderer derives
//             its position from the home, so moving a home needs no animal ops. capacityOf() caps occupants.
// Crop:       { def, plantedAt, readyAt, by, cycle, cut, ... }   timestamps are absolute server epoch ms
//             Every object kind's economy fields (trees, animals, homes, buildings, debris, receipts, move-back,
//             pins): objectProblems() below is their single description.
// Player:     { name, color, xp, hearts, stats, joinedAt, lastSeenAt, acornDay, pet, fish, avatar, ...goals fields }
//             avatar (wave 4): null | { body?, hair?, hairColor?, skin?, top?, bottom?, hat? } (actions/avatar.js)
// Wave 4b: a crate object { def: CRATES.def, x, z, rot: 0, placedAt, by: 'sys', k, until } (actions/crates.js); a home's
// `up` may now reach its growth max and its footprint is grid.sizeOf(o) (bigger tiers past the old capacityMax);
// player `save` = the relic they save for (null = the tracker picks).
// Wave 4 object fields: landmark / decor `up` = upgrade tiers bought (upgrades.js); crop `fert` = who spread
// Fertilizer; trash entries may be a tray copy { tray, paid, until, by, coins, acorns } (decor.js sellStored).
//
// The key sets below are the whole shape: validateState reports any other key, so a lane adding a field adds
// it to the set, to createFarm, to validateState and (for existing saves) to server/migrations.js.
//
// The server-private sidecar ({ clock, clients, auth }) is NOT part of this object (see server/persist.js).
import {
  CONTENT, CONTENT_HASH, defOf, cropOf, itemOf, animalOf, PETS, NURSERY, BREEDING, FISHING, INTERIOR,
  TOWN_PROJECT_RULES, CRATES, relicOf,
} from '../content/index.js';
import { START, PLAYER_SLOTS, WORLD_TILES, LEDGER_MAX } from '../content/config.js';
import { objTiles, inLand, capacityOf, greenhousePlotTiles } from './grid.js';
import { isTimeZone } from './calendar.js';
import { interiorCells } from './interior-cells.js';
import { UPGRADES, upgradeTargetOf } from './upgrades.js';
import { avatarOk } from './actions/avatar.js';
import { breedOk } from './actions/pets.js';

export const SCHEMA = 2;
/** The farm's zone when the server passes none (server/config.js HH_TZ defaults to it too). */
export const DEFAULT_TZ = 'Europe/Sofia';

export const TOP_KEYS = Object.freeze(new Set(['schema', 'meta', 'farm', 'players']));
export const META_KEYS = Object.freeze(new Set(['farmSeed', 'createdAt', 'version', 'contentHash', 'tz']));
/** Farm-level economy keys (wave 1, rules-economy; shapes in the header and in validateEconomy()). */
const ECON_FARM_KEYS = ['barn', 'storage', 'keep', 'trash', 'demand', 'tools', 'seeds', 'golden', 'proofs', 'regrow',
  'basketDay', 'wishlist', 'noFeed', 'storagePaid', 'rain', 'surplus',
  // wave 2 (M1b): Farm Beauty, the Restoration Ledger, Town Projects (`made`, the goods log, is rules-goals')
  'beauty', 'restore', 'town',
  // wave 3 (M2): the Breeding Barn, the Fishing Dock's trophy board, the farmhouse interior
  'breed', 'fishing', 'interior',
  // wave 4: the weeded tiles of the farm's land (actions/weeds.js)
  'weeds',
  // wave 4b: the Acorn shop's relics (relics.js) and the balloon's crates (actions/crates.js)
  'relics', 'crates'];
/**
 * Player-level economy keys: `acornDay` = { day, n } Acorns spent on the farm-calendar day (BIG_SPEND); `pet` = the
 * player's pet or null (actions/pets.js; M1b); `fish` = { cast: null | { spot, at, bite, done? }, at, day } the Fishing
 * Dock (actions/fishing.js; M2): the line in the water, the last landing (the hourly cooldown) and the farm day of the
 * last fishing-together Heart.
 */
const ECON_PLAYER_KEYS = ['acornDay', 'pet', 'fish',
  // wave 4: the player's look (actions/avatar.js): null = the slot's default
  'avatar',
  // wave 4b: the Acorn shop relic this player saves for (actions/relics.js saveFor): null = the tracker's pick
  'save'];
// The goals lane (rules-goals) owns every block between `// >>> goals state (rules-goals)` and
// `// <<< goals state` in this file (key sets, createFarm, createPlayer, validateState); rules-economy owns the rest.
// >>> goals state (rules-goals)
// The goals fields: shapes, factories and validation live in shared/rules/goals.js (one place for the lane).
import { GOALS_FARM_KEYS, GOALS_PLAYER_KEYS, createGoalsFarm, createGoalsPlayer, validateGoalsFarm,
  validateGoalsPlayer } from './goals.js';
// <<< goals state

export const FARM_KEYS = Object.freeze(new Set(['name', 'xp', 'xpFrac', 'wallet', 'inventory', 'overflow', 'stats',
  'mastery', 'rolls', 'ledger', 'expansions', 'objects', ...ECON_FARM_KEYS, ...GOALS_FARM_KEYS]));
export const PLAYER_KEYS = Object.freeze(new Set(['name', 'color', 'xp', 'hearts', 'stats', 'joinedAt', 'lastSeenAt',
  ...ECON_PLAYER_KEYS, ...GOALS_PLAYER_KEYS]));

/**
 * A fresh farm. Pure: the caller supplies the seed (server: crypto random), `now` (server clock) and the
 * farm's IANA time zone (server: HH_TZ).
 * @param {number} farmSeed  32-bit unsigned integer
 * @param {number} now       epoch ms
 * @param {string} [tz]      IANA zone, default DEFAULT_TZ
 */
export function createFarm(farmSeed, now, tz = DEFAULT_TZ) {
  const objects = {};
  START.plots.forEach(([x, z], i) => {
    objects[`home.0.${i}`] = { def: 'plot', x, z, rot: 0, placedAt: now, by: 'sys', cycle: 0, crop: null };
  });
  // every other object of minute zero (landmarks, fence, paths, starter debris), with its content-given id
  for (const o of START.objects) {
    const def = defOf(o.def);
    if (!def) continue;
    const obj = { def: o.def, x: o.x, z: o.z, rot: o.rot ?? 0, placedAt: now, by: 'sys' };
    if (def.kind === 'debris') obj.origin = 'home';
    objects[o.id] = obj;
  }
  const storage = {};
  for (const d of START.tray) storage[d] = (storage[d] ?? 0) + 1;
  const farm = {
    name: 'Harvest Hollow',
    xp: 0,
    xpFrac: 0,          // hundredths of a farm XP not paid yet (crop harvests, RC-13); absent in older saves = 0
    wallet: { coins: START.coins, acorns: START.acorns },
    inventory: {},
    overflow: {},
    stats: {},
    mastery: {},
    rolls: {},
    ledger: { n: 0, rows: {} },
    expansions: START.expansions.slice(),
    objects,
    barn: 0,
    storage,
    keep: {},
    trash: {},
    demand: { day: 0, n: {} },
    tools: {},
    seeds: {},
    golden: 0,
    proofs: {},
    regrow: { at: now },
    basketDay: 0,
    wishlist: {},
    noFeed: {},
    storagePaid: {},
    rain: { at: Math.floor(now / 3_600_000) },
    beauty: { stars: 0, sets: {} },
    restore: {},
    town: { n: 0, cur: null },
    breed: { cur: null, n: {}, pity: {} },
    fishing: { records: {}, week: { n: 0, best: null }, n: 0 },
    interior: { items: {}, tray: {} },
    weeds: { t: {}, day: 0, n: 0 },
    relics: {},
    // the balloon pass already handled: a new farm (and an older save, through the backfill) starts at the pass of
    // its creation, so it never catches up crates for the time before it existed
    crates: { k: Math.floor((now - CRATES.dropAtMs) / CRATES.everyMs), n: 0 },
  };
  // >>> goals state (rules-goals): add the goals fields to `farm` here (farm.orders = ..., etc.)
  Object.assign(farm, createGoalsFarm(now, tz));
  // <<< goals state
  return {
    schema: SCHEMA,
    meta: { farmSeed: farmSeed >>> 0, createdAt: now, version: 0, contentHash: CONTENT_HASH, tz },
    farm,
    players: {},
  };
}

export function createPlayer(name, color, now) {
  const p = { name, color, xp: 0, hearts: 0, stats: {}, joinedAt: now, lastSeenAt: now, acornDay: { day: 0, n: 0 },
    pet: null, fish: { cast: null, at: 0, day: 0 }, avatar: null, save: null };
  // >>> goals state (rules-goals): add the goals fields to the player `p` here
  Object.assign(p, createGoalsPlayer());
  // <<< goals state
  return p;
}

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const isActor = (by) => by === 'sys' || PLAYER_SLOTS.includes(by);

function unknownKeys(o, keys, where, bad) {
  for (const k of Object.keys(o)) if (!keys.has(k)) bad(`${where}: unknown field ${k}`);
}

/**
 * Check every invariant of a state. Pure; never throws.
 * @param {object} s
 * @param {{ now?: number }} [opts]  with `now`, timestamps may not lie in the far future
 * @returns {string[]} problems (empty = valid)
 */
export function validateState(s, opts = {}) {
  const errs = [];
  const bad = (m) => errs.push(m);
  try {
    if (!isObj(s)) return ['state is not an object'];
    unknownKeys(s, TOP_KEYS, 'state', bad);
    if (s.schema !== SCHEMA) bad(`schema ${s.schema} != ${SCHEMA}`);
    const m = s.meta;
    if (!isObj(m) || !isCount(m.version) || !isCount(m.farmSeed) || m.farmSeed > 0xffffffff) bad('meta');
    else {
      unknownKeys(m, META_KEYS, 'meta', bad);
      if (!isCount(m.createdAt)) bad('meta.createdAt');
      if (typeof m.contentHash !== 'string' || !/^[0-9a-f]{8}$/.test(m.contentHash)) bad('meta.contentHash');
      if (!isTimeZone(m.tz)) bad(`meta.tz: not an IANA time zone (${m.tz})`);
    }
    const f = s.farm;
    if (!isObj(f)) return [...errs, 'farm missing'];
    unknownKeys(f, FARM_KEYS, 'farm', bad);
    if (typeof f.name !== 'string') bad('farm.name');
    if (!isCount(f.xp)) bad('farm.xp');
    if (f.xpFrac !== undefined && !(isCount(f.xpFrac) && f.xpFrac < 100)) bad('farm.xpFrac');
    if (!isObj(f.wallet) || !isCount(f.wallet.coins) || !isCount(f.wallet.acorns)) bad('farm.wallet');
    for (const key of ['inventory', 'overflow']) {
      if (!isObj(f[key])) { bad(`farm.${key}`); continue; }
      for (const [k, n] of Object.entries(f[key])) {
        if (!itemOf(k)) bad(`farm.${key}: unknown item ${k}`);
        if (!isCount(n) || n === 0) bad(`farm.${key}.${k} must be a positive integer`);
      }
    }
    for (const key of ['stats', 'mastery', 'rolls']) {
      if (!isObj(f[key])) { bad(`farm.${key}`); continue; }
      for (const [k, n] of Object.entries(f[key])) if (!isCount(n)) bad(`farm.${key}.${k}`);
    }
    if (!isObj(f.ledger) || !isCount(f.ledger.n) || !isObj(f.ledger.rows)) bad('farm.ledger');
    else {
      for (const [k, row] of Object.entries(f.ledger.rows)) {
        const i = Number(k);
        if (!(String(i) === k && isCount(i) && i < LEDGER_MAX)) bad(`farm.ledger.rows: bad slot ${k}`);
        if (!isObj(row) || !isCount(row.at) || !isActor(row.by) || !Number.isSafeInteger(row.n)
            || typeof row.reason !== 'string') bad(`farm.ledger.rows.${k}`);
      }
    }
    if (!Array.isArray(f.expansions) || f.expansions.some((e) => !CONTENT.expansions.has(e))) bad('farm.expansions');
    else if (new Set(f.expansions).size !== f.expansions.length) bad('farm.expansions: duplicate');
    if (!isObj(f.objects)) return [...errs, 'farm.objects'];
    const taken = { object: new Map(), ground: new Map() };
    const occupants = new Map();
    const horizon = opts.now === undefined ? Infinity : opts.now + 400 * 86_400_000;
    for (const [id, o] of Object.entries(f.objects)) {
      if (!/^[a-z0-9.]{1,40}$/.test(id)) bad(`object id ${id}`);
      const def = defOf(o && o.def);
      if (!def) { bad(`objects.${id}: unknown def ${o && o.def}`); continue; }
      if (!isCount(o.placedAt)) bad(`objects.${id}.placedAt`);
      if (!isActor(o.by)) bad(`objects.${id}.by`);
      for (const p of objectProblems(o, def, horizon)) bad(`objects.${id}${p}`);
      if (def.layer === 'none') {
        // lives inside its home: no footprint, no tiles (review-m0 #9)
        const home = typeof o.home === 'string' && Object.hasOwn(f.objects, o.home) ? f.objects[o.home] : null;
        if (!home) { bad(`objects.${id}.home: no such object ${o.home}`); continue; }
        if (!Array.isArray(def.homes) || !def.homes.includes(home.def)) bad(`objects.${id}: ${home.def} cannot house ${o.def}`);
        occupants.set(o.home, (occupants.get(o.home) ?? 0) + 1);
        continue;
      }
      if (![o.x, o.z].every((n) => Number.isSafeInteger(n) && n >= 0 && n < WORLD_TILES)) bad(`objects.${id}: coords`);
      if (!Number.isSafeInteger(o.rot) || o.rot < 0 || o.rot > 3) bad(`objects.${id}: rot`);
      for (const [x, z] of objTiles(o, def)) {
        if (!inLand(s, x, z)) bad(`objects.${id}: tile ${x},${z} outside the unlocked land`);
        const k = `${x},${z}`;
        if (taken[def.layer].has(k)) bad(`objects.${id} overlaps ${taken[def.layer].get(k)} at ${k}`);
        taken[def.layer].set(k, id);
      }
    }
    for (const [homeId, n] of occupants) {
      const cap = capacityOf(s, homeId);
      if (n > cap) bad(`objects.${homeId}: ${n} occupants over capacity ${cap}`);
    }
    // a Greenhouse holds exactly its own plots, each on one of its plot tiles (GDD §5.9; grid.canFit keeps it so)
    for (const [k, gid] of taken.ground) {
      const g = f.objects[gid];
      if (!defOf(g.def)?.greenhouse) continue;
      const oid = taken.object.get(k);
      if (oid !== undefined && f.objects[oid].gh !== gid) bad(`objects.${oid} stands inside the greenhouse ${gid}`);
    }
    for (const [id, o] of Object.entries(f.objects)) {
      if (o.gh === undefined) continue;
      const g = Object.hasOwn(f.objects, o.gh) ? f.objects[o.gh] : null;
      const gd = g && defOf(g.def);
      if (!gd?.greenhouse || o.def !== 'plot') { bad(`objects.${id}.gh: no greenhouse ${o.gh}`); continue; }
      const at = greenhousePlotTiles(gd, g.x, g.z, g.rot).some(([x, z]) => x === o.x && z === o.z);
      if (!at) bad(`objects.${id}: not on a plot tile of its greenhouse`);
    }
    if (!isObj(s.players)) bad('players');
    else {
      for (const [pid, p] of Object.entries(s.players)) {
        if (!PLAYER_SLOTS.includes(pid)) bad(`players: unknown slot ${pid}`);
        if (!isObj(p) || typeof p.name !== 'string' || !isCount(p.xp) || !isCount(p.hearts) || !isObj(p.stats)) {
          bad(`players.${pid}`);
          continue;
        }
        unknownKeys(p, PLAYER_KEYS, `players.${pid}`, bad);
        if (typeof p.color !== 'string' || !COLOR_RE.test(p.color)) bad(`players.${pid}.color`);
        if (!isCount(p.joinedAt) || !isCount(p.lastSeenAt)) bad(`players.${pid}: timestamps`);
        for (const [k, n] of Object.entries(p.stats)) if (!isCount(n)) bad(`players.${pid}.stats.${k}`);
        if (!isObj(p.acornDay) || !isCount(p.acornDay.day) || !isCount(p.acornDay.n)) bad(`players.${pid}.acornDay`);
        if (!petOk(p.pet)) bad(`players.${pid}.pet`);
        if (!fishOk(p.fish)) bad(`players.${pid}.fish`);
        if (p.avatar !== undefined && !avatarOk(p.avatar)) bad(`players.${pid}.avatar`);
        if (p.save !== undefined && p.save !== null && !relicOf(p.save)) bad(`players.${pid}.save`);
        // >>> goals state (rules-goals): validate the goals fields of player `p` (id `pid`) with bad(msg)
        validateGoalsPlayer(p, pid, bad);
        // <<< goals state
      }
    }
    validateEconomy(f, bad);
    // >>> goals state (rules-goals): validate the goals fields of farm `f` (state `s`, `opts`) with bad(msg)
    validateGoalsFarm(f, bad);
    // <<< goals state
  } catch (err) {
    bad(`validateState threw: ${err.message}`);
  }
  return errs;
}

// ---- economy shapes (rules-economy) ---------------------------------------------------------------------------

const isTrue = (v) => v === true;
/** A coat id: a Breeding Barn coat or a season coat (content ids; checked loosely so a later season's coat loads). */
const COAT_RE = /^[a-z][a-z0-9_]{0,23}$/;
const isPid = (v) => PLAYER_SLOTS.includes(v);
const optCount = (v) => v === undefined || isCount(v);
const COMMON = ['def', 'x', 'z', 'rot', 'placedAt', 'by', 'paid', 'rcpt', 'prev', 'pin', 'free'];
const FIELDS = {
  plot: new Set([...COMMON, 'cycle', 'crop', 'compost', 'gh', 'giantTried']),
  tree: new Set([...COMMON, 'cycle', 'matureAt', 'startedAt', 'readyAt', 'cut', 'water', 'tend', 'compost']),
  animal: new Set(['def', 'home', 'placedAt', 'by', 'paid', 'rcpt', 'free', 'adultAt', 'fedAt', 'readyAt', 'cycle',
    'cut', 'pet', 'baby', 'bot', 'pb', 'nurse', 'pers', 'spec', 'coat', 'bcoat', 'cardBy']),
  home: new Set([...COMMON, 'up']),
  building: new Set([...COMMON, 'slots', 'queue', 'made', 'qn', 'joint', 'pts', 'ready', 'xs']),
  decor: new Set([...COMMON, 'mw', 'up']),
  landmark: new Set([...COMMON, 'up']),
  debris: new Set([...COMMON, 'origin', 'hp', 'lastChop', 'team']),
  // wave 4b: a balloon crate (actions/crates.js): k = the balloon pass that dropped it, until = it goes to the Barn
  crate: new Set(['def', 'x', 'z', 'rot', 'placedAt', 'by', 'k', 'until']),
};
const CROP_FIELDS = new Set(['def', 'plantedAt', 'readyAt', 'by', 'cycle', 'cut', 'paid', 'packet', 'golden', 'water',
  'tend', 'season', 'forced', 'giant', 'hp', 'chop', 'fert']);
const QUEUE_FIELDS = new Set(['r', 's', 'e', 'by', 'in', 'k', 'slow', 'duet', 'pair']);

const isMoney = (v) => isObj(v) && isCount(v.coins) && isCount(v.acorns) && Object.keys(v).length === 2;

/**
 * Problems of one object's economy fields (suffixes for `objects.<id>`). Kinds and fields (wave 1):
 *   every placed object  paid? {coins, acorns} price paid (resale/refund base), rcpt? {coins, acorns, until} the
 *                        10-minute undo receipt (any use deletes it), prev? {x, z, rot, until, by} the move-back
 *                        window, pin? pid (pinned decor), free? true (quest/expansion gift: not counted for n-th
 *                        prices)
 *   plot      cycle, crop, compost? true (applied, used up at the next harvest)
 *   crop      {def, plantedAt, readyAt, by, cycle, cut (time cuts in bp), paid? (seed coins), packet?|golden? true,
 *              water? actor, tend? pid, season? true, fert? pid (wave 4: who spread Fertilizer on it)}
 *   tree      cycle (harvests), matureAt, startedAt, readyAt, cut, water?, tend?, compost?
 *   animal    {def, home, placedAt, by, adultAt, fedAt|null, readyAt|null, cycle (collections), cut, pet? {day, by},
 *             bot? {pid: at} (each player's last Baby Bottle for this baby)}
 *   home      up? (capacity upgrades bought)
 *   building  slots, queue [{r, s, e, by, in: {item: n}, k?, slow?, duet?, pair? [pid, pid]}], made (crafts
 *             collected), qn? (the next queue key; k < qn and unique), joint? {by, at, r} (a pending duet press),
 *             pts?/ready? (Compost Bin points and Compost waiting)
 *   debris    origin 'home'|'expansion'|'regrow', hp? (left), lastChop? {by, at}, team? [a, b] (a teamwork chop
 *             happened)
 * Wave 2 (M1b):
 *   plot      gh? objId: one of a Greenhouse's plots (never moved, sold or counted against the plot cap)
 *             giantTried? cycle: this plot was part of a block that rolled for a Giant in that cycle (wave-2 QA RC-06)
 *   crop      forced? true (in season only thanks to a Greenhouse / Cold Frame: its +10 % sell is paid as a bonus
 *             unit chance), giant? anchorPlotId (one of the nine plots of a Giant; the anchor holds the timers that
 *             count), hp? (the anchor: what is left to chop), chop? {by: [pids], last: {by, at}, hits?: {pid: n}}
 *             (the anchor; hits = chops per farmer, RC-09)
 *   decor     mw? 1 | 2 Masterwork level
 * Wave 3 (M2):
 *   animal    pb? at (the last partner bottle), nurse? { n: 1..3, at, by: [pids] } (Nursery card), pers? / spec? (the
 *             Nursery picks), coat? (a Breeding Barn or season coat id; names live in rules-goals' farm.names),
 *             bcoat? (the bred coat kept under a season coat), cardBy? (a Bloom-grown baby may start its Nursery card
 *             until then)
 *   building  xs? n: slots added by a reward (Grandma's duet table: +1 Kitchen slot), on top of def.slots
 */
export function objectProblems(o, def, horizon = Infinity) {
  const out = [];
  const bad = (m) => out.push(m);
  const kind = def.layer === 'none' ? 'animal' : def.kind;
  const fields = FIELDS[kind];
  if (fields) for (const k of Object.keys(o)) if (!fields.has(k)) bad(`: unknown field ${k}`);
  if (o.paid !== undefined && !isMoney(o.paid)) bad('.paid');
  if (o.rcpt !== undefined && !(isObj(o.rcpt) && isCount(o.rcpt.coins) && isCount(o.rcpt.acorns)
    && isCount(o.rcpt.until))) bad('.rcpt');
  if (o.prev !== undefined && !(isObj(o.prev) && isCount(o.prev.x) && isCount(o.prev.z) && isCount(o.prev.rot)
    && o.prev.rot <= 3 && isCount(o.prev.until) && isActor(o.prev.by))) bad('.prev');
  if (o.pin !== undefined && !isPid(o.pin)) bad('.pin');
  if (o.free !== undefined && !isTrue(o.free)) bad('.free');
  switch (kind) {
    case 'plot': {
      if (!isCount(o.cycle)) bad('.cycle');
      if (o.gh !== undefined && !(typeof o.gh === 'string' && o.gh.length > 0)) bad('.gh');
      if (o.compost !== undefined && !isTrue(o.compost)) bad('.compost');
      if (o.giantTried !== undefined && !isCount(o.giantTried)) bad('.giantTried');
      const c = o.crop;
      if (c === null) break;
      if (!isObj(c) || !cropOf(c.def)) { bad('.crop: unknown crop'); break; }
      for (const k of Object.keys(c)) if (!CROP_FIELDS.has(k)) bad(`.crop: unknown field ${k}`);
      if (!isCount(c.plantedAt) || !isCount(c.readyAt) || c.readyAt < c.plantedAt) bad('.crop: timestamps');
      else if (c.readyAt > horizon) bad('.crop: readyAt in the far future');
      if (!isActor(c.by)) bad('.crop.by');
      if (c.cycle !== o.cycle) bad(`.crop.cycle ${c.cycle} != plot cycle ${o.cycle}`);
      if (!optCount(c.cut) || !optCount(c.paid)) bad('.crop: cut/paid');
      for (const k of ['packet', 'golden', 'season', 'forced']) {
        if (c[k] !== undefined && !isTrue(c[k])) bad(`.crop.${k}`);
      }
      if (c.water !== undefined && !isActor(c.water)) bad('.crop.water');
      if (c.tend !== undefined && !isPid(c.tend)) bad('.crop.tend');
      if (c.fert !== undefined && !isPid(c.fert)) bad('.crop.fert');
      if (c.giant !== undefined && !(typeof c.giant === 'string' && c.giant.length > 0)) bad('.crop.giant');
      if (c.hp !== undefined && !(isCount(c.hp) && c.hp > 0)) bad('.crop.hp');
      if (c.chop !== undefined && !(isObj(c.chop) && Array.isArray(c.chop.by) && c.chop.by.every(isPid)
        && new Set(c.chop.by).size === c.chop.by.length && isObj(c.chop.last) && isPid(c.chop.last.by)
        && isCount(c.chop.last.at) && (c.chop.hits === undefined || (isObj(c.chop.hits)
          && Object.keys(c.chop.hits).every((p) => isPid(p) && isCount(c.chop.hits[p])))))) bad('.crop.chop');
      break;
    }
    case 'tree':
      if (!isCount(o.cycle) || !isCount(o.cut)) bad('.cycle/cut');
      if (!isCount(o.matureAt) || !isCount(o.startedAt) || !isCount(o.readyAt) || o.readyAt < o.startedAt) {
        bad(': timestamps');
      }
      else if (o.readyAt > horizon) bad(': readyAt in the far future');
      if (o.water !== undefined && !isActor(o.water)) bad('.water');
      if (o.tend !== undefined && !isPid(o.tend)) bad('.tend');
      if (o.compost !== undefined && !isTrue(o.compost)) bad('.compost');
      break;
    case 'animal':
      if (!isCount(o.adultAt) || !isCount(o.cycle) || !isCount(o.cut)) bad(': adultAt/cycle/cut');
      if (!((o.fedAt === null && o.readyAt === null)
        || (isCount(o.fedAt) && isCount(o.readyAt) && o.readyAt >= o.fedAt))) bad(': fedAt/readyAt');
      if (o.baby !== undefined && !isTrue(o.baby)) bad('.baby');
      if (o.bot !== undefined && !(isObj(o.bot) && Object.keys(o.bot).every(isPid)
        && Object.values(o.bot).every(isCount))) bad('.bot');
      if (o.pet !== undefined && !(isObj(o.pet) && isCount(o.pet.day) && Array.isArray(o.pet.by)
        && o.pet.by.length >= 1 && o.pet.by.every(isPid) && new Set(o.pet.by).size === o.pet.by.length)) bad('.pet');
      if (!optCount(o.pb)) bad('.pb');
      if (o.nurse !== undefined && !(isObj(o.nurse) && isCount(o.nurse.n) && o.nurse.n >= 1
        && o.nurse.n <= NURSERY.steps.length && isCount(o.nurse.at) && Array.isArray(o.nurse.by)
        && o.nurse.by.length >= 1
        && o.nurse.by.every(isPid) && new Set(o.nurse.by).size === o.nurse.by.length)) bad('.nurse');
      if ((o.pers === undefined) !== (o.spec === undefined)) bad('.pers/.spec');
      if (o.pers !== undefined && (!NURSERY.personalities.includes(o.pers)
        || !NURSERY.specialties.some((x) => x.id === o.spec) || o.nurse?.n !== NURSERY.steps.length)) {
        bad('.pers/.spec');
      }
      if (o.coat !== undefined && !COAT_RE.test(o.coat)) bad('.coat');
      if (o.bcoat !== undefined && !COAT_RE.test(o.bcoat)) bad('.bcoat');
      if (o.cardBy !== undefined && !isCount(o.cardBy)) bad('.cardBy');
      break;
    case 'home':
      if (!optCount(o.up)) bad('.up');
      break;
    case 'building': {
      if (!optCount(o.xs)) bad('.xs');
      const xs = isCount(o.xs) ? o.xs : 0;
      const [lo, hi] = (def.slots ?? [0, 0]).map((n) => n + xs);
      if (!Number.isSafeInteger(o.slots) || o.slots < lo || o.slots > hi) bad(`.slots ${o.slots} outside ${lo}..${hi}`);
      if (!isCount(o.made)) bad('.made');
      if (!Array.isArray(o.queue) || o.queue.length > (o.slots ?? 0)) { bad('.queue'); break; }
      let prevE = 0;
      o.queue.forEach((q, i) => {
        if (!isObj(q)) { bad(`.queue.${i}`); return; }
        for (const k of Object.keys(q)) if (!QUEUE_FIELDS.has(k)) bad(`.queue.${i}: unknown field ${k}`);
        const r = CONTENT.recipes.get(q.r) ?? CONTENT.feeds.get(q.r);
        if (!r || r.building !== o.def) bad(`.queue.${i}: ${q.r} is not made here`);
        if (!isCount(q.s) || !isCount(q.e) || q.e < q.s || q.s < prevE) bad(`.queue.${i}: timestamps`);
        prevE = q.e;
        if (!isActor(q.by)) bad(`.queue.${i}.by`);
        if (!isObj(q.in) || !Object.entries(q.in).every(([k, n]) => itemOf(k) && isCount(n) && n > 0)) {
          bad(`.queue.${i}.in`);
        }
        for (const k of ['slow', 'duet']) if (q[k] !== undefined && !isTrue(q[k])) bad(`.queue.${i}.${k}`);
        if (q.k !== undefined && !(isCount(q.k) && q.k < (o.qn ?? 0))) bad(`.queue.${i}.k`);
        if (q.pair !== undefined && !(Array.isArray(q.pair) && q.pair.length === 2 && q.pair.every(isPid)
          && q.duet === true)) bad(`.queue.${i}.pair`);
      });
      const keys = o.queue.filter((q) => q.k !== undefined).map((q) => q.k);
      if (new Set(keys).size !== keys.length) bad('.queue: duplicate keys');
      if (!optCount(o.qn)) bad('.qn');
      if (o.joint !== undefined && !(isObj(o.joint) && isPid(o.joint.by) && isCount(o.joint.at)
        && CONTENT.recipes.has(o.joint.r))) bad('.joint');
      if (!optCount(o.pts) || !optCount(o.ready)) bad('.pts/ready');
      break;
    }
    case 'debris':
      if (!['home', 'expansion', 'regrow'].includes(o.origin)) bad('.origin');
      if (o.hp !== undefined && !(isCount(o.hp) && o.hp > 0 && o.hp <= def.hp)) bad('.hp');
      if (o.lastChop !== undefined && !(isObj(o.lastChop) && isPid(o.lastChop.by) && isCount(o.lastChop.at))) {
        bad('.lastChop');
      }
      if (o.team !== undefined && !(Array.isArray(o.team) && o.team.length === 2 && o.team.every(isPid)
        && o.team[0] < o.team[1])) bad('.team');
      break;
    case 'decor':
      if (o.mw !== undefined && !(o.mw === 1 || o.mw === 2)) bad('.mw');
      if (o.up !== undefined) upOk(o, def, bad);
      break;
    case 'landmark':
      if (o.up !== undefined) upOk(o, def, bad);
      break;
    case 'crate':
      if (!Number.isSafeInteger(o.k) || !isCount(o.until) || o.by !== 'sys') bad('.k/until/by');
      break;
    default:
      break;
  }
  return out;
}

/** An upgrade count (wave 4, upgrades.js): 1..the target's tiers, on an upgradable def only. */
function upOk(o, def, bad) {
  const t = upgradeTargetOf(def.id);
  if (!t || !isCount(o.up) || o.up < 1 || o.up > (UPGRADES[t].tiers?.length ?? 0)) bad('.up');
}

const positiveMap = (o, ok) => isObj(o) && Object.entries(o).every(([k, n]) => ok(k) && isCount(n) && n > 0);

/**
 * The farm-level economy fields (wave 1):
 *   barn       Barn upgrades bought (0..)                 storage  { defId: n } the build tray
 *   storagePaid { defId: n } how many of the tray copies were PAID for (stored decor, Wishlist buys): placed again
 *              they carry `paid` = the def's shop price, so resale stays honest; gifts and starter decor carry none
 *   keep       { item: { n, by } } Keep N                 trash    { objId: { obj, until, by, coins, acorns } }
 *   demand     { day, n: { item: units } } Market Demand units sold on `day`
 *   tools      { toolId: 1 } brush tools bought           seeds    { crop: n } free plantings (packets, basket)
 *   golden     Golden Seeds owned                         proofs   { expansionId: { at, n: { taskIndex: count } } }
 *   noFeed     { item: true } kept out of the Feed Mill's ingredient classes (Barn panel toggle)
 *   regrow     { at } debris regrowth clock               basketDay  last day Grandma's seed basket was given
 *   rain       { at } the last weather hour whose rain was applied (time.js weatherAt)
 *   wishlist   { wishId: { def, coins, by, at, release? { by, at } } }
 */
function validateEconomy(f, bad) {
  // the last "Sell surplus", undoable for 10 minutes (RC-25); absent in older saves
  const u = f.surplus;
  if (u !== undefined && u !== null && !(isObj(u) && isCount(u.at) && isCount(u.until) && isActor(u.by)
    && isCount(u.coins) && Array.isArray(u.rows) && u.rows.every((r) => isObj(r) && itemOf(r.item) && isCount(r.qty)
    && r.qty > 0 && isCount(r.coins)))) bad('farm.surplus');
  if (!isCount(f.barn) || f.barn > CONTENT.barn.length) bad('farm.barn');
  if (!positiveMap(f.storage, (k) => Boolean(defOf(k)))) bad('farm.storage');
  if (!positiveMap(f.storagePaid, (k) => Boolean(defOf(k)))
    || !Object.entries(f.storagePaid ?? {}).every(([k, n]) => n <= (f.storage?.[k] ?? 0))) {
    bad('farm.storagePaid: more paid copies than copies in the tray');
  }
  const keepOk = ([k, v]) => itemOf(k) && isObj(v) && isCount(v.n) && isActor(v.by);
  if (!isObj(f.keep) || !Object.entries(f.keep).every(keepOk)) bad('farm.keep');
  if (!isObj(f.trash)) bad('farm.trash');
  else {
    for (const [id, t] of Object.entries(f.trash)) {
      // wave 4: a tray copy sold with sellStored: { tray: defId, paid: bool, until, by, coins, acorns } (no obj)
      if (isObj(t) && t.tray !== undefined) {
        if (defOf(t.tray)?.kind !== 'decor' || typeof t.paid !== 'boolean' || !isCount(t.until) || !isActor(t.by)
          || !isCount(t.coins) || !isCount(t.acorns) || Object.keys(t).length !== 6) bad(`farm.trash.${id}`);
        continue;
      }
      if (!isObj(t) || !isObj(t.obj) || !defOf(t.obj.def) || !isCount(t.until) || !isActor(t.by) || !isCount(t.coins)
        || !isCount(t.acorns)) bad(`farm.trash.${id}`);
      else for (const p of objectProblems(t.obj, defOf(t.obj.def))) bad(`farm.trash.${id}.obj${p}`);
    }
  }
  if (!isObj(f.demand) || !isCount(f.demand.day) || !positiveMap(f.demand.n, (k) => Boolean(itemOf(k)))) {
    bad('farm.demand');
  }
  if (!isObj(f.tools) || !Object.entries(f.tools).every(([k, v]) => CONTENT.tools.has(k) && v === 1)) bad('farm.tools');
  if (!positiveMap(f.seeds, (k) => Boolean(cropOf(k)))) bad('farm.seeds');
  if (!isCount(f.golden)) bad('farm.golden');
  if (!isObj(f.proofs) || !Object.entries(f.proofs).every(([k, v]) => CONTENT.expansions.has(k) && isObj(v)
    && isCount(v.at) && isObj(v.n) && Object.values(v.n).every(isCount))) bad('farm.proofs');
  if (!isObj(f.noFeed) || !Object.entries(f.noFeed).every(([k, v]) => itemOf(k) && v === true)) bad('farm.noFeed');
  if (!isObj(f.regrow) || !isCount(f.regrow.at)) bad('farm.regrow');
  if (!isObj(f.rain) || !isCount(f.rain.at)) bad('farm.rain');
  if (!isCount(f.basketDay)) bad('farm.basketDay');
  if (!isObj(f.wishlist)) bad('farm.wishlist');
  else {
    for (const [id, w] of Object.entries(f.wishlist)) {
      if (!isObj(w) || !defOf(w.def) || !isCount(w.coins) || !isPid(w.by) || !isCount(w.at)
        || (w.release !== undefined && !(isObj(w.release) && isPid(w.release.by) && isCount(w.release.at)))) {
        bad(`farm.wishlist.${id}`);
      }
    }
  }
  validateM1b(f, bad);
  validateW4b(f, bad);
}

/**
 * The wave-4b farm fields (both absent in older saves until the boot's backfill adds them):
 *   relics  { relicId: { at, by, d? } }   the Acorn shop's unique items bought (relics.js); d = the farm day a
 *           once-a-day relic was last used
 *   crates  { k, n }   the last balloon pass handled (any integer) and the crates dropped so far (actions/crates.js)
 */
function validateW4b(f, bad) {
  if (f.relics !== undefined && !(isObj(f.relics) && Object.entries(f.relics).every(([k, r]) => relicOf(k)
    && isObj(r) && isCount(r.at) && isActor(r.by) && (r.d === undefined || isCount(r.d))
    && Object.keys(r).every((x) => x === 'at' || x === 'by' || x === 'd')))) bad('farm.relics');
  if (f.crates !== undefined && !(isObj(f.crates) && Number.isSafeInteger(f.crates.k) && isCount(f.crates.n)
    && Object.keys(f.crates).length === 2)) bad('farm.crates');
}

/**
 * The wave-2 (M1b) farm fields:
 *   beauty   { stars, sets: { setId: at } }  Farm Beauty stars PAID so far (a high-water mark: each star's Acorns
 *            are paid once) and the decor sets completed at least once (actions/beauty.js)
 *   restore  { projectId: { s: { bundleId: { slot: { n, by: { pid: n } } } }, b: { bundleId: at }, done?: at,
 *              f?: { bundleId: { slot: pid } } } }   (f: "Need help" flags, restoreFlag)
 *            the Restoration Ledger: units / coins given per slot and by whom, completed bundles
 *            (actions/restoration.js)
 *   town     { n, cur: null | { id, n, at, lvl, goods: [{ item, qty, got, by }], coins, paid, by, buildAt? } }
 *            Town Projects built so far and the one Ollie has posted (actions/town.js)
 */
/**
 * A player's pet: null or { kind, name, at, fed: day | null, pets: { day, by } | null, treasure: day | null, breed? }
 * (breed: wave 4, one of the kind's breeds).
 */
function petOk(pet) {
  if (pet === null) return true;
  if (isObj(pet) && pet.breed !== undefined && !breedOk(pet.kind, pet.breed)) return false;
  const dayOrNull = (v) => v === null || isCount(v);
  return isObj(pet) && PETS.kinds.some((k) => k.id === pet.kind) && typeof pet.name === 'string' && pet.name.length > 0
    && pet.name.length <= 16 && isCount(pet.at) && dayOrNull(pet.fed) && dayOrNull(pet.treasure)
    && (pet.pets === null || (isObj(pet.pets) && isCount(pet.pets.day) && Array.isArray(pet.pets.by)
      && pet.pets.by.length >= 1 && pet.pets.by.every(isPid) && new Set(pet.pets.by).size === pet.pets.by.length))
    && Object.keys(pet).length === (pet.breed === undefined ? 6 : 7);
}

function validateM1b(f, bad) {
  const byOk = (o) => isObj(o) && Object.entries(o).every(([k, n]) => isActor(k) && isCount(n) && n > 0);
  const b = f.beauty;
  if (!isObj(b) || !isCount(b.stars) || b.stars > 5 || !isObj(b.sets)
    || !Object.entries(b.sets).every(([k, v]) => CONTENT.decorSets.has(k) && isCount(v))) bad('farm.beauty');
  if (!isObj(f.restore)) bad('farm.restore');
  else {
    for (const [pid, r] of Object.entries(f.restore)) {
      const p = CONTENT.restoration.get(pid);
      if (!p || !isObj(r) || !isObj(r.s) || !isObj(r.b) || (r.done !== undefined && !isCount(r.done))) {
        bad(`farm.restore.${pid}`);
        continue;
      }
      for (const [bid, slots] of Object.entries(r.s)) {
        const bd = p.bundles.find((x) => x.id === bid);
        if (!bd || !isObj(slots)) { bad(`farm.restore.${pid}.s.${bid}`); continue; }
        for (const [k, v] of Object.entries(slots)) {
          const i = Number(k);
          if (String(i) !== k || !bd.slots[i] || !isObj(v) || !isCount(v.n) || v.n === 0 || !byOk(v.by)
            || Object.values(v.by).reduce((a, n) => a + n, 0) !== v.n) bad(`farm.restore.${pid}.s.${bid}.${k}`);
        }
      }
      for (const [bid, at] of Object.entries(r.b)) {
        if (!p.bundles.some((x) => x.id === bid) || !isCount(at)) bad(`farm.restore.${pid}.b.${bid}`);
      }
      if (r.f !== undefined && (!isObj(r.f) || !Object.entries(r.f).every(([bid, fl]) => {
        const bd = p.bundles.find((x) => x.id === bid);
        return bd && isObj(fl) && Object.entries(fl).every(([k, v]) => bd.slots[Number(k)] && String(Number(k)) === k
          && isPid(v));
      }))) bad(`farm.restore.${pid}.f`);
    }
  }
  const t = f.town;
  if (!isObj(t) || !isCount(t.n)) bad('farm.town');
  else if (t.cur !== null) {
    const c = t.cur;
    const ok = isObj(c) && (CONTENT.townProjects.has(c.id) || c.id === TOWN_PROJECT_RULES.repeatable) && isCount(c.n)
      && c.n >= 1 && isCount(c.at) && isCount(c.lvl)
      && Array.isArray(c.goods) && c.goods.every((g) => isObj(g) && itemOf(g.item) && isCount(g.qty) && g.qty > 0
        && isCount(g.got) && g.got <= g.qty && isObj(g.by))
      && isCount(c.coins) && isCount(c.paid) && c.paid <= c.coins && isObj(c.by)
      && (c.buildAt === undefined || isCount(c.buildAt));
    if (!ok) bad('farm.town.cur');
  }
  validateM2(f, bad);
  validateW4(f, bad);
}

/** The wave-4 farm fields: weeds { t: { 'x,z': 1 }, day, n } (actions/weeds.js: weeded tiles, paid tiles today). */
function validateW4(f, bad) {
  const w = f.weeds;
  if (!isObj(w) || !isObj(w.t) || !isCount(w.day) || !isCount(w.n)
    || !Object.entries(w.t).every(([k, v]) => v === 1 && /^\d{1,3},\d{1,3}$/.test(k))) bad('farm.weeds');
}

/** A player's Fishing Dock record: { cast: null | { spot, at, bite, done? }, at, day } (actions/fishing.js). */
function fishOk(v) {
  return isObj(v) && isCount(v.at) && isCount(v.day) && Object.keys(v).length === 3 && (v.cast === null
    || (isObj(v.cast) && typeof v.cast.spot === 'string' && v.cast.spot.length > 0 && v.cast.spot.length <= 40
      && isCount(v.cast.at) && isCount(v.cast.bite) && v.cast.bite >= v.cast.at
      && (v.cast.done === undefined || v.cast.done === true)
      && Object.keys(v.cast).length === (v.cast.done ? 4 : 3)));
}

/**
 * The wave-3 (M2) farm fields:
 *   breed     { cur: null | { sp, a, b, at, readyAt, by, cost: { item, qty } }, n: { sp: count }, pity: { sp: n } }
 *             the Breeding Barn's running breeding and its per-species counters (actions/breeding.js)
 *   fishing   { records: { fish: { cm, by, at } }, week: { n, best: null | { fish, cm, by, at } }, n }
 *             the dock's trophy board, the week's biggest catch and the catches so far (actions/fishing.js)
 *   interior  { items: { iid: { def, by, placedAt, x?, z?, rot?, wall?, at?, paid?, rcpt? } }, tray: { def: n } }
 *             the farmhouse room (actions/interior.js)
 */
function validateM2(f, bad) {
  const br = f.breed;
  const spOk = (k) => Boolean(animalOf(k));
  if (!isObj(br) || !isObj(br.n) || !isObj(br.pity) || !Object.entries(br.n).every(([k, n]) => spOk(k) && isCount(n))
    || !Object.entries(br.pity).every(([k, n]) => spOk(k) && isCount(n) && n < (BREEDING.goldenPity ?? Infinity))) {
    bad('farm.breed');
  } else if (br.cur !== null) {
    const c = br.cur;
    if (!(isObj(c) && spOk(c.sp) && typeof c.a === 'string' && typeof c.b === 'string' && c.a !== c.b && isCount(c.at)
      && isCount(c.readyAt) && c.readyAt >= c.at && isPid(c.by) && isObj(c.cost) && itemOf(c.cost.item)
      && isCount(c.cost.qty))) bad('farm.breed.cur');
  }
  const fi = f.fishing;
  const catchOk = (v) => isObj(v) && isCount(v.cm) && v.cm > 0 && isPid(v.by) && isCount(v.at);
  const fishIds = new Set((FISHING?.fish ?? []).map((x) => x.id));
  if (!isObj(fi) || !isCount(fi.n) || !isObj(fi.records) || !isObj(fi.week) || !isCount(fi.week.n)
    || !Object.entries(fi.records).every(([k, v]) => fishIds.has(k) && catchOk(v))
    || !(fi.week.best === null || (catchOk(fi.week.best) && fishIds.has(fi.week.best.fish)))) bad('farm.fishing');
  const inn = f.interior;
  if (!isObj(inn) || !isObj(inn.items) || !isObj(inn.tray)) { bad('farm.interior'); return; }
  const furn = (id) => CONTENT.furniture?.get?.(id) ?? null;
  for (const [k, n] of Object.entries(inn.tray)) if (!furn(k) || !isCount(n) || n === 0) bad(`farm.interior.tray.${k}`);
  const [gw, gd] = INTERIOR?.grid ?? [0, 0];
  const taken = new Map();
  for (const [iid, it] of Object.entries(inn.items)) {
    const d = isObj(it) ? furn(it.def) : null;
    if (!/^[a-z0-9.]{1,40}$/.test(iid) || !d || !isActor(it.by) || !isCount(it.placedAt)
      || (it.paid !== undefined && !isCount(it.paid))
      || (it.rcpt !== undefined && !(isObj(it.rcpt) && isCount(it.rcpt.coins) && isCount(it.rcpt.until)))) {
      bad(`farm.interior.items.${iid}`);
      continue;
    }
    for (const [layer, cells] of interiorCells(d, it)) {
      for (const [x, z] of cells) {
        const key = `${layer}:${x},${z}`;
        const inside = layer === 'wall' ? x >= 0 && x < (INTERIOR.walls?.[z] ?? 0)
          : x >= 0 && z >= 0 && x < gw && z < gd;
        if (!inside) bad(`farm.interior.items.${iid}: outside the room at ${key}`);
        if (taken.has(key)) bad(`farm.interior.items.${iid} overlaps ${taken.get(key)} at ${key}`);
        taken.set(key, iid);
      }
    }
  }
}


