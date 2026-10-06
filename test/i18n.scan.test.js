// i18n (lane A): no new English a player would read slips into the UI code. tools/i18n-scan.mjs finds the literals;
// test/i18n-allowlist.json lists the ones each file still has. The translator lanes shrink the list file by file
// (run `node tools/i18n-scan.mjs --update` after removing strings and commit the smaller list); lane A's files are at
// zero and must stay there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scanAll, scanSource, ALLOWLIST } from '../tools/i18n-scan.mjs';

/** Lane A's files (docs/agent-notes/i18n-core.md "Who owns what"): fully translated. */
const LANE_A = [
  'public/js/main.js', 'public/js/landing.js', 'public/js/net/content-gate.js', 'public/js/net/farm.js', 'public/js/net/sync.js',
  'public/js/net/socket.js', 'public/js/render/fx.js', 'public/js/render/avatars-view.js',
  ...['index', 'dom', 'hud', 'layout', 'social', 'naming', 'toasts', 'dialogs', 'levelup', 'recap', 'tutorial', 'settings',
    'toolbar', 'seeds', 'crop-hurry', 'item-hint', 'chains', 'farm-gate', 'invite', 'lang-toggle'].map((f) => `public/js/ui/${f}.js`),
  'public/js/ui/panels/index.js',
  ...fs.readdirSync(new URL('../public/js/game/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `public/js/game/${f}`),
];

test('no English literal outside the allow-list, and no stale allow-list entry', () => {
  const allow = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8'));
  const found = scanAll();
  const fresh = [];
  const stale = [];
  for (const [file, list] of Object.entries(found)) {
    const ok = new Set(allow[file] ?? []);
    for (const s of list) if (!ok.has(s)) fresh.push(`${file}: ${JSON.stringify(s)}`);
  }
  for (const [file, list] of Object.entries(allow)) {
    const now = new Set(found[file] ?? []);
    for (const s of list) if (!now.has(s)) stale.push(`${file}: ${JSON.stringify(s)}`);
  }
  assert.deepEqual(fresh, [], 'new English text in UI code: put it in the area\'s catalog (docs/agent-notes/i18n-core.md)');
  assert.deepEqual(stale, [], 'translated strings are still in test/i18n-allowlist.json: run node tools/i18n-scan.mjs --update');
});

test('lane A\'s files have no English left (their allow-list is empty)', () => {
  const allow = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8'));
  for (const f of LANE_A) assert.equal(allow[f], undefined, `${f} is lane A's and fully translated`);
});

test('the scanner sees words, not code', () => {
  const src = [
    "h('div.panel', { 'aria-label': 'Close the panel' }, 'Sell');",
    "toast(`${name} harvested ${n} carrots`);",
    "el.className = 'btn btn--small';",
    "console.warn('could not load the thing', err);",
    "const id = 'hh.tips.seen'; const k = `Key${x}`;",
    "label: 'Settings', // a real label",
    "text: 'Harvest Hollow', // i18n-ok: the brand",
    "g.font = '18px sans-serif';",
    "import { x } from './some file.js';",
  ].join('\n');
  const got = scanSource(src).map((x) => x.text);
  assert.deepEqual(got, ['Close the panel', 'Sell', '${name} harvested ${n} carrots', 'Settings']);
});
