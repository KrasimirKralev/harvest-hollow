// Multi-farm hosted mode (HH_MODE=multi; docs/agent-briefs/multi-farm.md, docs/agent-notes/mf-server.md):
// farm creation and its limits, the three keys (creator secret, invite, member secret), privacy, isolation of two
// farms, unload -> reload, catch-up after a long sleep, retention, and that no key or farm id reaches the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDataDir, plain, sleep, recorder, writeSave, testServer } from './helpers/server.js';
import { loadConfig, multiConfig, ConfigError } from '../server/config.js';
import { clientIp, WindowLimiter } from '../server/ip-limits.js';
import { sameHash, sha256, PRIVATE_CLOSE } from '../server/farm-sessions.js';
import { ID_RE, META, INVITE_TTL_MS } from '../server/farms.js';
import { PROTOCOL_VERSION, MSG, ERR } from '../shared/net/protocol.js';
import { CRATES } from '../shared/content/wishes4b.js';

const DAY = 86_400_000;

async function multiServer(extra = {}, mc = {}) {
  const { startServer } = await import('../server/index.js');
  const dataDir = extra.dataDir || tmpDataDir('mf');
  const cfg = { ...loadConfig({}), mode: 'multi', multi: { ...multiConfig({}), ...mc }, port: 0, host: '127.0.0.1', dataDir,
    quiet: true, dev: true, awayGraceMs: 0, ...extra };
  const s = await startServer(cfg);
  const close = async () => {
    await s.close();
    if (!extra.keep) fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { ...s, close, dataDir, reg: s.hh.reg, base: `http://127.0.0.1:${s.port}` };
}

/** A socket to /ws?farm=<id>; resolves { ws, msgs, next, send, closed } or rejects with the upgrade's HTTP status. */
async function farmSocket(port, id, headers = {}) {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?farm=${id}`, { headers });
  const msgs = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    const list = m.t === 'b' ? m.list : [m];
    for (const x of list) {
      msgs.push(x);
      for (const w of waiters.slice()) if (w.pred(x)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(x); }
    }
  });
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', () => {});
    ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error(`upgrade ${res.statusCode}`), { status: res.statusCode })));
  });
  return {
    ws, msgs, closed,
    send: (m) => ws.send(JSON.stringify(m)),
    next(pred, ms = 3000) {
      const seen = msgs.find(pred);
      if (seen) { msgs.splice(msgs.indexOf(seen), 1); return Promise.resolve(seen); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: (m) => { clearTimeout(t); msgs.splice(msgs.indexOf(m), 1); resolve(m); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timeout waiting for message; got ${JSON.stringify(msgs).slice(0, 300)}`)); }, ms);
        waiters.push(w);
      });
    },
    close: () => ws.close(),
  };
}

const answer = (m) => m.t === MSG.WELCOME || m.t === MSG.DENY || m.t === MSG.SLOTS;

/** hello on a new socket; resolves { c, w } with the first welcome / deny / slots. */
async function helloOn(port, id, fields) {
  const c = await farmSocket(port, id);
  c.send({ t: 'hello', proto: PROTOCOL_VERSION, ...fields });
  return { c, w: await c.next(answer) };
}

async function post(base, url, { body, headers = {} } = {}) {
  const r = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) };
}

const newFarm = async (s, headers = {}) => (await post(s.base, '/api/farms', { headers })).body;

/** Create a farm and seat its creator as p1: { id, secret, c (the creator's socket), w (welcome) }. */
async function seatedFarm(s, name = 'Rowan', cid = 'crea01') {
  const { id, secret } = await newFarm(s);
  const { c, w } = await helloOn(s.port, id, { cid, token: secret });
  assert.equal(w.t, MSG.SLOTS);
  c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid, token: secret, claim: { slot: 'p1', name } });
  const welcome = await c.next((m) => m.t === MSG.WELCOME || m.t === MSG.DENY);
  assert.equal(welcome.t, MSG.WELCOME, JSON.stringify(welcome));
  return { id, secret, c, w: welcome };
}

const invite = (s, id, secret) => post(s.base, `/api/f/${id}/invite`, { headers: { authorization: `Bearer ${secret}` } });

