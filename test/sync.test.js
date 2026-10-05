// SyncStore undo-log rebase against the real Engine (tech §3.4-3.6, §9 sync.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cropOf, CONTENT, xpForLevel } from '../shared/content/index.js';
import { CELEBRATIONS as RULES_CELEBRATIONS, runAction, makeCtx } from '../shared/rules/index.js';
import { CELEBRATIONS, RESYNC_RETRY_MS } from '../public/js/net/sync.js';
import { contentGate, pageBuild } from '../public/js/net/content-gate.js';
import { applyOps } from '../shared/rules/tx.js';
import { createFarm, validateState } from '../shared/rules/state.js';
import { ERR, MSG, LIMITS } from '../shared/net/protocol.js';
import { ROOT, coopHarness, mulberry32, plain } from './helpers.js';

const WHEAT = cropOf('wheat');
const STARTER = ['home.0.0', 'home.0.1', 'home.0.2', 'home.0.3'];

/** What one action would do to a copy of the server state, run by `pid` now (the rules' own numbers, so these
 * tests do not hard-code an XP formula: crop XP accrues in fractions since RC-13). */
function solo(h, pid, type, args) {
  const s = structuredClone(h.state);
  const r = runAction(s, { type, args }, makeCtx(s, { now: h.clock.now(), pid, cid: 'solo', seq: 1, ext: {}, grace: 0 }));
  assert.ok(r.ok, `solo ${type}: ${r.code}`);
  return s;
}

function assertConverged(h) {
  const server = plain(h.state);
  assert.deepEqual(plain(h.a.store.state), server, 'client A equals the server');
  assert.deepEqual(plain(h.b.store.state), server, 'client B equals the server');
  assert.equal(h.a.store.pending.length, 0);
  assert.equal(h.b.store.pending.length, 0);
  assert.equal(h.a.store.v, h.engine.v);
  assert.deepEqual(validateState(h.state), []);
}

test('prediction is instant and the server confirms it', () => {
  const h = coopHarness();
  const r = h.a.store.act('plant', { id: 'home.0.0', crop: 'wheat' });
  assert.ok(r.ok);
  assert.equal(h.a.store.state.farm.objects['home.0.0'].crop.def, 'wheat', 'visible before any network');
  assert.equal(h.a.store.pending.length, 1);
  assert.equal(h.state.farm.objects['home.0.0'].crop, null, 'server not reached yet');
  h.flush();
  assertConverged(h);
  assert.equal(h.b.store.state.farm.objects['home.0.0'].crop.by, 'p1');
});

test('a failing local check sends nothing', () => {
  const h = coopHarness();
  const rejects = [];
  h.a.store.on('reject', (r) => rejects.push(r));
  const r = h.a.store.act('harvest', { id: 'home.0.0' });
  assert.equal(r.code, ERR.EMPTY);
  assert.equal(h.a.toServer.length, 0);
  assert.equal(rejects[0].local, true);
});

test('both partners harvest the same ripe plot: first wins, the loser converges with one toast', () => {
  const h = coopHarness();
  h.a.store.act('plant', { id: 'home.0.0', crop: 'wheat' });
  h.flush();
  h.clock.advance(WHEAT.growMs);
  const toasts = [];
  h.b.store.on('reject', (r) => toasts.push(r));
  const fxA = [];
  h.a.store.on('fx', (f) => fxA.push(f.ev.e));
  const alone = solo(h, 'p1', 'harvest', { id: 'home.0.0' });
  assert.ok(h.a.store.act('harvest', { id: 'home.0.0' }).ok);
  assert.ok(h.b.store.act('harvest', { id: 'home.0.0' }).ok);
  assert.equal(h.b.store.state.farm.inventory.wheat, WHEAT.yield, 'B predicted its own harvest');
  h.deliverToServer(h.a);
  h.deliverToServer(h.b);
  h.flush();
  assertConverged(h);
  assert.equal(h.state.farm.inventory.wheat, WHEAT.yield, 'barn +yield exactly once');
  assert.equal(h.state.players.p1.xp, alone.players.p1.xp, 'the winner got the harvest XP');
  assert.equal(h.state.players.p2.xp, 0, 'the loser got nothing');
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].code, ERR.EMPTY);
  assert.equal(toasts[0].by, 'p1', '"Rowan got there first"');
  assert.deepEqual(fxA, ['harvested'], 'A played its own harvest once (predicted), not again on confirm');
});

