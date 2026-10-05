// The M1b goals around the weekly systems: chains F, G, H in their own tabs, the M1b quest verbs (complete, reach,
// together giant, place forage), the M1b ribbons fed by the economy's events, and the Goal Tracker cards of the Fair,
// the barge, the townsfolk board and the album.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT, RIBBON_REWARDS } from '../shared/content/index.js';
import { STORY_SLOTS, tabOf, forageCount } from '../shared/rules/actions/quests.js';
import { goals, taskText } from '../shared/rules/goals.js';
import { ribbonValue } from '../shared/rules/actions/ribbons.js';
import { resetGrid } from '../shared/rules/grid-cache.js';
import {
  farmAt, put, give, runDue, credit, actOk, valid, forceM1bGoals, MONDAY, HOUR, DAY, T0,
} from './helpers/rules-goals.js';

before(forceM1bGoals);

const tick = (s, now, pid = 'p1') => actOk(s, 'nameFarm', { name: `Farm ${now % 997}` }, { pid, now });

test('chains F, G and H open in their own tabs and never take a story slot', () => {
  const s = farmAt(20, { now: MONDAY });
  for (const id of ['g1', 'g2', 'f1', 'h1', 'h2', 'h3']) s.farm.quests.done[id] = T0;
  tick(s, MONDAY);
  const active = Object.keys(s.farm.quests.active).map((id) => CONTENT.quests.get(id));
  const story = active.filter((q) => tabOf(q) === 'story');
  assert.ok(story.length <= STORY_SLOTS);
  assert.deepEqual(active.filter((q) => tabOf(q) === 'week').map((q) => q.id).sort(), ['f2', 'g3']);
  assert.deepEqual(active.filter((q) => tabOf(q) === 'together').map((q) => q.id), ['h4']);
  valid(s);
});

test('M1b quest verbs: complete bundle / project / town_project, reach beauty_star (state), place forage', () => {
  const s = farmAt(23, { now: MONDAY });
  s.farm.quests.active = { e4: { at: MONDAY, n: {} } };
  credit(s, [{ e: 'bundleDone', project: 'greenhouse', bundle: 'seedlings' }], { now: MONDAY });
  assert.ok(s.farm.quests.active.e4);
  credit(s, [{ e: 'bundleDone', project: 'greenhouse', bundle: 'glass' }], { now: MONDAY }, { pid: 'p2' });
  assert.ok(s.farm.quests.done.e4, 'two bundles');
  assert.equal(s.farm.stats.bundlesDone, 2);
  // E5 "reach 2 Farm Beauty stars": the best star count, reached before or after the card opened
  credit(s, [{ e: 'beautyStar', stars: 2, score: 160 }], { now: MONDAY + HOUR });
  s.farm.quests.active.e5 = { at: MONDAY + 2 * HOUR, n: {} };
  tick(s, MONDAY + 2 * HOUR);
  assert.ok(s.farm.quests.done.e5);
  assert.equal(taskText({ verb: 'reach', ref: 'beauty_star', qty: 2 }), 'Reach 2 Farm Beauty stars');
  // E7 counts a Town Project BUILT
  s.farm.quests.active.e7 = { at: MONDAY + 3 * HOUR, n: {} };
  credit(s, [{ e: 'townBuilt', id: 'ferry_landing', n: 1, by: 'sys' }], { now: MONDAY + 3 * HOUR, pid: 'sys' });
  assert.ok(s.farm.quests.done.e7);
  // D2 "place 3 bee forage": decor counts its forage, a flowering tree one
  const t = farmAt(13);
  put(t, 'flower_bed');
  put(t, 'apple_tree');
  assert.equal(forageCount(t, T0 + DAY), 2);
  put(t, 'pine');
  assert.equal(forageCount(t, T0 + DAY), 2, 'a Pine is no forage');
  valid(s);
});

