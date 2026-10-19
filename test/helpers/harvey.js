// Release 1.0 harvey lane: the helper's screens against a stand-in shell, a store with a farm (level, season) and a
// scripted server (the same shapes as test/ui-harness.dom.test.js, plus toast actions and the farm's level). Import
// AFTER the DOM stand-in is installed (test/ui-qa2-dom.js installDom).
import assert from 'node:assert/strict';
import { xpForLevel } from '../../shared/content/index.js';

/** Every text node under `el`, joined with spaces (the stand-in DOM has no layout to put them apart). */
export function textOf(el) {
  const out = [];
  const walk = (n) => { if (!n) return; if (!n.childNodes || (n.data !== undefined && !n.tagName)) { if (n.data) out.push(n.data); return; } n.childNodes.forEach(walk); };
  walk(el);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

export function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() };
}

export const tick = (n = 3) => new Promise((r) => { let i = 0; const go = () => (++i >= n ? r() : setTimeout(go, 0)); setTimeout(go, 0); });
export const click = (el) => { assert.ok(el, 'the button is there'); el.click(); };

/** The shell's panel registry as far as the helper uses it; toasts keep their options (an action: Show me, Undo). */
export function fakeShell() {
  const specs = new Map();
  const stack = [];
  const entries = new Map();
  const handlers = { open: new Set(), close: new Set() };
  const toasts = [];
  const toastOpts = [];
  const notices = [];
  const confirms = [];
  const opened = [];
  const shell = { confirmAnswer: true, reopenInPlace: false };
  const panels = {
    register(name, spec) { specs.set(name, spec); return () => specs.delete(name); },
    has: (n) => specs.has(n),
    isOpen: (n) => stack.includes(n),
    top: () => stack.at(-1) ?? null,
    open(name, args = {}, { stack: onTop = false } = {}) {
      opened.push([name, args]);
      const spec = specs.get(name);
      if (!spec) return false;
      if (stack.includes(name) && shell.reopenInPlace) {
        // as the real shell does (ui/index.js open): an open panel asked for other args re-mounts in its frame, without
        // its onClose (QA r1 H-10: a flash set just before open('accounts') survives the switch of tab)
        const old = entries.get(name);
        for (const off of old.cleanups) off();
        old.inst.destroy?.();
        old.body.remove();
        stack.splice(stack.indexOf(name), 1);
      } else if (stack.includes(name)) panels.close(name);
      if (!onTop) for (const n of [...stack]) panels.close(n);
      const tabs = typeof spec.tabs === 'function' ? spec.tabs(args) : spec.tabs;
      const body = document.createElement('div');
      const e = { name, body, cleanups: [], args, title: '' };
      const ctx = {
        name, args, tab: args.tab ?? tabs?.[0]?.id ?? null, ui: { panels }, body,
        close: () => panels.close(name), setTitle: (x) => { e.title = String(x); },
        on(target, ev, fn) { const off = target.on(ev, fn); e.cleanups.push(off); return off; },
      };
      e.title = typeof spec.title === 'function' ? spec.title(args) : spec.title;
      e.inst = spec.mount(body, ctx) || {};
      document.body.append(body);
      stack.push(name);
      entries.set(name, e);
      for (const fn of [...handlers.open]) fn(name, args);
      return true;
    },
    close(name) {
      const i = stack.indexOf(name);
      if (i < 0) return false;
      stack.splice(i, 1);
      const e = entries.get(name);
      for (const off of e.cleanups) off();
      e.inst.destroy?.();
      e.body.remove();
      specs.get(name).onClose?.();
      for (const fn of [...handlers.close]) fn(name);
      return true;
    },
    on(ev, fn) { handlers[ev]?.add(fn); return () => handlers[ev]?.delete(fn); },
  };
  const ui = {
    panels,
    toast: (x, o = {}) => { toasts.push(String(x)); toastOpts.push(o); },
    notice: (x) => { notices.push(String(x)); },
    confirm: async (o) => { confirms.push(o); return shell.confirmAnswer; },
  };
  return Object.assign(shell, { ui, panels, toasts, toastOpts, notices, confirms, opened, body: (n) => entries.get(n)?.body, entry: (n) => entries.get(n) });
}

/** A store with two farmers and a farm at `level` in Sofia (14 Oct 2026 is autumn there). */
export function fakeStore(pid = 'p1', { level = 21, objects = {} } = {}) {
  const subs = new Map();
  return {
    pid,
    now: () => Date.UTC(2026, 9, 14, 10, 0),
    state: { players: { p1: { name: 'Rowan' }, p2: { name: 'Mia' } }, meta: { tz: 'Europe/Sofia' }, farm: { xp: xpForLevel(level), objects } },
    on(ev, fn) { if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev).add(fn); return () => subs.get(ev).delete(fn); },
    emit(ev, x) { for (const fn of subs.get(ev) ?? []) fn(x); },
  };
}

export const VALID = { ok: true, stage: 'done', full: true, checks: { schema: { ok: true, files: 5 }, semantic: { ok: true },
  boot: { ok: true, simHours: 48, actions: 212, econ: { coinsBp: 10350, xpBp: 10120 }, retire: true }, render: { ok: true, models: 2, icons: 4 } } };
