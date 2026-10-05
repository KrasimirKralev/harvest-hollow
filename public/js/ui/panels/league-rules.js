// The ui-league lane's ONE door to the M2 goals rules (wave 3): the Fair NPC league and Platinum, the horse show, the
// Seasonal Ribbon Track, perks and rested XP, Legacy levels and the Friendly Duel. DOM-free, pure readers over a state.
//
// Every number here comes from the rules-goals lane's own helpers (shared/rules/actions/{league,perks,rested,track,
// legacy,duel,fair}.js): the panels never read a state path of an M2 system themselves and never redo a rule, so a
// preview cannot disagree with what the server does. The rules modules are read through namespace imports, so a helper
// that is renamed or not there yet makes its system read as "not open" instead of breaking the page; the buttons ask
// the action's own `check` (core.probe) under the names in ACT.
// core.js first: it loads the rules' registry (shared/rules/index.js), the entry that resolves the rules' import cycles.
import { pick } from './core.js';
import {
  FAIR, PERKS, SEASONAL_TRACK, LEGACY, DUEL, BREEDING, animalOf, itemOf, featureOf, isLive, levelFromXp, xpForLevel,
  personalLevelFromXp,
} from '../../../../shared/content/index.js';
import { MAX_LEVEL as MAX_LEVEL_CFG } from '../../../../shared/content/config.js';
import * as FR from '../../../../shared/rules/actions/fair.js';
import * as LG from '../../../../shared/rules/actions/league.js';
import * as PK from '../../../../shared/rules/actions/perks.js';
import * as RS from '../../../../shared/rules/actions/rested.js';
import * as TR from '../../../../shared/rules/actions/track.js';
import * as LE from '../../../../shared/rules/actions/legacy.js';
import * as DU from '../../../../shared/rules/actions/duel.js';
import * as CO from '../../../../shared/rules/coop.js';
import { available } from '../../../../shared/rules/economy.js';

const { systemLive, weekOf } = CO;
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const int = (v, d = 0) => (Number.isSafeInteger(v) ? v : d);
const fn = (mod, name) => (typeof mod?.[name] === 'function' ? mod[name] : null);

// ---- actions --------------------------------------------------------------------------------------------------------

/** The action names the panels send (the first one the build registers wins; core.pick). */
export const ACT = Object.freeze({
  fairEnter: ['fairEnter'],
  showEnter: ['horseShowEnter', 'fairEnter'],
  trackClaim: ['trackClaim'],
  perkPick: ['perkPick'],
  perkRespec: ['perkRespec'],
  duelInvite: ['duelInvite'],
  duelAccept: ['duelAccept'],
  duelDecline: ['duelDecline'],
  duelCancel: ['duelCancel'],
  markSeen: ['markSeen'],
});

/** The args each action takes (the rules' schemas). */
export const ARGS = Object.freeze({
  fairEnter: (item, qty) => ({ item, qty }),
  showEnter: (item, qty) => ({ item, qty }),
  trackClaim: (tier) => ({ tier }),
  perkPick: (tree) => ({ tree }),
  perkRespec: () => ({}),
  duelInvite: (kind) => ({ kind }),
  duelAccept: () => ({}),
  duelDecline: () => ({}),
  duelCancel: () => ({}),
  duelSeen: (end) => ({ kind: 'duel', id: String(end) }),
});

/** The registered action type for a key of ACT, else its first name (its probe answers "Not open yet"). */
export const actFor = (key) => pick(...ACT[key]) ?? ACT[key][0];
/** True when the build registers an action for this key. */
export const canAct = (key) => pick(...ACT[key]) !== null;

// ---- small shared readers ---------------------------------------------------------------------------------------

export const levelOf = (state) => levelFromXp(state?.farm?.xp ?? 0);

/** A feature (features.js) plays in this build: its milestone is live (or a test forced it). */
export function featureLive(id) {
  const f = featureOf(id);
  return Boolean(f) && (isLive(f) || systemLive(f));
}

/** The level a feature unlocks at (features.js), else `d`. */
export const featureLevel = (id, d = 1) => featureOf(id)?.unlock ?? d;

