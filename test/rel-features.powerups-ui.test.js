// Release 1.0, owner request 2026-10-19: the crates' rare power-ups on screen. The loot card names the power-up with its
// own picture and one line of what it does; the HUD chip (both farmers) counts it down; the feed line names who found
// it; the Golden Ticket's order line says what it paid. English and Bulgarian, no junk, glyphs drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { farmAt, T0, MIN, HOUR } from './helpers/rules.js';
import { allAreas } from '../public/js/i18n/catalogs.js';
import * as I from '../public/js/i18n/index.js';
import { powerupIds, powerupOf } from '../shared/rules/powerups.js';
import { passOf, dropMomentOf } from '../shared/rules/actions/crates.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
const { chipItems, PU_GLYPHS, puWhat, puThing, puLine } = await import('../public/js/ui/powerups.js');
const { feedText } = await import('../public/js/ui/feed.js');
const { buffItems, buffAnnouncements, addBuffSource } = await import('../public/js/ui/hud.js');
const { svgIcon, addGlyphs } = await import('../public/js/ui/dom.js');
const AREAS = await allAreas();
const BG = Object.fromEntries((await Promise.all(AREAS.map(async ([, , load]) => Object.entries((await load()).default)))).flat());
await I.__loadForTest('bg');
I.__setForTest('en');
const inBg = (fn) => { I.__setForTest('bg', BG); try { return fn(); } finally { I.__setForTest('en'); } };
const JUNK = /undefined|NaN|\[object|null\b|feat\.pu|\{\w+\}/;

/** A farm with every power-up at work, found by p2 at T0. */
function farmWithAll() {
  const s = farmAt(14);
  for (const id of powerupIds()) {
    const row = powerupOf(id);
    s.farm.powerups[id] = { at: T0, until: T0 + row.ms, by: 'p2', ...(row.n !== undefined ? { n: row.n } : {}) };
  }
  return s;
}

test('chips: one per power-up at work for BOTH farmers, a short name and its clock, the tip says what it does', () => {
  const s = farmWithAll();
  const now = T0 + 5 * MIN;
  for (const pid of ['p1', 'p2']) {
    const items = chipItems(s, pid, now);
    assert.deepEqual(items.map((i) => i.cls), powerupIds().map((id) => `pu-${id}`), pid);
    for (const i of items) {
      assert.doesNotMatch(`${i.text} ${i.tip} ${i.name}`, JUNK);
      assert.ok(i.text.length <= 22, `a short chip: "${i.text}"`);
    }
  }
  const [rainbow, , , ticket, star] = chipItems(s, 'p1', now);
  assert.equal(rainbow.text, 'Rainbow 25:00');
  assert.equal(rainbow.name, 'Rainbow Watering Can');
  assert.equal(rainbow.tip, 'For 25 min, every new crop is watered by magic and grows faster');
  assert.equal(ticket.text, 'Ticket ×1 · 23 h');
  assert.match(ticket.tip, /The next order either of you fills pays 50% more coins/);
  const sec = Math.ceil((dropMomentOf(passOf(now) + 1) - now) / 1000);
  assert.equal(star.text, `Star ×2 · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
  assert.match(star.tip, /The next 2 balloons each drop a crate/);
  // Bulgarian, the same chips
  const bg = inBg(() => chipItems(s, 'p1', now));
  assert.equal(bg[0].text, 'Дъга 25:00');
  assert.equal(bg[3].text, 'Билет ×1 · 23 ч');
  for (const i of bg) assert.doesNotMatch(`${i.text} ${i.tip} ${i.name}`, JUNK);
  assert.match(bg[4].tip, /Следващите 2 балона ще пуснат по едно сандъче/);
  // over at its end
  assert.deepEqual(chipItems(s, 'p1', T0 + powerupOf('rainbow').ms).map((i) => i.cls).includes('pu-rainbow'), false);
});

test('chips: the HUD takes them through addBuffSource; the screen reader hears start and end by name', () => {
  const s = farmWithAll();
  const now = T0 + MIN;
  assert.equal(buffItems(s, 'p1', now).some((i) => i.cls.startsWith('pu-')), false, 'nothing before the module loads');
  addBuffSource(chipItems);
  const items = buffItems(s, 'p1', now);
  assert.equal(items.filter((i) => i.cls.startsWith('pu-')).length, 5);
  const said = buffAnnouncements([], items);
  assert.ok(said.includes('Rainbow Watering Can started: For 29 min, every new crop is watered by magic and grows faster.'),
    said.join(' | '));
  const names = new Map(items.map((i) => [i.cls, i.name]));
  assert.deepEqual(buffAnnouncements(['pu-swarm'], [], names), ['Busy-Bee Swarm is over.']);
});

test('glyphs: every power-up has its own picture, drawn by svgIcon once added', () => {
  addGlyphs(PU_GLYPHS);
  const star = svgIcon('star').innerHTML;
  for (const id of powerupIds()) {
    const g = svgIcon(`pu-${id}`, 22);
    assert.ok(PU_GLYPHS[`pu-${id}`], id);
    assert.notEqual(g.innerHTML, star, `${id} is not the fallback star`);
    assert.equal(g.getAttribute('width'), '22');
  }
});

test('the loot card: the power-up among the loot with its own picture; the message says what it does; counted by uses', () => {
  const ev = { e: 'crateOpened', id: 'crate.x', coins: 3250, xp: 400, pu: 'ladybugs', puUntil: T0 + 30 * MIN };
  assert.deepEqual(puThing(ev), { glyph: 'pu-ladybugs', name: 'Lucky Ladybugs' });
  assert.equal(puLine(ev, T0), 'Lucky Ladybugs: For 30 min, every crop harvested has a 1 in 4 chance of one more');
  const tk = puLine({ ...ev, pu: 'ticket', puN: 2, puUntil: T0 + 24 * HOUR }, T0);
  assert.equal(tk, 'Mabel\'s Golden Ticket: The next 2 orders either of you fill pay 50% more coins');
  const bg = inBg(() => puLine({ ...ev, pu: 'swarm' }, T0));
  assert.equal(bg, 'Рояк пчелички: Следващите 30 мин нахранените животни и обраните дървета са готови с 25 % по‑рано');
  for (const id of powerupIds()) {
    const row = powerupOf(id);
    for (const lang of ['en', 'bg']) {
      const say = () => puWhat(id, row.n !== undefined ? { n: row.n } : { until: T0 + row.ms }, T0);
      assert.doesNotMatch(lang === 'bg' ? inBg(say) : say(), JUNK, `${id} ${lang}`);
    }
  }
});

test('the feed: the crate line names who found it and what; the order line says what the Golden Ticket paid', () => {
  const s = farmAt(14);
  s.players.p1.name = 'Rowan';
  s.players.p2.name = 'Desi';
  const row = { k: 'crate', at: T0, by: 'p2', c: 3250, pu: 'rainbow' };
  const en = feedText(row, s, 'p1');
  assert.equal(en.actor, 'Desi');
  assert.match(en.text, /opened a balloon crate: 3,250 coins and a Rainbow Watering Can$/);
  const bg = inBg(() => feedText(row, s, 'p1'));
  assert.match(bg.text, /отвори сандъче от балона: 3250 монети и дъгова лейка$/);
  const order = { k: 'order', at: T0, by: 'p1', c: 21_350, x: 600, g: 0, tk: 10_675 };
  assert.match(feedText(order, s, 'p2').text, /filled an order: \+21,350 coins, \+10,675 with Mabel's Golden Ticket/);
  assert.match(inBg(() => feedText({ ...order, g: 1 }, s, 'p2').text), /изпълни златна поръчка: \+21 350 монети и \+10 675 от златния билет/);
  for (const id of powerupIds()) {
    assert.doesNotMatch(feedText({ ...row, pu: id }, s, 'p1').text, JUNK, id);
    assert.doesNotMatch(inBg(() => feedText({ ...row, pu: id }, s, 'p1').text), JUNK, id);
  }
});

test('a power-up crate whose screen part does not load still gets the plain loot card and the partner\'s line', async () => {
  const { default: installW4b, LOOT_CARD_DELAY_MS } = await import('../public/js/ui/panels/w4b.js');
  const s = farmAt(14);
  s.players.p1.name = 'Rowan';
  s.players.p2.name = 'Desi';
  const handlers = {};
  const store = { state: s, pid: 'p1', now: () => T0, on: (e, fn) => { handlers[e] = fn; return () => {}; }, subscribe: () => () => {} };
  const banners = [];
  const toasts = [];
  const ui = { banner: (o) => banners.push(o), toast: (x) => toasts.push(typeof x === 'function' ? x() : x) };
  const failed = [];
  const warn = console.warn;
  console.warn = (...a) => failed.push(a.join(' '));
  const undo = installW4b(ui, { store, importPowerups: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /js/ui/powerups.js')) });
  try {
    const ev = { e: 'crateOpened', id: 'crate.x', coins: 3250, xp: 400, pu: 'rainbow', puUntil: T0 + 30 * MIN };
    handlers.fx({ ev: { ...ev, by: 'p1' }, by: 'p1', local: true });
    handlers.fx({ ev: { ...ev, id: 'crate.y', by: 'p2' }, by: 'p2', local: false });
    await new Promise((r) => setTimeout(r, LOOT_CARD_DELAY_MS + 300));
    assert.equal(banners.length, 1, 'the finder still gets the loot card');
    assert.equal(banners[0].id, 'loot-crate.x');
    assert.equal(banners[0].ribbon, I.t('farm.loot.ribbon'));
    assert.equal(toasts.length, 1, 'the partner still gets the line');
    assert.match(toasts[0], /^Desi opened a balloon crate: 3,250 coins/);
    assert.ok(failed.some((x) => /a game file did not load \(powerups\)/.test(x)), 'reported through the lazy door (the reload offer)');
  } finally {
    console.warn = warn;
    undo();
  }
});
