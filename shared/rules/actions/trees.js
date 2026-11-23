// Trees and debris (GDD §2.3 debris, §3.2 rules 1-9, §3.7 Basket and Axe, §4.5, §6.2 #8 chop combo). Buying and
// placing trees is generic (actions/decor.js: per-species cap, n-th-copy price, free trees not counted).
// Owned by rules-economy.
//
// Tree record: { def, x, z, rot, placedAt, by, cycle, matureAt, startedAt, readyAt, cut, water?, tend?, compost?,
//   paid?, rcpt?, free? }   cycle = harvests so far (the rng key); a sapling (now < matureAt) has no fruit; the first
//   fruit ripens one cycle after maturity; every harvest starts the next cycle at once (rule 4).
//
//   harvestTree {id | ids}   the Basket (shakes fruit trees)
//   chop {id | ids}          the Axe / Hand: a ripe Pine gives Wood (rule 9); debris loses hp, then clears for XP,
//                            coins (DEBRIS_RULES.coinsPerXp per XP, granted) and its Wood
import {
  treeOf, defOf, isLive, itemOf, live, levelFromXp, GROWTH, DEBRIS_RULES, MARKET, TREE_AGE,
} from '../../content/index.js';
import { ERR, SOFT } from '../../net/protocol.js';
import { V } from '../schema.js';
import { objectOf, tileOwner } from '../grid.js';
import { isReady } from '../time.js';
import {
  intake, grant, stockOf, overflowOf, barnCap, mulBp, starsOf, masteryEffects, startCutBp, cutMs, planBatch,
  targetsOf, oneTarget, MAX_BATCH, proofDeed, useReceipts, playerPerk,
} from '../economy.js';
import { bonusBpNear, effectNear } from './farming.js';
import { relicLuckBp } from '../relics.js';
import { pollinated } from './animals.js';
import { restoreDeed } from './restoration.js';
import { giantAnchorOf, giantChopCode, giantUnits, giantHpAfterChop, chopGiant, chopHp } from './giant.js';

const STROKE = { id: V.opt(V.objId), ids: V.opt(V.list(V.objId, MAX_BATCH)) };
const isTree = (o) => Boolean(o) && defOf(o.def)?.kind === 'tree';
const isDebris = (o) => Boolean(o) && defOf(o.def)?.kind === 'debris';
const rolled = (ctx, bp, ...keys) => bp > 0 && Math.floor(ctx.rng(...keys) * 10_000) < bp;

/**
 * True when tree `o` is one of four trees of its species in an exact 2 x 2 block of trees (a 4 x 4-tile square,
 * GDD §3.2 rule 7). Derived from the grid at harvest time; mixed blocks get nothing.
 */
export function inGrove(state, o, used = null) {
  const [w, d] = defOf(o.def).size;
  const same = (x, z) => {
    const id = tileOwner(state, x, z);
    const t = id && state.farm.objects[id];
    return Boolean(t) && t.def === o.def && t.x === x && t.z === z;
  };
  for (const [ox, oz] of [[0, 0], [-w, 0], [0, -d], [-w, -d]]) {
    const x0 = o.x + ox;
    const z0 = o.z + oz;
    if (same(x0, z0) && same(x0 + w, z0) && same(x0, z0 + d) && same(x0 + w, z0 + d)) {
      // the grove's four trees (RC-08 receipts: a tree bought to complete a grove is used by its harvests)
      const corners = [[x0, z0], [x0 + w, z0], [x0, z0 + d], [x0 + w, z0 + d]];
      if (used) for (const [x, z] of corners) used.add(tileOwner(state, x, z));
      return true;
    }
  }
  return false;
}

/**
 * True when tree `o` is an Heirloom (GDD §3.2 rule 8, M1b): `heirloomAt` harvests made it one for good. Rules-goals'
 * Heirloom Keeper ribbon and the renderer's gnarlier mesh read the same test.
 */
export function isHeirloom(o) {
  const def = treeOf(o.def);
  return Boolean(def) && isLive(GROWTH.heirloom) && Number.isSafeInteger(def.heirloomAt) && o.cycle >= def.heirloomAt;
}

