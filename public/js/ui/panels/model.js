// View models of the content panels (ui-panels lane). PURE: (state, now, pid, content) -> plain data, no DOM,
// no clock, no store. Every number the panels show is computed here from the content tables and the replicated
// state, never typed into a template, so test/ui-panels.*.test.js can check what a player will see.
//
// The rule lanes are filling the M1a state in parallel; readers here feature-detect their helpers through the
// rules modules' namespaces (economy.priceOf, economy.keptOf, economy.barnCapacityOf ...) and fall back to the
// GDD formula over content when a helper does not exist yet. A fallback never decides anything: the action's
// own check (core.probe) is what enables a button; the model only explains and previews.
import {
  CONTENT, live, itemOf, cropOf, treeOf, animalOf, homeOf, buildingOf, recipeOf, feedOf, decorOf, toolOf,
  expansionOf, levelFromXp, xpForLevel, plotCapOf, plotPrice, barnCapacity, treeCapAt, homeCountAt, masteryStars,
  recipesOf, classMembers, MARKET, SAFETY, BOOSTS, MASTERY, GROWTH, COOP, isLive, defOf,
} from '../../../../shared/content/index.js';
import * as economy from '../../../../shared/rules/economy.js';
import * as grid from '../../../../shared/rules/grid.js';
import * as decorA from '../../../../shared/rules/actions/decor.js';
import * as animalsA from '../../../../shared/rules/actions/animals.js';
import * as craftingA from '../../../../shared/rules/actions/crafting.js';
import * as expansionsA from '../../../../shared/rules/actions/expansions.js';
import * as treesA from '../../../../shared/rules/actions/trees.js';
import * as calendar from '../../../../shared/rules/calendar.js';
import * as boostsA from '../../../../shared/rules/actions/boosts.js';
import * as marketA from '../../../../shared/rules/actions/market.js';
import { t, t as tr, N, Q, name as cname, ctext, list as listOf, fmtNum, getters, lang } from '../../i18n/index.js';

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : 0);
const sum = (a) => a.reduce((s, v) => s + v, 0);
export const levelOf = (state) => levelFromXp(state?.farm?.xp ?? 0);

/** n-th copy price, integer steps (mirrors economy.grow; used only when the rules expose no price helper). */
export function grow(base, bp, n) {
  if (typeof economy.grow === 'function') return economy.grow(base, bp, n);
  let p = base;
  for (let k = 1; k < n; k++) p = Math.floor((p * (10_000 + bp)) / 10_000);
  return p;
}

// ---- items and the Barn ---------------------------------------------------------------------------------------

/** Barn filter groups (GDD §7.3 "Barn (all items, filters ...)"), in display order. */
export const ITEM_GROUPS = Object.freeze([
  // labels are getters: they follow the language (i18n), read when a panel draws
  { id: 'crops', get label() { return t('market.group.crops'); }, kinds: ['crop'] },
  { id: 'fruit', get label() { return t('market.group.fruit'); }, kinds: ['fruit'] },
  { id: 'animal', get label() { return t('market.group.animal'); }, kinds: ['animal', 'premium'] },
  { id: 'goods', get label() { return t('market.group.goods'); }, kinds: ['craft'] },
  { id: 'supplies', get label() { return t('market.group.supplies'); }, kinds: ['material', 'feed', 'consumable'] },
]);
const GROUP_OF = Object.freeze(Object.fromEntries(ITEM_GROUPS.flatMap((g) => g.kinds.map((k) => [k, g.id]))));
export const groupOf = (item) => GROUP_OF[itemOf(item)?.kind] ?? 'supplies';

/** Units of an item in the Barn plus overflow. */
export const available = (state, item) => own(state.farm.inventory, item) + own(state.farm.overflow, item);

/** Total units stored (Barn + overflow). */
export const stored = (state) => sum(Object.values(state.farm.inventory)) + sum(Object.values(state.farm.overflow));

/** Barn upgrades owned (`farm.barn`, a count; GDD §3.6). */
export function barnUpgrades(state) {
  const b = state.farm.barn;
  if (Number.isSafeInteger(b)) return b;
  if (b && Number.isSafeInteger(b.n)) return b.n;
  return 0;
}

/** Barn capacity now (GDD §3.6). */
export function barnCap(state) {
  if (typeof economy.barnCap === 'function') return economy.barnCap(state);
  return barnCapacity(barnUpgrades(state));
}

/** Keep N for an item: { n, by } (explicit entry wins over the item's keepDefault; GDD §6.3). */
export function keepOf(state, item) {
  if (typeof economy.keptOf === 'function') {
    const k = economy.keptOf(state, item);
    if (k && typeof k === 'object') return { n: k.n ?? 0, by: k.by ?? null };
    return { n: Number(k) || 0, by: null };
  }
  const e = state.farm.keep && Object.hasOwn(state.farm.keep, item) ? state.farm.keep[item] : null;
  if (e) return { n: e.n ?? 0, by: e.by ?? null };
  return { n: itemOf(item)?.keepDefault ?? 0, by: null };
}

/** "not for feed" toggles (GDD §7.3 Barn) when the rules keep them: a Set of item ids. */
export function notForFeed(state) {
  const nf = state.farm.noFeed ?? state.farm.notForFeed;
  if (Array.isArray(nf)) return new Set(nf);
  if (nf && typeof nf === 'object') return new Set(Object.keys(nf).filter((k) => nf[k]));
  return new Set();
}

/**
 * The Barn panel's numbers: capacity, fill, overflow state and every stack (sorted by group, then name).
 * @returns {{ cap, used, over, hardCap, pct, state: 'ok'|'near'|'overflow'|'full', next, stacks: object[], groups }}
 */
export function barnView(state) {
  const cap = barnCap(state);
  const used = stored(state);
  const hardCap = Math.floor((cap * MARKET.barn.overflowMulBp) / 10_000);
  const over = sum(Object.values(state.farm.overflow));
  const status = used >= hardCap ? 'full' : used > cap || over > 0 ? 'overflow' : used >= cap * 0.85 ? 'near' : 'ok';
  const ids = new Set([...Object.keys(state.farm.inventory), ...Object.keys(state.farm.overflow)]);
  const nf = notForFeed(state);
  const stacks = [...ids].filter((id) => itemOf(id)).map((id) => {
    const it = itemOf(id);
    const n = available(state, id);
    const keep = keepOf(state, id);
    return {
      id, name: cname(id), n, over: own(state.farm.overflow, id), group: groupOf(id), kind: it.kind, sell: it.sell,
      sellable: it.sellable, giftable: it.giftable, keep: keep.n, keepBy: keep.by, free: Math.max(0, n - keep.n),
      noFeed: nf.has(id), value: it.sell * n,
    };
  }).sort((a, b) => ITEM_GROUPS.findIndex((g) => g.id === a.group) - ITEM_GROUPS.findIndex((g) => g.id === b.group)
    || a.name.localeCompare(b.name));
  const groups = ITEM_GROUPS.map((g) => ({ ...g, n: sum(stacks.filter((s) => s.group === g.id).map((s) => s.n)) }));
  return { cap, used, over, hardCap, pct: cap ? Math.min(1, used / cap) : 0, status, next: nextBarnUpgrade(state),
    stacks, groups };
}