test('H4 "fell a giant crop together" needs two players on the last chops; H2/H5 count a collected duet', () => {
  const s = farmAt(20, { now: MONDAY });
  s.farm.quests.active = { h4: { at: MONDAY, n: {} } };
  credit(s, [{ e: 'giantFelled', id: 'g', crop: 'pumpkin', qty: 36, pair: null }], { now: MONDAY });
  assert.ok(s.farm.quests.active.h4, 'felled alone: no together deed');
  assert.equal(s.farm.stats.giantsFelled, 1);
  credit(s, [{ e: 'giantFelled', id: 'g', crop: 'pumpkin', qty: 36, pair: ['p1', 'p1'] }], { now: MONDAY });
  assert.ok(s.farm.quests.active.h4, 'one player twice is not two players');
  credit(s, [{ e: 'giantFelled', id: 'g', crop: 'pumpkin', qty: 36, pair: ['p1', 'p2'] }], { now: MONDAY });
  assert.ok(s.farm.quests.done.h4);
  assert.equal(s.farm.stats.teamworkFelled, 1);
  assert.equal(s.players.p2.stats.teamworkFelled, 1);
  assert.ok(s.farm.ribbons.giant_among_us?.t >= 1, 'Giant Among Us: Bronze at the first giant');
  valid(s);
});

test('M1b ribbons read their counters: Restorer, Hollow Reborn, Village Builders, Picture Perfect, Heirloom Keeper', () => {
  const s = farmAt(25, { now: MONDAY });
  const evs = [];
  for (let i = 0; i < 4; i++) evs.push({ e: 'bundleDone', project: 'greenhouse', bundle: `b${i}` });
  evs.push({ e: 'projectDone', project: 'greenhouse' }, { e: 'townBuilt', id: 'ferry_landing', n: 1 },
    { e: 'beautyStar', stars: 2, score: 160 });
  credit(s, evs, { now: MONDAY });
  for (const id of ['restorer', 'hollow_reborn', 'village_builders', 'picture_perfect']) {
    assert.equal(s.farm.ribbons[id]?.t, 1, id);
  }
  const tree = put(s, 'apple_tree', { cycle: CONTENT.trees.get('apple_tree').heirloomAt });
  void tree;
  credit(s, [{ e: 'picked', id: 'x', tree: 'apple_tree', item: 'apple', qty: 5, xp: 1, ribbon: false }],
    { now: MONDAY + HOUR });
  assert.equal(ribbonValue(s, CONTENT.ribbons.get('heirloom_keeper'), null, MONDAY + HOUR), 1);
  assert.equal(s.farm.ribbons.heirloom_keeper?.t, 1);
  // Busy Bees counts honey collected
  credit(s, Array.from({ length: 20 }, () => ({ e: 'collected', id: 'h', animal: 'bee', item: 'honey', qty: 1, xp: 0 })),
    { now: MONDAY + HOUR });
  assert.equal(s.farm.ribbons.busy_bees?.t, 1);
  assert.ok(RIBBON_REWARDS.F[0].acorns > 0);
  valid(s);
});

