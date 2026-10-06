// Multi-farm hosted mode, client side: never lose the key quietly, and a way back for every lost device
// (docs/agent-notes/mf-client.md "Keys"). This file runs as a page at /f/<id> (node --test gives every file its own
// process). It checks the rejoin link, the "Keep your farm safe" card and when it shows, the Settings dot and the
// Farmers rows ("Make a new key for Mia"), the gates of a re-keyed device and of a home-screen app without a key, and
// the home-screen manifest per platform. The QR code itself: test/ui-qr.test.js.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';

const ID = 'abcdefghij23';
const SECRET = 'a'.repeat(64);
const ORIGIN = 'https://hh.test';
const REJOIN = '0123456789abcdef0123456789abcdef';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    clear: () => m.clear(),
    keys: () => [...m.keys()],
  };
}

const reloads = [];
const assigns = [];
globalThis.location = { pathname: `/f/${ID}`, origin: ORIGIN, protocol: 'https:', host: 'hh.test', search: '', hash: '',
  reload: () => reloads.push(1), assign: (u) => assigns.push(u) };
globalThis.localStorage = memStorage();
globalThis.sessionStorage = memStorage();
installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

let F;
let G;
let K;
let T;
// a module this change adds is missing before it (each test then fails on its own assertion, not on the import)
const load = (p) => import(p).catch(() => ({}));
before(async () => {
  F = await load('../public/js/net/farm.js');
  G = await load('../public/js/ui/farm-gate.js');
  K = await load('../public/js/ui/keep.js');
  T = (await load('../public/js/i18n/en/keep.js')).default ?? {};
});

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const r = typeof routes === 'function' ? routes(url, opts) : routes[url];
    if (r instanceof Error) throw r;
    if (!r) return { ok: false, status: 404, headers: new Map(), json: async () => ({ error: 'not found' }) };
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: new Map(Object.entries(r.headers ?? {})),
      json: async () => { if (r.body === undefined) throw new Error('no json'); return r.body; } };
  };
  fn.calls = calls;
  return fn;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('launch links: ?rejoin= is read, validated and cleaned; a pasted rejoin link opens; the rejoin link is built here', () => {
  const loc = (search, hash) => ({ pathname: `/f/${ID}`, search, hash });
  assert.deepEqual(F.readLaunch(loc(`?rejoin=${REJOIN}`, '')), { key: null, join: null, rejoin: REJOIN });
  assert.equal(F.readLaunch(loc('?rejoin=<x>', '')).rejoin, null);
  assert.equal(F.cleanUrl(loc(`?quality=low&rejoin=${REJOIN}`, ''), { rejoin: true }), `/f/${ID}?quality=low`);
  assert.equal(F.cleanUrl(loc(`?rejoin=${REJOIN}`, '')), `/f/${ID}?rejoin=${REJOIN}`, 'kept until it is used');
  assert.equal(F.rejoinLink(ORIGIN, ID, REJOIN), `${ORIGIN}/f/${ID}?rejoin=${REJOIN}`);
  assert.deepEqual(G.parseFarmLink(`${ORIGIN}/f/${ID}?rejoin=${REJOIN}`, { origin: ORIGIN }), { id: ID, key: null, join: null, rejoin: REJOIN });
  assert.deepEqual(F.parseFarmLink(`${ORIGIN}/f/${ID}#k=${SECRET}`, { origin: ORIGIN }), { id: ID, key: SECRET, join: null, rejoin: null });
});

