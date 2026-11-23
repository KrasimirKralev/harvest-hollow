// MNKISWAN Cozy World in the browser (port of scripts/main.gd, player.gd and companion.gd): boot, the third-person
// camera, Mnki (or Swan) on the keys and the other one following the walked route, the contextual interaction,
// fishing, the home and its two floors, the day clock, autosave and the milestones. Single player plays both: Q
// swaps who leads and who follows.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NPCS, REGIONS, CROPS, GUARDIAN_LINES } from './data.js';
import { createState, CAPACITY } from './state.js';
import { createWorld, promptOf } from './world.js';
import { createCharacter } from './character.js';
import { createUI } from './ui.js';
import { createSound } from './sound.js';
import * as S from './shapes.js';

const state = createState();
const sound = createSound(state);
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 600);

const world = createWorld(scene, state);
mergeStatic(world.root, new Set([...world.interactables.map((n) => n.group), ...world.root.children.filter((c) => ['HomeDecorations', 'VillageImprovements'].includes(c.name))]));

// ---- Mnki and Swan ----
const chars = { mnki: createCharacter('mnki'), swan: createCharacter('swan') };
for (const c of Object.values(chars)) scene.add(c.root);
function makeBody(kind) {
  return { kind, pos: new THREE.Vector3(), vel: new THREE.Vector3(), onFloor: true, lastSafe: new THREE.Vector3(-29, 0, -21), crumbs: [], stuck: 0, prev: new THREE.Vector3() };
}
const bodies = { mnki: makeBody('mnki'), swan: makeBody('swan') };
let leader = 'mnki';
const follower = () => (leader === 'mnki' ? 'swan' : 'mnki');
// talking to the one beside you: an interactable that walks with them
const pal = { kind: 'swan', id: 'swan', item: '', title: 'Swan', reach: 2.7, priority: 0, group: new THREE.Group(), ring: null };
pal.ring = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.03, 8, 24), S.mat('#f4d58a', true));
pal.ring.rotation.x = Math.PI / 2; pal.ring.position.y = 0.045; pal.ring.visible = false;
pal.group.add(pal.ring);
scene.add(pal.group);
world.interactables.push(pal);

const game = {
  state, sound, playing: false, menu: true, region: REGIONS[0], regionId: 'forest', waypoint: '', target: null, fishing: null,
  yaw: 0, pitch: -0.38, arm: 6.3, frozen: false,
  pos: () => bodies[leader].pos,
  promptOf: (n) => promptOf(n, state),
};
const ui = createUI(game);

// ---- boot and session ----
game.begin = (load) => {
  if (load) { if (!state.load()) return; } else state.reset();
  sound.start();
  const p = state.data.position;
  leader = 'mnki';
  warp(bodies.mnki, p[0], p[1] + 0.08, p[2]);
  warp(bodies.swan, p[0] - 1.6, p[1] + 0.08, p[2] + 1.3);
  game.yaw = 0; game.pitch = -0.38; game.arm = state.data.interior ? 4 : 6.3;
  chars.mnki.root.rotation.y = Math.PI;
  game.playing = true;
  world.refresh();
  ui.showHud();
  game.setMenu(false);
  ui.toast('Swan · “There’s no hurry. Let’s make ourselves at home.”');
  state.discover(state.data.interior ? 'home' : 'forest');
  lockSoon();
};
game.toTitle = () => {
  game.playing = false;
  ui.hideHud();
  ui.close();
  ui.buildTitle();
};
let expectUnlock = false;
game.setMenu = (open) => {
  game.menu = open;
  game.frozen = open || Boolean(game.fishing);
  if (open && document.pointerLockElement) { expectUnlock = true; document.exitPointerLock(); }
};
game.saveWorld = () => {
  const b = bodies[leader].pos;
  state.data.position = [round(b.x), round(b.y), round(b.z)];
  const ok = state.save();
  if (ok) sound.play('save');
  return ok;
};
game.react = (k) => { chars[leader].reaction = k; };
const round = (v) => Math.round(v * 100) / 100;

