// Collections, the album (GDD §5.5; content: shared/content/collections.js). Owned by rules-goals.
//
// Each ELIGIBLE event (a crafted good, a flower harvest, cleared debris, an egg collected ... the set's `from`)
// rolls COLLECTION_RULES.dropBp (2 %) for a missing item of each matching set; a Gold-mastered source doubles it
// and the doubled half may give a duplicate. Pity: after COLLECTION_RULES.pity eligible rolls of a set without a
// new item, the next eligible roll drops one. Rolls are keyed only on the set's own roll counter `r` (replicated,
// server-ordered, bumped in the same tx), so a rejected, re-sent or undone action never rolls again and the
// client's prediction rolls exactly what the server rolls. Duplicates trade 3 -> 1 missing item of the same set.
// A set completed pays COLLECTION_RULES.acorns, its display piece (decor) and its permanent perk (perkOf).
//
// farm.album = { sets: { [setId]: { r, pity, items: { [itemId]: { by, at, n } }, done: null | at } } }
//   r = rolls so far (the rng key), pity = rolls since the last NEW item, n = copies found (n > 1: duplicates)
//
//   albumTrade { set, want }   trade 3 duplicates of `set` for its missing item `want`
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { CONTENT, COLLECTION_RULES, levelFromXp, collectionOf } from '../../content/index.js';
import { sortedKeys } from '../order.js';
import { systemLive, liveVersion } from '../coop.js';
import { payReward, giveObject } from '../progress.js';
import { feedAdd } from '../feed.js';

const BP = 10_000;

let LIVE = null;
let LIVE_V = -1;
/** Collection sets that play in this build, table order. */
export function liveSets() {
  if (!LIVE || LIVE_V !== liveVersion()) {
    LIVE = [...CONTENT.collections.values()].filter((s) => systemLive(s));
    LIVE_V = liveVersion();
  }
  return LIVE;
}

/** True when the album is open on this farm (its level, a live set). */
export const albumUnlocked = (state) => levelFromXp(state.farm.xp) >= COLLECTION_RULES.unlock && liveSets().length > 0;

/** The set that holds a collection item, or null. */
export function setOfItem(itemId) {
  for (const s of CONTENT.collections.values()) if (s.items.some((i) => i.id === itemId)) return s;
  return null;
}

const setState = (state, id) => state.farm.album?.sets?.[id] ?? null;

/** Items of a set the farm has not found yet, in table order. */
export function missingOf(state, set) {
  const st = setState(state, set.id);
  return set.items.filter((i) => !(st && st.items[i.id])).map((i) => i.id);
}

/** Duplicate copies held in a set (copies beyond the first of each item). */
export function dupesOf(state, set) {
  const st = setState(state, set.id);
  if (!st) return 0;
  let n = 0;
  for (const id of Object.keys(st.items)) n += Math.max(0, st.items[id].n - 1);
  return n;
}

/**
 * The sum of a perk over the farm's COMPLETED live sets (0 when none): 'craftXpBp', 'beauty10', 'chopsLess',
 * 'bonusEggBp', 'seedBp', 'truffleBp', 'forageRadius', 'sewingTimeBp', 'fairPointsBp', 'demandUnits',
 * 'goldenHourMs'. Pure; rules-economy reads its own perks through it (GDD §5.5 perks are permanent).
 */
export function perkOf(state, key) {
  const sets = state.farm.album?.sets;
  if (!sets) return 0;
  let n = 0;
  for (const s of liveSets()) {
    const st = sets[s.id];
    const v = s.perk?.[key];
    if (st && st.done !== null && Number.isSafeInteger(v)) n += v;
  }
  return n;
}

function ensureSet(tx, id) {
  if (!tx.state.farm.album.sets[id]) tx.set(['farm', 'album', 'sets', id], { r: 0, pity: 0, items: {}, done: null });
}

/** Record one found item (new or duplicate) and pay the set when it completes. */
function found(tx, ctx, run, set, item, by, how) {
  const st = tx.state.farm.album.sets[set.id];
  const had = st.items[item];
  const who = typeof by === 'string' && by !== 'sys' ? by : ctx.pid;
  if (had) {
    tx.set(['farm', 'album', 'sets', set.id, 'items', item], { ...had, n: had.n + 1 });
    tx.emit({ e: 'albumFind', set: set.id, item, dup: true, how, by: who });
    return;
  }
  tx.set(['farm', 'album', 'sets', set.id, 'items', item], { by: who, at: ctx.now, n: 1 });
  // the album counters (Album Pages, Collector) are bumped by progress.js from these events
  tx.emit({ e: 'albumFind', set: set.id, item, dup: false, how, by: who });
  feedAdd(tx, { ...ctx, pid: who }, { k: 'album', set: set.id, item });
  if (missingOf(tx.state, set).length === 0) {
    tx.set(['farm', 'album', 'sets', set.id, 'done'], ctx.now);
    payReward(tx, ctx, run, { acorns: COLLECTION_RULES.acorns }, 'album');
    if (set.display) giveObject(tx, ctx, set.display, 1);
    tx.emit({ e: 'albumSet', set: set.id, perk: set.perkText, by: who });
    feedAdd(tx, { ...ctx, pid: who }, { k: 'album', set: set.id, done: 1 });
  }
}

