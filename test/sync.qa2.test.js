// QA wave 2 (client lane): regression tests for the client items of docs/qa/qa2/TRIAGE.md §3.
//   CL-01  a partner who left on horseback no longer holds the farm's only horse
//   CL-02  a stale tab's reload re-sends (same rules) or reports (new rules) what it predicted during a deploy
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createPeerTools } from '../public/js/net/peers.js';
import { reloadPlan, unsavedOf, noteUnsaved, unsavedText, contentGate } from '../public/js/net/content-gate.js';
import { RIDE_TOOL } from '../public/js/game/avatar.js';
import { xpForLevel } from '../shared/content/index.js';
import { canPlace } from '../shared/rules/grid.js';
import { MSG } from '../shared/net/protocol.js';
import { ROOT, coopHarness, eventTarget, fakeController } from './helpers/client.js';

const MAIN = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');

function inject(h, id, o) {
  for (const s of [h.state, h.a.store.state, h.b.store.state]) s.farm.objects[id] = structuredClone(o);
}
function stableFarm() {
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) { s.farm.xp = xpForLevel(25); s.farm.wallet.coins = 900_000; }
  const now = h.clock.now();
  let sp = null;
  for (let z = 20; z < 60 && !sp; z++) for (let x = 20; x < 60 && !sp; x++) if (canPlace(h.state, 'stable', x, z, 0) === null) sp = { x, z };
  inject(h, 'st1', { def: 'stable', x: sp.x, z: sp.z, rot: 0, placedAt: now, by: 'p1' });
  inject(h, 'hz0', { def: 'horse', home: 'st1', placedAt: now - 1e7, by: 'p1', adultAt: now - 1000, fedAt: now - 1000,
    readyAt: now + 6 * 3_600_000, cycle: 0, cut: 0 });
  return h;
}

// ---- CL-01 ---------------------------------------------------------------------------------------------------------
test('CL-01: peer tools follow presence, and a farmer who leaves (or is offline at the welcome) holds no tool', () => {
  const t = createPeerTools();
  const row = (pid, tool) => [pid, 10, 10, 0, 1, null, null, 1000, tool, 0];
  t.presence([row('p2', RIDE_TOOL)]);
  assert.equal(t.get('p2'), RIDE_TOOL);
  t.presence([row('p2', null)]);
  assert.equal(t.get('p2'), null, 'a pose without a tool clears it');
  t.presence([row('p2', RIDE_TOOL)]);
  t.online('p2', false);
  assert.equal(t.get('p2'), null, 'gone: the last row\'s horse no longer counts');
  t.presence([row('p2', RIDE_TOOL)]);
  assert.equal(t.get('p2'), null, 'a late row of a farmer who left does not bring the tool back');
  t.online('p2', true);
  t.presence([row('p2', RIDE_TOOL)]);
  assert.equal(t.get('p2'), RIDE_TOOL, 'back online: rows count again');
  t.welcome([{ pid: 'p2', online: false, pose: row('p2', RIDE_TOOL) }]);
  assert.equal(t.get('p2'), null, 'the welcome\'s last pose of an offline peer is not a rider');
  t.welcome([{ pid: 'p2', online: true, pose: row('p2', RIDE_TOOL) }]);
  assert.equal(t.get('p2'), RIDE_TOOL);
});

test('CL-01: after the rider leaves, the only horse is free again (controller.rideCode)', async () => {
  globalThis.window ??= eventTarget();
  const h = stableFarm();
  const peers = createPeerTools();
  const f = await fakeController(h.a, { peerTool: (pid) => peers.get(pid) });
  peers.presence([['p2', 20, 20, 0, 1, null, null, 1000, RIDE_TOOL, 0]]);
  assert.equal(f.ctl.rideCode(), 'OCCUPIED', 'Mia rides the only horse');
  peers.online('p2', false);
  assert.equal(f.ctl.rideCode(), null, 'Mia left: Rowan may ride (v01 bRideCodeAfterALeft)');
});

test('CL-01: main.js feeds the peer tools from presence, peer leave and the welcome, and unseats a leaver', () => {
  assert.match(MAIN, /createPeerTools\(\)/);
  const peerCase = MAIN.slice(MAIN.indexOf('case MSG.PEER:'), MAIN.indexOf('case MSG.GHOST:'));
  assert.match(peerCase, /peerTools\.online\(m\.pid, m\.online\)/, 'a leave clears the tool');
  assert.match(peerCase, /ride\?\.\(m\.pid, false\)/, 'and gets the leaver off the horse on this screen');
  const onWelcome = MAIN.slice(MAIN.indexOf('function onWelcome'), MAIN.indexOf('function watchUnsaved'));
  assert.match(onWelcome, /peerTools\.welcome\(w\.peers\)/);
  void MSG;
});

