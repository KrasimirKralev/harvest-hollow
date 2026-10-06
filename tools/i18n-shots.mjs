// Bulgarian screenshots (i18n lane A): the loading screen's language picker (before any module has loaded), the farmer
// picker, the HUD, Settings and the multi-farm landing page, in Bulgarian, on a desktop window and on an emulated
// iPhone 13. Starts its own server (temp data dir, HH_DEV=1) on --port; ONE headless browser, closed at the end.
//
//   node tools/i18n-shots.mjs --port 4002 [--out docs/qa/i18n] [--lang bg] [--only desktop|phone]
// Prints one JSON line { ok, errors, missing (Bulgarian keys that fell back to English), overflow, files }.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { KnownDevices } from 'puppeteer-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const port = Number(args.port || 4002);
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
const out = path.resolve(ROOT, args.out || 'docs/qa/i18n');
const LANG = args.lang === 'en' ? 'en' : 'bg';
const noMulti = Boolean(args['no-multi']);
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const files = [];
const errors = [];
const missing = new Set();
const overflow = [];

function serve(mode) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-i18n-'));
  const env = { ...process.env, PORT: String(port), HH_DATA_DIR: dataDir, HH_DEV: '1' };
  if (mode === 'multi') env.HH_MODE = 'multi';
  const proc = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  return { proc, ready: async () => { for (let i = 0; i < 100 && !log.includes('running at'); i++) await sleep(100); if (!log.includes('running at')) throw new Error(`server: ${log}`); } };
}

