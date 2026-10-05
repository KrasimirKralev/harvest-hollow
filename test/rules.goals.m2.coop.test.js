// The M2 co-op goals (GDD §6.2, §6.3, §5.9): the Friendly Duel (opt-in, scored so that helping still helps the
// partner, the crown, a tie, the quiet end, lapsed invitations, catch-up), Barge "Equal Partners", Grandma's visit
// (E10, met / missed, her gift, the dead-end guard for E10) and the M2 quest verbs (breed, fishing together).
// Exploits: accepting your own invitation, a third duel action, scoring the partner's pumpkins, a duel that ends twice.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { DUEL, GRANDMA_VISIT, CONTENT, cropOf, questOf } from '../shared/content/index.js';
import { duelCloseAt, duelOf, crownsOf, crownOf, lapseAt, duelKinds } from '../shared/rules/actions/duel.js';
import { grandmaView, grandmaHere, setFurnitureGift } from '../shared/rules/actions/grandma.js';
import { restorationExhausted, taskProgress } from '../shared/rules/actions/quests.js';
import { weekOf, dayOf } from '../shared/rules/coop.js';
import { dueSystemActions, nextSystemDueAt } from '../shared/rules/system.js';
import {
  farmAt, put, give, runDue, act, actOk, evs, valid, sys, credit, forceM2Goals, runTwin, MONDAY, HOUR, DAY, MIN,
} from './helpers/rules-goals.js';

before(forceM2Goals);

const CLOSE = MONDAY + 6 * DAY + 10 * HOUR;        // Sunday 20:00 local of MONDAY's week
const harvested = (crop, o = {}) => ({ e: 'harvested', id: 'home.0.0', crop, qty: 4, planter: 'p1',
  xp: cropOf(crop).xp, fresh: false, ribbon: false, bonus: 0, star: 0, ...o });
const order = (o = {}) => ({ e: 'orderFilled', slot: 0, n: 1, coins: 1, xp: 1, acorns: 0, golden: false, giver: null,
  simple: false, value: 1, items: {}, helped: null, ...o });
const pie = (o = {}) => ({ e: 'crafted', id: 'oven.0.0', building: 'pie_oven', recipe: 'apple_pie', item: 'apple_pie',
  qty: 1, xp: 10, double: false, first: false, maker: 'p1', ...o });

function duelFarm(kind = 'pumpkins') {
  const s = farmAt(30);
  actOk(s, 'duelInvite', { kind }, { pid: 'p1', now: MONDAY });
  actOk(s, 'duelAccept', {}, { pid: 'p2', now: MONDAY + MIN });
  return s;
}

// ---- the Friendly Duel -------------------------------------------------------------------------------------------

test('invite, accept: the duel runs to Sunday 20:00; nobody duels alone, nobody accepts their own invitation', () => {
  const solo = farmAt(30, { players: ['p1'] });
  assert.equal(act(solo, 'duelInvite', { kind: 'orders' }, { now: MONDAY }).code, 'LOCKED');
  const low = farmAt(DUEL.unlock - 1);
  assert.equal(act(low, 'duelInvite', { kind: 'orders' }, { now: MONDAY }).code, 'LOCKED');
  const s = farmAt(30);
  const r = actOk(s, 'duelInvite', { kind: 'pies' }, { pid: 'p1', now: MONDAY });
  assert.equal(evs(r, 'duelInvited')[0].end, duelCloseAt(s, weekOf(s, MONDAY)));
  assert.equal(act(s, 'duelAccept', {}, { pid: 'p1', now: MONDAY }).code, 'SELF_ONLY');
  assert.equal(act(s, 'duelInvite', { kind: 'orders' }, { pid: 'p2', now: MONDAY }).code, 'OCCUPIED');
  assert.equal(duelOf(s, 'p2', MONDAY).phase, 'invited');
  assert.equal(duelOf(s, 'p1', MONDAY).phase, 'asked');
  actOk(s, 'duelAccept', {}, { pid: 'p2', now: MONDAY + HOUR });
  assert.equal(act(s, 'duelAccept', {}, { pid: 'p2', now: MONDAY + HOUR }).code, 'ALREADY_DONE');
  assert.equal(act(s, 'duelCancel', {}, { pid: 'p1', now: MONDAY + HOUR }).code, 'ALREADY_DONE');
  const d = s.farm.duel.cur;
  assert.deepEqual(d.p, ['p1', 'p2']);
  assert.equal(d.start, MONDAY + HOUR);
  assert.equal(duelOf(s, 'p1', MONDAY + 2 * HOUR).phase, 'live');
  valid(s);
});

