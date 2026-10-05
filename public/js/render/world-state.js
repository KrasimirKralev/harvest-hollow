// What the M1b world places show, read from the replicated state (GDD §5.5-5.9, §6.2 #8; tech §2). Pure: every
// function is (state, now) -> plain data, deterministic on both screens, tested in test/render-world.m1b.test.js.
// The ONE place where the 3D world reads the M1b rules' state: if a rules lane names or shapes a field differently,
// only this file changes (docs/agent-notes/w2-render-world.md lists the shapes read). Owned by the render-world lane.
//
//   farmLevel(state) -> n                       featureLive(state, featureId) -> bool (milestone AND farm level)
//   localWeekMs(now, tz) -> ms since Monday 00:00 in the farm's zone
//   bargeAt(now, tz) -> { phase: 'away' | 'arriving' | 'docked' | 'leaving', k }   Captain Reed's schedule (§5.7)
//   bargeView(state, now) -> { live, phase, k, rows, crates: [{ row, i, loaded, by }], upgraded }
//   fairView(state, now) -> { live, open, medal: { id, rank, tier } | null, points, target, frac, entries }
//   townView(state, now) -> { live, built: [{ id, n, at }], building: { id, n, until } | null }
//   restorationView(state, now) -> [{ id, n, live, stage 0..4, done }]   (bundles finished; 4 = restored)
//   meadowOwned(state) -> bool                  Restoration 3 (Stone Bridge) is done: the Hollow Meadow is farm land
//   giantBlocks(state, now) -> Map(anchorId -> { crop, ids, x, z, ready, stage })   3 x 3 giant crops
//   beautyOf(state) -> { score, stars }         Farm Beauty (§5.9); the rules' own helper when one is exported
// Wave 3 (M2):
//   pavilionView(state, now) -> { live, tiers, building: tier | null }   the Festival Pavilion (Town Projects 25+)
//   interiorView(state) -> { live, items: [{ id, def, x, z, rot, by }], wall: [...] }   the farmhouse interior (§5.9 #6)
//   grandmaVisit(state, now) -> { phase: 'none' | 'arriving' | 'visiting', at, until, k }   her visit (quest E10)
//   decorSetsOf(state) -> [{ id, complete, ids, x, z }]   decor sets and whether each is complete (radius rule)
//   setsOfDef(defId) -> [set]                   the decor sets a def belongs to (placement glow)
import * as contentAll from '../../../shared/content/index.js';
import { CONTENT, FAIR, BARGE, FARM_BEAUTY, isLive, levelFromXp, defOf, cropOf } from '../../../shared/content/index.js';
import { stage as cropStage, isReady } from '../../../shared/rules/time.js';
import { footprint } from '../../../shared/rules/grid.js';
// The rules' entry first: it evaluates the action modules in their own order (importing an action module on its own
// can trip their import cycle). Namespace imports: a helper a rules lane renames or has not written yet is simply
// absent (never a load error).
import '../../../shared/rules/index.js';
import * as gridRules from '../../../shared/rules/grid.js';
import * as beautyRules from '../../../shared/rules/actions/beauty.js';
import * as treeRules from '../../../shared/rules/actions/trees.js';
import * as grandmaRules from '../../../shared/rules/actions/grandma.js';

/** True when a tree object is an Heirloom (GDD §3.2 rule 8: the rules' own test, the Heirloom Keeper's too). */
export const isHeirloomTree = (o) => Boolean(o) && typeof treeRules.isHeirloom === 'function' && treeRules.isHeirloom(o);

const H = 3_600_000;
const DAY = 24 * H;

// Which content is live: the milestone gate (content's isLive). Look-dev and tests may preview a later milestone
// (setLivePredicate); the game never does, so nothing unsupported becomes reachable.
let liveGate = isLive;
/** Tests and look-dev only: preview content gated to a later milestone. `null` restores the real gate. */
export function setLivePredicate(fn) { liveGate = typeof fn === 'function' ? fn : isLive; }
/** The milestone gate the world draws with (content's isLive unless a look-dev preview is on). */
export const liveNow = (def) => liveGate(def);

/** The farm's level from its XP. */
export function farmLevel(state) {
  return state && state.farm && Number.isFinite(state.farm.xp) ? levelFromXp(state.farm.xp) : 1;
}

/** A system is live when its feature row is in this milestone and the farm reached its level. */
export function featureLive(state, id) {
  const f = CONTENT.features.get(id);
  return Boolean(f) && liveGate(f) && farmLevel(state) >= (f.unlock ?? 1);
}

