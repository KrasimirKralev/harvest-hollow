// QA round 4 (release 1.0), infra's items: docs/qa/release/qa-r4/fix-infra.md. Each test failed on the tree QA tested
// (289b672) before its fix; the RED lines are in that file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanName, cleanText, LIMITS } from '../shared/net/protocol.js';
import { ROOT } from './helpers.js';

const events = [];
globalThis.CustomEvent ??= class CustomEvent { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } };
globalThis.dispatchEvent = (e) => { events.push(e); return true; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

// ---- I4-01: a module loaded on demand that fails once is gone for the session ---------------------------------------
// The browser keeps a failed import() in its module map: the same URL rejects again without a request, so the "a later
// call retries" paths never came true. Every lazy import goes through net/lazy.js, which tells main.js; main.js reloads
// while the curtain is up and offers Reload after it.
const URL_ = 'http://127.0.0.1:4604/js/ui/panels/index.js';
const fails = (msg, Type = TypeError) => () => Promise.reject(new Type(msg));

test('I4-01: a failed module fetch (Chrome, Safari, Firefox wording) dispatches hh:assets-failed once and rethrows', async () => {
  const { lazyImport, importFailed } = await import('../public/js/net/lazy.js');
  for (const msg of [`Failed to fetch dynamically imported module: ${URL_}`, 'Importing a module script failed.',
    `error loading dynamically imported module: ${URL_}`]) {
    events.length = 0;
    const err = await quiet(() => lazyImport('panels', fails(msg)).then(() => null, (e) => e));
    assert.equal(err?.message, msg, 'the same rejection reaches the caller (its own catch keeps working)');
    assert.equal(importFailed(err), true);
    const heard = events.filter((e) => e.type === 'hh:assets-failed');
    assert.equal(heard.length, 1, `the page hears it once: ${msg}`);
    assert.equal(heard[0].detail.name, 'panels');
    assert.match(heard[0].detail.why, /module/);
  }
});

test('I4-01: an error the module threw while it ran is not a missing file: rethrown, no event (no reload loop)', async () => {
  const { lazyImport, importFailed } = await import('../public/js/net/lazy.js');
  events.length = 0;
  for (const load of [fails('Unexpected token \'}\'', SyntaxError), fails('t is not defined', ReferenceError),
    () => { throw new Error('install failed'); }, fails('Failed to fetch')]) {
    const err = await lazyImport('x', load).then(() => null, (e) => e);
    assert.ok(err, 'rethrown');
    assert.equal(importFailed(err), false, err.message);
  }
  assert.equal(events.length, 0);
  const mod = { panels: true };
  assert.equal(await lazyImport('ok', () => Promise.resolve(mod)), mod, 'a module that loads passes straight through');
  assert.equal(events.length, 0);
});

test('I4-01: recoverPlan reloads only while the curtain is up, at most twice in 5 minutes', async () => {
  const { recoverPlan } = await import('../public/js/net/lazy.js');
  const now = 1_000_000;
  assert.equal(recoverPlan({ lifted: false, recent: [], now }), 'reload', 'curtain up: nothing to lose');
  assert.equal(recoverPlan({ lifted: true, recent: [], now }), 'notice', 'the farm is shown: the player decides');
  assert.equal(recoverPlan({ lifted: false, recent: [now - 60_000], now }), 'reload', 'a second try');
  assert.equal(recoverPlan({ lifted: false, recent: [now - 60_000, now - 30_000], now }), 'notice', 'no third: a file really gone');
  assert.equal(recoverPlan({ lifted: false, recent: [now - 400_000, now - 301_000], now }), 'reload', 'old reloads expire');
});

test('I4-01: main.js recovers on every path, not only on option 2\'s host path', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  const lines = src.split('\n');
  const at = (re) => lines.findIndex((l) => re.test(l));
  const listener = at(/addEventListener\('hh:assets-failed'/);
  assert.ok(listener >= 0, 'main.js listens for hh:assets-failed');
  assert.match(lines[listener], /^addEventListener/, 'at the top level: HEAD had it inside `if (ASSET_BASE)`, never armed on 1.0');
  assert.match(lines[at(/addEventListener\('unhandledrejection'/)], /^addEventListener/, 'an uncaught failed import counts too');
  const body = src.slice(src.indexOf("addEventListener('hh:assets-failed'"));
  assert.match(body, /recoverPlan\(/, 'reload or notice by the curtain and the per-tab budget');
  assert.match(body.slice(0, body.indexOf('assetsFailedNotice();\n});')), /await untilReachable\(\)/,
    'never reload into a dead link (the browser\'s offline page)');
  assert.match(src, /watchUnsaved\(reloadPage\)/, 'the CL-02 settle keeps unsent moves');
  assert.match(src, /boot\.assets\.retry[\s\S]{0,200}urgent: true/, 'the notice is not held behind a phone sheet');
});

test('I4-01: the self path has its own words (not "from your farm"), EN and BG', async () => {
  const en = (await import('../public/js/i18n/en/boot.js')).default;
  const bg = (await import('../public/js/i18n/bg/boot.js')).default;
  assert.ok(en['boot.assets.retry'] && !/from your farm/.test(en['boot.assets.retry']));
  assert.ok(bg['boot.assets.retry'] && !/фермата/.test(bg['boot.assets.retry']));
});

// ---- L4-09 (life-feel's patch for infra): a name cut inside an emoji drew half a family -----------------------------
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
test('L4-09: cleanName ends on a whole emoji picture, a whole tone and a whole flag', () => {
  assert.equal(cleanName(FAMILY.repeat(4)), FAMILY, 'one whole family (11 units), not 16 units ending in "👨‍👩"');
  const thumb = '\u{1F44D}\u{1F3FD}';
  assert.equal(cleanName(`ab${thumb}`.repeat(4)), `ab${thumb}ab${thumb}ab`, 'no thumb without its tone');
  const rainbow = '\u{1F3F3}️‍\u{1F308}';
  assert.equal(cleanName(rainbow.repeat(3)), rainbow.repeat(2), 'no trailing joiner');
  assert.equal(cleanName(`abcdefghijklm${FAMILY}`), 'abcdefghijklm', 'a cut right after a joiner drops the open picture');
  const bg = '\u{1F1E7}\u{1F1EC}';
  assert.equal(cleanName(`Rosa ${bg.repeat(3)}`), `Rosa ${bg.repeat(2)}`, 'no half flag');
  const heart = '❤️';
  assert.equal(cleanName(heart.repeat(10)), heart.repeat(8), 'a cut between two whole pictures keeps both');
  assert.equal(cleanName('abcdefghijklmno\u{1F600}x'), 'abcdefghijklmno', 'never half a surrogate pair');
  for (const s of ['ابجدهوزحطيكلمنسعف', 'abcdefghijklmnopqrst', 'Здравейте всички тук']) {
    assert.equal(cleanName(s), s.slice(0, LIMITS.NAME_MAX).trim(), `plain letters cut as before: ${s}`);
  }
  const line = `${'x'.repeat(LIMITS.CHAT_MAX - 3)}${FAMILY}`;
  assert.equal(cleanText(line, LIMITS.CHAT_MAX, ' '), 'x'.repeat(LIMITS.CHAT_MAX - 3), 'a chat line too');
});

// ---- harvey's report (fix-harvey.md, QA r4): a modded farm's worker hashed the build itself ---------------------------
// A file saved between the host's start and the farm's first mod gave the worker's welcome another buildHash than the
// page's, and the content gate reloaded every page of the farm (e2e-harness --multi, step 32). The worker now carries
// the host's hash: the one the host's pages were served with.
test('the modded farm\'s worker welcomes with the host\'s build hash, not its own', async () => {
  const { tmpDataDir } = await import('./helpers/server.js');
  const { loadConfig, multiConfig } = await import('../server/config.js');
  const { startServer } = await import('../server/index.js');
  const { PROTOCOL_VERSION, MSG, CLOSE } = await import('../shared/net/protocol.js');
  const { moonlight } = await import('../shared/mod/examples.js');
  const { WebSocket } = await import('ws');
  const cfg = { ...loadConfig({}), mode: 'multi', multi: { ...multiConfig({}) }, port: 0, host: '127.0.0.1',
    dataDir: tmpDataDir('hh-r4-worker'), quiet: true, dev: true, awayGraceMs: 0 };
  const s = await startServer(cfg);
  const base = `http://127.0.0.1:${s.port}`;
  const open = async (id) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?farm=${id}`);
    const msgs = [];
    ws.on('message', (raw) => { const m = JSON.parse(String(raw)); msgs.push(...(m.t === 'b' ? m.list : [m])); });
    const closed = new Promise((r) => ws.on('close', (code) => r(code)));
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    const next = async (pred) => { for (let i = 0; i < 160; i++) { const m = msgs.find(pred); if (m) return m; await sleep(50); } throw new Error('timeout'); };
    return { ws, closed, next, send: (m) => ws.send(JSON.stringify(m)) };
  };
  try {
    const hostBuild = 'feedfacefeedface';
    s.hh.static.build = hostBuild;         // the files changed after the host hashed them: its pages carry this hash
    const { id, secret } = await (await fetch(`${base}/api/farms`, { method: 'POST' })).json();
    const c = await open(id);
    c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'cidr4wk1', token: secret });
    await c.next((m) => m.t === MSG.SLOTS);
    c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'cidr4wk1', token: secret, claim: { slot: 'p1', name: 'Mira' } });
    assert.equal((await c.next((m) => m.t === MSG.WELCOME)).buildHash, hostBuild, 'the farm in the host process');
    const files = moonlight();
    files['content/crops/x_moon_melon.json'].unlock = 1;
    delete files['content/recipes/x_melon_pie.json'];
    const mods = s.hh.harness.ctx.mods;
    const staged = await mods.stage(id, files, { by: 'p1', prompt: 'a moon melon' });
    await mods.apply(id, staged.candidate, { by: 'p1' });
    assert.equal(await c.closed, CLOSE.MOD_RELOAD);
    assert.equal(s.hh.reg.rec(id).host.kind, 'worker');
    const c2 = await open(id);
    c2.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'cidr4wk1', token: secret });
    const w = await c2.next((m) => m.t === MSG.WELCOME);
    assert.equal(w.buildHash, hostBuild, 'the worker\'s welcome: the page\'s build, no reload of every page');
    c2.ws.close();
  } finally {
    await s.close();
  }
});
