// Release 1.0, ui-panels lane, QA round 4 (docs/qa/release/qa-r4/fix-ui-panels.md): the DOM, copy and stylesheet half of
// each item, of its siblings and of the patches other lanes sent this round. The layout half (recipe names at 360 BG,
// the workshop headers, the slot picker, the hub strip's cue) is proven by the browser runs in
// docs/qa/release/build/ui-panels/r4/ and by the P7 gate (i18n-shots: every workshop, every recipe name, cut tab strips).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDom } from './ui-qa2-dom.js';
import { storyFarm } from './helpers/ui-panels.js';
import { T0, MIN, farmAt, put, actOk } from './helpers/rules-goals.js';
import { allAreas } from '../public/js/i18n/catalogs.js';
import * as I from '../public/js/i18n/index.js';
import { feedRows } from '../shared/rules/feed.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AREAS = await allAreas();
const BG = Object.fromEntries((await Promise.all(AREAS.map(async ([, , load]) => Object.entries((await load()).default)))).flat());
await I.__loadForTest('bg');
I.__setForTest('en');
const inBg = (fn) => { I.__setForTest('bg', BG); try { return fn(); } finally { I.__setForTest('en'); } };
const NBSP = ' ';

/** A small event emitter store (the panels listen to 'fx'); acts are recorded; ctx.on keeps its listeners. */
function ctxOf(state, { pid = 'p1', now = T0, args = {} } = {}) {
  const acts = [];
  const listeners = new Map();
  const body = document.createElement('div');
  document.body.append(body);
  const store = {
    state, pid, now: () => now,
    on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); },
    emit(ev, p) { for (const fn of listeners.get(ev) ?? []) fn(p); },
    act: (t, a) => { acts.push([t, a]); return { ok: true }; },
  };
  const ctx = {
    name: 'x', args, store, body, el: body, now: () => now, tab: null,
    ui: { panels: { open: () => true, has: () => true, retitle() {}, badge() {} }, toast() {} },
    every: () => () => {}, subscribe: () => () => {},
    on(target, ev, fn) { if (target && typeof target.on === 'function') return target.on(ev, fn); target.addEventListener(ev, fn); return () => {}; },
    act: (t, a) => { acts.push([t, a]); return { ok: true }; },
    open() {}, close() {}, setTitle(t) { ctx.title = t; }, refreshTabs() {},
    controller: { input: 'mouse', setTool() {}, do: (t, a) => { acts.push([t, a]); return { ok: true }; } },
  };
  return { ctx, body, acts };
}

