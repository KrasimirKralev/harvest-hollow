// HUD audit (release 1.0, ui-shell; from the ux-first audit's hudarea.js + gearcheck.js): how much of the screen the HUD
// covers, how many buttons it shows, and whether the controls that must always answer a click really get it.
//
// For each farm (a fresh L1 farm, a copy of the owners' save, the L32 e2e save) and each screen (1280x720, 1366x768,
// 1536x864, 1920x1080, iPhone 13 portrait with its notch and home-bar insets, 'Small 360' 360x640 DPR 3), one page:
//   coverage    the union of the visible HUD regions, in % of the screen (4 px grid; toasts and banners left out: they
//               come and go)
//   buttons     visible buttons inside #hud (a button scrolled off a strip still counts: it is on the HUD)
//   dock        big dock buttons and small ones (minis / the Farm book's places when they show on the HUD)
//   hits        elementFromPoint at the centre of #hud-more (Settings) and of every dock button: the button itself must
//               be what a click there reaches
//   stack       the bottom-centre stack (#tray-wrap: coach card, tips, seed strip, toolbar) height in CSS px
//   rightHits   elementFromPoint at the centre of Harvey's caption and of the turn button (QA r3 S3-05: on phones the
//               coach card covered them); on phones also with an action line up (rightLift) and the tool pop-up open
//               (rightPop) (QA r4 S4-03)
// The bars (release-scope S1, S5, M3): fresh L1 at 1366x768 <= 15 buttons and <= 14 %; the owners' and the L32 farm at
// 1366x768 <= 22 buttons and <= 16 %; #hud-more hit at its centre at the four desktop sizes on every farm; the stack
// <= 170 px on the fresh farm after its first plant at 1366x768. Prints one JSON line and exits 1 when a bar fails.
//
//   node tools/hud-audit.mjs --port 4471 [--root <tree>] [--farms fresh,owners,l32] [--sizes desktop|phone|all]
//        [--owners <save dir>] [--l32 <farm.json>] [--lang en|bg] [--out <file.json>] [--shots <dir>] [--slow N]
// --root runs the server of another tree (the HEAD baseline: .scratch/release/head). Scratch files go to TMPDIR.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer, { KnownDevices } from 'puppeteer-core';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../shared/net/protocol.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

/** The screens: desktops with a mouse, the iPhone 13 (Puppeteer's profile + its insets) and the smallest phone. */
export const SCREENS = {
  '1280x720': { viewport: { width: 1280, height: 720, deviceScaleFactor: 1 }, desktop: true },
  '1366x768': { viewport: { width: 1366, height: 768, deviceScaleFactor: 1 }, desktop: true },
  '1536x864': { viewport: { width: 1536, height: 864, deviceScaleFactor: 1 }, desktop: true },
  '1920x1080': { viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 }, desktop: true },
  'iPhone 13': { ...KnownDevices['iPhone 13'], safe: { top: 47, bottom: 34, left: 0, right: 0 } },
  'Small 360': { userAgent: ANDROID_UA, viewport: { width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false },
    safe: { top: 0, bottom: 0, left: 0, right: 0 } },
};

export function parseArgs(argv) {
  return Object.fromEntries(argv.reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []));
}

// ---- server ------------------------------------------------------------------------------------------------------------
/** One HH_DEV server on `port` over `dataDir`, from `root` (this tree, or the HEAD tree for a baseline). */
export function startServer({ port, dataDir, root = ROOT, env = {} }) {
  if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are the real services');
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: root, env: { ...process.env, PORT: String(port), HH_DATA_DIR: dataDir, HH_DEV: '1', HH_TZ: 'Europe/Sofia', HH_HARNESS_MOCK: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  return {
    proc,
    get log() { return log; },
    async ready() {
      for (let i = 0; i < 300 && !log.includes('running at') && proc.exitCode === null; i++) await sleep(100);
      if (!log.includes('running at')) throw new Error(`server did not start: ${log.slice(-800)}`);
    },
    async stop() {
      if (proc.exitCode !== null) return;
      proc.kill('SIGTERM');
      await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(5000)]);
    },
  };
}

