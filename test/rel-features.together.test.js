// Release 1.0, D2 "Together at any hour" (features#F2; M22; critique#12; plan-astra 1.8; GDD §6.5 "quests never need
// both"): EVERY quest of chain H completes on a two-farmer farm whose sessions never overlap (one farmer in the morning,
// the other in the afternoon of the same farm day), while Golden Hour, its buff, the together Hearts and the ribbons stay
// with doing it at the same moment. RED on fdafb9c: h1 / h7 counted only a Golden Hour with both seated, h2 / h5 only
// a duet cooked within 3 s, h3 only a help flag the OTHER filled, h6 only casts within 20 s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT, cropOf, live } from '../shared/content/index.js';
import { resetGrid } from '../shared/rules/grid.js';
import { farmAt, put, give, act, actOk, evs, valid, sys, credit, T0, MIN, HOUR } from './helpers/rules-goals.js';

/** 10:00 and 15:00 farm-local (Europe/Sofia, UTC+3) on 14 October 2026: one farm day, two sessions that never meet. */
const MORNING = Date.UTC(2026, 9, 14, 7);
const AFTERNOON = Date.UTC(2026, 9, 14, 12);
const H = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'];

/** A farm at quest `qid`'s level with the chain done up to it and `qid` the active card. */
function atQuest(qid, { level } = {}) {
  const q = CONTENT.quests.get(qid);
  const s = farmAt(level ?? Math.max(q.level, qid === 'h6' ? 30 : 1));
  s.farm.wallet.coins = 50_000_000;
  s.farm.expansions = live('expansions').map((e) => e.id);
  resetGrid(s);
  for (const id of H.slice(0, H.indexOf(qid))) s.farm.quests.done[id] = T0;
  for (const id of Object.keys(s.farm.quests.active)) if (id.startsWith('h')) delete s.farm.quests.active[id];
  s.farm.quests.active[qid] = { at: T0, n: {} };
  return s;
}
const done = (s, qid) => Object.hasOwn(s.farm.quests.done, qid);
/** The together bonuses an action paid (the quest's own reward Hearts are its reward, unchanged: not counted here). */
const together = (rs) => rs.flatMap((r) => (r.ok ? r.tx.events : []))
  .filter((e) => e.e === 'duet' || e.e === 'fishTogether' || (e.e === 'together' && e.kind === 'goldenHour')
    || (e.e === 'hearts' && ['goldenHour', 'duet', 'highFive'].includes(e.why)));

/** Each farmer sits on the bench in their own session (with the server's "at the bench" fact), then leaves. */
function benchApart(s, bench) {
  return [actOk(s, 'sit', { id: bench }, { pid: 'p1', now: MORNING, ext: { near: 5 } }),
    actOk(s, 'stand', {}, { pid: 'p1', now: MORNING + 2 * MIN }),
    actOk(s, 'sit', { id: bench }, { pid: 'p2', now: AFTERNOON, ext: { near: 5 } })];
}

for (const qid of ['h1', 'h7']) {
  test(`M22 ${qid}: each farmer sits on a two-seat bench on the same farm day; no Golden Hour, no buff, no Hearts`, () => {
    const s = atQuest(qid);
    const bench = put(s, 'sunset_bench');
    const rs = benchApart(s, bench);
    assert.ok(done(s, qid), `${qid} done`);
    assert.equal(s.farm.coop.golden, null, 'no Golden Hour: it needs both at once');
    assert.equal(s.farm.stats.goldenHours ?? 0, 0);
    assert.deepEqual(together(rs), [], 'the together Hearts and the buff stay simultaneous-only');
    valid(s);
  });
}

test('M22: two sits on DIFFERENT farm days do not count; one farmer sitting twice does not count', () => {
  const s = atQuest('h1');
  const bench = put(s, 'sunset_bench');
  actOk(s, 'sit', { id: bench }, { pid: 'p1', now: MORNING, ext: { near: 5 } });
  actOk(s, 'stand', {}, { pid: 'p1', now: MORNING + MIN });
  actOk(s, 'sit', { id: bench }, { pid: 'p1', now: AFTERNOON, ext: { near: 5 } });
  assert.ok(!done(s, 'h1'), 'the same farmer twice');
  actOk(s, 'stand', {}, { pid: 'p1', now: AFTERNOON + MIN });
  actOk(s, 'sit', { id: bench }, { pid: 'p2', now: AFTERNOON + 24 * HOUR, ext: { near: 5 } });
  assert.ok(!done(s, 'h1'), 'the next farm day: p1 has not sat today');
});

for (const qid of ['h2', 'h5']) {
  test(`M22 ${qid}: a duet slow-cooked alone counts when collected; no Hearts, no duet stat (those stay for cooking together)`, () => {
    const s = atQuest(qid);
    const recipe = qid === 'h2' ? CONTENT.recipes.get('sweetheart_cake') : CONTENT.recipes.get('wedding_cake');
    const b = put(s, recipe.building);
    for (const [item, n] of Object.entries(recipe.inputs)) give(s, item, n);
    const r1 = actOk(s, 'craft', { id: b, recipe: recipe.id }, { pid: 'p1', now: MORNING });
    assert.ok(!done(s, qid), 'not before it is collected');
    const r2 = actOk(s, 'collectTray', { id: b }, { pid: 'p2', now: MORNING + 2 * recipe.ms + MIN });
    assert.ok(done(s, qid), `${qid} done`);
    assert.equal(s.farm.stats.duets ?? 0, 0, 'the Duet ribbon counts only duets cooked together');
    assert.deepEqual(together([r1, r2]), [], 'no duet Hearts alone');
    valid(s);
  });
}

