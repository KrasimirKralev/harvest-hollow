// Surprise gifts on the porch (release 1.0 D1, features#F1). Owned by the life-feel lane. A farmer wraps a present for
// the other one (rules `keepsake`): a cream box with pastel dots appears in front of the farmhouse porch, its ribbon and
// bow in the GIVER's colour, and gives a little hop now and then ("open me"). Opened by the recipient (`giftOpened`,
// predicted for the opener, from the delta for the giver) it shakes, the lid and bow fly up and tumble away, petals and
// confetti burst out, the gift's icon floats up with its name, and the box shrinks away. A box the rules shelved after
// 48 h (`giftOpened` with `auto`) just poofs. Nothing here pays or shows Hearts (scope M30).
//
// Cost: the four parts (prop:gift_box, :band, :lid, :bow from tools/build-assets.mjs, one small file loaded with the
// first box) are instances of the existing dynamic batch (render/index.js `dyn`): no draw call of their own. The ribbon
// parts are modelled white and tinted per instance with the giver's colour (batch.setColor). Matrices are written only
// while something moves; nothing is allocated per tick.
//
//   createGiftView({ dyn, fx }) -> gifts
//     gifts.setState(state, nowMs) / gifts.sync(ids, topics, state, nowMs)
//     gifts.update(dt, nowMs, { motion }) -> 0 | 1 | 2
//     gifts.onEvent(ev, meta) -> THREE.Vector3 | null   keepsake (a new box pops in) / giftOpened (it opens) -> its place
//     gifts.proxies() -> [{ id, box, gift: true }]   boxes waiting (picking)      gifts.has(id) / gifts.positionOf(id)
//     gifts.stats() -> { gifts, opening }
//   Pure (tested): isGiftDef(def), giftsOf(state) -> [{ id, x, z, by, to, color }], GIFT (timings and sizes)
import * as THREE from 'three';
import { TILE_M, SLOT_COLORS } from '../../../shared/content/config.js';
import * as content from '../../../shared/content/index.js';
import { box, merge, modelKey } from './world-kit.js';
import { models } from './models.js';
import { itemName } from './fx.js';

/** Timings (s) and sizes (m): the box body's height (tools/build-assets.mjs GB.h), the pop-in, the opening. */
export const GIFT = Object.freeze({ h: 0.66, scale: 1.3, pop: 0.45, idleEvery: 6, hop: 0.55, shake: 0.45, lidFly: 0.6, gone: 2.2,
  poof: 0.4, linger: 0.4 });
/** The box's height on the farm (the model's GIFT.h at GIFT.scale: drawn 1.3x, the loot crate's size, so it reads beside a
 *  farmer at the default zoom; on-screen check 2026-10-14 `d1-box-closed-*.png`). */
const TOP = GIFT.h * GIFT.scale;

const { defOf } = content;
/** The gift box def (content GIFT_DEF: kind 'gift'). */
export const isGiftDef = (def) => Boolean(def && def.kind === 'gift');

/** Every waiting box on the farm (objects of the gift def; the giver's colour from the players), sorted by id. Pure. */
export function giftsOf(state) {
  const out = [];
  const f = state && state.farm;
  if (!f || !f.objects) return out;
  for (const id of Object.keys(f.objects).sort()) {
    const o = f.objects[id];
    if (!o || !isGiftDef(defOf(o.def)) || !Number.isFinite(o.x) || !Number.isFinite(o.z)) continue;
    const g = f.gifts && Object.hasOwn(f.gifts, id) ? f.gifts[id] : null;
    const by = g?.by ?? o.by ?? null;
    const p = by && state.players && Object.hasOwn(state.players, by) ? state.players[by] : null;
    const color = /^#[0-9a-f]{6}$/i.test(p?.color || '') ? p.color : SLOT_COLORS[by] ?? '#E8473A';
    out.push({ id, x: o.x, z: o.z, by, to: g?.to ?? null, color });
  }
  return out;
}

