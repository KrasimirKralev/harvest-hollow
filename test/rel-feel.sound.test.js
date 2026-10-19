// Release 1.0 (life-feel): the sound and feel rules as pure functions. F1 (feel#5): the long jingles play one at a time
// in rank order (levelup > quest > achievement > mastery > order > register), never overlapping more than 60 %. F4
// (feel#9, #10 a+b): no music track repeats within 3 picks; a generative piece follows every composed track of the
// day, the night and the rain; a workshop that turns ready rings 'done' (at most once per 3 s; crops stay silent).
// G11b (feel#12): a ripen sparkle at most once per field per 5 s; ripe glints 0.55 m from the mid band on. F5
// (feel#11): the new haptic patterns, a no-op where navigator.vibrate is missing (iOS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jinglePlan, JINGLE_RANK, JINGLE, pickTrack, genNext, MUSIC_HISTORY } from '../public/js/audio.js';
import { createRipenThrottle, readyCounts, turnedReady, DONE_GAP_MS } from '../public/js/game/feedback.js';
import { createHaptics, PULSES } from '../public/js/game/haptics.js';
import { glintScale, GLINT } from '../public/js/render/fx.js';

const J = (name, dur) => ({ rank: JINGLE_RANK[name], dur });

test('F1: the jingles rank levelup > quest > achievement > mastery > order > register', () => {
  const order = ['levelup', 'quest', 'achievement', 'mastery', 'order', 'register'];
  for (let i = 1; i < order.length; i++) assert.ok(JINGLE_RANK[order[i - 1]] > JINGLE_RANK[order[i]], `${order[i - 1]} > ${order[i]}`);
});

test('F1: a sale that finishes a quest: the quest takes over, the register bows out (no pile-up)', () => {
  const cur = { rank: JINGLE_RANK.register, start: 0, end: 1.06 };
  const p = jinglePlan(cur, J('quest', 1.48), 0.02);
  assert.equal(p.at, 0.02);
  assert.equal(p.cut, true, 'the register fades out under the quest');
});

test('F1: a lower jingle right after a bigger one is dropped; near its end it is chained 0.15 s before it ends', () => {
  const cur = { rank: JINGLE_RANK.quest, start: 0, end: 1.48 };
  assert.equal(jinglePlan(cur, J('register', 1.06), 0.1).at, null, 'would overlap 100 %: dropped');
  const late = jinglePlan(cur, J('register', 1.06), 1.0);
  assert.ok(Math.abs(late.at - (1.48 - JINGLE.lead)) < 1e-9, `chained at ${late.at}`);
  // an equal one always chains
  const eq = jinglePlan({ rank: JINGLE_RANK.achievement, start: 0, end: 1.49 }, J('duet', 1.74), 0.2);
  assert.ok(Math.abs(eq.at - (1.49 - JINGLE.lead)) < 1e-9);
  assert.equal(jinglePlan(null, J('order', 1.48), 3).at, 3, 'nothing playing: at once');
});

test('F1: over a random burst of jingles, two never overlap by more than 60 % of the shorter', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const names = Object.keys(JINGLE_RANK);
  const DUR = { levelup: 1.93, fanfare: 2.44, quest: 1.48, achievement: 1.49, duet: 1.74, mastery: 1.13, order: 1.49, register: 1.06 };
  const played = [];
  let cur = null;
  let t = 0;
  for (let i = 0; i < 400; i++) {
    t += rnd() * 0.9;
    const name = names[Math.floor(rnd() * names.length)];
    const p = jinglePlan(cur && cur.end > t ? cur : null, { rank: JINGLE_RANK[name], dur: DUR[name] }, t);
    if (p.at === null) continue;
    // a take-over cuts every jingle still sounding (audio.js jingle(): the one playing and a booked one)
    if (p.cut) for (const j of played) if (j.end > t) j.end = Math.max(j.start, Math.min(j.end, t + JINGLE.cutS));
    cur = { name, rank: JINGLE_RANK[name], start: p.at, end: p.at + DUR[name], full: DUR[name] };
    played.push(cur);
  }
  // every pair that really sounded together (a cut one counts its full length: the overlap is of what was heard)
  for (let i = 0; i < played.length; i++) {
    for (let k = i + 1; k < played.length; k++) {
      const a = played[i]; const b = played[k];
      if (a.end <= a.start || b.end <= b.start) continue;           // cancelled before it began
      const ov = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
      if (!ov) continue;
      const shorter = Math.min(a.full, b.full);
      assert.ok(ov / shorter <= JINGLE.overlap + 1e-9, `${a.name} and ${b.name} overlap ${(100 * ov / shorter).toFixed(0)} %`);
    }
  }
  assert.ok(played.length > 100, `${played.length} jingles played`);
});

