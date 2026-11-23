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
//   keepsake  { item, to?, note? }  once a day per giver: one farm-produced good from the Barn, WRAPPED: release 1.0
//                             (D1 Surprise gifts) leaves it as a gift box in front of the farmhouse porch for the
//                             partner (farm.gifts[id] = { by, to, item, at, note? } + the box farm.objects[id], def
//                             COOP.keepsake.def); one waiting box per giver (an older one still waiting goes to its
//                             shelf first; it never refuses what a pre-1.0 build accepted, so old journal lines
//                             replay: M26); a walled-in porch means the shelf at once; no coins, no Hearts (C9,
//                             M30); kept goods (Keep N) ask a soft confirm (RESERVED)
//   openGift  { id }          the recipient (only: SELF_ONLY for anyone else) unwraps it: the good goes onto their
//                             shelf, a Memory Book page, a feed line, the box is gone; no Hearts (M30)
//   _gift     {}              (system) a box nobody opened for COOP.keepsake.shelfMs goes to the shelf by itself
//                             (catch-up safe after downtime: nothing is ever lost)
//   thank     { i }           "♥ Thanks" on a feed line: +1 Heart to its actor (at most 10 received a day)
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { COOP, FEED, decorOf, defOf, itemOf, isLive } from '../../content/index.js';
import { available, consume } from '../economy.js';
import { dayOf, capTake, capUsed, othersOf, hasPlayer, avatarDist10, addHearts } from '../coop.js';
import { feedRow, renamedMine } from '../feed.js';
import { canFit, spawnAt, footprint, objTiles, sizeOf, inLand } from '../grid.js';
import { sortedKeys } from '../order.js';

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

/** The surprises waiting on the porch (release 1.0, D1): [[id, gift]] sorted by id. */
export function giftsOn(state) {
  const g = state.farm.gifts;
  return g ? sortedKeys(g).map((id) => [id, g[id]]) : [];
}

/** The waiting box `pid` left (one at a time), or null. */
export const waitingBoxOf = (state, pid) => giftsOn(state).find(([, g]) => g.by === pid)?.[0] ?? null;

/** The boxes waiting for `pid` to open, [[id, gift]]. */
export const giftsFor = (state, pid) => giftsOn(state).filter(([, g]) => g.to === pid);

/** Without a farmhouse: between the two farmers' spawn points (grid.js spawnAt), whole tiles. */
function spawnMiddle(state) {
  const a = spawnAt(state, 'p1');
  const b = spawnAt(state, 'p2');
  return { x: Math.floor((a.x + b.x) / 2), z: Math.floor((a.z + b.z) / 2) };
}

/** Turn a local offset at rot 0 the way the renderer turns a model (yaw = rot x 90 degrees about +Y). */
function turn(dx, dz, rot) {
  let x = dx;
  let z = dz;
  for (let r = 0; r < (rot & 3); r++) [x, z] = [z, -x];
  return [x, z];
}

/**
 * The tile in front of the farmhouse's porch steps (QA r1 F-05: the box stood behind the house or outside the yard
 * fence, by the spawn points), wherever the farmhouse stands, however it is turned and whichever porch its upgrade tier
 * has: content COOP.keepsake.porch at rot 0, turned like the model. `{ x, z, rot }` (rot = the farmhouse's), or null
 * when the farm has no farmhouse.
 */
export function porchSteps(state) {
  const objs = state.farm.objects;
  const id = sortedKeys(objs).find((k) => objs[k].def === 'farmhouse' && Number.isFinite(objs[k].x));
  const def = defOf('farmhouse');
  if (!id || !def) return null;
  const house = objs[id];
  const rot = (house.rot ?? 0) & 3;
  const tier = Number.isSafeInteger(house.up) ? house.up : 0;
  const step = COOP.keepsake.porch.filter((p) => (p.up ?? 0) <= tier).at(-1);
  const [w0, d0] = def.size;
  const [dx, dz] = turn(step.x + 0.5 - w0 / 2, step.z + 0.5 - d0 / 2, rot);
  const [w, d] = footprint(def, rot);
  return { x: Math.floor(house.x + w / 2 + dx), z: Math.floor(house.z + d / 2 + dz), rot };
}

