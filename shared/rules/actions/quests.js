// Quests and story cards (GDD §5.3; content: shared/content/quests.js + story.js QUEST_STORY / QUEST_VERBS).
// Owned by rules-goals.
//
// State: farm.quests = {
//   active: { [qid]: { at, n: { [taskIndex]: count } } }   up to STORY_SLOTS story cards (chains A-E)
//   done:   { [qid]: at }
//   owed:   { [species]: n }   free animals given by a card (A3's two hens) waiting for room in a home; the economy
//                              moves them in with takeOwed() when a home of theirs has room
// }
// Counting (QUEST_VERBS): EVENT verbs (harvest, make, collect, sell, fill, clear, empty, fertilize, upgrade slot,
// together) count deeds since the card was accepted; STATE verbs (place, build, own, buy, raise, expand, plant a
// tree, upgrade barn) read the farm as it is, so nothing done before the card is ever wasted; `raise` counts babies
// that grow up after the card opens. `fill` counts quarter
// orders (a simple order is 1/4, R15). `deliver` hands the goods in when the card completes (the `questDeliver`
// action); cards without a deliver task complete by themselves, inside the action that finished them.
// Acceptance is automatic (GDD §5.3 "doable first"): free slots take the next card of each chain whose level is
// reached: cards whose tasks can progress now first, then the lowest level, then the chain letter. Quests reward but
// never gate content: every unlock is by level.
// Chains F (the Barge) and G (the Fair) live in the "This week" tab and chain H in the "Together" tab (GDD §5.3 v2
// H3): they never take one of the STORY_SLOTS; each opens its next card as soon as its level and predecessor allow
// (one card per chain at a time). The UI tabs them by `questOf(id).chain`.
// M1b verbs: `load` crate / row and `enter` fair / hamper (the weekly systems' deeds), `complete` bundle / project /
// town_project (the economy's events), `reach` fair_silver (a ceremony at Silver or better after acceptance) and
// `reach` beauty_star (a STATE verb: the farm's best Beauty star count), `together` giant (a giant felled by both).
// M2 verbs: `reach` league (a STATE verb: the best NPC league), `breed` (a baby born in the Breeding Barn, the
// economy's `bred`), `together` dock (two farmers fishing together, the economy's `fished` with a pair). A card whose
// `complete` project / bundle task opens when every live Restoration project is already done counts it as done at
// acceptance (E10 at L38 after a quick Grandma's Farmhouse: nothing could ever count for it again). Completing
// GRANDMA_VISIT.quest brings Grandma for her visit (grandma.js).
import {
  CONTENT, questOf, isLive, levelFromXp, animalOf, STORY_BEATS, itemOf, expansionOf,
  TOWNSFOLK, GRANDMA_VISIT, BREEDING,
} from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { available, consume, projectDone } from '../economy.js';
import { producers, canMake } from '../orders-board.js';
import { settleOwed } from './animals.js';
import { sortedKeys } from '../order.js';
import { creditXp, payReward, giveObject, touch } from '../progress.js';
import { feedAdd } from '../feed.js';
import { settled } from '../time.js';
import { systemLive, weekOf } from '../coop.js';
import { albumGive } from './album.js';
import { befriend } from './folk.js';
import { dockedBarge, bargeUnlocked, dockAt } from './barge.js';
import { openFair, fairUnlocked, fairOpenAt } from './fair.js';
import { blocked, msg, name, int, ms, noun, sub, moreMsg, enText } from '../goal-text.js';
import { grandmaArrive } from './grandma.js';
import { giveFurniture } from './interior.js';
import { leagueUnlocked, LEAGUE } from './league.js';

