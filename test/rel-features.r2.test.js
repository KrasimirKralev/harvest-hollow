// Release 1.0, QA round 2 (features lane; docs/qa/release/qa-r2/fix-features.md): F2-01 the gift note field names its
// button and the foot stops covering it; F2-02 a one-tap note travels as a token and reads in the reader's language;
// F2-03 a confirmed big planting stroke tells the partner and its fine print says how to take it back; F2-05 no quest
// card falls back to the "?" crate; F2-06 the brushes reach a pre-1.0 farm (the tip, a daily SOON turn, "New in 1.0");
// F2-07 Before bed on L9-L14 farms; F2-09 a double click on a tracker card acts once; F2-10 a pick in the gift sheet
// keeps the keyboard focus; F2-11 one mention of a waiting surprise in the recap; and the patches other lanes sent:
// S2-01 the windmill step, S2-07 the plant card arms the Hand, P2-C2 "more than the market, in coins and XP", I2-02
// player text without lone surrogates, mark stacks or invisible-only names.
// RED on 5bbfbca (the tested head): the RED lines are in docs/qa/release/qa-r2/fix-features.md, item by item.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDom } from './ui-qa2-dom.js';
import { CONTENT, TUTORIAL, cropOf } from '../shared/content/index.js';
import { FEATURES } from '../shared/content/features.js';
import { goals } from '../shared/rules/goals.js';
import { enText } from '../shared/rules/goal-text.js';
import * as GT from '../shared/rules/goal-text.js';
import * as Social from '../shared/rules/actions/social.js';
import { recap } from '../shared/rules/feed.js';
import { dayOf } from '../shared/rules/coop.js';
import { parseArgs, V } from '../shared/rules/schema.js';
import { localHour } from '../shared/rules/calendar.js';
import { resetGrid } from '../shared/rules/grid.js';
import { ERR } from '../shared/net/protocol.js';
import { farmAt, put, give, act, actOk, evs, T0, MIN, HOUR } from './helpers/rules-goals.js';

installDom();
globalThis.requestAnimationFrame ??= () => 0;
globalThis.innerHeight ??= 768;
globalThis.innerWidth ??= 1366;
// the fake DOM reads "a > b" as "a b" (the tracker's '.mini > i'; ui-qa2-dom.js has no child combinator)
{
  const proto = Object.getPrototypeOf(document.createElement('div'));
  const qsa = proto.querySelectorAll;
  proto.querySelectorAll = function querySelectorAll(sel) { return qsa.call(this, String(sel).replace(/\s*>\s*/g, ' ')); };
}

let T = null;          // public/js/ui/tracker.js (after the fake DOM)
let G = null;          // public/js/ui/panels/gift.js
let I18N = null;       // public/js/i18n/index.js
let CGT = null;        // public/js/ui/goal-text.js
before(async () => {
  T = await import('../public/js/ui/tracker.js');
  G = await import('../public/js/ui/panels/gift.js');
  I18N = await import('../public/js/i18n/index.js');
  CGT = await import('../public/js/ui/goal-text.js');
});

const TZ = 'Europe/Sofia';
/** A Sofia wall-clock time in October 2026 (EEST, UTC+3, until 04:00 on 25 Oct). */
const at = (day, h, m = 0) => {
  const guess = Date.UTC(2026, 9, day, h - 3, m);
  return localHour(guess, TZ) === h ? guess : Date.UTC(2026, 9, day, h - 2, m);
};
const plotIds = (s) => Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'plot').sort();

/** A quiet farm at `level` holding `coins`, `n` empty plots, no chores (the r1 tests' field()). */
function field(level, coins, n) {
  const s = farmAt(level);
  s.farm.wallet.coins = coins;
  for (const id of Object.keys(s.farm.objects)) if (CONTENT.debris.has(s.farm.objects[id].def)) delete s.farm.objects[id];
  while (plotIds(s).length < n) put(s, 'plot');
  for (const id of plotIds(s)) s.farm.objects[id].crop = null;
  for (const p of Object.values(s.players)) p.almanac.tasks = {};
  s.farm.quests.active = {};
  resetGrid(s);
  return s;
}

