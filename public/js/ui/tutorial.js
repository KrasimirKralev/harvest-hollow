// The first evening (GDD §7.4): Grandma's coach bubble with the current step of this player's track (Fields or
// Barnyard), the shared together steps, a bouncing pointer into the 3D world (view.toScreen, an edge arrow when
// off-screen) or onto the HUD button to press, and the per-player first-use tips (5 s, non-blocking). The progress lives
// in the rules (rules-goals: players[pid].tut, farm.tut; actions tutDone, tutSkip, tutSwap, markSeen 'tip'); this
// module only shows it. ui-shell lane.
//
// Release 1.0 (M1a, M8; ux-first#1, #8, #11, #12): ONE guide voice. The first instruction is planting (the welcome card
// and the naming gate are gone: naming is a chip on the coach card after the first harvest); a first-use tip that names
// the coach step's tool waits; the coach retires at farm L6 or after 45 minutes of this farmer's play; a farmer who
// finished their tracks gets the together steps (a pid in farm.tut.fin is finished, not skipped); the card is one line
// and a progress bar.
//
//   coachStep(state, pid) -> { step, list: 'track'|'together', track, have, need, waiting?, startOpen? } | null  (pure)
//   coachVisible() -> boolean      the coach card is on screen now (features' tracker mirrors or hides while it speaks;
//                                  window event 'hh:coach' { visible, step } when it changes)
//   coachRetired(state, pid) -> boolean   farm L6 or 45 min of play (TUTORIAL.retire) (pure)
//   targetOf(state, step, now, opts?) -> { tile?: {x, z}, id?, ui?: selector } | null                    (pure)
//   pointOf(tile) -> { x, z }     a target tile's middle in view.toScreen's continuous coordinates (pure)
//   lineKeyOf(coachStep, tool?) -> 'dock.coach.firstSeed' | 'dock.coach.harvestSeeding' | null   the coach's own line
import { assetUrl } from '../net/asset-base.js';
import { TUTORIAL, levelFromXp, xpForLevel, CONTENT, defOf } from '../../../shared/content/index.js';
import { ACTIONS } from '../../../shared/rules/index.js';
import { currentStep, currentFarmStep, stepWords } from '../../../shared/rules/actions/tutorial.js';
import { sortedKeys } from '../../../shared/rules/order.js';
import { footprint } from '../../../shared/rules/grid.js';
import { h, kv, touchPlayer, touchText } from './dom.js';
import { goalText } from './goal-text.js';
import { LAYOUT_Q } from './layout.js';
import { t as tr, lang, ctext } from '../i18n/index.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// track -> catalog key ('moments.track.*')
const TRACK_LABEL = { fields: 'fields', barnyard: 'barnyard', together: 'together', start: 'start', choose: 'choose' };
/** A guide step's words in the language in effect (TUTORIAL is content: lane C translates it, i18n/bg/text-c.js
 *  TUTORIAL['step.<id>'].text and TUTORIAL['firstUse.<id>'].text). */
// QA r3 F3-10 (features' stepWords): the words that depend on the farm now (the flour step once the Windmill stands, and
// on a farm of one) come from the rules, the same call the tracker's mirror of the coach makes
export const stepText = (step, state = null) => {
  if (step.id === 'choose') return tr('moments.coach.choose');
  const w = state ? stepWords(state, step) : null;
  return w ? goalText(w) : ctext('TUTORIAL', `step.${step.id}`, 'text', step.text);
};

/**
 * The farm still has no name and is new (GDD §7.4; QA2 UI-14: an old save re-joined at L5+ is never asked). Release 1.0
 * (M1a, ux-first#11): naming is never the first step; the coach offers it as a chip after the first harvest. Pure.
 */
export const NAMING_MAX_LEVEL = 5;
export function namingDue(state) {
  return Boolean(state && state.farm && !state.farm.coop?.named && levelFromXp(state.farm.xp) < NAMING_MAX_LEVEL);
}

/** Has this farm harvested anything yet (the naming chip comes after the first harvest)? Pure. */
export function harvestedOnce(state) {
  const st = state?.farm?.stats;
  if (!st) return false;
  return Object.keys(st).some((k) => k.startsWith('harvest.') && Number(st[k]) > 0);
}

/** Grandma's coach retires at farm L6 or after 45 minutes of this farmer's play (TUTORIAL.retire, M1a). Pure. */
export function coachRetired(state, pid) {
  const p = state?.players?.[pid];
  if (!p) return true;
  const R = TUTORIAL.retire ?? { level: 6, playMin: 45 };
  return levelFromXp(state.farm.xp) >= R.level || (p.play?.n ?? 0) >= R.playMin;
}

/** Did `pid` finish a track (farm.tut.fin)? Such a farmer is finished, not skipped (M8). Pure. */
const finished = (state, pid) => Object.values(state.farm.tut?.fin ?? {}).includes(pid);

/**
 * The together steps only a present partner can finish (QA r1 S-05, fbp#6): pinging them, sitting on the bench with
 * them. GDD §7.4 shows the partner cue only "if both online".
 */
export const PARTNER_STEPS = new Set(['say_hello', 'golden_hour']);

/**
 * Is a partner here for a partner step? Another farmer claimed the farm and (when the caller knows it) is online now.
 * `partnerOnline`: true / false from the presence dots, undefined when unknown (a claimed partner counts). Pure.
 */
export function partnerHere(state, pid, { partnerOnline } = {}) {
  const claimed = Object.keys(state.players ?? {}).some((p) => p !== pid);
  return claimed && partnerOnline !== false;
}

/** The farm's together step (the shared list), whether or not the start steps were ever ticked. Pure. */
function togetherStep(state, pid, opts) {
  const ft = state.farm.tut;
  if (!ft || !(ft.t < TUTORIAL.together.length)) return null;
  const step = TUTORIAL.together[ft.t];
  // a partner step waits, silent, until the partner is here: it comes back when they join (S-05)
  return PARTNER_STEPS.has(step.id) && !partnerHere(state, pid, opts) ? null : step;
}

/**
 * The step the coach shows this player (release 1.0): their track, then the together steps. Never the welcome or the
 * naming card (naming is a chip, M1a). A farmer with no track yet is taught to plant (the first deed of either track
 * still picks it); the Barnyard's first step when the partner holds the Fields. `startOpen`: the farm's start steps
 * (welcome, name the farm) were never ticked, so the together step waits on them; the coach ticks them (tutDone).
 * `opts.partnerOnline` (the presence dots): a partner step (say_hello, golden_hour) shows only with the partner here. Pure.
 */
export function coachStep(state, pid, opts = {}) {
  const me = state.players[pid];
  if (!me || !state.farm.tut) return null;
  if (coachRetired(state, pid)) return null;
  const level = levelFromXp(state.farm.xp);
  const open = (s) => !s.level || level >= s.level;
  const t = me.tut;
  const done = finished(state, pid);
  if (t && t.skip && !t.track && !done) return null;                 // "I know farming": no more coaching for me
  const own = currentStep(state, pid);
  const ft = state.farm.tut;
  const startOpen = ft.s < TUTORIAL.start.length;
  if (t && !t.skip && !t.track) {
    // not assigned yet: the first deed of either track picks it ("auto-assigned by who acts first"); the coach teaches
    // planting first, the animals when the partner already holds the fields
    const held = (tr0) => Object.entries(state.players).some(([p, x]) => p !== pid && x.tut?.track === tr0);
    const track = !ft.fin.fields && !held('fields') ? 'fields' : !ft.fin.barnyard && !held('barnyard') ? 'barnyard' : null;
    if (track) {
      const step = TUTORIAL[track][0];
      return { step, list: 'track', track, have: 0, need: step.task ? step.task.qty : 1, unassigned: true };
    }
  }
  const together = togetherStep(state, pid, opts);
  if (own && open(own)) return { step: own, list: 'track', track: t.track, have: t.n || 0, need: own.task ? own.task.qty : 1 };
  if (together && open(together)) {
    return { step: together, list: 'together', track: 'together', have: startOpen ? 0 : ft.n || 0, need: together.task ? together.task.qty : 1, startOpen };
  }
  if (own) return { step: own, list: 'track', track: t.track, have: t.n || 0, need: own.task ? own.task.qty : 1, waiting: own.level };
  if (together && (done || (t && !t.skip))) {
    return { step: together, list: 'together', track: 'together', have: 0, need: 1, waiting: together.level, startOpen };
  }
  return null;
}