// ---- CL-02 ---------------------------------------------------------------------------------------------------------
test('CL-02: reloadPlan — nothing pending reloads; same rules re-send first; new rules are noted, never re-sent', () => {
  const local = { content: 'aaaa', rules: 4 };
  assert.equal(reloadPlan({ contentHash: 'aaaa', buildHash: 'b2' }, local, 0), 'reload');
  assert.equal(reloadPlan({ contentHash: 'aaaa', buildHash: 'b2' }, local, 2), 'send', 'a client-only deploy');
  assert.equal(reloadPlan({ contentHash: 'bbbb', buildHash: 'b2' }, local, 1), 'note', 'a RULES_VERSION bump / content change');
  assert.equal(reloadPlan({ contentHash: 'aaaa', rulesVersion: 5 }, local, 1), 'note', 'an explicit rulesVersion that differs');
  assert.equal(reloadPlan({ contentHash: 'aaaa', rulesVersion: 4 }, local, 1), 'send');
});

test('CL-02: unsavedOf counts what the welcome did not apply; the record survives the reload and is worded once', () => {
  const pending = [{ seq: 4 }, { seq: 5 }, { seq: 6 }];
  assert.deepEqual(unsavedOf(pending, { lastSeq: 4, known: true, rejected: [] }), { lost: 2, unsure: 0 }, '5 and 6 never reached the server');
  assert.deepEqual(unsavedOf(pending, { lastSeq: 6, known: true, rejected: [{ seq: 5, code: 'EMPTY' }] }), { lost: 1, unsure: 0 }, '5 was rejected');
  assert.deepEqual(unsavedOf(pending, { lastSeq: 0, known: false }), { lost: 0, unsure: 3 }, 'the server forgot the cid');
  let memo = null;
  const m = { get: () => memo, set: (v) => { memo = v; } };
  noteUnsaved(m, { lost: 0, unsure: 0 });
  assert.equal(memo, null, 'nothing to say: nothing stored');
  noteUnsaved(m, { lost: 1 });
  noteUnsaved(m, { lost: 1, unsure: 1 });
  assert.deepEqual(memo, { lost: 2, unsure: 1 });
  assert.equal(unsavedText(memo), '2 things you did during the update weren\'t saved. Please do them again.');
  assert.equal(unsavedText({ lost: 1 }), 'One thing you did during the update wasn\'t saved. Please do it again.');
  assert.match(unsavedText({ lost: 0, unsure: 2 }), /may not have been saved/);
  assert.equal(unsavedText(null), null);
  assert.equal(unsavedText({ lost: 0, unsure: 0 }), null);
});

test('CL-02: a client-only deploy re-sends the actions made during the restart, so they are saved', () => {
  const h = coopHarness();
  const sent = [];
  const realSend = h.a.store.send;
  h.a.store.send = (msg) => sent.push(msg);               // the server is down: frames go nowhere
  assert.ok(h.a.store.act('plant', { id: 'home.0.0', crop: 'wheat' }).ok);
  assert.ok(h.a.store.act('plant', { id: 'home.0.1', crop: 'wheat' }).ok);
  h.a.store.send = realSend;
  const w = h.welcome(h.a);
  let memo = null;
  const gate = contentGate({ ...w, contentHash: 'aaaa', buildHash: 'b2' }, { content: 'aaaa', build: 'b1' },
    { get: () => memo, set: (v) => { memo = v; } });
  assert.equal(gate, 'reload');
  assert.equal(reloadPlan({ ...w, contentHash: 'aaaa' }, { content: 'aaaa', rules: null }, h.a.store.pending.length), 'send');
  h.a.store.reset(w);                                       // main.js: the welcome is applied, so reset() re-sends
  h.flush();
  assert.equal(h.a.store.pending.length, 0, 'both answered before the reload');
  assert.ok(h.state.farm.objects['home.0.0'].crop && h.state.farm.objects['home.0.1'].crop, 'and both are on the server');
});

test('CL-02: main.js decides the plan before reset(), notes or re-sends, and shows the notice after the reload', () => {
  const onWelcome = MAIN.slice(MAIN.indexOf('function onWelcome'), MAIN.indexOf('function watchUnsaved'));
  const i = { plan: onWelcome.indexOf('reloadPlan('), note: onWelcome.indexOf('noteUnsaved('), reload: onWelcome.indexOf('location.reload()'),
    watch: onWelcome.indexOf('watchUnsaved()'), reset: onWelcome.indexOf('store.reset(w)'), notice: onWelcome.indexOf('unsavedText(') };
  for (const [k, v] of Object.entries(i)) assert.ok(v > 0, `onWelcome has ${k}`);
  assert.ok(i.plan < i.reload && i.note < i.reload, 'the record is written before the page reloads');
  assert.ok(i.watch < i.reset, 'the watch listens before reset() (it reports lost / rejected re-sends)');
  assert.ok(i.reset < i.notice, 'the notice shows once the reloaded page is up');
  assert.doesNotMatch(onWelcome, /if \(gate === 'reload'\) \{ location\.reload\(\); return; \}/, 'never the silent reload of HEAD 5bef2a5');
});

