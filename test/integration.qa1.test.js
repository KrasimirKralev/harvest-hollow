// Wave-1 QA integration: the cross-lane patches the lead applied (docs/agent-notes/integration-qa1.md). One test per
// note; the lanes' own regressions live in rules.wave1*.test.js, server.qa1.test.js, sync.*.test.js, ui-wave1.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, SOFT } from '../shared/net/protocol.js';
import { SLOT_COLORS } from '../shared/content/config.js';
import { xpForLevel, DAILY_GIFT } from '../shared/content/index.js';
import { dueSystemActions } from '../shared/rules/system.js';
import { dayOf } from '../shared/rules/coop.js';
import { makeFarm, sys, run, must, T0 } from './helpers.js';

const HOUR = 3_600_000;

test('protocol: TOO_FAR is a hard code, PRICE a soft one (a resend may carry confirm: [PRICE])', () => {
  assert.equal(ERR.TOO_FAR, 'TOO_FAR');
  assert.equal(ERR.PRICE, 'PRICE');
  assert.ok(SOFT.has(ERR.PRICE));
  assert.ok(!SOFT.has(ERR.TOO_FAR));
});

test('SV-01: _seen {at} stamps the moment the player left, never the future, never backwards', () => {
  const s = makeFarm({ now: T0 - HOUR });
  assert.equal(sys(s, '_seen', { pid: 'p1', at: T0 + 5_000 }, T0).code, ERR.BAD_ARGS, 'no future');
  assert.ok(sys(s, '_seen', { pid: 'p1', at: T0 - 10_000 }, T0).ok);
  assert.equal(s.players.p1.lastSeenAt, T0 - 10_000);
  assert.ok(sys(s, '_seen', { pid: 'p1', at: T0 - 60_000 }, T0 + 1_000).ok);
  assert.equal(s.players.p1.lastSeenAt, T0 - 10_000, 'an older `at` never moves it back');
  assert.ok(sys(s, '_seen', { pid: 'p1' }, T0 + 2_000).ok);
  assert.equal(s.players.p1.lastSeenAt, T0 + 2_000, 'without `at` it is now (old journal lines replay unchanged)');
});

test('SV-04: a farm zone moved west never re-opens the day: no second Daily Gift, no rollover', () => {
  const s = makeFarm();
  s.meta.tz = 'Pacific/Kiritimati';                   // UTC+14
  s.farm.xp = xpForLevel(Math.max(DAILY_GIFT.unlock, 5));
  const now = T0 + 6 * HOUR;
  for (const a of dueSystemActions(s, now)) sys(s, a.type, a.args, now);
  must(s, 'claimGift', {}, { now });
  const day = s.farm.daily.day;
  assert.equal(day, dayOf(s, now));
  s.meta.tz = 'Pacific/Pago_Pago';                    // UTC-11: the same moment is a day earlier
  assert.ok(dayOf(s, now) < day);
  assert.deepEqual(dueSystemActions(s, now).filter((a) => a.type === '_rollover'), [], 'no rollover backwards');
  assert.equal(run(s, 'claimGift', {}, { now }).code, ERR.ALREADY_DONE, 'yesterday\'s gift is not claimable again');
  // the new zone catches up: a later day rolls over as usual
  const later = now + 2 * 24 * HOUR;
  assert.ok(dueSystemActions(s, later).some((a) => a.type === '_rollover'));
});

test('UI-04: tutRestart brings back a skipped guide; nothing is paid, so it cannot be farmed', () => {
  const s = makeFarm();
  assert.equal(run(s, 'tutRestart', {}).code, ERR.ALREADY_DONE, 'a guide that has not started has nothing to restart');
  must(s, 'tutSkip', { all: 'yes' });
  assert.equal(s.players.p1.tut.skip, true);
  const coins = s.farm.wallet.coins;
  const xp = s.farm.xp;
  must(s, 'tutRestart', {});
  assert.deepEqual(s.players.p1.tut, { track: null, i: 0, n: 0, skip: false });
  assert.equal(s.farm.wallet.coins, coins);
  assert.equal(s.farm.xp, xp);
  assert.equal(run(s, 'tutRestart', {}).code, ERR.ALREADY_DONE);
});

test('UI-05: two farmers never share a colour, even when both pick it at the same moment', () => {
  const s = makeFarm({ players: [] });
  assert.ok(sys(s, '_join', { pid: 'p1', name: 'Rowan', color: '#AA3366' }).ok);
  assert.ok(sys(s, '_join', { pid: 'p2', name: 'Mia', color: '#aa3366' }).ok, 'the late claim is not refused');
  assert.equal(s.players.p1.color, '#AA3366');
  assert.notEqual(s.players.p2.color.toUpperCase(), '#AA3366');
  assert.equal(s.players.p2.color, SLOT_COLORS.p2);
  // with no colour asked for, the slot's own (or the first free slot colour)
  const t = makeFarm({ players: [] });
  assert.ok(sys(t, '_join', { pid: 'p1', name: 'Rowan', color: SLOT_COLORS.p2 }).ok);
  assert.ok(sys(t, '_join', { pid: 'p2', name: 'Mia' }).ok);
  assert.equal(t.players.p2.color, SLOT_COLORS.p1);
});

test('CL-01 / RD-15: the world tooltip says who sits on a bench and who watered a crop, for THIS viewer', async () => {
  const { worldTip } = await import('../public/js/ui/hud.js');
  const { farmAt, placeDef } = await import('./helpers/rules.js');
  const s = farmAt(8);
  const bench = placeDef(s, 'sunset_bench');
  must(s, 'sit', { id: bench }, { pid: 'p1' });
  assert.ok(worldTip(s, { kind: 'object', id: bench }, T0, 'p2').lines.includes('Rowan is waiting on the bench. Sit together'));
  assert.ok(worldTip(s, { kind: 'object', id: bench }, T0, 'p1').lines.includes('You are sitting here. Click to stand up'));
  const plot = Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'plot' && !s.farm.objects[k].crop);
  must(s, 'plant', { id: plot, crop: 'strawberry' }, { pid: 'p1' });
  assert.ok(worldTip(s, { kind: 'object', id: plot }, T0 + 1000, 'p2').lines.some((l) => /^Needs water/.test(l)));
  must(s, 'water', { id: plot }, { pid: 'p1', now: T0 + 1000 });
  assert.ok(worldTip(s, { kind: 'object', id: plot }, T0 + 2000, 'p2').lines.includes('Watered by Rowan · -15 %'));
});