/**
 * The offsets of ring r around the porch steps, in the farmhouse's own frame (x along its front, z out of it), the
 * way a box is best found: nearest first, then along the front (towards the house's middle first), then out in front,
 * never round the back first. Deterministic.
 */
function ringOffsets(r) {
  const out = [];
  for (let oz = -r; oz <= r; oz++) for (let ox = -r; ox <= r; ox++) if (Math.max(Math.abs(ox), Math.abs(oz)) === r) out.push([ox, oz]);
  return out.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]) || Math.abs(a[1]) - Math.abs(b[1])
    || b[0] - a[0] || b[1] - a[1]);
}

/** How far around the porch steps a box may stand (rings, tiles). */
const GIFT_RINGS = 8;
/** The kinds of model that hide what stands behind them, and that nobody walks through (a footprint of 2+ tiles). */
const TALL_KINDS = new Set(['building', 'landmark', 'home', 'tree']);
/**
 * The tiles towards the default camera (render/camera.js: yaw 45 deg, the camera sits at +x +z of what it looks at,
 * pitched about 45 deg): a tall model standing on one of these covers a box on (0, 0) (QA r3 F3-04: the second box of a
 * day stood against the Preserves Kitchen's back wall, and 6 of 6 clicks at its centre opened the kitchen).
 */
const IN_FRONT = Object.freeze([[1, 0], [0, 1], [1, 1]]);

/**
 * The tiles under a tall model (TALL_KINDS, 2+ tiles: `tall`, and `house` for the farmhouse's own) and under a fence.
 */
function screens(state) {
  const tall = new Set();
  const house = new Set();
  const fence = new Set();
  for (const id of sortedKeys(state.farm.objects)) {
    const o = state.farm.objects[id];
    const d = Number.isFinite(o.x) ? defOf(o.def) : null;
    if (!d) continue;
    const isFence = Boolean(d.effect && d.effect.autojoin);
    const isTall = TALL_KINDS.has(d.kind) && Math.max(...sizeOf(o, d)) >= 2;
    if (!isFence && !isTall) continue;
    for (const [x, z] of objTiles(o, d)) {
      const k = `${x},${z}`;
      if (isFence) fence.add(k);
      else { tall.add(k); if (o.def === 'farmhouse') house.add(k); }
    }
  }
  return { tall, house, fence };
}

/**
 * The yard (QA r3 F3-04): the tiles reachable from the porch steps without crossing a fence (autojoin decor) or walking
 * through a building, the farmhouse or a tree, within GIFT_RINGS. Flower beds, lanterns, paths and a box already there
 * are walked over (a person steps round them); the land's edge stops it. Deterministic (a breadth-first walk in a
 * fixed neighbour order).
 */
function yardOf(state, p, walls) {
  const seen = new Set([`${p.x},${p.z}`]);
  const queue = [[p.x, p.z]];
  for (let k = 0; k < queue.length; k++) {
    const [x, z] = queue[k];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      const key = `${nx},${nz}`;
      if (seen.has(key) || Math.max(Math.abs(nx - p.x), Math.abs(nz - p.z)) > GIFT_RINGS) continue;
      if (walls.fence.has(key) || walls.tall.has(key) || !inLand(state, nx, nz)) continue;
      seen.add(key);
      queue.push([nx, nz]);
    }
  }
  return seen;
}

