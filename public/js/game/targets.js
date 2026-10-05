// What a click or a drag stroke means on a target (GDD §7.1 Smart Hand, tool modes, drag-paint). DOM-free so
// node tests drive it (test/sync.input.test.js). Owned by the client-core lane.
//
// The rules lanes own action names and argument shapes (shared/rules/actions/*.js). This file never assumes
// one: every verb lists candidate (type, args) shapes in VERBS, and `resolve()` picks the first candidate that
// this build REGISTERS, whose args PARSE against the action's schema, and whose `check` passes on the current
// predicted state (a dry run: check() is pure). So a click never sends an action the local rules would refuse,
// and a renamed action degrades to "not available" instead of an error.
//
//   describe(state, id, now, pid?) -> target | null
//     { id, obj, def, kind: 'plot'|'tree'|'animal'|'home'|'building'|'debris'|'landmark'|'decor', ... status }
//     pid: the viewer, for per-player facts (a bench seat is MINE or the partner's: coop-robust-01)
//   verbsFor(tool, target, { shift }) -> ['harvest', 'plant', ...]   candidate verbs in priority order
//   resolve(store, verb, target, opts) -> { verb, type, args } | { verb, code } (the first refusal, for the toast)
//   canRun(store, type, args) -> null | ERR code     a pure dry run against the predicted state
//   OPENS[kind or def id] -> panel name the hand opens when nothing else applies
//   countDone(verb, events) -> how many targets an accepted (possibly batched, partially applied) action touched
//   seatText(state, id, pid) -> string | null   the bench line of the world tooltip ("Mia is waiting on the bench...")
//   giantText(state, id, now) -> string | null  the giant line of the world tooltip ("A Giant Pumpkin! 40 / 60 ...")
//   rideText(state, id, pid, { now, riding, riders }) -> string | null   the horse line ("Click to ride (V)")
//   dockText(state, id, pid, now) -> string | null   (M2) the Fishing Dock line ("Click to sit and cast", the hour's rest,
//                                                "Mia is fishing: cast now to fish together")
//   CLIENT_VERBS                                 verbs the client handles itself (no rules action at the click): 'ride',
//                                                'fish' (M2: the Hand on a Fishing Dock sits down and casts, game/fishing.js),
//                                                'nursePick' (M2: a full Nursery card opens the pick of its personality)
//   ONCE_VERBS                                   verbs a drag stroke never repeats (a bench, a giant: one per press)
// M2 facts (wave 3): a decor that is a fishing dock says `dock: true`; an animal with a Nursery card says
// `care: { n, next, at }` (rules-economy breeding.js: o.nurse = { n, at, by }; next = the step it gets next or null)
import { ACTIONS, makeCtx } from '../../../shared/rules/index.js';
import { parseArgs } from '../../../shared/rules/schema.js';
import { defOf, cropOf } from '../../../shared/content/index.js';
import { GROWTH } from '../../../shared/content/index.js';
import { isReady } from '../../../shared/rules/time.js';
import { occupantsOf } from '../../../shared/rules/grid.js';
import { ERR } from '../../../shared/net/protocol.js';
import { NURSERY, FISHING } from '../../../shared/content/index.js';

/** A fishing dock decor (content FISHING.spots.decor; its effect says 'fishing'). */
const isDock = (def) => Boolean(def && (def.id === FISHING?.spots?.decor || def.effect?.cosmetic === 'fishing'));

/**
 * Verb -> candidate shapes. Each candidate: [actionType, (target, opts) => args]. Batch-capable verbs also give
 * `batch: [actionType, (targets, opts) => args]` shapes: a drag stroke sends ONE action per frame for every new
 * target it crossed (GDD §7.1 "one batched action"), when the rules offer such a shape.
 */
const one = (type) => [type, (t) => ({ id: t.id })];
const many = (type) => [type, (ts) => ({ ids: ts.map((t) => t.id) })];
/** A stroke verb whose action takes `{ id }` for a click and `{ ids }` for a frame of a drag (rules-economy STROKE). */
const stroke = (...types) => ({ one: types.map(one), batch: types.map(many) });

