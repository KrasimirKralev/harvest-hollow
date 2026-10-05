// Feed clarity (owner report 2026-10-04): the Feed Mill showed "0/3 any grain" while the Barn held 76 Wheat, because
// Wheat was marked "not for feed" by an accidental click on the Barn's "Feed ok" chip. Covered here:
//   - crafting.feedWalk is the rules' own walk: inputsFor's outcome is unchanged (a verbatim copy of the old loop on
//     fuzzed barns), and the panel model agrees with the rules (blocked <=> inputsFor null, confirmable <=> RESERVED)
//   - the three exclusions in words, with their one-tap way out: "not for feed" (Allow for feed), Keep N (Stop
//     keeping), "worth too much" (Use anyway -> the RESERVED card, whose copy names what it takes)
//   - the muted line when the feed can be made anyway; nothing for fixed-input recipes
//   - the item bubble of a class chip counts what the Feed Mill may USE and lists why a member is skipped
//   - DOM (tiny fake DOM): the Barn's "Animal feed" switch (role=switch, aria-checked, words), its Undo toast round
//     trip through the same action; the Feed Mill card's line and Allow button; a toast's action button
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';
import { farmAt, give, allLand, placeDef, must, T0 } from './helpers/rules.js';
import { mulberry32 } from './helpers.js';
import { classMembers, itemOf, feedOf, live, recipesOf } from '../shared/content/index.js';
import { unkept } from '../shared/rules/economy.js';
import { inputsFor, feedWalk, FEED_VALUABLE_MUL } from '../shared/rules/actions/crafting.js';
import { ERR } from '../shared/net/protocol.js';
import * as M from '../public/js/ui/panels/model.js';
import { probe } from '../public/js/ui/panels/core.js';
import { I, actUndoable, UNDO_MS } from '../public/js/ui/panels/intents.js';
import { itemHint, haveLine } from '../public/js/ui/item-sources.js';
import { softCopy } from '../public/js/ui/dialogs.js';

installDom();
globalThis.requestAnimationFrame ??= () => 0;

const CHICKEN = feedOf('chicken_feed');
const store = (state, pid = 'p1', now = T0) => ({ state, pid, now: () => now });

/** A level-7 farm with a Feed Mill and `inv` in the Barn (setup writes the state directly). */
function mill(inv = {}) {
  const s = farmAt(7);
  allLand(s);
  const id = placeDef(s, 'feed_mill');
  for (const [item, n] of Object.entries(inv)) give(s, item, n);
  return { s, id };
}
const feedCard = (s, id, recipe = 'chicken_feed') => M.buildingView(s, id, T0).recipes.find((r) => r.id === recipe);

/** inputsFor's class branch exactly as it was before feedWalk (2026-10-04): the outcome must not move. */
function oldInputsFor(state, r, { valuable = false } = {}) {
  const take = {};
  for (const { cls, qty } of r.classes) {
    let need = qty;
    for (const item of classMembers(cls)) {
      if (need === 0) break;
      if (state.farm.noFeed[item]) continue;
      if (!valuable && (itemOf(item)?.sell ?? 0) > FEED_VALUABLE_MUL * (r.sell ?? 0)) continue;
      const k = Math.min(need, unkept(state, item) - (take[item] ?? 0));
      if (k <= 0) continue;
      take[item] = (take[item] ?? 0) + k;
      need -= k;
    }
    if (need > 0) return null;
  }
  return take;
}

