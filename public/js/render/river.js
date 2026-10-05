// The river front (GDD §2.2 "barge jetty at parcel 7", §3.9 Riverbank "jetty upgrade, willow trees", §5.7): Captain
// Reed's jetty on the north bank below the Riverbank parcel, with its posts, bollards and a lantern; once the
// Riverbank expansion is owned the jetty is upgraded (a second landing stage, a cargo crane, more lanterns) and
// weeping willows lean over the water. Static: everything lives in the scenery batch (one draw), rebuilt only when
// the Riverbank changes hands. The barge itself is barge-view.js. Owned by the render-world lane.
//
//   createRiver({ scenery, glows }) -> river
//     river.setState(state) / river.sync(ids, topics, state) / river.update() -> 0
//     river.places() -> [{ place: 'barge', args: {}, box, live }]   the jetty is where the barge panel opens
//     river.mooring -> { x, z, yaw }   where the barge ties up (metres)
//   JETTY                            the jetty's layout (pure constants, tested)
import * as THREE from 'three';
import { PLACES, riverZ, riverHalf, heightAt, WATER_Y } from './ground.js';
import { box, cyl, ball, flag, merge, modelKey, geoPart } from './world-kit.js';
import { featureLive } from './world-state.js';
import { models } from './models.js';

const J = PLACES.jetty;
/** The pier runs from the bank (z0) out over the water (z1); the barge moors broadside off its end. */
export const JETTY = Object.freeze({
  x: J.x, z0: J.z + 1.5, z1: riverZ(J.x) - riverHalf(J.x) + 3.2, deck: 0.32,
  mooring: Object.freeze({ x: J.x, z: riverZ(J.x) - riverHalf(J.x) + 5.4, yaw: 0 }),
});

const WOOD = '#B9814A';
const WOOD_D = '#8A5A35';
const ROPE = '#D9C59A';

/** The stand-in jetty: a plank pier on piles, bollards, a rope coil and a lantern post (deck at JETTY.deck). The
 *  origin is the landward end on the bank; the pier runs along +z over the water. */
function jettyGeometry() {
  const len = JETTY.z1 - JETTY.z0;
  const parts = [];
  const planks = Math.round(len / 0.42);
  for (let i = 0; i < planks; i++) parts.push(box(3.2, 0.12, 0.38, i % 3 ? WOOD : '#C99257', { y: JETTY.deck - 0.12, z: i * 0.42 + 0.21 }));
  parts.push(box(0.16, 0.18, len, WOOD_D, { x: -1.5, y: JETTY.deck - 0.3 }));
  parts[parts.length - 1].g.translate(0, 0, len / 2);
  parts.push(box(0.16, 0.18, len, WOOD_D, { x: 1.5, y: JETTY.deck - 0.3 }));
  parts[parts.length - 1].g.translate(0, 0, len / 2);
  for (let k = 0; k <= 3; k++) {
    const z = (k / 3) * (len - 0.3) + 0.15;
    for (const sx of [-1.5, 1.5]) parts.push(cyl(0.14, 0.16, 2.2, 7, WOOD_D, { x: sx, y: -1.9 + JETTY.deck, z }));
  }
  // bollards and a rope at the far end, a lantern on a post at the bank end
  for (const sx of [-1.2, 1.2]) {
    parts.push(cyl(0.14, 0.17, 0.42, 8, '#5E4A3A', { x: sx, y: JETTY.deck, z: len - 0.35 }));
    parts.push(cyl(0.2, 0.2, 0.08, 8, '#4A3A2E', { x: sx, y: JETTY.deck + 0.42, z: len - 0.35 }));
  }
  parts.push(cyl(0.34, 0.34, 0.14, 10, ROPE, { x: 0.9, y: JETTY.deck, z: len - 1.2 }));
  parts.push(cyl(0.08, 0.09, 2.3, 6, WOOD_D, { x: -1.35, y: JETTY.deck, z: 0.4 }));
  parts.push(box(0.36, 0.42, 0.36, '#3C3A36', { x: -1.35, y: JETTY.deck + 2.25, z: 0.4 }));
  parts.push(box(0.26, 0.3, 0.26, '#FFD27A', { x: -1.35, y: JETTY.deck + 2.31, z: 0.4 }, { shade: false }));
  parts.push(box(0.46, 0.08, 0.46, '#3C3A36', { x: -1.35, y: JETTY.deck + 2.67, z: 0.4 }));
  // the captain's notice board at the landward end
  parts.push(box(0.1, 1.5, 0.1, WOOD_D, { x: 1.55, y: 0, z: -0.6 }), box(0.1, 1.5, 0.1, WOOD_D, { x: 0.65, y: 0, z: -0.6 }));
  parts.push(box(1.1, 0.75, 0.08, '#E8DCC2', { x: 1.1, y: 0.75, z: -0.6 }), box(1.25, 0.1, 0.12, WOOD, { x: 1.1, y: 1.5, z: -0.6 }));
  return merge(parts);
}

