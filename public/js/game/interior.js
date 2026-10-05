// The farmhouse interior (GDD §5.9 Restoration 6 "Grandma's Farmhouse": interior decorating, the Memory Book wall,
// Grandma's duet table; M2; content INTERIOR + the furniture catalog, rules shared/rules/actions/interior.js). The INPUT
// side: going in and out, the furniture ghost on the room's grid, and every click inside.
//
//   in     the Hand on the farmhouse once the room is open walks my farmer to its door (the door creaks, the little bell
//          rings), then the view goes inside (render-world's `view.interior`), the fire and the clock play
//          (audio.setScene({ interior })) and my presence says 'indoors' (the partner's view knows where I am)
//   out    the door (a click on it), Esc with nothing held, the chip's "Leave", or any tool outside
//   place  interior.place(defId) from the room panel's catalog (ui-home): a ghost of the piece follows the pointer over
//          the floor (wall pieces over the wall slots), green where `furnishCode` (the rules' own pure check) allows
//          it; R turns it, a click / tap puts it down = `furnish { def, x, z, rot }` / `{ def, wall, at }` (a piece in
//          the room's tray goes down for free, else it is bought: BIG_SPEND asks as any purchase); a floor piece
//          stays in hand for the next copy only while copies are left
//   move   the Hammer (or a long press) on a placed piece picks it up (`furnishMove`); Del puts it in the room's tray
//          (`furnishStore`); fixed pieces stay, the duet table moves inside the room only
//   Hand   on a piece: its tooltip line; on the Memory Book wall / Ribbon Wall / keepsake shelf: their panels
// The partner sees every piece arrive and move through the state (render-world draws farm.interior.items), and both
// farmers can be inside at once.
//
// The view facade (render-world's render/interior-view.js through view.interior; without it the room panel is the
// room and `enter()` opens it): enter() -> Promise, exit(), active, pick(ndc) -> { kind: 'floor', x, z, inside } |
// { kind: 'item', id, def } | { kind: 'spot', id: 'door' | 'fire' | 'duet_table' | 'memory_wall' | 'window' |
// 'grandma' } | null, ghost(defId | null, { x, z, rot, wall? } | null, valid), setPresent(pids). While inside,
// view.pick answers null and the camera keys / wheel turn and zoom the room's camera.
//
//   interiorOpenNow(state) -> boolean            the room is open (Restoration 6 complete, M2 live)
//   spotFor(def, pick, rot) -> spot | null       a pick under the pointer -> the piece's spot ({ x, z, rot } centred on
//                                                the tile, or { wall, at }); pure, tested
//   createInterior({ store, view, avatar, audio, toast, ui, perform, openPanel }) -> interior
//     interior.enter() / leave() / inside / place(defId) -> boolean / move(id) -> boolean / rotate() / cancel() /
//     confirm() / storeHeld() / held -> { def, rot, id? } | null / at(ndc, { press }) -> handled? / hover(ndc)
//     interior.on('change', fn)   { inside, held, spot, valid, code } (game/mode-chip.js, the room panel)
import { furnitureOf, defOf } from '../../../shared/content/index.js';
import { ERR } from '../../../shared/net/protocol.js';
import { interiorOpen, furnishCode, furnishPrice, fixedRow } from '../../../shared/rules/actions/interior.js';
import { canRun as dryRun } from './targets.js';

/** The room is open: Restoration 6 complete and the interior part of this build. */
export function interiorOpenNow(state) {
  try { return Boolean(state && state.farm.interior && interiorOpen(state)); } catch { return false; }
}

/** The panels the room's own pieces open (the Hand on them): ui-collect's Ribbon Wall, the Journal's Memory Book. */
export const PIECE_PANELS = Object.freeze({ ribbon_wall: ['ribbonwall', 'journal'], memory_wall: ['memorybook', 'journal'],
  keepsake_shelf: ['keepsakes', 'journal'] });

