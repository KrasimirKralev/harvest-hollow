// Release 1.0, ui-panels lane: the copy pass over the existing catalogs (docs/qa/release/copy.md, ux-first.md #14,
// release-scope M17b, M28, P6). English grammar ("an Apple Tree", "5%"), the Bulgarian slips that repeat across screens,
// and the plainer words a new player meets in the first hour. Each test names its finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allAreas } from '../public/js/i18n/catalogs.js';
import * as I from '../public/js/i18n/index.js';
import { installDom } from './ui-qa2-dom.js';

installDom();

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EN_DIR = path.join(ROOT, 'public/js/i18n/en');
const AREAS = await allAreas();
const BG = Object.fromEntries((await Promise.all(AREAS.map(async ([, , load]) => Object.entries((await load()).default)))).flat());
const EN = Object.fromEntries(AREAS.flatMap(([, en]) => Object.entries(en)));

/** Every string inside a catalog value (plural and gender variants too). */
const strings = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
/** [file, line number, line] of every English catalog line matching `re`. */
function enLines(re) {
  const out = [];
  for (const f of fs.readdirSync(EN_DIR).filter((x) => x.endsWith('.js')).sort()) {
    fs.readFileSync(path.join(EN_DIR, f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      if (re.test(line)) out.push(`en/${f}:${i + 1}: ${line.trim().slice(0, 110)}`);
    });
  }
  return out;
}
const bg = (key, params) => { I.__setForTest('bg', BG); try { return I.t(key, params); } finally { I.__setForTest('en'); } };

// ---- copy#2: "a Apple Tree" -------------------------------------------------------------------------------------

test('copy#2: the English {x:a} / {x:A} form picks "a" or "an" (words, numbers, refs, nodes); Bulgarian ignores it', () => {
  I.__setForTest('en');
  assert.equal(I.format('Sell {item:a}?', { item: 'Apple Tree' }), 'Sell an Apple Tree?');
  assert.equal(I.format('Sell {item:a}?', { item: 'Pear Tree' }), 'Sell a Pear Tree?');
  assert.equal(I.format('{x:A} is here', { x: 'Orchard Keeper' }), 'An Orchard Keeper is here');
  assert.equal(I.format('{x:A} is here', { x: 'calf' }), 'A calf is here');
  assert.equal(I.format('{x:a}', { x: 'Unicorn' }), 'a Unicorn', '"yoo" sounds take "a"');
  assert.equal(I.format('{x:a}', { x: 'hour-long nap' }), 'an hour-long nap');
  assert.equal(I.format('{p:a}% chance', { p: 8 }), 'an 8% chance');
  assert.equal(I.format('{p:a}% chance', { p: 18 }), 'an 18% chance');
  assert.equal(I.format('{p:a}% chance', { p: 11 }), 'an 11% chance');
  assert.equal(I.format('{p:a}% chance', { p: 5 }), 'a 5% chance');
  assert.equal(I.format('{p:a}% chance', { p: 80 }), 'an 80% chance');
  assert.equal(I.format('{p:a}% chance', { p: 1.5 }), 'a 1.5% chance');
  assert.equal(I.format('{x:a} order', { x: 'eighth' }), 'an eighth order');
  assert.equal(I.format('Build {b:a}', { b: I.N('oil_press') }), 'Build an Oil Press');
  assert.equal(I.format('Build {b:a}', { b: I.N('bakery') }), 'Build a Bakery');
  const span = document.createElement('span');
  span.textContent = 'Apple Pie';
  const frag = I.tNodes('farm.sell.titleOne', { item: span });
  const box = document.createElement('div');
  box.append(frag);
  assert.equal(box.textContent, 'Sell an Apple Pie?', 'a node param gets its article as text before the node');
  assert.equal(box.childNodes.find?.((n) => n === span) ?? [...box.childNodes].find((n) => n === span), span, 'the node itself is kept');
  I.__setForTest('bg', BG);
  try {
    assert.equal(I.format('{x:a}', { x: 'Ябълково дърво' }), 'Ябълково дърво');
    assert.equal(I.format('{p:a} %', { p: 8 }), '8 %');
  } finally {
    I.__setForTest('en');
  }
});

