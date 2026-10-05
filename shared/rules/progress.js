// processEvents(): the deterministic reducer that turns domain events into credit inside the SAME transaction as
// the action (tech-architecture §2.6): stats, farm XP and personal XP, level-ups and their rewards, mastery stars,
// quest / Almanac / Together-task / Couple-Challenge / tutorial progress, ribbons, the activity feed. The action,
// its consequences and the credit travel in one delta and one journal line. Owned by rules-goals.
//
// Inputs: the economy's events (shared/rules/events.js ECON_EVENTS, every XP-paying event carries `xp`) and the
// goals actions' own events (GOALS_EVENTS below). Every event is turned into credit by handle(), and into zero or
// more DEEDS { verb, ref, n, by, v?, add? } that every goal system counts the same way (quests, Almanac, Together
// task, Couple Challenge, tutorial): one vocabulary, the quest verbs of shared/content/story.js QUEST_VERBS.
//
// Ordering: events are handled in emission order; then afterPass() completes / accepts quests and evaluates the
// ribbons whose counters moved, which can emit more events (XP -> levelUp -> ...). The loop is bounded by
// MAX_PASSES and throws (the action rolls back as INTERNAL) if it does not converge.
import {
  CONTENT, cropOf, itemOf, treeOf, animalOf, recipeOf, levelFromXp, levelRow, personalLevelFromXp, masteryStars,
  MASTERY, COOP, FEED, eHours, isLive, unlocksAt, BOOSTS, BARGE, TOWN_PROJECT_RULES, TOWNSFOLK, MEDAL_RANKS,
  DAILY_GIFT, DUEL,
} from '../content/index.js';
import { grant, earn, intake } from './economy.js';
import { ECON_EVENT_NAMES } from './events.js';
import { sortedKeys, shareOut } from './order.js';
import {
  dayOf, localHour, hasPlayer, playerIds, capTake, addHearts, comboWith, onlineOf, withBp, systemLive, seasonYear,
} from './coop.js';
import { seasonOf } from './calendar.js';
import { feedAdd } from './feed.js';
import { questDeed, questsAfter, questsOnLevel, completeQuest } from './actions/quests.js';
import { ribbonsAfter } from './actions/ribbons.js';
import { tutorialDeed } from './actions/tutorial.js';
import { playTick, dailyDeed, dailyOnLevel, meterAdd } from './daily.js';
import { fairAdd, prizedCropPoints10, prizedFruitPoints10, fairOnLevel } from './actions/fair.js';
import { bargeOnLevel } from './actions/barge.js';
import { albumRoll, albumAnyRoll, perkOf } from './actions/album.js';
import { befriend, folkOnLevel } from './actions/folk.js';
import { addPage } from './actions/memory.js';
import { restedAccrue, restedSpend } from './actions/rested.js';
import { perkXpBp } from './actions/perks.js';
import { trackAdd } from './actions/track.js';
import { legacyRewardAt, legacyRecord } from './actions/legacy.js';
import { duelScore } from './actions/duel.js';
import { grandmaMeet } from './actions/grandma.js';

const MAX_PASSES = 16;
const DUEL_KINDS = () => DUEL?.kinds ?? [];      // a quest completion can open a card that is already done (state verbs): a few passes

/**
 * The CLOSED list of celebration events (review-m0 M8). They are confirmed-only: the client never predicts
 * them (public/js/net/sync.js imports this set), so nothing celebratory is ever taken back (tech §0 #15).
 * A new celebratory event joins HERE, in the same change that first emits it.
 *   levelUp      { scope: 'farm', level, coins, acorns, by, unlocks: [{ family, id }] }
 *                | { scope: 'player', pid, level, title, by }
 *   achievement  { id, tier (1-3), scope, pids: [..], by }    a ribbon tier (F, P or T); hidden ribbons tier 1
 *   questDone    { id, by, coins, xp }
 *   duet         emitted by the economy when a duet recipe starts together (events.js)
 *   together     { kind: 'goldenHour' | 'highFive' | 'task' | 'challenge', a?, b?, ... }   a joint moment
 *   mastery      { id, family, star, by }                      a mastery star (★1-★3)
 *   fairCeremony { w, W, p, medal, rank, coins, acorns, trophy, by }   the County Fair's Sunday ceremony (M1b)
 *   bargeRow     { row, w, coins, acorns, compost, decor, loaders, by } a completed River Barge row (M1b)
 *   albumFind    { set, item, dup, how, by }                   a collection item found (roll | pity | gift | trade)
 *   albumSet     { set, perk, by }                             a collection set completed (M1b)
 *   friendship   { npc, v, step, gift, by }                    a townsperson's Friendship gift step (M1b)
 *   bloomed      { level, ids, breed? }                         the Level-up Bloom finished everything growing (owner
 *                                                              rule 2026-10-04; emitted by actions/boosts.js through
 *                                                              setBloom): the sparkle wave and the "ready" card
 *   trackTier    { tier, s, by }                               a Seasonal Ribbon Track tier reached (M2, track.js)
 *   duelEnded    { kind, s, win, tie, scored, crown, decor, by }  a Friendly Duel's result (M2, duel.js)
 * M2 additions to existing ones: fairCeremony gains `league { tier, rank, move, to, acorns }` (a league week) and
 * `banner` (Platinum); levelUp { scope: 'farm' } gains `legacy` = the Legacy reward paid (resolved: coins, decor ...).
 */
export const CELEBRATIONS = Object.freeze(new Set(['levelUp', 'achievement', 'questDone', 'duet', 'together',
  'mastery', 'fairCeremony', 'bargeRow', 'albumFind', 'albumSet', 'friendship', 'bloomed', 'trackTier', 'duelEnded']));

/** The goals actions' own fx-class events (predicted for the actor; world and UI feedback). */
export const GOALS_EVENTS = Object.freeze({
  joined: 'pid                                     (_join)',
  orderNew: 'slot, golden                         (_orders materialised an order)',
  orderFilled: 'slot, n, coins, xp, acorns, golden, giver, simple, value, items, by, helped (the flag owner\'s pid '
    + 'when the OTHER player filled it, else null; giver = the golden order\'s townsperson)',
  orderGone: 'slot, n, by                         (discarded; the slot refills in ORDERS.refillMs)',
  orderPinned: 'slot, pin, by                     (pin = pid | null)',
  orderFlagged: 'slot, flag, by                   (flag = pid | null)',
  orderRushed: 'slot, acorns, by                  (instant refill; acorns 0 = the free one of the day)',
  meterChest: 'i, coins, acorns, items            (Mabel\'s weekly meter chest i (0-2) paid)',
  questStarted: 'id                               (a story card was accepted)',
  questDelivered: 'id, items, by',
  hearts: 'pid, n, why                            (Hearts gained; why: tend | team | flag | duet | thanks | ...)',
  gift: 'day, coins, acorns, items, decor, by     (Daily Gift claimed)',
  almanacDone: 'pid, slot, paid, coins, xp        (an Almanac task completed; it refreshes at once)',
  almanacChest: 'pid, items, coins, roll          (the day\'s first four tasks done; roll = a collection roll)',
  almanacRerolled: 'pid, slot',
  challengeStarted: 'week, tpl, target',
  weekRolled: 'week, streak, best, skips          (_rollover started a new week; Farm Weeks counted)',
  noted: 'id, x, z, by',
  unnoted: 'id, by',
  thanked: 'i, to, by, hearts',
  keepsake: 'item, to, by',
  named: 'what, id?, species?, text, first, by     (first = the farm\'s / animal\'s first name)',
  seated: 'pid, id',
  stood: 'pid, id',
  highFiveWait: 'by                               (first press of a high-five; the partner has 1.5 s)',
  tutorialStep: 'pid, track, step, done, skipped?',
  seen: 'pid, kind, id',
  titled: 'pid, title',
  // M1b weekly and album systems (actions/fair.js, barge.js, folk.js)
  fairOpened: 'w, W, by                          (a County Fair week opened; W = the target in points)',
  fairEntered: 'item, qty, p10, total, by        (goods entered at the Fair tent; points x 10)',
  fairPoints: 'p10, total, why, by               (Fair points from a blue-ribbon crop / fruit or a Giant; why crop | '
    + 'fruit | giant)',
  bargeDocked: 'w, rows, t, by                   (Captain Reed docked: rows offered, ladder tier)',
  bargeCastOff: 'w, rows, done, t, by            (the barge left: rows completed, the new tier)',
  bargeLoaded: 'i, item, qty, coins, xp, helped, by  (a crate loaded; helped = the flag owner when the OTHER player '
    + 'loaded it, else null)',
  bargeFlagged: 'i, flag, by                     (flag = pid | null)',
  folkPosted: 'w, n, by                          (this week\'s townsfolk requests went up)',
  folkFilled: 'i, npc, coins, xp, value, items, helped, by  (helped = the flag owner when the OTHER player filled it)',
  folkFlagged: 'i, flag, by                       (flag = pid | null)',
  memoryPage: 'n, k, ref, counts, by             (a Memory Book page; counts = it counts for Our Story)',
  folkGifted: 'npc, item, by',
  befriended: 'npc, v, n, why, by                (Friendship rose to v; why: request | golden | quest | gift)',
  // M2 (wave 3): perks, rested XP, the Seasonal Ribbon Track, the Friendly Duel, Grandma's visit
  perkPicked: 'pid, tree, i, by                  (a perk taken: the i-th of the tree, 0-based)',
  perksReset: 'pid, points, by, acorns?          (a respec: every point back; acorns > 0 = a paid one, wave 4)',
  perkRefunded: 'pid, tree, i, points, acorns, by  (wave 4: the last perk of a tree given back for Acorns)',
  rested: 'pid, xp, total, by                    (rested XP accrued for a returning player; total = the pool now)',
  trackOpened: 's, need, by                      (a season\'s Seasonal Ribbon Track opened; need = XP a tier)',
  trackClosed: 's, tiers, auto, coins, by        (a season ended: tiers reached, auto = unclaimed tiers paid now, '
    + 'coins = the points left as coins)',
  trackClaimed: 'tier, s, reward, by             (a reached tier claimed; reward = what was paid, resolved)',
  coatWorn: 'id, coat, by                        (a season coat put on an animal)',
  duelInvited: 'kind, end, by                    (a Friendly Duel invitation; end = the week\'s close)',
  duelAccepted: 'kind, end, a, b, by             (the duel runs: a invited, b accepted)',
  duelDeclined: 'kind, to, by                    (the invited farmer said no; to = the inviter)',
  duelCancelled: 'kind, by                       (the inviter took the invitation back)',
  duelLapsed: 'kind, to, by                      (nobody answered the invitation in time)',
  grandmaArrived: 'until, by                     (Grandma Hazel is on the farm until `until`)',
  grandmaLeft: 'gift, missed, by                 (she went home: her furniture gift; missed = pids who never met her)',
});

