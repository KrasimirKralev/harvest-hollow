// The fishing dock for two (GDD §6.2 #21, M2; rules: shared/rules/actions/fishing.js, content FISHING): "Both avatars
// sit on the dock: a calm 20-s timing cast, once per hour each. Catches are Pond Treasures (collection), cosmetic fish
// trophies for the dock and a weekly biggest-fish photo, never an economy item." This file is the INPUT side:
//
//   the Hand on a Fishing Dock (decor `pond_dock`, from L28) or on the Willow Pond's fishing spot (L21, the world place
//   render-world names `fishing`) walks my farmer onto the dock (the server checks the pose like a bench's), then:
//   cast   `cast { id }` / `cast { pond }` goes out at once; the rules roll the bite 5-15 s later (replicated, so this
//          screen knows it exactly from the predicted state: players[me].fish.cast.bite on the server clock)
//   wait   the bobber floats until the bite
//   bite   FISHING.goodMs to hook it: a click, a tap or Space anywhere -> `reel {}` (within perfectMs of the bite:
//          grade 2, within goodMs: 1, later: 0; the rules grade it from the server's own clock)
//   late   missed it: the fish is still on (the rules never punish): "Reel in" any time, and it reels itself in
//          CAST.lateMs after the bite, so a cast never outlasts its calm 20 seconds
//   reel   the reel's little fight, then the catch (the rules' `fishCaught`: species, cm, grade, record), and the
//          farmer stays seated with the rod: the next cast is one click away when the hour is up
// Leaving the dock (walking off, another tool, Esc, "Stop fishing") before the reel leaves the line in the water: nothing is
// spent (the hourly rest starts only when a fish is landed) and the next cast simply replaces it.
//
//   castPhase(now, cast, reeledAt?, timing?) -> { phase, k }   pure: the phase of a cast { at, bite } at server `now`
//   CAST                                                the client-side timings (ms) round the rules' bite
//   isDockDef(def) / dockOf(state, id) / waterPoint(dock) / seatPoint(dock) / pondSpot(state, pond) / ROD_TOOL
//   createFishing({ store, view, avatar, audio, toast, perform, haptic? }) -> fishing   (game/controller.js wires it;
//     haptic(kind): a touch player's vibration pulse on the bite)
//     fishing.start(target) -> { ok, code? }   target: a dock object id, or { pond, seats? } (an owned pond's spot; seats:
//                                        [{ x, z, f }] tiles from render-world's place pick, else the content spot); walks
//                                        there, sits and casts (refused at once with the rules' reason: LOCKED,
//                                        NOT_FOUND, UNKNOWN_ACTION = no fishing in this build; a spent hourly cast
//                                        (COOLDOWN) still seats the farmer, and the card says when the next one is)
//     fishing.press() -> boolean         the hook (true when the press belonged to the cast: the caller does nothing else)
//     fishing.again() -> boolean         cast again from the seat
//     fishing.stop(why?)                 leave the dock
//     fishing.active / casting / phase ('idle'|'seated'|'cast'|'wait'|'bite'|'late'|'reel'|'done') / at / catch
//     fishing.code(target?) -> null | ERR code      why a cast cannot start there now
//     fishing.nextAt() -> ms | null                 when my hourly cast is back (server clock), null when it is now
//     fishing.view() -> { phase, k } | null         the running cast's phase and progress (the HUD's meter)
//     fishing.on('phase', fn)            { phase, at, catch, why?, confirmed? } (game/fishing-hud.js; ui-home's panel)
//     fishing.on('hint', fn)             { text } a gentle word for the HUD
import { defOf, FISHING, expansionOf } from '../../../shared/content/index.js';
import { footprint } from '../../../shared/rules/grid.js';
import { ERR } from '../../../shared/net/protocol.js';
import { canRun as dryRun } from './targets.js';

/**
 * The client's timings round the rules' bite (ms). castMs: the cast animation before the bobber lands; the hook window
 * is the rules' goodMs plus a little for the eye; lateMs after the bite the line reels itself in; reelMs the fight.
 */