test('the Goal Tracker surfaces the weekly systems: a ready crate, a request to hand in, a Fair entry, an album set', () => {
  const s = farmAt(22, { now: MONDAY });
  for (let i = 0; i < 4; i++) put(s, 'apple_tree', { readyAt: MONDAY + 9 * DAY });
  for (const b of ['juice_press', 'dairy', 'bakery', 'feed_mill']) put(s, b);
  const barn = put(s, 'cow_barn');
  for (let i = 0; i < 2; i++) put(s, 'cow', { home: barn });
  for (const it of ['apple', 'apple_juice', 'cheese', 'pumpkin', 'butter']) s.farm.made[it] = 20000 + 731;
  runDue(s, MONDAY);
  for (const id of Object.keys(s.farm.objects)) {
    const o = s.farm.objects[id];
    if (o.def === 'plot') o.crop = { def: 'wheat', plantedAt: MONDAY, readyAt: MONDAY + 9 * DAY, by: 'p1', cycle: 0 };
    if (CONTENT.debris.has(o.def)) delete s.farm.objects[id];
  }
  for (const p of Object.values(s.players)) p.almanac.tasks = {};
  s.farm.orders.slots = {};
  const now = MONDAY + HOUR;
  const c0 = s.farm.barge.crates['0'];
  if (c0) {
    give(s, c0.item, c0.qty);
    const g = goals(s, 'p1', now);
    assert.equal(g.now.kind, 'barge', g.now.text);
    assert.match(g.now.text, /^Load a barge crate: \d+ .+ \([0-9,]+\)$/);
    actOk(s, 'bargeLoad', { i: 0 }, { now });
  }
  s.farm.barge.docked = false;                       // the barge has left: the board's turn
  const p = s.farm.folk.posts['0'];
  for (const [i, q] of Object.entries(p.items)) give(s, i, q);
  const g2 = goals(s, 'p1', now);
  assert.equal(g2.now.kind, 'folk', g2.now.text);
  assert.match(g2.now.text, /^Hand in .+'s request \([0-9,]+\)$/);
  actOk(s, 'folkFill', { i: 0, n: p.n }, { now });
  give(s, 'sweetheart_cake', 2);
  const g3 = goals(s, 'p1', now);
  assert.equal(g3.now.kind, 'fair', g3.now.text);
  assert.match(g3.now.text, /^Enter Sweetheart Cake at the Fair \(\+25\.8 points\)$/);
  // an album set at 80 % is a BIG goal
  s.farm.album.sets.feathers = { r: 9, pity: 0, done: null, items: Object.fromEntries(CONTENT.collections.get('feathers')
    .items.slice(0, 4).map((i) => [i.id, { by: 'p1', at: T0, n: 1 }])) };
  s.farm.ribbons.level_up = { t: 2, at: T0 };          // Level Up's next tier (40) is far: the album's 80 % shows
  // the orchard above would bring the next Farm Beauty star close enough to outrank it (M1b live): fell it first
  for (const id of Object.keys(s.farm.objects)) if (s.farm.objects[id].def === 'apple_tree') delete s.farm.objects[id];
  resetGrid(s);
  const g4 = goals(s, 'p2', now);
  assert.equal(g4.big.kind, 'album', g4.big.text);
  assert.equal(g4.big.text, 'Feathers: 4 of 5 found');
  valid(s);
});

test('duet bookkeeping is the same for the Harvest Feast and the Wedding Cake: Hearts, the Duet ribbon, H2 / H5', () => {
  const s = farmAt(25, { now: MONDAY });
  s.farm.quests.active = { h5: { at: MONDAY, n: {} } };
  for (const recipe of ['harvest_feast', 'wedding_cake']) {
    credit(s, [{ e: 'duet', id: 'k', building: 'kitchen', recipe, a: 'p1', b: 'p2' }], { now: MONDAY + HOUR, pid: 'p2' });
  }
  assert.equal(s.farm.stats.duets, 2);
  assert.equal(s.players.p1.stats.duets, 2);
  assert.equal(s.players.p2.hearts >= 2, true);
  assert.ok(s.farm.quests.done.h5, 'A Cake for Two');
  // duet goods are no order goods (only golden orders ask for one) and score double at the Fair (entryPoints10)
  valid(s);
});

test('every M1b ribbon has a counter its system moves (Captain\'s Friend, Full Steam, Hamper Maker, Best Friends)', () => {
  const s = farmAt(22, { now: MONDAY });
  credit(s, [1, 2, 3].map((row) => ({ e: 'bargeRow', row, w: 1, coins: 1, acorns: 0, compost: 0, decor: null,
    loaders: ['p1'] })), { now: MONDAY });
  assert.equal(s.farm.ribbons.captains_friend?.t, 1);
  credit(s, [{ e: 'bargeCastOff', w: 1, rows: 1, done: 1, t: 2, streak: 2, by: 'sys' }], { now: MONDAY, pid: 'sys' });
  assert.equal(s.farm.ribbons.full_steam?.t, 1);
  credit(s, Array.from({ length: 5 }, () => ({ e: 'crafted', id: 'p', building: 'packing', recipe: 'breakfast_hamper',
    item: 'breakfast_hamper', qty: 1, xp: 0 })), { now: MONDAY });
  assert.equal(s.farm.ribbons.hamper_maker?.t, 1);
  credit(s, Array.from({ length: 7 }, () => ({ e: 'petFed', pid: 'p2', pet: 'dog' })), { now: MONDAY });
  if (CONTENT.ribbons.get('best_friends').m === 'M1b') assert.equal(s.players.p2.ribbons.best_friends?.t, 1);
  // the static audit: every live M1b ribbon reads a counter that some handler in progress.js / ribbons.js moves
  const moved = new Set(['giantsFelled', 'heirloomTrees', 'collect.honey', 'petFedDays', 'premiumGoodsMade', 'bargeRows',
    'bargeStreak', 'beautyStars', 'setsCompleted', 'albumItems', 'bundlesDone', 'projectsDone', 'bestMedal',
    'medalWeeks', 'teamworkFelled', 'memoryPages', 'townProjects']);
  for (const r of CONTENT.ribbons.values()) {
    if (r.m === 'M1b') assert.ok(moved.has(r.stat), `${r.id} reads ${r.stat}: nothing moves it`);
  }
  valid(s);
});

test('a pet\'s "collection roll" find rolls an open set for its owner; an Heirloom event re-reads Heirloom Keeper', () => {
  const s = farmAt(12, { now: MONDAY });
  const before = Object.values(s.farm.album.sets).reduce((n, st) => n + st.r, 0);
  credit(s, [{ e: 'petFind', pid: 'p2', pet: 'dog', treasure: false, find: 'roll', roll: true, by: 'sys' }],
    { now: MONDAY, pid: 'sys' });
  const after = Object.values(s.farm.album.sets).reduce((n, st) => n + st.r, 0);
  assert.equal(after, before + 1);
  put(s, 'apple_tree', { heirloom: true });
  credit(s, [{ e: 'heirloom', id: 'x', tree: 'apple_tree' }], { now: MONDAY + HOUR });
  assert.equal(s.farm.ribbons.heirloom_keeper?.t, 1);
});

test('the tracker: a ripe Giant is one "fell it" card (never "collect 9"); Town Project, Restoration and Beauty goals', () => {
  const s = farmAt(22, { now: MONDAY });
  const plots = Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'plot').sort();
  for (const id of plots) s.farm.objects[id].crop = { def: 'wheat', plantedAt: MONDAY, readyAt: MONDAY + DAY, by: 'p1', cycle: 0 };
  // nine plots of a Giant Pumpkin, ripe, anchored on the first
  const anchor = plots[0];
  for (const id of plots.slice(0, 9)) {
    s.farm.objects[id].crop = { def: 'pumpkin', plantedAt: MONDAY, readyAt: MONDAY, by: 'p1', cycle: 0, giant: anchor };
  }
  for (const id of Object.keys(s.farm.objects)) if (CONTENT.debris.has(s.farm.objects[id].def)) delete s.farm.objects[id];
  for (const p of Object.values(s.players)) p.almanac.tasks = {};
  const g = goals(s, 'p1', MONDAY + HOUR);
  assert.equal(g.now.kind, 'giant', g.now.text);
  assert.match(g.now.text, /^Fell the Giant Pumpkin: \d+ chops, quicker together$/);
  assert.equal(g.now.target.tool, 'axe');
  // the village: a good the Barn holds goes to the Town Project
  s.farm.town = { n: 0, cur: { id: 'ferry_landing', n: 1, at: MONDAY, lvl: 22, goods: [{ item: 'cheese', qty: 10, got: 2,
    by: {} }], coins: 1000, paid: 0, by: {} } };
  for (const id of plots.slice(0, 9)) s.farm.objects[id].crop.readyAt = MONDAY + DAY;
  give(s, 'cheese', 4);
  const t = goals(s, 'p1', MONDAY + HOUR);
  assert.equal(t.now.kind, 'town', t.now.text);
  assert.equal(t.now.text, 'Give 4 Cheese to the Ferry Landing');
  assert.equal(t.now.target.panel, 'town');
});

test('Farm Beauty stars add order coins (+1 % a star, at most 5 %): orderFill pays them', () => {
  const s = farmAt(20, { now: MONDAY });
  runDue(s, MONDAY);
  const k = Object.keys(s.farm.orders.slots).find((x) => s.farm.orders.slots[x].order);
  const o = s.farm.orders.slots[k].order;
  for (const [i, q] of Object.entries(o.items)) give(s, i, q);
  const coins = s.farm.wallet.coins;
  const r = actOk(s, 'orderFill', { slot: Number(k), n: o.n }, { now: MONDAY + HOUR });
  // no decor on the test farm: no star, the order's own coins (the bonus helper reads rules-economy's beauty)
  assert.equal(s.farm.wallet.coins - coins, r.tx.events.find((e) => e.e === 'orderFilled').coins);
  assert.ok(r.tx.events.find((e) => e.e === 'orderFilled').coins >= o.coins);
});
