// PROOF (review-m0 M4): the frozen presence wire shape cannot carry two things GDD §7 / tech §6 need.
// (a) avatar.js "poofs" (teleports) when the target is > 12 tiles away, but `mv` has no hop flag, so the
//     server's speed clamp turns the poof into a multi-second 1.5x sprint across the farm on the
//     partner's screen. (b) the partner cursor ring must show the partner's TOOL (tech §6.3, GDD §7.2
//     "their avatar plays the tool gesture"), but `mv` has no tool field and parseClientMessage strips
//     unknown keys, so no lane can add it without a CONTRACT change.
// Run: node --test docs/design/review-m0-sync-proofs/presence-contract.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Presence } from '../../../server/presence.js';
import { parseClientMessage } from '../../../shared/net/protocol.js';
import { START } from '../../../shared/content/config.js';

test('(a) a 30-tile poof shows on the partner screen within one relay tick', () => {
  const clock = { t: 1000, now() { return this.t; } };
  const sent = [];
  const p = new Presence(clock, (m) => sent.push(m));
  p.join('p1');
  p.flush();
  const sp = START.spawn.p1;
  clock.t += 66;
  p.move('p1', { x: sp.x + 30, z: sp.z, f: 0, a: 0 });   // what avatar.walkTo sends after a hop
  let ms = 0;
  while (p.p.get('p1').x !== sp.x + 30 && ms < 20_000) { clock.t += 66; ms += 66; p.flush(); }
  console.log(`OBSERVED the partner sees the avatar run for ${ms} ms (${sent.length} pr frames) instead of a poof`);
  assert.ok(ms <= 66);
});

test('(b) mv can carry the current tool for the partner cursor ring', () => {
  const m = parseClientMessage({ t: 'mv', x: 1, z: 1, f: 0, a: 0, cx: 2, cz: 2, tool: 'sickle' });
  console.log(`OBSERVED parsed mv = ${JSON.stringify(m)}`);
  assert.equal(m.tool, 'sickle');
});
