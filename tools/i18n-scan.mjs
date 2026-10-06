// The English-literal scanner (i18n lane A): finds strings in UI code that a player would read in English, so a new
// one cannot slip in after the translation. test/i18n.scan.test.js runs it over every UI file against the allow-list
// test/i18n-allowlist.json (the strings each file still has, which the translator lanes shrink to nothing).
//
//   node tools/i18n-scan.mjs                 list every file's English literals (counts per file, then the strings)
//   node tools/i18n-scan.mjs <file>...       the literals of those files with their line numbers
//   node tools/i18n-scan.mjs --update        rewrite test/i18n-allowlist.json from the code as it is now (do it only
//                                            when you REMOVED strings, or for a reviewed exception; the diff shows it)
//
// Heuristic, not a parser: a string or template literal counts when it has a word of two or more Latin letters and
// reads like words (a space between words, or one capitalised word), on a line that is not a comment, not a log or an
// Error, and not an import. Selectors, ids, CSS, event and key names, URLs and code-like tokens are skipped. A false
// positive costs one allow-list line; an `// i18n-ok` comment on the line skips it for good (brand names, music titles).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWLIST = path.join(ROOT, 'test/i18n-allowlist.json');

/** The UI code the scanner covers: the client's modules (not the i18n catalogs, not vendor code) and the rules files
 *  that build player-facing text (lane C turns them into { key, params }). */
export function scanFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { if (rel !== 'public/js/i18n') walk(rel); continue; }
      if (e.name.endsWith('.js')) out.push(rel);
    }
  };
  walk('public/js');
  for (const f of ['shared/rules/goals.js', 'shared/rules/actions/quests.js', 'shared/rules/upgrades.js', 'shared/rules/actions/pets.js']) {
    if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  }
  return out.sort();
}

