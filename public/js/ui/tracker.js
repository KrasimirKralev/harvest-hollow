// Goal Tracker (GDD §5.1, §7.3 left column): NOW / SOON / BIG, never empty, then the story cards (chains A-E, up to
// 3) with progress rings. New story cards bounce a "!" at 120 BPM until hovered (per player, this browser).
// A click shows the target: the camera eases to the tile (and the tutorial pointer flashes there), the panel
// opens, or the card's action runs (Grandma's seed basket). ui-shell lane.
//
// Layout (QA wave 1 UI-06, QA2 UI-03): NOW is a full card; SOON, BIG and the story cards fold into ONE row under it
// (their tags and icons) that opens into the chips over the farm on hover, keyboard focus or a tap; each chip opens
// into its full card the same way. "Show all" keeps every card open, remembered per player in this browser. Every
// card with have / need says its numbers.
//
// Phones (css/mobile.css, mobile wave): the column folds into ONE chip under the top row (the NOW card's icon and
// title, "+N" for the rest); a tap opens the tracker under it as a drop-down, a tap outside or a card that acted
// closes it again.
//
// The ranking belongs to the rules: rules-goals' `goals(state, pid, now, { recent })` (shared/rules/goals.js, pure,
// fuzz-tested) returns { now, soon, big }; `cardsFromGoals` turns those into cards with an icon, a short title, a
// sub line, a progress ring and a click target. `localGoals` is the safety net (the GDD's NOW fallback chain) used
// only if goals() throws, so the tracker is never empty:
//   collect ready -> plant idle plots -> clear debris -> "Everything is growing — next ready in 2:41. Tip: ..."
//
//   cardsFromGoals(res, state, pid, now) -> [card]      card = { slot, kind, title, sub, icon?, glyph?, progress?, target? }
//   localGoals(state, pid, now) -> [card]                (pure; tests)
//   storyCards(state, now) -> [{ id, title, sub, icon, progress, done }]   (pure; tests)
import {
  CONTENT, defOf, cropOf, live, liveAt, levelFromXp, xpForLevel, SAFETY,
} from '../../../shared/content/index.js';
import { sortedKeys } from '../../../shared/rules/order.js';
import * as questsR from '../../../shared/rules/actions/quests.js';
import { goals as rulesGoalsFn } from '../../../shared/rules/goals.js';
import { taskLabelMsg } from '../../../shared/rules/goal-text.js';
import { chainArt } from './chains.js';
import { goalText } from './goal-text.js';
import { t, tn, ctext, N, qty, nameEntry } from '../i18n/index.js';

/** The Journal tab a quest card is listed on (rules' tabOf: 'story' | 'week' | 'together' -> the tab ids). */
export const journalTabOf = (q) => {
  const t = q && typeof questsR.tabOf === 'function' ? questsR.tabOf(q) : 'story';
  return t === 'together' ? 'stats' : t === 'week' ? 'week' : 'story';
};
import { h, icon, svgIcon, fmtDuration, kv, touchPlayer } from './dom.js';
import { nextUnlocks, PHONE_Q } from './hud.js';
import { TOOL_CONTENT } from './toolbar.js';
import { treasures, savingOf, relicIcon } from './panels/w4b-rules.js';
import { hasIcon } from '../render/icons.js';
import { localSaving } from './panels/w4b.js';

/** A content name for a card: the Bulgarian ref when the names table has one, else the English the code holds. */
const nm = (id, en, family) => (nameEntry(id, family) ? N(id, family) : en);
/** A quest's title in the language in effect. */
const questTitle = (id, q) => ctext('quests', id, 'title', q.title);

/** Panel names the rules' goal targets use for a panel registered under another name (wave 4). */
const PANEL_ALIAS = Object.freeze({ upgrade: 'upgrades' });

/** The farm's quick facts the fallback chain needs. Pure. */
function scan(state, now) {
  const objs = state.farm.objects;
  const out = { ready: [], empty: [], growing: [], debris: [] };
  for (const id of sortedKeys(objs)) {
    const o = objs[id];
    const d = defOf(o.def);
    if (!d) continue;
    if (d.kind === 'plot') {
      if (!o.crop) out.empty.push({ id, x: o.x, z: o.z });
      else if (now >= o.crop.readyAt) out.ready.push({ id, x: o.x, z: o.z, crop: o.crop.def });
      else out.growing.push({ id, x: o.x, z: o.z, crop: o.crop.def, readyAt: o.crop.readyAt });
    } else if (d.kind === 'debris' && Number.isFinite(o.x)) {
      out.debris.push({ id, x: o.x, z: o.z, def: o.def });
    }
  }
  return out;
}

/** The first object id whose def is `defId` (a building for "try a recipe", an order board for orders). */
function firstOf(state, pred) {
  const objs = state.farm.objects;
  for (const id of sortedKeys(objs)) if (pred(objs[id], id)) return { id, o: objs[id] };
  return null;
}

const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x);
/** t() under a name that the card code's local `t` (a target) never shadows. */
const tr = (key, params) => t(key, params);
/** A content name as text for a card line. */
const nmText = (id, en, family) => (nameEntry(id, family) ? t('goals.tr.name', { x: N(id, family) }) : en);

/**
 * Split "A — B" / "A: B" / "Build the X (2,600). You have 3,292" texts into a short title and a sub line. Bulgarian
 * writes the dash as " – " and runs about a quarter longer, so its title may be longer before the colon.
 */
function splitText(text) {
  const dash = text.search(/ [—–] /);
  if (dash > 0) return [text.slice(0, dash), cap(text.slice(dash + 3))];
  const colon = text.indexOf(': ');
  if (colon > 0 && colon < (/[а-я]/i.test(text) ? 44 : 34)) return [text.slice(0, colon), cap(text.slice(colon + 2))];
  const stop = text.indexOf('. ');
  if (stop > 0 && stop < 40 && text.length > 40) return [text.slice(0, stop), cap(text.slice(stop + 2))];
  return [text, ''];
}