// ---------------------------------------------------------------------------------------------------
// The farm's local week clock (Intl is a pure function of instant and zone, like shared/rules/calendar.js)
const fmts = new Map();
const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
function wallParts(now, tz) {
  let f = fmts.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
    } catch {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
    }
    fmts.set(tz, f);
  }
  const out = { dow: 0, h: 0, m: 0, s: 0 };
  for (const p of f.formatToParts(now)) {
    if (p.type === 'weekday') out.dow = DOW[p.value] ?? 0;
    else if (p.type === 'hour') out.h = Number(p.value) % 24;
    else if (p.type === 'minute') out.m = Number(p.value);
    else if (p.type === 'second') out.s = Number(p.value);
  }
  return out;
}

/** Milliseconds since Monday 00:00 in the farm's zone (weeks start on Monday, tech §4.5). */
export function localWeekMs(now, tz = 'UTC') {
  const p = wallParts(now, tz);
  return p.dow * DAY + p.h * H + p.m * 60_000 + p.s * 1000 + (((now % 1000) + 1000) % 1000);
}

// ---------------------------------------------------------------------------------------------------
// The River Barge (GDD §5.7): Captain Reed docks Monday 06:00 and casts off Sunday 20:00.
export const BARGE_MOVE = Object.freeze({ arriveMs: 50_000, leaveMs: 70_000 });

export function bargeAt(now, tz) {
  const t = localWeekMs(now, tz);
  const dock = BARGE.dockDay * DAY + BARGE.dockHour * H;
  const off = BARGE.castOffDay * DAY + BARGE.castOffHour * H;
  if (t >= dock && t < dock + BARGE_MOVE.arriveMs) return { phase: 'arriving', k: (t - dock) / BARGE_MOVE.arriveMs };
  if (t >= dock && t < off) return { phase: 'docked', k: 1 };
  if (t >= off && t < off + BARGE_MOVE.leaveMs) return { phase: 'leaving', k: (t - off) / BARGE_MOVE.leaveMs };
  return { phase: 'away', k: 0 };
}

export function bargeView(state, now) {
  const live = featureLive(state, 'barge');
  const tz = state?.meta?.tz || 'UTC';
  const at = live ? bargeAt(now, tz) : { phase: 'away', k: 0 };
  const b = state?.farm?.barge;
  const crates = [];
  // rules-goals: farm.barge.crates = { [i]: { item, qty, by: null | pid, at, flag } }, row = floor(i / 3)
  if (b && b.crates && typeof b.crates === 'object') {
    const keys = Object.keys(b.crates).map(Number).filter(Number.isInteger).sort((x, y) => x - y);
    for (const i of keys) {
      const c = b.crates[i];
      crates.push({ row: Math.floor(i / 3), i, loaded: Boolean(c && c.by), by: c?.by ?? null, item: c?.item ?? null });
    }
  }
  const rows = Number.isFinite(b?.rows) ? b.rows : crates.length ? Math.ceil(crates.length / 3) : 0;
  const upgraded = Array.isArray(state?.farm?.expansions) && state.farm.expansions.includes('riverbank');
  return { live, phase: at.phase, k: at.k, rows, crates, upgraded };
}

// ---------------------------------------------------------------------------------------------------
// The County Fair (GDD §5.6): the medal reached this week flies on the tent.
const RANK = (id) => (id.startsWith('bronze') ? 'bronze' : id.startsWith('silver') ? 'silver' : id.startsWith('gold') ? 'gold' : 'platinum');

export function fairView(state, now) {
  const live = featureLive(state, 'county_fair');
  const f = state?.farm?.fair || null;
  // rules-goals: farm.fair = { cur: { w, W, p (points x 10), ent: { item: n }, open }, last: { medal, at, ... } }
  const cur = f && f.cur ? f.cur : null;
  const tz = state?.meta?.tz || 'UTC';
  const t = localWeekMs(now, tz);
  const open = cur ? cur.open !== false : t < FAIR.closeDay * DAY + FAIR.closeHour * H;
  const points = Number.isFinite(cur?.p) ? cur.p / 10 : 0;
  const target = Number.isFinite(cur?.W) ? cur.W : 0;
  const frac = target > 0 ? points / target : 0;
  let medal = null;
  const medals = FAIR.medals.filter((m) => !m.m || liveGate(m));
  for (const m of medals) if (frac * 10_000 >= m.atBp) medal = m;
  // after the ceremony the week's result stays on the tent until the next week opens
  if (!medal && cur && cur.open === false && f.last && f.last.w === cur.w && typeof f.last.medal === 'string') medal = medals.find((m) => m.id === f.last.medal) || null;
  const out = medal ? { id: medal.id, rank: RANK(medal.id), tier: /\d$/.test(medal.id) ? Number(medal.id.at(-1)) : 1 } : null;
  const entries = cur && cur.ent && typeof cur.ent === 'object' ? Object.values(cur.ent).reduce((a, n) => a + (Number.isFinite(n) ? n : 0), 0) : 0;
  const ceremonyAt = Number.isFinite(f?.last?.at) ? f.last.at : null;
  return { live, open, medal: live ? out : null, points, target, frac, entries, ceremonyAt };
}

