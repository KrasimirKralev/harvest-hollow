#!/usr/bin/env node
// Option 2, proven both ways in a real browser (release 1.0 O3; docs/qa/release/option2.md D11 test 6, D12). Two
// servers from one tree: the "Farmbox" (single mode, HH_ASSET_ORIGIN = the host as the browser reaches it) and the
// "public host" (multi mode), each behind its own relay (tools/throttle-proxy.mjs), reached by Chrome as two real
// origins (farmbox.test, cloud.test) through --host-resolver-rules. Scenarios:
//   match        every game file from the host, 0 console errors, a badge drew (no tainted canvas), a music deck's
//                analyser peak > 0.01, the page <= 36 KB gzip
//   mismatch     the host runs another build (one changed file): the page serves itself
//   down         no host at all: the page serves itself
//   stale        the handshake said match, then the host moved to another build: the watchdog falls back
//   refused      the host's address refuses connections: the watchdog falls back
//   hanging      the host accepts and never answers: the stall watchdog falls back after 10 s
//   bg-iphone    match, in Bulgarian on an iPhone 13: the BG catalogs and the Cyrillic font from the host
//   no-support   a browser without the hh_sri cookie gets the self page, whose probe sets the cookie; the next page is
//                the host variant
//   late         the host goes away after the farm is up: the next host file fails, the page offers "Reload", and
//                Reload comes back with every file from the Farmbox
//   node tools/e2e-assets.mjs --port 4513 [--only match,stale] [--root <tree>]
//   node tools/e2e-assets.mjs --port 4513 --throttle 85,550 [--runs 3] [--save <dir>] [--devices iphone13] [--quick]
//        the D12 measurement: option 2
//        cold (median of runs) desktop and iPhone 13 on the owners' save, warm reload, post-deploy, ?assets=self
// Ports: Farmbox :4513 behind :4512, host :4510 behind :4511 (infra's block; HH_PORT_BASE moves the block). Run it ALONE, through
// .scratch/release/browser-slot.sh. Exits non-zero on any failed check. Results in docs/qa/release/build/infra/e2e-assets/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startThrottle } from './throttle-proxy.mjs';
import { REPO, PORTS, LINKS, sleep, median, parseArgs, freshData, startServer, slotToken, launch, measureBoot, pageSize, waitAssets,
  contactSheet, loadavg, SUPPORT_COOKIE } from './boot-perf.mjs';

// HH_ASSETS_OUT / HH_ASSETS_SCRATCH: another lane's evidence and scratch folders (the integrator's quiet-window run)
const OUT = path.resolve(REPO, process.env.HH_ASSETS_OUT || 'docs/qa/release/build/infra/e2e-assets');
const SCRATCH = path.resolve(REPO, process.env.HH_ASSETS_SCRATCH || '.scratch/rb-infra/e2e-assets');
const HOST_RULES = 'MAP farmbox.test 127.0.0.1, MAP cloud.test 127.0.0.1';
const FARMBOX = `http://farmbox.test:${PORTS.farmboxProxy}`;
const CLOUD = `http://cloud.test:${PORTS.hostProxy}`;
const PAGE_BUDGET = 36 * 1024;

/** A second build: a copy of the game tree with one changed file (another BUILD_HASH), node_modules linked. */
export function treeB(root = REPO, dest = path.join(SCRATCH, 'tree-b')) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const d of ['public', 'shared', 'server', 'package.json']) fs.cpSync(path.join(root, d), path.join(dest, d), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dest, 'node_modules'));
  fs.appendFileSync(path.join(dest, 'shared/net/ids.js'), '\n// e2e-assets: build B\n');
  return dest;
}

/** Patched into every page: a tap on each media element source (the music decks), to read their output. */
function deckTap() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const orig = AC.prototype.createMediaElementSource;
  AC.prototype.createMediaElementSource = function tap(el) {
    const src = orig.call(this, el);
    try {
      const an = this.createAnalyser();
      an.fftSize = 2048;
      src.connect(an);
      (window.__deckTaps ||= []).push({ el, an });
    } catch { /* the game's graph still works */ }
    return src;
  };
}

