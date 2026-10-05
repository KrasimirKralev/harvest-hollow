// Character looks (wave 4, owner wish 9: hair style and colour, outfit colours, hat, skin tone), drawn on the existing
// farmer rigs. Owned by the render lane. The rules keep `players[pid].avatar = { body, hair, hairColor, skin, top,
// bottom, hat }` (setAvatar; content AVATAR_LOOKS is the catalog); a player who never changed it (avatar null, or no
// colour fields) keeps the rig's own look and the player colour exactly as before.
//
// How: the farmer GLBs carry a part mask per vertex (`_part`: 1 skin, 2 top, 3 bottom, 4 hair, 5 hat, 6 brows; build-assets
// AV_PARTS). addPartLook() patches the farmer's own material: a part takes its look colour, and the rig's baked hair
// (farmer B's long hair) or hat (farmer A's straw hat) is cut away when another style is chosen. Another hair style or
// hat is ONE small merged mesh (vertex colours) hung on the head bone, fitted to the measured head (headFrame()), so it
// rides every animation and the chibi head scale; a hat is fitted over the rig's real head and the chosen hair
// (headShape()), so it sits on them on both rigs. No cost for a farmer in the rig's own look; one draw more for one
// with another hair or hat.
//
//   AV_PART                                     the part ids
//   lookOf(player, rigInfo) -> look | null      normalized { body, hair, hairColor, skin, top, bottom, hat } (pure, tested)
//   accessoryGeometry(look, rigInfo) -> BufferGeometry | null   hair / hat in a unit head frame (radius 1, +Y up, +Z face);
//        rigInfo = { hair, hat, shape? }: shape = headShape() of the rig (DEFAULT_SHAPE without it)
//   addPartLook(material) -> uniforms            { cols: Color[7], on: number[7], hide: Vector2(hair, hat) }
//   applyLook(uniforms, look, rigInfo, tintUniform?)   write the colours and the cut-aways for a look (null = own look)
//   headFrame(skinnedMesh, headBone) -> Matrix4 | null   unit head frame -> head-bone local
//   headShape(skinnedMesh, headBone, frame?) -> { keep, hair, hat, chin } | null   the rig's head, baked hair and hat as
//        points in the unit head frame (what a hat is fitted over)
//   HAT_SEAT / DEFAULT_SHAPE                    where each hat's rim sits on the head / a head without a measured rig
import * as THREE from 'three';
import { addShaderPatch } from './models.js';
import { box, ball, merge, geoPart } from './world-kit.js';

export const AV_PART = Object.freeze({ skin: 1, top: 2, bottom: 3, hair: 4, hat: 5, brows: 6 });
export const HAIR_STYLES = Object.freeze(['short', 'long', 'ponytail', 'bun', 'curly', 'braid', 'buzz']);
export const HATS = Object.freeze(['none', 'straw_hat', 'cap', 'beanie', 'sun_bonnet', 'cowboy_hat', 'flower_crown']);

const HEX = /^#[0-9a-fA-F]{6}$/;
const id = (v, list) => (typeof v === 'string' && list.includes(v) ? v : null);
const hex = (v) => (typeof v === 'string' && HEX.test(v) ? v : null);

/** A player's look, normalized; null when they never chose one (the rig's own look and the player colour stay). */
export function lookOf(player, rig = {}) {
  const a = player && player.avatar;
  if (!a || typeof a !== 'object') return null;
  const look = { hair: id(a.hair, HAIR_STYLES), hairColor: hex(a.hairColor), skin: hex(a.skin), top: hex(a.top), bottom: hex(a.bottom),
    hat: id(a.hat, HATS) };
  if (!Object.values(look).some(Boolean)) return null;
  // what the rig wears itself: its baked hair and hat stay unless another is chosen
  if (!look.hair) look.hair = rig.hair || null;
  if (!look.hat) look.hat = rig.hat || 'none';
  return look;
}

