// The QA player ("bot" is only the mechanism): decides what a sensible Harvest Hollow player does with the
// attention of ONE minute, from the replicated state alone, and issues it through a client object.
//
//   client = { pid, snap() -> { s, now }, act(type, args) -> { ok, code } }       (async; s is read-only)
//
// It is used by tools/qa-playtest.mjs (real browsers: client = a page's window.__hh) and by tools/qa-bot-sim.mjs
// (in-process Engine, no browser, for tuning the policy fast). Nothing here touches the DOM or the disk.
//
// What the player does, in priority order (each op costs attention; a minute has OPS_PER_MINUTE of it):
//   1. keeps the Barn from overflowing (Sell surplus, like the Barn banner's button);
//   2. collects what is ready (ripe plots, hens/cows, building trays, ripe trees) and delivers what is fillable
//      (Mabel's orders, finished story cards that deliver goods, the daily gift);
//   3. does what the story cards, orders, the Almanac and the Goal Tracker ask: builds the building, buys the
//      animal, makes the recipe (and, recursively, its inputs: flour needs wheat), plants the crop;
//   4. keeps the engines running: Chicken Feed in the Feed Mill, hens fed, idle plots planted;
//   5. spends coins on what makes the farm bigger (hens, plots, barn upgrades, trees, land) and sells surplus.
// Whatever the player wanted to do but could not is reported (`blocked`), as is any minute with attention left
// over and nothing useful to do (`idle`).
import {
  CONTENT, itemOf, cropOf, recipeOf, feedOf, animalOf, treeOf, levelFromXp, liveAt, isLive, defOf, plotCapOf,
  recipesOf, expansionOf, ORDERS, MARKET, GROWTH, ALMANAC, COOP,
} from '../shared/content/index.js';
import { goals } from '../shared/rules/goals.js';
import { ACTIONS } from '../shared/rules/index.js';
import { available, stockOf, overflowOf, barnCap, canIntake, unkept } from '../shared/rules/economy.js';
import { producers, canMake, fillable } from '../shared/rules/orders-board.js';
import { taskProgress, questReady, isAdult, isStateTask } from '../shared/rules/actions/quests.js';
import { canPlace, occupantsOf, capacityOf } from '../shared/rules/grid.js';
import { buyPrice } from '../shared/rules/actions/decor.js';
import { animalPrice } from '../shared/rules/actions/animals.js';
import { surplusOf } from '../shared/rules/actions/market.js';
import { nextExpansion, expandCode, proofProgress } from '../shared/rules/actions/expansions.js';
import { sortedKeys } from '../shared/rules/order.js';
import { dayOf } from '../shared/rules/coop.js';
import { dockedBarge } from '../shared/rules/actions/barge.js';

export const OPS_PER_MINUTE = 12;
const MIN = 60_000;
const SOFT_CODES = new Set(['BIG_SPEND', 'RESERVED', 'PINNED']);
const COST = { place: 3, buyAnimal: 2, openExpansion: 1, expand: 2 };
/** The NOW card is followed at most this often per player (see candidates). */
const FOLLOW_GAP_MS = 4 * 60_000;
const followAt = new Map();      // `${farmSeed}:${pid}` -> sim time of the last followed NOW card

const ents = (S) => sortedKeys(S.farm.objects).map((id) => [id, S.farm.objects[id]]);
const defKind = (o) => defOf(o.def)?.kind;
const have = (S, item) => available(S, item);

/** Everything the player looks at before choosing, computed once per decision. */
function look(S, now, pid) {
  const objs = ents(S);
  const L = levelFromXp(S.farm.xp);
  const v = { L, now, plots: [], ripe: [], idle: [], growing: [], animals: [], homes: [], buildings: [], trees: [],
    debris: [], byDef: new Map() };
  for (const [id, o] of objs) {
    v.byDef.set(o.def, (v.byDef.get(o.def) ?? 0) + 1);
    const k = defKind(o);
    if (k === 'plot') {
      v.plots.push([id, o]);
      if (!o.crop) v.idle.push([id, o]);
      else if (o.crop.readyAt <= now) v.ripe.push([id, o]);
      else v.growing.push([id, o]);
    } else if (typeof o.home === 'string') v.animals.push([id, o]);
    else if (k === 'home') v.homes.push([id, o]);
    else if (k === 'building') v.buildings.push([id, o]);
    else if (k === 'tree') v.trees.push([id, o]);
    else if (k === 'debris') v.debris.push([id, o]);
  }
  v.P = producers(S, now);
  v.me = S.players[pid];
  return v;
}

/** Items already on their way: queued/finished goods in buildings, ripe or growing crops. */
function pendingOf(S, v, item) {
  const it = itemOf(item);
  if (!it) return 0;
  let n = 0;
  if (it.kind === 'crop') {
    const c = cropOf(it.source);
    for (const [, o] of v.plots) if (o.crop && o.crop.def === c.id) n += c.yield;
  } else if (it.kind === 'craft' || it.kind === 'consumable' || it.kind === 'feed') {
    const r = recipeOf(it.source) ?? feedOf(it.source);
    if (r) for (const [, o] of v.buildings) for (const q of o.queue ?? []) if (q.r === r.id) n += r.out ?? 1;
  }
  return n;
}

/** A free spot for a def near (cx, cz): spiral search over legal tiles. */
export function findSpot(S, defId, cx, cz, rot = 0) {
  for (let r = 0; r < 26; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (canPlace(S, defId, cx + dx, cz + dz, rot) === null) return { x: cx + dx, z: cz + dz, rot };
      }
    }
  }
  return null;
}

/** A spot for one more plot: next to the existing field when there is room, else the nearest legal tile. */
function findPlotSpot(S, v) {
  const a = anchor(v);
  const near = (x, z) => v.plots.some(([, o]) => Math.max(Math.abs(o.x - x), Math.abs(o.z - z)) <= 1);
  let any = null;
  for (let r = 0; r < 14; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = a.x + dx;
        const z = a.z + dz;
        if (canPlace(S, 'plot', x, z, 0) !== null) continue;
        if (near(x, z)) return { x, z, rot: 0 };
        any ??= { x, z, rot: 0 };
      }
    }
  }
  return any;
}

/** The centre of the plot field, the anchor everything else is placed around. */
function anchor(v) {
  if (!v.plots.length) return { x: 26, z: 31 };
  let sx = 0;
  let sz = 0;
  for (const [, o] of v.plots) { sx += o.x; sz += o.z; }
  return { x: Math.round(sx / v.plots.length), z: Math.round(sz / v.plots.length) };
}

// ---- the plan: wants ----------------------------------------------------------------------------------------------

/**
 * What the player wants, derived from the story cards, orders, the Almanac and the engines. `crops` is units to
 * harvest (planted first), `crafts` recipes to queue (with how many batches), `buys` purchases to make, `sells`
 * what a card asks to sell, `animals` products to collect, `blockedWants` what cannot be pursued and why.
 */
/** [item, qty] of every open crate of the docked barge's offered rows. */
function bargeAsks(S, now) {
  const b = dockedBarge(S, now);
  if (!b || !b.rows) return [];
  return Object.entries(b.crates ?? {}).filter(([i, c]) => !c.by && Number(i) < b.rows * 3).map(([, c]) => [c.item, c.qty]);
}

