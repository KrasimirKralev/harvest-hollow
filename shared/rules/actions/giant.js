// Giant crops (GDD §6.2 mechanic 8, §9 #43; L20, M1b). Owned by rules-economy.
//
// A 3 x 3 block of plots growing one crop, all nine composted and planted within one minute of each other, rolls a
// 20 % chance, when its last plot is planted, to grow as ONE Giant. The roll is keyed on the block's anchor plot (its
// min corner) and that plot's `cycle` (harvests so far: server-ordered state, review-m0 #2), so re-planting the same
// block in the same cycle re-rolls nothing (no fishing by uprooting), and every new cycle is a fresh chance (no
// permanently lucky field). A roll stamps all nine plots `giantTried = cycle`, and a block holding a plot already
// tried in its current cycle never rolls: moving another plot into the min corner re-rolls nothing either (wave-2
// QA RC-06; uproot and move keep the stamp, only a harvest moves the cycle on). The GDD's key "plantedAt" is a
// client-chosen time, which the rules may not key on.
//
// The nine crops keep their records and get `giant: anchorId`; the anchor's crop carries the timers that count
// (watering, rain, Hurry and the Level-up Bloom act on the whole Giant and are copied to all nine, so every plot
// shows the same ripeness), `hp` and `chop`. A Giant is never harvested with the Sickle, uprooted or moved: it is
// felled with the Axe (`chop` on any of its plots): 60 hp, 10 per chop, 15 when the previous chop was the OTHER
// player's within 2 s (combo only with two distinct players). Felled, it yields 2 x 9 x (yield + 1) units plus one
// per blue ribbon of its nine Compost rolls, as nine `harvested` events (farm XP, mastery, quests as nine harvests)
// and one `giantFelled` (+25 Fair points, the Giant ribbons; `team` when both players chopped). Felled together, the
// nine harvests (their personal XP, blue-ribbon Fair points) and the Giant's +25 Fair points are shared by chop share
// (`chop.hits`, largest remainder in pid order: wave-2 QA RC-09), never all to whoever made the last chop.
import { cropOf, COOP, GROWTH, DEBRIS_RULES, isLive, levelFromXp } from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { tileOwner, objectOf } from '../grid.js';
import { isReady } from '../time.js';
import { intake, mulBp, starsOf, masteryEffects, collectionPerk, proofDeed } from '../economy.js';
import { restoreDeed } from './restoration.js';
import { shareOut } from '../order.js';

const G = COOP.giant;
const rolled = (ctx, bp, ...keys) => bp > 0 && Math.floor(ctx.rng(...keys) * 10_000) < bp;

/** True when giant crops are part of this build and the farm has reached their level. */
export const giantLive = (state) => isLive(G) && levelFromXp(state.farm.xp) >= G.from;

/**
 * The ids of the nine plots of the 3 x 3 block whose min corner is (x0, z0), in row order, or null when a tile is
 * not exactly one plot (Greenhouse plots never join a block).
 */
export function blockAt(state, x0, z0) {
  const ids = [];
  for (let dz = 0; dz < G.block; dz++) {
    for (let dx = 0; dx < G.block; dx++) {
      const id = tileOwner(state, x0 + dx, z0 + dz);
      const o = id && state.farm.objects[id];
      if (!o || o.def !== 'plot' || o.x !== x0 + dx || o.z !== z0 + dz || o.gh !== undefined) return null;
      ids.push(id);
    }
  }
  return ids;
}

/** The ids of a Giant's nine plots from its anchor (in row order); [] when the anchor holds no Giant. */
export function giantIds(state, anchorId) {
  const a = objectOf(state, anchorId);
  if (!a || !a.crop || a.crop.giant !== anchorId) return [];
  return (blockAt(state, a.x, a.z) ?? []).filter((id) => state.farm.objects[id].crop?.giant === anchorId);
}

/** The anchor plot id of the Giant plot `id` belongs to, or null. */
export const giantAnchorOf = (state, id) => objectOf(state, id)?.crop?.giant ?? null;