test('celebrations are confirmed-only and play once on both screens', () => {
  const h = coopHarness();
  h.state.farm.xp = CONTENT.levels[1].xp - 1;
  for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
  const cel = { a: [], b: [] };
  h.a.store.on('celebrate', (c) => cel.a.push(c.ev.e));
  h.b.store.on('celebrate', (c) => cel.b.push(c.ev.e));
  h.a.store.act('plant', { ids: STARTER, crop: 'wheat' });
  h.flush();
  h.clock.advance(WHEAT.growMs);
  assert.ok(solo(h, 'p1', 'harvest', { ids: STARTER }).farm.xp >= CONTENT.levels[1].xp, 'the harvest crosses the level');
  h.a.store.act('harvest', { ids: STARTER });
  assert.deepEqual(cel.a, [], 'not predicted');
  assert.ok(h.a.store.state.farm.wallet.coins > 0);
  h.flush();
  assert.deepEqual(cel.a, ['levelUp']);
  assert.deepEqual(cel.b, ['levelUp']);
  assertConverged(h);
});

test('stall then reconnect: pending actions are re-sent on welcome and converge', () => {
  const h = coopHarness();
  h.b.store.act('plant', { id: 'home.0.1', crop: 'wheat' });
  h.b.store.act('plant', { id: 'home.0.2', crop: 'wheat' });
  h.b.store.act('plant', { id: 'home.0.3', crop: 'wheat' });
  assert.equal(h.b.store.pending.length, 3);
  h.deliverToServer(h.b, 1);              // the first one made it before the drop
  h.b.toServer.length = 0;                // the socket died: the rest never left
  h.b.toClient.length = 0;                // and the delta for the first was lost too
  h.b.store.reset(h.welcome(h.b));        // reconnect
  assert.equal(h.b.store.pending.length, 2, 'seq <= lastSeq dropped');
  assert.equal(h.b.toServer.length, 2, 'the rest re-sent in order');
  h.flush();
  assertConverged(h);
  assert.ok(['home.0.1', 'home.0.2', 'home.0.3'].every((id) => h.state.farm.objects[id].crop));
});

test('a delta gap requests a resync instead of applying out of order', () => {
  const h = coopHarness();
  h.a.store.act('plant', { id: 'home.0.0', crop: 'wheat' });
  h.a.store.act('plant', { id: 'home.0.1', crop: 'wheat' });
  h.deliverToServer(h.a);
  h.b.toClient.shift();                   // B loses v+1 (a bug in real life: TCP keeps order)
  h.deliverToClient(h.b);
  assert.equal(h.b.store.resyncing, true);
  assert.equal(h.b.toServer.at(-1).t, MSG.RESYNC);
  h.flush();
  assertConverged(h);
});

test('300 random two-client interleavings converge, never go negative, and ops replay equals state', () => {
  for (let run = 0; run < 300; run++) {
    const rng = mulberry32(1000 + run);
    const h = coopHarness({ seed: run });
    const initial = plain(h.state);
    const log = [];
    const prevDelta = h.engine.onDelta;
    h.engine.onDelta = (d) => { log.push(d); prevDelta(d); };
    const plots = Object.keys(h.state.farm.objects);
    for (let step = 0; step < 40; step++) {
      const c = rng() < 0.5 ? h.a : h.b;
      const roll = rng();
      const plot = plots[Math.floor(rng() * plots.length)];
      if (roll < 0.3) c.store.act('plant', { id: plot, crop: rng() < 0.8 ? 'wheat' : 'carrot' });
      else if (roll < 0.55) c.store.act('harvest', { id: plot });
      else if (roll < 0.62) c.store.act('sell', { item: 'wheat', qty: 1 + Math.floor(rng() * 3) });
      else if (roll < 0.68) c.store.act('place', { def: 'plot', x: 16 + Math.floor(rng() * 24), z: 24 + Math.floor(rng() * 16), rot: 0 });
      else if (roll < 0.8) h.deliverToServer(c, 1 + Math.floor(rng() * 2));
      else if (roll < 0.92) h.deliverToClient(c, 1 + Math.floor(rng() * 3));
      else h.clock.advance(Math.floor(rng() * WHEAT.growMs * 0.7));
      c.skew = Math.floor(rng() * 20) - 10;                  // clients' clock estimates wobble
      for (const s of [h.state, h.a.store.state, h.b.store.state]) assert.ok(s.farm.wallet.coins >= 0);
    }
    h.flush();
    assertConverged(h);
    const replay = initial;
    for (const d of log) { applyOps(replay, d.ops); replay.meta.version = d.v; }
    assert.deepEqual(plain(replay), plain(h.state), `ops replay (run ${run})`);
  }
});

