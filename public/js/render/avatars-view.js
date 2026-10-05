// Avatars (tech §6, §10.6; GDD §6.2, §7.2; visual-ux-juice §3.9): the two rigged farmers in their player
// colours, my own drawn at its true position at once and the partner's interpolated on its row time; walk /
// run / idle blending, tool gestures facing the target, held tools, nameplates, the partner's cursor ring,
// build ghost, pings with an off-screen arrow, emote bubbles and the high-five. Owned by the render-life lane.
// Everything here is cosmetic: an action never waits for the avatar (it walks there afterwards).
//
// createAvatarsView(layers, overlay, toScreen) -> av        (signature kept from M0; render/index.js)
//   toScreen(x, z, yMetres) -> { x, y, visible } with x/z in TILES.
// Methods (M0 ones keep their meaning):
//   av.setNow(fn)                         server clock (presence interpolation)
//   av.setPlayers(players, me?)           names, colours, avatar body (players[pid].avatar.body: 'farmer_a' |
//                                         'farmer_b'; default p1 -> farmer_a, p2 -> farmer_b)
//   av.setOnline(pid, bool) / av.me(pose {x, z, f, a}) / av.presence(rows, ts) / av.ghost(pid, g | null)
//   av.poseOf(pid) -> {x, z, f, a} | null
//   av.update(dt) -> 0|1|2                per frame
// Additions (render-life; hook-ups listed in docs/agent-notes/render-life.md):
//   av.act(pid, { x, z, tool? })          play the tool gesture facing a tile (own: when the avatar arrives)
//   av.onEvent(ev, meta)                  derive act() from a domain event ({ e, id?, x?, z?, by }) + target
//   av.setTargetLocator(fn(id) -> {x, z} | null)   tile of an object id (for onEvent); use the exported
//                                         tileCentreOf(state, id)
//   av.emote(pid, kind)                   kinds: wave heart laugh thumbs come wow sleepy star (EMOTES)
//   av.ping(pid, x, z)                    bouncing marker in the player colour + edge arrow when off-screen
//   av.highFive(pidA, pidB?)              both clap hands (the partner if pidB is omitted)
//   av.screenPosOf(pid) -> {x, y} | null  CSS px of the avatar's chest (fx flights for the partner)
//   av.setFx(fx)                          fx module for poofs and claps (optional)
//   av.setMotion('full' | 'reduced' | 'still')
//   av.setSeats(bench, state)             farm.coop.bench ({ pid: { id, at } }): a seated farmer sits on the bench
//                                         (a procedural sit pose blended in 200 ms; stands up the same way)
//   av.warmup() -> [Object3D]             hidden meshes for the boot shader warm-up
// Added in wave 2 (M1b):
//   av.ride(pid, on)                      the farmer rides a horse (GDD §3.4: cosmetic, walk speed x1.8 is the
//                                         client's): a horse under them walks / gallops with their speed, they sit
//                                         astride; the partner's presence tool 'ride' does the same on this screen.
//                                         animals-view takes one horse per rider out of the stable (RIDERS)
//   av.isRiding(pid) -> boolean
//                                         The client's own signals drive it too: my pose `{ ride: true }` (view.me),
//                                         the partner's presence tool 'horse' (client RIDE_TOOL; 'ride' also works)
//   Pets (GDD §3.4 Pets, L10): `players[pid].pet = { kind: 'dog' | 'cat', name, ... }` from setPlayers. Each pet
//                                         trots along its farmer's own trail (so it goes round what they went
//                                         round), sits at heel or sniffs about when they stand still, lies at the
//                                         farmers' feet while they sit on a bench, and waits at its Dog House / Cat
//                                         Basket (or where its farmer was last seen) while they are away. A Hand
//                                         click finds it through animals.pickables() (`pet: <owner>`, PET_PICKS);
//                                         petAdopted / petPetted / petFed / petFind: hearts, a hop, a dig, and the
//                                         farmer who did it bends down to it.
//   Golden Hour (farm.coop.golden, read from setSeats' state): a gold halo and drifting hearts round both farmers
// The farmers are a chibi cut of the same height (visual-09): head x1.3, hands and boots x1.2, and a soft
// player-colour ring on the ground so both are found at a glance. Nameplates sit just over the head: a cream
// plate with dark text and a colour dot, scaled with the zoom (visual-26).
//   seatOf(bench, pid, state) -> { x, z, face } | null   where a seated player sits, metres (pure, tested)
import * as THREE from 'three';
import { TILE_M, START } from '../../../shared/content/config.js';
import { PresenceBuffer } from '../../../shared/net/interp.js';
import { createGhost } from './ghost.js';
import { models } from './models.js';
import { defOf, CONTENT } from '../../../shared/content/index.js';
import { RIDERS, PET_PICKS, hash32 } from './animals-view.js';
import { WANT } from './renderer.js';
import { box, cyl, cone, ball, merge } from './world-kit.js';
import { FISHING, PETS as PETS_CONTENT } from '../../../shared/content/index.js';
import { lookOf, accessoryGeometry, addPartLook, applyLook, headFrame, headShape, AV_PART } from './avatar-looks.js';
import { dockSeats } from './land-features.js';
import * as grid from '../../../shared/rules/grid.js';

/** How far out on Willow Pond the float lands from the dock's end (metres; land-features' cast rings sit 2.2-3.4 m). */
const POND_CAST_M = 2.6;

/**
 * A cast at Willow Pond by a farmer at `here` (metres): the nearer dock seat's facing (toward the water) and where the
 * float lands, out on the pond in front of that seat. Pure.
 * @returns {{ face: number, target: { x: number, z: number } }}
 */
export function pondCast(here) {
  const seats = dockSeats();
  const d = (q) => Math.hypot(q.x - here.x, q.z - here.z);
  const near = seats.reduce((b, q) => (d(q) < d(b) ? q : b));
  return { face: near.face, target: { x: near.x + Math.sin(near.face) * POND_CAST_M, z: near.z + Math.cos(near.face) * POND_CAST_M } };
}

export const EMOTES = Object.freeze(['wave', 'heart', 'laugh', 'thumbs', 'come', 'wow', 'sleepy', 'star']);
const EMOTE_CLIP = { wave: 'Wave', come: 'Wave', heart: 'Interact', thumbs: 'Interact', laugh: 'Bonk', wow: 'Bonk', star: 'Wave', sleepy: 'IdleNeutral',
  cheer: 'Wave', dance: 'Bonk' };
const EMOTE_SVG = {
  wave: '<path d="M14 30c-4-5-6-10-2-12 3-1 5 3 7 6V9c0-3 4-3 4 0v10-13c0-3 4-3 4 0v13-11c0-3 4-3 4 0v12-8c0-3 4-3 4 0v16c0 8-5 13-12 13-5 0-8-2-13-11z" fill="#FFCFA0" stroke="#7A4B2C" stroke-width="2"/>',
  heart: '<path d="M24 41C8 30 4 22 4 15c0-6 5-10 10-10 4 0 8 2 10 6 2-4 6-6 10-6 5 0 10 4 10 10 0 7-4 15-20 26z" fill="#FF5A7A" stroke="#B02A4A" stroke-width="2"/>',
  laugh: '<circle cx="24" cy="24" r="19" fill="#FFD84A" stroke="#B8860B" stroke-width="2"/><path d="M14 19l5 2-5 2M34 19l-5 2 5 2" stroke="#5A3A1A" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M13 28c3 9 19 9 22 0z" fill="#8A2A1A"/>',
  thumbs: '<path d="M10 22h7v20h-7zM19 42h16c3 0 5-2 5-5l2-10c0-3-2-5-5-5h-9l2-8c1-4-3-6-5-3l-6 10z" fill="#FFCFA0" stroke="#7A4B2C" stroke-width="2" stroke-linejoin="round"/>',
  come: '<path d="M6 24h28" stroke="#2BB3A3" stroke-width="6" stroke-linecap="round"/><path d="M26 12l12 12-12 12" fill="none" stroke="#2BB3A3" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
  wow: '<circle cx="24" cy="24" r="19" fill="#FFD84A" stroke="#B8860B" stroke-width="2"/><circle cx="17" cy="19" r="3" fill="#5A3A1A"/><circle cx="31" cy="19" r="3" fill="#5A3A1A"/><ellipse cx="24" cy="32" rx="5" ry="6" fill="#8A2A1A"/>',
  sleepy: '<text x="8" y="34" font-size="22" font-weight="800" fill="#4AA8E8" font-family="sans-serif">z</text><text x="20" y="26" font-size="16" font-weight="800" fill="#4AA8E8" font-family="sans-serif">z</text><text x="30" y="18" font-size="12" font-weight="800" fill="#4AA8E8" font-family="sans-serif">z</text>',
  star: '<path d="M24 4l6 13 14 1-11 9 4 14-13-8-13 8 4-14-11-9 14-1z" fill="#FFC83D" stroke="#B8860B" stroke-width="2" stroke-linejoin="round"/>',
  cheer: '<path d="M8 40L20 12l16 16z" fill="#FFC83D" stroke="#B8860B" stroke-width="2" stroke-linejoin="round"/><circle cx="34" cy="10" r="3" fill="#FF5A7A"/><circle cx="41" cy="20" r="2.5" fill="#2BB3A3"/><circle cx="28" cy="5" r="2" fill="#4AA8E8"/><path d="M38 30l5 2M30 4l1-3" stroke="#FF7A6B" stroke-width="2.5" stroke-linecap="round"/>',
  dance: '<path d="M18 34V10l20-5v24" fill="none" stroke="#7A4BC2" stroke-width="3.5" stroke-linejoin="round"/><ellipse cx="13" cy="35" rx="6" ry="4.5" fill="#7A4BC2"/><ellipse cx="33" cy="30" rx="6" ry="4.5" fill="#7A4BC2"/>',
};
// The protocol's emote ids (shared/net/protocol.js EMOTES) map onto the bubbles above.
const EMOTE_ALIAS = { thumbs_up: 'thumbs', come_here: 'come', high_five: 'star' };
const TOOL_MODEL = { fishing_rod: 'fishing_rod', rod: 'fishing_rod', fishing: 'fishing_rod', sickle: 'sickle', wide_sickle: 'sickle', grand_sickle: 'sickle', water: 'watering_can', watering_can: 'watering_can', can: 'watering_can',
  big_watering_can: 'watering_can', seed: 'seed_bag', seeds: 'seed_bag', seed_bag: 'seed_bag', plant: 'seed_bag', feed: 'feed_scoop', feed_scoop: 'feed_scoop',
  basket: 'basket', compost: 'compost_scoop', compost_scoop: 'compost_scoop', axe: 'axe', hammer: 'hammer', build: 'hammer', plot: 'hoe', hoe: 'hoe' };
const EVENT_TOOL = { planted: 'seed_bag', harvested: 'sickle', watered: 'watering_can', composted: 'compost_scoop', fertilized: 'compost_scoop',
  tended: 'feed_scoop', fed: 'feed_scoop', collected: 'basket', shaken: 'basket', treeHarvested: 'basket', trayCollected: 'basket', chopped: 'axe',
  cleared: null, placed: 'hammer', built: 'hammer', moved: 'hammer', petted: null, uprooted: null };

/** The tile an avatar works at for an object id: its footprint centre minus half a tile (animals: their home).
 *  For av.setTargetLocator((id) => tileCentreOf(state, id)). */
export function tileCentreOf(state, id, depth = 0) {
  const o = state && state.farm && Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null;
  if (!o) return null;
  if (!Number.isFinite(o.x)) return typeof o.home === 'string' && depth < 2 ? tileCentreOf(state, o.home, depth + 1) : null;
  const def = defOf(o.def);
  // a grown home's centre is its whole paddock's (wave 4b: the rules' sizeOf)
  const [w, d] = def && def.size ? (typeof grid.sizeOf === 'function' ? grid.sizeOf(o, def) : def.size) : [1, 1];
  const odd = (o.rot || 0) % 2 === 1;
  return { x: o.x + (odd ? d : w) / 2 - 0.5, z: o.z + (odd ? w : d) / 2 - 0.5 };
}

/** The chibi cut (visual-09, VISUAL-AFTER C5): a bigger head, hands and boots, shorter shins and thighs, a wider
 *  chest, about 5 heads tall. Bone scales (no clip animates scale); [x, y, z] in the bone's own frame (y runs
 *  along the bone), a number = uniform. The neck takes back the chest's width so the head stays round. */
// RD-14 (QA wave 2): the farmers' heads x1.1 (1.8 -> 1.98)
export const CHIBI = Object.freeze({ Head: 1.98, WristL: 1.35, WristR: 1.35, FootL: 1.35, FootR: 1.35,
  UpperLegL: [1.1, 0.88, 1.1], UpperLegR: [1.1, 0.88, 1.1], LowerLegL: [1, 0.82, 1], LowerLegR: [1, 0.82, 1],
  UpperArmL: [1.08, 0.9, 1.08], UpperArmR: [1.08, 0.9, 1.08], LowerArmL: [1, 0.9, 1], LowerArmR: [1, 0.9, 1],
  Torso: [1.15, 1, 1.1], Neck: [1 / 1.15, 1, 1 / 1.1] });
/** Where a rider sits (metres above the ground, the horse's back) and the horse's scale under a farmer. */
export const RIDE = Object.freeze({ saddle: 1.34, horseScale: 1.1, speedK: 1.0 });
/** The bones the riding pose turns (restored when the farmer gets off). */
const RIDE_BONES = ['UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR'];
/** The bones the fishing pose turns (the arms; restored when the line comes in). */
const FISH_BONES = ['UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR'];
/** The water's height under a cast float (m): the Fishing Dock's pond and Willow Pond sit at about this level. */
export const FLOAT_Y = 0.1;
/** The saddle under a rider, in the horse holder's frame (it is scaled by RIDE.horseScale and sits 0.15 m back): a
 *  blanket in the farmer's colour, a brown seat with pommel and cantle, stirrups and two reins to the neck (RD-14). */
