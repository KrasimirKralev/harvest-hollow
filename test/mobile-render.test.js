// mobile wave, render lane: the pure logic behind phones and tablets (no DOM, no sleeps): the device profile and its
// quality knobs, the touch framing and inertia, the finger pick, the zoom bands, blob shadows, and the loop's pauses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT } from './helpers.js';
import { TILE_M } from '../shared/content/config.js';
import { setManifest } from '../public/js/render/assets.js';
import { QUALITY, PROFILES, qualityOf, deviceProfile, bootTier, startLoop, WANT } from '../public/js/render/renderer.js';
import { CAM, TOUCH, framingFor, pitchFor, clampTarget, centredInset, createCamera } from '../public/js/render/camera.js';
import { pickNear, probeRing, TOUCH_PICK } from '../public/js/render/picking.js';
import { lodDistance } from '../public/js/render/index.js';
import { bandFor } from '../public/js/render/lod.js';
import { blobShadow } from '../public/js/render/ground.js';
import { createBatch, mirrorBatch } from '../public/js/render/instancing.js';

setManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8')));
const DEG = Math.PI / 180;

test('device profile: a coarse primary pointer is touch; the short side tells a phone from a tablet; the GPU ranks it', () => {
  assert.deepEqual(deviceProfile({ coarse: false, fine: true, w: 1920, h: 1080 }), { kind: 'desktop', gpu: 'high' });
  assert.deepEqual(deviceProfile({ coarse: false, fine: true, touchPoints: 10, w: 1366, h: 768 }), { kind: 'desktop', gpu: 'high' },
    'a touch laptop with a mouse stays a desktop');
  assert.equal(deviceProfile({ coarse: true, w: 412, h: 915 }).kind, 'phone');
  assert.equal(deviceProfile({ coarse: true, w: 915, h: 412 }).kind, 'phone', 'landscape too');
  assert.equal(deviceProfile({ coarse: true, w: 834, h: 1194 }).kind, 'tablet');
  assert.equal(deviceProfile({ coarse: false, fine: false, touchPoints: 5, w: 390, h: 844 }).kind, 'phone', 'no media query: touch points');
  const gpu = (g, extra = {}) => deviceProfile({ coarse: true, w: 412, h: 915, gpu: g, ...extra }).gpu;
  assert.equal(gpu('Mali-G710'), 'high');
  assert.equal(gpu('Apple GPU'), 'high');
  assert.equal(gpu('Adreno (TM) 740'), 'high');
  assert.equal(gpu('Adreno (TM) 619'), 'mid');
  assert.equal(gpu('Mali-G52 MC2'), 'low');
  assert.equal(gpu('Adreno (TM) 506'), 'low');
  assert.equal(gpu('PowerVR Rogue GE8320'), 'low');
  assert.equal(gpu(''), 'mid', 'a hidden name is mid');
  assert.equal(gpu('', { memory: 2 }), 'low', 'two gigabytes rank low');
  assert.equal(gpu('', { memory: 8 }), 'high');
});

test('quality knobs: a desktop keeps QUALITY exactly; phones cap the pixel ratio at 1.5 and drop the shadow map', () => {
  for (const t of ['high', 'medium', 'low']) {
    const d = qualityOf(t, 'desktop');
    for (const k of Object.keys(QUALITY[t])) assert.equal(d[k], QUALITY[t][k], `desktop ${t}.${k} unchanged`);
    assert.equal(d.panShadows, true);
    assert.equal(d.lodK, 1);
    assert.equal(d.skinned, 8);
    assert.equal(d.scenery, t, 'the backdrop density by tier name, as before');
    const p = qualityOf(t, 'phone');
    assert.ok(p.pixelRatio <= 1.5, `phone ${t} pixel ratio ${p.pixelRatio}`);
    assert.equal(p.shadowMap, 0, 'no shadow map on phones (blob shadows instead)');
    assert.equal(p.panShadows, false, 'never a shadow refresh while panning');
    assert.ok(p.lodK < 1, 'zoom bands pulled in');
    assert.ok(p.skinned < 8);
    const tb = qualityOf(t, 'tablet');
    assert.ok(tb.pixelRatio <= 2);
    assert.equal(tb.panShadows, false);
  }
  assert.equal(qualityOf('high', 'phone').pixelRatio, 1.5);
  assert.equal(qualityOf('high', 'tablet').pixelRatio, 2);
  assert.equal(qualityOf('nonsense', 'phone').pixelRatio, PROFILES.phone.high.pixelRatio, 'an unknown tier reads as high');
});

