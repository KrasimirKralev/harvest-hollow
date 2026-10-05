// "Finish now" for growing crops (live requests 2026-10-04): ui/crop-hurry.js quotes exactly what the rules' `hurry`
// would charge for one plot and for every growing plot of a crop, and finishField asks ONE "are you sure?" for a
// big batch (the rules' BIG_SPEND), then sends one hurry per plot that the rules accept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { BOOSTS, cropOf } from '../shared/content/index.js';
import { hurryCost } from '../shared/rules/actions/boosts.js';
import { dayIndex } from '../shared/rules/calendar.js';
import { plotHurry, fieldHurry, hurryReason, finishField, fieldLabel, plotsOf } from '../public/js/ui/crop-hurry.js';
import { farmAt, run, must, T0, MIN, HOUR } from './helpers/rules.js';

const plotsIn = (s) => Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'plot').sort();

/** A level-12 farm with `n` plots of `crop` planted at T0 (and one of Wheat). */
function field(crop = 'strawberry', n = 4, { acorns = 50, level = 12 } = {}) {
  const s = farmAt(level, { acorns });
  const ids = plotsIn(s);
  for (const id of ids.slice(0, n)) must(s, 'plant', { id, crop }, { now: T0 });
  must(s, 'plant', { id: ids[n], crop: 'wheat' }, { now: T0 });
  return { s, ids: ids.slice(0, n), wheat: ids[n] };
}

test('plotHurry: the rules\' own price and verdict for one growing plot; nothing for an empty or ripe one', () => {
  const { s, ids, wheat } = field('potato', 2);        // 4 h
  const m = plotHurry(s, ids[0], T0 + 30 * MIN, 'p1');
  assert.equal(m.crop, 'potato');
  assert.equal(m.name, 'Potato');
  assert.equal(m.acorns, hurryCost(cropOf('potato').growMs - 30 * MIN));
  assert.equal(m.acorns, 4);
  assert.equal(m.code, null);
  assert.equal(plotHurry(s, wheat, T0 + 2 * MIN, 'p1'), null, 'ripe wheat: nothing to finish');
  assert.equal(plotHurry(s, plotsIn(s).at(-1), T0, 'p1'), null, 'an empty plot');
  assert.equal(plotHurry(s, 'no.such.plot', T0, 'p1'), null);
  // what it says is what the rules do
  const r = must(s, 'hurry', { id: ids[0] }, { now: T0 + 30 * MIN });
  assert.equal(r.tx.events.find((e) => e.e === 'hurried').acorns, m.acorns);
  assert.equal(plotHurry(s, ids[0], T0 + 30 * MIN, 'p1'), null, 'finished: ripe now');
});

test('plotHurry: locked below the Hurry level, short of Acorns, and a big spend asks first', () => {
  const low = field('strawberry', 1, { level: BOOSTS.hurry.unlock - 1 });
  assert.equal(plotHurry(low.s, low.ids[0], T0, 'p1').code, ERR.LOCKED);
  assert.equal(hurryReason(ERR.LOCKED), `Finish now opens at level ${BOOSTS.hurry.unlock}`);
  const poor = field('potato', 1, { acorns: 1 });
  const m = plotHurry(poor.s, poor.ids[0], T0, 'p1');
  assert.equal(m.code, ERR.NO_ACORNS);
  assert.equal(hurryReason(m.code, { acorns: m.acorns, wallet: 1 }), 'Need 3 more Acorns');
  // 9 Acorns spent today already: one more is the partner's heads-up (SAFETY.bigSpend.acornsPerPlayerDay)
  const big = field('strawberry', 1);
  big.s.players.p1.acornDay = { day: dayIndex(T0, big.s.meta.tz), n: 9 };
  assert.equal(plotHurry(big.s, big.ids[0], T0, 'p1').code, ERR.BIG_SPEND);
  assert.equal(hurryReason(ERR.BIG_SPEND), '', 'a big spend is allowed: it asks on the click');
});

test('fieldHurry: every growing plot of the crop, once each, with the total; other crops and ripe plots stay out', () => {
  const { s, ids } = field('strawberry', 4);
  const f = fieldHurry(s, 'strawberry', T0 + 10 * MIN, 'p1');
  assert.deepEqual(f.ids, ids);
  assert.equal(f.plots, 4);
  assert.equal(f.acorns, 4);
  assert.equal(f.code, null);
  assert.equal(f.big, false);
  assert.equal(fieldLabel(f), 'Finish all growing Strawberries (4 plots · 4 Acorns)');
  assert.equal(plotsOf(1, 'Potato'), '1 Potato plot');
  must(s, 'hurry', { id: ids[0] }, { now: T0 + 10 * MIN });
  assert.deepEqual(fieldHurry(s, 'strawberry', T0 + 10 * MIN, 'p1').ids, ids.slice(1), 'a finished plot drops out');
  assert.equal(fieldHurry(s, 'wheat', T0 + 10 * MIN, 'p1').code, ERR.EMPTY, 'ripe wheat: nothing left growing');
  // potatoes: 4 Acorns each, 3 plots = 12: a big spend for one go
  const p = field('potato', 3);
  const fp = fieldHurry(p.s, 'potato', T0, 'p1');
  assert.equal(fp.acorns, 12);
  assert.equal(fp.big, true);
  assert.equal(fp.code, ERR.BIG_SPEND);
  const poor = field('potato', 3, { acorns: 5 });
  const fq = fieldHurry(poor.s, 'potato', T0, 'p1');
  assert.equal(fq.code, ERR.NO_ACORNS);
  assert.equal(hurryReason(fq.code, fq), 'Need 7 more Acorns');
});