/** The next Barn upgrade row (null at the M1a top), with what is still missing for it. */
export function nextBarnUpgrade(state) {
  const n = barnUpgrades(state);
  const row = CONTENT.barn.find((b) => b.n === n + 1);
  if (!row || !isLive(row)) return null;
  const level = levelOf(state);
  const need = [];
  if (row.planks) need.push({ item: 'planks', n: row.planks, have: available(state, 'planks') });
  if (row.crates) need.push({ item: 'wooden_crate', n: row.crates, have: available(state, 'wooden_crate') });
  return {
    n: row.n, capacity: row.capacity, add: row.capacity - barnCapacity(n), coins: row.cost, unlock: row.unlock,
    locked: level < row.unlock, need, short: Math.max(0, row.cost - state.farm.wallet.coins),
    missing: need.filter((x) => x.have < x.n).map((x) => ({ item: x.item, n: x.n - x.have })),
  };
}

/**
 * "Sell surplus" preview (GDD §3.6): the `surplusStacks` lowest-value stacks above `surplusKeep` units, keeping
 * Keep N; what selling down to surplusKeep would pay at the base price.
 */
export function surplusPreview(state, now) {
  // the rules' own list when this build has it: the preview is exactly what "Sell surplus" sells, at today's prices
  if (typeof marketA.surplusOf === 'function' && Number.isFinite(now)) {
    const rows = marketA.surplusOf(state, now).map((r) => ({ id: r.item, qty: r.qty, sell: r.qty ? Math.round(r.coins / r.qty) : 0, coins: r.coins }));
    return { rows, units: sum(rows.map((r) => r.qty)), coins: sum(rows.map((r) => r.coins)), exact: true };
  }
  const { surplusStacks, surplusKeep } = MARKET.barn;
  const rows = barnView(state).stacks
    .filter((s) => s.sellable && s.n > Math.max(surplusKeep, s.keep))
    .sort((a, b) => a.sell - b.sell || a.id.localeCompare(b.id))
    .slice(0, surplusStacks)
    .map((s) => ({ id: s.id, qty: s.n - Math.max(surplusKeep, s.keep), sell: s.sell }));
  return { rows, units: sum(rows.map((r) => r.qty)), coins: sum(rows.map((r) => r.qty * r.sell)) };
}

// ---- Market: sell ------------------------------------------------------------------------------------------------

/**
 * Market Demand of the day (L11, GDD §4.10): { items: [{ id, left }], bonusBp } or null before L11. The pick and
 * the units left come from the economy's pure helpers (the same ones the sell action pays with).
 */
export function demandOf(state, now) {
  if (typeof economy.demandOf !== 'function' || economy.demandOf.length < 2) return null;
  const d = economy.demandOf(state, now);
  if (!d) return null;
  const ids = [d.raw, d.crafted].filter((id) => id && itemOf(id));
  if (!ids.length) return null;
  const left = (id) => (typeof economy.demandLeft === 'function' ? economy.demandLeft(state, id, now) : MARKET.demand.unitsPerDay);
  return { items: ids.map((id) => ({ id, left: left(id) })), bonusBp: MARKET.demand.bonusBp, per: MARKET.demand.unitsPerDay };
}

/** Unit price at the stand right now (mastery ★1, season) before Demand. */
export function unitPriceOf(state, item, now) {
  if (typeof economy.unitPrice === 'function' && economy.unitPrice.length >= 3) return economy.unitPrice(state, item, now);
  return itemOf(item)?.sell ?? 0;
}

/** What selling `qty` pays right now: { coins, demand } (demand = units at the +50 % bonus). */
export function saleQuote(state, item, qty, now) {
  if (typeof economy.saleOf === 'function') return economy.saleOf(state, item, qty, now);
  return { coins: unitPriceOf(state, item, now) * qty, demand: 0 };
}

/** Sellable stacks for the Market's Sell tab: Demand items first, then by stack value. */
export function sellList(state, now) {
  const dem = demandOf(state, now);
  const dset = new Map((dem ? dem.items : []).map((d) => [d.id, d.left]));
  return barnView(state).stacks.filter((s) => s.sellable && s.n > 0).map((s) => {
    const unit = unitPriceOf(state, s.id, now);
    return { ...s, unit, demand: dset.has(s.id) && dset.get(s.id) > 0, demandLeft: dset.get(s.id) ?? 0 };
  }).sort((a, b) => Number(b.demand) - Number(a.demand) || Number(b.free > 0) - Number(a.free > 0)
    || b.unit * b.free - a.unit * a.free || a.name.localeCompare(b.name));
}

// ---- Market: the store --------------------------------------------------------------------------------------------

/** Store tabs (GDD §7.3: Seeds · Trees · Animals · Buildings · Decor · Land · Tools · Acorn shop). */
export const STORE_TABS = Object.freeze([
  { id: 'seeds', get label() { return t('market.tab.seeds'); }, icon: 'wheat' },
  { id: 'trees', get label() { return t('market.tab.trees'); }, icon: 'apple_tree' },
  { id: 'animals', get label() { return t('market.tab.animals'); }, icon: 'chicken' },
  { id: 'buildings', get label() { return t('market.tab.buildings'); }, icon: 'bakery' },
  { id: 'decor', get label() { return t('market.tab.decor'); }, icon: 'flower_bed' },
  { id: 'land', get label() { return t('market.tab.land'); }, icon: 'plot' },
  { id: 'tools', get label() { return t('market.tab.tools'); }, icon: 'watering_can' },
  { id: 'acorn', get label() { return t('market.tab.acorn'); }, icon: 'acorns' },
]);

const isFreeObj = (o) => Boolean(o && (o.free || o.gift || o.rcpt?.free));

/** Placed objects of a def (sorted ids). */
export function placedOf(state, defId) {
  return Object.keys(state.farm.objects).sort().filter((id) => state.farm.objects[id].def === defId);
}

/** Copies of a def waiting in the build tray (`farm.storage`: free gifts and stored objects; GDD §2.3). */
export const inTray = (state, defId) => own(state.farm.storage, defId);

