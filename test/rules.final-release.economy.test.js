// Final release pass (2026-10-04), the economy side: regression tests for the mechanics audit (M-1, L-2) and the
// playtest's PT-02. Each failed on dfdaee4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m2 } from './helpers/rules-economy-m2.js';

const M = await m2();
const { content } = M;
const { farmAt, give, placeDef, must, run, evs, T0 } = M.rulesHelpers;
const { resetGrid } = M.gridCache;
const BIG = { confirm: ['BIG_SPEND'] };

function barnFarm() {
  const s = farmAt(30, { coins: 50_000_000, acorns: 200 });
  s.farm.expansions = content.live('expansions').map((e) => e.id);
  resetGrid(s);
  const home = placeDef(s, 'cow_barn', BIG);
  s.farm.objects[home].up = 3;
  return s;
}
const buyCow = (s, adult = false, now = T0) => evs(must(s, 'buyAnimal', { def: 'cow', ...(adult ? { adult } : {}), ...BIG },
  { now }), 'bought')[0].id;

/** Cross L31 with a 1-XP harvest at `now`. */
function levelUp(s, now) {
  s.farm.xp = content.xpForLevel(31) - 1;
  const plot = Object.keys(s.farm.objects).find((id) => s.farm.objects[id].def === 'plot');
  s.farm.objects[plot].crop = { def: 'cabbage', plantedAt: T0, readyAt: T0 + 2000, by: 'p1', cycle: 0, cut: 0 };
  const r = must(s, 'harvest', { id: plot }, { now });
  assert.ok(evs(r, 'levelUp').some((e) => e.scope === 'farm' && e.level === 31), 'the harvest crossed L31');
  return r;
}

test('M-1: Breeding Barn parents are no longer a 100 % undo once a breeding starts', () => {
  const s = barnFarm();
  const a = buyCow(s, true);
  const b = buyCow(s, true);
  give(s, 'baby_bottle', 2);
  must(s, 'breed', { a, b }, { now: T0 + 60_000 });
  assert.equal(run(s, 'refund', { id: a }, { now: T0 + 120_000 }).code, 'NOT_REFUNDABLE');
  assert.equal(run(s, 'refund', { id: b }, { now: T0 + 120_000 }).code, 'NOT_REFUNDABLE');
});

test('M-1 sibling: a Fishing Dock decor that was fished from is no longer a 100 % undo', () => {
  const s = barnFarm();
  const dock = placeDef(s, 'pond_dock', BIG);
  const c = evs(must(s, 'cast', { id: dock }, { now: T0 + 1000 }), 'fishCast')[0];
  must(s, 'reel', {}, { now: c.bite, grace: 0 });
  assert.equal(run(s, 'refund', { id: dock }, { now: c.bite + 1000 }).code, 'NOT_REFUNDABLE');
});

test('L-2: a level-up finishes the Breeding Barn\'s baby on its way like every other baby', () => {
  const s = barnFarm();
  const a = buyCow(s, true);
  const b = buyCow(s, true);
  const calf = buyCow(s);
  give(s, 'baby_bottle', 2);
  must(s, 'breed', { a, b }, { now: T0 + 1000 });
  const now = T0 + 3_600_000;
  const r = levelUp(s, now);
  assert.equal(s.farm.objects[calf].adultAt, now, 'the bought calf is grown up by the Bloom');
  assert.equal(s.farm.breed.cur.readyAt, now, 'the bred calf is ready too');
  assert.equal(evs(r, 'bloomed')[0].breed, true);
  must(s, 'breedCollect', {}, { now: now + 1000 });
});

test('PT-02: the Bloom does not close the Nursery for a baby that had no care step yet (until it would have grown)', () => {
  const s = barnFarm();
  const calf = buyCow(s);
  const grownAt = s.farm.objects[calf].adultAt;
  give(s, 'baby_bottle', 3);
  const now = T0 + 60_000;
  levelUp(s, now);
  assert.equal(s.farm.objects[calf].adultAt, now, 'grown up by the Bloom');
  assert.equal(s.farm.objects[calf].cardBy, grownAt, 'its card window stays open until it would have grown up');
  must(s, 'nurse', { id: calf }, { now: now + 1000 });
  assert.equal(s.farm.objects[calf].cardBy, undefined, 'a started card goes on; the window field is done');
  // a second Bloom-grown calf that never starts its card: the window closes when its baby time would have ended
  const calf2 = buyCow(s, false, now + 2000);
  s.farm.objects[calf2].adultAt = now + 3000;           // nearly grown already
  assert.equal(run(s, 'nurse', { id: calf2 }, { now: now + 4000 }).code, 'ALREADY_DONE', 'an ordinary grown animal');
});
