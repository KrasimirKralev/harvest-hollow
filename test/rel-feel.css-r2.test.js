// QA r2 (life-feel): what the stylesheets and the motion switch decide.
// L2-10 (br#3): a two-button card overflowed on phones ("Много ми харесва" from x -14 at 360 BG: the row 330 px in a
//   248 px paper; `.unlock-banner .acts` had no wrap).
// L2-12 (hv#13): a toast's action button was 42 px tall on touch (S9a: 44); the cards' small buttons too.
// S2-15 (ap#3, patch from ui-shell): "Full" motion picked under an OS that asks for reduced motion reached only the 3D
//   view: every reduced-motion rule keyed on the media query alone. Mine now hold only until the player picks
//   (body.motion-set, settings.js) and follow body.motion-reduced after; the JS checks (the level-up show, the carve) and
//   the sleep bubble's own CSS the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDom } from './ui-qa2-dom.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const sheets = [...index.matchAll(/<link rel="stylesheet" href="\/css\/([\w-]+\.css)">/g)].map((m) => m[1]);
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const css = sheets.map((f) => [f, strip(fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8'))]);

/** Every rule as { file, media (the enclosing @media prelude or ''), sel, body }, in cascade order. */
function rules(list = css) {
  const out = [];
  for (const [file, text] of list) {
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
            else out.push({ file, media, sel, body });
            start = i + 1;
          }
        }
      }
    };
    walk(text, '');
  }
  return out;
}
const ALL = rules();
const decl = (body, prop) => body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim() ?? null;
/** The winning value of `prop` for a selector exactly in a rule's list, among rules whose media passes `mediaOk`. */
function winner(sel, prop, mediaOk = (m) => m === '') {
  let win = null;
  for (const r of ALL) {
    if (!mediaOk(r.media) || !r.sel.split(',').map((s) => s.trim()).includes(sel)) continue;
    const v = decl(r.body, prop);
    if (v !== null) win = { file: r.file, value: v };
  }
  return win;
}

test('L2-10: a card\'s button row wraps, and its buttons keep inside the paper', () => {
  assert.equal(winner('.unlock-banner .acts', 'flex-wrap')?.value, 'wrap');
  assert.equal(winner('.unlock-banner .acts .btn', 'max-width')?.value, '100%');
  assert.equal(winner('.unlock-banner .acts .btn', 'white-space')?.value, 'normal');
});

test('L2-12: on touch a toast\'s action and a card\'s small buttons are 44 px tall', () => {
  const coarse = (m) => /pointer:\s*coarse/.test(m);
  for (const sel of ['.toast .toast-act', '.unlock-banner .btn--small']) {
    const w = winner(sel, 'min-height', coarse);
    assert.ok(w, `${sel}: a min-height under (pointer: coarse)`);
    assert.ok(Number.parseFloat(w.value) >= 44, `${sel}: ${w.value}`);
  }
});

test('S2-15: every reduced-motion rule of feel.css and the sleep bubble holds only until the player picks (body.motion-set)', async () => {
  const feel = rules(css.filter(([f]) => f === 'feel.css'));
  const reduce = feel.filter((r) => /prefers-reduced-motion:\s*reduce/.test(r.media));
  assert.ok(reduce.length > 0, 'there are such rules');
  for (const r of reduce) for (const s of r.sel.split(',')) assert.match(s.trim(), /^body:not\(\.motion-set\)/, `${r.sel}`);
  // the sleep bubble's own stylesheet (render/avatars-view.js injects it)
  const src = fs.readFileSync(path.join(ROOT, 'public/js/render/avatars-view.js'), 'utf8');
  const m = src.match(/@media \(prefers-reduced-motion: reduce\)\{([^}]*)\{/);
  assert.ok(m, 'the zzz rule');
  assert.match(m[1], /^body:not\(\.motion-set\)/, m[1]);
  assert.match(src, /body\.motion-reduced \.hh-zzz>span\{animation:none\}/);
});

test('S2-15: the level-up show and the carve follow the player\'s pick, the OS only before it', async () => {
  const document = installDom();
  document.documentElement = { lang: 'en' };
  globalThis.window ??= globalThis;
  globalThis.addEventListener ??= () => {};
  let osReduce = true;
  globalThis.matchMedia = (q) => ({ matches: osReduce && /prefers-reduced-motion: reduce/.test(q), addEventListener() {}, removeEventListener() {} });
  const { motionStill } = await import('../public/js/ui/levelup.js');
  const body = document.body;
  assert.equal(motionStill(), true, 'before any pick: the OS');
  body.classList.add('motion-set');
  assert.equal(motionStill(), false, '"Full" picked under an OS that reduces: it moves');
  body.classList.add('motion-reduced');
  assert.equal(motionStill(), true, 'reduced picked (or "Like this device" with the OS reducing)');
  osReduce = false;
  body.classList.remove('motion-set', 'motion-reduced');
  assert.equal(motionStill(), false);
  const naming = fs.readFileSync(path.join(ROOT, 'public/js/ui/naming.js'), 'utf8');
  assert.doesNotMatch(naming, /matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)/, 'the carve reads the same switch');
});
