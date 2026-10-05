// ui-weekly lane (wave 2): the DOM-free readers behind the County Fair tent, the ceremony card, the River Barge, the
// townsfolk board and the Hollow Village. Every number a panel previews is checked against what the real action
// then does (the rules decide; the UI must never promise something else). The systems are switched on with the goals
// lane's test switch, so these tests run before and after the M1b milestone flip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must, run, sys, T0 } from './helpers.js';
import { farmAt, give } from './helpers/rules.js';
import { CONTENT, FAIR, BARGE, TOWNSFOLK, TOWN_PROJECT_RULES, itemOf, isLive } from '../shared/content/index.js';
import { ACTIONS } from '../shared/rules/index.js';
import { forceLiveForTests, weekOf } from '../shared/rules/coop.js';
import * as FR from '../shared/rules/actions/fair.js';
import * as BR from '../shared/rules/actions/barge.js';
import * as TW from '../shared/rules/actions/town.js';
import {
  fairView, fairBadge, lastResult, ceremonyDue, medalLadder, fmtPts, weekLabel, systemOpen, withDock, need, actionOf,
} from '../public/js/ui/panels/fair.js';
import { bargeView, bargeBadge, chestOf, crateArgs, bargeTone } from '../public/js/ui/panels/barge.js';
import { townsfolkView, townsfolkBadge, giftOf } from '../public/js/ui/panels/townsfolk.js';
import { townView, townBadge, fundSegments, liveProjects, weeklyLines } from '../public/js/ui/panels/town.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const M1B_NPCS = ['reed', 'pemberton', 'pip', 'rosie', 'tom', 'lucia', 'journal'].map((id) => CONTENT.npcs.get(id)).filter(Boolean);
forceLiveForTests([FAIR, BARGE, TOWNSFOLK, TOWN_PROJECT_RULES, ...M1B_NPCS,
  ...[...CONTENT.townProjects.values()].filter((p) => p.m === 'M1b')]);

const noJunk = (t) => assert.ok(typeof t === 'string' && t && !/undefined|null|NaN|\[object/.test(t), `bad text: ${t}`);

/** A level-22 farm with this week's Fair open (the real `_fair`), goods in the barn. */
function fairFarm(level = 22) {
  const s = farmAt(level);
  must(s, 'claimGift', {}, { pid: 'p1' });    // any action: the farm is live; ignore what it pays
  sys(s, '_fair', {});
  for (const [i, n] of Object.entries({ cookies: 14, cheese: 6, sweetheart_cake: 2, golden_egg: 3, bread: 30 })) give(s, i, n);
  return s;
}

const localHourDay = (ms, tz) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23', minute: 'numeric' }).formatToParts(ms);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return `${g('weekday')} ${g('hour')}:${g('minute')}`;
};

test('fair: the tent stays shut below its level and opens with the week\'s frozen target', () => {
  const low = farmAt(FAIR.unlock - 1);
  const v0 = fairView(low, 'p1', T0);
  assert.equal(v0.open, false);
  assert.equal(fairBadge(low, 'p1', T0), null);
  assert.equal(systemOpen(FAIR, low), false);
  const s = fairFarm();
  const v = fairView(s, 'p1', T0);
  assert.equal(v.open, true);
  assert.equal(v.has, true, 'the real _fair opened this week');
  assert.equal(v.isOpen, true);
  assert.equal(v.W, s.farm.fair.cur.W);
  assert.equal(v.W, FR.fairTarget(22));
  assert.equal(localHourDay(v.closesAt, s.meta.tz), 'Sun 20:00', 'judging is Sunday 20:00 in the farm zone');
  assert.equal(v.closesAt, FR.fairCloseAt(s, s.farm.fair.cur.w));
  assert.equal(v.ladder.length, FR.liveMedals().length);
  for (const [k, m] of v.ladder.entries()) {
    const rule = FR.liveMedals()[k];
    assert.equal(m.at10, FR.medalNeed10(rule, v.W), `${m.id} threshold`);
    assert.equal(m.coins, FR.medalCoins(rule, v.W), `${m.id} pay`);
  }
  assert.equal(v.ladder.find((m) => m.id === 'gold2').at10, v.W * 10, 'Gold II is the target');
  noJunk(weekLabel(v.closesAt, s));
});

