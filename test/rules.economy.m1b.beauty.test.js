// M1b Farm Beauty, decor sets and Masterwork (GDD §3.8, §5.9). Against the M1b content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m1b } from './helpers/rules-economy.js';

const M = await m1b();
const { content, economy, beauty } = M;
const { farmAt, placeDef, must, run, evs, T0, MIN } = M.rulesHelpers;
const { sys } = M.helpers;
const { validateState } = M.state;
const { resetGrid } = M.gridCache;
const album = await import('../shared/rules/actions/album.js');
const BIG = { confirm: ['BIG_SPEND'] };
const B = content.FARM_BEAUTY;
const LATER = T0 + 11 * MIN;                       // past every undo receipt

/** A farm at `level` with the land of every live expansion and NO objects but plots (a clean beauty slate). */
function bare(level, o = {}) {
  const s = farmAt(level, { coins: 50_000_000, acorns: 200, ...o });
  s.farm.expansions = content.live('expansions').map((e) => e.id);
  for (const id of Object.keys(s.farm.objects)) delete s.farm.objects[id];
  s.farm.storage = {};
  resetGrid(s);
  return s;
}
const put = (s, def, x, z, rot = 0) => evs(must(s, 'place', { def, x, z, rot, ...BIG }), 'placed')[0].id;
const b10 = (def) => content.defOf(def).beauty10;

test('decor beauty: the 2nd copy counts 50 %, later ones 25 %; buildings 3, trees 2 (GDD §5.9)', () => {
  const s = bare(20);
  for (let i = 0; i < 4; i++) put(s, 'flower_bed', 20 + 3 * i, 30);
  const one = b10('flower_bed') / 10;
  let b = beauty.beautyOf(s);
  assert.equal(b.parts.decor, Math.floor(one * (1 + 0.5 + 0.25 + 0.25)));
  put(s, 'bakery', 20, 20);
  put(s, 'apple_tree', 30, 20);
  b = beauty.beautyOf(s);
  assert.equal(b.parts.buildings, B.building);
  assert.equal(b.parts.trees, B.tree);
  assert.equal(b.score, b.parts.decor + b.parts.buildings + b.parts.trees);
});

test('a piece touching a path tile (edge, not corner) gets +10 %; paths themselves do not', () => {
  const s = bare(20);
  const bed = put(s, 'fountain', 20, 20);                       // 2 x 2
  const base = beauty.beautyOf(s).byId[bed];
  put(s, 'dirt_path', 21, 22);                                  // under the fountain's south edge
  const p = beauty.beautyOf(s);
  assert.equal(p.byId[bed], Math.floor(base * 1.1));
  const s2 = bare(20);
  const f2 = put(s2, 'fountain', 20, 20);
  put(s2, 'dirt_path', 22, 22);                                 // a corner only: no bonus
  assert.equal(beauty.beautyOf(s2).byId[f2], base);
  const path = Object.keys(s.farm.objects).find((id) => s.farm.objects[id].def === 'dirt_path');
  assert.equal(p.byId[path], b10('dirt_path'), 'a path does not get the path bonus');
});

test('Masterwork: 4 x then 16 x the price for x1.5 / x2 beauty; resale includes it; no store, coin decor only', () => {
  const s = bare(20);
  const id = put(s, 'fountain', 20, 20);
  const cost = content.defOf('fountain').cost;
  assert.equal(beauty.masterworkPrice(s, s.farm.objects[id]).coins, 4 * cost);
  const before = beauty.beautyOf(s).byId[id];
  const coins = s.farm.wallet.coins;
  const r = must(s, 'masterwork', { id, ...BIG }, { now: T0 + MIN });
  assert.deepEqual(evs(r, 'masterworked')[0],
    { e: 'masterworked', id, def: 'fountain', level: 1, by: 'p1', coins: 4 * cost });
  assert.equal(coins - s.farm.wallet.coins, 4 * cost);
  assert.equal(s.farm.objects[id].rcpt, undefined, 'no 100 % undo of the base price after an upgrade');
  assert.equal(beauty.beautyOf(s).byId[id], Math.floor(before * 1.5));
  must(s, 'masterwork', { id, ...BIG }, { now: T0 + 2 * MIN });
  assert.equal(s.farm.objects[id].mw, 2);
  assert.equal(beauty.beautyOf(s).byId[id], before * 2);
  assert.equal(run(s, 'masterwork', { id, ...BIG }).code, 'CAP');
  assert.equal(run(s, 'store', { id }).code, 'LOCKED', 'a Masterwork piece is moved, never stored');
  assert.deepEqual(s.farm.objects[id].paid, { coins: cost * (1 + 4 + 16), acorns: 0 });
  const sold = must(s, 'sellObject', { id }, { now: LATER });
  assert.equal(evs(sold, 'removed')[0].coins, Math.floor((cost * 21) / 2), 'half of everything paid');
  // Acorn decor, grand decor and rewards are not Masterwork pieces; nothing before L18
  const s2 = bare(20);
  const arbor = put(s2, 'heart_arbor', 20, 20);
  assert.equal(run(s2, 'masterwork', { id: arbor }).code, 'LOCKED');
  const s3 = bare(17);
  const bed = put(s3, 'flower_bed', 20, 20);
  assert.equal(run(s3, 'masterwork', { id: bed }).code, 'LOCKED');
  // the price the player saw (RC-18)
  const s4 = bare(20);
  const f4 = put(s4, 'fountain', 20, 20);
  assert.equal(run(s4, 'masterwork', { id: f4, max: 10, ...BIG }).code, 'PRICE');
});

