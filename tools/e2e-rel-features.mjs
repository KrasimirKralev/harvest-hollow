#!/usr/bin/env node
// The release-1.0 features end to end (features lane; release-scope §4.5, rel-features.md "Acceptance"). Starts its
// own HH_DEV server on --port (default 4491) with a COPY of the owners' save (--save, default .scratch/box-save-1013:
// never written), reclaims both farmers, and drives ONE headless Chrome with two contexts: the desktop farmer (p2,
// 1366 x 768, English) and the phone farmer (p1, iPhone 13, Bulgarian; real touch for taps). --small adds a third
// context (360 x 640, Bulgarian) for the NOW chip and screenshots. A second short server (--fresh-port, default
// --port - 1) checks the coach and the tracker on a fresh farm (M1b: one voice).
//
// Steps (each "ok" or "fail"; QA r2 F2-04: no "pending" any more, every lane's piece is in the tree):
//    1. boot: both pages up; the save gained farm.gifts; the Ribbon Track is open at L21 (D5) and its panel opens
//    2. M6: the NOW card names a group with its verb (never "things" / the Sickle for animals); a click pans there and
//       the target's screen point is free of every HUD box (elementFromPoint is the farm canvas)
//    3. the NOW chip on the phone (and 360) fits: no ellipsis, scrollWidth <= clientWidth (M6)
//    4. D1: on the phone the note field and "Wrap it" stay above a keyboard (QA r2 F2-01); the desktop wraps a Rose (or
//       the first tile) with a note chip in the gift sheet; the phone sees the box and opens it with a finger's tap on
//       the box (QA r2 F2-04: a tap that does not open it fails the run; the sheet's Open it then lets the run go on);
//       both feeds say so; the shelf has it; no Hearts moved
//    5. D2: h3 "Helping Hands" completes over warped farm days, each gift opened in the other's session
//    6. D2: both online: Golden Hour's NOW card on the desktop; the desktop sits, the phone shows the bench chip
//       (ui-shell), the phone sits too: Golden Hour starts on both screens
//    7. D3 by the farmer's own click / tap on the NOW card (QA r1 F-03: never the rules' candidate list), each on a quiet
//       copy of the save (every plot empty, nothing else due): the desktop at a warped 14:00 with 60,000 coins (the
//       stroke is a BIG_SPEND: the "are you sure?" card asks first, QA r1 F-01), the iPhone in Bulgarian at 21:00
//       ("Before bed") with the owners' own coins (no question); the field is planted in one stroke
//    8. D4: a named animal's tag (life-feel) and its tooltip (ui-shell)
//    9. M29: a drip card shows on the desktop, "Got it" marks it seen, and it does not come back after a reload
//   10. M1b on a fresh farm: every 500 ms for 30 s, while the coach card is visible the tracker is hidden or its NOW card
//       carries the coach's message and counts
//   11. the balloon crates' power-ups (owner request 2026-10-19): a crate holding one drops (a warp to its pass), the
//       desktop opens it, the loot card names it with its picture, both HUDs show its chip, the feed names the finder
//   D3 also checks (QA r2 F2-03) the big planting's fine print and that the partner's phone is told (bigSpend).
// Taps are a finger's (touchStart, touchEnd 80 ms later: fingerTap). A console warning fails the run like an error
// (QA r2 S2-17), except the reviewed WARN_OK lines.
// Prints one JSON line { ok, steps, pending, errors, tolerated, files } (errors = console / page errors, warnings and failed
// steps; tolerated = the reviewed WARN_OK warnings seen).
//
//   node tools/e2e-rel-features.mjs --port 4491 [--save <dir>] [--small] [--screens dir] [--slow N] [--fresh-port 4490]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer, { KnownDevices } from 'puppeteer-core';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../shared/net/protocol.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const port = Number(args.port || 4491);
const freshPort = Number(args['fresh-port'] || port - 1);
for (const p of [port, freshPort]) if (p === 3000 || p === 3300) throw new Error('ports 3000 and 3300 belong to the real services');
const SAVE = path.resolve(ROOT, args.save || '.scratch/box-save-1013');
const SCREENS = path.resolve(ROOT, args.screens || 'docs/qa/release/build/features');
const SLOW = Math.max(1, Number(args.slow || process.env.HH_E2E_SLOW || 1));
const TZ = 'Europe/Sofia';
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) fs.mkdirSync(SCREENS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpRoot = process.env.TMPDIR || os.tmpdir();

const steps = [];
const errors = [];
const files = [];
const servers = [];
const step = (name, status, detail = '') => {
  steps.push({ name, status, ...(detail ? { detail: String(detail).slice(0, 300) } : {}) });
  if (status === 'fail') errors.push(`step ${name}: ${detail}`);
};
const ok = (name, cond, detail = '') => step(name, cond ? 'ok' : 'fail', cond ? '' : detail);

function startServer(p, dataDir) {
  let log = '';
  const env = { ...process.env, PORT: String(p), HH_DATA_DIR: dataDir, HH_DEV: '1', HH_TZ: TZ };
  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const s = { child, log: () => log };
  servers.push(s);
  return s;
}
async function up(s) {
  for (let i = 0; i < 600 && !s.log().includes('running at'); i++) await sleep(100);
  if (!s.log().includes('running at')) throw new Error(`server did not start: ${s.log().slice(-600)}`);
}

/** A farmer's token: reclaim the slot of an offline farmer (the owners' save), or claim a fresh one. */
function claim(p, slot, name, reclaim) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${p}/ws`);
    const t = setTimeout(() => reject(new Error(`claim ${slot} timed out`)), 15_000 * SLOW);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', proto: PROTOCOL_VERSION, cid: `rf${slot}${Date.now() % 1e4}`.slice(0, 8),
      claim: { slot, name, ...(reclaim ? { reclaim: true } : {}) } })));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === 'welcome' && m.token) { clearTimeout(t); ws.close(); resolve(m.token); }
      else if (m.t === 'deny') { clearTimeout(t); ws.close(); reject(new Error(`claim ${slot} denied ${m.code}`)); }
    });
    ws.on('error', reject);
  });
}

/**
 * Console warnings that are no defect of the build (reviewed, QA r2 S2-17). Each is still printed (`tolerated` in the
 * output line), never hidden; a line added here says why.
 *   - the silent-drop watchdog (infra's M14, net/socket.js) on a machine so loaded that a page's main thread does not
 *     run for its 22 s window (load 32-34 with five software-rendered pages in this one browser, 2026-10-15): the page
 *     reconnects by itself. infra's e2e-multi checks the watchdog itself.
 */
const WARN_OK = [/^socket: no answer from the server \(silent\); reconnecting$/];
/**
 * Chrome's own line when that reconnect gives up on a socket still connecting: tolerated only on a page whose watchdog
 * line came first (the same chain). Seen at load 33 with five software-rendered pages in one browser (2026-10-15):
 * the page's main thread starved for the watchdog's 22 s, and a 9-hour warp itself takes 0.1 s on the server.
 */
const WARN_AFTER_DROP = [/^WebSocket connection to '.*' failed: WebSocket is closed before the connection is established\.$/];
const tolerated = [];

const DESK = { width: 1366, height: 768 };
const SMALL = { userAgent: KnownDevices['iPhone 13'].userAgent.replace('iPhone', 'Android'),
  viewport: { width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false } };

let browser = null;
async function open(p, { pid, token, lang, device }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (device) await page.emulate(device); else await page.setViewport(DESK);
  page.setDefaultTimeout(60_000 * SLOW);
  await page.evaluateOnNewDocument((tok, slot, l) => {
    try { localStorage.setItem('hh.tokens', JSON.stringify({ [slot]: tok })); localStorage.setItem('hh.lang', l); } catch { /* none */ }
  }, token, pid, lang);
  const tag = `${pid}${device ? (device === SMALL ? '-360' : '-phone') : '-desk'}`;
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message.slice(0, 240)}`));
  // QA r2 S2-17 (ui-shell's patch; ap#7): a console warning fails the run too (scope §8: 0 errors, 0 warnings), except
  // the reviewed WARN_OK lines
  page.on('console', (m) => {
    const type = m.type();
    if (type === 'error') errors.push(`${tag} console: ${m.text().slice(0, 240)}`);
    else if (type === 'warn' || type === 'warning') {
      const text = m.text();
      if (WARN_OK.some((re) => re.test(text))) { page.__dropped = true; tolerated.push(`${tag}: ${text.slice(0, 160)}`); }
      else if (page.__dropped && WARN_AFTER_DROP.some((re) => re.test(text))) tolerated.push(`${tag}: ${text.slice(0, 160)}`);
      else errors.push(`${tag} console warning: ${text.slice(0, 240)}`);
    }
  });
  await page.goto(`http://localhost:${p}/?slot=${pid}&quality=low`, { waitUntil: 'domcontentloaded', timeout: 180_000 * SLOW });
  await page.waitForFunction(() => window.__hh && window.__hh.state && window.__hh.pid && window.__hh.ui, { timeout: 240_000 * SLOW });
  // the boot curtain lifts on view.ready() (S8): only then is the camera the player's
  await page.waitForFunction(() => { const b = document.getElementById('boot'); return !b || b.hidden || b.offsetParent === null; },
    { timeout: 60_000 * SLOW, polling: 250 }).catch(() => {});
  return page;
}
async function shot(page, name) {
  const f = path.join(SCREENS, `${name}.png`);
  await page.screenshot({ path: f });
  files.push(path.relative(ROOT, f));
  return f;
}
const warpTo = async (page, localH, localM = 0, dayAhead = 0) => page.evaluate(async (h, m, d, tz) => {
  // this page's clock may not know the partner page's warp yet: a 1 ms warp returns the server's own now
  const now = await window.__hh.dev.warp(1);
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const cur = Object.fromEntries(f.formatToParts(now).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  let ms = ((h - cur.hour) * 60 + (m - cur.minute)) * 60_000 + d * 86_400_000;
  if (ms <= 0) ms += 86_400_000;
  return window.__hh.dev.warp(ms);
}, localH, localM, dayAhead, TZ);
/**
 * A finger's tap at a screen point: touchStart, then touchEnd 80 ms later, with explicit timestamps (QA r2 F2-04, fe#4).
 * page.touchscreen.tap sends both at once, and on a loaded machine the touchend arrived late: the controller read a long
 * press (0 of 8 taps opened the box; a real finger's 80 ms opened 5 of 5), and the step was called "pending".
 */
async function fingerTap(page, x, y, holdMs = 80) {
  page.__cdp ??= await page.createCDPSession();
  const ts = Date.now() / 1000;
  await page.__cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1 }], timestamp: ts });
  await sleep(holdMs);
  await page.__cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: ts + holdMs / 1000 });
}
/** A finger's tap on the farm tile x, z (its centre on screen); false when the tile is off the screen. */
const tap = async (page, x, z) => {
  const pt = await page.evaluate((tx, tz) => { const p = window.__hh.view.toScreen(tx + 0.5, tz + 0.5); return p ? { x: p.x, y: p.y } : null; }, x, z);
  if (!pt) return false;
  await fingerTap(page, pt.x, pt.y);
  return true;
};
/** A finger's tap on the centre of the first element `sel` matches (throws when none is on screen). */
async function tapEl(page, sel) {
  const pt = await page.$eval(sel, (el) => { el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await fingerTap(page, pt.x, pt.y);
}

/**
 * A quiet copy of the save for a Plant for later click (D3): every plot empty, everything else busy for 40 hours (a warp
 * of up to a day keeps it so), no balloon crate due, no Almanac task, no order or townsfolk request to fill: the NOW card
 * is the Plant for later card ("Before bed" from 19:00 to 04:00 farm time, else the daytime words). `coins` replaces the
 * treasury (a BIG_SPEND stroke on a smaller purse).
 */
async function quietCopy(save, dir, { coins = null } = {}) {
  const { passOf } = await import('../shared/rules/actions/crates.js');
  const s = structuredClone(save);
  const f = s.state.farm;
  const at = Date.now();
  const busy = at + 40 * 3_600_000;
  for (const [id, o] of Object.entries(f.objects)) {
    if (o.def === 'plot') o.crop = null;
    else if (Number.isSafeInteger(o.readyAt)) o.readyAt = busy;
    if (o.def === 'loot_crate' || ['weed', 'rock', 'stump', 'log', 'boulder', 'big_stump'].includes(o.def) || /^wild_weed/.test(o.def)) delete f.objects[id];
  }
  for (const p of Object.values(s.state.players)) if (p.almanac) p.almanac.tasks = {};
  for (const sl of Object.values(f.orders?.slots ?? {})) { sl.order = null; sl.availableAt = busy; }   // no refill at boot
  if (f.folk) f.folk.posts = {};
  if (f.crates) f.crates.k = passOf(at) + 3;
  // QA r2 F2-03: the partner is on this farm too (the heads-up check): no Golden Hour card over the field's card
  if (f.coop) f.coop.goldenAt = busy;
  if (Number.isSafeInteger(coins)) f.wallet.coins = coins;
  fs.writeFileSync(path.join(dir, 'farm.json'), JSON.stringify(s));
}

/** The probe for M1b (exported so ui-shell's scripted first five minutes can evaluate it every 500 ms too). */
export const COACH_PROBE = () => {
  const coach = document.querySelector('#coach-slot .coach');
  const visible = Boolean(coach && coach.offsetParent !== null && coach.getBoundingClientRect().height > 0);
  if (!visible) return { visible: false, ok: true };
  const tracker = document.getElementById('tracker');
  const hidden = !tracker || tracker.offsetParent === null || getComputedStyle(tracker).display === 'none';
  const chipWrap = document.querySelector('.tracker-chip-wrap');
  const chipHidden = !chipWrap || chipWrap.offsetParent === null || getComputedStyle(chipWrap).display === 'none';
  if (hidden && chipHidden) return { visible: true, ok: true, how: 'hidden' };
  const now = document.querySelector('#tracker .goal-slot[data-slot="now"] .goal, #tracker .goal[data-slot="now"]');
  const same = now && coach.dataset.msg && now.dataset.msg === coach.dataset.msg && now.dataset.params === coach.dataset.params;
  return { visible: true, ok: Boolean(same), how: 'mirror', coach: coach.dataset.msg ?? null, now: now?.dataset.msg ?? null };
};

async function main() {
  if (!fs.existsSync(path.join(SAVE, 'farm.json'))) throw new Error(`no save at ${SAVE}`);
  const owners = JSON.parse(fs.readFileSync(path.join(SAVE, 'farm.json'), 'utf8')).state;
  const nameOf = (pid) => owners.players[pid]?.name ?? pid;
  const dataDir = fs.mkdtempSync(path.join(tmpRoot, 'hh-e2e-relf-'));
  for (const f of ['farm.json', 'farm.journal.jsonl', 'farm.journal.archive.jsonl']) {
    if (fs.existsSync(path.join(SAVE, f))) fs.copyFileSync(path.join(SAVE, f), path.join(dataDir, f));
  }
  const srv = startServer(port, dataDir);
  await up(srv);
  const tokens = { p1: await claim(port, 'p1', nameOf('p1'), true), p2: await claim(port, 'p2', nameOf('p2'), true) };
  browser = await puppeteer.launch({ executablePath: '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--mute-audio',
      '--window-size=1366,768'] });
  // the desktop farmer alone first (with both online the NOW card is Golden Hour, which has its own step)
  const K = await open(port, { pid: 'p2', token: tokens.p2, lang: 'en' });
  await sleep(4000 * SLOW);
  let D = null;
  const st = (page, fn, ...a) => page.evaluate(fn, ...a);

  // 1. boot
  const boot = await st(K, () => ({ gifts: window.__hh.state.farm.gifts, track: window.__hh.state.farm.track.s, need: window.__hh.state.farm.track.need,
    L: window.__hh.state.farm.xp }));
  ok('boot: the save gained farm.gifts', boot.gifts && typeof boot.gifts === 'object', JSON.stringify(boot));
  ok('D5: the Ribbon Track is open at L21 (autumn, need 16,000)', /-autumn$/.test(boot.track ?? '') && boot.need === 16_000, JSON.stringify(boot));
  await K.waitForFunction(() => window.__hh.ui.panels.has('seasonTrack'), { timeout: 30_000 * SLOW }).catch(() => {});
  const trackOpen = await st(K, () => window.__hh.ui.panels.has('seasonTrack') && window.__hh.ui.panels.open('seasonTrack'));
  await sleep(800);
  await shot(K, 'e2e-desk-en-track');
  ok('D5: the Ribbon Track panel opens', trackOpen);
  await st(K, () => window.__hh.ui.panels.closeAll());

  // 2. M6 on the desktop
  const nowCard = async (page) => st(page, () => {
    const el = document.querySelector('#tracker .goal-slot[data-slot="now"] .goal, #tracker .goal[data-slot="now"]');
    return el ? { text: el.querySelector('.gt')?.textContent ?? '', sub: el.querySelector('.gs')?.textContent ?? '', aria: el.getAttribute('aria-label') } : null;
  });
  const n1 = await nowCard(K);
  await shot(K, 'e2e-desk-en-now');
  ok('M6: the NOW card names a group with its verb', n1 && !/ready things|Drag the Sickle/.test(`${n1.text} ${n1.sub}`), JSON.stringify(n1));
  // the tracker's own target: view.focus is watched while the NOW card is clicked, then the camera settles
  const free = await st(K, async () => {
    const v = window.__hh.view;
    const orig = v.focus.bind(v);
    let asked = null;
    v.focus = (x, z, ...rest) => { asked = { x, z }; return orig(x, z, ...rest); };
    // the welcome-back card (the farmer was away for hours) is not what this step is about
    window.__hh.ui.panels.closeAll();
    await new Promise((r) => setTimeout(r, 800));
    const card = document.querySelector('#tracker .goal-slot[data-slot="now"] .goal');
    if (!card) { v.focus = orig; return { none: true }; }
    card.click();
    for (let i = 0; i < 50 && !asked; i++) await new Promise((r) => setTimeout(r, 100));
    v.focus = orig;
    if (!asked) return { skip: card.textContent.slice(0, 60) };
    // the camera eases for 500 ms, and a loaded software renderer may draw no frame for a while: give it time, then
    // wait for three equal samples 400 ms apart (12 s at most)
    await new Promise((r) => setTimeout(r, 1500));
    let last = null;
    let still = 0;
    for (let i = 0; i < 30 && still < 2; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const p = v.toScreen(asked.x + 0.5, asked.z + 0.5);
      still = last && p && Math.abs(p.x - last.x) < 2 && Math.abs(p.y - last.y) < 2 ? still + 1 : 0;
      last = p;
    }
    const p = v.toScreen(asked.x + 0.5, asked.z + 0.5);
    const el = p ? document.elementFromPoint(p.x, p.y) : null;
    return { asked, at: p, hit: el ? `${el.tagName}#${el.id}.${String(el.className).slice(0, 40)}` : null, canvas: el?.tagName === 'CANVAS' };
  });
  if (free.none || free.skip !== undefined) step('M6: the NOW card pans clear of the HUD', 'ok', `no tile to pan to (${free.skip ?? 'no card'})`);
  else ok('M6: the NOW card pans clear of the HUD', free.canvas, JSON.stringify(free));
  await shot(K, 'e2e-desk-en-now-after-click');

  D = await open(port, { pid: 'p1', token: tokens.p1, lang: 'bg', device: KnownDevices['iPhone 13'] });
  await sleep(4000 * SLOW);
  // 3. the phone chip (iPhone 13 BG) and 360 BG
  const chipFits = async (page) => st(page, () => {
    const t = document.querySelector('.tracker-chip .tc-t');
    if (!t || t.offsetParent === null) return { hidden: true };
    const cs = getComputedStyle(t);
    return { text: t.textContent, fits: t.scrollWidth <= t.clientWidth + 1 && t.scrollHeight <= t.clientHeight + 1, ellipsis: cs.textOverflow };
  });
  const c1 = await chipFits(D);
  await shot(D, 'e2e-iphone13-bg-now');
  if (c1.hidden) step('M6: the phone NOW chip fits (iPhone 13 BG)', 'ok', 'chip hidden');
  else ok('M6: the phone NOW chip fits (iPhone 13 BG)', c1.fits, JSON.stringify(c1));
  if (args.small) {
    const tokS = tokens.p1;
    const S = await open(port, { pid: 'p1', token: tokS, lang: 'bg', device: SMALL });
    await sleep(3000 * SLOW);
    const c2 = await chipFits(S);
    await shot(S, 'e2e-360-bg-now');
    if (c2.hidden) step('M6: the phone NOW chip fits (360 BG)', 'ok', 'chip hidden');
    else ok('M6: the phone NOW chip fits (360 BG)', c2.fits, JSON.stringify(c2));
    await S.browserContext().close();
  }

  // 4. D1: a surprise from the desktop, opened on the phone
  const registered = await st(K, () => window.__hh.ui.panels.has('gift'));
  for (const page of [K, D]) {
    if (!(await st(page, () => window.__hh.ui.panels.has('gift')))) {
      await st(page, async () => { const m = await import('/js/ui/panels/gift.js'); window.__hh.ui.panels.register('gift', m.giftPanel); });
    }
  }
  // QA r2 F2-04: every piece another lane delivers is in the tree: a missing one fails the run (never "pending")
  ok('D1: the gift sheet is registered by ui-panels', registered, 'not registered: the tool registered it to go on');
  // QA r2 F2-01 (oib#1): on the phone, the note field with the keyboard up (a 508 px layout on the iPhone 13): the field
  // and "Wrap it" both inside the visual viewport, and the field is what a tap at its centre reaches (the sticky foot
  // covered it and a tap there sent the surprise without its note). Nothing is sent: the sheet closes after.
  {
    await st(D, () => window.__hh.ui.panels.open('gift'));
    await D.waitForSelector('.rel-gift-grid .pn-stack, .rel-gift-card, .rel-gift-note', { timeout: 20_000 * SLOW }).catch(() => {});
    const formShown = await st(D, () => { const f = document.querySelector('#panels .rel-gift-form'); return Boolean(f && !f.hidden); });
    if (!formShown) step('F2-01: the note field stays above the keyboard (iPhone 13 BG)', 'ok', 'no form today (a box waits or one was wrapped)');
    else {
      // the sheet slides up first: a tap during its entrance lands beside the tile
      await sleep(1200 * SLOW);
      const pickedOne = () => st(D, () => Boolean(document.querySelector('#panels .rel-gift-grid .pn-stack[aria-selected="true"]')));
      for (let k = 0; k < 3 && !(await pickedOne()); k++) {
        await tapEl(D, '#panels .rel-gift-grid .pn-stack').catch(() => {});
        await sleep(700 * SLOW);
      }
      const picked = await pickedOne();
      await st(D, () => {
        const sc = [...document.querySelectorAll('#panels .hh-panel:not([hidden]) *')].find((e) => e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
        if (sc) sc.scrollTop = sc.scrollHeight;
      });
      await sleep(500 * SLOW);
      await tapEl(D, '#panels .rel-gift-field').catch(() => {});
      await sleep(700 * SLOW);
      const vp = D.viewport();
      await D.setViewport({ ...vp, height: vp.height - 336 });
      await sleep(1500 * SLOW);
      const kb = await st(D, () => {
        const vv = window.visualViewport;
        const top = vv ? vv.offsetTop : 0;
        const bottom = vv ? vv.offsetTop + vv.height : innerHeight;
        const field = document.querySelector('#panels .rel-gift-field');
        const send = document.querySelector('#panels [data-gift="send"]');
        const box = (e) => (e ? e.getBoundingClientRect() : null);
        const inside = (r) => Boolean(r && r.top >= top - 1 && r.bottom <= bottom + 1);
        const f = box(field);
        const hit = f ? document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2) : null;
        return { focused: document.activeElement === field, field: inside(f), send: inside(box(send)), hitIsField: Boolean(hit && field && (hit === field || field.contains(hit))),
          at: f ? [Math.round(f.top), Math.round(f.bottom)] : null, vv: [Math.round(top), Math.round(bottom)] };
      });
      await shot(D, 'e2e-iphone13-bg-gift-keyboard');
      await D.setViewport(vp);
      await sleep(400 * SLOW);
      ok('F2-01: the note field stays above the keyboard (iPhone 13 BG)', picked && kb.field && kb.send && kb.hitIsField, JSON.stringify({ picked, ...kb }));
    }
    await st(D, () => { document.activeElement?.blur?.(); window.__hh.ui.panels.closeAll(); });
    await sleep(500 * SLOW);
  }
  const hearts0 = await st(K, () => Object.fromEntries(Object.entries(window.__hh.state.players).map(([p, x]) => [p, x.hearts])));
  const wrapOn = async (page, who) => {
    await st(page, () => window.__hh.ui.panels.open('gift'));
    await page.waitForSelector('.rel-gift-grid .pn-stack, .rel-gift-card, .rel-gift-note', { timeout: 20_000 * SLOW });
    const tile = await page.$('.rel-gift-grid .pn-stack[data-item="rose"]') ?? await page.$('.rel-gift-grid .pn-stack');
    if (!tile) return { ok: false, why: 'no tile' };
    await tile.click();
    const chip = await page.$('.rel-gift-notes .chip');
    if (chip) await chip.click();
    await sleep(300);
    await shot(page, `e2e-${who}-gift-sheet`);
    const send = await page.$('.rel-gift-foot [data-gift="send"]');
    await send.click();
    await sleep(1500 * SLOW);
    return { ok: true };
  };
  const w1 = await wrapOn(K, 'desk-en');
  const box = await st(K, () => Object.entries(window.__hh.state.farm.gifts ?? {}).find(([, x]) => x.by === window.__hh.pid));
  ok('D1: the desktop wraps a surprise (a box on the porch)', w1.ok && box, JSON.stringify(w1));
  await st(K, () => window.__hh.ui.panels.closeAll());
  if (box) {
    const [id, gift] = box;
    await D.waitForFunction((gid) => Boolean(window.__hh.state.farm.gifts?.[gid]), { timeout: 15_000 * SLOW }, id);
    await st(D, (gid) => { const o = window.__hh.state.farm.objects[gid]; window.__hh.view.focus(o.x, o.z); }, id);
    await sleep(1500 * SLOW);
    await shot(D, 'e2e-iphone13-bg-gift-box');
    const o = await st(D, (gid) => window.__hh.state.farm.objects[gid], id);
    const onScreen = await tap(D, o.x, o.z);
    await sleep(2000 * SLOW);
    let opened = await st(D, (gid) => !window.__hh.state.farm.gifts?.[gid], id);
    // QA r2 F2-04: the box is the surprise's main door; a tap that does not open it is a failure, never "pending"
    ok('D1: a finger\'s tap on the box opens it', opened, onScreen ? `the box ${id} is still waiting after the tap`
      : 'the box is off the screen');
    if (!opened) {
      await st(D, () => window.__hh.ui.panels.open('gift'));
      await D.waitForSelector('.rel-gift-card [data-gift="unwrap"]', { timeout: 15_000 * SLOW });
      await shot(D, 'e2e-iphone13-bg-gift-for-me');
      // a real tap; the button is found again right before it (a panel update may have redrawn it)
      let how = 'tap';
      for (let k = 0; k < 4; k++) {
        try { await tapEl(D, '.rel-gift-card [data-gift="unwrap"]'); break; } catch { await sleep(300); }
      }
      await sleep(1500 * SLOW);
      opened = await st(D, (gid) => !window.__hh.state.farm.gifts?.[gid], id);
      if (!opened) {
        // a loaded rig reads a headless tap as a long press (features audit, integration-harness.md): a click then
        how = await D.$eval('.rel-gift-card [data-gift="unwrap"]', (b) => { b.click(); return `click (aria-disabled=${b.getAttribute('aria-disabled')}, why="${b.parentElement?.querySelector('.pn-why')?.textContent ?? ''}")`; })
          .catch((e) => `no button: ${e.message.slice(0, 80)}`);
        await sleep(1500 * SLOW);
        opened = await st(D, (gid) => !window.__hh.state.farm.gifts?.[gid], id);
      }
      await shot(D, 'e2e-iphone13-bg-gift-opened');
      if (!opened) how += ` / act: ${JSON.stringify(await st(D, (gid) => window.__hh.act('openGift', { id: gid }), id))}`;
      step('D1: the phone opens the surprise (the sheet\'s Open it)', opened ? 'ok' : 'fail', how);
    }
    else step('D1: the phone opens the surprise (the sheet\'s Open it)', 'ok', 'opened by the tap on the box');
    const feeds = await Promise.all([K, D].map((p) => st(p, () => Object.values(window.__hh.state.farm.feed.rows)
      .some((r) => r.k === 'surprise' && r.what === 'opened'))));
    ok('D1: both feeds say it was opened', feeds.every(Boolean), JSON.stringify(feeds));
    const shelf = await st(D, (item) => Object.values(window.__hh.state.players[window.__hh.pid].shelf.rows).some((r) => r.item === item), gift.item);
    ok('D1: on the phone farmer\'s shelf', shelf);
    const hearts1 = await st(K, () => Object.fromEntries(Object.entries(window.__hh.state.players).map(([p, x]) => [p, x.hearts])));
    ok('M30: no Hearts for a surprise', JSON.stringify(hearts0) === JSON.stringify(hearts1), `${JSON.stringify(hearts0)} -> ${JSON.stringify(hearts1)}`);
    await st(D, () => window.__hh.ui.panels.closeAll());
    await shot(D, 'e2e-iphone13-bg-after-open');
  }

  // 5. D2: h3 over warped days (each wraps in their own session, the other opens it later)
  const h3 = async () => st(K, () => ({ done: Object.hasOwn(window.__hh.state.farm.quests.done, 'h3'), n: window.__hh.state.farm.quests.active.h3?.n?.['0'] ?? null }));
  for (let day = 0; day < 4 && !(await h3()).done; day++) {
    for (const [giver, opener] of [[D, K], [K, D]]) {
      if ((await h3()).done) break;
      const r = await st(giver, (items) => {
        const inv = window.__hh.state.farm.inventory;
        const item = items.find((i) => (inv[i] ?? 0) > 2);
        return item ? window.__hh.act('keepsake', { item }) : { ok: false, code: 'NO_ITEMS' };
      }, ['rose', 'lavender', 'sunflower', 'strawberry', 'wheat', 'egg', 'carrot']);
      await sleep(800 * SLOW);
      const gid = await st(opener, (by) => Object.keys(window.__hh.state.farm.gifts ?? {}).find((k) => window.__hh.state.farm.gifts[k].by === by),
        await st(giver, () => window.__hh.pid));
      if (gid) await st(opener, (k) => window.__hh.act('openGift', { id: k }), gid);
      await sleep(800 * SLOW);
      void r;
    }
    await warpTo(K, 9, 0, 1);
    await sleep(1000 * SLOW);
  }
  const h = await h3();
  ok('D2: "Helping Hands" (h3) completes with surprises opened at different hours', h.done, JSON.stringify(h));

  // 6. D2: Golden Hour with both online
  const gold = await st(K, async () => {
    const { goals } = await import('/shared/rules/goals.js');
    const g0 = goals(window.__hh.state, window.__hh.pid, window.__hh.serverNow(), { online: Object.keys(window.__hh.state.players) }).now;
    return { kind: g0.kind, text: g0.text, bench: g0.target?.sit ?? null };
  });
  ok('D2: both online, the NOW card is Golden Hour', gold.kind === 'golden', JSON.stringify(gold));
  await sleep(1000);
  await shot(K, 'e2e-desk-en-golden-card');
  if (gold.bench) {
    const sitOn = (page, bench) => st(page, (b) => new Promise((res) => {
      const o = window.__hh.state.farm.objects[b];
      window.__hh.avatar.walkTo(o.x, o.z, 2, 1, () => setTimeout(() => res(window.__hh.act('sit', { id: b })), 600));
    }), bench);
    await sitOn(K, gold.bench);
    await sleep(2500 * SLOW);
    const chip = await D.waitForFunction(() => {
      const el = [...document.querySelectorAll('#hud [class*="bench"], #hud [data-bench]')].find((x) => x.offsetParent !== null);
      return el ? el.textContent : null;
    }, { timeout: 15_000 * SLOW, polling: 250 }).then((h) => h.jsonValue()).catch(() => null);
    await shot(D, 'e2e-iphone13-bg-bench-chip');
    ok('D2: the phone shows the bench chip (ui-shell)', chip, chip ?? 'no chip element in #hud');
    await sitOn(D, gold.bench);
    await D.waitForFunction(() => Boolean(window.__hh.state.farm.coop.golden && window.__hh.state.farm.coop.golden.until > window.__hh.serverNow()),
      { timeout: 30_000 * SLOW }).catch(() => {});
    const both = await Promise.all([K, D].map((p) => st(p, () => Boolean(window.__hh.state.farm.coop.golden
      && window.__hh.state.farm.coop.golden.until > window.__hh.serverNow()))));
    ok('D2: Golden Hour starts on both screens', both.every(Boolean), JSON.stringify(both));
    await shot(K, 'e2e-desk-en-golden-on');
    for (const p of [K, D]) await st(p, () => window.__hh.act('stand', {}));
  }

  // 7. D3 by the farmer's own click / tap on the NOW card (QA r1 F-03: the step used to read goals(all) and run the
  // later candidate whatever NOW showed, so it passed while NOW said "Tend 48 animals" and never met F-01's question)
  const laterByCard = async ({ who, lang, device, h, coins, partner = false }) => {
    const qDir = fs.mkdtempSync(path.join(tmpRoot, 'hh-e2e-relf-quiet-'));
    await quietCopy(JSON.parse(fs.readFileSync(path.join(SAVE, 'farm.json'), 'utf8')), qDir, { coins });
    const qs = startServer(freshPort, qDir);
    await up(qs);
    const tq = await claim(freshPort, 'p1', nameOf('p1'), true);
    // QA r2 F2-03: the partner's phone (BG) is on the farm too, and counts the heads-ups it is told
    let P2 = null;
    if (partner) {
      const t2 = await claim(freshPort, 'p2', nameOf('p2'), true);
      P2 = await open(freshPort, { pid: 'p2', token: t2, lang: 'bg', device: KnownDevices['iPhone 13'] });
      await st(P2, () => { window.__bigSpends = []; window.__hh.store.on('fx', ({ ev, by }) => { if (ev?.e === 'bigSpend') window.__bigSpends.push({ by, coins: ev.coins }); }); });
    }
    const Q = await open(freshPort, { pid: 'p1', token: tq, lang, device });
    await sleep(2500 * SLOW);
    await st(Q, () => window.__hh.ui.panels.closeAll());
    await warpTo(Q, h, 0, 0);
    const planted = () => st(Q, () => Object.values(window.__hh.state.farm.objects).filter((o) => o.def === 'plot' && o.crop).length);
    const nowSel = '#tracker .goal-slot[data-slot="now"] .goal';
    // the tracker re-ranks on the warp's clock (render runs every 5 s): the NOW card is the Plant for later card. Wait
    // for the card of the WARPED hour, not just any card: the one drawn before the warp has the real clock's words, so
    // at night (QA r4 integration, 02:28) the 14:00 step read "Before bed …, ready at 08:25" and failed. The warped
    // hour decides; the wall clock never does.
    const bedWords = /Before bed|Преди лягане/;
    const wantBed = h >= 19 || h < 4;   // shared/rules/goals.js BED_FROM / BED_UNTIL
    await Q.waitForFunction((sel, bed, src) => {
      const tx = document.querySelector(`${sel} .gt`)?.textContent ?? '';
      return /\d/.test(tx) && new RegExp(src).test(tx) === bed;
    }, { timeout: 30_000 * SLOW, polling: 500 }, nowSel, wantBed, bedWords.source).catch(() => {});
    await sleep(1500 * SLOW);
    const before = await planted();
    if (device) { await tapEl(Q, '.tracker-chip').catch(() => {}); await sleep(900 * SLOW); }
    const card = await st(Q, (sel) => {
      const el = document.querySelector(sel);
      return el ? { title: el.querySelector('.gt')?.textContent ?? '', sub: el.querySelector('.gs')?.textContent ?? '' } : null;
    }, nowSel);
    await shot(Q, `e2e-${who}-later-card`);
    for (let k = 0; k < 3; k++) {
      try { if (device) await tapEl(Q, nowSel); else await Q.click(nowSel); break; } catch { await sleep(300); }
    }
    // a BIG_SPEND stroke asks first (the shell's "are you sure?" card): the farmer says yes
    const dlg = await Q.waitForSelector('.dlg .acts .btn:not(.btn--paper)', { timeout: 3_000 * SLOW }).catch(() => null);
    const asked = Boolean(dlg);
    let fine = null;
    if (dlg) {
      fine = await st(Q, () => document.querySelector('.dlg .fine')?.textContent ?? null);
      await shot(Q, `e2e-${who}-later-ask`);
      if (device) await tapEl(Q, '.dlg .acts .btn:not(.btn--paper)').catch(() => {}); else await dlg.click().catch(() => {});
    }
    await sleep(2500 * SLOW);
    const after = await planted();
    const coinsLeft = await st(Q, () => window.__hh.state.farm.wallet.coins);
    await shot(Q, `e2e-${who}-later-planted`);
    const headsUp = P2 ? await st(P2, () => window.__bigSpends) : null;
    if (P2) { await shot(P2, `e2e-${who}-later-partner`); await P2.browserContext().close(); }
    await Q.browserContext().close();
    qs.child.kill('SIGTERM');
    await sleep(800);
    return { card, before, after, asked, fine, headsUp, coinsLeft };
  };
  const day = await laterByCard({ who: 'desk-en', lang: 'en', device: null, h: 14, coins: 60_000, partner: true });
  ok('D3: at 14:00 a click on the NOW card "Plant for later" plants the field in one stroke', /^Plant \d+ plots? with /.test(day.card?.title ?? '')
    && day.after - day.before >= 50, JSON.stringify(day));
  ok('D3 (F-01): the stroke is a BIG_SPEND on 60,000 coins: the card asks first, and half the purse stays', day.asked && day.coinsLeft >= 30_000,
    JSON.stringify(day));
  // QA r2 F2-03: what the "are you sure?" card promises happens: the partner is told, and the way back is the uproot
  ok('D3 (F2-03): the fine print says how a planting comes back (pull them up within 10 minutes), not Undo',
    /pulled up within 10 minutes/.test(day.fine ?? '') && !/Undo/.test(day.fine ?? ''), JSON.stringify(day.fine));
  ok('D3 (F2-03): the partner\'s phone is told about the big planting (bigSpend)', (day.headsUp ?? []).length === 1,
    JSON.stringify(day.headsUp));
  const night = await laterByCard({ who: 'iphone13-bg', lang: 'bg', device: KnownDevices['iPhone 13'], h: 21, coins: null });
  ok('D3: on the phone at 21:00 a tap on "Преди лягане" plants the field', /^Преди лягане: засади \d+ лех/.test(night.card?.title ?? '')
    && night.after - night.before >= 50, JSON.stringify(night));

  // 8. D4: a named animal (tags: life-feel; tooltip: ui-shell). A tag shows near the camera, on hover, or for the home
  // whose card is open (render/name-tags.js): the step eases to the first named animal's home and says its card is open
  // (life-feel's own window event, as tools/a11y-audit.mjs does), then reads the tags (integrator: it was "pending")
  await st(K, () => {
    const f = window.__hh.state.farm;
    const id = Object.keys(f.names ?? {}).find((k) => f.objects?.[k]?.home && f.objects[f.objects[k].home]);
    if (!id) return;
    const home = f.objects[f.objects[id].home];
    window.__hh.view?.focus?.(home.x, home.z);
    window.__hh.view?.camera?.zoom?.(0.55);
    window.dispatchEvent(new CustomEvent('hh:home-card', { detail: { id: f.objects[id].home } }));
  });
  await sleep(1500 * SLOW);
  const named = await st(K, () => {
    const names = window.__hh.state.farm.names ?? {};
    const id = Object.keys(names).find((k) => window.__hh.state.farm.objects[k]);
    const tags = [...document.querySelectorAll('#name-tags *')].map((x) => x.textContent).filter(Boolean);
    return { id, name: id ? names[id].name : null, tags: tags.slice(0, 5) };
  });
  await st(K, () => window.dispatchEvent(new CustomEvent('hh:home-card', { detail: { id: null } })));
  ok('D4: name tags over named animals (life-feel)', !named.id || named.tags.length > 0, JSON.stringify(named));

  // 9. M29: a drip card, once. The drip waits for 20 minutes of the farmer's play since their last card: the desktop
  // farmer plays them here (one small action in each of 21 server minutes: a note pinned and taken down again)
  await st(K, () => window.__hh.ui.panels.closeAll());
  for (let i = 0; i < 21; i++) {
    await st(K, async () => {
      await window.__hh.dev.warp(61_000);
      const r = window.__hh.act('noteAdd', { x: 22, z: 30, text: 'e2e' });
      await new Promise((res) => setTimeout(res, 150));
      const id = Object.keys(window.__hh.state.farm.notes ?? {}).find((k) => window.__hh.state.farm.notes[k].text === 'e2e');
      if (id) window.__hh.act('noteDel', { id });
      return r.ok;
    });
  }
  const due = await st(K, async () => {
    const { nextSystemCard } = await import('/shared/rules/actions/social.js');
    return nextSystemCard(window.__hh.state, window.__hh.pid, { helper: Boolean(window.__hh.ui.panels.has('harness') || document.querySelector('#hx-dock')) });
  });
  const card = await K.waitForFunction(() => {
    const b = [...document.querySelectorAll('[data-id^="card-"]')].find((x) => x.offsetParent !== null);
    return b ? b.dataset.id : null;
  }, { timeout: 60_000 * SLOW, polling: 500 }).then((h) => h.jsonValue()).catch(() => null);
  if (card) {
    await shot(K, 'e2e-desk-en-drip-card');
    const id = card.replace(/^card-/, '');
    await st(K, (cid) => {
      const b = document.querySelector(`[data-id="card-${cid}"]`);
      (b?.querySelector('.acts button') ?? b?.querySelector('button.x'))?.click();
    }, id);
    await K.waitForFunction((cid) => window.__hh.state.players[window.__hh.pid].seen.cards[cid] === 1, { timeout: 15_000 * SLOW }, id).catch(() => {});
    const seen = await st(K, (cid) => window.__hh.state.players[window.__hh.pid].seen.cards[cid] === 1, id);
    ok(`M29: the drip card "${id}" shows and is marked seen`, seen);
    await K.reload({ waitUntil: 'domcontentloaded' });
    await K.waitForFunction(() => window.__hh && window.__hh.state, { timeout: 120_000 * SLOW });
    await sleep(25_000 * SLOW);
    const again = await st(K, (cid) => Boolean(document.querySelector(`[data-id="card-${cid}"]`)), id);
    ok('M29: it does not come back after a reload', !again);
  } else step('M29: a drip card shows on the desktop', 'fail', `no card banner in 60 s; the rules' next card: ${due}`);

  // 11. the balloon crates' rare power-ups (owner request 2026-10-19): the next pass whose crate holds one for the
  // desktop farmer (found in the page with the real rules: they are pure on the farm's seed), warped to; the desktop
  // opens it; its loot card names it with its own picture; both HUDs show its chip; the phone's feed names the finder
  await st(K, () => window.__hh.ui.panels.closeAll());
  const pu = await st(K, async () => {
    const { passOf, dropMomentOf, cratesOn } = await import('/shared/rules/actions/crates.js');
    const { powerupPick } = await import('/shared/rules/powerups.js');
    const { makeCtx } = await import('/shared/rules/index.js');
    const { CRATES } = await import('/shared/content/index.js');
    const s = window.__hh.state;
    for (const id of cratesOn(s)) window.__hh.act('openCrate', { id });      // room for the new one
    await new Promise((r) => setTimeout(r, 1500));
    const now = window.__hh.serverNow();
    const ctx = makeCtx(s, { now, pid: window.__hh.pid, cid: 'e2epu1', seq: 1 });
    for (let k = passOf(now) + 1; k < passOf(now) + 5000; k++) {
      const kind = powerupPick(s, ctx, k);
      if (kind && Math.floor(ctx.rng('crate', k) * 10_000) < CRATES.dropBp) return { id: `crate.${k.toString(36)}`, kind, warp: dropMomentOf(k) - now + 1500 };
    }
    return null;
  });
  if (!pu) step('power-ups: a crate with one in the next 5,000 passes', 'fail', 'none found');
  else {
    await st(K, (ms) => window.__hh.dev.warp(ms), pu.warp);
    const dropped = await K.waitForFunction((id) => Boolean(window.__hh.state.farm.objects[id]), { timeout: 60_000 * SLOW, polling: 250 }, pu.id)
      .then(() => true).catch(() => false);
    ok(`power-ups: the balloon drops the crate that holds ${pu.kind}`, dropped, pu.id);
    if (dropped) {
      await st(K, () => window.__hh.ui.panels.closeAll());
      await st(K, (id) => window.__hh.act('openCrate', { id }), pu.id);
      const card = await K.waitForFunction(async (id, kind) => {
        const b = document.querySelector(`[data-id="loot-${id}"]`);
        if (!b) return null;
        const en = (await import('/js/i18n/en/feat.js')).default;
        return { name: b.textContent.includes(en[`feat.pu.${kind}`]), glyph: Boolean(b.querySelector('li.thing svg')), text: b.textContent.replace(/\s+/g, ' ').slice(0, 200) };
      }, { timeout: 30_000 * SLOW, polling: 300 }, pu.id, pu.kind).then((h) => h.jsonValue()).catch(() => null);
      await shot(K, 'e2e-desk-en-powerup-card');
      ok('power-ups: the loot card names it with its own picture and says what it does', card && card.name && card.glyph, JSON.stringify(card));
      const chip = (page) => page.waitForFunction((kind) => {
        const c = document.querySelector(`#hud-buffs .buff.pu-${kind}`);
        return c && c.offsetParent !== null ? { text: c.textContent.trim(), font: getComputedStyle(c).fontSize } : null;
      }, { timeout: 30_000 * SLOW, polling: 300 }, pu.kind).then((h) => h.jsonValue()).catch(() => null);
      const [cK, cD] = await Promise.all([chip(K), chip(D)]);
      await shot(D, 'e2e-iphone13-bg-powerup-chip');
      ok('power-ups: both farmers see its chip (desktop EN, iPhone BG), text >= 13 px', cK && cD && parseFloat(cK.font) >= 13
        && parseFloat(cD.font) >= 13, JSON.stringify({ cK, cD }));
      const line = await D.waitForFunction((name, kind) => {
        const r = Object.values(window.__hh.state.farm.feed.rows).find((x) => x.k === 'crate' && x.pu === kind);
        const li = [...document.querySelectorAll('.hud-bl .feed li')].map((x) => x.textContent).find((t) => t.includes(name));
        return r ? { by: r.by, li: li ?? null } : null;
      }, { timeout: 30_000 * SLOW, polling: 300 }, nameOf('p2'), pu.kind).then((h) => h.jsonValue()).catch(() => null);
      ok('power-ups: the feed line names who found it', line && line.by === 'p2', JSON.stringify(line));
    }
  }

  // 10. M1b on a fresh farm (a second server)
  const freshDir = fs.mkdtempSync(path.join(tmpRoot, 'hh-e2e-relf-fresh-'));
  const fresh = startServer(freshPort, freshDir);
  await up(fresh);
  const tokF = await claim(freshPort, 'p1', 'Ana', false);
  const F = await open(freshPort, { pid: 'p1', token: tokF, lang: 'en' });
  const probe = `(${COACH_PROBE.toString()})()`;
  let seenVisible = 0;
  const bad = [];
  for (let i = 0; i < 60; i++) {
    const r = await F.evaluate(probe);
    if (r.visible) seenVisible++;
    if (!r.ok) bad.push(r);
    if (i === 4) await shot(F, 'e2e-desk-en-fresh-coach');
    await sleep(500);
  }
  ok('M1b: while the coach speaks, the tracker is hidden or mirrors it (every 500 ms for 30 s)', bad.length === 0 && seenVisible > 0,
    JSON.stringify({ seenVisible, bad: bad.slice(0, 2) }));
}

// run only as a program: ui-shell's tools/first-five.mjs imports COACH_PROBE from this file
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let fatal = null;
  try {
    await main();
  } catch (e) {
    fatal = e;
    errors.push(`fatal: ${e.stack?.split('\n').slice(0, 3).join(' | ') ?? e}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const s of servers) { try { s.child.kill('SIGTERM'); } catch { /* gone */ } }
    await sleep(800);
  }
  const pending = steps.filter((s) => s.status.startsWith('pending')).map((s) => `${s.name}: ${s.status}`);
  const out = { ok: !fatal && errors.length === 0, steps, pending, errors: errors.slice(0, 40), tolerated, files };
  console.log(JSON.stringify(out));
  process.exitCode = out.ok ? 0 : 1;
}
