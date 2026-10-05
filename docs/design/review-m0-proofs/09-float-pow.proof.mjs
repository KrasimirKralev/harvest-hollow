// PROOF (RED on M0): nothing stops rules from using Math.pow / ** / exp / log / trig, whose results ECMAScript
// leaves "implementation-approximated" (they may differ in the last bit between V8, SpiderMonkey and
// JavaScriptCore; the partner may open the game in Firefox or Safari). GDD prices are exactly such formulas
// (tree n-th = price x 1.35^(n-1), animal n-th = price x 1.1^(n-1), hive 2300 x 1.1^(n-1)). A last-bit difference
// flips Math.round/floor when the true value sits on a .5 / integer edge, so client and server disagree on a price.
// Run: node --test docs/design/review-m0-proofs/09-float-pow.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('two valid evaluations of a GDD price formula give the same integer price', () => {
  // GDD §3.2/§3.4 base prices and growth factors
  const bases = [[4900, 1.35], [6800, 1.35], [5100, 1.35], [540, 1.1], [930, 1.1], [1900, 1.1], [1100, 1.1], [2300, 1.1],
    [1600, 1.1], [2100, 1.1], [860, 1.1], [1500, 1.1], [3000, 1.1], [1800, 1.1], [2600, 1.1], [3700, 1.1], [3400, 1.1]];
  const diffs = [];
  let ulps = 0;
  for (const [p, g] of bases) {
    let loop = p;
    for (let n = 1; n <= 40; n++) {
      const viaPow = p * g ** (n - 1);
      if (n > 1) loop *= g;
      if (viaPow !== loop) ulps++;
      for (const f of [Math.round, Math.floor, Math.ceil]) {
        if (f(viaPow) !== f(loop)) diffs.push(`${f.name}(${p} x ${g}^${n - 1}): pow=${viaPow} loop=${loop}`);
      }
    }
  }
  console.log(`${ulps} of ${bases.length * 40} values differ in the last bits between p*g**k and repeated *g`);
  console.log(diffs.slice(0, 6).join('\n'));
  assert.equal(diffs.length, 0, `${diffs.length} integer prices depend on how the float was evaluated`);
});

test('the purity scanner bans implementation-approximated Math in shared/', () => {
  const src = fs.readFileSync(path.join(ROOT, 'test/purity.test.js'), 'utf8');
  assert.match(src, /Math\\\.pow|\\\*\\\*|Math\\\.(exp|log)/, 'purity.test.js allows Math.pow / ** / exp / log in rules');
});