test('createFarm output is a valid state for the harness', () => {
  assert.deepEqual(validateState(createFarm(3, 0)), []);
});

// ---- review-m0 hardening ----------------------------------------------------------------------------------

test('a lost resync answer does not freeze the store: the request is repeated (review-m0 H3)', () => {
  const h = coopHarness();
  const causes = [];
  h.a.store.on('resync', (r) => causes.push(r.cause));
  h.a.store.requestResync('test');
  h.a.toServer.length = 0;                               // the request was lost on the way
  h.b.store.act('plant', { id: 'home.0.0', crop: 'wheat' });
  h.flush();
  assert.equal(h.a.store.ready, false);
  h.clock.advance(RESYNC_RETRY_MS + 1);
  h.b.store.act('plant', { id: 'home.0.1', crop: 'wheat' });
  h.flush();                                             // the next delta triggers the repeat, the welcome follows
  assert.equal(h.a.store.ready, true);
  assert.equal(h.a.store.act('plant', { id: 'home.0.2', crop: 'wheat' }).ok, true, 'input works again');
  h.flush();
  assertConverged(h);
  assert.deepEqual(causes, ['test'], 'one resync event per episode, with its cause');
});

test('a welcome for an unknown cid drops pending actions instead of re-sending them (review-m0 #4)', () => {
  const h = coopHarness();
  h.a.store.act('plant', { id: 'home.0.0', crop: 'wheat' });
  h.flush();
  h.clock.advance(WHEAT.growMs);
  h.a.store.act('harvest', { id: 'home.0.0' });
  h.flush();
  const lost = [];
  h.a.store.on('lost', (l) => lost.push(...l.actions));
  h.a.store.act('sell', { item: 'wheat', qty: 1 });
  h.deliverToServer(h.a);                                // the server sold it ...
  h.a.toClient.length = 0;                               // ... the lid closed before the delta arrived
  const before = h.state.farm.inventory.wheat ?? 0;
  delete h.server.clients[h.a.cid];                      // the record is gone (TTL, a server restart)
  h.engine.client(h.a.cid, h.a.pid, h.clock.now());
  h.a.store.reset({ ...h.welcome(h.a), known: false });
  h.flush();
  assert.equal(h.state.farm.inventory.wheat ?? 0, before, 'sold exactly once');
  assert.deepEqual(lost.map((l) => l.type), ['sell']);
  assertConverged(h);
});

test('a level-up whose delta was lost still celebrates after the reconnect, once (review-m0 M8)', () => {
  const h = coopHarness();
  h.state.farm.xp = xpForLevel(2) - 1;
  for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
  h.a.store.act('plant', { ids: STARTER, crop: 'wheat' });
  h.flush();
  h.clock.advance(WHEAT.growMs);
  const cel = { a: [], b: [] };
  h.a.store.on('celebrate', (c) => cel.a.push(c.ev.level));
  h.b.store.on('celebrate', (c) => cel.b.push(c.ev.level));
  h.a.store.act('harvest', { ids: STARTER });
  h.deliverToServer(h.a);
  h.b.toClient.length = 0;                               // B was reconnecting at that moment
  h.b.store.reset(h.welcome(h.b));
  h.flush();
  h.a.store.reset(h.welcome(h.a));                       // a later resync of A must not celebrate again
  assert.deepEqual(cel, { a: [2], b: [2] });
});

test('the celebration set is the rules\' closed list', () => {
  assert.equal(CELEBRATIONS, RULES_CELEBRATIONS);
});

test('a rejection lost in a disconnect still reaches the player (review-m0 L2)', () => {
  const h = coopHarness();
  h.a.store.act('plant', { id: 'home.0.0', crop: 'wheat' });
  h.flush();
  h.clock.advance(WHEAT.growMs);
  const rejects = [];
  h.b.store.on('reject', (r) => rejects.push(r));
  h.a.store.act('harvest', { id: 'home.0.0' });
  h.b.store.act('harvest', { id: 'home.0.0' });
  h.deliverToServer(h.a);
  h.deliverToServer(h.b);                                // B's harvest -> rej EMPTY
  h.b.toClient.length = 0;                               // lost with A's delta
  h.b.store.reset({ ...h.welcome(h.b), rejected: h.engine.rejectedOf(h.b.cid) });
  h.flush();
  assert.equal(rejects.length, 1);
  assert.equal(rejects[0].code, ERR.EMPTY);
  assert.equal(rejects[0].type, 'harvest');
  assertConverged(h);
});

