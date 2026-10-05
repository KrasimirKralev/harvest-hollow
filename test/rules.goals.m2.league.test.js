// The County Fair's NPC league, Platinum and the horse show (GDD §5.6, M2): NPC scores, promotion and demotion at the
// Sunday ceremony, league Acorns, the top league behind the Town Fair Grounds, an empty week that holds, the catch-up
// after downtime (one ceremony, one league step), Platinum's prizes and its 24 h Golden Hour, the extra entry per item,
// the League Climber ribbon and the "League Night" card. Exploits: a week rolled twice, a farm that sits a week out.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { FAIR, CONTENT, xpForLevel, questOf } from '../shared/content/index.js';
import {
  npcScore10, npcFinals, rankOf, leagueOutcome, leagueTable, topTier, LEAGUE, leagueUnlocked,
} from '../shared/rules/actions/league.js';
import {
  fairCloseAt, fairOpenAt, liveMedals, medalFor, entryLimit, entryPoints10, fairStanding, fairTarget,
} from '../shared/rules/actions/fair.js';
import { goldenHourBp, weekOf } from '../shared/rules/coop.js';
import { stateCount } from '../shared/rules/actions/quests.js';
import { ribbonValue } from '../shared/rules/actions/ribbons.js';
import { hash32 } from '../shared/rules/rng.js';
import {
  farmAt, give, runDue, act, actOk, evs, valid, sys, credit, forceM2Goals, runTwin, MONDAY, HOUR, DAY, MIN,
} from './helpers/rules-goals.js';

before(forceM2Goals);

const SUNDAY_CLOSE = MONDAY + 6 * DAY + 10 * HOUR;        // MONDAY is Monday 10:00 local: Sunday 20:00

/** A farm at `level` with this week's Fair open (a league week from L27). */
function leagueFarm(level = 27) {
  const s = farmAt(level);
  runDue(s, MONDAY);
  assert.ok(s.farm.fair.cur?.open, 'the Fair opened');
  return s;
}

/** Restoration project `id` complete (fixture). */
function restored(s, id) {
  const p = CONTENT.restoration.get(id);
  s.farm.restore[id] = { s: {}, b: Object.fromEntries(p.bundles.map((b) => [b.id, MONDAY])), done: MONDAY };
}

/** The farm's points this week (x10), set straight into the Fair (a fixture). */
const setPoints = (s, p10) => { s.farm.fair.cur.p = p10; };

test('NPC weekly scores: W x (0.6 + step x (league - 1) + 0.7 x hash01(seed, week, npc)), keyed on replicated facts', () => {
  const s = leagueFarm();
  const { w, W } = s.farm.fair.cur;
  for (let i = 0; i < 5; i++) {
    const h = hash32(s.meta.farmSeed, 'league', w, i);
    const bp = LEAGUE.npcMinBp + Math.floor((LEAGUE.npcSpreadBp * h) / 4_294_967_296);
    assert.equal(npcScore10(s, w, i, W, 1), Math.floor((W * 10 * bp) / 10_000));
    assert.ok(npcScore10(s, w, i, W, 1) >= W * 6 && npcScore10(s, w, i, W, 1) < W * 13);
    // a higher league's farms are stronger by npcStepBp a league (content; 0 = every league holds the same farms)
    assert.equal(npcScore10(s, w, i, W, 3) - npcScore10(s, w, i, W, 1),
      Math.floor((W * 10 * 2 * (LEAGUE.npcStepBp ?? 0)) / 10_000));
  }
  assert.notDeepEqual(npcFinals(s, w, W, 1), npcFinals(s, w + 1, W, 1), 'another week, other scores');
  assert.equal(rankOf(100, [100, 90, 80, 70, 60]), 1, 'a tie goes to the couple');
  assert.equal(rankOf(50, [100, 90, 80, 70, 60]), 6);
});