function wantsOf(S, v, pid, now) {
  const W = { crops: new Map(), crafts: [], buys: [], placeFree: [], sells: [], animalGoods: new Map(), clear: 0,
    why: new Map(), notes: [] };
  const addCrop = (crop, units, why) => {
    W.crops.set(crop, (W.crops.get(crop) ?? 0) + units);
    if (!W.why.has(`crop:${crop}`)) W.why.set(`crop:${crop}`, why);
  };
  const seen = new Set();
  /** Ensure `qty` of `item` will exist: crops are planted, recipes queued (inputs first, recursively). */
  const need = (item, qty, why, depth = 0) => {
    const gap = qty - have(S, item) - pendingOf(S, v, item);
    if (gap <= 0 || depth > 6) return;
    const it = itemOf(item);
    if (!it) return;
    if (it.kind === 'crop') { addCrop(it.source, gap, why); return; }
    if (it.kind === 'craft' || it.kind === 'consumable' || it.kind === 'feed') {
      const r = recipeOf(it.source) ?? feedOf(it.source);
      if (!r || !isLive(r) || r.unlock > v.L) { W.notes.push(`${item}: recipe not unlocked`); return; }
      if (!(v.P.owned.get(r.building) > 0)) {
        W.notes.push(`${item}: no ${r.building}`);
        if (!W.buys.some((b) => b.def === r.building)) W.buys.push({ kind: 'place', def: r.building, why: `a ${r.building} for ${item}`, quest: false });
        return;
      }
      const out = r.out ?? 1;
      const batches = Math.ceil(gap / out);
      W.crafts.push({ r, batches, why, item });
      if (r.inputs) {
        for (const [i, q] of Object.entries(r.inputs)) need(i, q * batches, why, depth + 1);
      } else if (r.classes) {
        for (const { cls, qty: q } of r.classes) needClass(cls, q * batches, why, depth + 1);
      }
      return;
    }
    if (it.kind === 'animal') { W.animalGoods.set(item, (W.animalGoods.get(item) ?? 0) + gap); return; }
    if (it.kind === 'fruit') { W.animalGoods.set(item, (W.animalGoods.get(item) ?? 0) + gap); return; }
    W.notes.push(`${item}: no producer plan for kind ${it.kind}`);
  };
  /** A feed class (grain, root, produce): the cheapest live member, or whatever is already in the Barn. */
  const needClass = (cls, qty, why, depth) => {
    const members = CONTENT.items ? [...CONTENT.items.values()].filter((i) => (i.classes ?? []).includes(cls)) : [];
    const inStock = members.reduce((n, i) => n + unkept(S, i.id), 0);
    if (inStock >= qty) return;
    const crop = members.filter((i) => i.kind === 'crop' && isLive(cropOf(i.source)) && cropOf(i.source).unlock <= v.L)
      .sort((a, b) => a.sell - b.sell)[0];
    if (crop) addCrop(crop.source, qty - inStock, why);
  };
  W.need = need;

  // 1. story cards
  for (const qid of sortedKeys(S.farm.quests.active)) {
    const q = CONTENT.quests.get(qid);
    q.tasks.forEach((t, i) => {
      const p = taskProgress(S, qid, i, now);
      if (p.done) return;
      const left = t.qty - p.have;
      const why = `${q.title}`;
      switch (t.verb) {
        case 'plant':
          if (CONTENT.trees.has(t.ref)) W.buys.push({ kind: 'tree', def: t.ref, why });
          else if (CONTENT.crops.has(t.ref)) addCrop(t.ref, left * cropOf(t.ref).yield, why);
          break;
        case 'harvest':
          if (CONTENT.crops.has(t.ref)) addCrop(t.ref, left, why);
          break;
        case 'make': {
          const it = itemOf(t.ref);
          if (!it) break;
          // an event verb: only crafting counts, so stock does not satisfy it
          const r = recipeOf(it.source) ?? feedOf(it.source);
          if (r && isLive(r) && r.unlock <= v.L && v.P.owned.get(r.building) > 0) {
            const queued = pendingOf(S, v, t.ref);
            const gap = left - queued;
            if (gap > 0) {
              W.crafts.push({ r, batches: Math.ceil(gap / (r.out ?? 1)), why, item: t.ref, quest: true });
              for (const [ii, qq] of Object.entries(r.inputs ?? {})) need(ii, qq * Math.ceil(gap / (r.out ?? 1)), why, 1);
              for (const { cls, qty: qq } of r.classes ?? []) needClass(cls, qq * Math.ceil(gap / (r.out ?? 1)), why, 1);
            }
          } else {
            W.notes.push(`${q.title}: make ${t.ref} (no ${r ? r.building : 'recipe'} or locked)`);
            // a player reads "Make 4 Planks" and goes looking for the building that makes planks
            if (r && isLive(r) && r.unlock <= v.L && !(v.P.owned.get(r.building) > 0)) {
              W.buys.push({ kind: 'place', def: r.building, why: `${q.title}: needs a ${r.building}`, quest: true });
            }
          }
          break;
        }
        case 'collect': {
          const it = itemOf(t.ref);
          if (!it) break;
          W.animalGoods.set(t.ref, Math.max(W.animalGoods.get(t.ref) ?? 0, left));
          break;
        }
        case 'sell':
          if (t.ref === 'demand') W.sells.push({ demand: true, qty: left, why });
          else { W.sells.push({ item: t.ref, qty: left, why }); need(t.ref, left, why); }
          break;
        case 'deliver': need(t.ref, t.qty, why); break;
        case 'place': case 'build': case 'own':
          W.buys.push({ kind: 'place', def: t.ref, why, quest: true });
          break;
        case 'buy': case 'raise':
          W.buys.push({ kind: 'animal', def: t.ref, why, quest: true });
          break;
        case 'clear': W.clear = Math.max(W.clear, left); break;
        case 'fertilize': W.fertilize = Math.max(W.fertilize ?? 0, left); break;
        case 'expand': W.buys.push({ kind: 'expand', def: t.ref, why }); break;
        default: break;
      }
    });
  }
  // 2. Mabel's orders: pursue the ones whose every item is makeable, cheapest first, at most two at a time
  const open = [];
  for (const k of sortedKeys(S.farm.orders.slots)) {
    const o = S.farm.orders.slots[k].order;
    if (!o || fillable(S, o)) continue;
    const items = Object.keys(o.items);
    if (!items.every((i) => canMake(S, v.P, i))) continue;
    const mins = items.reduce((m, i) => {
      const it = itemOf(i);
      if (it.kind === 'crop') return m + cropOf(it.source).growMs / MIN;
      if (it.kind === 'craft') return m + (recipeOf(it.source)?.ms ?? 0) / MIN * Math.ceil(o.items[i] / (recipeOf(it.source)?.out ?? 1));
      return m + 20;
    }, 0);
    open.push({ k, o, mins });
  }
  open.sort((a, b) => (b.o.golden ? 1 : 0) - (a.o.golden ? 1 : 0) || a.mins - b.mins);
  for (const { o } of open.slice(0, 2)) for (const [i, q] of Object.entries(o.items)) need(i, q, 'order');
  // 2b. the barge crates the Goal Tracker's SOON cards name: a couple makes what Captain Reed asks for (QA2
  // integration: the playtest bot only loaded what happened to be in the Barn, and never loaded a crate in two weeks).
  // real-sim plans every weekly good itself through its hooks.
  if (!globalThis.__HH_EXTRA_NEEDS) for (const [i, q] of bargeAsks(S, now)) need(i, q, 'barge crate');
  // 3. the Almanac (from ALMANAC.unlock, L3 since wave 2): the first ALMANAC.paidPerDay a day pay
  const al = v.me?.almanac;
  if (al && v.L >= ALMANAC.unlock && al.paid < ALMANAC.paidPerDay) {
    for (const slot of sortedKeys(al.tasks)) {
      const t = al.tasks[slot];
      if (t.n >= t.qty) continue;
      const left = t.qty - t.n;
      if (t.verb === 'harvest' && CONTENT.crops.has(t.ref)) addCrop(t.ref, left, 'Almanac');
      else if (t.verb === 'plant' && CONTENT.crops.has(t.ref)) addCrop(t.ref, left, 'Almanac');
      else if (t.verb === 'clear') W.clear = Math.max(W.clear, left);
    }
  }
  // 3b. the workshops: keep every free slot busy with the recipe that pays best per minute (a player's habit)
  for (const [, b] of v.buildings) {
    if (b.def === 'feed_mill' || b.def === 'compost_bin') continue;
    const free = b.slots - (b.queue ?? []).length;
    if (free <= 0) continue;
    let best = null;
    for (const r of recipesOf(b.def)) {
      if (!isLive(r) || r.unlock > v.L || r.duet) continue;
      const inputs = Object.entries(r.inputs ?? {});
      if (!inputs.every(([i]) => canMake(S, v.P, i))) continue;
      const cost = inputs.reduce((n, [i, q]) => n + q * (itemOf(i)?.sell ?? 0), 0);
      const outV = (itemOf(r.id)?.sell ?? 0) * (r.out ?? 1);
      const fresh = (S.farm.stats[`craft.${r.id}`] ?? 0) === 0 ? 1.5 : 1;
      const gain = (outV - cost + 8 * r.xp) * fresh / Math.max(5, r.ms / MIN);
      if (gain > 0 && (!best || gain > best.gain)) best = { r, gain };
    }
    if (best) {
      const times = Math.min(free, 2);
      W.crafts.push({ r: best.r, batches: times, why: 'workshop', item: best.r.id, engine: true });
      for (const [i, q] of Object.entries(best.r.inputs ?? {})) need(i, q * times, 'workshop', 1);
    }
  }
  // 3c. growth: the Barn upgrade and the next land want Planks (and Crates); the land also wants its proof tasks done
  const nb = CONTENT.barn.find((b) => b.n === (S.farm.barn ?? 0) + 1);
  if (nb && v.L >= nb.unlock && stockOf(S) + overflowOf(S) >= barnCap(S) * 0.6) {
    if (nb.planks > 0) need('planks', nb.planks, 'Barn upgrade');
    if (nb.crates > 0) need('wooden_crate', nb.crates, 'Barn upgrade');
  }
  const nxe = nextExpansion(S);
  if (nxe && v.L >= nxe.unlock) {
    if (nxe.planks > 0) need('planks', nxe.planks, `land ${nxe.id}`);
    if (nxe.crates > 0) need('wooden_crate', nxe.crates, `land ${nxe.id}`);
    if (Object.hasOwn(S.farm.proofs, nxe.id)) {
      nxe.proof.forEach((t, i) => {
        const p = proofProgress(S, nxe.id, i);
        if (p.done) return;
        const left = t.qty - p.have;
        const ref = Array.isArray(t.ref) ? t.ref[0] : t.ref;
        const why = `land ${nxe.id}: ${t.verb} ${ref}`;
        if (t.verb === 'harvest' && CONTENT.crops.has(ref)) addCrop(ref, left, why);
        else if (t.verb === 'collect') W.animalGoods.set(ref, Math.max(W.animalGoods.get(ref) ?? 0, left));
        else if (t.verb === 'make') {
          const it = itemOf(ref);
          const r = it && (recipeOf(it.source) ?? feedOf(it.source));
          if (r && isLive(r) && r.unlock <= v.L && v.P.owned.get(r.building) > 0) {
            const queued = pendingOf(S, v, ref);
            const gap = left - queued;
            if (gap > 0) {
              W.crafts.push({ r, batches: Math.ceil(gap / (r.out ?? 1)), why, item: ref, quest: true });
              for (const [ii, qq] of Object.entries(r.inputs ?? {})) need(ii, qq * Math.ceil(gap / (r.out ?? 1)), why, 1);
            }
          } else if (r && isLive(r) && r.unlock <= v.L && !(v.P.owned.get(r.building) > 0)) W.buys.push({ kind: 'place', def: r.building, why, quest: true });
        } else if (t.verb === 'own') W.buys.push({ kind: t.ref in Object.fromEntries([...CONTENT.trees.keys()].map((k) => [k, 1])) ? 'tree' : 'place', def: ref, why, quest: true });
      });
    }
  }
  // 4. the engines: feed for the animals
  for (const [, h] of v.homes) {
    const sp = defOf(h.def).species?.[0];
    const a = animalOf(sp);
    if (!a || !a.feed) continue;
    const n = v.animals.filter(([, o]) => o.home && S.farm.objects[o.home]?.def === h.def).length;
    if (n > 0) need(a.feed, Math.max(a.feedQty * n * 2, 6), 'feed');
  }
  void seen;
  return W;
}

