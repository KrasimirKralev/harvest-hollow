// Animals (GDD §3.4 rules 1-9, §3.7 tools, §6.2 #13, §9 #5, #33, #52): buy babies or adults into their homes,
// tend (collect the product + re-feed in one stroke; `feed` and `collect` are the split versions of Settings),
// bottles, petting by drag, home capacity upgrades, blue ribbons with their goods, the Compost Bin's points.
// Owned by rules-economy.
//
// Animal record (layer 'none', lives in `home`): { def, home, placedAt, by, adultAt, fedAt, readyAt, cycle, cut,
//   pet?, paid?, rcpt?, free? }
//   adultAt      when the baby is grown (adults: the purchase time); a Baby Bottle cuts 30 % of what remains, never
//                below 50 % of the whole growth from the purchase, once per player per hour
//   bot          { [pid]: at } each player's last bottle for this baby (the hourly limit; RC-03)
//   fedAt/readyAt  the running cycle (null = hungry); the product waits ON the animal until collected (rule 4)
//   cycle        collections so far: the rng key of every roll, and the blue ribbon at def.prizedAt (rule 7)
//   pet          { day, by: [pids] }: petted today (farm calendar) by these players (+10 % / +20 % bonus product)
//   pb           M2 partner bottle: when the last partner bottle cut its extra 20 % (once per baby per hour)
//   nurse/pers/spec, coat, name   M2 Nursery card and picks, Breeding Barn coat, the couple's name (breeding.js)
//
// M2 perks (GDD §4.7, rules-goals' picks, economy.playerPerk; only the acting player's own): Rancher babies grow 15 %
// faster (bought by them), 5 % double product and 10 % free feed on their tends, the blue-ribbon good 20 % sooner on
// their collections. Nursery specialties: Bountiful +5 % bonus product, Tidy +1 Compost Bin point a collection.
import {
  animalOf, defOf, cropOf, isLive, CONTENT, GROWTH, COOP, MARKET, SAFETY, BARGE, NURSERY, HOME_GROWTH,
} from '../../content/index.js';
import { ERR, SOFT } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import {
  objectOf, occupantsOf, capacityOf, idsAround, objFootprint, capOf, homeMaxOf, homeSizeAt, capTier, growthOf,
  canFit, tilesOfSize, getGrid, inWorld, inLand,
} from '../grid.js';
import { WORLD_TILES } from '../../content/config.js';
import { relicLuckBp } from '../relics.js';
import { sortedKeys } from '../order.js';
import { isReady } from '../time.js';
import { dayIndex } from '../calendar.js';
import {
  grow, intake, consume, available, unkept, stockOf, overflowOf, barnCap, mulBp, levelOf, starsOf, masteryEffects,
  startCutBp, cutMs, planBatch, targetsOf, oneTarget, MAX_BATCH, proofDeed, PRICE_SEEN, ERR_PRICE, collectionPerk,
  projectDone, setPerkSource, setPlayerPerkSource, useReceipts, playerPerk,
} from '../economy.js';
import { restoreDeed } from './restoration.js';
import { perkOf } from './album.js';
import { perkValue } from './perks.js';

// collection perks come from rules-goals' album, player perks from rules-goals' perk picks (economy.js: why hooks)
setPerkSource(perkOf);
setPlayerPerkSource(perkValue);
import { boughtCount, payCode, pay } from './decor.js';
import { goldenHourBp } from '../coop.js';
import { takeOwed } from './quests.js';

const STROKE = { id: V.opt(V.objId), ids: V.opt(V.list(V.objId, MAX_BATCH)) };
const isAnimal = (o) => Boolean(o) && defOf(o.def)?.layer === 'none';
const isHome = (o) => Boolean(o) && defOf(o.def)?.kind === 'home';

// ---- bees: colonies, forage, pollination (GDD §3.4 Bees, §3.2 rule 10, §3.8 forage decor) ------------------------

/** True for a colony species (Bee Colony): it lives in its hive from the hive's placement and eats nothing. */
export const isColonyDef = (def) => Boolean(def) && def.layer === 'none' && def.feed === null;
/** True when animal object `o` is a colony. */
export const isColony = (o) => Boolean(o) && isColonyDef(animalOf(o.def));
/** The colony species a home def houses (the Beehive's Bee Colony), or null. */
export function colonyOf(homeDef) {
  const sp = homeDef && Array.isArray(homeDef.species) ? animalOf(homeDef.species[0]) : null;
  return isColonyDef(sp) && isLive(sp) ? sp : null;
}

const rectOfObj = (o) => {
  const [w, d] = objFootprint(o);
  return { x: o.x, z: o.z, w, d };
};
const rectGap = (a, b) => Math.max(0, a.x - (b.x + b.w - 1), b.x - (a.x + a.w - 1), a.z - (b.z + b.d - 1),
  b.z - (a.z + a.d - 1));

/** Forage value of one grid object: flower decor (its `forage`), flowering trees, a plot growing a flower crop. */
export function forageOfObject(o) {
  const def = defOf(o.def);
  if (!def) return 0;
  if (def.kind === 'tree') return def.flowering ? 1 : 0;           // GDD §3.2 "Bee forage": Pine, Walnut, Maple no
  if (def.kind === 'plot') return o.crop && cropOf(o.crop.def)?.archetype === 'flower' ? 1 : 0;
  const f = def.effect && def.effect.forage;
  return Number.isSafeInteger(f) && f > 0 ? f : 0;
}

