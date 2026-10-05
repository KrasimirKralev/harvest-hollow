// client lane, wave 4b (owner wishes 2026-10-05): the sounds of the crates, the relics, a grown home and a reordered
// queue (existing samples only: nothing new to download), and the client's footprint of a grown home (the Hammer's ghost,
// the walk target) following the rules' sizeOf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { coopHarness } from './helpers/client.js';
import { soundsOf, bigSpendLine } from '../public/js/game/feedback.js';
import * as GRID from '../shared/rules/grid.js';
import { defOf } from '../shared/content/index.js';

const MANIFEST = JSON.parse(fs.readFileSync(new URL('../public/assets/audio/manifest.json', import.meta.url), 'utf8'));

test('sounds: a crate opens with a shake, the lid, a pop and a small fanfare; one left alone goes quietly', () => {
  const state = coopHarness().state;
  const open = soundsOf({ e: 'crateOpened', coins: 100, xp: 10, by: 'p1' }, state).map(([n]) => n);
  assert.deepEqual(open, ['shake', 'crate', 'pop', 'fanfare', 'coin']);
  assert.deepEqual(soundsOf({ e: 'crateOpened', auto: true }, state).map(([n]) => n), ['close']);
  const evs = [{ e: 'crateDropped' }, { e: 'relicBought' }, { e: 'wateredAll', n: 3 }, { e: 'farmhandDone', n: 2 },
    { e: 'timeTurned', n: 4 }, { e: 'homeGrew', grows: true }, { e: 'homeGrew', grows: false }, { e: 'reordered' },
    { e: 'savingFor' }, { e: 'treeAged', stage: 'mature' }];
  for (const ev of evs) {
    const list = soundsOf(ev, state);
    assert.ok(list.length > 0, ev.e);
    for (const [name, o] of list) {
      assert.ok(MANIFEST.sounds[name], `${ev.e}: ${name}`);
      assert.ok(!o || !o.at || o.at < 1, `${ev.e}: a sequence inside a second`);
    }
  }
});

test('footprint: a grown home is moved and walked to with its whole paddock (the rules\' sizeOf)', (t) => {
  if (typeof GRID.sizeOf !== 'function') { t.skip('this build has no growing homes'); return; }
  const def = defOf('coop');
  const o = { def: 'coop', x: 10, z: 10, rot: 1, up: 4 };
  const [w, d] = GRID.sizeOf(o, def);
  assert.ok(w >= def.size[0] && d >= def.size[1]);
  assert.deepEqual(GRID.objFootprint(o, def), [d, w], 'an odd turn swaps the sides');
});

test('a treasure bought: the partner gets the relic line only, never a second "is buying something big"', () => {
  const state = coopHarness().state;
  const evs = [{ e: 'bigSpend', acorns: 120, what: 'golden_can', by: 'p1' }, { e: 'relicBought', relic: 'golden_can', acorns: 120, by: 'p1' }];
  assert.equal(bigSpendLine(evs, state, 'p1', 0), null);
  // any other big spend keeps its heads-up
  assert.ok(bigSpendLine([{ e: 'bigSpend', coins: 50_000, what: 'bakery' }, { e: 'placed', def: 'bakery' }], state, 'p1', 0));
});
