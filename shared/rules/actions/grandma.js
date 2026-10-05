// Grandma's visit (GDD §5.9 Restoration 6, §5.3 quest E10 "Grandma Comes Home"; M2; content: shared/content/
// farmhouse.js GRANDMA_VISIT). Owned by rules-goals.
//
// When the E10 card completes, Grandma Hazel arrives for GRANDMA_VISIT.stayMs (72 h): she strolls the farm, one stop
// every strollMs (porch, field, orchard, barnyard, bench, parlour, then again), and says her lines there (the render
// and UI lanes draw her from grandmaView). The story beat (`grandma_visits`) is E10's own reward and is queued per
// player like every beat; a Memory Book page is written when she arrives. Each farmer who plays while she is here has
// "met" her; when she leaves (`_grandma`, catch-up safe) she leaves her gift for the parlour wall (a furniture piece
// into the farmhouse tray, rules-economy's interior.giveFurniture; kept in `gift` when the room cannot take it) and
// her letter;
// a farmer who never met her gets GRANDMA_VISIT.missedCard on the leave event (`missed`). She comes once.
//
// farm.grandma = null | { at, until, met: { pid: 1 }, left: boolean, gift: furnitureId | null }
import { GRANDMA_VISIT } from '../../content/index.js';
import { systemLive, hasPlayer, playerIds } from '../coop.js';
import { feedAdd } from '../feed.js';
import { addPage } from './memory.js';
import { ERR } from '../../net/protocol.js';
import { giveFurniture } from './interior.js';

const G = GRANDMA_VISIT;

// How the farewell gift reaches the farmhouse: (tx, ctx, def) => true when the room took it. The economy's tray by
// default; tests may replace it. A hoisted `var` for the same load-order reason as progress.js setBloom.
/* eslint-disable no-var */
var FURNITURE_GIFT;
/* eslint-enable no-var */
/** Replace how the gift is handed over (null restores the economy's interior tray). */
export function setFurnitureGift(fn) { FURNITURE_GIFT = typeof fn === 'function' ? fn : undefined; }
const toTray = (tx, ctx, def) => (tx.state.farm.interior ? giveFurniture(tx, def, 1) === true : false);

/** True when the visit plays in this build. */
export const grandmaLive = () => systemLive(G);

/** She is on the farm at `now`. */
export const grandmaHere = (state, now) => {
  const g = state.farm.grandma;
  return Boolean(g && !g.left && now >= g.at && now < g.until);
};

/** Her arrival (quests.js, when GRANDMA_VISIT.quest completes): once ever. */
export function grandmaArrive(tx, ctx) {
  if (!grandmaLive() || !Object.hasOwn(tx.state.farm, 'grandma') || tx.state.farm.grandma) return;
  const until = ctx.now + G.stayMs;
  const met = {};
  if (hasPlayer(tx.state, ctx.pid)) met[ctx.pid] = 1;
  tx.set(['farm', 'grandma'], { at: ctx.now, until, met, left: false, gift: null });
  tx.emit({ e: 'grandmaArrived', until, by: ctx.pid });
  feedAdd(tx, { ...ctx, pid: 'sys' }, { k: 'grandma', what: 'arrived' });
  if (G.memory) addPage(tx, ctx, 'grandma', { by: 'sys', ref: 'arrived' });
}

/** A farmer played while she was here (processEvents, once per farmer). */
export function grandmaMeet(tx, ctx) {
  if (!grandmaHere(tx.state, ctx.now) || !hasPlayer(tx.state, ctx.pid)) return;
  if (tx.state.farm.grandma.met[ctx.pid]) return;
  tx.set(['farm', 'grandma', 'met', ctx.pid], 1);
}

/** True when `_grandma` has work: her stay ended. */
export const grandmaDue = (state, now) => {
  const g = state.farm.grandma;
  return Boolean(g && !g.left && now >= g.until);
};

/** The next moment `_grandma` gets work. */
export const grandmaNextAt = (state) => {
  const g = state.farm.grandma;
  return g && !g.left ? g.until : Infinity;
};

/** `_grandma {}`: she goes home, leaving her gift and her letter. */
export const _grandma = {
  schema: {},
  check(state, a, ctx) {
    return grandmaDue(state, ctx.now) ? null : ERR.ALREADY_DONE;
  },
  apply(tx, a, ctx) {
    const g = tx.state.farm.grandma;
    const def = G.gift?.furniture ?? null;
    const taken = def ? (FURNITURE_GIFT ?? toTray)(tx, ctx, def) === true : false;
    const missed = playerIds(tx.state).filter((p) => !g.met[p]);
    tx.set(['farm', 'grandma'], { ...tx.state.farm.grandma, left: true, gift: taken ? null : def });
    tx.emit({ e: 'grandmaLeft', gift: def, missed, by: ctx.pid });
    feedAdd(tx, { ...ctx, pid: 'sys' }, { k: 'grandma', what: 'left' });
  },
};

/**
 * Grandma for the render and the UI: { live, here, at, until, stop (GRANDMA_VISIT.stops id), i (stop index), line
 * (index into GRANDMA_VISIT.lines[stop], turning each stroll), nextAt (her next stop), left, met (this player met her),
 * missed (she left without this player meeting her), gift (a furniture piece still to hand over) } or null when she
 * never came.
 */
export function grandmaView(state, now, pid = null) {
  const g = state.farm.grandma;
  if (!g) return null;
  const here = grandmaHere(state, now);
  const k = Math.max(0, Math.floor((Math.min(now, g.until) - g.at) / G.strollMs));
  const i = k % G.stops.length;
  const stop = G.stops[i];
  const lines = G.lines?.[stop] ?? [];
  return { live: grandmaLive(), here, at: g.at, until: g.until, stop, i,
    line: lines.length ? Math.floor(k / G.stops.length) % lines.length : 0,
    nextAt: here ? Math.min(g.until, g.at + (k + 1) * G.strollMs) : null, left: g.left,
    met: pid !== null && Boolean(g.met[pid]), missed: pid !== null && g.left && !g.met[pid], gift: g.gift };
}