/**
 * A tree's age (wave 4b, owner wish 4): every harvest is a "year" (`cycle`, the harvest counter an old save's trees
 * already carry, so nothing needs a backfill). -> { years, stage, name, bonusUnits, scaleBp, nextAt } where stage is
 * TREE_AGE's id ('young' | 'mature' | 'grand'), bonusUnits the extra fruit per harvest it gives, scaleBp the renderer's
 * size hint and nextAt the year of the next stage (null at the last).
 */
export function treeAgeOf(o) {
  const years = Number.isSafeInteger(o?.cycle) && o.cycle > 0 ? o.cycle : 0;
  const st = TREE_AGE.stages;
  let i = 0;
  while (i + 1 < st.length && years >= st[i + 1].from) i++;
  return { years, stage: st[i].id, name: st[i].name, bonusUnits: st[i].bonusUnits, scaleBp: st[i].scaleBp,
    nextAt: i + 1 < st.length ? st[i + 1].from : null };
}

/** The fruits a Rainbow Tree may give on this farm now: the products of the unlocked basket trees (table order). */
export function rainbowFruits(state) {
  const L = levelFromXp(state.farm.xp);
  const out = [];
  for (const t of live('trees')) {
    if (t.relic || t.tool !== 'basket' || t.unlock > L || !isLive(itemOf(t.product))) continue;
    if (!out.includes(t.product)) out.push(t.product);
  }
  return out;
}

/** The fruit a harvest of tree `o` (`id`) gives: its product, or for a Rainbow Tree one fruit rolled on (id, cycle). */
function fruitOf(state, id, o, def, ctx) {
  if (!def.rainbow) return def.product;
  const pool = rainbowFruits(state);
  return pool.length ? pool[Math.floor(ctx.rng('rainbow', id, o.cycle) * pool.length)] : def.product;
}

/** True when a watering decor that reaches trees (the Golden Sprinkler, a wave-4b relic) stands within reach. */
export const treeSprinklerNear = (state, o, used = null) => effectNear(state, o, 'water',
  (e) => (e.trees ? { radius: e.radius, value: 1 } : null), used) !== null;

/**
 * What harvesting tree `id` gives now (pure). Fruit: yield +1 with Compost, +1 in a Grove, +1 as an Heirloom, +1 on
 * a Bird Bath's chance, +1 on a hive's pollination chance, +1 on the ★3 chance, +1 for a blue-ribbon fruit (Compost:
 * 10 %; an Heirloom 5 % on every harvest; + Gold's points). Keyed by (id, cycle).
 */
export function treeHarvestOf(state, id, ctx, used = null) {
  const o = objectOf(state, id);
  const def = treeOf(o.def);
  const fx = masteryEffects('trees', starsOf(state, o.def));
  const G = GROWTH.compost;
  // the harvester's Orchardist perk counts a tree as an Heirloom from 45 harvests (M2; on their own harvests)
  const perkAt = playerPerk(state, ctx.pid, 'orchardist', 'heirloomAt');
  const heirloom = isHeirloom(o) || (perkAt > 0 && isLive(GROWTH.heirloom) && o.cycle >= perkAt);
  let bonus = 0;
  if (o.compost) bonus += G.treeBonusUnits;
  const age = treeAgeOf(o);
  bonus += age.bonusUnits;                              // wave 4b: an older tree gives more (capped stages)
  const grove = inGrove(state, o, used);
  if (grove) bonus += GROWTH.grove.bonusUnits;
  if (heirloom) bonus += GROWTH.heirloom.bonusUnits;
  if (rolled(ctx, bonusBpNear(state, o, 'trees', used), 'birdbath', id, o.cycle)) bonus += 1;
  if (pollinated(state, o, used) && rolled(ctx, GROWTH.bees.pollinationBp, 'pollen', id, o.cycle)) bonus += 1;
  if (rolled(ctx, fx.bonusUnitBp, 'star3', id, o.cycle)) bonus += 1;
  if (rolled(ctx, playerPerk(state, ctx.pid, 'orchardist', 'bonusFruitBp'), 'perk', id, o.cycle)) bonus += 1;
  // + the Lucky Clover (wave 4b relic): every fruit harvest gets its points, Compost or not
  const ribbonBp = (o.compost ? G.treeRibbonBp : 0) + (heirloom ? GROWTH.heirloom.ribbonBp : 0) + relicLuckBp(state);
  const ribbon = ribbonBp > 0 && rolled(ctx, ribbonBp + fx.ribbonBp, 'ribbon', id, o.cycle);
  if (ribbon) bonus += 1;
  return { item: fruitOf(state, id, o, def, ctx), qty: def.yield + bonus, bonus, ribbon, grove, heirloom, xp: def.xp,
    years: age.years };
}

