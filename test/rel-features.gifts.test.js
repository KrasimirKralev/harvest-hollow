// Release 1.0, D1 Surprise gifts (features#F1, astra#A; trimmed by critique#29; M30): a keepsake now waits WRAPPED in
// front of the farmhouse porch until its recipient opens it; a box nobody opens goes to the shelf by itself after two
// days (`_gift`, catch-up safe); no Hearts anywhere; one waiting box per giver; the backfill gives old saves
// `farm.gifts`. RED on fdafb9c: `openGift` / `_gift` do not exist and `keepsake` put the good straight on the shelf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { COOP } from '../shared/content/index.js';
import { createFarm, validateState } from '../shared/rules/state.js';
import { dueSystemActions, nextSystemDueAt } from '../shared/rules/system.js';
import { giftSpot } from '../shared/rules/actions/coop.js';
import { recap, feedRows } from '../shared/rules/feed.js';
import { goals } from '../shared/rules/goals.js';
import { backfill } from '../server/migrations.js';
import { resetGrid } from '../shared/rules/grid.js';
import { farmAt, give, act, actOk, evs, valid, runDue, sys, T0, HOUR, DAY, MIN } from './helpers/rules-goals.js';

const hearts = (s) => [s.players.p1.hearts, s.players.p2.hearts];

/** p1 wraps a Rose for p2 (with a note); returns the gift id. */
function wrap(s, o = {}) {
  give(s, 'rose', 1);
  const r = actOk(s, 'keepsake', { item: 'rose', note: 'for you', ...o }, { pid: 'p1', now: o.now ?? T0 });
  return evs(r, 'keepsake')[0].id;
}

test('keepsake wraps the good in a gift box in front of the porch: farm.gifts + the box, no shelf, no Hearts, no coins', () => {
  const s = farmAt(14);
  const coins = s.farm.wallet.coins;
  const h0 = hearts(s);
  const spot = giftSpot(s);
  assert.ok(spot, 'the porch has room');
  const id = wrap(s);
  assert.deepEqual(s.farm.gifts[id], { by: 'p1', to: 'p2', item: 'rose', at: T0, note: 'for you' });
  assert.deepEqual(s.farm.objects[id], { def: COOP.keepsake.def, x: spot.x, z: spot.z, rot: 0, placedAt: T0, by: 'p1' });
  assert.equal(s.players.p2.shelf.n, 0, 'not on the shelf until opened');
  assert.deepEqual(hearts(s), h0, 'no Hearts for wrapping (M30)');
  assert.equal(s.farm.wallet.coins, coins, 'no coins (C9)');
  // the feed line says a surprise was left, never what is inside
  const row = feedRows(s).map(([, r]) => r).find((r) => r.k === 'surprise');
  assert.deepEqual({ what: row.what, to: row.to, item: row.item }, { what: 'left', to: 'p2', item: undefined });
  valid(s);
});

test('openGift: only the recipient (SELF_ONLY for the giver), onto the shelf with the note, a Memory Book page, no Hearts (M30)', () => {
  const s = farmAt(14);
  const id = wrap(s);
  const h0 = hearts(s);
  assert.equal(act(s, 'openGift', { id }, { pid: 'p1', now: T0 + MIN }).code, ERR.SELF_ONLY);
  assert.equal(act(s, 'openGift', { id: 'gift.p9.0' }, { pid: 'p2', now: T0 + MIN }).code, ERR.NOT_FOUND);
  const pages = s.farm.memory.n;
  const r = actOk(s, 'openGift', { id }, { pid: 'p2', now: T0 + MIN });
  const ev = evs(r, 'giftOpened')[0];
  assert.equal(ev.item, 'rose');
  assert.equal(ev.from, 'p1');
  assert.equal(ev.note, 'for you');
  assert.equal(s.farm.gifts[id], undefined);
  assert.equal(s.farm.objects[id], undefined, 'the box is gone');
  assert.equal(s.players.p2.shelf.n, 1);
  assert.deepEqual(s.players.p2.shelf.rows['0'], { at: T0 + MIN, by: 'p1', item: 'rose', note: 'for you' });
  assert.deepEqual(hearts(s), h0, 'opening a gift leaves hearts unchanged (M30)');
  assert.equal(s.farm.memory.n, pages + 1, 'a Memory Book page');
  assert.ok(Object.values(s.farm.memory.rows).some((x) => x.k === 'gift' && x.ref === 'rose' && x.by === 'p1'));
  const row = feedRows(s).map(([, x]) => x).find((x) => x.k === 'surprise' && x.what === 'opened');
  assert.equal(row.item, 'rose');
  assert.equal(row.from, 'p1');
  valid(s);
});

test('one waiting box per giver: the next day\'s gift shelves the older box first (nothing lost, never a refusal a pre-1.0 line could hit: M26)', () => {
  const s = farmAt(14);
  const first = wrap(s);
  give(s, 'rose', 2);
  assert.equal(act(s, 'keepsake', { item: 'rose' }, { pid: 'p1', now: T0 + HOUR }).code, ERR.COOLDOWN, 'once a day');
  const r = actOk(s, 'keepsake', { item: 'rose' }, { pid: 'p1', now: T0 + DAY });
  const second = evs(r, 'keepsake')[0].id;
  assert.notEqual(second, first);
  assert.equal(s.farm.gifts[first], undefined, 'the older box went to the shelf');
  assert.equal(s.farm.objects[first], undefined);
  assert.equal(s.players.p2.shelf.rows['0'].item, 'rose');
  assert.equal(Object.values(s.farm.gifts).filter((g) => g.by === 'p1').length, 1, 'one waiting box per giver');
  const r2 = actOk(s, 'keepsake', { item: 'rose' }, { pid: 'p2', now: T0 + DAY });
  assert.equal(Object.keys(s.farm.gifts).length, 2, 'two boxes wait, one from each');
  assert.equal(evs(r2, 'keepsake')[0].to, 'p1');
  valid(s);
});

