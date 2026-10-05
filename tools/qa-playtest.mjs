// QA long playtest of M1a ("Evening One"), driven as two real clients (headless Chrome, real server, real UI/store).
//
//   node tools/qa-playtest.mjs --port 3321                       # the whole reference schedule (about 25 minutes)
//        [--out docs/qa/wave1] [--evenings 3] [--minutes 60] [--size 1366x768] [--keep] [--no-ui]
//
// The schedule (GDD §1.5, the "reference couple": three evenings a week, about 60 minutes together):
//   evening 1 Mon 19:00, evening 2 Wed 19:00, evening 3 Fri 19:00 (both players), then a SOLO evening (Rowan alone,
//   Sunday 19:00), then a 3-DAY ABSENCE (both pages closed) and the return on Wednesday: the recap card and a sweep.
// Waiting is compressed with the dev time warp: every play minute the two players spend their attention (tools/qa-bot.mjs
// decides what a sensible player does: follow the Goal Tracker and the story cards, fulfil Mabel's orders, build what
// the cards ask, feed animals, craft, sell surplus), then game time jumps 60 s. Game actions go through window.__hh.act (the
// controller's own entry point); a set of UI PROBES per evening drives the real mouse and panels (drag-plant, Sickle
// strokes, Market sell, Orders deliver, a building's panel, the build tray and ghost, the Barn) and records whether the
// real UI path works, falling back to the store when it does not so one broken button never hides the next problem.
//
// Output (all under --out): playtest-log.jsonl (one line per play minute), playtest-summary.json (milestones, counters,
// raw events for the report), shots/ (screenshots of anything odd and of the key moments).
//
// MID-GAME MODE (wave 2, M1b): `--from 12 [--to 18] [--max-evenings 10]` builds a level-12 farm with the same player
// against the rules alone (in-process Engine, fake clock, the reference schedule: 60-minute evenings Mon / Wed / Fri),
// boots the real server on it at the next evening's start (QA_CLOCK_OFFSET_MS) with both farmers' tokens in place,
// and plays real evenings in the browser until the farm reaches --to. On top of the general player, an M1b layer
// uses the new systems the way a couple would (Fair entries, barge crates, Restoration bundles, Town Projects,
// beehives, the new animal homes, album trades). It reports DEAD ENDS (midgame-summary.json + a digest on stdout):
//   - content unlocked at a level that the rules still refuse (LOCKED / BAD_ARGS: a gating mismatch),
//   - an M1b system live for 45 play minutes and never usable, with the reason (no eligible goods, rows 0, ...),
//   - a level that takes more than two evenings, evenings with long both-idle stretches, Goal Tracker problems.
// LATE-GAME MODE (wave 3, M2): `--from 25 --to 32` the same, from a level-25 farm. The fixture is played to its level by
// the same in-process engine (up to --fixture-evenings, default 2.4 x the level), or loaded with `--fixture <dir | file>`
// (a server snapshot farm.json: the farmers' tokens are made anew, a player the save lacks is joined; `--fixture-level N`
// lifts a fixture below level N to it, farm XP only); `--save-fixture
// <dir>` keeps the built one for the next run (`--fixture-only` builds it and stops). On top of the M1b layer an M2 layer
// uses the late-game systems as a couple
// would: perks (each farmer their own trees), the Fishing Dock (a cast when the hour is up, reeled at the bite), the
// Nursery (a care card per baby, the personality pick), the Breeding Barn (a pair when there is room, the baby brought
// home and named), Friendly Duel (invite, accept), the farmhouse room (a piece of furniture now and then), the league
// (read off the ceremonies) and the Seasonal Ribbon Track (tiers claimed). Its systems join the same dead-end report.
// HARD RULES: starts its own server on --port with a temp data dir; never touches :3000, :3300 or ./data.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { levelFromXp, xpForLevel, CONTENT, itemOf, defOf, FEED, SEASONAL_TRACK } from '../shared/content/index.js';
import { turn, trackerProblems, trackerOf, look, OPS_PER_MINUTE } from './qa-bot.mjs';
import { available, stockOf, overflowOf, barnCap } from '../shared/rules/economy.js';
import { fillable } from '../shared/rules/orders-board.js';
import { currentFarmStep, currentStep } from '../shared/rules/actions/tutorial.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const port = Number(args.port || 3321);
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
const OUT = path.resolve(args.out || path.join(ROOT, 'docs/qa/wave1'));
const SHOTS = path.join(OUT, 'shots');
const EVENINGS = Number(args.evenings || 3);
const MINUTES = Number(args.minutes || 60);
const [VW, VH] = String(args.size || '1280x720').split('x').map(Number);
const TZ = 'Europe/Sofia';
const NO_UI = Boolean(args['no-ui']);
const FROM = args.from ? Number(args.from) : null;     // mid-game mode: start from a farm at this level
const TO = Number(args.to || 18);
const MAX_EVENINGS = Number(args['max-evenings'] || 10);
const FIXTURE = typeof args.fixture === 'string' ? path.resolve(args.fixture) : null;
const MID = (Number.isSafeInteger(FROM) && FROM > 1) || Boolean(FIXTURE);
/** --fixture-level N: a loaded fixture below level N is lifted to it (farm XP only: a fixture, not a played level-up). */
const FIXTURE_LEVEL = Number(args['fixture-level'] || 0);
const SAVE_FIXTURE = typeof args['save-fixture'] === 'string' ? path.resolve(args['save-fixture']) : null;
const FIXTURE_EVENINGS = Number(args['fixture-evenings'] || Math.max(40, Math.ceil((FROM ?? 0) * 2.4)));
const FIXTURE_ONLY = Boolean(args['fixture-only']);   // build (and --save-fixture) the fixture, then stop: no browser
// SIGTERM / SIGINT (a `timeout`, Ctrl+C): finish the current minute, then close the evening and write the summary
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (!stopping) console.error(`[qa] ${sig}: stopping after this minute`); stopping = true; });
const SEED = Number(args.seed || 7);
const SMOKE = Boolean(args.smoke);          // compress the probe minutes so a short run exercises every probe
// minutes of an evening at which each probe runs
const PM = SMOKE
  ? { panels: 1, strokes: 2, sellui: 3, orderui: 4, buildingui: 5, buildui: 6, animalui: 7, social: 2, blip: 8, coop: 9, landui: 3, boardui: 4 }
  : { panels: 1, strokes: 0, sellui: 9, orderui: 11, buildingui: 14, buildui: 20, animalui: 26, social: 5, blip: 40, coop: -9, landui: 0, boardui: 30 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOUR = 3_600_000;
const MIN = 60_000;
fs.mkdirSync(SHOTS, { recursive: true });
const logFile = path.join(OUT, 'playtest-log.jsonl');
fs.writeFileSync(logFile, '');
const say = (...a) => console.error('[qa]', ...a);

// ---- the run's record ------------------------------------------------------------------------------------------------
const R = {
  startedAt: new Date().toISOString(),
  levels: {},                 // level -> { playMinute, evening, minute, day, coins, xp }
  evenings: [],               // per evening summary
  shots: [],
  rejects: [],                // every rejected action: { evening, minute, pid, type, code, local, why, toast }
  toasts: [],                 // what the players saw
  errors: [],                 // console / page errors, failed requests
  trackerProblems: [],        // { evening, minute, text }
  idle: [],                   // minutes where a player had attention left and nothing useful to do
  idleBoth: [],               // minutes where NEITHER had anything to do
  uiProbes: [],               // { name, ok, detail, evening, minute }
  notes: [],                  // free-form facts
  softCards: {},              // soft-confirm cards raised, by code
  latency: [],                // ack times (ms) of action bursts
  actsByType: {},
  coinSources: {},
  uiScans: [],
  systems: {},
  desync: [],
  blips: [],
  coop: [],
  // mid-game mode
  fixture: null,              // { level, evenings, minutes, at }
  unlocks: {},                // level -> [{ fam, id, name }]
  reach: [],                  // { level, fam, id, code }  unlocked content the rules refuse (dead ends)
  m1b: { first: {}, live: {}, ops: {}, diag: {} },   // per system: first use (play minute), live since, ops, last reason
  deadEnds: [],
};
const state = { evening: 0, minute: 0, playMinute: 0, pm: 0 };
let server; let browser; let serverLog = '';
const pages = {};            // pid -> page
const contexts = {};         // pid -> browser context
const players = [['p1', 'Rowan', 'A'], ['p2', 'Mia', 'B']];
/** Mid-game mode: the farmers' tokens (64 hex) whose hashes the fixture's sidecar holds. */
const TOKENS = {};

// ---- server and browser ------------------------------------------------------------------------------------------------
async function startServer({ dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-qa-')), offset = untilLocal(Date.now(), 1, 19) } = {}) {
  // the farm is created on the Monday evening the schedule starts (see tools/qa-clock-preload.cjs); mid-game mode
  // passes the fixture's data dir and the offset of its next evening
  server = spawn(process.execPath, ['--require', path.join(ROOT, 'tools/qa-clock-preload.cjs'), 'server/index.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), HH_DATA_DIR: dataDir, HH_DEV: '1', HH_TZ: TZ, QA_CLOCK_OFFSET_MS: String(offset) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 100 && !serverLog.includes('running at'); i++) await sleep(100);
  if (!serverLog.includes('running at')) throw new Error(`server did not start: ${serverLog.slice(-500)}`);
  server.dataDir = dataDir;
}

async function openPage(pid, name, tag) {
  if (!contexts[pid]) contexts[pid] = await browser.createBrowserContext();
  const page = await contexts[pid].newPage();
  await page.setViewport({ width: VW, height: VH });
  page.tag = tag;
  page.pid = pid;
  page.setDefaultTimeout(120000);
  // two software-rendered 3D pages are the heaviest thing on a shared dev PC: between probes and screenshots the pages draw
  // at ~2 Hz (state, rules, sockets and timers run exactly as before); probes and shots lift the throttle (see lift())
  // mid-game mode: the fixture's farm already has both farmers; their tokens go in before the page boots
  if (TOKENS[pid]) await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('hh.tokens', JSON.stringify(t)); } catch { /* ignore */ } }, { [pid]: TOKENS[pid] });
  await page.evaluateOnNewDocument(() => {
    window.__qaThrottle = true;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => (window.__qaThrottle ? setTimeout(() => raf(cb), 450) : raf(cb));
  });
  page.on('pageerror', (e) => R.errors.push({ at: where(), pid, kind: 'pageerror', text: e.message }));
  page.on('console', (m) => {
    if (m.type() === 'error') R.errors.push({ at: where(), pid, kind: 'console', text: m.text().slice(0, 300) });
    if (m.type() === 'warning' && /three|webgl|deprecat|failed|error/i.test(m.text())) R.errors.push({ at: where(), pid, kind: 'warning', text: m.text().slice(0, 300) });
  });
  page.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) R.errors.push({ at: where(), pid, kind: 'requestfailed', text: `${r.url()} ${r.failure()?.errorText}` }); });
  page.on('response', (r) => { if (r.status() >= 400) R.errors.push({ at: where(), pid, kind: `http${r.status()}`, text: r.url() }); });
  await page.goto(`http://localhost:${port}/?slot=${pid}&name=${name}&quality=${args.quality || 'low'}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__hh && window.__hh.state && window.__hh.pid, { timeout: 240000 });
  pages[pid] = page;
  await instrument(page);
  await loadBot(page);
  return page;
}

const where = () => `E${state.evening} m${state.minute}`;

/** Hooks inside the page: every rejection, toast, celebration and overlay text the player sees. */
async function instrument(page) {
  await page.evaluate(() => {
    const q = { rej: [], toasts: [], cel: [], banners: [] };
    window.__qa = q;
    const h = window.__hh;
    const t0 = () => Math.round(h.serverNow());
    h.store.on('reject', (e) => q.rej.push({ t: t0(), type: e.type, code: e.code, local: Boolean(e.local), by: e.by ?? null, args: JSON.stringify(e.args).slice(0, 200) }));
    h.store.on('celebrate', (e) => q.cel.push({ t: t0(), ev: e.ev.e, level: e.ev.level ?? null, id: e.ev.id ?? null }));
    const seen = (el, list, tag) => {
      const txt = el.textContent.trim().replace(/\s+/g, ' ');
      if (txt) list.push({ t: t0(), tag, text: txt.slice(0, 200) });
    };
    for (const [id, list] of [['toasts', q.toasts], ['banners', q.banners]]) {
      const root = document.getElementById(id);
      if (!root) continue;
      new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) seen(n, list, id);
      }).observe(root, { childList: true });
    }
  });
}

/** Load the player (tools/qa-bot.mjs) into the page as a module: it reads window.__hh.state directly, no round trips. */
async function loadBot(page) {
  const src = fs.readFileSync(path.join(ROOT, 'tools/qa-bot.mjs'), 'utf8').replaceAll("from '../shared/", `from 'http://localhost:${port}/shared/`);
  await page.evaluate(async ([code]) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const bot = await import(url);
    const { fillable } = await import(`${location.origin}/shared/rules/orders-board.js`);
    const eco = await import(`${location.origin}/shared/rules/economy.js`);
    const { levelFromXp, itemOf } = await import(`${location.origin}/shared/content/index.js`);
    const { validateState } = await import(`${location.origin}/shared/rules/state.js`);
    window.__bot = bot;
    window.__qaLedgerN = window.__hh.state.farm.ledger.n;      // a re-opened page must not re-read the 500 rows already counted
    window.__qaSeen = new Set();
    const client = () => ({
      pid: window.__hh.pid,
      snap: async () => ({ s: window.__hh.state, now: window.__hh.serverNow() }),
      act: async (t, a) => { const r = window.__hh.act(t, a); return { ok: Boolean(r && r.ok), code: r && r.code }; },
    });
    window.__qaTurn = async (o) => {
      const saw = new Set();
      const r = await bot.turn(client(), { ...o, dom: o.dom, waited: (k) => window.__qaSeen.has(k), sawKeys: saw });
      window.__qaSeen = saw;
      return r;
    };
    // everything a minute's log line needs, computed where the state lives
    window.__qaPre = () => {
      const s = window.__hh.state;
      const now = window.__hh.serverNow();
      const pid = window.__hh.pid;
      const v = bot.look(s, now, pid);
      const tr = [...document.querySelectorAll('#tracker .goal')].map((b) => ({ slot: b.dataset.slot, title: b.querySelector('.gt')?.textContent ?? '', sub: b.querySelector('.gs')?.textContent ?? '' }));
      const vis = (e) => e && e.offsetParent !== null && !e.hidden;
      const ov = {};
      const cel = document.getElementById('celebrate');
      if (vis(cel) && cel.textContent.trim()) ov.celebrate = cel.textContent.trim().replace(/\s+/g, ' ').slice(0, 160);
      const coach = document.getElementById('coach-slot');
      if (coach && coach.textContent.trim()) ov.coach = coach.textContent.trim().replace(/\s+/g, ' ').slice(0, 200);
      const open = [...document.querySelectorAll('#panels > section, #panels > div')].filter((e) => vis(e)).map((e) => e.id);
      if (open.length) ov.panels = open;
      const ban = document.getElementById('banners');
      if (ban && ban.textContent.trim()) ov.banners = ban.textContent.trim().replace(/\s+/g, ' ').slice(0, 200);
      return {
        now, level: levelFromXp(s.farm.xp), xp: s.farm.xp, coins: s.farm.wallet.coins, acorns: s.farm.wallet.acorns,
        barn: `${eco.stockOf(s) + eco.overflowOf(s)}/${eco.barnCap(s)}`,
        plots: { ripe: v.ripe.length, growing: v.growing.length, idle: v.idle.length, total: v.plots.length },
        quests: Object.keys(s.farm.quests.active),
        orders: Object.entries(s.farm.orders.slots).map(([k, sl]) => (sl.order
          ? `${k}:${sl.order.golden ? 'G ' : ''}${Object.entries(sl.order.items).map(([i, q]) => `${q} ${i}`).join('+')}${fillable(s, sl.order) ? ' [fillable]' : ''}`
          : `${k}:empty`)),
        tracker: tr, overlay: ov, problems: bot.trackerProblems(s, pid, now),
        inv: Object.fromEntries(Object.entries(s.farm.inventory).filter(([, n]) => n > 0)),
        overflow: s.farm.overflow,
        hearts: Object.fromEntries(Object.entries(s.players).map(([k, p]) => [k, p.hearts])),
        invalid: (() => { try { return validateState(s).slice(0, 5); } catch (e) { return [`validateState threw ${e.message}`]; } })(),
      };
    };
    // the ledger since the last call: coins in and out by reason (a ring of 500 rows, read every minute so none is lost)
    window.__qaLedger = () => {
      const L = window.__hh.state.farm.ledger;
      const out = {};
      let lost = 0;
      const from = window.__qaLedgerN;
      if (L.n - from > 500) lost = L.n - from - 500;
      for (let n = Math.max(from, L.n - 500); n < L.n; n++) {
        const r = L.rows[String(n % 500)];
        if (!r || typeof r.n !== 'number') continue;
        const k = String(r.reason).split(':')[0];
        out[k] = (out[k] ?? 0) + r.n;
      }
      window.__qaLedgerN = L.n;
      const coins = window.__hh.state.farm.wallet.coins;
      const dCoins = window.__qaLedgerCoins === undefined ? null : coins - window.__qaLedgerCoins;
      window.__qaLedgerCoins = coins;
      return { out, lost, n: L.n, coins, dCoins };
    };
    // the long-term systems at a glance (evening start / end): daily gift, Farm Weeks, Almanac, challenge, meter, ribbons, tutorial
    window.__qaSystems = () => {
      const s = window.__hh.state;
      const pick = (o) => JSON.parse(JSON.stringify(o ?? null));
      return {
        daily: pick(s.farm.daily), challenge: pick(s.farm.challenge), meter: pick(s.farm.orders.meter), ribbons: Object.keys(s.farm.ribbons),
        tut: pick(s.farm.tut), coop: pick({ golden: s.farm.coop.golden, goldenAt: s.farm.coop.goldenAt, combo: s.farm.coop.combo }),
        expansions: s.farm.expansions, barn: s.farm.barn, tools: pick(s.farm.tools), wish: Object.keys(s.farm.wishlist ?? {}),
        players: Object.fromEntries(Object.entries(s.players).map(([k, p]) => [k, { hearts: p.hearts, xp: p.xp, tut: p.tut, almanac: pick(p.almanac), ribbons: Object.keys(p.ribbons ?? {}), title: p.title, caps: pick(p.caps), seen: pick(p.seen) }])),
        stats: pick(s.farm.stats), objects: Object.entries(s.farm.objects).reduce((m, [, o]) => { m[o.def] = (m[o.def] ?? 0) + 1; return m; }, {}),
        quests: { active: Object.keys(s.farm.quests.active), done: Object.keys(s.farm.quests.done), owed: s.farm.quests.owed },
        storage: pick(s.farm.storage), seeds: pick(s.farm.seeds),
      };
    };
    void itemOf;
  }, [src]);
}

