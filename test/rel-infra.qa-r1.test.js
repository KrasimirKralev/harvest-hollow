// QA round 1 (release 1.0), infra's items: docs/qa/release/qa-r1/fix-infra.md. Each test failed on the tree QA
// tested (7f67efe) before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Engine } from '../server/engine.js';
import { MSG, ERR, cleanName, parseClientMessage } from '../shared/net/protocol.js';
import { actionTargets, eventRow } from '../shared/net/targets.js';
import { fakeClock, testServer, join, tmpDataDir } from './helpers.js';
import { farmAt, give, runDue, MONDAY, HOUR } from './helpers/rules-goals.js';

// ---- I-01: a lost race on a slot-addressed target (an order, a townsfolk post, a barge crate) names the winner ------

/** An engine on a level-20 farm whose order board is up, both farmers joined and connected. */
function orderEngine() {
  const state = farmAt(20, { now: MONDAY });
  runDue(state, MONDAY);
  const clock = fakeClock(MONDAY + HOUR);
  const server = { clock: { lastNow: 0 }, clients: {}, auth: {} };
  const engine = new Engine({ state, server, clock, log: { error() {}, warn() {}, info() {}, log() {} } });
  engine.client('aaaaaa', 'p1', clock.now());
  engine.client('bbbbbb', 'p2', clock.now());
  const slot = Object.keys(state.farm.orders.slots).find((k) => state.farm.orders.slots[k].order);
  assert.ok(slot !== undefined, 'the board has an order');
  const order = state.farm.orders.slots[slot].order;
  for (const [item, q] of Object.entries(order.items)) give(state, item, 2 * q);   // both could fill it
  return { engine, clock, slot: Number(slot), n: order.n };
}

test('I-01: two Delivers of one order: the second is refused with `by` = the farmer who filled it', () => {
  const { engine, slot, n } = orderEngine();
  const A = { pid: 'p1', cid: 'aaaaaa' };
  const B = { pid: 'p2', cid: 'bbbbbb' };
  assert.equal(engine.act(A, { seq: 1, type: 'orderFill', args: { slot, n } }), null, 'the first Deliver lands');
  const lost = engine.act(B, { seq: 1, type: 'orderFill', args: { slot, n } });
  assert.equal(lost.t, MSG.REJ);
  assert.ok([ERR.EMPTY, ERR.NOT_FOUND].includes(lost.code), lost.code);
  assert.equal(lost.by, 'p1', 'the loser hears "<partner> got there first", not "Nothing to harvest there"');
  assert.equal(engine.rejectedOf('bbbbbb').at(-1).by, 'p1', 'the remembered rejection keeps `by`');
  // the winner's own second tap is no race
  assert.equal(engine.act(A, { seq: 2, type: 'orderFill', args: { slot, n } }).by, undefined);
});

test('I-01: a soft refusal on a row the partner just touched still asks "are you sure?" (no `by`)', () => {
  const { engine, slot, n } = orderEngine();
  const A = { pid: 'p1', cid: 'aaaaaa' };
  const B = { pid: 'p2', cid: 'bbbbbb' };
  assert.equal(engine.act(A, { seq: 1, type: 'orderPin', args: { slot, n } }), null, 'the partner is on it');
  const soft = engine.act(B, { seq: 1, type: 'orderDiscard', args: { slot, n } });
  assert.equal(soft.code, ERR.PINNED);
  assert.equal(soft.by, undefined, 'a `by` would turn the confirm into a toast (ui.toast: SOFT with no `by` asks)');
  // a hard refusal on the same row names her: the second farmer's own pin lost to the first's
  assert.equal(engine.act(B, { seq: 2, type: 'orderPin', args: { slot, n } }).by, 'p1');
});

