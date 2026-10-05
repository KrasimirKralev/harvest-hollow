// M1b crops and trees: giant crops (GDD §6.2 #8, §9 #43), Heirloom trees (§3.2 rule 8), the Cold Frame and the
// Greenhouse (in season anywhere, §3.8, §5.9), Heirloom Seeds (seed price perk). Against the M1b content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m1b, withDefs } from './helpers/rules-economy.js';

const M = await m1b();
const { content, economy, giant, trees, farming } = M;
const { farmAt, give, placeDef, must, run, evs, T0, HOUR, MIN } = M.rulesHelpers;
const { sys } = M.helpers;
const { validateState } = M.state;
const { resetGrid } = M.gridCache;
const album = await import('../shared/rules/actions/album.js');
const { Tx } = await import('../shared/rules/tx.js');
const { weatherAt } = await import('../shared/rules/time.js');
const BIG = { confirm: ['BIG_SPEND'] };
const G = content.COOP.giant;

function farm(level, o = {}) {
  const s = farmAt(level, { coins: 50_000_000, acorns: 200, ...o });
  s.farm.expansions = content.live('expansions').map((e) => e.id);
  resetGrid(s);
  return s;
}

/** A 3 x 3 block of new plots with its min corner at (x0, z0), row order. */
function block(s, x0, z0) {
  const ids = [];
  for (let dz = 0; dz < 3; dz++) {
    for (let dx = 0; dx < 3; dx++) ids.push(placeDef(s, 'plot', { at: [x0 + dx, z0 + dz] }));
  }
  return ids;
}

/** Compost and plant a block (one stroke each) at `now`; returns the plant result. */
function sow(s, ids, crop, now) {
  give(s, 'compost', 9);
  must(s, 'compost', { ids }, { now });
  return must(s, 'plant', { ids, crop }, { now });
}

/** Plant / harvest a block until it rolls a Giant (20 % per cycle). Returns { ids, now }. */
function growGiant(s, crop = 'pumpkin', at = [20, 20]) {
  const ids = block(s, ...at);
  let now = T0;
  const grow = content.cropOf(crop).growMs;
  for (let i = 0; i < 60; i++) {
    const r = sow(s, ids, crop, now);
    if (evs(r, 'giantFormed').length) return { ids, now, r };
    now += grow + HOUR;
    must(s, 'harvest', { ids }, { now });
  }
  throw new Error('no giant in 60 cycles');
}

test('a composted 3 x 3 block of one crop planted within a minute: a 20 % chance per cycle of a Giant', () => {
  let giants = 0;
  let tries = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const s = farm(20, { seed });
    const ids = block(s, 20, 20);
    let now = T0;
    for (let c = 0; c < 6; c++) {
      const r = sow(s, ids, 'wheat', now);
      tries++;
      if (evs(r, 'giantFormed').length) { giants++; break; }
      now += content.cropOf('wheat').growMs + MIN;
      must(s, 'harvest', { ids }, { now });
      now += MIN;
    }
  }
  assert.ok(giants / tries > 0.1 && giants / tries < 0.32, `${giants} giants in ${tries} blocks`);
});

test('no Giant without compost on all nine, with two crops, planted > 1 minute apart, or before L20', () => {
  const cases = [
    ['L19', (s) => { s.farm.xp = content.xpForLevel(19); }],
    ['one plot without compost', (s, ids) => { delete s.farm.objects[ids[4]].compost; }],
  ];
  for (const [name, spoil] of cases) {
    for (let seed = 1; seed <= 12; seed++) {
      const s = farm(20, { seed });
      const ids = block(s, 20, 20);
      give(s, 'compost', 9);
      must(s, 'compost', { ids });
      spoil(s, ids);
      const r = must(s, 'plant', { ids, crop: 'wheat' });
      assert.equal(evs(r, 'giantFormed').length, 0, `${name} seed ${seed}`);
    }
  }
  for (let seed = 1; seed <= 12; seed++) {
    const s = farm(20, { seed });
    const ids = block(s, 20, 20);
    give(s, 'compost', 9);
    must(s, 'compost', { ids });
    must(s, 'plant', { ids: ids.slice(0, 8), crop: 'wheat' }, { now: T0 });
    const late = must(s, 'plant', { id: ids[8], crop: 'wheat' }, { now: T0 + G.plantWindowMs + 1 });
    assert.equal(evs(late, 'giantFormed').length, 0, 'planted more than a minute after the first');
    const s2 = farm(20, { seed });
    const ids2 = block(s2, 20, 20);
    give(s2, 'compost', 9);
    must(s2, 'compost', { ids: ids2 });
    must(s2, 'plant', { ids: ids2.slice(0, 8), crop: 'wheat' });
    assert.equal(evs(must(s2, 'plant', { id: ids2[8], crop: 'corn' }), 'giantFormed').length, 0, 'two crops');
  }
});