// ---- candidate operations -------------------------------------------------------------------------------------------

/** Crops by value per attention: (what a plot yields + 8 per XP - the seed) / how long it occupies the plot. */
function cropRate(c, revisitMin) {
  const value = c.yield * c.sell + 8 * c.xp - c.seed;
  return value / Math.max(c.growMs / MIN, revisitMin);
}

/** The crops to fill `n` idle plots with: needed ones first, then the best rate that fits the time left. */
function fillPlan(S, v, W, n, budget, minsLeft, wrap, ctx0 = {}) {
  const plan = [];
  let left = n;
  let coins = budget;
  const put = (crop, count) => {
    const c = cropOf(crop);
    const afford = Math.floor(coins / c.seed);
    const k = Math.max(0, Math.min(count, left, afford));
    if (k > 0) { plan.push({ crop, n: k }); left -= k; coins -= k * c.seed; }
  };
  for (const [crop, units] of W.crops) {
    const c = cropOf(crop);
    if (c.unlock > v.L || !isLive(c)) continue;
    // plots already growing this crop count toward the need
    const growing = v.growing.filter(([, o]) => o.crop.def === crop).length * c.yield;
    const gap = units - growing;
    if (gap > 0) put(crop, Math.ceil(gap / c.yield));
  }
  if (left > 0) {
    const cands = liveAt('crops', v.L).filter((c) => c.growMs <= 24 * 60 * MIN);
    if (wrap) {
      // last minutes of the evening: whatever grows while the couple is away, the most valuable the coins allow
      cands.sort((a, b) => (b.yield * b.sell + 8 * b.xp - b.seed) - (a.yield * a.sell + 8 * a.xp - a.seed));
      for (const c of cands) if (c.growMs >= 60 * MIN) put(c.id, left);
    } else {
      // style 'grind': the attentive player who keeps every plot on the fastest crop (a click-heavy evening)
      // a couple at the farm for the evening plants what ripens at least twice before they log off (a crop that
      // ripens once, at the very end, leaves the plots and the players idle for half the evening)
      const fit = cands.filter((c) => c.growMs <= Math.max(2, minsLeft / 2) * MIN);
      if (ctx0.style === 'grind') fit.sort((a, b) => a.growMs - b.growMs || b.xp - a.xp);
      else {
        fit.sort((a, b) => cropRate(b, 4) - cropRate(a, 4));
        // a couple keeps a quick field going beside the money crop: a quarter of a big planting on the best crop that
        // ripens within a quarter hour, so there is something to harvest while the long crops grow
        const quick = fit.filter((c) => c.growMs >= 2 * MIN && c.growMs <= 15 * MIN);
        if (left >= 8 && minsLeft >= 20 && quick.length && quick[0] !== fit[0]) put(quick[0].id, Math.floor(left / 4));
      }
      for (const c of fit) { if (left > 0 && c.seed <= coins) put(c.id, left); }
    }
    if (left > 0) put('wheat', left);
  }
  return plan;
}