/** " · 6,000 / 6,900 XP" for a card with have / need, unless its line already says a number. Pure. */
export function numbersOf(g, sub = '') {
  if (!Number.isFinite(g.have) || !Number.isFinite(g.need) || g.need <= 0) return '';
  if (/\d/.test(sub)) return '';
  return t(g.kind === 'level' ? 'goals.tr.numbers.xp' : 'goals.tr.numbers', { have: Math.min(g.have, g.need), need: g.need });
}
const withNumbers = (g, sub) => {
  const n = numbersOf(g, sub);
  return n ? (sub ? `${sub} · ${n}` : n) : sub;
};

/**
 * An order card's sub line: what it asks and pays, "39 Potatoes, 10 Cabbage +2 more · 28,990 coins" (QA2 UI-09: the
 * golden order card had no sub line at all). Pure.
 */
export function orderLine(order) {
  if (!order || !order.items) return '';
  const ids = sortedKeys(order.items);
  const words = ids.slice(0, 2).map((id) => qty(id, order.items[id], { family: 'items' })).join(', ');
  const line = ids.length > 2 ? t('goals.tr.order.more', { list: words, n: ids.length - 2 }) : words;
  return Number.isSafeInteger(order.coins) && order.coins > 0 ? t('goals.tr.order.pay', { line, coins: order.coins }) : line;
}

/** The Goal Tracker re-ranks at most every RANK_MS (qa2 CL-06: goals() costs 4-25 ms on an L25 farm). */
export const RANK_MS = 500;
/**
 * When to re-rank after a change: 0 = on the next animation frame (the last ranking is RANK_MS old: a click's card
 * updates at once), else the ms to wait for one trailing ranking (a stroke's later frames, the partner's burst). Pure.
 * @param {{ rankedAt: number, now: number }} o
 */
export function rankWait({ rankedAt, now }) {
  return Math.max(0, Math.min(RANK_MS, rankedAt + RANK_MS - now));
}