const drain = (page) => page.evaluate(() => {
  const q = window.__qa;
  const out = { rej: q.rej.splice(0), toasts: q.toasts.splice(0), cel: q.cel.splice(0), banners: q.banners.splice(0) };
  return out;
}).catch(() => ({ rej: [], toasts: [], cel: [], banners: [] }));

// ---- the client the player talks to --------------------------------------------------------------------------------------
function clientOf(pid) {
  return {
    pid,
    async snap() {
      const page = pages[pid];
      return page.evaluate(() => ({ s: JSON.parse(JSON.stringify(window.__hh.state)), now: window.__hh.serverNow() }));
    },
    async act(type, a) {
      R.actsByType[type] = (R.actsByType[type] ?? 0) + 1;
      if (type === 'sit') {
        // walk there like the Hand does and sit only once the pose has reached the server (qa2 RC-21: a teleport and a
        // sit 600 ms later beat the relayed pose: 56-98 TOO_FAR a run). The bench is 2 x 1, turned with its rot.
        await pages[pid].evaluate((id) => new Promise((done) => {
          const o = window.__hh.state.farm.objects[id];
          if (!o) { done(); return; }
          const t = setTimeout(done, 8000);
          const [w, d] = (o.rot ?? 0) % 2 ? [1, 2] : [2, 1];
          window.__hh.avatar.walkTo(o.x, o.z, w, d, () => { clearTimeout(t); done(); });
        }), a.id);
      }
      return pages[pid].evaluate(([t, x]) => {
        const r = window.__hh.act(t, x);
        return { ok: Boolean(r && r.ok), code: r && r.code };
      }, [type, a]);
    },
  };
}

/** Wait until the page has no unconfirmed predictions; returns how long the burst took to be acknowledged. */
async function settle(page, timeout = 8000) {
  const t = Date.now();
  try {
    await page.waitForFunction(() => window.__hh.pending === 0, { timeout, polling: 20 });
    return Date.now() - t;
  } catch {
    return -1;
  }
}

async function syncClock(page, target) {
  await page.evaluate(async (t) => {
    for (let i = 0; i < 100 && window.__hh.serverNow() < t; i++) {
      window.__hh.net.ping();
      await new Promise((r) => setTimeout(r, 40));
    }
  }, target);
}

/** Jump game time by ms. Pages that are open catch their clock up; closed pages catch up when they reopen. */
async function warp(ms) {
  const r = await fetch(`http://127.0.0.1:${port}/api/dev/warp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms: Math.max(1, Math.ceil(ms)) }) });
  const { serverNow } = await r.json();
  await Promise.all(Object.values(pages).filter((p) => !p.isClosed()).map((p) => syncClock(p, serverNow - 300)));
  return serverNow;
}

const serverNowOf = async () => pages.p1 && !pages.p1.isClosed() ? pages.p1.evaluate(() => window.__hh.serverNow()) : (await (await fetch(`http://127.0.0.1:${port}/api/status`)).json()).serverNow;

/** Ms until the next local time-of-day on the given weekday (0 Sun .. 6 Sat) in the farm's zone. */
function untilLocal(now, weekday, hour) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  for (let ms = 0; ms < 8 * 24 * HOUR; ms += 5 * MIN) {
    const parts = Object.fromEntries(f.formatToParts(now + ms).map((p) => [p.type, p.value]));
    if (days[parts.weekday] === weekday && Number(parts.hour) === hour && Number(parts.minute) < 5) return ms;
  }
  return 0;
}
const localStr = (now) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);

/** Lift (true) or restore (false) the draw throttle on every open page, for probes that need real frames. */
const lift = (on) => Promise.all(Object.values(pages).filter((p) => !p.isClosed()).map((p) => p.evaluate((v) => { window.__qaThrottle = !v; }, on).catch(() => {})));

// ---- shots ------------------------------------------------------------------------------------------------------------------------
let shotCount = 0;
async function shot(name, pid = 'p1', why = '') {
  const page = pages[pid];
  if (!page || page.isClosed()) return null;
  shotCount++;
  const file = path.join(SHOTS, `${name}.png`);
  try {
    // the pages run at the low tier to keep two SwiftShader renderers affordable; a screenshot is taken at the high tier
    await page.evaluate(() => { window.__qaThrottle = false; if (!window.__hh.view.stats().tier || window.__hh.view.stats().tier !== 'high') window.__hh.view.setQuality('high'); }).catch(() => {});
    await sleep(1800);
    await page.screenshot({ path: file });
    await page.evaluate(() => { window.__hh.view.setQuality('low'); window.__qaThrottle = true; }).catch(() => {});
    R.shots.push({ file: path.relative(ROOT, file), why, at: where() });
    return file;
  } catch (e) {
    R.errors.push({ at: where(), pid, kind: 'screenshot', text: String(e.message).slice(0, 200) });
    return null;
  }
}

// ---- DOM readers (what the player sees) ------------------------------------------------------------------------------------
const trackerDom = (page) => page.evaluate(() => [...document.querySelectorAll('#tracker .goal')].map((b) => ({
  slot: b.dataset.slot, title: b.querySelector('.gt')?.textContent ?? '', sub: b.querySelector('.gs')?.textContent ?? '' })))
  .catch(() => []);
const storyDom = (page) => page.evaluate(() => [...document.querySelectorAll('#tracker .story, #tracker [data-quest]')].map((b) => b.textContent.trim().replace(/\s+/g, ' ').slice(0, 120))).catch(() => []);
const overlaysDom = (page) => page.evaluate(() => {
  const vis = (e) => e && e.offsetParent !== null && !e.hidden;
  const out = {};
  const celebrate = document.getElementById('celebrate');
  if (vis(celebrate) && celebrate.textContent.trim()) out.celebrate = celebrate.textContent.trim().replace(/\s+/g, ' ').slice(0, 160);
  const coach = document.getElementById('coach-slot');
  if (coach && coach.textContent.trim()) out.coach = coach.textContent.trim().replace(/\s+/g, ' ').slice(0, 200);
  const open = [...document.querySelectorAll('#panels > section, #panels > div')].filter((e) => vis(e) && !e.hidden).map((e) => e.id);
  if (open.length) out.panels = open;
  const banners = document.getElementById('banners');
  if (banners && banners.textContent.trim()) out.banners = banners.textContent.trim().replace(/\s+/g, ' ').slice(0, 200);
  return out;
}).catch(() => ({}));

