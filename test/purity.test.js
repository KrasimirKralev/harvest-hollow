// shared/ must be pure: no clock reads, no randomness, no DOM, no Node built-ins (tech §9 purity.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.js') ? [p] : [];
  });
}

/** Drop comments so prose like "c = client performance.now()" in JSDoc does not count. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

const BANNED = [
  [/Math\.random\s*\(/, 'Math.random'],
  [/Date\.now\s*\(/, 'Date.now'],
  [/performance\.now\s*\(/, 'performance.now'],
  [/new\s+Date\s*\(/, 'new Date('],
  [/\bDate\s*\(\s*\)/, 'Date()'],
  [/from\s+['"]node:|import\s*\(\s*['"]node:|require\s*\(/, 'node: import / require'],
  [/\b(document|window|localStorage|sessionStorage|navigator|location)\s*\./, 'DOM / browser global'],
  [/\bsetTimeout\s*\(|\bsetInterval\s*\(/, 'timers'],
  [/\bprocess\./, 'process'],
];

// Rules and content must compute every value that becomes state identically in every browser (review-m0 #8):
// ECMAScript leaves `**`, Math.pow/exp/log/trig "implementation-approximated", and locale functions differ.
// Use integer math (basis points, economy.grow()). shared/net/ keeps its float math: it is cosmetic presence.
const RULES_BANNED = [
  [/\*\*|Math\.(pow|exp|expm1|log|log1p|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|cbrt|hypot)\s*\(/,
    'implementation-approximated float math (**, Math.pow/exp/log/trig/hypot/cbrt)'],
  [/\.(toLocaleString|toLocaleLowerCase|toLocaleUpperCase|localeCompare)\s*\(|Intl\.(Collator|NumberFormat|PluralRules|Segmenter)/,
    'locale-dependent functions'],
];

const files = walk(path.join(ROOT, 'shared'));
const isRules = (f) => /[\\/]shared[\\/](rules|content)[\\/]/.test(f);

test('shared/ has files to check', () => {
  assert.ok(files.length >= 15, `only ${files.length} files found`);
});

for (const f of files) {
  test(`pure: ${path.relative(ROOT, f)}`, () => {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (const [re, what] of BANNED) assert.doesNotMatch(src, re, `${what} is banned in shared/`);
    if (isRules(f)) for (const [re, what] of RULES_BANNED) assert.doesNotMatch(src, re, `${what} is banned in shared/rules and shared/content`);
  });
}

test('the purity scanner itself catches violations', () => {
  const bad = "const t = Date.now(); // ok comment\nconst r = Math.random();\nimport fs from 'node:fs';";
  const src = stripComments(bad);
  assert.match(src, BANNED[0][0]);
  assert.match(src, BANNED[1][0]);
  assert.match(src, BANNED[5][0]);
  assert.doesNotMatch(stripComments('// Date.now() in a comment'), BANNED[1][0]);
});

test('the scanner bans float and locale math in rules (review-m0 #8)', () => {
  for (const bad of ['const p = 4900 * 1.35 ** (n - 1);', 'Math.pow(1.1, n)', 'Math.log(x)', 'Math.hypot(a, b)',
    'n.toLocaleString()', 'a.localeCompare(b)', 'new Intl.NumberFormat()']) {
    assert.ok(RULES_BANNED.some(([re]) => re.test(stripComments(bad))), bad);
  }
  for (const ok of ['/** doc */ const x = a * b;', 'Math.floor((p * 13500) / 10_000)', 'Math.max(0, n)', 'new Intl.DateTimeFormat']) {
    assert.ok(!RULES_BANNED.some(([re]) => re.test(stripComments(ok))), ok);
  }
});
