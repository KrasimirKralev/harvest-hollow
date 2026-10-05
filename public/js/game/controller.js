// Input -> tool -> local dry run -> store.act (tech §10.7, GDD §7.1/§7.2). Owned by the client-core lane.
//
// Contract used by ui/ and tests (M0 names kept; everything else is additive):
//   const controller = createController({ store, view, avatar, canvas, send, toast, ui?, audio? })
//   controller.TOOLS                 [{ id, label, key, unlock, text, acts, brush }] base tools in tray order (content ids:
//                                    hand seed_bag sickle watering_can feed_scoop basket compost_scoop axe hammer)
//   controller.tool                  { id, crop, brush: [w, d], build: { def, rot, moveId, storable } | null }
//   controller.setTool(id, opts?)    opts.crop picks the seed for the Seed Bag AND the Smart Hand (per tab session);
//                                    opts.def starts placement of that def (hammer). Aliases: 'seed' -> 'seed_bag'.
//                                    Returns false for a locked or unknown tool. Fires 'tool'
//   controller.unlocked(id) -> bool  the tool is unlocked at the current farm level
//   controller.place(defId, { rot }?) -> bool   build mode for a def bought in the store (alias build()): green/red
//                                    ghost + reason, R rotates, click places (the purchase IS the `place` action),
//                                    Esc / right-click cancels; plots, fences, paths and decor stay in build mode
//   controller.move(objId) -> bool   pick up a placed object (Hammer click does the same); click puts it down
//   controller.cancel()              leave build / move mode
//   controller.actOn(pick, { shift }?)   what a click on `pick` (view.pick result) does with the current tool
//   controller.do(type, args, at?)   store.act + feedback (toast + shake on a local refusal; a SOFT code opens the
//                                    ui's confirm through toast(code, { type, args }))
//   controller.undo()                Ctrl+Z: refund my newest pristine purchase / move it back (10-minute window); with the
//                                    Hammer over an object someone moved, Ctrl+Z moves THAT one back (CL-05); the object
//                                    the Hammer hint names comes first (controller.setHint(id | null), ui/toolbar.js)
//   controller.moveBack(id) / controller.canMoveBack(id)   put an object back where it stood before its last move
//                                    (anyone's move, 10 minutes); the 'build' event's pickUp hint carries moveBack: id
//   controller.pin(id, on?)          pin / unpin decor (toggle when `on` is omitted)
//   controller.ping(x?, z?)          a ping at the cursor (or tile), 1 per second (G / middle-click do this unless the
//                                    ui-shell's social corner owns them: it exposes ui.mark, then the keys only fire
//                                    'command' { cmd: 'ping' | 'emotes' } and ui/social.js sends through controller.send)
//   controller.send(msg)             a raw presence / social frame (mark, emote) to the server
//   controller.emote(id)             one of protocol EMOTES; 'high_five' also presses the joint high-five action
//   controller.focusMe() / controller.focusPartner()   Space / F
//   controller.photo()               P: hide the HUD, capture, download a PNG, toast "Photo saved"
//   controller.ride(horseId?) / controller.dismount() / controller.riding   (M1b) ride a horse (GDD §3.4 Horse,
//                                    cosmetic, walk speed x1.8): the farmer walks to the horse's Stable and mounts;
//                                    V toggles; the Hand on an adult horse with nothing to do (petted today) rides it.
//                                    Needs an adult horse per rider; sitting on a bench gets you off first
//   controller.placeSet(setId) -> bool   (M1b) decor sets (GDD §3.8, §5.9): build mode for the set's next piece that
//                                    is not on the farm yet; after each placement the next one follows, then the Hand.
//                                    The 'build' event carries set: { id, name, placed, of, near, ids } (near: one copy
//                                    of every other piece is within the set's radius of this spot and of each other;
//                                    ids: those copies, for the world's set glow)
//   controller.keys                  the rebindable keymap (game/keys.js): keys.list() for the settings panel
//   controller.plantWith(crop, plotId) -> result | null   (live requests 2026-10-04) the seed picker at an empty plot:
//                                    plant that plot with `crop` now (the normal predicted path) and switch to the Seed
//                                    Bag with that crop, so the next clicks / drags plant more of it
//   controller.walkTo(x, z) -> { x, z, reached } | null   my farmer walks to that point (float tiles) round everything
//                                    solid (avatar.goTo); a Hand click on open ground does this
//   controller.latency() -> { n, last, avg, p95, max }   input -> first rendered frame after the predicted change (ms)
//   controller.options / controller.setOption(name, bool)   input settings, persisted per browser: edgeScroll (GDD §7.3),
//                                    haptics and keepAwake (mobile wave: vibration pulses, the screen wake lock)
//   (mobile wave 2026-10-03, additive)
//   controller.input                 the pointer kind used last: 'mouse' | 'pen' | 'touch' (event 'input' on a change)
//   controller.confirm() -> result | null   put the build ghost down where it stands (the touch ✓; = a click on it)
//   controller.rotate()              turn the build ghost a quarter (R; the touch ⟳)
//   controller.haptic(kind) -> bool  a vibration pulse (game/haptics.js PULSES) for a touch player who has them on
//   controller.uproot(id) -> result | null   Shift + Hand on that plot (pull a growing crop up): a phone has no Shift, so
//                                    the ui's long-press card offers it ("Pull it up")
//   controller.canUproot(id) -> bool  whether that plot has a crop the Hand would pull up now
//   controller.device                set by main.js: game/device.js (fullscreen toggle, wake lock) for the ui
//   (wave 3, M2, additive)
//   controller.fishing               game/fishing.js: the Fishing Dock's calm cast (GDD §6.2 #21). The Hand on a dock
//                                    (or the Willow Pond's spot: render-world's place 'fishing', or a tile next to it)
//                                    walks there, sits and casts; while a line is out a click, a tap or Space anywhere
//                                    hooks (fishing.press). fishing.start(dockId | { pond }) for a panel's "Go fishing"
//   controller.pairing               game/pairing.js: picking two adults on the farm for the Breeding Barn (L28);
//                                    pairing.start(firstId?, species?) from the breeding panel, Esc / right click ends it
//   controller.interior              game/interior.js: the farmhouse room (Restoration 6). The Hand on the farmhouse goes
//                                    in once the room is open; inside, every press is the room's (place / move furniture,
//                                    the door leaves); interior.place(furnitureId) from the room panel's catalog
//   controller.mode -> 'fishing' | 'pairing' | 'interior' | null   the special input mode now (game/mode-chip.js)
//   (wave 4, the owners' wish list, additive)
//   controller.options.rotateDrag    boolean (wish H "Right-drag: Pan / Rotate camera"; setOption('rotateDrag', bool), or
//                                    setOption('rightDrag', 'pan' | 'rotate'); options.rightDrag reads 'pan' | 'rotate';
//                                    remembered per device): on = a right-drag turns the view (horizontal) and tilts it
//                                    (vertical, the camera keeps it within ~30-85 deg); middle-drag or Shift + right-drag
//                                    pans. A phone tilts with two fingers side by side dragged up or down together
//                                    (game/camera-input.js). PageUp / PageDown tilt, Home resets the turn and the tilt.
//                                    Needs render-world's view.camera.orbit; without it the rotate mode turns in quarters
//   controller.rotate(id?)           with an id: turn that PLACED object a quarter where it stands (wish C: its centre
//                                    stays; the next orientation that fits; a normal `move`, so Ctrl+Z / Move back undo
//                                    it); without: turn the held ghost (R, the touch ⟳). rotateObject(id) is the same;
//                                    canRotate(id) -> bool. R with the Hammer over a placed thing turns it in place; the
//                                    'build' hint for a placed thing carries `rotate: id | null` (the ui's ↻ button)
//   the Barn's doors (wish 8)        a click that opens the Barn (any tool that opens its panel) swings its doors open
//                                    (render-world's view.objects.doors(id, open), when it is there) and they close
//                                    when its panel closes
//   weeds (wish F)                   the Hand on a tile whose pick carries `weed` (a clearable wild tuft on owned land,
//                                    render-world) clears it through the rules' weeds action (targets.js VERBS.weed),
//                                    predicted, with the farmer walking over; a tile without a weed walks as before
//   sleeping pets (wish 4)           the Hand on a pet whose pick says `asleep`: the day's pat or treat still counts, with a
//                                    soft snore and a 💤 line (petted already: "fast asleep 💤", no bonk)
//   controller.stroke -> { verb, count, item } | null    the drag stroke in progress
//   controller.on(name, fn) -> unsubscribe
//        'tool'    { ...tool }
//        'hover'   pick | null                          (ui.tooltip; fired when the hovered tile/object changes)
//        'stroke'  { verb, count, item, active }        drag-paint progress ("painting: Carrot x 14"); active false = end
//        'invalid' { id, code, by?, race? }             a click that did nothing (shake + bonk + reason); race: true
//                                                       when the partner got there first (no shake, no bonk)
//        'command' { cmd: 'emotes' | 'ping' | 'seedTray' | 'seedPicker' | 'panel', name?, args? }   things the ui opens
//                                                       (T, G, the Seed Bag with no seed chosen, a building / home /
//                                                       landmark click); seedPicker { id, x, z, crop }: the Hand on an
//                                                       empty plot, the picker opens at that plot (ui/seeds.js)
//        'build'   { def, rot, moveId, x, z, valid, code, pickUp?, moveBack?, masterwork?, set? } | null   placement
//                                                       state (ui hints, cost label); pickUp: the default Hammer would
//                                                       lift that object, moveBack: it can also go back where it stood
//                                                       (Ctrl+Z), masterwork: that coin decor can be upgraded (M1b: the
//                                                       hint's button opens ui.panels.open('decorsets', { id }))
//        'ride'    { riding, horse }                    mounted / got off (a ui chip may show "Riding · V gets off")
//        'photo'   { blob }                             a photo was taken (P); the Memory Book keeps it when the player
//                                                       says "Keep it" (game/memory.js)
//        'walk'    { x, z, reached }                    my farmer set off for this point (a Hand click on open ground):
//                                                       the destination marker (game/walk-marker.js)
//        'input'   { kind: 'mouse' | 'pen' | 'touch' }  the player switched between mouse and touch (touch hints, the
//                                                       build bar of game/touch-build.js)
// Touch (mobile wave; game/touch.js has the model): a tap is a click with the tool in hand (on open ground it also
// walks the farmer there); a one-finger drag from an actionable target paints, from anywhere else pans (with a glide
// when it lets go); two fingers pan, pinch-zoom and twist the view in 90° snaps; a 450 ms press shows the tooltip
// instead of acting (with the Hammer on a placed thing: its Pin / Move back hint); a double tap on the same thing
// focuses the camera. Build mode: a tap moves the ghost, a drag on the ghost carries it above the finger, a tap on
// the ghost (or ✓) places it. Touch never emits 'hover' except for a long press (the tooltip).
// Pointer model: a left press on an actionable target acts AT ONCE and starts a drag-paint stroke (each object once
// per stroke, the path rasterised over tiles so no plot is skipped); a left press anywhere else is a click (on
// release) or, once it moves 6 px, a pan; right/middle drag pans; middle click pings; wheel zooms toward the cursor;
// double-click focuses. The Hand's click on an empty plot opens the seed picker there, and on open ground walks my
// farmer to that point. Keys (game/keys.js, physical keys): 1-9 tools, H hand, B build, R rotate, Q/E camera, WASD
// pan, +/- zoom, Space me, F partner, G ping, T emotes, P photo, Ctrl+Z undo, Del store, Esc cancel, Shift = uproot.
import { cropOf, defOf, levelFromXp, liveAt, isLive, CONTENT } from '../../../shared/content/index.js';
import { COOP, SAFETY } from '../../../shared/content/index.js';
import { canPlace, footprint, tileOwner } from '../../../shared/rules/grid.js';
import * as GRID from '../../../shared/rules/grid.js';
import { ACTIONS } from '../../../shared/rules/index.js';
import { buyPrice } from '../../../shared/rules/actions/decor.js';
import * as decorRules from '../../../shared/rules/actions/decor.js';
import { animalPrice, animalBuyPlan } from '../../../shared/rules/actions/animals.js';
import * as beauty from '../../../shared/rules/actions/beauty.js';
import { MSG, LIMITS, ERR, SOFT, EMOTES } from '../../../shared/net/protocol.js';
import {
  describe, verbsFor, resolve, resolveBatch, countDone, OPENS, CLIENT_VERBS, ONCE_VERBS, RIDEABLE, adultHorses, canRun,
} from './targets.js';
import { RIDE_TOOL } from './avatar.js';
import { createStroke, brushTiles } from './stroke.js';
import { TOOL_LIST, ALIASES, toolUnlocked, brushOf, cursorFor } from './tools.js';
import { createKeymap } from './keys.js';
import { TOUCH, tapSlop, pair, angleDelta, twist, isDoubleTap, groundAt, flingStep } from './touch.js';
import { createHaptics } from './haptics.js';
import { TILE_M } from '../../../shared/content/config.js';
import { createFishing, pondSpots } from './fishing.js';
import { createPairing } from './pairing.js';
import { createInterior, interiorOpenNow } from './interior.js';
import { orbitStep, tiltIntent, canOrbit, quarterSteps, ORBIT } from './camera-input.js';

export const TOOLS = TOOL_LIST;

/** Social calls on the avatars view (render-life via view.avatars), or an older facade method of the same name. */
function socialOf(view) {
  return (name, ...args) => {
    const av = view.avatars;
    if (av && typeof av[name] === 'function') return av[name](...args);
    if (typeof view[name] === 'function') return view[name](...args);
    return undefined;
  };
}

const CLICK_PX = 6;
/**
 * A world place's panel when the names differ between the lanes (render-world's place -> the ui's registered panels, the
 * first one registered opens): the Stable Paddock's ring is ui-league's 'horseShow' (M2), else the Fair tent's panel.
 */
export const PLACE_PANELS = Object.freeze({ horseshow: Object.freeze(['horseShow', 'horseshow', 'fair']) });
/** A drag stroke's held frames are sent (merged) this often: a 15-plot swipe is a few acts, not 15 (performance-16).
 * Prediction is unaffected (local and instant); only the partner sees the stroke in steps of this size, which sit
 * close to the ~150 ms their view of my cursor already lags (presence interpolation). */
export const STROKE_SEND_MS = 250;
const PING_MS = COOP?.pings?.perMs ?? 1000;
const REPEAT_PLACE = new Set(['plot', 'decor']);       // kinds that stay in build mode after a placement
const ANIMAL_VERBS = new Set(['tend', 'collect', 'pet', 'bottle']);
/** protocol EMOTES -> the avatars view's emote kinds (render-life avatars-view EMOTES). */
export const EMOTE_VIEW = Object.freeze({ wave: 'wave', heart: 'heart', laugh: 'laugh', thumbs_up: 'thumbs', come_here: 'come',
  cheer: 'cheer', high_five: 'star', dance: 'dance' });

const session = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const local = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

/**
 * The decor-set hint for a footprint (x, z, w, d) about to hold one piece of `set` (GDD §3.8: a set shines when one
 * copy of every piece stands within its radius of each other; rules-economy `decorGroups` decides the bonus). Pure.
 * `near`: one copy of every OTHER piece already out can be picked so that all of them and this spot are pairwise
 * within the radius (the same search as the rules', rarest piece first, bounded). `out`: how many of the set's pieces
 * have a copy on the farm. `ids`: the copies that make `near` true (else the nearest copy of each piece), to glow.
 * @returns {{ out: number, near: boolean, ids: string[] }}
 */
export function setSpot(state, set, x, z, w = 1, d = 1, def = null) {
  const rect = (o) => {
    const [ow, od] = footprint(defOf(o.def), o.rot ?? 0);
    return { x: o.x, z: o.z, w: ow, d: od };
  };
  const gap = (a, b) => Math.max(0, a.x - (b.x + b.w - 1), b.x - (a.x + a.w - 1),
    a.z - (b.z + b.d - 1), b.z - (a.z + a.d - 1));
  const objs = state.farm.objects;
  const byDef = new Map(set.pieces.map((p) => [p, []]));
  for (const id of Object.keys(objs).sort()) {
    const o = objs[id];
    if (byDef.has(o.def) && Number.isFinite(o.x)) byDef.get(o.def).push(id);
  }
  const out = set.pieces.filter((p) => byDef.get(p).length > 0).length;
  const me = { x, z, w, d };
  const others = set.pieces.filter((p) => p !== def && byDef.get(p).length > 0);
  const dist = (id) => gap(rect(objs[id]), me);
  const nearest = others.map((p) => byDef.get(p).reduce((b, id) => (dist(id) < dist(b) ? id : b)));
  const lists = others.map((p) => byDef.get(p).filter((id) => gap(rect(objs[id]), me) <= set.radius))
    .sort((a, b) => a.length - b.length);
  if (lists.some((l) => l.length === 0)) return { out, near: false, ids: nearest };
  let budget = 5000;
  const pick = (k, chosen) => {
    if (k === lists.length) return chosen;
    for (const id of lists[k]) {
      if (--budget < 0) return null;
      const r = rect(objs[id]);
      if (!chosen.every((c) => gap(r, rect(objs[c])) <= set.radius)) continue;
      const done = pick(k + 1, [...chosen, id]);
      if (done) return done;
    }
    return null;
  };
  const found = pick(0, []);
  return { out, near: Boolean(found), ids: found ?? nearest };
}