test('feedWalk is inputsFor: the same take on 300 fuzzed barns, every feed and two odd recipes', () => {
  const rnd = mulberry32(20261004);
  const recipes = [...live('feeds'), { id: 'x', classes: [{ cls: 'grain', qty: 2 }, { cls: 'produce', qty: 3 }], sell: 3 },
    { id: 'y', classes: [{ cls: 'root', qty: 2 }] }];
  const members = [...new Set(recipes.flatMap((r) => r.classes.flatMap(({ cls }) => classMembers(cls))))];
  for (let n = 0; n < 300; n++) {
    const s = farmAt(30);
    for (const item of members) {
      if (rnd() < 0.5) s.farm.inventory[item] = Math.floor(rnd() * 7);
      if (rnd() < 0.15) s.farm.overflow[item] = 1 + Math.floor(rnd() * 3);
      if (rnd() < 0.2) s.farm.keep[item] = { n: Math.floor(rnd() * 6), by: 'p1' };
      if (rnd() < 0.2) s.farm.noFeed[item] = true;
    }
    for (const r of recipes) {
      for (const valuable of [false, true]) {
        assert.deepEqual(inputsFor(s, r, { valuable }), oldInputsFor(s, r, { valuable }), `${r.id} valuable=${valuable} #${n}`);
        assert.deepEqual(feedWalk(s, r, { valuable }).take, oldInputsFor(s, r, { valuable }));
      }
      if (!live('feeds').includes(r)) continue;
      // the panel model tells the same story as the rules
      const k = M.feedSkips(s, r);
      assert.equal(k.blocked, inputsFor(s, r) === null, `${r.id} #${n} blocked`);
      assert.equal(k.confirmable, inputsFor(s, r) === null && inputsFor(s, r, { valuable: true }) !== null, `${r.id} #${n} confirmable`);
      const rows = M.inputsOf(s, r);
      assert.equal(rows.every((x) => x.have >= x.need), inputsFor(s, r) !== null, `${r.id} #${n} chips`);
      for (const x of k.lines) assert.ok(x.text.startsWith(`${itemOf(x.id).name} `) && !/undefined|NaN/.test(x.text), x.text);
    }
  }
});

test('"not for feed": the owner\'s farm says which grain and why, and Allow for feed fixes it through the action', () => {
  const { s, id } = mill({ wheat: 76 });
  must(s, 'noFeed', { item: 'wheat', on: true });
  const r = feedCard(s, id);
  const grain = r.inputs[0];
  assert.deepEqual([grain.have, grain.need], [0, 3], 'the chip still says 0/3: that is what the rules use');
  assert.deepEqual(grain.skipped.map((x) => [x.id, x.n, x.why]), [['wheat', 76, 'noFeed']]);
  assert.equal(r.skips.blocked, true);
  assert.deepEqual(r.skips.lines.map((x) => x.text), ['Wheat 76 — marked "not for feed" in the Barn']);
  assert.deepEqual(r.skips.lines[0].fix, { kind: 'allow', label: 'Allow for feed' });
  assert.equal(probe(store(s), 'craft', { id, recipe: 'chicken_feed' }), ERR.NO_ITEMS);
  // the button sends the normal noFeed action
  const it = I.noFeed('wheat', false);
  assert.equal(probe(store(s), it.type, it.args), null);
  must(s, it.type, it.args);
  const after = feedCard(s, id);
  assert.deepEqual([after.inputs[0].have, after.skips.blocked, after.skips.lines.length], [76, false, 0]);
  assert.equal(M.quietText(after.skips.quiet), '', 'nothing is skipped any more: no line at all');
});

test('Keep N: "all 76 kept (Keep 80)" with Stop keeping; a partial keep says how many', () => {
  const { s, id } = mill({ wheat: 76 });
  must(s, 'keep', { item: 'wheat', n: 80 });
  let r = feedCard(s, id);
  assert.deepEqual(r.skips.lines.map((x) => [x.text, x.fix?.kind]), [['Wheat 76 — all 76 kept (Keep 80)', 'unkeep']]);
  assert.equal(r.skips.lines[0].keepBy, 'p1');
  must(s, 'keep', { item: 'wheat', n: 75 });
  r = feedCard(s, id);
  assert.deepEqual(r.inputs[0].have, 1);
  assert.deepEqual(r.skips.lines.map((x) => x.text), ['Wheat 76 — 75 kept (Keep 75)']);
  must(s, I.keep('wheat', 0).type, I.keep('wheat', 0).args);
  r = feedCard(s, id);
  assert.equal(r.skips.blocked, false);
  assert.equal(r.skips.lines.length, 0);
});

