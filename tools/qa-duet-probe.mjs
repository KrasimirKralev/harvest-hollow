// The Sweetheart Cake duet (GDD §6.2 #7, L10) on a farm kept by tools/qa-playtest.mjs --keep, through the real Bakery panel with two clients.
//
//   node tools/qa-duet-probe.mjs --port 3321 --data /tmp/hh-qa-XXXX [--out docs/qa/wave1]
//
// 1. gets the ingredients the way a couple would (plant Wheat and Strawberries, feed and collect the animals, queue Cream, Flour and
//    Butter, with dev time warps in between), 2. presses "Cook together" with the partner's screen NOT showing the Bakery (does the
//    partner learn about it?), 3. presses it on both screens within a second (does the duet happen, with the bonus?).
// Output: <out>/duet-probe.json, <out>/shots/DUET-*.png. Never touches :3000, :3300 or ./data.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...a) => console.error('[duet]', ...a);
const result = { steps: [], notes: [] };
const step = (name, ok, detail = '') => { result.steps.push({ name, ok: Boolean(ok), detail }); say(ok ? 'ok  ' : 'FAIL', name, detail); };

let serverLog = '';
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(port), HH_DATA_DIR: path.resolve(args.data), HH_DEV: '1', HH_TZ: 'Europe/Sofia' }, stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

function reclaim(slot, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const cid = `dp${slot}${Math.floor(Math.random() * 1e4)}`.slice(0, 8);
    const t = setTimeout(() => reject(new Error('reclaim timeout')), 15000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', proto: PROTOCOL_VERSION, cid, claim: { slot, name, reclaim: true } })));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === 'welcome' && m.token) { clearTimeout(t); ws.close(); resolve(m.token); }
      else if (m.t === 'deny') { clearTimeout(t); ws.close(); reject(new Error(`denied ${m.code}`)); }
    });
  });
}

