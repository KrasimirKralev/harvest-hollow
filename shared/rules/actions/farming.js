// Crop actions (GDD §3.1 rules, §3.7 tools, §9 #1-#4, #10, #31, #41, #49): plant, water (+ partner tend), compost,
// fertilize (wave 4), harvest, uproot and Grandma's seed basket. Every stroke action takes `id` (one click) or `ids` (a drag, in stroke
// order) and applies to every target that passes (economy.planBatch). Placing, moving and removing plots is generic
// (actions/decor.js). Owned by rules-economy.
//
// Crop record: { def, plantedAt, readyAt, by, cycle, cut, paid?, packet?, golden?, season?, water?, tend? }
//   cut     basis points of the base grow time already taken off (season, mastery ★2, Golden Hour, water, tend);
//           every further cut honours the 50 % floor through extraCutMs (GDD §4.8)
//   paid    seed coins (refunded by an Uproot inside the undo window); packet/golden: what was used instead / too
//   water   who watered ('sys' = a Sprinkler at planting); tend: the partner who added the partner tend
import { cropOf, defOf, itemOf, live, liveAt, isLive, GROWTH, COOP, SAFETY, BOOSTS, MARKET } from '../../content/index.js';
import { ERR, SOFT } from '../../net/protocol.js';
import { V } from '../schema.js';
import { objectOf, idsAround } from '../grid.js';
import { isReady, rainingAt, weatherAt, hourIndex, HOUR_MS } from '../time.js';
import { sortedKeys } from '../order.js';
import { dayIndex } from '../calendar.js';
import {
  spend, refund, intake, consume, available, stockOf, overflowOf, barnCap, mulBp, levelOf, starsOf,
  masteryEffects, startCutBp, cutMs, extraCutMs, inSeason, planBatch, targetsOf, oneTarget, MAX_BATCH, proofDeed,
  collectionPerk, useReceipts, playerPerk,
} from '../economy.js';
import { relicLuckBp } from '../relics.js';
import { formGiants, giantAnchorOf, syncGiant } from './giant.js';
import { pollinated } from './animals.js';
import { restoreDeed } from './restoration.js';
import { upgradeBonus } from '../upgrades.js';

export { plotPrice } from '../../content/index.js';

const STROKE = { id: V.opt(V.objId), ids: V.opt(V.list(V.objId, MAX_BATCH)) };
const isPlot = (o) => Boolean(o) && defOf(o.def)?.kind === 'plot';
const isTree = (o) => Boolean(o) && defOf(o.def)?.kind === 'tree';

// ---- effects of nearby objects (GDD §2.4, §3.8: radius in tiles, Chebyshev; effects never stack) --------------

const rectDist = (a, b) => Math.max(0, a.x - (b.x + b.w - 1), b.x - (a.x + a.w - 1), a.z - (b.z + b.d - 1),
  b.z - (a.z + a.d - 1));
const rectOf = (o, def) => {
  const [w, d] = o.rot % 2 ? [def.size[1], def.size[0]] : def.size;
  return { x: o.x, z: o.z, w, d };
};
/** The widest effect radius of any live decor: the scan never looks further. */
const MAX_EFFECT_R = Math.max(0, ...live('decor').flatMap((d) => Object.values(d.effect ?? {})
  .map((e) => (e && Number.isSafeInteger(e.radius) ? e.radius : 0))));

/**
 * The strongest `effect[key]` of a decor within its own radius of object `o` (null when none). `pick(effect)`
 * returns { radius, value } or null for decor that does not apply. Never stacks: the best single value wins.
 */
export function effectNear(state, o, key, pick, used = null) {
  const def = defOf(o.def);
  const me = rectOf(o, def);
  let best = null;
  let bestId = null;
  for (const id of idsAround(state, me.x, me.z, me.w, me.d, MAX_EFFECT_R)) {
    const other = state.farm.objects[id];
    const od = defOf(other.def);
    const eff = od && od.effect && od.effect[key];
    if (!eff) continue;
    const p = pick(eff);
    if (!p || rectDist(me, rectOf(other, od)) > p.radius) continue;
    if (best === null || p.value > best || (p.value === best && id < bestId)) { best = p.value; bestId = id; }
  }
  if (used && bestId !== null && best) used.add(bestId);      // the decor whose effect applies (RC-08 receipts)
  return best;
}

