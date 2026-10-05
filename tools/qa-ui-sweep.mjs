// UI sweep over an existing farm (a data dir kept by tools/qa-playtest.mjs --keep): starts a server on it, reclaims both
// slots on "a new computer" through the protocol, opens two pages and visits every panel and tab at the farm's level,
// saving a screenshot and a layout scan (cut-off text, things past the screen edge) for each.
//
//   node tools/qa-ui-sweep.mjs --port 3321 --data /tmp/hh-qa-XXXX [--out docs/qa/wave1] [--size 1280x720]
//
// Output: <out>/shots/UI-<name>.png and <out>/ui-sweep.json. Never touches :3000, :3300 or ./data.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../shared/net/protocol.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const port = Number(args.port || 3321);
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
if (!args.data) throw new Error('--data <dir> is required');
const OUT = path.resolve(args.out || path.join(ROOT, 'docs/qa/wave1'));
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const [VW, VH] = String(args.size || '1280x720').split('x').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...a) => console.error('[sweep]', ...a);

let serverLog = '';
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(port), HH_DATA_DIR: path.resolve(args.data), HH_DEV: '1', HH_TZ: 'Europe/Sofia' }, stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

/** The slot's token, issued by the server to "a new computer" (the farmer must be offline). */
function reclaim(slot, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const cid = `sw${slot}${Math.floor(Math.random() * 1e4)}`.slice(0, 8);
    const t = setTimeout(() => reject(new Error('reclaim timeout')), 15000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', proto: PROTOCOL_VERSION, cid, claim: { slot, name, reclaim: true } })));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === 'welcome' && m.token) { clearTimeout(t); ws.close(); resolve(m.token); }
      else if (m.t === 'deny') { clearTimeout(t); ws.close(); reject(new Error(`denied ${m.code}`)); }
    });
  });
}

