// "Suggest an idea" and the GitHub star card in the game (owner requests 2026-10-05): the card's rules (level 5 or the
// third play day, at most twice, "Maybe later" + 3 days, never over a panel, a dialog, the guide or Golden Hour), every
// string of the catalog in use, and no HTML written by the game's new modules. The landing side: test/front.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import FRONT_TEXT from '../public/js/i18n/en/front.js';
import { CATEGORIES } from '../public/js/front/ideas.js';
import { starDue, notePlayDay, calm, readMemo, localDay, STAR_AGAIN_MS } from '../public/js/ui/star-nudge.js';

test('star card: level 5 or the third play day, at most twice, the second only after "Maybe later" and 3 days', () => {
  const now = Date.UTC(2026, 9, 10, 12);
  const fresh = readMemo(null);
  assert.equal(starDue(fresh, { now, level: 1 }), false, 'a new player on day one');
  assert.equal(starDue(fresh, { now, level: 5 }), true, 'the farm reached level 5');
  let m = notePlayDay(notePlayDay(fresh, '2026-10-08'), '2026-10-09');
  assert.equal(starDue(m, { now, level: 2 }), false, 'two play days');
  m = notePlayDay(notePlayDay(m, '2026-10-09'), '2026-10-10');
  assert.deepEqual(m.days, ['2026-10-08', '2026-10-09', '2026-10-10']);
  assert.equal(starDue(m, { now, level: 2 }), true, 'the third play day');
  assert.deepEqual(notePlayDay(m, '2026-10-11').days, ['2026-10-09', '2026-10-10', '2026-10-11'], 'only the last three are kept');
  const later = { ...m, shown: 1, at: now, answer: 'later' };
  assert.equal(starDue(later, { now: now + STAR_AGAIN_MS - 1, level: 9 }), false, 'not before 3 days');
  assert.equal(starDue(later, { now: now + STAR_AGAIN_MS, level: 9 }), true, 'after "Maybe later" and 3 days');
  assert.equal(starDue({ ...later, answer: 'never' }, { now: now + 30 * STAR_AGAIN_MS, level: 9 }), false, "Don't ask again");
  assert.equal(starDue({ ...later, answer: 'starred' }, { now: now + 30 * STAR_AGAIN_MS, level: 9 }), false, 'starred');
  assert.equal(starDue({ ...later, shown: 2 }, { now: now + 30 * STAR_AGAIN_MS, level: 9 }), false, 'twice is all');
  assert.equal(starDue({ ...m, shown: 0, answer: 'never' }, { now, level: 9 }), false);
  // a hand-edited or old value never breaks it
  assert.deepEqual(readMemo({ days: 'x', shown: -1, at: 'y', answer: 'maybe' }), { days: [], shown: 0, at: 0, answer: null });
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59).getTime()), '2026-01-05');
});


test('star card: never during a panel, a dialog, the first-run guide, Golden Hour or the photo view', () => {
  const quiet = { panel: null, modal: false, coach: false, golden: false, photo: false, hidden: false };
  assert.equal(calm(quiet), true);
  for (const k of ['panel', 'modal', 'coach', 'golden', 'photo', 'hidden']) {
    assert.equal(calm({ ...quiet, [k]: k === 'panel' ? 'market' : true }), false, k);
  }
});


test('front: every catalog string is used (landing.html or the client code), and the catalog has no HTML', () => {
  const files = ['public/landing.html', ...['public/js/landing.js', 'public/js/ui/ideas.js', 'public/js/ui/star-nudge.js']]
    .concat(fs.readdirSync(path.join(ROOT, 'public/js/front')).map((f) => `public/js/front/${f}`))
    .filter((f) => !f.endsWith('/text.js'));
  const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  // keys built from a code ('front.ideas.cat.' + id, 'front.ideas.err.' + code) are used through their prefix
  const dynamic = ['front.ideas.cat.', 'front.ideas.err.'];
  for (const key of Object.keys(FRONT_TEXT)) {
    const used = src.includes(`'${key}'`) || src.includes(`"${key}"`) || src.includes(`:${key}`) || dynamic.some((p) => key.startsWith(p));
    assert.ok(used, `unused catalog key ${key}`);
    for (const v of typeof FRONT_TEXT[key] === 'object' ? Object.values(FRONT_TEXT[key]) : [FRONT_TEXT[key]]) {
      assert.ok(!/[<>]/.test(v), `${key} carries markup`);
    }
  }
  for (const [cat] of CATEGORIES) assert.ok(FRONT_TEXT[`front.ideas.cat.${cat}`], cat);
  for (const code of ['category', 'short', 'long', 'name', 'contact', 'RATE', 'FULL', 'BAD', 'NET']) assert.ok(FRONT_TEXT[`front.ideas.err.${code}`], code);
});


test('ideas ui: the new game modules never write HTML', () => {
  for (const f of ['public/js/ui/ideas.js', 'public/js/ui/star-nudge.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|new DOMParser/.test(src), `${f} writes HTML`);
  }
});