/**
 * Forage objects within the bees' radius of hive `homeId` (GDD §3.4: within 4 tiles, +1 with the Honey Jars set),
 * plus the Hollow Meadow's wildflowers (Stone Bridge, forage x3) when the hive is within reach of that land.
 */
export function forageNear(state, homeId, used = null) {
  const h = objectOf(state, homeId);
  if (!h) return 0;
  const me = rectOfObj(h);
  const r = GROWTH.bees.radius + collectionPerk(state, 'forageRadius');
  let n = 0;
  for (const id of idsAround(state, me.x, me.z, me.w, me.d, r)) {
    if (id === homeId) continue;
    const o = state.farm.objects[id];
    if (rectGap(me, rectOfObj(o)) > r) continue;
    const f = forageOfObject(o);
    n += f;
    if (used && f > 0) used.add(id);                   // forage this colony's cycle used (RC-08 receipts)
  }
  for (const p of CONTENT.restoration.values()) {
    const land = p.reward && p.reward.land;
    if (!land || !land.forage || !isLive(p) || !projectDone(state, p.id)) continue;
    if (land.rects.some(([x, z, w, d]) => rectGap(me, { x, z, w, d }) <= r)) n += land.forage;
  }
  return n;
}

/** A colony's cycle length if it started now: 6 h with >= 3 forage objects near its hive, else 12 h (§3.4). */
export function colonyCycleMs(state, homeId, def) {
  return forageNear(state, homeId) >= GROWTH.bees.forageNeeded ? def.cycleMs : GROWTH.bees.slowCycleMs;
}

/** Start colony `id`'s next cycle now (fixed at start: forage, mastery ★2, Golden Hour). */
function startColony(tx, ctx, id) {
  const o = tx.get(['farm', 'objects', id]);
  const def = animalOf(o.def);
  const used = new Set();
  const forage = forageNear(tx.state, o.home, used);
  if (forage >= GROWTH.bees.forageNeeded) useReceipts(tx, used);
  const base = forage >= GROWTH.bees.forageNeeded ? def.cycleMs : GROWTH.bees.slowCycleMs;
  const cut = startCutBp(tx.state, o.def, ctx.now);
  const ms = cutMs(base, cut);
  tx.set(['farm', 'objects', id, 'fedAt'], ctx.now);
  tx.set(['farm', 'objects', id, 'readyAt'], ctx.now + ms);
  tx.set(['farm', 'objects', id, 'cut'], cut);
  tx.emit({ e: 'colonyCycle', id, home: o.home, forage, ms });
}

/**
 * Move a colony into a freshly placed hive `homeId` (bought, from the tray, or the Bee Glade's wild hive) and start
 * its first cycle. `id` is the colony's object id (the placing action's newId(1); `${hive}.b` for land gifts).
 */
export function addColony(tx, ctx, homeId, id) {
  const def = colonyOf(defOf(tx.get(['farm', 'objects', homeId]).def));
  if (!def || objectOf(tx.state, id)) return false;
  tx.set(['farm', 'objects', id], { def: def.id, home: homeId, placedAt: ctx.now, by: ctx.pid, adultAt: ctx.now,
    fedAt: null, readyAt: null, cycle: 0, cut: 0, free: true });
  tx.emit({ e: 'bought', id, def: def.id, kind: 'animal', home: homeId, adult: true, by: ctx.pid, coins: 0,
    free: true });
  startColony(tx, ctx, id);
  return true;
}

/**
 * True when a hive with its colony stands within the bees' radius of object `o` (a plot or a tree): pollination,
 * +5 % bonus-unit chance (GDD §3.4; at most one hive effect per object, so one roll however many hives).
 */
export function pollinated(state, o, used = null) {
  if (!isLive(GROWTH.bees)) return false;
  const me = rectOfObj(o);
  const r = GROWTH.bees.radius;
  for (const id of idsAround(state, me.x, me.z, me.w, me.d, r)) {
    const h = state.farm.objects[id];
    if (!colonyOf(defOf(h.def)) || occupantsOf(state, id).length === 0) continue;
    if (rectGap(me, rectOfObj(h)) <= r) {
      if (used) used.add(id);                          // the hive whose bees pollinate it (RC-08 receipts)
      return true;
    }
  }
  return false;
}

/** River Barge payout bonus from adult horses (GDD §3.4 Horse: +5 % each, at most +20 %), for rules-goals' barge. */
export function horseBargeBp(state, now, used = null) {
  const most = Math.floor(BARGE.horseMaxBp / BARGE.horseBp);
  const horses = [];
  const objs = state.farm.objects;
  for (const id of Object.keys(objs)) {
    const o = objs[id];
    if (o.home !== undefined && animalOf(o.def)?.id === 'horse' && o.adultAt <= now) horses.push(id);
  }
  // the horses that pull this crate (RC-08 receipts): the first `most` in id order
  if (used) for (const id of horses.sort().slice(0, most)) used.add(id);
  return Math.min(BARGE.horseMaxBp, Math.min(most, horses.length) * BARGE.horseBp);
}

