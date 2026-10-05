// Owner request 2026-10-04: "let main structures like the barn be moved by the player". Every structure on the farm
// moves and turns with the Hammer, the Homestead's landmarks included (farmhouse, Barn, Well, Mailbox, Market Stand,
// Mabel's Order Board, the Old Greenhouse), keeping every rule sound: footprints inside the unlocked land, never on
// another object, homes keep their animals, buildings their queues and trays, a move back for 10 minutes, nothing
// lost or duplicated (a move writes only the moved object), and a journal that replays to the same farm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { CONTENT, defOf, SAFETY } from '../shared/content/index.js';
import { validateState } from '../shared/rules/state.js';
import { canFit, occupantsOf, capacityOf, tilesOf, tileOwner, inLand, spawnAt, getGrid } from '../shared/rules/grid.js';
import { WORLD_TILES, START } from '../shared/content/config.js';
import { Presence } from '../server/presence.js';
import { Persist } from '../server/persist.js';
import { loadFarm } from '../server/index.js';
import { coopHarness, plain, mulberry32 } from './helpers.js';
import { reverseKeys } from './helpers/econ-fuzz.js';
import { runAction, makeCtx } from '../shared/rules/index.js';
import { tmpDataDir, quiet } from './helpers/server.js';
import { run, must, T0, farmAt, give, placeDef, idsOf, evs, allLand, MIN } from './helpers/rules.js';
import fs from 'node:fs';

const LANDMARK_IDS = ['farmhouse', 'barn', 'well', 'mailbox', 'market_stand', 'order_board'];

/** The first spot (row-major over the whole world) where object `id` fits at `rot`, ignoring itself, not its own
 * spot: a move target. */
function moveSpot(s, id, rot = s.farm.objects[id].rot ?? 0) {
  const o = s.farm.objects[id];
  for (let z = 0; z < WORLD_TILES; z++) {
    for (let x = 0; x < WORLD_TILES; x++) {
      if (x === o.x && z === o.z && rot === (o.rot ?? 0)) continue;
      if (canFit(s, o.def, x, z, rot, id) === null) return [x, z];
    }
  }
  return null;
}

/** Drop every `play` key: any action stamps play-time bookkeeping (farm.daily.play, farm.barge.play, ...). */
const noPlay = (v) => {
  if (Array.isArray(v)) return v.map(noPlay);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'play').map(([k, x]) => [k, noPlay(x)]));
};

/** The whole farm but object `id`, as plain data, play-time bookkeeping aside. */
function restOf(s, id) {
  const p = noPlay(plain(s.farm));
  delete p.objects[id];
  return p;
}

/** Every farm write of a result is inside one of these objects (the actor's play-time bookkeeping aside). */
function onlyWrites(r, ids, actor = 'p1') {
  for (const op of r.tx.ops) {
    if ((op.p[0] === 'players' && op.p[1] === actor) || op.p.includes('play')) continue;
    assert.equal(op.p[0], 'farm', JSON.stringify(op));
    assert.equal(op.p[1], 'objects', JSON.stringify(op));
    assert.ok(ids.includes(op.p[2]), `a move wrote outside the moved object: ${JSON.stringify(op.p)}`);
  }
}