test('I-01: slot targets are kept per board, per slot, and only for TOUCH_MS', () => {
  const { engine, clock } = orderEngine();
  const now = clock.now();
  engine.touch({ slot: 3, n: 7 }, 'p2', now, 'orderFill');
  engine.touch({ i: 4, n: 1 }, 'p2', now, 'folkFill');
  engine.touch({ i: 5 }, 'p2', now, 'bargeLoad');
  engine.touch({ project: 'mill', bundle: 'b1', slot: 2, qty: 3 }, 'p2', now, 'donate');
  assert.equal(engine.lastToucher({ slot: 3, n: 7 }, now, 'p1', 'orderFill'), 'p2');
  assert.equal(engine.lastToucher({ slot: 3, n: 7 }, now, 'p1', 'orderDiscard'), 'p2', 'any action on that order slot');
  assert.equal(engine.lastToucher({ slot: 3, n: 8 }, now, 'p1', 'orderPin'), 'p2', 'the slot, not the order number');
  assert.equal(engine.lastToucher({ slot: 2, n: 7 }, now, 'p1', 'orderFill'), undefined, 'another slot');
  assert.equal(engine.lastToucher({ i: 4, n: 1 }, now, 'p1', 'folkFlag'), 'p2', 'the townsfolk post');
  assert.equal(engine.lastToucher({ i: 3, n: 1 }, now, 'p1', 'folkFill'), undefined);
  assert.equal(engine.lastToucher({ i: 5, w: 2 }, now, 'p1', 'bargeFlag'), 'p2', 'the barge crate');
  assert.equal(engine.lastToucher({ i: 4 }, now, 'p1', 'bargeLoad'), undefined, 'a post is not a crate');
  assert.equal(engine.lastToucher({ slot: 4, n: 1 }, now, 'p1', 'orderFill'), undefined, 'a post is not an order');
  assert.equal(engine.lastToucher({ project: 'mill', bundle: 'b1', slot: 2, qty: 1 }, now, 'p1', 'donate'), 'p2');
  assert.equal(engine.lastToucher({ project: 'mill', bundle: 'b1', slot: 2 }, now, 'p1', 'restoreFlag'), 'p2');
  assert.equal(engine.lastToucher({ project: 'mill', bundle: 'b2', slot: 2 }, now, 'p1', 'restoreFlag'), undefined);
  assert.equal(engine.lastToucher({ slot: 3, n: 7 }, now, 'p2', 'orderFill'), undefined, 'never the actor itself');
  assert.equal(engine.lastToucher({ slot: 3, n: 7 }, now + 10_001, 'p1', 'orderFill'), undefined, 'after TOUCH_MS');
  // without a type (the SV-02 callers) or with garbage, nothing throws and nothing is invented
  assert.equal(engine.lastToucher({ slot: 3, n: 7 }, now, 'p1'), undefined);
  for (const args of [null, 'x', { slot: '3' }, { slot: 3.5 }, { i: -1 }, { project: {}, bundle: 'b1', slot: 2 }]) {
    assert.equal(engine.lastToucher(args, now, 'p1', 'orderFill'), undefined);
    assert.equal(engine.lastToucher(args, now, 'p1', 'donate'), undefined);
    engine.touch(args, 'p2', now, 'folkFill');
  }
});