test('"worth too much": the line, Use anyway is the craft press (RESERVED), and the card names what it takes', () => {
  const { s, id } = mill({ sunflower: 12 });
  s.farm.xp = farmAt(11).farm.xp;
  const r = feedCard(s, id);
  assert.deepEqual(r.skips.lines.map((x) => [x.text, x.fix?.kind]), [['Sunflower 12 — worth too much to feed without asking', 'confirm']]);
  assert.equal(r.skips.confirmable, true);
  assert.deepEqual(r.skips.ask, { sunflower: 3 });
  assert.equal(probe(store(s), I.craft(id, 'chicken_feed').type, I.craft(id, 'chicken_feed').args), ERR.RESERVED);
  const copy = softCopy(ERR.RESERVED, { state: s, pid: 'p1', args: { id, recipe: 'chicken_feed' } });
  assert.equal(copy.lead, 'Use 3 Sunflowers for Chicken Feed?');
  assert.match(copy.body, /^Sunflowers sell for 335 coins each; Chicken Feed is worth 2\./);
  assert.equal(copy.ok, 'Use anyway');
  // a sale's Keep N card is unchanged
  assert.match(softCopy(ERR.RESERVED, { state: s, pid: 'p1', args: { item: 'egg' } }).lead, /kept for later/);
  // even a confirm would fall short: the line explains, no button promises what the rules will not do
  const { s: few, id: id2 } = mill({ sunflower: 1 });
  const r2 = feedCard(few, id2);
  assert.deepEqual(r2.skips.lines.map((x) => [x.why, x.fix]), [['valuable', null]]);
  assert.equal(r2.skips.confirmable, false);
});

test('the feed can be made: one muted line for items marked "not for feed", nothing for kept or valuable ones', () => {
  const { s, id } = mill({ wheat: 76, corn: 5, sunflower: 4 });
  must(s, 'noFeed', { item: 'wheat', on: true });
  must(s, 'keep', { item: 'corn', n: 1 });
  const r = feedCard(s, id);
  assert.equal(r.skips.blocked, false);
  assert.equal(r.skips.lines.length, 0);
  assert.equal(M.quietText(r.skips.quiet), 'Not used for feed: Wheat 76 (marked in the Barn)');
  // fixed-input recipes never get a skip line
  const { s: b } = mill({});
  const bakery = placeDef(b, 'bakery');
  for (const x of M.buildingView(b, bakery, T0).recipes) {
    assert.equal(x.skips, null, x.id);
    for (const y of x.inputs) assert.equal(y.skipped, undefined);
  }
  assert.ok(recipesOf('bakery').length > 0);
});

test('the class chip\'s bubble counts what the Feed Mill may use and says why Wheat is skipped', () => {
  const { s } = mill({ wheat: 76 });
  must(s, 'noFeed', { item: 'wheat', on: true });
  const m = itemHint('wheat', s, { need: 3, cls: 'grain', recipe: 'chicken_feed', now: T0 });
  assert.equal(haveLine(m), '0 / 3 grain usable for feed · need 3 more');
  assert.deepEqual(m.cls.rows.map((x) => [x.text, x.fix?.kind]), [['Wheat 76 — marked "not for feed" in the Barn', 'allow']]);
  assert.deepEqual(m.cls.none, ['Corn', 'Oats', 'Rice', 'Sunflower']);
  // without a recipe (any other anchor) the bubble is what it was
  const plain = itemHint('wheat', s, { need: 3, cls: 'grain', now: T0 });
  assert.equal(haveLine(plain), '76 / 3 in the barn · enough');
  assert.equal(plain.cls.rows, undefined);
  // Keep N: Stop keeping only while the class is short
  const { s: k } = mill({ wheat: 76, corn: 9 });
  must(k, 'keep', { item: 'wheat', n: 80 });
  const ok = itemHint('wheat', k, { need: 3, cls: 'grain', recipe: 'chicken_feed', now: T0 });
  assert.deepEqual(ok.cls.rows.map((x) => [x.id, x.why, x.fix]), [['wheat', 'kept', null], ['corn', null, null]]);
  assert.equal(haveLine(ok), '9 / 3 grain usable for feed · enough');
});

