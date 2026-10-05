// Boosts and tools (GDD §3.7, §3.1 rule 10 Level-up Bloom, §6.3 BIG_SPEND, §9 #42). Owned by rules-economy.
//
//   hurry {id, k?}       finish one timer now: a growing crop, a tree's cycle (a sapling matures too), an animal's
//                        product or a baby's growth, or the RUNNING item of one queue (later items re-time).
//                        ceil(remaining hours) Acorns, at most 8 (BOOSTS.hurry); counts toward the daily BIG_SPEND.
//                        Wave 4b (owner wish 5): `k` names ONE queue item of a building: the running one as above, or
//                        a WAITING one, which is made now for what Hurry would cost when it runs (its whole time: it
//                        has not started; content QUEUE_FINISH): it goes to the tray, the items behind it move up
//   buyGoldenSeeds {}    5 Golden Seeds for 12 Acorns (always BIG_SPEND: >= 10 Acorns); refused in overflow
//   buyTool {tool}       a brush tool (Big Watering Can, Wide Sickle ...) for the farm
//   bloom(tx, ctx, level) the Level-up Bloom (owner rule 2026-10-04): everything growing on the farm finishes now:
//                        crops, trees (saplings mature), baby animals, animal products; production queues are not
//                        touched. rules-goals calls it at each farm level-up through the hook registered below
//                        (progress.setBloom), inside the level-up's transaction, so prediction and server agree.
import { defOf, animalOf, lookup, levelFromXp, BOOSTS } from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { objectOf } from '../grid.js';
import { sortedKeys } from '../order.js';
import { overflowOf } from '../economy.js';
import { setBloom } from '../progress.js';
import { payCode, pay } from './decor.js';
import { giantAnchorOf, giantIds, syncGiant } from './giant.js';
import { nurseryOpen } from './breeding.js';
import { isColony } from './animals.js';

const HOUR = 3_600_000;

/**
 * What `hurry` would finish on object `o` now: { kind, path: [...], at, rest, waiting? } or { code }. With `k` (a
 * building's queue item key, wave 4b): that item; `waiting` when it has not started (rest = its whole time).
 */
export function hurryTarget(o, now, k = undefined) {
  const def = o && defOf(o.def);
  if (!def) return { code: ERR.NOT_FOUND };
  const kind = def.layer === 'none' ? 'animal' : def.kind;
  if (k !== undefined) {
    if (kind !== 'building') return { code: ERR.BAD_ARGS };
    const i = o.queue.findIndex((x) => x.k === k);
    if (i < 0) return { code: ERR.NOT_FOUND };
    const q = o.queue[i];
    if (q.e <= now) return { code: ERR.ALREADY_DONE };
    if (q.s > now) return { kind, path: ['queue', i], at: q.e, rest: q.e - q.s, waiting: true };
    return { kind, path: ['queue', i], at: q.e, rest: q.e - now };
  }
  let at = null;
  let path = null;
  if (kind === 'plot') {
    if (!o.crop) return { code: ERR.EMPTY };
    [at, path] = [o.crop.readyAt, ['crop', 'readyAt']];
  } else if (kind === 'tree') [at, path] = [o.readyAt, ['readyAt']];
  else if (kind === 'animal') {
    if (now < o.adultAt) [at, path] = [o.adultAt, ['adultAt']];
    else if (o.readyAt !== null) [at, path] = [o.readyAt, ['readyAt']];
    else return { code: ERR.EMPTY };                     // hungry: nothing is running
  } else if (kind === 'building') {
    const i = o.queue.findIndex((x) => x.s <= now && now < x.e);
    if (i < 0) return { code: ERR.EMPTY };
    [at, path] = [o.queue[i].e, ['queue', i]];
  } else return { code: ERR.BAD_ARGS };
  if (at <= now) return { code: ERR.ALREADY_DONE };
  return { kind, path, at, rest: at - now };
}

/** Acorns a hurry costs for `rest` ms left: 1 per started hour, at most BOOSTS.hurry.maxAcorns. */
export const hurryCost = (rest) => Math.min(BOOSTS.hurry.maxAcorns,
  Math.max(1, Math.ceil(rest / HOUR)) * BOOSTS.hurry.acornsPerHour);

/**
 * A queue whose item i now ends at `end`: each later item that was waiting for its predecessor (s == old end)
 * starts when the predecessor now ends; one queued after its predecessor had finished keeps its start.
 */
