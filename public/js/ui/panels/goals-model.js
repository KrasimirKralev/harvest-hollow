// View models of the Journal (ui-panels lane): story letters, ribbons, mastery, "Together we..." stats, the
// treasury ledger, the activity feed and the week (Daily Gift, Farm Weeks, Almanac, Together task, Couple
// Challenge). PURE (state, pid, now) -> plain data; every count comes from the rules' own helpers or the state.
import {
  live, itemOf, defOf, cropOf, recipeOf, npcOf, questOf, ribbonOf, levelFromXp, personalLevelFromXp, titleFor,
  masteryStars, RIBBON_REWARDS, RIBBON_WALL, DAILY_GIFT, FARM_WEEKS, ALMANAC, COUPLE_CHALLENGE, MASTERY,
  STORY_BEATS, isLive, relicOf,
} from '../../../../shared/content/index.js';
import * as questsA from '../../../../shared/rules/actions/quests.js';
import * as ribbonsA from '../../../../shared/rules/actions/ribbons.js';
import * as dailyR from '../../../../shared/rules/daily.js';
import * as feedR from '../../../../shared/rules/feed.js';
import { m1bFeedText, foldGiants, feedLine, feedText as feedRowText } from '../feed.js';
import * as coopR from '../../../../shared/rules/coop.js';
import * as ordersA from '../../../../shared/rules/actions/orders.js';
import { CONTENT, ORDERS, furnitureOf } from '../../../../shared/content/index.js';
import { LEDGER_MAX } from '../../../../shared/content/config.js';
import { taskMsg } from '../../../../shared/rules/goal-text.js';
import { goalText, prep } from '../goal-text.js';
import { t, tn, has, live as liveKeys, fmtNum, ctext, N, Q, nameEntry } from '../../i18n/index.js';

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : 0);
const fmt = (n) => fmtNum(n);
/** Ledger reasons in neutral words (GDD §6.3: "who, why and when, neutral wording"), in the language in effect. */
const LEDGER_KEYS = ['sell', 'order', 'quest', 'level', 'ribbon', 'gift', 'meter', 'almanac', 'challenge', 'together', 'combo',
  'debris', 'seed', 'uproot', 'undo', 'buy', 'land', 'slot', 'upgrade', 'tool', 'store', 'restore', 'barn', 'hurry', 'golden_seeds',
  'cancel', 'mastery', 'crate', 'barge', 'fair', 'townsfolk', 'track', 'weeds', 'petBreed', 'legacy', 'album'];
export const LEDGER_REASONS = liveKeys(Object.fromEntries(LEDGER_KEYS.map((k) => [k, `goals.ledger.${k}`])));
/** A content name for a line: the Bulgarian ref when the names table has one, else the English the code holds. */
const nm = (id, en, family) => (nameEntry(id, family) ? N(id, family) : en);
/** The same as text (a label, a pill). */
const nmText = (id, en, family) => (nameEntry(id, family) ? t('goals.tr.name', { x: N(id, family) }) : en);
/** An item quantity for a Bulgarian line ({q}); English lines say `counted()` through '_what'. */
const qRef = (id, n) => (itemOf(id) ? Q(id, n, 'items') : Q(id, n));

const UNCOUNTED = new Set(['wheat', 'corn', 'flour', 'wool', 'milk', 'butter', 'cream', 'sugar', 'cornmeal', 'cheese',
  'yogurt', 'popcorn', 'compost', 'wood', 'sugarcane', 'ketchup', 'coleslaw', 'sauerkraut', 'yarn', 'planks', 'oats',
  'chicken_feed', 'livestock_feed', 'apple_juice', 'carrot_juice', 'strawberry_jam', 'cherry_jam', 'veggie_soup',
  'pumpkin_soup', 'potato_gratin', 'bread', 'corn_bread', 'cookies', 'pancakes', 'roasted_seeds', 'sweetheart_cake']);

/** "6 Wheat", "3 Eggs", "2 Wooden Crates", "4 Strawberries". */
export function counted(n, id) {
  const nm = nameOf(id);
  if (n === 1 || UNCOUNTED.has(id) || /s$/i.test(nm)) return `${fmt(n)} ${nm}`;
  if (/[^aeiou]y$/i.test(nm)) return `${fmt(n)} ${nm.slice(0, -1)}ies`;
  if (/(ch|sh|x|potato|tomato)$/i.test(nm)) return `${fmt(n)} ${nm}es`;
  return `${fmt(n)} ${nm}s`;
}

