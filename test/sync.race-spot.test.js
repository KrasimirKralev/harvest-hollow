// QA r2 I2-01 (coop#10), the sibling of r1's I-01: a lost race to the same SPOT names the winner. Both farmers place a
// Hay Bale Stack on one free tile at the same moment; one stack is placed and the other is refused BLOCKED. Before the
// fix that refusal carried no `by`, so the loser heard "This spot is not free" with the info glyph; with `by` =
// the winner, game/feedback.js and ui/toasts.js word BLOCKED (and the room's OCCUPIED) as "<partner> got there first ♥".
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, TOUCH_MS } from '../server/engine.js';
import { MSG, ERR } from '../shared/net/protocol.js';
import { defOf, xpForLevel, live } from '../shared/content/index.js';
import { openInterior } from '../shared/rules/actions/interior.js';
import { Tx } from '../shared/rules/tx.js';
import { fakeClock, coopHarness, eventTarget, recordEvents } from './helpers/client.js';
import { farmAt, freeSpot, put, MONDAY, HOUR } from './helpers/rules-goals.js';

beforeEach(() => { globalThis.window = eventTarget(); });

const A = { pid: 'p1', cid: 'aaaaaa' };
const B = { pid: 'p2', cid: 'bbbbbb' };
const QUIET = { error() {}, warn() {}, info() {}, log() {} };

/** An engine on a level-`level` farm with coins to spend, both farmers joined and connected. */
function spotEngine(level = 20) {
  const state = farmAt(level, { now: MONDAY });
  state.farm.wallet.coins = 5_000_000;
  const clock = fakeClock(MONDAY + HOUR);
  const server = { clock: { lastNow: 0 }, clients: {}, auth: {} };
  const engine = new Engine({ state, server, clock, log: QUIET });
  engine.client(A.cid, A.pid, clock.now());
  engine.client(B.cid, B.pid, clock.now());
  const seq = { [A.cid]: 0, [B.cid]: 0 };
  const act = (who, type, args) => engine.act(who, { seq: ++seq[who.cid], type, args });
  return { state, clock, engine, act };
}

const spotFor = (state, def) => {
  const s = freeSpot(state, defOf(def));
  assert.ok(s, `a free spot for ${def}`);
  return s;
};
const objAt = (state, def, x, z) => Object.keys(state.farm.objects)
  .find((id) => state.farm.objects[id].def === def && state.farm.objects[id].x === x && state.farm.objects[id].z === z);

test('I2-01: two Hay Bale Stacks placed on one free tile at once: the second is refused BLOCKED with `by` = the first farmer', () => {
  const { state, act, engine } = spotEngine();
  const [x, z] = spotFor(state, 'hay_bales');
  assert.equal(act(A, 'place', { def: 'hay_bales', x, z, rot: 0 }), null, 'the first stack is placed');
  const lost = act(B, 'place', { def: 'hay_bales', x, z, rot: 0 });
  assert.equal(lost.t, MSG.REJ);
  assert.equal(lost.code, ERR.BLOCKED);
  assert.equal(lost.by, 'p1', 'the loser hears "<partner> got there first ♥", not "This spot is not free"');
  assert.equal(engine.rejectedOf(B.cid).at(-1).by, 'p1', 'the remembered rejection keeps `by` (a reconnect re-says it)');
  // the winner's own second stack on her own fresh stack is no race
  const own = act(A, 'place', { def: 'hay_bales', x, z, rot: 0 });
  assert.equal(own.code, ERR.BLOCKED);
  assert.equal(own.by, undefined);
});

test('I2-01: a footprint that only overlaps the partner\'s fresh tile, a move onto it, and a place onto a spot she just moved to', () => {
  const { state, act } = spotEngine();
  // a 2 x 1 Porch Swing whose second tile the partner's stack took a moment ago
  const [x, z] = spotFor(state, 'bench_swing');
  assert.equal(act(A, 'place', { def: 'hay_bales', x: x + 1, z, rot: 0 }), null);
  const swing = act(B, 'place', { def: 'bench_swing', x, z, rot: 0 });
  assert.equal(swing.code, ERR.BLOCKED);
  assert.equal(swing.by, 'p1', 'any tile of the footprint counts');
  // a move of my own scarecrow onto that tile
  const [sx, sz] = spotFor(state, 'scarecrow');
  const crow = put(state, 'scarecrow', { x: sx, z: sz, by: 'p2' });
  const mv = act(B, 'move', { id: crow, x: x + 1, z, rot: 0 });
  assert.equal(mv.code, ERR.BLOCKED);
  assert.equal(mv.by, 'p1', 'a move onto her fresh tile is the same race');
  // she moves her stack to a new spot; my place there a moment later lost to her move
  const [nx, nz] = spotFor(state, 'hay_bales');
  const stack = objAt(state, 'hay_bales', x + 1, z);
  assert.equal(act(A, 'move', { id: stack, x: nx, z: nz, rot: 0 }), null);
  const late = act(B, 'place', { def: 'scarecrow', x: nx, z: nz, rot: 0 });
  assert.equal(late.code, ERR.BLOCKED);
  assert.equal(late.by, 'p1', 'a spot taken by a move');
});

