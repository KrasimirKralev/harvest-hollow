#!/usr/bin/env node
// The first five minutes of a new farm, played the way a new player plays them (release 1.0, ui-shell M1a; ux-first#1,
// #11, #12; ux-phone#11): a 1366 x 768 desktop in English with a mouse and the 360 x 640 phone in Bulgarian with a
// finger (CDP touch), each on its own fresh HH_DEV farm. From the farm view:
//   1. no naming gate: nothing modal over the farm at boot, and the coach's first instruction is planting
//   2. the first seed is in the ground in at most 3 clicks / taps (a plot, then Wheat in the picker)
//   3. the Hand keeps the seed: each next plot plants with one click (6 plots: the coach moves on to harvesting)
//   4. a dev warp ripens them; each ripe plot harvests with one click (the coach moves on to selling)
//   5. the naming chip shows after the first harvest (never before, never a gate)
//   6. the Market's door, then Sell: the coach's count moves (or she moves on)
// Throughout, every 500 ms: features' M1b probe (COACH_PROBE in tools/e2e-rel-features.mjs: while the coach card is
// visible the tracker is hidden or mirrors it; read from that file's text, since importing it runs its own main).
// Prints one JSON line; exits 1 when a check fails.
//
//   node tools/first-five.mjs --port 4471 [--runs "1366x768:en,Small 360:bg"] [--slow N] [--shots <dir>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, sleep, parseArgs, startServer, farmDir, launch, openPage, loadFarm, tilePoint } from './hud-audit.mjs';
import { tapAt, locate, press, settled, door, tileTap } from './tap-count.mjs';

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || 4471);
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 belong to the real services');
const slow = Math.max(1, Number(args.slow || process.env.HH_E2E_SLOW || 1));
const runs = String(args.runs || '1366x768:en,Small 360:bg').split(',').map((r) => { const [screen, lang] = r.split(':'); return { screen, lang: lang || 'en' }; });
const shots = args.shots ? path.resolve(args.shots) : null;
if (shots) fs.mkdirSync(shots, { recursive: true });

/** features' probe, from its source text (the function is evaluated in the page). */
function coachProbeSource() {
  const src = fs.readFileSync(path.join(ROOT, 'tools/e2e-rel-features.mjs'), 'utf8');
  const m = /export const COACH_PROBE = (\(\) => \{[\s\S]*?\n\});/.exec(src);
  if (!m) throw new Error('COACH_PROBE not found in tools/e2e-rel-features.mjs');
  return m[1];
}
const PROBE = coachProbeSource();

const coachMsg = (page) => page.evaluate(() => document.querySelector('#coach-slot .coach')?.dataset.msg ?? null);
const plots = (page) => page.evaluate(() => {
  const st = window.__hh.state;
  const now = window.__hh.serverNow();
  return Object.keys(st.farm.objects).sort().filter((k) => st.farm.objects[k].def === 'plot')
    .map((id) => { const o = st.farm.objects[id]; return { id, x: o.x, z: o.z, crop: o.crop?.def ?? null, ripe: Boolean(o.crop && o.crop.readyAt <= now) }; });
});

