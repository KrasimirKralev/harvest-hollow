// Social and personal-record actions (GDD §6.2 #2 notes, #17-#19 tours / welcome back / story beats, §7.4 farm
// naming, §6.1 named animals, §7.4 drip-feed cards). Owned by rules-goals.
//
//   noteAdd    { x, z, text }        pin a note to a tile for the partner (at most COOP.notes.maxOpen open)
//   noteDel    { id }                take a note down (either player: the farm is shared)
//   nameFarm   { name }              the farm's name (carved on the gate sign; who named it is recorded)
//   nameAnimal { id, name }          name an animal (farm.names; the tag records who named it; Name Game ribbon)
//   markSeen   { kind, id?, level? } per-player "seen" flags: kind 'level' (unlock tour seen up to `level`),
//                                    'card' (a system card `id`), 'beat' (a story beat `id`), 'tip' (a first-use tip),
//                                    'fair' (the County Fair ceremony of week `id`: farm.fair.last.seen[pid])
// Pings and emotes are presence (relayed by the server, never state); the tutorial's "say hello" step is marked
// by tutDone (tutorial.js).
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { CONTENT, COOP, DRIP_FEED, TUTORIAL, STORY_BEATS, isLive, levelFromXp, animalOf } from '../../content/index.js';
import { inWorld } from '../grid.js';
import { ceremonyQueue } from './fair.js';

const NAME_MAX = 24;

export const noteAdd = {
  schema: { x: V.tile, z: V.tile, text: V.text(COOP.notes.maxChars) },
  check(state, a) {
    if (!inWorld(a.x, a.z)) return ERR.OUT_OF_BOUNDS;
    return Object.keys(state.farm.notes).length >= COOP.notes.maxOpen ? ERR.CAP : null;
  },
  apply(tx, a, ctx) {
    const id = ctx.newId(0);
    tx.set(['farm', 'notes', id], { by: ctx.pid, at: ctx.now, text: a.text, x: a.x, z: a.z });
    tx.emit({ e: 'noted', id, x: a.x, z: a.z, by: ctx.pid });
  },
};

export const noteDel = {
  schema: { id: V.objId },
  check(state, a) {
    return Object.hasOwn(state.farm.notes, a.id) ? null : ERR.NOT_FOUND;
  },
  apply(tx, a, ctx) {
    tx.del(['farm', 'notes', a.id]);
    tx.emit({ e: 'unnoted', id: a.id, by: ctx.pid });
  },
};

export const nameFarm = {
  schema: { name: V.text(NAME_MAX) },
  check(state, a) {
    return state.farm.name === a.name ? ERR.ALREADY_DONE : null;
  },
  apply(tx, a, ctx) {
    const first = tx.get(['farm', 'coop', 'named']) === null;
    tx.set(['farm', 'name'], a.name);
    tx.set(['farm', 'coop', 'named'], { by: ctx.pid, at: ctx.now });
    tx.emit({ e: 'named', what: 'farm', text: a.name, first, by: ctx.pid });
  },
};

/**
 * Animal names live in farm.names = { [objId]: { name, by, at } } (the name tag records who named it), not on the
 * economy's animal record, so a name survives a move, a trash-and-restore and any change of the animal's shape.
 */
export const nameAnimal = {
  schema: { id: V.objId, name: V.text(16) },
  check(state, a) {
    const o = Object.hasOwn(state.farm.objects, a.id) ? state.farm.objects[a.id] : null;
    if (!o || !animalOf(o.def) || typeof o.home !== 'string') return ERR.NOT_FOUND;
    return state.farm.names[a.id]?.name === a.name ? ERR.ALREADY_DONE : null;
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    const first = !Object.hasOwn(tx.state.farm.names, a.id);
    tx.set(['farm', 'names', a.id], { name: a.name, by: ctx.pid, at: ctx.now });
    tx.emit({ e: 'named', what: 'animal', id: a.id, species: o.def, text: a.name, first, by: ctx.pid });
  },
};

// 'fair': the County Fair ceremony of week `id` (shown on both screens, queued for an absent partner: GDD §5.6)
// 'duel' (M2): this player saw the last Friendly Duel's result card (id = String(farm.duel.last.end))
const SEEN_KINDS = ['level', 'card', 'beat', 'tip', 'fair', 'duel'];