test('copy#2 lint: no English catalog line hard-codes "a {x}" / "A {x}" (use {x:a} / {x:A}, or drop the article)', () => {
  assert.deepEqual(enLines(/\b[aA] \{/), []);
});

test('copy#2: the rewrites read right with a vowel name, and the labels lose the article', () => {
  I.__setForTest('en');
  assert.equal(I.t('farm.sell.titleOne', { item: 'Apple Tree' }), 'Sell an Apple Tree?');
  assert.match(I.t('farm.sell.soldOne', { item: 'Apple Tree', money: '30 coins' }), /^Sold an Apple Tree for 30 coins\.$/);
  assert.match(I.t('toasts.duet.bake.what', { name: 'Bo', thing: 'Apple Pie' }), /^Bo is baking an Apple Pie\./);
  assert.match(I.t('toasts.duet.cook.what', { name: 'Bo', thing: 'Omelette' }), /^Bo is cooking an Omelette\./);
  assert.equal(I.t('goals.tr.local.build', { b: I.N('oil_press') }), 'Build an Oil Press');
  assert.equal(I.t('moments.rank.now', { title: 'Orchard Keeper' }), 'New title: Orchard Keeper!');
  assert.equal(bg('moments.rank.now', { title: 'Ново попълнение' }), 'Ново звание: Ново попълнение!', 'copy#8.2: no capitalised title mid-sentence');
  // the Journal prints English ledger reasons without a colon (i18n.leftovers), and features pins "Bought a Cow"
  assert.equal(I.t('goals.ledger.ref.buy.animal', { x: 'Alpaca' }), 'Bought an Alpaca');
  assert.equal(I.t('goals.ledger.ref.sell.animal', { x: 'Alpaca' }), 'Sold an Alpaca');
  assert.equal(I.t('feed.buy.slot', { actor: 'Bo', b: 'Oil Press' }), 'Bo added a slot to the Oil Press');
  assert.equal(I.t('market.orders.nextSlot', { ord: 'eighth', n: 30 }), 'Mabel pins an eighth order at level 30.');
});

// ---- copy#14: "10 %" -----------------------------------------------------------------------------------------------

test('copy#14 lint: English writes "10%", never "10 %" (it wraps as "+25 / % beauty")', () => {
  assert.deepEqual(enLines(/[0-9}] %/), []);
});

// ---- copy#5, #6, #8, #11, #12, #17, #18: Bulgarian and English slips ---------------------------------------------

test('copy#5: the balloon crate line is one sentence; no "The farm" chip in front of it in the Journal', async () => {
  assert.equal(I.t('feed.crate.auto', { loot: '6,357 coins' }), 'An unopened balloon crate went to the Barn: 6,357 coins');
  assert.equal(bg('feed.crate.auto', { loot: '6357 монети' }), 'Неотворено сандъче от балона отиде в хамбара: 6357 монети');
  // the Journal's Activity tab: the line stands alone (the HUD feed already shows it without an actor)
  const { journalPanel } = await import('../public/js/ui/panels/journal.js');
  const { farmAt } = await import('./helpers/rules.js');
  const s = farmAt(12);
  s.farm.feed = { n: 1, rows: { 0: { at: Date.now(), by: 'sys', k: 'crate', c: 300, auto: 1 } } };
  const body = document.createElement('div');
  document.body.append(body);
  const ctx = { name: 'journal', args: {}, tab: 'activity', store: { state: s, pid: 'p1', now: () => Date.now() }, now: () => Date.now(),
    act: () => ({ ok: true }), every: () => () => {}, open() {}, ui: { panels: { has: () => false, retitle() {} } } };
  journalPanel.mount(body, ctx);
  const row = body.querySelector('.pn-feedrow');
  assert.ok(row, 'the Activity tab shows the row');
  assert.match(row.textContent.replace(/\s+/g, ' ').trim(), /^An unopened balloon crate went to the Barn/);
});

