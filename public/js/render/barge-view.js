// Captain Reed's river barge (GDD §5.7): it sails in from the west on Monday 06:00, ties up off the jetty, rides
// the water while the couple loads crates (every loaded crate stands on its deck, in the loader's slot order), and
// casts off on Sunday 20:00: it swings round and sails away west. The schedule is the farm's calendar (both screens
// see the same barge); the arrival and the departure play their render-life fx (`bargeArrived`, `bargeDeparted`)
// only when this screen sees them happen. The barge and its crates are instances in the small dynamic batch (one
// draw call while the barge is out on the river, none while it is away). Owned by the render-world lane.
//
//   createBargeView({ dyn, fx, mooring }) -> barge
//     barge.setState(state) / barge.sync(ids, topics, state) / barge.update(dt, now, { motion }) -> 0 | 1
//     barge.places() -> [{ place: 'barge', args: {}, box, live }]   (the barge itself is clickable while docked)
//     barge.pose -> { x, z, yaw, visible, phase }                    (tests and look-dev)
//   bargePose(view, mooring, t) -> { x, z, yaw, visible }           where the barge is in its schedule (pure, tested)
//   BARGE_SLOTS                                                     the stand-in's crate spots on deck
import * as THREE from 'three';
import { riverZ, WATER_Y } from './ground.js';
import { box, cyl, flag, merge, modelKey } from './world-kit.js';
import { bargeView } from './world-state.js';
import { models } from './models.js';

const FAR_X = -120;                  // where the barge comes from and goes back to (beyond the west bend)
const OFF = 2.8;                     // the barge keeps to the north half of the river
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t;

/** The barge's place on the river at its schedule point (pure). Bow along +x in the model. */
export function bargePose(view, mooring, t = 0) {
  const pathZ = (x) => riverZ(x) - OFF;
  const slope = (x) => (pathZ(x + 0.5) - pathZ(x - 0.5));
  if (!view || view.phase === 'away') return { x: FAR_X, z: pathZ(FAR_X), yaw: 0, visible: false };
  if (view.phase === 'docked') {
    return { x: mooring.x, z: mooring.z, yaw: 0, visible: true, bob: 0.04 * Math.sin(t * 1.3), roll: 0.018 * Math.sin(t * 0.9 + 1) };
  }
  if (view.phase === 'arriving') {
    const k = easeOut(view.k);
    const x = FAR_X + (mooring.x - FAR_X) * k;
    // the last 15 % eases sideways onto the mooring line
    const z = view.k > 0.85 ? pathZ(x) + (mooring.z - pathZ(mooring.x)) * ((view.k - 0.85) / 0.15) : pathZ(x);
    // the bow straightens along the jetty as she comes alongside
    const settle = view.k > 0.7 ? Math.min(1, (view.k - 0.7) / 0.3) : 0;
    return { x, z, yaw: -Math.atan(slope(x)) * (1 - settle * settle * (3 - 2 * settle)), visible: true, bob: 0.03 * Math.sin(t * 1.6) };
  }
  // leaving: swing round off the jetty (bow to the west), then sail away
  if (view.k < 0.25) {
    const k = view.k / 0.25;
    const s = k * k * (3 - 2 * k);
    return { x: mooring.x - 1.5 * s, z: mooring.z + 1.6 * Math.sin(s * Math.PI), yaw: Math.PI * s, visible: true, bob: 0.03 * Math.sin(t * 1.6) };
  }
  const k2 = (view.k - 0.25) / 0.75;
  const k = easeIn(k2);
  const x = mooring.x - 1.5 + (FAR_X - mooring.x + 1.5) * k;
  // ease from the swing's end (on the mooring line, bow due west) onto the river's line over the first stretch
  const b = Math.min(1, k2 / 0.2);
  const blend = b * b * (3 - 2 * b);
  const z = mooring.z + (pathZ(x) - mooring.z) * blend;
  return { x, z, yaw: Math.PI - Math.atan(slope(x)) * blend, visible: view.k < 0.999, bob: 0.03 * Math.sin(t * 1.6) };
}

// ---------------------------------------------------------------------------------------------------
// Stand-ins (render-life's `prop:barge` / `prop:barge_crate` replace them when the manifest has them)
const HULL = '#2F5D6B';
const STRIPE = '#C8473A';
const CREAM = '#EFE3C8';
const DECK = '#C99257';
/** 3 x 3 crate spots on the open hold (model metres, deck top y). */
export const BARGE_SLOTS = Object.freeze([-2.6, -1.4, -0.2].flatMap((x) => [-0.95, 0, 0.95].map((z) => Object.freeze([x + 1.6, 0.62, z]))));

