// E2E of the in-game helper (Harness Hollow, ui lane; docs/agent-notes/harness-contract.md "Gates"). Starts its own
// HH_DEV server on --port with a temp data dir, opens ONE headless Chrome (closed at the end), and drives the helper's
// screens the way a player does: the helper button, sign-in, the consent question, a request, the working pill while
// the farmer keeps planting, the changes-ready pop-up, Ask for changes, a stale farm, Apply (the partner hears it),
// history and undo, a failed request, Settings › Helper. Every state is screenshotted and audited: no horizontal scroll,
// nothing of the helper outside the screen, no helper text under 13 px, no console or page errors. Before every press
// of Harvey's button the run proves it is what a finger at its centre touches (document.elementFromPoint), on phones
// with the farm's land card up: a banner or a toast lying over it fails the run instead of a click from code hiding it.
//
//   node tools/e2e-harness.mjs --port 4330 --fake [--shots .scratch/hh-ui/shots] [--only desktop|phone|small] [--lang en|bg]
//        --fake   the helper's REST answers and `hx` pushes come from a scripted backend in this tool (request
//                 interception + ui.harness.receive): every screen in every state, on desktop, iPhone 13 and 360 x 640
//   node tools/e2e-harness.mjs --port 4330 [--multi] [--shots docs/qa/harness/e2e]
//        the real server with the mock provider (HH_HARNESS_MOCK=1), two farmers: Rowan on a desktop in English, Mia on
//        an iPhone 13 in Bulgarian. The 🎙 where the browser can listen, sign-in, the consent question (Rowan shares,
//        Mia does not), the working pill while Rowan plants and harvests, the progress steps, Mia told politely that
//        one change runs at a time (409 BUSY), the ready pop-up with the change list and the test results, Apply (both
//        screens, no reload), both buy and plant the new crop, Rowan harvests it, History, Undo (retired: not for sale,
//        planting again LOCKED, the barn keeps it), Mia's broken request reported plainly, the shared events (Rowan's
//        only, no key or name); --multi: a second farm (Ana) never sees any of it
//   node tools/e2e-harness.mjs --port 4330 --signin
//        the real sign-in flows against stand-ins: a fake Claude Code binary (its own login relayed: URL out, a wrong
//        code refused, the right one in; a request runs on it) and a fake OpenAI (PKCE authorize, the final address
//        pasted back on a phone, an expired token refreshed once, the usage limit told plainly); then no token in any
//        answer, file or log but the farmer's own 0600 sign-in file
// Prints one JSON line { ok, mode, steps, failed, shots, errors, files, dir } and exits non-zero on any failure.
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
const port = Number(args.port || 4330);
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
const FAKE = Boolean(args.fake);
const MULTI = Boolean(args.multi);
const SIGNIN = Boolean(args.signin);
const SHOTS = path.resolve(args.shots || path.join(ROOT, '.scratch', 'hh-ui', 'shots'));
const ONLY = args.only ? String(args.only) : null;
const LANGS = args.lang ? [String(args.lang)] : ['en', 'bg'];
const SLOW = Math.max(1, Number(args.slow || 1));
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const steps = [];
const livePages = [];
let stage = '';
const errors = [];
const files = [];
let server = null;
let serverLog = '';
const notes = [];
let shotFailed = false;
/** What each open page showed when the run stopped (once). */
async function failShots() {
  if (shotFailed) return;
  shotFailed = true;
  for (const p of livePages) {
    if (p.isClosed()) continue;
    const f = path.join(SHOTS, `FAILED-${p.tag}.png`);
    await p.screenshot({ path: f }).then(() => files.push(f), () => {});
  }
}
let browser = null;
let dataDir = null;

function check(name, cond, detail = '') {
  steps.push({ name, ok: Boolean(cond), ...(detail ? { detail } : {}) });
  if (!cond) throw new Error(`step failed: ${name}${detail ? ` (${detail})` : ''}`);
}
// the last thing waited for or pressed: a failure names where it stopped
const waitFor = (page, fn, arg, timeout = 10_000) => {
  stage = `${page.tag ?? ''} wait ${String(fn).replace(/\s+/g, ' ').slice(0, 80)}`;
  return page.waitForFunction(fn, { timeout: timeout * SLOW, polling: 50 }, arg);
};

