// QA r2, ui-shell: the layout fixes whose proof is on screen (the probe numbers and shots in
// docs/qa/release/qa-r2/fix-ui-shell.md, docs/qa/release/build/ui-shell/qr2/). These pin the rules that make them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const SHELL = strip(read('public/css/shell.css'));
const MOBILE = strip(read('public/css/mobile.css'));
const STYLE = strip(read('public/css/style.css'));

test('S2-03: the open gear menu stands over the right column Harvey\'s pill lifts to z 6', () => {
  const harness = strip(read('public/css/harness.css'));
  const lift = /\.hud-right:has\(> \.hx-dock \.hx-pill:not\(\[hidden\]\)\) \{ z-index: (\d+); \}/.exec(harness);
  assert.ok(lift, 'the pill lifts the right column');
  const gear = /\.hud-gear:has\(\.edge-menu:not\(\[hidden\]\)\) \{ z-index: (\d+); \}/.exec(SHELL);
  assert.ok(gear, 'HEAD: .hud-gear has no z-index, its menu (z 4) sat under the pill ("Settings" opened Harvey)');
  assert.ok(Number(gear[1]) > Number(lift[1]), `${gear[1]} over ${lift[1]}`);
});

test('S2-10: the step\'s pulse is an outline ring: the tile keeps its own shadows (it looked greyed out)', () => {
  const kf = /@keyframes spot \{([^]*?)\}\s*\}/.exec(SHELL)?.[1] ?? '';
  assert.ok(kf, 'the spot keyframes');
  assert.doesNotMatch(kf, /box-shadow/, 'HEAD: it animated box-shadow, replacing the tile\'s inset border and bottom edge');
  assert.match(kf, /outline-color/);
  assert.doesNotMatch(/\.ui-spot \{[^}]*\}/.exec(SHELL)[0], /box-shadow/);
});

test('S2-15: the device\'s reduced motion holds only until the player\'s choice is applied (body.motion-set)', () => {
  assert.doesNotMatch(STYLE, /@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after/, 'HEAD: every animation cut whatever the player picked');
  assert.match(STYLE, /@media \(prefers-reduced-motion: reduce\) \{\s*body:not\(\.motion-set\) \*, body:not\(\.motion-set\) \*::before, body:not\(\.motion-set\) \*::after/);
  assert.match(read('public/js/ui/settings.js'), /document\.body\.classList\.add\('motion-set'\);/);
  // every reduced-motion block in the ui-shell lane's files is keyed the same way
  for (const f of ['public/css/style.css', 'public/css/shell.css', 'public/css/ideas.css', 'public/js/game/fishing-hud.js', 'public/js/game/mode-chip.js', 'public/js/game/touch-build.js']) {
    const src = strip(read(f));
    for (const m of src.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([^]*?)\}\s*\}?/g)) {
      const sel = m[1].split('{')[0];
      assert.match(sel, /body:not\(\.motion-set\)/, `${f}: ${sel.trim().slice(0, 80)}`);
    }
  }
  assert.match(read('public/js/ui/dom.js'), /!document\.body\.classList\.contains\('motion-set'\) && Boolean\(globalThis\.matchMedia/, 'the number roll too');
});

test('S2-16: a portrait boot frames the couple (70 % across), the chimney smoke on the same anchor', () => {
  const portrait = /@media \(orientation: portrait\) \{([^]*?)\n\}/.exec(SHELL)?.[1] ?? '';
  assert.match(portrait, /#boot\.modal-layer \{ background-position: 70% 50%, 70% 50%; \}/, 'the painting and its LQIP');
  assert.match(portrait, /#boot > \.smoke \.plume \{ --bx: 70; \}/);
  assert.match(SHELL, /left: calc\(var\(--bx, 50\) \* 1cqw \+ \(var\(--x\) - var\(--bx, 50\) \* 19\.2\) \* var\(--u\)\);/);
  // the formula at 50 is HEAD's: 50cqw + (x - 960) u
  const at = (bx, x, W, u) => bx / 100 * W + (x - bx * 19.2) * u;
  assert.equal(at(50, 868, 1366, 1366 / 1920), 0.5 * 1366 + (868 - 960) * (1366 / 1920));
  // 70 %: the painting's x 1344 (70 % of 1920) at 70 % of the screen
  assert.ok(Math.abs(at(70, 1344, 390, 844 / 1080) - 0.7 * 390) < 1e-9);
});

test('S2-19: the folded key list says it opens (▸ / ▾)', () => {
  assert.match(SHELL, /\.settings \.set-fold > summary::after \{ content: '▸';/);
  assert.match(SHELL, /\.settings \.set-fold\[open\] > summary::after \{ content: '▾'; \}/);
});

test('S2-21: the Farm book keeps one caption size: two centred lines for a two-word caption, a smaller word only as a last resort', () => {
  const src = read('public/js/ui/layout.js');
  assert.match(src, /el\.classList\.add\('two'\);/);
  // as specific as the later rules that set a one-line caption's bottom (both set, the pill stayed one line tall)
  assert.match(SHELL, /\.farm-book \.dock-mini \.lbl\.two, \.farm-book \.social-btn > \.lbl\.two, \.farm-book \.m-tile \.lbl\.two \{ white-space: normal;[^}]*bottom: auto;/);
  assert.match(MOBILE, /\.farm-book \.dock-mini \.lbl, \.farm-book \.social-btn > \.lbl, \.farm-book \.m-tile \.lbl \{ padding-left: 5px; padding-right: 5px; \}/);
});

test('S2-C1: at 360 the five Together tiles stand three over two, centred (no surprise alone on a second row)', () => {
  const narrow = /@media \(max-width: 374px\) \{([^]*?)\n {2}\}/.exec(MOBILE)?.[1] ?? '';
  assert.match(narrow, /\.together-menu:not\(:has\(> button\[hidden\]\)\):has\(> button:nth-of-type\(5\)\) \{ grid-template-columns: repeat\(6, minmax\(0, 1fr\)\); \}/);
  assert.match(narrow, /> button:nth-of-type\(4\) \{ grid-column: 2 \/ span 2; \}/);
});

test('S2-23: the seed picker keeps above the bar, its seeds scroll when it is taller than that room', () => {
  const src = read('public/js/ui/seeds.js');
  assert.match(src, /function floorY\(\)/);
  assert.match(src, /popPlacement\(\{ x: p\.x \/ k, y: p\.y \/ k \}, size, \{ w: innerWidth \/ k, h: floor \}, \{ margin: SP_MARGIN \}\)/, 'HEAD: the screen\'s bottom, under the bar');
  assert.match(src, /grid\.style\.overflowY = 'auto';/);
  assert.match(MOBILE, /\.sp-clk \{ display: none; \}/);
});

test('S2-23: popPlacement inside a view cut at the bar: the card\'s bottom stays above it', async () => {
  const { popPlacement } = await import('../public/js/ui/seeds.js');
  // the iPhone at 21:00: a 691 px card (capped by the room) for a plot at y 420, the bar's top at 730
  const pos = popPlacement({ x: 200, y: 420 }, { w: 366, h: 691 }, { w: 390, h: 730 }, { margin: 12 });
  assert.ok(pos.top + 691 <= 730 - 12 + 0.5, `bottom ${pos.top + 691} above the bar`);
});