/** A panel ctx over a plain state (what the shell hands a panel), recording what the panel asks for. */
function ctxOf(state, { pid = 'p2', now = T0 + HOUR } = {}) {
  const acts = [];
  const body = document.createElement('div');
  document.body.append(body);
  const store = { state, pid, now: () => now, on: () => () => {}, act: (t, a) => { acts.push([t, a]); return { ok: true }; } };
  const ctx = {
    name: 'gift', args: {}, store, body, el: body, now: () => now, tab: null,
    every: () => () => {}, on: () => () => {}, subscribe: () => () => {},
    act: (t, a) => { acts.push([t, a]); return { ok: true }; },
    close() {}, setTitle() {}, refreshTabs() {},
    view: { focus() {} },
    ui: { panels: { open: () => true, has: () => true }, toast() {} },
  };
  return { ctx, body, acts };
}

// ---- F2-01 ----------------------------------------------------------------------------------------------------------

test('F2-01: the note field names its button (keepInView keeps both above the keyboard) and the foot stops being sticky while it has the focus', () => {
  const s = farmAt(12);
  give(s, 'rose', 3);
  const r = ctxOf(s);
  G.giftPanel.mount(r.body, r.ctx);
  const field = r.body.querySelector('.rel-gift-field');
  assert.equal(field.dataset.keepInView, 'gift-send', 'the field names the Wrap button');
  const named = r.body.querySelector('[data-act="gift-send"]');
  assert.ok(named && named === r.body.querySelector('[data-gift="send"]'), 'the Wrap button answers to that name');
  const css = fs.readFileSync(new URL('../public/css/panels-rel.css', import.meta.url), 'utf8');
  assert.match(css, /\.hh-panel\.field-on \.rel-gift-foot \{[^}]*position: static/, 'with the keyboard up the foot scrolls with the form');
  assert.match(css, /:has\(\.rel-gift-foot\) \{[^}]*scroll-padding-bottom/, 'a focused tile scrolls clear of the sticky foot');
});

// ---- F2-02 ----------------------------------------------------------------------------------------------------------

test('F2-02: a one-tap note is sent as a token and each screen says it in its own language; typed words stay as typed', async () => {
  const s = farmAt(12);
  give(s, 'rose', 3);
  const r = ctxOf(s);
  G.giftPanel.mount(r.body, r.ctx);
  r.body.querySelector('.rel-gift-grid .pn-stack[data-item="rose"]').click();
  r.body.querySelector('.rel-gift-notes .chip[data-note="feat.gift.note.thanks"]').click();
  r.body.querySelector('[data-gift="send"]').click();
  const sent = r.acts.find(([t]) => t === 'keepsake')[1];
  assert.equal(sent.note, '#thanks', 'never the giver\'s words: "Thank you ♥" reached a Bulgarian phone in English');
  // the rules keep the token as the note (no new shape): the opened gift carries it to the reader
  actOk(s, 'keepsake', sent, { pid: 'p2', now: T0 + HOUR });
  const id = Object.keys(s.farm.gifts)[0];
  const ev = evs(actOk(s, 'openGift', { id }, { pid: 'p1', now: T0 + HOUR + MIN }), 'giftOpened')[0];
  assert.equal(ev.note, '#thanks');
  assert.equal(typeof CGT.noteText, 'function', 'ui/goal-text.js noteText(note): the renderers say a note through it');
  assert.equal(typeof GT.giftNoteKey, 'function');
  for (const [tok, key] of [['#thanks', 'feat.gift.note.thanks'], ['#thinking', 'feat.gift.note.thinking'], ['#because', 'feat.gift.note.because']]) {
    assert.equal(GT.giftNoteKey(tok), key);
  }
  assert.equal(GT.giftNoteKey('#nope'), null, 'an unknown token is just words');
  assert.equal(GT.giftNoteKey('Thank you ♥'), null);
  try {
    await I18N.setLang('bg');
    assert.equal(CGT.noteText('#thanks'), 'Благодаря ти ♥');
    assert.equal(CGT.noteText('за кафето сутрин'), 'за кафето сутрин');
    await I18N.setLang('en');
    assert.equal(CGT.noteText('#thanks'), 'Thank you ♥');
    assert.equal(CGT.noteText('#because'), 'Just because');
    assert.equal(CGT.noteText('for the morning coffee'), 'for the morning coffee');
  } finally { await I18N.setLang('en'); }
});

// ---- F2-03 ----------------------------------------------------------------------------------------------------------