// the coach card on screen now (a module flag: one HUD per page), for features' tracker and life-feel's drip display
let coachShown = false;
/** Is Grandma's coach card on screen now? */
export const coachVisible = () => coachShown;
function setShown(on, step = null) {
  if (coachShown === Boolean(on)) return;
  coachShown = Boolean(on);
  try { globalThis.dispatchEvent?.(new CustomEvent('hh:coach', { detail: { visible: coachShown, step } })); } catch { /* no window */ }
}

/** Centre tile (float) of an object's footprint. Pure. */
export function tileCentreOf(state, id) {
  const o = state.farm.objects[id];
  if (!o || !Number.isFinite(o.x)) return null;
  const d = defOf(o.def);
  const [w, dd] = d && d.size ? footprint(d, o.rot || 0) : [1, 1];
  return { x: o.x + (w - 1) / 2, z: o.z + (dd - 1) / 2 };
}

/**
 * The coach's own words for a moment the content's step text does not fit, or null: before the first seed the Hand
 * holds none, so "Drag across the plots" cannot work yet; a click on a plot opens the seed picker (M2). Astra's
 * critique of the first frame: nothing said which tap comes first. FT-4: a seed in the Hand still harvests. Pure.
 */
export function lineKeyOf(c, tool = null) {
  if (!c || c.waiting) return null;
  if (c.step.id === 'plant_wheat' && (c.have ?? 0) === 0) return 'dock.coach.firstSeed';
  if (c.step.id === 'harvest_wheat' && tool && tool.id === 'hand' && tool.seeding) return 'dock.coach.harvestSeeding';
  return null;
}

/**
 * The screen-space point of a target tile: view.toScreen takes continuous tile coordinates, where tile (x, z) spans
 * x..x+1, so its middle is +0.5 (tileCentreOf gives the middle tile's index). Without it the arrow and its halo sat half
 * a tile up and left of the plot, on the fence (the release shots; Astra's critique). Pure.
 */
export const pointOf = (tile) => (tile ? { x: tile.x + 0.5, z: tile.z + 0.5 } : null);

/**
 * A point on object `id` (continuous tile x, z and a height y in metres) where the farm's own pick finds that object, for
 * the arrow to point at (QA r3 S3-01, fbp#1: the Coop's middle picked the Feed Mill standing in front of it, so four taps
 * under the arrow opened the mill). The middle first (the arrow's usual point), then up the building, then towards its
 * corners. `see`: { toScreen(x, z, y) -> { x, y, visible }, pickAt(sx, sy) -> pick | null }. Without a pick, or when no
 * point finds it, the middle. Pure.
 */
export function pickablePoint(state, id, see = null) {
  const c = tileCentreOf(state, id);
  if (!c) return null;
  const mid = { ...pointOf(c), y: 0.3 };
  if (!see || typeof see.toScreen !== 'function' || typeof see.pickAt !== 'function') return mid;
  const o = state.farm.objects[id];
  const d = defOf(o.def);
  const [w, dd] = d && d.size ? footprint(d, o.rot || 0) : [1, 1];
  const pts = [mid, { ...mid, y: 1.2 }, { ...mid, y: 2.2 }, { ...mid, y: 3.2 }];
  for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    for (const y of [0.6, 1.6]) pts.push({ x: mid.x + fx * (w / 2 - 0.4), z: mid.z + fz * (dd / 2 - 0.4), y });
  }
  for (const p of pts) {
    const s = see.toScreen(p.x, p.z, p.y);
    if (!s || s.visible === false || !Number.isFinite(s.x)) continue;
    const hit = see.pickAt(s.x, s.y);
    if (hit && hit.id === id) return p;
  }
  return mid;
}

function findObj(state, pred) {
  const objs = state.farm.objects;
  for (const id of sortedKeys(objs)) {
    const o = objs[id];
    if (Number.isFinite(o.x) && pred(o, id)) return id;
  }
  return null;
}

/**
 * The debris a "clear the yard" step should point at (release 1.0 M9, ux-first#9): the clearable piece (the Hand pulls
 * it) nearest the screen centre that is on screen and outside every HUD rectangle; weeds before rocks. `see`:
 * { toScreen(x, z, y) -> { x, y, visible }, w, h, hud: [{ left, top, right, bottom }] }. Without a view (or nothing on
 * screen): the first by id, so the edge arrow still turns toward one. Pure.
 */
export function debrisTarget(state, see = null) {
  const ids = sortedKeys(state.farm.objects).filter((id) => {
    const o = state.farm.objects[id];
    const d = Number.isFinite(o.x) ? CONTENT.debris.get(o.def) : null;
    return d && (o.def === 'weed' || d.tool === 'hand' || !d.tool);
  });
  if (!ids.length) return null;
  const weedFirst = (list) => [...list.filter((id) => state.farm.objects[id].def === 'weed'), ...list.filter((id) => state.farm.objects[id].def !== 'weed')];
  if (!see || typeof see.toScreen !== 'function') return weedFirst(ids)[0];
  const inside = (p, r) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  const m = 24;
  let best = null;
  for (const id of ids) {
    const c = tileCentreOf(state, id);
    if (!c) continue;
    const at = pointOf(c);
    const p = see.toScreen(at.x, at.z, 0.3);
    if (!p || p.visible === false || p.x < m || p.y < m || p.x > see.w - m || p.y > see.h - m) continue;
    if ((see.hud || []).some((r) => inside(p, r))) continue;
    const weed = state.farm.objects[id].def === 'weed' ? 0 : 1;
    const d = Math.hypot(p.x - see.w / 2, p.y - see.h / 2);
    if (!best || weed < best.weed || (weed === best.weed && d < best.d)) best = { id, d, weed };
  }
  return best ? best.id : weedFirst(ids)[0];
}

/**
 * The build step's HUD chain (QA r1 S-02, fbp#3): the piece's card in the open build tray, else the dock's Build
 * (desktop), else Build in the phone's open tool pop-up, else the phone's tool slot that opens that pop-up. A phone has
 * no Build in the Farm book: the arrow used to fall back on it.
 */
const buildUi = (def) => `.build-card[data-def="${def}"], [data-dock="build"], #tools-flyout [data-act="build"], [data-slot="tool"]`;

/**
 * The first shown element of a selector chain (`sel`, comma separated, in order of preference). A tool folded into a
 * slot (the Tools flyout, the phone's one slot) gives its slot (`slotOf`); a dock or together button folded into the
 * Farm book gives the book's button. `root`: a document (tests pass a fake one).
 */
export function uiTargetOf(sel, { root = globalThis.document, slotOf = null } = {}) {
  if (!sel || !root) return null;
  const shown = (el) => Boolean(el && el.getClientRects().length);
  let tucked = false;
  for (const s of sel.split(',')) {
    const el = root.querySelector(s.trim());
    if (shown(el)) return el;
    if (el && el.dataset?.tool && slotOf) { const slotEl = slotOf(el.dataset.tool); if (shown(slotEl)) return slotEl; }
    if (el && el.closest('#dock, .dock-minis, #social')) tucked = true;
  }
  // phones and tablets keep the minis and the together buttons in the Farm book: point at its button instead
  const menu = tucked ? root.getElementById('m-menu-btn') : null;
  return shown(menu) ? menu : null;
}

/** Where the pointer goes for a step. Pure (UI selectors are strings). `see`: debrisTarget's view facts. */
export function targetOf(state, step, now, see = null) {
  if (!step) return null;
  const at = (id) => (id ? { id, tile: tileCentreOf(state, id) } : null);
  switch (step.id) {
    case 'choose':
    case 'plant_wheat': return at(findObj(state, (o) => o.def === 'plot' && !o.crop)) || { ui: '[data-tool="seed"], [data-tool="seed_bag"]' };
    case 'harvest_wheat': return at(findObj(state, (o) => o.def === 'plot' && o.crop && o.crop.readyAt <= now))
      || at(findObj(state, (o) => o.def === 'plot' && o.crop));
    case 'sell_wheat': return { ui: '[data-dock="market"]', ...(at(findObj(state, (o) => o.def === 'market_stand')) || {}) };
    case 'first_order': return { ui: '[data-dock="orders"]', ...(at(findObj(state, (o) => o.def === 'order_board')) || {}) };
    case 'clear_weeds': return at(debrisTarget(state, see));
    case 'place_coop': return { ui: buildUi('coop') };
    case 'place_feed_mill': return { ui: buildUi('feed_mill') };
    case 'apple_tree': return { ui: buildUi('apple_tree') };
    case 'make_feed': return at(findObj(state, (o) => o.def === 'feed_mill'));
    case 'feed_hens': return at(findObj(state, (o) => o.def === 'coop'));
    // no Windmill yet: its free card in the build tray, the way the Coop is taught (QA r2 S-01, fbp#1, jde#3)
    case 'flour_together': return at(findObj(state, (o) => o.def === 'mill')) || { ui: buildUi('mill') };
    case 'say_hello': return { ui: '#social .social-btn, #together-btn' };
    // the waiting filler (S-03): a ripe plot to harvest, else an empty one to plant, else the one that ripens first
    case 'grow': return at(findObj(state, (o) => o.def === 'plot' && o.crop && o.crop.readyAt <= now && !o.crop.giant))
      || at(findObj(state, (o) => o.def === 'plot' && !o.crop))
      || at(sortedKeys(state.farm.objects).filter((id) => state.farm.objects[id].def === 'plot' && state.farm.objects[id].crop
        && Number.isFinite(state.farm.objects[id].x))
        .sort((a, b) => state.farm.objects[a].crop.readyAt - state.farm.objects[b].crop.readyAt)[0] ?? null);
    case 'golden_hour': return at(findObj(state, (o) => o.def === 'sunset_bench'));
    default: return null;
  }
}

