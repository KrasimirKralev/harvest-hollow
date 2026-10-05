// Action registry and runner (FROZEN CONTRACT, tech-architecture §3.1).
//
// Every game change, player or system, is one action run through runAction():
//   ACTIONS[type] = { schema, check(state, args, ctx) -> null | ERR, apply(tx, args, ctx) }
// The client runs it to predict, the server runs the same code to decide, the journal replays it.
//
// ctx (build it ONLY with makeCtx so client, server and replay agree):
//   now    server epoch ms. Server: its monotonic clock. Client: its estimate of the server clock.
//          Journal replay: the journaled value. Rules NEVER read a clock themselves.
//   pid    the actor: 'p1' | 'p2' | 'sys' (system actions)
//   cid    the client id of the sending page load ('sys' for system actions)
//   seq    the client's per-cid sequence number (system actions: the new version `v`)
//   ext    server-observed facts journaled with the action ({} in M0; later { together, near, online })
//   grace  readiness tolerance in ms: READY_GRACE_MS on the server, 0 on the client (tech §4.3)
//   newId(i)   id of the i-th object this action creates: `${cid}.${seq.toString(36)}.${i}` (tech §2.8)
//   rng(...keys)  [0, 1) roll keyed by (farmSeed, ...keys) (tech §2.9). Keys come only from server-ordered
//          replicated state (an object's cycle, a `farm.rolls` counter bumped in the same tx, farm.pity):
//          NEVER newId(), cid, seq, now or an arg, which the client chooses (review-m0 #2). rng() throws on
//          the string keys it can recognise (cid, ids this action creates), which rejects the action INTERNAL.
// ctx and ctx.ext are frozen: ext is journaled, so a rule that wrote to it would change replay.
//
// RULES EVERY ACTION FOLLOWS (review-m0; the shared test helpers and test/invariants.test.js check them):
//   1. Objects read from `state` (in check) or `tx.get()` (in apply) are READ-ONLY. Every change goes through
//      tx.set / tx.del / tx.inc, otherwise it is applied on the server but never sent, undone or journaled.
//   2. Arrays are written whole (tx.set([...,'queue'], [...q, x])); a write inside an array throws.
//   3. No decision may depend on the key order of a state map (Object.keys/values/entries, for...in): a rollback
//      or a client rewind re-adds keys at the end, so live, replayed and predicted order differ. Sort first
//      (shared/rules/order.js sortedKeys / sortedEntries, or by a stored field with the key as tie-break).
//   4. Integer math only for anything that becomes state: no `**`, Math.pow/exp/log/trig (their last bit may
//      differ between browsers); percentages are basis points (x * bp / 10_000, floored). economy.grow() does
//      n-th copy prices. test/purity.test.js bans the float functions in shared/rules and shared/content.
//   5. Calendar facts (day, week, season) come from shared/rules/calendar.js with state.meta.tz, the farm's
//      IANA zone: never the browser's zone, never UTC by accident (review-m0 #3).
//   6. Never read state.meta.version: the client holds the last confirmed `v` while the server is mid-action.
//   7. Soft confirms: every action accepts `args.confirm` (an envelope argument, schema.js). Test it with
//      confirmed(args, code). The dialog's details (who reserved, how much) come from shared pure helpers over
//      the client's state, never from `rej`, which carries only a code (and `by` for object ids).
//   8. Purchases refuse `retired` defs (LOCKED). Moving an existing retired object keeps working.
//   9. Celebrations (progress.CELEBRATIONS) are emitted only by the rules and are never predicted; every
//      emitted event name is in FX_EVENTS or CELEBRATIONS (test/invariants.test.js).
//  10. Bump RULES_VERSION (shared/rules/version.js) whenever a rule's outcome changes: it is part of
//      CONTENT_HASH, so open tabs reload, and journal lines record the hash they were accepted under.
//
// runAction(state, { type, args }, ctx) ->
//   { ok: true, tx }             tx.ops = delta, tx.inverse() = undo, tx.events = domain events
//   { ok: false, code, err? }    nothing was written (a throwing rule is rolled back and reported INTERNAL)
import { ERR } from '../net/protocol.js';
import { newId as makeId } from '../net/ids.js';
import { READY_GRACE_MS } from '../content/config.js';
import { Tx } from './tx.js';
import { parseArgs } from './schema.js';
import { processEvents } from './progress.js';
import { roll } from './rng.js';

export { RULES_VERSION } from './version.js';
export { CELEBRATIONS, FX_EVENTS } from './progress.js';
import * as farming from './actions/farming.js';
import * as trees from './actions/trees.js';
import * as animals from './actions/animals.js';
import * as crafting from './actions/crafting.js';
import * as market from './actions/market.js';
import * as storage from './actions/storage.js';
import * as decor from './actions/decor.js';
import * as boosts from './actions/boosts.js';
import * as expansions from './actions/expansions.js';
// wave 2 (M1b): Farm Beauty + Masterwork, the Restoration Ledger, Town Projects (giant crops live in farming / trees)
import * as beauty from './actions/beauty.js';
import * as restoration from './actions/restoration.js';
import * as town from './actions/town.js';
import * as pets from './actions/pets.js';
// wave 3 (M2): the Nursery and the Breeding Barn, the Fishing Dock, the farmhouse interior
import * as breeding from './actions/breeding.js';
import * as fishing from './actions/fishing.js';
import * as interior from './actions/interior.js';
// wave 4 (the owners' wish list): upgrades, clearable weeds, character customization
import * as upgrades from './actions/upgrades.js';
import * as weeds from './actions/weeds.js';
import * as avatar from './actions/avatar.js';
// wave 4b (the owners' wish list of 2026-10-05): the balloon's crates (+ `_crate`), the Acorn shop's relics
import * as crates from './actions/crates.js';
import * as relics from './actions/relics.js';
import { SYSTEM_ACTIONS } from './system.js';