/** The current Fair week's open and close (Monday 00:00, Sunday 20:00 in the farm's zone). */
export function fairWindow(state, now) {
  const cur = state.farm.fair?.cur;
  const w = cur && cur.open ? cur.w : weekOf(state, now);
  return { w, openAt: FR.fairOpenAt(state, w), closeAt: FR.fairCloseAt(state, w) };
}

// ---- the County Fair NPC league (GDD §5.6; league.js) ---------------------------------------------------------------

export const LEAGUE = FAIR.league;

/** League names, lowest first (content FAIR.league.names). */
export const LEAGUE_NAMES = Object.freeze(Array.isArray(LEAGUE?.names) && LEAGUE.names.length
  ? [...LEAGUE.names] : Array.from({ length: LEAGUE?.leagues ?? 5 }, (_, i) => `League ${i + 1}`));

export const leagueName = (tier) => LEAGUE_NAMES[Math.min(Math.max(1, tier), LEAGUE_NAMES.length) - 1];

/** The NPC farm of a name (content FAIR.league.npcs: farmer, hue, motto), with its index. */
export function npcFarm(name) {
  const i = LEAGUE.farms.indexOf(name);
  const n = Array.isArray(LEAGUE.npcs) ? LEAGUE.npcs.find((x) => x.name === name) ?? LEAGUE.npcs[i] : null;
  return { i, name, farmer: n?.farmer ?? '', hue: n?.hue ?? null, motto: n?.motto ?? '' };
}

/** The league plays in this build and the farm has its level (L27). */
export const leagueOpen = (state) => Boolean(fn(LG, 'leagueUnlocked')?.(state));

/** The highest league the farm may reach now (the top one needs the Town Fair Grounds). */
export const leagueMax = (state) => fn(LG, 'topTier')?.(state) ?? LEAGUE.leagues - 1;

/** Acorns a week in league `tier` pays. */
export const leagueAcorns = (tier) => tier * (LEAGUE.acornsPerTier ?? 1);

/** Past weeks, newest first: league.js Result { w, tier (played in), rank, p, W, move, acorns, to, npc }. */
export function leagueHistory(state) {
  const h = state.farm.league?.hist;
  return (Array.isArray(h) ? h.filter(isObj) : []).slice().reverse();
}

/**
 * This week's league table: the rules' leagueTable (NPC scores grow with the clock, their finals at the ceremony)
 * plus what the couple needs by Sunday against the NPC FINALS (what the ceremony ranks against):
 * { tier, best, top, w, W, open, rows: [{ key, name, p10, us, rank, zone, npc }], us, rank, acorns, last,
 *   upTo10 (more points that secure a promotion place), safe10 (more points that leave the last place), finals,
 *   closesAt }. null when the league is not open.
 */
export function leagueTable(state, now) {
  const f = fn(LG, 'leagueTable');
  if (!f || !leagueOpen(state)) return null;
  const win = fairWindow(state, now);
  const t = f(state, now, win.openAt, win.closeAt);
  if (!t) return null;
  const rows = t.rows.map((r, k) => {
    const us = Boolean(r.farm);
    return { key: us ? 'farm' : `npc:${r.name}`, name: us ? (state.farm.name || 'Your farm') : r.name, p10: r.p10, us,
      rank: k + 1, zone: r.zone ?? null, npc: us ? null : npcFarm(r.name) };
  });
  const us = rows.find((r) => r.us) ?? null;
  const cur = state.farm.fair?.cur;
  const W = cur && cur.w === t.w ? cur.W : null;
  // the NPC finals of the week, best first: the couple reaches rank r with p >= the r-th best final (a tie is theirs)
  const finals = W !== null && fn(LG, 'npcFinals') ? LG.npcFinals(state, t.w, W, t.tier).slice().sort((a, b) => b - a) : [];
  const p = us ? us.p10 : 0;
  const live = t.open && finals.length > 0;
  const upTo10 = live && t.tier < t.top ? Math.max(0, finals[LEAGUE.promote - 1] - p) : 0;
  const safe10 = live && t.tier > 1 ? Math.max(0, finals[finals.length - 1] - p) : 0;
  return { ...t, W, rows, us, rank: us ? us.rank : rows.length, finals, upTo10, safe10,
    secured: live && t.tier < t.top && p > 0 && upTo10 === 0, closesAt: win.closeAt, openAt: win.openAt };
}

