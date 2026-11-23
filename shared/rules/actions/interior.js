// The farmhouse interior (GDD §5.9 Restoration 6 "Grandma's Farmhouse": interior decorating; content INTERIOR and
// the furniture catalog). M2. Owned by rules-economy.
//
// The room opens when the Restoration project INTERIOR.needsProject is complete: its fixed pieces arrive (the Memory
// Book wall, the hearth, the Ribbon Wall, the keepsake shelf, the window and Grandma's duet table, which may move but
// never leaves). The couple buys furniture from the catalog (coins; BIG_SPEND as any purchase; at most `max` copies
// owned) and places, moves and stores it freely: nothing inside has a timer, XP, Farm Beauty or production, so it can
// never be part of a refund or XP loop. A piece bought less than SAFETY.undoMs ago is refunded in full (the 10-minute
// undo); furniture is never sold, so nothing inside can mint coins.
//
// The room is a floor grid of INTERIOR.grid [w, d] tiles with two layers, 'floor' (rugs) under 'object'; wall pieces
// hang on the back wall (slot i above floor tile x = i) or the left wall (slot i beside floor tile z = i), `size[0]`
// slots wide. INTERIOR.wallBlocked slots take no piece (the chimney breast) and INTERIOR.keepClear floor rects take no
// object-layer piece (the door and the hearth; a rug may lie there).
//
//   furnish {def, x?, z?, rot?, wall?, at?}   place a piece: a copy from the room's tray for free, else bought.
//                                             Floor / object pieces take x, z, rot; wall pieces take wall + at.
//   furnishMove {id, x?, z?, rot?, wall?, at?}  move a placed piece (fixed pieces only when `movable`)
//   furnishStore {id}                         back into the room's tray (never a fixed piece)
//   furnishRefund {id}                        the 10-minute undo of a purchase: the coins back, the piece gone
//
// State `farm.interior = { items: { iid: { def, by, placedAt, x?, z?, rot?, wall?, at?, paid?, rcpt? } },
// tray: { def: n } }`; fixed pieces have ids `fx.<i>` (i = their index in INTERIOR.fixed).
import { INTERIOR, SAFETY, CONTENT, furnitureOf, isLive } from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { projectDone, refund } from '../economy.js';
import { interiorCells } from '../interior-cells.js';
import { payCode, pay } from './decor.js';

const WALLS = ['back', 'left'];
const PLACE = { x: V.opt(V.int(0, 63)), z: V.opt(V.int(0, 63)), rot: V.opt(V.rot), wall: V.opt(V.oneOf(...WALLS)),
  at: V.opt(V.int(0, 63)) };

/** True when the room is part of this build and its Restoration project is complete. */
export const interiorOpen = (state) => Boolean(INTERIOR) && isLive(INTERIOR)
  && projectDone(state, INTERIOR.needsProject);

/** A live furniture def by id, or null. */
const furn = (id) => {
  const d = furnitureOf(id);
  return d && isLive(d) ? d : null;
};

/** Copies of a piece the farm owns (in the room and in the room's tray). */
export function furnitureOwned(state, defId) {
  let n = state.farm.interior.tray[defId] ?? 0;
  for (const it of Object.values(state.farm.interior.items)) if (it.def === defId) n++;
  return n;
}

/** The placement fields an args object gives for `def` ({ x, z, rot } or { wall, at }), or null when they do not fit
 * the piece's layer. */
function spotArgs(def, a) {
  if (def.layer === 'wall') {
    if (a.wall === undefined || a.at === undefined || a.x !== undefined || a.z !== undefined || a.rot !== undefined) {
      return null;
    }
    return { wall: a.wall, at: a.at };
  }
  if (a.x === undefined || a.z === undefined || a.wall !== undefined || a.at !== undefined) return null;
  return { x: a.x, z: a.z, rot: a.rot ?? 0 };
}

/** True when `spot` is where item `it` already stands. */
const sameSpot = (def, it, spot) => (def.layer === 'wall' ? spot.wall === it.wall && spot.at === it.at
  : spot.x === it.x && spot.z === it.z && spot.rot === (it.rot ?? 0));

/**
 * Why piece `def` cannot stand at `spot` (null when it can). `ignore` = the item id being moved (its own cells are
 * free). Pure: the room panel's ghost asks it.
 */
