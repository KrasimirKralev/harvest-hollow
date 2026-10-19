// The language gate (i18n lane A; release 1.0 P7, copy#22, critique#15 #22): screenshots in Bulgarian (or English) of the
// loading screen's picker, the farmer picker, the HUD, Settings and the multi-farm landing page, AND a walk of every
// panel and every tab with a clip check that sees what players see: text cut by an ancestor, text past the screen edge,
// text clipped vertically, and an ellipsis on the NOW title, the farmer title or a panel title. With --data it plays a
// copy of a late save (the owners' farm) and scripted states: the second farmer claimed and online (partner
// surfaces), seated on a bench (the bench chip), and the clock warped to 21:00 farm time (the "Before bed" card).
// QA r1 scripted states (P-04 and the patch requests S-04, S-07, L-08, L-09): an order just delivered (the free new-order
// button), the partner's long chat line (a pasted link) as a toast
// and a feed line, the three longest crop names in the tool slot, a surprise waiting in the welcome-back recap (the
// partner wraps it while this farmer is away three hours), and on a fresh farm the coach waiting for level 2 after
// the first sale. A scripted state that does not come up is a failure (the gate would not have seen that screen).
// QA r2 (patches from features and life-feel; P2-01): the partner of the late save carries a 16-letter name (protocol
// NAME_MAX, "Константин-Борис"), the gift sheet with a tile picked, the surprise's card and a two-button card (the
// carved name) over the farm, and every workshop with goods waiting (its "ready" header); `--device all` adds the
// iPhone 13 on its side to the three upright screens.
// QA r3 (ui-shell's S3-02 patch): on the fresh farm, Grandma on first_order, make_feed and apple_tree, each with no tray,
// the Tools pop-up and the build tray open.
// QA r4: the walk opens every kind of workshop on the farm and puts every recipe name of the content into a real recipe
// card at each screen's width (P4-01: a clamped or cut name, or a word broken across lines, fails); a tab strip that runs
// off its sheet must keep the chosen tab inside it and show the "‹" / "›" cue on each side with tabs past it, the
// frame's tabs and the Ribbon Track's hub strip alike (ui-shell's S4-07 patch).
// Every screen also fails on a JS value printed as text ("null", "undefined", "NaN": QA r1 P-02), and (QA r3 P3-04, P3-05)
// on a count left alone on its own line inside a panel ("готови:" / "12"; outside a panel it is a warning).
// Starts its own server (temp data dir, HH_DEV=1) on --port; ONE headless browser, closed at the end.
//
//   node tools/i18n-shots.mjs --port 4481 [--out docs/qa/i18n] [--lang bg|en] [--device desktop|iphone|small|all
//        |iphone-land|small-land (comma list; all = desktop, iphone, small, iphone-land)]
//        [--data <a save dir: it is COPIED, never touched>] [--shots flag|all|none] [--no-multi] [--no-walk]
//        [--only desktop|phone]   (the old spelling: phone = iphone)   [--root <a source tree to serve, e.g. HEAD's>]
// Prints one JSON line { ok, failures, errors, missing, overflow, warnings, unmatched, screens, files } and exits 1 when
// anything failed: a page/console error, cut, clamped, ellipsised or overflowing text (an ellipsis on the NOW title,
// the farmer title or a panel title is named as such), or a selector of the audit list that matched no element in the
// whole run (so a renamed class cannot make the gate blind). Text under 13 px is reported as a warning.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { KnownDevices } from 'puppeteer-core';
import { WebSocket } from 'ws';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const port = Number(args.port || 4002);
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
const out = path.resolve(ROOT, args.out || 'docs/qa/i18n');
const LANG = args.lang === 'en' ? 'en' : 'bg';
const noMulti = Boolean(args['no-multi']) || Boolean(args.data);
const walk = !args['no-walk'];
const SHOTS = ['all', 'none'].includes(args.shots) ? args.shots : 'flag';
const SERVE_ROOT = args.root ? path.resolve(ROOT, args.root) : ROOT;
const { PROTOCOL_VERSION } = await import(path.join(SERVE_ROOT, 'shared/net/protocol.js'));
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TZ = 'Europe/Sofia';

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const DEVICES = {
  desktop: { viewport: { width: 1366, height: 768, deviceScaleFactor: 1 }, safe: null },
  iphone: { ...KnownDevices['iPhone 13'], safe: { top: 47, bottom: 34, left: 0, right: 0 } },
  small: { userAgent: ANDROID_UA, viewport: { width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false },
    safe: { top: 0, bottom: 0, left: 0, right: 0 } },
  // the same two phones turned sideways ('all' takes the iPhone on its side too: QA r2 P2-01 / P2-02 were landscape only)
  'iphone-land': { ...KnownDevices['iPhone 13 landscape'], safe: { top: 0, bottom: 21, left: 47, right: 47 } },
  'small-land': { userAgent: ANDROID_UA, viewport: { width: 640, height: 360, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true },
    safe: { top: 0, bottom: 0, left: 0, right: 0 } },
};
const pickDevices = () => {
  const d = args.device || (args.only === 'phone' ? 'iphone' : args.only) || 'desktop,iphone';
  if (d === 'all') return ['desktop', 'iphone', 'small', 'iphone-land'];
  return String(d).split(',').map((x) => (x === 'phone' ? 'iphone' : x)).filter((x) => DEVICES[x]);
};

const files = [];
const errors = [];
const missing = new Set();
const overflow = [];
const failures = [];
const warnings = [];
/** QA r1: the scripted states and whether each came up ({ name: true | 'why not' }). */
const scripted = {};
const scriptedState = (name, ok) => { scripted[name] = ok; if (ok !== true) failures.push(`scripted state did not come up: ${name} (${ok})`); };
const screens = [];
/** The audit list: every one must match a visible element somewhere in the run, or the gate went blind. */
const MUST_MATCH = ['#hud-xp-text', '.hh-panel-title-text', '.hh-panel .hh-tab', '.dock-mini .lbl', '.tool[data-tool="hand"], .tool.tool-cur'];
// the NOW title: the phone chip's .tc-t, the desktop card's .gt (features' tracker)
if (args.data) MUST_MATCH.push('.tc-t, .goal[data-slot="now"] .gt');
// the farmers' titles show on a desktop HUD (a phone keeps them in the farmer card)
if (pickDevices().includes('desktop')) MUST_MATCH.push('.players .title');
const matched = new Set();
/** A defect is counted once per device and kind (the HUD under every panel would repeat it 60 times). */
const counted = new Set();
/** Titles that must never be cut short with an ellipsis (copy#22): the NOW title, the farmer's title, a panel title. */
const NO_ELLIPSIS = '.tc-t, .goal[data-slot="now"] .gt, .players .title, .hh-panel-title-text';