test('make a new key: the member key rides in the Authorization header only; refusals are told apart', async () => {
  const f = fakeFetch({ [`/api/f/${ID}/rekey`]: { status: 201, body: { pid: 'p2', token: REJOIN, expiresAt: 99 } } });
  assert.deepEqual(await F.createRekey(f, ID, SECRET, 'p2'), { ok: true, pid: 'p2', token: REJOIN, expiresAt: 99 });
  const { url, opts } = f.calls[0];
  assert.equal(url, `/api/f/${ID}/rekey`);
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers.authorization, `Bearer ${SECRET}`);
  assert.deepEqual(JSON.parse(opts.body), { pid: 'p2' }, 'the key never in the body or the URL');
  const code = async (r) => (await F.createRekey(fakeFetch({ [`/api/f/${ID}/rekey`]: r }), ID, SECRET, 'p2')).code;
  assert.equal(await code({ status: 429, body: { error: 'RATE' } }), 'RATE');
  assert.equal(await code({ status: 403, body: { error: 'AUTH' } }), 'AUTH');
  assert.equal(await code({ status: 400, body: { error: 'BAD_REQUEST' } }), 'BAD');
  assert.equal(await code(new Error('offline')), 'NET');
  assert.equal((await F.createRekey(f, ID, null, 'p2')).code, 'AUTH', 'no key: no request');
  assert.equal(f.calls.length, 1);
});

/** The shell the keep card uses: panels, confirm, toasts, the store with fx / welcome events. */
function shell({ players = { p1: { name: 'Rowan', xp: 0, lastSeenAt: 1 } }, pid = 'p1', state = {} } = {}) {
  const panels = new Map();
  const open = new Set();
  const opened = [];
  const listeners = { fx: [], welcome: [] };
  const confirms = [];
  const toasts = [];
  const store = { state: { players, farm: { coop: {}, ...state }, meta: {} }, pid, now: () => Date.now(),
    on: (ev, fn) => { (listeners[ev] ||= []).push(fn); return () => {}; } };
  const ui = {
    panels: {
      register: (n, spec) => { panels.set(n, spec); return () => {}; },
      open: (n, args) => { opened.push([n, args]); open.add(n); return true; },
      close: (n) => { open.delete(n); },
      isOpen: (n) => open.has(n),
      list: () => [...panels.keys()].map((name) => ({ name, size: panels.get(name).size ?? 'side', open: open.has(name) })),
      on: () => () => {},
    },
    confirm: async (o) => { confirms.push(o); return shell.answer ?? true; },
    toast: (t) => toasts.push(t),
    banner: () => null,
  };
  return { S: { store, ui }, panels, open, opened, listeners, confirms, toasts, store,
    emit: (ev, payload) => (listeners[ev] || []).forEach((fn) => fn(payload)) };
}
function mount(spec, args = {}) {
  const body = document.createElement('div');
  document.body.append(body);
  const ctx = { body, args, close: () => {} };
  spec.mount(body, ctx);
  return body;
}
/** A manual clock and timer queue for the scheduler. */
function clock(start = Date.UTC(2026, 9, 5, 9)) {
  let t = start;
  const q = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const e = { at: t + ms, fn }; q.push(e); return e; },
    clearTimer: (e) => { const i = q.indexOf(e); if (i >= 0) q.splice(i, 1); },
    advance(ms) {
      t += ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at);
        if (!q.length || q[0].at > t) break;
        q.shift().fn();
      }
    },
  };
}