let P = {};
/** Jump game time, then let both pages' clock estimates catch up (they re-sync by pinging). */
const warp = async (ms) => {
  const target = (await (await fetch(`http://127.0.0.1:${port}/api/dev/warp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms }) })).json()).serverNow;
  await Promise.all(Object.values(P).map((p) => p.evaluate(async (t) => {
    for (let i = 0; i < 200 && window.__hh.serverNow() < t - 300; i++) { window.__hh.net.ping(); await new Promise((r) => setTimeout(r, 40)); }
  }, target)));
  return target;
};
let browser;
try {
  for (let i = 0; i < 100 && !serverLog.includes('running at'); i++) await sleep(100);
  if (!serverLog.includes('running at')) throw new Error(`server did not start: ${serverLog.slice(-400)}`);
  const tokens = { p1: await reclaim('p1', 'Rowan'), p2: await reclaim('p2', 'Mia') };
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720', '--mute-audio'],
  });
  for (const pid of ['p1', 'p2']) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    page.setDefaultTimeout(120000);
    await page.evaluateOnNewDocument((tok, p) => { try { localStorage.setItem('hh.tokens', JSON.stringify({ [p]: tok })); } catch { /* none */ } }, tokens[pid], pid);
    page.on('pageerror', (e) => result.notes.push(`${pid} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') result.notes.push(`${pid} console: ${m.text().slice(0, 200)}`); });
    await page.goto(`http://localhost:${port}/?slot=${pid}&quality=low`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => window.__hh && window.__hh.state && window.__hh.pid, { timeout: 240000 });
    P[pid] = page;
    await page.evaluate(() => { window.__rej = []; window.__hh.store.on('reject', (e) => window.__rej.push(`${e.type} ${e.code}${e.local ? ' (local)' : ''} ${JSON.stringify(e.args).slice(0, 70)}`)); });
  }
  await sleep(2000);
  const st = (p) => P[p].evaluate(() => JSON.parse(JSON.stringify(window.__hh.state)));
  const act = async (p, type, a) => {
    const r = await P[p].evaluate(([t, x]) => { const r0 = window.__hh.act(t, x); return { ok: Boolean(r0 && r0.ok), code: r0 && r0.code }; }, [type, a]);
    if (!r.ok) say(`  ${type} ${JSON.stringify(a).slice(0, 90)} -> ${r.code}`);
    return r;
  };
  const settle = async (p) => {
    await P[p].waitForFunction(() => window.__hh.pending === 0, { timeout: 15000, polling: 25 }).catch(() => {});
    const rej = await P[p].evaluate(() => window.__rej.splice(0));
    if (rej.length) say(`  rejects (${p}): ${rej.join(' | ')}`);
  };
  const shot = async (name, p = 'p1') => { await P[p].evaluate(() => window.__hh.view.setQuality('high')).catch(() => {}); await sleep(1200); await P[p].screenshot({ path: path.join(SHOTS, `DUET-${name}.png`) }); await P[p].evaluate(() => window.__hh.view.setQuality('low')).catch(() => {}); };
  const idsOf = (s, def) => Object.entries(s.farm.objects).filter(([, o]) => o.def === def).map(([id]) => id);

  // ---- 1. the ingredients ------------------------------------------------------------------------------------------------------
  await warp(26 * 3_600_000);                                  // a day passes: everything is ripe
  await sleep(1500);
  let s = await st('p1');
  const bakery = idsOf(s, 'bakery')[0];
  const dairy = idsOf(s, 'dairy')[0];
  const mill = idsOf(s, 'mill')[0];
  if (!bakery || !dairy || !mill) throw new Error(`the farm lacks a building: bakery ${bakery} dairy ${dairy} mill ${mill}`);
  const plots = idsOf(s, 'plot');
  const homes = [...idsOf(s, 'coop'), ...idsOf(s, 'cow_barn')];
  const buildings = Object.entries(s.farm.objects).filter(([, o]) => Array.isArray(o.queue)).map(([id]) => id);
  await act('p1', 'harvest', { ids: plots });
  await act('p1', 'tend', { ids: homes });
  await act('p1', 'collectTray', { ids: buildings });
  await settle('p1');
  s = await st('p1');
  say('after the sweep: inventory', JSON.stringify(s.farm.inventory), 'coins', s.farm.wallet.coins);
  const empty = plots.filter((id) => !s.farm.objects[id].crop);
  await act('p1', 'plant', { ids: empty.slice(0, 4), crop: 'strawberry' });
  await act('p1', 'plant', { ids: empty.slice(4, 14), crop: 'wheat' });
  await act('p1', 'craft', { id: dairy, recipe: 'cream' });
  await settle('p1');
  await warp(62 * 60_000);
  await sleep(1500);
  await act('p1', 'harvest', { ids: plots });
  await act('p1', 'collectTray', { ids: buildings });
  await settle('p1');
  s = await st('p1');
  say('before the crafts: inventory', JSON.stringify({ wheat: s.farm.inventory.wheat, cream: s.farm.inventory.cream, milk: s.farm.inventory.milk, egg: s.farm.inventory.egg, strawberry: s.farm.inventory.strawberry }));
  await act('p1', 'craft', { id: mill, recipe: 'flour' });
  await act('p1', 'craft', { id: mill, recipe: 'flour' });
  await act('p1', 'craft', { id: dairy, recipe: 'butter' });
  await settle('p1');
  s = await st('p1');
  say('queues after the crafts:', JSON.stringify({ mill: s.farm.objects[mill].queue.map((q) => [q.r, q.e - q.s]), dairy: s.farm.objects[dairy].queue.map((q) => [q.r, q.e - q.s]) }), 'now', await P.p1.evaluate(() => window.__hh.serverNow()));
  await warp(40 * 60_000);
  await sleep(1500);
  await act('p1', 'collectTray', { ids: buildings });
  await settle('p1');
  s = await st('p1');
  say('overflow:', JSON.stringify(s.farm.overflow));
  say('queues after the last collect:', JSON.stringify({ mill: s.farm.objects[mill].queue.map((q) => [q.r, q.e]), dairy: s.farm.objects[dairy].queue.map((q) => [q.r, q.e]) }), 'now', await P.p1.evaluate(() => window.__hh.serverNow()), 'inv', JSON.stringify(s.farm.inventory));
  const need = { flour: 2, egg: 2, butter: 1, strawberry: 2 };
  const have = Object.fromEntries(Object.keys(need).map((i) => [i, (s.farm.inventory[i] ?? 0) + (s.farm.overflow[i] ?? 0)]));   // the Barn is full: new goods wait in the overflow
  step('the couple has the Sweetheart Cake ingredients', Object.entries(need).every(([i, q]) => have[i] >= q), JSON.stringify(have));
  if (!Object.entries(need).every(([i, q]) => have[i] >= q)) throw new Error('ingredients missing');
  // the Bakery slots must be free
  const bq = s.farm.objects[bakery].queue.length;
  result.bakery = { slots: s.farm.objects[bakery].slots, queued: bq };

  // ---- 2. the partner does not look at the Bakery -----------------------------------------------------------------------------
  const openBakery = (p) => P[p].evaluate((id) => window.__hh.ui.panels.open('building', { id }), bakery);
  await openBakery('p1');
  await sleep(1200);
  await shot('1-A-bakery-panel', 'p1');
  const btnInfo = await P.p1.evaluate(() => { const b = document.querySelector('[data-duet="sweetheart_cake"]'); return b ? { text: b.textContent.trim(), disabled: b.disabled, title: b.title } : null; });
  step('the Bakery panel shows "Cook together" for the Sweetheart Cake', Boolean(btnInfo), JSON.stringify(btnInfo));
  const beforeB = await P.p2.evaluate(() => ({ toasts: [...document.querySelectorAll('#toasts > *, #banners > *')].map((x) => x.textContent.trim()), feed: document.getElementById('feed')?.innerText ?? '' }));
  const t0 = Date.now();
  await P.p1.evaluate(() => document.querySelector('[data-duet="sweetheart_cake"]').click());
  await settle('p1');
  // what does Mia see in the next 3.5 seconds, with the Bakery closed on her screen?
  const seen = [];
  for (let i = 0; i < 7; i++) {
    await sleep(500);
    seen.push(await P.p2.evaluate(() => ({ toasts: [...document.querySelectorAll('#toasts > *, #banners > *')].map((x) => x.textContent.trim()), panels: [...document.querySelectorAll('#panels > section, #panels > div')].filter((e) => e.offsetParent !== null).map((e) => e.id), feed: (document.getElementById('feed')?.innerText ?? '').slice(-160) })));
  }
  await shot('2-B-partner-sees', 'p2');
  const clue = seen.some((x) => /cook|duet|together/i.test(x.toasts.join(' ')) || x.panels.length > 0);
  s = await st('p1');
  const joint = s.farm.objects[bakery].joint;
  result.partnerView = { elapsedMs: Date.now() - t0, seen: seen.slice(0, 3), before: beforeB, joint };
  step('the partner is told about the pending Duet (a toast, a banner or a panel), Bakery closed on her screen', clue, JSON.stringify(seen.map((x) => x.toasts)));
  step('the first press opened a joint slot', Boolean(joint) || s.farm.objects[bakery].queue.length === bq, JSON.stringify(joint ?? 'lapsed'));
  await sleep(3500);                                              // the window lapses

  // ---- 3. both press, panels open on both screens ---------------------------------------------------------------------------------
  await openBakery('p1');
  await openBakery('p2');
  await sleep(1500);
  const before = await st('p1');
  const hearts0 = { p1: before.players.p1.hearts, p2: before.players.p2.hearts };
  const xp0 = { p1: before.players.p1.xp, p2: before.players.p2.xp };
  const press = (p) => P[p].evaluate(() => { const b = document.querySelector('[data-duet="sweetheart_cake"]'); if (!b || b.disabled) return { clicked: false, disabled: Boolean(b && b.disabled) }; b.click(); return { clicked: true }; });
  const [r1, r2] = await Promise.all([press('p1'), (async () => { await sleep(700); return press('p2'); })()]);
  await Promise.all([settle('p1'), settle('p2')]);
  await sleep(800);
  const after = await st('p1');
  const q = after.farm.objects[bakery].queue.at(-1);
  step('both press within a second: the cake is queued as a Duet at normal time', Boolean(q && q.duet === true && !q.slow), JSON.stringify({ presses: [r1, r2], queued: q }));
  step('each farmer gets a Heart for it', after.players.p1.hearts > hearts0.p1 && after.players.p2.hearts > hearts0.p2, `hearts ${JSON.stringify(hearts0)} -> ${JSON.stringify({ p1: after.players.p1.hearts, p2: after.players.p2.hearts })}`);
  result.xp = { before: xp0, after: { p1: after.players.p1.xp, p2: after.players.p2.xp } };
  await shot('3-A-duet-queued', 'p1');
  await shot('3-B-duet-queued', 'p2');
  const feed = await P.p1.evaluate(() => document.getElementById('feed')?.innerText ?? '');
  result.feedA = feed.slice(-300);
  result.craftedAt = q ? { s: q.s, e: q.e, minutes: Math.round((q.e - q.s) / 60000) } : null;
} catch (e) {
  result.error = String(e && e.stack || e);
  say('ERROR', e.message);
  say('server log tail:', serverLog.slice(-2500));
} finally {
  fs.writeFileSync(path.join(OUT, 'duet-probe.json'), JSON.stringify(result, null, 2));
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
}