/**
 * What the coach says while her step waits for a farm level (QA r1 S-03, fbp#4, jde#11): not the step with "(when the
 * farm reaches level 2)" and no arrow (a ~105 s stall), but the deed that gets there, its XP to go as the progress bar,
 * and the arrow on the field. null when the step does not wait. Pure.
 */
export function waitingFiller(state, c, now) {
  if (!c || !c.waiting) return null;
  const xp = Number(state.farm.xp) || 0;
  const from = xpForLevel(levelFromXp(xp));
  const to = xpForLevel(c.waiting);
  return { key: 'dock.coach.grow', params: { level: c.waiting, n: Math.max(1, to - xp) },
    have: Math.max(0, xp - from), need: Math.max(1, to - from), target: targetOf(state, { id: 'grow' }, now) };
}

/**
 * The screen box of the pointer's arrow drawn at (x, y) turned by `deg` (shell.css .pointer .arrow: 48 x 64 px whose
 * tip is the point, turned about it), with its bob (point-bob lifts it 12 px away from the tip: QA r2 S-09, the arrow
 * at the top of its bob touched the tile above). Pure.
 */
export function arrowBox(x, y, deg = 0) {
  const a = (deg * Math.PI) / 180;
  const pts = [[-24, -88], [24, -88], [-24, -12], [24, -12]].map(([px, py]) => [x + px * Math.cos(a) - py * Math.sin(a), y + px * Math.sin(a) + py * Math.cos(a)]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}
/** Do two screen boxes overlap (with `pad` px of room)? Pure. */
/**
 * The next room over a phone's bar for the coach arrow (css/mobile.css --tut-room): the room grows by the overlap of the
 * arrow on her card, capped at 220 px. Over the bar it grows again only once the last growth has landed (`landed()`:
 * the bar's margin shows it). Until then her card has not moved, and adding the same overlap on every 500 ms re-measure
 * stacked the room to the cap (verify-1 W-1: an iPhone 13 with reduced motion after a harvest stroke left her card
 * mid-screen, 156 px above the arrow). Returns `room` unchanged when there is nothing to grow.
 */
export function nextRoom(room, roomOf, over, landed = () => true) {
  if (over <= 0) return room;
  if (room && roomOf === 'bar' && !landed()) return room;
  return Math.min(220, (room || (roomOf === 'bar' ? 66 : 0)) + over);
}
export const overlaps = (a, b, pad = 4) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * The arrow's ways round a HUD target `r` (its tip just off the target's edge): from above (pointing down), from the
 * right, from the left, from below. Pure.
 */
export function sideWays(r, order = ['above', 'right', 'left', 'below']) {
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const W = { above: [cx, r.top - 4, 0], right: [r.right + 4, cy, 90], left: [r.left - 4, cy, -90], below: [cx, r.bottom + 4, 180] };
  return order.map((k) => W[k]);
}

/**
 * The first of `ways` ([x, y, deg]: the tip and the turn) whose arrow box stays on screen (`view` { w, h }) and clear of
 * every obstacle (Grandma's card, the target's neighbours), else the one that covers the least of them (QA r2 S-08,
 * S-09: the arrow lay on her "⋯" and her words, and on the tile next to the one it meant). Pure.
 */
export function arrowWay(ways, obstacles, view) {
  let best = null;
  for (const w of ways) {
    const b = arrowBox(w[0], w[1], w[2]);
    const off = b.left < 0 || b.top < 0 || b.right > view.w || b.bottom > view.h;
    const hits = obstacles.filter((o) => o && overlaps(b, o, 2));
    if (!off && !hits.length) return w;
    const score = hits.reduce((s, o) => s + Math.max(1, area(b, o)), 0) + (off ? 1e7 : 0);
    if (!best || score < best.score) best = { w, score };
  }
  return best ? best.w : null;
}

/**
 * The edge arrow's tip for a target off screen at `s` (screen px), turned toward it, inside the screen by `m` and above
 * Grandma's card (QA r2 S-08: at 360 the edge arrow hid "кокошки"), wherever the card stands: an open tray or the
 * phone's pop-up lifts it to mid-screen (QA r3 S3-04, fbp#5: the arrow was drawn inside her card). Pure.
 */
export function edgeTip(s, W, H, m = 70, card = null) {
  const low = card && card.width && card.top > m + 40 ? card.top - 20 : null;
  const top = m;
  const bottom = low !== null ? Math.max(top + 40, low) : H - m;
  const cx = W / 2;
  const cy = (top + bottom) / 2;
  const dx = s.x - cx;
  const dy = s.y - cy;
  const k = Math.min((W / 2 - m) / Math.max(1, Math.abs(dx)), ((bottom - top) / 2) / Math.max(1, Math.abs(dy)));
  return [cx + dx * k, cy + dy * k, Math.atan2(dy, dx) * (180 / Math.PI) - 90];
}

/** The edge arrow's tip moved 40-80 px off any object but target `id` (QA r4 S4-04: a boulder); null: none clear. Pure. */
export function edgeClear([x, y, deg], { cx, cy, b }, pickAt, id) {
  const other = (px, py) => { const p = pickAt(px, py); return Boolean(p && p.kind === 'object' && p.id !== id); };
  const d = Math.hypot(cx - x, cy - y) || 1;
  const [ux, uy] = [(cx - x) / d, (cy - y) / d];
  for (const [a, k] of [[0, 0], [0, 40], [0, -40], [40, 0], [0, 80], [0, -80], [80, 0], [40, 40], [40, -40]]) {
    const px = x + ux * a - uy * k;
    const py = y + uy * a + ux * k;
    if (px >= b.l && px <= b.r && py >= b.t && py <= b.b && !other(px, py)) return [px, py, deg];
  }
  return null;
}

/** Her card's top from the screen's foot at rest: the stack's stagger-in `translate` taken out (S4-03). Pure. */
export function coachUpAt(vh, top, tr) {
  const y = /^\S+\s+(-?[\d.]+)px/.exec(tr || '');
  return Math.round(vh - top + (y ? Number(y[1]) : 0));
}

/**
 * While a harvest step's crop is still growing (none ripe yet): the ms until the first one ripens, else null (QA r1
 * S-18: the step showed at 0/6 for a minute with no word of when). Pure.
 */
export function ripeEta(state, step, now) {
  const task = step?.task;
  if (!task || task.verb !== 'harvest') return null;
  let soonest = Infinity;
  for (const o of Object.values(state.farm.objects)) {
    if (o.def !== 'plot' || !o.crop || (task.ref && o.crop.def !== task.ref)) continue;
    if (o.crop.readyAt <= now) return null;                // one is ripe already: the arrow says where
    soonest = Math.min(soonest, o.crop.readyAt);
  }
  return Number.isFinite(soonest) ? soonest - now : null;
}
/**
 * A "make" step whose job is queued (QA r2 S-06, fbp#2: "Make Chicken Feed from 3 Wheat" stayed word for word for the
 * whole 5-minute job, and a first-timer queued a second feed): { ms } until the first job of the step's recipe is
 * done, { ready: true } when one is done and waits to be collected, else null (nothing queued). Pure.
 */
export function makeEta(state, step, now) {
  const task = step?.task;
  if (!task || task.verb !== 'make' || !task.ref) return null;
  let soonest = Infinity;
  for (const o of Object.values(state.farm.objects)) {
    for (const q of Array.isArray(o.queue) ? o.queue : []) {
      if (q.r !== task.ref) continue;
      if (q.e <= now) return { ready: true };
      soonest = Math.min(soonest, q.e);
    }
  }
  return Number.isFinite(soonest) ? { ms: soonest - now } : null;
}
/** m:ss for a countdown under an hour ("0:42"), else h:mm:ss. Pure. */
export function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
const stepOf = (id) => [...TUTORIAL.fields, ...TUTORIAL.barnyard, ...TUTORIAL.together].find((s) => s.id === id) ?? null;