/** Every other event the rules emit: world feedback, predicted for the actor's own actions. */
export const FX_EVENTS = Object.freeze(new Set(['planted', 'harvested', 'sold', 'placed', 'joined',
  ...ECON_EVENT_NAMES, ...Object.keys(GOALS_EVENTS)]));

// ---- small credit primitives (used by every goals module) ---------------------------------------------------

/** Bump a sparse stats counter; remembers the key so afterPass() re-checks the ribbons that read it. */
export function bumpStat(tx, run, pid, key, n = 1) {
  if (!Number.isSafeInteger(n) || n <= 0) return;
  if (pid === null) tx.inc(['farm', 'stats', key], n, { dropZero: true });
  else if (hasPlayer(tx.state, pid)) tx.inc(['players', pid, 'stats', key], n, { dropZero: true });
  else return;
  if (run) run.touched.add(pid === null ? key : `${pid}:${key}`);
}

/** Raise a stats value to at least `v` (best-ever values: the longest drag stroke, the best streak). */
export function maxStat(tx, run, pid, key, v) {
  const base = pid === null ? ['farm', 'stats', key] : ['players', pid, 'stats', key];
  if (pid !== null && !hasPlayer(tx.state, pid)) return;
  if (!Number.isSafeInteger(v) || v <= (tx.get(base) ?? 0)) return;
  tx.set(base, v);
  if (run) run.touched.add(pid === null ? key : `${pid}:${key}`);
}

/** Mark a derived ('state') ribbon value as possibly changed. */
export const touch = (run, key, pid = null) => { if (run) run.touched.add(pid === null ? key : `${pid}:${key}`); };

/**
 * Farm XP (shared, both players' XP summed) with level-up events and rewards. Level-up coins are granted (a
 * reward, never "earned", GDD §5.4), Acorns added, the economy's Level-up Bloom applied (setBloom), and every
 * goals system that unlocks with a level is told (quests, orders, Almanac, mastery catch-up).
 */
export function addFarmXp(tx, ctx, n, run = null) {
  if (!Number.isSafeInteger(n) || n <= 0) return;
  const before = levelFromXp(tx.state.farm.xp);
  tx.inc(['farm', 'xp'], n);
  const after = levelFromXp(tx.state.farm.xp);
  for (let L = before + 1; L <= after; L++) {
    const row = levelRow(L);
    if (row.coins > 0) grant(tx, ctx, row.coins, 'level');
    if (row.acorns > 0) tx.inc(['farm', 'wallet', 'acorns'], row.acorns);
    const unlocks = unlocksAt(L).map((u) => ({ family: u.family, id: u.id }));
    // a Legacy level (L41+, M2) pays its reward from the rotating pool (legacy.js); before Legacy plays, a level with
    // nothing live to unlock pays a Legacy-pool item (RC-14): odd 10 Acorns, even a Golden Seed Packet
    const pool = legacyRewardAt(L);
    let legacy = null;
    if (pool) {
      legacy = payPrize(tx, ctx, run, pool, 'legacy');
      legacyRecord(tx, ctx, L, legacy);
    } else if (!unlocks.length) {
      legacy = L % 2 ? { acorns: BOOSTS.legacyLevel.acorns } : { goldenSeeds: BOOSTS.legacyLevel.goldenSeeds };
      if (legacy.acorns) tx.inc(['farm', 'wallet', 'acorns'], legacy.acorns);
      if (legacy.goldenSeeds) tx.inc(['farm', 'golden'], legacy.goldenSeeds);
    }
    // the unlock banner's list (live content and systems only: unlocksAt never names a later milestone)
    const ev = { e: 'levelUp', scope: 'farm', level: L, coins: row.coins, acorns: row.acorns, by: ctx.pid, unlocks };
    if (legacy) ev.legacy = legacy;
    tx.emit(ev);
    feedAdd(tx, ctx, { k: 'level', level: L });
    // stars already earned are paid on reaching the mastery level, and again at Gold's level (M2: a 4th star a track
    // passed before L30 would otherwise wait for that crop's or recipe's next deed, maybe for ever)
    if (L === MASTERY.unlock || (L === MASTERY.goldFrom && isLive({ m: MASTERY.goldM }))) payAllStars(tx, ctx, run);
    questsOnLevel(tx, ctx, run);
    dailyOnLevel(tx, ctx, L, run);
    fairOnLevel(tx, ctx, L);
    bargeOnLevel(tx, ctx, L);
    folkOnLevel(tx, ctx, L);
    if (L % 5 === 0) addPage(tx, ctx, 'level', { by: ctx.pid === 'sys' ? 'sys' : ctx.pid, ref: L });
    // the Level-up Bloom is a reward of every level (RC-29); since the owner's rule (2026-10-04) it finishes everything
    // growing, so in a multi-level jump the first level finishes the farm and the later ones find nothing to do
    if (BLOOM) BLOOM(tx, ctx, L - 1, L);
  }
  if (after > before) touch(run, 'level');
  // the Seasonal Ribbon Track's points are the farm XP of the season (M2, track.js)
  trackAdd(tx, ctx, run, n);
}

// Hooks rules-economy registers at ITS module load (actions/boosts.js setBloom, actions/decor.js setGift). The rules
// modules import each other in a cycle, so a registration can run before this module's body: `var` without an
// initializer is hoisted and never reset by the body (a `const`/`let` would throw in its temporal dead zone).
/* eslint-disable no-var */
var BLOOM;
var GIFT;
/* eslint-enable no-var */

/** The economy's Level-up Bloom (GDD §3.1 rule 10: everything growing finishes), called once per level-up with
 * (tx, ctx, before, after). */
export function setBloom(fn) { BLOOM = typeof fn === 'function' ? fn : undefined; }
export const getBloom = () => BLOOM;

/**
 * Personal XP to one player (GDD §4.7): a High-five Spark adds +10 % while it lasts (COOP.highFive), rested XP (M2)
 * doubles the base gain while the pool lasts. A personal level-up emits levelUp { scope: 'player' } with the new title.
 */
export function addPersonalXp(tx, ctx, pid, n, run = null) {
  if (!Number.isSafeInteger(n) || n <= 0 || !hasPlayer(tx.state, pid)) return;
  const p = tx.state.players[pid];
  const spark = Number.isSafeInteger(p.spark) && ctx.now < p.spark ? COOP.highFive.xpBonusBp : 0;
  // rested XP (M2): the gain is doubled while the player's pool lasts (personal XP only, never the farm's)
  const k = (spark ? withBp(n, spark) : n) + restedSpend(tx, pid, n);
  const before = personalLevelFromXp(p.xp);
  tx.inc(['players', pid, 'xp'], k);
  const after = personalLevelFromXp(tx.state.players[pid].xp);
  for (let L = before + 1; L <= after; L++) {
    tx.emit({ e: 'levelUp', scope: 'player', pid, level: L, title: titleOf(L), by: ctx.pid });
  }
  if (after > before) touch(run, 'personalLevel', pid);
}

