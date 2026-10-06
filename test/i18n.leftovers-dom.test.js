// The verifier's leftover findings that need a page (the ui tests' tiny DOM, test/ui-qa2-dom.js): a language switch
// mid-game re-says the toasts, notices and banners already up, like the panels re-mount.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';
import * as I from '../public/js/i18n/index.js';
import { isLive, DUEL, xpForLevel } from '../shared/content/index.js';
import { coopHarness, eventTarget, fakeController } from './helpers/client.js';

/** Both screens and the server at farm level L (the duel opens at 27). */
function level(h, L) { for (const s of [h.state, h.a.store.state, h.b.store.state]) { s.farm.xp = xpForLevel(L); s.farm.wallet.coins = 2_000_000; } }

installDom();
globalThis.window ??= eventTarget();
for (const id of ['hud', 'toasts', 'banners']) {
  const el = document.createElement('div');
  el.setAttribute('id', id);
  document.body.append(el);
}
const $ = (id) => document.getElementById(id);

test('a language switch re-says the open toasts, the duel notice and its buttons, and the banner cards', { skip: isLive(DUEL) ? false : 'Friendly Duel is not live' }, async () => {
  const { createToasts } = await import('../public/js/ui/toasts.js');
  const { createM2Moments } = await import('../public/js/game/m2-moments.js');
  const toasts = createToasts({ store: null }, (code) => I.t(`err.${code}`));
  try {
    // the partner's duel invitation, as the game raises it (game/m2-moments.js -> ui.notice)
    const h = coopHarness();
    level(h, 32);
    const f = await fakeController(h.b);
    const m = createM2Moments({ store: h.b.store, ui: { notice: toasts.notice, toast: toasts.toast, panels: { has: () => false } }, controller: f.ctl });
    assert.equal(h.a.store.act('duelInvite', { kind: 'orders' }).ok, true);
    h.flush();
    m.check();
    m.dispose();
    toasts.toast(I.t('farm.place.notReady'));                         // a catalog line
    toasts.toast('NO_COINS');                                         // a refusal code
    toasts.banner({ id: 'b1', ribbon: I.t('moments.quest.done'), message: () => I.t('moments.duet.text'),
      actions: [{ label: I.t('moments.showMe'), fn() {} }] });
    const notice = () => $('hud').querySelector('.notice');
    const words = () => ({
      notice: textOf(notice().querySelector('span')),
      buttons: notice().querySelectorAll('button').map((b) => textOf(b)),
      toasts: $('toasts').querySelectorAll('.toast .tx').map((x) => textOf(x)),
      banner: textOf($('banners').querySelector('.unlock-banner')),
    });
    const en = words();
    assert.match(en.notice, /challenges you/);
    assert.deepEqual(en.buttons, [I.t('game.duel.go'), I.t('common.ok')]);

    await I.setLang('bg');
    const bg = words();
    assert.doesNotMatch(bg.notice, /challenges|Duel|Order/, `the invitation in Bulgarian: ${bg.notice}`);
    assert.match(bg.notice, /[а-я]/);
    assert.deepEqual(bg.buttons, ['Приемам дуела!', 'Добре']);
    assert.deepEqual(bg.toasts, [I.t('farm.place.notReady'), 'Нямаш достатъчно монети.']);
    assert.ok(bg.banner.includes(I.t('moments.quest.done')) && bg.banner.includes(I.t('moments.duet.text')) && bg.banner.includes(I.t('moments.showMe')),
      bg.banner);
    assert.doesNotMatch(bg.banner, /[A-Za-z]/, bg.banner);

    await I.setLang('en');
    assert.deepEqual(words(), en, 'and back to English');
  } finally { await I.setLang('en'); }
});

test('the paper doll draws no stray "null" text: every hair and hat, the hatless and the short-haired too', async () => {
  const { lookSvg } = await import('../public/js/ui/panels/avatar.js');
  const { LOOKS } = await import('../public/js/ui/panels/w4-model.js');
  const hairs = [...LOOKS.hair.map((x) => x.id), 'none'];
  const hats = [...LOOKS.hats.map((x) => x.id), 'none', undefined];
  for (const hair of hairs) {
    for (const hat of hats) {
      for (const part of ['all', 'head']) {
        const svg = lookSvg({ hair, hat }, { part });
        assert.equal(textOf(svg), '', `${hair} / ${hat} / ${part}: ${textOf(svg)}`);
      }
    }
  }
});

/** A Journal on `state` for `pid` (what the shell hands a panel), its body and what it asked for. */
async function journalOn(state, { pid = 'p2', now = Date.now(), tab = 'week' } = {}) {
  const { journalPanel } = await import('../public/js/ui/panels/journal.js');
  const acts = [];
  const body = document.createElement('div');
  const store = { state, pid, now: () => now, on: () => () => {}, act: (t, a) => { acts.push([t, a]); return { ok: true }; } };
  const ctx = {
    name: 'journal', args: {}, store, body, el: body, now: () => now, tab,
    every: () => () => {}, on: () => () => {}, subscribe: () => () => {},
    act: (t, a) => { acts.push([t, a]); return { ok: true }; }, open() {}, close() {}, setTitle() {}, refreshTabs() {},
    ui: { panels: { open: () => true, has: () => true, isOpen: () => false, badge() {}, on: () => () => {} }, toast() {}, confirm: async () => true },
  };
  journalPanel.mount(body, ctx);
  return { body, acts };
}