test('single mode stays the default: no farm routes, / is the game, a bare hello still gets the slot list', async () => {
  assert.equal(loadConfig({}).mode, 'single');
  assert.equal(loadConfig({}).multi, null);
  assert.throws(() => loadConfig({ HH_MODE: 'many' }), ConfigError);
  assert.throws(() => loadConfig({ HH_MODE: 'multi', HH_MAX_FARMS: 'lots' }), ConfigError);
  assert.equal(loadConfig({ HH_MODE: 'multi', HH_MAX_FARMS: '7' }).multi.maxFarms, 7);
  const s = await testServer();
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const st = await (await fetch(`${base}/api/status`)).json();
    assert.equal(st.mode, undefined, 'the single-farm status body is unchanged');
    assert.ok(Array.isArray(st.slots));
    assert.equal((await fetch(`${base}/api/farms`, { method: 'POST' })).status, 404);
    assert.match(await (await fetch(`${base}/`)).text(), /name="hh-build"/);
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'single' }));
    const m = await new Promise((r) => ws.once('message', (raw) => r(JSON.parse(String(raw)))));
    assert.equal(m.t, MSG.SLOTS);
    ws.close();
  } finally {
    await s.close();
  }
});

test('a new farm: 201 { id, secret }, random and long; the disk holds hashes only; / and /f/<id> are pages', async () => {
  const s = await multiServer();
  try {
    const a = await post(s.base, '/api/farms');
    const b = await post(s.base, '/api/farms', { body: { tz: 'Europe/Sofia' } });
    assert.equal(a.status, 201);
    assert.deepEqual(Object.keys(a.body).sort(), ['id', 'secret']);
    assert.match(a.body.id, ID_RE);
    assert.match(a.body.secret, /^[a-f0-9]{64}$/, '256-bit secret');
    assert.notEqual(a.body.id, b.body.id);
    assert.notEqual(a.body.secret, b.body.secret);
    const dir = path.join(s.dataDir, 'farms', a.body.id);
    assert.ok(fs.existsSync(path.join(dir, 'farm.json')), 'durable before the answer');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, META), 'utf8'));
    assert.equal(meta.reserve.slot, 'p1');
    assert.equal(meta.reserve.hash, sha256(a.body.secret));
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isFile()) assert.ok(!fs.readFileSync(p, 'utf8').includes(a.body.secret), `${f} holds the secret`);
    }
    assert.equal(s.reg.rec(b.body.id).hh.engine.state.meta.tz, 'Europe/Sofia', 'the creator\'s zone is the farm\'s');
    const st = await (await fetch(`${s.base}/api/status`)).json();
    assert.equal(st.mode, 'multi');
    assert.equal(st.farms.stored, 2);
    assert.ok(!JSON.stringify(st).includes(a.body.id), 'the global status names no farm');
    const fst = await (await fetch(`${s.base}/api/f/${a.body.id}/status`)).json();
    assert.deepEqual({ ok: fst.ok, full: fst.full, ttlDays: fst.ttlDays, slots: fst.slots }, { ok: true, full: false, ttlDays: 7, slots: 2 });
    assert.equal(fst.buildHash, st.buildHash);
    assert.equal((await fetch(`${s.base}/api/f/aaaaaaaaaaaa/status`)).status, 404);
    const landing = await fetch(`${s.base}/`);
    assert.equal(landing.status, 200);
    assert.ok(!(await landing.text()).includes('name="hh-build"') || fs.existsSync(path.join(s.hh.cfg.root, 'public', 'landing.html')));
    const game = await fetch(`${s.base}/f/${a.body.id}`);
    assert.match(await game.text(), /name="hh-build"/, 'the game page, rendered like / in single mode');
    assert.equal(game.headers.get('referrer-policy'), 'same-origin');
  } finally {
    await s.close();
  }
});