export const VERBS = Object.freeze({
  plant: {
    one: [['plant', (t, o) => ({ id: t.id, crop: o.crop })]],
    batch: [['plant', (ts, o) => ({ ids: ts.map((t) => t.id), crop: o.crop })]],
  },
  goldenPlant: {
    one: [['plant', (t, o) => ({ id: t.id, crop: o.crop, golden: true })]],
    batch: [['plant', (ts, o) => ({ ids: ts.map((t) => t.id), crop: o.crop, golden: true })]],
  },
  harvest: stroke('harvest'),
  water: stroke('water'),
  compost: stroke('compost', 'fertilize'),
  fertilize: stroke('fertilize'),                     // wave 4 (wish 2): the scoop set to Fertilizer
  uproot: stroke('uproot'),
  pick: stroke('harvestTree', 'shake'),
  chop: stroke('chop'),
  clear: stroke('clear', 'chop'),                     // debris: the rules clear it through `chop` (hp, then gone)
  tend: stroke('tend'),                               // collect + re-feed in one stroke (GDD §3.7 Feed Scoop)
  feed: stroke('feed'),
  collect: stroke('collect'),
  pet: stroke('pet'),
  collectTray: stroke('collectTray', 'craftCollect'),
  bottle: { one: [one('bottle')] },
  // M2 (wave 3): the next Nursery care step of a baby (rules-economy breeding.js `nurse { id }`); a drag gives each
  // baby under the stroke its step
  nurse: { one: [one('nurse')], batch: [] },
  // a Giant (GDD §6.2 #8): every chop goes to the anchor plot (the block's min corner holds hp and timers); one chop
  // per press, never a drag (a stroke across the nine plots must not chop nine times)
  fell: { one: [['chop', (t) => ({ id: t.giant })], ['chop', (t) => ({ id: t.id })], ['fell', (t) => ({ id: t.giant })],
    ['chopGiant', (t) => ({ id: t.giant })]] },
  sit: { one: [one('sit')] },
  stand: { one: [['stand', () => ({})]] },
  place: { one: [['place', (t, o) => ({ def: o.def, x: o.x, z: o.z, rot: o.rot })]] },
  move: { one: [['move', (t, o) => ({ id: t.id, x: o.x, z: o.z, rot: o.rot })]] },
  moveBack: { one: [one('moveBack')] },
  refund: { one: [one('refund'), one('undoBuy')] },
  store: { one: [one('store')] },
  highFive: { one: [['highFive', () => ({})]] },
  // wave 4 (wish F): a wild tuft on the farm's own land, pulled with the Hand (rules `clearWeed {x, z}`; a target here is
  // { x, z, k? } of the weeded tile, never an object)
  weed: { one: [['clearWeed', (t) => ({ x: t.x, z: t.z })], ['clearWeeds', (t) => ({ x: t.x, z: t.z })],
    ['pullWeed', (t) => ({ x: t.x, z: t.z })], ['weed', (t) => ({ x: t.x, z: t.z })], ['clearTuft', (t) => ({ x: t.x, z: t.z })]] },
  // wave 4b (wish 1): a balloon crate on the farm, opened by either farmer (rules `openCrate {id}`); one per press
  openCrate: { one: [one('openCrate'), one('crateOpen'), one('openLoot'), one('lootCrate'), one('collectCrate')] },
});

/** The event names one verb's action emits per target (to count what a batch really did). */
export const VERB_EVENTS = Object.freeze({
  plant: ['planted'], goldenPlant: ['planted'], harvest: ['harvested'], water: ['watered'], compost: ['composted', 'fertilized'], fertilize: ['fertilized'],
  uproot: ['uprooted'], pick: ['picked'], chop: ['chopped', 'cleared'], clear: ['cleared', 'chopped'],
  tend: ['collected', 'fed'], feed: ['fed'], collect: ['collected'], pet: ['petted'], collectTray: ['crafted'],
  fell: ['chopHit', 'giantFelled'], nurse: ['nursed'], openCrate: ['crateOpened'],
});

