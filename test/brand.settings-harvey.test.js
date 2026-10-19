// The helper's settings tab is "Harvey" / "Харви" (`harness.set.tab`): no page, catalog or doc a farmer or operator reads
// may send them to "Settings › Helper", a tab that does not exist. A self-hosted farm's consent link opens PRIVACY.md
// (`PRIVACY_MD_URL#the-in-game-helper`), so the repo's own Markdown counts as much as the served pages (qa-r2 A2-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const OLD = /Settings\s*[›>]\s*Helper|Настройки\s*›\s*Помощник/;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Every file under `dir` (relative to ROOT) whose name ends with one of `exts`. */
function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

/** Source minus whole-line comments: a developer's note naming an old tab is not something a farmer reads. */
const code = (src) => src.split('\n').map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l)).join('\n');

test('A2-01: the docs a farmer is linked to name the tab they will find (Settings › Harvey, the install code)', () => {
  for (const f of ['PRIVACY.md', 'README.md']) {
    const lines = read(f).split('\n');
    const bad = lines.map((l, i) => [i + 1, l]).filter(([, l]) => OLD.test(l)).map(([n, l]) => `${f}:${n}: ${l.trim()}`);
    assert.deepEqual(bad, [], `${f} names a settings tab that does not exist`);
  }
  const privacy = read('PRIVACY.md');
  // the consent card links here by this anchor; renaming the heading would break the link silently
  assert.match(privacy, /^## The in-game helper$/m);
  assert.match(privacy, /install code shown in Settings › Harvey/, 'the deletion route uses the words on the screen');
  assert.match(read('README.md'), /\(Settings › Harvey\)/);
});

test('A2-01: no served page, catalog string or operator message says "Settings › Helper"', () => {
  const files = [
    ...walk('public', ['.html']),
    ...walk('public/js/i18n', ['.js']),
    ...walk('public/js', ['.js']).filter((f) => !f.startsWith('public/js/i18n/')),
    ...walk('shared', ['.js']),
    'tools/ideas.mjs',
  ];
  const bad = [];
  for (const f of files) {
    const src = f.endsWith('.html') ? read(f) : code(read(f));
    src.split('\n').forEach((l, i) => { if (OLD.test(l)) bad.push(`${f}:${i + 1}: ${l.trim()}`); });
  }
  assert.deepEqual(bad, []);
});