test('every Homestead landmark moves and turns: id and fields kept, a 10-minute move back, nothing else written', () => {
  const s = farmAt(4);
  // a first action of the day stamps once-a-day bookkeeping (the Memory Book's season, the daily play): warm it up so
  // the moves below are compared on their own
  const w = idsOf(s, 'well')[0];
  must(s, 'move', { id: w, x: moveSpot(s, w)[0], z: moveSpot(s, w)[1], rot: 0 }, { now: T0 });
  must(s, 'moveBack', { id: w }, { now: T0 });
  for (const def of LANDMARK_IDS) {
    const id = idsOf(s, def)[0];
    assert.ok(id, `${def} is on the starter farm`);
    assert.equal(defOf(def).movable, true, `${def} is movable in content`);
    const before = structuredClone(s.farm.objects[id]);
    const rest = restOf(s, id);
    const rot = 1;
    const [x, z] = moveSpot(s, id, rot);
    const r = must(s, 'move', { id, x, z, rot }, { now: T0 + MIN });
    onlyWrites(r, [id]);
    const o = s.farm.objects[id];
    assert.deepEqual([o.x, o.z, o.rot], [x, z, rot], def);
    assert.deepEqual(o.prev, { x: before.x, z: before.z, rot: before.rot, until: T0 + MIN + SAFETY.moveBackMs, by: 'p1' });
    for (const k of Object.keys(before)) if (!['x', 'z', 'rot'].includes(k)) assert.deepEqual(o[k], before[k], `${def}.${k}`);
    assert.deepEqual(evs(r, 'moved')[0], { e: 'moved', id, def, x, z, rot, from: [before.x, before.z, before.rot], by: 'p1' });
    assert.deepEqual(restOf(s, id), rest, `moving the ${def} changed nothing else on the farm`);
    // the grid follows: the new tiles are the landmark's, the old ones (outside the new footprint) are free
    for (const [tx, tz] of tilesOf(defOf(def), x, z, rot)) assert.equal(tileOwner(s, tx, tz), id);
    const now = new Set(tilesOf(defOf(def), x, z, rot).map(([a, b]) => `${a},${b}`));
    for (const [tx, tz] of tilesOf(defOf(def), before.x, before.z, before.rot)) {
      if (!now.has(`${tx},${tz}`)) assert.equal(tileOwner(s, tx, tz), null, `${def}: old tile ${tx},${tz} freed`);
    }
    // the partner may put it back inside the window
    must(s, 'moveBack', { id }, { pid: 'p2', now: T0 + MIN + 1 });
    assert.deepEqual([s.farm.objects[id].x, s.farm.objects[id].z, s.farm.objects[id].rot], [before.x, before.z, before.rot]);
    assert.equal(s.farm.objects[id].prev, undefined);
  }
  assert.deepEqual(validateState(s), []);
});

test('the Barn moves by one tile onto its own footprint, turns in place, and keeps the goods and its upgrades', () => {
  const s = farmAt(10);
  give(s, 'wheat', 76);
  s.farm.barn = 3;
  const barn = idsOf(s, 'barn')[0];
  const b = s.farm.objects[barn];
  const inv = structuredClone(s.farm.inventory);
  // a one-tile shift overlaps its own old footprint (canFit ignores the moved object itself)
  const shift = [[b.x - 1, b.z], [b.x + 1, b.z], [b.x, b.z - 1], [b.x, b.z + 1]].find(([x, z]) => canFit(s, 'barn', x, z, 0, barn) === null);
  assert.ok(shift, 'some one-tile shift of the Barn is free on the starter farm');
  must(s, 'move', { id: barn, x: shift[0], z: shift[1], rot: 0 });
  // turning in place is a move too (same x/z, new rot)
  must(s, 'move', { id: barn, x: shift[0], z: shift[1], rot: 2 }, { now: T0 + 1 });
  assert.equal(s.farm.objects[barn].rot, 2);
  assert.equal(run(s, 'move', { id: barn, x: shift[0], z: shift[1], rot: 2 }).code, ERR.ALREADY_DONE);
  assert.deepEqual(s.farm.inventory, inv, 'the Barn\'s goods do not move with it, they stay the farm\'s');
  assert.equal(s.farm.barn, 3);
  assert.deepEqual(validateState(s), []);
});

test('landmarks never go onto locked land, outside the world, or onto another object', () => {
  const s = farmAt(4);
  const barn = idsOf(s, 'barn')[0];
  const house = idsOf(s, 'farmhouse')[0];
  const h = s.farm.objects[house];
  assert.equal(run(s, 'move', { id: barn, x: h.x, z: h.z, rot: 0 }).code, ERR.BLOCKED, 'onto the farmhouse');
  assert.equal(run(s, 'move', { id: barn, x: h.x + 2, z: h.z + 2, rot: 0 }).code, ERR.BLOCKED, 'half onto it');
  // locked land: the first tile of the world that is not the farm's
  let locked = null;
  for (let z = 0; z < WORLD_TILES - 4 && !locked; z++) for (let x = 0; x < WORLD_TILES - 4 && !locked; x++) if (!inLand(s, x, z)) locked = [x, z];
  assert.equal(run(s, 'move', { id: barn, x: locked[0], z: locked[1], rot: 0 }).code, ERR.OUT_OF_BOUNDS);
  assert.equal(run(s, 'move', { id: barn, x: WORLD_TILES - 2, z: 30, rot: 0 }).code, ERR.OUT_OF_BOUNDS);
  // straddling the edge of the Homestead: part on the farm's land, part beyond it
  const homeRect = CONTENT.expansions.get('home').rects[0];
  assert.equal(run(s, 'move', { id: barn, x: homeRect[0] + homeRect[2] - 2, z: homeRect[1] + 4, rot: 0 }).code, ERR.OUT_OF_BOUNDS);
  // a move that fails changes nothing
  assert.equal(s.farm.objects[barn].prev, undefined);
  assert.deepEqual(validateState(s), []);
});