async function dismissOverlays(page) {
  // Celebration cards and welcome banners: a player clicks through them (and they cost attention, which the budget ignores).
  for (let i = 0; i < 5; i++) {
    const t = await page.evaluate(() => {
      const rx = /^(Wonderful!?|Hooray!?|Yay!?|Continue|Nice!?|Lovely!?|Got it!?|Close|Okay!?|OK|Thanks!?|Love it|Let's go!?|Hide|Done|Not now)$/i;   // not "Show me": that opens the Market on the new unlock and leaves it open over the field
      const roots = [document.getElementById('celebrate'), document.getElementById('panel-recap'), document.getElementById('banners')].filter(Boolean);
      for (const root of roots) {
        const b = [...root.querySelectorAll('button')].find((x) => x.offsetParent !== null && !x.disabled && rx.test(x.textContent.trim()));
        if (b) { const txt = b.textContent.trim(); b.click(); return txt; }
      }
      return null;
    }).catch(() => null);
    if (!t) break;
    await sleep(200);
  }
}

// ---- the minute ----------------------------------------------------------------------------------------------------------------------
const DOM = {
  p1: { fields: 1, market: 1 },
  p2: { barnyard: 1, workshop: 1, orchard: 1, farm: 1 },
};
const seenKeys = { p1: new Set(), p2: new Set() };
const minuteLog = [];

/** Everyone's page has applied everything the server committed (a partner who sees the farm a second late would be a bug of the harness). */
async function inSync(timeout = 4000) {
  const live = Object.values(pages).filter((p) => !p.isClosed());
  if (live.length < 2) return;
  const t = Date.now();
  while (Date.now() - t < timeout) {
    const vs = await Promise.all(live.map((p) => p.evaluate(() => ({ v: window.__hh.store.v, pend: window.__hh.pending })).catch(() => null)));
    if (vs.every(Boolean) && vs.every((x) => x.pend === 0) && new Set(vs.map((x) => x.v)).size === 1) return;
    await sleep(60);
  }
}

async function playTurn(pid, opts) {
  return pages[pid].evaluate((o) => window.__qaTurn(o), { minsLeft: opts.minsLeft, wrap: opts.wrap, dom: DOM[pid], solo: opts.solo, helpAll: opts.helpAll, ops: OPS_PER_MINUTE });
}

let lastLevel = 1;
async function onePlayMinute({ evening, minute, minutes, who, solo, race, label }) {
  state.evening = evening;
  state.minute = minute;
  const t0 = Date.now();
  const rec = { evening, label, minute, play: state.pm };
  const live = who.filter((p) => pages[p] && !pages[p].isClosed());
  const pre = {};
  await sleep(700);
  for (const p of live) pre[p] = await pages[p].evaluate(() => window.__qaPre());
  const p0 = pre[live[0]];
  const minuteStart = p0.now;
  rec.clock = localStr(p0.now);
  Object.assign(rec, { level: p0.level, xp: p0.xp, coins: p0.coins, acorns: p0.acorns, barn: p0.barn, plots: p0.plots, quests: p0.quests, orders: p0.orders, inv: p0.inv, hearts: p0.hearts });
  if (p0.overflow && Object.keys(p0.overflow).length) rec.overflow = p0.overflow;
  if (p0.invalid.length) { rec.invalidState = p0.invalid; R.notes.push({ at: where(), invalidState: p0.invalid }); }
  const led = await pages[live[0]].evaluate(() => window.__qaLedger());
  rec.ledger = led.out;
  if (led.lost) rec.ledgerLost = led.lost;
  // every coin that moved must be in the ledger: the sum of its rows since the last minute equals the change of the treasury
  const ledSum = Object.values(led.out).reduce((a, b) => a + b, 0);
  if (led.dCoins !== null && !led.lost && ledSum !== led.dCoins) {
    rec.ledgerMismatch = { treasuryChange: led.dCoins, ledgerSum: ledSum };
    R.notes.push({ at: where(), ledgerMismatch: rec.ledgerMismatch, ledger: led.out });
  }
  for (const [k, n] of Object.entries(led.out)) { const e = (R.coinSources[k] ??= { in: 0, out: 0 }); if (n >= 0) e.in += n; else e.out += -n; }
  // what each player sees on the tracker (the DOM, not the rules function) and over the world
  rec.tracker = {};
  const problems = [];
  for (const p of live) {
    rec.tracker[p] = Object.fromEntries(pre[p].tracker.map((g) => [g.slot, `${g.title}${g.sub ? ` — ${g.sub}` : ''}`]));
    if (Object.keys(pre[p].overlay).length) { rec.overlay = rec.overlay ?? {}; rec.overlay[p] = pre[p].overlay; }
    for (const x of pre[p].problems) problems.push(`${p}: ${x}`);
  }
  if (problems.length) { rec.trackerProblems = problems; for (const x of problems) R.trackerProblems.push({ at: where(), text: x }); }

  // the UI probes of this minute (real mouse / panels), then the bot's attention
  if (!NO_UI) await runProbes({ evening, minute, minutes, who: live, solo });

  const opts = (p) => ({ minsLeft: minutes - minute, wrap: minutes - minute <= 6, solo, helpAll: race });
  let results = {};
  if (race && live.length === 2) {
    const rs = await Promise.all(live.map((p) => playTurn(p, opts(p))));
    live.forEach((p, i) => { results[p] = rs[i]; });
  } else {
    for (const p of live) {
      results[p] = await playTurn(p, opts(p));
      await inSync();           // the partner reacts to a farm they can see, a moment later
    }
  }
  rec.ops = {};
  for (const p of live) {
    const r = results[p];
    rec.ops[p] = r.ops.map((o) => `${o.ok ? '' : `!${o.code} `}${o.softCard ? `[${o.softCard} card] ` : ''}${o.type}: ${o.why}`);
    if (r.idle) rec.idleLeft = { ...(rec.idleLeft ?? {}), [p]: r.left };
    for (const o of r.ops) {
      if (o.softCard) R.softCards[o.softCard] = (R.softCards[o.softCard] ?? 0) + 1;
      R.actsByType[o.type] = (R.actsByType[o.type] ?? 0) + 1;
    }
    if (r.notes.length) { rec.notes = rec.notes ?? {}; rec.notes[p] = r.notes.slice(0, 6); }
  }
  // mid-game mode: the M1b layer (Fair, barge, Restoration, Town, new homes, album), after the general player
  if (MID) await m1bMinute(live, rec);
  if (MID) await m2Minute(live, rec);
  // both players had attention to spare and nothing useful left: a wait
  const bothIdle = live.every((p) => results[p].idle && results[p].left >= OPS_PER_MINUTE - 2);
  rec.bothIdle = bothIdle;
  if (bothIdle) R.idleBoth.push({ evening, minute, play: state.pm, tracker: rec.tracker[live[0]]?.now ?? '', notes: results[live[0]].notes.slice(0, 3) });

  // settle: how long the server took to confirm the burst, rejections (server races, clock skew), toasts, celebrations
  rec.ackMs = {};
  for (const p of live) rec.ackMs[p] = await settle(pages[p]);
  for (const p of live) if (rec.ackMs[p] >= 0 && results[p].ops.length) R.latency.push(rec.ackMs[p]);
  rec.rejects = [];
  rec.toasts = [];
  rec.celebrations = [];
  for (const p of live) {
    const d = await drain(pages[p]);
    for (const x of d.rej) {
      const r = { at: where(), evening, minute, pid: p, ...x };
      rec.rejects.push(r);
      R.rejects.push(r);
    }
    for (const x of d.toasts) { rec.toasts.push(`${p}: ${x.text}`); R.toasts.push({ at: where(), pid: p, text: x.text }); }
    for (const x of d.cel) rec.celebrations.push(`${p}: ${x.ev}${x.level ? ` ${x.level}` : ''}${x.id ? ` ${x.id}` : ''}`);
    // failed ops (local check failures) were already reported through `reject` events too
  }
  // the level ladder
  const after = await pages[live[0]].evaluate(() => window.__qaPre());
  const L = after.level;
  if (L > lastLevel) {
    for (let l = lastLevel + 1; l <= L; l++) {
      R.levels[l] = { playMinute: state.pm, evening, minute, clock: localStr(after.now), coins: after.coins, xp: after.xp };
    }
    lastLevel = L;
    if (MID) await reachAudit(L);
    await sleep(500);
    await shot(`E${evening}-m${String(minute).padStart(2, '0')}-level-${L}`, live[0], `reached level ${L}`);
  }
  rec.levelAfter = L;
  rec.xpAfter = after.xp;
  rec.coinsAfter = after.coins;
  try {
    const hh = await pages[live[0]].evaluate(() => ({ lat: window.__hh.latency(), health: window.__hh.health(), clock: window.__hh.clockInfo() }));
    rec.rtt = hh.clock?.rtt ?? null;
    rec.inputToFrame = hh.lat?.avg ?? null;
  } catch { /* the page may be navigating */ }
  // odd moments get a screenshot
  const odd = [];
  if (rec.rejects.some((r) => !r.local)) odd.push('server-rejection');
  if (problems.length) odd.push('tracker');
  if (bothIdle && R.idleBoth.length % 6 === 1) odd.push('idle');
  if (rec.ackMs && Object.values(rec.ackMs).some((x) => x < 0 || x > 1500)) odd.push('slow-ack');
  if (odd.length && shotCount < 260) await shot(`E${evening}-m${String(minute).padStart(2, '0')}-${odd[0]}`, live[0], `odd: ${odd.join(', ')} ${(rec.rejects[0] ? `${rec.rejects[0].type} ${rec.rejects[0].code}` : '')} ${problems[0] ?? ''}`);
  for (const p of live) await dismissOverlays(pages[p]);

  rec.wallMs = Date.now() - t0;
  fs.appendFileSync(logFile, `${JSON.stringify(rec)}\n`);
  minuteLog.push(rec);
  // time moves: one play minute is 60 s of game time, counting what the real clock already advanced
  state.pm++;
  const nowEnd = await serverNowOf();
  const wait = minuteStart + MIN - nowEnd;
  if (wait > 0) await warp(wait);
}

// ---- UI probes (real mouse, real panels) -------------------------------------------------------------------------------------------
const probe = (name, ok, detail = '') => {
  R.uiProbes.push({ name, ok: Boolean(ok), detail, at: where() });
  say(ok ? 'ok  ' : 'FAIL', name, detail);
  return ok;
};
const stOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__hh.state)));
const screenOf = (page, x, z, y = 0.15) => page.evaluate(([a, b, c]) => window.__hh.view.toScreen(a, b, c), [x, z, y]);
/** Focus the camera on a tile and wait until the tile's screen position stops moving (the camera eases over several frames). */
const lookAt = async (page, x, z, ms = 700) => {
  await page.evaluate(([a, b]) => window.__hh.view.focus(a, b), [x, z]);
  await sleep(Math.min(ms, 400));
  let last = null;
  for (let i = 0; i < 40; i++) {
    const p = await page.evaluate(([a, b]) => window.__hh.view.toScreen(a, b, 0), [x, z]).catch(() => null);
    if (p && last && Math.abs(p.x - last.x) < 1 && Math.abs(p.y - last.y) < 1) break;
    last = p;
    await sleep(250);
  }
};
const clickText = (page, re, scope = 'body') => page.evaluate(([src, flags, sc]) => {
  const rx = new RegExp(src, flags);
  const root = document.querySelector(sc) || document.body;
  const b = [...root.querySelectorAll('button, [role="button"], [role="tab"]')]
    .find((x) => x.offsetParent !== null && !x.disabled && x.getAttribute('aria-disabled') !== 'true' && rx.test(x.textContent.trim()));
  if (!b) return null;
  b.scrollIntoView({ block: 'nearest' });
  b.click();
  return b.textContent.trim().replace(/\s+/g, ' ').slice(0, 60);
}, [re.source, re.flags, scope]);
const buttonsIn = (page, scope = '#panels') => page.evaluate((sc) => [...(document.querySelector(sc) || document.body).querySelectorAll('button')]
  .filter((x) => x.offsetParent !== null).map((x) => `${x.disabled ? '(off) ' : ''}${x.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)}`), scope).catch(() => []);
const closePanels = (page) => page.evaluate(() => window.__hh.ui.panels.closeAll()).catch(() => {});
const panelOpen = (page, name) => page.evaluate((n) => window.__hh.ui.panels.isOpen(n), name).catch(() => false);
const waitPanel = (page, name, ms = 6000) => page.waitForFunction((n) => window.__hh.ui.panels.isOpen(n), { timeout: ms, polling: 50 }, name).then(() => true).catch(() => false);

async function stroke(page, tiles, y = 0.15) {
  const pts = [];
  for (const [x, z] of tiles) pts.push(await screenOf(page, x + 0.5, z + 0.5, y));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i].x, pts[i].y, { steps: 5 });
  await page.mouse.up();
}
async function clickTile(page, x, z, y = 0.15) {
  const c = await screenOf(page, x, z, y);
  await page.mouse.move(c.x - 3, c.y - 3);
  await page.mouse.move(c.x, c.y, { steps: 2 });
  await sleep(120);
  await page.mouse.click(c.x, c.y);
}

/** Text that is cut off ("Chicke…") or runs off the screen, in whatever is visible now: a cheap sweep for layout bugs. */
async function uiScan(page, label) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out = { truncated: [], offscreen: [] };
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const txt = (el.childElementCount === 0 ? el.textContent : '').trim().replace(/\s+/g, ' ');
      if (!txt) continue;
      const cut = el.scrollWidth > el.clientWidth + 1 && (cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden' || cs.overflowX === 'hidden');
      const clipV = el.scrollHeight > el.clientHeight + 2 && (cs.overflow === 'hidden' || cs.overflowY === 'hidden') && cs.webkitLineClamp !== 'none' && cs.display !== 'inline';
      if ((cut || clipV) && !seen.has(txt)) {
        seen.add(txt);
        out.truncated.push({ text: txt.slice(0, 80), cls: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`, w: el.clientWidth, sw: el.scrollWidth });
      }
      const b = el.getBoundingClientRect();
      if (b.width > 0 && (b.right > vw + 4 || b.bottom > vh + 4 || b.left < -4) && b.top < vh && !seen.has(`o:${txt}`) && !el.closest('#world, #overlay, canvas')) {
        seen.add(`o:${txt}`);
        out.offscreen.push({ text: txt.slice(0, 60), cls: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`, right: Math.round(b.right), bottom: Math.round(b.bottom) });
      }
    }
    out.truncated = out.truncated.slice(0, 12);
    out.offscreen = out.offscreen.slice(0, 8);
    return out;
  }).catch(() => null);
  if (r && (r.truncated.length || r.offscreen.length)) R.uiScans.push({ at: where(), label, ...r });
  return r;
}

const probesDone = new Map();          // `${evening}:${name}` -> attempts (-1 once done)
/**
 * Probes run at the first minute >= their slot at which their precondition holds (fn returns false: not yet); an
 * evening that never meets a precondition is recorded as such (it is a finding in itself when the precondition is basic).
 */