/** A stroke's animals: animal ids as given, a home id stands for its occupants (sorted); each animal once. */
export function animalsOf(state, ids) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const o = objectOf(state, id);
    const list = isHome(o) ? occupantsOf(state, id) : [id];
    for (const x of list) if (!seen.has(x)) { seen.add(x); out.push(x); }
  }
  return out;
}

/** Homes of `def`'s species with room, sorted by id (index.js rule 3). */
export function homesWithRoom(state, animalDef) {
  const out = [];
  for (const id of sortedKeys(state.farm.objects)) {
    const o = state.farm.objects[id];
    if (animalDef.homes.includes(o.def) && occupantsOf(state, id).length < capacityOf(state, id)) out.push(id);
  }
  return out;
}

/** An unused id of the i-th or later object this action creates (actions that create a varying number). */
function freshId(state, ctx, from) {
  for (let i = from; ; i++) if (!objectOf(state, ctx.newId(i))) return [ctx.newId(i), i];
}

/**
 * Free adult animals of `species` into homes with room (quest gifts, GDD §5.3 A3). Returns how many it placed;
 * the caller keeps the rest owed. Ids are this action's newId(1..), never colliding with what it already created.
 */
export function giveAnimals(tx, ctx, species, n) {
  const def = animalOf(species);
  if (!def || !(n > 0)) return 0;
  let placed = 0;
  let next = 1;
  while (placed < n) {
    const homes = homesWithRoom(tx.state, def);
    if (homes.length === 0) break;
    const [id, i] = freshId(tx.state, ctx, next);
    next = i + 1;
    tx.set(['farm', 'objects', id], { def: species, home: homes[0], placedAt: ctx.now, by: ctx.pid, adultAt: ctx.now,
      fedAt: null, readyAt: null, cycle: 0, cut: 0, free: true });
    tx.emit({ e: 'bought', id, def: species, kind: 'animal', home: homes[0], adult: true, by: ctx.pid, coins: 0,
      free: true });
    placed++;
  }
  return placed;
}

/** Move animals a quest card owes (rules-goals' farm.quests.owed) into homes that have room now. */
export function settleOwed(tx, ctx) {
  const owed = tx.state.farm.quests && tx.state.farm.quests.owed;
  if (!owed || typeof owed !== 'object') return;
  for (const sp of sortedKeys(owed)) {
    const k = giveAnimals(tx, ctx, sp, owed[sp]);
    if (k > 0) takeOwed(tx, sp, k);
  }
}

// ---- buy ------------------------------------------------------------------------------------------------------

/**
 * How long a baby of `def` started now by `ctx.pid` grows: the baby time less Golden Hour (a start) and the buyer's
 * Rancher perk (babies grow 15 % faster), with the 50 % floor. Bought and bred babies alike.
 */
export function babyGrowMs(state, def, ctx) {
  return cutMs(def.babyMs, goldenHourBp(state, ctx.now) + playerPerk(state, ctx.pid, 'rancher', 'babyBp'));
}

/**
 * The price of the n-th animal of a species (baby or adult, GDD §3.4 rule 2; gifts are not counted). A species with
 * a `first` price sells its first bought copy for it (the first-evening hen, RC-28); copy 2+ follow the curve.
 */
export function animalPrice(state, species, adult) {
  const def = animalOf(species);
  const n = boughtCount(state, species) + 1;
  if (n === 1 && def.first) return adult ? def.first.adult : def.first.baby;
  return grow(adult ? def.adult : def.baby, def.growthBp, n);
}

// ---- homes that grow with their flock (wave 4b, owner wish 3; content HOME_GROWTH) --------------------------------

/**
 * The next room step of home `id` (pure; the buy and upgrade actions and the panels share it):
 *   { id, cap, next, max, coins, size, nextSize, grows, x, z, rot, code, blockers }
 * cap / next: animals it holds now / after the step; coins: the step's price (the def's upgradeCost x the NEW tier's
 * HOME_GROWTH.stepCostBp); size / nextSize: [w, d] at rot 0; grows: the step needs the bigger footprint, which then
 * stands at (x, z) (the first anchor, in a fixed order, whose rectangle contains the old one and fits: the home grows
 * around itself). code: null, CAP (full grown / not upgradable), BLOCKED or OUT_OF_BOUNDS (no anchor fits; blockers =
 * the ids standing in the way of the preferred anchor, sorted, so a card can say what is in the way).
 */
