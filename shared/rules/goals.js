// The goals state block (createFarm / createPlayer / validateState call these from their rules-goals markers) and
// the Goal Tracker (GDD §5.1: three cards per player, NOW / SOON / BIG, never empty). Owned by rules-goals.
//
// Farm keys (GOALS_FARM_KEYS):
//   orders     Mabel's board (orders-board.js header)          quests     story cards (actions/quests.js header)
//   ribbons    F/T ribbon tiers (actions/ribbons.js)            daily      day/week, gift, Farm Weeks, Together task
//   challenge  the Couple Challenge (daily.js)                  coop       bench, Golden Hour window, high-five slot,
//                                                                          combo meter, who named the farm
//   feed       the activity feed ring (feed.js)                 notes      { [id]: { by, at, text, x, z } }
//   tut        the farm's tutorial steps (actions/tutorial.js)  stars      { [masteryKey]: stars paid } (progress.js)
//   names      { [animalObjId]: { name, by, at } }  named animals (actions/social.js)
//   fair       the County Fair (actions/fair.js)                barge      the River Barge (actions/barge.js)
//   album      collections (actions/album.js)                   folk       townsfolk board + Friendship (folk.js)
//   made       { [item]: farm day last made } (progress.js)     memory     the Memory Book (actions/memory.js)
//   M2 (wave 3): league  the Fair NPC league (actions/league.js)    track   the Seasonal Ribbon Track (track.js)
//                duel    the Friendly Duel (duel.js)                  legacy  Legacy rewards paid (legacy.js)
//                grandma Grandma's visit (grandma.js)
// Player keys (GOALS_PLAYER_KEYS):
//   play  { m, n, d, card }   almanac (daily.js)   caps { d, <key>: n } daily caps (coop.js)   ribbons { id: {t, at} }
//   title null | ribbonId     tut (tutorial.js)    spark: ms until the High-five Spark ends (0 = none)
//   shelf { n, rows }  keepsakes received (ring of 24)   seen { lvl, cards, beats, tips }  per-player seen flags
//   M2: perks { t: { tree: n }, r } (actions/perks.js)   rested { xp, at } rested XP (actions/rested.js)
import {
  CONTENT, ORDERS, COOP, FEED, TUTORIAL, ALMANAC, isLive, itemOf, questOf, ribbonOf, cropOf, recipeOf, recipesOf,
  levelFromXp, xpForLevel, unlocksAt, liveAt, MASTERY, BOOSTS, BARGE, TOWNSFOLK, MEDAL_RANKS,
  FAIR, MILESTONE, DUEL, NURSERY, BREEDING, animalOf, expansionOf, homeOf,
} from '../content/index.js';
import { PLAYER_SLOTS } from '../content/config.js';
import { dayOf, systemLive } from './coop.js';
import { initialQuests, taskProgress, isStateTask, blockerOf } from './actions/quests.js';
import { initialDaily, initialChallenge, initialPlayerPlay, initialAlmanac, almanacLiveSlot } from './daily.js';
import { initialTut, initialFarmTut } from './actions/tutorial.js';
import { feedRows } from './feed.js';
import { fillable, producers } from './orders-board.js';
import { hasSpot, objectsByDef, capacityOf, homeMaxOf } from './grid.js';
import { sortedKeys } from './order.js';
import { available, barnCap, canIntake } from './economy.js';
import { ribbonValue } from './actions/ribbons.js';
import { masteryDef, starsOf } from './progress.js';
import { buyPrice } from './actions/decor.js';
import { slotPrice } from './actions/crafting.js';
import { nextExpansion, proofProgress } from './actions/expansions.js';
import { basketCode } from './actions/farming.js';
import { enterable, fairStanding, openFair, medalRank } from './actions/fair.js';
import { dockedBarge, bargeView } from './actions/barge.js';
import { folkView } from './actions/folk.js';
import { albumView, albumUnlocked } from './actions/album.js';
import { MEMORY } from './actions/memory.js';
import { openProject, slotNeed, slotHave, bundleDone } from './actions/restoration.js';
import { beautyLive, beautyOf } from './actions/beauty.js';
import { petsLive, petOf, petKind } from './actions/pets.js';
import { initialLeague, leagueUnlocked, LEAGUE } from './actions/league.js';
import { initialTrack, trackView } from './actions/track.js';
import { initialDuel, duelOf, duelUnlocked } from './actions/duel.js';
import { initialLegacy, legacyLive, legacyFrom, legacyReward } from './actions/legacy.js';
import { initialPerks, perksView, PERK_TREES } from './actions/perks.js';
import { initialRested } from './actions/rested.js';
import { grandmaView } from './actions/grandma.js';
import { nurseryOpen, breedingOpen, nextCareStep, nextCareAt, breedingOf, cardOpen } from './actions/breeding.js';
import { fishingSpots, nextCastAt, lineOf } from './actions/fishing.js';
import { homesWithRoom } from './actions/animals.js';
import { upgradeView } from './actions/upgrades.js';
import { UPGRADES, UPGRADE_TARGETS, upgradeTargetOf, tierOf } from './upgrades.js';
import { GRID_VERSION, hide } from './grid-cache.js';
import { FERTILIZER, fertilizerLive } from './actions/farming.js';
import { relicView } from './relics.js';
import { cratesOn } from './actions/crates.js';
import { farmhandTargets, turnerTargets } from './actions/relics.js';
import {
  GOALS_RULES_EN, msg, said, enText, int, name, qtyRef, noun, ms, pts as ptsRef, ctextRef, join, sub, nameOf,
  mmss as mmssEn, taskMsg, taskLabelMsg, moreMsg, almanacMsg, duelRef,
} from './goal-text.js';

export const GOALS_FARM_KEYS = Object.freeze(['orders', 'quests', 'ribbons', 'daily', 'challenge', 'coop', 'feed',
  'notes', 'tut', 'stars', 'names', 'fair', 'barge', 'album', 'folk', 'made', 'memory',
  'league', 'track', 'duel', 'legacy', 'grandma']);
export const GOALS_PLAYER_KEYS = Object.freeze(['play', 'almanac', 'caps', 'ribbons', 'title', 'tut', 'spark', 'shelf',
  'seen', 'perks', 'rested']);

/** The goals fields of a fresh farm (createFarm). `tz` is the farm's zone (the calendar needs it). */
export function createGoalsFarm(now, tz) {
  const s = { meta: { tz } };
  return {
    orders: { n: 0, slots: {}, recent: [], golden: -1, goldenN: 0, rush: null, meter: null },
    quests: initialQuests(now),
    ribbons: {},
    daily: initialDaily(s, now),
    challenge: initialChallenge(),
    coop: { bench: {}, golden: null, goldenAt: null, hf: null, hfAt: null, combo: null, named: null },
    feed: { n: 0, rows: {} },
    notes: {},
    tut: initialFarmTut(),
    stars: {},
    names: {},
    // M1b (wave 2): shapes in actions/fair.js, barge.js, album.js, folk.js headers; `made` = { [item]: farm day }
    fair: { cur: null, last: null, unseen: {} },
    barge: { t: 1, streak: 0, w: -1, docked: false, rows: 0, crates: {}, paid: {}, next: null,
      play: { w: -1, m: -1, n: 0, prev: -1 }, log: null },
    album: { sets: {} },
    folk: { w: -1, n: 0, posts: {}, f: {}, cards: {} },
    made: {},
    memory: { n: 0, season: null, rows: {} },
    // M2 (wave 3): shapes in actions/league.js, track.js, duel.js, legacy.js, grandma.js headers
    league: initialLeague(),
    track: initialTrack(),
    duel: initialDuel(),
    legacy: initialLegacy(),
    grandma: null,
  };
}

/** The goals fields of a fresh player (createPlayer). */
export function createGoalsPlayer() {
  return {
    play: initialPlayerPlay(),
    almanac: initialAlmanac(),
    caps: { d: -1 },
    ribbons: {},
    title: null,
    tut: initialTut(),
    spark: 0,
    shelf: { n: 0, rows: {} },
    seen: { lvl: 1, cards: {}, beats: {}, tips: {} },
    perks: initialPerks(),
    rested: initialRested(),
  };
}

// ---- validation ---------------------------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
const isInt = (n) => Number.isSafeInteger(n);
const isPid = (p) => PLAYER_SLOTS.includes(p);
const isActor = (p) => p === 'sys' || isPid(p);
const isBool = (b) => typeof b === 'boolean';
const optPid = (p) => p === null || isPid(p);
const counts = (o) => isObj(o) && Object.values(o).every(isCount);

function validOrder(o) {
  if (!isObj(o) || !isCount(o.n) || !isObj(o.items) || Object.keys(o.items).length === 0) return false;
  for (const [i, q] of Object.entries(o.items)) if (!itemOf(i) || !isCount(q) || q === 0) return false;
  if (![o.coins, o.xp, o.value, o.at].every(isCount) || !isBool(o.simple)) return false;
  return o.golden === null || (isObj(o.golden) && typeof o.golden.giver === 'string' && isCount(o.golden.acorns)
    && isBool(o.golden.duet));
}

