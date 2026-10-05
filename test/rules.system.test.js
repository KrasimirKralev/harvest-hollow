// System actions: _join and _seen, and the due-scheduler contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { createFarm, validateState } from '../shared/rules/state.js';
import { dueSystemActions, nextSystemDueAt } from '../shared/rules/system.js';
import { sys, T0 } from './helpers.js';

test("'_join' creates the player once, with the slot colour by default", () => {
  const s = createFarm(1, T0);
  assert.ok(sys(s, '_join', { pid: 'p1', name: '  Rowan ' }).ok);
  assert.equal(s.players.p1.name, 'Rowan');
  assert.equal(s.players.p1.color, '#2BB3A3');
  assert.equal(sys(s, '_join', { pid: 'p1', name: 'Again' }).code, ERR.SLOT_TAKEN);
  assert.equal(sys(s, '_join', { pid: 'p3', name: 'X' }).code, ERR.BAD_ARGS);
  assert.equal(sys(s, '_join', { pid: 'p2', name: 'Mia', color: 'red' }).code, ERR.BAD_ARGS);
  assert.ok(sys(s, '_join', { pid: 'p2', name: 'Mia', color: '#123456' }).ok);
  assert.deepEqual(validateState(s), []);
});

test("'_seen' stamps lastSeenAt with server time", () => {
  const s = createFarm(1, T0);
  assert.equal(sys(s, '_seen', { pid: 'p1' }).code, ERR.NOT_FOUND);
  sys(s, '_join', { pid: 'p1', name: 'Rowan' }, T0);
  assert.ok(sys(s, '_seen', { pid: 'p1' }, T0 + 5000).ok);
  assert.equal(s.players.p1.lastSeenAt, T0 + 5000);
});

test('the scheduler contract: nothing due on a fresh farm, never a NaN delay', () => {
  const s = createFarm(1, T0);
  assert.deepEqual(dueSystemActions(s, T0), []);
  const next = nextSystemDueAt(s, T0);
  // the farm-day rollover and the hourly debris regrowth are real due times now
  assert.ok(Number.isFinite(next) && next > T0 && next <= T0 + 86_400_000, `next ${next}`);
});
