// The action registry contract (tech §9 registry.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ACTIONS, runAction, makeCtx } from '../shared/rules/index.js';
import { assertSchema } from '../shared/rules/schema.js';
import { ERR } from '../shared/net/protocol.js';
import { ROOT, makeFarm, T0 } from './helpers.js';

const testSources = fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.js') && f !== 'registry.test.js')
  .map((f) => fs.readFileSync(path.join(ROOT, 'test', f), 'utf8')).join('\n');

test('the registry is a frozen null-prototype object', () => {
  assert.equal(Object.getPrototypeOf(ACTIONS), null);
  assert.ok(Object.isFrozen(ACTIONS));
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(ACTIONS[k], undefined);
});

for (const [type, def] of Object.entries(ACTIONS)) {
  test(`action ${type}: schema, check, apply and a test that mentions it`, () => {
    assert.equal(typeof def.check, 'function');
    assert.equal(typeof def.apply, 'function');
    assert.doesNotThrow(() => assertSchema(def.schema));
    assert.ok(testSources.includes(`'${type}'`), `no test mentions '${type}'`);
  });
}

test('prototype names never resolve to actions', () => {
  const s = makeFarm();
  for (const type of ['constructor', '__proto__', 'toString', 'valueOf']) {
    const r = runAction(s, { type, args: {} }, makeCtx(s, { now: T0, pid: 'p1', cid: 'abcdef', seq: 1 }));
    assert.equal(r.code, ERR.UNKNOWN_ACTION);
  }
});

test('system actions are server-only and player actions are player-only', () => {
  const s = makeFarm({ players: ['p1'] });
  const asPlayer = runAction(s, { type: '_join', args: { pid: 'p2', name: 'X' } }, makeCtx(s, { now: T0, pid: 'p1', cid: 'abcdef', seq: 1 }));
  assert.equal(asPlayer.code, ERR.UNKNOWN_ACTION);
  const asSys = runAction(s, { type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } }, makeCtx(s, { now: T0, pid: 'sys', cid: 'sys', seq: 1 }));
  assert.equal(asSys.code, ERR.UNKNOWN_ACTION);
});
