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
// the helper's own words register first (i18n/harness.js): this module loads on demand (ui/harness/boot.js)
import '../../i18n/harness.js';
import { h, kv } from '../dom.js';
import { farm, session as farmSession } from '../../net/farm.js';
import { t, lang, onLang, list } from '../../i18n/index.js';
import { name as contentName } from '../../i18n/names.js';
import { createHarnessApi, harnessBase, unwrapSignIn } from '../../harness/api.js';
import { PRIVACY_PATH, PRIVACY_MD_URL } from '../../front/links.js';
import { loadBus, loadOverlayApi, farmerKey } from './link.js';
import { createDictation, createReader } from './voice.js';
import { glyph } from './glyphs.js';
import * as M from './model.js';
import * as V from './views.js';

const SIGNIN_CODES = new Set(['DENIED', 'EXPIRED', 'BAD_CODE', 'STATE', 'USAGE_LIMIT', 'UNAVAILABLE', 'INTERNAL']);

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
  };
  const prefs = { provider: null, model: null, ...(kv.get(M.prefsKey(scope), {}) || {}) };
  const savePrefs = () => kv.set(M.prefsKey(scope), { provider: prefs.provider, model: prefs.model, asked: Boolean(prefs.asked) });
  const readyShown = new Set();     // '<job id>:<round>': the pop-up opened by itself once per ready round
  const dismissed = new Set();      // failed jobs the player said OK to
  const heard = new Set();          // 'a<n>' / 'u<n>': toasts already said for that version
  let pillHidden = null;            // '<job id>:<tone>': the player hid the pill for this job and tone
  let lastJobAt = 0;
  let pollT = 0;
  const signinPolls = new Map();
  let wantReady = false;            // a ready round waits for the open panels to close
  let wantLetter = false;
  let offBus = null;
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };

  const me = () => store.pid;
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
  const btn = h('button.edge-btn.hx-btn#hx-btn', {
    type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'panel-helper', dataset: { state: 'idle' },
    on: { click: () => onButton() },
  }, glyph('helper', 30), h('span.hx-btn-ring', { 'aria-hidden': 'true' }), btnDot, btnLabel);
  const pillIco = h('span.hx-pill-ico', { 'aria-hidden': 'true' });
  const pillLine = h('span.hx-pill-line');
  const pillGo = h('span.hx-pill-go', { hidden: true });
  const pillDots = h('span.hx-pill-dots', { 'aria-hidden': 'true' }, M.STEPS.map(() => h('i')));
  const pillMain = h('button.hx-pill-main', { type: 'button', on: { click: () => onPill() } },
    pillIco, h('span.hx-pill-text', h('b.hx-pill-title', t('harness.pill.title')), pillLine), pillDots, pillGo);
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
    const state = !p ? 'idle' : p.tone === 'work' || p.tone === 'signin' ? 'work' : p.tone === 'ready' ? 'ready' : p.tone === 'fail' ? 'fail' : 'partner';
    const label = state === 'work' ? t('harness.btn.working') : state === 'ready' ? t('harness.btn.ready') : state === 'fail' ? t('harness.btn.failed')
      : state === 'partner' && nameOf(job?.by) ? t('harness.btn.partner', { name: nameOf(job.by) }) : t('harness.btn.tip');
    return { p, state, label };
  }

  /** The phone farm menu's tile (ui/layout.js, beside the ideas tile); null while the server does not offer the helper. */
  function tile(closeSheet) {
    if (!st.enabled) return null;
    const { state, label } = buttonState();
    const dot = state === 'ready' || state === 'fail' ? h('span.hx-tile-dot', { 'aria-hidden': 'true' }, state === 'fail' ? '!' : '') : null;
    return h('button.m-tile.hx-tile', { type: 'button', 'aria-label': label, dataset: { harness: 'open', state }, on: { click: () => { closeSheet?.(); onButton(); } } },
      h('span.m-ico', glyph('helper', 30), dot), h('span.lbl', t('harness.btn.label')));
  }

  function renderDock() {
    if (!st.enabled) { dock.hidden = true; gap.hidden = true; return; }
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
    btnDot.hidden = !(btnState === 'ready' || btnState === 'fail');
    btnDot.textContent = btnState === 'fail' ? '!' : '';
    const panelUp = ui.panels.isOpen('helper') || ui.panels.isOpen('helper-ready');
    const hideKey = p && job ? `${job.id}:${p.tone}` : null;
    pill.hidden = !p || panelUp || (hideKey !== null && pillHidden === hideKey);
    pill.dataset.tone = tone;
    pillLine.textContent = pillText(p);
    pillIco.replaceChildren(p && (p.tone === 'ready') ? glyph('sparkle', 24) : p && p.tone === 'fail' ? glyph('cross', 22)
      : p && p.tone === 'partnerReady' ? glyph('sparkle', 22) : h('span.hx-spin'));
    const at = p && job ? (job.state === 'ready' ? 4 : M.stepIndex(p.step)) : -1;
    [...pillDots.children].forEach((d, i) => { d.className = i < at ? 'done' : i === at ? 'now' : ''; });
    pillDots.hidden = !p || p.tone === 'fail';
    const go = p && p.tone === 'ready' ? t('harness.pill.readyGo') : p && p.tone === 'fail' ? t('harness.pill.failedGo') : '';
    pillGo.textContent = go;
    pillGo.hidden = !go;
    pillMain.setAttribute('aria-label', [t('harness.pill.title'), pillText(p), go].filter(Boolean).join(': '));
    pillX.setAttribute('aria-label', t('harness.pill.hide'));
    pillX.title = t('harness.pill.hide');
    // the screen reader hears each new step once, not every progress note
    const say = p ? [pillText(p), go].filter(Boolean).join(' ') : '';
    if (say !== lastSaid) { lastSaid = say; live.textContent = say; }
  }

  function onButton() {
    if (ui.panels.isOpen('helper')) { ui.panels.close('helper'); return; }
    if (isMineOpen() && st.job.state === 'ready') { openReady(); return; }
    open();
  }
  function onPill() {
    const p = M.pillOf(st.job, me());
    if (p && p.tone === 'ready') openReady();
    else open('ask');
  }
  function hidePill() {
    const p = M.pillOf(st.job, me());
    if (p && st.job) pillHidden = `${st.job.id}:${p.tone}`;
    renderDock();
    btn.focus?.({ preventScroll: true });
  }

  function open(tab = 'ask') { return ui.panels.open('helper', { tab }); }
  function openReady() {
    if (!st.job) return false;
    return ui.panels.isOpen('helper-ready') ? true : ui.panels.open('helper-ready', { job: st.job.id });
  }

  ui.panels.on('open', (n) => { if (n === 'helper') btn.setAttribute('aria-expanded', 'true'); renderDock(); });
  ui.panels.on('close', (n) => {
    if (n === 'helper') btn.setAttribute('aria-expanded', 'false');
    renderDock();
    if (ui.panels.top()) return;
    if (wantReady && isMineOpen() && st.job.state === 'ready') { wantReady = false; later(() => { if (!ui.panels.top()) openReady(); }, 400); return; }
    wantReady = false;
    if (wantLetter) { wantLetter = false; later(() => checkLetters(), 400); }
  });
  onLang(() => {
    pillMain.querySelector('.hx-pill-title').textContent = t('harness.pill.title');
    renderDock();
  });

  // ---- data ---------------------------------------------------------------------------------------------------
  function setJob(job, source = 'push') {
    const prev = st.job;
    if (job && prev && job.id === prev.id && Number(job.updatedAt) < Number(prev.updatedAt)) return;   // an older push
    lastJobAt = Date.now();
    let next = job && typeof job === 'object' && job.state ? job : null;
    if (next && M.ENDED.has(next.state) && !(next.state === 'failed' && !dismissed.has(next.id))) next = null;
    // a new job or a new round starts clean: no "rebuild on top" or old refusal left over from the last pop-up
    if (!next || next.id !== prev?.id || next.round !== prev?.round) { st.stale = false; st.readyFlash = null; }
    st.job = next;
    const mine = next && next.by === me();
    if (mine && next.state === 'ready') {
      const k = `${next.id}:${next.round ?? 1}`;
      if (!readyShown.has(k)) {
        readyShown.add(k);
        if (!ui.panels.top() || ui.panels.top() === 'helper') openReady();
        else wantReady = true;
      }
    }
    if (job && job.state === 'cancelled' && prev && prev.id === job.id && M.ACTIVE.has(prev.state) && job.by === me() && source !== 'rest') {
      ui.toast(t('harness.job.cancelled'), { kind: 'info', ms: 4000 });
    }
    // the pop-up shows the current job while it is ready, being applied, or failed; anything else closes it
    if (ui.panels.isOpen('helper-ready') && !(next && ['ready', 'applying', 'failed'].includes(next.state))) ui.panels.close('helper-ready');
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
        ui.notice?.(t('harness.suspended'));
        changed();
        return;
      case 'signin': {
        const s = M.signInFromPush(msg);
        if (s) applySignIn(s.provider, s);
        return;
      }
      case 'content':
        st.history = null;
        if (Number.isInteger(msg.n) && st.active && st.active.n !== msg.n) st.active = { ...st.active, n: msg.n };
        checkLetters(Array.isArray(msg.text?.letters) ? msg.text.letters : msg.suspended || msg.n === null ? [] : null);
        changed();
        return;
      default:
    }
  }

  function sayApplied(msg) {
    const k = `a${msg.n}`;
    if (heard.has(k)) return;
    heard.add(k);
    const line = M.appliedLine(msg, me(), players(), lang());
    ui.toast(t(line.key, { ...line.params, things: list(line.params.things ?? []) }), { kind: 'ok', ms: 6000 });
  }
  function onApplied(msg) {
    sayApplied(msg);
    st.active = { ...(st.active ?? {}), n: msg.n, by: msg.by, title: msg.title ?? null };
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
      const line = M.undoneLine(msg, me(), players());
      ui.toast(t(line.key, line.params), { kind: 'info', ms: 5000 });
    }
    if (Number.isInteger(msg.n)) st.active = { ...(st.active ?? {}), n: msg.n, by: msg.by };
    st.history = null;
    changed();
  }

  // ---- letters a change brings (contract §1.8: once per farmer, after the version that adds them) -----------------
  // the bus's content event carries the overlay's letters; otherwise the installed overlay is asked
  let knownLetters = null;
  function checkLetters(fromEvent = null) {
    if (Array.isArray(fromEvent)) knownLetters = fromEvent;
    let list = knownLetters;
    if (!list) {
      let ov = null;
      try { ov = overlayApi?.installedOverlay?.() ?? null; } catch { ov = null; }
      list = ov?.text?.letters;
    }
    const letters = Array.isArray(list) ? list.filter((l) => l && typeof l.id === 'string') : [];
    const pid = me();
    if (!letters.length || !pid) return;
    const seen = kv.get(M.lettersKey(scope), {}) || {};
    const mine = new Set(Array.isArray(seen[pid]) ? seen[pid] : []);
    const next = letters.find((l) => !mine.has(l.id));
    if (!next) return;
    if (ui.panels.top()) { wantLetter = true; return; }
    mine.add(next.id);
    kv.set(M.lettersKey(scope), { ...seen, [pid]: [...mine].slice(-200) });
    ui.panels.open('helper-letter', { id: next.id, letter: next });
  }

  // ---- asking -------------------------------------------------------------------------------------------------
  function flash(key, params = {}, tone = 'info', where = 'flash') { st[where] = key ? { key, params, tone } : null; changed(); }

  async function ask(text) {
    const prompt = M.cleanPrompt(text);
    if (!prompt) {
      flash(String(text ?? '').trim().length > M.PROMPT_MAX ? 'harness.ask.tooLong' : 'harness.ask.empty', { max: M.PROMPT_MAX }, 'bad');
      return false;
    }
    if (st.busy.start) return false;
    const pid = currentProvider();
    const prov = providerOf(pid);
    if (!prov || !prov.signedIn) {
      st.pendingAsk = prompt;
      st.draft = prompt;
      flash('harness.ask.signInFirst', {}, 'info');
      if (prov && prov.available !== false) startSignIn(prov.id);
      open('accounts');
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
      if (!prefs.asked) { prefs.asked = true; savePrefs(); }
      pillHidden = null;
      setJob(r.data.job, 'rest');
      flash('harness.ask.sent', {}, 'ok');
      return true;
    }
    if (r.code === 'SIGN_IN') {
      st.pendingAsk = prompt;
      if (prov) { prov.signedIn = false; startSignIn(prov.id); }
      flash('harness.signin.needed', { provider: V.providerLabel(prov.id) }, 'info');
      open('accounts');
      return false;
    }
    if (r.code === 'BUSY' && r.data?.job) setJob(r.data.job, 'rest');
    flash(M.errKey(r.code), {}, 'bad');
    return false;
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
    st.signins[p] = { provider: p, state: 'pending' };
    stopSignInPoll(p);
    changed();
    const r = await api.signIn(p, method ? { method } : {});
    const s = r.ok ? unwrapSignIn(r.data) : null;
    if (!st.signins[p]) return;                                  // cancelled meanwhile
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
      changed();
      if (st.pendingAsk && !st.busy.start) {
        const q = st.pendingAsk;
        st.pendingAsk = null;
        later(() => { ask(q); }, 0);
      }
      return;
    }
    if (s.state === 'signed_out') {
      if (prov) { prov.signedIn = false; delete prov.account; }
      if (prev && prev.state !== 'pending') delete st.signins[p];
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
      const r = await api.signInStatus(p);
      const s = r.ok ? unwrapSignIn(r.data) : null;
      if (s && st.signins[p] && (s.state !== 'pending' || JSON.stringify(s.step) !== JSON.stringify(st.signins[p].step))) applySignIn(p, s);
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
    if (s) { applySignIn(p, s); if (s.state !== 'signed_in' && !s.error && st.signins[p]) changed(); return; }
    if (st.signins[p]) st.signins[p] = { ...st.signins[p], error: { code: r.code } };
    changed();
  }
  function cancelSignIn(p) { stopSignInPoll(p); delete st.signins[p]; st.pendingAsk = null; changed(); }
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
      const things = M.changeRows(job.result?.changes, lang()).filter((c) => c.op === 'add' || c.op === 'revive').map((c) => c.name);
      const n = active?.n ?? job.result?.candidate;
      st.job = null;
      ui.panels.close('helper-ready');
      // the server's `hx applied` says it to both farmers; if it never comes (a lost push), say it here
      if (Number.isInteger(n)) later(() => sayApplied({ by: me(), n, names: things.map((x) => ({ en: x, bg: x })), title: active?.title }), FALLBACK_MS);
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
    const yes = await ui.confirm({ title: t(ready ? 'harness.ready.discardTitle' : 'harness.job.stopTitle'), lead: t('harness.job.stopLead', { name: who }),
      ok: t(ready ? 'harness.ready.discardOk' : 'harness.job.stopPartner'), cancel: t('harness.job.stopKeep'), okKind: 'stop', glyph: 'close' });
    if (!yes || st.busy.cancel) return;
    st.busy.cancel = true;
    changed();
    const r = ready ? await api.discard(job.id) : await api.cancel(job.id);
    st.busy.cancel = false;
    if (r.ok || r.code === 'NOT_FOUND') { setJob(r.data?.job ?? { ...job, state: ready ? 'discarded' : 'cancelled', updatedAt: Date.now() }, 'rest'); changed(); return; }
    flash(M.errKey(r.code), {}, 'bad');
  }

  function dismissJob(job) { dismissed.add(job.id); if (st.job?.id === job.id) st.job = null; ui.panels.close('helper-ready'); changed(); }
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
  async function undo(to, targetN) {
    const yes = await ui.confirm({ title: t('harness.hist.confirmTitle'),
      lead: Number.isInteger(targetN) && targetN > 0 ? t('harness.hist.confirmLead', { n: targetN }) : t('harness.hist.confirmLeadBase'),
      ok: t('harness.hist.confirmOk'), cancel: t('harness.hist.confirmKeep'), okKind: 'stop', glyph: 'rotl' });
    if (!yes || st.busy.undo) return;
    st.busy.undo = true;
    st.histFlash = null;
    changed();
    const r = await api.undo(Number.isInteger(to) ? to : undefined);
    st.busy.undo = false;
    if (r.ok) {
      const active = r.data?.active ?? null;
      if (active) st.active = active;
      if (Number.isInteger(active?.n)) later(() => onUndone({ by: me(), n: active.n }), FALLBACK_MS);
      st.history = null;
      await loadHistory();
      return;
    }
    st.histFlash = { key: M.errKey(r.code), tone: 'bad' };
    changed();
  }

  // ---- the helper panel ----------------------------------------------------------------------------------------
  const flashEl = (f) => (f ? h(`p.hx-flash.tone-${f.tone ?? 'info'}`, { role: f.tone === 'bad' ? 'alert' : 'status' }, t(f.key, f.params ?? {})) : null);

  function providerLine() {
    const id = currentProvider();
    const prov = providerOf(id);
    if (!prov || !prov.signedIn) {
      return h('div.hx-using.is-off', h('span', t('harness.ask.signInFirst')),
        h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { act: 'accounts' }, on: { click: () => S.ui.panels.open('helper', { tab: 'accounts' }) } }, t('harness.prov.signIn')));
    }
    const label = prov.account?.label ? t('harness.ask.usingAccount', { provider: V.providerLabel(id), account: prov.account.label }) : t('harness.ask.using', { provider: V.providerLabel(id) });
    return h('div.hx-using', glyph('check', 18), h('span', label),
      h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'accounts' }, on: { click: () => S.ui.panels.open('helper', { tab: 'accounts' }) } }, t('harness.ask.change')));
  }

  function askForm(ctx) {
    const id = 'hx-prompt';
    const area = h('textarea.field.hx-prompt', { id, rows: '4', maxlength: String(M.PROMPT_MAX), placeholder: t('harness.ask.placeholder'),
      'aria-describedby': 'hx-prompt-count', 'aria-keyshortcuts': 'Control+Enter' });
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
      mic = h('button.hx-mic', { type: 'button', on: { click: () => {
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
    const go = h('button.btn.hx-go', { type: 'button', dataset: { act: 'ask' }, on: { click: () => ask(area.value) } }, glyph('sparkle', 22), t('harness.ask.go'));
    const examples = h('div.hx-examples', h('span.hx-sub', t('harness.ask.examples')),
      h('div.hx-chips-row', ['ex1', 'ex2', 'ex3', 'ex4'].map((k) => h('button.hx-example', { type: 'button', on: { click: () => {
        area.value = t(`harness.ask.${k}`);
        st.draft = area.value;
        paintCount();
        area.focus?.();
      } } }, t(`harness.ask.${k}`)))));
    const form = h('div.hx-form',
      h('label.hx-label', { for: id }, t('harness.ask.label')),
      h('div.hx-prompt-wrap', area, mic),
      h('div.hx-form-foot', listen, count),
      h('div.hx-actions', go),
      examples,
      dictation.supported ? h('p.hx-sub.hx-mic-note', t('harness.mic.note')) : null);
    const paint = () => {
      const busyOther = st.job && M.OPEN.has(st.job.state);
      form.hidden = Boolean(busyOther) || Boolean(st.pendingConsent);
      go.disabled = Boolean(st.busy.start);
      go.setAttribute('aria-busy', String(Boolean(st.busy.start)));
    };
    paint();
    ctx.on(events, 'change', paint);
    return { el: form, area, stop: () => dictation.stop() };
  }

  function mountAsk(body, ctx) {
    const using = section('div.hx-sec', () => JSON.stringify([currentProvider(), st.providers.map((p) => [p.id, p.signedIn, p.account?.label, p.available]), lang()]), providerLine);
    // the card rebuilds only when what it says changes (not on every progress note): a press is never lost to a push
    const jobKey = () => { const j = st.job; return j ? JSON.stringify([j.id, j.state, j.step, j.round, j.by, j.error, j.prompts?.length, Boolean(j.result)]) : ''; };
    const notes = section('div.hx-sec', () => JSON.stringify([st.job?.id, st.job?.state, M.noteRows(st.job, lang()), lang()]), () => (st.job ? V.jobNotes(st.job, lang()) : null));
    const job = section('div.hx-sec', () => JSON.stringify([jobKey(), st.busy.cancel, st.busy.start, lang()]), () => {
      if (!st.job) return null;
      return V.jobCard(st.job, { me: me(), nameOf, lang: lang(), busy: Boolean(st.busy.cancel || st.busy.start), notes: false,
        onCancel: (j) => (j.by === me() ? cancelJob(j) : stopForPartner(j)), onSee: () => openReady(), onRetry: (text) => retryJob(st.job, text), onDismiss: (j) => dismissJob(j),
        onKeepPlaying: () => ctx.close(), onSignIn: (p) => { startSignIn(p); ui.panels.open('helper', { tab: 'accounts' }); } });
    });
    const busyLine = section('div.hx-sec', () => JSON.stringify([st.job?.by, st.job?.state, lang()]), () => {
      if (!st.job || !M.OPEN.has(st.job.state) || st.job.by === me()) return null;
      const n = nameOf(st.job.by);
      return h('p.hx-busy', n ? t('harness.ask.busyPartner', { name: n }) : t('harness.ask.busy'));
    });
    const consent = section('div.hx-sec', () => JSON.stringify([st.pendingConsent, st.busy.consent, st.consentError, lang()]), () => (st.pendingConsent
      ? V.consentCard({ busy: Boolean(st.busy.consent), error: st.consentError, privacy: privacyHref(), onYes: () => answerConsent(true), onNo: () => answerConsent(false) }) : null));
    const note = section('div.hx-sec', () => JSON.stringify([st.flash, lang()]), () => flashEl(st.flash));
    const form = askForm(ctx);
    // the intro leads only until this device's first request; after that it waits, folded, under the form
    const intro = section('div.hx-sec', () => JSON.stringify([Boolean(prefs.asked), Boolean(st.job), lang()]), () => (prefs.asked || st.job ? null : h('p.hx-intro', t('harness.intro'))));
    const more = h('details.hx-more', h('summary', t('harness.whatCan')), h('p', t('harness.intro')), h('p', t('harness.can')), h('p', t('harness.cannot')));
    body.append(intro.el, job.el, notes.el, busyLine.el, consent.el, using.el, form.el, note.el, more);
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
    const draw = () => {
      intro.update(); using.update(); job.update(); notes.update(); busyLine.update(); consent.update(); note.update();
      const nowConsent = Boolean(st.pendingConsent);
      const jobId = st.job?.id ?? null;
      if (nowConsent && !hadConsent && lost()) consent.el.querySelector('.hx-consent')?.focus?.();
      else if (jobId && jobId !== hadJob && lost()) job.el.querySelector('.hx-job')?.focus?.();
      hadConsent = nowConsent;
      hadJob = jobId;
    };
    draw();
    ctx.on(events, 'change', draw);
    if (!st.job && !st.pendingConsent) queueMicrotask?.(() => form.area.focus?.({ preventScroll: true }));
    return { destroy: () => form.stop() };
  }

  function mountAccounts(body) {
    const lead = h('p.hx-sub', t('harness.prov.lead'));
    const cardCtx = () => ({
      current: currentProvider(), models: st.models, model: prefs.model, busy: Boolean(st.busy.signin),
      onUse: (p) => useProvider(p), onSignIn: (p, m) => startSignIn(p, m), onSignOut: (p) => signOut(p), onModel: (p, m) => setModel(p, m),
      flow: (p) => (st.signins[p] ? V.signInFlow(p, st.signins[p], { busy: Boolean(st.busy.signin), onContinue: continueSignIn, onCancel: cancelSignIn,
        onRestart: (x) => startSignIn(x), onCopy: (u) => copyText(u) }) : null),
    });
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
            currentProvider() === id ? prefs.model : null, st.busy.signin, lang()]), () => {
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
    const note = section('div.hx-sec', () => JSON.stringify([st.flash, lang()]), () => flashEl(st.flash));
    body.append(h('h3.hx-h', t('harness.prov.title')), lead, note.el, sec.el);
    let flows = '';
    const draw = () => {
      sec.update();
      note.update();
      // a sign-in that just started comes into view, its first step under the finger
      const now = Object.keys(st.signins).sort().join(',');
      if (now !== flows) {
        const fresh = Object.keys(st.signins).find((p) => !flows.split(',').includes(p));
        flows = now;
        const el = fresh ? body.querySelector(`[data-signin="${fresh}"]`) : null;
        el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
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
      return [flashEl(st.histFlash), V.historyList(st.history, { lang: lang(), nameOf, busy: Boolean(st.busy.undo), onUndo: (to, n) => undo(to, n) })];
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
      if (ctx.tab === 'history') { ctx.on(events, 'change', mountHistory(body)); return {}; }
      if (ctx.tab === 'accounts') { ctx.on(events, 'change', mountAccounts(body)); return {}; }
      return mountAsk(body, ctx);
    },
    onClose() { st.flash = null; },
  });

  // ---- the changes-ready pop-up ------------------------------------------------------------------------------
  const readyTitle = () => {
    const job = st.job;
    if (job && job.state === 'failed') return t('harness.ready.titleFailed');
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
      const reviseArea = h('textarea.field.hx-prompt.hx-revise-text#hx-revise', { rows: '3', maxlength: String(M.PROMPT_MAX), placeholder: t('harness.ready.revisePlaceholder') });
      reviseArea.value = st.revDraft ?? '';
      reviseArea.addEventListener('input', () => { st.revDraft = reviseArea.value; });
      const readIco = h('span.hx-read-ico', { 'aria-hidden': 'true' });
      const readLabel = h('span');
      const readBtn = reader.supported ? h('button.hx-read', { type: 'button', dataset: { act: 'read' }, on: { click: () => toggleRead() } }, readIco, readLabel) : null;
      const rebuildBtn = h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { act: 'rebuild' },
        on: { click: () => { if (st.job) revise(st.job, t('harness.ready.rebuildPrompt')); } } }, t('harness.ready.rebuild'));
      const staleBox = h('div.hx-stale', { role: 'alert', hidden: true }, h('p', t('harness.ready.stale')), rebuildBtn);
      const flashBox = h('div.hx-sec');
      const sendBtn = h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { act: 'reviseSend' },
        on: { click: () => { if (st.job) revise(st.job, reviseArea.value); } } }, t('harness.ready.reviseSend'));
      const reviseBox = h('div.hx-revise', { hidden: true }, h('label.hx-label', { for: 'hx-revise' }, t('harness.ready.reviseLabel')), reviseArea, h('div.hx-actions', sendBtn));
      const applyBtn = h('button.btn.hx-apply', { type: 'button', dataset: { act: 'apply' }, on: { click: () => { if (st.job) apply(st.job); } } });
      const reviseBtn = h('button.btn.btn--sky', { type: 'button', dataset: { act: 'revise' },
        on: { click: () => { reviseOpen = !reviseOpen; paint(); if (reviseOpen) reviseArea.focus?.(); } } }, t('harness.ready.revise'));
      const discardBtn = h('button.btn.btn--paper', { type: 'button', dataset: { act: 'discard' }, on: { click: () => { if (st.job) discard(st.job); } } }, t('harness.ready.discard'));
      const summaryOf = () => M.pickText(st.job?.result?.summary, lang());
      function toggleRead() {
        if (speaking) { reader.stop(); speaking = false; paint(); return; }
        speaking = reader.speak(summaryOf(), lang(), { onEnd: () => { speaking = false; paint(); } });
        paint();
      }
      const main = section('div.hx-ready-main', () => JSON.stringify([st.job?.id, st.job?.round, st.job?.by, st.job?.state === 'failed', Boolean(st.job?.result), lang()]), () => {
        const job = st.job;
        if (!job) return h('p.hx-none', t('harness.ready.none'));
        const mine = job.by === me();
        if (job.state === 'failed') {
          return [h('p.hx-job-failed', glyph('cross', 22), h('span', t('harness.job.nothingChanged'))),
            h('h3.hx-h', t('harness.job.failedWhy')), V.errorList(job, lang()),
            job.result?.validation ? h('h3.hx-h', t('harness.ready.tests')) : null, V.testList(job.result?.validation),
            h('div.hx-actions.hx-ready-acts',
              mine ? h('button.btn', { type: 'button', dataset: { act: 'retry' }, on: { click: () => retryJob(job, String(job.prompts?.at(-1)?.text ?? '')) } }, t('harness.job.retry')) : null,
              h('button.btn.btn--paper', { type: 'button', dataset: { act: 'dismiss' }, on: { click: () => (mine ? dismissJob(job) : ctx.close()) } }, t('harness.job.dismiss')))];
        }
        const res = job.result && typeof job.result === 'object' ? job.result : {};
        const summary = summaryOf();
        const out = [];
        if (summary) {
          out.push(h('section.hx-summary', { 'aria-labelledby': 'hx-sum-h' }, h('h3.hx-h#hx-sum-h', t('harness.ready.summary')),
            h('p.hx-summary-text', summary), readBtn));
        }
        out.push(h('div.hx-ready-cols',
          h('section.hx-col', { 'aria-labelledby': 'hx-ch-h' }, h('h3.hx-h#hx-ch-h', t('harness.ready.changes')), V.changeList(res.changes, lang())),
          res.validation ? h('section.hx-col', { 'aria-labelledby': 'hx-ts-h' }, h('h3.hx-h#hx-ts-h', t('harness.ready.tests')), V.testList(res.validation)) : null));
        if (!mine) {
          out.push(h('p.hx-sub', nameOf(job.by) ? t('harness.ready.notYours', { name: nameOf(job.by) }) : t('harness.err.NOT_YOURS')),
            h('div.hx-actions.hx-ready-acts', h('button.btn.btn--paper', { type: 'button', on: { click: () => ctx.close() } }, t('harness.ready.later'))));
          return out;
        }
        out.push(staleBox, flashBox, reviseBox, h('div.hx-actions.hx-ready-acts', applyBtn, reviseBtn, discardBtn),
          h('p.hx-sub.hx-undo-note', t('harness.ready.undoNote')));
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
      queueMicrotask?.(() => (applyBtn.isConnected && !applyBtn.disabled ? applyBtn : body.querySelector('[data-act="retry"], button'))?.focus?.({ preventScroll: true }));
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
      let from = null;
      if (l?.from) {
        try { from = contentName(l.from); } catch { from = null; }
        if (!from || from === l.from) from = String(l.from).replace(/^./, (c) => c.toUpperCase());
      }
      body.append(V.letterCard(l, lang(), from), h('div.hx-actions', h('button.btn', { type: 'button', on: { click: () => ctx.close() } }, t('harness.job.dismiss'))));
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
    const rows = [
      h('h3', t('harness.set.title')),
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
      if (pollT) clearInterval(pollT);
      for (const id of signinPolls.values()) clearInterval(id);
      signinPolls.clear();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      dictation.stop();
      reader.stop();
      dock.remove();
      gap.remove();
    },
  };
}