const nameOf = (id) => itemOf(id)?.name ?? defOf(id)?.name ?? cropOf(id)?.name ?? recipeOf(id)?.name ?? String(id).replace(/_/g, ' ');

// ---- Mabel's board (GDD §5.2) ------------------------------------------------------------------------------------

/** Slots of the board in order: [{ i, availableAt, order, pin, flag }]. */
export function boardSlots(state) {
  const slots = state.farm.orders?.slots ?? {};
  return Object.keys(slots).map(Number).sort((a, b) => a - b).map((i) => ({ i, ...slots[String(i)] }));
}

/** Units of an item in the Barn plus overflow. */
export const have = (state, item) => own(state.farm.inventory, item) + own(state.farm.overflow, item);

/** Items an order still needs beyond the Barn: [{ item, n }] (the rules' own helper when it exists). */
export function shortfall(state, order) {
  if (typeof ordersA.orderShortfall === 'function') return Object.entries(ordersA.orderShortfall(state, order)).map(([item, n]) => ({ item, n }));
  return Object.entries(order.items).map(([item, q]) => ({ item, n: q - have(state, item) })).filter((x) => x.n > 0);
}

/** Acorns an instant refill costs now (0 = the farm's free one today). */
export function rushPrice(state, now) {
  if (typeof ordersA.rushPrice === 'function') return ordersA.rushPrice(state, now);
  return ORDERS.refillAcorns;
}

// ---- story letters (GDD §5.3) -------------------------------------------------------------------------------------

/** One quest task as a line: "Harvest 6 Wheat", with its progress (the rules' words, in the language in effect). */
export function taskLine(task) {
  // the rules word every task to L25 (Barge rows, Fair medals, bee forage, duets, ...) with content's plurals
  return goalText(taskMsg(task));
}

/** Progress of task i of an active quest: { have, need, done } (fill counts quarter orders: shown in orders). */
export function taskState(state, qid, i, now) {
  const q = questOf(qid);
  const t = q.tasks[i];
  if (typeof questsA.taskProgress === 'function') {
    const p = questsA.taskProgress(state, qid, i, now);
    if (t.verb === 'fill') return { have: Math.floor(p.have / 4), need: t.qty, done: p.done, quarter: p.have % 4 };
    return p;
  }
  const have = state.farm.quests?.active?.[qid]?.n?.[String(i)] ?? 0;
  return { have: Math.min(have, t.qty), need: t.qty, done: have >= t.qty };
}

/** The Journal tab a quest is listed on: 'story' (chains A-E), 'week' (F, G) or 'together' (H). */
export const questTab = (def) => (def && typeof questsA.tabOf === 'function' ? questsA.tabOf(def) : 'story');

/**
 * The active story cards (up to 3) with letter, giver, tasks and rewards; and the finished ones, newest first.
 * `tab` keeps the active cards of one Journal tab (default Letters: chains A-E; 'week': F, G; 'together': H).
 */