/** Grandma Hazel's portrait from her content style (inline SVG, GDD: NPC portraits are inline SVG). */
/** Grandma Hazel's painted portrait (art lane), the drawn SVG when it cannot load. */
export function grandmaPortrait(size = 60) {
  if (typeof document === 'undefined') return grandmaSvg(size);
  const img = document.createElement('img');
  img.className = 'grandma-art';
  img.src = assetUrl(`/assets/art/npc/${size <= 64 ? 'hazel_face' : 'hazel_128'}.webp`);
  img.width = size;
  img.height = size;
  img.alt = tr('moments.coach.grandma');
  img.decoding = 'async';
  img.draggable = false;
  img.style.cssText = 'border-radius:50%;object-fit:cover;flex:none;background:#F3E6CF;box-shadow:0 0 0 2px #FFF8E6,0 0 0 4px #8A5A2B';
  img.addEventListener('error', () => img.replaceWith(grandmaSvg(size)), { once: true });
  return img;
}

export function grandmaSvg(size = 60) {
  const p = CONTENT.npcs.get('hazel')?.portrait
    || { skin: '#F2D3B8', hair: '#E8E4DC', outfit: '#7E9C6B', accent: '#E9B44C' };
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('gran');
  const ink = '#3E2612';
  const parts = [
    ['circle', { cx: 32, cy: 32, r: 30, fill: '#FFF4D6', stroke: '#D9B677', 'stroke-width': 2.5 }],
    ['path', { d: 'M10 60c2-12 11-18 22-18s20 6 22 18z', fill: p.outfit, stroke: ink, 'stroke-width': 2 }],
    ['path', { d: 'M26 44l6 6 6-6', fill: 'none', stroke: p.accent, 'stroke-width': 3, 'stroke-linecap': 'round' }],
    ['circle', { cx: 32, cy: 10, r: 6.5, fill: p.hair, stroke: ink, 'stroke-width': 2 }],
    ['ellipse', { cx: 32, cy: 29, rx: 13.5, ry: 14.5, fill: p.skin, stroke: ink, 'stroke-width': 2 }],
    ['path', { d: 'M18.5 27c0-9 6-13.5 13.5-13.5S45.5 18 45.5 27c-3-4-8-6-13.5-6s-10.5 2-13.5 6z', fill: p.hair, stroke: ink, 'stroke-width': 2, 'stroke-linejoin': 'round' }],
    ['circle', { cx: 26.5, cy: 30, r: 4.6, fill: 'rgba(255,255,255,.35)', stroke: ink, 'stroke-width': 1.8 }],
    ['circle', { cx: 37.5, cy: 30, r: 4.6, fill: 'rgba(255,255,255,.35)', stroke: ink, 'stroke-width': 1.8 }],
    ['path', { d: 'M31 30h2', stroke: ink, 'stroke-width': 1.8 }],
    ['circle', { cx: 26.5, cy: 30.5, r: 1.4, fill: ink }],
    ['circle', { cx: 37.5, cy: 30.5, r: 1.4, fill: ink }],
    ['circle', { cx: 23, cy: 36.5, r: 2.6, fill: '#F49A9A', 'fill-opacity': '.6' }],
    ['circle', { cx: 41, cy: 36.5, r: 2.6, fill: '#F49A9A', 'fill-opacity': '.6' }],
    ['path', { d: 'M28 37.5c2.2 2.2 5.8 2.2 8 0', fill: 'none', stroke: ink, 'stroke-width': 1.8, 'stroke-linecap': 'round' }],
  ];
  for (const [tag, attrs] of parts) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}

function arrowSvg(color = '#FFC83D') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 64');
  svg.classList.add('arrow');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M14 4h20v30h11L24 60 3 34h11z');
  path.setAttribute('fill', color);
  path.setAttribute('stroke', '#3E2612');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('stroke-linejoin', 'round');
  const shine = document.createElementNS(SVG_NS, 'path');
  shine.setAttribute('d', 'M19 8v24');
  shine.setAttribute('stroke', '#fff');
  shine.setAttribute('stroke-opacity', '.6');
  shine.setAttribute('stroke-width', '3');
  shine.setAttribute('stroke-linecap', 'round');
  svg.append(path, shine);
  return svg;
}

/** A panel's first-use tip counts as seen once it has been on screen this long (QA r3 S3-12). */
export const PANEL_TIP_SEEN_MS = 2000;

/**
 * A panel's first-use tip as a strip inside the panel, between its tabs and its body, with its own ✕ (QA r3 S3-12, jde#5,
 * oib#2: the tip went into the coach column under the modal sheet, z 10 under z 40, and was marked seen before anyone
 * could read it; 16 panels). `onSeen` runs once the strip has stayed `PANEL_TIP_SEEN_MS` (a sheet closed sooner leaves
 * the tip for its next open). Returns the strip, or null when the frame has no body. DOM only, no store.
 */
export function mountPanelTip(frame, { label, words, closeLabel, onSeen = null, setTimer = setTimeout } = {}) {
  const scroll = frame?.querySelector?.('.hh-panel-scroll');
  if (!scroll) return null;
  frame.querySelector('.panel-tip')?.remove();
  // the ✕ is a read: the tip counts as seen (else it came back on the next open of the panel)
  let seen = false;
  const markSeen = () => { if (!seen) { seen = true; onSeen?.(); } };
  const x = h('button.panel-tip-x', { type: 'button', 'aria-label': closeLabel, on: { click: () => { markSeen(); el.remove(); } } }, '✕');
  const el = h('div.hint.panel-tip', { role: 'status' }, h('span.panel-tip-t', h('b', label), ' ', words), x);
  frame.insertBefore(el, scroll);
  const arm = () => setTimer(() => { if (el.isConnected && el.parentNode === frame && !frame.hidden && !el.hidden) markSeen(); }, PANEL_TIP_SEEN_MS);
  // it shows on the panel's first tab only (QA r4 S4-15: the Market's selling tip stood over Seeds and Decor); el.onTab(id)
  const own = frame.querySelector('.hh-tabs [role="tab"]')?.dataset.tab;
  el.onTab = (id) => { const was = el.hidden; el.hidden = Boolean(own) && id !== own; if (was && !el.hidden) arm(); };
  el.hidden = Boolean(own) && frame.querySelector('.hh-tabs [aria-selected="true"]')?.dataset.tab !== own;
  arm();
  return el;
}

/** Content tool id of a first-use tip id ('seed_bag', 'sickle', ...): the tips of tools carry the tool's own id. */
const TIP_TOOL = { seed_bag: 'seed_bag', sickle: 'sickle', feed_scoop: 'feed_scoop', watering_can: 'watering_can', hammer: 'hammer' };

/**
 * Is a first-use tip due now (M1a)? Not while the coach's current step teaches with that same tool (the coach says it
 * already; ux-first#1: "a Tip says the same thing a third time"). `hidden`: the player hid the coach. Pure.
 */
export function tipDue(state, pid, id, { hidden = false } = {}) {
  const tool = TIP_TOOL[id];
  if (!tool || hidden) return true;
  const c = coachStep(state, pid);
  return !(c && !c.waiting && c.step.tool === tool);
}