/** Does the block qualify: one crop, all composted, no Giant yet, planted within the window? */
function qualifies(state, ids) {
  let crop = null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of ids) {
    const o = state.farm.objects[id];
    const c = o.crop;
    if (!c || !o.compost || c.giant !== undefined || o.giantTried === o.cycle) return false;
    if (crop === null) crop = c.def;
    else if (c.def !== crop) return false;
    lo = Math.min(lo, c.plantedAt);
    hi = Math.max(hi, c.plantedAt);
  }
  return hi - lo <= G.plantWindowMs;
}

/** Hit points a fresh Giant (or debris) starts with: Lost Tools needs 1 fewer chop, never fewer than 3 (§5.5). */
export function chopHp(state, hp) {
  const less = collectionPerk(state, 'chopsLess');
  if (less <= 0) return hp;
  const dmg = DEBRIS_RULES.chopDamage;
  const chops = Math.ceil(hp / dmg);
  const min = Math.max(1, collectionPerk(state, 'minChops') || 3);
  return chops > min ? hp - Math.min(less, chops - min) * dmg : hp;
}

/**
 * After a planting stroke: every block that one of `planted` completes rolls once (blocks in canonical corner order;
 * a plot joins at most one Giant). Emits `giantFormed` for each Giant.
 */
export function formGiants(tx, ctx, planted) {
  if (!giantLive(tx.state)) return;
  const tried = new Set();
  for (const pid of planted) {
    const p = tx.state.farm.objects[pid];
    const corners = [];
    for (let dz = G.block - 1; dz >= 0; dz--) {
      for (let dx = G.block - 1; dx >= 0; dx--) corners.push([p.x - dx, p.z - dz]);
    }
    for (const [x0, z0] of corners) {
      const ids = blockAt(tx.state, x0, z0);
      if (!ids || tried.has(ids[0]) || !qualifies(tx.state, ids)) continue;
      tried.add(ids[0]);
      const anchor = ids[0];
      const lucky = rolled(ctx, G.chanceBp, 'giant', anchor, tx.state.farm.objects[anchor].cycle);
      for (const id of ids) tx.set(['farm', 'objects', id, 'giantTried'], tx.state.farm.objects[id].cycle);
      if (!lucky) continue;
      const ready = Math.max(...ids.map((id) => tx.state.farm.objects[id].crop.readyAt));
      for (const id of ids) {
        tx.set(['farm', 'objects', id, 'crop', 'giant'], anchor);
        if (tx.state.farm.objects[id].crop.readyAt !== ready) tx.set(['farm', 'objects', id, 'crop', 'readyAt'], ready);
      }
      tx.set(['farm', 'objects', anchor, 'crop', 'hp'], chopHp(tx.state, G.hp));
      tx.emit({ e: 'giantFormed', id: anchor, ids, crop: tx.state.farm.objects[anchor].crop.def, by: ctx.pid });
    }
  }
}

/** Copy the anchor's timers (readyAt, cut, water, tend) to the other plots of its Giant. */
export function syncGiant(tx, anchorId) {
  const a = tx.state.farm.objects[anchorId].crop;
  for (const id of giantIds(tx.state, anchorId)) {
    if (id === anchorId) continue;
    const c = tx.state.farm.objects[id].crop;
    const base = ['farm', 'objects', id, 'crop'];
    for (const k of ['readyAt', 'cut', 'water', 'tend']) {
      if (a[k] === c[k]) continue;
      if (a[k] === undefined) tx.del([...base, k]); else tx.set([...base, k], a[k]);
    }
  }
}

/** Why plot `id` cannot take a chop now (null = it can): a ripe Giant only. */
export function giantChopCode(state, id, ctx) {
  const anchor = giantAnchorOf(state, id);
  if (!anchor) return ERR.NOT_FOUND;
  const a = objectOf(state, anchor);
  if (!a || !isReady(a.crop, ctx.now, ctx.grace)) return ERR.NOT_READY;
  return null;
}

/** Units the Giant at `anchor` yields when felled (pure): per plot 2 x (yield + 1) + its blue ribbon. */
export function giantYield(state, anchor, ctx) {
  const crop = cropOf(state.farm.objects[anchor].crop.def);
  const stars = starsOf(state, crop.id);
  const fx = masteryEffects('crops', stars);
  const C = GROWTH.compost;
  const chance = Math.min(C.maxBp, C.ribbonBp + C.perStarBp * Math.min(stars, 3) + fx.ribbonBp);
  return giantIds(state, anchor).map((id) => {
    const o = state.farm.objects[id];
    const ribbon = o.crop.golden === true || rolled(ctx, chance, 'ribbon', id, o.cycle);
    return { id, qty: G.yieldMul * (crop.yield + C.bonusUnits) + (ribbon ? C.ribbonUnits : 0), ribbon };
  });
}

