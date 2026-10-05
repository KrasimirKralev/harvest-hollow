// The Goal Tracker for the M2 goals (GDD §5.1: perks to spend, Season Track tiers, a duel invitation and its score,
// Grandma on the farm, the league place, Legacy levels on the level card) and a fuzz of every M2 goals action and
// system action by two players across weeks and a season change: decisions on a key-reversed twin, every event
// classified, the state valid, nothing negative.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { CELEBRATIONS, FX_EVENTS } from '../shared/rules/index.js';
import { CONTENT, xpForLevel, GRANDMA_VISIT } from '../shared/content/index.js';
import { goals } from '../shared/rules/goals.js';
import { validateState } from '../shared/rules/state.js';
import { nextSeasonAt } from '../shared/rules/coop.js';
import {
  farmAt, put, give, runDue, runTwin, actOk, credit, forceM2Goals, mulberry32, MONDAY, HOUR, DAY, MIN,
} from './helpers/rules-goals.js';

before(forceM2Goals);

const order = (xp) => ({ e: 'orderFilled', slot: 0, n: 1, coins: 1, xp, acorns: 0, golden: false, giver: null,
  simple: false, value: 1, items: {}, helped: null });
const all = (g) => [g.now, g.soon, g.big];
const ranked = (s, pid, now) => goals(s, pid, now, { all: true }).all;

test('tracker: perk points to spend are a NOW card; spending them retires it', () => {
  const s = farmAt(20);
  s.players.p1.xp = CONTENT.levels[5].personalXp;            // personal L6: 3 points
  assert.ok(ranked(s, 'p1', MONDAY).some((c) => c.kind === 'perk'));
  for (let i = 0; i < 2; i++) actOk(s, 'perkPick', { tree: 'grower' }, { now: MONDAY });
  actOk(s, 'perkPick', { tree: 'rancher' }, { now: MONDAY });
  assert.ok(!ranked(s, 'p1', MONDAY).some((c) => c.kind === 'perk'), '0 free points: no card');
  assert.ok(!ranked(s, 'p2', MONDAY).some((c) => c.kind === 'perk'), 'the partner has no points');
});

test('tracker: a reached Season Track tier is a NOW claim card; the next tier is a BIG card', () => {
  const s = farmAt(24);
  runDue(s, MONDAY);
  credit(s, [order(s.farm.track.need + 3)], { pid: 'p1', now: MONDAY });
  const c = ranked(s, 'p2', MONDAY).find((x) => x.kind === 'track');
  assert.equal(c.ref, '1');
  actOk(s, 'trackClaim', { tier: 1 }, { pid: 'p2', now: MONDAY });
  assert.ok(!ranked(s, 'p2', MONDAY).some((x) => x.kind === 'track' && x.slot === 'now'), 'claimed: no NOW card');
  const big = ranked(s, 'p1', MONDAY).find((x) => x.kind === 'track');
  assert.equal(big.slot, 'big');
  assert.match(big.text, /^Season Track tier 2: [\d,]+ XP to /);
  assert.ok(all(goals(s, 'p1', MONDAY)).every((c) => c === null || typeof c.text === 'string'));
});

test('tracker: the invited farmer sees the duel as a NOW card; both see the live score', () => {
  const s = farmAt(30);
  actOk(s, 'duelInvite', { kind: 'orders' }, { pid: 'p1', now: MONDAY });
  const inv = ranked(s, 'p2', MONDAY).find((x) => x.kind === 'duel');
  assert.ok(inv, 'Mia sees the challenge');
  assert.ok(!ranked(s, 'p1', MONDAY).some((x) => x.kind === 'duel'), 'the inviter waits');
  actOk(s, 'duelAccept', {}, { pid: 'p2', now: MONDAY + MIN });
  credit(s, [order(1)], { pid: 'p1', now: MONDAY + HOUR });
  const live = ranked(s, 'p1', MONDAY + HOUR).find((x) => x.kind === 'duel');
  assert.equal(live.slot, 'soon');
  assert.equal(live.text, 'Order Rush: you 1, Mia 0');
  assert.equal(ranked(s, 'p2', MONDAY + HOUR).find((x) => x.kind === 'duel').text, 'Order Rush: you 0, Rowan 1');
});

