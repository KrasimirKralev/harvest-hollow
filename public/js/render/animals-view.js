// Animals on the farm (GDD §3.4 rules 4-10, §7.2, §8.6; tech §10.6): every animal lives inside its home's
// yard and wanders there deterministically (both screens show the same cow at the same spot with zero
// traffic), shows its needs on the model (hungry thought cloud, product bubble bobbing at 120 BPM, eating,
// happy jig, sleepy at night), babies are small with big heads, petting leans in with hearts. At most 8
// skinned animals near the camera; the rest are rigid instanced meshes with procedural bob/waddle/peck.
// Owned by the render-life lane.
//
// createAnimalsView(layers, overlay, toScreenM, { now? }) -> animals
//   animals.setNow(fn)                         server clock (ms); wander and timers use it
//   animals.setState(state) / animals.sync(ids, topics, state)   like objects-view: rebuild / re-read ids
//   animals.update(dt) -> 0|1|2                per frame (dt seconds)
//   animals.setFocus(x, z, dist)               camera target (metres) and distance: skinned budget and LOD
//   animals.positionOf(id) -> THREE.Vector3 | null   current position (metres; fx and picking)
//   animals.pickables() -> [{ id, x, z, r, h, pet? }]  cheap picking proxies (metres); the farmers' pets follow
//                                              as { id: 'pet:<owner>', pet: <owner> } (PET_PICKS, avatars-view)
//   animals.onEvent(ev, meta)                  fed / tended / collected / petted / placed / bought: animation
//   animals.pet(id)                            lean into the hand + hearts (also from onEvent 'petted')
//   animals.setFx(fx) / setMotion(mode) / setNight(0..1) / stats() -> { animals, skinned, rigid }
//   animals.needs() -> number                  hungry + product-ready animals (the calm board, RD-40)
//   animals.setSkinnedMax(n)                   mobile wave: the skinned budget (phones keep fewer; default SKINNED_MAX)
// State language (visual-08): hungry = an amber thought cloud with a trough, ready = a white bubble with the
// product and a green check, working = a small progress ring; all three keep their size on screen (32 / 40 /
// 20 px). Hens are chunkier and come in chestnut, buff and cream (by id); sheep walk instead of hopping.
// Wave 2 (M1b) behaviours, all deterministic in (id, server time) like the wander, all cosmetic:
//   ducks swim: most wander segments end in the pond (manifest `water` of home:duck_pond), afloat with a gentle bob
//     and a ripple trail; on land they waddle
//   pigs root: idle pigs push their snouts into the ground with little dirt puffs; one in the mud wallows
//   goats climb: some segments end on a perch (the boulder, the platform: manifest `perches`) and they stand on top
//   bees swarm: a colony is a cloud of bees looping round its hive and flying out to the forage within 4 tiles
//     (decor with effect.forage, flower crops, flowering trees); none fly at night or in the rain
//   horses: walk, graze and stand; a farmer who rides (avatars-view ride()) takes one horse out of the stable
//   every pen keeps its animals 1.2 body widths apart and clear of the trough and the ramp (manifest `avoid`)
//   animals.setWeather(rain 0..1)            bees stay in when it rains
// The animal object shape it reads (rules lane; every field optional except def and home):
//   { def, home, bornAt?, adultAt?, fedAt?: null|t, readyAt?: null|t, ribbon?|prized?, name? }
//   baby  = now < adultAt (or now < bornAt + def.babyMs); hungry = adult with no cycle running (readyAt null);
//   ready = readyAt <= now (the product waits on the animal); eating = within 1.6 s after fedAt.
import * as THREE from 'three';
import { TILE_M } from '../../../shared/content/config.js';
import { defOf, cropOf, BREEDING, featureOf, isLive } from '../../../shared/content/index.js';
import { models, wrapLighting, addShaderPatch } from './models.js';
import { iconUrl } from './icons.js';
import { homeTier } from './objects-view.js';

export const SKINNED_MAX = 8;
export const WANDER_MS = 6000;
/** Chunkier farm animals, so they read beside roofs (visual-09); hens 11 % smaller than wave 1 so a full coop does
 *  not crowd its own ramp (VISUAL-AFTER C2). */
export const SPECIES_SCALE = Object.freeze({ chicken: 1.24, duck: 1.25, sheep: 1.15, cow: 1.1, pig: 1.05, goat: 1.0, horse: 1.0 });
/** A baby's size against its grown-up: 0.6 of the adult model, except where the baby has a model of its own (the chick
 *  is modelled chick-sized: at 0.6 it was a speck by the trough; live requests 2026-10-04 "real yellow chicks"). */
export const BABY_SCALE = Object.freeze({ chicken: 0.9 });
export const babyScale = (def) => BABY_SCALE[def] ?? 0.6;
/** An adult skinned animal's head scale (RD-14: heads x1.15, the friendlier farm proportions). */
export const ADULT_HEAD = 1.15;
/** Three coats per species (RD-14, QA wave 2): colour multipliers over the model's own paint (the first is the model
 *  as built). A herd reads as individuals: chocolate and fawn cows, rosy and dusky pigs, oatmeal and grey sheep, tan
 *  and grey goats, bay and palomino horses. */
export const COATS = Object.freeze({
  cow: [[1, 1, 1], [0.78, 0.68, 0.6], [1.08, 1.0, 0.86]],
  pig: [[1, 1, 1], [1.04, 0.9, 0.9], [0.9, 0.84, 0.8]],
  sheep: [[1, 1, 1], [0.94, 0.9, 0.84], [0.78, 0.76, 0.74]],
  goat: [[1, 1, 1], [0.96, 0.84, 0.7], [0.82, 0.8, 0.78]],
  horse: [[1, 1, 1], [0.72, 0.62, 0.56], [1.14, 1.0, 0.8]],
});
/** The coat of an animal (deterministic per id): a multiplier [r, g, b]. */
export function coatOf(def, id) {
  const list = COATS[def];
  return list ? list[hash32(id, 'coat') % list.length] : COATS.cow[0];
}