test('actUndoable: the action, then an Undo toast that sends the opposite through the same act', () => {
  const sent = [];
  const toasts = [];
  const act = (type, args) => { sent.push([type, args]); return { ok: true }; };
  const r = actUndoable(act, (text, o) => toasts.push([text, o]), I.noFeed('wheat', true), I.noFeed('wheat', false), M.noFeedText('wheat', true));
  assert.equal(r.ok, true);
  assert.deepEqual(sent, [['noFeed', { item: 'wheat', on: true }]]);
  assert.equal(toasts[0][0], "Wheat won't be used for animal feed");
  assert.equal(toasts[0][1].ms, UNDO_MS);
  assert.equal(toasts[0][1].action.label, 'Undo');
  toasts[0][1].action.fn();
  assert.deepEqual(sent[1], ['noFeed', { item: 'wheat', on: false }]);
  // a refused action offers no Undo
  const none = [];
  actUndoable(() => ({ ok: false, code: 'ALREADY_DONE' }), (t) => none.push(t), I.keep('wheat', 0), I.keep('wheat', 5), M.unkeepText('wheat', 5));
  assert.equal(none.length, 0);
  assert.equal(M.unkeepText('wheat', 80), "Wheat isn't kept any more (was Keep 80)");
  assert.equal(M.noFeedText('corn', false), 'Corn can be used for animal feed again');
});

/** A panel ctx on a real state: act runs the real rules, toasts are recorded. */
function panelCtx(s, args = {}) {
  const sent = [];
  const toasts = [];
  const st = store(s);
  const ctx = {
    name: 'test', args, store: st, now: () => T0, every: () => () => {}, setTitle() {}, open() {},
    act: (type, a) => { sent.push([type, a]); return must(s, type, a); },
    ui: { toast: (text, o) => toasts.push([text, o]), panels: { retitle() {}, has: () => false } },
  };
  return { ctx, sent, toasts };
}

test('DOM: the Barn\'s "Animal feed" switch says its state in words, is a switch, and its Undo puts it back', async () => {
  const { barnPanel } = await import('../public/js/ui/panels/barn.js');
  const { s } = mill({ wheat: 76, egg: 3 });
  must(s, 'noFeed', { item: 'wheat', on: true });
  const body = document.createElement('div');
  document.body.append(body);
  const { ctx, sent, toasts } = panelCtx(s);
  const inst = barnPanel.mount(body, ctx);
  assert.ok(barnPanel.topics.includes('noFeed'), 'a noFeed change re-renders the Barn');
  const sw = () => body.querySelector('[data-key="nofeed-wheat"]');
  assert.equal(sw().getAttribute('role'), 'switch');
  assert.equal(sw().getAttribute('aria-checked'), 'false');
  assert.equal(textOf(sw()), 'Animal feed: not allowed');
  assert.match(sw().getAttribute('aria-label'), /Wheat: animal feed not allowed/);
  assert.equal(body.querySelector('[data-key="nofeed-egg"]'), null, 'eggs are no feed ingredient: no switch');
  sw().click();
  assert.deepEqual(sent.at(-1), ['noFeed', { item: 'wheat', on: false }]);
  assert.equal(toasts.at(-1)[0], 'Wheat can be used for animal feed again');
  inst.update();
  assert.equal(sw().getAttribute('aria-checked'), 'true');
  assert.equal(textOf(sw()), 'Animal feed: allowed');
  assert.ok(sw().classList.contains('on'));
  toasts.at(-1)[1].action.fn();                           // Undo
  assert.deepEqual(sent.at(-1), ['noFeed', { item: 'wheat', on: true }]);
  inst.update();
  assert.equal(sw().getAttribute('aria-checked'), 'false');
  body.remove();
});

