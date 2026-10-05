// Rules contracts hardened after the M0 review (docs/design/review-m0-determinism-economy.md):
// animals in homes (#9), read-only content (#13), retired defs (#14), the confirm envelope (#11),
// regen clamp (#12), a strict validateState (#16), granted vs earned coins (#19), integer prices (#8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT, PLACEABLES, validateContent, placeableProblems, xpForLevel, questOf } from '../shared/content/index.js';
import { freeHomeTiles, xpWithPlotRoom } from './helpers/content.js';
import { getGrid, canPlace, capacityOf, occupantsOf } from '../shared/rules/grid.js';
import { resetGrid } from '../shared/rules/grid-cache.js';
import { validateState } from '../shared/rules/state.js';
import { ACTIONS } from '../shared/rules/index.js';
import { parseArgs, assertSchema, confirmed, V } from '../shared/rules/schema.js';
import { regenValue, regenSpend } from '../shared/rules/time.js';
import { grow } from '../shared/rules/economy.js';
import { ERR } from '../shared/net/protocol.js';
import { makeFarm, run, must, T0 } from './helpers.js';

/** Fixture defs go in through Map.prototype on purpose (content Maps refuse a plain .set) and come out again. */
function withDefs(defs, fn) {
  for (const d of defs) Map.prototype.set.call(PLACEABLES, d.id, d);
  try { return fn(); } finally { for (const d of defs) Map.prototype.delete.call(PLACEABLES, d.id); }
}
const COOP = { id: 'zcoop', kind: 'home', layer: 'object', size: [3, 3], unlock: 1, capacity: 2 };
const HEN = { id: 'zhen', kind: 'animal', layer: 'none', homes: ['zcoop'], unlock: 1 };
const HEN_FIELDS = { adultAt: T0, fedAt: null, readyAt: null, cycle: 0, cut: 0 };   // the economy's animal record

test('content Maps are read-only to every importer (review-m0 #13)', () => {
  const wheat = CONTENT.crops.get('wheat');
  assert.throws(() => CONTENT.crops.set('wheat', { ...wheat, sell: 999 }), /read-only/);
  assert.throws(() => PLACEABLES.delete('plot'), /read-only/);
  assert.throws(() => CONTENT.items.clear(), /read-only/);
  assert.equal(CONTENT.crops.get('wheat').sell, wheat.sell);
  assert.throws(() => { 'use strict'; wheat.sell = 1; });
});

test('animals live in their home: no footprint, home checked, capacity enforced (review-m0 #9)', () => {
  withDefs([COOP, HEN], () => {
    const s = makeFarm();
    s.farm.expansions.push('creekside');                 // empty land for the fixture coop (41..43, 25..27)
    s.farm.objects['zz.1.0'] = { def: 'zcoop', x: 41, z: 25, rot: 0, placedAt: T0, by: 'p1' };
    s.farm.objects['zz.2.0'] = { def: 'zhen', home: 'zz.1.0', placedAt: T0, by: 'p1', ...HEN_FIELDS };
    resetGrid(s);
    assert.doesNotThrow(() => getGrid(s));
    assert.deepEqual(validateState(s), []);
    assert.equal(canPlace(s, 'zhen', 42, 26, 0), ERR.BAD_ARGS, 'animals are never placed on the grid');
    assert.equal(canPlace(s, 'plot', 42, 26, 0), ERR.BLOCKED, 'the coop still blocks');
    assert.equal(capacityOf(s, 'zz.1.0'), 2);
    s.farm.objects['zz.3.0'] = { def: 'zhen', home: 'zz.1.0', placedAt: T0, by: 'p2', ...HEN_FIELDS };
    assert.deepEqual(occupantsOf(s, 'zz.1.0'), ['zz.2.0', 'zz.3.0']);
    s.farm.objects['zz.4.0'] = { def: 'zhen', home: 'zz.1.0', placedAt: T0, by: 'p2', ...HEN_FIELDS };
    assert.ok(validateState(s).some((p) => /over capacity/.test(p)));
    delete s.farm.objects['zz.4.0'];
    s.farm.objects['zz.3.0'].home = 'home.0.0';
    assert.ok(validateState(s).some((p) => /cannot house/.test(p)));
    s.farm.objects['zz.3.0'].home = 'gone';
    assert.ok(validateState(s).some((p) => /no such object/.test(p)));
  });
  assert.deepEqual(placeableProblems('animals', HEN), []);
  assert.ok(placeableProblems('plots', { ...HEN, kind: 'plot' }).some((p) => /only for kind 'animal'/.test(p)));
  assert.ok(placeableProblems('animals', { ...HEN, size: [1, 1] }).some((p) => /no size/.test(p)));
  assert.ok(placeableProblems('animals', { ...HEN, homes: [] }).some((p) => /homes/.test(p)));
  assert.deepEqual(validateContent(), []);
});

test('a retired placeable cannot be bought (review-m0 #14)', () => {
  withDefs([{ ...PLACEABLES.get('plot'), id: 'old_plot', retired: true }], () => {
    const s = makeFarm();
    assert.equal(run(s, 'place', { def: 'old_plot', x: 24, z: 33, rot: 0 }).code, ERR.LOCKED);
  });
});