/** rules-goals' { now, soon, big } -> tracker cards with icons, progress and targets. Pure. */
export function cardsFromGoals(res, state, pid, now) {
  const out = [];
  for (const slot of ['now', 'soon', 'big']) {
    const g = res && res[slot];
    if (!g) continue;
    const [title, sub0] = splitText(g.msg ? goalText(g.msg) : String(g.text || ''));
    const card = { slot, kind: g.kind, id: g.id, title, sub: sub0, progress: Number.isFinite(g.have) && g.need ? g.have / g.need : undefined };
    // a target the rules chose (spend / land / seed basket cards) wins over the kind's default below
    const ruleTarget = g.target && typeof g.target === 'object' ? g.target : null;
    switch (g.kind) {
      case 'collect': {
        // a ripe field first, then any Hand thing; an axe tree (a Pine) last: the Hand only opens its panel (PT-03)
        const axe = (o) => defOf(o.def)?.tool === 'axe';
        const t = firstOf(state, (o) => o.def === 'plot' && o.crop && o.crop.readyAt <= now)
          ?? firstOf(state, (o) => o.def !== 'plot' && Number.isSafeInteger(o.readyAt) && o.readyAt <= now && !axe(o))
          ?? firstOf(state, (o) => o.def !== 'plot' && Number.isSafeInteger(o.readyAt) && o.readyAt <= now);
        card.icon = t ? (t.o.crop ? t.o.crop.def : t.o.def) : 'basket';
        if (t && Number.isFinite(t.o.x)) card.target = { tile: { x: t.o.x, z: t.o.z }, ...(t && axe(t.o) ? { tool: 'axe' } : {}) };
        card.sub = card.sub || tr(t && t.o.crop ? 'goals.tr.collect.sickle' : t && axe(t.o) ? 'goals.tr.collect.axe'
          : (touchPlayer() ? 'goals.tr.collect.tap' : 'goals.tr.collect.click'));
        break;
      }
      case 'plant': {
        const level = levelFromXp(state.farm.xp);
        const fast = liveAt('crops', level).reduce((a, c) => (!a || c.growMs < a.growMs ? c : a), null);
        const t = firstOf(state, (o) => o.def === 'plot' && !o.crop);
        card.icon = fast ? fast.id : 'seed_bag';
        card.sub = card.sub || (fast ? tr('goals.tr.readyIn', { crop: nm(fast.id, fast.name, 'crops'), d: fmtDuration(fast.growMs) }) : '');
        if (t) card.target = { tile: { x: t.o.x, z: t.o.z }, tool: 'seed' };
        break;
      }
      case 'order': case 'help':
        card.icon = 'order_board';
        card.target = { panel: 'orders', args: { slot: g.ref } };
        card.sub = card.sub || orderLine(state.farm.orders?.slots?.[g.ref]?.order);
        break;
      case 'almanac':
        card.glyph = 'book';
        // the Almanac lives on the Journal's "This week" tab (there is no 'almanac' tab: it opened Letters; UI-13)
        card.target = { panel: 'journal', args: { tab: 'week' } };
        break;
      case 'debris': {
        const t = firstOf(state, (o) => CONTENT.debris.has(o.def) && Number.isFinite(o.x));
        card.icon = t ? t.o.def : 'axe';
        card.sub = card.sub || tr('goals.tr.debris');
        if (t) card.target = { tile: { x: t.o.x, z: t.o.z } };
        break;
      }
      case 'quest': {
        const q = CONTENT.quests.get(g.id);
        const task = q && q.tasks[Number(g.ref)];
        card.icon = task ? task.ref : null;
        card.glyph = 'letter';
        if (q) {
          card.title = questTitle(g.id, q);
          card.sub = task ? tr('goals.tr.quest.sub', { task: goalText(taskLabelMsg(task)), have: g.have ?? 0, need: g.need ?? 0 })
            : tr('goals.tr.quest.n', { have: g.have ?? 0, need: g.need ?? 0 });
        }
        // chains F / G live on "This week" and chain H on "Together" (GDD §5.3); A-E on Letters
        card.target = { panel: 'journal', args: { tab: journalTabOf(q), focus: g.id } };
        break;
      }
      case 'try': {
        const r = CONTENT.recipes.get(g.id);
        card.icon = g.id;
        card.title = tr('goals.tr.try');
        card.sub = r ? String(nmText(g.id, r.name, 'items')) : card.sub;
        const b = r ? firstOf(state, (o) => o.def === r.building) : null;
        card.target = b ? { panel: 'building', args: { id: b.id }, tile: Number.isFinite(b.o.x) ? { x: b.o.x, z: b.o.z } : null } : null;
        break;
      }
      case 'level': {
        const level = levelFromXp(state.farm.xp);
        const bring = nextUnlocks(level, 1)[0];
        card.icon = bring && bring.level === level + 1 ? bring.id : 'xp';
        // past L40 the rules word the card as the Legacy level and what it pays (GDD §5.9 "no empty levels, ever")
        const legacy = g.msg ? g.msg.key === 'goals.r.level.legacy' : /^Legacy level /.test(String(g.text || ''));
        card.title = legacy ? title : tr('goals.tr.reach', { n: level + 1 });
        const toGo = tr('goals.tr.xpToGo', { n: Math.max(0, (g.need ?? 0) - (g.have ?? 0)) });
        const extra = legacy ? sub0 : bring && bring.level === level + 1 ? bring.name : '';
        card.sub = extra ? `${toGo} · ${extra}` : toGo;
        card.target = { panel: 'journal', args: { tab: 'stats' } };
        break;
      }
      case 'ribbon': {
        // "Builder · 11 of 13", "Level Up · Farm level · 12 / 13": the ribbon's name, what it counts, the numbers
        const rb = CONTENT.ribbons.get(g.id);
        card.glyph = 'ribbon';
        if (rb) { card.title = ctext('ribbons', rb.id, 'name', rb.name); card.sub = ctext('ribbons', rb.id, 'text', rb.text); }
        card.target = { panel: 'journal', args: { tab: 'ribbons', focus: g.id } };
        break;
      }
      case 'mastery':
        card.icon = g.id;
        card.target = { panel: 'journal', args: { tab: 'mastery', focus: g.id } };
        break;
      case 'challenge':
        card.glyph = 'heart';
        card.target = { panel: 'journal', args: { tab: 'week' } };
        break;
      case 'basket':
        card.icon = g.ref || 'wheat';
        card.sub = card.sub || tr('goals.tr.basket');
        break;
      case 'build':
        card.icon = g.id && defOf(g.id) ? g.id : 'hammer';
        break;
      case 'land':
        card.glyph = 'hammer';
        card.icon = null;
        break;
      case 'decor':
        card.icon = g.id && defOf(g.id) ? g.id : null;
        card.glyph = 'flower';
        break;
      case 'barn':
        card.icon = 'barn';
        card.target = { panel: 'barn', args: {} };
        break;
      case 'tip': {
        card.icon = g.ref || null;
        card.glyph = 'sprout';
        const t = firstOf(state, (o) => o.def === 'plot' && o.crop && o.crop.readyAt === g.eta);
        if (t) card.target = { tile: { x: t.o.x, z: t.o.z } };
        break;
      }
      // the M1b systems (the rules' targets already say which panel and crate / request / entry a click opens)
      case 'fair': card.icon = g.ref && CONTENT.items.has(g.ref) ? g.ref : 'ribbon_rosette'; break;
      case 'barge': {
        const c = g.ref !== undefined ? state.farm.barge?.crates?.[g.ref] : null;
        card.icon = c ? c.item : 'wooden_crate';
        break;
      }
      case 'folk': {
        const p = g.ref !== undefined ? state.farm.folk?.posts?.[g.ref] : null;
        card.icon = p ? Object.keys(p.items).sort()[0] : 'order_board';
        break;
      }
      case 'town': card.icon = g.ref && CONTENT.items.has(g.ref) ? g.ref : 'ferry_landing_souvenir'; break;
      case 'giant': card.icon = g.ref && CONTENT.items.has(g.ref) ? g.ref : 'axe'; break;
      case 'pet': card.icon = g.ref && CONTENT.items.has(g.ref) ? g.ref : 'dog_house'; break;
      case 'restore': card.icon = g.ref && CONTENT.items.has(g.ref) ? g.ref : 'hammer'; break;
      case 'beauty': card.glyph = 'star'; break;
      case 'album': card.glyph = 'book'; break;
      // M2 (rules-goals' kinds; the panels are ui-league's and ui-home's)
      case 'track': card.icon = 'ticket_stub'; break;
      case 'league': card.icon = 'purple_rosette'; break;
      case 'perk': card.icon = 'mastery_sign_gold'; break;
      case 'duel': card.icon = { pumpkins: 'pumpkin', pies: 'apple_pie', orders: 'order_board' }[g.ref] ?? 'ribbon_trophy'; break;
      case 'grandma': card.glyph = 'letter'; break;
      case 'breed': card.icon = g.ref && CONTENT.animals.has(g.ref) ? g.ref : 'barn'; break;
      case 'nursery': card.icon = 'baby_bottle'; break;
      case 'fish': card.icon = 'fishing_rod'; break;
      // wave 4 (the owners' wish list): the next upgrade (its building's picture) and Fertilizer to spread
      case 'upgrade': card.icon = (g.id && state.farm.objects[g.id]?.def) || 'hammer'; break;
      case 'fertilize': card.icon = g.ref && CONTENT.items.has(g.ref) ? g.ref : 'compost'; break;
      // wave 4b (owner wish 2): an Acorn treasure to save for or to buy (the Market's Acorn shop holds them), or a
      // once-a-day one to use (the rules' act target); (wish 1) a balloon crate to open
      case 'relic': case 'treasure': case 'saving': {
        const rid = g.ref ?? g.id;
        card.glyph = 'acorn';
        card.icon = rid ? relicIcon(rid, hasIcon).id : null;
        if (!ruleTarget || ruleTarget.panel === 'relics') card.target = { panel: 'market', args: { tab: 'acorn', focus: rid } };
        break;
      }
      case 'crate': card.icon = hasIcon('loot_crate') ? 'loot_crate' : 'coins'; break;
      default:
        card.glyph = 'star';
    }
    if (ruleTarget && !(ruleTarget.panel === 'relics' && card.target)) card.target = ruleTarget;
    card.sub = withNumbers(g, card.sub || '');
    if (card.sub) card.sub = cap(card.sub);
    out.push(card);
  }
  void pid;
  return out;
}

