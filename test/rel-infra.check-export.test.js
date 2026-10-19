// O2 (release 1.0, option2#1): tools/check-export.mjs fails an export whose public/ or shared/ is not byte for byte
// the reference (git archive <sha>, or a directory in dry runs): a rewritten file, an added file, a missing file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { compareTrees } from '../tools/check-export.mjs';

function tree(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

test('O2: identical public/ and shared/ pass; a rewrite, an extra and a missing file fail, each named', () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'chkexp-'));
  try {
    const base = { 'public/js/main.js': '// a\n', 'public/privacy.html': '<p>operator</p>\n', 'shared/net/ids.js': 'export {};\n', 'README.md': 'private' };
    const ref = tree(path.join(tmp, 'ref'), base);
    const same = tree(path.join(tmp, 'same'), { ...base, 'README.md': 'public readme (outside public/ and shared/)' });
    assert.deepEqual(compareTrees(ref, same), { same: true, files: 3, missing: [], extra: [], differ: [] });
    const bad = tree(path.join(tmp, 'bad'), { 'public/js/main.js': '// b\n', 'public/assets/models/CREDITS.md': 'x', 'shared/net/ids.js': 'export {};\n' });
    const r = compareTrees(ref, bad);
    assert.equal(r.same, false);
    assert.deepEqual(r.differ, ['public/js/main.js']);
    assert.deepEqual(r.extra, ['public/assets/models/CREDITS.md']);
    assert.deepEqual(r.missing, ['public/privacy.html']);
    const cli = (a, b) => { try { execFileSync(process.execPath, [path.join(ROOT, 'tools/check-export.mjs'), '--tree', a, b], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
    assert.equal(cli(ref, same), 0);
    assert.equal(cli(ref, bad), 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
