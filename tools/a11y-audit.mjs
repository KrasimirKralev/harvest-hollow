// The accessibility gate (release 1.0 P9, critique#19 #37; promoted from the perf-a11y audit's run-a11y.mjs and
// run-contrast.mjs). On a COPY of a save (the owners' farm), on a desktop and an iPhone 13:
//   1. axe-core (WCAG 2.x A/AA, 2.2 AA, best practice) on the HUD and on every panel: no serious or moderate violation;
//   2. the new surfaces of 1.0 (Farm book, Seeds ▸, Tools ▸, the phone bar, Together, the gift sheet, the bench chip,
//      name tags): each is there, axe-clean, reachable by Tab (its opener, or focus inside it once open) and closed by
//      Escape; every button in it carries a class of docs/agent-briefs/rel-components.md (btn, chip, pn-chipbtn,
//      pn-stack, pn-chip) or one whose owner wrote why none fits (scope §7.11; DOCUMENTED_CLASSES below);
//   3. contrast on real pixels (text made transparent for a second screenshot, so text over the farm and over pictures
//      is measured too): name tags against the lawn and the chalkboard's "70 left" at 4.5:1 or more; and (QA r2 P2-06)
//      every text box axe's color-contrast left "incomplete" in a panel or tab (a see-through row, a picture or a
//      gradient behind it), with its colour blended by its ancestors' opacity: below AA fails like a violation;
//   4. on a phone (S9b, ux-phone#16): in each panel's first view the item chips (.pn-chip[data-item]) and the
//      Journal's task lines ([data-hint-item]) are at least 44 px tall (other short openers are listed, not failed).
//   5. (QA r1 P-20) every TAB of every panel, not only its first view (a panel's [role="tab"] buttons are clicked by
//      index: the Barn's filters and the Upgrades tabs carry no data-tab), and with --fresh a first-time player's farm
//      (an empty data dir): the HUD, Market (every tab), Barn, Orders and Journal. axe `critical` fails like serious.
//   6. (QA r3 P3-01) in every panel view and tab, a focus that can be seen: each kind of focusable that draws its focus
//      without a real outline (an SVG parcel's stroke, a filter, a shadow) must change part of its box by 3:1 on pixels.
// Starts its own server (temp data dir, HH_DEV=1) on --port; ONE headless browser, closed at the end.
//
//   node tools/a11y-audit.mjs --port 4481 --data <save dir: COPIED, never touched> [--fresh] [--device desktop,iphone]
//        [--out docs/qa/release/build/ui-panels/a11y] [--axe <axe.min.js>] [--root <a source tree to serve>] [--panels all|main]
//   node tools/a11y-audit.mjs --port 4481 --fresh        (the fresh-farm pass alone)
// Prints one JSON line { ok, failures, byOwner, devices, file } and exits 1 on any failure. axe comes from --axe, else
// node_modules/axe-core (a dev dependency the lead adds), else the perf-a11y audit's copy in .scratch/rel-perf-a11y/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import puppeteer, { KnownDevices } from 'puppeteer-core';
import { WebSocket } from 'ws';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const port = Number(args.port || 4481);
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
if (!args.data && !args.fresh) throw new Error('--data <a save dir> is required (the audit plays a late farm: every panel has content); --fresh adds (or alone runs) a first-time player\'s farm');
const out = path.resolve(ROOT, args.out || 'docs/qa/release/build/ui-panels/a11y');
fs.mkdirSync(out, { recursive: true });
const SERVE_ROOT = args.root ? path.resolve(ROOT, args.root) : ROOT;
const { PROTOCOL_VERSION } = await import(path.join(SERVE_ROOT, 'shared/net/protocol.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TZ = 'Europe/Sofia';

function axeSource() {
  const tries = [args.axe && path.resolve(ROOT, args.axe)];
  try { tries.push(createRequire(path.join(ROOT, 'package.json')).resolve('axe-core/axe.min.js')); } catch { /* not installed */ }
  tries.push(path.join(ROOT, '.scratch/rel-perf-a11y/axe.min.js'));
  const f = tries.find((p) => p && fs.existsSync(p));
  if (!f) throw new Error('axe-core not found: pass --axe <axe.min.js> or install the axe-core dev dependency');
  return fs.readFileSync(f, 'utf8');
}
const AXE = axeSource();

const DEVICES = {
  desktop: { viewport: { width: 1366, height: 768, deviceScaleFactor: 1 }, safe: null },
  iphone: { ...KnownDevices['iPhone 13'], safe: { top: 47, bottom: 34, left: 0, right: 0 } },
};
const devices = String(args.device || 'desktop,iphone').split(',').filter((d) => DEVICES[d]);
/** The button classes of the shared components (rel-components.md "Button classes"). */
const BUTTON_CLASSES = ['btn', 'chip', 'pn-chipbtn', 'pn-stack', 'pn-chip'];
/**
 * Classes whose owner wrote the line scope §7.11 asks for ("a new class needs a line in your notes saying why none
 * fits"): accepted, listed in the report as `documented`, not failed. Each entry names where the reason is written.
 */
const DOCUMENTED_CLASSES = new Map([
  // docs/agent-notes/rel-ui-shell.md, "Patches applied for other lanes", ui-panels' a11y findings item 3 (2026-10-14):
  // the HUD's tiles keep their own look (hud-audit and the shots measure them); `btn` / `chip` would restyle them
  ...['tool', 'dock-btn', 'm-menu-btn', 'dock-mini', 'social-btn', 'm-stat', 'm-tile', 'seed', 'tray-arrow'].map((c) => [c, 'rel-ui-shell.md (a11y item 3)']),
]);
const SERIOUS = new Set(['serious', 'critical', 'moderate']);

/**
 * The new surfaces: how to open each, its root, the opener a keyboard reaches with Tab, and the lane that owns it.
 * `phone` / `desktop` limit a surface to one layout (the phone bar). A missing surface is a failure (not built yet,
 * or renamed: either way the gate cannot vouch for it).
 */
const SURFACES = [
  { id: 'farm book', owner: 'ui-shell', opener: '[data-farmbook]', root: '#panel-menu', open: (p) => p.evaluate(() => window.__hh.ui.panels.open('menu')) },
  { id: 'tools', owner: 'ui-shell', opener: '.tool-slot[data-slot="tools"], .tool-slot[data-slot="tool"]', root: '#tools-flyout',
    open: (p) => p.evaluate(() => document.querySelector('.tool-slot[data-slot="tools"], .tool-slot[data-slot="tool"]')?.click()) },
  { id: 'seeds', owner: 'ui-shell', opener: '.tool[data-tool="seed_bag"], .tool-slot[data-slot="seeds"]', root: '#seed-tray, .seed-strip',
    open: (p) => p.evaluate(() => window.__hh.ui.openSeeds?.(true)) },
  { id: 'together', owner: 'ui-shell', opener: '#together-btn', root: '#together-menu', desktop: true,
    open: (p) => p.evaluate(() => document.getElementById('together-btn')?.click()) },
  // a phone has no Together button: the together buttons are the Farm book's Together group (ui-shell P-12)
  { id: 'together', owner: 'ui-shell', opener: '[data-farmbook], #m-menu-btn', root: '#panel-menu .m-sec[data-book="together"] #together-menu', phone: true,
    open: (p) => p.evaluate(() => window.__hh.ui.farmBook.open('together')) },
  { id: 'gift sheet', owner: 'features', root: '#panel-gift', open: (p) => p.evaluate(() => window.__hh.ui.panels.open('gift')), sheet: true },
  { id: 'bench chip', owner: 'ui-shell', root: '.bench-chip', open: async () => {}, passive: true },
  { id: 'phone bar', owner: 'ui-shell', root: '#dock', open: async () => {}, passive: true, phone: true },
  // a tag shows near the camera, on hover, or for the home whose card is open (render/name-tags.js tagWanted): the
  // audit says "this home's card is open" for the home of the first named animal (life-feel's own window event)
  { id: 'name tags', owner: 'life-feel', root: '#name-tags', passive: true, tags: true,
    open: async (p) => { await p.evaluate(() => {
      const st = window.__hh.state.farm;
      // a named animal is an object of its own with a `home`; the camera eases to that home and zooms in
      const id = Object.keys(st.names || {}).find((k) => st.objects?.[k]?.home && st.objects[st.objects[k].home]);
      if (!id) return;
      const home = st.objects[id].home;
      const ho = st.objects[home];
      window.__hh.view?.focus?.(ho.x, ho.z);
      window.__hh.view?.camera?.zoom?.(0.55);
      window.dispatchEvent(new CustomEvent('hh:home-card', { detail: { id: home } }));
    }); await sleep(1500); } },
];

/** The lane that owns what a selector points at (release-scope §6), for the report. */
function ownerOf(target) {
  const t = String(target);
  if (/#panel-(helper|hx)|\.hx-|harness/.test(t)) return 'harvey';
  if (/#panel-gift|#tracker|\.goal|\.tracker|\.tc-/.test(t)) return 'features';
  if (/\.toast|#banners|#toasts|\.notice|#name-tags|\.levelup|\.recap/.test(t)) return 'life-feel';
  if (/#panel-(menu|settings|avatar)|#hud|#dock|\.dock|\.tool|#tools-flyout|#seed-tray|\.seed-strip|#toolbar|#social|#together|\.together|\.bench-chip|#slot-picker|\.coach/.test(t)) return 'ui-shell';
  if (/#panel-/.test(t)) return 'ui-panels';
  if (/canvas|#world/.test(t)) return 'render-look';
  return 'lead';
}

function serve(dataDir) {
  const env = { ...process.env, PORT: String(port), HH_DATA_DIR: dataDir, HH_DEV: '1', HH_TZ: TZ, HH_HARNESS_MOCK: '1' };
  const proc = spawn(process.execPath, ['server/index.js'], { cwd: SERVE_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  return {
    ready: async () => { for (let i = 0; i < 300 && !log.includes('running at'); i++) await sleep(100); if (!log.includes('running at')) throw new Error(`server: ${log.slice(-600)}`); },
    stop: async () => { if (proc.exitCode !== null) return; proc.kill('SIGTERM'); await new Promise((r) => proc.once('exit', r)); },
  };
}

/** A copy of the save (never the original): { dir, names, bench } (the first two-seat bench, for the partner). */
function copySave(src, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hh-a11y-${tag}-`));
  if (!src) return { dir, names: {}, bench: null };      // --fresh: an empty data dir, a first-time player's farm
  fs.cpSync(path.resolve(ROOT, src), dir, { recursive: true });
  try {
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'farm.json'), 'utf8')).state;
    const id = Object.keys(st.farm.objects).sort().find((k) => /bench|swing|arbor/.test(st.farm.objects[k].def)) ?? null;
    const bench = id ? { id, x: st.farm.objects[id].x, z: st.farm.objects[id].z } : null;
    return { dir, names: { p1: st.players?.p1?.name, p2: st.players?.p2?.name }, bench };
  } catch { return { dir, names: {}, bench: null }; }
}

/**
 * The partner (an open socket) walks to the bench and sits down, like a player: the server checks the reach from the
 * pose it relays (TOO_FAR until the avatar arrived), so the socket keeps walking and asks again. True once seated.
 */
async function sitOn(ws, bench) {
  if (!ws || !bench) return false;
  let ok = false;
  let seq = 0;
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.t === 'd' && Array.isArray(m.ops) && m.ops.some((o) => Array.isArray(o.p) && o.p[2] === 'bench')) ok = true;
  });
  for (let i = 0; i < 120 && !ok; i++) {
    ws.send(JSON.stringify({ t: 'mv', x: bench.x + 0.5, z: bench.z - 0.6, f: 0, a: 1 }));
    if (i % 15 === 14) ws.send(JSON.stringify({ t: 'act', seq: ++seq, type: 'sit', args: { id: bench.id } }));
    await sleep(200);
  }
  return ok;
}

function claim(slot, name, { keep = false } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const cid = `a11${slot}${Math.floor(Math.random() * 1e4)}`.slice(0, 8);
    const tm = setTimeout(() => reject(new Error('claim timeout')), 30000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', proto: PROTOCOL_VERSION, cid, claim: { slot, name, reclaim: true } })));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === 'welcome' && m.token) { clearTimeout(tm); if (!keep) ws.close(); resolve({ token: m.token, ws }); }
      else if (m.t === 'deny') { clearTimeout(tm); ws.close(); reject(new Error(`denied ${m.code}`)); }
    });
    ws.on('error', reject);
  });
}

const failures = [];
const byOwner = {};
const report = { devices: {} };
const fail = (dev, owner, what) => {
  failures.push(`${dev}: ${what}`);
  (byOwner[owner] ||= []).push(`${dev}: ${what}`);
};

async function axe(page, include) {
  await page.evaluate(AXE);
  return page.evaluate(async (inc) => {
    const ctx = inc ? { include: [inc], exclude: [['canvas']] } : { exclude: [['canvas'], ['#world']] };
    const res = await window.axe.run(ctx, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      resultTypes: ['violations', 'incomplete'],
    });
    const out = res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length,
      nodes: v.nodes.slice(0, 6).map((n) => ({ target: n.target.join(' ').slice(0, 140), summary: (n.failureSummary || '').split('\n').slice(1, 2).join(' ').slice(0, 160) })) }));
    // QA r2 P2-06: text axe could not decide (a see-through row, a picture or a gradient behind it) is measured on the
    // real pixels by the caller (incompleteContrast); the gate passed while every "later" perk was 3.84:1
    const open = res.incomplete.find((v) => v.id === 'color-contrast');
    if (open) {
      out.push({ id: 'color-contrast-incomplete', impact: 'incomplete', help: open.help, n: open.nodes.length,
        nodes: open.nodes.slice(0, 160).map((n) => ({ target: n.target.join(' '), why: n.any?.[0]?.data?.messageKey ?? '' })) });
    }
    return out;
  }, include ?? null).catch((e) => [{ id: 'axe-error', impact: 'serious', help: String(e).slice(0, 160), n: 1, nodes: [] }]);
}

/**
 * QA r2 P2-06: the text axe left "incomplete" for color-contrast, measured on pixels like the name tags: each node is
 * brought into view (its scroller scrolled), the glyphs made transparent for the background, the text's own colour
 * blended by the opacity of its ancestors. Fails below 4.5:1 (3:1 large) like a violation. Returns the measurements.
 */
async function incompleteContrast(page, dev, where, list) {
  try {
    return await measureIncomplete(page, dev, where, list);
  } catch (e) {
    // a busy machine can time a screenshot out: say so (the screen was not vouched for), never stop the whole gate
    fail(dev, 'lead', `contrast on pixels could not run at ${where}: ${String(e).split('\n')[0].slice(0, 120)}`);
    return [];
  }
}

async function measureIncomplete(page, dev, where, list) {
  const inc = list.find((v) => v.id === 'color-contrast-incomplete');
  if (!inc || !inc.nodes.length) return [];
  let left = inc.nodes.map((n) => n.target);
  const out = [];
  for (let round = 0; left.length && round < 40; round++) {
    // inline 'center': a tab of a strip that runs off its sheet comes clear of the strip's "‹" / "›" cue (QA r4: 'nearest'
    // left "Sell" and "Trees" under the cue's fade and measured them through it, 4.13:1); the cue's classes follow the
    // strip's scroll event, so two frames and a moment before measuring
    await page.evaluate((sel) => { try { document.querySelector(sel)?.scrollIntoView({ block: 'center', inline: 'center' }); } catch { /* odd selector */ } }, left[0]).catch(() => {});
    await page.evaluate(() => Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      new Promise((r) => setTimeout(r, 3000))])).catch(() => {});
    await sleep(250);
    // inside the screen and inside its scroller's view, clear of the "more below" fade at the scroller's foot and of a tab
    // strip's "‹" / "›" cue (a deliberate fade over the tabs past that edge, like the "more below" fade)
    const seen = await page.evaluate((sels) => sels.filter((sel) => {
      let e = null;
      try { e = document.querySelector(sel); } catch { return false; }
      if (!e) return false;
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth)) return false;
      const strip = e.closest('.hh-tabs, .lg-hub');
      if (strip) {
        const q = strip.getBoundingClientRect();
        if ((strip.classList.contains('more-l') && r.left < q.left + 34) || (strip.classList.contains('more-r') && r.right > q.right - 34)) return false;
      }
      const sc = e.closest('.hh-panel-scroll');
      if (!sc) return true;
      const b = sc.getBoundingClientRect();
      return r.top >= b.top && r.bottom <= b.bottom - 40;
    }), left).catch(() => []);
    const gone = seen.length ? seen : [left[0]];
    if (seen.length) out.push(...await pixelContrast(page, seen.join(', '), 160));
    left = left.filter((x) => !gone.includes(x));
  }
  // words only: a glyph (★ ✓ ♡) is an icon, outside 1.4.3, and a system symbol font may ignore the transparent colour
  for (const c of out) {
    if (!(c.median >= c.need) && !c.outlined && !c.inactive && !c.glyph) {
      fail(dev, ownerOf(where), `contrast on pixels (axe incomplete) at ${where}: ${c.what} "${c.text}" ${c.median}:1 (need ${c.need}${c.glyph ? ', a glyph' : ''})`);
    }
  }
  return out;
}

/** The report keeps, per screen, how many undecided text boxes were measured on pixels and the lowest of them. */
function noteIncomplete(rep, key, measured) {
  if (!measured.length) return;
  const low = measured.reduce((a, b) => (b.median < a.median ? b : a));
  (rep.pixelContrast ||= {})[key] = { n: measured.length, lowest: `${low.median}:1 "${low.text}"`, under: measured.filter((c) => !(c.median >= c.need)).length };
}

function axeFailures(dev, where, list) {
  for (const v of list) {
    if (!SERIOUS.has(v.impact)) continue;
    for (const n of v.nodes.length ? v.nodes : [{ target: where }]) fail(dev, ownerOf(`${where} ${n.target}`), `axe ${v.id} (${v.impact}) at ${where}: ${n.target} ${n.summary ?? ''}`.trim());
  }
}

/**
 * Contrast of text boxes against the real pixels under them (glyphs made transparent for the second picture). The
 * text's colour is blended by its alpha and every ancestor's opacity (QA r2 P2-06: a row at .66 paints its words
 * lighter than their computed colour). Only elements with words of their own count.
 */
async function pixelContrast(page, selector, max = 30) {
  const boxes = await page.evaluate((sel, cap) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length
    && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).slice(0, cap).map((e) => {
    const r = e.getBoundingClientRect();
    let alpha = 1;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity);
    const text = e.textContent.trim();
    const cs = getComputedStyle(e);
    // SVG text paints with `fill` (its `color` is only inherited), and a stroke drawn under it (paint-order: stroke) is a
    // halo like a text-shadow, while the halo is not itself see-through
    const svg = e instanceof SVGElement;
    const halo = svg && cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0 && alpha >= 0.95;
    return { text: text.slice(0, 30), x: r.left, y: r.top, w: r.width, h: r.height, color: svg && cs.fill.startsWith('rgb') ? cs.fill : cs.color, alpha,
      fs: svg ? r.height * 0.8 : parseFloat(cs.fontSize), fw: Number(cs.fontWeight) || 400,
      outline: halo ? 'stroke' : cs.textShadow,
      what: `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`.slice(0, 60),
      // a glyph with no letter or digit (★ ✓ ♡) is a graphical object: 3:1 (WCAG 1.4.11), not the 4.5:1 of text
      glyph: !/[\p{L}\p{N}]/u.test(text),
      // an inactive control's words are exempt (WCAG 1.4.3 "incidental"; axe skips disabled controls the same way)
      inactive: Boolean(e.closest('[aria-disabled="true"], :disabled')) };
  }), selector, max);
  if (!boxes.length) return [];
  const tag = await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; text-shadow: none !important; -webkit-text-stroke: 0 !important; }' });
  await sleep(150);
  const shot = await page.screenshot({ encoding: 'base64' });
  await tag.evaluate((s) => s.remove());
  return page.evaluate(async (b64, list) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const k = img.width / innerWidth;
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, gg, b]) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    const cr = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    return list.map((bx) => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(bx.color);
      const fg = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
      const a = Math.max(0, Math.min(1, (m && m[4] !== undefined ? Number(m[4]) : 1) * (bx.alpha ?? 1)));
      const d = g.getImageData(Math.max(0, Math.floor(bx.x * k)), Math.max(0, Math.floor(bx.y * k)), Math.max(1, Math.floor(bx.w * k)), Math.max(1, Math.floor(bx.h * k))).data;
      const all = [];
      for (let i = 0; i < d.length; i += 4 * 7) {
        const bg = [d[i], d[i + 1], d[i + 2]];
        all.push(cr(fg.map((c, j) => a * c + (1 - a) * bg[j]), bg));
      }
      all.sort((a, b) => a - b);
      const large = bx.fs >= 24 || (bx.fs >= 18.66 && bx.fw >= 700);
      return { text: bx.text, need: large || bx.glyph ? 3 : 4.5, p10: +all[Math.floor(all.length * 0.1)]?.toFixed(2), median: +all[Math.floor(all.length / 2)]?.toFixed(2),
        outlined: Boolean(bx.outline && bx.outline !== 'none'), what: bx.what, color: bx.color, glyph: bx.glyph, inactive: bx.inactive };
    });
  }, shot, boxes);
}

/**
 * QA r3 P3-01: a keyboard focus that can be seen (WCAG 2.4.7). axe does not judge focus indicators, so every focusable
 * of a view that does not draw its focus with a real outline (an SVG shape's stroke, a filter, a box-shadow, nothing) is
 * captured not focused and focused, animations and transitions frozen: some of its box (FOCUS_MIN_PX CSS px² at least,
 * or a 1 px line along half its edge) must change by 3:1 or more. Market › Land's parcels changed by 1.19:1 at most (the
 * hover's brightening). One element per kind (tag, classes, selected or not) and device: a strip of 30 equal tiles
 * costs one measurement.
 */
const FOCUS_MIN_PX = 12;
const focusSeen = new Set();
async function focusRings(page, dev, root, where) {
  const freeze = await page.addStyleTag({ content: '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; caret-color: transparent !important; }' });
  const pick = `${root} [tabindex], ${root} button, ${root} a[href], ${root} input, ${root} select, ${root} textarea, ${root} summary`;
  const found = [];
  try {
    if (dev.startsWith('desktop')) await page.mouse.move(1, 1);
    const list = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e, i) => ({ e, i }))
      .filter(({ e }) => e.tabIndex >= 0 && e.getClientRects().length && !e.closest('[hidden], [inert], [aria-hidden="true"]') && !e.matches(':disabled'))
      .map(({ e, i }) => ({ i, svg: e instanceof SVGElement,
        sel: e.classList.contains('sel') || e.getAttribute('aria-pressed') === 'true' || e.getAttribute('aria-selected') === 'true',
        key: `${e.tagName.toLowerCase()}.${[...e.classList].filter((c) => !/^(sel|on|cur|active)$/.test(c)).sort().join('.')}`,
        label: (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30) })), pick);
    for (const x of list) {
      const kind = `${dev}|${x.key}|${x.sel}`;
      if (focusSeen.has(kind)) continue;
      focusSeen.add(kind);
      const box = await page.evaluate((sel, i) => {
        const e = document.querySelectorAll(sel)[i];
        if (!e) return null;
        e.scrollIntoView({ block: 'center', inline: 'nearest' });
        document.activeElement?.blur?.();
        const r = e.getBoundingClientRect();
        const x0 = Math.max(0, r.left - 6); const y0 = Math.max(0, r.top - 6);
        return { x: x0, y: y0, width: Math.min(innerWidth - x0, r.width + 12), height: Math.min(innerHeight - y0, r.height + 12), w: r.width, h: r.height };
      }, pick, x.i);
      if (!box || box.width < 2 || box.height < 2) continue;
      const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
      const focusIt = (sel, i) => {
        const e = document.querySelectorAll(sel)[i];
        e.focus({ preventScroll: true, focusVisible: true });
        const cs = getComputedStyle(e);
        return { focused: document.activeElement === e, visible: e.matches(':focus-visible'), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 };
      };
      // a real outline (the page's 3 px ring, or a component's own) is the indicator: nothing to measure. Asked before
      // any screenshot (most focusables have it; two shots each cost minutes on a loaded machine)
      await page.keyboard.press('Shift');
      const pre = await page.evaluate(focusIt, pick, x.i);
      await page.evaluate(() => document.activeElement?.blur?.());
      if (!pre.focused || (pre.outline && !x.svg)) continue;
      await sleep(120);
      const off = await page.screenshot({ clip, encoding: 'base64' });
      // QA r4: a panel that re-renders while the shot is taken (Market › Land redraws its map when the coins change, and
      // the late save's balloon crates pay coins on a timer) replaces the focused element, and the "focused" shot showed
      // a fresh, unfocused map: 0 px². The element must still hold the focus after the shot; else once more, then say so
      let on = null;
      let held = false;
      for (let attempt = 0; attempt < 2 && !held; attempt++) {
        await page.keyboard.press('Shift');
        const st = await page.evaluate(focusIt, pick, x.i);
        if (!st.focused) break;
        // two frames before the focused shot (the first focus after a sheet opens was once shot before its ring painted)
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await sleep(60);
        on = await page.screenshot({ clip, encoding: 'base64' });
        held = await page.evaluate((sel, i) => { const e = document.querySelectorAll(sel)[i]; return Boolean(e && e.isConnected && document.activeElement === e); }, pick, x.i);
        await page.evaluate(() => document.activeElement?.blur?.());
      }
      if (!on) continue;
      if (!held) { fail(dev, ownerOf(root), `focus lost in ${where}: ${x.key} "${x.label}" (the element was replaced or blurred while its focused shot was taken, twice)`); continue; }
      const n3 = await page.evaluate(async (a, b) => {
        const load = async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
        const A = await load(a); const B = await load(b);
        const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const lum = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
        let n = 0;
        for (let i = 0; i < Math.min(A.length, B.length); i += 4) {
          const p = lum(A, i); const q = lum(B, i);
          if ((Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05) >= 3) n++;
        }
        return Math.round(n / (devicePixelRatio * devicePixelRatio));
      }, off, on);
      const need = Math.max(FOCUS_MIN_PX, Math.round(box.w + box.h));
      found.push({ where, key: x.key, sel: x.sel, label: x.label, n3, need });
      if (n3 < need) fail(dev, ownerOf(root), `focus not visible in ${where}: ${x.key}${x.sel ? ' (selected)' : ''} "${x.label}" changes ${n3} px² by 3:1 (need ${need})`);
    }
  } finally { await freeze.evaluate((s) => s.remove()).catch(() => {}); }
  return found;
}

/** Tab from the page until focus is on `selector` (or inside it); true when reached within `max` presses. */
async function tabTo(page, selector, max = 90) {
  // no click to reset the focus: on a phone (2, 2) is the farm, and a building there opens its panel (a focus trap;
  // ui-shell P-14)
  await page.evaluate(() => { window.__hh?.ui?.panels?.closeAll?.(); document.activeElement?.blur?.(); });
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate((sel) => Boolean(document.activeElement && document.activeElement.closest(sel)), selector);
    if (hit) return true;
  }
  return false;
}

/**
 * Wait until nothing inside `sel` is mid-animation (a sheet sliding in is half transparent: axe would measure the
 * blend with the farm behind it, a false failure). Endless loops (a bobbing icon) do not count. Gives up after 6 s.
 */
const settled = (page, sel) => page.waitForFunction((s) => {
  const el = document.querySelector(s);
  if (!el) return true;
  const run = [el, ...el.querySelectorAll('*')].flatMap((e) => e.getAnimations())
    .filter((a) => a.playState === 'running' && a.effect?.getComputedTiming?.().iterations !== Infinity);
  return run.length === 0;
}, { timeout: 6000, polling: 100 }, sel).catch(() => {});

const visible = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].some((e) => !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0), sel);

/** Click each tab of panel `#id` by index (the selected one was audited already) and run axe on what it shows. */
async function everyTab(page, dev, name, id, rep) {
  const tabs = await page.evaluate((root) => [...document.querySelectorAll(`#${root} [role="tab"]`)]
    .map((b, i) => ({ i, sel: b.getAttribute('aria-selected') === 'true', off: b.getAttribute('aria-disabled') === 'true' || b.disabled,
      label: b.textContent.trim().slice(0, 24), vis: b.getClientRects().length > 0 })), id);
  for (const tb of tabs) {
    if (tb.sel || tb.off || !tb.vis) continue;
    await page.evaluate((root, i) => [...document.querySelectorAll(`#${root} [role="tab"]`)][i]?.click(), id, tb.i);
    await sleep(700);
    await settled(page, `#${id}`);
    const key = `${name}#${tb.i}:${tb.label}`;
    rep.axe[key] = await axe(page, `#${id}`);
    axeFailures(dev, `#${id} (tab ${tb.label})`, rep.axe[key]);
    noteIncomplete(rep, key, await incompleteContrast(page, dev, `#${id} (tab ${tb.label})`, rep.axe[key]));
    (rep.focus ||= {})[key] = await focusRings(page, dev, `#${id}`, `#${id} (tab ${tb.label})`);
  }
  rep.tabs = (rep.tabs ?? 0) + tabs.filter((x) => !x.sel && !x.off && x.vis).length;
}

/** QA r1 P-20: a first-time player's farm (an empty data dir): the HUD, Market (every tab), Barn, Orders, Journal. */
async function freshPass(dev) {
  const rep = report.devices[`${dev}-fresh`] = { axe: {}, tabs: 0 };
  const { dir } = copySave(null, `${dev}-fresh`);
  srv = serve(dir);
  await srv.ready();
  const me = await claim('p1', 'A');
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const d = DEVICES[dev];
  if (d.userAgent) await page.setUserAgent(d.userAgent);
  await page.setViewport(d.viewport);
  if (d.safe) { const cdp = await page.createCDPSession(); try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: d.safe }); } catch { /* old */ } }
  await page.evaluateOnNewDocument((tok, l) => { try { localStorage.setItem('hh.tokens', JSON.stringify({ p1: tok })); localStorage.setItem('hh.lang', l); } catch { /* none */ } }, me.token, args.lang === 'bg' ? 'bg' : 'en');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/?slot=p1&quality=low`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => window.__hh && window.__hh.state && window.__hh.pid && window.__hh.ui?.panels, { timeout: 300000 });
  // QA r4: the boot curtain lifts on the first view now (ui-shell S8), up to 25 s on a slow link: the HUD is audited
  // after the lift (playableAt), not the curtain over it (its title and language pick were once read as the HUD)
  await page.waitForFunction(() => window.__hh?.playableAt != null || document.getElementById('boot')?.hidden, { timeout: 120000 }).catch(() => {});
  await sleep(4500);
  await page.evaluate(() => window.__hh.ui.panels.closeAll());
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(800);
  rep.axe.hud = await axe(page);
  axeFailures(`${dev}-fresh`, '#hud', rep.axe.hud);
  await page.screenshot({ path: path.join(out, `${dev}-fresh-hud.png`) });
  for (const name of ['market', 'barn', 'orders', 'journal']) {
    await page.evaluate(() => window.__hh.ui.panels.closeAll());
    await sleep(250);
    const ok = await page.evaluate((n) => { try { return window.__hh.ui.panels.open(n, {}); } catch (e) { return String(e); } }, name);
    if (ok !== true) { rep.axe[name] = [{ id: 'not-opened', impact: 'minor', help: String(ok), n: 0, nodes: [] }]; continue; }
    await sleep(1200);
    const id = await page.evaluate(() => [...document.querySelectorAll('#panels [role="dialog"]')].filter((x) => x.getClientRects().length).at(-1)?.id);
    if (!id) continue;
    await settled(page, `#${id}`);
    rep.axe[name] = await axe(page, `#${id}`);
    axeFailures(`${dev}-fresh`, `#${id}`, rep.axe[name]);
    noteIncomplete(rep, name, await incompleteContrast(page, `${dev}-fresh`, `#${id}`, rep.axe[name]));
    (rep.focus ||= {})[name] = await focusRings(page, `${dev}-fresh`, `#${id}`, `#${id}`);
    await page.screenshot({ path: path.join(out, `${dev}-fresh-${name}.png`) });
    await everyTab(page, `${dev}-fresh`, name, id, rep);
  }
  for (const e of errors) fail(`${dev}-fresh`, 'lead', `page error: ${e.slice(0, 160)}`);
  await ctx.close();
  await srv.stop();
  srv = null;
}

let browser;
let srv;
const sockets = [];
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => { await browser?.close().catch(() => {}); await srv?.stop().catch(() => {}); process.exit(130); });
}
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new', protocolTimeout: 240000,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1400,900'],
  });
  for (const dev of args.data ? devices : []) {
    const rep = report.devices[dev] = { axe: {}, surfaces: {}, contrast: {}, targets: {} };
    const { dir, names, bench } = copySave(args.data, dev);
    srv = serve(dir);
    await srv.ready();
    const me = await claim('p1', names.p1 || 'A');
    const partner = await claim('p2', names.p2 || 'B', { keep: true });
    sockets.push(partner.ws);
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(180000);
    const d = DEVICES[dev];
    if (d.userAgent) await page.setUserAgent(d.userAgent);
    await page.setViewport(d.viewport);
    if (d.safe) { const cdp = await page.createCDPSession(); try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: d.safe }); } catch { /* old */ } }
    await page.evaluateOnNewDocument((tok) => { try { localStorage.setItem('hh.tokens', JSON.stringify({ p1: tok })); localStorage.setItem('hh.lang', 'en'); } catch { /* none */ } }, me.token);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${port}/?slot=p1&quality=low`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForFunction(() => window.__hh && window.__hh.state && window.__hh.pid && window.__hh.ui?.panels, { timeout: 300000 });
    // QA r4: the boot curtain lifts on the first view now (ui-shell S8), up to 25 s on a slow link: the HUD is audited
    // after the lift (playableAt), not the curtain over it (its title and language pick were once read as the HUD)
    await page.waitForFunction(() => window.__hh?.playableAt != null || document.getElementById('boot')?.hidden, { timeout: 120000 }).catch(() => {});
    await sleep(4500);
    await page.evaluate(() => window.__hh.ui.panels.closeAll());
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(800);
    // 1. the HUD, then every panel (each tab's first view)
    rep.axe.hud = await axe(page);
    axeFailures(dev, '#hud', rep.axe.hud);
    await page.screenshot({ path: path.join(out, `${dev}-hud.png`) });
    // 2. the new surfaces (the partner sits down first: the bench chip lasts two minutes)
    rep.partnerSat = await sitOn(partner.ws, bench);
    await sleep(1500);
    for (const s of SURFACES) {
      if ((s.phone && dev === 'desktop') || (s.desktop && dev !== 'desktop')) continue;
      const r = rep.surfaces[s.id] = {};
      await page.evaluate(() => window.__hh.ui.panels.closeAll());
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(300);
      if (s.opener) {
        r.openerReachable = await visible(page, s.opener) ? await tabTo(page, s.opener) : null;
        if (r.openerReachable === false) fail(dev, s.owner, `${s.id}: its opener ${s.opener} is not reachable by Tab`);
      }
      // an opener that throws (a tree without that surface, e.g. HEAD's) leaves the surface "not found", not a crash
      await Promise.resolve().then(() => s.open(page)).catch((e) => { r.openError = String(e).slice(0, 160); });
      await sleep(900);
      r.present = await visible(page, s.root);
      if (!r.present) { fail(dev, s.owner, `${s.id}: not found on screen (${s.root})`); continue; }
      await settled(page, s.root.split(',')[0].trim());
      r.axe = await axe(page, s.root);
      axeFailures(dev, s.root, r.axe);
      const odd = await page.evaluate((root, classes) => [...document.querySelectorAll(root.split(',').map((x) => `${x.trim()} button, ${x.trim()} [role="button"]`).join(', '))]
        .filter((b) => b.getClientRects().length && !b.closest('.hh-panel-title, .hh-panel-close') && !classes.some((c) => b.classList.contains(c)))
        .map((b) => ({ name: `${b.tagName.toLowerCase()}.${String(b.className).split(' ').filter(Boolean).join('.')}`, cls: [...b.classList] })), s.root, BUTTON_CLASSES);
      const why = (b) => b.cls.map((c) => DOCUMENTED_CLASSES.get(c)).find(Boolean);
      r.documented = [...new Set(odd.filter(why).map((b) => `${b.name} (${why(b)})`))];
      r.badButtons = [...new Set(odd.filter((b) => !why(b)).map((b) => b.name))].slice(0, 10);
      for (const b of r.badButtons) fail(dev, s.owner, `${s.id}: button without a shared component class (rel-components.md) and no "why none fits" line: ${b}`);
      if (!s.passive) {
        // inside: the keyboard can get there, and Escape closes it
        const inside = await page.evaluate((root) => Boolean(document.activeElement && document.activeElement.closest(root)), s.root)
          || await (async () => { for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (await page.evaluate((root) => Boolean(document.activeElement?.closest(root)), s.root)) return true; } return false; })();
        r.focusInside = inside;
        if (!inside) fail(dev, s.owner, `${s.id}: Tab never reaches inside it once it is open`);
        await page.keyboard.press('Escape');
        await sleep(500);
        r.closedByEscape = !(await visible(page, s.root));
        if (!r.closedByEscape) fail(dev, s.owner, `${s.id}: Escape does not close it`);
      }
      if (s.tags) {
        r.contrast = await pixelContrast(page, s.root.split(',').map((x) => `${x.trim()} *`).join(', '));
        for (const c of r.contrast) if (!(c.median >= c.need) && !c.outlined) fail(dev, s.owner, `${s.id}: "${c.text}" ${c.median}:1 against the lawn (need ${c.need})`);
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('hh:home-card', { detail: { id: null } })));
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
    const panels = await page.evaluate(() => window.__hh.ui.panels.list().map((p) => p.name));
    const objs = await page.evaluate(() => Object.entries(window.__hh.state.farm.objects).map(([id, o]) => ({ id, def: o.def })));
    const firstOf = (re) => objs.find((o) => re.test(o.def));
    const argsFor = { building: () => ({ id: (firstOf(/^bakery$/) || firstOf(/bakery|mill|dairy/))?.id }), animals: () => ({ id: firstOf(/coop|cow_barn|pasture/)?.id }), tree: () => ({ id: firstOf(/_tree$/)?.id }) };
    const skip = new Set(['confirm', 'naming', 'newkey', 'helper-letter', 'helper-ready', 'leagueResult', 'duelResult', 'fairCeremony', 'recap']);
    const main = new Set(['market', 'barn', 'orders', 'journal', 'settings', 'menu', 'gift', 'building', 'animals', 'fair', 'barge', 'helper']);
    for (const name of panels) {
      if (skip.has(name) || (args.panels === 'main' && !main.has(name))) continue;
      const a = argsFor[name] ? argsFor[name]() : {};
      if (argsFor[name] && !a.id) continue;
      await page.evaluate(() => window.__hh.ui.panels.closeAll());
      await sleep(250);
      const ok = await page.evaluate((n, x) => { try { return window.__hh.ui.panels.open(n, x); } catch (e) { return String(e); } }, name, a);
      if (ok !== true) continue;
      await sleep(1200);
      const id = await page.evaluate(() => [...document.querySelectorAll('#panels [role="dialog"]')].filter((x) => x.getClientRects().length).at(-1)?.id);
      if (!id) continue;
      await settled(page, `#${id}`);
      rep.axe[name] = await axe(page, `#${id}`);
      axeFailures(dev, `#${id}`, rep.axe[name]);
      noteIncomplete(rep, name, await incompleteContrast(page, dev, `#${id}`, rep.axe[name]));
      (rep.focus ||= {})[name] = await focusRings(page, dev, `#${id}`, `#${id}`);
      // every other tab of it too (QA r1 P-20: the gate passed while Journal › This week, Market › Land and the
      // Barn's kinds had violations, because it saw only each panel's first view)
      await everyTab(page, dev, name, id, rep);
      // S9b (ux-phone#16): on a touch screen the item chips and the Journal's task lines, which open "where to get it",
      // are 44 px tall; any other opener under 44 px is listed in the report (not a failure: outside S9b)
      if (dev !== 'desktop') {
        const small = await page.evaluate((root) => [...document.querySelectorAll(`${root} [data-hint-item], ${root} .pn-chip[data-item]`)]
          .filter((e) => e.getClientRects().length && !e.closest('[hidden]'))
          .map((e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), what: `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`,
            text: e.textContent.trim().slice(0, 24), s9b: e.matches('.pn-chip[data-item]') || root === '#panel-journal' }; })
          .filter((x) => x.h < 44), `#${id}`);
        rep.targets[name] = small;
        for (const x of small.filter((y) => y.s9b).slice(0, 4)) fail(dev, ownerOf(`#${id}`), `S9b target ${x.h} px tall (< 44) in #${id}: ${x.what} "${x.text}"`);
      }
    }
    await page.evaluate(() => window.__hh.ui.panels.closeAll());
    // 3. "70 left" on the chalkboard (M16): measured on pixels
    await page.evaluate(() => { window.__hh.ui.panels.closeAll(); window.__hh.ui.panels.open('market', { tab: 'sell' }); });
    await sleep(1500);
    // the board into view first, and only words that are on top at their centre measured (QA r3: Sell opened scrolled
    // to the slip, the board sat under the tab row, and the "background" read was the tab row: 3.56:1 for a hidden word)
    const chalkSel = '#panels .pn-chalk-item small, #panels .pn-chalk-left';
    await page.evaluate(() => document.querySelector('#panels .pn-chalk')?.scrollIntoView({ block: 'center' }));
    await sleep(700);
    const chalkSeen = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => {
      const r = e.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const seen = r.width > 0 && Boolean(top) && (top === e || e.contains(top));
      e.toggleAttribute('data-a11y-seen', seen);
      return seen;
    }), chalkSel);
    rep.contrast.chalk = await pixelContrast(page, '#panels [data-a11y-seen]');
    await page.evaluate(() => document.querySelectorAll('[data-a11y-seen]').forEach((e) => e.removeAttribute('data-a11y-seen')));
    if (chalkSeen.length && !chalkSeen.some(Boolean)) fail(dev, 'ui-panels', 'chalkboard: none of its "N left" words is on screen to measure');
    for (const c of rep.contrast.chalk) if (!(c.median >= c.need)) fail(dev, 'ui-panels', `chalkboard "${c.text}" ${c.median}:1 (need ${c.need})`);
    await page.screenshot({ path: path.join(out, `${dev}-market-chalk.png`) });
    for (const e of errors) fail(dev, 'lead', `page error: ${e.slice(0, 160)}`);
    await ctx.close();
    for (const ws of sockets.splice(0)) { try { ws.close(); } catch { /* gone */ } }
    await srv.stop();
    srv = null;
  }
  if (args.fresh) for (const dev of devices) await freshPass(dev);
  const file = path.join(out, `a11y-audit-${devices.join('+')}${args.fresh ? (args.data ? '+fresh' : '-fresh') : ''}.json`);
  fs.writeFileSync(file, JSON.stringify({ ok: failures.length === 0, failures, byOwner, report }, null, 1));
  console.log(JSON.stringify({ ok: failures.length === 0, failures: failures.length, byOwner: Object.fromEntries(Object.entries(byOwner).map(([k, v]) => [k, v.length])),
    first: failures.slice(0, 12), devices, file: path.relative(ROOT, file) }));
  process.exitCode = failures.length ? 1 : 0;
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err && err.stack || err), failures: failures.length }));
  process.exitCode = 1;
} finally {
  for (const ws of sockets) { try { ws.close(); } catch { /* gone */ } }
  await browser?.close().catch(() => {});
  await srv?.stop();
}
