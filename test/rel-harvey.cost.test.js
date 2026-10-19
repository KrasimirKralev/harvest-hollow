// Release 1.0, H7 (harvey#13, should): what a job costs the farmer's plan. The agent's work folder for a level-21 farm
// stays within 82 KB (HEAD: 96-99 KB, pretty-printed catalogs and every crop's and recipe's good listed twice); the
// catalog is one entry a line; ChatGPT's default model comes from a preference list of known tool-capable models (not
// the first one the API lists), and the models route says which one "Recommended" is.
// RED on fdafb9c: the folder was 96.4 KB on this machine (.scratch/rb-harvey/gen/ws-size.mjs), the default `[0]`.
// The budget was 70 KB (69.1 KB used) until 2026-10-19; it is 82 KB since the owner's request "Harvey keeps the game's
// rules": docs/game-mechanics.md (4.6 KB) and the glossary's "Currencies and progression" and "Core verbs" tables
// (6.0 KB, a live run wrote "продан" for "продажба") joined the folder: 79.5 KB, still well under HEAD's 96-99 KB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { buildWorkspace } from '../server/agent/workspace.js';
import { buildCatalog } from '../server/mods/catalog.js';
import { bgNamesTable, musicTracks } from '../server/mods/index.js';
import { defaultModel } from '../server/agent/providers/chatgpt.js';
import { tmpRoot } from './helpers/agent-harness.js';

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('H7: the work folder of a level-21 farm is at most 82 KB', async () => {
  const work = path.join(tmpRoot('rh-h7'), 'work');
  const catalog = buildCatalog({ bgNames: await bgNamesTable(ROOT), tracks: musicTracks(ROOT), level: 21 });
  await buildWorkspace({ workDir: work, prompts: [{ text: 'Add a moon melon and a melon pie' }], lang: 'bg', catalog, modFiles: null, seed: true, level: 21 });
  const bytes = walk(work).reduce((a, f) => a + fs.statSync(f).size, 0);
  assert.ok(bytes <= 82 * 1024, `${(bytes / 1024).toFixed(1)} KB`);
  // a crop's or a recipe's own good is listed once, where it is made
  const ids = (f) => JSON.parse(fs.readFileSync(path.join(work, 'docs', 'catalog', f), 'utf8')).map((x) => x.id);
  const own = new Set([...ids('crops.json'), ...ids('recipes.json')]);
  assert.deepEqual(ids('items.json').filter((id) => own.has(id)), []);
  assert.ok(ids('items.json').includes('egg'), 'the other goods stay');
});

test('H7: ChatGPT\'s default model is a known tool-capable one, the full model before its mini; else the first listed', () => {
  const L = (...ids) => ids.map((id) => ({ id, label: id }));
  assert.equal(defaultModel(L('o3', 'gpt-5.5-mini', 'gpt-5.5', 'gpt-6.1-sol')).id, 'gpt-6.1-sol');
  assert.equal(defaultModel(L('gpt-6-mini', 'gpt-6')).id, 'gpt-6');
  assert.equal(defaultModel(L('o3', 'gpt-5.5-mini')).id, 'gpt-5.5-mini');
  assert.equal(defaultModel(L('something-new', 'other')).id, 'something-new');
  assert.equal(defaultModel([]), null);
});