export function saddleGeometry(colorHex = '#2BB3A3') {
  const k = 1 / RIDE.horseScale;
  const y = (RIDE.saddle - 0.12) * k; const z = 0.15 * k;
  const parts = [
    box(0.62, 0.04, 0.82, colorHex, { y: y - 0.04, z }), box(0.66, 0.02, 0.86, '#FFF8EC', { y: y - 0.06, z }),
    box(0.42, 0.08, 0.56, '#7A4B2C', { y, z }), box(0.3, 0.12, 0.08, '#6A3E22', { y: y + 0.04, z: z + 0.26 }), box(0.36, 0.14, 0.08, '#6A3E22', { y: y + 0.04, z: z - 0.26 }),
  ];
  for (const sx of [-1, 1]) {
    parts.push(box(0.03, 0.42, 0.04, '#5A3418', { x: sx * 0.3, y: y - 0.44, z }), box(0.12, 0.03, 0.08, '#8C8880', { x: sx * 0.3, y: y - 0.46, z }));
    // a rein from the hands (about 0.35 m in front of the saddle) to the neck (0.55 m further on, a little higher)
    const len = Math.hypot(0.55, 0.12);
    parts.push(cyl(0.012, 0.012, len, 3, '#4A2E1A', { x: sx * 0.09, y: y + 0.12, z: z + 0.32, rx: Math.PI / 2 - Math.atan2(0.12, 0.55) }));
  }
  return merge(parts);
}
let saddleMat = null;
function saddleMesh(colorHex) {
  if (!saddleMat) saddleMat = models.createMaterial();
  const m = new THREE.Mesh(saddleGeometry(colorHex), saddleMat);
  m.name = 'saddle';
  return m;
}

/** The two pets (GDD §3.4 Pets): model, scale on the model's own size, how far behind (m, along the farmer's trail)
 *  and to which side (m, + = the farmer's left) it keeps, its walk speed (m/s at clip rate 1), the speed from which
 *  it gallops (the cat has no gallop: it bounds), how far it sniffs about and after how many idle seconds. */
export const PET = Object.freeze({
  dog: Object.freeze({ key: 'animal:dog', scale: 1.4, behind: 1.3, side: 0.8, walk: 1.2, run: 2.4, runRate: 3.6, roam: 2.4, still: 4 }),
  cat: Object.freeze({ key: 'animal:cat', scale: 1.6, behind: 1.6, side: -0.75, walk: 1.1, run: Infinity, runRate: 1.1, roam: 1.6, still: 8 }),
});
/** Pet breeds (wave 4, owner wish 6; rules `players[pid].pet.breed`, content PETS.kinds[].breeds): the model key of each
 *  breed. A pet without a breed wears its kind's FIRST content breed (content's rule, so the panel and the farm agree). */
export const PET_BREEDS = Object.freeze({
  dog: Object.freeze({ shiba: 'animal:dog', husky: 'animal:dog:husky', shepherd: 'animal:dog:shepherd' }),
  cat: Object.freeze({ orange: 'animal:cat', black: 'animal:cat:black', white: 'animal:cat:white' }),
});
/** The breed a pet shows (pure): its own when the kind knows it, else the kind's first content breed. */
export function petBreedOf(pet) {
  if (!pet || !PET_BREEDS[pet.kind]) return null;
  if (typeof pet.breed === 'string' && Object.hasOwn(PET_BREEDS[pet.kind], pet.breed)) return pet.breed;
  const k = (PETS_CONTENT?.kinds ?? []).find((x) => x.id === pet.kind);
  const first = k && Array.isArray(k.breeds) && k.breeds[0] ? k.breeds[0].id : null;
  return first && Object.hasOwn(PET_BREEDS[pet.kind], first) ? first : Object.keys(PET_BREEDS[pet.kind]).find((b) => PET_BREEDS[pet.kind][b] === PET[pet.kind].key);
}
/** The model key a pet wears (pure, tested): its breed's, falling back to the kind's own model. */
export function petKeyOf(pet, has = (k) => models.has(k)) {
  const base = PET[pet && pet.kind] ? PET[pet.kind].key : PET.dog.key;
  const b = petBreedOf(pet);
  const k = b ? PET_BREEDS[pet.kind][b] : base;
  return k && has(k) ? k : base;
}
/** Pets sleep from late dusk until dawn (wave 4, owner wish 4; content PETS.sleep { from: 'dusk', to: 'dawn' }): pure,
 *  from the sky's phase and its progress k (daynight.js), with the previous answer as hysteresis at the edges. */
export function petsAsleep(phase, k = 0, was = false) {
  if (phase === 'night') return true;
  if (phase === 'dusk') return was ? k > 0.35 : k > 0.55;
  return false;
}
const PET_EVENTS = new Set(['petAdopted', 'petPetted', 'petFed', 'petFind', 'petTreasure', 'petBreed']);

/** The point `back` metres behind the newest end of a trail ([{x, z}], newest last), walked along the trail; the
 *  oldest point when the trail is shorter. Null for an empty trail. Pure. */
export function trailPoint(trail, back) {
  if (!trail || !trail.length) return null;
  let left = back;
  for (let i = trail.length - 1; i > 0; i--) {
    const a = trail[i]; const b = trail[i - 1];
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d >= left && d > 0) { const k = left / d; return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }; }
    left -= d;
  }
  return { x: trail[0].x, z: trail[0].z };
}

/** Where a pet wants to be (metres) and which way it then faces (null: toward its farmer). Pure.
 *  owner { x, z, facing, moving, seat: {x, z, face} | null, away, home: {x, z, face} | null }
 *  trail: the farmer's recent path (trailPoint); roam: an offset {x, z} from the farmer while they stand still. */
export function petGoal(kind, owner, { trail = null, roam = null } = {}) {
  const k = PET[kind] || PET.dog;
  if (owner.away) {
    return owner.home ? { x: owner.home.x, z: owner.home.z, face: owner.home.face ?? 0, rest: true }
      : { x: owner.x, z: owner.z, face: owner.facing, rest: true };
  }
  if (owner.seat) {
    // at its farmer's feet, in front of the bench, facing out with them (two seats are 1.2 m apart: so are the pets)
    const f = owner.seat.face;
    return { x: owner.seat.x + Math.sin(f) * 1.45, z: owner.seat.z + Math.cos(f) * 1.45, face: f, rest: true };
  }
  if (owner.moving && trail) {
    const p = trailPoint(trail, k.behind);
    if (p) return { x: p.x, z: p.z, face: null, rest: false };
  }
  if (roam) return { x: owner.x + roam.x, z: owner.z + roam.z, face: null, rest: false };
  // at heel: beside the farmer's leg, a step back, looking where they look (beside, not behind: the farm camera
  // looks at the farmer's front most of the time, and a pet straight behind them is hidden)
  const fx = Math.sin(owner.facing); const fz = Math.cos(owner.facing);
  const lx = Math.cos(owner.facing); const lz = -Math.sin(owner.facing);         // the farmer's left (it faces +z)
  return { x: owner.x - fx * 0.3 + lx * k.side * 1.15, z: owner.z - fz * 0.3 + lz * k.side * 1.15, face: owner.facing, rest: false };
}

/** How high a sitter's hips rest on each seat (m: the seat top of the built model plus the seat of the trousers). */
export const SEAT_HIPS = Object.freeze({ sunset_bench: 0.8, bench_swing: 1.06 });

/** The seats of the bigger two-seat decor (wave 3: the Grand decor's Golden Hour seats and the Fishing Dock's end): the
 *  middle of the two seats [x, z] in the model's own frame (+z its front), y the hips, `turn` which way the sitters face
 *  against the model's front, `spread` half the gap between them. Decor not listed sits like a bench. */
export const SEATS = Object.freeze({
  gazebo: { x: 0, z: -0.78, y: 1.2, turn: 0, spread: 0.5 },
  koi_pond: { x: 0, z: 2.66, y: 0.86, turn: Math.PI, spread: 0.45 },
  treehouse: { x: -0.35, z: 1.12, y: 2.66, turn: 0, spread: 0.45 },
  arbor_of_lights: { x: 0, z: -0.12, y: 1.0, turn: 0, spread: 0.45 },
  bath_house: { x: 1.55, z: 3.28, y: 0.74, turn: Math.PI, spread: 0.55 },
  pond_dock: { x: 0, z: 0.28, y: 0.44, turn: Math.PI, spread: 0.3 },
});
/** Where seat `slot` (-1 left, 0 middle, 1 right) of object `o` is (metres; y the hips) and which way it faces. Pure. */
export function seatFrame(o, slot) {
  const def = defOf(o.def);
  const [w, d] = def && def.size ? def.size : [2, 1];
  const odd = (o.rot || 0) % 2 === 1;
  const cx = (o.x + (odd ? d : w) / 2) * TILE_M;
  const cz = (o.z + (odd ? w : d) / 2) * TILE_M;
  const face = (o.rot || 0) * (Math.PI / 2);
  const st = Object.hasOwn(SEATS, o.def) ? SEATS[o.def] : null;
  // the bench's long axis is its local X; the seat is a little behind the centre line (toward the backrest)
  const lx = (st ? st.x : 0) + slot * (st ? st.spread : 0.6) * (st && st.turn ? -1 : 1);
  const lz = st ? st.z : -0.12;
  return { x: cx + Math.cos(face) * lx + Math.sin(face) * lz, z: cz - Math.sin(face) * lx + Math.cos(face) * lz, face: face + (st ? st.turn : 0),
    y: st ? st.y : (SEAT_HIPS[o.def] ?? SEAT_HIPS.sunset_bench) };
}
/** Where `pid` sits on its bench (metres; y = the hips) and which way it faces, or null when not seated. Pure. */
export function seatOf(bench, pid, state) {
  const b = bench && bench[pid];
  const o = b && state && Object.hasOwn(state.farm.objects, b.id) ? state.farm.objects[b.id] : null;
  if (!o || !Number.isFinite(o.x)) return null;
  const pids = Object.keys(bench).filter((p) => bench[p] && bench[p].id === b.id).sort();
  const slot = pids.length > 1 ? (pids.indexOf(pid) === 0 ? -1 : 1) : 0;
  return seatFrame(o, slot);
}

// ---- Fishing (wave 3, GDD §6.2 mechanic 21; content FISHING): the farmer casts (the rod swings back and over, the
// float flies out on its line and lands with a plop), waits (the float bobs), gets a bite (it dips), reels in (the free
// hand winds, the float comes home) and lands the fish (it flips out of the water into the farmer's hands and its name
// floats up). At a Fishing Dock the farmer sits on the dock's end (SEATS.pond_dock). The rules' events drive it; the
// client may drive the phases itself (av.fish). Cosmetic, like everything here.
export const FISH_EVENTS = Object.freeze({ cast: new Set(['fishCast', 'cast', 'castLine']), bite: new Set(['fishBite', 'bite']),
  catch: new Set(['fishCaught', 'fished', 'caught']), stop: new Set(['fishCancelled', 'castCancelled', 'fishStop']) });
/** Phase timings (s): the cast swing, the float's flight, the reel, the fish shown; the cast reach (m). */
export const FISH_T = Object.freeze({ swing: 0.5, fly: 0.65, reel: 1.5, show: 2.0, reach: 3.6, idleMs: 25_000 });
/** Where the float lands (metres, on the water): the event's tile centre, else `reach` ahead of the farmer. Pure. */
export function castPoint(at, face, ev = null) {
  if (ev && Number.isFinite(ev.x) && Number.isFinite(ev.z)) return { x: (ev.x + 0.5) * TILE_M, z: (ev.z + 0.5) * TILE_M };
  return { x: at.x + Math.sin(face) * FISH_T.reach, z: at.z + Math.cos(face) * FISH_T.reach };
}
/** A point of the fishing line between the rod tip `a` and the float `b` at t (0..1), sagging by `sag`. Pure. */
export function linePoint(a, b, t, sag) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag, z: a.z + (b.z - a.z) * t };
}

/** Which locomotion clip a speed (m/s) wants, with the clip time scale. Exported for tests. */
export function gaitFor(speed) {
  if (speed < 0.08) return { clip: 'Idle', scale: 1 };
  if (speed < 2.6) return { clip: 'Walk', scale: Math.max(0.6, Math.min(1.8, speed / 1.45)) };
  return { clip: 'Run', scale: Math.max(0.8, Math.min(1.7, speed / 4.2)) };
}

/** Shortest signed angle from a to b (radians). */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// carried tools hang from the fist (handle up); pole tools are held across the fist, pointing forward
const CARRY = new Set(['tool:watering_can', 'tool:basket', 'tool:feed_scoop', 'tool:compost_scoop', 'tool:seed_bag']);