/**
 * Roll every live, unfinished set that `source` feeds ('craft', 'craft:weaver', 'harvest:flower', 'clear:rock',
 * 'collect:chicken' ...). `sources` lists every key the event matches; `gold` doubles the chance (a Gold-mastered
 * source, M2). One roll per set per eligible event.
 */
export function albumRoll(tx, ctx, run, sources, by, { gold = false, n = 1 } = {}) {
  if (!tx.state.farm.album || !albumUnlocked(tx.state)) return;
  for (const set of liveSets()) {
    if (!set.from.some((f) => sources.includes(f))) continue;
    for (let i = 0; i < n; i++) {
      if (missingOf(tx.state, set).length === 0 && !gold) break;
      rollSet(tx, ctx, run, set, by, gold);
    }
  }
}

/** One roll of one set (keyed on the set's own counter `r`). */
function rollSet(tx, ctx, run, set, by, gold) {
  const missing = missingOf(tx.state, set);
  ensureSet(tx, set.id);
  const st = tx.state.farm.album.sets[set.id];
  const x = Math.floor(ctx.rng('album', set.id, st.r) * BP);
  const dropBp = COLLECTION_RULES.dropBp;
  let pick = null;
  let how = 'roll';
  if (missing.length > 0 && (x < dropBp || st.pity >= COLLECTION_RULES.pity)) {
    how = x < dropBp ? 'roll' : 'pity';
    pick = missing[Math.floor(ctx.rng('album', set.id, st.r, 'pick') * missing.length)];
  } else if (gold && x < dropBp * COLLECTION_RULES.goldMul) {
    // the doubled half of a Gold-mastered roll: any item of the set (a duplicate is possible)
    const all = set.items.map((it) => it.id);
    pick = all[Math.floor(ctx.rng('album', set.id, st.r, 'pick') * all.length)];
  }
  const isNew = pick !== null && !st.items[pick];
  tx.set(['farm', 'album', 'sets', set.id, 'r'], st.r + 1);
  tx.set(['farm', 'album', 'sets', set.id, 'pity'], isNew ? 0 : st.pity + 1);
  if (pick !== null) found(tx, ctx, run, set, pick, by, how);
}

/**
 * "A collection roll" as a prize (the Daily chest, the Together Combo meter, a pet's find): one roll of a live,
 * unfinished set picked on the farm counter `rolls.albumAny` (bumped here, in the same tx). True when it rolled.
 */
export function albumAnyRoll(tx, ctx, run, by) {
  if (!tx.state.farm.album || !albumUnlocked(tx.state)) return false;
  const open = liveSets().filter((s) => missingOf(tx.state, s).length > 0);
  if (open.length === 0) return false;
  const k = tx.state.farm.rolls.albumAny ?? 0;
  tx.set(['farm', 'rolls', 'albumAny'], k + 1);
  rollSet(tx, ctx, run, open[Math.floor(ctx.rng('albumAny', k) * open.length)], by, false);
  return true;
}

/** A collection item given outright (a story card's reward, a pet's find): a duplicate when already found. */
export function albumGive(tx, ctx, run, itemId, by) {
  const set = setOfItem(itemId);
  if (!set || !systemLive(set) || !tx.state.farm.album) return;
  ensureSet(tx, set.id);
  found(tx, ctx, run, set, itemId, by, 'gift');
}

export const albumTrade = {
  schema: { set: V.text(32), want: V.text(32) },
  check(state, a) {
    const set = collectionOf(a.set);
    if (!set || !systemLive(set)) return ERR.BAD_ARGS;
    if (!albumUnlocked(state)) return ERR.LOCKED;
    if (!set.items.some((i) => i.id === a.want)) return ERR.BAD_ARGS;
    if (!missingOf(state, set).includes(a.want)) return ERR.ALREADY_DONE;
    return dupesOf(state, set) >= COLLECTION_RULES.tradeIn ? null : ERR.NO_ITEMS;
  },
  apply(tx, a, ctx) {
    const set = collectionOf(a.set);
    // give the duplicates with the most spare copies first (ties: table order), never anyone's last copy
    let left = COLLECTION_RULES.tradeIn;
    const order = set.items.map((i) => i.id);
    while (left > 0) {
      const items = tx.state.farm.album.sets[set.id].items;
      const best = sortedKeys(items).filter((id) => items[id].n > 1)
        .sort((x, y) => items[y].n - items[x].n || order.indexOf(x) - order.indexOf(y))[0];
      tx.set(['farm', 'album', 'sets', set.id, 'items', best], { ...items[best], n: items[best].n - 1 });
      left--;
    }
    found(tx, ctx, null, set, a.want, ctx.pid, 'trade');
  },
};

/** The album for the UI: [{ id, name, perkText, done, items: [{ id, name, by, at, n }], missing, dupes }]. */
export function albumView(state) {
  return liveSets().map((s) => {
    const st = setState(state, s.id);
    return { id: s.id, name: s.name, perkText: s.perkText, display: s.display, done: st ? st.done : null,
      pity: st ? st.pity : 0, items: s.items.map((i) => ({ id: i.id, name: i.name, ...(st?.items[i.id] ?? {}) })),
      missing: missingOf(state, s).length, dupes: dupesOf(state, s) };
  });
}
