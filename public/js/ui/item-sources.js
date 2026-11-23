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
import { t as tr, tn as trn, live as liveKeys, fmtNum, N, nameEntry, qty as qtyOf, name as cname } from '../i18n/index.js';
import { prep } from './goal-text.js';

/** A catalog sentence with the Bulgarian prepositions fixed ("със захар", "във фермата"). */
const t = (key, params) => prep(tr(key, params));
const tn = (key, n, params) => prep(trn(key, n, params));

const fmt = (n) => fmtNum(n);
const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : 0);

const CLASSES = ['grain', 'root', 'produce', 'veg', 'fruit', 'flower', 'fibre', 'cane'];
/** Ingredient classes in words (the Feed Mill's inputs), in the language in effect. */
export const CLASS_WORDS = liveKeys(Object.fromEntries(CLASSES.map((c) => [c, `goals.src.cls.${c}`])));
/** "3 of any grain" (a recipe's class input). */
const classIn = (cls, n) => (CLASSES.includes(cls) ? t(`goals.src.in.${cls}`, { n }) : t('goals.src.in.any', { n, cls }));

/** The class as a noun for the bubble's count line ("0 / 3 grain usable for feed"). */
const CLASS_NOUN = liveKeys({ grain: 'goals.src.noun.grain', root: 'goals.src.noun.root', produce: 'goals.src.noun.produce' });

const levelOf = (state) => levelFromXp(state?.farm?.xp ?? 0);
const nameOf = (id) => itemOf(id)?.name ?? String(id).replace(/_/g, ' ');
/** "2 Planks", "1 Egg", "3 Carrots" / "2 дъски" */
const qty = (n, id) => (itemOf(id) ? qtyOf(id, n, { family: 'items' }) : `${fmt(n)} ${pluralOf(nameOf(id), n)}`);
/** "a"/"an" before an English name (English-only grammar). */
const an = (en) => (/^[aeiou]/i.test(String(en)) ? 'an' : 'a');
/** A content name for a sentence: the Bulgarian ref when the names table has one, else the English the code holds. */
const nm = (id, en, family) => (nameEntry(id, family) ? N(id, family) : en);
/** The same as a label. */
const label = (id, en, family) => (nameEntry(id, family) ? cname(id, { family }) : en);
/** An item's name as a label. */
const itemLabel = (id) => (itemOf(id) ? label(id, nameOf(id), 'items') : nameOf(id));

/** Placed objects of a def on this farm (none without a state). */
const placed = (state, defId) => (state ? placedOf(state, defId) : []);
const tray = (state, defId) => (state ? inTray(state, defId) : 0);
/** Price words of the next copy: "6,000 coins", "free". */
function priceWords(state, defId) {
  const p = state ? priceOf(state, defId) : { coins: CONTENT.buildings.get(defId)?.cost ?? 0, acorns: 0 };
  if (p.acorns > 0) return t('goals.src.acorns', { n: p.acorns });
  return p.coins > 0 ? t('goals.src.coins', { n: p.coins }) : t('goals.src.free');
}

/**
 * How a def that is not on the farm yet is had: from the build tray, else from a Market tab (with the unlock level
 * while it is locked, else its price). -> { state, note, show }
 */
function acquire(state, def, tab, verb = 'build', name = def.name) {
  const level = levelOf(state);
  const unlock = def.unlock ?? 1;
  const show = { panel: 'market', args: { tab, focus: def.id } };
  const x = { _a: an(name), x: nm(def.id, name), tab: t(`goals.src.tab.${tab}`) };
  if (tray(state, def.id) > 0) return { state: 'build', note: t('goals.src.fromTray', x), show };
  if (level < unlock) return { state: 'locked', note: t(`goals.src.${verb}.locked`, { ...x, n: unlock }), show };
  return { state: 'build', note: t(`goals.src.${verb}.price`, { ...x, price: priceWords(state, def.id) }), show };
}

// ---- the producers -------------------------------------------------------------------------------------------------

