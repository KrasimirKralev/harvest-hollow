// The Level-up Bloom on two screens (owner rule 2026-10-04: a level-up finishes everything growing on the farm). One
// Engine (the server) and two SyncStores (both screens) over a fake network: the actor's screen predicts the finished
// farm exactly as the server decides it, and the "everything is ready" card is a confirmed-only celebration that
// plays once on each screen, right after the level-up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropOf, xpForLevel, levelFromXp } from '../shared/content/index.js';
import { validateState } from '../shared/rules/state.js';
import { coopHarness, plain } from './helpers.js';
import { placeDef, evs, must } from './helpers/rules.js';
import { bloomCounts } from '../public/js/ui/levelup.js';
import { bloomLine, BLOOM_TITLE } from '../public/js/ui/toasts.js';

const plots = (h) => Object.keys(h.state.farm.objects).filter((id) => h.state.farm.objects[id].def === 'plot').sort();

function converged(h) {
  const server = plain(h.state);
  assert.deepEqual(plain(h.a.store.state), server, 'A equals the server');
  assert.deepEqual(plain(h.b.store.state), server, 'B equals the server');
  assert.equal(h.a.store.pending.length, 0);
  assert.equal(h.b.store.pending.length, 0);
  assert.deepEqual(validateState(h.state), []);
}

/** Change the server's farm between deltas (setup only), then hand both screens a fresh welcome. */
function rewelcome(h, fn) {
  fn(h.state);
  for (const c of [h.a, h.b]) { c.store.reset(h.welcome(c)); c.toClient.length = 0; }
}

test('a level-up on two screens: the actor predicts the finished farm exactly like the server; one Bloom card each', () => {
  const h = coopHarness();
  // a level-4 farm with an apple sapling and a chick in the Coop (setup straight on the server's farm)
  let sapling = null;
  let chick = null;
  rewelcome(h, (s) => {
    s.farm.xp = xpForLevel(4);
    s.farm.wallet.coins = 50_000;
    const now = h.clock.now();
    sapling = placeDef(s, 'apple_tree', { confirm: ['BIG_SPEND'], now });
    placeDef(s, 'coop', { confirm: ['BIG_SPEND'], now });
    chick = evs(must(s, 'buyAnimal', { def: 'chicken', adult: false, confirm: ['BIG_SPEND'] }, { now }), 'bought')[0].id;
  });
  const [wheat, ...rest] = plots(h);
  const crops = rest.slice(0, 4);
  // A plants Wheat (ripe in a minute) and three Strawberries (an hour); B plants Corn a moment before the level-up
  assert.ok(h.a.store.act('plant', { id: wheat, crop: 'wheat' }).ok);
  for (const id of crops.slice(0, 3)) assert.ok(h.a.store.act('plant', { id, crop: 'strawberry' }).ok);
  h.flush();
  h.clock.advance(cropOf('wheat').growMs + 10);
  assert.ok(h.b.store.act('plant', { id: crops[3], crop: 'corn' }).ok);
  h.flush();
  const growing = [...crops, sapling, chick].sort();
  // a hair short of level 5: A's Wheat harvest crosses it
  rewelcome(h, (s) => { s.farm.xp = xpForLevel(5) - 1; s.farm.xpFrac = 99; });
  const seen = { a: [], b: [] };
  let card = null;
  for (const k of ['a', 'b']) {
    h[k].store.on('celebrate', ({ ev }) => { seen[k].push(`celebrate:${ev.e}`); if (ev.e === 'bloomed') card = ev; });
    h[k].store.on('fx', ({ ev }) => { if (ev.e === 'bloomed') seen[k].push('fx:bloomed'); });
  }
  assert.ok(h.a.store.act('harvest', { id: wheat }).ok);
  // A's screen predicts the level-up and the finished farm at once (the same rules on the same state and now)
  const now = h.clock.now();
  const predicted = plain(h.a.store.state.farm.objects);
  assert.equal(levelFromXp(h.a.store.state.farm.xp), 5, 'A predicts the level-up');
  for (const id of crops) assert.equal(predicted[id].crop.readyAt, now, `A predicts ${id} ripe`);
  assert.deepEqual([predicted[sapling].matureAt, predicted[sapling].readyAt], [now, now], 'A predicts a ripe apple tree');
  assert.equal(predicted[chick].adultAt, now, 'A predicts a grown hen');
  assert.deepEqual(seen.a, [], 'the celebrations wait for the server');
  h.flush();
  assert.equal(levelFromXp(h.state.farm.xp), 5);
  for (const id of growing) assert.deepEqual(plain(h.state.farm.objects[id]), predicted[id], `server == prediction: ${id}`);
  converged(h);
  for (const k of ['a', 'b']) {
    assert.equal(seen[k].filter((x) => x === 'celebrate:bloomed').length, 1, `${k}: one Bloom card (${seen[k]})`);
    assert.ok(!seen[k].includes('fx:bloomed'), `${k}: never as predicted feedback`);
    assert.ok(seen[k].indexOf('celebrate:levelUp') < seen[k].indexOf('celebrate:bloomed'), `${k}: the level-up first`);
  }
  assert.deepEqual(card, { e: 'bloomed', level: 5, ids: growing });
  assert.deepEqual(bloomCounts(h.b.store.state, card.ids), { crops: 4, trees: 1, animals: 1 });
  // B harvests what just finished, straight away
  for (const id of crops) assert.ok(h.b.store.act('harvest', { id }).ok);
  assert.ok(h.b.store.act('harvestTree', { id: sapling }).ok);
  h.flush();
  converged(h);
  for (const id of crops) assert.equal(h.state.farm.objects[id].crop, null, id);
});

test('the Bloom card: "New level! Everything on the farm is ready" and what finished, counted from the farm', () => {
  assert.equal(BLOOM_TITLE, 'New level! Everything on the farm is ready 🌾');
  assert.equal(bloomLine({ crops: 12, trees: 2, animals: 3 }), '12 crops, 2 trees and 3 animals finished growing.');
  assert.equal(bloomLine({ crops: 1, animals: 1 }), '1 crop and 1 animal finished growing.');
  assert.equal(bloomLine({ trees: 1 }), '1 tree finished growing.');
  assert.equal(bloomLine({}), 'Everything that was growing finished at once.');
  const state = { farm: { objects: {
    p1: { def: 'plot', crop: { def: 'wheat' } }, p2: { def: 'plot', crop: { def: 'corn' } },
    t1: { def: 'apple_tree' }, a1: { def: 'chicken', home: 'c1' }, c1: { def: 'coop' },
  } } };
  assert.deepEqual(bloomCounts(state, ['a1', 'p1', 'p2', 't1', 'gone']), { crops: 2, trees: 1, animals: 1 });
  assert.deepEqual(bloomCounts(state, null), { crops: 0, trees: 0, animals: 0 });
});
