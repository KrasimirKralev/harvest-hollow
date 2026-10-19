// QA r1, ui-shell: the coach after the first tester round.
//   S-02 (fbp#3): on a phone the Build steps' arrow points at the tool slot, then Build in its pop-up, then the card in
//        the build tray; never at the Farm book, which has no Build.
//   S-03 (fbp#4, jde#11): a step that waits for a farm level names the deed that gets there, has an arrow on the field
//        and a progress bar (the XP to go); no more "(when the farm reaches level 2)" and nothing to do for ~105 s.
//   S-05 (fbp#6): a solo farmer is never shown the partner-only steps (say_hello, golden_hour); they come back when
//        the partner is claimed and online.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFarm, T0 } from './helpers.js';
import { xpForLevel, TUTORIAL } from '../shared/content/index.js';
import { installDom } from './ui-qa2-dom.js';

const TUT = await import('../public/js/ui/tutorial.js');
const idx = (list, id) => TUTORIAL[list].findIndex((s) => s.id === id);

/** The fake DOM's document has no querySelector of its own: its body stands in. */
const rootOf = (d) => ({ querySelector: (s) => d.body.querySelector(s), getElementById: (id) => d.getElementById(id) });

test('S-02: on a phone the coop step points at the tool slot, then Build in its pop-up, then the coop card', () => {
  const document = installDom();
  const shown = (el, on = true) => { el.getClientRects = () => (on ? [{}] : []); return el; };
  const add = (parent, tag, props = {}) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'id') el.id = v;
      else if (k === 'cls') el.className = v;
      else el.dataset[k] = v;
    }
    parent.append(el);
    return el;
  };
  // the phone: the dock's Build is folded (hidden), the Farm book's button and the tool slot are on screen
  const dock = add(document.body, 'nav', { id: 'dock' });
  shown(add(dock, 'button', { cls: 'dock-btn', dock: 'build' }), false);
  shown(add(document.body, 'button', { id: 'm-menu-btn' }));
  const fly = add(document.body, 'div', { id: 'tools-flyout' });
  const slot = shown(add(document.body, 'button', { cls: 'tool tool-slot', slot: 'tool' }));
  const sel = TUT.targetOf(makeFarm(), { id: 'place_coop' }, T0).ui;
  assert.match(sel, /\[data-slot="tool"\]/, `the phone's tool slot is in the coop step's chain (HEAD: ${sel})`);
  assert.equal(TUT.uiTargetOf(sel, { root: rootOf(document) }), slot, 'the tool slot, not the Farm book (HEAD: #m-menu-btn)');
  const build = shown(add(fly, 'button', { cls: 'tool tool-build', act: 'build' }));
  assert.equal(TUT.uiTargetOf(sel, { root: rootOf(document) }), build, 'the pop-up is open: Build in it');
  const tray = add(document.body, 'div', { id: 'build-tray' });
  const coop = shown(add(tray, 'button', { cls: 'seed build-card', def: 'coop' }));
  assert.equal(TUT.uiTargetOf(sel, { root: rootOf(document) }), coop, 'the build tray is open: the coop card');
  for (const id of ['place_feed_mill', 'apple_tree']) {
    const s = TUT.targetOf(makeFarm(), { id }, T0).ui;
    assert.match(s, /\[data-slot="tool"\]/, `${id}: the phone's tool slot is in the chain`);
    assert.doesNotMatch(s, /m-menu-btn/, `${id}: never the Farm book`);
  }
  // a desktop: the dock's Build is on screen and comes before the phone's pop-up and slot
  const document2 = installDom();
  const dock2 = document2.createElement('nav'); dock2.id = 'dock'; document2.body.append(dock2);
  const b2 = shown(document2.createElement('button')); b2.dataset.dock = 'build'; dock2.append(b2);
  assert.equal(TUT.uiTargetOf(sel, { root: rootOf(document2) }), b2, 'desktop: the dock\'s Build');
});

