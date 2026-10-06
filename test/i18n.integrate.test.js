// The lead's integration fixes for the Bulgarian translation (2026-10-05): each one a line that once read wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../public/js/i18n/index.js';
import { feedText as journalLine } from '../public/js/ui/panels/goals-model.js';
import { feedText } from '../public/js/ui/feed.js';
import { RELICS } from '../shared/content/index.js';

test('the Journal says a balloon crate and a treasure in words, never the bare row kind', async () => {
  try {
    for (const l of ['en', 'bg']) {
      if (l === 'bg') await I.__loadForTest('bg'); else I.__setForTest('en');
      const crate = journalLine({ k: 'crate', by: 'p1', c: 120, at: 0 });
      assert.notEqual(crate, 'crate', l);
      assert.match(crate, /120/, l);
      const relic = journalLine({ k: 'relic', by: 'p1', def: 'lucky_clover', a: 90, at: 0 });
      assert.notEqual(relic, 'relic', l);
    }
  } finally { I.__setForTest('en'); }
});

test('Bulgarian: a bought treasure is named in Bulgarian, with its article ("купи четирилистната детелина")', async () => {
  try {
    await I.__loadForTest('bg');
    const f = feedText({ k: 'relic', by: 'p1', def: 'lucky_clover', a: 90, at: 0 }, { players: { p1: { name: 'Краси' } } }, 'p2');
    assert.match(f.text, /четирилистната детелина/);
    for (const r of RELICS) assert.doesNotMatch(I.ctext(null, r.id, 'name', r.name), /[A-Za-z]/, r.id);
  } finally { I.__setForTest('en'); }
});

test('the league floats: Bulgarian names the league, English keeps "League 3"', async () => {
  try {
    assert.equal(I.t('game.fx.promoted', { league: 3, leagueName: '3' }), 'Promoted to League 3!');
    await I.__loadForTest('bg');
    assert.equal(I.t('game.fx.promoted', { league: 3, leagueName: I.ctext('FAIR', 'league.3', 'name', '3') }), 'Повишение: Лига „Градина“!');
  } finally { I.__setForTest('en'); }
});