/** [w, d] of placed object `o` at its rotation: a grown animal home covers its whole paddock (wave 4b: grid.objFootprint). */
const objSize = (o, def) => (o && Number.isFinite(o.x) && typeof GRID.objFootprint === 'function' ? GRID.objFootprint(o, def)
  : footprint(def, o?.rot ?? 0));
/** [w, d] at `rot` of a def being placed, or of object `moveId` being moved (a grown home moves with its paddock). */
function sizeAt(state, defId, rot, moveId = null) {
  const def = defOf(defId);
  const o = moveId && state && Object.hasOwn(state.farm.objects, moveId) ? state.farm.objects[moveId] : null;
  if (o && o.def === defId && typeof GRID.sizeOf === 'function') {
    const [w, d] = GRID.sizeOf(o, def);
    return rot % 2 ? [d, w] : [w, d];
  }
  return footprint(def, rot);
}
export function createController({
  store, view, avatar, canvas, send, toast, ui = null, audio = null, peerTool = () => null,
}) {
  const events = { tool: new Set(), hover: new Set(), stroke: new Set(), invalid: new Set(), command: new Set(), build: new Set(),
    ride: new Set(), photo: new Set(), walk: new Set(), input: new Set() };
  const emit = (name, payload) => {
    for (const fn of [...events[name]]) {
      try { fn(payload); } catch (err) { console.error(`controller listener '${name}' failed`, err); }
    }
  };
  const savedCrop = session.get('hh.crop');
  // wave 4 (wish 2): what the Compost Scoop spreads, Compost or Fertilizer (the ui's strip over the toolbar picks it)
  const tool = { id: 'hand', crop: savedCrop && cropOf(savedCrop) ? savedCrop : null, build: null,
    spread: session.get('hh.spread') === 'fertilizer' ? 'fertilizer' : 'compost' };
  const keys = createKeymap({ get: () => local.get('hh.keys'), set: (v) => local.set('hh.keys', v) });
  let hover = null;              // last pick under the cursor
  let lastNdc = null;
  let down = null;               // pointer gesture in progress
  let stroke = null;             // drag-paint stroke in progress
  let shift = false;
  let lastPingAt = -Infinity;
  let pendingSit = null;         // the bench id the farmer is walking to (sitDown)
  let pendingRide = null;        // the horse id the farmer is walking to (ride)
  let riding = null;             // the horse I ride (cosmetic), or null
  let setPlan = null;            // { id } the decor set being placed piece by piece (placeSet)
  let releaseTimer = null;       // the held stroke frames go out when it fires (or when the stroke ends)
  let ghostShown = false;
  const held = new Set();        // pan keys held
  // GDD §7.3 settings: edge scroll; the mobile wave's vibration pulses and screen wake lock (both on by default)
  // wave 4 (wish H): rotateDrag, a right-drag turns and tilts the view instead of panning (off: as always)
  const options = { edgeScroll: false, haptics: true, keepAwake: true, rotateDrag: false, ...(local.get('hh.input') || {}) };
  if (Object.hasOwn(options, 'rightDrag')) { options.rotateDrag = options.rightDrag === 'rotate'; delete options.rightDrag; }
  options.rotateDrag = options.rotateDrag === true;
  let edge = null;               // the pointer near a canvas edge: { x: -1|0|1, z: -1|0|1, k: 0..1 } (edge scroll)
  const lat = [];                // latency samples (ms)
  let latPending = [];           // input times waiting for the next rendered frame

  const now = () => store.now();
  const viewSocial = socialOf(view);
  const uiSocial = () => Boolean(ui && typeof ui.mark === 'function');
  /** Input or a predicted change: the next frame must come NOW and the loop stays interactive (render-world). */
  const poke = () => (typeof view.interact === 'function' ? view.interact() : view.invalidate());
  const me = () => store.pid;
  const partnerPid = () => (store.state ? Object.keys(store.state.players).sort().find((p) => p !== me()) ?? null : null);

  // ---- tools ----------------------------------------------------------------------------------------------
  const resolveTool = (id) => (TOOL_LIST.some((t) => t.id === id) ? id : ALIASES[id] ?? null);
  const brush = () => (tool.id === 'hand' || tool.id === 'hammer' ? [1, 1] : brushOf(store.state, tool.id));

  function publicTool() {
    return { id: tool.id, crop: tool.crop, spread: tool.spread, brush: brush(), build: tool.build ? { ...tool.build } : null };
  }

  function setTool(id, opts = {}) {
    const tid = resolveTool(id);
    if (!tid) return false;
    if (store.state && !toolUnlocked(store.state, tid)) {
      const t = CONTENT.tools.get(tid);
      toast(ERR.LOCKED, { type: 'tool', args: { tool: tid, unlock: t?.unlock } });
      return false;
    }
    if (opts.crop && cropOf(opts.crop)) { tool.crop = opts.crop; session.set('hh.crop', opts.crop); }
    if (opts.spread === 'compost' || opts.spread === 'fertilizer') { tool.spread = opts.spread; session.set('hh.spread', opts.spread); }
    // another tool in hand: the farmer gets up from the dock, the matchmaking ends (M2)
    if (tid !== tool.id) { leaveDock('tool'); pairing.cancel(); if (tid !== 'hand' && tid !== 'hammer') interior.leave('tool'); }
    const leavingBuild = tool.id === 'hammer' && tid !== 'hammer';
    if (leavingBuild || (tid === 'hammer' && !opts.def)) endBuild();
    tool.id = tid;
    endStroke();
    if (tid === 'hammer' && opts.def) startBuild(opts.def, { rot: opts.rot ?? 0 });
    else if (tid === 'hammer' && !tool.build) startBuild('plot', { rot: 0, quiet: true });
    canvas.style.cursor = cursorFor(tid);
    refreshHighlight();
    emit('tool', publicTool());
    return true;
  }

  // ---- lost races seen locally (CL-04) --------------------------------------------------------------------------
  // The partner's confirmed actions touch objects; a local refusal on one of them within RACE_WINDOW_MS is a lost
  // race ("Mia got there first ♥", GDD §6.3), never an error with a shake and a bonk: on a LAN the partner's delta
  // usually lands before my click, so the server never sees my attempt and its `rej.by` cannot help.
  const RACE_WINDOW_MS = 10_000;
  const RACE_CODES = new Set([ERR.EMPTY, ERR.NOT_READY, ERR.OCCUPIED, ERR.NOT_FOUND, ERR.ALREADY_DONE, ERR.NOT_HUNGRY]);
  const touchedBy = new Map();   // objId -> { by, at: performance.now() }
  store.on('fx', ({ ev, by, local }) => {
    if (local || !by || by === me() || by === 'sys' || !ev) return;
    const t = performance.now();
    const ids = Array.isArray(ev.ids) ? ev.ids : typeof ev.id === 'string' ? [ev.id] : [];
    for (const id of ids) {
      touchedBy.set(id, { by, at: t });
      const o = store.state && Object.hasOwn(store.state.farm.objects, id) ? store.state.farm.objects[id] : null;
      if (o && typeof o.home === 'string') touchedBy.set(o.home, { by, at: t });    // an animal: its home too
    }
    if (touchedBy.size > 400) for (const [id, r] of touchedBy) if (t - r.at > RACE_WINDOW_MS) touchedBy.delete(id);
  });
  /** The partner who touched one of `ids` in the last RACE_WINDOW_MS, when `code` reads as a lost race. */
  function raceBy(ids, code) {
    if (!RACE_CODES.has(code)) return null;
    const t = performance.now();
    for (const id of ids) {
      const r = touchedBy.get(id);
      if (r && t - r.at < RACE_WINDOW_MS) return r.by;
    }
    return null;
  }

  // ---- acting -------------------------------------------------------------------------------------------------
  /** Feedback for something that did not happen: shake, bonk (feedback.js listens), the reason. */
  function invalid(id, code, ctx = {}) {
    const ids = id ? [id] : ctx.args && Array.isArray(ctx.args.ids) ? ctx.args.ids : ctx.args && typeof ctx.args.id === 'string' ? [ctx.args.id] : [];
    const by = code ? raceBy(ids, code) : null;
    if (by) {                                              // a lost race: the friendly toast, no shake, no bonk
      emit('invalid', { id: id ?? null, code, by, race: true });
      toast(code, { ...ctx, by });
      return;
    }
    if (id) view.fx.play({ e: 'invalid', id });
    emit('invalid', { id: id ?? null, code });
    if (code && code !== ERR.UNKNOWN_ACTION) toast(code, ctx);
  }

  /**
   * The coins a purchase costs on THIS screen right now, sent as `max` so the server never charges more than the
   * player saw: two farmers buying the n-th hen at once must not pay 1,170 and silently 1,287 (coop-robust-13,
   * RC-18; above `max` the server asks again with the soft code PRICE). Only when this build's rules take `max`.
   */
  function withMax(type, args) {
    if (!args || args.max !== undefined || !ACTIONS[type]?.schema || !Object.hasOwn(ACTIONS[type].schema, 'max') || !store.state) return args;
    let coins = 0;
    try {
      if (type === 'place') coins = buyPrice(store.state, args.def).coins;
      // a full home grows a room step with the purchase (wave 4b): the price shown includes the step
      else if (type === 'buyAnimal') {
        const plan = typeof animalBuyPlan === 'function' ? animalBuyPlan(store.state, args.def, args.adult === true, args.home) : null;
        coins = plan && plan.code === null ? plan.coins : animalPrice(store.state, args.def, args.adult === true);
      }
      // a Masterwork upgrade (M1b): the price of the next level of THIS decor, as its card shows it
      else if (type === 'masterwork' && typeof beauty.masterworkPrice === 'function') {
        coins = beauty.masterworkPrice(store.state, store.state.farm.objects[args.id] ?? null).coins ?? 0;
      }
    } catch { coins = 0; }
    return Number.isSafeInteger(coins) && coins > 0 ? { ...args, max: coins } : args;
  }

  /** Run a resolved action now (hold: predict now, send with the stroke's next release); returns the result. */
  function perform(r, at, t0, hold = false) {
    r = { ...r, args: withMax(r.type, r.args) };
    const res = hold ? store.act(r.type, r.args, { hold: true }) : store.act(r.type, r.args);
    if (!res.ok) {
      invalid(r.args && typeof r.args.id === 'string' ? r.args.id : null, res.code, { type: r.type, args: r.args });
      return res;
    }
    latPending.push(t0 ?? performance.now());
    poke();
    walkNear(at);
    return res;
  }

  /** The avatar jogs next to what was acted on (cosmetic; an animal's home stands in for the animal). */
  function walkNear(at) {
    if (!at) return;
    leaveDock('walk');
    let o = at;
    if (at.kind === 'animal' && at.home) o = describe(store.state, at.home, now(), me()) ?? at;
    if (!Number.isFinite(o.x) || !Number.isFinite(o.z)) return;
    const def = o.def && typeof o.def === 'object' ? o.def : null;
    const rot = o.obj ? o.obj.rot ?? 0 : 0;
    const [w, d] = def && def.size ? (o.obj ? objSize(o.obj, def) : footprint(def, rot)) : [1, 1];
    avatar.walkTo(o.x, o.z, w, d);
  }

  /** controller.do: a panel's or the ui's action with the same feedback as a click. */
  function doAct(type, args, at) {
    args = withMax(type, args);
    const res = store.act(type, args);
    if (!res.ok) {
      if (SOFT.has(res.code)) toast(res.code, { type, args });
      else invalid(args && typeof args.id === 'string' ? args.id : null, res.code, { type, args });
      return res;
    }
    latPending.push(performance.now());
    poke();
    if (at && Number.isFinite(at.x)) walkNear(at);
    else if (args && typeof args.id === 'string') walkNear(describe(store.state, args.id, now(), me()));
    else if (type === 'place' && Number.isFinite(args.x)) {
      const [w, d] = defOf(args.def)?.size ? footprint(defOf(args.def), args.rot ?? 0) : [1, 1];
      avatar.walkTo(args.x, args.z, w, d);
    }
    afterPlaced(type, args);
    return res;
  }

  /**
   * An action of the M2 input modules (fishing, pairing): a click's feedback on a refusal, never a walk (the farmer is
   * already where it happens: a walk would stand them up from the dock).
   */
  function actHere(type, args) {
    const res = store.act(type, args);
    if (!res.ok) {
      if (SOFT.has(res.code)) toast(res.code, { type, args });
      else invalid(args && typeof args.id === 'string' ? args.id : null, res.code, { type, args });
      return res;
    }
    latPending.push(performance.now());
    poke();
    return res;
  }
  const fishing = createFishing({ store, view, avatar, audio, toast, perform: actHere, haptic: (k) => haptic(k) });
  const pairing = createPairing({ store, view, toast, perform: actHere });
  const interior = createInterior({ store, view, avatar, audio, toast, ui, perform: actHere, openPanel: (n, a) => openPanel(n, a) });
  /** Working anywhere else stands me up from the dock (the line stays in the water: nothing is lost). */
  function leaveDock(why) {
    if (fishing.active) fishing.stop(why);
  }
  // going into the farmhouse ends the other modes (the dock, the matchmaker), whoever started it (a panel, the Hand)
  interior.on('change', (r) => { if (r.going) { leaveDock('room'); pairing.cancel(); } });

  function verbOpts(verb) {
    return verb === 'plant' || verb === 'goldenPlant' ? { crop: tool.crop } : {};
  }

  /** Targets on a tile for a verb: the object, or a home's animals for animal verbs. */
  function idsOnTile(x, z, verb) {
    const id = tileOwner(store.state, x, z);
    if (!id) return [];
    const t = describe(store.state, id, now(), me());
    if (t && t.kind === 'home' && ANIMAL_VERBS.has(verb)) return t.occupants;
    return [id];
  }

  /** Start a stroke on a pick; acts on the first target(s). Returns false when nothing was runnable. */
  function beginStroke(p, e) {
    const base = p && p.kind === 'object' ? describe(store.state, p.id, now(), me()) : null;
    if (!base) return { started: false };
    let refusal = null;
    for (const t of [base]) {
      for (const verb of verbsFor(tool.id, t, { shift: e.shiftKey, spread: tool.spread })) {
        // the Hand on an empty plot asks which seed (the picker at the plot), whatever was planted before (live
        // requests 2026-10-04: "an easy mode for the seeds"); the Seed Bag plants its crop
        if (verb === 'plant' && tool.id === 'hand') { refusal ??= { verb, code: 'PICK_SEED' }; continue; }
        if ((verb === 'plant') && !tool.crop) { refusal ??= { verb, code: 'NO_SEED' }; continue; }
        if (CLIENT_VERBS.has(verb)) {
          // the Fishing Dock (M2): sit down and cast; seated here already: cast again
          if (verb === 'fish') {
            leaveSeat('fish');                                // off the bench first (the dock is its own seat)
            const here = fishing.active && fishing.at?.id === t.id;
            const r = here ? (fishing.again() ? { ok: true } : { ok: false, code: fishing.code() }) : fishing.start(t.id);
            if (r.ok || here) {
              stroke = { verb, item: null, count: 1, visited: new Set([t.id]), path: createStroke({ brush: [1, 1] }), first: t,
                shift: e.shiftKey, sent: true };
              return { started: true };
            }
            refusal ??= { verb, code: r.code };
            continue;
          }
          // a full Nursery card (M2): the couple picks its personality and specialty in the nursery panel
          if (verb === 'nursePick') {
            openPanel(['nursery', 'animals'], { id: t.id, pick: true });
            stroke = { verb, item: null, count: 1, visited: new Set([t.id]), path: createStroke({ brush: [1, 1] }), first: t,
              shift: e.shiftKey, sent: true };
            return { started: true };
          }
          const code = verb === 'ride' ? rideCode(t.id) : ERR.UNKNOWN_ACTION;
          if (verb === 'ride' && code === null) {
            stroke = { verb, item: null, count: 1, visited: new Set([t.id]), path: createStroke({ brush: [1, 1] }), first: t,
              shift: e.shiftKey, sent: true };
            ride(t.id);
            return { started: true };
          }
          // why the horse cannot be ridden says more than the pet's "already petted today"
          if (verb === 'ride' && code !== ERR.UNKNOWN_ACTION) refusal = { verb, code };
          continue;
        }
        const r = resolve(store, verb, t, verbOpts(verb));
        if (r && r.type && r.code === undefined) {
          const item = verb === 'plant' ? tool.crop : t.crop || t.def?.product || null;
          stroke = { verb, item, count: 0, visited: new Set(), path: createStroke({ brush: brush() }), first: t, shift: e.shiftKey, sent: false };
          const tiles = stroke.path.to(p.x, p.z);
          // the press acts on its brush; a press on ONE animal acts on that animal only (its home's tile stands for
          // every animal inside, which is what a drag across the yard should reach, not a click); a bench or a Giant
          // takes exactly one press
          const more = t.kind === 'animal' || ONCE_VERBS.has(verb) ? [] : collect(tiles, verb).filter((x) => x.id !== t.id);
          apply([t, ...more], e.timeStamp);
          return { started: true };
        }
        if (r && r.code !== undefined && r.code !== ERR.UNKNOWN_ACTION) refusal ??= r;
      }
    }
    return { started: false, base, refusal };
  }

  /** Same-verb targets not yet visited on these tiles. */
  function collect(tiles, verb) {
    const out = [];
    const seen = new Set();
    for (const [x, z] of tiles) {
      for (const id of idsOnTile(x, z, verb)) {
        if (stroke.visited.has(id) || seen.has(id)) continue;
        seen.add(id);
        const t = describe(store.state, id, now(), me());
        if (t && verbsFor(tool.id, t, { shift: stroke.shift, spread: tool.spread }).includes(verb)) out.push(t);
      }
    }
    return out;
  }

  /**
   * Sit on a bench: the farmer walks over first and sits on arrival (GDD §6.2 #9 is a ritual, and the server checks
   * the seat against my avatar's position, RC-31). The seat is re-checked on arrival: the partner may have taken
   * the last one meanwhile. Another click on the way cancels the sit (avatar.walkTo replaces onArrive).
   */
  function sitDown(t) {
    dismount();                                             // nobody sits on a bench on horseback
    const rot = t.obj ? t.obj.rot ?? 0 : 0;
    const [w, d] = t.def && t.def.size ? footprint(t.def, rot) : [1, 1];
    pendingSit = t.id;
    avatar.walkTo(t.x, t.z, w, d, () => {
      if (pendingSit !== t.id) return;
      pendingSit = null;
      if (!store.ready) return;
      const now0 = describe(store.state, t.id, now(), me());
      if (!now0 || now0.mySeat) return;
      const r = resolve(store, 'sit', now0, {});
      if (r && r.type && r.code === undefined) perform(r, null, performance.now());   // latency from the arrival, not the click
      else if (r && r.code !== undefined) invalid(t.id, r.code, { type: r.type, args: r.args });
    });
  }

  /** Act on stroke targets: one batched action when the rules offer it, else one per target (silent skips). */
  function apply(targets, t0) {
    if (!stroke || !targets.length) return;
    const verb = stroke.verb;
    if (verb === 'sit') {                                   // walk over, then sit (never part of a drag)
      for (const t of targets) stroke.visited.add(t.id);
      sitDown(targets[0]);
      stroke.count += 1;
      return;
    }
    if (verb === 'fell') {                                  // one chop per press, on the Giant's anchor plot
      const t = targets[0];
      for (const id of giantPlots(t.giant)) stroke.visited.add(id);
      leaveSeat(verb);
      const r = resolve(store, 'fell', t, {});
      if (!r || !r.type || r.code !== undefined) return;
      const res = perform(r, t, t0);
      if (res.ok) { stroke.count += 1; emit('stroke', { verb, count: stroke.count, item: stroke.item, active: true }); }
      return;
    }
    const opts = verbOpts(verb);
    const todo = targets.filter((t) => !stroke.visited.has(t.id));
    for (const t of todo) stroke.visited.add(t.id);
    leaveSeat(verb);
    // The press goes out at once; the rest of the stroke is predicted at once too but HELD and sent merged every
    // STROKE_SEND_MS (the store merges a stroke's frames into one `ids` action: performance-16)
    // One action per frame for everything the stroke newly crossed (the rules apply it to every target that passes)
    const batch = todo.length > 1 ? resolveBatch(store, verb, todo, opts) : null;
    if (batch) {
      const res = perform(batch, todo.at(-1), t0, stroke.sent);
      if (res.ok) { stroke.count += countDone(verb, res.tx.events); emit('stroke', { verb, count: stroke.count, item: stroke.item, active: true }); }
      afterStrokeAct(res);
      return;
    }
    for (const t of todo) {
      const r = resolve(store, verb, t, opts);
      if (!r || !r.type || r.code !== undefined) continue;        // not this one (already done, raced): skip quietly
      const res = perform(r, t, t0, stroke.sent);
      afterStrokeAct(res);
      if (!res.ok) continue;
      stroke.count += Math.max(1, countDone(verb, res.tx.events));
      emit('stroke', { verb, count: stroke.count, item: stroke.item, active: true });
    }
  }

  /** After a stroke's act: the first one went out; held ones are released within STROKE_SEND_MS. */
  function afterStrokeAct(res) {
    if (!res || !res.ok || !stroke) return;
    if (!stroke.sent) { stroke.sent = true; return; }
    if (!releaseTimer) releaseTimer = setTimeout(releaseStroke, STROKE_SEND_MS);
  }
  function releaseStroke() {
    clearTimeout(releaseTimer);
    releaseTimer = null;
    if (typeof store.release === 'function') store.release();
  }

  function extendStroke(p, e) {
    if (!stroke || !p || ONCE_VERBS.has(stroke.verb)) return;
    let targets = [];
    const tiles = stroke.path.to(p.x, p.z);
    targets = collect(tiles, stroke.verb);
    // an animal under the cursor itself (render-life animal pickables) joins animal strokes
    if (p.kind === 'object' && ANIMAL_VERBS.has(stroke.verb) && !stroke.visited.has(p.id)) {
      const t = describe(store.state, p.id, now(), me());
      if (t && t.kind === 'animal' && verbsFor(tool.id, t, { shift: stroke.shift, spread: tool.spread }).includes(stroke.verb)) targets.push(t);
    }
    apply(targets, e.timeStamp);
  }

  /** The plot ids of the Giant whose anchor is `anchor` (every plot whose crop names it). */
  function giantPlots(anchor) {
    const out = [];
    if (!anchor || !store.state) return out;
    for (const [id, o] of Object.entries(store.state.farm.objects)) if (o.crop && o.crop.giant === anchor) out.push(id);
    return out;
  }

  // ---- riding (GDD §3.4 Horse: "the avatar can ride a horse as a pure cosmetic, walk speed x1.8") ---------------------
  /** How many farmers ride now (me and the partner, from the partner's presence tool). */
  function riders() {
    const pid = partnerPid();
    return (riding ? 1 : 0) + (pid && peerTool(pid) === RIDE_TOOL ? 1 : 0);
  }
  /** null when I may ride horse `id` (or any adult horse when omitted), else the reason (an ERR-like code). */
  function rideCode(id = null) {
    if (!store.ready) return ERR.NOT_JOINED;
    const now0 = now();
    if (id) {
      const t = describe(store.state, id, now0, me());
      if (!t || t.kind !== 'animal' || !RIDEABLE.has(t.def.id)) return ERR.NOT_FOUND;
      if (t.baby) return ERR.NOT_READY;
    }
    const free = adultHorses(store.state, now0) - (riders() - (riding ? 1 : 0));
    return free >= 1 ? null : adultHorses(store.state, now0) ? ERR.OCCUPIED : ERR.LOCKED;
  }
  /** The adult horse to mount: the given one, else the first by id; its Stable is where the farmer walks. */
  function horseFor(id) {
    if (id) return id;
    const t = now();
    return Object.keys(store.state.farm.objects).sort().find((k) => {
      const o = store.state.farm.objects[k];
      return typeof o.home === 'string' && RIDEABLE.has(o.def) && !(Number.isFinite(o.adultAt) && o.adultAt > t);
    }) ?? null;
  }
  function setRiding(horse) {
    riding = horse;
    avatar.setRiding?.(Boolean(horse));
    if (!horse) audio?.loop?.('hooves', false);
    else audio?.play('neigh', { gain: 0.5 });
    emit('ride', { riding: Boolean(horse), horse });
  }
  /** Mount (walk to the Stable first, then up), or get off when already riding. */
  function ride(id = null) {
    if (riding) { dismount(); return true; }
    const code = rideCode(id);
    if (code) {
      const text = code === ERR.NOT_READY ? 'Too young to ride yet: a foal grows up first.'
        : code === ERR.OCCUPIED ? 'Every horse has a rider right now.'
          : code === ERR.LOCKED ? 'You need an adult horse to ride: the Stable opens at level 25.' : null;
      if (text) toast(text, {});
      return false;
    }
    const horse = horseFor(id);
    const home = describe(store.state, store.state.farm.objects[horse]?.home, now(), me());
    leaveSeat('ride');
    if (!home || !Number.isFinite(home.x)) { setRiding(horse); return true; }
    const [w, d] = objSize(home.obj, home.def);
    pendingRide = horse;
    avatar.walkTo(home.x, home.z, w, d, () => {
      if (pendingRide !== horse) return;
      pendingRide = null;
      if (rideCode(horse) === null) setRiding(horse);
    });
    return true;
  }
  function dismount() {
    pendingRide = null;
    if (!riding) return false;
    setRiding(null);
    return true;
  }

  /** Working anywhere else stands me up from a Golden Hour bench (the avatar walks off to work). */
  function leaveSeat(verb) {
    if (verb !== 'fish') leaveDock(verb);
    if (verb === 'sit' || verb === 'stand') return;
    const bench = store.state?.farm.coop?.bench;
    if (!bench || !bench[me()]) return;
    const r = resolve(store, 'stand', null, {});
    if (r && r.type && r.code === undefined) store.act(r.type, r.args);
  }

  function endStroke() {
    if (!stroke) return;
    const s = stroke;
    stroke = null;
    releaseStroke();                                      // the rest of the stroke goes out now
    emit('stroke', { verb: s.verb, count: s.count, item: s.item, active: false });
  }

  /**
   * The Hand on a pet (M1b, GDD §3.4 Pets; render-life's pick names its owner: `kind: 'pet'` or `pet: ownerPid`): pet
   * it once today, else give it today's treat (a treat under Keep N asks first), else say why nothing happens.
   */
  function petClick(p) {
    const owner = p.owner ?? p.pet;
    if (tool.id !== 'hand' || typeof owner !== 'string' || !store.ready) return null;
    // night (wave 4, wish 4): render-world's pick says the pet sleeps in its doghouse or basket; a pat or a treat still
    // counts (the day's cuddle is never lost to the clock), with a sleepy snore and a 💤 line instead of a woof
    const asleep = p.asleep === true;
    const petName = store.state.players[owner]?.pet?.name ?? 'The pet';
    let refusal = null;
    for (const [type, args] of [['petPet', { owner }], ['feedPet', { owner }]]) {
      if (!ACTIONS[type]) continue;
      const code = canRun(store, type, args);
      if (code === null) {
        const res = perform({ verb: type, type, args }, null, performance.now());
        if (res.ok && Number.isFinite(p.px)) avatar.walkTo(Math.floor(p.px), Math.floor(p.pz), 1, 1);
        if (res.ok && asleep) {
          audio?.play('snore', { gain: 0.6 });
          toast(`${petName} stirs, enjoys a sleepy ${type === 'feedPet' ? 'treat' : 'pat'} and dozes off again 💤`, {});
        }
        return res;
      }
      if (code !== ERR.ALREADY_DONE) refusal ??= { type, args, code };
    }
    if (refusal && SOFT.has(refusal.code)) { toast(refusal.code, { type: refusal.type, args: refusal.args }); return null; }
    if (refusal && [ERR.LOCKED, ERR.NOT_FOUND, ERR.UNKNOWN_ACTION].includes(refusal.code)) {
      invalid(null, null);
      return null;
    }
    const name = petName;
    if (asleep && !(refusal && (SOFT.has(refusal.code) || [ERR.LOCKED, ERR.NOT_FOUND, ERR.UNKNOWN_ACTION].includes(refusal.code)))) {
      audio?.play('snore', { gain: 0.7 });
      toast(`${name} is fast asleep 💤 Let them dream till morning.`, {});
      return null;
    }
    const treat = refusal && refusal.code === ERR.NO_ITEMS;
    toast(treat ? `${name} would love a treat: Dog Biscuits and Cat Treats come from the Kitchen.`
      : refusal && refusal.code === ERR.NOT_READY ? `${name} is busy with this morning's find. Treats again tomorrow.`
        : `${name} had a cuddle and a treat today. Tomorrow again!`, {});
    invalid(null, null);
    return null;
  }

  /** A click that started no stroke: open a panel, sit, or explain why nothing happened. */
  function click(p, e, info) {
    if (!p) return null;
    if (p.kind === 'pet' || typeof p.pet === 'string') return petClick(p);
    // a note pinned to this tile (the view's paper slip, RD-30): the Hand opens it in the Notes panel
    if (p.note && tool.id === 'hand' && p.kind === 'tile') { openPanel('notes', { id: p.note }); return null; }
    if (p.kind === 'tile') {
      // the Willow Pond's fishing spot (M2): render-world's place 'fishing', or a tile next to an owned pond's spot
      const pond = tool.id === 'hand' ? pondAt(p) : null;
      if (pond) {
        leaveSeat('fish');
        const r = fishing.start({ pond, seats: p.place === 'fishing' ? p.placeArgs?.seats : undefined });
        if (!r.ok) invalid(null, r.code === ERR.COOLDOWN ? null : r.code);
        return null;
      }
      // a live world place across the farm (render-world pick: the Fair tent, the barge jetty, the village, a
      // restoration site): its panel (ui-weekly `fair` / `barge` / `town` / `townsfolk`, ui-collect `restoration`)
      if (p.place && (tool.id === 'hand' || tool.id === 'hammer')) { openPanel(PLACE_PANELS[p.place] ?? p.place, p.placeArgs || {}); return null; }
      // locked land for sale (render-world pick: land 'sale' + expansion id): the expansion card (GDD §2.2 signposts)
      if (p.land === 'sale' && p.expansion && (tool.id === 'hand' || tool.id === 'hammer')) { openPanel('expansion', { id: p.expansion }); return null; }
      // a wild tuft with yellow flowers on owned land (wave 4, wish F): the Hand pulls it up
      if (tool.id === 'hand' && isWeed(p) && weedClick(p)) return null;
      // open ground: the Hand walks my farmer there (live requests 2026-10-04: "more free moving")
      if (tool.id === 'hand' && Number.isFinite(p.px) && Number.isFinite(p.pz)) walkTo(p.px, p.pz);
      return null;
    }
    const t = info?.base ?? describe(store.state, p.id, now(), me());
    if (!t) return null;
    if (info?.refusal && info.refusal.code === 'PICK_SEED') {
      emit('command', { cmd: 'seedPicker', id: t.id, x: t.x, z: t.z, crop: tool.crop });
      return null;
    }
    if (info?.refusal && info.refusal.code === 'NO_SEED') {
      emit('command', { cmd: 'seedTray' });
      toast(input === 'touch' ? 'Pick a seed first, then tap the plot.' : 'Pick a seed first (2), then click the plot.', {});
      return null;
    }
    // The Smart Hand's watering is a bonus: a crop that cannot take it (too quick, already watered) just shows its
    // tooltip (time left), never a refusal. Explicit tools (the Watering Can) do explain why.
    if (tool.id === 'hand' && (t.kind === 'plot' || t.kind === 'tree') && t.growing && (!info?.refusal || info.refusal.verb === 'water')) {
      // card: the ui pins a mouse player's card of a growing crop where it was clicked, with its "Finish now" buttons
      emit('hover', { ...p, card: true });
      return null;
    }
    if (info?.refusal) {
      const r = info.refusal;
      if (r.verb === 'ride') { invalid(t.id, null); ride(t.id); return null; }    // ride() toasts the reason
      if (SOFT.has(r.code)) { toast(r.code, { type: r.type, args: r.args }); return null; }
      // hungry hens and no feed: the Hand opens the pen's panel, which says what is missing and where it is made
      const panel = OPENS[t.def.id] ?? OPENS[t.kind];
      if (tool.id === 'hand' && r.code === ERR.NO_ITEMS && panel && t.kind !== 'plot') {
        invalid(t.kind === 'animal' ? t.home : t.id, null);
        openPanel(panel, { id: t.kind === 'animal' ? t.home : t.id });
        return null;
      }
      invalid(t.kind === 'animal' ? t.home : t.id, r.code, { type: r.type, args: r.args });
      return null;
    }
    // the farmhouse once its room is open (M2, Restoration 6): the Hand goes in
    if (tool.id === 'hand' && t.def.id === 'farmhouse' && interiorOpenNow(store.state)) {
      interior.enter();
      return null;
    }
    // the restored Greenhouse's frame (a landmark; its plots inside act like any plot): its Restoration page
    if (tool.id === 'hand' && t.def.greenhouse) {
      const project = [...(CONTENT.restoration?.values() ?? [])].find((x) => x.reward && x.reward.greenhouse);
      openPanel('restoration', { id: project ? project.id : null });
      return null;
    }
    if (tool.id === 'hand' || tool.id === 'basket' || tool.id === 'feed_scoop') {
      const panel = OPENS[t.def.id] ?? OPENS[t.kind];
      if (panel && !(t.kind === 'plot')) {
        openPanel(panel, { id: t.kind === 'animal' ? t.home : t.id });
        swingDoors(t, panel);
        return null;
      }
    }
    if (t.kind === 'plot' && t.giant && t.ready && !['axe', 'hand', 'sickle'].includes(tool.id)) {
      const name = cropOf(t.crop)?.name ?? 'crop';
      toast(`A Giant ${name}! Fell it with the Axe (8), the Sickle or the Hand: quicker together.`, {});
      invalid(t.id, null);
      return null;
    }
    if (t.kind === 'debris' && t.tool !== 'hand' && tool.id === 'hand') {
      toast(`${t.def.name}: use the Axe (8).`, {});
      invalid(t.id, null);
      return null;
    }
    invalid(t.id, null);
    return null;
  }

  /**
   * The seed picker's choice: plant plot `id` with `crop` now (predicted, with the click's feedback) and keep that seed
   * in the Seed Bag, so the next clicks and drags plant more of it.
   */
  function plantWith(crop, id) {
    if (!store.ready || !cropOf(crop)) return null;
    const t = describe(store.state, id, now(), me());
    setTool('seed_bag', { crop });
    if (!t || t.kind !== 'plot') { invalid(null, ERR.NOT_FOUND); return null; }
    const r = resolve(store, 'plant', t, { crop });
    if (!r || !r.type || r.code !== undefined) {
      if (r && SOFT.has(r.code)) toast(r.code, { type: r.type, args: r.args });
      else invalid(id, r?.code ?? null, r ? { type: r.type, args: r.args } : {});
      return null;
    }
    leaveSeat('plant');
    return perform(r, t, performance.now());
  }

  /**
   * The Hand on a wild tuft (wave 4, wish F): the rules' weeds action for that tile (targets.js VERBS.weed: whatever name
   * and shape this build registers), predicted, the farmer walking over. False when this build has no such action (the
   * click then walks as on any open ground); a refusal says why.
   */
  /** Does tile pick `p` hold a clearable wild tuft? render-world says so on the pick (`weed`) or through view.weedAt. */
  function isWeed(p) {
    if (!p || p.kind !== 'tile') return false;
    if (p.weed) return true;
    if (typeof view.weedAt !== 'function' || !Number.isInteger(p.x)) return false;
    try { return Boolean(view.weedAt(p.x, p.z)); } catch { return false; }
  }
  function weedClick(p) {
    if (!store.ready) return false;
    const w = typeof p.weed === 'object' && p.weed ? p.weed : {};
    const t = { kind: 'weed', id: null, x: Number.isInteger(w.x) ? w.x : p.x, z: Number.isInteger(w.z) ? w.z : p.z,
      k: typeof w.k === 'string' ? w.k : typeof w.id === 'string' ? w.id : null };
    const r = resolve(store, 'weed', t, {});
    if (!r || (!r.type && (r.code === ERR.UNKNOWN_ACTION || r.code === undefined))) return false;
    // weeded a moment ago (the partner, or a tuft the ground still shows), or not the farm's land: just walk there
    if (r.code === ERR.ALREADY_DONE || r.code === ERR.OUT_OF_BOUNDS) return false;
    if (r.code !== undefined) {
      if (SOFT.has(r.code)) toast(r.code, { type: r.type, args: r.args });
      else invalid(null, r.code, { type: r.type, args: r.args });
      return true;
    }
    leaveSeat('weed');
    perform(r, { x: t.x, z: t.z }, performance.now());
    return true;
  }

  // ---- the Barn's doors (wave 4, wish 8): open while its panel is up -------------------------------------------------
  const DOOR_DEFS = new Set(['barn']);
  let doorsOpen = null;          // the object id whose doors stand open
  let doorsPanel = null;         // the panel(s) the click opened: the doors stay open while one of them shows
  let doorsTimer = null;
  let doorsWired = false;
  const doorsApi = () => (view.objects && typeof view.objects.doors === 'function' ? view.objects.doors : null);
  const panelShows = () => {
    const names = Array.isArray(doorsPanel) ? doorsPanel : doorsPanel ? [doorsPanel] : [];
    try { return names.some((n) => ui?.panels?.isOpen?.(n)); } catch { return false; }
  };
  /** Swing the doors of the Barn `t` open after a click opened `panel` (render-world draws them; no view doors: nothing). */
  function swingDoors(t, panel = null) {
    const fn = doorsApi();
    if (!fn || !t || !t.def || !(DOOR_DEFS.has(t.def.id) || t.def.doors === true)) return;
    if (doorsOpen && doorsOpen !== t.id) shutDoors();
    if (!doorsWired && ui?.panels?.on) {
      doorsWired = true;
      // its panel closing shuts them (a moment later: another panel replacing it may be the same Barn's)
      ui.panels.on('close', () => {
        if (!doorsOpen) return;
        clearTimeout(doorsTimer);
        doorsTimer = setTimeout(() => { if (!panelShows()) shutDoors(); }, 400);
      });
    }
    doorsPanel = panel;
    clearTimeout(doorsTimer);
    // the panel did not open (no panel system, or the ui has none by that name): they close again by themselves; while
    // it shows they stay open (closing it shuts them; a look every 5 s is the backstop for a missed close)
    // (render-world's doors close by themselves after a few seconds: each look while the panel shows holds them open)
    const watch = () => {
      if (!panelShows()) { shutDoors(); return; }
      try { fn.call(view.objects, t.id, true); } catch { /* the view went away */ }
      doorsTimer = setTimeout(watch, 5000);
    };
    doorsTimer = setTimeout(watch, panelShows() ? 5000 : 3500);
    if (doorsOpen === t.id) return;
    doorsOpen = t.id;
    try { fn.call(view.objects, t.id, true); } catch (err) { console.warn('view.objects.doors failed', err); }
    audio?.play('barn_door', { gain: 0.75, pan: panOf(t) });
    poke();
  }
  function shutDoors() {
    clearTimeout(doorsTimer);
    doorsTimer = null;
    const id = doorsOpen;
    doorsOpen = null;
    doorsPanel = null;
    const fn = doorsApi();
    if (!id || !fn) return;
    try { fn.call(view.objects, id, false); } catch (err) { console.warn('view.objects.doors failed', err); }
    const o = store.state && Object.hasOwn(store.state.farm.objects, id) ? describe(store.state, id, now(), me()) : null;
    audio?.play('barn_door', { gain: 0.5, rate: 0.92, pan: o ? panOf(o) : 0 });
    poke();
  }
  /** Stereo pan for a thing on the farm from where it shows on screen (GDD §8.5). */
  function panOf(t) {
    if (!t || !Number.isFinite(t.x) || typeof view.toScreen !== 'function') return 0;
    const [w, d] = t.def && t.def.size ? (t.obj ? objSize(t.obj, t.def) : footprint(t.def, 0)) : [1, 1];
    const sp = view.toScreen(t.x + w / 2, t.z + d / 2, 0);
    const r = canvasRect();
    return sp && Number.isFinite(sp.x) && r.width > 0 ? Math.max(-0.8, Math.min(0.8, ((sp.x - r.left) / r.width) * 2 - 1)) : 0;
  }

  /** My farmer walks to (x, z) round everything solid; a bench seat is left first (the farmer stands up and goes). */
  function walkTo(x, z) {
    if (typeof avatar.goTo !== 'function' || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    pendingSit = null;
    pendingRide = null;
    if (store.ready) leaveSeat('walk');
    const at = avatar.goTo(x, z);
    if (at) emit('walk', at);
    poke();
    return at;
  }

  /** Open a ui panel when the ui has it (a list: the first it has); otherwise announce it (the ui may say "coming soon"). */
  function openPanel(names, args) {
    const list = Array.isArray(names) ? names : [names];
    const has = (n) => Boolean(ui && ui.panels && typeof ui.panels.has === 'function' && ui.panels.has(n));
    const name = list.find(has);
    if (name) ui.panels.open(name, args);
    else emit('command', { cmd: 'panel', name: list.at(-1), args });
  }

  /** The owned pond whose fishing spot a tile pick means (the place render-world names, or within 1.5 tiles of it). */
  function pondAt(p) {
    if (!p || p.kind !== 'tile' || !store.ready) return null;
    if (p.place === 'fishing') return p.placeArgs?.pond ?? pondSpots(store.state)[0]?.pond ?? null;
    if (p.place) return null;
    const x = p.px ?? p.x + 0.5;
    const z = p.pz ?? p.z + 0.5;
    const s = pondSpots(store.state).find((q) => Math.hypot(q.x + 0.5 - x, q.z + 0.5 - z) <= 1.5);
    return s ? s.pond : null;
  }

  /**
   * A press while a special mode owns the input (M2): a line in the water takes any click, tap or Space as the hook;
   * the matchmaker takes a click on an animal or a home. True when the press was used.
   */
  function modePress(p) {
    if (fishing.casting) { fishing.press(); return true; }
    if (pairing.active) {
      if (p && p.kind === 'object') pairing.pick(p.id);
      else if (p && (p.kind === 'pet')) toast('Pets keep their own company: pick a farm animal.', {});
      return true;
    }
    return false;
  }

  /** M0 contract: what a click on `p` does with the current tool. */
  function actOn(p, { shift: sh = false } = {}) {
    if (!p || !store.ready) return null;
    if (tool.id !== 'hammer' && modePress(p)) return { ok: true, mode: true };
    const e = { shiftKey: sh, timeStamp: performance.now() };
    if (tool.id === 'hammer') return buildClick(p);
    const r = beginStroke(p, e);
    if (r.started) { endStroke(); return { ok: true }; }
    return click(p, e, r);
  }

  // ---- build mode (hammer) ----------------------------------------------------------------------------------
  function startBuild(defId, { rot = 0, moveId = null, quiet = false } = {}) {
    const def = defOf(defId);
    if (!def || def.layer === 'none') return false;
    if (!moveId && store.state && levelFromXp(store.state.farm.xp) < (def.unlock ?? 1)) {
      if (!quiet) toast(ERR.LOCKED, { type: 'place', args: { def: defId } });
      return false;
    }
    if (tool.build?.moveId && tool.build.moveId !== moveId) view.objects.hidden(tool.build.moveId, false);
    // storable: only decor goes back into the tray, and never a Masterwork piece (the touch bar's "Put it away")
    const held = moveId && Object.hasOwn(store.state?.farm.objects ?? {}, moveId) ? store.state.farm.objects[moveId] : null;
    tool.build = { def: defId, rot, moveId, storable: Boolean(held) && def.kind === 'decor' && held.mw === undefined };
    touchGhostStart(moveId);
    view.ghost.show(defId, rot);
    ghostShown = true;
    view.grid(true);
    if (moveId) view.objects.hidden(moveId, true);
    updateGhost();
    return true;
  }

  function endBuild() {
    if (!tool.build) return;
    setPlan = null;
    if (tool.build.moveId) view.objects.hidden(tool.build.moveId, false);
    tool.build = null;
    view.ghost.hide();
    ghostShown = false;
    view.grid(false);
    sendGhost(null);
    // on a phone the hover WAS the ghost's spot: with the ghost gone nothing is under a finger
    if (input === 'touch') { hover = null; avatar.setCursor(null); }
    emit('build', null);
  }

  /** Min-corner tile of the ghost so the footprint is centred on the hovered tile. */
  function ghostTile(h) {
    const b = tool.build;
    const [w, d] = sizeAt(store.state, b.def, b.rot, b.moveId);
    return { x: h.x - Math.floor((w - 1) / 2), z: h.z - Math.floor((d - 1) / 2) };
  }

  function buildCheck(x, z) {
    const b = tool.build;
    if (b.moveId) {
      const t = describe(store.state, b.moveId, now(), me());
      // its own spot: putting it back where it was is always fine (the click just cancels the move)
      if (t && t.obj.x === x && t.obj.z === z && (t.obj.rot ?? 0) === b.rot) return { r: null, code: null, same: true };
      const r = t ? resolve(store, 'move', t, { x, z, rot: b.rot }) : null;
      if (r && r.type && r.code === undefined) return { r, code: null };
      const code = r?.code === ERR.UNKNOWN_ACTION || !r ? canPlace(store.state, b.def, x, z, b.rot, b.moveId) : r.code;
      return { r, code: code ?? null };
    }
    const r = resolve(store, 'place', null, { def: b.def, x, z, rot: b.rot });
    if (r && r.type && r.code === undefined) return { r, code: null };
    const code = r && r.code !== ERR.UNKNOWN_ACTION ? r.code : canPlace(store.state, b.def, x, z, b.rot);
    return { r, code };
  }

  /** The tile that blocks a placement (for "Blocked by Mia's Coop"). */
  function blockerOf(x, z) {
    const b = tool.build;
    const [w, d] = sizeAt(store.state, b.def, b.rot, b.moveId);
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const id = tileOwner(store.state, x + dx, z + dz);
        if (id && id !== b.moveId) return id;
      }
    }
    return null;
  }

  /**
   * What the Hammer picks up for object `id`: the object itself, or the Greenhouse frame for one of its plots (they move
   * together; the plots cover the frame's inside, so a click there means the frame). Every structure moves, the
   * Homestead's landmarks included (owner 2026-10-04); debris and animals never do. Null when nothing moves.
   */
  function liftable(id) {
    let t = describe(store.state, id, now(), me());
    if (t && t.kind === 'plot' && typeof t.obj.gh === 'string' && Object.hasOwn(store.state.farm.objects, t.obj.gh)) {
      t = describe(store.state, t.obj.gh, now(), me());
    }
    return t && t.kind !== 'animal' && t.kind !== 'debris' && t.def.movable !== false ? t : null;
  }

  /**
   * The default hammer (plot ghost) over a movable object offers to pick it up instead of a red ghost. A tile hover
   * asks the tile index too: the hover can be older than the farm under it (the Barn just put down where the cursor
   * rests, or the partner's move), and a red "blocked" plot ghost over the Barn would be wrong.
   */
  function pickUpTarget(h) {
    const b = tool.build;
    if (!b || b.moveId || b.def !== 'plot') return null;
    return underHammer(h);
  }

  /** The movable object under hover `h` (an object pick, or the tile index's owner of a tile pick), or null. */
  function underHammer(h = hover) {
    if (!h || !store.state) return null;
    const id = h.kind === 'object' ? h.id : h.kind === 'tile' && Number.isInteger(h.x) ? tileOwner(store.state, h.x, h.z) : null;
    return id ? liftable(id) : null;
  }

  function updateGhost() {
    if (!tool.build || !hover || !store.ready) return;
    const lift = pickUpTarget(hover);
    if (lift) {
      if (ghostShown) { view.ghost.hide(); ghostShown = false; sendGhost(null); }
      emit('build', { ...tool.build, x: hover.x, z: hover.z, valid: true, code: null, blocker: null, pickUp: lift.id,
        moveBack: canMoveBack(lift.id) ? lift.id : null, masterwork: canMasterwork(lift.id) ? lift.id : null,
        // wave 4 (wish C): it can turn where it stands (the hint's ↻ calls controller.rotate(id); R does it too)
        rotate: lift.kind === 'plot' ? null : lift.id });
      return;
    }
    if (!ghostShown) { view.ghost.show(tool.build.def, tool.build.rot); ghostShown = true; }
    const { x, z } = ghostTile(hover);
    const { code } = buildCheck(x, z);
    const blocker = code === ERR.BLOCKED ? blockerOf(x, z) : null;
    // a soft code (BIG_SPEND) is a valid spot: the click asks "are you sure?", the ghost stays green
    const valid = !code || SOFT.has(code);
    view.ghost.update({ x, z }, valid, code, blocker ?? undefined);
    sendGhost({ def: tool.build.def, x, z, rot: tool.build.rot });
    emit('build', { ...tool.build, x, z, valid, code: code ?? null, blocker, ...(setPlan ? { set: setInfo(x, z) } : {}) });
  }

  /**
   * The set hint for the ghost at (x, z). `ids`: the copies this spot would join (or the nearest of each piece): the
   * world's set glow (render-world) can light exactly those instead of every fence in range.
   */
  function setInfo(x, z) {
    const set = CONTENT.decorSets.get(setPlan.id);
    const [w, d] = footprint(defOf(tool.build.def), tool.build.rot);
    const { out, near, ids } = setSpot(store.state, set, x, z, w, d, tool.build.def);
    return { id: set.id, name: set.name, placed: out, of: set.pieces.length, near, ids };
  }

  function buildClick(p) {
    if (!p || !store.ready) return null;
    if (p.kind === 'tile' && p.land === 'sale' && p.expansion) { openPanel('expansion', { id: p.expansion }); return null; }
    if (p.kind === 'tile' && p.place && (!tool.build || tool.build.def === 'plot')) {
      openPanel(PLACE_PANELS[p.place] ?? p.place, p.placeArgs || {});
      return null;
    }
    if (!tool.build) return p.kind === 'object' && move(p.id) ? { ok: true } : null;
    const lift = pickUpTarget(p);
    if (lift) return move(lift.id) ? { ok: true } : null;                 // the default hammer picks things up
    const { x, z } = ghostTile(p);
    const { r, code, same } = buildCheck(x, z);
    if (same) { endBuild(); startBuild('plot', { quiet: true }); return null; }
    if (code) {
      if (SOFT.has(code) && r) { toast(code, { type: r.type, args: r.args }); return null; }
      invalid(code === ERR.BLOCKED ? blockerOf(x, z) : null, code, r ? { type: r.type, args: r.args } : {});
      return null;
    }
    const res = perform(r, { x, z, def: defOf(tool.build.def), obj: { rot: tool.build.rot } }, performance.now());
    if (res.ok) afterPlaced(r.type, r.args);
    return res;
  }

  /** After a placement or move (also one confirmed through the ui's BIG_SPEND card): plots, fences, paths and
   * decor stay in build mode for the next one; anything else returns to the Hand; a move keeps the hammer. A decor
   * set being placed moves on to its next piece, and to the Hand after the last. */
  function afterPlaced(type, args) {
    const b = tool.build;
    if (!b) return;
    if (type === 'move' && b.moveId === args.id) { endBuild(); startBuild('plot', { quiet: true }); return; }
    if (type !== 'place' || b.moveId || b.def !== args.def) return;
    if (setPlan) {
      const next = nextSetPiece(setPlan.id);
      if (next && next !== b.def) { startBuild(next, { rot: b.rot }); return; }
      if (!next) {
        const name = CONTENT.decorSets?.get(setPlan.id)?.name ?? 'set';
        setPlan = null;
        endBuild();
        setTool('hand');
        toast(`The ${name} set is out on the farm. Keep the pieces close together and it shines.`, { kind: 'ok' });
        return;
      }
    }
    if (!REPEAT_PLACE.has(defOf(b.def)?.kind)) { endBuild(); setTool('hand'); return; }
    // on a phone the ghost moves on to the next free spot beside the one just placed: ✓ again lays the next plot,
    // fence or path (with a mouse the ghost follows the cursor anyway)
    if (input === 'touch' && hover) {
      const [w, d] = footprint(defOf(b.def), b.rot);
      const next = freeSpotNear(hover, Math.max(1, Math.min(w, d)), Math.max(w, d) + 3);
      if (next) hover = next;
    }
    updateGhost();
  }

  /** The first piece of a decor set that is not on the farm and that this level can place, or null. */
  function nextSetPiece(setId) {
    const set = CONTENT.decorSets?.get(setId);
    if (!set || !store.state) return null;
    const level = levelFromXp(store.state.farm.xp);
    const out = new Set(Object.values(store.state.farm.objects).map((o) => o.def));
    const ok = (p) => !out.has(p) && defOf(p) && isLive(defOf(p)) && (defOf(p).unlock ?? 1) <= level;
    return set.pieces.find(ok) ?? null;
  }

  /** Place a decor set piece by piece (GDD §3.8 decor sets, M1b). */
  function placeSet(setId) {
    const set = CONTENT.decorSets?.get(setId);
    if (!set || !isLive(set)) return false;
    if (store.state && levelFromXp(store.state.farm.xp) < (set.unlock ?? 1)) {
      toast(ERR.LOCKED, { type: 'place', args: { set: setId } });
      return false;
    }
    const next = nextSetPiece(setId);
    if (!next) { toast(`Every piece of the ${set.name} set is already on the farm.`, {}); return false; }
    setPlan = { id: setId };
    tool.id = 'hammer';
    canvas.style.cursor = cursorFor('hammer');
    const ok = startBuild(next, { rot: 0 });
    if (!ok) setPlan = null;
    emit('tool', publicTool());
    return ok;
  }

  /** The object the Hammer hint shows now (ui/toolbar.js), for Ctrl+Z; null when no hint is up. */
  let hintId = null;
  function setHint(id) { hintId = typeof id === 'string' ? id : null; }

  /** Pick up a placed object to move it (a Greenhouse plot lifts its frame). */
  function move(id) {
    const d = describe(store.state, id, now(), me());
    if (!d || d.kind === 'animal') return false;
    const t = liftable(id);
    if (!t) {
      invalid(id, null);
      toast(d.kind === 'debris' ? `${d.def.name} is cleared, not moved.` : `${d.def.name} stays where it is.`, {});
      return false;
    }
    if (tool.id !== 'hammer') { tool.id = 'hammer'; canvas.style.cursor = cursorFor('hammer'); emit('tool', publicTool()); }
    return startBuild(t.obj.def, { rot: t.obj.rot ?? 0, moveId: t.id });
  }

  function rotateGhost() {
    if (!tool.build) return;
    tool.build.rot = (tool.build.rot + 1) % 4;
    view.ghost.show(tool.build.def, tool.build.rot);
    updateGhost();
    audio?.play('click', { bus: 'ui', rate: 0.8, gain: 0.7 });
  }

  /**
   * Where placed object `id` goes for a quarter turn where it stands (wave 4, wish C): the rules' own rotateSpot for the
   * next quarter (the footprint's centre kept, else the nearest free spot within two tiles: the same answer on both
   * screens); when a quarter fits nowhere, the half and three-quarter turns about the centre (or one tile beside it).
   * Returns { t, r } (r: the resolved `move`) or { t, code, refusal }.
   */
  function rotationFor(id) {
    const t = store.ready && typeof id === 'string' ? liftable(id) : null;
    if (!t || !Number.isFinite(t.obj.x)) return { t: null, code: ERR.NOT_FOUND };
    const def = t.def;
    const rot0 = t.obj.rot ?? 0;
    const [w0, d0] = sizeAt(store.state, def.id, rot0, t.id);
    let refusal = null;
    for (let k = 1; k <= 3; k++) {
      const rot = (rot0 + k) & 3;
      const [w, d] = sizeAt(store.state, def.id, rot, t.id);
      const x0 = t.obj.x + Math.floor((w0 - w) / 2);
      const z0 = t.obj.z + Math.floor((d0 - d) / 2);
      const spots = [];
      if (k === 1 && typeof decorRules.rotateSpot === 'function') {
        const sp = decorRules.rotateSpot(store.state, t.id, 1);
        if (!sp.code) spots.push([sp.x, sp.z]);
        else if (sp.code !== ERR.BLOCKED && sp.code !== ERR.OUT_OF_BOUNDS) return { t, code: sp.code };
      } else spots.push([x0, z0], [x0 - 1, z0], [x0 + 1, z0], [x0, z0 - 1], [x0, z0 + 1]);
      for (const [x, z] of spots) {
        if (x < 0 || z < 0) continue;
        const r = resolve(store, 'move', t, { x, z, rot });
        if (r && r.type && r.code === undefined) return { t, r };
        if (r && r.code !== undefined && r.code !== ERR.UNKNOWN_ACTION) {
          if (SOFT.has(r.code)) return { t, code: r.code, refusal: r };      // pinned by the partner: ask first
          refusal ??= r;
        }
      }
    }
    return { t, code: refusal?.code ?? ERR.BLOCKED, refusal };
  }
  /** Can placed object `id` be turned where it stands now? */
  function canRotate(id) { return Boolean(rotationFor(id).r); }
  /** Turn placed object `id` a quarter where it stands (predicted `move`; Ctrl+Z / Move back undo it). */
  function rotatePlaced(id) {
    if (!store.ready) return null;
    const { t, r, code, refusal } = rotationFor(id);
    if (!r) {
      if (refusal && SOFT.has(code)) { toast(code, { type: refusal.type, args: refusal.args }); return null; }
      if (t && (code === ERR.BLOCKED || code === ERR.OUT_OF_BOUNDS)) {
        invalid(t.id, null);
        toast(`No room to turn the ${t.def.name} here: move it with the Hammer first.`, {});
        return null;
      }
      invalid(t ? t.id : null, code, refusal && refusal.type ? { type: refusal.type, args: refusal.args } : {});
      return null;
    }
    if (tool.build?.moveId === t.id) { endBuild(); startBuild('plot', { quiet: true }); }
    const res = perform(r, null, performance.now());
    if (res.ok) updateGhost();
    return res;
  }

  // Throttled to GHOST_HZ with a TRAILING edge: the latest ghost always goes out within one interval, so the
  // partner's copy never freezes on a stale tile after a fast sweep (review-m0 M5).
  let lastGhost = '';
  let ghostAt = -Infinity;
  let ghostTimer = null;
  let ghostNext = null;
  function sendGhostNow() {
    ghostTimer = null;
    const k = JSON.stringify(ghostNext);
    if (k === lastGhost) return;
    lastGhost = k;
    ghostAt = performance.now();
    send({ t: MSG.GHOST, g: ghostNext });
  }
  function sendGhost(g) {
    ghostNext = g;
    if (ghostTimer) return;
    const wait = ghostAt + 1000 / LIMITS.GHOST_HZ - performance.now();
    if (wait <= 0) sendGhostNow();
    else ghostTimer = setTimeout(sendGhostNow, wait);
  }

  /** Can coin decor `id` be upgraded to its next Masterwork level now (M1b; the Hammer hint offers the workshop)? */
  function canMasterwork(id) {
    if (!ACTIONS.masterwork || typeof beauty.masterworkPrice !== 'function') return false;
    const o = store.state && Object.hasOwn(store.state.farm.objects, id) ? store.state.farm.objects[id] : null;
    return Boolean(o) && !beauty.masterworkPrice(store.state, o).code;
  }

  // ---- move back and pins (GDD §6.3 "You moved my building") ------------------------------------------------------
  /** Can `id` go back to where it stood before its last move (anyone's move, inside the 10 minutes)? */
  function canMoveBack(id) {
    const o = store.state && Object.hasOwn(store.state.farm.objects, id) ? store.state.farm.objects[id] : null;
    if (!o || !o.prev) return false;
    const r = resolve(store, 'moveBack', describe(store.state, id, now(), me()), {});
    return Boolean(r && r.type && r.code === undefined);
  }

  /**
   * Put an object back where it stood before its last move: mine or the partner's (GDD §6.3 "You moved my
   * building": every move has a 10-minute move back, and the pinner gets a one-click Move back). CL-05.
   */
  function moveBack(id) {
    if (!store.ready) return null;
    const tg = describe(store.state, id, now(), me());
    const r = tg ? resolve(store, 'moveBack', tg, {}) : null;
    if (!r || !r.type || r.code !== undefined) {
      invalid(tg ? id : null, r?.code ?? ERR.NOT_FOUND, r ? { type: r.type, args: r.args } : {});
      return null;
    }
    if (tool.build?.moveId === id) { endBuild(); startBuild('plot', { quiet: true }); }
    return perform(r, tg, performance.now());
  }

  /** Pin or unpin a decor object (on omitted: toggle my pin). Moving / storing pinned decor asks the other player. */
  function pin(id, on) {
    const o = store.state && Object.hasOwn(store.state.farm.objects, id) ? store.state.farm.objects[id] : null;
    if (!o) return null;
    return doAct('pinObject', { id, on: typeof on === 'boolean' ? on : o.pin !== me() });
  }

  // ---- undo (Ctrl+Z): my newest undoable thing inside its 10-minute window ------------------------------------------
  // Purchases carry a receipt (`rcpt`, refunded while pristine); moves leave `prev = { x, z, rot, until, by }`
  // (rules-economy decor.js). The newest of mine wins; the dry run decides whether it is still allowed.
  // With the Hammer over an object someone moved, that one goes back first (CL-05).
  function undo() {
    if (!store.ready) return null;
    // the Hammer over a moved object (whoever moved it): Ctrl+Z puts THAT one back. The object the Hammer hint shows
    // "Move back (Ctrl+Z)" for comes first (it lingers 1.5 s after the pointer leaves, and stays while the pointer
    // crosses other objects); then what the hint would name under the pointer now (pickUpTarget: nothing while a
    // purchase or a move is in hand, so a ghost over a moved Well does not undo the Well)
    if (tool.id === 'hammer') {
      const under = pickUpTarget(hover);
      for (const id of [hintId, under?.id]) if (id && canMoveBack(id)) return moveBack(id);
    }
    const t = now();
    const win = SAFETY?.undoMs ?? 600_000;
    const cands = [];
    for (const [id, o] of Object.entries(store.state.farm.objects)) {
      if (o.prev && o.prev.by === me() && o.prev.until > t) cands.push({ id, at: o.prev.until - (SAFETY?.moveBackMs ?? win), verb: 'moveBack' });
      if (o.rcpt && o.by === me() && Number.isFinite(o.placedAt) && t - o.placedAt < win) cands.push({ id, at: o.placedAt, verb: 'refund' });
    }
    cands.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
    for (const c of cands) {
      const tg = describe(store.state, c.id, t, me());
      const r = tg && resolve(store, c.verb, tg, {});
      if (r && r.type && r.code === undefined) {
        return perform(r, tg, performance.now());
      }
    }
    toast('Nothing to undo right now: purchases and moves can be undone for 10 minutes, while untouched.', {});
    return null;
  }

  function storeHeld() {
    const b = tool.build;
    if (!b || !b.moveId) return null;
    const t = describe(store.state, b.moveId, now(), me());
    const r = t && resolve(store, 'store', t, {});
    if (!r || !r.type || r.code !== undefined) { invalid(b.moveId, r?.code ?? null, r ? { type: r.type, args: r.args } : {}); return null; }
    endBuild();
    const res = perform(r, null, performance.now());
    startBuild('plot', { quiet: true });
    return res;
  }

  // ---- social -------------------------------------------------------------------------------------------------
  function ping(x, z) {
    const at = Number.isFinite(x) ? { x, z } : hover ? { x: hover.px ?? hover.x + 0.5, z: hover.pz ?? hover.z + 0.5 } : null;
    if (!at) return false;
    const t = performance.now();
    if (t - lastPingAt < PING_MS) return false;
    lastPingAt = t;
    const px = Math.round(at.x * 20) / 20;
    const pz = Math.round(at.z * 20) / 20;
    send({ t: MSG.MARK, x: px, z: pz, kind: 'look' });
    viewSocial('ping', me(), px, pz);
    audio?.play('ping_me', { bus: 'sfx' });
    return true;
  }

  function emote(id) {
    if (!EMOTES.includes(id)) return false;
    send({ t: MSG.EMOTE, id });
    viewSocial('emote', me(), EMOTE_VIEW[id] ?? 'wave');
    audio?.play('emote');
    if (id === 'high_five') {
      const r = resolve(store, 'highFive', null, {});
      if (r && r.type && r.code === undefined) perform(r, null, performance.now());
    }
    return true;
  }

  function focusMe() { if (!interior.inside) view.focus(avatar.pose.x, avatar.pose.z); }
  function focusPartner() {
    const pid = partnerPid();
    const pose = pid ? view.partner.pose(pid) : null;
    if (!pose) {
      const name = pid ? store.state.players[pid]?.name : null;
      toast(name ? `${name} is not on the farm right now.` : 'Your partner has not joined yet.', {});
      return false;
    }
    view.focus(pose.x, pose.z);
    return true;
  }

  // the Memory Book (M1b, GDD §5.9 "manual pages from photo mode"): offer to keep this picture as a page
  function offerMemoryPage() {
    if (ACTIONS.memoryPage && canRun(store, 'memoryPage', { k: 'photo' }) === null && typeof ui?.notice === 'function') {
      ui.notice('Keep this photo in the Memory Book?', { action: { label: 'Keep it', fn: () => doAct('memoryPage', { k: 'photo' }) }, ms: 12000 });
    }
  }
  async function photo() {
    try {
      ui?.hideHud?.(true);
      const blob = await view.capture();
      if (!blob) return false;
      // a phone: the picture on screen to press and hold (a download from an http page is blocked or asked about there)
      if (input === 'touch' && typeof ui?.photoPreview === 'function' && ui.photoPreview(blob)) {
        audio?.play('click', { bus: 'ui' });
        emit('photo', { blob });
        offerMemoryPage();
        return true;
      }
      const a = document.createElement('a');
      const d = new Date();
      a.href = URL.createObjectURL(blob);
      a.download = `harvest-hollow-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      audio?.play('click', { bus: 'ui' });
      // P takes the picture at once (no separate photo mode): say where it went (ui-ux-28)
      toast('Photo saved to your downloads', { kind: 'ok', ms: 3500 });
      emit('photo', { blob });
      offerMemoryPage();
      return true;
    } catch (err) {
      console.error('photo failed', err);
      toast('The photo did not work this time.', {});
      return false;
    } finally {
      ui?.hideHud?.(false);
    }
  }

  // ---- hover and highlight -----------------------------------------------------------------------------------
  /** Brush preview under the cursor (render-world styles: brush | valid | invalid | harvest | water | #hex). */
  const HIGHLIGHT = { seed_bag: 'brush', sickle: 'harvest', watering_can: 'water', compost_scoop: '#9B6A3E', feed_scoop: 'brush',
    basket: 'harvest', axe: '#C9D3DA' };
  function refreshHighlight() {
    if (pairing.active) { pairing.refresh(); return; }       // the matchmaker's glow on the eligible homes (M2)
    if (!hover || tool.id === 'hammer' || (tool.id === 'hand' && !shift)) { view.highlight([], null); return; }
    if (tool.id === 'hand') {                         // Shift + Hand: show the uproot only where a crop would come out
      const t = hover.kind === 'object' && store.ready ? describe(store.state, hover.id, now(), me()) : null;
      if (t && t.kind === 'plot' && !t.empty) view.highlight([[t.x, t.z]], 'invalid');
      else view.highlight([], null);
      return;
    }
    // the Seed Bag's brush wears the chosen crop's colour (a bare white card did not say what would be planted)
    const hue = tool.id === 'seed_bag' && tool.crop ? cropOf(tool.crop)?.hue : null;
    view.highlight(brushTiles(hover.x, hover.z, brush()), hue && /^#[0-9a-fA-F]{6}$/.test(hue) ? hue : HIGHLIGHT[tool.id] ?? 'brush');
  }

  // The canvas rect, measured once and again only after a resize (qa2 CL-05): a getBoundingClientRect per pointer event
  // forced a synchronous layout of the whole HUD after every predicted change of a drag stroke (50-160 ms tasks)
  let rect = null;
  const canvasRect = () => rect ?? (rect = canvas.getBoundingClientRect());
  const dropRect = () => { rect = null; };
  if (typeof ResizeObserver === 'function') { try { new ResizeObserver(dropRect).observe(canvas); } catch { /* not an element */ } }
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', dropRect);

  // the canvas moves when the page scrolls (iOS scrolls it for the keyboard) or the visual viewport changes
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('scroll', dropRect, { passive: true });
  if (typeof window !== 'undefined' && window.visualViewport?.addEventListener) {
    window.visualViewport.addEventListener('resize', dropRect);
    window.visualViewport.addEventListener('scroll', dropRect);
  }

  function ndcAt(x, y) {
    const r = canvasRect();
    return { x: ((x - r.left) / r.width) * 2 - 1, y: -((y - r.top) / r.height) * 2 + 1 };
  }
  function ndcOf(e) { return ndcAt(e.clientX, e.clientY); }

  /** quiet: a touch press or drag (no hover on a phone: the tooltip waits for a long press). */
  function setHover(p, quiet = false) {
    const changed = !hover !== !p || (p && hover && (p.x !== hover.x || p.z !== hover.z || p.id !== hover.id));
    hover = p;
    avatar.setCursor(p ? { x: p.px ?? p.x + 0.5, z: p.pz ?? p.z + 0.5 } : null);
    if (changed) {
      updateGhost();
      refreshHighlight();
      if (!quiet) emit('hover', p);
    }
  }

  // ---- camera panning (grab the ground: the point under the cursor stays under it) ---------------------------
  let panTo = null;              // { ndc } the latest pointer position while panning, applied once per frame
  function panFrame() {
    if (!down || !down.anchor || !panTo) return;
    if (interior.inside) { panTo = null; return; }             // the room's camera turns and zooms, it never pans
    const g = view.pick(panTo);
    panTo = null;
    if (!g || !Number.isFinite(g.px)) return;
    const dx = down.anchor.x - g.px;
    const dz = down.anchor.z - g.pz;
    if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return;
    const { yaw } = view.camera.get();
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    view.camera.pan(-fz * dx + fx * dz, fx * dx + fz * dz);
  }
  // ---- turning and tilting the camera (wave 4, wish H; game/camera-input.js) --------------------------------------
  const orbitAcc = { x: 0, y: 0 };  // CSS px of a rotate-mode right-drag since the last frame (applied once per frame)
  const orbitOut = { yaw: 0, pitch: 0 };
  let quarterAcc = 0;               // the quarter-step fallback's horizontal drag
  /** The drag since the last frame turns and tilts the view (the room, or a view without orbit: quarter steps). */
  function orbitFrame() {
    if (!orbitAcc.x && !orbitAcc.y) return;
    const r = canvasRect();
    if (canOrbit(view) && !interior.inside) {
      orbitStep(orbitAcc.x, orbitAcc.y, r.height, orbitOut);
      view.camera.orbit(orbitOut.yaw, orbitOut.pitch);
    } else {
      const q = quarterSteps(quarterAcc, orbitAcc.x, r.width);
      quarterAcc = q.acc;
      if (q.turn) view.camera.rotate(q.turn);
    }
    orbitAcc.x = 0; orbitAcc.y = 0;
    poke();
  }
  /** A tilt from a key (PageUp / PageDown) or a finger: dPitch radians (+ toward top-down). */
  function tiltBy(dPitch) {
    if (!canOrbit(view) || interior.inside || !Number.isFinite(dPitch)) return false;
    view.camera.orbit(0, dPitch);
    poke();
    return true;
  }
  /** Home: the automatic tilt and the nearest quarter turn again. */
  function resetView() {
    if (interior.inside || typeof view.camera.resetOrbit !== 'function') return false;
    view.camera.resetOrbit();
    poke();
    return true;
  }

  function panPixels(dx, dy) {                       // fallback when the ray misses the ground
    if (interior.inside) return;
    const dist = view.camera.get().dist || 55;
    const k = dist / 55;
    view.camera.pan(-dx * 0.03 * k, dy * 0.045 * k);
  }

  // ---- pointer --------------------------------------------------------------------------------------------------
  canvas.style.cursor = cursorFor(tool.id);
  // the canvas takes every finger itself: no browser pan, zoom, pull-to-refresh, text selection or iOS callout on it
  // (panels elsewhere keep scrolling: nothing here touches the document)
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.style.webkitUserSelect = 'none';
  canvas.style.webkitTouchCallout = 'none';
  canvas.style.webkitTapHighlightColor = 'transparent';
  // Safari's own pinch (gesture events) would zoom the page under the game: on the canvas, and on the HUD and the
  // sheets too (iOS honours no touch-action for a page pinch; mobile QA P1-1)
  for (const ev of ['gesturestart', 'gesturechange']) {
    (typeof document !== 'undefined' && typeof document.addEventListener === 'function' ? document : canvas)
      .addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }
  // a tap acts on pointerup and may open something right under the finger (the seed picker, a building's sheet, the
  // ⟳ ✕ ✓ bar): the browser's own click that follows the touch would then land on it and choose for the player. No
  // click after a finger on the farm; a text field still loses focus (the keyboard closes) as a click would do
  canvas.addEventListener('touchend', (e) => {
    if (e.cancelable) e.preventDefault();
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    if (a && a !== document.body && typeof a.matches === 'function' && a.matches('input, textarea, [contenteditable="true"]')) a.blur();
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') { touchDown(e); return; }
    setInput(e.pointerType === 'pen' ? 'pen' : 'mouse');
    stopFling();
    poke();
    if (down) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    const ndc = ndcOf(e);
    lastNdc = ndc;
    const p = view.pick(ndc);
    setHover(p);
    down = { id: e.pointerId, button: e.button, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mode: 'pending',
      anchor: p && Number.isFinite(p.px) ? { x: p.px, z: p.pz } : null, info: null };
    if (e.button === 1) { down.mode = 'middle'; e.preventDefault(); return; }
    if (e.button === 2) { down.mode = 'right'; return; }
    if (e.button !== 0 || !store.ready) return;
    if (interior.inside && tool.id === 'hammer') { interior.at(ndc, { tool: tool.id }); down.mode = 'mode'; return; }
    if (tool.id === 'hammer') { down.mode = 'build'; return; }
    // a line in the water or the matchmaker (M2): the press is theirs, nothing else happens (no pan, no stroke)
    if (modePress(p)) { down.mode = 'mode'; return; }
    // inside the farmhouse (M2): the room takes the press (furniture, the door)
    if (interior.inside) { interior.at(ndc, { tool: tool.id }); down.mode = 'mode'; return; }
    const r = beginStroke(p, e);
    if (r.started) { down.mode = 'stroke'; refreshHighlight(); }
    else down.info = r;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') { touchMove(e); return; }
    poke();
    const ndc = ndcOf(e);
    lastNdc = ndc;
    if (down && down.mode === 'pan') {
      panTo = ndc;
      if (!down.anchor) { panPixels(e.clientX - down.x, e.clientY - down.y); panTo = null; }
      down.x = e.clientX; down.y = e.clientY;
      return;
    }
    if (down && down.mode === 'orbit') {
      orbitAcc.x += e.clientX - down.x;
      orbitAcc.y += e.clientY - down.y;
      down.x = e.clientX; down.y = e.clientY;
      return;
    }
    if (down && ['pending', 'build', 'middle', 'right'].includes(down.mode) && Math.hypot(e.clientX - down.x0, e.clientY - down.y0) > CLICK_PX) {
      // the camera mode "Rotate" (wave 4, wish H): a right-drag turns and tilts; Shift + right-drag still pans
      if (down.mode === 'right' && options.rotateDrag && !e.shiftKey) {
        down.mode = 'orbit';
        canvas.style.cursor = 'move';
        orbitAcc.x += e.clientX - down.x0;
        orbitAcc.y += e.clientY - down.y0;
        down.x = e.clientX; down.y = e.clientY;
        return;
      }
      down.mode = 'pan';
      canvas.style.cursor = 'grabbing';
      panTo = ndc;
      return;
    }
    if (interior.inside) { interior.hover(ndc); return; }          // the room's ghost follows the pointer (M2)
    const p = view.pick(ndc);
    setHover(p);
    if (down && down.mode === 'stroke') extendStroke(p, e);
    edge = null;
    if (options.edgeScroll && !down) {
      const r = canvasRect();
      const m = 18;                                    // px band along each edge
      const ex = e.clientX - r.left < m ? -1 : r.right - e.clientX < m ? 1 : 0;
      const ez = e.clientY - r.top < m ? 1 : r.bottom - e.clientY < m ? -1 : 0;
      if (ex || ez) edge = { x: ex, z: ez };
    }
  });

  function release(e) {
    const d = down;
    if (!d || (e && e.pointerId !== undefined && e.pointerId !== d.id)) return;
    down = null;
    panTo = null;
    canvas.style.cursor = cursorFor(tool.id);
    if (d.mode === 'stroke') { endStroke(); refreshHighlight(); return; }
    if (d.mode === 'orbit') { orbitFrame(); quarterAcc = 0; return; }
    if (!e || e.type === 'pointercancel') return;
    const p = view.pick(ndcOf(e));
    if (d.mode === 'middle') { if (p && !uiSocial()) ping(p.px ?? p.x + 0.5, p.pz ?? p.z + 0.5); return; }
    if (d.mode === 'right') {
      if (pairing.active) { pairing.cancel(); return; }
      if (tool.build && (tool.build.moveId || tool.build.def !== 'plot')) { endBuild(); setTool('hand'); }
      return;
    }
    if (d.mode === 'build') { buildClick(p); return; }
    if (d.mode === 'pending') click(p, e, d.info);
  }
  canvas.addEventListener('pointerup', (e) => (e.pointerType === 'touch' ? touchUp(e, false) : release(e)));
  canvas.addEventListener('pointercancel', (e) => (e.pointerType === 'touch' ? touchUp(e, true) : release(e)));
  canvas.addEventListener('lostpointercapture', (e) => { if (e.pointerType !== 'touch' && down && down.mode === 'stroke') release(e); });
  // a lifted finger "leaves" the canvas too: touch keeps its own hover (the build ghost's spot)
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'touch') return; edge = null; if (!down) { setHover(null); avatar.setCursor(null); } });
  // A pinch where one finger lands on the HUD (Grandma's card, a level card, the tracker chip) and the other on the
  // farm: the canvas saw one finger and the pinch did nothing (mobile QA P1-2). A HUD finger that goes down within
  // ADOPT_MS of a farm finger (before or after it) joins the farm's two-finger gesture: the canvas takes that pointer.
  const ADOPT_MS = 350;
  const hudFingers = new Map();                                 // touch pointers down on the HUD: id -> { x, y, t }
  const adoptable = (e) => e.pointerType === 'touch' && e.target !== canvas && typeof e.target?.closest === 'function'
    && Boolean(e.target.closest('#hud, #celebrate')) && !e.target.closest('input, textarea, select, .hh-panel');
  function adopt(id, at) {
    if (fingers.has(id) || fingers.size !== 1 || !tg || tg.n !== 1) return false;
    try { canvas.setPointerCapture(id); } catch { return false; }  // a finger already lifted: nothing to join
    hudFingers.delete(id);
    fingers.set(id, { x: at.x, y: at.y });
    twoDown();
    return true;
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('pointerdown', (e) => {
      if (!adoptable(e)) return;
      const t = performance.now();
      if (fingers.size === 1 && tg && tg.n === 1 && t - lastTouchAt < ADOPT_MS && adopt(e.pointerId, { x: e.clientX, y: e.clientY })) return;
      hudFingers.set(e.pointerId, { x: e.clientX, y: e.clientY, t });
    }, { capture: true, passive: true });
    document.addEventListener('pointermove', (e) => {
      const f = hudFingers.get(e.pointerId);
      if (f) { f.x = e.clientX; f.y = e.clientY; }
    }, { capture: true, passive: true });
    for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, (e) => hudFingers.delete(e.pointerId), { capture: true, passive: true });
  }
  /** A farm finger just went down: a HUD finger that landed a moment before it makes this a pinch. */
  function adoptHudFinger() {
    const t = performance.now();
    for (const [id, f] of hudFingers) {
      if (t - f.t > ADOPT_MS) { hudFingers.delete(id); continue; }
      if (adopt(id, f)) return;
    }
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  canvas.addEventListener('dblclick', () => {
    // two taps make a dblclick in some mobile browsers: the touch path has its own double tap (same target only)
    if (performance.now() - lastTouchAt < 800) return;
    if (!hover || tool.id === 'hammer') return;
    view.focus(hover.px ?? hover.x + 0.5, hover.pz ?? hover.z + 0.5);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    stopFling();
    poke();
    const steps = Math.max(-3, Math.min(3, e.deltaY / (e.deltaMode === 1 ? 3 : 100) || Math.sign(e.deltaY)));
    view.camera.zoom(1.12 ** steps, ndcOf(e));
  }, { passive: false });

  // ---- touch (mobile wave 2026-10-03; the model and the pure helpers: game/touch.js) -------------------------------
  // the pointer kind used last; a phone or a tablet (no hover, a coarse pointer) starts as 'touch', so the words of a
  // card shown before the first tap ("Tap Hook it!") already fit the device
  let input = (() => { try { return globalThis.matchMedia?.('(hover: none) and (pointer: coarse)').matches ? 'touch' : 'mouse'; } catch { return 'mouse'; } })();
  const fingers = new Map();     // pointerId -> { x, y } CSS px: the fingers down on the canvas
  let tg = null;                 // the touch gesture: { n: 1, mode: 'press'|'long'|'stroke'|'pan'|'ghost' } | { n: 2 } | { n: 0 } (idle)
  let lastTap = null;            // { t, x, y, p } the previous tap (a double tap on the same thing focuses the camera)
  let lastTouchAt = -Infinity;
  let fling = null;              // { x, z, at } tiles/s: the glide after a touch pan
  let ghostEdge = null;          // { x, y } CSS px of a finger carrying the ghost near the canvas edge (the view follows)
  const CAM_FOV = 30;            // GDD §8.3 (render/camera.js CAM.fov); view.camera.get().fov wins when the camera reports it
  // a clockwise twist of the fingers turns the farm clockwise on screen: camera.rotate(+1) (measured in an emulated phone)
  const TWIST_SIGN = 1;
  const haptics = createHaptics({ enabled: () => options.haptics !== false });
  /** A vibration pulse for a touch player (desktop Chrome has navigator.vibrate too, and nothing to shake). */
  const haptic = (kind) => input === 'touch' && haptics.pulse(kind);

  // the canvas names its controls for a screen reader: a finger's, or the mouse and keys' (mobile QA M-07)
  const CANVAS_LABEL = {
    touch: 'The farm. Tap a plot to plant or harvest; pinch to zoom, twist two fingers to turn the view, drag two fingers up or down to tilt it.',
    mouse: 'The farm. Click a plot to plant or harvest; Q and E rotate the view.',
  };
  if (input === 'touch') canvas.setAttribute?.('aria-label', CANVAS_LABEL.touch);
  function setInput(kind) {
    if (kind === input) return;
    input = kind;
    canvas.setAttribute?.('aria-label', CANVAS_LABEL[kind] ?? CANVAS_LABEL.mouse);
    emit('input', { kind });
  }
  const clearTouchTimers = (g = tg) => { if (g && g.timers) { for (const t of g.timers) clearTimeout(t); g.timers = []; } };
  const stopFling = () => { fling = null; };
  /** A tile pick for (float) ground point p: the ghost and the brush follow tiles, never objects. */
  const tileOf = (p) => (p ? { kind: 'tile', x: Math.floor(p.px ?? p.x), z: Math.floor(p.pz ?? p.z), px: p.px ?? p.x + 0.5, pz: p.pz ?? p.z + 0.5 } : null);

  /** The ground (float tiles) under a screen point, from the camera alone: no raycast, no hover lift, no wind. */
  function groundTile(ndc) {
    const cam = view.camera.get();
    const r = canvasRect();
    const g = cam && r.height > 0 ? groundAt(cam, ndc, r.width / r.height, Number.isFinite(cam.fov) ? cam.fov : CAM_FOV) : null;
    return g ? { x: g.x / TILE_M, z: g.z / TILE_M } : null;
  }
  /** Does the camera projection agree with view.pick here? (else this gesture asks view.pick: never pan the wrong way) */
  function projectionOk(ndc, p) {
    const g = groundTile(ndc);
    if (!g) return false;
    if (!p || !Number.isFinite(p.px)) return true;
    return Math.abs(g.x - p.px) < 0.75 && Math.abs(g.z - p.pz) < 0.75;
  }
  function groundFor(ndc, g = tg) {
    if (g && g.viaPick) { const p = view.pick(ndc); return p && Number.isFinite(p.px) ? { x: p.px, z: p.pz } : null; }
    return groundTile(ndc);
  }
  /** Move the camera target by (dx, dz) tiles on the ground (world axes). */
  function moveTarget(dx, dz) {
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4)) return;
    if (interior.inside) return;                              // inside the farmhouse the farm's camera stays put
    const { yaw } = view.camera.get();
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    view.camera.pan(-fz * dx + fx * dz, fx * dx + fz * dz);
  }
  /** Samples of the camera target while a finger pans (at the input's own time): the release glide's velocity. */
  function trackPan(g, t = performance.now()) {
    const c = view.camera.get();
    if (!c || !Number.isFinite(c.tx) || !g.track) return;
    g.track.push({ t, x: c.tx / TILE_M, z: c.tz / TILE_M });
    while (g.track.length > 2 && t - g.track[0].t > 110) g.track.shift();
  }
  /** The finger let go at `upAt` (the event's own time: a busy phone handles it late, the glide must not care). */
  function startFling(g, upAt = performance.now()) {
    const tr = g && g.track;
    if (!tr || tr.length < 2) return;
    const a = tr[0];
    const b = tr.at(-1);
    const dt = (b.t - a.t) / 1000;
    if (upAt - b.t > 80 || dt < 0.012) return;                        // the finger stopped before it let go: no glide
    let v = { x: (b.x - a.x) / dt, z: (b.z - a.z) / dt };
    const sp = Math.hypot(v.x, v.z);
    if (sp < TOUCH.flingMin) return;
    if (sp > TOUCH.flingMax) v = { x: (v.x * TOUCH.flingMax) / sp, z: (v.z * TOUCH.flingMax) / sp };
    if (typeof view.camera.fling === 'function') { view.camera.fling(v.x, v.z); return; }   // the camera's own glide
    fling = { ...v, at: performance.now() };
    poke();
  }
  /** The ground point under the press stays under the finger (one finger) or the fingers' midpoint (two). */
  function fingerPan(g, ndc, t) {
    if (!g.anchor) { g.anchor = groundFor(ndc, g); return; }
    const p = groundFor(ndc, g);
    if (!p) return;
    moveTarget(g.anchor.x - p.x, g.anchor.z - p.z);
    trackPan(g, t);
  }

  /** Is the (float) point of pick p on the build ghost's footprint, with a finger's slack round it? */
  function onGhost(p) {
    const b = tool.build;
    if (!b || !p || !hover || !ghostShown) return false;
    const { x, z } = ghostTile(hover);
    const [w, d] = footprint(defOf(b.def), b.rot);
    const px = p.px ?? p.x + 0.5;
    const pz = p.pz ?? p.z + 0.5;
    const m = 0.6;
    return px >= x - m && px <= x + w + m && pz >= z - m && pz <= z + d + m;
  }
  /** How far above the finger the carried ghost rides (CSS px): clear of the fingertip whatever the footprint. */
  function ghostLift() {
    const b = tool.build;
    if (!b || !hover || typeof view.toScreen !== 'function') return TOUCH.ghostLiftPx;
    const { x, z } = ghostTile(hover);
    const [w, d] = footprint(defOf(b.def), b.rot);
    const ys = [[x, z], [x + w, z], [x, z + d], [x + w, z + d]].map(([a, c]) => view.toScreen(a, c, 0)?.y).filter(Number.isFinite);
    const half = ys.length ? (Math.max(...ys) - Math.min(...ys)) / 2 : 0;
    return Math.min(170, Math.max(TOUCH.ghostLiftPx, half + 30));
  }
  function carryGhost(g, cx, cy) {
    const p = view.pick(ndcAt(cx, cy - g.lift));
    if (p) setHover(tileOf(p), true);
  }
  /** Build mode on a phone: the ghost starts where the player can see it (the middle of the view, or the thing moved). */
  function touchGhostStart(moveId) {
    if (input !== 'touch' || !tool.build) return;
    const b = tool.build;
    if (moveId && store.state && Object.hasOwn(store.state.farm.objects, moveId)) {
      const o = store.state.farm.objects[moveId];
      const [w, d] = footprint(defOf(b.def), b.rot);
      const x = o.x + Math.floor((w - 1) / 2);
      const z = o.z + Math.floor((d - 1) / 2);
      hover = { kind: 'tile', x, z, px: x + 0.5, pz: z + 0.5 };
      return;
    }
    if (hover && hover.kind === 'tile') return;
    const c = tileOf(view.pick({ x: 0, y: 0.1 }));
    if (!c) return;
    // the nearest spot round the middle where it can go: the ghost starts green, one tap on ✓ away from placed
    hover = freeSpotNear(c, 0, 7) ?? c;
  }
  /**
   * The nearest tile (a hover for the ghost's centre) within rings r0..r1 of c where the ghost can go, preferring the
   * calm middle of the screen (clear of the HUD round the edges); null when there is none.
   */
  function freeSpotNear(c, r0, r1) {
    if (!store.ready || !tool.build) return null;
    const r = canvasRect();
    const inner = (h) => {
      const sp = typeof view.toScreen === 'function' ? view.toScreen(h.x + 0.5, h.z + 0.5, 0) : null;
      if (!sp || !Number.isFinite(sp.x) || !(r.width > 0)) return true;
      const u = (sp.x - r.left) / r.width;
      const v = (sp.y - r.top) / r.height;
      return u > 0.15 && u < 0.72 && v > 0.22 && v < 0.7;          // clear of the HUD round the edges
    };
    let first = null;
    for (let k = r0; k <= r1; k++) {
      for (let dz = -k; dz <= k; dz++) {
        for (let dx = -k; dx <= k; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== k) continue;
          const h = { kind: 'tile', x: c.x + dx, z: c.z + dz, px: c.x + dx + 0.5, pz: c.z + dz + 0.5 };
          const { x, z } = ghostTile(h);
          const { code } = buildCheck(x, z);
          if (code && !SOFT.has(code)) continue;
          if (inner(h)) return h;
          first ??= h;
        }
      }
    }
    return first;
  }

  function touchDown(e) {
    setInput('touch');
    lastTouchAt = performance.now();
    stopFling();
    poke();
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    if (fingers.size === 1) { oneDown(e); if (hudFingers.size) adoptHudFinger(); }
    else if (fingers.size === 2) twoDown();
    // a third finger joins nothing: the two-finger gesture keeps its first two
  }

  function oneDown(e) {
    const ndc = ndcOf(e);
    lastNdc = ndc;
    const p = view.pick(ndc);
    const g = { n: 1, id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: Number.isFinite(e.timeStamp) ? e.timeStamp : performance.now(), p, mode: 'press', ghost: false, tip: false,
      slop: tapSlop(globalThis.devicePixelRatio), timers: [], anchor: null, viaPick: false, track: [], lift: TOUCH.ghostLiftPx };
    tg = g;
    if (tool.build) {
      g.ghost = onGhost(p);
      avatar.setCursor(p ? { x: p.px ?? p.x + 0.5, z: p.pz ?? p.z + 0.5 } : null);
    } else if (store.ready && tool.id !== 'hammer') setHover(p, true);   // the brush under the finger, no tooltip
    // the ui's world tooltip appears 250 ms after a hover: send it early, so it shows exactly when the press turns long
    const tipFor = p && (p.kind === 'object' || p.kind === 'pet');
    if (tipFor && !tool.build) g.timers.push(setTimeout(() => { if (tg === g && g.mode === 'press') { g.tip = true; emit('hover', p); } }, TOUCH.longMs - TOUCH.tipLeadMs));
    g.timers.push(setTimeout(() => longPress(g), TOUCH.longMs));
  }

  function longPress(g) {
    if (tg !== g || g.mode !== 'press') return;
    g.mode = 'long';
    haptic('tick');
    const p = g.p;
    if (!tool.build || !p || (p.kind !== 'object' && p.kind !== 'pet')) return;
    // the Hammer held on a placed thing: its hint (Pin, Move back, Masterwork), as a mouse hovering it gets
    if (pickUpTarget(p)) setHover(p, true);
    else emit('hover', p);
  }

  function touchMove(e) {
    const f = fingers.get(e.pointerId);
    if (!f) return;
    f.x = e.clientX;
    f.y = e.clientY;
    poke();
    const g = tg;
    if (!g) return;
    if (g.n === 2) { if (g.ids.includes(e.pointerId)) twoMove(g, e.timeStamp); return; }
    if (g.n !== 1 || e.pointerId !== g.id) return;
    const ndc = ndcOf(e);
    lastNdc = ndc;
    if (g.mode === 'press' || g.mode === 'long') {
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) <= g.slop) return;
      startDrag(g, e);
    }
    if (g.mode === 'stroke') {
      const p = view.pick(ndc);
      setHover(p, true);
      extendStroke(p, e);
    } else if (g.mode === 'pan') fingerPan(g, ndc, e.timeStamp);
    else if (g.mode === 'ghost') {
      carryGhost(g, e.clientX, e.clientY);
      const r = canvasRect();
      const m = 44;
      const ex = e.clientX - r.left < m ? -1 : r.right - e.clientX < m ? 1 : 0;
      const ey = e.clientY - g.lift - r.top < m ? 1 : r.bottom - e.clientY < m ? -1 : 0;
      ghostEdge = ex || ey ? { x: ex, z: ey, cx: e.clientX, cy: e.clientY } : null;
    }
  }

  /** The finger moved past the tap slop: a stroke, a pan or a carried ghost from now on. */
  function startDrag(g, e) {
    clearTouchTimers(g);
    // a tooltip sent early, or a long press's (a busy phone may call the press long before the first move arrives),
    // never shows during a drag
    if (g.mode === 'press' || g.mode === 'long' || g.tip) emit('hover', null);
    if (tool.build) g.mode = g.ghost ? 'ghost' : 'pan';
    else if (!store.ready || tool.id === 'hammer') g.mode = 'pan';
    // the finger landed on bare ground and the tolerance rings found a weed or a rock next to it: a TAP there still
    // clears it, a Hand DRAG from there pans the farm (it used to clear the debris instead; mobile QA M-15)
    else if (tool.id === 'hand' && g.p && g.p.near) g.mode = 'pan';
    else {
      const r = beginStroke(g.p, { shiftKey: false, timeStamp: e.timeStamp });
      g.mode = r.started ? 'stroke' : 'pan';
      if (r.started) refreshHighlight();
    }
    if (g.mode === 'pan') {
      const ndc0 = ndcAt(g.x0, g.y0);
      g.viaPick = !projectionOk(ndc0, g.p);
      g.anchor = groundFor(ndc0, g);
      if (!tool.build) setHover(null, true);                    // no brush under a panning finger
    } else if (g.mode === 'ghost') {
      g.lift = ghostLift();
      haptic('tick');
    }
  }

  function twoDown() {
    const prev = tg;
    if (prev && prev.n === 1) {                                 // the first finger's gesture gives way
      clearTouchTimers(prev);
      if (prev.mode === 'stroke') endStroke();
      if (prev.mode === 'press' || prev.mode === 'long' || prev.tip) emit('hover', null);
    }
    ghostEdge = null;
    lastTap = null;
    if (!tool.build) setHover(null, true);
    const [[ia, a], [ib, b]] = [...fingers.entries()];
    const pr = pair(a, b);
    const ndc = ndcAt(pr.x, pr.y);
    // wave 4 (wish H): two fingers side by side dragged up or down together tilt the view; the gesture is told apart
    // in its first ~10-18 px (game/camera-input.js tiltIntent). A camera without the tilt: the usual gesture at once
    const intent = canOrbit(view) && !interior.inside ? null : 'free';
    const g = { n: 2, ids: [ia, ib], last: pr, acc: 0, settleUntil: 0, anchor: null, viaPick: false, track: [], intent,
      start: { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }, tiltY: pr.y };
    g.viaPick = !projectionOk(ndc, view.pick(ndc));
    g.anchor = groundFor(ndc, g);
    tg = g;
    avatar.setCursor(null);
  }

  function twoMove(g, at) {
    const a = fingers.get(g.ids[0]);
    const b = fingers.get(g.ids[1]);
    if (!a || !b) return;
    const pr = pair(a, b);
    const ndc = ndcAt(pr.x, pr.y);
    const t = performance.now();
    if (g.intent === null) {
      g.intent = tiltIntent(g.start, { a, b });
      if (g.intent === null) return;                          // not told apart yet: nothing moves
      if (g.intent === 'tilt') { g.tiltY = g.start.a.y / 2 + g.start.b.y / 2; haptic('tick'); }
      else { g.last = pr; g.anchor = groundFor(ndc, g); g.track = []; return; }   // the usual gesture from here on
    }
    if (g.intent === 'tilt') {
      const dy = pr.y - g.tiltY;
      g.tiltY = pr.y;
      tiltBy(orbitStep(0, dy, canvasRect().height, orbitOut).pitch);
      return;
    }
    // twist: a quarter turn per snap; while the view turns, the ground under the fingers is taken again, not chased
    const tw = twist(g.acc, angleDelta(g.last.ang, pr.ang), Math.min(pr.dist, g.last.dist));
    g.acc = tw.acc;
    if (tw.turn) {
      view.camera.rotate(tw.turn * TWIST_SIGN);
      g.settleUntil = t + 460;
      g.track = [];
      haptic('tick');
    }
    if (t < g.settleUntil) g.anchor = groundFor(ndc, g);
    else fingerPan(g, ndc, at);
    // pinch: the spread's change zooms about the midpoint (fingers apart = closer)
    if (g.last.dist > 12 && pr.dist > 12) {
      const f = g.last.dist / pr.dist;
      if (Math.abs(f - 1) > 0.002) view.camera.zoom(f, ndc);
    }
    g.last = pr;
  }

  /** A finger lifted (or the browser took it: cancelled). */
  function touchUp(e, cancelled) {
    if (!fingers.has(e.pointerId)) return;
    fingers.delete(e.pointerId);
    lastTouchAt = performance.now();
    const g = tg;
    if (!g) return;
    if (g.n !== 1) {
      // a two-finger gesture ends with its first lift; the finger left on the glass does nothing until it lifts too
      if (g.n === 2 && g.ids.includes(e.pointerId) && !cancelled) startFling(g, e.timeStamp);
      tg = fingers.size ? { n: 0 } : null;
      return;
    }
    if (e.pointerId !== g.id) return;
    clearTouchTimers(g);
    tg = null;
    ghostEdge = null;
    // a press is a tap by the player's clock (the events' time): a phone too busy drawing to run its timers on time
    // may have called it long already
    const quick = Number.isFinite(e.timeStamp) && e.timeStamp - g.t0 < TOUCH.longMs;
    if (g.mode === 'stroke') endStroke();
    else if (g.mode === 'pan' && !cancelled) startFling(g, e.timeStamp);
    else if ((g.mode === 'press' || (g.mode === 'long' && quick)) && !cancelled) {
      if (g.tip || g.mode === 'long') emit('hover', null);     // a tooltip sent early: a tap is not a long press
      tap(g, e);
    }
    // a long press keeps its tooltip up until the next touch; a carried ghost stays where it was put down
    if (!tool.build) {
      setHover(null, true);
      view.clearHover?.();                                      // the hover lift and the crops' wind leave with the finger
    }
    refreshHighlight();
  }

  /** A tap: a double tap on the same thing focuses the camera; else the click of the tool in hand. */
  function tap(g, e) {
    // the event's own time: a phone busy drawing handles the second tap late, the player tapped twice quickly all the same
    const at = { t: Number.isFinite(e.timeStamp) ? e.timeStamp : performance.now(), x: e.clientX, y: e.clientY, p: g.p };
    const p = g.p;
    // a line in the water or the matchmaker (M2): every tap is theirs (two quick taps on the hook never refocus)
    if (store.ready && tool.id !== 'hammer' && (fishing.casting || pairing.active)) { lastTap = null; modePress(p); return; }
    // inside the farmhouse (M2): a tap is the room's (the piece in hand goes down under the finger)
    if (store.ready && interior.inside) {
      lastTap = null;
      const ndc = ndcAt(e.clientX, e.clientY);
      if (interior.held) interior.hover(ndc);
      interior.at(ndc, { tool: tool.id });
      return;
    }
    const same = (a, b) => Boolean(a && b && (a.kind === 'object' ? b.kind === 'object' && a.id === b.id : a.x === b.x && a.z === b.z));
    if (tool.id !== 'hammer' && isDoubleTap(lastTap, at) && same(lastTap.p, p)) {
      lastTap = null;
      if (p) view.focus(p.px ?? p.x + 0.5, p.pz ?? p.z + 0.5);
      return;
    }
    lastTap = at;
    if (!p || !store.ready) return;
    if (tool.id === 'hammer') { touchBuildTap(p); return; }
    const r = beginStroke(p, { shiftKey: false, timeStamp: e.timeStamp });
    if (r.started) { endStroke(); return; }
    // walking follows taps: open ground with a farming tool walks there too (the Hand's click already does)
    if (p.kind === 'tile' && tool.id !== 'hand' && !p.place && !p.note && !(p.land === 'sale' && p.expansion) && Number.isFinite(p.px)) {
      walkTo(p.px, p.pz);
      return;
    }
    click(p, e, r);
  }

  /** Build mode, a tap: on the ghost it places, on a placed thing (default Hammer) it picks it up, else the ghost goes there. */
  function touchBuildTap(p) {
    if (!tool.build) { buildClick(p); return; }
    if (onGhost(p)) { confirmBuild(); return; }
    if (pickUpTarget(p) || (p.kind === 'tile' && (p.place || (p.land === 'sale' && p.expansion)))) { buildClick(p); return; }
    setHover(tileOf(p), true);
    haptic('tick');
  }

  /** Put the ghost down where it stands (the touch ✓, a tap on the ghost). */
  function confirmBuild() {
    if (!tool.build || !hover || !store.ready) return null;
    return buildClick(hover);
  }

  // ---- keyboard -------------------------------------------------------------------------------------------------
  const typing = (e) => {
    const el = e.target;
    return Boolean(el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable));
  };
  const PAN_KEYS = { panUp: [0, 1], panDown: [0, -1], panLeft: [-1, 0], panRight: [1, 0] };

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') { shift = true; refreshHighlight(); }
    // a ui widget already used this key (the seed tray's arrows, Esc closing a panel), or the player is typing
    if (e.defaultPrevented || typing(e) || e.altKey) return;
    const action = keys.actionOf(e);
    if (!action) return;
    // arrows move focus inside a focused control; WASD still pans
    if (/^Arrow/.test(e.code) && e.target && e.target.closest && e.target.closest('button, [role], select, a[href]')) return;
    poke();
    if (PAN_KEYS[action]) { held.add(action); stopFling(); return; }
    if (e.repeat && !['zoomIn', 'zoomOut', 'tiltUp', 'tiltDown'].includes(action)) return;
    switch (action) {
      case 'hand': setTool('hand'); break;
      case 'build': if (tool.id === 'hammer' && tool.build?.moveId) endBuild(); setTool('hammer'); break;
      case 'rotate': {
        if (interior.held) { interior.rotate(); break; }
        // the Hammer over a placed thing with nothing in hand (wave 4, wish C): it turns where it stands
        const lift = tool.id === 'hammer' ? pickUpTarget(hover) : null;
        if (lift && lift.kind !== 'plot') rotatePlaced(lift.id);
        else rotateGhost();
        break;
      }
      case 'tiltUp': case 'tiltDown': {
        // a scrolled panel takes its own Page keys
        if (e.target && e.target.closest && e.target.closest('.hh-panel, [role="dialog"]')) break;
        e.preventDefault();
        tiltBy((action === 'tiltUp' ? -1 : 1) * ORBIT.keyPitch);
        break;
      }
      case 'camReset': if (!(e.target && e.target.closest && e.target.closest('.hh-panel, [role="dialog"]'))) resetView(); break;
      case 'cancel': {
        // Esc: the top panel closes first (ui-shell); with no panel open it ends a special mode (M2: the matchmaker,
        // the dock), then leaves build mode, then the tool
        const panelOpen = typeof ui?.panels?.top === 'function' ? ui.panels.top() !== null : false;
        if (!panelOpen && pairing.active) { pairing.cancel(); break; }
        if (!panelOpen && fishing.active) { fishing.stop('esc'); break; }
        if (!panelOpen && interior.inside) { if (!interior.cancel()) interior.leave('esc'); break; }
        if (tool.build && (tool.build.moveId || tool.build.def !== 'plot')) { endBuild(); setTool('hand'); } else if (!panelOpen && tool.id !== 'hand') setTool('hand');
        break;
      }
      case 'camLeft': view.camera.rotate(-1); break;
      case 'camRight': view.camera.rotate(1); break;
      case 'zoomIn': view.camera.zoom(1 / 1.12); break;
      case 'zoomOut': view.camera.zoom(1.12); break;
      case 'me': {
        // Space on a focused button / tab / menu item activates it (keyboard play, WCAG): leave it alone
        const el = e.target;
        if (el && el.closest && el.closest('button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], select, summary')) break;
        e.preventDefault();
        // a line in the water (M2): Space is the hook
        if (fishing.casting) { fishing.press(); break; }
        focusMe();
        break;
      }
      case 'partner': focusPartner(); break;
      // The ui-shell's social corner (ui/social.js) owns the ping and the emote wheel when it is wired (ui.mark): the
      // controller then only announces the key; otherwise it pings itself.
      case 'ping': emit('command', { cmd: 'ping' }); if (!uiSocial()) ping(); break;
      case 'emotes': emit('command', { cmd: 'emotes' }); break;
      case 'photo': photo(); break;
      case 'ride': ride(); break;
      case 'undo': e.preventDefault(); undo(); break;
      case 'store': if (interior.held) interior.storeHeld(); else storeHeld(); break;
      default: {
        const m = /^tool(\d)$/.exec(action);
        if (m) {
          const t = TOOL_LIST.find((x) => x.key === m[1]);
          if (t) setTool(t.id);
        }
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') { shift = false; refreshHighlight(); }
    const action = keys.actionOf(e);
    if (action && PAN_KEYS[action]) held.delete(action);
    // releasing W must stop the pan even if Ctrl/Alt changed meanwhile
    for (const [a] of Object.entries(PAN_KEYS)) if (keys.codesOf(a).includes(e.code)) held.delete(a);
  });
  window.addEventListener('blur', () => {
    held.clear(); shift = false; if (down) release(null);
    // the page lost the fingers too (a call, the app switcher): end what they were doing, act on nothing
    if (tg) {
      const g = tg;
      tg = null;
      clearTouchTimers(g);
      if (g.mode === 'stroke') endStroke();
    }
    fingers.clear();
    ghostEdge = null;
    stopFling();
  });

  /** Per frame for touch: the glide after a pan, and the view following a ghost carried to the canvas edge. */
  let touchAt = null;
  function touchFrame(t) {
    if (!fling && !ghostEdge) { touchAt = null; return; }
    const dt = touchAt === null ? 1 / 60 : Math.min(0.05, Math.max(0, (t - touchAt) / 1000));
    touchAt = t;
    if (fling) {
      if (fingers.size) fling = null;
      else {
        moveTarget(fling.x * dt, fling.z * dt);
        const v = flingStep(fling, dt);
        fling = Math.hypot(v.x, v.z) < 0.3 ? null : { ...v, at: t };
      }
    }
    if (ghostEdge) {
      if (!tg || tg.mode !== 'ghost') ghostEdge = null;
      else {
        const sp = 10 * ((view.camera.get().dist || 55) / 55) * dt;   // tiles per second, scaled with the zoom
        view.camera.pan(ghostEdge.x * sp, ghostEdge.z * sp);
        carryGhost(tg, ghostEdge.cx, ghostEdge.cy);
      }
    }
    poke();
  }

  // Key / edge panning runs on its own clock (performance.now() between rendered frames, capped at 0.1 s), never
  // on the loop's dt: a capped loop on a 144 Hz monitor handed the per-rAF dt to frames that rendered only every
  // few ticks, and WASD panned at 40 % speed (RD-02 / performance-05). The first frame of a pan moves one 60 Hz step.
  let panAt = null;
  let hoovesOn = false;
  view.onFrame(() => {
    // the hooves trot while a rider moves (a quiet loop; the partner's rides stay silent: their sounds are -6 dB anyway)
    const trot = Boolean(riding && avatar.moving);
    if (trot !== hoovesOn) { hoovesOn = trot; audio?.loop?.('hooves', trot, { gain: 0.32 }); }
    // latency: the first frame rendered after a predicted change closes every open sample
    const t = performance.now();
    if (latPending.length) {
      for (const t0 of latPending) { lat.push(t - t0); if (lat.length > 400) lat.shift(); }
      latPending = [];
    }
    panFrame();
    orbitFrame();
    touchFrame(t);
    if ((!held.size && !edge) || interior.inside) { panAt = null; return; }
    const step = panAt === null ? 1 / 60 : Math.min(0.1, Math.max(0, (t - panAt) / 1000));
    panAt = t;
    const dist = view.camera.get().dist || 55;
    const sp = 14 * (dist / 55) * step;                       // tiles per second, scaled with the zoom
    let f = 0;
    let r = 0;
    for (const a of held) { r += PAN_KEYS[a][0]; f += PAN_KEYS[a][1]; }
    if (edge && !held.size) { r = edge.x * 0.8; f = edge.z * 0.8; poke(); }
    if (f || r) view.camera.pan(r * sp, f * sp);
  });
  store.on('change', () => {
    updateGhost();
    if (stroke && !store.ready) endStroke();
    // the horse I ride is gone (sold): get off (cosmetic, never an error). Two riders on one horse can only happen when
    // both mount in the same instant; that is left alone (a cosmetic, and the next mount checks again)
    if (riding && store.ready && !Object.hasOwn(store.state.farm.objects, riding)) dismount();
  });
  store.on('welcome', () => { if (tool.build?.moveId && !store.state.farm.objects[tool.build.moveId]) { endBuild(); setTool('hand'); } });

  function latency() {
    if (!lat.length) return { n: 0, last: null, avg: null, p95: null, max: null };
    const s = [...lat].sort((a, b) => a - b);
    const avg = s.reduce((a, b) => a + b, 0) / s.length;
    return { n: s.length, last: +lat.at(-1).toFixed(2), avg: +avg.toFixed(2), p95: +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(2), max: +s.at(-1).toFixed(2) };
  }

  const api = {
    TOOLS,
    get tool() { return publicTool(); },
    get stroke() { return stroke ? { verb: stroke.verb, count: stroke.count, item: stroke.item } : null; },
    get hover() { return hover; },
    /** 'mouse' | 'pen' | 'touch': the pointer used last (mobile wave) */
    get input() { return input; },
    keys,
    setTool,
    confirm: confirmBuild,
    /** R / the touch ⟳: turn the held ghost; with an id (wave 4, wish C): turn that placed object where it stands. */
    rotate: (id) => (typeof id === 'string' ? rotatePlaced(id) : rotateGhost()),
    rotateObject: rotatePlaced,
    canRotate,
    haptic,
    uproot(id) {
      const t = store.ready && typeof id === 'string' ? describe(store.state, id, now(), me()) : null;
      if (!t || t.kind !== 'plot' || t.empty || t.giant) return null;    // a Giant is felled, never uprooted
      const r = resolve(store, 'uproot', t, {});
      if (!r || !r.type || r.code !== undefined) { invalid(id, r?.code ?? null, r ? { type: r.type, args: r.args } : {}); return null; }
      leaveSeat('uproot');
      return perform(r, t, performance.now());
    },
    canUproot(id) {
      const t = store.ready && typeof id === 'string' ? describe(store.state, id, now(), me()) : null;
      if (!t || t.kind !== 'plot' || t.empty) return false;
      if (!verbsFor('hand', t, { shift: true }).includes('uproot')) return false;
      const r = resolve(store, 'uproot', t, {});
      return Boolean(r && r.type && r.code === undefined);
    },
    unlocked: (id) => toolUnlocked(store.state, resolveTool(id) ?? id),
    place: (defId, o = {}) => {
      if (!defOf(defId)) return false;
      if (store.state && levelFromXp(store.state.farm.xp) < (defOf(defId).unlock ?? 1)) { toast(ERR.LOCKED, { type: 'place', args: { def: defId } }); return false; }
      tool.id = 'hammer';
      canvas.style.cursor = cursorFor('hammer');
      const ok = startBuild(defId, { rot: o.rot ?? 0 });
      emit('tool', publicTool());
      return ok;
    },
    build(defId, o) { return this.place(defId, o); },
    placeSet,
    move,
    cancel() { endBuild(); endStroke(); if (tool.id === 'hammer') setTool('hand'); },
    ride,
    dismount,
    get riding() { return riding; },
    /** M2 (wave 3): the Fishing Dock's cast, the Breeding Barn's matchmaker, the farmhouse room (game/fishing.js,
     *  game/pairing.js, game/interior.js). */
    fishing,
    pairing,
    interior,
    /** The special input mode now: 'interior' | 'pairing' | 'fishing' (seated on a dock) | null. */
    get mode() { return interior.inside ? 'interior' : pairing.active ? 'pairing' : fishing.active ? 'fishing' : null; },
    /** null when I may ride now (or ride horse `id`), else why not (NOT_FOUND / NOT_READY / OCCUPIED / LOCKED). */
    rideCode,
    actOn,
    plantWith,
    walkTo,
    do: doAct,
    undo,
    /** Del: put the object being moved away into storage (the touch build bar's "Put it away"). */
    storeHeld,
    setHint,
    moveBack,
    canMoveBack,
    pin,
    ping,
    emote,
    /** Raw presence/social frame to the server (ui/social.js sends its pings and emotes through this). */
    send: (m) => send(m),
    focusMe,
    focusPartner,
    photo,
    latency,
    seeds: () => (store.state ? liveAt('crops', levelFromXp(store.state.farm.xp)).map((c) => c.id) : []),
    /** Input settings for the settings panel: { edgeScroll, haptics, keepAwake, rotateDrag } (+ rightDrag, read-only:
     *  'pan' | 'rotate'), persisted per browser in localStorage 'hh.input'. */
    get options() { return { ...options, rightDrag: options.rotateDrag ? 'rotate' : 'pan' }; },
    setOption(name, value) {
      if (name === 'rightDrag') { name = 'rotateDrag'; value = value === 'rotate' || value === true; }
      if (!Object.hasOwn(options, name)) return false;
      options[name] = Boolean(value);
      if (name === 'edgeScroll' && !value) edge = null;
      local.set('hh.input', options);
      if (name === 'keepAwake') api.device?.wakeLock?.sync?.();     // the screen may sleep (or stay on) at once
      return true;
    },
    on(name, fn) {
      const set = events[name];
      if (!set) return () => {};
      set.add(fn);
      return () => set.delete(fn);
    },
  };
  return api;
}