// rules-goals owns the block between `// >>> goals actions` and `// <<< goals actions`: import its action
// families (orders, quests, ribbons, daily, social, coop, tutorial, ...) there and list them in GOALS_FAMILIES.
// Import declarations are hoisted, so they may live inside the block. rules-economy owns the rest of this file.
// >>> goals actions
import * as goalsOrders from './actions/orders.js';
import * as goalsQuests from './actions/quests.js';
import * as goalsRibbons from './actions/ribbons.js';
import * as goalsDaily from './actions/daily.js';
import * as goalsSocial from './actions/social.js';
import * as goalsCoop from './actions/coop.js';
import * as goalsTutorial from './actions/tutorial.js';
import * as goalsFair from './actions/fair.js';
import * as goalsBarge from './actions/barge.js';
import * as goalsAlbum from './actions/album.js';
import * as goalsFolk from './actions/folk.js';
import * as goalsMemory from './actions/memory.js';
// M2 (wave 3): perks, the Seasonal Ribbon Track (+ `_track`), the Friendly Duel (+ `_duel`), Grandma's visit (`_grandma`)
import * as goalsPerks from './actions/perks.js';
import * as goalsTrack from './actions/track.js';
import * as goalsDuel from './actions/duel.js';
import * as goalsGrandma from './actions/grandma.js';
const GOALS_FAMILIES = [goalsOrders, goalsQuests, goalsRibbons, goalsDaily, goalsSocial, goalsCoop, goalsTutorial,
  goalsFair, goalsBarge, goalsAlbum, goalsFolk, goalsMemory, goalsPerks, goalsTrack, goalsDuel, goalsGrandma];
// <<< goals actions

const isAction = (v) => v && typeof v === 'object' && v.schema && typeof v.check === 'function' && typeof v.apply === 'function';

function registry(...families) {
  const reg = Object.create(null);
  for (const fam of families) {
    for (const [type, def] of Object.entries(fam)) {
      if (!isAction(def)) continue;             // families may export helpers next to actions
      if (reg[type]) throw new Error(`duplicate action ${type}`);
      reg[type] = Object.freeze(def);
    }
  }
  return Object.freeze(reg);
}

/** Null-prototype frozen registry: ACTIONS['constructor'] is undefined. */
export const ACTIONS = registry(farming, trees, animals, crafting, market, storage, decor, boosts, expansions,
  beauty, restoration, town, pets, breeding, fishing, interior, upgrades, weeds, avatar, crates, relics,
  ...GOALS_FAMILIES, SYSTEM_ACTIONS);

/** Server-side readiness grace; the client passes 0. */
export const SERVER_GRACE_MS = READY_GRACE_MS;

/** True for types only the server may run. */
export const isSystemType = (type) => typeof type === 'string' && type.startsWith('_');

/**
 * Build an action context. The single place that defines ctx, so prediction, authority and replay match.
 * @param {object} state
 * @param {{ now: number, pid: string, cid: string, seq: number, ext?: object, grace?: number }} o
 */
export function makeCtx(state, { now, pid, cid, seq, ext = {}, grace = 0 }) {
  const seed = state.meta.farmSeed;
  // Ids this action creates start with `${cid}.${seq36}.`; system actions use cid 'sys', whose ids are not
  // client-chosen, so only player actions are guarded.
  const mine = pid === 'sys' ? null : `${cid}.${seq.toString(36)}.`;
  return Object.freeze({
    now, pid, cid, seq, ext: Object.freeze({ ...ext }), grace,
    newId: (i) => makeId(cid, seq, i),
    rng: (...keys) => {
      if (mine) {
        for (const k of keys) {
          if (typeof k === 'string' && (k === cid || k.startsWith(mine))) throw new Error(`rng: client-chosen key ${k}`);
        }
      }
      return roll(seed, ...keys);
    },
  });
}

/**
 * Run one action atomically against `state` (mutated in place on success).
 * @param {object} state
 * @param {{ type: string, args?: object }} act
 * @param {ReturnType<typeof makeCtx>} ctx
 */
export function runAction(state, act, ctx) {
  const type = act && act.type;
  const def = typeof type === 'string' ? ACTIONS[type] : undefined;
  if (!def || (isSystemType(type) !== (ctx.pid === 'sys'))) return { ok: false, code: ERR.UNKNOWN_ACTION };
  if (ctx.pid !== 'sys' && !Object.hasOwn(state.players, ctx.pid)) return { ok: false, code: ERR.NOT_JOINED };
  const args = parseArgs(def.schema, act.args);
  if (!args) return { ok: false, code: ERR.BAD_ARGS };
  let code;
  try {
    code = def.check(state, args, ctx);
  } catch (err) {
    return { ok: false, code: ERR.INTERNAL, err };
  }
  if (code) return { ok: false, code };
  const tx = new Tx(state);
  try {
    def.apply(tx, args, ctx);
    processEvents(tx, ctx);
  } catch (err) {
    tx.rollback();                              // exactly as before: no half-applied action
    return { ok: false, code: ERR.INTERNAL, err };
  }
  return { ok: true, tx };
}
