// PROOF (RED on M0): Tx.set / Tx.emit accept values that structuredClone keeps but JSON (wire, snapshot, journal)
// changes or cannot encode. The server state then differs from every client and from its own snapshot.
// Run: node --test docs/design/review-m0-proofs/06-tx-non-json.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tx } from '../../../shared/rules/tx.js';

const cases = {
  map: new Map([['egg', 2]]),
  set: new Set(['p1']),
  date: new Date(0),
  undef: undefined,
  nan: NaN,
  inf: Infinity,
  negZero: -0,
  sparse: [1, , 3],          // eslint-disable-line no-sparse-arrays
};

for (const [name, value] of Object.entries(cases)) {
  test(`Tx.set refuses a non-JSON value (${name})`, () => {
    const s = { farm: {} };
    const tx = new Tx(s);
    let threw = false;
    try { tx.set(['farm', 'x'], value); } catch { threw = true; }
    const wire = JSON.parse(JSON.stringify(tx.ops));
    const server = s.farm.x;
    const client = wire[0]?.v;
    console.log(`${name}: server keeps`, server, '| client receives', client);
    assert.ok(threw, `${name} was accepted and will diverge over the wire`);
  });
}

test('a BigInt in the state makes every later snapshot and broadcast throw', () => {
  const s = { farm: {} };
  new Tx(s).set(['farm', 'big'], 10n);
  let err = null;
  try { JSON.stringify(s); } catch (e) { err = e.message; }
  console.log('JSON.stringify(state) ->', err);
  assert.equal(err, null, 'the farm can no longer be saved or sent');
});

test('emit() does not alias the state (events are broadcast after more writes)', () => {
  const s = { farm: { objects: { a: { def: 'plot', crop: { def: 'wheat' } } } } };
  const tx = new Tx(s);
  tx.emit({ e: 'harvested', obj: tx.get(['farm', 'objects', 'a']) });   // easy mistake: pass the live object
  tx.set(['farm', 'objects', 'a', 'crop'], null);
  console.log('event says crop =', tx.events[0].obj.crop);
  assert.notEqual(tx.events[0].obj.crop, null, 'the event changed after it was emitted');
});