// a line that never carries player text
const SKIP_LINE = /^\s*(?:\/\/|\/\*|\*|import\b|export\s+\*|export\s*\{[^}]*\}\s*from)|console\.\w+\(|new Error\(|throw\b|\bi18n-ok\b|assert\.|addEventListener\(|removeEventListener\(|querySelector(?:All)?\(|getElementById\(|classList\.|className\s*=|\.font\s*=|\.closest\(|\.matches\(|setProperty\(|getPropertyValue\(|matchMedia\(|\.dataset\.|createElementNS?\(|\bfetch\(|localStorage|sessionStorage/;

// a literal that is code, not words
function codeLike(s) {
  const v = s.replace(/\$\{[^}]*\}/g, 'X').trim();
  if (/^Bearer\b|^noopener\b/.test(v)) return true;
  if (/<\/?[a-z][\w-]*[\s>/]/i.test(v) && /[=>]/.test(v)) return true;                                // markup
  if (/(?:^|\s)[a-z]+--[a-z]/.test(v) && !/[A-Z]/.test(v.replace(/X/g, ''))) return true;           // 'btn btn--small'
  if (!/[A-Za-z]{2}/.test(v)) return true;
  if (/^(?:https?:|mailto:|data:|blob:|\/|\.\/|\.\.\/|#[0-9a-f]{3,8}\b)/i.test(v)) return true;      // urls, paths, colours
  if (/^[a-z0-9_$-]+(?:[.#:][\w-]+)*$/.test(v)) return true;                                        // ids, keys, classes, 'div.x'
  if (/^[a-z][\w-]*(?:\.[\w-]*)+$/i.test(v) && !/\s/.test(v)) return true;                             // dotted keys
  if (/^[\w-]+(?:\s*,\s*[\w-]+)+$/.test(v) && !/[A-Z]/.test(v)) return true;                        // 'a, b' event lists
  if (/\d(?:px|rem|em|vh|vw|deg|ms)\b|X(?:px|ms)\b/.test(v)) return true;                            // CSS values
  if (/[{};]|=>|\(\)|^\s*[.#[][\w-]|\b(?:px|rem|em|vh|vw|deg|ms)\b|rgba?\(|var\(--|calc\(|cubic-bezier|translate[XY]?\(|scale\(/.test(v) && !/[a-z]{3,} [a-z]{3,} [a-z]{3,}/.test(v)) return true;
  if (/^(?:[a-z-]+\s*)+$/.test(v) && !/\s/.test(v)) return true;                                    // one lower-case token
  if (/^(?:[a-z][\w-]*\s+)*[a-z][\w-]*$/.test(v) && /-|_/.test(v)) return true;                    // 'btn btn--small'
  if (/^(?:Key|Digit|Arrow|Numpad)[A-Z0-9]\w*$/.test(v) || /^(?:Escape|Enter|Tab|Shift|Control|Alt|Meta|Backspace|Delete|Space|Home|End|PageUp|PageDown|F\d{1,2})$/.test(v)) return true;
  if (/^(?:GET|POST|PUT|DELETE|HEAD|OK|UTF-8|WebGL2?|JSON)$/.test(v)) return true;
  if (/^[A-Z][A-Z0-9_]+$/.test(v)) return true;                                                     // CONSTANT codes
  if (/^(?:[a-z]+[A-Z]\w*)$/.test(v)) return true;                                                  // camelCase
  return false;
}

// where a single word is shown to a player (a lone capitalised word elsewhere is usually a clip, material or key name)
const UI_CONTEXT = /\bh\(|text|label|title|[Tt]oast|tip|aria-|placeholder|\balt\b|message|hint|\bsub\b|\blead\b|\bnote\b|ribbon|banner|float|chip|caption|\bok\b|cancel|\bname\b|\bverb\b|\bword|\bbtn|button|\bseg\(|\bpill/;

/** Does this literal read like words a player would see? */
function wordy(s, line) {
  if (codeLike(s)) return false;
  const v = s.replace(/\$\{[^}]*\}/g, ' ').trim();
  if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(v)) return true;               // two words
  if (!UI_CONTEXT.test(line)) return false;
  if (/^[A-Z][a-z]{2,}[!?.…]*$/.test(v)) return true;                   // 'Close', 'Settings'
  if (/[A-Za-z]{3,}[!?.…:]$/.test(v)) return true;                      // 'done!'
  if (/^\s*[A-Za-z]{3,}\s*$/.test(v) && /^\s/.test(s)) return true;     // ' coins'
  return false;
}

/** The English literals of one source: [{ line, text }]. */
export function scanSource(src) {
  const out = [];
  const lines = src.split('\n');
  let inBlock = false;
  lines.forEach((line, i) => {
    if (inBlock) { if (line.includes('*/')) inBlock = false; return; }
    if (/^\s*\/\*/.test(line) && !line.includes('*/')) { inBlock = true; return; }
    if (SKIP_LINE.test(line)) return;
    // strip a trailing // comment (not inside a string: good enough for this code base's style)
    const code = line.replace(/\s\/\/\s.*$/, '');
    const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      const text = m[1] ?? m[2] ?? m[3] ?? '';
      if (wordy(text, code)) out.push({ line: i + 1, text });
    }
  });
  return out;
}

/** { file: [unique literals in order] } for every scanned file that has any. */
export function scanAll() {
  const res = {};
  for (const f of scanFiles()) {
    const found = scanSource(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    if (found.length) res[f] = [...new Set(found.map((x) => x.text))];
  }
  return res;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--update') {
    const all = scanAll();
    fs.writeFileSync(ALLOWLIST, `${JSON.stringify(all, null, 1)}\n`);
    console.log(`wrote ${path.relative(ROOT, ALLOWLIST)}: ${Object.values(all).reduce((a, l) => a + l.length, 0)} strings in ${Object.keys(all).length} files`);
  } else if (args.length) {
    for (const f of args) {
      for (const { line, text } of scanSource(fs.readFileSync(path.resolve(f), 'utf8'))) console.log(`${f}:${line}: ${text}`);
    }
  } else {
    const all = scanAll();
    for (const [f, l] of Object.entries(all).sort((a, b) => b[1].length - a[1].length)) console.log(String(l.length).padStart(4), f);
  }
}