test('creation limits: per address an hour and a day (behind one trusted proxy), the global cap, other sites refused', async () => {
  const s = await multiServer({}, { createPerHour: 2, createPerDay: 3, maxFarms: 5 });
  try {
    const from = (ip) => ({ 'x-forwarded-for': ip });
    assert.equal((await post(s.base, '/api/farms', { headers: from('203.0.113.1') })).status, 201);
    assert.equal((await post(s.base, '/api/farms', { headers: from('203.0.113.1') })).status, 201);
    const third = await post(s.base, '/api/farms', { headers: from('203.0.113.1') });
    assert.equal(third.status, 429);
    assert.equal(third.body.error, 'RATE');
    assert.ok(third.body.retryAfter > 0 && Number(third.headers.get('retry-after')) > 0);
    // a client cannot spoof its way out: the proxy's own entry (the last one) is the address
    assert.equal((await post(s.base, '/api/farms', { headers: from('198.51.100.9, 203.0.113.1') })).status, 429);
    assert.equal((await post(s.base, '/api/farms', { headers: from('203.0.113.2') })).status, 201);
    assert.equal((await post(s.base, '/api/farms', { headers: { ...from('203.0.113.3'), origin: 'https://evil.example' } })).status, 403);
    assert.equal((await post(s.base, '/api/farms', { headers: from('203.0.113.3') })).status, 201);
    assert.equal((await post(s.base, '/api/farms', { headers: from('203.0.113.4') })).status, 201);
    const full = await post(s.base, '/api/farms', { headers: from('203.0.113.5') });
    assert.equal(full.status, 503);
    assert.equal(full.body.error, 'FULL');
    assert.equal(s.reg.count, 5);
  } finally {
    await s.close();
  }
});

test('the creator sits down with the secret, which then opens the farm as them on any device (the personal link)', async () => {
  const s = await multiServer();
  try {
    const { id, secret } = await newFarm(s);
    const first = await helloOn(s.port, id, { cid: 'crea01', token: secret });
    assert.equal(first.w.t, MSG.SLOTS);
    assert.deepEqual(first.w.slots.map((x) => x.pid), ['p1'], 'the creator is farmer 1');
    assert.equal(first.w.pass, false);
    // the claim may come without the key: the socket remembers it
    first.c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'crea01', claim: { slot: 'p2', name: 'Rowan' } });
    assert.equal((await first.c.next(answer)).code, ERR.BAD_HELLO, 'only the reserved slot');
    first.c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'crea01', claim: { slot: 'p1', name: 'Rowan', color: '#ff8800' } });
    const w = await first.c.next(answer);
    assert.equal(w.t, MSG.WELCOME);
    assert.equal(w.pid, 'p1');
    assert.equal(w.token, secret, 'the creator secret is their member secret');
    assert.equal(w.state.players.p1.name, 'Rowan');
    assert.equal(s.reg.rec(id).meta.reserve, null);
    // another device with the personal link
    const other = await helloOn(s.port, id, { cid: 'phone1', token: secret });
    assert.equal(other.w.t, MSG.WELCOME);
    assert.equal(other.w.pid, 'p1');
    assert.equal(other.w.token, undefined);
    const st = await (await fetch(`${s.base}/api/f/${id}/status`, { headers: { authorization: `Bearer ${secret}` } })).json();
    assert.equal(st.member, true);
    assert.equal(st.pid, 'p1');
    first.c.close();
    other.c.close();
  } finally {
    await s.close();
  }
});