export function homeGrowth(state, id) {
  const o = objectOf(state, id);
  const def = o && defOf(o.def);
  const size0 = def?.size ?? [1, 1];
  const no = (code) => ({ id, cap: 0, next: 0, max: 0, coins: 0, size: size0, nextSize: size0, grows: false,
    x: o?.x ?? 0, z: o?.z ?? 0, rot: o?.rot ?? 0, code, blockers: [] });
  if (!isHome(o)) return no(ERR.NOT_FOUND);
  const cap = capOf(o, def);
  const max = homeMaxOf(def);
  const base = { ...no(null), cap, max, size: homeSizeAt(def, cap) };
  if (!(def.upgradeStep > 0) || !Number.isSafeInteger(max) || cap >= max) return { ...base, code: ERR.CAP, next: cap };
  const next = Math.min(cap + def.upgradeStep, max);
  const g = growthOf(def.id);
  const coins = g ? Math.floor((def.upgradeCost * HOME_GROWTH.stepCostBp[capTier(def, next)]) / 10_000)
    : def.upgradeCost;
  const nextSize = homeSizeAt(def, next);
  const out = { ...base, next, coins, nextSize };
  if (capTier(def, next) === capTier(def, cap)) return out;
  // the bigger footprint must contain the old one: dx, dz shift the anchor left / up by at most the growth
  const [fw, fd] = (o.rot ?? 0) % 2 ? [base.size[1], base.size[0]] : base.size;
  const [nw, nd] = (o.rot ?? 0) % 2 ? [nextSize[1], nextSize[0]] : nextSize;
  // first the anchor that keeps the house still: the grown models keep it in the pen's back-left corner, which is
  // the anchor corner only at rot 0 (the view turns a home by +rot x 90 degrees about y)
  const gw = nw - fw;
  const gd = nd - fd;
  const [px, pz] = [[0, 0], [0, -gd], [-gw, -gd], [-gw, 0]][((o.rot ?? 0) % 4 + 4) % 4];
  if (canFit(state, o.def, o.x + px, o.z + pz, o.rot ?? 0, id, nextSize) === null) {
    return { ...out, grows: true, x: o.x + px, z: o.z + pz };
  }
  for (let dz = 0; dz >= fd - nd; dz--) {
    for (let dx = 0; dx >= fw - nw; dx--) {
      if (canFit(state, o.def, o.x + dx, o.z + dz, o.rot ?? 0, id, nextSize) === null) {
        return { ...out, grows: true, x: o.x + dx, z: o.z + dz };
      }
    }
  }
  // what stands in the way of the preferred anchor, on the home's own layer (a path under it is no obstacle)
  const blockers = new Set();
  let outside = false;
  const layer = getGrid(state)[def.layer];
  for (const [tx, tz] of tilesOfSize(nextSize, o.x, o.z, o.rot ?? 0)) {
    if (!inWorld(tx, tz) || !inLand(state, tx, tz)) { outside = true; continue; }
    const who = layer[tz * WORLD_TILES + tx];
    if (who !== null && who !== id) blockers.add(who);
  }
  return { ...out, grows: true, code: blockers.size || !outside ? ERR.BLOCKED : ERR.OUT_OF_BOUNDS,
    blockers: [...blockers].sort() };
}

/** Take home `id` one room step on (`plan` = homeGrowth now): `up` + 1 and, when it grows, its new anchor. */
function growHome(tx, ctx, id, plan) {
  const o = tx.get(['farm', 'objects', id]);
  const up = (o.up ?? 0) + 1;
  tx.set(['farm', 'objects', id, 'up'], up);
  if (plan.grows && o.x !== plan.x) tx.set(['farm', 'objects', id, 'x'], plan.x);
  if (plan.grows && o.z !== plan.z) tx.set(['farm', 'objects', id, 'z'], plan.z);
  tx.del(['farm', 'objects', id, 'rcpt']);
  tx.emit({ e: 'homeGrew', id, def: o.def, capacity: plan.next, size: plan.nextSize, grows: plan.grows, x: plan.x,
    z: plan.z, coins: plan.coins, by: ctx.pid });
}

/**
 * Where buying one `def` goes: a home with room, else the first home of its species (id order) that can take one
 * more room step (its price folded into the purchase: `grow` = that homeGrowth). { home, grow? } or { code, blocked? }
 * (CAP when every home is full grown, BLOCKED / OUT_OF_BOUNDS when growing is in the way: `blocked` = that home's id;
 * NOT_FOUND without a home).
 */
function buyHome(state, a, def) {
  if (a.home === undefined) {
    const homes = homesWithRoom(state, def);
    if (homes.length) return { home: homes[0] };
    const own = sortedKeys(state.farm.objects).filter((id) => def.homes.includes(state.farm.objects[id].def));
    if (!own.length) return { code: ERR.NOT_FOUND };
    let first = null;
    for (const id of own) {
      const g = homeGrowth(state, id);
      if (g.code === null) return { home: id, grow: g };
      if (g.code !== ERR.CAP) first ??= { code: g.code, blocked: id };
    }
    return first ?? { code: ERR.CAP };
  }
  const h = objectOf(state, a.home);
  if (!h || !def.homes.includes(h.def)) return { code: ERR.NOT_FOUND };
  if (occupantsOf(state, a.home).length >= capacityOf(state, a.home)) {
    const g = homeGrowth(state, a.home);
    if (g.code === null) return { home: a.home, grow: g };
    return g.code === ERR.CAP ? { code: g.code } : { code: g.code, blocked: a.home };
  }
  return { home: a.home };
}

/**
 * What buying one `species` (adult or baby) costs now and where it goes (pure; the shop's price line): { coins, animal,
 * step, home, grow, code, blocked }. coins = the animal + the folded room step when its home has to grow; blocked = the
 * home that is full and cannot grow (code BLOCKED / OUT_OF_BOUNDS: its homeGrowth names what is in the way), else null.
 */