test('DOM: the Feed Mill card shows the skipped Wheat and its Allow button; the chip names the feed for its bubble', async () => {
  const { buildingPanel } = await import('../public/js/ui/panels/building.js');
  const { s, id } = mill({ wheat: 76 });
  must(s, 'noFeed', { item: 'wheat', on: true });
  const body = document.createElement('div');
  document.body.append(body);
  const { ctx, sent, toasts } = panelCtx(s, { id });
  const inst = buildingPanel.mount(body, ctx);
  assert.ok(buildingPanel.topics.includes('noFeed'));
  const card = body.querySelector('[data-recipe="chicken_feed"]');
  const line = card.querySelector('.pn-skip');
  assert.equal(textOf(line.querySelector('.pn-skip-text')), 'Wheat 76 — marked "not for feed" in the Barn');
  const chipEl = card.querySelector('[data-hint-cls="grain"]');
  assert.equal(chipEl.dataset.hintRecipe, 'chicken_feed');
  assert.equal(chipEl.dataset.item, 'wheat', 'the chip pictures the held-back Wheat');
  const allow = line.querySelector('[data-fix="allow"]');
  assert.equal(allow.tagName, 'BUTTON');
  assert.equal(textOf(allow), 'Allow for feed');
  allow.click();
  assert.deepEqual(sent.at(-1), ['noFeed', { item: 'wheat', on: false }]);
  assert.equal(toasts.at(-1)[0], 'Wheat can be used for animal feed again');
  inst.update();
  assert.equal(body.querySelector('[data-recipe="chicken_feed"] .pn-skip'), null, 'fixed: the line is gone');
  inst.destroy?.();
  body.remove();
  // "worth too much": Use anyway is the craft press, enabled (soft), and says why it asks in feed words, not Keep N's
  const { s: v, id: vid } = mill({ sunflower: 12 });
  const vbody = document.createElement('div');
  document.body.append(vbody);
  const { ctx: vctx } = panelCtx(v, { id: vid });
  const vinst = buildingPanel.mount(vbody, vctx);
  const use = vbody.querySelector('[data-recipe="chicken_feed"] [data-fix="confirm"]');
  assert.equal(textOf(use.querySelector('.pn-btn-label')), 'Use anyway…');
  assert.equal(use.getAttribute('aria-disabled'), null, 'a soft code keeps it pressable');
  assert.equal(use.title, 'Asks first: what is left is worth a lot');
  assert.equal(vbody.querySelector('[data-recipe="chicken_feed"] [data-craft="chicken_feed"]').title, 'Asks first: what is left is worth a lot');
  vinst.destroy?.();
  vbody.remove();
});

test('DOM: a toast with an action gets a button above the panels; pressing it runs the action once', async () => {
  const { createToasts } = await import('../public/js/ui/toasts.js');
  const hud = document.createElement('div');
  hud.id = 'hud';
  const box = document.createElement('div');
  box.id = 'toasts';
  const banners = document.createElement('div');
  banners.id = 'banners';
  hud.append(box, banners);
  document.body.append(hud);
  globalThis.matchMedia ??= () => ({ matches: false });
  const t = createToasts({ store: null }, (c) => c);
  let undone = 0;
  const el = t.toast("Wheat won't be used for animal feed", { kind: 'ok', ms: 50, action: { label: 'Undo', fn: () => { undone++; } } });
  assert.equal(el.parentNode.id, 'snacks', 'an action toast lives in #snacks, not under the panels');
  const b = el.querySelector('.toast-act');
  assert.equal(textOf(b), 'Undo');
  b.click();
  assert.equal(undone, 1);
  // a tap on the line itself (not its button) sends it away without undoing anything
  const other = t.toast('Corn can be used for animal feed again', { ms: 5000, action: { label: 'Undo', fn: () => { undone++; } } });
  other.click();
  assert.ok(other.classList.contains('leaving'));
  assert.equal(undone, 1);
  // a plain toast stays where it always was
  const plain = t.toast('Planted', { ms: 50 });
  assert.equal(plain.parentNode.id, 'toasts');
  await new Promise((r) => setTimeout(r, 400));
  hud.remove();
  document.getElementById('snacks')?.remove();
});