/** Problems of the farm-level goals fields (validateState). */
export function validateGoalsFarm(f, bad) {
  const ob = f.orders;
  if (!isObj(ob) || !isCount(ob.n) || !isObj(ob.slots) || !Array.isArray(ob.recent) || !isInt(ob.golden)
    || ob.golden < -1 || !isCount(ob.goldenN)) bad('farm.orders');
  else {
    for (const [k, s] of Object.entries(ob.slots)) {
      if (!/^(0|[1-9][0-9]?)$/.test(k) || !isObj(s) || !isCount(s.availableAt) || !optPid(s.pin) || !optPid(s.flag)
        || !(s.order === null || validOrder(s.order))) bad(`farm.orders.slots.${k}`);
    }
    if (ob.recent.length > ORDERS.weights.recentWindow
      || !ob.recent.every((r) => Array.isArray(r) && r.every((i) => typeof i === 'string'))) bad('farm.orders.recent');
    if (!(ob.rush === null || (isObj(ob.rush) && isInt(ob.rush.d) && isCount(ob.rush.n)))) bad('farm.orders.rush');
    if (!(ob.meter === null || (isObj(ob.meter) && [ob.meter.w, ob.meter.e, ob.meter.v, ob.meter.c].every(isCount)
      && ob.meter.c <= ORDERS.meter.chests.length))) bad('farm.orders.meter');
  }
  const q = f.quests;
  if (!isObj(q) || !isObj(q.active) || !isObj(q.done) || !counts(q.owed)) bad('farm.quests');
  else {
    for (const [id, a] of Object.entries(q.active)) {
      if (!questOf(id) || !isObj(a) || !isCount(a.at) || !counts(a.n)) bad(`farm.quests.active.${id}`);
      if (Object.hasOwn(q.done, id)) bad(`farm.quests: ${id} both active and done`);   // i18n-ok: a validator message, never shown
    }
    for (const [id, at] of Object.entries(q.done)) if (!questOf(id) || !isCount(at)) bad(`farm.quests.done.${id}`);
  }
  validRibbons(f.ribbons, 'farm.ribbons', bad);
  const d = f.daily;
  if (!isObj(d) || !isInt(d.day) || !isInt(d.week) || !isObj(d.gift) || !isCount(d.gift.n) || !isInt(d.gift.last)
    || !isObj(d.play) || !isInt(d.play.d) || !isCount(d.play.first) || !isBool(d.play.ok) || !isObj(d.weeks)
    || ![d.weeks.days, d.weeks.streak, d.weeks.best, d.weeks.skips].every(isCount) || !isInt(d.weeks.w)) {
    bad('farm.daily');
  }
  else {
    const t = d.together;
    if (!(t === null || (isObj(t) && isInt(t.d) && typeof t.tpl === 'string' && isCount(t.qty) && isCount(t.n)
      && t.n <= t.qty && counts(t.by) && isBool(t.done)))) bad('farm.daily.together');
    const sn = d.season;
    if (sn !== undefined && !(isObj(sn) && typeof sn.k === 'string' && isCount(sn.n))) bad('farm.daily.season');
  }
  const c = f.challenge;
  if (!isObj(c) || !isCount(c.n) || !isCount(c.done) || c.done > c.n) bad('farm.challenge');
  else if (c.cur !== null && !(isObj(c.cur) && isInt(c.cur.w) && typeof c.cur.tpl === 'string' && isCount(c.cur.target)
    && isCount(c.cur.n) && c.cur.n <= c.cur.target && counts(c.cur.by) && isObj(c.cur.rec) && isBool(c.cur.done))) {
    bad('farm.challenge.cur');
  }
  const co = f.coop;
  if (!isObj(co) || !isObj(co.bench)) bad('farm.coop');
  else {
    for (const [pid, seat] of Object.entries(co.bench)) {
      if (!isPid(pid) || !isObj(seat) || typeof seat.id !== 'string' || !isCount(seat.at)) {
        bad(`farm.coop.bench.${pid}`);
      }
    }
    const g = co.golden;
    if (!(g === null || (isObj(g) && isCount(g.from) && isCount(g.until)))) bad('farm.coop.golden');
    if (!(co.goldenAt === null || isCount(co.goldenAt)) || !(co.hfAt === null || isCount(co.hfAt))) {
      bad('farm.coop: times');
    }
    if (!(co.hf === null || (isObj(co.hf) && isPid(co.hf.by) && isCount(co.hf.at)))) bad('farm.coop.hf');
    const cb = co.combo;
    if (!(cb === null || (isObj(cb) && isInt(cb.d) && isCount(cb.n) && isCount(cb.at)))) bad('farm.coop.combo');
    const nm = co.named;
    if (!(nm === null || (isObj(nm) && isActor(nm.by) && isCount(nm.at)))) bad('farm.coop.named');
  }
  const fd = f.feed;
  if (!isObj(fd) || !isCount(fd.n) || !isObj(fd.rows)) bad('farm.feed');
  else {
    for (const [k, r] of Object.entries(fd.rows)) {
      const i = Number(k);
      if (!(String(i) === k && i < FEED.historyMax) || !isObj(r) || !isCount(r.at) || !isActor(r.by)
        || typeof r.k !== 'string') {
        bad(`farm.feed.rows.${k}`);
      }
    }
  }
  if (!isObj(f.notes)) bad('farm.notes');
  else {
    for (const [id, n] of Object.entries(f.notes)) {
      if (!isObj(n) || !isPid(n.by) || !isCount(n.at) || typeof n.text !== 'string'
        || n.text.length > COOP.notes.maxChars
        || !isCount(n.x) || !isCount(n.z)) bad(`farm.notes.${id}`);
    }
    if (Object.keys(f.notes).length > COOP.notes.maxOpen) bad('farm.notes: too many');   // i18n-ok: a validator message, never shown
  }
  const t = f.tut;
  if (!isObj(t) || !isCount(t.s) || !isCount(t.t) || !isCount(t.n) || !isObj(t.fin)
    || !Object.entries(t.fin).every(([k, v]) => TUTORIAL.tracks.includes(k) && isPid(v))) bad('farm.tut');
  if (!isObj(f.stars) || !Object.entries(f.stars).every(([k, v]) => masteryDef(k) && isCount(v) && v <= 4)) {
    bad('farm.stars');
  }
  const nameOk = (n) => isObj(n) && typeof n.name === 'string' && n.name.length >= 1 && n.name.length <= 16
    && isPid(n.by) && isCount(n.at);
  if (!isObj(f.names) || !Object.values(f.names).every(nameOk)) bad('farm.names');
  validateWeekly(f, bad);
  validateM2(f, bad);
}

/** The M2 goals keys (league, Seasonal Ribbon Track, Friendly Duel, Legacy rows, Grandma's visit). */
function validateM2(f, bad) {
  const lg = f.league;
  const tierOk = (t) => Number.isSafeInteger(t) && t >= 1 && t <= LEAGUE.leagues;
  const resOk = (r) => isObj(r) && isInt(r.w) && tierOk(r.tier) && tierOk(r.to) && isCount(r.rank) && r.rank >= 1
    && isCount(r.p) && isCount(r.W) && [-1, 0, 1].includes(r.move) && isCount(r.acorns) && Array.isArray(r.npc)
    && r.npc.every(isCount);
  if (!isObj(lg) || !tierOk(lg.tier) || !tierOk(lg.best) || lg.best < lg.tier || !isInt(lg.w) || !Array.isArray(lg.hist)
    || lg.hist.length > 8 || !lg.hist.every(resOk)) bad('farm.league');
  const tr = f.track;
  if (!isObj(tr) || !(tr.s === null || (typeof tr.s === 'string' && /^\d{4}-(spring|summer|autumn|winter)$/.test(tr.s)))
    || ![tr.L, tr.need, tr.xp].every(isCount) || !isObj(tr.got) || !Array.isArray(tr.coats)
    || !tr.coats.every((c) => typeof c === 'string')
    || !Object.entries(tr.got).every(([k, g]) => /^[1-9][0-9]?$/.test(k) && isObj(g) && isActor(g.by) && isCount(g.at))) {
    bad('farm.track');
  }
  const du = f.duel;
  if (!isObj(du) || !isCount(du.n)) bad('farm.duel');
  else {
    const c = du.cur;
    const scores = (o) => isObj(o) && Object.entries(o).every(([k, v]) => isPid(k) && isCount(v));
    if (!(c === null || (isObj(c) && typeof c.kind === 'string' && isPid(c.by) && isCount(c.at) && isBool(c.ok)
      && isCount(c.start) && isCount(c.end) && (c.p === null || (Array.isArray(c.p) && c.p.length === 2
      && c.p.every(isPid) && c.p[0] !== c.p[1])) && scores(c.s)))) bad('farm.duel.cur');
    const l = du.last;
    if (!(l === null || (isObj(l) && typeof l.kind === 'string' && scores(l.s) && (l.win === null || isPid(l.win))
      && isBool(l.tie) && isCount(l.end) && seenOk(l.seen)))) bad('farm.duel.last');
    const cr = du.crown;
    if (!(cr === null || (isObj(cr) && Array.isArray(cr.pids) && cr.pids.every(isPid) && isCount(cr.until)))) {
      bad('farm.duel.crown');
    }
  }
  const le = f.legacy;
  if (!isObj(le) || !Array.isArray(le.rows) || le.rows.length > 12
    || !le.rows.every((r) => isObj(r) && isCount(r.n) && isCount(r.L) && isCount(r.at) && isActor(r.by) && isObj(r.reward))) {
    bad('farm.legacy');
  }
  const g = f.grandma;
  if (!(g === null || (isObj(g) && isCount(g.at) && isCount(g.until) && g.until >= g.at && seenOk(g.met)
    && isBool(g.left) && (g.gift === null || typeof g.gift === 'string')))) bad('farm.grandma');
}

const itemQty = (o) => isObj(o) && Object.keys(o).length > 0
  && Object.entries(o).every(([i, q]) => itemOf(i) && Number.isSafeInteger(q) && q > 0);
const seenOk = (o) => isObj(o) && Object.entries(o).every(([k, v]) => isPid(k) && v === 1);

