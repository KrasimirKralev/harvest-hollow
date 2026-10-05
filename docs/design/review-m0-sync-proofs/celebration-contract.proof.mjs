// PROOF (review-m0 M8): the confirmed-only celebration rule is enforced by a NAME LIST that lives in the
// client (public/js/net/sync.js CELEBRATIONS), not in the rules that emit the events. Only 'levelUp' is
// emitted today; 'achievement', 'questDone', 'duet', 'together' are names nobody in shared/ promises to use.
// The rules lane will add GDD §5.4 "Ribbons", quests, duets: any event named differently (e.g. 'ribbon',
// 'questComplete') is PREDICTED and can be taken back - the exact thing tech §0 #15 forbids. (b) A
// celebration whose delta was lost in a disconnect never plays (no catch-up from the welcome).
// Run: node --test docs/design/review-m0-sync-proofs/celebration-contract.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coopHarness } from '../../../test/helpers.js';
import { cropOf, xpForLevel } from '../../../shared/content/index.js';
import * as rules from '../../../shared/rules/index.js';
import * as progress from '../../../shared/rules/progress.js';

test('(a) the set of celebration events is exported by the rules that emit them', () => {
  const exported = Object.keys({ ...rules, ...progress }).filter((k) => /CELEBRAT/i.test(k));
  console.log(`OBSERVED celebration exports in shared/rules: ${JSON.stringify(exported)}`);
  assert.ok(exported.length > 0, 'shared/rules exports the celebration set (or events carry a flag)');
});

test('(b) a level-up whose delta was lost in a disconnect still celebrates after the reconnect', () => {
  const h = coopHarness();
  h.state.farm.xp = xpForLevel(2) - 1;                 // one harvest away from level 2
  for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
  h.a.store.act('plant', { id: 'home.0.0', crop: 'wheat' });
  h.flush();
  h.clock.advance(cropOf('wheat').growMs);
  const cel = [];
  h.b.store.on('celebrate', (c) => cel.push(c.ev.e));
  h.a.store.act('harvest', { id: 'home.0.0' });
  h.deliverToServer(h.a);
  h.b.toClient.length = 0;                             // B's tab was reconnecting at that moment
  h.b.store.reset(h.welcome(h.b));
  h.flush();
  console.log(`OBSERVED B level=${h.b.store.state.farm.xp >= xpForLevel(2) ? 2 : 1}, celebrations on B: ${JSON.stringify(cel)}`);
  assert.deepEqual(cel, ['levelUp']);
});
