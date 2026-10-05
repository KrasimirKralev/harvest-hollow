// The system-action scheduler (tech §15.1, lane brief item 2): boot catch-up, firing at the due instant,
// idempotence, the hot-loop guard for a stuck type, the delay cap, late timers after a suspend.
// The due list is injected (rules-goals owns the real one); the actions are real system actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Engine, STUCK_MS } from '../server/engine.js';
import { Scheduler, MAX_DELAY } from '../server/scheduler.js';
import { makeFarm, T0 } from './helpers.js';
import { quiet, recorder, sleep, tmpDataDir, testServer, readJournal } from './helpers/server.js';

/** `_seen p1` is due once at `at`: running it stamps lastSeenAt = now >= at, which clears the condition. */
function seenAt(at) {
  return {
    dueSystemActions: (s, now) => (now >= at && s.players.p1.lastSeenAt < at ? [{ type: '_seen', args: { pid: 'p1' } }] : []),
    nextSystemDueAt: (s) => (s.players.p1.lastSeenAt < at ? at : Infinity),
  };
}

/** A clock that runs at wall speed from `start`, plus a manual offset (`jump`). */
function liveClock(start = T0) {
  const t0 = performance.now();
  return { off: 0, now() { return Math.floor(start + performance.now() - t0) + this.off; }, jump(ms) { this.off += ms; } };
}

function setup(due, { clock = liveClock(), log = quiet } = {}) {
  const state = makeFarm({ players: ['p1'] });
  const lines = [];
  const engine = new Engine({ state, server: { clock: {}, clients: {}, auth: {} }, clock, log, due,
    journal: { append: (l) => lines.push(l) } });
  engine.client('tstcid', 'p1', clock.now());          // a joined tab, so act() reaches runDue()
  const incidents = [];
  engine.incident = (name, data) => incidents.push([name, data]);
  const sched = new Scheduler({ engine, persist: { syncTick() {}, snapshot: async () => {} }, clock, cfg: { snapshotMs: 1e9 }, log });
  engine.onCommit = () => sched.requestArm();
  return { state, engine, sched, lines, incidents, clock };
}

test('boot catches up on what came due while the server was off, once (deterministic, idempotent)', () => {
  const clock = liveClock(T0 + 3 * 86_400_000);
  const { engine, sched, lines } = setup(seenAt(T0 + 1000), { clock });
  sched.start();
  try {
    assert.deepEqual(lines.map((l) => l.type), ['_seen'], 'exactly one catch-up action');
    assert.equal(engine.runDue(), 0, 'running it again does nothing');
    assert.equal(lines.length, 1);
    const left = sched.dueAt - clock.now();
    assert.ok(left <= MAX_DELAY && left >= MAX_DELAY - 50, `nothing left: the hourly re-check (${left})`);
  } finally {
    sched.stop();
  }
});

test('the timer fires at the due instant, not before, without polling', async () => {
  const clock = liveClock();
  const at = clock.now() + 80;
  const { sched, lines } = setup(seenAt(at), { clock });
  sched.start();
  try {
    assert.equal(lines.length, 0);
    assert.ok(sched.dueAt - clock.now() <= 80 && sched.dueAt - clock.now() > 40, `armed for the due time (${sched.dueAt - clock.now()})`);
    await sleep(40);
    assert.equal(lines.length, 0, 'not early');
    await sleep(80);
    assert.equal(lines.length, 1, 'fired');
    assert.equal(sched.fires, 1, 'one timer, no polling');
    assert.ok(lines[0].now >= at, 'at or after the due instant (game time)');
  } finally {
    sched.stop();
  }
});

test('a late timer (suspend, wall step) is caught by the 1 s tick', () => {
  const clock = liveClock();
  const { sched, lines } = setup(seenAt(clock.now() + 3_600_000), { clock });
  sched.start();
  try {
    clock.jump(3_600_001);              // game time passed the due time; the monotonic setTimeout did not
    sched.tick();
    assert.equal(lines.length, 1);
  } finally {
    sched.stop();
  }
});

test('a stuck due action is backed off: logged and filed once, never retried per player action, no 0 ms spin', async () => {
  const rec = recorder();
  const due = {   // always "due" and always rejected: _join for a slot that exists -> SLOT_TAKEN
    dueSystemActions: () => [{ type: '_join', args: { pid: 'p1', name: 'again' } }],
    nextSystemDueAt: (s, now) => now,
  };
  const clock = liveClock();
  const { engine, sched, incidents } = setup(due, { clock, log: rec.log });
  sched.start();
  try {
    assert.equal(incidents.length, 1);
    assert.match(incidents[0][0], /system-stuck-_join/);
    assert.equal(incidents[0][1].code, 'SLOT_TAKEN');
    const tries = () => rec.lines.filter((l) => l[1] === 'system action rejected').length;
    assert.equal(tries(), 1);
    for (let i = 0; i < 20; i++) {
      const r = engine.act({ pid: 'p1', cid: 'tstcid' }, { seq: i + 1, type: 'sell', args: { item: 'wheat', qty: 1 } });
      assert.equal(r.code, 'NO_ITEMS', 'the player action itself ran');
    }
    assert.equal(tries(), 1, 'not retried before every player action');
    assert.ok(sched.dueAt - clock.now() >= 1000, 'the timer waits for the back-off');
    await sleep(150);
    assert.ok(sched.fires <= 1, `no spin (${sched.fires} fires)`);
    clock.jump(STUCK_MS);
    engine.runDue();
    assert.equal(tries(), 2, 'retried after the back-off');
    assert.equal(incidents.length, 1, 'filed once');
  } finally {
    sched.stop();
  }
});