export const markSeen = {
  schema: { kind: V.oneOf(...SEEN_KINDS), id: V.opt(V.text(32)), level: V.opt(V.int(1, 999)) },
  check(state, a, ctx) {
    const seen = state.players[ctx.pid].seen;
    switch (a.kind) {
      case 'level':
        if (a.level === undefined || a.level > levelFromXp(state.farm.xp)) return ERR.BAD_ARGS;
        return a.level <= seen.lvl ? ERR.ALREADY_DONE : null;
      case 'card': {
        const f = a.id && CONTENT.features.get(a.id);
        if (!f || !isLive(f) || !f.card) return ERR.BAD_ARGS;
        return seen.cards[a.id] ? ERR.ALREADY_DONE : null;
      }
      case 'beat': {
        const b = a.id && STORY_BEATS.find((x) => x.id === a.id);
        if (!b || !isLive(b)) return ERR.BAD_ARGS;
        return seen.beats[a.id] ? ERR.ALREADY_DONE : null;
      }
      case 'tip':
        if (!a.id || !TUTORIAL.firstUse.some((t) => t.id === a.id)) return ERR.BAD_ARGS;
        return seen.tips[a.id] ? ERR.ALREADY_DONE : null;
      case 'fair': {
        const last = state.farm.fair?.last;
        if (ceremonyQueue(state, ctx.pid).some((c) => String(c.w) === a.id)) return null;
        if (!last || a.id !== String(last.w)) return ERR.NOT_FOUND;
        return last.seen[ctx.pid] ? ERR.ALREADY_DONE : null;
      }
      case 'duel': {
        const last = state.farm.duel?.last;
        if (!last || a.id !== String(last.end)) return ERR.NOT_FOUND;
        return last.seen[ctx.pid] ? ERR.ALREADY_DONE : null;
      }
      default:
        return ERR.BAD_ARGS;
    }
  },
  apply(tx, a, ctx) {
    const base = ['players', ctx.pid, 'seen'];
    if (a.kind === 'level') tx.set([...base, 'lvl'], a.level);
    else if (a.kind === 'card') {
      tx.set([...base, 'cards', a.id], 1);
      const play = tx.get(['players', ctx.pid, 'play']);
      if (play) tx.set(['players', ctx.pid, 'play', 'card'], play.n);
    } else if (a.kind === 'beat') tx.set([...base, 'beats', a.id], 1);
    else if (a.kind === 'fair') {
      const f = tx.state.farm.fair;
      if (String(f.last?.w) === a.id) tx.set(['farm', 'fair', 'last', 'seen', ctx.pid], 1);
      if (f.unseen && f.unseen[ctx.pid]) {
        tx.set(['farm', 'fair', 'unseen', ctx.pid], f.unseen[ctx.pid].filter((c) => String(c.w) !== a.id));
      }
    }
    else if (a.kind === 'duel') tx.set(['farm', 'duel', 'last', 'seen', ctx.pid], 1);
    else tx.set([...base, 'tips', a.id], 1);
    tx.emit({ e: 'seen', pid: ctx.pid, kind: a.kind, id: a.id ?? String(a.level) });
  },
};

/** Content and systems unlocked above the level this player last toured (their "3 new things" tour). */
export function unseenLevels(state, pid) {
  const L = levelFromXp(state.farm.xp);
  const from = (state.players[pid]?.seen?.lvl ?? 1) + 1;
  const out = [];
  for (let l = from; l <= L; l++) out.push(l);
  return out;
}

/** Extra conditions some system cards wait for (GDD §7.4 F3). */
function cardReady(state, pid, f) {
  switch (f.id) {
    case 'couple_challenge': return Boolean(state.farm.challenge?.cur);
    case 'mabel_meter': return Boolean(state.farm.orders?.meter);
    case 'almanac': return (state.players[pid]?.almanac?.d ?? -1) >= 0;
    default: return true;
  }
}

/**
 * The next system card this player should see, or null (GDD §7.4 drip-feed: at most one new SYSTEM card per
 * DRIP_FEED.minGapMs of this player's play; cards that unlock sooner wait in a queue, oldest unlock first).
 */
export function nextSystemCard(state, pid) {
  const p = state.players[pid];
  if (!p || !p.seen || !p.play) return null;
  const L = levelFromXp(state.farm.xp);
  const gapMin = Math.floor(DRIP_FEED.minGapMs / 60_000);
  const anySeen = Object.keys(p.seen.cards).length > 0;
  if (anySeen && p.play.n - p.play.card < gapMin) return null;
  for (const f of [...CONTENT.features.values()].sort((x, y) => x.unlock - y.unlock)) {
    if (!isLive(f) || !f.card || f.unlock > L || p.seen.cards[f.id] || !cardReady(state, pid, f)) continue;
    return f.id;
  }
  return null;
}