async function runProbes({ evening, minute, minutes, who, solo }) {
  const A = pages.p1 && !pages.p1.isClosed() ? pages.p1 : null;
  const B = pages.p2 && !pages.p2.isClosed() ? pages.p2 : null;
  const due = async (name, fn, { late = 12 } = {}) => {
    const key = `${evening}:${name}`;
    const tries = probesDone.get(key) ?? 0;
    if (tries < 0 || minute < (PM[name] ?? 0)) return;
    probesDone.set(key, tries + 1);
    let done;
    try {
      done = await fn();
    } catch (e) {
      R.errors.push({ at: where(), pid: 'harness', kind: 'probe-exception', text: `${name}: ${String(e && e.stack || e).slice(0, 400)}` });
      say('probe exception', name, e.message);
      probesDone.set(key, -1);
      return;
    }
    if (done !== false) probesDone.set(key, -1);
    else if (tries + 1 >= late) { probesDone.set(key, -1); probe(`${name}: precondition never met`, false, `tried ${late} minutes in a row`); }
  };
  try {
    await lift(true);
    // the Barn, Orders, Journal and Market panels are opened and photographed once an evening (layout, text, overflow)
    if (A) await due('panels', async () => {
      const lvl = await A.evaluate(() => window.__qaPre().level);
      for (const [dock, name, minLevel] of [['market', 'market', 1], ['barn', 'barn', 1], ['orders', 'orders', 2], ['journal', 'journal', 1]]) {
        await A.click(`[data-dock="${dock}"]`).catch(() => {});
        // a locked button answers with a 3 s toast: read it before waiting for a panel that will not open
        await sleep(300);
        const early = lvl < minLevel
          ? await A.evaluate(() => [...document.querySelectorAll('#toasts > *')].map((x) => x.textContent.trim()).join(' | ')).catch(() => '') : '';
        const ok = await waitPanel(A, name, lvl < minLevel ? 1000 : 4000);
        await sleep(500);
        if (!ok && lvl < minLevel) {
          const t = early;
          probe(`the ${name} dock button before level ${minLevel} says why it is closed`, Boolean(t), `toast after a click: ${t || '(none: the button looks pressable and does nothing)'}`);
          continue;
        }
        const vis = ok ? '' : await A.evaluate(() => [...document.querySelectorAll('#panels > section, #panels > div')].filter((e) => e.offsetParent !== null).map((e) => e.id).join(',')).catch(() => '?');
        if (ok) await uiScan(A, `${name} panel`);
        probe(`dock button opens the ${name} panel`, ok, ok ? '' : `not open after 4 s; visible panels: [${vis}]`);
        if ((ok && evening <= 2) || !ok) await shot(`E${evening}-panel-${name}${ok ? '' : '-FAILED'}`, 'p1', `${name} panel at the start of evening ${evening}${ok ? '' : ' (did not open)'}`);
        await closePanels(A);
      }
    });
    // evening 1: the real onboarding: Grandma's welcome, the farm naming card
    // (a mid-game run from a fixture or --from has no first evening: the farm was named long ago)
    if (evening === 1 && A && !MID) await due('onboarding', async () => {
      await sleep(1500);
      const go = await clickText(A, /^Let's go!?$/);
      probe("Grandma's \"Let's go!\" button works", go);
      await sleep(1200);
      let naming = await panelOpen(A, 'naming');
      if (!naming) { await A.evaluate(() => window.__hh.ui.nameFarm?.()); await sleep(500); naming = await panelOpen(A, 'naming'); }
      await shot('E1-naming-card', 'p1', 'the farm naming card');
      const typed = await A.evaluate(() => {
        const i = document.querySelector('input[aria-label="Farm name"]');
        if (!i) return false;
        i.value = 'Sunny Hollow';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      });
      const carved = typed && await clickText(A, /^Carve it!?$/);
      probe('the naming card carves a farm name', carved, naming ? '' : 'the card did not open by itself');
      if (!carved) await clientOf('p1').act('nameFarm', { name: 'Sunny Hollow' });
      await sleep(1200);
      if (B) { await dismissOverlays(B); await clickText(B, /^Love it$/); }
      await shot('E1-named-B', 'p2', "the partner's screen after naming");
    });
    // real drag strokes: plant with the Seed Bag, harvest with the Sickle (on the plot field)
    if (A) await due('strokes', () => strokeProbe(A));
    // the Market's Sell slip and Mabel's Deliver button through the real panels
    if (A) await due('sellui', () => sellProbe(A));
    if (B ?? A) await due('orderui', () => orderProbe(B ?? A));
    // a building panel: make something, collect the tray
    if (B ?? A) await due('buildingui', () => buildingProbe(B ?? A));
    // the Build dock and the placement ghost
    if (A) await due('buildui', () => buildProbe(A));
    // the animals panel and a Feed Scoop stroke
    if (B ?? A) await due('animalui', () => animalProbe(B ?? A));
    // the land card (Market > Land / the story card "Buy the land"): what it says about what is still missing, as soon as the coins are there
    if (A) await due('landui', () => landProbe(A), { late: 100 });
    // Mabel's board as it stands (unfillable orders and all), once an evening: is it readable, does it say what is missing?
    if (B ?? A) await due('boardui', () => boardProbe(B ?? A));
    // the social corner: an emote, a ping, a chat line and a note for the partner (once an evening, both online)
    if (A && B && !solo) await due('social', () => socialProbe(A, B));
    // a Wi-Fi blip: the partner's socket is cut mid-session; she must reconnect, keep her unsent actions and see the same farm
    if (A && B && !solo && (SMOKE || (evening >= 2 && evening <= 3))) await due('blip', () => blipProbe(A, B));
    // a periodic check that the two screens hold the same farm
    if (minute % 10 === 5 && A && B && !solo) await desyncCheck();
    await lift(false);
  } catch (e) {
    await lift(false);
    R.errors.push({ at: where(), pid: 'harness', kind: 'probe-exception', text: String(e && e.stack || e).slice(0, 400) });
    say('probe exception', e.message);
  }
}

async function landProbe(page) {
  const s = await stOf(page);
  const { nextExpansion } = await import('../shared/rules/actions/expansions.js');
  const nx = nextExpansion(s);
  const L = levelFromXp(s.farm.xp);
  if (!nx || L < nx.unlock || s.farm.wallet.coins < nx.cost || (state.landSeen ?? new Set()).has(nx.id)) return false;
  (state.landSeen ??= new Set()).add(nx.id);
  const pre = await page.evaluate(() => [...document.querySelectorAll('#tracker .goal')].map((b) => `${b.dataset.slot}: ${b.querySelector('.gt')?.textContent} — ${b.querySelector('.gs')?.textContent ?? ''}`));
  await page.evaluate((id) => window.__hh.ui.panels.open('expansion', { id }), nx.id);
  const opened = await waitPanel(page, 'expansion');
  await sleep(600);
  const text = await page.evaluate(() => (document.getElementById('panel-expansion')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 1500));
  await shot(`E${state.evening}-land-card-${nx.id}`, page.pid, `the ${nx.name} card with ${s.farm.wallet.coins} coins in hand (cost ${nx.cost})`);
  await uiScan(page, `${nx.name} land card`);
  const proofs = nx.proof.map((t, i) => `${t.verb} ${Array.isArray(t.ref) ? t.ref.join('/') : t.ref} ${t.qty}`);
  R.notes.push({ at: where(), landCard: nx.id, coins: s.farm.wallet.coins, cost: nx.cost, proofTasks: proofs, tracker: pre, cardText: text });
  // the card names every good of every proof task (QA2 integration: the probe matched only Creekside's words, so
  // the Old Orchard's "Own 2 Apple Trees / Make 3 Apple Juice" card failed although it said exactly that)
  const words = nx.proof.flatMap((t) => (Array.isArray(t.ref) ? t.ref : [t.ref])
    .map((r) => (defOf(r)?.name ?? itemOf(r)?.name ?? r).split(/[\s_]/)[0].toLowerCase()));
  const missing = words.filter((w) => !text.toLowerCase().includes(w));
  probe(`the ${nx.name} card says what is still missing`, opened && missing.length === 0, `missing ${missing.join(', ')} || tracker: ${pre.join(' | ')} || card: ${text.slice(0, 220)}`);
  await closePanels(page);
  return true;
}

async function boardProbe(page) {
  const s = await stOf(page);
  const open = Object.values(s.farm.orders.slots).filter((sl) => sl.order);
  if (!open.length) return false;
  await page.click('[data-dock="orders"]').catch(() => {});
  const opened = await waitPanel(page, 'orders');
  await sleep(700);
  await shot(`E${state.evening}-orders-board`, page.pid, 'the Orders board as it stands');
  const text = await page.evaluate(() => (document.getElementById('panel-orders')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 700));
  await uiScan(page, 'Orders board');
  R.notes.push({ at: where(), ordersBoard: text });
  await closePanels(page);
  return opened ? true : false;
}

async function desyncCheck() {
  await inSync();
  const [a, b] = await Promise.all(['p1', 'p2'].map((p) => pages[p].evaluate(() => JSON.stringify(window.__hh.state))));
  if (a !== b) {
    const A = JSON.parse(a);
    const B = JSON.parse(b);
    const diffs = [];
    const walk = (x, y, pth) => {
      if (diffs.length > 5) return;
      if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) { if (x !== y) diffs.push(`${pth}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`); return; }
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${pth}.${k}`);
    };
    walk(A, B, '');
    R.desync.push({ at: where(), diffs });
    probe('both screens hold the same farm', false, diffs.slice(0, 3).join(' | '));
  }
}

async function socialProbe(A, B) {
  // emote + ping + chat through the same socket frames the buttons send
  await A.evaluate(() => { window.__hh.net.raw({ t: 'emote', id: 'wave' }); window.__hh.net.raw({ t: 'mark', x: 28, z: 31, kind: 'look' }); window.__hh.net.raw({ t: 'chat', text: 'Evening! Corn first?' }); });
  await sleep(1200);
  const seenB = await B.evaluate(() => ({ social: window.__hh.social.slice(-4), feed: document.getElementById('feed')?.innerText.slice(-300) ?? '' }));
  probe('an emote, a ping and a chat line reach the partner', seenB.social.length >= 1 || /Evening/.test(seenB.feed), JSON.stringify(seenB).slice(0, 200));
  const note = await clientOf('p2').act('noteAdd', { x: 26, z: 36, text: 'Saved some wheat for the mill' });
  await settle(B);
  probe('leave a note on the farm for the partner', note.ok, note.code ?? '');
  // thank the partner for something in the feed
  const s = await clientOf('p2').snap();
  // feed lines are numbered absolutely (the ring slot is i % historyMax)
  const f = s.s.farm.feed;
  let theirs = null;
  for (let i = f.n - 1; i >= 0 && i >= f.n - FEED.historyMax && !theirs; i--) {
    const r = f.rows[String(i % FEED.historyMax)];
    if (r && r.by === 'p1' && r.ty === undefined) theirs = [i, r];
  }
  if (theirs) {
    const t = await clientOf('p2').act('thank', { i: theirs[0] });
    probe('say Thanks to the partner for a feed line', t.ok, `${theirs[1].k}: ${t.code ?? 'ok'}`);
    await settle(B);
  }
  await drain(A); await drain(B);
}

async function blipProbe(A, B) {
  const before = await B.evaluate(() => ({ v: window.__hh.store.v, coins: window.__hh.state.farm.wallet.coins }));
  // an action sent right before the drop: it must be applied exactly once
  const r = await clientOf('p2').act('sellSurplus', {});
  const drop = await fetch(`http://127.0.0.1:${port}/api/dev/drop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: 'p2' }) }).then((x) => x.json()).catch(() => ({}));
  const t0 = Date.now();
  let back = false;
  for (let i = 0; i < 60 && !back; i++) {
    await sleep(250);
    back = await B.evaluate(() => window.__hh.health().online && window.__hh.health().pending === 0).catch(() => false);
  }
  const ms = Date.now() - t0;
  await inSync(6000);
  const [a, b] = await Promise.all([A, B].map((p) => p.evaluate(() => JSON.stringify(window.__hh.state))));
  const same = a === b;
  R.blips.push({ at: where(), reconnectMs: ms, back, same, sellSurplus: r, dropped: drop, coinsBefore: before.coins });
  probe('a dropped connection comes back by itself with the same farm', back && same, `reconnected in ${ms} ms, screens equal: ${same}`);
  if (!back || !same) await shot(`E${state.evening}-blip-B`, 'p2', 'after a dropped connection');
}

async function strokeProbe(page) {
  await closePanels(page);
  await page.keyboard.press('Escape').catch(() => {});
  const s = await stOf(page);
  const now = await page.evaluate(() => window.__hh.serverNow());
  const plots = Object.entries(s.farm.objects).filter(([, o]) => o.def === 'plot').map(([id, o]) => ({ id, ...o })).sort((a, b) => a.z - b.z || a.x - b.x);
  if (!plots.length) return probe('drag strokes over the plots', false, 'no plots');
  const rows = [...new Set(plots.map((p) => p.z))].map((z) => plots.filter((p) => p.z === z));
  const ripeRow = rows.find((r) => r.filter((p) => p.crop && p.crop.readyAt <= now).length >= 3);
  if (!ripeRow) return false;               // nothing ripe yet: try again next minute
  // the row itself in the middle of the screen: on a big late-game farm the middle of ALL plots can be an empty paddock
  // with the ripe row off screen (wave 3: the stroke missed every plot)
  const midX = ripeRow.reduce((n, p) => n + p.x, 0) / ripeRow.length + 0.5;
  const midZ = ripeRow[0].z + 0.5;
  await lookAt(page, midX, midZ);
  // 1. harvest: the Sickle across a ripe row
  await page.click('[data-tool="sickle"]').catch(() => page.evaluate(() => window.__hh.controller.setTool('sickle')));
  const before = ripeRow.filter((p) => p.crop).length;
  await stroke(page, ripeRow.map((p) => [p.x, p.z]));
  await settle(page);
  await sleep(300);
  const s2 = await stOf(page);
  const left = ripeRow.filter((p) => s2.farm.objects[p.id]?.crop).length;
  probe('a Sickle stroke across a ripe row harvests it', left < before, `${before} -> ${left} planted plots in the row`);
  // 2. plant: pick the seed in the tray, stroke the row that was just emptied
  await page.click('[data-tool="seed_bag"]').catch(() => {});
  await sleep(400);
  const tray = await page.evaluate(() => !document.getElementById('seed-tray').hidden);
  probe('the Seed Bag opens the seed tray', tray);
  if (tray) await page.click('#seed-tray [data-crop="wheat"]').catch(() => {});
  else await page.evaluate(() => window.__hh.controller.setTool('seed_bag', { crop: 'wheat' }));
  await sleep(200);
  const emptyBefore = ripeRow.filter((p) => !s2.farm.objects[p.id].crop).length;
  await stroke(page, ripeRow.map((p) => [p.x, p.z]));
  await settle(page);
  await sleep(300);
  const s3 = await stOf(page);
  const emptyAfter = ripeRow.filter((p) => !s3.farm.objects[p.id].crop).length;
  probe('a Seed Bag stroke across an empty row plants it', emptyAfter < emptyBefore, `${emptyBefore} -> ${emptyAfter} empty plots in the row`);
  await shot(`E${state.evening}-stroke-planted`, page.pid, 'after the real Sickle and Seed Bag strokes');
  await page.evaluate(() => window.__hh.controller.setTool('hand')).catch(() => {});
  return true;
}

async function sellProbe(page) {
  await closePanels(page);
  await page.keyboard.press('Escape').catch(() => {});
  const s = await stOf(page);
  const items = Object.entries(s.farm.inventory).filter(([i, n]) => n >= 2 && itemOf(i)?.sellable && !(itemOf(i).keepDefault > 0)).sort((a, b) => b[1] - a[1]);
  if (!items.length) return false;
  const [item] = items[0];
  const qty = Math.min(items[0][1], 5);
  const before = s.farm.wallet.coins;
  await page.click('[data-dock="market"]').catch(() => {});
  const opened = await waitPanel(page, 'market');
  await sleep(500);
  await clickText(page, /^Sell$/, '#panels');           // the Market reopens on the tab it was left on
  await sleep(400);
  await page.click(`.pn-stack[data-item="${item}"]`).catch(() => {});
  await sleep(200);
  await page.evaluate((q) => {
    const num = document.querySelector('.pn-slip .pn-num');
    if (!num) return;
    num.value = String(q);
    num.dispatchEvent(new Event('change', { bubbles: true }));
  }, qty);
  await sleep(200);
  const sold = await clickText(page, new RegExp(`^Sell ${qty}$`), '.pn-slip');
  await settle(page);
  const s2 = await stOf(page);
  await shot(`E${state.evening}-market-sell`, 'p1', `selling ${qty} ${item} in the Market slip`);
  probe('Market: pick a stack, set the quantity, press Sell N', Boolean(opened && sold) && s2.farm.wallet.coins > before, `${item} x${qty}: ${before} -> ${s2.farm.wallet.coins}; buttons: ${sold ?? JSON.stringify((await buttonsIn(page, '.pn-slip')).slice(0, 6))}`);
  await closePanels(page);
  return true;
}

async function orderProbe(page) {
  await closePanels(page);
  await page.keyboard.press('Escape').catch(() => {});
  const s = await stOf(page);
  const fillableSlot = Object.entries(s.farm.orders.slots).find(([, sl]) => sl.order && fillable(s, sl.order));
  if (!fillableSlot) return false;          // nothing to deliver yet: try again next minute
  await page.click('[data-dock="orders"]').catch(() => {});
  const opened = await waitPanel(page, 'orders');
  await sleep(600);
  await shot(`E${state.evening}-orders-panel`, page.pid, 'the Orders board panel with a fillable order');
  const before = s.farm.wallet.coins;
  const filled = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-fill]')].find((x) => !x.disabled && x.offsetParent);
    if (!b) return null;
    b.click();
    return b.dataset.fill;
  });
  await settle(page);
  const s2 = await stOf(page);
  probe("Orders: Mabel's Deliver button fills a ready order", opened && filled !== null && s2.farm.wallet.coins > before, `slot ${filled}: coins ${before} -> ${s2.farm.wallet.coins}${filled === null ? ` buttons ${JSON.stringify((await buttonsIn(page)).slice(0, 8))}` : ''}`);
  await closePanels(page);
  return true;
}

async function buildingProbe(page) {
  await closePanels(page);
  await page.keyboard.press('Escape').catch(() => {});
  const s = await stOf(page);
  const feedMill = Object.entries(s.farm.objects).find(([, o]) => o.def === 'feed_mill');
  if (!feedMill) return false;
  // Chicken Feed takes 3 of the GRAIN class (Wheat, Corn; Carrots are roots), and a free queue slot
  const grain = (s.farm.inventory.wheat ?? 0) + (s.farm.inventory.corn ?? 0);
  if (grain < 3) return false;              // wait for some
  const [id, o] = feedMill;
  if (o.queue.length >= o.slots) return false;
  await lookAt(page, o.x + 1.5, o.z + 1.5, 800);
  await clickTile(page, o.x + 1.5, o.z + 1.5, 1.0);
  const opened = await waitPanel(page, 'building');
  await sleep(500);
  await shot(`E${state.evening}-building-panel`, page.pid, 'the Feed Mill panel');
  await uiScan(page, 'Feed Mill panel');
  const q0 = s.farm.objects[id].queue.length;
  const made = await page.evaluate(() => {
    const b = document.querySelector('[data-craft="chicken_feed"]');
    if (!b || b.disabled) return false;
    b.click();
    return true;
  });
  await settle(page);
  const s2 = await stOf(page);
  const q1 = s2.farm.objects[id].queue.length;
  probe('a Hand click on the Feed Mill opens its panel and Make queues Chicken Feed', Boolean(opened) && made && q1 > q0, `${opened ? 'opened' : 'did not open'}; ${made ? `queue ${q0} -> ${q1}` : `Make button not usable with ${grain} grain in the Barn: ${JSON.stringify((await buttonsIn(page)).slice(0, 8))}`}`);
  await closePanels(page);
  return true;
}