test('tracker: Grandma on the farm is a NOW card while she stays', () => {
  const s = farmAt(38);
  s.farm.quests.active.e10 = { at: MONDAY, n: {} };
  credit(s, [{ e: 'projectDone', project: 'farmhouse' }], { pid: 'p1', now: MONDAY });
  assert.ok(ranked(s, 'p2', MONDAY + HOUR).some((x) => x.kind === 'grandma'));
  runDue(s, MONDAY + GRANDMA_VISIT.stayMs);
  assert.ok(!ranked(s, 'p2', MONDAY + GRANDMA_VISIT.stayMs).some((x) => x.kind === 'grandma'));
});

test('tracker: the league place is a BIG card in a league week', () => {
  const s = farmAt(28);
  runDue(s, MONDAY);
  const c = ranked(s, 'p1', MONDAY + HOUR).find((x) => x.kind === 'league');
  assert.equal(c.slot, 'big');
  assert.match(c.text, /points to a promotion place$/);
});

test('the level card past L40 names the Legacy level\'s reward (no empty levels)', () => {
  const s = farmAt(41);
  s.farm.xp = xpForLevel(41) + 10;
  const level = ranked(s, 'p1', MONDAY).find((x) => x.kind === 'level' && x.slot === 'big');
  assert.match(level.text, /^Legacy level 42: /);
  assert.ok(!/undefined|NaN/.test(level.text));
});

// ---- the M2 fuzz ----------------------------------------------------------------------------------------------

const ACTIONS = ['perkPick', 'perkRespec', 'trackClaim', 'coatWear', 'duelInvite', 'duelAccept', 'duelDecline',
  'duelCancel', 'fairEnter', 'markSeen'];

function randomAction(rnd, s, cow) {
  const pick = (l) => l[Math.floor(rnd() * l.length)];
  const type = pick(ACTIONS);
  switch (type) {
    case 'perkPick': return [type, { tree: pick(['grower', 'rancher', 'orchardist', 'artisan']) }];
    case 'trackClaim': return [type, { tier: 1 + Math.floor(rnd() * 31) }];
    case 'coatWear': return [type, { id: cow, coat: pick(['russet', 'frost', 'blossom', 'sunkissed']) }];
    case 'duelInvite': return [type, { kind: pick(['pumpkins', 'pies', 'orders']) }];
    case 'fairEnter': return [type, { item: pick(['bread', 'sweetheart_cake', 'golden_egg', 'show_ribbon']),
      qty: 1 + Math.floor(rnd() * 3) }];
    case 'markSeen': return [type, { kind: 'duel', id: String(s.farm.duel?.last?.end ?? 0) }];
    default: return [type, {}];
  }
}

