// Final release pass (2026-10-04), the goals side: regression tests for the mechanics audit (M-2, M-3, L-1). Each
// failed on dfdaee4.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { BREEDING, SEASONAL_TRACK, DAILY_GIFT, FEED } from '../shared/content/index.js';
import { nextSeasonAt } from '../shared/rules/coop.js';
import { feedRows, recap } from '../shared/rules/feed.js';
import { farmAt, put, act, must, runDue, credit, forceM2Goals, T0, HOUR, MIN } from './helpers/rules-goals.js';

before(forceM2Goals);

test('M-3: a season coat on a golden bred cow keeps the golden coat underneath, and it can go back on', () => {
  const s = farmAt(30);
  const pen = put(s, 'cow_barn');
  const cow = put(s, 'cow', { home: pen, coat: 'golden', free: true });
  const [a, b] = BREEDING.seasonCoats.map((c) => c.id);
  s.farm.track.coats = [a, b];
  assert.ok(act(s, 'coatWear', { id: cow, coat: a }, { now: T0 }).ok);
  assert.deepEqual([s.farm.objects[cow].coat, s.farm.objects[cow].bcoat], [a, 'golden']);
  assert.ok(act(s, 'coatWear', { id: cow, coat: b }, { now: T0 }).ok, 'season coat to season coat');
  assert.deepEqual([s.farm.objects[cow].coat, s.farm.objects[cow].bcoat, s.farm.track.coats], [b, 'golden', [a]]);
  assert.ok(act(s, 'coatWear', { id: cow, coat: 'golden' }, { now: T0 }).ok, 'its own coat back on');
  assert.deepEqual([s.farm.objects[cow].coat, s.farm.objects[cow].bcoat, s.farm.track.coats], ['golden', undefined, [a, b].sort()]);
  assert.equal(act(s, 'coatWear', { id: cow, coat: 'brown' }, { now: T0 }).code, 'NO_ITEMS', 'not a coat it owns');
});

test('M-3: a season coat comes back to the chest when its animal is sold, and goes again on a restore', () => {
  const s = farmAt(30);
  s.farm.wallet.coins = 1_000_000;
  const pen = put(s, 'cow_barn');
  const cow = put(s, 'cow', { home: pen, paid: { coins: 2000, acorns: 0 } });
  const season = BREEDING.seasonCoats[2].id;
  s.farm.track.coats = [season];
  assert.ok(act(s, 'coatWear', { id: cow, coat: season }, { now: T0 }).ok);
  assert.ok(act(s, 'sellObject', { id: cow }, { now: T0 + 1000 }).ok);
  assert.deepEqual(s.farm.track.coats, [season], 'the coat stays on the farm');
  assert.ok(act(s, 'restore', { id: cow }, { now: T0 + 2000 }).ok);
  assert.deepEqual([s.farm.objects[cow].coat, s.farm.track.coats], [season, []], 'the restored cow wears it again');
});

test('M-3: a bee colony wears no coat', () => {
  const s = farmAt(30);
  const hive = put(s, 'beehive');
  const bees = Object.keys(s.farm.objects).find((id) => s.farm.objects[id].home === hive)
    ?? put(s, 'bee', { home: hive });
  s.farm.track.coats = [BREEDING.seasonCoats[0].id];
  assert.equal(act(s, 'coatWear', { id: bees, coat: BREEDING.seasonCoats[0].id }, { now: T0 }).code, 'BAD_ARGS');
});

const order = (xp) => ({ e: 'orderFilled', slot: 0, n: 1, coins: 1, xp, acorns: 0, golden: false, giver: null,
  simple: false, value: 1, items: {}, helped: null });

test('L-1: an autumn track closed with its season-decor tier unclaimed pays the AUTUMN planter', () => {
  const s = farmAt(26);
  runDue(s, T0);
  assert.ok(s.farm.track.s.endsWith('autumn'), `T0 is autumn (${s.farm.track.s})`);
  const tier = SEASONAL_TRACK.rewards.findIndex((r) => r.decor === 'season') + 1;
  assert.ok(tier > 0);
  credit(s, [order(s.farm.track.need * tier)], { pid: 'p1', now: T0 });
  const was = { ...s.farm.storage };
  runDue(s, nextSeasonAt(s, T0) + HOUR);
  const got = Object.keys(s.farm.storage).filter((k) => (s.farm.storage[k] ?? 0) > (was[k] ?? 0));
  assert.ok(got.includes(DAILY_GIFT.seasonDecor.autumn), JSON.stringify(got));
  assert.ok(!got.includes(DAILY_GIFT.seasonDecor.winter), 'not the next season\'s planter');
});

test('M-2: a "Finish all growing" batch is one feed row and keeps the partner\'s lines in the recap', () => {
  const s = farmAt(30);
  s.farm.wallet.acorns = 2000;
  for (let i = 0; i < 4; i++) {
    s.farm.feed.rows[String(s.farm.feed.n % FEED.historyMax)] = { at: T0 + i, by: 'p2', k: 'order', c: 100, x: 10, g: 0 };
    s.farm.feed.n += 1;
  }
  s.players.p1.lastSeenAt = T0 - HOUR;
  const partner = (now) => recap(s, 'p1', now).sections.find((x) => x.name === 'partnerDid')?.items.length ?? 0;
  assert.equal(partner(T0 + MIN), 4);
  const ids = [];
  for (let i = 0; i < 60; i++) {
    ids.push(put(s, 'plot', { crop: { def: 'pumpkin', plantedAt: T0, readyAt: T0 + 10 * HOUR, by: 'p1', cycle: 0, cut: 0 } }));
  }
  let spent = 0;
  for (const id of ids) {
    const r = must(s, 'hurry', { id, confirm: ['BIG_SPEND'] }, { now: T0 + MIN });
    spent += r.tx.events.find((e) => e.e === 'hurried').acorns;
  }
  const rows = feedRows(s).filter(([, r]) => r.what === 'hurry');
  assert.equal(rows.length, 1, 'one coalesced row');
  assert.deepEqual([rows[0][1].q, rows[0][1].a], [60, spent]);
  assert.equal(partner(T0 + 2 * MIN), 4, 'the partner\'s lines survive the batch');
});
