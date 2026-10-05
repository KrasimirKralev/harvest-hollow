// Felt co-op mechanics (GDD §6.2 M1 column, §6.3, §6.4, §9 #18-#24): high-five, Golden Hour, keepsakes, thanks,
// notes, naming, unlock tours and drip-feed cards, the two tutorial tracks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { CONTENT, COOP, TUTORIAL, DRIP_FEED, cropOf, xpForLevel } from '../shared/content/index.js';
import { goldenHourBp } from '../shared/rules/coop.js';
import { feedRows } from '../shared/rules/feed.js';
import { dueSystemActions, nextSystemDueAt } from '../shared/rules/system.js';
import { nextSystemCard, unseenLevels } from '../shared/rules/actions/social.js';
import { currentStep, currentFarmStep } from '../shared/rules/actions/tutorial.js';
import { recap } from '../shared/rules/feed.js';
import {
  makeFarm, farmAt, put, give, credit, runDue, sys, act, actOk, evs, valid, T0, MIN, HOUR, DAY,
} from './helpers/rules-goals.js';

const near = (other, d = 10) => ({ avatar: { [other]: d }, online: ['p1', 'p2'] });

test('high-five: two different players within 1.5 s and 2 tiles: a Spark for both, a Heart each, a cooldown', () => {
  const s = makeFarm();
  const r1 = actOk(s, 'highFive', {}, { pid: 'p1', now: T0 });
  assert.equal(evs(r1, 'highFiveWait').length, 1);
  const r2 = actOk(s, 'highFive', {}, { pid: 'p2', now: T0 + 1200, ext: near('p1') });
  const ev = evs(r2, 'together')[0];
  assert.deepEqual([ev.kind, ev.a, ev.b], ['highFive', 'p1', 'p2']);
  for (const pid of ['p1', 'p2']) {
    assert.equal(s.players[pid].spark, T0 + 1200 + COOP.highFive.sparkMs);
    assert.equal(s.players[pid].hearts, 1);
  }
  assert.equal(s.farm.stats.highFives, 1);
  assert.equal(act(s, 'highFive', {}, { pid: 'p1', now: T0 + 2000 }).code, ERR.COOLDOWN);
  valid(s);
});

test('high-five never completes alone, too late, or too far apart (GDD §9 #20)', () => {
  const s = makeFarm();
  actOk(s, 'highFive', {}, { pid: 'p1', now: T0 });
  actOk(s, 'highFive', {}, { pid: 'p1', now: T0 + 100, ext: near('p1') });   // the same player twice: refresh only
  assert.equal(s.farm.coop.hfAt, null);
  actOk(s, 'highFive', {}, { pid: 'p2', now: T0 + 100 + COOP.highFive.windowMs + 1, ext: near('p1') });
  assert.equal(s.farm.coop.hfAt, null, 'too late: p2 opened a new slot instead');
  actOk(s, 'highFive', {}, { pid: 'p1', now: T0 + 3000, ext: near('p2', 21) });
  assert.equal(s.farm.coop.hfAt, null, 'more than 2 tiles apart');
  actOk(s, 'highFive', {}, { pid: 'p2', now: T0 + 3100, ext: near('p1', 20) });
  assert.ok(s.farm.coop.hfAt, 'side by side, in time');
});

test('high-five Hearts: only the first 3 of a day; the Spark always', () => {
  const s = makeFarm();
  let t = T0;
  for (let i = 0; i < 5; i++) {
    actOk(s, 'highFive', {}, { pid: 'p1', now: t });
    actOk(s, 'highFive', {}, { pid: 'p2', now: t + 500, ext: near('p1') });
    t += COOP.highFive.cooldownMs + 1000;
  }
  assert.equal(s.farm.stats.highFives, 5);
  assert.equal(s.players.p1.hearts, COOP.highFive.heartsFirst);
});