const result = { panels: [], notes: [] };
let browser;
try {
  for (let i = 0; i < 100 && !serverLog.includes('running at'); i++) await sleep(100);
  if (!serverLog.includes('running at')) throw new Error(`server did not start: ${serverLog.slice(-400)}`);
  const tokens = { p1: await reclaim('p1', 'Rowan'), p2: await reclaim('p2', 'Mia') };
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', `--window-size=${VW},${VH}`, '--mute-audio'],
  });
  const pages = {};
  for (const [pid, name] of [['p1', 'Rowan'], ['p2', 'Mia']]) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: VW, height: VH });
    page.setDefaultTimeout(120000);
    await page.evaluateOnNewDocument((tok, p) => { try { localStorage.setItem('hh.tokens', JSON.stringify({ [p]: tok })); } catch { /* none */ } }, tokens[pid], pid);
    page.on('pageerror', (e) => result.notes.push(`${pid} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') result.notes.push(`${pid} console: ${m.text().slice(0, 200)}`); });
    await page.goto(`http://localhost:${port}/?slot=${pid}&quality=low`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => window.__hh && window.__hh.state && window.__hh.pid, { timeout: 240000 });
    pages[pid] = page;
  }
  await sleep(2500);
  const A = pages.p1;
  const closeAll = async () => { await A.evaluate(() => window.__hh.ui.panels.closeAll()).catch(() => {}); await A.keyboard.press('Escape').catch(() => {}); await sleep(250); };
  const scan = () => A.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out = { truncated: [], offscreen: [], tiny: [] };
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('#world, #overlay, canvas, .sr-only') || el.classList.contains('sr-only')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.offsetParent === null && cs.position !== 'fixed') continue;
      const txt = (el.childElementCount === 0 ? el.textContent : '').trim().replace(/\s+/g, ' ');
      if (!txt) continue;
      const cut = el.scrollWidth > el.clientWidth + 1 && (cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden' || cs.overflowX === 'hidden');
      if (cut && !seen.has(txt)) { seen.add(txt); out.truncated.push({ text: txt.slice(0, 70), cls: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`, w: el.clientWidth, sw: el.scrollWidth }); }
      const b = el.getBoundingClientRect();
      if (b.width > 0 && (b.right > vw + 2 || b.bottom > vh + 2 || b.left < -2) && b.top < vh && !seen.has(`o:${txt}`)) {
        seen.add(`o:${txt}`);
        out.offscreen.push({ text: txt.slice(0, 60), cls: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`, right: Math.round(b.right), bottom: Math.round(b.bottom) });
      }
      const fs0 = parseFloat(cs.fontSize);
      if (fs0 < 11 && !seen.has(`t:${txt}`) && txt.length > 2) { seen.add(`t:${txt}`); out.tiny.push({ text: txt.slice(0, 40), px: fs0 }); }
    }
    out.truncated = out.truncated.slice(0, 15); out.offscreen = out.offscreen.slice(0, 10); out.tiny = out.tiny.slice(0, 8);
    return out;
  }).catch(() => null);
  const visit = async (name, open) => {
    await closeAll();
    await open();
    await sleep(900);
    const sc = await scan();
    const file = path.join(SHOTS, `UI-${name}.png`);
    await A.evaluate(() => { window.__hh.view.setQuality('high'); }).catch(() => {});
    await sleep(1200);
    await A.screenshot({ path: file }).catch((e) => result.notes.push(`screenshot ${name}: ${e.message}`));
    await A.evaluate(() => { window.__hh.view.setQuality('low'); }).catch(() => {});
    result.panels.push({ name, shot: path.relative(ROOT, file), ...sc });
    say(name, sc ? `trunc ${sc.truncated.length} off ${sc.offscreen.length} tiny ${sc.tiny.length}` : 'scan failed');
  };
  const tab = (re) => A.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    const b = [...document.querySelectorAll('#panels [role="tab"], #panels .pn-tab, #panels button')].find((x) => x.offsetParent !== null && rx.test(x.textContent.trim()));
    if (b) b.click();
    return Boolean(b);
  }, re.source);
  const open = (name, a) => A.evaluate(([n, x]) => window.__hh.ui.panels.open(n, x), [name, a ?? {}]);

  await visit('00-world-hud', async () => {});
  for (const t of ['Sell', 'Seeds', 'Trees', 'Animals', 'Buildings', 'Decor', 'Land', 'Tools', 'Acorn shop']) {
    await visit(`market-${t.toLowerCase().replace(/\W+/g, '-')}`, async () => { await open('market'); await sleep(600); await tab(new RegExp(`^${t}`)); });
  }
  await visit('barn', async () => { await open('barn'); });
  await visit('orders', async () => { await open('orders'); });
  for (const t of ['Letters', 'This week', 'Ribbons', 'Mastery', 'Together', 'Ledger', 'Activity']) {
    await visit(`journal-${t.toLowerCase().replace(/\W+/g, '-')}`, async () => { await open('journal'); await sleep(600); await tab(new RegExp(`^${t}`)); });
  }
  await visit('wishlist', async () => { await open('wishlist'); });
  await visit('notes', async () => { await open('notes'); });
  await visit('settings', async () => { await open('settings'); });
  // building and animal panels of everything the farm owns
  const s = await A.evaluate(() => JSON.parse(JSON.stringify(window.__hh.state)));
  const seenDef = new Set();
  for (const [id, o] of Object.entries(s.farm.objects)) {
    if (seenDef.has(o.def)) continue;
    if (['bakery', 'mill', 'sawmill', 'dairy', 'juice_press', 'kitchen', 'preserves', 'weaver', 'compost_bin'].includes(o.def)) { seenDef.add(o.def); await visit(`building-${o.def}`, async () => { await open('building', { id }); }); }
    if (['coop', 'cow_barn', 'pasture'].includes(o.def)) { seenDef.add(o.def); await visit(`animals-${o.def}`, async () => { await open('animals', { id }); }); }
    if (['apple_tree', 'pine', 'cherry_tree'].includes(o.def)) { seenDef.add(o.def); await visit(`tree-${o.def}`, async () => { await open('tree', { id }); }); }
  }
  await closeAll();
  result.level = await A.evaluate(() => window.__hh.state.farm.xp);
} finally {
  fs.writeFileSync(path.join(OUT, 'ui-sweep.json'), JSON.stringify(result, null, 2));
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
}
say('done', result.panels.length, 'panels');
