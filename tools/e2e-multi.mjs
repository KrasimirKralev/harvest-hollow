// Multi-farm hosted mode E2E (docs/agent-briefs/multi-farm.md). Starts its own HH_MODE=multi HH_DEV=1 server on --port
// (default 3974) with a temp data dir and a 4 s idle unload, opens ONE headless Chrome with a browser context per device
// (separate storage = separate people) and plays the hosted flow with real clicks and taps:
//    1. the landing page (desktop and iPhone 13): Start a new farm, the 7-day line, the repo link, no sideways scroll
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
// Prints one JSON line { ok, steps, errors, files } and exits non-zero on any failure. Screenshots: --screens
// (default .scratch/mf-client/e2e).
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
const port = Number(args.port || 3974);
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
const screens = path.resolve(args.screens || path.join(ROOT, '.scratch', 'mf-client', 'e2e'));
fs.mkdirSync(screens, { recursive: true });
const SLOW = Math.max(1, Number(args.slow || process.env.HH_E2E_SLOW || 1));
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
      HH_FARM_IDLE_MS: '4000', NODE_ENV: 'development' },
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
async function device(tag, kind) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (DEVICES[kind]) await page.emulate(DEVICES[kind]);
  else await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
  page.on('request', (r) => requested.push(r.url()));
  page.tag = tag;
  pages.push(page);
  return page;
}
/** Tap on a phone, click on a desktop. */
async function press(page, sel) {
  // the visible match (a phone keeps a hidden copy of some menu tiles)
  const el = await page.waitForSelector(sel, { visible: true, timeout: 30_000 * SLOW });
  if (page.viewport()?.hasTouch) await el.tap(); else await el.click();
}
async function typeName(page, name) {
  await page.waitForSelector('#slot-picker:not([hidden]) .slot input.field', { visible: true, timeout: 40_000 * SLOW });
  await page.type('#slot-picker .slot input.field', name);
  await press(page, '#slot-picker .slot .btn');
  await waitFor(page, () => Boolean(window.__hh?.pid && window.__hh.state && window.__hh.controller), null, 40_000);
}
const farmOf = (page) => page.evaluate(() => location.pathname.split('/')[2]);
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
    await press(page, '#m-menu-btn');
    await sleep(700);                                  // the farm menu sheet slides up first
    await shot(page, `${page.tag.toLowerCase()}-phone-farm-menu`);
    await press(page, '.m-tile[data-invite="open"]');
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

try {
  await startServer();
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800', '--mute-audio',
      '--autoplay-policy=no-user-gesture-required'],
  });

  // 1. the landing page -------------------------------------------------------------------------------------------
  const K = await device('Rowan', 'desktop');
  await K.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  const land = await K.evaluate(() => ({ title: document.title, start: document.getElementById('ld-start')?.textContent,
    ttl: document.querySelector('.ld-ttl')?.textContent, repo: document.getElementById('ld-repo')?.href, farms: document.getElementById('ld-farms').hidden }));
  check('landing: Start a new farm, the 7-day line, the repo link', land.start === 'Start a new farm' && /7 days/.test(land.ttl) && /github\.com/.test(land.repo)
    && land.farms === true, JSON.stringify(land));
  check('landing: no sideways scroll on a desktop', await noSideScroll(K));
  await shot(K, '01-landing-desktop');
  const phoneLanding = await device('Phone visitor', 'iPhone 13');
  await phoneLanding.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  check('landing: no sideways scroll on an iPhone 13', await noSideScroll(phoneLanding));
  await shot(phoneLanding, '01-landing-iphone13');
  await phoneLanding.close();

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
  secrets.push(await M.evaluate((id) => JSON.parse(localStorage.getItem(`hh.f.${id}.tokens`)).p2, f1.id));
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
  await U.goto(link1, { waitUntil: 'domcontentloaded' });
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
  D2.on('request', (r) => requested.push(r.url()));
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
  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  console.log(JSON.stringify({ ok: true, steps: steps.length, errors, files }));
} catch (err) {
  for (const p of pages) { try { if (!p.isClosed()) await shot(p, `fail-${p.tag.replace(/\W+/g, '-')}`); } catch { /* closed */ } }
  console.log(JSON.stringify({ ok: false, error: String(err && err.message || err), steps, errors, files, server: serverLog.slice(-1500) }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
