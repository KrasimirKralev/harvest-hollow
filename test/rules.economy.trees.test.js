// Trees and debris (GDD §2.3 debris, §3.2 rules 1-9, §6.2 #8 chop combo; DEBRIS_RULES).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { treeOf, defOf, GROWTH, COOP, DEBRIS_RULES } from '../shared/content/index.js';
import { validateState } from '../shared/rules/state.js';
import { inGrove, treeHarvestOf } from '../shared/rules/actions/trees.js';
import { mulBp, cutMs, available } from '../shared/rules/economy.js';
import { makeCtx } from '../shared/rules/index.js';
import { canPlace } from '../shared/rules/grid.js';
import { run, must, T0, makeFarm, farmAt, give, placeDef, idsOf, evs, allLand } from './helpers/rules.js';

const APPLE = treeOf('apple_tree');
const PINE = treeOf('pine');

test('a sapling grows saplingCycles cycles without fruit, then ripens every cycle from its harvest', () => {
  const s = farmAt(4);
  allLand(s);
  const id = placeDef(s, 'apple_tree', { confirm: ['BIG_SPEND'] });
  const o = structuredClone(s.farm.objects[id]);
  assert.equal(o.matureAt, T0 + APPLE.saplingCycles * APPLE.cycleMs);
  assert.equal(o.readyAt, o.matureAt + APPLE.cycleMs);
  assert.equal(run(s, 'harvestTree', { id }, { now: o.matureAt }).code, ERR.NOT_READY);
  const r = must(s, 'harvestTree', { id }, { now: o.readyAt });
  const p = evs(r, 'picked')[0];
  assert.equal(p.item, 'apple');
  assert.equal(p.qty, APPLE.yield + p.bonus);
  assert.equal(p.xp, APPLE.xp);
  assert.equal(s.farm.objects[id].cycle, 1);
  assert.equal(s.farm.objects[id].readyAt, o.readyAt + APPLE.cycleMs, 'the next cycle starts at harvest');
  assert.equal(run(s, 'chop', { id }, { now: o.readyAt + APPLE.cycleMs }).code, ERR.BAD_ARGS, 'apples are shaken');
  assert.deepEqual(validateState(s), []);
});

test('trees: water -20 % of the cycle, partner tend -5 %, once per cycle; compost +1 fruit', () => {
  const s = farmAt(8);
  allLand(s);
  const id = placeDef(s, 'apple_tree', { confirm: ['BIG_SPEND'] });
  const r0 = s.farm.objects[id].readyAt;
  must(s, 'water', { id }, { pid: 'p1' });
  assert.equal(s.farm.objects[id].readyAt, r0 - mulBp(APPLE.cycleMs, GROWTH.water.treeBp));
  must(s, 'water', { id }, { pid: 'p2' });
  assert.equal(s.farm.objects[id].readyAt, r0 - mulBp(APPLE.cycleMs, GROWTH.water.treeBp + COOP.partnerTend.bp));
  assert.equal(run(s, 'water', { id }, { pid: 'p1' }).code, ERR.ALREADY_DONE);
  give(s, 'compost', 1);
  must(s, 'compost', { id });
  const ready = s.farm.objects[id].readyAt;
  const r = must(s, 'harvestTree', { id }, { now: ready });
  assert.ok(evs(r, 'picked')[0].bonus >= 1);
  assert.equal(s.farm.objects[id].water, undefined, 'the next cycle can be watered again');
  assert.equal(s.farm.objects[id].compost, undefined);
});

