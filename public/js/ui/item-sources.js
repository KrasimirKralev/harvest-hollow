// "Where to get it" (live requests 2026-10-04): every way the farm can come by an item, computed from the content
// tables and the replicated state, for the item hint bubble (ui/item-hint.js). PURE: no DOM, no clock, no store, so
// test/ui-item-hint.test.js can walk every live item.
//
//   itemSources(itemId, state, { now? }) -> [source]      ordered: what makes it (workshops, the Feed Mill), what grows or lays
//                                                it (crops, trees, animals), lucky finds and side sources (debris, the
//                                                Compost Bin), then the General Store. Every live item has at least one.
//     source = { key, kind, icon, title, text, note, state, show }
//       kind   'recipe' | 'feed' | 'crop' | 'tree' | 'animal' | 'premium' | 'collector' | 'debris' | 'store'
//       state  'ready'  the farm can do it now (the building, tree or animal is here and unlocked)
//              'build'  it needs something bought first (note says what and where)
//              'locked' a later farm level (note says which)
//              'info'   nothing to buy (stumps on the farm, a lucky find)
//       show   { panel, args } the panel a "Show me" opens (the producing building, the tree, the pen, or the
//              Market tab with that card ringed), or null
//   itemHint(itemId, state, { need?, cls?, recipe?, now? }) -> { id, name, have, need, short, sources, cls?, usable? }
//       the bubble's whole model: the header (have / need) and the sources; `cls` (an ingredient class such as
//       'grain' on a Feed Mill chip) adds every member of the class; with `recipe` (the feed) the header counts what
//       the Feed Mill may use and cls.rows says why a member in the Barn is skipped (feedClass)
import {
  CONTENT, live, itemOf, cropOf, buildingOf, homeOf, classMembers, pluralOf, levelFromXp, isLive, GROWTH, feedOf,
} from '../../../shared/content/index.js';
import { placedOf, inTray, priceOf, durationText, inputsOf, feedSkips, skipText, SKIP_FIX } from './panels/model.js';

const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmt = (n) => NUM.format(Math.trunc(Number(n) || 0));
const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : 0);

/** Ingredient classes in words (the Feed Mill's inputs). */
export const CLASS_WORDS = Object.freeze({ grain: 'any grain', root: 'any root crop', produce: 'any crop or fruit',
  veg: 'any vegetable', fruit: 'any fruit', flower: 'any flower', fibre: 'any fibre', cane: 'any cane' });

/** The class as a noun for the bubble's count line ("0 / 3 grain usable for feed"). */
const CLASS_NOUN = Object.freeze({ grain: 'grain', root: 'root crops', produce: 'crops or fruit' });

