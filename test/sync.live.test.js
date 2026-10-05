// Live requests 2026-10-04: the welcome painting's chimney smoke keeps rising while the page rests (game/rest.js pauses
// every other endless CSS animation after REST.calmMs without input).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endlessAnimations } from '../public/js/game/rest.js';

test('the resting page leaves the welcome smoke alone ([data-rest="keep"]) and pauses the other endless animations', () => {
  const anim = (inKeep) => ({
    playState: 'running', effect: { getTiming: () => ({ iterations: Infinity }), target: { closest: (sel) => (inKeep && sel === '[data-rest="keep"]' ? {} : null) } },
  });
  const smoke = anim(true);
  const halo = anim(false);
  const bare = { playState: 'running', effect: { getTiming: () => ({ iterations: Infinity }) } };
  assert.deepEqual(endlessAnimations({ getAnimations: () => [smoke, halo, bare] }), [halo, bare]);
});
