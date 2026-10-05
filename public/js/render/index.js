// Render facade (FROZEN CONTRACT, tech-architecture §11.3). The client (main.js, controller, ui) talks to
// the 3D world ONLY through `view`. The render lanes rebuild everything behind it; the method names,
// arguments and return shapes below stay stable. Units: rule TILES at this boundary (floats allowed for
// presence); metres only inside render/ (TILE_M).
//
//   view.init(canvas, { quality?, now, overlay }) -> Promise<void>
//        quality: 'high'|'medium'|'low'|'auto' (default 'high'; a remembered auto-settled tier wins over the
//        default); now(): estimated server epoch ms (ClockSync); overlay: a DOM element above the canvas
//   view.setState(state, { me })      after every welcome: (re)build everything from the replicated state
//   view.sync(ids, topics)            after each store 'change': re-read only these object ids / topics
//   view.pick(ndc) -> { kind: 'object'|'tile', id?, x, z, px, pz, land?, expansion? } | null
//        ndc: {x, y} in [-1, 1]; x/z: integer tile; px/pz: float tile of the ground hit (cursor presence).
//        Tall objects (buildings, trees, homes) and animals are hit by their 3D shape first.
//        On tiles: land 'owned' | 'sale' | 'wild'; expansion = the live expansion for sale under the cursor.
//        A pick also moves MY hand of wind (crops part around the cursor) and the hover lift.
//   view.ghost.show(defId, rot) / view.ghost.hide() / view.ghost.update(tile {x,z}, valid, reason, blockerId?)
//   view.partner.update(rows, ts)     presence rows [pid, x, z, f, a, cx, cz, rts, tool, hop]; each row is
//        interpolated on its own server time rts (ts = the batch time, a fallback); hop 1 = snap + poof.
//        The partner's cursor (cx, cz) is the second hand of wind.
//   view.partner.ghost(pid, g|null)   the partner's build ghost { def, x, z, rot }
//   view.partner.online(pid, bool)    peer join/leave (offline partners are hidden)
//   view.partner.pose(pid) -> {x, z, f, a} | null
//   view.me.update(pose {x, z, f, a}) my own avatar, drawn at its true position immediately
//   view.fx.play(event, worldPos?, { by, local }?)  feedback for a domain event ({ e: 'harvested', id, ... });
//        when worldPos (tiles {x, z}) is omitted the view uses event.id's object; by/local tell own actions
//        from the partner's (party feedback)
//   view.focus(x, z)                  ease the camera to a tile (500 ms)
//   view.camera.rotate(+1|-1) / view.camera.pan(right, forward) [tiles] / view.camera.zoom(factor, ndc?) /
//        view.camera.get()            zoom(factor, ndc) keeps the ground point under ndc in place
//   view.invalidate()                 request a frame (render-on-demand)
//   view.onFrame(fn(dt, now)) -> unsubscribe   per rendered frame (client-core uses it for avatar walking)
//   view.toScreen(x, z, y = 0) -> { x, y, visible }   tile -> CSS px (DOM overlays)
//   view.stats() -> { fps, calls, triangles, tier, mode, objects, shadowRenders, weather, phase, ... }
//   view.highlight(tiles: Array<[x, z]>, style?)        drag-paint brush preview; style 'brush' | 'valid' |
//        'invalid' | 'harvest' | 'water' | '#hex'; [] clears
//   view.grid(visible: boolean)                         build mode: the grid fades in (250 ms)
//   view.objects.hidden(id, hidden: boolean)            move mode: hide the original while its ghost moves
//   view.setQuality('high'|'medium'|'low'|'auto'|'eco') / view.setMotion('full'|'reduced'|'still') /
//   view.setDayCycle('cycle'|'day'|'real')
//   view.capture() -> Promise<Blob|null>                photo mode (P): one frame at twice the resolution
// Additive (render-world, wave 1):
//   view.animals / view.avatars       render-life's views (emote, ping, highFive, pet ... for the controller)
//   view.interact()                   input happened: render the very next frame, then 60 fps for the 2 s tail
//   view.emote(pid, kind) / view.ping(pid, x, z) / view.highFive(pidA, pidB?) / view.pet(id)   social shortcuts
//   view.setWeather(kind | null)      dev / look-dev override ('rain', 'sunny', 'cloudy', 'windy')
//   view.setClock(ms | null)          dev / look-dev: show the sky of another moment (null = live)
//   view.setSeason(name | null)       dev / look-dev: 'spring' | 'summer' | 'autumn' | 'winter' (null = the calendar)
// Additive (render fixer, QA wave 1):
//   view.pick(ndc).note               the note pinned to the picked tile (a paper slip in the author's colour), if any
//   quality 'auto' (init/setQuality)  follows the GPU (timer queries), boots high unless two sessions settled lower;
//                                     an explicit 'high' | 'medium' | 'low' is honoured as asked
//   the sky's day/night runs from state.meta.createdAt (render/daynight.js skyClock): a new farm opens in morning
//   light; Golden Hour (farm.coop.golden) warms the ground, the sky and a soft vignette for its window
// Additive (render-world, wave 2: M1b):
//   view.setTool(toolId)              the tool in hand: the water pins show in full only with the Watering Can (a thirsty
//                                     field otherwise shows one small summary drop and dry soil)
//   view.pick(ndc).place / .placeArgs a tile pick on a LIVE world place: 'fair' | 'barge' | 'town' | 'restoration' (args
//                                     { id: projectId }); the controller opens that panel
//   the world places (render/world-state.js reads the M1b state): the river jetty and Captain Reed's barge (docks Monday
//   06:00, casts off Sunday 20:00, loaded crates on deck), the County Fair grounds (the medal pennant, Sunday fireworks),
//   the Hollow Village (Town Project landmarks, lit at night), the three Restoration sites (greenhouse, water mill, Stone
//   Bridge; the Hollow Meadow joins the farm), giant crops on their 3 x 3 bed, decor-set glow while placing a set piece,
//   Farm Beauty ambience (butterflies, wild flowers, sparkles grow with the score)
// Additive (render lane, mobile wave):
//   a device profile (renderer.js deviceProfile: 'desktop' | 'phone' | 'tablet') picked at init from the pointer, the
//   screen, deviceMemory and the GPU name: phones cap the pixel ratio at 1.5 (tablets 2), draw no shadow map (soft blob
//   shadows painted into the ground's footprint AO instead, ground.setBlobShadows), keep fewer tufts, particles, distant
//   trees, birds, butterflies and skinned animals, pull the zoom bands in, and never refresh shadows mid-pan; a hidden page
//   draws nothing. A desktop is unchanged.
//   touch framing (camera.js framingFor): a finger-sized default zoom, a steeper look on portrait screens, the ground scale
//   kept when the device turns, pan bounds that keep the farm in view
//   view.camera.fling(vxTiles, vzTiles)   the camera target's release velocity (world tiles/s) after a touch pan: the
//        camera glides on and eases out, stops at the land's edge, and stops for any finger, pan, zoom, turn or focus
//        (the controller measures the velocity and owns the gesture, and lifts the build ghost above the finger itself)
//   view.camera.get().fov                 the vertical FOV the camera renders with (degrees)
//   touch picking: view.pick(ndc) on a finger finds the object within ~10-16 CSS px when the exact point is bare owned
//   ground (px/pz stay the finger's own point; fences, paths and plain decor are no finger targets); the hover lift
//   and the wind of the hand settle when the finger lifts
//   view.setPointer('touch' | 'mouse' | 'pen')   optional: the input lane may state the pointer kind (the view also
//   watches pointer events itself); view.touch -> { radii } the finger rings
//   resize and orientation without a reload (ResizeObserver, visualViewport, orientationchange, a DPR change); a lost
//   WebGL context pauses the loop and resumes when the browser restores it (a reload is the last resort, at most one
//   every two minutes, after 10 visible seconds without a restore)
//   view.setInsets({ top, right, bottom, left } | null)   CSS px of each edge the HUD covers (ui.layout.insets()): view.focus
//        puts its point in the middle of the free part of the screen
//   view.stats() adds { profile, gpu, pixelRatio, buffer, contextLost, glides }
// Additive (render-world, wave 3: M2):
//   the M2 land (render/land-features.js): each expansion from Bee Glade on reveals its feature beside its parcel (the
//   Willow Pond with its fishing dock, the riding track and horse-show ring, the picnic clearing, the olive terraces,
//   the red maple ridge and its lookout, Sunset Hill's crest, the goat rocks, the oak edge, the ribbon shelf) and its
//   own ground (clover, poppies, pebbles, maple leaves, mushrooms); the village's Town Projects 5-24 and the Festival
//   Pavilion's tiers; Restoration 4-6 on the farm (the Orchard Pond's windpump, the Fair Grounds, Grandma's
//   farmhouse); Grandma's visit (her taxi at the gate, then one stroll stop an hour: porch, field, orchard, barnyard,
//   bench; the parlour and the nights in the room); the decor Fishing Dock's own little pool
//   view.pick(ndc).place adds 'fishing' (the Willow Pond's dock) and 'horseshow' (the Stable Paddock's ring)
//   view.interior                     the farmhouse interior (render/interior-view.js), a scene of its own:
//     .live() -> bool                 Restoration 6 is done (the room can be entered)
//     .enter() -> Promise<void>       draw the room instead of the farm (the farm's DOM labels hide); .exit(); .active
//     .pick(ndc) -> { kind: 'floor', x, z, inside } | { kind: 'item', id, def, cell? } | { kind: 'spot', id, item?, cell? }
//                   | { kind: 'wall', wall: 'back' | 'left', at, cell? } | null      (content INTERIOR: 1 m cells, wall slots)
//                                     spots: door (leave), fire, memory_wall, window (the shell's fixed pieces; `item` = the
//                                     rules id), grandma (her visit); `cell` = the floor cell under the pointer
//     .ghost(defId | null, { x, z, rot } | { wall, at } | null, valid?)   the furniture placement preview
//     .setPresent(pids)               who is inside (default: only me)   .toScreen(x, y, z) metres -> CSS px
//     while inside, view.pick returns null and view.camera.rotate / zoom turn and zoom the room's camera
// Additive (render lane, wave 4: the owners' wish list 2026-10-04):
//   view.camera.orbit(dYawRad, dPitchRad)   wish H: turn the view freely and tilt it (30-85 degrees, near top-down);
//   view.camera.resetOrbit()                back to the nearest quarter turn and the zoom's own pitch (eased)
//        view.camera.get() adds { pitch, tilt, tilted }; the yaw and tilt are remembered per device (hh.camera)
//   view.objects.doors(id, open = true) -> boolean   wish 8: the Barn's doors swing open (and shut again by themselves
//        after 8 s, or on doors(id, false)); false when the object has no doors
//   view.pick(ndc).weed                     wish F: an owned tile whose wild tufts (weeds) the Hand can pull; view.weedAt(x, z)
//   view.pick(ndc).asleep                   wish 4: a pet pick while it sleeps (late dusk to dawn, at its Dog House /
//        Cat Basket, else the farmhouse steps, with a 💤)
//   view.stats() adds { rain, rainStrength, wet, puddle, rainbow, nightLights }   the shower (0..1; strength: a drizzle
//        ~0.45, a downpour 1, gusting), the ground's wetness and puddles, a rainbow after some showers; the lamps lit
//   view.setWeather('rainbow')              look-dev: the sky just after a shower, with its rainbow
//   upgrade tiers (wish E, objects[id].up) draw `<key>:<tier>`; pet breeds (wish 6, players[pid].pet.breed) their own
//   model; Fertilizer (wish 2, crop.fert) a rich green-gold loam and a fuller crop; the Rabbit Hutch and rabbits
//   (wish 3); lamps, lanterns and lit windows light the night (wish 11); the rain (wish 12); bird baths (wish 10)
// Additive (render lane, wave 4b: the owners' wish list 2026-10-05):
//   view.pick(ndc).crate                    wish 1: a landed balloon loot crate (an object pick; also by its tile) the
//        controller opens (rules openCrate {id}); render/crates-view.js draws its fall from the balloon under a parachute
//        (server time: both screens), its hop, and on crateOpened the shake, the lid, the loot's flights (`auto`: a poof)
//   homes grow (wish 3): a grown home draws `home:<id>:g<t>` over the rules' objFootprint (picking, the ground, animals'
//        yards, a moved home's ghost: view.ghost.show reads the hidden original's size by itself)
//   trees age (wish 4): the age stage's size (content TREE_AGE), a spring and a leaf burst on treeAged
//   relics (wish 2): the Golden Sprinkler's turning head and water, the Growth Totem's breath, the Rainbow Tree, the Golden
//        Barn's cupola; wateredAll / farmhandDone gather the per-crop / per-animal events of their moment into one wave;
//        timeTurned swirls over each workshop; a blue ribbon while the farm owns the Lucky Clover adds its clover
//   bird baths (wish 6): visitors come now and then, sip, bathe, shake and fly off (render/birdbath-view.js)
//   view.portrait(spec) -> Promise<url|null>   (hud lane, render/portrait.js): a farmer's portrait drawn with this renderer
import * as THREE from 'three';
import { TILE_M } from '../../../shared/content/config.js';
import { defOf } from '../../../shared/content/index.js';
import { seasonOf } from '../../../shared/rules/calendar.js';
import { createRenderer, startLoop, noteAutoTier, applyTier, createAutoTier, createIntervalTier, createGpuTimer, QUALITY, LOOP, WANT,
  qualityOf, deviceProfile, bootTier, gpuName } from './renderer.js';