test('the roll is keyed on the block and its cycle: uprooting and replanting never re-rolls (no fishing)', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const s = farm(20, { seed });
    const ids = block(s, 20, 20);
    const first = evs(sow(s, ids, 'pumpkin', T0), 'giantFormed').length;
    if (first) continue;                                    // a Giant cannot be uprooted; that is the next test
    must(s, 'uproot', { ids }, { now: T0 + MIN });
    for (const id of ids) assert.equal(s.farm.objects[id].compost, true, 'the Compost stays on the plot');
    const again = must(s, 'plant', { ids, crop: 'pumpkin' }, { now: T0 + 2 * MIN });
    assert.equal(evs(again, 'giantFormed').length, 0, `seed ${seed}: the same cycle rolls the same miss`);
  }
});

test('a Giant: one ripeness for nine plots, felled with the Axe (60 hp: 6 chops alone), never harvested', () => {
  const s = farm(20);
  const { ids, now, r } = growGiant(s);
  const anchor = ids[0];
  const ev = evs(r, 'giantFormed')[0];
  assert.deepEqual(ev.ids, ids);
  assert.equal(ev.id, anchor);
  for (const id of ids) assert.equal(s.farm.objects[id].crop.giant, anchor);
  assert.equal(new Set(ids.map((id) => s.farm.objects[id].crop.readyAt)).size, 1, 'one ripeness');
  assert.equal(s.farm.objects[anchor].crop.hp, G.hp);
  // growing: no uproot, no move, no Sickle; watering one plot waters the whole Giant once
  assert.equal(run(s, 'uproot', { id: ids[4] }, { now: now + MIN }).code, 'LOCKED');
  assert.equal(run(s, 'move', { id: ids[4], x: 40, z: 40, rot: 0 }, { now: now + MIN }).code, 'LOCKED');
  const rained = s.farm.objects[anchor].crop.water === 'sys';                // planted in the rain: watered already
  const w = must(s, 'water', { ids: [ids[3], ids[5], ids[8]] }, { now: now + MIN });
  assert.equal(evs(w, 'watered').length, 1, 'the whole Giant, once');
  assert.equal(new Set(ids.map((id) => s.farm.objects[id].crop.readyAt)).size, 1);
  if (!rained) {
    assert.equal(run(s, 'water', { id: ids[2] }, { now: now + 2 * MIN }).code, 'SELF_ONLY');
    must(s, 'water', { id: ids[2] }, { now: now + 2 * MIN, pid: 'p2' });     // the partner tend, -5 % more
    for (const id of ids) assert.equal(s.farm.objects[id].crop.tend, 'p2');
  }
  assert.equal(run(s, 'water', { id: ids[7] }, { now: now + 3 * MIN, pid: 'p2' }).code, 'ALREADY_DONE');
  assert.equal(new Set(ids.map((id) => s.farm.objects[id].crop.readyAt)).size, 1);
  const ripe = s.farm.objects[anchor].crop.readyAt;
  assert.equal(run(s, 'chop', { id: ids[1] }, { now: ripe - 1, grace: 0 }).code, 'NOT_READY');
  assert.equal(run(s, 'harvest', { ids }, { now: ripe }).code, 'LOCKED', 'a Giant is felled, not harvested');
  const held = (s.farm.inventory.pumpkin ?? 0) + (s.farm.overflow.pumpkin ?? 0);
  for (let i = 1; i <= 5; i++) {
    const hit = must(s, 'chop', { ids: [ids[i], ids[i + 1]] }, { now: ripe + i * 5000 });  // two tiles, one chop
    assert.equal(evs(hit, 'chopHit')[0].hp, G.hp - 10 * i);
    assert.equal(evs(hit, 'chopHit')[0].giant, true);
  }
  const fell = must(s, 'chop', { id: ids[7] }, { now: ripe + 30_000 });
  const felled = evs(fell, 'giantFelled')[0];
  const crop = content.cropOf('pumpkin');
  const ribbons = evs(fell, 'harvested').filter((e) => e.ribbon).length;
  assert.equal(evs(fell, 'harvested').length, 9, 'nine harvests: XP, mastery and quests as nine plots');
  assert.equal(felled.qty, G.yieldMul * 9 * (crop.yield + 1) + ribbons, '2 x 9 x (yield + 1) + blue ribbons');
  assert.equal(felled.team, false);
  assert.equal(felled.pair, undefined);
  assert.equal((s.farm.inventory.pumpkin ?? 0) + (s.farm.overflow.pumpkin ?? 0) - held, felled.qty);
  for (const id of ids) {
    assert.equal(s.farm.objects[id].crop, null);
    assert.equal(s.farm.objects[id].compost, undefined, 'the Compost was used up');
  }
  assert.deepEqual(validateState(s), []);
});

