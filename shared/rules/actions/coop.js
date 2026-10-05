// Felt co-op actions (GDD §6.2 M1 column: #9 Golden Hour, #10 high-five, #11 keepsake gift; §6.4 thanks). Owned by
// rules-goals. Joint moments use the joint-slot pattern of tech §15.4 on SERVER time; presence facts come only
// from ctx.ext (server-observed, journaled), so a client's prediction may show "waiting" where the server completes.
//
//   sit       { id }          sit on a two-seat bench (decor with effect.seats >= 2) the avatar stands at (within 3
//                             tiles, ctx.ext.near); two players on one bench for COOP.goldenHour.seatMs start
//                             Golden Hour (system action `_golden`, system.js)
//   stand     {}              get up (also `_seen` when the player's last socket closes)
//   highFive  {}              both press within COOP.highFive.windowMs with avatars within radius tiles: a Spark
//                             (+10 % personal XP for 10 min) for both, 30-min cooldown, +1 Heart each (first 3 a day)
//   keepsake  { item }        once a day per giver: one farm-produced good from the Barn onto the partner's shelf,
//                             +1 Heart each, no coins (C9); kept goods (Keep N) ask a soft confirm (RESERVED)
//   thank     { i }           "♥ Thanks" on a feed line: +1 Heart to its actor (at most 10 received a day)
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { COOP, FEED, decorOf, itemOf, isLive } from '../../content/index.js';
import { available, consume } from '../economy.js';
import { dayOf, capTake, capUsed, othersOf, hasPlayer, avatarDist10, addHearts } from '../coop.js';
import { feedRow } from '../feed.js';

const SHELF_MAX = 24;

const seatsOf = (state, id) => {
  const o = Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null;
  const d = o ? decorOf(o.def) : null;
  return d && d.effect && d.effect.seats >= 2 ? d.effect.seats : 0;
};

/** Sitting needs the avatar at the bench: within this many tiles (in tenths), server-observed (RC-31). */
export const SIT_REACH10 = 30;
const TOO_FAR = ERR.TOO_FAR;

export const sit = {
  schema: { id: V.objId },
  check(state, a, ctx) {
    const seats = seatsOf(state, a.id);
    if (!seats) return ERR.BAD_ARGS;
    // ctx.ext.near: the actor's avatar distance to the target's footprint in tenths of a tile (server/together.js).
    // A client prediction has no ext and predicts the sit; the server's own view decides (a seat is not client-
    // trusted: Golden Hour pays Hearts)
    const near = ctx.ext && ctx.ext.near;
    if (Number.isFinite(near) && near > SIT_REACH10) return TOO_FAR;
    const bench = state.farm.coop.bench;
    if (bench[ctx.pid] && bench[ctx.pid].id === a.id) return ERR.ALREADY_DONE;
    let taken = 0;
    for (const pid of Object.keys(bench)) if (pid !== ctx.pid && bench[pid].id === a.id) taken++;
    return taken >= seats ? ERR.OCCUPIED : null;
  },
  apply(tx, a, ctx) {
    tx.set(['farm', 'coop', 'bench', ctx.pid], { id: a.id, at: ctx.now });
    tx.emit({ e: 'seated', pid: ctx.pid, id: a.id });
  },
};

export const stand = {
  schema: {},
  check(state, a, ctx) {
    return state.farm.coop.bench[ctx.pid] ? null : ERR.ALREADY_DONE;
  },
  apply(tx, a, ctx) {
    const id = tx.get(['farm', 'coop', 'bench', ctx.pid]).id;
    tx.del(['farm', 'coop', 'bench', ctx.pid]);
    tx.emit({ e: 'stood', pid: ctx.pid, id });
  },
};

/** Milliseconds left on the farm's high-five cooldown at `now` (0 = ready). */
export function highFiveCooldown(state, now) {
  const last = state.farm.coop.hfAt;
  return Number.isSafeInteger(last) ? Math.max(0, last + COOP.highFive.cooldownMs - now) : 0;
}

