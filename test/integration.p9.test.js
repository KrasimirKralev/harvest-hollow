// Release 1.0 integration (P9, tools/a11y-audit.mjs on the merged tree): the full seed tray (the picker's "⋯",
// ui.openSeeds) closes on Escape like the other flyouts, and the toolbar's buttons carry no menu roles (axe
// aria-allowed-attr / aria-required-parent: a pressed toggle is not a menuitem, a seed is not an option). RED before the
// integration fix: "Escape closes the full seed tray" (the audit: "seeds: Escape does not close it").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { xpForLevel } from '../shared/content/index.js';
import { controllerRig } from './helpers/ui-shell.js';

async function rig({ phone = false } = {}) {
  const document = installDom();
  document.querySelector = (sel) => document.body.querySelector(sel);
  document.querySelectorAll = (sel) => document.body.querySelectorAll(sel);
  const docKeys = [];
  document.addEventListener = (t, fn) => { if (t === 'keydown') docKeys.push(fn); };
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
  return { ...r, document, bar, tb, builds, docKeys };
}


const esc = (docKeys) => { const ev = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  for (const fn of docKeys) fn(ev); return ev; };

test('P9: Escape closes the full seed tray (opened by the picker or ui.openSeeds)', async () => {
  const { document, tb, docKeys } = await rig();
  const tray = document.getElementById('seed-tray');
  tb.openSeeds(true);
  assert.equal(tray.hidden, false, 'the tray is open');
  const ev = esc(docKeys);
  assert.equal(tray.hidden, true, 'Escape closes the full seed tray');
  assert.equal(ev.defaultPrevented, true, 'the key stops there (the tool in hand stays)');
});

test('P9: the tool flyout\'s buttons are toggles (no menuitem) and the seeds are pressed buttons (no option)', async () => {
  const { document, bar, tb } = await rig();
  bar.querySelector('[data-slot="tools"]').click();
  for (const b of document.getElementById('tools-flyout').querySelectorAll('[data-tool]')) {
    assert.equal(b.getAttribute('role'), null, `${b.dataset.tool}: no role`);
    assert.ok(b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-pressed') === 'false', `${b.dataset.tool}: aria-pressed`);
  }
  tb.openSeeds(true);
  const seeds = document.getElementById('seed-tray').querySelectorAll('button.seed');
  assert.ok(seeds.length > 0);
  for (const s of seeds) {
    assert.equal(s.getAttribute('role'), null);
    assert.equal(s.getAttribute('aria-selected'), null);
    assert.ok(['true', 'false'].includes(s.getAttribute('aria-pressed')));
  }
});