/** The GDD §5.1 fallback chain: three cards, never empty. Pure. */
export function localGoals(state, pid, now) {
  const level = levelFromXp(state.farm.xp);
  const f = scan(state, now);
  const fastest = liveAt('crops', level).reduce((a, c) => (!a || c.growMs < a.growMs ? c : a), null) || cropOf('wheat');
  const goals = [];
  if (f.ready.length) {
    const first = f.ready[0];
    goals.push({ slot: 'now', title: tn('goals.tr.local.harvest', f.ready.length),
      sub: tr('goals.tr.collect.sickle'), icon: first.crop, target: { tile: { x: first.x, z: first.z } } });
  } else if (f.empty.length) {
    const first = f.empty[0];
    goals.push({ slot: 'now', title: tn('goals.tr.local.plant', f.empty.length),
      sub: tr('goals.tr.readyIn', { crop: nm(fastest.id, fastest.name, 'crops'), d: fmtDuration(fastest.growMs) }), icon: fastest.id,
      target: { tile: { x: first.x, z: first.z }, tool: 'seed' } });
  } else if (f.debris.length) {
    const first = f.debris[0];
    goals.push({ slot: 'now', title: tr('goals.tr.local.tidy'), sub: tr('goals.tr.local.tidySub', { n: f.debris.length }), icon: first.def,
      target: { tile: { x: first.x, z: first.z } } });
  } else {
    const next = f.growing.reduce((a, g) => (!a || g.readyAt < a.readyAt ? g : a), null);
    const tip = { crop: nm(fastest.id, fastest.name, 'crops'), g: fmtDuration(fastest.growMs) };
    goals.push({ slot: 'now', title: tr('goals.tr.local.growing'), glyph: 'sprout',
      sub: next ? tr('goals.tr.local.nextTip', { d: fmtDuration(next.readyAt - now), ...tip }) : tr('goals.tr.local.tip', tip),
      target: next ? { tile: { x: next.x, z: next.z } } : null });
  }
  // SOON: the next level and the first thing it brings
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  const bring = nextUnlocks(level, 1)[0];
  const xp = Math.max(0, to - state.farm.xp);
  goals.push({ slot: 'soon', title: tr('goals.tr.local.reach', { n: level + 1 }),
    sub: bring && bring.level === level + 1 ? tr('goals.tr.local.xpBrings', { xp, thing: bring.name }) : tr('goals.tr.xpToGo', { n: xp }),
    icon: bring && bring.level === level + 1 ? bring.id : 'xp', progress: (state.farm.xp - from) / Math.max(1, to - from),
    target: { panel: 'journal', args: { tab: 'stats' } } });
  // BIG: the next piece of land, else the priciest unlocked building the farm does not have yet
  const owned = new Set(state.farm.expansions || []);
  const land = live('expansions').filter((e) => !owned.has(e.id) && e.cost > 0).sort((a, b) => a.k - b.k)[0];
  if (land) {
    const coins = state.farm.wallet.coins;
    goals.push({ slot: 'big', title: tr('goals.tr.local.save', { land: nm(land.id, land.name, 'expansions') }),
      sub: level < land.unlock ? tr('goals.tr.local.opens', { n: land.unlock, coins: land.cost })
        : tr('goals.tr.local.coins', { have: Math.min(coins, land.cost), need: land.cost }),
      glyph: 'hammer', progress: Math.min(1, coins / land.cost), target: { panel: 'expansion', args: { id: land.id } } });
  } else {
    const have = new Set(Object.values(state.farm.objects).map((o) => o.def));
    const b = liveAt('buildings', level).filter((x) => !have.has(x.id) && x.cost > 0).sort((a, c) => c.cost - a.cost)[0];
    if (b) {
      goals.push({ slot: 'big', title: tr('goals.tr.local.build', { b: nm(b.id, b.name) }),
        sub: tr('goals.tr.local.coins', { have: Math.min(state.farm.wallet.coins, b.cost), need: b.cost }),
        icon: b.id, progress: Math.min(1, state.farm.wallet.coins / b.cost), target: { panel: 'market', args: { tab: 'buildings', focus: b.id } } });
    }
  }
  void pid;
  return goals;
}

/** Active story cards with their first unfinished task. Pure. */
export function storyCards(state, now) {
  const q = state.farm.quests;
  if (!q || !q.active) return [];
  const ids = sortedKeys(q.active).sort((a, b) => (q.active[a].at - q.active[b].at) || (a < b ? -1 : 1));
  const out = [];
  for (const id of ids) {
    const def = CONTENT.quests.get(id);
    if (!def) continue;
    let have = 0;
    let need = 0;
    let next = null;
    def.tasks.forEach((t, i) => {
      let p;
      try { p = questsR.taskProgress(state, id, i, now); } catch { p = { have: 0, need: t.qty, done: false }; }
      have += p.have;
      need += p.need;
      if (!next && !p.done) next = { t, p };
    });
    // a card that waits for something says what (RC-10, UI-18): "Build the Dairy first", with the Dairy's icon
    let blocker = null;
    if (next && typeof questsR.blockerOf === 'function') {
      try { blocker = questsR.blockerOf(state, next.t, now); } catch { blocker = null; }
    }
    const sub = !next ? tr('goals.tr.story.done')
      : blocker && blocker.text ? cap(blocker.msg ? goalText(blocker.msg) : blocker.text)
        : tr('goals.tr.quest.sub', { task: goalText(taskLabelMsg(next.t)), have: next.p.have, need: next.p.need });
    out.push({ id, title: questTitle(id, def), sub, icon: next ? (blocker && blocker.ref && defOf(blocker.ref) ? blocker.ref : next.t.ref) : null,
      giver: def.giver, chain: def.chain || null, progress: need ? have / need : 1, done: !next, waiting: Boolean(blocker) });
  }
  return out;
}