export const CAST = Object.freeze({
  castMs: 900,
  hookMs: (FISHING?.goodMs ?? 1200) + 250,
  lateMs: 4500,
  reelMs: 2000,
  doneMs: 4000,
});

/**
 * The phase of a cast at server time `now` (pure). cast: { at, bite } from the rules (players[pid].fish.cast);
 * reeledAt: when I reeled (null while the line is out). k: progress 0..1 inside the phase.
 * @returns {{ phase: 'cast'|'wait'|'bite'|'late'|'reel'|'done'|'idle', k: number }}
 */
export function castPhase(now, cast, reeledAt = null, T = CAST) {
  const span = (a, b) => Math.max(0, Math.min(1, (now - a) / Math.max(1, b - a)));
  if (Number.isFinite(reeledAt)) {
    if (now < reeledAt + T.reelMs) return { phase: 'reel', k: span(reeledAt, reeledAt + T.reelMs) };
    if (now < reeledAt + T.reelMs + T.doneMs) return { phase: 'done', k: span(reeledAt + T.reelMs, reeledAt + T.reelMs + T.doneMs) };
    return { phase: 'idle', k: 0 };
  }
  if (!cast || !Number.isFinite(cast.at) || !Number.isFinite(cast.bite)) return { phase: 'idle', k: 0 };
  const landed = Math.min(cast.at + T.castMs, cast.bite);
  if (now < landed) return { phase: 'cast', k: span(cast.at, landed) };
  if (now < cast.bite) return { phase: 'wait', k: span(landed, cast.bite) };
  if (now < cast.bite + T.hookMs) return { phase: 'bite', k: span(cast.bite, cast.bite + T.hookMs) };
  return { phase: 'late', k: span(cast.bite + T.hookMs, cast.bite + T.lateMs) };
}

/** A fishing place def: the Fishing Dock decor (content FISHING.spots.decor; its effect says 'fishing'). */
export const isDockDef = (def) => Boolean(def && (def.id === FISHING?.spots?.decor || def.effect?.cosmetic === 'fishing'));

/** A fishing dock object on the farm, or null. */
export function dockOf(state, id) {
  const o = state && typeof id === 'string' && Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null;
  const def = o ? defOf(o.def) : null;
  if (!o || !isDockDef(def) || !Number.isFinite(o.x)) return null;
  const rot = o.rot ?? 0;
  const [w, d] = def.size ? footprint(def, rot) : [1, 1];
  return { id, x: o.x, z: o.z, w, d, rot };
}

/** An owned expansion's fishing spot ({ pond, x, z } tiles), or null (content: expansion.feature.fishingSpot). */
export function pondSpot(state, pond) {
  const e = expansionOf(pond);
  const s = e?.feature?.fishingSpot;
  if (!s || !state || !state.farm.expansions.includes(pond)) return null;
  return { pond, x: s.x, z: s.z };
}

/** Every pond spot the farm owns (for a pick near one: render-world may not name the place yet). */
export function pondSpots(state) {
  if (!state) return [];
  return state.farm.expansions.map((e) => pondSpot(state, e)).filter(Boolean);
}

/**
 * The Fishing Dock model (render-life `decor/pond_dock`, measured on screen at each turn): a round pond with a short
 * wooden pier. At rot 0 the pier runs from the +z edge out over the water towards -z, a third of a tile to the -x side
 * of the centre line; the pond fills the -z half. Offsets are tiles from the footprint's centre at rot 0; a quarter turn
 * maps (dx, dz) -> (dz, -dx) (three.js rotation.y = rot x 90 degrees).
 */
export const DOCK = Object.freeze({ seat: Object.freeze([-0.3, -0.05]), water: Object.freeze([-0.1, -0.8]), face: Object.freeze([0, -1]),
  land: Object.freeze([-0.3, 0.95]) });
/** (dx, dz) turned `rot` quarter turns the way the models turn. */
export function turn([dx, dz], rot = 0) {
  let v = [dx, dz];
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) v = [v[1], -v[0]];
  return v.map((n) => (Object.is(n, -0) ? 0 : n));
}
const offsetOf = (dock, off) => {
  const [dx, dz] = turn(off, dock.rot ?? 0);
  return { x: dock.x + dock.w / 2 + dx, z: dock.z + dock.d / 2 + dz };
};