async function startServer(extraEnv = {}) {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-e2e-harness-'));
  serverLog = '';
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), HH_DATA_DIR: dataDir, HH_DEV: '1', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  // a server that stops by itself mid-run is told with its last words (the run's own stop is not)
  const me = server;
  me.once('exit', (code, signal) => { if (server === me) notes.push(`server exited by itself (code ${code}, signal ${signal}): ${serverLog.slice(-1500)}`); });
  for (let i = 0; i < 100 && !serverLog.includes('running at') && server.exitCode === null; i++) await sleep(100);
  if (!serverLog.includes('running at')) throw new Error(`server did not start: ${serverLog.slice(-1200)}`);
}
async function stopServer() {
  const s = server;
  server = null;
  if (s && s.exitCode === null) {
    s.kill('SIGTERM');
    await new Promise((r) => s.once('exit', r));
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
}

// ---- pages -------------------------------------------------------------------------------------------------------
const PHONE_UA = KnownDevices['iPhone 13'].userAgent;
const DEVICES = {
  desktop: { viewport: { width: 1366, height: 768 } },
  phone: KnownDevices['iPhone 13'],
  small: { userAgent: PHONE_UA, viewport: { width: 360, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: false } },
};

async function openPage(tag, { slot, name, device, lang, path: at = '/', hash = '', setup = null }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const dev = DEVICES[device];
  if (dev.userAgent) await page.emulate(dev); else await page.setViewport(dev.viewport);
  await page.evaluateOnNewDocument((l) => { try { localStorage.setItem('hh.lang', l); } catch { /* blocked */ } }, lang);
  // ui-shell's S2-13 patch (QA r2): on a hosted farm the "Keep your farm safe" card (multi mode, after the first guide
  // step) once took the screen from Harvey's side panel while a wish was typed, a timing-dependent red in `--multi`. This
  // run is about Harvey, not the key card: the device has saved its key, as the other tools seed it (never overwritten)
  await page.evaluateOnNewDocument(() => {
    try {
      const m = /^\/f\/([a-z2-7]{12})(?:\/|$)/.exec(location.pathname);
      const k = m ? `hh.f.${m[1]}.keySave` : null;
      if (k && localStorage.getItem(k) === null) localStorage.setItem(k, JSON.stringify({ saved: true }));
    } catch { /* blocked */ }
  });
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  // a page that reloads by itself (the content gate, a lost WebGL context) is told, with what the socket said last:
  // the wire's welcomes, denials and closes are kept in sessionStorage, which outlives the reload
  await page.evaluateOnNewDocument(() => {
    const keep = (x) => { try { const a = JSON.parse(sessionStorage.getItem('e2e.wire') || '[]'); a.push(`${new Date().toISOString().slice(11, 23)} ${x}`); sessionStorage.setItem('e2e.wire', JSON.stringify(a.slice(-16))); } catch { /* storage blocked */ } };
    const WS = window.WebSocket;
    window.WebSocket = class extends WS {
      constructor(...a) {
        super(...a);
        this.addEventListener('message', (e) => {
          const d = typeof e.data === 'string' ? e.data : '';
          const m = /^\{"t":"(welcome|deny|slots)"/.exec(d);
          if (m) keep(`in ${m[1]} ${(d.match(/"(contentHash|buildHash|code)":"?[^",]*/g) || []).join(' ')}`);
        });
        this.addEventListener('close', (e) => keep(`close ${e.code} ${e.reason || ''}`));
      }
    };
    addEventListener('pagehide', () => keep('pagehide'));
  });
  let loads = 0;
  page.on('load', async () => {
    if (++loads < 2) return;
    const wire = await page.evaluate(() => sessionStorage.getItem('e2e.wire')).catch(() => null);
    notes.push(`${tag} loaded again by itself (${stage}); the wire before: ${wire ?? '?'}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'warn' && /reloading|\breload\b|context/i.test(m.text())) notes.push(`${tag} warn: ${m.text()}`);
    if (m.type() !== 'error') return;
    // a refusal the run asks for on purpose (409 BUSY / STALE, 428 SIGN_IN) is logged by Chrome as a failed load: only
    // those two codes pass, and each is named in the notes (QA r1 H-17: the verifier sees them; any other 4xx fails)
    if (/status of (409|428)\b/.test(m.text()) && /\/harness\//.test(m.location()?.url ?? '')) {
      notes.push(`${tag} expected refusal: ${m.text().slice(0, 80)} ${String(m.location()?.url ?? '').replace(/^https?:\/\/[^/]+/, '')}`);
      return;
    }
    errors.push(`${tag} console: ${m.text()}`);
  });
  page.tag = tag;
  livePages.push(page);
  page.pid = slot;
  page.device = device;
  page.lang = lang;
  if (setup) await setup(page);
  const sep = at.includes('?') ? '&' : '?';
  await page.goto(`http://localhost:${port}${at}${sep}slot=${slot}&name=${name}&quality=low${hash}`, { waitUntil: 'domcontentloaded' });
  // a multi-mode farm asks on its farmer picker (the creator's seat, an invited friend's free seat)
  await waitFor(page, () => (window.__hh && window.__hh.pid && window.__hh.state) || document.querySelector('#slot-picker:not([hidden]) .slot input.field'), null, 60_000);
  if (await page.evaluate(() => !window.__hh?.pid && Boolean(document.querySelector('#slot-picker:not([hidden]) .slot input.field')))) {
    await page.type('#slot-picker .slot input.field', name);
    await page.click('#slot-picker .slot .btn');
  }
  await waitFor(page, () => window.__hh && window.__hh.pid && window.__hh.state && window.__hh.controller && window.__hh.ui?.panels, null, 60_000);
  // the guide's cards are not what this run is about
  await page.evaluate(() => { window.__hh.act('tutSkip', { all: 'yes' }); window.__hh.ui.panels.closeAll(); });
  await sleep(600);
  await page.evaluate(() => window.__hh.ui.panels.closeAll());
  return page;
}

/** The helper's layout on this screen: page scroll, its parts off screen, its text under 13 px. A panel's tab strip
 *  scrolls sideways on a phone by design (ui/index.js renderTabs): its tabs may sit past the edge. */
async function audit(page) {
  return page.evaluate(() => {
    const vw = innerWidth;
    const out = { hscroll: document.scrollingElement.scrollWidth > vw + 1, off: [], small: [], wide: [] };
    const roots = [...document.querySelectorAll('#hx-dock, #panel-helper, #panel-helper-ready, #panel-helper-letter, #panel-settings')].filter((r) => r.getClientRects().length);
    for (const root of roots) {
      const sc = root.querySelector('.hh-panel-scroll');
      if (sc && sc.scrollWidth > sc.clientWidth + 1) out.wide.push(`${root.id} scrolls sideways (${sc.scrollWidth} > ${sc.clientWidth})`);
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (!el.getClientRects().length || el.closest('[hidden]')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > vw + 1 || r.left < -1) && !el.closest('.sr-only') && !el.closest('.hh-panel-scroll') && !el.closest('.hh-tabs')) {
          out.off.push(`${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).split(' ')[0]} ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`);
        }
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
        if (hasText && !el.closest('.sr-only')) {
          const fs = parseFloat(cs.fontSize);
          if (fs < 12.9) out.small.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${fs}px "${el.textContent.trim().slice(0, 30)}"`);
        }
      }
    }
    out.off = [...new Set(out.off)].slice(0, 8);
    out.small = [...new Set(out.small)].slice(0, 8);
    return out;
  });
}

const shots = [];
async function shot(page, name, { scrollPanel = null } = {}) {
  await sleep(350);
  if (scrollPanel) await page.evaluate((n) => { const s = document.querySelector(`#panel-${n} .hh-panel-scroll`); if (s) s.scrollTop = s.scrollHeight; }, scrollPanel);
  const f = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: f });
  files.push(f);
  const a = await audit(page);
  const bad = a.hscroll || a.off.length || a.small.length || a.wide.length;
  shots.push({ name, ...(bad ? { audit: a } : {}) });
  check(`${name}: no sideways scroll, nothing off screen, no text under 13 px`, !bad, bad ? JSON.stringify(a) : '');
  return f;
}

// ---- the scripted backend (--fake) ---------------------------------------------------------------------------------
const VALID = { ok: true, stage: 'done', full: true, ms: 8421, modHash: 'm3', overlayHash: 'o3', errors: [], warnings: [],
  checks: { schema: { ok: true, files: 5 }, semantic: { ok: true, defs: { added: 2, patched: 0, retired: 0 } },
    boot: { ok: true, simHours: 48, actions: 212, perDef: {}, econ: { coinsBp: 10350, xpBp: 10120 }, retire: true }, render: { ok: true, models: 2, icons: 4 } } };
const CHANGES = [
  { op: 'add', family: 'crops', id: 'x_moon_melon', name: { en: 'Moon Melon', bg: 'Лунен пъпеш' }, icon: '/assets/icons/watermelon.png',
    numbers: { sell: 124, seed: 149, xp: 47, minutes: 90, unlock: 14 } },
  { op: 'add', family: 'recipes', id: 'x_melon_pie', name: { en: 'Melon Pie', bg: 'Пъпешов пай' }, icon: '/assets/icons/pumpkin_pie.png',
    numbers: { sell: 410, xp: 20, minutes: 45, unlock: 15 } },
  { op: 'retire', family: 'decor', id: 'x_old_lantern', name: { en: 'Lilac Lantern', bg: 'Люляков фенер' }, icon: '/assets/icons/lantern.png', numbers: { sell: 300 } },
];
const SUMMARY = { en: 'I added a Moon Melon that glows at dusk and a Melon Pie for the pie oven. The lilac lantern is no longer sold.',
  bg: 'Добавих лунен пъпеш, който свети привечер, и пъпешов пай за пещта за пайове. Люляковият фенер вече не се продава.' };
const FAILED_VALIDATION = { ok: false, stage: 'semantic', full: true, checks: { schema: { ok: true, files: 3 } },
  errors: [{ stage: 'semantic', code: 'ECON_BOUND', file: 'content/recipes/x_gold_pie.json', path: 'minutes', message: 'add < 15 %', hint: 'longer time' },
    { stage: 'semantic', code: 'BAD_ANCHOR', file: 'content/animals/x_dragon.json', path: 'like', message: 'no such anchor' }] };

function createFake(pages, { hosted = false } = {}) {
  let id = 0;
  const S = {
    job: null,
    active: { n: 2, hash: 'h2', appliedAt: Date.now() - 3_600_000, by: 'p2', title: { en: 'Lilac lantern', bg: 'Люляков фенер' } },
    versions: [
      { n: 2, at: Date.now() - 3_600_000, by: 'p2', kind: 'apply', title: { en: 'Lilac lantern', bg: 'Люляков фенер' }, prompt: 'A lilac lantern for the garden', summary: {},
        changes: [{ op: 'add', family: 'decor', id: 'x_old_lantern', name: { en: 'Lilac Lantern', bg: 'Люляков фенер' }, icon: '/assets/icons/lantern.png' }], state: 'active' },
      { n: 1, at: Date.now() - 7_200_000, by: 'p1', kind: 'apply', title: { en: 'Faster wheat', bg: 'По-бърза пшеница' }, prompt: 'Wheat grows a little faster', summary: {},
        changes: [{ op: 'change', family: 'tuning', id: 'wheat', name: { en: 'Wheat', bg: 'Пшеница' } }], state: 'past' },
    ],
    consent: {},
    signed: { p1: {}, p2: {} },
    signin: { p1: {}, p2: {} },
    staleOnce: false,
  };
  const providers = (pid) => [
    { id: 'chatgpt', available: true, signedIn: Boolean(S.signed[pid].chatgpt), ...(S.signed[pid].chatgpt ? { account: { label: 'f***@example.com' } } : {}) },
    hosted ? { id: 'claude', available: false, reason: 'HOST_NOT_ALLOWED', signedIn: false }
      : { id: 'claude', available: true, signedIn: Boolean(S.signed[pid].claude), ...(S.signed[pid].claude ? { account: { label: 'Claude plan' } } : {}) },
    { id: 'mock', available: true, signedIn: Boolean(S.signed[pid].mock) },
  ];
  async function push(msg, pid = null) {
    for (const p of pages()) {
      if (pid && p.pid !== pid) continue;
      await p.evaluate((m) => window.__hh.ui.harness?.receive(m), msg).catch(() => {});
    }
  }
  const touch = (o) => { S.job = { ...S.job, ...o, updatedAt: Date.now() }; return push({ t: 'hx', e: 'job', job: S.job }); };
  const answer = (status, body) => ({ status, body });
  async function handle(pid, method, rel, body) {
    const seg = rel.split('/').filter(Boolean);
    if (method === 'GET' && rel === '/state') {
      return answer(200, { enabled: true, providers: providers(pid), job: S.job, active: S.active,
        consent: { telemetry: S.consent[pid] ?? null, sending: true }, limits: { jobsPerHour: 10, jobsPerDay: 30 } });
    }
    if (method === 'POST' && rel === '/jobs') {
      if (S.job && !['applied', 'discarded', 'expired', 'failed', 'cancelled', 'answered'].includes(S.job.state)) return answer(409, { error: 'BUSY', job: S.job });
      if (!S.signed[pid][body.provider]) return answer(428, { error: 'SIGN_IN' });
      id += 1;
      S.job = { id: `job${id}`, by: pid, provider: body.provider, model: body.model ?? null, state: 'starting', step: 'reading', round: 1, startedAt: Date.now(),
        updatedAt: Date.now(), lang: body.lang, prompts: [{ at: Date.now(), text: body.prompt }], progress: [], result: null, error: null };
      push({ t: 'hx', e: 'job', job: S.job });
      return answer(202, { job: S.job });
    }
    if (method === 'GET' && rel === '/jobs/current') return answer(200, { job: S.job });
    if (seg[0] === 'jobs' && seg[2]) {
      const job = S.job && S.job.id === seg[1] ? S.job : null;
      if (!job) return answer(404, { error: 'NOT_FOUND' });
      if (seg[2] === 'revise') {
        S.job = { ...job, state: 'revising', step: 'reading', round: job.round + 1, prompts: [...job.prompts, { at: Date.now(), text: body.prompt }], result: null, updatedAt: Date.now() };
        push({ t: 'hx', e: 'job', job: S.job });
        return answer(202, { job: S.job });
      }
      if (seg[2] === 'apply') {
        if (job.by !== pid) return answer(403, { error: 'NOT_YOURS' });
        if (S.staleOnce) { S.staleOnce = false; return answer(409, { error: 'STALE' }); }
        const n = S.active.n + 1;
        S.active = { n, hash: `h${n}`, appliedAt: Date.now(), by: pid, title: { en: 'Moonlight harvest', bg: 'Лунна жътва' } };
        for (const v of S.versions) v.state = 'past';
        S.versions.unshift({ n, at: Date.now(), by: pid, kind: 'apply', title: S.active.title, prompt: job.prompts[0].text, summary: SUMMARY, changes: CHANGES, state: 'active' });
        S.job = { ...job, state: 'applied', updatedAt: Date.now() };
        await push({ t: 'hx', e: 'job', job: S.job });
        await push({ t: 'hx', e: 'applied', by: pid, n, title: S.active.title, summary: SUMMARY,
          names: CHANGES.filter((c) => c.op === 'add').map((c) => ({ id: c.id, ...c.name, family: c.family })) });
        return answer(200, { active: S.active });
      }
      if (seg[2] === 'discard' || seg[2] === 'cancel') {
        S.job = { ...job, state: seg[2] === 'discard' ? 'discarded' : 'cancelled', updatedAt: Date.now() };
        push({ t: 'hx', e: 'job', job: S.job });
        return answer(200, { job: S.job });
      }
    }
    if (method === 'GET' && rel === '/history') return answer(200, { active: S.active.n, versions: S.versions });
    if (method === 'POST' && rel === '/undo') {
      const to = Number.isInteger(body.to) ? body.to : S.versions.filter((v) => v.n < S.active.n).sort((a, b) => b.n - a.n)[0]?.n ?? 0;
      const n = S.versions[0].n + 1;
      for (const v of S.versions) v.state = 'past';
      S.versions.unshift({ n, at: Date.now(), by: pid, kind: 'undo', title: { en: `Back to version ${to}`, bg: `Обратно към версия ${to}` }, prompt: null, summary: {}, changes: [], state: 'active' });
      S.active = { n, hash: `h${n}`, appliedAt: Date.now(), by: pid, title: null };
      await push({ t: 'hx', e: 'undone', by: pid, n, to });
      return answer(200, { active: S.active });
    }
    if (rel === '/consent') {
      if (method === 'POST') S.consent[pid] = Boolean(body.telemetry);
      return answer(200, { telemetry: S.consent[pid] ?? null, at: Date.now(), sending: true, install: S.consent[pid] ? '5be1c0de9a7f4e21b3d08c6f1a2e4d97' : null });
    }
    if (seg[0] === 'providers' && seg[1]) {
      const pv = seg[1];
      if (seg[2] === 'models') {
        return answer(200, { models: pv === 'chatgpt' ? [{ id: 'gpt-5.5', label: 'GPT-5.5' }, { id: 'gpt-5.5-mini', label: 'GPT-5.5 mini' }]
          : pv === 'claude' ? [{ id: 'default', label: 'Default' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'opus', label: 'Opus' }] : [] });
      }
      if (seg[2] === 'signin' && !seg[3] && method === 'POST') {
        const url = pv === 'claude' ? 'https://claude.ai/oauth/authorize?code=true&client_id=demo&state=Q1w2E3'
          : pv === 'chatgpt' ? 'https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&code_challenge_method=S256&state=x7Yz'
            : `/api/harness/mock/signin?state=m0ck${pid}`;
        const paste = pv === 'claude' ? { field: 'code' } : pv === 'chatgpt' ? { field: 'redirect_url' } : undefined;
        S.signin[pid][pv] = { provider: pv, state: 'pending', step: { kind: 'open_url', url, expiresAt: Date.now() + 600_000, ...(paste ? { paste } : {}) } };
        return answer(200, S.signin[pid][pv]);
      }
      if (seg[2] === 'signin' && seg[3] === 'continue') {
        const v = String(body.code ?? body.redirectUrl ?? '');
        if (/bad/i.test(v)) { S.signin[pid][pv] = { ...S.signin[pid][pv], state: 'error', error: { code: pv === 'chatgpt' ? 'STATE' : 'BAD_CODE' } }; return answer(200, S.signin[pid][pv]); }
        S.signed[pid][pv] = true;
        S.signin[pid][pv] = { provider: pv, state: 'signed_in', account: { label: pv === 'chatgpt' ? 'f***@example.com' : pv === 'claude' ? 'Claude plan' : 'test' } };
        push({ t: 'hx', e: 'signin', provider: pv, state: 'signed_in', signIn: S.signin[pid][pv] }, pid);
        return answer(200, S.signin[pid][pv]);
      }
      if (seg[2] === 'signin' && method === 'GET') return answer(200, S.signin[pid][pv] ?? { provider: pv, state: S.signed[pid][pv] ? 'signed_in' : 'signed_out' });
      if (seg[2] === 'signout') { S.signed[pid][pv] = false; return answer(200, { provider: pv, state: 'signed_out' }); }
    }
    return answer(404, { error: 'NOT_FOUND' });
  }
  async function install(page) {
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      const u = new URL(req.url());
      const m = /^\/api(?:\/f\/[a-z2-7]{12})?\/harness(\/.*)$/.exec(u.pathname);
      if (!m) { req.continue().catch(() => {}); return; }
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
      const ok = /^Bearer \S{8,}$/.test(req.headers().authorization || '');
      const r = ok ? await handle(page.pid, req.method(), m[1].replace(/\?.*$/, ''), body) : answer(401, { error: 'AUTH' });
      req.respond({ status: r.status, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(r.body) }).catch(() => {});
    });
  }
  return {
    S, install, push,
    step: (state, step, code) => touch({ state, step, progress: [...(S.job.progress ?? []), ...(code ? [{ at: Date.now(), step, code, note: code }] : [])].slice(-20) }),
    ready: () => touch({ state: 'ready', step: 'ready', result: { candidate: S.active.n + 1, parent: S.active.n, summary: SUMMARY, changes: CHANGES, validation: VALID } }),
    fail: () => touch({ state: 'failed', step: 'testing', error: { code: 'INVALID' }, result: { changes: [], validation: FAILED_VALIDATION,
      summary: { en: 'Dragons are not possible here: a new animal copies one the game has. I tried a Gold Pie, and it earned too much.',
        bg: 'Дракони тук не стават: новото животно копира някое от играта. Опитах златен пай, но носеше твърде много.', possible: false } } }),
    // release 1.0 (H1): Harvey's answer to a wish that cannot be built
    answered: () => touch({ state: 'answered', step: 'ready', result: { candidate: null, parent: S.active.n, changes: [], validation: null,
      summary: { en: 'I cannot give you coins: prices and rewards are the game\'s own. I can make your crops grow a little faster instead.',
        bg: 'Не мога да ти дам монети: цените и наградите са на играта. Мога вместо това да направя посевите ти малко по‑бързи.',
        possible: false, try: [{ en: 'Crops grow 20% faster', bg: 'Посевите да растат с 20 % по‑бързо' }] } } }),
  };
}

// ---- one pass of the fake run: every state on one device and language -------------------------------------------
const H = (page) => page.evaluate(() => window.__hh.ui.harness?.connect({ force: true }));
const click = async (page, sel) => {
  stage = `${page.tag ?? ''} press ${sel}`;
  for (let i = 0; ; i++) {
    await waitFor(page, (s) => { const el = document.querySelector(s); return el && !el.disabled && el.getClientRects().length; }, sel);
    // redrawn between the look and the press, or a phone sheet still sliding in (no stable point to press yet)
    try { await page.click(sel); return; } catch (err) { if (i >= 4 || !/detached|not clickable/i.test(err.message)) throw err; await sleep(250); }
  }
};
// a triple click selects one line only: a box with the old wish back in it ("Change my wish") is emptied by select()
const typeInto = async (page, sel, text) => {
  await page.click(sel);
  await page.evaluate((s) => document.querySelector(s)?.select?.(), sel);
  await page.keyboard.type(text, { delay: 2 });
};
const textOf = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? '', sel);
const openPanel = (page, name, a = {}) => page.evaluate(([n, x]) => window.__hh.ui.panels.open(n, x), [name, a]);
// the dock exists only after the server said the helper is on: an absent dock is not a shown one
const dockShown = () => { const d = document.getElementById('hx-dock'); return Boolean(d && !d.hidden && d.getClientRects().length); };
/**
 * What a finger at the centre of `sel` would touch (document.elementFromPoint): null when it is the element itself (or
 * inside it), else what lies over it, in words for the step's detail.
 */
const coverOf = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el || !el.getClientRects().length) return `${s} is not on the screen`;
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (top && (top === el || el.contains(top))) return null;
  const card = top?.closest('.unlock-banner, .bloom-banner, .rosette, .toast, .notice, .hh-panel, section, aside') ?? top;
  return `${top ? `${top.tagName.toLowerCase()}.${String(top.className).trim().replace(/\s+/g, '.')}` : 'nothing'} of ${card?.className ?? '?'}: "${
    String(card?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50)}"`;
}, sel);
/** Tap (phones) or click (desktop) Harvey's button the way a player does, once nothing lies over it where it is pressed. */
async function pressHarvey(page) {
  stage = `${page.tag ?? ''} press #hx-btn`;
  await waitFor(page, dockShown, null, 15_000);
  const cover = await coverOf(page, '#hx-btn');
  check(`${page.tag}: Harvey's button is the topmost element at its centre (a tap lands on it)`, cover === null, cover ?? '');
  await pressOn(page, '#hx-btn');
}
/** The land card a real farm shows once after the land update (ui/panels/w5.js): on a phone it spans the top of the
 *  screen, where the right edge column with Harvey's button is. Up while a press proves the button stays on top. */
