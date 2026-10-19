// Release 1.0, M29 (critique#16, #32, #34): every one-time introduction of something new is a card of the existing
// rules drip (`nextSystemCard`: one card per DRIP_FEED.minGapMs of a farmer's play, once per farmer), never a client
// queue: "New in 1.0" (a save from before 1.0 at L5+; it replaces the gift introduction there), the gift
// intro, "Meet Harvey" (after the coach retires, only where the server offers Harvey) and the brush tip (after a 1 x 1
// harvest stroke of 20+ plots while a bigger sickle waits unbought). RED on fdafb9c: none of these cards existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT, DRIP_FEED, TUTORIAL } from '../shared/content/index.js';
import { nextSystemCard } from '../shared/rules/actions/social.js';
import { coachRetired } from '../shared/rules/actions/tutorial.js';
import { farmAt, actOk, T0, MIN } from './helpers/rules-goals.js';
import EN from '../public/js/i18n/en/feat.js';
import BG from '../public/js/i18n/bg/feat.js';

const NEW = ['new_1_0', 'gift_intro', 'meet_harvey', 'brush_tip'];
const GAP = DRIP_FEED.minGapMs / MIN;

/** Every card that existed before 1.0 already seen by both farmers (the owners' save: they have toured them all). */
function toured(s) {
  for (const p of Object.values(s.players)) {
    for (const f of CONTENT.features.values()) if (f.card && !NEW.includes(f.id)) p.seen.cards[f.id] = 1;
    p.play.card = p.play.n;
  }
  return s;
}

/**
 * Two farmers play `minutes` of minutes each (the client asks every minute, as maybeSystemCard does every 15 s); a
 * card shown is marked seen at once (its "Got it"). Returns [{ pid, id, minute }].
 */
function play(s, minutes, opts = { helper: true }) {
  const shown = [];
  for (let m = 1; m <= minutes; m++) {
    for (const pid of ['p1', 'p2']) {
      s.players[pid].play.n += 1;
      const id = nextSystemCard(s, pid, opts);
      if (!id) continue;
      actOk(s, 'markSeen', { kind: 'card', id }, { pid, now: T0 + m * MIN });
      shown.push({ pid, id, minute: s.players[pid].play.n });
    }
  }
  return shown;
}

test('a save from before 1.0 (L21, no farm.coop.born): "New in 1.0", then "Meet Harvey", 20 minutes of play apart, once each', () => {
  const s = toured(farmAt(21));
  delete s.farm.coop.born;
  s.players.p1.stats.bestHarvestStroke = 43;              // the owners' best stroke: the brush tip would be due
  const shown = play(s, 120);
  for (const pid of ['p1', 'p2']) {
    const mine = shown.filter((x) => x.pid === pid);
    const ids = mine.map((x) => x.id).filter((id) => NEW.includes(id));
    assert.deepEqual(ids.slice(0, 2), ['new_1_0', 'meet_harvey'], pid);
    assert.ok(!ids.includes('gift_intro'), `${pid}: "New in 1.0" replaces the gift intro`);
    // QA r2 F2-06: the brush tip still comes to a pre-1.0 farm, after its farmer's long stroke (p1's 43 plots)
    assert.deepEqual(ids.filter((id) => id === 'brush_tip'), pid === 'p1' ? ['brush_tip'] : [], `${pid}: the brush tip`);
    assert.equal(new Set(mine.map((x) => x.id)).size, mine.length, `${pid}: each at most once`);
    for (let i = 1; i < mine.length; i++) {
      assert.ok(mine[i].minute - mine[i - 1].minute >= GAP, `${pid}: ${mine[i - 1].id} then ${mine[i].id} within ${GAP} min`);
    }
  }
});