/** Bonus-unit chance (bp) a Scarecrow / Bird Bath gives object `o` (target 'crops' | 'trees'), 0 when none. */
export const bonusBpNear = (state, o, target, used = null) => effectNear(state, o, 'bonus',
  (e) => (e.target === target ? { radius: e.radius, value: e.bp } : null), used) ?? 0;

/** True when a Sprinkler covers plot `o` (it waters crops at the moment they are planted). */
export const sprinklerNear = (state, o, used = null) => effectNear(state, o, 'water',
  (e) => ({ radius: e.radius, value: 1 }), used) !== null;

/**
 * The Growth Totem's cut (wave 4b relic, decor effect `grow`): basis points of the base grow time a crop planted within
 * its radius saves (inside GROWTH.timeFloorBp with every other cut), 0 when none. Never stacks (the best one counts).
 */
export const growBpNear = (state, o, used = null) => effectNear(state, o, 'grow',
  (e) => ({ radius: e.radius, value: e.bp }), used) ?? 0;

/**
 * True when plot `o` counts as in season whatever the calendar says: a Greenhouse plot (Old Greenhouse, GDD §5.9)
 * or a plot within a Cold Frame's radius (§3.8).
 */
export const alwaysInSeason = (state, o, used = null) => o.gh !== undefined
  || effectNear(state, o, 'inSeason', (e) => ({ radius: e.radius, value: 1 }), used) !== null;

// ---- plant ----------------------------------------------------------------------------------------------------

/**
 * The seed price of a crop now: Heirloom Seeds (a collection set, GDD §5.5) take 3 % off and the buyer's Grower perk
 * 10 % (M2; `pid` = the planting player), never below 1.
 */
export function seedPrice(state, crop, pid = null) {
  const bp = collectionPerk(state, 'seedBp') + (pid ? playerPerk(state, pid, 'grower', 'seedBp') : 0);
  return bp > 0 ? Math.max(1, crop.seed - mulBp(crop.seed, bp)) : crop.seed;
}

function planPlant(state, a, ctx) {
  const crop = cropOf(a.crop);
  if (crop.retired || levelOf(state) < crop.unlock) return { code: ERR.LOCKED, ok: [], how: {} };
  const seed = seedPrice(state, crop, ctx.pid);
  let coins = state.farm.wallet.coins;
  let packets = state.farm.seeds[a.crop] ?? 0;
  let golden = state.farm.golden;
  const how = {};
  const r = planBatch(targetsOf(a), (id) => {
    const plot = objectOf(state, id);
    if (!isPlot(plot)) return ERR.NOT_FOUND;
    if (plot.crop) return ERR.OCCUPIED;
    if (a.golden && golden <= 0) return ERR.NO_ITEMS;
    if (packets > 0) {
      packets--;
      how[id] = 'packet';
    } else if (coins >= seed) {
      coins -= seed;
      how[id] = 'coins';
    } else return ERR.NO_COINS;
    if (a.golden) golden--;
    return null;
  }, SOFT);
  return { ...r, how };
}

