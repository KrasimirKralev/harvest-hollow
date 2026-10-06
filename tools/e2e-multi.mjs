// Multi-farm hosted mode E2E (docs/agent-briefs/multi-farm.md). Starts its own HH_MODE=multi HH_DEV=1 server on --port
// (default 3974) with a temp data dir and a 4 s idle unload, opens ONE headless Chrome with a browser context per device
// (separate storage = separate people) and plays the hosted flow with real clicks and taps:
//    1. the landing page (desktop and iPhone 13): Play (start a new farm), the 7-day line, the repo link, no sideways scroll
//    2. farm 1: Rowan (desktop) starts a farm with one click -> /f/<id> (no secret in the address), the first-run picker
//       offers farmer 1 only, Grandma Hazel's first guide; he plants; the device keeps the farm (its own namespaced token)
//    3. Rowan's HUD menu > Invite a friend > Make an invite link; Mia opens it on an iPhone 13 (touch), claims the free
//       farmer; both play in real time (her plant on his screen, his walk on hers); the invite leaves her address bar
//    4. the invite is spent: the status says so and a third phone that opens it sees "two farmers already"
//    5. farm 2 at the same time: Dana starts one on an iPhone 13 and invites from the phone menu; Leo joins on a Pixel 7
//    6. isolation: a plant on farm 1 and a chat line on farm 2 stay on their own farm (the other farm never sees them)
//    7. a farm link without an invite: the "This farm is private" gate (iPhone 13 and desktop), no game data on the page
//    8. Rowan's personal link (Settings > Farm > Show) on a new device opens the farm as Rowan, the key wiped from the
//       address bar; an unknown farm id: the private gate (the socket is refused at the handshake)
//    9. reloads keep everyone who they are; the landing page lists the farm by name
//   10. farm 2 with nobody connected unloads after the idle time; reopened, its state is identical
//   11. farm 2 idle past the 7-day TTL (the dev sweep's test clock) is deleted from disk; Dana's device says "gone"
//   12. the per-address creation limit holds (429, and the landing page says so)
//   13. security: no farm id, key or invite in the server log; no member secret in any URL a request carried; the
//       global status lists no id; no page errors
// Keep your key (docs/agent-notes/mf-client.md "Keys"), between the steps above:
//   4b. the "Keep your farm safe" card: not at load, after Rowan's first finished guide step (naming the farm); Share to
//       myself / Copy / QR code; the QR code's picture decoded back to the personal link, and used on a fresh phone's
//       private gate ("Use a photo of it") to open the farm as Rowan; the quiet dot until "I saved it"; Mia's card
//   9b. the home-screen manifest: an iPhone's carries the key in the start URL's fragment, a Pixel's is the keyless
//       per-farm one (Chrome's own parse of each, over CDP)
//   9c. Mia loses her phone: the full farm's invite card offers a new key; Rowan makes it (Settings > Farm > Farmers,
//       confirm, the one-time link); her old phone gets the polite "given a new key" gate; the old key is refused
//       on a fresh profile; the link on a fresh phone seats her again with her progress; a home-screen start URL with
//       the old key falls back to her new one; the spent link says so; the feed line for both
//   9d. Rowan loses his: Mia makes him a new key from her phone; his old laptop is signed out; a new laptop takes his
//       farmer back (renamed); the farm plays on with two farmers (never stuck "full")
// The front door and the ideas box (owner requests 2026-10-05), woven into the steps above:
//    1. the landing page is one screen (v2): three actions (Play, Star us, Open GitHub), the orb's living farm (the video
//       after the first paint), the links (way back, ideas, screenshots, privacy, self-host); the Star button's live
//       count from this server's /api/stars, which the SERVER asks of a stand-in for api.github.com (one request for
//       every visitor, nothing of a visitor in it, nothing kept on the device), and no number when the server has none
//       ({ stars: null }) or no such route (404); "Already have a farm?" and "Suggest an idea" open sheets; the ideas
//       sheet's small print ("Optional: we only use it to reply to you · Privacy"); a phone sends an idea from the sheet
//       (the thank-you shows) and closing it gives focus back; no request ever goes to api.github.com
//    5. Dana's phone farm menu has "Ideas", which opens the in-game ideas card
//    8. Settings > Farm has "Suggest an idea"
//   9b. Rowan's desktop: More menu > Suggest an idea > the card sends an idea from inside farm 1; the admin list
//       (Bearer HH_ADMIN_TOKEN) shows both ideas (the farm id only on the in-game one, the browser family only), a
//       status change moves one out of "new", and the ideas file is on the data volume
//   9c. the GitHub star card: on this device's third play day, after a harvest (a happy moment), once the first-run
//       guide is put away; "Maybe later" keeps it away for 3 days, it waits while a panel is open, comes back once
//       more after 3 days, and "Don't ask again" ends it
// Privacy (public/privacy.html, owner request 2026-10-05), after the steps above:
//   14. the privacy page in English (desktop) and Bulgarian (iPhone 13, by the browser's language), the switch, no
//       sideways scroll at 360 px, every page's link to it; a privacy request sent from the Bulgarian form reaches the
//       admin list
//   15. "Delete this farm now": Mia (iPhone 13) opens Settings > Farm, the confirm ("Keep my farm" keeps it), then
//       deletes farm 1: her screen and Kris's laptop show "This farm was deleted", the folder is gone, both devices
//       forget the farm
//   16. no full client address in the server log (an abusive socket behind a proxy shows only its /24); no page ever
//       asked another host (every device, the whole run)
// Prints one JSON line { ok, steps, errors, files } and exits non-zero on any failure. Screenshots: --screens
// (default .scratch/mf-client/e2e), the privacy ones --privacy-shots (default .scratch/privacy-shots).
import { spawn } from 'node:child_process';
import http from 'node:http';
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
const port = Number(args.port || 3974);
// the ideas admin routes need a token (any long string: this is a throwaway test server)
const ADMIN_TOKEN = `e2e-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}-admin-token`;
// the stand-in GitHub's star count (the server asks it; the page shows it)
const GITHUB_STARS = 321;
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
const screens = path.resolve(args.screens || path.join(ROOT, '.scratch', 'mf-client', 'e2e'));
fs.mkdirSync(screens, { recursive: true });
const SLOW = Math.max(1, Number(args.slow || process.env.HH_E2E_SLOW || 1));
const KEYS_SHOTS = path.resolve(args['keys-shots'] || path.join(ROOT, '.scratch', 'keys-shots'));
fs.mkdirSync(KEYS_SHOTS, { recursive: true });
const PRIVACY_SHOTS = path.resolve(args['privacy-shots'] || path.join(ROOT, '.scratch', 'privacy-shots'));
fs.mkdirSync(PRIVACY_SHOTS, { recursive: true });
// a stand-in for api.github.com on the next port: the SERVER asks it for the star count (HH_STARS_URL)
const stubPort = Number(args['stub-port'] || port + 1);
if (stubPort === 3000 || stubPort === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
const stubHits = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-e2e-multi-'));
const BASE = `http://localhost:${port}`;
const PIXEL7 = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  viewport: { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, isLandscape: false } };
const DEVICES = { desktop: null, 'iPhone 13': KnownDevices['iPhone 13'], 'Pixel 7': PIXEL7 };

const steps = [];
const errors = [];
const files = [];
let server = null;
let serverLog = '';

function startServer() {
  serverLog = '';
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), HH_DATA_DIR: dataDir, HH_DEV: '1', HH_MODE: 'multi', HH_TZ: 'Europe/Sofia',
      HH_FARM_IDLE_MS: '4000', NODE_ENV: 'development', HH_ADMIN_TOKEN: ADMIN_TOKEN, HH_STARS_URL: `http://127.0.0.1:${stubPort}/repos/KrasimirKralev/harvest-hollow` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  return (async () => {
    for (let i = 0; i < 150 && !serverLog.includes('running at') && server.exitCode === null; i++) await sleep(100);
    if (!serverLog.includes('running at')) throw new Error(`server did not start: ${serverLog.slice(-1200)}`);
  })();
}
async function stopServer() {
  const s = server;
  server = null;
  if (!s || s.exitCode !== null) return;
  s.kill('SIGTERM');
  await new Promise((r) => s.once('exit', r));
}

function check(name, cond, detail = '') {
  steps.push({ name, ok: Boolean(cond), ...(detail ? { detail } : {}) });
  if (!cond) throw new Error(`step failed: ${name}${detail ? ` (${detail})` : ''}`);
}
const waitFor = (page, fn, arg, timeout = 30_000) => page.waitForFunction(fn, { timeout: timeout * SLOW, polling: 50 }, arg);
async function shot(page, name) {
  const file = path.join(screens, `${name}.png`);
  await page.screenshot({ path: file });
  files.push(path.relative(ROOT, file));
}
/** Every page error and console error, except the browser's own line for a refused handshake (step 8 wants one). */
const EXPECTED = /WebSocket connection to .* failed|Failed to load resource: the server responded with a status of (404|429)/;

let browser;
const pages = [];
/** Every URL a page requested (fragments never travel; the check is that no member secret rides in one). */
const requested = [];
/** Keys seen during the run (secrets, invites): none may reach the server log. */
const secrets = [];
/** Record every URL `page` requests; one to any host but the test server is an error. */
function watchRequests(page, tag) {
  page.on('request', (r) => {
    requested.push(r.url());
    if (/^(https?|wss?):/.test(r.url()) && !r.url().startsWith(BASE) && !r.url().startsWith(BASE.replace('http', 'ws'))) {
      errors.push(`${tag} asked another host: ${r.url().slice(0, 80)}`);
    }
  });
}
/**
 * Every device: a request to any host but the test server is an error (no third party sees a visitor; the star count
 * comes from this server's /api/stars, which the server asks of the stand-in below). A device made with `stars` (a
 * response: { status, body }) gets that answer for GET /api/stars instead of the server's (a server with no number, or
 * one without the route); only those intercept requests (interception turns Chrome's cache off).
 */
async function device(tag, kind, { stars = null } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (DEVICES[kind]) await page.emulate(DEVICES[kind]);
  else await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || EXPECTED.test(m.text())) return;
    errors.push(`${tag} console: ${m.text()}`);
  });
  watchRequests(page, tag);
  if (stars) {
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (r.url() === `${BASE}/api/stars`) {
        r.respond({ status: stars.status, contentType: 'application/json', body: JSON.stringify(stars.body) });
        return;
      }
      if (!r.url().startsWith(BASE) && !r.url().startsWith(BASE.replace('http', 'ws')) && !/^(data|blob):/.test(r.url())) { r.abort(); return; }
      r.continue();
    });
  }
  page.tag = tag;
  pages.push(page);
  return page;
}
/** Tap on a phone, click on a desktop. */
async function press(page, sel) {
  // the visible match (a phone keeps a hidden copy of some menu tiles); a sheet still sliding in under a loaded CPU has
  // no clickable point yet: try again a little later
  for (let i = 0; ; i++) {
    const el = await page.waitForSelector(sel, { visible: true, timeout: 30_000 * SLOW });
    try {
      if (page.viewport()?.hasTouch) await el.tap(); else await el.click();
      return;
    } catch (err) {
      if (i >= 6 || !/not clickable|not an Element|detached/i.test(String(err && err.message))) throw err;
      await sleep(500 * SLOW);
    }
  }
}
async function typeName(page, name) {
  await page.waitForSelector('#slot-picker:not([hidden]) .slot input.field', { visible: true, timeout: 40_000 * SLOW });
  await page.type('#slot-picker .slot input.field', name);
  await press(page, '#slot-picker .slot .btn');
  await waitFor(page, () => Boolean(window.__hh?.pid && window.__hh.state && window.__hh.controller), null, 40_000);
}
const farmOf = (page) => page.evaluate(() => location.pathname.split('/')[2]);
/** A screenshot for the keys review (.scratch/keys-shots). */
async function keysShot(page, name, el = null) {
  const file = path.join(KEYS_SHOTS, `${name}.png`);
  await (el ?? page).screenshot({ path: file });
  files.push(path.relative(ROOT, file));
  return file;
}
/**
 * Tap (or click) until `until` holds: on a loaded machine the gap between a synthetic touch's start and end can pass the
 * HUD's 480 ms "press to read the tip" threshold, and the game then (rightly) treats it as a long press.
 */