// ---- the accessory meshes, in the unit head frame (headFrame(): the skull's centre, its radius 1, +Y up, +Z the face).
// A hat is fitted over what it covers: the rig's own head as measured (headShape(): skin, eyes, brows and farmer A's
// hair cap; the baked hair while it shows) and the chosen hair. So a hat sits ON the head and hair, over every style, on
// both rigs. A hair style is a set of pieces with a role under a hat that covers the head: 's' scalp (the hat is fitted
// over it), 't' top (a bun, the crown's curls: hidden under such a hat, so not drawn), 'h' hanging (a ponytail, a braid:
// never fitted over; a piece that starts under the hat, its centre above the rim, is hidden too, so a bonnet hides the
// ponytail's tie and the braid's top and the rest hangs out below); a hanging piece marked `under` is moved down to just
// below the hat's rim, so it peeks out under it instead of through it.
function capGeometry(r, thetaLen, hexc, { tilt = 0.32, y = 0.05, z = -0.06, sx = 1, sz = 1 } = {}) {
  const g = new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, thetaLen);
  return geoPart(g, hexc, { rx: -tilt, y, z, sx, sz });
}
function hairParts(style, c) {
  const p = [];
  const add = (part, role = 's', under = false) => p.push({ part, role, under });
  const dark = new THREE.Color(c).multiplyScalar(0.82).getStyle();
  if (style === 'buzz') { add(capGeometry(1.04, Math.PI * 0.42, c, { tilt: 0.25 })); return p; }
  add(capGeometry(1.1, Math.PI * 0.5, c, { tilt: 0.36 }));
  // a soft fringe over the brow
  for (let i = 0; i < 5; i++) { const a = -0.7 + i * 0.35; add(ball(0.3, i % 2 ? c : dark, { x: Math.sin(a) * 0.82, y: 0.55 - Math.abs(a) * 0.12, z: Math.cos(a) * 0.7, sx: 1.1, sy: 0.7, sz: 0.8 })); }
  if (style === 'long') {
    add(ball(1.0, c, { y: -0.55, z: -0.42, sx: 1.08, sy: 1.25, sz: 0.62 }));
    add(ball(0.55, dark, { x: -0.85, y: -0.35, z: -0.05, sx: 0.5, sy: 1.4, sz: 0.7 }));
    add(ball(0.55, dark, { x: 0.85, y: -0.35, z: -0.05, sx: 0.5, sy: 1.4, sz: 0.7 }));
  } else if (style === 'ponytail') {
    add(ball(0.22, dark, { y: 0.35, z: -1.0 }), 'h');
    add(ball(0.45, c, { y: -0.2, z: -1.15, sx: 0.8, sy: 1.5, sz: 0.8 }), 'h');
    add(ball(0.3, c, { y: -0.85, z: -1.08, sx: 0.8, sy: 1.2, sz: 0.8 }), 'h');
  } else if (style === 'bun') {
    add(ball(0.5, c, { y: 1.0, z: -0.45 }), 't');
    add(ball(0.18, dark, { y: 0.7, z: -0.55, sx: 1.6, sy: 0.6 }), 't');
  } else if (style === 'curly') {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2; const up = i % 2 ? 0.35 : 0.75;
      const x = Math.cos(a) * 0.92 * (1.1 - up * 0.4); const z = Math.sin(a) * 0.92 * (1.1 - up * 0.4) - 0.08;
      // under a hat the crown's curls are hidden; the lower ring frames the face from under the rim (none over the brow)
      const low = up < 0.5 && z < 0.55;
      add(ball(0.36, i % 3 ? c : dark, { x, y: up, z }), low ? 'h' : 't', low);
    }
    add(ball(0.5, c, { y: 1.0, z: -0.1 }), 't');
  } else if (style === 'braid') {
    for (let i = 0; i < 6; i++) add(ball(0.26 - i * 0.02, i % 2 ? dark : c, { x: (i % 2 ? 0.06 : -0.06), y: 0.1 - i * 0.32, z: -1.02 + i * 0.03, sy: 1.15 }), 'h');
    add(ball(0.12, '#E86A7A', { y: -1.85, z: -0.88 }), 'h');
  }
  return p;
}

/**
 * Where each hat sits on the unit head: the plane of its rim through (0, seat, 0), tipped back by `tilt` radians (the
 * front of the rim higher than the back; the bonnet's runs from above the brow to the nape). The flower crown is a band
 * round the hair in its plane; the others cover the head. `gap`: how far under the rim a tucked curl goes (the bonnet's
 * frill hangs below its rim).
 */