export function animalBuyPlan(state, species, adult = false, home = undefined) {
  const def = animalOf(species);
  if (!def) return { coins: 0, animal: 0, step: 0, home: null, grow: null, code: ERR.NOT_FOUND };
  const h = buyHome(state, home === undefined ? {} : { home }, def);
  const animal = animalPrice(state, species, adult);
  const step = h.grow ? h.grow.coins : 0;
  return { coins: animal + step, animal, step, home: h.home ?? null, grow: h.grow ?? null, code: h.code ?? null,
    blocked: h.blocked ?? null };
}

export const buyAnimal = {
  schema: { def: V.content('animals'), adult: V.opt(V.bool), home: V.opt(V.objId), max: V.opt(PRICE_SEEN) },
  check(state, a, ctx) {
    const def = animalOf(a.def);
    if (def.retired || def.shop === false || levelOf(state) < def.unlock) return ERR.LOCKED;
    const h = buyHome(state, a, def);
    if (h.code) return h.code;
    if (objectOf(state, ctx.newId(0))) return ERR.ID_TAKEN;
    // a full home grows one room step with the purchase (wave 4b): the step's price is part of the price shown
    const coins = animalPrice(state, a.def, a.adult === true) + (h.grow ? h.grow.coins : 0);
    // the partner bought one first: the n-th copy now costs more than the price on this player's screen (RC-18)
    if (a.max !== undefined && coins > a.max && !confirmed(a, ERR_PRICE)) return ERR_PRICE;
    return payCode(state, a, ctx, { coins, acorns: 0 });
  },
  apply(tx, a, ctx) {
    const def = animalOf(a.def);
    const adult = a.adult === true;
    const { home, grow } = buyHome(tx.state, a, def);
    const price = { coins: animalPrice(tx.state, a.def, adult), acorns: 0 };
    pay(tx, ctx, { coins: price.coins + (grow ? grow.coins : 0), acorns: 0 }, `buy:${a.def}`, a.def);
    if (grow) growHome(tx, ctx, home, grow);
    const id = ctx.newId(0);
    tx.set(['farm', 'objects', id], {
      def: a.def, home, placedAt: ctx.now, by: ctx.pid,
      // baby growth is "started" now: Golden Hour applies; mastery ★2 is a CYCLE effect, not growth (GDD §4.8)
      adultAt: adult ? ctx.now : ctx.now + babyGrowMs(tx.state, def, ctx),
      fedAt: null, readyAt: null, cycle: 0, cut: 0, ...(adult ? {} : { baby: true }),
      paid: { coins: price.coins, acorns: 0 }, rcpt: { coins: price.coins, acorns: 0, until: ctx.now + SAFETY.undoMs },
    });
    tx.del(['farm', 'objects', home, 'rcpt']);                    // a home with an animal is no longer pristine
    // `step`: the room step paid with it (wave 4b), so the feed line says what the purchase really cost
    tx.emit({ e: 'bought', id, def: a.def, kind: 'animal', home, adult, by: ctx.pid, coins: price.coins, ...(grow ? { step: grow.coins } : {}) });
  },
};

// ---- tend / feed / collect ---------------------------------------------------------------------------------

const rolled = (ctx, bp, ...keys) => bp > 0 && Math.floor(ctx.rng(...keys) * 10_000) < bp;

/**
 * What collecting animal `id` gives now (pure). Product `out` (+`out` on the ★3 double chance), +1 bonus product on
 * the petting chance (10 %, 20 % when both players petted it today), +1 blue-ribbon good on the prized chance
 * (10 % once the animal has its blue ribbon). Rolls keyed by (farmSeed, animal id, cycle).
 */
export function collectOf(state, id, ctx) {
  const o = objectOf(state, id);
  const def = animalOf(o.def);
  const fx = masteryEffects('animals', starsOf(state, o.def));
  let qty = def.out;
  let bonus = 0;
  if (rolled(ctx, fx.doubleBp, 'double', id, o.cycle)) bonus += def.out;
  // the collector's Rancher perk: its own 5 % double-product roll (M2; a second, independent chance)
  else if (rolled(ctx, playerPerk(state, ctx.pid, 'rancher', 'doubleBp'), 'pdouble', id, o.cycle)) bonus += def.out;
  // a Nursery specialty: Bountiful +5 % chance of a bonus product (M2)
  const spec = specialtyOf(o);
  if (spec && rolled(ctx, spec.bonusBp ?? 0, 'spec', id, o.cycle)) bonus += 1;
  const today = dayIndex(ctx.now, state.meta.tz);
  if (o.pet && o.pet.day === today) {
    const bp = o.pet.by.length >= 2 ? COOP.petting.bothBp : COOP.petting.soloBp;
    if (rolled(ctx, bp, 'pet', id, o.cycle)) bonus += 1;
  }
  // collection perks (GDD §5.5): Feathers +2 % bonus egg (hens, ducks), Fossils +5 % bonus truffle
  const perkBp = /egg$/.test(def.product) ? collectionPerk(state, 'bonusEggBp')
    : def.product === 'truffle' ? collectionPerk(state, 'truffleBp') : 0;
  if (rolled(ctx, perkBp, 'perk', id, o.cycle)) bonus += 1;
  qty += bonus;
  const prized = o.cycle >= def.prizedAt;
  // the Rancher's last perk: the blue-ribbon good 20 % sooner, on the perk owner's own collections
  const soon = playerPerk(state, ctx.pid, 'rancher', 'prizedSoonerBp');
  const goodFrom = def.prizedAt - mulBp(def.prizedAt, soon);
  // + the Lucky Clover (wave 4b relic): a better chance of the blue-ribbon good
  const premiumBp = GROWTH.prizedAnimal.premiumBp + fx.premiumBp + relicLuckBp(state);
  const good = o.cycle >= goodFrom && rolled(ctx, premiumBp, 'premium', id, o.cycle) ? def.premium : null;
  return { item: def.product, qty, bonus, good, xp: def.xp, prized, units: qty + (good ? 1 : 0) };
}

