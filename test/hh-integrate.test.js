// Lead integration of the in-game helper (Harness Hollow, 2026-10-13): the cross-lane patches and the owner's switches.
// Each test was red before its change (.scratch/hh-integrate/red/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../server/config.js';
import { helperOn } from '../server/agent/config.js';
import { createProvider as createClaude } from '../server/agent/providers/claude.js';
import { createProvider as createChatgpt } from '../server/agent/providers/chatgpt.js';
import { cloneTables, CONTENT_HASH, cropOf } from '../shared/content/index.js';
import { RULES_VERSION } from '../shared/rules/version.js';
import { compileMod } from '../shared/mod/compile.js';
import { suspended } from '../shared/mod/apply.js';
import { installOverlay } from '../shared/mod/install.js';
import { moonlight } from '../shared/mod/examples.js';
import { skyAt } from '../public/js/render/daynight.js';
import { applyLook } from '../public/js/mod/look.js';
import { seedRows } from '../public/js/ui/toolbar.js';
import { makeFarm } from './helpers.js';
import { xpForLevel } from '../shared/content/index.js';

const quiet = { info() {}, warn() {}, error() {} };

test('HH_HELPER: on in single mode, OFF on the multi host until the owner turns it on; HH_HARNESS still works', () => {
  assert.equal(helperOn({}), true, 'single mode: the players\' own server');
  assert.equal(helperOn({ HH_MODE: 'multi' }), false, 'the public host waits for the owner');
  assert.equal(helperOn({ HH_MODE: 'multi', HH_HELPER: 'on' }), true);
  assert.equal(helperOn({ HH_HELPER: 'off' }), false);
  assert.equal(helperOn({ HH_HARNESS: 'off' }), false, 'the older name keeps working');
  assert.equal(helperOn({ HH_HARNESS: 'off', HH_HELPER: 'on' }), true, 'HH_HELPER wins');
  assert.equal(loadConfig({}).harness.enabled, true);
  assert.equal(loadConfig({ HH_MODE: 'multi' }).harness.enabled, false);
  assert.equal(loadConfig({ HH_MODE: 'multi', HH_HELPER: 'on' }).harness.enabled, true);
  assert.throws(() => loadConfig({ HH_HELPER: 'yes' }), ConfigError, 'a typo refuses the boot');
  assert.throws(() => loadConfig({ HH_HELPER_CLAUDE: 'maybe' }), ConfigError);
});

test('HH_HELPER_CLAUDE / HH_HELPER_CHATGPT=off: the provider is listed as unavailable (OFF), never run', async () => {
  const cfg = loadConfig({ HH_HELPER_CLAUDE: 'off', HH_HELPER_CHATGPT: 'off' }).harness.agent;
  assert.equal(cfg.claudeOn, false);
  assert.equal(cfg.chatgptOn, false);
  const claude = createClaude({ cfg: { ...cfg, claudeBin: '/bin/true' }, log: quiet, hostDir: '/nonexistent' });
  const chatgpt = createChatgpt({ cfg, log: quiet, hostDir: '/nonexistent', fetch: async () => { throw new Error('no call'); } });
  assert.deepEqual(await claude.available(), { ok: false, reason: 'OFF' });
  assert.deepEqual(await chatgpt.available(), { ok: false, reason: 'OFF' });
  const on = loadConfig({}).harness.agent;
  assert.equal(on.claudeOn, true);
  assert.equal(on.chatgptOn, true);
});

test('a mod\'s sky preset reaches the renderer: skyAt() goes through skyFilter (render/daynight.js hook)', (t) => {
  t.after(() => applyLook(null));
  const at = Date.UTC(2026, 9, 13, 12, 0, 0);
  const plain = skyAt(at);
  applyLook({ sky: 'stormy' });
  const stormy = skyAt(at);
  assert.notDeepEqual(stormy.top, plain.top, 'the stormy preset greys the sky');
  assert.deepEqual(stormy.sunDir, plain.sunDir, 'only the colours change');
  applyLook(null);
  assert.deepEqual(skyAt(at), plain, 'no mod: the game\'s own sky');
});

