// Picking (tech §10.7, visual-ux-juice §4.12): no instanced raycasts. Animals (spheres) first, then the
// AABB proxies of tall objects (buildings, trees, homes, landmarks: a few dozen Box3 tests), then the tile
// under the cursor, analytically from the ground plane and the rules' own tile index. Owned by the
// render-world lane.
//
//   createPicker(camera, { proxies(), animals(), ground, places() }) -> pick(state, ndc)
//     -> { kind: 'object' | 'tile', id?, x, z, px, pz, land?, expansion?, place?, placeArgs? } | null
//     x/z: integer tile (the ground hit, or the object's anchor tile when the hit lies outside its footprint);
//     px/pz: float tile of the ground hit (cursor presence). On tiles, `land` is 'owned' | 'sale' | 'wild' and
//     `expansion` names the live expansion for sale under the cursor (the controller opens its card).
//   rayPick(ray, { proxies, animals }) -> { id, t } | null      pure part (tested)
//   placeAt(ray, places) -> { place, args } | null              the nearest LIVE world place box the ray hits (wave 2:
//     the Fair tent, the jetty and barge, the village, the restoration sites); a tile pick under it carries `place`
// Mobile wave (render lane):
// Wave 4b: a landed balloon loot crate is an object pick with `crate: true` (index.js adds the crates' boxes to the
//   proxies), whether the rules keep it in farm.objects or in farm.crates
//   TOUCH_PICK = { radii: [10, 16], n: 8 }      CSS px rings a finger's pick looks along when it lands on bare ground
//   probeRing(ndc, { w, h }, r, n) -> [ndc]     n points r CSS px round ndc (pure, tested)
//   pickNear(pickAt(ndc), ndc, { w, h }, opts?) the exact pick unless it is bare OWNED ground: then the object, animal
//     or pet most of the nearest ring's probes hit (ties: the first round the ring, from straight above); px/pz stay
//     the finger's own ground point. Land for sale, world places and the wild keep the exact pick; `accept(hit)` vets
//     a ring hit (index.js: fences, paths and plain decor are no finger targets: a tap beside them walks). Pure (tested).
import * as THREE from 'three';
import { TILE_M } from '../../../shared/content/config.js';
import { tileOwner } from '../../../shared/rules/grid.js';
import { defOf } from '../../../shared/content/index.js';
import { objFootprint } from './objects-view.js';

const hitV = new THREE.Vector3();
const sph = new THREE.Sphere();

/** Nearest animal sphere, else nearest tall-object box, along a ray. Animals win over the homes they stand in. */
export function rayPick(ray, { proxies = [], animals = [] } = {}) {
  let best = null;
  for (const a of animals) {
    const r = Math.max(a.r || 0.5, (a.h || 1) * 0.55);
    sph.center.set(a.x, (a.h || 1) * 0.5, a.z);
    sph.radius = r;
    if (ray.intersectSphere(sph, hitV)) {
      const t = hitV.distanceTo(ray.origin);
      if (!best || t < best.t) best = { id: a.id, t, animal: true, pet: a.pet, asleep: a.asleep };
    }
  }
  if (best) return best;
  for (const p of proxies) {
    if (ray.intersectBox(p.box, hitV)) {
      const t = hitV.distanceTo(ray.origin);
      if (!best || t < best.t) best = p.crate ? { id: p.id, t, crate: true } : { id: p.id, t };
    }
  }
  return best;
}

/** The nearest live world place (Box3) along a ray (pure, tested). */
export function placeAt(ray, places = []) {
  let best = null;
  for (const p of places) {
    if (!p || !p.live || !p.box || !ray.intersectBox(p.box, hitV)) continue;
    const t = hitV.distanceTo(ray.origin);
    if (!best || t < best.t) best = { place: p.place, args: p.args || {}, t };
  }
  return best;
}