function serve(mode, dataDir) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'hh-i18n-'));
  const env = { ...process.env, PORT: String(port), HH_DATA_DIR: dir, HH_DEV: '1', HH_TZ: TZ, HH_HARNESS_MOCK: '1' };
  if (mode === 'multi') env.HH_MODE = 'multi';
  const proc = spawn(process.execPath, ['server/index.js'], { cwd: SERVE_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  return {
    proc,
    ready: async () => { for (let i = 0; i < 300 && !log.includes('running at'); i++) await sleep(100); if (!log.includes('running at')) throw new Error(`server: ${log.slice(-600)}`); },
    stop: async () => { if (proc.exitCode !== null) return; proc.kill('SIGTERM'); await new Promise((r) => proc.once('exit', r)); },
  };
}

/** The longest name a farmer can take (shared/net/protocol.js LIMITS.NAME_MAX = 16): the partner's in a --data run. */
const LONG_NAME = 'Константин-Борис';

/**
 * A copy of the save (never the original): { dir, names, bench } (the first two-seat bench, for the partner). The copy's
 * second farmer is renamed to LONG_NAME (QA r2 F2-08 / L2-09: a 16-letter name ran the Wrap button and a card's ribbon
 * past their edges), so every partner surface of the walk carries the longest name.
 */
function copySave(src, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hh-i18n-${tag}-`));
  fs.cpSync(path.resolve(ROOT, src), dir, { recursive: true });
  try {
    const file = path.join(dir, 'farm.json');
    const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (snap.state?.players?.p2) { snap.state.players.p2.name = LONG_NAME; fs.writeFileSync(file, JSON.stringify(snap)); }
    const st = snap.state;
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

/** Claim (reclaim) a slot over the socket: its token. `keep` leaves the socket open (the farmer stays online). */
function claim(slot, name, { keep = false, token = null } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const cid = `i18${slot}${Math.floor(Math.random() * 1e4)}`.slice(0, 8);
    const tm = setTimeout(() => reject(new Error('claim timeout')), 30000);
    // with the seat's own token a farmer comes back to it (a reclaim of a seat just left is SLOT_TAKEN)
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', proto: PROTOCOL_VERSION, cid, claim: { slot, name, reclaim: true }, ...(token ? { token } : {}) })));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      // a seat resumed with its token is welcomed without a new one
      if (m.t === 'welcome' && (m.token || token)) { clearTimeout(tm); if (!keep) ws.close(); resolve({ token: m.token ?? token, ws }); }
      else if (m.t === 'deny') { clearTimeout(tm); ws.close(); reject(new Error(`denied ${m.code}`)); }
    });
    ws.on('error', reject);
  });
}

/**
 * Text that does not fit, the way a player sees it (the copy audit's sweep, .scratch/rel-copy/scripts/sweep.mjs):
 * cut by its own box or an ancestor that hides overflow, past the screen edge, clipped vertically; an ellipsis is a
 * failure only on the three titles. Exempt: a line folded on purpose with its own toggle ([data-fold][aria-expanded=
 * "false"]), horizontal scrollers (they scroll), the canvas, svg labels, screen-reader text.
 */
async function scan(page, tag) {
  const r = await page.evaluate((mustSel, noEll) => {
    const vw = innerWidth; const vh = innerHeight;
    const res = { fail: [], warn: [], matched: [] };
    const range = document.createRange();
    // digits with the marks a count carries ("31 628", "1,003", "×5", "+2", "50 %", "3/4"), and nothing else
    const LONE_NUMBER = /^[\d\s  .,:;%/+×·•−–-]*\d[\d\s  .,:;%/+×·•−–-]*$/u;
    for (const s of mustSel) {
      if ([...document.querySelectorAll(s)].some((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')) res.matched.push(s);
    }
    const seen = new Set();
    // a card or toast still sliding in is not cut: skip what an entrance animation is moving right now
    const moving = new Set(document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target && a.effect.getTiming().iterations !== Infinity)
      .map((a) => a.effect.target));
    const inMotion = (el) => { for (let n = el; n; n = n.parentElement) if (moving.has(n)) return true; return false; };
    const vis = (el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return null;
      if (el.offsetParent === null && cs.position !== 'fixed') return null;
      return cs;
    };
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('#world, canvas, svg, .sr-only, script, style, [aria-hidden="true"], [data-fold][aria-expanded="false"], [hidden]')) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (!own || inMotion(el)) continue;
      const cs = vis(el); if (!cs) continue;
      const rr = el.getBoundingClientRect();
      if (rr.width === 0 || rr.height === 0 || rr.bottom < 0 || rr.top > vh) continue;
      const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 70);
      // a JS value printed as words (Element.append(null) writes "null": QA r1 P-02)
      if ([...el.childNodes].some((n) => n.nodeType === 3 && /^\s*(null|undefined|NaN)\s*$/.test(n.textContent))) {
        res.fail.push({ kind: 'stray value', text, cls: `${el.tagName.toLowerCase()}.${String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.')}` });
      }
      const cls = `${el.tagName.toLowerCase()}.${String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.')}`;
      const key = `${cls}|${text}`;
      if (seen.has(key)) continue; seen.add(key);
      const hides = (c) => /hidden|clip/.test(c.overflowX) || /hidden|clip/.test(c.overflow);
      if (el.scrollWidth > el.clientWidth + 1) {
        // any ellipsis hides words (the acceptance line: zero cut, ellipsised or overflowing text); the three titles are
        // named so a tool that wants only those can filter
        if (cs.textOverflow === 'ellipsis') res.fail.push({ kind: el.matches(noEll) ? 'ellipsis on a title' : 'ellipsis', text, cls, w: el.clientWidth, sw: el.scrollWidth });
        else if (hides(cs)) res.fail.push({ kind: 'cut', text, cls, w: el.clientWidth, sw: el.scrollWidth });
      }
      const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
      if ((/hidden|clip/.test(cs.overflowY) || clamp) && el.scrollHeight > el.clientHeight + 2) {
        // a line clamp that hides words is cut text too (a fold with its own toggle is exempt above)
        res.fail.push({ kind: clamp ? 'clamp' : 'clipY', text, cls, h: el.clientHeight, sh: el.scrollHeight });
      }
      let a = el.parentElement;
      let scroller = false;
      for (let i = 0; a && i < 12; i++, a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (/auto|scroll/.test(acs.overflowX) && !a.classList.contains('hh-panel-scroll')) { scroller = true; break; }
        if (a.matches('nav.toolbar, .hh-tabs')) { scroller = true; break; }
        if (hides(acs) || a.classList.contains('hh-panel-scroll')) {
          const ar = a.getBoundingClientRect();
          const over = Math.round(Math.max(rr.right - ar.right, ar.left - rr.left));
          if (over > 2) res.fail.push({ kind: 'cut by box', text, cls, by: `${a.tagName.toLowerCase()}.${String(a.className).split(' ')[0]}`, over });
          if (!a.classList.contains('hh-panel-scroll') && a.tagName !== 'BODY') continue;
          break;
        }
      }
      if (!scroller && (rr.right > vw + 1 || rr.left < -1)) res.fail.push({ kind: 'offscreen', text, cls, left: Math.round(rr.left), right: Math.round(rr.right) });
      // text that runs out of its box or out of its grid / flex cell paints over the next column without being cut
      // (a phone on its side: the chalkboard's "още 70" under the sell slip; a hero title squeezed under its chips);
      // nothing hides it, so the checks above cannot see it
      if (!scroller && /static|relative/.test(cs.position) && cs.display !== 'inline') {
        if (el.scrollWidth > el.clientWidth + 2 && !hides(cs)) {
          res.fail.push({ kind: 'out of its box', text, cls, w: el.clientWidth, sw: el.scrollWidth });
        } else {
          let cell = null;
          // a `display: contents` wrapper has no box (its rect is 0 x 0 at the corner): its children are the cells
          // (the coach's `.say` on a phone; the integrator's QA r1 false "out of its column" by 331 px)
          for (let n = el.parentElement, prev = el; n && n.parentElement && n !== document.body; prev = n, n = n.parentElement) {
            if (/absolute|fixed/.test(getComputedStyle(n).position)) break;
            if (/grid|flex/.test(getComputedStyle(n.parentElement).display)) { cell = getComputedStyle(n).display === 'contents' ? prev : n; break; }
          }
          if (cell) {
            const cr = cell.getBoundingClientRect();
            const out = Math.round(Math.max(rr.right - cr.right, cr.left - rr.left));
            if (out > 2) res.fail.push({ kind: 'out of its column', text, cls, cell: `${cell.tagName.toLowerCase()}.${String(cell.className).split(' ')[0]}`, over: out });
          }
        }
      }
      // QA r3 P3-04 / P3-05: a count left alone on its own line ("готови:" / "12", "…до стъпка" / "1", "златни семена" /
      // "×5"): a line of one text node that holds only a number while another line of the same node has words. Inside
      // a panel it fails (ui-panels' surfaces); elsewhere it is a warning for the surface's owner
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !/\d/.test(n.textContent) || !/\p{L}/u.test(n.textContent)) continue;
        const lines = [];
        for (const m of n.textContent.matchAll(/\S+/g)) {
          range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
          const wr = [...range.getClientRects()].find((x) => x.width > 0);
          if (!wr) continue;
          const line = lines.find((l) => Math.abs(l.top - wr.top) < wr.height / 2);
          if (line) line.words.push(m[0]); else lines.push({ top: wr.top, words: [m[0]] });
        }
        const said = lines.map((l) => l.words.join(' '));
        const alone = said.find((s, i) => LONE_NUMBER.test(s) && said.some((o, j) => j !== i && /\p{L}/u.test(o)));
        if (alone) (el.closest('.hh-panel') ? res.fail : res.warn).push({ kind: 'number alone on a line', text, cls, alone });
      }
      if (parseFloat(cs.fontSize) < 12.9 && text.length > 1) res.warn.push({ kind: 'tiny', text: text.slice(0, 40), px: parseFloat(cs.fontSize), cls });
    }
    // QA r4 S4-07 (ui-shell's X4-2): a tab strip that runs off its sheet: the chosen tab inside the strip, and the cue on
    // each side that has tabs past it (ui/dom.js tabCue; css .hh-tabs.more-l::before / .more-r::after). The Ribbon Track's
    // hub strip (.lg-hub, its own tab aria-current) has the same cue (X4-3). A strip's classes follow its `scroll` event,
    // which a loaded headless Chrome delivers up to ~1 s late: record() waits before the scan
    for (const s of document.querySelectorAll('.hh-panel:not([hidden]) > .hh-tabs:not([hidden]), .hh-panel:not([hidden]) nav.lg-hub')) {
      if (!s.getClientRects().length) continue;
      const hub = s.matches('.lg-hub');
      const q = s.getBoundingClientRect();
      const on = s.querySelector(hub ? '[aria-current="page"]' : '[aria-selected="true"]');
      const b = on?.getBoundingClientRect();
      const cls = hub ? 'lg-hub' : 'hh-tabs';
      if (b && (b.left < q.left - 1 || b.right > q.right + 1)) res.fail.push({ kind: 'tab off its strip', text: on.textContent.trim(), cls });
      if (s.scrollLeft + s.clientWidth < s.scrollWidth - 2 && getComputedStyle(s, '::after').visibility !== 'visible') res.fail.push({ kind: 'tabs past the edge, no cue', text: 'right', cls });
      if (s.scrollLeft > 2 && getComputedStyle(s, '::before').visibility !== 'visible') res.fail.push({ kind: 'tabs past the edge, no cue', text: 'left', cls });
    }
    // dock labels that overlap their neighbours (the old check, kept)
    const lbls = [...document.querySelectorAll('.dock-minis .dock-mini .lbl')].filter((l) => l.offsetParent).map((l) => l.getBoundingClientRect());
    for (let i = 1; i < lbls.length; i++) if (lbls[i].left < lbls[i - 1].right - 1 && Math.abs(lbls[i].top - lbls[i - 1].top) < 4) res.fail.push({ kind: 'overlap', text: 'dock-mini labels overlap', over: Math.round(lbls[i - 1].right - lbls[i].left) });
    return res;
  }, MUST_MATCH, NO_ELLIPSIS).catch((e) => ({ fail: [{ kind: 'scan', text: String(e).slice(0, 120) }], warn: [], matched: [] }));
  for (const s of r.matched) matched.add(s);
  const dev = tag.split('-')[0];
  r.fail = r.fail.filter((f) => { const k = `${dev}|${f.kind}|${f.cls}|${f.text}`; if (counted.has(k)) return false; counted.add(k); return true; });
  for (const f of r.fail) { failures.push(`${tag}: ${f.kind} ${JSON.stringify(f)}`); overflow.push(`${tag}: ${JSON.stringify(f)}`); }
  for (const w of r.warn) warnings.push(`${tag}: ${w.kind} ${w.text}`);
  return r;
}