/**
 * All candidate operations now, as { key, type, args, prio, cost, why, dom }. Highest prio first. `ctx` carries the
 * session (minsLeft, wrap), what the partner just did (so the two share the work) and what already failed.
 */
export function candidates(S, now, pid, ctx = {}) {
  const v = look(S, now, pid);
  const W = wantsOf(S, v, pid, now);
  const c = [];
  const push = (o) => c.push({ cost: 1, ...o, key: o.key ?? `${o.type}:${JSON.stringify(o.args)}` });
  const coins = S.farm.wallet.coins;
  const dom = ctx.dom ?? {};

  // -- the Barn ------------------------------------------------------------------------------------------------------
  const held = stockOf(S) + overflowOf(S);
  if (held >= barnCap(S) * 0.9 || !canIntake(S)) {
    if (surplusOf(S, now).length) push({ type: 'sellSurplus', args: {}, prio: 98, why: 'the Barn is nearly full', dom: 'market' });
    else W.notes.push('barn full and nothing sellable above the keep line');
  }

  // -- collect ---------------------------------------------------------------------------------------------------------
  if (v.ripe.length) {
    // the rules take at most economy MAX_BATCH (100) ids per stroke; the next 100 go on the next tick
    push({ type: 'harvest', args: { ids: v.ripe.slice(0, 100).map(([id]) => id) }, prio: 90, why: `${v.ripe.length} ripe plots`, dom: 'fields' });
  }
  for (const [hid, h] of v.homes) {
    const occ = occupantsOf(S, hid);
    const a = animalOf(defOf(h.def).species?.[0]);
    const grown = occ.filter((id) => isAdult(S.farm.objects[id], now));
    const ready = grown.filter((id) => S.farm.objects[id].readyAt !== null && S.farm.objects[id].readyAt <= now);
    const hungry = grown.filter((id) => S.farm.objects[id].readyAt === null);
    const feedOk = a && have(S, a.feed) >= a.feedQty;
    if (ready.length) {
      push({ type: feedOk ? 'tend' : 'collect', args: { id: hid }, prio: 88, why: `${ready.length} ${a.product} ready${feedOk ? ' + re-feed' : ''}`, dom: 'barnyard',
        key: `${feedOk ? 'tend' : 'collect'}:${hid}` });
    } else if (hungry.length && feedOk) {
      push({ type: 'feed', args: { id: hid }, prio: 86, why: `${hungry.length} hungry`, dom: 'barnyard', key: `feed:${hid}` });
    }
    // babies get a bottle when the Barn has one
    for (const id of occ) {
      const o = S.farm.objects[id];
      const an = animalOf(o.def);
      const spare = have(S, an.bottle) - (an.feedQty * occ.length + 4);
      // a player sees the bottle button's state (cooldown, nothing left to save): only a bottle the rules take
      if (!isAdult(o, now) && spare > 0 && unkept(S, an.bottle) > 0 && (o.adultAt - now) > 5 * MIN
        && ACTIONS.bottle.check(S, { id }, { pid, now, grace: 0 }) === null) {
        push({ type: 'bottle', args: { id }, prio: 60, why: 'bottle for a baby', dom: 'barnyard', key: `bottle:${id}` });
      }
    }
  }
  for (const [bid, b] of v.buildings) {
    if ((b.queue ?? []).some((q) => q.e <= now)) push({ type: 'collectTray', args: { id: bid }, prio: 87, why: `${b.def} tray`, dom: 'workshop', key: `collectTray:${bid}` });
  }
  const ripeTrees = v.trees.filter(([, o]) => Number.isSafeInteger(o.readyAt) && o.readyAt <= now && (!Number.isSafeInteger(o.matureAt) || o.matureAt <= now));
  const fruitTrees = ripeTrees.filter(([, o]) => treeOf(o.def).tool !== 'axe');
  const pineTrees = ripeTrees.filter(([, o]) => treeOf(o.def).tool === 'axe');
  if (fruitTrees.length) push({ type: 'harvestTree', args: { ids: fruitTrees.slice(0, 100).map(([id]) => id) }, prio: 84, why: 'ripe fruit', dom: 'orchard' });
  if (pineTrees.length && (have(S, 'wood') < 12)) push({ type: 'chop', args: { ids: pineTrees.slice(0, 100).map(([id]) => id) }, prio: 70, why: 'ripe pine', dom: 'orchard' });

  // -- deliver -----------------------------------------------------------------------------------------------------------
  for (const k of sortedKeys(S.farm.orders.slots)) {
    const o = S.farm.orders.slots[k].order;
    if (o && fillable(S, o)) push({ type: 'orderFill', args: { slot: Number(k), n: o.n }, prio: o.golden ? 92 : 89, why: `order ${Object.entries(o.items).map(([i, q]) => `${q} ${i}`).join(', ')}`, dom: 'market', key: `orderFill:${k}` });
  }
  for (const qid of sortedKeys(S.farm.quests.active)) {
    const q = CONTENT.quests.get(qid);
    if (q.tasks.some((t) => t.verb === 'deliver') && questReady(S, qid, now)) {
      push({ type: 'questDeliver', args: { id: qid }, prio: 91, why: `hand in ${q.title}`, dom: 'market' });
    }
  }
  const gift = S.farm.daily?.gift;
  if (gift && v.L >= 3 && gift.last !== S.farm.daily.day) push({ type: 'claimGift', args: {}, prio: 55, why: 'daily gift', dom: 'market' });

  // -- story-driven purchases and placements -------------------------------------------------------------------------
  const a0 = anchor(v);
  for (const b of W.buys) {
    if (b.kind === 'place') {
      const def = defOf(b.def);
      if (!def) continue;
      const owned = (v.byDef.get(b.def) ?? 0);
      if (owned >= 1 && b.quest && !CONTENT.quests) continue;
      if (owned >= 1) continue;
      const tray = (S.farm.storage[b.def] ?? 0) > 0;
      const price = tray ? { coins: 0, code: null } : buyPrice(S, b.def);
      if (price.code) { W.notes.push(`${b.why}: ${b.def} not buyable (${price.code})`); continue; }
      if (price.coins > coins) { ctx.saving = Math.max(ctx.saving ?? 0, price.coins); W.notes.push(`saving ${price.coins} for ${b.def}`); continue; }
      const spot = findSpot(S, b.def, a0.x + (def.kind === 'building' ? 7 : 5), a0.z - 2);
      if (!spot) { W.notes.push(`no room for ${b.def}`); continue; }
      push({ type: 'place', args: { def: b.def, ...spot}, prio: 83, cost: COST.place, why: `${b.why}: place ${b.def} (${price.coins} coins)`, dom: 'workshop', key: `place:${b.def}` });
    } else if (b.kind === 'animal') {
      const def = animalOf(b.def);
      if (!def) continue;
      const homeOk = [...v.homes].some(([hid, h]) => def.homes.includes(h.def) && occupantsOf(S, hid).length < capacityOf(S, hid));
      if (!homeOk) {
        const hd = def.homes[0];
        if (!(v.byDef.get(hd) > 0)) W.buys.push({ kind: 'place', def: hd, why: `${b.why}: home for ${b.def}`, quest: true });
        continue;
      }
      const price = animalPrice(S, b.def, false);
      if (price > coins) { ctx.saving = Math.max(ctx.saving ?? 0, price); continue; }
      const owned = v.animals.filter(([, o]) => o.def === b.def).length;
      const t = CONTENT.quests && null;
      void t;
      if (owned >= 1 && b.quest) {
        // 'raise' / 'buy N': keep buying until the card is done (the card re-lists itself while unfinished)
      }
      push({ type: 'buyAnimal', args: { def: b.def}, prio: 82, cost: COST.buyAnimal, why: `${b.why}: buy ${b.def}`, dom: 'barnyard', key: `buyAnimal:${b.def}` });
    } else if (b.kind === 'tree') {
      const tray = (S.farm.storage[b.def] ?? 0) > 0;
      const price = tray ? { coins: 0, code: null } : buyPrice(S, b.def);
      if (price.code || price.coins > coins) { if (!price.code) ctx.saving = Math.max(ctx.saving ?? 0, price.coins); continue; }
      const spot = findSpot(S, b.def, a0.x - 5, a0.z + 6);
      if (spot) push({ type: 'place', args: { def: b.def, ...spot}, prio: 81, cost: COST.place, why: `${b.why}: plant ${b.def}`, dom: 'orchard', key: `place:${b.def}` });
    } else if (b.kind === 'expand') {
      const code = expandCode(S, b.def);
      const ex = expansionOf(b.def);
      if (!code && ex.cost > coins) ctx.saving = Math.max(ctx.saving ?? 0, ex.cost);
      else if (!code) push({ type: 'expand', args: { expansion: b.def }, prio: 80, cost: COST.expand, why: `${b.why}: buy the land`, dom: 'market' });
      else if (code === 'NOT_READY' && !Object.hasOwn(S.farm.proofs, b.def)) push({ type: 'openExpansion', args: { expansion: b.def }, prio: 50, why: `${b.why}: open the land card`, dom: 'market' });
    }
  }
  // free things Grandma gave that wait in the build tray (the cards' windmill, saplings, decor): place them
  for (const defId of sortedKeys(S.farm.storage)) {
    const d = defOf(defId);
    if (!d || !(S.farm.storage[defId] > 0)) continue;
    if (!['building', 'tree', 'home', 'decor'].includes(d.kind)) continue;
    const spot = findSpot(S, defId, a0.x + 6, a0.z + 5);
    if (spot) push({ type: 'place', args: { def: defId, ...spot }, prio: 78, cost: COST.place, why: `place ${defId} from the build tray`, dom: 'workshop', key: `place-tray:${defId}` });
  }
  // Golden Hour (GDD §1.5 minutes 45-55, §7.4 "before you log off"): from its level, in the last 15 minutes both sit
  {
    const gh = COOP.goldenHour;
    const last = S.farm.coop?.goldenAt ?? null;
    const seated = S.farm.coop?.bench?.[pid];
    // ... or as soon as a card asks for it (the Together card H1 "Sit together for Golden Hour")
    const asked = Object.keys(S.farm.quests?.active ?? {}).some((q) => CONTENT.quests.get(q)?.tasks.some((t) => t.ref === 'bench'));
    if (v.L >= gh.unlock && ((ctx.minsLeft ?? 99) <= 15 || asked) && !seated && (last === null || now - last >= gh.sessionGapMs)) {
      // Grandpa's Sunset Bench first (the one the tutorial sits on), else any two-seat bench
      const bench = ents(S).find(([, o]) => o.def === 'sunset_bench') ?? ents(S).find(([, o]) => defOf(o.def)?.effect?.seats === 2);
      if (bench) push({ type: 'sit', args: { id: bench[0] }, prio: 96, why: 'Golden Hour on the bench', dom: 'farm', key: 'sit' });
    }
  }
  // the tutorial's free coop / feed mill / windmill are bought at 0 coins through the same Market path
  for (const defId of ['coop', 'feed_mill', 'mill']) {
    const d = defOf(defId);
    if (!d || d.unlock > v.L || (v.byDef.get(defId) ?? 0) >= 1) continue;
    if ((S.farm.storage[defId] ?? 0) > 0) continue;
    const cardWants = W.buys.some((b) => b.def === defId) || defId === 'feed_mill' || defId === 'coop';
    const price = buyPrice(S, defId);
    if (price.code || !cardWants || price.coins > coins) continue;
    if (W.buys.some((b) => b.def === defId)) continue;                    // handled above
    const spot = findSpot(S, defId, a0.x + (defId === 'coop' ? -6 : -6), a0.z + (defId === 'coop' ? 1 : 6));
    if (spot) push({ type: 'place', args: { def: defId, ...spot}, prio: 77, cost: COST.place, why: `place the free ${defId}`, dom: 'workshop', key: `place:${defId}` });
  }

  // -- crafts ------------------------------------------------------------------------------------------------------------
  const queuedHere = new Map();
  for (const w of W.crafts) {
    const r = w.r;
    const bs = v.buildings.filter(([, b]) => b.def === r.building);
    if (!bs.length) continue;
    const key = `craft:${r.id}`;
    if (c.some((x) => x.key === key)) continue;
    // one batch when the inputs are all in the Barn; more batches when the stock is there and the slots are free
    const free = bs.map(([bid, b]) => [bid, b.slots - b.queue.length]).filter(([, f]) => f > 0);
    if (!free.length) continue;
    const inputs = r.inputs ?? {};
    const classes = r.classes ?? [];
    const okInputs = Object.entries(inputs).every(([i, q]) => have(S, i) >= q)
      && classes.every(({ cls, qty }) => [...CONTENT.items.values()].filter((i) => (i.classes ?? []).includes(cls)).reduce((n, i) => n + unkept(S, i.id), 0) >= qty);
    if (!okInputs) continue;
    const [bid] = free[0];
    queuedHere.set(r.id, (queuedHere.get(r.id) ?? 0) + 1);
    push({ type: 'craft', args: { id: bid, recipe: r.id }, prio: w.quest ? 80 : r.building === 'feed_mill' ? 79 : w.engine ? 55 : 74, why: `${w.why}: ${r.id}`, dom: 'workshop', key });
  }

  // -- plant -------------------------------------------------------------------------------------------------------------
  if (v.idle.length) {
    const reserve = Math.min(ctx.saving ?? 0, coins * 0.5);
    const budget = Math.max(Math.min(coins - reserve, coins * 0.7), Math.min(coins, v.idle.length * 2));
    const plan = fillPlan(S, v, W, v.idle.length, budget, ctx.minsLeft ?? 30, Boolean(ctx.wrap), ctx);
    let at = 0;
    const ids = v.idle.map(([id]) => id);
    for (const { crop, n } of plan) {
      push({ type: 'plant', args: { ids: ids.slice(at, at + n), crop }, prio: 80, why: `${n} x ${crop}${W.crops.has(crop) ? ` (${W.why.get(`crop:${crop}`)})` : ''}`, dom: 'fields', key: `plant:${crop}` });
      at += n;
    }
  }

  // -- water, pet, compost: the small things a player does between the big ones --------------------------------------------------
  if (v.L >= 4) {
    const wet = v.growing.filter(([, o]) => {
      if (cropOf(o.crop.def).growMs < GROWTH.water.minCropMs) return false;
      if (o.crop.water === undefined) return true;
      return o.crop.tend === undefined && o.crop.water !== pid && o.crop.water !== 'sys';
    });
    if (wet.length) push({ type: 'water', args: { ids: wet.slice(0, 100).map(([id]) => id) }, prio: 52, why: `water ${wet.length} growing plots`, dom: 'fields' });
  }
  {
    const day = dayOf(S, now);
    // a bee colony is never petted (GDD §3.4; the rules refuse the whole batch)
    const unpetted = v.animals.filter(([, o]) => animalOf(o.def)?.feed !== null
      && !(o.pet && o.pet.day === day && o.pet.by.includes(pid)) && isAdult(o, now));
    const homesToPet = [...new Set(unpetted.map(([, o]) => o.home))];
    if (homesToPet.length) push({ type: 'pet', args: { ids: homesToPet }, prio: 42, why: `pet ${unpetted.length} animals`, dom: 'barnyard' });
  }
  if (v.L >= GROWTH.compost.unlock && have(S, 'compost') > 0) {
    const targets = v.growing.filter(([, o]) => !o.compost);
    if (targets.length) push({ type: 'compost', args: { ids: targets.slice(0, have(S, 'compost')).map(([id]) => id) }, prio: 47, why: `spread compost on ${Math.min(targets.length, have(S, 'compost'))} plots`, dom: 'fields' });
  }
  for (const [bid, b] of v.buildings) {
    if (defOf(b.def).collector && Number.isSafeInteger(b.ready) && b.ready > 0) {
      push({ type: 'collectTray', args: { id: bid }, prio: 62, why: 'empty the Compost Bin', dom: 'workshop', key: `collectTray:${bid}` });
    }
  }

  // -- debris --------------------------------------------------------------------------------------------------------------
  // weeds and rocks go with a click of the Hand; stumps, logs and boulders need the Axe and several hits (a card asking for
  // debris, or the NOW card "Clear a weed or a rock", is what sends the player to them)
  if (v.debris.length) {
    const placed = v.debris.filter(([, o]) => Number.isFinite(o.x));
    const soft = placed.filter(([, o]) => defOf(o.def).tool === 'hand');
    const hard = placed.filter(([, o]) => defOf(o.def).tool === 'axe');
    const pick = [...soft.slice(0, 8), ...hard.slice(0, 4)];
    if (pick.length) push({ type: 'chop', args: { ids: pick.slice(0, 100).map(([id]) => id) }, prio: W.clear > 0 ? 76 : 20, why: W.clear > 0 ? 'a card asks to clear debris' : 'weeds, stumps and rocks (the NOW card)', dom: 'farm' });
  }

  // -- growth purchases ------------------------------------------------------------------------------------------------
  const lowStock = ctx.saving && coins < ctx.saving;
  // hens (and cows) up to the home's capacity when the treasury allows
  for (const [hid, h] of v.homes) {
    const sp = defOf(h.def).species?.[0];
    const a = animalOf(sp);
    if (!a || a.unlock > v.L || a.shop === false) continue;
    const occ = occupantsOf(S, hid).length;
    if (occ >= capacityOf(S, hid)) continue;
    const price = animalPrice(S, sp, false);
    if (coins >= price + 400 && !lowStock && (have(S, a.feed) >= a.feedQty * (occ + 1) || coins >= price * 2)) {
      push({ type: 'buyAnimal', args: { def: sp}, prio: 60, cost: COST.buyAnimal, why: `another ${sp} (${price} coins)`, dom: 'barnyard', key: `buyAnimal:${sp}` });
    }
  }
  // more plots while there is room under the cap and the price is small
  const plotDef = defOf('plot');
  const pPrice = buyPrice(S, 'plot');
  if (!pPrice.code && pPrice.coins * 6 <= coins && !lowStock && v.idle.length === 0) {
    const spot = findPlotSpot(S, v);
    if (spot) push({ type: 'place', args: { def: 'plot', ...spot }, prio: 58, cost: 1, why: `another plot (${pPrice.coins} coins)`, dom: 'fields', key: 'place:plot' });
  }
  void plotDef;
  // the barn when it is nearly full and the upgrade is open
  const nextBarn = CONTENT.barn.find((b) => b.n === (S.farm.barn ?? 0) + 1);
  if (nextBarn && v.L >= nextBarn.unlock && held >= barnCap(S) * 0.6 && coins >= nextBarn.cost + 300
    && have(S, 'planks') >= nextBarn.planks && have(S, 'wooden_crate') >= nextBarn.crates) {
    push({ type: 'upgradeBarn', args: {}, prio: 66, cost: 2, why: `Barn upgrade ${nextBarn.n}`, dom: 'market' });
  }
  // what a player with money in the till does between the cards: buy the unlocked buildings, homes and tools they lack
  if (!lowStock) {
    for (const b of liveAt('buildings', v.L)) {
      if (!(b.cost > 0) || (v.byDef.get(b.id) ?? 0) >= 1) continue;
      if (W.buys.some((x) => x.def === b.id)) continue;
      const pr = buyPrice(S, b.id);
      if (pr.code || coins < pr.coins * 1.4 + 500) continue;
      const spot = findSpot(S, b.id, a0.x + 7, a0.z - 2);
      if (spot) push({ type: 'place', args: { def: b.id, ...spot }, prio: 57, cost: COST.place, why: `buy the ${b.name} (${pr.coins} coins): it is unlocked and the till is full`, dom: 'workshop', key: `place:${b.id}` });
    }
    for (const hdef of liveAt('homes', v.L)) {
      if (hdef.shop === false || (v.byDef.get(hdef.id) ?? 0) >= 1) continue;
      const pr = buyPrice(S, hdef.id);
      const an = animalOf(hdef.species?.[0]);
      if (pr.code || !an || coins < pr.coins + animalPrice(S, an.id, false) + 600) continue;
      const spot = findSpot(S, hdef.id, a0.x - 6, a0.z + 7);
      if (spot) push({ type: 'place', args: { def: hdef.id, ...spot }, prio: 57, cost: COST.place, why: `build the ${hdef.name} (${pr.coins} coins)`, dom: 'barnyard', key: `place:${hdef.id}` });
    }
    for (const t of liveAt('tools', v.L)) {
      if (!(t.cost > 0) || (S.farm.tools && S.farm.tools[t.id])) continue;
      if (coins >= t.cost * 1.5 + 500) push({ type: 'buyTool', args: { tool: t.id }, prio: 56, why: `buy the ${t.name} (${t.cost} coins)`, dom: 'market', key: `buyTool:${t.id}` });
    }
  }
  // land: open the card as soon as the level allows, buy when everything is in hand
  const nx = nextExpansion(S);
  if (nx && v.L >= nx.unlock) {
    if (nx.proof.length && !Object.hasOwn(S.farm.proofs, nx.id)) {
      push({ type: 'openExpansion', args: { expansion: nx.id }, prio: 50, why: `open the ${nx.name} card`, dom: 'market' });
    }
    if (!expandCode(S, nx.id) && coins >= nx.cost) {
      push({ type: 'expand', args: { expansion: nx.id}, prio: 64, cost: 2, why: `buy ${nx.name} (${nx.cost})`, dom: 'market' });
    } else ctx.saving = Math.max(ctx.saving ?? 0, nx.cost);
  }

  // -- sell ------------------------------------------------------------------------------------------------------------------
  for (const s of W.sells) {
    if (s.demand) continue;
    if (have(S, s.item) >= s.qty && itemOf(s.item)?.sellable) {
      push({ type: 'sell', args: { item: s.item, qty: Math.min(s.qty, have(S, s.item)), }, prio: 79, why: `${s.why}: sell ${s.item}`, dom: 'market', key: `sell:${s.item}` });
    }
  }
  // surplus: sell what the plans do not need, keeping what the wants and the feed need
  const keepFor = new Map();
  for (const w of W.crafts) {
    for (const [i, q] of Object.entries(w.r.inputs ?? {})) keepFor.set(i, (keepFor.get(i) ?? 0) + q * w.batches);
  }
  for (const o of Object.values(S.farm.orders.slots)) if (o.order) for (const [i, q] of Object.entries(o.order.items)) keepFor.set(i, (keepFor.get(i) ?? 0) + q);
  for (const qid of sortedKeys(S.farm.quests.active)) {
    CONTENT.quests.get(qid).tasks.forEach((t) => { if (['deliver', 'sell'].includes(t.verb) && t.ref !== 'demand') keepFor.set(t.ref, (keepFor.get(t.ref) ?? 0) + t.qty); });
  }
  if (!globalThis.__HH_EXTRA_KEEP) for (const [i, q] of bargeAsks(S, now)) keepFor.set(i, (keepFor.get(i) ?? 0) + q);
  const grainKeep = 24;
  const sellable = [];
  for (const item of sortedKeys({ ...S.farm.inventory, ...S.farm.overflow })) {
    const it = itemOf(item);
    if (!it || !it.sellable) continue;
    let keep = (keepFor.get(item) ?? 0) + (it.classes?.includes('grain') ? grainKeep : 0) + (item === 'egg' ? 6 : 0);
    if (it.kind === 'material') keep += 12;
    const extra = have(S, item) - keep;
    if (extra > 0) sellable.push({ item, qty: extra, coins: extra * it.sell });
  }
  const worth = sellable.reduce((n, x) => n + x.coins, 0);
  if (sellable.length && (worth >= 40 || held >= barnCap(S) * 0.5)) {
    const best = sellable.sort((a, b) => b.coins - a.coins)[0];
    push({ type: 'sell', args: { item: best.item, qty: best.qty, }, prio: 45, why: `sell surplus ${best.item}`, dom: 'market', key: `sell:${best.item}` });
  }

  // -- queue something useful in an empty building (new recipes for XP, goods that sell above their inputs) -------------------
  for (const [bid, b] of v.buildings) {
    if ((b.queue ?? []).length > 0 || b.def === 'feed_mill' || b.def === 'compost_bin') continue;
    const tried = [];
    for (const r of recipesOf(b.def)) {
      if (!isLive(r) || r.unlock > v.L || r.duet) continue;
      if (!Object.entries(r.inputs ?? {}).every(([i, q]) => have(S, i) - (keepFor.get(i) ?? 0) >= q)) continue;
      const cost = Object.entries(r.inputs ?? {}).reduce((n, [i, q]) => n + q * (itemOf(i)?.sell ?? 0), 0);
      const outV = (itemOf(r.id)?.sell ?? 0) * (r.out ?? 1);
      const fresh = (S.farm.stats[`craft.${r.id}`] ?? 0) === 0 ? 1.5 : 1;
      tried.push({ r, gain: (outV - cost + 8 * r.xp) * fresh / Math.max(1, r.ms / MIN) });
    }
    tried.sort((a, b) => b.gain - a.gain);
    if (tried.length && tried[0].gain > 0) {
      push({ type: 'craft', args: { id: bid, recipe: tried[0].r.id }, prio: 50, why: `use the idle ${b.def}: ${tried[0].r.id}`, dom: 'workshop', key: `craft-idle:${bid}` });
    }
  }

  // -- the Goal Tracker's NOW card (GDD §5.1): between the big jobs the couple takes what the card offers: a decor piece
  // (GDD §1.5 "decorating" in the first evening) or a building slot. A human does it in passing, so at most once every
  // FOLLOW_GAP_MS per player, and never while saving for a bigger card.
  {
    const key = `${S.meta?.farmSeed ?? 0}:${pid}`;
    const last = followAt.get(key) ?? -Infinity;
    const spare = coins - (ctx.saving ?? 0);          // what is left over after the goal being saved for
    // a well-off farm decorates more often (twice the pace from 10,000 coins in the treasury)
    const gap = coins >= 10_000 ? FOLLOW_GAP_MS / 2 : FOLLOW_GAP_MS;
    const n = now - last >= gap ? goals(S, pid, now)?.now : null;
    const dCost = n && n.kind === 'decor' ? (defOf(n.id)?.cost ?? 0) : 0;
    // a piece of decor that is small change next to the saving goal (2 %) is bought anyway, as a player would
    // (the card itself offers only a piece within a twentieth of the treasury, so saving goals barely move)
    if (n && n.kind === 'decor' && defOf(n.id) && coins >= dCost * 10
      && (spare >= dCost * 10 || dCost * 50 <= (ctx.saving ?? 0) || dCost * 20 <= coins)) {
      const spot = findSpot(S, n.id, a0.x - 4, a0.z - 4);
      // either farmer decorates in passing (the card is each player's own): the player's own domain, not 'farm'
      if (spot) push({ type: 'place', args: { def: n.id, ...spot }, prio: 30, cost: COST.place, why: `the NOW card: ${n.text}`, dom: Object.keys(ctx.dom ?? {})[0] ?? 'farm', key: `follow:${n.id}`, follow: key });
    } else if (n && n.kind === 'build' && n.target?.panel === 'building' && n.target.args?.id
      && (spare >= (n.need ?? 0) * 2 || (n.need ?? 0) * 20 <= coins)) {
      push({ type: 'upgradeSlot', args: { id: n.target.args.id }, prio: 30, cost: 1, why: `the NOW card: ${n.text}`, dom: 'workshop', key: `follow:slot:${n.target.args.id}`, follow: key });
    }
  }
  // pets (GDD §3.4): adopt mine when the card asks, then a treat a day for each pet and a pat, like the hens
  if (ACTIONS.adoptPet && ACTIONS.adoptPet.check(S, { kind: 'dog', name: 'Rex' }, { pid, now }) === null) {
    const kind = pid === 'p1' ? 'dog' : 'cat';
    push({ type: 'adoptPet', args: { kind, name: pid === 'p1' ? 'Rex' : 'Mitzi' }, prio: 40, why: 'adopt a pet (the NOW card)', dom: 'farm', key: `adopt:${pid}` });
  }
  for (const owner of sortedKeys(S.players)) {
    if (!S.players[owner].pet || !ACTIONS.feedPet) continue;
    if (ACTIONS.feedPet.check(S, { owner }, { pid, now }) === null) push({ type: 'feedPet', args: { owner }, prio: 41, why: `a treat for ${S.players[owner].pet.name}`, dom: 'farm', key: `feedPet:${owner}` });
    if (ACTIONS.petPet.check(S, { owner }, { pid, now }) === null) push({ type: 'petPet', args: { owner }, prio: 41, why: `pat ${S.players[owner].pet.name}`, dom: 'farm', key: `petPet:${owner}` });
  }

  // two players share the work by domain (the tutorial's Fields / Barnyard tracks): a job of the partner's domain is
  // helped with only when the partner has not done it by the time it has waited a minute (or when playing solo)
  const mine = (o) => ctx.solo || !ctx.dom || Object.keys(ctx.dom).length === 0 || ctx.dom[o.dom];
  const helpOk = (o) => ctx.helpAll || (ctx.waited && ctx.waited(`${o.dom}:${o.type}`));
  const list = c.filter((o) => mine(o) || helpOk(o) || o.prio >= 95);
  list.sort((a, b) => (b.prio + (mine(b) ? 10 : 0)) - (a.prio + (mine(a) ? 10 : 0)));
  if (ctx.sawKeys) for (const o of c) ctx.sawKeys.add(`${o.dom}:${o.type}`);
  return { list, notes: W.notes, wants: W, view: v };
}