test('an action that succeeds but stays due is stopped after one commit (no journal flood)', () => {
  const due = { dueSystemActions: () => [{ type: '_seen', args: { pid: 'p1' } }], nextSystemDueAt: (s, now) => now };
  const { engine, sched, lines, incidents } = setup(due);
  sched.start();
  try {
    for (let i = 0; i < 10; i++) {
      assert.equal(engine.act({ pid: 'p1', cid: 'tstcid' }, { seq: i + 1, type: 'sell', args: { item: 'wheat', qty: 1 } }).code, 'NO_ITEMS');
    }
    assert.equal(lines.filter((l) => l.type === '_seen').length, 1);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0][1].code, 'STILL_DUE');
  } finally {
    sched.stop();
  }
});

test('the delay is capped, and a broken nextSystemDueAt (NaN, throw) never makes a 0 ms loop', () => {
  for (const next of [() => Infinity, () => Number.NaN, () => 'soon', () => { throw new Error('bug'); }, () => T0 + 10 * 86_400_000]) {
    const clock = liveClock();
    const { sched } = setup({ dueSystemActions: () => [], nextSystemDueAt: next }, { clock });
    sched.start();
    try {
      const d = sched.dueAt - clock.now();
      assert.ok(d > 0 && d <= MAX_DELAY, `delay ${d}`);
    } finally {
      sched.stop();
    }
  }
});

test('rules whose "next" and "due" disagree at the boundary are re-checked within a second, not an hour', async () => {
  const clock = liveClock();
  const at = clock.now() + 30;
  // next says `at`, but the list only has it strictly after `at` (an off-by-one between the two functions)
  const due = {
    dueSystemActions: (s, now) => (now > at + 200 && s.players.p1.lastSeenAt < at ? [{ type: '_seen', args: { pid: 'p1' } }] : []),
    nextSystemDueAt: (s) => (s.players.p1.lastSeenAt < at ? at : Infinity),
  };
  const rec = recorder();
  const { sched, lines } = setup(due, { clock, log: rec.log });
  sched.start();
  try {
    await sleep(80);
    assert.equal(lines.length, 0);
    assert.ok(sched.dueAt - clock.now() <= 1000, `re-check soon (${sched.dueAt - clock.now()} ms)`);
    await sleep(1100);
    assert.equal(lines.length, 1, 'ran on the re-check');
    assert.equal(rec.lines.filter((l) => l[0] === 'warn').length, 1, 'logged once');
  } finally {
    sched.stop();
  }
});

test('dueSystemActions throwing pauses system actions with one incident; player actions still work', () => {
  const due = { dueSystemActions: () => { throw new Error('rules bug'); }, nextSystemDueAt: () => Infinity };
  const { engine, sched, incidents } = setup(due);
  sched.start();
  try {
    const r = engine.act({ pid: 'p1', cid: 'tstcid' }, { seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    assert.equal(r, null, 'accepted');
    engine.runDue();
    assert.equal(incidents.length, 1);
  } finally {
    sched.stop();
  }
});

test('system actions get { online } in ctx.ext and are journaled like player actions', () => {
  const { engine, lines } = setup(seenAt(0));
  engine.facts = { player: () => ({ ext: {} }), committed() {}, system: () => ({ online: ['p1'] }) };
  engine.state.players.p1.lastSeenAt = -1;
  engine.runDue();
  assert.deepEqual(lines[0].ext, { online: ['p1'] });
  assert.equal(lines[0].pid, 'sys');
  assert.equal(lines[0].seq, lines[0].v, 'a system seq is its v (ids sys.<v>.<i>)');
});

test('server boot: catch-up actions are journaled before the boot snapshot (none in M0 rules: the list is empty)', async () => {
  const dir = tmpDataDir('sched-boot');
  const s = await testServer({ dataDir: dir, keep: true });
  try {
    assert.ok(Number.isFinite(s.hh.scheduler.dueAt), 'armed at boot');
    assert.ok(s.hh.scheduler.dueAt - s.hh.clock.now() <= MAX_DELAY);
    const snap = JSON.parse(fs.readFileSync(path.join(dir, 'farm.json'), 'utf8'));
    assert.equal(snap.version, s.hh.engine.v);
    assert.deepEqual(readJournal(dir).filter((l) => l.v > snap.version), []);
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