const isStatic = (p) => /^\/(js|css|assets|shared|vendor)\//.test(p) && !/^\/assets\/pwa\//.test(p);

/** Where the page's files came from: { host: n, farmboxStatic: [paths], farmboxOther: [paths] }. */
function origins(reqs) {
  const out = { host: 0, hostFailed: [], farmboxStatic: [], farmboxOther: [] };
  for (const r of reqs.values()) {
    let u;
    try { u = new URL(r.url); } catch { continue; }
    if (u.protocol === 'data:' || u.protocol === 'blob:') continue;
    if (u.hostname === 'cloud.test') {
      out.host++;
      if (r.failed || (r.status && r.status >= 400)) out.hostFailed.push(`${r.status ?? r.failed} ${u.pathname}`);
    } else if (u.hostname === 'farmbox.test') {
      (isStatic(u.pathname) ? out.farmboxStatic : out.farmboxOther).push(u.pathname + u.search.slice(0, 20));
    }
  }
  return out;
}

async function musicPeak(page) {
  return page.evaluate(async () => {
    const a = window.__hh?.audio;
    if (!a) return { err: 'no audio' };
    try { a.unlock?.(); } catch { /* fine */ }
    for (let i = 0; i < 40 && !(a.info()?.music); i++) await new Promise((r) => setTimeout(r, 250));
    a.force('day');
    let peak = 0;
    let deck = null;
    for (let i = 0; i < 60 && peak <= 0.01; i++) {
      await new Promise((r) => setTimeout(r, 250));
      for (const t of window.__deckTaps || []) {
        if (t.el.paused || !t.el.currentSrc) continue;
        const buf = new Float32Array(t.an.fftSize);
        t.an.getFloatTimeDomainData(buf);
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
        deck = t.el.currentSrc;
      }
    }
    return { peak: +peak.toFixed(4), deck, info: a.info()?.music?.track ?? null };
  });
}

async function withLab({ root = REPO, hostTree = root, host = true, hostProxy = true, farmboxEnv = {}, save = null, farm = 'new' }, fn) {
  const lab = { servers: [], proxies: [] };
  try {
    if (host) {
      lab.host = await startServer({ root: hostTree, port: PORTS.host, dataDir: freshData(path.join(SCRATCH, 'host-data')), multi: true });
      lab.servers.push(lab.host);
    }
    if (hostProxy) {
      lab.hostProxy = await startThrottle({ listen: PORTS.hostProxy, target: PORTS.host, kbps: 0, rttMs: 0 });
      lab.proxies.push(lab.hostProxy);
    }
    lab.farmbox = await startServer({ root, port: PORTS.farmbox, dataDir: freshData(path.join(SCRATCH, 'farmbox-data'), farm === 'owners' ? save : null),
      env: { HH_ASSET_ORIGIN: CLOUD, HH_ASSET_PROBE: `http://127.0.0.1:${PORTS.host}`, HH_ASSET_CHECK_MS: '5000', HH_ASSET_TIMEOUT_MS: '1500', ...farmboxEnv } });
    lab.servers.push(lab.farmbox);
    lab.farmboxProxy = await startThrottle({ listen: PORTS.farmboxProxy, target: PORTS.farmbox, kbps: 0, rttMs: 0 });
    lab.proxies.push(lab.farmboxProxy);
    lab.tokens = farm === 'owners' ? { p1: await slotToken(PORTS.farmbox, 'p1') } : null;
    lab.url = (q = '') => `${FARMBOX}/${farm === 'owners' ? '?slot=p1' : '?slot=p1&name=Rowan'}${q}`;
    return await fn(lab);
  } finally {
    for (const p of lab.proxies) await p.stop().catch(() => {});
    for (const s of lab.servers) await s.stop().catch(() => {});
  }
}

