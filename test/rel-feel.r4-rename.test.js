// QA r4 F4-03, the display half (the patch for life-feel's ui/feed.js, ui-panels' goals-model.js and i18n */feed.js):
// the rename line names both names in English and Bulgarian, and the old namer gets no ♥ Thanks button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { feedRows } from '../shared/rules/feed.js';
import { farmAt, put, actOk, T0, MIN } from './helpers/rules-goals.js';

installDom();

test('F4-03: "<farmer> renamed "Tajna" to "Buttercup"", both names, both languages; no ♥ Thanks for the old namer', async () => {
  const F = await import('../public/js/ui/feed.js');
  const I18N = await import('../public/js/i18n/index.js');
  const s = farmAt(7);
  const hen = put(s, 'chicken', { home: put(s, 'coop') });
  actOk(s, 'nameAnimal', { id: hen, name: 'Tajna' }, { pid: 'p2' });
  actOk(s, 'nameAnimal', { id: hen, name: 'Buttercup' }, { pid: 'p1', now: T0 + MIN });
  const [, row] = feedRows(s, 1)[0];
  const [, first] = feedRows(s, 2)[1];
  try {
    for (const [lang, re] of [['en', /renamed "Tajna" to "Buttercup"/], ['bg', /преименува „Tajna“ на „Buttercup“/]]) {
      await I18N.setLang(lang);
      const l = F.feedText(row, s, 'p2');
      assert.match(`${l.actor} ${l.text}`, re, lang);
      assert.doesNotMatch(F.feedText(first, s, 'p1').text, /renamed|преименува/, `${lang}: a first naming stays a naming`);
    }
  } finally { await I18N.setLang('en'); }
  assert.equal(F.thankable(row, s, 'p2'), false, 'no thanks for a rename of my animal');
  assert.equal(F.thankable(first, s, 'p1'), true, 'a first naming is thanked as before');
});