test('F2-03: a confirmed big planting stroke tells the partner (bigSpend); a small or unconfirmed one does not', () => {
  const s = field(21, 10_000, 20);
  const ids = plotIds(s);
  const big = actOk(s, 'plant', { ids, crop: 'pumpkin', confirm: [ERR.BIG_SPEND] }, { pid: 'p2', now: at(15, 14) });
  const ev = evs(big, 'bigSpend');
  assert.equal(ev.length, 1, 'the partner\'s heads-up the dialog promised');
  assert.deepEqual({ by: ev[0].by, what: ev[0].what, acorns: ev[0].acorns, n: ev[0].n }, { by: 'p2', what: 'pumpkin', acorns: 0, n: 20 });
  assert.equal(ev[0].coins, 10_000 - s.farm.wallet.coins, 'the coins the stroke spent');
  const s2 = field(21, 10_000, 20);
  assert.equal(evs(actOk(s2, 'plant', { ids: plotIds(s2), crop: 'pumpkin' }, { pid: 'p2', now: at(15, 14) }), 'bigSpend').length, 0,
    'a drag nobody confirmed stays quiet');
  const s3 = field(21, 300_000, 4);
  assert.equal(evs(actOk(s3, 'plant', { ids: plotIds(s3), crop: 'wheat', confirm: [ERR.BIG_SPEND] }, { pid: 'p2', now: at(15, 14) }), 'bigSpend').length, 0,
    'a confirm on a small stroke is no heads-up');
});

/** A tracker over a fake DOM: the rules' cards from `res`, the shell's calls recorded. */
function tracker(state, res, { pid = 'p1', now = at(15, 14) } = {}) {
  document.body.replaceChildren();
  const box = document.createElement('div');
  box.id = 'tracker';
  document.body.append(box);
  const calls = { do: [], toast: [], confirm: [], setTool: [], focus: [] };
  const S = {
    store: { state, pid, now: () => now, subscribe() {} },
    view: { focus: (x, z) => calls.focus.push([x, z]) },
    ui: {
      panels: { has: () => true, open() { return true; } },
      toast: (...a) => calls.toast.push(a),
      confirm: (o) => { calls.confirm.push(o); return Promise.resolve(true); },
    },
    controller: { do: (t, a) => { calls.do.push([t, a]); return { ok: true }; }, tool: { id: 'hand' },
      TOOLS: [{ id: 'hand' }, { id: 'sickle' }, { id: 'seed_bag' }], setTool: (...a) => calls.setTool.push(a) },
    tutorial: { flash() {} },
  };
  const realInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.window ??= globalThis;
  globalThis.window.addEventListener ??= () => {};
  let tr;
  try { tr = T.createTracker(S); } finally { globalThis.setInterval = realInterval; }
  tr.useRulesGoals(() => res);
  tr.render();
  const nowCard = () => box.querySelector('.goal-slot[data-slot="now"] .goal') ?? box.querySelector('.goal');
  return { tr, S, calls, box, nowCard };
}

test('F2-03: the Plant for later card\'s "are you sure?" says how a planting comes back (pull them up within 10 minutes), not Undo', async () => {
  const s = field(21, 60_000, 82);
  const now = at(15, 14);
  const later = goals(s, 'p1', now, { all: true }).all.find((c) => c.kind === 'later');
  assert.ok(later && later.big, 'the owners\' field at 60,000 coins: a big stroke');
  const t = tracker(s, { now: later, soon: null, big: null }, { now });
  t.nowCard().dispatch('click', { detail: 1 });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(t.calls.toast.length, 0, 'not the generic BIG_SPEND card ("Undo works for 10 minutes")');
  assert.equal(t.calls.confirm.length, 1);
  const copy = t.calls.confirm[0];
  assert.doesNotMatch(copy.fine, /Undo/);
  assert.match(copy.fine, /heads-up/, 'the partner is told (the rules\' bigSpend)');
  assert.match(copy.fine, /10 minutes/);
  assert.match(copy.fine, /pull/i);
  assert.deepEqual(t.calls.do.map(([type, a]) => [type, a.confirm]), [['plant', [ERR.BIG_SPEND]]], 'yes: the stroke, confirmed');
});

// ---- F2-05 ----------------------------------------------------------------------------------------------------------

