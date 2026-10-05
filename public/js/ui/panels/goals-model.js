// View models of the Journal (ui-panels lane): story letters, ribbons, mastery, "Together we..." stats, the
// treasury ledger, the activity feed and the week (Daily Gift, Farm Weeks, Almanac, Together task, Couple
// Challenge). PURE (state, pid, now) -> plain data; every count comes from the rules' own helpers or the state.
import {
  live, itemOf, defOf, cropOf, recipeOf, npcOf, questOf, ribbonOf, levelFromXp, personalLevelFromXp, titleFor,
  masteryStars, QUEST_VERBS, RIBBON_REWARDS, RIBBON_WALL, DAILY_GIFT, FARM_WEEKS, ALMANAC, COUPLE_CHALLENGE, MASTERY,
  STORY_BEATS, isLive,
} from '../../../../shared/content/index.js';
import * as questsA from '../../../../shared/rules/actions/quests.js';
import * as ribbonsA from '../../../../shared/rules/actions/ribbons.js';
import * as dailyR from '../../../../shared/rules/daily.js';
import * as feedR from '../../../../shared/rules/feed.js';
import * as goalsR from '../../../../shared/rules/goals.js';
import { m1bFeedText, foldGiants } from '../feed.js';
import * as coopR from '../../../../shared/rules/coop.js';
import * as ordersA from '../../../../shared/rules/actions/orders.js';
import { ORDERS, furnitureOf } from '../../../../shared/content/index.js';
import { LEDGER_MAX } from '../../../../shared/content/config.js';

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : 0);
const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmt = (n) => NUM.format(Math.trunc(Number(n) || 0));
/** Ledger reasons in neutral words (GDD §6.3: "who, why and when, neutral wording"). */
export const LEDGER_REASONS = Object.freeze({
  sell: 'Sold at the stand', order: 'Order for Mabel', quest: 'Letter reward', level: 'Level-up gift', ribbon: 'Ribbon reward',
  gift: 'Daily Gift', meter: 'Mabel\'s weekly chest', almanac: 'Almanac task', challenge: 'Couple Challenge', together: 'Together task',
  combo: 'Together Combo', debris: 'Cleared debris', seed: 'Seeds', uproot: 'Seeds back (uproot)', undo: 'Undo: refund',
  buy: 'Bought', land: 'Bought the land:', slot: 'New slot for the', upgrade: 'Upgraded the', tool: 'Bought the', store: 'Store goods:',
  restore: 'Brought back the', barn: 'Barn upgrade', hurry: 'Hurry', golden_seeds: 'Golden Seeds', cancel: 'Cancelled',
  mastery: 'Mastery star',
});

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

/** One quest task as a line: "Harvest 6 Wheat", with its progress. */
export function taskLine(t) {
  // the rules word every task to L25 (Barge rows, Fair medals, bee forage, duets, ...) with content's plurals
  if (typeof goalsR.taskText === 'function') return goalsR.taskText(t);
  const verb = QUEST_VERBS[t.verb]?.text ?? t.verb;
  const special = { order: t.qty === 1 ? 'order' : 'orders', debris: 'pieces of debris', demand: 'Demand goods', prized: 'blue-ribbon harvests',
    barn: 'Barn upgrade', slot: 'building slot', plot: 'plots', duet: 'duet recipe', bench: 'Golden Hour on the bench', help_flag: 'help flags' };
  if (t.verb === 'expand') return `Buy the ${nameOf(t.ref)}`;
  if (t.verb === 'upgrade' && t.ref === 'barn') return t.qty > 1 ? `Upgrade the Barn ${t.qty} times` : 'Upgrade the Barn';
  if (t.verb === 'empty') return `Empty the ${nameOf(t.ref)} ${t.qty > 1 ? `${t.qty} times` : ''}`.trim();
  if (special[t.ref]) return `${verb} ${fmt(t.qty)} ${special[t.ref]}`;
  return `${verb} ${counted(t.qty, t.ref)}`;
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
      id, chain: def.chain, title: def.title, level: def.level, giver: npcOf(def.giver) ?? null, letter: def.letter ?? null,
      doneText: def.done ?? '', coins: def.coins, xp: def.xp, rewards: def.rewards ?? {}, extraText: def.extraText,
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
    return b ? { id: b.id, title: b.title, text: b.text, art: b.art, from: npcOf(b.from) ?? null, after: q.id, at: q.at } : null;
  }).filter(Boolean);
  return { active, done, beats,
    nextUp: nextUp && nextUp.level > level ? { title: nextUp.title, level: nextUp.level, giver: npcOf(nextUp.giver) } : null };
}