state.on('changed', (msg) => { if (msg) ui.toast(msg); world.refresh(); });
let lastMilestone = -100;
state.on('milestone', (id) => {
  chars.mnki.reaction = 1.2; chars.swan.reaction = 1.2;
  sound.play(id === 'sale' ? 'sale' : 'quest');
  const now = performance.now() / 1000;
  if (['sale', 'fish', 'upgrade'].includes(id) && now - lastMilestone > 35) {
    lastMilestone = now;
    ui.toast({ sale: 'Swan · “Our first little earnings. We did this together.”', fish: 'Swan · “You caught one! Shall we remember this spot?”',
      upgrade: 'Swan · “Look at our stall! There’s room for so much more now.”' }[id]);
  }
  if (id === 'together') {
    ui.dialogue('A world worth returning to', 'The lanterns are lit. The gardens are growing. The neighbors have gathered beneath the old tree.\n\n'
      + 'Mnki · “We made this place a little better than we found it.”\nSwan · “And there’s still tomorrow.”\n\n'
      + 'Your village is yours to keep exploring. Thank you for making it a home.', 'couple');
  }
});

// ---- input ----
const keys = new Set();
const KEYMAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', ShiftLeft: 'run', ShiftRight: 'run', Space: 'jump' };
let jumpQueued = false; let cooldown = 0; let hudHidden = false;
addEventListener('keydown', (e) => {
  sound.start();
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (!game.playing) return;
  if ((e.code === 'F5') || (e.code === 'KeyS' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); game.saveWorld(); return; }
  if (e.code === 'Escape') {
    if (game.fishing) cancelFishing(); else if (ui.isOpen) ui.close(); else ui.open('pause');
    e.preventDefault();
    return;
  }
  if (ui.isOpen) return;
  if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); if (e.code === 'Space') { jumpQueued = true; e.preventDefault(); } }
  if (e.code === 'F2') { e.preventDefault(); hudHidden = !hudHidden; document.getElementById('hud').classList.toggle('photo', hudHidden); ui.toast(hudHidden ? 'F2 · return to the village interface' : ''); }
  if (e.code === 'KeyI' || e.code === 'Tab') { e.preventDefault(); ui.open('inventory'); }
  if (e.code === 'KeyJ') ui.open('journal');
  if (e.code === 'KeyM') ui.open('map');
  if (e.code === 'KeyQ') swap();
  const digit = /^Digit([1-5])$/.exec(e.code);
  if (digit) { state.selectedCrop = Object.keys(CROPS)[Number(digit[1]) - 1]; ui.toast(`Selected seed · ${CROPS[state.selectedCrop].name}`); }
  if (e.code === 'KeyE') {
    if (game.fishing) reel();
    else if (cooldown <= 0 && game.target) { cooldown = 0.32; perform(game.target); }
  }
});
addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });
addEventListener('blur', () => keys.clear());
canvas.addEventListener('click', () => { sound.start(); if (game.playing && !ui.isOpen) canvas.requestPointerLock?.(); });
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (game.fishing) cancelFishing(); });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) return;
  if (expectUnlock) { expectUnlock = false; return; }
  // Esc in the browser releases the mouse first: a little breather, as in the game
  if (game.playing && !ui.isOpen) { if (game.fishing) cancelFishing(); else ui.open('pause'); }
});
let dragging = false;
canvas.addEventListener('mousedown', () => { dragging = true; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (!game.playing || game.frozen) return;
  if (!document.pointerLockElement && !dragging) return;
  const k = state.settings.sensitivity;
  game.yaw -= e.movementX * k;
  game.pitch -= e.movementY * k * (state.settings.invert_y ? -1 : 1);
  game.pitch = Math.min(0.12, Math.max(-0.9, game.pitch));
});
canvas.addEventListener('wheel', (e) => {
  if (!game.playing || ui.isOpen) return;
  game.arm = Math.min(9, Math.max(3.2, game.arm + Math.sign(e.deltaY) * 0.4));
  e.preventDefault();
}, { passive: false });
function lockSoon() { /* the mouse is captured on the first click into the world (browsers need a gesture) */ }

function swap() {
  if (game.fishing) return;
  leader = follower();
  const lead = bodies[leader];
  lead.crumbs = [];
  bodies[follower()].crumbs = [];
  ui.toast(leader === 'swan' ? 'You are Swan now · Mnki walks beside you (Q to swap)' : 'You are Mnki now · Swan walks beside you (Q to swap)');
}