/** The ui half without a browser: the real rules behind a fake store, controller and dialog. */
function harness(s, { now, answer = true } = {}) {
  const sent = [];
  const asked = [];
  const toasts = [];
  const store = { state: s, pid: 'p1', now: () => now };
  const controller = {
    do(type, args) {
      sent.push({ type, args });
      const r = run(s, type, args, { now });
      return r.ok ? { ok: true } : { ok: false, code: r.code };
    },
  };
  const ui = { confirm: async (o) => { asked.push(o); return answer; }, toast: (t) => toasts.push(t) };
  return { S: { store, controller, ui }, sent, asked, toasts };
}

test('finishField: a small batch goes straight out, one hurry per plot, and every plot is ripe', async () => {
  const { s, ids } = field('strawberry', 4);
  const now = T0 + 10 * MIN;
  const h = harness(s, { now });
  const a0 = s.farm.wallet.acorns;
  const r = await finishField(h.S, 'strawberry');
  assert.equal(h.asked.length, 0, 'four Acorns: no "are you sure?"');
  assert.deepEqual(h.sent, ids.map((id) => ({ type: 'hurry', args: { id } })));
  assert.deepEqual(r, { ok: true, done: 4, acorns: 4 });
  assert.equal(a0 - s.farm.wallet.acorns, 4);
  for (const id of ids) assert.equal(s.farm.objects[id].crop.readyAt, now);
  assert.deepEqual(h.toasts, ['4 Strawberry plots ready to harvest!']);
});

test('finishField: a big batch asks once with the whole price; yes sends every hurry confirmed, no sends nothing', async () => {
  const no = field('potato', 3);
  const hn = harness(no.s, { now: T0, answer: false });
  const rn = await finishField(hn.S, 'potato');
  assert.equal(hn.asked.length, 1);
  assert.deepEqual(hn.asked[0].cost, { acorns: 12 });
  assert.equal(hn.asked[0].lead, 'Finish 3 Potato plots now?');
  assert.match(hn.asked[0].body, /^That is 12 Acorns from the farm's shared stash/);
  assert.equal(hn.sent.length, 0);
  assert.equal(rn.ok, false);

  const yes = field('potato', 3);
  const hy = harness(yes.s, { now: T0 });
  const ry = await finishField(hy.S, 'potato');
  assert.equal(hy.asked.length, 1);
  assert.deepEqual(hy.sent.map((x) => x.args), yes.ids.map((id) => ({ id, confirm: [ERR.BIG_SPEND] })));
  assert.deepEqual(ry, { ok: true, done: 3, acorns: 12 });
  for (const id of yes.ids) assert.equal(yes.s.farm.objects[id].crop.readyAt, T0);
});

test('finishField: short of Acorns or below the Hurry level it explains and sends nothing', async () => {
  const poor = field('potato', 3, { acorns: 5 });
  const h = harness(poor.s, { now: T0 });
  const r = await finishField(h.S, 'potato');
  assert.equal(r.code, ERR.NO_ACORNS);
  assert.deepEqual(h.toasts, ['Need 7 more Acorns']);
  assert.equal(h.sent.length, 0);
  const low = field('strawberry', 2, { level: BOOSTS.hurry.unlock - 1 });
  const hl = harness(low.s, { now: T0 });
  assert.equal((await finishField(hl.S, 'strawberry')).code, ERR.LOCKED);
  assert.equal(hl.sent.length, 0);
});

test('finishField: plots planted while the card was open are not added to what was agreed', async () => {
  const { s, ids } = field('potato', 3);
  const free = plotsIn(s).filter((id) => !s.farm.objects[id].crop);
  const h = harness(s, { now: T0 + MIN });
  h.S.ui.confirm = async (o) => {
    h.asked.push(o);
    must(s, 'plant', { id: free[0], crop: 'potato' }, { now: T0 + MIN, pid: 'p2' });   // the partner plants one more
    return true;
  };
  const r = await finishField(h.S, 'potato');
  assert.equal(h.asked.length, 1, '12 Acorns: asked once');
  assert.equal(r.done, 3);
  assert.deepEqual(h.sent.map((x) => x.args.id), ids);
  assert.ok(s.farm.objects[free[0]].crop.readyAt > T0 + MIN, 'the new plot still grows');
});

test('the feed and the Journal say a crop was finished early, not "a batch"', async () => {
  const { feedText } = await import('../public/js/ui/feed.js');
  const s = farmAt(12);
  assert.equal(feedText({ k: 'buy', what: 'hurry', def: 'plot', a: 6, by: 'p1' }, s, 'p1').text, 'finished crops early for 6 Acorns');
  assert.equal(feedText({ k: 'buy', what: 'hurry', def: 'bakery', a: 1, by: 'p1' }, s, 'p1').text, 'hurried a batch for 1 Acorn');
});

test('finishField: under 10 Acorns but over the day\'s heads-up line, the card says so', async () => {
  const { s, ids } = field('strawberry', 4);
  s.players.p1.acornDay = { day: dayIndex(T0, s.meta.tz), n: 7 };
  const h = harness(s, { now: T0 + MIN });
  await finishField(h.S, 'strawberry');
  assert.equal(h.asked.length, 1);
  assert.equal(h.asked[0].body, 'That makes 11 Acorns you spent today (Mia gets a heads-up from 10): one per started hour on each plot.');
  assert.deepEqual(h.sent.map((x) => x.args.id), ids);
});
