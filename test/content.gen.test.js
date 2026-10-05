// The generated tables are current and equal the designer's model (GDD §4.9 R1: "values recomputed from the formulas
// equal the content tables; the simulator's port equals the model").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { CONTENT, MODEL } from '../shared/content/index.js';
import { ROOT } from './helpers/content.js';

const node = (...args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });

test('tools/gen-content.mjs --check: every generated table is up to date', () => {
  const r = node(path.join('tools', 'gen-content.mjs'), '--check');
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('the economy model passes its own checks (R1-R18 at the source)', () => {
  const r = node(path.join('tools', 'economy-model.mjs'));
  assert.equal(r.status, 0, r.stdout.slice(-2000));
  assert.match(r.stdout, /all checks passed/);
});

test('the content equals the model JSON, number for number', () => {
  const r = node(path.join('tools', 'economy-model.mjs'), '--json');
  const M = JSON.parse(r.stdout);
  for (const c of M.crops) {
    const d = CONTENT.crops.get(c.id);
    assert.deepEqual([d.unlock, d.growMs, d.yield, d.sell, d.seed, d.xp], [c.unlock, c.min * 60_000, c.yield, c.v,
      c.seed, c.xp], c.id);
  }
  for (const t of M.trees) assert.deepEqual([CONTENT.trees.get(t.id).cost, CONTENT.items.get(t.product).sell],
    [t.price, t.v], t.id);
  for (const a of M.animals) {
    const d = CONTENT.animals.get(a.id);
    assert.deepEqual([d.cycleMs, d.babyMs, d.prizedAt, CONTENT.items.get(a.product).sell], [a.cycle * 60_000,
      a.babyMin * 60_000, a.prizedAt, a.v], a.id);
  }
  for (const r2 of M.recipes) {
    const d = CONTENT.recipes.get(r2.id);
    assert.deepEqual([d.building, d.unlock, d.ms, d.out, d.inputs, d.sell], [r2.building, r2.unlock, r2.min * 60_000,
      r2.out, r2.inputs, r2.v], r2.id);
    assert.equal(d.duet ? d.duetXp : d.xp, r2.xp, `${r2.id}.xp`);
  }
  for (const b of M.buildings) assert.deepEqual([CONTENT.buildings.get(b.id).cost,
    CONTENT.buildings.get(b.id).slots], [b.cost, [b.slotsStart, b.slotsMax]], b.id);
  for (const h of M.homes) assert.deepEqual([CONTENT.homes.get(h.id).cost, CONTENT.homes.get(h.id).unlock], [h.cost,
    h.unlock], h.id);
  for (const l of M.levels) {
    const row = CONTENT.levels[l.L - 1];
    assert.deepEqual([row.xp, row.E, row.minutes], [l.cumAt, l.E, l.minutes], `L${l.L}`);
    if (l.L > 1) assert.deepEqual([row.coins, row.acorns], [l.coins, l.acorns], `L${l.L} rewards`);
  }
  for (const e of M.expansions) assert.deepEqual([CONTENT.expansions.get(e.id).cost,
    CONTENT.expansions.get(e.id).unlock], [e.coins, e.level], e.id);
  for (const b of M.barnUpgrades) assert.deepEqual([CONTENT.barn[b.n - 1].cost, CONTENT.barn[b.n - 1].capacity],
    [b.coins, b.cap]);
  for (const q of M.quests) assert.deepEqual([CONTENT.quests.get(q.id).coins, CONTENT.quests.get(q.id).xp], [q.coins,
    q.xp], q.id);
  for (const g of M.grandDecor) assert.equal(CONTENT.decor.get(g.id).cost, g.coins, g.id);
  assert.deepEqual(MODEL.C, M.C);
});