async function shot(page, name, force = false) {
  if (SHOTS === 'none' || (SHOTS === 'flag' && !force)) return null;
  const f = path.join(out, `${name}.png`);
  await page.screenshot({ path: f }).catch((e) => errors.push(`shot ${name}: ${e.message}`));
  files.push(path.relative(ROOT, f));
  return f;
}

/**
 * Wait (up to 6 s) until the open sheets have stopped moving: the scan skips what an entrance animation is moving, so
 * a sheet still sliding in on a loaded machine would otherwise be skipped whole (a blind screen, not a green one).
 */
async function settle(page) {
  await page.waitForFunction(() => ![...document.querySelectorAll('.hh-panel:not([hidden])')]
    .flatMap((p) => [p, ...p.querySelectorAll('*')].flatMap((e) => e.getAnimations()))
    .some((a) => a.playState === 'running' && a.effect?.getTiming?.().iterations !== Infinity), { timeout: 6000, polling: 100 }).catch(() => {});
}

async function record(page, name, { always = false } = {}) {
  await sleep(600);
  await settle(page);
  // the frame scrolls a chosen tab into its strip in a requestAnimationFrame (ui/index.js renderTabs, hubNav): a loaded
  // headless Chrome can draw its next frame after the wait above (QA r4: four "tab off its strip" at load 23-31 whose
  // shots, taken after the scan, show the tab inside). Two frames (3 s at most) before measuring; a tab that stays off
  // its strip still fails
  await page.evaluate(() => Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    new Promise((r) => setTimeout(r, 3000))])).catch(() => {});
  const r = await scan(page, name);
  const title = await page.evaluate(() => [...document.querySelectorAll('.hh-panel:not([hidden]) .hh-panel-title-text')].map((x) => x.textContent).join(' / ')).catch(() => '');
  const f = await shot(page, name, always || r.fail.length > 0);
  screens.push({ name, title, fail: r.fail.length, warn: r.warn.length, shot: f ? path.relative(ROOT, f) : null });
}