/** Where the bobber floats (float tiles): out over the dock's pond, past the end of its pier. */
export function waterPoint(dock) {
  if (!dock) return null;
  if (!Number.isFinite(dock.w)) return { x: dock.x + 0.5, z: dock.z + 2.1 };
  return offsetOf(dock, DOCK.water);
}

/** Where my farmer sits: the pier's end, facing the water (float tiles + facing in radians, as avatar poses face). */
export function seatPoint(dock) {
  const [fx, fz] = turn(DOCK.face, dock.rot ?? 0);
  if (!Number.isFinite(dock.w)) return { x: dock.x + 0.5, z: dock.z + 0.5, f: Math.atan2(fx, fz) };
  return { ...offsetOf(dock, DOCK.seat), f: Math.atan2(fx, fz) };
}

/** Where the pier meets the land: the farmer walks there round everything, then out along the pier. */
export function landPoint(dock) {
  return offsetOf(dock, DOCK.land);
}

/**
 * The presence tool of my farmer in each phase: 'rod' throughout (render-life's avatars-view seats a farmer whose tool is
 * 'rod' on the dock with the rod; the cast, the bite and the catch it draws from the rules' own events on both screens).
 */
export const ROD_TOOL = Object.freeze({ seated: 'rod', cast: 'rod', wait: 'rod', bite: 'rod', late: 'rod', reel: 'rod', done: 'rod' });