test('the league starts at L27: a league week from Monday, or at once on the level-up mid-week', () => {
  const s = farmAt(26);
  runDue(s, MONDAY);
  assert.equal(s.farm.fair.cur.lg, undefined, 'L26: no league week');
  assert.ok(!leagueUnlocked(s));
  s.farm.xp = xpForLevel(27) - 1;
  credit(s, [{ e: 'orderFilled', slot: 0, n: 1, coins: 1, xp: 1, acorns: 0, golden: false, giver: null, simple: false,
    value: 1, items: {}, helped: null }], { now: MONDAY + HOUR });
  assert.equal(s.farm.fair.cur.lg, 1, 'the level-up into the league made this week a league week');
  const t = leagueFarm(30);
  assert.equal(t.farm.fair.cur.lg, 1);
  valid(s);
  valid(t);
});

test('the ceremony: top 2 promote, the last demotes, tier x 1 Acorn; the result rides on the ceremony card', () => {
  const s = leagueFarm(28);
  s.farm.league.tier = 2;
  s.farm.league.best = 2;
  s.farm.fair.cur.lg = 2;
  const { w, W } = s.farm.fair.cur;
  const npc = npcFinals(s, w, W, 2);
  setPoints(s, Math.max(...npc) + 1);                       // first place
  const acorns = s.farm.wallet.acorns;
  const ran = runDue(s, SUNDAY_CLOSE);
  assert.ok(ran.includes('_fair'));
  const last = s.farm.fair.last;
  assert.equal(last.lg.rank, 1);
  assert.equal(last.lg.move, 1);
  assert.equal(s.farm.league.tier, 3);
  assert.equal(s.farm.league.best, 3);
  assert.equal(last.lg.acorns, 2, 'the week was played in league 2: 2 Acorns');
  assert.ok(s.farm.wallet.acorns - acorns >= 2);
  assert.equal(s.farm.stats.bestLeague, 3);
  // a last place in the next league week demotes
  runDue(s, SUNDAY_CLOSE + 4 * HOUR + DAY);                 // Monday: the next week opens in league 3
  assert.equal(s.farm.fair.cur.lg, 3);
  setPoints(s, 1);
  runDue(s, SUNDAY_CLOSE + 7 * DAY);
  assert.equal(s.farm.fair.last.lg.rank, 6);
  assert.equal(s.farm.league.tier, 2);
  assert.equal(s.farm.league.best, 3, 'the best league stays');
  assert.equal(s.farm.league.hist.length, 2);
  valid(s);
});

test('an empty week holds the league and pays nothing (nothing decays while the couple is away)', () => {
  const s = leagueFarm(28);
  s.farm.league.tier = 3;
  s.farm.league.best = 3;
  s.farm.fair.cur.lg = 3;
  const acorns = s.farm.wallet.acorns;
  runDue(s, SUNDAY_CLOSE);
  assert.equal(s.farm.fair.last.lg.move, 0);
  assert.equal(s.farm.fair.last.lg.acorns, 0);
  assert.equal(s.farm.fair.last.acorns, 0, 'no medal, no league Acorns');
  assert.equal(s.farm.league.tier, 3);
  assert.ok(s.farm.wallet.acorns <= acorns + 1, 'at most League Climber\'s Bronze (the fixture\'s best league 3)');
});

test('league 4 stays league 4 until the Town Fair Grounds is restored; then the top league opens', () => {
  const s = leagueFarm(30);
  s.farm.league.tier = 4;
  s.farm.league.best = 4;
  s.farm.fair.cur.lg = 4;
  assert.equal(topTier(s), 4);
  setPoints(s, 999_999);
  runDue(s, SUNDAY_CLOSE);
  assert.equal(s.farm.fair.last.lg.rank, 1);
  assert.equal(s.farm.fair.last.lg.move, 0, 'no top league without the project');
  assert.equal(s.farm.league.tier, 4);
  restored(s, 'fair_grounds');
  assert.equal(topTier(s), 5);
  runDue(s, SUNDAY_CLOSE + DAY);
  setPoints(s, 999_999);
  runDue(s, SUNDAY_CLOSE + 7 * DAY);
  assert.equal(s.farm.league.tier, 5);
  // League Climber reads the best league; its Gold tier is the top league
  const r = CONTENT.ribbons.get('league_climber');
  assert.equal(ribbonValue(s, r), 5);
  assert.equal(s.farm.ribbons.league_climber?.t, 3);
  valid(s);
});