// ---------------------------------------------------------------------------------------------------
// Town Projects (GDD §5.9): the Hollow Village grows one landmark per finished project ("built the next day").
export function townView(state, now) {
  const live = featureLive(state, 'town_projects');
  // rules-economy: farm.town = { n: built so far, cur: null | { id, n, buildAt?, ... } }
  const t = state?.farm?.town || null;
  const n = Number.isFinite(t?.n) ? t.n : 0;
  const cur = t && t.cur ? t.cur : null;
  const built = [];
  let building = null;
  for (const p of CONTENT.townProjects.values()) {
    if (p.n <= n) built.push({ id: p.id, n: p.n, at: 0 });
    else if (cur && cur.id === p.id && Number.isFinite(cur.buildAt)) {
      // funded: built "the next day"; the landmark shows the moment buildAt passes (the system catches up after)
      if (cur.buildAt <= now) built.push({ id: p.id, n: p.n, at: cur.buildAt });
      else building = { id: p.id, n: p.n, until: cur.buildAt };
    }
  }
  built.sort((a, b) => a.n - b.n);
  return { live, built, building };
}

// ---------------------------------------------------------------------------------------------------
// The Restoration Ledger (GDD §5.9): stage = bundles finished (0..4), 4 = restored.
export function restorationView(state, now) {
  const r = state?.farm?.restore || state?.farm?.restoration || null;
  const on = featureLive(state, 'restoration');
  const lvl = farmLevel(state);
  const out = [];
  for (const p of CONTENT.restoration.values()) {
    const rec = r && r[p.id];
    let bundles = 0;
    // rules-economy: farm.restore[projectId] = { s: { ... }, b: { bundleId: at }, done? }
    if (rec && rec.b && typeof rec.b === 'object') for (const b of Object.values(rec.b)) if (Number.isFinite(b) || b === true || (b && b.done)) bundles++;
    const doneAt = rec && rec.done;
    const done = doneAt === true || (Number.isFinite(doneAt) && doneAt <= now);
    out.push({ id: p.id, n: p.n, live: on && liveGate(p) && lvl >= (p.unlock ?? 1), stage: done ? 4 : Math.min(3, bundles), done });
  }
  return out;
}

/** Restoration 3 (the Stone Bridge) is done: the Hollow Meadow is farm land (GDD §5.9). */
export function meadowOwned(state, now = Infinity) {
  return restorationView(state, now).some((p) => p.id === 'stone_bridge' && p.done);
}

/** The land rects (tiles) restorations add to the farm: ours (done projects with a land reward) together with the
 *  rules' own landRects when it exists (both only ever ADD owned land, so the union is safe). */