export const jobOf = (o = {}) => ({ id: 'j1', by: 'p1', provider: 'mock', model: null, state: 'working', step: 'building', round: 1,
  startedAt: Date.now() - 95_000, updatedAt: 2, lang: 'en', prompts: [{ at: 1, text: 'Give me 10000 coins' }], progress: [], result: null, error: null, ...o });

/** A scripted server: answers per method (a value or a function of the call's arguments), records every call. */
export function fakeApi(over = {}) {
  const calls = [];
  const ok = (data, status = 200) => ({ ok: true, status, data });
  const answers = {
    state: () => ok({ enabled: true, providers: [{ id: 'mock', available: true, signedIn: true, account: { label: 'test' } }],
      job: null, active: { n: 2, hash: 'h2', appliedAt: 1, by: 'p1', title: { en: 'Moonlight' } }, consent: { telemetry: true, sending: false }, limits: {} }),
    start: (b) => ok({ job: jobOf({ state: 'starting', step: 'reading', prompts: [{ at: 1, text: b.prompt }] }) }, 202),
    current: () => ok({ job: null }),
    revise: (id, prompt) => ok({ job: jobOf({ id, state: 'revising', step: 'reading', round: 2, updatedAt: 20, prompts: [{ at: 1, text: 'x' }, { at: 2, text: prompt }] }) }, 202),
    apply: () => ok({ active: { n: 3, hash: 'h3', appliedAt: 5, by: 'p1', title: { en: 'Moonlight' } } }),
    discard: (id) => ok({ job: jobOf({ id, state: 'discarded' }) }),
    cancel: (id) => ok({ job: jobOf({ id, state: 'cancelled', updatedAt: 99 }) }),
    history: () => ok({ active: 3, versions: [] }),
    undo: () => ok({ active: { n: 4, hash: 'h4', appliedAt: 6, by: 'p2' } }),
    consent: () => ok({ telemetry: false, at: 1, install: 'feedc0de'.repeat(4) }),
    setConsent: (v) => ok({ telemetry: v, at: 2, install: 'feedc0de'.repeat(4) }),
    providers: () => ok({ providers: [] }),
    models: () => ok({ models: [] }),
    signIn: (p) => ok({ signin: { provider: p, state: 'pending', step: { kind: 'open_url', url: `https://${p}.example/oauth?x=1`, expiresAt: 9e12 } } }),
    signInContinue: (p) => ok({ signin: { provider: p, state: 'signed_in', account: { label: `${p} plan` } } }),
    signInStatus: (p) => ok({ signin: { provider: p, state: 'pending' } }),
    signOut: (p) => ok({ signin: { provider: p, state: 'signed_out' } }),
    signInCancel: (p) => ok({ signin: { provider: p, state: 'signed_out' } }),
    ...over,
  };
  const api = {};
  for (const m of Object.keys(answers)) {
    api[m] = async (...a) => { calls.push([m, ...a]); const x = answers[m]; return typeof x === 'function' ? x(...a) : x; };
  }
  api.calls = calls;
  api.called = (m) => calls.filter((c) => c[0] === m);
  return api;
}

/**
 * A window that keeps its listeners (QA r3: the helper listens for the farm pointer and the coach on it): fire(type, ev)
 * calls them as the browser would; CustomEvent and Event for the helper's own events.
 */
export function fakeWin() {
  const subs = new Map();
  const call = (type, ev) => { for (const fn of [...(subs.get(type) ?? [])]) fn(ev); };
  return {
    addEventListener(type, fn) { if (!subs.has(type)) subs.set(type, new Set()); subs.get(type).add(fn); },
    removeEventListener(type, fn) { subs.get(type)?.delete(fn); },
    dispatchEvent(ev) { call(ev.type, ev); return true; },
    fire(type, ev = {}) { call(type, { type, ...ev }); },
    listeners: (type) => subs.get(type)?.size ?? 0,
    CustomEvent: class { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } },
    Event: class { constructor(type) { this.type = type; } },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One page: the HUD's right edge column, the shell, the store and the helper (H: the imported ui/harness/index.js).
 * `S`: more of the ui context (tutorial, controller); `opts`: more createHarnessUi options (QA r3: settleMs, idlePollMs,
 * signInPollMs).
 */
export async function page(H, { pid = 'p1', api = fakeApi(), overlayApi = null, win = {}, connect = true, level = 21, objects = {}, S = {}, opts = {},
  before = null } = {}) {
  document.body.replaceChildren();
  const edge = document.createElement('nav');
  edge.id = 'hud-right';
  document.body.append(edge);
  globalThis.localStorage.clear();
  const shell = fakeShell();
  const store = fakeStore(pid, { level, objects });
  before?.({ shell, store });
  const helper = H.createHarnessUi({ ui: shell.ui, store, ...S }, { api, bus: null, overlayApi, win, pollMs: 0, signInPollMs: 0, fallbackMs: 5, autoStart: false, ...opts });
  if (connect) await helper.connect({ force: true });
  await tick();
  return { shell, store, helper, api, edge, $: (sel) => document.body.querySelector(sel), $$: (sel) => document.body.querySelectorAll(sel) };
}