/** A solo farmer on Mabel's first order (it waits for level 2) right after the first sale, at level 1. */
function afterFirstSale() {
  const s = makeFarm({ players: ['p1'] });
  s.farm.xp = xpForLevel(2) - 7;
  s.players.p1.tut = { track: 'fields', i: idx('fields', 'first_order'), n: 0, skip: false };
  return s;
}

test('S-03: a step that waits for a level names the deed, its XP to go and an arrow on the field', () => {
  const s = afterFirstSale();
  const c = TUT.coachStep(s, 'p1');
  assert.equal(c.step.id, 'first_order');
  assert.equal(c.waiting, 2, 'the step waits for level 2');
  const f = TUT.waitingFiller(s, c, T0);
  assert.ok(f, 'a filler while the step waits (HEAD: only "(when the farm reaches level 2)", no arrow)');
  assert.equal(f.key, 'dock.coach.grow');
  assert.deepEqual(f.params, { level: 2, n: 7 }, 'the XP to go');
  assert.ok(f.need > 0 && f.have >= 0 && f.have < f.need, `a progress bar: ${f.have}/${f.need}`);
  assert.ok(f.target && f.target.id && s.farm.objects[f.target.id].def === 'plot', `an arrow on a plot: ${JSON.stringify(f.target)}`);
  assert.ok(f.target.tile, 'the arrow has a tile');
  // a ripe plot wins over an empty one (harvesting is the quicker XP)
  const plot = Object.keys(s.farm.objects).sort().find((k) => s.farm.objects[k].def === 'plot' && s.farm.objects[k].x > 0);
  s.farm.objects[plot].crop = { def: 'wheat', plantedAt: T0 - 120_000, readyAt: T0 - 1000, by: 'p1' };
  assert.equal(TUT.waitingFiller(s, c, T0).target.id, plot, 'the ripe plot');
  // not waiting: no filler
  assert.equal(TUT.waitingFiller(s, TUT.coachStep((() => { const x = afterFirstSale(); x.farm.xp = xpForLevel(2); return x; })(), 'p1'), T0), null);
  // the together steps too (flour_together waits for level 3 on a farm whose farmer finished both tracks)
  const s2 = makeFarm({ players: ['p1'] });
  s2.farm.xp = xpForLevel(2) + 3;
  s2.farm.tut = { s: 2, t: 0, n: 0, fin: { fields: 'p1', barnyard: 'p1' } };
  s2.players.p1.tut = { track: null, i: 0, n: 0, skip: true };
  const c2 = TUT.coachStep(s2, 'p1');
  assert.equal(c2.step.id, 'flour_together');
  assert.equal(c2.waiting, 3);
  const f2 = TUT.waitingFiller(s2, c2, T0);
  assert.deepEqual(f2.params, { level: 3, n: xpForLevel(3) - s2.farm.xp });
  assert.ok(f2.target && f2.target.tile, 'an arrow on the field');
});

test('S-03: both catalogs carry the filler line with {level} and {n}', async () => {
  const en = (await import('../public/js/i18n/en/dock.js')).default;
  const bg = (await import('../public/js/i18n/bg/dock.js')).default;
  for (const cat of [en, bg]) {
    assert.match(cat['dock.coach.grow'], /\{level\}/);
    assert.match(cat['dock.coach.grow'], /\{n\}/);
  }
  assert.doesNotMatch(bg['dock.coach.grow'], /XP/, 'опит, never XP, in Bulgarian');
});

/** A farm at level 4 whose shared list is on `step`, the farmer's own tracks finished. */
function together(step, players) {
  const s = makeFarm({ players });
  s.farm.xp = xpForLevel(4);
  s.farm.tut = { s: 2, t: idx('together', step), n: 0, fin: { fields: 'p1', barnyard: 'p1' } };
  s.players.p1.tut = { track: null, i: 0, n: 0, skip: true };
  return s;
}