/** Units felling the Giant at `anchor` would bring in (for the Barn room check). */
export const giantUnits = (state, anchor, ctx) => giantYield(state, anchor, ctx).reduce((n, x) => n + x.qty, 0);

/** The hit points the Giant at `anchor` has left after `ctx.pid` chops it now (<= 0: felled). Pure. */
export function giantHpAfterChop(state, anchor, ctx) {
  const a = state.farm.objects[anchor].crop;
  const last = a.chop?.last;
  const team = last && last.by !== ctx.pid && ctx.now - last.at <= DEBRIS_RULES.teamworkWindowMs;
  return (a.hp ?? G.hp) - (team ? DEBRIS_RULES.teamworkChopDamage : DEBRIS_RULES.chopDamage);
}

/** One chop on the Giant at `anchor` inside `tx` (the caller checked it is ripe and the Barn has room). */
export function chopGiant(tx, ctx, anchor) {
  const a = tx.state.farm.objects[anchor].crop;
  const hp = giantHpAfterChop(tx.state, anchor, ctx);
  const by = [...new Set([...(a.chop?.by ?? []), ctx.pid])].sort();
  // chops per farmer (a record from before `hits` existed counts one each for the farmers who chopped)
  const hits = { ...(a.chop?.hits ?? Object.fromEntries((a.chop?.by ?? []).map((p) => [p, 1]))) };
  hits[ctx.pid] = (hits[ctx.pid] ?? 0) + 1;
  if (hp > 0) {
    tx.set(['farm', 'objects', anchor, 'crop', 'hp'], hp);
    tx.set(['farm', 'objects', anchor, 'crop', 'chop'], { by, last: { by: ctx.pid, at: ctx.now }, hits });
    tx.emit({ e: 'chopHit', id: anchor, def: a.def, hp, by: ctx.pid, giant: true });
    return;
  }
  const crop = cropOf(a.def);
  const fresh = ctx.now <= a.readyAt + crop.freshMs;
  const out = giantYield(tx.state, anchor, ctx);
  const ids = out.map((x) => x.id);
  // who is credited with each of the nine harvests: chop shares, in plot order (RC-09)
  const credit = [];
  const plots = shareOut(out.length, hits);
  for (const p of Object.keys(plots).sort()) for (let k = 0; k < plots[p]; k++) credit.push(p);
  let frac = tx.state.farm.xpFrac ?? 0;
  let total = 0;
  for (const [k, x] of out.entries()) {
    const o = tx.state.farm.objects[x.id];
    const xp100 = crop.xp100 + (fresh ? mulBp(crop.xp100, GROWTH.fresh.xpBonusBp) : 0);
    frac += xp100;
    const xp = Math.floor(frac / 100);
    frac -= xp * 100;
    const planter = o.crop.by;
    intake(tx, crop.id, x.qty);
    proofDeed(tx, 'harvest', crop.id, x.qty);
    if (x.ribbon) restoreDeed(tx, ctx, 'prized_crop', 1);
    tx.set(['farm', 'objects', x.id, 'crop'], null);
    tx.set(['farm', 'objects', x.id, 'cycle'], o.cycle + 1);
    tx.del(['farm', 'objects', x.id, 'compost']);
    total += x.qty;
    tx.emit({ e: 'harvested', id: x.id, crop: crop.id, qty: x.qty, by: credit[k] ?? ctx.pid, planter, xp, xp100,
      fresh, ribbon: x.ribbon, bonus: x.qty - crop.yield, star: starsOf(tx.state, crop.id), giant: anchor });
  }
  if (frac !== (tx.state.farm.xpFrac ?? 0)) tx.set(['farm', 'xpFrac'], frac);
  const ev = { e: 'giantFelled', id: anchor, ids, crop: crop.id, qty: total, by: ctx.pid, team: by.length >= 2,
    choppers: by, hits };
  if (by.length >= 2) ev.pair = by.slice(0, 2);                       // felled together (Teamwork, quest H4)
  tx.emit(ev);
}