export const HAT_SEAT = Object.freeze({
  straw_hat: Object.freeze({ seat: 0.5, tilt: 0.12 }),
  cap: Object.freeze({ seat: 0.45, tilt: 0.12 }),
  beanie: Object.freeze({ seat: 0.3, tilt: 0.16 }),
  sun_bonnet: Object.freeze({ seat: 0.04, tilt: 0.55, gap: 0.26 }),
  cowboy_hat: Object.freeze({ seat: 0.52, tilt: 0.1 }),
  flower_crown: Object.freeze({ seat: 0.62, tilt: 0.16 }),
});
const COVERS = new Set(['straw_hat', 'cap', 'beanie', 'sun_bonnet', 'cowboy_hat']);
const PAD = 1.06;              // the hat's faces are chords of its curve: this much room keeps every vertex inside

/** A head to fit to without a measured rig (tests, a rig without the part mask): an egg about as big as the farmers'
 *  heads with their hair (farmer A's hair cap reaches 1.42 above the centre). */
export const DEFAULT_SHAPE = (() => {
  const keep = [];
  for (let el = -60; el <= 90; el += 15) {
    for (let az = 0; az < 360; az += 30) {
      const e = (el * Math.PI) / 180; const a = (az * Math.PI) / 180;
      keep.push(Math.sin(a) * Math.cos(e) * 1.12, 0.25 + Math.sin(e) * 1.17, -0.08 + Math.cos(a) * Math.cos(e) * 1.1);
      if (el === 90) break;
    }
  }
  return Object.freeze({ keep: Float32Array.from(keep), hair: new Float32Array(0), hat: new Float32Array(0), chin: Object.freeze([0, -1.0, 0.6]) });
})();

/** The points of `sets` (flat xyz arrays, unit head frame) whose height over the rim plane `pl` is in [lo, hi], in the
 *  hat's own frame: [x, height, z, ...]. */
function overRim(sets, pl, lo = 0, hi = Infinity) {
  const c = Math.cos(pl.tilt); const s = Math.sin(pl.tilt);
  const out = [];
  for (const a of sets) {
    if (!a) continue;
    for (let i = 0; i + 2 < a.length; i += 3) {
      const y = a[i + 1] - pl.seat;
      const v = y * c - a[i + 2] * s;
      if (v >= lo && v <= hi) out.push(a[i], v, y * s + a[i + 2] * c);
    }
  }
  return out;
}

/** The ellipse a hat stands on so that it holds the points `P` (overRim): rx, rz and its centre cz, scaled until the
 *  farthest point lies on it; q / v: each point's radius on it (1 = on the ellipse) and its height. */
function rimFit(P) {
  if (P.length < 12) return { rx: 1.05, rz: 1.05, cz: 0, top: 0.75, q: [0.9], v: [0.75] };
  let rx = 0; let top = 0; let z0 = Infinity; let z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    rx = Math.max(rx, Math.abs(P[i])); top = Math.max(top, P[i + 1]);
    z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]);
  }
  rx = Math.max(rx, 0.4);
  const cz = (z0 + z1) / 2; const rz = Math.max((z1 - z0) / 2, 0.4);
  const q = []; const v = [];
  let e = 0;
  for (let i = 0; i < P.length; i += 3) {
    const r = Math.hypot(P[i] / rx, (P[i + 2] - cz) / rz);
    q.push(r); v.push(P[i + 1]);
    e = Math.max(e, r);
  }
  for (let i = 0; i < q.length; i++) q[i] /= e;
  return { rx: rx * e, rz: rz * e, cz, top, q, v };
}

/** The lowest half-ellipsoid over the rim that holds every point: radius s (x the rim) and height h. */
function domeOver(f) {
  let best = null;
  for (let s = 1.04; s <= 1.4; s += 0.03) {
    let h = 0.25;
    for (let i = 0; i < f.q.length; i++) { const k = f.q[i] / s; h = Math.max(h, f.v[i] / Math.sqrt(1 - k * k)); }
    if (!best || s * s * h < best.s * best.s * best.h) best = { s, h };
  }
  return { s: best.s * PAD, h: best.h * PAD };
}
/** A crown of height `H` narrowing by `taper` to its top that holds every point: its radius at the rim (x the rim). */
const crownOver = (f, taper, H) => {
  let k = 1;
  for (let i = 0; i < f.q.length; i++) k = Math.max(k, f.q[i] / (1 - (taper * Math.min(f.v[i], H)) / H));
  return k * PAD;
};