test('catch-up: three weeks of downtime close the open week once and move the league one step', () => {
  const s = leagueFarm(28);
  const npc = npcFinals(s, s.farm.fair.cur.w, s.farm.fair.cur.W, 1);
  setPoints(s, Math.max(...npc) + 5);
  const back = SUNDAY_CLOSE + 21 * DAY - 2 * HOUR;           // the server was off for three weeks (back Sunday 18:00)
  const ran = runDue(s, back);
  assert.equal(ran.filter((t) => t === '_fair').length, 1, 'one _fair catches everything up');
  assert.equal(s.farm.league.hist.length, 1, 'only the week that was played is ranked');
  assert.equal(s.farm.league.tier, 2);
  assert.equal(s.farm.fair.cur.w, weekOf(s, back), 'this week is open');
  assert.equal(s.farm.fair.cur.lg, 2);
  assert.equal(sys(s, '_fair', {}, back + HOUR).code, 'ALREADY_DONE');
  valid(s);
});

test('exploit: a closed week is never ranked twice (a replayed close, a forged earlier week)', () => {
  const s = leagueFarm(28);
  setPoints(s, 999_999);
  runDue(s, SUNDAY_CLOSE);
  assert.equal(s.farm.league.tier, 2);
  // a forged reopen of the same week (as if the ceremony ran again): the league ignores it
  s.farm.fair.cur.open = true;
  sys(s, '_fair', {}, SUNDAY_CLOSE + MIN);
  assert.equal(s.farm.league.tier, 2);
  assert.equal(s.farm.league.hist.length, 1);
});

test('the league table: NPC scores grow with the week, the couple ranked among them, zones', () => {
  const s = leagueFarm(28);
  s.farm.league.tier = 2;
  s.farm.fair.cur.lg = 2;
  const { w, W } = s.farm.fair.cur;
  const open = fairOpenAt(s, w);
  const close = fairCloseAt(s, w);
  const half = open + Math.floor((close - open) / 2);
  const t = leagueTable(s, half, open, close);
  assert.equal(t.rows.length, 6);
  assert.equal(t.rows.filter((r) => r.farm).length, 1);
  for (const r of t.rows.filter((x) => !x.farm)) {
    const fin = npcScore10(s, w, LEAGUE.farms.indexOf(r.name), W, 2);
    assert.ok(r.p10 <= fin && r.p10 >= Math.floor(fin / 2) - 1, 'an NPC is half way at mid-week');
  }
  assert.deepEqual(t.rows.slice(0, 2).map((r) => r.zone), ['up', 'up']);
  assert.equal(t.rows.at(-1).zone, 'down');
  assert.deepEqual(fairStanding(s, half).league.rows, t.rows);
  // league 1 has no drop zone
  s.farm.fair.cur.lg = 1;
  assert.equal(leagueTable(s, half, open, close).rows.at(-1).zone, null);
});

test('the league decides the same on a key-reversed twin', () => {
  const s = leagueFarm(28);
  s.farm.fair.cur.by = { p2: 300, p1: 200 };
  setPoints(s, 500);
  runTwin(s, '_fair', {}, { pid: 'sys', cid: 'sys', now: SUNDAY_CLOSE });
});