test('fair: every entry preview is exactly what the real entry scores (duet ×2, blue-ribbon goods ×2)', () => {
  const s = fairFarm();
  const v = fairView(s, 'p1', T0);
  const by = Object.fromEntries(v.entries.map((e) => [e.item, e]));
  assert.ok(by.cookies && by.cheese && by.sweetheart_cake && by.golden_egg, 'workshop, duet and blue-ribbon goods are listed');
  assert.equal(by.bread.pts10, Math.round(itemOf('bread').sell / 10), 'a T3 good scores V / 100');
  assert.equal(by.sweetheart_cake.duet, true);
  assert.equal(by.sweetheart_cake.pts10, 2 * Math.floor((itemOf('sweetheart_cake').sell * 10 + 50) / 100), 'duet goods count double');
  assert.equal(by.golden_egg.prized, true);
  assert.ok(!v.entries.some((e) => itemOf(e.item).kind === 'crop'), 'raw crops score by harvest only');
  for (const e of v.entries) {
    const before = s.farm.fair.cur.p;
    const r = must(s, 'fairEnter', { item: e.item, qty: 1 }, { pid: 'p2' });
    const ev = r.tx.events.find((x) => x.e === 'fairEntered');
    assert.equal(ev.p10, e.pts10, `${e.item}: preview ${e.pts10} vs entry ${ev.p10}`);
    assert.equal(s.farm.fair.cur.p - before, e.pts10);
  }
  const after = fairView(s, 'p1', T0);
  assert.deepEqual(after.by, { p2: s.farm.fair.cur.p }, 'points are credited to the farmer who entered');
  assert.equal(after.entered.reduce((n, r) => n + r.pts10, 0), s.farm.fair.cur.p);
});

test('fair: ten of a kind a week, then the card says so and the rules agree', () => {
  const s = fairFarm();
  must(s, 'fairEnter', { item: 'cookies', qty: 9 }, { pid: 'p1' });
  let e = fairView(s, 'p1', T0).entries.find((x) => x.item === 'cookies');
  assert.equal(e.entered, 9);
  assert.equal(e.left, 1);
  must(s, 'fairEnter', { item: 'cookies', qty: 1 }, { pid: 'p1' });
  const v = fairView(s, 'p1', T0);
  e = v.entries.find((x) => x.item === 'cookies');
  assert.equal(e.left, 0, 'the cap is reached');
  assert.equal(run(s, 'fairEnter', { item: 'cookies', qty: 1 }).code, 'CAP');
  assert.ok(v.entries.indexOf(e) > v.entries.findIndex((x) => x.left > 0 && x.have > 0), 'full goods sort after the ones you can still enter');
  assert.equal(v.cap, FAIR.points.maxEntriesPerItem);
});

test('fair: the ladder names the medal reached and the next one; the badge fires when the barn reaches it', () => {
  const s = fairFarm();
  const W = s.farm.fair.cur.W;
  const lad = medalLadder(W);
  s.farm.fair.cur.p = lad[0].at10 - 1;
  let v = fairView(s, 'p1', T0);
  assert.equal(v.medal, null);
  assert.equal(v.next.id, lad[0].id);
  assert.equal(v.toNext10, 1);
  assert.equal(fairBadge(s, 'p1', T0), '!', 'one point to go and goods in the barn');
  s.farm.fair.cur.p = lad[1].at10;
  v = fairView(s, 'p1', T0);
  assert.equal(v.medal.id, lad[1].id);
  assert.equal(v.next.id, lad[2].id);
  s.farm.fair.cur.p = lad.at(-1).at10 + 50;
  v = fairView(s, 'p1', T0);
  assert.equal(v.next, null, 'top of the ladder');
  assert.equal(fairBadge(s, 'p1', T0), null);
  // an empty barn cannot reach the next medal: no badge
  const t = fairFarm();
  t.farm.inventory = {};
  assert.equal(fairBadge(t, 'p1', T0), null);
});