/**
 * One player's minute: keep choosing the best op until the attention is spent or nothing useful is left.
 * @returns {{ ops: object[], idle: boolean, left: number, notes: string[] }}
 */
export async function turn(client, { minsLeft = 30, wrap = false, dom = {}, solo = false, helpAll = false, waited, sawKeys, ops = OPS_PER_MINUTE, onOp, style = 'patient' } = {}) {
  const out = [];
  const failed = new Set();
  const ctx = { minsLeft, wrap, dom, solo, helpAll, waited, sawKeys, saving: 0, style };
  let left = ops;
  let notes = [];
  let guard = 0;
  while (left > 0 && guard++ < 60) {
    const { s, now } = await client.snap();
    ctx.saving = 0;
    const cand = candidates(s, now, client.pid, ctx);
    notes = cand.notes;
    const next = cand.list.find((x) => !failed.has(x.key) && x.cost <= left);
    if (!next) break;
    let r = await client.act(next.type, next.args);
    let softCard = null;
    // a soft refusal opens the "are you sure?" card (BIG_SPEND, RESERVED, PINNED): the player reads it and says yes
    if (!r.ok && SOFT_CODES.has(r.code)) {
      softCard = r.code;
      r = await client.act(next.type, { ...next.args, confirm: [r.code] });
    }
    const rec = { type: next.type, why: next.why, ok: Boolean(r.ok), code: r.code ?? null, args: next.args, softCard };
    out.push(rec);
    if (onOp) onOp(rec);
    if (!r.ok) failed.add(next.key);
    if (r.ok && next.follow) followAt.set(next.follow, now);
    left -= r.ok ? next.cost : 0.5;
    if (r.ok) failed.delete(next.key);
  }
  return { ops: out, idle: left > 0, left, notes };
}