test('Mabel\'s Order Board (2 x 1) turns its footprint; a level-gated landmark moves before its level', () => {
  const s = farmAt(1);
  const ob = idsOf(s, 'order_board')[0];
  const [x, z] = moveSpot(s, ob, 1);
  must(s, 'move', { id: ob, x, z, rot: 1 });
  assert.deepEqual(tilesOf(defOf('order_board'), x, z, 1), [[x, z], [x, z + 1]], 'turned: 1 x 2');
  assert.equal(tileOwner(s, x, z + 1), ob);
  assert.deepEqual(validateState(s), []);
});

test('landmarks are still never stored or sold; debris and animals still never move', () => {
  const s = farmAt(4);
  for (const def of LANDMARK_IDS) {
    const id = idsOf(s, def)[0];
    assert.equal(run(s, 'store', { id }).code, ERR.LOCKED, `store ${def}`);
    assert.equal(run(s, 'sellObject', { id }).code, ERR.LOCKED, `sell ${def}`);
  }
  const weed = Object.keys(s.farm.objects).sort().find((k) => defOf(s.farm.objects[k].def).kind === 'debris');
  const [x, z] = moveSpot(s, weed);
  assert.equal(run(s, 'move', { id: weed, x, z, rot: 0 }).code, ERR.LOCKED, 'debris is cleared, not moved');
  allLand(s);
  const coop = placeDef(s, 'coop');
  const hen = evs(must(s, 'buyAnimal', { def: 'chicken', adult: true, home: coop, confirm: ['BIG_SPEND'] }), 'bought')[0].id;
  assert.equal(run(s, 'move', { id: hen, x, z, rot: 0 }).code, ERR.NOT_FOUND, 'an animal has no spot of its own');
});

test('a home keeps its animals and their timers; the moved Coop is tended as before', () => {
  const s = farmAt(4);
  allLand(s);
  const coop = placeDef(s, 'coop');
  const hens = [];
  for (let i = 0; i < 3; i++) hens.push(evs(must(s, 'buyAnimal', { def: 'chicken', adult: true, home: coop, confirm: ['BIG_SPEND'] }), 'bought')[0].id);
  give(s, 'chicken_feed', 20);
  must(s, 'tend', { ids: hens }, { now: T0 + MIN });
  const animals = structuredClone(hens.map((id) => s.farm.objects[id]));
  const cap = capacityOf(s, coop);
  const [x, z] = moveSpot(s, coop, 3);
  const r = must(s, 'move', { id: coop, x, z, rot: 3 }, { now: T0 + 2 * MIN });
  onlyWrites(r, [coop]);
  assert.deepEqual(occupantsOf(s, coop), [...hens].sort());
  assert.deepEqual(hens.map((id) => s.farm.objects[id]), animals, 'every hen untouched (home id, fedAt, readyAt)');
  assert.equal(capacityOf(s, coop), cap);
  // the eggs are collected from the moved coop (the hens point at its id)
  const ready = Math.max(...animals.map((a) => a.readyAt));
  const t = must(s, 'tend', { ids: hens }, { now: ready + 1 });
  assert.ok(evs(t, 'collected').length + evs(t, 'tended').length > 0 || t.tx.ops.length > 0);
  assert.ok((s.farm.inventory.egg ?? 0) >= 3, 'the eggs reached the Barn');
  assert.deepEqual(validateState(s), []);
});

test('a building keeps its queue and tray: the Feed Mill moves mid-queue and its tray is collected afterwards', () => {
  const s = farmAt(4);
  allLand(s);
  const mill = placeDef(s, 'feed_mill');
  give(s, 'wheat', 30);
  must(s, 'craft', { id: mill, recipe: 'chicken_feed' }, { now: T0 });
  must(s, 'craft', { id: mill, recipe: 'chicken_feed' }, { now: T0 });
  const queue = structuredClone(s.farm.objects[mill].queue);
  const [x, z] = moveSpot(s, mill, 1);
  const r = must(s, 'move', { id: mill, x, z, rot: 1 }, { now: T0 + MIN });
  onlyWrites(r, [mill]);
  assert.deepEqual(s.farm.objects[mill].queue, queue, 'queue and timers kept (GDD §9 #38)');
  const feed = s.farm.inventory.chicken_feed ?? 0;
  must(s, 'collectTray', { id: mill }, { now: queue.at(-1).e + 1 });
  assert.ok((s.farm.inventory.chicken_feed ?? 0) > feed, 'the tray is collected from the new spot');
  assert.deepEqual(validateState(s), []);
});