export function createTutorial(S) {
  const { store, view, ui } = S;
  const touchMq = globalThis.matchMedia?.(LAYOUT_Q.touch) ?? null;
  const landMq = globalThis.matchMedia?.(LAYOUT_Q.land) ?? null;
  const layer = document.getElementById('pointers');
  const slot = document.getElementById('coach-slot');
  let coach = null;
  let coachKey = '';
  let pointer = null;          // { el, target, until? }
  let spot = null;             // the HUD element with .ui-spot
  let flashT = 0;
  let hint = null;
  let menuOpen = false;
  const hiddenKey = () => `hh.coach.hidden.${store.pid}`;
  // the first-use tip of a tool sits on the open tray (its header), not in a third box over the field (UI-07)
  const trayTip = h('div.tray-tip', { role: 'status', hidden: true });
  document.getElementById('seed-tray')?.before(trayTip);

  // ---- pointer ------------------------------------------------------------------------------------------------
  function setPointer(target) {
    if (spot) { spot.classList.remove('ui-spot'); spot = null; }
    if (!target) { if (pointer) { pointer.el.remove(); pointer = null; } document.body.classList.remove('tut-bar', 'coach-aside', 'tut-fly', 'tut-tray'); roomFor(null); return; }
    if (!pointer) {
      const el = h('div.pointer', h('div.halo'));
      el.prepend(arrowSvg());
      // the edge arrow takes a tap: the camera goes to what it points at (QA r4 S4-04)
      el.addEventListener('click', () => { const t = pointer?.target; if (el.classList.contains('edge') && t?.tile) { const a = aimOf(t); view.focus(a.x, a.z); } });
      layer.append(el);
      pointer = { el, target };
    }
    pointer.target = target;
    place();
  }
  const uiTarget = (sel) => uiTargetOf(sel, { root: document, slotOf: S.toolbar?.slotOf ?? null });
  function place() {
    if (!pointer) return;
    const t = pointer.target;
    const el = pointer.el;
    const uiEl = t.ui ? uiTarget(t.ui) : null;
    if (uiEl && (!t.tile || t.preferUi !== false)) {
      if (spot !== uiEl) {
        spot?.classList.remove('ui-spot'); spot = uiEl; spot.classList.add('ui-spot');
        // the step's card in a tray that scrolls (the free Coop, third of many): into the tray's view, once, so the
        // arrow lands on it and not on the tray's "›" (QA r1 S-09)
        const strip = uiEl.closest('#build-tray, #seed-tray');
        if (strip) {
          const sr = strip.getBoundingClientRect();
          const cr = uiEl.getBoundingClientRect();
          if (cr.left < sr.left + 28 || cr.right > sr.right - 28) strip.scrollLeft += cr.left + cr.width / 2 - (sr.left + sr.width / 2);
        }
      }
      pointer.ui = true;
      el.classList.add('ui');
      el.classList.remove('under-card');
      el.classList.remove('edge');
      // phones and tablets: a tool in the bottom bar gets the arrow from above, with room made for it over the bar
      // (body.tut-bar, css/mobile.css) so it never covers Grandma's words; the landscape column gets it from the right
      // the portrait Menu button sits at the bar's end, right of the "›" tools button: a side arrow at its left edge
      // touched "›" instead (final release PT-01), so it gets the arrow from above like a tool. The bar's doors too
      // (Orders, Market: QA r2 S-08, the arrow lay on her words at 360 and on her naming chip on the iPhone)
      const inBar = touchMq?.matches && (uiEl.closest('#toolbar') || (uiEl.closest('#dock') && !landMq?.matches)
        || (uiEl.id === 'm-menu-btn' && !landMq?.matches));
      document.body.classList.toggle('tut-bar', Boolean(inBar) && !landMq?.matches);
      // a card in an open tray on a portrait phone: the same room, over the tray (her card stands above it there)
      const inTray = Boolean(touchMq?.matches && !landMq?.matches && uiEl.closest('#build-tray, #seed-tray'));
      document.body.classList.toggle('tut-tray', inTray);
      // the phone's tool pop-up: Строй leads it while a build step waits and gets the arrow from above, with the room
      // over the pop-up (css/mobile.css body.tut-fly; QA r3 S3-07: the rows used to open a 96 px band for the arrow)
      const inFly = Boolean(touchMq?.matches && !landMq?.matches && uiEl.closest('#tools-flyout'));
      roomFor(inBar && !landMq?.matches ? 'bar' : inTray ? 'tray' : inFly ? 'fly' : null);
      // a desktop dock door: Grandma's card steps left of the toolbar (like an open tray), so the arrow from the open
      // farm never lands on her words or her "⋯" (QA r2 S-08, jde#10: S-21 moved the arrow onto the ⋯)
      document.body.classList.toggle('coach-aside', !touchMq?.matches && Boolean(uiEl.closest('#dock, .dock-minis')));
      document.body.classList.toggle('tut-fly', inFly);
      // measured after the classes: they move the target (the pop-up's rows) and her card (the bar's room, aside)
      const r = uiEl.getBoundingClientRect();
      const card = coachRect();
      const view = { w: innerWidth, h: innerHeight };
      // the target's neighbours: the arrow never lies on the tile next to the one it means (QA r2 S-09)
      const sibs = (sel) => [...(uiEl.closest(sel)?.querySelectorAll('button') ?? [])].filter((b) => b !== uiEl && b.getClientRects().length)
        .map((b) => b.getBoundingClientRect());
      let way;
      if (inBar && landMq?.matches) way = [r.right + 4, r.top + r.height / 2, 90];
      else if (inBar) {
        way = [r.left + r.width / 2, r.top - 4, 0];
        barRoom(card, arrowBox(...way));
      } else if (uiEl.closest('#dock, .dock-minis')) {
        // the dock's neighbours sit left of and above it: come in diagonally from the open farm, up-left; straight down
        // from above; up-right; never on Grandma's card or a neighbouring door
        way = arrowWay([[r.left + r.width * 0.3, r.top + 8, -38], ...sideWays(r, ['above']), [r.right - r.width * 0.3, r.top + 8, 38]],
          [card, ...sibs('#dock, .dock-minis')], view);
      } else if (inTray || inFly) {
        // from above, the room over the tray (or the pop-up) grown until her card clears the arrow (QA r2 S-08: it
        // covered her "0/3")
        way = sideWays(r, ['above'])[0];
        barRoom(card, arrowBox(...way));
      } else if (uiEl.closest('#tools-flyout, #build-tray, #seed-tray')) {
        // a tile in the tool pop-up or a card in a tray: from the side that has no neighbour (S-09: the arrow for "Строй"
        // lay on "Семена" above it, the one for the Coop card on "Upgrade" beside it); the phone's pop-up opens its rows
        // for the arrow (body.tut-fly, css/mobile.css), and the bar under it is no place for an arrow either
        const bars = ['#toolbar', '#dock'].map((s) => document.querySelector(s)).filter((b) => b?.getClientRects().length).map((b) => b.getBoundingClientRect());
        way = arrowWay(sideWays(r), [card, ...bars, ...sibs('#tools-flyout, #build-tray, #seed-tray')], view);
      } else {
        way = arrowWay(sideWays(r, r.top > innerHeight * 0.55 && r.left > 80 ? ['left', 'above', 'right'] : ['above', 'left', 'right', 'below']), [card], view);
      }
      el.style.transform = `translate3d(${Math.round(way[0])}px, ${Math.round(way[1])}px, 0)${way[2] ? ` rotate(${way[2]}deg)` : ''}`;
      return;
    }
    pointer.ui = false;
    el.classList.remove('ui');
    document.body.classList.remove('tut-bar', 'coach-aside', 'tut-fly', 'tut-tray');
    roomFor(null);
    if (!t.tile) { el.classList.remove('under-card'); el.style.transform = 'translate3d(-999px,-999px,0)'; return; }
    const at = aimOf(t);
    const s = view.toScreen(at.x, at.z, at.y);
    const m = 70;
    const W = innerWidth;
    const H = innerHeight;
    const card = coachRect();
    // a target behind Grandma's card counts as out of sight: the edge arrow above the card points down to it
    const behind = card && s.x >= card.left && s.x <= card.right && s.y >= card.top && s.y <= card.bottom;
    let tileWay = null;
    if (s.visible && !behind && s.x > m && s.x < W - m && s.y > m && s.y < H - m) {
      // from above; from below when that lies on her card (QA r2 S-08)
      tileWay = card ? arrowWay([[s.x, s.y, 0], [s.x, s.y, 180]], [card], { w: W, h: H }) : [s.x, s.y, 0];
      if (card && overlaps(arrowBox(...tileWay), card, 2)) tileWay = null;
    }
    if (tileWay) {
      el.classList.remove('edge');
      el.style.transform = `translate3d(${Math.round(tileWay[0])}px, ${Math.round(tileWay[1])}px, 0)${tileWay[2] ? ` rotate(${tileWay[2]}deg)` : ''}`;
      // a quest card (#banners, under #pointers) over the plot: the arrow steps aside while the card is up, so it never
      // sits on the card's words (life-feel's QA r1 observation; the integrator's 360 BG coach-wait frame). The class is
      // set once per placement, after the card is measured: removed first, the measuring restarted its fade every frame
      const qcard = document.querySelector('#banners > .unlock-banner');
      const cr = qcard?.getClientRects?.().length ? qcard.getBoundingClientRect() : null;
      el.classList.toggle('under-card', Boolean(cr && overlaps(arrowBox(...tileWay), cr, 0)));
    } else {
      // off-screen (or behind her card): an arrow at the edge, turned toward the target, above her card (S-08), and
      // faded like the in-view arrow while it would still lie on her card or on a quest card's words (QA r3 S3-04,
      // fbp#5: with the pop-up open it was drawn inside her card, over "пшеницата"; over "Задачата е изпълнена!")
      const way = edgeTip(s, W, H, m, card);
      const clear = edgeWay(t, way, W, H, m);
      const [x, y, ang] = clear ?? way;
      el.classList.add('edge');
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) rotate(${ang}deg)`;
      const box = arrowBox(x, y, ang);
      const qcard = document.querySelector('#banners > .unlock-banner');
      const cr = qcard?.getClientRects?.().length ? qcard.getBoundingClientRect() : null;
      el.classList.toggle('under-card', !clear || Boolean((card && overlaps(box, card, 0)) || (cr && overlaps(box, cr, 0))));
    }
  }
  /**
   * The arrow's point on a target object: one the farm's pick finds it at (S3-01), re-checked at most every 400 ms (a
   * camera turn or a new building in front changes it); the tile's middle for a tile or without a pick.
   */
  let aim = null;
  const pickAt = (sx, sy) => {
    const cv = document.getElementById('world')?.getBoundingClientRect();
    if (!cv || !cv.width || !cv.height) return null;
    try { return view.pick({ x: ((sx - cv.left) / cv.width) * 2 - 1, y: -(((sy - cv.top) / cv.height) * 2 - 1) }); } catch { return null; }
  };
  /** The edge arrow's way clear of other objects (edgeClear): picked at most every 300 ms, its offset kept between. */
  let edgeAt = null;
  function edgeWay(t, way, W, H, m) {
    if (typeof view.pick !== 'function') return way;
    const ms = performance.now();
    if (!edgeAt || edgeAt.id !== t.id || ms - edgeAt.t > 300) {   // a target with no id (the NOW card's flash) too
      const c = edgeClear(way, { cx: W / 2, cy: H / 2, b: { l: m / 2, t: m / 2, r: W - m / 2, b: H - m / 2 } }, pickAt, t.id);
      const b = arrowBox(...(c ?? way));
      // a HUD button under the arrow keeps its taps: the arrow takes none there
      const tap = ![[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom], [(b.left + b.right) / 2, (b.top + b.bottom) / 2]]
        .some(([x, y]) => document.elementsFromPoint?.(x, y).some((e) => e.closest?.('#hud button')));
      edgeAt = { id: t.id, t: ms, off: c && [c[0] - way[0], c[1] - way[1]], tap };
    }
    pointer?.el.classList.toggle('no-tap', !edgeAt.tap);
    return edgeAt.off && [way[0] + edgeAt.off[0], way[1] + edgeAt.off[1], way[2]];
  }
  function aimOf(t) {
    if (!t.id || typeof view.pick !== 'function') return { ...pointOf(t.tile), y: 0.3 };
    const ms = performance.now();
    if (aim && aim.id === t.id && ms - aim.t < 400) return aim.p;
    const p = (store.state && pickablePoint(store.state, t.id, { toScreen: (x, z, y) => view.toScreen(x, z, y), pickAt }))
      ?? { ...pointOf(t.tile), y: 0.3 };
    aim = { id: t.id, t: ms, p };
    return p;
  }
  /** Grandma's card on screen (null when she is quiet). */
  function coachRect() {
    if (!coach?.isConnected || !coach.getClientRects().length) return null;
    const r = coach.getBoundingClientRect();
    return r.width && r.height ? r : null;
  }
  /**
   * The room over a phone's bar for an arrow from above (body.tut-bar, css/mobile.css --tut-room): grown by what the
   * arrow would cover of her card, so the card stands clear above it (QA r2 S-08: 66 px left the arrow on her words at
   * 360 and on her naming chip on the iPhone). Measured against the card where it stands now; it only grows.
   */
  let room = 0;
  let roomOf = null;              // 'bar' (66 px by the stylesheet) | 'tray' (none) | null
  function barRoom(card, box) {
    if (!card || box.right < card.left || box.left > card.right) return;
    const over = Math.ceil(card.bottom - box.top + 6);
    const landed = () => {
      const bar = document.getElementById('toolbar');
      return !bar || Math.abs(parseFloat(getComputedStyle(bar).marginTop) - room) < 0.5;
    };
    const next = nextRoom(room, roomOf, over, landed);
    if (next === room) return;
    room = next;
    document.body.style.setProperty('--tut-room', `${room}px`);
  }
  /** The arrow moved to another kind of target: the room starts over from the stylesheet's. */
  function roomFor(kind) {
    if (kind === roomOf) return;
    roomOf = kind;
    endBarRoom();
  }
  /** The bar's arrow is gone: its room goes back to the stylesheet's. */
  function endBarRoom() {
    if (!room) return;
    room = 0;
    document.body.style.removeProperty('--tut-room');
  }
  // per frame only for a farm tile (camera-bound, no layout read); a HUD target re-measures twice a second (qa2 CL-05:
  // uiTarget + getBoundingClientRect every frame forced a style pass of the whole HUD per frame of a drag stroke)
  view.onFrame(() => { if (pointer && !pointer.ui) place(); });
  // a farm pointer is placed on every drawn frame, and twice a second too: an idle farm draws no frames, and a quest card
  // that comes up over the plot must still move the arrow aside (integrator, QA r1)
  setInterval(() => { if (pointer) place(); }, 500);
  window.addEventListener('resize', place);

  // ---- coach ----------------------------------------------------------------------------------------------------
  let coachRo = null;
  // --coach-up: her card's top from the screen's foot (the stroke chip under her lifts it: QA r4 S4-03)
  const wrap = document.getElementById('tray-wrap');
  function coachUp() {
    const r = coach?.isConnected ? coach.getBoundingClientRect() : null;
    document.body.style.setProperty('--coach-h', `${Math.round(r?.height ?? 0)}px`);
    // mid stagger-in the stack is up to 32 px low, and a late one is cancelled (no animationend): take it out
    if (r?.height) document.body.style.setProperty('--coach-up', `${coachUpAt(innerHeight, r.top, wrap ? getComputedStyle(wrap).translate : '')}px`);
  }
  wrap?.addEventListener('animationend', coachUp);
  window.addEventListener('resize', coachUp);
  function closeCoach() {
    if (coach) { coach.remove(); coach = null; coachKey = ''; }
    coachRo?.disconnect();
    document.body.style.removeProperty('--coach-h');
    document.body.style.removeProperty('--coach-up');
    document.body.classList.remove('coach-on');
    setPointer(null);
    setPulse(null);
    setShown(false);
  }

  // the step's target in the world breathes while it is the step (M9: the first weed): render-look's view.pulse when it
  // has one; the brush highlight belongs to the controller (it rewrites it on every hover), so nothing falls back on it
  let pulseKey = '';
  function setPulse(tile) {
    const key = tile ? `${tile.x},${tile.z}` : '';
    if (key === pulseKey) return;
    pulseKey = key;
    try { view.pulse?.(tile ? [[Math.floor(tile.x), Math.floor(tile.z)]] : null); } catch { /* the view has no pulse */ }
  }

  /** The HUD's rectangles now (the arrow's target must not sit under them, M9). */
  function hudRects() {
    const out = [];
    for (const sel of ['.hud-tl', '#tracker', '.hud-tr', '.hud-rcol', '#hud-right', '#tray-wrap', '#dock', '#social', '#feed', '#hud-beauty']) {
      const el = document.querySelector(sel);
      if (!el || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) out.push({ left: r.left - 8, top: r.top - 8, right: r.right + 8, bottom: r.bottom + 8 });
    }
    return out;
  }
  let seeAt = 0;
  let seeCache = null;
  /** The view facts for debrisTarget, measured at most twice a second. */
  function see() {
    const t = performance.now();
    if (!seeCache || t - seeAt > 500) {
      seeAt = t;
      seeCache = { toScreen: (x, z, y) => view.toScreen(x, z, y), w: innerWidth, h: innerHeight, hud: hudRects() };
    }
    return seeCache;
  }

  // the farm's start steps (welcome, naming) are no gate any more: when the together steps are due and nobody ticked
  // them, the coach ticks them (tutDone: guidance only, nothing paid; the naming stays a chip) once per farm step
  let ticked = '';
  function tickStart(state) {
    const cur = currentFarmStep(state);
    if (!cur || cur.list !== 'start' || !ACTIONS.tutDone) return;
    const key = `${cur.step.id}:${state.farm.tut.s}`;
    if (key === ticked) return;
    ticked = key;
    for (const step of TUTORIAL.start.slice(state.farm.tut.s)) S.controller.do('tutDone', { step: step.id });
  }

  /**
   * A farm nobody else has claimed: "say hello" has nobody to greet and would hold the shared list there for good, so
   * the coach ticks it (tutDone: a client-only step, nothing paid) and the apple tree is still taught (S-05). A partner
   * who is claimed but away keeps the step: it shows again when they are online. golden_hour waits for a partner.
   */
  let helloTicked = false;
  function soloHello(state) {
    const cur = currentFarmStep(state);
    if (helloTicked || !cur || cur.list !== 'together' || cur.step.id !== 'say_hello' || !ACTIONS.tutDone) return;
    if (Object.keys(state.players).some((p) => p !== store.pid) || coachRetired(state, store.pid)) return;
    helloTicked = true;
    S.controller.do('tutDone', { step: 'say_hello' });
  }

  /** "Name your farm" (M1a, ux-first#11): a chip on the coach card after the first harvest, never a gate. */
  function nameFarm() {
    const st = store.state;
    const cur = st ? currentFarmStep(st) : null;
    // the naming deed counts on the farm's naming step: the welcome before it is ticked first
    if (cur && cur.list === 'start' && cur.step.id === 'welcome' && ACTIONS.tutDone) S.controller.do('tutDone', { step: 'welcome' });
    ui.nameFarm();
  }

  function render() {
    const state = store.state;
    if (!state || !state.farm.tut) { closeCoach(); return; }
    if (kv.get(hiddenKey(), false)) { closeCoach(); return; }
    soloHello(state);
    const partner = Object.keys(state.players).find((p) => p !== store.pid);
    const c = coachStep(state, store.pid, { partnerOnline: partner && S.hud?.isOnline ? S.hud.isOnline(partner) : undefined });
    if (!c) { closeCoach(); return; }
    if (c.list === 'together' && c.startOpen && !c.waiting) tickStart(state);
    const chip = namingDue(state) && harvestedOnce(state);
    // a step that waits for a level: the deed that gets there, with its XP to go and the arrow (S-03)
    const fill = waitingFiller(state, c, store.now());
    const have = fill ? fill.have : c.have;
    const need = fill ? fill.need : c.need;
    const words = stepWords(state, c.step);   // F3-10: placing the Windmill changes her words, not her count
    const first = lineKeyOf(c, S.controller?.tool);
    const key = `${c.track}:${c.step.id}:${c.have}:${c.waiting || ''}:${fill ? fill.params.n : ''}:${chip}:${lang()}:${words ? words.key : ''}:${first || ''}`;
    if (key !== coachKey) {
      coachKey = key;
      menuOpen = false;
      const pct = Math.round((Math.min(have, need) / Math.max(1, need)) * 100);
      const acts = [];
      if (c.step.id === 'say_hello' && ACTIONS.tutDone) {
        acts.push(h('button.btn.btn--sky.btn--small', { type: 'button', on: { click: () => S.social?.sendEmote('wave') } }, tr('moments.coach.wave')));
      }
      if (chip) acts.push(h('button.chip.coach-name', { type: 'button', on: { click: nameFarm } }, tr('dock.coach.name')));
      // the rarer choices live behind one "⋯" button with 36 px rows: four 21 px links 2 px apart made one stray
      // click end the guide for good (QA wave 1 UI-04)
      const more = coachChoices(state, c).map(([label, fn, cls]) => h(`button.coach-item${cls ? `.${cls}` : ''}`, {
        type: 'button', role: 'menuitem', on: { click: () => { setMenu(false); fn(); } } }, label));
      const menu = more.length ? h('div.coach-menu.paper', { role: 'menu', 'aria-label': tr('moments.coach.menu'), hidden: true }, ...more) : null;
      const moreBtn = menu ? h('button.coach-more', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': tr('moments.coach.more'),
        'data-tip': tr('moments.coach.moreTip'), on: { click: () => setMenu(!menuOpen) } }, h('span', { 'aria-hidden': 'true' }, '⋯')) : null;
      const said = touchText(first ? tr(first) : stepText(c.step, state), touchPlayer(S.controller));   // a phone taps, has no G key
      const text = fill ? tr(fill.key, fill.params) : said;
      // one line and a progress bar (S5): Grandma's face, her words, the count; her name is the face's label
      // features' tracker check (M1b) reads what the coach says: the message key and its params
      const msg = fill ? fill.key : `TUTORIAL:step.${c.step.id}`;
      const params = fill ? fill.params : { have: Math.min(c.have, c.need), need: c.need };
      const next = h('section.coach.wood.coach--line', { role: 'status', 'aria-live': 'polite', dataset: { step: c.step.id, track: c.track,
        msg, params: JSON.stringify(params), ...(fill ? { waiting: String(c.waiting) } : {}) } },
        h('div.paper.coach-paper',
          grandmaPortrait(40),
          h('div.say',
            h('p.line', h('span.sr-only', `${tr('moments.coach.grandma')}: `), text),
            need > 1 || have > 0 ? h('div.prog', { 'aria-label': `${Math.min(have, need)} / ${need}` },
              h('span.bar', h('i', { style: { width: `${pct}%` } })), h('span.n', `${Math.min(have, need)}/${need}`),
              // the harvest step while the crop still grows: when it is ripe, ticking (QA r1 S-18); not read out each second
              h('span.eta', { 'aria-hidden': 'true', hidden: true })) : null),
          acts.length || moreBtn ? h('div.acts', acts, moreBtn ? h('div.coach-more-wrap', moreBtn, menu) : null) : null));
      if (menu) {
        menu.addEventListener('keydown', (e) => {
          const items = [...menu.querySelectorAll('button')];
          const i = items.indexOf(document.activeElement);
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(false); moreBtn.focus(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
        });
      }
      if (coach) coach.replaceWith(next); else slot.prepend(next);
      coach = next;
      // the card's height for what must stand above it on a phone (the Undo chip covered her naming chip: QA r1 S-14)
      if (typeof ResizeObserver === 'function') {
        coachRo ??= new ResizeObserver(coachUp);
        coachRo.disconnect();
        coachRo.observe(coach);
        if (wrap) coachRo.observe(wrap, { box: 'border-box' });
      }
      // phones: the activity feed steps aside while Grandma's card is up (css/mobile.css; a class, not a :has() that
      // every HUD change would re-check); the tracker waits while she speaks (one voice, M1a)
      document.body.classList.add('coach-on');
      setShown(true, c.step.id);
    }
    // while the player is already placing something, the arrow would only distract from the ghost
    const build = S.controller.tool && S.controller.tool.build;
    const t = c.step.task;
    const wants = t && (t.verb === 'place' || (t.verb === 'plant' && CONTENT.trees.has(t.ref))) ? t.ref
      : c.step.id === 'flour_together' ? 'mill' : null;
    const placing = Boolean(build && wants && build.def === wants);
    const target = fill ? fill.target : placing ? null : targetOf(state, c.step, store.now(), see());
    setPointer(target);
    setPulse(c.step.id === 'clear_weeds' && target?.tile ? target.tile : null);
    // the step's tool pulses in the tray until it is in hand ("Drag the Sickle across the ripe Wheat"); the Hand plants
    // through the seed picker, so a planting step asks for no other tool while the Hand is out
    for (const el of document.querySelectorAll('.tool.tool-hint')) el.classList.remove('tool-hint');
    const handPlants = c.step.tool === 'seed_bag' && S.controller.tool.id === 'hand';
    if (!c.waiting && c.step.tool && !handPlants && S.controller.tool.id !== c.step.tool) {
      // the tool's own button, or the slot that holds it (the Tools flyout, the phone's one slot: release 1.0 S2, S3)
      (S.toolbar?.slotOf?.(c.step.tool) ?? document.querySelector(`.tool[data-tool="${c.step.tool}"]`))?.classList.add('tool-hint');
    }
  }

  function setMenu(open) {
    const menu = coach && coach.querySelector('.coach-menu');
    const btn = coach && coach.querySelector('.coach-more');
    if (!menu || !btn) return;
    menuOpen = Boolean(open);
    menu.hidden = !menuOpen;
    btn.setAttribute('aria-expanded', String(menuOpen));
    if (menuOpen) menu.querySelector('button')?.focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', (e) => { if (menuOpen && coach && !coach.querySelector('.coach-more-wrap')?.contains(e.target)) setMenu(false); }, true);

  /** The choices behind "⋯": [label, fn, cls?]. "I know farming" asks first; it ends the guide for this farmer. */
  function coachChoices(state, c) {
    const out = [];
    const me = state.players[store.pid];
    if (c.list === 'track' && c.track !== 'choose' && ACTIONS.tutSkip) {
      out.push([tr('moments.coach.skip'), () => S.controller.do('tutSkip', {})]);
      // GDD §7.4: the two tracks are "auto-assigned by who acts first and swappable"
      if (ACTIONS.tutSwap && (c.track === 'fields' || c.track === 'barnyard')) {
        out.push([c.track === 'fields' ? tr('moments.coach.swapAnimals') : tr('moments.coach.swapFields'), () => S.controller.do('tutSwap', {})]);
      }
    }
    out.push([tr('moments.coach.hide'), () => { kv.set(hiddenKey(), true); closeCoach(); }]);
    if (me && me.tut && !me.tut.skip && ACTIONS.tutSkip && c.list !== 'start') {
      out.push([tr('moments.coach.end'), async () => {
        const ok = await ui.confirm({ title: tr('moments.coach.endTitle'), lead: tr('moments.coach.endLead'),
          body: tr('moments.coach.endBody'), glyph: 'letter',
          ok: tr('moments.coach.endOk'), okKind: 'sun', cancel: tr('moments.coach.endKeep') });
        if (ok) S.controller.do('tutSkip', { all: 'yes' });
      }, 'danger']);
    }
    return out;
  }

  // ---- first-use tips (per player, keyed in the rules' seen flags; GDD §7.4) --------------------------------
  // a panel's first open shows its content tip (M1b's weekly / collection panels and the M2 panels were never wired)
  const TIP_FOR_PANEL = { building: 'building_panel', market: 'market_panel', fair: 'fair_panel', barge: 'barge_panel',
    restoration: 'restoration_panel', town: 'town_panel', townsfolk: 'townsfolk_panel', collections: 'collections_panel',
    perks: 'perks_panel', nursery: 'nursery_panel', breeding: 'breeding_panel', fishing: 'fishing', league: 'league_panel',
    seasonTrack: 'track_panel', duel: 'duel_panel', farmhouse: 'interior' };
  function firstUse(id, { panel = null } = {}) {
    const state = store.state;
    if (!state) return;
    const tip = TUTORIAL.firstUse.find((t) => t.id === id);
    if (!tip) return;
    const me = state.players[store.pid];
    const seenTips = me && me.seen ? me.seen.tips : kv.get(`hh.tips.${store.pid}`, {});
    if (seenTips && seenTips[id]) return;
    // one voice (M1a, ux-first#1): while Grandma teaches with this tool her line says it; the tip waits (unseen) for a
    // later first use
    if (!tipDue(state, store.pid, id, { hidden: kv.get(hiddenKey(), false) })) return;
    const markIt = () => {
      if (ACTIONS.markSeen && me && me.seen) S.controller.do('markSeen', { kind: 'tip', id });
      else kv.set(`hh.tips.${store.pid}`, { ...(kv.get(`hh.tips.${store.pid}`, {}) || {}), [id]: 1 });
    };
    // a panel's tip inside its own sheet, seen once it has been on screen 2 s (QA r3 S3-12)
    const frame = panel ? document.getElementById(`panel-${panel}`) : null;
    if (frame) {
      mountPanelTip(frame, { label: tr('moments.coach.tip'), closeLabel: tr('common.close'), onSeen: markIt,
        words: touchText(ctext('TUTORIAL', `firstUse.${id}`, 'text', tip.text), touchPlayer(S.controller)) });
      return;
    }
    markIt();
    if (hint) hint.remove();
    const ms = Math.max(5000, TUTORIAL.firstUseMs || 0);          // 5 s: long enough to read twice (UI-35)
    // a tool's tip goes on top of its open tray; a panel's tip into the coach column
    const trayOpen = !document.getElementById('seed-tray')?.hidden || !document.getElementById('build-tray')?.hidden;
    if (trayOpen && !TIP_PANELS.has(id)) {
      const words = ctext('TUTORIAL', `firstUse.${id}`, 'text', tip.text);
      trayTip.replaceChildren(h('b', tr('moments.coach.tip')), touchText(words, touchPlayer(S.controller)));
      trayTip.hidden = false;
      clearTimeout(trayTip._t);
      trayTip._t = setTimeout(() => { trayTip.hidden = true; }, ms);
      return;
    }
    hint = h('div.hint', { role: 'status' }, h('b', tr('moments.coach.tip')), touchText(ctext('TUTORIAL', `firstUse.${id}`, 'text', tip.text), touchPlayer(S.controller)));
    slot.append(hint);
    const mine = hint;
    setTimeout(() => { if (mine.isConnected) { mine.style.transition = 'opacity 300ms'; mine.style.opacity = '0'; setTimeout(() => mine.remove(), 320); } }, ms);
  }
  const TIP_PANELS = new Set(Object.values(TIP_FOR_PANEL));
  // the tray tip leaves with its tray
  for (const id of ['seed-tray', 'build-tray']) {
    const el = document.getElementById(id);
    if (el && typeof MutationObserver === 'function') new MutationObserver(() => {
      if (document.getElementById('seed-tray')?.hidden && document.getElementById('build-tray')?.hidden) trayTip.hidden = true;
    }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  }
  ui.panels.on('open', (name) => { if (TIP_FOR_PANEL[name]) firstUse(TIP_FOR_PANEL[name], { panel: name }); });
  // a panel's tip strip goes with its sheet (unseen when it closed within 2 s: it comes again on the next open)
  ui.panels.on('close', (name) => { document.getElementById(`panel-${name}`)?.querySelector('.panel-tip')?.remove(); });
  ui.panels.on('tab', (name, id) => document.getElementById(`panel-${name}`)?.querySelector('.panel-tip')?.onTab?.(id));

  // ---- step done: a quick ✓ before the next step --------------------------------------------------------------
  store.on('fx', ({ ev }) => {
    if (!ev || ev.e !== 'tutorialStep' || !ev.done || ev.pid !== store.pid || !coach) return;
    coach.classList.add('done');
    setTimeout(() => coach && coach.classList.remove('done'), 700);
  });

  let raf = 0;
  const soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  for (const t of ['players', 'tut', 'objects', 'xp', 'name']) store.subscribe(t, soon);
  S.controller.on('tool', soon);
  setInterval(soon, 4000);       // a crop ripening moves the harvest pointer without any delta
  // the harvest step's "ripe in 0:42" (S-18) and a make step's "ready in 4:12, then collect it" (QA r2 S-06): a text
  // node ticking once a second, never a re-render of the card; a step with no progress bar gets a row of its own
  setInterval(() => {
    if (!coach || !store.state) return;
    const step = { id: coach.dataset.step, task: stepOf(coach.dataset.step)?.task };
    const now = store.now();
    const ms = coach.dataset.waiting ? null : ripeEta(store.state, step, now);
    const made = ms === null && !coach.dataset.waiting ? makeEta(store.state, step, now) : null;
    const text = ms !== null ? tr('dock.coach.ripeIn', { d: clock(ms) })
      : made ? (made.ready ? tr('dock.coach.makeReady') : tr('dock.coach.makeIn', { d: clock(made.ms) })) : null;
    let eta = coach.querySelector('.prog .eta');
    if (!eta) {
      if (text === null) return;
      eta = h('span.eta', { 'aria-hidden': 'true' });
      coach.querySelector('.say')?.append(h('div.prog.eta-only', eta));
    }
    if (text === null && eta.parentElement?.classList.contains('eta-only')) { eta.parentElement.remove(); return; }
    eta.hidden = text === null;
    if (text !== null && eta.textContent !== text) eta.textContent = text;
  }, 1000);

  return {
    render,
    firstUse,
    /** A pointer flash at a tile (Goal Tracker clicks). */
    flash(tile) {
      clearTimeout(flashT);
      if (coach && pointer) return;          // the coach's pointer has priority
      setPointer({ tile });
      flashT = setTimeout(() => { if (!coach) setPointer(null); else render(); }, 2600);
    },
    /** Client-only deeds the rules cannot see (the "say hello" step). */
    did(verb) {
      const cur = store.state && currentFarmStep(store.state);
      if (cur && cur.step.task && cur.step.task.verb === verb && ACTIONS.tutDone) S.controller.do('tutDone', { step: cur.step.id });
    },
    /** "Show the guide again" (Settings > Farm): un-hide the coach and, with the rules' tutRestart, start over. */
    restart() {
      kv.set(hiddenKey(), false);
      coachKey = '';
      const me = store.state && store.state.players[store.pid];
      if (ACTIONS.tutRestart) S.controller.do('tutRestart', {});
      else if (me && me.tut && me.tut.skip) ui.toast(tr('moments.coach.off'), { kind: 'info', ms: 5000 });
      render();
    },
    /** True while the coach is on screen (other teaching cards wait). */
    active: () => Boolean(coach),
  };
}
