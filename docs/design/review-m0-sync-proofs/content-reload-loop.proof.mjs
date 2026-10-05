// PROOF (review-m0 H4): editing shared/content while a server runs breaks every browser that (re)loads.
// The server hashes content once at import; express serves shared/ from disk with no cache, so a
// reloaded client computes the NEW hash, sees welcome.contentHash differ and calls location.reload()
// (main.js:59) BEFORE it stores the token from that welcome:
//   (a) a farmer who already has a token reloads forever, until someone restarts the server;
//   (b) a farmer claiming a slot for the first time gets the slot claimed on the server but the token
//       is thrown away: after the reload the slot is "taken" and cannot be resumed (locked out).
// Seven lanes will edit shared/content while their servers and headless shots run.
// Works on a throwaway copy of the repo (never touches the real shared/content).
// Run: node docs/design/review-m0-sync-proofs/content-reload-loop.proof.mjs   (server on port 3303)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const PORT = 3303;
const URL0 = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-reload-proof-'));
for (const d of ['server', 'shared', 'public']) fs.cpSync(path.join(ROOT, d), path.join(tmp, d), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'));
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'));

const child = spawn(process.execPath, [path.join(tmp, 'server/index.js')], {
  env: { ...process.env, PORT: String(PORT), HH_HOST: '127.0.0.1', HH_DATA_DIR: path.join(tmp, 'data'), HH_DEV: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve) => child.stdout.on('data', (d) => { if (String(d).includes(`localhost:${PORT}`)) resolve(); }));
let browser;
const result = {};
try {
  browser = await puppeteer.launch({ executablePath: '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'] });
  // (a) p1 joins normally, then content changes on disk and p1 reloads the page.
  const a = await browser.newPage();
  await a.goto(`${URL0}/?slot=p1&name=Rowan`);
  await a.waitForFunction(() => window.__hh && window.__hh.pid === 'p1', { timeout: 15000 });
  const cfg = path.join(tmp, 'shared/content/config.js');
  fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace('coins: 300,', 'coins: 301,'));
  let loads = 0;
  a.on('load', () => { loads++; });
  await a.reload().catch(() => {});
  await sleep(8000);
  result.p1LoadsIn8s = loads;
  // (b) p2 claims a slot for the first time in a fresh profile while the hashes differ.
  const ctx = await browser.createBrowserContext();
  const b = await ctx.newPage();
  await b.goto(`${URL0}/?slot=p2&name=Mia`).catch(() => {});
  await sleep(6000);
  result.p2 = await b.evaluate(() => ({
    pid: window.__hh?.pid ?? null,
    pickerShown: !document.getElementById('slot-picker').hidden,
    tokens: localStorage.getItem('hh.tokens'),
  })).catch((e) => ({ error: e.message }));
  const st = await (await fetch(`${URL0}/api/status`)).json();
  result.serverSlots = st.slots.map((s) => `${s.pid}:${s.claimed ? 'claimed' : 'free'}`);
} finally {
  if (browser) await browser.close();
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`OBSERVED ${JSON.stringify(result)}`);
console.log('EXPECTED p1 loads once and is told to restart the server; p2 either joins or its slot stays free');
process.exitCode = result.p1LoadsIn8s > 2 || (result.p2.pid === null && result.serverSlots.includes('p2:claimed')) ? 1 : 0;