/** Story-card slots (chains A-E). Chains F/G ("This week") and H ("Together") have their own tabs (SIDE_CHAINS). */
export const STORY_SLOTS = 3;
const STORY_CHAINS = new Set(['A', 'B', 'C', 'D', 'E']);
/** Chains outside the story slots: F the Barge and G the Fair ("This week"), H the Journal ("Together"). */
export const SIDE_CHAINS = Object.freeze({ F: 'week', G: 'week', H: 'together' });
// `raise` is an EVENT verb (a baby of the card's species grows up after acceptance, the `grewUp` deed): an adult
// bought from the shop is not raised (wave-1 QA RC-23)
const STATE_VERBS = new Set(['place', 'build', 'own', 'buy', 'expand']);

/** Live story quests in table order. */
const STORY = () => [...CONTENT.quests.values()].filter((q) => systemLive(q) && STORY_CHAINS.has(q.chain));
/** Live side-chain quests (F, G, H) in table order. */
const SIDE = () => [...CONTENT.quests.values()].filter((q) => systemLive(q) && Object.hasOwn(SIDE_CHAINS, q.chain));

/** The tab a card belongs to: 'story' | 'week' | 'together'. */
export const tabOf = (q) => SIDE_CHAINS[q.chain] ?? 'story';

/** Fresh quests block for createFarm: the cards a level-1 farm starts with (a1). */
export function initialQuests(now) {
  const active = {};
  const none = { active: {}, done: {} };
  for (const q of [...pickAvailable(null, none, 1, STORY_SLOTS, now), ...sideAvailable(none, 1)]) {
    active[q.id] = { at: now, n: {} };
  }
  return { active, done: {}, owed: {} };
}

/** Side-chain cards (F, G, H) that can open now: their level is reached and their predecessor is done. */
function sideAvailable(quests, level) {
  return SIDE().filter((q) => q.level <= level && !Object.hasOwn(quests.active, q.id)
    && !Object.hasOwn(quests.done, q.id) && prereqsDone(q, quests.done));
}

/**
 * Can a task progress right now (GDD §5.3 "doable first")? Goods must be makeable with their whole chain (or in the
 * Barn); holdings are always doable (buying or building is the task); debris must exist. A card whose tasks wait
 * on something the farm does not have yet ("waiting for apples") ranks after the doable ones.
 */
function taskDoable(state, P, t, memo) {
  switch (t.verb) {
    case 'make': case 'collect': case 'deliver': case 'sell':
      if (t.ref === 'demand') return true;
      return available(state, t.ref) > 0 || canMake(state, P, t.ref, memo);
    case 'harvest':
      if (t.ref === 'prized') return true;
      return canMake(state, P, t.ref, memo);
    case 'empty': return (P.owned.get(t.ref) ?? 0) > 0;
    case 'clear': return Object.keys(state.farm.objects).some((id) => CONTENT.debris.has(state.farm.objects[id].def));
    default: return true;
  }
}

/** Every quest `q` follows is done: its `after` and, for the first evening's joined tracks, `alsoAfter` (GDD §7.4). */
export const prereqsDone = (q, done) => (q.after === null || Object.hasOwn(done, q.after))
  && (q.alsoAfter ?? []).every((id) => Object.hasOwn(done, id));

function pickAvailable(state, quests, level, free, now) {
  if (free <= 0) return [];
  const cands = STORY().filter((q) => q.level <= level && !Object.hasOwn(quests.active, q.id)
    && !Object.hasOwn(quests.done, q.id) && prereqsDone(q, quests.done));
  const doable = new Map();
  if (state && cands.length > free) {
    const P = producers(state, now);
    const memo = new Map();
    for (const q of cands) {
      doable.set(q.id, q.tasks.every((t) => isStateTask(t) || taskDoable(state, P, t, memo)) ? 0 : 1);
    }
  }
  cands.sort((a, b) => (doable.get(a.id) ?? 0) - (doable.get(b.id) ?? 0) || a.level - b.level
    || (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0));
  return cands.slice(0, free);
}

// ---- what a waiting card waits for (wave-1 QA RC-10, GDD Appendix D G4) ------------------------------------------

const defName = (id) => (CONTENT.buildings.get(id) ?? CONTENT.homes.get(id) ?? CONTENT.trees.get(id)
  ?? CONTENT.animals.get(id) ?? itemOf(id))?.name ?? id;