async function collectMissing(page) {
  try {
    const m = await page.evaluate(async () => (await import('/js/i18n/core.js')).missingKeys());
    for (const k of m) missing.add(k);
  } catch { /* the page has no i18n module */ }
}

async function newPage(browser, dev, setup) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const d = DEVICES[dev];
  if (d.userAgent) await page.setUserAgent(d.userAgent);
  await page.setViewport(d.viewport);
  if (d.safe) {
    const client = await page.createCDPSession();
    try { await client.send('Emulation.setSafeAreaInsetsOverride', { insets: d.safe }); } catch { /* an older Chrome */ }
  }
  page.on('pageerror', (e) => errors.push(`${dev} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${dev} console: ${m.text().slice(0, 200)}`); });
  if (setup) await page.evaluateOnNewDocument(...setup);
  return { ctx, page };
}

/**
 * Every registered panel and each of its tabs (the copy sweep's walk), one record per screen. QA r4 P4-01: every KIND of
 * workshop on the farm (only the Bakery was walked: the Packing Table's „Подаръчна кошница за закуска“ was clamped at
 * 360 BG and never seen), then every recipe name of the content in a real card (recipeNameScan). `data`: the late
 * save's run, where the recipe scan is a scripted state that must come up.
 */
async function walkPanels(page, dev, { data = false } = {}) {
  const list = await page.evaluate(() => window.__hh.ui.panels.list().map((p) => p.name));
  const objs = await page.evaluate(() => Object.entries(window.__hh.state.farm.objects).map(([id, o]) => ({ id, def: o.def })).sort((a, b) => (a.id < b.id ? -1 : 1)));
  const shops = new Set(await page.evaluate(async () => [...(await import('/shared/content/index.js')).CONTENT.recipes.values()].map((r) => r.building)));
  const firstOf = (re) => objs.find((o) => re.test(o.def));
  const argsFor = {
    building: () => {
      const seen = new Set();
      const all = objs.filter((o) => shops.has(o.def) && !seen.has(o.def) && seen.add(o.def)).map((o) => ({ id: o.id, label: o.def }));
      const o = firstOf(/^bakery$/) || firstOf(/bakery|mill|dairy|kitchen|sawmill/);
      return all.length ? all : o && [{ id: o.id }];
    },
    animals: () => { const o = firstOf(/coop|cow_barn|pasture|hutch|pen|sty/); return o && { id: o.id }; },
    tree: () => { const o = firstOf(/_tree$/); return o && { id: o.id }; },
  };
  const skip = new Set(['confirm', 'naming', 'newkey', 'helper-letter', 'helper-ready', 'leagueResult', 'duelResult', 'fairCeremony', 'recap']);
  let duetCard = null;
  let shopCard = null;
  for (const name of list) {
    if (skip.has(name)) continue;
    let as = [{}];
    if (argsFor[name]) { const a = argsFor[name](); if (!a) continue; as = Array.isArray(a) ? a : [a]; }
    for (const a of as) {
      const tag = a.label ? `${name}-${a.label}` : name;
      await page.evaluate(() => window.__hh.ui.panels.closeAll()).catch(() => {});
      await sleep(250);
      const ok = await page.evaluate((n, x) => { try { return window.__hh.ui.panels.open(n, x); } catch (e) { return String(e); } }, name, { id: a.id }).catch((e) => String(e));
      if (ok !== true) continue;
      await sleep(900);
      if (name === 'building') {
        const has = await page.evaluate(() => ({
          duet: document.querySelector('.hh-panel:not([hidden]) .pn-recipe.duet')?.outerHTML ?? null,
          plain: Boolean(document.querySelector('.hh-panel:not([hidden]) .pn-recipe:not(.duet) .pn-recipe-name')),
        }));
        duetCard ??= has.duet;
        if (has.plain) shopCard ??= a.id;
      }
      const tabs = await page.evaluate(() => [...document.querySelectorAll('.hh-panel:not([hidden]) .hh-tabs:not([hidden]) .hh-tab')].map((b, i) => ({ i, dis: b.disabled })));
      if (!tabs.length) { await record(page, `${dev}-panel-${tag}-${LANG}`); continue; }
      for (const tb of tabs) {
        if (tb.dis) continue;
        await page.evaluate((i) => { [...document.querySelectorAll('.hh-panel:not([hidden]) .hh-tabs:not([hidden]) .hh-tab')][i]?.click(); }, tb.i);
        await record(page, `${dev}-panel-${tag}-${tb.i}-${LANG}`);
      }
    }
  }
  if (shopCard) {
    await page.evaluate(() => window.__hh.ui.panels.closeAll()).catch(() => {});
    await sleep(250);
    await page.evaluate((x) => window.__hh.ui.panels.open('building', { id: x }), shopCard).catch(() => {});
    await sleep(900);
    await settle(page);
  }
  const names = shopCard ? await recipeNameScan(page, dev, duetCard) : 'no workshop with a recipe card on this farm';
  if (data) scriptedState(`${dev} every recipe name of the content in its card`, names);
  await page.evaluate(() => window.__hh.ui.panels.closeAll()).catch(() => {});
}

/**
 * QA r4 P4-01: every recipe of the content with its name in a copy of the open workshop's first recipe card (a duet
 * recipe in a duet card: its two buttons leave the name less room), at this screen's width. The farm shows only what it
 * has unlocked; a level-39 name ("Тарт със смокини и козе сирене") must fit as well. A clamped or cut name fails, and so
 * does a word broken across two lines. True, or why the scan could not run.
 */
async function recipeNameScan(page, dev, duetCard) {
  const r = await page.evaluate(async (tpl) => {
    const I = await import('/js/i18n/index.js');
    const C = await import('/shared/content/index.js');
    const grid = document.querySelector('.hh-panel:not([hidden]) .pn-recipes');
    const plain = grid?.querySelector('.pn-recipe:not(.duet)');
    if (!plain) return 'no recipe card in the open workshop';
    const duet = grid.querySelector('.pn-recipe.duet') ?? (tpl ? Object.assign(document.createElement('div'), { innerHTML: tpl }).firstElementChild : null);
    const range = document.createRange();
    const fail = [];
    let n = 0;
    for (const rec of C.CONTENT.recipes.values()) {
      const card = (rec.duet && duet ? duet : plain).cloneNode(true);
      card.removeAttribute('data-recipe');
      const el = card.querySelector('.pn-recipe-name');
      el.textContent = I.name(rec.id);
      grid.prepend(card);
      const text = el.textContent;
      const at = { text, cls: 'h3.pn-recipe-name', recipe: rec.id, shop: rec.building, duet: rec.duet && Boolean(duet), w: el.clientWidth };
      if (el.scrollHeight > el.clientHeight + 2) fail.push({ kind: 'clamp', ...at, h: el.clientHeight, sh: el.scrollHeight });
      else if (el.scrollWidth > el.clientWidth + 1) fail.push({ kind: 'cut', ...at, sw: el.scrollWidth });
      for (const m of text.matchAll(/\S+/g)) {
        range.setStart(el.firstChild, m.index); range.setEnd(el.firstChild, m.index + m[0].length);
        const rs = [...range.getClientRects()].filter((x) => x.width > 0);
        if (rs.some((x) => Math.abs(x.top - rs[0].top) > rs[0].height / 2)) fail.push({ kind: 'word broken', ...at, word: m[0] });
      }
      card.remove();
      n++;
    }
    return { n, fail, duetCard: Boolean(duet) };
  }, duetCard).catch((e) => String(e).slice(0, 120));
  if (typeof r === 'string') return r;
  for (const f of r.fail) { failures.push(`${dev}-recipe-names-${LANG}: ${f.kind} ${JSON.stringify(f)}`); overflow.push(`${dev}-recipe-names-${LANG}: ${JSON.stringify(f)}`); }
  screens.push({ name: `${dev}-recipe-names-${LANG}`, title: `${r.n} recipe names${r.duetCard ? '' : ' (no duet card: duet names in a plain card)'}`, fail: r.fail.length, warn: 0, shot: null });
  return r.n > 0 ? true : 'no recipe in the content';
}

