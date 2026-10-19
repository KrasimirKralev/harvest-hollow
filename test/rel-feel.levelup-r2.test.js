// QA r2 (life-feel) ui/levelup.js, patches from ui-shell's fix list.
// S2-20 (fbp#11): a farmer alone on the farm finished the day's "Harvest 60 crops together" and was told
//   "♥ Общата задача е готова! ♥" ("The together task is done!"), a task nothing had introduced, with Hearts that have no
//   place on screen (M30). With no partner the toast names the deed ("Задачата на деня е готова: 60 прибрани посева");
//   "together" stays for a farm of two.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const document = installDom();
document.documentElement = { lang: 'en' };
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { makeFarm, T0 } = await import('./helpers.js');
const I = await import('../public/js/i18n/index.js');
const { createLevelup } = await import('../public/js/ui/levelup.js');

function setup(players) {
  document.body.replaceChildren();
  const s = makeFarm({ players });
  const toasts = [];
  const S = {
    store: { state: s, pid: 'p1', now: () => T0 + 60_000, on() {} },
    view: { fx: { play() {} } },
    controller: { do() {}, haptic() {} },
    ui: { banner: () => ({ el: null, close() {} }), panels: { has: () => true, open() {}, top: () => null }, toast: (x, o) => toasts.push([typeof x === 'function' ? x() : x, o]) },
    tutorial: { active: () => false },
  };
  return { lu: createLevelup(S), toasts };
}

test('S2-20: the day\'s together task finished alone names the deed; a farm of two keeps "together"', async () => {
  try {
    for (const [lang, solo, duo] of [
      ['en', /^Task of the day done: 60 crops harvested$/, /Together task done!/],
      ['bg', /^Задачата на деня е готова: 60 прибрани посева$/, /Общата задача е готова!/],
    ]) {
      await I.setLang(lang);
      const one = setup(['p1']);
      one.lu.celebrate({ e: 'together', kind: 'task', tpl: 'harvest_together', by: 'p1' });
      assert.equal(one.toasts.length, 1);
      assert.match(one.toasts[0][0], solo, `${lang} solo: ${one.toasts[0][0]}`);
      assert.doesNotMatch(one.toasts[0][0], /♥/, 'no hearts for a farmer alone');
      const two = setup(['p1', 'p2']);
      two.lu.celebrate({ e: 'together', kind: 'task', tpl: 'harvest_together', by: 'p1' });
      assert.match(two.toasts[0][0], duo, `${lang} two farmers: ${two.toasts[0][0]}`);
    }
  } finally { await I.setLang('en'); }
});

// S2-04 (oib#2, patch from ui-shell, optional): renaming the farm on a phone kept a suggestion chip in view above the
// keyboard instead of "Carve it!": the field names its button (ui-shell's keepInView reads data-keep-in-view).
test('S2-04: the naming card\'s field names its Carve button', async () => {
  const { createNaming } = await import('../public/js/ui/naming.js');
  let spec = null;
  const s = makeFarm();
  createNaming({ store: { state: s, pid: 'p1', on() {}, subscribe() {} }, ui: { panels: { register(n, sp) { spec = sp; }, top: () => null, isOpen: () => false } } });
  const body = document.createElement('div');
  document.body.append(body);
  spec.mount(body, { close() {} });
  const field = body.querySelector('input');
  assert.equal(field.dataset.keepInView, 'carve');
  const named = body.querySelector('[data-act="carve"]');
  assert.ok(named, 'the button it names');
  assert.match(named.textContent, /Carve/);
});