export function storyView(state, now, { tab = 'story' } = {}) {
  const q = state.farm.quests ?? { active: {}, done: {} };
  const card = (id, done) => {
    const def = questOf(id);
    if (!def) return null;
    const tasks = def.tasks.map((t, i) => ({ ...t, line: taskLine(t), ...(done ? { have: t.qty, need: t.qty, done: true } : taskState(state, id, i, now)) }));
    const deliver = def.tasks.some((t) => t.verb === 'deliver');
    return {
      id, chain: def.chain, title: ctext('quests', id, 'title', def.title), level: def.level, giver: npcOf(def.giver) ?? null,
      letter: letterOf(id, def.letter), doneText: ctext('quests', id, 'done', def.done ?? ''), coins: def.coins, xp: def.xp,
      rewards: def.rewards ?? {}, extraText: def.extraText ? ctext('quests', id, 'extraText', def.extraText) : def.extraText,
      tasks, deliver, ready: !done && tasks.every((t) => t.done), at: done ? q.done[id] : q.active[id]?.at ?? 0, finished: done,
    };
  };
  const active = Object.keys(q.active).filter((id) => questTab(questOf(id)) === tab).map((id) => card(id, false))
    .filter(Boolean)
    .sort((a, b) => a.level - b.level || a.chain.localeCompare(b.chain));
  const done = Object.keys(q.done).map((id) => card(id, true)).filter(Boolean).sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  const level = levelFromXp(state.farm.xp);
  const doneSet = new Set(Object.keys(q.done));
  const activeSet = new Set(Object.keys(q.active));
  const nextUp = live('quests').filter((x) => !doneSet.has(x.id) && !activeSet.has(x.id) && x.chain >= 'A' && x.chain <= 'E')
    // A5 waits for A3 too (RC-01: `alsoAfter`)
    .filter((x) => (!x.after || doneSet.has(x.after)) && (x.alsoAfter ?? []).every((id) => doneSet.has(id)))
    .sort((a, b) => a.level - b.level)[0] ?? null;
  // story beats of finished chapters (GDD §5.3: illustrated letter cards in M1, replayable from the Journal)
  const beats = done.filter((q) => q.rewards && q.rewards.beat).map((q) => {
    const b = STORY_BEATS.find((x) => x.id === q.rewards.beat && isLive(x));
    return b ? { id: b.id, title: ctext('STORY_BEATS', b.id, 'title', b.title), text: ctext('STORY_BEATS', b.id, 'text', b.text), art: b.art,
      from: npcOf(b.from) ?? null, after: q.id, at: q.at } : null;
  }).filter(Boolean);
  return { active, done, beats,
    nextUp: nextUp && nextUp.level > level ? { title: ctext('quests', nextUp.id, 'title', nextUp.title), level: nextUp.level,
      giver: npcOf(nextUp.giver) } : null };
}

/** A quest's letter (greeting, paragraphs, signoff, art) in the language in effect, or null. */
function letterOf(id, L) {
  if (!L) return null;
  return { ...L, greeting: ctext('quests', id, 'letter.greeting', L.greeting), signoff: ctext('quests', id, 'letter.signoff', L.signoff),
    body: ctext('quests', id, 'letter.body', L.body ?? []) };
}

/** True when `pid` has already read the story beat `id` (per-player seen flags, GDD §6.1). */
export const beatSeen = (state, pid, id) => Boolean(state.players[pid]?.seen?.beats?.[id]);

/** Extra rewards of a quest as short phrases ("5 Acorns", "2 Hearts each", "Jam-jar shelf decor"). */
export function rewardPhrases(r) {
  const out = [];
  if (r.acorns) out.push(tn('goals.j.reward.acorns', r.acorns));
  if (r.hearts) out.push(tn('goals.j.reward.hearts', r.hearts));
  for (const [it, n] of Object.entries(r.items ?? {})) out.push(t('goals.j.reward.item', { n, _name: nameOf(it), q: qRef(it, n) }));
  for (const d of r.decor ?? []) out.push(nmText(d, nameOf(d)));
  for (const [sp, n] of Object.entries(r.animalsAtStart ?? {})) out.push(t('goals.j.reward.animals', { n, _name: nameOf(sp), q: Q(sp, n, 'animals') }));
  for (const d of [...(r.giftAtStart ?? []), ...(r.gift ?? [])]) out.push(t('goals.j.reward.free', { d: nm(d, nameOf(d)) }));
  for (const f of r.furniture ?? []) out.push(t('goals.j.reward.furniture', { f: nm(f, furnitureOf(f)?.name ?? f, 'furniture') }));
  if (r.name) out.push(t('goals.j.reward.name', { x: nm(r.name, nameOf(r.name)) }));
  if (r.beat) out.push(t('goals.j.reward.beat'));
  return out;
}

// ---- ribbons (GDD §5.4) ---------------------------------------------------------------------------------------------

/** A ribbon's scope word: Farm / Yours / Together. */
const scopeLabel = (scope) => (['F', 'P', 'T'].includes(scope) ? t(`goals.j.scope.${scope}`) : scope);
/** A ribbon's text fields in the language in effect. */
const ribbonText = (r, field) => ctext('ribbons', r.id, field, r[field]);
/** A personal title (the English one the rules use) in the language in effect (content CONTENT.titles by level). */
export function titleWord(en) {
  const row = (CONTENT.titles || []).find((x) => x.title === en);
  return row ? ctext('titles', String(row.level), 'title', en) : en;
}

