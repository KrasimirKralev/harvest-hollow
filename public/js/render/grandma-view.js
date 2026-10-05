// Grandma's visit on the farm (GDD §5.9 Restoration 6, quest E10 "Grandma Comes Home": "A taxi at the gate. Grandma
// Hazel steps out, looks at the farm for a long moment ..."; content GRANDMA_VISIT, rules-goals farm.grandma). When
// she arrives (world-state grandmaVisit), a yellow taxi drives along the lane and stops level with the farmhouse;
// Grandma appears on the porch in a puff of sparkles as it waits, and it drives off east. For the rest of her visit
// she strolls the farm, one stop an hour on the rules' clock (porch, field, orchard, barnyard, bench, parlour):
// beside the nearest plot, fruit tree, animal home or bench to the farmhouse, on a free tile, facing it, now and then
// waving; in the parlour hour and at night she is inside (interior-view.js). Her rocking chair waits on the porch. A
// click on her opens the farmhouse panel's visit card (place 'farmhouse', args { tab: 'grandma' }). Owned by the
// render-world lane.
//
//   createGrandmaVisit({ layers, dyn, scenery, fx }) -> visit
//     visit.setState(state, now) / visit.sync(ids, topics, state, now) / visit.update(dt, now, { motion }) -> 0 | 1 | 2
//     visit.places() -> [{ place: 'farmhouse', args: { tab: 'grandma' }, box, live }]
//   taxiAt(k, stopX) -> { x, z, yaw, visible }   the taxi along the lane over the arrival (k 0..1, pure, tested)
//   porchOf(house, free?) -> { x, z, yaw } | null   where Grandma stands: the first free spot by the door, the front
//                                                corners, the sides, the back (metres, facing out)
//   strollSpot(state, house, stop, free?) -> { x, z, yaw } | null   where she stands for a stroll stop (null: inside)
import * as THREE from 'three';
import { TILE_M } from '../../../shared/content/config.js';
import { defOf } from '../../../shared/content/index.js';
import { footprint, getGrid, inLand } from '../../../shared/rules/grid.js';
import * as grid from '../../../shared/rules/grid.js';
import { WORLD_TILES } from '../../../shared/content/config.js';
import { laneZ } from './ground.js';
import { box, cyl, ball, merge, modelKey } from './world-kit.js';
import { grandmaVisit } from './world-state.js';
import { WORLD } from './world-uniforms.js';
import { makeFigure } from './interior-view.js';
import { models } from './models.js';

/** The arrival's beats (fractions of GRANDMA.arriveMs): the taxi drives in, waits, drives away. */
export const ARRIVAL = Object.freeze({ in: 0.3, stepOut: 0.36, leave: 0.66, from: -70, to: 210 });
const ease = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;

/** Where the taxi is during the arrival (pure): in from the west, stopped level with the farmhouse, off to the east. */
export function taxiAt(k, stopX) {
  if (!(k >= 0) || k >= 1) return { x: ARRIVAL.to, z: laneZ(ARRIVAL.to) + 1.2, yaw: Math.PI / 2, visible: false };
  let x;
  if (k < ARRIVAL.in) x = ARRIVAL.from + (stopX - ARRIVAL.from) * ease(k / ARRIVAL.in);
  else if (k < ARRIVAL.leave) x = stopX;
  else x = stopX + (ARRIVAL.to - stopX) * easeIn((k - ARRIVAL.leave) / (1 - ARRIVAL.leave));
  // the farm side of the lane, nose east (+x)
  return { x, z: laneZ(x) - 1.3, yaw: Math.PI / 2, visible: true };
}

/** Where Grandma may stand round the farmhouse, best first (its own frame: the front is +z, the door in the middle):
 *  on the porch by the door, at the front corners, by the side walls, behind it. */
export const PORCH_SPOTS = Object.freeze([[0.2, 4.8, 0], [-2.6, 4.8, 0], [2.6, 4.8, 0], [-4.8, 1.5, -Math.PI / 2], [4.8, 1.5, Math.PI / 2], [0, -4.8, Math.PI]]
  .map((p) => Object.freeze(p)));