test('invites: members only, one use, a new one replaces the old one, 7 days, refused when the farm is full', async () => {
  const s = await multiServer();
  try {
    const { id, secret, c } = await seatedFarm(s);
    assert.equal((await post(s.base, `/api/f/${id}/invite`)).status, 401);
    assert.equal((await invite(s, id, 'f'.repeat(64))).status, 403);
    const first = await invite(s, id, secret);
    assert.equal(first.status, 201);
    assert.match(first.body.token, /^[a-f0-9]{32}$/, '128-bit invite');
    assert.ok(Math.abs(first.body.expiresAt - (Date.now() + INVITE_TTL_MS)) < 60_000);
    // the body form works too (the client sends both)
    const second = await post(s.base, `/api/f/${id}/invite`, { body: { secret } });
    assert.equal(second.status, 201);
    const st = await (await fetch(`${s.base}/api/f/${id}/status?join=${first.body.token}`)).json();
    assert.equal(st.invite, 'used', 'replaced');
    const old = await helloOn(s.port, id, { cid: 'mia001', token: first.body.token });
    assert.deepEqual(old.w, { t: MSG.DENY, code: 'INVITE' });
    assert.equal(await old.c.closed, PRIVATE_CLOSE);
    // an expired invite
    const rec = s.reg.rec(id);
    const exp = rec.meta.invite.exp;
    rec.meta.invite.exp = Date.now() - 1;
    const late = await helloOn(s.port, id, { cid: 'mia001', token: second.body.token });
    assert.deepEqual(late.w, { t: MSG.DENY, code: 'INVITE' });
    rec.meta.invite.exp = exp;
    // the friend: slots (only the free slot, no names), then the claim
    const mia = await helloOn(s.port, id, { cid: 'mia001', token: second.body.token });
    assert.equal(mia.w.t, MSG.SLOTS);
    assert.deepEqual(mia.w.slots.map((x) => [x.pid, x.claimed]), [['p2', false]]);
    mia.c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'mia001', token: second.body.token, claim: { slot: 'p2', name: 'Mia' } });
    const w = await mia.c.next(answer);
    assert.equal(w.t, MSG.WELCOME);
    assert.equal(w.pid, 'p2');
    assert.match(w.token, /^[a-f0-9]{64}$/);
    assert.notEqual(w.token, second.body.token);
    assert.equal((await c.next((m) => m.t === MSG.PEER && m.pid === 'p2')).online, true, 'live: the host sees her arrive');
    // single use, and the farm is full now
    const again = await helloOn(s.port, id, { cid: 'eve001', join: second.body.token });
    assert.deepEqual(again.w, { t: MSG.DENY, code: 'FULL' });
    assert.equal((await invite(s, id, secret)).status, 409);
    assert.equal((await invite(s, id, w.token)).body.error, 'FULL', 'the friend is a member now (and the farm is full)');
    // her member secret opens the farm as her
    const back = await helloOn(s.port, id, { cid: 'mia002', token: w.token });
    assert.equal(back.w.pid, 'p2');
    for (const x of [c, mia.c, back.c]) x.close();
  } finally {
    await s.close();
  }
});

test('a farm is private without a key: PRIVATE then close, nothing of the farm sent; a foreign key is BAD_TOKEN', async () => {
  const s = await multiServer();
  try {
    const { id, c } = await seatedFarm(s, 'Rowan');
    const bare = await helloOn(s.port, id, { cid: 'stran1' });
    assert.deepEqual(bare.w, { t: MSG.DENY, code: 'PRIVATE' });
    assert.equal(await bare.c.closed, PRIVATE_CLOSE);
    assert.ok(!bare.c.msgs.some((m) => JSON.stringify(m).includes('Rowan')));
    const claim = await helloOn(s.port, id, { cid: 'stran2', claim: { slot: 'p2', name: 'Eve' } });
    assert.deepEqual(claim.w, { t: MSG.DENY, code: 'PRIVATE' });
    const foreign = await helloOn(s.port, id, { cid: 'stran3', token: 'a'.repeat(64) });
    assert.deepEqual(foreign.w, { t: MSG.DENY, code: ERR.BAD_TOKEN }, 'the client drops a stale key and tries its next way in');
    foreign.c.close();
    await assert.rejects(farmSocket(s.port, 'bbbbbbbbbbbb'), (e) => e.status === 404);
    await assert.rejects(farmSocket(s.port, '../../etc'), (e) => e.status === 404);
    await assert.rejects(farmSocket(s.port, id, { origin: 'https://evil.example' }), (e) => e.status === 403);
    const st = await (await fetch(`${s.base}/api/f/${id}/status`)).json();
    assert.equal(st.member, undefined);
    assert.ok(!JSON.stringify(st).includes('Rowan'));
    c.close();
  } finally {
    await s.close();
  }
});

test('the open sockets of one address are capped at the upgrade (429), across farms', async () => {
  const s = await multiServer({}, { wsPerIp: 2 });
  try {
    const { id } = await newFarm(s);
    const a = await farmSocket(s.port, id);
    const b = await farmSocket(s.port, id);
    await assert.rejects(farmSocket(s.port, id), (e) => e.status === 429);
    a.close();
    await a.closed;
    await sleep(30);
    const c = await farmSocket(s.port, id);
    b.close();
    c.close();
  } finally {
    await s.close();
  }
});