/** Price of the next copy of a placeable def: { coins, acorns } (GDD §3.2 trees x1.45, §3.4 animals x1.1). */
export function priceOf(state, defId, opts = {}) {
  const animal0 = animalOf(defId);
  if (animal0 && typeof animalsA.animalPrice === 'function') return { coins: animalsA.animalPrice(state, defId, opts.adult === true), acorns: 0 };
  if (!animal0 && typeof decorA.buyPrice === 'function') {
    const p = decorA.buyPrice(state, defId);
    // the rules answer 0 with a code (LOCKED / CAP): show the list price of the next copy instead
    if (p && p.code === null) return { coins: p.coins, acorns: p.acorns };
  }
  const tree = treeOf(defId);
  if (tree) {
    const n = placedOf(state, defId).filter((id) => !isFreeObj(state.farm.objects[id])).length + 1;
    return { coins: grow(tree.cost, tree.growthBp, n), acorns: 0 };
  }
  const animal = animalOf(defId);
  if (animal) {
    const n = placedOf(state, defId).length + 1;
    return { coins: grow(opts.adult ? animal.adult : animal.baby, animal.growthBp, n), acorns: 0 };
  }
  const home = homeOf(defId);
  if (home) return { coins: grow(home.cost, home.growthBp || 0, placedOf(state, defId).length + 1), acorns: 0 };
  const b = buildingOf(defId);
  if (b) {
    const n = placedOf(state, defId).length;
    return { coins: n >= 1 && b.secondCopy ? b.secondCopy.cost : b.cost, acorns: 0 };
  }
  const d = decorOf(defId);
  if (d) return { coins: d.cost ?? 0, acorns: d.acorns ?? 0 };
  if (defId === 'plot') return { coins: plotPrice(placedOf(state, 'plot').length + 1), acorns: 0 };
  return { coins: 0, acorns: 0 };
}

/** Expansions bought (the Homestead, k = 0, is not one). */
export const expansionsOwned = (state) => state.farm.expansions.filter((e) => (expansionOf(e)?.k ?? 0) > 0).length;

/** How many copies of a def the farm may own now (Infinity when unlimited). */
export function capOf(state, defId) {
  const level = levelOf(state);
  const tree = treeOf(defId);
  if (tree) return treeCapAt(tree, level);
  const home = homeOf(defId);
  if (home) return homeCountAt(home, level);
  const b = buildingOf(defId);
  if (b) return b.secondCopy && level >= b.secondCopy.at && decorA.secondCopyLive(b) ? 2 : 1;
  // + the Stone Bridge's Hollow Meadow plots (Restoration 3): the rules' decor.ownCap counts them, so must the Market
  if (defId === 'plot') return plotCapOf(level, expansionsOwned(state))
    + (typeof economy.projectPlotCap === 'function' ? economy.projectPlotCap(state) : 0);
  return Infinity;
}


/** The farm's spendable coins (Wishlist deposits live outside the wallet, GDD §6.3). */
export const spendable = (state) => state.farm.wallet.coins;

/** True when a purchase would ask BIG_SPEND (GDD §6.3) for `pid` at `now` (the economy's own test when it has one). */
export function bigSpend(state, coins, acorns = 0, env = {}) {
  if (typeof economy.isBigSpend === 'function' && env.pid) return economy.isBigSpend(state, env.pid, env.now ?? 0, coins, acorns);
  const { shareBp, minCoins, acorns: acornLimit } = SAFETY.bigSpend;
  if (acorns >= acornLimit) return true;
  return coins > minCoins && coins * 10_000 > spendable(state) * shareBp;
}

/**
 * Gate of a purchase BEFORE the click: { code, hint } with ERR-like codes (LOCKED, CAP, NO_COINS, NO_ITEMS)
 * so the card shows a reason. The click still goes through the rules (probe/act).
 */
export function gateOf(state, { unlock = 1, coins = 0, acorns = 0, owned = 0, cap = Infinity }) {
  const level = levelOf(state);
  if (level < unlock) return { code: 'LOCKED', hint: { unlock } };
  if (owned >= cap) return { code: 'CAP', hint: { cap } };
  if (coins > spendable(state)) return { code: 'NO_COINS', hint: { coins: coins - spendable(state) } };
  if (acorns > state.farm.wallet.acorns) return { code: 'NO_ITEMS', hint: { acorns: acorns - state.farm.wallet.acorns } };
  return { code: null, hint: {} };
}

const fmtMs = (ms) => {
  const m = Math.round(ms / 60_000);
  if (m < 60) return t('market.dur.m', { m });
  const h = Math.floor(m / 60);
  return m % 60 ? t('market.dur.hm', { h, m: m % 60 }) : t('market.dur.h', { h });
};
export const durationText = fmtMs;

/** The mastery counter of an id (farm.mastery is keyed by id). */
export const masteryCount = (state, id) => own(state.farm.mastery, id);

/**
 * Mastery of a crop / tree species / animal species / recipe: { stars, count, next, prev, def } (stars 0 before
 * the system unlocks at L7; 4 = Gold from L30). `next` = the count of the next star (null at ★3).
 */
export function starsOf(state, family, id) {
  const def = { crops: cropOf, trees: treeOf, animals: animalOf, recipes: recipeOf }[family]?.(id);
  if (!def || !Array.isArray(def.mastery)) return { stars: 0, count: 0, next: null, prev: 0, def: null };
  const count = masteryCount(state, id);
  const stars = typeof economy.starsOf === 'function' ? economy.starsOf(state, id)
    : levelOf(state) < MASTERY.unlock ? 0 : masteryStars(def, count, levelOf(state));
  return { stars, count, next: stars < 3 ? def.mastery[stars] : null, prev: stars > 0 ? def.mastery[Math.min(stars, 3) - 1] : 0, def };
}

/** "New!" only for things that arrived with the current level (at L1 everything is new, so nothing is). */
const isNewAt = (unlock, level) => level > 1 && unlock === level;

/**
 * Store cards of one tab: every LIVE def (locked ones too: they show their unlock level).
 * @param {object} state @param {string} tab @param {{ now?: number, pid?: string }} [env]
 */
export function storeCards(state, tab, env = {}) {
  const cards = storeCardsRaw(state, tab, env);
  if (!['trees', 'buildings', 'decor', 'acorn'].includes(tab)) return cards;
  return cards.map((c, i) => [c, i]).sort((a, b) => (a[0].unlock ?? 1) - (b[0].unlock ?? 1) || a[1] - b[1]).map(([c]) => c);
}