test('Golden Hour: two players on one bench for 10 s, once per 8 hours; everything started takes 10 % less time', () => {
  const s = farmAt(4);
  runDue(s, T0);                                     // the order board settles first
  const bench = put(s, 'sunset_bench');
  assert.equal(act(s, 'sit', { id: 'home.0.0' }).code, ERR.BAD_ARGS, 'a plot is not a seat');
  actOk(s, 'sit', { id: bench }, { pid: 'p1', now: T0 });
  assert.equal(act(s, 'sit', { id: bench }, { pid: 'p1', now: T0 + 1 }).code, ERR.ALREADY_DONE);
  actOk(s, 'sit', { id: bench }, { pid: 'p2', now: T0 + 2000 });
  assert.equal(nextSystemDueAt(s, T0 + 2000), T0 + 2000 + COOP.goldenHour.seatMs);
  assert.deepEqual(dueSystemActions(s, T0 + 2000 + COOP.goldenHour.seatMs - 1).map((d) => d.type), []);
  const at = T0 + 2000 + COOP.goldenHour.seatMs;
  const mine = (list) => list.filter((t) => ['_golden', '_rollover', '_orders'].includes(t));
  const ran = mine(runDue(s, at));
  assert.deepEqual(ran, ['_golden']);
  assert.equal(goldenHourBp(s, at), COOP.goldenHour.bp);
  assert.equal(goldenHourBp(s, at + COOP.goldenHour.durationMs), 0);
  // in M1b the Together card H1 ("Sit together for Golden Hour", L4) pays its own Heart on top
  const h1 = s.farm.quests.done?.h1 !== undefined ? (CONTENT.quests.get('h1')?.rewards?.hearts ?? 0) : 0;
  assert.equal(s.players.p1.hearts, COOP.goldenHour.hearts + h1);
  assert.equal(s.farm.stats.goldenHours, 1);
  assert.ok(feedRows(s).some(([, r]) => r.k === 'golden'));
  // still seated: no second Golden Hour inside the session gap
  assert.deepEqual(mine(runDue(s, at + HOUR)), []);
  // stand, sit again after 8 hours: a new one
  actOk(s, 'stand', {}, { pid: 'p1', now: at + HOUR });
  actOk(s, 'sit', { id: bench }, { pid: 'p1', now: at + COOP.goldenHour.sessionGapMs });
  assert.ok(runDue(s, at + COOP.goldenHour.sessionGapMs + COOP.goldenHour.seatMs).includes('_golden'));
  valid(s);
});

test('Golden Hour needs both seated: standing up or disconnecting (_seen) cancels the 10 s', () => {
  const s = farmAt(4);
  runDue(s, T0);
  const bench = put(s, 'sunset_bench');
  actOk(s, 'sit', { id: bench }, { pid: 'p1', now: T0 });
  actOk(s, 'sit', { id: bench }, { pid: 'p2', now: T0 });
  assert.ok(sys(s, '_seen', { pid: 'p2' }, T0 + 5000).ok);
  assert.ok(!runDue(s, T0 + COOP.goldenHour.seatMs).includes('_golden'));
  assert.equal(s.farm.coop.golden, null);
  const third = put(s, 'sunset_bench');
  actOk(s, 'sit', { id: third }, { pid: 'p2', now: T0 + 6000 });
  assert.ok(!runDue(s, T0 + 6000 + COOP.goldenHour.seatMs).includes('_golden'), 'two different benches are not a pair');
});

test('keepsake: once a day per giver, a produced good onto the partner\'s shelf, a Heart each, no coins', () => {
  const s = farmAt(4);
  assert.equal(act(s, 'keepsake', { item: 'wheat' }).code, ERR.NO_ITEMS);
  give(s, 'strawberry', 2);
  const coins = s.farm.wallet.coins;
  const r = actOk(s, 'keepsake', { item: 'strawberry' }, { pid: 'p1' });
  assert.equal(evs(r, 'keepsake')[0].to, 'p2');
  assert.equal(s.farm.inventory.strawberry, 1);
  assert.equal(s.players.p2.shelf.n, 1);
  assert.equal(s.players.p2.shelf.rows['0'].item, 'strawberry');
  assert.equal(s.players.p1.hearts, 1);
  assert.equal(s.players.p2.hearts, 1);
  assert.equal(s.farm.wallet.coins, coins, 'no coins (C9)');
  assert.equal(s.players.p1.stats.keepsakesGiven, 1);
  assert.equal(act(s, 'keepsake', { item: 'strawberry' }, { pid: 'p1' }).code, ERR.COOLDOWN);
  assert.ok(act(s, 'keepsake', { item: 'strawberry' }, { pid: 'p2' }).ok, 'the partner has their own daily gift');
  assert.equal(act(s, 'keepsake', { item: 'chicken_feed' }, { pid: 'p1', now: T0 + DAY }).code, ERR.BAD_ARGS, 'feed is not giftable');
  assert.equal(act(s, 'keepsake', { item: 'wheat', to: 'p1' }, { pid: 'p1', now: T0 + DAY }).code, ERR.SELF_ONLY);
  valid(s);
});