// ---- movement ----
const groundOf = (b) => (b.pos.x > 100 && b.pos.y >= 3 ? 4 : 0);
function warp(b, x, y, z) { b.pos.set(x, y, z); b.vel.set(0, 0, 0); b.lastSafe.copy(b.pos); b.crumbs = []; }
function step(b, dir, speed, dt, jump) {
  const ax = dir.x * speed; const az = dir.z * speed;
  b.vel.x = moveToward(b.vel.x, ax, dt * 15);
  b.vel.z = moveToward(b.vel.z, az, dt * 15);
  const ground = groundOf(b);
  if (b.pos.y > ground + 0.001 || b.vel.y > 0) b.vel.y -= 18 * dt;
  else {
    b.vel.y = 0;
    if (jump) b.vel.y = 6.4;
    if (b.pos.x > 100 || Math.hypot(b.pos.x, b.pos.z - 8) < 62) b.lastSafe.copy(b.pos);
  }
  let x = b.pos.x + b.vel.x * dt; let z = b.pos.z + b.vel.z * dt;
  [x, z] = S.resolve(x, z, 0.29, b.pos.y, 1.65);
  b.pos.x = x; b.pos.z = z;
  b.pos.y = Math.max(ground, b.pos.y + b.vel.y * dt);
  if (b.pos.y <= ground) b.vel.y = Math.min(0, b.vel.y);
  if (b.pos.y < -8 || (Math.hypot(b.pos.x, b.pos.z - 8) > 65 && b.pos.x < 100)) {
    if (b.lastSafe.y > -1) b.pos.copy(b.lastSafe); else b.pos.set(0, 0.1, 4);
    b.vel.set(0, 0, 0);
  }
}
const moveToward = (v, t, d) => (Math.abs(t - v) <= d ? t : v + Math.sign(t - v) * d);
const angleLerp = (a, b, t) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

function updateLeader(dt) {
  const b = bodies[leader]; const ch = chars[leader];
  let ix = 0; let iz = 0;
  if (!game.frozen) {
    if (keys.has('l')) ix -= 1; if (keys.has('r')) ix += 1;
    if (keys.has('f')) iz -= 1; if (keys.has('b')) iz += 1;
  }
  const len = Math.hypot(ix, iz) || 1;
  ix /= len; iz /= len;
  const cs = Math.cos(game.yaw); const sn = Math.sin(game.yaw);
  const dir = new THREE.Vector3(ix * cs + iz * sn, 0, -ix * sn + iz * cs);
  step(b, dir, keys.has('run') ? 6.5 : 4.4, dt, jumpQueued && !game.frozen);
  jumpQueued = false;
  if (dir.lengthSq() > 0.01) ch.root.rotation.y = angleLerp(ch.root.rotation.y, Math.atan2(dir.x, dir.z), Math.min(1, dt * 12));
  ch.root.position.copy(b.pos);
  ch.animate(dt, Math.hypot(b.vel.x, b.vel.z), state.settings.reduced_motion);
}