async function play(browser, { screen, lang }) {
  const desk = !/360|iPhone/i.test(screen);
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hh-first5-'));
  const dataDir = farmDir(tmp, 'fresh');
  const srv = startServer({ port, dataDir });
  const errors = [];
  const checks = [];
  const files = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), ...(detail !== '' ? { detail } : {}) });
  const tag = `${screen.replace(/\s+/g, '').toLowerCase()}-${lang}`;
  const shot = async (page, name) => { if (!shots) return; const f = path.join(shots, `${tag}-${name}.png`); await page.screenshot({ path: f }); files.push(path.relative(ROOT, f)); };
  const samples = { n: 0, visible: 0, bad: [] };
  let page = null;
  let timer = null;
  const t0 = Date.now();
  try {
    await srv.ready();
    page = await openPage(browser, { screen, lang, errors });
    await loadFarm(page, port, { slot: 'p1', name: lang === 'bg' ? 'Ана' : 'Ana', slow });
    let busy = false;
    timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await page.evaluate(`(${PROBE})()`);
        samples.n++;
        if (r.visible) samples.visible++;
        if (!r.ok && samples.bad.length < 10) samples.bad.push(r);
      } catch { /* a navigation or the page closing */ } finally { busy = false; }
    }, 500);

    // 1. no gate
    const gate = await page.evaluate(() => {
      const shown = (e) => e && !e.closest('[hidden]') && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
      const modal = [...document.querySelectorAll('[aria-modal="true"], .modal-layer')].filter(shown).map((e) => e.id || e.className);
      return { panel: window.__hh.ui.panels.top(), modal };
    });
    check('no naming gate: no panel and nothing modal over the farm at boot', !gate.panel && gate.modal.length === 0, JSON.stringify(gate));
    const first = await coachMsg(page);
    check('the coach\'s first instruction is planting', first === 'TUTORIAL:step.plant_wheat', first);
    await page.evaluate(() => { const t = document.getElementById('tip'); if (t) t.hidden = true; });
    await shot(page, '01-first-frame');

    // 2. the first seed
    let clicks = 0;
    const hit = async (x, z) => {
      if (desk) {
        await page.evaluate(([a, b]) => window.__hh.view.focus(a + 0.5, b + 0.5), [x, z]);
        await sleep(1200 * slow);
        const at = await tilePoint(page, x, z);
        if (!at) return false;
        await page.mouse.click(at.x, at.y);
      } else {
        const at = await tileTap(page, x, z, 1, slow);
        if (!at) return false;
        await tapAt(page, at.x, at.y);
      }
      clicks++;
      return true;
    };
    const pressAt = (at) => (desk ? page.mouse.click(at.x, at.y) : press(page, at));
    const tapButton = async (sels, opts = {}) => {
      const at = await settled(page, sels, opts, 15);
      if (!at) return false;
      await pressAt(at);
      clicks++;
      return true;
    };
    /** A door: the button on screen, else the Farm book first (one more click). Returns the clicks, or 0. */
    const openDoor = async (sels, log) => {
      if (!desk) return Math.max(0, (await door(page, sels, log)) % 100);
      let at = await locate(page, sels);
      if (at && at.inView) { await pressAt(at); log.push(at.label || at.sel); return 1; }
      const menu = await locate(page, ['#m-menu-btn', '[data-farmbook]']);
      if (!menu) return 0;
      await pressAt(menu);
      log.push(menu.label || 'menu');
      await sleep(900 * slow);
      at = await settled(page, sels, {});
      if (!at) return 0;
      await pressAt(at);
      log.push(at.label || at.sel);
      return 2;
    };
    let planted = null;
    for (const p of (await plots(page)).filter((q) => !q.crop)) {
      if (!(await hit(p.x, p.z))) continue;
      await sleep(900 * slow);
      if (!(await tapButton(['.seed-pop:not([hidden]) .sp-seed[data-crop="wheat"]']))) continue;
      await sleep(1500 * slow);
      if ((await plots(page)).find((q) => q.id === p.id)?.crop === 'wheat') { planted = p.id; break; }
      if (clicks > 6) break;
    }
    check('the first seed is in the ground in at most 3 clicks', planted && clicks <= 3, `${clicks} click(s)`);
    await shot(page, '02-first-seed');
    const handHolds = await page.evaluate(() => ({ id: window.__hh.controller.tool.id, crop: window.__hh.controller.tool.crop ?? null }));
    check('the Hand keeps the seed (M2)', handHolds.id === 'hand' && handHolds.crop === 'wheat', JSON.stringify(handHolds));

    // 3. five more plots, one click each
    const each = [];
    for (const p of (await plots(page)).filter((q) => !q.crop)) {
      if (each.length >= 5) break;
      const c0 = clicks;
      if (!(await hit(p.x, p.z))) continue;
      await sleep(1200 * slow);
      const ok = (await plots(page)).find((q) => q.id === p.id)?.crop === 'wheat';
      each.push(ok ? clicks - c0 : `${clicks - c0} (not planted)`);
    }
    check('each next plot plants with one click', each.length === 5 && each.every((n) => n === 1), JSON.stringify(each));
    await sleep(1500 * slow);
    const afterPlant = await coachMsg(page);
    check('six plots: the coach moves on to harvesting', afterPlant === 'TUTORIAL:step.harvest_wheat', afterPlant);
    const chipEarly = await page.evaluate(() => Boolean(document.querySelector('.coach-name:not([hidden])')));
    check('no naming chip before the first harvest', !chipEarly);
    await shot(page, '03-six-planted');

    // 4. ripe: one click each
    await page.evaluate(() => window.__hh.dev.warp(65_000));
    await sleep(2500 * slow);
    const ripe = (await plots(page)).filter((q) => q.ripe);
    const cut = [];
    for (const p of ripe) {
      const c0 = clicks;
      if (!(await hit(p.x, p.z))) continue;
      await sleep(1200 * slow);
      const left = (await plots(page)).find((q) => q.id === p.id);
      cut.push(!left?.crop ? clicks - c0 : `${clicks - c0} (still there)`);
    }
    // the step needs 6 Wheat (3 plots); a plot under the 360 HUD at this camera is skipped, not counted
    check('each ripe plot harvests with one click', cut.length >= 3 && cut.every((n) => n === 1), `${JSON.stringify(cut)} of ${ripe.length} ripe`);
    await sleep(1500 * slow);
    const afterHarvest = await coachMsg(page);
    check('the harvest done: the coach moves on to selling', afterHarvest === 'TUTORIAL:step.sell_wheat', afterHarvest);
    const chip = await page.evaluate(() => {
      const c = document.querySelector('.coach-name');
      return c ? { shown: !c.closest('[hidden]') && c.getClientRects().length > 0, text: c.textContent.trim() } : null;
    });
    check('the naming chip shows after the first harvest (a chip, not a gate)', chip?.shown && !(await page.evaluate(() => window.__hh.ui.panels.top())), JSON.stringify(chip));
    await shot(page, '04-harvested');

    // 5. sell: the Market's door, then Sell
    const c0 = clicks;
    const log = [];
    clicks += await openDoor(['[data-dock="market"]'], log);
    await sleep(1500 * slow);
    const coins0 = await page.evaluate(() => window.__hh.state.farm.wallet.coins);
    const sellOk = await tapButton(['#panels .hh-panel:not([hidden]) .pn-sell-btn']);
    await sleep(2000 * slow);
    const coins1 = await page.evaluate(() => window.__hh.state.farm.wallet.coins);
    await shot(page, '05-sold');
    await page.evaluate(() => window.__hh.ui.panels.closeAll());
    await sleep(1500 * slow);
    const afterSell = await page.evaluate(() => { const c = document.querySelector('#coach-slot .coach'); return c ? `${c.dataset.msg} ${c.dataset.params}` : null; });
    check('the Market\'s door, then Sell: two clicks', sellOk && coins1 > coins0 && clicks - c0 <= 2, `${clicks - c0} (${log.join(' > ')}) coins ${coins0} -> ${coins1}`);
    // the slip sells the quantity it shows (not always 10): the coach moved on, or its count moved
    const moved = !afterSell || !afterSell.startsWith('TUTORIAL:step.sell_wheat') || !/"have":0[,}]/.test(afterSell);
    check('the sale counts for the coach (her count moves, or she moves on)', moved, String(afterSell));
    await shot(page, '06-after-sale');
  } catch (err) {
    errors.push(`${screen}/${lang}: ${err.stack?.split('\n').slice(0, 2).join(' | ') ?? err}`);
  } finally {
    clearInterval(timer);
    await sleep(600);
    await page?.browserContext().close().catch(() => {});
    await srv.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  check('M1b probe (features): one voice in every 500 ms sample', samples.n > 10 && samples.bad.length === 0,
    `${samples.n} samples, coach visible in ${samples.visible}${samples.bad.length ? `, bad ${JSON.stringify(samples.bad.slice(0, 3))}` : ''}`);
  return { screen, lang, seconds: Math.round((Date.now() - t0) / 1000), checks, errors, files };
}

async function main() {
  const browser = await launch();
  const results = [];
  try {
    for (const r of runs) results.push(await play(browser, r));
  } finally {
    await browser.close().catch(() => {});
  }
  const fails = results.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => `${r.screen}/${r.lang}: ${c.name} (${c.detail ?? ''})`));
  const errors = results.flatMap((r) => r.errors);
  const out = { ok: fails.length === 0 && errors.length === 0, results, fails, errors, load: fs.readFileSync('/proc/loadavg', 'utf8').trim() };
  console.log(JSON.stringify(out));
  process.exitCode = out.ok ? 0 : 1;
}

await main();
