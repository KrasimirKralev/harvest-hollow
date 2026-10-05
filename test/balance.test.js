// Static balance and pacing proofs over the content (GDD §1.4, §4.2, §4.6, §5.2; tech §8.3). The simulator
// (`node tools/econ-sim.mjs --checks`) proves the dynamic half; these are the properties any table edit must keep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT, CONFIG, ORDERS, live, liveAt, plotCapOf, barnCapacity, eHours, orderSlotsAt,
  levelRow } from '../shared/content/index.js';

const E = (L) => levelRow(L).E;

test('pacing targets of the owner (GDD §4.6): L5 after ~45 min, L10 after ~3 h, L20 after ~13 h of play', () => {
  const minutesTo = (L) => CONTENT.levels.slice(0, L - 1).reduce((s, l) => s + l.minutes, 0);
  assert.equal(minutesTo(5), 45);
  assert.equal(minutesTo(10), 180);
  assert.ok(Math.abs(minutesTo(20) - 13 * 60) <= 30, `${minutesTo(20)} min`);
});

test('every new unlock of L1-12 is affordable on arrival (level-up coins + at most an hour of income)', () => {
  for (const fam of ['buildings', 'homes', 'trees']) {
    for (const d of live(fam)) {
      if (d.unlock === 1) continue;
      assert.ok(d.cost <= levelRow(d.unlock).coins + E(d.unlock), `${fam}.${d.id}: ${d.cost} at L${d.unlock}`);
    }
  }
  for (const a of live('animals')) {
    assert.ok(a.baby <= levelRow(a.unlock).coins + E(a.unlock) || a.unlock === 1, `${a.id} baby ${a.baby}`);
  }
  for (const r of live('recipes')) {
    const cost = Object.entries(r.inputs).reduce((s, [i, q]) => s + CONTENT.items.get(i).sell * q, 0);
    assert.ok(cost <= E(r.unlock), `${r.id}: one craft's inputs fit in an hour of income`);
  }
});

test('the first evening works from the start values: 16 plots of Wheat cost less than the starting coins', () => {
  const wheat = CONTENT.crops.get('wheat');
  assert.equal(wheat.unlock, 1);
  assert.ok(CONFIG.START.plots.length * wheat.seed <= CONFIG.START.coins / 4, 'four full fields of wheat in the purse');
  assert.ok(CONTENT.recipes.get('flour').inputs.wheat * 2 <= CONFIG.START.plots.length * wheat.yield,
    'one field feeds two Flour');
  assert.equal(CONTENT.homes.get('coop').cost, 0);
  assert.equal(CONTENT.buildings.get('feed_mill').cost, 0);
  assert.equal(CONTENT.buildings.get('mill').cost, 0, "Grandma's Windmill is free (quest A5)");
});

test('expansions are saving goals of a few evenings (0.8-3.6 hours of income at the gate, nice-rounded)', () => {
  for (const e of CONTENT.expansions.values()) {
    if (e.k === 0) continue;
    const hours = e.cost / E(e.unlock);
    assert.ok(hours >= 0.75 && hours <= 3.8, `${e.id}: ${hours.toFixed(2)} h`);
  }
});

test('the Barn never forces overflow on one full harvest of the field (M1a levels, every expansion on time)', () => {
  const expAt = (L) => [...CONTENT.expansions.values()].filter((e) => e.k > 0 && e.unlock <= L).length;
  const barnAt = (L) => CONTENT.barn.filter((b) => b.unlock <= L).length;
  for (let L = 1; L <= 12; L++) {
    const maxYield = Math.max(...liveAt('crops', L).map((c) => c.yield));
    const harvest = plotCapOf(L, expAt(L)) * maxYield;
    assert.ok(harvest <= barnCapacity(barnAt(L)), `L${L}: ${harvest} > ${barnCapacity(barnAt(L))}`);
  }
});

test('orders: the board grows with the farm and every budget fits one evening', () => {
  for (let L = 2; L <= 40; L++) assert.ok(orderSlotsAt(L) >= orderSlotsAt(L - 1));
  for (const [from, , hi] of ORDERS.budget) assert.ok(eHours(from, hi) < E(from),
    'an order is worth less than an hour of play');
  const first = ORDERS.first.items.wheat;
  assert.ok(first <= CONFIG.START.plots.length * CONTENT.crops.get('wheat').yield,
    'the scripted first order is one field');
});

test('quest rewards stay below the play they represent (coins = E x minutes / 60 x 0.5)', () => {
  for (const q of live('quests')) assert.ok(q.coins <= E(q.level) * q.minutes / 60, q.id);
});
