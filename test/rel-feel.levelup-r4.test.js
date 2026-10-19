// QA r4 (life-feel) ui/levelup.js.
// L4-04 (jde#3): a partner who joins a farm at a higher level got no "New at level N" at the join, then got it minutes
//   later out of nowhere (on the next welcome: a reconnect, or when the other farmer applied Harvey's change). The
//   join's welcome comes before the module exists (main.js resets the store, then ui.init makes the module), so its
//   `store.on('welcome')` missed it. Now the module tours once when it is made on a state that is already there; a later
//   welcome does not tour the same levels again.
// L4-06 (coop#5): quest cards said the title twice ("Golden Hour on the Hill: Golden Hour on the hill. The last page …")
//   for nine quests whose `done` line opens with the title (and h6 ends with it): the card is '{title}: {done}'. Now a
//   done line that says its title as a whole phrase (either case, in the language in effect) is said alone; every
//   quest is checked in EN and BG.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const document = installDom();
document.documentElement = { lang: 'en' };
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { makeFarm, T0 } = await import('./helpers.js');
const I = await import('../public/js/i18n/index.js');
const { CONTENT } = await import('../shared/content/index.js');
const { LEVELS } = await import('../shared/content/levels.js');
const xpFor = (level) => LEVELS[level - 1].xp;
const { createLevelup } = await import('../public/js/ui/levelup.js');

function env({ level = 1, seen = 1 } = {}) {
  document.body.replaceChildren();
  for (const id of ['celebrate', 'banners']) { const d = document.createElement('div'); d.id = id; document.body.append(d); }
  const s = makeFarm();
  s.players.p1.name = 'Ана';
  s.players.p2.name = 'Бо';
  if (level > 1) s.farm.xp = xpFor(level);
  s.players.p2.seen = { ...s.players.p2.seen, lvl: seen };
  const specs = [];
  const handlers = {};
  const S = {
    // p2 just joined (no absence this device saw: the recap's absenceStart is null)
    store: { state: s, pid: 'p2', now: () => T0 + 60_000, on: (ev, fn) => { (handlers[ev] ||= []).push(fn); return () => {}; } },
    view: { fx: { play() {} } },
    controller: { do() {}, haptic() {} },
    ui: { banner: (spec) => { specs.push(spec); return { el: null, close() {} }; }, panels: { has: () => true, open() {}, top: () => null },
      layout: { is: () => false }, toast() {} },
    tutorial: { active: () => false },
  };
  return { s, S, specs, welcome: () => { for (const fn of handlers.welcome ?? []) fn({}); } };
}
const levelCards = (specs) => specs.filter((x) => String(x.id ?? '').startsWith('level-'));

test('L4-04: a partner who joins a level-2 farm gets "New at level 2" at the join, once; a later welcome tours nothing', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const e = env({ level: 2, seen: 1 });
    createLevelup(e.S);                        // made after the join's welcome (the store already holds the state)
    mock.timers.tick(2000);
    assert.equal(levelCards(e.specs).length, 1, `one tour within 2 s of the join: ${e.specs.map((x) => x.id).join(', ') || 'none'}`);
    assert.equal(levelCards(e.specs)[0].id, 'level-2');
    e.welcome();                               // a dev drop and reconnect, before the card was closed (seen.lvl still 1)
    mock.timers.tick(2000);
    assert.equal(levelCards(e.specs).length, 1, 'the reconnect tours the same level again');
  } finally { mock.timers.reset(); }
});

test('L4-04: a farmer who has seen the farm\'s level gets no card at the join or after', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const e = env({ level: 4, seen: 4 });
    createLevelup(e.S);
    e.welcome();
    mock.timers.tick(3000);
    assert.equal(levelCards(e.specs).length, 0);
  } finally { mock.timers.reset(); }
});

test('L4-06: no quest card repeats the quest\'s title, over every quest, in English and Bulgarian', async () => {
  try {
    for (const lang of ['en', 'bg']) {
      await I.setLang(lang);
      const twice = [];
      let n = 0;
      for (const q of CONTENT.quests.values()) {
        if (!q.done) continue;
        const e = env();
        const lu = createLevelup(e.S);
        lu.celebrate({ e: 'questDone', id: q.id, coins: 10, xp: 2 });
        const spec = e.specs.find((x) => x.id === `quest-${q.id}`);
        assert.ok(spec, `${lang} ${q.id}: a card`);
        const line = spec.message();
        const title = I.ctext('quests', q.id, 'title', q.title).trim();
        const low = (x) => x.toLocaleLowerCase();
        const at = low(line).indexOf(low(title));
        if (at >= 0 && low(line).indexOf(low(title), at + title.length) >= 0) twice.push(`${q.id}: ${line.slice(0, 70)}`);
        n++;
      }
      assert.ok(n > 40, `${lang}: ${n} quests checked`);
      assert.deepEqual(twice, [], `${lang}: the title twice on the card`);
    }
  } finally { await I.setLang('en'); }
});

test('L4-06: a done line that does not open with the title keeps "Title: done"', async () => {
  const { questLine } = await import('../public/js/ui/levelup.js');
  assert.equal(questLine('Pie Day', 'Pie Day is my favourite day.'), 'Pie Day is my favourite day.');
  assert.equal(questLine('Golden Hour on the Hill', 'Golden Hour on the hill. The last page.'), 'Golden Hour on the hill. The last page.');
  assert.match(questLine('Pie', 'Pierre baked.'), /^Pie: Pierre baked\.$/, 'a word that only starts like the title is not the title');
  assert.match(questLine('First Harvest', 'The wheat is in.'), /^First Harvest: The wheat is in\.$/);
  assert.equal(questLine('Gone Fishing', 'Two lines in the water. Gone fishing, together.'), 'Two lines in the water. Gone fishing, together.');
});