test('felling a Giant together: a chop within 2 s of the OTHER player\'s deals 15; the pair is named', () => {
  const s = farm(20);
  const { ids } = growGiant(s);
  const ripe = s.farm.objects[ids[0]].crop.readyAt;
  let t = ripe;
  let hits = 0;
  let fell = null;
  for (const pid of ['p1', 'p2', 'p1', 'p2', 'p1']) {
    const r = must(s, 'chop', { id: ids[4] }, { now: t, pid });
    hits++;
    t += 1000;
    if (evs(r, 'giantFelled').length) { fell = evs(r, 'giantFelled')[0]; break; }
  }
  assert.ok(fell, 'felled');
  assert.equal(hits, 5, '10 + 15 + 15 + 15 + 15 = 70 >= 60: five chops together instead of six');
  assert.equal(fell.team, true);
  assert.deepEqual(fell.pair, ['p1', 'p2']);
  // the same player twice is no combo (two tabs are one pid, §9 #20)
  const s2 = farm(20);
  const g2 = growGiant(s2);
  const r2 = s2.farm.objects[g2.ids[0]].crop.readyAt;
  must(s2, 'chop', { id: g2.ids[0] }, { now: r2 });
  const h = must(s2, 'chop', { id: g2.ids[0] }, { now: r2 + 500 });
  assert.equal(evs(h, 'chopHit')[0].hp, G.hp - 20);
});

test('a Giant waits ripe while the Barn is at 2 x capacity; Hurry and the Bloom act on all nine plots', () => {
  const s = farm(20, { acorns: 500 });
  const { ids, now } = growGiant(s);
  must(s, 'hurry', { id: ids[6], ...BIG }, { now: now + MIN });
  for (const id of ids) assert.equal(s.farm.objects[id].crop.readyAt, now + MIN);
  // fill the Barn to 2 x capacity
  give(s, 'wheat', 2 * economy.barnCap(s) - economy.stockOf(s) - economy.overflowOf(s));
  for (let i = 0; i < 5; i++) must(s, 'chop', { id: ids[0] }, { now: now + 2 * MIN + i * 5000 });
  assert.equal(run(s, 'chop', { id: ids[0] }, { now: now + 3 * MIN }).code, 'STORAGE_FULL', 'the last chop waits');
  assert.equal(s.farm.objects[ids[0]].crop.hp, 10);
});

test('the Level-up Bloom ripens a whole Giant at once: its nine plots on one timer, all nine in the wave', () => {
  const s = farm(20);
  const { ids, now } = growGiant(s);
  const t = now + 20 * MIN;
  const tx = new Tx(s);
  M.boosts.bloom(tx, M.index.makeCtx(s, { now: t, pid: 'p1', cid: 'tstcid', seq: 99 }), 21);
  const bloomed = tx.events.filter((e) => e.e === 'bloomed');
  assert.equal(bloomed.length, 1);
  assert.deepEqual(bloomed[0].ids, [...ids].sort());
  for (const id of ids) assert.equal(s.farm.objects[id].crop.readyAt, t, 'ripe at the level-up');
  assert.deepEqual(validateState(s), []);
  must(s, 'chop', { id: ids[4] }, { now: t });
});

test('rain keeps a Giant\'s nine plots on one timer', () => {
  const s = farm(20);
  const { ids, now } = growGiant(s);
  const t = now + 20 * MIN;
  // rain: the first rain hour inside the growth, caught up by one `_rain`
  const ready = s.farm.objects[ids[0]].crop.readyAt;
  let h = Math.floor(t / HOUR) + 1;
  while (h * HOUR < ready && weatherAt(s.meta.farmSeed, h) !== 'rain') h++;
  assert.ok(h * HOUR < ready, 'a rain hour while the Pumpkin Giant grows (12 h)');
  s.farm.rain.at = h - 1;
  const r = sys(s, '_rain', {}, h * HOUR + 1);
  assert.equal(r.ok, true);
  assert.equal(new Set(ids.map((id) => s.farm.objects[id].crop.readyAt)).size, 1, 'one timer after the rain');
  for (const id of ids) assert.equal(s.farm.objects[id].crop.water, 'sys');
  assert.deepEqual(validateState(s), []);
});