export function retime(queue, i, end) {
  const out = queue.map((q) => ({ ...q }));
  let prevOld = out[i].e;
  out[i].e = end;
  let prevNew = end;
  for (let k = i + 1; k < out.length; k++) {
    const q = out[k];
    const dur = q.e - q.s;
    const s = q.s > prevOld ? q.s : prevNew;
    prevOld = q.e;
    q.s = s;
    q.e = s + dur;
    prevNew = q.e;
  }
  return out;
}

/**
 * Queue `queue` with its WAITING item i made now (wave 4b): it moves into the tray just before the first unfinished
 * item (zero length, at that item's start or now, whichever is earlier: the chain stays ordered), and every unfinished
 * item behind re-times from its predecessor (the running one keeps its time; the waiting ones move up by item i's).
 */
export function finishWaiting(queue, i, now) {
  const done = { ...queue[i] };
  const rest = queue.filter((_, j) => j !== i).map((q) => ({ ...q }));
  const first = rest.findIndex((q) => q.e > now);
  const at = Math.min(rest[first]?.s ?? now, now);
  done.s = at;
  done.e = at;
  rest.splice(first < 0 ? rest.length : first, 0, done);
  for (let j = (first < 0 ? rest.length : first + 1); j < rest.length; j++) {
    const q = rest[j];
    if (q.s <= now) continue;                                 // the running item keeps its time
    const s = Math.max(now, rest[j - 1].e);
    q.e = s + (q.e - q.s);
    q.s = s;
  }
  return rest;
}

/**
 * A building's queue for its panel (wave 4b): [{ k, r, s, e, state: 'done' | 'running' | 'waiting', acorns }] where
 * acorns = the price to finish that item now (`hurry {id, k}`; 0 for a finished one). Pure.
 */
export function queueView(o, now) {
  return (o?.queue ?? []).map((q) => {
    const state = q.e <= now ? 'done' : q.s <= now ? 'running' : 'waiting';
    const acorns = state === 'done' ? 0 : hurryCost(state === 'running' ? q.e - now : q.e - q.s);
    return { k: q.k ?? null, r: q.r, s: q.s, e: q.e, state, acorns, by: q.by };
  });
}

/** The object a hurry on `id` acts on: a Giant's plots stand for its anchor (the whole Giant, one price). */
const hurryId = (state, id) => giantAnchorOf(state, id) ?? id;

export const hurry = {
  schema: { id: V.objId, k: V.opt(V.int(0, 1_000_000_000)) },
  check(state, a, ctx) {
    if (levelFromXp(state.farm.xp) < BOOSTS.hurry.unlock) return ERR.LOCKED;
    const t = hurryTarget(objectOf(state, hurryId(state, a.id)), ctx.now, a.k);
    if (t.code) return t.code;
    return payCode(state, a, ctx, { coins: 0, acorns: hurryCost(t.rest) });
  },
  apply(tx, a, ctx) {
    const id = hurryId(tx.state, a.id);
    const o = tx.get(['farm', 'objects', id]);
    const t = hurryTarget(o, ctx.now, a.k);
    const acorns = hurryCost(t.rest);
    pay(tx, ctx, { coins: 0, acorns }, 'hurry', o.def);
    const base = ['farm', 'objects', id];
    if (t.waiting) tx.set([...base, 'queue'], finishWaiting(o.queue, t.path[1], ctx.now));
    else if (t.kind === 'building') tx.set([...base, 'queue'], retime(o.queue, t.path[1], ctx.now));
    else tx.set([...base, ...t.path], ctx.now);
    if (t.kind === 'tree' && o.matureAt > ctx.now) tx.set([...base, 'matureAt'], ctx.now);
    if (t.kind === 'plot' && o.crop.giant === id) syncGiant(tx, id);
    tx.del([...base, 'rcpt']);
    const ev = { e: 'hurried', id, def: o.def, kind: t.kind, acorns, by: ctx.pid, savedMs: t.rest };
    if (a.k !== undefined) ev.k = a.k;                       // one queue item (wave 4b): the panel animates that row
    tx.emit(ev);
  },
};

export const buyGoldenSeeds = {
  schema: {},
  check(state, a, ctx) {
    const G = BOOSTS.goldenSeeds;
    if (levelFromXp(state.farm.xp) < G.unlock) return ERR.LOCKED;
    if (overflowOf(state) > 0) return ERR.STORAGE_FULL;           // GDD §3.6: item purchases wait for the Barn
    return payCode(state, a, ctx, { coins: 0, acorns: G.acorns });
  },
  apply(tx, a, ctx) {
    const G = BOOSTS.goldenSeeds;
    pay(tx, ctx, { coins: 0, acorns: G.acorns }, 'golden_seeds', 'golden_seeds');
    tx.inc(['farm', 'golden'], G.seeds);
    tx.emit({ e: 'purchased', item: 'golden_seeds', qty: G.seeds, coins: 0, acorns: G.acorns, by: ctx.pid });
  },
};