export const plant = {
  schema: { ...STROKE, crop: V.content('crops'), golden: V.opt(V.bool) },
  check(state, a, ctx) {
    if (!oneTarget(a)) return ERR.BAD_ARGS;
    return planPlant(state, a, ctx).code;
  },
  apply(tx, a, ctx) {
    const { ok, how } = planPlant(tx.state, a, ctx);
    const crop = cropOf(a.crop);
    const seed = seedPrice(tx.state, crop, ctx.pid);
    const natural = inSeason(tx.state, a.crop, ctx.now);
    const baseCut = startCutBp(tx.state, a.crop, ctx.now);
    const waterable = crop.growMs >= GROWTH.water.minCropMs;
    const raining = rainingAt(tx.state.meta.farmSeed, ctx.now, tx.state.meta.createdAt);   // watered (GDD §5.10)
    let coins = 0;
    let packets = 0;
    const used = new Set();                              // Cold Frames and Sprinklers whose effect this stroke uses
    for (const id of ok) {
      const plot = tx.get(['farm', 'objects', id]);
      // in season by the calendar, or by a Greenhouse / Cold Frame: -10 % time, fixed at planting
      const forced = !natural && alwaysInSeason(tx.state, plot, used);
      const season = natural || forced;
      const sprinkled = waterable && (raining || sprinklerNear(tx.state, plot, used));
      const cut = baseCut + (season ? GROWTH.season.timeBp : 0) + (sprinkled ? GROWTH.water.cropBp : 0)
        + growBpNear(tx.state, plot, used);              // a Growth Totem nearby (wave 4b): faster from the start
      const rec = { def: a.crop, plantedAt: ctx.now, readyAt: ctx.now + cutMs(crop.growMs, cut), by: ctx.pid,
        cycle: plot.cycle, cut };
      if (how[id] === 'packet') { rec.packet = true; packets++; } else { rec.paid = seed; coins += seed; }
      if (a.golden) rec.golden = true;
      if (season) rec.season = true;
      if (forced) rec.forced = true;
      if (sprinkled) rec.water = 'sys';
      tx.set(['farm', 'objects', id, 'crop'], rec);
      tx.del(['farm', 'objects', id, 'rcpt']);           // a used plot is no longer "pristine" (tech §15.3)
      const ev = { e: 'planted', id, crop: a.crop, by: ctx.pid };
      if (a.golden) ev.golden = true;
      if (season) ev.season = true;
      if (rec.packet) ev.packet = true;
      tx.emit(ev);
    }
    useReceipts(tx, used);
    if (coins > 0) spend(tx, ctx, coins, 'seed');
    if (packets > 0) tx.inc(['farm', 'seeds', a.crop], -packets, { dropZero: true });
    if (a.golden) tx.inc(['farm', 'golden'], -ok.length);
    formGiants(tx, ctx, ok);
  },
};

// ---- water and partner tend (crops and trees) ---------------------------------------------------------------------

/**
 * What watering `o` would do for `pid`: { mode: 'water' | 'tend', bp, base } or { code }. `state` (optional, M2) adds
 * the waterer's own perk: Grower -5 % extra on crops, Orchardist -5 % extra on trees; and (wave 4) the Well's upgrade.
 */
export function waterPlan(o, pid, ctx, state = null) {
  if (isPlot(o)) {
    if (!o.crop) return { code: ERR.EMPTY };
    const crop = cropOf(o.crop.def);
    if (crop.growMs < GROWTH.water.minCropMs) return { code: ERR.NOT_NEEDED };  // the fast loop has no click tax
    if (isReady(o.crop, ctx.now, ctx.grace)) return { code: ERR.ALREADY_DONE };
    return withPerk(whoWaters(o.crop, pid, GROWTH.water.cropBp, crop.growMs), state, pid, 'grower', 'waterBp');
  }
  if (isTree(o)) {
    if (isReady(o, ctx.now, ctx.grace)) return { code: ERR.ALREADY_DONE };
    return withPerk(whoWaters(o, pid, GROWTH.water.treeBp, defOf(o.def).cycleMs), state, pid, 'orchardist',
      'treeWaterBp');
  }
  return { code: ERR.NOT_FOUND };
}

// + the upgraded Well's bonus (wave 4, owner wish E): every watering, by either player, saves a little more
const withPerk = (plan, state, pid, tree, key) => (plan.code || !state ? plan
  : { ...plan, bp: plan.bp + playerPerk(state, pid, tree, key) + upgradeBonus(state, 'waterBp') });

function whoWaters(rec, pid, bp, base) {
  if (rec.water === undefined) return { mode: 'water', bp, base };
  if (rec.tend !== undefined) return { code: ERR.ALREADY_DONE };
  if (rec.water === pid) return { code: ERR.SELF_ONLY };        // the partner tend is the OTHER player's (R17)
  return { mode: 'tend', bp: COOP.partnerTend.bp, base };
}