/** A data dir holding a copy of a save directory (farm.json, journals) or of one farm.json. */
export function farmDir(tmp, name, { saveDir = null, farmJson = null } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, `${name}-`));
  if (saveDir) {
    for (const f of ['farm.json', 'farm.journal.jsonl', 'farm.journal.archive.jsonl']) {
      if (fs.existsSync(path.join(saveDir, f))) fs.copyFileSync(path.join(saveDir, f), path.join(dir, f));
    }
  }
  if (farmJson) fs.copyFileSync(farmJson, path.join(dir, 'farm.json'));
  return dir;
}

/** The names on a save, by slot (read from the copy: no owner name is ever written into a tool). */
export function slotNames(dataDir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dataDir, 'farm.json'), 'utf8')).state;
    return Object.fromEntries(Object.entries(s.players).map(([pid, p]) => [pid, p.name]));
  } catch { return {}; }
}

/** A fresh token for a claimed slot of a copied save ("this is me on a new device"). */
export function reclaim(port, slot, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const cid = `ha${slot}${Math.floor(Math.random() * 1e4)}`.slice(0, 8);
    const t = setTimeout(() => { ws.close(); reject(new Error('reclaim timeout')); }, 20_000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', proto: PROTOCOL_VERSION, cid, claim: { slot, name, reclaim: true } })));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === 'welcome' && m.token) { clearTimeout(t); ws.close(); resolve(m.token); }
      else if (m.t === 'deny') { clearTimeout(t); ws.close(); reject(new Error(`reclaim denied: ${m.code}`)); }
    });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

// ---- browser -----------------------------------------------------------------------------------------------------------
export function launch() {
  return puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
    protocolTimeout: 240_000,
  });
}

/**
 * A page on `screen` in `lang`, logged in as `slot` with `token` (or a fresh claim by `name` when there is no token).
 * Collects console errors and page errors into `errors`. The iPhone gets its notch and home bar through CDP.
 */
export async function openPage(browser, { screen, lang = 'en', token = null, slot = 'p1', errors = [], seed = null }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const d = SCREENS[screen];
  if (!d) throw new Error(`unknown screen "${screen}"`);
  if (d.userAgent) await page.emulate({ userAgent: d.userAgent, viewport: d.viewport });
  else await page.setViewport(d.viewport);
  page.setDefaultTimeout(180_000);
  const cdp = await page.createCDPSession();
  page.__cdp = cdp;
  if (d.safe) {
    try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: d.safe }); } catch { /* an older Chrome: the insets stay 0 */ }
  }
  await page.evaluateOnNewDocument((tok, p, l, extra) => {
    try {
      if (tok) localStorage.setItem('hh.tokens', JSON.stringify({ [p]: tok }));
      localStorage.setItem('hh.lang', l);
      if (extra) for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
    } catch { /* storage blocked */ }
  }, token, slot, lang, seed);
  page.on('pageerror', (e) => errors.push(`${screen}/${lang} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${screen}/${lang} console: ${m.text().slice(0, 240)}`); });
  page.screenName = screen;
  return page;
}