test('grove: four same-species trees in an exact 2x2 block each give +1 fruit; mixed blocks nothing', () => {
  const s = farmAt(12);
  allLand(s);
  // find a free 4x4 square
  let at = null;
  for (let z = 8; z < 52 && !at; z++) {
    for (let x = 8; x < 52 && !at; x++) {
      if ([[0, 0], [2, 0], [0, 2], [2, 2]].every(([dx, dz]) => canPlace(s, 'apple_tree', x + dx, z + dz, 0) === null)) at = [x, z];
    }
  }
  const ids = [[0, 0], [2, 0], [0, 2]].map(([dx, dz]) => placeDef(s, 'apple_tree', { at: [at[0] + dx, at[1] + dz], confirm: ['BIG_SPEND'] }));
  assert.equal(inGrove(s, s.farm.objects[ids[0]]), false);
  const cherry = placeDef(s, 'cherry_tree', { at: [at[0] + 2, at[1] + 2], confirm: ['BIG_SPEND'] });
  assert.equal(inGrove(s, s.farm.objects[ids[0]]), false, 'mixed block');
  must(s, 'sellObject', { id: cherry });                    // inside the undo window
  ids.push(placeDef(s, 'apple_tree', { at: [at[0] + 2, at[1] + 2], confirm: ['BIG_SPEND'] }));
  for (const id of ids) assert.equal(inGrove(s, s.farm.objects[id]), true);
  const ctx = makeCtx(s, { now: s.farm.objects[ids[0]].readyAt, pid: 'p1', cid: 'abcdef', seq: 1 });
  assert.equal(treeHarvestOf(s, ids[0], ctx).grove, true);
});

test('Pine: chopped (not shaken) for Wood every cycle; the stump regrows by itself', () => {
  const s = farmAt(6);
  allLand(s);
  const id = placeDef(s, 'pine', { confirm: ['BIG_SPEND'] });
  const ready = s.farm.objects[id].readyAt;
  assert.equal(run(s, 'harvestTree', { id }, { now: ready }).code, ERR.BAD_ARGS);
  const w0 = available(s, 'wood');
  const r = must(s, 'chop', { id }, { now: ready });
  const c = evs(r, 'chopped')[0];
  assert.equal(c.item, 'wood');
  assert.equal(available(s, 'wood') - w0, c.qty);
  assert.ok(c.qty >= PINE.yield);
  assert.equal(s.farm.objects[id].readyAt, ready + cutMs(PINE.cycleMs, 0));
});

test('debris: weeds clear with one click; stumps take chops; XP by origin, 5 coins per XP, Wood', () => {
  const s = makeFarm();
  const weed = idsOf(s, 'weed')[0];
  const stump = idsOf(s, 'stump')[0];
  const r = must(s, 'chop', { id: weed });
  assert.deepEqual(evs(r, 'cleared')[0], { e: 'cleared', id: weed, def: 'weed', by: 'p1', xp: defOf('weed').xp.home,
    coins: defOf('weed').xp.home * DEBRIS_RULES.coinsPerXp, origin: 'home' });
  assert.equal(s.farm.objects[weed], undefined);
  const hits = defOf('stump').hp / DEBRIS_RULES.chopDamage;
  for (let i = 1; i < hits; i++) {
    const h = must(s, 'chop', { id: stump });
    assert.equal(evs(h, 'chopHit')[0].hp, defOf('stump').hp - i * DEBRIS_RULES.chopDamage);
  }
  const w0 = available(s, 'wood');
  must(s, 'chop', { id: stump });
  assert.equal(available(s, 'wood') - w0, defOf('stump').wood);
  assert.equal(s.farm.stats['coins.granted'] >= 15, true, 'debris coins are granted, never "earned"');
  assert.deepEqual(validateState(s), []);
});

test('boulders: a chop right after the OTHER player\'s chop (within 2 s) deals 15; alone 10', () => {
  const s = makeFarm();
  const b = idsOf(s, 'boulder')[0];
  must(s, 'chop', { id: b }, { pid: 'p1', now: T0 });
  must(s, 'chop', { id: b }, { pid: 'p1', now: T0 + 500 });
  assert.equal(s.farm.objects[b].hp, defOf('boulder').hp - 20);
  must(s, 'chop', { id: b }, { pid: 'p2', now: T0 + 1000 });
  assert.equal(s.farm.objects[b].hp, defOf('boulder').hp - 35);
  must(s, 'chop', { id: b }, { pid: 'p1', now: T0 + 1000 + DEBRIS_RULES.teamworkWindowMs + 1 });
  assert.equal(s.farm.objects[b].hp, defOf('boulder').hp - 45, 'too late for teamwork');
});