test('I2-01: no `by` for a spot an old object holds, a spot she took more than TOUCH_MS ago, or a path under a blocked piece', () => {
  const { state, clock, act } = spotEngine();
  // an object nobody touched in this session
  const [ox, oz] = spotFor(state, 'scarecrow');
  put(state, 'scarecrow', { x: ox, z: oz, by: 'p1' });
  const old = act(B, 'place', { def: 'hay_bales', x: ox, z: oz, rot: 0 });
  assert.equal(old.code, ERR.BLOCKED);
  assert.equal(old.by, undefined, 'an ordinary refusal: nobody raced her');
  // the partner's stack, placed longer ago than the race window
  const [x, z] = spotFor(state, 'hay_bales');
  assert.equal(act(A, 'place', { def: 'hay_bales', x, z, rot: 0 }), null);
  clock.advance(TOUCH_MS + 1);
  const stale = act(B, 'place', { def: 'hay_bales', x, z, rot: 0 });
  assert.equal(stale.code, ERR.BLOCKED);
  assert.equal(stale.by, undefined, 'a stack that stood there for a while is no race');
  // a Dirt Path (ground layer) the partner just laid under a Porch Swing that an old scarecrow blocks: the path is not
  // what is in the way, so the refusal does not blame her
  const [px, pz] = spotFor(state, 'bench_swing');
  put(state, 'scarecrow', { x: px + 1, z: pz, by: 'p2' });
  assert.equal(act(A, 'place', { def: 'dirt_path', x: px, z: pz, rot: 0 }), null, 'a path under the swing\'s first tile');
  const swing = act(B, 'place', { def: 'bench_swing', x: px, z: pz, rot: 0 });
  assert.equal(swing.code, ERR.BLOCKED);
  assert.equal(swing.by, undefined, 'the scarecrow blocks, not her path');
});

test('I2-01: a refusal that is not about the spot never names the partner from a tile', () => {
  const { state, act } = spotEngine();
  const [x, z] = spotFor(state, 'hay_bales');
  assert.equal(act(A, 'place', { def: 'hay_bales', x, z, rot: 0 }), null);
  state.farm.wallet.coins = 0;
  // a different free tile, no coins: NO_COINS has nothing to do with her stack
  const [x2, z2] = spotFor(state, 'hay_bales');
  const poor = act(B, 'place', { def: 'hay_bales', x: x2, z: z2, rot: 0 });
  assert.equal(poor.code, ERR.NO_COINS);
  assert.equal(poor.by, undefined);
});

test('I2-01 sibling: a move back onto a tile the partner just took names her', () => {
  const { state, act } = spotEngine();
  const [sx, sz] = spotFor(state, 'scarecrow');
  const crow = put(state, 'scarecrow', { x: sx, z: sz, by: 'p2' });
  const [nx, nz] = spotFor(state, 'scarecrow');                        // the scarecrow holds its own tile
  assert.notDeepEqual([nx, nz], [sx, sz]);
  assert.equal(act(B, 'move', { id: crow, x: nx, z: nz, rot: 0 }), null, 'I moved my scarecrow away');
  assert.equal(act(A, 'place', { def: 'hay_bales', x: sx, z: sz, rot: 0 }), null, 'she took its old spot');
  const back = act(B, 'moveBack', { id: crow });
  assert.equal(back.code, ERR.BLOCKED);
  assert.equal(back.by, 'p1');
});