/** The Goal Tracker's three cards as rules compute them (what the DOM shows is checked by the playtest). */
export function trackerOf(S, pid, now) {
  const g = goals(S, pid, now);
  return { now: g.now, soon: g.soon, big: g.big };
}

/**
 * Cross-check of the tracker against what is really possible: returns a list of inconsistency strings.
 * (a "collect" card with nothing ripe, a "plant" card with no coin for a seed, an "order" card with no fillable order...)
 */
export function trackerProblems(S, pid, now) {
  const out = [];
  const g = goals(S, pid, now);
  const v = look(S, now, pid);
  const n = g.now;
  const coins = S.farm.wallet.coins;
  const minSeed = Math.min(...liveAt('crops', v.L).map((c) => c.seed));
  switch (n.kind) {
    case 'collect': {
      const ready = v.ripe.length
        + v.animals.filter(([, o]) => Number.isSafeInteger(o.readyAt) && o.readyAt <= now).length
        + v.buildings.filter(([, o]) => (o.queue ?? []).some((q) => q.e <= now)).length
        + v.trees.filter(([, o]) => Number.isSafeInteger(o.readyAt) && o.readyAt <= now).length;
      if (!ready) out.push(`NOW says "${n.text}" but nothing is ready`);
      if (!canIntake(S)) out.push(`NOW says "${n.text}" with a full Barn`);
      break;
    }
    case 'plant':
      if (coins < minSeed) out.push(`NOW says "${n.text}" but ${coins} coins buy no seed (${minSeed})`);
      break;
    case 'order': {
      const ok = Object.values(S.farm.orders.slots).some((s) => s.order && fillable(S, s.order));
      if (!ok) out.push(`NOW says "${n.text}" but no order is fillable`);
      break;
    }
    case 'tip':
      if (v.ripe.length) out.push(`NOW is a tip ("${n.text}") while ${v.ripe.length} plots are ripe`);
      if (v.idle.length && coins >= minSeed) out.push(`NOW is a tip while ${v.idle.length} plots are empty and a seed is affordable`);
      break;
    default: break;
  }
  const s = g.soon;
  if (s && s.kind === 'quest') {
    const q = CONTENT.quests.get(s.id);
    const t = q && q.tasks[Number(s.ref)];
    if (t && t.verb === 'make') {
      const it = itemOf(t.ref);
      const r = it && (recipeOf(it.source) ?? feedOf(it.source));
      if (r && !(v.P.owned.get(r.building) > 0)) out.push(`SOON says "${s.text}" but the farm has no ${r.building}`);
    }
  }
  return out;
}

export { look, ORDERS, MARKET, isStateTask, expansionOf };