/** Load the farm and wait for the HUD: the state, the panels registered, the dock drawn, the curtain gone. */
export async function loadFarm(page, port, { slot = 'p1', name = null, slow = 1 } = {}) {
  const q = name ? `?slot=${slot}&name=${encodeURIComponent(name)}&quality=low` : `?slot=${slot}&quality=low`;
  await page.goto(`http://localhost:${port}/${q}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__hh && window.__hh.state && window.__hh.pid && window.__hh.ui?.panels?.has?.('market'),
    { timeout: 180_000 * slow, polling: 200 });
  // the boot curtain lifts (1.0: on view.ready, capped) and the HUD staggers in
  await page.waitForFunction(() => document.getElementById('boot')?.hidden !== false || window.__hh?.playableAt,
    { timeout: 60_000 * slow, polling: 200 }).catch(() => {});
  await sleep(2500 * slow);
}

/** Close what the boot opened (the recap, the naming card, an open menu) so the farm view is what gets measured. */
export async function settle(page, slow = 1) {
  await page.evaluate(() => {
    window.__hh.ui.panels.closeAll();
    window.__hh.ui.openSeeds?.(false);
    document.activeElement?.blur?.();
  });
  await sleep(1200 * slow);
  // a hover card left by the page's last pointer position is not the HUD (and #tip is not measured): put it away
  await page.evaluate(() => { const t = document.getElementById('tip'); if (t) t.hidden = true; });
}

/**
 * The open Farm book (run in the page, `safeBottom`: the home bar's height): its visible entries (places, together
 * buttons, tiles; the stats row is one entry each) and whether the last one ends above the home bar without a scroll.
 */
export function measureBook(safeBottom = 0) {
  const book = document.querySelector('.farm-book');
  if (!book) return null;
  const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const items = [...book.querySelectorAll('.dock-mini, .social-btn, .m-tile, .m-stat')].filter(shown);
  let lastBottom = 0;
  for (const e of items) {
    const r = e.getBoundingClientRect();
    const plaque = e.querySelector('.lbl');
    const after = e.classList.contains('social-btn') ? 12 : 0;      // a together button's plaque is its ::after, 11 px below
    lastBottom = Math.max(lastBottom, Math.round(Math.max(r.bottom + after, plaque ? plaque.getBoundingClientRect().bottom : 0)));
  }
  const limit = innerHeight - safeBottom;
  return { entries: items.filter((e) => !e.classList.contains('m-stat')).length, stats: items.filter((e) => e.classList.contains('m-stat')).length,
    lastBottom, limit, oneScreen: lastBottom <= limit };
}

/** What the HUD covers and shows now (run in the page). */
export function measureHud() {
  const vw = innerWidth;
  const vh = innerHeight;
  const W = Math.ceil(vw / 4);
  const H = Math.ceil(vh / 4);
  const grid = new Uint8Array(W * H);
  const shown = (e) => {
    if (!e || e.closest('[hidden]') || !e.getClientRects().length) return false;
    const cs = getComputedStyle(e);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  // the ux-first audit's regions, plus the 1.0 shell's own (each region is a painted box, never a full-screen wrapper)
  const SELS = ['.hud-tl', '#tracker > *', '.hud-tr > *', '#hud-right > *', '.pc-meter', '#hud-beauty', '#feed li', '#social > *',
    '#toolbar', '.tool-more', '#m-menu-btn', '.seed-strip', '.spread-strip', '#seed-tray', '#build-tray', '#coach-slot > *', '.tray-tip',
    '#dock', '.dock-minis > *', '#stroke-chip', '.stroke-chip', '#hud-buffs > *', '.bench-chip', '.undo-chip', '.flyout', '[data-hud-audit]'];
  const parts = {};
  const seen = new Set();
  for (const s of SELS) {
    let a = 0;
    for (const e of document.querySelectorAll(s)) {
      if (seen.has(e) || !e.closest('#hud') || !shown(e)) continue;
      seen.add(e);
      const r = e.getBoundingClientRect();
      if (r.width * r.height > vw * vh * 0.6) continue;          // a wrapper, not a painted region
      const x0 = Math.max(0, Math.floor(r.left / 4)); const x1 = Math.min(W, Math.ceil(r.right / 4));
      const y0 = Math.max(0, Math.floor(r.top / 4)); const y1 = Math.min(H, Math.ceil(r.bottom / 4));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (!grid[y * W + x]) a++; grid[y * W + x] = 1; }
    }
    if (a) parts[s] = +((a * 16 / (vw * vh)) * 100).toFixed(1);
  }
  let n = 0;
  for (const v of grid) n += v;
  const btns = [...document.querySelectorAll('#hud button')].filter(shown);
  const label = (b) => (b.id ? `#${b.id}` : '') + (b.dataset.dock ? `[dock=${b.dataset.dock}]` : b.dataset.tool ? `[tool=${b.dataset.tool}]` : '')
    || (b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  const hitOf = (el) => {
    const r = el.getBoundingClientRect();
    const pts = [[r.left + r.width / 2, r.top + r.height / 2]];
    const hits = pts.map(([x, y]) => {
      const t = document.elementFromPoint(x, y);
      return Boolean(t && (t === el || el.contains(t)));
    });
    const t = document.elementFromPoint(pts[0][0], pts[0][1]);
    const by = t ? (t.closest('button')?.id || t.closest('button')?.dataset?.dock || t.id || t.tagName.toLowerCase()) : null;
    return { hit: hits.every(Boolean), at: [Math.round(pts[0][0]), Math.round(pts[0][1])], by };
  };
  const more = document.getElementById('hud-more');
  const dockBig = [...document.querySelectorAll('#dock button')].filter(shown);
  const dockMini = [...document.querySelectorAll('.dock-minis button')].filter((b) => shown(b) && b.closest('#hud'));
  const stackEls = [...document.querySelectorAll('#tray-wrap > *:not(#seed-tray):not(#build-tray):not(#m-menu-btn):not(.tool-more), #coach-slot > *')]
    .filter((e) => shown(e) && e.id !== 'coach-slot' && e.getBoundingClientRect().height > 0);
  let top = Infinity;
  let bottom = -Infinity;
  for (const e of stackEls) { const r = e.getBoundingClientRect(); top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); }
  return {
    vw, vh,
    coverage: +((n * 16 / (vw * vh)) * 100).toFixed(1),
    parts,
    buttons: btns.length,
    buttonList: btns.map(label),
    dock: { big: dockBig.length, mini: dockMini.length, names: [...dockBig, ...dockMini].map((b) => b.dataset.dock || label(b)) },
    hudMore: more && shown(more) ? hitOf(more) : { hit: false, missing: true },
    dockHits: [...dockBig, ...dockMini].map((b) => ({ name: b.dataset.dock || label(b), ...hitOf(b) })),
    // the right column on a phone: Harvey's caption and the turn button are what a tap at their centre reaches, never
    // Grandma's card (QA r3 S3-05, fbp#6: at 360 her card covered "Харви", on the iPhone 13 the turn button)
    rightHits: [['harvey', document.querySelector('#hx-dock .hx-btn-cap')], ['turn', document.getElementById('hud-turn')]]
      .filter(([, e]) => shown(e)).map(([name, e]) => ({ name, ...hitOf(e) })),
    stack: Number.isFinite(top) ? Math.round(bottom - top) : 0,
    level: Number(document.getElementById('hud-level')?.textContent || 0),
  };
}

/** The screen point of a farm tile's centre where a click reaches the canvas (null when the HUD covers it). */
export async function tilePoint(page, x, z) {
  return page.evaluate(([a, b]) => {
    const p = window.__hh.view.toScreen(a + 0.5, b + 0.5, 0.1);
    if (!p || p.visible === false) return null;
    for (const [dx, dy] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) {
      const el = document.elementFromPoint(p.x + dx, p.y + dy);
      if (el && el.id === 'world') return { x: Math.round(p.x + dx), y: Math.round(p.y + dy) };
    }
    return null;
  }, [x, z]);
}

/** Plant one plot the way a new player does: a click on an empty plot opens the seed picker, a click on Wheat plants. */
export async function firstPlant(page, slow = 1) {
  const plots = await page.evaluate(() => {
    const st = window.__hh.state;
    return Object.keys(st.farm.objects).sort().filter((k) => st.farm.objects[k].def === 'plot' && !st.farm.objects[k].crop)
      .map((id) => ({ id, x: st.farm.objects[id].x, z: st.farm.objects[id].z }));
  });
  for (const p of plots) {
    const at = await tilePoint(page, p.x, p.z);
    if (!at) continue;
    await page.mouse.click(at.x, at.y);
    await sleep(900 * slow);
    const seed = await page.evaluate(() => {
      const b = document.querySelector('.seed-pop:not([hidden]) .sp-seed[data-crop="wheat"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!seed) continue;
    await page.mouse.click(seed.x, seed.y);
    await sleep(1500 * slow);
    return page.evaluate((id) => Boolean(window.__hh.state.farm.objects[id].crop), p.id);
  }
  return false;
}

// ---- main ----------------------------------------------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port || 4471);
  const root = path.resolve(args.root || ROOT);
  const slow = Math.max(1, Number(args.slow || 1));
  const lang = args.lang === 'bg' ? 'bg' : 'en';
  const farms = String(args.farms || 'fresh,owners,l32').split(',');
  const which = String(args.sizes || 'all');
  const screens = Object.keys(SCREENS).filter((k) => which === 'all' || (which === 'desktop' ? SCREENS[k].desktop : which === 'phone' ? !SCREENS[k].desktop : k === which));
  const owners = path.resolve(args.owners || path.join(ROOT, '.scratch/box-save-1013'));
  const l32 = path.resolve(args.l32 || path.join(ROOT, '.scratch/rel-ux-first/e2e-snaps/019-xp2496059-v117.json'));
  const shots = args.shots ? path.resolve(args.shots) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-hud-audit-'));
  const errors = [];
  const results = [];
  const files = [];
  let browser = null;
  let srv = null;
  try {
    browser = await launch();
    for (const farm of farms) {
      if (!['fresh', 'owners', 'l32'].includes(farm)) throw new Error(`unknown farm "${farm}"`);
      let names = {};
      const tokens = {};
      const boot = async () => {
        const dataDir = farm === 'fresh' ? farmDir(tmp, 'fresh')
          : farm === 'owners' ? farmDir(tmp, 'owners', { saveDir: owners }) : farmDir(tmp, 'l32', { farmJson: l32 });
        names = slotNames(dataDir);
        srv = startServer({ port, dataDir, root });
        await srv.ready();
      };
      if (farm !== 'fresh') await boot();
      for (const screen of screens) {
        // every screen sees a brand-new farm's first frame: its own server and data
        if (farm === 'fresh') { await srv?.stop(); await boot(); }
        // the owners play desktop as farmer 2 and the phone as farmer 1; the e2e farm as farmer 1
        const slot = farm === 'owners' && SCREENS[screen].desktop ? 'p2' : 'p1';
        let page = null;
        try {
        // one reclaim per slot and farm: a slot whose page just closed may still count as online for a moment
        if (farm !== 'fresh' && !tokens[slot]) tokens[slot] = await reclaim(port, slot, names[slot] || 'Farmer');
        const token = farm === 'fresh' ? null : tokens[slot];
        page = await openPage(browser, { screen, lang, token, slot, errors });
        await loadFarm(page, port, { slot, name: farm === 'fresh' ? 'Ana' : null, slow });
        await settle(page, slow);
        const m = await page.evaluate(measureHud);
        const row = { farm, screen, lang, ...m };
        // a phone's right column in the two states that lift her card (QA r4 S4-03, fbp#1): an action line ("Planting
        // Wheat × 4") under her card, and the tool pop-up open
        if (!SCREENS[screen].desktop) {
          // the column follows her card through a ResizeObserver (tutorial.js --coach-up), which a loaded machine
          // delivers up to ~1 s late: wait for the new value (5 s at most) before measuring
          const up0 = await page.evaluate(() => document.body.style.getPropertyValue('--coach-up'));
          await page.evaluate(() => { const c = document.getElementById('stroke-chip'); c.textContent = 'Planting Wheat × 4'; c.hidden = false; }); // i18n-ok: a probe's stand-in line
          await page.waitForFunction((u) => !document.querySelector('#coach-slot .coach') || document.body.style.getPropertyValue('--coach-up') !== u,
            { timeout: 5000 * slow, polling: 100 }, up0).catch(() => {});
          await sleep(300 * slow);
          row.rightLift = (await page.evaluate(measureHud)).rightHits;
          await page.evaluate(() => { document.getElementById('stroke-chip').hidden = true; document.querySelector('[data-slot="tool"]')?.click(); });
          await page.waitForFunction(() => Boolean(document.querySelector('#tools-flyout:not([hidden])')), { timeout: 5000 * slow, polling: 100 }).catch(() => {});
          await sleep(900 * slow);
          row.rightPop = (await page.evaluate(measureHud)).rightHits;
          await page.keyboard.press('Escape');
          await sleep(500 * slow);
        }
        if (shots) { const f = path.join(shots, `${farm}-${screen.replace(/\s+/g, '').toLowerCase()}-${lang}.png`); await page.screenshot({ path: f }); files.push(f); }
        if (farm === 'fresh' && screen === '1366x768') {
          row.planted = await firstPlant(page, slow);
          row.afterPlant = await page.evaluate(measureHud);
          if (shots) { const f = path.join(shots, `fresh-planted-1366x768-${lang}.png`); await page.screenshot({ path: f }); files.push(f); }
        }
        // M11 / S3: the Farm book on a phone, every entry on the first screen (the last row above the home bar)
        if (!SCREENS[screen].desktop && farm !== 'fresh') {
          await page.evaluate(() => window.__hh.ui.panels.open('menu'));
          // the sheet slides up: measure once it stands still (a loaded machine runs the slide for seconds; the first
          // run measured mid-slide, 750 px low)
          await page.waitForFunction(() => {
            const sheet = document.querySelector('.farm-book')?.closest('.hh-panel');
            if (!sheet || sheet.getAnimations({ subtree: true }).some((a) => a.playState === 'running')) return false;
            const y = Math.round(sheet.getBoundingClientRect().top);
            const same = window.__bookY === y;
            window.__bookY = y;
            return same;
          }, { timeout: 15_000 * slow, polling: 250 }).catch(() => {});
          row.book = await page.evaluate(measureBook, SCREENS[screen].safe?.bottom ?? 0);
          if (shots) { const f = path.join(shots, `${farm}-${screen.replace(/\s+/g, '').toLowerCase()}-${lang}-farmbook.png`); await page.screenshot({ path: f }); files.push(f); }
          await page.evaluate(() => window.__hh.ui.panels.closeAll());
        }
        results.push(row);
        } catch (err) {
          errors.push(`${farm} ${screen}: ${err.message}`);
        } finally {
          await page?.browserContext().close().catch(() => {});
        }
      }
      await srv?.stop();
      srv = null;
    }
  } catch (err) {
    errors.push(`fatal: ${err.stack || err.message}`);
  } finally {
    await browser?.close().catch(() => {});
    await srv?.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // the bars
  const fails = [];
  for (const r of results) {
    const tag = `${r.farm} ${r.screen}`;
    if (SCREENS[r.screen].desktop && !r.hudMore.hit) fails.push(`${tag}: #hud-more is not what a click at its centre reaches (${r.hudMore.by ?? 'missing'})`);
    for (const d of r.dockHits) if (!d.hit) fails.push(`${tag}: dock button ${d.name} is covered at its centre (by ${d.by})`);
    for (const [k, list] of [['', r.rightHits], [' (action line up)', r.rightLift], [' (tool pop-up open)', r.rightPop]]) {
      for (const d of list ?? []) if (!d.hit) fails.push(`${tag}: the right column's ${d.name} is covered at its centre${k} (by ${d.by})`);
    }
    if (r.screen === '1366x768') {
      const [maxB, maxC] = r.farm === 'fresh' ? [15, 14] : [22, 16];
      if (r.buttons > maxB) fails.push(`${tag}: ${r.buttons} visible buttons (bar ${maxB})`);
      if (r.coverage > maxC) fails.push(`${tag}: HUD covers ${r.coverage} % (bar ${maxC} %)`);
      if (r.farm === 'fresh' && r.afterPlant && r.afterPlant.stack > 170) fails.push(`${tag}: the bottom stack is ${r.afterPlant.stack} px after the first plant (bar 170)`);
    }
    if (r.screen === 'iPhone 13' && r.book) {
      // the 14-entry bar is the owners' farm's (ux-phone#3: their Farm menu had 20); a later farm only has to fit
      if (r.farm === 'owners' && r.book.entries > 14) fails.push(`${tag}: the Farm book holds ${r.book.entries} entries (bar 14)`);
      if (!r.book.oneScreen) fails.push(`${tag}: the Farm book's last entry ends at ${r.book.lastBottom} px, under the home bar (${r.book.limit} px)`);
    }
  }
  const summary = results.map((r) => ({ farm: r.farm, screen: r.screen, level: r.level, coverage: r.coverage, buttons: r.buttons, dock: `${r.dock.big}+${r.dock.mini}`,
    hudMore: r.hudMore.hit, stack: r.stack, ...(r.book ? { book: r.book } : {}), ...(r.afterPlant ? { planted: r.planted, stackAfterPlant: r.afterPlant.stack, buttonsAfterPlant: r.afterPlant.buttons } : {}) }));
  const out = { ok: errors.length === 0 && fails.length === 0, root: path.relative(ROOT, root) || '.', lang, summary, fails, errors, files: files.map((f) => path.relative(ROOT, f)), load: fs.readFileSync('/proc/loadavg', 'utf8').trim() };
  if (args.out) fs.writeFileSync(path.resolve(args.out), JSON.stringify({ ...out, results }, null, 1));
  console.log(JSON.stringify(out));
  process.exitCode = out.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