const landCard = {
  // release 1.0 (M19, harvey#15): up() resolves when the card's entrance animation has ENDED (animationend, or every
  // animation of the card finished), never after a fixed 500 ms: during its scale-in the card can lie over the button
  up: (page) => page.evaluate(async (bg) => {
    window.__e2eLand = window.__hh.ui.banner({ id: 'e2e-land', kind: 'quest', ttl: 600_000, things: [],
      ribbon: bg ? 'По‑голяма земя!' : 'Bigger land!',
      message: bg ? 'Земята на фермата вече е в 7 големи парцела вместо в много малки. Всичко ваше си остава ваше: Хълмът при потока и Овощната алея.'
        : 'The farm\'s land is now 7 big parcels instead of many small ones. Everything of yours stays yours: Brook Hill and the Orchard Lane.',
      actions: [{ label: bg ? 'Отвори картата' : 'Open the map', kind: 'sky', fn: () => {} }] });
    const el = await new Promise((r) => { const t0 = performance.now(); const look = () => { const x = document.querySelector('.unlock-banner[data-id="e2e-land"]'); if (x || performance.now() - t0 > 3000) r(x); else requestAnimationFrame(look); }; look(); });
    if (!el) return { entrance: 'no card' };
    const t0 = performance.now();
    const running = () => [el, ...el.querySelectorAll('*')].flatMap((x) => x.getAnimations?.() ?? []).filter((a) => a.playState === 'running' && !(a.effect?.getComputedTiming?.().iterations === Infinity));
    await new Promise((r) => {
      let done = false;
      const end = () => { if (!done) { done = true; r(); } };
      el.addEventListener('animationend', () => { if (!running().length) end(); });
      Promise.all(running().map((a) => a.finished.catch(() => {}))).then(end);
      setTimeout(end, 4000);
    });
    return { entrance: Math.round(performance.now() - t0) };
  }, page.lang === 'bg'),
  away: (page) => page.evaluate(() => { window.__e2eLand?.close?.(); window.__e2eLand = null; }),
};
const focusIn = (page, sel) => page.evaluate((x) => Boolean(document.activeElement?.closest?.(x)), sel);
const topPanel = (page) => page.evaluate(() => window.__hh.ui.panels.top());
const confirmYes = (page) => click(page, '#panel-confirm .acts .btn:last-child');