test('copy#6: the Bulgarian Ledger labels are short enough for the coins column to stay on a phone', () => {
  assert.equal(BG['goals.ledger.challenge'], 'За двама');
  assert.equal(BG['goals.ledger.meter'], 'Сандъчето на Мейбъл');
  assert.equal(BG['goals.ledger.uproot'], 'Върнати семена');
  assert.equal(BG['goals.ledger.mastery'], 'Майсторство');
});

test('copy#8: the reflexive "се", the object form of a land name, and no capitalised title mid-sentence', () => {
  assert.equal(BG['weekly.locked.opensAt'], 'Отваря се на ниво {n} на фермата');
  assert.equal(BG['league.duel.opensAt'], 'Отваря се на ниво {n}');
  assert.equal(BG['league.legacy.opensAt40'], 'Отваря се на ниво 40');
  assert.equal(BG['goals.r.land.buy'], 'Купи {land:defObj} ({c})');
  assert.equal(BG['goals.tr.local.save'], 'Спестявай за {land:defObj}');
  assert.equal(BG['feed.j.expand'], '{actor} купи {land:defObj}');
  assert.match(BG['goals.r.fish.pond'], /^Хвърли въдицата при \{pond:defObj\}/);
  for (const k of ['weekly.locked.opensAt', 'league.duel.opensAt', 'league.legacy.opensAt40']) assert.doesNotMatch(BG[k], /Отваря на/);
});

test('copy#11: the four longest Bulgarian personal titles are shorter (the farmer chip shows about 17 letters)', async () => {
  const { default: TEXT } = await import('../public/js/i18n/bg/text.js');
  const titles = TEXT.titles;
  assert.equal(titles[8].title, 'Опора на двора');
  assert.equal(titles[10].title, 'Жътварска звезда');
  assert.equal(titles[15].title, 'Овощна радост');
  assert.equal(titles[25].title, 'Жътварски ураган');
  assert.equal(titles[20].title, 'Гордостта на долината', 'the glossary title stays');
});

test('copy#12: the tree card says "Shake it!" once and the age reason has no nested brackets', () => {
  assert.equal(I.t('farm.tree.ripeShake'), 'Shake it!');
  assert.equal(BG['farm.tree.ripeShake'], 'Разклати го!');
  assert.equal(I.t('farm.tree.whyAge', { n: 1 }), '+1 for age');
  assert.equal(bg('farm.tree.whyAge', { n: 1 }), '+1 за възраст');
});

