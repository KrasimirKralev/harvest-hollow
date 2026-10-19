// Release 1.0 (life-feel): what the stylesheets decide, read in their cascade order (index.html links, feel.css last).
// M19 (harvey#15): the card entrance in the right column never grows past its final box (no slide from the right, no
// rotation, no scale over 1, no overshooting easing): at 360 x 640 Harvey's button sits right beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const sheets = [...index.matchAll(/<link rel="stylesheet" href="\/css\/([\w-]+\.css)">/g)].map((m) => m[1]);
const css = sheets.map((f) => [f, fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]);

/** Top-level rules only (media blocks skipped): [{ file, sel, body }], in cascade order. */
function rules() {
  const out = [];
  for (const [file, text] of css) {
    let depth = 0; let start = 0; let sel = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '{') { if (depth === 0) { sel = text.slice(start, i).trim(); start = i + 1; } depth++; }
      else if (c === '}') { depth--; if (depth === 0) { out.push({ file, sel, body: text.slice(start, i) }); start = i + 1; } }
    }
  }
  return out;
}
const ALL = rules();
/** The `animation` of the last top-level rule whose selector list has exactly `sel` (the cascade's winner). */
function animationOf(sel) {
  let win = null;
  for (const r of ALL) {
    if (!r.sel.split(',').map((s) => s.trim()).includes(sel)) continue;
    const m = r.body.match(/(?:^|;)\s*animation\s*:\s*([^;]+)/);
    if (m) win = { file: r.file, value: m[1].trim() };
  }
  return win;
}
const keyframes = (name) => {
  let last = null;
  for (const r of ALL) if (r.sel === `@keyframes ${name}`) last = r;
  return last;
};

test('M19: the cards in the right column scale in inside their final box (no slide, no turn, no overshoot)', () => {
  for (const sel of ['.unlock-banner', '.bloom-banner', '.unlock-banner.leaving']) {
    const a = animationOf(sel);
    assert.ok(a, `${sel} has an animation`);
    const name = a.value.split(/[\s,]+/)[0];
    const k = keyframes(name);
    assert.ok(k, `@keyframes ${name}`);
    assert.doesNotMatch(k.body, /translate|rotate/, `${sel}: ${name} moves or turns the card (${a.file}): ${k.body.trim()}`);
    for (const m of k.body.matchAll(/scale\(\s*([\d.]+)/g)) assert.ok(Number(m[1]) <= 1, `${name}: scale ${m[1]}`);
    assert.doesNotMatch(a.value, /ease-back|cubic-bezier\([^)]*1\.[1-9]/, `${sel}: an overshooting easing (${a.value})`);
  }
});

/** Every top-level and media-nested rule (selector, body, media), for the press-state checks. */
function allRules() {
  const out = [];
  for (const [file, text] of css) {
    const walk = (src, media) => {
      let depth = 0; let start = 0; let sel = '';
      for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '{') { if (depth === 0) { sel = src.slice(start, i).trim(); start = i + 1; } depth++; }
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            const body = src.slice(start, i);
            if (sel.startsWith('@media')) walk(body, sel); else out.push({ file, sel, body, media });
            start = i + 1;
          }
        }
      }
    };
    walk(text, null);
  }
  return out;
}

test('F5: every tappable card has a pressed state, and on a touch screen no hover lift sticks after a tap', () => {
  const rules = allRules();
  const pressed = (cls) => rules.some((r) => !r.media && r.sel.includes(cls) && /:active/.test(r.sel) && new RegExp(`\\${cls}\\b`).test(r.sel)
    && /transform|filter/.test(r.body));
  for (const cls of ['.pn-card', '.pn-stack', '.pn-order', '.goal', '.chip', '.seed', '.farmer', '.hh-tab', '.gate-farm', '.pn-slot-x', '.pn-wishbtn']) {
    assert.ok(pressed(cls), `${cls}: no :active state (feel#11)`);
  }
  const unstuck = (sel) => rules.some((r) => r.media && /hover:\s*none/.test(r.media) && r.sel.includes(sel) && /transform:\s*none/.test(r.body));
  for (const cls of ['.pn-card', '.pn-stack', '.pn-order', '.pn-wishbtn']) assert.ok(unstuck(cls), `${cls}: its hover lift sticks on a touch screen`);
});