async function fakePassDesktop(lang) {
  const tag = `desktop-${lang}`;
  let A = null;
  let B = null;
  let fake = null;
  try {
    await desktopSteps();
  } catch (err) {
    // say where it stopped: the top panel and the helper's state on both screens
    const where = async (p) => (p ? p.evaluate(() => {
      const sn = window.__hh.ui.harness?.snapshot?.();
      return { top: window.__hh.ui.panels.top(), job: sn?.job?.state ?? null, round: sn?.job?.round ?? null, stale: sn?.stale, busy: sn?.busy };
    }).catch(() => null) : null);
    err.message += ` | fake ${fake?.S.job?.state}/${fake?.S.job?.round} | A ${JSON.stringify(await where(A))} B ${JSON.stringify(await where(B))}`;
    throw err;
  }

  async function desktopSteps() {
    fake = createFake(() => [A, B].filter(Boolean), { hosted: lang === 'bg' });
    A = await openPage('A', { slot: 'p1', name: 'Rowan', device: 'desktop', lang, setup: fake.install });
    B = await openPage('B', { slot: 'p2', name: 'Mia', device: 'desktop', lang, setup: fake.install });
    await Promise.all([H(A), H(B)]);
    await waitFor(A, dockShown);
    // M19 / ui-shell's selector map: Harvey's control is IN the right column (under the gear), not necessarily first
    check(`${tag}: the helper button is in the right edge column`, await A.evaluate(() => Boolean(document.getElementById('hud-right')?.contains(document.getElementById('hx-dock')))));
    await shot(A, `${tag}-01-button`);
    // the keyboard: Enter on the button opens the helper with the focus in the request box; Escape gives it back
    await A.focus('#hx-btn');
    await A.keyboard.press('Enter');
    await waitFor(A, () => window.__hh.ui.panels.top() === 'helper');
    await waitFor(A, () => document.activeElement?.id === 'hx-prompt', null, 3000).catch(() => {});
    check(`${tag}: Enter on the button opens the helper, the focus in the request box`, await focusIn(A, '#hx-prompt'));
    await A.keyboard.press('Escape');
    await waitFor(A, () => window.__hh.ui.panels.top() === null);
    check(`${tag}: Escape closes it and the focus is back on the button`, await focusIn(A, '#hx-btn'));
    await pressHarvey(A);
    check(`${tag}: the button opens the helper panel`, await topPanel(A) === 'helper');
    check(`${tag}: the button says "Harvey" (a visible label, H4)`, /^(Harvey|Харви)$/.test(await textOf(A, '#hx-btn .hx-btn-cap')));
    await shot(A, `${tag}-02-ask-signed-out`);
    // H4 (harvey#4): the partner asks before signing in, with more than one plan offered: no sign-in starts (no Claude
    // Code login is spawned for a choice nobody made); Sign-in asks to choose
    await openPanel(B, 'helper', { tab: 'ask' });
    await typeInto(B, '#hx-prompt', lang === 'bg' ? 'Розова ограда' : 'A pink fence');
    await click(B, '[data-act="ask"]');
    await waitFor(B, () => document.querySelector('.hx-choose'));
    check(`${tag}: Ask unsigned with several plans starts no sign-in ("Choose who runs Harvey")`,
      Object.keys(fake.S.signin.p2).length === 0 && /Choose who runs Harvey|Избери с какво да работи Харви/.test(await textOf(B, '#panel-helper')));
    await shot(B, `${tag}-02b-choose`);
    await B.evaluate(() => window.__hh.ui.panels.closeAll());
    await openPanel(A, 'helper', { tab: 'accounts' });
    await shot(A, `${tag}-03-accounts`);
    if (lang === 'en') {
      await click(A, '[data-provider="claude"] > .hx-actions [data-act="signin"]');
      await waitFor(A, () => document.querySelector('[data-signin-open="claude"]'));
      await shot(A, `${tag}-04-signin-claude`);
      await typeInto(A, '#hx-paste-claude', 'bad-code');
      await click(A, '[data-signin="claude"] [data-act="continue"]');
      await waitFor(A, () => document.querySelector('[data-signin="claude"] .hx-error'));
      await shot(A, `${tag}-05-signin-claude-bad-code`);
      await click(A, '[data-signin="claude"] [data-act="restart"]');
      await waitFor(A, () => document.querySelector('#hx-paste-claude'));
      await typeInto(A, '#hx-paste-claude', 'Ab12-Cd34-Ef56');
      await click(A, '[data-signin="claude"] [data-act="continue"]');
      await waitFor(A, () => /Signed in to Claude/.test(document.querySelector('[data-signin="claude"]')?.textContent ?? ''));
      await shot(A, `${tag}-06-signin-claude-done`);
    }
    await click(A, '[data-provider="chatgpt"] [data-act="signin"]');
    await waitFor(A, () => document.querySelector('#hx-paste-chatgpt'));
    await shot(A, `${tag}-07-signin-chatgpt`);
    await typeInto(A, '#hx-paste-chatgpt', 'http://127.0.0.1:4330/auth/callback?code=ac_123&state=x7Yz');
    await click(A, '[data-signin="chatgpt"] [data-act="continue"]');
    await waitFor(A, () => !document.querySelector('[data-signin="chatgpt"]'), null, 8000);
    await click(A, '[data-provider="chatgpt"] [data-act="use"]').catch(() => {});
    await sleep(300);
    await shot(A, `${tag}-08-accounts-signed-in`);
    check(`${tag}: a signed-in provider says whose plan it uses`, /f\*\*\*@example\.com/.test(await textOf(A, '[data-provider="chatgpt"]')));

    // the request, the consent question, then the work while the farmer plays on
    await openPanel(A, 'helper', { tab: 'ask' });
    await waitFor(A, () => document.querySelector('#hx-prompt'));
    const req = lang === 'bg' ? 'Бледосин пъпеш, който свети привечер, и пай от него' : 'A pale blue melon that glows at dusk, and a pie made from it';
    await typeInto(A, '#hx-prompt', req);
    await shot(A, `${tag}-09-ask-typed`);
    await A.keyboard.down('Control');
    await A.keyboard.press('Enter');
    await A.keyboard.up('Control');
    await waitFor(A, () => document.querySelector('.hx-consent'));
    check(`${tag}: Ctrl+Enter sends; the focus moves to the consent question, not to the page`, await focusIn(A, '.hx-consent'));
    await shot(A, `${tag}-10-consent`);
    // harvey#16 (opt-in, default off): "Keep them to myself" comes first, and both answers are the same size
    const rects = await A.evaluate(() => [...document.querySelectorAll('.hx-consent-acts .btn')].map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.consent, Math.round(r.width), Math.round(r.height)]; }));
    check(`${tag}: both consent answers are the same size (rect)`, rects.length === 2 && rects[0][1] === rects[1][1] && rects[0][2] === rects[1][2], JSON.stringify(rects));
    await A.keyboard.press('Tab');
    check(`${tag}: Tab from the question reaches "Keep them to myself" first`, await focusIn(A, '[data-consent="no"]'));
    await A.keyboard.press('Tab');
    check(`${tag}: then Share`, await focusIn(A, '[data-consent="yes"]'));
    await A.keyboard.press('Enter');
    await waitFor(A, () => document.querySelector('.hx-job'));
    check(`${tag}: then the focus moves to the job card`, await focusIn(A, '.hx-job'));
    check(`${tag}: the request went out with the language`, fake.S.job?.lang === lang && fake.S.job?.prompts[0].text === req, JSON.stringify(fake.S.job?.prompts));
    await shot(A, `${tag}-11-job-started`);
    await click(A, '[data-act="play"]');
    check(`${tag}: "Keep playing" closes the panel`, await topPanel(A) === null);
    await waitFor(A, () => !document.querySelector('.hx-pill')?.hidden);
    await shot(A, `${tag}-12-pill-reading`);
    // the farmer keeps playing: plant every empty plot while the helper works
    const planted = await A.evaluate(() => {
      let n = 0;
      for (const [id, o] of Object.entries(window.__hh.state.farm.objects)) if (o.def === 'plot' && !o.crop) { if (window.__hh.act('plant', { id, crop: 'wheat' })?.ok !== false) n++; }
      return n;
    });
    await fake.step('working', 'building', 'write');
    await sleep(300);
    check(`${tag}: the farmer planted while the helper worked`, planted > 0 && await A.evaluate(() => Object.values(window.__hh.state.farm.objects).some((o) => o.crop)));
    await shot(A, `${tag}-13-pill-building`);
    await shot(B, `${tag}-13-partner-pill`);
    check(`${tag}: the partner sees whose helper works`, /Rowan/.test(await textOf(B, '.hx-pill-line')));
    await fake.step('validating', 'testing', 'full');
    await shot(A, `${tag}-14-pill-testing`);
    await fake.step('fixing', 'fixing', 'fix');
    await openPanel(A, 'helper', { tab: 'ask' });
    await shot(A, `${tag}-15-panel-job-fixing`);
    await A.evaluate(() => window.__hh.ui.panels.closeAll());
    await sleep(200);
    await A.click('.hx-pill-x');
    check(`${tag}: the pill hides on request`, await A.evaluate(() => document.querySelector('.hx-pill').hidden));
    await shot(A, `${tag}-16-pill-hidden`);
    await fake.ready();
    await waitFor(A, () => window.__hh.ui.panels.top() === 'helper-ready');
    // QA r4 H4-01: a pop-up that opened by itself keeps the focus on its frame, never on Apply (a Space meant for the
    // chat line applied the change unseen); one the farmer opens from the pill puts it on Apply
    await sleep(300);
    check(`${tag}: the ready pop-up that opened by itself has no focus on Apply`, !(await focusIn(A, '[data-act="apply"]')) && await focusIn(A, '#panel-helper-ready'));
    await A.keyboard.press('Escape');
    await waitFor(A, () => window.__hh.ui.panels.top() === null);
    await A.evaluate(() => document.querySelector('.hx-pill-main')?.click());
    await waitFor(A, () => window.__hh.ui.panels.top() === 'helper-ready');
    await waitFor(A, () => document.activeElement?.dataset?.act === 'apply', null, 3000).catch(() => {});
    check(`${tag}: opened from the pill, the ready pop-up puts the focus on Apply`, await focusIn(A, '[data-act="apply"]'));
    await shot(A, `${tag}-17-ready`);
    await shot(A, `${tag}-18-ready-bottom`, { scrollPanel: 'helper-ready' });
    await shot(B, `${tag}-18-partner-ready-pill`);
    check(`${tag}: no pop-up on the partner's screen`, await topPanel(B) === null);
    await click(A, '[data-act="revise"]');
    await shot(A, `${tag}-19-revise-box`, { scrollPanel: 'helper-ready' });
    // QA r1 H-05: while the box is open its own Send and Cancel are the actions; the sticky bar steps aside
    check(`${tag}: the action bar steps aside while "Ask for changes" is open`, await A.evaluate(() => document.querySelector('#panel-helper-ready .hx-sticky-acts')?.hidden === true));
    await click(A, '[data-act="reviseCancel"]');
    await waitFor(A, () => document.querySelector('#panel-helper-ready .hx-revise')?.hidden && !document.querySelector('#panel-helper-ready .hx-sticky-acts')?.hidden);
    if (lang === 'en') {
      await A.evaluate(() => document.querySelector('.hx-read')?.click());
      await sleep(200);
      await shot(A, `${tag}-20-reading-aloud`);
      await A.evaluate(() => document.querySelector('.hx-read[aria-pressed="true"]')?.click());
    }
    fake.S.staleOnce = true;
    await click(A, '[data-act="apply"]');
    await waitFor(A, () => document.querySelector('.hx-stale:not([hidden])'));
    await shot(A, `${tag}-21-stale`, { scrollPanel: 'helper-ready' });
    const staleApply = await A.evaluate(() => {
      const b = document.querySelector('#panel-helper-ready [data-act="apply"]');
      const bar = document.querySelector('#panel-helper-ready .hx-sticky-acts');
      return { disabled: Boolean(b?.disabled), barHidden: Boolean(bar?.hidden), rebuild: Boolean(document.querySelector('.hx-stale [data-act="rebuild"]')?.getClientRects().length),
        discard: Boolean(document.querySelector('.hx-stale [data-act="staleDiscard"]')?.getClientRects().length) };
    });
    // QA r1 H-05: Apply cannot be pressed while the farm moved on; the notice's own Rebuild and Discard are the actions
    check(`${tag}: Apply waits while the farm moved on; the notice carries Rebuild and Discard`, staleApply.disabled && staleApply.barHidden && staleApply.rebuild && staleApply.discard, JSON.stringify(staleApply));
    await click(A, '[data-act="rebuild"]');
    await waitFor(A, () => window.__hh.ui.panels.top() === null);
    check(`${tag}: a rebuild is a new round`, fake.S.job.round === 2 && fake.S.job.state === 'revising');
    await fake.step('working', 'building', 'write');
    await fake.ready();
    await waitFor(A, () => window.__hh.ui.panels.top() === 'helper-ready');
    await click(A, '[data-act="apply"]');
    await waitFor(A, () => [...document.querySelectorAll('.toast')].some((x) => /Moon Melon|лунен пъпеш/i.test(x.textContent)));
    await waitFor(B, () => [...document.querySelectorAll('.toast')].some((x) => /Rowan/.test(x.textContent)));
    await shot(A, `${tag}-22-applied-toast`);
    await shot(B, `${tag}-22-partner-toast`);
    check(`${tag}: the pill is gone after the apply`, await A.evaluate(() => document.querySelector('.hx-pill').hidden));

    // history and undo
    await openPanel(A, 'helper', { tab: 'history' });
    await waitFor(A, () => document.querySelector('.hx-versions'));
    await shot(A, `${tag}-23-history`);
    await click(A, '[data-act="undoLast"]');
    await waitFor(A, () => window.__hh.ui.panels.top() === 'confirm');
    await shot(A, `${tag}-24-undo-confirm`);
    await confirmYes(A);
    await waitFor(B, () => [...document.querySelectorAll('.toast')].some((x) => /undid|върна/.test(x.textContent)));
    await shot(B, `${tag}-25-partner-undo-toast`);

    // a request that cannot be built
    await A.evaluate(() => window.__hh.ui.panels.closeAll());
    await openPanel(A, 'helper', { tab: 'ask' });
    await typeInto(A, '#hx-prompt', lang === 'bg' ? 'Дракон, който снася златни яйца' : 'A dragon that lays golden eggs');
    await click(A, '[data-act="ask"]');
    await waitFor(A, () => document.querySelector('.hx-job'));
    await A.evaluate(() => window.__hh.ui.panels.closeAll());
    await fake.step('validating', 'testing', 'full');
    await fake.fail();
    await waitFor(A, () => document.querySelector('.hx-pill')?.dataset.tone === 'fail');
    await shot(A, `${tag}-26-pill-failed`);
    await A.click('.hx-pill-main');
    await waitFor(A, () => document.querySelector('.hx-job.state-failed'));
    await shot(A, `${tag}-27-failed`);
    check(`${tag}: the failure leads with Harvey's words, the codes folded`, await A.evaluate(() => {
      const card = document.querySelector('.hx-job.state-failed');
      return Boolean(card.querySelector('.hx-answer-text')) && card.querySelector('details.hx-what') && !card.querySelector('details.hx-what').open;
    }));
    await click(A, '[data-act="change"]');
    check(`${tag}: "Change my wish" puts the old words back in the box`, await A.evaluate(() => /Дракон|dragon/i.test(document.querySelector('#hx-prompt')?.value ?? '')));

    // H1: Harvey's answer to a wish that cannot be built: his reply opens by itself, with the chip row and OK
    await typeInto(A, '#hx-prompt', lang === 'bg' ? 'Дай ми 10 000 монети' : 'Give me 10,000 coins');
    await click(A, '[data-act="ask"]');
    await waitFor(A, () => document.querySelector('.hx-job'));
    await A.evaluate(() => window.__hh.ui.panels.closeAll());
    await fake.answered();
    await waitFor(A, () => window.__hh.ui.panels.top() === 'helper-ready');
    check(`${tag}: the answer is Harvey's reply, with his suggestion as a chip`, await A.evaluate(() => {
      const p = document.querySelector('#panel-helper-ready');
      return Boolean(p.querySelector('.hx-answer')) && p.querySelectorAll('.hx-chip').length >= 1 && p.querySelectorAll('.hx-chip').length <= 3 && !p.querySelector('[data-act="apply"]');
    }));
    check(`${tag}: the answer quotes the wish asked, nothing else`, (await textOf(A, '#panel-helper-ready .hx-quote')) === (lang === 'bg' ? 'Дай ми 10 000 монети' : 'Give me 10,000 coins'),
      await textOf(A, '#panel-helper-ready .hx-quote'));
    await shot(A, `${tag}-27b-answered`);
    await click(A, '[data-act="ok"]');
    check(`${tag}: OK puts the answer away`, await topPanel(A) === null && await A.evaluate(() => document.querySelector('.hx-pill').hidden));

    // Settings › Helper
    await openPanel(A, 'settings', { tab: 'helper' });
    await waitFor(A, () => document.querySelector('[data-harness="share"]'));
    await shot(A, `${tag}-28-settings`);
    await A.close();
    await B.close();
  }
}