/** True when `pid` has already read the story beat `id` (per-player seen flags, GDD §6.1). */
export const beatSeen = (state, pid, id) => Boolean(state.players[pid]?.seen?.beats?.[id]);

/** Extra rewards of a quest as short phrases ("5 Acorns", "2 Hearts each", "Jam-jar shelf decor"). */
export function rewardPhrases(r) {
  const out = [];
  if (r.acorns) out.push(`${r.acorns} Acorn${r.acorns > 1 ? 's' : ''}`);
  if (r.hearts) out.push(`${r.hearts} Heart${r.hearts > 1 ? 's' : ''} each`);
  for (const [it, n] of Object.entries(r.items ?? {})) out.push(`${n} ${nameOf(it)}`);
  for (const d of r.decor ?? []) out.push(nameOf(d));
  for (const [sp, n] of Object.entries(r.animalsAtStart ?? {})) out.push(`${n} free ${nameOf(sp)}${n > 1 ? 's' : ''}`);
  for (const d of r.giftAtStart ?? []) out.push(`a free ${nameOf(d)}`);
  for (const d of r.gift ?? []) out.push(`a free ${nameOf(d)}`);
  for (const f of r.furniture ?? []) out.push(`${furnitureOf(f)?.name ?? f} for the farmhouse`);
  if (r.name) out.push(`you name the ${nameOf(r.name)}`);
  if (r.beat) out.push('a story letter');
  return out;
}

// ---- ribbons (GDD §5.4) ---------------------------------------------------------------------------------------------

const SCOPE_LABEL = { F: 'Farm', P: 'Yours', T: 'Together' };

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
    rows.push({ id: r.id, n: r.n, name: r.name, text: r.text, scope: r.scope, scopeLabel: SCOPE_LABEL[r.scope], tier, tiers: r.tiers,
      value: shown, next, prev, pct: next ? Math.max(0, Math.min(1, (shown - prev) / Math.max(1, next - prev))) : 1, title: r.title,
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
  return { levelTitle, worn: p?.title ?? null, options: list.map((id) => ({ id, title: ribbonOf(id)?.title ?? id })) };
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
    return { id: d.id, name: d.name, count, stars, next, prev, unit, pct: next ? Math.min(1, (count - prev) / Math.max(1, next - prev)) : 1 };
  });
  return {
    open: level >= MASTERY.unlock, unlock: MASTERY.unlock,
    families: [
      { id: 'crops', label: 'Crops', rows: fam('crops', live('crops'), 'harvests') },
      { id: 'trees', label: 'Trees', rows: fam('trees', live('trees'), 'harvests') },
      { id: 'animals', label: 'Animals', rows: fam('animals', live('animals'), 'collections') },
      { id: 'recipes', label: 'Recipes', rows: fam('recipes', live('recipes'), 'crafts') },
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
    { id: 'crops', label: 'crops harvested', icon: 'wheat', n: own(f, 'cropsHarvested'), by: split((s) => sumPrefix(s, 'harvest.')) },
    { id: 'plantings', label: 'plots planted', icon: 'plot', n: sumPrefix(f, 'plant.'), by: split((s) => own(s, 'plantings')) },
    { id: 'goods', label: 'goods crafted', icon: 'bread', n: own(f, 'goodsCrafted') },
    { id: 'animals', label: 'animal goods collected', icon: 'egg', n: own(f, 'animalsCollected') },
    { id: 'fruit', label: 'tree harvests', icon: 'apple', n: own(f, 'treesHarvested') },
    { id: 'orders', label: 'orders filled', icon: 'order_board', n: Math.floor(own(f, 'ordersQ') / 4), by: split((s) => own(s, 'ordersFilled')) },
    { id: 'coins', label: 'coins earned', icon: 'coins', n: own(f, 'coins.earned') },
    { id: 'debris', label: 'debris cleared', icon: 'rock', n: own(f, 'debrisCleared'), by: split((s) => own(s, 'debrisCleared')) },
    { id: 'duets', label: 'duets cooked together', icon: 'hearts', n: own(f, 'duets') },
  ];
  const players = pids.map((pid) => {
    const p = state.players[pid];
    const lvl = personalLevelFromXp(p.xp);
    return { pid, name: p.name, color: p.color, xp: p.xp, level: lvl, title: p.title ? ribbonOf(p.title)?.title ?? titleFor(lvl) : titleFor(lvl), hearts: p.hearts };
  });
  return { rows, players, level: levelFromXp(state.farm.xp), xp: state.farm.xp };
}