/** A workshop recipe or a Feed Mill feed that makes the item. */
function crafted(state, r, kind) {
  const b = buildingOf(r.building);
  if (!b || !isLive(b)) return null;
  const level = levelOf(state);
  const ins = kind === 'feed'
    ? r.classes.map(({ cls, qty: n }) => classIn(cls, n))
    : Object.entries(r.inputs).map(([id, n]) => qty(n, id));
  const made = `${ins.join(' + ')} → ${r.out > 1 ? qty(r.out, r.id) : itemLabel(r.id)} · ${durationText(r.ms)}`;
  const text = r.duet ? t('goals.src.duet', { made }) : made;
  const mine = placed(state, b.id);
  const src = { key: `${kind}:${r.id}`, kind, icon: b.id, title: label(b.id, b.name), text };
  if (mine.length) {
    const show = { panel: 'building', args: { id: mine[0], focus: r.id } };
    if (level < r.unlock) return { ...src, state: 'locked', note: t('goals.src.recipeAt', { n: r.unlock }), show };
    return { ...src, state: 'ready', note: mine.length > 1 ? t('goals.src.haveN', { n: mine.length }) : t('goals.src.haveOne', { _a: an(b.name), x: nm(b.id, b.name) }), show };
  }
  const a = acquire(state, b, 'buildings');
  // a building the farm can buy but whose recipe waits for a later level: say both
  if (a.state !== 'locked' && level < r.unlock) a.note = t('goals.src.andRecipe', { note: a.note, n: r.unlock });
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
  const text = t('goals.src.grow.text', { c: c.seed, q: qty(c.yield, c.id), d: durationText(c.growMs) });
  const src = { key: `crop:${c.id}`, kind: 'crop', icon: c.id, title: t('goals.src.grow.title', { x: nm(c.id, c.name, 'crops') }), text,
    show: { panel: 'market', args: { tab: 'seeds', focus: c.id } } };
  if (level < c.unlock) return { ...src, state: 'locked', note: t('goals.src.grow.locked', { n: c.unlock }) };
  const note = ripe && growing ? tn('goals.src.grow.both', growing, { r: ripe })
    : ripe ? tn('goals.src.grow.ripe', ripe) : growing ? tn('goals.src.grow.growing', growing) : t('goals.src.grow.pick');
  return { ...src, state: 'ready', note };
}

/** "Apple Tree", "Pine tree" (the woodlot's name without its note). */
function treeWord(t) {
  const n = t.name.replace(/\s*\(.*\)\s*$/, '');
  return /tree$/i.test(n) ? n : `${n} tree`;
}

/** A tree's harvest (fruit with the Basket, Wood with the Axe). */
function picked(state, tr) {
  const tree = tr;
  const axe = tree.tool === 'axe';
  const trees = { _trees: pluralOf(treeWord(tree), 2), t: nm(tree.id, treeWord(tree), 'trees') };
  const title = axe ? t('goals.src.tree.chop', trees)
    : t('goals.src.tree.pick', { ...trees, _fruit: pluralOf(nameOf(tree.product), 2), f: nm(tree.product, nameOf(tree.product), 'items') });
  const text = t(axe ? 'goals.src.tree.textAxe' : 'goals.src.tree.text', { q: qty(tree.yield, tree.product), d: durationText(tree.cycleMs) });
  const src = { key: `tree:${tree.id}`, kind: 'tree', icon: tree.id, title, text };
  const mine = placed(state, tree.id);
  if (mine.length) {
    return { ...src, state: 'ready', note: t('goals.src.haveN', { n: mine.length }), show: { panel: 'tree', args: { id: mine[0] } } };
  }
  return { ...src, ...acquire(state, tree, 'trees', 'buy', treeWord(tree)) };
}

/** Animals in their home: their product, fed with their feed (bees forage on their own). */
function laid(state, a, premium = false) {
  const home = homeOf(a.homes[0]);
  const hive = a.feed === null && home;
  const who = hive ? { _many: pluralOf(home.name, 2), x: nm(home.id, home.name, 'homes') } : { _many: pluralOf(a.name, 2), x: nm(a.id, a.name, 'animals') };
  const title = t(premium ? 'goals.src.animal.lucky' : 'goals.src.animal.collect', who);
  const bp = GROWTH.prizedAnimal?.premiumBp ?? a.premiumBp ?? 1000;
  const odds = bp > 0 ? Math.max(1, Math.round(10_000 / bp)) : 10;
  const one = hive ? home.name : a.name;
  const every = { q: qty(a.out, a.product), d: durationText(a.cycleMs) };
  const text = premium
    ? t('goals.src.animal.prized', { x: who.x, _one: one.toLowerCase(), c: a.prizedAt, _a: an(nameOf(a.premium)), _p: nameOf(a.premium),
      p: nm(a.premium, nameOf(a.premium), 'items'), n: odds })
    : a.feed === null ? t('goals.src.animal.bees', every)
      : t('goals.src.animal.feed', { ...every, feed: nm(a.feed, nameOf(a.feed), 'items') });
  const src = { key: `${premium ? 'premium' : 'animal'}:${a.id}`, kind: premium ? 'premium' : 'animal',
    icon: a.feed === null && home ? home.id : a.id, title, text };
  const homes = home ? placed(state, home.id) : [];
  const mine = placed(state, a.id);
  if (mine.length && homes.length) {
    const prized = mine.filter((id) => (state.farm.objects[id].cycle ?? 0) >= a.prizedAt).length;
    const note = !premium ? t('goals.src.onFarm', { n: mine.length })
      : prized ? tn('goals.src.animal.prizedN', prized) : t('goals.src.animal.prizedNone');
    return { ...src, state: premium && !prized ? 'info' : 'ready', note, show: { panel: 'animals', args: { id: homes[0] } } };
  }
  // the bees come with their hive (no animal to buy): the hive is what is had
  if (a.feed === null && home) return { ...src, ...acquire(state, home, 'animals') };
  const them = { _x: pluralOf(a.name, 2), x: nm(a.id, a.name, 'animals') };
  if (home && !homes.length && levelOf(state) >= (home.unlock ?? 1)) {
    const h = acquire(state, home, 'animals');
    return { ...src, ...h, note: t('goals.src.thenBuy', { note: h.note, ...them }) };
  }
  const level = levelOf(state);
  const show = { panel: 'market', args: { tab: 'animals', focus: a.id } };
  if (level < a.unlock) return { ...src, state: 'locked', note: t('goals.src.buyAnimals.locked', { ...them, n: a.unlock }), show };
  return { ...src, state: 'build', note: t('goals.src.buyAnimals', them), show };
}