function storeCardsRaw(state, tab, env) {
  const level = levelOf(state);
  const card = (defId, extra) => {
    const price = extra.price ?? priceOf(state, defId, extra.opts);
    const owned = extra.owned ?? placedOf(state, defId).length;
    const cap = extra.cap ?? capOf(state, defId);
    const tray = extra.tray ?? inTray(state, defId);
    // a copy waiting in the build tray is placed for free and never counts against coins
    const gate = tray > 0 && level >= (extra.unlock ?? 1)
      ? { code: null, hint: {} }
      : gateOf(state, { unlock: extra.unlock ?? 1, coins: price.coins, acorns: price.acorns, owned, cap });
    return { id: defId, icon: defId, owned, cap: Number.isFinite(cap) ? cap : null, price, tray, ...gate,
      big: tray === 0 && bigSpend(state, price.coins, price.acorns, env), isNew: isNewAt(extra.unlock ?? 1, level), ...extra };
  };
  switch (tab) {
    case 'seeds':
      return live('crops').map((c) => {
        const ms = starsOf(state, 'crops', c.id);
        const inSeason = env.now !== undefined && typeof economy.inSeason === 'function' ? economy.inSeason(state, c.id, env.now) : false;
        return {
          id: c.id, icon: c.id, kind: 'seed', name: cname(c.id), unlock: c.unlock, price: { coins: c.seed, acorns: 0 },
          code: level < c.unlock ? 'LOCKED' : null, hint: { unlock: c.unlock }, grow: fmtMs(c.growMs), growMs: c.growMs,
          yield: c.yield, sell: unitPriceOf(state, c.id, env.now ?? 0), xp: c.xp, season: c.season, inSeason,
          waterable: c.waterable, stars: ms.stars, isNew: isNewAt(c.unlock, level), packets: own(state.farm.seeds, c.id),
        };
      });
    case 'trees':
      return live('trees').filter((t) => t.shop !== false).map((t) => card(t.id, {
        kind: 'tree', name: cname(t.id), unlock: t.unlock, cycle: fmtMs(t.cycleMs), yield: t.yield, product: t.product,
        xp: t.xp, size: t.size, stars: starsOf(state, 'trees', t.id).stars,
      }));
    case 'animals': {
      const out = [];
      for (const home of live('homes').filter((x) => x.shop !== false)) {
        out.push(card(home.id, { kind: 'home', name: cname(home.id), unlock: home.unlock, size: home.size,
          capacity: home.capacity, capacityMax: typeof grid.homeMaxOf === 'function' ? grid.homeMaxOf(home) : home.capacityMax,
          species: home.species }));
        for (const sp of home.species) {
          const a = animalOf(sp);
          if (!a || !isLive(a) || a.shop === false) continue;
          const homes = placedOf(state, home.id);
          const room = sum(homes.map((hid) => homeRoom(state, hid)));
          const extra = { kind: 'animal', name: cname(a.id), unlock: a.unlock, home: home.id, homeName: cname(home.id), homes,
            room, cycle: fmtMs(a.cycleMs), product: a.product, feed: a.feed, babyGrow: fmtMs(a.babyMs),
            owned: placedOf(state, sp).length, cap: Infinity, tray: 0, stars: starsOf(state, 'animals', sp).stars };
          for (const adult of [false, true]) {
            // wave 4b: a full home grows a room step with the purchase, its price folded in (the rules' animalBuyPlan)
            const plan = homes.length && room <= 0 && typeof animalsA.animalBuyPlan === 'function'
              ? animalsA.animalBuyPlan(state, sp, adult) : null;
            const grows = Boolean(plan && plan.code === null);
            const c = card(a.id, { ...extra, adult, opts: { adult },
              ...(grows ? { price: { coins: plan.coins, acorns: 0 }, grow: { step: plan.step, home: plan.home } } : {}) });
            // the most useful reason first: no home, then no room, then the price
            if (level >= a.unlock && !homes.length) c.code = 'LOCKED', c.hint = { text: t('market.animal.placeHome', { home: N(home.id) }) };
            else if (level >= a.unlock && room <= 0 && !grows) {
              c.code = 'CAP';
              // a full home that cannot grow: what is in the way (the rules' homeGrowth of the home animalBuyPlan names),
              // and that home, whose panel shows it and moves the home (the Market card offers it)
              const stuck = plan && (plan.code === 'BLOCKED' || plan.code === 'OUT_OF_BOUNDS');
              const g = stuck && plan.blocked && typeof animalsA.homeGrowth === 'function' ? animalsA.homeGrowth(state, plan.blocked) : null;
              const why = stuck ? blockerText(state, g ? g.blockers : []) : '';
              c.hint = { text: stuck ? t('market.animal.fullStuck', { home: N(home.id), why }) : t('market.animal.full', { home: N(home.id) }) };
              if (stuck && plan.blocked) c.blocked = { home: plan.blocked, name: cname(home.id), why };
            }
            if (c.code) c.big = false;
            out.push(c);
          }
        }
      }
      return out;
    }
    case 'buildings':
      return live('buildings').filter((b) => b.shop !== false).map((b) => card(b.id, {
        kind: 'building', name: cname(b.id), unlock: b.unlock, size: b.size, slots: b.slots,
        recipes: recipesOf(b.id).length, free: b.cost === 0,
      }));
    case 'decor':
      return live('decor').filter((d) => d.shop !== false && d.tier === 'coin').map((d) => card(d.id, {
        kind: 'decor', name: cname(d.id), unlock: d.unlock, size: d.size, beauty: d.beauty10 / 10, text: ctext('decor', d.id, 'desc', d.text),
        cap: Infinity,
      }));
    case 'acorn': {
      const out = live('decor').filter((d) => d.shop !== false && d.tier === 'acorn').map((d) => card(d.id, {
        kind: 'decor', name: cname(d.id), unlock: d.unlock, size: d.size, beauty: d.beauty10 / 10, text: ctext('decor', d.id, 'desc', d.text),
        cap: Infinity,
      }));
      const gs = BOOSTS.goldenSeeds;
      if (isLive({ m: gs.m })) {
        out.unshift({ id: 'golden_seeds', icon: 'golden_seeds', kind: 'boost', name: t('market.golden.name'),
          unlock: gs.unlock, price: { coins: 0, acorns: gs.acorns }, owned: goldenSeedsOf(state), cap: null, tray: 0,
          text: t('market.golden.text', { n: gs.seeds }),
          big: bigSpend(state, 0, gs.acorns, env), isNew: isNewAt(gs.unlock, level),
          ...gateOf(state, { unlock: gs.unlock, acorns: gs.acorns }) });
      }
      return out;
    }
    case 'tools': {
      const owned = toolsOwned(state);
      const out = live('tools').filter((t) => t.upgrades).map((t) => {
        const has = owned.has(t.id);
        const g = has ? { code: 'ALREADY_DONE', hint: { done: tr('market.tool.owned') } } : gateOf(state, { unlock: t.unlock, coins: t.cost });
        return { id: t.id, icon: t.id, kind: 'tool', name: cname(t.id), unlock: t.unlock, price: { coins: t.cost, acorns: 0 },
          text: ctext('tools', t.id, 'desc', t.text), brush: t.brush, upgrades: t.upgrades, owned: has ? 1 : 0, cap: 1, tray: 0, ...g,
          big: !has && bigSpend(state, t.cost, 0, env), isNew: isNewAt(t.unlock, level) };
      });
      for (const f of live('feeds')) {
        if (!f.storePrice) continue;
        const g = gateOf(state, { unlock: f.unlock, coins: f.storePrice * f.out });
        out.push({ id: f.id, icon: f.id, kind: 'goods', name: t('market.feed.emergency', { feed: N(f.id) }), unlock: f.unlock,
          price: { coins: f.storePrice * f.out, acorns: 0 }, qty: f.out, owned: available(state, f.id), cap: null, tray: 0,
          text: t('market.feed.emergencyText', { q: Q(f.id, f.out) }), ...g,
          big: false, isNew: false });
      }
      return out;
    }
    case 'land':
      return landCards(state, env);
    default:
      return [];
  }
}