test('copy#17: a weekly clock carries no trailing "·" (CSS draws it before the countdown)', () => {
  for (const k of ['weekly.fair.clock.judging', 'weekly.fair.clock.next', 'weekly.folk.clock', 'weekly.barge.clock.leaves', 'weekly.barge.clock.docks']) {
    for (const s of [...strings(EN[k]), ...strings(BG[k])]) assert.doesNotMatch(s, /·\s*$/, `${k}: ${s}`);
  }
  const css = fs.readFileSync(path.join(ROOT, 'public/css/panels-weekly.css'), 'utf8');
  assert.match(css, /\.wk-clock-l \+ \.wk-clock-t::before \{ content: '· '/, 'the dot is drawn before the countdown');
});

test('copy#18: хамбар, never "склад"; "звание", never "титла"', () => {
  for (const [k, v] of Object.entries(BG)) {
    for (const s of strings(v)) {
      assert.doesNotMatch(s, /склад/, `${k}: ${s}`);
      if (k.startsWith('goals.j.rib.')) assert.doesNotMatch(s, /титла/, `${k}: ${s}`);
    }
  }
  assert.equal(I.t('market.barn.stored'), 'items');
});

test('copy#7: the Decor sets panel has a short title that fits the phone ribbon', () => {
  assert.equal(I.t('collect.sets.titleShort'), 'Decor sets');
});

// ---- copy#15 and ux-first#14 (M28): plainer words -----------------------------------------------------------------

test('copy#15: jargon rows rewritten ("Orders pay 50% more", "a chance at decor", "reach")', () => {
  for (const k of ['market.orders.noteLater', 'market.orders.noteFree', 'market.orders.noteCost', 'market.sell.tipTouch', 'market.sell.tipKeys', 'market.orders.untilThen']) {
    for (const s of strings(EN[k])) assert.doesNotMatch(s, /half again/, `${k}: ${s}`);
    for (const s of strings(BG[k])) assert.doesNotMatch(s, /с половина повече/, `${k}: ${s}`);
  }
  // QA r1 P-07: the bonus is coins AND XP (1.5x worth), never "50% more" coins
  assert.match(I.t('market.orders.noteFree'), /Orders pay more than the stand, in coins and XP/);
  assert.equal(I.t('market.land.proofNotReady'), "Finish the land's task first");
  assert.match(I.t('collect.album.how.old_coins'), /a chance for every 100 coins/);
  assert.equal(I.t('weekly.barge.andDecor'), 'and a chance at decor');
  assert.match(I.t('farm.bld.idleSub'), /^Ingredients leave the Barn when you start, so a started batch always finishes\./);
  assert.match(I.t('farm.m1b.batch', { span: '2h' }), /^This batch takes 2h; the next one counts the flowers again\.$/);
  assert.equal(I.t('market.facts.brush', { w: 3, h: 3 }), '3×3 reach');
  assert.match(I.t('market.intro.tools'), /^Bigger tools cover more ground in one swipe\./);
  assert.match(I.t('err.SLOT_TAKEN'), /You can take this seat back while they are away, or with the farm passphrase\./);
});

test('ux-first#14 + M28: the first-hour words a new player meets', () => {
  assert.equal(I.t('market.orders.quickSub'), 'Quick order: small, counts a little toward goals');
  assert.doesNotMatch(I.t('market.land.counting'), /first opened/);
  assert.equal(I.t('market.land.counting'), 'Counts from when you first saw this card.');
  assert.equal(I.t('farm.bld.upkeep'), 'for your animals (not sold)');
  assert.equal(I.t('market.barn.uses', { n: 5 }), ' · used in 5 recipes');
  assert.equal(I.t('market.barn.uses', { n: 1 }), ' · used in 1 recipe');
  assert.equal(I.t('moments.recap.animals', { n: 1 }), '1 animal with goods');
  assert.equal(I.t('moments.recap.animals', { n: 3 }), '3 animals with goods');
  assert.equal(I.t('weekly.ptsEach', { pts: 1, n: 1 }), '1 point each');
  assert.equal(I.t('weekly.ptsEach', { pts: 4, n: 4 }), '4 points each');
  // QA r1 P-04: the rule moved to a small line under the button (it spilled out of the button at 360 BG)
  assert.equal(I.t('market.orders.nowFree'), 'New order now');
  assert.equal(I.t('market.orders.nowFreeNote'), 'free once a day');
  assert.equal(I.t('league.perks.respec'), 'Reset perks');
  assert.equal(I.t('league.perks.rested.label'), 'Away bonus');
  for (const k of Object.keys(EN).filter((x) => x.startsWith('league.perks.'))) {
    for (const s of strings(EN[k])) assert.doesNotMatch(s, /\b(Respec|respec|rested XP|Rested XP|Not rested)\b/, `${k}: ${s}`);
  }
});

// ---- copy#20: the 13 px floor in the panel stylesheets the first-wave test did not read -----------------------------

test('copy#20: no text under 13 px in panels-league, panels-home, panels-w4 and mobile-panels (tab chips, perk subtitles)', () => {
  const size = /font:\s*(?:\d{3}\s+)?(?:italic\s+)?([\d.]+)(rem|px)|font-size:\s*([\d.]+)(rem|px)/g;
  const small = [];
  for (const f of ['panels-league', 'panels-home', 'panels-w4', 'mobile-panels']) {
    fs.readFileSync(path.join(ROOT, `public/css/${f}.css`), 'utf8').split('\n').forEach((line, i) => {
      // the farm atlas' svg labels are in map units (1.45px of a 100-unit viewBox), not css px
      if (/\.ha-|\.pn-map-/.test(line)) return;
      for (const m of line.matchAll(size)) {
        const px = Number(m[1] ?? m[3]) * ((m[2] ?? m[4]) === 'rem' ? 16 : 1);
        if (px < 13) small.push(`${f}.css:${i + 1} ${px}px`);
      }
    });
  }
  assert.deepEqual(small, []);
});

// ---- one key, one value: a catalog object literal with a key twice keeps only the last (a silent override) ----------

test('no catalog file defines a key twice (a later copy silently replaces the first)', () => {
  const dupes = [];
  for (const lang of ['en', 'bg']) {
    const dir = path.join(ROOT, 'public/js/i18n', lang);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      const seen = new Map();
      fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
        const m = /^\s{2}'([\w.-]+)':/.exec(line);
        if (!m) return;
        if (seen.has(m[1])) dupes.push(`${lang}/${f}: '${m[1]}' at lines ${seen.get(m[1])} and ${i + 1}`);
        else seen.set(m[1], i + 1);
      });
    }
  }
  assert.deepEqual(dupes, []);
});