test('two farms are isolated: state, deltas, chat and keys', async () => {
  const s = await multiServer();
  try {
    const A = await seatedFarm(s, 'Rowan', 'farma1');
    const B = await seatedFarm(s, 'Desi', 'farmb1');
    const vB = s.reg.rec(B.id).hh.engine.v;
    B.c.msgs.length = 0;
    A.c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    assert.equal((await A.c.next((m) => m.t === MSG.DELTA)).seq, 1);
    A.c.send({ t: 'chat', text: 'only for farm A' });
    await A.c.next((m) => m.t === MSG.CHAT);
    await sleep(60);
    assert.deepEqual(B.c.msgs.filter((m) => m.t === MSG.DELTA || m.t === MSG.CHAT), [], 'farm B heard nothing');
    assert.equal(s.reg.rec(B.id).hh.engine.v, vB);
    assert.equal(s.reg.rec(B.id).hh.engine.state.farm.objects['home.0.0'].crop, null);
    assert.equal(s.reg.rec(A.id).hh.engine.state.farm.objects['home.0.0'].crop.def, 'wheat');
    // one farm's key is nobody on the other farm
    const cross = await helloOn(s.port, B.id, { cid: 'cross1', token: A.secret });
    assert.equal(cross.w.code, ERR.BAD_TOKEN);
    cross.c.close();
    const inv = await invite(s, B.id, A.secret);
    assert.equal(inv.status, 403);
    A.c.close();
    B.c.close();
  } finally {
    await s.close();
  }
});

test('unload -> reload gives the identical farm; idle farms unload; the LRU cap unloads the least recently used', async () => {
  const s = await multiServer({}, { maxLoaded: 2 });
  try {
    const A = await seatedFarm(s, 'Rowan', 'farma1');
    A.c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    await A.c.next((m) => m.t === MSG.DELTA);
    A.c.close();
    await A.c.closed;
    await sleep(50);
    const rec = s.reg.rec(A.id);
    const before = { state: plain(rec.hh.engine.state), v: rec.hh.engine.v };
    // idle: nothing happens before idleMs, then it unloads (snapshot first)
    rec.leaseUntil = 0;
    await s.reg.idleCheck();
    assert.ok(rec.hh, 'not idle long enough yet');
    rec.idleSince = Date.now() - s.hh.mc.idleMs;
    await s.reg.idleCheck();
    assert.equal(rec.hh, null, 'unloaded');
    const again = await s.reg.acquire(A.id);
    assert.equal(again.hh.engine.v, before.v);
    assert.deepEqual(plain(again.hh.engine.state), before.state);
    const resumed = await helloOn(s.port, A.id, { cid: 'farma1', token: A.secret });
    assert.equal(resumed.w.t, MSG.WELCOME);
    assert.equal(resumed.w.lastSeq, 1, 'the tab\'s exactly-once record survived the sleep');
    resumed.c.close();
    await resumed.c.closed;
    await sleep(30);
    // LRU: A is loaded; B and C are created (each loads); the cap of 2 unloads the least recently used idle one
    again.leaseUntil = 0;
    const b = await newFarm(s);
    s.reg.rec(b.id).leaseUntil = 0;
    s.reg.rec(b.id).lastUsed = Date.now() + 1000;
    const c = await newFarm(s);
    assert.equal(s.reg.loadedCount, 2);
    assert.equal(s.reg.rec(A.id).hh, null, 'the least recently used idle farm went first');
    assert.ok(s.reg.rec(b.id).hh && s.reg.rec(c.id).hh);
    const st = await (await fetch(`${s.base}/api/status`)).json();
    assert.equal(st.farms.loaded, 2);
    assert.equal(st.farms.stored, 3);
  } finally {
    await s.close();
  }
});