test('input blocks after MAX_OFFLINE_MS offline or unanswered (review-m0 L3)', () => {
  const h = coopHarness();
  h.a.store.setOnline(false);
  assert.equal(h.a.store.act('plant', { id: 'home.0.0', crop: 'wheat' }).ok, true, 'brief drops keep predicting');
  h.clock.advance(LIMITS.MAX_OFFLINE_MS + 1);
  assert.equal(h.a.store.act('plant', { id: 'home.0.1', crop: 'wheat' }).code, ERR.OFFLINE);
  h.a.store.setOnline(true);
  assert.equal(h.a.store.act('plant', { id: 'home.0.1', crop: 'wheat' }).code, ERR.OFFLINE, 'still unanswered');
  h.a.store.reset(h.welcome(h.a));
  h.flush();
  assert.equal(h.a.store.act('plant', { id: 'home.0.1', crop: 'wheat' }).ok, true, 'answered: input is back');
  h.flush();
  assertConverged(h);
  const g = coopHarness();
  g.a.store.send = () => {};                             // a socket that silently drops frames
  g.a.store.act('plant', { id: 'home.0.0', crop: 'wheat' });
  g.clock.advance(5 * 60_000);
  assert.equal(g.a.store.act('plant', { id: 'home.0.1', crop: 'wheat' }).code, ERR.OFFLINE);
});

test('content mismatch: reload once per server hash, then show the mismatch state (review-m0 H4)', () => {
  let memo = null;
  const m = { get: () => memo, set: (v) => { memo = v; } };
  assert.equal(contentGate({ contentHash: 'aaaa0000' }, 'aaaa0000', m), 'ok');
  assert.equal(contentGate({ contentHash: 'bbbb0000' }, 'aaaa0000', m), 'reload');
  assert.equal(contentGate({ contentHash: 'bbbb0000' }, 'aaaa0000', m), 'mismatch', 'no reload loop');
  assert.equal(contentGate({ contentHash: 'cccc0000' }, 'aaaa0000', m), 'reload', 'a newer server build reloads again');
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  const fn = main.slice(main.indexOf('function onWelcome'));
  assert.ok(fn.indexOf('saveTokens()') < fn.indexOf('contentGate('), 'the token is saved before any reload');
});

test('build mismatch (a client-only deploy, a rules change without a bump): reload once, then play on (SV-03)', () => {
  let memo = null;
  const m = { get: () => memo, set: (v) => { memo = v; } };
  const mine = { content: 'aaaa0000', build: 'b1' };
  assert.equal(contentGate({ contentHash: 'aaaa0000', buildHash: 'b1' }, mine, m), 'ok');
  assert.equal(contentGate({ contentHash: 'aaaa0000', buildHash: 'b2' }, mine, m), 'reload', 'the stale tab reloads');
  assert.equal(contentGate({ contentHash: 'aaaa0000', buildHash: 'b2' }, mine, m), 'ok', 'once: the rules agree, so play on');
  assert.equal(contentGate({ contentHash: 'aaaa0000', buildHash: 'b3' }, mine, m), 'reload', 'the next deploy reloads again');
  // either side not knowing its build skips the check; a content mismatch still wins
  assert.equal(contentGate({ contentHash: 'aaaa0000' }, mine, m), 'ok', 'an older server');
  assert.equal(contentGate({ contentHash: 'aaaa0000', buildHash: 'b9' }, { content: 'aaaa0000', build: null }, m), 'ok');
  memo = null;
  assert.equal(contentGate({ contentHash: 'cccc0000', buildHash: 'b1' }, mine, m), 'reload');
  assert.equal(contentGate({ contentHash: 'cccc0000', buildHash: 'b1' }, mine, m), 'mismatch');
  assert.equal(pageBuild({ meta: 'm1', status: { buildHash: 's1' } }), 'm1', 'the stamped page wins');
  assert.equal(pageBuild({ status: { buildHash: 's1' } }), 's1');
  assert.equal(pageBuild({ status: { v: 3 } }), null);
});
