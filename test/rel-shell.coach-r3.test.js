// QA r3, ui-shell: Grandma's first session at 360 BG.
//   S3-01 (fbp#1, must): "Feed the hens": the free Feed Mill's ghost started between the camera and the Coop; the mill's
//         silo then took every tap under the arrow on the Coop (the arrow's point, the Coop's middle, picked the mill).
//   S3-02 (fbp#2, must): her line cut with "…" at 360 BG in three steps (clamped at three lines, two with a tray).
//   S3-03 (fbp#3, must): her ready-time row ran under her "⋯" once the farm was named.
//   S3-04 (fbp#5): the edge arrow lay on her card (pop-up open) and on a quest card's words.
//   S3-05 (fbp#6): her card covered the Harvey caption (360) and the turn button (iPhone 13).
//   S3-07 (fbp#8): with a build step waiting the phone's pop-up opened a 96 px band and pushed her card up.
//   S3-08 (fbp#9): the phone's seed picker showed a bare clock ("Морков 3 14:37"), read as the time now.
//   S3-12 (jde#5, oib#2): a panel's first-use tip lay under the panel (z 10 under z 40) and was used up unseen.
//   S3-14 (jde#8): the first frame after Play showed tan placeholder boxes (the join path never waited for the view).
//   S3-16 (oib#4): landscape with the keyboard up: the rename field, the Market's Sell, the animal's name field.
//   S3-18 (fbp#15): the tool slot's seed sat on its word at 360.
// The browser numbers for the layout items are in docs/qa/release/qa-r3/fix-ui-shell.md (the probe's runs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { TILE_M } from '../shared/content/config.js';
import { defOf } from '../shared/content/index.js';
import { footprint, tileOwner } from '../shared/rules/grid.js';
import { rayPick } from '../public/js/render/picking.js';
import { controllerRig } from './helpers/ui-shell.js';

const CTL = await import('../public/js/game/controller.js');
const TUT = await import('../public/js/ui/tutorial.js');

// pick boxes of the two buildings (render/objects-view.js proxies: the model's bounds over its footprint); the Feed
// Mill's silo is the tall one
const HEIGHT = { coop: 3.0, feed_mill: 7.0 };
const W = 360;
const H = 640;