test('confirm is an envelope argument every action accepts (review-m0 #11)', () => {
  const s = makeFarm();
  s.farm.xp = xpWithPlotRoom();                          // the 16 starter plots fill the L1 cap (GDD §3.10)
  const [[x1, z1], [x2, z2]] = freeHomeTiles();
  assert.equal(run(s, 'place', { def: 'plot', x: x1, z: z1, rot: 0, confirm: ['BIG_SPEND'] }).ok, true);
  const sample = { place: { def: 'plot', x: x2, z: z2, rot: 0 }, plant: { id: 'home.0.1', crop: 'wheat' },
    harvest: { id: 'home.0.1' }, sell: { item: 'wheat', qty: 1 } };
  for (const [type, def] of Object.entries(ACTIONS)) {
    if (!sample[type]) continue;
    const plainArgs = parseArgs(def.schema, sample[type]);
    assert.ok(plainArgs, type);
    assert.deepEqual(parseArgs(def.schema, { ...sample[type], confirm: ['RESERVED'] }), { ...plainArgs, confirm: ['RESERVED'] }, type);
  }
  assert.deepEqual(parseArgs({ id: V.objId }, { id: 'a.1.0', confirm: ['PINNED'] }), { id: 'a.1.0', confirm: ['PINNED'] });
  assert.equal(parseArgs({ id: V.objId }, { id: 'a.1.0', confirm: ['NOPE'] }), null);
  assert.equal(parseArgs({ id: V.objId }, { id: 'a.1.0', confirm: [] }), null);
  assert.equal(parseArgs({ id: V.objId }, { id: 'a.1.0', extra: 1 }), null, 'other extra keys still reject');
  assert.ok(confirmed({ confirm: ['BIG_SPEND'] }, 'BIG_SPEND'));
  assert.ok(!confirmed({}, 'BIG_SPEND'));
});

test('assertSchema refuses int specs without both bounds', () => {
  assert.throws(() => assertSchema({ n: V.int(5) }), /int bounds/);
  assert.throws(() => assertSchema({ n: V.int(5, 1) }), /int bounds/);
  assert.doesNotThrow(() => assertSchema({ n: V.int(0, 9), t: V.text(16) }));
});

test('regen never counts negative time (a client clock a few ms behind; review-m0 #12)', () => {
  assert.equal(regenValue({ amount: 5, at: 1_000_000 }, 20, 60_000, 999_997), 5);
  const after = regenSpend({ amount: 1, at: 1_000_000 }, 20, 60_000, 999_999, 1);
  assert.deepEqual(after, { amount: 0, at: 1_000_000 });
  assert.equal(regenValue({ amount: 5, at: 0 }, 20, 60_000, 120_000), 7);
});

test('validateState reports unknown fields and malformed sub-records (review-m0 #16)', () => {
  const s = makeFarm();
  assert.deepEqual(validateState(s), []);
  s.farm.junk = { anything: true };
  s.farm.expansions.push('home');
  s.farm.ledger.rows['0'] = { at: 'yesterday', n: 1.5 };
  s.players.p1.color = 42;
  s.players.p1.lastSeenAt = -5;
  s.farm.objects['home.0.0'].by = { evil: 1 };
  s.meta.contentHash = 7;
  s.players.p2.extra = 1;
  s.junk = 1;
  const problems = validateState(s);
  for (const re of [/farm: unknown field junk/, /expansions: duplicate/, /ledger.rows.0/, /p1.color/, /p1: timestamps/,
    /home.0.0.by/, /contentHash/, /p2: unknown field extra/, /state: unknown field junk/]) {
    assert.ok(problems.some((p) => re.test(p)), `${re} in ${JSON.stringify(problems)}`);
  }
  const t = makeFarm();
  must(t, 'plant', { id: 'home.0.0', crop: 'wheat' });
  t.farm.objects['home.0.0'].crop.cycle = 5;
  assert.ok(validateState(t).some((p) => /crop.cycle/.test(p)));
});

test('level-up rewards are granted, not earned (GDD §5.4; review-m0 #19); the ledger balances', () => {
  const s = makeFarm();
  s.farm.xp = xpForLevel(2) - 8 * CONTENT.crops.get('wheat').xp;   // the eighth harvest reaches level 2
  for (let i = 0; i < 8; i++) must(s, 'plant', { id: `home.0.${i}`, crop: 'wheat' }, { now: T0 });
  for (let i = 0; i < 8; i++) must(s, 'harvest', { id: `home.0.${i}` }, { now: T0 + 60_000 });
  const st = s.farm.stats;
  // quests EARN their coins (GDD §5.4), so `earned` may move; the level-up's ledger rows are granted
  const levelCoins = Object.values(s.farm.ledger.rows).filter((r) => r.reason === 'level').reduce((n, r) => n + r.n, 0);
  assert.ok(levelCoins > 0 && st['coins.granted'] >= levelCoins, 'the level-up reward is granted');
  const questCoins = Object.keys(s.farm.quests.done).reduce((n, id) => n + (questOf(id).coins ?? 0), 0);
  assert.equal(st['coins.earned'] ?? 0, questCoins, 'no sale yet: only story cards earned coins');
  assert.ok(st['coins.granted'] > 0, 'the level-up reward is counted');
  assert.equal(s.farm.wallet.coins, 300 + (st['coins.earned'] ?? 0) + st['coins.granted'] + (st['coins.refunded'] ?? 0) - st['coins.spent']);
});

test('n-th copy prices are integer ladders (review-m0 #8)', () => {
  assert.equal(grow(6800, 3500, 1), 6800);
  assert.equal(grow(6800, 3500, 3), 12393);       // the float formula's ceil gave 12394 on V8 alone
  assert.equal(grow(1900, 1000, 3), 2299);
  let p = 2300;
  for (let n = 2; n <= 40; n++) { const g = grow(2300, 1000, n); assert.ok(Number.isSafeInteger(g) && g >= p); p = g; }
});