/** "build the Dairy first" (a message with its English, as every blocker carries). */
const buildFirst = (id) => msg('goals.r.block.build', { b: name(id, defName(id)) });
/** "the Fair opens in 2:15 h". */
const fairIn = (state, now) => msg('goals.r.block.fairIn', { t: ms(fairOpenAt(state, weekOf(state, now) + 1) - now) });

/**
 * The first missing link of the chain that makes `item` (depth-first through recipe inputs), or null when the farm
 * can make it now (or has it). { kind: 'building'|'home'|'animal'|'feed'|'tree'|'grow', ref, text }.
 */
function missingFor(state, P, item, now, seen = new Set()) {
  if (seen.has(item) || available(state, item) > 0) return null;
  seen.add(item);
  const it = itemOf(item);
  if (!it) return null;
  switch (it.kind) {
    case 'crop': return null;
    case 'fruit': case 'wood': {
      if ((P.owned.get(it.source) ?? 0) === 0) {
        return blocked('tree', it.source, msg('goals.r.block.plantTree', { tree: name(it.source, defName(it.source), 'trees'),
          _a: /^[AEIOU]/i.test(defName(it.source)) ? 'an' : 'a' }));
      }
      if ((P.mature.get(it.source) ?? 0) === 0) {
        return blocked('grow', it.source, msg('goals.r.block.bearFruit', { tree: name(it.source, defName(it.source), 'trees') }));
      }
      return null;
    }
    case 'animal': {
      const a = animalOf(it.source);
      if (!a) return null;
      if ((P.animals.get(a.id) ?? 0) === 0) {
        const home = a.homes.find((h) => (P.owned.get(h) ?? 0) > 0);
        if (!home) return blocked('home', a.homes[0], buildFirst(a.homes[0]));
        return blocked('animal', a.id, msg('goals.r.block.buyAnimal', { animal: name(a.id, a.name, 'animals') }));
      }
      if ((P.adults.get(a.id) ?? 0) === 0) {
        return blocked('grow', a.id, msg('goals.r.block.growUp', { animal: name(a.id, a.name, 'animals') }));
      }
      return a.feed ? missingFor(state, P, a.feed, now, seen) : null;
    }
    case 'feed': {
      const f = CONTENT.feeds.get(it.source);
      if (f && (P.owned.get(f.building) ?? 0) === 0) {
        return blocked('building', f.building, buildFirst(f.building));
      }
      return null;
    }
    default: {
      const r = CONTENT.recipes.get(it.source);
      if (!r) return null;
      if ((P.owned.get(r.building) ?? 0) === 0) {
        return blocked('building', r.building, buildFirst(r.building));
      }
      for (const input of sortedKeys(r.inputs ?? {})) {
        const m = missingFor(state, P, input, now, seen);
        if (m) return m;
      }
      return null;
    }
  }
}

/**
 * What an unfinished task of a story card waits for, or null when the farm can work on it now (RC-10): a missing
 * building, home, animal or tree in the chain, a baby or sapling still growing, or (land) the level or the open
 * proof task. The tracker shows it as the card's line: "Baby Steps: build the Dairy first".
 * @returns {{ kind: string, ref: string, text: string } | null}
 */