/** A closed tube standing on y = 0 (a crown), its top's centre dented down by `dent`. */
function tube(rt, rb, h, seg, col, { dent = 0 } = {}) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, false);
  g.translate(0, h / 2, 0);
  const P = g.getAttribute('position');
  for (let i = 0; i < P.count; i++) {
    if (dent && P.getY(i) > h - 1e-4 && Math.hypot(P.getX(i), P.getZ(i)) < 1e-4) P.setY(i, h - dent);
  }
  return geoPart(g, col, undefined, { flat: true });
}
/** A solid ring (inner radius r0, outer r1) from y0 to y1, its faces outward (a band, a cuff). */
function band(r0, r1, y0, y1, seg, col) {
  const prof = [[r0, y1], [r0, y0], [r1, y0], [r1, y1], [r0, y1]].map(([r, y]) => new THREE.Vector2(r, y));
  return geoPart(new THREE.LatheGeometry(prof, seg), col, undefined, { flat: true });
}
/** A brim from radius r0 out to r1 (thickness th), bent: `droop` lowers its edge, `curl` lifts its sides (x), `dip`
 *  lowers its front; `phi` = [start, length] for a part of the round (a visor). */
function brim(r0, r1, col, { th = 0.07, droop = 0, curl = 0, dip = 0, seg = 20, phi = [0, Math.PI * 2], sx = 1 } = {}) {
  const m1 = r0 + (r1 - r0) / 3; const m2 = r0 + (2 * (r1 - r0)) / 3;
  // counter-clockwise round the section (r to the right, y up): the faces point outward
  const prof = [[r0, th], [r0, 0], [m1, 0], [m2, 0], [r1, 0], [r1, th], [m2, th], [m1, th], [r0, th]].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(prof, seg, phi[0], phi[1]);
  const P = g.getAttribute('position');
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i); const z = P.getZ(i); const r = Math.hypot(x, z) || 1;
    const t = Math.max(0, Math.min(1, (r - r0) / (r1 - r0)));
    P.setY(i, P.getY(i) + t * t * (curl * (x / r) * (x / r) - droop - dip * Math.max(0, z / r)));
    if (sx !== 1) P.setX(i, x * sx);
  }
  return geoPart(g, col, undefined, { flat: true });
}

/** The rim plane of the rig's own baked hat (its brim's underside), from its measured points; a straw hat's seat
 *  without them. */
function ownHatPlane(shape) {
  const H = shape && shape.hat;
  let n = 0; let sz = 0; let sy = 0; let szz = 0; let szy = 0;
  const pts = [];
  for (let i = 0; H && i + 2 < H.length; i += 3) {
    if (Math.hypot(H[i], H[i + 2]) < 1.3) continue;             // the brim, not the crown
    n++; sz += H[i + 2]; sy += H[i + 1]; szz += H[i + 2] * H[i + 2]; szy += H[i + 2] * H[i + 1];
    pts.push(H[i + 1], H[i + 2]);
  }
  if (n < 8 || szz * n - sz * sz < 1e-6) return HAT_SEAT.straw_hat;
  const b = (szy * n - sz * sy) / (szz * n - sz * sz);
  let seat = Infinity;
  for (let i = 0; i < pts.length; i += 2) seat = Math.min(seat, pts[i] - b * pts[i + 1]);
  return { seat, tilt: Math.atan(b) };
}

/** Move a hanging piece down until it is all `pl.gap` below the rim plane `pl` (it peeks out under the hat). */
function tuck(part, pl) {
  const P = part.g.getAttribute('position');
  const k = Math.tan(pl.tilt);
  const gap = pl.gap ?? 0.04;
  let over = -Infinity;
  for (let i = 0; i < P.count; i++) over = Math.max(over, P.getY(i) - (pl.seat + P.getZ(i) * k));
  if (over > -gap) part.g.translate(0, -(over + gap), 0);
}
/** A piece whose centre lies above the rim plane `pl` starts under the hat. */
function startsUnder(part, pl) {
  const g = part.g;
  if (!g.boundingBox) g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  return c.y > pl.seat + c.z * Math.tan(pl.tilt);
}