export const highFive = {
  schema: {},
  check(state, a, ctx) {
    return highFiveCooldown(state, ctx.now) > 0 ? ERR.COOLDOWN : null;
  },
  apply(tx, a, ctx) {
    const hf = COOP.highFive;
    const j = tx.get(['farm', 'coop', 'hf']);
    const near = j && avatarDist10(ctx, j.by) <= hf.radius * 10;
    if (j && j.by !== ctx.pid && hasPlayer(tx.state, j.by) && ctx.now - j.at <= hf.windowMs && near) {
      // the second press of two DIFFERENT players in time and side by side: the Spark (§9 #20: two tabs of one
      // player are one pid, so they only refresh the slot)
      tx.set(['farm', 'coop', 'hf'], null);
      tx.set(['farm', 'coop', 'hfAt'], ctx.now);
      const until = ctx.now + hf.sparkMs;
      for (const pid of [j.by, ctx.pid]) tx.set(['players', pid, 'spark'], until);
      const day = dayOf(tx.state, ctx.now);
      const hearts = {};
      for (const pid of [j.by, ctx.pid]) {
        const k = capTake(tx, pid, 'hfHearts', hf.heartsFirst, day, 1);
        if (k > 0) { addHearts(tx, pid, k); hearts[pid] = k; tx.emit({ e: 'hearts', pid, n: k, why: 'highFive' }); }
      }
      tx.emit({ e: 'together', kind: 'highFive', a: j.by, b: ctx.pid, until, heartsBy: hearts, hearts: 0 });
    } else {
      tx.set(['farm', 'coop', 'hf'], { by: ctx.pid, at: ctx.now });
      tx.emit({ e: 'highFiveWait', by: ctx.pid });
    }
  },
};

/** Keep N of an item (rules-economy's `farm.keep`, falling back to the item's keepDefault). */
export function keptN(state, item) {
  const k = state.farm.keep && Object.hasOwn(state.farm.keep, item) ? state.farm.keep[item] : null;
  if (k && Number.isSafeInteger(k.n)) return k.n;
  return itemOf(item)?.keepDefault ?? 0;
}

/** The partner a keepsake goes to: the only other joined player (2-player farms), else null. */
const partnerOf = (state, pid) => {
  const others = othersOf(state, pid);
  return others.length === 1 ? others[0] : null;
};

export const keepsake = {
  schema: { item: V.content('items'), to: V.opt(V.pid) },
  check(state, a, ctx) {
    const it = itemOf(a.item);
    if (!it.giftable || !isLive(it)) return ERR.BAD_ARGS;
    const to = a.to ?? partnerOf(state, ctx.pid);
    if (!to || to === ctx.pid || !hasPlayer(state, to)) return ERR.SELF_ONLY;
    if (capUsed(state, ctx.pid, 'keepsake', dayOf(state, ctx.now)) >= COOP.keepsake.perDay) return ERR.COOLDOWN;
    const have = available(state, a.item);
    if (have < 1) return ERR.NO_ITEMS;
    if (have - 1 < keptN(state, a.item) && !confirmed(a, ERR.RESERVED)) return ERR.RESERVED;
    return null;
  },
  apply(tx, a, ctx) {
    const to = a.to ?? partnerOf(tx.state, ctx.pid);
    capTake(tx, ctx.pid, 'keepsake', COOP.keepsake.perDay, dayOf(tx.state, ctx.now));
    consume(tx, a.item, 1);
    const shelf = tx.get(['players', to, 'shelf']);
    tx.set(['players', to, 'shelf', 'rows', String(shelf.n % SHELF_MAX)], { at: ctx.now, by: ctx.pid, item: a.item });
    tx.inc(['players', to, 'shelf', 'n'], 1);
    tx.emit({ e: 'keepsake', item: a.item, to, by: ctx.pid });
  },
};

export const thank = {
  schema: { i: V.int(0, Number.MAX_SAFE_INTEGER) },
  check(state, a, ctx) {
    const row = feedRow(state, a.i);
    if (!row) return ERR.NOT_FOUND;
    if (row.by === ctx.pid || !hasPlayer(state, row.by)) return ERR.SELF_ONLY;
    return row.ty ? ERR.ALREADY_DONE : null;
  },
  apply(tx, a, ctx) {
    const key = String(a.i % FEED.historyMax);
    const row = tx.get(['farm', 'feed', 'rows', key]);
    tx.set(['farm', 'feed', 'rows', key, 'ty'], ctx.pid);
    const day = dayOf(tx.state, ctx.now);
    const k = capTake(tx, row.by, 'thanksIn', COOP.thanks.maxReceivedPerDay, day, COOP.thanks.hearts);
    if (k > 0) { addHearts(tx, row.by, k); tx.emit({ e: 'hearts', pid: row.by, n: k, why: 'thanks' }); }
    tx.emit({ e: 'thanked', i: a.i, to: row.by, by: ctx.pid, hearts: k });
  },
};

