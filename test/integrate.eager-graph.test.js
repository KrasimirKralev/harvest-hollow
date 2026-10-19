// The eager JavaScript budget (release-scope §8 "Static-graph JS", critique#26) as a gate, not a number in the notes.
// Every module the page preloads is fetched before main.js runs, so on a cold boot each KB of it sits on the critical
// path (11.8 ms at the Funnel's 85 KB/s, 1.8 ms at the host's 550 KB/s). The integrator records the ceiling and its
// reason in docs/agent-notes/rel-integration.md ("Eager JS"); past it this test fails and the call is made again with
// fresh numbers, so a recorded reason can no longer go stale while the graph grows (qa-r2 A2-02).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { ROOT } from './helpers.js';
import { StaticFiles, fileOf } from '../server/static.js';

// HEAD fdafb9c, measured by this method (.scratch/rb-integrator/head): 276 eager modules
const HEAD = { gzipKB: 1863.7, codeKB: 1213.6 };
// the ceiling the integrator recorded (rel-integration.md, "Eager JS"); a change here needs a new line there.
// qa r1 recorded +97.0 / +51.9 and the graph passed it silently (5bbfbca: +126.2 / +65.1); qa r2 decided +175 / +90;
// qa r4's fixes (+10.6 KB gzip, the I4-01 lazy-import door among them) needed the ceiling re-decided at +186.5 / +96.0;
// the owner's sideways rows (2026-10-19: hud.js's lazy loader of ui/hscroll.js, two English labels) +0.17 gzip.
// the owner's crate power-ups (2026-10-19, features lane; rel-integration.md "Eager JS: crate power-ups"): the rules the
// client predicts with (shared/rules/powerups.js and its hooks), the English words, small hooks; the screen part is lazy
const POWERUPS = { gzipKB: 5.49, codeKB: 3.56 };
// the owner's "Show Harvey" (2026-10-19, ui-shell lane; rel-integration.md "Owner request 2026-10-19: phone icons off
// the centre"): ui/settings.js's showHarvey default and sanitize key (55 B / 67 B); the switch and the phone chip are lazy
const SHOW_HARVEY = { gzipKB: 0.06, codeKB: 0.07 };
// the tap-through fix (2026-10-19, ui-shell lane; same section): game/touch.js createQuiet and its controller wiring, so
// the second tap of a double tap on a sheet that closes never acts on the farm (470 B / 294 B)
const TAP_THROUGH = { gzipKB: 0.47, codeKB: 0.30 };
// the owner's "portraits cover the coins" (2026-10-20, lead; rel-integration.md "Owner request 2026-10-20"): hud.js
// fit()'s second step, 'stack' on the top-left row (118 B / 45 B)
const TOP_ROW_STACK = { gzipKB: 0.12, codeKB: 0.05 };
const RECORD = {
  gzipKB: HEAD.gzipKB + 186.67 + POWERUPS.gzipKB + SHOW_HARVEY.gzipKB + TAP_THROUGH.gzipKB
    + TOP_ROW_STACK.gzipKB,
  codeKB: HEAD.codeKB + 96.0 + POWERUPS.codeKB + SHOW_HARVEY.codeKB + TAP_THROUGH.codeKB
    + TOP_ROW_STACK.codeKB,
  decided: 'owner 2026-10-19 sideways rows + crate power-ups + Show Harvey + tap-through; 2026-10-20 top row stack',
};

const quiet = { info() {}, warn() {}, error() {}, log() {} };
/** Whole-line `//` comments and `/** … *\/` blocks removed: the bytes a comment strip would leave (an estimate). */
const codeOnly = (src) => src.replace(/^\s*\/\*\*?[\s\S]*?\*\/\s*$/gm, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const gz = (s) => zlib.gzipSync(s, { level: 6 }).length; // the server's level (server/static.js gzips at the default)

let memo = null;
function eagerGraph() {
  if (memo) return memo;
  const page = new StaticFiles({ root: ROOT, log: quiet }).indexHtml();
  const urls = ['/js/main.js', ...[...String(page.body).matchAll(/<link rel="modulepreload" href="([^"?]+)/g)].map((m) => m[1])];
  let all = 0;
  let code = 0;
  for (const u of urls) {
    const f = fileOf(ROOT, u);
    assert.ok(f && fs.existsSync(f.abs), `a preloaded module is a file: ${u}`);
    const src = fs.readFileSync(f.abs, 'utf8');
    all += gz(src);
    code += gz(codeOnly(src));
  }
  memo = { urls, gzipKB: all / 1024, codeKB: code / 1024 };
  return memo;
}

test('A2-02: the eager module graph stays inside the ceiling the integrator recorded', () => {
  const g = eagerGraph();
  // a scan that finds no preloads would pass any budget: the page must still preload the game's graph
  assert.ok(g.urls.length >= 200, `the page preloads the eager graph (${g.urls.length} modules)`);
  const say = (k) => `${g[k].toFixed(1)} KB (HEAD ${HEAD[k]}, +${(g[k] - HEAD[k]).toFixed(1)}) > recorded ${RECORD[k].toFixed(1)} `
    + `(${RECORD.decided}): re-measure and record a new decision in rel-integration.md "Eager JS", or take a lever`;
  assert.ok(g.gzipKB <= RECORD.gzipKB, `eager JS gzip ${say('gzipKB')}`);
  assert.ok(g.codeKB <= RECORD.codeKB, `eager JS code-only gzip ${say('codeKB')}`);
});

test('A2-02: what the budget line says stays lazy is not in the eager graph (the gift panel, Bulgarian catalogs, the power-ups)', () => {
  const { urls } = eagerGraph();
  assert.deepEqual(urls.filter((u) => /\/ui\/panels\/gift\.js$|\/i18n\/bg\/|\/ui\/powerups\.js$|\/render\/powerups-view\.js$/.test(u)), []);
});