export const buyTool = {
  schema: { tool: V.content('tools') },
  check(state, a, ctx) {
    const t = lookup('tools', a.tool);
    if (!(t.cost > 0) || t.retired || levelFromXp(state.farm.xp) < t.unlock) return ERR.LOCKED;
    if (state.farm.tools[a.tool]) return ERR.ALREADY_DONE;
    return payCode(state, a, ctx, { coins: t.cost, acorns: 0 });
  },
  apply(tx, a, ctx) {
    const t = lookup('tools', a.tool);
    pay(tx, ctx, { coins: t.cost, acorns: 0 }, `tool:${a.tool}`, a.tool);
    tx.set(['farm', 'tools', a.tool], 1);
    tx.emit({ e: 'toolBought', tool: a.tool, by: ctx.pid, coins: t.cost });
  },
};

// ---- Level-up Bloom ---------------------------------------------------------------------------------------------
// Changed by the owner 2026-10-04: a level-up finishes everything growing. It replaces v2 X5's cut (-25 % of the
// remaining time, at most 60 minutes, only for processes started at least 15 minutes earlier): planting just before
// the bar fills is now part of the reward, on purpose.

/**
 * Finish everything growing on the farm now (GDD §3.1 rule 10): every planted crop is ripe (a Giant through its
 * anchor, copied to all nine plots), every tree's running fruit cycle is ripe and a sapling is a mature tree, every baby
 * animal is grown up (it still wants its first meal; one with no Nursery card keeps its card window, `cardBy`), the
 * Breeding Barn's baby on its way is ready, and every animal product on its way, a colony's honey too, waits
 * to be collected. Production-building queues and the Compost Bin are not touched. Canonical object order, tx writes
 * only. One `bloomed` celebration { level, ids, breed? } when anything finished: in a multi-level jump the first level finishes
 * everything and the later ones find nothing growing.
 */
export function bloom(tx, ctx, level = null) {
  const now = ctx.now;
  const nursery = nurseryOpen(tx.state);
  const ids = [];
  // `at` is read before the write (the object is live); a timer already due stays as it is
  const finish = (path, at) => {
    if (!Number.isSafeInteger(at) || at <= now) return false;
    tx.set(path, now);
    return true;
  };
  for (const id of sortedKeys(tx.state.farm.objects)) {
    const o = tx.state.farm.objects[id];
    const def = defOf(o.def);
    if (!def) continue;
    const base = ['farm', 'objects', id];
    if (def.kind === 'plot' && o.crop) {
      if (o.crop.giant !== undefined && o.crop.giant !== id) continue;      // the anchor finishes the whole Giant
      if (!finish([...base, 'crop', 'readyAt'], o.crop.readyAt)) continue;
      if (o.crop.giant === id) {
        syncGiant(tx, id);
        ids.push(...giantIds(tx.state, id));
      } else ids.push(id);
    } else if (def.kind === 'tree') {
      const mature = finish([...base, 'matureAt'], o.matureAt);
      const ripe = finish([...base, 'readyAt'], o.readyAt);
      if (mature || ripe) ids.push(id);
    } else if (def.layer === 'none' && animalOf(o.def)) {
      // a baby with no Nursery card yet keeps its card window until it would have grown up (`cardBy`): the Bloom
      // grows it up, it must not take the Nursery away for good (final release PT-02)
      const was = o.adultAt;                                                 // `o` is live: read before the write
      const card = nursery && !o.nurse && Number.isSafeInteger(was) && was > now && !isColony(o);
      const grown = finish([...base, 'adultAt'], was);
      if (grown && card) tx.set([...base, 'cardBy'], was);
      const ready = o.readyAt !== null && finish([...base, 'readyAt'], o.readyAt);
      if (grown || ready) ids.push(id);
    }
  }
  // the Breeding Barn's baby on its way is a baby too (owner rule: "babies grown up")
  const cur = tx.state.farm.breed?.cur;
  const breed = Boolean(cur) && finish(['farm', 'breed', 'cur', 'readyAt'], cur.readyAt);
  if (ids.length || breed) tx.emit({ e: 'bloomed', level, ids: ids.sort(), ...(breed ? { breed: true } : {}) });
}

// rules-goals' addFarmXp calls the hook once per farm level-up (registered through progress.js setBloom())
setBloom((tx, ctx, before, after) => bloom(tx, ctx, after));