/** Free room in a home (capacity minus occupants). */
export function homeRoom(state, homeId) {
  const o = state.farm.objects[homeId];
  if (!o) return 0;
  const occ = Object.keys(state.farm.objects).filter((id) => state.farm.objects[id].home === homeId).length;
  return Math.max(0, homeCapacity(state, homeId) - occ);
}

/**
 * What stands in the way of a home's next room step, by name: "Weeds and Picket Fence are in the way" (the rules'
 * homeGrowth blockers; none = the home is at the edge of the land). The Animals panel's room step and the Market's card
 * for a full home both say it this way. Pure.
 */
export function blockerText(state, blockers) {
  const ids = Array.isArray(blockers) ? blockers : [];
  if (!ids.length) return t('market.blocker.edge');
  const nameOf = (id) => {
    const o = Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null;
    return o ? (state.farm.names?.[id]?.name ?? (defOf(o.def) ? cname(o.def, { form: lang() === 'bg' ? 'lc' : 'label' }) : null) ?? t('market.blocker.something')) : t('market.blocker.something');
  };
  const names = [...new Set(ids.map(nameOf))];
  const who = names.length > 2 ? t('market.blocker.andMore', { a: names[0], b: names[1], n: names.length - 2 }) : listOf(names);
  return t(ids.length > 1 ? 'market.blocker.many' : 'market.blocker.one', { list: who });
}

/** A home's capacity including upgrades (GDD §3.4: +upgradeStep per upgrade to capacityMax). */
export function homeCapacity(state, homeId) {
  if (typeof grid.capacityOf === 'function') {
    const c = grid.capacityOf(state, homeId);
    if (Number.isSafeInteger(c) && c > 0) return c;
  }
  const o = state.farm.objects[homeId];
  const def = o && homeOf(o.def);
  if (!def) return 0;
  const ups = Number.isSafeInteger(o.upgrades) ? o.upgrades : Number.isSafeInteger(o.ups) ? o.ups : 0;
  return Math.min(def.capacityMax, def.capacity + ups * def.upgradeStep);
}

/** Brush upgrades owned (farm-wide `farm.tools`). */
export function toolsOwned(state) {
  const t = state.farm.tools;
  if (Array.isArray(t)) return new Set(t);
  if (t && typeof t === 'object') return new Set(Object.keys(t).filter((k) => t[k]));
  return new Set();
}

/** Golden seeds waiting to be planted (`farm.golden`). */
export function goldenSeedsOf(state) {
  const g = state.farm.golden;
  return Number.isSafeInteger(g) ? g : 0;
}

// ---- land -------------------------------------------------------------------------------------------------------

/** Proof-task progress of an expansion when the rules track it: [{ verb, ref, qty, have }]. */
export function proofOf(state, exp, now) {
  const opened = Boolean(state.farm.proofs && Object.hasOwn(state.farm.proofs, exp.id));
  return exp.proof.map((t, i) => {
    let have;
    if (typeof expansionsA.proofProgress === 'function') have = expansionsA.proofProgress(state, exp.id, i, now).have;
    else have = t.verb === 'own' ? placedOf(state, t.ref).length : state.farm.proofs?.[exp.id]?.n?.[String(i)] ?? 0;
    return { ...t, have: Math.min(have, t.qty), started: opened || t.verb === 'own' };
  });
}

/** True once either player opened the expansion's card (its proof tasks count from then, GDD §3.9). */
export const proofOpened = (state, expId) => Boolean(state.farm.proofs && Object.hasOwn(state.farm.proofs, expId));

/** Expansion cards in purchase order (k = 1 ..), with what each one still needs. */
export function landCards(state, env = {}) {
  const level = levelOf(state);
  const ownedSet = new Set(state.farm.expansions);
  const exps = live('expansions').filter((e) => e.k > 0).sort((a, b) => a.k - b.k);
  const nextK = Math.min(...exps.filter((e) => !ownedSet.has(e.id)).map((e) => e.k));
  return exps.map((e) => {
    const owned = ownedSet.has(e.id);
    const needs = [];
    if (e.planks) needs.push({ item: 'planks', n: e.planks, have: available(state, 'planks') });
    if (e.crates) needs.push({ item: 'wooden_crate', n: e.crates, have: available(state, 'wooden_crate') });
    // `now`: "own 2 Apple Trees" counts settled trees only (RC-05), as the Buy button's rules do
    const proof = proofOf(state, e, env.now);
    let gate;
    if (owned) gate = { code: 'ALREADY_DONE', hint: { done: t('market.land.ours') } };
    else if (e.k !== nextK) gate = { code: 'LOCKED', hint: { text: t('market.land.before') } };
    else if (level < e.unlock) gate = { code: 'LOCKED', hint: { unlock: e.unlock } };
    else {
      const miss = needs.filter((x) => x.have < x.n).map((x) => ({ item: x.item, n: x.n - x.have }));
      const rulesCode = typeof expansionsA.expandCode === 'function' ? expansionsA.expandCode(state, e.id, env.now) : null;
      if (proof.some((p) => p.have < p.qty) || rulesCode === 'NOT_READY') gate = { code: 'NOT_READY', hint: { what: 'The proof task', text: t('market.land.proofNotReady') } }; // i18n-ok: `what` is the old field, the text shows
      else if (miss.length || rulesCode === 'NO_ITEMS') gate = { code: 'NO_ITEMS', hint: { missing: miss } };
      else gate = gateOf(state, { coins: e.cost });
    }
    return { id: e.id, k: e.k, icon: 'plot', kind: 'land', name: cname(e.id, { family: 'expansions' }), unlock: e.unlock, opened: proofOpened(state, e.id),
      price: { coins: e.cost, acorns: 0 }, needs, proof, proofText: e.proofText ? ctext('expansions', e.id, 'proofText', e.proofText) : null, reveals: ctext('expansions', e.id, 'reveals', e.reveals), rects: e.rects,
      owned, isNext: e.k === nextK, ...gate, big: !owned && bigSpend(state, e.cost, 0, env), isNew: isNewAt(e.unlock, level) };
  });
}