/** The tender's Rancher perk: 10 % chance a feeding uses no feed (keyed on the animal and the cycle it starts). */
const freeFeed = (state, ctx, id, cycle) => rolled(ctx, playerPerk(state, ctx.pid, 'rancher', 'freeFeedBp'),
  'freeFeed', id, cycle);

/**
 * Plan a tend / feed / collect stroke over `animalsOf(ids)`. Each animal: collect a waiting product (when the
 * Barn is below 2 x capacity), then feed it if hungry (its feed in the Barn; below Keep N asks RESERVED once).
 * @returns {{ ok: string[], code, how: { [id]: { collect: boolean, feed: boolean } } }}
 */
function planTend(state, a, ctx, mode) {
  const room = mulBp(barnCap(state), MARKET.barn.overflowMulBp);
  let held = stockOf(state) + overflowOf(state);
  const used = new Map();
  const how = {};
  const ids = animalsOf(state, targetsOf(a));
  const r = planBatch(ids, (id) => {
    const o = objectOf(state, id);
    if (!isAnimal(o)) return ERR.NOT_FOUND;
    if (ctx.now < o.adultAt) return ERR.NOT_READY;                 // babies only grow (bottles help)
    const def = animalOf(o.def);
    if (isColonyDef(def)) {
      // a colony eats nothing: collecting its honey starts the next cycle at once (like a tree)
      if (mode === 'feed') return ERR.NOT_HUNGRY;
      if (o.readyAt === null || !isReady(o, ctx.now, ctx.grace)) return ERR.NOT_READY;
      if (held >= room) return ERR.STORAGE_FULL;
      held += collectOf(state, id, ctx).units;
      how[id] = { collect: true, feed: false, colony: true };
      return null;
    }
    let collect = false;
    let hungry = o.readyAt === null;
    if (!hungry && mode !== 'feed') {
      if (!isReady(o, ctx.now, ctx.grace)) return ERR.NOT_READY;
      if (held >= room) return ERR.STORAGE_FULL;                   // the product waits on the animal (§9 #5)
      held += collectOf(state, id, ctx).units;
      collect = true;
      hungry = true;
    }
    let feed = false;
    if (hungry && mode !== 'collect' && freeFeed(state, ctx, id, collect ? o.cycle + 1 : o.cycle)) {
      how[id] = { collect, feed: true, free: true };
      return null;
    }
    if (hungry && mode !== 'collect') {
      const u = used.get(def.feed) ?? 0;
      if (available(state, def.feed) - u >= def.feedQty) {
        if (unkept(state, def.feed) - u < def.feedQty && !confirmed(a, ERR.RESERVED)) return ERR.RESERVED;
        used.set(def.feed, u + def.feedQty);
        feed = true;
      } else if (!collect) return ERR.NO_ITEMS;
    }
    if (!collect && !feed) return mode === 'feed' ? ERR.NOT_HUNGRY : ERR.NOT_READY;
    how[id] = { collect, feed };
    return null;
  }, SOFT);
  return { ...r, how };
}

/**
 * Compost Bin collector (GDD §3.4 rule 8): one point per animal collection to the first bin with room; every
 * `every` points drop `out` Compost into its tray, which holds `maxBatches` batches (points stop while full). The
 * bin's queue slots are for its recipes (Fertilizer from L10, Manure in M2), not for this tray.
 */
function binPoint(tx) {
  for (const id of sortedKeys(tx.state.farm.objects)) {
    const b = tx.state.farm.objects[id];
    const c = defOf(b.def)?.collector;
    if (!c || !Number.isSafeInteger(b.pts)) continue;
    if (b.ready + c.out > c.maxBatches * c.out) continue;       // full: points stop until it is emptied
    const pts = b.pts + 1;
    if (pts >= c.every) {
      tx.set(['farm', 'objects', id, 'pts'], pts - c.every);
      tx.set(['farm', 'objects', id, 'ready'], b.ready + c.out);
      tx.emit({ e: 'compostPoints', id, points: pts - c.every, dropped: c.out });
    } else tx.set(['farm', 'objects', id, 'pts'], pts);
    return;
  }
}