function ring(progress) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 58 58');
  svg.classList.add('ring');
  svg.setAttribute('aria-hidden', 'true');
  const r = 26;
  const c = 2 * Math.PI * r;
  for (const [cls, dash] of [['track', 0], ['val', c * (1 - Math.max(0, Math.min(1, progress)))]]) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('cx', '29');
    el.setAttribute('cy', '29');
    el.setAttribute('r', String(r));
    el.setAttribute('class', cls);
    if (cls === 'val') { el.setAttribute('stroke-dasharray', String(c)); el.setAttribute('stroke-dashoffset', String(dash)); }
    svg.append(el);
  }
  return svg;
}

/** The partner's open request to use the coins of one of MY wishes, as a NOW card (UI-10). Pure. */
export function wishAskCard(state, pid, now) {
  const list = state.farm.wishlist || {};
  for (const id of sortedKeys(list)) {
    const w = list[id];
    if (!w || w.by !== pid || !w.release || w.release.by === pid) continue;
    const who = state.players[w.release.by]?.name;
    const left = Math.max(0, w.release.at + SAFETY.wishlist.autoReleaseMs - now);
    const def = defOf(w.def);
    const wish = def ? nm(w.def, def.name) : tr('goals.tr.wish.aWish');
    return { slot: 'now', kind: 'wishAsk', id, icon: w.def,
      title: who ? tr('goals.tr.wish.title', { who, name: wish }) : tr('goals.tr.wish.titlePartner', { name: wish }),
      sub: tr('goals.tr.wish.sub', { d: fmtDuration(left, { cut: 'ms<10' }) }), target: { panel: 'wishlist', args: {} } };
  }
  return null;
}

/** A card's tag (NOW / SOON / BIG / STORY / SAVE) in the language in effect. */
const slotLabel = (slot) => (['now', 'soon', 'big', 'story', 'save'].includes(slot) ? tr(`goals.tr.slot.${slot}`) : String(slot).toUpperCase());

/**
 * "Saving for the Golden Watering Can · 34 / 120 Acorns" (wave 4b, owner wish 2): the treasure this farmer picked in the
 * Acorn shop ("Save for this"), as a card after BIG; "Ready to buy" once the Acorns are there. null when none. Pure.
 */
export function savingCard(state, pid, local = null) {
  const id = savingOf(state, pid, local);
  if (!id) return null;
  const t = treasures(state).find((x) => x.id === id);
  if (!t || t.owned) return null;
  const have = Math.min(state.farm.wallet.acorns, t.acorns);
  const ready = have >= t.acorns;
  const thing = ctext(null, id, 'name', t.name);   // a treasure's name (lane B: ctext(null, relicId))
  return { slot: 'save', kind: 'relic', id, title: tr(ready ? 'goals.tr.save.ready' : 'goals.tr.save.title', { t: thing }),
    sub: ready ? tr('goals.tr.save.readySub', { n: t.acorns }) : tr('goals.tr.save.sub', { have, n: t.acorns, left: t.acorns - have }),
    icon: relicIcon(id, hasIcon).id, glyph: 'acorn', progress: have / Math.max(1, t.acorns),
    target: { panel: 'market', args: { tab: 'acorn', focus: id } } };
}

/**
 * The folded row under NOW (QA2 UI-03): one segment per card below NOW (its tag and icon) and one red letter tag with
 * the number of story letters, with a spoken label. Pure (tests).
 *   rest = the cards after NOW, story = the story cards -> { segs: [{ slot, tag, icon, glyph, letters }], label }
 */
export function restSummary(rest, story) {
  const segs = rest.map((g) => ({ slot: g.slot, tag: slotLabel(g.slot), icon: g.icon || null,
    glyph: g.icon ? null : g.glyph || 'star', letters: 0 }));
  if (story.length) segs.push({ slot: 'story', tag: String(story.length), icon: null, glyph: null, letters: story.length });
  const words = [...rest.map((g) => tr('goals.tr.part', { slot: slotLabel(g.slot), title: g.title })),
    ...(story.length ? [tr('goals.tr.part', { slot: slotLabel('story'), title: story.map((x) => x.title).join(', ') })] : [])];
  return { segs, label: tr('goals.tr.rest', { words: words.join('. ') }) };
}