function treeCode(state, o, ctx, axe) {
  if (!isTree(o)) return ERR.NOT_FOUND;
  if ((treeOf(o.def).tool === 'axe') !== axe) return ERR.BAD_ARGS;      // Pine is chopped, fruit trees are shaken
  if (!isReady(o, ctx.now, ctx.grace)) return ERR.NOT_READY;
  return null;
}

/** Harvest one ripe tree inside `tx` and start its next cycle; emits `picked` or `chopped`. */
function harvestTreeIn(tx, ctx, id) {
  const o = tx.get(['farm', 'objects', id]);
  const def = treeOf(o.def);
  const cycle = o.cycle;                                  // read before the writes (o is live)
  const used = new Set();                                // the Bird Bath, hive and grove trees this harvest used
  const h = treeHarvestOf(tx.state, id, ctx, used);
  intake(tx, h.item, h.qty);
  proofDeed(tx, 'harvest', h.item, h.qty);
  proofDeed(tx, 'collect', h.item, h.qty);
  if (h.ribbon) restoreDeed(tx, ctx, 'prized_fruit', 1);       // the Stone Bridge's Fair Prizes (GDD §5.9)
  // a Golden Sprinkler (wave 4b relic) within reach waters the new cycle at its start, like the rain
  const sprinkled = treeSprinklerNear(tx.state, o, used);
  const cut = startCutBp(tx.state, o.def, ctx.now) + (sprinkled ? GROWTH.water.treeBp : 0);
  const base = ['farm', 'objects', id];
  const before = treeAgeOf(o).stage;
  tx.set([...base, 'cycle'], o.cycle + 1);
  tx.set([...base, 'startedAt'], ctx.now);
  tx.set([...base, 'readyAt'], ctx.now + cutMs(def.cycleMs, cut));
  tx.set([...base, 'cut'], cut);
  for (const k of ['water', 'tend', 'compost', 'rcpt']) tx.del([...base, k]);
  if (sprinkled) tx.set([...base, 'water'], 'sys');
  useReceipts(tx, used);
  if (def.tool === 'axe') tx.emit({ e: 'chopped', id, tree: o.def, item: h.item, qty: h.qty, by: ctx.pid, xp: h.xp });
  else {
    tx.emit({ e: 'picked', id, tree: o.def, item: h.item, qty: h.qty, by: ctx.pid, xp: h.xp, ribbon: h.ribbon,
      grove: h.grove, bonus: h.bonus });
  }
  const at = def.heirloomAt;
  if (isLive(GROWTH.heirloom) && Number.isSafeInteger(at) && cycle + 1 === at) {
    tx.emit({ e: 'heirloom', id, tree: o.def, by: ctx.pid });
  }
  // the tree grew into its next age (wave 4b): the renderer grows it, the tree card says so
  const age = treeAgeOf({ cycle: cycle + 1 });
  if (age.stage !== before) {
    tx.emit({ e: 'treeAged', id, tree: o.def, stage: age.stage, years: age.years, by: ctx.pid });
  }
}

function barnRoom(state) {
  return { room: mulBp(barnCap(state), MARKET.barn.overflowMulBp), held: stockOf(state) + overflowOf(state) };
}

function planTrees(state, a, ctx) {
  const b = barnRoom(state);
  return planBatch(targetsOf(a), (id) => {
    const o = objectOf(state, id);
    const c = treeCode(state, o, ctx, false);
    if (c) return c;
    if (b.held >= b.room) return ERR.STORAGE_FULL;                // the fruit waits on the tree
    b.held += treeHarvestOf(state, id, ctx).qty;
    return null;
  }, SOFT);
}