async function fakePassPhone(device, lang) {
  const tag = `${device}-${lang}`;
  let A = null;
  const fake = createFake(() => [A].filter(Boolean), { hosted: true });
  fake.S.signed.p1.chatgpt = true;
  A = await openPage('A', { slot: 'p1', name: 'Desi', device, lang, setup: fake.install });
  await H(A);
  await waitFor(A, dockShown);
  await shot(A, `${tag}-01-button`);
  await landCard.up(A);
  // pressHelper: proven on top before every tap; a loaded headless phone may read a tap as a long press (the tip)
  await pressHelper(A, () => Boolean(document.querySelector('#hx-prompt')));
  await landCard.away(A);
  await sleep(200);
  // M13b (ux-phone#6): on a touch screen the keyboard comes with the player's tap, never with the sheet
  check(`${tag}: no keyboard by itself (the box takes no focus on a touch screen)`, await A.evaluate(() => document.activeElement?.id !== 'hx-prompt'));
  // M13b (ux-phone#10): the tab row stays at one height on Ask, History and Sign-in
  const tabY = [];
  // measured once the sheet has stopped moving (its slide-in is an animation; a loaded machine runs it late)
  const still = () => { const f = document.querySelector('#panel-helper'); return Boolean(f)
    && [f, ...f.querySelectorAll('.hh-tabs')].every((x) => x.getAnimations().every((an) => an.playState !== 'running'
      || an.effect?.getComputedTiming?.().iterations === Infinity)); };
  for (const tab of ['ask', 'history', 'accounts', 'ask']) {
    await openPanel(A, 'helper', { tab });
    await sleep(150);
    await waitFor(A, still, null, 8000);
    tabY.push(await A.evaluate(() => Math.round(document.querySelector('#panel-helper .hh-tabs')?.getBoundingClientRect().top ?? -1)));
  }
  check(`${tag}: the helper's tab row sits at one height on all three tabs`, tabY.every((y) => Math.abs(y - tabY[0]) <= 1 && y >= 0), JSON.stringify(tabY));
  await waitFor(A, () => document.querySelector('#hx-prompt'));
  await shot(A, `${tag}-02-ask`);
  await typeInto(A, '#hx-prompt', lang === 'bg' ? 'Сливов пай за пещта за пайове' : 'A plum pie for the pie oven');
  await A.tap('[data-act="ask"]');
  await waitFor(A, () => document.querySelector('.hx-consent'));
  await shot(A, `${tag}-03-consent`, { scrollPanel: 'helper' });
  await A.tap('[data-consent="no"]');
  await waitFor(A, () => document.querySelector('.hx-job'));
  await A.evaluate(() => window.__hh.ui.panels.closeAll());
  await fake.step('working', 'building', 'write');
  await waitFor(A, () => !document.querySelector('.hx-pill')?.hidden);
  await shot(A, `${tag}-04-pill`);
  await fake.ready();
  await waitFor(A, () => window.__hh.ui.panels.top() === 'helper-ready');
  await waitFor(A, () => { const f = document.querySelector('#panel-helper-ready'); return Boolean(f)
    && f.getAnimations().every((an) => an.playState !== 'running' || an.effect?.getComputedTiming?.().iterations === Infinity); }, null, 8000);
  await sleep(150);
  // M13b (harvey#8, astra#5): Apply inside the screen without scrolling (the action bar sticks to the sheet's bottom)
  const applyAt = await A.evaluate(() => {
    const b = document.querySelector('#panel-helper-ready [data-act="apply"]');
    const sc = document.querySelector('#panel-helper-ready .hh-panel-scroll');
    const r = b?.getBoundingClientRect();
    const vh = window.visualViewport?.height ?? innerHeight;
    const top = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return { top: r && Math.round(r.top), bottom: r && Math.round(r.bottom), vh: Math.round(vh), scrolled: sc ? sc.scrollTop : null, onTop: Boolean(top && (top === b || b.contains(top))) };
  });
  check(`${tag}: Apply is in view on the ready sheet without scrolling`, applyAt.bottom !== null && applyAt.bottom <= applyAt.vh && applyAt.scrolled === 0 && applyAt.onTop, JSON.stringify(applyAt));
  await shot(A, `${tag}-05-ready`);
  await shot(A, `${tag}-06-ready-bottom`, { scrollPanel: 'helper-ready' });
  // QA r1 H-05: the field's own button is what a finger at its centre touches once it is scrolled into view the way the
  // shell does it for the keyboard (keepInView: the button to the bottom edge, then the field): "Send" after "Ask for
  // changes", "Rebuild on top" after a stale Apply. At 360 x 640 the sticky bar used to lie over both
  const pressable = (sel, field = null) => A.evaluate(([s, f]) => {
    const b = document.querySelector(`#panel-helper-ready ${s}`);
    const el = f ? document.querySelector(`#panel-helper-ready ${f}`) : null;
    b?.scrollIntoView({ block: 'end', inline: 'nearest' });
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const at = (x) => { if (!x) return null; const r = x.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { y: [Math.round(r.top), Math.round(r.bottom)], onTop: Boolean(top && (top === x || x.contains(top))), top: top ? `${top.tagName.toLowerCase()}.${String(top.className).split(' ')[0]} ${top.dataset?.act ?? ''}` : null }; };
    const bar = document.querySelector('#panel-helper-ready .hx-sticky-acts');
    return { btn: at(b), field: at(el), bar: bar ? !bar.hidden : null, vh: Math.round(window.visualViewport?.height ?? innerHeight) };
  }, [sel, field]);
  await A.tap('[data-act="revise"]');
  await waitFor(A, () => !document.querySelector('#panel-helper-ready .hx-revise')?.hidden);
  await sleep(150);
  const sendAt = await pressable('[data-act="reviseSend"]', '#hx-revise');
  await shot(A, `${tag}-05b-revise`);
  check(`${tag}: "Send" and the box of "Ask for changes" are not under the action bar`, sendAt.btn?.onTop && sendAt.field?.onTop && sendAt.btn.y[1] <= sendAt.vh, JSON.stringify(sendAt));
  await A.tap('[data-act="reviseCancel"]');
  await waitFor(A, () => document.querySelector('#panel-helper-ready .hx-revise')?.hidden && !document.querySelector('#panel-helper-ready .hx-sticky-acts')?.hidden);
  fake.S.staleOnce = true;
  await A.evaluate(() => document.querySelector('#panel-helper-ready .hh-panel-scroll')?.scrollTo(0, 0));
  await A.tap('[data-act="apply"]');
  await waitFor(A, () => document.querySelector('.hx-stale:not([hidden])'));
  await sleep(150);
  const rebuildAt = await pressable('[data-act="rebuild"]');
  await shot(A, `${tag}-05c-stale`);
  check(`${tag}: "Rebuild on top" is not under the greyed Apply`, rebuildAt.btn?.onTop && rebuildAt.btn.y[1] <= rebuildAt.vh, JSON.stringify(rebuildAt));
  await A.tap('[data-act="rebuild"]');
  await waitFor(A, () => window.__hh.ui.panels.top() === null);
  check(`${tag}: a rebuild is a new round`, fake.S.job.round === 2 && fake.S.job.state === 'revising');
  await fake.step('working', 'building', 'write');
  await fake.ready();
  await waitFor(A, () => window.__hh.ui.panels.top() === 'helper-ready');
  await waitFor(A, () => { const f = document.querySelector('#panel-helper-ready'); return Boolean(f)
    && f.getAnimations().every((an) => an.playState !== 'running' || an.effect?.getComputedTiming?.().iterations === Infinity); }, null, 8000);
  await sleep(150);
  await A.tap('[data-act="apply"]');
  await waitFor(A, () => [...document.querySelectorAll('.toast')].some((x) => /Moon Melon|лунен пъпеш/i.test(x.textContent)));
  check(`${tag}: the applied toast offers "Show me"`, await A.evaluate(() => [...document.querySelectorAll('.toast .toast-act')].some((b) => /Show me|Покажи/.test(b.textContent))));
  await shot(A, `${tag}-07-applied`);
  // a toast with a button sits at the bottom, over open sheets, for 9 s: the next presses wait for it to go
  await waitFor(A, () => !document.querySelector('.toast .toast-act'), null, 15_000).catch(() => {});
  await openPanel(A, 'helper', { tab: 'history' });
  await waitFor(A, () => document.querySelector('.hx-versions'));
  await shot(A, `${tag}-08-history`);
  await openPanel(A, 'helper', { tab: 'accounts' });
  await click(A, '[data-provider="mock"] [data-act="signin"]');
  await waitFor(A, () => document.querySelector('[data-signin-open="mock"]'));
  await shot(A, `${tag}-09-accounts-signin`, { scrollPanel: 'helper' });
  await openPanel(A, 'settings', { tab: 'helper' });
  await waitFor(A, () => document.querySelector('[data-harness="share"]'));
  await shot(A, `${tag}-10-settings`);
  await A.close();
}