// ---- levels -------------------------------------------------------------------------------------------------------

/** XP bar numbers: { level, into, need, pct }. */
export function levelProgress(state) {
  const xp = state.farm.xp;
  const level = levelFromXp(xp);
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return { level, into: xp - from, need: to - from, pct: Math.max(0, Math.min(1, (xp - from) / Math.max(1, to - from))) };
}

export { MASTERY, GROWTH, feedOf, toolOf };

// ---- production buildings (GDD §3.3, §3.5) ------------------------------------------------------------------------

/** The queue of a building object, oldest first: [{ r, s, e, by, duet?, slow? }] (tech §2.4 sequential queue). */
export function queueOf(obj) {
  const q = obj && (obj.queue ?? obj.q);
  if (!Array.isArray(q)) return [];
  return q.map((it) => ({ r: it.r ?? it.recipe, s: it.s ?? it.start ?? it.startAt, e: it.e ?? it.end ?? it.endsAt,
    by: it.by ?? null, duet: Boolean(it.duet), slow: Boolean(it.slow), n: it.n ?? it.out ?? null,
    k: Number.isSafeInteger(it.k) ? it.k : null }));
}

/** Slots a building has now: the def's start count plus the slots bought (GDD §3.5 rule 4). */
export function slotsOf(obj, def) {
  if (Number.isSafeInteger(obj?.slots)) return obj.slots;
  const bought = obj?.extra ?? obj?.slotsBought ?? obj?.addedSlots ?? 0;
  return Math.min(def.slots[1], def.slots[0] + (Number.isSafeInteger(bought) ? bought : 0));
}

/** A recipe's craft time if queued now (mastery ★2, Golden Hour; duets alone x2), honouring the 50 % floor. */
export function craftMs(state, recipe, now, { slow = false } = {}) {
  let ms = recipe.ms;
  if (typeof economy.startCutBp === 'function' && typeof economy.cutMs === 'function') {
    ms = economy.cutMs(recipe.ms, economy.startCutBp(state, recipe.id, now));
  }
  return slow ? Math.floor((ms * COOP.duet.soloTimeBp) / 10_000) : ms;
}

/** Ingredient classes in words ("Need 2 more grain"). */
export const CLASS_NAMES = getters({ grain: () => t('market.class.grain'), root: () => t('market.class.root'), produce: () => t('market.class.produce') });

/**
 * Inputs of a recipe or feed with what the barn has: [{ item, need, have }], or class rows for feeds:
 * { cls, need, have, members: [{ id, n }] (usable now, cheapest first), any: [ids not marked "not for feed"],
 *   skipped: [{ id, n, why, keep, kept, keepBy }] (members in the Barn the Feed Mill leaves alone, and why),
 *   walk: the rules' rows for every member (crafting.feedWalk) }.
 * Class rows come from the rules' own walk (crafting.feedWalk = inputsFor), so `have` counts exactly what Make would use
 * without asking: never "not for feed" items, kept units or members worth too much to feed (RC-17).
 */
export function inputsOf(state, r) {
  if (r.inputs) return Object.entries(r.inputs).map(([item, need]) => ({ item, need, have: available(state, item) }));
  if (!Array.isArray(r.classes)) return [];
  return craftingA.feedWalk(state, r).classes.map((c) => {
    const members = c.members.filter((m) => m.why === null && m.free > 0).map((m) => ({ id: m.item, n: m.free }));
    return { cls: c.cls, need: c.qty, have: sum(members.map((m) => m.n)), members,
      any: c.members.filter((m) => m.why !== 'noFeed').map((m) => m.item), skipped: skippedOf(state, c.members), walk: c.members };
  });
}

/**
 * The members of one walked class that are in the Barn but held back, with the reason (the rules' own order: "not for
 * feed" first, then "worth too much", then Keep N). A member whose Keep N holds back only part of it counts as 'kept'.
 */
function skippedOf(state, members) {
  const out = [];
  for (const m of members) {
    if (m.have <= 0) continue;
    const kept = Math.min(m.have, m.keep);
    const why = m.why === 'noFeed' || m.why === 'valuable' ? m.why : kept > 0 ? 'kept' : null;
    if (!why) continue;
    out.push({ id: m.item, n: m.have, why, keep: m.keep, kept, keepBy: why === 'kept' ? keepOf(state, m.item).by : null });
  }
  return out;
}

const fmtN = fmtNum;
const nameOf = (id) => (itemOf(id) ? cname(id) : String(id).replace(/_/g, ' '));

/** Why the Feed Mill leaves a member alone, in words (the card's line, the item bubble). */
export const SKIP_WHY = getters({
  noFeed: () => t('market.skip.noFeed'),
  valuable: () => t('market.skip.valuable'),
});

/**
 * One skipped member as the player reads it: "Wheat 76 — marked "not for feed" in the Barn", "Wheat 76 — all 76 kept
 * (Keep 80)", "Wheat 76 — 70 kept (Keep 70)", "Sunflower 12 — worth too much to feed without asking".
 */
export function skipText(x) {
  const item = nameOf(x.id);
  if (x.why === 'kept') {
    return x.kept >= x.n ? t('market.skip.keptAll', { item, n: x.n, keep: x.keep })
      : t('market.skip.keptSome', { item, n: x.n, kept: x.kept, keep: x.keep });
  }
  return t('market.skip.line', { item, n: x.n, why: SKIP_WHY[x.why] ?? t('market.skip.notUsed') });
}

/** The one-tap way out of a skip: 'allow' (noFeed off), 'unkeep' (Keep N to 0), 'confirm' (Make, then "Use anyway"). */
export const SKIP_FIX = Object.freeze({
  noFeed: Object.freeze({ kind: 'allow', get label() { return t('market.skip.fix.allow'); } }),
  kept: Object.freeze({ kind: 'unkeep', get label() { return t('market.skip.fix.unkeep'); } }),
  valuable: Object.freeze({ kind: 'confirm', get label() { return t('market.skip.fix.confirm'); } }),
});