test('fair: Sunday 20:00 closes the tent; the ceremony card is due once per farmer, live or caught up', () => {
  const s = fairFarm();
  must(s, 'fairEnter', { item: 'cheese', qty: 5 }, { pid: 'p1' });
  must(s, 'fairEnter', { item: 'cookies', qty: 10 }, { pid: 'p2' });
  const close = FR.fairCloseAt(s, s.farm.fair.cur.w);
  assert.equal(fairView(s, 'p1', close - 1).isOpen, true);
  const shut = fairView(s, 'p1', close + 1);
  assert.equal(shut.isOpen, false, 'closed between Sunday 20:00 and Monday');
  assert.equal(localHourDay(shut.opensAt, s.meta.tz), 'Mon 00:00');
  const r = sys(s, '_fair', {}, close + 1000);
  assert.ok(r.ok);
  assert.ok(r.tx.events.some((e) => e.e === 'fairCeremony'), 'the server ran the ceremony');
  const c = lastResult(s);
  assert.equal(c.p10, s.farm.fair.last.p);
  assert.equal(c.medal, s.farm.fair.last.medal);
  assert.equal(c.coins, s.farm.fair.last.coins);
  assert.ok(c.by.p1 > 0 && c.by.p2 > 0, 'the card shows who brought what');
  assert.equal(c.by.p1 + c.by.p2, c.p10);
  if (c.medal) noJunk(c.name);
  assert.equal(ceremonyDue(s, 'p1', close + 2000), true);
  assert.equal(ceremonyDue(s, 'p2', close + 2000), true);
  must(s, 'markSeen', { kind: 'fair', id: String(c.w) }, { pid: 'p1', now: close + 3000 });
  assert.equal(ceremonyDue(s, 'p1', close + 4000), false, 'shown once');
  assert.equal(ceremonyDue(s, 'p2', close + DAY), true, 'the absent partner still gets it');
  assert.equal(ceremonyDue(s, 'p2', close + 9 * DAY), false, 'a stale ceremony is not shown');
  assert.equal(fairView(s, 'p1', close + 2000).last.w, c.w, 'the closed tent shows last week');
});

/** A docked barge in the rules' own shape (its generator needs producers a test farm lacks). */
function bargeFarm() {
  const s = farmAt(22);
  s.farm.barge = { ...s.farm.barge, t: 3, streak: 1, w: weekOf(s, T0), docked: true, rows: 2, paid: {}, next: null,
    crates: { 0: c('cheese', 4), 1: c('cookies', 6), 2: c('bread', 10), 3: c('golden_egg', 2), 4: c('wooden_crate', 9), 5: c('omelette', 3) } };
  for (const [i, n] of Object.entries({ cheese: 6, cookies: 6, bread: 20, golden_egg: 1, omelette: 3 })) give(s, i, n);
  return s;
}
const c = (item, qty) => ({ item, qty, by: null, at: 0, flag: null });