const titleOf = (L) => {
  let t = CONTENT.titles[0].title;
  for (const row of CONTENT.titles) if (row.level <= L && isLive(row)) t = row.title;
  return t;
};

/** Personal XP split 40 % planter / 60 % harvester (GDD §3.1 rule 5, §6.2 #5); all of it when they match. */
export function splitPersonalXp(tx, ctx, xp, planter, harvester, run = null) {
  if (!hasPlayer(tx.state, harvester)) return;
  if (planter === harvester || !hasPlayer(tx.state, planter)) {
    addPersonalXp(tx, ctx, harvester, xp, run);
    return;
  }
  const toPlanter = Math.floor((xp * COOP.teamworkHarvest.planterBp) / 10_000);
  if (toPlanter > 0) addPersonalXp(tx, ctx, planter, toPlanter, run);
  addPersonalXp(tx, ctx, harvester, xp - toPlanter, run);
}

/**
 * Farm XP plus the actor's personal share. `planter` splits the personal part 40/60. A productive deed during an
 * active Together Combo gets +10 % (both farm and personal; capped per player per day, COOP.combo.maxPerDay).
 */
export function creditXp(tx, ctx, run, xp, { by = ctx.pid, planter = null, productive = false } = {}) {
  if (!Number.isSafeInteger(xp) || xp <= 0) return;
  let n = xp;
  if (productive && run && run.comboXp) n = withBp(xp, COOP.combo.xpBonusBp);
  addFarmXp(tx, ctx, n, run);
  if (hasPlayer(tx.state, by)) splitPersonalXp(tx, ctx, n, planter ?? by, by, run);
}

/**
 * Pay a reward bundle: { coins, coinsGranted, xp, acorns, hearts (each player), heartsTo: {pid: n}, items, decor }.
 * Quest coins are EARNED (GDD §5.4 counts quests as earnings); chests, gifts and ribbons are GRANTED.
 */
export function payReward(tx, ctx, run, r, reason) {
  if (!r) return;
  if (r.coins > 0) earn(tx, ctx, r.coins, reason);
  if (r.coinsGranted > 0) grant(tx, ctx, r.coinsGranted, reason);
  if (r.acorns > 0) tx.inc(['farm', 'wallet', 'acorns'], r.acorns);
  if (r.hearts > 0) for (const pid of playerIds(tx.state)) giveHearts(tx, ctx, pid, r.hearts, reason);
  if (r.heartsTo) for (const pid of sortedKeys(r.heartsTo)) giveHearts(tx, ctx, pid, r.heartsTo[pid], reason);
  if (r.items) {
    for (const item of sortedKeys(r.items)) {
      // an item of a later MILESTONE is skipped (never invented); a live item of a later level (Compost before L8)
      // waits in the Barn: a reward is never lost
      if (r.items[item] > 0 && itemOf(item) && isLive(itemOf(item))) intake(tx, item, r.items[item]);
    }
  }
  if (Array.isArray(r.decor)) for (const def of r.decor) giveObject(tx, ctx, def, 1);
  if (r.xp > 0) creditXp(tx, ctx, run, r.xp);
}

/**
 * Pay one M2 prize of the content reward shape (content index.js REWARD_KEYS: the Seasonal Ribbon Track's tiers,
 * Legacy levels): { coinsHoursBp } coins E(level now) x bp (granted) · { items } goods into the Barn · { goldenSeeds: n }
 * Golden Seed Packets · { seedPacket: n } packets of BOOSTS.seedPacket.plantings free plantings of an unlocked crop
 * (the crop rolled on the farm counter `rolls.prize`) · { hearts: n } Hearts to EACH player · { acorns: n } ·
 * { decor: id | 'season' } a free reward decor ('season' = the season's planter, DAILY_GIFT.seasonDecor). A `coat`
 * is the caller's (the track keeps the season's coat). Returns what was paid, resolved (coins, decor id, crop).
 */
export function payPrize(tx, ctx, run, r, reason) {
  const out = {};
  if (!r || typeof r !== 'object') return out;
  const L = levelFromXp(tx.state.farm.xp);
  if (r.coinsHoursBp > 0) {
    const coins = eHours(L, r.coinsHoursBp);
    if (coins > 0) { grant(tx, ctx, coins, reason); out.coins = coins; }
  }
  if (r.acorns > 0) { tx.inc(['farm', 'wallet', 'acorns'], r.acorns); out.acorns = r.acorns; }
  if (r.goldenSeeds > 0) {
    const seeds = r.goldenSeeds * (BOOSTS.goldenSeeds?.seeds ?? 5);
    tx.inc(['farm', 'golden'], seeds);
    out.goldenSeeds = r.goldenSeeds;
  }
  if (r.seedPacket > 0) {
    const crops = [...CONTENT.crops.values()].filter((c) => isLive(c) && c.unlock <= L).map((c) => c.id);
    if (crops.length && tx.state.farm.rolls) {
      const k = tx.state.farm.rolls.prize ?? 0;
      tx.set(['farm', 'rolls', 'prize'], k + 1);
      const crop = crops[Math.floor(ctx.rng('prizeCrop', k) * crops.length)];
      const n = r.seedPacket * (BOOSTS.seedPacket?.plantings ?? 5);
      tx.inc(['farm', 'seeds', crop], n, { dropZero: true });
      out.seeds = { crop, n };
    }
  }
  if (r.items) {
    payReward(tx, ctx, run, { items: r.items }, reason);
    out.items = { ...r.items };
  }
  if (r.hearts > 0) {
    for (const pid of playerIds(tx.state)) giveHearts(tx, ctx, pid, r.hearts, reason);
    out.hearts = r.hearts;
  }
  if (typeof r.decor === 'string') {
    const def = r.decor === 'season' ? DAILY_GIFT.seasonDecor?.[seasonOf(ctx.now, tx.state.meta.tz)] : r.decor;
    if (def && CONTENT.decor.has(def)) { giveObject(tx, ctx, def, 1); out.decor = def; }
  }
  return out;
}

/** Hearts with a feed-free FX event (the UI shows a heart floater on the receiver). */
export function giveHearts(tx, ctx, pid, n, why) {
  if (!(n > 0) || !hasPlayer(tx.state, pid)) return;
  addHearts(tx, pid, n);
  tx.emit({ e: 'hearts', pid, n, why });
}

/**
 * A free object for the build tray (quest decor, saplings, ribbon trophies, mastery signs, challenge prizes).
 * rules-economy owns the tray (`farm.storage`, events.js `stored`); a def of a later milestone is skipped.
 */
export function giveObject(tx, ctx, def, n = 1) {
  const d = CONTENT.decor.get(def) ?? CONTENT.trees.get(def) ?? CONTENT.homes.get(def) ?? CONTENT.buildings.get(def);
  if (!d || !systemLive(d) || !(n > 0)) return;
  if (GIFT) { GIFT(tx, ctx, def, n); return; }
  const storage = tx.get(['farm', 'storage']);
  if (storage && typeof storage === 'object') tx.inc(['farm', 'storage', def], n);
}

/** The economy's build-tray stash for free objects, called with (tx, ctx, def, n). */
export function setGift(fn) { GIFT = typeof fn === 'function' ? fn : undefined; }

// ---- mastery (GDD §4.8) ----------------------------------------------------------------------------------------

/** The def and family of a mastery key (crop id, tree id, animal id or recipe id). */
export function masteryDef(id) {
  for (const family of ['crops', 'trees', 'animals', 'recipes']) {
    const d = CONTENT[family].get(id);
    if (d) return { def: d, family };
  }
  return null;
}

/** Stars the farm has EARNED (and been paid) for a mastery key: 0 before L7, else 0-3 (4 = Gold, M2). */
export const starsOf = (state, id) => {
  const s = state.farm.stars;
  return s && Number.isSafeInteger(s[id]) ? s[id] : 0;
};

/** V and XP of one unit / one deed of a mastery def (for the capped star rewards). */
function unitOf(def, family) {
  if (family === 'crops') return { v: def.sell, xp: def.xp };
  if (family === 'recipes') return { v: def.sell, xp: def.xp };
  const item = itemOf(def.product);
  return { v: item ? item.sell : 0, xp: def.xp };
}