export function createFishing({ store, view, avatar, audio = null, toast = () => {}, perform, haptic = () => false }) {
  const listeners = { phase: new Set(), hint: new Set() };
  const emitTo = (name, p) => {
    for (const fn of [...listeners[name]]) { try { fn(p); } catch (err) { console.error(`fishing listener '${name}' failed`, err); } }
  };
  const hint = (text) => emitTo('hint', { text });
  let at = null;                // { id?, pond?, x, z, f, water, box } the place I fish at (seated)
  let walking = null;           // the place I am walking to
  let reeledAt = null;          // server time of my reel (the reel animation's clock)
  let caught = null;            // the rules' fishCaught event of this cast
  let phase = 'idle';
  let reeling = false;
  let castAt = null;            // server time of my cast (tells my running cast from an older one)

  const me = () => store.pid;
  const now = () => store.now();
  /** My line in the water (the rules' record of the cast I made here), or null. */
  const myCast = () => {
    const f = store.state?.players?.[me()]?.fish;
    const c = f && f.cast;
    return c && Number.isFinite(castAt) && c.at >= castAt - 2000 && !c.done ? c : null;
  };
  const argsOf = (t) => (t.pond ? { pond: t.pond } : { id: t.id });

  /** null when I may cast at `target` now, else the rules' reason. */
  function code(target = at) {
    if (!store.ready) return ERR.NOT_JOINED;
    if (!target) return ERR.NOT_FOUND;
    return dryRun(store, 'cast', argsOf(target));
  }

  function emit(extra = {}) {
    emitTo('phase', { phase, at: at ? { ...at } : null, catch: caught, ...extra });
  }

  function setPhase(next, extra = {}) {
    if (next === phase && !extra.force) return;
    phase = next;
    if (next === 'idle' || !at) avatar.setActivity?.(null);
    else avatar.setActivity?.(ROD_TOOL[next] ?? 'rod', { fish: next, dock: at.id ?? at.pond ?? null, face: at.f });
    const r = next === 'reel';
    if (r !== reeling) { reeling = r; audio?.loop?.('reel', r, { gain: 0.42 }); }
    emit(extra);
  }

  function placeOf(t) {
    const dock = t.id ? dockOf(store.state, t.id) : null;
    if (dock) {
      const seat = seatPoint(dock);
      return { id: t.id, pond: null, x: seat.x, z: seat.z, f: seat.f, water: waterPoint(dock), box: dock,
        path: [landPoint(dock), { x: seat.x, z: seat.z }] };
    }
    const spot = t.pond ? pondSpot(store.state, t.pond) : null;
    if (!spot) return null;
    // the dock render-world draws at the pond names its seats (tiles + facing) in the place pick's args: p1 takes the
    // first, p2 the second, the bobber floats 1.4 tiles out where the farmer faces
    // (a panel's "Fish at Willow Pond" carries no seats: ask the view for the dock it draws)
    const given = Array.isArray(t.seats) ? t.seats : typeof view.fishingSeats === 'function' ? view.fishingSeats(t.pond) : [];
    const seats = (given ?? []).filter((q) => q && Number.isFinite(q.x) && Number.isFinite(q.z));
    if (seats.length) {
      const q = seats[me() === 'p2' ? Math.min(1, seats.length - 1) : 0];
      const f = Number.isFinite(q.f) ? q.f : 0;
      return { id: null, pond: t.pond, x: q.x, z: q.z, f, water: { x: q.x + Math.sin(f) * 1.4, z: q.z + Math.cos(f) * 1.4 },
        box: { x: Math.floor(q.x), z: Math.floor(q.z), w: 1, d: 1 }, path: [{ x: q.x, z: q.z }] };
    }
    // else the content's spot: the end of the jetty, the water past it (+z)
    return { id: null, pond: t.pond, x: spot.x + 0.5, z: spot.z + 0.5, f: 0, water: { x: spot.x + 0.5, z: spot.z + 2.2 },
      box: { x: spot.x, z: spot.z, w: 1, d: 1 } };
  }

  /** Why a cast cannot start, said once (perform() already toasted a refusal it saw itself). */
  function refused(why, toasted = false) {
    if (!toasted) {
      if (why === ERR.COOLDOWN) hint('Resting the line: one cast an hour each');
      else if (why === ERR.UNKNOWN_ACTION || why === ERR.LOCKED) toast('The fish are not biting here yet.', {});
      else toast(why, {});
    }
    if (at) setPhase('seated', { force: true, why });
  }

  /** Cast now (seated): the one `cast` action; the rules roll the bite. */
  function castNow() {
    const why = code(at);
    if (why) { refused(why); return false; }
    avatar.flush?.();                                     // the server checks the pose I sit at (like a bench)
    const res = perform('cast', argsOf(at));
    if (!res || !res.ok) { refused(res?.code ?? ERR.UNKNOWN_ACTION, true); return false; }
    castAt = now();
    reeledAt = null;
    caught = null;
    setPhase('cast', { force: true });                    // the whoosh is the fishCast event's (game/feedback.js)
    return true;
  }

  /** Walk onto the dock (or the pond's jetty), sit, cast. */
  function start(target) {
    const t = typeof target === 'string' ? { id: target } : target;
    if (!t || (!t.id && !t.pond)) return { ok: false, code: ERR.NOT_FOUND };
    const p = placeOf(t);
    if (!p) return { ok: false, code: ERR.NOT_FOUND };
    const why = code(t);
    // a spent hourly cast still seats the farmer (the card says when the next one is); TOO_FAR is what the walk fixes
    if (why && why !== ERR.COOLDOWN && why !== ERR.TOO_FAR) { refused(why); return { ok: false, code: why }; }
    stop('restart');
    walking = p;
    const sit = () => {
      if (walking !== p) return;
      walking = null;
      at = p;
      setPhase('seated', { force: true });
      const c = code(at);
      if (!c) castNow();
      else refused(c);
    };
    // to the dock (round the barn, a hop when far), then out along the pier to its end (a short straight step: the
    // pier is the dock's own footprint, which the router treats as solid)
    avatar.walkTo(p.box.x, p.box.z, p.box.w, p.box.d, () => {
      if (walking !== p) return;
      if (typeof avatar.stepTo === 'function' && p.path) avatar.stepTo(p.path, sit);
      else sit();
    });
    return { ok: true };
  }

  function reelNow() {
    if (!myCast()) return false;
    const res = perform('reel', {});
    if (!res || !res.ok) {
      if (res && res.code === ERR.NOT_FOUND) setPhase('seated', { force: true });
      return false;
    }
    reeledAt = now();
    caught = (res.tx?.events ?? []).find((ev) => ev && ev.e === 'fishCaught') ?? null;
    setPhase('reel', { force: true });                    // the strike's splash is the fishCaught event's
    return true;
  }

  /** The hook (or "reel in" when late): true when the press belonged to the cast. */
  function press() {
    if (!at) return false;
    if (phase === 'cast' || phase === 'wait') { hint('Wait for the bobber to dip…'); return true; }
    if (phase === 'bite' || phase === 'late') { reelNow(); return true; }
    return phase === 'reel';
  }

  function stop(why = 'stop') {
    const was = Boolean(at || walking) || phase !== 'idle';
    // the view's fishing pose ends with it (render-life ends an idle one on its own after a while)
    if (was && phase !== 'idle') { try { view.avatars?.fish?.(me(), 'stop'); } catch { /* an older view */ } }
    walking = null;
    at = null;
    castAt = null;
    reeledAt = null;
    if (was) setPhase('idle', { why, force: true });
  }

  // the confirmed catch replaces the predicted one (a partner's reel in the same instant takes the other roll)
  store.on?.('fx', ({ ev, by, local }) => {
    if (local || by !== me() || !ev || ev.e !== 'fishCaught' || !at) return;
    caught = ev;
    emit({ confirmed: true });
  });
  // a refused cast or reel (the server saw me too far from the dock, or the hour was not up): back to the seat. The
  // server checks the pose IT relays, which follows a walk a moment behind (presence.js): a cast refused TOO_FAR right
  // after sitting down is tried once more when that pose has caught up
  let retried = null;
  store.on?.('reject', (r) => {
    if (!at || r.local || !['cast', 'reel'].includes(r.type)) return;
    castAt = null;
    reeledAt = null;
    if (r.type === 'cast' && r.code === ERR.TOO_FAR && retried !== at) {
      const seat = at;
      retried = seat;
      setPhase('seated', { force: true });
      setTimeout(() => { if (at === seat && phase === 'seated') { avatar.flush?.(); castNow(); } }, 1500);
      return;
    }
    refused(r.code, false);
  });

  // the frame clock: the phase follows the rules' bite on the server clock; sounds at the edges
  function current() {
    if (Number.isFinite(reeledAt)) return castPhase(now(), null, reeledAt);
    const c = myCast();
    return c ? castPhase(now(), c) : null;
  }
  view.onFrame?.(() => {
    if (!at || phase === 'idle' || phase === 'seated') return;
    const cur = current();
    const next = !cur || cur.phase === 'idle' ? 'seated' : cur.phase;
    if (next !== phase) {
      if (next === 'wait' && phase === 'cast') audio?.play('plop', { gain: 0.8 });
      if (next === 'bite') { audio?.play('bite', { gain: 0.95, force: true }); haptic('place'); }   // a phone buzzes on the bite
      if (next === 'done') audio?.play('fish_splash', { gain: 0.8 });
      setPhase(next);
    }
    // a line nobody reels in comes in by itself: the calm 20-second cast (grade 0: the fish is still a fish)
    if (phase === 'late') {
      const c = myCast();
      if (c && now() >= c.bite + CAST.lateMs) reelNow();
    }
  });

  return {
    start,
    press,
    stop,
    code,
    again() { if (!at || (phase !== 'seated' && phase !== 'done')) return false; return castNow(); },
    get active() { return Boolean(at || walking); },
    get casting() { return ['cast', 'wait', 'bite', 'late', 'reel'].includes(phase); },
    get phase() { return phase; },
    get at() { return at ? { ...at } : null; },
    get catch() { return caught; },
    /** When my hourly cast is back (server clock), from the rules' own record; null when a cast is allowed now. */
    nextAt() {
      const f = store.state?.players?.[me()]?.fish;
      const t = f && Number.isFinite(f.at) && f.at > 0 ? f.at + (FISHING?.cooldownMs ?? 3_600_000) : 0;
      return t > now() ? t : null;
    },
    view() {
      if (!at || phase === 'idle' || phase === 'seated') return null;
      return current();
    },
    on(name, fn) {
      const set = listeners[name];
      if (!set) return () => {};
      set.add(fn);
      return () => set.delete(fn);
    },
  };
}