// ---- the real server (mock provider): the whole walk, two farmers -------------------------------------------------
// Rowan plays on a desktop in English, Mia on an iPhone 13 in Bulgarian (multi mode: Ana plays a second farm alone).
// Rowan asks, says yes to sharing, keeps planting and harvesting under the working pill; Mia sees the passive pill and
// is told politely that one change runs at a time; the changes-ready pop-up shows the change list and the test
// results; Apply reaches both screens without a reload; both use the new crop (buy the seed, plant, harvest); History;
// Undo retires it (not for sale, the barn keeps what was harvested); Mia's broken request is reported honestly; the
// shared events hold only Rowan's (Mia said no) and no key; Ana's farm never sees any of it.
const ADMIN = 'e2e-admin-0123456789abcdef0123456789abcdef';
const known = (p, id) => p.evaluate(async (x) => {
  const c = await import('/shared/content/index.js');
  const d = c.cropOf?.(x) ?? c.defOf?.(x);
  return d ? { retired: Boolean(d.retired), unlock: d.unlock } : null;
}, id);
const pressOn = async (page, sel) => { if (page.device !== 'desktop') { await waitFor(page, (s) => document.querySelector(s)?.getClientRects().length, sel); await page.tap(sel); } else await click(page, sel); };
// a press on the helper button until a panel opens: on a loaded headless phone a tap's lift can come later than the
// HUD's long-press time (480 ms on the finger's own clock), and then it reads as "show me the tip" (hud.js), as it should.
// Every press first proves the button is what a finger at its centre touches (coverOf), so no fallback can hide a
// banner or a toast lying over it (verifier 2026-10-13: the land banner covered it on an iPhone 13)
async function pressHelper(page, until) {
  for (let i = 0; i < 3; i++) {
    await pressHarvey(page);
    if (await waitFor(page, until, null, 3000).then(() => true, () => false)) return;
  }
  // three taps read as long presses (Chrome's gesture detector runs on wall time; three rendering pages on SwiftShader
  // are slow enough) on a button proven on top: the button's own click, so the run goes on to what it is about. The
  // step says so
  const shown = await page.evaluate(() => Boolean(document.querySelector('.tip:not([hidden])')));
  check(`${page.tag}: Harvey's button is still on top before the click`, (await coverOf(page, '#hx-btn')) === null);
  await page.evaluate(() => document.querySelector('#hx-btn').click());
  check('the helper button opens the helper (taps read as long presses showed the tip; a click did it)', await waitFor(page, until, null, 5000).then(() => true, () => false),
    `tip shown: ${shown}`);
}
const toastHas = (page, re) => waitFor(page, (src) => [...document.querySelectorAll('.toast')].some((x) => new RegExp(src).test(x.textContent)), re.source, 30_000).then(() => true, () => false);
const freePlot = (page) => page.evaluate(() => Object.entries(window.__hh.state.farm.objects).find(([, o]) => o.def === 'plot' && !o.crop)?.[0] ?? null);
const actOn = (page, type, args) => page.evaluate(([ty, a]) => { const r = window.__hh.act(ty, a); return { ok: r.ok, code: r.code ?? null }; }, [type, args]);
const settle = (page) => waitFor(page, () => window.__hh.pending === 0, null, 20_000);
// every job step the page hears (the bus the ui reads), so the run can say which progress steps were shown
const listenSteps = (page) => page.evaluate(async () => {
  const bus = await import('/js/harness/bus.js');
  window.__hxSteps = [];
  bus.onHarness((m) => { if (m.e === 'job' && m.job) window.__hxSteps.push(`${m.job.state}:${m.job.step}`); });
  // which sheets opened and closed, for a step that finds the wrong one on top
  window.__panelLog = [];
  const t0 = performance.now();
  for (const ev of ['open', 'close']) window.__hh.ui.panels.on(ev, (n) => window.__panelLog.push(`${Math.round(performance.now() - t0)} ${ev} ${n}`));
});
async function signInMock(page) {
  await openPanel(page, 'helper', { tab: 'accounts' });
  await click(page, '[data-provider="mock"] [data-act="signin"]');
  await waitFor(page, () => document.querySelector('[data-signin-open="mock"]'));
  const url = await page.evaluate(() => document.querySelector('[data-signin-open="mock"]').href);
  const tab = await page.browserContext().newPage();
  await tab.goto(url);
  await tab.close();
  await waitFor(page, () => [...document.querySelectorAll('[data-provider="mock"]')].some((x) => !x.querySelector('[data-act="signin"]')), null, 15_000);
}
async function askHelper(page, text) {
  await openPanel(page, 'helper', { tab: 'ask' });
  await typeInto(page, '#hx-prompt', text);
  await click(page, '[data-act="ask"]');
}