test('keepsake: goods kept for a plan (Keep N) ask a soft confirm', () => {
  const s = farmAt(4);
  give(s, 'egg', 3);
  s.farm.keep = { egg: { n: 3, by: 'p2' } };
  assert.equal(act(s, 'keepsake', { item: 'egg' }).code, ERR.RESERVED);
  assert.ok(act(s, 'keepsake', { item: 'egg', confirm: ['RESERVED'] }).ok);
});

test('a solo farm has no partner for keepsakes', () => {
  const s = farmAt(4, { players: ['p1'] });
  give(s, 'egg', 3);
  assert.equal(act(s, 'keepsake', { item: 'egg' }).code, ERR.SELF_ONLY);
});

test('thanks: +1 Heart to the line\'s actor, once per line, never for yourself, at most 10 received a day', () => {
  const s = farmAt(4);
  for (let i = 0; i < 12; i++) credit(s, [{ e: 'sold', item: 'wheat', qty: 1, coins: 2 }], { pid: 'p2', now: T0 + i * 10_000 });
  const lines = feedRows(s).map(([i]) => i);
  assert.equal(lines.length, 12);
  assert.equal(act(s, 'thank', { i: lines[0] }, { pid: 'p2' }).code, ERR.SELF_ONLY);
  for (const i of lines) actOk(s, 'thank', { i }, { pid: 'p1' });
  assert.equal(s.players.p2.hearts, COOP.thanks.maxReceivedPerDay);
  assert.equal(act(s, 'thank', { i: lines[0] }, { pid: 'p1' }).code, ERR.ALREADY_DONE);
  assert.equal(act(s, 'thank', { i: 999 }, { pid: 'p1' }).code, ERR.NOT_FOUND);
  assert.equal(s.players.p1.stats.thanksSent, 12);
});

test('notes: pinned to a tile for the partner, at most 30 open; either player takes one down', () => {
  const s = makeFarm();
  const r = actOk(s, 'noteAdd', { x: 24, z: 30, text: '  Corn is for the pie!  ' }, { pid: 'p1', cid: 'abcdef', seq: 7 });
  const id = evs(r, 'noted')[0].id;
  assert.equal(s.farm.notes[id].text, 'Corn is for the pie!');
  const back = recap(s, 'p2', T0 + 1, { since: T0 - 1 });
  assert.ok(back.sections.some((x) => x.name === 'notes' && x.items[0].id === id));
  for (let i = 0; i < COOP.notes.maxOpen - 1; i++) actOk(s, 'noteAdd', { x: 1, z: 1, text: `n${i}` }, { seq: 100 + i });
  assert.equal(act(s, 'noteAdd', { x: 1, z: 1, text: 'too many' }, { seq: 999 }).code, ERR.CAP);
  actOk(s, 'noteDel', { id }, { pid: 'p2' });
  assert.equal(act(s, 'noteDel', { id }, { pid: 'p2' }).code, ERR.NOT_FOUND);
  assert.equal(act(s, 'noteAdd', { x: 1, z: 1, text: 'x'.repeat(COOP.notes.maxChars + 1) }, { seq: 5000 }).code, ERR.BAD_ARGS);
  valid(s);
});