// ---- Platinum (GDD §5.6: 1.40 × W, needs Restoration project 5) ------------------------------------------------

export const PLATINUM = FAIR.medals.find((m) => m.id === 'platinum') ?? null;

/**
 * Platinum: { live, open (its project is restored), project, W, p10, need10, toGo10, got, coins, acorns, goldenHourMs,
 * buff: { from, until } | null (the Golden Hour it paid), isOpen }.
 */
export function platinumOf(state, now) {
  const live = Boolean(PLATINUM) && systemLive(PLATINUM);
  const open = live && (fn(LG, 'platinumOpen') ? Boolean(LG.platinumOpen(state)) : FR.liveMedals(state).some((m) => m.id === 'platinum'));
  const cur = state.farm.fair?.cur;
  const thisWeek = Boolean(cur && cur.w === weekOf(state, now));
  const W = thisWeek ? cur.W : FR.fairTarget(Math.max(FAIR.unlock, levelOf(state)));
  const p10 = thisWeek ? int(cur.p) : 0;
  const need10 = PLATINUM ? FR.medalNeed10(PLATINUM, W) : 0;
  const b = state.farm.coop?.platinum;
  return { live, open, project: PLATINUM?.needsProject ?? null, W, p10, need10, toGo10: Math.max(0, need10 - p10),
    got: open && p10 >= need10, coins: PLATINUM ? FR.medalCoins(PLATINUM, W) : 0, acorns: PLATINUM?.acorns ?? 0,
    goldenHourMs: PLATINUM?.goldenHourMs ?? 0, buff: isObj(b) && int(b.until) > now ? { from: b.from, until: b.until } : null,
    isOpen: Boolean(FR.openFair(state, now)) };
}

// ---- the horse show (GDD §3.4 Horse, §5.6) ----------------------------------------------------------------------

export const SHOW_ITEM = FAIR.horseShow?.item ?? 'show_ribbon';

/** The horse show is part of this build and the farm has its level (feature horse_show, L25). */
export const horseShowOpen = (state) => featureLive('horse_show') && FR.fairUnlocked(state)
  && levelOf(state) >= (FAIR.horseShow?.unlock ?? FAIR.points.horseShowFrom ?? 25);

/** The farm's horses, ribboned first: [{ id, name, adult, cycle, prizedAt, prized, home, ready }]. */
export function horsesOf(state, now) {
  const def = animalOf('horse');
  if (!def) return [];
  const out = [];
  for (const id of Object.keys(state.farm.objects).sort()) {
    const o = state.farm.objects[id];
    if (o.def !== 'horse') continue;
    const cycle = int(o.cycle);
    out.push({ id, name: state.farm.names?.[id]?.name ?? null, adult: int(o.adultAt) <= now, cycle,
      prizedAt: def.prizedAt, prized: cycle >= def.prizedAt, home: o.home ?? null,
      ready: Number.isSafeInteger(o.readyAt) && o.readyAt <= now, coat: o.coat ?? null });
  }
  return out.sort((a, b) => Number(b.prized) - Number(a.prized) || b.cycle - a.cycle || (a.id < b.id ? -1 : 1));
}

/** The show ring this week: { open, isOpen, each (points ×10 a Show Ribbon), have, entered, cap, left, mul, chanceBp }. */
export function showOf(state, now) {
  const open = horseShowOpen(state);
  const cur = FR.openFair(state, now);
  const each = FR.entryPoints10(state, SHOW_ITEM);
  const cap = FR.entryLimit(state);
  const entered = cur ? int(cur.ent?.[SHOW_ITEM]) : 0;
  const def = animalOf('horse');
  return { open, isOpen: Boolean(cur), each, have: available(state, SHOW_ITEM), entered, cap, left: Math.max(0, cap - entered),
    mul: open ? FAIR.points.horseShowMul : 1, chanceBp: def?.premiumBp ?? 0, item: itemOf(SHOW_ITEM) };
}

// ---- the Seasonal Ribbon Track (GDD §5.9; track.js) ----------------------------------------------------------------

/** The level the Seasonal Ribbon Track opens at (L24). */
export const SEASONAL_TRACK_UNLOCK = SEASONAL_TRACK?.unlock ?? 24;