/**
 * What stands between the farm and a feed (pure; null for a fixed-input recipe, which never skips anything):
 *   blocked      the rules would not make it as things stand (inputsFor is null)
 *   confirmable  blocked, but a confirmed Make would (only members worth too much are left: RESERVED, "Use anyway")
 *   ask          what a confirmed Make takes ({ item: n }) or null
 *   lines        the skipped members of every class that is short, each { id, n, why, text, fix } (fix null when
 *                that way out would not help: "worth too much" while even a confirm falls short). Shown on the card.
 *   quiet        not blocked: the members marked "not for feed" that are in the Barn anyway ([{ id, n }]), for one
 *                muted line ("worth too much" is the design and Keep N shows in the Barn: neither is clutter here)
 */
export function feedSkips(state, r) {
  if (!r || r.inputs || !Array.isArray(r.classes)) return null;
  const walk = craftingA.feedWalk(state, r);
  const ask = walk.take ? null : craftingA.feedWalk(state, r, { valuable: true }).take;
  const blocked = walk.take === null;
  const confirmable = blocked && ask !== null;
  const lines = [];
  const quiet = [];
  for (const c of walk.classes) {
    for (const x of skippedOf(state, c.members)) {
      if (blocked && c.short > 0) {
        const fix = x.why === 'valuable' && !confirmable ? null : SKIP_FIX[x.why];
        if (!lines.some((y) => y.id === x.id)) lines.push({ ...x, cls: c.cls, text: skipText(x), fix });
      } else if (!blocked && x.why === 'noFeed' && !quiet.some((y) => y.id === x.id)) quiet.push({ id: x.id, n: x.n });
    }
  }
  return { blocked, confirmable, ask: confirmable ? ask : null, lines, quiet };
}

/** "Not used for feed: Wheat 76, Corn 4 (marked in the Barn)" (the muted line of a feed that can be made anyway). */
export const quietText = (quiet) => (quiet.length
  ? t('market.skip.quiet', { list: quiet.map((x) => t('market.skip.stack', { item: nameOf(x.id), n: x.n })).join(', ') }) : '');

/** The Undo toast after the Barn switch or an "Allow for feed": "Wheat won't be used for animal feed". */
export const noFeedText = (item, on) => (on ? t('market.skip.noFeedOn', { item: N(item) })
  : t('market.skip.noFeedOff', { item: N(item) }));

/** The Undo toast after "Stop keeping": "Wheat isn't kept any more (was Keep 80)". */
export const unkeepText = (item, was) => t('market.skip.unkept', { item: N(item), was });

/** True when some building of the farm has this recipe in its queue or tray (it counts as "made" for "Try it"). */
export function queuedAnywhere(state, recipeId) {
  for (const id of Object.keys(state.farm.objects)) {
    const q = state.farm.objects[id].queue;
    if (Array.isArray(q) && q.some((it) => (it.r ?? it.recipe) === recipeId)) return true;
  }
  return false;
}

/** True when the farm has never made this recipe ("Try it" ribbon until the first craft, GDD §3.5 rule 10). */
export function neverMade(state, recipeId) {
  return masteryCount(state, recipeId) === 0 && own(state.farm.stats, `craft.${recipeId}`) === 0
    && own(state.farm.stats, `make.${recipeId}`) === 0;
}

const HURRY_HOUR = 3_600_000;
/** Hurry price in Acorns for `left` ms: 1 per started hour, at most BOOSTS.hurry.maxAcorns (GDD §3.7). */
export const hurryAcorns = (left) => (typeof boostsA.hurryCost === 'function' ? boostsA.hurryCost(left)
  : Math.max(1, Math.min(BOOSTS.hurry.maxAcorns, Math.ceil(left / HURRY_HOUR) * BOOSTS.hurry.acornsPerHour)));

/**
 * What Hurry would finish on object `id` now and its price, exactly as the rules compute it (a sapling's Hurry
 * finishes it AND its first fruit): { acorns, rest, at } or null when nothing is running.
 */
export function hurryQuote(state, id, now) {
  const o = Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null;
  if (!o) return null;
  if (typeof boostsA.hurryTarget === 'function') {
    const t = boostsA.hurryTarget(o, now);
    return t && !t.code ? { acorns: hurryAcorns(t.rest), rest: t.rest, at: t.at } : null;
  }
  const at = o.readyAt ?? o.adultAt ?? null;
  return at && at > now ? { acorns: hurryAcorns(at - now), rest: at - now, at } : null;
}

/**
 * Everything the building panel shows for object `id` at `now`: the queue (done / running / queued), the slots,
 * the next slot's price, the tray count, the collector (Compost Bin) and every live recipe with inputs have/need.
 */
export function buildingView(state, id, now) {
  const obj = Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null;
  const def = obj && buildingOf(obj.def);
  if (!def) return null;
  const level = levelOf(state);
  const queue = queueOf(obj).map((q, i) => {
    const r = recipeOf(q.r) || feedOf(q.r);
    const status = q.e <= now ? 'done' : q.s <= now ? 'running' : 'queued';
    return { i, ...q, recipe: r, item: r ? r.id : q.r, out: q.n ?? r?.out ?? 1, status };
  });
  const slots = slotsOf(obj, def);
  // a Kitchen's reward slots (`xs`, Grandma's Farmhouse) are not bought ones and lift the maximum
  const bought = slots - (obj.xs ?? 0) - def.slots[0];
  const nextCost = typeof craftingA.slotPrice === 'function' && Number.isSafeInteger(obj.slots) ? craftingA.slotPrice(obj)
    : slots < def.slots[1] ? def.slotCosts[bought] ?? null : null;
  const recipes = recipesOf(def.id).map((r) => {
    const ins = inputsOf(state, r);
    const missing = ins.filter((x) => x.have < x.need).map((x) => ({ item: x.item ?? classMembers(x.cls)[0], n: x.need - x.have, cls: x.cls,
      label: x.cls ? CLASS_NAMES[x.cls] ?? x.cls : undefined }));
    const st = starsOf(state, 'recipes', r.id);
    return {
      id: r.id, name: cname(r.id), out: r.out, ms: craftMs(state, r, now), baseMs: r.ms, slowMs: r.duet ? craftMs(state, r, now, { slow: true }) : null,
      unlock: r.unlock, locked: level < r.unlock, isFeed: !r.inputs, inputs: ins, missing, sell: r.sell, xp: r.xp,
      duetXp: r.duetXp ?? null, tier: r.tier ?? null, duet: Boolean(r.duet), stars: st.stars, mastery: st,
      tryIt: level >= r.unlock && neverMade(state, r.id) && !queuedAnywhere(state, r.id),
      skips: feedSkips(state, r),
    };
  });
  const collector = def.collector ? collectorOf(obj, def) : null;
  return {
    id, def, name: cname(def.id), obj, queue, slots, max: def.slots[1] + (obj.xs ?? 0), nextCost, bought,
    tray: queue.filter((q) => q.status === 'done').length,
    trayUnits: sum(queue.filter((q) => q.status === 'done').map((q) => q.out)),
    free: slots - queue.length, running: queue.find((q) => q.status === 'running') ?? null,
    endsAt: queue.length ? Math.max(...queue.map((q) => q.e)) : null,
    recipes, collector, duet: duetPending(state, id, now),
  };
}