test('a retired helper crop (an undo) leaves the seed tray: it is not for sale, the base crops stay', (t) => {
  t.after(() => installOverlay(null));
  const base = { tables: cloneTables(), hash: CONTENT_HASH, rules: RULES_VERSION };
  const overlay = compileMod(base, moonlight(), { n: 1 }).overlay;
  const s = makeFarm();
  s.farm.xp = xpForLevel(16);
  installOverlay(overlay);
  assert.ok(seedRows(s).some((r) => r.id === 'x_moon_melon' && r.open), 'applied: the new seed is offered');
  installOverlay(suspended(overlay));
  assert.ok(cropOf('x_moon_melon')?.retired, 'the crop is still known (the farm may have it in the ground)');
  assert.ok(!seedRows(s).some((r) => r.id === 'x_moon_melon'), 'retired: not offered');
  assert.ok(seedRows(s).some((r) => r.id === 'wheat'));
});

test('consent.sending is the SERVER\'s ability to share, not the farmer\'s answer: the first request asks the question', async () => {
  const { telemetryFor } = await import('./helpers/telemetry.js');
  const { t, cleanup } = telemetryFor('hh-int-sending', { env: { HH_TELEMETRY_URL: 'http://127.0.0.1:9/api/telemetry' } });
  try {
    // the ui asks before the first request only when { telemetry: null, sending: true } (ui/harness/index.js ask())
    assert.deepEqual(t.consent('local', 'p1'), { telemetry: null, at: null, sending: true, install: null }, 'never asked: ask');
    const no = await t.setConsent('local', 'p1', false);
    assert.equal(no.sending, true, 'a farmer\'s "no" is not "sharing is off on this server" (Settings › Helper)');
  } finally { await cleanup(); }
  const off = telemetryFor('hh-int-sending-off', { env: { HH_TELEMETRY: 'off' } });
  try {
    assert.equal(off.t.consent('local', 'p1').sending, false, 'the operator turned sharing off: nothing to ask');
  } finally { await off.cleanup(); }
});

test('the "helper added" toast names new things in lower case inside a Bulgarian sentence; English keeps Title Case', async () => {
  const { appliedLine } = await import('../public/js/ui/harness/model.js');
  const msg = { by: 'p1', n: 2, names: [{ id: 'x_moon_melon', en: 'Moon Melon', bg: 'Лунен пъпеш' }, { id: 'x_melon_pie', en: 'Melon Pie', bg: 'Пай с пъпеш' }] };
  const players = { p1: { name: 'Rowan' }, p2: { name: 'Mia' } };
  assert.deepEqual(appliedLine(msg, 'p2', players, 'bg').params.things, ['лунен пъпеш', 'пай с пъпеш']);
  assert.deepEqual(appliedLine(msg, 'p2', players, 'en').params.things, ['Moon Melon', 'Melon Pie']);
});

test('the game boots without the helper\'s ui: no stylesheet link, no words area, no module until the server offers it', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('harness.css'), 'index.html does not link the helper\'s stylesheet');
  const { AREAS, LAZY_AREAS } = await import('../public/js/i18n/catalogs.js');
  assert.ok(!AREAS.some(([a]) => a === 'harness') && LAZY_AREAS.some(([a]) => a === 'harness'));
  const ui = fs.readFileSync(new URL('../public/js/ui/index.js', import.meta.url), 'utf8');
  assert.ok(!/from '\.\/harness\/index\.js'/.test(ui), 'ui/index.js imports only the small boot module');
  // a server that says "off": one question, no ui
  const bus = await import('../public/js/harness/bus.js');
  const { bootHarness } = await import('../public/js/ui/harness/boot.js');
  const asked = [];
  let ready = 0;
  const stop = bootHarness({ store: { pid: 'p1', on: () => () => {} } }, () => { ready++; },
    { doc: null, fetcher: async (url, o) => { asked.push([url, o.headers.Authorization]); return { ok: true, json: async () => ({ enabled: false }) }; } });
  bus.setHarnessAuth({ pid: 'p1', token: 'k'.repeat(32) });
  await new Promise((r) => setTimeout(r, 20));
  stop();
  bus.setHarnessAuth(null);
  assert.deepEqual(asked, [['/api/harness/state', `Bearer ${'k'.repeat(32)}`]]);
  assert.equal(ready, 0);
});