// the one beside you follows the exact walked route (breadcrumbs) rather than cutting through props
function updateFollower(dt) {
  const b = bodies[follower()]; const lead = bodies[leader]; const ch = chars[follower()];
  const waiting = game.menu || Boolean(game.fishing);
  const last = b.crumbs[b.crumbs.length - 1];
  if (!last || last.distanceTo(lead.pos) > 0.65) b.crumbs.push(lead.pos.clone());
  if (b.crumbs.length > 90) b.crumbs.shift();
  const dist = b.pos.distanceTo(lead.pos);
  let target = b.pos;
  if (!waiting && dist > 2.15 && b.crumbs.length) {
    while (b.crumbs.length > 1 && b.pos.distanceTo(b.crumbs[0]) < 0.7) b.crumbs.shift();
    target = b.crumbs[0];
  } else while (b.crumbs.length > 4) b.crumbs.shift();
  const d = new THREE.Vector3(target.x - b.pos.x, 0, target.z - b.pos.z);
  const speed = dist > 7 ? 6.7 : 4.6;
  const dl = d.length();
  b.vel.x = moveToward(b.vel.x, dl > 0.2 ? (d.x / dl) * speed : 0, dt * 14);
  b.vel.z = moveToward(b.vel.z, dl > 0.2 ? (d.z / dl) * speed : 0, dt * 14);
  // the follower climbs the stairs and drops with the leader's floor
  if (Math.abs(b.pos.y - lead.pos.y) > 1.5 && lead.vel.y === 0) b.pos.y = lead.pos.y;
  let x = b.pos.x + b.vel.x * dt; let z = b.pos.z + b.vel.z * dt;
  [x, z] = S.resolve(x, z, 0.25, b.pos.y, 1.6);
  b.pos.x = x; b.pos.z = z;
  const walking = Math.hypot(b.vel.x, b.vel.z);
  if (walking > 0.2) ch.root.rotation.y = angleLerp(ch.root.rotation.y, Math.atan2(b.vel.x, b.vel.z), Math.min(1, dt * 8));
  else if (waiting) ch.root.rotation.y = angleLerp(ch.root.rotation.y, Math.atan2(lead.pos.x - b.pos.x, lead.pos.z - b.pos.z), Math.min(1, dt * 2));
  ch.root.position.copy(b.pos);
  ch.animate(dt, walking, state.settings.reduced_motion);
  b.stuck = b.pos.distanceTo(b.prev) < 0.01 && dist > 4 && !waiting ? b.stuck + dt : 0;
  if (b.stuck > 2 && b.crumbs.length > 1) { b.crumbs.shift(); b.stuck = 0; }
  // recover only far behind the view: no visible pop into the camera foreground
  if (dist > 32 && !inView(b.pos)) warp(b, lead.pos.x - 1.5, lead.pos.y, lead.pos.z + 1.4);
  b.prev.copy(b.pos);
  pal.group.position.copy(b.pos);
  pal.title = follower() === 'swan' ? 'Swan' : 'Mnki';
}
const frustum = new THREE.Frustum(); const pv = new THREE.Matrix4();
function inView(p) {
  pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(pv);
  return frustum.containsPoint(new THREE.Vector3(p.x, p.y + 1, p.z));
}

function updateCamera() {
  const b = bodies[leader];
  const pivot = new THREE.Vector3(b.pos.x, b.pos.y + 1.38, b.pos.z);
  const off = new THREE.Vector3(0, 0, game.arm).applyEuler(new THREE.Euler(game.pitch, game.yaw, 0, 'YXZ'));
  camera.position.copy(pivot).add(off);
  camera.position.y = Math.max(camera.position.y, groundOf(b) + 0.3);
  camera.lookAt(pivot);
}

// ---- interaction ----
function scan() {
  if (game.target) game.target.ring.visible = false;
  game.target = null;
  const me = bodies[leader].pos;
  let best = 1e4;
  for (const n of world.interactables) {
    if (n === pal && game.fishing) continue;
    const p = n.group.getWorldPosition(new THREE.Vector3());
    const dist = Math.hypot(me.x - p.x, me.z - p.z);
    if (dist > n.reach || Math.abs(p.y - me.y) > 2) continue;
    let score = dist - n.priority;
    if (n.kind === 'gather' && !state.available(n.id)) score += 2;
    if (n.kind === 'swan') score += 0.9;
    if (score < best) { best = score; game.target = n; }
  }
  if (game.target && !game.fishing) game.target.ring.visible = true;
}
function locateRegion() {
  let r = REGIONS[9];
  if (!state.data.interior) {
    const me = bodies[leader].pos;
    let best = Infinity;
    for (const x of REGIONS) { const d = (me.x - x.p[0]) ** 2 + (me.z - x.p[1]) ** 2; if (d < best) { best = d; r = x; } }
  }
  game.region = r;
  if (r.id !== game.regionId) {
    game.regionId = r.id;
    if (state.discover(r.id)) ui.banner(r.name, r.subtitle);
  }
}