/** The held-tool frame in the wrist bone's local space, computed from the skeleton's bind pose. */
function gripFrame(rig, carry = false, toolHeight = 0.42) {
  let skin = null;
  rig.object.traverse((o) => { if (!skin && o.isSkinnedMesh) skin = o; });
  const out = { q: new THREE.Quaternion(), p: new THREE.Vector3() };
  if (!skin) return out;
  const bones = skin.skeleton.bones;
  const iw = bones.indexOf(rig.hand);
  const fingers = bones.findIndex((b) => /Middle1R|Index1R|Hand_R|HandR/i.test(b.name));
  if (iw < 0) return out;
  const bind = (i) => new THREE.Matrix4().copy(skin.skeleton.boneInverses[i]).invert();
  const wm = bind(iw);
  const wp = new THREE.Vector3(); const wq = new THREE.Quaternion(); const wsc = new THREE.Vector3();
  wm.decompose(wp, wq, wsc);
  const finger = new THREE.Vector3(0, -1, 0);
  if (fingers >= 0) {
    const fp = new THREE.Vector3().setFromMatrixPosition(bind(fingers));
    finger.copy(fp).sub(wp).normalize();
  }
  const fwd = new THREE.Vector3(0, 0, 1);
  let upAxis; let xAxis;
  if (carry) {
    // hanging: tool up = against the fingers (the handle in the fist), tool x across the body
    upAxis = finger.clone().negate();
    xAxis = new THREE.Vector3().crossVectors(upAxis, fwd).normalize();
    if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
  } else {
    // pole: tool up = forward with the finger component removed; tool x = the finger direction
    upAxis = fwd.clone().addScaledVector(finger, -fwd.dot(finger)).normalize();
    if (upAxis.lengthSq() < 1e-6) upAxis.set(0, 1, 0);
    xAxis = finger.clone();
  }
  const zAxis = new THREE.Vector3().crossVectors(xAxis, upAxis).normalize();
  xAxis = new THREE.Vector3().crossVectors(upAxis, zAxis).normalize();
  const world = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, upAxis, zAxis));
  out.q.copy(wq).invert().multiply(world);
  // the grip: a little way along the fingers; a pole slides down so the fist holds its lower third, a
  // carried tool hangs below the fist by its full height
  const offW = finger.clone().multiplyScalar(0.07 * wsc.x).addScaledVector(upAxis, (carry ? -toolHeight : -0.12) * wsc.x);
  out.p.copy(offW.applyQuaternion(wq.clone().invert())).divideScalar(Math.max(1e-6, wsc.x));
  return out;
}

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(40,28,14,0.5)'); gr.addColorStop(0.6, 'rgba(40,28,14,0.22)'); gr.addColorStop(1, 'rgba(40,28,14,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createAvatarsView(layers, overlay, toScreen) {
  // placeholder (shown until the rigged model has loaded, or if it fails)
  const bodyGeo = new THREE.CapsuleGeometry(0.42, 0.9, 6, 12);
  bodyGeo.translate(0, 0.87, 0);
  const ringGeo = new THREE.RingGeometry(0.55, 0.8, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const shadowGeo = new THREE.PlaneGeometry(1.3, 1.3);
  shadowGeo.rotateX(-Math.PI / 2);
  const haloGeo = new THREE.CircleGeometry(0.45, 32);
  haloGeo.rotateX(-Math.PI / 2);
  const haloTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 10, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.72, 'rgba(255,255,255,1)'); gr.addColorStop(0.86, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const shadowMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const pinGeo = (() => {
    const cone = new THREE.ConeGeometry(0.28, 0.7, 14); cone.rotateX(Math.PI); cone.translate(0, 0.35, 0);
    const ball = new THREE.SphereGeometry(0.34, 16, 12); ball.translate(0, 0.95, 0);
    return [cone, ball];
  })();

  /** pid -> avatar state */
  const av = new Map();
  let myPid = null;
  let now = () => 0;
  let fx = null;
  let motion = 'full';
  let locateTarget = () => null;
  let clock = 0;
  const pings = [];

  function bodyFor(pid, p) {
    const b = p && p.avatar && p.avatar.body;
    if (b === 'farmer_a' || b === 'farmer_b') return b;
    return pid === 'p2' ? 'farmer_b' : 'farmer_a';
  }

  function ensure(pid, color, name, body) {
    let a = av.get(pid);
    if (!a) {
      const root = new THREE.Group();
      root.name = `avatar-${pid}`;
      const placeholder = new THREE.Mesh(bodyGeo, models.createMaterial({ vertexColors: false, color }));
      root.add(placeholder);
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.position.y = 0.03;
      shadow.renderOrder = 1;
      root.add(shadow);
      layers.avatars.add(root);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
      ring.visible = false;
      layers.ui3d.add(ring);
      // the farmer's own ground ring in the player colour (visual-09): found at a glance
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color, map: haloTex, transparent: true, opacity: 0.35, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2 }));
      halo.position.y = 0.035;
      halo.renderOrder = 2;
      root.add(halo);
      const plate = document.createElement('div');
      plate.className = 'nameplate';
      plate.style.cssText = 'position:absolute;left:0;top:0;padding:1px 8px 1px 6px;border-radius:999px;font-weight:700;font-size:13px;line-height:18px;'
        + 'color:#4A3020;background:#FFF8EC;white-space:nowrap;pointer-events:none;will-change:transform;border:1.5px solid rgba(122,75,44,.55);'
        + 'box-shadow:0 2px 0 rgba(60,30,10,.25);display:flex;align-items:center;gap:5px;transform-origin:50% 100%';
      const dot = document.createElement('span');
      dot.style.cssText = 'display:inline-block;width:9px;height:9px;border-radius:50%;border:1.5px solid rgba(255,255,255,.9);box-shadow:0 0 0 1px rgba(60,30,10,.35)';
      const label = document.createElement('span');
      plate.append(dot, label);
      plate.dot = dot;
      plate.label = label;
      overlay.appendChild(plate);
      const bubble = document.createElement('div');
      bubble.style.cssText = 'position:absolute;left:0;top:0;width:54px;height:54px;border-radius:50%;background:#FFF8EC;border:3px solid #7A4B2C;box-shadow:0 3px 0 rgba(60,30,10,.35);display:none;pointer-events:none;will-change:transform';
      overlay.appendChild(bubble);
      a = { pid, root, placeholder, shadow, ring, halo, plate, bubble, buf: new PresenceBuffer(), ghost: createGhost(layers.ui3d, { valid: color, invalid: color }),
        seat: null, sitK: 0, plateT: '', bubbleT: '',
        color, name, body: null, online: true, self: pid === myPid, pose: null, rig: null, loading: false, facing: 0, speed: 0,
        cursor: null, cursorShown: null, cursorStill: 0, pending: null, tool: null, toolKey: null, bubbleUntil: 0 };
      av.set(pid, a);
    }
    a.color = color;
    a.ring.material.color.set(color);
    a.halo.material.color.set(color);
    if (a.placeholder.material.color) a.placeholder.material.color.set(color);
    a.plate.label.textContent = name;
    a.plate.dot.style.background = color;
    a.name = name;
    if (a.body !== body) { a.body = body; loadRig(a); }
    return a;
  }

  // -------------------------------------------------------------------------------------------------
  // the rigged farmer
  async function loadRig(a) {
    const key = `avatar:${a.body}`;
    const body = a.body;
    try {
      await models.init();
      if (!models.has(key)) return;
      await models.ready([key, 'tool:sickle']);
      if (a.body !== body) return;
      const info = models.info(key);
      const c = models.clone(key, { tint: info && info.tint ? { [info.tint]: a.color } : undefined });
      if (!c) return;
      if (a.rig) { a.root.remove(a.rig.object); a.rig.mixer.stopAllAction(); }
      const mixer = new THREE.AnimationMixer(c.object);
      const actions = {};
      for (const [name, clip] of c.clips) actions[name] = mixer.clipAction(clip);
      let hand = null;
      const bones = {};
      c.object.traverse((o) => {
        if (!o.isBone) return;
        if (!hand && o.name === (info.hand || 'WristR')) hand = o;
        bones[o.name] = o;
      });
      // the chibi cut, then the feet back on the ground (shorter legs lift them) and the real head top measured
      c.object.updateMatrixWorld(true);
      const footY = (o) => (bones[o] ? bones[o].getWorldPosition(new THREE.Vector3()).y : 0);
      const feet0 = Math.min(footY('FootL'), footY('FootR'));
      for (const [name, k] of Object.entries(CHIBI)) {
        const b = bones[name];
        if (!b) continue;
        if (Array.isArray(k)) b.scale.multiply(new THREE.Vector3(...k)); else b.scale.multiplyScalar(k);
      }
      c.object.updateMatrixWorld(true);
      const drop = Math.min(footY('FootL'), footY('FootR')) - feet0;
      let skinMesh = null; c.object.traverse((o) => { if (!skinMesh && o.isSkinnedMesh) skinMesh = o; });
      let top = 2.0;
      if (skinMesh && skinMesh.computeBoundingBox) { skinMesh.computeBoundingBox(); top = skinMesh.boundingBox.clone().applyMatrix4(skinMesh.matrixWorld).max.y - drop; }
      const hips = bones.Hips ? bones.Hips.getWorldPosition(new THREE.Vector3()).y - drop : 0.95;
      const headY = bones.Head ? bones.Head.getWorldPosition(new THREE.Vector3()).y - drop : 1.5;
      a.rig = { object: c.object, mixer, actions, hand, bones, hipsY: hips, drop, topY: Math.max(1.4, Math.min(2.4, top)), headTop: Math.max(0.2, Math.min(0.8, top - headY)), base: null, overlay: null, toolObj: null };
      // wave 4 (owner wish 9): the look patch on the farmer's own material, and the head frame its hair and hats hang in
      if (skinMesh && skinMesh.geometry.getAttribute('_part')) {
        a.rig.parts = addPartLook(skinMesh.material);
        a.rig.tintU = skinMesh.material.userData.tint || null;
        a.rig.tintPart = info.tint === 'White' ? AV_PART.top : AV_PART.bottom;
        a.rig.head = bones[info.head || 'Head'] || null;
        a.rig.headFrame = headFrame(skinMesh, a.rig.head);
        // the rig's own head, hair and hat as measured: a chosen hat is fitted over them (avatar-looks headShape)
        a.rig.own = { hair: info.hair || null, hat: info.hat || 'none', shape: a.rig.headFrame ? headShape(skinMesh, a.rig.head, a.rig.headFrame) : null };
        a.rig.lookSig = null;
      }
      c.object.position.y = -drop;
      a.root.add(c.object);
      dressLook(a);
      a.placeholder.visible = false;
      playBase(a, 'Idle', 1, 0);
      a.toolKey = null;
      setTool(a, a.tool);
    } catch (err) {
      console.error(`avatar ${a.pid}: rig failed to load, keeping the placeholder`, err);
    }
  }

  /** Put a farmer's chosen look on their rig (wave 4, owner wish 9): part colours, the rig's own hair or hat cut away,
   *  another hair style or hat hung on the head bone. Rebuilt only when the look changed. */
  function dressLook(a) {
    const r = a.rig;
    if (!r || !r.parts) return;
    const look = lookOf(a.player, r.own);
    const sig = JSON.stringify(look);
    if (sig === r.lookSig) return;
    r.lookSig = sig;
    applyLook(r.parts, look, r.own, look ? r.tintU : null, r.tintPart);
    if (!look && r.tintU) r.tintU.value.set(a.color);              // back to the player colour
    if (r.accessory) { r.accessory.removeFromParent(); r.accessory.geometry.dispose(); r.accessory = null; }
    const g = r.head && r.headFrame ? accessoryGeometry(look, r.own) : null;
    if (g) {
      const m = new THREE.Mesh(g, models.material('standard'));
      m.name = `look-${a.pid}`;
      m.matrixAutoUpdate = false;
      m.matrix.copy(r.headFrame);
      m.frustumCulled = false;
      r.head.add(m);
      r.accessory = m;
    }
  }

  function playBase(a, clip, scale, fade = 0.2) {
    const r = a.rig;
    if (!r) return;
    const act = r.actions[clip] || r.actions.Idle;
    if (!act) return;
    act.timeScale = scale;
    if (r.base === act) return;
    act.reset().setEffectiveWeight(1).play();
    if (r.base && fade > 0) r.base.crossFadeTo(act, fade, false);
    else if (r.base) r.base.stop();
    r.base = act;
  }

  function playOnce(a, clip, { fade = 0.12, scale = 1 } = {}) {
    const r = a.rig;
    if (!r || !r.actions[clip] || motion === 'still') return;
    const act = r.actions[clip];
    if (r.overlay && r.overlay !== act) r.overlay.fadeOut(0.1);
    act.reset();
    act.setLoop(THREE.LoopOnce, 1);
    act.clampWhenFinished = false;
    act.timeScale = scale;
    act.setEffectiveWeight(1).fadeIn(fade).play();
    r.overlay = act;
    r.overlayEnd = clock + act.getClip().duration / scale - 0.15;
  }

  function setTool(a, tool) {
    a.tool = tool;
    const want = tool && TOOL_MODEL[tool] ? `tool:${TOOL_MODEL[tool]}` : null;
    if (!a.rig || a.toolKey === want) return;
    if (a.rig.toolObj) { a.rig.toolObj.removeFromParent(); a.rig.toolObj = null; }
    a.toolKey = want;
    if (!want || !a.rig.hand) return;
    const attach = () => {
      if (a.toolKey !== want || !a.rig) return;
      const c = models.clone(want);
      if (!c) return;
      const holder = new THREE.Group();
      holder.add(c.object);
      // Orient the tool from the BIND pose (independent of the current clip): the handle (+Y of the tool
      // model) points forward (+Z of the character) and across the fingers, the grip sits in the palm.
      const b = models.boundsOf(want);
      const grip = gripFrame(a.rig, CARRY.has(want), b.max.y - b.min.y);
      holder.quaternion.copy(grip.q);
      holder.position.copy(grip.p);
      a.rig.object.updateMatrixWorld(true);
      const ws = a.rig.hand.getWorldScale(new THREE.Vector3());
      const rs = a.root.getWorldScale(new THREE.Vector3());
      holder.scale.setScalar(rs.x / Math.max(1e-6, ws.x));
      a.rig.hand.add(holder);
      a.rig.toolObj = holder;
    };
    if (models.isReady(want)) attach(); else models.ready([want]).then(attach).catch(() => {});
  }

  function placeRoot(a, p) {
    a.pose = p;
  }

  // -------------------------------------------------------------------------------------------------
  function act(pid, { x, z, tool } = {}) {
    const a = av.get(pid);
    if (!a || x === undefined) return;
    a.pending = { x, z, tool: tool ?? null, at: clock, until: clock + (a.self ? 1.6 : 0.4) };
  }

  function emote(pid, kind) {
    if (Object.hasOwn(EMOTE_ALIAS, kind)) kind = EMOTE_ALIAS[kind];
    const a = av.get(pid);
    if (!a || typeof kind !== 'string' || !Object.hasOwn(EMOTE_SVG, kind)) return;
    a.bubble.innerHTML = `<svg viewBox="0 0 48 48" width="40" height="40" style="margin:4px">${EMOTE_SVG[kind]}</svg>`;
    a.bubble.style.display = 'block';
    a.bubbleUntil = clock + 2.2;
    a.bubble.animate(motion === 'full' ? [{ transform: 'scale(0.2)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)' }] : [{ opacity: 0 }, { opacity: 1 }],
      { duration: 250, easing: 'ease-out', composite: 'add' });
    const clip = Object.hasOwn(EMOTE_CLIP, kind) ? EMOTE_CLIP[kind] : null;
    if (clip) playOnce(a, clip);
  }

  function ping(pid, x, z) {
    const a = av.get(pid);
    const color = a ? a.color : '#FFC83D';
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
    for (const geo of pinGeo) g.add(new THREE.Mesh(geo, mat));
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
    g.add(ring);
    g.position.set(x * TILE_M, 0.05, z * TILE_M);
    layers.ui3d.add(g);
    const arrow = document.createElement('div');
    arrow.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;border-left:14px solid transparent;border-right:14px solid transparent;border-bottom:26px solid ${color};filter:drop-shadow(0 2px 0 rgba(60,30,10,.4));display:none;pointer-events:none`;
    overlay.appendChild(arrow);
    pings.push({ g, ring, mat, arrow, x, z, t0: clock, life: 3.0 });
    if (fx) fx.ring(new THREE.Vector3(x * TILE_M, 0, z * TILE_M), { color, radius: 2.4, duration: 0.8 });
  }

  function highFive(pa, pb) {
    const a = av.get(pa);
    const other = pb ? av.get(pb) : [...av.values()].find((x) => x.pid !== pa && x.online);
    if (!a) return;
    const pair = other ? [a, other] : [a];
    for (const x of pair) playOnce(x, 'Wave', { scale: 1.6 });            // both raise a hand toward the other
    if (other && a.pose && other.pose) {
      a.faceTo = Math.atan2(other.pose.x - a.pose.x, other.pose.z - a.pose.z);
      other.faceTo = Math.atan2(a.pose.x - other.pose.x, a.pose.z - other.pose.z);
      if (fx) {
        const mx = ((a.pose.x + other.pose.x) / 2) * TILE_M; const mz = ((a.pose.z + other.pose.z) / 2) * TILE_M;
        setTimeout(() => fx.play({ e: 'highFive' }, new THREE.Vector3(mx, 0, mz)), 300);
      }
    }
  }

  // -------------------------------------------------------------------------------------------------
  // the procedural sit pose (the rig has no Sit clip): hips down to the seat, thighs forward, shins down
  const t1 = new THREE.Vector3(); const t2 = new THREE.Vector3();
  const qa = new THREE.Quaternion(); const qb = new THREE.Quaternion(); const qc = new THREE.Quaternion(); const qd = new THREE.Quaternion();
  const aim = new THREE.Vector3();
  function aimBone(bone, child, dir, w) {
    if (!bone || !child || !bone.parent) return;
    bone.updateWorldMatrix(true, false);
    const p0 = bone.getWorldPosition(t1);
    child.updateWorldMatrix(false, false);
    const cur = child.getWorldPosition(t2).sub(p0).normalize();
    qa.setFromUnitVectors(cur, dir);
    bone.getWorldQuaternion(qb);
    qc.copy(qa).multiply(qb);
    bone.parent.getWorldQuaternion(qd);
    bone.quaternion.slerp(qd.invert().multiply(qc), w);
  }
  function sitPose(a, k, seat) {
    const r = a.rig;
    if (!r) return;
    // the hips onto the seat (down onto a low bench, up onto the porch swing)
    r.object.position.y = -(r.drop || 0) + k * ((seat && seat.y ? seat.y : SEAT_HIPS.sunset_bench) - (r.hipsY || 0.95));
    if (k <= 0) return;
    const b = r.bones;
    const fx = Math.sin(a.facing); const fz = Math.cos(a.facing);
    for (const side of ['L', 'R']) {
      aimBone(b[`UpperLeg${side}`], b[`LowerLeg${side}`], aim.set(fx, -0.12, fz).normalize(), k);
      aimBone(b[`LowerLeg${side}`], b[`Foot${side}`], aim.set(fx * 0.12, -1, fz * 0.12).normalize(), k);
    }
  }

  // -------------------------------------------------------------------------------------------------
  // riding (GDD §3.4 Horse: "the avatar can ride a horse as a pure cosmetic")
  function setRiding(a, on) {
    a.riding = !!on;
    RIDERS.set(a.pid, a.riding);
    if (!on) {
      if (a.horse) { a.horse.mixer.stopAllAction(); a.horse.object.removeFromParent(); a.horse = null; }
      if (a.rig) for (const b of RIDE_BONES) if (a.rig.bones[b] && a.rig.rest && a.rig.rest[b]) a.rig.bones[b].quaternion.copy(a.rig.rest[b]);
      return;
    }
    const attach = () => {
      if (!a.riding || a.horse || !models.isReady('animal:horse')) return;
      const c = models.clone('animal:horse');
      if (!c) return;
      const mixer = new THREE.AnimationMixer(c.object);
      const actions = {};
      for (const [name, clip] of c.clips) actions[name] = mixer.clipAction(clip);
      // a holder: the clone's own root carries the model's normalising scale and offset
      const holder = new THREE.Group();
      holder.add(c.object);
      holder.scale.setScalar(RIDE.horseScale);
      holder.position.z = -0.15;                                  // the saddle sits a little behind the shoulders
      // RD-14 (QA wave 2): a saddle on a blanket in the farmer's colour, stirrups and reins up to the horse's neck
      holder.add(saddleMesh(a.color));
      a.root.add(holder);
      a.horse = { object: holder, mixer, actions, base: null };
    };
    if (models.isReady('animal:horse')) attach(); else models.ready(['animal:horse']).then(attach).catch(() => {});
    if (fx && a.pose) fx.play({ e: 'joined', pid: a.pid }, new THREE.Vector3(a.pose.x * TILE_M, 0, a.pose.z * TILE_M));
  }
  /** Astride: the farmer up on the saddle, thighs forward and apart round the horse, shins down; the horse walks or
   *  gallops with the farmer's speed. Returns the frames it wants. */
  function ridePose(a, dt) {
    const r = a.rig;
    const h = a.horse;
    if (!h) return 1;
    const sp = a.speed;
    const clip = sp < 0.15 ? 'Idle' : sp < 4.2 ? 'Walk' : 'Run';
    const act = h.actions[clip] || h.actions.Idle;
    if (act && h.base !== act) { act.reset().play(); if (h.base) h.base.crossFadeTo(act, 0.25, false); h.base = act; }
    if (act) act.timeScale = clip === 'Idle' ? 1 : Math.max(0.6, Math.min(1.8, sp / (clip === 'Walk' ? 2.6 : 6.5)));
    h.mixer.update(motion === 'still' ? 0 : dt);
    h.object.rotation.y = 0;
    // up onto the saddle; a little bounce at the walk
    const bounce = clip === 'Idle' ? 0 : Math.abs(Math.sin(clock * (clip === 'Walk' ? 6 : 10))) * (clip === 'Walk' ? 0.03 : 0.07);
    r.object.position.y = -(r.drop || 0) + RIDE.saddle - (r.hipsY || 0.95) + bounce;
    if (!r.rest) { r.rest = {}; for (const b of RIDE_BONES) if (r.bones[b]) r.rest[b] = r.bones[b].quaternion.clone(); }
    const fx0 = Math.sin(a.facing); const fz0 = Math.cos(a.facing);
    const sx = Math.cos(a.facing); const sz = -Math.sin(a.facing);              // the farmer's left (it faces +z)
    for (const [side, sg] of [['L', 1], ['R', -1]]) {            // (sx, sz) is the farmer's left
      // thighs forward and down along the horse's flanks, knees bent, shins down and a little back
      aimBone(r.bones[`UpperLeg${side}`], r.bones[`LowerLeg${side}`], aim.set(fx0 * 0.5 + sx * sg * 0.3, -0.72, fz0 * 0.5 + sz * sg * 0.3).normalize(), 1);
      aimBone(r.bones[`LowerLeg${side}`], r.bones[`Foot${side}`], aim.set(-fx0 * 0.18 + sx * sg * 0.12, -1, -fz0 * 0.18 + sz * sg * 0.12).normalize(), 1);
      // the hands forward at the withers, holding the reins (RD-14): upper arms down and forward, forearms forward
      aimBone(r.bones[`UpperArm${side}`], r.bones[`LowerArm${side}`], aim.set(fx0 * 0.45 + sx * sg * 0.12, -0.85, fz0 * 0.45 + sz * sg * 0.12).normalize(), 1);
      aimBone(r.bones[`LowerArm${side}`], r.bones[`Wrist${side}`], aim.set(fx0 * 0.95 - sx * sg * 0.12, -0.2, fz0 * 0.95 - sz * sg * 0.12).normalize(), 1);
    }
    return sp > 0.05 ? 2 : motion === 'still' ? 0 : 1;
  }

  // -------------------------------------------------------------------------------------------------
  // the Friendly Duel's crown (wave 3; rules-goals farm.duel.crown = { pids, until }): a little gold crown on the
  // winner's head for the week (the name card's crown is the UI's)
  let crown = null;
  const crownGeo = merge([cyl(0.13, 0.12, 0.08, 10, '#E9B13A'), ...Array.from({ length: 5 }, (_, i) => cone(0.035, 0.09, 4, '#FFC83D', { x: Math.sin((i / 5) * Math.PI * 2) * 0.11, y: 0.08, z: Math.cos((i / 5) * Math.PI * 2) * 0.11 })),
    ...Array.from({ length: 5 }, (_, i) => ball(0.022, i % 2 ? '#E8443A' : '#4AA8E8', { x: Math.sin((i / 5) * Math.PI * 2 + 0.6) * 0.125, y: 0.04, z: Math.cos((i / 5) * Math.PI * 2 + 0.6) * 0.125 }))]);
  const crownMat = models.createMaterial();
  const headW = new THREE.Vector3();
  function placeCrown(a, on) {
    if (!on || !a.rig || !a.rig.bones.Head) { if (a.crownObj) a.crownObj.visible = false; return 0; }
    if (!a.crownObj) { a.crownObj = new THREE.Mesh(crownGeo, crownMat); a.crownObj.castShadow = false; layers.avatars.add(a.crownObj); }
    a.rig.bones.Head.getWorldPosition(headW);
    const k = a.root.scale.x || 1;
    a.crownObj.visible = a.root.visible;
    a.crownObj.position.set(headW.x, headW.y + (a.rig.headTop - 0.06) * k, headW.z);
    a.crownObj.rotation.set(-0.12, a.facing, 0.08);
    a.crownObj.scale.setScalar(k * 1.25);
    return 0;
  }

  // -------------------------------------------------------------------------------------------------
  // fishing (wave 3): the float, the line, the catch
  let lastState = null;
  const floatGeo = merge([ball(0.06, '#E8443A', { y: 0.035, sy: 0.8 }), cyl(0.058, 0.062, 0.045, 10, '#FFF8EC'), cyl(0.008, 0.008, 0.13, 4, '#E8443A', { y: 0.06 })]);
  const floatMat = models.createMaterial();
  const lineMat = new THREE.LineBasicMaterial({ color: '#F6F2E6', transparent: true, opacity: 0.85, depthWrite: false });
  const LINE_N = 14;
  const tipLocal = new THREE.Vector3(0, 2, 0);
  const tipW = new THREE.Vector3();
  /** A fish of species `id` (FISHING.fish: its hue), `cm` long, nose +x. */
  function fishMesh(id, cm) {
    const f = (FISHING && FISHING.fish || []).find((x) => x.id === id);
    const hue = f ? f.hue : '#9DA9B0';
    const k = Math.max(0.6, Math.min(2.2, (cm || 30) / 30));
    const g = id === 'old_boot'
      ? merge([box(0.16, 0.2, 0.1, '#5A4030', { x: -0.02 }), box(0.28, 0.08, 0.11, '#4A3424', { x: 0.04 }), box(0.3, 0.025, 0.12, '#2E2018', { x: 0.04, y: -0.01 })])
      : merge([ball(0.1, hue, { sx: 1.9, sy: 0.85, sz: 0.5 }), ball(0.07, '#F2F0E6', { y: -0.03, sx: 1.6, sy: 0.55, sz: 0.45 }),
        cone(0.08, 0.14, 4, hue, { x: -0.24, rz: Math.PI / 2, sz: 0.25 }), cone(0.04, 0.09, 3, hue, { y: 0.06, sz: 0.2 }),
        ball(0.018, '#1A1A1A', { x: 0.13, y: 0.025, z: 0.04 }), ball(0.018, '#1A1A1A', { x: 0.13, y: 0.025, z: -0.04 })]);
    const m = new THREE.Mesh(g, floatMat);
    m.scale.setScalar(k);
    return m;
  }
  function fishStart(a, ev, at = null) {
    if (!a.pose) return;
    const here = { x: a.pose.x * TILE_M, z: a.pose.z * TILE_M };
    // at a Fishing Dock the farmer sits on its end, facing the water (both fit: the slot follows the player order); at
    // a pond's own fishing spot (rules-economy's `spot` = the expansion id: its feature.fishingSpot tile) the float
    // lands on the spot
    const sid = ev ? (ev.spot ?? ev.id) : null;
    const dock = sid && lastState && Object.hasOwn(lastState.farm.objects, sid) ? lastState.farm.objects[sid] : null;
    const pond = sid && !dock ? CONTENT.expansions.get(sid) : null;
    const fs0 = pond && pond.feature && pond.feature.fishingSpot;
    let seat = null;
    if (dock && dock.def === 'pond_dock' && Number.isFinite(dock.x)) seat = seatFrame(dock, a.pid === 'p1' ? -1 : 1);
    const spotW = fs0 ? { x: (fs0.x + 0.5) * TILE_M, z: (fs0.z + 0.5) * TILE_M } : null;
    // Willow Pond's own dock (land-features draws it; the client walks the farmer to one of its seats): face the water
    // from the nearer seat and cast out on the pond. The rules' fishingSpot is the dock's LAND end: aiming there put the
    // float on the planks with the farmer facing the shore (final release V-01)
    const pc = pond && sid === 'willow_pond' ? pondCast(here) : null;
    const face = seat ? seat.face : pc ? pc.face : spotW ? Math.atan2(spotW.x - here.x, spotW.z - here.z) : a.facing;
    const from = seat || here;
    const target = at || (seat ? { x: from.x + Math.sin(face) * 1.25, z: from.z + Math.cos(face) * 1.25 }
      : pc ? pc.target : spotW || castPoint(from, face, ev));
    if ((spotW || pc) && !seat) a.faceTo = face;
    if (!a.fish) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: LINE_N }, () => new THREE.Vector3())), lineMat);
      line.frustumCulled = false;
      const flt = new THREE.Mesh(floatGeo, floatMat);
      flt.visible = false;
      layers.ui3d.add(line); layers.ui3d.add(flt);
      a.fish = { line, flt, toolWas: a.tool };
    }
    Object.assign(a.fish, { phase: 'cast', t: clock, target, seat, face, catch: null, until: clock + FISH_T.idleMs / 1000, biteAt: ev && Number.isFinite(ev.bite) ? ev.bite : null });
    if (seat) { a.fishSeat = seat; }
    setTool(a, 'fishing_rod');
  }
  function fishEnd(a) {
    const f = a.fish;
    if (!f) return;
    f.line.removeFromParent(); f.line.geometry.dispose(); f.flt.removeFromParent();
    if (f.fishObj) { f.fishObj.removeFromParent(); f.fishObj.geometry.dispose(); }
    a.fish = null; a.fishSeat = null;
    setTool(a, f.toolWas && f.toolWas !== 'fishing_rod' ? f.toolWas : null);
    if (a.rig && a.rig.rest) for (const b of FISH_BONES) if (a.rig.bones[b] && a.rig.rest[b]) a.rig.bones[b].quaternion.copy(a.rig.rest[b]);
  }
  /** The fishing phases per frame: arms, float, line, the landed fish. Returns the frames it wants. */
  function fishPose(a, dt) {
    const f = a.fish; const r = a.rig;
    if (!f || !r) return 0;
    const age = clock - f.t;
    if (f.phase === 'cast' && age > FISH_T.swing + FISH_T.fly) { f.phase = 'wait'; f.t = clock; if (fx) fishSplash(f.target, 0.6); }
    if (f.phase === 'bite' && age > 0.9) { f.phase = 'wait'; f.t = clock; }
    // the rules rolled the bite time (fishCast.bite, server ms): the float dips then, on both screens
    if (f.phase === 'wait' && f.biteAt !== null && now() >= f.biteAt) { f.biteAt = null; f.phase = 'bite'; f.t = clock; if (fx) fishSplash(f.target, 0.35); }
    if (f.phase === 'reel' && age > FISH_T.reel) { f.phase = 'show'; f.t = clock; landFish(a); }
    if (f.phase === 'show' && age > FISH_T.show) { fishEnd(a); return 2; }
    if (f.phase === 'wait' && clock > f.until) { fishEnd(a); return 1; }
    if (!r.rest) { r.rest = {}; for (const b of RIDE_BONES) if (r.bones[b]) r.rest[b] = r.bones[b].quaternion.clone(); }
    // the arms (the rod is in the right hand): back over the shoulder and whipped forward on the cast, held out and up
    // while waiting, a jerk on the bite, the left hand winding the reel while reeling in
    const fx0 = Math.sin(a.facing); const fz0 = Math.cos(a.facing); const sx = Math.cos(a.facing); const sz = -Math.sin(a.facing);
    let up = 0.35; let fwd = 0.9;
    if (f.phase === 'cast') {
      const t = Math.min(1, age / FISH_T.swing);
      up = t < 0.55 ? 0.35 + (t / 0.55) * 1.2 : 1.55 - ((t - 0.55) / 0.45) * 1.3;
      fwd = t < 0.55 ? 0.9 - (t / 0.55) * 1.5 : -0.6 + ((t - 0.55) / 0.45) * 1.6;
    } else if (f.phase === 'bite') up = 0.55 + Math.sin(age * 30) * 0.08 * Math.max(0, 1 - age);
    else if (f.phase === 'show') { up = 0.9; fwd = 0.6; }
    aimBone(r.bones.UpperArmR, r.bones.LowerArmR, aim.set(fx0 * 0.6 - sx * 0.25, -0.75, fz0 * 0.6 - sz * 0.25).normalize(), 1);
    aimBone(r.bones.LowerArmR, r.bones.WristR, aim.set(fx0 * fwd - sx * 0.1, up, fz0 * fwd - sz * 0.1).normalize(), 1);
    const wind = f.phase === 'reel' ? age * 9 : 0;
    aimBone(r.bones.UpperArmL, r.bones.LowerArmL, aim.set(fx0 * 0.55 + sx * 0.1, -0.8, fz0 * 0.55 + sz * 0.1).normalize(), 1);
    aimBone(r.bones.LowerArmL, r.bones.WristL, aim.set(fx0 * 0.8 - sx * (0.45 + Math.sin(wind) * 0.12), 0.2 + Math.cos(wind) * 0.12, fz0 * 0.8 - sz * (0.45 + Math.sin(wind) * 0.12)).normalize(), 1);
    // the rod tip in the world
    const tool = r.toolObj && r.toolObj.children[0];
    if (!tool) return 2;
    tool.updateWorldMatrix(true, false);
    tipW.copy(tipLocal).applyMatrix4(tool.matrixWorld);
    // the float: in the air on the cast, bobbing on the water, dipping on a bite, coming home on the reel
    const W = FLOAT_Y;
    let fp;
    if (f.phase === 'cast') {
      const t = Math.max(0, Math.min(1, (age - FISH_T.swing) / FISH_T.fly));
      fp = { x: tipW.x + (f.target.x - tipW.x) * t, y: tipW.y + (W - tipW.y) * t + Math.sin(t * Math.PI) * 1.2, z: tipW.z + (f.target.z - tipW.z) * t };
      f.flt.visible = age > FISH_T.swing * 0.8;
    } else if (f.phase === 'reel') {
      const t = Math.min(1, age / FISH_T.reel);
      const home = { x: tipW.x + (f.target.x - tipW.x) * 0.15, z: tipW.z + (f.target.z - tipW.z) * 0.15 };
      fp = { x: f.target.x + (home.x - f.target.x) * t, y: W + Math.sin(age * 12) * 0.02, z: f.target.z + (home.z - f.target.z) * t };
      f.flt.visible = true;
    } else {
      const dip = f.phase === 'bite' ? -0.1 * Math.max(0, Math.sin(age * 9)) : 0;
      fp = { x: f.target.x, y: W + Math.sin(clock * 2.1) * 0.015 + dip, z: f.target.z };
      f.flt.visible = f.phase !== 'show';
    }
    f.flt.position.set(fp.x, fp.y, fp.z);
    // the line: rod tip to float, slack while waiting, taut on a bite or the reel
    const sag = f.phase === 'cast' ? 0.05 : f.phase === 'wait' ? 0.35 : 0.08;
    const lp = f.line.geometry.getAttribute('position');
    const end = f.phase === 'show' && f.fishObj ? f.fishObj.position : fp;
    for (let i = 0; i < LINE_N; i++) { const q0 = linePoint(tipW, end, i / (LINE_N - 1), sag); lp.setXYZ(i, q0.x, q0.y, q0.z); }
    lp.needsUpdate = true;
    f.line.visible = f.phase !== 'cast' || age > FISH_T.swing * 0.8;
    // the landed fish swings on the line under the rod tip, wriggling
    if (f.phase === 'show' && f.fishObj) {
      const t = Math.min(1, age / 0.5);
      const hang = { x: tipW.x, y: tipW.y - 0.45, z: tipW.z };
      f.fishObj.position.set(f.target.x + (hang.x - f.target.x) * t, W + (hang.y - W) * t + Math.sin(t * Math.PI) * 0.8, f.target.z + (hang.z - f.target.z) * t);
      f.fishObj.rotation.set(0, a.facing + Math.PI / 2, Math.PI / 2 + Math.sin(clock * 14) * 0.35 * (1 - t * 0.5));
    }
    if (fx && f.phase === 'wait' && clock >= (f.ringAt || 0)) {
      f.ringAt = clock + 2.4;
      fx.burst('ring', new THREE.Vector3(fp.x, W - 0.02, fp.z), { n: 1, color: '#E4F4FF', speed: 0, up: 0, size: 0.15, sizeEnd: 0.9, grav: 0, spin: 0, life: 1.4, spread: 0, alpha: 0.5, ambient: true, flat: true, additive: false });
    }
    return 2;
  }
  function fishSplash(p, k = 1) {
    if (!fx) return;
    const v0 = new THREE.Vector3(p.x, FLOAT_Y, p.z);
    fx.burst('droplet', v0, { n: Math.round(8 * k), colors: ['#BFEFFF', '#FFFFFF'], speed: 1.4 * k, up: 2.2 * k, size: 0.12, grav: 0.9, life: 0.6, spread: 0.1 });
    for (let i = 0; i < 2; i++) fx.burst('ring', v0, { n: 1, color: '#E4F4FF', speed: 0, up: 0, size: 0.2, sizeEnd: 1.4 * k, grav: 0, spin: 0, life: 1.0, spread: 0, alpha: 0.6, flat: true, additive: false, delay: i * 0.18 });
  }
  function landFish(a) {
    const f = a.fish; const c = f.catch || {};
    fishSplash(f.target, 1.2);
    f.fishObj = fishMesh(c.fish, c.cm);
    f.fishObj.position.set(f.target.x, FLOAT_Y, f.target.z);
    layers.ui3d.add(f.fishObj);
    const sp = FISHING && (FISHING.fish || []).find((x) => x.id === c.fish);
    if (fx && sp) {
      const at = new THREE.Vector3(f.target.x, 1.4, f.target.z);
      fx.float(at, sp.joke ? `${sp.name}!` : `${sp.name}${Number.isFinite(c.cm) ? ` ${c.cm} cm` : ''}!`, { color: c.record ? '#FFE58A' : '#BFEFFF', size: c.record ? 1.3 : 1.1, life: 1800 });
      if (c.record) fx.burst('star', at, { n: 10, colors: ['#FFE27A', '#FFFFFF'], speed: 2, up: 2.4, size: 0.4, grav: 0.2, life: 1.2 });
    }
  }

  // Golden Hour: a warm gold halo under both farmers and hearts drifting up round them (VISUAL-AFTER D2)
  let golden = null;
  const gold = new THREE.Color('#FFC83D');
  function goldenK(t) {
    if (!golden) return 0;
    const from = Number.isFinite(golden.from) ? golden.from : -Infinity; const until = Number.isFinite(golden.until) ? golden.until : -Infinity;
    if (t < from || t > until) return 0;
    return Math.min(1, (t - from) / 4000, (until - t) / 4000);
  }

  // -------------------------------------------------------------------------------------------------
  // pets (GDD §3.4 Pets): one dog or cat per farmer, following them about
  /** owner pid -> pet */
  const pets = new Map();
  /** the sky says pets sleep (wave 4: late dusk to dawn, petsAsleep) */
  let petNight = false;
  /** pet kind -> its home on the farm (metres, facing out of the door), read from setSeats' state */
  let petHomes = {};

  function syncPets(players) {
    for (const [pid, p] of Object.entries(players || {})) {
      const want = p && p.pet && Object.hasOwn(PET, p.pet.kind) ? p.pet : null;
      const have = pets.get(pid);
      // wave 4: a new breed is a new model; the pet stays where it is (and asleep if it was)
      const keep = have && want && have.kind === want.kind && have.key !== petKeyOf(want) ? { x: have.x, z: have.z, facing: have.facing, placed: have.placed, asleep: have.asleep } : null;
      if (have && (!want || have.kind !== want.kind || keep)) dropPet(pid);
      if (want && (!have || have.kind !== want.kind || keep)) addPet(pid, want, keep);
      if (want && pets.get(pid)) pets.get(pid).name = want.name;
    }
    for (const pid of [...pets.keys()]) if (!players || !Object.hasOwn(players, pid)) dropPet(pid);
  }

  function addPet(pid, pet, keep = null) {
    const k = PET[pet.kind];
    const key = petKeyOf(pet);
    const root = new THREE.Group();
    root.name = `pet-${pid}`;
    const holder = new THREE.Group();
    holder.scale.setScalar(k.scale);
    root.add(holder);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.03;
    shadow.renderOrder = 1;
    shadow.scale.set(pet.kind === 'cat' ? 0.42 : 0.5, 1, pet.kind === 'cat' ? 0.62 : 0.78);
    root.add(shadow);
    root.visible = false;                                   // until it has a place beside its farmer
    layers.avatars.add(root);
    const b = models.has(key) ? models.boundsOf(key) : null;
    const len = b ? (b.max.z - b.min.z) * k.scale : 0.7;
    const h = b ? b.max.y * k.scale : 0.6;
    const p = { pid, kind: pet.kind, key, name: pet.name, root, holder, mixer: null, actions: {}, base: null, once: null, onceEnd: 0,
      x: 0, z: 0, placed: false, facing: 0, speed: 0, trail: [], stillT: 0, hopT: 0, r: Math.max(0.4, len * 0.55), h: Math.max(0.5, h),
      asleep: false, lying: false, wakeUntil: 0, zzz: null, zzzT: '', ...(keep || {}) };
    pets.set(pid, p);
    const attach = () => {
      if (pets.get(pid) !== p || p.mixer || !models.isReady(key)) return;
      const c = models.clone(key);
      if (!c) return;
      p.mixer = new THREE.AnimationMixer(c.object);
      for (const [name, clip] of c.clips) p.actions[name] = p.mixer.clipAction(clip);
      holder.add(c.object);
      playPet(p, 'Idle', 1, 0);
    };
    models.init().then(() => (models.has(key) ? models.ready([key]) : null)).then(attach)
      .catch((err) => console.error(`pet of ${pid}: model failed to load`, err));
  }

  function dropPet(pid) {
    const p = pets.get(pid);
    if (!p) return;
    if (p.mixer) p.mixer.stopAllAction();
    p.root.removeFromParent();
    if (p.zzz) p.zzz.remove();
    pets.delete(pid);
    PET_PICKS.delete(pid);
  }

  let emojiCheck = null;
  /** Does this device draw colour emoji? (drawn once on a little canvas: an emoji font leaves coloured pixels) */
  function emojiOk() {
    if (emojiCheck !== null) return emojiCheck;
    emojiCheck = false;
    try {
      const c = document.createElement('canvas'); c.width = 24; c.height = 24;
      const g = c.getContext('2d');
      g.font = '18px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      g.textBaseline = 'top';
      g.fillStyle = '#000';
      g.fillText('💤', 2, 2);
      const d = g.getImageData(0, 0, 24, 24).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40)) { emojiCheck = true; break; }
    } catch { /* no canvas: the letters */ }
    return emojiCheck;
  }
  /** The 💤 over a sleeping pet (wave 4, owner wish 4): a DOM bubble whose float and fade are CSS (no render frames);
   *  only its place follows the camera, written when it changed. */
  function zzzOf(p) {
    if (p.zzz) return p.zzz;
    if (typeof document !== 'undefined' && !document.getElementById('hh-zzz-style')) {
      const st = document.createElement('style');
      st.id = 'hh-zzz-style';
      // the content's 💤 in a little cream bubble that bobs; where the device draws no colour emoji (no emoji font),
      // three z's of growing size drifting up one after another
      st.textContent = '@keyframes hh-zzz{0%{opacity:0;translate:0 6px}25%{opacity:1}80%{opacity:1}100%{opacity:0;translate:8px -16px}}'
        + '.hh-zzz{position:absolute;left:0;top:0;pointer-events:none;will-change:transform;display:flex;align-items:flex-end;gap:1px;'
        + 'font:800 15px/1 system-ui,sans-serif;color:#5B7FD6;-webkit-text-stroke:3px #FFF8EC;paint-order:stroke fill;filter:drop-shadow(0 1px 0 rgba(60,30,10,.3))}'
        + '.hh-zzz>span{display:inline-block;animation:hh-zzz 2.4s ease-in-out infinite}'
        + '.hh-zzz>span:nth-child(2){font-size:19px;animation-delay:.4s}.hh-zzz>span:nth-child(3){font-size:24px;animation-delay:.8s}'
        + '.hh-zzz-emoji{font:22px/1 "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;-webkit-text-stroke:0;'
        + 'background:#FFF8EC;border:2px solid #7A4B2C;border-radius:14px;padding:3px 5px;box-shadow:0 2px 0 rgba(60,30,10,.3)}'
        + '.hh-zzz-emoji>span{animation-name:hh-zzz-bob}@keyframes hh-zzz-bob{0%,100%{translate:0 0}50%{translate:0 -3px}}'
        + '@media (prefers-reduced-motion: reduce){.hh-zzz>span{animation:none}}';
      document.head.appendChild(st);
    }
    const el = document.createElement('div');
    el.className = 'hh-zzz';
    const bubble = PETS_CONTENT?.sleep?.bubble || '💤';
    el.title = bubble;
    // the content's 💤 when this device draws emoji (a one-off canvas check), else three drifting letters
    for (const ch of emojiOk() ? [bubble] : ['z', 'z', 'Z']) { const sp = document.createElement('span'); sp.textContent = ch; el.appendChild(sp); }
    if (emojiOk()) el.classList.add('hh-zzz-emoji');
    el.style.display = 'none';
    overlay.appendChild(el);
    p.zzz = el;
    return el;
  }

  /** Where a pet sleeps (metres): its own Dog House's mat / Cat Basket (the model's `bed` anchor), else in front of the
   *  farmhouse's steps (content PETS.sleep: "or to the farmhouse porch without one"); null when neither exists. */
  function bedOf(kind) {
    if (petHomes[kind]) return petHomes[kind];
    const fh = petHomes.farmhouse;
    if (!fh) return null;
    const lx = kind === 'dog' ? -1.2 : -3.0; const lz = kind === 'dog' ? 3.3 : 3.1;
    const c = Math.cos(fh.face); const sn = Math.sin(fh.face);
    return { x: fh.x + lx * c + lz * sn, z: fh.z - lx * sn + lz * c, face: fh.face + (kind === 'dog' ? 0.4 : -0.5), y: 0 };
  }

  function playPet(p, clip, scale, fade = 0.2) {
    const act = p.actions[clip] || p.actions.Walk || p.actions.Idle;
    if (!act) return;
    act.timeScale = scale;
    if (p.base === act) return;
    act.reset().setEffectiveWeight(1).play();
    if (p.base && fade > 0) p.base.crossFadeTo(act, fade, false); else if (p.base) p.base.stop();
    p.base = act;
  }

  /** A one-off clip over the loop (the dog's happy jump, its dig); the cat, without such clips, hops. */
  function petOnce(p, clip, hop = 0.45) {
    const act = clip && p.actions[clip];
    if (!act || motion === 'still') { if (motion !== 'still') p.hopT = hop; return; }
    if (p.once && p.once !== act) p.once.fadeOut(0.1);
    act.reset();
    act.setLoop(THREE.LoopOnce, 1);
    act.clampWhenFinished = false;
    act.setEffectiveWeight(1).fadeIn(0.12).play();
    p.once = act;
    p.onceEnd = clock + act.getClip().duration - 0.12;
  }

  function updatePet(p, dt, t) {
    const a = av.get(p.pid);
    if (!a || !a.pose) { p.root.visible = false; PET_PICKS.delete(p.pid); if (p.zzz) p.zzz.style.display = 'none'; return 0; }
    const k = PET[p.kind];
    const ox = a.root.position.x; const oz = a.root.position.z;
    const away = !a.self && !a.online;
    // wave 4 (owner wish 4): from late dusk to dawn the pet goes to its bed (Dog House mat, Cat Basket, else the
    // farmhouse steps) and sleeps there with a 💤; a pat wakes it for a moment. Without any bed it dozes at heel while
    // its farmer stands still.
    const bed = petNight && clock >= p.wakeUntil ? bedOf(p.kind) : null;
    if (bed) return sleepAt(p, bed, dt);
    const dozing = petNight && clock >= p.wakeUntil && !away && (a.speed || 0) < 0.3 && p.stillT > 2.5;
    if ((p.asleep || p.lying) && !dozing) wake(p);
    // the farmer's trail: a breadcrumb every 0.3 m (a hop starts a new trail)
    const last = p.trail[p.trail.length - 1];
    const jump = last ? Math.hypot(ox - last.x, oz - last.z) : Infinity;
    if (jump > 6) p.trail = [{ x: ox, z: oz }];
    else if (jump > 0.3) { p.trail.push({ x: ox, z: oz }); if (p.trail.length > 30) p.trail.shift(); }
    const moving = !away && a.speed > 0.3;
    p.stillT = moving ? 0 : p.stillT + dt;
    // standing about: two idle spells in three it sniffs round its farmer (the same spot on both screens: server time)
    let roam = null;
    if (!away && !a.seat && p.stillT > k.still && motion !== 'still') {
      const h = hash32(`${p.pid}:pet`, Math.floor(t / 7000));
      if (h % 3 !== 0) {
        const ang = ((h >>> 4) % 3600) / 3600 * Math.PI * 2; const rr = 1.0 + (((h >>> 16) % 100) / 100) * (k.roam - 1.0);
        roam = { x: Math.sin(ang) * rr, z: Math.cos(ang) * rr };
      }
    }
    const seat = a.seat && a.sitK > 0.5 ? a.seat : null;
    const home = away ? petHomes[p.kind] || null : null;
    const goal = petGoal(p.kind, { x: ox, z: oz, facing: a.facing, moving, seat, away, home }, { trail: p.trail, roam });
    if (!p.placed) { p.x = goal.x; p.z = goal.z; p.facing = a.facing; p.placed = true; }
    const dx = goal.x - p.x; const dz = goal.z - p.z; const d = Math.hypot(dx, dz);
    let step = 0;
    if (d > 14) { p.x = goal.x; p.z = goal.z; p.trail = [{ x: ox, z: oz }]; }                  // a hop: it comes along
    else if (d > 0.2) {
      // keeping up with a walking (or riding) farmer, strolling when it sniffs about
      const v = moving ? Math.min(14, a.speed + 0.5 + d * 2.5) : roam ? Math.min(k.walk * 1.1, 0.4 + d * 1.2) : Math.min(k.run + 1, 0.6 + d * 2.4);
      step = Math.min(d, v * dt);
      p.x += (dx / d) * step; p.z += (dz / d) * step;
    }
    // never inside its farmer
    if (!away && !seat) {
      const ex = p.x - ox; const ez = p.z - oz; const e = Math.hypot(ex, ez);
      if (e < 0.6) { const u = e > 1e-4 ? 1 / e : 0; p.x = ox + (u ? ex * u : Math.sin(a.facing + Math.PI)) * 0.6; p.z = oz + (u ? ez * u : Math.cos(a.facing + Math.PI)) * 0.6; }
    }
    const inst = dt > 0 ? step / dt : 0;
    p.speed += (inst - p.speed) * Math.min(1, dt * 8);
    const face = p.speed > 0.15 && d > 0.05 ? Math.atan2(dx, dz) : goal.face ?? Math.atan2(ox - p.x, oz - p.z);
    p.facing += angleDelta(p.facing, face) * Math.min(1, dt * (p.speed > 0.15 ? 10 : 4));
    p.root.position.set(p.x, home && d < 0.3 ? home.y || 0 : 0, p.z);
    p.root.rotation.y = p.facing;
    p.root.visible = true;
    // the clip: a one-off wins until it ends; idle (the dog sniffs now and then), walk, gallop (the cat bounds)
    let bound = 0;
    if (p.once && clock > p.onceEnd) { p.once.fadeOut(0.15); p.once = null; }
    if (!p.once) {
      if (p.speed < 0.12) playPet(p, p.kind === 'dog' && Math.floor(clock / 7) % 3 === 2 ? 'Idle2' : 'Idle', 1);
      else if (p.speed < k.run) playPet(p, 'Walk', Math.max(0.7, Math.min(p.kind === 'cat' ? 2.6 : 1.9, p.speed / k.walk)));
      else playPet(p, 'Run', Math.max(0.8, Math.min(1.8, p.speed / k.runRate)));
      if (p.kind === 'cat' && p.speed > 2.4) bound = Math.abs(Math.sin(clock * 13)) * 0.07;
    }
    if (p.hopT > 0) { p.hopT = Math.max(0, p.hopT - dt); bound = Math.max(bound, Math.sin((1 - p.hopT / 0.45) * Math.PI) * 0.22); }
    p.holder.position.y = bound;
    if (dozing && p.speed < 0.12 && !p.once) { lieDown(p); placeZzz(p); }
    else if (p.zzz && p.zzz.style.display !== 'none') p.zzz.style.display = 'none';
    if (p.mixer) p.mixer.update(motion === 'still' ? 0 : dt);
    PET_PICKS.set(p.pid, { x: p.x, z: p.z, r: p.r, h: p.h, asleep: Boolean(dozing) });
    // a pat or a hop answers input at 60 fps; a pet keeping up with its walking farmer travels at the ambient rate; one
    // sniffing about its standing farmer is slow ambient (CL-03: strolling pets held 60 fps 60 % of the time at rest)
    return p.once || p.hopT > 0 ? 2 : p.speed > 0.05 && moving ? WANT.MOVING : motion === 'still' ? 0 : 1;
  }

  /** Lie down to sleep: the dog's 'Lie' clip (the UAA death fall, held on its last frame: lying on its side), the cat
   *  (no such clip) settles low into a loaf with its idle paused. */
  function lieDown(p) {
    if (p.lying) return;
    p.lying = true;
    const lie = p.actions.Lie;
    if (lie && motion !== 'still') {
      lie.reset(); lie.setLoop(THREE.LoopOnce, 1); lie.clampWhenFinished = true; lie.timeScale = 0.7;
      lie.setEffectiveWeight(1).play();
      if (p.base && p.base !== lie) p.base.crossFadeTo(lie, 0.5, false);
      p.base = lie;
      p.lieEnd = clock + lie.getClip().duration / 0.7 + 0.2;
    } else {
      if (lie) { lie.reset(); lie.setLoop(THREE.LoopOnce, 1); lie.clampWhenFinished = true; lie.play(); lie.time = lie.getClip().duration; if (p.base && p.base !== lie) p.base.stop(); p.base = lie; }
      p.lieEnd = clock;
    }
  }
  function wake(p) {
    p.asleep = false;
    if (p.lying) {
      p.lying = false;
      p.holder.scale.setScalar(PET[p.kind].scale);
      if (p.actions.Idle) { p.actions.Idle.timeScale = 1; playPet(p, 'Idle', 1, 0.4); }
    }
    if (p.zzz) p.zzz.style.display = 'none';
  }
  /** The 💤 just above a sleeping pet, scaled with the zoom like the nameplates; a transform is written only on change. */
  function placeZzz(p) {
    const el = zzzOf(p);
    const s0 = toScreen(p.x / TILE_M, p.z / TILE_M, p.h * 0.7 + (p.root.position.y || 0));
    if (!s0 || !s0.visible || !p.root.visible) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
    const tf = `translate3d(${Math.round(s0.x + 6)}px, ${Math.round(s0.y)}px, 0) translate(-50%, -100%)`;
    if (tf !== p.zzzT) { el.style.transform = tf; p.zzzT = tf; }
    if (el.style.display !== 'block') el.style.display = 'block';
  }
  /** Night: walk to the bed, curl up there, sleep (no frames asked once settled: the 💤 floats by CSS). */
  function sleepAt(p, bed, dt) {
    if (!p.placed) { p.x = bed.x; p.z = bed.z; p.facing = bed.face; p.placed = true; }
    const dx = bed.x - p.x; const dz = bed.z - p.z; const d = Math.hypot(dx, dz);
    let want = 0;
    if (d > 0.12) {
      if (p.lying) wake(p);
      // a sleepy trot home (or there at once from far away: it came round the house)
      if (d > 30) { p.x = bed.x; p.z = bed.z; } else {
        const step = Math.min(d, Math.min(p.kind === 'dog' ? PET.dog.run : PET.cat.walk * 1.8, 0.6 + d * 1.4) * dt);
        p.x += (dx / d) * step; p.z += (dz / d) * step;
        p.speed += (step / Math.max(1e-4, dt) - p.speed) * Math.min(1, dt * 8);
        p.facing += angleDelta(p.facing, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
        if (p.kind === 'dog' && p.speed > PET.dog.run * 0.8) playPet(p, 'Run', Math.max(0.8, Math.min(1.5, p.speed / PET.dog.runRate)));
        else playPet(p, 'Walk', Math.max(0.7, Math.min(2.2, p.speed / PET[p.kind].walk)));
        want = WANT.MOVING;
      }
    } else {
      p.speed = 0;
      const turn = angleDelta(p.facing, bed.face);
      if (Math.abs(turn) > 0.05 && !p.lying) { p.facing += turn * Math.min(1, dt * 5); playPet(p, 'Idle', 1); want = 1; }
      else {
        p.asleep = true;
        lieDown(p);
        if (clock < (p.lieEnd || 0)) want = 1;
      }
    }
    p.root.position.set(p.x, d < 0.3 ? bed.y || 0 : 0, p.z);
    p.root.rotation.y = p.facing;
    p.root.visible = true;
    p.holder.position.y = 0;
    // the cat curls into a loaf: lower and rounder (no lying clip of its own)
    const kk = PET[p.kind].scale;
    if (p.lying && !p.actions.Lie) { p.holder.scale.set(kk * 1.08, kk * 0.7, kk * 1.02); if (p.actions.Idle) p.actions.Idle.timeScale = 0; }
    if (p.mixer && (want || clock < (p.lieEnd || 0) + 0.1)) p.mixer.update(motion === 'still' ? 0 : dt);
    if (p.asleep) placeZzz(p); else if (p.zzz) p.zzz.style.display = 'none';
    PET_PICKS.set(p.pid, { x: p.x, z: p.z, r: p.r, h: p.h, asleep: p.asleep });
    return want;
  }

  /** petAdopted / petPetted / petFed / petFind (pid = the owner, by = who did it): the pet reacts where it is. */
  function petEvent(ev) {
    const p = pets.get(ev.pid);
    // a sleeping pet that is petted or fed wakes for a little while (then goes back to bed)
    if (p && (p.asleep || p.lying) && (ev.e === 'petPetted' || ev.e === 'petFed' || ev.e === 'petFind' || ev.e === 'petTreasure')) { p.wakeUntil = clock + 12; wake(p); }
    const pos = p && p.placed ? new THREE.Vector3(p.x, 0, p.z) : null;
    if (ev.e === 'petAdopted') {
      const o = av.get(ev.pid);
      if (fx && o && o.pose) fx.play({ e: 'joined', pid: ev.pid }, new THREE.Vector3(o.root.position.x, 0, o.root.position.z));
    }
    if (!p) return;
    if (ev.e === 'petPetted') petOnce(p, p.kind === 'dog' ? 'Jump' : null);
    else if (ev.e === 'petFed') petOnce(p, p.kind === 'dog' ? 'Eat' : null);
    else if (ev.e === 'petFind' || ev.e === 'petTreasure') {
      petOnce(p, p.kind === 'dog' ? 'Eat' : null);
      if (fx && pos) fx.burst('dust', pos.clone().setY(0.1), { n: 8, colors: ['#9A6B43', '#C49A6C'], speed: 0.9, up: 1.2, size: 0.18, grav: 1.2, life: 0.7, spread: 0.2 });
    }
    if (fx && pos) fx.play(ev, pos);
    // the farmer who petted or fed it bends down to it (act() works in tiles; it aims at the tile centre)
    const by = ev.by && av.get(ev.by);
    if (by && (ev.e === 'petPetted' || ev.e === 'petFed')) {
      act(ev.by, { x: p.x / TILE_M - 0.5, z: p.z / TILE_M - 0.5 });
      by.faceTo = Math.atan2(p.x - by.root.position.x, p.z - by.root.position.z);   // held until the gesture ends
    }
  }

  function findPetHomes(state) {
    const out = {};
    const objs = state && state.farm && state.farm.objects;
    if (!objs) return out;
    for (const id of Object.keys(objs).sort()) {
      const o = objs[id];
      const def = o && defOf(o.def);
      const kind = def && def.effect && def.effect.petHome;
      if (!kind || out[kind] || !Number.isFinite(o.x)) continue;
      const c = tileCentreOf(state, id);
      const face = (o.rot || 0) * (Math.PI / 2);
      // the cat curls up on its cushion (up in the basket); the dog lies on the mat just outside its door (wave 4: the
      // models' own `bed` anchor when they have one)
      const bed = models.info(models.keyOf(o.def) || '')?.anchors?.bed;
      const cx = (c.x + 0.5) * TILE_M; const cz = (c.z + 0.5) * TILE_M;
      if (Array.isArray(bed) && bed.length === 3) {
        const cs = Math.cos(face); const sn = Math.sin(face);
        out[kind] = { x: cx + bed[0] * cs + bed[2] * sn, z: cz - bed[0] * sn + bed[2] * cs, face, y: kind === 'cat' ? bed[1] * 0.6 : 0 };
      } else {
        const out1 = kind === 'dog' ? 2.3 : 0;
        out[kind] = { x: cx + Math.sin(face) * out1, z: cz + Math.cos(face) * out1, face, y: kind === 'cat' ? 0.12 : 0 };
      }
    }
    for (const id of Object.keys(objs).sort()) {
      const o = objs[id];
      if (o.def !== 'farmhouse' || !Number.isFinite(o.x)) continue;
      const c = tileCentreOf(state, id);
      out.farmhouse = { x: (c.x + 0.5) * TILE_M, z: (c.z + 0.5) * TILE_M, face: (o.rot || 0) * (Math.PI / 2) };
      break;
    }
    return out;
  }

  function update(dt) {
    clock += dt;
    let want = 0;
    const t = now();
    const gk = goldenK(t);
    for (const a of av.values()) {
      if (!a.self && a.online) {
        const p = a.buf.at(t);
        if (p) {
          if (a.pose && Math.abs(a.pose.x - p.x) + Math.abs(a.pose.z - p.z) > 1e-3) want = Math.max(want, WANT.MOVING);
          placeRoot(a, { x: p.x, z: p.z, f: p.f, a: p.a });
          a.cursor = p.cx !== null && p.cx !== undefined ? { x: p.cx, z: p.cz } : null;
          // the partner rides while their presence tool is 'horse' (the client's RIDE_TOOL; 'ride' too)
          const mounted = p.tool === 'horse' || p.tool === 'ride';
          if (mounted !== !!a.riding) setRiding(a, mounted);
          // the partner holding the rod (presence tool 'rod' / 'fishing') stands fishing on this screen too (wave 3)
          const rod = p.tool === 'rod' || p.tool === 'fishing' || p.tool === 'fishing_rod';
          if (rod && !a.fish) { fishStart(a, null); if (a.fish) a.fish.fromPresence = true; }
          if (!rod && a.fish && a.fish.fromPresence && a.fish.phase === 'wait') fishEnd(a);
          // inside the farmhouse room (presence tool 'indoors', game/interior.js): not on the farm; the room draws the
          // farmer (view.interior.setPresent, fed by main.js)
          const inside = p.tool === 'indoors';
          if (a.root.visible === inside) a.root.visible = !inside;
          if (p.tool !== a.tool && !mounted && !a.fish && !inside) setTool(a, p.tool);
        }
      }
      if (!a.pose) continue;
      // seated on a bench: the seat, not the presence pose; the sit pose blends in and out over 200 ms (RD-17); a farmer
      // fishing from a Fishing Dock sits on its end (wave 3)
      if (a.fishSeat && !a.seat) { a.seatFromFish = true; a.seat = a.fishSeat; a.lastSeat = a.fishSeat; } else if (a.seatFromFish && !a.fishSeat) { a.seatFromFish = false; a.seat = null; }
      const sitGoal = a.seat ? 1 : 0;
      if (a.sitK !== sitGoal) { a.sitK = sitGoal > a.sitK ? Math.min(1, a.sitK + dt / 0.2) : Math.max(0, a.sitK - dt / 0.2); want = Math.max(want, 2); }
      const seat = a.seat || a.lastSeat;
      const sk = seat ? a.sitK : 0;
      const tx = sk > 0 ? seat.x : a.pose.x * TILE_M; const tz = sk > 0 ? seat.z : a.pose.z * TILE_M;
      const prevX = a.root.position.x; const prevZ = a.root.position.z;
      a.root.position.set(tx, 0, tz);
      const moved = Math.hypot(tx - prevX, tz - prevZ);
      const inst = dt > 0 ? moved / dt : 0;
      a.speed += (Math.min(inst, 8) - a.speed) * Math.min(1, dt * 10);
      if (moved > 2.5) a.speed = 0;                           // a teleport (hop) is not a sprint
      // facing: toward motion; a pending gesture or high-five turns to its target
      let face = a.pose.f ?? a.facing;
      if (a.faceTo !== undefined && a.speed < 0.3) face = a.faceTo;
      if (a.pending && a.speed < 0.3) face = Math.atan2(a.pending.x + 0.5 - a.pose.x, a.pending.z + 0.5 - a.pose.z);
      if (sk > 0) face = seat.face;
      a.facing += angleDelta(a.facing, face) * Math.min(1, dt * 12);
      a.root.rotation.y = a.facing;
      // Golden Hour: the halo warms to gold and pulses; hearts and glints rise round the farmer (ambient particles)
      const onlineHere = a.online || a.self;
      if (gk > 0 && onlineHere) {
        a.halo.material.color.set(a.color).lerp(gold, 0.65 * gk);
        a.halo.material.opacity = 0.35 + 0.25 * gk * (motion === 'full' ? 0.75 + 0.25 * Math.sin(clock * 3) : 1);
        a.halo.scale.setScalar(1 + 0.35 * gk);
        if (fx && motion !== 'still' && clock >= (a.moteAt || 0)) {
          a.moteAt = clock + 0.32;
          const ang = Math.random() * Math.PI * 2; const rr = 0.35 + Math.random() * 0.45;
          fx.burst(Math.random() < 0.6 ? 'heart' : 'glow', new THREE.Vector3(tx + Math.cos(ang) * rr, 0.4 + Math.random() * 0.8, tz + Math.sin(ang) * rr),
            { n: 1, colors: ['#FF7A9C', '#FFC83D', '#FFE27A'], speed: 0.12, up: 0.55, size: 0.16, sizeEnd: 0.1, grav: -0.04, life: 2.2, spin: 0.4, y: 0, spread: 0, alpha: 0.85, ambient: true });
        }
        want = Math.max(want, 1);
      } else if (a.goldWas) { a.halo.material.color.set(a.color); a.halo.material.opacity = 0.35; a.halo.scale.setScalar(1); }
      a.goldWas = gk > 0;
      if (!!a.riding !== !!a.shadowRide) { a.shadowRide = !!a.riding; a.shadow.scale.set(a.riding ? 1.15 : 1, 1, a.riding ? 1.9 : 1); }
      if (a.rig) {
        const g = sk > 0 || a.riding ? { clip: 'IdleNeutral', scale: 0.6 } : gaitFor(a.speed);
        playBase(a, g.clip, g.scale);
        if (a.pending) {
          const d = Math.hypot(a.pending.x + 0.5 - a.pose.x, a.pending.z + 0.5 - a.pose.z);
          if ((d < 2.2 && a.speed < 0.6) || clock > a.pending.until) {
            if (a.pending.tool) setTool(a, a.pending.tool);
            playOnce(a, 'Interact', { scale: 1.25 });
            a.pending = null;
          }
        }
        if (a.rig.overlay && clock > a.rig.overlayEnd) { a.rig.overlay.fadeOut(0.18); a.rig.overlay = null; a.faceTo = undefined; }
        a.rig.mixer.update(motion === 'still' ? 0 : dt);
        sitPose(a, sk, seat);
        if (a.riding) want = Math.max(want, ridePose(a, dt));
        if (a.fish) want = Math.max(want, fishPose(a, dt));
        placeCrown(a, !!crown && crown.pids.has(a.pid) && t < crown.until && (a.online || a.self));
        if (sk === 0 && !a.seat) a.lastSeat = null;
        // still: frames only while a farmer actually moves (performance-08)
        // the partner walking travels at the ambient rate, my own farmer (the camera follows, my input) at 60 fps (CL-03)
        want = Math.max(want, a.speed > 0.05 || a.rig.overlay ? (a.self ? 2 : WANT.MOVING) : motion === 'still' ? 0 : 1);
      }
      // partner cursor ring: eases toward the presence cursor (~8/s), pulses at 120 BPM while resting
      if (!a.self && a.online && a.cursor) {
        const cx = a.cursor.x * TILE_M; const cz = a.cursor.z * TILE_M;
        if (!a.cursorShown) a.cursorShown = { x: cx, z: cz };
        const k = Math.min(1, dt * 8);
        const dx = cx - a.cursorShown.x; const dz = cz - a.cursorShown.z;
        a.cursorShown.x += dx * k; a.cursorShown.z += dz * k;
        a.cursorStill = Math.hypot(dx, dz) < 0.05 ? a.cursorStill + dt : 0;
        const pulse = a.cursorStill > 0.4 && motion === 'full' ? 1 + 0.12 * Math.max(0, Math.sin(clock * Math.PI * 4)) : 1;
        a.ring.visible = true;
        a.ring.position.set(a.cursorShown.x, 0.06, a.cursorShown.z);
        a.ring.scale.setScalar(pulse);
        want = Math.max(want, 1);
      } else a.ring.visible = false;
      // DOM: nameplate and emote bubble just above the head (visual-26), scaled with the zoom; a transform is
      // written only when it changed (no style recalculation per frame at rest: performance-17)
      const visible = a.root.visible;
      const px = tx / TILE_M; const pz = tz / TILE_M;
      // the plate sits 10 px above the measured head top (hat or hair: VISUAL-AFTER C5), higher on horseback
      const sitDy = a.rig ? sk * ((seat && seat.y ? seat.y : SEAT_HIPS.sunset_bench) - (a.rig.hipsY || 0.95)) : -sk * 0.5;
      const headY = (a.rig ? a.rig.topY : 2.0) + sitDy + (a.riding ? RIDE.saddle - (a.rig ? a.rig.hipsY * 0.55 : 0.5) : 0);
      const s = visible ? toScreen(px, pz, headY) : null;
      if (s && s.visible) {
        const feet = toScreen(px, pz, 0);
        const k = Math.min(1.3, Math.max(0.72, Math.abs(feet.y - s.y) / 70));
        const tf = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y - 10)}px, 0) translate(-50%, -100%) scale(${k.toFixed(2)})`;
        if (tf !== a.plateT) { a.plate.style.transform = tf; a.plateT = tf; }
        if (a.plate.style.visibility !== 'visible') a.plate.style.visibility = 'visible';
      } else if (a.plate.style.visibility !== 'hidden') a.plate.style.visibility = 'hidden';
      if (a.bubble.style.display !== 'none') {
        if (clock > a.bubbleUntil || !s || !s.visible) a.bubble.style.display = clock > a.bubbleUntil ? 'none' : a.bubble.style.display;
        if (s && s.visible) {
          const tf = `translate3d(${Math.round(s.x + 10)}px, ${Math.round(s.y - 30)}px, 0) translate(-50%, -100%)`;
          if (tf !== a.bubbleT) { a.bubble.style.transform = tf; a.bubbleT = tf; }
        }
        want = Math.max(want, 1);
      }
    }
    for (const p of pets.values()) want = Math.max(want, updatePet(p, dt, t));
    // pings: bounce at 120 BPM, fade out; off-screen pings get an arrow on the screen edge
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i];
      const age = clock - p.t0;
      if (age > p.life) { p.g.removeFromParent(); p.arrow.remove(); p.mat.dispose(); p.ring.material.dispose(); pings.splice(i, 1); continue; }
      const bounce = Math.abs(Math.sin(age * Math.PI * 2)) * 0.6 * (1 - age / p.life);
      p.g.children[0].position.y = bounce; p.g.children[1].position.y = bounce;
      const fade = age > p.life - 0.5 ? (p.life - age) / 0.5 : 1;
      p.mat.opacity = 0.95 * fade;
      p.ring.material.opacity = 0.8 * fade * (1 - ((age * 2) % 1));
      p.ring.scale.setScalar(1 + ((age * 2) % 1) * 1.5);
      const s = toScreen(p.x + 0.5, p.z + 0.5, 1.2);
      if (!s.visible && typeof innerWidth === 'number') {
        const cx = innerWidth / 2; const cy = innerHeight / 2;
        const ang = Math.atan2(s.y - cy, s.x - cx);
        const ex = cx + Math.cos(ang) * (cx - 40); const ey = cy + Math.sin(ang) * (cy - 40);
        p.arrow.style.display = 'block';
        p.arrow.style.transform = `translate3d(${Math.round(ex)}px, ${Math.round(ey)}px, 0) translate(-50%, -50%) rotate(${ang + Math.PI / 2}rad)`;
        p.arrow.style.opacity = String(fade);
      } else p.arrow.style.display = 'none';
      want = 2;
    }
    return want;
  }

  return {
    setNow(fn) { now = fn; },
    setFx(f) { fx = f; },
    /** The sky (wave 4, render/index.js): pets sleep from late dusk to dawn. `sky` = { phase, k } (daynight.js). */
    setNight(night, sky = null) { petNight = sky && sky.phase ? petsAsleep(sky.phase, sky.k, petNight) : night > 0.6; },
    /** Is `pid`'s pet asleep now (tooltips, tests)? */
    petAsleep(pid) { const p = pets.get(pid); return Boolean(p && (p.asleep || p.lying)); },
    setMotion(m) { motion = m === 'still' || m === 'reduced' ? m : 'full'; },
    setSeats(bench, state) {
      lastState = state || lastState;
      const cr = state && state.farm && state.farm.duel && state.farm.duel.crown;
      crown = cr && Array.isArray(cr.pids) && Number.isFinite(cr.until) ? { pids: new Set(cr.pids), until: cr.until } : null;
      petHomes = findPetHomes(state);
      const g = state && state.farm && state.farm.coop && state.farm.coop.golden;
      golden = g && typeof g === 'object' ? { from: g.from ?? g.at, until: g.until ?? g.endsAt } : null;
      for (const a of av.values()) {
        const seat = seatOf(bench, a.pid, state);
        if (seat) { a.seat = seat; a.lastSeat = seat; a.seatFromFish = false; } else if (!a.seatFromFish) a.seat = null;
      }
    },
    warmup() {
      const out = [];
      // a plain (not instanced, not batched) mesh with the shared look: held tools and static clones use it
      for (const name of ['standard', 'foliage']) { const m = new THREE.Mesh(bodyGeo, models.material(name)); m.visible = false; layers.ui3d.add(m); out.push(m); }
      for (const m of [new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', map: haloTex, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })),
        new THREE.Mesh(pinGeo[0], new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false }))]) {
        m.visible = false; layers.ui3d.add(m); out.push(m);
      }
      return out;
    },
    setTargetLocator(fn) { locateTarget = typeof fn === 'function' ? fn : () => null; },
    /** Players from the state (names, colours, bodies) and which one is me. */
    setPlayers(players, me) {
      if (me !== undefined) myPid = me;
      for (const [pid, p] of Object.entries(players)) {
        const a = ensure(pid, p.color, p.name, bodyFor(pid, p));
        a.self = pid === myPid;
        a.player = p;
        dressLook(a);
        if (!a.pose) placeRoot(a, { ...(START.spawn[pid] || START.spawn.p1), f: 0, a: 0 });
      }
      syncPets(players);
    },
    setOnline(pid, online) {
      const a = av.get(pid);
      if (!a) return;
      if (online && !a.online && a.pose && fx) fx.play({ e: 'joined', pid }, new THREE.Vector3(a.pose.x * TILE_M, 0, a.pose.z * TILE_M));
      a.online = online;
      a.root.visible = online || a.self;
      if (!online) {
        a.ring.visible = false; a.ghost.hide(); a.plate.style.visibility = 'hidden';
        // a leaver gets off the horse here too, and a stale 'horse' row cannot re-mount them on return (QA2 CL-01)
        if (!a.self) { if (a.riding) setRiding(a, false); a.buf.clear(); }
      }
    },
    me(pose) {
      const a = myPid && av.get(myPid);
      if (!a) return;
      placeRoot(a, { x: pose.x, z: pose.z, f: pose.f, a: pose.a });
      // the client's avatar carries `ride` (V, the Hand on a horse): the farmer mounts / gets off
      if (typeof pose.ride === 'boolean' && pose.ride !== !!a.riding) setRiding(a, pose.ride);
    },
    /** Presence rows [pid, x, z, f, a, cx, cz, rts, tool, hop]: interpolated on each row's own time; hop snaps. */
    presence(list, ts) {
      for (const [pid, x, z, f, an, cx, cz, rts, tool, hop] of list) {
        if (pid === myPid) continue;
        const a = av.get(pid);
        if (!a) continue;
        if (hop) {
          a.buf.clear();
          if (fx && a.pose) fx.play({ e: 'joined', pid }, new THREE.Vector3(a.pose.x * TILE_M, 0, a.pose.z * TILE_M));
          if (fx) fx.play({ e: 'joined', pid }, new THREE.Vector3(x * TILE_M, 0, z * TILE_M));
        }
        a.buf.push(rts ?? ts, x, z, f, an, cx, cz, tool ?? null);
      }
    },
    ghost(pid, g) {
      const a = av.get(pid);
      if (!a || pid === myPid) return;
      if (!g) { a.ghost.hide(); return; }
      a.ghost.show(g.def, g.rot);
      a.ghost.update({ x: g.x, z: g.z }, true, null, a.color);
    },
    poseOf(pid) { return av.get(pid)?.pose ?? null; },
    screenPosOf(pid) {
      const a = av.get(pid);
      if (!a || !a.pose || !a.root.visible) return null;
      const s = toScreen(a.pose.x, a.pose.z, 1.3);
      return s.visible ? { x: s.x, y: s.y } : null;
    },
    act,
    onEvent(ev, meta = {}) {
      if (ev && PET_EVENTS.has(ev.e)) { petEvent(ev); return; }
      // a new look: a sparkle round the farmer (the look itself arrives with the players topic: dressLook)
      if (ev && ev.e === 'avatarChanged') {
        const a = av.get(ev.pid);
        if (a && a.root.visible && fx) fx.play(ev, new THREE.Vector3(a.root.position.x, 0, a.root.position.z));
        return;
      }
      if (ev && (FISH_EVENTS.cast.has(ev.e) || FISH_EVENTS.bite.has(ev.e) || FISH_EVENTS.catch.has(ev.e) || FISH_EVENTS.stop.has(ev.e))) {
        const pid = ev.pid ?? meta.by ?? ev.by;
        const a = pid && av.get(pid);
        if (!a) return;
        if (FISH_EVENTS.cast.has(ev.e)) fishStart(a, ev);
        else if (FISH_EVENTS.bite.has(ev.e)) { if (a.fish && a.fish.phase === 'wait') { a.fish.phase = 'bite'; a.fish.t = clock; } }
        else if (FISH_EVENTS.catch.has(ev.e)) {
          if (!a.fish) fishStart(a, ev);
          // the catch: { fish, cm, record? } (rules-economy's names; `species` / `size` are read too)
          a.fish.catch = { fish: ev.fish ?? ev.species ?? null, cm: ev.cm ?? ev.size ?? null, record: !!(ev.record || ev.weekBest) };
          a.fish.phase = 'reel'; a.fish.t = clock; a.fish.until = clock + 30;
        } else fishEnd(a);
        return;
      }
      if (!ev || !Object.hasOwn(EVENT_TOOL, ev.e)) return;
      const pid = meta.by ?? ev.by;
      if (!pid) return;
      const tile = ev.x !== undefined && ev.z !== undefined ? { x: ev.x, z: ev.z } : (ev.id ? locateTarget(ev.id) : null);
      if (!tile) return;
      act(pid, { x: tile.x, z: tile.z, tool: EVENT_TOOL[ev.e] });
    },
    emote,
    ping,
    highFive,
    update,
    ride(pid, on) { const a = av.get(pid); if (a && !!on !== !!a.riding) setRiding(a, on); },
    /** Drive the fishing pose (wave 3): phase 'cast' (opts { id?: a dock, x?, z?: the tile to cast to }) | 'bite' |
     *  'reel' (opts { fish, cm, record }) | 'stop'. The rules' events do the same through onEvent. */
    fish(pid, phase, opts = {}) {
      const a = av.get(pid);
      if (!a) return;
      if (phase === 'cast') fishStart(a, opts);
      else if (phase === 'bite' && a.fish) { a.fish.phase = 'bite'; a.fish.t = clock; }
      else if (phase === 'reel') { if (!a.fish) fishStart(a, opts); a.fish.catch = { fish: opts.fish ?? null, cm: opts.cm ?? null, record: !!opts.record }; a.fish.phase = 'reel'; a.fish.t = clock; }
      else fishEnd(a);
    },
    isFishing(pid) { return !!av.get(pid)?.fish; },
    isRiding(pid) { return !!av.get(pid)?.riding; },
    /** Where `pid`'s pet is (tiles) and what it is, or null (tooltips, tests). */
    petOf(pid) { const p = pets.get(pid); return p && p.placed ? { kind: p.kind, name: p.name, x: p.x / TILE_M, z: p.z / TILE_M } : null; },
  };
}