/** Count one more deed toward a mastery track and pay every star it crosses (from MASTERY.unlock). */
export function bumpMastery(tx, ctx, run, id, n = 1) {
  if (!masteryDef(id) || !(n > 0)) return;
  tx.inc(['farm', 'mastery', id], n);
  if (levelFromXp(tx.state.farm.xp) >= MASTERY.unlock) payStars(tx, ctx, run, id);
}

function payStars(tx, ctx, run, id) {
  const m = masteryDef(id);
  if (!m) return;
  const L = levelFromXp(tx.state.farm.xp);
  const count = tx.state.farm.mastery[id] ?? 0;
  const stars = Math.min(masteryStars(m.def, count, L), 3 + (isLive({ m: MASTERY.goldM }) ? 1 : 0));
  const paid = starsOf(tx.state, id);
  if (stars <= paid) return;
  const { v, xp } = unitOf(m.def, m.family);
  for (let s = paid + 1; s <= stars; s++) {
    const r = MASTERY.rewards[s - 1];
    if (!r) break;
    const coins = r.coinsV ? Math.min(r.coinsV * v, eHours(L, r.coinsHoursBp)) : 0;
    const x = r.xpX ? Math.min(r.xpX * xp, Math.floor(eHours(L, r.xpHoursBp) / 8)) : 0;
    const effect = MASTERY.effects[m.family]?.[s - 1];
    payReward(tx, ctx, run, { coinsGranted: coins, acorns: r.acorns ?? 0, xp: x,
      decor: effect && effect.decor ? [effect.decor] : undefined }, 'mastery');
    tx.emit({ e: 'mastery', id, family: m.family, star: s, by: ctx.pid });
  }
  tx.set(['farm', 'stars', id], stars);
  if (stars >= 3) touch(run, m.family === 'recipes' ? 'recipesStar3' : m.family === 'crops' ? 'cropsStar3' : 'star3');
  if (stars >= 4) touch(run, 'goldStars');                // Golden Touch (M2): items at Gold ★
}

/** On reaching MASTERY.unlock: every track already past a threshold is paid now (no star is ever lost). */
function payAllStars(tx, ctx, run) {
  for (const id of sortedKeys(tx.state.farm.mastery)) payStars(tx, ctx, run, id);
}

// ---- the reducer --------------------------------------------------------------------------------------------

const valueOf = (item) => itemOf(item)?.sell ?? 0;

/** Value a crafted good adds: out x V - the value of its inputs (Couple Challenge craftAdded). */
function addedValue(recipeId, qty) {
  const r = recipeOf(recipeId);
  if (!r || !r.inputs) return 0;
  let inputs = 0;
  for (const [item, n] of Object.entries(r.inputs)) inputs += valueOf(item) * n;
  const crafts = Math.max(1, Math.floor(qty / Math.max(1, r.out)));
  return Math.max(0, (r.sell * r.out - inputs) * crafts);
}

/** Deeds: the one vocabulary quests, the Almanac, the Together task, the Couple Challenge and the tutorial count. */
function deed(tx, ctx, run, d) {
  if (!(d.n > 0)) return;
  questDeed(tx, ctx, run, d);
  dailyDeed(tx, ctx, run, d);
  tutorialDeed(tx, ctx, run, d);
}

/** Friendly Duel scoring (M2): a deed of the duel kind's `count` ('harvest:pumpkin' ...) credits `who`. */
function duelDeed(tx, ctx, verb, ref, who, n) {
  const d = tx.state.farm.duel?.cur;
  if (!d || !d.ok) return;
  const k = DUEL_KINDS().find((x) => x.id === d.kind);
  if (k && k.count === `${verb}:${ref}`) duelScore(tx, ctx, d.kind, who, n);
}

/** A deed from a goals module outside the reducer's switch (the Fair ceremony's "reach fair_silver"). */
export const goalDeed = (tx, ctx, run, d) => deed(tx, ctx, run, d);

/**
 * The farm's `made` log (item -> the farm day it was last made), kept while a system that reads it plays: the River
 * Barge and the Town Projects ask only for goods made in the last 14 days (GDD §5.7, §5.9). One write per item a day.
 */
function madeAdd(tx, ctx, item) {
  if (!tx.state.farm.made || !itemOf(item) || !(systemLive(BARGE) || systemLive(TOWN_PROJECT_RULES))) return;
  const day = dayOf(tx.state, ctx.now);
  if (tx.state.farm.made[item] !== day) tx.set(['farm', 'made', item], day);
}

/** Collection rolls for an event (album.js): `sources` are the set `from` keys it matches. */
const roll = (tx, ctx, run, sources, by, n = 1) => albumRoll(tx, ctx, run, sources, by, { n });

function productive(tx, ctx, run, by) {
  // once per action: the Together Combo (+10 % XP while capped, meter, Combo Kings ribbon)
  if (run.comboDone || ctx.pid === 'sys' || by !== ctx.pid) return;
  run.comboDone = true;
  const partner = comboWith(ctx);
  if (!partner || !hasPlayer(tx.state, partner)) return;
  const day = dayOf(tx.state, ctx.now);
  run.comboXp = capTake(tx, ctx.pid, 'combo', COOP.combo.maxPerDay, day) > 0;
  if (!(tx.state.farm.stats.comboActions > 0)) addPage(tx, ctx, 'together', { by: ctx.pid, ref: partner });
  bumpStat(tx, run, null, 'comboActions');
  bumpStat(tx, run, ctx.pid, 'comboActions');
  comboMeter(tx, ctx, run, day);
}

function comboMeter(tx, ctx, run, day) {
  const c = tx.get(['farm', 'coop', 'combo']);
  const n = c && c.d === day ? c.n + 1 : 1;
  // `at`: the last combo action (server time); the client hides "got there first" toasts within COOP.combo.windowMs
  tx.set(['farm', 'coop', 'combo'], { d: day, n, at: ctx.now });
  for (const step of COOP.combo.meter) {
    if (step.at !== n) continue;
    payReward(tx, ctx, run, { items: step.items, hearts: step.hearts }, 'combo');
    if (step.collectionRoll) albumAnyRoll(tx, ctx, run, ctx.pid);
    tx.emit({ e: 'together', kind: 'combo', at: n, by: ctx.pid });
  }
}