test('barge: rows of crates with the rules\' own pay; loading pays exactly the preview, a full row its row pay', () => {
  const s = bargeFarm();
  const at = Math.max(T0, BR.dockAt(s, s.farm.barge.w) + HOUR);
  const v = bargeView(s, 'p1', at);
  assert.equal(v.open, true);
  assert.equal(v.docked, true);
  assert.equal(v.rows.length, 2);
  assert.equal(v.tier, 3);
  assert.deepEqual(v.tiers[2], { t: 3, ...chestOf(3) });
  assert.deepEqual(chestOf(3), { acorns: 4, compost: 9, decor: true });
  assert.equal(localHourDay(v.leavesAt, s.meta.tz), 'Sun 20:00');
  assert.equal(v.ready, 4, 'cheese, cookies, bread and the omelettes are in the barn');
  assert.equal(bargeBadge(s, 'p1', at), 4);
  const row0 = v.rows[0];
  const rowPay = row0.pay;
  for (const crate of row0.crates) {
    const r = must(s, 'bargeLoad', { i: crate.i }, { pid: crate.i === 1 ? 'p2' : 'p1', now: at });
    const ev = r.tx.events.find((e) => e.e === 'bargeLoaded');
    assert.equal(ev.coins, crate.coins, `crate ${crate.i} coins`);
    assert.equal(ev.xp, crate.xp, `crate ${crate.i} xp`);
    if (crate.i === 2) {
      const row = r.tx.events.find((e) => e.e === 'bargeRow');
      assert.ok(row, 'the third crate completes the row');
      assert.equal(row.coins, rowPay.coins);
      assert.equal(row.acorns, rowPay.acorns);
      assert.equal(row.compost, rowPay.compost);
    }
  }
  const after = bargeView(s, 'p1', at);
  assert.equal(after.rows[0].done, true);
  assert.equal(after.loaded, 3);
  assert.deepEqual(after.by, { p1: 2, p2: 1 }, 'who loaded what');
  assert.equal(after.pay.rows, 1);
  assert.equal(after.pay.coins, after.rows[1].crates.reduce((n, x) => n + x.coins, 0) + after.rows[1].pay.coins);
});

test('barge: help flags (at most 3), the jetty between cast-off and docking, next week\'s manifest', () => {
  const s = bargeFarm();
  const at = Math.max(T0, BR.dockAt(s, s.farm.barge.w) + HOUR);
  for (const i of [3, 4, 5]) must(s, 'bargeFlag', { i }, { pid: 'p1', now: at });
  const v = bargeView(s, 'p1', at);
  assert.equal(v.flags, 3);
  assert.equal(v.flagsMax, BARGE.helpFlags);
  assert.equal(run(s, 'bargeFlag', { i: 0 }, { pid: 'p1', now: at }).code, 'CAP', 'the panel hides a fourth flag button; the rules refuse it too');
  const leave = BR.castOffAt(s, s.farm.barge.w);
  s.farm.barge = { ...s.farm.barge, docked: false, next: { w: s.farm.barge.w + 1, rows: 1, crates: [c('cheese', 3), c('bread', 5), c('cookies', 2)].map(({ item, qty }) => ({ item, qty })) },
    log: { w: s.farm.barge.w, rows: 2, done: 1, t: 2 } };
  const away = bargeView(s, 'p1', leave + HOUR);
  assert.equal(away.docked, false);
  assert.equal(away.rows.length, 0);
  assert.deepEqual(away.next.map((x) => x.item), ['cheese', 'bread', 'cookies']);
  assert.equal(localHourDay(away.arrivesAt, s.meta.tz), 'Mon 06:00');
  assert.equal(bargeBadge(s, 'p1', leave + HOUR), null);
  assert.equal(bargeView(farmAt(BARGE.unlock - 1), 'p1', T0).open, false);
});

/** This week's townsfolk board in the rules' shape. */
function folkFarm() {
  const s = farmAt(22);
  const w = weekOf(s, T0);
  const post = (npc, n, items) => {
    let v = 0;
    for (const [i, q] of Object.entries(items)) v += itemOf(i).sell * q;
    const value = Math.floor((v * TOWNSFOLK.payBp) / 10_000);
    const coins = Math.floor((value * TOWNSFOLK.coinShareBp) / 10_000);
    return { npc, n, items, coins, xp: Math.max(1, Math.floor((value - coins) / 8)), value, done: null };
  };
  s.farm.folk = { ...s.farm.folk, w, n: 3, posts: { 0: post('rosie', 0, { bread: 6, butter: 2 }), 1: post('pip', 1, { cookies: 3 }), 2: post('tom', 2, { veggie_soup: 4 }) },
    f: { rosie: { v: 3, d: -1 }, juniper: { v: 8, d: -1 } } };
  for (const [i, n] of Object.entries({ bread: 10, butter: 2, cookies: 1, honey: 1, apple: 2 })) give(s, i, n);
  return s;
}