/** The M1b goals keys (County Fair, River Barge, album, townsfolk, the made log). */
function validateWeekly(f, bad) {
  const fa = f.fair;
  if (!isObj(fa)) bad('farm.fair');
  else {
    const c = fa.cur;
    if (!(c === null || (isObj(c) && isInt(c.w) && isCount(c.W) && c.W > 0 && isCount(c.L) && isCount(c.p)
      && counts(c.by) && Object.keys(c.by).every(isPid) && isObj(c.ent)
      && Object.entries(c.ent).every(([i, n]) => itemOf(i) && isCount(n)) && isBool(c.open)))) bad('farm.fair.cur');
    const cerOk = (l) => isObj(l) && isInt(l.w) && isCount(l.W) && isCount(l.p) && isCount(l.rank)
      && (l.medal === null || MEDAL_RANKS.includes(l.medal)) && isCount(l.coins) && isCount(l.acorns)
      && (l.trophy === null || typeof l.trophy === 'string') && isCount(l.at) && seenOk(l.seen)
      && (l.by === undefined || (counts(l.by) && Object.keys(l.by).every(isPid)));
    if (!(fa.last === null || cerOk(fa.last))) bad('farm.fair.last');
    // ceremonies each farmer has not seen yet, oldest first, at most 4 (wave-2 QA RC-14); absent in older saves
    if (fa.unseen !== undefined && !(isObj(fa.unseen) && Object.entries(fa.unseen)
      .every(([k, q]) => isPid(k) && Array.isArray(q) && q.length <= 4 && q.every(cerOk)))) bad('farm.fair.unseen');
  }
  const b = f.barge;
  if (!isObj(b) || !isCount(b.t) || b.t < 1 || b.t > BARGE.chest.tiers || !isCount(b.streak) || !isInt(b.w)
    || !isBool(b.docked) || !isCount(b.rows) || b.rows > BARGE.rowsMax || !isObj(b.crates) || !isObj(b.paid)
    || !isObj(b.play) || !isInt(b.play.w) || !isInt(b.play.m) || !isCount(b.play.n) || !isInt(b.play.prev)) {
    bad('farm.barge');
  } else {
    for (const [k, c] of Object.entries(b.crates)) {
      if (!/^[0-8]$/.test(k) || Number(k) >= b.rows * BARGE.cratesPerRow || !isObj(c) || !itemOf(c.item)
        || !isCount(c.qty) || c.qty < 1 || !optPid(c.by) || !isCount(c.at) || !optPid(c.flag)) {
        bad(`farm.barge.crates.${k}`);
      }
    }
    if (!Object.entries(b.paid).every(([k, at]) => /^[0-2]$/.test(k) && isCount(at))) bad('farm.barge.paid');
    const nx = b.next;
    if (!(nx === null || (isObj(nx) && isInt(nx.w) && isCount(nx.rows) && Array.isArray(nx.crates)
      && nx.crates.length === nx.rows * BARGE.cratesPerRow
      && nx.crates.every((c) => isObj(c) && itemOf(c.item) && isCount(c.qty) && c.qty > 0)))) bad('farm.barge.next');
    const lg = b.log;
    if (!(lg === null || (isObj(lg) && isInt(lg.w) && isCount(lg.rows) && isCount(lg.done) && isCount(lg.t)))) {
      bad('farm.barge.log');
    }
  }
  const al = f.album;
  if (!isObj(al) || !isObj(al.sets)) bad('farm.album');
  else {
    for (const [id, st] of Object.entries(al.sets)) {
      const set = CONTENT.collections.get(id);
      if (!set || !isObj(st) || !isCount(st.r) || !isCount(st.pity) || !isObj(st.items)
        || !(st.done === null || isCount(st.done))) { bad(`farm.album.sets.${id}`); continue; }
      for (const [item, x] of Object.entries(st.items)) {
        if (!set.items.some((i) => i.id === item) || !isObj(x) || !isPid(x.by) || !isCount(x.at) || !isCount(x.n)
          || x.n < 1) bad(`farm.album.sets.${id}.items.${item}`);
      }
    }
  }
  const fk = f.folk;
  if (!isObj(fk) || !isInt(fk.w) || !isCount(fk.n) || !isObj(fk.posts) || !isObj(fk.f) || !isObj(fk.cards)
    || !(fk.r === undefined || isInt(fk.r))) {
    bad('farm.folk');
  } else {
    for (const [k, p] of Object.entries(fk.posts)) {
      if (!/^[0-9]$/.test(k) || !isObj(p) || typeof p.npc !== 'string' || !isCount(p.n) || !itemQty(p.items)
        || ![p.coins, p.xp, p.value].every(isCount) || !(p.flag === undefined || optPid(p.flag))
        || !(p.done === null || (isObj(p.done) && isPid(p.done.by) && isCount(p.done.at)))) bad(`farm.folk.posts.${k}`);
    }
    for (const [npc, x] of Object.entries(fk.f)) {
      if (!CONTENT.npcs.has(npc) || !isObj(x) || !isCount(x.v) || x.v > TOWNSFOLK.friendship.max || !isInt(x.d)) {
        bad(`farm.folk.f.${npc}`);
      }
    }
    for (const [npc, list] of Object.entries(fk.cards)) {
      if (!CONTENT.npcs.has(npc) || !Array.isArray(list) || !list.every((i) => itemOf(i))) {
        bad(`farm.folk.cards.${npc}`);
      }
    }
  }
  if (!isObj(f.made) || !Object.entries(f.made).every(([i, d]) => itemOf(i) && isInt(d))) bad('farm.made');
  const mb = f.memory;
  if (!isObj(mb) || !isCount(mb.n) || !(mb.season === null || typeof mb.season === 'string') || !isObj(mb.rows)) {
    bad('farm.memory');
  } else {
    for (const [k, r] of Object.entries(mb.rows)) {
      if (!isObj(r) || !isCount(r.n) || String(r.n % MEMORY.max) !== k || r.n >= mb.n || typeof r.k !== 'string'
        || !isCount(r.at) || !isActor(r.by) || !(r.ref === undefined || typeof r.ref === 'string')
        || !(r.text === undefined || (typeof r.text === 'string' && r.text.length <= MEMORY.textMax))) {
        bad(`farm.memory.rows.${k}`);
      }
    }
  }
}

function validRibbons(book, where, bad) {
  if (!isObj(book)) { bad(where); return; }
  for (const [id, r] of Object.entries(book)) {
    const def = ribbonOf(id);
    if (!def || !isObj(r) || !isCount(r.t) || r.t < 1 || r.t > def.tiers.length || !isCount(r.at)) {
      bad(`${where}.${id}`);
    }
  }
}

/** Problems of one player's goals fields (validateState). */
export function validateGoalsPlayer(p, pid, bad) {
  const w = `players.${pid}`;
  const pl = p.play;
  if (!isObj(pl) || !isInt(pl.m) || !isCount(pl.n) || !isInt(pl.d) || !isCount(pl.card)) bad(`${w}.play`);
  const a = p.almanac;
  if (!isObj(a) || !isInt(a.d) || ![a.k, a.paid, a.done, a.rerolls].every(isCount) || !isBool(a.chest)
    || !isObj(a.tasks)) {
    bad(`${w}.almanac`);
  } else {
    for (const [slot, t] of Object.entries(a.tasks)) {
      if (!/^[0-9]$/.test(slot) || Number(slot) >= ALMANAC.tasksPerPlayer || !isObj(t) || typeof t.tpl !== 'string'
        || typeof t.verb !== 'string' || typeof t.ref !== 'string' || !isCount(t.qty) || !isCount(t.n)) {
        bad(`${w}.almanac.tasks.${slot}`);
      }
    }
  }
  if (!isObj(p.caps) || !isInt(p.caps.d) || !Object.entries(p.caps).every(([k, v]) => k === 'd' || isCount(v))) {
    bad(`${w}.caps`);
  }
  validRibbons(p.ribbons, `${w}.ribbons`, bad);
  if (!(p.title === null || (typeof p.title === 'string' && ribbonOf(p.title)))) bad(`${w}.title`);
  const t = p.tut;
  if (!isObj(t) || !(t.track === null || TUTORIAL.tracks.includes(t.track)) || !isCount(t.i) || !isCount(t.n)
    || !isBool(t.skip)) {
    bad(`${w}.tut`);
  }
  if (!isCount(p.spark)) bad(`${w}.spark`);
  if (!isObj(p.shelf) || !isCount(p.shelf.n) || !isObj(p.shelf.rows)) bad(`${w}.shelf`);
  const s = p.seen;
  if (!isObj(s) || !isCount(s.lvl) || !isObj(s.cards) || !isObj(s.beats) || !isObj(s.tips)) bad(`${w}.seen`);
  const pk = p.perks;
  if (!isObj(pk) || !isObj(pk.t) || !(pk.r === null || isCount(pk.r))
    || !Object.entries(pk.t).every(([t, n]) => PERK_TREES.includes(t) && isCount(n) && n <= 5)) bad(`${w}.perks`);
  const rs = p.rested;
  if (!isObj(rs) || !isCount(rs.xp) || !isCount(rs.at)) bad(`${w}.rested`);
}

// ---- the Goal Tracker (GDD §5.1) ---------------------------------------------------------------------------------

const MIN = 60_000;
const DOMAIN_OF_KIND = { harvest: 'fields', water: 'fields', tree: 'orchard', collect: 'barnyard', tend: 'barnyard',
  craft: 'workshop', order: 'market', sell: 'market' };

/** The fastest unlocked crop. */
function fastestCrop(L) {
  let best = null;
  for (const c of liveAt('crops', L)) if (!best || c.growMs < best.growMs) best = c;
  return best ?? cropOf('wheat');
}

/**
 * The crop that best fills a wait of `ms` (the NOW tip, RC-09): the longest unlocked crop that is ripe before the
 * next ready thing (more value per planting), else the fastest one. Not always Wheat.
 */
function cropForWait(L, ms) {
  let best = null;
  for (const c of liveAt('crops', L)) if (c.growMs <= ms && (!best || c.growMs > best.growMs)) best = c;
  return best ?? fastestCrop(L);
}

/** Domains of the partner's last three feed lines (GDD §5.1 different-domain bonus) and what they pinned. */
function partnerFocus(state, pid) {
  const domains = new Set();
  let n = 0;
  for (const [, r] of feedRows(state, 20)) {
    if (r.by === pid || r.by === 'sys') continue;
    const d = DOMAIN_OF_KIND[r.k];
    if (d) domains.add(d);
    if (++n >= 3) break;
  }
  const pins = new Set();
  const slots = state.farm.orders?.slots ?? {};
  for (const k of Object.keys(slots)) if (slots[k].pin && slots[k].pin !== pid) pins.add(`order:${k}`);
  return { domains, pins };
}

/** What is ready to collect now, and when the next thing ripens (plots and anything with a top-level readyAt). */
function readiness(state, now) {
  let ready = 0;
  let idle = 0;
  let next = Infinity;
  const kinds = new Map();
  const readyCrops = new Map();
  const giants = new Map();
  const objs = state.farm.objects;
  for (const id of Object.keys(objs)) {
    const o = objs[id];
    if (o.def === 'plot') {
      if (o.crop === null) idle++;
      else if (typeof o.crop.giant === 'string') {
        // a Giant is felled with chops, not collected (rules-economy's giant.js): one thing to do, not nine
        if (o.crop.readyAt <= now && o.crop.giant === id) giants.set(id, o);
        else if (o.crop.readyAt > now && o.crop.readyAt < next) next = o.crop.readyAt;
      } else if (o.crop.readyAt <= now) {
        ready++;
        kinds.set('fields', (kinds.get('fields') ?? 0) + 1);
        readyCrops.set(o.crop.def, (readyCrops.get(o.crop.def) ?? 0) + 1);
      }
      else if (o.crop.readyAt < next) next = o.crop.readyAt;
    } else if (Number.isSafeInteger(o.readyAt)) {
      const dom = typeof o.home === 'string' ? 'barnyard' : CONTENT.trees.has(o.def) ? 'orchard' : 'workshop';
      if (o.readyAt <= now) { ready++; kinds.set(dom, (kinds.get(dom) ?? 0) + 1); }
      else if (o.readyAt < next) next = o.readyAt;
    }
  }
  return { ready, idle, next, kinds, readyCrops, giants };
}