function handle(tx, ctx, run, ev) {
  const by = typeof ev.by === 'string' ? ev.by : ctx.pid;
  const actor = hasPlayer(tx.state, by) ? by : null;
  switch (ev.e) {
    case 'harvested': {
      const crop = cropOf(ev.crop);
      if (!crop) break;
      const qty = ev.qty ?? 0;
      productive(tx, ctx, run, by);
      bumpStat(tx, run, null, `harvest.${ev.crop}`);
      bumpStat(tx, run, null, 'cropsHarvested');
      if (actor) bumpStat(tx, run, actor, `harvest.${ev.crop}`);
      if (hasPlayer(tx.state, ev.planter)) bumpStat(tx, run, ev.planter, 'plantingsHarvested');
      if (crop.growMs >= 8 * 3_600_000) bumpStat(tx, run, null, 'harvestLong');
      if (ev.fresh) bumpStat(tx, run, null, 'freshHarvests');
      if (ev.ribbon) bumpStat(tx, run, null, 'prizedHarvests');
      const hour = localHour(ctx.now, tx.state.meta.tz);
      if (hour >= 4 && hour < 7) bumpStat(tx, run, null, 'earlyHarvests');
      inSeason(tx, ctx, run, crop);
      bumpMastery(tx, ctx, run, ev.crop);
      // the Grower's +5 % crop XP (M2 perk) is the harvester's own
      creditXp(tx, ctx, run, withBp(ev.xp ?? 0, perkXpBp(tx.state, by, 'crop')),
        { by, planter: ev.planter ?? by, productive: true });
      // Friendly Duel "pumpkins": the units count for the farmer who PLANTED the plot (M2, duel.js)
      duelDeed(tx, ctx, 'harvest', ev.crop, hasPlayer(tx.state, ev.planter) ? ev.planter : by, qty);
      const stroke = feedAdd(tx, { ...ctx, pid: by }, { k: 'harvest', item: ev.crop, q: qty, p: 1 });
      if (actor) maxStat(tx, run, actor, 'bestHarvestStroke', stroke.row.p ?? 0);   // Clean Sweep (hidden)
      if (stroke.fresh && actor && hasPlayer(tx.state, ev.planter) && ev.planter !== actor) {
        teamworkHearts(tx, ctx, actor, ev.planter);
      }
      deed(tx, ctx, run, { verb: 'harvest', ref: ev.crop, n: qty, by, v: qty * crop.sell });
      if (ev.ribbon) {
        deed(tx, ctx, run, { verb: 'harvest', ref: 'prized', n: 1, by });
        const p10 = fairAdd(tx, ctx, by, prizedCropPoints10(tx.state, ev.crop));
        if (p10 > 0) tx.emit({ e: 'fairPoints', p10, total: tx.state.farm.fair.cur.p, why: 'crop', by });
      }
      madeAdd(tx, ctx, ev.crop);
      const src = [];
      if ((crop.classes ?? []).includes('flower')) src.push('harvest:flower');
      if (crop.growMs >= 4 * 3_600_000) src.push('harvest:long');
      if (src.length) roll(tx, ctx, run, src, by);
      break;
    }
    case 'picked': {
      const tree = treeOf(ev.tree);
      productive(tx, ctx, run, by);
      bumpStat(tx, run, null, 'treesHarvested');
      bumpStat(tx, run, null, `pick.${ev.item}`);
      if (ev.ribbon) bumpStat(tx, run, null, 'prizedFruit');
      bumpMastery(tx, ctx, run, ev.tree);
      creditXp(tx, ctx, run, withBp(ev.xp ?? tree?.xp ?? 0, perkXpBp(tx.state, by, 'tree')), { by, productive: true });
      feedAdd(tx, { ...ctx, pid: by }, { k: 'tree', item: ev.item, q: ev.qty });
      const v = (ev.qty ?? 0) * valueOf(ev.item);
      deed(tx, ctx, run, { verb: 'harvest', ref: ev.item, n: ev.qty, by, v, fruit: true });
      deed(tx, ctx, run, { verb: 'collect', ref: ev.item, n: ev.qty, by, v: 0, fruit: true });
      if (ev.ribbon) {
        const p10 = fairAdd(tx, ctx, by, prizedFruitPoints10(tx.state, ev.item));
        if (p10 > 0) tx.emit({ e: 'fairPoints', p10, total: tx.state.farm.fair.cur.p, why: 'fruit', by });
      }
      madeAdd(tx, ctx, ev.item);
      touch(run, 'heirloomTrees');
      if (tree && tree.flowering) roll(tx, ctx, run, ['harvest:flowering_tree'], by);
      break;
    }
    case 'chopped':
      productive(tx, ctx, run, by);
      bumpStat(tx, run, null, 'treesChopped');
      creditXp(tx, ctx, run, ev.xp ?? 0, { by, productive: true });
      feedAdd(tx, { ...ctx, pid: by }, { k: 'tree', item: ev.item, q: ev.qty });
      deed(tx, ctx, run, { verb: 'collect', ref: ev.item, n: ev.qty, by, v: 0 });
      roll(tx, ctx, run, ['chop'], by);
      break;
    case 'cleared':
      bumpStat(tx, run, null, 'debrisCleared');
      if (actor) bumpStat(tx, run, actor, 'debrisCleared');
      creditXp(tx, ctx, run, ev.xp ?? 0, { by });
      deed(tx, ctx, run, { verb: 'clear', ref: 'debris', n: 1, by });
      teamwork(tx, run, ev.pair);
      roll(tx, ctx, run, ['clear', `clear:${ev.def}`], by);
      break;
    case 'collected': {
      productive(tx, ctx, run, by);
      bumpStat(tx, run, null, 'animalsCollected');
      bumpStat(tx, run, null, `collect.${ev.item}`);
      if (ev.good) bumpStat(tx, run, null, 'prizedGoods');
      bumpMastery(tx, ctx, run, ev.animal);
      creditXp(tx, ctx, run, withBp(ev.xp ?? animalOf(ev.animal)?.xp ?? 0, perkXpBp(tx.state, by, 'animal')),
        { by, productive: true });
      feedAdd(tx, { ...ctx, pid: by }, { k: 'collect', item: ev.item, q: ev.qty });
      deed(tx, ctx, run, { verb: 'collect', ref: ev.item, n: ev.qty, by, v: (ev.qty ?? 0) * valueOf(ev.item),
        animal: true });
      madeAdd(tx, ctx, ev.item);
      roll(tx, ctx, run, [`collect:${ev.animal}`], by);
      break;
    }
    case 'fed':
      productive(tx, ctx, run, by);
      bumpStat(tx, run, null, 'animalsFed');
      feedAdd(tx, { ...ctx, pid: by }, { k: 'tend', q: 1 });
      deed(tx, ctx, run, { verb: 'tend', ref: ev.animal, n: 1, by });
      break;
    case 'petted': {
      const n = Array.isArray(ev.ids) ? ev.ids.length : 0;
      if (actor) bumpStat(tx, run, actor, 'animalsPetted', n);
      deed(tx, ctx, run, { verb: 'pet', ref: 'animal', n, by });
      break;
    }
    case 'prized':
      if (!(tx.state.farm.stats.prizedAnimals > 0)) addPage(tx, ctx, 'prized', { by, ref: ev.animal });
      bumpStat(tx, run, null, 'prizedAnimals');
      break;
    case 'crafted': {
      // the Compost Bin's passive tray (maker 'sys') is no recipe, even though M1b has a 'compost' recipe (Manure ->
      // Compost): no Recipe Card roll, no "make Compost" deed, no craft perk (wave-2 QA RC-17)
      const passive = ev.maker === 'sys';
      const recipe = passive ? null : recipeOf(ev.recipe);
      productive(tx, ctx, run, by);
      const isFeed = !recipe && CONTENT.feeds.has(ev.recipe);
      const qty = ev.qty ?? 0;
      if (isFeed) bumpStat(tx, run, null, 'feedMade', qty);
      else if (ev.building === 'compost_bin' || ev.item === 'compost' && !recipe) {
        bumpStat(tx, run, null, 'compostMade', qty);
        // "Empty it twice" (C2's letter): one emptying of the bin's tray is one deed, whatever it held
        deed(tx, ctx, run, { verb: 'empty', ref: 'compost_bin', n: 1, by });
      } else {
        bumpStat(tx, run, null, 'goodsCrafted', qty);
        bumpStat(tx, run, null, `craft.${ev.recipe}`, 1);
        if (recipe && recipe.tier === 'T4') bumpStat(tx, run, null, 'premiumGoodsMade', qty);
        bumpMastery(tx, ctx, run, ev.recipe);
      }
      // Grandma's Recipe Cards set: +2 % craft XP on recipes (GDD §5.5 perk); the Artisan's +5 % (M2) is the actor's
      const craftBp = recipe ? perkOf(tx.state, 'craftXpBp') + perkXpBp(tx.state, by, 'craft') : 0;
      creditXp(tx, ctx, run, withBp(ev.xp ?? 0, craftBp), { by, productive: true });
      // Friendly Duel "pies": a Pie Oven good counts for the farmer who queued it (M2, duel.js)
      if (recipe) duelDeed(tx, ctx, 'craft', ev.building, hasPlayer(tx.state, ev.maker) ? ev.maker : by, qty);
      feedAdd(tx, { ...ctx, pid: by }, { k: 'craft', item: ev.item, q: qty });
      if (!passive) {
        deed(tx, ctx, run, { verb: 'make', ref: ev.item, n: qty, by, add: isFeed ? 0 : addedValue(ev.recipe, qty),
          recipe: isFeed ? null : ev.recipe, feed: isFeed });
      }
      if (recipe) {
        madeAdd(tx, ctx, ev.item);
        roll(tx, ctx, run, ['craft', `craft:${ev.building}`], by);
      }
      break;
    }
    case 'composted':
      bumpStat(tx, run, null, 'composted');
      if (ev.kind === 'crop') deed(tx, ctx, run, { verb: 'fertilize', ref: 'plot', n: 1, by });
      break;
    case 'fertilized':
      // wave 4: Fertilizer is the richer Compost: it counts for the same "fertilize" tasks
      bumpStat(tx, run, null, 'fertilized');
      if (ev.kind === 'crop') deed(tx, ctx, run, { verb: 'fertilize', ref: 'plot', n: 1, by });
      break;
    case 'compostPoints':
      // Compost dropped into the bin's tray is counted when it is collected (crafted), not here.
      break;
    case 'watered':
      bumpStat(tx, run, null, 'watered');
      if (ev.tend && actor) {
        const stroke = feedAdd(tx, { ...ctx, pid: by }, { k: 'water', q: 1 });
        if (stroke.fresh) {
          const day = dayOf(tx.state, ctx.now);
          const pt = COOP.partnerTend;
          const k = capTake(tx, actor, 'tendHearts', pt.heartsPerDay, day, pt.heartsPerStroke);
          if (k > 0) { addHearts(tx, actor, k); tx.emit({ e: 'hearts', pid: actor, n: k, why: 'tend' }); }
        }
      }
      if (ev.kind !== 'baby') deed(tx, ctx, run, { verb: 'water', ref: ev.kind, n: 1, by });
      break;
    case 'planted':
      bumpStat(tx, run, null, `plant.${ev.crop}`);
      if (actor) bumpStat(tx, run, actor, 'plantings');
      deed(tx, ctx, run, { verb: 'plant', ref: ev.crop, n: 1, by });
      break;
    case 'placed': {
      const kind = ev.kind;
      // holdings ribbons count SETTLED objects (past the undo window): ribbons.js re-checks them as receipts expire
      if (kind === 'building' || kind === 'home') touch(run, 'buildsAndSlots');
      if (kind === 'decor') { touch(run, `placed.${ev.def}`); if (actor) bumpStat(tx, run, actor, 'decorPlaced'); }
      if (kind === 'tree') { touch(run, 'treeSpecies'); touch(run, 'grovesFormed'); }
      bigPurchase(tx, ctx, by, ev);
      deed(tx, ctx, run, { verb: kind === 'tree' ? 'plant' : 'place', ref: ev.def, n: 1, by });
      break;
    }
    case 'moved': case 'movedBack':
      if (treeOf(ev.def)) touch(run, 'grovesFormed');
      break;
    case 'removed': case 'restored':
      touch(run, 'treeSpecies'); touch(run, 'animalSpecies'); touch(run, 'grovesFormed'); touch(run, 'buildsAndSlots');
      break;
    case 'bought':
      touch(run, 'animalSpecies');
      bigPurchase(tx, ctx, by, Number.isSafeInteger(ev.step) ? { ...ev, coins: (ev.coins ?? 0) + ev.step } : ev);
      deed(tx, ctx, run, { verb: 'buy', ref: ev.def, n: 1, by });
      break;
    case 'slotUpgraded':
      bumpStat(tx, run, null, 'slotsBought');
      touch(run, 'buildsAndSlots');
      bigPurchase(tx, ctx, by, ev, 'slot');                  // "added a slot to the Bakery", not "bought" (RC-20)
      deed(tx, ctx, run, { verb: 'upgrade', ref: 'slot', n: 1, by });
      break;
    case 'homeUpgraded':
      bigPurchase(tx, ctx, by, ev);
      break;
    // ---- wave 4b (the owners' wish list, 2026-10-05) -------------------------------------------------------------
    case 'crateOpened': {
      // the crate's XP is the opener's (farm XP in full, their personal share); a crate that went to the Barn by
      // itself ('sys') gives the farm its XP only
      bumpStat(tx, run, null, 'cratesOpened');
      creditXp(tx, ctx, run, ev.xp ?? 0, { by });
      const row = { k: 'crate', c: ev.coins ?? 0 };
      if (ev.auto) row.auto = 1;
      if (ev.acorns) row.a = ev.acorns;
      if (ev.goldenSeeds) row.g = ev.goldenSeeds;
      // goods (Fertilizer) on the crate's line; a collection find has its own album line
      if (ev.item && ev.qty) Object.assign(row, { item: ev.item, q: ev.qty });
      if (ev.decor) row.def = ev.decor;
      feedAdd(tx, { ...ctx, pid: by }, row);
      break;
    }
    case 'relicBought':
      feedAdd(tx, { ...ctx, pid: by }, { k: 'relic', def: ev.relic, a: ev.acorns ?? 0 });
      break;
    case 'farmhandDone':
      feedAdd(tx, { ...ctx, pid: by }, { k: 'relic', def: 'farmhand', q: ev.n ?? 0 });
      break;
    case 'timeTurned':
      feedAdd(tx, { ...ctx, pid: by }, { k: 'relic', def: 'time_turner', q: ev.n ?? 0 });
      break;
    case 'barnUpgraded':
      bigPurchase(tx, ctx, by, { ...ev, def: 'barn' });
      deed(tx, ctx, run, { verb: 'upgrade', ref: 'barn', n: 1, by });
      break;
    case 'expanded':
      bumpStat(tx, run, null, 'expansionsBought');
      feedAdd(tx, { ...ctx, pid: by }, { k: 'expand', def: ev.expansion, c: ev.coins ?? 0 });
      deed(tx, ctx, run, { verb: 'expand', ref: ev.expansion, n: 1, by });
      break;
    case 'sold': {
      bumpStat(tx, run, null, `sold.${ev.item}`, ev.qty);
      if (ev.demand > 0) bumpStat(tx, run, null, 'demandSold', ev.demand);
      feedAdd(tx, { ...ctx, pid: by }, { k: 'sell', item: ev.item, q: ev.qty, c: ev.coins ?? 0 });
      // a "Sell surplus" clean-up can be undone for 10 minutes (RC-25): it is no deed, so a sell-and-undo loop
      // never finishes a story card ("Sell 10 Wheat" is taught at the Market Stand)
      if (!ev.surplus) deed(tx, ctx, run, { verb: 'sell', ref: ev.item, n: ev.qty, by });
      if (ev.demand > 0) deed(tx, ctx, run, { verb: 'sell', ref: 'demand', n: ev.demand, by });
      // Old Coins (M2): one roll per OLD_COIN_ROLL_COINS coins sold, at least one per sale (GDD §5.5 v2 C8); a
      // surplus sale can be bought back for 10 minutes, so it rolls nothing
      if (!ev.surplus && ev.coins > 0) roll(tx, ctx, run, ['sell'], by, Math.max(1, Math.floor(ev.coins / 100)));
      break;
    }
    case 'purchased':
      bigPurchase(tx, ctx, by, { ...ev, def: ev.item });
      break;
    case 'keepSet':
      feedAdd(tx, { ...ctx, pid: by }, { k: 'keep', item: ev.item, q: ev.n });
      break;
    case 'wishBought':
      bumpStat(tx, run, null, 'wishesBought');
      // the ribbon counts DISTINCT things (RC-15): a wish copy has no undo receipt, so it is spent for good
      bumpStat(tx, run, null, `wish.${ev.def}`);
      feedAdd(tx, { ...ctx, pid: by }, { k: 'wish', what: 'bought', def: ev.def, c: ev.coins ?? 0 });
      break;
    case 'wishDeposit': case 'wishWithdrawn':
      // rows name the wished thing (read by the action before any move, RC-20)
      feedAdd(tx, { ...ctx, pid: by }, { k: 'wish', what: ev.e === 'wishDeposit' ? 'deposit' : 'withdraw', id: ev.id,
        def: ev.def, c: ev.coins ?? 0 });
      break;
    case 'wishAsked': case 'wishDenied':
      feedAdd(tx, { ...ctx, pid: by }, { k: 'wish', what: ev.e === 'wishAsked' ? 'asked' : 'denied', id: ev.id,
        def: ev.def, c: ev.coins ?? 0 });
      break;
    case 'hurried':
      // an Acorn spend is always a feed line (§6.4); Hurry was the one that had none (RC-20)
      if (ev.acorns > 0) feedAdd(tx, { ...ctx, pid: by }, { k: 'buy', what: 'hurry', def: ev.def, q: 1, c: 0, a: ev.acorns });
      break;
    case 'grewUp':
      bumpStat(tx, run, null, 'babiesRaised');
      deed(tx, ctx, run, { verb: 'raise', ref: ev.animal, n: 1, by });
      break;
    case 'duet': {
      // the economy's celebration when a duet recipe starts together: +1 Heart each, Duet ribbon (T)
      const a = ev.a ?? ev.by;
      const b = ev.b ?? ctx.pid;
      bumpStat(tx, run, null, 'duets');
      for (const pid of [a, b]) {
        if (!hasPlayer(tx.state, pid)) continue;
        bumpStat(tx, run, pid, 'duets');
        giveHearts(tx, ctx, pid, COOP.duet.hearts, 'duet');
      }
      deed(tx, ctx, run, { verb: 'together', ref: 'duet', n: 1, by });
      break;
    }
    case 'orderFilled': {
      // the fill action moved goods, coins and Acorns; the credit is here
      for (const item of sortedKeys(ev.items ?? {})) bumpStat(tx, run, null, `delivered.${item}`, ev.items[item]);
      creditXp(tx, ctx, run, ev.xp, { by });
      helpFlagFilled(tx, ctx, run, by, ev.helped);
      meterAdd(tx, ctx, run, ev.value ?? 0);
      if (ev.golden && ev.giver) befriend(tx, ctx, ev.giver, TOWNSFOLK.friendship.goldenOrder, 'golden');
      feedAdd(tx, { ...ctx, pid: by }, { k: 'order', c: ev.coins, x: ev.xp, g: ev.golden ? 1 : 0 });
      bumpStat(tx, run, null, 'ordersQ', ev.simple ? 1 : 4);
      if (actor) bumpStat(tx, run, actor, 'ordersFilled');
      duelDeed(tx, ctx, 'fill', 'order', by, ev.simple ? 1 : 4);      // Friendly Duel "orders" (quarters)
      deed(tx, ctx, run, { verb: 'fill', ref: 'order', n: ev.simple ? 1 : 4, by, v: ev.value ?? 0 });
      break;
    }
    case 'levelUp':
      if (ev.scope === 'farm') touch(run, 'level');
      break;
    case 'together':
      if (ev.kind === 'goldenHour' || ev.kind === 'highFive') {
        const stat = ev.kind === 'goldenHour' ? 'goldenHours' : 'highFives';
        bumpStat(tx, run, null, stat);
        const benchDef = ev.kind === 'goldenHour' ? tx.state.farm.objects[ev.bench]?.def : null;
        for (const pid of [ev.a, ev.b]) {
          if (!hasPlayer(tx.state, pid)) continue;
          bumpStat(tx, run, pid, stat);
          if (ev.hearts > 0) giveHearts(tx, ctx, pid, ev.hearts, ev.kind);
          if (benchDef) deed(tx, ctx, run, { verb: 'sit', ref: benchDef, n: 1, by: pid });
          const ref = ev.kind === 'goldenHour' ? 'bench' : 'high_five';
          deed(tx, ctx, run, { verb: 'together', ref, n: 1, by: pid });
        }
        roll(tx, ctx, run, ['coop'], ev.a);
      }
      break;
    case 'keepsake':
      if (actor) bumpStat(tx, run, actor, 'keepsakesGiven');
      for (const pid of [by, ev.to]) giveHearts(tx, ctx, pid, COOP.keepsake.hearts, 'keepsake');
      feedAdd(tx, { ...ctx, pid: by }, { k: 'keepsake', item: ev.item, to: ev.to });
      roll(tx, ctx, run, ['coop'], by);
      break;
    case 'thanked':
      if (actor) bumpStat(tx, run, actor, 'thanksSent');
      break;
    case 'noted':
      feedAdd(tx, { ...ctx, pid: by }, { k: 'note', x: ev.x, z: ev.z });
      break;
    case 'named':
      feedAdd(tx, { ...ctx, pid: by }, { k: 'name', what: ev.what, text: ev.text });
      if (ev.what === 'farm') deed(tx, ctx, run, { verb: 'name', ref: 'farm', n: 1, by });
      // the Memory Book: the farm's first name and an animal's first name (GDD §5.9; a rename is no new page)
      if (ev.first) addPage(tx, ctx, ev.what, { by, ref: ev.id ?? null, text: ev.text });
      if (ev.what === 'animal' && actor) {
        // derived from farm.names over settled animals (ribbons.js): a buy-name-undo loop counts nothing
        touch(run, 'animalsNamed', actor);
        if (ev.species) touch(run, `named.${ev.species}`, actor);
      }
      break;
    case 'weekRolled':
      touch(run, 'farmWeeksBest');
      break;
    case 'questDelivered':
      completeQuest(tx, ctx, run, ev.id);
      deed(tx, ctx, run, { verb: 'deliver', ref: 'quest', n: 1, by });
      break;
    // ---- M1b: the County Fair, the River Barge, the townsfolk board, the album (actions/fair, barge, folk, album)
    case 'fairEntered': {
      const it = itemOf(ev.item);
      bumpStat(tx, run, null, 'fairEntries', ev.qty);
      deed(tx, ctx, run, { verb: 'enter', ref: 'fair', n: ev.qty, by });
      if (it && it.tier === 'T4') deed(tx, ctx, run, { verb: 'enter', ref: 'hamper', n: ev.qty, by });
      feedAdd(tx, { ...ctx, pid: by }, { k: 'fair', item: ev.item, q: ev.qty, p: ev.p10 });
      roll(tx, ctx, run, ['enter:fair'], by, ev.qty);
      break;
    }
    case 'bargeLoaded':
      creditXp(tx, ctx, run, ev.xp, { by });
      bumpStat(tx, run, null, 'cratesLoaded');
      if (actor) bumpStat(tx, run, actor, 'cratesLoaded');
      helpFlagFilled(tx, ctx, run, by, ev.helped);
      feedAdd(tx, { ...ctx, pid: by }, { k: 'barge', item: ev.item, q: ev.qty, c: ev.coins });
      deed(tx, ctx, run, { verb: 'load', ref: 'crate', n: 1, by, v: ev.coins });
      break;
    case 'bargeRow':
      bumpStat(tx, run, null, 'bargeRows');
      // Equal Partners (M2): the week's first row both farmers loaded counts for the ribbon (farm + each one's part)
      if (ev.eqWeek) {
        bumpStat(tx, run, null, 'equalWeeks');
        for (const pid of (ev.loaders ?? []).filter((p) => hasPlayer(tx.state, p))) bumpStat(tx, run, pid, 'equalWeeks');
      }
      feedAdd(tx, { ...ctx, pid: by }, { k: 'barge', row: ev.row + 1, c: ev.coins, a: ev.acorns });
      deed(tx, ctx, run, { verb: 'load', ref: 'row', n: 1, by });
      break;
    case 'folkFilled':
      for (const item of sortedKeys(ev.items ?? {})) bumpStat(tx, run, null, `delivered.${item}`, ev.items[item]);
      creditXp(tx, ctx, run, ev.xp, { by });
      helpFlagFilled(tx, ctx, run, by, ev.helped);
      bumpStat(tx, run, null, 'folkFilled');
      feedAdd(tx, { ...ctx, pid: by }, { k: 'folk', npc: ev.npc, c: ev.coins });
      befriend(tx, ctx, ev.npc, TOWNSFOLK.friendship.request, 'request');
      break;
    case 'fairCeremony':
      if (ev.medal) {
        bumpStat(tx, run, null, 'medalWeeks');
        maxStat(tx, run, null, 'bestMedal', ev.rank);
        if (ev.rank >= MEDAL_RANKS.indexOf('silver1') + 1) {
          deed(tx, ctx, run, { verb: 'reach', ref: 'fair_silver', n: 1, by: 'sys' });
        }
        if (ev.medal === 'platinum') bumpStat(tx, run, null, 'fair.platinum');
      }
      // the NPC league (M2): League Climber reads the best league; "reach League 2" is a state task (quests.js)
      if (ev.league) {
        maxStat(tx, run, null, 'bestLeague', ev.league.to);
        run.questDirty = true;
      }
      break;
    case 'bargeCastOff':
      maxStat(tx, run, null, 'bargeStreak', ev.streak);
      break;
    case 'albumFind':
      if (!ev.dup) bumpStat(tx, run, null, 'albumItems');
      break;
    case 'albumSet':
      bumpStat(tx, run, null, 'setsCompleted');
      break;
    // ---- M1b economy systems (rules-economy's events; GDD §5.4 ribbons 7, 12, 35, 39, 40, 56, 63)
    case 'giantFelled': {
      bumpStat(tx, run, null, 'giantsFelled');
      // a Giant is +25 Fair points (GDD §6.2 #8) for the week's Fair, shared by chop share when felled together
      // (wave-2 QA RC-09; an event without `hits` credits whoever felled it)
      const pts = (COOP.giant?.fairPoints ?? 0) * 10;
      const split = ev.hits && typeof ev.hits === 'object' ? shareOut(pts, ev.hits) : { [by]: pts };
      for (const pid of Object.keys(split).sort()) {
        if (split[pid] <= 0) continue;
        const p10 = fairAdd(tx, ctx, pid, split[pid]);
        if (p10 > 0) tx.emit({ e: 'fairPoints', p10, total: tx.state.farm.fair.cur.p, why: 'giant', by: pid });
      }
      if (teamwork(tx, run, ev.pair)) {
        for (const pid of ev.pair) deed(tx, ctx, run, { verb: 'together', ref: 'giant', n: 1, by: pid });
      }
      feedAdd(tx, { ...ctx, pid: by }, { k: 'giant', crop: ev.crop, q: ev.qty ?? 0 });
      break;
    }
    case 'donated':
      if (ev.helped) helpFlagFilled(tx, ctx, run, by, ev.helped);
      break;
    case 'bundleDone':
      bumpStat(tx, run, null, 'bundlesDone');
      feedAdd(tx, { ...ctx, pid: by }, { k: 'restore', project: ev.project, bundle: ev.bundle });
      deed(tx, ctx, run, { verb: 'complete', ref: 'bundle', n: 1, by });
      break;
    case 'projectDone':
      bumpStat(tx, run, null, 'projectsDone');
      feedAdd(tx, { ...ctx, pid: by }, { k: 'restore', project: ev.project, done: 1 });
      addPage(tx, ctx, 'project', { by, ref: ev.project });
      deed(tx, ctx, run, { verb: 'complete', ref: 'project', n: 1, by });
      break;
    case 'townBuilt':
      bumpStat(tx, run, null, 'townProjects');
      feedAdd(tx, { ...ctx, pid: 'sys' }, { k: 'town', id: ev.id });
      addPage(tx, ctx, 'town', { by, ref: ev.id });
      deed(tx, ctx, run, { verb: 'complete', ref: 'town_project', n: 1, by });
      break;
    case 'beautyStar':
      maxStat(tx, run, null, 'beautyStars', ev.stars);
      run.questDirty = true;                         // "reach N beauty stars" reads the best count (quests.js)
      break;
    case 'heirloom':
      touch(run, 'heirloomTrees');                   // Heirloom Keeper reads the farm's Heirloom trees (ribbons.js)
      break;
    case 'petFind':
      // a pet's find of "a collection roll" (rules-economy's pets): one roll of an open set for the pet's owner
      if (ev.roll === true && hasPlayer(tx.state, ev.pid)) albumAnyRoll(tx, ctx, run, ev.pid);
      break;
    case 'memoryPage':
      if (ev.counts) bumpStat(tx, run, null, 'memoryPages');
      break;
    case 'petFed':
      if (hasPlayer(tx.state, ev.pid)) bumpStat(tx, run, ev.pid, 'petFedDays');
      break;
    // ---- M2 economy systems (rules-economy's events; quests C8 "breed", H6 "fishing together", Pond Treasures)
    case 'bred':
      bumpStat(tx, run, null, 'babiesBred');
      deed(tx, ctx, run, { verb: 'breed', ref: ev.species ?? ev.animal, n: 1, by });
      break;
    case 'fishCaught':
      // a landed fish (rules-economy's fishing.js): the dock's tally and one `fish` roll of the album (Pond Treasures)
      bumpStat(tx, run, null, 'fishCaught');
      roll(tx, ctx, run, ['fish'], hasPlayer(tx.state, ev.pid) ? ev.pid : by);
      break;
    case 'fishTogether':
      // two farmers casting at one spot within the window: "Gone Fishing" (H6 together:dock) for each of them
      for (const pid of (Array.isArray(ev.pids) ? [...ev.pids] : []).sort()) {
        if (hasPlayer(tx.state, pid)) deed(tx, ctx, run, { verb: 'together', ref: 'dock', n: 1, by: pid });
      }
      break;
    default:
      break;
  }
}