export function createTracker(S) {
  const { store, view, ui } = S;
  const box = document.getElementById('tracker');
  const phoneMq = globalThis.matchMedia?.(PHONE_Q) ?? null;
  let rulesGoals = null;          // a test/dev override of rules-goals' goals()
  let lastNow = null;             // the NOW card on screen: goals() keeps it unless outranked by > 1 (QA2 RC-19)
  let timer = 0;
  let warned = false;
  const shown = new Map();        // card kind -> last time shown (GDD §5.1 novelty: "not shown in the last 10 min")
  const recentKinds = (now) => [...shown.entries()].filter(([, t]) => now - t < 600_000).map(([k]) => k);

  const seenKey = () => `hh.story.${store.pid}`;
  const modeKey = () => `hh.tracker.${store.pid}`;
  const allOpen = () => kv.get(modeKey(), 'compact') === 'all';

  let actedAt = -Infinity;        // a card just did its thing: the phone drop-down closes behind it
  function act(g) {
    const t = g.target;
    if (!t) return;
    actedAt = performance.now();
    if (t.act) {
      // an action card (Grandma's seed basket, a balloon crate): the controller predicts it like any click; a card with
      // a place on the farm shows it first (the crate's lid pops where the camera looks)
      if (t.tile && typeof view.focus === 'function') view.focus(t.tile.x, t.tile.z);
      S.controller.do(t.act, t.args || {});
    } else if (t.panel && ui.panels.has(PANEL_ALIAS[t.panel] ?? t.panel)) {
      ui.panels.open(PANEL_ALIAS[t.panel] ?? t.panel, t.args || {});
    } else if (t.tool === 'fertilizer' && !t.tile) {
      spreadFertilizer();
    } else if (t.tile) {
      view.focus(t.tile.x, t.tile.z);
      S.tutorial?.flash({ x: t.tile.x, z: t.tile.z });
      if (t.tool && S.controller.tool.id !== t.tool && S.controller.TOOLS.some((x) => x.id === t.tool)) S.controller.setTool(t.tool);
    }
  }

  /**
   * "Spread Fertilizer on 3 growing crops" (wave 4): the camera goes to the first slow crop that has none, the Compost
   * Scoop spreading Fertilizer comes to hand (the client's `spread` option), else the Hand with a word on how.
   */
  function spreadFertilizer() {
    const st = store.state;
    const now = store.now();
    const id = Object.keys(st.farm.objects).sort().find((k) => {
      const o = st.farm.objects[k];
      return o.crop && o.fert === undefined && o.crop.fert === undefined && !o.compost && o.crop.giant === undefined && o.crop.readyAt > now
        && (cropOf(o.crop.def)?.growMs ?? 0) >= 30 * 60_000;
    });
    const o = id ? st.farm.objects[id] : null;
    if (o) { view.focus(o.x, o.z); S.tutorial?.flash({ x: o.x, z: o.z }); }
    const scoop = S.controller.TOOLS.find((x) => TOOL_CONTENT[x.id] === 'compost_scoop');
    if (scoop && Object.hasOwn(S.controller.tool, 'spread')) S.controller.setTool(scoop.id, { spread: 'fertilizer' });
    else {
      if (S.controller.tool.id !== 'hand') S.controller.setTool('hand');
      ui.toast(tr(touchPlayer(S.controller) ? 'goals.tr.fert.hold' : 'goals.tr.fert.click'), { kind: 'info', icon: 'fertilizer' });
    }
  }

  const more = h('button.tracker-toggle', { type: 'button', hidden: true, on: { click: () => openStory({ id: null }) } });
  // "Show all / Fewer" is a small round switch on the NOW card's corner: it costs the column no row of its own
  const modeBtn = h('button.tracker-mode', { type: 'button', on: { click: () => {
    kv.set(modeKey(), allOpen() ? 'compact' : 'all');
    render();
  } } }, h('span', { 'aria-hidden': 'true' }));
  const foot = h('div.tracker-foot', more);
  // compact: every letter in ONE chip ("Open for Business +2") that opens into the painted cards on hover / focus
  const storyGroup = h('div.goal-slot.chip.story-group', { dataset: { slot: 'story' } });
  const storyPop = h('div.story-pop');
  // compact: everything under NOW folds into ONE row of tags and icons; hover, focus or a tap opens the chips (UI-03)
  const restSum = h('button.goal-rest-sum', { type: 'button', 'aria-expanded': 'false', on: {
    click: () => {
      const open = !restWrap.classList.contains('open');
      restWrap.classList.toggle('open', open);
      restSum.setAttribute('aria-expanded', String(open));
    } } }, h('span.segs'), h('span.chev', { 'aria-hidden': 'true' }, '▾'));
  const restPop = h('div.goal-rest-pop');
  const restWrap = h('div.goal-rest', { dataset: { slot: 'rest' } }, restSum, restPop);
  let restSig = '';
  // the phone chip (hidden on desktop by shell.css): one line for the whole tracker, opens it as a drop-down
  const chipArt = h('span.tc-art', { 'aria-hidden': 'true' });
  const chipTitle = h('span.tc-t');
  const chipMore = h('span.tc-n', { 'aria-hidden': 'true' });
  const chip = h('button.tracker-chip', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'tracker',
    on: { click: () => setDrop(!box.classList.contains('m-open')) } },
  h('span.slot-tag', { 'aria-hidden': 'true' }), chipArt, chipTitle, chipMore, h('span.chev', { 'aria-hidden': 'true' }, '▾'));
  box.before(h('div.tracker-chip-wrap', chip));
  function setDrop(open) {
    box.classList.toggle('m-open', open);
    chip.setAttribute('aria-expanded', String(open));
    if (!open) { restWrap.classList.remove('open'); restSum.setAttribute('aria-expanded', 'false'); }
  }
  box.addEventListener('click', () => { if (performance.now() - actedAt < 80) setDrop(false); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && box.classList.contains('m-open')) { e.stopPropagation(); setDrop(false); chip.focus(); }
  });
  function renderChip(goals, story) {
    const g = goals[0];
    if (!g) return;
    const art = g.icon || `glyph:${g.glyph || 'star'}`;
    if (chipArt.dataset.art !== art) {         // re-drawn only when the NOW card changes (render runs every 5 s)
      chipArt.dataset.art = art;
      chipArt.replaceChildren(g.icon ? icon(g.icon, { size: 26 }) : svgIcon(g.glyph || 'star', 24));
    }
    chipTitle.textContent = g.title;
    chip.querySelector('.slot-tag').textContent = slotLabel('now');
    const n = goals.length - 1 + story.length;
    chipMore.textContent = n > 0 ? `+${n}` : '';
    chipMore.hidden = n === 0;
    chip.classList.toggle('bang', goals.some((x) => x.bang && !cardEls.get(keyOf(x))?._el._seen) || story.some((x) => x.bang));
    chip.setAttribute('aria-label', n > 0 ? tr('goals.tr.chip.more', { title: g.title, n }) : tr('goals.tr.chip', { title: g.title }));
  }
  const cardEls = new Map();      // key -> slot wrapper (patched in place: no re-animation, focus survives)
  const keyOf = (g) => `${g.slot}:${g.kind || ''}:${g.id || ''}:${g.icon || g.glyph || ''}`;
  let touchOpen = null;           // a chip opened by a tap: the next tap acts

  /** A painted strip of the story card's chain (art lane Hookup 2: 4:1, focus point, ink gradient). */
  function strip(g) {
    const art = chainArt(g.chain, 600);
    return art ? h('span.goal-strip', { 'aria-hidden': 'true', style: art }) : null;
  }

  function card(g, i) {
    const key = keyOf(g);
    let wrap = cardEls.get(key);
    if (!wrap) {
      const el = h('button.goal', {
        type: 'button', dataset: { slot: g.slot, goal: g.id || g.slot }, style: { animationDelay: `${i * 60}ms` },
        on: {
          pointerdown: (e) => { el._touch = e.pointerType === 'touch'; },
          click: () => {
            const cur = el._g;
            // a tap on a closed chip opens it first; the second tap does what it says (UI-06)
            if (el._touch && wrap.classList.contains('chip') && !wrap.classList.contains('open') && !allOpen()) {
              if (touchOpen && touchOpen !== wrap) touchOpen.classList.remove('open');
              wrap.classList.add('open');
              touchOpen = wrap;
              return;
            }
            if (cur.slot === 'story') openStory(cur); else act(cur);
          },
        },
      }, g.slot === 'story' ? strip(g) : null, h('span.slot-tag', { 'aria-hidden': 'true' }),
      h('span.art', g.icon ? icon(g.icon, { size: 40 }) : svgIcon(g.glyph || 'star', 36)),
      h('span.copy', h('span.gt'), h('span.gs')), h('span.mini', { 'aria-hidden': 'true' }, h('i')));
      wrap = h('div.goal-slot', { dataset: { slot: g.slot } }, el);
      wrap._el = el;
      cardEls.set(key, wrap);
    }
    const el = wrap._el;
    el._g = g;
    const tag = slotLabel(g.slot);
    el.querySelector('.slot-tag').textContent = tag;
    el.querySelector('.gt').textContent = g.title;
    const gs = el.querySelector('.gs');
    gs.textContent = g.sub || '';
    gs.hidden = !g.sub;
    el.setAttribute('aria-label', tr('goals.tr.card', { slot: tag, title: g.title, sub: g.sub || '' }));
    el.classList.toggle('done', Boolean(g.done));
    el.classList.toggle('waiting', Boolean(g.waiting));
    const art = el.querySelector('.art');
    const old = art.querySelector('.ring');
    if (Number.isFinite(g.progress)) {
      const r = ring(g.progress);
      if (old) old.replaceWith(r); else art.append(r);
    } else if (old) old.remove();
    el.querySelector('.mini').hidden = !Number.isFinite(g.progress);
    el.querySelector('.mini > i').style.width = `${Math.round(Math.max(0, Math.min(1, g.progress || 0)) * 100)}%`;
    if (g.bang && !el.querySelector('.bang') && !el._seen) {
      el.append(h('span.bang', { 'aria-hidden': 'true' }, '!'));
      const clear = () => { el._seen = true; markSeen(g.id); el.querySelector('.bang')?.remove(); };
      el.addEventListener('pointerenter', clear, { once: true });
      el.addEventListener('focus', clear, { once: true });
    }
    return wrap;
  }

  function markSeen(id) {
    const s = kv.get(seenKey(), {});
    s[id] = 1;
    kv.set(seenKey(), s);
  }

  function openStory(g) {
    actedAt = performance.now();
    for (const name of ['quests', 'journal']) {
      if (ui.panels.has(name)) { ui.panels.open(name, { tab: 'story', focus: g.id }); return; }
    }
  }

  function render() {
    const state = store.state;
    if (!state) return;
    const now = store.now();
    let goals = null;
    try {
      const res = (rulesGoals || rulesGoalsFn)(state, store.pid, now, { recent: recentKinds(now), keep: lastNow });
      lastNow = res && res.now ? { kind: res.now.kind, id: res.now.id ?? null, ref: res.now.ref ?? null } : null;
      goals = cardsFromGoals(res, state, store.pid, now);
    } catch (err) {
      if (!warned) { console.warn('goals() failed; using the local fallback chain', err); warned = true; }
    }
    if (!Array.isArray(goals) || !goals.length) goals = localGoals(state, store.pid, now);
    // the partner asks to use the coins of my wish: that question is the most urgent thing on my farm (UI-10)
    const ask = wishAskCard(state, store.pid, now);
    if (ask) goals = [ask, ...goals.map((g) => (g.slot === 'now' ? { ...g, slot: 'soon' } : g)).filter((g, k, a) => g.slot !== 'soon' || a.findIndex((x) => x.slot === 'soon') === k)];
    // the treasure this farmer saves Acorns for (wave 4b): after BIG, unless the rules' ranking shows it already
    // (the rules rank one too when nobody picked; a farmer's own pick always shows, once)
    const save = savingCard(state, store.pid, localSaving(store.pid));
    if (save && !goals.some((g) => g.kind === 'relic' && (g.id === save.id || g.target?.args?.focus === save.id))) goals.push(save);
    for (const g of goals) shown.set(g.kind || g.slot, now);
    const seen = kv.get(seenKey(), null);
    const first = seen === null;
    // a quest already on the NOW/SOON/BIG cards is not repeated as a story card
    const onCards = new Set(goals.filter((g) => g.kind === 'quest' && g.target && g.target.args).map((g) => g.target.args.focus));
    const story = storyCards(state, now).filter((c) => !onCards.has(c.id)).map((c) => ({ ...c, slot: 'story', bang: !first && !(seen || {})[c.id] }));
    if (first) kv.set(seenKey(), Object.fromEntries(story.map((c) => [c.id, 1])));
    // a phone opens the tracker as its own drop-down: every card open there (the folded row would be a third tap)
    const phone = Boolean(phoneMq?.matches);
    const compact = !phone && !allOpen();
    box.classList.toggle('compact', compact);
    const goalEls = goals.map(card);
    const storyEls = story.map((g, k) => card(g, goals.length + k));
    goalEls.forEach((w, k) => {
      const chip = compact && k > 0;                  // NOW stays a full card; the rest are chips until opened
      w.classList.toggle('chip', chip);
      if (!chip) w.classList.remove('open');
    });
    for (const w of storyEls) { w.classList.remove('chip', 'open'); }
    let els = goalEls;
    if (compact && storyEls.length) {
      // one chip for the letters: the first one's title, "+N", the rest on hover / focus / tap
      const first = story[0];
      const sum = storyGroup._sum || (storyGroup._sum = h('button.goal.story-sum', { type: 'button', dataset: { slot: 'story' },
        on: { pointerdown: (e) => { storyGroup._touch = e.pointerType === 'touch'; },
          click: () => {
            if (storyGroup._touch && !storyGroup.classList.contains('open')) { touchOpen?.classList.remove('open'); storyGroup.classList.add('open'); touchOpen = storyGroup; return; }
            openStory(storyGroup._first);
          } } },
      h('span.slot-tag', { 'aria-hidden': 'true' }), h('span.art'), h('span.copy', h('span.gt')), h('span.more-n')));
      storyGroup._first = first;
      sum.querySelector('.art').replaceChildren(first.icon ? icon(first.icon, { size: 22 }) : svgIcon('letter', 22));
      sum.querySelector('.gt').textContent = first.title;
      sum.querySelector('.more-n').textContent = storyEls.length > 1 ? `+${storyEls.length - 1}` : '';
      sum.querySelector('.more-n').hidden = storyEls.length < 2;
      sum.querySelector('.slot-tag').textContent = slotLabel('story');
      sum.setAttribute('aria-label', tr('goals.tr.part', { slot: slotLabel('story'), title: story.map((x) => x.title).join(', ') }));
      sum.classList.toggle('bang', story.some((x) => x.bang));
      storyPop.replaceChildren(...storyEls);
      if (sum.parentNode !== storyGroup) storyGroup.replaceChildren(sum, storyPop);
      els = [...goalEls, storyGroup];
    } else {
      els = [...goalEls, ...storyEls];
    }
    if (compact && els.length > 1) {
      // the rows under NOW go into the folded row's pop-out (moved only when the list changed: no replayed slide-ins)
      const rest = els.slice(1);
      if (rest.some((el, k) => restPop.children[k] !== el) || restPop.children.length !== rest.length) restPop.replaceChildren(...rest);
      const { segs, label } = restSummary(goals.slice(1), story);
      const bang = goals.slice(1).some((g) => g.bang && !cardEls.get(keyOf(g))?._el._seen) || story.some((x) => x.bang);
      const sig = JSON.stringify([segs, bang]);
      if (sig !== restSig) {
        restSig = sig;
        restSum.querySelector('.segs').replaceChildren(...segs.map((x) => (x.letters
          ? h('span.seg', { dataset: { slot: x.slot } }, h('span.tag.letters', svgIcon('letter', 18), x.tag))
          : h('span.seg', { dataset: { slot: x.slot } }, h('span.tag', x.tag), x.icon ? icon(x.icon, { size: 22 }) : svgIcon(x.glyph, 22)))));
        restSum.classList.toggle('bang', bang);
      }
      restSum.setAttribute('aria-label', label);
      els = [els[0], restWrap];
    } else {
      restWrap.classList.remove('open');
      restSum.setAttribute('aria-expanded', 'false');
    }
    // minimal DOM moves: an unchanged card is never re-inserted (that would replay its slide-in animation)
    const live = new Set(els);
    for (const el of [...box.children]) if (!live.has(el) && el !== foot) el.remove();
    els.forEach((el, k) => { if (box.children[k] !== el) box.insertBefore(el, box.children[k] || null); });
    const kept = new Set([...els, ...goalEls, ...storyEls]);
    for (const [k, el] of cardEls) if (!kept.has(el)) cardEls.delete(k);
    const nowEl = goalEls[0]?._el;
    if (nowEl && modeBtn.parentNode !== nowEl.parentNode) nowEl.after(modeBtn);
    // never let the column run into the feed: hide the story cards that do not fit and say how many more
    for (const el of els) el.hidden = false;
    const scale = (S.settings && S.settings.scale ? S.settings.scale() : 100) / 100;
    const limit = innerHeight - 270 * scale;          // rects are screen px under zoom
    let hidden = 0;
    for (const el of els) {
      if (!compact && !phone && el.dataset.slot === 'story' && el.getBoundingClientRect().bottom > limit) { el.hidden = true; hidden++; }
    }
    more.textContent = tr('goals.tr.more', { n: hidden });
    more.hidden = hidden === 0;
    modeBtn.setAttribute('aria-label', tr(compact ? 'goals.tr.mode.all' : 'goals.tr.mode.fewer'));
    modeBtn.dataset.tip = tr(compact ? 'goals.tr.mode.allTip' : 'goals.tr.mode.fewerTip');
    modeBtn.setAttribute('aria-pressed', String(!compact));
    if (!more.hidden) box.append(foot); else foot.remove();
    renderChip(goals, story);
  }
  // a tap elsewhere closes a chip opened by a tap
  document.addEventListener('pointerdown', (e) => {
    if (box.classList.contains('m-open') && !box.contains(e.target) && !chip.contains(e.target)) setDrop(false);
    if (touchOpen && !touchOpen.contains(e.target)) { touchOpen.classList.remove('open'); touchOpen = null; }
    if (restWrap.classList.contains('open') && !restWrap.contains(e.target)) {
      restWrap.classList.remove('open');
      restSum.setAttribute('aria-expanded', 'false');
    }
  }, true);

  let raf = 0;
  let trail = null;
  let rankedAt = -Infinity;
  const run = () => { raf = 0; rankedAt = performance.now(); render(); };
  const soon = () => {
    if (raf) return;
    const wait = rankWait({ rankedAt, now: performance.now() });
    if (wait === 0) { clearTimeout(trail); trail = null; raf = requestAnimationFrame(run); return; }
    if (!trail) trail = setTimeout(() => { trail = null; if (!raf) raf = requestAnimationFrame(run); }, wait);
  };
  for (const t of ['objects', 'xp', 'wallet', 'quests', 'expansions', 'orders', 'inventory', 'challenge', 'ribbons', 'mastery', 'players', 'wishlist', 'relics']) store.subscribe(t, soon);
  // "Save for this" in the Acorn shop (this browser's choice) shows at once
  window.addEventListener('hh-saving', soon);
  clearInterval(timer);
  timer = setInterval(soon, 5000);          // "next ready in 2:41" ticks down; ready crops appear without a delta
  window.addEventListener('resize', soon);
  S.settings?.on?.(soon);

  return {
    render,
    /** rules-goals' ranking function (state, pid, now) -> goals in the localGoals() shape. */
    useRulesGoals(fn) { rulesGoals = typeof fn === 'function' ? fn : null; soon(); },
  };
}