test('no invitation between the week\'s close and Monday; an invitation lapses after a day or at the close', () => {
  const s = farmAt(30);
  assert.equal(act(s, 'duelInvite', { kind: 'orders' }, { now: CLOSE + MIN }).code, 'NOT_READY');
  actOk(s, 'duelInvite', { kind: 'orders' }, { pid: 'p1', now: MONDAY });
  const cur = s.farm.duel.cur;
  assert.equal(lapseAt(cur), MONDAY + DUEL.inviteMs);
  assert.ok(dueSystemActions(s, MONDAY + DUEL.inviteMs).some((d) => d.type === '_duel'));
  assert.equal(nextSystemDueAt(s, MONDAY + HOUR) <= MONDAY + DUEL.inviteMs, true);
  assert.equal(act(s, 'duelAccept', {}, { pid: 'p2', now: MONDAY + DUEL.inviteMs }).code, 'NOT_FOUND');
  const ran = runDue(s, MONDAY + DUEL.inviteMs);
  assert.ok(ran.includes('_duel'));
  assert.equal(s.farm.duel.cur, null);
  assert.equal(s.farm.duel.last, null, 'a lapsed invitation is no duel');
  // a Saturday-night invitation lapses at the Sunday close
  actOk(s, 'duelInvite', { kind: 'orders' }, { pid: 'p2', now: CLOSE - 2 * HOUR });
  assert.equal(lapseAt(s.farm.duel.cur), CLOSE);
  // decline and cancel clear it
  runDue(s, CLOSE);
  actOk(s, 'duelInvite', { kind: 'orders' }, { pid: 'p2', now: CLOSE + DAY });
  assert.equal(act(s, 'duelDecline', {}, { pid: 'p2', now: CLOSE + DAY }).code, 'SELF_ONLY');
  actOk(s, 'duelDecline', {}, { pid: 'p1', now: CLOSE + DAY });
  assert.equal(s.farm.duel.cur, null);
  actOk(s, 'duelInvite', { kind: 'orders' }, { pid: 'p2', now: CLOSE + DAY });
  assert.equal(act(s, 'duelCancel', {}, { pid: 'p1', now: CLOSE + DAY }).code, 'SELF_ONLY');
  actOk(s, 'duelCancel', {}, { pid: 'p2', now: CLOSE + DAY });
  valid(s);
});

test('pumpkins count for the farmer who planted them, whoever harvests: taking the partner\'s work gains nothing', () => {
  const s = duelFarm('pumpkins');
  credit(s, [harvested('pumpkin', { planter: 'p2', qty: 6 })], { pid: 'p1', now: MONDAY + HOUR });
  credit(s, [harvested('pumpkin', { planter: 'p1', qty: 4 })], { pid: 'p1', now: MONDAY + HOUR });
  credit(s, [harvested('wheat', { planter: 'p1', qty: 9 })], { pid: 'p1', now: MONDAY + HOUR });
  assert.deepEqual(s.farm.duel.cur.s, { p1: 4, p2: 6 });
  // before the acceptance nothing counts
  const t = farmAt(30);
  actOk(t, 'duelInvite', { kind: 'pumpkins' }, { pid: 'p1', now: MONDAY });
  credit(t, [harvested('pumpkin', { planter: 'p1' })], { pid: 'p1', now: MONDAY + MIN });
  actOk(t, 'duelAccept', {}, { pid: 'p2', now: MONDAY + 2 * MIN });
  assert.deepEqual(t.farm.duel.cur.s, { p1: 0, p2: 0 });
});

test('pies count for the farmer who queued them; orders for the filler (a simple order is a quarter)', () => {
  const s = duelFarm('pies');
  credit(s, [pie({ maker: 'p2' })], { pid: 'p1', now: MONDAY + HOUR });
  credit(s, [pie({ maker: 'p1', qty: 2 })], { pid: 'p2', now: MONDAY + HOUR });
  credit(s, [pie({ building: 'bakery', recipe: 'bread', item: 'bread', maker: 'p1' })], { pid: 'p1', now: MONDAY + HOUR });
  assert.deepEqual(s.farm.duel.cur.s, { p1: 2, p2: 1 });
  const o = duelFarm('orders');
  credit(o, [order()], { pid: 'p1', now: MONDAY + HOUR });
  credit(o, [order({ simple: true })], { pid: 'p2', now: MONDAY + HOUR });
  assert.deepEqual(o.farm.duel.cur.s, { p1: 4, p2: 1 });
});