test('the keep card: after my first finished guide step (not at load), once a day, never in a modal or Golden Hour, never after "I saved it"', () => {
  localStorage.clear();
  const c = clock();
  const sh = shell();
  F.session.secret = SECRET;
  K.createKeepUi(sh.S, { now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  assert.ok(sh.panels.has('keep'));
  // the first load: nothing
  sh.emit('welcome', {});
  c.advance(10 * 60_000);
  assert.equal(sh.opened.length, 0, 'not at first load');
  // the partner's step, a step not finished, the welcome card's "Let's go!" (the first load itself): nothing
  sh.emit('fx', { ev: { e: 'tutorialStep', done: true, pid: 'p2', step: 'name_farm' } });
  sh.emit('fx', { ev: { e: 'tutorialStep', done: false, pid: 'p1', step: 'plant_wheat' } });
  sh.emit('fx', { ev: { e: 'tutorialStep', done: true, pid: 'p1', step: 'welcome' } });
  c.advance(60_000);
  assert.equal(sh.opened.length, 0);
  // my first finished step, while a big panel is open: it waits for the panel to close
  sh.panels.set('market', { size: 'wide' });
  sh.open.add('market');
  sh.emit('fx', { ev: { e: 'tutorialStep', done: true, pid: 'p1', step: 'name_farm' } });
  c.advance(20_000);
  assert.equal(sh.opened.length, 0, 'never over a modal panel');
  sh.open.delete('market');
  c.advance(10_000);
  assert.deepEqual(sh.opened.map(([n]) => n), ['keep']);
  // the same day: never again
  sh.open.delete('keep');
  sh.emit('fx', { ev: { e: 'tutorialStep', done: true, pid: 'p1', step: 'plant_wheat' } });
  sh.emit('welcome', {});
  c.advance(30 * 60_000);
  assert.equal(sh.opened.length, 1, 'at most once a day');
  // the next day, at a welcome: again, a while into the visit, but not during Golden Hour
  c.advance(24 * 3_600_000);
  sh.store.state.farm.coop.golden = { from: c.now() - 1000, until: c.now() + 5 * 60_000 };
  sh.emit('welcome', {});
  c.advance(3 * 60_000);
  assert.equal(sh.opened.length, 1, 'never during Golden Hour');
  c.advance(5 * 60_000);
  assert.equal(sh.opened.length, 2, 'a later day, after Golden Hour');
  // "I saved it": never again, any day
  const body = mount(sh.panels.get('keep'));
  body.querySelector('[data-keep="saved"]').click();
  sh.open.delete('keep');
  for (let d = 0; d < 3; d++) {
    c.advance(24 * 3_600_000);
    sh.emit('welcome', {});
    sh.emit('fx', { ev: { e: 'tutorialStep', done: true, pid: 'p1', step: 'harvest_wheat' } });
    c.advance(30 * 60_000);
  }
  assert.equal(sh.opened.length, 2);
  assert.equal(JSON.parse(localStorage.getItem(`hh.f.${ID}.keySave`)).saved, true, 'remembered for this farm');
});

test('a farmer who played before this card existed sees it a while into a visit (no guide step needed)', () => {
  localStorage.clear();
  const c = clock();
  const sh = shell({ players: { p1: { name: 'Rowan', xp: 900 } } });
  K.createKeepUi(sh.S, { now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  sh.emit('welcome', {});
  c.advance(10_000);
  assert.equal(sh.opened.length, 0, 'not at the moment the farm opens');
  c.advance(5 * 60_000);
  assert.deepEqual(sh.opened.map(([n]) => n), ['keep']);
});

test('the keep card: Share to myself, Copy, a QR code, "I saved it"; persistent storage is asked for', async () => {
  localStorage.clear();
  const sh = shell({ players: { p1: { name: 'Rowan' }, p2: { name: 'Mia' } } });
  F.session.secret = SECRET;
  const shared = [];
  const copied = [];
  let persisted = 0;
  const nav = { share: async (d) => { shared.push(d); }, clipboard: { writeText: async (t) => { copied.push(t); } },
    storage: { persist: async () => { persisted++; return true; }, persisted: async () => false } };
  const keep = K.createKeepUi(sh.S, { nav });
  const body = mount(sh.panels.get('keep'));
  const text = textOf(body);
  assert.ok(text.includes(T['keep.lead']));
  assert.ok(text.includes('Mia can make you a new key'), text);
  const link = `${ORIGIN}/f/${ID}#k=${SECRET}`;
  body.querySelector('[data-keep="share"]').click();
  await tick();
  assert.equal(shared[0].url, link);
  assert.ok(!shared[0].text.includes(SECRET), 'the key rides only in the url');
  body.querySelector('[data-keep="copy"]').click();
  await tick();
  assert.deepEqual(copied, [link]);
  assert.equal(body.querySelector('.keep-qr svg'), null, 'no QR code until asked');
  body.querySelector('[data-keep="qr"]').click();
  const svg = body.querySelector('.keep-qr svg');
  assert.ok(svg, 'the QR code');
  assert.equal(svg.getAttribute('aria-label'), T['keep.qr.label']);
  assert.ok(persisted >= 1, 'navigator.storage.persist() was asked');
  assert.equal(keep.unsaved(), true);
  body.querySelector('[data-keep="saved"]').click();
  assert.equal(keep.unsaved(), false);
  // a farm with one farmer: the card says the link is the only way back
  localStorage.clear();
  const one = shell();
  K.createKeepUi(one.S, { nav });
  assert.ok(textOf(mount(one.panels.get('keep'))).includes(T['keep.why.alone']));
});

test('Settings: a quiet "not saved yet" dot and row until "I saved it"; Farmers: last here and "Make a new key for Mia"', async () => {
  localStorage.clear();
  const now = Date.now();
  const sh = shell({ players: { p1: { name: 'Rowan', lastSeenAt: now }, p2: { name: 'Mia', lastSeenAt: now - 2 * 86_400_000 } } });
  F.session.secret = SECRET;
  const keep = K.createKeepUi(sh.S, { nav: {} });
  const html = { dataset: {} };
  keep.paintDot(html);
  assert.equal(html.dataset.keep, 'unsaved');
  globalThis.fetch = fakeFetch((url, opts) => {
    if (url === `/api/f/${ID}/status`) return { body: { ok: true, member: true, pid: 'p1', waiting: {} } };
    if (url === `/api/f/${ID}/rekey`) { assert.equal(opts.headers.authorization, `Bearer ${SECRET}`); return { status: 201, body: { pid: 'p2', token: REJOIN, expiresAt: now + 7 * 86_400_000 } }; }
    return null;
  });
  const box = document.createElement('div');
  document.body.append(box);
  box.append(...keep.settingsRows({ close: () => {} }));
  await tick(); await tick();
  const t = textOf(box);
  assert.ok(t.includes(T['keep.set.unsaved']));
  assert.ok(box.querySelector('.keep-dot'), 'the dot');
  assert.ok(t.includes('Farmers'));
  assert.ok(t.includes('Last here 2 days ago'), t);
  assert.ok(!t.includes('Make a new key for Rowan'), 'never for myself');
  const btn = box.querySelector('[data-rekey="p2"]');
  assert.equal(textOf(btn), 'Make a new key for Mia');
  btn.click();
  await tick(); await tick(); await tick();
  assert.equal(sh.confirms.length, 1);
  assert.equal(sh.confirms[0].title, 'Make a new key for Mia?');
  assert.match(sh.confirms[0].lead, /old phones will be signed out/);
  assert.deepEqual(sh.opened.at(-1), ['newkey', { pid: 'p2' }]);
  const card = mount(sh.panels.get('newkey'), { pid: 'p2' });
  assert.equal(card.querySelector('.link-field').value, `${ORIGIN}/f/${ID}?rejoin=${REJOIN}`);
  assert.ok(textOf(card).includes('Send this link to Mia'));
  // saved: the dot goes
  mount(sh.panels.get('keep')).querySelector('[data-keep="saved"]').click();
  keep.paintDot(html);
  assert.equal(html.dataset.keep, 'saved');
  // "Not now" in the confirm: no request
  shell.answer = false;
  const made = () => globalThis.fetch.calls.filter((x) => x.url.endsWith('/rekey')).length;
  const before = made();
  box.querySelector('[data-rekey="p2"]').click();
  await tick(); await tick();
  assert.equal(made(), before, '"Not now": no request');
  shell.answer = undefined;
});

test('the gates of a lost device: re-keyed, a spent rejoin link, a home-screen app without a key; the private gate shows every way back', () => {
  localStorage.clear();
  for (const kind of ['rekeyed', 'rejoin', 'home', 'private']) {
    const el = G.showFarmGate(kind, { farmId: ID });
    const t = textOf(el);
    assert.equal(el.dataset.gate, kind);
    assert.ok(t.includes(G.GATE_TEXT[kind].title), kind);
    // the ways back, open (not folded away)
    if (kind !== 'home') assert.ok(t.includes(T['keep.gate.back.ask']), `${kind}: ask your partner`);
    assert.ok(el.querySelector('#farm-gate-link'), `${kind}: paste`);
    assert.ok(el.querySelector('[data-scan="photo"]'), `${kind}: scan a photo of the QR code`);
    assert.equal(el.querySelector('details.gate-key'), null, `${kind}: not folded`);
  }
  assert.match(G.GATE_TEXT.rekeyed.title, /given a new key/);
  // the used-invite and full gates keep the folded personal-link row
  assert.ok(G.showFarmGate('invite', { farmId: ID }).querySelector('details.gate-key'));
});

test('a pasted rejoin link on the gate opens it; a scanned QR code opens the farm the same way', async () => {
  localStorage.clear();
  assigns.length = 0;
  reloads.length = 0;
  const el = G.showFarmGate('rekeyed', { farmId: ID });
  el.querySelector('#farm-gate-link').value = `${ORIGIN}/f/${ID}?rejoin=${REJOIN}`;
  el.querySelector('.gate-row button').click();
  assert.deepEqual(assigns, [`/f/${ID}?rejoin=${REJOIN}`]);
  G.openScanned(`${ORIGIN}/f/${ID}#k=${SECRET}`, { farmId: ID });
  assert.equal(JSON.parse(localStorage.getItem(`hh.f.${ID}.key`)), SECRET, 'this farm\'s key kept here, then a reload');
  assert.equal(reloads.length, 1);
});

test('the home-screen manifest: an iPhone gets the key in the start URL\'s fragment, Android a keyless per-farm manifest', async () => {
  const mk = () => {
    const link = document.createElement('link');
    link.setAttribute('rel', 'manifest');
    link.setAttribute('href', '/manifest.webmanifest');
    return { link, doc: { querySelector: () => link } };
  };
  const base = { name: 'Harvest Hollow', id: '/', start_url: '/', scope: '/', display: 'standalone', icons: [{ src: '/assets/pwa/icon-192.png', sizes: '192x192' }] };
  const ios = mk();
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', standalone: false };
  const m = await G.installFarmManifest(ID, SECRET, { doc: ios.doc, fetcher: fakeFetch({ '/manifest.webmanifest': { body: base } }), origin: ORIGIN, nav: iphone });
  assert.equal(m.start_url, `${ORIGIN}/f/${ID}#k=${SECRET}`);
  assert.ok(ios.link.getAttribute('href').startsWith('data:application/manifest+json,'));
  const and = mk();
  const pixel = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' };
  const f = fakeFetch({});
  const a = await G.installFarmManifest(ID, SECRET, { doc: and.doc, fetcher: f, origin: ORIGIN, nav: pixel });
  assert.equal(and.link.getAttribute('href'), `/f/${ID}/manifest.webmanifest`, 'Chrome makes an installed app (WebAPK) only from an http(s) manifest');
  assert.ok(!JSON.stringify(a).includes(SECRET), 'Android keeps one storage for the browser and the app: no key needed');
  assert.equal(f.calls.length, 0);
  // a language switch keeps the farm's own start and asks for the description in the language (ui/index.js)
  assert.equal(G.farmManifestHref(`/f/${ID}/manifest.webmanifest`, 'bg'), `/f/${ID}/manifest.webmanifest?lang=bg`);
  assert.equal(G.farmManifestHref(`/f/${ID}/manifest.webmanifest?lang=bg`, 'en'), `/f/${ID}/manifest.webmanifest`);
});

test('Copy never says "Copied" when nothing was copied (no clipboard API and no field holding the link)', async () => {
  const I = await load('../public/js/ui/invite.js');
  // the old copy command copies the selection: without a field it copies nothing, though the browser answers true
  assert.equal(await I.copyText('https://hh.test/f/x#k=secret', { nav: {}, doc: { execCommand: () => true } }), false);
});