/** Every live ribbon for `pid`: tier held, counter, next threshold; hidden ones only once earned. */
export function ribbonsView(state, pid) {
  const rows = [];
  for (const r of live('ribbons')) {
    const book = r.scope === 'P' ? state.players[pid]?.ribbons ?? {} : state.farm.ribbons ?? {};
    const tier = book[r.id]?.t ?? 0;
    if (r.hidden && tier === 0) { rows.push({ id: r.id, hidden: true, scope: r.scope, n: r.n }); continue; }
    const value = typeof ribbonsA.ribbonValue === 'function' ? ribbonsA.ribbonValue(state, r, pid) : own(r.scope === 'P' ? state.players[pid]?.stats : state.farm.stats, r.stat);
    const next = tier < r.tiers.length ? r.tiers[tier] : null;
    const prev = tier > 0 ? r.tiers[tier - 1] : 0;
    const shown = r.scale ? value : value;
    const together = r.scope === 'T' ? Object.keys(state.players).sort().map((p) => ({ pid: p, n: own(state.players[p].stats, r.stat) })) : null;
    rows.push({ id: r.id, n: r.n, name: ribbonText(r, 'name'), text: ribbonText(r, 'text'), scope: r.scope, scopeLabel: scopeLabel(r.scope),
      tier, tiers: r.tiers, value: shown, next, prev, pct: next ? Math.max(0, Math.min(1, (shown - prev) / Math.max(1, next - prev))) : 1,
      title: ribbonText(r, 'title'),
      hidden: false, secret: Boolean(r.hidden), together,
      reward: next ? (r.hidden ? RIBBON_REWARDS.hidden : (r.scope === 'P' ? RIBBON_REWARDS.P : RIBBON_REWARDS.F)[tier]) : null });
  }
  return rows.sort((a, b) => a.n - b.n);
}

/** Ribbon Points and the Ribbon Wall tiers they open (GDD §5.4). */
export function ribbonWall(state) {
  const points = typeof ribbonsA.ribbonPoints === 'function' ? ribbonsA.ribbonPoints(state) : 0;
  return { points, tiers: RIBBON_WALL.map((t) => ({ ...t, open: points >= t.points })), next: RIBBON_WALL.find((t) => points < t.points) ?? null };
}

/** Titles `pid` may wear (Gold ribbons) and the one worn; the level title is the default. */
export function titlesView(state, pid) {
  const p = state.players[pid];
  const list = typeof ribbonsA.titlesOf === 'function' ? ribbonsA.titlesOf(state, pid) : [];
  const levelTitle = titleFor(personalLevelFromXp(p?.xp ?? 0));
  return { levelTitle: titleWord(levelTitle), worn: p?.title ?? null,
    options: list.map((id) => ({ id, title: ribbonOf(id) ? ribbonText(ribbonOf(id), 'title') : id })) };
}

// ---- mastery book (GDD §4.8) ---------------------------------------------------------------------------------------

/** Mastery of every unlocked crop, tree species, animal species and recipe: stars and the way to the next. */
export function masteryBook(state) {
  const level = levelFromXp(state.farm.xp);
  const fam = (family, list, unit) => list.filter((d) => isLive(d) && Array.isArray(d.mastery) && (d.unlock ?? 1) <= level).map((d) => {
    const count = own(state.farm.mastery, d.id);
    const stars = level < MASTERY.unlock ? 0 : masteryStars(d, count, level);
    const next = stars < 3 ? d.mastery[stars] : null;
    const prev = stars > 0 ? d.mastery[Math.min(stars, 3) - 1] : 0;
    return { id: d.id, name: nmText(d.id, d.name, family === 'recipes' ? 'items' : family), count, stars, next, prev, unit,
      pct: next ? Math.min(1, (count - prev) / Math.max(1, next - prev)) : 1 };
  });
  return {
    open: level >= MASTERY.unlock, unlock: MASTERY.unlock,
    families: [
      { id: 'crops', label: t('goals.j.mastery.crops'), rows: fam('crops', live('crops'), 'harvests') },
      { id: 'trees', label: t('goals.j.mastery.trees'), rows: fam('trees', live('trees'), 'harvests') },
      { id: 'animals', label: t('goals.j.mastery.animals'), rows: fam('animals', live('animals'), 'collections') },
      { id: 'recipes', label: t('goals.j.mastery.recipes'), rows: fam('recipes', live('recipes'), 'crafts') },
    ],
  };
}

