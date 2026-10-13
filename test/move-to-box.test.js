// tools/move-to-box.sh packs the farm's save for the 24/7 box (verifier 2026-10-13, defect 5): the farmers' helper
// sign-ins (Claude Code logins and ChatGPT tokens under harness/users/, per farm in multi mode) are personal and stay on
// this machine; the farmers sign in again on the new host. Only the script's packing line runs here (never the ssh,
// systemctl or copy steps): it is taken from the script as it is and run against a scratch save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.js';

const SCRIPT = path.join(ROOT, 'tools', 'move-to-box.sh');

function scratchSave() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-move-'));
  const put = (rel, text = '{}\n') => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  put('data/farm.json', '{"v":1}\n');
  put('data/farm.journal.jsonl');
  put('data/harness/mods/active.json');
  put('data/harness/consent.json');
  put('data/harness/jobs/0123456789abcdef/job.json');
  put('data/harness/users/p1/claude/config/.credentials.json', '{"t":"SECRET-LOGIN"}\n');
  put('data/harness/users/p2/openai/oaiapp_x/abc.json', '{"access_token":"SECRET-TOKEN"}\n');
  put('data/harness-host/install.json');
  put('data/farms/abcdefabcdef/farm.json');
  put('data/farms/abcdefabcdef/harness/mods/active.json');
  put('data/farms/abcdefabcdef/harness/users/p1/openai/oaiapp_y/def.json', '{"access_token":"SECRET-MULTI"}\n');
  return repo;
}

test('the box gets the save without the farmers\' helper sign-ins, and the script says so', (t) => {
  const text = fs.readFileSync(SCRIPT, 'utf8');
  const lines = text.split('\n').filter((l) => /^\s*tar -czf "\$TMP\/data\.tgz"/.test(l));
  assert.equal(lines.length, 1, 'one packing line');
  const repo = scratchSave();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-move-tgz-'));
  t.after(() => { for (const d of [repo, tmp]) fs.rmSync(d, { recursive: true, force: true }); });
  execFileSync('bash', ['-euo', 'pipefail', '-c', `REPO=${JSON.stringify(repo)}; TMP=${JSON.stringify(tmp)}\n${lines[0]}`]);
  const list = execFileSync('tar', ['-tzf', path.join(tmp, 'data.tgz')], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const kept of ['data/farm.json', 'data/harness/mods/active.json', 'data/harness/consent.json', 'data/harness/jobs/0123456789abcdef/job.json',
    'data/harness-host/install.json', 'data/farms/abcdefabcdef/harness/mods/active.json']) assert.ok(list.includes(kept), `kept: ${kept}`);
  const signIns = list.filter((p) => /(^|\/)harness\/users(\/|$)/.test(p));
  assert.deepEqual(signIns, [], 'no farmer\'s sign-in folder goes to the box');
  // the operator is told that the farmers sign in to the helper again on the box
  assert.match(text, /echo[^\n]*signs? in[^\n]*again/i);
});