test('M2 fuzz: every M2 goals action decides the same on a key-reversed twin; the state stays valid', () => {
  const ALL = new Set([...FX_EVENTS, ...CELEBRATIONS]);
  for (let seed = 1; seed <= 12; seed++) {
    const rnd = mulberry32(seed);
    const s = farmAt(27 + Math.floor(rnd() * 16), { seed, now: MONDAY - DAY });
    s.players.p1.xp = CONTENT.levels[10 + Math.floor(rnd() * 20)].personalXp;
    s.players.p2.xp = CONTENT.levels[5 + Math.floor(rnd() * 25)].personalXp;
    const pen = put(s, 'cow_barn');
    const cow = put(s, 'cow', { home: pen });
    if (rnd() < 0.5) {
      const p = CONTENT.restoration.get('fair_grounds');
      s.farm.restore.fair_grounds = { s: {}, b: Object.fromEntries(p.bundles.map((b) => [b.id, MONDAY])), done: MONDAY };
    }
    let now = MONDAY;
    let seq = 0;
    runDue(s, now);
    const end = nextSeasonAt(s, MONDAY) + 10 * DAY;
    const step = Math.floor((end - MONDAY) / 160);
    for (let i = 0; i < 160; i++) {
      now += Math.floor(rnd() * 2 * step);
      runDue(s, now);
      if (rnd() < 0.3) give(s, ['bread', 'sweetheart_cake', 'golden_egg', 'show_ribbon'][Math.floor(rnd() * 4)], 3);
      if (rnd() < 0.3) {
        const pid = rnd() < 0.5 ? 'p1' : 'p2';
        credit(s, [rnd() < 0.5 ? order(1 + Math.floor(rnd() * 20_000)) : { e: 'harvested', id: 'home.0.0',
          crop: 'pumpkin', qty: 5, planter: rnd() < 0.5 ? 'p1' : 'p2', xp: 50, fresh: false, ribbon: false, bonus: 0,
          star: 0 }], { pid, now });
      }
      const [type, args] = randomAction(rnd, s, cow);
      const pid = rnd() < 0.5 ? 'p1' : 'p2';
      const r = runTwin(s, type, args, { now, pid, cid: `fz${pid}x`, seq: ++seq });
      if (r.ok) for (const ev of r.tx.events) assert.ok(ALL.has(ev.e), `event ${ev.e} is neither FX nor a celebration`);
    }
    runDue(s, end + DAY);
    assert.deepEqual(validateState(s), [], `seed ${seed}`);
    for (const pid of ['p1', 'p2']) {
      assert.ok(s.players[pid].hearts >= 0);
      assert.ok(s.players[pid].rested.xp >= 0);
    }
    assert.ok(s.farm.wallet.acorns >= 0 && s.farm.wallet.coins >= 0);
    assert.ok(s.farm.league.tier >= 1 && s.farm.league.tier <= 5);
  }
});

test('scheduler fuzz with the M2 system actions: due passes and clears; nextSystemDueAt agrees at its boundary', async () => {
  const { dueSystemActions, nextSystemDueAt } = await import('../shared/rules/system.js');
  for (let seed = 1; seed <= 16; seed++) {
    const rnd = mulberry32(seed);
    const s = farmAt(24 + Math.floor(rnd() * 20), { seed, now: MONDAY - DAY });
    let now = MONDAY + Math.floor(rnd() * 5 * DAY);
    for (let step = 0; step < 50; step++) {
      runDue(s, now);
      const next = nextSystemDueAt(s, now);
      assert.ok(Number.isFinite(next) && next > now, `seed ${seed}: next ${next} <= now ${now}`);
      assert.deepEqual(dueSystemActions(s, next - 1), [], `seed ${seed}: due before next`);
      assert.ok(dueSystemActions(s, next).length > 0, `seed ${seed}: nothing due at next`);
      const r = rnd();
      if (r < 0.15 && !s.farm.duel.cur) {
        const kind = ['orders', 'pumpkins', 'pies'][Math.floor(rnd() * 3)];
        const inv = runTwin(s, 'duelInvite', { kind }, { pid: 'p1', now });
        if (inv.ok && rnd() < 0.6) runTwin(s, 'duelAccept', {}, { pid: 'p2', now: now + MIN });
      } else if (r < 0.2 && !s.farm.grandma) {
        s.farm.quests.active.e10 = { at: now, n: {} };
        credit(s, [{ e: 'projectDone', project: 'farmhouse' }], { pid: 'p1', now });
      } else if (r < 0.5) {
        credit(s, [order(1 + Math.floor(rnd() * 40_000))], { pid: rnd() < 0.5 ? 'p1' : 'p2', now });
      }
      now = rnd() < 0.5 ? next : now + Math.floor(rnd() * 2 * DAY);
    }
    assert.deepEqual(validateState(s), [], `seed ${seed}`);
  }
});
