// QA r4 (life-feel) L4-05 (jde#8): the welcome-back card's "While you were away" list opened with "and 4 more" / "и
// още 4": the newest four lines stay in view and the older ones fold above them, but the fold read as a list's last line.
// It now names what it is: "4 earlier" / "Още 4 по‑рано" (cheer.recap.earlier). Other lists keep "and N more" last.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';

const document = installDom();
document.documentElement = { lang: 'en' };
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { makeFarm, T0 } = await import('./helpers.js');
const I = await import('../public/js/i18n/index.js');
const { createRecap, RECAP_LINES } = await import('../public/js/ui/recap.js');

/** p1 was away 3 h while p2 did 8 things (the rules' cap for the list). */
function awayFarm() {
  const s = makeFarm();
  s.players.p1.name = 'Ана';
  s.players.p2.name = 'Бо';
  const away = T0 + 60_000;
  s.players.p1.lastSeenAt = away;
  s.farm.feed = { n: 0, rows: {} };
  for (let i = 0; i < 8; i++) {
    s.farm.feed.rows[String(i)] = { at: away + (i + 1) * 60_000, by: 'p2', k: 'harvest', item: 'wheat', q: 3 + i };
    s.farm.feed.n = i + 1;
  }
  return { s, now: away + 3 * 3600_000 };
}
function mount(s, now) {
  let spec = null;
  createRecap({
    store: { state: s, pid: 'p1', now: () => now },
    ui: { panels: { register(name, sp) { spec = sp; }, top: () => null, has: () => false, open() {} } },
    controller: { do() {} },
    view: { focus() {} },
  });
  const body = document.createElement('div');
  document.body.append(body);
  spec.mount(body, { close() {} });
  return body;
}

test('L4-05: the partner list does not open with "and N more"; its fold says "N earlier" above the newest lines', async () => {
  try {
    for (const [lang, fold, and] of [['en', /^4 earlier$/, /^and /], ['bg', /^Още 4 по‑рано$/, /^и /]]) {
      await I.setLang(lang);
      const { s, now } = awayFarm();
      const body = mount(s, now);
      const lists = body.querySelectorAll('ul');
      assert.ok(lists.length >= 1, `${lang}: a list`);
      const partner = lists.find((ul) => ul.children.some((li) => /Бо/.test(textOf(li))));
      assert.ok(partner, `${lang}: the partner list`);
      const first = partner.children[0];
      assert.doesNotMatch(textOf(first), and, `${lang}: the list opens with "${textOf(first)}"`);
      assert.match(textOf(first), fold, `${lang}: the fold names the older lines`);
      const lines = partner.children.filter((c) => !c.classList.contains('recap-more'));
      assert.equal(lines.length, RECAP_LINES, `${lang}: the newest ${RECAP_LINES} lines (M10's cap)`);
    }
  } finally { await I.setLang('en'); }
});

// (QA r4, seen while checking L4-05 on the tree) "Show me the new things" was decided once, when the card opened: a
// Market that registers after it (a lazy panel on a slow link) never gave the card its button.
test('the recap\'s "Show me the new things" comes when the panel it needs registers after the card opened', () => {
  const { s, now } = awayFarm();
  s.farm.xp = 600;                                            // a level reached while away: a new crop to show
  s.players.p1.seen = { ...s.players.p1.seen, lvl: 1 };
  let spec = null;
  const registered = new Set();
  const listeners = new Set();
  createRecap({
    store: { state: s, pid: 'p1', now: () => now },
    ui: { panels: { register(name, sp) { spec = sp; }, top: () => null, has: (n) => registered.has(n), open() {},
      on: (ev, fn) => { if (ev !== 'register') return () => {}; listeners.add(fn); return () => listeners.delete(fn); } } },
    controller: { do() {} },
    view: { focus() {} },
  });
  const body = document.createElement('div');
  document.body.append(body);
  spec.mount(body, { close() {} });
  const foot = body.querySelector('.recap-foot');
  assert.ok(foot, 'the footer');
  assert.equal(foot.querySelectorAll('.btn--sky').length, 0, 'no Market yet: no Show me');
  registered.add('market');
  for (const fn of [...listeners]) fn('market');
  assert.equal(foot.querySelectorAll('.btn--sky').length, 1, 'the Market registered: the card offers Show me the new things');
});