// ---- Bred coats (wave 3, GDD §3.4 Breeding Barn): a bred baby carries `coat` (BREEDING.coats: white 40 % / brown 30 % /
// spotted 25 % / golden 5 %; the Seasonal Track's season coats: BREEDING.seasonCoats). The models carry a coat mask
// (`_coat`: the fleece or hide vs the muzzle, hooves, horns, eyes and mane; the patches a spotted coat paints; the
// lightness), and a coat recolours exactly the coat vertices keeping their shading. Animals without a coat (bought
// ones) keep their look and the three individual tints above. mode 1 solid, 2 spotted, 3 golden (gold with a lighter
// shimmer on the spot mask, and a glint now and then).
/** Per coat: the mode and, per species (`_` = any other), [base, spot] in sRGB hex. */
export const COAT_PALETTE = Object.freeze({
  white: { mode: 1, _: ['#F4F0E7'], cow: ['#F7F3EC'], pig: ['#F8E2DC'], horse: ['#EEE9E1'], sheep: ['#FBF8F1'], goat: ['#F8F5EE'], alpaca: ['#FBF6EC'],
    chicken: ['#FBF6EC'], duck: ['#FFFFFF'] },
  brown: { mode: 1, _: ['#8E5A3A'], cow: ['#7E4A2C'], pig: ['#B4683E'], horse: ['#7A4526'], sheep: ['#7E5C44'], goat: ['#8C5C3A'], alpaca: ['#A8764C'],
    chicken: ['#9A5B34'], duck: ['#8C6A48'] },
  spotted: { mode: 2, _: ['#F5F1E8', '#5A4636'], cow: ['#F9F6F0', '#2B2727'], pig: ['#F4DCD4', '#3A3030'], horse: ['#F2EEE6', '#6E4630'], sheep: ['#FBF8F1', '#4A3A34'],
    goat: ['#F8F5EE', '#7A5636'], alpaca: ['#FBF6EC', '#8A5636'], chicken: ['#F4EEE4', '#6A5E58'], duck: ['#FFFFFF', '#7E6A54'] },
  golden: { mode: 3, _: ['#E2AE3E', '#FFE29A'] },
});
/** The season coats' spot colour (their base is BREEDING.seasonCoats[].hue): blossom and frost dapple white. */
const SEASON_SPOT = Object.freeze({ blossom: '#FFFFFF', sunkissed: '#FFE7A8', russet: '#7A3418', frost: '#FFFFFF' });
const SEASON_HUE = Object.freeze({ blossom: '#F4B6C8', sunkissed: '#F2C46B', russet: '#B5562E', frost: '#DDE8F2' });
/** The coat id an animal object carries (`coat: 'golden'` or `coat: { id }`), or null (a bought animal). */
export function coatId(o) {
  const c = o && o.coat;
  if (typeof c === 'string' && c) return c;
  if (c && typeof c === 'object' && typeof c.id === 'string') return c.id;
  return null;
}
const lin3 = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
/** The colours of a coat on a species: { mode, a: linear [r, g, b], b: linear [r, g, b] } or null (no coat). Pure. */
export function coatColors(def, id) {
  if (!id) return null;
  const pal = Object.hasOwn(COAT_PALETTE, id) ? COAT_PALETTE[id] : null;
  if (pal) {
    const [a, b] = (Object.hasOwn(pal, def) ? pal[def] : null) || pal._;
    return { mode: pal.mode, a: lin3(a), b: lin3(b || a) };
  }
  const season = (BREEDING && Array.isArray(BREEDING.seasonCoats) ? BREEDING.seasonCoats : []).find((c) => c.id === id);
  const hue = (season && season.hue) || (Object.hasOwn(SEASON_HUE, id) ? SEASON_HUE[id] : null);
  if (hue) return { mode: 2, a: lin3(hue), b: lin3(Object.hasOwn(SEASON_SPOT, id) ? SEASON_SPOT[id] : '#FFFFFF') };
  // an unknown coat (a later content addition): a stable tint from its id, solid
  const c = new THREE.Color().setHSL((hash32(id, 'hue') % 360) / 360, 0.45, 0.62, THREE.SRGBColorSpace);
  return { mode: 1, a: [c.r, c.g, c.b], b: [c.r, c.g, c.b] };
}
/** The GLSL shared by both coat patches: recolour a coat vertex to the coat keeping its lightness (k.z = lightness / 2). */
const COAT_GLSL = /* glsl */`
vec3 hhCoat( vec3 c, vec3 k, vec3 a, vec3 b, float m ) {
  if ( m < 0.5 || k.x < 0.5 ) return c;
  vec3 t = ( m > 1.5 && k.y > 0.5 ) ? b : a;
  return t * clamp( k.z * 2.0, 0.5, 1.45 );
}`;
/** A skinned clone's material: the coat from uniforms { a, b, m } (THREE uniform objects). */
export function coatPatchUniform(material, u) {
  addShaderPatch(material, 'hh-coat', (shader) => {
    shader.uniforms.uCoatA = u.a; shader.uniforms.uCoatB = u.b; shader.uniforms.uCoatM = u.m;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 _coat;\nvarying vec3 vCoat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoat = _coat;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uCoatA;\nuniform vec3 uCoatB;\nuniform float uCoatM;\nvarying vec3 vCoat;\n${COAT_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = hhCoat( diffuseColor.rgb, vCoat, uCoatA, uCoatB, uCoatM );');
  }, 'u1');
  return material;
}
/** The rigid instanced animals' material: the coat per instance (attributes iCoatA, iCoatB, iCoatM). */
export function coatPatchInstanced(material) {
  addShaderPatch(material, 'hh-coat', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 _coat;\nattribute vec3 iCoatA;\nattribute vec3 iCoatB;\nattribute float iCoatM;\nvarying vec3 vCoat;\nvarying vec3 vCoatA;\nvarying vec3 vCoatB;\nvarying float vCoatM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoat = _coat; vCoatA = iCoatA; vCoatB = iCoatB; vCoatM = iCoatM;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCoat;\nvarying vec3 vCoatA;\nvarying vec3 vCoatB;\nvarying float vCoatM;\n${COAT_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = hhCoat( diffuseColor.rgb, vCoat, vCoatA, vCoatB, vCoatM );');
  }, 'i1');
  return material;
}

// ---- Babies with their own proportions (wave 3, RD-15: "piglets, kids and foals are scaled adults"): the rigid `:baby`
// keys are baked with these bone scales (tools/build-assets.mjs UAA_BABY / FA_BABY); a near, skinned baby gets the same
// bones on its adult clone, re-grounded, so near and far agree. The head is set per frame (after the clip pose).
const UAA_BABY_BONES = Object.freeze({ Head: 1.5, 'FrontUpperLeg.L': 0.82, 'FrontUpperLeg.R': 0.82, 'BackUpperLeg.L': 0.82, 'BackUpperLeg.R': 0.82, Neck1: 0.85 });
const FA_BABY_BONES = Object.freeze({ Head: 1.45, 'FrontUpLeg.L': 0.85, 'FrontUpLeg.R': 0.85, 'BackUpLeg.L': 0.85, 'BackUpLeg.R': 0.85 });
export const BABY_BONES = Object.freeze({ cow: UAA_BABY_BONES, horse: UAA_BABY_BONES, alpaca: UAA_BABY_BONES, goat: UAA_BABY_BONES, pig: FA_BABY_BONES, sheep: FA_BABY_BONES });

// ---- Nursery personalities (wave 3, GDD §3.4 Nursery: "Sleepy / Playful / Grumpy — the idle animation set"): which idle
// clips an animal picks, how fast it plays them, and what it does now and then. Pure data; `personalityOf(o)` reads the
// object's `pers` (rules-economy, breeding.js nursePick).
export const PERSONALITY = Object.freeze({
  sleepy: { idles: ['Graze', 'Idle', 'Graze'], scale: 0.6, rest: 0.45, hop: 0 },
  playful: { idles: ['Idle2', 'Idle', 'Jump'], scale: 1.25, rest: 0, hop: 0.3 },
  grumpy: { idles: ['Idle', 'Idle', 'React'], scale: 0.85, rest: 0, hop: 0 },
});
export function personalityOf(o) {
  // rules-economy keeps the Nursery's pick in `pers` (breeding.js); `personality` is read too
  const p = o && (o.pers ?? o.personality ?? (o.nursery && o.nursery.personality));
  return typeof p === 'string' && Object.hasOwn(PERSONALITY, p) ? p : null;
}
/** The horse show's events (rules-goals names; any of them starts the show trot) and how long a horse shows (s). */
export const HORSE_SHOW_EVENTS = new Set(['horseShow', 'horseShown', 'showEntered', 'horseShowEntered', 'horseShowRibbon']);
export const SHOW_S = 9;
/** Riders: pid -> true while that farmer is on horseback (avatars-view writes, this view hides that many horses). */
export const RIDERS = new Map();
/** Pets: owner pid -> { x, z, r, h } of the dog or cat that follows them (avatars-view writes each frame). They join
 *  `pickables()` as `{ id: 'pet:<pid>', pet: <pid>, ... }` so one ray test covers animals and pets. */
export const PET_PICKS = new Map();
/** Bees drawn per colony (more when the honey is ready) and their size multiplier so they read as dots. */
export const BEES = Object.freeze({ swarm: 6, ready: 9, foragers: 3, scale: 2.6 });
/** Hen colour variants (visual-22): chestnut v0, buff v1, cream v2, picked from the id exactly like the coop
 *  panel's portrait (ui/panels/animals.js animalTint: plain FNV-1a % 3), so "the cream hen" is the same hen in
 *  both places. Other species have one look. */
export function variantKey(defId, id, has = () => true) {
  if (defId !== 'chicken' || typeof id !== 'string') return null;
  let x = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { x ^= id.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  const k = `animal:chicken:v${x % 3}`;
  return has(k) ? k : null;
}
/** Screen size (px) of each need bubble (visual-08; RD-09: 35-40 % less area, the farm leads). */
export const BUBBLE_PX = Object.freeze({ hungry: 26, ready: 32, working: 17 });
/** From this camera distance (m) a pen shows one aggregated need bubble (RD-09). */
export const WIDE_DIST = 55;
/** World size (metres) for `px` pixels at camera distance `dist` (the badges' screen-stable rule). */
export const bubbleSize = (px, dist) => Math.min(3.2, Math.max(0.55, dist * 0.045)) * (px / 75);

// ---------------------------------------------------------------------------------------------------
// Pure helpers (exported for tests)

/** FNV-1a over the id and integer keys -> uint32 (deterministic on both screens). */
export function hash32(id, ...keys) {
  let h = 2166136261;
  const s = `${id}|${keys.join('|')}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return h >>> 0;
}
const unit = (h) => h / 4294967296;

/** Animal status from its object and the server time. */
export function animalStatus(o, now, def = null) {
  const babyMs = def && Number.isFinite(def.babyMs) ? def.babyMs : 0;
  let baby = false;
  if (Number.isFinite(o.adultAt)) baby = now < o.adultAt;
  else if (Number.isFinite(o.grownAt)) baby = now < o.grownAt;
  else if (typeof o.baby === 'boolean') baby = o.baby;
  else if (Number.isFinite(o.bornAt) && babyMs) baby = now < o.bornAt + babyMs;
  const hasCycle = o.readyAt !== null && o.readyAt !== undefined;
  const ready = hasCycle && now >= o.readyAt;
  const eatingFor = Number.isFinite(o.fedAt) ? now - o.fedAt : Infinity;
  return {
    baby,
    ready,
    hungry: !baby && !hasCycle,
    producing: hasCycle && now < o.readyAt,
    eating: eatingFor >= 0 && eatingFor < 1600,
    jig: eatingFor >= 1600 && eatingFor < 2200,
    ribbon: !!(o.ribbon || o.prized || o.blueRibbon),
  };
}

/** Rotate a model-space yard rect [x0, z0, x1, z1] by rot quarter turns. */
export function rotateRect([x0, z0, x1, z1], rot) {
  const pts = [[x0, z0], [x1, z1]].map(([x, z]) => {
    switch (((rot % 4) + 4) % 4) {
      case 1: return [z, -x];
      case 2: return [-x, -z];
      case 3: return [-z, x];
      default: return [x, z];
    }
  });
  return [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
}

/** Species whose body stays fully inside the rails (fitBody margin -0.1). */
const BIG_BODIES = new Set(['cow', 'horse', 'alpaca']);

/**
 * Keep a long body inside its yard (RD-19, QA wave 2: a horse's muzzle in the stable wall, its rump through the
 * fence): the yard rect bounds the animal's CENTRE, so a body of half-length L facing across a shallow yard pokes
 * out. Turn the facing to the nearest direction whose muzzle and rump stay within the rect + `margin`, and slide the
 * centre in along that axis. Pure: (x, z, face, L, [x0, z0, x1, z1], margin) -> { x, z, face }.
 */
export function fitBody(x, z, face, L, rect, margin = 0.25) {
  const [x0, z0, x1, z1] = rect;
  const room = (f) => (x1 - x0 + 2 * margin >= 2 * Math.abs(Math.sin(f)) * L - 1e-9) && (z1 - z0 + 2 * margin >= 2 * Math.abs(Math.cos(f)) * L - 1e-9);
  let f = face;
  // the yard is too shallow for this heading: turn along its long side (the nearest of the two directions)
  if (!room(f)) {
    const longX = x1 - x0 >= z1 - z0;
    const opts = longX ? [Math.PI / 2, -Math.PI / 2] : [0, Math.PI];
    const off = (c) => Math.abs(Math.atan2(Math.sin(c - face), Math.cos(c - face)));
    f = off(opts[0]) <= off(opts[1]) ? opts[0] : opts[1];
  }
  // then slide the centre in so the muzzle and the rump stay inside
  const ex = Math.abs(Math.sin(f)) * L; const ez = Math.abs(Math.cos(f)) * L;
  const nx = Math.min(x1 + margin - ex, Math.max(x0 - margin + ex, x));
  const nz = Math.min(z1 + margin - ez, Math.max(z0 - margin + ez, z));
  return { x: nx, z: nz, face: f };
}

/** Home spots for n occupants: an even grid over the yard (metres, world), stable for a given n. */
export function yardSpots(rect, n) {
  const [x0, z0, x1, z1] = rect;
  const w = Math.max(0.1, x1 - x0); const d = Math.max(0.1, z1 - z0);
  const cols = Math.max(1, Math.round(Math.sqrt((n * w) / d)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols; const r = Math.floor(i / cols);
    out.push({ x: x0 + ((c + 0.5) / cols) * w, z: z0 + ((r + 0.5) / rows) * d });
  }
  return out;
}

/** Deterministic wander target for segment k: within `radius` of the spot, clamped into the yard. */
export function wanderPoint(id, k, spot, rect, radius) {
  const h = hash32(id, k);
  if (unit(hash32(id, k, 'stay')) < 0.32) return { x: spot.x, z: spot.z, stay: true };
  const a = unit(h) * Math.PI * 2;
  const r = Math.sqrt(unit(hash32(id, k, 'r'))) * radius;
  const [x0, z0, x1, z1] = rect;
  return { x: Math.min(x1 - 0.3, Math.max(x0 + 0.3, spot.x + Math.cos(a) * r)), z: Math.min(z1 - 0.3, Math.max(z0 + 0.3, spot.z + Math.sin(a) * r)), stay: false };
}

/** Where an animal is at server time t (ms): eased walks between segment targets, then idling. */
export function wanderPose(id, t, spot, rect, { radius = 2.5, speed = 0.6 } = {}) {
  const k = Math.floor(t / WANDER_MS);
  const a = wanderPoint(id, k - 1, spot, rect, radius);
  const b = wanderPoint(id, k, spot, rect, radius);
  const into = (t - k * WANDER_MS) / 1000;
  const delay = unit(hash32(id, k, 'd')) * 0.8;
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const dur = Math.min(4.5, Math.max(0.6, dist / speed));
  const p = Math.min(1, Math.max(0, (into - delay) / dur));
  const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;      // ease in-out
  const walking = p > 0 && p < 1 && dist > 0.05;
  const face = dist > 0.05 ? Math.atan2(b.x - a.x, b.z - a.z) : (unit(hash32(id, k, 'f')) * 2 - 1) * Math.PI;
  return { x: a.x + (b.x - a.x) * e, z: a.z + (b.z - a.z) * e, walking, face, speed: walking ? dist / dur : 0, phase: into, seg: k, since: into - delay - dur };
}

/** A pose along segment targets from `targetAt(k)` (wanderPose's walk, any target rule: ponds, perches). Pure. */
export function pathPose(id, t, targetAt, { speed = 0.6, maxDur = 4.5 } = {}) {
  const k = Math.floor(t / WANDER_MS);
  const a = targetAt(k - 1); const b = targetAt(k);
  const into = (t - k * WANDER_MS) / 1000;
  const delay = unit(hash32(id, k, 'd')) * 0.8;
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const dur = Math.min(maxDur, Math.max(0.6, dist / speed));
  const p = Math.min(1, Math.max(0, (into - delay) / dur));
  const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
  const walking = p > 0 && p < 1 && dist > 0.05;
  const face = dist > 0.05 ? Math.atan2(b.x - a.x, b.z - a.z) : (unit(hash32(id, k, 'f')) * 2 - 1) * Math.PI;
  return { x: a.x + (b.x - a.x) * e, z: a.z + (b.z - a.z) * e, walking, face, speed: walking ? dist / dur : 0, phase: into, seg: k, since: into - delay - dur };
}

/** A point inside a disc for segment k (deterministic). */
function discPoint(id, k, salt, cx, cz, r) {
  const a = unit(hash32(id, k, salt, 'a')) * Math.PI * 2;
  const d = Math.sqrt(unit(hash32(id, k, salt, 'r'))) * r;
  return { x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d };
}

/**
 * Where a duck is at time t: like wanderPose, but about seven segments in ten end in the pond (world disc
 * `water` = { x, z, r }), the rest on the bank. `swim` is true while the duck is over the water. Pure.
 */
export function pondPose(id, t, spot, rect, water, { speed = 0.45 } = {}) {
  const target = (k) => {
    if (unit(hash32(id, k, 'pond')) < 0.72) return discPoint(id, k, 'w', water.x, water.z, water.r * 0.72);
    for (let tries = 0; tries < 4; tries++) {
      const p = wanderPoint(id, k * 7 + tries, spot, rect, 2.2);
      if (Math.hypot(p.x - water.x, p.z - water.z) > water.r * 1.08) return p;
    }
    return { x: spot.x, z: spot.z };
  };
  const p = pathPose(id, t, target, { speed, maxDur: 5.5 });
  p.swim = Math.hypot(p.x - water.x, p.z - water.z) < water.r * 0.95;
  return p;
}

/** A goat's pose: about three segments in ten end on a perch (the boulder, the platform). Pure. */
export function climbPose(id, t, spot, rect, perches, { radius = 2.5, speed = 0.6 } = {}) {
  const target = (k) => {
    if (perches.length && unit(hash32(id, k, 'perch')) < 0.3) {
      const q = perches[hash32(id, k, 'which') % perches.length];
      return discPoint(id, k, 'pc', q.x, q.z, q.r * 0.45);
    }
    return wanderPoint(id, k, spot, rect, radius);
  };
  return pathPose(id, t, target, { speed });
}

/**
 * An alpaca's pose (wave 3): like wanderPose, but about one segment in five ends in the paddock's dust patch (world disc
 * `dust` = { x, z, r }), where it lies down and rolls (`bathe`), and one in five on the knoll (perches). Pure.
 */
export function dustPose(id, t, spot, rect, dust, perches, { radius = 2.5, speed = 0.6 } = {}) {
  const target = (k) => {
    const u = unit(hash32(id, k, 'dust'));
    if (dust && u < 0.2) return discPoint(id, k, 'd', dust.x, dust.z, dust.r * 0.5);
    if (perches && perches.length && u > 0.8) { const q = perches[hash32(id, k, 'which') % perches.length]; return discPoint(id, k, 'pc', q.x, q.z, q.r * 0.4); }
    return wanderPoint(id, k, spot, rect, radius);
  };
  const p = pathPose(id, t, target, { speed });
  p.inDust = !!dust && Math.hypot(p.x - dust.x, p.z - dust.z) < dust.r * 0.85;
  return p;
}
/** A horse at the show (wave 3, the Fair horse show): trotting laps of an oval (centre, rx, rz) from time t0 (s). Pure. */
export function trotPose(t, t0, { x, z, rx, rz, speed = 2.2 }) {
  const per = (Math.PI * (rx + rz)) / speed;                         // seconds a lap (Ramanujan-ish perimeter)
  const a = ((t - t0) / per) * Math.PI * 2;
  const px = x + Math.sin(a) * rx; const pz = z + Math.cos(a) * rz;
  const face = Math.atan2(Math.cos(a) * rx, -Math.sin(a) * rz);       // along the tangent
  return { x: px, z: pz, walking: true, face, speed, phase: t - t0, seg: -2, since: 0, trot: true };
}
/** Whether an idle animal lies down this segment (an alpaca cushes now and then; a sleepy one often). Pure. */
export function cushes(def, id, seg, personality = null) {
  const k = personality === 'sleepy' ? 0.45 : def === 'alpaca' ? 0.18 : 0;
  return k > 0 && unit(hash32(id, seg, 'cush')) < k;
}

/** The height a goat stands at on a perch ([{ x, z, r, y }] world), rising over the perch's rim. Pure. */
export function perchY(x, z, perches) {
  let y = 0;
  for (const q of perches || []) {
    const d = Math.hypot(x - q.x, z - q.z);
    const k = Math.min(1, Math.max(0, (q.r * 1.15 - d) / (q.r * 0.4)));
    y = Math.max(y, q.y * k * k * (3 - 2 * k));
  }
  return y;
}

/**
 * Push the animals of one pen apart (min distance = the sum of their radii) and out of the avoid circles, a few
 * relaxation passes; stateless (recomputed from the wander poses every frame), so both screens agree. Pure:
 * mutates the x/z of `list` ([{ x, z, r }]) and returns it.
 */
export function separate(list, avoid = [], rect = null, passes = 3) {
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i]; const b = list[j];
      const dx = b.x - a.x; const dz = b.z - a.z;
      const d = Math.hypot(dx, dz); const min = a.r + b.r;
      if (d >= min) continue;
      const push = (min - d) / 2 + 1e-4;
      const ux = d > 1e-6 ? dx / d : Math.cos(i * 2.4 + j); const uz = d > 1e-6 ? dz / d : Math.sin(i * 2.4 + j);
      a.x -= ux * push; a.z -= uz * push; b.x += ux * push; b.z += uz * push;
    }
    for (const a of list) for (const c of avoid) {
      if (a.free) continue;                                  // a goat climbing onto the thing the others walk round
      const dx = a.x - c.x; const dz = a.z - c.z; const d = Math.hypot(dx, dz); const min = c.r + a.r * 0.6;
      if (d >= min) continue;
      const ux = d > 1e-6 ? dx / d : 0; const uz = d > 1e-6 ? dz / d : 1;
      a.x = c.x + ux * min; a.z = c.z + uz * min;
    }
    if (rect) for (const a of list) { a.x = Math.min(rect[2] - 0.25, Math.max(rect[0] + 0.25, a.x)); a.z = Math.min(rect[3] - 0.25, Math.max(rect[1] + 0.25, a.z)); }
  }
  return list;
}

/** One bee of a colony at time t (seconds): orbiting bees loop round the hive, foragers shuttle to a flower. Pure. */
export function beePose(hive, j, t, { forage = null, forager = false, seed = 0 } = {}) {
  const h = (k) => unit(hash32(`bee${seed}`, j, k));
  if (forager && forage) {
    const period = 6 + h('p') * 4;
    const ph = ((t / period) + h('o')) % 1;
    const k = ph < 0.5 ? ph * 2 : (1 - ph) * 2;                 // out and back
    const e = k * k * (3 - 2 * k);
    const wob = Math.sin(t * 7 + j) * 0.12;
    return { x: hive.x + (forage.x - hive.x) * e + wob, y: hive.y + 0.35 + Math.sin(e * Math.PI) * 1.1, z: hive.z + (forage.z - hive.z) * e + Math.cos(t * 6 + j) * 0.12,
      face: Math.atan2(forage.x - hive.x, forage.z - hive.z) + (ph < 0.5 ? 0 : Math.PI) };
  }
  const r = 0.35 + h('r') * 0.6; const w = (1.3 + h('w') * 1.4) * (h('s') < 0.5 ? 1 : -1); const a = t * w + h('a') * 6.28;
  return { x: hive.x + Math.cos(a) * r + Math.sin(t * 1.7 + j) * 0.08, y: hive.y + 0.15 + h('y') * 0.6 + Math.sin(t * 2.3 + j * 1.3) * 0.12,
    z: hive.z + Math.sin(a) * r * 0.85, face: a + (w > 0 ? Math.PI / 2 : -Math.PI / 2) };
}

// ---------------------------------------------------------------------------------------------------
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(40,28,14,0.45)'); gr.addColorStop(0.6, 'rgba(40,28,14,0.2)'); gr.addColorStop(1, 'rgba(40,28,14,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A bubble texture (visual-08): an amber thought cloud with a trough (hungry), or a white bubble with the
 *  product and a small green check (ready). */
function bubbleTexture(icon, kind) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (img) => {
    g.clearRect(0, 0, 128, 128);
    if (kind === 'hungry') {
      g.fillStyle = '#FFE7B0'; g.strokeStyle = '#C98A2B'; g.lineWidth = 6;
      g.beginPath();
      for (const [x, y, r] of [[64, 52, 38], [32, 60, 24], [96, 60, 24], [46, 32, 22], [82, 32, 22]]) { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); }
      g.fill(); g.stroke();
      g.beginPath(); g.arc(64, 52, 35, 0, Math.PI * 2); g.fill();
      for (const [x, y, r] of [[44, 100, 9], [32, 117, 5]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke(); }
      // the trough with grain
      g.fillStyle = '#8A5A35'; g.strokeStyle = '#5A3418'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(36, 50); g.lineTo(92, 50); g.lineTo(84, 74); g.lineTo(44, 74); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#F2C94C';
      g.beginPath(); g.ellipse(64, 50, 26, 7, 0, Math.PI, 0); g.fill();
      g.fillStyle = '#5A3418'; g.fillRect(40, 72, 5, 10); g.fillRect(83, 72, 5, 10);
    } else {
      g.fillStyle = '#FFFFFF'; g.strokeStyle = '#7A4B2C'; g.lineWidth = 6;
      g.beginPath(); g.arc(64, 56, 46, 0, Math.PI * 2); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(52, 98); g.lineTo(64, 122); g.lineTo(76, 98); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.arc(64, 56, 43, 0, Math.PI * 2); g.fill();
      if (img) g.drawImage(img, 28, 20, 72, 72);
      // the green check: "ready to collect"
      g.fillStyle = '#3FAE4A'; g.strokeStyle = '#FFFFFF'; g.lineWidth = 4;
      g.beginPath(); g.arc(100, 24, 17, 0, Math.PI * 2); g.fill(); g.stroke();
      g.strokeStyle = '#FFFFFF'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(92, 24); g.lineTo(98, 30); g.lineTo(109, 17); g.stroke();
    }
    tex.needsUpdate = true;
  };
  draw(null);
  if (kind !== 'hungry') {
    const img = new Image();
    img.onload = () => draw(img);
    img.src = iconUrl(icon, 128);
  }
  return tex;
}

/** The working ring: progress 0..1 in 16 steps (one texture per step, shared). */
const ringTex = new Map();
function ringTexture(step) {
  let t = ringTex.get(step);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.lineWidth = 9; g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,248,236,0.9)';
  g.beginPath(); g.arc(32, 32, 22, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#6BBF4E';
  g.beginPath(); g.arc(32, 32, 22, -Math.PI / 2, -Math.PI / 2 + (step / 16) * Math.PI * 2); g.stroke();
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  ringTex.set(step, t);
  return t;
}

export function createAnimalsView(layers, overlay, toScreenM, { now: nowFn } = {}) {
  void overlay; void toScreenM;
  let now = nowFn || (() => Date.now());
  let state = null;
  let fx = null;
  let motion = 'full';
  let night = 0;
  let clock = 0;
  const focus = { x: 64, z: 64, dist: 55 };
  const group = new THREE.Group();
  group.name = 'animals';
  (layers.animals || layers.objects).add(group);

  /** id -> animal record */
  const animals = new Map();
  /** homeId -> { rect (world metres), spots, ids } */
  const homes = new Map();
  const coatCol = new THREE.Color();
  /** rigid instanced sets: key -> { mesh, cap, ids: [] } */
  const rigid = new Map();
  const shadowMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  shadowGeo.rotateX(-Math.PI / 2);
  let shadows = null;
  let shadowCap = 0;
  const bubbleTex = new Map();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e3 = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const side = new THREE.Vector3();
  const wq = new THREE.Quaternion();
  let skinnedPick = 0;
  let skinnedMax = SKINNED_MAX;
  let needCount = 0;
  // RD-09 (QA wave 2): zoomed out (>= WIDE_DIST m) a pen shows ONE need bubble, not one per animal, and no progress rings
  const penShown = new Set();

  // models load lazily per species; asked once per key, retried after a failure or before the manifest is in
  const requested = new Set();
  function request(key) {
    if (!key || requested.has(key) || models.isReady(key) || !models.has(key)) return;
    requested.add(key);
    models.ready([key]).catch(() => requested.delete(key));
  }

  function keyFor(defId, baby, id = null) {
    const k = `animal:${defId}`;
    if (baby && models.has(`${k}:baby`)) return `${k}:baby`;
    if (!baby && id) { const v = variantKey(defId, id, (x) => models.has(x)); if (v) return v; }
    return models.has(k) ? k : null;
  }

  // -------------------------------------------------------------------------------------------------
  // homes: yard rects in world metres from the home object, its footprint and the model's yard
  function homeRecord(homeId) {
    const h = state && Object.hasOwn(state.farm.objects, homeId) ? state.farm.objects[homeId] : null;
    if (!h || !Number.isFinite(h.x)) return null;
    const def = defOf(h.def);
    // wave 4b (owner wish 3): a grown home's pen is t tiles bigger each way, and its own model's yard is where they roam
    const t = homeTier(h, def);
    const [w0, d0] = def && def.size ? def.size : [3, 3];
    const w = w0 + t; const d = d0 + t;
    const rot = h.rot || 0;
    const odd = rot % 2 === 1;
    const cx = (h.x + (odd ? d : w) / 2) * TILE_M;
    const cz = (h.z + (odd ? w : d) / 2) * TILE_M;
    const grown = t > 0 && models.has(`home:${h.def}:g${t}`) ? models.info(`home:${h.def}:g${t}`) : null;
    const info = grown || models.info(`home:${h.def}`);
    // (a grown home drawn stretched, without a model of its own: its base yard stretched the same way)
    const k = t > 0 && !grown ? [w / w0, d / d0] : null;
    const yard0 = info && info.yard ? info.yard : [-w + 0.5, -d + 0.5, w - 0.5, d - 0.5];
    const yard = k ? [yard0[0] * k[0], yard0[1] * k[1], yard0[2] * k[0], yard0[3] * k[1]] : yard0;
    const r = rotateRect(yard, rot);
    // the model's behaviour anchors (model metres, +z = the gate) turned with the home like rotateRect does
    const pt = (x, z) => { switch (((rot % 4) + 4) % 4) { case 1: return [z, -x]; case 2: return [-x, -z]; case 3: return [-z, x]; default: return [x, z]; } };
    const disc = (a) => { if (!a) return null; const [px, pz] = pt(a[0], a[1]); return { x: cx + px, z: cz + pz, r: a[2], y: a[3] ?? 0 }; };
    const hive = info && info.hive ? (() => { const [px, pz] = pt(info.hive[0], info.hive[2]); return { x: cx + px, y: info.hive[1], z: cz + pz }; })() : null;
    return { rect: [cx + r[0], cz + r[1], cx + r[2], cz + r[3]], cx, cz, rot, def: h.def,
      water: disc(info && info.water), mud: disc(info && info.mud), dust: disc(info && info.dust), perches: (info && info.perches || []).map(disc), avoid: (info && info.avoid || []).map(disc),
      hive: hive || { x: cx, y: 0.45, z: cz } };
  }

  // bee forage within reach of the hives: decor with effect.forage, flower crops, flowering trees (world metres)
  let forage = [];
  function rebuildForage() {
    forage = [];
    if (!state) return;
    for (const o of Object.values(state.farm.objects)) {
      if (!Number.isFinite(o.x)) continue;
      const def = defOf(o.def);
      if (!def) continue;
      const crop = o.crop && cropOf(o.crop.def);
      const flowers = (def.effect && def.effect.forage > 0) || def.flowering || (crop && (crop.classes || []).includes('flower'));
      if (!flowers) continue;
      const [w, d] = def.size || [1, 1];
      const odd = (o.rot || 0) % 2 === 1;
      forage.push({ x: (o.x + (odd ? d : w) / 2) * TILE_M, z: (o.z + (odd ? w : d) / 2) * TILE_M });
    }
  }
  const BEE_REACH = 4 * TILE_M + 1;

  function rebuildHome(homeId) {
    const ids = [];
    for (const [id, o] of Object.entries(state.farm.objects)) if (o.home === homeId) ids.push(id);
    ids.sort();
    const rec = homeRecord(homeId);
    if (!rec) { homes.delete(homeId); return; }
    rec.ids = ids;
    rec.spots = yardSpots(rec.rect, Math.max(1, ids.length));
    homes.set(homeId, rec);
  }

  function syncAnimal(id) {
    const o = state && Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null;
    let a = animals.get(id);
    if (!o || typeof o.home !== 'string') {
      if (a) { dropSkinned(a); animals.delete(id); }
      return;
    }
    const def = defOf(o.def);
    if (!a) {
      a = { id, def: o.def, o, skin: null, x: 0, z: 0, face: 0, lean: 0, react: -10, jigAt: -10, hopPhase: 0, scale: 1, status: null, bubble: null, lastSeg: -1 };
      animals.set(id, a);
    }
    a.o = o;
    a.def = o.def;
    a.content = def || null;
  }

  function setState(s) {
    state = s;
    homes.clear();
    rebuildForage();
    const homeIds = new Set();
    for (const [id, o] of Object.entries(s.farm.objects)) if (typeof o.home === 'string') homeIds.add(o.home);
    for (const h of homeIds) rebuildHome(h);
    for (const id of [...animals.keys()]) syncAnimal(id);
    for (const [id, o] of Object.entries(s.farm.objects)) if (typeof o.home === 'string') syncAnimal(id);
  }

  function sync(ids, topics, s) {
    state = s;
    if (topics && topics.has && topics.has('*')) { setState(s); return; }
    const touchedHomes = new Set();
    for (const id of ids || []) {
      const o = Object.hasOwn(s.farm.objects, id) ? s.farm.objects[id] : null;
      const prev = animals.get(id);
      if (o && typeof o.home === 'string') touchedHomes.add(o.home);
      if (prev && prev.o && prev.o.home) touchedHomes.add(prev.o.home);
      if (homes.has(id) || (o && !o.home && Number.isFinite(o.x))) touchedHomes.add(id);
      syncAnimal(id);
    }
    for (const h of touchedHomes) rebuildHome(h);
    if (ids && ids.length) rebuildForage();
  }

  // -------------------------------------------------------------------------------------------------
  // skinned clones for the nearest animals
  function ensureSkinned(a) {
    const key = `animal:${a.def}`;
    const info = models.info(key);
    if (!info || info.kind !== 'skinned' || !models.isReady(key)) return false;
    const baby = animalStatus(a.o, now(), a.content).baby;
    const cid = coatId(a.o);
    // a baby that grew up, or a coat that changed (the Seasonal Track's coat put on), gets a fresh clone
    if (a.skin && (a.skin.baby !== baby || a.skin.coatId !== cid)) dropSkinned(a);
    if (a.skin) return true;
    const c = models.clone(key);
    if (!c) return false;
    const mixer = new THREE.AnimationMixer(c.object);
    const actions = {};
    for (const [name, clip] of c.clips) actions[name] = mixer.clipAction(clip);
    let head = null;
    const legs = [];
    c.object.traverse((x) => {
      if (!x.isBone) return;
      if (!head && x.name === (info.headBone || 'Head')) head = x;
      // procedural walk for the hoppers (the source sheep has no walk clip): the four upper legs
      const m = /^(Front|Back)UpLeg([LR])$/.exec(x.name);
      if (m) legs.push({ bone: x, phase: (m[1] === 'Front') === (m[2] === 'L') ? 0 : Math.PI });
    });
    // a bred coat (wave 3): a material of its own whose coat patch recolours the coat vertices; else (RD-14) the
    // individual tint, a colour multiplier
    const cc = coatColors(a.def, cid);
    const coat = coatOf(a.def, a.id);
    if (cc || coat[0] !== 1 || coat[1] !== 1 || coat[2] !== 1) {
      c.object.traverse((o) => {
        if (!o.isMesh) return;
        const tintMat = (mt) => {
          const m2 = mt.clone();
          if (cc) {
            m2.color.setRGB(1, 1, 1);
            wrapLighting(m2);
            coatPatchUniform(m2, { a: { value: new THREE.Color(...cc.a) }, b: { value: new THREE.Color(...cc.b) }, m: { value: cc.mode } });
          } else { m2.color.setRGB(coat[0], coat[1], coat[2]); wrapLighting(m2); }
          return m2;
        };
        o.material = Array.isArray(o.material) ? o.material.map(tintMat) : tintMat(o.material);
      });
    }
    // a baby's own proportions (RD-15): its bones (BABY_BONES, set again every frame after the clip pose) and the feet
    // put back on the ground (shorter legs lift them)
    const babyBones = [];
    let ground = 0;
    if (baby && BABY_BONES[a.def]) {
      const bones = {};
      c.object.traverse((x) => { if (x.isBone) bones[x.name] = x; });
      const lowY = () => {
        c.object.updateMatrixWorld(true);
        let y = Infinity;
        c.object.traverse((o) => { if (o.isSkinnedMesh) { o.computeBoundingBox(); y = Math.min(y, o.boundingBox.clone().applyMatrix4(o.matrixWorld).min.y); } });
        return Number.isFinite(y) ? y : 0;
      };
      const y0 = lowY();
      for (const [name, k] of Object.entries(BABY_BONES[a.def])) {
        const b = bones[name];
        if (!b || name === (info.headBone || 'Head')) continue;
        babyBones.push({ bone: b, base: b.scale.clone(), k });
        b.scale.multiplyScalar(k);
      }
      ground = y0 - lowY();
    }
    const holder = new THREE.Group();
    holder.add(c.object);
    group.add(holder);
    a.skin = { holder, object: c.object, mixer, actions, head, legs, base: null, clip: null, headScale: head ? head.scale.clone() : null,
      baby, coatId: cid, babyBones, ground, headK: baby ? (BABY_BONES[a.def]?.Head ?? 1.35) : ADULT_HEAD };
    return true;
  }

  function dropSkinned(a) {
    if (!a.skin) return;
    a.skin.mixer.stopAllAction();
    a.skin.holder.removeFromParent();
    a.skin = null;
  }

  function playClip(a, name, { scale = 1, once = false, fade = 0.25 } = {}) {
    const s = a.skin;
    if (!s) return;
    const act = s.actions[name] || s.actions.Idle;
    if (!act || (s.base === act && !once)) { if (act) act.timeScale = scale; return; }
    act.reset();
    act.timeScale = scale;
    act.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    act.clampWhenFinished = once;
    act.setEffectiveWeight(1).play();
    if (s.base && s.base !== act) s.base.crossFadeTo(act, fade, false);
    s.base = act;
    s.clip = name;
  }

  // -------------------------------------------------------------------------------------------------
  // rigid instanced sets (and blob shadows)
  function rigidSet(key) {
    let r = rigid.get(key);
    if (r) return r;
    const geo = models.geometryFor(key);
    if (!geo) return null;
    r = { key, geo, mesh: null, cap: 0, n: 0 };
    rigid.set(key, r);
    return r;
  }
  // the rigid animals' material: the shared look plus the per-instance coat (wave 3); one program for every species
  const rigidMat = coatPatchInstanced(models.createMaterial());
  rigidMat.name = 'hh-animal-rigid';
  /** A geometry for an instanced set: the model's attributes (shared buffers) plus this set's instanced coat. */
  function instancedGeo(src, cap) {
    const g = new THREE.BufferGeometry();
    for (const [k, at] of Object.entries(src.attributes)) g.setAttribute(k, at);
    g.setIndex(src.index);
    g.boundingSphere = src.boundingSphere; g.boundingBox = src.boundingBox;
    g.setAttribute('iCoatA', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    g.setAttribute('iCoatB', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    g.setAttribute('iCoatM', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    for (const k of ['iCoatA', 'iCoatB', 'iCoatM']) g.getAttribute(k).setUsage(THREE.DynamicDrawUsage);
    return g;
  }
  function setCoatAt(r, i, cc) {
    const ga = r.mesh.geometry.getAttribute('iCoatA'); const gb = r.mesh.geometry.getAttribute('iCoatB'); const gm = r.mesh.geometry.getAttribute('iCoatM');
    if (cc) { ga.setXYZ(i, cc.a[0], cc.a[1], cc.a[2]); gb.setXYZ(i, cc.b[0], cc.b[1], cc.b[2]); gm.setX(i, cc.mode); } else gm.setX(i, 0);
  }
  function ensureCap(r, n) {
    if (r.mesh && r.cap >= n) return;
    const cap = Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
    if (r.mesh) { group.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.dispose(); }
    r.mesh = new THREE.InstancedMesh(instancedGeo(r.geo, cap), rigidMat, cap);
    r.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    r.mesh.frustumCulled = false;
    r.mesh.castShadow = false;
    group.add(r.mesh);
    r.cap = cap;
  }
  function ensureShadows(n) {
    if (shadows && shadowCap >= n) return;
    shadowCap = Math.max(32, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
    if (shadows) { group.remove(shadows); shadows.dispose(); }
    shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, shadowCap);
    shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shadows.frustumCulled = false;
    shadows.renderOrder = 1;
    group.add(shadows);
  }

  // -------------------------------------------------------------------------------------------------
  function bubbleFor(a, kind, icon, ring = -1) {
    const want = kind ? `${kind}:${icon}` : null;
    if (a.bubbleKey === want) return;
    a.bubbleKey = want;
    if (!want) { if (a.bubble) a.bubble.visible = false; return; }
    let tex = kind === 'working' ? ringTexture(ring) : bubbleTex.get(want);
    if (!tex) { tex = bubbleTexture(icon, kind); bubbleTex.set(want, tex); }
    if (!a.bubble) {
      a.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false }));
      a.bubble.renderOrder = 15;
      a.bubble.center.set(0.5, 0);                  // grows up from its anchor over the head
      group.add(a.bubble);
    }
    a.bubble.material.map = tex;
    a.bubble.material.needsUpdate = true;
    a.bubble.visible = true;
  }

  function pet(id) {
    const a = animals.get(id);
    if (!a) return;
    a.react = clock;
    if (a.skin) playClip(a, a.skin.actions.React ? 'React' : 'Jump', { once: true, fade: 0.12 });
    if (fx) fx.play({ e: 'petted' }, new THREE.Vector3(a.x, 0, a.z));
  }

  function onEvent(ev, meta = {}) {
    void meta;
    if (ev && HORSE_SHOW_EVENTS.has(ev.e)) { horseShow(ev); return; }
    // the rules name no horse when a Show Ribbon is entered at the Fair: the horse show's entry trots the first adult
    // horse (lead, wave 3: the trot never started in the real game)
    if (ev && ev.e === 'fairEntered' && ev.item === 'show_ribbon' && isLive(featureOf('horse_show'))) { horseShow({}); return; }
    if (!ev || !ev.id) return;
    const a = animals.get(ev.id);
    if (!a) return;
    if (ev.e === 'petted') { a.react = clock; if (a.skin) playClip(a, a.skin.actions.React ? 'React' : 'Jump', { once: true, fade: 0.12 }); }
    if (ev.e === 'fed' || ev.e === 'tended') a.fedLocal = clock;
    if (ev.e === 'collected' || ev.e === 'tended') a.jigAt = clock + (ev.e === 'tended' ? 1.6 : 0);
    if (ev.e === 'placed' || ev.e === 'bought') a.jigAt = clock;
  }
  /** The horse show (wave 3): a horse entered (its id on the event) trots laps of its yard for SHOW_S seconds and gets
   *  its rosette at the end; without an id, the first adult horse on the farm shows. */
  function horseShow(ev) {
    let a = ev.id ? animals.get(ev.id) : null;
    if (!a || a.def !== 'horse') a = [...animals.values()].filter((x) => x.def === 'horse' && !(x.status && x.status.baby)).sort((x, y) => (x.id < y.id ? -1 : 1))[0];
    if (!a) return;
    a.show = { t0: clock, until: clock + SHOW_S };
    if (fx) setTimeout(() => { if (a.x !== undefined) fx.play({ e: 'prized', id: a.id }, new THREE.Vector3(a.x, 0, a.z)); }, SHOW_S * 1000);
  }

  // -------------------------------------------------------------------------------------------------
  /** Turn a bone about the animal's left-right axis (world), on top of the clip pose (a pig noses down). */
  function tiltBone(bone, face, angle) {
    if (!bone || !angle) return;
    bone.updateWorldMatrix(true, false);
    bone.getWorldQuaternion(wq);
    side.set(Math.cos(face), 0, -Math.sin(face));
    const axis = v.copy(side).applyQuaternion(wq.invert());
    bone.quaternion.multiply(q.setFromAxisAngle(axis, angle));
  }
  /** Half the body length (nose to tail, metres, at the animal's scale). */
  function halfLength(a) {
    const b = models.boundsOf(`animal:${a.def}`);
    return Math.max(0, b.max.z - b.min.z) * 0.5 * (a.scale || 1);
  }
  /** Body radius for the pen spacing: half the footprint's mean of width and length, times 1.2 (VISUAL-AFTER C2). */
  function bodyRadius(a, scale) {
    const b = models.boundsOf(`animal:${a.def}`);
    const w = Math.max(0.2, b.max.x - b.min.x); const l = Math.max(0.2, b.max.z - b.min.z);
    return 0.5 * Math.sqrt(w * l) * scale * 1.2;
  }
  let rain = 0;
  const dirtAt = new Map();

  function update(dt) {
    clock += dt;
    if (!state || !animals.size) {
      for (const r of rigid.values()) if (r.mesh) r.mesh.count = 0;
      if (shadows) shadows.count = 0;
      return 0;
    }
    const t = now();
    const asleep = night > 0.5;
    // horses out with a rider stay out of the stable (the first adult horses by id, one per rider)
    let riders = 0; for (const on of RIDERS.values()) if (on) riders++;
    const ridden = new Set();
    if (riders) {
      const horses = [...animals.values()].filter((a) => a.def === 'horse' && !(a.status && a.status.baby)).map((a) => a.id).sort();
      for (const id of horses.slice(0, riders)) ridden.add(id);
    }
    // choose the skinned set: nearest to the camera focus, re-evaluated twice a second
    if (clock >= skinnedPick) {
      skinnedPick = clock + 0.5;
      const near = [...animals.values()].filter((a) => !ridden.has(a.id) && models.info(`animal:${a.def}`)?.kind === 'skinned')
        .map((a) => ({ a, d: Math.hypot(a.x - focus.x, a.z - focus.z) - (a.skin ? 3 : 0) }))
        .filter((x) => x.d < Math.max(30, focus.dist * 0.9))
        .sort((p, q2) => p.d - q2.d);
      const keep = new Set(near.slice(0, skinnedMax).map((x) => x.a.id));
      for (const a of animals.values()) {
        if (keep.has(a.id) && motion !== 'still') ensureSkinned(a); else dropSkinned(a);
      }
    }
    for (const r of rigid.values()) r.n = 0;
    let si = 0;
    needCount = 0;
    penShown.clear();
    ensureShadows(animals.size);
    let frame = 0;

    // phase A: where everyone wants to be (deterministic poses), per pen
    const pens = new Map();
    for (const a of animals.values()) {
      a.drawn = false;
      const home = homes.get(a.o.home);
      if (!home) continue;
      const st = animalStatus(a.o, t, a.content);
      if (a.fedLocal && clock - a.fedLocal < 1.6) st.eating = true;
      a.status = st;
      a.homeRec = home;
      if (a.def === 'bee' || ridden.has(a.id)) { if (ridden.has(a.id)) dropSkinned(a); continue; }
      request(`animal:${a.def}`);
      if (st.baby) request(`animal:${a.def}:baby`);
      const slot = Math.max(0, home.ids.indexOf(a.id));
      const spot = home.spots[slot] || { x: home.cx, z: home.cz };
      const info = models.info(keyFor(a.def, st.baby) || `animal:${a.def}`) || {};
      a.info = info;
      const speed = (info.speed || 0.6) * (st.baby ? 1.2 : 1);
      const yard = home.rect;
      const radius = Math.min(3, Math.max(0.6, Math.min(yard[2] - yard[0], yard[3] - yard[1]) * 0.45));
      let p;
      if (asleep || st.eating || motion === 'still') p = { x: a.x || spot.x, z: a.z || spot.z, walking: false, face: a.face, speed: 0, phase: clock, seg: -1, since: 99 };
      else if (a.def === 'duck' && home.water) p = pondPose(a.id, t, spot, yard, home.water, { speed });
      else if (a.def === 'goat' && home.perches.length) p = climbPose(a.id, t, spot, yard, home.perches, { radius, speed });
      else if (a.def === 'alpaca') p = dustPose(a.id, t, spot, yard, home.dust, home.perches, { radius, speed });
      else p = wanderPose(a.id, t, spot, yard, { radius, speed });
      // the horse show (wave 3): a horse entered trots laps of its yard while the show plays
      if (a.show && clock < a.show.until && !st.baby) {
        const [x0, z0, x1, z1] = yard;
        p = trotPose(clock, a.show.t0, { x: (x0 + x1) / 2, z: (z0 + z1) / 2, rx: Math.max(0.6, (x1 - x0) * 0.32), rz: Math.max(0.6, (z1 - z0) * 0.32) });
      } else if (a.show) a.show = null;
      a.p = p;
      a.scale = (st.baby ? babyScale(a.def) : 1) * (st.ribbon ? 1.05 : 1) * (SPECIES_SCALE[a.def] || 1);
      let list = pens.get(home); if (!list) { list = []; pens.set(home, list); }
      list.push({ x: p.x, z: p.z, r: bodyRadius(a, a.scale), a, free: (a.def === 'goat' || a.def === 'alpaca') && perchY(p.x, p.z, home.perches) > 0.05 });
    }
    // phase B: keep 1.2 body widths apart and clear of the trough and the ramp; long bodies stay inside the yard
    for (const [home, list] of pens) {
      if (list.length > 1 || home.avoid.length) separate(list, home.avoid, home.rect);
      for (const e of list) {
        const a = e.a;
        const L = halfLength(a);
        if (L > 0.55 && a.p && a.def !== 'duck') {
          // a big body (cow, horse, alpaca) keeps its muzzle and rump INSIDE the rails: the 0.25 m allowance put
          // hindquarters through the fence (final release V-08); small ones may still lean over a little
          const fit = fitBody(e.x, e.z, a.p.face, L, home.rect, BIG_BODIES.has(a.def) || L > 0.7 ? -0.1 : 0.25);
          e.x = fit.x; e.z = fit.z;
          if (fit.face !== a.p.face) a.p = { ...a.p, face: fit.face };
        }
        a.x = e.x; a.z = e.z;
      }
    }

    // phase C: draw
    for (const a of animals.values()) {
      const home = a.homeRec;
      if (!home || a.def === 'bee' || ridden.has(a.id) || !a.p) continue;
      const st = a.status; const p = a.p; const info = a.info || {};
      const speed = info.speed || 0.6;
      a.face += (((((p.face - a.face) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 6);
      if (p.walking) frame = Math.max(frame, 1);
      const scale = a.scale;
      // behaviours: afloat in the pond, up on a perch, rooting, wallowing in the mud
      const swim = a.def === 'duck' && home.water && Math.hypot(a.x - home.water.x, a.z - home.water.z) < home.water.r * 0.95;
      let lift = a.def === 'goat' || a.def === 'alpaca' ? perchY(a.x, a.z, home.perches) : 0;
      const idle = !p.walking && !st.eating && !asleep && motion !== 'still';
      // wave 3: an alpaca rolls in the dust patch, cushes (lies down, legs folded under) now and then, pronks when
      // playful; a sleepy animal lies down often (Nursery personalities)
      const pers = personalityOf(a.o);
      const bathe = a.def === 'alpaca' && idle && p.inDust && p.since > 0.4;
      const lie = idle && !bathe && p.since > 0.6 && cushes(a.def, a.id, p.seg, pers);
      const cushGoal = bathe || lie ? -0.42 * scale * (st.baby ? 0.8 : 1) : 0;
      a.cushY = (a.cushY || 0) + (cushGoal - (a.cushY || 0)) * Math.min(1, dt * 3);
      if (Math.abs(a.cushY - cushGoal) > 0.005) frame = Math.max(frame, 1);
      const hopK = pers ? PERSONALITY[pers].hop : a.def === 'alpaca' ? 0.12 : 0;
      const pronkT = idle && !lie && !bathe && hopK > 0 && unit(hash32(a.id, p.seg, 'pronk')) < hopK ? p.since - 0.2 : -1;
      const pronk = pronkT > 0 && pronkT < 0.55 ? Math.sin((pronkT / 0.55) * Math.PI) * 0.32 * scale : 0;
      if (pronk) frame = 2;
      if (bathe) {
        lift -= 0.02;
        if (fx && motion === 'full' && clock >= (dirtAt.get(`${a.id}#dust`) ?? 0)) {
          dirtAt.set(`${a.id}#dust`, clock + 0.6);
          fx.burst('dust', new THREE.Vector3(a.x, 0.1, a.z), { n: 2, color: '#E6D4AC', speed: 0.6, up: 0.6, size: 0.45, sizeEnd: 0.9, grav: -0.02, life: 0.9, spread: 0.3, alpha: 0.55, ambient: true });
        }
      }
      // a golden coat glints now and then (ambient: never the interactive frame rate)
      if (fx && motion === 'full' && coatId(a.o) === 'golden' && clock >= (dirtAt.get(`${a.id}#gold`) ?? 0)) {
        dirtAt.set(`${a.id}#gold`, clock + 2.2 + (hash32(a.id, Math.floor(clock)) % 100) / 50);
        fx.burst('sparkle', new THREE.Vector3(a.x, 0.5 * scale + lift, a.z), { n: 2, colors: ['#FFF3C4', '#FFE27A'], speed: 0.5, up: 0.8, size: 0.28, grav: 0, life: 0.8, spread: 0.35 * scale, ambient: true });
      }
      const wallow = a.def === 'pig' && idle && home.mud && Math.hypot(a.x - home.mud.x, a.z - home.mud.z) < home.mud.r * 0.8;
      const rooting = a.def === 'pig' && idle && !wallow && p.since > 0.3 && p.since < 3.2 && unit(hash32(a.id, p.seg, 'root')) < 0.6;
      if (swim) lift = -0.11 * scale + Math.sin(clock * 2.2 + (hash32(a.id) % 100) / 10) * 0.012;
      if (wallow) lift = -0.07;
      a.behave = swim ? 'swim' : wallow ? 'wallow' : rooting ? 'root' : bathe ? 'bathe' : lie ? 'cush' : pronk ? 'pronk' : p.trot ? 'trot' : lift > 0.2 ? 'perch' : null;
      // pet reaction: lean toward the hand, then settle (spring-ish decay)
      const sinceReact = clock - a.react;
      const lean = sinceReact < 1.2 ? Math.sin(Math.min(1, sinceReact / 0.25) * Math.PI / 2) * (1 - sinceReact / 1.2) * 0.25 : 0;
      // happy jig: two 250 ms hops after eating / collecting
      const sinceJig = clock - a.jigAt;
      const jig = sinceJig >= 0 && sinceJig < 0.5 ? Math.abs(Math.sin((sinceJig / 0.25) * Math.PI)) * 0.25 : 0;
      if (sinceReact < 1.2 || (sinceJig >= 0 && sinceJig < 0.6)) frame = 2;
      const isHopper = !!info.hop;
      const wallowRoll = wallow ? 1.15 : bathe ? Math.sin(clock * 1.6 + (hash32(a.id) % 10)) * 1.05 : 0;
      if (a.skin) {
        const s = a.skin;
        const trotBob = p.trot && motion !== 'still' ? Math.abs(Math.sin(clock * 9)) * 0.06 : 0;
        s.holder.position.set(a.x, jig + lift + s.ground * scale + (a.cushY || 0) + pronk + trotBob, a.z);
        s.holder.rotation.set(0, a.face, lean + wallowRoll);
        s.holder.scale.setScalar(scale);
        // hoppers walk on a procedural leg swing over their idle (visual-22: a sheep walks, it does not jump)
        const legWalk = isHopper && s.legs.length === 4 && !s.actions.Walk;
        if (sinceReact < 0.05) { /* clip already started by pet() */ } else if (st.eating) playClip(a, 'Eat');
        else if (p.trot) playClip(a, 'Walk', { scale: 1.9 });                     // the show trot: a quick, high-stepping walk
        else if (p.walking) playClip(a, legWalk ? 'Idle' : isHopper ? 'Jump' : 'Walk', { scale: isHopper ? (legWalk ? 0.6 : 1.1) : Math.max(0.7, Math.min(1.6, p.speed / Math.max(0.2, speed) * 0.9)) });
        else if (asleep || lie || bathe) playClip(a, s.actions.Graze ? 'Graze' : 'Idle', { scale: 0.35 });
        else if (pronk && s.actions.Jump) playClip(a, 'Jump', { scale: 1.3 });
        else if (!s.base || s.clip === 'Walk' || s.clip === 'Jump' || s.clip === 'Eat' || p.seg !== a.lastSeg) {
          // horses: the plain idle and grazing (their Idle2 throws the head; it read as rearing in a still); a nursery
          // personality has its own idle set and tempo (sleepy grazes slowly, playful fidgets, grumpy tosses its head)
          const pp = pers ? PERSONALITY[pers] : null;
          const idles = (pp ? pp.idles : a.def === 'horse' ? ['Idle', 'Graze'] : ['Idle', 'Idle2', 'Graze']).filter((n) => s.actions[n]);
          playClip(a, idles[hash32(a.id, p.seg) % idles.length] || 'Idle', { scale: pp ? pp.scale : 1 });
        }
        a.lastSeg = p.seg;
        for (const l of s.legs) if (l.pre) { l.bone.quaternion.copy(l.pre); l.pre = null; }   // undo last frame's swing
        if (s.headPre) { s.head.quaternion.copy(s.headPre); s.headPre = null; }
        s.mixer.update(motion === 'still' ? 0 : dt * (Math.hypot(a.x - focus.x, a.z - focus.z) > 45 ? 0.5 : 1));
        // babies: a bigger head ratio (visual-ux-juice §3.7); adults a touch bigger too (RD-14, QA wave 2: cuter, rounder
        // farm animals), applied after the clip pose
        if (s.head && s.headScale) s.head.scale.copy(s.headScale).multiplyScalar(s.headK);
        for (const bb of s.babyBones) bb.bone.scale.copy(bb.base).multiplyScalar(bb.k);
        if (isHopper && s.legs.length === 4 && !s.actions.Walk && p.walking && motion !== 'still') {
          s.walkPh = (s.walkPh || 0) + dt * 9 * Math.max(0.6, p.speed / Math.max(0.2, speed));
          s.holder.updateMatrixWorld(true);
          side.set(Math.cos(a.face), 0, -Math.sin(a.face));      // the animal's left-right axis (it faces +Z)
          for (const l of s.legs) {
            l.bone.getWorldQuaternion(wq);
            const axis = v.copy(side).applyQuaternion(wq.invert());
            l.pre = l.bone.quaternion.clone();
            l.bone.quaternion.multiply(q.setFromAxisAngle(axis, Math.sin(s.walkPh + l.phase) * 0.5));
          }
          s.holder.position.y += Math.abs(Math.sin(s.walkPh)) * 0.03;
        }
        // the show trot: the head carried high and proud
        if (p.trot && s.head) { s.holder.updateMatrixWorld(true); s.headPre = s.headPre || s.head.quaternion.clone(); tiltBone(s.head, a.face, -0.3); }
        // a rooting pig noses into the ground, bobbing
        if (rooting && s.head) { s.holder.updateMatrixWorld(true); s.headPre = s.head.quaternion.clone(); tiltBone(s.head, a.face, 0.55 + Math.sin(clock * 14) * 0.12); }
        if (motion !== 'still') frame = Math.max(frame, 1);
      } else {
        const key = keyFor(a.def, st.baby, a.id);
        if (key) request(key);
        const r = key ? rigidSet(key) : null;
        const chick = st.baby && key === `animal:${a.def}:baby`;
        if (r) {
          // procedural motion: walking bob + waddle roll, idle pecks (birds) or slow head-low grazing tilt
          const ph = clock * (p.walking ? 9 : 1) + (hash32(a.id) % 100) / 16;
          let bob = 0; let roll = 0; let pitch = 0;
          if (swim) {
            // afloat: no waddle, a slow rock and an occasional dabble (head under, tail up)
            roll = Math.sin(clock * 1.7 + (hash32(a.id) % 50)) * 0.05;
            const dab = (clock + (hash32(a.id, 'dab') % 1000) / 200) % 7;
            if (!p.walking && dab < 0.9) pitch = Math.sin((dab / 0.9) * Math.PI) * 1.1;
          } else if (p.walking) {
            // a chick scurries in little hops
            bob = isHopper ? Math.abs(Math.sin(ph * 0.6)) * 0.18 : chick ? Math.abs(Math.sin(ph * 0.8)) * 0.07 : Math.abs(Math.sin(ph)) * 0.04;
            roll = Math.sin(ph) * (info.kind === 'rigid' ? 0.14 : 0.04);
          } else if (!asleep && chick) {
            // a chick's idle: now and then a peep (a double hop, beak up), else a quick peck at the straw
            const pp = (clock + (hash32(a.id, 'peep') % 1000) / 250) % 3.1;
            if (pp < 0.5) { bob = Math.abs(Math.sin((pp / 0.25) * Math.PI)) * 0.06; pitch = -0.32 * Math.sin((pp / 0.5) * Math.PI); }
            else if (pp > 1.8 && pp < 2.1) pitch = Math.sin(((pp - 1.8) / 0.3) * Math.PI) * 0.6;
          } else if (!asleep) {
            const pk = (clock + (hash32(a.id, 'pk') % 1000) / 333) % 2.2;
            if (info.kind === 'rigid' && pk < 0.35) pitch = Math.sin((pk / 0.35) * Math.PI) * 0.55;
            if (st.eating) pitch = 0.4 + Math.sin(clock * 12) * 0.12;
            if (rooting) pitch = 0.32 + Math.sin(clock * 14) * 0.06;
          }
          if (asleep && info.kind === 'rigid') { bob = -0.03; }
          const sy = asleep ? 0.86 : 1;
          e3.set(pitch, a.face, roll + lean + wallowRoll, 'YXZ');
          q.setFromEuler(e3);
          v.set(a.x, bob + jig + lift + (a.cushY || 0) + pronk, a.z);
          sc.set(scale, scale * sy, scale);
          m4.compose(v, q, sc);
          ensureCap(r, r.n + 1);
          const cc = coatColors(a.def, coatId(a.o));
          const coat = cc ? [1, 1, 1] : coatOf(a.def, a.id);
          r.mesh.setColorAt(r.n, coatCol.setRGB(coat[0], coat[1], coat[2]));
          setCoatAt(r, r.n, cc);
          r.mesh.setMatrixAt(r.n++, m4);
          if (motion !== 'still' && (p.walking || !asleep)) frame = Math.max(frame, 1);
        }
      }
      // dirt from a rooting snout, ripples behind a swimming duck (ambient: never the interactive rate)
      if (fx && motion === 'full' && (rooting || (swim && p.walking))) {
        const due = dirtAt.get(a.id) ?? 0;
        if (clock >= due) {
          dirtAt.set(a.id, clock + (rooting ? 0.45 : 0.85));
          const b0 = models.boundsOf(`animal:${a.def}`); const reach = (b0.max.z - b0.min.z) * 0.5 * scale;
          if (rooting) fx.burst('dirt', new THREE.Vector3(a.x + Math.sin(a.face) * reach, 0.02, a.z + Math.cos(a.face) * reach),
            { n: 3, color: '#7A5233', speed: 0.7, up: 1.3, size: 0.09, grav: 0.9, life: 0.5, y: 0.05, spread: 0.08, ambient: true });
          else fx.burst('ring', new THREE.Vector3(a.x, 0.07, a.z), { n: 1, color: '#E4F4FF', speed: 0, up: 0, size: 0.12, sizeEnd: 0.9, grav: 0, spin: 0, life: 1.1,
            y: 0.0, spread: 0, alpha: 0.5, ambient: true, flat: true, additive: false });
        }
      }
      a.drawn = true;
      // shadow (none under a swimmer: the water is its shadow)
      // the baby's own model (the chick) sizes its shadow and its bubble height, else the grown-up's
      const b = models.boundsOf(keyFor(a.def, st.baby) || `animal:${a.def}`);
      if (!swim) {
        const len = Math.max(0.5, Math.max(b.max.x - b.min.x, b.max.z - b.min.z)) * scale * 1.1;
        e3.set(0, a.face, 0); q.setFromEuler(e3);
        m4.compose(v.set(a.x, 0.02 + Math.max(0, lift), a.z), q, sc.set(len * 0.62, 1, len * (jig ? 0.8 : 1)));
        shadows.setMatrixAt(si++, m4);
      }
      // needs: product bubble (120 BPM bob), hungry thought cloud, or the working ring
      drawNeeds(a, t, Math.max(0.6, b.max.y * scale) + 0.12 + Math.max(0, lift), () => { frame = Math.max(frame, 1); });
    }

    // bees: each colony is a little cloud round its hive, plus foragers shuttling to the flowers in reach
    for (const a of animals.values()) {
      if (a.def !== 'bee' || !a.homeRec) continue;
      const home = a.homeRec; const st = a.status;
      a.x = home.hive.x; a.z = home.hive.z;
      a.drawn = true;
      drawNeeds(a, t, (home.hive.y || 0.45) + 1.05, () => { frame = Math.max(frame, 1); });
      if (asleep || rain > 0.3 || motion === 'still') continue;
      request('animal:bee');
      const r = rigidSet('animal:bee');
      if (!r) continue;
      const near = forage.filter((f) => Math.hypot(f.x - home.hive.x, f.z - home.hive.z) < BEE_REACH)
        .sort((f1, f2) => Math.hypot(f1.x - home.hive.x, f1.z - home.hive.z) - Math.hypot(f2.x - home.hive.x, f2.z - home.hive.z));
      const n = st.ready ? BEES.ready : BEES.swarm;
      const tt = t / 1000; const seed = hash32(a.id) % 997;
      // a bee is 10 cm: drawn bigger the farther the camera, so the swarm reads as a buzz of dots at every zoom
      const beeScale = Math.min(BEES.scale, Math.max(0.9, focus.dist * 0.036));
      for (let j = 0; j < n + (near.length ? BEES.foragers : 0); j++) {
        const forager = j >= n;
        const bp = beePose(home.hive, j, tt, { forage: forager ? near[(j - n) % near.length] : null, forager, seed });
        e3.set(0, bp.face, Math.sin(tt * 30 + j) * 0.25, 'YXZ'); q.setFromEuler(e3);
        m4.compose(v.set(bp.x, bp.y, bp.z), q, sc.setScalar(beeScale));
        ensureCap(r, r.n + 1);
        setCoatAt(r, r.n, null);
        r.mesh.setMatrixAt(r.n++, m4);
      }
      frame = Math.max(frame, 1);
    }
    for (const r of rigid.values()) {
      if (!r.mesh) continue;
      r.mesh.count = r.n;
      r.mesh.instanceMatrix.needsUpdate = true;
      if (r.mesh.instanceColor) r.mesh.instanceColor.needsUpdate = true;
      for (const k of ['iCoatA', 'iCoatB', 'iCoatM']) { const at = r.mesh.geometry.getAttribute(k); if (at) at.needsUpdate = true; }
    }
    // hide the bubbles of animals that were not drawn this frame (out riding)
    for (const a of animals.values()) if (!a.drawn && a.bubble && a.bubble.visible) { a.bubble.visible = false; a.bubbleKey = null; }
    shadows.count = si;
    shadows.instanceMatrix.needsUpdate = true;
    return frame;
  }

  /** The need bubble over an animal (or over a hive) at height h. */
  function drawNeeds(a, t, h, wantFrame) {
    const st = a.status;
    const product = a.content && a.content.product;
    const feed = a.content && a.content.feed;
    let kind = st.ready && product ? 'ready' : (st.hungry && feed && !st.eating ? 'hungry' : null);
    if (kind) needCount++;
    const wide = focus.dist >= WIDE_DIST;
    if (kind && wide && a.o.home) {
      const pk = `${a.o.home}|${kind}`;
      if (penShown.has(pk)) kind = null; else penShown.add(pk);
    }
    let ring = -1;
    if (!kind && !wide && st.producing && Number.isFinite(a.o.fedAt) && Number.isFinite(a.o.readyAt) && a.o.readyAt > a.o.fedAt) {
      ring = Math.max(0, Math.min(16, Math.floor(((t - a.o.fedAt) / (a.o.readyAt - a.o.fedAt)) * 16)));
      kind = 'working';
    }
    bubbleFor(a, kind, kind === 'ready' ? product : kind === 'working' ? `ring${ring}` : feed, ring);
    if (a.bubble && a.bubble.visible) {
      const bob = kind === 'ready' && motion === 'full';
      const bobY = bob ? Math.abs(Math.sin(clock * Math.PI * 2)) * 0.1 : 0;
      a.bubble.position.set(a.x, h + bobY, a.z);
      const sz = bubbleSize(BUBBLE_PX[kind], focus.dist);
      a.bubble.scale.set(sz, sz, sz);
      if (bob) wantFrame();
    }
  }

  return {
    setNow(fn) { now = fn; },
    setState,
    sync,
    update,
    setFocus(x, z, dist = focus.dist) { focus.x = x; focus.z = z; focus.dist = dist; },
    positionOf(id) { const a = animals.get(id); return a ? new THREE.Vector3(a.x, 0, a.z) : null; },
    pickables() {
      const out = [];
      for (const a of animals.values()) {
        if (a.drawn === false) continue;                  // out riding
        const baby = Boolean(a.status && a.status.baby);
        const b = models.boundsOf(keyFor(a.def, baby) || `animal:${a.def}`);
        const s = (baby ? babyScale(a.def) : 1) * (SPECIES_SCALE[a.def] || 1);
        out.push({ id: a.id, x: a.x, z: a.z, r: Math.max(0.4, (b.max.z - b.min.z) * 0.5 * s), h: Math.max(0.5, b.max.y * s) });
      }
      for (const [pid, p] of PET_PICKS) out.push({ id: `pet:${pid}`, pet: pid, x: p.x, z: p.z, r: p.r, h: p.h, asleep: Boolean(p.asleep) });
      return out;
    },
    onEvent,
    pet,
    needs() { return needCount; },
    warmup() {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(8), transparent: true, depthWrite: false, fog: false }));
      sp.visible = false;
      group.add(sp);
      // the rigid animals' coat material (an instanced program of its own)
      const box3 = new THREE.BoxGeometry(0.1, 0.1, 0.1);
      box3.setAttribute('color', new THREE.BufferAttribute(new Float32Array(box3.getAttribute('position').count * 3).fill(1), 3));
      box3.setAttribute('_coat', new THREE.BufferAttribute(new Float32Array(box3.getAttribute('position').count * 3), 3));
      const im = new THREE.InstancedMesh(instancedGeo(box3, 1), rigidMat, 1);
      im.setColorAt(0, coatCol.setRGB(1, 1, 1));
      im.visible = false;
      group.add(im);
      return [sp, im];
    },
    setFx(f) { fx = f; },
    setMotion(m) { motion = m === 'still' || m === 'reduced' ? m : 'full'; },
    setSkinnedMax(n) {
      const v = Number.isFinite(n) ? Math.max(0, Math.min(SKINNED_MAX, Math.round(n))) : SKINNED_MAX;
      if (v !== skinnedMax) { skinnedMax = v; skinnedPick = 0; }
    },
    setNight(k) { night = Math.max(0, Math.min(1, k || 0)); },
    setWeather(k) { rain = Math.max(0, Math.min(1, k || 0)); },
    stats() {
      let sk = 0;
      for (const a of animals.values()) if (a.skin) sk++;
      return { animals: animals.size, skinned: sk, rigid: animals.size - sk };
    },
    /** Dev / lab: what each animal is doing ({ id, def, x, z, clip, skinned, status, behaviour }). */
    debug() {
      return [...animals.values()].map((a) => ({ id: a.id, def: a.def, x: +a.x.toFixed(2), z: +a.z.toFixed(2), clip: a.skin ? a.skin.clip : null,
        skinned: !!a.skin, status: a.status, behaviour: a.behave || null }));
    },
    dispose() {
      for (const a of animals.values()) { dropSkinned(a); if (a.bubble) a.bubble.material.dispose(); }
      for (const r of rigid.values()) if (r.mesh) r.mesh.dispose();
      if (shadows) shadows.dispose();
      group.removeFromParent();
    },
  };
}