// ---- "Together we..." (GDD §6.3: no leaderboard; the split lives here, framed as together) ----------------------

const sumPrefix = (stats, prefix) => Object.keys(stats || {}).filter((k) => k.startsWith(prefix)).reduce((s, k) => s + stats[k], 0);

export function statsView(state) {
  const f = state.farm.stats;
  const pids = Object.keys(state.players).sort();
  const split = (fn) => pids.map((pid) => ({ pid, n: fn(state.players[pid].stats || {}) }));
  const rows = [
    { id: 'crops', label: t('goals.j.stat.crops'), icon: 'wheat', n: own(f, 'cropsHarvested'), by: split((s) => sumPrefix(s, 'harvest.')) },
    { id: 'plantings', label: t('goals.j.stat.plantings'), icon: 'plot', n: sumPrefix(f, 'plant.'), by: split((s) => own(s, 'plantings')) },
    { id: 'goods', label: t('goals.j.stat.goods'), icon: 'bread', n: own(f, 'goodsCrafted') },
    { id: 'animals', label: t('goals.j.stat.animals'), icon: 'egg', n: own(f, 'animalsCollected') },
    { id: 'fruit', label: t('goals.j.stat.fruit'), icon: 'apple', n: own(f, 'treesHarvested') },
    { id: 'orders', label: t('goals.j.stat.orders'), icon: 'order_board', n: Math.floor(own(f, 'ordersQ') / 4), by: split((s) => own(s, 'ordersFilled')) },
    { id: 'coins', label: t('goals.j.stat.coins'), icon: 'coins', n: own(f, 'coins.earned') },
    { id: 'debris', label: t('goals.j.stat.debris'), icon: 'rock', n: own(f, 'debrisCleared'), by: split((s) => own(s, 'debrisCleared')) },
    { id: 'duets', label: t('goals.j.stat.duets'), icon: 'hearts', n: own(f, 'duets') },
  ];
  const players = pids.map((pid) => {
    const p = state.players[pid];
    const lvl = personalLevelFromXp(p.xp);
    const worn = p.title ? ribbonOf(p.title) : null;
    return { pid, name: p.name, color: p.color, xp: p.xp, level: lvl, title: worn ? ribbonText(worn, 'title') : titleWord(titleFor(lvl)), hearts: p.hearts };
  });
  return { rows, players, level: levelFromXp(state.farm.xp), xp: state.farm.xp };
}

// ---- the treasury ledger (GDD §6.3) ---------------------------------------------------------------------------------

const anAnimal = (id) => defOf(id)?.layer === 'none';
/**
 * "kind:id" reasons name the thing ({x}); the family says where its name lives (null: a placeable, an item, a crop).
 * A restoration project shares its id with its landmark ("greenhouse"): `restore:` names the project first.
 */
const REF_FAMILY = { sell: null, undo: null, buy: null, upgrade: null, slot: null, masterwork: null, restore: null,
  land: 'expansions', tool: 'tools', store: 'items', town: 'townProjects', furnish: 'furniture', relic: null };

/** The thing a "kind:id" reason names, as a sentence ref: [catalog key, name ref]. */
function refLine(k, ref) {
  if (k === 'restore' && CONTENT.restoration.has(ref)) {
    return ['goals.ledger.ref.restoreProject', nm(ref, CONTENT.restoration.get(ref).name, 'restoration')];
  }
  if (k === 'relic') return ['goals.ledger.ref.relic', nm(ref, relicOf(ref)?.name ?? nameOf(ref))];
  const fam = REF_FAMILY[k];
  const en = (fam && CONTENT[fam]?.get(ref)?.name) || nameOf(ref);
  const animal = (k === 'sell' || k === 'buy') && anAnimal(ref);
  return [`goals.ledger.ref.${k}${animal ? '.animal' : ''}`, nm(ref, en, fam ?? undefined)];
}