test('I2-01 sibling: the farmhouse room: two pieces furnished on one floor spot at once: OCCUPIED with `by`', () => {
  const { state, act } = spotEngine(34);
  for (const p of [...live('restoration')].sort((a, b) => a.n - b.n)) {
    state.farm.restore[p.id] = { s: {}, b: Object.fromEntries(p.bundles.map((b) => [b.id, MONDAY])), done: MONDAY };
  }
  openInterior(new Tx(state), { now: MONDAY, pid: 'p1' });
  assert.equal(act(A, 'furnish', { def: 'armchair', x: 0, z: 6 }), null, 'her armchair');
  const lost = act(B, 'furnish', { def: 'footstool', x: 0, z: 6 });
  assert.equal(lost.code, ERR.OCCUPIED);
  assert.equal(lost.by, 'p1', 'the room\'s spot is raced like a farm tile');
  // a wall slot too
  assert.equal(act(A, 'furnish', { def: 'cuckoo_clock', wall: 'back', at: 3 }), null);
  const wall = act(B, 'furnish', { def: 'oval_mirror', wall: 'back', at: 3 });
  assert.equal(wall.code, ERR.OCCUPIED);
  assert.equal(wall.by, 'p1');
});

test('I2-01 end to end: both screens place on one tile in the same moment; the loser\'s store hears BLOCKED with `by`', () => {
  const h = coopHarness();
  h.state.farm.xp = xpForLevel(6);
  h.state.farm.wallet.coins = 100_000;
  for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
  const [x, z] = spotFor(h.state, 'hay_bales');
  const seen = recordEvents(h.b.store, ['reject']);
  // both predictions succeed on their own screens (neither has seen the other's stack yet)
  assert.equal(h.a.store.act('place', { def: 'hay_bales', x, z, rot: 0 }).ok, true);
  assert.equal(h.b.store.act('place', { def: 'hay_bales', x, z, rot: 0 }).ok, true);
  h.flush();
  const rej = seen.log.filter(([n]) => n === 'reject').map(([, r]) => r);
  assert.deepEqual(rej.map((r) => [r.type, r.code, r.by, r.local]), [['place', ERR.BLOCKED, 'p1', false]]);
  assert.equal(Object.values(h.state.farm.objects).filter((o) => o.def === 'hay_bales' && o.x === x && o.z === z).length, 1,
    'one stack on the tile; both screens converge');
  assert.deepEqual(h.a.store.state.farm.objects, h.state.farm.objects);
  assert.deepEqual(h.b.store.state.farm.objects, h.state.farm.objects);
});

test('I2-01: spotKeys is pure and never throws: garbage args, other actions, the layer in the key, a Greenhouse takes both', async () => {
  const { spotKeys, SPOT_TYPES } = await import('../server/spots.js');
  const state = farmAt(20, { now: MONDAY });
  for (const args of [null, 7, 'x', [], {}, { def: 'nope', x: 1, z: 1 }, { def: 'hay_bales', x: '1', z: 1 },
    { def: 'hay_bales', x: 1.5, z: 1 }, { id: 'zz.9.9', x: 1, z: 1 }, { def: { toString: null }, x: 1, z: 1 }]) {
    for (const type of SPOT_TYPES) assert.deepEqual([...spotKeys(state, type, args)], [], `${type} ${JSON.stringify(args)}`);
  }
  assert.deepEqual([...spotKeys(state, 'harvest', { def: 'hay_bales', x: 1, z: 1 })], [], 'only spot-taking actions');
  assert.deepEqual([...spotKeys(state, 'place', { def: 'hay_bales', x: 3, z: 4, rot: 0 })], ['tile:object:3,4']);
  assert.deepEqual([...spotKeys(state, 'place', { def: 'dirt_path', x: 3, z: 4 })], ['tile:ground:3,4']);
  assert.deepEqual([...spotKeys(state, 'place', { def: 'bench_swing', x: 3, z: 4, rot: 1 })],
    ['tile:object:3,4', 'tile:object:3,5'], 'a quarter turn swaps the footprint');
  const gh = put(state, 'greenhouse');
  const o = state.farm.objects[gh];
  const keys = spotKeys(state, 'move', { id: gh, x: o.x, z: o.z, rot: 0 });
  const [w, d] = defOf('greenhouse').size;
  assert.equal(keys.length, 2 * w * d, 'a Greenhouse frame takes the ground and the object layer');
  assert.ok(keys.includes(`tile:ground:${o.x},${o.z}`) && keys.includes(`tile:object:${o.x},${o.z}`));
});