export function blockerOf(state, t, now) {
  const P = producers(state, now);
  switch (t.verb) {
    case 'make': case 'collect': case 'deliver': case 'harvest': case 'sell':
      if (t.ref === 'demand' || t.ref === 'prized') return null;
      return missingFor(state, P, t.ref, now);
    case 'raise': case 'buy': case 'tend': {
      const a = animalOf(t.ref);
      if (!a || a.homes.some((h) => (P.owned.get(h) ?? 0) > 0)) return null;
      return blocked('home', a.homes[0], buildFirst(a.homes[0]));
    }
    case 'expand': {
      const e = expansionOf(t.ref);
      if (!e || state.farm.expansions.includes(e.id)) return null;
      if (levelFromXp(state.farm.xp) < e.unlock) {
        return blocked('level', e.id, msg('goals.r.block.level', { n: int(e.unlock) }));
      }
      for (let i = 0; i < e.proof.length; i++) {
        // the land card's proof progress (actions/expansions.js proofProgress; not imported: expansions.js imports
        // storage.js, which reaches this module, and an import here would make the load order matter)
        const pt = e.proof[i];
        const objs = state.farm.objects;
        let have = 0;
        if (pt.verb === 'own') {
          for (const id of Object.keys(objs)) if (objs[id].def === pt.ref && settled(objs[id], now)) have++;
        } else have = state.farm.proofs?.[e.id]?.n?.[String(i)] ?? 0;
        if (have >= pt.qty) continue;
        const left = { verb: pt.verb, ref: Array.isArray(pt.ref) ? pt.ref[0] : pt.ref, qty: pt.qty - have };
        return blocked('proof', e.id, msg('goals.r.block.proof', { task: sub(moreMsg(left)) }));
      }
      return null;
    }
    case 'load': {
      // "The Barge Arrives": the barge has to be at the jetty (Monday 06:00 to Sunday 20:00) with crates this week
      if (!bargeUnlocked(state)) return null;
      if (!dockedBarge(state, now)) {
        const w = weekOf(state, now);
        const at = state.farm.barge.w < w && now < dockAt(state, w) ? dockAt(state, w) : dockAt(state, w + 1);
        return blocked('wait', 'barge', msg('goals.r.block.bargeIn', { t: ms(at - now) }));
      }
      return state.farm.barge.rows === 0 ? blocked('wait', 'barge', msg('goals.r.block.bargeLight'))
        : null;
    }
    case 'enter':
      if (!fairUnlocked(state) || openFair(state, now)) return null;
      return blocked('wait', 'fair', fairIn(state, now));
    case 'reach':
      if (t.ref !== 'league') return null;
      // "League Night": the league is judged at the Sunday ceremony; a week with no Fair point never promotes
      if (!leagueUnlocked(state)) return blocked('level', 'league', msg('goals.r.block.level', { n: int(LEAGUE.unlock) }));
      return openFair(state, now) ? null : blocked('wait', 'fair', fairIn(state, now));
    case 'breed': {
      // "New Coats": two adults of the species in a home, and the Breeding Barn's level
      const a = animalOf(t.ref);
      if (!a) return null;
      if (levelFromXp(state.farm.xp) < BREEDING.unlock) {
        return blocked('level', 'breeding', msg('goals.r.block.level', { n: int(BREEDING.unlock) }));
      }
      if (!a.homes.some((h) => (P.owned.get(h) ?? 0) > 0)) {
        return blocked('home', a.homes[0], buildFirst(a.homes[0]));
      }
      let adults = 0;
      for (const id of Object.keys(state.farm.objects)) {
        const o = state.farm.objects[id];
        if (o.def === t.ref && typeof o.home === 'string' && isAdult(o, now)) adults++;
      }
      return adults >= 2 ? null : blocked('animal', t.ref, msg('goals.r.block.raiseTwo', {
        animals: noun(a.id, 2, a.name), a: name(a.id, a.name, 'animals') }));
    }
    default: return null;
  }
}

/** "Harvest 12 more Wheat": what is left of a land proof task (the NOW land card and the e1 blocker). */
export const moreText = (t) => enText(moreMsg(t));

/** Is `task` a state verb (counts holdings, not deeds)? Planting a tree species counts trees owned. */
export const isStateTask = (t) => STATE_VERBS.has(t.verb) || (t.verb === 'plant' && CONTENT.trees.has(t.ref))
  || (t.verb === 'upgrade' && t.ref === 'barn') || (t.verb === 'reach' && (t.ref === 'beauty_star'
  || t.ref === 'league'));

/** Target count of a task (fill counts quarter orders). */
export const taskTarget = (t) => (t.verb === 'fill' ? t.qty * 4 : t.qty);

