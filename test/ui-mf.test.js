// Multi-farm hosted mode, client side (docs/agent-briefs/multi-farm.md, docs/agent-notes/mf-client.md): this file runs
// as a page at /f/<id> (node --test gives every file its own process, so `location` is set before any import). It
// checks the farm scope (keys, API paths, socket), the launch links (#k= personal key, ?join= invite), the device's
// farm list, the two calls (start a farm, make an invite) and their refusals, the farm gate, the invite card, the
// Settings rows and the nudge. Single mode stays untouched: test/ui-mf-single.test.js.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';

const ID = 'abcdefghij23';
const SECRET = 'a'.repeat(64);
const ORIGIN = 'https://hh.test';

/** A localStorage stand-in (getItem / setItem / removeItem / key / length). */
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
let I;
let dom;
before(async () => {
  F = await import('../public/js/net/farm.js');
  G = await import('../public/js/ui/farm-gate.js');
  I = await import('../public/js/ui/invite.js');
  dom = await import('../public/js/ui/dom.js');
});

/** A fetch stand-in: answers from `routes` (path -> { status, body, headers }) and records every call. */
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

test('the page at /f/<id> is multi mode: farm keys, API paths and the socket carry the farm, device keys do not', () => {
  const { farm } = F;
  assert.equal(farm.multi, true);
  assert.equal(farm.id, ID);
  assert.equal(farm.key('hh.tokens'), `hh.f.${ID}.tokens`);
  assert.equal(farm.key('hh.slot'), `hh.f.${ID}.slot`);
  assert.equal(farm.key('hh.tips.p1'), `hh.f.${ID}.tips.p1`);
  assert.equal(farm.key('hh.camera'), `hh.f.${ID}.camera`);
  for (const k of ['hh.settings', 'hh.audio', 'hh.keys', 'hh.input', 'hh.portraits', 'hh.quality.auto', 'hh.farms']) assert.equal(farm.key(k), k);
  assert.equal(farm.api('/api/status'), `/api/f/${ID}/status`);
  assert.equal(farm.api('/api/dev/warp'), `/api/f/${ID}/dev/warp`);
  assert.equal(farm.api('/assets/x.png'), '/assets/x.png');
  assert.equal(farm.wsUrl({ protocol: 'https:', host: 'hh.test' }), `wss://hh.test/ws?farm=${ID}`);
  assert.equal(farm.wsUrl({ protocol: 'http:', host: 'h:1' }), `ws://h:1/ws?farm=${ID}`);
  assert.equal(F.farmIdOf(`/f/${ID}/`), ID);
  for (const p of ['/', '/index.html', '/f/', '/f/a', '/f/abc/def', '/x/abcdefghij23', '/f/abc def ghij']) assert.equal(F.farmIdOf(p), null, p);
});

test('the ui kv helper writes a farm\'s tips under the farm and the device settings globally', () => {
  localStorage.clear();
  dom.kv.set('hh.tips.p1', { a: 1 });
  dom.kv.set('hh.settings', { quality: 'low' });
  assert.deepEqual(localStorage.keys().sort(), [`hh.f.${ID}.tips.p1`, 'hh.settings']);
  assert.deepEqual(dom.kv.get('hh.tips.p1'), { a: 1 });
  // another farm on the same device starts with its own (empty) tips
  localStorage.setItem('hh.f.zzzzzzzzzz22.tips.p1', JSON.stringify({ b: 2 }));
  assert.deepEqual(dom.kv.get('hh.tips.p1'), { a: 1 });
});

test('launch links: #k= is the personal key, ?join= the invite; both are validated; the address is cleaned', () => {
  const loc = (search, hash) => ({ pathname: `/f/${ID}`, search, hash });
  assert.deepEqual(F.readLaunch(loc('', `#k=${SECRET}`)), { key: SECRET, join: null });
  assert.deepEqual(F.readLaunch(loc('?join=0123456789abcdef0123456789abcdef', '')), { key: null, join: '0123456789abcdef0123456789abcdef' });
  assert.deepEqual(F.readLaunch(loc('?join=short', '#k=<script>')), { key: null, join: null });
  assert.equal(F.cleanUrl(loc('?quality=low&join=x', `#k=${SECRET}`)), `/f/${ID}?quality=low&join=x`);
  assert.equal(F.cleanUrl(loc('?quality=low&join=x', `#k=${SECRET}`), { join: true }), `/f/${ID}?quality=low`);
  assert.equal(F.personalLink(ORIGIN, ID, SECRET), `${ORIGIN}/f/${ID}#k=${SECRET}`);
  assert.equal(F.inviteLink(ORIGIN, ID, 'tok'), `${ORIGIN}/f/${ID}?join=tok`);
});