export const harvestTree = {
  schema: STROKE,
  check(state, a, ctx) {
    if (!oneTarget(a)) return ERR.BAD_ARGS;
    return planTrees(state, a, ctx).code;
  },
  apply(tx, a, ctx) {
    for (const id of planTrees(tx.state, a, ctx).ok) harvestTreeIn(tx, ctx, id);
  },
};

// ---- chop: Pine and debris -----------------------------------------------------------------------------------

/** True when the chop on debris `o` now is a teamwork chop: the previous one was the OTHER player's within 2 s. */
const teamChop = (o, def, ctx) => Boolean(def.teamwork && o.lastChop && o.lastChop.by !== ctx.pid
  && ctx.now - o.lastChop.at <= DEBRIS_RULES.teamworkWindowMs);

/** Damage one chop deals to debris `o` now: 15 when the previous chop was the OTHER player's within 2 s. */
export function chopDamage(o, def, ctx) {
  return teamChop(o, def, ctx) ? DEBRIS_RULES.teamworkChopDamage : DEBRIS_RULES.chopDamage;
}

/**
 * A chop stroke's targets: a Giant's plots stand for its anchor (one chop per Giant per stroke, however many of
 * its tiles the stroke crossed), everything else as given.
 */
const chopTargets = (state, ids) => [...new Set(ids.map((id) => giantAnchorOf(state, id) ?? id))];

function planChop(state, a, ctx) {
  const b = barnRoom(state);
  return planBatch(chopTargets(state, targetsOf(a)), (id) => {
    const o = objectOf(state, id);
    if (isDebris(o)) return null;
    if (o && defOf(o.def)?.kind === 'plot') {
      const c = giantChopCode(state, id, ctx);
      if (c) return c;
      if (giantHpAfterChop(state, id, ctx) <= 0) {                        // this chop fells it: room for the haul
        if (b.held >= b.room) return ERR.STORAGE_FULL;
        b.held += giantUnits(state, id, ctx);
      }
      return null;
    }
    const c = treeCode(state, o, ctx, true);
    if (c) return c;
    if (b.held >= b.room) return ERR.STORAGE_FULL;
    b.held += treeHarvestOf(state, id, ctx).qty;
    return null;
  }, SOFT);
}

export const chop = {
  schema: STROKE,
  check(state, a, ctx) {
    if (!oneTarget(a)) return ERR.BAD_ARGS;
    return planChop(state, a, ctx).code;
  },
  apply(tx, a, ctx) {
    for (const id of planChop(tx.state, a, ctx).ok) {
      const o = tx.get(['farm', 'objects', id]);
      if (defOf(o.def)?.kind === 'plot') { chopGiant(tx, ctx, id); continue; }
      if (!isDebris(o)) { harvestTreeIn(tx, ctx, id); continue; }
      const def = defOf(o.def);
      // felled together (big stumps and boulders, §5.4 Teamwork): the first teamwork chop names the pair for good
      const team = o.team ?? (teamChop(o, def, ctx) ? [o.lastChop.by, ctx.pid].sort() : null);
      const hp = (o.hp ?? chopHp(tx.state, def.hp)) - chopDamage(o, def, ctx);
      if (hp > 0) {
        tx.set(['farm', 'objects', id, 'hp'], hp);
        if (def.teamwork) tx.set(['farm', 'objects', id, 'lastChop'], { by: ctx.pid, at: ctx.now });
        if (team && !o.team) tx.set(['farm', 'objects', id, 'team'], team);
        tx.emit({ e: 'chopHit', id, def: o.def, hp, by: ctx.pid });
        continue;
      }
      const xp = def.xp[o.origin] ?? 0;
      const coins = xp * DEBRIS_RULES.coinsPerXp;
      tx.del(['farm', 'objects', id]);
      if (coins > 0) grant(tx, ctx, coins, 'debris');
      if (def.wood > 0) intake(tx, 'wood', def.wood);
      const ev = { e: 'cleared', id, def: o.def, by: ctx.pid, xp, coins, origin: o.origin };
      if (def.wood > 0) Object.assign(ev, { item: 'wood', qty: def.wood });
      if (team) Object.assign(ev, { team: true, pair: team });
      tx.emit(ev);
    }
  },
};