// ---- stylesheets: every rule of the linked sheets as { file, media, sel, body, at }, in cascade order --------------
const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const sheets = [...index.matchAll(/<link rel="stylesheet" href="\/css\/([\w-]+\.css)">/g)].map((m) => m[1]);
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const cssOf = (f) => strip(fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8'));
const ALL = [];
for (const file of sheets) {
  const walk = (src, media) => {
    let depth = 0; let start = 0; let sel = '';
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '{') { if (depth === 0) { sel = src.slice(start, i).trim(); start = i + 1; } depth++; }
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const body = src.slice(start, i);
          if (sel.startsWith('@media')) walk(body, sel);
          else ALL.push({ file, media, sel, body, at: ALL.length });
          start = i + 1;
        }
      }
    }
  };
  walk(cssOf(file), '');
}
const decl = (body, prop) => body.match(new RegExp(`(?:^|;|\\s|\\{)${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim() ?? null;
/** The last rule (cascade order) that lists `sel` exactly and sets `prop` under a media query `mediaOk` accepts. */
function winner(sel, prop, mediaOk = (m) => m === '') {
  let win = null;
  for (const r of ALL) {
    if (!mediaOk(r.media) || !r.sel.split(',').map((s) => s.trim()).includes(sel)) continue;
    const v = decl(r.body, prop);
    if (v !== null) win = { file: r.file, media: r.media, value: v, at: r.at };
  }
  return win;
}

const OTHERS = new Set(['harness', 'front', 'dock', 'cheer', 'feat', 'boot']);
/** Every string of the catalogs ui-panels owns, EN and BG, as [area, key, text] (plural and touch forms flattened). */
async function ownStrings() {
  const out = [];
  for (const [area, en, load] of AREAS) {
    if (OTHERS.has(area)) continue;
    const bg = (await load()).default;
    for (const [lang, cat] of [['en', en], ['bg', bg]]) {
      for (const [k, v] of Object.entries(cat)) {
        for (const s of typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).filter((x) => typeof x === 'string') : []) out.push([`${lang}/${area}`, k, s]);
      }
    }
  }
  return out;
}

// ---- P4-01: a recipe's name is never clamped on a phone ----------------------------------------------------------

test('P4-01: on a phone a recipe name keeps three lines (four Bulgarian names need three in the 129 px column at 360)', () => {
  // the desktop rule clamps at two lines: wide cards, every name fits in two there
  assert.equal(winner('.pn-recipe-name', '-webkit-line-clamp')?.value, '2');
  // every phone (upright or on its side): three, from the phone stylesheet, which comes later in the cascade
  const phone = winner('.pn-recipe-name', '-webkit-line-clamp', (m) => /\(max-width: 600px\)/.test(m) && /\(max-height: 500px\)/.test(m));
  assert.equal(phone?.value, '3', 'no phone rule lets a recipe name take a third line ("Подаръчна / кошница за...")');
  assert.equal(phone.file, 'mobile-panels.css');
  // nothing later in the cascade, at any width, takes the third line away again
  const later = ALL.filter((r) => r.at > phone.at && r.sel.split(',').map((s) => s.trim()).includes('.pn-recipe-name') && decl(r.body, '-webkit-line-clamp') !== null);
  assert.deepEqual(later.map((r) => `${r.file} ${r.media}`), []);
  // the layout half (every recipe name of the content in a real card at 360 / iPhone 13 / desktop, EN and BG, measured
  // scrollHeight against clientHeight) is the P7 gate's recipe-name scan (tools/i18n-shots.mjs recipeNameScan)
});

test('P4-01 sibling (P7 found it once the walk opened the Packing Table): "Опашка 0/2" never leaves its count alone on a line', () => {
  // the count is glued to its word, EN and BG
  assert.equal(inBg(() => I.t('farm.bld.queueOf', { n: 0, max: 2 })), `Опашка${NBSP}0/2`);
  assert.equal(I.t('farm.bld.queueOf', { n: 0, max: 6 }), `Queue${NBSP}0/6`);
  // beside a buy card on a phone (113 px at 360) the strip makes room for it on one line: no decorative "+", less padding
  const phone = (m) => /\(max-width: 600px\)/.test(m);
  const strip = '.pn-slots:has(> .pn-slot.buy) > .pn-slot.pn-slot-strip';
  assert.equal(winner(`${strip} > .pn-slot-plus`, 'display', phone)?.value, 'none');
  assert.equal(winner(strip, 'padding', phone)?.value, '6px 8px');
  assert.equal(winner(strip, 'font-size', phone)?.value, '.875rem', 'still ≥ 13 px (UI-07)');
});

test('Land map: no label carries a class another sheet styles alone ("lvl": the level-up overlay\'s scale: .62 shrank "Lv 21" off the map on phones)', async () => {
  const { landMap } = await import('../public/js/ui/panels/art.js');
  const { landCards } = await import('../public/js/ui/panels/model.js');
  const s = farmAt(21);
  const svg = landMap(s, landCards(s), { onPick: () => {} });
  const texts = [...svg.querySelectorAll('text')];
  const level = texts.filter((t) => /^Lv \d+$/.test(t.textContent));
  assert.ok(level.length >= 1, `level labels on the level-21 map (${texts.map((t) => t.textContent).join(', ')})`);
  const classes = new Set(texts.flatMap((t) => (t.getAttribute('class') || '').split(/\s+/).filter(Boolean)));
  // a rule whose whole selector is one bare class of these labels and that moves or scales what it matches
  const MOVES = ['scale', 'transform', 'translate', 'rotate', 'zoom'];
  const hits = ALL.filter((r) => r.sel.split(',').map((x) => x.trim()).some((x) => /^\.[\w-]+$/.test(x) && classes.has(x.slice(1)))
    && MOVES.some((p) => decl(r.body, p) !== null)).map((r) => `${r.file} ${r.media} ${r.sel}`);
  assert.deepEqual(hits, [], hits.join('\n'));
  // and the level labels keep their own size rule (desktop 1.9 px, phones 2.6 px)
  const cls = (level[0].getAttribute('class') || '').split(/\s+/).filter((c) => c !== 'pn-map-label')[0];
  assert.equal(winner(`.pn-map-label.${cls}`, 'fill')?.value, '#F4F7EC');
});

// ---- P4-02: the workshop header's ready line never starts a line with the dot ----------------------------------

test('P4-02: the BG ready line breaks after "Фураж за добитък ·", never before the dot; the count stays with its word', () => {
  const bg = inBg(() => I.t('farm.bld.ready', { name: 'Фураж за добитък', n: 12 }));
  // the no-break space before the dot, a normal space after it: the second line reads "готови: 12"
  assert.equal(bg, `Фураж за добитък${NBSP}· готови:${NBSP}12`);
  assert.equal(bg.includes(`·${NBSP}`), false, 'no no-break space after the dot (it glued "· готови" into one word)');
  // the English line has no dot and keeps its count
  assert.equal(I.t('farm.bld.ready', { name: 'Livestock Feed', n: 12 }), `Livestock Feed ready:${NBSP}12`);
});

test('P4-02 lint: no catalog line glues a separator dot to the NEXT word with a breaking space before it (a line would start "· …")', async () => {
  const bad = (await ownStrings()).filter(([, , s]) => new RegExp(` ·${NBSP}`).test(s)).map(([a, k, s]) => `${a} ${k}: ${s}`);
  assert.deepEqual(bad, [], bad.join('\n'));
  // the sibling the lint found: the build tray's "Free · ×2" (its row never wraps; now it cannot either way)
  assert.equal(I.t('toolbar.build.freeN', { n: 2 }), `Free${NBSP}·${NBSP}×2`);
  assert.equal(inBg(() => I.t('toolbar.build.freeN', { n: 2 })), `Безплатно${NBSP}·${NBSP}×2`);
});

// ---- P4-03: a phone is offered "a new device", not "a new computer" ------------------------------------------

test('P4-03: the slot picker says "This is me on a new device" / „Това съм аз, на ново устройство“', () => {
  assert.equal(I.t('shell.slot.reclaim'), 'This is me on a new device');
  assert.equal(inBg(() => I.t('shell.slot.reclaim')), 'Това съм аз, на ново устройство');
});

test('P4-03 siblings: the help lines a phone also reads say "this device", never "this computer"', () => {
  for (const key of ['shell.slot.reclaim', 'settings.qualityHelp', 'settings.farm.switchHelp']) {
    assert.doesNotMatch(I.t(key), /computer/i, `en ${key}`);
    assert.doesNotMatch(inBg(() => I.t(key)), /компютър/i, `bg ${key}`);
  }
  assert.match(I.t('settings.qualityHelp'), /on this device\./);
  assert.match(inBg(() => I.t('settings.farm.switchHelp')), /на това устройство/);
});

// ---- patches other lanes' QA r4 items send ui-panels -------------------------------------------------------------

test('S4-04 (ui-shell X4-1): on a phone the Axe line says where the Axe is (the phone bar has no "Tools" label)', () => {
  // the catalog entry itself: { touch, other } (ui/dom.js touchText picks the form)
  const enCat = AREAS.find(([a]) => a === 'game')[1]['game.debris.axe'];
  const bgCat = BG['game.debris.axe'];
  assert.equal(enCat.touch, '{thing}: use the Axe (tap the tool below ▴).');
  assert.equal(bgCat.touch, '{thing}: с брадвата (натисни инструмента долу ▴).');
  assert.doesNotMatch(enCat.touch, /Tools/);
  assert.doesNotMatch(bgCat.touch, /Сечива/);
  assert.equal(enCat.other, '{thing}: use the Axe (8).', 'the mouse line keeps its key');
});

test('S4-07 (ui-shell X4-3): the Ribbon Track\'s hub strip shows the "›" cue while tabs run past its edge, like the frame tabs', async () => {
  const { hubNav } = await import('../public/js/ui/panels/league-kit.js');
  const { farmAt: farmL } = await import('./helpers/rules.js');
  const { ctx } = ctxOf(farmL(36));
  const nav = hubNav(ctx, 'seasonTrack');
  assert.ok(nav, 'a hub strip at level 36');
  // a 344 px strip holding 560 px of tabs, scrolled to the start
  Object.assign(nav, { scrollLeft: 0, clientWidth: 344, scrollWidth: 560 });
  nav.dispatch('scroll');
  assert.equal(nav.classList.contains('more-r'), true, 'tabs past the right edge: the right cue');
  assert.equal(nav.classList.contains('more-l'), false);
  nav.scrollLeft = 216;
  nav.dispatch('scroll');
  assert.equal(nav.classList.contains('more-r'), false, 'scrolled to the end: no right cue');
  assert.equal(nav.classList.contains('more-l'), true, 'the left cue');
  // the stylesheet draws the cue only on those classes, pinned at the strip's edges, and the strip is the tabs' offsetParent
  assert.equal(winner('.lg-hub.more-r::after', 'visibility')?.value, 'visible');
  assert.equal(winner('.lg-hub.more-l::before', 'visibility')?.value, 'visible');
  assert.equal(winner('.lg-hub::after', 'visibility')?.value, 'hidden');
  assert.equal(winner('.lg-hub::after', 'position')?.value, 'sticky');
  assert.equal(winner('.lg-hub', 'position')?.value, 'relative');
});

test('L4-01 (life-feel): upright on a phone the Market slip is the sheet\'s sticky foot; on its side and on a desktop it is not', async () => {
  const { marketPanel } = await import('../public/js/ui/panels/market.js');
  const { LAYOUT_Q } = await import('../public/js/ui/layout.js');
  const was = globalThis.matchMedia;
  const mqs = [];
  let upright = true;
  globalThis.matchMedia = (q) => {
    const mq = { media: q, get matches() { return q === LAYOUT_Q.portrait ? upright : false; }, fns: [],
      addEventListener(t, fn) { if (t === 'change') this.fns.push(fn); }, removeEventListener() {} };
    mqs.push(mq);
    return mq;
  };
  try {
    const { state } = storyFarm({ now: T0, level: 12, players: ['p1', 'p2'] });
    const a = ctxOf(state, { args: { item: 'wheat' } });
    a.ctx.tab = 'sell';
    marketPanel.mount(a.body, a.ctx);
    const slip = a.body.querySelector('.pn-slip');
    assert.equal(slip?.dataset.stickyFoot, '1', 'portrait: the slip is the foot a line keeps above');
    // the phone turns on its side: the slip becomes a tall column
    upright = false;
    for (const mq of mqs.filter((m) => m.media === LAYOUT_Q.portrait)) for (const fn of mq.fns) fn({ matches: false });
    assert.equal(slip.dataset.stickyFoot, undefined, 'landscape: no foot');
    a.body.remove();
    const b = ctxOf(state, { args: { item: 'wheat' } });
    b.ctx.tab = 'sell';
    marketPanel.mount(b.body, b.ctx);
    assert.equal(b.body.querySelector('.pn-slip')?.dataset.stickyFoot, undefined, 'desktop: no foot');
    b.body.remove();
  } finally { globalThis.matchMedia = was; }
});

test('F4-03 (features): the Journal\'s rename line names both names, EN and BG; a first naming stays a naming', async () => {
  const { feedText } = await import('../public/js/ui/panels/goals-model.js');
  const s = farmAt(7);
  const hen = put(s, 'chicken', { home: put(s, 'coop') });
  actOk(s, 'nameAnimal', { id: hen, name: 'Tajna' }, { pid: 'p2' });
  actOk(s, 'nameAnimal', { id: hen, name: 'Buttercup' }, { pid: 'p1', now: T0 + MIN });
  const [, row] = feedRows(s, 1)[0];
  const [, first] = feedRows(s, 2)[1];
  assert.equal(row.was, 'Tajna', 'the rules put the old name on the row');
  const say = (r) => feedText(r, s, 'p2');
  assert.match(say(row), /renamed “Tajna” to “Buttercup”/);
  assert.match(inBg(() => say(row)), /преименува „Tajna“ на „Buttercup“/);
  assert.doesNotMatch(say(first), /renamed/, 'a first naming is not a rename');
  assert.match(say(first), /named an animal “Tajna”/);
  // the HUD's line (life-feel's ui/feed.js reads it once its half of the patch lands)
  assert.equal(I.t('feed.name.renamed', { actor: 'A', was: 'Tajna', text: 'Buttercup' }), 'A renamed "Tajna" to "Buttercup"');
  assert.equal(inBg(() => I.t('feed.name.renamed', { actor: 'A', was: 'Tajna', text: 'Buttercup' })), 'A преименува „Tajna“ на „Buttercup“');
});
