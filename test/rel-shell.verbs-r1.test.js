// QA r1, ui-shell: the hover card's "what a click does" line (S7) after the tester round.
//   S-20 (jde#7): the Sickle's card promised "Click to harvest" on an empty and a growing plot (a click gave "Nothing
//        to harvest there." and a bonk): the line shows only when the deed happens now.
//   S-26 (fe#4): the recipient's card of a surprise said "Click to open it" twice, the Bulgarian one in the wrong gender
//        (the generic "го" of the crate): the gift's own call to action is the only one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFarm, T0, must } from './helpers.js';
import { cropOf } from '../shared/content/index.js';
import { plotsSorted } from './helpers/ui-shell.js';
import { setLang, lang as curLang } from '../public/js/i18n/index.js';

const HUD = await import('../public/js/ui/hud.js');
const WHEAT = cropOf('wheat');
const pick = (id) => ({ kind: 'object', id });

test('S-20: the Sickle says "Click to harvest" only on a ripe plot', async () => {
  await setLang('en');
  const s = makeFarm();
  const plots = plotsSorted(s);
  assert.equal(HUD.verbLine(s, pick(plots[0]), 'sickle', 'p1', T0), null, 'an empty plot: no harvest promise (HEAD: "Click to harvest")');
  must(s, 'plant', { id: plots[0], crop: 'wheat' });
  assert.equal(HUD.verbLine(s, pick(plots[0]), 'sickle', 'p1', T0 + 1000), null, 'a growing plot: its card says "Ready in …"');
  assert.equal(HUD.verbLine(s, pick(plots[0]), 'sickle', 'p1', T0 + WHEAT.growMs + 1), 'Click to harvest', 'a ripe plot');
  // the Basket on a building with nothing in its tray, the Can on an empty plot: no promise either
  const barn = Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'barn');
  assert.notEqual(HUD.verbLine(s, pick(plots[1]), 'watering_can', 'p1', T0), 'Click to water it', 'the Can on an empty plot');
  assert.notEqual(HUD.verbLine(s, pick(barn), 'basket', 'p1', T0), 'Click to collect', 'the Basket on a Barn with nothing ready');
});

test('S-26: a surprise for me has one "open" line, EN and BG (no second, generic one in the wrong gender)', async () => {
  for (const lang of ['en', 'bg']) {
    await setLang(lang);
    assert.equal(curLang(), lang, `${lang} is in effect`);
    const s = makeFarm();
    const id = 'gift_t1';
    s.farm.objects[id] = { def: 'gift_box', x: 30, z: 30, rot: 0, placedAt: T0, by: 'p2' };
    s.farm.gifts = { ...(s.farm.gifts ?? {}), [id]: { by: 'p2', to: 'p1', at: T0, item: 'rose' } };
    const tip = HUD.worldTip(s, pick(id), T0, 'p1');
    assert.ok(tip, 'the gift has a card');
    const verb = HUD.verbLine(s, pick(id), 'hand', 'p1', T0);
    const lines = [...tip.lines, ...(verb ? [verb] : [])];
    const opens = lines.filter((l) => /open it|отвориш/i.test(l));
    assert.equal(opens.length, 1, `${lang}: one "open" sentence: ${JSON.stringify(lines)}`);
    if (lang === 'bg') assert.doesNotMatch(lines.join(' '), /за да го отвориш/, 'the surprise is feminine: never "го"');
  }
  await setLang('en');
});

// QA r1 S-30 (br#4): during a silent drop the chip said "Reconnecting… your moves are kept" while every new move was
// refused "(input paused)" from ~30 s; "asleep" came only ~49 s in, blaming the server. The chip follows the store.
test('S-30: the reconnecting chip says moves are kept only while they are; then "Can\'t reach the farm"', async () => {
  assert.equal(typeof HUD.connKey, 'function', 'hud.js connKey({ stale, ms })');
  assert.equal(HUD.connKey({ stale: false, ms: 5000 }), 'hud.conn.reconnecting');
  assert.equal(HUD.connKey({ stale: true, ms: 12_000 }), 'hud.conn.asleep', 'input paused: say so at once');
  assert.equal(HUD.connKey({ stale: false, ms: 30_000 }), 'hud.conn.asleep');
  await setLang('en');
  const { t } = await import('../public/js/i18n/index.js');
  assert.doesNotMatch(t('hud.conn.asleep'), /server is off/, 'a phone off Wi-Fi does not blame the farm\'s server');
});
