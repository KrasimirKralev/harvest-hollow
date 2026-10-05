// Balloon loot crates (wave 4b, owner wish 1). Owned by the render lane. The ambient hot-air balloon (ambient-life.js
// balloonAt) drops a crate: it falls out of the basket, its red-and-cream parachute pops open, it sways down onto its
// tile and lands with a puff of dust while the chute folds away. A landed crate glints and gives a little hop now and
// then ("open me"). Opened (crateOpened, predicted for the opener, from the delta for the partner) it shakes, the lid
// pops open on its hinge with a burst of gold light and confetti, the loot jumps out and flies to the HUD (coins, XP,
// Acorns, items to the Barn; a partner's loot flies to their farmer), and the crate shrinks away in a poof. A crate the
// rules collected by themselves (crateOpened with `auto`) poofs and flies to the Barn.
//
// Server time drives the fall (both screens see the same descent, a late joiner sees it mid-air). Cost: the crate
// body, its lid and the parachute are three keys in the existing dynamic batch (render/index.js `dyn`: no draw call of
// their own; the ground's footprint shading marks the landing tile from the drop on); matrices are written
// only while something moves (a fall, a hop, an opening); nothing is allocated per tick.
//
//   createCrates({ dyn, fx }) -> crates
//     crates.setState(state, nowMs) / crates.sync(ids, topics, state, nowMs)
//     crates.update(dt, nowMs, { motion }) -> 0 | 1 | 2
//     crates.onEvent(ev, meta) -> THREE.Vector3 | null   (crateOpened / crateStored / crateDropped: the crate's position)
//     crates.proxies() -> [{ id, box }]   landed crates (picking)      crates.has(id) / crates.positionOf(id)
//     crates.stats() -> { crates, falling, opening }
//   Pure (tested): isCrateDef(def), cratesOf(state) -> [{ id, x, z, at }], dropPose(s, crate, from) -> pose,
//   lootOf(ev) -> [{ kind: 'coins' | 'xp' | 'acorns' | 'item', id, qty }], dropMoment(k) (the rules' pass moment), CRATE
import * as THREE from 'three';
import { TILE_M } from '../../../shared/content/config.js';
import * as content from '../../../shared/content/index.js';
import { balloonAt } from './ambient-life.js';
import { box, merge, modelKey } from './world-kit.js';
import { models } from './models.js';

/** Timings (s) and sizes (m). fall: the whole descent from the basket; out: the free fall before the chute opens. */
export const CRATE = Object.freeze({ fall: 9, out: 0.6, pop: 0.5, fold: 1.6, shake: 0.5, open: 0.35, gone: 2.4, poof: 0.4,
  idleEvery: 5, hop: 0.6, linger: 0.4, height: 1.08, chuteY: 1.02 });

// ---------------------------------------------------------------------------------------------------
// Pure helpers

const { defOf } = content;
/** The balloon schedule of the rules (content CRATES: a pass every everyMs, the drop dropAtMs into it). */
const SCHED = content.CRATES || { everyMs: 600_000, dropAtMs: 55_000 };
/** When pass `k` dropped its crate (server ms; rules crates.js dropMomentOf). */
export const dropMoment = (k) => k * SCHED.everyMs + SCHED.dropAtMs;

/** A crate def (the rules+content lane names it): kind 'crate', a `crate` flag, or an id ending in `crate`. */
export function isCrateDef(def) {
  return Boolean(def && (def.kind === 'crate' || def.crate === true || (typeof def.id === 'string' && /(^|_)(loot_)?crate$/.test(def.id) && def.kind !== 'item')));
}

const firstFinite = (...v) => v.find((x) => Number.isFinite(x));

/** Every unopened crate of the farm (objects whose def is a crate, or rows of farm.crates), sorted by id. Pure.
 *  Its drop moment `at`: its balloon pass's (rules `k`: the fall plays from the balloon on both screens even when the
 *  server's system action ran a moment later), else `droppedAt` / `placedAt`. */