const levelOf = (state) => levelFromXp(state?.farm?.xp ?? 0);
const nameOf = (id) => itemOf(id)?.name ?? String(id).replace(/_/g, ' ');
/** "2 Planks", "1 Egg", "3 Carrots" */
const qty = (n, id) => `${fmt(n)} ${pluralOf(nameOf(id), n)}`;
/** "a Sawmill", "an Apple Tree" */
const article = (name) => `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;

/** Placed objects of a def on this farm (none without a state). */
const placed = (state, defId) => (state ? placedOf(state, defId) : []);
const tray = (state, defId) => (state ? inTray(state, defId) : 0);
/** Price words of the next copy: "6,000 coins", "free". */
function priceWords(state, defId) {
  const p = state ? priceOf(state, defId) : { coins: CONTENT.buildings.get(defId)?.cost ?? 0, acorns: 0 };
  if (p.acorns > 0) return `${fmt(p.acorns)} Acorns`;
  return p.coins > 0 ? `${fmt(p.coins)} coins` : 'free';
}

/**
 * How a def that is not on the farm yet is had: from the build tray, else from a Market tab (with the unlock level
 * while it is locked, else its price). -> { state, note, show }
 */
function acquire(state, def, tab, tabLabel, verb = 'Build', name = def.name) {
  const level = levelOf(state);
  const unlock = def.unlock ?? 1;
  const show = { panel: 'market', args: { tab, focus: def.id } };
  if (tray(state, def.id) > 0) {
    return { state: 'build', note: `Place ${article(name)} from your build tray (it is free)`, show };
  }
  if (level < unlock) return { state: 'locked', note: `${verb} ${article(name)} (Market → ${tabLabel}, level ${unlock})`, show };
  return { state: 'build', note: `${verb} ${article(name)} (Market → ${tabLabel}, ${priceWords(state, def.id)})`, show };
}

// ---- the producers -------------------------------------------------------------------------------------------------

/** A workshop recipe or a Feed Mill feed that makes the item. */
function crafted(state, r, kind) {
  const b = buildingOf(r.building);
  if (!b || !isLive(b)) return null;
  const level = levelOf(state);
  const ins = kind === 'feed'
    ? r.classes.map(({ cls, qty: n }) => `${fmt(n)} of ${CLASS_WORDS[cls] ?? `any ${cls}`}`)
    : Object.entries(r.inputs).map(([id, n]) => qty(n, id));
  const duet = r.duet ? ' · cook it together (or alone, twice as long)' : '';
  const text = `${ins.join(' + ')} → ${r.out > 1 ? qty(r.out, r.id) : nameOf(r.id)} · ${durationText(r.ms)}${duet}`;
  const mine = placed(state, b.id);
  const src = { key: `${kind}:${r.id}`, kind, icon: b.id, title: b.name, text };
  if (mine.length) {
    const show = { panel: 'building', args: { id: mine[0], focus: r.id } };
    if (level < r.unlock) return { ...src, state: 'locked', note: `The recipe opens at level ${r.unlock}`, show };
    return { ...src, state: 'ready', note: mine.length > 1 ? `You have ${mine.length}` : `You have ${article(b.name)}`, show };
  }
  const a = acquire(state, b, 'buildings', 'Buildings');
  // a building the farm can buy but whose recipe waits for a later level: say both
  if (a.state !== 'locked' && level < r.unlock) a.note += `; the recipe opens at level ${r.unlock}`;
  return { ...src, ...a };
}

/** A crop grown on a plot. */
function grown(state, c, now) {
  const level = levelOf(state);
  let growing = 0;
  let ripe = 0;
  if (state) {
    for (const id of placedOf(state, 'plot')) {
      const crop = state.farm.objects[id].crop;
      if (!crop || crop.def !== c.id) continue;
      if (Number.isFinite(now) && crop.readyAt <= now) ripe++; else growing++;
    }
  }
  const text = `Plant it on a plot (${fmt(c.seed)} coins a seed): ${qty(c.yield, c.id)} per plot in ${durationText(c.growMs)}`;
  const src = { key: `crop:${c.id}`, kind: 'crop', icon: c.id, title: `Grow ${c.name}`, text,
    show: { panel: 'market', args: { tab: 'seeds', focus: c.id } } };
  if (level < c.unlock) return { ...src, state: 'locked', note: `Seeds unlock at level ${c.unlock} (Market → Seeds)` };
  const plots = (n) => `${fmt(n)} plot${n === 1 ? '' : 's'}`;
  const note = ripe && growing ? `${plots(growing)} growing, ${fmt(ripe)} ready to harvest`
    : ripe ? `${plots(ripe)} ready to harvest` : growing ? `${plots(growing)} growing now`
      : 'Pick it in the seed picker on an empty plot, or Market → Seeds';
  return { ...src, state: 'ready', note };
}

/** "Apple Tree", "Pine tree" (the woodlot's name without its note). */
function treeWord(t) {
  const n = t.name.replace(/\s*\(.*\)\s*$/, '');
  return /tree$/i.test(n) ? n : `${n} tree`;
}

/** A tree's harvest (fruit with the Basket, Wood with the Axe). */
function picked(state, t) {
  const axe = t.tool === 'axe';
  const trees = pluralOf(treeWord(t), 2);
  const title = axe ? `Chop ${trees} with the Axe` : `Pick ${pluralOf(nameOf(t.product), 2)} from ${trees}`;
  const text = `${axe ? '' : 'With the Basket: '}${qty(t.yield, t.product)} every ${durationText(t.cycleMs)} once grown`;
  const src = { key: `tree:${t.id}`, kind: 'tree', icon: t.id, title, text };
  const mine = placed(state, t.id);
  if (mine.length) {
    return { ...src, state: 'ready', note: `You have ${fmt(mine.length)}`, show: { panel: 'tree', args: { id: mine[0] } } };
  }
  return { ...src, ...acquire(state, t, 'trees', 'Trees', 'Buy', treeWord(t)) };
}

/** Animals in their home: their product, fed with their feed (bees forage on their own). */
function laid(state, a, premium = false) {
  const home = homeOf(a.homes[0]);
  const many = a.feed === null && home ? pluralOf(home.name, 2) : pluralOf(a.name, 2);
  const title = premium ? `A lucky find from ${many}` : `Collect from ${many}`;
  const bp = GROWTH.prizedAnimal?.premiumBp ?? a.premiumBp ?? 1000;
  const odds = bp > 0 ? Math.max(1, Math.round(10_000 / bp)) : 10;
  const one = a.feed === null && home ? home.name : a.name;
  const text = premium
    ? `A blue-ribbon ${one.toLowerCase()} (${fmt(a.prizedAt)} collections) brings ${article(nameOf(a.premium))} about 1 time in ${fmt(odds)}`
    : a.feed === null
      ? `The bees forage flowers and fruit trees nearby: ${qty(a.out, a.product)} every ${durationText(a.cycleMs)}`
      : `Feed them ${nameOf(a.feed)}: ${qty(a.out, a.product)} every ${durationText(a.cycleMs)}`;
  const src = { key: `${premium ? 'premium' : 'animal'}:${a.id}`, kind: premium ? 'premium' : 'animal',
    icon: a.feed === null && home ? home.id : a.id, title, text };
  const homes = home ? placed(state, home.id) : [];
  const mine = placed(state, a.id);
  if (mine.length && homes.length) {
    const prized = mine.filter((id) => (state.farm.objects[id].cycle ?? 0) >= a.prizedAt).length;
    const note = !premium ? `${fmt(mine.length)} on the farm`
      : prized ? `${fmt(prized)} of yours ${prized === 1 ? 'is' : 'are'} blue-ribbon` : 'None of yours is blue-ribbon yet';
    return { ...src, state: premium && !prized ? 'info' : 'ready', note, show: { panel: 'animals', args: { id: homes[0] } } };
  }
  // the bees come with their hive (no animal to buy): the hive is what is had
  if (a.feed === null && home) return { ...src, ...acquire(state, home, 'animals', 'Animals') };
  if (home && !homes.length && levelOf(state) >= (home.unlock ?? 1)) {
    const h = acquire(state, home, 'animals', 'Animals');
    return { ...src, ...h, note: `${h.note}, then buy ${pluralOf(a.name, 2)}` };
  }
  const level = levelOf(state);
  const show = { panel: 'market', args: { tab: 'animals', focus: a.id } };
  if (level < a.unlock) return { ...src, state: 'locked', note: `Buy ${pluralOf(a.name, 2)} (Market → Animals, level ${a.unlock})`, show };
  return { ...src, state: 'build', note: `Buy ${pluralOf(a.name, 2)} (Market → Animals)`, show };
}

/** A building that fills on its own (the Compost Bin: points from animal collections). */
function collected(state, b) {
  const c = b.collector;
  const src = { key: `collector:${b.id}`, kind: 'collector', icon: b.id, title: b.name,
    text: `${qty(c.out, c.item)} for every ${fmt(c.every)} animal collections` };
  const mine = placed(state, b.id);
  if (mine.length) return { ...src, state: 'ready', note: `You have ${article(b.name)}`, show: { panel: 'building', args: { id: mine[0] } } };
  return { ...src, ...acquire(state, b, 'buildings', 'Buildings') };
}

/** Debris that pays the item when cleared (Wood from stumps and fallen logs). */
function debrisSource(state, item) {
  if (item !== 'wood') return null;
  const kinds = live('debris').filter((d) => d.wood > 0);
  if (!kinds.length) return null;
  const woods = kinds.map((d) => d.wood);
  const lo = Math.min(...woods);
  const hi = Math.max(...woods);
  const names = kinds.map((d) => pluralOf(d.name, 2).toLowerCase());
  let left = 0;
  if (state) for (const d of kinds) left += placedOf(state, d.id).length;
  return {
    key: 'debris:wood', kind: 'debris', icon: kinds[0].id, title: `Chop ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]} with the Axe`,
    text: `${lo === hi ? fmt(lo) : `${fmt(lo)}-${fmt(hi)}`} Wood each, cleared for good`,
    state: 'info', note: left ? `${fmt(left)} on the farm now` : 'None left: new land brings more', show: null,
  };
}

/** The General Store's emergency feed (2.5 x its value, Market → Tools). */
function storeSource(state, it) {
  if (!(it.storePrice > 0)) return null;
  const f = CONTENT.feeds.get(it.id);
  const n = f?.out ?? 1;
  const show = { panel: 'market', args: { tab: 'tools', focus: it.id } };
  const src = { key: `store:${it.id}`, kind: 'store', icon: 'market_stand', title: 'General Store',
    text: `${qty(n, it.id)} for ${fmt(it.storePrice * n)} coins: an emergency buy, the Feed Mill makes it far cheaper`, show };
  if (levelOf(state) < (it.unlock ?? 1)) return { ...src, state: 'locked', note: `Level ${it.unlock} (Market → Tools)` };
  return { ...src, state: 'ready', note: 'Market → Tools' };
}

// ---- the list ------------------------------------------------------------------------------------------------------

const ORDER = ['recipe', 'feed', 'crop', 'tree', 'animal', 'premium', 'collector', 'debris', 'store'];

/**
 * Every way to come by `itemId` on this farm, best first (see the header). An unknown id answers [].
 * @param {string} itemId @param {object|null} state
 */
export function itemSources(itemId, state, { now } = {}) {
  const it = itemOf(itemId);
  if (!it) return [];
  const out = [];
  for (const r of live('recipes')) if (r.id === itemId) out.push(crafted(state, r, 'recipe'));
  for (const f of live('feeds')) if (f.id === itemId) out.push(crafted(state, f, 'feed'));
  const c = cropOf(itemId);
  if (c && isLive(c)) out.push(grown(state, c, now));
  for (const t of live('trees')) if (t.product === itemId) out.push(picked(state, t));
  for (const a of live('animals')) {
    if (a.product === itemId) out.push(laid(state, a));
    if (a.premium === itemId) out.push(laid(state, a, true));
  }
  for (const b of live('buildings')) if (b.collector && b.collector.item === itemId) out.push(collected(state, b));
  out.push(debrisSource(state, itemId));
  out.push(storeSource(state, it));
  const list = out.filter(Boolean);
  // stable: the kinds in ORDER, and inside one kind what the farm can do now before what it must buy or wait for
  const rank = { ready: 0, build: 1, info: 1, locked: 2 };
  return list.map((s, i) => [s, i]).sort((x, y) => ORDER.indexOf(x[0].kind) - ORDER.indexOf(y[0].kind)
    || rank[x[0].state] - rank[y[0].state] || x[1] - y[1]).map(([s]) => s);
}

/**
 * The bubble's model: the item, what the barn holds against what is needed, and where to get it.
 * @param {string} itemId @param {object|null} state @param {{ need?: number, cls?: string, recipe?: string }} [o]
 *   recipe: the feed a class chip belongs to (data-hint-recipe). With it, the class part comes from the rules' own walk
 *   (model.inputsOf = crafting.feedWalk): the header counts what the Feed Mill may USE, and `cls.rows` names every
 *   member in the Barn with why it is skipped and its one-tap way out (owner report 2026-10-04).
 */
export function itemHint(itemId, state, { need, cls, recipe, now } = {}) {
  const it = itemOf(itemId);
  if (!it) return null;
  const have = state ? own(state.farm.inventory, itemId) + own(state.farm.overflow, itemId) : 0;
  const n = Number.isSafeInteger(need) && need > 0 ? need : null;
  const out = { id: itemId, name: it.name, have, need: n, short: n === null ? 0 : Math.max(0, n - have),
    sources: itemSources(itemId, state, { now }) };
  if (cls) {
    const ids = classMembers(cls);
    if (ids.length) {
      out.cls = { cls, words: CLASS_WORDS[cls] ?? `any ${cls}`,
        members: ids.map((id) => ({ id, name: nameOf(id), have: state ? own(state.farm.inventory, id) + own(state.farm.overflow, id) : 0 })) };
      const feed = state && recipe ? feedClass(state, recipe, cls) : null;
      if (feed) {
        Object.assign(out.cls, feed);
        out.usable = CLASS_NOUN[cls] ?? cls;
        out.have = feed.usable;
        out.short = n === null ? 0 : Math.max(0, n - feed.usable);
      }
    }
  }
  return out;
}

/**
 * One class of feed `recipeId` as the Feed Mill sees it now (pure): { usable, rows, none, blocked }.
 *   rows  every member in the Barn, cheapest first: { id, name, n, use, why, text, fix }; why null = usable (`use` units);
 *         fix { kind: 'allow' | 'unkeep', label } a one-tap way out (Keep N only while the class is short), or
 *         { kind: 'ask', label } for "worth too much" when Make would ask and go ahead, or null
 *   none  the names of the members with none in the Barn
 */
export function feedClass(state, recipeId, cls) {
  const r = feedOf(recipeId);
  if (!r || !Array.isArray(r.classes)) return null;
  const x = inputsOf(state, r).find((c) => c.cls === cls);
  if (!x) return null;
  const skips = feedSkips(state, r);
  const short = x.have < x.need;
  const rows = [];
  const none = [];
  for (const m of x.walk) {
    const use = x.members.find((u) => u.id === m.item)?.n ?? 0;
    const skip = x.skipped.find((s) => s.id === m.item) ?? null;
    if (m.have <= 0) { none.push(nameOf(m.item)); continue; }
    if (!skip && use <= 0) continue;
    let fix = null;
    if (skip?.why === 'noFeed') fix = SKIP_FIX.noFeed;
    else if (skip?.why === 'kept' && short) fix = SKIP_FIX.kept;
    else if (skip?.why === 'valuable' && skips?.confirmable) fix = { kind: 'ask', label: 'Make asks first' };
    rows.push({ id: m.item, name: nameOf(m.item), n: m.have, use, why: skip?.why ?? null, keep: m.keep,
      text: skip ? skipText(skip) : `${nameOf(m.item)} ${fmt(m.have)}${use < m.have ? ` · ${fmt(use)} usable` : ''}`, fix });
  }
  return { usable: x.have, rows, none, blocked: Boolean(skips?.blocked) };
}

/** The status line of a hint's header: "0 / 2 in the barn · need 2 more" | "14 in the barn" | "0 / 3 grain usable for feed". */
export function haveLine(m) {
  if (!m) return '';
  // a Feed Mill class chip counts the class, not the pictured member: "0 / 3 grain usable for feed"
  const where = m.usable ? `${m.usable} usable for feed` : 'in the barn';
  if (m.need === null) return `${fmt(m.have)} ${where}`;
  return m.short > 0 ? `${fmt(m.have)} / ${fmt(m.need)} ${where} · need ${fmt(m.short)} more`
    : `${fmt(m.have)} / ${fmt(m.need)} ${where} · enough`;
}