import { createScene, buildBackdrop } from './scene.js';
import { createCamera, CAM } from './camera.js';
import { createGround, addOcclusionFade, cheapShadows, OCCLUSION, GROUND_BOOT } from './ground.js';
import { createObjectsView, homeTier } from './objects-view.js';
import { createPicker, pickNear, TOUCH_PICK } from './picking.js';
import { createGhost } from './ghost.js';
import { createBadges } from './badges.js';
import { createLod } from './lod.js';
import { createBatch } from './instancing.js';
import { createDayNight } from './daynight.js';
import { createWeather, setWeatherSource } from './weather.js';
import { weatherAt as rulesWeatherAt } from '../../../shared/rules/time.js';
import { updateTweens, isAnimating } from './tweens.js';
import { WORLD, SEASON_INDEX, cursors, addSway, addFoliageTint } from './world-uniforms.js';
import { models, LOOK, addShaderPatch, LAMP_N } from './models.js';
import { initIcons } from './icons.js';
import { createAvatarsView } from './avatars-view.js';
import { createAnimalsView } from './animals-view.js';
import { createFx } from './fx.js';
import { createAmbientLife } from './ambient-life.js';
import { skyClock } from './daynight.js';
import { createRiver } from './river.js';
import { createBargeView } from './barge-view.js';
import { createFair } from './fair-view.js';
import { createTown } from './town-view.js';
import { createRestoration } from './restoration-view.js';
import { createLandFeatures, dockSeats } from './land-features.js';
import { createInterior } from './interior-view.js';
import { createGrandmaVisit } from './grandma-view.js';
import * as worldState from './world-state.js';
import { createBirdBaths } from './birdbath-view.js';
import { createCrates } from './crates-view.js';
import { drawPortrait } from './portrait.js';

// The rules own the weather (rain waters crops, GDD §5.10): the sky draws exactly what the rules decide, including a
// new farm's sunny first hours (the rules read the farm's creation time, shared/rules/time.js FRESH_SUNNY_HOURS).
setWeatherSource((seed, hour) => rulesWeatherAt(seed, hour, R?.state?.meta?.createdAt));

let R = null;            // internals, created by init()
let dirty = true;
const frameFns = new Set();
const v3 = new THREE.Vector3();
const BASE_WIND = WORLD.uWind.value;
const TREE_EVENTS = new Set(['picked', 'shaken', 'treeHarvested', 'chopped']);
// wave 4b: the per-target events a mass action emits, and the action's own event that closes the moment
const MASS = new Set(['watered', 'wateredAll', 'farmhandDone', 'fed', 'collected']);
const MASS_HEADS = new Set(['wateredAll', 'farmhandDone']);

function toScreenM(mx, mz, my = 0) {
  if (!R) return { x: 0, y: 0, visible: false };
  v3.set(mx, my, mz).project(R.cam.camera);
  const r = R.rect;
  return { x: (v3.x * 0.5 + 0.5) * r.width + r.left, y: (-v3.y * 0.5 + 0.5) * r.height + r.top, visible: v3.z < 1 && Math.abs(v3.x) <= 1.1 && Math.abs(v3.y) <= 1.1 };
}

const call = (obj, name, ...args) => (obj && typeof obj[name] === 'function' ? obj[name](...args) : undefined);

function goldenWindow(state, now) {
  const f = state && state.farm;
  // rules-goals keeps the window in farm.coop.golden = { from, until }
  const g = f && (f.coop?.golden || f.buffs?.goldenHour || f.goldenHour);
  if (!g || typeof g !== 'object') return 0;
  const from = Number.isFinite(g.from) ? g.from : Number.isFinite(g.at) ? g.at : -Infinity;
  const until = Number.isFinite(g.until) ? g.until : Number.isFinite(g.endsAt) ? g.endsAt : -Infinity;
  if (now < from || now > until) return 0;
  // 20 s fades at both ends
  return Math.min(1, (now - from) / 20000, (until - now) / 20000);
}

/** Half-size (m) of the shadow box for a camera distance (pure, tested): it covers the visible ground (RD-13). */
export function shadowHalf(dist) {
  return Math.min(75, Math.max(24, 0.52 * dist + 9));
}

/** The environment a device profile is read from (mobile wave). */
function readEnv() {
  const mm = (q) => { try { return typeof matchMedia === 'function' && matchMedia(q).matches; } catch { return false; } };
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const scr = typeof screen !== 'undefined' ? screen : {};
  return { coarse: mm('(pointer: coarse)'), fine: mm('(any-pointer: fine)'), touchPoints: nav.maxTouchPoints || 0,
    w: scr.width || (typeof innerWidth === 'number' ? innerWidth : 1366), h: scr.height || (typeof innerHeight === 'number' ? innerHeight : 768),
    memory: Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : null, cores: Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null };
}

/** The zoom-band distance (mobile wave): a touch screen's distance in desktop terms (the same ground scale on a
 *  768 px tall view), pulled in by the profile's lodK; a desktop uses the camera distance as before. Pure (tested). */
export function lodDistance(dist, { kind = 'desktop', lodK = 1, cssH = 768 } = {}) {
  if (kind === 'desktop' || !(cssH > 0)) return dist;
  return (dist * (768 / cssH)) / (lodK || 1);
}

/** A ring hit a finger may snap to (mobile wave): not a fence, a path or plain decor (a tap beside them walks). */
function fingerTarget(q) {
  if (q.kind !== 'object') return true;
  const o = R && R.state && R.state.farm.objects[q.id];
  const d = o ? defOf(o.def) : null;
  if (!d) return true;
  return d.kind !== 'decor' || d.effect?.seats !== undefined;      // a bench is a seat: tap beside it to sit
}