test('boot tier: touch devices never boot above their GPU rank; an explicit tier and a desktop are as asked', () => {
  assert.equal(bootTier('auto', { kind: 'phone', gpu: 'low' }), 'low');
  assert.equal(bootTier('auto', { kind: 'phone', gpu: 'mid' }), 'medium');
  assert.equal(bootTier('auto', { kind: 'tablet', gpu: 'high' }), 'high');
  assert.equal(bootTier('high', { kind: 'phone', gpu: 'low' }), 'high', 'the player asked for High');
  assert.equal(bootTier('auto', { kind: 'desktop', gpu: 'high' }), 'high');
  assert.equal(bootTier('medium', { kind: 'desktop', gpu: 'high' }), 'medium');
});

test('touch framing: a finger-sized ground scale, a steeper portrait look, a desktop untouched', () => {
  const desk = framingFor({ w: 1366, h: 768, touch: false });
  assert.deepEqual(desk, { defDist: CAM.defDist, minDist: CAM.minDist, maxDist: CAM.maxDist, pitchAdd: 0, touch: false });
  const scale = (f, h) => (h / 2) / (f.defDist * Math.tan((CAM.fov / 2) * DEG));
  const portrait = framingFor({ w: 412, h: 915, touch: true, kind: 'phone' });
  assert.ok(Math.abs(scale(portrait, 915) - TOUCH.scale) < 0.01, 'TOUCH.scale CSS px per metre');
  assert.ok(TOUCH.scale * 2 * Math.SQRT2 >= 44, 'a plot (2 m) is a >= 44 px diamond: a finger target');
  assert.equal(portrait.pitchAdd, TOUCH.portraitPitch, 'portrait looks down steeper');
  assert.ok(portrait.maxDist > CAM.maxDist && portrait.maxDist <= TOUCH.maxDist, 'and may zoom out further');
  const land = framingFor({ w: 915, h: 412, touch: true, kind: 'phone' });
  assert.equal(land.pitchAdd, 0, 'landscape keeps the desktop pitch curve');
  assert.ok(land.defDist < portrait.defDist, 'a short landscape view comes closer');
  assert.ok(Math.abs(scale(land, 412) - TOUCH.scale) < 0.01, 'the same ground scale both ways');
  assert.ok(Math.abs(pitchFor(50, 4) - pitchFor(50) - 4 * DEG) < 1e-12);
});

test('touch camera: the first visit frames by the screen; a turn keeps the ground scale; a toolbar resize does not', () => {
  const cam = createCamera(undefined, { touch: true, kind: 'phone' });
  cam.resize(412 / 915, { w: 412, h: 915 });
  const d0 = cam.get().dist;
  assert.ok(Math.abs(d0 - framingFor({ w: 412, h: 915, touch: true }).defDist) < 1e-9, 'the framing default on a first visit');
  cam.resize(915 / 412, { w: 915, h: 412 });
  assert.ok(Math.abs(cam.get().dist - d0 * 412 / 915) < 1e-6, 'turned to landscape: distance x height ratio');
  cam.resize(412 / 915, { w: 412, h: 915 });
  assert.ok(Math.abs(cam.get().dist - d0) < 1e-6, 'and back');
  cam.resize(412 / 800, { w: 412, h: 800 });
  assert.ok(Math.abs(cam.get().dist - d0) < 1e-6, 'a toolbar or the keyboard (no turn): the distance stays');
  const desk = createCamera();
  desk.resize(1366 / 768, { w: 1366, h: 768 });
  assert.equal(desk.get().dist, CAM.defDist, 'a desktop camera ignores the size');
  assert.equal(desk.fling(), false, 'and never glides');
});

test('centred bounds: a touch view keeps the farm in sight, never past the land centre; a desktop clamp is unchanged', () => {
  const b = { x0: 16, z0: 16, x1: 40, z1: 40 };
  assert.deepEqual(clampTarget({ x: 0, z: 200 }, b), { x: 16 * TILE_M - CAM.margin, z: 40 * TILE_M + CAM.margin });
  const inset = centredInset(40, 915 / 412);
  assert.ok(inset > 5, `a wide landscape view keeps ${inset.toFixed(1)} m in`);
  const c = clampTarget({ x: 0, z: 200 }, b, inset);
  assert.ok(Math.abs(c.x - (16 * TILE_M - CAM.margin + inset)) < 1e-9);
  const mid = clampTarget({ x: 0, z: 0 }, b, 500);
  assert.deepEqual(mid, { x: 28 * TILE_M, z: 28 * TILE_M }, 'a huge inset pins the centre, never inverts the range');
  assert.ok(centredInset(85, 412 / 915) < 2, 'a narrow portrait view needs next to none');
});