/** The Compost Bin's collector state (GDD §3.4 rule 8): points toward the next batch and batches waiting. */
export function collectorOf(obj, def) {
  const c = def.collector;
  const points = Number.isSafeInteger(obj.pts) ? obj.pts : 0;
  const ready = Number.isSafeInteger(obj.ready) ? obj.ready : 0;
  const batches = Math.min(c.maxBatches, Math.floor(ready / c.out));
  return { item: c.item, every: c.every, out: c.out, max: c.maxBatches, points: points % c.every, ready, batches,
    full: batches >= c.maxBatches };
}

/** A pending duet press at a building (joint slot, tech §15.4): { by, at, recipe, until } or null. */
export function duetPending(state, buildingId, now) {
  const o = Object.hasOwn(state.farm.objects, buildingId) ? state.farm.objects[buildingId] : null;
  const j = o && o.joint;
  if (!j || typeof j !== 'object' || !Number.isSafeInteger(j.at)) return null;
  if (now - j.at > COOP.duet.windowMs) return null;
  return { by: j.by, at: j.at, recipe: j.r ?? j.recipe ?? null, until: j.at + COOP.duet.windowMs };
}

// ---- animal homes (GDD §3.4) ---------------------------------------------------------------------------------------

/** The farm calendar day of `now` (pets last until the end of the real day). */
const dayOf = (state, now) => (typeof economy.dayOf === 'function' ? economy.dayOf(state, now) : calendar.dayIndex(now, state.meta.tz));

/**
 * One animal's state for the home panel: baby / hungry / producing / ready, with the next timestamp, its blue-ribbon
 * progress and who petted it today.
 */
export function animalView(state, id, now) {
  const o = Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null;
  const def = o && animalOf(o.def);
  if (!def) return null;
  const baby = Number.isSafeInteger(o.adultAt) && now < o.adultAt;
  const status = baby ? 'baby' : o.readyAt === null || o.readyAt === undefined ? 'hungry' : o.readyAt <= now ? 'ready' : 'producing';
  const today = dayOf(state, now);
  const petBy = o.pet && o.pet.day === today ? o.pet.by.slice() : [];
  return {
    id, def, name: state.farm.names?.[id]?.name ?? null, namedBy: state.farm.names?.[id]?.by ?? null, status, baby,
    start: baby ? o.placedAt : o.fedAt ?? null, end: baby ? o.adultAt : o.readyAt ?? null,
    cycle: o.cycle ?? 0, prizedAt: def.prizedAt, prized: (o.cycle ?? 0) >= def.prizedAt, petBy,
    refundable: Boolean(o.rcpt && o.rcpt.until > now), rcptUntil: o.rcpt?.until ?? null, free: Boolean(o.free),
    paid: o.paid?.coins ?? 0, bottle: def.bottle, feed: def.feed, feedQty: def.feedQty,
  };
}

/** A home and its animals: capacity (with upgrades), the next upgrade, who needs what. */
export function homeView(state, id, now) {
  let homeId = id;
  const o0 = Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null;
  if (o0 && o0.home) homeId = o0.home;                       // opened on an animal: show its home
  const o = Object.hasOwn(state.farm.objects, homeId) ? state.farm.objects[homeId] : null;
  const def = o && homeOf(o.def);
  if (!def) return null;
  const ids = Object.keys(state.farm.objects).sort().filter((k) => state.farm.objects[k].home === homeId);
  const animals = ids.map((k) => animalView(state, k, now)).filter(Boolean);
  const cap = homeCapacity(state, homeId);
  const species = def.species.map((sp) => animalOf(sp)).filter((a) => a && isLive(a));
  const feeds = [...new Set(species.map((a) => a.feed).filter(Boolean))].map((f) => ({ item: f, have: available(state, f), keep: keepOf(state, f).n }));
  const count = (st) => animals.filter((a) => a.status === st).length;
  const growth = typeof animalsA.homeGrowth === 'function' ? animalsA.homeGrowth(state, homeId) : null;
  return {
    id: homeId, def, obj: o, name: cname(def.id), animals, cap, room: Math.max(0, cap - animals.length),
    // wave 4b: homes grow past the old capacityMax (the rules' homeGrowth owns the next room step and the cap)
    upgrade: growth && growth.code !== 'CAP' ? { coins: growth.coins, add: growth.next - growth.cap, to: growth.next,
      grows: growth.grows, size: growth.nextSize, code: growth.code, blockers: growth.blockers } : null,
    max: growth ? growth.max : def.capacityMax, species, feeds, ready: count('ready'), hungry: count('hungry'), babies: count('baby'),
    producing: count('producing'), nextAt: Math.min(...animals.filter((a) => a.end && a.end > now).map((a) => a.end), Infinity),
    petToday: animals.filter((a) => a.petBy.length > 0).length,
  };
}

// ---- trees (GDD §3.2) ------------------------------------------------------------------------------------------------

/** A tree's state: sapling / growing / ripe, its yield with the Grove and Compost bonuses, mastery. */
export function treeView(state, id, now) {
  const o = Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null;
  const def = o && treeOf(o.def);
  if (!def) return null;
  const sapling = Number.isSafeInteger(o.matureAt) && now < o.matureAt;
  const ripe = !sapling && Number.isSafeInteger(o.readyAt) && o.readyAt <= now;
  const grove = typeof treesA.inGrove === 'function' ? Boolean(treesA.inGrove(state, o)) : false;
  const st = starsOf(state, 'trees', def.id);
  const bonus = (grove ? GROWTH.grove.bonusUnits : 0) + (o.compost ? GROWTH.compost.treeBonusUnits : 0);
  return {
    id, def, obj: o, name: cname(def.id), sapling, ripe, status: sapling ? 'sapling' : ripe ? 'ripe' : 'growing',
    start: sapling ? o.placedAt : o.startedAt ?? null, end: sapling ? o.matureAt : o.readyAt ?? null,
    yield: def.yield, bonus, product: def.product, chop: def.tool === 'axe', grove, harvests: o.cycle ?? 0,
    watered: o.water ?? null, tended: o.tend ?? null, composted: Boolean(o.compost), stars: st.stars, mastery: st,
    cycleMs: def.cycleMs, refundable: Boolean(o.rcpt && o.rcpt.until > now), free: Boolean(o.free),
  };
}