test('a decor set completes when one of each piece stands within 6 tiles of every other: +25 % to its pieces', () => {
  const s = bare(20);
  const set = content.CONTENT.decorSets.get('cottage_garden');
  const AT = [20, 21, 22, 24, 25];                              // the rose arch is 2 wide: a 6-tile span
  const ids = set.pieces.map((p, i) => put(s, p, AT[i], 20));
  const b = beauty.beautyOf(s);
  assert.deepEqual(b.groups, [{ set: 'cottage_garden', ids: [...ids].sort() }]);
  const s2 = bare(20);
  const far = set.pieces.map((p, i) => put(s2, p, 10 + 4 * i, 20));       // the ends are 16 tiles apart
  assert.deepEqual(beauty.beautyOf(s2).groups, []);
  for (const id of ids) {
    const lone = beauty.beautyOf(s2).byId[far[ids.indexOf(id)]];
    assert.equal(b.byId[id] >= Math.floor(lone * 1.25) - 1, true, `${s.farm.objects[id].def} +25 %`);
  }
  // two complete groups both count; before L18 no set
  for (const [i, p] of set.pieces.entries()) put(s, p, 20 + AT[i], 40);
  assert.equal(beauty.beautyOf(s).groups.length, 2);
  s.farm.xp = content.xpForLevel(17);
  assert.equal(beauty.beautyOf(s).groups.length, 0);
});

test('stars pay 3 Acorns each, once, for settled decor only; a buy-and-undo loop pays nothing', () => {
  const s = bare(20);
  const acorns = s.farm.wallet.acorns;
  // 50 beauty = the first star: three fountains (40, 20, 10) and a little more
  const f = [put(s, 'fountain', 20, 20), put(s, 'fountain', 24, 20), put(s, 'fountain', 28, 20)];
  put(s, 'rose_arch', 32, 20);
  assert.ok(beauty.beautyOf(s).score >= B.stars[0]);
  assert.equal(beauty.beautyDue(s, T0 + MIN).stars, 0, 'nothing is settled inside the undo window');
  assert.equal(sys(s, '_beauty', {}, T0 + MIN).code, 'NOT_READY');
  // undo one inside the window: nothing was paid
  must(s, 'refund', { id: f[2] }, { now: T0 + 2 * MIN });
  assert.equal(s.farm.wallet.acorns, acorns);
  must(s, 'place', { def: 'fountain', x: 28, z: 20, rot: 0, ...BIG }, { now: T0 + 3 * MIN });
  const due = M.expansions.econDue(s, LATER + 3 * MIN).map((a) => a.type);
  assert.ok(due.includes('_beauty'));
  const r = sys(s, '_beauty', {}, LATER + 3 * MIN);
  assert.equal(r.ok, true);
  const ev = evs(r, 'beautyStar')[0];
  assert.equal(ev.from, 0);
  assert.equal(ev.acorns, B.starAcorns * ev.stars);
  assert.equal(s.farm.wallet.acorns, acorns + ev.acorns);
  assert.equal(s.farm.beauty.stars, ev.stars);
  // selling decor and placing it again never pays a star twice
  must(s, 'sellObject', { id: f[0] }, { now: LATER + 4 * MIN });
  must(s, 'place', { def: 'fountain', x: 20, z: 20, rot: 0, ...BIG }, { now: LATER + 5 * MIN });
  assert.equal(sys(s, '_beauty', {}, LATER + 30 * MIN).code, 'NOT_READY');
  assert.equal(s.farm.wallet.acorns, acorns + ev.acorns);
  assert.ok(M.expansions.econNextDueAt(s, LATER + 5 * MIN) <= LATER + 15 * MIN, 'the scheduler wakes for receipts');
  assert.deepEqual(validateState(s), []);
});

test('order coins: +1 % per current settled star, at most +5 %; 0 before L18', () => {
  const s = bare(20);
  assert.equal(beauty.beautyOrderBp(s, T0), 0);
  for (let i = 0; i < 6; i++) put(s, 'fountain', 20 + 3 * i, 30);
  put(s, 'rose_arch', 20, 34);
  const stars = beauty.beautyOf(s).stars;
  assert.ok(stars >= 1);
  assert.equal(beauty.beautyOrderBp(s, T0 + MIN), 0, 'not settled yet');
  assert.equal(beauty.beautyOrderBp(s, LATER), Math.min(5, stars) * B.orderCoinsBpPerStar);
  s.farm.xp = content.xpForLevel(17);
  assert.equal(beauty.beautyOrderBp(s, LATER), 0);
});

test('a first decor-set completion is recorded once (the ribbon), whatever happens to the pieces later', () => {
  const s = bare(20);
  const set = content.CONTENT.decorSets.get('cottage_garden');
  const ids = set.pieces.map((p, i) => put(s, p, [20, 21, 22, 24, 25][i], 20));
  const r = sys(s, '_beauty', {}, LATER);
  assert.deepEqual(evs(r, 'decorSet').map((e) => e.set), ['cottage_garden']);
  assert.equal(s.farm.beauty.sets.cottage_garden, LATER);
  must(s, 'store', { id: ids[0] }, { now: LATER + MIN });
  must(s, 'place', { def: set.pieces[0], x: 20, z: 20, rot: 0 }, { now: LATER + 2 * MIN });
  assert.equal(beauty.beautyDue(s, LATER + 3 * MIN).sets.length, 0);
});

test('collection perks add beauty (Garden Butterflies +20)', () => {
  const s = bare(20);
  const before = beauty.beautyOf(s).score;
  economy.setPerkSource((st, key) => (key === 'beauty10' ? 200 : 0));
  try {
    assert.equal(beauty.beautyOf(s).score, before + 20);
  } finally {
    economy.setPerkSource(album.perkOf);
  }
});