test('the Journal: no tab prints "null" (This week with no side letter open, Together, Ledger), in either language', async () => {
  const { storyFarm } = await import('./helpers/ui-panels.js');
  const now = 1_800_000_000_000;
  const { state } = storyFarm({ now });
  const { storyView } = await import('../public/js/ui/panels/goals-model.js');
  assert.equal(storyView(state, now, { tab: 'week' }).active.length, 0, 'This week has no side letter open (the case that printed "null")');
  try {
    for (const l of ['en', 'bg']) {
      await I.setLang(l);
      for (const tab of ['story', 'week', 'ribbons', 'mastery', 'stats', 'ledger', 'activity']) {
        const { body } = await journalOn(state, { now, tab });
        const text = textOf(body);
        assert.ok(text.length > 0, `${l} ${tab}: drawn`);
        assert.doesNotMatch(text, /\bnull\b|undefined|NaN|\[object/, `${l} ${tab}: ${text.match(/.{0,40}(null|undefined|NaN|\[object).{0,40}/)?.[0]}`);
      }
    }
  } finally { await I.setLang('en'); }
});

test('Случки: a farm-level line (the farm\'s new level, a Fair ceremony) has no "Thank" button and no share of "Thank all"', async () => {
  const { storyFarm } = await import('./helpers/ui-panels.js');
  const { thankable } = await import('../public/js/ui/feed.js');
  const now = 1_800_000_000_000;
  const { state } = storyFarm({ now });
  const f = state.farm.feed;
  const put = (row) => { f.rows[String(f.n % 200)] = { at: now - 60_000 + f.n, ...row }; f.n += 1; };
  put({ k: 'harvest', by: 'p1', item: 'wheat', q: 12, p: 6 });         // Rowan's own line: thanks are for this
  put({ k: 'level', by: 'p1', level: 10 });                              // "The farm reached level 10" (Rowan's harvest crossed it)
  put({ k: 'fair', by: 'p1', medal: 'bronze_1', p: 120, c: 300 });      // the Fair's verdict, as the week's close wrote it
  const rows = Object.values(f.rows).slice(-3);
  assert.deepEqual(rows.map((r) => thankable(r, state, 'p2')), [true, false, false], 'only a farmer\'s own line is thanked');
  assert.equal(thankable(rows[0], state, 'p1'), false, 'never your own line');
  try {
    for (const l of ['en', 'bg']) {
      await I.setLang(l);
      const { body } = await journalOn(state, { now, tab: 'activity' });
      const lines = body.querySelectorAll('li.pn-feedrow');
      const withThanks = lines.filter((li) => li.querySelector('button.pn-thanks')).map((li) => textOf(li));
      assert.ok(withThanks.length > 0, `${l}: a farmer's line can be thanked`);
      for (const s of withThanks) assert.doesNotMatch(s, /level 10|ниво 10|Fair|панаир/i, `${l}: no thanks on a farm-level line: ${s}`);
      assert.doesNotMatch(textOf(body), /Фермата\b.*Благодари на|Thank the farm/i);
      const { feedView } = await import('../public/js/ui/panels/goals-model.js');
      const n = feedView(state, 60).filter(({ row }) => thankable(row, state, 'p2')).length;
      assert.match(textOf(body.querySelector('.pn-thankall')), new RegExp(`\\b${n}\\b`), `${l}: "Thank all" counts the ${n} farmers' lines only`);
    }
  } finally { await I.setLang('en'); }
});

test('the "Welcome back" card raised before a switch re-draws its unlock names and the week\'s lines in the new language', async () => {
  const { storyFarm } = await import('./helpers/ui-panels.js');
  const { createRecap } = await import('../public/js/ui/recap.js');
  await import('../public/js/ui/panels/town.js');                          // the recap's reader of the week (lazy there)
  await new Promise((r) => setTimeout(r, 20));
  const now = 1_800_000_000_000;
  const { state } = storyFarm({ now, level: 20 });
  state.players.p1.lastSeenAt = now - 3 * 86_400_000;
  state.players.p1.seen = { ...(state.players.p1.seen ?? {}), lvl: 12 };
  const specs = {};
  const store = { state, pid: 'p1', now: () => now, on: () => () => {} };
  const ui = { panels: { register: (n, spec) => { specs[n] = spec; }, top: () => null, open() {}, has: () => false } };
  const recap = createRecap({ store, ui, controller: { do() {} } });
  try {
    await I.setLang('en');
    recap.onWelcome();                                                       // the card's data, worked out in English
    const draw = () => { const body = document.createElement('div'); specs.recap.mount(body, { close() {} }); return body; };
    const en = draw();
    const enUnlocks = en.querySelectorAll('.grid .cell').map((c) => textOf(c));
    assert.ok(enUnlocks.length > 0, 'the card lists new things');
    await I.setLang('bg');                                                   // the shell re-mounts the open card
    const bg = draw();
    const bgUnlocks = bg.querySelectorAll('.grid .cell').map((c) => textOf(c));
    assert.equal(bgUnlocks.length, enUnlocks.length);
    for (const s of bgUnlocks) assert.doesNotMatch(s, /[A-Za-z]/, `an unlock in Bulgarian: ${s}`);
    assert.ok(bg.querySelectorAll('section ul li').length > 0, 'the week\'s lines are on the card');
    for (const li of bg.querySelectorAll('section ul li')) assert.doesNotMatch(textOf(li), /\b(?:County Fair|Townsfolk|points|requests|Barge)\b/, textOf(li));
  } finally { await I.setLang('en'); }
});