test('townsfolk: requests with have/need, delivery by a farmer, Friendship and the once-a-day gift', () => {
  const s = folkFarm();
  const v = townsfolkView(s, 'p1', T0);
  assert.equal(v.open, true);
  assert.equal(v.has, true);
  assert.equal(v.posts.length, 3);
  assert.equal(v.ready, 1, 'only Rosie\'s request can be filled from the barn');
  assert.equal(townsfolkBadge(s, 'p1', T0), 1);
  assert.equal(localHourDay(v.leavesAt, s.meta.tz), 'Mon 00:00', 'requests leave with the week');
  assert.equal(v.friends[0].npc, 'juniper', 'closest friends first');
  const rosie = v.friends.find((f) => f.npc === 'rosie');
  assert.equal(rosie.n, 3);
  assert.equal(rosie.nextAt, 4);
  assert.deepEqual(rosie.next, giftOf('rosie', 2));
  noJunk(rosie.next.name);
  const p0 = v.posts[0];
  const r = must(s, 'folkFill', { i: p0.i, n: p0.n }, { pid: 'p2' });
  const ev = r.tx.events.find((e) => e.e === 'folkFilled');
  assert.equal(ev.coins, p0.coins, 'the card pays what it showed');
  const after = townsfolkView(s, 'p1', T0);
  assert.equal(after.posts[0].done, true);
  assert.equal(after.posts[0].by, 'p2');
  assert.equal(after.done, 1);
  assert.ok(after.friends.find((f) => f.npc === 'rosie').n >= 4, 'a filled request makes a friend');
  must(s, 'folkGift', { npc: 'tom', item: 'bread' }, { pid: 'p1' });
  const tom = townsfolkView(s, 'p1', T0).friends.find((f) => f.npc === 'tom');
  assert.equal(tom.gifted, true);
  assert.equal(run(s, 'folkGift', { npc: 'tom', item: 'bread' }, { pid: 'p2' }).code, 'ALREADY_DONE', 'one gift a day per neighbour');
  // last week's posts are gone from the board
  assert.equal(townsfolkView(s, 'p1', T0 + 7 * DAY).posts.length, 0);
  assert.equal(townsfolkView(farmAt(TOWNSFOLK.unlock - 1), 'p1', T0).open, false);
});

/** The first Town Project, open, in the economy lane's shape. */
function townFarm() {
  const s = farmAt(22);
  const coins = TW.townCoins(1, 22);
  s.farm.town = { n: 0, cur: { id: 'ferry_landing', n: 1, at: T0 - HOUR, lvl: 22, coins, paid: 0, by: {},
    goods: [{ item: 'cheese', qty: 6, got: 0, by: {} }, { item: 'cookies', qty: 4, got: 0, by: {} }, { item: 'apple_juice', qty: 5, got: 0, by: {} }] } };
  for (const [i, n] of Object.entries({ cheese: 6, cookies: 4, apple_juice: 2 })) give(s, i, n);
  s.farm.wallet.coins = 10 * coins;
  return s;
}