test('M22 h3: three surprises opened, each by the other farmer in their own session, complete "Helping Hands"', () => {
  const s = atQuest('h3');
  give(s, 'rose', 5);
  const day = 24 * HOUR;
  const turns = [['p1', 'p2', 0], ['p2', 'p1', day], ['p1', 'p2', 2 * day]];
  for (const [giver, opener, d] of turns) {
    const r = actOk(s, 'keepsake', { item: 'rose' }, { pid: giver, now: MORNING + d });
    actOk(s, 'openGift', { id: evs(r, 'keepsake')[0].id }, { pid: opener, now: AFTERNOON + d });
  }
  assert.ok(done(s, 'h3'), 'h3 done');
  valid(s);
});

test('M22 h3: a help flag filled by the other farmer still counts (either way round), with its Hearts as before', () => {
  const s = atQuest('h3');
  // the reducer's path for an order the OTHER farmer filled (orderFilled with helped = the flag's owner)
  const fill = (by, owner, now) => credit(s, [{ e: 'orderFilled', slot: 1, n: 1, coins: 10, xp: 1, acorns: 0, golden: false,
    giver: null, simple: true, value: 10, items: { wheat: 1 }, helped: owner }], { pid: by, now });
  fill('p1', 'p2', MORNING);
  fill('p2', 'p1', AFTERNOON);
  assert.equal(s.farm.quests.active.h3.n['0'], 2, 'your fill of theirs and their fill of yours');
  fill('p1', 'p1', AFTERNOON + MIN);
  assert.equal(s.farm.quests.active.h3.n['0'], 2, 'filling your own flag is no help');
});

test('M22 h4: a Giant chopped by one farmer in the morning and finished by the other in the afternoon counts', () => {
  const s = atQuest('h4');
  // a ripe Giant straight in the state (rules-economy's own tests grow one; the felling path is the economy's chop)
  const crop = cropOf('pumpkin');
  const ids = [];
  for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) ids.push(put(s, 'plot', { x: 30 + dx, z: 30 + dz }));
  const anchor = ids[0];
  for (const id of ids) {
    s.farm.objects[id].crop = { def: crop.id, plantedAt: MORNING - crop.growMs - HOUR, readyAt: MORNING - HOUR, by: 'p1', cycle: 0,
      giant: anchor, ...(id === anchor ? { hp: CONTENT.coop?.giant?.hp ?? 60 } : {}) };
  }
  let fell = null;
  for (let i = 0; i < 12 && !fell; i++) {
    const pid = i < 3 ? 'p1' : 'p2';
    const now = (i < 3 ? MORNING : AFTERNOON) + i * 5000;
    const r = act(s, 'chop', { id: ids[4] }, { pid, now });
    assert.ok(r.ok, `chop ${i}: ${r.code}`);
    fell = evs(r, 'giantFelled')[0] ?? null;
  }
  assert.ok(fell, 'felled');
  assert.deepEqual(fell.pair, ['p1', 'p2']);
  assert.ok(done(s, 'h4'), 'h4 done');
});

test('M22 h6: each farmer casts a line on the same farm day (20 s apart is not needed); no fishing-together Heart', () => {
  const s = atQuest('h6');
  const dock = put(s, 'pond_dock');
  const r1 = actOk(s, 'cast', { id: dock }, { pid: 'p1', now: MORNING, ext: { near: 5 } });
  assert.ok(!done(s, 'h6'));
  const r2 = actOk(s, 'cast', { id: dock }, { pid: 'p2', now: AFTERNOON, ext: { near: 5 } });
  assert.ok(done(s, 'h6'), 'h6 done');
  assert.deepEqual(together([r1, r2]), [], 'the fishing-together Heart stays for casting together');
  valid(s);
});

test('M22: the simultaneous version still pays what it always paid (Golden Hour: Hearts and the buff)', () => {
  const s = atQuest('h1');
  const bench = put(s, 'sunset_bench');
  actOk(s, 'sit', { id: bench }, { pid: 'p1', now: MORNING, ext: { near: 5 } });
  actOk(s, 'sit', { id: bench }, { pid: 'p2', now: MORNING + 1000, ext: { near: 5 } });
  assert.ok(done(s, 'h1'), 'sitting together still completes it (the async rule counts the same day too)');
  // Golden Hour itself starts 10 s later through the scheduler, with its Hearts and the 30-minute buff, as before
  const r = sys(s, '_golden', {}, MORNING + 11_000);
  assert.ok(r.ok, r.code);
  assert.ok(s.farm.coop.golden && s.farm.coop.golden.until > MORNING, 'the buff runs');
  assert.ok(evs(r, 'together').some((e) => e.kind === 'goldenHour'));
});