function perform(n) {
  const me = bodies[leader].pos;
  const p = n.group.getWorldPosition(new THREE.Vector3());
  if (Math.hypot(me.x - p.x, me.z - p.z) > n.reach || ui.isOpen) return;
  switch (n.kind) {
    case 'gather': if (state.gather(n.id, n.item)) { sound.play('pick'); chars[leader].reaction = 0.5; } break;
    case 'plot':
      if (!state.data.plots[n.id]) state.plant(n.id, state.selectedCrop);
      else if (!state.data.plots[n.id].watered) state.water(n.id);
      else if (!state.harvest(n.id)) ui.toast(`${promptOf(n, state)} · water and time are all it needs.`);
      sound.play('pick');
      break;
    case 'fish': startFishing(); break;
    case 'npc': { const info = NPCS.find((x) => x.id === n.id); if (info) ui.dialogue(info.name, info.line); break; }
    case 'swan': ui.dialogue(pal.title, follower() === 'swan' ? swanLine() : mnkiLine(), follower()); break;
    case 'animal': ui.animalMenu(n.id); break;
    case 'guardian':
      state.guardian(n.id);
      ui.dialogue(`${n.title} Guardian`, `${GUARDIAN_LINES[n.id]}\n\nThree acts of care open a path. Return to the village board when all three are remembered.`);
      break;
    case 'stall': ui.open('shop'); break;
    case 'board': ui.open('board'); break;
    case 'home': enterHome(); break;
    case 'home_menu': ui.open('home'); break;
    case 'exit': exitHome(); break;
    case 'upstairs': warp(bodies[leader], 154, 4.12, 0); warp(bodies[follower()], 152, 4.12, 0); break;
    case 'downstairs': warp(bodies[leader], 154, 0.12, 0); warp(bodies[follower()], 152, 0.12, 0); break;
    default:
  }
}
function enterHome() {
  state.data.interior = true;
  warp(bodies[leader], 150, 0.12, 2); warp(bodies[follower()], 148.4, 0.12, 2);
  game.arm = 4;
  ui.toast('Our treehouse · Rest, keep treasures, and make it ours.');
}
function exitHome() {
  state.data.interior = false;
  warp(bodies[leader], -14, 0.15, 20); warp(bodies[follower()], -15.5, 0.15, 20);
  game.arm = 6.3;
}
function swanLine() {
  const d = state.data;
  if (d.flags.includes('festival')) return 'We made this place a little better than we found it. I think that’s something worth celebrating.';
  if (d.interior) return 'A lantern, a little fern, a place for our memories. There’s no right way to make a home — only our way.';
  switch (game.regionId) {
    case 'pond': return 'Listen. The water sounds different when the wind turns. I’ll wait beside you while you fish.';
    case 'farm': return 'Let them come to us. Sometimes being gentle is the most useful thing we can do.';
    case 'market': return 'Our own little stall. We could sell what we’ve gathered, or keep something aside for a neighbor.';
    case 'paddy': return 'We can water these now, then take a walk. There’s no need to stand here watching them grow.';
    default: return 'The market feels a little sleepy today. Shall we bring something fresh for the neighbors? There’s a request board in Village Park.';
  }
}
function mnkiLine() {
  const d = state.data;
  if (d.flags.includes('festival')) return 'Lanterns everywhere! I told you we could do it. Well — you told me, and then we did it.';
  if (d.interior) return 'Our very own treehouse. I’m keeping the window seat. You can have the other window seat.';
  switch (game.regionId) {
    case 'pond': return 'I’ll be very, very quiet. The fish won’t even know a monkey king is here.';
    case 'farm': return 'The hens like my tail. Or they think it’s a worm. Either way, we’re friends.';
    case 'market': return 'Grown with care, shared with love. And a little bit of bargaining.';
    case 'berries': return 'One for the basket, one for me… okay, two for the basket.';
    default: return 'Where shall we go next? Every path here seems to lead somewhere nice.';
  }
}