test('town: stages from goods and coins to building to built, donors per farmer, and the village badge', () => {
  const s = townFarm();
  let v = townView(s, 'p1', T0);
  assert.equal(v.open, true);
  assert.equal(v.cur.stage, 'gathering');
  assert.equal(v.cur.need, TW.townCoins(1, 22));
  assert.ok(liveProjects().length >= 4, 'the four M1b projects');
  assert.equal(v.projects.find((p) => p.id === 'ferry_landing').status, 'current');
  assert.equal(townBadge(s, 'p1', T0), '!', 'the barn holds goods the project needs');
  must(s, 'townGive', { item: 'cheese', qty: 6 }, { pid: 'p1' });
  must(s, 'townGive', { item: 'cookies', qty: 4 }, { pid: 'p2' });
  must(s, 'townGive', { item: 'apple_juice', qty: 2 }, { pid: 'p2' });
  must(s, 'townFund', { coins: 1000, confirm: ['BIG_SPEND'] }, { pid: 'p2' });
  v = townView(s, 'p1', T0);
  assert.deepEqual(v.donors, { p1: { coins: 0, goods: 6 }, p2: { coins: 1000, goods: 6 } });
  const segs = fundSegments(s, v.cur);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].pid, 'p2');
  assert.equal(townBadge(s, 'p1', T0), null, 'nothing the barn can still give');
  give(s, 'apple_juice', 3);
  must(s, 'townGive', { item: 'apple_juice', qty: 3 }, { pid: 'p1' });
  must(s, 'townFund', { coins: v.cur.coinsLeft, confirm: ['BIG_SPEND'] }, { pid: 'p1' });
  v = townView(s, 'p1', T0);
  assert.equal(v.cur.stage, 'building', 'everything is in: Ollie builds it the next day');
  assert.equal(v.cur.readyAt, T0 + TOWN_PROJECT_RULES.buildMs);
  assert.equal(v.projects.find((p) => p.id === 'ferry_landing').status, 'building');
  assert.equal(townView(s, 'p1', T0 + DAY).cur.stage, 'built');
  // a part of the funding without a known donor (an older save) still fills the bar
  const t = townFarm();
  t.farm.town.cur.paid = 500;
  t.farm.town.cur.by = { p1: 200 };
  const sg = fundSegments(t, townView(t, 'p1', T0).cur);
  assert.deepEqual(sg.map((x) => x.pid), ['p1', null]);
  assert.equal(Math.round((sg[0].w + sg[1].w) * t.farm.town.cur.coins), 500);
});

test('town: with no project pinned up, Ollie says why (goods to make, or every project built)', () => {
  const s = farmAt(22);
  s.farm.town = { n: 0, cur: null };
  const v = townView(s, 'p1', T0);
  assert.equal(v.cur, null);
  assert.equal(v.waiting, 'goods', 'the farm has not made three kinds of goods lately');
  assert.equal(v.need, TOWN_PROJECT_RULES.goods);
  s.farm.town = { n: 24, cur: null };
  // M2: after the 24th the Festival Pavilion's tiers follow (rules town.pavilionTier), so the village is never "done"
  const pavilion = [...CONTENT.townProjects.values()].every((p) => isLive(p));
  assert.equal(townView(s, 'p1', T0).waiting, pavilion ? 'goods' : 'done');
  assert.equal(townView(farmAt(TOWN_PROJECT_RULES.unlock - 1), 'p1', T0).open, false);
});

test('every action the weekly panels send is a registered rule with the args the panel builds', () => {
  const sent = {
    fairEnter: ['item', 'qty'], bargeLoad: ['i', 'w', 'item'], bargeFlag: ['i', 'w', 'item'], folkFill: ['i', 'n'], folkGift: ['npc', 'item'],
    townGive: ['item', 'qty'], townFund: ['coins'], markSeen: ['kind', 'id', 'level'],
  };
  for (const [type, keys] of Object.entries(sent)) {
    assert.ok(Object.hasOwn(ACTIONS, type), `${type} is registered`);
    assert.equal(actionOf(type), type);
    for (const k of Object.keys(ACTIONS[type].schema)) assert.ok(keys.includes(k), `${type} takes ${k}: the panel must send it`);
  }
});

test('helpers: points with one decimal, plural reasons, dock buttons only once a system is open', () => {
  assert.equal(fmtPts(1712), '171.2');
  assert.equal(fmtPts(1710), '171');
  assert.equal(fmtPts(5), '0.5');
  assert.equal(fmtPts(123450), '12,345');
  assert.deepEqual(need('wooden_crate', 3).missing[0].label, 'Wooden Crates');
  assert.deepEqual(need('cheese', 0).missing[0].n, 1);
  const store = { state: farmAt(FAIR.unlock - 1) };
  const spec = withDock({ title: 'x', mount() {} }, FAIR, { label: 'Fair' }, store);
  assert.equal(spec.dock, null, 'no dead dock button before the level');
  store.state = farmAt(FAIR.unlock);
  assert.deepEqual(spec.dock, { label: 'Fair' });
});