test('the Old Greenhouse frame moves with its 12 plots (and their crops); a plot inside it never moves alone', () => {
  const s = farmAt(20);
  allLand(s);
  const gh = defOf('greenhouse');
  assert.ok(gh && CONTENT.landmarks.has('greenhouse'), 'the Old Greenhouse is live (M1b+)');
  s.farm.storage.greenhouse = 1;
  const frame = placeDef(s, 'greenhouse');
  const plots = Object.keys(s.farm.objects).filter((k) => s.farm.objects[k].gh === frame).sort();
  assert.equal(plots.length, gh.greenhouse.plots);
  must(s, 'plant', { id: plots[0], crop: 'wheat' }, { now: T0 });
  const crop = structuredClone(s.farm.objects[plots[0]].crop);
  const [x, z] = moveSpot(s, frame, 0);
  assert.equal(run(s, 'move', { id: plots[1], x, z, rot: 0 }).code, ERR.LOCKED);
  const r = must(s, 'move', { id: frame, x, z, rot: 0 }, { now: T0 + MIN });
  onlyWrites(r, [frame, ...plots]);
  assert.deepEqual(s.farm.objects[plots[0]].crop, crop);
  for (const p of plots) assert.equal(tileOwner(s, s.farm.objects[p].x, s.farm.objects[p].z), p);
  must(s, 'moveBack', { id: frame }, { now: T0 + MIN + 1 });
  assert.deepEqual(validateState(s), []);
});

test('move back is refused once the old spot of a landmark is taken; Ctrl+Z order: one move back per move', () => {
  const s = farmAt(4);
  allLand(s);
  const well = idsOf(s, 'well')[0];
  const old = [s.farm.objects[well].x, s.farm.objects[well].z];
  const [x, z] = moveSpot(s, well);
  must(s, 'move', { id: well, x, z, rot: 0 });
  placeDef(s, 'flower_bed', { at: old });
  assert.equal(run(s, 'moveBack', { id: well }).code, ERR.BLOCKED);
  assert.equal(run(s, 'moveBack', { id: well }, { now: T0 + SAFETY.moveBackMs }).code, ERR.NOT_REFUNDABLE);
});

test('two farmers: p1 moves the Barn, the move is predicted at once, p2 sees it, p2 moves it back; a race on one spot', () => {
  const h = coopHarness();
  const barn = Object.keys(h.state.farm.objects).find((k) => h.state.farm.objects[k].def === 'barn');
  const o = h.state.farm.objects[barn];
  const spots = [];
  for (let z = 0; z < WORLD_TILES && spots.length < 2; z++) {
    for (let x = 0; x < WORLD_TILES && spots.length < 2; x++) {
      if ((x !== o.x || z !== o.z) && canFit(h.state, 'barn', x, z, 1, barn) === null
        && spots.every(([a, b]) => Math.abs(a - x) >= 4 || Math.abs(b - z) >= 4)) spots.push([x, z]);
    }
  }
  const [x, z] = spots[0];
  h.a.store.act('move', { id: barn, x, z, rot: 1 });
  // predicted on my screen before the server answers
  assert.deepEqual([h.a.store.state.farm.objects[barn].x, h.a.store.state.farm.objects[barn].z, h.a.store.state.farm.objects[barn].rot], [x, z, 1]);
  assert.equal(h.b.store.state.farm.objects[barn].x, o.x, 'the partner has not seen it yet');
  h.flush();
  for (const c of [h.a, h.b]) {
    const b = c.store.state.farm.objects[barn];
    assert.deepEqual([b.x, b.z, b.rot], [x, z, 1], `client ${c.key} agrees with the server`);
    assert.deepEqual(plain(c.store.state.farm), plain(h.state.farm), `client ${c.key} == server`);
  }
  // the partner's "Move back"
  h.b.store.act('moveBack', { id: barn });
  h.flush();
  assert.deepEqual([h.state.farm.objects[barn].x, h.state.farm.objects[barn].z, h.state.farm.objects[barn].rot], [o.x, o.z, o.rot]);
  // a race: both farmers drop a different landmark on the same free spot at once; one wins, the other is rejected
  // and its prediction rolled back, and both screens end equal to the server
  const well = Object.keys(h.state.farm.objects).find((k) => h.state.farm.objects[k].def === 'well');
  const mail = Object.keys(h.state.farm.objects).find((k) => h.state.farm.objects[k].def === 'mailbox');
  const [sx, sz] = spots[1];
  h.a.store.act('move', { id: well, x: sx, z: sz, rot: 0 });
  h.b.store.act('move', { id: mail, x: sx, z: sz, rot: 0 });
  h.flush();
  assert.equal(tileOwner(h.state, sx, sz), well, 'the first to reach the server wins');
  assert.notEqual(h.state.farm.objects[mail].x === sx && h.state.farm.objects[mail].z === sz, true);
  for (const c of [h.a, h.b]) assert.deepEqual(plain(c.store.state.farm), plain(h.state.farm), `client ${c.key} == server after the race`);
  assert.deepEqual(validateState(h.state), []);
});

