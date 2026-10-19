// QA r1 (life-feel): text that must stay inside its box, read from the stylesheets in their cascade order (index.html's
// links, feel.css last). L-09 (br#2): a pasted link or a 200-letter word in chat ran off the toast and the feed line:
// both break anywhere. L-08 (fe#6): the welcome-back card's surprise line let "Покажи ми" spill out of its 77 px button
// at 360 BG: the line wraps, the button keeps its own width. The pixels are in docs/qa/release/build/life-feel/qa-r1/.
// HH_CSS_ROOT points the test at another tree (the tested head, for the red run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HH_CSS_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const sheets = [...index.matchAll(/<link rel="stylesheet" href="\/css\/([\w-]+\.css)">/g)].map((m) => m[1]);
const css = sheets.map((f) => [f, fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]);

/** Every rule, media blocks included: [{ file, media, sel: [..], decl: Map }], in cascade order. */
function rules() {
  const out = [];
  const walk = (file, text, media) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1; let j = open + 1;
      while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith('@media') || head.startsWith('@supports')) walk(file, body, head);
      else if (!head.startsWith('@')) {
        const decl = new Map();
        for (const d of body.split(';')) { const k = d.indexOf(':'); if (k > 0) decl.set(d.slice(0, k).trim(), d.slice(k + 1).trim()); }
        out.push({ file, media, sel: head.split(',').map((s) => s.trim()), decl });
      }
      i = j;
    }
  };
  for (const [file, text] of css) walk(file, text, null);
  return out;
}
const ALL = rules();
/** The value the last rule (outside media, or any media when `anyMedia`) gives `prop` for exactly the selector `sel`. */
function valueOf(sel, prop, { anyMedia = false } = {}) {
  let v = null;
  for (const r of ALL) if ((anyMedia || !r.media) && r.sel.includes(sel) && r.decl.has(prop)) v = { value: r.decl.get(prop), file: r.file };
  return v;
}

test('L-09: a feed line\'s words and a toast\'s words break anywhere rather than run out of their box', () => {
  for (const sel of ['.feed li .txt', '.toast .tx']) {
    const v = valueOf(sel, 'overflow-wrap');
    assert.ok(v && /anywhere/.test(v.value), `${sel}: overflow-wrap ${v ? v.value : 'unset'}`);
  }
});

test('L-08: the welcome-back card\'s surprise line wraps, and its "Show me" keeps its own width (never squeezed)', () => {
  const wrap = valueOf('.recap .recap-surprise li', 'flex-wrap');
  assert.ok(wrap && wrap.value === 'wrap', `the line wraps: ${wrap ? wrap.value : 'unset'}`);
  const btn = valueOf('.recap .recap-surprise li > .btn', 'flex');
  assert.ok(btn && /^none$|^0 0/.test(btn.value), `the button does not shrink: ${btn ? btn.value : 'unset'}`);
  const ws = valueOf('.recap .recap-surprise li > .btn', 'white-space');
  assert.ok(ws && ws.value === 'nowrap', 'its words on one line');
});