/** One boot in a fresh context: the run record plus the console errors of the LAST document only. */
async function boot(browser, lab, { device = 'desktop', lang = null, cookie = true, q = '', models = false, timeoutS = 150, onPage = null } = {}) {
  const ctx = await browser.createBrowserContext();
  const lastDoc = [];
  const r = await measureBoot({ browser, ctx, url: lab.url(q), device, tokens: lab.tokens, lang, cookies: cookie ? [SUPPORT_COOKIE] : [],
    timeoutS, waitModels: models, onCdp: (cdp, page) => {
      page.evaluateOnNewDocument(deckTap);
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) lastDoc.length = 0; });
      page.on('console', (m) => { if (m.type() === 'error') lastDoc.push(m.text().slice(0, 240)); });
      page.on('pageerror', (e) => lastDoc.push(`pageerror: ${e.message}`.slice(0, 240)));
    } });
  r.lastDocErrors = lastDoc;
  r.origins = origins(r.reqs);
  r.cookies = await r.page.cookies().catch(() => []);
  r.booted = await r.page.evaluate(() => Boolean(window.__hh?.state)).catch(() => false);
  if (onPage) r.extra = await onPage(r.page, r);
  return { r, ctx };
}

function check(list, ok, what) { list.push({ ok: Boolean(ok), what }); return ok; }