const TRACKS = [
  { id: 'day-a', moods: ['day'] }, { id: 'day-b', moods: ['day'] }, { id: 'day-c', moods: ['day'] },
  { id: 'eve', moods: ['evening'] }, { id: 'night-a', moods: ['night'] }, { id: 'rain-a', moods: ['rain', 'night'] },
];

test('F4: no track repeats within 3 picks in the day (three day tracks)', () => {
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const picks = [];
  for (let i = 0; i < 300; i++) {
    const t = pickTrack(TRACKS, 'day', { last: picks.at(-1) ?? null, recent: picks.slice(-MUSIC_HISTORY), random: rnd });
    picks.push(t.id);
  }
  for (let i = 2; i < picks.length; i++) assert.equal(new Set(picks.slice(i - 2, i + 1)).size, 3, `picks ${i - 2}..${i}: ${picks.slice(i - 2, i + 1)}`);
  assert.equal(MUSIC_HISTORY, 3);
});

test('F4: a short pool lets an older pick back rather than borrow, and never repeats the last one', () => {
  const two = [{ id: 'n1', moods: ['night'] }, { id: 'n2', moods: ['night'] }];
  assert.equal(pickTrack(two, 'night', { last: 'n2', recent: ['n1', 'n2'], random: () => 0 }).id, 'n1');
});

test('F4: a generative piece follows a composed track of the day, the night and the rain; not the evening or the Fair', () => {
  for (const c of ['day', 'night', 'rain']) {
    assert.equal(genNext({ lastKind: 'track', context: c }), true, c);
    assert.equal(genNext({ lastKind: 'gen', context: c }), false, `${c}: a track after a piece`);
  }
  for (const c of ['evening', 'fair', 'title']) assert.equal(genNext({ lastKind: 'track', context: c }), false, c);
});

test('F4: a workshop whose tray grows is "turned ready"; a first look and crops count nothing', () => {
  const state = (e1, e2) => ({ farm: { objects: {
    bakery: { def: 'bakery', x: 1, z: 1, queue: [{ r: 'bread', s: 0, e: e1 }, { r: 'bread', s: e1, e: e2 }] },
    plot1: { def: 'plot', x: 4, z: 4, crop: { def: 'wheat', readyAt: 10 } },
    composter: { def: 'composter', x: 6, z: 1, queue: [], ready: 0 },
  } } });
  const a = readyCounts(state(100, 200), 50);
  assert.deepEqual(turnedReady(new Map(), a), [], 'a first look');
  const b = readyCounts(state(100, 200), 150);
  assert.deepEqual(turnedReady(a, b), ['bakery']);
  assert.ok(!b.has('plot1'), 'crops are no workshops');
  assert.deepEqual(turnedReady(b, readyCounts(state(100, 200), 160)), [], 'no change, no chime');
  assert.equal(DONE_GAP_MS, 3000);
});

test('G11b: a ripen sparkle at most once per field per 5 s', () => {
  const allow = createRipenThrottle();
  assert.equal(allow({ x: 10, z: 10 }, 0), true);
  assert.equal(allow({ x: 12, z: 11 }, 100), false, 'the same field ripening plot by plot');
  assert.equal(allow({ x: 40, z: 40 }, 200), true, 'another field');
  assert.equal(allow({ x: 11, z: 10 }, 4999), false);
  assert.equal(allow({ x: 11, z: 10 }, 5001), true, 'after 5 s the field may sparkle again');
  assert.equal(allow(null, 9000), false);
});

test('G11b: ripe glints are 0.38 m near and 0.55 m from the mid band on (the shader mirrors glintScale)', async () => {
  assert.equal(glintScale(20), 1);
  assert.ok(Math.abs(0.38 * glintScale(45) - 0.55) < 1e-9);
  assert.ok(Math.abs(0.38 * glintScale(80) - 0.55) < 1e-9);
  assert.ok(glintScale(35) > 1 && glintScale(35) < GLINT.far);
});

test('F5: plant, bonk, coins and reward pulses; nothing (and no error) without navigator.vibrate', () => {
  for (const k of ['plant', 'bonk', 'coins', 'reward']) assert.ok(PULSES[k], k);
  assert.deepEqual([...PULSES.bonk], [10, 30, 10]);
  assert.deepEqual([...PULSES.coins], [6, 40, 6]);
  assert.deepEqual([...PULSES.reward], [15, 50, 25]);
  const calls = [];
  let now = 0;
  const h = createHaptics({ nav: { vibrate: (p) => { calls.push(p); return true; } }, now: () => now });
  assert.equal(h.pulse('plant'), true);
  now += 10;
  assert.equal(h.pulse('reward'), true, 'a reward is never swallowed by the gap rule');
  assert.deepEqual(calls, [8, [15, 50, 25]]);
  const ios = createHaptics({ nav: {} });
  assert.equal(ios.available, false);
  assert.equal(ios.pulse('reward'), false);
});