/** Grandma's place: the first porch spot whose ground tile is free farm land (`free(tx, tz)`), facing out (metres). */
export function porchOf(house, free = () => true) {
  const c = Math.cos(house.yaw); const s = Math.sin(house.yaw);
  for (const [lx, lz, face] of PORCH_SPOTS) {
    const x = house.x + lx * c + lz * s; const z = house.z - lx * s + lz * c;
    if (free(Math.floor(x / TILE_M), Math.floor(z / TILE_M))) return { x, z, yaw: house.yaw + face };
  }
  return null;
}

/** What each stroll stop is beside (content GRANDMA_VISIT.stops): the kind of object nearest the farmhouse. */
const STOP_KIND = Object.freeze({ field: (d) => d.kind === 'plot', orchard: (d) => d.kind === 'tree' && d.id !== 'pine', barnyard: (d) => d.kind === 'home',
  bench: (d) => d.effect !== undefined && d.effect !== null && d.effect.seats !== undefined });
/** Where Grandma stands for a stroll stop (pure): the porch, or a free tile beside the object of the stop's kind nearest
 *  the farmhouse, facing it; null in the parlour (she is inside). Falls back to the porch. */
export function strollSpot(state, house, stop, free = () => true) {
  if (stop === 'parlour') return null;
  const pred = STOP_KIND[stop];
  if (!pred || !house) return house ? porchOf(house, free) : null;
  const objs = state?.farm?.objects || {};
  let best = null;
  for (const id of Object.keys(objs).sort()) {
    const o = objs[id]; const d = defOf(o.def);
    if (!d || !Number.isFinite(o.x) || !pred(d)) continue;
    // (a grown home's whole paddock: wave 4b)
    const [w, h] = typeof grid.objFootprint === 'function' ? grid.objFootprint(o, d) : footprint(d, o.rot || 0);
    const cx = (o.x + w / 2) * TILE_M; const cz = (o.z + h / 2) * TILE_M;
    const dist = Math.hypot(cx - house.x, cz - house.z);
    if (!best || dist < best.dist) best = { o, w, h, cx, cz, dist };
  }
  if (!best) return porchOf(house, free);
  // the free tiles round its footprint, the one nearest the farmhouse first
  const ring = [];
  const { o, w, h } = best;
  for (let x = o.x - 1; x <= o.x + w; x++) for (let z = o.z - 1; z <= o.z + h; z++) {
    if (x >= o.x && x < o.x + w && z >= o.z && z < o.z + h) continue;
    if (!free(x, z)) continue;
    const px = (x + 0.5) * TILE_M; const pz = (z + 0.5) * TILE_M;
    ring.push({ px, pz, d: Math.hypot(px - house.x, pz - house.z) + (x * 0.001 + z * 0.0001) });
  }
  if (!ring.length) return porchOf(house, free);
  ring.sort((a, b) => a.d - b.d);
  const p = ring[0];
  return { x: p.px, z: p.pz, yaw: Math.atan2(best.cx - p.px, best.cz - p.pz) };
}

/** A little yellow vintage cab: rounded body, a cabin with windows, black tyres, a chequer band and a roof sign. */
export function taxiGeometry() {
  const Y = '#F2C230';
  const parts = [box(1.7, 0.55, 3.6, Y, { y: 0.35 }), box(1.55, 0.6, 1.9, Y, { y: 0.9, z: -0.2 })];
  parts.push(box(1.58, 0.42, 1.6, '#BFE3F2', { y: 0.98, z: -0.2 }, { shade: false }));
  parts.push(box(1.72, 0.16, 3.62, '#3C3A36', { y: 0.55 }));
  for (let k = 0; k < 9; k++) parts.push(box(1.74, 0.08, 0.2, k % 2 ? '#F6F1E6' : '#3C3A36', { y: 0.62, z: -1.6 + k * 0.4 }, { shade: false }));
  for (const [x, z] of [[-0.8, 1.15], [0.8, 1.15], [-0.8, -1.15], [0.8, -1.15]]) parts.push(cyl(0.34, 0.34, 0.28, 10, '#2A2622', { x, y: 0.34, z, rz: Math.PI / 2 }), cyl(0.16, 0.16, 0.3, 8, '#C9C0AE', { x, y: 0.34, z, rz: Math.PI / 2 }));
  parts.push(ball(0.12, '#FFF3C4', { x: -0.55, y: 0.5, z: 1.8 }, { shade: false }), ball(0.12, '#FFF3C4', { x: 0.55, y: 0.5, z: 1.8 }, { shade: false }));
  parts.push(box(0.7, 0.22, 0.3, '#F6F1E6', { y: 1.52, z: -0.2 }), box(0.5, 0.12, 0.32, '#3C3A36', { y: 1.57, z: -0.2 }, { shade: false }));
  parts.push(box(1.0, 0.36, 0.5, '#8E5A34', { y: 1.52, z: -1.05 }));
  return merge(parts);
}