const SCENARIOS = {
  async match(browser, o) {
    return withLab({ farm: 'owners', save: o.save, root: o.root }, async (lab) => {
      await waitAssets('match');
      const c = [];
      const ps = await pageSize(PORTS.farmbox, { host: `farmbox.test:${PORTS.farmboxProxy}`, cookie: 'hh_sri=1' });
      check(c, ps.gzipBytes <= PAGE_BUDGET, `host page ${(ps.gzipBytes / 1024).toFixed(1)} KB gzip <= 36 KB`);
      const { r, ctx } = await boot(browser, lab, { models: true, onPage: async (page) => ({
        music: await musicPeak(page),
        badges: await page.evaluate(() => window.__hh?.view?.stats?.()?.badges ?? null),
      }) });
      await r.page.screenshot({ path: path.join(OUT, 'match-desktop.png') });
      check(c, r.meta.assets?.startsWith(`${CLOUD}/b/`), `the host variant (${r.meta.assets})`);
      check(c, r.booted && r.milestones.playable != null, `booted and playable (${r.milestones.playable} ms)`);
      check(c, r.origins.farmboxStatic.length === 0, `every game file from the host (from the Farmbox: ${r.origins.farmboxStatic.slice(0, 6).join(', ') || 'none'})`);
      check(c, r.origins.hostFailed.length === 0, `no host file failed (${r.origins.hostFailed.slice(0, 4).join(', ') || 'none'})`);
      check(c, r.lastDocErrors.length === 0, `0 console errors (${r.lastDocErrors.slice(0, 3).join(' | ') || 'none'})`);
      check(c, (r.extra.badges ?? 0) > 0 && !r.lastDocErrors.some((e) => /Tainted|SecurityError/i.test(e)), `a badge drew, no tainted canvas (${r.extra.badges} badges)`);
      check(c, (r.extra.music.peak ?? 0) > 0.01, `a music deck's analyser peak > 0.01 (${JSON.stringify(r.extra.music)})`);
      await ctx.close();
      return { checks: c, host: r.origins.host, farmboxOther: r.origins.farmboxOther.length };
    });
  },
  async mismatch(browser, o) {
    const B = treeB(o.root);
    return withLab({ root: o.root, hostTree: B }, async (lab) => {
      await waitAssets('mismatch');
      const c = [];
      const { r, ctx } = await boot(browser, lab);
      check(c, !r.meta.assets, 'the self page');
      check(c, r.origins.host === 0, `nothing from the host (${r.origins.host})`);
      check(c, r.booted && r.milestones.playable != null, 'booted and playable');
      check(c, r.lastDocErrors.length === 0, `0 console errors (${r.lastDocErrors.slice(0, 3).join(' | ') || 'none'})`);
      await ctx.close();
      return { checks: c };
    });
  },
  async down(browser, o) {
    return withLab({ host: false, hostProxy: false, root: o.root }, async (lab) => {
      await waitAssets('down');
      const c = [];
      const { r, ctx } = await boot(browser, lab);
      check(c, !r.meta.assets && r.origins.host === 0, 'the self page, nothing from the host');
      check(c, r.booted && r.milestones.playable != null, 'booted and playable');
      check(c, r.lastDocErrors.length === 0, `0 console errors (${r.lastDocErrors.slice(0, 3).join(' | ') || 'none'})`);
      await ctx.close();
      return { checks: c };
    });
  },
  async stale(browser, o) {
    const B = treeB(o.root);
    return withLab({ root: o.root, farmboxEnv: { HH_ASSET_CHECK_MS: '600000' } }, async (lab) => {
      await waitAssets('match');
      // the host redeploys to another build after the Farmbox's last check
      await lab.host.stop();
      lab.servers = lab.servers.filter((s) => s !== lab.host);
      lab.host = await startServer({ root: B, port: PORTS.host, dataDir: freshData(path.join(SCRATCH, 'host-data')), multi: true });
      lab.servers.push(lab.host);
      const c = [];
      const { r, ctx } = await boot(browser, lab, { timeoutS: 120 });
      check(c, /[?&]assets=self\b/.test(r.meta.href), `the watchdog fell back (${r.meta.href})`);
      check(c, !r.meta.assets, 'now the self page');
      check(c, r.cookies.some((k) => k.name === 'hh_assets' && k.value === 'self'), 'the 10-minute fallback cookie');
      check(c, r.booted && r.milestones.playable != null, 'booted and playable after the reload');
      check(c, r.lastDocErrors.length === 0, `0 console errors after the reload (${r.lastDocErrors.slice(0, 3).join(' | ') || 'none'})`);
      const st = await waitAssets('mismatch', 10_000).then(() => 'mismatch', (e) => e.message);
      check(c, st === 'mismatch', `the fallback request re-checked at once (${st})`);
      await ctx.close();
      return { checks: c };
    });
  },
  async refused(browser, o) {
    return withLab({ root: o.root, hostProxy: false }, async (lab) => {
      await waitAssets('match');                                 // the Farmbox reaches the host, the browser cannot
      const c = [];
      const { r, ctx } = await boot(browser, lab, { timeoutS: 120 });
      check(c, /[?&]assets=self\b/.test(r.meta.href) && !r.meta.assets, `fell back to the self page (${r.meta.href})`);
      check(c, r.booted && r.milestones.playable != null, 'booted and playable');
      check(c, r.lastDocErrors.length === 0, `0 console errors after the reload (${r.lastDocErrors.slice(0, 3).join(' | ') || 'none'})`);
      await ctx.close();
      return { checks: c };
    });
  },
  async hanging(browser, o) {
    return withLab({ root: o.root }, async (lab) => {
      await waitAssets('match');
      lab.hostProxy.hold(true);                                  // accepts, never answers
      const c = [];
      const t0 = Date.now();
      const { r, ctx } = await boot(browser, lab, { timeoutS: 120 });
      check(c, /[?&]assets=self\b/.test(r.meta.href) && !r.meta.assets, `the stall watchdog fell back (${r.meta.href})`);
      check(c, r.booted && r.milestones.playable != null, `booted and playable (${((Date.now() - t0) / 1000).toFixed(1)} s in all)`);
      check(c, r.lastDocErrors.length === 0, `0 console errors after the reload (${r.lastDocErrors.slice(0, 3).join(' | ') || 'none'})`);
      await ctx.close();
      return { checks: c };
    });
  },
  async 'bg-iphone'(browser, o) {
    return withLab({ farm: 'owners', save: o.save, root: o.root }, async (lab) => {
      await waitAssets('match');
      const c = [];
      const { r, ctx } = await boot(browser, lab, { device: 'iphone13', lang: 'bg' });
      await r.page.screenshot({ path: path.join(OUT, 'match-iphone13-bg.png') });
      const hostPaths = [...r.reqs.values()].map((x) => x.url).filter((u) => u.startsWith(CLOUD));
      check(c, r.meta.assets?.startsWith(`${CLOUD}/b/`), 'the host variant');
      check(c, hostPaths.some((u) => /\/js\/i18n\/bg\//.test(u)), 'the Bulgarian catalogs from the host');
      check(c, hostPaths.some((u) => /\/b\/[0-9a-f]{16}\/public\/assets\/fonts\/nunito-cyrillic\.woff2/.test(u)), 'the Cyrillic font from the host, under the build');
      check(c, r.origins.farmboxStatic.length === 0, `every game file from the host (${r.origins.farmboxStatic.slice(0, 4).join(', ') || 'none'})`);
      check(c, r.booted && r.milestones.playable != null, 'booted and playable');
      check(c, r.lastDocErrors.length === 0, `0 console errors (${r.lastDocErrors.slice(0, 3).join(' | ') || 'none'})`);
      await ctx.close();
      return { checks: c };
    });
  },
  async late(browser, o) {
    return withLab({ root: o.root }, async (lab) => {
      await waitAssets('match');
      const c = [];
      const { r, ctx } = await boot(browser, lab);
      check(c, r.meta.assets?.startsWith(`${CLOUD}/b/`) && r.booted, 'booted from the host');
      // the host goes away while the farm is up; the next file the page wants from it fails
      lab.hostProxy.cut();
      await lab.hostProxy.stop();
      lab.proxies = lab.proxies.filter((p) => p !== lab.hostProxy);
      const page = r.page;
      await page.evaluate(() => { try { window.__hh.ui.panels.open('journal'); } catch { /* the image below then */ } });
      let notice = await page.waitForFunction(() => /Reload|Презареди/.test(document.querySelector('.notice')?.textContent || ''), { timeout: 8000 })
        .then(() => true, () => false);
      if (!notice) {
        await page.evaluate(() => { const i = document.createElement('img'); i.src = `${document.querySelector('meta[name="hh-assets"]').content}/assets/icons/64/hearts.png?late=1`; document.body.append(i); });
        notice = await page.waitForFunction(() => /Reload|Презареди/.test(document.querySelector('.notice')?.textContent || ''), { timeout: 8000 })
          .then(() => true, () => false);
      }
      await page.screenshot({ path: path.join(OUT, 'late-reload-notice.png') });
      check(c, notice, 'a host file that fails after the boot: the page offers "Reload"');
      if (notice) {
        const btn = await page.$('.notice button.btn--sky');
        await btn?.evaluate((b) => b.click());              // the notice may sit under an open panel's backdrop
        await page.waitForFunction(() => /[?&]assets=self\b/.test(location.search) && window.__hh?.state, { timeout: 60_000, polling: 250 })
          .catch(() => {});
        const after = await page.evaluate(() => ({ href: location.href, assets: document.querySelector('meta[name="hh-assets"]')?.content ?? null,
          booted: Boolean(window.__hh?.state) })).catch(() => ({}));
        check(c, /[?&]assets=self\b/.test(after.href || '') && !after.assets && after.booted, `Reload came back on the Farmbox's own files (${after.href})`);
      }
      await ctx.close();
      return { checks: c };
    });
  },
  async 'no-support'(browser, o) {
    return withLab({ root: o.root }, async (lab) => {
      await waitAssets('match');
      const c = [];
      const { r, ctx } = await boot(browser, lab, { cookie: false });
      check(c, !r.meta.assets, 'no hh_sri cookie: the self page');
      check(c, r.origins.host === 0, 'nothing from the host');
      let got = null;
      for (let i = 0; i < 60 && !got; i++) {
        await sleep(500);
        got = (await r.page.cookies().catch(() => [])).find((k) => k.name === 'hh_sri');
      }
      check(c, got?.value === '1', `the probe proved import-map integrity and set hh_sri (${got ? got.value : 'not set'})`);
      // the probe's wrong-hash module is refused on purpose and Chrome logs that refusal as a console error: the self
      // page's only one (the throttled run's self pass counts it)
      const firstDoc = [...r.lastDocErrors];
      check(c, firstDoc.every((e) => /sri-probe\/bad\.js/.test(e)), `the self page's console errors are only the probe's refused bad.js (${firstDoc.length}: ${firstDoc.slice(0, 2).join(' | ') || 'none'})`);
      await r.page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const meta = await r.page.evaluate(() => document.querySelector('meta[name="hh-assets"]')?.content ?? null).catch(() => null);
      check(c, meta?.startsWith(`${CLOUD}/b/`), `the next page is the host variant (${meta})`);
      check(c, r.lastDocErrors.length === 0, `0 console errors (${r.lastDocErrors.slice(0, 3).join(' | ') || 'none'})`);
      await ctx.close();
      return { checks: c };
    });
  },
};

/** Waits until no host request is in flight for 3 s (at most 90 s); the ms waited. */
async function settle(reqs) {
  const t0 = Date.now();
  let quietSince = Date.now();
  while (Date.now() - t0 < 90_000) {
    const open = [...reqs.values()].some((x) => x.url.startsWith(CLOUD) && x.end == null && !/\/assets\/audio\/music\//.test(x.url));
    if (open) quietSince = Date.now();
    else if (Date.now() - quietSince >= 3000) break;
    await sleep(250);
  }
  return Date.now() - t0;
}

/** D12: option 2 over the modelled links, owners' save, desktop and iPhone 13: cold x runs, warm, post-deploy, self. */
async function throttled(browser, o) {
  const [jk, hk] = String(o.throttle).split(',').map(Number);
  const rows = [];
  const B = treeB(o.root);
  for (const device of o.devices) {
    for (let i = 1; i <= o.runs; i++) {
      const lab = await startLabThrottled(o, jk, hk);
      try {
        await waitAssets('match', 30_000);
        const ctx = await browser.createBrowserContext();
        for (const pass of ['cold', ...(i === 1 ? ['warm'] : [])]) {
          lab.jp.reset(); lab.hp.reset();
          const r = await measureBoot({ browser, ctx, url: lab.url(), device, tokens: lab.tokens, cookies: pass === 'cold' ? [SUPPORT_COOKIE] : [],
            timeoutS: 300, shotsAt: pass === 'cold' && i === 1 ? [3, 5, 10, 15, 20, 30] : [], shotPrefix: path.join(OUT, `opt2-${device}-r${i}-${pass}`) });
          // bytes the boot took from the host over the network: the streamed music (an <audio> range request) is not boot data
          const fetched = [...r.reqs.values()].filter((x) => x.url.startsWith(CLOUD) && !x.cache && !/\/assets\/audio\/music\//.test(x.url));
          const hostBootKB = +(fetched.reduce((n, x) => n + (x.bytes || 0), 0) / 1024).toFixed(1);
          // a player stays on the page: the cold pass ends when the host link is quiet, not the moment the models land
          // (a pack still in flight then, the sounds after the models, is cancelled and the warm reload fetches it again)
          const settledMs = pass === 'cold' && i === 1 ? await settle(r.reqs) : null;
          // how each model family loaded on this page ('pack' or 'single', net/packs.js): a warm reload hits the cache
          // only when it decides as the cold boot did
          const modes = await r.page.evaluate(() => window.__hh?.packStats?.().modes ?? null).catch(() => null);
          rows.push({ device, pass, run: i, milestones: r.milestones, hostBootKB, totalMiB: +(r.bytes.total / 1048576).toFixed(2), farmboxKB: +(lab.jp.counters.down / 1024).toFixed(1),
            hostKB: +(lab.hp.counters.down / 1024).toFixed(0), hostReqs: r.bytes.byHost[`cloud.test:${PORTS.hostProxy}`]?.n ?? 0,
            hostCached: r.bytes.byHost[`cloud.test:${PORTS.hostProxy}`]?.cached ?? 0, errors: r.errors.length, firstErrors: r.errors.slice(0, 3),
            ...(pass === 'warm' ? { refetched: fetched.map((x) => `${((x.bytes || 0) / 1024).toFixed(1)} KB ${x.url.slice(CLOUD.length)}`).slice(0, 12) } : {}),
            ...(settledMs != null ? { settledMs } : {}), modes, assets: r.meta.assets, shots: r.shots, load: loadavg() });
          console.error(JSON.stringify(rows.at(-1)));
          await r.page.close().catch(() => {});
        }
        if (i === 1 && !o.quick) {
          // post-deploy: both hosts move to build B, the browser keeps build A's cache (packs keep their content version)
          await lab.restartBoth(B);
          await waitAssets('match', 30_000);
          lab.jp.reset(); lab.hp.reset();
          const r = await measureBoot({ browser, ctx, url: lab.url(), device, tokens: lab.tokens, timeoutS: 300 });
          rows.push({ device, pass: 'post-deploy', run: i, milestones: r.milestones, totalMiB: +(r.bytes.total / 1048576).toFixed(2),
            farmboxKB: +(lab.jp.counters.down / 1024).toFixed(1), hostKB: +(lab.hp.counters.down / 1024).toFixed(0), errors: r.errors.length, firstErrors: r.errors.slice(0, 3), load: loadavg() });
          console.error(JSON.stringify(rows.at(-1)));
          await r.page.close().catch(() => {});
          // ?assets=self: today's path, cold, for the same farm
          const ctx2 = await browser.createBrowserContext();
          lab.jp.reset(); lab.hp.reset();
          const s = await measureBoot({ browser, ctx: ctx2, url: lab.url('&assets=self'), device, tokens: lab.tokens, timeoutS: 400 });
          rows.push({ device, pass: 'self', run: i, milestones: s.milestones, totalMiB: +(s.bytes.total / 1048576).toFixed(2),
            farmboxKB: +(lab.jp.counters.down / 1024).toFixed(1), hostKB: +(lab.hp.counters.down / 1024).toFixed(0), errors: s.errors.length, firstErrors: s.errors.slice(0, 3), load: loadavg() });
          console.error(JSON.stringify(rows.at(-1)));
          await ctx2.close();
        }
        await ctx.close();
      } finally {
        await lab.stop();
      }
    }
  }
  const shots = rows.flatMap((r) => r.shots || []);
  if (shots.length) await contactSheet(browser, shots, path.join(OUT, 'opt2-sheet.png'), { cols: 6, width: 320, labels: shots.map((f) => path.basename(f, '.png').replace('opt2-', '')) });
  const med = {};
  for (const device of o.devices) {
    const cold = rows.filter((r) => r.device === device && r.pass === 'cold');
    med[device] = { milestones: Object.fromEntries(Object.keys(cold[0]?.milestones || {}).map((k) => [k, median(cold.map((r) => r.milestones[k]))])),
      farmboxKB: median(cold.map((r) => r.farmboxKB)), totalMiB: median(cold.map((r) => r.totalMiB)) };
  }
  const bars = [];
  for (const [device, m] of Object.entries(med)) {
    bars.push({ ok: m.milestones.painting != null && m.milestones.painting <= 3000, what: `${device}: painting ${m.milestones.painting} ms <= 3 s` });
    bars.push({ ok: m.milestones.playable != null && m.milestones.playable <= 15_000, what: `${device}: playable ${m.milestones.playable} ms <= 15 s` });
    bars.push({ ok: m.milestones.models != null && m.milestones.models <= 35_000, what: `${device}: every model ${m.milestones.models} ms <= 35 s` });
    bars.push({ ok: m.farmboxKB <= 70, what: `${device}: ${m.farmboxKB} KB over the Farmbox link <= 70 KB` });
    const warm = rows.find((r) => r.device === device && r.pass === 'warm');
    if (warm) {
      bars.push({ ok: warm.hostBootKB < 1, what: `${device}: warm reload ${warm.hostBootKB} KB of game files from the host (0; the music stream aside)` });
      bars.push({ ok: warm.milestones.playable != null && warm.milestones.playable <= 4000, what: `${device}: warm playable ${warm.milestones.playable} ms <= 4 s` });
    }
  }
  return { rows, median: med, checks: bars };
}

async function startLabThrottled(o, jk, hk) {
  const lab = { servers: [] };
  const start = async (tree) => {
    lab.host = await startServer({ root: tree, port: PORTS.host, dataDir: freshData(path.join(SCRATCH, 'host-data')), multi: true });
    lab.farmbox = await startServer({ root: tree, port: PORTS.farmbox, dataDir: lab.farmboxData,
      env: { HH_ASSET_ORIGIN: CLOUD, HH_ASSET_PROBE: `http://127.0.0.1:${PORTS.host}`, HH_ASSET_CHECK_MS: '5000' } });
  };
  lab.farmboxData = freshData(path.join(SCRATCH, 'farmbox-data'), o.save);
  await start(o.root);
  lab.hp = await startThrottle({ listen: PORTS.hostProxy, target: PORTS.host, kbps: hk, rttMs: LINKS.cloud[1] });
  lab.jp = await startThrottle({ listen: PORTS.farmboxProxy, target: PORTS.farmbox, kbps: jk, rttMs: LINKS.funnel[1] });
  lab.tokens = { p1: await slotToken(PORTS.farmbox, 'p1') };
  lab.url = (q = '') => `${FARMBOX}/?slot=p1${q}`;
  lab.restartBoth = async (tree) => {
    await lab.farmbox.stop();
    await lab.host.stop();
    await start(tree);
  };
  lab.stop = async () => {
    await lab.jp.stop().catch(() => {});
    await lab.hp.stop().catch(() => {});
    await lab.farmbox?.stop().catch(() => {});
    await lab.host?.stop().catch(() => {});
  };
  return lab;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const port = Number(a.port || PORTS.farmbox);
  if (port !== PORTS.farmbox) throw new Error(`--port ${port}: e2e-assets runs the Farmbox on ${PORTS.farmbox} (host ${PORTS.host}, relays ${PORTS.hostProxy}, ${PORTS.farmboxProxy})`);
  const o = { root: path.resolve(a.root || REPO), save: path.resolve(a.save || path.join(REPO, '.scratch/box-save-1013')), runs: Number(a.runs || 3),
    throttle: a.throttle || null,
    // --devices desktop,iphone13 (the default: both); --quick: cold and warm only (no post-deploy, no self path)
    devices: String(a.devices || 'desktop,iphone13').split(',').filter((d) => ['desktop', 'iphone13'].includes(d)), quick: Boolean(a.quick) };
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  const browser = await launch({ gpu: a.gpu || 'gl', hostRules: HOST_RULES });
  const report = { at: new Date().toISOString(), load: [loadavg()], results: {} };
  let failed = 0;
  try {
    if (o.throttle) {
      const t = await throttled(browser, o);
      report.throttled = t;
      for (const c of t.checks) { if (!c.ok) failed++; console.log(`${c.ok ? 'ok  ' : 'FAIL'} throttle: ${c.what}`); }
    } else {
      const only = a.only ? String(a.only).split(',') : Object.keys(SCENARIOS);
      for (const name of only) {
        const t0 = Date.now();
        let res;
        try { res = await SCENARIOS[name](browser, o); } catch (err) { res = { checks: [{ ok: false, what: `crashed: ${err.message}` }] }; }
        res.seconds = +((Date.now() - t0) / 1000).toFixed(1);
        res.load = loadavg();
        report.results[name] = res;
        for (const c of res.checks) { if (!c.ok) failed++; console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${name}: ${c.what}`); }
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  report.load.push(loadavg());
  report.failed = failed;
  fs.writeFileSync(path.join(OUT, o.throttle ? 'throttled.json' : 'scenarios.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ ok: failed === 0, failed, load: report.load, out: path.relative(REPO, OUT) }));
  return failed === 0 ? 0 : 1;
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(2); });