// ---- the treasury ledger (GDD §6.3) ---------------------------------------------------------------------------------

/** A friendly, neutral sentence for a ledger reason ("sell", "buy:bakery", "order", "slot:mill" ...). */
const anAnimal = (id) => defOf(id)?.layer === 'none';
const REF_REASONS = Object.freeze({
  sell: (n, id) => `Sold ${anAnimal(id) ? 'a' : 'the'} ${n}`, undo: (n) => `Took back the ${n} (undo)`,
  buy: (n, id) => `Bought ${anAnimal(id) ? 'a' : 'the'} ${n}`, land: (n) => `Bought ${n}`,
  slot: (n) => `A new slot for the ${n}`, upgrade: (n) => `Upgraded the ${n}`, tool: (n) => `Bought the ${n}`,
  store: (n) => `Bought ${n} from the store`, restore: (n) => `Brought back the ${n}`,
});

export function ledgerText(reason) {
  if (reason === 'wish:in') return 'Set aside for the Wishlist';
  if (reason === 'wish:out') return 'Back from the Wishlist';
  const [k, ref] = String(reason).split(':');
  if (ref && REF_REASONS[k]) return REF_REASONS[k](nameOf(ref), ref);
  const base = LEDGER_REASONS[k] ?? k.replace(/_/g, ' ');
  return ref ? `${base} ${nameOf(ref)}` : base;
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

/** One feed row as a sentence (actor name added by the panel). */
export function feedText(row) {
  const q = (n) => fmt(n);
  switch (row.k) {
    case 'harvest': return `harvested ${counted(row.q, row.item)}${row.p > 1 ? ` from ${q(row.p)} plots` : ''}`;
    case 'tree': return `picked ${counted(row.q, row.item)}`;
    case 'collect': return `collected ${counted(row.q, row.item)}`;
    case 'tend': return `tended ${q(row.q)} animal${row.q === 1 ? '' : 's'}`;
    case 'craft': return `made ${counted(row.q, row.item)}`;
    case 'sell': return `sold ${counted(row.q, row.item)} for ${q(row.c)} coins`;
    case 'order': return `filled ${row.g ? 'a golden order' : 'an order'} (+${q(row.c)} coins)`;
    case 'level': return `reached farm level ${row.level}!`;
    case 'buy':
      if (row.what === 'slot') return `added a ${nameOf(row.def)} slot${row.c ? ` for ${q(row.c)} coins` : ''}`;
      if (row.what === 'hurry') return `${row.def === 'plot' ? (row.q > 1 ? `finished ${q(row.q)} crops early` : 'finished crops early') : row.q > 1 ? `hurried ${q(row.q)} batches` : 'hurried a batch'} for ${q(row.acorns ?? row.a ?? 0)} Acorn${(row.acorns ?? row.a) === 1 ? '' : 's'}`;
      return `bought ${/^[aeiou]/i.test(nameOf(row.def)) ? 'an' : 'a'} ${nameOf(row.def)}${row.c ? ` for ${q(row.c)} coins` : ''}${row.a ? ` and ${row.a} Acorns` : ''}`;
    case 'expand': return `bought the ${nameOf(row.def)}`;
    case 'ribbon': return `earned the ${ribbonOf(row.id)?.name ?? row.id} ribbon (${['', 'bronze', 'silver', 'gold'][row.t] ?? 'tier'})`;
    case 'quest': return `finished “${questOf(row.id)?.title ?? row.id}”`;
    case 'keepsake': return `gave a keepsake: ${nameOf(row.item)}`;
    case 'note': return 'pinned a note on the farm';
    case 'golden': return 'Golden Hour began on the bench';
    case 'hf': return 'high-fived!';
    case 'gift': return `opened day ${row.day} of the Daily Gift`;
    case 'chest': return { meter: 'opened a chest on Mabel\'s meter', almanac: 'finished the day\'s Almanac', challenge: 'completed the Couple Challenge', together: 'finished the Together task' }[row.what] ?? 'opened a chest';
    case 'name': return row.what === 'farm' ? `named the farm “${row.text}”` : `named an animal “${row.text}”`;
    case 'wish': {
      const the = row.def ? `the ${nameOf(row.def)}` : 'the Wishlist';
      if (row.what === 'bought') return `got ${row.def ? `the ${nameOf(row.def)}` : 'a wish'} from the Wishlist${row.c ? ` (${q(row.c)} coins saved up)` : ''}!`;
      if (row.what === 'withdraw') return `took ${q(row.c ?? 0)} coins back from ${the}`;
      if (row.what === 'asked') return `asked to use the coins saved for ${the}`;
      if (row.what === 'denied') return `kept saving for ${the}`;
      if (row.what === 'deposit' || row.c) return `put ${q(row.c ?? 0)} coins toward ${the}`;
      return row.def ? `wished for the ${nameOf(row.def)}` : 'made a wish';
    }
    case 'keep': return row.q > 0 ? `keeps ${counted(row.q, row.item)}` : `stopped keeping ${nameOf(row.item)}`;
    default: return m1bFeedText(row)?.text ?? row.k;
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

/** A task line of the Almanac: "Harvest 12 Wheat" etc. */
export function almanacLine(t) {
  const verb = { harvest: 'Harvest', plant: 'Plant', water: 'Water', collect: 'Collect', pet: 'Pet', make: 'Make', fill: 'Fill', clear: 'Clear', enter: 'Enter' }[t.verb] ?? t.verb;
  let what;
  if (t.ref === '*') what = 'crops';
  else if (t.ref === 'animal') what = t.qty === 1 ? 'animal' : 'animals';
  else if (t.ref === 'order') what = t.qty === 1 ? 'order' : 'orders';
  else if (t.ref === 'debris') what = 'debris';
  else return `${verb} ${counted(t.qty, t.ref)}`;
  return `${verb} ${fmt(t.qty)} ${what}`;
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
    together: t && tpl ? { text: tpl.text.replace('{n}', fmt(tpl.verb === 'fill' ? t.qty / 4 : t.qty)), n: tpl.verb === 'fill' ? Math.floor(t.n / 4) : t.n,
      qty: tpl.verb === 'fill' ? t.qty / 4 : t.qty, by: t.by, done: t.done, hearts: ALMANAC.together.hearts } : null,
  };
}

/** The Couple Challenge of the week (GDD §5.8). */
export function challengeView(state) {
  const c = state.farm.challenge;
  const level = levelFromXp(state.farm.xp);
  if (!c || !c.cur) return { open: level >= COUPLE_CHALLENGE.unlock, unlock: COUPLE_CHALLENGE.unlock, cur: null, done: c?.done ?? 0 };
  const tpl = COUPLE_CHALLENGE.templates.find((x) => x.id === c.cur.tpl);
  const text = tpl ? tpl.text.replace('{coins}', `${fmt(c.cur.target)} coins`).replace('{n}', fmt(c.cur.target)) : c.cur.tpl;
  return { open: true, unlock: COUPLE_CHALLENGE.unlock, done: c.done, reward: COUPLE_CHALLENGE.reward,
    cur: { text, n: c.cur.n, target: c.cur.target, by: c.cur.by, finished: c.cur.done, pct: Math.min(1, c.cur.n / Math.max(1, c.cur.target)) } };
}