/** Verbs with no rules action: the client does them itself (riding a horse is cosmetic, GDD §3.4 Horse). */
export const CLIENT_VERBS = Object.freeze(new Set(['ride', 'fish', 'nursePick']));
/** Verbs a drag stroke does once, on the pressed target only. */
export const ONCE_VERBS = Object.freeze(new Set(['sit', 'stand', 'fell', 'ride', 'fish', 'nursePick', 'openCrate']));

/** A balloon loot crate's def (content CRATE_DEF: kind 'crate'; wave 4b, wish 1). */
export const isCrate = (def) => Boolean(def && (def.kind === 'crate' || def.crate === true));
/** The species a farmer can ride (cosmetic, walk speed x1.8). */
export const RIDEABLE = Object.freeze(new Set(['horse']));

/** How many distinct targets an accepted action touched (from its events), for the stroke counter. */
export function countDone(verb, events) {
  const names = VERB_EVENTS[verb];
  if (!names) return 1;
  const ids = new Set();
  for (const ev of events) {
    if (!names.includes(ev.e)) continue;
    for (const id of Array.isArray(ev.ids) ? ev.ids : typeof ev.id === 'string' ? [ev.id] : []) ids.add(id);
  }
  return ids.size;
}

/**
 * Panels the hand opens on things with nothing to do (ui-shell names, ui/index.js header). A list: the first one the
 * ui has registered (the farmhouse holds the Ribbon Wall from M1b, GDD §5.4; the Journal before ui-collect's panel).
 */
export const OPENS = Object.freeze({
  barn: 'barn', market_stand: 'market', order_board: 'orders', farmhouse: ['ribbonwall', 'journal'], mailbox: 'notes',
  well: 'upgrades',                                   // wave 4 (wish E): the Well has no panel but its upgrades
  building: 'building', home: 'animals', tree: 'tree', animal: 'animals',
});

const objectOf = (state, id) => (state && typeof id === 'string' && Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null);

/**
 * A plain description of an object for input decisions (never stored).
 * @param {object} state @param {string} id @param {number} now
 * @param {string} [pid] the viewer: per-player facts (bench seats) are computed for this player
 */