export function furnishCode(state, def, spot, ignore = null) {
  const [gw, gd] = INTERIOR.grid;
  const cells = interiorCells(def, spot)[0][1];
  for (const [x, z] of cells) {
    if (def.layer === 'wall') {
      if (x < 0 || x >= (INTERIOR.walls[z] ?? 0)) return ERR.OUT_OF_BOUNDS;
      if ((INTERIOR.wallBlocked?.[z] ?? []).includes(x)) return ERR.BLOCKED;
    } else {
      if (x < 0 || z < 0 || x >= gw || z >= gd) return ERR.OUT_OF_BOUNDS;
      if (def.layer === 'object' && (INTERIOR.keepClear ?? []).some(([kx, kz, kw, kd]) => x >= kx && x < kx + kw
        && z >= kz && z < kz + kd)) return ERR.BLOCKED;
    }
  }
  const mine = new Set(cells.map(([x, z]) => `${def.layer}:${x},${z}`));
  for (const [iid, it] of Object.entries(state.farm.interior.items)) {
    if (iid === ignore) continue;
    const d = furnitureOf(it.def);
    if (!d || d.layer !== def.layer) continue;
    for (const [x, z] of interiorCells(d, it)[0][1]) if (mine.has(`${d.layer}:${x},${z}`)) return ERR.OCCUPIED;
  }
  return null;
}

/** What placing `def` costs now: { coins, fromTray } or { code } (LOCKED: not sold; CAP: `max` copies owned). */
export function furnishPrice(state, def) {
  if ((state.farm.interior.tray[def.id] ?? 0) > 0) return { coins: 0, fromTray: true };
  if (def.shop !== true || def.fixed || def.retired) return { code: ERR.LOCKED };
  if (furnitureOwned(state, def.id) >= (def.max ?? Infinity)) return { code: ERR.CAP };
  return { coins: def.cost, fromTray: false };
}

export const furnish = {
  schema: { def: V.content('furniture'), ...PLACE },
  check(state, a, ctx) {
    if (!interiorOpen(state)) return ERR.LOCKED;
    const def = furn(a.def);
    if (!def) return ERR.LOCKED;
    const spot = spotArgs(def, a);
    if (!spot) return ERR.BAD_ARGS;
    const p = furnishPrice(state, def);
    if (p.code) return p.code;
    const c = furnishCode(state, def, spot);
    if (c) return c;
    if (Object.hasOwn(state.farm.interior.items, ctx.newId(0))) return ERR.ID_TAKEN;
    return p.coins > 0 ? payCode(state, a, ctx, { coins: p.coins, acorns: 0 }) : null;
  },
  apply(tx, a, ctx) {
    const def = furn(a.def);
    const spot = spotArgs(def, a);
    const p = furnishPrice(tx.state, def);
    const id = ctx.newId(0);
    const rec = { def: def.id, by: ctx.pid, placedAt: ctx.now, ...spot };
    if (p.fromTray) tx.inc(['farm', 'interior', 'tray', def.id], -1, { dropZero: true });
    else if (p.coins > 0) {
      pay(tx, ctx, { coins: p.coins, acorns: 0 }, `furnish:${def.id}`, def.id);
      rec.paid = p.coins;
      rec.rcpt = { coins: p.coins, until: ctx.now + SAFETY.undoMs };
    }
    tx.set(['farm', 'interior', 'items', id], rec);
    tx.emit({ e: 'furnished', id, def: def.id, ...spot, by: ctx.pid, coins: p.coins, fromTray: p.fromTray });
  },
};

/** The placed piece `id` of the room with its def, or { code }. */
function itemOf(state, id) {
  const it = Object.hasOwn(state.farm.interior.items, id) ? state.farm.interior.items[id] : null;
  const def = it ? furnitureOf(it.def) : null;
  return it && def ? { it, def } : { code: ERR.NOT_FOUND };
}