/** A pasted link in the partner's chat (QA r1 L-09: it ran off the toast and the feed line). */
const LONG_CHAT = 'look https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';

/**
 * A fresh farm's first sale, played like a player: plant six Wheat, let them ripen (a dev warp), harvest, sell ten.
 * The coach then waits for level 2 (QA r1 S-04). True, or why not.
 */
async function coachWaiting(page) {
  const { cropOf } = await import(path.join(SERVE_ROOT, 'shared/content/index.js'));
  const ms = (cropOf('wheat')?.growMs ?? 60_000) + 2000;
  const plots = await page.evaluate(() => {
    const H = window.__hh;
    const objs = H.state.farm.objects;
    const ids = Object.keys(objs).filter((k) => objs[k].def === 'plot' && !objs[k].crop).sort().slice(0, 6);
    const r = ids.map((id) => H.act('plant', { id, crop: 'wheat' }));
    return { ids, bad: r.filter((x) => !x || x.ok === false).map((x) => x?.code ?? 'no result') };
  });
  if (plots.ids.length < 6 || plots.bad.length) return `planting: ${plots.ids.length} plots, ${plots.bad.join(',')}`;
  await page.evaluate((w) => window.__hh.dev.warp(w), ms);
  await sleep(1500);
  const sold = await page.evaluate((ids) => {
    const H = window.__hh;
    const bad = ids.map((id) => H.act('harvest', { id })).filter((x) => !x || x.ok === false).map((x) => x?.code ?? 'no result');
    const s = H.act('sell', { item: 'wheat', qty: 10 });
    return { bad, sell: s && s.ok !== false ? 'ok' : s?.code ?? 'no result' };
  }, plots.ids);
  if (sold.bad.length || sold.sell !== 'ok') return `harvest ${sold.bad.join(',') || 'ok'}, sell ${sold.sell}`;
  await page.evaluate(() => window.__hh.ui.panels.closeAll());
  return page.waitForFunction(() => {
    const c = document.querySelector('#coach-slot');
    return c && c.getClientRects().length && /2/.test(c.textContent);
  }, { timeout: 15000 }).then(() => true, () => 'the coach did not show a level-2 step');
}

/** QA r3 S3-02: the coach steps whose Bulgarian line was cut at 360 (with a tray open). */
const COACH_STEPS = ['first_order', 'make_feed', 'apple_tree'];

/**
 * Put the coach on `step` in this page's own state (the coach is a pure function of the state: ui/tutorial.js
 * coachStep), then tell the store's listeners: the card shows that step's words and layout, which is what the scan
 * checks. The server never hears of it (the farm is a throwaway). True once the card shows the step.
 */
async function coachOn(page, step) {
  const why = await page.evaluate(async (s) => {
    const H = window.__hh;
    const st = H.state;
    const { TUTORIAL, xpForLevel } = await import('/shared/content/index.js');
    const me = st.players[H.pid];
    if (!me || !st.farm.tut) return 'no coach state';
    const own = ['fields', 'barnyard'].map((tr) => [tr, TUTORIAL[tr].findIndex((x) => x.id === s)]).find(([, i]) => i >= 0);
    const tog = TUTORIAL.together.findIndex((x) => x.id === s);
    if (own) {
      const [track, i] = own;
      me.tut = { ...(me.tut || {}), track, i, n: 0, skip: false };
      const lvl = TUTORIAL[track][i].level ?? 1;
      if (lvl > 1 && st.farm.xp < xpForLevel(lvl)) st.farm.xp = xpForLevel(lvl);
    } else if (tog >= 0) {
      // the farmer's own track finished, the farm's start steps ticked, the together list on this step
      const track = me.tut?.track || 'fields';
      me.tut = { ...(me.tut || {}), track, i: TUTORIAL[track].length, n: 0, skip: false };
      st.farm.tut.fin = { ...(st.farm.tut.fin || {}), [track]: H.pid };
      st.farm.tut.s = TUTORIAL.start.length;
      st.farm.tut.t = tog;
      st.farm.tut.n = 0;
      const lvl = TUTORIAL.together[tog].level ?? 1;
      if (st.farm.xp < xpForLevel(lvl)) st.farm.xp = xpForLevel(lvl);
    } else return `no step ${s} in the guide`;
    H.store.emit('change', { ids: new Set(), topics: new Set(['tut', 'xp', 'players']), source: 'local', pending: 0 });
    return null;
  }, step).catch((e) => String(e).slice(0, 80));
  if (why) return why;
  return page.waitForFunction((s) => [...document.querySelectorAll(`[data-step="${s}"]`)].some((e) => e.getClientRects().length), { timeout: 8000 }, step)
    .then(() => true, () => `the coach did not show ${step}`);
}

/** Open (or close) a tray over the farm: 'tools' = the Tools ▸ pop-up, 'build' = the build tray (Build, or Tools ▸ Build on a phone). */
async function openTray(page, which) {
  if (which === 'none') return true;
  if (which === 'close') {
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => { try { window.__hh.ui.panels.closeAll(); } catch { /* none */ } });
    await sleep(500);
    return true;
  }
  const shown = (sel) => page.evaluate((x) => [...document.querySelectorAll(x)].some((e) => e.getClientRects().length && !e.closest('[hidden]')), sel);
  const click = (sel) => page.evaluate((x) => { const e = [...document.querySelectorAll(x)].find((y) => y.getClientRects().length); e?.click(); return Boolean(e); }, sel);
  const toolsBtn = '.tool-slot[data-slot="tools"], .tool-slot[data-slot="tool"]';
  if (which === 'tools') {
    if (!(await click(toolsBtn))) return 'no Tools button';
    await sleep(800);
    return (await shown('#tools-flyout')) || 'the Tools pop-up did not open';
  }
  if (!(await click('[data-dock="build"]'))) {
    if (!(await click(toolsBtn))) return 'no Build or Tools button';
    await sleep(600);
    if (!(await click('#tools-flyout [data-act="build"]'))) return 'no Build in the Tools pop-up';
  }
  await sleep(900);
  return (await shown('.build-card, #build-tray, .build-tray')) || 'the build tray did not open';
}