/** A stroke's water targets: a Giant's plots stand for its anchor (the whole Giant is watered once). */
const waterTargets = (state, ids) => [...new Set(ids.map((id) => giantAnchorOf(state, id) ?? id))];

export const water = {
  schema: STROKE,
  check(state, a, ctx) {
    if (!oneTarget(a)) return ERR.BAD_ARGS;
    return planBatch(waterTargets(state, targetsOf(a)),
      (id) => waterPlan(objectOf(state, id), ctx.pid, ctx, state).code ?? null, SOFT).code;
  },
  apply(tx, a, ctx) {
    const { ok } = planBatch(waterTargets(tx.state, targetsOf(a)),
      (id) => waterPlan(objectOf(tx.state, id), ctx.pid, ctx, tx.state).code ?? null, SOFT);
    for (const id of ok) {
      const o = tx.get(['farm', 'objects', id]);
      const plan = waterPlan(o, ctx.pid, ctx, tx.state);
      const tree = isTree(o);
      const base = tree ? ['farm', 'objects', id] : ['farm', 'objects', id, 'crop'];
      const rec = tx.get(base);
      const waterer = rec.water;                          // read before the write (tx.get is live)
      const saved = extraCutMs(plan.base, rec.cut ?? 0, plan.bp);
      tx.set([...base, 'cut'], (rec.cut ?? 0) + plan.bp);
      if (saved > 0) tx.set([...base, 'readyAt'], rec.readyAt - saved);
      tx.set([...base, plan.mode], ctx.pid);
      if (tree) tx.del(['farm', 'objects', id, 'rcpt']);
      else if (rec.giant === id) syncGiant(tx, id);
      // `tend` is a PARTNER tend (Hearts): the second watering after the other player; after a Sprinkler ('sys')
      // anyone may add the -5 %, but it helps no partner
      tx.emit({ e: 'watered', id, kind: tree ? 'tree' : 'crop', by: ctx.pid,
        tend: plan.mode === 'tend' && waterer !== 'sys', savedMs: saved });
    }
  },
};

// ---- compost ---------------------------------------------------------------------------------------------------

function compostCode(o, ctx) {
  if (isPlot(o)) {
    if (o.compost) return ERR.ALREADY_DONE;
    if (o.crop && isReady(o.crop, ctx.now, ctx.grace)) return ERR.ALREADY_DONE;   // not once ready (§3.1 rule 5)
    return null;
  }
  if (isTree(o)) return o.compost || isReady(o, ctx.now, ctx.grace) ? ERR.ALREADY_DONE : null;
  return ERR.NOT_FOUND;
}

function planCompost(state, a, ctx) {
  if (levelOf(state) < GROWTH.compost.unlock) return { ok: [], code: ERR.LOCKED };
  let have = available(state, 'compost');
  return planBatch(targetsOf(a), (id) => {
    const c = compostCode(objectOf(state, id), ctx);
    if (c) return c;
    if (have <= 0) return ERR.NO_ITEMS;
    have--;
    return null;
  }, SOFT);
}

export const compost = {
  schema: STROKE,
  check(state, a, ctx) {
    if (!oneTarget(a)) return ERR.BAD_ARGS;
    return planCompost(state, a, ctx).code;
  },
  apply(tx, a, ctx) {
    const { ok } = planCompost(tx.state, a, ctx);
    consume(tx, 'compost', ok.length);
    for (const id of ok) {
      const tree = isTree(tx.get(['farm', 'objects', id]));
      tx.set(['farm', 'objects', id, 'compost'], true);
      tx.del(['farm', 'objects', id, 'rcpt']);
      tx.emit({ e: 'composted', id, kind: tree ? 'tree' : 'crop', by: ctx.pid });
    }
  },
};

// ---- fertilizer (wave 4, owner wish 2) ---------------------------------------------------------------------------

/**
 * Fertilizer (content GROWTH.fertilizer, owner wish 2): the Compost Bin's richer product (content recipe `fertilizer`),
 * spread on a GROWING crop of at least GROWTH.water.minCropMs (a quick crop is re-planted anyway: NOT_NEEDED), once a
 * cycle (`crop.fert` = who spread it, so it goes with the harvest): the crop ripens timeBp of its base grow time sooner
 * on the spot (inside the 50 % floor with every other cut, never before now) and gives bonusUnits more at harvest. It
 * stacks with Compost (the plot's plain +1 and blue-ribbon chance). EMPTY on an empty plot, LOCKED on a Giant.
 */