/**
 * A friendly, neutral sentence for a ledger reason ("sell", "buy:bakery", "order", "slot:mill", "town:bandstand" ...).
 * Every reason the rules write has its words (test/i18n.leftovers.test.js walks them in shared/rules); an unknown one
 * (an old save's) reads as a neutral "Coins moved", never as its id.
 */
export function ledgerText(reason) {
  if (reason === 'wish:in') return t('goals.ledger.wishIn');
  if (reason === 'wish:out') return t('goals.ledger.wishOut');
  const [k, ref] = String(reason).split(':');
  if (ref === 'surplus' && (k === 'sell' || k === 'undo')) return t(`goals.ledger.${k}Surplus`);
  if (ref && Object.hasOwn(REF_FAMILY, k)) {
    const [key, x] = refLine(k, ref);
    return prep(t(key, { x }));
  }
  return LEDGER_KEYS.includes(k) ? LEDGER_REASONS[k] : t('goals.ledger.other');
}

/** Ledger rows, newest first: { n, at, by, coins, text }; and this week's totals per direction. */
export function ledgerView(state, limit = 120, { mergeMs = 120_000 } = {}) {
  const L = state.farm.ledger;
  const rows = [];
  for (let i = L.n - 1; i >= 0 && i >= L.n - LEDGER_MAX && rows.length < limit; i--) {
    const r = L.rows[String(i % LEDGER_MAX)];
    if (!r) continue;
    // one line per stroke: the same person, the same reason and direction within a couple of minutes ("Seeds ×16")
    const prev = rows.at(-1);
    if (prev && prev.by === r.by && prev.reason === r.reason && Math.sign(prev.coins) === Math.sign(r.n) && Math.abs(prev.first - r.at) <= mergeMs) {
      prev.coins += r.n;
      prev.count += 1;
      prev.first = r.at;
      continue;
    }
    rows.push({ i, at: r.at, first: r.at, by: r.by, coins: r.n, count: 1, text: ledgerText(r.reason), reason: r.reason });
  }
  return rows;
}

// ---- the activity feed (GDD §6.4) -----------------------------------------------------------------------------------

/** Feed rows newest first: [{ i, row }] (i = the absolute row number the `thank` action takes). */
export function feedView(state, limit = 60) {
  const list = typeof feedR.feedRows === 'function' ? feedR.feedRows(state, limit) : [];
  // a Giant's nine plots are said once, on its own line (QA2 UI-13)
  return foldGiants(list, ([, r]) => r, ([i], r) => [i, r]).map(([i, row]) => ({ i, row }));
}

/** "a" / "an" before an English name (English-only grammar). */
const an = (en) => (/^[aeiou]/i.test(String(en)) ? 'an' : 'a');
/** A wish's thing as a ref ({w}), or null. */
const wishRef = (def) => (def ? nm(def, nameOf(def)) : null);