test('F2-05: no quest card resolves to the "?" crate: every task of all 64 quests shows a real icon', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/icons/manifest.json', import.meta.url), 'utf8'));
  const known = (id) => typeof id === 'string' && Object.hasOwn(manifest.ids, id);
  assert.equal(typeof T.questIcon, 'function', 'tracker.js questIcon(task)');
  const bad = [];
  let n = 0;
  for (const q of CONTENT.quests.values()) {
    for (const task of q.tasks) {
      n++;
      const id = T.questIcon(task);
      if (!known(id)) bad.push(`${q.id} ${task.verb} ${task.ref} -> ${id}`);
    }
  }
  assert.ok(n >= 64);
  assert.deepEqual(bad, []);
  // the two the owners have on their tracker
  assert.equal(T.questIcon(CONTENT.quests.get('h3').tasks[0]), T.questIcon({ verb: 'together', ref: 'help_flag', qty: 3 }));
  assert.equal(T.questIcon({ verb: 'together', ref: 'bench', qty: 1 }), 'bench_swing');
  assert.equal(T.questIcon({ verb: 'harvest', ref: 'wheat', qty: 5 }), 'wheat', 'a content ref is its own icon');
});

test('F2-05: the story card and the SOON quest card carry that icon', () => {
  const s = farmAt(21);
  s.farm.quests.active = { h3: { at: T0 } };
  const cards = T.storyCards(s, T0, 'p1');
  const h3 = cards.find((c) => c.id === 'h3');
  assert.ok(h3);
  assert.equal(h3.icon, T.questIcon(CONTENT.quests.get('h3').tasks[0]));
  const soon = T.cardsFromGoals({ soon: { slot: 'soon', kind: 'quest', id: 'h3', ref: '0', text: 'x', have: 0, need: 3 } }, s, 'p1', T0)[0];
  assert.equal(soon.icon, h3.icon);
});

// ---- F2-06 ----------------------------------------------------------------------------------------------------------

/** The owners' farm in short: a save from before 1.0 at L21, 316,892 coins, no brush tool, a 30-plot best stroke. */
function owners() {
  const s = farmAt(21);
  delete s.farm.coop.born;
  s.farm.wallet.coins = 316_892;
  s.farm.tools = {};
  for (const p of Object.values(s.players)) p.stats.bestHarvestStroke = 30;
  s.farm.quests.active = { h3: { at: T0 }, g2: { at: T0 } };
  return s;
}

test('F2-06: a pre-1.0 farm reaches the brush tip (it introduces a tool nobody there has seen)', () => {
  const s = owners();
  for (const p of Object.values(s.players)) {
    for (const f of CONTENT.features.values()) if (f.card && f.id !== 'brush_tip') p.seen.cards[f.id] = 1;
    p.play.card = 0;
    p.play.n = 100;
  }
  assert.equal(Social.nextSystemCard(s, 'p1', { helper: true }), 'brush_tip');
});

test('F2-06: SOON offers the brush that saves the farm\'s strokes (the Wide Sickle for a harvester), once a day over the quests', () => {
  const s = owners();
  const now = at(15, 20);
  s.farm.daily.play = { d: dayOf(s, now), first: now - 5 * MIN, ok: false };
  const g = goals(s, 'p1', now);
  assert.equal(g.soon.kind, 'brush', `SOON was "${enText(g.soon.msg)}"`);
  assert.equal(g.soon.id, 'wide_sickle', 'not the cheapest (the Big Watering Can) but the one for the biggest stroke');
  // the first look of a day nobody has played yet has it too
  s.farm.daily.play = { d: dayOf(s, now) - 1, first: now - 20 * HOUR, ok: true };
  assert.equal(goals(s, 'p1', now).soon.kind, 'brush');
  // later that day the quests have SOON again (it is a daily turn, not a takeover)
  const later = now + 2 * HOUR;
  s.farm.daily.play = { d: dayOf(s, later), first: now - 5 * MIN, ok: true };
  assert.notEqual(goals(s, 'p1', later).soon.kind, 'brush');
});

test('F2-06: "New in 1.0" mentions the brushes (EN and BG)', async () => {
  const f = FEATURES.find((x) => x.id === 'new_1_0');
  assert.match(f.card.text, /brush/i);
  assert.match(f.card.touchText, /brush/i);
  const BG = (await import('../public/js/i18n/bg/feat.js')).default;
  assert.match(BG['feat.card.new_1_0.text'], /по‑големите сечива от пазара .*наведнъж/);
  assert.match(BG['feat.card.new_1_0.touchText'], /по‑големите от пазара .*наведнъж/);
});

// ---- F2-07 ----------------------------------------------------------------------------------------------------------