/** A game camera (render/camera.js: FOV 30, the eye at target + (sin yaw, cos yaw)) looking at `target` (tiles). */
function cameraAt(yaw, target, dist = 40) {
  const cam = new THREE.PerspectiveCamera(30, W / H, 1, 900);
  const p = (44 * Math.PI) / 180;
  const tx = target.x * TILE_M;
  const tz = target.z * TILE_M;
  cam.position.set(tx + Math.sin(yaw) * Math.cos(p) * dist, Math.sin(p) * dist, tz + Math.cos(yaw) * Math.cos(p) * dist);
  cam.lookAt(tx, 0, tz);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/** toScreen / pick over `state` from camera `cam`: the buildings' boxes first, then the tile's owner (render/picking.js). */
function scene(state, cam) {
  const toScreen = (x, z, y = 0) => {
    const v = new THREE.Vector3(x * TILE_M, y, z * TILE_M).project(cam);
    return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H, visible: v.z < 1 };
  };
  const proxies = () => Object.entries(state.farm.objects).filter(([, o]) => HEIGHT[o.def] && Number.isFinite(o.x)).map(([id, o]) => {
    const [w, d] = footprint(defOf(o.def), o.rot || 0);
    return { id, box: new THREE.Box3(new THREE.Vector3(o.x * TILE_M, 0, o.z * TILE_M), new THREE.Vector3((o.x + w) * TILE_M, HEIGHT[o.def], (o.z + d) * TILE_M)) };
  });
  const rc = new THREE.Raycaster();
  const pick = (ndc) => {
    rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
    const top = rayPick(rc.ray, { proxies: proxies() });
    if (top) return { kind: 'object', id: top.id };
    const hit = new THREE.Vector3();
    if (!rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    const x = Math.floor(hit.x / TILE_M);
    const z = Math.floor(hit.z / TILE_M);
    const id = tileOwner(state, x, z);
    return id ? { kind: 'object', id, x, z } : { kind: 'tile', x, z };
  };
  const pickAt = (sx, sy) => pick({ x: (sx / W) * 2 - 1, y: -((sy / H) * 2 - 1) });
  return { toScreen, pick, pickAt };
}

test('S3-01: standing() tells side by side, behind and in front for every quarter turn', () => {
  assert.equal(typeof CTL.standing, 'function', 'game/controller.js standing(a, b, yaw)');
  const coop = { x: 29, z: 28, w: 3, d: 3 };
  // the tester's frame: the default turn (yaw 45 deg), the Mill at (32, 29) east of the Coop, in front of it
  assert.equal(CTL.standing({ x: 32, z: 29, w: 3, d: 3 }, coop, Math.PI / 4), 'front');
  for (let k = 0; k < 4; k++) {
    const yaw = Math.PI / 4 + k * (Math.PI / 2);
    const cam = [Math.sin(yaw), Math.cos(yaw)];
    const at = (s) => ({ x: Math.round(coop.x + s[0] * 4), z: Math.round(coop.z + s[1] * 4), w: 3, d: 3 });
    assert.equal(CTL.standing(at([cam[0], cam[1]]), coop, yaw), 'front', `turn ${k}: towards the eye`);
    assert.equal(CTL.standing(at([-cam[0], -cam[1]]), coop, yaw), 'behind', `turn ${k}: away from the eye`);
    assert.equal(CTL.standing(at([cam[1] * 1.6, -cam[0] * 1.6]), coop, yaw), 'side', `turn ${k}: across the screen`);
    const part = { x: coop.x + cam[1] * 3 + cam[0] * 2, z: coop.z - cam[0] * 3 + cam[1] * 2, w: 3, d: 3 };
    assert.equal(CTL.standing(part, coop, yaw), 'partial', `turn ${k}: in front of one side only`);
  }
});

test('S3-01: the Feed Mill\'s ghost starts where the Coop\'s middle still picks the Coop, at every quarter turn', async () => {
  for (let k = 0; k < 4; k++) {
    const yaw = Math.PI / 4 + k * (Math.PI / 2);
    const r = await controllerRig();
    const st = r.store.state;
    // the Coop at the tester's tile, placed for free by the rules
    const res = r.store.act('place', { def: 'coop', x: 29, z: 28, rot: 0 });
    assert.notEqual(res && res.ok, false, `the Coop placed (${res && res.code})`);
    r.h.flush();
    const coopId = Object.keys(r.store.state.farm.objects).find((id) => r.store.state.farm.objects[id].def === 'coop');
    // the camera on the Coop from this turn, the Coop high on a 360 x 640 screen (the tester's frame)
    const cam = cameraAt(yaw, { x: 30.5 + Math.sin(yaw) * 3.5, z: 29.5 + Math.cos(yaw) * 3.5 });
    const sc = scene(r.store.state, cam);
    r.w.view.camera.get = () => ({ tx: 0, tz: 0, dist: 40, yaw, pitch: 0.77 });
    r.w.view.toScreen = sc.toScreen;
    r.w.view.pick = sc.pick;
    r.w.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });
    const builds = [];
    r.c.on('build', (b) => builds.push(b));
    assert.equal(r.c.place('feed_mill'), true);
    const b = builds.at(-1);
    assert.ok(b && b.valid, `turn ${k}: the ghost starts on a free spot`);
    const placed = r.store.act('place', { def: 'feed_mill', x: b.x, z: b.z, rot: b.rot ?? 0 });
    assert.notEqual(placed && placed.ok, false);
    r.h.flush();
    void st;
    const mid = sc.toScreen(30.5, 29.5, 0.3);
    const hit = sc.pickAt(mid.x, mid.y);
    assert.equal(hit?.id, coopId, `turn ${k} (yaw ${Math.round((yaw * 180) / Math.PI)}): the Coop's middle picks the Coop, `
      + `not the mill at ${b.x},${b.z} (HEAD: the first free spot round the Coop, in front of it at the default turn)`);
  }
});