/** One feed row as a sentence (actor name added by the panel): the Journal's own, longer words. */
export function feedText(row) {
  const L = (key, params) => feedLine(key, params).text;
  const what = (n, id) => ({ _what: counted(n, id), q: qRef(id, n) });
  switch (row.k) {
    case 'harvest': return row.p > 1 ? L('feed.j.harvest.from', { ...what(row.q, row.item), p: row.p, n: row.p }) : L('feed.j.harvest', what(row.q, row.item));
    case 'tree': return L('feed.j.tree', what(row.q, row.item));
    case 'collect': return L('feed.j.collect', what(row.q, row.item));
    case 'tend': return L('feed.j.tend', { n: row.q });
    case 'craft': return L('feed.j.craft', what(row.q, row.item));
    case 'sell': return L('feed.j.sell', { ...what(row.q, row.item), n: row.c });
    case 'order': return L(row.g ? 'feed.j.order.golden' : 'feed.j.order', { n: row.c });
    case 'level': return L('feed.j.level', { level: row.level });
    case 'buy': {
      if (row.what === 'slot') return L(row.c ? 'feed.buy.slotFor' : 'feed.buy.slot', { b: nm(row.def, nameOf(row.def)), ...(row.c ? { n: row.c } : {}) });
      if (row.what === 'hurry') {
        const many = row.q > 1;
        const key = row.def === 'plot' ? (many ? 'feed.hurry.crops' : 'feed.hurry.crop') : many ? 'feed.hurry.batches' : 'feed.hurry.batch';
        return L(key, { n: row.acorns ?? row.a ?? 0, ...(many ? { k: row.q } : {}) });
      }
      const en = nameOf(row.def);
      const key = `feed.j.buy${row.c && row.a ? '.ca' : row.c ? '.c' : row.a ? '.a' : ''}`;
      return L(key, { _a: an(en), b: nm(row.def, en), ...(row.c ? { c: row.c } : {}), ...(row.a ? { n: row.a } : {}) });
    }
    case 'expand': return L('feed.j.expand', { land: nm(row.def, nameOf(row.def), 'expansions') });
    case 'ribbon': {
      const rb = ribbonOf(row.id);
      return L(`feed.j.ribbon.${[1, 2, 3].includes(row.t) ? row.t : 'x'}`, { r: rb ? ribbonText(rb, 'name') : row.id });
    }
    case 'quest': {
      const qd = questOf(row.id);
      return L('feed.j.quest', { title: qd ? ctext('quests', row.id, 'title', qd.title) : row.id });
    }
    case 'keepsake': return L('feed.j.keepsake', { item: nm(row.item, nameOf(row.item), 'items') });
    case 'note': return L('feed.j.note');
    case 'golden': return L('feed.j.golden');
    case 'hf': return L('feed.j.hf');
    case 'gift': return L('feed.j.gift', { day: row.day });
    case 'chest': return L(['meter', 'almanac', 'challenge', 'together'].includes(row.what) ? `feed.j.chest.${row.what}` : 'feed.j.chest');
    case 'name': return L(row.what === 'farm' ? 'feed.j.name.farm' : 'feed.j.name.animal', { text: row.text });
    case 'wish': {
      const w = wishRef(row.def);
      const p = w ? { w } : {};
      const any = w ? '' : '.any';
      if (row.what === 'bought') return L(`feed.j.wish.bought${any}${row.c ? '.c' : ''}`, { ...p, ...(row.c ? { n: row.c } : {}) });
      if (row.what === 'withdraw') return L(`feed.j.wish.withdraw${any}`, { ...p, n: row.c ?? 0 });
      if (row.what === 'asked') return L(`feed.j.wish.asked${any}`, p);
      if (row.what === 'denied') return L(`feed.j.wish.denied${any}`, p);
      if (row.what === 'deposit' || row.c) return L(`feed.j.wish.deposit${any}`, { ...p, n: row.c ?? 0 });
      return L(w ? 'feed.j.wish.made' : 'feed.j.wish.made.any', p);
    }
    case 'keep': return row.q > 0 ? L('feed.j.keep', what(row.q, row.item)) : L('feed.j.unkeep', { item: nm(row.item, nameOf(row.item), 'items') });
    // the rows only the feed words (balloon crates, treasures, upgrades...): the feed's own sentence, never the bare kind
    default: return m1bFeedText(row)?.text ?? feedRowText(row).text;
  }
}

// ---- this week (GDD §5.8) --------------------------------------------------------------------------------------------

/** Daily Gift: the 28-day calendar, today's claimable day and its reward. */
export function giftView(state, now) {
  const d = state.farm.daily;
  if (!d || !d.gift) return null;
  const level = levelFromXp(state.farm.xp);
  const today = typeof coopR.dayOf === 'function' ? coopR.dayOf(state, now) : 0;
  const claimed = d.gift.last === today;
  const next = (d.gift.n % DAILY_GIFT.days.length) + 1;
  const reward = typeof dailyR.giftReward === 'function' ? dailyR.giftReward(state, now) : null;
  // claimed today: yesterday's stamp is today's, and the next day glows only tomorrow
  const days = DAILY_GIFT.days.map((row) => ({ day: row.day, done: row.day < next, today: !claimed && row.day === next,
    acorns: row.acorns ?? 0, decor: Boolean(row.decor), compost: Boolean(row.items), packet: Boolean(row.seedPacket) }));
  return { unlock: DAILY_GIFT.unlock, open: level >= DAILY_GIFT.unlock, claimed, next, reward, days, cycle: Math.floor(d.gift.n / DAILY_GIFT.days.length) };
}