test('the device\'s farm list: newest first, names kept, no secrets in it; forgetting drops the farm\'s own keys', () => {
  const st = memStorage();
  F.rememberFarm(st, { id: 'aaaaaaaaaaaa', at: 1 });
  F.rememberFarm(st, { id: 'bbbbbbbbbbbb', name: 'Sunny Acres', at: 3 });
  F.rememberFarm(st, { id: 'aaaaaaaaaaaa', name: '  ', at: 5 });
  F.rememberFarm(st, { id: 'not ok', at: 9 });
  assert.deepEqual(F.farmsOnDevice(st).map((f) => [f.id, f.name, f.lastOpen]), [['aaaaaaaaaaaa', null, 5], ['bbbbbbbbbbbb', 'Sunny Acres', 3]]);
  F.rememberFarm(st, { id: 'bbbbbbbbbbbb', at: 7 });
  assert.equal(F.farmsOnDevice(st)[0].name, 'Sunny Acres', 'a later visit without a name keeps the old one');
  st.setItem(F.createFarmScope('bbbbbbbbbbbb').key('hh.key'), JSON.stringify(SECRET));
  st.setItem('hh.f.bbbbbbbbbbbb.tips.p1', '{}');
  assert.equal(F.hasIdentity(st, 'bbbbbbbbbbbb'), true);
  assert.equal(F.hasIdentity(st, 'aaaaaaaaaaaa'), false);
  assert.ok(!st.getItem('hh.farms').includes(SECRET), 'the list holds no secret');
  F.forgetFarm(st, 'bbbbbbbbbbbb');
  assert.deepEqual(F.farmsOnDevice(st).map((f) => f.id), ['aaaaaaaaaaaa']);
  assert.equal(F.hasIdentity(st, 'bbbbbbbbbbbb'), false);
  assert.equal(st.keys().filter((k) => k.startsWith('hh.f.bbbbbbbbbbbb.')).length, 0);
});

test('lead: the device list names a farm by its own name, else by its farmers (not a column of "Harvest Hollow")', () => {
  assert.equal(F.farmLabel({ farm: { name: 'Sunny Acres' }, players: { p1: { name: 'Rowan' } } }), 'Sunny Acres');
  assert.equal(F.farmLabel({ farm: { name: 'Harvest Hollow' }, players: { p2: { name: 'Mia' }, p1: { name: 'Rowan' } } }), 'Rowan & Mia\'s farm');
  assert.equal(F.farmLabel({ farm: { name: 'Harvest Hollow' }, players: { p1: { name: 'Rowan' } } }), 'Rowan\'s farm');
  assert.equal(F.farmLabel({ farm: { name: 'Harvest Hollow' }, players: {} }), 'Harvest Hollow');
  assert.equal(F.farmLabel(null), null);
});