function hullGeometry() {
  const sh = new THREE.Shape();
  sh.moveTo(-6, -1.8); sh.lineTo(3.2, -1.8); sh.quadraticCurveTo(5.6, -1.6, 6.1, 0); sh.quadraticCurveTo(5.6, 1.6, 3.2, 1.8);
  sh.lineTo(-6, 1.8); sh.quadraticCurveTo(-6.3, 0, -6, -1.8);
  const ext = (depth) => {
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 5 });
    g.rotateX(-Math.PI / 2);          // the outline lies in x-z, the extrusion rises along y
    return g;
  };
  const parts = [];
  const hull = ext(1.05);   // the hull: 0.5 m under the waterline, its sides up to the deck
  hull.translate(0, -0.5, 0);
  parts.push({ g: hull.toNonIndexed(), c: null, hex: HULL });
  const stripe = ext(0.14);
  stripe.scale(1.012, 1, 1.03);
  stripe.translate(0, 0.32, 0);
  parts.push({ g: stripe.toNonIndexed(), hex: STRIPE });
  const gun = ext(0.1);
  gun.scale(1.02, 1, 1.04);
  gun.translate(0, 0.55, 0);
  parts.push({ g: gun.toNonIndexed(), hex: CREAM });
  const out = [];
  for (const p of parts) {
    p.g.deleteAttribute('uv');
    p.g.computeVertexNormals();
    out.push({ g: p.g, c: new THREE.Color(p.hex).toArray(), sway: 0, shade: true });
  }
  // deck, the cabin aft, a wheel-house roof, the mast with Captain Reed's teal pennant and a lantern
  out.push(box(10.6, 0.08, 3.3, DECK, { x: -0.4, y: 0.5 }));
  out.push(box(2.6, 1.5, 2.8, CREAM, { x: -4.4, y: 0.55 }));
  out.push(box(3.0, 0.16, 3.2, STRIPE, { x: -4.4, y: 2.05 }));
  out.push(box(2.0, 0.5, 2.4, STRIPE, { x: -4.4, y: 2.2, sx: 1, sz: 0.85 }));
  for (const z of [-1.42, 1.42]) out.push(box(0.6, 0.5, 0.06, '#9CC9E8', { x: -4.0, y: 1.25, z }, { shade: false }));
  out.push(box(0.06, 0.5, 0.9, '#9CC9E8', { x: -3.08, y: 1.25 }, { shade: false }));
  out.push(cyl(0.07, 0.09, 3.2, 6, '#8A5A35', { x: 4.1, y: 0.55 }));
  out.push(flag(0.9, 0.55, '#2BB3A3', { x: 4.1, y: 3.7 }));
  out.push(box(0.22, 0.28, 0.22, '#FFD27A', { x: 4.1, y: 2.4, z: 0.16 }, { shade: false }));
  // fenders along the side the jetty sees
  for (const x of [-3, 0, 3]) out.push(cyl(0.16, 0.16, 0.5, 8, '#3C3A36', { x, y: -0.05, z: -1.86, rx: Math.PI / 2 }));
  // the open hold's low rim
  out.push(box(6.2, 0.12, 0.1, '#8A5A35', { x: 0.2, y: 0.55, z: -1.45 }), box(6.2, 0.12, 0.1, '#8A5A35', { x: 0.2, y: 0.55, z: 1.45 }));
  return merge(out);
}

function crateGeometry() {
  const parts = [box(0.82, 0.7, 0.82, '#C99257'), box(0.86, 0.1, 0.86, '#A8733F', { y: 0.7 })];
  for (const y of [0.16, 0.5]) parts.push(box(0.84, 0.08, 0.84, '#8A5A35', { y }));
  parts.push(box(0.3, 0.3, 0.02, '#E8DCC2', { y: 0.22, z: 0.415 }, { shade: false }));
  return merge(parts);
}