async function buildProbe(page) {
  await closePanels(page);
  await page.keyboard.press('Escape').catch(() => {});
  // the Build dock opens the tray of things waiting to be placed, or the Market when nothing waits; a Market card starts the ghost
  const s = await stOf(page);
  const plotCount = Object.values(s.farm.objects).filter((o) => o.def === 'plot').length;
  await page.click('[data-dock="build"]').catch(() => {});
  await sleep(700);
  const cards = await page.evaluate(() => [...document.querySelectorAll('#build-tray .build-card')].map((c) => c.dataset.def));
  const market = await panelOpen(page, 'market');
  probe('the Build dock opens something to place from', cards.length > 0 || market, cards.length ? `build tray cards: ${cards.slice(0, 8).join(', ')}` : market ? 'no free items waiting: the Market opened' : 'nothing opened');
  await shot(`E${state.evening}-build-dock`, page.pid, 'what the Build dock shows');
  let def = null;
  const { defOf: defOfC } = await import('../shared/content/index.js');
  const placeable = cards.filter((c) => defOfC(c) && defOfC(c).size);       // the tray also holds the "Move" and "Shop" cards
  if (placeable.length) {
    def = placeable.includes('plot') ? 'plot' : placeable[0];
    await page.click(`#build-tray .build-card[data-def="${def}"]`).catch(() => {});
  } else if (market) {
    // the first enabled "Place ..." button on the Market's visible tab (a plot, when the cap allows)
    def = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-place]')].find((x) => !x.disabled && x.offsetParent);
      if (!b) return null;
      b.click();
      return b.dataset.place;
    });
  }
  if (!def) { await closePanels(page); return true; }
  await sleep(400);
  const { canPlace } = await import('../shared/rules/grid.js');
  const { defOf } = await import('../shared/content/index.js');
  const d = defOf(def);
  const [w, dd] = d.size ?? [1, 1];
  let spot = null;
  for (let r = 0; r < 16 && !spot; r++) {
    for (let dz = -r; dz <= r && !spot; dz++) for (let dx = -r; dx <= r && !spot; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (canPlace(s, def, 26 + dx, 37 + dz, 0) === null) spot = { x: 26 + dx, z: 37 + dz };
    }
  }
  if (!spot) { probe(`the placement ghost for ${def}`, false, 'no legal spot found by the harness'); await page.keyboard.press('Escape').catch(() => {}); return true; }
  await lookAt(page, spot.x + w / 2, spot.z + dd / 2, 800);
  const c0 = await screenOf(page, spot.x + w / 2, spot.z + dd / 2, 0);
  await page.mouse.move(c0.x - 4, c0.y - 4);
  await page.mouse.move(c0.x, c0.y, { steps: 3 });
  await sleep(500);
  await shot(`E${state.evening}-ghost-${def}`, page.pid, `the placement ghost for ${def}`);
  await page.mouse.click(c0.x, c0.y);
  await sleep(600);
  if (await panelOpen(page, 'confirm')) { await shot(`E${state.evening}-big-spend-card`, page.pid, 'the BIG_SPEND card'); await clickText(page, /buy it|yes/i); }
  await settle(page);
  const s2 = await stOf(page);
  const n2 = Object.values(s2.farm.objects).filter((o) => o.def === def).length;
  const n1 = Object.values(s.farm.objects).filter((o) => o.def === def).length;
  probe(`Build: pick ${def}, aim the ghost, click to place`, n2 > n1, `${def}: ${n1} -> ${n2}; plots ${plotCount}`);
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => window.__hh.controller.setTool('hand')).catch(() => {});
  return true;
}

async function animalProbe(page) {
  await closePanels(page);
  await page.keyboard.press('Escape').catch(() => {});
  const s = await stOf(page);
  const coop = Object.entries(s.farm.objects).find(([, o]) => o.def === 'coop');
  if (!coop) return false;
  if ((s.farm.inventory.chicken_feed ?? 0) < 1) return false;
  const [id, o] = coop;
  await lookAt(page, o.x + 1.5, o.z + 1.5, 800);
  await page.evaluate((cid) => window.__hh.ui.panels.open('animals', { id: cid }), id);
  const opened = await waitPanel(page, 'animals');
  await sleep(500);
  await shot(`E${state.evening}-animals-panel`, page.pid, 'the Coop panel');
  await uiScan(page, 'Coop panel');
  probe('the Coop panel opens', opened, JSON.stringify((await buttonsIn(page)).slice(0, 8)));
  await closePanels(page);
  // the Feed Scoop stroke over the pen
  await page.click('[data-tool="feed_scoop"]').catch(() => page.evaluate(() => window.__hh.controller.setTool('feed_scoop')));
  const nowA = await page.evaluate(() => window.__hh.serverNow());
  const adultHungry = (st) => Object.values(st.farm.objects).filter((a) => a.home === id && a.readyAt === null && a.adultAt <= nowA).length;
  const hungry = adultHungry(s);
  if (hungry === 0) { await page.evaluate(() => window.__hh.controller.setTool('hand')).catch(() => {}); return false; }
  await stroke(page, [[o.x + 0.2, o.z + 0.6], [o.x + 1, o.z + 0.6], [o.x + 2, o.z + 0.6]], 0.4);
  await settle(page);
  const s2 = await stOf(page);
  const hungry2 = adultHungry(s2);
  probe('a Feed Scoop stroke over the Coop feeds hungry hens', hungry === 0 || hungry2 < hungry, `hungry ${hungry} -> ${hungry2}`);
  await page.evaluate(() => window.__hh.controller.setTool('hand')).catch(() => {});
  return true;
}

// ---- co-op probes (Golden Hour on the bench, the high-five) -------------------------------------------------------------------------
async function coopSession(label) {
  // Golden Hour: both players sit on the Sunset Bench (L4+), 10 s of server time later the buff starts (GDD §6.2 #9)
  const c1 = clientOf('p1');
  const c2 = clientOf('p2');
  const { s, now } = await c1.snap();
  const L = levelFromXp(s.farm.xp);
  const rec = { label, level: L };
  if (L < 4) { rec.skipped = 'below level 4'; R.coop.push(rec); return; }
  let bench = Object.entries(s.farm.objects).find(([, o]) => o.def === 'sunset_bench');
  if (!bench) {
    const { findSpot } = await import('./qa-bot.mjs');
    const spot = findSpot(s, 'sunset_bench', 22, 27);
    const r = spot ? await c1.act('place', { def: 'sunset_bench', ...spot }) : { ok: false, code: 'NO_SPOT' };
    rec.bought = r;
    await settle(pages.p1);
    const s2 = (await c1.snap()).s;
    bench = Object.entries(s2.farm.objects).find(([, o]) => o.def === 'sunset_bench');
  }
  if (!bench) { rec.skipped = `no bench (${JSON.stringify(rec.bought)})`; R.coop.push(rec); return; }
  const [bid, bo] = bench;
  // both farmers stand at the bench first: the server checks a seat against the avatar's position (RC-31), and the
  // high-five below needs them side by side
  // place() teleports on the next avatar frame, and the pages draw at ~2 Hz between probes: flush the pose at once, or
  // the server checks the seat against the old pose and refuses it (TOO_FAR, RC-31)
  await Promise.all(['p1', 'p2'].map((p) => pages[p].evaluate((o) => { window.__hh.avatar.place(o.x + 1, o.z - 0.6); window.__hh.avatar.flush(); }, bo)));
  await sleep(600);
  const [r1, r2] = await Promise.all([c1.act('sit', { id: bid }), c2.act('sit', { id: bid })]);
  rec.sit = [r1, r2];
  await Promise.all([settle(pages.p1), settle(pages.p2)]);
  await sleep(300);
  await shot(`E${state.evening}-bench-A`, 'p1', 'both on the Sunset Bench');
  await warp(12_000);
  await sleep(600);
  const s3 = (await c1.snap()).s;
  rec.golden = s3.farm.coop.golden;
  rec.ok = Boolean(s3.farm.coop.golden);
  probe('Golden Hour starts when both farmers sit on the Sunset Bench', rec.ok, JSON.stringify({ sit: [r1.code ?? 'ok', r2.code ?? 'ok'], golden: rec.golden }));
  await shot(`E${state.evening}-golden-hour-A`, 'p1', 'Golden Hour active');
  await shot(`E${state.evening}-golden-hour-B`, 'p2', 'Golden Hour active, partner screen');
  // a duet (L10: the Sweetheart Cake) when the Barn already holds its ingredients: both press within 3 s
  const s4 = (await c1.snap()).s;
  const bakery = Object.entries(s4.farm.objects).find(([, o]) => o.def === 'bakery' && o.queue.length < o.slots);
  const need = { flour: 2, egg: 2, butter: 1, strawberry: 2 };
  if (L >= 10 && bakery && Object.entries(need).every(([i, q]) => (s4.farm.inventory[i] ?? 0) >= q)) {
    const dr = await Promise.all([c1.act('duet', { id: bakery[0], recipe: 'sweetheart_cake' }), c2.act('duet', { id: bakery[0], recipe: 'sweetheart_cake' })]);
    await Promise.all([settle(pages.p1), settle(pages.p2)]);
    const s5 = (await c1.snap()).s;
    const q = s5.farm.objects[bakery[0]].queue.at(-1);
    rec.duet = { presses: dr, queued: q ? { r: q.r, duet: q.duet === true, slow: q.slow === true } : null };
    probe('a Duet: both farmers press Cook together within 3 s', Boolean(q && q.duet), JSON.stringify(rec.duet));
  } else rec.duet = { skipped: L < 10 ? 'below level 10' : !bakery ? 'no free Bakery slot' : 'ingredients not in the Barn' };
  const hf = await Promise.all([c1.act('highFive', {}), c2.act('highFive', {})]);
  rec.highFive = hf;
  await Promise.all([settle(pages.p1), settle(pages.p2)]);
  await Promise.all([c1.act('stand', {}), c2.act('stand', {})]);
  R.coop.push(rec);
}

// ---- mid-game mode: the M1b layer, unlock reachability, dead ends --------------------------------------------------------------------
/** Which M1b system an op belongs to (first-use bookkeeping). */
const SYSTEM_OF = { fairEnter: 'fair', bargeLoad: 'barge', donate: 'restoration', townGive: 'town', townFund: 'town', albumTrade: 'album',
  masterwork: 'masterwork' };

/**
 * One minute of the M1b layer for one player, IN THE PAGE (serialised by page.evaluate: no Node closures). Uses the
 * new systems the way a couple would, each action dry-run first through the rules' own check, and says for every
 * live system why it could not be used when it was not ({ ops, diag, live }).
 */