/** A strap from point a to point b (unit head frame): the bonnet's ties. */
function strap(a, b, w, col) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), 'YXZ');
  return box(w, len, 0.05, col, { x: a[0], y: a[1], z: a[2], rx: e.x, ry: e.y, rz: e.z });
}

/** Hat `hat` fitted over the points `sets` (unit head frame), as parts in the head frame. */
function hatParts(hat, sets, shape) {
  const pl = HAT_SEAT[hat];
  if (!pl) return [];
  const f = rimFit(hat === 'flower_crown' ? overRim(sets, pl, -0.2, 0.2) : overRim(sets, pl, 0));
  const rr = (f.rx + f.rz) / 2;                         // the rim's mean radius: a brim reaches out in head units
  const round = { sx: 1 / f.rx, sz: 1 / f.rz };         // keeps a ball round under the rim's scale
  const p = [];
  let ties = null;
  if (hat === 'straw_hat') {
    const H = f.top + 0.2;
    const k = crownOver(f, 0.1, H);
    p.push(tube(k * 0.9, k, H, 16, '#DCC37E'), band(k * 0.985, k * 1.035, 0.04, 0.24, 16, '#C8473A'),
      brim(k * 0.985, k + 0.75 / rr, '#E8D49A', { droop: 0.1, seg: 18 }));
  } else if (hat === 'cap') {
    const d = domeOver(f);
    p.push(geoPart(new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#C8473A', { sx: d.s, sy: d.h, sz: d.s }),
      ball(0.09, '#A8362B', { y: d.h - 0.02, ...round }),
      // the visor: the front of a brim, narrowed to the crown's width
      brim(d.s * 0.98, d.s + 0.8 / f.rz, '#B23A2E', { th: 0.06, droop: 0.22, seg: 10, phi: [-Math.PI / 2, Math.PI], sx: (d.s * 1.02) / (d.s + 0.8 / f.rz) }));
  } else if (hat === 'beanie') {
    const d = domeOver(f);
    p.push(geoPart(new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#4AA8E8', { sx: d.s, sy: d.h, sz: d.s }),
      band(d.s * 0.98, d.s * 1.07, -0.06, 0.3, 16, '#2E7FC0'), ball(0.3, '#FFF8EC', { y: d.h + 0.14, ...round }));
  } else if (hat === 'sun_bonnet') {
    const d = domeOver(f);
    p.push(geoPart(new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#F7C6D0', { sx: d.s, sy: d.h, sz: d.s }),
      band(d.s * 0.97, d.s * 1.03, 0.1, 0.24, 16, '#E86A7A'), brim(d.s * 0.98, d.s + 0.3 / rr, '#FBE3E8', { droop: 0.14, seg: 16 }));
    ties = d;
  } else if (hat === 'cowboy_hat') {
    const H = f.top + 0.34;
    const k = crownOver(f, 0.16, H);
    p.push(tube(k * 0.84, k, H, 14, '#7A4E2E', { dent: 0.22 }), band(k * 0.985, k * 1.04, 0.04, 0.2, 14, '#3A2A1A'),
      brim(k * 0.985, k + 0.95 / rr, '#8A5A35', { th: 0.08, curl: 0.55, dip: 0.12, seg: 20 }));
  } else if (hat === 'flower_crown') {
    const cols = ['#FF7A9C', '#FFD21F', '#FFFFFF', '#9C7FD0', '#FF9F43'];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      p.push(ball(i % 2 ? 0.22 : 0.17, i % 2 ? cols[(i >> 1) % 5] : '#5BAA45', { x: Math.cos(a) * 0.97, z: Math.sin(a) * 0.97, sy: i % 2 ? 1 : 0.7, ...round }));
    }
  }
  // from the hat's own frame (the rim the unit circle on y = 0) to the head frame
  const m = new THREE.Matrix4().makeRotationX(-pl.tilt).setPosition(0, pl.seat, 0)
    .multiply(new THREE.Matrix4().makeTranslation(0, 0, f.cz)).multiply(new THREE.Matrix4().makeScale(f.rx, 1, f.rz));
  for (const x of p) x.g.applyMatrix4(m);
  if (ties) {
    // the bonnet's ribbons: from the rim at the ears, round the jaw, tied under the chin
    const chin = (shape && shape.chin) || DEFAULT_SHAPE.chin;
    for (const sgn of [-1, 1]) {
      const at = new THREE.Vector3(sgn * ties.s * 0.97, 0.03, 0.1).applyMatrix4(m).toArray();
      const jaw = [sgn * 0.95, chin[1] + 0.42, chin[2] * 0.45];
      const knot = [sgn * 0.12, chin[1] - 0.04, chin[2] + 0.08];
      p.push(strap(at, jaw, 0.13, '#E86A7A'), strap(jaw, knot, 0.13, '#E86A7A'));
    }
    p.push(ball(0.12, '#E86A7A', { y: chin[1] - 0.06, z: chin[2] + 0.1 }));
  }
  return p;
}

/** The look's own hair and hat (unit head frame), or null when the rig's own hair and hat are the look's. `rig.shape`
 *  is the rig's measured head (headShape()); without it a hat fits DEFAULT_SHAPE. */
export function accessoryGeometry(look, rig = {}) {
  if (!look) return null;
  const shape = rig.shape || DEFAULT_SHAPE;
  const hat = look.hat && look.hat !== 'none' ? look.hat : null;
  const ownHat = Boolean(hat) && hat === rig.hat;
  const ownHair = !look.hair || look.hair === rig.hair;
  const hair = ownHair ? [] : hairParts(look.hair, look.hairColor || '#5A3A22');
  // a hat that covers the head (the rig's own, or one of ours) hides the hair's top and tucks its hanging curls under
  const cover = hat && COVERS.has(hat) ? (ownHat ? ownHatPlane(shape) : HAT_SEAT[hat]) : null;
  const kept = cover ? hair.filter((x) => x.role !== 't' && !(x.role === 'h' && !x.under && startsUnder(x.part, cover))) : hair;
  if (cover) for (const x of kept) if (x.under) tuck(x.part, cover);
  const parts = kept.map((x) => x.part);
  if (hat && !ownHat) {
    const sets = [shape.keep, ownHair ? shape.hair : null, ...kept.filter((x) => x.role === 's').map((x) => x.part.g.getAttribute('position').array)];
    parts.push(...hatParts(hat, sets, shape));
  }
  return parts.length ? merge(parts) : null;
}

/** The look patch on a farmer's own (cloned) material: per-part colours and the cut-aways. */
export function addPartLook(material) {
  const U = { cols: { value: Array.from({ length: 7 }, () => new THREE.Color()) }, on: { value: new Array(7).fill(0) }, hide: { value: new THREE.Vector2(0, 0) } };
  addShaderPatch(material, 'hh-parts', (shader) => {
    shader.uniforms.uPartCol = U.cols; shader.uniforms.uPartOn = U.on; shader.uniforms.uPartHide = U.hide;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float _part;\nvarying float vPart;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = _part;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uPartCol[ 7 ];\nuniform float uPartOn[ 7 ];\nuniform vec2 uPartHide;\nvarying float vPart;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          int hhP = int( vPart + 0.5 );
          if ( ( hhP == 4 && uPartHide.x > 0.5 ) || ( hhP == 5 && uPartHide.y > 0.5 ) ) discard;
          for ( int i = 1; i < 7; i ++ ) if ( i == hhP && uPartOn[ i ] > 0.5 ) diffuseColor.rgb = uPartCol[ i ];
        }`);
  }, 'v1');
  material.userData.parts = U;
  return U;
}

/** Write a look into the patch's uniforms (null: the rig's own colours, nothing cut away). `tint` (the clothing mask's
 *  uniform, models.js addTintMask) follows the look's colour for that garment, so the two never disagree. */
export function applyLook(U, look, rig = {}, tint = null, tintPart = 0) {
  const set = (part, h) => { if (h) { U.cols.value[part].set(h); U.on.value[part] = 1; } else U.on.value[part] = 0; };
  set(AV_PART.skin, look && look.skin);
  set(AV_PART.top, look && look.top);
  set(AV_PART.bottom, look && look.bottom);
  set(AV_PART.hair, look && look.hairColor);
  set(AV_PART.brows, look && look.hairColor);
  U.hide.value.set(look && look.hair && look.hair !== rig.hair ? 1 : 0, look && look.hat !== rig.hat ? 1 : 0);
  if (tint && look && tintPart && look[tintPart === AV_PART.top ? 'top' : 'bottom']) tint.value.set(look[tintPart === AV_PART.top ? 'top' : 'bottom']);
}

/** The unit head frame in the head bone's local space: centred on the head, scaled to its radius, +Y up and +Z the
 *  face (the rig's rest pose; the bone carries it through every clip). */
export function headFrame(mesh, head) {
  const geo = mesh && mesh.geometry;
  if (!geo || !head || !mesh.skeleton) return null;
  const hi = mesh.skeleton.bones.indexOf(head);
  if (hi < 0) return null;
  const P = geo.getAttribute('position'); const SI = geo.getAttribute('skinIndex'); const SW = geo.getAttribute('skinWeight');
  const part = geo.getAttribute('_part');
  const m = new THREE.Matrix4().multiplyMatrices(mesh.skeleton.boneInverses[hi], mesh.bindMatrix);
  const b = new THREE.Box3(); const v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (SI.getComponent(i, k) === hi) w += SW.getComponent(i, k);
    if (w < 0.5) continue;
    // the head itself (skin), not a hat brim or long hair, sets its size
    if (part && part.getX(i) !== AV_PART.skin) continue;
    b.expandByPoint(v.fromBufferAttribute(P, i).applyMatrix4(m));
  }
  if (b.isEmpty()) return null;
  const c = b.getCenter(new THREE.Vector3()); const s = b.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.y, s.z) * 0.5;
  head.updateMatrixWorld(true);
  const q = new THREE.Quaternion(); head.getWorldQuaternion(q);
  const qi = q.clone().invert();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(qi).normalize();
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(qi).normalize();
  const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
  fwd.crossVectors(right, up).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, up, fwd).scale(new THREE.Vector3(r, r, r));
  // the frame's centre a little above the box centre: the box includes the jaw and the neck
  basis.setPosition(c.clone().addScaledVector(up, r * 0.08));
  return basis;
}

/**
 * The rig's own head in the unit head frame, as points a hat is fitted over (rest pose, after the chibi scale):
 * { keep: what always shows (skin, eyes, brows; farmer A's hair cap is in its brows part), hair: the baked hair (shown
 * unless another style is chosen), hat: the baked hat, chin: [x, y, z] the lowest point of the face }. Flat xyz arrays,
 * one point per 0.04 cell. Measured once per rig load, like headFrame.
 */
export function headShape(mesh, head, frame = headFrame(mesh, head)) {
  const geo = mesh && mesh.geometry;
  if (!geo || !head || !frame || !mesh.skeleton) return null;
  const hi = mesh.skeleton.bones.indexOf(head);
  if (hi < 0) return null;
  const P = geo.getAttribute('position'); const SI = geo.getAttribute('skinIndex'); const SW = geo.getAttribute('skinWeight');
  const part = geo.getAttribute('_part');
  const m = new THREE.Matrix4().copy(frame).invert().multiply(mesh.skeleton.boneInverses[hi]).multiply(mesh.bindMatrix);
  const out = { keep: [], hair: [], hat: [] };
  const seen = new Set();
  const v = new THREE.Vector3();
  let chin = null;
  for (let i = 0; i < P.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (SI.getComponent(i, k) === hi) w += SW.getComponent(i, k);
    if (w < 0.5) continue;
    const p = part ? Math.round(part.getX(i)) : AV_PART.skin;
    const list = p === AV_PART.hair ? out.hair : p === AV_PART.hat ? out.hat : p === AV_PART.top || p === AV_PART.bottom ? null : out.keep;
    if (!list) continue;
    v.fromBufferAttribute(P, i).applyMatrix4(m);
    if (p === AV_PART.skin && v.z > 0.2 && (!chin || v.y < chin[1])) chin = [v.x, v.y, v.z];
    const key = `${p}:${Math.round(v.x * 25)}:${Math.round(v.y * 25)}:${Math.round(v.z * 25)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(v.x, v.y, v.z);
  }
  if (!out.keep.length) return null;
  return { keep: Float32Array.from(out.keep), hair: Float32Array.from(out.hair), hat: Float32Array.from(out.hat), chin: chin ? [0, chin[1], chin[2]] : DEFAULT_SHAPE.chin };
}