test('the journal replays landmark moves exactly: a crash after the moves boots to the same farm', async () => {
  const dir = tmpDataDir('move-structures');
  try {
    const boot = () => {
      const persist = new Persist(dir, { log: quiet });
      const r = loadFarm(persist, { log: quiet, tz: 'Europe/Sofia' });
      r.engine.journal = persist;
      persist.openJournal();
      return { persist, ...r };
    };
    const f = boot();
    const st = f.engine.state;
    if (!Object.hasOwn(st.players, 'p1')) f.engine.system('_join', { pid: 'p1', name: 'Rowan' });
    // the boot snapshot the journal replays on (the server writes it on its first save)
    await f.persist.snapshot(() => ({ state: f.engine.state, server: f.engine.server, version: f.engine.v }));
    f.engine.client('cidaaa', 'p1', f.clock.now());
    const rec = f.engine.server.clients.cidaaa;
    const act = (type, args) => assert.equal(f.engine.act({ pid: 'p1', cid: 'cidaaa' }, { seq: rec.lastSeq + 1, type, args }), null, `${type} ${JSON.stringify(args)}`);
    for (const def of ['barn', 'farmhouse', 'market_stand']) {
      const id = Object.keys(st.farm.objects).find((k) => st.farm.objects[k].def === def);
      const [x, z] = moveSpot(st, id, 1);
      act('move', { id, x, z, rot: 1 });
    }
    const barn = Object.keys(st.farm.objects).find((k) => st.farm.objects[k].def === 'barn');
    act('moveBack', { id: barn });
    const want = plain(f.engine.state);
    // kill -9: no snapshot; the next boot replays the journal over the boot snapshot
    const g = boot();
    assert.deepEqual(plain(g.engine.state), want);
    assert.deepEqual(validateState(g.engine.state), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fuzz: random landmark moves, turns and move backs agree with a key-reversed twin and keep the farm valid', () => {
  for (const seed of [1, 2, 3, 4]) {
    const rnd = mulberry32(seed);
    const s = farmAt(12);
    allLand(s);
    const twin = reverseKeys(plain(s));
    const ids = Object.keys(s.farm.objects).filter((k) => defOf(s.farm.objects[k].def).kind === 'landmark').sort();
    const objects = Object.keys(s.farm.objects).length;
    let now = T0;
    let ok = 0;
    for (let i = 0; i < 120; i++) {
      now += Math.floor(rnd() * 4 * MIN);
      const id = ids[Math.floor(rnd() * ids.length)];
      const back = rnd() < 0.25;
      let args = { id };
      if (!back) {
        const rot = Math.floor(rnd() * 4);
        let [x, z] = [Math.floor(rnd() * WORLD_TILES), Math.floor(rnd() * WORLD_TILES)];
        for (let k = 0; k < 40 && rnd() < 0.9 && canFit(s, s.farm.objects[id].def, x, z, rot, id) !== null; k++) {
          [x, z] = [Math.floor(rnd() * WORLD_TILES), Math.floor(rnd() * WORLD_TILES)];
        }
        args = { id, x, z, rot };
      }
      const type = back ? 'moveBack' : 'move';
      const ctx = { now, pid: rnd() < 0.5 ? 'p1' : 'p2', cid: 'fuzz01', seq: i + 1, grace: 250 };
      const a = i % 5 === 0 ? run(s, type, args, ctx) : runAction(s, { type, args }, makeCtx(s, ctx));
      const b = runAction(twin, { type, args }, makeCtx(twin, ctx));
      assert.equal(a.code, b.code, `${type} ${JSON.stringify(args)}`);
      assert.notEqual(a.code, ERR.INTERNAL);
      if (a.ok) { ok++; assert.deepEqual(a.tx.events, b.tx.events); }
    }
    assert.ok(ok > 30, `seed ${seed}: only ${ok} moves accepted`);
    assert.deepEqual(plain(twin), plain(s), `seed ${seed}: values diverge`);
    assert.equal(Object.keys(s.farm.objects).length, objects, 'nothing lost or duplicated');
    assert.deepEqual(validateState(s), [], `seed ${seed}`);
  }
});

test('a farmer appears on the farmhouse porch wherever the farmhouse stands, turned with it, never inside a building', () => {
  const s = farmAt(4);
  allLand(s);
  assert.deepEqual(spawnAt(s, 'p1'), START.spawn.p1, 'the starter farm: the authored porch');
  assert.deepEqual(spawnAt(s, 'p2'), START.spawn.p2);
  const house = idsOf(s, 'farmhouse')[0];
  const h0 = { ...s.farm.objects[house] };
  const off = (pid) => [START.spawn[pid].x - h0.x, START.spawn[pid].z - h0.z];
  const [x, z] = moveSpot(s, house, 0);
  must(s, 'move', { id: house, x, z, rot: 0 });
  for (const pid of ['p1', 'p2']) {
    const sp = spawnAt(s, pid);
    assert.deepEqual([sp.x - x, sp.z - z], off(pid), `${pid}: the porch moved with the farmhouse`);
  }
  // turned a quarter: the porch (south of the house at rot 0) is now on its east side (the model's yaw +90 degrees)
  const [x1, z1] = moveSpot(s, house, 1);
  must(s, 'move', { id: house, x: x1, z: z1, rot: 1 }, { now: T0 + 1 });
  const sp1 = spawnAt(s, 'p1');
  assert.ok(sp1.x >= x1 + 4 && sp1.z >= z1 && sp1.z <= z1 + 4, `east of the farmhouse: ${JSON.stringify(sp1)} vs ${x1},${z1}`);
  // something on the porch (the Barn moved over it): the nearest open tile of the farm's land instead
  const sp = spawnAt(s, 'p1');
  const barn = idsOf(s, 'barn')[0];
  // every 4 x 4 spot that covers the porch tile, the first one free
  const [px, pz] = [Math.floor(sp.x), Math.floor(sp.z)];
  let spot = null;
  for (let dz = 0; dz < 4 && !spot; dz++) for (let dx = 0; dx < 4 && !spot; dx++) {
    if (canFit(s, 'barn', px - dx, pz - dz, 0, barn) === null) spot = [px - dx, pz - dz];
  }
  assert.ok(spot, 'the Barn can be put over the porch');
  must(s, 'move', { id: barn, x: spot[0], z: spot[1], rot: 0 }, { now: T0 + 2 });
  assert.equal(tileOwner(s, px, pz), barn, 'the porch tile is under the Barn now');
  for (const pid of ['p1', 'p2']) {
    const moved = spawnAt(s, pid);
    const tx = Math.floor(moved.x);
    const tz = Math.floor(moved.z);
    assert.equal(getGrid(s).object[tz * WORLD_TILES + tx], null, `${pid}: never inside the Barn`);
    assert.ok(inLand(s, tx, tz), `${pid}: on the farm's land`);
  }
  // the server's presence starts a joining farmer there (and the partner sees no walk from the old porch)
  const p = new Presence({ now: () => 1000 }, () => {}, { spawnOf: (pid) => spawnAt(s, pid) });
  p.join('p1');
  assert.deepEqual([p.p.get('p1').x, p.p.get('p1').z], [spawnAt(s, 'p1').x, spawnAt(s, 'p1').z]);
  const plain0 = new Presence({ now: () => 1000 }, () => {});
  plain0.join('p1');
  assert.deepEqual([plain0.p.get('p1').x, plain0.p.get('p1').z], [START.spawn.p1.x, START.spawn.p1.z], 'without a farm: START.spawn');
});