test('start a farm: { id, secret } on success; rate limit, "we are full" and a dead network are told apart', async () => {
  const ok = fakeFetch({ '/api/farms': { status: 201, body: { id: ID, secret: SECRET } } });
  assert.deepEqual(await F.startFarm(ok), { ok: true, id: ID, secret: SECRET });
  assert.equal(ok.calls[0].opts.method, 'POST');
  // lead: the creator's browser zone travels along, so the farm's midnight is theirs and not the container's UTC
  assert.deepEqual(JSON.parse(ok.calls[0].opts.body), { tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const z = fakeFetch({ '/api/farms': { status: 201, body: { id: ID, secret: SECRET } } });
  await F.startFarm(z, { tz: 'Europe/Sofia' });
  await F.startFarm(z, { tz: null });
  assert.deepEqual(z.calls.map((c) => JSON.parse(c.opts.body)), [{ tz: 'Europe/Sofia' }, {}]);
  assert.deepEqual(await F.startFarm(fakeFetch({ '/api/farms': { status: 429, headers: { 'retry-after': '1800' }, body: { error: 'RATE' } } })),
    { ok: false, code: 'RATE', retryAfter: 1800 });
  assert.equal((await F.startFarm(fakeFetch({ '/api/farms': { status: 503, body: { error: 'FULL' } } }))).code, 'FULL');
  assert.equal((await F.startFarm(fakeFetch({ '/api/farms': { status: 400, body: { error: 'full' } } }))).code, 'FULL');
  assert.equal((await F.startFarm(fakeFetch({ '/api/farms': new Error('offline') }))).code, 'NET');
  assert.equal((await F.startFarm(fakeFetch({ '/api/farms': { status: 200, body: { id: '../x', secret: SECRET } } }))).code, 'NET', 'a bad id is no farm');
});

test('make an invite: the secret goes in the Authorization header and the body, never in the URL; refusals are told apart', async () => {
  const f = fakeFetch({ [`/api/f/${ID}/invite`]: { body: { token: '0123456789abcdef0123456789abcdef', expiresAt: 99 } } });
  assert.deepEqual(await F.createInvite(f, ID, SECRET), { ok: true, token: '0123456789abcdef0123456789abcdef', expiresAt: 99 });
  const { url, opts } = f.calls[0];
  assert.equal(url, `/api/f/${ID}/invite`);
  assert.ok(!url.includes(SECRET));
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers.authorization, `Bearer ${SECRET}`);
  assert.deepEqual(JSON.parse(opts.body), { secret: SECRET });
  const code = async (r) => (await F.createInvite(fakeFetch({ [`/api/f/${ID}/invite`]: r }), ID, SECRET)).code;
  assert.equal(await code({ status: 409, body: { error: 'FULL' } }), 'FULL');
  assert.equal(await code({ status: 403, body: { error: 'forbidden' } }), 'AUTH');
  assert.equal(await code({ status: 429, body: {} }), 'RATE');
  assert.equal(await code(new Error('x')), 'NET');
  assert.equal((await F.createInvite(f, ID, null)).code, 'AUTH', 'no secret: no request');
  assert.equal(f.calls.length, 1);
  assert.equal(F.ttlDays({ ttlDays: 14 }), 14);
  assert.equal(F.ttlDays({}), 7);
});

test('a pasted farm link: the full personal link, an invite link, or just the #k= part for this farm', () => {
  assert.deepEqual(G.parseFarmLink(`${ORIGIN}/f/${ID}#k=${SECRET}`, { origin: ORIGIN }), { id: ID, key: SECRET, join: null });
  assert.deepEqual(G.parseFarmLink(`  ${ORIGIN}/f/${ID}?join=0123456789abcdef0123456789abcdef `, { origin: ORIGIN }),
    { id: ID, key: null, join: '0123456789abcdef0123456789abcdef' });
  assert.deepEqual(G.parseFarmLink(`#k=${SECRET}`, { origin: ORIGIN, farmId: ID }), { id: ID, key: SECRET, join: null });
  for (const bad of ['', 'hello', `${ORIGIN}/f/${ID}`, `javascript:alert(1)//f/${ID}#k=${SECRET}`, `${ORIGIN}/#k=${SECRET}`]) {
    assert.equal(G.parseFarmLink(bad, { origin: ORIGIN, farmId: null }), null, bad);
  }
});

test('the farm gate: private, used-up invite and full farm each say what happened, offer a farm of your own, leak nothing', () => {
  localStorage.clear();
  F.rememberFarm(localStorage, { id: 'bbbbbbbbbbbb', name: 'Sunny Acres', at: 2 });
  F.rememberFarm(localStorage, { id: ID, name: 'This one', at: 3 });
  for (const kind of ['private', 'invite', 'full', 'gone']) {
    const el = G.showFarmGate(kind, { farmId: ID });
    assert.equal(document.body.querySelectorAll('#farm-gate').length, 1, 'one gate at a time');
    assert.equal(el.getAttribute('role'), 'dialog');
    assert.equal(el.getAttribute('aria-labelledby'), 'farm-gate-title');
    const t = textOf(el);
    assert.ok(t.includes(G.GATE_TEXT[kind].title), kind);
    assert.ok(t.includes(G.GATE_TEXT[kind].lead), kind);
    assert.equal(el.querySelector('a.btn').getAttribute('href'), '/');
    // the device's other farms, never this one again
    assert.deepEqual(el.querySelectorAll('a.gate-farm').map((a) => a.getAttribute('href')), ['/f/bbbbbbbbbbbb']);
    assert.ok(!/undefined|null|\[object/.test(t), t);
  }
  assert.ok(textOf(document.getElementById('farm-gate')).includes('is gone'));
  assert.ok(textOf(G.showFarmGate('full', { farmId: ID })).includes('two farmers'));
  assert.ok(G.GATE_TEXT.private.title.includes('private') && G.GATE_TEXT.private.lead.includes('invite link'));
});

test('the gate\'s "I have my personal farm link": this farm\'s key is stored and the page reloads; another farm is opened', () => {
  localStorage.clear();
  reloads.length = 0;
  assigns.length = 0;
  const el = G.showFarmGate('private', { farmId: ID });
  const input = el.querySelector('#farm-gate-link');
  const open = el.querySelector('.gate-row button');
  input.value = 'not a link';
  open.click();
  assert.ok(textOf(el.querySelector('.modal-error')).includes('does not look like a farm link'));
  input.value = `${ORIGIN}/f/${ID}#k=${SECRET}`;
  open.click();
  assert.equal(JSON.parse(localStorage.getItem(`hh.f.${ID}.key`)), SECRET);
  assert.equal(reloads.length, 1);
  input.value = `${ORIGIN}/f/bbbbbbbbbbbb#k=${SECRET}`;
  open.click();
  assert.deepEqual(assigns, [`/f/bbbbbbbbbbbb#k=${SECRET}`]);
});

test('the home-screen manifest of a farm starts at /f/<id> with the farmer\'s key in the fragment', async () => {
  const link = document.createElement('link');
  link.setAttribute('rel', 'manifest');
  link.setAttribute('href', '/manifest.webmanifest');
  const doc = { querySelector: () => link };
  const base = { name: 'Harvest Hollow', id: '/', start_url: '/', scope: '/', display: 'standalone', icons: [{ src: '/assets/pwa/icon-192.png', sizes: '192x192' }] };
  const m = await G.installFarmManifest(ID, SECRET, { doc, fetcher: fakeFetch({ '/manifest.webmanifest': { body: base } }), origin: ORIGIN });
  assert.equal(m.start_url, `${ORIGIN}/f/${ID}#k=${SECRET}`);
  assert.equal(m.id, `/f/${ID}`);
  assert.equal(m.display, 'standalone');
  assert.equal(m.icons[0].src, `${ORIGIN}/assets/pwa/icon-192.png`);
  assert.ok(link.getAttribute('href').startsWith('data:application/manifest+json,'));
  assert.deepEqual(JSON.parse(decodeURIComponent(link.getAttribute('href').split(',')[1])), m);
  // a second welcome patches the original, not the patched copy
  const again = await G.installFarmManifest(ID, null, { doc, fetcher: fakeFetch({ '/manifest.webmanifest': { body: base } }), origin: ORIGIN });
  assert.equal(again.start_url, `${ORIGIN}/f/${ID}`);
  assert.equal(await G.installFarmManifest(ID, SECRET, { doc, fetcher: fakeFetch({}), origin: ORIGIN }), null, 'a failed fetch keeps the page\'s own');
});

/** The shell's pieces the invite module uses: a panel registry, banners, the store. */
function shell(players = { p1: { name: 'Rowan' } }) {
  const panels = new Map();
  const banners = [];
  const opened = [];
  const fx = [];
  const store = { state: { players }, pid: 'p1', on: (ev, fn) => { if (ev === 'fx') fx.push(fn); return () => {}; } };
  const ui = { panels: { register: (n, spec) => { panels.set(n, spec); return () => {}; }, open: (n) => { opened.push(n); return true; } },
    banner: (b) => { banners.push(b); return { close() {} }; } };
  return { S: { store, ui }, panels, banners, opened, fx, store };
}
function mountPanel(spec) {
  const body = document.createElement('div');
  document.body.append(body);
  const ctx = { body, close: () => {} };
  const inst = spec.mount(body, ctx);
  return { body, inst };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('the invite card: one tap makes a one-time link with Copy; it says that a new link replaces the old one', async () => {
  localStorage.clear();
  const { S, panels } = shell();
  F.session.secret = SECRET;
  const inv = I.createInviteUi(S);
  assert.ok(inv && panels.has('invite'));
  const spec = panels.get('invite');
  assert.equal(spec.title, 'Invite a friend');
  const calls = [];
  globalThis.fetch = fakeFetch((url, opts) => { calls.push([url, opts.headers.authorization]); return { body: { token: '0123456789abcdef0123456789abcdef', expiresAt: Date.now() + 1000 } }; });
  const { body } = mountPanel(spec);
  assert.ok(textOf(body).includes(I.INVITE_TEXT.lead));
  assert.ok(textOf(body).includes('works once, for 7 days'));
  assert.equal(body.querySelector('.link-field'), null, 'no link before one is asked for (a link made is the old one turned off)');
  body.querySelector('[data-act="make"]').click();
  await tick(); await tick();
  assert.deepEqual(calls, [[`/api/f/${ID}/invite`, `Bearer ${SECRET}`]]);
  const field = body.querySelector('.link-field');
  assert.equal(field.value, `${ORIGIN}/f/${ID}?join=0123456789abcdef0123456789abcdef`);
  assert.ok(body.querySelector('[data-act="copy"]'));
  assert.equal(textOf(body.querySelector('[data-act="make"]')), 'Make a new link');
  assert.ok(!/\bnull\b|undefined/.test(textOf(body)), textOf(body));
  // reopened later: the same link (kept for this farm), not a new one that would turn the sent one off
  const again = mountPanel(spec);
  assert.equal(again.body.querySelector('.link-field').value, field.value);
  assert.equal(calls.length, 1);
  assert.ok(localStorage.getItem(`hh.f.${ID}.invite`), 'kept under the farm');
});

test('the invite card on a farm with two farmers says it is full; an error is said kindly', async () => {
  localStorage.clear();
  const full = shell({ p1: { name: 'Rowan' }, p2: { name: 'Mia' } });
  I.createInviteUi(full.S);
  const a = mountPanel(full.panels.get('invite'));
  assert.ok(textOf(a.body).includes(I.INVITE_TEXT.full));
  assert.equal(a.body.querySelector('[data-act="make"]'), null);
  const one = shell();
  I.createInviteUi(one.S);
  globalThis.fetch = fakeFetch({ [`/api/f/${ID}/invite`]: { status: 409, body: { error: 'FULL' } } });
  const b = mountPanel(one.panels.get('invite'));
  b.body.querySelector('[data-act="make"]').click();
  await tick(); await tick();
  assert.ok(textOf(b.body).includes(I.INVITE_TEXT.errors.FULL));
  assert.equal(b.body.querySelector('.link-field'), null);
});

test('Settings > Farm: invite, the personal link (hidden until Show), the 7-day line, the farm list', () => {
  const { S, opened } = shell();
  F.session.secret = SECRET;
  const inv = I.createInviteUi(S);
  const box = document.createElement('div');
  box.append(...inv.settingsRows({ close: () => {} }));
  const t = textOf(box);
  assert.ok(t.includes('Your personal farm link'));
  assert.ok(t.includes('Keep it private: it is your key'));
  assert.ok(t.includes('This farm is kept while you play; after 7 days without a visit it is deleted'));
  const field = box.querySelector('.set-personal .link-field');
  assert.equal(field.value, '', 'the key is not on screen until asked');
  box.querySelector('[data-act="show"]').click();
  assert.equal(field.value, `${ORIGIN}/f/${ID}#k=${SECRET}`);
  box.querySelector('[data-act="show"]').click();
  assert.equal(field.value, '');
  box.querySelector('[data-invite="open"]').click();
  assert.deepEqual(opened, ['invite']);
  assert.ok(box.querySelectorAll('a').some((a) => a.getAttribute('href') === '/?home=1'));
});

test('the nudge: once per farm, after my first finished guide step, never for the partner\'s step or on a full farm', async () => {
  localStorage.clear();
  const { S, fx, banners, store } = shell();
  I.createInviteUi(S);
  const emit = (ev) => fx.forEach((fn) => fn({ ev }));
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);
  try {
    emit({ e: 'tutorialStep', done: true, pid: 'p2' });
    emit({ e: 'tutorialStep', done: false, pid: 'p1' });
    await tick();
    assert.equal(banners.length, 0);
    emit({ e: 'tutorialStep', done: true, pid: 'p1' });
    emit({ e: 'tutorialStep', done: true, pid: 'p1' });
    await tick(); await tick();
    assert.equal(banners.length, 1);
    assert.equal(banners[0].ribbon, 'Invite a friend');
    assert.ok(banners[0].actions.some((a) => a.label === 'Invite a friend'));
    assert.equal(JSON.parse(localStorage.getItem(`hh.f.${ID}.inviteNudge`)), true);
    // a full farm is never nudged
    localStorage.clear();
    const two = shell({ p1: {}, p2: {} });
    I.createInviteUi(two.S);
    two.fx.forEach((fn) => fn({ ev: { e: 'tutorialStep', done: true, pid: 'p1' } }));
    await tick();
    assert.equal(two.banners.length, 0);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.ok(store);
});

test('copyText: the clipboard when there is one, else the selected field and the old copy command', async () => {
  const got = [];
  assert.equal(await I.copyText('x', { nav: { clipboard: { writeText: async (t) => { got.push(t); } } } }), true);
  assert.deepEqual(got, ['x']);
  let selected = false;
  const input = { focus() {}, select() { selected = true; } };
  assert.equal(await I.copyText('y', { input, nav: {}, doc: { execCommand: (c) => c === 'copy' } }), true);
  assert.equal(selected, true);
  assert.equal(await I.copyText('z', { nav: {}, doc: {} }), false);
});