export function describe(state, id, now, pid) {
  const obj = objectOf(state, id);
  if (!obj) return null;
  const def = defOf(obj.def);
  if (!def) return null;
  const t = { id, obj, def, kind: def.kind, x: obj.x, z: obj.z };
  switch (def.kind) {
    case 'plot': {
      const c = obj.crop;
      t.empty = !c;
      t.ready = Boolean(c && isReady(c, now));
      t.growing = Boolean(c && !t.ready);
      t.crop = c ? c.def : null;
      // GDD §3.1 rule 4: only crops of >= 30 min can be watered; the rules decide the rest (once per cycle)
      t.waterable = t.growing && (cropOf(c.def)?.growMs ?? 0) >= GROWTH.water.minCropMs;
      // one of the nine plots of a Giant: the anchor (the block's min corner) holds what counts (rules-economy)
      if (c && typeof c.giant === 'string') {
        const anchor = objectOf(state, c.giant);
        const ac = anchor && anchor.crop ? anchor.crop : c;
        t.giant = c.giant;
        t.ready = Boolean(isReady(ac, now));
        t.growing = !t.ready;
        t.hp = Number.isSafeInteger(ac.hp) ? ac.hp : null;
        t.waterable = false;
      } else t.giant = null;
      break;
    }
    case 'tree':
      t.sapling = Number.isFinite(obj.matureAt) && obj.matureAt > now;
      t.ready = !t.sapling && Number.isFinite(obj.readyAt) && obj.readyAt <= now;
      t.growing = !t.ready;
      break;
    case 'animal': {
      const home = objectOf(state, obj.home);
      t.home = obj.home;
      t.x = home ? home.x : undefined;
      t.z = home ? home.z : undefined;
      t.baby = Number.isFinite(obj.adultAt) && obj.adultAt > now;
      t.ready = !t.baby && Number.isFinite(obj.readyAt) && obj.readyAt <= now;
      // a bee colony eats nothing and is never petted: its honey is collected and the next cycle starts by itself
      t.colony = def.feed === null;
      t.hungry = !t.baby && !t.colony && !Number.isFinite(obj.readyAt);
      t.rideable = RIDEABLE.has(def.id) && !t.baby;
      // the Nursery card (M2): started while a baby, its later steps may come after it grew up
      if (obj.nurse && typeof obj.nurse === 'object') {
        const n = Number.isSafeInteger(obj.nurse.n) ? obj.nurse.n : 0;
        const steps = NURSERY?.steps ?? ['feed', 'play', 'groom'];
        t.care = { n, of: steps.length, next: n < steps.length ? steps[n] : null,
          at: Number.isFinite(obj.nurse.at) ? obj.nurse.at + (NURSERY?.stepGapMs ?? 600_000) : 0,
          picked: typeof obj.pers === 'string' };
      } else t.care = null;
      break;
    }
    case 'home': {
      t.occupants = occupantsOf(state, id);
      // the rules take a home id for its animals (tend / feed / collect / pet): what would a click do there?
      const animals = t.occupants.map((a) => describe(state, a, now)).filter(Boolean);
      t.anyReady = animals.some((a) => a.ready);
      t.anyHungry = animals.some((a) => a.hungry);
      t.anyBaby = animals.some((a) => a.baby);
      break;
    }
    case 'decor': {
      t.seats = def.effect && Number.isSafeInteger(def.effect.seats) ? def.effect.seats : 0;
      t.dock = isDock(def);
      // Seats are per viewer: the partner sitting here is an invitation to sit next to them, never a reason to
      // "stand up" (coop-robust-01: the second farmer could never sit, so Golden Hour never started)
      const bench = (state.farm.coop && state.farm.coop.bench) || {};
      const on = Object.keys(bench).filter((p) => bench[p] && bench[p].id === id).sort();
      t.mySeat = Boolean(pid && on.includes(pid));
      t.seatsTaken = on.length;
      t.seatedHere = on.length > 0;
      t.seatedOthers = on.filter((p) => p !== pid);
      break;
    }
    case 'building': {
      const q = Array.isArray(obj.queue) ? obj.queue : [];
      t.trayReady = q.some((it) => it && Number.isFinite(it.e) && it.e <= now) || (Array.isArray(obj.tray) && obj.tray.length > 0);
      break;
    }
    case 'debris':
      t.tool = def.tool || 'axe';
      break;
    case 'crate':
      t.crate = true;
      break;
    default:
      break;
  }
  return t;
}

/**
 * Candidate verbs, in priority order, for a tool on a target. The first one that resolves wins (Smart Hand:
 * "click does the obvious thing", GDD §7.1). shift: the Hand uproots growing crops (Shift + Hand).
 * @param {string} tool @param {object} t describe() result @param {{ shift?: boolean, spread?: string }} [o]
 */