test('weekly lines for the recap and the Journal: one sentence per open system, none before they open', () => {
  assert.deepEqual(weeklyLines(farmAt(FAIR.unlock - 1), 'p1', T0), []);
  const s = fairFarm();
  s.farm.barge = bargeFarm().farm.barge;
  s.farm.folk = folkFarm().farm.folk;
  s.farm.town = townFarm().farm.town;
  const lines = weeklyLines(s, 'p1', Math.max(T0, BR.dockAt(s, s.farm.barge.w) + HOUR));
  assert.deepEqual(lines.map((l) => l.panel), ['fair', 'barge', 'townsfolk', 'town']);
  for (const l of lines) { noJunk(l.text); noJunk(l.icon); }
  assert.match(lines[0].text, /^County Fair: 0 of [\d,]+ points\. Judging in /);
  assert.match(lines[1].text, /^River Barge: 0 of 6 crates loaded/);
});

test('QA2 RC-07 (ui half): the barge panel sends the crate\'s week and item; last week\'s queued load is refused', () => {
  const s = bargeFarm();
  const at = Math.max(T0, BR.dockAt(s, s.farm.barge.w) + HOUR);
  const v = bargeView(s, 'p1', at);
  const crate = v.rows[0].crates[0];
  const args = crateArgs('bargeLoad', v, crate);
  assert.deepEqual(args, { i: 0, w: s.farm.barge.w, item: 'cheese' });
  assert.deepEqual(crateArgs('bargeFlag', v, crate), { i: 0, w: s.farm.barge.w, item: 'cheese' });
  assert.equal(run(s, 'bargeLoad', { ...args, w: s.farm.barge.w - 1 }, { now: at }).code, 'NOT_FOUND', 'a stale week is refused');
  assert.equal(run(s, 'bargeLoad', { ...args, item: 'bread' }, { now: at }).code, 'NOT_FOUND', 'a stale item is refused');
  must(s, 'bargeLoad', args, { now: at });
});

test('QA2 UI-03: the barge badge is calm all week and red only on the last day before she casts off', () => {
  const s = bargeFarm();
  const at = Math.max(T0, BR.dockAt(s, s.farm.barge.w) + HOUR);
  assert.equal(bargeTone(s, 'p1', at), 'calm');
  const v = bargeView(s, 'p1', at);
  assert.equal(bargeTone(s, 'p1', v.leavesAt - HOUR), null, 'an hour before the cast-off the badge is red');
});

test('QA2 RC-14 (ui half): a partner away for two Sundays sees both ceremonies, the oldest first', () => {
  const s = fairFarm();
  must(s, 'fairEnter', { item: 'cheese', qty: 5 }, { pid: 'p1' });
  const w1 = s.farm.fair.cur.w;
  const close1 = FR.fairCloseAt(s, w1);
  assert.ok(sys(s, '_fair', {}, close1 + 1000).ok);
  must(s, 'markSeen', { kind: 'fair', id: String(w1) }, { pid: 'p1', now: close1 + 2000 });
  const open2 = FR.fairOpenAt(s, w1 + 1);
  assert.ok(sys(s, '_fair', {}, open2 + 1000).ok);
  must(s, 'fairEnter', { item: 'cookies', qty: 4 }, { pid: 'p1', now: open2 + 2000 });
  const close2 = FR.fairCloseAt(s, s.farm.fair.cur.w);
  assert.ok(sys(s, '_fair', {}, close2 + 1000).ok);
  const later = close2 + 2000;
  assert.equal(ceremonyDue(s, 'p2', later), true);
  assert.equal(lastResult(s, 'p2').w, w1, 'Mia sees the first Sunday first');
  assert.equal(lastResult(s, 'p1').w, s.farm.fair.last.w, 'Rowan saw the first one live: his card is the second');
  assert.equal(lastResult(s, 'p2', s.farm.fair.last.w).w, s.farm.fair.last.w, 'a card opened for a week shows that week');
  must(s, 'markSeen', { kind: 'fair', id: String(w1) }, { pid: 'p2', now: later });
  assert.equal(ceremonyDue(s, 'p2', later + 1000), true, 'then the second one');
  assert.equal(lastResult(s, 'p2').w, s.farm.fair.last.w);
});