/**
 * The spot a piece of `def` takes for a pick under the pointer (pure): wall pieces on a wall slot (the pick's own, or
 * the nearest wall when the pointer is on the floor next to it), floor and object pieces centred on the floor tile.
 */
export function spotFor(def, pick, rot = 0) {
  if (!def || !pick || pick.inside === false) return null;
  if (def.layer === 'wall') {
    if (pick.kind === 'wall' && (pick.wall === 'back' || pick.wall === 'left') && Number.isSafeInteger(pick.at)) {
      return { wall: pick.wall, at: Math.max(0, pick.at - Math.floor((def.size[0] - 1) / 2)) };
    }
    if (Number.isFinite(pick.x) && Number.isFinite(pick.z)) {
      // the nearer wall to a floor tile: the back wall above row 0, the left wall beside column 0
      const back = pick.z <= pick.x;
      return back ? { wall: 'back', at: Math.max(0, Math.floor(pick.x) - Math.floor((def.size[0] - 1) / 2)) }
        : { wall: 'left', at: Math.max(0, Math.floor(pick.z) - Math.floor((def.size[0] - 1) / 2)) };
    }
    return null;
  }
  if (!Number.isFinite(pick.x) || !Number.isFinite(pick.z)) return null;
  const [w, d] = (rot % 2) ? [def.size[1], def.size[0]] : def.size;
  return { x: Math.floor(pick.x) - Math.floor((w - 1) / 2), z: Math.floor(pick.z) - Math.floor((d - 1) / 2), rot: rot & 3 };
}

/** The farmhouse landmark on the farm (its door is where my farmer goes in), or null. */
function farmhouseOf(state) {
  if (!state) return null;
  for (const id of Object.keys(state.farm.objects).sort()) {
    const o = state.farm.objects[id];
    if (o.def === 'farmhouse' && Number.isFinite(o.x)) return { id, o };
  }
  return null;
}

