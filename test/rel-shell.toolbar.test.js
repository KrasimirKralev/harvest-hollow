// Release 1.0, ui-shell: the toolbar of 3 (S2, ux-first#5, #13) and the phone's one tool slot (S3, ux-phone#3).
// Desktop: [Hand] [Seeds ▸] [Tools ▸]; Sickle, Water, Feed, Basket, Compost and Axe open from the Tools flyout (Escape
// closes it, P9); the Hammer leaves the bar. Keys 3-8 still pick those tools, 9 the Hammer, and B opens the build tray.
// A phone keeps one slot (the tool in hand) whose pop-up holds every tool but the Hammer, plus Build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDom } from './ui-qa2-dom.js';
import { xpForLevel } from '../shared/content/index.js';
import { controllerRig } from './helpers/ui-shell.js';

const GROUP = ['sickle', 'watering_can', 'feed_scoop', 'basket', 'compost_scoop', 'axe'];

async function rig({ phone = false } = {}) {
  const document = installDom();
  document.querySelector = (sel) => document.body.querySelector(sel);
  document.querySelectorAll = (sel) => document.body.querySelectorAll(sel);
  // the phone slot copies the icon of the tool in hand (a shallow stand-in for Node.cloneNode)
  for (const proto of [Object.getPrototypeOf(document.createElement('i')), Object.getPrototypeOf(document.createTextNode(''))]) {
    proto.cloneNode ??= function cloneNode() {
      if (this.nodeType === 3) return document.createTextNode(this.data);
      const el = document.createElement(this.tagName.toLowerCase());
      el.className = this.className;
      Object.assign(el.dataset, this.dataset);
      for (const ch of this.childNodes) el.append(ch.cloneNode(true));
      return el;
    };
  }
  for (const [tag, id] of [['div', 'tray-wrap'], ['div', 'seed-tray'], ['div', 'build-tray'], ['div', 'stroke-chip'], ['canvas', 'world']]) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.append(el);
  }
  const bar = document.createElement('nav');
  bar.id = 'toolbar';
  document.getElementById('tray-wrap').append(bar);
  document.getElementById('seed-tray').hidden = true;
  document.getElementById('build-tray').hidden = true;
  globalThis.innerWidth = phone ? 390 : 1366;
  globalThis.innerHeight = phone ? 844 : 768;
  globalThis.matchMedia = (q) => ({ matches: phone && /max-width: 600px|max-height: 500px|pointer: coarse/.test(q), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  const builds = [];
  const ui = { toast() {}, panels: { top: () => null, open() {}, has: () => false }, openBuild: () => builds.push(1) };
  const r = await controllerRig({ ui });
  r.store.state.farm.xp = xpForLevel(12);              // every tool of the bar unlocked
  const { createToolbar } = await import('../public/js/ui/toolbar.js');
  const tb = createToolbar({ store: r.store, controller: r.c, ui, view: r.w.view, settings: { scale: () => 100 } });
  tb.render();
  return { ...r, document, bar, tb, builds };
}

const ids = (els) => els.map((b) => b.dataset.tool ?? `slot:${b.dataset.slot}`);

test('S2: the desktop toolbar is Hand, Seeds and Tools; the six tools sit in the Tools flyout; no Hammer', async () => {
  const { document, bar } = await rig();
  const top = bar.children.filter((c) => c.classList.contains('tool'));
  assert.deepEqual(ids(top), ['hand', 'seed_bag', 'slot:tools'], 'three buttons on the bar');
  assert.equal(document.body.querySelector('[data-tool="hammer"]'), null, 'the Hammer left the toolbar');
  const fly = document.getElementById('tools-flyout');
  assert.ok(fly && fly.hidden, 'the flyout waits closed');
  // P9 (axe aria-allowed-attr): toggle buttons (aria-pressed) in a group, not menuitems of a menu
  assert.equal(fly.getAttribute('role'), 'group');
  assert.equal(bar.querySelector('[data-slot="tools"]').getAttribute('aria-haspopup'), null);
  bar.querySelector('[data-slot="tools"]').click();
  assert.equal(fly.hidden, false, 'the Tools slot opens it');
  assert.deepEqual(ids(fly.querySelectorAll('[data-tool]')), GROUP, 'Sickle, Water, Feed, Basket, Compost, Axe');
  assert.equal(bar.querySelector('[data-slot="tools"]').getAttribute('aria-expanded'), 'true');
  fly.dispatch('keydown', { key: 'Escape' });
  assert.equal(fly.hidden, true, 'Escape closes it (P9)');
  assert.equal(bar.querySelector('[data-slot="tools"]').getAttribute('aria-expanded'), 'false');
});

test('S2: a tool picked from the flyout is in hand and the flyout closes', async () => {
  const { document, bar, c } = await rig();
  bar.querySelector('[data-slot="tools"]').click();
  const fly = document.getElementById('tools-flyout');
  fly.querySelector('[data-tool="watering_can"]').click();
  assert.equal(c.tool.id, 'watering_can');
  assert.equal(fly.hidden, true);
});

test('S2: keys 3-8 pick the flyout tools, 9 the Hammer, and B opens the build tray', async () => {
  const { c, builds } = await rig();
  const key = (code) => globalThis.window.dispatch('keydown', { code, key: code.replace(/^(Digit|Key)/, '').toLowerCase(), target: null });
  const want = { Digit3: 'sickle', Digit4: 'watering_can', Digit5: 'feed_scoop', Digit6: 'basket', Digit7: 'compost_scoop', Digit8: 'axe', Digit9: 'hammer' };
  for (const [code, id] of Object.entries(want)) {
    key(code);
    assert.equal(c.tool.id, id, `${code} -> ${id}`);
  }
  key('Digit1');
  assert.equal(c.tool.id, 'hand');
  key('KeyB');
  assert.equal(builds.length, 1, 'B opens the build tray');
  assert.equal(c.tool.id, 'hand', 'B no longer swaps the tool in hand for the Hammer');
});

test('S3: a phone has one tool slot; its pop-up holds every tool but the Hammer, and Build', async () => {
  const { document, bar } = await rig({ phone: true });
  const top = bar.children.filter((c) => c.classList.contains('tool'));
  assert.deepEqual(ids(top), ['slot:tool'], 'one slot on the phone bar');
  bar.querySelector('[data-slot="tool"]').click();
  const fly = document.getElementById('tools-flyout');
  assert.equal(fly.hidden, false);
  const inPop = ids(fly.querySelectorAll('[data-tool]'));
  for (const id of ['hand', 'seed_bag', ...GROUP]) assert.ok(inPop.includes(id), `${id} in the pop-up`);
  assert.ok(!inPop.includes('hammer'), 'no Hammer');
  assert.ok(fly.querySelector('[data-act="build"]'), 'Build is in the pop-up');
});

test('360 x 640: the build bar takes a finger only on its buttons (its band lay over the piece just picked up)', () => {
  const src = fs.readFileSync(new URL('../public/js/game/touch-build.js', import.meta.url), 'utf8');
  assert.match(src, /\.touch-build \{[^}]*pointer-events: none;/, 'the band lets a finger through to the farm');
  assert.match(src, /\.touch-build \.btn \{ pointer-events: auto; \}/, 'the buttons still take it');
  const css = fs.readFileSync(new URL('../public/css/mobile.css', import.meta.url), 'utf8');
  assert.match(css, /body\.tray-open \.hud-chips \{ visibility: hidden; \}/, 'the Undo chip leaves an open tray\'s cards alone');
});