test('Platinum: only with the Town Fair Grounds; 6 Acorns, the champion banner, a 24 h Golden Hour from Monday', () => {
  const s = leagueFarm(30);
  const W = s.farm.fair.cur.W;
  assert.ok(!liveMedals(s).some((m) => m.id === 'platinum'));
  assert.equal(medalFor(W * 15, W, s)?.id, 'gold3', 'without the project 1.5 W is Gold III');
  restored(s, 'fair_grounds');
  assert.equal(medalFor(W * 15, W, s)?.id, 'platinum');
  assert.ok(!liveMedals().some((m) => m.id === 'platinum'), 'a ladder drawn without the farm leaves it out');
  setPoints(s, W * 15);
  const acorns = s.farm.wallet.acorns;
  runDue(s, SUNDAY_CLOSE);
  const last = s.farm.fair.last;
  assert.equal(last.medal, 'platinum');
  assert.equal(last.rank, 10);
  assert.ok(s.farm.wallet.acorns - acorns >= 6);
  const nextMonday = fairOpenAt(s, last.w + 1);
  assert.deepEqual(s.farm.coop.platinum, { from: nextMonday, until: nextMonday + 24 * HOUR });
  assert.equal(goldenHourBp(s, nextMonday - MIN), 0, 'not before Monday');
  assert.equal(goldenHourBp(s, nextMonday + HOUR), 1000);
  assert.equal(goldenHourBp(s, nextMonday + 24 * HOUR), 0);
  assert.equal(s.farm.stats.bestMedal, 10);
  assert.ok(s.farm.memory.n > 0 && Object.values(s.farm.memory.rows).some((r) => r.k === 'platinum'));
  valid(s);
});

test('Platinum after downtime: the Golden Hour starts when the ceremony runs, never in the past', () => {
  const s = leagueFarm(30);
  restored(s, 'fair_grounds');
  setPoints(s, s.farm.fair.cur.W * 15);
  const late = SUNDAY_CLOSE + 2 * DAY;
  runDue(s, late);
  assert.equal(s.farm.coop.platinum.from, late);
  assert.equal(s.farm.coop.platinum.until, late + 24 * HOUR);
});

test('the Town Fair Grounds allow one more entry of each item a week', () => {
  const s = leagueFarm(30);
  assert.equal(entryLimit(s), FAIR.points.maxEntriesPerItem);
  give(s, 'bread', 20);
  actOk(s, 'fairEnter', { item: 'bread', qty: 10 }, { now: MONDAY + HOUR });
  assert.equal(act(s, 'fairEnter', { item: 'bread', qty: 1 }, { now: MONDAY + HOUR }).code, 'CAP');
  restored(s, 'fair_grounds');
  assert.equal(entryLimit(s), FAIR.points.maxEntriesPerItem + 1);
  actOk(s, 'fairEnter', { item: 'bread', qty: 1 }, { now: MONDAY + HOUR });
  assert.equal(act(s, 'fairEnter', { item: 'bread', qty: 1 }, { now: MONDAY + HOUR }).code, 'CAP');
});

test('the horse show doubles the Show Ribbon; hampers score double from L32 (both M2 features)', () => {
  const s = leagueFarm(32);
  const it = CONTENT.items.get('show_ribbon');
  assert.ok(it, 'the Show Ribbon exists');
  const base = Math.floor((FAIR.points.prizedAnimalGoodMul * it.sell * 10 + 50) / 100);
  assert.equal(entryPoints10(s, 'show_ribbon'), base * FAIR.points.horseShowMul);
  const hamper = [...CONTENT.items.values()].find((x) => x.kind === 'craft' && x.tier === 'T4');
  if (hamper) {
    const one = Math.floor((hamper.sell * 10 + 50) / 100);
    assert.equal(entryPoints10(s, hamper.id, 32), one * FAIR.points.hamperMul);
    assert.equal(entryPoints10(s, hamper.id, 31), one);
  }
});

test('"League Night" (G4): reach League 2 is a state task read from the best league', () => {
  const s = leagueFarm(27);
  const t = questOf('g4').tasks[0];
  assert.equal(stateCount(s, t, MONDAY), 1);
  setPoints(s, 999_999);
  runDue(s, SUNDAY_CLOSE);
  assert.equal(stateCount(s, t, SUNDAY_CLOSE), 2);
  if (s.farm.quests.active.g4 || s.farm.quests.done.g4) assert.ok(s.farm.quests.done.g4, 'the card completed');
  assert.equal(fairTarget(27) > 0, true);
});
