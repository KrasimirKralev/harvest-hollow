// Dev tool: self-contained visual check (adapted from ~/wow-arena/tools/shot.mjs). Starts its own server on
// --port with a fresh temp data dir (HH_DEV=1), opens 1 or 2 headless Chrome clients in separate browser
// contexts (separate localStorage = separate players), runs an optional script and saves screenshots.
// Never touches the real service on :3300 or wow-arena on :3000.
//
//   node tools/shot.mjs --port 3308 --out /tmp/hh.png
//        [--clients 1|2]        two clients: p1 'Rowan' and p2 'Mia'; files <out>-A.png and <out>-B.png
//        [--size 1400x850] [--wait 1500]
//        [--plant]              A plants every starter plot (wheat) and B harvests nothing: a quick populated farm
//        [--script file.mjs]    default export: async ({ pages, page, shot, sleep, port, warp, out }) => {...}
//                               shot(name, page?) saves <out-dir>/<name>.png
//        [--data dir]           reuse a data dir instead of a temp one (kept afterwards)
// Prints one JSON line: { ok, fps, errors: [...console/page errors...], files: [...] }.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const port = Number(args.port || 3308);   // lanes pass their own port (docs/agent-briefs/common.md)
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
const clients = Math.min(2, Math.max(1, Number(args.clients || 1)));
const out = path.resolve(args.out || path.join(os.tmpdir(), `hh-shot-${port}.png`));
const [w, h] = String(args.size || '1400x850').split('x').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = args.data ? path.resolve(args.data) : fs.mkdtempSync(path.join(os.tmpdir(), 'hh-shot-'));

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(port), HH_DATA_DIR: dataDir, HH_DEV: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const errors = [];
const files = [];
let browser;
try {
  for (let i = 0; i < 80 && !serverLog.includes('running at'); i++) await sleep(100);
  if (!serverLog.includes('running at')) throw new Error(`server did not start: ${serverLog}`);
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', `--window-size=${w},${h}`, '--mute-audio'],
  });
  const pages = [];
  const who = [['p1', 'Rowan', 'A'], ['p2', 'Mia', 'B']].slice(0, clients);
  for (const [slot, name, tag] of who) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: w, height: h });
    page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
    await page.goto(`http://localhost:${port}/?slot=${slot}&name=${name}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__hh && window.__hh.state && window.__hh.pid, { timeout: 60000 });
    page.tag = tag;
    pages.push(page);
  }
  const page = pages[0];
  const shot = async (name, p = page) => {
    const f = name.includes('/') ? name : path.join(path.dirname(out), `${name}.png`);
    await p.screenshot({ path: f });
    files.push(f);
    return f;
  };
  const warp = (ms) => page.evaluate((x) => window.__hh.dev.warp(x), ms);
  if (args.plant) {
    await page.evaluate(() => {
      for (const id of Object.keys(window.__hh.state.farm.objects)) window.__hh.act('plant', { id, crop: 'wheat' });
    });
  }
  if (args.script) {
    const mod = await import(pathToFileURL(path.resolve(args.script)).href);
    await mod.default({ pages, page, shot, sleep, port, warp, out: path.resolve(args.out || 'shot.png') });
  }
  await sleep(Number(args.wait || 1200));
  if (!args.script || !files.length) {
    if (pages.length === 1) await shot(out);
    else for (const p of pages) await shot(out.replace(/\.png$/, `-${p.tag}.png`), p);
  }
  const fps = await page.evaluate(() => window.__hh.view.stats());
  console.log(JSON.stringify({ ok: errors.length === 0, fps, errors, files }));
  if (errors.length) process.exitCode = 1;
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e), errors, files, serverLog: serverLog.slice(-600) }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
  if (!args.data) fs.rmSync(dataDir, { recursive: true, force: true });
}