/** True when an animal object is an adult at `now` (economy shape: `adultAt` ms, or a `baby` flag). */
export function isAdult(o, now) {
  if (Number.isSafeInteger(o.adultAt)) return o.adultAt <= now;
  return !o.baby;
}

/**
 * Current holdings for a state task: SETTLED objects only (past their 10-minute undo receipt), so a card can never
 * be completed by a purchase that is then undone for 100 % (GDD §9 #9, wave-1 QA RC-05).
 */
export function stateCount(state, t, now) {
  const objs = state.farm.objects;
  let n = 0;
  switch (t.verb) {
    case 'place': case 'build': case 'own': case 'plant':
      if (t.ref === 'forage') return forageCount(state, now);
      for (const id of Object.keys(objs)) if (objs[id].def === t.ref && settled(objs[id], now)) n++;
      return n;
    case 'buy':
      for (const id of Object.keys(objs)) {
        if (objs[id].def === t.ref && typeof objs[id].home === 'string' && settled(objs[id], now)) n++;
      }
      return n;
    case 'expand':
      return state.farm.expansions.includes(t.ref) ? 1 : 0;
    case 'upgrade':
      return barnUpgrades(state);
    case 'reach':
      // the best NPC league (M2, league.js) / the farm's best Farm Beauty star count (the economy's `beautyStar`)
      if (t.ref === 'league') return leagueUnlocked(state) ? Math.max(state.farm.league?.best ?? 0,
        state.farm.stats.bestLeague ?? 0) : 0;
      return state.farm.stats.beautyStars ?? 0;
    default:
      return 0;
  }
}

/**
 * Bee forage on the farm ("The Buzz: place 3 forage", GDD §3.4 Bees): settled decor counts its `effect.forage`, a
 * settled flowering tree counts one (GDD §3.2 rule 10).
 */
export function forageCount(state, now) {
  let n = 0;
  const objs = state.farm.objects;
  for (const id of Object.keys(objs)) {
    const o = objs[id];
    if (!settled(o, now)) continue;
    const d = CONTENT.decor.get(o.def);
    if (d && Number.isSafeInteger(d.effect?.forage)) n += d.effect.forage;
    else if (CONTENT.trees.get(o.def)?.flowering) n += 1;
  }
  return n;
}

/** Barn upgrades owned (economy state `farm.barn` = n, or { n }); 0 when the economy has none yet. */
function barnUpgrades(state) {
  const b = state.farm.barn;
  if (Number.isSafeInteger(b)) return b;
  if (b && Number.isSafeInteger(b.n)) return b.n;
  if (b && Number.isSafeInteger(b.level)) return b.level;
  return 0;
}

/**
 * Progress of one task in DISPLAY units: { have, need, done } (fill: whole orders, a simple order adds a quarter, so
 * `quarters` carries the exact count; deliver: goods in the Barn now).
 */
export function taskProgress(state, qid, i, now) {
  const q = questOf(qid);
  const t = q.tasks[i];
  let have;
  if (t.verb === 'deliver') have = available(state, t.ref);
  else if (isStateTask(t)) have = stateCount(state, t, now);
  else have = state.farm.quests.active[qid]?.n?.[String(i)] ?? 0;
  const done = have >= taskTarget(t);
  if (t.verb === 'fill') return { have: Math.min(Math.floor(have / 4), t.qty), need: t.qty, done, quarters: have };
  return { have: Math.min(have, t.qty), need: t.qty, done };
}

/** Every task done (deliver: the goods are in the Barn). */
export function questReady(state, qid, now) {
  const q = questOf(qid);
  return q.tasks.every((t, i) => taskProgress(state, qid, i, now).done);
}

const hasDeliver = (q) => q.tasks.some((t) => t.verb === 'deliver');