/**
 * A big felling (giant crop, big stump, boulder) whose last chops came from two distinct players (the economy's
 * `pair`): the Teamwork ribbon (T) counts it for the farm and each player. Returns true when it counted.
 */
function teamwork(tx, run, pair) {
  if (!Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1]) return false;
  if (!pair.every((p) => hasPlayer(tx.state, p))) return false;
  bumpStat(tx, run, null, 'teamworkFelled');
  for (const pid of pair) bumpStat(tx, run, pid, 'teamworkFelled');
  return true;
}

/** The OTHER player filled a help flag (orders, barge crates, GDD §6.2 #3): +1 Heart each, the ribbon, the deed. */
function helpFlagFilled(tx, ctx, run, by, owner) {
  if (!hasPlayer(tx.state, owner) || owner === by) return;
  bumpStat(tx, run, null, 'partnerFlagsFilled');
  if (hasPlayer(tx.state, by)) bumpStat(tx, run, by, 'partnerFlagsFilled');
  for (const pid of [by, owner]) giveHearts(tx, ctx, pid, COOP.helpFlags.hearts, 'flag');
  deed(tx, ctx, run, { verb: 'together', ref: 'help_flag', n: 1, by });
  roll(tx, ctx, run, ['coop'], by);
}

/** Teamwork harvest hearts (GDD §6.2 #5): +1 Heart each per stroke on the partner's planting, max 10 a day. */
function teamworkHearts(tx, ctx, harvester, planter) {
  const day = dayOf(tx.state, ctx.now);
  for (const pid of [harvester, planter]) {
    const th = COOP.teamworkHarvest;
    const k = capTake(tx, pid, 'teamHearts', th.heartsPerDay, day, th.heartsPerStroke);
    if (k > 0) { addHearts(tx, pid, k); tx.emit({ e: 'hearts', pid, n: k, why: 'team' }); }
  }
}