test('S-05: a solo farmer is never shown say_hello or golden_hour; with the partner claimed and online they show', () => {
  for (const step of ['say_hello', 'golden_hour']) {
    const solo = together(step, ['p1']);
    const c = TUT.coachStep(solo, 'p1');
    assert.notEqual(c?.step.id, step, `solo: no ${step} (HEAD: ${step})`);
    const away = together(step, ['p1', 'p2']);
    assert.notEqual(TUT.coachStep(away, 'p1', { partnerOnline: false })?.step.id, step, `partner away: no ${step}`);
    const here = together(step, ['p1', 'p2']);
    assert.equal(TUT.coachStep(here, 'p1', { partnerOnline: true })?.step.id, step, `partner online: ${step} comes back`);
  }
  // the steps a farmer can finish alone still show solo
  assert.equal(TUT.coachStep(together('apple_tree', ['p1']), 'p1')?.step.id, 'apple_tree');
  assert.equal(TUT.coachStep((() => { const s = together('flour_together', ['p1']); return s; })(), 'p1')?.step.id, 'flour_together');
  assert.deepEqual([...TUT.PARTNER_STEPS].sort(), ['golden_hour', 'say_hello']);
});

// QA r1 S-21 (jde#14): the arrow on Build came in from up-left right over Grandma's "Name your farm" chip (the tester's
// rects at 1366 x 768: Build 885-962 x 597-677, the chip 806-940 x 613-647). The arrow's box is computed, and a way
// that lands on her card is not taken.
test('S-21: the arrow\'s box; the up-left way onto Build crosses the card, straight down from above does not', () => {
  assert.equal(typeof TUT.arrowBox, 'function', 'tutorial.js arrowBox(x, y, deg)');
  // the 48 x 64 arrow above its tip, with its 12 px bob away from the tip (QA r2 S-09: at the top of the bob it touched
  // the tile above)
  assert.deepEqual(TUT.arrowBox(100, 100, 0), { left: 76, right: 124, top: 12, bottom: 88 }, 'the 48 x 64 arrow above its tip, and its bob');
  const build = { left: 885, right: 962, top: 597, bottom: 677, width: 77 };
  const card = { left: 520, right: 944, top: 600, bottom: 660 };
  const diag = TUT.arrowBox(build.left + build.width * 0.3, build.top + 8, -38);
  assert.ok(TUT.overlaps(diag, card), `the HEAD way crosses her card: ${JSON.stringify(diag)}`);
  const down = TUT.arrowBox(build.left + build.width / 2, build.top - 4, 0);
  assert.ok(!TUT.overlaps(down, card), `straight down stays clear: ${JSON.stringify(down)}`);
});

// QA r1 S-18 (fbp#18): after the sixth plot the coach switched to the harvest line at 0/6 while every plot still grew,
// for up to a minute, with no word of when. The card ticks "ripe in 0:42" until the first one is ripe.
test('S-18: the harvest step says when the first crop ripens, while none is ripe yet', () => {
  assert.equal(typeof TUT.ripeEta, 'function', 'tutorial.js ripeEta(state, step, now)');
  const s = makeFarm({ players: ['p1'] });
  const step = TUTORIAL.fields.find((x) => x.id === 'harvest_wheat');
  const plots = Object.keys(s.farm.objects).sort().filter((k) => s.farm.objects[k].def === 'plot');
  s.farm.objects[plots[0]].crop = { def: 'wheat', plantedAt: T0, readyAt: T0 + 60_000, by: 'p1' };
  s.farm.objects[plots[1]].crop = { def: 'wheat', plantedAt: T0, readyAt: T0 + 42_000, by: 'p1' };
  assert.equal(TUT.ripeEta(s, step, T0), 42_000, 'the soonest one');
  assert.equal(TUT.clock(42_000), '0:42');
  assert.equal(TUT.clock(61_500), '1:02');
  assert.equal(TUT.ripeEta(s, step, T0 + 42_000), null, 'one is ripe: the arrow says where, no countdown');
  assert.equal(TUT.ripeEta(s, TUTORIAL.fields.find((x) => x.id === 'plant_wheat'), T0), null, 'not a harvest step');
  const en = TUT.clock(42_000);
  assert.ok(en.length <= 5);
});