/**
 * Where a new gift box goes (D1, porch only): an open tile near the porch steps (porchSteps; the spawn points' middle on
 * a farm without a farmhouse), never a farmer's spawn tile (they appear there) nor the steps' own tile (the way in).
 * In rings around the steps, nearest first (ringOffsets), and (QA r3 F3-04, coop#1) in this order of preference:
 *   1. a tile of the yard (yardOf: on the steps' side of any fence) that no tall model hides from the camera (IN_FRONT);
 *   2. any tile no tall model hides (the owners' fenced porch has one free tile: the second box of a day goes beside
 *      the fence, where it can be seen and clicked, not behind the Preserves Kitchen);
 *   3. the first open tile, as before (never a refusal where 1.0 used to place a box).
 * A farmhouse turned with its porch away from the camera hides its own steps: then nothing by the porch can be seen
 * from there, and the farmhouse does not push the box away from its steps (it stays where the player turns the camera
 * to; QA r1 F-05). Deterministic and pure. null when the porch is walled in. Only new boxes use it: a waiting box keeps
 * its tile.
 */
export function giftSpot(state) {
  const steps = porchSteps(state);
  const p = steps ?? { ...spawnMiddle(state), rot: 0 };
  const spawn = new Set(['p1', 'p2'].map((pid) => spawnAt(state, pid)).map((s) => `${Math.floor(s.x)},${Math.floor(s.z)}`));
  const open = (x, z) => !spawn.has(`${x},${z}`) && canFit(state, COOP.keepsake.def, x, z, 0) === null;
  const walls = screens(state);
  const yard = yardOf(state, p, walls);
  const hides = (set, x, z) => IN_FRONT.some(([dx, dz]) => set.has(`${x + dx},${z + dz}`));
  const backTurned = hides(walls.house, p.x, p.z);
  const seen = (x, z) => !IN_FRONT.some(([dx, dz]) => {
    const k = `${x + dx},${z + dz}`;
    return walls.tall.has(k) && !(backTurned && walls.house.has(k));
  });
  const tiles = [];
  for (let r = 1; r <= GIFT_RINGS; r++) {
    for (const [ox, oz] of ringOffsets(r)) {
      const [dx, dz] = turn(ox, oz, p.rot);
      if (open(p.x + dx, p.z + dz)) tiles.push({ x: p.x + dx, z: p.z + dz });
    }
  }
  return tiles.find((t) => yard.has(`${t.x},${t.z}`) && seen(t.x, t.z))
    ?? tiles.find((t) => seen(t.x, t.z)) ?? tiles[0] ?? null;
}

export const keepsake = {
  schema: { item: V.content('items'), to: V.opt(V.pid), note: V.opt(V.text(COOP.keepsake.noteMax)) },
  check(state, a, ctx) {
    const it = itemOf(a.item);
    if (!it.giftable || !isLive(it)) return ERR.BAD_ARGS;
    const to = a.to ?? partnerOf(state, ctx.pid);
    if (!to || to === ctx.pid || !hasPlayer(state, to)) return ERR.SELF_ONLY;
    if (a.note !== undefined && !a.note.trim()) return ERR.BAD_ARGS;
    // Never a refusal HEAD (fdafb9c) did not make: a journal line accepted before 1.0 must replay (M26 found a second
    // day's keepsake refused while the first box waited, which stopped the boot). One waiting box per giver is kept
    // by shelving the older box (apply), the gift sheet offers one at a time, and a walled-in porch means the shelf.
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
    // one waiting box per giver: an older one still on the porch goes to its shelf first (nothing lost)
    const older = waitingBoxOf(tx.state, ctx.pid);
    if (older) unwrap(tx, ctx, older, true);
    const gift = { by: ctx.pid, to, item: a.item, at: ctx.now };
    if (a.note !== undefined) gift.note = a.note.trim();
    const spot = giftSpot(tx.state);
    if (!spot) {
      // the porch is walled in: straight onto the shelf, as a keepsake always went before 1.0
      const shelf = tx.get(['players', to, 'shelf']);
      tx.set(['players', to, 'shelf', 'rows', String(shelf.n % SHELF_MAX)], { at: ctx.now, by: ctx.pid, item: a.item,
        ...(gift.note ? { note: gift.note } : {}) });
      tx.inc(['players', to, 'shelf', 'n'], 1);
      tx.emit({ e: 'keepsake', item: a.item, to, by: ctx.pid, id: null, shelf: true, ...(gift.note ? { note: gift.note } : {}) });
      return;
    }
    // the id: the giver and their running count of gifts (server-ordered replicated state: never now / seq / cid)
    const n = tx.state.players[ctx.pid].stats?.keepsakesGiven ?? 0;
    let id = `gift.${ctx.pid}.${n.toString(36)}`;
    for (let k = 1; Object.hasOwn(tx.state.farm.objects, id); k++) id = `gift.${ctx.pid}.${n.toString(36)}.${k}`;
    tx.set(['farm', 'objects', id], { def: COOP.keepsake.def, x: spot.x, z: spot.z, rot: 0, placedAt: ctx.now, by: ctx.pid });
    tx.set(['farm', 'gifts', id], gift);
    tx.emit({ e: 'keepsake', item: a.item, to, by: ctx.pid, id, x: spot.x, z: spot.z, ...(gift.note ? { note: gift.note } : {}) });
  },
};