export const SEASON_NAMES = Object.freeze({ spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' });
const SEASON_FIRST_MONTH = { spring: 3, summer: 6, autumn: 9, winter: 12 };

export const trackOpen = (state) => Boolean(fn(TR, 'trackUnlocked')?.(state));

/** The season's coat of a season ('autumn' -> { id: 'russet', hue }). */
export const seasonCoatOf = (season) => BREEDING.seasonCoats?.find((c) => c.season === season) ?? null;

/**
 * The track this season, the rules' trackView + { name, start, end (ms), coatDef (the season's coat) }:
 * { open, s, season, L, need, xp, tier, tiers: [{ n, at, reward, got, reached, claimable }], toNext, inTier,
 *   claimable, leftoverCoins, endsAt, coats }. null when the rules have no track.
 */
export function trackOf(state, now) {
  const v = fn(TR, 'trackView') ? TR.trackView(state, now) : null;
  if (!v) return null;
  const y = Number(String(v.s ?? '').split('-')[0]) || new Date(now).getUTCFullYear();
  const start = CO.localAt(state.meta.tz, CO.dayOfCivil(y, SEASON_FIRST_MONTH[v.season] ?? 9, 1), 0);
  return { ...v, name: SEASON_NAMES[v.season] ?? 'Season', start, end: v.endsAt, coatDef: seasonCoatOf(v.season) };
}

// ---- perks and rested XP (GDD §4.7; perks.js, rested.js) -------------------------------------------------------------

export const TREE_ORDER = Object.freeze(Array.isArray(PK.PERK_TREES) ? [...PK.PERK_TREES] : Object.keys(PERKS.trees));
export const TREE_NAMES = Object.freeze({ grower: 'Grower', rancher: 'Rancher', orchardist: 'Orchardist', artisan: 'Artisan' });

const pct = (bp) => `${(bp / 100).toFixed(bp % 100 ? 1 : 0)} %`;

/** The words of one perk effect (content PERKS.trees[tree][i]), as the GDD §4.7 table says it. */
export function perkText(tree, i, fx = PERKS.trees[tree]?.[i] ?? {}) {
  const [k, v] = Object.entries(fx)[0] ?? [];
  switch (k) {
    case 'cropXpBp': return `+${pct(v)} XP from crops`;
    case 'animalXpBp': return `+${pct(v)} XP from animals`;
    case 'treeXpBp': return `+${pct(v)} XP from trees`;
    case 'craftXpBp': return `+${pct(v)} XP from workshops`;
    case 'seedBp': return `Seeds cost ${pct(v)} less`;
    case 'bonusUnitBp': return `${pct(v)} chance of +1 crop`;
    case 'waterBp': return `Watering cuts ${pct(v)} more time`;
    case 'ribbonBp': return `+${v / 100} points of blue-ribbon chance`;
    case 'babyBp': return `Babies grow ${pct(v)} faster`;
    case 'doubleBp': return tree === 'artisan' ? `${pct(v)} chance of a double output` : `${pct(v)} chance of a double product`;
    case 'freeFeedBp': return `${pct(v)} chance a tend uses no feed`;
    case 'prizedSoonerBp': return `Blue ribbons after ${pct(v)} fewer collections`;
    case 'treeWaterBp': return `Tree watering cuts ${pct(v)} more time`;
    case 'bonusFruitBp': return `${pct(v)} chance of +1 fruit`;
    case 'treeCostBp': return `Trees cost ${pct(v)} less`;
    case 'heirloomAt': return `Heirloom after ${v} harvests instead of 60`;
    case 'queueTimeBp': return `Your queued items take ${pct(v)} less time`;
    case 'craftSellBp': return `+${pct(v)} on crafted goods you sell`;
    case 'duetSecondBp': return `Duets: ${pct(v)} chance of a second output`;
    default: return k ? `${k} ${v}` : '';
  }
}

/** A short name per perk (the card title). */
export const PERK_NAMES = Object.freeze({
  grower: ['Green Thumb', 'Seed Saver', 'Bumper Rows', 'Rain Dancer', 'Blue-Ribbon Eye'],
  rancher: ['Barn Friend', 'Little Ones', 'Plenty Pen', 'Light Eater', 'Show Stock'],
  orchardist: ['Branch Reader', 'Deep Roots', 'Full Basket', 'Nursery Deal', 'Heirloom Keeper'],
  artisan: ['Steady Hands', 'Quick Batch', 'Double Batch', 'Market Smile', 'Duet Magic'],
});

/** Perks play in this build (their milestone and feature), whatever the level. */
export const perksLiveBuild = () => Boolean(PERKS) && systemLive(PERKS);

/** Perks play on this farm now (perks.js perksLive: the milestone and the feature's level). */
export const perksOpen = (state) => Boolean(fn(PK, 'perksLive')?.(state));

/**
 * Everything the perk panel draws, from the rules' perksView: { live, level (personal), nextPoint, points, spent,
 * free, max, trees: [{ id, name, owned, cost, perks: [{ i, cost, text, name, owned, next, afford }] }], owned,
 * respecAt (0 = a free respec now), respecFree, anyOwned }. null when perks are not in this build or no player.
 */
export function perksOf(state, pid, now) {
  if (!fn(PK, 'perksView') || !state.players?.[pid]) return null;
  const v = PK.perksView(state, pid, now);
  const level = personalLevelFromXp(int(state.players[pid].xp));
  const owned = {};
  const trees = v.trees.map((t) => {
    owned[t.id] = t.n;
    return { id: t.id, name: TREE_NAMES[t.id] ?? t.id, owned: t.n, cost: PERKS.costs.reduce((a, c) => a + c, 0),
      perks: t.perks.map((p) => ({ i: p.i, cost: p.cost, text: perkText(t.id, p.i, p.effect), name: PERK_NAMES[t.id]?.[p.i] ?? `Perk ${p.i + 1}`,
        owned: p.owned, next: p.next, afford: p.affordable })) };
  });
  const nextPoint = v.points >= PERKS.maxPoints ? null : (v.points + 1) * PERKS.pointsEvery;
  return { live: v.live, level, nextPoint, points: v.points, spent: v.spent, free: v.free, max: PERKS.maxPoints,
    trees, owned, respecAt: v.respecAt, respecFree: !(v.respecAt > now), anyOwned: v.spent > 0 };
}

/** Rested XP of a player: { live, xp, cap } (cap = 150 % of a personal level's requirement). */
export function restedOf(state, pid) {
  const p = state.players?.[pid];
  const live = Boolean(fn(RS, 'restedLive')?.(state));
  if (!p || !live) return { live, xp: 0, cap: 0 };
  const cap = fn(RS, 'restedCapOf') ? RS.restedCapOf(int(p.xp)) : fn(RS, 'restedCap') ? RS.restedCap(state, pid) : 0;
  const xp = fn(RS, 'restedXp') ? RS.restedXp(state, pid) : fn(RS, 'restedOf') ? RS.restedOf(state, pid) : 0;
  return { live, xp: cap ? Math.min(xp, cap) : xp, cap };
}

// ---- Legacy levels (GDD §4.6, §5.9; legacy.js) ---------------------------------------------------------------------

export const MAX_LEVEL = MAX_LEVEL_CFG;
const legacyFrom = () => fn(LE, 'legacyFrom')?.() ?? LEGACY?.from ?? MAX_LEVEL + 1;

export const legacyOpen = (state) => Boolean(fn(LE, 'legacyLive')?.()) && featureLive('legacy')
  && levelOf(state) >= featureLevel('legacy', MAX_LEVEL);

/** Legacy levels play in this build (whatever the level). */
export const legacyLiveBuild = () => Boolean(fn(LE, 'legacyLive')?.()) && featureLive('legacy');

/** The reward of the n-th Legacy level (n = 1 for level 41). */
export const legacyReward = (n) => fn(LE, 'legacyReward')?.(n) ?? {};

/**
 * Legacy: { open, level, n (Legacy levels reached), from (the first Legacy level), step (XP a level), into, toNext,
 * toLegacy, next: [{ n, L, reward }], rows: [{ n, L, at, by, reward }] newest first }.
 */
export function legacyOf(state) {
  const level = levelOf(state);
  const from = legacyFrom();
  const n = fn(LE, 'legacyLevel')?.(state) ?? Math.max(0, level - from + 1);
  const step = xpForLevel(MAX_LEVEL + 1) - xpForLevel(MAX_LEVEL);
  // the next Legacy level is level from + n (n reached so far); before Legacy, level `from` itself
  const nextAt = xpForLevel(from + n);
  const xp = int(state.farm.xp);
  const into = Math.max(0, Math.min(step, step - (nextAt - xp)));
  const rows = fn(LE, 'legacyRows') ? LE.legacyRows(state) : [];
  const next = [];
  for (let k = n + 1; k <= n + 5; k++) next.push({ n: k, L: from + k - 1, reward: legacyReward(k) });
  return { open: legacyOpen(state), level, n, from, step, into, toNext: Math.max(0, nextAt - xp),
    toLegacy: Math.max(0, xpForLevel(from) - xp), next, rows: rows.filter(isObj).slice().reverse() };
}

// ---- the Friendly Duel (GDD §6.2 "Also"; duel.js) -------------------------------------------------------------------

/** The duel kinds (content DUEL.kinds: id, name, text, unlock, scale) with a picture each. */
const KIND_ICON = { pumpkins: 'pumpkin', pies: 'apple_pie', orders: 'order_board' };
export const duelKinds = () => (fn(DU, 'duelKinds')?.() ?? DUEL?.kinds ?? []).map((k) => ({ ...k, icon: KIND_ICON[k.id] ?? 'ribbon_rosette' }));
export const duelKind = (id) => duelKinds().find((k) => k.id === id) ?? { id, name: 'Friendly Duel', text: '', scale: 1, icon: 'ribbon_rosette' };

/** A score as the duel counts it ("3", "2¼": the order kind stores quarters, its scale 4). */
export function duelScoreText(n, scale = 1) {
  const s = Math.max(1, scale | 0);
  const v = Math.max(0, n | 0);
  const whole = Math.floor(v / s);
  const q = v % s;
  if (!q) return String(whole);
  const frac = s === 4 ? ['', '¼', '½', '¾'][q] : s === 2 ? '½' : `.${String(Math.round((q * 100) / s)).padStart(2, '0')}`;
  return `${whole || (s === 4 || s === 2 ? '' : '0')}${frac}`;
}

export const duelOpen = (state) => Boolean(fn(DU, 'duelUnlocked')?.(state));

/** Duels play in this build (whatever the level or the number of farmers). */
export const duelLiveBuild = () => Boolean(DUEL) && systemLive(DUEL);

/** True when a duel kind is open at the farm's level (content DUEL.kinds[].unlock). */
export const kindOpen = (state, k) => levelOf(state) >= (k.unlock ?? 1);

/**
 * The duel as one player sees it (duel.js duelOf + words): { open, phase 'none' | 'asked' | 'invited' | 'live' |
 * 'over', kind, me, them, mine, theirs, start, end, by, lead, last: { kind, s, win, tie, end, scored, mine, theirs },
 * unseen, crown: [pids], lapseAt, n }.
 */
export function duelOf(state, pid, now) {
  const d = fn(DU, 'duelOf')?.(state, pid, now) ?? null;
  const open = duelOpen(state);
  if (!d) {
    return { open, phase: 'none', kind: null, me: pid, them: null, mine: 0, theirs: 0, start: 0, end: 0, by: null, at: 0,
      lapseAt: null, lead: 'tie', last: null, unseen: false, crown: [], n: 0 };
  }
  const cur = d.cur;
  let last = null;
  if (d.last) {
    const other = d.them ?? Object.keys(d.last.s ?? {}).find((p) => p !== pid) ?? null;
    last = { ...d.last, kind: duelKind(d.last.kind), mine: int(d.last.s?.[pid]), theirs: other ? int(d.last.s?.[other]) : 0, other };
  }
  return { open, phase: d.phase, kind: cur && d.phase !== 'none' ? duelKind(cur.kind) : null, me: pid, them: d.them,
    mine: d.mine, theirs: d.theirs, start: int(cur?.start), end: int(cur?.end), by: cur?.by ?? null, at: int(cur?.at),
    lapseAt: d.lapseAt, lead: d.mine > d.theirs ? 'me' : d.theirs > d.mine ? 'them' : 'tie', last, unseen: d.unseen,
    crown: Array.isArray(d.crown) ? d.crown : [], n: d.n ?? 0 };
}

/** The players wearing the duel crown now. */
export const crownsOf = (state, now) => fn(DU, 'crownsOf')?.(state, now) ?? [];

export { DUEL };