test('a farm born under 1.0: the gift intro with two farmers (never "New in 1.0"); the brush tip after a 20-plot stroke', () => {
  const s = toured(farmAt(14));
  assert.equal(typeof s.farm.coop.born, 'number');
  let shown = play(s, 60, { helper: false });
  assert.ok(!shown.some((x) => x.id === 'new_1_0'));
  assert.ok(shown.some((x) => x.pid === 'p1' && x.id === 'gift_intro'));
  assert.ok(!shown.some((x) => x.id === 'meet_harvey'), 'no Harvey card where the server offers no Harvey');
  assert.ok(!shown.some((x) => x.id === 'brush_tip'), 'no long stroke yet');
  s.players.p2.stats.bestHarvestStroke = 24;
  shown = play(s, 60, { helper: false });
  assert.deepEqual(shown.filter((x) => x.id === 'brush_tip').map((x) => x.pid), ['p2']);
  s.farm.tools = { wide_sickle: { at: T0, by: 'p1' }, grand_sickle: { at: T0, by: 'p1' } };
  s.players.p1.stats.bestHarvestStroke = 30;
  assert.ok(!play(s, 60, { helper: false }).some((x) => x.id === 'brush_tip'), 'every bigger sickle bought: no tip');
});

test('a solo farm gets no gift intro; "Meet Harvey" waits for the coach to retire (L6 or 45 minutes of play)', () => {
  const s = toured(farmAt(3, { players: ['p1'] }));
  assert.equal(nextSystemCard(s, 'p1', { helper: true }), null);
  assert.equal(coachRetired(s, 'p1'), false);
  s.players.p1.play.n = TUTORIAL.retire.playMin;
  assert.equal(coachRetired(s, 'p1'), true);
  assert.equal(nextSystemCard(s, 'p1', { helper: true }), 'meet_harvey');
});

test('no two introductions on the same play-minute, and every drip card has its words in English and Bulgarian', () => {
  const s = toured(farmAt(21));
  delete s.farm.coop.born;
  const shown = play(s, 120);
  const byMinute = new Map();
  for (const x of shown) {
    const k = `${x.pid}:${x.minute}`;
    assert.ok(!byMinute.has(k), `two cards at ${k}`);
    byMinute.set(k, x.id);
  }
  for (const f of CONTENT.features.values()) {
    if (!f.drip) continue;
    assert.ok(f.card && f.card.key && f.shop === false, f.id);
    for (const part of ['title', 'text', ...(f.card.touchText ? ['touchText'] : [])]) {
      assert.ok(EN[`${f.card.key}.${part}`], `${f.id} ${part} EN`);
      assert.ok(BG[`${f.card.key}.${part}`] && /[а-я]/i.test(BG[`${f.card.key}.${part}`]), `${f.id} ${part} BG`);
    }
  }
});

test('coachRetired: a farmer who FINISHED both tracks still hears the together steps (not retired); a real skip is (ui-shell P-03)', () => {
  const s = toured(farmAt(3));
  s.players.p1.play.n = 10;
  s.players.p1.tut = { track: null, i: 0, n: 0, skip: true };
  s.farm.tut.fin = { fields: 'p1', barnyard: 'p1' };
  assert.equal(coachRetired(s, 'p1'), false, 'finished, not skipped');
  assert.notEqual(nextSystemCard(s, 'p1', { helper: true }), 'meet_harvey', 'so Harvey waits: one voice');
  s.farm.tut.fin = {};
  assert.equal(coachRetired(s, 'p1'), true, '"I know farming"');
});

test('ui-shell #27 (P-09): the uproot card waits for a crop of yours planted under 10 minutes ago', async () => {
  const { SAFETY } = await import('../shared/content/index.js');
  const s = farmAt(1);
  const p = s.players.p1;
  p.seen = { ...(p.seen ?? {}), cards: { market: 1, barn: 1, debris: 1 } };
  p.play = { ...p.play, n: 100, card: 0 };
  assert.notEqual(nextSystemCard(s, 'p1', { now: T0 }), 'uproot');
  const plot = Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'plot');
  s.farm.objects[plot].crop = { def: 'wheat', plantedAt: T0, readyAt: T0 + 60_000, by: 'p1', cycle: 0 };
  assert.equal(nextSystemCard(s, 'p1', { now: T0 + 1000 }), 'uproot');
  assert.notEqual(nextSystemCard(s, 'p1', { now: T0 + SAFETY.undoMs + 1 }), 'uproot', 'after the refund window');
  assert.notEqual(nextSystemCard(s, 'p2', { now: T0 + 1000 }), 'uproot', 'the partner\'s crop is not mine');
});
