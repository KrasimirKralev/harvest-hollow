// Sideways rows for a mouse (owner 2026-10-19: "Give me a way so i can scroll the seeds and the menus sideways where it
// does apply"): ui/hscroll.js. The pure parts (which edges have more, how far a wheel notch or an arrow goes), the row
// list against the stylesheets (every row css lets scroll sideways is one the helper knows), and the wiring (the helper
// loads after the HUD through the lazy door, so it is not in the boot's eager graph). The browser behaviour (wheel,
// drag without a pick, the ‹ › pair) is walked by the lane's probe on a copy of the owners' farm
// (.scratch/hscroll/behave.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { edgesOf, pagePx, wheelPx, ROWS, OWN_CUE, ARROW_ROWS, DRAG_SLOP } from '../public/js/ui/hscroll.js';
import { StaticFiles } from '../server/static.js';

const list = (sel) => sel.split(',').map((s) => s.trim());

test('edgesOf: an edge has more only past a 2 px slack, and a row that fits has none', () => {
  assert.deepEqual(edgesOf({ scrollLeft: 0, scrollWidth: 700, clientWidth: 700 }), { l: false, r: false });
  assert.deepEqual(edgesOf({ scrollLeft: 0, scrollWidth: 701.5, clientWidth: 700 }), { l: false, r: false },
    'a fractional width is no overflow');
  assert.deepEqual(edgesOf({ scrollLeft: 0, scrollWidth: 987, clientWidth: 760 }), { l: false, r: true },
    'the owners\' seed strip at its start');
  assert.deepEqual(edgesOf({ scrollLeft: 100, scrollWidth: 987, clientWidth: 760 }), { l: true, r: true });
  assert.deepEqual(edgesOf({ scrollLeft: 226, scrollWidth: 987, clientWidth: 760 }), { l: true, r: false },
    'its end, within the slack');
  assert.deepEqual(edgesOf(), { l: false, r: false }, 'nothing measured: nothing to show');
});

test('pagePx: one arrow press is about a page, never a crawl', () => {
  assert.equal(pagePx(760), 608);
  assert.equal(pagePx(300), 240);
  assert.equal(pagePx(40), 60, 'a sliver of a row still moves a card');
});

test('wheelPx: a vertical wheel goes sideways; the browser keeps sideways wheels, Shift, Ctrl and Meta', () => {
  assert.equal(wheelPx({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 600), 100, 'a notch in pixels (Chrome)');
  assert.equal(wheelPx({ deltaX: 0, deltaY: -3, deltaMode: 1 }, 600), -120, 'lines (Firefox): 40 px each');
  assert.equal(wheelPx({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 600), 600, 'a page is the row\'s page');
  assert.equal(wheelPx({ deltaX: 30, deltaY: 10, deltaMode: 0 }, 600), 0,
    'a trackpad\'s sideways swipe scrolls natively');
  assert.equal(wheelPx({ deltaX: 0, deltaY: 0, deltaMode: 0 }, 600), 0);
  for (const k of ['shiftKey', 'ctrlKey', 'metaKey']) {
    assert.equal(wheelPx({ deltaX: 0, deltaY: 100, deltaMode: 0, [k]: true }, 600), 0, k);
  }
  assert.equal(wheelPx(null, 600), 0);
});

test('the rows: every one the owner and the brief named, the own-cue rows apart, a drag slop like the queue\'s', () => {
  const rows = list(ROWS);
  const named = ['.seed-strip', '.seed-tray', '.hh-tabs', '.up-strip', '.lg-hub', '.pn-quick', '.pn-slots', '.sp-grid',
    '.wk-village-wrap'];
  for (const r of named) {
    assert.ok(rows.includes(r), `${r} is a sideways row`);
  }
  const own = list(OWN_CUE);
  const arrows = list(ARROW_ROWS);
  assert.deepEqual([...own, ...arrows].sort(), [...rows].sort(), 'a row draws its own cue or gets the helper\'s, never both');
  assert.equal(DRAG_SLOP, 6, 'the workshop queue\'s mouse slop (panels/queue-drag.js MOUSE_SLOP)');
});

test('every rule that lets a row scroll sideways (overflow-x: auto) names a row the helper knows', () => {
  const rows = new Set(list(ROWS).map((s) => s.slice(1)));
  const dir = path.join(ROOT, 'public/css');
  const missing = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.css'))) {
    // the landing and privacy pages are pages of their own, not the game's UI
    if (/^(landing|privacy)\.css$/.test(f)) continue;
    const css = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/overflow-x:\s*(auto|scroll)/.test(m[2])) continue;
      for (const sel of m[1].split(',')) {
        // the class of the element the rule styles: the last compound's last class
        const last = sel.trim().split(/[\s>+~]+/).at(-1) ?? '';
        const cls = [...last.matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
        if (!cls.some((c) => rows.has(c))) missing.push(`${f}: ${sel.trim()}`);
      }
    }
  }
  assert.deepEqual(missing, [], 'add the row to ROWS in ui/hscroll.js (and to ARROW_ROWS unless it draws its own cue)');
});

test('wiring: the HUD loads the helper through the lazy door after it is up; it is not in the boot\'s eager graph', () => {
  const hud = fs.readFileSync(path.join(ROOT, 'public/js/ui/hud.js'), 'utf8');
  assert.match(hud, /import \{[^}]*\blazyImport\b[^}]*\} from '\.\.\/net\/lazy\.js';/);
  assert.match(hud, /setTimeout\(\(\) => lazyImport\('hscroll', \(\) => import\('\.\/hscroll\.js'\)\)/);
  const quiet = { info() {}, warn() {}, error() {}, log() {} };
  const page = String(new StaticFiles({ root: ROOT, log: quiet }).indexHtml().body);
  assert.ok(page.includes('rel="modulepreload"'), 'the page preloads its graph');
  assert.doesNotMatch(page, /<link rel="modulepreload" href="[^"]*\/ui\/hscroll\.js/, 'the helper is fetched after the boot');
  // the seed strip's outside-press closer leaves a press on the strip's ‹ › alone (toolbar.js)
  const bar = fs.readFileSync(path.join(ROOT, 'public/js/ui/toolbar.js'), 'utf8');
  assert.match(bar, /el\.closest\('#toolbar, #tools-flyout, \.seed-strip, \.hs-pair'\)/);
});

test('css: the fades, the pair and the drag are drawn; the arrows\' glyph is at least 13 px', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/shell.css'), 'utf8');
  const drawn = ['.seed-strip.hs-l::before', '.seed-strip.hs-r::after', '.hs-pair {', '.hs-arrow {', '.hs-drag {', '.hs-l {',
    '.hs-r {'];
  for (const sel of drawn) {
    assert.ok(css.includes(sel), sel);
  }
  const arrow = /\.hs-arrow \{[^}]*font: 800 ([\d.]+)rem/.exec(css);
  assert.ok(arrow && Number(arrow[1]) * 16 >= 13, 'UI-07: the ‹ › is 13 px or more');
});
