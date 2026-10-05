// QA wave 2 CL-06 (ui, proposed by the client fixer): the Goal Tracker re-ranks at most twice a second; a change after a
// quiet half second (a click) re-ranks on the next frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankWait, RANK_MS } from '../public/js/ui/tracker.js';

test('CL-06: rankWait — at once after a quiet half second, otherwise one trailing ranking', () => {
  assert.equal(RANK_MS, 500);
  assert.equal(rankWait({ rankedAt: -Infinity, now: 0 }), 0, 'the first ranking');
  assert.equal(rankWait({ rankedAt: 1000, now: 1600 }), 0, 'a click after a quiet half second: the next frame');
  assert.equal(rankWait({ rankedAt: 1000, now: 1016 }), 484, 'a stroke frame 16 ms later: the trailing edge');
  assert.equal(rankWait({ rankedAt: 1000, now: 1499 }), 1);
  // a 60 fps stroke of 3 s re-ranks at most 2 x 3 + 1 times
  let rankedAt = -Infinity; let n = 0; let pending = null;
  for (let t = 0; t <= 3000; t += 16) {
    if (pending !== null && t >= pending) { rankedAt = t; n++; pending = null; }
    const w = rankWait({ rankedAt, now: t });
    if (w === 0 && pending === null) { rankedAt = t; n++; } else if (pending === null) pending = t + w;
  }
  assert.ok(n <= 7, `${n} rankings in a 3 s stroke`);
});