async function pressUntil(page, sel, until, arg = null, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      await press(page, sel);
      await waitFor(page, until, arg, 5000);
      return;
    } catch { /* read as a long press, or still sliding in ("not clickable"): again */ }
  }
  // the machine is too busy for a quick synthetic tap: the button's own click (what a quick tap ends in)
  await page.$eval(sel, (b) => b.click());
  await waitFor(page, until, arg, 10_000);
}
/** Click the visible button under `sel` whose words are `text` (true when there was one). */
const clickText = (page, sel, text) => page.evaluate((s, t) => {
  const b = [...document.querySelectorAll(s)].find((x) => x.offsetParent !== null && x.textContent.trim() === t);
  if (!b) return false;
  b.click();
  return true;
}, sel, text);
const panelOpen = (page, name) => page.evaluate((n) => Boolean(window.__hh?.ui?.panels?.isOpen(n)), name);
/** A PNG decoded by the game's own QR reader, in the page (the picture goes in as bytes, nothing leaves). */
const decodePng = (page, file) => page.evaluate(async (b64) => {
  const { readQr } = await import('/js/ui/qr-read.js');
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  return readQr(g.getImageData(0, 0, c.width, c.height));
}, fs.readFileSync(file).toString('base64'));
const gateOf = (page) => page.evaluate(() => document.querySelector('#farm-gate')?.dataset.gate ?? null);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** A new farm from the landing page, its first farmer named `name`. */
async function startFarm(page, name) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await press(page, '#ld-start');
  await page.waitForFunction(() => /^\/f\/[a-z2-7]{12}$/.test(location.pathname), { timeout: 30_000 * SLOW });
  // low tier: several WebGL pages share one CPU under SwiftShader; the rules do not care
  const url = new URL(page.url());
  url.searchParams.set('quality', 'low');
  await page.evaluate((u) => history.replaceState(null, '', u), url.pathname + url.search);
  const sub = await page.waitForFunction(() => { const p = document.getElementById('slot-picker'); return p && !p.hidden && document.getElementById('slot-sub').textContent; },
    { timeout: 40_000 * SLOW }).then((h) => h.jsonValue());
  const rows = await page.$$eval('#slot-picker .slot', (els) => els.map((e) => e.dataset.slot));
  await typeName(page, name);
  return { id: await farmOf(page), sub, rows };
}
/** The invite link, made through the HUD (desktop: the More menu) or the phone's farm menu. */
async function makeInvite(page) {
  await page.evaluate(() => window.__hh.ui.panels.closeAll?.());
  await sleep(300);
  const phone = await page.evaluate(() => { const b = document.getElementById('m-menu-btn'); return Boolean(b && b.offsetParent); });
  if (phone) {
    await pressUntil(page, '#m-menu-btn', () => window.__hh.ui.panels.isOpen('menu'));
    await sleep(700);                                  // the farm menu sheet slides up first
    await shot(page, `${page.tag.toLowerCase()}-phone-farm-menu`);
    await pressUntil(page, '.m-tile[data-invite="open"]', () => window.__hh.ui.panels.isOpen('invite'));
  } else {
    await press(page, '#hud-more');
    await press(page, '#hud-invite');
  }
  await sleep(700);                                    // the card slides in (and repaints on a players change)
  await press(page, '.invite [data-act="make"]');
  await waitFor(page, () => document.querySelector('.invite .link-field')?.value, null, 30_000);
  const link = await page.$eval('.invite .link-field', (el) => el.value);
  return link;
}
async function joinByInvite(page, link, name) {
  await page.goto(`${link}&quality=low`, { waitUntil: 'domcontentloaded' });
  const sub = await page.waitForFunction(() => { const p = document.getElementById('slot-picker'); return p && !p.hidden && document.getElementById('slot-sub').textContent; },
    { timeout: 40_000 * SLOW }).then((h) => h.jsonValue());
  await typeName(page, name);
  return sub;
}