test('I-01: the client reads the same row from the partner\'s event as the server from the action', () => {
  const pairs = [
    ['orderFill', { slot: 2, n: 9 }, { e: 'orderFilled', slot: 2, n: 9, by: 'p1' }],
    ['orderFill', { slot: 2, n: 9 }, { e: 'orderGone', slot: 2, n: 9, by: 'p1' }],
    ['orderPin', { slot: 1, n: 3 }, { e: 'orderPinned', slot: 1, pin: 'p1', by: 'p1' }],
    ['orderFlag', { slot: 1, n: 3 }, { e: 'orderFlagged', slot: 1, flag: 'p1', by: 'p1' }],
    ['orderRush', { slot: 4 }, { e: 'orderRushed', slot: 4, acorns: 0, by: 'p1' }],
    ['folkFill', { i: 3, n: 1 }, { e: 'folkFilled', i: 3, npc: 'x', by: 'p1' }],
    ['folkFlag', { i: 3, n: 1 }, { e: 'folkFlagged', i: 3, flag: 'p1', by: 'p1' }],
    ['bargeLoad', { i: 7 }, { e: 'bargeLoaded', i: 7, item: 'egg', by: 'p1' }],
    ['bargeFlag', { i: 7, w: 3 }, { e: 'bargeFlagged', i: 7, flag: 'p1', by: 'p1' }],
    ['donate', { project: 'mill', bundle: 'b1', slot: 0, qty: 2 },
      { e: 'donated', project: 'mill', bundle: 'b1', slot: 0, by: 'p1', qty: 2 }],
    ['restoreFlag', { project: 'mill', bundle: 'b1', slot: 0 },
      { e: 'restoreFlagged', project: 'mill', bundle: 'b1', slot: 0, flag: 'p1', by: 'p1' }],
  ];
  for (const [type, args, ev] of pairs) {
    const row = eventRow(ev);
    assert.ok(row, ev.e);
    assert.ok(actionTargets(type, args).includes(row), `${type} names ${row}`);
  }
  assert.deepEqual(actionTargets('pair', { home: 'h.1.0', a: 'c.1.0', b: 'c.2.0' }), ['h.1.0', 'c.1.0', 'c.2.0']);
  assert.deepEqual(actionTargets('harvest', { ids: ['a.1.0', 7, 'b.1.0'] }), ['a.1.0', 'b.1.0'], 'ids as before');
  assert.deepEqual(actionTargets(undefined, { id: 'a.1.0', slot: 2 }), ['a.1.0'], 'no type: id / ids only');
  const odd = [null, 'x', {}, { e: 'harvested', id: 'a.1.0' }, { e: 'orderFilled', slot: '2' }, { e: 'donated' }];
  for (const ev of odd) {
    assert.equal(eventRow(ev), null);
  }
});

// ---- I-02: invisible bidi controls never reach a stored name or a chat line -------------------------------------

/** LRM, RLM, ALM, LRE, RLE, PDF, LRO, RLO, LRI, RLI, FSI, PDI: the invisible controls that reorder text around them. */
const BIDI = ['\u200e', '\u200f', '\u061c', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067',
  '\u2068', '\u2069'];
const hasBidi = (s) => BIDI.some((c) => s.includes(c));

test('I-02: cleanName strips every bidi control and keeps right-to-left letters', () => {
  assert.equal(cleanName('\u202eabc'), 'abc');
  assert.equal(cleanName('\u202eRada Petrova'), 'Rada Petrova');
  for (const c of BIDI) assert.equal(cleanName(`Ra${c}da`), 'Rada', `U+${c.codePointAt(0).toString(16)}`);
  assert.equal(cleanName(BIDI.join('')), '', 'only controls: no name (the claim is refused as empty)');
  assert.equal(cleanName('رضا بتروفا'), 'رضا بتروفا', 'Arabic letters stay');
  assert.equal(cleanName('Деси ♥'), 'Деси ♥');
  assert.equal(cleanName(`${'\u202e'.repeat(20)}Mia`), 'Mia', 'the length cap counts what is left');
});

test('I-02: a claim and a chat line with an RLO arrive without it', () => {
  const claim = (name) => parseClientMessage({ t: MSG.HELLO, proto: 1, cid: 'abcdef', claim: { slot: 'p1', name } });
  assert.equal(claim('\u202eRada').claim.name, 'Rada');
  assert.equal(claim('\u202e\u2066'), null, 'a name of controls only is no name');
  const chat = parseClientMessage({ t: MSG.CHAT, text: 'hello \u202efrom the barn\u202c!' });
  assert.equal(chat.text, 'hello from the barn!');
  assert.equal(parseClientMessage({ t: MSG.CHAT, text: '\u202e\u202e' }), null, 'an empty line is dropped');
  assert.equal(parseClientMessage({ t: MSG.CHAT, text: 'مرحبا' }).text, 'مرحبا');
});