/** The Riverbank upgrade in the jetty's frame: a side landing stage, a cargo crane with a crate and two lanterns. */
function upgradeGeometry() {
  const len = JETTY.z1 - JETTY.z0;
  const parts = [];
  {
    // the Riverbank upgrade: a side landing stage, a cargo crane with a hook and two more lanterns
    for (let i = 0; i < 7; i++) parts.push(box(2.6, 0.12, 0.38, i % 2 ? WOOD : '#C99257', { x: 2.9, y: JETTY.deck - 0.12, z: len - 3 + i * 0.42 }));
    for (const z of [len - 2.9, len]) parts.push(cyl(0.13, 0.15, 2.2, 7, WOOD_D, { x: 4.1, y: -1.9 + JETTY.deck, z }));
    parts.push(cyl(0.12, 0.15, 3.6, 7, WOOD_D, { x: -1.3, y: JETTY.deck, z: len - 1.4 }));
    parts.push(box(0.14, 0.14, 2.4, WOOD_D, { x: -1.3, y: JETTY.deck + 3.5, z: len - 0.5, rx: 0.25 }));
    parts.push(cyl(0.02, 0.02, 1.3, 4, ROPE, { x: -1.3, y: JETTY.deck + 2.0, z: len + 0.55 }));
    parts.push(box(0.5, 0.42, 0.5, '#C99257', { x: -1.3, y: JETTY.deck + 1.6, z: len + 0.55 }));
    for (const z of [len * 0.55, len - 0.3]) {
      parts.push(cyl(0.07, 0.08, 2.1, 6, WOOD_D, { x: 1.4, y: JETTY.deck, z }));
      parts.push(box(0.3, 0.36, 0.3, '#3C3A36', { x: 1.4, y: JETTY.deck + 2.05, z }));
      parts.push(box(0.22, 0.26, 0.22, '#FFD27A', { x: 1.4, y: JETTY.deck + 2.1, z }, { shade: false }));
    }
    parts.push(flag(0.9, 0.5, '#2BB3A3', { x: -1.3, y: JETTY.deck + 3.55, z: len - 1.4 }));
  }
  return merge(parts);
}

/** The weeping willows of the Riverbank upgrade (RD-01, QA wave 2): x along the north bank (metres), the trunk on dry
 *  ground 0.5-1.5 m behind the waterline, the crown leaning out over the water. Spots avoid the greenhouse pad, the
 *  jetty, the barge's mooring and the bridge. */
const WILLOW_X = Object.freeze([[17, 1.0, 0.9], [40.5, 0.8, 0.85], [57, 1.2, 1.0], [71, 0.7, 0.92], [79, 1.4, 1.1]]);

/** Where the bank's waterline is at x (metres): the first z north of the channel whose ground is above the water. */
export function waterlineZ(x) {
  const rz = riverZ(x);
  for (let z = rz; z > rz - 24; z -= 0.1) if (heightAt(x, z) > WATER_Y) return z;
  return rz - riverHalf(x);
}

/** The willows' trunks [{ x, z, s, yaw, lean }] (pure, tested: every base on dry ground, every crown over water). The
 *  willow model leans along its local +z; the water lies south (+z) of the north bank, so yaw stays near 0. */