export const view = {
  async init(canvas, { quality = 'high', now = () => Date.now(), overlay = document.body } = {}) {
    try { await models.init(); } catch (err) { console.error('model manifest unavailable: placeholders only', err); }
    initIcons().catch(() => {});
    // 'auto' boots high unless two sessions in a row settled lower (MSAA can only be chosen now); an explicit
    // tier (?quality=high|medium|low, a slow partner PC) is respected as asked (performance-09)
    // mobile wave: a touch device gets a profile (phone / tablet) and boots no higher than its GPU allows; the GPU name
    // needs a context, so the first guess (MSAA is chosen at creation) comes from the screen and memory alone
    const env = readEnv();
    let profile = deviceProfile(env);
    const tierName = QUALITY[quality] ? quality : bootTier('auto', profile);
    const dev = typeof location !== 'undefined' && /[?&]dev(=1)?(&|$)/.test(location.search);
    // look-dev only (a ?dev build): ?preview=M2 draws a later milestone's land and places before the content flips; the
    // game never sets it, so nothing unsupported is reachable
    const preview = dev ? /[?&]preview=(M1b|M2|M3)(&|$)/.exec(location.search) : null;
    if (preview) {
      const order = ['M1a', 'M1b', 'M2', 'M3'];
      const upto = order.indexOf(preview[1]);
      worldState.setLivePredicate((d) => !d || !d.m || order.indexOf(d.m) <= upto);
    }
    const { renderer, tier: tier0 } = createRenderer(canvas, tierName, { dev, kind: profile.kind });
    const gpu = gpuName(renderer);
    if (profile.kind !== 'desktop') profile = deviceProfile({ ...env, gpu });
    const tier = QUALITY[quality] ? tier0 : bootTier('auto', profile);
    const q0 = qualityOf(tier, profile.kind);
    const { scene, layers, sun, hemi, sky, fireflies } = createScene();
    if (profile.kind !== 'desktop') applyTier(renderer, sun, tier, profile.kind);
    // the decorative world and the farm's outer fence share one static batch
    const sceneryMat = models.createMaterial();
    sceneryMat.shadowSide = THREE.BackSide;   // closed crowns and rocks: no self-shadow acne (visual-16)
    addShaderPatch(sceneryMat, 'hh-shadow2', cheapShadows, 'v1');   // and no noisy weave on their terminators
    addSway(sceneryMat, { stiffness: 1.4, push: 0.6 });
    addFoliageTint(sceneryMat, { autumn: 1 });
    const occMap = { value: null };          // the ground map, once the ground exists (below)
    addOcclusionFade(sceneryMat, occMap);
    // the near forest edge and the overgrown land for sale cast shadows; the far forest ring never does (it is
    // outside the shadow box almost always, and a shadow refresh drew it all: performance-03)
    const scenery = createBatch({ name: 'scenery', material: sceneryMat, instances: 2048, vertices: 1 << 18, castShadow: true, receiveShadow: true });
    const sceneryFar = createBatch({ name: 'sceneryFar', material: sceneryMat, instances: 2048, vertices: 1 << 17, castShadow: false, receiveShadow: true });
    // RD-13 (QA wave 2: a 27.7 ms shadow refresh on the L25 farm): the forest rows behind the wall (8-20 m out) and the
    // reeds draw in the near band but cast no shadow; only the wall, the overgrowth and the world places do
    const sceneryMid = createBatch({ name: 'sceneryMid', material: sceneryMat, instances: 2048, vertices: 1 << 17, castShadow: false, receiveShadow: true });
    layers.terrain.add(scenery.mesh, sceneryMid.mesh, sceneryFar.mesh);
    const ground = createGround(layers, { scenery, quality: q0.tufts });
    occMap.value = ground.uniforms.uGroundMap.value;
    const backdrop = buildBackdrop(scenery, { quality: q0.scenery, far: sceneryFar, mid: sceneryMid });
    const cam = createCamera(undefined, { touch: profile.kind !== 'desktop', kind: profile.kind });
    const badges = createBadges(layers.badges);
    const objects = createObjectsView(layers, { badges, now });
    const life = createAmbientLife(layers, { now, overlay });
    const avatars = createAvatarsView(layers, overlay, (x, z, y) => toScreenM(x * TILE_M, z * TILE_M, y));
    call(avatars, 'setNow', now);
    const animals = createAnimalsView(layers, overlay, toScreenM, { now });
    const fx = createFx(layers.fx, overlay, toScreenM);
    // wave 4 (owner wish 10): the bird baths' water ripples and their visitors (one instanced draw for all of them)
    const baths = createBirdBaths({ layer: layers.fx, fx });
    objects.setFx(fx);
    ground.setFx(fx);
    // wave 4: roofs and canopies near the view drip in the rain (the picking proxies are their boxes)
    call(fx, 'setEaves', () => (R ? (R.proxyBoxes || (R.proxyBoxes = objects.proxies())) : null));
    life.setFx(fx);
    // Golden Hour's hearts gather round the farmers (render-life's avatar poses, tiles -> metres)
    call(life, 'setFarmers', () => {
      const out = [];
      for (const pid of Object.keys(R?.state?.players || {})) {
        const p = call(avatars, 'poseOf', pid);
        if (p && Number.isFinite(p.x)) out.push({ x: p.x * TILE_M, z: p.z * TILE_M });
      }
      return out;
    });
    call(animals, 'setFx', fx);
    call(avatars, 'setFx', fx);
    call(fx, 'setQuality', q0.particles);
    call(life, 'setQuality', q0.life);
    call(animals, 'setSkinnedMax', q0.skinned);
    call(avatars, 'setTargetLocator', (id) => {
      const p = objects.worldPosOf(id) || call(animals, 'positionOf', id);
      return p ? { x: p.x / TILE_M, z: p.z / TILE_M } : null;
    });
    call(fx, 'setLocator', (pid) => call(avatars, 'screenPosOf', pid) || null);
    const ghost = createGhost(layers.ui3d, { smooth: true });
    // The world places (wave 2): static parts in the scenery batches, moving parts (the barge, its crates, the mill
    // wheel) in one small dynamic batch that costs a draw call only while something of it is in view
    const dynMat = models.createMaterial({ side: THREE.DoubleSide });
    addSway(dynMat, { stiffness: 1.2, push: 0.4 });
    const dyn = createBatch({ name: 'worldDyn', material: dynMat, instances: 32, vertices: 1 << 16, castShadow: false, receiveShadow: true });
    layers.objects.add(dyn.mesh);
    // wave 4b (owner wish 1): the balloon's loot crates fall, wait and open in the same dynamic batch (no draw of their own)
    const crates = createCrates({ dyn, fx });
    const wctx = { scenery, glows: objects.glows, fx };
    const river = createRiver(wctx);
    const land = createLandFeatures({ ...wctx, mid: sceneryMid });
    const world = [river, createBargeView({ dyn, fx, mooring: river.mooring }), createFair({ ...wctx, dyn }), createTown({ ...wctx, scenery: sceneryFar }),
      createRestoration({ ...wctx, dyn }), land, createGrandmaVisit({ layers, dyn, scenery, fx })];
    for (const b of [scenery, sceneryFar]) b.onChange(() => { if (R) { R.shadowDirty = true; R.cullDirty = true; } dirty = true; });
    sceneryMid.onChange(() => { if (R) R.cullDirty = true; dirty = true; });
    let proxyCache = null;
    objects.onStaticChange(() => { proxyCache = null; if (R) { R.proxyBoxes = null; R.shadowDirty = true; R.cullDirty = true; } });
    // RD-13 (QA wave 2: a 27.7 ms static shadow refresh on the L25 farm): the shadow map is drawn in a pass of its own
    // (renderShadows below) from the buildings' far-band twins, which live only in this scene
    const shadowScene = new THREE.Scene();
    shadowScene.add(objects.batches.shadowTwins.mesh);
    objects.batches.shadowTwins.onSwap(() => { if (R) R.shadowDirty = true; dirty = true; });
    objects.batches.shadowTwins.onChange(() => { if (R) R.shadowDirty = true; });
    const pick = createPicker(cam.camera, {
      // a landed loot crate is a pick target too (only while one is on the farm: no allocation otherwise)
      proxies: () => { const p = proxyCache || (proxyCache = objects.proxies()); const c = crates.proxies(); return c.length ? p.concat(c) : p; },
      animals: () => call(animals, 'pickables') || [],
      ground,
      places: () => world.flatMap((m) => m.places()),
    });
    const daynight = createDayNight({ scene, sun, hemi, sky, renderer, look: LOOK });
    const weather = createWeather();
    const lod = createLod();
    const gpuTimer = createGpuTimer(renderer);
    const auto = gpuTimer ? createAutoTier(tier) : createIntervalTier(tier);
    const motionPref = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
    R = {
      renderer, scene, layers, sun, hemi, sky, fireflies, cam, ground, scenery, sceneryFar, objects, avatars, animals, fx, ghost, badges, pick, world, dyn, worldState, land, baths, crates,
      daynight, weather, lod, auto, gpuTimer, life, canvas, now, state: null, me: null, fps: 0, frames: 0, fpsAt: 0, lastFed: 0, calm: 1,
      lastCam: null, cullDirty: true, duets: new Map(), staticBatches: [scenery, sceneryMid, sceneryFar, objects.batches.trees, objects.batches.statics, objects.batches.smalls],
      tier, tierMode: QUALITY[quality] ? 'fixed' : 'auto', motion: motionPref, dayMode: 'cycle', clockOverride: null,
      rect: canvas.getBoundingClientRect(), shadowDirty: true, shadowRenders: 0, shadowFit: null, camMoving: false,
      skyAt: 0, sky0: null, wx: null, blocker: null, partnerOn: new Map(), seasonAt: 0, seasonOverride: null, season: null, mode: 0, backdrop,
      lastPick: null, inputAt: 0, loop: null, eco: false,
      profile, gpu, q: q0, autoGpu: Boolean(gpuTimer), cssW: 0, cssH: 0, ptrType: 'mouse', touches: new Set(), clearAt: null, lost: 0, contextLost: false, glides: 0,
      shadowScene, shadowRT: new THREE.WebGLRenderTarget(1, 1), nullCam: (() => {
        // a camera that sees nothing (below the world, looking down): the shadow pass's own main pass culls everything
        const c = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2);
        c.position.set(0, -5000, 0); c.lookAt(0, -6000, 0); c.updateMatrixWorld();
        return c;
      })(),
    };
    /** Draw the static shadow map now, in its own pass: the sun and the casters (the scenery wall, the farm's trees,
     *  the buildings' shadow twins) visit the shadow scene, render into a 1 x 1 target with a camera that sees
     *  nothing (so only the shadow pass costs), then go home. */
    R.renderShadows = () => {
      const movers = [sun, sun.target, scenery.mesh, objects.batches.trees.mesh];
      const parents = movers.map((o) => o.parent);
      for (const o of movers) shadowScene.add(o);
      for (const b of R.staticBatches) b.mesh.perObjectFrustumCulled = true;
      objects.batches.shadowTwins.mesh.perObjectFrustumCulled = true;
      renderer.shadowMap.needsUpdate = true;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(R.shadowRT);
      renderer.render(shadowScene, R.nullCam);
      renderer.setRenderTarget(prev);
      renderer.shadowMap.needsUpdate = false;
      movers.forEach((o, i) => { if (parents[i]) parents[i].add(o); else shadowScene.remove(o); });
    };
    this.setMotion(motionPref);
    this._watchViewport(canvas);
    this._watchPointer(canvas);
    this._watchContext(canvas);
    // scenery and the first shadow pass once the backdrop models arrive
    scenery.onSwap(() => { R.shadowDirty = true; dirty = true; });
    R.loop = startLoop({
      renderer,
      // at rest (qa2 CL-03): ambient that travels at most LOOP.restFps, slow ambient alone at LOOP.calmFps, and a frame
      // every 500 ms after LOOP.idleMs without input; the loop sleeps between far-apart frames
      ambientFps: () => Math.min(LOOP.restFps, R.eco ? 20 : QUALITY[R.tier].ambientFps),
      interactiveFps: () => (R.eco ? 30 : 60),
      calmFps: () => LOOP.calmFps,
      idleMs: LOOP.idleMs,
      napMs: LOOP.napMs,
      want: (dt, t) => this._tick(dt, t),
      isDirty: () => dirty,
      clearDirty: () => { dirty = false; },
      frame: (dt, t, mode) => {
        R.mode = mode;
        // mobile profiles never redraw the shadow map while the camera moves: it waits for the rest (RD-13's cost)
        const shadow = !R.inside && R.shadowDirty && sun.castShadow && (R.q.panShadows || !R.camMoving);
        if (shadow) {
          R.shadowDirty = false;
          R.shadowRenders++;
          const ts = performance.now();
          R.renderShadows();
          R.shadowMs = performance.now() - ts;
          R.shadowTris = renderer.info.render.triangles;
        }
        // the static batches keep last frame's culled draw list while the camera rests (performance-17: three
        // re-culled ~1,100 instances and re-uploaded their indirect textures every render); any camera move, a
        // placement or move, and every shadow refresh (its own camera) culls again
        const cm = cam.camera.matrixWorld.elements; const pm = cam.camera.projectionMatrix.elements;
        let same = R.lastCam !== null && !R.cullDirty && !shadow;
        for (let i = 0; same && i < 16; i++) if (cm[i] !== R.lastCam[i] || pm[i] !== R.lastCam[16 + i]) same = false;
        if (!R.lastCam) R.lastCam = new Float64Array(32);
        for (let i = 0; i < 16; i++) { R.lastCam[i] = cm[i]; R.lastCam[16 + i] = pm[i]; }
        R.cullDirty = false;
        for (const b of R.staticBatches) b.mesh.perObjectFrustumCulled = !same;
        // the auto tier measures the GPU, never the frame interval (performance-09); shadow refreshes are rare
        // one-offs and do not count
        const timer = R.gpuTimer;                // re-created after a context restore
        const timed = R.tierMode === 'auto' && timer && !shadow;
        if (timed) timer.begin();
        if (R.inside) renderer.render(R.interior.scene, R.interior.camera);
        else renderer.render(scene, cam.camera);
        if (timed) timer.end(t);
        R.frames++;
        if (t - R.fpsAt >= 1000) { R.fps = Math.round((R.frames * 1000) / (t - R.fpsAt)); R.frames = 0; R.fpsAt = t; }
        for (const fn of frameFns) fn(dt, now());
        if (R.tierMode === 'auto') this._feedAuto(t, mode);
      },
    });
    // Shader warm-up (performance-06): every lazily created material exists (hidden) and compiles now, in
    // parallel where the browser can (KHR_parallel_shader_compile), instead of stalling the first harvest.
    this._warmup();
  },

  async _warmup() {
    const { fx, ghost, renderer, scene, cam } = R;
    try {
      call(fx, 'warmup', true);
      const hold = call(ghost, 'warmup', true);
      const extra = [call(R.avatars, 'warmup'), call(R.animals, 'warmup'), call(R.life, 'warmup'), call(R.baths, 'warmup'), call(R.crates, 'warmup')].flat().filter(Boolean);
      if (typeof renderer.compileAsync === 'function') await renderer.compileAsync(scene, cam.camera);
      for (const o of extra) if (o && o.removeFromParent) o.removeFromParent();
      void hold;
    } catch (err) {
      console.warn('shader warm-up failed (shaders compile on first use instead)', err);
    } finally {
      call(fx, 'warmup', false);
      call(ghost, 'warmup', false);
      dirty = true;
    }
  },

  /** Feed finished GPU timer results (or, without the extension, interactive frame intervals) to the auto tier. */
  _feedAuto(t, mode) {
    let changed = null;
    if (R.gpuTimer) {
      for (const [ms, at] of R.gpuTimer.poll()) {
        const dt = R.lastFed ? (at - R.lastFed) / 1000 : 0;
        R.lastFed = at;
        changed = R.auto.feed(ms, dt) || changed;
      }
    } else if (mode === 2 && !R.autoGpu) {
      const dt = R.lastFed ? (t - R.lastFed) / 1000 : 0;
      if (R.lastFed && dt < 0.1) changed = R.auto.feed(t - R.lastFed, dt);
      R.lastFed = t;
    }
    if (changed) { noteAutoTier(changed); this.setQuality(changed, { keepMode: true }); }
  },

  /** A gentle rainbow (wave 4, owner wish 12): after some showers, by day, an arc standing over the far fields facing
   *  the camera (one transparent ring, drawn only while it shows; buildings and trees stand in front of it). */
  _rainbow(wx) {
    const day = R.sky0 ? 1 - R.sky0.night : 1;
    const k = (wx.rainbow || 0) * Math.max(0, day * 1.4 - 0.4) * (R.inside ? 0 : 1);
    if (!(k > 0.01)) { if (R.rainbow) R.rainbow.visible = false; return; }
    if (!R.rainbow) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false, uniforms: { uK: { value: 0 } },
        vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
        fragmentShader: `uniform float uK; varying vec3 vP;
          vec3 bow( float t ) { return clamp( vec3( abs( t * 6.0 - 3.0 ) - 1.0, 2.0 - abs( t * 6.0 - 2.0 ), 2.0 - abs( t * 6.0 - 4.0 ) ), 0.0, 1.0 ); }
          void main() {
            float r = length( vP.xy ); float t = clamp( ( r - 0.88 ) / 0.12, 0.0, 1.0 );
            float a = atan( vP.y, vP.x ) / 3.14159265;
            float edge = smoothstep( 0.0, 0.2, t ) * smoothstep( 1.0, 0.8, t ) * smoothstep( 0.04, 0.3, a ) * smoothstep( 0.96, 0.7, a );
            gl_FragColor = vec4( mix( bow( 1.0 - t ) * 0.95, vec3( 1.0 ), 0.2 ), uK * 0.24 * edge );
          }`,
      });
      R.rainbow = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 72, 1, 0, Math.PI), mat);
      R.rainbow.frustumCulled = false;
      R.rainbow.renderOrder = 3;
      R.layers.fx.add(R.rainbow);
    }
    // the farm camera never sees the horizon: the arc stands in the view itself, at 90 % of the way to the target, its
    // crown a little below the top of the screen (nearer things stand in front of it, the far fields show through it)
    const cam = R.cam.camera; const c = R.cam.get();
    const D = c.dist * 0.9; const halfH = D * Math.tan((cam.fov / 2) * Math.PI / 180); const halfW = halfH * cam.aspect;
    const rad = Math.max(halfW * 1.08, halfH * 1.5);
    const fwd = R.rbF || (R.rbF = new THREE.Vector3()); const upv = R.rbU || (R.rbU = new THREE.Vector3());
    fwd.set(0, 0, -1).applyQuaternion(cam.quaternion); upv.set(0, 1, 0).applyQuaternion(cam.quaternion);
    R.rainbow.position.copy(cam.position).addScaledVector(fwd, D).addScaledVector(upv, halfH * 0.8 - rad);
    R.rainbow.quaternion.copy(cam.quaternion);
    R.rainbow.scale.setScalar(rad);
    R.rainbow.material.uniforms.uK.value = k;
    R.rainbow.visible = true;
  },

  /** The bird baths' per-tick options (one reused object: no garbage per tick). */
  _bathOpts(c, wx) {
    const o = R.bathOpts || (R.bathOpts = { night: 0, rain: 0, motion: 'full', focus: { x: 0, z: 0 } });
    o.night = R.sky0 ? R.sky0.night : 0; o.rain = wx.rain; o.motion = R.motion; o.focus.x = c.tx; o.focus.z = c.tz;
    return o;
  },

  /** The crates' per-tick options (one reused object). */
  _crateOpts() {
    const o = R.crateOpts || (R.crateOpts = { motion: 'full' });
    o.motion = R.motion;
    return o;
  },

  /** One loop step before a possible render: advance everything, return the frame mode wanted (0|1|2). */
  _tick(dt, t) {
    const now = R.clockOverride ?? R.now();
    const motionK = R.motion === 'full' ? 1 : R.motion === 'reduced' ? 0.45 : 0;
    WORLD.uTime.value = t / 1000;
    updateTweens(t / 1000);                     // render-life's shared tween clock (pops, springs, flights)
    // weather + sky (sky colours four times a second; they change over minutes)
    // the weather is a function of the farm seed: nothing to show (sunny, dry) until the state arrived
    const wx = R.state ? R.weather.update(now, dt, { farmSeed: R.state.meta.farmSeed }) : { kind: 'sunny', rain: 0, wet: 0, cloud: 0.15, wind: 1 };
    R.wx = wx;
    WORLD.uWet.value = wx.wet;
    R.objects.setRaining(wx.kind === 'rain');
    // the calm, tidy board (GDD visual-ux §3.8, RD-40): once nothing is ripe, hungry or dry, the farm breathes
    // slower (0.6x sway) and the glints and bubbles are gone
    const need = R.objects.needs();
    const calm = need.ready + need.water + (call(R.animals, 'needs') || 0) === 0 && R.state ? 0.6 : 1;
    R.calm += (calm - R.calm) * Math.min(1, dt * 1.5);
    WORLD.uWind.value = BASE_WIND * wx.wind * motionK * R.calm;
    // sky colours change over minutes: 4 updates a second, or one every 5 s when the player asked for Still
    if (t - R.skyAt > (R.motion === 'still' ? 5000 : 250) || !R.sky0) {
      R.skyAt = t;
      // Golden Hour is a real farm event (farm.coop.golden), on the server clock even while look-dev shows
      // another sky moment
      const gold = goldenWindow(R.state, R.now());
      WORLD.uGold.value = gold;
      const localHour = new Date(now).getHours() + new Date(now).getMinutes() / 60;
      // every farm's first evening opens in morning light: the cycle runs from the farm's birth (RD-04)
      const skyNow = R.clockOverride ?? skyClock(now, R.state?.meta?.createdAt);
      const { sunMoved } = R.daynight.update(skyNow, { mode: R.dayMode, localHour, gold, weather: { rain: wx.rain, cloud: wx.cloud } });
      const s = R.daynight.current;
      R.sky0 = s;
      // a phone or tablet without a shadow map: soft blob shadows painted beside tall objects (a desktop never)
      if (R.profile.kind !== 'desktop') R.ground.setBlobShadows(R.sun.castShadow ? null : s.sunDir);
      WORLD.uNight.value = s.night;
      R.fireflies.visible = s.night > 0.02 && R.motion !== 'still';
      R.ground.setHaze(s.fog);
      R.ground.setCloud(0.25 + wx.cloud * 0.55);
      call(R.life, 'setSky', s, wx, gold);
      // night water is deep blue under the moon, never the brightest thing on screen (visual-after D3)
      const wn = 1 - 0.5 * s.night;
      R.ground.water.setLight([(0.55 + 0.45 * s.sunI / 2.8) * wn * 0.9, (0.58 + 0.42 * s.sunI / 2.8) * wn * 0.95, (0.7 + 0.3 * s.sunI / 2.8) * wn]);
      R.sky.uniforms.uCloud.value = 0.3 + wx.cloud * 0.7;
      // rings round the jetty's piles and the barge's hull (RD-10)
      R.ground.water.setRipples(R.world.flatMap((m) => (typeof m.ripples === 'function' ? m.ripples() : [])));
      call(R.animals, 'setNight', s.night);
      call(R.avatars, 'setNight', s.night, s);            // wave 4: pets sleep from late dusk to dawn
      if (sunMoved) { this._fitShadow(true); }
      dirty = true;
    }
    if (t - R.seasonAt > 60000 || !R.seasonAt) {
      R.seasonAt = t;
      const tz = R.state?.meta?.tz || 'Europe/Sofia';
      let season = R.seasonOverride;
      if (!season) { try { season = seasonOf(now, tz); } catch { season = 'summer'; } }
      WORLD.uSeason.value = SEASON_INDEX[season] ?? 1;
      R.season = season;
    }
    // In winter the rain falls as snow (GDD §5.10; cosmetic: the rules still water)
    const snowing = R.season === 'winter';
    // wave 4 (owner wish 12): a drizzle or a downpour (wx.strength), a near layer of drops between the camera and the
    // farm, the wind's slant; puddles that fill and dry, rings on them; a rainbow after some showers (by day)
    const cp = R.cam.camera.position;
    const ct = R.lastCamGet || R.cam.get();
    R.rainNear = (R.rainNear || new THREE.Vector3()).set(cp.x + (ct.tx - cp.x) * 0.35, cp.y * 0.65, cp.z + (ct.tz - cp.z) * 0.35);
    const wd = WORLD.uWindDir.value; const sl = 0.1 + 0.16 * Math.max(0, wx.wind - 1);
    const ro = R.rainOpts || (R.rainOpts = { strength: 1, near: R.rainNear, wind: { x: 0, z: 0 } });     // reused: no garbage per tick
    ro.strength = wx.strength ?? 1; ro.wind.x = wd.x * sl; ro.wind.z = wd.y * sl;
    call(R.fx, 'rain', snowing ? 0 : wx.rain * (R.motion === 'still' ? 0 : 1), ro);
    call(R.ground, 'setRain', snowing ? 0 : wx.puddle ?? 0, snowing || R.motion === 'still' ? 0 : wx.rain);
    this._rainbow(wx);
    call(R.animals, 'setWeather', snowing ? 1 : wx.rain);       // bees stay in their hives in rain and snow
    if (snowing && wx.rain > 0.01 && R.motion !== 'still') {
      R.snowAcc = (R.snowAcc || 0) + dt * 45 * wx.rain;
      const c0 = R.cam.get();
      for (; R.snowAcc >= 1; R.snowAcc -= 1) {
        v3.set(c0.tx + (Math.random() - 0.5) * 70, 14 + Math.random() * 6, c0.tz + (Math.random() - 0.5) * 70);
        call(R.fx, 'burst', 'snow', v3, { n: 1, speed: 0.35, up: -1.1, grav: 0.015, life: 9, size: 0.2, spread: 0, spin: 1, y: 0, ambient: true });
      }
    }
    for (const [id, until] of R.duets) if (R.now() > until) { R.duets.delete(id); R.objects.marker(id, 'duet', false); }
    const cursorMoving = cursors.update(dt);
    const camWant = R.cam.update(dt);
    const c = R.cam.get();
    R.lastCamGet = c;                          // the rain's near layer reads last tick's target (no second get())
    // shadow frustum: refit when a camera move ends (tech §10.9), or early when the view wandered far
    if (camWant === 2) {
      R.camMoving = true;
      OCCLUSION.moving.value = 1;
      if (R.q.panShadows && R.shadowFit && Math.hypot(c.tx - R.shadowFit.x, c.tz - R.shadowFit.z) > R.shadowFit.half * 0.45) this._fitShadow();
    } else if (R.camMoving) { R.camMoving = false; OCCLUSION.moving.value = 0; this._fitShadow(); }
    // wave 4 (owner wish 11): the lamps nearest the view light their surroundings at night (models.js LAMPS)
    this._lamps(c);
    const band = R.lod.update(lodDistance(c.dist, { kind: R.profile.kind, lodK: R.q.lodK, cssH: R.cssH }));
    if (band) { R.objects.setBand(band); R.ground.setBand(band); }
    // per instance: buildings and crops beyond the far band's distance of the eye draw their twins (wave 3, §8.6)
    if (call(R.objects, 'setEye', R.cam.camera.position, lodDistance(1, { kind: R.profile.kind, lodK: R.q.lodK, cssH: R.cssH }))) dirty = true;
    call(R.animals, 'setFocus', c.tx, c.tz, c.dist);
    call(R.fx, 'setFocus', c.tx, c.tz);
    const w = Math.max(
      motionK > 0 ? 1 : 0,
      call(R.life, 'update', dt, { motion: R.motion, season: R.season, focus: { x: c.tx, z: c.tz }, camera: R.cam.camera }) || 0,
      camWant,
      performance.now() - R.inputAt < 100 ? 2 : 0,
      cursorMoving ? WANT.MOVING : 0,
      R.ground.update(dt),
      R.objects.update(dt, t),
      R.badges.update(dt),
      call(R.animals, 'update', dt) || 0,
      call(R.avatars, 'update', dt) || 0,
      ...R.world.map((m) => m.update(dt, now, { motion: R.motion }) || 0),
      call(R.fx, 'update', dt) || 0,
      R.inside ? 0 : call(R.baths, 'update', dt, now, this._bathOpts(c, wx)) || 0,
      R.inside ? 0 : R.crates.update(dt, R.now(), this._crateOpts()),
      R.inside ? R.interior.update(dt, now, R.sky0, { motion: R.motion }) : 0,
      R.ghost.tick(dt) ? 2 : 0,
      isAnimating() ? 2 : 0,
    );
    // Farm Beauty ambience: the score and the complete decor sets (after objects.update re-checked the sets; at most
    // once a second, and only after a change)
    if (R.beautyDirty && R.state && t - (R.beautyAt || 0) > 1000) {
      R.beautyDirty = false;
      R.beautyAt = t;
      R.beauty = worldState.beautyOf(R.state);
      call(R.life, 'setBeauty', R.beauty, R.objects.completeSets());
      call(R.ground, 'setBeauty', R.beauty.stars);
    }
    return w;
  },

  /** Night lights (wave 4): window and lamp glass glow with the dusk, and up to LAMP_N real lights follow the lamps
   *  nearest the camera target (view-space positions every tick: the camera moves them; a farm has a few dozen lamps).
   *  The low tier (and a phone below its high tier) keeps the glow and the ground pools but no lights (one uniform branch
   *  skips them by day). */
  _lamps(c) {
    const s0 = R.sky0;
    const night = s0 ? s0.night : 0;
    LOOK.uGlow.value = s0 ? Math.max(night, s0.windows || 0) : 0;
    // phones light lamps only on their high tier (the glow and the ground pools stay on every tier)
    const on = night > 0.02 && !R.inside && !R.eco && (R.profile.kind === 'phone' ? R.tier === 'high' : R.tier !== 'low');
    LOOK.uLampK.value = on ? night : 0;
    const L = R.lamps || (R.lamps = { n: 0, best: Array.from({ length: LAMP_N }, () => ({ d: Infinity, l: null })), v: new THREE.Vector3() });
    L.n = 0;
    if (!on) return;
    const src = R.objects.lampSources ? R.objects.lampSources() : [];
    for (const b of L.best) { b.d = Infinity; b.l = null; }
    for (const l of src) {
      const d = Math.hypot(l.x - c.tx, l.z - c.tz);
      if (d > 45) continue;
      let i = LAMP_N - 1;
      if (d >= L.best[i].d) continue;
      while (i > 0 && L.best[i - 1].d > d) { L.best[i].d = L.best[i - 1].d; L.best[i].l = L.best[i - 1].l; i--; }
      L.best[i].d = d; L.best[i].l = l;
    }
    const inv = R.cam.camera.matrixWorldInverse;
    const U = LOOK.uLampPos.value;
    for (let i = 0; i < LAMP_N; i++) {
      const b = L.best[i];
      if (!b.l) { U[i].set(0, -1e4, 0, 0); continue; }
      L.v.set(b.l.x, b.l.y, b.l.z).applyMatrix4(inv);
      // far lamps fade out rather than pop as the nearest four change
      U[i].set(L.v.x, L.v.y, L.v.z, Math.min(1, Math.max(0, (45 - b.d) / 15)));
      L.n++;
    }
  },

  /**
   * The camera's pan bounds (tiles): the farm's land, plus the world places the couple uses once their system is
   * live (the Fair grounds, the jetty and the barge, the restoration sites), so a click on the barge or the tent is
   * always within reach and the village shows across the river from the bank (GDD §8.3). Never past the river.
   */
  _camBounds() {
    const b = { ...R.ground.bounds() };
    for (const m of R.world) {
      for (const p of m.places()) {
        if (!p.live || !p.box || p.place === 'town') continue;
        b.x0 = Math.min(b.x0, Math.floor(p.box.min.x / TILE_M));
        b.z0 = Math.min(b.z0, Math.floor(p.box.min.z / TILE_M));
        b.x1 = Math.max(b.x1, Math.ceil(p.box.max.x / TILE_M));
        b.z1 = Math.max(b.z1, Math.min(70, Math.ceil(p.box.max.z / TILE_M)));
      }
    }
    return b;
  },

  /** Fit the sun's shadow camera around what the camera sees (static cache: one re-render). RD-13: the box hugs the
   *  visible ground (it reaches further beyond the target than toward the camera), not a generous square round the
   *  target: 30 % less area to draw casters into, and sharper shadows. */
  _fitShadow(force = false) {
    const { sun } = R;
    const c = R.cam.get();
    const half = shadowHalf(c.dist);
    const s = R.sky0 ? R.sky0.sunDir : [-0.57, 0.8, 0.23];
    const fit = R.shadowFit;
    // the view's ground footprint lies ~0.12 dist beyond the target: centre the box there
    const p = R.cam.camera.position;
    const vx = c.tx - p.x; const vz = c.tz - p.z; const vl = Math.hypot(vx, vz) || 1;
    const ox = c.tx + (vx / vl) * 0.12 * c.dist; const oz = c.tz + (vz / vl) * 0.12 * c.dist;
    if (!force && fit && Math.hypot(ox - fit.x, oz - fit.z) < 0.5 && Math.abs(half - fit.half) < 0.5) return;
    // snap the centre to whole metres so repeated refits of a resting view render the identical map
    const cx = Math.round(ox);
    const cz = Math.round(oz);
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx + s[0] * 160, s[1] * 160, cz + s[2] * 160);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 400 });
    sun.shadow.camera.updateProjectionMatrix();
    R.shadowFit = { x: cx, z: cz, half };
    R.shadowDirty = true;
    dirty = true;
  },

  setState(state, { me } = {}) {
    R.state = state;
    if (me) R.me = me;
    R.ground.setState(state);
    R.objects.setMe(R.me);
    R.objects.setState(state);
    call(R.animals, 'setState', state);
    R.avatars.setPlayers(state.players, me);
    call(R.avatars, 'setSeats', state.farm.coop?.bench || {}, state);
    call(R.life, 'setState', state);
    call(R.baths, 'setState', state);
    R.crates.setState(state, R.now());
    call(R.fx, 'setMe', R.me);
    const wnow = R.clockOverride ?? R.now();
    for (const m of R.world) m.setState(state, wnow);
    R.ground.setFeatures(R.land.owners());
    if (R.interior) R.interior.setState(state, { me: R.me, now: wnow });
    R.cam.setBounds(this._camBounds());
    R.beautyDirty = true;
    R.seasonAt = 0;
    R.skyAt = 0;
    this._fitShadow(true);
    dirty = true;
  },

  sync(ids, topics) {
    if (!R || !R.state) return;
    R.ground.sync(ids, topics, R.state);
    R.objects.sync(ids, topics, R.state);
    call(R.animals, 'sync', ids, topics, R.state);

    if (topics.has('players') || topics.has('*')) R.avatars.setPlayers(R.state.players, undefined);
    // `duel`: the duel crown on the winner's head refreshes with farm.duel (avatars-view reads it in setSeats)
    if (topics.has('coop') || topics.has('objects') || topics.has('duel') || topics.has('*')) call(R.avatars, 'setSeats', R.state.farm.coop?.bench || {}, R.state);
    call(R.life, 'sync', ids, topics, R.state);
    call(R.baths, 'sync', ids, topics, R.state);
    R.crates.sync(ids, topics, R.state, R.now());
    const wnow = R.clockOverride ?? R.now();
    for (const m of R.world) m.sync(ids, topics, R.state, wnow);
    if (topics.has('expansions') || topics.has('restore') || topics.has('*')) R.ground.setFeatures(R.land.owners());
    if (R.interior) R.interior.sync(ids, topics, R.state, wnow);
    if (topics.has('expansions') || topics.has('restore') || topics.has('xp') || topics.has('*')) R.cam.setBounds(this._camBounds());
    R.beautyDirty = true;
    if (topics.has('*') || topics.has('meta')) R.skyAt = 0;
    dirty = true;
  },

  pick(ndc) {
    if (!R || R.inside) return null;
    const p = this._pickPointer(ndc);
    // wave 4b: a loot crate picked by its tile is flagged like one picked by its box (picking.js)
    if (p && p.kind === 'object' && !p.crate && R.crates.has(p.id)) p.crate = true;
    // hover is the wind: my cursor parts the crops; the hovered object lifts a little
    if (p) cursors.setA(p.px * TILE_M, p.pz * TILE_M, true);
    else cursors.setA(null, null, false);
    R.objects.hover(p && p.kind === 'object' ? p.id : null);
    call(R.life, 'hover', p);
    // a note pinned to the tile under the cursor (additive pick field: the controller opens it on a click)
    if (p) { const n = R.objects.noteAt(p.x, p.z); if (n) p.note = n; }
    R.lastPick = p;
    R.inputAt = performance.now();            // pointer input: interactive frame rate (60 fps + the 2 s tail)
    dirty = true;
    return p;
  },

  /** The pick under a pointer (mobile wave): exact for a mouse and while a build ghost shows (placement is to the
   *  tile; the controller lifts the ghost above the finger itself); a finger elsewhere gets the tolerance rings. */
  _pickPointer(ndc) {
    const finger = R.ptrType === 'touch' || R.ptrType === 'pen';
    if (!finger || R.ghostDef || !ndc || !R.rect || !(R.rect.height > 0)) return R.pick(R.state, ndc);
    return pickNear((n) => R.pick(R.state, n), ndc, { w: R.rect.width, h: R.rect.height }, { accept: fingerTarget });
  },

  /** The input lane may say which pointer drives the next picks (the view also watches pointer events itself). */
  setPointer(kind) { if (R && (kind === 'touch' || kind === 'mouse' || kind === 'pen')) R.ptrType = kind; },
  /** The finger constants (mobile wave): the tolerance rings in CSS px. */
  get touch() { return { radii: [...TOUCH_PICK.radii] }; },

  /** Canvas size, orientation and pixel ratio, without a reload (mobile wave). */
  _watchViewport(canvas) {
    let queued = false;
    const resize = () => {
      queued = false;
      if (!R) return;
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      if (!(w > 0) || !(h > 0)) return;
      const pr = Math.min(window.devicePixelRatio || 1, R.q.pixelRatio);
      const prChanged = Math.abs(R.renderer.getPixelRatio() - pr) > 1e-3;
      if (prChanged) R.renderer.setPixelRatio(pr);
      if (prChanged || w !== R.cssW || h !== R.cssH) {
        R.renderer.setSize(w, h, false);
        R.cam.resize(w / h, { w, h });
        if (R.interior) R.interior.resize(w / h);
        R.cssW = w; R.cssH = h;
      }
      R.rect = canvas.getBoundingClientRect();
      dirty = true;
      if (R.loop && R.loop.wake) R.loop.wake();
    };
    const later = () => { if (!queued) { queued = true; requestAnimationFrame(resize); } };
    R.resize = resize;
    window.addEventListener('resize', later);
    // iOS reports the old size for a moment after a turn: look again once the rotation has settled
    window.addEventListener('orientationchange', () => { later(); setTimeout(later, 250); setTimeout(later, 700); });
    const vv = window.visualViewport;
    if (vv) { vv.addEventListener('resize', later); vv.addEventListener('scroll', () => { if (R) R.rect = canvas.getBoundingClientRect(); }); }
    if (typeof ResizeObserver === 'function') { try { new ResizeObserver(later).observe(canvas); } catch { /* not an element */ } }
    // a DPR change (zoom, a monitor swap): the query matches only the current ratio, so re-arm it each time
    const watchDpr = () => {
      if (typeof matchMedia !== 'function') return;
      try {
        const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        mq.addEventListener('change', () => { later(); watchDpr(); }, { once: true });
      } catch { /* old browser */ }
    };
    watchDpr();
    resize();
  },

  /** Which pointer drives the picks, a finger that stops the glide, and the hover that settles after a finger lifts
   *  (mobile wave). Passive listeners only: the controller owns the gestures. */
  _watchPointer(canvas) {
    // (the controller clears its highlight itself when the finger lifts; these two only the view knows about)
    const clearHover = () => {
      R.clearAt = null;
      if (!R || R.touches.size) return;
      R.objects.hover(null);
      cursors.setA(null, null, false);
      call(R.life, 'hover', null);
      dirty = true;
    };
    // capture phase on window: runs before the controller's own canvas listeners, so its picks see the right kind
    window.addEventListener('pointerdown', (e) => {
      if (!R) return;
      R.ptrType = e.pointerType || 'mouse';
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (R.clearAt) { clearTimeout(R.clearAt); R.clearAt = null; }
      if (e.isPrimary) R.touches.clear();             // a new first finger: any up we never saw is over
      R.touches.add(e.pointerId);
      R.cam.stop();                                   // a finger on the glass stops the glide
    }, { capture: true, passive: true });
    window.addEventListener('pointermove', (e) => { if (R && e.pointerType) R.ptrType = e.pointerType; }, { capture: true, passive: true });
    // bubble phase: after the controller's release; the hover lift and the hand's wind settle once every finger is up
    const up = (e) => {
      if (!R || !R.touches.delete(e.pointerId) || R.touches.size) return;
      R.clearAt = setTimeout(clearHover, 140);
    };
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
  },

  /** A lost WebGL context (a phone under memory pressure, a backgrounded tab): pause, and resume when the browser
   *  restores it; three re-creates every GPU resource from its CPU copy on first use (mobile wave). */
  _watchContext(canvas) {
    const gl = R.renderer.getContext();
    const loseExt = gl && typeof gl.getExtension === 'function' ? gl.getExtension('WEBGL_lose_context') : null;
    let waited = 0;
    let timer = null;
    const watch = () => {
      timer = null;
      if (!R || !R.contextLost) return;
      if (typeof document === 'undefined' || !document.hidden) waited += 1000;
      if (waited === 5000 && loseExt) { try { loseExt.restoreContext(); } catch { /* only for a context it lost itself */ } }
      if (waited >= 10_000) {
        let last = 0;
        try { last = Number(sessionStorage.getItem('hh.glReload')) || 0; } catch { /* storage blocked */ }
        if (Date.now() - last > 120_000) {
          try { sessionStorage.setItem('hh.glReload', String(Date.now())); } catch { /* storage blocked */ }
          console.warn('WebGL context not restored after 10 s: reloading');
          location.reload();
          return;
        }
      }
      timer = setTimeout(watch, 1000);
    };
    canvas.addEventListener('webglcontextlost', () => {
      // three's own listener prevents the default, which is what allows a restore
      if (!R) return;
      R.contextLost = true;
      R.lost++;
      if (R.loop) R.loop.pause('lost');
      waited = 0;
      if (!timer) timer = setTimeout(watch, 1000);
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      if (!R) return;
      R.contextLost = false;
      if (timer) { clearTimeout(timer); timer = null; }
      // GPU queries of the old context are gone; every texture, buffer, target and program re-uploads on first use
      R.gpuTimer = createGpuTimer(R.renderer);
      R.lastFed = 0;
      applyTier(R.renderer, R.sun, R.tier, R.profile.kind);
      R.shadowDirty = true;
      R.cullDirty = true;
      R.lastCam = null;
      R.cssW = 0;
      if (R.resize) R.resize();
      dirty = true;
      if (R.loop) { R.loop.resume('lost'); R.loop.kick(); }
    }, false);
  },

  ghost: {
    show(defId, rot) {
      // wave 4b: moving a grown home shows its whole paddock (its own size and model), not the def's small pen
      R.ghost.show(defId, rot, view._movedLook(defId));
      R.ghostDef = defId; R.ghostRot = rot || 0;
      R.objects.setSetGlow(defId, null);
      dirty = true;
    },
    hide() {
      R.ghost.hide();
      R.ghostDef = null;
      R.objects.setSetGlow(null);
      R.ground.gridFocus(null, null);
      if (R.blocker) { R.objects.tint(R.blocker, null); R.blocker = null; }
      dirty = true;
    },
    /** The copies a decor-set spot would join (the client's `build` event `set.ids`); null clears. */
    setIds(ids) {
      if (!R || !R.ghostDef) return;
      R.objects.setSetGlow(R.ghostDef, R.ghost.centre, Array.isArray(ids) ? ids : null);
      dirty = true;
    },
    update(tile, valid, reason, blockerId) {
      R.ghost.update(tile, valid, reason);
      const g = R.ghost.centre;
      R.ground.gridFocus(g ? g.x : null, g ? g.z : null);
      if (R.ghostDef) R.objects.setSetGlow(R.ghostDef, g);
      const b = !valid && blockerId ? blockerId : null;
      if (b !== R.blocker) {
        if (R.blocker) R.objects.tint(R.blocker, null);
        if (b) R.objects.tint(b, '#FF8A80');
        R.blocker = b;
      }
      dirty = true;
    },
  },

  highlight(tiles, style) { if (R) { R.ground.highlight(tiles || [], style); dirty = true; } },
  /** The tool in hand (additive, wave 2): the water pins are loud only while the Watering Can is out. */
  setTool(id) { if (R) { R.objects.setTool(typeof id === 'string' ? id : null); dirty = true; } },
  grid(visible) { if (R) { R.ground.grid(Boolean(visible)); dirty = true; } },
  objects: {
    hidden(id, hidden) {
      if (!R) return;
      R.objects.hidden(id, Boolean(hidden));
      // the object being moved (wave 4b): a ghost of its def already up re-reads its size (the order of the calls is free)
      if (hidden) R.movedId = id; else if (R.movedId === id) R.movedId = null;
      if (R.ghostDef) R.ghost.show(R.ghostDef, R.ghostRot || 0, view._movedLook(R.ghostDef));
      dirty = true;
    },
    /** Wave 4 (wish 8): swing the Barn's doors open (or shut); they close by themselves after a few seconds. */
    doors(id, open = true) {
      if (!R) return false;
      const ok = call(R.objects, 'doors', id, open !== false) || false;
      if (ok) { dirty = true; if (R.loop) R.loop.kick(); }
      return ok;
    },
  },
  /** The size and model of the object being moved when it has `defId` and is not the def's own size (a grown home). */
  _movedLook(defId) {
    const id = R && R.movedId;
    const o = id && R.state && Object.hasOwn(R.state.farm.objects, id) ? R.state.farm.objects[id] : null;
    if (!o || o.def !== defId) return null;
    const def = defOf(defId);
    const t = homeTier(o, def);
    if (!t) return null;
    const ins = R.objects.inspect(id);
    return { size: [def.size[0] + t, def.size[1] + t], key: ins && ins.key };
  },
  /** Wave 4 (wish F): does owned tile (x, z) still show wild tufts the Hand can pull? */
  weedAt(x, z) { return Boolean(R && call(R.ground, 'weedAt', x, z)); },
  setQuality(q, { keepMode = false } = {}) {
    if (!R) return;
    // 'eco' (GDD §7.5): the low tier, 20 fps ambient and 30 fps while interacting: the coolest the farm can run
    if (!keepMode) { R.eco = q === 'eco'; R.tierMode = q === 'auto' ? 'auto' : 'fixed'; }
    if (q === 'eco') q = 'low';
    const t = QUALITY[q] ? q : (q === 'auto' ? R.tier : 'high');
    R.tier = t;
    R.q = qualityOf(t, R.profile.kind);
    applyTier(R.renderer, R.sun, t, R.profile.kind);
    R.ground.setQuality(R.q.tufts);
    call(R.fx, 'setQuality', R.q.particles);
    call(R.life, 'setQuality', R.q.life);
    call(R.animals, 'setSkinnedMax', R.q.skinned);
    R.lod = createLod();                         // the zoom band is re-read with the tier's LOD scale next tick
    R.skyAt = 0;                                 // blob shadows follow the shadow map's switch
    R.shadowDirty = true;
    dirty = true;
  },
  setMotion(mode) {
    if (!R) return;
    const m = mode === 'still' || mode === 'reduced' ? mode : 'full';
    R.motion = m;
    R.objects.setMotion(m);
    R.badges.setMotion(m);
    call(R.animals, 'setMotion', m);
    call(R.avatars, 'setMotion', m);
    call(R.fx, 'setMotion', m);
    dirty = true;
  },
  setDayCycle(mode) {
    if (!R) return;
    R.dayMode = mode === 'day' || mode === 'real' ? mode : 'cycle';
    R.skyAt = 0;
    dirty = true;
  },
  setWeather(kind) { if (R) { R.weather.force(kind || null); R.skyAt = 0; dirty = true; } },
  setClock(ms) { if (R) { R.clockOverride = Number.isFinite(ms) ? ms : null; R.skyAt = 0; dirty = true; } },
  setSeason(name) { if (R) { R.seasonOverride = SEASON_INDEX[name] !== undefined ? name : null; R.seasonAt = 0; dirty = true; } },
  async capture() {
    if (!R) return null;
    const pr = R.renderer.getPixelRatio();
    R.renderer.setPixelRatio(pr * 2);
    const w = R.canvas.clientWidth || window.innerWidth;
    const h = R.canvas.clientHeight || window.innerHeight;
    R.renderer.setSize(w, h, false);
    if (R.inside) R.renderer.render(R.interior.scene, R.interior.camera);
    else R.renderer.render(R.scene, R.cam.camera);
    const blob = await new Promise((resolve) => R.canvas.toBlob((b) => resolve(b), 'image/png'));
    R.renderer.setPixelRatio(pr);
    R.renderer.setSize(w, h, false);
    dirty = true;
    return blob;
  },

  partner: {
    update(rows, ts) {
      if (!R) return;
      R.avatars.presence(rows, ts);
      dirty = true;                             // the partner moved: a resting (or sleeping) loop looks at once
      // the partner's cursor is the second hand of wind (rows: [pid, x, z, f, a, cx, cz, ...], tiles)
      for (const r of rows || []) {
        if (!Array.isArray(r) || r[0] === R.me) continue;
        const cx = r[5]; const cz = r[6];
        if (Number.isFinite(cx) && Number.isFinite(cz)) cursors.setB(cx * TILE_M, cz * TILE_M, R.partnerOn.get(r[0]) !== false);
      }
    },
    ghost(pid, g) { R.avatars.ghost(pid, g); dirty = true; },
    online(pid, on) {
      R.avatars.setOnline(pid, on);
      R.partnerOn.set(pid, Boolean(on));
      if (!on) cursors.setB(null, null, false);
      dirty = true;
    },
    pose(pid) { return R.avatars.poseOf(pid); },
  },

  me: {
    update(pose) { R.avatars.me(pose); dirty = true; },
  },

  fx: {
    play(event, worldPos, meta = {}) {
      if (!R || !event) return;
      // wave 4b: a mass action (the Golden Watering Can, the Farmhand) emits one event per crop or animal and then its
      // own; the events of one moment are gathered (they arrive in one task) and played as one wave, not 80 floats
      if (!worldPos && MASS.has(event.e)) { view._massAdd(event, meta); return; }
      view._play(event, worldPos, meta);
    },
  },
  /** One feedback event (see fx.play). */
  _play(event, worldPos, meta = {}) {
    if (!R || !event) return;
    {
      let pos = null;
      // a loot crate's opening / store starts in its own view (the object has already left the state) and gives its place
      const cpos = R.crates.onEvent(event, meta);
      if (worldPos) pos = new THREE.Vector3(worldPos.x * TILE_M, 0, worldPos.z * TILE_M);
      else if (cpos) pos = cpos;
      else if (event.id) pos = R.objects.worldPosOf(event.id) || call(R.animals, 'positionOf', event.id) || null;
      if (!pos && (event.e === 'levelUp' || event.e === 'bloomed' || event.e === 'goldenHour' || event.e === 'relicBought')) { const c = R.cam.get(); pos = new THREE.Vector3(c.tx, 0, c.tz); }
      // the Time Turner (wave 4b): a golden swirl over every workshop it finished
      if (event.e === 'timeTurned' && Array.isArray(event.ids)) event = { ...event, positions: event.ids.map((i) => R.objects.worldPosOf(i)).filter(Boolean) };
      // a completed decor set glows under each of its pieces (fx.js reads ev.positions, metres)
      if (event.e === 'decorSet' && Array.isArray(event.ids)) {
        event = { ...event, positions: event.ids.map((i) => R.objects.worldPosOf(i)).filter(Boolean) };
        if (!pos && event.positions.length) pos = event.positions[0].clone();
      }
      // the Level-up Bloom: a sparkle wave over every crop, tree and animal it finished (an animal where it stands now)
      if (event.e === 'bloomed' && Array.isArray(event.ids)) {
        event = { ...event, positions: event.ids.map((i) => R.objects.worldPosOf(i) || call(R.animals, 'positionOf', i)).filter(Boolean) };
      }
      if (event.e === 'invalid' && event.id) R.objects.shake(event.id);
      if (TREE_EVENTS.has(event.e) && event.id) R.objects.shake(event.id, 'tree');
      if (event.e === 'goldenHour' && Number.isFinite(event.until)) R.skyAt = 0;
      // a "Cook together" press waits for the partner: a heart over the building until it is joined or runs out
      if (event.e === 'duetPressed' && event.id) { R.duets.set(event.id, Number.isFinite(event.until) ? event.until : R.now() + 60_000); R.objects.marker(event.id, 'duet', true); }
      if ((event.e === 'duet' || (event.e === 'queued' && event.duet)) && event.id && R.duets.delete(event.id)) R.objects.marker(event.id, 'duet', false);
      // a cast or a catch at the fishing dock rings the pond where the float went in (wave 3)
      if (R.land.onEvent(event)) dirty = true;
      call(R.animals, 'onEvent', event, meta);
      call(R.avatars, 'onEvent', event, meta);
      R.fx.play(event, pos, meta);
      // the Lucky Clover (wave 4b relic): every blue ribbon while the farm owns it shows its little clover burst
      if (pos && (event.ribbon || event.blueRibbon || event.e === 'blueRibbon') && R.state?.farm?.relics && Object.hasOwn(R.state.farm.relics, 'lucky_clover')) {
        R.fx.play({ e: 'luckyClover', id: event.id }, pos, meta);
      }
      dirty = true;
    }
  },
  /** Gather a mass action's events of this moment; flushed once the task that emitted them is done. */
  _massAdd(event, meta) {
    const q = R.mass || (R.mass = []);
    q.push([event, meta]);
    if (!R.massQueued) { R.massQueued = true; queueMicrotask(() => view._massFlush()); }
  },
  _massFlush() {
    const list = R.mass || [];
    R.mass = []; R.massQueued = false;
    const head = list.find(([e]) => MASS_HEADS.has(e.e));
    // a plain stroke or scoop (no mass head): each event as before
    if (!head) { for (const [e, m] of list) view._play(e, null, m); return; }
    const [ev, meta] = head;
    // where it starts: the farmer who did it (else the view's centre); every crop / animal by its distance from there
    const by = ev.by ?? meta.by;
    const p0 = by ? call(R.avatars, 'poseOf', by) : null;
    const c = R.cam.get();
    const ox = p0 && Number.isFinite(p0.x) ? p0.x * TILE_M : c.tx; const oz = p0 && Number.isFinite(p0.z) ? p0.z * TILE_M : c.tz;
    const positions = [];
    const items = {};
    for (const [e] of list) {
      if (MASS_HEADS.has(e.e) || !e.id) continue;
      const p = R.objects.worldPosOf(e.id) || call(R.animals, 'positionOf', e.id);
      if (p && (e.e === 'watered' || e.e === 'fed' || e.e === 'collected') && !positions.some((q) => q.id === e.id)) {
        positions.push(Object.assign(p, { id: e.id, d: Math.hypot(p.x - ox, p.z - oz) }));
      }
      if (e.e === 'collected') { const it = e.product || e.item; if (it) items[it] = (items[it] || 0) + (e.qty ?? 1); }
    }
    positions.sort((a, b) => a.d - b.d);
    view._play({ ...ev, positions, items, n: ev.n ?? positions.length }, positions.length ? null : { x: ox / TILE_M, z: oz / TILE_M }, { ...meta, by });
  },

  /** (additive, wave 3) The seats on an owned pond's dock, in tiles with the facing yaw, for the client's fishing walk
   * when a panel (not the place pick) starts it: [{ x, z, f }] (none for a pond the world draws no dock at). */
  fishingSeats(pond) {
    if (pond !== 'willow_pond') return [];
    return dockSeats().map((q) => ({ x: q.x / TILE_M, z: q.z / TILE_M, f: q.face }));
  },

  focus(x, z) {
    // mobile wave: with HUD insets the point lands in the middle of the free part of the screen, not under the HUD
    const off = this._insetShift();
    R.cam.focus(x + off.x, z + off.z);
    dirty = true;
  },

  /** How much of each screen edge the HUD covers (CSS px; ui.layout.insets()): view.focus centres in the rest. */
  setInsets(ins) {
    if (!R) return;
    const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
    R.insets = ins ? { top: n(ins.top), right: n(ins.right), bottom: n(ins.bottom), left: n(ins.left) } : null;
  },

  /** The ground offset (tiles) from the screen centre to the centre of the free rectangle, for the current camera. */
  _insetShift() {
    const i = R.insets;
    const r = R.rect;
    if (!i || !r || !(r.width > 0) || !(r.height > 0)) return { x: 0, z: 0 };
    const fx = i.left + (r.width - i.left - i.right) / 2;
    const fy = i.top + (r.height - i.top - i.bottom) / 2;
    if (!(fx > 0 && fx < r.width && fy > 0 && fy < r.height)) return { x: 0, z: 0 };
    const a = R.pick(null, { x: 0, y: 0 });
    const b = R.pick(null, { x: (fx / r.width) * 2 - 1, y: -(fy / r.height) * 2 + 1 });
    return a && b ? { x: a.px - b.px, z: a.pz - b.pz } : { x: 0, z: 0 };
  },

  camera: {
    rotate(dir) { if (R.inside) R.interior.rotate(dir); else R.cam.rotate(dir); dirty = true; },
    pan(right, forward) { if (R.inside) return; R.cam.pan(right * TILE_M, forward * TILE_M); dirty = true; },
    zoom(factor, ndc) {
      if (R.inside) { R.interior.zoom(factor); dirty = true; return; }
      let anchor = null;
      if (ndc && Number.isFinite(ndc.x) && Number.isFinite(ndc.y)) {
        const p = R.pick(null, ndc);
        if (p) anchor = { x: p.px * TILE_M, z: p.pz * TILE_M };
      }
      R.cam.zoom(factor, anchor);
      dirty = true;
    },
    get() { return { ...R.cam.get(), fov: CAM.fov }; },
    /** Wave 4 (wish H): free turn and tilt (radians); the room's camera only turns by quarters. */
    orbit(dYaw = 0, dPitch = 0) {
      if (!R || R.inside) return;
      R.cam.orbit(dYaw, dPitch);
      R.inputAt = performance.now();
      dirty = true;
    },
    resetOrbit() { if (R && !R.inside) { R.cam.resetOrbit(); dirty = true; if (R.loop) R.loop.kick(); } },
    /** A touch pan let go (mobile wave): glide on at (vx, vz) world tiles per second, easing out. */
    fling(vx, vz) {
      if (!R || !R.cam.fling({ vx: vx * TILE_M, vz: vz * TILE_M })) return false;
      R.glides++;
      dirty = true;
      if (R.loop) R.loop.kick();
      return true;
    },
  },

  /** The farmhouse interior (wave 3, GDD §5.9 #6): see the header. The room is built on the first enter. */
  interior: {
    live() { return Boolean(R && R.state && worldState.interiorView(R.state, R.now()).live); },
    get active() { return Boolean(R && R.inside); },
    async enter() {
      if (!R) return;
      if (!R.interior) {
        R.interior = createInterior({ renderer: R.renderer });
        R.interior.resize((R.cssW || 16) / (R.cssH || 9));
        if (R.state) R.interior.setState(R.state, { me: R.me, now: R.now() });
        try { if (typeof R.renderer.compileAsync === 'function') await R.renderer.compileAsync(R.interior.scene, R.interior.camera); } catch { /* compiles on first draw */ }
      }
      R.inside = true;
      R.interior.focus();
      R.interior.greet();
      view._overlayInside(true);
      dirty = true;
      if (R.loop) R.loop.kick();
    },
    exit() {
      if (!R || !R.inside) return;
      R.inside = false;
      R.interior.ghost(null);
      view._overlayInside(false);
      R.shadowDirty = true;
      dirty = true;
      if (R.loop) R.loop.kick();
    },
    pick(ndc) { return R && R.inside ? R.interior.pick(ndc) : null; },
    ghost(defId, at, valid = true) { if (R && R.interior) { R.interior.ghost(defId, at, valid); dirty = true; } },
    setPresent(pids) { if (R && R.interior) { R.interior.setPresent(pids); dirty = true; } },
    toScreen(x, y, z) {
      if (!R || !R.interior) return { x: 0, y: 0, visible: false };
      v3.set(x, y, z).project(R.interior.camera);
      const r = R.rect;
      return { x: (v3.x * 0.5 + 0.5) * r.width + r.left, y: (-v3.y * 0.5 + 0.5) * r.height + r.top, visible: v3.z < 1 && Math.abs(v3.x) <= 1.1 && Math.abs(v3.y) <= 1.1 };
    },
  },
  /** The farm's own DOM labels (nameplates, bubbles, pings) hide while the room is shown. */
  _overlayInside(on) {
    const ov = typeof document !== 'undefined' ? document.getElementById('overlay') : null;
    if (!ov) return;
    if (!document.getElementById('hh-inside-style')) {
      const st = document.createElement('style');
      st.id = 'hh-inside-style';
      st.textContent = '#overlay.hh-inside > :not(.hh-interior) { visibility: hidden !important; }';
      document.head.appendChild(st);
    }
    ov.classList.toggle('hh-inside', Boolean(on));
  },
  get animals() { return R ? R.animals : null; },
  /** Internals for dev tools and look-dev scripts only (never for game code). `worldState.setLivePredicate` previews
   *  a later milestone's places in look-dev; the game never calls it. */
  get _internals() { return R; },
  get avatars() { return R ? R.avatars : null; },
  /** Additive (hud lane, wave 4b): a farmer's head-and-shoulders portrait for the HUD chips and the slot picker
   *  (render/portrait.js), drawn once per look with this renderer. spec { pid, body?, color, avatar? } -> Promise<url | null>
   *  (null: no renderer yet or a lost context; the chip keeps its letter). */
  portrait(spec) { return R && !R.contextLost ? drawPortrait(R.renderer, spec) : Promise.resolve(null); },

  invalidate() { dirty = true; },

  /** Input happened (pointer, key, wheel) or a predicted change must show NOW: the very next animation frame,
   *  whatever the ambient cap, then the interactive rate for the 2 s tail (GDD §7.2: feedback in the same frame). */
  interact() { dirty = true; if (R && R.loop && R.loop.kick) R.loop.kick(); },

  /** Social presence shortcuts (render-life avatars / animals). */
  emote(pid, kind) { call(R?.avatars, 'emote', pid, kind); dirty = true; },
  ping(pid, x, z) { call(R?.avatars, 'ping', pid, x, z); dirty = true; },
  highFive(pidA, pidB) { call(R?.avatars, 'highFive', pidA, pidB); dirty = true; },
  pet(id) { call(R?.animals, 'pet', id); dirty = true; },

  onFrame(fn) { frameFns.add(fn); return () => frameFns.delete(fn); },

  toScreen(x, z, y = 0) { return toScreenM(x * TILE_M, z * TILE_M, y); },

  stats() {
    if (!R) return { fps: 0, calls: 0, triangles: 0 };
    const i = R.renderer.info.render;
    return {
      fps: R.fps, calls: i.calls, triangles: i.triangles, tier: R.tier, tierMode: R.tierMode, mode: R.mode,
      band: R.lod.band, shadowRenders: R.shadowRenders, weather: R.wx ? R.wx.kind : null,
      phase: R.sky0 ? R.sky0.phase : null, season: R.season || null, ...R.objects.stats(), badges: R.badges.count, scenery: R.scenery.count,
      world: { river: R.world[0].stats(), barge: R.world[1].stats(), fair: R.world[2].stats(), town: R.world[3].stats(), restoration: R.world[4].stats(), land: R.land.stats(), grandma: R.world[6].stats() },
      groundBootMs: GROUND_BOOT.detailMs, shadowRefreshMs: R.shadowMs || 0, shadowPassTris: R.shadowTris || 0,
      profile: R.profile.kind, gpu: R.profile.gpu, pixelRatio: R.renderer.getPixelRatio(), buffer: [R.canvas.width, R.canvas.height],
      contextLost: R.lost, glides: R.glides,
      rain: R.wx ? +(R.wx.rain || 0).toFixed(3) : 0, wet: R.wx ? +(R.wx.wet || 0).toFixed(3) : 0,
      rainStrength: R.wx ? +((R.wx.rain || 0) * (R.wx.strength ?? 1)).toFixed(3) : 0, puddle: R.wx ? +(R.wx.puddle || 0).toFixed(3) : 0, rainbow: R.wx ? +(R.wx.rainbow || 0).toFixed(3) : 0,
      nightLights: { lit: R.lamps ? R.lamps.n : 0, sources: R.objects.lampSources ? R.objects.lampSources().length : 0, k: +LOOK.uLampK.value.toFixed(2), glow: +LOOK.uGlow.value.toFixed(2) },
    };
  },
};