export const furnishMove = {
  schema: { id: V.objId, ...PLACE },
  check(state, a) {
    if (!interiorOpen(state)) return ERR.LOCKED;
    const { it, def, code } = itemOf(state, a.id);
    if (code) return code;
    if (def.fixed && !fixedRow(a.id)?.movable) return ERR.LOCKED;
    const spot = spotArgs(def, a);
    if (!spot) return ERR.BAD_ARGS;
    if (sameSpot(def, it, spot)) return ERR.ALREADY_DONE;
    return furnishCode(state, def, spot, a.id);
  },
  apply(tx, a, ctx) {
    const { it, def } = itemOf(tx.state, a.id);
    const spot = spotArgs(def, a);
    const from = def.layer === 'wall' ? { wall: it.wall, at: it.at } : { x: it.x, z: it.z, rot: it.rot ?? 0 };
    tx.set(['farm', 'interior', 'items', a.id], { ...it, ...spot });
    tx.emit({ e: 'furnishMoved', id: a.id, def: def.id, ...spot, from, by: ctx.pid });
  },
};

export const furnishStore = {
  schema: { id: V.objId },
  check(state, a) {
    if (!interiorOpen(state)) return ERR.LOCKED;
    const { def, code } = itemOf(state, a.id);
    if (code) return code;
    return def.fixed ? ERR.LOCKED : null;                         // the room's own pieces never leave it
  },
  apply(tx, a, ctx) {
    const { it } = itemOf(tx.state, a.id);
    tx.del(['farm', 'interior', 'items', a.id]);
    tx.inc(['farm', 'interior', 'tray', it.def], 1);
    tx.emit({ e: 'furnishStored', id: a.id, def: it.def, by: ctx.pid });
  },
};

export const furnishRefund = {
  schema: { id: V.objId },
  check(state, a, ctx) {
    if (!interiorOpen(state)) return ERR.LOCKED;
    const { it, code } = itemOf(state, a.id);
    if (code) return code;
    return it.rcpt && ctx.now < it.rcpt.until ? null : ERR.NOT_REFUNDABLE;
  },
  apply(tx, a, ctx) {
    const { it } = itemOf(tx.state, a.id);
    tx.del(['farm', 'interior', 'items', a.id]);
    refund(tx, ctx, it.rcpt.coins, `furnish:${it.def}`);
    tx.emit({ e: 'furnishRefunded', id: a.id, def: it.def, coins: it.rcpt.coins, by: ctx.pid });
  },
};

/** The INTERIOR.fixed row of a fixed item id `fx.<i>`, or null. */
export function fixedRow(id) {
  const m = /^fx\.(\d+)$/.exec(id);
  return m ? INTERIOR.fixed[Number(m[1])] ?? null : null;
}

/**
 * Furnish the room with its fixed pieces when it opens (restoration.js calls this as Grandma's Farmhouse completes).
 * Idempotent: a piece already there is left where the couple put it.
 */
export function openInterior(tx, ctx) {
  if (!INTERIOR || !isLive(INTERIOR)) return;
  INTERIOR.fixed.forEach((f, i) => {
    const id = `fx.${i}`;
    if (Object.hasOwn(tx.state.farm.interior.items, id) || !furn(f.def)) return;
    const spot = f.wall !== undefined ? { wall: f.wall, at: f.at } : { x: f.x, z: f.z, rot: f.rot ?? 0 };
    tx.set(['farm', 'interior', 'items', id], { def: f.def, by: 'sys', placedAt: ctx.now, ...spot });
  });
  tx.emit({ e: 'interiorOpened', items: INTERIOR.fixed.map((_, i) => `fx.${i}`), by: ctx.pid });
}

/**
 * A reward piece into the room's tray (Grandma's farewell portrait, quest H7's frame; rules-goals calls it). Placed
 * later for free with `furnish`.
 */
export function giveFurniture(tx, defId, n = 1) {
  if (!furnitureOf(defId) || !(n > 0)) return false;
  tx.inc(['farm', 'interior', 'tray', defId], n);
  return true;
}

/** The catalog for the room panel: live shop pieces with price and how many the farm owns, in content order. */
export function furnitureCatalog(state) {
  return [...(CONTENT.furniture?.values() ?? [])].filter((d) => isLive(d) && !d.fixed).map((d) => ({
    id: d.id, name: d.name, cat: d.cat, layer: d.layer, size: d.size, cost: d.cost, shop: d.shop === true,
    max: d.max ?? null, owned: furnitureOwned(state, d.id), tray: state.farm.interior.tray[d.id] ?? 0,
  }));
}