// ---- CL-04 ---------------------------------------------------------------------------------------------------------
import { tileOwner } from '../shared/rules/grid.js';
import { coachStep } from '../public/js/ui/tutorial.js';

test('CL-04: with Grandma\'s welcome card up, the Hand on the bench walks over and sits; nothing goes to the guide', async () => {
  globalThis.window ??= eventTarget();
  const h = coopHarness();
  // level 4: the bench is unlocked and the farm is still new enough for the welcome card (ui namingDue: below 5)
  for (const s of [h.state, h.a.store.state, h.b.store.state]) { s.farm.xp = xpForLevel(4); s.farm.wallet.coins = 5000; }
  let spot = null;
  for (let z = 10; z < 40 && !spot; z++) for (let x = 10; x < 40 && !spot; x++) if (canPlace(h.state, 'sunset_bench', x, z, 0) === null) spot = { x, z };
  assert.equal(h.a.store.act('place', { def: 'sunset_bench', ...spot, rot: 0 }).ok, true);
  h.flush();
  const id = tileOwner(h.state, spot.x, spot.z);
  assert.equal(coachStep(h.a.store.state, 'p1')?.step.id, 'welcome', 'the welcome card is the coach\'s step');
  const sent = [];
  const a = await fakeController(h.a);
  const realSend = h.a.store.send;
  h.a.store.send = (m) => { sent.push(m); realSend(m); };
  const b = await fakeController(h.b);
  a.click(spot.x, spot.z);
  a.walks.at(-1).onArrive();
  b.click(spot.x, spot.z);
  b.walks.at(-1).onArrive();
  h.flush();
  assert.deepEqual(sent.filter((m) => m.type === 'tutDone'), [], 'the click is the bench\'s, never the guide\'s');
  assert.ok(sent.some((m) => m.type === 'sit'), 'A sat');
  assert.deepEqual(Object.keys(h.state.farm.coop.bench).sort(), ['p1', 'p2'], 'both seated by Hand clicks');
  assert.equal(h.state.farm.coop.bench.p1.id, id);
});

// ---- CL-03 (the client half: endless CSS pulses rest) --------------------------------------------------------------
import { createRest, endlessAnimations, REST } from '../public/js/game/rest.js';

test('CL-03: endless CSS animations pause after REST.calmMs without input, play on at the next input, and later ones too', () => {
  const anim = (iterations, state = 'running') => ({
    playState: state, effect: { getTiming: () => ({ iterations }) },
    pause() { this.playState = 'paused'; }, play() { this.playState = 'running'; },
  });
  const halo = anim(Infinity); const toast = anim(1); const hint = anim(Infinity);
  let list = [halo, toast];
  const doc = { getAnimations: () => list };
  const win = eventTarget();
  let timer = null;
  const setTimer = (fn, ms) => { timer = { fn, ms }; return timer; };
  const clearTimer = (t) => { if (timer === t) timer = null; };
  assert.deepEqual(endlessAnimations(doc), [halo]);
  const r = createRest({ win, doc, setTimer, clearTimer });
  assert.equal(timer.ms, REST.calmMs);
  assert.ok(REST.calmMs <= 10_000);
  timer.fn();                                         // 10 s without input
  assert.equal(r.resting, true);
  assert.equal(halo.playState, 'paused', 'the guide\'s halo rests');
  assert.equal(toast.playState, 'running', 'a finite animation finishes');
  list = [halo, toast, hint];                         // a new badge starts pulsing while the page rests
  timer.fn();
  assert.equal(hint.playState, 'paused', 'it rests too');
  win.dispatch('pointermove');
  assert.equal(r.resting, false);
  assert.equal(halo.playState, 'running', 'any input plays them on');
  assert.equal(hint.playState, 'running');
  r.stop();
});

// ---- CL-05 (the controller half: the canvas rect is cached) --------------------------------------------------------
test('CL-05: pointer moves do not measure the canvas each time (no forced layout per stroke frame)', async () => {
  globalThis.window ??= eventTarget();
  const h = coopHarness();
  const f = await fakeController(h.a);
  const before = f.rectCalls;
  for (let i = 0; i < 40; i++) f.move(5 + (i % 10), 5);
  f.down(3, 3); for (let i = 0; i < 20; i++) f.move(3 + (i % 5), 3); f.up(7, 3);
  assert.ok(f.rectCalls - before <= 1, `${f.rectCalls - before} canvas measurements for 62 pointer events`);
  window.dispatch('resize');
  f.move(6, 6);
  assert.ok(f.rectCalls - before <= 2, 'a resize measures it again once');
});