test('a walled-in porch: the gift goes straight onto the shelf (as before 1.0), never a refusal', () => {
  const s = farmAt(14);
  let spot;
  while ((spot = giftSpot(s))) {
    s.farm.objects[`wall.${spot.x}.${spot.z}`] = { def: 'garden_gnome', x: spot.x, z: spot.z, rot: 0, placedAt: T0, by: 'p1' };
    resetGrid(s);
  }
  give(s, 'rose', 1);
  const r = actOk(s, 'keepsake', { item: 'rose' }, { pid: 'p1' });
  assert.equal(evs(r, 'keepsake')[0].shelf, true);
  assert.deepEqual(s.farm.gifts, {});
  assert.equal(s.players.p2.shelf.rows['0'].item, 'rose');
});

test('a note is at most COOP.keepsake.noteMax characters and never blank', () => {
  const s = farmAt(14);
  give(s, 'rose', 3);
  assert.equal(act(s, 'keepsake', { item: 'rose', note: 'x'.repeat(COOP.keepsake.noteMax + 1) }).code, ERR.BAD_ARGS);
  assert.equal(act(s, 'keepsake', { item: 'rose', note: '   ' }).code, ERR.BAD_ARGS);
  assert.ok(act(s, 'keepsake', { item: 'rose', note: 'x'.repeat(COOP.keepsake.noteMax) }).ok);
});

test('_gift: a box nobody opened for two days goes to the shelf by itself, catch-up after downtime, nothing lost', () => {
  const s = farmAt(14);
  const id = wrap(s);
  assert.deepEqual(dueSystemActions(s, T0 + COOP.keepsake.shelfMs - 1).filter((d) => d.type === '_gift'), []);
  assert.equal(nextSystemDueAt(s, T0 + HOUR) <= T0 + COOP.keepsake.shelfMs, true, 'the server arms a timer for it');
  // the server was off for a week: the boot's catch-up shelves it once
  const ran = runDue(s, T0 + 7 * DAY);
  assert.ok(ran.includes('_gift'));
  assert.equal(s.farm.gifts[id], undefined);
  assert.equal(s.farm.objects[id], undefined);
  assert.equal(s.players.p2.shelf.n, 1);
  assert.equal(s.players.p2.shelf.rows['0'].item, 'rose');
  const row = feedRows(s).map(([, x]) => x).find((x) => x.k === 'surprise' && x.what === 'shelved');
  assert.equal(row.by, 'sys');
  assert.equal(sys(s, '_gift', {}, T0 + 8 * DAY).code, ERR.ALREADY_DONE, 'nothing left to do');
  valid(s);
});

test('the recap shows the surprise waiting on the porch for its recipient only, first; the opened one is not listed', () => {
  const s = farmAt(14);
  s.players.p2.lastSeenAt = T0 - HOUR;
  const id = wrap(s);
  const r2 = recap(s, 'p2', T0 + MIN);
  assert.equal(r2.sections[0].name, 'surprises');
  assert.deepEqual(r2.sections[0].items, [{ id, by: 'p1', at: T0 }]);
  assert.equal(JSON.stringify(r2.sections[0]).includes('rose'), false, 'what is inside stays a surprise');
  s.players.p1.lastSeenAt = T0 - HOUR;
  assert.ok(!recap(s, 'p1', T0 + MIN).sections.some((x) => x.name === 'surprises'), 'the giver sees no box for them');
  actOk(s, 'openGift', { id }, { pid: 'p2', now: T0 + 2 * MIN });
  assert.ok(!recap(s, 'p2', T0 + 3 * MIN).sections.some((x) => x.name === 'surprises'));
});

test('validateState: a gift needs its box and the box its gift; one waiting box per giver', () => {
  const s = farmAt(14);
  const id = wrap(s);
  const box = s.farm.objects[id];
  delete s.farm.objects[id];
  assert.ok(validateState(s).some((m) => m.includes(`farm.gifts.${id}`)));
  s.farm.objects[id] = box;
  const g = s.farm.gifts[id];
  delete s.farm.gifts[id];
  assert.ok(validateState(s).some((m) => m.includes('a gift box with no gift')));
  s.farm.gifts[id] = g;
  assert.deepEqual(validateState(s), []);
});

test('backfill: a save from before 1.0 (no farm.gifts) gets an empty one and stays valid; coop.born stays absent', () => {
  const s = farmAt(21);
  delete s.farm.gifts;
  delete s.farm.coop.born;
  delete s.farm.coop.days;
  assert.ok(validateState(s).some((m) => m.includes('gifts')), 'a missing key is reported');
  const filled = backfill(s, { now: T0, tz: s.meta.tz });
  assert.ok(filled.includes('farm.gifts'));
  assert.deepEqual(s.farm.gifts, {});
  assert.equal(s.farm.coop.born, undefined, 'the backfill never looks inside farm.coop: the save stays "before 1.0"');
  assert.deepEqual(validateState(s), []);
  const fresh = createFarm(1, T0);
  assert.equal(typeof fresh.farm.coop.born, 'number', 'a 1.0 farm records the rules it was born under');
});

test('the gift box is not a NOW chore for the giver; the recipient sees no tracker card for it (the box itself speaks)', () => {
  const s = farmAt(14);
  wrap(s);
  for (const pid of ['p1', 'p2']) assert.notEqual(goals(s, pid, T0 + MIN).now.kind, 'gift');
});