test('Heirloom: after `heirloomAt` harvests a tree gives +1 fruit and a 5 % blue-ribbon chance for good', () => {
  const s = farm(13);
  const tree = placeDef(s, 'orange_tree', BIG);
  const def = content.treeOf('orange_tree');
  const o = s.farm.objects[tree];
  o.cycle = def.heirloomAt - 1;
  o.readyAt = o.matureAt = o.startedAt = T0;
  assert.equal(trees.isHeirloom(o), false);
  const r = must(s, 'harvestTree', { id: tree }, { now: T0 + 11 * MIN });
  assert.equal(evs(r, 'heirloom').length, 1, 'the harvest that makes it an Heirloom says so');
  assert.equal(trees.isHeirloom(s.farm.objects[tree]), true);
  let ribbons = 0;
  let base = 0;
  const N = 600;
  for (let c = 0; c < N; c++) {
    s.farm.objects[tree].cycle = def.heirloomAt + c;
    const ctx = M.index.makeCtx(s, { now: T0, pid: 'p1', cid: 'tstcid', seq: 1 });
    const h = trees.treeHarvestOf(s, tree, ctx);
    if (h.ribbon) ribbons++;
    base = Math.min(base || Infinity, h.qty);
  }
  // + the tree's age (wave 4b: a 60-year tree is in its last stage)
  const age = trees.treeAgeOf({ cycle: def.heirloomAt }).bonusUnits;
  assert.equal(base, def.yield + 1 + age, 'never less than yield + 1 + age');
  assert.ok(ribbons > N * 0.025 && ribbons < N * 0.085, `${ribbons} ribbons in ${N}`);
});

test('a Cold Frame makes crops within 2 tiles in season: -10 % time, and the +10 % sell as a bonus-unit chance', () => {
  const s = farm(24);
  // Cabbage is in season in winter only; T0 (2026-09-21) is summer/autumn in Sofia
  assert.equal(economy.inSeason(s, 'cabbage', T0), false);
  const near = placeDef(s, 'plot', { at: [20, 20] });
  const far = placeDef(s, 'plot', { at: [30, 30] });
  must(s, 'place', { def: 'greenhouse_frame', x: 22, z: 20, rot: 0, ...BIG });
  must(s, 'plant', { ids: [near, far], crop: 'cabbage' });
  const c = content.cropOf('cabbage');
  assert.equal(s.farm.objects[near].crop.forced, true);
  assert.equal(s.farm.objects[near].crop.readyAt - T0, c.growMs - c.growMs / 10);
  assert.equal(s.farm.objects[far].crop.forced, undefined);
  assert.equal(s.farm.objects[far].crop.readyAt - T0, c.growMs);
  // over many cycles a forced crop gets one extra unit in yield x 10 % of harvests (the in-season +10 % value)
  let extra = 0;
  const N = 800;
  for (let k = 0; k < N; k++) {
    s.farm.objects[near].cycle = k;
    s.farm.objects[near].crop = { ...s.farm.objects[near].crop, cycle: k, forced: true };
    const ctx = M.index.makeCtx(s, { now: T0 + 2 * c.growMs, pid: 'p1', cid: 'tstcid', seq: 1 });
    extra += farming.harvestOf(s, near, ctx).bonus;
  }
  assert.ok(extra / N > 0.12 && extra / N < 0.29, `${extra / N} extra units a harvest (expected ${c.yield / 10})`);
});

const GREENHOUSE = { id: 'greenhouse', name: 'Old Greenhouse', kind: 'landmark', layer: 'ground', size: [6, 4],
  shop: false, movable: true, panel: null, greenhouse: { plots: 12 }, model: 'landmarks/greenhouse' };