export function createPicker(camera, { proxies = () => [], animals = () => [], ground = null, places = () => [] } = {}) {
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const v2 = new THREE.Vector2();
  return function pick(state, ndc) {
    v2.set(ndc.x, ndc.y);
    raycaster.setFromCamera(v2, camera);
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    const px = hit.x / TILE_M;
    const pz = hit.z / TILE_M;
    const x = Math.floor(px);
    const z = Math.floor(pz);
    const top = rayPick(raycaster.ray, { proxies: proxies(), animals: animals() });
    // a farmer's pet (render-life lists them among the animal pickables as { id: 'pet:<owner>', pet: <owner> })
    // wave 4: `asleep` while it sleeps at night (the client may show a Zzz tooltip; a pat still wakes it)
    if (top && top.pet) return { kind: 'pet', owner: top.pet, x, z, px, pz, ...(top.asleep ? { asleep: true } : {}) };
    // wave 4b: a landed loot crate (an object of the farm, or a farm.crates row): an object pick flagged `crate`
    if (top && top.crate) return { kind: 'object', id: top.id, crate: true, x, z, px, pz };
    if (top && state && Object.hasOwn(state.farm.objects, top.id)) {
      const o = state.farm.objects[top.id];
      let tx = x;
      let tz = z;
      const def = defOf(o.def);
      if (def && def.size && Number.isFinite(o.x)) {
        const [w, d] = objFootprint(o, def);
        if (x < o.x || z < o.z || x >= o.x + w || z >= o.z + d) { tx = o.x; tz = o.z; }
      }
      return { kind: 'object', id: top.id, x: tx, z: tz, px, pz };
    }
    const id = state ? tileOwner(state, x, z) : null;
    if (id) return { kind: 'object', id, x, z, px, pz };
    const out = { kind: 'tile', x, z, px, pz };
    // a world place (the Fair tent, the barge ...) outside the farm: the tile pick names it (additive fields)
    // (only when the ray meets the place before it meets the ground: a place far behind the cursor does not count)
    const pl = placeAt(raycaster.ray, places());
    if (pl && pl.t <= raycaster.ray.origin.distanceTo(hit) + 1) { out.place = pl.place; out.placeArgs = pl.args; }
    if (ground) {
      const l = ground.landAt(x, z);
      out.land = l === 1 ? 'owned' : l === 2 ? 'sale' : 'wild';
      // wave 4 (owner wish F): an owned tile with wild tufts the Hand can pull (rules clearWeed { x, z })
      if (l === 1 && typeof ground.weedAt === 'function' && ground.weedAt(x, z)) out.weed = true;
      const e = l === 2 ? ground.expansionAt(x, z) : null;
      if (e) out.expansion = e;
    }
    return out;
  };
}

export const TOUCH_PICK = Object.freeze({ radii: Object.freeze([10, 16]), n: 8 });

/** n NDC points `r` CSS px round `ndc` on a w x h canvas, starting straight above (pure). */
export function probeRing(ndc, { w, h }, r, n = TOUCH_PICK.n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
    out.push({ x: ndc.x + (2 * r * Math.cos(a)) / w, y: ndc.y + (2 * r * Math.sin(a)) / h });
  }
  return out;
}

const bare = (p) => p && p.kind === 'tile' && !p.place && !p.expansion && (p.land === undefined || p.land === 'owned');
const hitKey = (p) => (p.kind === 'pet' ? `pet:${p.owner}` : `${p.kind}:${p.id}`);

/** A finger's pick (see the header). */
export function pickNear(pickAt, ndc, size, { radii = TOUCH_PICK.radii, n = TOUCH_PICK.n, accept = () => true } = {}) {
  const exact = pickAt(ndc);
  if (!bare(exact) || !(size && size.w > 0 && size.h > 0)) return exact;
  for (const r of radii) {
    const votes = new Map();
    for (const p of probeRing(ndc, size, r, n)) {
      const q = pickAt(p);
      if (!q || q.kind === 'tile' || !accept(q)) continue;
      const k = hitKey(q);
      const v = votes.get(k);
      if (v) v.n++; else votes.set(k, { n: 1, q });
    }
    let best = null;
    for (const v of votes.values()) if (!best || v.n > best.n) best = v;
    if (best) return { ...best.q, px: exact.px, pz: exact.pz, near: r };
  }
  return exact;
}