export function rewardLandRects(state, now = Infinity) {
  const out = [];
  for (const p of restorationView(state, now)) {
    if (!p.done) continue;
    const land = CONTENT.restoration.get(p.id)?.reward?.land;
    if (land && Array.isArray(land.rects) && liveGate(CONTENT.restoration.get(p.id))) out.push(...land.rects);
  }
  if (typeof gridRules.landRects === 'function' && state?.farm?.restore) {
    try { out.push(...gridRules.landRects(state)); } catch { /* ours is enough */ }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Giant crops (GDD §6.2 #8): a 3 x 3 block of one crop becomes one giant. Members carry `crop.giant = anchorId`;
// the anchor carries `crop.giant = true` (or { ids }). Without member marks the block is the 3 x 3 of plots of the
// same crop whose north-west corner is the anchor (else the one centred on it).
export function giantBlocks(state, now) {
  const out = new Map();
  const objs = state?.farm?.objects;
  if (!objs) return out;
  // rules-economy (actions/giant.js): every plot of a Giant, the anchor included, carries crop.giant = anchorId;
  // `true` / { ids } on an anchor are read too
  const groups = new Map();
  for (const id of Object.keys(objs).sort()) {
    const o = objs[id];
    if (o.def !== 'plot' || !o.crop || !Number.isFinite(o.x)) continue;
    const g = o.crop.giant;
    if (typeof g === 'string' && g) { if (!groups.has(g)) groups.set(g, new Set()); groups.get(g).add(id); }
    else if (g === true || (g && typeof g === 'object')) {
      if (!groups.has(id)) groups.set(id, new Set());
      groups.get(id).add(id);
      if (Array.isArray(g.ids)) for (const k of g.ids) if (Object.hasOwn(objs, k)) groups.get(id).add(k);
    }
  }
  for (const [anchor, set] of groups) {
    const a = objs[anchor];
    if (!a || a.def !== 'plot' || !a.crop) continue;
    set.add(anchor);
    const ids = [...set].sort();
    let x0 = Infinity; let z0 = Infinity;
    for (const k of ids) { x0 = Math.min(x0, objs[k].x); z0 = Math.min(z0, objs[k].z); }
    const cdef = cropOf(a.crop.def);
    const ready = isReady(a.crop, now);
    out.set(anchor, { crop: a.crop.def, ids, x: x0, z: z0, ready, stage: cdef ? (ready ? cdef.stages.length - 1 : cropStage(cdef, a.crop, now)) : 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Farm Beauty (GDD §5.9) and decor sets (§3.8). The world only uses these for ambience (butterflies, flowers,
// sparkles) and the set glow; the rules' numbers win when the rules export them (wired in beautyOf below).
let rulesBeauty = null;
let rulesSets = null;
/** The rules' pure helpers, once a rules module exports them (render/index.js wires them; tests too). */
export function useRulesHelpers({ beautyOf: b = null, decorSetsOf: d = null } = {}) {
  rulesBeauty = typeof b === 'function' ? b : null;
  rulesSets = typeof d === 'function' ? d : null;
}

function placedCentre(o, def) {
  const [w, d] = footprint(def, o.rot || 0);
  return { x: o.x + w / 2, z: o.z + d / 2 };
}

export function beautyOf(state) {
  const rb = rulesBeauty || (typeof beautyRules.beautyOf === 'function' ? beautyRules.beautyOf : null);
  if (rb) {
    try {
      const r = rb(state);
      if (r && Number.isFinite(r.score)) return { score: r.score, stars: Number.isFinite(r.stars) ? r.stars : starsFor(r.score), groups: r.groups || null };
    } catch { /* fall back to the estimate */ }
  }
  const objs = state?.farm?.objects;
  if (!objs) return { score: 0, stars: 0 };
  const copies = new Map();
  let score = 0;
  const ids = Object.keys(objs).sort();
  for (const id of ids) {
    const o = objs[id];
    const def = defOf(o.def);
    if (!def) continue;
    if (def.kind === 'building') score += FARM_BEAUTY.building;
    else if (def.kind === 'tree') score += FARM_BEAUTY.tree;
    else if (def.kind === 'decor' && Number.isFinite(def.beauty10)) {
      const n = copies.get(def.id) || 0;
      copies.set(def.id, n + 1);
      const bp = FARM_BEAUTY.copyBp[Math.min(n, FARM_BEAUTY.copyBp.length - 1)];
      const mw = o.mw === 2 ? 2 : o.mw === 1 ? 1.5 : 1;
      score += (def.beauty10 / 10) * (bp / 10_000) * mw;
    }
  }
  score = Math.round(score);
  return { score, stars: starsFor(score) };
}

export function starsFor(score) {
  let s = 0;
  for (const t of FARM_BEAUTY.stars) if (score >= t) s++;
  return s;
}

/** The decor sets a def belongs to (live sets only). */
export function setsOfDef(defId) {
  const out = [];
  for (const s of CONTENT.decorSets.values()) if (liveGate(s) && s.pieces.includes(defId)) out.push(s);
  return out;
}

/**
 * Every live decor set with its best group: a set is complete when one placed piece has every other piece of the
 * set within `radius` tiles (centre to centre). `ids` = the pieces of that group (or of the largest partial one),
 * x/z = their centre (tiles).
 */
export function decorSetsOf(state) {
  // the rules' complete groups (actions/beauty.js beautyOf().groups) are the truth for which sets are complete
  if (!rulesSets && typeof beautyRules.beautyOf === 'function' && state?.farm?.objects) {
    try {
      const groups = beautyRules.beautyOf(state).groups;
      if (Array.isArray(groups)) {
        const objs = state.farm.objects;
        return groups.filter((g) => g && Array.isArray(g.ids) && g.ids.every((id) => Object.hasOwn(objs, id))).map((g) => {
          let cx = 0; let cz = 0;
          for (const id of g.ids) { const o = objs[id]; const c = placedCentre(o, defOf(o.def)); cx += c.x; cz += c.z; }
          const set = CONTENT.decorSets.get(g.set);
          return { id: g.set, complete: true, ids: g.ids, x: cx / g.ids.length, z: cz / g.ids.length, cosmetic: set?.cosmetic };
        });
      }
    } catch { /* fall back to the estimate */ }
  }
  if (rulesSets) {
    try {
      const r = rulesSets(state);
      if (Array.isArray(r)) return r.map((s) => ({ id: s.id, complete: Boolean(s.complete), ids: s.near || s.ids || [], x: s.x, z: s.z }));
    } catch { /* fall back */ }
  }
  const objs = state?.farm?.objects;
  const out = [];
  if (!objs) return out;
  const byDef = new Map();
  for (const id of Object.keys(objs).sort()) {
    const o = objs[id];
    if (!Number.isFinite(o.x)) continue;
    const def = defOf(o.def);
    if (!def || def.kind !== 'decor') continue;
    if (!byDef.has(o.def)) byDef.set(o.def, []);
    byDef.get(o.def).push({ id, ...placedCentre(o, def) });
  }
  for (const set of CONTENT.decorSets.values()) {
    if (!liveGate(set)) continue;
    let best = null;
    for (const anchorDef of set.pieces) {
      for (const a of byDef.get(anchorDef) || []) {
        const ids = [a.id];
        let have = 1;
        for (const other of set.pieces) {
          if (other === anchorDef) continue;
          let near = null; let dBest = Infinity;
          for (const b of byDef.get(other) || []) {
            const d = Math.hypot(b.x - a.x, b.z - a.z);
            if (d <= set.radius && d < dBest) { near = b; dBest = d; }
          }
          if (near) { ids.push(near.id); have++; }
        }
        if (!best || have > best.have) best = { have, ids, a };
      }
    }
    if (!best) continue;
    let cx = 0; let cz = 0;
    for (const id of best.ids) { const o = objs[id]; const c = placedCentre(o, defOf(o.def)); cx += c.x; cz += c.z; }
    out.push({ id: set.id, complete: best.have === set.pieces.length, ids: best.ids, x: cx / best.ids.length, z: cz / best.ids.length, cosmetic: set.cosmetic });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Wave 3 (M2). Every shape below is read defensively: the rules lanes write these fields in this wave, so the world
// accepts the likely spellings and never throws on a missing one (docs/agent-notes/w3-render-world.md lists them).

/** The Festival Pavilion (GDD §5.9; content FESTIVAL_PAVILION): Town Project n >= 25 is pavilion tier n - 24; built
 *  tiers stand on the village green, the one funded and waiting for tomorrow shows its scaffold. */
export function pavilionView(state, now) {
  const P = contentAll.FESTIVAL_PAVILION || null;
  const live = featureLive(state, 'town_projects') && (P ? liveGate(P) : liveGate({ m: 'M2' }));
  const t = state?.farm?.town || null;
  const after = Number.isFinite(P?.after) ? P.after : 24;
  const n = Number.isFinite(t?.n) ? t.n : 0;
  let tiers = Number.isFinite(t?.pavilion) ? t.pavilion : Math.max(0, n - after);
  let building = null;
  const cur = t && t.cur ? t.cur : null;
  if (cur && (cur.id === 'festival_pavilion' || (Number.isFinite(cur.n) && cur.n > after)) && Number.isFinite(cur.buildAt)) {
    const tier = Number.isFinite(cur.tier) ? cur.tier : Number.isFinite(cur.n) ? cur.n - after : tiers + 1;
    if (cur.buildAt <= now) tiers = Math.max(tiers, tier); else building = tier;
  }
  return { live: live && (tiers > 0 || building !== null), tiers: live ? tiers : 0, building: live ? building : null };
}

/** The furniture defs (content's `furniture` family when it exists, else decor with an `interior` flag). */
export function furnitureDef(id) {
  const fam = CONTENT.furniture || CONTENT.interior || null;
  const d = fam && typeof fam.get === 'function' ? fam.get(id) : null;
  return d || defOf(id) || null;
}

/** The farmhouse interior (Restoration 6 "Grandma's Farmhouse": interior decorating). `live` once the project is done
 *  (or the rules mark the interior open); items from rules-economy's `farm.interior.items` = `{ iid: { def, x?, z?,
 *  rot?, wall?, at?, by } }` (floor and object pieces: x, z, rot; wall pieces: wall 'back' | 'left' and slot `at`; the
 *  room's fixed pieces have ids `fx.<i>`). The content's fixed pieces are filled in when the state has none yet (the
 *  look-dev and a save from before the room opened). A flat map under `farm.interior` / `farm.house` is read too. */
export function interiorView(state, now = Infinity) {
  const f = state?.farm || {};
  const box = f.interior || f.house || f.home || null;
  const restored = restorationView(state, now).some((p) => p.id === 'farmhouse' && p.done);
  const live = Boolean(restored || box?.open === true || box?.unlocked === true);
  const src = box && typeof box === 'object' ? (box.items && typeof box.items === 'object' ? box.items : box) : {};
  const items = [];
  const fixedSeen = new Set();
  for (const id of Object.keys(src).sort()) {
    const o = src[id];
    if (!o || typeof o !== 'object' || typeof o.def !== 'string') continue;
    const onWall = (o.wall === 'back' || o.wall === 'left') && Number.isFinite(o.at);
    if (!onWall && !(Number.isFinite(o.x) && Number.isFinite(o.z))) continue;
    if (id.startsWith('fx.')) fixedSeen.add(o.def);
    items.push(onWall ? { id, def: o.def, wall: o.wall, at: o.at, by: o.by ?? null }
      : { id, def: o.def, x: o.x, z: o.z, rot: Number.isFinite(o.rot) ? o.rot : 0, by: o.by ?? null });
  }
  const I = contentAll.INTERIOR || null;
  if (live && I && Array.isArray(I.fixed)) {
    I.fixed.forEach((p, i) => {
      if (fixedSeen.has(p.def) || items.some((it) => it.id === `fx.${i}`)) return;
      items.push(p.wall ? { id: `fx.${i}`, def: p.def, wall: p.wall, at: p.at, by: null } : { id: `fx.${i}`, def: p.def, x: p.x, z: p.z, rot: 0, by: null });
    });
  }
  return { live, items };
}

/** Grandma's visit (GDD §5.9 #6, quest E10; content GRANDMA_VISIT; rules-goals `farm.grandma` = { at, until, met,
 *  left, gift }): `phase` 'arriving' for the first GRANDMA.arriveMs (her taxi), then 'visiting' until she leaves;
 *  `stop` = where she strolls now (porch, field, orchard, barnyard, bench, parlour: one an hour, from the rules'
 *  grandmaView when it exists). Without a rules record the visit runs from E10's completion for GRANDMA_VISIT.stayMs. */
export const GRANDMA = Object.freeze({ arriveMs: 45_000, stayMs: contentAll.GRANDMA_VISIT?.stayMs || 72 * H });
export function grandmaVisit(state, now) {
  const f = state?.farm || {};
  const G = contentAll.GRANDMA_VISIT || { stops: ['porch'], strollMs: H };
  const none = { phase: 'none', at: null, until: null, k: 0, stop: null };
  const w = f.grandma || null;
  let at = Number.isFinite(w?.at) ? w.at : Number.isFinite(w?.from) ? w.from : null;
  let until = Number.isFinite(w?.until) ? w.until : null;
  if (w && w.left === true) return { ...none, at, until };
  if (at === null) {
    const q = f.quests?.done;
    if (q && Number.isFinite(q.e10)) at = q.e10;
  }
  if (at === null) return none;
  if (until === null) until = at + GRANDMA.stayMs;
  if (now < at || now >= until) return { ...none, at, until };
  let stop = null;
  if (w && typeof grandmaRules.grandmaView === 'function') {
    try { stop = grandmaRules.grandmaView(state, now)?.stop ?? null; } catch { /* the rules' view wants a full state */ }
  }
  if (!stop) stop = G.stops[Math.floor((now - at) / G.strollMs) % G.stops.length];
  if (now < at + GRANDMA.arriveMs) return { phase: 'arriving', at, until, k: (now - at) / GRANDMA.arriveMs, stop: 'porch' };
  return { phase: 'visiting', at, until, k: 1, stop };
}