test('a farm that slept catches up exactly like a restarted single-farm server (and nothing floods)', async () => {
  // the two boots below must not straddle a balloon drop moment (k x everyMs + dropAtMs, actions/crates.js): one
  // more pass would be a real difference between them, not a bug
  const toPass = CRATES.everyMs - ((Date.now() - CRATES.dropAtMs) % CRATES.everyMs);
  if (toPass < 3000) await sleep(toPass + 50);
  const now = Date.now();
  const { dir: src, tokens } = writeSave({ now: now - 3 * DAY, level: 12, place: [] });
  const single = tmpDataDir('mf-single');
  const multi = tmpDataDir('mf-multi');
  const id = 'sleepyfarm22';
  fs.cpSync(src, single, { recursive: true });
  fs.cpSync(src, path.join(multi, 'farms', id), { recursive: true });
  fs.rmSync(src, { recursive: true, force: true });
  const one = await testServer({ dataDir: single });
  const host = await multiServer({ dataDir: multi });
  try {
    assert.equal(host.reg.count, 1, 'a farm copied in without meta is indexed from its save');
    const rec = await host.reg.acquire(id);
    const a = one.hh.engine.state;
    const b = rec.hh.engine.state;
    const savedV = 2;                                    // writeSave: two `_join` lines
    assert.equal(rec.hh.engine.v, one.hh.engine.v, 'the same number of catch-up actions');
    const ran = one.hh.engine.v - savedV;
    assert.ok(ran >= 3 && ran < 30, `the catch-up ran and stayed small (${ran} actions for 3 days)`);
    // everything but the instants of the two boots is identical
    const boot = (o) => JSON.parse(JSON.stringify(o), (_k, v) => (typeof v === 'number' && Math.abs(v - Date.now()) < 120_000 ? 'BOOT' : v));
    const same = (k) => assert.deepEqual(boot(b.farm[k]), boot(a.farm[k]), `farm.${k}`);
    for (const k of ['daily', 'orders', 'rain', 'regrow', 'rolls', 'challenge']) same(k);
    assert.deepEqual(b.farm.crates, a.farm.crates);
    const crates = (st) => Object.values(st.farm.objects).filter((o) => o.def === CRATES.def).length;
    assert.equal(crates(b), crates(a));
    assert.ok(crates(b) <= CRATES.maxOpen, 'balloon crates are capped');
    assert.deepEqual(Object.keys(b.players).sort(), ['p1', 'p2']);
    // a member key written by a single-farm server works here too
    const w = await helloOn(host.port, id, { cid: 'slept1', token: tokens.p1 });
    assert.equal(w.w.t, MSG.WELCOME);
    w.c.close();
  } finally {
    await one.close();
    await host.close();
  }
});

test('retention: the sweep deletes farms nobody visited for 7 days; visited and connected farms stay', async () => {
  const s = await multiServer();
  try {
    const stale = await newFarm(s);
    const fresh = await newFarm(s);
    const here = await seatedFarm(s, 'Rowan', 'here01');
    for (const f of [stale, fresh, here]) s.reg.rec(f.id).leaseUntil = 0;
    const eightDays = Date.now() - 8 * DAY;
    s.reg.rec(stale.id).meta.lastSeenAt = eightDays;
    s.reg.rec(here.id).meta.lastSeenAt = eightDays;          // stale on paper, but a farmer is connected
    assert.equal(await s.reg.sweep(), 1);
    assert.equal(fs.existsSync(path.join(s.dataDir, 'farms', stale.id)), false);
    assert.equal((await fetch(`${s.base}/api/f/${stale.id}/status`)).status, 404);
    assert.ok(s.reg.has(fresh.id) && s.reg.has(here.id));
    // the last farmer leaving stamps the visit, so the farm is kept for another 7 days
    here.c.close();
    await here.c.closed;
    await sleep(30);
    assert.ok(Date.now() - s.reg.rec(here.id).meta.lastSeenAt < 5000);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'farms', here.id, META), 'utf8')).lastSeenAt,
      s.reg.rec(here.id).meta.lastSeenAt, 'written to disk');
    assert.equal(await s.reg.sweep(Date.now() + 6 * DAY), 0);
    s.reg.rec(here.id).leaseUntil = 0;
    s.reg.rec(fresh.id).leaseUntil = 0;
    assert.equal(await s.reg.sweep(Date.now() + 8 * DAY), 2, 'unloaded first, then deleted');
    assert.equal(s.reg.count, 0);
    // the dev route runs the same sweep
    assert.deepEqual((await post(s.base, '/api/dev/sweep', { body: {} })).body, { ok: true, deleted: 0 });
  } finally {
    await s.close();
  }
});