/** A wait for a card: "4:05" (m:ss) under an hour, "2:15 h" (h:mm) under 10 hours, then "23 h 59 m" (RC-26). */
export const mmss = mmssEn;

/** How far another NOW card must outrank the one shown before it takes its place (RC-19). */
export const KEEP_MARGIN = 1.0;

/** The same card for hysteresis: kind, and its id / ref when it has them (counts in the text may change). */
const sameCard = (c, k) => c.kind === k.kind && (c.id ?? null) === (k.id ?? null)
  && (c.ref ?? null) === (k.ref ?? null);

/**
 * The three Goal Tracker cards for a player. Pure; called by the client on every relevant change.
 * Card = { slot: 'now' | 'soon' | 'big', kind, text, domain?, ref?, id?, have?, need?, eta? }
 * NOW is never empty: the fallback chain ends in "Everything is growing — next ready in m:ss. Tip: <fastest crop>".
 * score = urgency + proximity (have / need) + novelty - partner-is-doing-it + different-domain bonus (GDD §5.1).
 * @param {object} state @param {string} pid @param {number} now
 * @param {{ recent?: string[], keep?: object, ranked?: boolean }} [opts]  recent: card kinds this player was shown
 *   in the last 10 minutes (novelty); keep: the NOW card shown now (hysteresis, KEEP_MARGIN); ranked: also return
 *   the scored NOW candidates; all: also return every candidate card of every slot
 */