test('the end: the winner wears the crown for a week, both get Hearts, the first duel the pennant; once', () => {
  const s = duelFarm('orders');
  credit(s, [order(), order()], { pid: 'p2', now: MONDAY + HOUR });
  credit(s, [order()], { pid: 'p1', now: MONDAY + HOUR });
  const h1 = s.players.p1.hearts;
  const h2 = s.players.p2.hearts;
  const ran = runDue(s, CLOSE);
  assert.ok(ran.includes('_duel'));
  const last = s.farm.duel.last;
  assert.equal(last.win, 'p2');
  assert.equal(last.tie, false);
  assert.deepEqual(crownsOf(s, CLOSE), ['p2']);
  assert.equal(crownOf(s, CLOSE + 6 * DAY), 'p2');
  assert.equal(crownOf(s, CLOSE + DUEL.crown.ms), null, 'the crown is for a week');
  assert.equal(s.players.p1.hearts - h1, DUEL.rewards.hearts);
  assert.equal(s.players.p2.hearts - h2, DUEL.rewards.hearts);
  assert.equal(s.farm.storage[DUEL.rewards.firstDecor], 1);
  assert.equal(s.farm.duel.n, 1);
  assert.equal(sys(s, '_duel', {}, CLOSE + MIN).code, 'ALREADY_DONE');
  // the result card: markSeen kind duel
  actOk(s, 'markSeen', { kind: 'duel', id: String(last.end) }, { pid: 'p1', now: CLOSE + HOUR });
  assert.equal(act(s, 'markSeen', { kind: 'duel', id: String(last.end) }, { pid: 'p1', now: CLOSE + HOUR }).code,
    'ALREADY_DONE');
  // the second duel gives no second pennant
  actOk(s, 'duelInvite', { kind: 'orders' }, { pid: 'p1', now: CLOSE + DAY });
  actOk(s, 'duelAccept', {}, { pid: 'p2', now: CLOSE + DAY });
  credit(s, [order()], { pid: 'p1', now: CLOSE + DAY + HOUR });
  runDue(s, CLOSE + 7 * DAY);
  assert.equal(s.farm.storage[DUEL.rewards.firstDecor], 1);
  assert.deepEqual(crownsOf(s, CLOSE + 7 * DAY), ['p1']);
  valid(s);
});

test('a tie crowns both; a duel nobody scored in ends quietly (no crown, no Hearts, no pennant)', () => {
  const s = duelFarm('orders');
  credit(s, [order()], { pid: 'p1', now: MONDAY + HOUR });
  credit(s, [order()], { pid: 'p2', now: MONDAY + HOUR });
  runDue(s, CLOSE);
  assert.equal(s.farm.duel.last.tie, true);
  assert.equal(s.farm.duel.last.win, null);
  assert.deepEqual(crownsOf(s, CLOSE), ['p1', 'p2']);
  const q = duelFarm('pumpkins');
  const h = q.players.p1.hearts;
  const r = runDue(q, CLOSE);
  assert.ok(r.includes('_duel'));
  assert.equal(q.farm.duel.last.scored, false);
  assert.deepEqual(crownsOf(q, CLOSE), []);
  assert.equal(q.players.p1.hearts, h);
  assert.equal(q.farm.storage?.[DUEL.rewards.firstDecor] ?? 0, 0);
});

test('catch-up: a duel that ended during downtime ends once, at its own close, and never scores after it', () => {
  const s = duelFarm('orders');
  credit(s, [order()], { pid: 'p1', now: MONDAY + HOUR });
  // no _duel ran at the close; an order after the close does not count
  credit(s, [order(), order()], { pid: 'p2', now: CLOSE + HOUR });
  const ran = runDue(s, CLOSE + 3 * DAY);
  assert.equal(ran.filter((t) => t === '_duel').length, 1);
  assert.equal(s.farm.duel.last.win, 'p1');
  assert.equal(s.farm.duel.crown.until, CLOSE + DUEL.crown.ms, 'the crown counts from the close, not the catch-up');
});