export function createGrandmaVisit({ layers, dyn = null, scenery = null, fx = null }) {
  let visit = { phase: 'none' };
  let house = null;
  let state = null;
  let taxi = null;
  let rocker = null;
  let fig = null;
  let shownAt = null;               // the visit we sparkled for (the step-out happens once per screen)
  let waveAt = 0;
  let clock = 0;
  const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const v = new THREE.Vector3(); const sc = new THREE.Vector3(1, 1, 1);
  const Y = new THREE.Vector3(0, 1, 0);
  const box3 = new THREE.Box3();

  function houseOf(s) {
    const objs = s?.farm?.objects || {};
    for (const id of Object.keys(objs).sort()) {
      const o = objs[id];
      if (o.def !== 'farmhouse' || !Number.isFinite(o.x)) continue;
      const def = defOf('farmhouse');
      const [w, d] = def ? footprint(def, o.rot || 0) : [4, 4];
      return { x: (o.x + w / 2) * TILE_M, z: (o.z + d / 2) * TILE_M, yaw: (o.rot || 0) * (Math.PI / 2) };
    }
    return null;
  }

  function ensureFigure() {
    if (fig || !layers) return;
    fig = makeFigure('farmer_b', '#8E7AB8', { grandma: true });
    fig.root.name = 'grandma';
    fig.root.visible = false;
    layers.avatars.add(fig.root);
  }

  /** A tile Grandma (or her chair) may stand on: farm land with nothing on its object layer (a path is fine). */
  const free = (tx, tz) => Boolean(state) && tx >= 0 && tz >= 0 && tx < WORLD_TILES && tz < WORLD_TILES && inLand(state, tx, tz)
    && getGrid(state).object[tz * WORLD_TILES + tx] === null;
  let porch = null;
  let spot = null;                  // where she stands now (her stroll stop)
  let spotKey = '';
  let layoutKey = '';
  function placeRocker(on) {
    if (!scenery) return;
    if (on && rocker === null && porch) {
      // her rocking chair beside her, on its own free tile (else none)
      const side = { x: porch.x + Math.cos(porch.yaw) * 1.2, z: porch.z - Math.sin(porch.yaw) * 1.2 };
      const key = models.has('decor:grandma_rocker') ? 'decor:grandma_rocker' : null;
      if (!key || !free(Math.floor(side.x / TILE_M), Math.floor(side.z / TILE_M))) return;
      q.setFromAxisAngle(Y, porch.yaw + 0.5);
      m4.compose(v.set(side.x, 0, side.z), q, sc.set(1, 1, 1));
      rocker = scenery.add(key, m4);
    } else if (!on && rocker !== null) { scenery.remove(rocker); rocker = null; }
  }

  function apply(s, now) {
    state = s;
    const h = houseOf(s);
    if (JSON.stringify(h) !== JSON.stringify(house)) { house = h; placeRocker(false); }
    visit = grandmaVisit(s, now);
    layoutKey = String(Object.keys(s?.farm?.objects || {}).length) + (s?.farm?.objects ? Object.values(s.farm.objects).reduce((a, o) => (a + (o.x | 0) * 7 + (o.z | 0) * 13) % 1e9, 0) : 0);
    const was = porch;
    porch = house ? porchOf(house, free) : null;
    if (JSON.stringify(was) !== JSON.stringify(porch)) { placeRocker(false); if (fig) fig.root.visible = false; }
    const on = visit.phase !== 'none' && porch !== null;
    if (on) ensureFigure();
    placeRocker(on && visit.phase === 'visiting');
    if (porch) box3.set(new THREE.Vector3(porch.x - 0.7, 0, porch.z - 0.7), new THREE.Vector3(porch.x + 0.7, 2.0, porch.z + 0.7));
  }

  return {
    setState(s, now) { apply(s, now); shownAt = visit.phase === 'arriving' ? null : visit.at; },
    sync(ids, topics, s, now) { if (topics.has('*') || topics.has('quests') || topics.has('restore') || topics.has('objects') || topics.has('grandma')) apply(s, now); },
    update(dt, now, { motion = 'full' } = {}) {
      clock += dt;
      if (!state || !house) return 0;
      // the visit runs by the clock: arriving -> visiting -> over
      const prev = visit.phase;
      visit = grandmaVisit(state, now);
      if (visit.phase !== prev) placeRocker(visit.phase === 'visiting');
      let want = 0;
      // the taxi along the lane during the arrival
      if (dyn) {
        const t = visit.phase === 'arriving' ? taxiAt(visit.k, house.x) : { visible: false };
        if (t.visible && taxi === null) taxi = dyn.add(modelKey(dyn, 'prop:taxi', taxiGeometry).key, m4.identity());
        if (!t.visible && taxi !== null) { dyn.remove(taxi); taxi = null; }
        if (taxi !== null) { q.setFromAxisAngle(Y, t.yaw); m4.compose(v.set(t.x, 0, t.z), q, sc.set(1, 1, 1)); dyn.setMatrix(taxi, m4); want = 2; }
      }
      // Grandma on the porch once she has stepped out, by day; inside by the fire at night
      if (fig) {
        const out = (visit.phase === 'arriving' && visit.k >= ARRIVAL.stepOut) || visit.phase === 'visiting';
        const day = WORLD.uNight.value < 0.5;
        // her stroll stop (the porch while she arrives); recomputed when the stop or the farm's layout changes
        const sk = `${visit.stop}|${layoutKey}`;
        if (sk !== spotKey) { spotKey = sk; spot = visit.phase === 'arriving' ? porch : strollSpot(state, house, visit.stop, free); if (fig) fig.root.visible = false; }
        const show = out && day && spot !== null;
        if (show && !fig.root.visible && spot) {
          const p = spot;
          fig.root.position.set(p.x, 0, p.z);
          fig.root.rotation.y = p.yaw;
          if (fx && visit.phase === 'arriving' && shownAt !== visit.at) {
            shownAt = visit.at;
            fx.play({ e: 'restored', project: 'grandma' }, new THREE.Vector3(p.x, 0, p.z), {});
          }
        }
        fig.root.visible = show && fig.ready;
        if (fig.root.visible && fig.mixer && motion !== 'still') {
          fig.mixer.update(dt);
          // now and then she waves at the farm
          if (clock > waveAt && fig.clips?.get('Wave')) {
            waveAt = clock + 14 + Math.random() * 10;
            const a = fig.mixer.clipAction(fig.clips.get('Wave'));
            a.reset(); a.setLoop(THREE.LoopOnce, 1); a.fadeIn(0.25); a.play();
            setTimeout(() => a.fadeOut(0.3), 1700);
          }
          want = Math.max(want, 1);
        }
      }
      return want;
    },
    places() {
      if (spot) box3.set(new THREE.Vector3(spot.x - 0.7, 0, spot.z - 0.7), new THREE.Vector3(spot.x + 0.7, 2.0, spot.z + 0.7));
      return [{ place: 'farmhouse', args: { tab: 'grandma' }, box: box3, live: Boolean(fig && fig.root.visible) }];
    },
    stats() { return { phase: visit.phase, stop: visit.stop ?? null, taxi: taxi !== null, grandma: Boolean(fig && fig.root.visible), at: spot ? [Math.round(spot.x * 10) / 10, Math.round(spot.z * 10) / 10] : null }; },
  };
}