test('naming: the farm and the animals record who named them; Name Game counts settled named animals', () => {
  const s = farmAt(7);
  actOk(s, 'nameFarm', { name: 'Sunny Acres' }, { pid: 'p2' });
  assert.equal(s.farm.name, 'Sunny Acres');
  assert.deepEqual(s.farm.coop.named, { by: 'p2', at: T0 });
  assert.equal(act(s, 'nameFarm', { name: 'Sunny Acres' }).code, ERR.ALREADY_DONE);
  const coop = put(s, 'coop');
  const hens = [0, 1, 2].map(() => put(s, 'chicken', { home: coop }));
  actOk(s, 'nameAnimal', { id: hens[0], name: 'Clover' }, { pid: 'p1' });
  actOk(s, 'nameAnimal', { id: hens[0], name: 'Daisy' }, { pid: 'p1' });
  assert.deepEqual(s.farm.names[hens[0]], { name: 'Daisy', by: 'p1', at: T0 });
  actOk(s, 'nameAnimal', { id: hens[1], name: 'Pip' }, { pid: 'p1' });
  actOk(s, 'nameAnimal', { id: hens[2], name: 'Bo' }, { pid: 'p1' });
  assert.equal(s.players.p1.ribbons.name_game.t, 1, 'three settled animals named: Bronze');
  assert.equal(act(s, 'nameAnimal', { id: coop, name: 'X' }).code, ERR.NOT_FOUND);
  valid(s);
});

test('a buy-name-undo loop earns no ribbon: only animals past their undo window count (GDD §9 #9)', () => {
  const s = farmAt(7);
  const coop = put(s, 'coop');
  const rcpt = { coins: 1300, acorns: 0, until: T0 + 10 * MIN };
  const fresh = [0, 1, 2].map(() => put(s, 'chicken', { home: coop, rcpt, paid: { coins: 1300, acorns: 0 } }));
  for (const [i, id] of fresh.entries()) actOk(s, 'nameAnimal', { id, name: `Hen${i}` }, { pid: 'p2', now: T0 + 1000 });
  assert.equal(s.players.p2.ribbons.name_game, undefined, 'still refundable: not counted');
  // the receipts expire; the next minute of play re-checks the holdings ribbons
  credit(s, [], { pid: 'p2', now: T0 + 11 * MIN });
  assert.equal(s.players.p2.ribbons.name_game.t, 1);
});

test('unlock tours and drip-feed cards are per player: one system card per 20 minutes of play', () => {
  const s = farmAt(1);
  s.farm.xp = xpForLevel(5);
  assert.deepEqual(unseenLevels(s, 'p1'), [2, 3, 4, 5]);
  actOk(s, 'markSeen', { kind: 'level', level: 5 }, { pid: 'p1' });
  assert.deepEqual(unseenLevels(s, 'p1'), []);
  assert.deepEqual(unseenLevels(s, 'p2'), [2, 3, 4, 5], 'the partner keeps their own tour');
  assert.equal(act(s, 'markSeen', { kind: 'level', level: 6 }).code, ERR.BAD_ARGS, 'not reached yet');
  const first = nextSystemCard(s, 'p1');
  assert.ok(first);
  actOk(s, 'markSeen', { kind: 'card', id: first }, { pid: 'p1', now: T0 });
  assert.equal(nextSystemCard(s, 'p1'), null, 'the next card waits');
  const gap = DRIP_FEED.minGapMs / MIN;
  for (let m = 1; m <= gap; m++) credit(s, [], { pid: 'p1', now: T0 + m * MIN });
  assert.ok(nextSystemCard(s, 'p1'), 'after 20 active minutes the next card is due');
  assert.notEqual(nextSystemCard(s, 'p1'), first);
  assert.ok(nextSystemCard(s, 'p2'), 'p2 has not seen any card yet');
});

test('tutorial: the first matching deed picks a track and gives the partner the other; steps advance', () => {
  const s = makeFarm();
  credit(s, [{ e: 'cleared', id: 'w', def: 'weed', xp: 1, coins: 5 }], { pid: 'p2' });
  assert.equal(s.players.p2.tut.track, 'barnyard');
  assert.equal(s.players.p1.tut.track, 'fields');
  for (let i = 0; i < 6; i++) credit(s, [{ e: 'planted', id: 'home.0.0', crop: 'wheat' }], { pid: 'p1' });
  assert.equal(currentStep(s, 'p1').id, TUTORIAL.fields[1].id);
  // the partner's wheat does not move my steps
  credit(s, [{ e: 'harvested', id: 'home.0.0', crop: 'wheat', qty: 6, planter: 'p1', xp: 1 }], { pid: 'p2' });
  assert.equal(currentStep(s, 'p1').id, TUTORIAL.fields[1].id);
  actOk(s, 'tutSkip', {}, { pid: 'p1' });
  assert.equal(currentStep(s, 'p1').id, TUTORIAL.fields[2].id);
  actOk(s, 'tutSwap', {}, { pid: 'p1' });
  assert.equal(s.players.p1.tut.track, 'barnyard');
  assert.equal(s.players.p2.tut.track, 'fields');
  actOk(s, 'tutSkip', { all: 'yes' }, { pid: 'p2' });
  assert.equal(currentStep(s, 'p2'), null);
  assert.equal(act(s, 'tutSkip', {}, { pid: 'p2' }).code, ERR.ALREADY_DONE);
  valid(s);
});