export function verbsFor(tool, t, { shift = false, spread = 'compost' } = {}) {
  if (!t) return [];
  const k = t.kind;
  // a balloon crate opens with whatever is in hand but the Hammer (it is never moved: content movable false)
  if (t.crate || isCrate(t.def)) return tool === 'hammer' ? [] : ['openCrate'];
  switch (tool) {
    case 'hand':
      if (k === 'plot') {
        if (t.giant) return t.ready && !shift ? ['fell'] : [];          // a Giant is felled, never uprooted
        if (shift) return t.empty ? [] : ['uproot'];
        return t.ready ? ['harvest'] : t.empty ? ['plant'] : t.waterable ? ['water'] : [];
      }
      if (k === 'tree') return t.ready ? ['pick'] : ['water'];
      if (k === 'animal') {
        if (t.ready || t.hungry) return ['tend'];
        if (t.colony) return [];
        // the Nursery (M2): a full card waits for its personality pick; a running one takes its next step first
        // (one Baby Bottle each, 10 minutes apart: when the step is not due the bottle / the pet follows as before)
        const care = t.care && !t.care.picked ? (t.care.next ? ['nurse'] : ['nursePick']) : [];
        if (care[0] === 'nursePick') return care;
        // a horse with nothing to do: pet it once today, then the Hand rides it (V does too, from anywhere)
        return [...care, ...(t.baby ? ['bottle', 'pet'] : t.rideable ? ['pet', 'ride'] : ['pet'])];
      }
      if (k === 'home') return t.anyReady || t.anyHungry ? ['tend'] : [];
      if (k === 'building') return t.trayReady ? ['collectTray'] : [];
      if (k === 'debris') return t.tool === 'hand' ? ['clear'] : [];
      // a Fishing Dock (M2): sit down at its end and cast (game/fishing.js)
      if (k === 'decor') return t.dock ? ['fish'] : t.seats ? [t.mySeat ? 'stand' : 'sit'] : [];
      return [];
    case 'seed_bag': return k === 'plot' && !t.giant ? ['plant'] : [];
    // the Sickle on a ripe Giant fells it too (rules-economy: a Giant answers `harvest` with LOCKED, `chop` fells it)
    case 'sickle': return k !== 'plot' ? [] : t.giant ? (t.ready ? ['fell'] : []) : ['harvest'];
    case 'watering_can':
      return (k === 'plot' && !t.giant) || k === 'tree' ? ['water'] : k === 'animal' && t.baby ? ['bottle'] : [];
    case 'feed_scoop': return (k === 'animal' && !t.colony) || k === 'home' ? ['tend'] : [];
    case 'basket': return k === 'tree' ? ['pick'] : k === 'building' ? ['collectTray'] : k === 'animal' || k === 'home' ? ['collect'] : [];
    // the scoop set to Fertilizer (wave 4, wish 2) feeds growing crops only (rules `fertilize`; trees take Compost)
    case 'compost_scoop':
      if (spread === 'fertilizer') return k === 'plot' && !t.giant ? ['fertilize'] : [];
      return (k === 'plot' && !t.giant) || k === 'tree' ? ['compost'] : [];
    case 'axe':
      if (k === 'plot') return t.giant && t.ready ? ['fell'] : [];
      return k === 'debris' ? ['clear'] : k === 'tree' && t.def.id === 'pine' ? ['chop'] : [];
    default: return [];
  }
}

/**
 * A pure dry run of one action against the store's predicted state: null when it would be accepted.
 * @param {{ state: object, pid: string, cid: string, seq: number, now: () => number }} store
 */
export function canRun(store, type, args) {
  const def = ACTIONS[type];
  if (!def || type.startsWith('_')) return ERR.UNKNOWN_ACTION;
  const parsed = parseArgs(def.schema, args);
  if (!parsed) return ERR.BAD_ARGS;
  if (!store.state || !Object.hasOwn(store.state.players, store.pid)) return ERR.NOT_JOINED;
  try {
    const ctx = makeCtx(store.state, { now: store.now(), pid: store.pid, cid: store.cid, seq: store.seq + 1, ext: {}, grace: 0 });
    return def.check(store.state, parsed, ctx) || null;
  } catch {
    return ERR.INTERNAL;
  }
}

/**
 * The first runnable (type, args) for a verb on a target, or the most meaningful refusal.
 * @returns {{ verb, type, args } | { verb, code } | null}
 */
export function resolve(store, verb, target, opts = {}) {
  const v = VERBS[verb];
  if (!v) return null;
  let refusal = null;
  for (const [type, build] of v.one) {
    if (!ACTIONS[type]) continue;
    let args;
    try { args = build(target, opts); } catch { continue; }
    const code = canRun(store, type, args);
    if (code === null) return { verb, type, args };
    if (code === ERR.BAD_ARGS || code === ERR.UNKNOWN_ACTION) continue;      // another shape may fit
    refusal ??= { verb, type, args, code };                                   // the first real "no"
  }
  return refusal ?? { verb, code: ERR.UNKNOWN_ACTION };
}

/**
 * The batched shape of a verb for several targets (one action per frame of a stroke), or null when the rules
 * offer none: the caller then sends one action per target.
 */
export function resolveBatch(store, verb, targets, opts = {}) {
  const v = VERBS[verb];
  if (!v || !v.batch || targets.length < 2) return null;
  for (const [type, build] of v.batch) {
    if (!ACTIONS[type]) continue;
    const args = build(targets, opts);
    if (!parseArgs(ACTIONS[type].schema, args)) continue;
    const code = canRun(store, type, args);
    if (code === null) return { verb, type, args };
  }
  return null;
}