/** Farm Weeks streak (weeks with play on >= 2 days, GDD §5.8). */
export function weeksView(state) {
  const w = state.farm.daily?.weeks;
  if (!w) return null;
  return { ...w, minDays: FARM_WEEKS.minDays, milestones: FARM_WEEKS.milestones, unlock: FARM_WEEKS.unlock,
    next: FARM_WEEKS.milestones.find((m) => m > w.streak) ?? null };
}

const ALMANAC_VERBS = ['harvest', 'plant', 'water', 'collect', 'pet', 'make', 'fill', 'clear', 'enter'];
/** A task line of the Almanac: "Harvest 12 Wheat" etc. */
export function almanacLine(task) {
  const n = task.qty;
  if (!ALMANAC_VERBS.includes(task.verb)) {
    return t('goals.j.alm.any', { verb: task.verb, _what: counted(n, task.ref), q: qRef(task.ref, n) });
  }
  const kind = task.ref === '*' ? 'crops' : ['animal', 'order', 'debris', 'fair'].includes(task.ref) ? task.ref : 'item';
  const key = `goals.j.alm.${task.verb}.${kind}`;
  if (!has(key)) return t('goals.j.alm.any', { verb: task.verb, _what: counted(n, task.ref), q: qRef(task.ref, n) });
  if (kind === 'item') return t(key, { n, _what: counted(n, task.ref), q: qRef(task.ref, n), item: nm(task.ref, nameOf(task.ref)) });
  return t(key, { n });
}

/** This player's Almanac: 4 tasks with progress, paid count, reroll, chest; plus the shared Together task. */
export function almanacView(state, pid) {
  const level = levelFromXp(state.farm.xp);
  const a = state.players[pid]?.almanac;
  const t = state.farm.daily?.together ?? null;
  const tpl = t ? ALMANAC.together.templates.find((x) => x.id === t.tpl) : null;
  return {
    open: level >= ALMANAC.unlock, unlock: ALMANAC.unlock,
    // one task counts at a time (QA2 RC-12): `live` marks it, the others wait their turn
    tasks: a && a.tasks ? Object.keys(a.tasks).sort().map((slot) => ({ slot: Number(slot), ...a.tasks[slot], line: almanacLine(a.tasks[slot]),
      live: slot === dailyR.almanacLiveSlot(a) })) : [],
    paid: a?.paid ?? 0, paidMax: ALMANAC.paidPerDay, rerolls: a?.rerolls ?? 0, freeRerolls: ALMANAC.freeRerollsPerDay, chest: Boolean(a?.chest), done: a?.done ?? 0,
    together: t && tpl ? { text: ctext('ALMANAC', `together.${tpl.id}`, 'text', tpl.text).replace('{n}', fmt(tpl.verb === 'fill' ? t.qty / 4 : t.qty)),
      n: tpl.verb === 'fill' ? Math.floor(t.n / 4) : t.n,
      qty: tpl.verb === 'fill' ? t.qty / 4 : t.qty, by: t.by, done: t.done, hearts: ALMANAC.together.hearts } : null,
  };
}

/** The Couple Challenge of the week (GDD §5.8). */
export function challengeView(state) {
  const c = state.farm.challenge;
  const level = levelFromXp(state.farm.xp);
  if (!c || !c.cur) return { open: level >= COUPLE_CHALLENGE.unlock, unlock: COUPLE_CHALLENGE.unlock, cur: null, done: c?.done ?? 0 };
  const tpl = COUPLE_CHALLENGE.templates.find((x) => x.id === c.cur.tpl);
  const text = tpl ? ctext('COUPLE_CHALLENGE', tpl.id, 'text', tpl.text).replace('{coins}', tn('goals.j.challenge.coins', c.cur.target))
    .replace('{n}', fmt(c.cur.target)) : c.cur.tpl;
  return { open: true, unlock: COUPLE_CHALLENGE.unlock, done: c.done, reward: COUPLE_CHALLENGE.reward,
    cur: { text, n: c.cur.n, target: c.cur.target, by: c.cur.by, finished: c.cur.done, pct: Math.min(1, c.cur.n / Math.max(1, c.cur.target)) } };
}

