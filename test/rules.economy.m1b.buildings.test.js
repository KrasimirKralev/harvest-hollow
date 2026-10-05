// M1b buildings (GDD §3.5): the Sewing Table, Pie Oven, Chandlery and Packing Table with every recipe to L25, the
// Harvest Feast and Wedding Cake duets (and their solo slow-cook), second Windmill / Dairy copies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m1b } from './helpers/rules-economy.js';

const M = await m1b();
const { content } = M;
const { farmAt, give, placeDef, must, run, evs, T0, HOUR, MIN } = M.rulesHelpers;
const { validateState } = M.state;
const { resetGrid } = M.gridCache;
const BIG = { confirm: ['BIG_SPEND'] };

function farm(level) {
  const s = farmAt(level, { coins: 50_000_000, acorns: 200 });
  s.farm.expansions = content.live('expansions').map((e) => e.id);
  resetGrid(s);
  return s;
}

test('every live recipe of the four new buildings queues, cooks for its time and lands in the Barn at L25', () => {
  const s = farm(25);
  let now = T0;
  for (const b of ['sewing', 'pie_oven', 'chandlery', 'packing']) {
    const def = content.lookup('buildings', b);
    assert.ok(def, `${b} is live`);
    const id = placeDef(s, b, BIG);
    for (const r of content.recipesOf(b)) {
      if (r.unlock > 25) continue;
      for (const [item, n] of Object.entries(r.inputs)) give(s, item, n);
      const q = must(s, 'craft', { id, recipe: r.id }, { now });
      const end = evs(q, 'queued')[0].endsAt;
      assert.ok(end - now >= r.ms / 2 && end - now <= r.ms, `${r.id} time`);
      now = end;
      const c = must(s, 'collectTray', { id }, { now });
      const ev = evs(c, 'crafted')[0];
      assert.equal(ev.item, r.id);
      assert.equal(ev.qty % r.out, 0);
    }
  }
  assert.deepEqual(validateState(s), []);
});

test('the Harvest Feast and the Wedding Cake are duets: together in normal time with +25 % XP, alone in 2 x', () => {
  for (const [recipe, level] of [['harvest_feast', 15], ['wedding_cake', 25]]) {
    const s = farm(level);
    const kitchen = placeDef(s, 'kitchen', BIG);
    const r = content.CONTENT.recipes.get(recipe);
    assert.equal(r.duet, true, `${recipe} is a duet`);
    for (const [item, n] of Object.entries(r.inputs)) give(s, item, 2 * n);
    must(s, 'duet', { id: kitchen, recipe }, { now: T0, pid: 'p1' });
    const q = must(s, 'duet', { id: kitchen, recipe }, { now: T0 + 2000, pid: 'p2' });
    assert.equal(evs(q, 'queued')[0].duet, true);
    assert.equal(evs(q, 'queued')[0].endsAt - (T0 + 2000), r.ms);
    const c = must(s, 'collectTray', { id: kitchen }, { now: T0 + 2000 + r.ms });
    assert.equal(evs(c, 'crafted')[0].xp, r.xp + Math.floor(r.xp / 4));
    assert.equal(evs(c, 'duet').length, 1, 'the duet credit is paid at collect');
    // alone: slow-cooks in twice the time, normal XP, no duet credit
    const now = T0 + 3 * r.ms;
    const solo = must(s, 'craft', { id: kitchen, recipe }, { now });
    assert.equal(evs(solo, 'queued')[0].slow, true);
    assert.equal(evs(solo, 'queued')[0].endsAt - now, 2 * r.ms);
    const c2 = must(s, 'collectTray', { id: kitchen }, { now: now + 2 * r.ms });
    assert.equal(evs(c2, 'crafted')[0].xp, r.xp);
    assert.equal(evs(c2, 'duet').length, 0);
  }
});

test('a second Windmill from L16 and a second Dairy from L18 at their second-copy price; never a third', () => {
  const s = farm(17);
  placeDef(s, 'mill', BIG);
  const mill = content.defOf('mill');
  assert.deepEqual(M.decor.buyPrice(s, 'mill'), { coins: mill.secondCopy.cost, acorns: 0, code: null });
  placeDef(s, 'mill', BIG);
  assert.equal(M.decor.buyPrice(s, 'mill').code, 'CAP');
  placeDef(s, 'dairy', BIG);
  assert.equal(M.decor.buyPrice(s, 'dairy').code, 'CAP', 'the second Dairy waits for L18');
  s.farm.xp = content.xpForLevel(18);
  assert.equal(M.decor.buyPrice(s, 'dairy').coins, content.defOf('dairy').secondCopy.cost);
  assert.equal(M.decor.buyPrice(s, 'pie_oven').code, null);
  placeDef(s, 'pie_oven', BIG);
  assert.equal(M.decor.buyPrice(s, 'pie_oven').code, 'CAP', 'the second Pie Oven is M2 (L33)');
});

test('Sewing recipes take 3 % less time with the Buttons & Thimbles set (collection perk)', () => {
  const s = farm(16);
  const id = placeDef(s, 'sewing', BIG);
  M.economy.setPerkSource((st, key) => (key === 'sewingTimeBp' ? 300 : 0));
  const album = import('../shared/rules/actions/album.js');
  try {
    give(s, 'yarn', 2);
    must(s, 'craft', { id, recipe: 'scarf' });
    const ms = content.CONTENT.recipes.get('scarf').ms;
    assert.equal(s.farm.objects[id].queue[0].e - T0, ms - (ms * 3) / 100);
  } finally {
    album.then((m) => M.economy.setPerkSource(m.perkOf));
  }
  return album;
});

test('nothing of M1b is reachable below its level: the Packing Table at L19 is LOCKED', () => {
  const s = farm(19);
  assert.equal(M.decor.buyPrice(s, 'packing').code, 'LOCKED');
  assert.equal(run(s, 'place', { def: 'packing', x: 20, z: 30, rot: 0, ...BIG }).code, 'LOCKED');
  const k = placeDef(s, 'kitchen', BIG);
  give(s, 'flour', 9);
  assert.equal(run(s, 'craft', { id: k, recipe: 'wedding_cake' }, { now: T0 + MIN }).code, 'LOCKED');
  assert.ok(HOUR > 0);
});

test('the Compost Bin sells its queue slots only once its Manure recipe is unlocked (L25): no slot for nothing', () => {
  // its first recipe: Manure (L25) until wave 4's Fertilizer (L10)
  const first = Math.min(...content.recipesOf('compost_bin').map((r) => r.unlock));
  const s = farm(Math.max(content.CONTENT.buildings.get('compost_bin').unlock, first - 1));
  const bin = placeDef(s, 'compost_bin', BIG);
  assert.equal(run(s, 'upgradeSlot', { id: bin, ...BIG }).code, 'LOCKED');
  s.farm.xp = content.xpForLevel(first);
  must(s, 'upgradeSlot', { id: bin, ...BIG });
});