/** "In Season" ribbon (GDD §5.4 #8): a season with 100+ in-season harvests counts once. */
function inSeason(tx, ctx, run, crop) {
  const season = seasonOf(ctx.now, tx.state.meta.tz);
  if (crop.season !== season) return;
  const day = dayOf(tx.state, ctx.now);
  // a season is identified by its first local day's year and name: day index / 30 is not exact, so key it on
  // (season name, the year of the season's start) derived from the day: winter spans the new year
  const year = seasonYear(day, season);
  const key = `${season}${year}`;
  const s = tx.get(['farm', 'daily', 'season']);
  const n = s && s.k === key ? s.n + 1 : 1;
  tx.set(['farm', 'daily', 'season'], { k: key, n });
  if (n === 100) bumpStat(tx, run, null, 'seasonsHundred');
}

/**
 * Purchases over FEED.bigPurchase coins (or paid in Acorns) are always shown in the feed (GDD §6.4). `what` names
 * what was bought when it is not the object itself ('slot': a building slot of `def`).
 */
function bigPurchase(tx, ctx, by, ev, what = null) {
  const coins = ev.coins ?? 0;
  const acorns = ev.acorns ?? 0;
  if (coins > FEED.bigPurchase || acorns > 0) {
    feedAdd(tx, { ...ctx, pid: by }, { k: 'buy', ...(what ? { what } : {}), def: ev.def, c: coins, a: acorns });
  }
}