test('F2-07: Before bed on an L9-L14 farm with real-sim\'s treasury: a crop of an hour or more when one fits, never "Wheat · 1 min"', () => {
  // real-sim seed 7's evenings (qa-features-econ r2 D3TABLE): L12 with 17,428 coins on 44 plots
  const s = field(12, 17_428, 44);
  const now = at(15, 21);
  const g = goals(s, 'p1', now);
  assert.equal(g.now.kind, 'later', `NOW was "${enText(g.now.msg)}"`);
  assert.ok(g.now.bed);
  assert.ok(cropOf(g.now.ref).growMs >= HOUR, `${g.now.ref} grows ${cropOf(g.now.ref).growMs / MIN} min`);
  assert.ok(g.now.cost <= 17_428 / 2);
  assert.equal(g.now.target.args.ids.length, 44, 'every empty plot');
  // by day the 6 h rule stands: no later card from a 2.5 h crop
  assert.notEqual(goals(s, 'p1', at(15, 14)).now.kind, 'later');
  // below L9 nothing (D3: the feature starts with the first 6 h crop)
  assert.notEqual(goals(field(8, 17_428, 44), 'p1', now).now.kind, 'later');
});

test('F2-07: when nothing of an hour fits, the plain bedtime card names the longest crop that does, with its clock and cost', () => {
  // real-sim seed 7, evening 3: L11 with 3,082 coins on 43 plots (Corn is what half the coins plant everywhere)
  const s = field(11, 3_082, 43);
  const now = at(15, 21);
  const g = goals(s, 'p1', now);
  assert.equal(g.now.kind, 'plant');
  assert.equal(g.now.ref, 'corn');
  assert.ok(g.now.sub, 'a clock and a cost');
  assert.match(enText(g.now.sub), /Corn .* 21:10 .* 774 coins/);
  const card = T.cardsFromGoals({ now: g.now }, s, 'p1', now)[0];
  assert.doesNotMatch(card.sub, /Wheat/, `the card said "${card.sub}"`);
  assert.match(card.sub, /Corn/);
  // a broke farm: nothing fills the field, the plain card as before
  const broke = goals(field(14, 226, 59), 'p1', now).now;
  assert.equal(broke.kind, 'plant');
  assert.equal(broke.sub, undefined);
});

// ---- F2-09 and S2-07 ------------------------------------------------------------------------------------------------

test('F2-09: a double click on a tracker action card acts once (no crate opened, no "already growing")', async () => {
  const s = field(21, 600_000, 10);
  const now = at(15, 14);
  const later = goals(s, 'p1', now, { all: true }).all.find((c) => c.kind === 'later');
  assert.ok(later && !later.big);
  const t = tracker(s, { now: later, soon: null, big: null }, { now });
  const el = t.nowCard();
  el.dispatch('click', { detail: 1 });
  el.dispatch('click', { detail: 2 });
  // the card under the pointer changed after the first act: a quick second press on whatever is there now waits too
  t.nowCard().dispatch('click', { detail: 1 });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(t.calls.do.length, 1, JSON.stringify(t.calls.do));
  // a press after the guard acts again
  await new Promise((r) => setTimeout(r, 650));
  t.nowCard().dispatch('click', { detail: 1 });
  assert.equal(t.calls.do.length, 2);
});

test('S2-07 (ui-shell patch): the NOW plant card arms the Hand with its crop, so the next drag plants', () => {
  const s = field(3, 500, 6);
  const now = at(15, 14);
  const g = goals(s, 'p1', now).now;
  assert.equal(g.kind, 'plant');
  const t = tracker(s, { now: g, soon: null, big: null }, { now });
  t.nowCard().dispatch('click', { detail: 1 });
  assert.equal(t.calls.setTool.length, 1);
  const [id, opts] = t.calls.setTool[0];
  assert.equal(id, 'hand');
  assert.equal(opts.plant, true);
  assert.ok(cropOf(opts.crop), `a crop: ${opts.crop}`);
});

// ---- F2-10 ----------------------------------------------------------------------------------------------------------