test('inertia: a released touch pan glides on, eases out, stops at the land\'s edge, and stops for a finger', () => {
  const cam = createCamera({ x: 56, z: 64 }, { touch: true, kind: 'phone' });
  cam.resize(412 / 915, { w: 412, h: 915 });
  cam.setBounds({ x0: 0, z0: 0, x1: 64, z1: 64 });
  cam.update(1 / 60);
  assert.equal(cam.fling(null), false);
  assert.equal(cam.fling({ vx: 0.5, vz: 0 }), false, 'a creep is no glide');
  const t0 = cam.get();
  assert.equal(cam.fling({ vx: 12, vz: 0 }), true);
  let frames = 0;
  for (; frames < 300 && cam.framing.gliding; frames++) cam.update(1 / 60);
  const t1 = cam.get();
  const moved = t1.tx - t0.tx;
  assert.ok(moved > (12 / TOUCH.friction) * 0.85 && moved < (12 / TOUCH.friction) * 1.05, `about v / friction: ${moved.toFixed(2)} m`);
  assert.ok(frames < 90, `at rest within 1.5 s (${frames} frames)`);
  assert.equal(Math.abs(t1.tz - t0.tz) < 1e-9, true, 'straight on');
  // a wild flick is capped, and the land's edge stops it
  cam.fling({ vx: 1e4, vz: 0 });
  for (let i = 0; i < 600 && cam.framing.gliding; i++) cam.update(1 / 60);
  const t2 = cam.get();
  assert.ok(t2.tx <= 64 * TILE_M + CAM.margin + 1e-9, 'never past the bounds');
  assert.ok(t2.tx - t1.tx <= (TOUCH.maxSpeed / TOUCH.friction) * 1.06, 'capped at TOUCH.maxSpeed (one frame of discrete decay)');
  cam.fling({ vx: -20, vz: 0 });
  cam.update(1 / 60);
  cam.stop();
  assert.equal(cam.framing.gliding, false, 'a finger on the glass stops it');
  cam.fling({ vx: -20, vz: 0 });
  cam.pan(0.1, 0);
  assert.equal(cam.framing.gliding, false, 'and so does any pan');
});

test('finger picking: bare ground near an object picks the object; exact hits, land for sale and the wild stay exact', () => {
  const size = { w: 400, h: 800 };
  const r = probeRing({ x: 0, y: 0 }, size, 12, 8);
  assert.equal(r.length, 8);
  assert.ok(Math.abs(r[0].y - (2 * 12) / 800) < 1e-12 && Math.abs(r[0].x) < 1e-12, 'starts straight above, r CSS px');
  assert.ok(TOUCH_PICK.radii[1] <= 20, 'never further than a fingertip');
  // a plot occupies everything above ndc.y 0.02 (about 8 CSS px up)
  const at = (land = 'owned', extra = {}) => (n) => (n.y > 0.02 ? { kind: 'object', id: 'plot1', x: 3, z: 4, px: 3.5, pz: 4.5 }
    : { kind: 'tile', x: 3, z: 5, px: 3.2, pz: 5.1, land, ...extra });
  const p = pickNear(at(), { x: 0, y: 0 }, size);
  assert.equal(p.id, 'plot1', 'the plot 8 px above the finger');
  assert.ok(p.near <= TOUCH_PICK.radii[1]);
  assert.equal(p.px, 3.2, 'the ground point stays the finger\'s own (panning, the cursor)');
  assert.equal(p.near, TOUCH_PICK.radii[0]);
  assert.equal(pickNear(at(), { x: 0, y: 0.5 }, size).id, 'plot1', 'an exact hit is untouched');
  assert.equal(pickNear(at('sale'), { x: 0, y: 0 }, size).kind, 'tile', 'land for sale keeps its card');
  assert.equal(pickNear(at('owned', { place: 'fair' }), { x: 0, y: 0 }, size).kind, 'tile', 'a world place keeps its panel');
  assert.equal(pickNear(at(), { x: 0, y: -0.5 }, size).kind, 'tile', 'open ground far from anything walks there');
  assert.equal(pickNear(at(), { x: 0, y: 0 }, size, { accept: () => false }).kind, 'tile', 'a fence or a path beside the finger: it walks');
  // majority: two objects in the ring, the one most probes hit wins
  const two = (n) => (n.x > 0.03 ? { kind: 'object', id: 'big', x: 5, z: 5 } : n.y > 0.02 ? { kind: 'object', id: 'small', x: 3, z: 4 }
    : { kind: 'tile', x: 3, z: 5, px: 0, pz: 0, land: 'owned' });
  assert.equal(pickNear(two, { x: 0, y: 0 }, size).id, 'big', `three probes beat one: ${pickNear(two, { x: 0, y: 0 }, size).id}`);
});

