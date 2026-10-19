// Release 1.0 (life-feel): ui/levelup.js. S6 (ux-first#10, #20, feel#13; critique#16): the unlock card lists content
// only (systems come one by one through the rules' drip), personal-level cards wait for farm level 5, the overlay sets
// body.celebrating, the rewards are chips that fly to their pills. M29 (critique#32): the 1.0 drip cards read their
// words from `card.key` and their Show me from `card.show`, and maybeSystemCard passes { helper, now } (features' and
// ui-shell's P-09 asks). Built in the small fake DOM with the real rules and content.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const document = installDom();
document.querySelector = (s) => document.body.querySelector(s);
document.querySelectorAll = (s) => document.body.querySelectorAll(s);
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { makeFarm, T0 } = await import('./helpers.js');
const { CONTENT } = await import('../shared/content/index.js');
const { LEVELS } = await import('../shared/content/levels.js');
const { t } = await import('../public/js/i18n/index.js');
const { createLevelup, PERSONAL_FROM, cardShowMe } = await import('../public/js/ui/levelup.js');

const xpFor = (level) => LEVELS[level - 1].xp;

function setup({ level = 1, harness = null } = {}) {
  document.body.replaceChildren();
  const celebrate = document.createElement('div'); celebrate.id = 'celebrate';
  const banners = document.createElement('div'); banners.id = 'banners';
  document.body.append(celebrate, banners);
  const s = makeFarm();
  const xp = xpFor(level);
  if (Number.isFinite(xp)) s.farm.xp = xp;
  // (QA r4 L4-04: a farmer who has toured the farm's level; one who has not gets its card when the module is made)
  if (Number.isFinite(xp)) s.players.p1.seen = { ...s.players.p1.seen, lvl: level };
  const specs = [];
  const opened = [];
  const fx = [];
  const S = {
    store: { state: s, pid: 'p1', now: () => T0 + 60_000, on() {} },
    view: { fx: { play: (ev, pos, meta) => fx.push([ev, meta]) } },
    controller: { do() {}, haptic() {} },
    ui: {
      banner: (spec) => { specs.push(spec); return { el: null, close() {} }; },
      panels: { has: () => true, open: (name, args) => opened.push([name, args]), top: () => null },
      farmBook: { open: () => opened.push(['farmbook']) },
      layout: { is: () => false },
      toast() {},
    },
    tutorial: { active: () => false },
    harness,
  };
  const lu = createLevelup(S);
  return { s, S, lu, specs, opened, fx };
}

test('S6: the unlock card lists content only; a level that opens only systems has no card', () => {
  const { lu, specs } = setup({ level: 3 });
  lu.unlockBanner(3);
  assert.equal(specs.length, 1);
  const msg = typeof specs[0].message === 'function' ? specs[0].message() : specs[0].message;
  assert.equal(msg, '', `no "Also new: ..." systems line (${msg})`);
  assert.ok(specs[0].things.length > 0, 'the crops and buildings of level 3');
});

test('S6: personal-level cards wait for farm level 5', () => {
  const low = setup({ level: 2 });
  low.lu.celebrate({ e: 'levelUp', scope: 'player', pid: 'p1', level: 3, title: 'weed_puller' });
  assert.equal(document.getElementById('banners').children.length, 0, 'no rosette at farm level 2');
  const high = setup({ level: PERSONAL_FROM });
  high.lu.celebrate({ e: 'levelUp', scope: 'player', pid: 'p1', level: 9, title: 'weed_puller' });
  assert.equal(document.getElementById('banners').children.length, 1, 'a rosette from farm level 5');
});

test('S6: the farm level-up sets body.celebrating for the overlay and flies its reward chips', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { lu, fx } = setup({ level: 2 });
    document.body.classList.add('motion-reduced');          // no confetti in the fake DOM (it has no animate())
    lu.celebrate({ e: 'levelUp', level: 2, coins: 360, acorns: 2 });
    assert.ok(document.body.classList.contains('celebrating'));
    const chips = document.querySelectorAll('.lvl-chip');
    assert.equal(chips.length, 2, 'coins and acorns as chips');
    mock.timers.tick(1200);
    const loot = fx.filter(([ev]) => ev.e === 'levelLoot');
    assert.equal(loot.length, 2);
    assert.ok(loot.every(([, meta]) => meta.from && meta.from.classList.contains('lvl-chip')), 'they fly from the chips');
    mock.timers.tick(2000);
    assert.ok(!document.body.classList.contains('celebrating'), 'the coach card comes back');
  } finally { mock.timers.reset(); }
});

/** A farm where every system card was seen but `id`, after enough play since the last one. */
function onlyCard(id, level) {
  const env = setup({ level, harness: { open() { env.opened.push(['harvey']); } } });
  const p = env.s.players.p1;
  p.seen = { ...(p.seen ?? {}), cards: Object.fromEntries([...CONTENT.features.values()].filter((f) => f.card && f.id !== id).map((f) => [f.id, 1])) };
  p.play = { n: 500, card: 0 };
  return env;
}

test('M29: "Meet Harvey" comes when the farm offers Harvey (helper), with its own words and Show me', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    const env = onlyCard('meet_harvey', 6);
    mock.timers.tick(15_000);
    assert.equal(env.specs.length, 1, 'the drip card shows (maybeSystemCard passes helper: true)');
    const spec = env.specs[0];
    const key = CONTENT.features.get('meet_harvey').card.key;
    assert.equal(spec.ribbon(), t(`${key}.title`));
    assert.equal(spec.message(), t(`${key}.text`));
    const show = spec.actions.find((a) => a.kind === 'sky');
    assert.ok(show, 'a Show me');
    show.fn();
    assert.deepEqual(env.opened.at(-1), ['harvey']);
  } finally { mock.timers.reset(); }
});

test('M29: Show me of the 1.0 cards: the gift sheet, the Farm book, a panel', () => {
  const opened = [];
  const S = { ui: { panels: { has: () => true, open: (n, a) => opened.push([n, a]) }, farmBook: { open: () => opened.push(['farmbook']) } }, harness: null };
  cardShowMe('gift', S)();
  cardShowMe('farmbook', S)();
  cardShowMe({ panel: 'market', args: { tab: 'tools' } }, S)();
  assert.deepEqual(opened, [['gift', undefined], ['farmbook'], ['market', { tab: 'tools' }]]);
  assert.equal(cardShowMe('harvey', S), null, 'no helper on this farm: no Show me');
});

test('M29 / P-09: the uproot tip waits for a crop of mine still in its refund window (maybeSystemCard passes now)', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    const env = onlyCard('uproot', 3);
    mock.timers.tick(15_000);
    assert.equal(env.specs.length, 0, 'no fresh crop: no card');
    const plot = Object.keys(env.s.farm.objects).find((k) => env.s.farm.objects[k].def === 'plot');
    env.s.farm.objects[plot].crop = { def: 'wheat', plantedAt: T0 + 59_000, readyAt: T0 + 120_000, by: 'p1', cycle: 0 };
    mock.timers.tick(15_000);
    assert.equal(env.specs.length, 1, 'my crop planted a second ago: the card');
  } finally { mock.timers.reset(); }
});