test('S3-01: the arrow points where the farm\'s pick finds its target (a building in front of the Coop)', async () => {
  assert.equal(typeof TUT.pickablePoint, 'function', 'ui/tutorial.js pickablePoint(state, id, see)');
  const r = await controllerRig();
  r.store.act('place', { def: 'coop', x: 29, z: 28, rot: 0 });
  r.store.act('place', { def: 'feed_mill', x: 32, z: 29, rot: 0 });      // the tester's Mill, in front at yaw 45 deg
  r.h.flush();
  const st = r.store.state;
  const coopId = Object.keys(st.farm.objects).find((id) => st.farm.objects[id].def === 'coop');
  const millId = Object.keys(st.farm.objects).find((id) => st.farm.objects[id].def === 'feed_mill');
  const cam = cameraAt(Math.PI / 4, { x: 30.5 + Math.sin(Math.PI / 4) * 3.5, z: 29.5 + Math.cos(Math.PI / 4) * 3.5 });
  const sc = scene(st, cam);
  const mid = sc.toScreen(30.5, 29.5, 0.3);
  assert.equal(sc.pickAt(mid.x, mid.y)?.id, millId, 'the repro: the Coop\'s middle picks the mill in front of it');
  const p = TUT.pickablePoint(st, coopId, { toScreen: sc.toScreen, pickAt: sc.pickAt });
  const s = sc.toScreen(p.x, p.z, p.y);
  assert.equal(sc.pickAt(s.x, s.y)?.id, coopId, 'the arrow\'s point picks the Coop');
  // nothing in front: the middle, as before
  const p2 = TUT.pickablePoint(st, millId, { toScreen: sc.toScreen, pickAt: sc.pickAt });
  assert.deepEqual([p2.x, p2.z, p2.y], [33.5, 30.5, 0.3]);
  // no pick (a test view, the farmhouse room): the middle
  assert.deepEqual(TUT.pickablePoint(st, coopId), { x: 30.5, z: 29.5, y: 0.3 });
});

const mobile = fs.readFileSync(new URL('../public/css/mobile.css', import.meta.url), 'utf8');
const shellCss = fs.readFileSync(new URL('../public/css/shell.css', import.meta.url), 'utf8');