async function m1bTurnInPage({ pid, budget }) {
  const O = location.origin;
  const imp = async (p) => { try { return await import(`${O}/shared/${p}`); } catch { return {}; } };
  const [C, IDX, SCH, ECO, GRID, DEC, FAIR, BARGE, REST, TOWN, ALBUM, ANIM] = await Promise.all([
    imp('content/index.js'), imp('rules/index.js'), imp('rules/schema.js'), imp('rules/economy.js'), imp('rules/grid.js'),
    imp('rules/actions/decor.js'), imp('rules/actions/fair.js'), imp('rules/actions/barge.js'), imp('rules/actions/restoration.js'),
    imp('rules/actions/town.js'), imp('rules/actions/album.js'), imp('rules/actions/animals.js')]);
  const h = window.__hh;
  const ops = [];
  const diag = {};
  const live = {};
  const used = {};
  let left = budget;
  const S = () => h.state;
  const now = h.serverNow();
  const L = C.levelFromXp(S().farm.xp);
  const avail = (item) => (typeof ECO.unkept === 'function' ? ECO.unkept(S(), item) : ECO.available(S(), item));
  const check = (type, args) => {
    const def = IDX.ACTIONS?.[type];
    if (!def) return 'UNKNOWN_ACTION';
    const parsed = SCH.parseArgs(def.schema, args);
    if (!parsed) return 'BAD_ARGS';
    try {
      const ctx = IDX.makeCtx(S(), { now: h.serverNow(), pid, cid: h.cid, seq: h.store.seq + 1, ext: {}, grace: 0 });
      return def.check(S(), parsed, ctx) || null;
    } catch (e) { return `INTERNAL ${e.message}`; }
  };
  const act = (type, args, why, sys = null) => {
    if (left <= 0) return false;
    left--;
    const r = h.act(type, args);
    ops.push({ type, ok: Boolean(r && r.ok), code: (r && r.code) ?? null, why, sys });
    return Boolean(r && r.ok);
  };
  const name = (item) => C.itemOf?.(item)?.name ?? item;
  const value = (item) => C.itemOf?.(item)?.value ?? C.itemOf?.(item)?.sell ?? 0;
  const inv = () => Object.keys(S().farm.inventory).filter((i) => avail(i) > 0);

  // the County Fair (L14): each farmer enters the best eligible good they hold (both enter: a co-op flow)
  if (typeof FAIR.fairUnlocked === 'function' && FAIR.fairUnlocked(S())) {
    live.fair = true;
    const cur = S().farm.fair?.cur;
    const ok = inv().filter((i) => check('fairEnter', { item: i, qty: 1 }) === null).sort((a, b) => value(b) - value(a) || (a < b ? -1 : 1));
    if (!cur || cur.open === false) diag.fair = 'the Fair is closed (Sunday 20:00 -> Monday)';
    else if (!ok.length) diag.fair = `nothing to enter: no T3/T4 or duet good in the Barn (holding ${inv().length} kinds of goods)`;
    else {
      const item = ok[pid === 'p1' ? 0 : Math.min(1, ok.length - 1)];
      const ent = cur.ent?.[item] ?? 0;
      const lim = typeof FAIR.entryLimit === 'function' ? FAIR.entryLimit() : 10;
      const qty = Math.max(1, Math.min(3, avail(item), lim - ent));
      if (act('fairEnter', { item, qty }, `enter ${qty} ${name(item)} at the Fair`)) diag.fair = null;
    }
  }
  // the River Barge (L15): load any crate whose goods are in the Barn
  if (typeof BARGE.bargeUnlocked === 'function' && BARGE.bargeUnlocked(S())) {
    live.barge = true;
    const b = S().farm.barge;
    if (!b || !b.docked) diag.barge = 'the barge is not docked (Monday 06:00 -> Sunday 20:00)';
    else if (!b.rows) diag.barge = 'the barge sails light: nothing the farm made in 14 days fits a crate';
    else {
      const open = Object.entries(b.crates ?? {}).filter(([i, c]) => !c.by && Number(i) < b.rows * 3);
      const can = open.filter(([i, c]) => avail(c.item) >= c.qty && check('bargeLoad', { i: Number(i) }) === null);
      // the crate's manifest week and item ride along (qa2 RC-07: a stale index never loads another crate)
      if (can.length) { const [i, c] = can[0]; act('bargeLoad', { i: Number(i), ...(Number.isSafeInteger(b.w) ? { w: b.w } : {}), item: c.item }, `load ${c.qty} ${name(c.item)} on the barge`); diag.barge = null; }
      else if (open.length) diag.barge = `crates wait for: ${open.map(([, c]) => `${c.qty} ${name(c.item)} (have ${avail(c.item)})`).join(', ')}`;
      else diag.barge = null;
    }
  }
  // the Restoration Ledger (L16): give what the Barn holds to the open project, piece by piece
  if (typeof REST.openProject === 'function') {
    const p = REST.openProject(S());
    if (p) {
      live.restoration = true;
      let gave = false;
      const missing = [];
      for (const bundle of p.bundles ?? []) {
        if (REST.bundleDone?.(S(), p.id, bundle.id)) continue;
        for (const [i, slot] of (bundle.slots ?? []).entries()) {
          const need = REST.slotNeed(p, slot);
          const have = REST.slotHave(S(), p.id, bundle.id, i);
          if (have >= need.need) continue;
          const want = need.need - have;
          let qty = 0;
          if (need.kind === 'item') qty = Math.min(want, avail(need.item));
          else if (need.kind === 'coins') qty = S().farm.wallet.coins >= want * 3 ? want : 0;
          if (qty > 0 && !gave && check('donate', { project: p.id, bundle: bundle.id, slot: i, qty }) === null) {
            gave = act('donate', { project: p.id, bundle: bundle.id, slot: i, qty }, `give ${qty} ${need.kind === 'item' ? name(need.item) : 'coins'} to ${p.name}: ${bundle.name ?? bundle.id}`);
          } else if (qty === 0) missing.push(need.kind === 'item' ? `${want} ${name(need.item)}` : need.kind === 'coins' ? `${want} coins` : `${want} ${need.special}`);
        }
      }
      diag.restoration = gave ? null : missing.length ? `nothing to give: the bundles want ${missing.slice(0, 6).join(', ')}` : 'every open slot is full';
    }
  }
  // Town Projects (L20)
  const town = S().farm.town;
  if (town && town.cur && IDX.ACTIONS?.townGive) {
    live.town = true;
    // farm.town.cur = { id, goods: [{ item, qty, got, by }], coins, paid, by, buildAt? } (rules-economy town.js)
    const goods = (Array.isArray(town.cur.goods) ? town.cur.goods : []).map((x) => ({ ...x, left: x.qty - (x.got ?? 0) })).filter((x) => x.left > 0);
    const coinsLeft = Number.isSafeInteger(town.cur.coins) ? town.cur.coins - (town.cur.paid ?? 0) : 0;
    const g = goods.find((x) => avail(x.item) > 0 && check('townGive', { item: x.item, qty: Math.min(avail(x.item), x.left) }) === null);
    if (g) { act('townGive', { item: g.item, qty: Math.min(avail(g.item), g.left) }, `give ${name(g.item)} to the village`); diag.town = null; }
    else if (coinsLeft > 0 && S().farm.wallet.coins > coinsLeft * 3 && check('townFund', { coins: coinsLeft, confirm: ['BIG_SPEND'] }) === null) {
      act('townFund', { coins: coinsLeft, confirm: ['BIG_SPEND'] }, 'fund the Town Project'); diag.town = null;
    } else if (town.cur.buildAt) diag.town = null;                  // everything is in: built tomorrow
    else diag.town = `the project wants: ${goods.map((x) => `${x.left} ${name(x.item)} (have ${avail(x.item)})`).join(', ') || ''}${coinsLeft ? ` + ${coinsLeft} coins` : ''}`;
  }
  // the new animal homes (beehive L13, pig pen L17, duck pond L19 ...): build one when the treasury can spare it, then
  // two young animals into it (a home without animals is a dead end the bot would not notice)
  const bot = window.__bot;
  for (const home of C.CONTENT.homes.values()) {
    if (!C.isLive(home) || (home.unlock ?? 1) > L || home.m === 'M1a') continue;
    const sys = home.id === 'beehive' ? 'bees' : home.id;
    live[sys] = true;
    const owned = Object.values(S().farm.objects).filter((o) => o.def === home.id).length;
    const price = typeof DEC.buyPrice === 'function' ? DEC.buyPrice(S(), home.id).coins : home.cost;
    // a home the general player already built (it buys every unlocked home) is the system in use
    if (owned > 0) used[sys] = true;
    if (owned === 0 || (home.id === 'beehive' && owned < 2)) {
      const spot = bot && typeof bot.findSpot === 'function' ? bot.findSpot(S(), home.id, 30, 36) : null;
      const code = spot ? check('place', { def: home.id, ...spot, rot: 0, confirm: ['BIG_SPEND'] }) : 'NO_SPOT';
      if (spot && code === null && S().farm.wallet.coins >= price * 1.5) {
        act('place', { def: home.id, ...spot, rot: 0, confirm: ['BIG_SPEND'] }, `build a ${home.name}`, sys);
        diag[sys] = null;
      } else diag[sys] = code === null ? `saving up: ${home.name} costs ${price}, the treasury holds ${S().farm.wallet.coins}` : `${home.name}: ${code}`;
      continue;
    }
    const species = (home.species ?? []).map((id) => C.animalOf?.(id)).find((a) => a && C.isLive(a) && a.shop !== false && a.baby);
    if (!species) { diag[sys] = null; continue; }
    const n = Object.values(S().farm.objects).filter((o) => o.def === species.id).length;
    if (n >= 2) { diag[sys] = null; continue; }
    const ap = typeof ANIM.animalPrice === 'function' ? ANIM.animalPrice(S(), species.id, false) : species.baby;
    const code = check('buyAnimal', { def: species.id, max: ap });
    if (code === null && S().farm.wallet.coins >= ap * 2) { act('buyAnimal', { def: species.id, max: ap }, `buy a young ${species.name}`, sys); diag[sys] = null; }
    else diag[sys] = code ? `${species.name}: ${code}` : `saving up for a ${species.name} (${ap})`;
  }
  // the album (L10): three duplicates of a set buy its missing piece
  if (typeof ALBUM.liveSets === 'function' && typeof ALBUM.dupesOf === 'function' && S().farm.album) {
    live.album = ALBUM.liveSets().length > 0 && L >= (C.COLLECTION_RULES?.unlock ?? 10);
    for (const set of ALBUM.liveSets()) {
      if (ALBUM.dupesOf(S(), set) < (C.COLLECTION_RULES?.tradeIn ?? 3)) continue;
      const want = ALBUM.missingOf(S(), set)[0];
      if (want && check('albumTrade', { set: set.id, want }) === null) act('albumTrade', { set: set.id, want }, `trade duplicates for ${want}`);
    }
    const found = Object.values(S().farm.album.sets ?? {}).reduce((n, st) => n + Object.keys(st.items ?? {}).length, 0);
    diag.album = found ? null : 'no collection item found yet';
  }
  return { ops, diag, live, L, used };
}

/**
 * Content that a level just unlocked, and whether the rules let the farm reach it NOW (IN THE PAGE). A def the level
 * opened that the rules refuse with LOCKED / BAD_ARGS / UNKNOWN_ACTION is a dead end (a gating mismatch between the
 * content tables and the rules); NO_COINS, NO_ROOM, NO_ITEMS and the like are ordinary and not reported.
 */
async function reachInPage({ level, pid }) {
  const O = location.origin;
  const C = await import(`${O}/shared/content/index.js`);
  const IDX = await import(`${O}/shared/rules/index.js`);
  const SCH = await import(`${O}/shared/rules/schema.js`);
  const h = window.__hh;
  const s = h.state;
  const check = (type, args) => {
    const def = IDX.ACTIONS[type];
    if (!def) return 'UNKNOWN_ACTION';
    const parsed = SCH.parseArgs(def.schema, args);
    if (!parsed) return 'BAD_ARGS';
    try { return def.check(s, parsed, IDX.makeCtx(s, { now: h.serverNow(), pid, cid: h.cid, seq: h.store.seq + 1, ext: {}, grace: 0 })) || null; }
    catch (e) { return `INTERNAL ${e.message}`; }
  };
  const unlocks = [];
  const refused = [];
  const HARD = /^(LOCKED|BAD_ARGS|UNKNOWN_ACTION|INTERNAL)/;
  const plot = Object.entries(s.farm.objects).find(([, o]) => o.def === 'plot' && !o.crop && o.gh === undefined)?.[0] ?? null;
  const bot = window.__bot;
  for (const fam of ['crops', 'trees', 'animals', 'homes', 'buildings', 'decor', 'recipes', 'features']) {
    const map = C.CONTENT[fam];
    if (!map || typeof map.values !== 'function') continue;
    for (const d of map.values()) {
      if ((d.unlock ?? 0) !== level || !C.isLive(d)) continue;
      unlocks.push({ fam, id: d.id, name: d.name ?? d.title ?? d.id });
      let code = null;
      if (fam === 'crops') code = plot ? check('plant', { id: plot, crop: d.id }) : null;
      else if (fam === 'animals') code = d.shop === false ? null : check('buyAnimal', { def: d.id });
      else if (['trees', 'homes', 'buildings', 'decor'].includes(fam)) {
        const spot = bot?.findSpot?.(s, d.id, 30, 36);
        code = spot ? check('place', { def: d.id, ...spot, rot: 0 }) : null;
      } else if (fam === 'recipes') {
        const b = Object.entries(s.farm.objects).find(([, o]) => o.def === d.building)?.[0];
        code = b ? check('craft', { id: b, recipe: d.id }) : null;
      }
      if (code && HARD.test(code)) refused.push({ fam, id: d.id, code });
    }
  }
  return { unlocks, refused };
}

/** The M1b layer for every live player this minute; first use per system; dead-end bookkeeping. */
async function m1bMinute(live, rec) {
  rec.m1b = {};
  for (const p of live) {
    await inSync();               // the partner's gifts of a moment ago are on this screen (as on a LAN, ~10 ms)
    let r;
    try {
      r = await pages[p].evaluate(m1bTurnInPage, { pid: p, budget: 4 });
    } catch (e) {
      R.errors.push({ at: where(), pid: p, kind: 'm1b-exception', text: String(e && e.message || e).slice(0, 300) });
      continue;
    }
    if (r.ops.length) rec.m1b[p] = r.ops.map((o) => `${o.ok ? '' : `!${o.code} `}${o.type}: ${o.why}`);
    for (const o of r.ops) {
      const sys = o.sys ?? SYSTEM_OF[o.type] ?? o.type;
      (R.m1b.ops[sys] ??= { ok: 0, refused: 0 })[o.ok ? 'ok' : 'refused']++;
      if (o.ok && R.m1b.first[sys] === undefined) { R.m1b.first[sys] = state.pm; say(`M1b: first ${sys} at play minute ${state.pm}: ${o.why}`); }
    }
    for (const sys of Object.keys(r.live)) if (r.live[sys] && R.m1b.live[sys] === undefined) R.m1b.live[sys] = state.pm;
    for (const sys of Object.keys(r.used ?? {})) {
      if (R.m1b.first[sys] === undefined) { R.m1b.first[sys] = state.pm; say(`M1b: first ${sys} at play minute ${state.pm}: built by the general player`); }
    }
    for (const [sys, why] of Object.entries(r.diag)) if (why) R.m1b.diag[sys] = { why, at: where(), pm: state.pm };
    // collection finds and beauty stars happen on their own: read them off the state
    const flags = await pages[p].evaluate(() => {
      const s = window.__hh.state;
      const finds = Object.values(s.farm.album?.sets ?? {}).reduce((n, st) => n + Object.keys(st.items ?? {}).length, 0);
      return { finds, stars: s.farm.beauty?.stars ?? 0 };
    }).catch(() => ({ finds: 0, stars: 0 }));
    if (flags.finds > 0 && R.m1b.first.album === undefined) R.m1b.first.album = state.pm;
    if (flags.stars > 0 && R.m1b.first.beauty === undefined) R.m1b.first.beauty = state.pm;
  }
}

/**
 * One minute of the M2 layer for one player, IN THE PAGE (serialised: no Node closures). The late-game systems as a
 * couple would use them, each action dry-run first through the rules' own check; for every live system the reason it
 * was not used ({ ops, diag, live, used }). System keys: perks fishing nursery breeding duel interior league track.
 */
