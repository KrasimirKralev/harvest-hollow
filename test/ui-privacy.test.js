// Privacy in the game, multi-farm mode (this file runs as a page at /f/<id>; node --test gives every file its own
// process): Settings > Farm's privacy link and "Delete this farm now" (a confirm whose safe answer is "Keep my farm",
// the member key in the Authorization header only, the page told on success, the refusals told apart, nothing sent on
// "Keep my farm"), and the "This farm was deleted" gate. The server side: test/server.privacy.test.js.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';

const ID = 'abcdefghij23';
const SECRET = 'b'.repeat(64);
const ORIGIN = 'https://hh.test';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear(),
  };
}
globalThis.location = { pathname: `/f/${ID}`, origin: ORIGIN, protocol: 'https:', host: 'hh.test', search: '', hash: '', reload() {}, assign() {} };
globalThis.localStorage = memStorage();
globalThis.sessionStorage = memStorage();
installDom();

let F;
let P;
let G;
let T;
const load = (p) => import(p).catch(() => ({}));
before(async () => {
  F = await load('../public/js/net/farm.js');
  P = await load('../public/js/ui/privacy.js');
  G = await load('../public/js/ui/farm-gate.js');
  T = (await load('../public/js/i18n/en/privacy.js')).default ?? {};
});

function fakeFetch(answer) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (answer instanceof Error) throw answer;
    const status = answer.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: new Map(), json: async () => answer.body };
  };
  fn.calls = calls;
  return fn;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

function shell(answer = true) {
  const confirms = [];
  const toasts = [];
  const ui = { confirm: async (o) => { confirms.push(o); return answer; }, toast: (t) => toasts.push(t) };
  return { S: { ui, store: { state: { farm: { name: 'Sunny Acres' }, meta: { farmSeed: 7 } } } }, confirms, toasts };
}
function fakeWin() {
  const events = [];
  return { events, dispatchEvent: (e) => { events.push(e); return true; } };
}

test('deleteFarm: POST /api/f/<id>/delete with the member key in the Authorization header only; outcomes told apart', async () => {
  const ok = fakeFetch({ body: { ok: true } });
  assert.deepEqual(await F.deleteFarm(ok, ID, SECRET), { ok: true });
  const { url, opts } = ok.calls[0];
  assert.equal(url, `/api/f/${ID}/delete`);
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers.authorization, `Bearer ${SECRET}`);
  assert.ok(!url.includes(SECRET) && !String(opts.body).includes(SECRET), 'the key never rides in the URL or the body');
  assert.deepEqual(await F.deleteFarm(fakeFetch({ status: 404, body: { error: 'NOT_FOUND' } }), ID, SECRET), { ok: true, gone: true },
    'already gone (the partner was quicker): deleted all the same');
  assert.equal((await F.deleteFarm(fakeFetch({ status: 403, body: { error: 'AUTH' } }), ID, SECRET)).code, 'AUTH');
  assert.equal((await F.deleteFarm(fakeFetch({ status: 429, body: { error: 'RATE', retryAfter: 30 } }), ID, SECRET)).code, 'RATE');
  assert.equal((await F.deleteFarm(fakeFetch(new Error('offline')), ID, SECRET)).code, 'NET');
  assert.equal((await F.deleteFarm(fakeFetch({ status: 500, body: null }), ID, SECRET)).code, 'NET');
  const none = fakeFetch({ body: { ok: true } });
  assert.equal((await F.deleteFarm(none, ID, null)).code, 'AUTH');
  assert.equal(none.calls.length, 0, 'no key: no request');
});

test('Settings > Farm: the privacy note (this site\'s /privacy, a new tab) and "Delete this farm now…"', () => {
  const sh = shell();
  const p = P.createPrivacyUi(sh.S, { fetcher: fakeFetch({ body: { ok: true } }), win: fakeWin() });
  assert.equal(p.multi, true);
  const box = document.createElement('div');
  box.append(...p.settingsRows({ close() {} }));
  const link = box.querySelector('a[data-privacy="open"]');
  assert.equal(link.getAttribute('href'), '/privacy');
  assert.equal(link.getAttribute('target'), '_blank');
  const del = box.querySelector('[data-farm-delete="open"]');
  assert.ok(del && del.classList.contains('btn--stop'));
  const t = textOf(box);
  assert.ok(t.includes('Delete this farm now') && t.includes('for both farmers') && t.includes('cannot be undone'), t);
});

