// The in-game helper of Harness Hollow, player side (ui lane; docs/agent-notes/harness-contract.md). The player types or
// speaks an idea, a small pill shows the helper working while the game goes on, and a pop-up shows the tested changes
// with Apply / Ask for changes / Discard. History with undo, the sign-in screens of each provider (the player's own
// plan, never an API key), the one-time consent question and Settings › Helper live here too.
//
//   createHarnessUi(S, opts?) -> helper          S: the ui context ({ ui, store, settings, ... }, ui/index.js)
//     helper.enabled() -> bool                   the server offers the helper (GET .../state enabled: true)
//     helper.connect({ force? }) -> Promise       start talking to the server's helper. Automatic after the first
//                                                welcome when the build has the harness bus (ui/harness/link.js);
//                                                `force` skips that check (tools/e2e-harness.mjs --fake)
//     helper.refresh() -> Promise                 GET .../state again
//     helper.receive(msg)                         one harness-bus message ({ t: 'hx', e: 'job' | 'applied' | 'undone' |
//                                                'suspended' | 'signin', ... } or { e: 'content', n, changed })
//     helper.open(tab?) / helper.openReady()      the helper panel ('ask' | 'history' | 'accounts') / the ready pop-up
//     helper.settingsRows(ctx) -> Element[]       Settings › Helper (ui/settings.js shows the tab when enabled())
//     helper.tile(closeSheet) -> Element | null    the phone farm menu's tile (ui/layout.js), null while the helper is off
//     helper.snapshot() -> plain copy of the state (tests and tools)
//     helper.destroy()
//   opts (tests and tools): { api, bus, overlayApi, scope, session, win, doc, pollMs, signInPollMs, fallbackMs, force }
//
// Panels it registers: 'helper' (side; tabs ask · history · accounts), 'helper-ready' (wide, modal: the changes-ready
// pop-up, or what went wrong), 'helper-letter' (card: a letter a change brought, once per farmer).
// The helper button sits at the top of the right edge column (#hud-right), its pill to its left; both are hidden until
// the server says the helper is on. Nothing is requested before that, and nothing at all in a build without the harness.
// Release 1.0 (harvey lane): Harvey's answer (`answered`: his words, the chip row, OK) instead of a failure for a wish
// that cannot be built; the failure view leads with his words and "Change my wish"; the change list says everything
// (looks, letters, speed, season, workshop, "From level 33 (your farm is 21)"); the first run starts no sign-in the
// player did not choose; one row of at most 3 chips under the box; "Show me" on the applied toast and the letter; a
// one-tap Undo on the partner's toast; elapsed time on the pill; a visible "Harvey" on the button.
// Owner 2026-10-19: Settings › Harvey "Show Harvey" (ui/settings.js `showHarvey`, per device, on by default): off hides
// the button and the pill on this device at once (Harvey keeps working for the partner; their applied change still
// reaches the feed and the toast). On a phone the pill is a small chip in the edge lane under the column (harness.css):
// the picture and the time so far (.hx-pill-short); a tap opens Harvey with the whole card, as the pill's tap does.
// the helper's own words register first (i18n/harness.js): this module loads on demand (ui/harness/boot.js)
import '../../i18n/harness.js';
import { h, kv } from '../dom.js';
import { farm, session as farmSession } from '../../net/farm.js';
import { t, lang, onLang, list, fmtDate } from '../../i18n/index.js';
import { name as contentName } from '../../i18n/names.js';
import { createHarnessApi, harnessBase, unwrapSignIn } from '../../harness/api.js';
import { PRIVACY_PATH, PRIVACY_MD_URL } from '../../front/links.js';
import { loadBus, loadOverlayApi, farmerKey } from './link.js';
import { createDictation, createReader } from './voice.js';
import { glyph } from './glyphs.js';
import * as M from './model.js';
import * as V from './views.js';
import { levelFromXp } from '../../../../shared/content/index.js';
import { seasonOf } from '../../../../shared/rules/calendar.js';
import { upgradeBonus } from '../../../../shared/rules/upgrades.js';
import { fmtDuration } from '../dom.js';

const SIGNIN_CODES = new Set(['DENIED', 'EXPIRED', 'BAD_CODE', 'STATE', 'USAGE_LIMIT', 'UNAVAILABLE', 'INTERNAL']);
/** History's own line for a refused undo to version {n} (QA r2 H2-02). */
const UNDO_ERR = { DAMAGED: 'harness.hist.damaged', INVALID: 'harness.hist.noFit' };

/** A tiny event source the panels subscribe to through ctx.on(target, 'change', fn). */
function emitter() {
  const subs = new Map();
  return {
    on(ev, fn) { if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev).add(fn); return () => subs.get(ev)?.delete(fn); },
    emit(ev, ...a) { for (const fn of [...(subs.get(ev) ?? [])]) { try { fn(...a); } catch (err) { console.error('helper listener failed', err); } } },
  };
}

/** How to find the focused element again after a rebuild: its id, its action, or the card it is. */
function focusKey(a) {
  if (a.id) return `#${a.id}`;
  for (const k of ['act', 'consent', 'signinOpen']) {
    if (a.dataset?.[k]) return `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${a.dataset[k]}"]`;
  }
  for (const c of ['hx-job', 'hx-consent', 'hx-signin']) if (a.classList?.contains(c)) return `.${c}`;
  return null;
}

/** A section that rebuilds only when its key changes (a poll that changes nothing never wipes a half-typed field). */
function section(tag, keyOf, build) {
  const el = h(tag);
  let last = null;
  return {
    el,
    update(force = false) {
      const k = keyOf();
      if (!force && k === last) return;
      last = k;
      // what the player typed and where the focus was survive the rebuild (a pasted code while another card changes)
      const kept = new Map([...el.querySelectorAll('input[id], textarea[id]')].map((x) => [x.id, x.value]));
      const active = globalThis.document?.activeElement;
      // a step that rebuilds the card under a keyboard player's focus puts it back on the same button (or card)
      const focusSel = active && el.contains(active) ? focusKey(active) : null;
      const out = build();
      el.replaceChildren(...(Array.isArray(out) ? out : [out]).filter(Boolean));
      el.hidden = !el.childNodes.length;
      for (const [id, v] of kept) {
        const x = el.querySelector(`#${id}`);
        if (x && !x.value && v) x.value = v;
      }
      if (focusSel) el.querySelector(focusSel)?.focus?.({ preventScroll: true });
    },
  };
}