function applyTend(tx, a, ctx, mode) {
  const { ok, how } = planTend(tx.state, a, ctx, mode);
  for (const id of ok) {
    const o = tx.get(['farm', 'objects', id]);
    const def = animalOf(o.def);
    if (how[id].collect) {
      const c = collectOf(tx.state, id, ctx);
      intake(tx, c.item, c.qty);
      proofDeed(tx, 'collect', c.item, c.qty);
      if (c.good) {
        intake(tx, c.good, 1);
        restoreDeed(tx, ctx, 'prized_animal_good', 1);          // the Stone Bridge's Fair Prizes (GDD §5.9)
      }
      const cycle = o.cycle + 1;
      tx.set(['farm', 'objects', id, 'cycle'], cycle);
      tx.set(['farm', 'objects', id, 'fedAt'], null);
      tx.set(['farm', 'objects', id, 'readyAt'], null);
      const ev = { e: 'collected', id, animal: o.def, item: c.item, qty: c.qty, by: ctx.pid, xp: c.xp, ribbon: c.prized,
        bonus: c.bonus };
      if (c.good) ev.good = c.good;
      tx.emit(ev);
      if (cycle === def.prizedAt) tx.emit({ e: 'prized', id, animal: o.def, by: ctx.pid });
      binPoint(tx);
      // a Tidy animal from the Nursery adds its extra Compost Bin point(s) (M2)
      for (let k = specialtyOf(o)?.compostPoints ?? 0; k > 0; k--) binPoint(tx);
      if (how[id].colony) startColony(tx, ctx, id);
    }
    if (how[id].feed) {
      if (!how[id].free) consume(tx, def.feed, def.feedQty);
      const cut = startCutBp(tx.state, o.def, ctx.now);
      tx.set(['farm', 'objects', id, 'fedAt'], ctx.now);
      tx.set(['farm', 'objects', id, 'readyAt'], ctx.now + cutMs(def.cycleMs, cut));
      tx.set(['farm', 'objects', id, 'cut'], cut);
      tx.del(['farm', 'objects', id, 'rcpt']);
      if (o.baby) {
        // the first meal of a grown-up baby: raised on the farm (Nursery ribbon, "raise" deeds)
        tx.del(['farm', 'objects', id, 'baby']);
        tx.emit({ e: 'grewUp', id, animal: o.def, by: ctx.pid });
      }
      const fed = { e: 'fed', id, animal: o.def, feed: def.feed, qty: how[id].free ? 0 : def.feedQty, by: ctx.pid };
      if (how[id].free) fed.free = true;
      tx.emit(fed);
    }
  }
}

const tendAction = (mode) => ({
  schema: STROKE,
  check(state, a, ctx) {
    if (!oneTarget(a)) return ERR.BAD_ARGS;
    return planTend(state, a, ctx, mode).code;
  },
  apply(tx, a, ctx) { applyTend(tx, a, ctx, mode); },
});

/** Tend = collect + re-feed in one stroke (the default). */
export const tend = tendAction('both');
/** Feed only (Settings: split tending). */
export const feed = tendAction('feed');
/** Collect only (Settings: split tending). */
export const collect = tendAction('collect');

/** The Nursery specialty row of animal `o` ({ id, bonusBp? , compostPoints? }), or null (M2). */
export function specialtyOf(o) {
  if (!o || typeof o.spec !== 'string' || !isLive(NURSERY)) return null;
  return NURSERY.specialties.find((x) => x.id === o.spec) ?? null;
}

// ---- bottles, petting, home upgrades -----------------------------------------------------------------------------

/** One bottle per baby per player per hour (GDD §6.2 #12, wave-1 QA RC-03). */
export const BOTTLE_EVERY_MS = 3_600_000;

/**
 * Time a bottle saves now: 30 % of the remaining growth (§3.4 rule 3), never below the 50 % floor of the baby's
 * whole growth from its purchase (§4.8 timeFloorBp; a Golden Hour start counts toward it). 0 = nothing to cut.
 */
export function bottleSaves(o, def, now, bp = GROWTH.babyBottle.bp) {
  const floorAt = o.placedAt + def.babyMs - mulBp(def.babyMs, 10_000 - GROWTH.timeFloorBp);
  return Math.max(0, Math.min(mulBp(o.adultAt - now, bp), o.adultAt - Math.max(floorAt, now)));
}

/**
 * The cut a bottle by `pid` makes now (GDD §6.2 #12, M2): 30 % of the remaining growth, and 20 % more when the OTHER
 * player bottled this baby within the last hour and no partner bottle cut it in the last hour (once per baby per
 * hour; R17: the partner's extra is on top of the base anyone gets). @returns {{ bp, partner }}
 */
export function bottlePlan(o, pid, now) {
  const P = COOP.partnerBottle;
  let partner = false;
  if (P && isLive(P) && !(Number.isSafeInteger(o.pb) && now - o.pb < P.everyMs)) {
    const bot = o.bot ?? {};
    for (const q of sortedKeys(bot)) if (q !== pid && now - bot[q] < P.everyMs) partner = true;
  }
  return { bp: GROWTH.babyBottle.bp + (partner ? P.bp : 0), partner };
}