/** Unwrap gift `id` onto its recipient's shelf (openGift by them, `_gift` by 'sys'). */
function unwrap(tx, ctx, id, auto) {
  const g = tx.get(['farm', 'gifts', id]);
  const o = tx.get(['farm', 'objects', id]);
  const { by, to, item, at } = g;
  const note = g.note;
  const { x, z } = o;
  const shelf = tx.get(['players', to, 'shelf']);
  const row = { at: ctx.now, by, item, ...(note ? { note } : {}) };
  tx.set(['players', to, 'shelf', 'rows', String(shelf.n % SHELF_MAX)], row);
  tx.inc(['players', to, 'shelf', 'n'], 1);
  tx.del(['farm', 'gifts', id]);
  tx.del(['farm', 'objects', id]);
  // progress.js writes the feed line, the Memory Book page (an opened one) and the Together chain's deed
  tx.emit({ e: 'giftOpened', id, item, from: by, to, at, x, z, by: ctx.pid, ...(note ? { note } : {}), ...(auto ? { auto: true } : {}) });
}

export const openGift = {
  schema: { id: V.objId },
  check(state, a, ctx) {
    const g = state.farm.gifts && Object.hasOwn(state.farm.gifts, a.id) ? state.farm.gifts[a.id] : null;
    if (!g) return ERR.NOT_FOUND;
    return g.to === ctx.pid ? null : ERR.SELF_ONLY;
  },
  apply(tx, a, ctx) {
    unwrap(tx, ctx, a.id, false);
  },
};

/** True when a waiting box has stood for COOP.keepsake.shelfMs: `_gift` takes it to the shelf. */
export function giftDue(state, now) {
  return giftsOn(state).some(([, g]) => g.at + COOP.keepsake.shelfMs <= now);
}

/** When the next waiting box goes to the shelf by itself (Infinity when none waits). */
export function giftNextAt(state) {
  let t = Infinity;
  for (const [, g] of giftsOn(state)) t = Math.min(t, g.at + COOP.keepsake.shelfMs);
  return t;
}

export const _gift = {
  schema: {},
  check(state, a, ctx) {
    return giftDue(state, ctx.now) ? null : ERR.ALREADY_DONE;
  },
  apply(tx, a, ctx) {
    for (const [id, g] of giftsOn(tx.state)) if (g.at + COOP.keepsake.shelfMs <= ctx.now) unwrap(tx, ctx, id, true);
  },
};

export const thank = {
  schema: { i: V.int(0, Number.MAX_SAFE_INTEGER) },
  check(state, a, ctx) {
    const row = feedRow(state, a.i);
    if (!row) return ERR.NOT_FOUND;
    if (row.by === ctx.pid || !hasPlayer(state, row.by) || renamedMine(row, ctx.pid)) return ERR.SELF_ONLY;
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

