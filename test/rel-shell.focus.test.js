// Release 1.0, ui-shell M13a (perf-a11y#7, ux-phone#6): focus and fields. Tab into the tracker's STORY summary keeps
// the focus on it (shell.css hid the focused button with visibility: hidden, and Chrome blurred it to <body>); a field
// in a panel keeps itself and the button after it above a phone's keyboard (the panel frame's keep-in-view).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDom } from './ui-qa2-dom.js';

const SHELL = fs.readFileSync(new URL('../public/css/shell.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule whose selector list includes `sel`: [{ sel, body }]. */
function rulesFor(css, needle) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) if (m[1].split(',').some((p) => p.trim() === needle)) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
}

test('M13a: a focused STORY summary is never hidden with visibility (it would lose the focus)', () => {
  for (const r of rulesFor(SHELL, '.story-group:focus-within > .story-sum')) {
    assert.doesNotMatch(r.body, /visibility\s*:\s*hidden/, `"${r.sel}" hides a focused button: ${r.body.trim()}`);
  }
});

// QA r1 S-11 (ap#1): the focused summary at opacity 0 over cards replaying their goal-in slide from opacity 0 was a
// blank card; the keyboard sees the summary with its ring and the letters whole, under it
test('S-11: by keyboard the STORY summary stays in sight, its letters open under it with no slide-in', () => {
  for (const r of rulesFor(SHELL, '.story-group:focus-within > .story-sum')) {
    assert.doesNotMatch(r.body, /opacity\s*:\s*0(?![.\d])/, `"${r.sel}" makes the focused summary invisible: ${r.body.trim()}`);
  }
  const under = rulesFor(SHELL, '.story-group:focus-within:not(:hover):not(.open) > .story-pop');
  assert.ok(under.some((r) => /top\s*:\s*calc\(100%/.test(r.body)), 'the letters open under the focused summary');
  for (const sel of ['.story-pop .goal', '.story-group:focus-within .goal']) {
    assert.ok(rulesFor(SHELL, sel).some((r) => /animation\s*:\s*none/.test(r.body)), `${sel}: no goal-in slide (opacity 0 at the focus)`);
  }
});

test('M13a: the panel frame keeps a field and the button after it in view (buttonAfter, keepInView)', async () => {
  const document = installDom();
  const { buttonAfter, keepInView } = await import('../public/js/ui/index.js');
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const root = el('section', 'hh-panel');
  const intro = el('p');
  const field = el('textarea');
  const hiddenBtn = el('button');
  hiddenBtn.hidden = true;
  const ask = el('button', 'ask');
  ask.textContent = 'Ask';                                    // QA r1 S-13: the field's button has words (an icon is not it)
  hiddenBtn.textContent = 'Hidden';
  root.append(el('button', 'close'), intro, field, hiddenBtn, ask);
  assert.equal(buttonAfter(field, root), ask, 'the first visible button after the field');
  const scrolled = [];
  for (const x of [field, ask]) x.scrollIntoView = (o) => scrolled.push([x.className || x.tagName, o.block]);
  document.body.append(root);
  keepInView(field, root);
  assert.deepEqual(scrolled, [['ask', 'end'], ['TEXTAREA', 'nearest']], 'the button to the bottom of the room left, then the field');
});

test('#28 (perf-a11y#13): a panel frame\'s title is not a second banner, and the minis never sit outside a landmark', async () => {
  const src = fs.readFileSync(new URL('../public/js/ui/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /h\('header\.hh-panel-title/, 'the frame title is a div, not a header (landmark-no-duplicate-banner)');
  assert.match(src, /h\('div\.hh-panel-title\.wood', e\.titleIcon, e\.titleText\)/);
  assert.match(src, /e\.titleText = h\('h2\.hh-panel-title-text', \{ id: titleId \}\)/, 'the h2 keeps its id for aria-labelledby');
  assert.ok(rulesFor(SHELL, '#hud > .dock-minis').some((r) => /display\s*:\s*none/.test(r.body)),
    'the minis live in the Farm book sheet, not loose on the HUD (axe "region")');
});