export const bottle = {
  schema: { id: V.objId },
  check(state, a, ctx) {
    const o = objectOf(state, a.id);
    if (!isAnimal(o)) return ERR.NOT_FOUND;
    if (ctx.now >= o.adultAt) return ERR.ALREADY_DONE;
    const def = animalOf(o.def);
    if (bottleSaves(o, def, ctx.now, bottlePlan(o, ctx.pid, ctx.now).bp) <= 0) return ERR.ALREADY_DONE;   // floor
    const last = o.bot?.[ctx.pid];
    if (Number.isSafeInteger(last) && ctx.now - last < BOTTLE_EVERY_MS) return ERR.COOLDOWN;
    if (available(state, def.bottle) < 1) return ERR.NO_ITEMS;
    if (unkept(state, def.bottle) < 1 && !confirmed(a, ERR.RESERVED)) return ERR.RESERVED;
    return null;
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    const def = animalOf(o.def);
    consume(tx, def.bottle, 1);
    const plan = bottlePlan(o, ctx.pid, ctx.now);
    const saved = bottleSaves(o, def, ctx.now, plan.bp);
    tx.set(['farm', 'objects', a.id, 'adultAt'], o.adultAt - saved);
    tx.set(['farm', 'objects', a.id, 'bot'], { ...(o.bot ?? {}), [ctx.pid]: ctx.now });
    if (plan.partner) tx.set(['farm', 'objects', a.id, 'pb'], ctx.now);
    tx.del(['farm', 'objects', a.id, 'rcpt']);
    const ev = { e: 'bottled', id: a.id, animal: o.def, item: def.bottle, by: ctx.pid, savedMs: saved };
    if (plan.partner) ev.partner = true;
    tx.emit(ev);
  },
};

function petCode(state, id, ctx) {
  const o = objectOf(state, id);
  if (!isAnimal(o)) return ERR.NOT_FOUND;
  if (isColony(o)) return ERR.BAD_ARGS;                           // a swarm of bees is not petted
  const today = dayIndex(ctx.now, state.meta.tz);
  return o.pet && o.pet.day === today && o.pet.by.includes(ctx.pid) ? ERR.ALREADY_DONE : null;
}

export const pet = {
  schema: STROKE,
  check(state, a, ctx) {
    if (!oneTarget(a)) return ERR.BAD_ARGS;
    return planBatch(animalsOf(state, targetsOf(a)), (id) => petCode(state, id, ctx), SOFT).code;
  },
  apply(tx, a, ctx) {
    const { ok } = planBatch(animalsOf(tx.state, targetsOf(a)), (id) => petCode(tx.state, id, ctx), SOFT);
    const day = dayIndex(ctx.now, tx.state.meta.tz);
    const both = [];
    for (const id of ok) {
      const o = tx.get(['farm', 'objects', id]);
      const by = o.pet && o.pet.day === day ? [...o.pet.by, ctx.pid].sort() : [ctx.pid];
      tx.set(['farm', 'objects', id, 'pet'], { day, by });
      if (by.length >= 2) both.push(id);
    }
    tx.emit({ e: 'petted', ids: ok, by: ctx.pid, both });
  },
};

/**
 * `upgradeHome {id}`: one room step bought on its own (wave 4b: up to the home's growth max; a step into the next
 * footprint tier grows the home around itself, BLOCKED when something is in the way: homeGrowth names it).
 */
export const upgradeHome = {
  schema: { id: V.objId },
  check(state, a, ctx) {
    const g = homeGrowth(state, a.id);
    if (g.code) return g.code;
    return payCode(state, a, ctx, { coins: g.coins, acorns: 0 });
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    const g = homeGrowth(tx.state, a.id);
    pay(tx, ctx, { coins: g.coins, acorns: 0 }, `upgrade:${o.def}`, o.def);
    const up = (o.up ?? 0) + 1;
    growHome(tx, ctx, a.id, g);
    tx.emit({ e: 'homeUpgraded', id: a.id, def: o.def, level: up, capacity: capacityOf(tx.state, a.id), by: ctx.pid,
      coins: g.coins });
    settleOwed(tx, ctx);
  },
};

/**
 * One animal tended by the Farmhand (wave 4b relic): collect its waiting good and feed it when hungry, exactly as a
 * player's tend stroke over it alone would; skipped (false) when that stroke would be refused (a baby, nothing
 * ready, no feed, or feed only under Keep N: the Farmhand never touches kept feed).
 */
export function tendOne(tx, ctx, id) {
  const mode = farmhandMode(tx.state, ctx, id);
  if (!mode) return false;
  applyTend(tx, { id }, ctx, mode);
  return true;
}

/** How the Farmhand tends animal `id` now: 'both', 'collect' (its only feed is kept: the good comes in), or null. */
function farmhandMode(state, ctx, id) {
  const code = planTend(state, { id }, ctx, 'both').code;
  if (code === null) return 'both';
  return code === ERR.RESERVED && planTend(state, { id }, ctx, 'collect').code === null ? 'collect' : null;
}

/** True when the Farmhand would tend animal `id` now (the same test as tendOne, without the writes). */
export const tendable = (state, ctx, id) => farmhandMode(state, ctx, id) !== null;
