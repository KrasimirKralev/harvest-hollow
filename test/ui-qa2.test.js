// QA wave 2 (docs/qa/qa2/TRIAGE.md, section 4 "ui"): regression tests of the ui fixes. Each test names its task id.
// The visible parts are checked with before/after screenshots (docs/qa/qa2/status-ui.md lists them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';
import { farmAt } from './helpers/rules.js';
import { T0 } from './helpers.js';
import { CONTENT, live } from '../shared/content/index.js';
import { resetGrid } from '../shared/rules/grid-cache.js';
import { landCards } from '../public/js/ui/panels/model.js';
import { landCard, proofLine } from '../public/js/ui/panels/market.js';
import { createKit } from '../public/js/ui/panels/kit.js';

installDom();

const noJunk = (t) => assert.ok(typeof t === 'string' && t && !/undefined|null|NaN|\[object/.test(t), `bad text: ${t}`);

/** The panel ctx a kit needs, on a plain state (no store, no network). */
function panelCtx(state, pid = 'p1') {
  const store = { state, pid, act: () => ({ ok: true }), now: () => T0 };
  return { name: 'market', store, now: () => T0, act: () => ({ ok: true }), every: () => {} };
}

test('UI-01: every live expansion proof task has a line, alternatives joined by "or", orders in the plural', () => {
  for (const e of live('expansions')) {
    for (const p of e.proof ?? []) noJunk(proofLine(p));
  }
  assert.equal(proofLine({ verb: 'make', ref: ['cotton_tote', 'wool_pillow'], qty: 3 }), 'Make 3 Cotton Totes or Wool Pillows');
  assert.equal(proofLine({ verb: 'fill', ref: 'order', qty: 10 }), 'Fill 10 orders');
  assert.equal(proofLine({ verb: 'harvest', ref: 'wheat', qty: 30 }), 'Harvest 30 Wheat');
  assert.equal(proofLine({ verb: 'own', ref: 'apple_tree', qty: 2 }), 'Own 2 Apple Trees');
  assert.equal(proofLine({ verb: 'make', ref: 'goat_cheese', qty: 3 }), 'Make 3 Goat Cheese');
});

test('UI-01: the Land tab renders every live expansion card (owned or not) without throwing', () => {
  const fresh = farmAt(25);
  const owned = farmAt(25);
  owned.farm.expansions = live('expansions').map((e) => e.id);
  resetGrid(owned);
  // the parcel before Riverbank owned: Riverbank (array proof) is the next card, its proof card open
  const river = farmAt(25);
  const riverbank = CONTENT.expansions.get('riverbank');
  river.farm.expansions = live('expansions').filter((e) => e.k > 0 && e.k < riverbank.k).map((e) => e.id);
  river.farm.proofs = { riverbank: { at: T0, n: {} } };
  resetGrid(river);
  for (const state of [fresh, owned, river]) {
    const ctx = panelCtx(state);
    const kit = createKit(ctx);
    const cards = landCards(state, { now: T0, pid: 'p1' });
    assert.equal(cards.length, live('expansions').filter((e) => e.k > 0).length);
    for (const c of cards) {
      const el = landCard(c, ctx, kit, false);
      const text = textOf(el);
      noJunk(text);
      assert.equal(Boolean(el.querySelector('ul.pn-reqs')), !c.owned, `${c.id}: a checklist only while not ours`);
    }
  }
  const rb = landCards(river, { now: T0, pid: 'p1' }).find((c) => c.id === 'riverbank');
  assert.ok(rb && rb.isNext && !rb.owned);
  assert.match(textOf(landCard(rb, panelCtx(river), createKit(panelCtx(river)))), /Make 3 Cotton Totes or Wool Pillows/);
});

// ---- UI-03: one folded row under NOW, calm badges -----------------------------------------------------------------

test('UI-03: the rows under NOW fold into one summary (tags, icons, the letters as one count) with a spoken label', async () => {
  const { restSummary } = await import('../public/js/ui/tracker.js');
  const rest = [{ slot: 'soon', title: 'Good Soil', icon: 'compost' }, { slot: 'big', title: 'Level Up', glyph: 'star' }];
  const story = [{ title: 'Hen House Calls', icon: 'egg' }, { title: 'Open for Business' }];
  const { segs, label } = restSummary(rest, story);
  assert.deepEqual(segs.map((x) => x.tag), ['SOON', 'BIG', '2']);
  assert.equal(segs[0].icon, 'compost');
  assert.equal(segs[1].glyph, 'star');
  assert.equal(segs[2].letters, 2);
  assert.match(label, /SOON: Good Soil\. BIG: Level Up\. STORY: Hen House Calls, Open for Business/);
  assert.deepEqual(restSummary([], []).segs, []);
});

test('UI-03: red badges only for "look now" (a spilling Barn, a partner waiting); the rest are calm', async () => {
  const { BADGE_TONE, badgesFor } = await import('../public/js/ui/panels/badges.js');
  for (const k of Object.keys(badgesFor(farmAt(5), 'p1', T0))) assert.ok(Object.hasOwn(BADGE_TONE, k), `${k} has a tone`);
  assert.equal(BADGE_TONE.orders, 'calm');
  assert.equal(BADGE_TONE.journal, 'calm');
  assert.equal(BADGE_TONE.barn, null);
  assert.equal(BADGE_TONE.market, null);
  // the registry keeps the tone with the value and drops it with the badge
  const { ui } = await import('../public/js/ui/index.js');
  const seen = [];
  ui.panels.on('badge', (name, v) => seen.push([name, v]));
  const off = ui.panels.register('qa2-tone', { title: 'x', mount() {} });
  ui.panels.badge('qa2-tone', 2, 'calm');
  assert.equal(ui.panels.list().find((p) => p.name === 'qa2-tone').badgeTone, 'calm');
  ui.panels.badge('qa2-tone', 2);
  assert.equal(ui.panels.list().find((p) => p.name === 'qa2-tone').badgeTone, null, 'the same count turning urgent re-renders');
  ui.panels.badge('qa2-tone', null, 'calm');
  assert.equal(ui.panels.list().find((p) => p.name === 'qa2-tone').badgeTone, null);
  assert.equal(seen.length, 3);
  off?.();
});

// ---- UI-09: the order card says what it asks ------------------------------------------------------------------------

test('UI-09: an order card has a sub line: its first goods, how many more, and the pay', async () => {
  const { orderLine, cardsFromGoals } = await import('../public/js/ui/tracker.js');
  const o = { items: { potato: 39, cabbage: 10, strawberry: 51, onion: 47 }, coins: 28990 };
  assert.equal(orderLine(o), '10 Cabbage, 47 Onions +2 more · 28,990 coins');
  assert.equal(orderLine({ items: { wheat: 8 }, coins: 19 }), '8 Wheat · 19 coins');
  assert.equal(orderLine(null), '');
  const s = farmAt(12);
  s.farm.orders = { ...s.farm.orders, slots: { ...s.farm.orders?.slots, 3: { order: { n: 3, items: { egg: 4 }, coins: 120, golden: { giver: 'reed' } } } } };
  const [card] = cardsFromGoals({ now: { kind: 'order', text: 'Fill a golden order', ref: '3' } }, s, 'p1', T0);
  assert.equal(card.title, 'Fill a golden order');
  assert.equal(card.sub, '4 Eggs · 120 coins');
});

// ---- UI-10 / UI-11: words for NOT_NEEDED, no toast for bookkeeping refusals ------------------------------------------

test('UI-10: the soft NOT_NEEDED answer has its own words (never "Unlocks at a higher farm level")', async () => {
  const { errText } = await import('../public/js/ui/index.js');
  assert.equal(errText('NOT_NEEDED'), 'Quick crops don\'t need water.');
});

test('UI-11: a refused markSeen / tutDone never toasts (another tab or the partner got there first)', async () => {
  const { quietRefusal } = await import('../public/js/ui/index.js');
  assert.equal(quietRefusal('ALREADY_DONE', { type: 'markSeen' }), true);
  assert.equal(quietRefusal('NOT_FOUND', { type: 'tutDone' }), true);
  assert.equal(quietRefusal('ALREADY_DONE', { type: 'fairEnter' }), false, 'a real action still says why');
  assert.equal(quietRefusal('ALREADY_DONE', {}), false);
  assert.equal(quietRefusal('Mia arrived', { type: 'markSeen' }), false, 'plain words are not refusals');
});

// ---- UI-12: the compare cut follows the thumb ------------------------------------------------------------------------

test('UI-12: the compare cut sits under the 44 px thumb centre at every value', async () => {
  const { cutAt } = await import('../public/js/ui/panels/restoration.js');
  assert.equal(cutAt(0), 'calc(22px + (100% - 44px) * 0)');
  assert.equal(cutAt(55), 'calc(22px + (100% - 44px) * 0.55)');
  assert.equal(cutAt(140), 'calc(22px + (100% - 44px) * 1)');
});

// ---- UI-13: a Giant is said once in the feed --------------------------------------------------------------------------

test('UI-13: a Giant\'s nine plots leave the harvest line (or the line goes); other harvests stay', async () => {
  const { foldGiants, feedText } = await import('../public/js/ui/feed.js');
  const giant = { at: T0, by: 'p1', k: 'giant', crop: 'pumpkin', q: 55 };
  const only = { at: T0, by: 'p1', k: 'harvest', item: 'pumpkin', q: 55, p: 9 };
  assert.deepEqual(foldGiants([only, giant]), [giant], 'the stroke was only the Giant: its line goes');
  const more = { at: T0 + 2000, by: 'p1', k: 'harvest', item: 'pumpkin', q: 61, p: 12 };
  const out = foldGiants([more, giant]);
  assert.equal(out.length, 2);
  assert.equal(out[0].q, 6);
  assert.equal(out[0].p, 3);
  const s = farmAt(20);
  assert.match(feedText(out[0], s, 'p1').text, /harvested 6 Pumpkins/);
  const mia = { at: T0, by: 'p2', k: 'harvest', item: 'pumpkin', q: 9, p: 1 };
  const wheat = { at: T0, by: 'p1', k: 'harvest', item: 'wheat', q: 30, p: 6 };
  assert.deepEqual(foldGiants([mia, wheat, giant]), [mia, wheat, giant], 'the partner\'s and other crops stay');
  const pairs = foldGiants([[7, only], [8, giant]], ([, r]) => r, ([i], r) => [i, r]);
  assert.deepEqual(pairs, [[8, giant]], 'ring pairs keep their row numbers (Thanks)');
});

// ---- UI-14: the naming card belongs to a new farm ---------------------------------------------------------------------

test('UI-14: Grandma\'s welcome and the naming card show on a new farm only', async () => {
  const { namingDue, coachStep, NAMING_MAX_LEVEL } = await import('../public/js/ui/tutorial.js');
  const fresh = farmAt(1);
  assert.equal(namingDue(fresh), true);
  assert.equal(coachStep(fresh, 'p1')?.step.id, 'welcome');
  const old = farmAt(25);                          // an old save whose farmers were re-joined: tut still at the start
  assert.equal(old.farm.tut.s, 0);
  assert.equal(namingDue(old), false);
  assert.notEqual(coachStep(old, 'p1')?.step.id, 'welcome');
  assert.notEqual(coachStep(old, 'p1')?.step.id, 'name_farm');
  const named = farmAt(2);
  named.farm.coop = { ...named.farm.coop, named: { by: 'p1', at: T0 } };
  assert.equal(namingDue(named), false, 'a named farm is never asked again');
  assert.equal(namingDue(farmAt(NAMING_MAX_LEVEL - 1)), true);
});

// ---- UI-07 / UI-06: the type floor and the colour pairs, read from the stylesheets ------------------------------------

const CSS_FILES = ['style', 'shell', 'panels', 'panels-weekly', 'panels-collect'];

test('UI-07: no text under 13 px in any stylesheet; button, chip and flag labels at 14 px', async () => {
  const fs = await import('node:fs');
  const size = /font:\s*(?:\d{3}\s+)?(?:italic\s+)?([\d.]+)(rem|px)|font-size:\s*([\d.]+)(rem|px)/g;
  const small = [];
  for (const f of CSS_FILES) {
    const css = fs.readFileSync(new URL(`../public/css/${f}.css`, import.meta.url), 'utf8');
    css.split('\n').forEach((line, i) => {
      if (line.includes('.pn-map-')) return;            // the land map's SVG labels are in map units, not CSS px
      for (const m of line.matchAll(size)) {
        const px = Number(m[1] ?? m[3]) * ((m[2] ?? m[4]) === 'rem' ? 16 : 1);
        if (px < 13) small.push(`${f}.css:${i + 1} ${px}px`);
      }
    });
  }
  assert.deepEqual(small, [], 'every text 13 px or more');
  const panels = fs.readFileSync(new URL('../public/css/panels.css', import.meta.url), 'utf8');
  for (const sel of ['.pn-chip-n {', '.hh-panel-body .btn.pn-xs {', '.pn-chipbtn {', '.pn-tag-btn {']) {
    const rule = panels.slice(panels.indexOf(sel), panels.indexOf('}', panels.indexOf(sel)));
    assert.match(rule, /\.875rem|1rem|14px/, `${sel} is a 14 px label`);
  }
});

/** WCAG relative luminance contrast of two #RRGGBB colours. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('UI-06: the colour pairs the M1b panels now use pass AA (4.5:1 for words)', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
  const tok = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))[1];
  const paper = [tok('paper-50'), tok('paper-100'), tok('paper-200'), '#FFF2C4'];
  for (const bg of paper) assert.ok(contrast(tok('sun-ink'), bg) >= 4.5, `amber words on ${bg}`);
  for (const bg of [tok('go-900'), tok('stop-700'), tok('sky-700'), tok('wood-700'), tok('ink-500'), '#B8304F']) {
    assert.ok(contrast('#FFFFFF', bg) >= 4.5, `white on ${bg}`);
  }
  assert.ok(contrast(tok('ink-900'), '#FFC83D') >= 4.5, 'an earned Farm Beauty star: ink on gold');
  assert.ok(contrast(tok('ink-500'), tok('paper-100')) >= 4.5, 'a star to come / a hollow sparkle');
  assert.ok(contrast(tok('ink-900'), '#FFF3C4') >= 4.5, 'a calm badge');
  // the old pairs really failed (so the tests above mean something)
  assert.ok(contrast('#FFFFFF', '#FFC83D') < 3 && contrast('#FFFFFF', '#5DBB3F') < 4.5 && contrast(tok('sun-900'), tok('paper-50')) < 4.5);
});

test('UI-06 (found on the way): a closed chest SVG carries no "null" text node', async () => {
  const { chest } = await import('../public/js/ui/panels/art.js');
  for (const open of [false, true]) {
    const svg = chest(30, { open });
    assert.equal(svg.textContent, '', `open=${open}: no stray text in the drawing`);
    assert.ok(svg.children.length >= 5);
  }
});