const admin = async (url, opts = {}) => {
  const r = await fetch(BASE + url, { ...opts, headers: { authorization: `Bearer ${ADMIN_TOKEN}`, ...(opts.body ? { 'content-type': 'application/json' } : {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
/** Fill and send the ideas form under `root` (the landing page's section or the game's card); resolves the thank-you text. */
async function sendIdeaForm(page, root, { category, text, name }) {
  await page.waitForSelector(`${root} .idea-form`, { visible: true, timeout: 30_000 * SLOW });
  // a radio styled as a card: click it in the page (a synthetic tap on its hidden input misses on a loaded machine)
  await page.$eval(`${root} .idea-cat input[value="${category}"]`, (e) => e.click());
  await page.type(`${root} .idea-text`, text);
  if (name) await page.type(`${root} input[name="name"]`, name);
  await press(page, `${root} .idea-send`);
  await waitFor(page, (r) => { const d = document.querySelector(`${r} .idea-done`); return d && !d.hidden; }, root);
  return page.$eval(`${root} .idea-done`, (e) => e.innerText);
}
const day = (offset) => { const d = new Date(Date.now() + offset * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const starMemo = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('hh.starNudge') || 'null'));
const starCard = (page) => page.evaluate(() => Boolean(document.querySelector('.unlock-banner[data-kind="star"]:not(.leaving)')));
/** A happy moment on farm 1: sell one Wheat (Rowan's own sale). */
const sellWheat = (page) => page.evaluate(() => window.__hh.act('sell', { item: 'wheat', qty: 1 }).ok);

const stub = http.createServer((req, res) => {
  stubHits.push({ url: req.url, ua: req.headers['user-agent'] ?? '', xff: req.headers['x-forwarded-for'] ?? null, cookie: req.headers.cookie ?? null,
    referer: req.headers.referer ?? null });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ stargazers_count: GITHUB_STARS }));
});

try {
  await new Promise((resolve, reject) => { stub.once('error', reject); stub.listen(stubPort, '127.0.0.1', resolve); });
  await startServer();
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800', '--mute-audio',
      '--autoplay-policy=no-user-gesture-required'],
  });

  // 1. the landing page -------------------------------------------------------------------------------------------
  const K = await device('Rowan', 'desktop');
  await K.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  const land = await K.evaluate(() => ({ title: document.title, play: document.getElementById('ld-start')?.innerText,
    ttl: document.getElementById('ld-ttl')?.textContent, repo: document.getElementById('ld-repo')?.href, farms: document.getElementById('ld-farms').hidden }));
  check('landing: Play (start a new farm), the 7-day line, the repo link', /Play/.test(land.play) && /Start a new farm/.test(land.play)
    && /7 days/.test(land.ttl) && /github\.com/.test(land.repo) && land.farms === true, JSON.stringify(land));
  check('landing: no sideways scroll on a desktop', await noSideScroll(K));
  const sections = await K.evaluate(() => ({ acts: [...document.querySelectorAll('#ld-dock .ld-act')].map((a) => a.id),
    star: document.getElementById('ld-star-btn')?.href, host: document.getElementById('ld-host')?.href,
    privacy: document.getElementById('ld-privacy')?.getAttribute('href'),
    oneScreen: document.documentElement.scrollHeight <= innerHeight + 1, dockSeen: document.getElementById('ld-dock').getBoundingClientRect().bottom <= innerHeight,
    gone: !document.querySelector('.ld-feat, .ld-step, #ld-shots, .ld-peek, .ld-star-card'), sheets: [...document.querySelectorAll('dialog.ld-sheet')].filter((d) => d.open).length,
    orb: Boolean(document.querySelector('#ld-orb .ld-orb-still')), motes: document.querySelectorAll('.ld-motes i').length }));
  check('landing: one screen: Play, Star us, Open GitHub; the self-host and privacy links; the orb and its fireflies; no long sections',
    sections.acts.join() === 'ld-start,ld-star-btn,ld-repo' && /github\.com\/[^/]+\/harvest-hollow$/.test(sections.star) && /#quick-start$/.test(sections.host)
    && sections.privacy === '/privacy' && sections.oneScreen && sections.dockSeen && sections.gone && sections.sheets === 0 && sections.orb && sections.motes >= 10,
    JSON.stringify(sections));
  await waitFor(K, () => Boolean(document.querySelector('#ld-orb-view video.is-on')), null, 30_000);
  check('landing: the living farm plays in the orb once the page has painted (a muted looping video over the still)',
    await K.evaluate(() => { const v = document.querySelector('#ld-orb-view video'); return v.muted && v.loop && !v.paused && v.currentSrc.includes('/assets/landing/farm-orbit.'); }));
  await press(K, '#ld-back-open');
  await waitFor(K, () => document.getElementById('ld-sheet-back').open && Boolean(document.querySelector('#ld-back input.gate-link')));
  check('landing: "Already have a farm?" opens the way back in a sheet (paste or scan)', await K.evaluate(() => /Paste your personal link/.test(document.getElementById('ld-back').innerText)));
  await K.keyboard.press('Escape');
  await waitFor(K, () => !document.getElementById('ld-sheet-back').open && document.activeElement?.id === 'ld-back-open');
  await shot(K, '01-landing-desktop');
  const SD = await device('Star desktop', 'desktop');
  await SD.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await waitFor(SD, () => !document.getElementById('ld-star-n').hidden, null, 15_000);
  const count = await SD.evaluate(() => ({ text: document.getElementById('ld-star-btn').innerText, said: document.querySelector('#ld-star-btn .sr-only')?.textContent }));
  check('landing: the Star button shows the live count from this server (/api/stars), nothing kept on the device', /321/.test(count.text)
    && /321 stars/.test(count.said ?? '') && requested.includes(`${BASE}/api/stars`)
    && (await SD.evaluate(() => sessionStorage.getItem('hh.stars') === null && localStorage.getItem('hh.stars') === null)), JSON.stringify(count));
  await shot(SD, '01-landing-star-desktop');
  await SD.close();
  const phoneLanding = await device('Phone visitor', 'iPhone 13');
  await phoneLanding.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  check('landing: no sideways scroll on an iPhone 13', await noSideScroll(phoneLanding));
  check('landing: Play, Star us, Open GitHub and the 7-day line in the first screen of an iPhone 13', await phoneLanding.evaluate(() => (
    ['ld-start', 'ld-star-btn', 'ld-repo', 'ld-ttl'].every((id) => document.getElementById(id).getBoundingClientRect().bottom <= innerHeight))));
  await shot(phoneLanding, '01-landing-iphone13');
  await waitFor(phoneLanding, () => !document.getElementById('ld-star-n').hidden, null, 15_000);
  check('landing: GitHub was asked once, by the server, for every visitor (the hour\'s cache), with nothing of a visitor in the request',
    stubHits.length === 1 && stubHits[0].url === '/repos/KrasimirKralev/harvest-hollow' && /^harvest-hollow-server/.test(stubHits[0].ua)
    && !stubHits[0].xff && !stubHits[0].cookie && !stubHits[0].referer, JSON.stringify(stubHits));
  await press(phoneLanding, '#ld-ideas-open');
  await waitFor(phoneLanding, () => document.getElementById('ld-sheet-ideas').open && Boolean(document.querySelector('#ld-sheet-ideas .idea-form')));
  const smallPrint = await phoneLanding.$eval('#ld-sheet-ideas .idea-hint', (e) => ({ text: e.innerText, href: e.querySelector('a')?.getAttribute('href'),
    target: e.querySelector('a')?.getAttribute('target') }));
  check('landing: the ideas sheet\'s small print: "Optional: we only use it to reply to you · Privacy" (/privacy, a new tab)',
    /Optional: we only use it to reply to you/.test(smallPrint.text) && /Privacy/.test(smallPrint.text) && smallPrint.href === '/privacy'
    && smallPrint.target === '_blank', JSON.stringify(smallPrint));
  const thanks = await sendIdeaForm(phoneLanding, '#ld-sheet-ideas', { category: 'content', text: 'A duck pond by the river, with ducklings that follow you.', name: 'Visitor' });
  check('landing: "Suggest an idea" opens the form in a sheet; a phone sends an idea and is thanked', /Thank you/.test(thanks), thanks);
  await shot(phoneLanding, '01-landing-idea-sent-iphone13');
  check('landing: still no sideways scroll with the sheet open', await noSideScroll(phoneLanding));
  await press(phoneLanding, '#ld-sheet-ideas [data-close]');
  await waitFor(phoneLanding, () => !document.getElementById('ld-sheet-ideas').open);
  check('landing: the sheet closes and focus goes back to "Suggest an idea"', await phoneLanding.evaluate(() => document.activeElement?.id === 'ld-ideas-open'));
  await phoneLanding.close();
  // no number: the server has none yet (GitHub refused it: test/server.privacy.test.js), or a server without the route
  for (const [why, stars] of [['the server has no number ({ stars: null })', { status: 200, body: { stars: null } }],
    ['a server without /api/stars (404)', { status: 404, body: { error: 'NOT_FOUND' } }]]) {
    const none = await device('No star count', 'iPhone 13', { stars });
    await none.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const quiet = await none.evaluate(() => ({ hidden: document.getElementById('ld-star-n').hidden, text: document.getElementById('ld-star-btn').innerText,
      asked: performance.getEntriesByType('resource').some((e) => e.name.endsWith('/api/stars')) }));
    check(`landing: ${why}: the Star button simply shows no number`, quiet.asked && quiet.hidden && /Star us/.test(quiet.text) && !/\d/.test(quiet.text),
      JSON.stringify(quiet));
    await none.close();
  }

  // 2. farm 1: Rowan starts it, the first run, he plays ---------------------------------------------------------------
  const f1 = await startFarm(K, 'Rowan');
  check('farm 1: the creator is offered farmer 1 only, with a new-farm welcome', f1.rows.join() === 'p1' && /new farm/i.test(f1.sub), JSON.stringify(f1));
  const kStore = await K.evaluate((id) => ({ url: location.href, pid: window.__hh.pid, tokens: localStorage.getItem(`hh.f.${id}.tokens`),
    key: localStorage.getItem(`hh.f.${id}.key`), global: localStorage.getItem('hh.tokens'), farms: JSON.parse(localStorage.getItem('hh.farms') || '[]') }), f1.id);
  check('farm 1: Rowan is p1; his token lives under the farm, the creator key is used up, no secret in the address',
    kStore.pid === 'p1' && /"p1":"[0-9a-f]{64}"/.test(kStore.tokens || '') && kStore.key === null && kStore.global === null
    && !/#k=|[0-9a-f]{32}/.test(kStore.url) && kStore.farms.some((f) => f.id === f1.id), JSON.stringify({ ...kStore, tokens: kStore.tokens ? 'set' : null }));
  const rowanSecret = JSON.parse(kStore.tokens).p1;
  secrets.push(rowanSecret);
  await waitFor(K, () => Boolean(document.querySelector('#coach-slot .coach')), null, 30_000);
  check('farm 1: the first-run flow starts (Grandma Hazel\'s first guide)', true);
  await shot(K, '02-farm1-rowan-first-run-desktop');
  const plot = await K.evaluate(() => Object.entries(window.__hh.state.farm.objects).find(([, o]) => o.def === 'plot' && !o.crop)?.[0]);
  const planted = await K.evaluate((id) => window.__hh.act('plant', { id, crop: 'wheat' }).ok, plot);
  await waitFor(K, (id) => Boolean(window.__hh.state.farm.objects[id]?.crop) && window.__hh.pending === 0, plot);
  check('farm 1: Rowan plants Wheat and the server confirms it', planted);
  await shot(K, '03-farm1-rowan-plays');

  // 3. invite Mia (iPhone 13), both play in real time ------------------------------------------------------------------
  const link1 = await makeInvite(K);
  check('the invite link is /f/<id>?join=<token>', new RegExp(`^${BASE}/f/${f1.id}\\?join=[0-9a-f]{32}$`).test(link1), link1.replace(/join=.*/, 'join=…'));
  secrets.push(new URL(link1).searchParams.get('join'));
  await shot(K, '04-farm1-invite-card-desktop');
  await K.evaluate(() => window.__hh.ui.panels.closeAll?.());
  const M = await device('Mia', 'iPhone 13');
  const mSub = await joinByInvite(M, link1, 'Mia');
  check('Mia\'s picker says she is invited', /invited you|You are invited/.test(mSub), mSub);
  check('Mia is p2 on farm 1 and the invite left her address bar', (await M.evaluate(() => window.__hh.pid)) === 'p2'
    && (await farmOf(M)) === f1.id && !(await M.evaluate(() => location.search.includes('join'))));
  await waitFor(K, () => Object.keys(window.__hh.state.players).length === 2);
  await waitFor(M, () => Object.keys(window.__hh.state.players).length === 2);
  const miaOld = await M.evaluate((id) => JSON.parse(localStorage.getItem(`hh.f.${id}.tokens`)).p2, f1.id);
  secrets.push(miaOld);
  await waitFor(M, (id) => Boolean(window.__hh.state.farm.objects[id]?.crop), plot);
  check('Mia sees the Wheat Rowan planted before she came', true);
  const plot2 = await M.evaluate(() => Object.entries(window.__hh.state.farm.objects).find(([, o]) => o.def === 'plot' && !o.crop)?.[0]);
  const t0 = Date.now();
  await M.evaluate((id) => window.__hh.act('plant', { id, crop: 'wheat' }), plot2);
  await waitFor(K, (id) => Boolean(window.__hh.state.farm.objects[id]?.crop), plot2);
  check('real time: Mia\'s plant appears on Rowan\'s screen', true, `${Date.now() - t0} ms (SwiftShader: not a measurement)`);
  await K.evaluate(() => { window.__hh.avatar.place(24.5, 30.5); window.__hh.avatar.flush?.(); });
  await waitFor(M, () => { const p = window.__hh.view.partner.pose('p1'); return p && Math.abs(p.x - 24.5) < 0.2 && Math.abs(p.z - 30.5) < 0.2; });
  check('real time: Rowan walks and Mia sees him where he stands', true);
  await sleep(800);
  await shot(M, '05-farm1-mia-joined-iphone13');
  await shot(K, '05-farm1-rowan-sees-mia-desktop');

  // 4. the invite is spent ---------------------------------------------------------------------------------------------
  const spent = await (await fetch(`${BASE}/api/f/${f1.id}/status?join=${new URL(link1).searchParams.get('join')}`)).json();
  check('the used invite is spent (the farm\'s status says so)', spent.invite === 'full' && spent.full === true, JSON.stringify(spent));
  const U = await device('Used invite', 'iPhone 13');
  await U.goto(`${link1}&quality=low`, { waitUntil: 'domcontentloaded' });
  await waitFor(U, () => document.querySelector('#farm-gate')?.dataset.gate);
  const usedKind = await U.evaluate(() => document.querySelector('#farm-gate').dataset.gate);
  check('a third phone opening the used invite hears the farm has two farmers', usedKind === 'full', usedKind);
  await shot(U, '06-gate-invite-spent-iphone13');
  await U.close();
  const fullInvite = await K.evaluate(async () => {
    window.__hh.ui.panels.open('invite');
    await new Promise((r) => setTimeout(r, 300));
    return document.querySelector('.invite')?.textContent ?? '';
  });
  check('a full farm\'s invite card says the farm has two farmers', /two farmers/.test(fullInvite), fullInvite.slice(0, 120));
  await shot(K, '06-farm1-invite-card-full-desktop');
  await K.evaluate(() => window.__hh.ui.panels.closeAll?.());

  // 4b. Keep your farm safe ---------------------------------------------------------------------------------------------
  await K.setViewport({ width: 1366, height: 768 });
  await K.browserContext().overridePermissions(BASE, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  // Linux Chrome has no share sheet: a stand-in records what the page hands to one (a phone shows the real sheet)
  const fakeShare = (page) => page.evaluate(() => { window.__shared = []; navigator.share = async (d) => { window.__shared.push(d); }; });
  await fakeShare(K);
  check('keep: no card at load; the quiet "not saved yet" dot is on', !(await panelOpen(K, 'keep'))
    && (await K.evaluate(() => document.documentElement.dataset.keep)) === 'unsaved');
  await pressUntil(K, '#hud-more', () => !document.querySelector('.edge-menu').hidden);
  await sleep(300);
  await keysShot(K, 'dot-more-menu-desktop');
  await press(K, '#hud-more');
  // the welcome card's "Let's go!" is the first load itself: no card for it
  if (!(await clickText(K, '#coach-slot .coach button', 'Let\'s go!'))) await K.evaluate(() => window.__hh.controller.do('tutDone', { step: 'welcome' }));
  await sleep(2500);
  check('keep: not after the welcome card ("Let\'s go!")', !(await panelOpen(K, 'keep')));
  // the first guide step with a deed: naming the farm, on Grandma's naming card
  try { await waitFor(K, () => window.__hh.ui.panels.isOpen('naming'), null, 8000); } catch { await K.evaluate(() => window.__hh.ui.nameFarm()); }
  await K.waitForSelector('#panel-naming input.field', { visible: true, timeout: 20_000 * SLOW });
  await K.click('#panel-naming input.field', { count: 3 });
  await K.type('#panel-naming input.field', 'Sunny Acres');
  await clickText(K, '#panel-naming button', 'Carve it!');
  await waitFor(K, () => window.__hh.state.farm.name === 'Sunny Acres', null, 20_000);
  await waitFor(K, () => window.__hh.ui.panels.isOpen('keep'), null, 30_000);
  check('keep: the card shows after the first finished guide step (the farm named)', true);
  await sleep(500);
  await keysShot(K, 'keep-card-desktop');
  const personalK = `${BASE}/f/${f1.id}#k=${rowanSecret}`;
  await press(K, '[data-keep="share"]');
  const shared = await K.evaluate(() => window.__shared);
  check('keep: "Share to myself" hands the personal link to the share sheet, the key only in the url',
    shared.length === 1 && shared[0].url === personalK && !shared[0].text.includes(rowanSecret) && /private/.test(shared[0].text));
  await press(K, '[data-keep="copy"]');
  await waitFor(K, () => /Copied/.test(document.querySelector('.keep .link-status')?.textContent ?? ''), null, 10_000);
  const copied = await K.evaluate(() => navigator.clipboard.readText().catch(() => null));
  check('keep: Copy puts the personal link on the clipboard', copied === personalK, copied ? 'a different text' : 'no clipboard');
  await press(K, '[data-keep="qr"]');
  const qrEl = await K.waitForSelector('.keep-qr svg.qr', { visible: true });
  await sleep(300);
  await keysShot(K, 'keep-card-qr-desktop');
  const qrK = await keysShot(K, 'qr-rowan-desktop', qrEl);
  check('keep: the QR code reads back as the personal link (the game\'s reader, on the rendered picture)', (await decodePng(K, qrK)) === personalK);
  const persisted = await K.evaluate(() => navigator.storage.persisted());
  check('keep: persistent storage was asked for (Chrome answers by its own rules)', typeof persisted === 'boolean', `persisted ${persisted}`);
  // the QR picture on a fresh phone: the private gate's "Use a photo of it" opens the farm as Rowan
  const QP = await device('Rowan phone by QR', 'iPhone 13');
  await QP.goto(`${BASE}/f/${f1.id}?quality=low`, { waitUntil: 'domcontentloaded' });
  await waitFor(QP, () => document.querySelector('#farm-gate')?.dataset.gate);
  const qpGate = await QP.evaluate(() => ({ kind: document.querySelector('#farm-gate').dataset.gate, text: document.querySelector('#farm-gate').innerText }));
  check('a fresh phone without a key: the private gate shows the way back (ask your partner, paste, a photo of the QR code)',
    qpGate.kind === 'private' && /Ask your partner for a new key/.test(qpGate.text) && /Use a photo of it/.test(qpGate.text) && /Paste your personal link/.test(qpGate.text), qpGate.text.slice(0, 160));
  await keysShot(QP, 'gate-private-ways-back-iphone13');
  const fileInput = await QP.$('#farm-gate input.gate-file');
  await fileInput.uploadFile(qrK);
  await waitFor(QP, () => Boolean(window.__hh?.pid && window.__hh.controller), null, 60_000);
  const qpState = await QP.evaluate(() => ({ pid: window.__hh.pid, hash: location.hash }));
  check('the QR code\'s photo opens the farm as Rowan on a fresh phone; the key leaves the address bar', qpState.pid === 'p1' && !qpState.hash.includes('k='), JSON.stringify(qpState));
  await sleep(500);
  await keysShot(QP, 'qr-photo-opened-farm-iphone13');
  await QP.close();
  await K.bringToFront();
  await press(K, '[data-keep="saved"]');
  await waitFor(K, () => !window.__hh.ui.panels.isOpen('keep') && document.documentElement.dataset.keep === 'saved', null, 10_000);
  check('keep: "I saved it" closes the card and the dot goes', true);
  // Mia on her iPhone: the card from Settings > Farm, its QR code, the dot on the farm menu's Settings
  await fakeShare(M);
  await M.bringToFront();
  await pressUntil(M, '#m-menu-btn', () => window.__hh.ui.panels.isOpen('menu'));
  await sleep(700);
  await keysShot(M, 'dot-farm-menu-iphone13');
  await M.evaluate(() => { window.__hh.ui.panels.closeAll?.(); window.__hh.ui.panels.open('settings', { tab: 'farm' }); });
  await M.waitForSelector('.set-keep [data-keep-open]', { visible: true, timeout: 20_000 * SLOW });
  await M.$eval('.set-keep', (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await keysShot(M, 'settings-keep-row-iphone13');
  await press(M, '.set-keep [data-keep-open]');
  await waitFor(M, () => window.__hh.ui.panels.isOpen('keep'), null, 10_000);
  await sleep(600);
  await keysShot(M, 'keep-card-iphone13');
  await press(M, '[data-keep="qr"]');
  const qrMel = await M.waitForSelector('.keep-qr svg.qr', { visible: true });
  await M.$eval('.keep-qr', (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(400);
  await keysShot(M, 'keep-card-qr-iphone13');
  const qrM = await keysShot(M, 'qr-mia-iphone13', qrMel);
  check('Mia\'s QR code (iPhone 13) reads back as her personal link', (await decodePng(M, qrM)) === `${BASE}/f/${f1.id}#k=${miaOld}`);
  await press(M, '[data-keep="later"]');
  await waitFor(M, () => !window.__hh.ui.panels.isOpen('keep') && document.documentElement.dataset.keep === 'unsaved', null, 10_000);
  check('Mia\'s "Later": the dot stays until she saves it', true);
  await K.bringToFront();

  // 5. farm 2 at the same time, made on a phone -------------------------------------------------------------------------
  const D = await device('Dana', 'iPhone 13');
  const f2 = await startFarm(D, 'Dana');
  check('farm 2 is another farm, started on an iPhone 13', f2.id !== f1.id && f2.rows.join() === 'p1');
  secrets.push(await D.evaluate((id) => JSON.parse(localStorage.getItem(`hh.f.${id}.tokens`)).p1, f2.id));
  const link2 = await makeInvite(D);
  check('Dana makes the invite from the phone menu', new RegExp(`/f/${f2.id}\\?join=[0-9a-f]{32}$`).test(link2));
  secrets.push(new URL(link2).searchParams.get('join'));
  await shot(D, '07-farm2-invite-card-iphone13');
  await D.evaluate(() => window.__hh.ui.panels.closeAll?.());
  const L = await device('Leo', 'Pixel 7');
  await joinByInvite(L, link2, 'Leo');
  check('Leo is p2 on farm 2', (await L.evaluate(() => window.__hh.pid)) === 'p2' && (await farmOf(L)) === f2.id);
  await waitFor(D, () => Object.keys(window.__hh.state.players).length === 2);
  await shot(L, '07-farm2-leo-joined-pixel7');
  await D.evaluate(() => window.__hh.ui.panels.closeAll?.());
  await sleep(300);
  // the farm menu (a partner's arrival can repaint it mid-slide under a loaded CPU: open it again if it closed)
  await press(D, '#m-menu-btn');
  await D.waitForSelector('.m-tile[data-ideas="open"]', { visible: true, timeout: 5000 * SLOW })
    .catch(() => D.evaluate(() => window.__hh.ui.panels.open('menu')));
  await sleep(700);
  await press(D, '.m-tile[data-ideas="open"]');
  await waitFor(D, () => document.querySelector('.ideas-card .idea-form') && window.__hh.ui.panels.top() === 'ideas');
  check('Dana\'s phone farm menu has "Ideas", and it opens the in-game ideas card', true);
  check('the ideas card fits the phone (no sideways scroll)', await noSideScroll(D));
  await sleep(500);
  await shot(D, '07-farm2-ideas-card-iphone13');
  await D.evaluate(() => window.__hh.ui.panels.closeAll?.());

  // 6. isolation ------------------------------------------------------------------------------------------------------
  const f2plots = await D.evaluate(() => Object.values(window.__hh.state.farm.objects).filter((o) => o.def === 'plot' && o.crop).length);
  check('the plants on farm 1 never reach farm 2', f2plots === 0, `farm 2 planted plots ${f2plots}`);
  await D.evaluate(() => window.__hh.net.raw({ t: 'chat', text: 'hello from farm two' }));
  await sleep(1500);
  const leaks = await Promise.all([K, M].map((p) => p.evaluate(() => document.body.textContent.includes('hello from farm two'))));
  check('a chat line on farm 2 never shows on farm 1', leaks.every((x) => !x));
  const names = await Promise.all([K, D].map((p) => p.evaluate(() => Object.values(window.__hh.state.players).map((x) => x.name).sort().join())));
  check('each farm holds its own two farmers', names[0] === 'Rowan,Mia' && names[1] === 'Dana,Leo', names.join(' | '));

  // 7. private farm ----------------------------------------------------------------------------------------------------
  for (const [tag, kind] of [['Stranger phone', 'iPhone 13'], ['Stranger desktop', 'desktop']]) {
    const S = await device(tag, kind);
    await S.goto(`${BASE}/f/${f1.id}`, { waitUntil: 'domcontentloaded' });
    await waitFor(S, () => document.querySelector('#farm-gate')?.dataset.gate);
    const g = await S.evaluate(() => ({ kind: document.querySelector('#farm-gate').dataset.gate, title: document.getElementById('farm-gate-title').textContent,
      picker: !document.getElementById('slot-picker').hidden, state: Boolean(window.__hh?.state), hud: !document.getElementById('hud').hidden,
      text: document.body.innerText }));
    check(`${tag}: a farm link without an invite shows the private gate and nothing of the farm`, g.kind === 'private'
      && /private/.test(g.title) && !g.picker && !g.state && !g.hud && !/Rowan|Mia/.test(g.text), JSON.stringify({ ...g, text: g.text.slice(0, 80) }));
    check(`${tag}: no sideways scroll on the gate`, await noSideScroll(S));
    await shot(S, `08-gate-private-${kind === 'desktop' ? 'desktop' : 'iphone13'}`);
    await S.close();
  }

  // 8. the personal link, an unknown farm ------------------------------------------------------------------------------
  await K.evaluate(() => window.__hh.ui.panels.open('settings', { tab: 'farm' }));
  await K.waitForSelector('.set-personal [data-act="show"]', { visible: true });
  const settingsText = await K.evaluate(() => document.querySelector('.settings').innerText);
  check('Settings > Farm: the personal link and the 7-day line', /personal farm link/i.test(settingsText) && /after 7 days without a visit it is deleted/.test(settingsText));
  check('Settings > Farm: "Suggest an idea"', /Ideas for the game/.test(settingsText) && Boolean(await K.$('.settings [data-ideas="open"]')));
  await shot(K, '09-settings-farm-desktop');
  await press(K, '.set-personal [data-act="show"]');
  const personal = await K.$eval('.set-personal .link-field', (el) => el.value);
  check('the personal link is /f/<id>#k=<secret>', new RegExp(`^${BASE}/f/${f1.id}#k=[0-9a-f]{64}$`).test(personal), personal.replace(/#k=.*/, '#k=…'));
  await press(K, '.set-personal [data-act="show"]');
  await K.evaluate(() => window.__hh.ui.panels.closeAll?.());
  const N = await device('Rowan new phone', 'iPhone 13');
  await N.goto(`${personal.replace('#', '?quality=low#')}`, { waitUntil: 'domcontentloaded' });
  await waitFor(N, () => Boolean(window.__hh?.pid && window.__hh.controller), null, 40_000);
  const nState = await N.evaluate(() => ({ pid: window.__hh.pid, hash: location.hash, picker: !document.getElementById('slot-picker').hidden }));
  check('the personal link opens the farm as Rowan in a fresh browser profile, the key wiped from the address', nState.pid === 'p1' && !nState.hash.includes('k='), JSON.stringify(nState));
  await sleep(800);
  await shot(N, '10-personal-link-new-device-iphone13');
  await N.close();
  const X = await device('Unknown farm', 'desktop');
  await X.goto(`${BASE}/f/zzzzzzzzzzzz`, { waitUntil: 'domcontentloaded' });
  await waitFor(X, () => document.querySelector('#farm-gate')?.dataset.gate, null, 30_000);
  check('an unknown farm shows the private gate (no "gone": this device never played there)', (await X.evaluate(() => document.querySelector('#farm-gate').dataset.gate)) === 'private');
  await X.close();

  // 9. reloads and the landing page's list -----------------------------------------------------------------------------
  for (const [p, pid] of [[K, 'p1'], [M, 'p2'], [L, 'p2']]) {
    await p.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(p, () => Boolean(window.__hh?.pid && window.__hh.controller), null, 40_000);
    check(`${p.tag} reloads as ${pid}`, (await p.evaluate(() => window.__hh.pid)) === pid);
  }
  await K.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  const listed = await K.evaluate(() => [...document.querySelectorAll('#ld-list .ld-open')].map((a) => a.getAttribute('href')));
  check('the landing page lists farm 1 on Rowan\'s device', listed.includes(`/f/${f1.id}`), listed.join());
  await shot(K, '11-landing-your-farms-desktop');
  await K.goto(`${BASE}/f/${f1.id}?quality=low`, { waitUntil: 'domcontentloaded' });
  await waitFor(K, () => Boolean(window.__hh?.pid && window.__hh.controller), null, 40_000);

  // 9b. an idea from inside the farm, the admin list, a status change -------------------------------------------------
  await K.evaluate(() => window.__hh.ui.panels.closeAll?.());
  await press(K, '#hud-more');
  await press(K, '#hud-ideas');
  const gameThanks = await sendIdeaForm(K, '.ideas-card', { category: 'feature', text: 'A rainy-day mode where the crops grow a little faster.' });
  check('the More menu\'s "Suggest an idea" sends an idea from inside farm 1', /Thank you/.test(gameThanks), gameThanks);
  await shot(K, '09b-ideas-sent-in-game-desktop');
  await K.evaluate(() => window.__hh.ui.panels.closeAll?.());
  const unauth = await fetch(`${BASE}/api/admin/ideas`);
  const wrong = await fetch(`${BASE}/api/admin/ideas`, { headers: { authorization: 'Bearer not-the-token-not-the-token' } });
  check('the admin list wants the token (401 without, 403 with a wrong one)', unauth.status === 401 && wrong.status === 403, `${unauth.status} ${wrong.status}`);
  const list = await admin('/api/admin/ideas');
  const landingIdea = list.body?.ideas?.find((i) => /duck pond/.test(i.text));
  const farmIdea = list.body?.ideas?.find((i) => /rainy-day/.test(i.text));
  check('the admin list has both ideas: the landing one (no farm, Safari on iOS) and the in-game one (farm 1)',
    list.status === 200 && landingIdea && farmIdea && landingIdea.farm === null && landingIdea.ua === 'Safari on iOS' && landingIdea.name === 'Visitor'
    && landingIdea.category === 'content' && farmIdea.farm === f1.id && farmIdea.category === 'feature' && /^Chrome/.test(farmIdea.ua ?? '')
    && list.body.ideas.every((i) => i.status === 'new'), JSON.stringify(list.body?.ideas?.map(({ text, ...i }) => i)));
  const liked = await admin(`/api/admin/ideas/${landingIdea.id}`, { method: 'POST', body: JSON.stringify({ status: 'liked', note: 'Ducks: yes.' }) });
  const fresh = await admin('/api/admin/ideas?status=new');
  check('a status change takes the idea out of "new" (the status log)', liked.status === 200 && liked.body.idea.status === 'liked'
    && !fresh.body.ideas.some((i) => i.id === landingIdea.id) && fresh.body.ideas.some((i) => i.id === farmIdea.id)
    && fs.readFileSync(path.join(dataDir, 'ideas', 'status.jsonl'), 'utf8').includes(landingIdea.id));
  const disk = fs.readFileSync(path.join(dataDir, 'ideas', 'ideas.jsonl'), 'utf8');
  check('the ideas live on the data volume, with no address on them', disk.split('\n').filter(Boolean).length === 2 && !/127\.0\.0\.1|::1|AppleWebKit/.test(disk));

  // 9c. the GitHub star card -----------------------------------------------------------------------------------------
  // Rowan puts the first-run guide away ("I know farming") and this is his device's third day of play
  await K.evaluate(() => window.__hh.act('tutSkip', { all: 'yes' }));
  await waitFor(K, () => window.__hh.pending === 0 && !document.querySelector('#coach-slot .coach'), null, 20_000);
  await K.evaluate((days) => localStorage.setItem('hh.starNudge', JSON.stringify({ days, shown: 0, at: 0, answer: null })), [day(-2), day(-1)]);
  await K.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(K, () => Boolean(window.__hh?.pid && window.__hh.controller && window.__hh.state), null, 40_000);
  await waitFor(K, () => JSON.parse(localStorage.getItem('hh.starNudge') || '{}').days?.length === 3);
  check('no star card at the welcome itself (it waits for a happy moment)', !(await starCard(K)));
  // the happy moment: the Wheat from step 2 is ripe (a little time warp), Rowan harvests both plots
  await K.evaluate(() => window.__hh.dev.warp(15 * 60_000));
  await sleep(500);
  await K.evaluate((ids) => ids.forEach((id) => window.__hh.act('harvest', { id })), [plot, plot2]);
  // ...and sows them again: the lost-key steps after this one look for that Wheat on both plots
  await K.evaluate((ids) => ids.forEach((id) => window.__hh.act('plant', { id, crop: 'wheat' })), [plot, plot2]);
  await waitFor(K, () => Boolean(document.querySelector('.unlock-banner[data-kind="star"]')), null, 20_000);
  const card = await K.evaluate(() => document.querySelector('.unlock-banner[data-kind="star"]').innerText);
  check('after a harvest on the third play day: "Enjoying Harvest Hollow?" with Star it / Maybe later / Don\'t ask again',
    /Enjoying Harvest Hollow\?/.test(card) && /helps other couples find it/.test(card) && /Star it/.test(card) && /Maybe later/.test(card) && /Don't ask again/.test(card), card);
  await sleep(600);
  await shot(K, '09c-star-card-desktop');
  await K.evaluate(() => [...document.querySelectorAll('.unlock-banner[data-kind="star"] .acts .btn')].find((b) => /Maybe later/.test(b.textContent)).click());
  const m1 = await starMemo(K);
  check('"Maybe later" is remembered on this device (shown once)', m1.shown === 1 && m1.answer === 'later', JSON.stringify(m1));
  check('Rowan has Wheat to sell (the next happy moments)', (await K.evaluate(() => window.__hh.state.farm.inventory.wheat ?? 0)) >= 3);
  await sellWheat(K);
  await sleep(7000 * Math.min(SLOW, 2));
  check('a happy moment the same day: no card (3 days must pass)', !(await starCard(K)));
  // 3 days on: it may come once more, but not while a panel is open
  await K.evaluate(() => { const m = JSON.parse(localStorage.getItem('hh.starNudge')); m.at -= 4 * 86_400_000; localStorage.setItem('hh.starNudge', JSON.stringify(m)); });
  await K.evaluate(() => window.__hh.ui.panels.open('settings'));
  await sellWheat(K);
  await sleep(7000 * Math.min(SLOW, 2));
  check('never while a panel is open', !(await starCard(K)));
  await K.evaluate(() => window.__hh.ui.panels.closeAll());
  await waitFor(K, () => Boolean(document.querySelector('.unlock-banner[data-kind="star"]')), null, 10_000);
  check('the panel closed: the card comes the second (and last) time', (await starMemo(K)).shown === 2);
  await K.evaluate(() => [...document.querySelectorAll('.unlock-banner[data-kind="star"] .acts .btn')].find((b) => /Don't ask again/.test(b.textContent)).click());
  const m2 = await starMemo(K);
  await K.evaluate(() => { const m = JSON.parse(localStorage.getItem('hh.starNudge')); m.at -= 30 * 86_400_000; localStorage.setItem('hh.starNudge', JSON.stringify(m)); });
  await sellWheat(K);
  await sleep(7000 * Math.min(SLOW, 2));
  check('"Don\'t ask again" ends it for good (two showings at most)', m2.answer === 'never' && m2.shown === 2 && !(await starCard(K)), JSON.stringify(m2));

  // 9b. the home-screen manifest per platform ----------------------------------------------------------------------------
  const appManifest = async (page) => {
    const cdp = await page.target().createCDPSession();
    try { return await cdp.send('Page.getAppManifest'); } finally { await cdp.detach().catch(() => {}); }
  };
  await waitFor(M, () => (document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? '').startsWith('data:'), null, 20_000);
  const iosHref = await M.evaluate(() => document.querySelector('link[rel="manifest"]').getAttribute('href'));
  const iosStart = JSON.parse(decodeURIComponent(iosHref.slice(iosHref.indexOf(',') + 1))).start_url;
  const iosCdp = await appManifest(M);
  const iosText = JSON.stringify(iosCdp);
  check('iPhone: the home-screen manifest is built on the page; its start URL is this farm with the key in the fragment (Chrome parses it)',
    iosStart === `${BASE}/f/${f1.id}#k=${miaOld}` && iosText.includes(`/f/${f1.id}#k=`) && !(iosCdp.errors ?? []).some((e) => e.critical),
    `errors ${JSON.stringify(iosCdp.errors ?? [])}`);
  const andHref = await L.evaluate(() => document.querySelector('link[rel="manifest"]').getAttribute('href'));
  const andCdp = await appManifest(L);
  const andText = JSON.stringify(andCdp);
  check('Android: the keyless per-farm manifest from the server (Chrome installs from it; the app shares the browser\'s storage)',
    andHref === `/f/${f2.id}/manifest.webmanifest` && andText.includes(`/f/${f2.id}`) && !andText.includes('#k=') && !(andCdp.errors ?? []).some((e) => e.critical),
    `${andHref} errors ${JSON.stringify(andCdp.errors ?? [])}`);

  // 9c. Mia loses her phone: Rowan makes her a new key ---------------------------------------------------------------------
  const keepFields = (p) => JSON.stringify(['name', 'color', 'xp', 'hearts', 'avatar', 'stats', 'joinedAt'].map((k) => p[k] ?? null));
  const miaBefore = keepFields(await K.evaluate(() => window.__hh.state.players.p2));
  await K.setViewport({ width: 1366, height: 768 });
  await K.bringToFront();
  await K.evaluate(() => { window.__hh.ui.panels.closeAll?.(); window.__hh.ui.panels.open('invite'); });
  await K.waitForSelector('.invite [data-rekey="p2"]', { visible: true, timeout: 20_000 * SLOW });
  const fullCard = await K.$eval('.invite', (el) => el.innerText);
  check('the full farm\'s invite card is no dead end: it offers Mia a new key', /two farmers/.test(fullCard) && /Did Mia lose their way in\?/.test(fullCard)
    && /Make a new key for Mia/.test(fullCard), fullCard.slice(0, 200));
  await sleep(300);
  await keysShot(K, 'invite-full-offers-new-key-desktop');
  await K.evaluate(() => { window.__hh.ui.panels.closeAll?.(); window.__hh.ui.panels.open('settings', { tab: 'farm' }); });
  await K.waitForSelector('.set-farmer[data-farmer="p2"] [data-rekey="p2"]', { visible: true, timeout: 20_000 * SLOW });
  await K.$eval('.set-farmer[data-farmer="p2"]', (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(300);
  const farmersText = await K.$eval('.set-farmers', (el) => el.innerText);
  check('Settings > Farm > Farmers: Mia, when she was last here, and "Make a new key for Mia"',
    /Mia/.test(farmersText) && /(Playing right now|Last here)/.test(farmersText) && /Make a new key for Mia/.test(farmersText) && !/Make a new key for Rowan/.test(farmersText), farmersText);
  await keysShot(K, 'settings-farmers-desktop');
  await press(K, '.set-farmer[data-farmer="p2"] [data-rekey="p2"]');
  await waitFor(K, () => window.__hh.ui.panels.isOpen('confirm'), null, 10_000);
  await sleep(400);
  const confirmText = await K.$eval('#panel-confirm', (el) => el.innerText);
  check('a confirm first: "Make a new key for Mia?", "Their old phones will be signed out."', /Make a new key for Mia\?/.test(confirmText)
    && /old phones will be signed out/.test(confirmText), confirmText.slice(0, 200));
  await keysShot(K, 'rekey-confirm-desktop');
  await clickText(K, '#panel-confirm button', 'Make a new key');
  await waitFor(K, () => window.__hh.ui.panels.isOpen('newkey') && document.querySelector('.newkey .link-field')?.value, null, 20_000);
  const miaLink = await K.$eval('.newkey .link-field', (el) => el.value);
  check('the new key is a one-time link /f/<id>?rejoin=<token>', new RegExp(`^${BASE}/f/${f1.id}\\?rejoin=[0-9a-f]{32}$`).test(miaLink), miaLink.replace(/rejoin=.*/, 'rejoin=…'));
  secrets.push(new URL(miaLink).searchParams.get('rejoin'));
  await sleep(300);
  await keysShot(K, 'newkey-card-desktop');
  // Mia's old phone, still open: signed out, politely, nothing of the farm after
  await waitFor(M, () => document.querySelector('#farm-gate')?.dataset.gate === 'rekeyed', null, 20_000);
  const oldPhone = await M.evaluate(() => document.querySelector('#farm-gate').innerText);
  check('Mia\'s old phone: "This farmer was given a new key", with the way back', /given a new key/.test(oldPhone) && /Ask your partner for a new key/.test(oldPhone)
    && /Paste your personal link/.test(oldPhone), oldPhone.slice(0, 200));
  await M.bringToFront();
  await sleep(500);
  await keysShot(M, 'gate-rekeyed-old-phone-iphone13');
  await M.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(M, () => document.querySelector('#farm-gate')?.dataset.gate, null, 40_000);
  check('the old phone reloaded: the same polite gate, no farm data on the page', (await gateOf(M)) === 'rekeyed' && !(await M.evaluate(() => Boolean(window.__hh?.state))));
  await M.close();
  const O = await device('Old key on a fresh profile', 'iPhone 13');
  await O.goto(`${BASE}/f/${f1.id}?quality=low#k=${miaOld}`, { waitUntil: 'domcontentloaded' });
  await waitFor(O, () => document.querySelector('#farm-gate')?.dataset.gate, null, 60_000);
  check('Mia\'s old personal link on a fresh profile: refused politely, no farm data', (await gateOf(O)) === 'rekeyed'
    && !(await O.evaluate(() => Boolean(window.__hh?.state) || /Rowan|Sunny Acres/.test(document.body.innerText))));
  await O.close();
  await waitFor(K, () => Object.values(window.__hh.state.farm.feed.rows).some((r) => r.k === 'key' && r.what === 'new' && r.pid === 'p2' && r.by === 'p1'), null, 10_000);
  check('the feed: "You made a new key for Mia" on Rowan\'s screen', await K.evaluate(() => /You\s*made a new key for Mia/.test(document.body.textContent)));
  const waitSt = await (await fetch(`${BASE}/api/f/${f1.id}/status`, { headers: { authorization: `Bearer ${rowanSecret}` } })).json();
  check('the farm\'s status (to a member): Mia\'s seat waits for its new key', waitSt.waiting?.p2?.by === 'p1' && waitSt.full === true, JSON.stringify(waitSt.waiting));
  await K.evaluate(() => { window.__hh.ui.panels.closeAll?.(); window.__hh.ui.panels.open('invite'); });
  await K.waitForSelector('.invite-rekey .link-field', { visible: true, timeout: 20_000 * SLOW });
  check('not stuck "full": the invite card now holds Mia\'s new key link', (await K.$eval('.invite-rekey .link-field', (el) => el.value)) === miaLink);
  await sleep(300);
  await keysShot(K, 'invite-full-waiting-link-desktop');
  await K.evaluate(() => window.__hh.ui.panels.closeAll?.());
  // Mia's new phone opens the link: her farmer, everything she had
  const MN = await device('Mia new phone', 'iPhone 13');
  await MN.goto(`${miaLink}&quality=low`, { waitUntil: 'domcontentloaded' });
  await MN.waitForSelector('#slot-picker:not([hidden]) [data-rejoin="p2"]', { visible: true, timeout: 40_000 * SLOW });
  const rejoinSub = await MN.$eval('#slot-sub', (el) => el.textContent);
  check('the new key\'s picker: only Mia\'s farmer, by name, renamable', /A new key for Mia!/.test(rejoinSub)
    && (await MN.$$eval('#slot-picker .slot', (els) => els.map((e) => e.dataset.slot).join())) === 'p2'
    && (await MN.$eval('#slot-picker .slot input.field', (el) => el.value)) === 'Mia', rejoinSub);
  await sleep(400);
  await keysShot(MN, 'rejoin-picker-iphone13');
  await press(MN, '[data-rejoin="p2"]');
  await waitFor(MN, () => Boolean(window.__hh?.pid && window.__hh.controller), null, 60_000);
  const mn = await MN.evaluate((id) => ({ pid: window.__hh.pid, search: location.search, p2: window.__hh.state.players.p2,
    token: JSON.parse(localStorage.getItem(`hh.f.${id}.tokens`) || '{}').p2 }), f1.id);
  const miaNew = mn.token;
  secrets.push(miaNew);
  check('Mia is back on a fresh phone as farmer 2 with her name, look, stats and progress; the link left the address bar',
    mn.pid === 'p2' && keepFields(mn.p2) === miaBefore && !mn.search.includes('rejoin') && /^[0-9a-f]{64}$/.test(miaNew ?? '') && miaNew !== miaOld,
    `${keepFields(mn.p2) === miaBefore ? 'same farmer' : 'changed'} ${mn.search}`);
  check('her Wheat is still on the farm', await MN.evaluate((id) => Boolean(window.__hh.state.farm.objects[id]?.crop), plot2));
  await waitFor(K, () => Object.values(window.__hh.state.farm.feed.rows).some((r) => r.k === 'key' && r.what === 'back' && r.pid === 'p2'), null, 10_000);
  check('the feed on Rowan\'s screen: Mia came back with a new key', await K.evaluate(() => /Mia\s*came back with a new key/.test(document.body.textContent)));
  await sleep(800);
  await keysShot(MN, 'rejoined-iphone13');
  // a home-screen app whose start URL still carries the old key: refused, then her new key lets her in (no lock-out)
  await MN.goto(`${BASE}/f/${f1.id}?quality=low#k=${miaOld}`, { waitUntil: 'domcontentloaded' });
  await waitFor(MN, () => Boolean(window.__hh?.pid && window.__hh.controller), null, 60_000);
  check('an old key in a home-screen start URL falls back to the new one: no lock-out', (await MN.evaluate(() => window.__hh.pid)) === 'p2' && (await gateOf(MN)) === null);
  const SP = await device('Spent new key', 'iPhone 13');
  await SP.goto(`${miaLink}&quality=low`, { waitUntil: 'domcontentloaded' });
  await waitFor(SP, () => document.querySelector('#farm-gate')?.dataset.gate, null, 60_000);
  check('the used new-key link says it no longer works (and how to get another)', (await gateOf(SP)) === 'rejoin'
    && /Ask your partner for a new key/.test(await SP.$eval('#farm-gate', (el) => el.innerText)));
  await keysShot(SP, 'gate-rejoin-spent-iphone13');
  await SP.close();

  // 9d. Rowan loses his: Mia makes him a new key from her phone ---------------------------------------------------------
  await MN.bringToFront();
  await MN.evaluate(() => { window.__hh.ui.panels.closeAll?.(); window.__hh.ui.panels.open('settings', { tab: 'farm' }); });
  await MN.waitForSelector('.set-farmer[data-farmer="p1"] [data-rekey="p1"]', { visible: true, timeout: 20_000 * SLOW });
  await MN.$eval('.set-farmer[data-farmer="p1"]', (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(400);
  await keysShot(MN, 'settings-farmers-iphone13');
  await press(MN, '.set-farmer[data-farmer="p1"] [data-rekey="p1"]');
  await waitFor(MN, () => window.__hh.ui.panels.isOpen('confirm'), null, 10_000);
  await sleep(400);
  await keysShot(MN, 'rekey-confirm-iphone13');
  await clickText(MN, '#panel-confirm button', 'Make a new key');
  await waitFor(MN, () => window.__hh.ui.panels.isOpen('newkey') && document.querySelector('.newkey .link-field')?.value, null, 20_000);
  const rowanLink = await MN.$eval('.newkey .link-field', (el) => el.value);
  secrets.push(new URL(rowanLink).searchParams.get('rejoin'));
  await sleep(400);
  await keysShot(MN, 'newkey-card-iphone13');
  await waitFor(K, () => document.querySelector('#farm-gate')?.dataset.gate === 'rekeyed', null, 20_000);
  await K.bringToFront();
  await sleep(500);
  await keysShot(K, 'gate-rekeyed-old-laptop-desktop');
  check('Rowan\'s old laptop: signed out politely', true);
  const KN = await device('Rowan new laptop', 'desktop');
  await KN.setViewport({ width: 1366, height: 768 });
  await KN.goto(`${rowanLink}&quality=low`, { waitUntil: 'domcontentloaded' });
  await KN.waitForSelector('#slot-picker:not([hidden]) [data-rejoin="p1"]', { visible: true, timeout: 40_000 * SLOW });
  await KN.click('#slot-picker .slot input.field', { count: 3 });
  await KN.type('#slot-picker .slot input.field', 'Kris');
  await keysShot(KN, 'rejoin-picker-rename-desktop');
  await KN.click('[data-rejoin="p1"]');
  await waitFor(KN, () => Boolean(window.__hh?.pid && window.__hh.controller), null, 60_000);
  const kn = await KN.evaluate((id) => ({ pid: window.__hh.pid, name: window.__hh.state.players.p1.name, farm: window.__hh.state.farm.name,
    token: JSON.parse(localStorage.getItem(`hh.f.${id}.tokens`) || '{}').p1 }), f1.id);
  secrets.push(kn.token);
  check('the creator\'s farmer taken back on a new laptop, renamed "Kris": the farm and his Wheat are all there',
    kn.pid === 'p1' && kn.name === 'Kris' && kn.farm === 'Sunny Acres' && kn.token !== rowanSecret
    && (await KN.evaluate((id) => Boolean(window.__hh.state.farm.objects[id]?.crop), plot)), JSON.stringify({ ...kn, token: kn.token ? 'set' : null }));
  await waitFor(MN, () => window.__hh.state.players.p1?.name === 'Kris', null, 20_000);
  const again = await (await fetch(`${BASE}/api/f/${f1.id}/status`, { headers: { authorization: `Bearer ${miaNew}` } })).json();
  check('two farmers again, no seat waiting: the farm plays on', again.full === true && Object.keys(again.waiting ?? {}).length === 0
    && (await MN.evaluate(() => Object.keys(window.__hh.state.players).length)) === 2, JSON.stringify(again.waiting));
  await sleep(800);
  await keysShot(KN, 'rejoined-renamed-desktop');

  // a home-screen app that knows no key (iOS keeps its storage apart): how to open the farm in it -----------------------
  const HA = await device('Home-screen app', 'iPhone 13');
  await HA.evaluateOnNewDocument(() => { Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true }); });
  await HA.goto(`${BASE}/f/${f1.id}`, { waitUntil: 'domcontentloaded' });
  await waitFor(HA, () => document.querySelector('#farm-gate')?.dataset.gate, null, 30_000);
  check('a home-screen app without a key: "Open your farm in this app" with paste and scan', (await gateOf(HA)) === 'home'
    && /Paste your personal link/.test(await HA.$eval('#farm-gate', (el) => el.innerText)));
  await keysShot(HA, 'gate-home-screen-app-iphone13');
  await HA.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await waitFor(HA, () => Boolean(document.querySelector('#landing #ld-back input.gate-link')));
  const firstCard = await HA.evaluate(() => {
    const back = document.getElementById('ld-back');
    return { onPage: Boolean(back.closest('#landing')) && !back.closest('dialog'),
      beforeActions: Boolean(back.compareDocumentPosition(document.getElementById('ld-dock')) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  check('the landing page in a home-screen app with no farms: "Already have a farm?" is on the page, before the actions',
    firstCard.onPage && firstCard.beforeActions, JSON.stringify(firstCard));
  check('landing: no sideways scroll with the way back (iPhone 13)', await noSideScroll(HA));
  await keysShot(HA, 'landing-way-back-iphone13');
  await HA.close();

  // 10. farm 2 unloads when idle; reopened, it is identical -------------------------------------------------------------
  // compared with sorted keys; players' lastSeenAt is stamped by every arrival, the one field a reconnect must change
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  const comparable = (state) => JSON.stringify(canon({ farm: state.farm,
    players: Object.fromEntries(Object.entries(state.players).map(([k, { lastSeenAt, ...rest }]) => [k, rest])) }));
  await waitFor(D, () => window.__hh.pending === 0);
  const dCtx = D.browserContext();
  await D.close();
  await L.close();
  const loadedOf = async () => (await (await fetch(`${BASE}/api/status`)).json()).farms;
  let st = await loadedOf();
  for (let i = 0; i < 60 && st.loaded !== 1; i++) { await sleep(500); st = await loadedOf(); }
  check('farm 2 with nobody connected unloads after the idle time (farm 1 stays loaded)', st.loaded === 1 && st.unloads >= 1, JSON.stringify(st));
  // the farm as it went to sleep: its final snapshot on disk (the together minutes of the leave are paid in it)
  const before = comparable(JSON.parse(fs.readFileSync(path.join(dataDir, 'farms', f2.id, 'farm.json'), 'utf8')).state);
  const D2 = await dCtx.newPage();
  await D2.emulate(DEVICES['iPhone 13']);
  D2.on('pageerror', (e) => errors.push(`Dana pageerror: ${e.message}`));
  watchRequests(D2, 'Dana again');
  D2.tag = 'Dana again';
  pages.push(D2);
  await D2.goto(`${BASE}/f/${f2.id}?quality=low`, { waitUntil: 'domcontentloaded' });
  await waitFor(D2, () => Boolean(window.__hh?.pid && window.__hh.controller && window.__hh.state), null, 40_000);
  const after = comparable(await D2.evaluate(() => window.__hh.state));
  check('farm 2 reloaded from disk is identical (objects, wallet, inventory, players)', before === after,
    before === after ? `${before.length} bytes` : (() => { const i = [...before].findIndex((c, k) => c !== after[k]); return `differs at ${i}: ${before.slice(Math.max(0, i - 80), i + 80)} | ${after.slice(Math.max(0, i - 80), i + 80)}`; })());
  check('Dana is still farmer 1 on her phone after the farm slept', (await D2.evaluate(() => window.__hh.pid)) === 'p1');
  await sleep(800);
  await shot(D2, '12-farm2-after-unload-reload-iphone13');

  // 11. retention: idle past the TTL, deleted --------------------------------------------------------------------------
  await D2.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  st = await loadedOf();
  for (let i = 0; i < 60 && st.loaded !== 1; i++) { await sleep(500); st = await loadedOf(); }
  const swept = await (await fetch(`${BASE}/api/dev/sweep`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ now: Date.now() + 8 * 86_400_000 }) })).json();
  const f2dir = path.join(dataDir, 'farms', f2.id);
  check('the sweep 8 days on deletes farm 2 (idle) and keeps farm 1 (players connected)', swept.deleted === 1 && !fs.existsSync(f2dir)
    && fs.existsSync(path.join(dataDir, 'farms', f1.id)), JSON.stringify({ swept, st }));
  const gone = await (await fetch(`${BASE}/api/f/${f2.id}/status`)).status;
  check('the deleted farm\'s status answers 404', gone === 404, String(gone));
  await D2.goto(`${BASE}/f/${f2.id}?quality=low`, { waitUntil: 'domcontentloaded' });
  await waitFor(D2, () => document.querySelector('#farm-gate')?.dataset.gate, null, 40_000);
  const goneGate = await D2.evaluate(() => ({ kind: document.querySelector('#farm-gate').dataset.gate,
    listed: JSON.parse(localStorage.getItem('hh.farms') || '[]').map((f) => f.id) }));
  check('Dana\'s phone says the farm is gone and forgets it', goneGate.kind === 'gone' && !goneGate.listed.includes(f2.id), JSON.stringify(goneGate));
  await shot(D2, '13-gate-farm-gone-iphone13');

  // 12. the creation limit ---------------------------------------------------------------------------------------------
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await fetch(`${BASE}/api/farms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
  check('the 6th new farm from one address in an hour is refused (429)', codes.join() === '201,201,201,429', codes.join());
  const R = await device('Rate limited', 'iPhone 13');
  await R.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await press(R, '#ld-start');
  await waitFor(R, () => /Try again/.test(document.getElementById('ld-status').textContent));
  check('the landing page says to try again later', /new farms were just started from this network/.test(await R.$eval('#ld-status', (e) => e.textContent)));
  await shot(R, '14-landing-rate-limited-iphone13');
  await R.close();

  // 14. the privacy page: English (desktop), Bulgarian (iPhone 13, by the browser's language), a privacy request ---------
  const pshot = async (page, name, full = false) => {
    const file = path.join(PRIVACY_SHOTS, `${name}.png`);
    await page.screenshot({ path: file, fullPage: full });
    files.push(path.relative(ROOT, file));
  };
  const pvState = (page) => page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title,
    shown: [...document.querySelectorAll('article.pv-doc')].filter((a) => !a.hidden).map((a) => a.dataset.lang),
    current: document.querySelector('.pv-lang a[aria-current="true"]')?.dataset.lang ?? null, search: location.search }));
  const PE = await device('Privacy reader', 'desktop');
  await PE.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-GB', 'en'] }); });
  await PE.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  check('the landing page\'s link row links the privacy note', (await PE.$eval('.ld-more #ld-privacy', (a) => a.getAttribute('href'))) === '/privacy');
  // reached the way a visitor does: the landing page's Privacy link
  await Promise.all([PE.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30_000 * SLOW }), press(PE, '#ld-privacy')]);
  check('the landing page\'s Privacy link opens /privacy', new URL(PE.url()).pathname === '/privacy', PE.url());
  const pe = await pvState(PE);
  check('privacy page: an English browser gets the English note (the Bulgarian one hidden), the switch says so', pe.lang === 'en'
    && pe.shown.join() === 'en' && pe.current === 'en' && pe.title === 'Privacy · Harvest Hollow', JSON.stringify(pe));
  const peText = await PE.$eval('article[data-lang="en"]', (a) => a.innerText);
  check('privacy page (EN): who runs it, what is kept, how long, IP addresses, Railway in the US, the legal basis, the rights, deleting a farm, the form',
    ['Rowena Kralev', 'Bulgaria', 'What is kept, and why', '7 days', '12 months', 'IP address', 'United States', 'legitimate interest', 'consent',
      'cpdp.bg', 'Delete this farm now', 'We are not lawyers', 'Last updated'].every((x) => peText.includes(x)), peText.slice(0, 120));
  check('privacy page: no sideways scroll on a desktop', await noSideScroll(PE));
  await pshot(PE, 'privacy-en-desktop');
  await pshot(PE, 'privacy-en-desktop-full', true);
  await press(PE, '.pv-lang a[data-lang="bg"]');
  const pe2 = await pvState(PE);
  check('privacy page: the switch shows the Bulgarian note at once and keeps ?lang=bg in the address', pe2.lang === 'bg' && pe2.shown.join() === 'bg'
    && pe2.current === 'bg' && pe2.search === '?lang=bg' && /Поверителност/.test(pe2.title), JSON.stringify(pe2));
  await PE.evaluate(() => window.scrollTo(0, 0));
  await pshot(PE, 'privacy-bg-desktop');
  await pshot(PE, 'privacy-bg-desktop-full', true);
  await PE.close();
  const PB = await device('Privacy phone (BG)', 'iPhone 13');
  await PB.setExtraHTTPHeaders({ 'accept-language': 'bg-BG,bg;q=0.9' });
  await PB.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['bg-BG', 'bg'] }); });
  await PB.goto(`${BASE}/privacy`, { waitUntil: 'networkidle0' });
  const pb = await pvState(PB);
  const pbText = await PB.$eval('article[data-lang="bg"]', (a) => a.innerText);
  check('privacy page: a Bulgarian phone gets the Bulgarian note by its own language', pb.lang === 'bg' && pb.shown.join() === 'bg' && pb.current === 'bg'
    && ['Красимир Кралев', 'Какво пазим и защо', '7 дни', '12 месеца', 'Съединените щати', 'законен интерес', 'КЗЛД', 'Не сме юристи'].every((x) => pbText.includes(x)),
  JSON.stringify(pb));
  check('privacy page: no sideways scroll on an iPhone 13 (BG)', await noSideScroll(PB));
  await pshot(PB, 'privacy-bg-iphone13');
  await pshot(PB, 'privacy-bg-iphone13-full', true);
  // a privacy request from the Bulgarian form
  await PB.$eval('#bg-request', (e) => e.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await PB.$eval('form[data-lang="bg"] input[name="kind"][value="farm"]', (e) => e.click());
  await PB.type('#bg-text', 'Изгубих телефона си. Моля, изтрийте фермата на адрес /f/aaaaaaaaaaaa.');
  await PB.type('#bg-contact', 'ana@example.com');
  // a tap that takes too long under a loaded CPU is a long press (no click): pressUntil tries again (the form ignores a
  // second send while one is on its way)
  await pressUntil(PB, 'form[data-lang="bg"] .pv-send', () => { const d = document.querySelector('article[data-lang="bg"] .pv-done'); return d && !d.hidden; });
  await pshot(PB, 'privacy-request-sent-bg-iphone13');
  const asked = await admin('/api/admin/privacy');
  const mine = asked.body?.requests?.find((r) => /Изгубих телефона си/.test(r.text));
  check('privacy request: the Bulgarian form\'s request reaches the admin list (kind, contact, language; open)', asked.status === 200 && mine
    && mine.kind === 'farm' && mine.contact === 'ana@example.com' && mine.lang === 'bg' && mine.status === 'new', JSON.stringify(asked.body?.counts));
  const reqDisk = fs.readFileSync(path.join(dataDir, 'privacy', 'requests.jsonl'), 'utf8');
  check('privacy request: on the data volume, without an address or a browser', /Изгубих/.test(reqDisk) && !/127\.0\.0\.1|::1|Mozilla|AppleWebKit/.test(reqDisk));
  await pressUntil(PB, '.pv-lang a[data-lang="en"]', () => document.documentElement.lang === 'en');
  await PB.evaluate(() => window.scrollTo(0, 0));
  check('privacy page: the phone switches to English', (await pvState(PB)).shown.join() === 'en');
  await pshot(PB, 'privacy-en-iphone13');
  await pshot(PB, 'privacy-en-iphone13-full', true);
  await PB.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  for (const lang of ['en', 'bg']) {
    await PB.goto(`${BASE}/privacy?lang=${lang}`, { waitUntil: 'networkidle0' });
    check(`privacy page: no sideways scroll at 360 px (${lang})`, await noSideScroll(PB));
  }
  await PB.close();

  // 15. "Delete this farm now": Mia deletes farm 1 from her phone; Kris's laptop is told ------------------------------
  await MN.bringToFront();
  await MN.evaluate(() => { window.__hh.ui.panels.closeAll?.(); window.__hh.ui.panels.open('settings', { tab: 'farm' }); });
  await MN.waitForSelector('.set-delete [data-farm-delete="open"]', { visible: true, timeout: 20_000 * SLOW });
  check('Settings > Farm: the privacy note (/privacy, a new tab) and "Delete this farm now…"',
    (await MN.$eval('.set-privacy a[data-privacy="open"]', (a) => `${a.getAttribute('href')} ${a.getAttribute('target')}`)) === '/privacy _blank');
  await MN.$eval('.set-delete', (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await sleep(300);
  await pshot(MN, 'settings-privacy-delete-iphone13');
  await pressUntil(MN, '.set-delete [data-farm-delete="open"]', () => window.__hh.ui.panels.isOpen('confirm'));
  await sleep(500);
  const confirmDel = await MN.evaluate(() => ({ text: document.getElementById('panel-confirm')?.innerText ?? '', focused: document.activeElement?.textContent?.trim() }));
  check('the confirm: everything goes for both farmers, it cannot be brought back, "Keep my farm" has the focus', /Delete this farm\?/.test(confirmDel.text)
    && /Everything on Sunny Acres goes, for both farmers/.test(confirmDel.text) && /every backup/.test(confirmDel.text) && /Nobody can bring them back/.test(confirmDel.text)
    && /Keep my farm/.test(confirmDel.text) && /Delete it for good/.test(confirmDel.text) && confirmDel.focused === 'Keep my farm', JSON.stringify(confirmDel));
  await pshot(MN, 'delete-confirm-iphone13');
  await clickText(MN, '#panel-confirm button', 'Keep my farm');
  await sleep(800);
  const kept = await (await fetch(`${BASE}/api/f/${f1.id}/status`, { headers: { authorization: `Bearer ${miaNew}` } })).json();
  check('"Keep my farm": nothing happens, the farm plays on', kept.ok === true && kept.member === true && (await gateOf(MN)) === null && fs.existsSync(path.join(dataDir, 'farms', f1.id)));
  // the same confirm on Kris's laptop, for the record
  await KN.bringToFront();
  await KN.evaluate(() => { window.__hh.ui.panels.closeAll?.(); window.__hh.ui.panels.open('settings', { tab: 'farm' }); });
  await KN.waitForSelector('.set-delete [data-farm-delete="open"]', { visible: true, timeout: 20_000 * SLOW });
  await press(KN, '.set-delete [data-farm-delete="open"]');
  await waitFor(KN, () => window.__hh.ui.panels.isOpen('confirm'), null, 10_000);
  await sleep(500);
  await pshot(KN, 'delete-confirm-desktop');
  await clickText(KN, '#panel-confirm button', 'Keep my farm');
  await KN.evaluate(() => window.__hh.ui.panels.closeAll?.());
  // now for real, from Mia's phone
  await MN.bringToFront();
  await MN.evaluate(() => { window.__hh.ui.panels.closeAll?.(); window.__hh.ui.panels.open('settings', { tab: 'farm' }); });
  await MN.waitForSelector('.set-delete [data-farm-delete="open"]', { visible: true, timeout: 20_000 * SLOW });
  await pressUntil(MN, '.set-delete [data-farm-delete="open"]', () => window.__hh.ui.panels.isOpen('confirm'));
  await sleep(400);
  await clickText(MN, '#panel-confirm button', 'Delete it for good');
  await waitFor(MN, () => document.querySelector('#farm-gate')?.dataset.gate === 'deleted', null, 20_000);
  await waitFor(KN, () => document.querySelector('#farm-gate')?.dataset.gate === 'deleted', null, 20_000);
  const goneDel = await Promise.all([MN, KN].map((p) => p.evaluate((id) => ({ text: document.getElementById('farm-gate').innerText,
    privacy: document.querySelector('#farm-gate .gate-privacy a')?.getAttribute('href'),
    listed: JSON.parse(localStorage.getItem('hh.farms') || '[]').some((f) => f.id === id),
    keys: Object.keys(localStorage).filter((k) => k.startsWith(`hh.f.${id}.`)).length }), f1.id)));
  check('deleted: both screens say "This farm was deleted" politely, link the privacy note, and forget the farm (list and keys)',
    goneDel.every((g) => /This farm was deleted/.test(g.text) && /Thank you for farming here/.test(g.text) && g.privacy === '/privacy' && !g.listed && g.keys === 0),
    JSON.stringify(goneDel.map(({ text, ...g }) => g)));
  check('deleted: the farm\'s folder (snapshot, journal, backups) is gone at once, and the farm answers 404',
    !fs.existsSync(path.join(dataDir, 'farms', f1.id)) && (await fetch(`${BASE}/api/f/${f1.id}/status`)).status === 404);
  await MN.bringToFront();
  await sleep(400);
  await pshot(MN, 'deleted-gate-iphone13');
  await KN.bringToFront();
  await sleep(400);
  await pshot(KN, 'deleted-gate-partner-desktop');
  check('deleted: the log says who (a slot), never which farm or key', /a farm was deleted by one of its farmers .*pid=p2/.test(serverLog));

  // 16. no full client address in the server log ----------------------------------------------------------------------
  {
    const { WebSocket } = await import('ws');
    const proxied = { 'x-forwarded-for': '203.0.113.77', 'content-type': 'application/json' };
    const made = await (await fetch(`${BASE}/api/farms`, { method: 'POST', headers: proxied, body: '{}' })).json();
    secrets.push(made.id, made.secret);
    const ws = new WebSocket(`ws://localhost:${port}/ws?farm=${made.id}`, { headers: { 'x-forwarded-for': '203.0.113.77' } });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const closed = new Promise((r) => ws.once('close', r));
    for (let i = 0; i < 320; i++) ws.send('{not json');
    await closed;
    await sleep(300);
    check('the log: an abuse warning names only the network (203.0.113.0), never the full address',
      /closing abusive connection .*ip=203\.0\.113\.0\b/.test(serverLog) && !serverLog.includes('203.0.113.77'));
    const full = ['127.0.0.1', '::ffff:', '::1 ', 'ip=::1'].filter((x) => serverLog.includes(x));
    check('the log: no full client address anywhere in this multi run', full.length === 0, full.join(' '));
  }
  check('no page asked another host, on any device, in the whole run', !errors.some((e) => /asked another host/.test(e)),
    errors.filter((e) => /asked another host/.test(e)).slice(0, 3).join(' | '));

  // 13. security ----------------------------------------------------------------------------------------------------------
  const status = await (await fetch(`${BASE}/api/status`)).json();
  check('the global status counts farms and lists no id', status.farms && !JSON.stringify(status).includes(f1.id) && !JSON.stringify(status).includes(f2.id));
  const inLog = [f1.id, f2.id, ...secrets].filter((x) => x && serverLog.includes(x));
  check('no farm id, member secret or invite token in the server log', inLog.length === 0, `${inLog.length} found`);
  const memberSecrets = secrets.filter((x) => x && x.length === 64);
  // what goes on the wire: never a data: URL (the farm's home-screen manifest carries the personal link on purpose),
  // never the fragment (Puppeteer's request.url() appends it; the browser does not send it)
  const leaked = requested.filter((u) => !u.startsWith('data:') && memberSecrets.some((x) => u.split('#')[0].includes(x)));
  check('no member secret in any URL a request carried (the #k= fragment never travels)', memberSecrets.length >= 3 && leaked.length === 0,
    `${memberSecrets.length} secrets, ${requested.length} requests, ${leaked.length} leaks${leaked.length ? `: ${leaked.map((u) => u.slice(0, 40)).join(' ')}` : ''}`);
  check('no request ever went to api.github.com (the star count comes from the farm server)', !requested.some((u) => /^https?:\/\/api\.github\.com\//.test(u)));
  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  console.log(JSON.stringify({ ok: true, steps: steps.length, errors, files }));
} catch (err) {
  for (const p of pages) { try { if (!p.isClosed()) await shot(p, `fail-${p.tag.replace(/\W+/g, '-')}`); } catch { /* closed */ } }
  console.log(JSON.stringify({ ok: false, error: String(err && err.message || err), steps, errors, files, server: serverLog.slice(-1500) }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer();
  await new Promise((r) => stub.close(() => r()));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