test('S3-02: on an upright phone her line takes four lines, three with a tray or the pop-up open', () => {
  assert.match(mobile, /\.coach \.line \{ -webkit-line-clamp: 4; \}\n\s+body\.tray-open \.coach \.line \{ -webkit-line-clamp: 3; \}/,
    'HEAD: three, two with a tray ("…в…", "(става и пшеницата…" at 360 BG)');
  assert.doesNotMatch(mobile, /body\.tray-open \.coach \.line \{ -webkit-line-clamp: 2; \}\n\s+\/\* Grandma's words take/);
});

test('S3-03: her count-down takes a line of its own rather than run under her "⋯"', () => {
  assert.match(mobile, /\.coach--line \.prog \{ min-width: 0; flex-wrap: wrap; row-gap: 2px; \}/);
  assert.match(mobile, /\.coach--line \.prog \.eta \{ white-space: normal; min-width: 0; \}/, 'HEAD: nowrap, 37 px under the ⋯');
});

test('S3-04: the edge arrow keeps above her card wherever it stands, and fades over a card it still meets', async () => {
  const TUT = await import('../public/js/ui/tutorial.js');
  // the tester's frame at 360: the pop-up lifted her card to 246-380; the mill off screen below
  const card = { left: 14, right: 345, top: 246, bottom: 380, width: 331, height: 134 };
  const [x, y, deg] = TUT.edgeTip({ x: 300, y: 900 }, 360, 640, 70, card);
  const box = TUT.arrowBox(x, y, deg);
  assert.ok(!TUT.overlaps(box, card, 0), `the edge arrow ${JSON.stringify(box)} on her card (HEAD: 211-281 x 284-339)`);
  const src = fs.readFileSync(new URL('../public/js/ui/tutorial.js', import.meta.url), 'utf8');
  // (QA r4 S4-04: it fades too where no spot clear of other objects is left: `!clear ||`)
  assert.match(src, /el\.classList\.toggle\('under-card', !clear \|\| Boolean\(\(card && overlaps\(box, card, 0\)\) \|\| \(cr && overlaps\(box, cr, 0\)\)\)\);/,
    'the edge branch fades on her card or a quest card (HEAD: only the in-view branch did)');
});

test('S3-05: the right column (Harvey, the turn button) is never under her card on an upright phone', () => {
  // owner 2026-10-19 (test/rel-shell.phone-edge.test.js): the column stands at the top of the edge lane, under the coins;
  // her card, the trays and the bar are all below it, so it no longer has to follow her card (HEAD: at 46 %, under it)
  assert.match(mobile, /\.hud-right \{ top: calc\(54px \+ var\(--sat\)\); \}/);
  assert.doesNotMatch(mobile, /\.hud-right \{ top: 46%; \}/);
});

test('S3-07: the pop-up keeps its rows; Строй leads it and the room for the arrow opens above it', () => {
  assert.doesNotMatch(mobile, /row-gap: 96px; padding-top: 98px/, 'HEAD: a 96 px band between the rows, 98 px over them');
  assert.match(mobile, /body\.tut-fly \.tool-flyout\.tool-pop \[data-act="build"\] \{ order: -1; \}/);
});

test('S3-08: the picker\'s short clock keeps its "ready" word', async () => {
  const SEEDS = await import('../public/js/ui/seeds.js');
  const tz = 'Europe/Sofia';
  const at = Date.UTC(2026, 9, 15, 11, 0);
  const short = SEEDS.readyText(at, 60 * 60_000, tz, { short: true });
  assert.match(short, /^by \d{1,2}:\d{2}$/, `the visible row says "by 15:00" (HEAD: a bare "${short.replace(/^by /, '')}")`);
  const bg = (await import('../public/js/i18n/bg/dock.js')).default;
  assert.equal(bg['dock.seed.clock'], 'до {t}');
});

test('S3-12: a panel\'s tip is a strip inside the panel, seen once it has been on screen 2 s', async () => {
  const { installDom } = await import('./ui-qa2-dom.js');
  const document = installDom();
  const TUT = await import('../public/js/ui/tutorial.js');
  assert.equal(typeof TUT.mountPanelTip, 'function', 'ui/tutorial.js mountPanelTip(frame, opts)');
  const frame = document.createElement('section');
  const tabs = document.createElement('div');
  tabs.className = 'hh-tabs';
  const scroll = document.createElement('div');
  scroll.className = 'hh-panel-scroll';
  frame.append(tabs, scroll);
  document.body.append(frame);
  const q = [];
  const setTimer = (fn, ms) => q.push([fn, ms]);
  let seen = 0;
  const el = TUT.mountPanelTip(frame, { label: 'Tip:', words: 'Wait for a bite.', closeLabel: 'Close', onSeen: () => { seen++; }, setTimer });
  assert.ok(el, 'a strip');
  assert.equal(frame.childNodes.indexOf(el), frame.childNodes.indexOf(scroll) - 1, 'between the tabs and the body, inside the sheet');
  assert.deepEqual(q.map(([, ms]) => ms), [TUT.PANEL_TIP_SEEN_MS]);
  q.shift()[0]();
  assert.equal(seen, 1, 'seen after 2 s on screen');
  // a sheet closed within 2 s: the tip comes again next time (HEAD: marked seen before it showed)
  const el2 = TUT.mountPanelTip(frame, { label: 'Tip:', words: 'x', closeLabel: 'Close', onSeen: () => { seen++; }, setTimer });
  assert.equal(frame.querySelectorAll('.panel-tip').length, 1, 'one strip at a time');
  el2.remove();
  q.shift()[0]();
  assert.equal(seen, 1, 'not seen');
  const el3 = TUT.mountPanelTip(frame, { label: 'Tip:', words: 'x', closeLabel: 'Close', onSeen: () => { seen++; }, setTimer });
  el3.querySelector('.panel-tip-x').click();
  assert.equal(frame.querySelector('.panel-tip'), null, 'its ✕ puts it away');
  assert.equal(seen, 2, 'a ✕ is a read: the tip is seen at once (else it came back on the next open)');
  q.shift()[0]();
  assert.equal(seen, 2, 'and only once');
  const src = fs.readFileSync(new URL('../public/js/ui/tutorial.js', import.meta.url), 'utf8');
  assert.match(src, /firstUse\(TIP_FOR_PANEL\[name\], \{ panel: name \}\)/, 'the panel tips go to their panel (HEAD: the coach column)');
  assert.match(shellCss, /\.hh-panel \.panel-tip \{/);
});

test('S3-14: a new farmer\'s Play puts the painting back until the first view is drawn', () => {
  const ix = fs.readFileSync(new URL('../public/js/ui/index.js', import.meta.url), 'utf8');
  assert.match(ix, /hideSlots\(\) \{[\s\S]*?if \(wasShown && !mods\) curtainForJoin\(\);/,
    'HEAD: hideSlots dropped the card and the curtain was already gone (tan boxes for 270-441 ms)');
  assert.match(ix, /function curtainForJoin\(\) \{[\s\S]*?b\.hidden = false;/);
});

test('S3-16: a field that is its own deed keeps only itself in view; the rename chips fold while its field has the focus', async () => {
  const { installDom } = await import('./ui-qa2-dom.js');
  const document = installDom();
  const UI = await import('../public/js/ui/index.js');
  const root = document.createElement('section');
  const field = document.createElement('input');
  field.dataset.keepInView = 'none';
  const collect = document.createElement('button');
  collect.textContent = 'Collect';
  root.append(field, collect);
  document.body.append(root);
  assert.equal(UI.buttonAfter(field, root), null, 'the animal\'s name field (HEAD: the animal\'s "Collect")');
  delete field.dataset.keepInView;
  assert.equal(UI.buttonAfter(field, root), collect, 'a field without a name keeps the old rule');
  assert.match(mobile, /#panel-naming:has\(input\.field:focus\) \.chips \{ display: none; \}/);
  // the Market's quantity with the keyboard up: the slip is sticky, so the field and Sell share one row and what lies
  // between folds while either has the focus (HEAD: "Продай 10" 120 px under the field, under the keyboard)
  const short = shellCss.slice(shellCss.indexOf('@media (max-height: 300px)'));
  const slip = '#panel-market .pn-slip:has(.pn-num:focus, .pn-sell-btn:focus)';
  for (const rule of [`${slip} { flex-flow: row wrap;`, `${slip} > :is(.pn-quick, .pn-slip-sum, .pn-slip-wanted, .pn-slip-note) { display: none; }`,
    `${slip} .pn-range { display: none; }`, `${slip} > .pn-act { flex: 1 1 0;`]) assert.ok(short.includes(rule), `the short screen's rule: ${rule}`);
});

test('S3-18: the seed on the armed Hand sits inside its picture on a phone', () => {
  assert.match(mobile, /\.tool \.crop-on \{ bottom: 3px; width: 24px; height: 24px; \}/, 'HEAD: bottom -4px, 3 px on "Wheat"');
});