test('no key, invite token or farm id ever reaches the log', async () => {
  const rec = recorder();
  const s = await multiServer({ log: rec.log, quiet: false });
  const secrets = [];
  try {
    const { id, secret, c } = await seatedFarm(s);
    const inv = (await invite(s, id, secret)).body.token;
    const mia = await helloOn(s.port, id, { cid: 'mia001', token: inv });
    mia.c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'mia001', token: inv, claim: { slot: 'p2', name: 'Mia' } });
    const w = await mia.c.next(answer);
    const bad = await helloOn(s.port, id, { cid: 'bad001', token: 'b'.repeat(64) });
    bad.c.close();
    await fetch(`${s.base}/api/f/${id}/status?join=${inv}`, { headers: { authorization: `Bearer ${secret}` } });
    secrets.push(id, secret, inv, w.token, sha256(secret), sha256(inv), sha256(w.token));
    c.close();
    mia.c.close();
    await sleep(50);
    const r = s.reg.rec(id);
    r.leaseUntil = 0;
    await s.reg.unload(r);
    await s.reg.acquire(id);
  } finally {
    await s.close();
  }
  const text = JSON.stringify(rec.lines);
  assert.ok(rec.lines.length > 3, 'the log was captured');
  for (const x of secrets) assert.ok(!text.includes(x), `the log holds ${x.slice(0, 6)}...`);
});

test('helpers: the client address behind proxies, sliding windows, constant-time hash compare', () => {
  const req = (xff, remote = '10.0.0.1') => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: remote } });
  assert.equal(clientIp(req('1.1.1.1'), 0), '10.0.0.1', 'no proxy trusted: the socket');
  assert.equal(clientIp(req('1.1.1.1'), 1), '1.1.1.1');
  assert.equal(clientIp(req('6.6.6.6, 1.1.1.1'), 1), '1.1.1.1', 'a spoofed left entry is ignored');
  assert.equal(clientIp(req(null, '::ffff:192.0.2.7'), 1), '192.0.2.7');
  assert.equal(clientIp(req('6.6.6.6, 1.1.1.1, 2.2.2.2'), 2), '1.1.1.1');
  let t = 0;
  const lim = new WindowLimiter([[1000, 2], [10_000, 3]], () => t);
  assert.ok(lim.take('a').ok && lim.take('a').ok);
  const no = lim.take('a');
  assert.equal(no.ok, false);
  assert.equal(no.retryAfterMs, 1000);
  assert.ok(lim.take('b').ok, 'per key');
  t = 1000;
  assert.ok(lim.take('a').ok);
  t = 2000;
  assert.equal(lim.take('a').ok, false, 'the day window');
  t = 10_001;
  assert.ok(lim.take('a').ok);
  t = 100_000;
  lim.prune();
  assert.equal(lim.hits.size, 0);
  assert.ok(sameHash(sha256('x'), sha256('x')));
  assert.ok(!sameHash(sha256('x'), sha256('y')));
  assert.ok(!sameHash(sha256('x'), 'abc'));
  assert.ok(!sameHash(undefined, undefined));
});

test('a farm that cannot load answers 503 and keeps its files; its id stays out of the log; other farms play on', async () => {
  const dataDir = tmpDataDir('mf-broken');
  const id = 'brokenfarm23';
  const dir = path.join(dataDir, 'farms', id);
  fs.mkdirSync(dir, { recursive: true });
  // journal lines without any snapshot or backup: a single-farm server refuses to boot on this (BootRefused)
  fs.writeFileSync(path.join(dir, 'farm.journal.jsonl'), `${JSON.stringify({ v: 1, now: Date.now(), pid: 'sys', cid: 'sys', seq: 1, type: '_seen', args: { pid: 'p1' } })}\n`);
  fs.writeFileSync(path.join(dir, META), JSON.stringify({ v: 1, id, createdAt: Date.now(), lastSeenAt: Date.now(), members: 1, tz: null, reserve: null, invite: null }));
  const rec = recorder();
  const s = await multiServer({ dataDir, log: rec.log, quiet: false });
  try {
    await assert.rejects(farmSocket(s.port, id), (e) => e.status === 503);
    const st = await fetch(`${s.base}/api/f/${id}/status`, { headers: { authorization: `Bearer ${'c'.repeat(64)}` } });
    assert.equal(st.status, 503);
    assert.ok(fs.existsSync(path.join(dir, 'farm.journal.jsonl')), 'the journal is kept for a human');
    assert.ok(fs.readdirSync(path.join(dir, 'incidents')).length > 0, 'and copied into incidents/');
    const ok = await seatedFarm(s, 'Rowan', 'other1');
    ok.c.close();
    const text = JSON.stringify(rec.lines);
    assert.match(text, /could not be loaded/);
    assert.ok(!text.includes(id), 'the broken farm\'s id is not in the log (its paths are redacted)');
    assert.ok(!text.includes(ok.id));
  } finally {
    await s.close();
  }
});

