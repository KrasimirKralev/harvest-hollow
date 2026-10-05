// Wave-2 QA RC-01: every land card's proof task must be reachable by a rule that really counts it. Fairground Lane's
// "fill 10 orders" was never counted (orderFill had no proofDeed call) and Riverbank's "Cotton Tote or Wool Pillow"
// (an array ref) never matched, so expansions stopped forever at k = 6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT, isLive, defOf, itemOf, recipeOf, cropOf } from '../shared/content/index.js';
import { proofDeed } from '../shared/rules/economy.js';
import { Tx } from '../shared/rules/tx.js';
import { proofProgress } from '../shared/rules/actions/expansions.js';
import { farmAt, actOk, runDue, give, T0, MIN } from './helpers/rules-goals.js';
import { ROOT } from './helpers.js';

const ACTIONS = path.join(ROOT, 'shared', 'rules', 'actions');
const source = fs.readdirSync(ACTIONS).filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(ACTIONS, f), 'utf8')).join('\n');

/** Whether a ref can ever be produced by the verb's rule path (content shape, not a call site). */
function refOk(verb, ref) {
  const it = itemOf(ref);
  switch (verb) {
    case 'harvest': return Boolean(cropOf(ref)) || it?.kind === 'fruit';
    case 'collect': return it?.kind === 'animal' || it?.kind === 'fruit';
    case 'make': return Boolean(recipeOf(ref));
    case 'fill': return ref === 'order';
    case 'own': return Boolean(defOf(ref));
    default: return false;
  }
}

test('RC-01: every live expansion proof task names a verb some rule counts and a ref that rule can produce', () => {
  const bad = [];
  for (const e of CONTENT.expansions.values()) {
    if (!isLive(e)) continue;
    for (const t of e.proof) {
      if (t.verb !== 'own' && !source.includes(`proofDeed(tx, '${t.verb}'`)) {
        bad.push(`${e.id}: no call site counts '${t.verb}'`);
      }
      for (const r of Array.isArray(t.ref) ? t.ref : [t.ref]) {
        if (!refOk(t.verb, r)) bad.push(`${e.id}: ${t.verb} ${r}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('RC-01: a proof task whose ref is a list counts any of its items', () => {
  const s = farmAt(22);
  s.farm.proofs.riverbank = { at: T0, n: {} };
  const tx = new Tx(s);
  proofDeed(tx, 'make', 'cotton_tote', 2);
  proofDeed(tx, 'make', 'wool_pillow', 1);
  assert.deepEqual(proofProgress(s, 'riverbank', 0, T0), { have: 3, need: 3, done: true });
});

test('RC-01: every filled order (a simple one too) counts toward "fill 10 orders"', () => {
  const s = farmAt(17);
  s.farm.expansions = ['home', 'creekside', 'old_orchard', 'cow_hill', 'sunflower_rise', 'bee_glade'];
  let now = T0 + MIN;
  runDue(s, now);
  actOk(s, 'openExpansion', { expansion: 'fair_lane' }, { now });
  const i = CONTENT.expansions.get('fair_lane').proof.findIndex((t) => t.verb === 'fill');
  let filled = 0;
  for (let k = 0; k < 40 && filled < 4; k++) {
    for (const [slot, o] of Object.entries(s.farm.orders.slots)) {
      if (!o.order) continue;
      for (const [item, q] of Object.entries(o.order.items)) give(s, item, q);
      actOk(s, 'orderFill', { slot: Number(slot), n: o.order.n }, { now });
      filled++;
    }
    now += 16 * MIN;
    runDue(s, now);
  }
  assert.ok(filled >= 4, `only ${filled} orders came up`);
  assert.equal(proofProgress(s, 'fair_lane', i, now).have, Math.min(10, filled));
});