test('the Greenhouse: its 12 plots arrive with it, beyond the plot cap, always in season, and move with it', () => {
  const gh = content.defOf('greenhouse') ? null : GREENHOUSE;
  const run1 = () => {
    const s = farm(16);
    s.farm.storage.greenhouse = 1;
    const capBefore = M.decor.ownCap(s, content.defOf('plot'));
    const ownedBefore = M.decor.ownedCount(s, 'plot');
    const r = must(s, 'place', { def: 'greenhouse', x: 20, z: 20, rot: 0 });
    const id = evs(r, 'placed')[0].id;
    const plots = Object.keys(s.farm.objects).filter((k) => s.farm.objects[k].gh === id).sort();
    assert.equal(plots.length, 12);
    assert.equal(M.decor.ownedCount(s, 'plot'), ownedBefore, 'beyond the plot cap');
    assert.equal(M.decor.ownCap(s, content.defOf('plot')), capBefore);
    for (const p of plots) {
      const o = s.farm.objects[p];
      assert.ok(o.x >= 20 && o.x < 26 && o.z >= 21 && o.z < 23, `inner rows: ${o.x},${o.z}`);
    }
    // nothing else stands inside; its plots never move or sell on their own
    assert.equal(M.grid.canPlace(s, 'flower_bed', 21, 20, 0), 'BLOCKED', 'the aisle is glass and gravel');
    assert.equal(run(s, 'move', { id: plots[0], x: 40, z: 40, rot: 0 }).code, 'LOCKED');
    assert.equal(run(s, 'sellObject', { id: plots[0] }).code, 'LOCKED');
    // always in season
    must(s, 'plant', { ids: plots.slice(0, 2), crop: 'cabbage' });
    assert.equal(s.farm.objects[plots[0]].crop.forced, true);
    // the frame moves (rotated) and carries its plots, growing crops and all
    const m = must(s, 'move', { id, x: 40, z: 32, rot: 1 });
    assert.equal(evs(m, 'moved').length, 1);
    for (const p of plots) {
      const o = s.farm.objects[p];
      assert.ok(o.x >= 41 && o.x < 43 && o.z >= 32 && o.z < 38, `rotated inner columns: ${o.x},${o.z}`);
    }
    assert.equal(s.farm.objects[plots[0]].crop.def, 'cabbage');
    assert.deepEqual(validateState(s), []);
    must(s, 'moveBack', { id });
    assert.equal(s.farm.objects[plots[0]].x, 20);
    assert.deepEqual(validateState(s), []);
    // weeds never regrow inside
    assert.ok(M.expansions.freeTiles(s).every(([x, z]) => !(x >= 20 && x < 26 && z >= 20 && z < 24)));
  };
  if (gh) withDefs(content, 'landmarks', [gh], run1); else run1();
});

test('Heirloom Seeds take 3 % off every seed price (never below 1); the Uproot refund is what was paid', () => {
  const s = farm(14);
  const plot = placeDef(s, 'plot', { at: [20, 20] });
  economy.setPerkSource((st, key) => (key === 'seedBp' ? 300 : 0));
  try {
    assert.equal(farming.seedPrice(s, content.cropOf('pumpkin')), 356 - 10);
    assert.equal(farming.seedPrice(s, content.cropOf('wheat')), 2 - 0);
    const coins = s.farm.wallet.coins;
    must(s, 'plant', { id: plot, crop: 'pumpkin' });
    assert.equal(coins - s.farm.wallet.coins, 346);
    must(s, 'uproot', { id: plot }, { now: T0 + MIN });
    assert.equal(s.farm.wallet.coins, coins);
  } finally {
    economy.setPerkSource(album.perkOf);
  }
});

test('RC-09: a Giant felled together shares its nine harvests and its Fair points by chop share', () => {
  const s = farm(20);
  const { ids } = growGiant(s);
  let t = s.farm.objects[ids[0]].crop.readyAt;
  let fell = null;
  for (const pid of ['p1', 'p2', 'p1', 'p2', 'p1']) {
    const r = must(s, 'chop', { id: ids[4] }, { now: t, pid });
    t += 1000;
    if (evs(r, 'giantFelled').length) { fell = r; break; }
  }
  assert.ok(fell, 'felled');
  const ev = evs(fell, 'giantFelled')[0];
  assert.deepEqual(ev.hits, { p1: 3, p2: 2 });
  const by = evs(fell, 'harvested').map((e) => e.by);
  assert.deepEqual([by.filter((p) => p === 'p1').length, by.filter((p) => p === 'p2').length], [5, 4],
    'nine harvests split 3 : 2 by largest remainder');
  const pts = evs(fell, 'fairPoints').filter((e) => e.why === 'giant');
  if (pts.length) {                                     // the Fair is open: its +25 points are shared too
    const of = (p) => pts.filter((e) => e.by === p).reduce((n, e) => n + e.p10, 0);
    assert.ok(of('p1') > 0 && of('p2') > 0, JSON.stringify(pts));
  }
  assert.deepEqual(validateState(s), []);
});

test('RC-09: shareOut splits exactly, deterministically, by largest remainder', async () => {
  const { shareOut } = await import('../shared/rules/order.js');
  assert.deepEqual(shareOut(9, { p1: 3, p2: 2 }), { p1: 5, p2: 4 });
  assert.deepEqual(shareOut(9, { p2: 1, p1: 1 }), { p1: 5, p2: 4 });
  assert.deepEqual(shareOut(250, { p1: 6 }), { p1: 250 });
  assert.deepEqual(shareOut(5, {}), {});
});