export const FERTILIZER = Object.freeze({ unlock: 10, item: 'fertilizer', bonusUnits: 2, timeBp: 2500,
  ...(GROWTH.fertilizer ?? {}) });

/** True when Fertilizer plays on this farm: its item exists in this build and the farm has its level. */
export const fertilizerLive = (state) => {
  const it = itemOf(FERTILIZER.item);
  return Boolean(it) && !it.retired && isLive(it) && levelOf(state) >= Math.max(FERTILIZER.unlock ?? 1, it.unlock ?? 1);
};

/** Why crop plot `o` takes no Fertilizer now, or null. Pure (the crop card and the scoop's ghost ask it too). */
export function fertilizeCode(o, ctx) {
  if (!isPlot(o)) return ERR.NOT_FOUND;
  if (!o.crop) return ERR.EMPTY;
  if (o.crop.giant !== undefined) return ERR.LOCKED;                         // a Giant's timers are its anchor's
  if (o.crop.fert !== undefined || isReady(o.crop, ctx.now, ctx.grace)) return ERR.ALREADY_DONE;
  return cropOf(o.crop.def).growMs < GROWTH.water.minCropMs ? ERR.NOT_NEEDED : null;
}

function planFertilize(state, a, ctx) {
  if (!fertilizerLive(state)) return { ok: [], code: ERR.LOCKED };
  let have = available(state, FERTILIZER.item);
  return planBatch(targetsOf(a), (id) => {
    const c = fertilizeCode(objectOf(state, id), ctx);
    if (c) return c;
    if (have <= 0) return ERR.NO_ITEMS;
    have--;
    return null;
  }, SOFT);
}

export const fertilize = {
  schema: STROKE,
  check(state, a, ctx) {
    if (!oneTarget(a)) return ERR.BAD_ARGS;
    return planFertilize(state, a, ctx).code;
  },
  apply(tx, a, ctx) {
    const { ok } = planFertilize(tx.state, a, ctx);
    consume(tx, FERTILIZER.item, ok.length);
    for (const id of ok) {
      const rec = tx.get(['farm', 'objects', id, 'crop']);
      const cut = rec.cut ?? 0;
      const ready = rec.readyAt;                          // read before the writes (tx.get is live)
      const saved = Math.max(0, Math.min(extraCutMs(cropOf(rec.def).growMs, cut, FERTILIZER.timeBp), ready - ctx.now));
      tx.set(['farm', 'objects', id, 'crop', 'cut'], cut + FERTILIZER.timeBp);
      if (saved > 0) tx.set(['farm', 'objects', id, 'crop', 'readyAt'], ready - saved);
      tx.set(['farm', 'objects', id, 'crop', 'fert'], ctx.pid);
      tx.del(['farm', 'objects', id, 'rcpt']);
      tx.emit({ e: 'fertilized', id, kind: 'crop', crop: rec.def, by: ctx.pid, savedMs: saved });
    }
  },
};

// ---- harvest ----------------------------------------------------------------------------------------------------

const rolled = (ctx, bp, ...keys) => bp > 0 && Math.floor(ctx.rng(...keys) * 10_000) < bp;

/**
 * What harvesting plot `id` yields now (pure: the same in check, apply and on every client).
 * Units: yield + 1 with Compost + 1 for a blue ribbon (Golden Seed, or the Compost's chance: 10 % + 2 points per
 * mastery star, +5 at Gold, at most 24 %) + 1 on the ★3 chance (15 %) + 1 on a Scarecrow's chance (5 %). Rolls are
 * keyed by (farmSeed, plot id, plot cycle): client and server agree and a reload cannot re-roll (GDD §9 #46, R16).
 */