/** Deeds advance the matching event-verb tasks of every active card. */
export function questDeed(tx, ctx, run, d) {
  const quests = tx.state.farm.quests;
  if (!quests) return;
  for (const qid of sortedKeys(quests.active)) {
    const q = questOf(qid);
    if (!q) continue;
    q.tasks.forEach((t, i) => {
      if (isStateTask(t) || t.verb === 'deliver' || t.verb !== d.verb || t.ref !== d.ref) return;
      const k = String(i);
      const cur = quests.active[qid].n[k] ?? 0;
      const need = taskTarget(t);
      if (cur >= need) return;
      tx.set(['farm', 'quests', 'active', qid, 'n', k], Math.min(need, cur + d.n));
    });
  }
  if (run) run.questDirty = true;
}

/** After every pass: complete what is finished (cards without deliver), accept into free slots. */
export function questsAfter(tx, ctx, run) {
  const quests = tx.state.farm.quests;
  if (!quests || !run) return;
  if (run.questDirty) {
    run.questDirty = false;
    for (const qid of sortedKeys(quests.active)) {
      const q = questOf(qid);
      if (q && !hasDeliver(q) && questReady(tx.state, qid, ctx.now)) complete(tx, ctx, run, q);
    }
  }
  if (run.questAccept) {
    run.questAccept = false;
    if (accept(tx, ctx)) run.questDirty = true;     // a state-verb card may already be done
  }
}

/** A farm level-up may open new cards. */
export function questsOnLevel(tx, ctx, run) {
  if (accept(tx, ctx) && run) run.questDirty = true;
}

function accept(tx, ctx) {
  const quests = tx.state.farm.quests;
  if (!quests) return;
  const L = levelFromXp(tx.state.farm.xp);
  const inStory = Object.keys(quests.active).filter((id) => STORY_CHAINS.has(questOf(id)?.chain)).length;
  const picked = [...pickAvailable(tx.state, quests, L, STORY_SLOTS - inStory, ctx.now), ...sideAvailable(quests, L)];
  for (const q of picked) {
    tx.set(['farm', 'quests', 'active', q.id], { at: ctx.now, n: retroCredit(tx.state, q) });
    tx.emit({ e: 'questStarted', id: q.id });
    startRewards(tx, ctx, q);
  }
  return picked.length > 0;
}

/**
 * One-off credit at acceptance for tasks marked `retro` (content QUEST_FLOW): the farm stat counts what was done
 * before the card could open (the scripted first order before A4, Flour made before A5). Event-verb counting takes
 * over from there, so the total is the farm's lifetime count, never more than the target.
 */
function retroCredit(state, q) {
  const n = {};
  q.tasks.forEach((t, i) => {
    if (t.verb === 'complete' && (t.ref === 'project' || t.ref === 'bundle') && restorationExhausted(state)) {
      n[String(i)] = taskTarget(t);
      return;
    }
    if (!t.retro) return;
    const have = Math.min(taskTarget(t), state.farm.stats[t.retro] ?? 0);
    if (have > 0) n[String(i)] = have;
  });
  return n;
}

/**
 * True when every Restoration project that plays in this build is complete: a `complete` project / bundle task can
 * never count again, so a card that asks for one is done the moment it opens (E10 "Grandma Comes Home" at L38 on a
 * farm that restored Grandma's Farmhouse at L35: wave 3).
 */
export function restorationExhausted(state) {
  const all = [...CONTENT.restoration.values()].filter((p) => systemLive(p));
  return all.length > 0 && all.every((p) => projectDone(state, p.id));
}

function startRewards(tx, ctx, q) {
  const r = q.rewards || {};
  if (Array.isArray(r.giftAtStart)) for (const def of r.giftAtStart) giveObject(tx, ctx, def, 1);
  if (r.animalsAtStart) {
    for (const sp of sortedKeys(r.animalsAtStart)) {
      if (!animalOf(sp) || !isLive(animalOf(sp))) continue;
      tx.set(['farm', 'quests', 'owed', sp], (tx.state.farm.quests.owed[sp] ?? 0) + r.animalsAtStart[sp]);
    }
    // a home that already has room takes them at once (the economy moves the rest in when a home gains room)
    settleOwed(tx, ctx);
  }
}