test('I-02: a farmer who claims a slot as "\\u202eRada Petrova" is stored and shown as "Rada Petrova"', async () => {
  const srv = await testServer();
  try {
    const { c, w } = await join(srv.port, 'p1', '\u202eRada Petrova');
    assert.equal(w.t, MSG.WELCOME);
    assert.equal(w.state.players.p1.name, 'Rada Petrova');
    assert.ok(!hasBidi(JSON.stringify(srv.hh.engine.state.players)), 'no control in the stored players');
    c.close();
  } finally {
    await srv.close();
  }
});

test('I-02: the landing\'s "farms on this device" list keeps no bidi control (new names and stored ones)', async () => {
  const F = await import('../public/js/net/farm.js');
  const m = new Map();
  const st = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
  F.rememberFarm(st, { id: 'aaaaaaaaaaaa', name: '\u202eHoneybee Acres farm', at: 1 });
  m.set('hh.farms', JSON.stringify([...JSON.parse(m.get('hh.farms')),
    { id: 'bbbbbbbbbbbb', name: '\u2067Sunny\u2069 Acres', lastOpen: 2 },
    { id: 'cccccccccccc', name: '\u202e', lastOpen: 0 }]));
  assert.deepEqual(F.farmsOnDevice(st).map((f) => f.name), ['Sunny Acres', 'Honeybee Acres farm', null]);
  F.rememberFarm(st, { id: 'dddddddddddd', at: 3 });
  assert.ok(!hasBidi(m.get('hh.farms')), 'the next write keeps no control either');
});

// ---- I-03: "that invite link is still waiting for your friend" only for the device that made the invite ------------

test('I-03: the invite notice is for the farmer who made the link, never for the friend who used it', async () => {
  const { inviteNotice } = await import('../public/js/net/farm.js');
  assert.equal(typeof inviteNotice, 'function');
  const join = 'j'.repeat(40);
  const saved = { token: join, expiresAt: 9e15, madeAt: 1 };
  // the creator opens the unused link they made on this device: it still waits for the friend
  assert.equal(inviteNotice({ join, sentJoin: false, saved }), 'own');
  // the friend taps the link they joined with again (back from the messenger): just in, no notice
  assert.equal(inviteNotice({ join, sentJoin: false, saved: null }), null);
  assert.equal(inviteNotice({ join, sentJoin: false, saved: { token: 'k'.repeat(40) } }), null, 'a newer one of mine');
  // the friend's first visit (the hello carried the invite): no notice
  assert.equal(inviteNotice({ join, sentJoin: true, saved: null }), null);
  assert.equal(inviteNotice({ join, sentJoin: true, saved }), null);
  // no invite in the address, or garbage stored
  assert.equal(inviteNotice({ join: null, sentJoin: false, saved }), null);
  for (const bad of ['x', 7, [], { token: 7 }]) assert.equal(inviteNotice({ join, sentJoin: false, saved: bad }), null);
});