export function createHarnessUi(S, opts = {}) {
  const { ui, store } = S;
  const scope = opts.scope ?? farm;
  const sess = opts.session ?? farmSession;
  const win = opts.win ?? globalThis;
  const doc = opts.doc ?? globalThis.document;
  const POLL_MS = opts.pollMs ?? 5000;
  const SIGNIN_POLL_MS = opts.signInPollMs ?? 2500;
  const FALLBACK_MS = opts.fallbackMs ?? 2500;
  const SIGNED_IN_MS = opts.signedInMs ?? 1500;     // "Signed in to …" on screen before the tab goes back to Ask (H3-08)
  let bus = opts.bus ?? null;
  let overlayApi = opts.overlayApi ?? null;
  const api = opts.api ?? createHarnessApi({ base: harnessBase(scope), auth: () => farmerKey({ bus, scope, session: sess, pid: store.pid }) });
  const dictation = createDictation({ win });
  const reader = createReader({ win });
  const events = emitter();

  const st = {
    phase: 'idle',            // 'idle' | 'starting' | 'nobus' | 'live'
    enabled: false,
    loaded: false,
    providers: [],
    job: null,
    active: null,
    consent: { telemetry: null, sending: false, install: null },
    limits: null,
    history: null,            // null | 'loading' | 'failed' | { active, versions }
    signins: {},              // provider -> SignInState of a sign-in started here
    models: {},               // provider -> [{ id, label }]
    busy: {},                 // start apply revise discard cancel undo consent signin
    flash: null,              // { key, params?, tone? }: a line in the panel (the outcome of the last press)
    readyFlash: null,
    histFlash: null,
    pendingConsent: null,     // a request waiting for the consent answer
    pendingAsk: null,         // a request waiting for a sign-in
    stale: false,             // apply answered STALE: offer "rebuild on top"
    draft: '',
    lastAnswer: null,         // the summary of Harvey's last answer to this farmer ({ try } feeds the chip row)
    lastAsked: null,          // the wish that answer was for (the chip row never suggests it again: QA r1 H-15)
    lastAdded: null,          // the first thing the last applied change added ({ id, family, building?, n }): "Show me"
    expired: null,            // the plan whose sign-in ran out under an Ask (its card says so: QA r2 H2-C1)
    signinFromAsk: false,     // the Sign-in tab was opened from Ask's "Sign in first" (QA r3 H3-08: back to Ask after)
  };
  let helperTab = null;       // the helper panel's tab on screen ('ask' | 'history' | 'accounts'), null while closed
  const prefs = { provider: null, model: null, ...(kv.get(M.prefsKey(scope), {}) || {}) };
  const savePrefs = () => kv.set(M.prefsKey(scope), { provider: prefs.provider, model: prefs.model, asked: Boolean(prefs.asked),
    seen: Array.isArray(prefs.seen) ? prefs.seen.slice(-20) : [] });
  const readyShown = new Set();     // '<job id>:<round>': the pop-up opened by itself once per ready round
  // failed jobs and Harvey's answers the player said OK to (this device remembers the last 20: a reload never brings
  // back a reply already read)
  const dismissed = new Set(Array.isArray(prefs.seen) ? prefs.seen.filter((x) => typeof x === 'string') : []);
  const heard = new Set();          // 'a<n>' / 'u<n>': toasts already said for that version
  let pillHidden = null;            // '<job id>:<tone>': the player hid the pill for this job and tone
  let lastJobAt = 0;
  let pollT = 0;
  const signinPolls = new Map();
  let wantReady = false;            // a ready round waits for the open panels to close
  let wantLetter = false;
  let letterOpen = null;            // the id of the letter on screen (read once its farmer closes it: QA r2 H2-04)
  let letterClosing = null;         // the one just closed, until a microtask says whether another sheet took its place
  let lettersN = null;              // the version whose letters the last content push brought
  let offBus = null;
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };

  const me = () => store.pid;
  /** Settings › Harvey "Show Harvey" (per device; ui/settings.js): a player who does not want him hides his button. */
  const shown = () => S.settings?.get?.()?.showHarvey !== false;
  /** The farm's clock (the server's, as the store keeps it). */
  const farmNow = () => (typeof store.now === 'function' ? store.now() : Date.now());
  /**
   * The farm's level, season and Market Stand bonus (the change list's "From level 33 (your farm is 21)", its season line,
   * and a sell price as the Market says it: QA r3 H3-07, the upgraded stand's 1 %).
   */
  const farmCtx = () => {
    const s0 = store.state;
    let level = null;
    let season = null;
    let sellBp = 0;
    try { level = Number.isFinite(s0?.farm?.xp) ? levelFromXp(s0.farm.xp) : null; } catch { level = null; }
    try { season = s0?.meta ? seasonOf(farmNow(), s0.meta.tz) : null; } catch { season = null; }
    try { sellBp = s0?.farm?.objects ? upgradeBonus(s0, 'sellBp') : 0; } catch { sellBp = 0; }
    return { level, season, sellBp };
  };
  /** A touch screen: the keyboard comes with the player's tap, never by itself (ux-phone#6). */
  const touch = () => Boolean(win.matchMedia?.('(pointer: coarse)')?.matches);
  /** The privacy note's helper section: this site's page in multi mode, the repo's PRIVACY.md for a self-hosted farm. */
  const privacyHref = () => (scope.multi ? `${PRIVACY_PATH}#${lang() === 'bg' ? 'bg' : 'en'}-helper` : `${PRIVACY_MD_URL}#the-in-game-helper`);
  const players = () => store.state?.players ?? {};
  const nameOf = (pid) => (pid && players()[pid] && typeof players()[pid].name === 'string' ? players()[pid].name : null);
  const changed = () => { events.emit('change'); renderDock(); };
  const providerOf = (id) => st.providers.find((p) => p.id === id) ?? null;
  const currentProvider = () => M.chooseProvider(st.providers, prefs.provider);
  const isMineOpen = () => Boolean(st.job && st.job.by === me() && M.OPEN.has(st.job.state));

  // ---- the button and the pill --------------------------------------------------------------------------------
  const btnLabel = h('span.sr-only');
  const btnDot = h('span.hx-btn-dot', { 'aria-hidden': 'true', hidden: true });
  // H4 (harvey#7): a visible "Harvey" under the wand, like the labelled buttons around it (one tap target)
  const btnCap = h('span.hx-btn-cap', { 'aria-hidden': 'true' }, t('harness.btn.caption'));
  const btn = h('button.edge-btn.hx-btn#hx-btn', {
    type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'panel-helper', dataset: { state: 'idle' },
    on: { click: () => onButton() },
  }, glyph('helper', 30), btnCap, h('span.hx-btn-ring', { 'aria-hidden': 'true' }), btnDot, btnLabel);
  const pillIco = h('span.hx-pill-ico', { 'aria-hidden': 'true' });
  const pillLine = h('span.hx-pill-line');
  const pillTime = h('span.hx-pill-time', { hidden: true });
  // the phone's chip says only the time so far ("25s", "2m"): the sentence above is the desktop pill's (harness.css)
  const pillShort = h('span.hx-pill-short', { hidden: true });
  const pillGo = h('span.hx-pill-go', { hidden: true });
  const pillDots = h('span.hx-pill-dots', { 'aria-hidden': 'true' }, M.STEPS.map(() => h('i')));
  const pillMain = h('button.hx-pill-main', { type: 'button', on: { click: () => onPill() } },
    pillIco, h('span.hx-pill-text', h('b.hx-pill-title', t('harness.pill.title')), pillLine, pillTime), pillShort, pillDots, pillGo);
  const pillX = h('button.hx-pill-x', { type: 'button', on: { click: () => hidePill() } }, glyph('down', 18));
  const pill = h('div.hx-pill', { hidden: true, dataset: { tone: '' } }, pillMain, pillX);
  const live = h('div.sr-only.hx-live', { role: 'status', 'aria-live': 'polite' });
  const dock = h('div.hx-dock#hx-dock', { hidden: true }, btn, pill, live);
  const gap = h('div.edge-gap.hx-gap', { hidden: true });
  let lastSaid = '';

  function mountDock() {
    if (dock.parentNode) return;
    const edge = doc?.getElementById?.('hud-right');
    if (edge) { edge.prepend(dock, gap); return; }
    dock.classList.add('hx-dock--float');
    (doc?.getElementById?.('hud') ?? doc?.body)?.append(dock);
  }

  function pillText(p) {
    if (!p) return '';
    const job = st.job;
    if (p.tone === 'partner' || p.tone === 'partnerReady') {
      const n = nameOf(job?.by);
      return n ? t(p.key, { name: n }) : t('harness.pill.someone');
    }
    return t(p.key);
  }

  /** What the button (and the farm menu's tile) says: its state 'idle' | 'work' | 'ready' | 'fail' | 'partner' and words. */
  function buttonState() {
    const job = st.job;
    const p = M.pillOf(job, me());
    const state = !p ? 'idle' : p.tone === 'work' || p.tone === 'signin' ? 'work' : p.tone === 'ready' ? 'ready' : p.tone === 'fail' ? 'fail'
      : p.tone === 'answered' ? 'answered' : 'partner';
    // QA r1 H-16: the partner's ready changes are ready, not "working" (the button's name for a screen reader)
    const partnerKey = p?.tone === 'partnerReady' ? 'harness.btn.partnerReady' : 'harness.btn.partner';
    const label = state === 'work' ? t('harness.btn.working') : state === 'ready' ? t('harness.btn.ready') : state === 'fail' ? t('harness.btn.failed')
      : state === 'answered' ? t('harness.btn.answered')
        : state === 'partner' && nameOf(job?.by) ? t(partnerKey, { name: nameOf(job.by) }) : t('harness.btn.tip');
    return { p, state, label };
  }

  /** The phone farm menu's tile (ui/layout.js, beside the ideas tile); null while the server does not offer the helper. */
  function tile(closeSheet) {
    if (!st.enabled || !shown()) return null;
    const { state, label } = buttonState();
    const dot = state === 'ready' || state === 'fail' ? h('span.hx-tile-dot', { 'aria-hidden': 'true' }, state === 'fail' ? '!' : '') : null;
    return h('button.m-tile.hx-tile', { type: 'button', 'aria-label': label, dataset: { harness: 'open', state }, on: { click: () => { closeSheet?.(); onButton(); } } },
      h('span.m-ico', glyph('helper', 30), dot), h('span.lbl', t('harness.btn.label')));
  }

  function renderDock() {
    if (!st.enabled || !shown()) { dock.hidden = true; gap.hidden = true; tickWhile(false); return; }
    mountDock();
    dock.hidden = false;
    gap.hidden = false;
    const job = st.job;
    const { p, state: btnState, label } = buttonState();
    const tone = p ? p.tone : 'idle';
    btn.dataset.state = btnState;
    btn.setAttribute('aria-label', label);
    btn.dataset.tip = label;
    btn.dataset.tipTouch = t('harness.btn.label');
    btnDot.hidden = !(btnState === 'ready' || btnState === 'fail' || btnState === 'answered');
    btnCap.textContent = t('harness.btn.caption');
    btnDot.textContent = btnState === 'fail' ? '!' : '';
    const panelUp = ui.panels.isOpen('helper') || ui.panels.isOpen('helper-ready');
    const hideKey = p && job ? `${job.id}:${p.tone}` : null;
    pill.hidden = !p || panelUp || (hideKey !== null && pillHidden === hideKey);
    pill.dataset.tone = tone;
    pillLine.textContent = pillText(p);
    pillIco.replaceChildren(p && (p.tone === 'ready') ? glyph('sparkle', 24) : p && p.tone === 'fail' ? glyph('cross', 22)
      : p && p.tone === 'answered' ? glyph('helper', 24) : p && p.tone === 'partnerReady' ? glyph('sparkle', 22) : h('span.hx-spin'));
    // harvey#13: how long so far, and how long it usually takes (while Harvey works for this farmer)
    const working = p && p.tone === 'work' && job && Number.isFinite(job.startedAt) && Date.now() - job.startedAt < 6 * 3_600_000;
    pillTime.hidden = !working;
    pillShort.hidden = !working;
    if (working) {
      const ms = Math.max(0, Date.now() - job.startedAt);
      pillTime.textContent = t('harness.pill.elapsed', { time: fmtDuration(ms, { trim: true }) });
      pillShort.textContent = fmtDuration(ms, { cut: 'ms' });
    }
    tickWhile(working);
    const at = p && job ? (job.state === 'ready' ? 4 : M.stepIndex(p.step)) : -1;
    [...pillDots.children].forEach((d, i) => { d.className = i < at ? 'done' : i === at ? 'now' : ''; });
    pillDots.hidden = !p || p.tone === 'fail' || p.tone === 'answered';
    const go = p && p.tone === 'ready' ? t('harness.pill.readyGo') : p && p.tone === 'fail' ? t('harness.pill.failedGo')
      : p && p.tone === 'answered' ? t('harness.pill.answeredGo') : '';
    pillGo.textContent = go;
    pillGo.hidden = !go;
    pillMain.setAttribute('aria-label', [t('harness.pill.title'), pillText(p), go].filter(Boolean).join(': '));
    pillX.setAttribute('aria-label', t('harness.pill.hide'));
    pillX.title = t('harness.pill.hide');
    // the screen reader hears each new step once, not every progress note
    const say = p ? [pillText(p), go].filter(Boolean).join(' ') : '';
    if (say !== lastSaid) { lastSaid = say; live.textContent = say; }
  }

  /** The pill's clock ticks while Harvey works (a redraw every 15 s; none when nothing runs). */
  let tickT = 0;
  function tickWhile(on) {
    if (on && !tickT) { tickT = setInterval(() => renderDock(), 15_000); tickT.unref?.(); }
    else if (!on && tickT) { clearInterval(tickT); tickT = 0; }
  }

  function onButton() {
    if (ui.panels.isOpen('helper')) { ui.panels.close('helper'); return; }
    if (st.job && st.job.by === me() && (st.job.state === 'ready' || st.job.state === 'answered')) { openReady(); return; }
    open();
  }
  function onPill() {
    const p = M.pillOf(st.job, me());
    if (p && (p.tone === 'ready' || p.tone === 'answered')) openReady();
    else open('ask');
  }
  function hidePill() {
    const p = M.pillOf(st.job, me());
    if (p && st.job) pillHidden = `${st.job.id}:${p.tone}`;
    renderDock();
    btn.focus?.({ preventScroll: true });
  }

  function open(tab = 'ask') { return ui.panels.open('helper', { tab }); }
  /**
   * The ready pop-up. `auto`: it opened by itself (QA r4 H4-01): its frame keeps the focus, never Apply, so a Space or an
   * Enter meant for something else applies nothing; a farmer who opened it (the pill, the button, "See them") gets Apply.
   */
  function openReady({ auto = false } = {}) {
    if (!st.job) return false;
    return ui.panels.isOpen('helper-ready') ? true : ui.panels.open('helper-ready', auto ? { job: st.job.id, auto: true } : { job: st.job.id });
  }

  ui.panels.on('open', (n) => { if (n === 'helper') btn.setAttribute('aria-expanded', 'true'); renderDock(); });
  const waitsForMe = () => Boolean(st.job && st.job.by === me() && ['ready', 'answered'].includes(st.job.state));
  ui.panels.on('close', (n) => {
    if (n === 'helper') btn.setAttribute('aria-expanded', 'false');
    renderDock();
    if (n === 'helper-ready') {
      // another sheet took the screen (a level-up, a welcome back): the shell closes this one before it opens that
      // one, so a microtask later the other is on top; the pop-up comes back once the screen is clear again
      queueMicrotask(() => { const top = ui.panels.top(); if (top && top !== 'helper' && top !== 'helper-ready' && waitsForMe()) wantReady = true; });
    }
    if (n === 'helper-letter') {
      // the same for a letter (QA r2 H2-04): its own OK, Show me, ✕ or Escape read it; another sheet that took the screen
      // (the applied toast's Show me, a level-up) leaves it unread, and it comes back once the screen is clear
      const id = letterOpen;
      letterOpen = null;
      letterClosing = id;
      queueMicrotask(() => {
        if (letterClosing === id) letterClosing = null;
        const top = ui.panels.top();
        if (top && top !== 'helper-letter') wantLetter = true; else markLetterRead(id);
      });
    }
    if (ui.panels.top()) return;
    if (wantReady && waitsForMe()) { later(() => tryAuto(), SETTLE_MS); return; }
    wantReady = false;
    if (wantLetter) later(() => tryAuto(), SETTLE_MS);
  });

  // ---- is the player busy? (QA r3 H3-02, H3-03) --------------------------------------------------------------------
  // Harvey's sheets that open by themselves (the changes-ready pop-up, a letter) wait while the player is in the middle of
  // something: a finger or the mouse held on the farm (a stroke, a pan) and a moment after it lifts, a menu, flyout or
  // tray of the HUD open, or typing in a field outside Harvey's sheets (QA r4 H4-01: the chat line). A letter the farmer did not ask for also waits while Grandma's coach speaks (one voice at a
  // time: M29); the ready pop-up and the farmer's own change's letter answer their wish and do not. Meanwhile the pill
  // keeps "See them"; a press on the pill or the button opens at once (the player asked).
  const SETTLE_MS = opts.settleMs ?? 400;
  const IDLE_POLL_MS = opts.idlePollMs ?? 250;
  const HELD_MAX_MS = 30_000;            // a pointer-up the page never saw (released outside the window) ends here
  // the HUD's menus, flyouts and trays, each `hidden` while closed (ui-shell: hud.js, toolbar.js, seeds.js, social.js)
  const OPEN_UI = ['.edge-menu', '#tools-flyout', '#seed-tray', '#build-tray', '.seed-pop', '#together-menu'];
  const downs = new Set();
  let heldSince = 0;
  let upAt = 0;
  let coachOn = false;
  const onFarm = (el) => Boolean(el && (el.id === 'world' || el.closest?.('#world')));
  const onDown = (e) => {
    if (!onFarm(e?.target)) return;
    if (!downs.size) heldSince = Date.now();
    downs.add(e.pointerId ?? 0);
  };
  const onUp = (e) => {
    if (!downs.delete(e?.pointerId ?? 0)) return;
    if (!downs.size) { upAt = Date.now(); if (wantReady || wantLetter) wake(); }
  };
  const onBlur = () => { if (downs.size) { downs.clear(); upAt = Date.now(); } };
  const onCoach = (e) => { coachOn = Boolean(e?.detail?.visible); if (!coachOn) wake(); };
  // QA r4 H4-01: a farmer typing outside Harvey's own sheets (the chat line, a name) is busy too: the pop-up came over a
  // half-typed chat line with Apply focused, and the next Space applied the change unseen. The key that sends the line
  // (Enter) also counts for a moment after it, as a lifted hand does
  const EDIT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);
  const editable = (el) => Boolean(el && (el.tagName === 'TEXTAREA' || el.isContentEditable
    || (el.tagName === 'INPUT' && EDIT_TYPES.has(String(el.type ?? el.getAttribute?.('type') ?? '').toLowerCase()))));
  const ownField = (el) => Boolean(el?.closest?.('.hx-body, #hx-dock'));
  let typedAt = 0;
  const onKey = (e) => { if (editable(e?.target) && !ownField(e.target)) { typedAt = Date.now(); if (wantReady || wantLetter) wake(); } };
  win.addEventListener?.('pointerdown', onDown, true);
  win.addEventListener?.('pointerup', onUp, true);
  win.addEventListener?.('pointercancel', onUp, true);
  win.addEventListener?.('blur', onBlur);
  win.addEventListener?.('hh:coach', onCoach);
  win.addEventListener?.('keydown', onKey, true);
  const pointerBusy = () => {
    if (downs.size && Date.now() - heldSince > HELD_MAX_MS) { downs.clear(); upAt = Date.now(); }
    return downs.size > 0 || Boolean(S.controller?.stroke) || (upAt > 0 && Date.now() - upAt < SETTLE_MS);
  };
  const menuOpen = () => OPEN_UI.some((sel) => [...(doc?.querySelectorAll?.(sel) ?? [])].some((el) => !el.hidden && el.isConnected !== false));
  const coachSpeaks = () => coachOn || Boolean(S.tutorial?.active?.());
  /** A field outside Harvey's sheets has the focus, a key went into one a moment ago, or the chat line holds words. */
  const typing = () => {
    const a = doc?.activeElement;
    if (editable(a) && !ownField(a)) return true;
    if (typedAt > 0 && Date.now() - typedAt < SETTLE_MS) return true;
    // a chat line with words waits for its Send (ui/social.js keeps it open), focused or not
    return [...(doc?.querySelectorAll?.('.chat-box input, .chat-box textarea') ?? [])].some((x) => String(x.value ?? '').trim() !== '');
  };
  /** Why a sheet that opens by itself waits now ('' = it may open). `coach: false` for a letter of the farmer's own change. */
  function busyWhy({ coach = true } = {}) {
    if (pointerBusy()) return 'pointer';
    if (menuOpen()) return 'menu';
    if (typing()) return 'typing';
    if (coach && coachSpeaks()) return 'coach';
    return '';
  }

  let idleT = 0;
  function wake() {
    if (idleT || !(wantReady || wantLetter)) return;
    idleT = setInterval(() => tryAuto(), IDLE_POLL_MS);
    idleT.unref?.();
  }
  function sleepIdle() { if (idleT) { clearInterval(idleT); idleT = 0; } }
  /**
   * Open what waits, once the screen is clear and the player idle: the ready pop-up first (over Harvey's own panel too),
   * then a letter. A panel on screen ends the watch (its close brings it back); a busy hand, menu or coach keeps it.
   */
  function tryAuto() {
    if (wantReady && !waitsForMe()) wantReady = false;
    if (!wantReady && !wantLetter) { sleepIdle(); return; }
    const top = ui.panels.top();
    if (wantReady) {
      if (top && top !== 'helper') { sleepIdle(); return; }
      // the answer to the farmer's own wish: a held hand or an open menu holds it, the coach does not (a new farmer asks
      // Harvey while the coach still has up to 45 minutes to say: the pop-up would never come by itself)
      if (busyWhy({ coach: false })) { wake(); return; }
      wantReady = false;
      sleepIdle();
      openReady({ auto: true });
      return;
    }
    if (top) { sleepIdle(); return; }
    wantLetter = false;
    sleepIdle();
    checkLetters();               // it waits again (and wakes the watch) while the player is busy
  }
  onLang(() => {
    pillMain.querySelector('.hx-pill-title').textContent = t('harness.pill.title');
    renderDock();
  });
  // "Show Harvey" (Settings › Harvey) takes effect at once, no reload
  const offSettings = S.settings?.on?.((_s, patch) => { if (!patch || Object.hasOwn(patch, 'showHarvey')) renderDock(); });

  // ---- data ---------------------------------------------------------------------------------------------------
  function setJob(job, source = 'push') {
    const prev = st.job;
    if (job && prev && job.id === prev.id && Number(job.updatedAt) < Number(prev.updatedAt)) return;   // an older push
    lastJobAt = Date.now();
    let next = job && typeof job === 'object' && job.state ? job : null;
    if (next && M.ENDED.has(next.state) && !(M.KEPT.has(next.state) && !dismissed.has(next.id))) next = null;
    // a new job or a new round starts clean: no "rebuild on top" or old refusal left over from the last pop-up
    if (!next || next.id !== prev?.id || next.round !== prev?.round) { st.stale = false; st.readyFlash = null; }
    st.job = next;
    // QA r1 H-06: "Harvey is on it" holds only while Harvey is on it (never under a failure, an answer or ready changes)
    if (st.flash?.key === 'harness.ask.sent' && !(next && M.ACTIVE.has(next.state))) st.flash = null;
    const mine = next && next.by === me();
    if (mine && next.state === 'answered') { st.lastAnswer = next.result?.summary ?? null; st.lastAsked = next.prompts?.at(-1)?.text ?? null; }
    if (mine && (next.state === 'ready' || next.state === 'answered')) {
      // a ready round, or Harvey's answer, opens by itself once (the answer is his reply: H1)
      const k = `${next.id}:${next.round ?? 1}:${next.state === 'answered' ? 'a' : 'r'}`;
      if (!readyShown.has(k)) {
        readyShown.add(k);
        // harvey#13: a soft chime when the changes are ready (the audio module's own chime; life-feel may give it a
        // sound of its own: docs/agent-notes/rel-harvey.md)
        if (next.state === 'ready' && source !== 'state') {
          try { win.dispatchEvent?.(new win.CustomEvent('hh:chime', { detail: { from: 'harvey' } })); } catch { /* no audio here */ }
        }
        // never over a held stroke, an open menu or the coach (QA r3 H3-03): the pill says "See them" meanwhile
        wantReady = true;
        tryAuto();
      }
    }
    if (job && job.state === 'cancelled' && prev && prev.id === job.id && M.ACTIVE.has(prev.state) && job.by === me() && source !== 'rest') {
      ui.toast(t('harness.job.cancelled'), { kind: 'info', ms: 4000 });
    }
    // the pop-up shows the current job while it is ready, being applied, or failed; anything else closes it
    if (ui.panels.isOpen('helper-ready') && !(next && ['ready', 'applying', 'failed', 'answered'].includes(next.state))) ui.panels.close('helper-ready');
    managePoll();
    changed();
  }

  async function refresh() {
    const r = await api.state();
    if (!r.ok) {
      if (!st.loaded) { st.enabled = false; renderDock(); }
      return r;
    }
    const d = r.data && typeof r.data === 'object' ? r.data : {};
    st.loaded = true;
    st.enabled = d.enabled === true;
    st.providers = Array.isArray(d.providers) ? d.providers.filter((p) => p && typeof p.id === 'string') : [];
    st.active = d.active ?? null;
    if (st.active?.suspended) checkPaused(st.active.n);
    const c = d.consent && typeof d.consent === 'object' ? d.consent : {};
    st.consent = { telemetry: c.telemetry === true ? true : c.telemetry === false ? false : null, sending: typeof c.sending === 'boolean' ? c.sending : null,
      install: c.install ?? st.consent.install ?? null };
    st.limits = d.limits ?? null;
    setJob(d.job ?? null, 'state');
    checkLetters();
    return r;
  }

  async function connect({ force = false } = {}) {
    if (st.phase === 'live' || st.phase === 'starting') return;
    if (st.phase === 'nobus' && !force) return;
    st.phase = 'starting';
    if (!bus && opts.bus === undefined) bus = await loadBus(doc);
    if (!bus && !force && !opts.force) { st.phase = 'nobus'; return; }
    if (bus && !offBus) offBus = bus.onHarness((m) => receive(m));
    if (!overlayApi && opts.overlayApi === undefined) overlayApi = await loadOverlayApi(doc);
    // the welcome installed the farm's mod before this ui listened: its letters come from the bus's last word
    const lastContent = bus?.lastHarness?.('content');
    if (Array.isArray(lastContent?.text?.letters)) knownLetters = lastContent.text.letters;
    st.phase = 'live';
    await refresh();
  }

  function managePoll() {
    const want = POLL_MS > 0 && st.phase === 'live' && st.job && M.ACTIVE.has(st.job.state);
    if (want && !pollT) {
      pollT = setInterval(async () => {
        if (Date.now() - lastJobAt < POLL_MS * 1.5) return;       // pushes are arriving: nothing to do
        const r = await api.current();
        if (r.ok) setJob(r.data?.job ?? null, 'poll');
      }, POLL_MS);
    } else if (!want && pollT) {
      clearInterval(pollT);
      pollT = 0;
    }
  }

  function receive(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.e) {
      case 'job': if (msg.job && typeof msg.job === 'object') setJob(msg.job, 'push'); return;
      case 'applied': onApplied(msg); return;
      case 'undone': onUndone(msg); return;
      case 'suspended':
        st.history = null;
        checkPaused(msg.n);
        changed();
        return;
      case 'signin': {
        const s = M.signInFromPush(msg);
        if (s) applySignIn(s.provider, s);
        return;
      }
      case 'content':
        st.history = null;
        if (Number.isInteger(msg.n)) lettersN = msg.n;
        // a version installed while this page is open: this farmer is here as it happens (QA r3 H3-02: its letter is news)
        if (Number.isInteger(msg.n) && st.active && st.active.n !== msg.n) st.active = { ...st.active, n: msg.n, appliedAt: farmNow() };
        if (st.active && typeof msg.suspended === 'boolean') st.active = { ...st.active, suspended: msg.suspended };
        if (msg.suspended) checkPaused(msg.n);
        checkLetters(Array.isArray(msg.text?.letters) ? msg.text.letters : msg.suspended || msg.n === null ? [] : null);
        changed();
        return;
      default:
    }
  }

  /**
   * A paused mod (a game update it no longer fits, or a damaged file) is said once per farmer and version on this device:
   * at the first state or the content event that carries it (QA r2 H2-02: no server ever sent `suspended`, so nobody was
   * told). The Ask tab keeps a quiet line while it lasts.
   */
  function checkPaused(n) {
    const pid = me();
    if (!Number.isInteger(n) || !pid) return;
    const seen = kv.get(M.pausedKey(scope), {}) || {};
    const mine = Array.isArray(seen[pid]) ? seen[pid] : [];
    if (mine.includes(n)) return;
    kv.set(M.pausedKey(scope), { ...seen, [pid]: [...mine, n].slice(-20) });
    ui.notice?.(t('harness.suspended'));
  }

  /** "Show me" (harvey features 1): the Market tab or the workshop that has the new thing. */
  function showThing(x) {
    if (!x || typeof x.id !== 'string') return false;
    const tab = { crops: 'seeds', trees: 'trees', animals: 'animals', decor: 'decor' }[x.family];
    if (tab) return ui.panels.open('market', { tab, focus: x.id });
    if (x.family === 'recipes') {
      const objs = store.state?.farm?.objects ?? {};
      const at = x.building ? Object.keys(objs).sort().find((id) => objs[id]?.def === x.building) : null;
      if (at && ui.panels.has?.('building')) return ui.panels.open('building', { id: at, focus: x.id });
      return ui.panels.open('market', { tab: 'buildings' });
    }
    return false;
  }
  /**
   * The first thing an `hx applied` push names (with its family) that the farm can use now, for "Show me". A thing from a
   * later level sits in the Market's "Next:" strip, not its grid: Show me found nothing to show (QA r2 H2-03).
   */
  const firstAdded = (msg) => {
    const { level } = farmCtx();
    return (Array.isArray(msg?.names) ? msg.names : []).find((x) => x && typeof x.id === 'string' && x.family && M.usableAt(x, level)) ?? null;
  };

  function sayApplied(msg) {
    const k = `a${msg.n}`;
    if (heard.has(k)) return;
    heard.add(k);
    // a thing from a later level says so in the toast ("Moon Melon (from level 14)") instead of a Show me that shows nothing
    const line = M.appliedLine(msg, me(), players(), lang(), { level: farmCtx().level, later: (name, n) => t('harness.applied.later', { name, n }) });
    const text = t(line.key, { ...line.params, things: list(line.params.things ?? []) });
    const mine = Boolean(msg.by) && msg.by === me();
    const thing = firstAdded(msg);
    // mine: "Show me" the new thing; the partner's: a one-tap Undo (astra cut list: the S version of partner approval)
    const action = mine ? (thing ? { label: () => t('harness.showMe'), fn: () => showThing(thing) } : null)
      : msg.by ? { label: () => t('harness.applied.undo'), fn: () => quickUndo(msg.n) } : null;
    ui.toast(text, { kind: 'ok', ms: action ? 9000 : 6000, ...(action ? { action } : {}) });
  }
  /** The partner's change undone in one tap (the toast's Undo): back to the version before it, if it is still live. */
  async function quickUndo(n) {
    if (st.busy.undo) return;
    if (Number.isInteger(n) && st.active && Number.isInteger(st.active.n) && st.active.n !== n) return;
    st.busy.undo = true;
    const r = await api.undo();
    st.busy.undo = false;
    if (r.ok) {
      const active = r.data?.active ?? null;
      if (active) st.active = active;
      st.history = null;
      if (Number.isInteger(active?.n)) later(() => onUndone({ by: me(), n: active.n }), FALLBACK_MS);
      changed();
      return;
    }
    ui.toast(t(M.errKey(r.code)), { kind: 'info', ms: 4000 });
  }
  function onApplied(msg) {
    sayApplied(msg);
    const added = firstAdded(msg);
    if (added) st.lastAdded = { ...added, n: msg.n };
    // this farmer is here as it happens (QA r3 H3-02); their own change's letter is the answer to their wish
    if (msg.by && msg.by === me() && Number.isInteger(msg.n)) appliedHere.add(msg.n);
    st.active = { ...(st.active ?? {}), n: msg.n, by: msg.by, title: msg.title ?? null,
      appliedAt: st.active?.n === msg.n && Number.isFinite(st.active?.appliedAt) ? st.active.appliedAt : farmNow() };
    if (st.job && (st.job.state === 'ready' || st.job.state === 'applying') && (st.job.result?.candidate === msg.n || st.job.by === msg.by)) {
      st.job = null;
      if (ui.panels.isOpen('helper-ready')) ui.panels.close('helper-ready');
    }
    st.history = null;
    managePoll();
    checkLetters();
    changed();
  }
  function onUndone(msg) {
    const k = `u${msg.n}`;
    if (!heard.has(k)) {
      heard.add(k);
      const line = M.undoneLine(msg, me(), players(), lang());
      const say = (l) => t(l.key, { ...l.params, things: list(l.params.things ?? []) });
      // what left, then what came back (QA r3 H3-05), as two sentences
      ui.toast(line.also ? `${say(line)} ${say(line.also)}` : say(line), { kind: 'info', ms: line.also ? 7000 : 5000 });
    }
    if (Number.isInteger(msg.n)) {
      if (msg.by && msg.by === me()) appliedHere.add(msg.n);
      st.active = { ...(st.active ?? {}), n: msg.n, by: msg.by,
        appliedAt: st.active?.n === msg.n && Number.isFinite(st.active?.appliedAt) ? st.active.appliedAt : farmNow() };
    }
    st.history = null;
    changed();
  }

  // ---- letters a change brings (contract §1.8: once per farmer, after the version that adds them) -----------------
  // the bus's content event carries the overlay's letters; otherwise the installed overlay is asked
  let knownLetters = null;
  const appliedHere = new Set();    // versions this farmer applied (or undid) on this page: their letters are the answer
  /** The active change's letters this farmer has not read on this device. */
  function unreadLetters() {
    let list = knownLetters;
    if (!list) {
      let ov = null;
      try { ov = overlayApi?.installedOverlay?.() ?? null; } catch { ov = null; }
      list = ov?.text?.letters;
    }
    const letters = Array.isArray(list) ? list.filter((l) => l && typeof l.id === 'string') : [];
    const pid = me();
    if (!letters.length || !pid) return [];
    const seen = kv.get(M.lettersKey(scope), {}) || {};
    const mine = new Set(Array.isArray(seen[pid]) ? seen[pid] : []);
    return letters.filter((l) => !mine.has(l.id));
  }
  /**
   * QA r3 H3-02: a farmer who joined the farm after the active change was applied (a partner who came later: the invite
   * path) never saw it happen; its letter is not news to put over their first screen. It waits, quiet, on Ask.
   */
  function joinedAfterChange() {
    const j = players()[me()]?.joinedAt;
    const at = st.active?.appliedAt;
    return Number.isFinite(j) && Number.isFinite(at) && j > at;
  }
  function checkLetters(fromEvent = null) {
    if (Array.isArray(fromEvent)) knownLetters = fromEvent;
    // the farm's state first: who joined when, and when the active change came (QA r3 H3-02)
    if (!st.loaded) return;
    // the letter just closed waits for that microtask's word (read, or pushed away and back later)
    const next = unreadLetters().find((l) => l.id !== letterClosing);
    if (!next) return;
    if (joinedAfterChange()) { changed(); return; }
    if (ui.panels.top()) { wantLetter = true; return; }
    // never over a held stroke or an open menu; nor while the coach speaks, unless it is the farmer's own change's letter
    if (busyWhy({ coach: !appliedHere.has(lettersN ?? st.active?.n) })) { wantLetter = true; wake(); return; }
    openLetter(next);
  }
  function openLetter(l) {
    // read once the farmer closes it, not when it opens (QA r2 H2-04: the toast's Show me opened the Market over it and
    // the letter never came back)
    letterOpen = l.id;
    return ui.panels.open('helper-letter', { id: l.id, letter: l, n: lettersN ?? st.active?.n ?? null });
  }
  /** Who a letter is from, in the language ("Mabel" / "Мейбъл"): a content name, else the id with a capital. */
  function letterFrom(l) {
    if (!l?.from) return null;
    let from = null;
    try { from = contentName(l.from); } catch { from = null; }
    if (!from || from === l.from) from = String(l.from).replace(/^./, (c) => c.toUpperCase());
    return from;
  }
  function markLetterRead(id) {
    const pid = me();
    if (!pid || typeof id !== 'string') return;
    const seen = kv.get(M.lettersKey(scope), {}) || {};
    const mine = new Set(Array.isArray(seen[pid]) ? seen[pid] : []);
    if (mine.has(id)) return;
    mine.add(id);
    kv.set(M.lettersKey(scope), { ...seen, [pid]: [...mine].slice(-200) });
    changed();                    // the Ask tab's list of waiting letters (QA r3 H3-02)
  }

  // ---- asking -------------------------------------------------------------------------------------------------
  // A button that follows a text field keeps the focus in the field when pressed with a mouse: the shell's panel frame
  // drops its typing room (`field-on`, 48 px under the scroller) the moment a field loses the focus, so a press that blurs
  // the field on mousedown shrank the sheet under the pointer and the mouseup missed the button (QA r1, desktop: "Cancel"
  // and "Send" after "Ask for changes" needed two clicks). Keyboard and touch are unchanged.
  const noBlur = (e) => { if (e.button === 0) e.preventDefault(); };
  function flash(key, params = {}, tone = 'info', where = 'flash') {
    st[where] = key ? { key, params, tone } : null;
    if (where === 'flash' && key !== 'harness.signin.expired') st.expired = null;
    changed();
  }

  async function ask(text) {
    const prompt = M.cleanPrompt(text);
    if (!prompt) {
      flash(String(text ?? '').trim().length > M.PROMPT_MAX ? 'harness.ask.tooLong' : 'harness.ask.empty', { max: M.PROMPT_MAX }, 'bad');
      // the box keeps the focus (a keyboard player types the wish next; a finger taps it, no keyboard by itself)
      if (!touch()) doc?.getElementById?.('hx-prompt')?.focus?.({ preventScroll: true });
      return false;
    }
    if (st.busy.start) return false;
    const pid = currentProvider();
    const prov = providerOf(pid);
    if (!prov || !prov.signedIn) {
      st.pendingAsk = prompt;
      st.draft = prompt;
      // H4 (harvey#4): a sign-in starts by itself only when there is nothing to choose; otherwise Sign-in opens with
      // "Choose who runs Harvey" and the plans side by side (a Claude Code login is never spawned for a choice nobody made)
      const only = M.onlyProvider(st.providers);
      open('accounts');
      if (only) { startSignIn(only); flash('harness.ask.signInFirst', {}, 'info'); } else changed();
      return false;
    }
    // asked once, before the first change; a server that sends nothing anywhere has nothing to ask about
    if (st.consent.telemetry === null && st.consent.sending !== false) { st.pendingConsent = prompt; st.draft = prompt; changed(); return false; }
    st.busy.start = true;
    st.draft = prompt;
    flash(null);
    const r = await api.start({ prompt, provider: prov.id, model: prov.id === prefs.provider ? prefs.model : null, lang: lang() });
    st.busy.start = false;
    if (r.ok && r.data?.job) {
      st.draft = '';
      st.pendingAsk = null;
      // QA r1 H-06: the sent wish leaves the box (a second Ask of the same words would only meet "One change at a time");
      // "Change my wish" puts the words back
      const area = doc?.getElementById?.('hx-prompt');
      if (area && area.value) {
        area.value = '';
        try { area.dispatchEvent(new win.Event('input')); } catch { /* a stand-in DOM */ }
      }
      if (!prefs.asked) { prefs.asked = true; savePrefs(); }
      pillHidden = null;
      setJob(r.data.job, 'rest');
      flash('harness.ask.sent', {}, 'ok');
      return true;
    }
    if (r.code === 'SIGN_IN') {
      st.pendingAsk = prompt;
      // this farmer was signed in (the check above): the server says the sign-in ran out (QA r1 H-10). The line sits in
      // that plan's card, which the tab scrolls to, and the tab does not ask to choose a plan (QA r2 H2-C1: the line was
      // above the visible area under "Choose who runs Harvey")
      flash('harness.signin.expired', { provider: V.providerLabel(prov.id) }, 'info');
      st.expired = prov ? prov.id : null;
      if (prov) { prov.signedIn = false; startSignIn(prov.id); }
      open('accounts');
      return false;
    }
    if (r.code === 'BUSY' && r.data?.job) setJob(r.data.job, 'rest');
    if (r.code === 'RATE') { const l = rateLine(r.data); flash(l.key, l.params, 'bad'); return false; }
    flash(M.errKey(r.code), {}, 'bad');
    return false;
  }

  /**
   * A refused Ask over the request limit, honestly (QA r4 H4-03): which cap (the farm's shared day of wishes, or this
   * farmer's hour) and the time it ends on the farm's clock ("You can ask again at 21:40"); an older server's answer
   * without the wait keeps the plain line.
   */
  function rateLine(d) {
    const s = Number(d?.retryAfter);
    if (!Number.isFinite(s) || s <= 0) return { key: M.errKey('RATE'), params: {} };
    const tz = store.state?.meta?.tz;
    const now = farmNow();
    const at = now + Math.ceil(s) * 1000;
    const dayOf = (ts) => fmtDate(ts, { year: 'numeric', month: '2-digit', day: '2-digit' }, tz);
    const time = fmtDate(at, 'time', tz);
    const tomorrow = dayOf(at) !== dayOf(now);
    const n = Number.isInteger(d.max) ? d.max : st.limits?.jobsPerDay;
    if (d.limit === 'day' && Number.isInteger(n)) return { key: tomorrow ? 'harness.ask.rateDayTomorrow' : 'harness.ask.rateDay', params: { n, time } };
    return { key: tomorrow ? 'harness.ask.rateHourTomorrow' : 'harness.ask.rateHour', params: { time } };
  }

  async function answerConsent(yes) {
    if (st.busy.consent) return;
    st.busy.consent = true;
    st.consentError = null;
    changed();
    const r = await api.setConsent(yes);
    st.busy.consent = false;
    if (!r.ok) { st.consentError = 'harness.consent.failed'; changed(); return; }
    const d = r.data && typeof r.data === 'object' ? r.data : {};
    st.consent = { ...st.consent, telemetry: typeof d.telemetry === 'boolean' ? d.telemetry : Boolean(yes), install: d.install ?? st.consent.install,
      sending: typeof d.sending === 'boolean' ? d.sending : st.consent.sending };
    const p = st.pendingConsent;
    st.pendingConsent = null;
    changed();
    if (p) await ask(p);
  }

  // ---- signing in ---------------------------------------------------------------------------------------------
  async function startSignIn(p, method = null) {
    const started = { provider: p, state: 'pending' };
    st.signins[p] = started;
    stopSignInPoll(p);
    changed();
    const r = await api.signIn(p, method ? { method } : {});
    const s = r.ok ? unwrapSignIn(r.data) : null;
    // cancelled meanwhile, started again, or a push already said more (QA r3 H3-01's sibling: a late answer never
    // overwrites a newer state of the same sign-in)
    if (st.signins[p] !== started) return;
    if (!s) { st.signins[p] = { provider: p, state: 'error', error: { code: SIGNIN_CODES.has(r.code) ? r.code : M.CODES.includes(r.code) ? r.code : 'UNAVAILABLE' } }; changed(); return; }
    applySignIn(p, s);
  }
  function applySignIn(p, s) {
    const prev = st.signins[p];
    const prov = providerOf(p);
    if (s.state === 'signed_in') {
      if (prov) { prov.signedIn = true; if (s.account) prov.account = s.account; }
      stopSignInPoll(p);
      if (prev) {
        st.signins[p] = s;
        later(() => { if (st.signins[p]?.state === 'signed_in') { delete st.signins[p]; changed(); } }, 2500);
      }
      if (!prefs.provider || !providerOf(prefs.provider)?.signedIn || st.pendingAsk) { prefs.provider = p; savePrefs(); }
      // H4 (harvey#4): the "sign in first" line is done; the other plans' sign-ins nobody will finish end here and on the
      // server (a waiting Claude Code login is killed), and the player is taken back to Ask, where the request resumes
      st.flash = null;
      st.expired = null;
      for (const other of Object.keys(st.signins)) if (other !== p && st.signins[other]?.state === 'pending') cancelSignIn(other, { keepAsk: true });
      changed();
      if (st.pendingAsk && !st.busy.start) {
        const q = st.pendingAsk;
        st.pendingAsk = null;
        st.signinFromAsk = false;
        if (ui.panels.isOpen('helper')) open('ask');
        later(() => { ask(q); }, 0);
      } else if (prev && st.signinFromAsk && ui.panels.isOpen('helper') && helperTab === 'accounts') {
        // QA r3 H3-08: no wish waits, but the farmer came here from Ask's "Sign in first": Ask is where they go next (the
        // box takes the focus there, never on a touch screen), once "Signed in to …" had a moment on screen. A farmer who
        // opened Sign-in by themselves is managing their plans (they may add a second one next) and stays there; one who
        // moved on meanwhile (another tab, another sign-in) stays where they are
        st.signinFromAsk = false;
        later(() => {
          if (ui.panels.isOpen('helper') && helperTab === 'accounts' && !Object.values(st.signins).some((x) => x?.state === 'pending')) open('ask');
        }, SIGNED_IN_MS);
      }
      return;
    }
    if (s.state === 'signed_out') {
      if (prov) { prov.signedIn = false; delete prov.account; }
      // a flow that ended in an error keeps its card ("That code did not work…" and Start again): the login child has
      // ended, so the server's status says signed_out, and that wiped the error the farmer had to read (QA r3 H3-01)
      if (prev && prev.state !== 'pending' && prev.state !== 'error') delete st.signins[p];
      changed();
      return;
    }
    if (!prev && s.state === 'pending') return;                  // another tab's sign-in: not shown here
    st.signins[p] = { ...s, provider: p };
    if (s.state === 'pending') startSignInPoll(p); else stopSignInPoll(p);
    changed();
  }
  function startSignInPoll(p) {
    if (SIGNIN_POLL_MS <= 0 || signinPolls.has(p)) return;
    const until = Date.now() + 10 * 60_000;
    const id = setInterval(async () => {
      if (!st.signins[p] || st.signins[p].state !== 'pending' || Date.now() > until) { stopSignInPoll(p); return; }
      // the flow this request asks about: an answer that comes back after the flow moved on (a wrong code answered
      // meanwhile, a push, a restart) is old news and is dropped (QA r3 H3-01: the farm server's slow `auth status` answered
      // `signed_out` after BAD_CODE and wiped the error line; the card went back to "Sign in")
      const asked = st.signins[p];
      const r = await api.signInStatus(p);
      if (st.signins[p] !== asked || asked.state !== 'pending') return;
      const s = r.ok ? unwrapSignIn(r.data) : null;
      if (s && (s.state !== 'pending' || JSON.stringify(s.step) !== JSON.stringify(asked.step))) applySignIn(p, s);
    }, SIGNIN_POLL_MS);
    signinPolls.set(p, id);
  }
  function stopSignInPoll(p) { const id = signinPolls.get(p); if (id) clearInterval(id); signinPolls.delete(p); }
  async function continueSignIn(p, value, field) {
    if (st.busy.signin) return;
    st.busy.signin = true;
    changed();
    const r = await api.signInContinue(p, field === 'redirect_url' ? { redirectUrl: value } : { code: value });
    st.busy.signin = false;
    const s = r.ok ? unwrapSignIn(r.data) : null;
    // cancelled while the code was on its way: only a finished sign-in still counts (the account is signed in)
    if (!st.signins[p] && s?.state !== 'signed_in') { changed(); return; }
    if (s) { applySignIn(p, s); if (s.state !== 'signed_in' && !s.error && st.signins[p]) changed(); return; }
    if (st.signins[p]) st.signins[p] = { ...st.signins[p], error: { code: r.code } };
    changed();
  }
  /** A sign-in nobody will finish: forgotten here and ended on the server (a Claude Code login child is killed: H4). */
  function cancelSignIn(p, { keepAsk = false } = {}) {
    const wasPending = st.signins[p]?.state === 'pending';
    stopSignInPoll(p);
    delete st.signins[p];
    if (!keepAsk) { st.pendingAsk = null; st.signinFromAsk = false; }
    if (!keepAsk && st.expired === p) st.expired = null;
    if (wasPending) api.signInCancel?.(p);
    changed();
  }
  async function signOut(p) {
    if (st.busy.signin) return;
    st.busy.signin = true;
    changed();
    const r = await api.signOut(p);
    st.busy.signin = false;
    const prov = providerOf(p);
    if (r.ok) {
      if (prov) { prov.signedIn = false; delete prov.account; }
      delete st.signins[p];
      ui.toast(t('harness.prov.signedOutDone', { provider: V.providerLabel(p) }), { kind: 'info', ms: 3500 });
    } else {
      ui.toast(t(M.errKey(r.code)), { kind: 'info', ms: 4000 });
    }
    changed();
  }
  function useProvider(p) { prefs.provider = p; prefs.model = null; savePrefs(); changed(); loadModels(p); }
  function setModel(p, model) { prefs.provider = p; prefs.model = model || null; savePrefs(); }
  async function loadModels(p) {
    const prov = providerOf(p);
    if (!prov || !prov.signedIn || st.models[p] || Array.isArray(prov.models)) return;
    st.models[p] = [];
    const r = await api.models(p);
    st.models[p] = r.ok && Array.isArray(r.data?.models) ? r.data.models.filter((m) => m && m.id) : [];
    // harvey#13: the model "Recommended" stands for, named
    if (r.ok && typeof r.data?.default === 'string') st.modelDefault = { ...(st.modelDefault ?? {}), [p]: r.data.default };
    changed();
  }
  async function copyText(text) {
    try {
      await win.navigator?.clipboard?.writeText?.(text);
      ui.toast(t('harness.signin.copied'), { kind: 'ok', ms: 2500 });
    } catch {
      ui.toast(text, { kind: 'info', ms: 8000 });           // no clipboard on an http page: show it to copy by hand
    }
  }

  // ---- the ready pop-up's actions ------------------------------------------------------------------------------
  async function apply(job) {
    if (st.busy.apply) return;
    st.busy.apply = true;
    st.stale = false;
    st.readyFlash = null;
    changed();
    const r = await api.apply(job.id);
    st.busy.apply = false;
    if (r.ok) {
      const active = r.data?.active ?? null;
      if (active) st.active = active;
      if (Number.isInteger(active?.n)) appliedHere.add(active.n);
      // the fallback toast's names, with their families ("Show me" needs to know where each lives)
      const things = (job.result?.changes ?? []).filter((c) => c && (c.op === 'add' || c.op === 'revive') && ['crops', 'trees', 'recipes', 'animals', 'decor'].includes(c.family))
        .map((c) => ({ id: c.id, en: c.name?.en ?? c.id, bg: c.name?.bg ?? c.name?.en ?? c.id, family: c.family, ...(c.info?.building?.id ? { building: c.info.building.id } : {}),
          ...(Number.isInteger(c.numbers?.unlock) ? { unlock: c.numbers.unlock } : {}) }));
      const n = active?.n ?? job.result?.candidate;
      const usable = things.find((x) => M.usableAt(x, farmCtx().level));
      if (usable) st.lastAdded = { ...usable, n };
      st.job = null;
      ui.panels.close('helper-ready');
      // the server's `hx applied` says it to both farmers; if it never comes (a lost push), say it here
      if (Number.isInteger(n)) later(() => sayApplied({ by: me(), n, names: things, title: active?.title }), FALLBACK_MS);
      st.history = null;
      managePoll();
      changed();
      return;
    }
    if (r.code === 'STALE') { st.stale = true; changed(); return; }
    if (r.code === 'NOT_READY' || r.code === 'NOT_FOUND') { st.readyFlash = { key: M.errKey(r.code), tone: 'bad' }; await refresh(); return; }
    st.readyFlash = { key: M.errKey(r.code), tone: 'bad' };
    changed();
  }
  async function revise(job, text) {
    const prompt = M.cleanPrompt(text);
    if (!prompt) { st.readyFlash = { key: 'harness.ask.empty', tone: 'bad' }; changed(); return false; }
    if (st.busy.revise) return false;
    st.busy.revise = true;
    st.readyFlash = null;
    changed();
    const r = await api.revise(job.id, prompt);
    st.busy.revise = false;
    if (r.ok && r.data?.job) {
      st.stale = false;
      pillHidden = null;
      // setJob closes the pop-up for a job that is no longer ready; a push that already brought the NEXT ready round
      // (pushes can overtake this answer) keeps its freshly opened pop-up
      setJob(r.data.job, 'rest');
      changed();                       // setJob says nothing when a push already brought newer news: busy is over all the same
      ui.toast(t('harness.ask.sent'), { kind: 'ok', ms: 4000 });
      return true;
    }
    st.readyFlash = { key: M.errKey(r.code), tone: 'bad' };
    changed();
    return false;
  }
  async function discard(job) {
    const yes = await ui.confirm({ title: t('harness.ready.discardTitle'), lead: t('harness.ready.discardLead'), ok: t('harness.ready.discardOk'),
      cancel: t('harness.ready.discardKeep'), okKind: 'stop', glyph: 'close' });
    if (!yes || st.busy.discard) return;
    st.busy.discard = true;
    changed();
    const r = await api.discard(job.id);
    st.busy.discard = false;
    if (r.ok || r.code === 'NOT_FOUND') {
      st.job = null;
      ui.panels.close('helper-ready');
      ui.toast(t('harness.ready.discarded'), { kind: 'info', ms: 4000 });
      managePoll();
      changed();
      return;
    }
    st.readyFlash = { key: M.errKey(r.code), tone: 'bad' };
    changed();
  }
  async function cancelJob(job) {
    if (st.busy.cancel) return;
    st.busy.cancel = true;
    changed();
    const r = await api.cancel(job.id);
    st.busy.cancel = false;
    if (r.ok) {
      ui.toast(t('harness.job.cancelled'), { kind: 'info', ms: 4000 });
      setJob(r.data?.job ?? { ...job, state: 'cancelled' }, 'rest');
      changed();
      return;
    }
    flash(M.errKey(r.code), {}, 'bad');
  }
  /** The other farmer's job, stopped from here (the server allows any seated farmer: a job never holds the farm). */
  async function stopForPartner(job) {
    const who = nameOf(job.by) ?? t('common.partner');
    const ready = job.state === 'ready';
    // harvey#11: the confirm names whose work goes
    const yes = await ui.confirm({ title: ready ? t('harness.ready.discardPartnerTitle', { name: who }) : t('harness.job.stopTitle'),
      lead: ready ? t('harness.ready.discardPartner', { name: who }) : t('harness.job.stopLead', { name: who }),
      ok: t(ready ? 'harness.ready.discardOk' : 'harness.job.stopPartner'), cancel: t('harness.job.stopKeep'), okKind: 'stop', glyph: 'close' });
    if (!yes || st.busy.cancel) return;
    st.busy.cancel = true;
    changed();
    const r = ready ? await api.discard(job.id) : await api.cancel(job.id);
    st.busy.cancel = false;
    if (r.ok || r.code === 'NOT_FOUND') { setJob(r.data?.job ?? { ...job, state: ready ? 'discarded' : 'cancelled', updatedAt: Date.now() }, 'rest'); changed(); return; }
    flash(M.errKey(r.code), {}, 'bad');
  }

  function dismissJob(job) {
    dismissed.add(job.id);
    prefs.seen = [...dismissed].slice(-20);
    savePrefs();
    if (st.job?.id === job.id) st.job = null;
    ui.panels.close('helper-ready');
    changed();
  }
  /** H1 (harvey#10): "Change my wish": the old words back in the box, the box in focus (a keyboard player's; a finger
   *  taps it), nothing sent: the same wish would end the same way. */
  function changeWish(job, text) {
    if (job) dismissJob(job);
    st.draft = text || '';
    open('ask');
    // the Ask tab may already be open (the job card was on it): its box takes the words in place
    const area = doc?.getElementById?.('hx-prompt');
    if (area) {
      area.value = st.draft;
      try { area.dispatchEvent(new win.Event('input')); } catch { /* a stand-in DOM */ }
      if (!touch()) later(() => area.focus?.(), 0);
    }
  }
  function retryJob(job, text) {
    dismissJob(job);
    st.draft = text || '';
    open('ask');
    if (text) ask(text);
  }

  // ---- history and undo -----------------------------------------------------------------------------------------
  async function loadHistory() {
    if (st.history === 'loading') return;
    st.history = 'loading';
    changed();
    const r = await api.history();
    st.history = r.ok && r.data && Array.isArray(r.data.versions) ? r.data : 'failed';
    changed();
  }
  async function undo(to, targetN, opts = null) {
    // "Bring back {title}" asks in its own words (QA r1 H-04): the undone change comes back. Each confirm names what
    // leaves the shop and what comes back when History said (QA r4 H4-04: a bring-back took the Caramel Lantern away
    // and nothing said so); "Go back to this" has its own words, never "Undo this change?" for a version that only adds
    const revive = Boolean(opts?.revive);
    const goBack = Boolean(opts?.go);
    const title = revive ? M.pickText(opts.title, lang()) || '' : '';
    const eff = opts?.eff && typeof opts.eff === 'object' ? opts.eff : null;
    const effText = eff ? M.effectLines(eff, lang()).map((l) => t(l.key, { ...l.params, things: list(l.params.things ?? []) })).join(' ') : '';
    const leaves = Boolean(eff && Array.isArray(eff.left) && eff.left.length);
    const at = Number.isInteger(targetN) && targetN > 0;
    const lead = (base) => [base, effText].filter(Boolean).join(' ');
    const yes = await ui.confirm(revive
      ? { title: t('harness.hist.bringTitle', { title }), lead: lead(t('harness.hist.bringLead', { n: targetN, title })),
        ok: t('harness.hist.bringOk'), cancel: t('harness.hist.bringKeep'), okKind: leaves ? 'stop' : 'go', glyph: 'rotr' }
      : goBack && at
        ? { title: t('harness.hist.goTitle', { n: targetN }), lead: lead(t('harness.hist.backLead', { n: targetN })),
          ok: t('harness.hist.goOk'), cancel: t('harness.hist.confirmKeep'), okKind: leaves || !eff ? 'stop' : 'go', glyph: 'rotl' }
        : { title: t('harness.hist.confirmTitle'),
          // with the server's word the lead says what moves; without it, the general line as before
          lead: eff ? lead(at ? t('harness.hist.backLead', { n: targetN }) : t('harness.hist.backLeadBase'))
            : at ? t('harness.hist.confirmLead', { n: targetN }) : t('harness.hist.confirmLeadBase'),
          ok: t('harness.hist.confirmOk'), cancel: t('harness.hist.confirmKeep'), okKind: leaves || !eff ? 'stop' : 'go', glyph: 'rotl' });
    if (!yes || st.busy.undo) return;
    st.busy.undo = true;
    st.histFlash = null;
    changed();
    const r = await api.undo(Number.isInteger(to) ? to : undefined);
    st.busy.undo = false;
    if (r.ok) {
      const active = r.data?.active ?? null;
      if (active) st.active = active;
      // the fallback toast (a lost push) says what History said moves, as the push would
      if (Number.isInteger(active?.n)) {
        later(() => onUndone({ by: me(), n: active.n, ...(eff ? { names: eff.left ?? [], back: eff.back ?? [] } : {}),
          ...(revive ? { revive: true, title: opts.title } : {}) }), FALLBACK_MS);
      }
      st.history = null;
      await loadHistory();
      return;
    }
    // a refused undo in History's own words (QA r2 H2-02): a damaged stored file, or a version this game no longer runs,
    // never the job's "did not pass the tests"
    const own = UNDO_ERR[r.code];
    st.histFlash = own && Number.isInteger(targetN) && targetN > 0 ? { key: own, params: { n: targetN }, tone: 'bad' } : { key: M.errKey(r.code), tone: 'bad' };
    changed();
  }

  // ---- the helper panel ----------------------------------------------------------------------------------------
  const flashEl = (f) => (f ? h(`p.hx-flash.tone-${f.tone ?? 'info'}`, { role: f.tone === 'bad' ? 'alert' : 'status' }, t(f.key, f.params ?? {})) : null);

  function providerLine() {
    const id = currentProvider();
    const prov = providerOf(id);
    if (!prov || !prov.signedIn) {
      return h('div.hx-using.is-off', h('span', t('harness.ask.signInFirst')),
        h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { act: 'accounts' },
          on: { click: () => { st.signinFromAsk = true; S.ui.panels.open('helper', { tab: 'accounts' }); } } }, t('harness.prov.signIn')));
    }
    const label = prov.account?.label ? t('harness.ask.usingAccount', { provider: V.providerLabel(id), account: prov.account.label }) : t('harness.ask.using', { provider: V.providerLabel(id) });
    return h('div.hx-using', glyph('check', 18), h('span', label),
      h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'accounts' }, on: { click: () => S.ui.panels.open('helper', { tab: 'accounts' }) } }, t('harness.ask.change')));
  }

  function askForm(ctx) {
    const id = 'hx-prompt';
    const area = h('textarea.field.hx-prompt', { id, rows: '4', maxlength: String(M.PROMPT_MAX), placeholder: t('harness.ask.placeholder'),
      'aria-describedby': 'hx-prompt-count', 'aria-keyshortcuts': 'Control+Enter',
      // S-13 (ui-shell keepInView): the box names its button by data-act, so the keyboard never hides Ask behind the 🎙
      dataset: { keepInView: 'ask' } });
    area.value = st.draft;
    const count = h('span.hx-count#hx-prompt-count', { 'aria-live': 'off' });
    const listen = h('p.hx-listening', { role: 'status', hidden: true });
    const paintCount = () => { count.textContent = t('harness.ask.count', { n: String(area.value ?? '').length, max: M.PROMPT_MAX }); };
    paintCount();
    area.addEventListener('input', () => { st.draft = area.value; paintCount(); if (st.flash?.tone === 'bad') flash(null); });
    area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ask(area.value); } });
    let mic = null;
    if (dictation.supported) {
      let base = '';
      const paintMic = () => {
        const on = dictation.listening;
        mic.setAttribute('aria-pressed', String(on));
        mic.setAttribute('aria-label', t(on ? 'harness.mic.stop' : 'harness.mic.start'));
        mic.title = t(on ? 'harness.mic.stop' : 'harness.mic.start');
        mic.replaceChildren(glyph(on ? 'micOn' : 'mic', 26));
        listen.hidden = !on;
        if (on) listen.textContent = t('harness.mic.listening');
      };
      mic = h('button.hx-mic', { type: 'button', on: { mousedown: noBlur, click: () => {
        if (dictation.listening) { dictation.stop(); return; }
        base = String(area.value ?? '').trim();
        dictation.start(lang(), {
          onText: (text) => { area.value = [base, text].filter(Boolean).join(base ? ' ' : '').slice(0, M.PROMPT_MAX); st.draft = area.value; paintCount(); },
          onEnd: () => { paintMic(); area.focus?.(); },
          onError: (code) => { listen.hidden = false; listen.textContent = t(`harness.mic.${code}`); mic.setAttribute('aria-pressed', 'false'); },
        });
        paintMic();
      } } });
      paintMic();
    }
    const go = h('button.btn.hx-go', { type: 'button', dataset: { act: 'ask' }, on: { mousedown: noBlur, click: () => ask(area.value) } }, glyph('sparkle', 22), t('harness.ask.go'));
    // one row of at most 3 chips under the box (critique#37): Harvey's last suggestions first, then the examples that
    // work at this farm's level; a chip fills the box (the player still presses Ask)
    const chipRow = h('div.chips.hx-chip-row', { role: 'group', 'aria-label': t('harness.chips.label') });
    let chipKey = '';
    const paintChips = () => {
      const list0 = M.chips({ level: farmCtx().level, lang: lang(), answer: st.lastAnswer, asked: st.lastAsked, textOf: (k) => t(k) });
      const k = JSON.stringify([list0, lang()]);
      if (k === chipKey) return;
      chipKey = k;
      chipRow.replaceChildren(...list0.map((c) => h('button.chip.hx-chip', { type: 'button', dataset: { chip: c.id ?? 'try' }, on: { mousedown: noBlur, click: () => {
        area.value = c.text ?? t(c.key);
        st.draft = area.value;
        paintCount();
        if (!touch()) area.focus?.();
      } } }, c.text ?? t(c.key))));
      chipRow.hidden = !list0.length;
    };
    paintChips();
    const form = h('div.hx-form',
      h('label.hx-label', { for: id }, t('harness.ask.label')),
      h('div.hx-prompt-wrap', area, mic),
      // Ask right under the box (with the keyboard up the field and its button stay together: ux-phone#6), the count
      // beside it
      h('div.hx-actions.hx-ask-row', go, h('div.hx-form-foot', listen, count)));
    // then (after the line that says why a press was refused: QA r4 H4-03, it was under all of this and below the fold)
    // the chip row (QA r1 H-09: the examples a first-time player needs, on the panel's first screen) and what Harvey can do
    const more = h('div.hx-form-more', chipRow,
      h('p.hx-sub.hx-can-line', t('harness.ask.canLine')),
      dictation.supported ? h('p.hx-sub.hx-mic-note', t('harness.mic.note')) : null);
    const paint = () => {
      const busyOther = st.job && M.OPEN.has(st.job.state);
      form.hidden = Boolean(busyOther) || Boolean(st.pendingConsent);
      more.hidden = form.hidden;
      go.disabled = Boolean(st.busy.start);
      go.setAttribute('aria-busy', String(Boolean(st.busy.start)));
      paintChips();
    };
    paint();
    ctx.on(events, 'change', paint);
    return { el: form, more, area, stop: () => dictation.stop() };
  }

  /** A job of the other farmer that ended (Harvey's answer, a failure): theirs to read; here one line under the form. */
  const partnerEnded = (j) => Boolean(j && j.by !== me() && M.KEPT.has(j.state));

  function mountAsk(body, ctx) {
    const using = section('div.hx-sec', () => JSON.stringify([currentProvider(), st.providers.map((p) => [p.id, p.signedIn, p.account?.label, p.available]), lang()]), providerLine);
    // the card rebuilds only when what it says changes (not on every progress note): a press is never lost to a push
    const jobKey = () => { const j = st.job; return j ? JSON.stringify([j.id, j.state, j.step, j.round, j.by, j.error, j.prompts?.length, Boolean(j.result)]) : ''; };
    const notes = section('div.hx-sec', () => JSON.stringify([st.job?.id, st.job?.state, M.noteRows(st.job, lang()), lang()]),
      () => (st.job && !partnerEnded(st.job) ? V.jobNotes(st.job, lang()) : null));
    const job = section('div.hx-sec', () => JSON.stringify([jobKey(), st.busy.cancel, st.busy.start, lang()]), () => {
      // QA r4 H4-02: the other farmer's finished wish never leads this farmer's Ask (it pushed the box and Ask off a
      // phone's screen, with no way to put it away): it is one line under the form
      if (!st.job || partnerEnded(st.job)) return null;
      return V.jobCard(st.job, { me: me(), nameOf, lang: lang(), busy: Boolean(st.busy.cancel || st.busy.start), notes: false,
        onCancel: (j) => (j.by === me() ? cancelJob(j) : stopForPartner(j)), onSee: () => openReady(), onRetry: (text) => retryJob(st.job, text), onDismiss: (j) => dismissJob(j),
        onChange: (text) => changeWish(st.job, text),
        onKeepPlaying: () => ctx.close(), onSignIn: (p) => { startSignIn(p); ui.panels.open('helper', { tab: 'accounts' }); } });
    });
    const busyLine = section('div.hx-sec', () => JSON.stringify([st.job?.by, st.job?.state, lang()]), () => {
      if (!st.job || !M.OPEN.has(st.job.state) || st.job.by === me()) return null;
      const n = nameOf(st.job.by);
      // harvey#11: a ready job waits for its farmer; only a running one is "working"
      if (st.job.state === 'ready' && n) return h('p.hx-busy', t('harness.ask.busyPartnerReady', { name: n }));
      return h('p.hx-busy', n ? t('harness.ask.busyPartner', { name: n }) : t('harness.ask.busy'));
    });
    const consent = section('div.hx-sec', () => JSON.stringify([st.pendingConsent, st.busy.consent, st.consentError, lang()]), () => (st.pendingConsent
      ? V.consentCard({ busy: Boolean(st.busy.consent), error: st.consentError, privacy: privacyHref(), onYes: () => answerConsent(true), onNo: () => answerConsent(false) }) : null));
    const note = section('div.hx-sec.hx-ask-note', () => JSON.stringify([st.flash, lang()]), () => flashEl(st.flash));
    // a paused mod is said here while it lasts (QA r2 H2-02: the Ask tab said nothing)
    const paused = section('div.hx-sec', () => JSON.stringify([Boolean(st.active?.suspended), lang()]),
      () => (st.active?.suspended ? h('p.hx-sub.hx-paused-line', t('harness.suspended')) : null));
    const form = askForm(ctx);
    // the intro leads only until this device's first request; after that it waits, folded, under the form
    const ownJob = () => Boolean(st.job && !partnerEnded(st.job));
    const intro = section('div.hx-sec', () => JSON.stringify([Boolean(prefs.asked), ownJob(), lang()]), () => (prefs.asked || ownJob() ? null : h('p.hx-intro', t('harness.intro'))));
    // the other farmer's finished wish (H4-02): who asked what and how it ended, with an OK that puts it away here
    const partnerLine = section('div.hx-sec', () => JSON.stringify([st.job?.id, st.job?.state, st.job?.by, partnerEnded(st.job), lang()]), () => {
      const j = st.job;
      if (!partnerEnded(j)) return null;
      const name = nameOf(j.by) ?? t('common.partner');
      const wish = V.shortWish(String(j.prompts?.[0]?.text ?? j.prompts?.at(-1)?.text ?? ''), 60);
      return h('div.hx-partner-done', { dataset: { job: j.id, state: j.state } },
        h('span.hx-partner-ico', { 'aria-hidden': 'true' }, glyph(j.state === 'failed' ? 'cross' : 'helper', 20)),
        h('span.hx-partner-line', t(j.state === 'failed' ? 'harness.job.partnerFailed' : 'harness.job.partnerAnswered', { name, wish })),
        h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'dismissPartner' }, 'aria-label': t('harness.job.partnerHide', { name }),
          on: { click: () => dismissJob(j) } }, t('harness.job.dismiss')));
    });
    const more = h('details.hx-more', h('summary', t('harness.whatCan')), h('p', t('harness.intro')), h('p', t('harness.can')), h('p', t('harness.cannot')));
    // the letters this farmer has not read (QA r3 H3-02: a partner who joined after the change finds its letter here,
    // never as a sheet over their first screen), under the form so the box and Ask stay on a phone's first screen
    const letters = section('div.hx-sec', () => JSON.stringify([unreadLetters().map((l) => l.id), lang()]), () => {
      const ls = unreadLetters().slice(0, 3);
      if (!ls.length) return null;
      return h('ul.hx-letters', { 'aria-label': t('harness.letter.waiting') }, ls.map((l) => h('li.hx-letter-row', { dataset: { letter: l.id } },
        h('span.hx-letter-ico', { 'aria-hidden': 'true' }, glyph('letter', 22)),
        h('span.hx-letter-line', t('harness.letter.waitingRow', { name: letterFrom(l) ?? '', title: M.pickText({ en: l.en?.title, bg: l.bg?.title }, lang()) })),
        h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'readLetter' }, on: { click: () => openLetter(l) } }, t('harness.letter.read')))));
    });
    // the refusal line right under Ask (QA r4 H4-03), then the chips and the can line; a partner's ended wish under them
    body.append(intro.el, job.el, notes.el, busyLine.el, consent.el, paused.el, using.el, form.el, note.el, form.more, partnerLine.el, letters.el, more);
    // The request box hides while the consent question or a job takes its place: the focus follows to that card (its
    // name is read out) instead of dropping to the page, where a keyboard or screen-reader player would lose the panel.
    // only a focus that dropped (to the page, or into the hidden form) moves: never one in the chat box or another panel
    const lost = () => {
      const a = doc?.activeElement;
      if (!a || a === doc.body) return true;
      if (!body.contains(a)) return false;
      for (let n = a; n && n !== body; n = n.parentNode) if (n.hidden) return true;
      return false;
    };
    let hadConsent = Boolean(st.pendingConsent);
    let hadJob = st.job?.id ?? null;
    let flashSeen = null;
    const draw = () => {
      intro.update(); using.update(); job.update(); notes.update(); busyLine.update(); consent.update(); note.update(); paused.update(); letters.update();
      partnerLine.update();
      // a refused press says why where the farmer looks (QA r4 H4-03: the line was below the fold and the press seemed to
      // do nothing): the line is in view, the box keeps the focus
      const f = note.el.querySelector('.hx-flash');
      if (f && st.flash !== flashSeen && st.flash?.tone === 'bad') f.scrollIntoView?.({ block: 'nearest' });
      flashSeen = f ? st.flash : null;
      const nowConsent = Boolean(st.pendingConsent);
      const jobId = st.job?.id ?? null;
      if (nowConsent && !hadConsent && lost()) consent.el.querySelector('.hx-consent')?.focus?.();
      else if (jobId && jobId !== hadJob && lost()) job.el.querySelector('.hx-job')?.focus?.();
      hadConsent = nowConsent;
      hadJob = jobId;
    };
    draw();
    ctx.on(events, 'change', draw);
    // ux-phone#6: on a touch screen the keyboard comes with the player's own tap, never with the sheet
    if (!st.job && !st.pendingConsent && !touch()) queueMicrotask?.(() => form.area.focus?.({ preventScroll: true }));
    return { destroy: () => form.stop() };
  }

  function mountAccounts(body) {
    const lead = h('p.hx-sub', t('harness.prov.lead'));
    const cardCtx = () => ({
      current: currentProvider(), models: st.models, model: prefs.model, busy: Boolean(st.busy.signin), modelDefault: st.modelDefault ?? {},
      onUse: (p) => useProvider(p), onSignIn: (p, m) => startSignIn(p, m), onSignOut: (p) => signOut(p), onModel: (p, m) => setModel(p, m),
      flow: (p) => (st.signins[p] ? V.signInFlow(p, st.signins[p], { busy: Boolean(st.busy.signin), onContinue: continueSignIn, onCancel: cancelSignIn,
        onRestart: (x) => startSignIn(x), onCopy: (u) => copyText(u), note: expiredHere(p) ? st.flash : null }) : null),
    });
    // the sign-in that ran out says so inside its own card (H2-C1), not in the line above the plans
    const expiredHere = (p) => st.expired === p && st.flash?.key === 'harness.signin.expired' && Boolean(st.signins[p]);
    // one redraw per card: a model list arriving for one provider never swaps another card's buttons under a finger
    const list = h('ul.hx-providers');
    const none = h('p.hx-none', { hidden: true }, t('harness.prov.none'));
    let listIds = null;
    const cards = [];
    const sec = { el: h('div.hx-sec', none, list), update() {
      const ids = st.providers.map((p) => p.id).join(',');
      if (ids !== listIds) {
        listIds = ids;
        cards.length = 0;
        list.replaceChildren(...st.providers.map((p) => {
          const id = p.id;
          const card = section('li.hx-slot', () => JSON.stringify([st.providers.find((x) => x.id === id), st.signins[id], st.models[id], currentProvider() === id,
            currentProvider() === id ? prefs.model : null, st.busy.signin, expiredHere(id), lang()]), () => {
            const pv = st.providers.find((x) => x.id === id);
            return pv ? V.providerCard(pv, cardCtx()) : null;
          });
          cards.push(card);
          return card.el;
        }));
      }
      none.hidden = st.providers.length > 0;
      for (const c of cards) c.update();
    } };
    const inCard = () => Boolean(st.expired) && expiredHere(st.expired);
    const note = section('div.hx-sec', () => JSON.stringify([st.flash, inCard(), lang()]), () => (inCard() ? null : flashEl(st.flash)));
    // H4: a request waits and no plan is signed in: say what to do, above the plans side by side; never for a farmer whose
    // sign-in ran out (H2-C1: they had chosen; the card of their plan says what happened)
    const choose = section('div.hx-sec', () => JSON.stringify([Boolean(st.pendingAsk), st.providers.some((x) => x.signedIn), Boolean(st.expired), lang()]),
      () => (st.pendingAsk && !st.expired && !st.providers.some((x) => x.signedIn) ? h('p.hx-choose', { role: 'status' }, t('harness.prov.choose')) : null));
    body.append(h('h3.hx-h', t('harness.prov.title')), lead, choose.el, note.el, sec.el);
    let flows = '';
    const draw = () => {
      sec.update();
      note.update();
      choose.update();
      // a sign-in that just started comes into view, its first step under the finger
      const now = Object.keys(st.signins).sort().join(',');
      if (now !== flows) {
        const fresh = Object.keys(st.signins).find((p) => !flows.split(',').includes(p));
        flows = now;
        const sel = fresh ? `[data-signin="${fresh}"]` : null;
        const el = sel ? body.querySelector(sel) : null;
        // QA r1 H-10: a tab that opens WITH a sign-in draws it before the sheet is in the page: scroll once it is. The
        // card may be drawn again meanwhile (its first step arrived): the one in the page is the one scrolled to (QA r2
        // H2-C1: its first line says why the sign-in is here)
        const go = () => { const x = body.querySelector(sel); if (x?.isConnected) x.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); };
        if (el?.isConnected) go(); else if (el) later(go, 60);
      }
      const open = body.querySelector('[data-signin-open]');
      if (open && !open.dataset.focused) { open.dataset.focused = '1'; open.focus?.({ preventScroll: true }); }
    };
    draw();
    const cur = currentProvider();
    if (cur) loadModels(cur);
    return draw;
  }

  function mountHistory(body) {
    const sec = section('div.hx-sec', () => JSON.stringify([st.history, st.busy.undo, st.histFlash, lang()]), () => {
      if (st.history === 'loading' || st.history === null) return h('p.hx-wait', { role: 'status' }, h('span.hx-spin', { 'aria-hidden': 'true' }), h('span', t('harness.hist.loading')));
      if (st.history === 'failed') {
        return [h('p.hx-error', { role: 'alert' }, t('harness.hist.failed')),
          h('button.btn.btn--paper.btn--small', { type: 'button', on: { click: () => loadHistory() } }, t('harness.hist.retry'))];
      }
      return [flashEl(st.histFlash), V.historyList(st.history, { lang: lang(), nameOf, busy: Boolean(st.busy.undo), onUndo: (to, n, o) => undo(to, n, o) })];
    });
    body.append(sec.el);
    if (st.history === null) loadHistory();
    sec.update();
    return () => { if (st.history === null) loadHistory(); sec.update(); };
  }

  ui.panels.register('helper', {
    get title() { return t('harness.panel.title'); },
    size: 'side',
    get tabs() { return [{ id: 'ask', label: t('harness.tab.ask') }, { id: 'history', label: t('harness.tab.history') }, { id: 'accounts', label: t('harness.tab.accounts') }]; },
    mount(body, ctx) {
      body.classList.add('hx-body');
      helperTab = ctx.tab ?? 'ask';
      if (ctx.tab === 'history') { ctx.on(events, 'change', mountHistory(body)); return {}; }
      if (ctx.tab === 'accounts') { ctx.on(events, 'change', mountAccounts(body)); return {}; }
      return mountAsk(body, ctx);
    },
    onClose() { st.flash = null; helperTab = null; },
  });

  // ---- the changes-ready pop-up ------------------------------------------------------------------------------
  const readyTitle = () => {
    const job = st.job;
    if (job && job.state === 'failed') return t('harness.ready.titleFailed');
    if (job && job.state === 'answered') return t('harness.answer.title');
    if (job && job.by !== me() && nameOf(job.by)) return t('harness.ready.titlePartner', { name: nameOf(job.by) });
    return t('harness.ready.title');
  };
  ui.panels.register('helper-ready', {
    get title() { return readyTitle(); },
    size: 'wide',
    modal: true,
    mount(body, ctx) {
      body.classList.add('hx-body', 'hx-ready');
      let reviseOpen = false;
      let speaking = false;
      // What changes while the pop-up is open (busy states, the stale notice, read-aloud, the revise box) is built ONCE
      // and updated in place: a push or the end of the read-aloud never swaps a button out from under a press.
      const reviseArea = h('textarea.field.hx-prompt.hx-revise-text#hx-revise', { rows: '3', maxlength: String(M.PROMPT_MAX), placeholder: t('harness.ready.revisePlaceholder'),
        dataset: { keepInView: 'reviseSend' } });
      reviseArea.value = st.revDraft ?? '';
      reviseArea.addEventListener('input', () => { st.revDraft = reviseArea.value; });
      const readIco = h('span.hx-read-ico', { 'aria-hidden': 'true' });
      const readLabel = h('span');
      const readBtn = reader.supported ? h('button.hx-read', { type: 'button', dataset: { act: 'read' }, on: { click: () => toggleRead() } }, readIco, readLabel) : null;
      const rebuildBtn = h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { act: 'rebuild' },
        on: { click: () => { if (st.job) revise(st.job, t('harness.ready.rebuildPrompt')); } } }, t('harness.ready.rebuild'));
      // QA r1 H-05: while the stale notice or the revise box is open, its own button is the action and the sticky bar
      // steps aside (at 360 x 640 it lay over "Rebuild on top" and "Send"); each carries its own way out
      const staleDiscardBtn = h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'staleDiscard' },
        on: { click: () => { if (st.job) discard(st.job); } } }, t('harness.ready.discard'));
      const staleBox = h('div.hx-stale', { role: 'alert', hidden: true }, h('p', t('harness.ready.stale')), h('div.hx-actions', rebuildBtn, staleDiscardBtn));
      const flashBox = h('div.hx-sec');
      const sendBtn = h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { act: 'reviseSend' },
        on: { mousedown: noBlur, click: () => { if (st.job) revise(st.job, reviseArea.value); } } }, t('harness.ready.reviseSend'));
      const reviseCancelBtn = h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'reviseCancel' },
        on: { mousedown: noBlur, click: () => { reviseOpen = false; paint(); reviseBtn.focus?.({ preventScroll: true }); } } }, t('harness.ready.reviseCancel'));
      const reviseBox = h('div.hx-revise', { hidden: true }, h('label.hx-label', { for: 'hx-revise' }, t('harness.ready.reviseLabel')), reviseArea,
        h('div.hx-actions', sendBtn, reviseCancelBtn));
      const applyBtn = h('button.btn.hx-apply', { type: 'button', dataset: { act: 'apply' }, on: { click: () => { if (st.job) apply(st.job); } } });
      const reviseBtn = h('button.btn.btn--sky', { type: 'button', dataset: { act: 'revise' },
        on: { click: () => { reviseOpen = !reviseOpen; paint(); if (reviseOpen) reviseArea.focus?.(); } } }, t('harness.ready.revise'));
      const discardBtn = h('button.btn.btn--paper', { type: 'button', dataset: { act: 'discard' }, on: { click: () => { if (st.job) discard(st.job); } } }, t('harness.ready.discard'));
      const actsBar = h('div.hx-actions.hx-ready-acts.hx-sticky-acts', applyBtn, reviseBtn, discardBtn);
      const summaryOf = () => M.pickText(st.job?.result?.summary, lang());
      function toggleRead() {
        if (speaking) { reader.stop(); speaking = false; paint(); return; }
        speaking = reader.speak(V.sayOf(st.job, lang()) || summaryOf(), lang(), { onEnd: () => { speaking = false; paint(); } });
        paint();
      }
      /** The chip row of Harvey's answer: what he suggests instead, then the examples; a chip goes back to Ask with it. */
      const answerChips = (job) => {
        const list0 = M.chips({ level: farmCtx().level, lang: lang(), answer: job.result?.summary, asked: job.prompts?.at(-1)?.text, textOf: (k) => t(k) });
        if (!list0.length) return null;
        return h('section.hx-try', { 'aria-labelledby': 'hx-try-h' }, h('h3.hx-h#hx-try-h', t('harness.answer.try')),
          h('div.chips.hx-chip-row', list0.map((c) => h('button.chip.hx-chip', { type: 'button', dataset: { chip: c.id ?? 'try' },
            on: { click: () => changeWish(job, c.text ?? t(c.key)) } }, c.text ?? t(c.key)))));
      };
      const main = section('div.hx-ready-main', () => JSON.stringify([st.job?.id, st.job?.round, st.job?.by, st.job?.state, Boolean(st.job?.result), lang()]), () => {
        const job = st.job;
        if (!job) return h('p.hx-none', t('harness.ready.none'));
        const mine = job.by === me();
        const ask0 = String(job.prompts?.at(-1)?.text ?? '');
        if (job.state === 'answered') {
          // H1: Harvey's answer as his reply: his words, Read it aloud, the chip row, OK. The wish under its own label, as the
          // failure view has it (QA r4 H4-05: "Harvey says" sat over the farmer's own words)
          return [h('section.hx-summary.hx-answer', { 'aria-labelledby': 'hx-ans-h' },
            ask0 && (mine || nameOf(job.by)) ? h('p.hx-job-who.hx-asked-h', mine ? t('harness.job.askedMine') : t('harness.job.askedBy', { name: nameOf(job.by) })) : null,
            ask0 ? V.quoteEl(ask0) : null,
            h('h3.hx-h#hx-ans-h', t('harness.answer.says')),
            h('p.hx-summary-text', V.sayOf(job, lang()) || t('harness.answer.nothing')), readBtn),
          mine ? answerChips(job) : null,
          // QA r1 H-15: the plain "found nothing" line already says nothing changed: no second time
          V.sayOf(job, lang()) ? h('p.hx-sub', t('harness.job.nothingChanged')) : null,
          h('div.hx-actions.hx-ready-acts.hx-sticky-acts',
            h('button.btn', { type: 'button', dataset: { act: 'ok' }, on: { click: () => (mine ? dismissJob(job) : ctx.close()) } }, t('harness.job.dismiss')))];
        }
        if (job.state === 'failed') {
          // H1 (harvey#10): his words first, "Change my wish" first, the codes folded behind "What went wrong"
          const said = V.sayOf(job, lang());
          return [said ? h('section.hx-summary', h('h3.hx-h', t(V.failSaidKey(job))), h('p.hx-summary-text', said), readBtn) : null,
            h('p.hx-job-failed', glyph('cross', 22), h('span', t('harness.job.nothingChanged'))),
            V.errorFold(job, lang()),
            job.result?.validation ? V.testFold(job.result.validation) : null,
            h('div.hx-actions.hx-ready-acts.hx-sticky-acts',
              mine ? h('button.btn', { type: 'button', dataset: { act: 'change' }, on: { click: () => changeWish(job, ask0) } }, t('harness.job.change')) : null,
              mine ? h('button.btn.btn--paper', { type: 'button', dataset: { act: 'retry' }, on: { click: () => retryJob(job, ask0) } }, t('harness.job.retry')) : null,
              mine ? null : h('button.btn.btn--paper', { type: 'button', dataset: { act: 'dismiss' }, on: { click: () => ctx.close() } }, t('harness.job.dismiss')))];
        }
        const res = job.result && typeof job.result === 'object' ? job.result : {};
        const summary = summaryOf();
        const out = [];
        // a follow-up Harvey answered without building: his reply first, the changes from before stay ready (H1)
        const reply = M.pickText(res.answer, lang());
        if (reply) {
          out.push(h('section.hx-summary.hx-answer', h('h3.hx-h', t('harness.answer.reply')), h('p.hx-summary-text', reply)));
        }
        if (summary) {
          out.push(h('section.hx-summary', { 'aria-labelledby': 'hx-sum-h' }, h('h3.hx-h#hx-sum-h', t('harness.ready.summary')),
            h('p.hx-summary-text', summary), reply ? null : readBtn));
        }
        // the change first, the tests folded to one line under it (harvey#8, astra#5)
        out.push(h('section.hx-col', { 'aria-labelledby': 'hx-ch-h' }, h('h3.hx-h#hx-ch-h', t('harness.ready.changes')), V.changeList(res.changes, lang(), farmCtx())),
          res.validation ? V.testFold(res.validation) : null);
        if (!mine) {
          out.push(h('p.hx-sub', nameOf(job.by) ? t('harness.ready.notYours', { name: nameOf(job.by) }) : t('harness.err.NOT_YOURS')),
            h('div.hx-actions.hx-ready-acts', h('button.btn.btn--paper', { type: 'button', on: { click: () => ctx.close() } }, t('harness.ready.later'))));
          return out;
        }
        // the action bar stays at the bottom of the sheet (M13b: Apply in view without scrolling on a phone)
        // the undo note above the bar, so the bar stays the sheet's last line when scrolled to the end (Astra, checked)
        out.push(staleBox, flashBox, reviseBox, h('p.hx-sub.hx-undo-note', t('harness.ready.undoNote')), actsBar);
        return out;
      });
      let flashKey = null;
      function paint() {
        const job = st.job;
        if (readBtn) {
          readBtn.setAttribute('aria-pressed', String(speaking));
          readIco.replaceChildren(glyph(speaking ? 'stop' : 'speaker', 22));
          readLabel.textContent = t(speaking ? 'harness.read.stop' : 'harness.read.start');
        }
        staleBox.hidden = !st.stale;
        rebuildBtn.disabled = Boolean(st.busy.revise);
        staleDiscardBtn.disabled = Boolean(st.busy.revise || st.busy.discard);
        actsBar.hidden = Boolean(st.stale || reviseOpen);
        reviseCancelBtn.disabled = Boolean(st.busy.revise);
        const fk = JSON.stringify(st.readyFlash);
        if (fk !== flashKey) { flashKey = fk; flashBox.replaceChildren(...(st.readyFlash ? [flashEl(st.readyFlash)] : [])); }
        reviseBox.hidden = !reviseOpen;
        sendBtn.disabled = Boolean(st.busy.revise);
        const applying = job?.state === 'applying' || Boolean(st.busy.apply);
        applyBtn.disabled = Boolean(applying || st.busy.revise || st.stale || job?.state !== 'ready');
        applyBtn.setAttribute('aria-busy', String(applying));
        applyBtn.textContent = applying ? t('harness.ready.applying') : t('harness.ready.apply');
        reviseBtn.disabled = applying;
        reviseBtn.setAttribute('aria-expanded', String(reviseOpen));
        discardBtn.disabled = applying;
      }
      body.append(main.el);
      main.update(true);
      paint();
      ctx.on(events, 'change', () => { main.update(); paint(); ctx.setTitle(readyTitle()); });
      // a sheet that came by itself keeps the frame's focus (the shell's): its first key press is never Apply, OK or Try
      // again (QA r4 H4-01, WCAG 3.2.1); one the farmer opened puts the focus on its action
      if (!ctx.args?.auto) {
        queueMicrotask?.(() => (applyBtn.isConnected && !applyBtn.disabled ? applyBtn
          : body.querySelector('[data-act="ok"], [data-act="change"], [data-act="retry"], button'))?.focus?.({ preventScroll: true }));
      }
      return { destroy: () => { reader.stop(); } };
    },
  });

  // ---- a letter --------------------------------------------------------------------------------------------------
  ui.panels.register('helper-letter', {
    title: (args) => M.pickText({ en: args?.letter?.en?.title, bg: args?.letter?.bg?.title }, lang()) || t('harness.panel.title'),
    size: 'card',
    mount(body, ctx) {
      body.classList.add('hx-body');
      const l = ctx.args?.letter;
      const from = letterFrom(l);
      // "Show me" the change the letter came with (harvey features 1), when it added a thing: that change's own thing,
      // which may arrive after the letter (the content push can come before the applied one)
      const want = ctx.args?.n;
      const id = ctx.args?.id ?? l?.id ?? null;
      const acts = h('div.hx-actions', h('button.btn', { type: 'button', dataset: { act: 'ok' }, on: { click: () => { markLetterRead(id); ctx.close(); } } }, t('harness.job.dismiss')));
      let shown = false;
      const addShow = () => {
        const thing = st.lastAdded;
        if (shown || !thing || (Number.isInteger(want) && Number.isInteger(thing.n) && thing.n !== want)) return;
        shown = true;
        acts.append(h('button.btn.btn--sky', { type: 'button', dataset: { act: 'show' }, on: { click: () => { markLetterRead(id); ctx.close(); showThing(thing); } } }, t('harness.showMe')));
      };
      addShow();
      ctx.on(events, 'change', addShow);
      body.append(V.letterCard(l, lang(), from), acts);
    },
  });

  // ---- Settings › Helper ----------------------------------------------------------------------------------------
  function settingsRows(ctx) {
    const share = () => st.consent.telemetry === true;
    const sw = h('button.toggle.hx-share', { type: 'button', role: 'switch', 'aria-checked': String(share()), dataset: { harness: 'share' } },
      h('span', t('harness.set.share'), h('span.help', t('harness.set.shareHelp'))), h('span.sw', { 'aria-hidden': 'true' }));
    sw.addEventListener('click', async () => {
      if (st.busy.consent) return;
      st.busy.consent = true;
      const want = !share();
      const r = await api.setConsent(want);
      st.busy.consent = false;
      if (r.ok) {
        st.consent = { ...st.consent, telemetry: typeof r.data?.telemetry === 'boolean' ? r.data.telemetry : want, install: r.data?.install ?? st.consent.install };
        st.pendingConsent = null;
      } else {
        ui.toast(t('harness.set.failed'), { kind: 'info', ms: 4000 });
      }
      sw.setAttribute('aria-checked', String(share()));
      paintInstall();
      changed();
    });
    const install = h('p.help.hx-install', { hidden: true });
    const off = h('p.help.hx-sending-off', { hidden: true }, t('harness.set.sendingOff'));
    const paintInstall = () => {
      const id = st.consent.install;
      install.hidden = !id;
      install.textContent = id ? t('harness.set.install', { id: String(id) }) : '';
      off.hidden = st.consent.sending !== false;
    };
    paintInstall();
    if (!st.consent.install || st.consent.sending === undefined) {
      api.consent().then((r) => {
        if (!r.ok || !r.data) return;
        if (typeof r.data.telemetry === 'boolean') st.consent.telemetry = r.data.telemetry;
        if (r.data.install) st.consent.install = r.data.install;
        if (typeof r.data.sending === 'boolean') st.consent.sending = r.data.sending;
        sw.setAttribute('aria-checked', String(share()));
        paintInstall();
      });
    }
    // "Show Harvey" (owner 2026-10-19): on this device only, stored with the game's other settings
    const showSw = h('button.toggle.hx-show', { type: 'button', role: 'switch', 'aria-checked': String(shown()), dataset: { harness: 'show' } },
      h('span', t('harness.set.show'), h('span.help', t('harness.set.showHelp'))), h('span.sw', { 'aria-hidden': 'true' }));
    showSw.addEventListener('click', () => {
      S.settings?.set?.({ showHarvey: !shown() });
      showSw.setAttribute('aria-checked', String(shown()));
    });
    const rows = [
      h('h3', t('harness.set.title')),
      h('div.set-row.hx-show-row', showSw),
      h('div.set-row.hx-share-row', sw, off, install,
        h('div', h('a.btn.btn--paper.btn--small', { href: privacyHref(), target: '_blank', rel: 'noopener noreferrer', dataset: { harness: 'privacy' } }, t('harness.set.privacy')))),
      h('div.set-row', h('span.lbl', t('harness.set.openRow')), h('div',
        h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { harness: 'open' }, on: { click: () => { ctx?.close?.(); open(); } } }, t('harness.set.open')))),
    ];
    const signed = st.providers.filter((p) => p.signedIn);
    if (signed.length) {
      rows.push(h('h3', t('harness.set.accounts')));
      for (const p of signed) {
        rows.push(h('div.set-row.hx-set-provider', { dataset: { provider: p.id } }, h('span.lbl', V.providerLabel(p.id)), h('div.set-inline',
          h('span', p.account?.label ? t('harness.prov.signedIn', { account: p.account.label }) : t('harness.prov.signedInPlain')),
          h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'signout' }, on: { click: async (e) => {
            await signOut(p.id);
            e.target?.closest?.('.hx-set-provider')?.remove?.();
          } } }, t('harness.prov.signOut')))));
      }
    }
    return rows;
  }

  // ---- start ---------------------------------------------------------------------------------------------------
  const offWelcome = store.on?.('welcome', () => {
    if (st.phase === 'idle') connect();
    else if (st.phase === 'live') refresh();
  });
  if (store.state && opts.autoStart !== false) connect();

  return {
    enabled: () => st.enabled,
    connect,
    refresh,
    receive,
    open,
    openReady,
    settingsRows,
    tile,
    ask,
    snapshot: () => JSON.parse(JSON.stringify({ ...st, prefs, pillHidden })),
    destroy() {
      offWelcome?.();
      offBus?.();
      offSettings?.();
      if (pollT) clearInterval(pollT);
      if (tickT) clearInterval(tickT);
      for (const id of signinPolls.values()) clearInterval(id);
      signinPolls.clear();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      sleepIdle();
      win.removeEventListener?.('pointerdown', onDown, true);
      win.removeEventListener?.('pointerup', onUp, true);
      win.removeEventListener?.('pointercancel', onUp, true);
      win.removeEventListener?.('blur', onBlur);
      win.removeEventListener?.('hh:coach', onCoach);
      win.removeEventListener?.('keydown', onKey, true);
      dictation.stop();
      reader.stop();
      dock.remove();
      gap.remove();
    },
  };
}