export const WILLOWS = Object.freeze(WILLOW_X.map(([x, back, s], i) => {
  let z = waterlineZ(x) - back;
  // the whole trunk base stands on dry ground (the bank is steep: step back until it does)
  while (heightAt(x, z) <= WATER_Y + 0.2 || heightAt(x, z + 0.4) <= WATER_Y + 0.2) z -= 0.1;
  return Object.freeze({ x, z, s, yaw: [0.15, -0.2, 0.05, -0.1, 0.25][i % 5] });
}));
/** How far the crown's centre leans out from the trunk base (model metres, along local +z). */
export const WILLOW_REACH = 2.2;

/** One hanging frond: a curtain of leaves w wide and h long, hanging from y = 0, bowing out then falling, its lower
 *  end blunt and narrower (a squashed 5-sided tube: it reads from both sides without a double-sided material). */
function frondGeometry(w, h) {
  const g = new THREE.CylinderGeometry(w, w * 0.42, h, 5, 4, false);
  g.translate(0, -h / 2, 0);
  const P = g.getAttribute('position');
  for (let i = 0; i < P.count; i++) {
    const t = Math.min(1, Math.max(0, -P.getY(i) / h));
    // flatten across (z), bow outward (+z) near the top and hang straight below
    P.setZ(i, P.getZ(i) * 0.38 + Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5) * 0.35 - t * 0.12);
  }
  g.computeVertexNormals();
  return g;
}

/** A weeping willow stand-in (RD-01): a leaning, forked trunk under a low, drooping crown that leans out over the
 *  water, and nine separate hanging fronds round its rim, longest on the water side and open on the land side, so
 *  the trunk shows (no skirt). Fronds sway at their tips. */
export function willowGeometry() {
  const parts = [];
  const bark = '#7A5636';
  // the trunk leans toward the water (+z) and forks into two boughs under the crown
  parts.push(cyl(0.22, 0.36, 2.6, 7, bark, { rx: 0.32 }));
  parts.push(cyl(0.12, 0.2, 1.9, 6, bark, { x: 0.05, y: 2.35, z: 0.8, rx: 0.75, rz: -0.35 }));
  parts.push(cyl(0.11, 0.18, 1.8, 6, '#6E4C30', { x: -0.05, y: 2.35, z: 0.8, rx: 0.55, rz: 0.45 }));
  // the crown: a low drooping dome and two side lobes, leaning out over the water
  const R = WILLOW_REACH;
  for (const [x, z, r, c, sy] of [[0, R, 1.8, '#9DC46A', 0.42], [-1.1, R - 0.45, 1.2, '#93BE62', 0.5], [1.05, R + 0.3, 1.25, '#A9CF76', 0.45]]) {
    parts.push(ball(r, c, { x, y: 3.95, z, sy }, { sway: 0.2 }));
  }
  // the fronds: the part's own y runs 0 at the rim down to -h at the tip
  const C = ['#A5CB6E', '#98C463', '#AED27A', '#93BF5E', '#A1C86A'];
  for (let i = 0; i < 9; i++) {
    const a = -1.95 + (i / 8) * 3.9;                 // round the water side and the flanks, open toward the land (-z)
    const h = 2.1 + 0.9 * Math.cos(a * 0.6) + 0.25 * Math.sin(i * 2.3);
    const w = 0.5 + 0.12 * Math.cos(i * 1.7);
    const rx = Math.sin(a) * 1.65; const rz = R + Math.cos(a) * 1.5;
    parts.push(geoPart(frondGeometry(w, h), C[i % 5], { x: rx, y: 3.85, z: rz, ry: a }, { flat: true, sway: (x, y) => Math.max(0, -y / h) * 0.9 }));
  }
  return merge(parts);
}