export function createBargeView({ dyn, fx = null, mooring }) {
  let view = { live: false, phase: 'away', k: 0, crates: [] };
  let state = null;
  let barge = null;                 // handle in dyn
  let bargeKey = null;
  const crates = [];                // handles
  let slots = BARGE_SLOTS;
  let waterline = -0.05;              // the stand-in's hull sits 0.5 m deep with its deck at +0.55
  let pose = { x: FAR_X, z: 0, yaw: 0, visible: false, phase: 'away' };
  let seenPhase = null;             // the phase this screen last saw (fx only on a transition watched live)
  let clock = 0;
  let wakeAt = 0;
  const m4 = new THREE.Matrix4();
  const mc = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const box3 = new THREE.Box3();

  function ensure() {
    if (barge !== null) return;
    const mk = modelKey(dyn, 'prop:barge', hullGeometry);
    bargeKey = mk.key;
    const info = mk.real ? models.info('prop:barge') : null;
    if (info && Array.isArray(info.slots) && info.slots.length) slots = info.slots;
    waterline = info && Number.isFinite(info.waterline) ? info.waterline : -0.05;
    barge = dyn.add(bargeKey, m4.identity());
    dyn.setVisible(barge, false);
  }

  function loadedCount() { return view.crates.filter((c) => c.loaded).length; }

  function syncCrates() {
    ensure();
    const want = Math.min(slots.length, loadedCount());
    const ck = modelKey(dyn, 'prop:barge_crate', crateGeometry).key;
    while (crates.length < want) { const h = dyn.add(ck, m4.identity()); crates.push(h); }
    while (crates.length > want) dyn.remove(crates.pop());
  }

  function place(t) {
    pose = { ...bargePose(view, mooring, t), phase: view.phase };
    if (barge === null) return;
    dyn.setVisible(barge, pose.visible);
    for (const h of crates) dyn.setVisible(h, pose.visible);
    if (!pose.visible) return;
    e.set(pose.roll || 0, pose.yaw, 0, 'YXZ');
    q.setFromEuler(e);
    // render-life's barge carries its waterline (model metres): it floats there, not on its keel
    m4.compose(v.set(pose.x, WATER_Y - waterline + (pose.bob || 0), pose.z), q, one);
    dyn.setMatrix(barge, m4);
    crates.forEach((h, i) => {
      const s = slots[i];
      mc.makeTranslation(s[0], s[1], s[2]);
      // each crate a few degrees off square: stacked by hand, not printed
      mc.multiply(new THREE.Matrix4().makeRotationY(((i * 37) % 11 - 5) * 0.025));
      dyn.setMatrix(h, m4.clone().multiply(mc));
    });
    box3.setFromCenterAndSize(v.set(pose.x, WATER_Y + 1.2, pose.z), new THREE.Vector3(13, 3.2, 13));
  }

  function apply(s, now) {
    state = s;
    view = bargeView(s, now);
    syncCrates();
  }

  return {
    get pose() { return pose; },
    setState(s, now) { apply(s, now); seenPhase = null; place(clock); },
    sync(ids, topics, s, now) {
      if (topics.has('*') || topics.has('barge') || topics.has('xp') || topics.has('expansions')) { apply(s, now); place(clock); }
    },
    update(dt, now, { motion = 'full' } = {}) {
      clock += dt;
      if (!state) return 0;
      const before = view.phase;
      view = bargeView(state, now);
      if (Math.min(slots.length, loadedCount()) !== crates.length) syncCrates();
      // fx on transitions this screen watched (never on a page load mid-week)
      if (seenPhase !== null && before !== view.phase && fx) {
        if (view.phase === 'arriving') fx.play({ e: 'bargeArrived' }, new THREE.Vector3(mooring.x, 0, mooring.z), {});
        if (view.phase === 'leaving') fx.play({ e: 'bargeDeparted' }, new THREE.Vector3(mooring.x, 0, mooring.z), {});
        try { dispatchEvent(new CustomEvent('hh:world', { detail: { kind: view.phase === 'leaving' ? 'bargeDeparted' : view.phase === 'arriving' ? 'bargeArrived' : view.phase } })); } catch { /* no window */ }
      }
      seenPhase = view.phase;
      const moving = view.phase === 'arriving' || view.phase === 'leaving';
      const t = motion === 'still' ? 0 : clock;
      if (view.phase !== 'away' || pose.visible) place(t);
      // a wake of flat rings behind a moving barge
      if (moving && fx && motion !== 'still' && clock > wakeAt) {
        wakeAt = clock + 0.35;
        const back = view.phase === 'arriving' ? -5.5 : 5.5;
        fx.burst('ring', new THREE.Vector3(pose.x + Math.cos(pose.yaw) * back, WATER_Y + 0.04, pose.z - Math.sin(pose.yaw) * back),
          { n: 1, color: '#E4F4FF', speed: 0, up: 0, size: 0.4, sizeEnd: 2.6, grav: 0, spin: 0, life: 1.6, y: 0, spread: 0, alpha: 0.5, ambient: true, flat: true, additive: false });
      }
      if (moving) return 2;
      return pose.visible && motion !== 'still' ? 1 : 0;
    },
    places() { return [{ place: 'barge', args: {}, box: box3.clone(), live: view.live && pose.visible }]; },
    /** The hull as a ripple capsule for the water (RD-10): [ax, az, bx, bz, r] along the heading, none while away. */
    ripples() {
      if (!pose.visible) return [];
      const c = Math.cos(pose.yaw); const sn = Math.sin(pose.yaw);
      return [[pose.x - c * 4.6, pose.z + sn * 4.6, pose.x + c * 4.6, pose.z - sn * 4.6, 1.75]];
    },
    stats() { return { phase: view.phase, crates: crates.length, visible: pose.visible }; },
  };
}