async function m2TurnInPage({ pid, budget }) {
  const O = location.origin;
  const imp = async (p) => { try { return await import(`${O}/shared/${p}`); } catch { return {}; } };
  const [C, IDX, SCH, ECO, PERK, FISH, BREED, DUELR, INT, TRACK] = await Promise.all([imp('content/index.js'), imp('rules/index.js'),
    imp('rules/schema.js'), imp('rules/economy.js'), imp('rules/actions/perks.js'), imp('rules/actions/fishing.js'),
    imp('rules/actions/breeding.js'), imp('rules/actions/duel.js'), imp('rules/actions/interior.js'), imp('rules/actions/track.js')]);
  const h = window.__hh;
  const ops = [];
  const diag = {};
  const live = {};
  const used = {};
  let left = budget;
  const S = () => h.state;
  const now = () => h.serverNow();
  const check = (type, args) => {
    const def = IDX.ACTIONS?.[type];
    if (!def) return 'UNKNOWN_ACTION';
    const parsed = SCH.parseArgs(def.schema, args);
    if (!parsed) return 'BAD_ARGS';
    try {
      return def.check(S(), parsed, IDX.makeCtx(S(), { now: now(), pid, cid: h.cid, seq: h.store.seq + 1, ext: {}, grace: 0 })) || null;
    } catch (e) { return `INTERNAL ${e.message}`; }
  };
  const act = (type, args, why, sys) => {
    if (left <= 0) return false;
    left--;
    const r = h.act(type, args);
    ops.push({ type, ok: Boolean(r && r.ok), code: (r && r.code) ?? null, why, sys });
    return Boolean(r && r.ok);
  };
  const avail = (item) => (typeof ECO.unkept === 'function' ? ECO.unkept(S(), item) : ECO.available?.(S(), item) ?? 0);
  // perks: each farmer their own trees in order (p1 Grower then Orchardist, p2 Rancher then Artisan)
  if (typeof PERK.perksLive === 'function' && PERK.perksLive(S())) {
    live.perks = true;
    const trees = pid === 'p1' ? ['grower', 'orchardist', 'artisan', 'rancher'] : ['rancher', 'artisan', 'grower', 'orchardist'];
    const free = PERK.perkPoints(S(), pid) - PERK.perkSpent(S(), pid);
    if (PERK.perkSpent(S(), pid) > 0) used.perks = true;
    const t = trees.find((x) => check('perkPick', { tree: x }) === null);
    if (t) { act('perkPick', { tree: t }, `pick the next ${t} perk`, 'perks'); diag.perks = null; }
    else diag.perks = free > 0 ? `a point to spend, every pick refused (${trees.map((x) => check('perkPick', { tree: x })).join('/')})` : null;
  }
  // the Fishing Dock: reel a line at its bite; else a cast when the hour is up (a dock needs the farmer on it)
  if (typeof FISH.fishingLive === 'function' && FISH.fishingLive(S())) {
    const spots = FISH.fishingSpots(S());
    live.fishing = spots.length > 0;
    if ((S().farm.fishing?.n ?? 0) > 0) used.fishing = true;
    const line = FISH.lineOf(S(), pid);
    if (line) {
      if (now() >= line.bite && check('reel', {}) === null) { act('reel', {}, 'reel in at the bite', 'fishing'); diag.fishing = null; }
    } else if (spots.length && now() >= FISH.nextCastAt(S(), pid)) {
      const sp = spots[pid === 'p1' ? 0 : spots.length - 1];
      if (sp.id) {
        const o = S().farm.objects[sp.id];
        h.avatar.place(o.x + 1, o.z + 2.4);                   // the farmer steps onto the dock (the server checks the pose)
        h.avatar.flush?.();
        await new Promise((r) => setTimeout(r, 250));
      }
      const a = sp.id ? { id: sp.id } : { pond: sp.pond };
      const code = check('cast', a);
      if (code === null) { act('cast', a, `cast at ${sp.id ? 'the Fishing Dock' : sp.pond}`, 'fishing'); diag.fishing = null; }
      else diag.fishing = `cast: ${code}`;
    } else if (!spots.length) diag.fishing = 'no fishing spot: Willow Pond not bought, no Fishing Dock placed';
  }
  // the Nursery: the next care step of a carded baby when due; a new card for a young baby; the personality pick
  if (typeof BREED.nurseryOpen === 'function' && BREED.nurseryOpen(S())) {
    live.nursery = true;
    const objs = S().farm.objects;
    const animals = Object.keys(objs).sort().filter((k) => typeof objs[k].home === 'string' && C.animalOf?.(objs[k].def)?.feed !== null);
    if (animals.some((k) => objs[k].nurse)) used.nursery = true;
    const full = animals.find((k) => objs[k].nurse && !BREED.nextCareStep(objs[k]) && !objs[k].pers);
    const due = animals.find((k) => objs[k].nurse && BREED.nextCareStep(objs[k]) && check('nurse', { id: k }) === null);
    const young = animals.find((k) => !objs[k].nurse && objs[k].adultAt > now() && check('nurse', { id: k }) === null);
    if (full && check('nursePick', { id: full, personality: 'playful', specialty: 'bountiful' }) === null) {
      act('nursePick', { id: full, personality: pid === 'p1' ? 'playful' : 'sleepy', specialty: pid === 'p1' ? 'bountiful' : 'tidy' }, 'pick a personality', 'nursery');
    } else if (due) act('nurse', { id: due }, `the next care step for ${objs[due].def}`, 'nursery');
    else if (young && avail('baby_bottle') + avail('chicken_feed') > 4) act('nurse', { id: young }, `a care card for a young ${objs[young].def}`, 'nursery');
    else diag.nursery = young || due ? 'no bottle to spare' : 'no baby on the farm';
    if (!diag.nursery) diag.nursery = null;
  }
  // the Breeding Barn: bring a ready baby home (named); else pair two adults of a species with room
  if (typeof BREED.breedingOpen === 'function' && BREED.breedingOpen(S())) {
    live.breeding = true;
    if (Object.values(S().farm.breed?.n ?? {}).some((n) => n > 0) || BREED.breedingOf(S())) used.breeding = true;
    const cur = BREED.breedingOf(S());
    if (cur) {
      if (check('breedCollect', { name: 'Pip' }) === null) act('breedCollect', { name: pid === 'p1' ? 'Pip' : 'Clover' }, `bring the baby ${cur.sp} home`, 'breeding');
      diag.breeding = null;
    } else {
      const objs = S().farm.objects;
      const bySp = {};
      for (const k of Object.keys(objs).sort()) {
        const o = objs[k];
        if (typeof o.home === 'string' && !(o.adultAt > now()) && (C.BREEDING?.species ?? []).includes(o.def)) (bySp[o.def] ??= []).push(k);
      }
      const pair = Object.values(bySp).find((l) => l.length >= 2 && check('breed', { a: l[0], b: l[1] }) === null);
      // a full home: make room the way the Goal Tracker's card says (one home upgrade), then pair on the next minute
      const full = pair ? null : Object.values(bySp).find((l) => l.length >= 2 && check('breed', { a: l[0], b: l[1] }) === 'CAP');
      const home = full ? objs[full[0]].home : null;
      if (pair) act('breed', { a: pair[0], b: pair[1] }, `pair two ${S().farm.objects[pair[0]].def}s`, 'breeding');
      else if (home && check('upgradeHome', { id: home }) === null) act('upgradeHome', { id: home }, `make room for a baby ${objs[full[0]].def}`, 'breeding');
      else diag.breeding = Object.keys(bySp).length ? `no pair fits: ${Object.entries(bySp).map(([sp, l]) => `${sp} ${l.length >= 2 ? check('breed', { a: l[0], b: l[1] }) : 'one adult'}`).join(', ')}` : 'no adults';
    }
  }
  // Friendly Duel: p1 invites when none runs; p2 accepts
  if (typeof DUELR.duelUnlocked === 'function' && DUELR.duelUnlocked(S())) {
    live.duel = true;
    const d = DUELR.duelOf(S(), pid, now());
    if ((S().farm.duel?.n ?? 0) > 0 || d?.phase === 'live') used.duel = true;
    if (d?.phase === 'invited' && check('duelAccept', {}) === null) act('duelAccept', {}, 'accept the duel', 'duel');
    else if (d?.phase === 'none' && pid === 'p1' && check('duelInvite', { kind: 'orders' }) === null) act('duelInvite', { kind: 'orders' }, 'invite to an Order Rush', 'duel');
    diag.duel = d?.phase === 'none' ? `no duel (${check('duelInvite', { kind: 'orders' })})` : null;
  }
  // the farmhouse room: one piece now and then (the cheapest the farm does not own, on the first free cell)
  if (typeof INT.interiorOpen === 'function' && INT.interiorOpen(S())) {
    live.interior = true;
    const items = Object.values(S().farm.interior?.items ?? {}).filter((it) => it.by !== 'sys');
    if (items.length) used.interior = true;
    if (items.length < 8 && S().farm.wallet.coins > 400_000 && Math.random() < 0.25) {
      const cat = (INT.furnitureCatalog?.(S()) ?? []).filter((c) => c.shop && c.layer !== 'wall' && c.owned === 0).sort((a, b) => a.cost - b.cost);
      const piece = cat[0];
      if (piece) {
        let done = false;
        for (let z = 0; z < 8 && !done; z++) for (let x = 0; x < 12 && !done; x++) {
          const a = { def: piece.id, x, z, rot: 0, confirm: ['BIG_SPEND'] };
          if (check('furnish', a) === null) { done = act('furnish', a, `furnish: ${piece.name}`, 'interior'); }
        }
        if (!done) diag.interior = `no free cell for ${piece.name}`;
      }
    }
  }
  // the NPC league (read off the ceremonies) and the Seasonal Ribbon Track (tiers claimed)
  const lg = C.CONTENT?.features?.get?.('fair_league');
  if (lg && C.isLive(lg) && C.levelFromXp(S().farm.xp) >= lg.unlock) {
    live.league = true;
    if (S().farm.fair?.last?.lg || S().farm.fair?.league) used.league = true;
    diag.league = used.league ? null : 'no league week closed yet';
  }
  if (typeof TRACK.trackClaim === 'object' || IDX.ACTIONS?.trackClaim) {
    const tr = S().farm.track;
    // the track exists on every farm (createFarm) but plays only from its level (L24): never "unused" before that
    if (tr && levelFromXp(S().farm.xp) >= (SEASONAL_TRACK?.unlock ?? 24)) {
      live.track = true;
      for (let t = 1; t <= 30 && left > 0; t++) if (check('trackClaim', { tier: t }) === null) { act('trackClaim', { tier: t }, `claim track tier ${t}`, 'track'); break; }
      if (Object.keys(tr.got ?? {}).length) used.track = true;
    }
  }
  return { ops, diag, live, used };
}

/** The M2 layer for every live player this minute (late-game mode), into the same bookkeeping as the M1b layer. */
async function m2Minute(live, rec) {
  for (const p of live) {
    await inSync();
    let r;
    try {
      r = await pages[p].evaluate(m2TurnInPage, { pid: p, budget: 3 });
    } catch (e) {
      R.errors.push({ at: where(), pid: p, kind: 'm2-exception', text: String(e && e.message || e).slice(0, 300) });
      continue;
    }
    if (r.ops.length) { rec.m2 = rec.m2 ?? {}; rec.m2[p] = r.ops.map((o) => `${o.ok ? '' : `!${o.code} `}${o.type}: ${o.why}`); }
    for (const o of r.ops) {
      const sys = o.sys ?? o.type;
      (R.m1b.ops[sys] ??= { ok: 0, refused: 0 })[o.ok ? 'ok' : 'refused']++;
      if (o.ok && R.m1b.first[sys] === undefined) { R.m1b.first[sys] = state.pm; say(`M2: first ${sys} at play minute ${state.pm}: ${o.why}`); }
    }
    for (const sys of Object.keys(r.live)) if (r.live[sys] && R.m1b.live[sys] === undefined) R.m1b.live[sys] = state.pm;
    for (const sys of Object.keys(r.used ?? {})) if (r.used[sys] && R.m1b.first[sys] === undefined) R.m1b.first[sys] = state.pm;
    for (const [sys, why] of Object.entries(r.diag)) if (why) R.m1b.diag[sys] = { why, at: where(), pm: state.pm };
  }
}

/**
 * A late-game fixture from a saved farm (`--fixture <dir | farm.json>`): both farmers get fresh tokens (a player the
 * save lacks is joined first), the browser evening starts at the next schedule evening after the save.
 */