export function createRiver({ scenery, glows = null } = {}) {
  let handles = [];
  let key = null;
  let liveNow = false;
  let box3 = new THREE.Box3();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3(1, 1, 1);

  function build(upgraded) {
    for (const h of handles) scenery.remove(h);
    handles = [];
    // the jetty: render-life's model (turned so its long side points into the river, stretched to reach the water)
    // or our stand-in; the Riverbank upgrade adds a landing stage and a crane in the stand-in's frame
    const len = JETTY.z1 - JETTY.z0;
    const real2 = upgraded && models.has('prop:jetty:2');
    const mk = modelKey(scenery, real2 ? 'prop:jetty:2' : 'prop:jetty', jettyGeometry);
    if (mk.real) {
      const b = mk.bounds;
      const longX = b.max.x - b.min.x > b.max.z - b.min.z;
      const along = longX ? b.max.x - b.min.x : b.max.z - b.min.z;
      // turned a quarter when its long side is along x; the stretch is along the model's own long axis
      q.setFromAxisAngle(Y, longX ? -Math.PI / 2 : 0);
      const k = len / Math.max(1, along);
      m4.compose(v.set(JETTY.x, 0, (JETTY.z0 + JETTY.z1) / 2), q, longX ? sc.set(k, 1, 1) : sc.set(1, 1, k));
    } else m4.compose(v.set(JETTY.x, 0, JETTY.z0), q.identity(), sc.set(1, 1, 1));
    handles.push(scenery.add(mk.key, m4));
    if (upgraded && !real2) {
      const uk = modelKey(scenery, 'hh-jetty-upgrade', upgradeGeometry);
      m4.compose(v.set(JETTY.x, 0, JETTY.z0), q.identity(), sc.set(1, 1, 1));
      handles.push(scenery.add(uk.key, m4));
    }
    box3 = new THREE.Box3(new THREE.Vector3(JETTY.x - 2.2, -0.5, JETTY.z0 - 1), new THREE.Vector3(JETTY.x + (upgraded ? 4.6 : 2.2), 3, JETTY.z1 + 0.6));
    // weeping willows along the Riverbank's water's edge once it is ours (GDD §3.9 #7): trunks on the dry bank,
    // crowns over the water (RD-01)
    if (upgraded) {
      const wk = modelKey(scenery, 'prop:willow', willowGeometry);
      for (const w of WILLOWS) {
        q.setFromAxisAngle(Y, w.yaw);
        m4.compose(v.set(w.x, heightAt(w.x, w.z) - 0.05, w.z), q, sc.setScalar(w.s));
        handles.push(scenery.add(wk.key, m4));
      }
    }
    // the lanterns glow at night
    if (glows) {
      const lamp = new THREE.Color('#FFD27A');
      const len = JETTY.z1 - JETTY.z0;
      const list = [{ pos: new THREE.Vector3(JETTY.x - 1.35, JETTY.deck + 2.4, JETTY.z0 + 0.4), size: 1.8, color: lamp, billboard: true },
        { pos: new THREE.Vector3(JETTY.x - 1.0, 0.1, JETTY.z0 + 1.2), size: 3.2, color: lamp, billboard: false }];
      if (upgraded) for (const zz of [len * 0.55, len - 0.3]) list.push({ pos: new THREE.Vector3(JETTY.x + 1.4, JETTY.deck + 2.2, JETTY.z0 + zz), size: 1.5, color: lamp, billboard: true });
      glows.set('world:jetty', list);
    }
  }

  let lastUp = null;
  function apply(state) {
    const up = Array.isArray(state?.farm?.expansions) && state.farm.expansions.includes('riverbank');
    liveNow = featureLive(state, 'barge');
    if (up !== lastUp) { lastUp = up; key = up ? 'up' : 'base'; build(up); return true; }
    return false;
  }

  return {
    get mooring() { return JETTY.mooring; },
    setState(state) { return apply(state); },
    sync(ids, topics, state) { if (topics.has('*') || topics.has('expansions') || topics.has('xp')) return apply(state); return false; },
    update() { return 0; },
    places() { return [{ place: 'barge', args: {}, box: box3, live: liveNow }]; },
    /** The jetty's piles standing in the water as ripple sources (RD-10): [ax, az, bx, bz, r]. */
    ripples() {
      const out = [];
      for (const z of [JETTY.z1 - 0.3, JETTY.z1 - 2.4]) for (const sx of [-1.3, 1.3]) if (heightAt(JETTY.x + sx, z) < WATER_Y) out.push([JETTY.x + sx, z, JETTY.x + sx, z, 0.16]);
      return out.slice(0, 4);
    },
    stats() { return { jetty: key, instances: handles.length }; },
  };
}
