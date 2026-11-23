// The Acorn shop's unique items (wave 4b, owner wish 2): buying them and the three that are used by hand. Content:
// RELICS (shared/content/wishes4b.js); state and the passive effects: shared/rules/relics.js.
//
//   buyRelic {relic}   one per farm, for good: pays its Acorns (BIG_SPEND asks first), records farm.relics[relic];
//                      a placed relic (Golden Sprinkler, Growth Totem, Rainbow Tree) arrives in the build tray
//   waterAll {}        the Golden Watering Can: waters every growing crop and tree that has not been watered this
//                      cycle (the same watering as the can's stroke; partner tends stay the partner's)
//   farmhand {}        the Farmhand, once a farm day: tends every animal (collects their goods, feeds the hungry ones;
//                      kept feed is never used)
//   turnTime {}        the Time Turner, once a farm day: every production queue on the farm finishes now
//   saveFor {relic?}   the relic THIS player saves for (players[pid].save; no `relic` = let the tracker pick): the
//                      Goal Tracker's "Saving for the Golden Barn: 72 / 250 Acorns" card follows it
// Passive relics need no action: the Lucky Clover (relicLuckBp), the Golden Barn (economy.barnCap), the Golden
// Sprinkler (farming.sprinklerNear, trees.treeSprinklerNear), the Growth Totem (farming.growBpNear), the Rainbow
// Tree (trees.fruitOf). Relics are never sold (decor.js refuses LOCKED); a placed one can be stored and put back.
import { relicOf, isLive, defOf, levelFromXp } from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { sortedKeys } from '../order.js';
import { dayIndex } from '../calendar.js';
import { stash } from '../economy.js';
import { hasRelic, relicUsedToday } from '../relics.js';
import { payCode, pay } from './decor.js';
import { water, waterPlan } from './farming.js';
import { tendOne, tendable } from './animals.js';
import { giantAnchorOf } from './giant.js';

export { relicView, hasRelic } from '../relics.js';

const live = (id) => {
  const r = relicOf(id);
  return r && isLive(r) ? r : null;
};

export const saveFor = {
  schema: { relic: V.opt(V.text(32)) },
  check(state, a, ctx) {
    const cur = state.players[ctx.pid].save ?? null;
    if (a.relic === undefined) return cur === null ? ERR.ALREADY_DONE : null;
    if (!live(a.relic)) return ERR.BAD_ARGS;
    if (hasRelic(state, a.relic)) return ERR.ALREADY_DONE;
    return cur === a.relic ? ERR.ALREADY_DONE : null;
  },
  apply(tx, a, ctx) {
    tx.set(['players', ctx.pid, 'save'], a.relic ?? null);
    tx.emit({ e: 'savingFor', pid: ctx.pid, relic: a.relic ?? null, by: ctx.pid });
  },
};

export const buyRelic = {
  schema: { relic: V.text(32) },
  check(state, a, ctx) {
    const r = live(a.relic);
    if (!r) return ERR.BAD_ARGS;
    if (levelFromXp(state.farm.xp) < r.unlock) return ERR.LOCKED;
    if (hasRelic(state, r.id)) return ERR.ALREADY_DONE;
    if (r.def && !defOf(r.def)) return ERR.NOT_FOUND;
    return payCode(state, a, ctx, { coins: 0, acorns: r.acorns });
  },
  apply(tx, a, ctx) {
    const r = live(a.relic);
    pay(tx, ctx, { coins: 0, acorns: r.acorns }, `relic:${r.id}`, r.id);
    tx.set(['farm', 'relics', r.id], { at: ctx.now, by: ctx.pid });
    // whoever was saving for it has it now: their tracker moves on to the next one
    for (const pid of sortedKeys(tx.state.players)) {
      if (tx.state.players[pid].save === r.id) tx.set(['players', pid, 'save'], null);
    }
    if (r.def) stash(tx, r.def, 1);                         // the placed relics wait in the build tray (a gift copy)
    const ev = { e: 'relicBought', relic: r.id, acorns: r.acorns, by: ctx.pid };
    if (r.def) ev.def = r.def;
    tx.emit(ev);
  },
};