/** Server-observed presence facts carried by any action (ctx.ext; server/together.js). */
function presence(tx, ctx, run) {
  const m = ctx.ext && ctx.ext.togetherMin;
  if (Number.isSafeInteger(m) && m > 0 && playerIds(tx.state).length >= 2) {
    const before = Math.floor((tx.state.farm.stats.togetherMin ?? 0) / 60);
    bumpStat(tx, run, null, 'togetherMin', m);
    const after = Math.floor(tx.state.farm.stats.togetherMin / 60);
    if (after > before) {
      bumpStat(tx, run, null, 'hoursTogether', after - before);
      for (const pid of playerIds(tx.state)) bumpStat(tx, run, pid, 'hoursTogether', after - before);
    }
  }
  const online = onlineOf(ctx).filter((p) => hasPlayer(tx.state, p));
  if (online.length >= 2 && !(tx.state.farm.stats.nightOwls > 0)) {
    const hour = localHour(ctx.now, tx.state.meta.tz);
    if (hour < 4) bumpStat(tx, run, null, 'nightOwls');
  }
}

/**
 * Touch every stats counter this Tx wrote outside bumpStat (economy.earn's 'coins.earned', 'acorns.spent', the
 * market's and storage's counters ...): a ribbon reads whatever wrote its counter (wave-2 QA RC-04: High Roller was
 * never awarded because earn() wrote 'coins.earned' without a touch).
 */
function touchStatWrites(tx, run) {
  const ops = tx.ops;
  for (let i = run.opsSeen ?? 0; i < ops.length; i++) {
    const p = ops[i].p;
    if (p.length === 3 && p[0] === 'farm' && p[1] === 'stats') touch(run, p[2]);
    else if (p.length === 4 && p[0] === 'players' && p[2] === 'stats') touch(run, p[3], p[1]);
  }
  run.opsSeen = ops.length;
}

function afterPass(tx, ctx, run) {
  questsAfter(tx, ctx, run);
  touchStatWrites(tx, run);
  ribbonsAfter(tx, ctx, run);
}

/**
 * Run every event recorded so far (and those it causes) through the reducer. Bounded: an event chain longer than
 * MAX_PASSES passes throws, which rolls the whole action back as INTERNAL.
 */
export function processEvents(tx, ctx) {
  const run = { touched: new Set(), comboDone: false, comboXp: false, opsSeen: 0 };
  if (ctx.pid !== 'sys' && hasPlayer(tx.state, ctx.pid)) {
    // a returning player's rested XP first, so this very action's XP is doubled by it (M2)
    restedAccrue(tx, ctx);
    playTick(tx, ctx, run);
    grandmaMeet(tx, ctx);
  }
  presence(tx, ctx, run);
  let i = 0;
  for (let pass = 0; ; pass++) {
    if (pass >= MAX_PASSES) throw new Error('processEvents did not converge');
    for (; i < tx.events.length; i++) handle(tx, ctx, run, tx.events[i]);
    const before = tx.events.length;
    afterPass(tx, ctx, run);
    if (tx.events.length === before && i === tx.events.length) break;
  }
}