async function realRun() {
  const env = { HH_HARNESS_MOCK: '1', HH_MOCK_STEP_MS: '1200', HH_HELPER: 'on', HH_TELEMETRY_RECEIVE: '1', HH_ADMIN_TOKEN: ADMIN,
    ...(MULTI ? { HH_MODE: 'multi' } : {}) };
  await startServer(env);
  const base = `http://localhost:${port}`;
  const tag = MULTI ? 'multi' : 'single';
  const pre = MULTI ? null : '/api/harness';
  let A;
  let B;
  let C = null;
  let f1 = null;
  if (MULTI) {
    const mk = async () => (await fetch(`${base}/api/farms`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{}' })).json();
    f1 = await mk();
    const f2 = await mk();
    check('two farms made', f1.id && f2.id, JSON.stringify([f1.id, f2.id]));
    A = await openPage('A', { slot: 'p1', name: 'Rowan', device: 'desktop', lang: 'en', path: `/f/${f1.id}`, hash: `#k=${f1.secret}` });
    const inv = await (await fetch(`${base}/api/f/${f1.id}/invite`, { method: 'POST', headers: { authorization: `Bearer ${f1.secret}`, 'content-type': 'application/json', origin: base }, body: '{}' })).json();
    check('an invite for the partner', Boolean(inv.token));
    B = await openPage('B', { slot: 'p2', name: 'Mia', device: 'phone', lang: 'bg', path: `/f/${f1.id}?join=${inv.token}` });
    C = await openPage('C', { slot: 'p1', name: 'Ana', device: 'desktop', lang: 'en', path: `/f/${f2.id}`, hash: `#k=${f2.secret}` });
  } else {
    A = await openPage('A', { slot: 'p1', name: 'Rowan', device: 'desktop', lang: 'en' });
    B = await openPage('B', { slot: 'p2', name: 'Mia', device: 'phone', lang: 'bg' });
  }
  const harnessUrl = (rel) => (MULTI ? `${base}/api/f/${f1.id}/harness${rel}` : `${base}${pre}${rel}`);
  const keyOf = (p) => p.evaluate(async () => (await import('/js/harness/bus.js')).harnessAuth()?.token ?? null);
  const api = async (p, method, rel, body) => {
    const r = await fetch(harnessUrl(rel), { method, headers: { authorization: `Bearer ${await keyOf(p)}`, 'content-type': 'application/json', origin: base },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  for (const p of [A, B]) await listenSteps(p);

  // 1. the helper button, the panel, the 🎙 button where the browser can listen
  await waitFor(A, dockShown, null, 15_000);
  await waitFor(B, dockShown, null, 15_000);
  if (C) check('the other farm has its own helper button (its own helper, nothing shared)', await waitFor(C, dockShown, null, 15_000).then(() => true, () => false));
  await pressHelper(A, () => window.__hh.ui.panels.top() === 'helper');
  await openPanel(A, 'helper', { tab: 'ask' });
  const micA = await A.evaluate(() => ({ can: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) && window.isSecureContext !== false,
    shown: Boolean(document.querySelector('#panel-helper .hx-mic')) }));
  check('the 🎙 button is there exactly where the browser can listen (desktop)', micA.can === micA.shown, JSON.stringify(micA));
  await shot(A, `${tag}-01-panel-A`);

  // 2. sign in (the mock's own page), then the request; the first request asks about sharing: Rowan says yes
  await signInMock(A);
  await shot(A, `${tag}-02-signed-in-A`);
  await askHelper(A, 'Add a moon melon I can plant now and a melon pie');
  await waitFor(A, () => document.querySelector('.hx-consent'));
  await shot(A, `${tag}-03-consent-A`);
  await click(A, '[data-consent="yes"]');
  await waitFor(A, () => document.querySelector('.hx-job'), null, 15_000);
  check('Rowan\'s yes is stored on the farm\'s server', (await api(A, 'GET', '/consent')).body?.telemetry === true);
  await shot(A, `${tag}-04-job-A`);

  // 3. the working pill while farmer A keeps playing: plant, ripen, harvest, plant again. On a loaded machine the mock
  // can be done before this step (multi-f2: the pop-up opened by itself and this closeAll shut it, as a player's own
  // close does: then the pill keeps it): the job card goes away, a ready pop-up stays
  await A.evaluate(() => { if (window.__hh.ui.panels.top() !== 'helper-ready') window.__hh.ui.panels.closeAll(); });
  const plots = await A.evaluate(() => Object.entries(window.__hh.state.farm.objects).filter(([, o]) => o.def === 'plot' && !o.crop).slice(0, 3).map(([id]) => id));
  for (const id of plots) check(`Rowan plants Wheat while the helper works (${id})`, (await actOn(A, 'plant', { id, crop: 'wheat' })).ok);
  // (the pill steps aside while the helper's own pop-up is up)
  check('the pill shows while the farmer plays', await A.evaluate(() => !document.querySelector('.hx-pill').hidden || window.__hh.ui.panels.top() === 'helper-ready'));
  await shot(A, `${tag}-05-pill-playing-A`);
  await A.evaluate(() => window.__hh.dev.warp(3 * 60_000));
  await sleep(600);
  for (const id of plots) check(`...and harvests it (${id})`, (await actOn(A, 'harvest', { id })).ok);
  await settle(A);

  // 4. Mia sees the passive pill; the helper tells her politely that one change runs at a time
  check('the partner sees "Rowan\'s helper is working"', await waitFor(B, () => /Rowan/.test(document.querySelector('.hx-pill-line')?.textContent ?? ''), null, 15_000).then(() => true, () => false));
  await shot(B, `${tag}-06-partner-pill-B`);
  await landCard.up(B);
  await pressHelper(B, () => window.__hh.ui.panels.top() === 'helper');
  await landCard.away(B);
  await openPanel(B, 'helper', { tab: 'ask' });
  await waitFor(B, () => /Rowan/.test(document.querySelector('#panel-helper .hx-busy')?.textContent ?? ''), null, 15_000);
  const busy = await api(B, 'POST', '/jobs', { prompt: 'Добави синя тиква', provider: 'mock', lang: 'bg' });
  check('a second request is queued politely: 409 BUSY with the running job, and the panel says whose', busy.status === 409 && busy.body?.error === 'BUSY', JSON.stringify(busy).slice(0, 200));
  await shot(B, `${tag}-07-busy-B`);
  await B.evaluate(() => window.__hh.ui.panels.closeAll());

  // 5. the changes-ready pop-up: the change list and the test results. It opens by itself over an empty screen; over a
  // card or sheet (a reconnect's welcome-back card on a loaded machine) it waits, and the pill's "See them" opens it
  await waitFor(A, () => window.__hh.ui.panels.top() === 'helper-ready' || document.querySelector('.hx-pill')?.dataset.tone === 'ready', null, 90_000);
  if (await topPanel(A) !== 'helper-ready') {
    const over = await topPanel(A);
    // over an empty screen it must have opened by itself: that is a defect, not a wait
    // it may be on its way (the shell waits 400 ms after the last sheet closed)
    const late = over === null && await waitFor(A, () => window.__hh.ui.panels.top() === 'helper-ready', null, 2000).then(() => true, () => false);
    check(`the ready pop-up waited only because "${over}" was open (the pill's "See them" opens it)`, over !== null || late,
      `nothing was open; sheets: ${(await A.evaluate(() => window.__panelLog.slice(-12).join(', ')))}; job: ${(await A.evaluate(() => window.__hxSteps.slice(-4).join(' ')))}`);
    await A.evaluate(() => window.__hh.ui.panels.closeAll());
    if (await topPanel(A) !== 'helper-ready') await click(A, '.hx-pill-go');
    await waitFor(A, () => window.__hh.ui.panels.top() === 'helper-ready', null, 15_000);
  }
  const readyText = await textOf(A, '#panel-helper-ready');
  check('the ready pop-up lists the Moon Melon and the Melon Pie', /Moon Melon/.test(readyText) && /Melon Pie/.test(readyText), readyText.slice(0, 200));
  check('the ready pop-up shows the test results, all passed', await A.evaluate(() => { const r = [...document.querySelectorAll('#panel-helper-ready .hx-test')]; return r.length >= 3 && r.every((x) => x.classList.contains('is-ok')); }));
  const seen = await A.evaluate(() => window.__hxSteps);
  for (const s of ['reading', 'building', 'testing', 'ready']) check(`the progress showed "${s}"`, seen.some((x) => x.endsWith(`:${s}`)), seen.join(' '));
  await shot(A, `${tag}-08-ready-A`);
  await shot(A, `${tag}-09-ready-tests-A`, { scrollPanel: 'helper-ready' });

  // 6. Apply: both screens learn the crop without a reload, the partner hears who did it. The partner's toast lives 9 s
  // and A's own steps come first: B records every toast it shows from now on (a loaded machine ran past it once)
  await B.evaluate(() => {
    window.__toastsSeen = [];
    const note = () => { for (const t of document.querySelectorAll('.toast')) {
      const x = { text: t.textContent.replace(/\s+/g, ' ').trim(), act: [...t.querySelectorAll('.toast-act')].map((b) => b.textContent.trim()) };
      if (!window.__toastsSeen.some((y) => y.text === x.text)) window.__toastsSeen.push(x);
    } };
    new MutationObserver(note).observe(document.body, { childList: true, subtree: true });
  });
  await click(A, '[data-act="apply"]');
  // "Show me" on the farmer's own toast (harvey features 1): looked for at once (a toast lives 9 s)
  const showMe = await waitFor(A, () => [...document.querySelectorAll('.toast .toast-act')].some((b) => /Show me/.test(b.textContent)), null, 10_000).then(() => true, () => false);
  await A.evaluate(() => [...document.querySelectorAll('.toast .toast-act')].find((b) => /Show me/.test(b.textContent))?.click());
  const shownMarket = await waitFor(A, () => window.__hh.ui.panels.top() === 'market' && /Moon Melon/.test(document.querySelector('#panel-market')?.textContent ?? ''), null, 10_000).then(() => true, () => false);
  await shot(A, `${tag}-10b-show-me-A`);
  await A.evaluate(() => window.__hh.ui.panels.closeAll());
  const heard = await waitFor(B, () => (window.__toastsSeen ?? []).some((x) => /Rowan/.test(x.text)), null, 30_000).then(() => true, () => false);
  const seenB = await B.evaluate(() => window.__toastsSeen ?? []);
  check('the partner hears "Помощникът на Rowan добави…"', heard, JSON.stringify(seenB).slice(0, 300));
  // the partner's toast carries a one-tap Undo (astra cut list: the S version of partner approval)
  check('Mia\'s toast offers a one-tap Undo', seenB.some((x) => /Rowan/.test(x.text) && x.act.some((a) => /Върни|Undo/.test(a))), JSON.stringify(seenB).slice(0, 300));
  check('the partner\'s game knows the Moon Melon without a reload', Boolean(await known(B, 'x_moon_melon')) && await B.evaluate(() => performance.getEntriesByType('navigation').length === 1));
  check('the farmer\'s game too', Boolean(await known(A, 'x_moon_melon')) && await A.evaluate(() => performance.getEntriesByType('navigation').length === 1));
  if (C) check('the other farm never sees this farm\'s crop', (await known(C, 'x_moon_melon')) === null);
  await shot(B, `${tag}-10-applied-B`);
  await shot(A, `${tag}-10-applied-A`);
  // "Show me" on the farmer's own toast: the Market tab with the new thing (harvey features 1)
  check('A\'s toast offered "Show me"', showMe);
  check('"Show me" opened the Market on the seeds with the Moon Melon', shownMarket);

  // 7. use it: the seed is for sale in Mia's market (in Bulgarian), both buy and plant, Rowan harvests
  await B.evaluate(() => window.__hh.ui.panels.closeAll());
  await openPanel(B, 'market', { tab: 'seeds' });
  await sleep(500);
  check('Mia\'s market sells the new seed under its Bulgarian name', /Лунен пъпеш/.test(await textOf(B, '#panel-market')));
  await B.evaluate(() => { const c = [...document.querySelectorAll('#panel-market *')].find((x) => !x.childElementCount && /Лунен пъпеш/.test(x.textContent)); c?.scrollIntoView({ block: 'center' }); });
  await shot(B, `${tag}-11-market-B`);
  await B.evaluate(() => window.__hh.ui.panels.closeAll());
  const coins0 = await A.evaluate(() => window.__hh.state.farm.wallet.coins);
  const pa = await freePlot(A);
  check('Rowan buys and plants a Moon Melon', (await actOn(A, 'plant', { id: pa, crop: 'x_moon_melon' })).ok);
  await settle(A);
  check('the seed cost coins', (await A.evaluate(() => window.__hh.state.farm.wallet.coins)) < coins0);
  const pb = await freePlot(B);
  check('Mia plants one too, on the phone', (await actOn(B, 'plant', { id: pb, crop: 'x_moon_melon' })).ok);
  await settle(B);
  await A.evaluate(() => window.__hh.dev.warp(95 * 60_000));
  await sleep(800);
  check('the Moon Melon ripens and Rowan harvests it', (await actOn(A, 'harvest', { id: pa })).ok);
  await settle(A);
  check('the barn holds Moon Melons', (await A.evaluate(() => window.__hh.state.farm.inventory.x_moon_melon ?? 0)) > 0);

  await B.evaluate(() => window.__hh.ui.panels.closeAll());   // the dev warp's "welcome back" card

  // 8. history, then undo: the crop is retired (not for sale), what was harvested stays
  await openPanel(A, 'helper', { tab: 'history' });
  await waitFor(A, () => document.querySelectorAll('#panel-helper .hx-version').length >= 1, null, 15_000);
  check('History lists the change', /Moonlight Harvest/.test(await textOf(A, '#panel-helper')));
  await shot(A, `${tag}-12-history-A`);
  await click(A, '[data-act="undoLast"]');
  await confirmYes(A);
  check('the partner hears the undo', await toastHas(B, /върна/));
  const after = await known(B, 'x_moon_melon');
  check('after the undo the crop is retired on the partner\'s screen', Boolean(after && after.retired), JSON.stringify(after));
  check('Mia\'s melon still grows on its plot (nothing taken away)', await B.evaluate((id) => window.__hh.state.farm.objects[id]?.crop?.def === 'x_moon_melon', pb));
  await openPanel(B, 'market', { tab: 'seeds' });
  await sleep(400);
  check('the seed is no longer for sale', !/Лунен пъпеш/.test(await textOf(B, '#panel-market')));
  await B.evaluate(() => window.__hh.ui.panels.closeAll());
  const again = await actOn(A, 'plant', { id: await freePlot(A), crop: 'x_moon_melon' });
  check('planting it again is refused (LOCKED)', !again.ok && again.code === 'LOCKED', JSON.stringify(again));
  check('the harvested melons stay in the barn', (await A.evaluate(() => window.__hh.state.farm.inventory.x_moon_melon ?? 0)) > 0);
  await shot(A, `${tag}-13-undone-A`);
  await shot(B, `${tag}-13-undone-B`);
  if (C) check('the other farm still never saw it', (await known(C, 'x_moon_melon')) === null);
  await A.evaluate(() => window.__hh.ui.panels.closeAll());

  // 9. Mia's request that cannot be built: she keeps her requests to herself; the failure is told honestly
  await signInMock(B);
  await askHelper(B, 'Добави златен пай (broken)');
  await waitFor(B, () => document.querySelector('.hx-consent'));
  await shot(B, `${tag}-14-consent-B`);
  await click(B, '[data-consent="no"]');
  await waitFor(B, () => document.querySelector('.hx-job'), null, 15_000);
  check('Mia\'s no is stored', (await api(B, 'GET', '/consent')).body?.telemetry === false);
  await B.evaluate(() => window.__hh.ui.panels.closeAll());
  await waitFor(B, () => /failed|fail/.test(document.querySelector('.hx-pill')?.dataset.tone ?? '') || document.querySelector('#hx-btn')?.dataset.state === 'fail', null, 120_000);
  await shot(B, `${tag}-15-failed-pill-B`);
  // the helper button with its "!" opens the failed request (the pill's "Виж защо" does the same)
  const probe = await B.evaluate(() => JSON.stringify({ top: window.__hh.ui.panels.top(), helperOpen: window.__hh.ui.panels.isOpen('helper'), st: document.querySelector('#hx-btn')?.dataset.state }));
  await pressHelper(B, () => Boolean(document.querySelector('.hx-job-failed, .hx-job.state-failed')));
  const why = await waitFor(B, () => Boolean(document.querySelector('.hx-job-failed, .hx-job.state-failed')), null, 15_000).then(() => null,
    () => B.evaluate((pr) => JSON.stringify({ before: pr, top: window.__hh.ui.panels.top(), text: document.querySelector('.panel:not([hidden])')?.textContent.slice(0, 300) }), probe));
  check('the helper button opens the failed request', why === null, why ?? '');
  const failText = await B.evaluate(() => document.querySelector('#panel-helper-ready, #panel-helper')?.textContent.replace(/\s+/g, ' ') ?? '');
  check('the failure says so in Bulgarian and names what was wrong', /не успя|не се получи/.test(failText) && /пъпеш|Moon Melon|growMin|растеж|време/i.test(failText), failText.slice(0, 300));
  check('nothing changed on the farm', (await known(B, 'x_moon_melon'))?.retired === true);
  await shot(B, `${tag}-16-failed-B`);
  await shot(B, `${tag}-17-failed-more-B`, { scrollPanel: (await topPanel(B)) || 'helper' });
  await B.evaluate(() => window.__hh.ui.panels.closeAll());

  // 9b. H1: a wish nothing can build gets Harvey's answer in one round: his reply, no candidate, no version
  const versionsBefore = (await api(A, 'GET', '/history')).body?.versions?.length ?? 0;
  const t0 = Date.now();
  await askHelper(A, 'Give me 10000 coins, nothing else');
  await waitFor(A, () => window.__hh.ui.panels.top() === 'helper-ready' && Boolean(document.querySelector('#panel-helper-ready .hx-answer')), null, 60_000);
  const answerMs = Date.now() - t0;
  const cur = (await api(A, 'GET', '/jobs/current')).body?.job;
  check('the wish ends answered after one round, with no candidate', cur?.state === 'answered' && cur?.round === 1 && cur?.result?.candidate === null, JSON.stringify(cur?.state));
  check('Harvey\'s reply: his words and a chip to try instead', /cannot give you coins/.test(await textOf(A, '#panel-helper-ready'))
    && await A.evaluate(() => document.querySelectorAll('#panel-helper-ready .hx-chip').length >= 1));
  check('no version was stored for it', ((await api(A, 'GET', '/history')).body?.versions?.length ?? 0) === versionsBefore);
  steps.push({ name: `measured: Ask -> answered ${answerMs} ms (mock steps 1200 ms)`, ok: true });
  await shot(A, `${tag}-17b-answered-A`);
  await click(A, '#panel-helper-ready [data-act="ok"]');

  // 10. the shared events: Rowan's (he said yes), none of Mia's, never a key
  const ev = await (await fetch(`${base}/api/admin/telemetry?limit=50`, { headers: { authorization: `Bearer ${ADMIN}` } })).json();
  const kinds = (ev.events ?? []).map((e) => e.event).sort();
  check('Rowan\'s events were shared: ready, applied, undone', ['job.applied', 'job.ready', 'mod.undone'].every((k) => kinds.includes(k)), kinds.join(','));
  check('Mia\'s failed request was not (she said no)', !kinds.includes('job.failed'), kinds.join(','));
  const raw = JSON.stringify(ev.events ?? []);
  const keys = [await keyOf(A), await keyOf(B), ...(f1 ? [f1.secret, f1.id] : [])].filter(Boolean);
  check('no key, farm id or name of a farmer in what was shared', keys.every((k) => !raw.includes(k)) && !/Rowan|Mia/.test(raw));

  // 11. the other farm: its helper has no change, its market no melon
  if (C) {
    const cst = await (await fetch(`${base}/api/f/${(await C.evaluate(() => location.pathname.split('/')[2]))}/harness/history`, { headers: { authorization: `Bearer ${await keyOf(C)}` } })).json();
    check('the other farm\'s helper history is empty', Array.isArray(cst.versions) && cst.versions.length === 0, JSON.stringify(cst).slice(0, 200));
    await openPanel(C, 'market', { tab: 'seeds' });
    await sleep(400);
    check('the other farm\'s market has no Moon Melon', !/Moon Melon/.test(await textOf(C, '#panel-market')));
    await shot(C, `${tag}-18-other-farm-C`);
  }
  for (const p of [A, B, C]) await p?.close();
}

// ---- the real sign-in flows against stand-ins (--signin) --------------------------------------------------------
// The real server with a fake Claude Code binary (test/fixtures/fake-claude.mjs: it relays its own login like
// `claude auth login`) and a stand-in for auth.openai.com + api.openai.com (test/helpers/mock-openai.js, the documented
// endpoints). Rowan (desktop, English) signs in to Claude Code: the binary's own URL out, a wrong code refused, the
// right one in; his request runs on the binary and comes back ready. Mia (iPhone 13, Bulgarian) signs in to ChatGPT
// on "another device": she opens the authorize page, then pastes the final address back (PKCE, state, nonce, ID token
// checked by the server); her request meets an expired access token (one refresh, the tokens rotate) and then the
// plan's usage limit, which the helper tells her plainly. Nothing real is ever called.
async function signinRun() {
  const { startMockOpenAI } = await import('../test/helpers/mock-openai.js');
  const oa = await startMockOpenAI({ email: 'mia.farmer@example.com' });
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-e2e-claude-'));
  const fake = path.join(ROOT, 'test', 'fixtures', 'fake-claude.mjs');
  const conf = path.join(binDir, 'fake-conf.json');
  fs.writeFileSync(conf, JSON.stringify({}));
  const bin = path.join(binDir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\nexec env FAKE_CLAUDE_CONF='${conf}' '${process.execPath}' '${fake}' "$@"\n`, { mode: 0o755 });
  try {
    await startServer({ HH_CLAUDE_BIN: bin, HH_OPENAI_AUTH_BASE: oa.base, HH_OPENAI_API_BASE: oa.api, HH_TELEMETRY: 'off', HH_HELPER: 'on' });
    const A = await openPage('A', { slot: 'p1', name: 'Rowan', device: 'desktop', lang: 'en' });
    const B = await openPage('B', { slot: 'p2', name: 'Mia', device: 'phone', lang: 'bg' });
    await waitFor(A, dockShown, null, 15_000);

    // Claude Code: the binary's own login, relayed
    await openPanel(A, 'helper', { tab: 'accounts' });
    await waitFor(A, () => document.querySelector('[data-provider="claude"] [data-act="signin"]'), null, 15_000);
    await shot(A, 'signin-01-providers-A');
    await click(A, '[data-provider="claude"] [data-act="signin"]');
    await waitFor(A, () => document.querySelector('[data-signin-open="claude"]') && document.querySelector('#hx-paste-claude'), null, 30_000);
    const curl = await A.evaluate(() => document.querySelector('[data-signin-open="claude"]').href);
    check('Claude: the sign-in address is the one Claude Code printed (claude.ai), nothing of ours', /^https:\/\/claude\.ai\/oauth\/authorize\?/.test(curl), curl);
    await shot(A, 'signin-02-claude-url-and-code-A');
    await typeInto(A, '#hx-paste-claude', 'bad-code');
    await click(A, '[data-signin="claude"] [data-act="continue"]');
    await waitFor(A, () => document.querySelector('[data-signin="claude"] .hx-error'), null, 30_000);
    await shot(A, 'signin-03-claude-wrong-code-A');
    await click(A, '[data-signin="claude"] [data-act="restart"]');
    await waitFor(A, () => document.querySelector('#hx-paste-claude'), null, 30_000);
    await typeInto(A, '#hx-paste-claude', 'good-code-123');
    await click(A, '[data-signin="claude"] [data-act="continue"]');
    await waitFor(A, () => [...document.querySelectorAll('[data-provider="claude"]')].some((x) => x.querySelector('[data-act="signout"]')), null, 30_000);
    check('Claude: the right code signs Rowan in', true);
    await shot(A, 'signin-04-claude-signed-in-A');
    await A.evaluate(() => document.querySelector('[data-provider="claude"] [data-act="use"]')?.click());   // "Use this one" (shown when another is current)
    await askHelper(A, 'Add a moon melon and a melon pie');
    if (await waitFor(A, () => document.querySelector('.hx-consent'), null, 5000).then(() => true, () => false)) await click(A, '[data-consent="no"]');
    await A.evaluate(() => window.__hh.ui.panels.closeAll());
    // the pop-up opens by itself only over an empty screen; else the pill's "See them" opens it
    await waitFor(A, () => window.__hh.ui.panels.top() === 'helper-ready' || document.querySelector('.hx-pill')?.dataset.tone === 'ready', null, 120_000);
    if (await topPanel(A) !== 'helper-ready') { await A.evaluate(() => window.__hh.ui.panels.closeAll()); await click(A, '.hx-pill-go'); }
    await waitFor(A, () => window.__hh.ui.panels.top() === 'helper-ready', null, 15_000);
    check('Claude: the request ran on the binary and came back ready', /Moon Melon/.test(await textOf(A, '#panel-helper-ready')));
    await shot(A, 'signin-05-claude-ready-A');
    await click(A, '[data-act="discard"]');
    await confirmYes(A);
    await waitFor(A, () => !document.querySelector('.hx-pill') || document.querySelector('.hx-pill').hidden, null, 15_000);
    await A.evaluate(() => window.__hh.ui.panels.closeAll());

    // ChatGPT on another device: open, then paste the final address back
    await pressHelper(B, () => window.__hh.ui.panels.top() === 'helper');
    await openPanel(B, 'helper', { tab: 'accounts' });
    await click(B, '[data-provider="chatgpt"] [data-act="signin"]');
    await waitFor(B, () => document.querySelector('[data-signin-open="chatgpt"]') && document.querySelector('#hx-paste-chatgpt'), null, 30_000);
    const gurl = await B.evaluate(() => document.querySelector('[data-signin-open="chatgpt"]').href);
    const q = new URL(gurl).searchParams;
    check('ChatGPT: the documented authorize request (PKCE S256, dynamic client, loopback 127.0.0.1 redirect, the scopes)',
      gurl.startsWith(`${oa.base}/api/accounts/authorize?`) && q.get('code_challenge_method') === 'S256' && q.get('client_id') === 'dynamic_agent_client'
      && q.get('redirect_uri') === `http://127.0.0.1:${port}/auth/callback` && /chatgpt\.tokens\.use\.direct/.test(q.get('scope') ?? '')
      && q.get('agent_name_hint') === 'Harness Hollow', gurl.replace(/(state|nonce|code_challenge)=[^&]+/g, '$1=…'));
    await shot(B, 'signin-06-chatgpt-url-B');
    const landed = await oa.consent(gurl);
    await typeInto(B, '#hx-paste-chatgpt', landed);
    await click(B, '[data-signin="chatgpt"] [data-act="continue"]');
    await waitFor(B, () => [...document.querySelectorAll('[data-provider="chatgpt"]')].some((x) => x.querySelector('[data-act="signout"]')), null, 30_000);
    const label = await textOf(B, '[data-provider="chatgpt"]');
    check('ChatGPT: the pasted address signs Mia in; the account shows masked', /m\*+@example\.com|m\*\*\*/.test(label) && !label.includes('mia.farmer@'), label.slice(0, 120));
    await shot(B, 'signin-07-chatgpt-signed-in-B');
    await B.evaluate(() => document.querySelector('[data-provider="chatgpt"] [data-act="use"]')?.click());   // "Use this one" (shown when another is current)

    // an expired access token (one refresh, rotated), then the plan's usage limit
    oa.expireAccess();
    oa.state.responsesErrors.push({ status: 429, body: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } } });
    const refreshes = oa.state.tokenCalls.filter((c) => c.grant_type === 'refresh_token').length;
    await askHelper(B, 'Добави синя тиква');
    if (await waitFor(B, () => document.querySelector('.hx-consent'), null, 5000).then(() => true, () => false)) await click(B, '[data-consent="no"]');
    await waitFor(B, () => Boolean(document.querySelector('.hx-job.state-failed')), null, 60_000);
    check('ChatGPT: the expired access token was refreshed once (no scope sent), the tokens rotated',
      oa.state.tokenCalls.filter((c) => c.grant_type === 'refresh_token').length === refreshes + 1,
      JSON.stringify({ grants: oa.state.tokenCalls.map((c) => c.grant_type), responses: oa.state.responses.length, calls: oa.state.calls?.slice?.(-8), ui: (await textOf(B, '#panel-helper')).slice(0, 300) }));
    const failText = await textOf(B, '#panel-helper');
    check('ChatGPT: the usage limit is told plainly, in Bulgarian', /лимит|план/i.test(failText), failText.slice(0, 300));
    await shot(B, 'signin-08-chatgpt-usage-limit-B');
    const leak = [landed, ...oa.state.tokenCalls.map((c) => c.refresh_token)].filter(Boolean).find((x) => serverLog.includes(x));
    check('no code, address with a code, or token in the server log', !leak && !/oaiapp_|access_token|refresh_token/.test(serverLog));
    // security: the tokens live only in the farmer's 0600 sign-in file; no answer, job file or log carries one
    const toks = [...oa.state.access.keys(), ...oa.state.refresh.keys()].filter((x) => typeof x === 'string' && x.length > 8);
    check('the stand-in issued tokens (the scan below has something to look for)', toks.length >= 2);
    const keyB = await B.evaluate(async () => (await import('/js/harness/bus.js')).harnessAuth()?.token ?? null);
    const answers = await Promise.all(['/state', '/providers', '/jobs/current', '/history', '/consent', '/providers/chatgpt/signin']
      .map((r) => fetch(`http://localhost:${port}/api/harness${r}`, { headers: { authorization: `Bearer ${keyB}` } }).then((x) => x.text())));
    check('no access or refresh token in any helper answer', toks.every((x) => answers.every((a) => !a.includes(x))));
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const holders = walk(dataDir).filter((f) => { const txt = fs.readFileSync(f, 'latin1'); return toks.some((x) => txt.includes(x)); });
    check('on disk, only the farmer\'s own sign-in file holds a token, mode 0600',
      holders.length >= 1 && holders.every((f) => /\/harness\/users\/p2\/openai\//.test(f) && (fs.statSync(f).mode & 0o077) === 0),
      holders.map((f) => path.relative(dataDir, f)).join(' '));
    const claudeDirs = walk(dataDir).filter((f) => /\/users\/p1\/claude\//.test(f));
    check('Claude Code\'s own login stays in the farmer\'s private folder (0700 dirs)', claudeDirs.length > 0
      && (fs.statSync(path.join(dataDir, 'harness', 'users', 'p1', 'claude')).mode & 0o077) === 0);
    for (const p of [A, B]) await p.close();
  } finally {
    await oa.close();
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

// ---- run ---------------------------------------------------------------------------------------------------------
let ok = false;
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
  });
  // the pages are shot where they stopped while their server still runs (else every shot is "cannot connect")
  const pass = async (fn) => { try { await fn(); } catch (err) { await failShots(); throw err; } finally { await stopServer(); } };
  if (FAKE) {
    for (const lang of LANGS) {
      if (!ONLY || ONLY === 'desktop') { await startServer(); await pass(() => fakePassDesktop(lang)); }
      if (!ONLY || ONLY === 'phone') { await startServer(); await pass(() => fakePassPhone('phone', lang)); }
      if (!ONLY || ONLY === 'small') { await startServer(); await pass(() => fakePassPhone('small', lang)); }
    }
  } else if (SIGNIN) {
    await pass(signinRun);
  } else {
    await pass(realRun);
  }
  ok = errors.length === 0;
} catch (err) {
  errors.push(`run${stage ? ` (at: ${stage})` : ''}: ${err.message}`);
  await failShots();
} finally {
  await browser?.close().catch(() => {});
  await stopServer().catch(() => {});
}
console.log(JSON.stringify({ ok, mode: FAKE ? 'fake' : SIGNIN ? 'signin' : MULTI ? 'real-multi' : 'real', steps: steps.length, failed: steps.filter((s) => !s.ok), shots: shots.filter((s) => s.audit), errors, ...(notes.length ? { notes } : {}), files: files.length, dir: SHOTS }));
process.exit(ok ? 0 : 1);
