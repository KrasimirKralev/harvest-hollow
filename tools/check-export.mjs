#!/usr/bin/env node
// One build on both hosts (release 1.0 O2, option2#1): the public export must ship public/ and shared/ byte for byte
// as `git archive <sha>` has them (what tools/deploy-box.sh ships to the Farmbox), or the two hosts hash different
// builds (server/static.js buildHash) and option 2's handshake can only ever say "mismatch". Exits 1 with every
// missing, extra or differing file.
//
//   node tools/check-export.mjs <sha> <exportDir>          the reference is `git archive <sha> public shared` (read only)
//   node tools/check-export.mjs --tree <refDir> <exportDir>  the reference is a directory (tests, dry runs)
//   import { compareTrees } from './check-export.mjs'      -> { same, missing, extra, differ, files }
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIRS = ['public', 'shared'];

function list(root) {
  const out = new Map();
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile() || e.isSymbolicLink()) out.set(r, path.join(root, r));
    }
  };
  for (const d of DIRS) walk(d);
  return out;
}

const digest = (abs) => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');

/** Compare public/ and shared/ of two trees: { same, files, missing: [rel], extra: [rel], differ: [rel] }. */
export function compareTrees(refRoot, outRoot) {
  const ref = list(refRoot);
  const out = list(outRoot);
  const missing = [...ref.keys()].filter((r) => !out.has(r)).sort();
  const extra = [...out.keys()].filter((r) => !ref.has(r)).sort();
  const differ = [...ref.keys()].filter((r) => out.has(r) && digest(ref.get(r)) !== digest(out.get(r))).sort();
  return { same: !missing.length && !extra.length && !differ.length, files: ref.size, missing, extra, differ };
}

async function main() {
  const argv = process.argv.slice(2);
  let refRoot;
  let outRoot;
  let tmp = null;
  let label;
  if (argv[0] === '--tree') {
    [, refRoot, outRoot] = argv;
    label = path.relative(REPO, path.resolve(refRoot)) || refRoot;
  } else {
    const [sha, dir] = argv;
    if (!sha || !dir) {
      console.error('usage: node tools/check-export.mjs <sha> <exportDir> | --tree <refDir> <exportDir>');
      process.exit(2);
    }
    tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hh-check-export-'));
    // a read-only snapshot of the commit's public/ and shared/ (no checkout, no worktree)
    const tar = execFileSync('git', ['-C', REPO, 'archive', sha, ...DIRS], { maxBuffer: 1 << 30 });
    execFileSync('tar', ['-x', '-C', tmp], { input: tar });
    refRoot = tmp;
    outRoot = dir;
    label = `git archive ${sha}`;
  }
  if (!outRoot || !fs.existsSync(outRoot)) { console.error(`check-export: no export at ${outRoot}`); process.exit(2); }
  try {
    const r = compareTrees(refRoot, outRoot);
    const { buildHash } = await import(path.join(REPO, 'server/static.js'));
    const hashes = { ref: buildHash(path.resolve(refRoot)), export: buildHash(path.resolve(outRoot)) };
    if (r.same) {
      console.log(`check-export: public/ and shared/ identical to ${label} (${r.files} files; build ${hashes.export})`);
      return;
    }
    const show = (k, a) => a.slice(0, 40).map((f) => `  ${k} ${f}`).join('\n') + (a.length > 40 ? `\n  … and ${a.length - 40} more` : '');
    console.error([`check-export: the export's public/ and shared/ differ from ${label} (build ${hashes.ref} vs ${hashes.export}):`,
      r.missing.length ? show('missing', r.missing) : null, r.extra.length ? show('extra  ', r.extra) : null,
      r.differ.length ? show('differs', r.differ) : null,
      'option 2 needs one build on both hosts: never rewrite or add files under public/ or shared/ in the export'].filter(Boolean).join('\n'));
    process.exitCode = 1;
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => { console.error(err); process.exit(2); });
