// The price on my screen is the most I pay (TRIAGE RC-18 client side, coop-robust-13): the controller sends the
// purchase price it showed as `max` once the rules take it; until then it sends nothing new (an unknown arg would be
// BAD_ARGS). With `max`, two farmers buying the n-th hen at once: the second is asked again (soft code), never
// silently charged more.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { xpForLevel } from '../shared/content/index.js';
import { ACTIONS } from '../shared/rules/index.js';
import { SOFT, MSG, ERR } from '../shared/net/protocol.js';
import { canPlace, tileOwner } from '../shared/rules/grid.js';
import { animalPrice, animalBuyPlan } from '../shared/rules/actions/animals.js';
import { capacityOf, occupantsOf } from '../shared/rules/grid.js';
import { coopHarness, eventTarget, fakeController } from './helpers/client.js';

beforeEach(() => { globalThis.window = eventTarget(); });
const takesMax = Boolean(ACTIONS.buyAnimal?.schema && Object.hasOwn(ACTIONS.buyAnimal.schema, 'max'));

async function coopFarm() {
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) { s.farm.xp = xpForLevel(8); s.farm.wallet.coins = 20000; }
  let spot = null;
  for (let z = 10; z < 40 && !spot; z++) for (let x = 10; x < 40 && !spot; x++) if (canPlace(h.state, 'coop', x, z, 0) === null) spot = { x, z };
  const a = await fakeController(h.a);
  const b = await fakeController(h.b);
  assert.equal(a.ctl.do('place', { def: 'coop', ...spot, rot: 0, confirm: ['BIG_SPEND'] }).ok, true);
  h.flush();
  return { h, a, b, coop: tileOwner(h.state, spot.x, spot.z) };
}

test('purchases through the controller carry the price shown as max (when the rules take it), and never overpay', async () => {
  const { h, a, b, coop } = await coopFarm();
  const seen = animalPrice(h.state, 'chicken', true);
  const ra = a.ctl.do('buyAnimal', { def: 'chicken', adult: true, home: coop, confirm: ['BIG_SPEND'] });
  const rb = b.ctl.do('buyAnimal', { def: 'chicken', adult: true, home: coop, confirm: ['BIG_SPEND'] });
  assert.equal(ra.ok && rb.ok, true, 'both predicted at the same price');
  const sentA = h.a.toServer.filter((m) => m.t === MSG.ACT && m.type === 'buyAnimal').at(-1);
  if (!takesMax) {
    assert.equal(sentA.args.max, undefined, 'no unknown arg while the rules do not take max');
    return;
  }
  assert.equal(sentA.args.max, seen);
  const rejects = [];
  h.b.store.on('reject', (r) => rejects.push(r));
  const coins0 = h.state.farm.wallet.coins;
  h.flush();
  const spent = coins0 - h.state.farm.wallet.coins;
  assert.equal(spent, seen, 'only the first purchase went through, at the price both saw');
  assert.equal(rejects.length, 1);
  assert.equal(rejects[0].code, 'PRICE', 'the second buyer is asked again with the new price');
  // the ui's "are you sure?" needs PRICE in protocol SOFT (the rules lane's integrator patch)
  if (ERR.PRICE) assert.ok(SOFT.has(ERR.PRICE), 'PRICE is a soft code');
});

test('buying into a full home: max is the price shown WITH the room step, so no false "the price went up" (wave 4b)', async () => {
  if (!takesMax) return;
  const { h, a, coop } = await coopFarm();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) s.farm.wallet.coins = 5_000_000;
  // fill the coop to its room (as the owners' fully upgraded coops are)
  for (let i = 0; i < 40 && occupantsOf(h.state, coop).length < capacityOf(h.state, coop); i++) {
    assert.equal(a.ctl.do('buyAnimal', { def: 'chicken', adult: true, home: coop, confirm: ['BIG_SPEND'] }).ok, true);
    h.flush();
  }
  const plan = animalBuyPlan(h.state, 'chicken', true, coop);
  assert.equal(plan.code, null);
  assert.ok(plan.step > 0, 'the next one needs a room step');
  const rejects = [];
  h.a.store.on('reject', (r) => rejects.push(r));
  const r = a.ctl.do('buyAnimal', { def: 'chicken', adult: true, home: coop, confirm: ['BIG_SPEND'] });
  assert.equal(r.ok, true);
  const sent = h.a.toServer.filter((m) => m.t === MSG.ACT && m.type === 'buyAnimal').at(-1);
  assert.equal(sent.args.max, plan.coins, 'the folded price is the price seen');
  const coins0 = h.state.farm.wallet.coins;
  h.flush();
  assert.deepEqual(rejects.map((x) => x.code), [], 'no PRICE question for the room step');
  assert.equal(coins0 - h.state.farm.wallet.coins, plan.coins);
});