export function harvestOf(state, id, ctx, used = null) {
  const plot = objectOf(state, id);
  const c = plot.crop;
  const crop = cropOf(c.def);
  const stars = starsOf(state, c.def);
  const fx = masteryEffects('crops', stars);
  const G = GROWTH.compost;
  let qty = crop.yield;
  let bonus = 0;
  let ribbon = false;
  if (plot.compost) bonus += G.bonusUnits;
  if (c.fert !== undefined) bonus += FERTILIZER.bonusUnits;      // wave 4: Fertilizer (stacks with Compost)
  // the Lucky Clover (wave 4b relic): its points on top of the Compost chance (and above its cap), and a chance of its
  // own on a crop without Compost
  const luck = relicLuckBp(state);
  if (c.golden) ribbon = true;
  else if (plot.compost) {
    // Gold's +5 points is the crops mastery effect ribbonBp (MASTERY.effects.crops[3]); counted once
    // + the harvester's Grower perk (+3 points, M2), all within the 24 % cap
    const chance = Math.min(G.maxBp, G.ribbonBp + G.perStarBp * Math.min(stars, 3) + fx.ribbonBp
      + playerPerk(state, ctx.pid, 'grower', 'ribbonBp')) + luck;
    ribbon = rolled(ctx, chance, 'ribbon', id, plot.cycle);
  } else if (luck > 0) ribbon = rolled(ctx, luck, 'ribbon', id, plot.cycle);
  if (ribbon) bonus += G.ribbonUnits;
  if (rolled(ctx, fx.bonusUnitBp, 'star3', id, plot.cycle)) bonus += 1;
  if (rolled(ctx, playerPerk(state, ctx.pid, 'grower', 'bonusUnitBp'), 'perk', id, plot.cycle)) bonus += 1;
  if (rolled(ctx, bonusBpNear(state, plot, 'crops', used), 'scarecrow', id, plot.cycle)) bonus += 1;
  if (pollinated(state, plot, used) && rolled(ctx, GROWTH.bees.pollinationBp, 'pollen', id, plot.cycle)) bonus += 1;
  // a crop in season only thanks to a Greenhouse / Cold Frame cannot carry the +10 % sell price into the shared
  // Barn (units are pooled), so it is paid as its expected value: a yield x 10 % chance of one more unit
  if (c.forced && rolled(ctx, crop.yield * GROWTH.season.sellBp, 'forced', id, plot.cycle)) bonus += 1;
  qty += bonus;
  const fresh = ctx.now <= c.readyAt + crop.freshMs;
  // XP in hundredths (RC-13): the stroke adds them to farm.xpFrac and pays whole XP; Fresh adds 10 % on every crop
  const xp100 = crop.xp100 + (fresh ? mulBp(crop.xp100, GROWTH.fresh.xpBonusBp) : 0);
  return { crop: c.def, qty, bonus, ribbon, fresh, xp100, planter: c.by, star: stars };
}

function planHarvest(state, a, ctx) {
  const room = mulBp(barnCap(state), MARKET.barn.overflowMulBp);
  let held = stockOf(state) + overflowOf(state);
  return planBatch(targetsOf(a), (id) => {
    const plot = objectOf(state, id);
    if (!isPlot(plot)) return ERR.NOT_FOUND;
    if (!plot.crop) return ERR.EMPTY;
    if (!isReady(plot.crop, ctx.now, ctx.grace)) return ERR.NOT_READY;
    if (plot.crop.giant !== undefined) return ERR.LOCKED;   // a Giant is felled with the Axe (actions/giant.js)
    if (held >= room) return ERR.STORAGE_FULL;           // at 2 x capacity the crop waits, ripe (GDD §3.6, §9 #4)
    held += harvestOf(state, id, ctx).qty;
    return null;
  }, SOFT);
}