export function cratesOf(state) {
  const out = [];
  const f = state && state.farm;
  if (!f) return out;
  const push = (id, o) => {
    if (!o || o.opened || o.open === true || o.done) return;
    const x = firstFinite(o.x, Array.isArray(o.at) ? o.at[0] : undefined); const z = firstFinite(o.z, Array.isArray(o.at) ? o.at[1] : undefined);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    // the pass's drop moment, unless the server placed the crate long after it (a catch-up after downtime: it is down)
    const placed = firstFinite(o.droppedAt, o.dropAt, Number.isFinite(o.at) ? o.at : undefined, o.placedAt, o.t);
    const pass = Number.isSafeInteger(o.k) ? dropMoment(o.k) : undefined;
    out.push({ id, x, z, at: Number.isFinite(pass) && (!Number.isFinite(placed) || Math.abs(placed - pass) < 60_000) ? pass : placed ?? 0 });
  };
  for (const id of Object.keys(f.objects || {}).sort()) {
    const o = f.objects[id];
    if (o && isCrateDef(defOf(o.def))) push(id, o);
  }
  // (a build that keeps crates as rows of farm.crates; the rules keep { k, n } counters there, which are no rows)
  if (f.crates && typeof f.crates === 'object' && !Array.isArray(f.crates)) {
    for (const id of Object.keys(f.crates).sort()) if (f.crates[id] && typeof f.crates[id] === 'object') push(id, f.crates[id]);
  }
  return out;
}

const smooth = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.min(1, Math.max(0, k));

/**
 * Where a crate is `s` seconds after its drop (pure, tested): { x, y, z (crate base, metres), tilt (rad, the pendulum),
 * chute (0 hidden .. 1 open; the fold after landing runs 1 -> 0), fold (0..1), landed, phase: 'out' | 'glide' | 'down' }.
 * `from` is where it left the basket (metres; null: high over its tile).
 */
export function dropPose(s, crate, from = null) {
  const tx = (crate.x + 0.5) * TILE_M; const tz = (crate.z + 0.5) * TILE_M;
  const f = from || { x: tx + 6, y: 34, z: tz - 8 };
  if (s >= CRATE.fall) {
    const k = clamp01((s - CRATE.fall) / CRATE.fold);
    return { x: tx, y: 0, z: tz, tilt: 0, chute: k < 1 ? 1 - k : 0, fold: k, landed: true, phase: 'down' };
  }
  if (s < CRATE.out) {
    const t = Math.max(0, s);
    return { x: f.x, y: f.y - 4.9 * t * t, z: f.z, tilt: 0, chute: 0, fold: 0, landed: false, phase: 'out' };
  }
  const y0 = f.y - 4.9 * CRATE.out * CRATE.out;
  const k = (s - CRATE.out) / (CRATE.fall - CRATE.out);
  const e = 1 - (1 - k) * (1 - k);                      // the wind carries it early, it settles straight down at the end
  const y = Math.max(0, y0 * (1 - k) * (0.25 + 0.75 * (1 - k)));
  const open = clamp01((s - CRATE.out) / CRATE.pop);
  // elastic pop of the canopy: overshoot, then rest
  const chute = open >= 1 ? 1 : 1 - Math.cos(open * Math.PI * 2.5) * Math.exp(-open * 4.5);
  return { x: f.x + (tx - f.x) * e, y, z: f.z + (tz - f.z) * e, tilt: 0.2 * Math.sin(s * 1.9) * (1 - 0.7 * k), chute: Math.max(0, chute), fold: 0,
    landed: false, phase: 'glide' };
}