test('F2-10: a pick in the gift grid or on a note chip keeps the same button (the keyboard focus stays on it)', () => {
  const s = farmAt(12);
  give(s, 'rose', 3);
  give(s, 'lavender', 2);
  const r = ctxOf(s);
  G.giftPanel.mount(r.body, r.ctx);
  const tile = r.body.querySelector('.rel-gift-grid .pn-stack[data-item="lavender"]');
  tile.click();
  assert.ok(tile.isConnected, 'the picked tile is still in the sheet (a redraw dropped the focus to <body>)');
  assert.equal(tile.getAttribute('aria-selected'), 'true');
  assert.ok(tile.classList.contains('on'));
  const rose = r.body.querySelector('.rel-gift-grid .pn-stack[data-item="rose"]');
  assert.equal(rose.getAttribute('aria-selected'), 'false');
  rose.click();
  assert.ok(tile.isConnected && rose.isConnected);
  assert.equal(tile.getAttribute('aria-selected'), 'false');
  assert.equal(rose.getAttribute('aria-selected'), 'true');
  const chip = r.body.querySelector('.rel-gift-notes .chip[data-note="feat.gift.note.thinking"]');
  chip.click();
  assert.ok(chip.isConnected, 'the pressed chip is still in the sheet');
  assert.equal(chip.getAttribute('aria-pressed'), 'true');
  chip.click();
  assert.equal(chip.getAttribute('aria-pressed'), 'false');
});

// ---- F2-11 ----------------------------------------------------------------------------------------------------------

test('F2-11: the welcome back card names a waiting surprise once (not again under "While you were away")', () => {
  const s = farmAt(12);
  give(s, 'rose', 1);
  s.players.p2.lastSeenAt = T0 - HOUR;
  actOk(s, 'keepsake', { item: 'rose' }, { pid: 'p1', now: T0 });
  const rc = recap(s, 'p2', T0 + 3 * HOUR);
  const sec = (name) => rc.sections.find((x) => x.name === name)?.items ?? [];
  assert.equal(sec('surprises').length, 1);
  assert.equal(sec('partnerDid').filter((r) => r.k === 'surprise' && r.what === 'left').length, 0);
  // once it is opened, the line is history like any other
  const id = Object.keys(s.farm.gifts)[0];
  actOk(s, 'openGift', { id }, { pid: 'p2', now: T0 + 3 * HOUR });
  const rc2 = recap(s, 'p2', T0 + 4 * HOUR, { since: T0 - HOUR });
  assert.equal((rc2.sections.find((x) => x.name === 'partnerDid')?.items ?? []).filter((r) => r.k === 'surprise' && r.what === 'left').length, 1);
});

// ---- patches other lanes sent (S2-01, P2-C2, I2-02) ------------------------------------------------------------------

test('S2-01 (ui-shell patch): the windmill step says where the free Windmill is', () => {
  const step = TUTORIAL.together.find((x) => x.id === 'flour_together');
  assert.match(step.text, /place it from Build \(free\)/);
  assert.match(step.text, /make Flour together/);
});

test('P2-C2 (ui-panels patch): no English line promises "more than the market" without "in coins and XP"', () => {
  const lines = [];
  const walk = (v) => {
    if (typeof v === 'string') { if (/more than the market/i.test(v)) lines.push(v); return; }
    if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(TUTORIAL);
  walk(FEATURES);
  walk([...CONTENT.landmarks?.values?.() ?? []]);
  for (const f of ['features.js', 'landmarks.js', 'tutorial.js', 'story.js']) {
    const src = fs.readFileSync(new URL(`../shared/content/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/[^'`]*more than the market[^'`]*/gi)) lines.push(m[0]);
  }
  assert.ok(lines.length >= 3);
  for (const l of lines) assert.match(l, /in coins and XP/, l);
});

test('I2-02 (infra patch): typed text loses lone surrogates and stacks of marks; nothing visible is refused', () => {
  const p = (note) => parseArgs({ note: V.text(80) }, { note })?.note ?? null;
  assert.equal(p('\ud800 lone'), 'lone', 'a lone surrogate drew "�"');
  assert.equal(p('a\udc00b'), 'ab');
  assert.equal(p('😀 ok'), '😀 ok', 'a real pair stays');
  assert.equal(p(`Z${'́'.repeat(20)}oe`), `Z${'́'.repeat(2)}oe`, 'at most 2 marks per letter');
  assert.equal(p('Ива́'), 'Ива́', 'one accent stays');
  assert.equal(p('​​'), null, 'an invisible name');
  assert.equal(p('​ ⁠ ﻿'), null);
  const s = farmAt(3);
  assert.equal(act(s, 'nameFarm', { name: '​​' }, { pid: 'p1', now: T0 }).code, ERR.BAD_ARGS);
});