export const harvest = {
  schema: STROKE,
  check(state, a, ctx) {
    if (!oneTarget(a)) return ERR.BAD_ARGS;
    return planHarvest(state, a, ctx).code;
  },
  apply(tx, a, ctx) {
    const { ok } = planHarvest(tx.state, a, ctx);
    // read every outcome BEFORE writing: the scarecrow/stars of the stroke's state apply to the whole stroke
    const used = new Set();                              // Scarecrows and hives whose chance this stroke used
    const outs = ok.map((id) => [id, harvestOf(tx.state, id, ctx, used)]);
    useReceipts(tx, used);
    let frac = tx.state.farm.xpFrac ?? 0;
    for (const [id, h] of outs) {
      frac += h.xp100;
      const xp = Math.floor(frac / 100);                  // whole XP paid with this plot; the rest carries over
      frac -= xp * 100;
      const plot = tx.get(['farm', 'objects', id]);
      intake(tx, h.crop, h.qty);
      proofDeed(tx, 'harvest', h.crop, h.qty);
      if (h.ribbon) restoreDeed(tx, ctx, 'prized_crop', 1);    // the Stone Bridge's Fair Prizes (GDD §5.9)
      tx.set(['farm', 'objects', id, 'crop'], null);
      tx.set(['farm', 'objects', id, 'cycle'], plot.cycle + 1);
      tx.del(['farm', 'objects', id, 'compost']);
      tx.emit({ e: 'harvested', id, crop: h.crop, qty: h.qty, by: ctx.pid, planter: h.planter, xp, xp100: h.xp100,
        fresh: h.fresh, ribbon: h.ribbon, bonus: h.bonus, star: h.star });
    }
    if (frac !== (tx.state.farm.xpFrac ?? 0)) tx.set(['farm', 'xpFrac'], frac);
  },
};

// ---- uproot --------------------------------------------------------------------------------------------------------

/** Seed refund of uprooting plot `o` now: everything paid inside the undo window, nothing after (§3.1 rule 2). */
export function uprootRefund(o, now) {
  const c = o.crop;
  const inWindow = now < c.plantedAt + SAFETY.undoMs;
  return { coins: inWindow ? c.paid ?? 0 : 0, packet: inWindow && c.packet === true,
    golden: inWindow && c.golden === true };
}

const uprootCode = (o, ctx) => (!isPlot(o) ? ERR.NOT_FOUND : !o.crop ? ERR.EMPTY
  : isReady(o.crop, ctx.now, ctx.grace) ? ERR.ALREADY_DONE                // a ripe crop is harvested, never thrown away
    : o.crop.giant !== undefined ? ERR.LOCKED : null);                     // nor is a growing Giant

export const uproot = {
  schema: STROKE,
  check(state, a, ctx) {
    if (!oneTarget(a)) return ERR.BAD_ARGS;
    return planBatch(targetsOf(a), (id) => uprootCode(objectOf(state, id), ctx), SOFT).code;
  },
  apply(tx, a, ctx) {
    const { ok } = planBatch(targetsOf(a), (id) => uprootCode(objectOf(tx.state, id), ctx), SOFT);
    let coins = 0;
    for (const id of ok) {
      const o = tx.get(['farm', 'objects', id]);
      const crop = o.crop.def;
      const r = uprootRefund(o, ctx.now);
      coins += r.coins;
      if (r.packet) tx.inc(['farm', 'seeds', crop], 1, { dropZero: true });
      if (r.golden) tx.inc(['farm', 'golden'], 1);
      tx.set(['farm', 'objects', id, 'crop'], null);
      tx.emit({ e: 'uprooted', id, crop, by: ctx.pid, refund: r.coins });
    }
    if (coins > 0) refund(tx, ctx, coins, 'uproot');
  },
};

// ---- Grandma's seed basket (GDD §9 #31) ---------------------------------------------------------------------------

/** null when the basket may be claimed now, else why not. Broke, nothing growing, nothing to sell, once a day. */
export function basketCode(state, now) {
  if (state.farm.basketDay === dayIndex(now, state.meta.tz)) return ERR.ALREADY_DONE;
  const cheapest = Math.min(...liveAt('crops', levelOf(state)).map((c) => c.seed));
  if (state.farm.wallet.coins >= cheapest) return ERR.LOCKED;
  for (const o of Object.values(state.farm.objects)) if (isPlot(o) && o.crop) return ERR.LOCKED;
  for (const n of Object.values(state.farm.seeds)) if (n > 0) return ERR.LOCKED;
  for (const item of [...Object.keys(state.farm.inventory), ...Object.keys(state.farm.overflow)]) {
    if (itemOf(item)?.sellable) return ERR.LOCKED;
  }
  return null;
}