/** The loot of a crateOpened event as a flat list (reads `ev.loot` in any of its likely shapes, and flat fields). Pure. */
export function lootOf(ev) {
  const out = [];
  if (!ev || typeof ev !== 'object') return out;
  const add = (kind, id, qty) => {
    const n = Number(qty);
    if (!(n > 0)) return;
    const k = kind === 'coin' ? 'coins' : kind === 'acorn' ? 'acorns' : kind;
    const prev = out.find((x) => x.kind === k && x.id === id);
    if (prev) prev.qty += n; else out.push({ kind: k, id, qty: n });
  };
  const items = (v) => {
    if (!v) return;
    if (typeof v === 'string') { add('item', v, 1); return; }
    if (Array.isArray(v)) {
      for (const r of v) {
        if (typeof r === 'string') add('item', r, 1);
        else if (r && typeof r === 'object') {
          const id = r.item ?? r.id ?? r.def ?? r.decor;
          const kind = r.kind === 'coins' || r.kind === 'xp' || r.kind === 'acorns' || r.kind === 'coin' || r.kind === 'acorn' ? r.kind : 'item';
          add(kind, kind === 'item' ? id : kind, r.qty ?? r.n ?? r.amount ?? 1);
        }
      }
      return;
    }
    if (typeof v === 'object') for (const [id, n] of Object.entries(v)) add('item', id, n);
  };
  const read = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { items(o); return; }
    for (const k of ['coins', 'xp', 'acorns']) if (Number.isFinite(o[k])) add(k, k, o[k]);
    items(o.items); items(o.finds); items(o.collection);
    if (o.decor) items(typeof o.decor === 'string' ? [o.decor] : o.decor);
    if (o.fertilizer) add('item', 'fertilizer', o.fertilizer);
    // the rules' crateOpened: `item` + `qty` (Fertilizer, a collection find), `goldenSeeds` packets, `decor` (a piece)
    if (typeof o.item === 'string') add('item', o.item, o.qty ?? o.n ?? 1);
    for (const k of ['golden_seed', 'golden_seeds', 'goldenSeeds']) if (Number.isFinite(o[k])) add('item', 'golden_seeds', o[k]);
  };
  read(ev.loot);
  if (!ev.loot) read(ev);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The models: tools/build-assets.mjs section 18 (`prop:loot_crate`, its hinged `:lid`, `prop:parachute`, one small file
// loaded with the first crate). A build without them shows a plain crate box (never a placeholder the size of the chute).
const fallbackCrate = () => merge([box(1.3, 0.86, 1.3, '#E3A65E'), box(1.36, 0.08, 1.36, '#5A5E6A', { y: 0.8 })]);
const fallbackLid = () => merge([box(1.42, 0.16, 1.42, '#F2C27E', { z: 0.71 })]);
const fallbackChute = () => merge([box(0.01, 0.01, 0.01, '#E8473A')]);
const CRATE_KEYS = Object.freeze(['prop:loot_crate', 'prop:loot_crate:lid', 'prop:parachute']);

const h32 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export function createCrates({ dyn, fx = null } = {}) {
  const recs = new Map();          // id -> rec
  let loaded = false;              // the crate's model file is in (or there is none: the fallback box)
  let loading = null;
  let keys = null;                 // { body, lid, chute }
  let clock = 0;
  let motion = 'full';
  let lastNow = 0;
  const m4 = new THREE.Matrix4(); const m5 = new THREE.Matrix4();
  const q = new THREE.Quaternion(); const q2 = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3(); const v2 = new THREE.Vector3(); const sc = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const X = new THREE.Vector3(1, 0, 0);

  function ensureKeys() {
    if (keys) return;
    if (!CRATE_KEYS.some((k) => models.has(k))) loaded = true;
    keys = {
      body: modelKey(dyn, 'prop:loot_crate', fallbackCrate).key,
      lid: modelKey(dyn, 'prop:loot_crate:lid', fallbackLid).key,
      chute: modelKey(dyn, 'prop:parachute', fallbackChute).key,
    };
  }
  function add(c) {
    ensureKeys();
    const h = h32(c.id);
    // the latch faces the farm camera's default side (+z, a little turned per crate): the lid swings away from the view
    const rec = { ...c, h, yaw: (((h % 1000) / 1000) - 0.5) * 0.7, body: dyn.add(keys.body, m4.identity()), lid: dyn.add(keys.lid, m4.identity()),
      chute: dyn.add(keys.chute, m4.identity()), from: null, landedFx: false, anim: null, goneAt: null, pose: null, idlePhase: (h >>> 8) % 1000 / 1000 * CRATE.idleEvery,
      box: new THREE.Box3(), still: false };
    dyn.setVisible(rec.chute, false);
    // the crate's file loads with the first crate: nothing shows until it is in (no placeholder box falling)
    if (!loaded) {
      for (const h of [rec.body, rec.lid]) dyn.setVisible(h, false);
      rec.waiting = true;
      if (!loading) {
        loading = models.ready(CRATE_KEYS.filter((k) => models.has(k))).then(() => {
          loaded = true;
          for (const r of recs.values()) if (r.waiting) { r.waiting = false; dyn.setVisible(r.body, true); dyn.setVisible(r.lid, true); r.still = false; }
        }, () => { loaded = true; });
      }
    }
    // the balloon's place at the drop (both screens: server time), or high over the tile when it is not flying
    const bl = balloonAt(rec.at);
    rec.from = bl ? { x: bl.x, y: Math.max(8, bl.y - 0.6), z: bl.z } : null;
    recs.set(c.id, rec);
    return rec;
  }
  function drop(id, rec) {
    dyn.remove(rec.body); dyn.remove(rec.lid); dyn.remove(rec.chute);
    if (fx) fx.twinkle(`crate:${id}`, null);
    recs.delete(id);
  }

  function reconcile(state, nowMs) {
    const list = cratesOf(state);
    const live = new Set();
    for (const c of list) {
      live.add(c.id);
      const rec = recs.get(c.id);
      if (!rec) add(c);
      else if (rec.goneAt !== null && !rec.anim) rec.goneAt = null;          // back (an undo, a rejected prediction)
      else if (rec.x !== c.x || rec.z !== c.z || rec.at !== c.at) { Object.assign(rec, c); rec.still = false; }
    }
    for (const [id, rec] of recs) {
      if (live.has(id) || rec.anim || rec.goneAt !== null) continue;
      // gone from the state: wait a moment for its event (crateOpened arrives right after the change), else poof
      rec.goneAt = clock;
    }
    lastNow = nowMs ?? lastNow;
  }

  /** The crate's resting matrix parts at server time `nowMs` -> writes rec.pose and the three instance matrices. */
  function place(rec, nowMs) {
    const s = (nowMs - rec.at) / 1000;
    const p = dropPose(s, rec, rec.from);
    rec.pose = p;
    let hop = 0; let wig = 0; let squash = 1;
    if (p.landed) {
      const sl = s - CRATE.fall;
      if (sl < 0.35) squash = 1 - 0.14 * Math.sin((sl / 0.35) * Math.PI);
      // "open me": a hop and a wiggle now and then (none under reduced or still motion)
      if (motion === 'full' && sl > CRATE.fold) {
        const u = ((s + rec.idlePhase) % CRATE.idleEvery);
        if (u < CRATE.hop) { const k = u / CRATE.hop; hop = Math.sin(k * Math.PI) * 0.12; wig = Math.sin(k * Math.PI * 3) * 0.1 * (1 - k); }
      }
    }
    // the crate hangs under the chute: the pendulum tilts both about the attach point
    e.set(p.tilt, rec.yaw + wig, p.tilt * 0.6, 'YXZ');
    q.setFromEuler(e);
    v.set(p.x, p.y + hop, p.z);
    m4.compose(v, q, sc.set(1, squash, 1));
    dyn.setMatrix(rec.body, m4);
    // the lid on its hinge at the back top edge
    m5.makeTranslation(0, 0.86, -0.71);
    m4.multiply(m5);
    dyn.setMatrix(rec.lid, m4);
    // the chute: above the crate while gliding, folding sideways onto the ground after the landing
    if (p.chute > 0.01 && !rec.waiting) {
      dyn.setVisible(rec.chute, true);
      if (!p.landed) {
        q.setFromEuler(e.set(p.tilt, rec.yaw, p.tilt * 0.6, 'YXZ'));
        v2.set(0, CRATE.chuteY, 0).applyQuaternion(q).add(v);
        const k = Math.max(0.12, p.chute);
        m4.compose(v2, q, sc.set(k, Math.min(1.15, k), k));
      } else {
        // it sinks, leans over with the wind and shrinks away beside the crate
        const k = p.fold;
        q.setFromEuler(e.set(0.2 + k * 1.1, rec.yaw + 0.6, 0, 'YXZ'));
        v2.set(p.x + Math.cos(rec.yaw) * 1.2 * k, CRATE.chuteY * (1 - k) + 0.05, p.z + Math.sin(rec.yaw) * 1.2 * k);
        const sk = (1 - k) * (1 - k * 0.3);
        m4.compose(v2, q, sc.set(sk * (1 + k * 0.4), sk * (1 - k * 0.7), sk * (1 + k * 0.4)));
      }
      dyn.setMatrix(rec.chute, m4);
    } else dyn.setVisible(rec.chute, false);
    // picking: a landed crate only (a generous box: a finger finds it)
    if (p.landed) rec.box.set(v.set(p.x - 0.95, 0, p.z - 0.95), v2.set(p.x + 0.95, CRATE.height + 0.3, p.z + 0.95));
    else rec.box.makeEmpty();
    return p;
  }

  /** The opening (crateOpened) or the store (crateStored) of rec at clock time t (s since it started). */
  function animate(rec, t) {
    const a = rec.anim;
    const p = rec.pose || dropPose(CRATE.fall + CRATE.fold, rec, null);
    let wig = 0; let hop = 0; let s = 1; let lidA = 0;
    if (a.kind === 'open') {
      if (t < CRATE.shake) { const k = t / CRATE.shake; wig = Math.sin(t * 42) * 0.12 * (0.4 + k); s = 1 + 0.04 * Math.sin(t * 30) * k; }
      else {
        const k = clamp01((t - CRATE.shake) / CRATE.open);
        // the lid swings back past upright with a little overshoot
        lidA = k >= 1 ? -1.95 : -1.95 * (1 - Math.cos(k * Math.PI * 1.5) * Math.exp(-k * 3.2));
        const hk = clamp01((t - CRATE.shake) / 0.3);
        hop = Math.sin(hk * Math.PI) * 0.16;
        if (!a.burst) { a.burst = true; burstOpen(rec, p); }
      }
    }
    const end = a.kind === 'open' ? CRATE.gone : CRATE.poof;
    if (t > end - CRATE.poof) { const k = clamp01((t - (end - CRATE.poof)) / CRATE.poof); s *= 1 - smooth(k); if (!a.poofed && k > 0.3) { a.poofed = true; poof(rec, p); } }
    e.set(0, rec.yaw + wig, 0, 'YXZ');
    q.setFromEuler(e);
    v.set(p.x, p.y + hop, p.z);
    m4.compose(v, q, sc.set(s, s, s));
    dyn.setMatrix(rec.body, m4);
    m5.makeTranslation(0, 0.86, -0.71);
    m4.multiply(m5);
    q2.setFromAxisAngle(X, lidA);
    m5.compose(v2.set(0, 0, 0), q2, one);
    m4.multiply(m5);
    dyn.setMatrix(rec.lid, m4);
    dyn.setVisible(rec.chute, false);
    return t < end;
  }

  function burstOpen(rec, p) {
    if (!fx) return;
    v.set(p.x, CRATE.height, p.z);
    fx.burst('glow', v, { n: 6, colors: ['#FFE9A8', '#FFD45A', '#FFFFFF'], speed: 1.2, up: 2.2, size: 0.9, sizeEnd: 0.2, life: 0.7, grav: 0, spread: 0.3 });
    fx.burst('sparkle', v, { n: 16, colors: ['#FFE27A', '#FFFFFF', '#FFC83D'], speed: 2.4, up: 3.4, size: 0.4, grav: 0.4, life: 1.0, spread: 0.4 });
    fx.burst('confetti', v, { n: 18, colors: ['#FF7A6B', '#2BB3A3', '#FFC83D', '#4AA8E8', '#A98BE0', '#FF9FB0'], speed: 2.6, up: 4, size: 0.2, grav: 0.6, life: 1.4, spread: 0.3, spin: 6 });
    fx.ring(v.set(p.x, 0.05, p.z), { color: '#FFE27A', radius: 2.4, duration: 0.7, width: 0.25, additive: true });
    // the loot jumps out of the crate and flies to the HUD (coins, XP and Acorns to their pills, items to the Barn)
    const loot = rec.anim.loot || [];
    v.set(p.x, CRATE.height * 0.9, p.z);
    loot.forEach((l, i) => {
      const id = l.kind === 'item' ? l.id : l.kind;
      fx.pop(id, v.clone(), { qty: l.qty, to: l.kind === 'item' ? null : l.kind, by: rec.anim.by, local: rec.anim.local, delay: 0.08 + i * 0.12,
        n: l.kind === 'item' ? Math.min(2, l.qty) : 2 });
    });
    if (loot.length) {
      const coins = loot.find((l) => l.kind === 'coins');
      if (coins) fx.float(v.clone(), `+${coins.qty}`, { color: '#FFE27A', icon: 'coins', delay: 250 });
    }
  }
  function poof(rec, p) {
    if (!fx) return;
    v.set(p.x, 0.4, p.z);
    fx.burst('dust', v, { n: 6, color: '#E8DCC4', speed: 0.9, up: 0.9, size: 0.7, sizeEnd: 1.3, grav: 0, life: 0.6 });
    fx.burst('sparkle', v, { n: 6, color: '#FFE27A', speed: 1.2, up: 1.6, size: 0.3, grav: 0.3, life: 0.6 });
  }

  return {
    setFx(f) { fx = f; },
    setState(state, nowMs) {
      for (const [id, rec] of recs) drop(id, rec);
      reconcile(state, nowMs);
    },
    sync(ids, topics, state, nowMs) {
      // a crate object arrives on the objects topic, a farm.crates row on its own topic (or '*')
      if (topics.has('*') || topics.has('objects') || topics.has('crates')) reconcile(state, nowMs);
      void ids;
    },
    /** A crate event: start its opening / store, and return its position (metres) for the rest of the feedback. */
    onEvent(ev, meta = {}) {
      if (!ev || typeof ev.e !== 'string' || !/^crate/.test(ev.e)) return null;
      const id = ev.id ?? ev.crate;
      const rec = id !== undefined ? recs.get(id) : null;
      if (!rec) return null;
      // opened (or stored) before it touched down: it opens on its tile, not in the air
      if (!rec.pose || !rec.pose.landed) rec.pose = dropPose(CRATE.fall + CRATE.fold, rec, null);
      const p = rec.pose;
      if (ev.e === 'crateOpened' || ev.e === 'crateOpen' || ev.e === 'crateStored' || ev.e === 'crateCollected' || ev.e === 'crateExpired') {
        // `auto`: nobody opened it in time and its loot went to the Barn by itself (a poof, the crate flies to the Barn)
        const open = (ev.e === 'crateOpened' || ev.e === 'crateOpen') && !ev.auto;
        rec.anim = { kind: open ? 'open' : 'store', loot: open ? lootOf(ev) : [], by: meta.by ?? ev.by ?? null, local: meta.local !== false, burst: false, poofed: false };
        rec.animT = 0;
        rec.goneAt = null;
        if (fx) fx.twinkle(`crate:${id}`, null);
        if (!open && fx) fx.fly('barn', new THREE.Vector3(p.x, 0.8, p.z), { to: 'barn', by: rec.anim.by, local: rec.anim.local, item: 'loot_crate', delay: 150 });
      }
      return new THREE.Vector3(p.x, 0, p.z);
    },
    has(id) { return recs.has(id); },
    positionOf(id) { const r = recs.get(id); return r && r.pose ? new THREE.Vector3(r.pose.x, 0, r.pose.z) : null; },
    /** Look-dev only: hold crate `id`'s opening at t seconds (null: run on). */
    _seek(id, t) { const r = recs.get(id); if (r && r.anim) { r.held = Number.isFinite(t); if (r.held) r.animT = t; } },
    proxies() {
      const out = [];
      for (const [id, rec] of recs) if (!rec.anim && rec.goneAt === null && rec.pose && rec.pose.landed) out.push({ id, box: rec.box, crate: true });
      return out;
    },
    /** Per tick: falls, hops, openings. 2 while an opening or a landing plays, 1 while a crate falls or idles. */
    update(dt, nowMs, { motion: m = 'full' } = {}) {
      motion = m;
      clock += dt;
      lastNow = nowMs;
      if (!recs.size) return 0;
      let want = 0;
      for (const [id, rec] of recs) {
        if (rec.anim) {
          if (!rec.held) rec.animT += dt;
          if (!animate(rec, rec.animT)) { drop(id, rec); continue; }
          want = 2;
          continue;
        }
        if (rec.goneAt !== null) {
          // vanished without an event (stored while we looked away, a resync): a quiet poof
          if (clock - rec.goneAt > CRATE.linger) { rec.anim = { kind: 'store', loot: [], by: null, local: true, burst: true, poofed: false }; rec.animT = 0; }
          continue;
        }
        const s = (nowMs - rec.at) / 1000;
        const settled = s > CRATE.fall + CRATE.fold + 0.1;
        // a resting crate between its hops writes nothing
        const u = ((s + rec.idlePhase) % CRATE.idleEvery);
        const hopping = motion === 'full' && settled && u < CRATE.hop;
        if (!settled || hopping || rec.hopped || !rec.still || !rec.pose) {
          const p = place(rec, nowMs);
          rec.still = settled && !hopping;
          rec.hopped = hopping;                  // one more write after a hop: the rest pose
          if (p.landed && !rec.landedFx) {
            rec.landedFx = true;
            // the touchdown (only when watched: a crate already down at load just sits there)
            if (fx && s < CRATE.fall + 1.5) {
              v.set(p.x, 0.1, p.z);
              fx.burst('dust', v, { n: 8, color: '#D9C7A3', speed: 1.4, up: 0.5, size: 0.6, sizeEnd: 1.2, grav: 0, life: 0.7 });
              fx.ring(v.set(p.x, 0.04, p.z), { color: '#FFFFFF', radius: 1.8, duration: 0.5, width: 0.2 });
            }
            if (fx) fx.twinkle(`crate:${id}`, v.set(p.x, CRATE.height + 0.35, p.z), { color: '#FFE27A', size: 0.42 });
          }
          want = Math.max(want, settled ? (hopping ? 1 : 0) : 1);
        }
        // the first seconds after the touchdown are feedback-rate (the dust, the fold)
        if (s >= CRATE.fall && s < CRATE.fall + CRATE.fold) want = 2;
      }
      return want;
    },
    /** The crate draws with the dynamic batch's material (no program of its own): nothing to warm up. */
    warmup() { return []; },
    stats() {
      let falling = 0; let opening = 0;
      for (const r of recs.values()) { if (r.anim) opening++; else if (r.pose && !r.pose.landed) falling++; }
      return { crates: recs.size, falling, opening };
    },
  };
}