/** Milliseconds from the farm's now to the next 21:00 in the farm's time zone. */
async function msTo21(page) {
  return page.evaluate((tz) => {
    const now = window.__hh.serverNow();
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
      .formatToParts(now).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
    const since = ((p.hour * 60 + p.minute) * 60 + p.second) * 1000;
    const at = 21 * 3_600_000;
    return since < at ? at - since + 60_000 : 86_400_000 - since + at + 60_000;
  }, TZ);
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new', protocolTimeout: 240000,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1400,900'],
});
let srv = null;
const sockets = [];
// stopped by its PID (one agent's run, never a pattern kill): close the browser and the server on the way out
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => { await browser.close().catch(() => {}); await srv?.stop().catch(() => {}); process.exit(130); });
}
try {
  const devices = pickDevices();
  if (args.data) {
    // ---- a late save: the owners' farm, both farmers in, the partner online and seated, then 21:00 ----
    for (const dev of devices) {
      // reclaim both seats under the names the save already has (a reclaim never renames anyone)
      const { dir, names, bench } = copySave(args.data, dev);
      srv = serve('single', dir);
      await srv.ready();
      const me = await claim('p1', names.p1 || 'A');
      const partner = await claim('p2', names.p2 || 'B', { keep: true });
      sockets.push(partner.ws);
      await sitOn(partner.ws, bench);                       // the bench chip: the partner waits on a bench
      const { ctx, page } = await newPage(browser, dev, [(tok, l) => {
        try { localStorage.setItem('hh.tokens', JSON.stringify({ p1: tok })); localStorage.setItem('hh.lang', l); } catch { /* none */ }
      }, me.token, LANG]);
      await page.goto(`http://localhost:${port}/?slot=p1&quality=low`, { waitUntil: 'domcontentloaded', timeout: 240000 });
      await page.waitForFunction(() => window.__hh && window.__hh.state && window.__hh.pid && window.__hh.ui?.panels, { timeout: 300000 });
      await sleep(4000);
      await page.evaluate(() => { try { window.__hh.ui.panels.closeAll(); } catch { /* none */ } });
      await page.keyboard.press('Escape').catch(() => {});
      await record(page, `${dev}-data-hud-${LANG}`, { always: true });
      if (walk) await walkPanels(page, dev, { data: true });
      // the Farm book / farm menu, opened like a player would
      if (await page.evaluate(() => window.__hh.ui.panels.has?.('menu'))) {
        await page.evaluate(() => window.__hh.ui.panels.open('menu'));
        await record(page, `${dev}-data-menu-${LANG}`, { always: true });
        await page.evaluate(() => window.__hh.ui.panels.closeAll());
      }
      // QA r1 P-04: an order just delivered: its slot shows "A new order is on its way" and the free-order button
      {
        await page.evaluate(() => { window.__hh.ui.panels.closeAll(); window.__hh.ui.panels.open('orders'); });
        await sleep(1200);
        const done = await page.evaluate(() => {
          const b = [...document.querySelectorAll('.hh-panel:not([hidden]) [data-fill]')].find((x) => x.getClientRects().length && x.getAttribute('aria-disabled') !== 'true');
          if (!b) return 'no deliverable order';
          b.click();
          return true;
        });
        if (done === true) {
          await page.waitForSelector('.hh-panel:not([hidden]) [data-rush]', { timeout: 8000 }).catch(() => {});
          await sleep(2200);           // past the Deliver guard and any ghost row (orders.js, QA r1 P-17)
          await page.evaluate(() => document.querySelector('.hh-panel:not([hidden]) [data-rush]')?.scrollIntoView({ block: 'center' }));
          await record(page, `${dev}-data-orders-delivered-${LANG}`, { always: true });
        }
        scriptedState(`${dev} order just delivered`, done === true && await page.evaluate(() => Boolean(document.querySelector('.hh-panel:not([hidden]) [data-rush]')))
          ? true : done === true ? 'no waiting slot after the delivery' : done);
        await page.evaluate(() => window.__hh.ui.panels.closeAll());
      }
      // QA r1 L-09: the partner pastes a link into the chat: its toast and its feed line must stay inside the screen
      try {
        partner.ws.send(JSON.stringify({ t: 'chat', text: LONG_CHAT }));
        // on screen, not only somewhere in the page (a folded feed holds it too): a visible element that says it
        const seen = await page.waitForFunction((x) => [...document.querySelectorAll('body *')].some((e) => [...e.childNodes]
          .some((n) => n.nodeType === 3 && n.textContent.includes(x)) && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'
          && !e.closest('[hidden]')),
        { timeout: 8000, polling: 100 }, LONG_CHAT.slice(5, 30)).then(() => true, () => 'the chat line never showed on screen');
        if (seen === true) await record(page, `${dev}-data-chat-${LANG}`, { always: true });
        scriptedState(`${dev} long chat line`, seen);
      } catch (e) { scriptedState(`${dev} long chat line`, String(e).slice(0, 80)); }
      // QA r1 S-07: the longest crop names in the tool slot (Царевица was cut at 360)
      const longest = await page.evaluate(async () => {
        if (typeof window.__hh.controller?.setTool !== 'function') return [];
        const C = await import('/shared/content/index.js');
        const I = await import('/js/i18n/index.js');
        const level = C.levelFromXp(window.__hh.state.farm.xp);
        return [...C.CONTENT.crops.values()].filter((c) => (c.unlock ?? 1) <= level && C.isLive(c)).map((c) => [c.id, I.name(c.id)])
          .sort((a, b) => b[1].length - a[1].length).slice(0, 3).map(([id]) => id);
      }).catch(() => []);
      if (!longest.length) scriptedState(`${dev} long crop in the tool slot`, 'no crop to pick');
      for (const crop of longest) {
        await page.evaluate((c) => window.__hh.controller.setTool('hand', { crop: c, plant: true }), crop);
        await record(page, `${dev}-data-tool-${crop}-${LANG}`, { always: true });
        scriptedState(`${dev} tool slot ${crop}`, true);
      }
      await page.evaluate(() => window.__hh.controller.setTool('hand'));
      // QA r2 F2-08 (features): the gift sheet with a tile picked, for a partner with a 16-letter name: the Wrap button
      // names them and keeps its words inside
      try {
        await page.evaluate(() => { window.__hh.ui.panels.closeAll(); window.__hh.ui.panels.open('gift'); });
        await sleep(1200);
        const picked = await page.evaluate(() => {
          const tile = [...document.querySelectorAll('.hh-panel:not([hidden]) .rel-gift-grid .pn-stack')].find((x) => x.getClientRects().length);
          if (!tile) return 'no gift tile';
          tile.click();
          return true;
        });
        if (picked === true) {
          await sleep(500);
          await record(page, `${dev}-data-gift-longname-${LANG}`, { always: true });
          const fits = await page.evaluate(() => { const b = document.querySelector('.hh-panel:not([hidden]) .rel-gift-send'); return b ? b.scrollWidth <= b.clientWidth + 1 : 'no Wrap button'; });
          if (fits !== true) failures.push(`${dev}-data-gift-longname-${LANG}: ${fits === false ? 'the Wrap button\'s words run past it' : fits}`);
          scriptedState(`${dev} gift sheet, a tile picked, a 16-letter partner`, fits === 'no Wrap button' ? fits : true);
        } else scriptedState(`${dev} gift sheet, a tile picked, a 16-letter partner`, picked);
        await page.evaluate(() => window.__hh.ui.panels.closeAll());
      } catch (e) { scriptedState(`${dev} gift sheet, a tile picked, a 16-letter partner`, String(e).slice(0, 80)); }
      // QA r2 L2-09 / L2-10 (life-feel): a 16-letter giver's name on the surprise's card, and a two-button card
      try {
        const up = await page.evaluate(async (name) => {
          const I = await import('/js/i18n/index.js');
          window.__hh.ui.banner({ id: 'shots-gift', kind: 'gift', over: true, ttl: 30000, ribbon: I.t('cheer.gift.ribbon'),
            message: I.t('cheer.gift.wrapped', { name, item: I.name('egg') }), quote: I.t('cheer.gift.quote', { note: I.t('feat.gift.note.thanks') }),
            things: [{ icon: 'egg', name: I.name('egg') }], actions: [{ label: I.t('cheer.gift.thanks'), kind: 'go', fn() {} }] });
          window.__hh.ui.banner({ id: 'shots-named', ribbon: I.t('social.naming.carved'), ttl: 30000,
            message: I.t('social.naming.named', { name, farm: I.t('social.naming.ourFarm') }),
            actions: [{ label: I.t('social.naming.love'), kind: 'go', fn() {} }, { label: I.t('social.naming.other'), kind: 'paper', fn() {} }] });
          await new Promise((r) => setTimeout(r, 600));
          return Boolean(document.querySelector('[data-id="shots-gift"]') || document.querySelector('[data-id="shots-named"]'));
        }, LONG_NAME);
        if (up) await record(page, `${dev}-data-cards-${LANG}`, { always: true });
        // a phone shows one card at a time: the second waits its turn
        const second = up && await page.waitForFunction(() => document.querySelector('[data-id="shots-named"]'), { timeout: 35000, polling: 250 }).then(() => true, () => false);
        if (second && !(await page.evaluate(() => document.querySelector('[data-id="shots-gift"]')))) await record(page, `${dev}-data-cards-named-${LANG}`, { always: true });
        scriptedState(`${dev} long giver name and two-button cards`, up || 'the cards did not show');
        await page.evaluate(() => document.querySelectorAll('[data-id^="shots-"] .btn').forEach((b) => b.click())).catch(() => {});
      } catch (e) { scriptedState(`${dev} long giver name and two-button cards`, String(e).slice(0, 80)); }
      // QA r2 P2-01: every workshop with goods waiting (its "ready" header: on a phone on its side it ran past the sheet)
      {
        const ids = await page.evaluate(() => Object.entries(window.__hh.state.farm.objects).filter(([, o]) => Array.isArray(o.queue)
          && (o.queue.some((q) => q && q.e <= window.__hh.serverNow()) || (o.ready ?? 0) > 0)).map(([id]) => id).sort());
        let shown = 0;
        for (const id of ids) {
          await page.evaluate((x) => { window.__hh.ui.panels.closeAll(); window.__hh.ui.panels.open('building', { id: x }); }, id);
          await sleep(900);
          if (!(await page.evaluate(() => Boolean(document.querySelector('.hh-panel:not([hidden]) .pn-ready'))))) continue;
          shown++;
          await record(page, `${dev}-data-ready-${id}-${LANG}`);
        }
        await page.evaluate(() => window.__hh.ui.panels.closeAll());
        scriptedState(`${dev} workshops with goods waiting`, shown > 0 ? true : `no "ready" header among ${ids.length} workshops`);
      }
      // 21:00 farm time: the evening cards ("Before bed"). The partner leaves first: with both online and seated the
      // Golden Hour card would speak instead (one voice, M29)
      for (const ws of sockets.splice(0)) { try { ws.close(); } catch { /* gone */ } }
      await sleep(1500);
      const ms = await msTo21(page);
      await fetch(`http://127.0.0.1:${port}/api/dev/warp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms }) });
      await sleep(3500);
      await record(page, `${dev}-data-hud-2100-${LANG}`, { always: true });
      await collectMissing(page);
      // QA r1 L-08: a surprise waits in the welcome-back recap. This farmer leaves, three hours pass, the partner wraps
      // something from the Barn for them, and they come back
      const gift = await page.evaluate(() => {
        const inv = window.__hh.state.farm.inventory;
        return ['wheat', 'corn', 'carrot', 'egg', 'milk', 'strawberry'].find((x) => (inv[x] ?? 0) > 0) ?? Object.keys(inv).find((x) => inv[x] > 0) ?? null;
      });
      await ctx.close();
      await sleep(1500);
      await fetch(`http://127.0.0.1:${port}/api/dev/warp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms: 3 * 3_600_000 }) });
      const giver = await claim('p2', names.p2 || 'B', { keep: true, token: partner.token }).catch((e) => ({ error: String(e) }));
      if (giver.ws) {
        giver.ws.send(JSON.stringify({ t: 'act', seq: 1, type: 'keepsake', args: { item: gift ?? 'wheat', to: 'p1', note: 'За теб' } }));
        await sleep(2500);
        try { giver.ws.close(); } catch { /* gone */ }
      }
      await sleep(1500);
      {
        const again = await newPage(browser, dev, [(tok, l) => {
          try { localStorage.setItem('hh.tokens', JSON.stringify({ p1: tok })); localStorage.setItem('hh.lang', l); } catch { /* none */ }
        }, me.token, LANG]);
        await again.page.goto(`http://localhost:${port}/?slot=p1&quality=low`, { waitUntil: 'domcontentloaded', timeout: 240000 });
        await again.page.waitForFunction(() => window.__hh && window.__hh.state && window.__hh.pid && window.__hh.ui?.panels, { timeout: 300000 });
        const up = await again.page.waitForFunction(() => Object.values(window.__hh.state.farm.gifts ?? {}).some((g) => g.to === window.__hh.pid)
          && document.querySelector('#panel-recap:not([hidden]), .hh-panel:not([hidden]) .recap'), { timeout: 20000 }).then(() => true,
          async () => (await again.page.evaluate(() => Object.values(window.__hh.state.farm.gifts ?? {}).some((g) => g.to === window.__hh.pid))
            ? 'the recap did not open' : 'the partner\'s gift was refused'));
        if (up === true) await record(again.page, `${dev}-data-recap-gift-${LANG}`, { always: true });
        scriptedState(`${dev} surprise in the recap`, giver.ws ? up : `the partner could not come back: ${giver.error}`);
        await again.ctx.close();
      }
      for (const ws of sockets.splice(0)) { try { ws.close(); } catch { /* gone */ } }
      await srv.stop();
      srv = null;
    }
  } else {
    for (const dev of devices) {
      // a fresh farm per device: the two seats are free for this device's farmer and its partner
      srv = serve('single');
      await srv.ready();
      const { ctx, page } = await newPage(browser, dev);
      const base = `http://localhost:${port}`;
      // 1. the loading screen, held before main.js runs: the inline picker works on its own
      await page.setRequestInterception(true);
      let hold = true;
      page.on('request', async (req) => {
        if (hold && /\/js\/main\.js/.test(req.url())) { while (hold) await sleep(100); }
        req.continue().catch(() => {});
      });
      page.goto(`${base}/`, { waitUntil: 'load', timeout: 120000 }).catch(() => {});
      await page.waitForSelector('#boot .lang-opt', { timeout: 30000 });
      await sleep(1500);
      await page.evaluate((l) => document.querySelector(`#boot .lang-opt[data-lang="${l}"]`)?.click(), LANG);
      await sleep(500);
      await shot(page, `${dev}-1-loading-${LANG}`, true);
      hold = false;
      // 2. the farmer picker (no slot claimed yet)
      await page.waitForFunction(() => !document.getElementById('slot-picker').hidden, { timeout: 60000 });
      await sleep(1500);
      await record(page, `${dev}-2-picker-${LANG}`, { always: true });
      // 3. the HUD (claim a farmer by URL; the language stays remembered)
      await page.setRequestInterception(false);
      await page.goto(`${base}/?slot=${dev === 'desktop' ? 'p1' : 'p2'}&name=${encodeURIComponent(dev === 'desktop' ? 'Роза' : 'Мила')}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__hh && window.__hh.state && window.__hh.controller, { timeout: 60000 });
      await sleep(3500);
      // the second farmer claimed and online: the partner surfaces show (critique#22)
      if (sockets.length === 0) sockets.push((await claim(dev === 'desktop' ? 'p2' : 'p1', dev === 'desktop' ? 'Мила' : 'Роза', { keep: true }).catch(() => ({ ws: null }))).ws);
      await sleep(1500);
      await record(page, `${dev}-3-hud-${LANG}`, { always: true });
      // 4. Settings, first tab (the language row) and Controls
      await page.evaluate(() => window.__hh.ui.panels.open('settings'));
      await record(page, `${dev}-4-settings-${LANG}`, { always: true });
      await page.evaluate(() => window.__hh.ui.panels.open('settings', { tab: 'keys' }));
      await sleep(700);
      await shot(page, `${dev}-5-settings-keys-${LANG}`, true);
      // 5. switch to English mid-game and back: the shell re-draws at once
      await page.evaluate(() => window.__hh.ui.panels.open('settings', { tab: 'look' }));
      await sleep(500);
      await page.evaluate(async () => { document.querySelector('.set-lang button[data-lang="en"]')?.click(); });
      await sleep(900);
      await shot(page, `${dev}-6-switched-en`, true);
      await page.evaluate(async (l) => { document.querySelector(`.set-lang button[data-lang="${l}"]`)?.click(); }, LANG);
      await sleep(900);
      await page.evaluate(() => window.__hh.ui.panels.closeAll());
      // 6. the seed tray on the toolbar
      await page.evaluate(() => { window.__hh.ui.openSeeds?.(true); });
      await record(page, `${dev}-7-seeds-${LANG}`, { always: true });
      await page.evaluate(() => window.__hh.ui.openSeeds?.(false));
      if (await page.evaluate(() => window.__hh.ui.panels.has?.('menu'))) {
        await page.evaluate(() => window.__hh.ui.panels.open('menu'));
        await record(page, `${dev}-8-menu-${LANG}`, { always: true });
        await page.evaluate(() => window.__hh.ui.panels.closeAll());
      }
      if (walk) await walkPanels(page, dev);
      // QA r1 S-04: the coach that waits for level 2 after the first sale ("…(когато фермата стигне ниво 2)" was cut)
      scriptedState(`${dev} coach waiting for level 2`, await coachWaiting(page));
      await record(page, `${dev}-s-coach-wait-${LANG}`, { always: true });
      // QA r3 S3-02 (ui-shell's patch to this tool): Grandma's long steps, with no tray, the Tools pop-up and the build
      // tray open (her BG line was cut with "…" at 360 in all three)
      // QA r3 integration: the level-2 setup completes quests, and their "Quest done" cards (8 s each, queued) cover
      // Grandma's card; a frame taken under them showed the cards, not the line the scan checks. Wait for the column
      // to empty, and count the card as up only when her line is the topmost thing at its centre
      await page.waitForFunction(() => !document.querySelector('.unlock-banner:not(.leaving)')
        && document.querySelector('.banner-more')?.hidden !== false, { timeout: 60000 }).catch(() => {});
      for (const step of COACH_STEPS) {
        const up = await coachOn(page, step);
        if (up !== true) { scriptedState(`${dev} coach on ${step}`, up); continue; }
        for (const tray of ['none', 'tools', 'build']) {
          const open = await openTray(page, tray);
          if (open !== true) { scriptedState(`${dev} coach on ${step}, ${tray} open`, open); continue; }
          const still = await page.evaluate((s) => [...document.querySelectorAll(`[data-step="${s}"] .line`)].some((e) => {
            const r = e.getBoundingClientRect();
            if (!r.width || !r.height) return false;
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return Boolean(top && e.closest(`[data-step="${s}"]`).contains(top));
          }), step);
          scriptedState(`${dev} coach on ${step}, ${tray} open`, still || 'the coach card left');
          await record(page, `${dev}-s-coach-${step}-${tray}-${LANG}`, { always: true });
          await openTray(page, 'close');
        }
      }
      await collectMissing(page);
      await ctx.close();
      for (const ws of sockets.splice(0)) { try { ws?.close(); } catch { /* gone */ } }
      await srv.stop();
      srv = null;
    }
    // 7. the multi-farm landing page and a farm gate
    if (!devices.every((d) => d !== 'desktop') && !noMulti) {
      srv = serve('multi');
      await srv.ready();
      const made = await fetch(`http://localhost:${port}/api/farms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then((r) => r.json()).catch(() => ({}));
      for (const dev of ['desktop', 'iphone']) {
        const { ctx, page } = await newPage(browser, dev);
        await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
        await page.evaluate((l) => localStorage.setItem('hh.lang', l), LANG);
        await page.reload({ waitUntil: 'networkidle0' });
        await sleep(800);
        await shot(page, `${dev}-9-landing-${LANG}`, true);
        await page.goto(`http://localhost:${port}/f/${made.id ?? 'abcdefghijklmnop'}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#farm-gate', { timeout: 30000 }).catch(() => {});
        await sleep(1200);
        await shot(page, `${dev}-10-gate-${LANG}`, true);
        await ctx.close();
      }
    }
  }
  const unmatched = MUST_MATCH.filter((s) => !matched.has(s));
  for (const s of unmatched) failures.push(`selector matched nothing in the whole run (the gate would be blind): ${s}`);
  for (const e of errors) failures.push(`error: ${e}`);
  const ok = failures.length === 0;
  console.log(JSON.stringify({ ok, failures, errors, missing: [...missing], overflow, warnings: warnings.slice(0, 200), unmatched, scripted, screens: screens.length, files }));
  fs.writeFileSync(path.join(out, `i18n-shots-${args.data ? 'data' : 'fresh'}-${pickDevices().join('+')}-${LANG}.json`),
    JSON.stringify({ ok, failures, errors, missing: [...missing], warnings, unmatched, scripted, screens }, null, 1));
  process.exitCode = ok ? 0 : 1;
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err && err.stack || err), failures, errors, files }));
  process.exitCode = 1;
} finally {
  for (const ws of sockets) { try { ws?.close(); } catch { /* gone */ } }
  await browser.close().catch(() => {});
  await srv?.stop();
}