/** A building that fills on its own (the Compost Bin: points from animal collections). */
function collected(state, b) {
  const c = b.collector;
  const src = { key: `collector:${b.id}`, kind: 'collector', icon: b.id, title: label(b.id, b.name),
    text: t('goals.src.collector', { q: qty(c.out, c.item), n: c.every }) };
  const mine = placed(state, b.id);
  if (mine.length) {
    return { ...src, state: 'ready', note: t('goals.src.haveOne', { _a: an(b.name), x: nm(b.id, b.name) }), show: { panel: 'building', args: { id: mine[0] } } };
  }
  return { ...src, ...acquire(state, b, 'buildings') };
}

/** Debris that pays the item when cleared (Wood from stumps and fallen logs). */
function debrisSource(state, item) {
  if (item !== 'wood') return null;
  const kinds = live('debris').filter((d) => d.wood > 0);
  if (!kinds.length) return null;
  const woods = kinds.map((d) => d.wood);
  const lo = Math.min(...woods);
  const hi = Math.max(...woods);
  const names = kinds.map((d) => (nameEntry(d.id) ? cname(d.id, { form: 'pl' }) : pluralOf(d.name, 2).toLowerCase()));
  let left = 0;
  if (state) for (const d of kinds) left += placedOf(state, d.id).length;
  const all = names.length > 1 ? t('goals.src.and', { list: names.slice(0, -1).join(', '), last: names.at(-1) }) : names[0];
  return {
    key: 'debris:wood', kind: 'debris', icon: kinds[0].id, title: t('goals.src.debris.title', { list: all }),
    text: lo === hi ? tn('goals.src.debris.text', lo) : t('goals.src.debris.range', { lo, hi }),
    state: 'info', note: left ? t('goals.src.debris.left', { n: left }) : t('goals.src.debris.none'), show: null,
  };
}

/** The General Store's emergency feed (2.5 x its value, Market → Tools). */
function storeSource(state, it) {
  if (!(it.storePrice > 0)) return null;
  const f = CONTENT.feeds.get(it.id);
  const n = f?.out ?? 1;
  const show = { panel: 'market', args: { tab: 'tools', focus: it.id } };
  const src = { key: `store:${it.id}`, kind: 'store', icon: 'market_stand', title: t('goals.src.store.title'),
    text: t('goals.src.store.text', { q: qty(n, it.id), n: it.storePrice * n }), show };
  if (levelOf(state) < (it.unlock ?? 1)) return { ...src, state: 'locked', note: t('goals.src.store.locked', { n: it.unlock }) };
  return { ...src, state: 'ready', note: t('goals.src.store.where') };
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
  const out = { id: itemId, name: itemLabel(itemId), have, need: n, short: n === null ? 0 : Math.max(0, n - have),
    sources: itemSources(itemId, state, { now }) };
  if (cls) {
    const ids = classMembers(cls);
    if (ids.length) {
      out.cls = { cls, words: CLASS_WORDS[cls] ?? t('goals.src.cls.any', { cls }),
        members: ids.map((id) => ({ id, name: itemLabel(id), have: state ? own(state.farm.inventory, id) + own(state.farm.overflow, id) : 0 })) };
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
    if (m.have <= 0) { none.push(itemLabel(m.item)); continue; }
    if (!skip && use <= 0) continue;
    let fix = null;
    if (skip?.why === 'noFeed') fix = SKIP_FIX.noFeed;
    else if (skip?.why === 'kept' && short) fix = SKIP_FIX.kept;
    else if (skip?.why === 'valuable' && skips?.confirmable) fix = { kind: 'ask', label: t('goals.src.askFirst') };
    const nmItem = itemLabel(m.item);
    rows.push({ id: m.item, name: nmItem, n: m.have, use, why: skip?.why ?? null, keep: m.keep,
      text: skip ? skipText(skip) : use < m.have ? t('goals.src.row.usable', { x: nmItem, n: m.have, use }) : t('goals.src.row', { x: nmItem, n: m.have }), fix });
  }
  return { usable: x.have, rows, none, blocked: Boolean(skips?.blocked) };
}

/** The status line of a hint's header: "0 / 2 in the barn · need 2 more" | "14 in the barn" | "0 / 3 grain usable for feed". */
export function haveLine(m) {
  if (!m) return '';
  // a Feed Mill class chip counts the class, not the pictured member: "0 / 3 grain usable for feed"
  const k = m.usable ? 'usable' : 'barn';
  const p = { have: m.have, need: m.need, short: m.short, what: m.usable || '' };
  if (m.need === null) return t(`goals.src.have.${k}`, p);
  return t(m.short > 0 ? `goals.src.have.${k}.short` : `goals.src.have.${k}.enough`, p);
}