test('"Delete this farm now": the confirm says everything goes for both farmers and offers "Keep my farm"; yes deletes and tells the page', async () => {
  F.session.secret = SECRET;
  const sh = shell(true);
  const f = fakeFetch({ body: { ok: true } });
  const win = fakeWin();
  const closed = [];
  const p = P.createPrivacyUi(sh.S, { fetcher: f, win });
  assert.equal(await p.deleteFlow({ close: () => closed.push(1) }), true);
  const c = sh.confirms[0];
  assert.equal(c.title, 'Delete this farm?', 'short: one line on a phone');
  assert.equal(c.lead, 'Everything on Sunny Acres goes, for both farmers.');
  assert.equal(c.cancel, 'Keep my farm');
  assert.equal(c.okKind, 'stop');
  assert.match(`${c.lead} ${c.body}`, /for both farmers/);
  assert.match(c.body, /every backup/);
  assert.match(c.body, /Nobody can bring them back/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, `/api/f/${ID}/delete`);
  assert.equal(closed.length, 1, 'Settings closes');
  assert.equal(win.events.length, 1);
  assert.equal(win.events[0].type, P.FARM_DELETED_EVENT);
  assert.equal(P.FARM_DELETED_EVENT, 'hh:farm-deleted');
});

test('"Keep my farm" sends nothing; a refusal is said in a toast and the farm stays', async () => {
  F.session.secret = SECRET;
  const no = shell(false);
  const f = fakeFetch({ body: { ok: true } });
  const win = fakeWin();
  assert.equal(await P.createPrivacyUi(no.S, { fetcher: f, win }).deleteFlow(), false);
  assert.equal(f.calls.length, 0);
  assert.equal(win.events.length, 0);
  for (const [answer, code] of [[{ status: 429, body: { error: 'RATE' } }, 'RATE'], [{ status: 403, body: { error: 'AUTH' } }, 'AUTH'], [new Error('x'), 'NET']]) {
    const sh = shell(true);
    const w = fakeWin();
    assert.equal(await P.createPrivacyUi(sh.S, { fetcher: fakeFetch(answer), win: w }).deleteFlow(), false);
    assert.equal(sh.toasts[0], T[`privacy.delete.err.${code}`]);
    assert.equal(w.events.length, 0, 'no gate: the farm is still there');
  }
});

test('the "This farm was deleted" gate: says so politely, offers a new farm, links the privacy note; "gone" no longer guesses why', () => {
  localStorage.clear();
  const el = G.showFarmGate('deleted', { farmId: ID });
  assert.equal(el.dataset.gate, 'deleted');
  const t = textOf(el);
  assert.ok(t.includes('This farm was deleted') && t.includes('One of its farmers deleted it') && t.includes('Thank you'), t);
  assert.equal(el.querySelector('a.btn').getAttribute('href'), '/');
  assert.equal(textOf(el.querySelector('a.btn')), 'Start a new farm');
  assert.equal(el.querySelector('.gate-privacy a').getAttribute('href'), '/privacy');
  assert.equal(el.querySelector('details.gate-key'), null, 'no way back into a deleted farm is offered');
  assert.match(G.GATE_TEXT.gone.lead, /by one of its farmers, or because nobody visited it for 7 days/);
  for (const kind of ['private', 'invite', 'full', 'gone', 'rekeyed', 'rejoin', 'home']) {
    assert.equal(G.showFarmGate(kind, { farmId: ID }).querySelector('.gate-privacy a').getAttribute('href'), '/privacy', kind);
  }
});

test('links to the privacy note: the ideas box\'s small print (a new tab, the words stay) and the landing page\'s link row', async () => {
  const { ideaForm } = await import('../public/js/front/ideas.js');
  const { default: FRONT } = await import('../public/js/i18n/en/front.js');
  // the fake DOM's fields have no value of their own: an empty one, like a fresh form's
  const make = document.createElement;
  document.createElement = (t) => { const n = make(t); if (/^(input|textarea)$/i.test(t)) n.value = ''; return n; };
  let f;
  try {
    f = ideaForm({ prefix: 'pv-test', fetcher: async () => ({ ok: true, status: 201, json: async () => ({ ok: true, id: 'x' }) }) });
  } finally { document.createElement = make; }
  const hint = f.el.querySelector('#pv-test-contact-hint');
  assert.ok(textOf(hint).includes('Optional: we only use it to reply to you'), textOf(hint));
  const a = hint.querySelector('a');
  assert.equal(a.getAttribute('href'), '/privacy');
  assert.equal(a.getAttribute('target'), '_blank');
  assert.equal(textOf(a), 'Privacy');
  assert.match(FRONT['front.ideas.privacy'], /Never your IP address/);
  const fs = await import('node:fs');
  const landing = fs.readFileSync(new URL('../public/landing.html', import.meta.url), 'utf8');
  // the one-screen landing page (v2): Privacy sits in the "If you need more" row under the three actions
  assert.match(landing, /<nav class="ld-more"[^>]*>(?:(?!<\/nav>)[\s\S])*<a class="ld-link" id="ld-privacy" href="\/privacy" data-i18n="front\.more\.privacy">Privacy<\/a>[\s\S]*?<\/nav>/);
});