export const seedBasket = {
  schema: {},
  check(state, a, ctx) {
    return basketCode(state, ctx.now);
  },
  apply(tx, a, ctx) {
    const B = BOOSTS.seedBasket;
    tx.set(['farm', 'basketDay'], dayIndex(ctx.now, tx.state.meta.tz));
    tx.inc(['farm', 'seeds', B.crop], B.plantings, { dropZero: true });
    tx.emit({ e: 'seedBasket', crop: B.crop, n: B.plantings, by: ctx.pid });
  },
};

// ---- rain (GDD §5.10) ----------------------------------------------------------------------------------------------

/** Rain hours the farm still has to apply: the window is capped at RAIN_SCAN hours (crops grow <= 24 h in M1a). */
const RAIN_SCAN = 24 * 30;

/** Rain hours in (farm.rain.at, hourIndex(now)], ascending (at most RAIN_SCAN back). */
export function rainHoursDue(state, now) {
  const to = hourIndex(now);
  const from = Math.max(state.farm.rain.at + 1, to - RAIN_SCAN + 1);
  const out = [];
  for (let h = from; h <= to; h++) if (weatherAt(state.meta.farmSeed, h, state.meta.createdAt) === 'rain') out.push(h);
  return out;
}

/** Start of the next rain hour after the last one applied (Infinity when none within RAIN_SCAN hours). */
export function nextRainAt(state, now) {
  const from = Math.max(state.farm.rain.at + 1, hourIndex(now) - RAIN_SCAN + 1);
  for (let h = from; h < from + RAIN_SCAN; h++) {
    if (weatherAt(state.meta.farmSeed, h, state.meta.createdAt) === 'rain') return h * HOUR_MS;
  }
  return Infinity;
}

/**
 * `_rain {}` (system): at the start of a rain hour every growing, unwatered crop of >= 30 min and every growing,
 * unwatered tree is watered (the base -15 % / -20 %, by 'sys'; the partner tend still adds its -5 %). One action
 * catches up every rain hour the server missed, each applied to what was growing at that hour's start.
 */
export const _rain = {
  schema: {},
  check(state, a, ctx) {
    return rainHoursDue(state, ctx.now).length ? null : ERR.NOT_READY;
  },
  apply(tx, a, ctx) {
    const hours = rainHoursDue(tx.state, ctx.now);
    const ids = [];
    for (const h of hours) {
      const t = h * HOUR_MS;
      for (const id of sortedKeys(tx.state.farm.objects)) {
        const o = tx.state.farm.objects[id];
        let base = null;
        let rec = null;
        let bp = 0;
        if (isPlot(o) && o.crop && o.crop.water === undefined && cropOf(o.crop.def).growMs >= GROWTH.water.minCropMs) {
          if (o.crop.giant !== undefined && o.crop.giant !== id) continue;   // the anchor waters the whole Giant
          [base, rec, bp] = [['farm', 'objects', id, 'crop'], o.crop, GROWTH.water.cropBp];
          if (!(rec.plantedAt <= t && t < rec.readyAt)) continue;
        } else if (isTree(o) && o.water === undefined) {
          [base, rec, bp] = [['farm', 'objects', id], o, GROWTH.water.treeBp];
          if (!(rec.startedAt <= t && t < rec.readyAt)) continue;
        } else continue;
        const span = isTree(o) ? defOf(o.def).cycleMs : cropOf(o.crop.def).growMs;
        const saved = extraCutMs(span, rec.cut ?? 0, bp);
        const ready = rec.readyAt - saved;               // read before the writes (rec is live)
        tx.set([...base, 'cut'], (rec.cut ?? 0) + bp);
        if (saved > 0) tx.set([...base, 'readyAt'], ready);
        tx.set([...base, 'water'], 'sys');
        if (isPlot(o) && o.crop.giant === id) syncGiant(tx, id);
        ids.push(id);
      }
    }
    tx.set(['farm', 'rain'], { at: hourIndex(ctx.now) });
    if (ids.length) tx.emit({ e: 'rained', ids, hours: hours.length });
  },
};