/**
 * The bench line of the world tooltip for viewer `pid` (GDD §6.2 #9: Golden Hour is the two of you on the bench),
 * or null when `id` is not a bench.
 * @param {object} state @param {string} id @param {string} pid
 */
export function seatText(state, id, pid) {
  const t = describe(state, id, 0, pid);
  if (!t || t.kind !== 'decor' || t.seats < 2) return null;
  const nameOf = (p) => (Object.hasOwn(state.players, p) ? state.players[p].name : 'Your partner');
  if (t.mySeat) {
    return t.seatedOthers.length ? 'Sitting together: Golden Hour is on its way. Click to stand up'
      : 'You are sitting here. Click to stand up';
  }
  if (t.seatedOthers.length >= t.seats) return 'Every seat is taken';
  // no pronoun: either farmer can be the one waiting
  if (t.seatedOthers.length) return `${nameOf(t.seatedOthers[0])} is waiting on the bench. Sit together`;
  return 'Sit here together for Golden Hour';
}

/**
 * The Giant line of the world tooltip, or null when `id` is not part of a Giant (GDD §6.2 #8: 60 hp, a chop is 10, or
 * 15 right after the partner's chop).
 */
export function giantText(state, id, now) {
  const t = describe(state, id, now);
  if (!t || t.kind !== 'plot' || !t.giant) return null;
  const name = cropOf(t.crop)?.name ?? 'crop';
  if (!t.ready) return `A Giant ${name} is growing here`;
  const hp = t.hp ?? null;
  const left = hp !== null ? ` · ${hp} left` : '';
  return `A Giant ${name}! Chop it (Axe, Sickle or Hand)${left}: quicker together, 15 a chop right after your partner's`;
}

/**
 * The horse line of the world tooltip for viewer `pid`, or null when `id` is no rideable animal. riders: how many
 * farmers ride now (each needs an adult horse of the farm's own).
 */
export function rideText(state, id, pid, { now = 0, riding = false, riders = 0 } = {}) {
  const t = describe(state, id, now, pid);
  if (!t || t.kind !== 'animal' || !RIDEABLE.has(t.def.id)) return null;
  if (riding) return 'You are riding. V gets you off';
  if (t.baby) return 'Too young to ride yet';
  if (riders >= adultHorses(state, now)) return 'Every horse has a rider';
  return 'Click to ride (V): you trot at 1.8 times walking speed';
}

/** The Fishing Dock line of the world tooltip for viewer `pid` (GDD §6.2 #21), or null when `id` is no dock. */
export function dockText(state, id, pid, now) {
  const t = describe(state, id, now, pid);
  if (!t || !t.dock) return null;
  const fish = (q) => state.players?.[q]?.fish ?? null;
  const mine = fish(pid);
  const rest = FISHING?.cooldownMs ?? 3_600_000;
  if (mine?.cast && !mine.cast.done && mine.cast.spot === id) return 'Your line is in the water here';
  if (mine && Number.isFinite(mine.at) && mine.at > 0 && now < mine.at + rest) {
    return `Your rod rests: next cast in ${Math.max(1, Math.ceil((mine.at + rest - now) / 60_000))} min`;
  }
  const win = FISHING?.together?.windowMs ?? 20_000;
  const other = Object.keys(state.players ?? {}).sort().find((q) => q !== pid && fish(q)?.cast?.spot === id && now - fish(q).cast.at <= win);
  if (other) return `${state.players[other].name} is fishing: cast now to fish together`;
  return 'Click to sit on the dock and cast: one calm cast an hour each';
}

/** Adult horses of the farm now (the riders' mounts). */
export function adultHorses(state, now = Number.MAX_SAFE_INTEGER) {
  let n = 0;
  for (const o of Object.values(state.farm.objects)) {
    if (typeof o.home === 'string' && RIDEABLE.has(o.def) && !(Number.isFinite(o.adultAt) && o.adultAt > now)) n++;
  }
  return n;
}

/** Ids of the animals a click on a home acts on (every occupant, sorted). */
export function occupants(state, t) {
  return t && t.kind === 'home' ? t.occupants : [];
}