/** The crops and trees the Golden Watering Can waters now: unwatered this cycle, a Giant once (its anchor). Sorted. */
export function waterAllTargets(state, ctx) {
  const out = new Set();
  for (const id of sortedKeys(state.farm.objects)) {
    const o = state.farm.objects[id];
    const kind = defOf(o.def)?.kind;
    if (kind !== 'plot' && kind !== 'tree') continue;
    const t = giantAnchorOf(state, id) ?? id;
    if (out.has(t)) continue;
    if (waterPlan(state.farm.objects[t], ctx.pid, ctx, state).mode === 'water') out.add(t);
  }
  return [...out];
}

export const waterAll = {
  schema: {},
  check(state, a, ctx) {
    if (!hasRelic(state, 'golden_can')) return ERR.LOCKED;
    return waterAllTargets(state, ctx).length ? null : ERR.NOT_NEEDED;
  },
  apply(tx, a, ctx) {
    const ids = waterAllTargets(tx.state, ctx);
    water.apply(tx, { ids }, ctx);
    tx.emit({ e: 'wateredAll', n: ids.length, by: ctx.pid });
  },
};

/** The animals the Farmhand would tend now (sorted ids), for the check and the panel's "N animals" line. */
export function farmhandTargets(state, ctx) {
  const objs = state.farm.objects;
  return sortedKeys(objs).filter((id) => typeof objs[id].home === 'string' && tendable(state, ctx, id));
}

/** Mark a once-a-day relic used on today's farm day. */
function usedToday(tx, ctx, id) {
  tx.set(['farm', 'relics', id, 'd'], dayIndex(ctx.now, tx.state.meta.tz));
}

export const farmhand = {
  schema: {},
  check(state, a, ctx) {
    if (!hasRelic(state, 'farmhand')) return ERR.LOCKED;
    if (relicUsedToday(state, 'farmhand', ctx.now)) return ERR.COOLDOWN;
    return farmhandTargets(state, ctx).length ? null : ERR.NOT_READY;
  },
  apply(tx, a, ctx) {
    let n = 0;
    // one animal at a time, in id order, each against the Barn as the ones before it left it
    for (const id of sortedKeys(tx.state.farm.objects)) {
      if (typeof tx.state.farm.objects[id]?.home !== 'string') continue;
      if (tendOne(tx, ctx, id)) n++;
    }
    usedToday(tx, ctx, 'farmhand');
    tx.emit({ e: 'farmhandDone', n, by: ctx.pid });
  },
};

/** Buildings with an unfinished queue item now (sorted ids): what the Time Turner would finish. */
export function turnerTargets(state, now) {
  const objs = state.farm.objects;
  return sortedKeys(objs).filter((id) => defOf(objs[id].def)?.kind === 'building' && Array.isArray(objs[id].queue)
    && objs[id].queue.some((q) => q.e > now));
}

export const turnTime = {
  schema: {},
  check(state, a, ctx) {
    if (!hasRelic(state, 'time_turner')) return ERR.LOCKED;
    if (relicUsedToday(state, 'time_turner', ctx.now)) return ERR.COOLDOWN;
    return turnerTargets(state, ctx.now).length ? null : ERR.EMPTY;
  },
  apply(tx, a, ctx) {
    const ids = turnerTargets(tx.state, ctx.now);
    let n = 0;
    for (const id of ids) {
      const q = tx.get(['farm', 'objects', id, 'queue']);
      // every unfinished item ends now; a waiting one starts and ends now (zero length): the chain stays ordered
      const out = q.map((x) => {
        if (x.e <= ctx.now) return x;
        n++;
        return { ...x, s: Math.min(x.s, ctx.now), e: ctx.now };
      });
      tx.set(['farm', 'objects', id, 'queue'], out);
      tx.del(['farm', 'objects', id, 'rcpt']);
    }
    usedToday(tx, ctx, 'time_turner');
    tx.emit({ e: 'timeTurned', ids, n, by: ctx.pid });
  },
};