export function goals(state, pid, now, opts = {}) {
  const L = levelFromXp(state.farm.xp);
  const focus = partnerFocus(state, pid);
  const recent = new Set(opts.recent ?? []);
  const r = readiness(state, now);
  const cands = [];
  const add = (c, score) => {
    let s = score;
    if (c.domain && focus.domains.has(c.domain)) s -= 2;     // the partner is working there
    else if (c.domain) s += 1;                              // the different-domain bonus (C4)
    if (c.pin && focus.pins.has(c.pin)) s -= 4;             // the partner's "I'm on it"
    if (!recent.has(c.kind)) s += 0.5;                      // novelty
    cands.push({ ...c, score: s });
  };
  nowCandidates(state, pid, now, r, add);
  soonCandidates(state, now, L, add);
  bigCandidates(state, pid, L, add);
  weeklyCandidates(state, now, add);
  longTermCandidates(state, now, add);
  petCandidates(state, pid, now, add);
  m2Candidates(state, pid, now, add);
  w4Candidates(state, now, add);
  w4bCandidates(state, pid, now, add);

  const pick = (slot) => {
    const list = cands.filter((c) => c.slot === slot)
      .sort((a, b) => b.score - a.score || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
    // hysteresis (wave-2 QA RC-19): the NOW card the player is looking at (opts.keep) stays while it is still a
    // candidate, unless another outranks it by more than KEEP_MARGIN, so NOW does not flip-flop every minute
    const k = slot === 'now' && opts.keep ? list.find((c) => sameCard(c, opts.keep)) : null;
    return k && k.score + KEEP_MARGIN >= list[0].score ? k : list[0] ?? null;
  };
  const strip = (c) => {
    if (!c) return null;
    const { score, pin, ...card } = c;                      // eslint-disable-line no-unused-vars
    return card;
  };
  let nowCard = strip(pick('now'));
  if (!nowCard) {
    // the fallback chain ends in a promise (and, with a plot free, the crop that fits the wait): never empty
    const next = Number.isFinite(r.next);
    let m = msg(next ? 'goals.r.tip.next' : 'goals.r.tip.rest', next ? { t: ms(r.next - now) } : {});
    let ref = null;
    if (r.idle > 0) {
      const c = cropForWait(L, next ? r.next - now : Infinity);
      m = msg(next ? 'goals.r.tip.nextTip' : 'goals.r.tip.restTip',
        { ...m.params, crop: name(c.id, c.name, 'crops'), g: ms(c.growMs) });
      ref = c.id;
    }
    nowCard = { slot: 'now', kind: 'tip', ...said(m), ref, eta: next ? r.next : null };
  }
  const lvl = levelProgress(state, L);
  const soonCard = strip(pick('soon'))
    ?? { slot: 'soon', kind: 'level', ...said(msg('goals.r.level.away', { level: int(L + 1), xp: int(lvl.need - lvl.have) })),
      ...lvl };
  const out = { now: nowCard, soon: soonCard, big: strip(pick('big')) };
  // opts.ranked: the scored NOW candidates too (tests and tools; the tracker never asks)
  if (opts.ranked) {
    out.ranked = cands.filter((c) => c.slot === 'now').sort((a, b) => b.score - a.score)
      .map((c) => ({ kind: c.kind, id: c.id ?? null, ref: c.ref ?? null, score: c.score }));
  }
  // opts.all: every candidate of every slot, best first (tests and tools)
  if (opts.all) out.all = [...cands].sort((a, b) => b.score - a.score).map((c) => strip(c));
  return out;
}

/** What the BIG level card says past the build's last unlock (RC-14), per milestone. */
const CHAPTER_DONE = { M1a: 'goals.r.chapter.M1a', M1b: 'goals.r.chapter.M1b', M2: 'goals.r.chapter.M2' };

/** XP into the current level and the size of the level. */
function levelProgress(state, L) {
  const base = xpForLevel(L);
  return { have: state.farm.xp - base, need: Math.max(1, xpForLevel(L + 1) - base) };
}

/** NOW: about a minute, no waiting (GDD §5.1 fallback chain: collect, plant, order, Almanac, debris, help). */
function nowCandidates(state, pid, now, r, add) {
  // a full Barn first: ripe things then wait where they are (GDD §9 #4)
  if (!canIntake(state)) {
    add({ slot: 'now', kind: 'barn', ...said(msg('goals.r.barnFull')), domain: 'market',
      need: barnCap(state) }, 12);
  }
  if (r.ready > 0) {
    const dom = [...r.kinds.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? 'fields';
    add({ slot: 'now', kind: 'collect', ...said(msg('goals.r.collect', { n: int(r.ready) })),
      domain: dom, need: r.ready }, 10);
  }
  for (const [id, o] of [...r.giants].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const crop = cropOf(o.crop.def);
    const chops = Math.max(1, Math.ceil((o.crop.hp ?? COOP.giant?.hp ?? 60) / 10));
    add({ slot: 'now', kind: 'giant', id, ref: o.crop.def,
      ...said(msg('goals.r.giant', { crop: name(o.crop.def, crop?.name ?? o.crop.def, 'crops'), n: int(chops) })), domain: 'fields',
    target: { tile: { x: o.x + 1, z: o.z + 1 }, tool: 'axe' } }, 10.5);
  }
  if (r.idle > 0) {
    // `ref`: the crop that best fills the wait for the next ready thing (RC-09: not always the fastest)
    const crop = cropForWait(levelFromXp(state.farm.xp), Number.isFinite(r.next) ? r.next - now : Infinity);
    add({ slot: 'now', kind: 'plant', ...said(msg('goals.r.plant', { n: int(r.idle) })),
      domain: 'fields', need: r.idle, ref: crop.id }, 8);
  }
  const slots = state.farm.orders?.slots ?? {};
  for (const k of sortedKeys(slots)) {
    const o = slots[k].order;
    if (o && fillable(state, o)) {
      add({ slot: 'now', kind: 'order', ...said(msg(o.golden ? 'goals.r.order.golden' : 'goals.r.order.fill')),
        domain: 'market', ref: k, pin: `order:${k}` }, o.golden ? 9 : 7);
    }
    if (o && slots[k].flag && slots[k].flag !== pid) {
      add({ slot: 'soon', kind: 'help', ...said(msg('goals.r.order.help')), domain: 'market',
        ref: k }, 6);
    }
  }
  let debris = 0;
  for (const id of Object.keys(state.farm.objects)) if (CONTENT.debris.has(state.farm.objects[id].def)) debris++;
  const me = state.players[pid];
  if (me && me.almanac && me.almanac.d === dayOf(state, now)) {
    for (const slot of sortedKeys(me.almanac.tasks)) {
      if (slot !== almanacLiveSlot(me.almanac)) continue;          // one task live at a time (RC-12)
      const t = me.almanac.tasks[slot];
      const need = t.verb === 'fill' ? t.qty * 4 : t.qty;
      // a micro-task the player can advance this minute is a NOW card; otherwise it waits in SOON
      const nowable = (t.verb === 'harvest' && (r.readyCrops.get(t.ref) ?? 0) > 0)
        || (t.verb === 'plant' && r.idle > 0) || (t.verb === 'clear' && debris > 0);
      add({ slot: nowable ? 'now' : 'soon', kind: 'almanac', ...said(almanacMsg(t)), ref: slot, have: t.n, need,
        domain: verbDomain(t.verb) }, (nowable ? 3.5 : 4) + 3 * (t.n / need));
    }
  }
  if (debris > 0) add({ slot: 'now', kind: 'debris', ...said(msg('goals.r.debris')), domain: 'farm' }, 3);
  spendCandidates(state, now, add);
}

/** How long one spend card holds the NOW slot before the next one takes its turn (integration-qa1 open item 5). */
export const SPEND_ROTATE_MS = 4 * MIN;

/**
 * NOW cards that spend or point ahead (wave-1 QA RC-09; ranked after collect, plant and order): the cheapest
 * building (or building slot) the farm can afford now, the open land card's next proof task, a cheap decoration,
 * and Grandma's seed basket when the farm is broke (RC-21). Each carries the `target` the tracker opens.
 * Only ONE of the build / slot, land and decor cards is offered at a time, in turn every SPEND_ROTATE_MS of server
 * time (pure: no memory of what was shown), so a player who does not want the Feed Mill slot is not shown it for
 * half an hour: the land card, a decoration or the next chore comes up instead.
 */
function spendCandidates(state, now, add) {
  const spend = [];
  spendList(state, now, (c, score) => spend.push([c, score]), add);
  if (spend.length === 0) return;
  const [c, score] = spend[Math.floor(now / SPEND_ROTATE_MS) % spend.length];
  add(c, score);
}

/** True when the farm owns no `def` yet, or every slot of every one it owns is busy (a second copy is worth it). */
function allBusy(state, def) {
  for (const id of Object.keys(state.farm.objects)) {
    const o = state.farm.objects[id];
    if (o.def === def && (!Array.isArray(o.queue) || o.queue.length < (o.slots ?? 1))) return false;
  }
  return true;
}

function spendList(state, now, push, add) {
  const L = levelFromXp(state.farm.xp);
  const coins = state.farm.wallet.coins;
  // the seed basket (GDD §9 #31): a broke farm with empty plots gets 12 free Wheat plantings
  if (basketCode(state, now) === null) {
    const B = BOOSTS.seedBasket;
    const m = msg('goals.r.basket', { n: int(B.plantings), crop: name(B.crop, cropOf(B.crop).name, 'crops') });
    add({ slot: 'now', kind: 'basket', ...said(m), domain: 'fields', ref: B.crop, target: { act: 'seedBasket', args: {} } }, 11);
  }
  let build = null;
  for (const b of liveAt('buildings', L)) {
    const p = buyPrice(state, b.id);
    if (p.code || p.acorns > 0 || p.coins <= 0 || p.coins > coins) continue;
    // never a build with nowhere to put it, nor a second copy while the first still has a free slot (wave-2 QA
    // RC-10a: "Build the Dairy (18,000)" for a farm with no free 3x3 and an idle Dairy)
    if (!allBusy(state, b.id) || !hasSpot(state, b.id)) continue;
    if (!build || p.coins < build.coins) build = { id: b.id, name: b.name, coins: p.coins };
  }
  let slotUp = null;
  for (const id of sortedKeys(state.farm.objects)) {
    const o = state.farm.objects[id];
    // a slot for a building with no recipe at this level is refused (upgradeSlot: LOCKED, the Compost Bin before L25)
    if (!CONTENT.buildings.has(o.def) || !Array.isArray(o.queue) || !recipesOf(o.def).some((r) => r.unlock <= L)) continue;
    const p = slotPrice(o);
    if (p !== null && p <= coins && (!slotUp || p < slotUp.coins)) slotUp = { id, def: o.def, coins: p };
  }
  if (build && (!slotUp || build.coins <= slotUp.coins)) {
    push({ slot: 'now', kind: 'build', id: build.id,
      ...said(msg('goals.r.build', { b: name(build.id, build.name), c: build.coins, have: coins })), domain: 'workshop',
      need: build.coins,
    target: { panel: 'market', args: { tab: 'buildings', focus: build.id } } }, 6.5);
  } else if (slotUp) {
    const bName = CONTENT.buildings.get(slotUp.def).name;
    push({ slot: 'now', kind: 'build', id: slotUp.def,
      ...said(msg('goals.r.slot', { b: name(slotUp.def, bName), c: slotUp.coins, have: coins })), domain: 'workshop', need: slotUp.coins,
    target: { panel: 'building', args: { id: slotUp.id } } }, 6);
  }
  const land = nextExpansion(state);
  if (land && Object.hasOwn(state.farm.proofs ?? {}, land.id)) {
    const i = land.proof.findIndex((t, k) => !proofProgress(state, land.id, k, now).done);
    if (i >= 0) {
      const t = land.proof[i];
      const p = proofProgress(state, land.id, i, now);
      const left = { ...t, qty: p.need - p.have, ref: Array.isArray(t.ref) ? t.ref[0] : t.ref };
      // a task with several goods names every one ("Make 3 more Cotton Totes or Wool Pillows"), as the Land card does
      const alts = Array.isArray(t.ref) ? t.ref.slice(1).map((r) => noun(r, left.qty, nameOf(r))) : [];
      const lm = msg(alts.length ? 'goals.r.land.taskOr' : 'goals.r.land.task', { land: name(land.id, land.name, 'expansions'),
        task: sub(moreMsg(left)), ...(alts.length ? { alts: join(alts, 'or') } : {}) });
      push({ slot: 'now', kind: 'land', id: land.id, ref: String(i), ...said(lm),
        have: p.have, need: p.need, domain: verbDomain(t.verb), target: { panel: 'expansion', args: { id: land.id } } },
      4 + 2 * (p.have / p.need));
    } else {
      // every proof done: the Planks and Crates the land still needs, then the purchase itself (wave-2 QA: the
      // card went silent here, and the reference couple stopped at Riverbank for want of 7 Planks)
      const need = [['planks', land.planks], ['wooden_crate', land.crates]]
        .map(([item, q]) => ({ verb: 'make', ref: item, qty: Math.max(0, q - available(state, item)) }))
        .find((x) => x.qty > 0);
      const target = { panel: 'expansion', args: { id: land.id } };
      // no building that makes them: the card names the building to buy first, or stays quiet (QA2 integration:
      // "Old Orchard: Make 2 more Planks" held the NOW card for whole minutes on a farm without a Sawmill)
      const maker = need ? recipeOf(need.ref)?.building ?? null : null;
      const owned = maker ? (objectsByDef(state).get(maker) ?? []).length > 0 : true;
      if (need && owned) {
        push({ slot: 'now', kind: 'land', id: land.id, ref: need.ref,
          ...said(msg('goals.r.land.task', { land: name(land.id, land.name, 'expansions'), task: sub(moreMsg(need)) })),
          domain: 'workshop', target }, 5.5);
      } else if (need) {
        const p = buyPrice(state, maker);
        if (!p.code && !(p.acorns > 0) && p.coins <= coins && hasSpot(state, maker)) {
          push({ slot: 'now', kind: 'build', id: maker, ...said(msg('goals.r.land.needBuild', {
            land: name(land.id, land.name, 'expansions'), q: qtyRef(need.ref, need.qty, nameOf(need.ref)),
            b: name(maker, CONTENT.buildings.get(maker).name), c: p.coins })), domain: 'workshop', need: p.coins,
          target: { panel: 'market', args: { tab: 'buildings', focus: maker } } }, 5.5);
        }
      } else if (land.cost <= coins) {
        push({ slot: 'now', kind: 'land', id: land.id, ref: 'buy',
          ...said(msg('goals.r.land.buy', { land: name(land.id, land.name, 'expansions'), c: land.cost })),
          domain: 'market', need: land.cost, target }, 7);
      }
    }
  }
  // the decoration that fits the treasury: the most Farm Beauty among the pieces costing at most a twentieth of the
  // coins (a 20-coin Dirt Path for a farm holding 400,000 is no suggestion), else the cheapest one ten times over
  let decor = null;
  const budget = Math.floor(coins / 20);
  const shop = liveAt('decor', L).filter((d) => d.shop === true && !((d.acorns ?? 0) > 0) && d.cost > 0 && d.cost * 10 <= coins);
  for (const d of shop) {
    if (d.cost > budget) continue;
    const better = !decor || (d.beauty10 ?? 0) > (decor.beauty10 ?? 0)
      || ((d.beauty10 ?? 0) === (decor.beauty10 ?? 0) && (d.cost < decor.cost || (d.cost === decor.cost && d.id < decor.id)));
    if (better) decor = d;
  }
  if (!decor) {
    for (const d of shop) if (!decor || d.cost < decor.cost || (d.cost === decor.cost && d.id < decor.id)) decor = d;
  }
  if (decor) {
    push({ slot: 'now', kind: 'decor', id: decor.id, ...said(msg('goals.r.decor', { d: name(decor.id, decor.name, 'decor'), c: decor.cost })),
      domain: 'farm', target: { panel: 'market', args: { tab: 'decor', focus: decor.id } } }, 2.5);
  }
  // wave 4 (owner wish E): an upgrade the farm can buy right now takes its turn with the other spend cards
  const up = upgradeOptions(state).find((v) => v.code === null);
  if (up) {
    push({ slot: 'now', kind: 'upgrade', id: up.id, ref: up.target, ...said(upgradeMsg(up)), domain: 'farm', need: up.next.coins,
    target: { panel: 'upgrades', args: { id: up.id } } }, 5);
  }
}

/** "1,500 coins + 2 Planks" for an upgrade tier. */
const costRef = (n) => join([n.coins > 0 ? sub(msg('goals.r.cost.coins', { n: n.coins })) : null,
  ...sortedKeys(n.items).map((i) => qtyRef(i, n.items[i], nameOf(i), 'items'))].filter(Boolean), 'plus');

/** "Upgrade the Cow Barn: Roomy Barn (1,500 coins + 2 Planks)": the tier's own name is content (ctext 'upgrades'). */
const upgradeMsg = (v) => msg('goals.r.upgrade', { b: name(v.def, v.name), cost: costRef(v.next),
  tier: ctextRef('upgrades', `${v.target}.${v.next.tier}`, 'name', v.next.name) });

/**
 * The next tier of every upgradable target the farm owns (wave 4): one view per farm-wide target (its first copy) and
 * the least upgraded bench, cheapest first, only tiers whose level is reached.
 */
function upgradeOptions(state) {
  const best = leastUpgraded(state);
  const out = [];
  for (const t of UPGRADE_TARGETS) {
    const v = best.has(t) ? upgradeView(state, best.get(t).id) : null;
    if (v && v.next && v.code !== 'LOCKED') out.push(v);
  }
  return out.sort((a, b) => a.next.coins - b.next.coins || (a.target < b.target ? -1 : 1));
}

const LEAST = Symbol('hh.leastUpgraded');

/**
 * target -> { id, tier } of the least upgraded copy (ties by id, never the key order: index.js rule 3). Cached on the
 * grid version (grid-cache.js bumps it on objects added or removed and on `def` / `up` writes): the tracker runs on
 * every change, the scan only when the farm's objects did.
 */
function leastUpgraded(state) {
  const v = state[GRID_VERSION] ?? 0;
  const objs = state.farm.objects;
  const c = state[LEAST];
  if (c && c.v === v && c.objs === objs) return c.best;
  const best = new Map();
  const byDef = objectsByDef(state);
  if (UPGRADE_TARGETS.some((t) => (UPGRADES[t].defs ?? [t]).some((d) => byDef.has(d)))) {
    for (const id of Object.keys(objs)) {
      const t = upgradeTargetOf(objs[id].def);
      if (!t) continue;
      const b = best.get(t);
      const tier = tierOf(objs[id]);
      if (!b || tier < b.tier || (tier === b.tier && id < b.id)) best.set(t, { id, tier });
    }
  }
  hide(state, LEAST, { v, objs, best });
  return best;
}

/**
 * Wave 4 (the owners' wish list) as cards: Fertilizer waiting in the Barn while a slow crop grows (NOW), and the next
 * upgrade the farm saves up for (SOON, by how close the coins are; the affordable one is a NOW spend card).
 */
function w4Candidates(state, now, add) {
  if (fertilizerLive(state) && available(state, FERTILIZER.item) > 0) {
    let n = 0;
    // a slow crop growing without Fertilizer (quick crops take none: they are re-planted anyway)
    for (const o of objectsByDef(state).get('plot') ?? []) {
      const c = o.crop;
      if (c && c.fert === undefined && c.giant === undefined && c.readyAt > now
        && (cropOf(c.def)?.growMs ?? 0) >= 30 * MIN) n++;
    }
    if (n > 0) {
      add({ slot: 'now', kind: 'fertilize', ref: FERTILIZER.item, ...said(msg('goals.r.fertilize', { n: int(n) })), domain: 'fields', need: n,
      target: { tool: 'fertilizer' } }, 4.4);
    }
  }
  const save = upgradeOptions(state).find((v) => v.code === 'NO_COINS' || v.code === 'NO_ITEMS');
  if (save) {
    const have = Math.min(state.farm.wallet.coins, save.next.coins);
    add({ slot: 'soon', kind: 'upgrade', id: save.id, ref: save.target, ...said(upgradeMsg(save)), have,
      need: Math.max(1, save.next.coins), domain: 'farm',
    target: { panel: 'upgrades', args: { id: save.id } } }, 3 + 2 * (have / Math.max(1, save.next.coins)));
  }
}

/**
 * Wave 4b (the owners' wish list of 2026-10-05) as cards: a balloon crate waiting to be opened (NOW), the once-a-day
 * relics ready (NOW: the Farmhand with animals to tend, the Time Turner with queues running), and the Acorn shop's next
 * relic: "Saving for the Golden Barn: 72 / 250 Acorns" (SOON; the one the player picked with saveFor, else the cheapest
 * unowned one the level allows, by how close the Acorns are) or, when the Acorns are there, a NOW card to buy it.
 */
export function w4bCandidates(state, pid, now, add) {
  const crate = cratesOn(state)[0];
  if (crate) {
    const o = state.farm.objects[crate];
    add({ slot: 'now', kind: 'crate', id: crate, ...said(msg('goals.r.crate')), domain: 'farm',
      target: { tile: { x: o.x, z: o.z }, act: 'openCrate', args: { id: crate } } }, 7);
  }
  const ctx = { now, pid: 'sys', grace: 0, rng: () => 0.5 };
  const relics = relicView(state, now);
  const owned = (id) => relics.some((r) => r.id === id && r.owned && !r.used);
  if (owned('farmhand') && farmhandTargets(state, ctx).length) {
    add({ slot: 'now', kind: 'relic', ref: 'farmhand', ...said(msg('goals.r.farmhand')),
      domain: 'barnyard', target: { act: 'farmhand', args: {} } }, 6.5);
  }
  if (owned('time_turner') && turnerTargets(state, now).length) {
    add({ slot: 'now', kind: 'relic', ref: 'time_turner', domain: 'workshop',
      ...said(msg('goals.r.turner')), target: { act: 'turnTime', args: {} } }, 4);
  }
  // the one this player picked to save for (saveFor), else the cheapest the level allows
  const mine = state.players[pid]?.save;
  const want = relics.find((r) => r.id === mine && !r.owned) ?? relics.filter((r) => !r.owned && r.code !== 'LOCKED')
    .sort((a, b) => a.acorns - b.acorns || (a.id < b.id ? -1 : 1))[0];
  if (!want) return;
  if (want.code === null) {
    add({ slot: 'now', kind: 'relic', ref: want.id, ...said(msg('goals.r.relic.buy', { relic: ctextRef(null, want.id, 'name', want.name), n: int(want.acorns) })),
      domain: 'farm', target: { panel: 'relics', args: { relic: want.id } } }, 3.5);
  } else {
    add({ slot: 'soon', kind: 'relic', ref: want.id, ...said(msg('goals.r.relic.save', { relic: ctextRef(null, want.id, 'name', want.name),
      have: int(want.have), n: int(want.acorns) })), have: want.have, need: want.acorns, domain: 'farm',
    target: { panel: 'relics', args: { relic: want.id } } }, 2 + 2 * (want.have / want.acorns));
  }
}

/** SOON: about fifteen minutes: story-card tasks and new recipes to try. */
function soonCandidates(state, now, L, add) {
  const active = state.farm.quests?.active ?? {};
  for (const qid of sortedKeys(active)) {
    const q = questOf(qid);
    if (!q) continue;
    q.tasks.forEach((t, i) => {
      const p = taskProgress(state, qid, i, now);
      if (p.done) return;
      // a card that waits on something names it (RC-10): "Baby Steps: build the Dairy first"
      const b = blockerOf(state, t, now);
      const qm = msg('goals.r.quest', { title: ctextRef('quests', qid, 'title', q.title), task: sub(b ? b.msg : taskMsg(t)) });
      add({ slot: 'soon', kind: 'quest', id: qid, ref: String(i), ...said(qm),
        have: p.have, need: p.need, domain: verbDomain(t.verb), state: isStateTask(t),
        ...(b ? { blocker: b.text } : {}) },
      5 + 3 * (p.have / p.need) - (b ? 3 : 0));
    });
  }
  const P = producers(state, now);
  for (const b of [...P.owned.keys()].sort()) {
    for (const rcp of recipesOf(b)) {
      // feeds (class inputs, counted as feedMade) are no "new recipe" to try: the card would never retire (RC-11)
      if (!rcp.inputs || CONTENT.feeds.has(rcp.id)) continue;
      if (!isLive(rcp) || rcp.unlock > L || rcp.duet || (state.farm.stats[`craft.${rcp.id}`] ?? 0) > 0) continue;
      if (Object.keys(rcp.inputs ?? {}).every((i) => available(state, i) >= rcp.inputs[i])) {
        add({ slot: 'soon', kind: 'try', id: rcp.id, ...said(msg('goals.r.try', { r: name(rcp.id, rcp.name, 'items') })), domain: 'workshop' }, 4.5);
      }
    }
  }
}

/** BIG: the next level, a ribbon tier or mastery star at 80 %+, the week's Couple Challenge. */
function bigCandidates(state, pid, L, add) {
  const lvl = levelProgress(state, L);
  const unlock = unlocksAt(L + 1).find((u) => u.family !== 'features') ?? unlocksAt(L + 1)[0];
  // past the milestone's last unlock (M1a: L13+) the card says so instead of an empty "Level 14" (RC-14); a Legacy
  // level (M2, L41+) names its reward: no empty levels, ever
  const legacy = legacyLive() && L + 1 >= legacyFrom() ? legacyReward(L + 1 - legacyFrom() + 1) : null;
  const level = int(L + 1);
  const lm = legacy ? msg('goals.r.level.legacy', { level, prize: sub(prizeMsg(legacy)) })
    : unlock ? msg('goals.r.level.unlock', { level, thing: name(unlock.id, nameOf(unlock.id)) })
      : msg('goals.r.level.chapter', { level, chapter: sub(msg(CHAPTER_DONE[MILESTONE] ?? CHAPTER_DONE.M1b)) });
  add({ slot: 'big', kind: 'level', ...said(lm), ...lvl }, 3 + 4 * (lvl.have / lvl.need));
  const me = state.players[pid];
  for (const rb of CONTENT.ribbons.values()) {
    if (!systemLive(rb) || rb.hidden) continue;
    const book = rb.scope === 'P' ? me?.ribbons ?? {} : state.farm.ribbons ?? {};
    const t = book[rb.id]?.t ?? 0;
    if (t >= rb.tiers.length) continue;
    const v = ribbonValue(state, rb, pid);
    const need = rb.tiers[t];
    if (v * 10 >= need * 8) {
      add({ slot: 'big', kind: 'ribbon', id: rb.id, ...said(msg('goals.r.ribbon', { name: ctextRef('ribbons', rb.id, 'name', rb.name),
        text: ctextRef('ribbons', rb.id, 'text', rb.text) })), have: v, need },
        3 + 4 * (v / need));
    }
  }
  if (L >= MASTERY.unlock) {
    for (const id of sortedKeys(state.farm.mastery)) {
      const m = masteryDef(id);
      const s = starsOf(state, id);
      if (!m || s >= 3) continue;
      const need = m.def.mastery[s];
      const v = state.farm.mastery[id];
      if (v * 10 >= need * 8) {
        add({ slot: 'big', kind: 'mastery', id, ...said(msg('goals.r.mastery', { name: name(m.def.id ?? id, m.def.name), n: int(s + 1) })), have: v, need },
          3 + 4 * (v / need));
      }
    }
  }
  const ch = state.farm.challenge?.cur;
  if (ch && !ch.done) {
    add({ slot: 'big', kind: 'challenge', id: ch.tpl, ...said(msg('goals.r.challenge')), have: ch.n,
      need: ch.target }, 3 + 3 * (ch.n / ch.target));
  }
}

/**
 * The M1b weekly and album systems as goals (GDD §5.1 candidates: "goals >= 80 % done (achievements, mastery,
 * collections ...)", the Fair, the barge, the townsfolk board). NOW: a crate the Barn can fill, a townsfolk request
 * ready to hand in, the best Fair entry in the Barn, an album trade. SOON: the next medal, crates and requests that
 * need goods. BIG: the week's Fair medal, the barge's rows, an album set at 80 %.
 */
function weeklyCandidates(state, now, add) {
  const b = dockedBarge(state, now) ? bargeView(state, now) : null;
  if (b) {
    const open = b.crates.filter((c) => c.by === null);
    const ready = open.filter((c) => c.ready).sort((x, y) => y.coins - x.coins || x.i - y.i)[0];
    if (ready) {
      add({ slot: 'now', kind: 'barge', ref: String(ready.i), ...said(msg('goals.r.barge.load', {
        q: qtyRef(ready.item, ready.qty, nameOf(ready.item), 'items'), c: ready.coins })), domain: 'market',
      target: { panel: 'barge', args: { i: ready.i } } }, 7.5);
    }
    for (const c of open.filter((x) => !x.ready).slice(0, 3)) {
      const have = Math.min(c.qty, available(state, c.item));
      const m = msg('goals.r.barge.crate', { q: qtyRef(c.item, c.qty, nameOf(c.item), 'items') });
      add({ slot: 'soon', kind: 'barge', ref: String(c.i), ...said(m), have, need: c.qty, domain: 'market',
        target: { panel: 'barge', args: { i: c.i } } }, 4 + 3 * (have / c.qty));
    }
    const rowsDone = Object.keys(b.paid).length;
    if (b.rows > 0 && rowsDone < b.rows) {
      const loaded = b.crates.filter((c) => c.by !== null).length;
      const m = msg('goals.r.barge.rows', { done: int(rowsDone), n: int(b.rows) });
      add({ slot: 'big', kind: 'barge', ...said(m), have: loaded, need: b.crates.length, target: { panel: 'barge' } },
        3 + 4 * (loaded / b.crates.length));
    }
  }
  const folk = folkView(state, now);
  if (folk && folk.unlocked) {
    for (const p of folk.posts) {
      if (p.done !== null) continue;
      const who = name(p.npc, CONTENT.npcs.get(p.npc)?.name ?? p.npc, 'npcs');
      if (p.fillable) {
        add({ slot: 'now', kind: 'folk', ref: String(p.i), ...said(msg('goals.r.folk.hand', { npc: who, c: p.coins })),
          domain: 'market', target: { panel: 'townsfolk', args: { i: p.i } } }, 7);
      } else {
        const items = sortedKeys(p.items);
        const have = items.reduce((n, i) => n + Math.min(p.items[i], available(state, i)), 0);
        const need = items.reduce((n, i) => n + p.items[i], 0);
        add({ slot: 'soon', kind: 'folk', ref: String(p.i), ...said(msg('goals.r.folk.need', { npc: who,
          items: join(items.map((i) => qtyRef(i, p.items[i], nameOf(i), 'items')), 'comma') })), have, need, domain: 'market',
        target: { panel: 'townsfolk', args: { i: p.i } } }, 3.5 + 3 * (have / need));
      }
    }
  }
  const fair = openFair(state, now) ? fairStanding(state, now) : null;
  if (fair) {
    // an entry only while a medal is still to win this week (wave-2 QA RC-10b: past Gold III it burnt the best goods
    // for nothing): the cheapest good whose entry reaches the next medal, else the one that gets closest
    const list = fair.next ? enterable(state, now) : [];
    const reach = list.filter((e) => e.p10 >= fair.next.need10)
      .sort((a, b) => (itemOf(a.item)?.sell ?? 0) - (itemOf(b.item)?.sell ?? 0) || (a.item < b.item ? -1 : 1));
    const best = reach[0] ?? list[0];
    if (best) {
      add({ slot: 'now', kind: 'fair', ref: best.item, ...said(msg('goals.r.fair.enter', {
        item: name(best.item, nameOf(best.item), 'items'), p: ptsRef(best.p10) })), domain: 'workshop', target: { panel: 'fair', args: { item: best.item } } },
      6.8);
    }
    if (fair.next) {
      const medal = ctextRef('FAIR', `medal.${fair.next.id}`, 'name', FAIR_MEDAL_NAME(fair.next.id));
      const need10 = fair.next.need10 + fair.p10;
      add({ slot: fair.medal ? 'soon' : 'big', kind: 'fair', ...said(msg('goals.r.fair.medal', { p: ptsRef(fair.next.need10), medal })), have: Math.floor(fair.p10 / 10), need: Math.ceil(need10 / 10), target: { panel: 'fair' } },
      3 + 4 * (fair.p10 / Math.max(1, need10)) + (medalRank(fair.medal) > 0 ? 0.5 : 0));
    }
  }
  if (albumUnlocked(state)) {
    for (const set of albumView(state)) {
      if (set.done !== null) continue;
      const found = set.items.filter((i) => i.n > 0).length;
      if (set.dupes >= 3 && set.missing > 0) {
        add({ slot: 'now', kind: 'album', id: set.id, ...said(msg('goals.r.album.trade', { set: ctextRef('collections', set.id, 'name', set.name) })),
          domain: 'farm', target: { panel: 'collections', args: { set: set.id } } }, 4);
      }
      if (found * 10 >= set.items.length * 8) {
        add({ slot: 'big', kind: 'album', id: set.id, ...said(msg('goals.r.album.found', { set: ctextRef('collections', set.id, 'name', set.name),
          found: int(found), n: int(set.items.length) })),
          have: found, need: set.items.length, target: { panel: 'collections', args: { set: set.id } } },
        3 + 4 * (found / set.items.length));
      }
    }
  }
}

const FAIR_MEDAL_NAME = (id) => FAIR.medals.find((m) => m.id === id)?.name ?? id;

/**
 * The long-term systems of rules-economy as goals (GDD §5.1 "bundles, Town Project" among the goals): a good the
 * Barn can give to the Town Project or the open Restoration bundle (NOW / SOON), the project itself and the next Farm
 * Beauty star (BIG). Reads their pure helpers only.
 */
function longTermCandidates(state, now, add) {
  const tc = state.farm.town?.cur;
  if (tc && tc.buildAt === undefined && Array.isArray(tc.goods)) {
    const tp = name(tc.id, CONTENT.townProjects.get(tc.id)?.name ?? 'the Town Project', 'townProjects');   // i18n-ok: the English fallback
    const give = tc.goods.find((g) => g.got < g.qty && available(state, g.item) > 0);
    if (give) {
      const n = Math.min(give.qty - give.got, available(state, give.item));
      add({ slot: 'now', kind: 'town', ref: give.item, ...said(msg('goals.r.give', { q: qtyRef(give.item, n, nameOf(give.item), 'items'),
        to: tp })), domain: 'farm', target: { panel: 'town' } }, 5.5);
    }
    const goods = tc.goods.reduce((s, g) => s + g.qty, 0);
    const got = tc.goods.reduce((s, g) => s + Math.min(g.got, g.qty), 0);
    // coins count as ten more steps of the same bar
    const paid = tc.coins > 0 ? Math.floor((Math.min(tc.paid, tc.coins) * 10) / tc.coins) : 10;
    add({ slot: 'big', kind: 'town', ...said(msg('goals.r.town.big', { project: tp })), have: got + paid,
      need: goods + 10, target: { panel: 'town' } }, 2.5 + 4 * ((got + paid) / (goods + 10)));
  }
  const proj = openProject(state);
  if (proj) {
    let best = null;
    let done = 0;
    for (const b of proj.bundles) {
      if (bundleDone(state, proj.id, b.id)) { done++; continue; }
      b.slots.forEach((slot, i) => {
        const need = slotNeed(proj, slot);
        if (need.kind !== 'item') return;
        const left = need.need - slotHave(state, proj.id, b.id, i);
        const give = Math.min(left, available(state, need.item));
        if (give > 0 && (!best || give > best.give)) best = { give, item: need.item, bundle: b };
      });
    }
    if (best) {
      add({ slot: 'soon', kind: 'restore', id: proj.id, ref: best.item, ...said(msg('goals.r.give', {
        q: qtyRef(best.item, best.give, nameOf(best.item), 'items'), to: name(proj.id, proj.name, 'restoration') })), domain: 'farm',
      target: { panel: 'restoration', args: { id: proj.id } } }, 5);
    }
    add({ slot: 'big', kind: 'restore', id: proj.id, ...said(msg('goals.r.restore', { project: name(proj.id, proj.name, 'restoration') })), have: done,
      need: proj.bundles.length, target: { panel: 'restoration', args: { id: proj.id } } },
    3 + 4 * (done / proj.bundles.length));
  }
  if (beautyLive(state)) {
    const b = beautyOf(state, now);
    if (b.next) {
      add({ slot: 'big', kind: 'beauty', ...said(msg('goals.r.beauty', { n: int(b.stars + 1), score: b.next })),
        have: b.score, need: b.next, domain: 'farm', target: { panel: 'beauty' } }, 2.8 + 4 * (b.score / b.next));
    }
  }
}

/**
 * Pets (GDD §3.4, L10): my pet still to adopt (NOW: one click), and a pet waiting for today's treat while the Barn has one
 * (NOW: the treat brings a find tomorrow morning). Both open the pets panel.
 */
function petCandidates(state, pid, now, add) {
  if (!petsLive(state) || !Object.hasOwn(state.players, pid)) return;
  if (!petOf(state, pid)) {
    add({ slot: 'now', kind: 'pet', ...said(msg('goals.r.pet.adopt')), domain: 'farm',
      target: { panel: 'pets', args: {} } }, 5);
    return;
  }
  const day = dayOf(state, now);
  for (const owner of sortedKeys(state.players)) {
    const pet = petOf(state, owner);
    const treat = pet ? petKind(pet.kind)?.treat : null;
    if (!pet || !treat || pet.fed === day || available(state, treat) < 1) continue;
    add({ slot: 'now', kind: 'pet', ref: treat, ...said(msg('goals.r.pet.treat', { pet: pet.name, treat: name(treat, nameOf(treat), 'items') })),
      domain: 'farm', target: { panel: 'pets', args: {} } }, 3.5);
    return;
  }
}

/** A content prize in words ("10 Acorns", "a Golden Seed Packet", "the Legacy Statue"): the tracker's cards. */
export function prizeMsg(r) {
  const parts = [];
  const part = (key, params) => parts.push(sub(msg(key, params)));
  if (r.acorns > 0) part('goals.r.prize.acorns', { n: int(r.acorns) });
  if (r.goldenSeeds > 0) part('goals.r.prize.golden', { n: int(r.goldenSeeds) });
  if (r.seedPacket > 0) part('goals.r.prize.packet', { n: int(r.seedPacket) });
  if (r.hearts > 0) part('goals.r.prize.hearts', { n: int(r.hearts) });
  if (r.coinsHoursBp > 0) part('goals.r.prize.coins');
  if (r.items) parts.push(join(sortedKeys(r.items).map((i) => qtyRef(i, r.items[i], nameOf(i), 'items')), 'comma'));
  if (r.decor) {
    if (r.decor === 'season') part('goals.r.prize.planter');
    else part('goals.r.prize.decor', { d: name(r.decor, nameOf(r.decor), 'decor') });
  }
  if (r.coat) part('goals.r.prize.coat');
  return parts.length ? msg('goals.r.prize.list', { list: join(parts, 'and') }) : msg('goals.r.prize.gift');
}
/** The same prize in English. */
export const prizeText = (r) => enText(prizeMsg(r));

/**
 * The M2 goals as cards (wave 3). Scores: a tier to claim is a reward waiting like a ripe plot (7.8: above a barge crate
 * and an order, below collecting and the Giant); the partner's duel invitation is a one-click answer that lapses in a day
 * (7.2); spare perk points 4.2; Grandma 3.2; the BIG cards rank by how close they are.
 * Perk points to spend and Season Track tiers to claim (NOW), an invitation to a
 * Friendly Duel (NOW) and the live score (SOON), Grandma on the farm (NOW), the next Season Track tier and the week's
 * league place (BIG). Each carries the `target` the tracker opens (the ui-league panels perks, seasonTrack, duel,
 * league; ui-home's farmhouse for Grandma).
 */
function m2Candidates(state, pid, now, add) {
  if (!Object.hasOwn(state.players, pid)) return;
  const pv = perksView(state, pid, now);
  if (pv.live && pv.trees.some((t) => t.perks.some((x) => x.affordable))) {
    add({ slot: 'now', kind: 'perk', ...said(msg('goals.r.perk', { n: int(pv.free) })),
      domain: 'farm', have: pv.spent, need: pv.points, target: { panel: 'perks' } }, 4.2);
  }
  const tv = trackView(state, now);
  if (tv.open && tv.s === state.farm.track?.s) {
    const claim = tv.tiers.find((t) => t.claimable);
    if (claim) {
      add({ slot: 'now', kind: 'track', ref: String(claim.n), ...said(msg('goals.r.track.claim', { n: int(claim.n),
        prize: sub(prizeMsg(claim.reward)) })), domain: 'farm', target: { panel: 'seasonTrack', args: { tier: claim.n } } }, 7.8);
    }
    if (!tv.done) {
      const next = tv.tiers[tv.tier];
      add({ slot: 'big', kind: 'track', ref: String(tv.tier + 1), ...said(msg('goals.r.track.next', { n: int(tv.tier + 1),
        xp: tv.toNext, prize: sub(prizeMsg(next.reward)) })), have: tv.inTier, need: tv.need,
      target: { panel: 'seasonTrack' } }, 2.6 + 4 * (tv.inTier / tv.need));
    }
  }
  const du = duelUnlocked(state) ? duelOf(state, pid, now) : null;
  if (du && du.phase === 'invited') {
    const who = state.players[du.cur.by]?.name;
    const k = DUEL.kinds.find((x) => x.id === du.cur.kind);
    const duel = duelRef(k);
    add({ slot: 'now', kind: 'duel', ref: du.cur.kind, ...said(msg(who ? 'goals.r.duel.invite' : 'goals.r.duel.invite.partner',
      { ...(who ? { who } : {}), _a: /^[AEIOU]/.test(k?.name ?? '') ? 'an' : 'a', duel })),
      domain: 'farm', target: { panel: 'duel' } }, 7.2);
  } else if (du && du.phase === 'live') {
    const k = DUEL.kinds.find((x) => x.id === du.cur.kind);
    const sc = (n) => (k?.scale > 1 ? Math.floor(n / k.scale) : n);
    const them = state.players[du.them]?.name;
    add({ slot: 'soon', kind: 'duel', ref: du.cur.kind, ...said(msg(them ? 'goals.r.duel.live' : 'goals.r.duel.live.partner',
      { duel: duelRef(k), mine: int(sc(du.mine)), ...(them ? { them } : {}), theirs: int(sc(du.theirs)) })),
      have: du.mine, need: Math.max(1, du.mine, du.theirs), domain: 'farm',
    target: { panel: 'duel' } }, 3.6);
  }
  const g = grandmaView(state, now, pid);
  if (g && g.here) {
    const stopKey = `goals.r.grandma.${g.stop}`;
    add({ slot: 'now', kind: 'grandma', ref: g.stop, ...said(Object.hasOwn(GOALS_RULES_EN, stopKey) ? msg(stopKey)
      : msg('goals.r.grandma.any', { stop: String(g.stop) })),
      domain: 'farm', target: { panel: 'farmhouse', args: { grandma: true } } }, 3.2);
  }
  homeCandidates(state, pid, now, add);
  const lt = leagueUnlocked(state) ? fairStanding(state, now)?.league : null;
  if (lt && lt.open && lt.rows.length) {
    const me = lt.rows.findIndex((r) => r.farm);
    const league = ctextRef('FAIR', `league.${lt.tier}`, 'name', LEAGUE.names?.[lt.tier - 1] ?? `League ${lt.tier}`);   // i18n-ok: the English, Bulgarian reads the ctext
    if (lt.tier < lt.top && me >= LEAGUE.promote) {
      const target = lt.rows.filter((r) => !r.farm)[LEAGUE.promote - 1];
      const need10 = Math.max(1, target.p10 + 1 - lt.rows[me].p10);
      add({ slot: 'big', kind: 'league', ...said(msg('goals.r.league.promo', { league, p: ptsRef(need10) })),
        have: lt.rows[me].p10, need: lt.rows[me].p10 + need10, target: { panel: 'league' } },
      2.7 + 3 * (lt.rows[me].p10 / Math.max(1, lt.rows[me].p10 + need10)));
    } else if (me < LEAGUE.promote && lt.tier < lt.top) {
      add({ slot: 'big', kind: 'league', ...said(msg('goals.r.league.hold', { league })),
        target: { panel: 'league' } }, 3);
    }
  }
}

/**
 * The M2 home systems (lead, wave 3; ui-home's panels): a bred baby waiting in the pen, a Nursery step due (or a full
 * card to choose who the baby is), and my hourly cast when the farm has a fishing spot. The panels' badges say the same.
 */
function homeCandidates(state, pid, now, add) {
  // a named baby by its name, else "the Cow": two keys, so Bulgarian can say the species its own way
  const babyOf = (key, id, o, params = {}) => {
    const given = state.farm.names?.[id]?.name;
    return given ? msg(`${key}.named`, { name: given, ...params })
      : msg(key, { animal: name(o.def, animalOf(o.def)?.name ?? 'baby', 'animals'), ...params });
  };
  const cur = breedingOpen(state) ? breedingOf(state) : null;
  if (cur && cur.readyAt <= now) {
    add({ slot: 'now', kind: 'breed', ref: cur.sp, ...said(msg('goals.r.breed.home', { animal: name(cur.sp, animalOf(cur.sp)?.name ?? 'animal', 'animals') })),
      domain: 'farm', target: { panel: 'breeding', args: { collect: true } } }, 6);
  }
  // the Breeding Barn on a full farm (wave-3 playtest: every home at capacity, so every pair answered CAP all evening):
  // until the first baby, point at the home upgrade that makes room
  if (breedingOpen(state) && !cur && !Object.values(state.farm.breed?.n ?? {}).some((n) => n > 0)) {
    const adults = {};
    for (const id of sortedKeys(state.farm.objects)) {
      const o = state.farm.objects[id];
      if (typeof o.home === 'string' && !(o.adultAt > now) && (BREEDING.species ?? []).includes(o.def)) (adults[o.def] ??= []).push(o);
    }
    const sp = Object.keys(adults).sort().find((k) => adults[k].length >= 2);
    const def = sp ? animalOf(sp) : null;
    if (def && homesWithRoom(state, def).length === 0) {
      const home = adults[sp][0].home;
      const hd = homeOf(state.farm.objects[home]?.def);
      const max = hd ? homeMaxOf(hd) : null;                 // wave 4b: homes grow past the old capacityMax
      const canGrow = Number.isSafeInteger(max) && capacityOf(state, home) < max;
      add({ slot: 'now', kind: 'breed', ref: sp, ...said(msg(canGrow ? 'goals.r.breed.upgrade' : 'goals.r.breed.full', {
        animal: name(sp, def.name, 'animals'), home: name(hd?.id ?? 'home', hd?.name ?? 'home', 'homes') })),
        domain: 'farm', target: { panel: 'animals', args: { id: home } } }, 1.5);
    }
  }
  if (nurseryOpen(state)) {
    for (const id of sortedKeys(state.farm.objects)) {
      const o = state.farm.objects[id];
      const def = o && o.home !== undefined ? animalOf(o.def) : null;
      if (!def || !def.bottle) continue;
      const step = nextCareStep(o);
      if (step === null) {
        if (o.spec === undefined && o.nurse) {
          add({ slot: 'now', kind: 'nursery', id, ref: o.def, ...said(babyOf('goals.r.nursery.choose', id, o)),
            domain: 'farm', target: { panel: 'nursery', args: { id, pick: true } } }, 3.6);
          break;
        }
        continue;
      }
      if ((!o.nurse && !cardOpen(o, now)) || now < nextCareAt(o) || available(state, def.bottle) < NURSERY.bottlesPerStep) continue;
      const verb = ['feed', 'play', 'groom'].includes(step) ? step : 'look';
      add({ slot: 'now', kind: 'nursery', id, ref: o.def, ...said(babyOf(`goals.r.nursery.${verb}`, id, o,
        { q: qtyRef(def.bottle, NURSERY.bottlesPerStep, nameOf(def.bottle), 'items') })), domain: 'farm',
      target: { panel: 'nursery', args: { id } } }, 3.1);
      break;
    }
  }
  const spots = fishingSpots(state);
  if (spots.length && !lineOf(state, pid) && nextCastAt(state, pid) <= now) {
    const pond = spots[0].pond ? expansionOf(spots[0].pond)?.name : null;
    add({ slot: 'now', kind: 'fish', ...said(pond ? msg('goals.r.fish.pond', { pond: name(spots[0].pond, pond, 'expansions') })
      : msg('goals.r.fish.dock')),
      domain: 'farm', target: { panel: 'fishing' } }, 1.6);
  }
}

/** "Fill 3 orders", "Make 2 Bread", "Buy the land: Creekside Meadow" (QUEST_VERBS text; goal-text.js taskMsg). */
export const taskText = (t) => enText(taskMsg(t));

/** The task without its count, for a "have/need" line: "Fill orders", "Collect Egg", "Buy the land: Creekside". */
export const taskLabel = (t) => enText(taskLabelMsg(t));

function verbDomain(verb) {
  switch (verb) {
    case 'harvest': case 'plant': case 'water': case 'fertilize': return 'fields';
    case 'collect': case 'tend': case 'pet': case 'buy': case 'raise': return 'barnyard';
    case 'make': case 'build': case 'place': case 'empty': return 'workshop';
    case 'fill': case 'sell': case 'deliver': return 'market';
    default: return 'farm';
  }
}