async function loadFixture(file) {
  const crypto = await import('node:crypto');
  const { runAction, makeCtx } = await import('../shared/rules/index.js');
  const f = fs.statSync(file).isDirectory() ? path.join(file, 'farm.json') : file;
  const save = JSON.parse(fs.readFileSync(f, 'utf8'));
  const st = save.state;
  if (FIXTURE_LEVEL > levelFromXp(st.farm.xp)) st.farm.xp = xpForLevel(FIXTURE_LEVEL);
  let t = Math.max(save.savedAt ?? 0, st.meta.createdAt ?? 0, Date.now() - 1000);
  for (const [pid, name] of players) {
    if (st.players[pid]) continue;
    const r = runAction(st, { type: '_join', args: { pid, name } }, makeCtx(st, { now: t, pid: 'sys', cid: 'sys', seq: st.meta.version + 1 }));
    if (r.ok) st.meta.version += 1;
  }
  const at = t + untilLocal(t + HOUR, 1, 19) + HOUR;
  const auth = {};
  for (const [pid] of players) {
    TOKENS[pid] = crypto.randomBytes(32).toString('hex');
    auth[pid] = { tokenHash: crypto.createHash('sha256').update(TOKENS[pid]).digest('hex') };
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-qa-fix-'));
  fs.writeFileSync(path.join(dataDir, 'farm.json'), JSON.stringify({ ...save, savedAt: at, version: st.meta.version, state: st,
    server: { ...(save.server ?? {}), auth, clients: {}, clock: { lastNow: at } } }));
  R.fixture = { level: levelFromXp(st.farm.xp), evenings: 0, minutes: 0, at: localStr(at), coins: st.farm.wallet.coins,
    objects: Object.keys(st.farm.objects).length, from: path.relative(ROOT, f) };
  say(`fixture ${R.fixture.from}: level ${R.fixture.level}, ${R.fixture.coins} coins; the browser evening starts ${R.fixture.at}`);
  return { dataDir, at, evenings: 0 };
}

/** At a level-up (mid-game mode): what the level opened and whether the rules let the farm reach it. */
async function reachAudit(level) {
  const page = pages.p1 && !pages.p1.isClosed() ? pages.p1 : pages.p2;
  if (!page) return;
  try {
    const r = await page.evaluate(reachInPage, { level, pid: page.pid });
    R.unlocks[level] = r.unlocks;
    for (const x of r.refused) R.reach.push({ level, ...x });
    if (r.refused.length) say(`level ${level}: unlocked but refused by the rules: ${r.refused.map((x) => `${x.fam}/${x.id} ${x.code}`).join(', ')}`);
  } catch (e) {
    R.errors.push({ at: where(), pid: 'harness', kind: 'reach-exception', text: String(e && e.message || e).slice(0, 300) });
  }
}

/** The dead ends of the run (mid-game mode), from everything recorded. */
function deadEnds() {
  const out = [];
  for (const x of R.reach) out.push({ kind: 'unreachable', level: x.level, what: `${x.fam}/${x.id}`, why: `the level opens it, the rules answer ${x.code}` });
  for (const [sys, since] of Object.entries(R.m1b.live)) {
    const first = R.m1b.first[sys];
    if (first !== undefined || state.pm - since < 45) continue;
    out.push({ kind: 'never used', what: sys, why: R.m1b.diag[sys]?.why ?? 'no reason recorded', liveFor: state.pm - since });
  }
  const lv = Object.entries(R.levels).map(([l, r]) => [Number(l), r.playMinute]).sort((a, b) => a[0] - b[0]);
  // the level budget: two evenings up to L25; the M2 levels are designed slower (econ-sim's casual couple: L30 at 53.8 h,
  // L40 at 135.6 h of play, about 4-8 evenings a level), so from L25 a level may take six evenings before it counts
  const allow = (L) => (L >= 25 ? 6 : 2) * MINUTES;
  for (let i = 1; i < lv.length; i++) {
    const mins = lv[i][1] - lv[i - 1][1];
    if (mins > allow(lv[i - 1][0])) out.push({ kind: 'slow level', what: `L${lv[i - 1][0]} -> L${lv[i][0]}`, why: `${mins} play minutes (more than ${allow(lv[i - 1][0]) / MINUTES} evenings)` });
  }
  const last = lv.at(-1);
  if (last && state.pm - last[1] > allow(last[0])) out.push({ kind: 'stalled', what: `L${last[0]}`, why: `no level-up in the last ${state.pm - last[1]} play minutes` });
  for (const e of R.evenings) if (e.idleBoth > 25) out.push({ kind: 'idle evening', what: e.label, why: `${e.idleBoth} of ${MINUTES} minutes with nothing to do for either player` });
  // the co-op loop: Golden Hour on the bench (and the duet) must work at every stage of the game
  for (const c of R.coop) if (c.ok === false) out.push({ kind: 'co-op', what: `Golden Hour (${c.label}, L${c.level})`, why: JSON.stringify({ sit: c.sit, golden: c.golden }).slice(0, 200) });
  const tp = new Map();
  for (const t of R.trackerProblems) tp.set(t.text, (tp.get(t.text) ?? 0) + 1);
  for (const [text, n] of tp) if (n >= 10) out.push({ kind: 'tracker', what: text.slice(0, 120), why: `seen in ${n} minutes` });
  return out;
}

/** The level-N farm, played to it against the rules alone (in-process Engine, fake clock, the reference schedule). */
async function buildMidgameFixture(from) {
  const crypto = await import('node:crypto');
  const { createFarm } = await import('../shared/rules/state.js');
  const { Engine } = await import('../server/engine.js');
  const T0 = Date.now() + untilLocal(Date.now(), 1, 19);
  const clock = { t: T0, now() { return this.t; }, advance(ms) { this.t += ms; }, observe() {} };
  const st = createFarm(SEED, T0, TZ);
  const server = { clock: { lastNow: 0 }, clients: {}, auth: {} };
  const engine = new Engine({ state: st, server, clock, log: { error: (...a) => say('fixture engine', ...a), warn() {}, info() {}, log() {} } });
  for (const [pid, name] of players) engine.system('_join', { pid, name });
  const mk = (pid) => {
    const cid = `${pid}fix000`;
    engine.client(cid, pid, clock.now());
    let seq = 0;
    return { pid, async snap() { return { s: engine.state, now: clock.now() }; },
      async act(type, a) { const r = engine.act({ pid, cid }, { seq: ++seq, type, args: a }); return r && r.t === 'rej' ? { ok: false, code: r.code } : { ok: true }; } };
  };
  const ps = [mk('p1'), mk('p2')];
  const seen = { p1: new Set(), p2: new Set() };
  let ev = 0;
  let minutes = 0;
  const days = [3, 5, 1];                                  // Mon -> Wed -> Fri -> Mon ...
  while (levelFromXp(st.farm.xp) < from && ev < FIXTURE_EVENINGS) {
    for (let m = 0; m < MINUTES; m++) {
      for (const p of ps) {
        const saw = new Set();
        await turn(p, { minsLeft: MINUTES - m, wrap: MINUTES - m <= 5, dom: DOM[p.pid], solo: false, waited: (k) => seen[p.pid].has(k), sawKeys: saw });
        seen[p.pid] = saw;
      }
      clock.advance(MIN);
      engine.runDue();
      minutes++;
    }
    ev++;
    clock.advance(untilLocal(clock.t + 4 * HOUR, days[(ev - 1) % 3], 19) + 4 * HOUR);
    engine.runDue();
  }
  // the next evening starts where the fixture ends: the server clock is shifted to it (tools/qa-clock-preload.cjs)
  for (const [pid] of players) {
    TOKENS[pid] = crypto.randomBytes(32).toString('hex');
    server.auth[pid] = { tokenHash: crypto.createHash('sha256').update(TOKENS[pid]).digest('hex') };
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-qa-mid-'));
  st.meta.version = engine.v ?? st.meta.version;
  fs.writeFileSync(path.join(dataDir, 'farm.json'), JSON.stringify({ schema: st.schema, savedAt: clock.t, version: st.meta.version, state: st,
    server: { auth: server.auth, clients: {}, clock: { lastNow: clock.t } } }));
  R.fixture = { level: levelFromXp(st.farm.xp), evenings: ev, minutes, at: localStr(clock.t), coins: st.farm.wallet.coins, objects: Object.keys(st.farm.objects).length };
  say(`fixture: level ${R.fixture.level} after ${ev} evenings (${minutes} play minutes), ${R.fixture.coins} coins, ${R.fixture.objects} objects; the browser evening starts ${R.fixture.at}`);
  if (levelFromXp(st.farm.xp) < from) say(`fixture: stopped at level ${levelFromXp(st.farm.xp)} after ${ev} evenings (--fixture-evenings ${FIXTURE_EVENINGS})`);
  // keep it for the next run (`--fixture <dir>` starts there at once)
  if (SAVE_FIXTURE) {
    fs.mkdirSync(SAVE_FIXTURE, { recursive: true });
    fs.copyFileSync(path.join(dataDir, 'farm.json'), path.join(SAVE_FIXTURE, 'farm.json'));
    say(`fixture saved to ${path.relative(ROOT, SAVE_FIXTURE)}`);
  }
  return { dataDir, at: clock.t, evenings: ev };
}

async function midgameMain() {
  const fx = FIXTURE ? await loadFixture(FIXTURE) : await buildMidgameFixture(FROM);
  if (FIXTURE_ONLY) {
    console.log(JSON.stringify({ ok: true, fixture: R.fixture, saved: SAVE_FIXTURE ? path.relative(ROOT, SAVE_FIXTURE) : null }));
    return;
  }
  await startServer({ dataDir: fx.dataDir, offset: fx.at - Date.now() });
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new', handleSIGTERM: false, handleSIGINT: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', `--window-size=${VW},${VH}`, '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  try {
    for (const [pid, name, tag] of players) await openPage(pid, name, tag);
    await sleep(2500);
    for (const p of ['p1', 'p2']) await dismissOverlays(pages[p]);
    lastLevel = (await pages.p1.evaluate(() => window.__qaPre().level));
    R.levels[lastLevel] = { playMinute: 0, evening: fx.evenings + 1, minute: 0, clock: localStr(await serverNowOf()), fixture: true };
    await reachAudit(lastLevel);
    const days = [3, 5, 1];
    for (let k = 0; k < MAX_EVENINGS && !stopping; k++) {
      const n = fx.evenings + 1 + k;
      await evening(n, { label: `evening ${n} (mid-game)` });
      // the summary after every evening: a run cut short still leaves its findings
      R.deadEnds = deadEnds();
      fs.writeFileSync(path.join(OUT, 'midgame-summary.json'), JSON.stringify(R, null, 2));
      const lv = await pages.p1.evaluate(() => window.__qaPre().level);
      if (lv >= TO || stopping) break;
      const nowE = await serverNowOf();
      await warp(untilLocal(nowE + 4 * HOUR, days[(n - 1) % 3], 19) + 4 * HOUR);
      await sleep(1500);
    }
    R.status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json().catch(() => ({}));
  } finally {
    R.deadEnds = deadEnds();
    R.finishedAt = new Date().toISOString();
    R.shotCount = shotCount;
    fs.writeFileSync(path.join(OUT, 'midgame-summary.json'), JSON.stringify(R, null, 2));
    if (browser) await browser.close().catch(() => {});
    if (server) {
      server.kill('SIGTERM');
      await new Promise((r) => server.once('exit', r));
      if (!args.keep) fs.rmSync(server.dataDir, { recursive: true, force: true });
    }
  }
  // the digest
  const lv = Object.entries(R.levels).map(([l, r]) => `L${l}@${r.playMinute}`).join(' ');
  console.log(`levels (play minute): ${lv}`);
  console.log(`mid-game systems (M1b + M2) first use (play minute): ${JSON.stringify(R.m1b.first)}`);
  console.log(`mid-game systems live since: ${JSON.stringify(R.m1b.live)}`);
  console.log(`dead ends (${R.deadEnds.length}):`);
  for (const d of R.deadEnds) console.log(`  - [${d.kind}] ${d.what}: ${d.why}`);
  console.log(`errors: ${R.errors.length}; server rejects: ${R.rejects.filter((x) => !x.local).length}; summary: ${path.relative(ROOT, path.join(OUT, 'midgame-summary.json'))}`);
}

// ---- the schedule ---------------------------------------------------------------------------------------------------------------------
async function evening(n, { who = ['p1', 'p2'], solo = false, minutes = MINUTES, label = `evening ${n}` } = {}) {
  state.evening = n;
  const startNow = await serverNowOf();
  const startSnap = await clientOf(who[0]).snap();
  const rec = { n, label, solo, start: localStr(startNow), levelStart: levelFromXp(startSnap.s.farm.xp), coinsStart: startSnap.s.farm.wallet.coins };
  say(`=== ${label}: ${rec.start}, level ${rec.levelStart}, ${rec.coinsStart} coins`);
  R.systems[`E${n}-start`] = await pages[who[0]].evaluate(() => window.__qaSystems());
  // the "While you were away" card, the daily gift and what the farm looks like when the couple sits down
  for (const p of who) { await closePanels(pages[p]); await dismissOverlays(pages[p]); }
  await shot(`E${n}-start-A`, who[0], 'the farm when the evening starts');
  await uiScan(pages[who[0]], 'HUD at the start of the evening');
  if (who[1]) await shot(`E${n}-start-B`, who[1], 'the farm when the evening starts, partner');
  for (let m = 0; m < minutes && !stopping; m++) {
    const race = n >= 2 && !solo && [8, 21, 34].includes(m);
    try {
      await onePlayMinute({ evening: n, minute: m, minutes, who, solo, race, label });
    } catch (e) {
      R.errors.push({ at: where(), pid: 'harness', kind: 'minute-exception', text: String(e && e.stack || e).slice(0, 500) });
      say('minute exception', e.message);
      await sleep(500);
      await warp(MIN).catch(() => {});
    }
    // together time: Golden Hour near the end of an evening (GDD §1.5 minute 45-55), both players
    if (!solo && m === (PM.coop > 0 ? PM.coop : minutes + PM.coop)) { try { await coopSession(`evening ${n}`); } catch (e) { R.errors.push({ at: where(), pid: 'harness', kind: 'coop-exception', text: String(e.stack || e).slice(0, 400) }); } }
  }
  const end = await clientOf(who[0]).snap();
  rec.levelEnd = levelFromXp(end.s.farm.xp);
  rec.coinsEnd = end.s.farm.wallet.coins;
  rec.xpEnd = end.s.farm.xp;
  rec.questsDone = Object.keys(end.s.farm.quests.done);
  rec.idleBoth = R.idleBoth.filter((x) => x.evening === n).length;
  rec.rejects = R.rejects.filter((x) => x.evening === n).length;
  rec.serverRejects = R.rejects.filter((x) => x.evening === n && !x.local).length;
  R.systems[`E${n}-end`] = await pages[who[0]].evaluate(() => window.__qaSystems());
  R.evenings.push(rec);
  await shot(`E${n}-end-A`, who[0], 'the farm at the end of the evening');
  if (who[1]) await shot(`E${n}-end-B`, who[1], 'the farm at the end of the evening, partner');
  say(`=== end of ${label}: level ${rec.levelEnd}, ${rec.coinsEnd} coins, ${rec.idleBoth} idle minutes, ${rec.rejects} rejects`);
}

async function absenceAndReturn(hours, label) {
  say(`=== ${label}: both pages closed, ${hours} h pass`);
  const before = (await clientOf('p1').snap()).s;
  for (const p of ['p1', 'p2']) { await pages[p].close().catch(() => {}); }
  await sleep(800);
  // the farm keeps growing while nobody is there (the server stays up; GDD §9 #30 covers a server that is off too)
  const r = await fetch(`http://127.0.0.1:${port}/api/dev/warp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms: hours * HOUR }) });
  const { serverNow } = await r.json();
  await sleep(1500);
  const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
  R.notes.push({ at: label, status: { v: status.v, degraded: status.degraded, journaled: status.journaled } });
  // the return
  state.evening = 6;
  state.minute = 0;
  await openPage('p1', 'Rowan', 'A');
  await sleep(1500);
  const recapOpen = await panelOpen(pages.p1, 'recap');
  const recapText = await pages.p1.evaluate(() => document.getElementById('panel-recap')?.innerText ?? '').catch(() => '');
  await shot('E6-return-A-first-frame', 'p1', 'Rowan returns after the absence: the first frame');
  probe('a returning player gets the "While you were away" card', recapOpen, recapText.replace(/\s+/g, ' ').slice(0, 300));
  await openPage('p2', 'Mia', 'B');
  await sleep(1200);
  const recapB = await panelOpen(pages.p2, 'recap');
  await shot('E6-return-B-first-frame', 'p2', 'Mia returns after the absence: the first frame');
  probe('the partner also gets the recap card', recapB);
  R.notes.push({ at: label, recapA: recapText.replace(/\s+/g, ' ').slice(0, 600) });
  const after = (await clientOf('p1').snap()).s;
  const ripe = Object.values(after.farm.objects).filter((o) => o.def === 'plot' && o.crop && o.crop.readyAt <= serverNow).length;
  R.notes.push({ at: label, whenBack: { level: levelFromXp(after.farm.xp), ripePlots: ripe, coins: after.farm.wallet.coins, orders: Object.values(after.farm.orders.slots).filter((s) => s.order).length, debris: Object.values(after.farm.objects).filter((o) => CONTENT.debris.has(o.def)).length, before: { coins: before.farm.wallet.coins } } });
  lastLevel = levelFromXp(after.farm.xp);
}

async function main() {
  await startServer();
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', `--window-size=${VW},${VH}`, '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  try {
    for (const [pid, name, tag] of players) await openPage(pid, name, tag);
    await sleep(2500);
    // the server's clock was started on a Monday at 19:00 in the farm's zone (QA_CLOCK_OFFSET_MS)
    for (const p of ['p1', 'p2']) await dismissOverlays(pages[p]);
    let n = 0;
    const gaps = [];
    for (let e = 1; e <= EVENINGS; e++) {
      n = e;
      await evening(e);
      const nowE = await serverNowOf();
      // Mon 19:00 -> Wed 19:00 -> Fri 19:00 -> (solo) Sun 19:00
      const nextWeekday = [3, 5, 0][e - 1] ?? 3;
      gaps.push(untilLocal(nowE + 4 * HOUR, nextWeekday, 19) + 4 * HOUR);
      if (e < EVENINGS || !args['no-solo']) {
        say(`--- ${Math.round(gaps.at(-1) / HOUR)} h until the next evening`);
        await warp(gaps.at(-1));
        await sleep(1500);
        // a page left open overnight gets the system actions' deltas (orders refilled, rollover): checked by the next minute's snapshot
      }
    }
    if (!args['no-solo']) {
      // the SOLO evening: Mia is away, Rowan plays alone for an hour
      await pages.p2.close().catch(() => {});
      await sleep(500);
      await evening(EVENINGS + 1, { who: ['p1'], solo: true, label: 'solo evening' });
      // the 3-day absence and the return
      const nowS = await serverNowOf();
      const toWed = untilLocal(nowS + 3 * 24 * HOUR - 2 * HOUR, 3, 19) + 3 * 24 * HOUR - 2 * HOUR;
      await absenceAndReturn(Math.round(toWed / HOUR), '3-day absence');
      await evening(EVENINGS + 2, { who: ['p1', 'p2'], minutes: Math.min(30, MINUTES), label: 'return evening' });
      // the ladder asks for L12: keep playing evenings (two days apart) until the farm gets there, at most three more
      for (let extra = 1; extra <= 3 && !args['no-extend']; extra++) {
        const lv = await pages.p1.evaluate(() => window.__qaPre().level);
        if (lv >= 12) break;
        const nowX = await serverNowOf();
        const gap = untilLocal(nowX + 40 * HOUR, [5, 1, 3][extra - 1], 19) + 40 * HOUR;
        say(`--- level ${lv} < 12: another evening after ${Math.round(gap / HOUR)} h`);
        await warp(gap);
        await sleep(1200);
        await evening(EVENINGS + 2 + extra, { who: ['p1', 'p2'], minutes: MINUTES, label: `extra evening ${extra}` });
      }
    }
    const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json().catch(() => ({}));
    R.status = status;
  } finally {
    R.finishedAt = new Date().toISOString();
    R.shotCount = shotCount;
    fs.writeFileSync(path.join(OUT, 'playtest-summary.json'), JSON.stringify(R, null, 2));
    if (browser) await browser.close().catch(() => {});
    if (server) {
      server.kill('SIGTERM');
      await new Promise((r) => server.once('exit', r));
      if (!args.keep) fs.rmSync(server.dataDir, { recursive: true, force: true });
      else say('kept the data dir:', server.dataDir);
    }
  }
  say('done; level ladder', JSON.stringify(R.levels));
}

(MID ? midgameMain() : main()).catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
void trackerOf; void available; void currentFarmStep; void currentStep;