/** Text that runs out of its box (scrollWidth past the client width, or clipped by an ancestor) in the HUD and panels. */
async function audit(page, tag) {
  const bad = await page.evaluate(() => {
    const out = [];
    const sel = '#hud button, #hud .lbl, #hud .tag, #hud .name, #hud .num, .hh-panel .hh-tab, .hh-panel-title-text, .seg button, .dock-btn .lbl, .dock-mini .lbl, .tool .name, .lang-opt, .boot-line, .slot-sub';
    for (const el of document.querySelectorAll(sel)) {
      if (!el.offsetParent || el.closest('[hidden]')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const over = el.scrollWidth - el.clientWidth;
      if (over > 2 && cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis') out.push({ text: el.textContent.trim().slice(0, 40), over });
    }
    // dock mini labels that overlap their neighbours
    const lbls = [...document.querySelectorAll('.dock-minis .dock-mini .lbl')].filter((l) => l.offsetParent).map((l) => l.getBoundingClientRect());
    for (let i = 1; i < lbls.length; i++) if (lbls[i].left < lbls[i - 1].right - 1 && Math.abs(lbls[i].top - lbls[i - 1].top) < 4) out.push({ text: 'dock-mini labels overlap', over: Math.round(lbls[i - 1].right - lbls[i].left) });
    return out;
  });
  for (const b of bad) overflow.push(`${tag}: ${JSON.stringify(b)}`);
}

async function shot(page, name) {
  const f = path.join(out, `${name}.png`);
  await page.screenshot({ path: f });
  files.push(path.relative(ROOT, f));
}

async function collectMissing(page) {
  try {
    const m = await page.evaluate(async () => (await import('/js/i18n/core.js')).missingKeys());
    for (const k of m) missing.add(k);
  } catch { /* the page has no i18n module */ }
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1400,850'],
});
let srv = null;
try {
  srv = serve('single');
  await srv.ready();
  const devices = args.only === 'phone' ? ['phone'] : args.only === 'desktop' ? ['desktop'] : ['desktop', 'phone'];
  for (const dev of devices) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${dev} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${dev} console: ${m.text()}`); });
    if (dev === 'phone') await page.emulate(KnownDevices['iPhone 13']);
    else await page.setViewport({ width: 1400, height: 850 });
    const base = `http://localhost:${port}`;
    // 1. the loading screen, held before main.js runs: the inline picker works on its own
    await page.setRequestInterception(true);
    let hold = true;
    page.on('request', async (req) => {
      if (hold && /\/js\/main\.js/.test(req.url())) { while (hold) await sleep(100); }
      req.continue().catch(() => {});
    });
    // a module script delays DOMContentLoaded: wait only for the document itself, then picture the held loading screen
    page.goto(`${base}/`, { waitUntil: 'load', timeout: 120000 }).catch(() => {});
    await page.waitForSelector('#boot .lang-opt', { timeout: 30000 });
    await sleep(1500);
    await page.evaluate((l) => document.querySelector(`#boot .lang-opt[data-lang="${l}"]`)?.click(), LANG);
    await sleep(500);
    await shot(page, `${dev}-1-loading-${LANG}`);
    hold = false;
    // 2. the farmer picker (no slot claimed yet)
    await page.waitForFunction(() => !document.getElementById('slot-picker').hidden, { timeout: 60000 });
    await sleep(1500);
    await shot(page, `${dev}-2-picker-${LANG}`);
    await audit(page, `${dev} picker`);
    // 3. the HUD (claim a farmer by URL; the language stays remembered)
    await page.setRequestInterception(false);
    await page.goto(`${base}/?slot=${dev === 'phone' ? 'p2' : 'p1'}&name=${encodeURIComponent(dev === 'phone' ? 'Деси' : 'Краси')}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__hh && window.__hh.state && window.__hh.controller, { timeout: 60000 });
    await sleep(3500);
    await shot(page, `${dev}-3-hud-${LANG}`);
    await audit(page, `${dev} hud`);
    // 4. Settings, first tab (the language row) and Controls
    await page.evaluate(() => window.__hh.ui.panels.open('settings'));
    await sleep(900);
    await shot(page, `${dev}-4-settings-${LANG}`);
    await audit(page, `${dev} settings`);
    await page.evaluate(() => window.__hh.ui.panels.open('settings', { tab: 'keys' }));
    await sleep(700);
    await shot(page, `${dev}-5-settings-keys-${LANG}`);
    // 5. switch to English mid-game and back: the shell re-draws at once
    await page.evaluate(() => window.__hh.ui.panels.open('settings', { tab: 'look' }));
    await sleep(500);
    await page.evaluate(async () => { document.querySelector('.set-lang button[data-lang="en"]')?.click(); });
    await sleep(900);
    await shot(page, `${dev}-6-switched-en`);
    await page.evaluate(async () => { document.querySelector('.set-lang button[data-lang="bg"]')?.click(); });
    await sleep(900);
    await page.evaluate(() => window.__hh.ui.panels.closeAll());
    // 6. the seed tray and the build tray on the toolbar
    await page.evaluate(() => { window.__hh.ui.openSeeds(true); });
    await sleep(700);
    await shot(page, `${dev}-7-seeds-${LANG}`);
    await audit(page, `${dev} seeds`);
    if (dev === 'phone') {
      await page.evaluate(() => window.__hh.ui.openSeeds(false));
      await page.evaluate(() => window.__hh.ui.panels.open('menu'));
      await sleep(800);
      await shot(page, `${dev}-8-menu-${LANG}`);
      await audit(page, `${dev} menu`);
    }
    await collectMissing(page);
    await ctx.close();
  }
  srv.proc.kill();
  await sleep(500);
  // 7. the multi-farm landing page and a farm gate
  if (args.only !== 'phone' && !noMulti) {
    srv = serve('multi');
    await srv.ready();
    // a real farm this browser has no key for: the private-farm gate
    const made = await fetch(`http://localhost:${port}/api/farms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.json()).catch(() => ({}));
    for (const dev of ['desktop', 'phone']) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${dev} landing pageerror: ${e.message}`));
      if (dev === 'phone') await page.emulate(KnownDevices['iPhone 13']);
      else await page.setViewport({ width: 1400, height: 850 });
      await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
      await page.evaluate((l) => localStorage.setItem('hh.lang', l), LANG);
      await page.reload({ waitUntil: 'networkidle0' });
      await sleep(800);
      await shot(page, `${dev}-9-landing-${LANG}`);
      await page.goto(`http://localhost:${port}/f/${made.id ?? 'abcdefghijklmnop'}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#farm-gate', { timeout: 30000 }).catch(() => {});
      await sleep(1200);
      await shot(page, `${dev}-10-gate-${LANG}`);
      await ctx.close();
    }
  }
  console.log(JSON.stringify({ ok: errors.length === 0, errors, missing: [...missing], overflow, files }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err && err.stack || err), errors, files }));
} finally {
  await browser.close().catch(() => {});
  srv?.proc.kill();
}