// ---- fishing ----
let fishingVisual = null; let bobber = null;
function startFishing() {
  if (game.fishing) return;
  if (state.used() >= CAPACITY) { ui.toast('Make a little room in your bag before casting.'); return; }
  game.fishing = { t: 0, biteAt: 3 + ((state.metric('caught') * 0.73) % 2), bite: false };
  game.frozen = true;
  const b = bodies[leader];
  chars[leader].reaction = 0.9;
  chars[leader].root.rotation.y = Math.PI;
  fishingVisual = new THREE.Group();
  scene.add(fishingVisual);
  const hand = [b.pos.x + 0.3, b.pos.y + 1.0, b.pos.z];
  const tip = [b.pos.x + 0.3, b.pos.y + 2.4, b.pos.z - 2.8];
  S.rod(fishingVisual, hand, tip, 0.025, '#a68b60');
  S.rod(fishingVisual, tip, [0, 0.3, -29.4], 0.008, '#efe8d3');
  bobber = new THREE.Group();
  bobber.position.set(0, 0.24, -29.4);
  fishingVisual.add(bobber);
  S.ball(bobber, [0, 0, 0], [0.15, 0.18, 0.15], '#d3745b');
  S.ball(bobber, [0, 0.06, 0], [0.13, 0.08, 0.13], '#f5e9cd');
  ui.toast('A quiet moment · wait for the golden bite cue, then press E.');
}
function reel() {
  if (!game.fishing) return;
  if (game.fishing.t < game.fishing.biteAt) { ui.toast('A little patience. Wait for the golden ring.'); return; }
  if (state.catchFish()) sound.play('pick');
  cancelFishing();
}
function cancelFishing() {
  if (fishingVisual) scene.remove(fishingVisual);
  fishingVisual = null; bobber = null;
  game.fishing = null;
  game.frozen = game.menu;
}

// ---- the loop ----
let scanT = 0; let autosave = 0; let last = performance.now(); let titleT = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  cooldown = Math.max(0, cooldown - dt);
  resize();
  if (game.playing) {
    if (!game.menu) {
      state.tick(dt);
      autosave += dt; scanT += dt;
      if (autosave >= 90) { game.saveWorld(); autosave = 0; }
      if (game.fishing) {
        const f = game.fishing;
        f.t += dt;
        if (bobber) bobber.position.y = 0.24 + Math.sin(f.t * (f.bite ? 10 : 2)) * 0.055;
        const windowS = state.settings.easy_fishing ? 4.5 : 2.2;
        if (f.t >= f.biteAt && !f.bite) { f.bite = true; sound.play('bite'); }
        if (f.t > f.biteAt + windowS) { cancelFishing(); ui.toast('It slipped away. No worries — there’s always another fish.'); }
      }
      if (scanT >= 0.15) { scanT = 0; scan(); locateRegion(); }
    }
    updateLeader(game.menu ? 0 : dt);
    updateFollower(game.menu ? 0 : dt);
    updateCamera();
    world.update(game.menu ? 0 : dt, bodies[leader].pos);
    ui.updateHud();
  } else {
    // the title: a slow drift over the village
    titleT += dt;
    const a = 0.65 + Math.sin(titleT * 0.05) * 0.25;
    camera.position.set(-1 + Math.sin(a) * 52, 24, 7 + Math.cos(a) * 44);
    camera.lookAt(-1, 0, 7);
    world.update(0, new THREE.Vector3(-1, 0, 7));
    for (const k of ['mnki', 'swan']) { chars[k].root.position.copy(bodies[k].pos); chars[k].animate(dt, 0, true); }
  }
  ui.tick(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function resize() {
  const w = canvas.clientWidth; const h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
}
addEventListener('beforeunload', () => { if (game.playing) game.saveWorld(); });

/** Merge the static meshes under `root` (not under `keep`) into one mesh per material: thousands of props, few draws. */
function mergeStatic(root, keep) {
  root.updateWorldMatrix(true, true);
  const groups = new Map();
  const remove = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (keep.has(p)) return;
    if (o.geometry.attributes.uv) { /* fine */ }
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(o.matrixWorld);
    const key = o.material.uuid;
    if (!groups.has(key)) groups.set(key, { mat: o.material, geos: [], shadow: false });
    const e = groups.get(key);
    e.geos.push(g);
    e.shadow = e.shadow || o.castShadow;
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  for (const { mat, geos, shadow } of groups.values()) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = shadow; m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    scene.add(m);
  }
}

// a test hook (tools and the browser console): the game object and its parts
window.__cozy = { renderer, scene, game, state, world, bodies, warp: (x, z) => warp(bodies[leader], x, 0.1, z), swap, perform, enterHome, exitHome };
ui.buildTitle();
warp(bodies.mnki, -29, 0.1, -21);
warp(bodies.swan, -30.5, 0.1, -20);
requestAnimationFrame(frame);