test('zoom bands on a touch screen: the same ground scale as a desktop, pulled in by lodK; a desktop is unchanged', () => {
  assert.equal(lodDistance(55, { kind: 'desktop', cssH: 1080 }), 55);
  assert.equal(lodDistance(55, { kind: 'phone', lodK: 1, cssH: 768 }), 55, 'a 768 px tall view is the reference');
  const portrait = lodDistance(30, { kind: 'phone', lodK: 0.8, cssH: 915 });
  assert.ok(Math.abs(portrait - 30 * (768 / 915) / 0.8) < 1e-9);
  assert.equal(bandFor(lodDistance(85, { kind: 'phone', lodK: 0.8, cssH: 915 })), 'far', 'the phone overview uses the light crops');
  assert.equal(bandFor(lodDistance(25, { kind: 'phone', lodK: 0.8, cssH: 915 })), 'near', 'a close look keeps every detail');
});

test('blob shadows: cast away from the sun, longer for taller things, none for flat objects or a sun below the horizon', () => {
  const sun = [-0.57, 0.8, 0.23];
  const o = { x: 10, z: 10 };
  const b = blobShadow(o, 3, 3, 5, sun);
  assert.ok(b.ux > 0 && b.uz < 0, 'away from the sun');
  assert.ok(Math.abs(Math.hypot(b.ux, b.uz) - 1) < 1e-9);
  const cx = 11.5 * TILE_M;
  assert.ok(b.cx > cx, 'the blob sits beside the footprint, toward the shadow');
  assert.ok(b.la > b.lb, 'stretched along the shadow');
  assert.ok(blobShadow(o, 3, 3, 8, sun).la > b.la, 'taller: longer');
  assert.equal(blobShadow(o, 1, 1, 0.3, sun), null, 'flat');
  assert.equal(blobShadow(o, 1, 1, 5, [0.3, -0.2, 0.1]), null, 'night below the horizon');
  assert.ok(b.k > 0 && b.k <= 0.62);
});

test('loop pauses: a hidden page draws nothing and runs no timers; a lost context waits for its restore', async () => {
  let cb = null;
  const renderer = { setAnimationLoop: (fn) => { cb = fn; } };
  const listeners = {};
  const prevDoc = globalThis.document;
  globalThis.document = { hidden: false, hasFocus: () => true, addEventListener: (k, fn) => { listeners[k] = fn; }, removeEventListener: (k) => { delete listeners[k]; } };
  try {
    let renders = 0;
    const stop = startLoop({ renderer, want: () => WANT.INTERACTIVE, frame: () => { renders++; }, isDirty: () => true, clearDirty: () => {},
      blurred: () => false, ambientFps: () => 30, interactiveFps: () => 60, napMs: 10 });
    for (let i = 0; i < 10; i++) cb(1000 + i * 16.7);
    assert.ok(renders >= 9);
    globalThis.document.hidden = true;
    listeners.visibilitychange();
    assert.equal(cb, null, 'hidden: no animation frames');
    assert.equal(stop.paused(), true);
    stop.kick();
    assert.equal(cb, null, 'input while hidden does not restart it');
    globalThis.document.hidden = false;
    listeners.visibilitychange();
    assert.equal(typeof cb, 'function', 'visible again: frames resume');
    const n = renders;
    cb(9000);
    assert.equal(renders, n + 1, 'the first frame after a resume renders at once');
    stop.pause('lost');
    assert.equal(cb, null);
    stop.resume('hidden');                       // a reason that does not hold changes nothing
    assert.equal(cb, null, 'still lost');
    stop.resume('lost');
    assert.equal(typeof cb, 'function', 'restored');
    stop();
    assert.equal(listeners.visibilitychange, undefined, 'stop() unhooks the page listener');
  } finally {
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
  }
});

test('the windmill\'s spinning sails no longer redraw the static shadow map every frame', () => {
  const mat = new THREE.MeshBasicMaterial();
  const src = createBatch({ name: 'src', material: mat, instances: 8, vertices: 1 << 10, indices: 1 << 11 });
  const dst = createBatch({ name: 'dst', material: mat, instances: 8, vertices: 1 << 10, indices: 1 << 11 });
  mirrorBatch(src, dst, (k) => k);
  const g = new THREE.BoxGeometry(1, 1, 1);
  src.define('box', g);
  const h = src.add('box', new THREE.Matrix4());
  let shadowDirty = 0;
  dst.onChange(() => { shadowDirty++; });
  const m = new THREE.Matrix4().makeRotationZ(0.3);
  src.setMatrixOwn(h, m);
  assert.equal(shadowDirty, 0, 'the twin (the shadow caster) stays put');
  src.setMatrix(h, m);
  assert.equal(shadowDirty, 1, 'a real move still reaches the shadow');
});