test('tutorial: a solo player gets both tracks one after the other; farm steps take the client-only marks', () => {
  const s = makeFarm({ players: ['p1'] });
  assert.equal(currentFarmStep(s).step.id, 'welcome');
  assert.equal(act(s, 'tutDone', { step: 'name_farm' }).code, ERR.NOT_FOUND);
  actOk(s, 'tutDone', { step: 'welcome' });
  actOk(s, 'nameFarm', { name: 'Hollow Two' });                    // naming is the deed of the next step
  assert.equal(currentFarmStep(s).step.id, TUTORIAL.together[0].id);
  const r = actOk(s, 'tutDone', { step: TUTORIAL.together[0].id });   // any farm step can be skipped
  assert.equal(evs(r, 'tutorialStep')[0].skipped, true);
  assert.equal(currentFarmStep(s).step.id, TUTORIAL.together[1].id);
  credit(s, [{ e: 'planted', id: 'home.0.0', crop: 'wheat' }]);
  assert.equal(s.players.p1.tut.track, 'fields');
  for (let i = 0; i < TUTORIAL.fields.length; i++) actOk(s, 'tutSkip', {});
  assert.equal(s.players.p1.tut.track, 'barnyard', 'the other track follows');
  assert.equal(s.farm.tut.fin.fields, 'p1');
});

test('the recap lists what the partner did while I was away, oldest first', () => {
  const s = farmAt(3);
  s.players.p1.lastSeenAt = T0;
  credit(s, [{ e: 'harvested', id: 'home.0.0', crop: 'wheat', qty: 2, planter: 'p2', xp: 1 }], { pid: 'p2', now: T0 + HOUR });
  credit(s, [{ e: 'sold', item: 'wheat', qty: 2, coins: 4 }], { pid: 'p2', now: T0 + 2 * HOUR });
  credit(s, [{ e: 'sold', item: 'wheat', qty: 2, coins: 4 }], { pid: 'p1', now: T0 + 3 * HOUR });
  const r = recap(s, 'p1', T0 + 4 * HOUR);
  const did = r.sections.find((x) => x.name === 'partnerDid');
  assert.deepEqual(did.items.map((x) => x.k), ['harvest', 'sell']);
});

test('tutorial: a step keyed to a finished story card completes for whoever is on it (the partner did the deed)', () => {
  const s = makeFarm();
  credit(s, [{ e: 'cleared', id: 'w', def: 'weed', xp: 1, coins: 5 }], { pid: 'p2' });
  assert.equal(s.players.p2.tut.track, 'barnyard');
  const keyed = TUTORIAL.barnyard.findIndex((st) => st.quest);
  const quest = TUTORIAL.barnyard[keyed].quest;
  s.players.p2.tut = { ...s.players.p2.tut, i: keyed, n: 0 };
  s.farm.quests.done[quest] = s.farm.quests.done[quest] ?? T0;   // p1 finished that card's deeds
  credit(s, [{ e: 'planted', id: 'home.0.0', crop: 'wheat' }], { pid: 'p1' });
  const now = currentStep(s, 'p2');
  assert.ok(!now || now.quest !== quest, `p2 moved past every step of ${quest} (now ${now && now.id})`);
  valid(s);
});

test('sit needs the avatar at the bench: 10 tiles away answers TOO_FAR, server-observed (RC-31)', async () => {
  const { act: run2 } = await import('./helpers/rules-goals.js');
  const s = farmAt(4);
  const bench = put(s, 'sunset_bench');
  assert.equal(run2(s, 'sit', { id: bench }, { ext: { near: 100 } }).code, 'TOO_FAR');
  assert.equal(run2(s, 'sit', { id: bench }, { ext: { near: 25 } }).ok, true);
  assert.equal(run2(s, 'sit', { id: bench }, { pid: 'p2' }).ok, true, 'no server fact (a prediction): allowed');
});