// the models (tools/build-assets.mjs, section 18): stand-ins until the file is in (never shown: the box waits for it)
const fallbackBody = () => merge([box(0.9, 0.66, 0.9, '#FFF1DC')]);
const fallbackBand = () => merge([box(0.15, 0.66, 0.92, '#FFFFFF'), box(0.92, 0.66, 0.15, '#FFFFFF')]);
const fallbackLid = () => merge([box(0.98, 0.15, 0.98, '#FFF1DC')]);
const fallbackBow = () => merge([box(1.0, 0.03, 0.15, '#FFFFFF', { y: 0.14 }), box(0.15, 0.03, 1.0, '#FFFFFF', { y: 0.14 })]);
export const GIFT_KEYS = Object.freeze(['prop:gift_box', 'prop:gift_box:band', 'prop:gift_box:lid', 'prop:gift_box:bow']);

const h32 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const clamp01 = (k) => Math.min(1, Math.max(0, k));
const smooth = (k) => k * k * (3 - 2 * k);
const outBack = (k) => { const c = 1.7; const u = k - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
const PETALS = ['#FF9FB0', '#FFFFFF', '#FFE27A', '#C8B5F0', '#FFC2CF'];
const CONFETTI = ['#FF7A6B', '#2BB3A3', '#FFC83D', '#4AA8E8', '#A98BE0', '#FF9FB0'];

export function createGiftView({ dyn, fx = null } = {}) {
  const recs = new Map();
  let keys = null;
  let loaded = false;
  let loading = null;
  let clock = 0;
  let motion = 'full';
  const m4 = new THREE.Matrix4(); const m5 = new THREE.Matrix4();
  const q = new THREE.Quaternion(); const q2 = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3(); const v2 = new THREE.Vector3(); const sc = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const white = new THREE.Color('#ffffff');
  const tint = new THREE.Color();

  function ensureKeys() {
    if (keys) return;
    if (!GIFT_KEYS.some((k) => models.has(k))) loaded = true;
    keys = {
      body: modelKey(dyn, GIFT_KEYS[0], fallbackBody).key, band: modelKey(dyn, GIFT_KEYS[1], fallbackBand).key,
      lid: modelKey(dyn, GIFT_KEYS[2], fallbackLid).key, bow: modelKey(dyn, GIFT_KEYS[3], fallbackBow).key,
    };
  }

  // QA r3 R3-01: a failed load is tried again (1, 2, 4 … 30 s, or on `online`); it counted as loaded and a waiting
  // box stayed hidden for the session
  let fails = 0;
  let retryT = 0;
  function load() {
    retryT = 0;
    loading = models.ready(GIFT_KEYS.filter((k) => models.has(k))).then(() => {
      loaded = true;
      for (const r of recs.values()) if (r.waiting) { r.waiting = false; for (const k of ['body', 'band', 'lid', 'bow']) dyn.setVisible(r[k], true); r.still = false; }
    }, () => {
      loading = null;
      fails++;
      retryT = setTimeout(load, Math.min(30_000, 1000 * 2 ** (fails - 1)));
    });
  }
  globalThis.addEventListener?.('online', () => { if (retryT) { clearTimeout(retryT); load(); } });
  // R3-01: a box drawn while the manifest was lost wears the stand-in; a late manifest re-keys it to the model
  models.onManifest(() => {
    if (!keys || !keys.body.startsWith('hh:') || !GIFT_KEYS.some((k) => models.has(k))) return;
    keys = null; loaded = false;
    ensureKeys();
    for (const r of recs.values()) {
      for (const k of ['body', 'band', 'lid', 'bow']) dyn.setKey(r[k], keys[k]);
      if (!r.waiting) { r.waiting = true; for (const k of ['body', 'band', 'lid', 'bow']) dyn.setVisible(r[k], false); }
    }
    loading = null;
    if (!retryT) load();
  });

  function add(g, { fresh = false } = {}) {
    ensureKeys();
    const h = h32(g.id);
    tint.set(g.color);
    const rec = { ...g, h, yaw: (((h % 1000) / 1000) - 0.5) * 0.6, idlePhase: ((h >>> 8) % 1000) / 1000 * GIFT.idleEvery,
      body: dyn.add(keys.body, m4.identity(), white), band: dyn.add(keys.band, m4.identity(), tint),
      lid: dyn.add(keys.lid, m4.identity(), white), bow: dyn.add(keys.bow, m4.identity(), tint),
      anim: fresh ? { kind: 'pop', t: 0 } : null, goneAt: null, still: false, box: new THREE.Box3(), waiting: false };
    if (!loaded) {
      for (const k of ['body', 'band', 'lid', 'bow']) dyn.setVisible(rec[k], false);
      rec.waiting = true;
      if (!loading && !retryT) load();
    }
    recs.set(g.id, rec);
    return rec;
  }
  function drop(id, rec) {
    for (const k of ['body', 'band', 'lid', 'bow']) dyn.remove(rec[k]);
    if (fx) fx.twinkle(`gift:${id}`, null);
    recs.delete(id);
  }

  function reconcile(state, { fresh = false } = {}) {
    const live = new Set();
    for (const g of giftsOf(state)) {
      live.add(g.id);
      const rec = recs.get(g.id);
      if (!rec) add(g, { fresh });
      else {
        if (rec.goneAt !== null && !(rec.anim && rec.anim.kind === 'open')) rec.goneAt = null;   // back (an undo, a rejected prediction)
        if (rec.x !== g.x || rec.z !== g.z) { rec.x = g.x; rec.z = g.z; rec.still = false; }
        if (rec.color !== g.color) { rec.color = g.color; tint.set(g.color); dyn.setColor(rec.band, tint); dyn.setColor(rec.bow, tint); }
      }
    }
    for (const [id, rec] of recs) {
      if (live.has(id) || rec.goneAt !== null || (rec.anim && rec.anim.kind === 'open')) continue;
      rec.goneAt = clock;            // gone from the state: its giftOpened usually follows in the same task
    }
  }

  const centre = (rec) => v.set((rec.x + 0.5) * TILE_M, 0, (rec.z + 0.5) * TILE_M);

  /** Write the four matrices: the box at its place with a hop / squash / scale, the lid (and bow) on top or flying. */
  function place(rec, { hop = 0, s = 1, squash = 1, wig = 0, lidUp = 0, lidTurn = 0, lidS = 1 } = {}) {
    centre(rec);
    e.set(0, rec.yaw + wig, 0, 'YXZ');
    q.setFromEuler(e);
    v.y = hop;
    const k = s * GIFT.scale;
    m4.compose(v, q, sc.set(k, k * squash, k));
    dyn.setMatrix(rec.body, m4);
    dyn.setMatrix(rec.band, m4);
    // the lid sits on the box's top (its origin is its underside's middle), or flies up and tumbles
    m5.makeTranslation(0, GIFT.h, 0);
    m4.multiply(m5);
    if (lidUp || lidTurn || lidS !== 1) {
      q2.setFromEuler(e.set(lidTurn, 0, lidTurn * 0.6, 'XYZ'));
      m5.compose(v2.set(lidTurn * 0.35, lidUp, -lidTurn * 0.2), q2, sc.set(lidS, lidS, lidS));
      m4.multiply(m5);
    }
    dyn.setMatrix(rec.lid, m4);
    dyn.setMatrix(rec.bow, m4);
    // picking: a generous box round a waiting gift (a finger finds it)
    const c = centre(rec);
    rec.box.min.set(c.x - 0.75, 0, c.z - 0.75);
    rec.box.max.set(c.x + 0.75, TOP + 0.6, c.z + 0.75);
  }

  function burstOpen(rec) {
    if (!fx) return;
    const c = centre(rec).clone();
    const top = new THREE.Vector3(c.x, TOP + 0.2, c.z);
    fx.burst('glow', top, { n: 6, colors: ['#FFF3C4', '#FFE9A8', '#FFFFFF'], speed: 1.1, up: 2.2, size: 0.9, sizeEnd: 0.2, life: 0.7, grav: 0, spread: 0.3 });
    fx.burst('petal', top, { n: 22, colors: PETALS, speed: 2.2, up: 4.2, size: 0.26, grav: 0.18, drag: 0.8, life: 2.0, spread: 0.4, spin: 4 });
    fx.burst('confetti', top, { n: 20, colors: [...CONFETTI, rec.color], speed: 2.6, up: 4, size: 0.2, grav: 0.6, life: 1.5, spread: 0.3, spin: 6 });
    fx.burst('sparkle', top, { n: 12, colors: ['#FFE27A', '#FFFFFF'], speed: 1.8, up: 2.8, size: 0.36, grav: 0.3, life: 1.0, spread: 0.3 });
    fx.ring(new THREE.Vector3(c.x, 0.05, c.z), { color: '#FFE9A8', radius: 2.2, duration: 0.7, width: 0.25 });
    // what was inside rises with its name (it goes to the shelf: a memory, not the Barn)
    const item = rec.anim?.item;
    if (item) fx.float(new THREE.Vector3(c.x, TOP, c.z), rec.anim.label || '', { color: '#FFFFFF', icon: item, delay: 200, life: 1600, size: 1.15 });
  }
  function poof(rec) {
    if (!fx) return;
    const c = centre(rec);
    fx.burst('dust', new THREE.Vector3(c.x, 0.3, c.z), { n: 6, color: '#F3E2BE', speed: 0.9, up: 0.9, size: 0.7, sizeEnd: 1.3, grav: 0, life: 0.6 });
    fx.burst('petal', new THREE.Vector3(c.x, 0.5, c.z), { n: 5, colors: PETALS, speed: 0.8, up: 1.4, size: 0.2, grav: 0.2, life: 1.0 });
  }

  /** One animation step of rec at t (s since it began): true while it runs. */
  function animate(rec, t) {
    const a = rec.anim;
    if (a.kind === 'pop') {
      const k = clamp01(t / GIFT.pop);
      place(rec, { s: Math.max(0.01, motion === 'full' ? outBack(k) : smooth(k)) });
      if (!a.fx && fx) {
        a.fx = true;
        const c = centre(rec).clone();
        fx.burst('sparkle', new THREE.Vector3(c.x, 0.6, c.z), { n: 12, colors: ['#FFE27A', '#FFFFFF', rec.color], speed: 1.6, up: 2.4, size: 0.34, grav: 0.2, life: 0.9, spread: 0.5 });
        fx.ring(new THREE.Vector3(c.x, 0.05, c.z), { color: '#FFF3C4', radius: 1.8, duration: 0.6 });
      }
      return t < GIFT.pop;
    }
    if (a.kind === 'open') {
      let wig = 0; let squash = 1; let lidUp = 0; let lidTurn = 0; let lidS = 1; let s = 1;
      if (t < GIFT.shake) { const k = t / GIFT.shake; wig = Math.sin(t * 40) * 0.1 * (0.4 + k); squash = 1 - 0.05 * Math.sin(t * 30) * k; }
      else {
        const k = clamp01((t - GIFT.shake) / GIFT.lidFly);
        lidUp = 1.6 * k - 1.2 * k * k + 0.25 * k;                      // up and a little back down
        lidTurn = 1.4 * k;
        lidS = 1 - 0.85 * smooth(k);
        if (!a.burst) { a.burst = true; burstOpen(rec); }
      }
      const end = GIFT.gone;
      if (t > end - GIFT.poof) { const k = clamp01((t - (end - GIFT.poof)) / GIFT.poof); s = 1 - smooth(k); if (!a.poofed && k > 0.3) { a.poofed = true; poof(rec); } }
      place(rec, { wig, squash, lidUp, lidTurn, lidS: Math.max(0.01, lidS), s: Math.max(0.01, s) });
      return t < end;
    }
    // 'store': shelved by the rules (or gone without an event): a quiet poof
    const k = clamp01(t / GIFT.poof);
    place(rec, { s: Math.max(0.01, 1 - smooth(k)) });
    if (!a.poofed && k > 0.3) { a.poofed = true; poof(rec); }
    return t < GIFT.poof;
  }

  return {
    setState(state) {
      for (const [id, rec] of recs) drop(id, rec);
      reconcile(state, { fresh: false });
    },
    sync(ids, topics, state) {
      if (topics.has('*') || topics.has('objects') || topics.has('gifts')) reconcile(state, { fresh: true });
      void ids;
    },
    /** keepsake: the new box pops in (it arrives with the objects change); giftOpened: it opens. Returns its place. */
    onEvent(ev, meta = {}) {
      if (!ev || (ev.e !== 'keepsake' && ev.e !== 'giftOpened')) return null;
      const id = ev.id;
      const rec = typeof id === 'string' ? recs.get(id) : null;
      if (!rec) {
        // a box placed straight on the shelf (a walled-in porch) or one this view never drew
        return Number.isFinite(ev.x) && Number.isFinite(ev.z) ? new THREE.Vector3((ev.x + 0.5) * TILE_M, 0, (ev.z + 0.5) * TILE_M) : null;
      }
      if (ev.e === 'giftOpened') {
        const label = ev.item ? itemName(ev.item) : '';
        rec.anim = ev.auto ? { kind: 'store', t: 0, poofed: false } : { kind: 'open', t: 0, item: ev.item ?? null, label, burst: false, poofed: false };
        rec.goneAt = null;
        rec.still = false;
        if (fx) fx.twinkle(`gift:${id}`, null);
      } else if (!rec.anim) rec.anim = { kind: 'pop', t: 0 };
      return centre(rec).clone();
    },
    has(id) { return recs.has(id); },
    positionOf(id) { const r = recs.get(id); return r ? centre(r).clone() : null; },
    proxies() {
      const out = [];
      for (const [id, rec] of recs) if (!(rec.anim && rec.anim.kind !== 'pop') && rec.goneAt === null) out.push({ id, box: rec.box, gift: true });
      return out;
    },
    /** Per tick: pops, hops, openings. 2 while a pop or an opening plays, 1 while a box hops, else 0. */
    update(dt, nowMs, { motion: m = 'full' } = {}) {
      motion = m;
      clock += dt;
      if (!recs.size) return 0;
      let want = 0;
      for (const [id, rec] of recs) {
        if (rec.anim) {
          rec.anim.t += dt;
          if (!animate(rec, rec.anim.t)) {
            if (rec.anim.kind === 'pop') { rec.anim = null; rec.still = false; }
            else { drop(id, rec); continue; }
          }
          want = 2;
          continue;
        }
        if (rec.goneAt !== null) {
          if (clock - rec.goneAt > GIFT.linger) { rec.anim = { kind: 'store', t: 0, poofed: false }; }
          continue;
        }
        // "open me": a hop and a wiggle now and then (none under reduced or still motion); a resting box writes nothing
        const u = (clock + rec.idlePhase) % GIFT.idleEvery;
        const hopping = motion === 'full' && u < GIFT.hop;
        if (hopping || rec.hopped || !rec.still) {
          if (hopping) { const k = u / GIFT.hop; place(rec, { hop: Math.sin(k * Math.PI) * 0.1, wig: Math.sin(k * Math.PI * 3) * 0.08 * (1 - k), squash: 1 - 0.05 * Math.sin(k * Math.PI) }); }
          else place(rec);
          if (!rec.still && fx) fx.twinkle(`gift:${id}`, new THREE.Vector3((rec.x + 0.5) * TILE_M, TOP + 0.55, (rec.z + 0.5) * TILE_M), { color: '#FFE27A', size: 0.4 });
          rec.still = !hopping;
          rec.hopped = hopping;
          if (hopping) want = Math.max(want, 1);
        }
      }
      return want;
    },
    /** The box draws with the dynamic batch's material (no program of its own): nothing to warm up. */
    warmup() { return []; },
    stats() {
      let opening = 0;
      for (const r of recs.values()) if (r.anim && r.anim.kind !== 'pop') opening++;
      return { gifts: recs.size, opening };
    },
  };
}