// ---- copy#18: "по‑" with U+2011 (a line never ends on "по-") -------------------------------------------------------

/** Other lanes' areas with ASCII "по-" left (patches filed in docs/agent-notes/rel-ui-panels.md): may only go down. */
const HYPHEN_PENDING = {};
test('copy#18: Bulgarian writes "по‑" with a no-break hyphen (U+2011) in every catalog; other lanes\' files only shrink', () => {
  const dir = path.join(ROOT, 'public/js/i18n/bg');
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const n = (fs.readFileSync(path.join(dir, f), 'utf8').match(/(^|[^а-яА-Я])[Пп]о-[а-я]/gm) ?? []).length;
    if (n > (HYPHEN_PENDING[f] ?? 0)) bad.push(`bg/${f}: ${n} ASCII "по-"`);
  }
  assert.deepEqual(bad, []);
});

test('copy#9: a fixed length says "30m", not "30m 00s" (breeding, pairing); a countdown keeps its seconds', async () => {
  const { fmtDuration } = await import('../public/js/ui/dom.js');
  assert.equal(fmtDuration(30 * 60_000, { trim: true }), '30m');
  const src = (f) => fs.readFileSync(path.join(ROOT, `public/js/ui/panels/${f}`), 'utf8');
  assert.match(src('breeding.js'), /t\('home\.breed\.takes', \{ d: fmtDuration\(sp\.ms, \{ trim: true \}\)/);
  assert.match(src('pen-pair.js'), /t\('farm\.pair\.intro', \{ sp, noun: word\(v\), d: fmtDuration\(v\.ms, \{ trim: true \}\) \}\)/);
});

test('copy#4: the most frequent NOW lines are short ("Plant 16 plots" / "Засади 16 лехи", "Събери 96 стоки")', () => {
  assert.equal(I.tn('goals.tr.local.plant', 16), 'Plant 16 plots');
  assert.equal(bg('goals.tr.local.plant', { n: 16 }), 'Засади 16 лехи');
  assert.equal(bg('goals.r.plant', { n: 16 }), 'Засади 16 лехи');
  assert.equal(bg('goals.r.collect', { n: 96 }), 'Събери 96 стоки');
});