test('the duel decides the same on a key-reversed twin', () => {
  const s = duelFarm('orders');
  credit(s, [order()], { pid: 'p1', now: MONDAY + HOUR });
  credit(s, [order({ simple: true })], { pid: 'p2', now: MONDAY + HOUR });
  runTwin(s, '_duel', {}, { pid: 'sys', cid: 'sys', now: CLOSE });
  runTwin(s, 'duelInvite', { kind: 'pies' }, { pid: 'p2', now: CLOSE + DAY });
  runTwin(s, 'duelAccept', {}, { pid: 'p1', now: CLOSE + DAY });
  assert.equal(duelKinds().length, DUEL.kinds.length);
});

// ---- Barge Equal Partners --------------------------------------------------------------------------------------

test('Equal Partners: a row loaded by both pays one more chest piece, and the week counts once for the ribbon', () => {
  const s = farmAt(16, { now: MONDAY - DAY });
  for (let i = 0; i < 4; i++) put(s, 'apple_tree');
  for (const b of ['juice_press', 'dairy', 'bakery', 'mill', 'feed_mill']) put(s, b);
  for (const it of ['apple', 'apple_juice', 'pumpkin', 'cheese', 'potato']) s.farm.made[it] = dayOf(s, MONDAY);
  runDue(s, MONDAY);
  const b = s.farm.barge;
  assert.ok(b.docked && b.rows >= 1, 'the barge docked with a row');
  for (let i = 0; i < 3; i++) give(s, b.crates[String(i)].item, b.crates[String(i)].qty);
  const a0 = s.farm.wallet.acorns;
  actOk(s, 'bargeLoad', { i: 0 }, { pid: 'p1', now: MONDAY + HOUR });
  actOk(s, 'bargeLoad', { i: 1 }, { pid: 'p1', now: MONDAY + HOUR });
  const r = actOk(s, 'bargeLoad', { i: 2 }, { pid: 'p2', now: MONDAY + HOUR });
  const row = evs(r, 'bargeRow')[0];
  assert.equal(row.equal, true);
  assert.equal(row.eqWeek, true);
  assert.deepEqual(row.loaders, ['p1', 'p2']);
  assert.equal(s.farm.stats.equalWeeks, 1);
  assert.equal(s.players.p1.stats.equalWeeks, 1);
  if (row.eqDecor === null) assert.ok(s.farm.wallet.acorns - a0 >= row.acorns, 'the extra is an Acorn without chest decor');
  // a row loaded by one farmer alone is no Equal Partners row
  if (b.rows >= 2) {
    for (let i = 3; i < 6; i++) give(s, b.crates[String(i)].item, b.crates[String(i)].qty);
    let last;
    for (let i = 3; i < 6; i++) last = actOk(s, 'bargeLoad', { i }, { pid: 'p1', now: MONDAY + 2 * HOUR });
    assert.equal(evs(last, 'bargeRow')[0].equal, undefined);
  }
  assert.equal(s.farm.stats.equalWeeks, 1, 'once a week');
  valid(s);
});

// ---- Grandma's visit and the M2 quest verbs --------------------------------------------------------------------

test('E10 completes: Grandma arrives for 72 h, strolls her stops, leaves her gift; a farmer who missed her is told', () => {
  const s = farmAt(38);
  s.farm.quests.active.e10 = { at: MONDAY, n: {} };
  const r = credit(s, [{ e: 'projectDone', project: 'farmhouse' }], { pid: 'p1', now: MONDAY });
  assert.ok(s.farm.quests.done.e10, 'the card completed');
  assert.ok(r.events.some((e) => e.e === 'grandmaArrived'));
  assert.ok(grandmaHere(s, MONDAY + HOUR));
  const g = grandmaView(s, MONDAY + GRANDMA_VISIT.strollMs * 2 + MIN, 'p1');
  assert.equal(g.stop, GRANDMA_VISIT.stops[2]);
  assert.equal(g.met, true, 'the farmer who finished the card met her');
  assert.ok(Object.values(s.farm.memory.rows).some((x) => x.k === 'grandma'));
  // she leaves after stayMs; the gift goes to the economy's interior when it takes it
  const took = [];
  setFurnitureGift((tx, ctx, def) => { took.push(def); return true; });
  try {
    const ran = runDue(s, MONDAY + GRANDMA_VISIT.stayMs);
    assert.ok(ran.includes('_grandma'));
  } finally {
    setFurnitureGift(null);
  }
  assert.deepEqual(took, [GRANDMA_VISIT.gift.furniture]);
  const v = grandmaView(s, MONDAY + GRANDMA_VISIT.stayMs, 'p2');
  assert.equal(v.here, false);
  assert.equal(v.missed, true);
  assert.equal(v.gift, null);
  assert.equal(sys(s, '_grandma', {}, MONDAY + GRANDMA_VISIT.stayMs + HOUR).code, 'ALREADY_DONE');
  // she comes once
  s.farm.quests.done = { ...s.farm.quests.done };
  valid(s);
});