test('I-03: main.js asks inviteNotice with this farm\'s stored invite before the notice', () => {
  const src = fs.readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
  const at = src.indexOf("t('multi.inviteOwn')");
  assert.ok(at > 0);
  const line = src.slice(at - 300, at);   // the notice and the line that decides it
  assert.match(line, /inviteNotice\(/, 'the notice asks who made the invite');
  assert.match(line, /storage\.get\(localStorage, 'hh\.invite'\)/, "this farm's invite as the invite card keeps it");
});

// ---- I-04: the public host's home-screen manifests say what the landing says, not "your home network" ---------------

async function multiServer() {
  const { startServer } = await import('../server/index.js');
  const { loadConfig, multiConfig } = await import('../server/config.js');
  const dataDir = tmpDataDir('mf');
  const s = await startServer({ ...loadConfig({}), mode: 'multi', multi: multiConfig({}), port: 0, host: '127.0.0.1',
    dataDir, quiet: true, dev: true, awayGraceMs: 0 });
  const close = async () => { await s.close(); fs.rmSync(dataDir, { recursive: true, force: true }); };
  return { ...s, base: `http://127.0.0.1:${s.port}`, close };
}

test('I-04: on the multi host every manifest describes the game with the landing\'s tagline, EN and BG', async () => {
  const { default: EN } = await import('../public/js/i18n/en/front.js');
  const { default: BG } = await import('../public/js/i18n/bg/front.js');
  const s = await multiServer();
  try {
    const r = await fetch(`${s.base}/api/farms`, { method: 'POST', body: '{}',
      headers: { 'content-type': 'application/json', origin: s.base } });
    const { id } = await r.json();
    const urls = { en: [`/f/${id}/manifest.webmanifest`, '/manifest.webmanifest'],
      bg: [`/f/${id}/manifest.webmanifest?lang=bg`, '/manifest.bg.webmanifest'] };
    for (const [lang, list] of Object.entries(urls)) {
      for (const u of list) {
        const res = await fetch(`${s.base}${u}`);
        assert.equal(res.status, 200, u);
        assert.match(res.headers.get('content-type'), /application\/manifest\+json/, u);
        const m = await res.json();
        assert.equal(m.description, (lang === 'bg' ? BG : EN)['front.hero.tag'], u);
        assert.doesNotMatch(m.description, /home network|домашната/, u);
        assert.equal(m.lang, lang, u);
        assert.ok(m.name && m.icons.length, u);
      }
    }
    assert.equal((await (await fetch(`${s.base}/f/${id}/manifest.webmanifest`)).json()).start_url, `/f/${id}`);
    assert.equal((await (await fetch(`${s.base}/manifest.webmanifest`)).json()).start_url, '/', 'the landing\'s start');
  } finally {
    await s.close();
  }
});

test('I-04: a home server (single mode) keeps "shared over your home network"', async () => {
  const srv = await testServer();
  try {
    const m = await (await fetch(`http://127.0.0.1:${srv.port}/manifest.webmanifest`)).json();
    assert.match(m.description, /home network/);
  } finally {
    await srv.close();
  }
});

// ---- S-12 (ui-shell's, infra's side): the picker painting's preload added by script follows option 2's rewrite -----

test('S-12: the inline preload of the picker painting asks the URL the stylesheet asks, on the self and the host page',
  async () => {
    const vm = await import('node:vm');
    const { StaticFiles } = await import('../server/static.js');
    const quiet = { info() {}, warn() {}, error() {}, log() {} };
    const sf = new StaticFiles({ root: new URL('..', import.meta.url).pathname, log: quiet });
    const BASE = `https://hh.example.app/b/${sf.build}`;
    /** Run the page's inline preload script with no farmer's key stored; the href of the link it adds, or null. */
    const preloadOf = (html) => {
      const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((x) => x.includes('welcome.webp'));
      assert.ok(src, 'the inline preload script');
      const logo = /<link rel="preload" as="image" href="([^"]*\/assets\/art\/logo\.webp[^"]*)"/.exec(html);
      assert.ok(logo, 'the logo preload');
      const added = [];
      const document = {
        querySelector: () => ({ getAttribute: () => logo[1] }),
        createElement: () => ({}),
        head: { appendChild: (l) => added.push(l) },
      };
      vm.runInNewContext(src, { document, location: { pathname: '/', hash: '' }, localStorage: { getItem: () => null }, JSON });
      return added[0]?.href ?? null;
    };
    const cssUrl = (html, sheet) => {
      const m = new RegExp(`<link rel="stylesheet" href="([^"]*/css/${sheet}[^"]*)"`).exec(html);
      assert.ok(m, sheet);
      return new URL('../assets/art/welcome.webp', new URL(m[1], 'http://farmbox.local/')).href;
    };
    const self = String(sf.indexHtml().body);
    assert.equal(new URL(preloadOf(self), 'http://farmbox.local/').href, cssUrl(self, 'shell.css'), 'self page');
    const host = String(sf.indexHtml('index.html', BASE).body);
    assert.equal(preloadOf(host), `${BASE}/public/assets/art/welcome.webp`, 'host page: the host copy');
    assert.equal(preloadOf(host), cssUrl(host, 'shell.css'), 'host page: the URL the stylesheet asks for');
  });