test('a long outage of the host is not a week without visits: every farm keeps the days the host was down', async () => {
  const dataDir = tmpDataDir('mf-outage');
  const now = Date.now();
  const id = 'outagefarm23';
  const { dir: src } = writeSave({ now: now - 10 * DAY });
  fs.cpSync(src, path.join(dataDir, 'farms', id), { recursive: true });
  fs.rmSync(src, { recursive: true, force: true });
  fs.writeFileSync(path.join(dataDir, 'farms', id, META), JSON.stringify({ v: 1, id, createdAt: now - 20 * DAY,
    lastSeenAt: now - 10 * DAY, members: 2, tz: null, reserve: null, invite: null }));
  fs.writeFileSync(path.join(dataDir, 'farms', 'host.json'), JSON.stringify({ aliveAt: now - 9 * DAY }));
  const s = await multiServer({ dataDir });
  try {
    await sleep(50);                                  // the boot sweep has run
    assert.ok(s.reg.has(id), 'kept: it was 1 day without visits while the host was up');
    const seen = JSON.parse(fs.readFileSync(path.join(dataDir, 'farms', id, META), 'utf8')).lastSeenAt;
    assert.ok(Math.abs(seen - (now - DAY)) < 60_000, 'its last visit moved forward by the outage, on disk');
    assert.ok(JSON.parse(fs.readFileSync(path.join(dataDir, 'farms', 'host.json'), 'utf8')).aliveAt >= now);
    assert.equal(await s.reg.sweep(now + 7 * DAY), 1, 'a week later (host up) it goes');
  } finally {
    await s.close();
  }
});

test('lead: a public multi host refuses HH_DEV=1 under NODE_ENV=production; dev and single mode still boot', () => {
  assert.throws(() => loadConfig({ HH_MODE: 'multi', HH_DEV: '1', NODE_ENV: 'production' }), ConfigError);
  assert.equal(loadConfig({ HH_MODE: 'multi', HH_DEV: '1' }).dev, true);
  assert.equal(loadConfig({ HH_MODE: 'multi', NODE_ENV: 'production' }).dev, false);
  assert.equal(loadConfig({ HH_DEV: '1', NODE_ENV: 'production' }).dev, true);     // single mode: unchanged
});

test('lead: socket handshakes share the per-address lookup budget, so farm ids cannot be guessed over sockets', async () => {
  const s = await multiServer();
  try {
    const { id } = await newFarm(s);
    let refused = 0;
    let unknown = 0;
    for (let i = 0; i < 125; i++) {
      // a well-formed id nobody owns: 404 until the budget runs out, then 429
      await farmSocket(s.port, 'aaaaaaaaaaaa').catch((e) => { if (e.status === 429) refused++; else if (e.status === 404) unknown++; });
    }
    assert.equal(unknown, 120);
    assert.equal(refused, 5);
    await assert.rejects(farmSocket(s.port, id), (e) => e.status === 429);     // the real farm too, from this address
  } finally {
    await s.close();
  }
});

test('lead: the host log redacts a farm id in any line, not only in a farm\'s own lines', async () => {
  const rec = recorder();
  const s = await multiServer({ log: rec.log });
  try {
    const { id } = await newFarm(s);
    s.hh.log.error('uncaught exception; exiting for a clean restart', new Error(`ENOENT: /data/farms/${id}/farm.json`));
    const text = JSON.stringify(rec.lines);
    assert.ok(!text.includes(id), text);
  } finally {
    await s.close();
  }
});