test('a farmer who plays during the visit has met her; the gift goes into the farmhouse tray', () => {
  const s = farmAt(38);
  s.farm.quests.active.e10 = { at: MONDAY, n: {} };
  credit(s, [{ e: 'projectDone', project: 'farmhouse' }], { pid: 'p1', now: MONDAY });
  credit(s, [{ e: 'noted', id: 'n', x: 1, z: 1 }], { pid: 'p2', now: MONDAY + DAY });
  assert.equal(s.farm.grandma.met.p2, 1);
  const r = runDue(s, MONDAY + GRANDMA_VISIT.stayMs);
  assert.ok(r.includes('_grandma'));
  assert.equal(s.farm.grandma.gift, null, 'the room took it');
  assert.equal(s.farm.interior.tray[GRANDMA_VISIT.gift.furniture], 1);
  assert.equal(grandmaView(s, MONDAY + GRANDMA_VISIT.stayMs, 'p2').missed, false);
  valid(s);
});

test('E10 never dead-ends: when every Restoration project is already done, its "complete a project" counts at once',
  async () => {
    const { forceLiveForTests } = await import('../shared/rules/coop.js');
    const e10 = questOf('e10');
    forceLiveForTests([e10]);
    try {
      const s = farmAt(38);
      for (const p of CONTENT.restoration.values()) {
        s.farm.restore[p.id] = { s: {}, b: Object.fromEntries(p.bundles.map((b) => [b.id, MONDAY])), done: MONDAY };
      }
      assert.equal(restorationExhausted(s), true);
      // every story card before it is done: the next accepting pass opens E10
      s.farm.quests.active = {};
      for (const q of CONTENT.quests.values()) if (q.id !== 'e10' && q.level < 38) s.farm.quests.done[q.id] = MONDAY;
      const r = credit(s, [{ e: 'noted', id: 'n', x: 1, z: 1 }], { pid: 'p1', now: MONDAY });
      assert.ok(r.events.some((e) => e.e === 'questStarted' && e.id === 'e10'), 'E10 opened');
      assert.ok(s.farm.quests.done.e10, 'and completed at once: nothing could ever count for it again');
      assert.ok(s.farm.grandma, 'Grandma comes');
      valid(s);
    } finally {
      forceLiveForTests([e10], false);
    }
  });

test('breed and fishing-together deeds (the economy\'s `bred`, `fishTogether`) count for the M2 cards', () => {
  const s = farmAt(33);
  s.farm.quests.active.c8 = { at: MONDAY, n: {} };
  credit(s, [{ e: 'bred', id: 'x.0.0', species: 'cow', coat: 'brown', golden: false, home: 'h', parents: ['a', 'b'] }],
    { pid: 'p1', now: MONDAY });
  assert.ok(s.farm.quests.done.c8, 'New Coats: a calf bred');
  assert.equal(s.farm.stats.babiesBred, 1);
  s.farm.quests.active.h6 = { at: MONDAY, n: {} };
  credit(s, [{ e: 'fishCaught', pid: 'p1', spot: 'willow_pond', fish: 'roach', cm: 20, grade: 1 }],
    { pid: 'p1', now: MONDAY + MIN });
  assert.ok(!s.farm.quests.done.h6, 'fishing alone is not "together"');
  assert.equal(s.farm.stats.fishCaught, 1);
  credit(s, [{ e: 'fishTogether', spot: 'willow_pond', pids: ['p2', 'p1'], hearts: ['p1', 'p2'] }],
    { pid: 'p2', now: MONDAY + 2 * MIN });
  assert.ok(s.farm.quests.done.h6, 'Gone Fishing: two lines in the water');
});

test('"Golden Hour on the Hill" (H7) gives its Memory Book frame to the farmhouse tray', () => {
  const s = farmAt(39);
  s.farm.quests.active.h7 = { at: MONDAY, n: {} };
  credit(s, [{ e: 'together', kind: 'goldenHour', a: 'p1', b: 'p2', bench: 'none', until: MONDAY + HOUR, hearts: 1 }],
    { pid: 'sys', now: MONDAY });
  assert.ok(s.farm.quests.done.h7);
  for (const f of questOf('h7').rewards.furniture) assert.equal(s.farm.interior.tray[f], 1);
  valid(s);
});
