// QA r4 integration (I4-01, infra's must): every lazy import() the breaker's table names goes through
// public/js/net/lazy.js lazyImport(), so a failed fetch reaches main.js (a reload before the lift, else "Reload"),
// and a console.error stays for real bugs only (importFailed). Plus the two fixes this pass made on the merged tree:
// a sheet opens at its top, and a level card's item names are as wide as their longest word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** The source with comments dropped (a comment that mentions import() is not a call). */
const code = (rel) => src(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

// file -> how many lazyImport( calls the patch put there
const SITES = {
  'public/js/ui/index.js': 1, // installPanels
  'public/js/ui/social.js': 1, // the gift sheet
  'public/js/ui/harness/boot.js': 2, // Harvey and his words
  'public/js/i18n/core.js': 2, // every Bulgarian area and data table
  'public/js/ui/panels/fair.js': 1,
  'public/js/ui/panels/league.js': 1,
  'public/js/ui/panels/w4.js': 1,
  'public/js/ui/panels/market.js': 1,
  'public/js/ui/panels/index.js': 1,
  'public/js/ui/panels/building.js': 1,
  'public/js/render/objects-view.js': 1,
  'public/js/ui/toolbar.js': 1,
  'public/js/ui/qr-scan.js': 2,
  'public/js/ui/ideas.js': 1,
  'public/js/ui/harness/link.js': 2,
  'public/js/ui/recap.js': 1,
};

test('I4-01: each lazy import site of the breaker\'s table goes through lazyImport', () => {
  for (const [file, n] of Object.entries(SITES)) {
    const c = code(file);
    assert.match(c, /import \{[^}]*\blazyImport\b[^}]*\} from '(\.\.\/)+net\/lazy\.js';/, `${file} imports the helper`);
    assert.equal((c.match(/\blazyImport\(/g) || []).length, n, `${file}: ${n} lazyImport call(s)`);
  }
});

test('I4-01: a failed fetch is not swallowed by a regex or logged as a bug at those sites', () => {
  const index = code('public/js/ui/index.js');
  assert.doesNotMatch(index, /Failed to fetch\|Importing a module script failed/, 'installPanels no longer swallows on its own');
  for (const file of Object.keys(SITES)) {
    // (ui/index.js's sync try around bootHarness() is not an import: its import is inside, in harness/boot.js)
    for (const line of code(file).split('\n').filter((l) => /console\.error\(/.test(l) && !/bootHarness\(/.test(l)
      && /did not (load|start)|failed to install|gift sheet|unavailable/.test(l))) {
      assert.match(line, /importFailed\(err\)/, `${file}: ${line.trim()}`);
    }
  }
});

test('a door opens a sheet at its top, set after the frame is shown (ui-panels\' note on the shell)', () => {
  const c = code('public/js/ui/index.js');
  const at = c.indexOf('e.scroll.scrollTop = 0;');
  assert.ok(at > 0, 'open() resets the scroller');
  const shown = c.lastIndexOf('e.frame.hidden = false;', at);
  assert.ok(shown > 0 && at - shown < 80, 'right after the frame is shown (a hidden box has no scroll to set)');
});

test('a level card\'s item name is as wide as its longest word, capped (feel.css, after shell.css\'s 66 px)', () => {
  const css = src('public/css/feel.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1].trim() === '.unlock-banner .thing');
  assert.ok(rule, 'the rule exists');
  assert.match(rule[2], /width:\s*auto/);
  assert.match(rule[2], /min-width:\s*66px/);
  assert.match(rule[2], /max-width:\s*\d+px/);
});

test('the edge arrow survives a target with no id (the NOW card\'s flash): no null read of edgeAt', () => {
  assert.match(code('public/js/ui/tutorial.js'), /if \(!edgeAt \|\| edgeAt\.id !== t\.id \|\|/);
});