/** Complete a card (from questsAfter, or progress.js on `questDelivered`). */
export function completeQuest(tx, ctx, run, qid) {
  const q = questOf(qid);
  if (q && Object.hasOwn(tx.state.farm.quests.active, qid)) complete(tx, ctx, run, q);
}

function complete(tx, ctx, run, q) {
  tx.del(['farm', 'quests', 'active', q.id]);
  tx.set(['farm', 'quests', 'done', q.id], ctx.now);
  const r = q.rewards || {};
  payReward(tx, ctx, run, { coins: q.coins, acorns: r.acorns ?? 0, hearts: r.hearts ?? 0, items: r.items,
    decor: [...(r.decor ?? []), ...(r.gift ?? [])] }, 'quest');
  creditXp(tx, ctx, run, q.xp);
  if (r.collection) albumGive(tx, ctx, run, r.collection, ctx.pid);
  // a furniture piece for the farmhouse room (M2: H7's Memory Book frame) goes into the room's tray (rules-economy)
  if (Array.isArray(r.furniture) && tx.state.farm.interior) for (const f of r.furniture) giveFurniture(tx, f, 1);
  // a chain card from a townsperson: +2 Friendship from the board's level (GDD §5.3)
  befriend(tx, ctx, q.giver, TOWNSFOLK.friendship.chainQuest, 'quest');
  tx.emit({ e: 'questDone', id: q.id, by: ctx.pid, coins: q.coins, xp: q.xp });
  feedAdd(tx, ctx, { k: 'quest', id: q.id });
  touch(run, 'questsDone');
  run.questAccept = true;
  if (GRANDMA_VISIT && q.id === GRANDMA_VISIT.quest) grandmaArrive(tx, ctx);     // Grandma comes home (M2)
}

/**
 * Free animals a card owes (A3's two hens), moved into a home by the economy as soon as one has room.
 * @returns {number} how many of `species` were taken (0..n)
 */
export function takeOwed(tx, species, n = 1) {
  const have = tx.state.farm.quests?.owed?.[species] ?? 0;
  const k = Math.min(have, n);
  if (k <= 0) return 0;
  if (have - k === 0) tx.del(['farm', 'quests', 'owed', species]);
  else tx.set(['farm', 'quests', 'owed', species], have - k);
  return k;
}

/** `questDeliver { id }`: hand in the goods of a card whose other tasks are done; completes it. */
export const questDeliver = {
  schema: { id: V.content('quests') },
  check(state, a, ctx) {
    const qs = state.farm.quests;
    if (!qs || !Object.hasOwn(qs.active, a.id)) {
      return Object.hasOwn(qs?.done ?? {}, a.id) ? ERR.ALREADY_DONE : ERR.NOT_FOUND;
    }
    const q = questOf(a.id);
    if (!hasDeliver(q)) return ERR.BAD_ARGS;
    return questReady(state, a.id, ctx.now) ? null : ERR.NOT_READY;
  },
  apply(tx, a, ctx) {
    const q = questOf(a.id);
    const items = {};
    for (const t of q.tasks) {
      if (t.verb !== 'deliver') continue;
      consume(tx, t.ref, t.qty);
      items[t.ref] = (items[t.ref] ?? 0) + t.qty;
    }
    // progress.processEvents completes the card on this event, with the action's own credit run
    tx.emit({ e: 'questDelivered', id: a.id, items, by: ctx.pid });
  },
};

/** Story beats this player has not seen yet (from completed cards), oldest first. */
export function unseenBeats(state, pid) {
  const seen = state.players[pid]?.seen?.beats ?? {};
  const done = state.farm.quests?.done ?? {};
  const out = [];
  for (const qid of sortedKeys(done).sort((a, b) => done[a] - done[b] || (a < b ? -1 : 1))) {
    const beat = questOf(qid)?.rewards?.beat;
    if (!beat || Object.hasOwn(seen, beat) || out.includes(beat)) continue;
    const def = STORY_BEATS.find((b) => b.id === beat);
    if (def && isLive(def)) out.push(beat);
  }
  return out;
}