export function createInterior({ store, view, avatar, audio = null, toast = () => {}, ui = null, perform, openPanel = () => {} }) {
  const listeners = new Set();
  let inside = false;
  let going = false;               // walking to the door
  let held = null;                 // { def, rot, id? } the piece in hand
  let spot = null;                 // its spot under the pointer
  let check = null;                // { valid, code } there
  const facade = () => (view.interior && typeof view.interior.enter === 'function' ? view.interior : null);

  function emit() {
    const p = { inside, going, held: held ? { ...held } : null, spot: spot ? { ...spot } : null, valid: check?.valid ?? false,
      code: check?.code ?? null };
    for (const fn of [...listeners]) { try { fn(p); } catch (err) { console.error('interior listener failed', err); } }
  }

  function enter() {
    if (!store.ready) return { ok: false, code: ERR.NOT_JOINED };
    if (!interiorOpenNow(store.state)) return { ok: false, code: ERR.LOCKED };
    if (inside) return { ok: true };
    const fh = farmhouseOf(store.state);
    const go = () => {
      going = false;
      inside = true;
      audio?.play('door', { gain: 0.8 });
      avatar.setActivity?.('indoors', { indoors: true });
      audio?.setScene?.({ interior: true });
      const f = facade();
      if (f) { try { f.enter(); } catch (err) { console.error('view.interior.enter failed', err); } }
      // without a 3D room (or alongside it) the room panel is where the furniture is chosen (ui-home)
      if (!f) openPanel(['farmhouse', 'home'], { tab: 'room' });
      emit();
    };
    going = true;
    emit();
    if (fh) {
      const def = defOf(fh.o.def);
      const [w, d] = def && def.size ? def.size : [4, 4];
      avatar.walkTo(fh.o.x, fh.o.z, w, d, go);
    } else go();
    return { ok: true };
  }

  function leave(why = 'leave') {
    if (!inside && !going) return false;
    going = false;
    cancel();
    if (inside) {
      inside = false;
      const f = facade();
      if (f) { try { f.exit(); } catch (err) { console.error('view.interior.exit failed', err); } }
      audio?.setScene?.({ interior: false });
      audio?.play('door', { gain: 0.6, rate: 0.94 });
      avatar.setActivity?.(null);
    }
    emit();
    return why;
  }

  /** Validity of the held piece at `s` (the rules' own pure checks: grid, wall slots, keep-clear tiles, overlaps). */
  function verdict(s) {
    if (!held || !s) return { valid: false, code: ERR.OUT_OF_BOUNDS };
    const def = furnitureOf(held.def);
    if (!def) return { valid: false, code: ERR.NOT_FOUND };
    let code;
    try { code = furnishCode(store.state, def, s, held.id ?? null); } catch { code = ERR.BAD_ARGS; }
    if (!code && !held.id) {
      const p = furnishPrice(store.state, def);
      if (p.code) code = p.code;
    }
    return { valid: !code, code: code ?? null };
  }

  /** The ghost for the view: floor pieces at their cells; a wall piece as the room draws one (the back wall's slot
   * on x, the left wall's on z). */
  function showGhost() {
    const f = facade();
    if (!f || typeof f.ghost !== 'function') return;
    let at = null;
    if (held && spot) {
      at = Number.isFinite(spot.x) ? { x: spot.x, z: spot.z, rot: spot.rot ?? 0 }
        : { x: spot.wall === 'back' ? spot.at : 0, z: spot.wall === 'left' ? spot.at : 0, rot: 0, wall: spot.wall, at: spot.at };
    }
    try { f.ghost(held ? held.def : null, at, check?.valid ?? false); } catch (err) { console.error('view.interior.ghost failed', err); }
  }

  /** Pick up a piece from the catalog (buy or from the room's tray) to place it. */
  function place(defId) {
    const def = furnitureOf(defId);
    if (!def || !store.ready) return false;
    if (!inside) { const r = enter(); if (!r.ok) { toast(r.code, {}); return false; } }
    held = { def: defId, rot: 0 };
    spot = null;
    check = null;
    showGhost();
    emit();
    return true;
  }

  /** Pick up a placed piece to move it (fixed pieces stay, the duet table moves inside the room). */
  function move(id) {
    const it = store.state?.farm?.interior?.items?.[id];
    const def = it ? furnitureOf(it.def) : null;
    if (!def) return false;
    if (def.fixed && !fixedRow(id)?.movable) { toast(`${def.name} stays where it is.`, {}); return false; }
    held = { def: it.def, rot: it.rot ?? 0, id };
    spot = def.layer === 'wall' ? { wall: it.wall, at: it.at } : { x: it.x, z: it.z, rot: it.rot ?? 0 };
    check = verdict(spot);
    showGhost();
    emit();
    return true;
  }

  function rotate() {
    if (!held) return;
    const def = furnitureOf(held.def);
    if (!def || def.layer === 'wall') return;
    held.rot = (held.rot + 1) & 3;
    if (spot && Number.isFinite(spot.x)) { spot = { ...spot, rot: held.rot }; check = verdict(spot); }
    showGhost();
    emit();
  }

  function cancel() {
    if (!held) return false;
    held = null;
    spot = null;
    check = null;
    showGhost();
    emit();
    return true;
  }

  /** The room's own places (render-world's spots): what a click on them means. */
  function spotClick(id) {
    switch (id) {
      case 'memory_wall': openPanel(PIECE_PANELS.memory_wall, { tab: 'memory' }); break;
      case 'grandma': openPanel(['grandma', 'farmhouse', 'journal'], { tab: 'grandma' }); break;
      case 'duet_table': toast("Grandma's duet table: one more Farm Kitchen slot. Cook together at the Kitchen.", {}); break;
      case 'fire': audio?.play('thanks', { gain: 0.4 }); toast('The fire crackles. Grandma would be pleased.', {}); break;
      case 'window': toast('The fields, the barn and the two of you, through the old glass.', {}); break;
      default:
    }
  }

  /** Put the held piece down where its ghost stands. */
  function confirm() {
    if (!held || !spot) return null;
    check = verdict(spot);
    if (!check.valid) { toast(check.code, {}); return null; }
    const def = furnitureOf(held.def);
    const pos = def.layer === 'wall' ? { wall: spot.wall, at: spot.at } : { x: spot.x, z: spot.z, rot: spot.rot ?? 0 };
    const type = held.id ? 'furnishMove' : 'furnish';
    const args = held.id ? { id: held.id, ...pos } : { def: held.def, ...pos };
    const code = dryRun(store, type, args);
    if (code && code !== ERR.BIG_SPEND) { toast(code, {}); return null; }
    const res = perform(type, args);
    if (!res || !res.ok) return res;
    audio?.play('furnish', { gain: 0.8 });
    // another copy of the same piece stays in hand while one can still go down (rugs, lamps); else the hand is empty
    const again = !held.id && furnishPrice(store.state, def).code === undefined && def.max !== 1;
    if (!again) { held = null; spot = null; check = null; showGhost(); }
    emit();
    return res;
  }

  /** Del: the held piece goes into the room's tray. */
  function storeHeld() {
    if (!held || !held.id) return null;
    const res = perform('furnishStore', { id: held.id });
    if (res && res.ok) { held = null; spot = null; check = null; showGhost(); emit(); }
    return res;
  }

  /** The pointer over the room (ndc): the ghost follows it. */
  function hover(ndc) {
    const f = facade();
    if (!inside || !held || !f || typeof f.pick !== 'function') return;
    const p = f.pick(ndc);
    const def = furnitureOf(held.def);
    const s = spotFor(def, p, held.rot);
    const k = JSON.stringify(s);
    if (k === JSON.stringify(spot)) return;
    spot = s;
    check = verdict(s);
    showGhost();
    emit();
  }

  /**
   * A press inside the room (ndc; tool = the tool in hand): places the held piece, picks a piece up (Hammer), opens a
   * fixed piece's panel (Hand), leaves through the door. True when it was the room's.
   */
  function at(ndc, { tool = 'hand' } = {}) {
    if (!inside) return false;
    const f = facade();
    const p = f && typeof f.pick === 'function' ? f.pick(ndc) : null;
    if (held) {
      if (p) hover(ndc);
      confirm();
      return true;
    }
    if (!p) return true;
    if (p.kind === 'door' || (p.kind === 'spot' && p.id === 'door')) { leave('door'); return true; }
    if (p.kind === 'spot') { spotClick(p.id); return true; }
    if (p.kind === 'item' && typeof p.id === 'string') {
      const it = store.state.farm.interior.items[p.id];
      const def = it ? furnitureOf(it.def) : furnitureOf(p.def);
      if (tool === 'hammer') { move(p.id); return true; }
      if (def && PIECE_PANELS[def.id]) { openPanel(PIECE_PANELS[def.id], {}); return true; }
      if (def) toast(def.text ? `${def.name}: ${def.text}` : def.name, {});
      return true;
    }
    return true;
  }

  // the room closed under me (another tab, a rollback) or my farmer left it on the farm: out
  store.on?.('change', () => { if (inside && !interiorOpenNow(store.state)) leave('closed'); });
  // a piece I hold was moved or stored by the partner meanwhile: let go of it
  store.on?.('change', () => {
    if (held && held.id && !store.state?.farm?.interior?.items?.[held.id]) cancel();
  });

  return {
    enter,
    leave,
    place,
    move,
    rotate,
    cancel,
    confirm,
    storeHeld,
    hover,
    at,
    get inside() { return inside; },
    get going() { return going; },
    get held() { return held ? { ...held } : null; },
    get spot() { return spot ? { ...spot } : null; },
    on(name, fn) { if (name !== 'change') return () => {}; listeners.add(fn); return () => listeners.delete(fn); },
  };
}
