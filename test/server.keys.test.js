// Multi-farm hosted mode: a lost key is never a lost farm (docs/agent-notes/mf-server.md "New keys"). A member makes a
// new key for another farmer of the farm (POST /api/f/:id/rekey): every key that farmer had stops working (their old
// devices get a polite REKEYED refusal and nothing of the farm), and a one-time rejoin link (/f/<id>?rejoin=<token>,
// 7 days, stored as a hash) seats whoever opens it as THAT farmer, with their name (or a new one), look and progress.
// Single mode is untouched (its passphrase reclaim stays).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDataDir, sleep, recorder, testServer } from './helpers/server.js';
import { loadConfig, multiConfig } from '../server/config.js';
import { sha256, PRIVATE_CLOSE } from '../server/farm-sessions.js';
import * as FARMS from '../server/farms.js';
import { PROTOCOL_VERSION, MSG, ERR } from '../shared/net/protocol.js';
import { runAction, makeCtx } from '../shared/rules/index.js';
import { createFarm } from '../shared/rules/state.js';
import { feedRows } from '../shared/rules/feed.js';

async function multiServer(extra = {}, mc = {}) {
  const { startServer } = await import('../server/index.js');
  const dataDir = extra.dataDir || tmpDataDir('mfk');
  const cfg = { ...loadConfig({}), mode: 'multi', multi: { ...multiConfig({}), ...mc }, port: 0, host: '127.0.0.1', dataDir,
    quiet: true, dev: true, awayGraceMs: 0, ...extra };
  const s = await startServer(cfg);
  const close = async () => {
    await s.close();
    if (!extra.keep) fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { ...s, close, dataDir, reg: s.hh.reg, base: `http://127.0.0.1:${s.port}` };
}

async function farmSocket(port, id) {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?farm=${id}`);
  const msgs = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    for (const x of m.t === 'b' ? m.list : [m]) {
      msgs.push(x);
      for (const w of waiters.slice()) if (w.pred(x)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(x); }
    }
  });
  let closedCode = null;
  const closed = new Promise((r) => ws.on('close', (code) => { closedCode = code; r(code); }));
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', () => {});
    ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error(`upgrade ${res.statusCode}`), { status: res.statusCode })));
  });
  return {
    ws, msgs, closed, get closedCode() { return closedCode; },
    send: (m) => ws.send(JSON.stringify(m)),
    next(pred, ms = 3000) {
      const seen = msgs.find(pred);
      if (seen) { msgs.splice(msgs.indexOf(seen), 1); return Promise.resolve(seen); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: (m) => { clearTimeout(t); msgs.splice(msgs.indexOf(m), 1); resolve(m); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timeout; got ${JSON.stringify(msgs).slice(0, 300)}`)); }, ms);
        waiters.push(w);
      });
    },
    close: () => ws.close(),
  };
}

const answer = (m) => m.t === MSG.WELCOME || m.t === MSG.DENY || m.t === MSG.SLOTS;
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
const bearer = (k) => ({ authorization: `Bearer ${k}` });
const rekey = (s, id, key, pid) => post(s.base, `/api/f/${id}/rekey`, { headers: key ? bearer(key) : {}, body: { pid } });
const status = async (s, id, key) => (await fetch(`${s.base}/api/f/${id}/status`, { headers: key ? bearer(key) : {} })).json();

/** A farm with two farmers: Rowan (p1, creator) and Mia (p2, invited). Both sockets stay open. */
async function twoFarmers(s) {
  const { id, secret } = (await post(s.base, '/api/farms')).body;
  const k = await helloOn(s.port, id, { cid: 'rowan1', token: secret });
  k.c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'rowan1', token: secret, claim: { slot: 'p1', name: 'Rowan' } });
  assert.equal((await k.c.next(answer)).t, MSG.WELCOME);
  const inv = (await post(s.base, `/api/f/${id}/invite`, { headers: bearer(secret) })).body.token;
  const m = await helloOn(s.port, id, { cid: 'miaph1', token: inv });
  m.c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'miaph1', token: inv, claim: { slot: 'p2', name: 'Mia', color: '#9B6BD6' } });
  const mw = await m.c.next(answer);
  assert.equal(mw.t, MSG.WELCOME);
  return { id, rowan: secret, mia: mw.token, k: k.c, m: m.c };
}

test('a member makes a new key for the partner: old keys refused politely, the one-time link seats the same farmer', async () => {
  const s = await multiServer();
  try {
    const f = await twoFarmers(s);
    // Mia plays a little first: progress that must survive
    f.m.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    await f.m.next((x) => x.t === MSG.DELTA);
    const before = structuredClone(s.reg.rec(f.id).hh.engine.state.players.p2);
    const r = await rekey(s, f.id, f.rowan, 'p2');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.pid, 'p2');
    assert.match(r.body.token, /^[a-f0-9]{32}$/, '128-bit rejoin token');
    assert.ok(Math.abs(r.body.expiresAt - (Date.now() + FARMS.REJOIN_TTL_MS)) < 60_000, '7 days');
    assert.equal(FARMS.REJOIN_TTL_MS, 7 * 86_400_000);
    // Mia's connected phone: a polite refusal, then the socket closes (it stops knocking)
    assert.deepEqual(await f.m.next((x) => x.t === MSG.DENY), { t: MSG.DENY, code: 'REKEYED' });
    assert.equal(await f.m.closed, PRIVATE_CLOSE);
    // the old key on any device: REKEYED, nothing of the farm, and the socket stays open for the device's next key
    const old = await helloOn(s.port, f.id, { cid: 'miaph2', token: f.mia });
    assert.deepEqual(old.w, { t: MSG.DENY, code: 'REKEYED' });
    await sleep(80);
    assert.equal(old.c.closedCode, null, 'open: a device may hold another key to try');
    assert.ok(!JSON.stringify(old.c.msgs).includes('Mia'), 'no farm data');
    old.c.close();
    const st = await status(s, f.id, f.mia);
    assert.equal(st.member, false, 'the old key is no member any more');
    // the feed: one line for both farmers
    const k1 = await f.k.next((x) => x.t === MSG.DELTA && JSON.stringify(x).includes('"key"'));
    assert.ok(k1, 'Rowan\'s screen hears about it live');
    const rows = feedRows(s.reg.rec(f.id).hh.engine.state).map(([, row]) => row);
    assert.ok(rows.some((row) => row.k === 'key' && row.what === 'new' && row.pid === 'p2' && row.by === 'p1'), JSON.stringify(rows.slice(0, 3)));
    // Mia on a fresh phone with the rejoin link: the picker offers only her own farmer, by name
    const fresh = await helloOn(s.port, f.id, { cid: 'miaph3', token: r.body.token });
    assert.equal(fresh.w.t, MSG.SLOTS);
    assert.deepEqual(fresh.w.slots.map((x) => [x.pid, x.claimed, x.name]), [['p2', true, 'Mia']]);
    fresh.c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'miaph3', token: r.body.token, claim: { slot: 'p2', name: 'Mia' } });
    const w = await fresh.c.next(answer);
    assert.equal(w.t, MSG.WELCOME, JSON.stringify(w));
    assert.equal(w.pid, 'p2');
    assert.match(w.token, /^[a-f0-9]{64}$/, 'a fresh member secret');
    const after = w.state.players.p2;
    for (const k of ['name', 'color', 'xp', 'hearts', 'avatar', 'stats', 'joinedAt']) assert.deepEqual(after[k], before[k], k);
    assert.equal(w.state.farm.objects['home.0.0'].crop.def, 'wheat', 'her farm is all there');
    assert.ok(feedRows(w.state).some(([, row]) => row.k === 'key' && row.what === 'back' && row.pid === 'p2'));
    // single use
    const again = await helloOn(s.port, f.id, { cid: 'evil01', token: r.body.token });
    assert.deepEqual(again.w, { t: MSG.DENY, code: 'REJOIN' });
    again.c.close();
    // her new secret is a member key; the old one stays dead
    assert.equal((await status(s, f.id, w.token)).pid, 'p2');
    const dead = await helloOn(s.port, f.id, { cid: 'miaph4', token: f.mia });
    assert.equal(dead.w.code, 'REKEYED');
    dead.c.close();
    for (const c of [f.k, fresh.c]) c.close();
  } finally {
    await s.close();
  }
});

test('symmetric: the partner makes a new key for the farm\'s creator; whoever opens it takes over and may rename', async () => {
  const s = await multiServer();
  try {
    const f = await twoFarmers(s);
    const r = await rekey(s, f.id, f.mia, 'p1');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(await f.k.next((x) => x.t === MSG.DENY), { t: MSG.DENY, code: 'REKEYED' });
    // the creator's personal link (the creation secret) is dead too
    const link = await helloOn(s.port, f.id, { cid: 'rowan2', token: f.rowan });
    assert.equal(link.w.code, 'REKEYED');
    link.c.close();
    const x = await helloOn(s.port, f.id, { cid: 'newone', token: r.body.token });
    assert.deepEqual(x.w.slots.map((y) => y.pid), ['p1']);
    x.c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'newone', token: r.body.token, claim: { slot: 'p1', name: 'Kris' } });
    const w = await x.c.next(answer);
    assert.equal(w.t, MSG.WELCOME, JSON.stringify(w));
    assert.equal(w.pid, 'p1');
    assert.equal(w.state.players.p1.name, 'Kris', 'renamed');
    assert.ok(await f.m.next((y) => y.t === MSG.PEER && y.pid === 'p1' && y.online), 'Mia sees farmer 1 arrive again');
    for (const c of [f.m, x.c]) c.close();
  } finally {
    await s.close();
  }
});

test('who may make a new key: members only, never for yourself or an empty seat; rejoin and invite tokens mint nothing', async () => {
  const s = await multiServer();
  try {
    const f = await twoFarmers(s);
    assert.equal((await rekey(s, f.id, null, 'p2')).status, 401);
    assert.equal((await rekey(s, f.id, 'f'.repeat(64), 'p2')).status, 403);
    assert.equal((await rekey(s, f.id, f.rowan, 'p1')).status, 400, 'not your own seat');
    assert.equal((await rekey(s, f.id, f.rowan, 'p3')).status, 400, 'no such farmer');
    assert.equal((await rekey(s, f.id, f.rowan, '<x>')).status, 400);
    const r = await rekey(s, f.id, f.rowan, 'p2');
    assert.equal(r.status, 201);
    // a rejoin token is no member key: no invites, no new keys, no member status
    assert.equal((await rekey(s, f.id, r.body.token, 'p1')).status, 403);
    assert.equal((await post(s.base, `/api/f/${f.id}/invite`, { headers: bearer(r.body.token) })).status, 403);
    assert.equal((await status(s, f.id, r.body.token)).member, false);
    // a new key replaces the old link
    const r2 = await rekey(s, f.id, f.rowan, 'p2');
    assert.equal(r2.status, 201);
    const stale = await helloOn(s.port, f.id, { cid: 'miaph5', token: r.body.token });
    assert.deepEqual(stale.w, { t: MSG.DENY, code: 'REJOIN' });
    stale.c.close();
    // expiry: 7 days
    const meta = s.reg.rec(f.id).meta;
    meta.rejoin.p2.exp = Date.now() - 1;
    const late = await helloOn(s.port, f.id, { cid: 'miaph6', token: r2.body.token });
    assert.deepEqual(late.w, { t: MSG.DENY, code: 'REJOIN' });
    late.c.close();
    // another farm's key, and another farm's rejoin token, are nobody here
    const g = await twoFarmers(s);
    assert.equal((await rekey(s, g.id, f.rowan, 'p2')).status, 403);
    const cross = await helloOn(s.port, g.id, { cid: 'cross1', token: r2.body.token });
    assert.equal(cross.w.code, ERR.BAD_TOKEN);
    cross.c.close();
    for (const c of [f.k, f.m, g.k, g.m]) c.close();
  } finally {
    await s.close();
  }
});

test('the rejoin token is stored as a hash only, survives a restart, and making new keys is rate-limited', async () => {
  const dataDir = tmpDataDir('mfk-restart');
  let s = await multiServer({ dataDir, keep: true });
  let f;
  let r;
  try {
    f = await twoFarmers(s);
    r = await rekey(s, f.id, f.rowan, 'p2');
    assert.equal(r.status, 201);
    const dir = path.join(dataDir, 'farms', f.id);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, FARMS.META), 'utf8'));
    assert.equal(meta.rejoin.p2.hash, sha256(r.body.token));
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isFile()) assert.ok(!fs.readFileSync(p, 'utf8').includes(r.body.token), `${name} holds the token`);
    }
    f.k.close();
    await f.m.closed;
  } finally {
    await s.close();
  }
  // a restart (the shutdown snapshot, a fresh boot): the revocation and the link hold
  s = await multiServer({ dataDir });
  try {
    const old = await helloOn(s.port, f.id, { cid: 'miaph9', token: f.mia });
    assert.equal(old.w.code, 'REKEYED');
    old.c.close();
    const back = await helloOn(s.port, f.id, { cid: 'miaph9', token: r.body.token });
    assert.equal(back.w.t, MSG.SLOTS);
    back.c.close();
  } finally {
    await s.close();
  }
  const t = await multiServer({}, { rekeyPerHour: 3 });
  try {
    const g = await twoFarmers(t);
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await rekey(t, g.id, g.rowan, 'p2')).status);
    assert.deepEqual(codes, [201, 201, 201, 429]);
    g.k.close();
  } finally {
    await t.close();
  }
});

test('a seat waiting for its new key: members see it in the farm status; the farm is never stuck full', async () => {
  const s = await multiServer();
  try {
    const f = await twoFarmers(s);
    // Mia lost her phone: the farm is full, and an invite cannot help...
    assert.equal((await post(s.base, `/api/f/${f.id}/invite`, { headers: bearer(f.rowan) })).status, 409);
    // ...but a new key for her seat can
    const r = await rekey(s, f.id, f.rowan, 'p2');
    const st = await status(s, f.id, f.rowan);
    assert.deepEqual(Object.keys(st.waiting ?? {}), ['p2']);
    assert.equal(st.waiting.p2.by, 'p1');
    assert.ok(st.waiting.p2.exp > Date.now());
    assert.equal((await status(s, f.id)).waiting, undefined, 'strangers learn nothing');
    // a friend who never met Mia opens the link: the seat is filled, the farm plays on with two farmers
    const x = await helloOn(s.port, f.id, { cid: 'newfr1', token: r.body.token });
    x.c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'newfr1', token: r.body.token, claim: { slot: 'p2', name: 'Leo' } });
    assert.equal((await x.c.next(answer)).t, MSG.WELCOME);
    const st2 = await status(s, f.id, f.rowan);
    assert.deepEqual(st2.waiting ?? {}, {});
    assert.equal(s.reg.rec(f.id).hh.engine.state.players.p2.name, 'Leo');
    for (const c of [f.k, x.c]) c.close();
  } finally {
    await s.close();
  }
});

test('no rejoin token or member key reaches the log', async () => {
  const rec = recorder();
  const s = await multiServer({ log: rec.log, quiet: false });
  const secrets = [];
  try {
    const f = await twoFarmers(s);
    const r = await rekey(s, f.id, f.rowan, 'p2');
    const x = await helloOn(s.port, f.id, { cid: 'miaph7', token: r.body.token });
    x.c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'miaph7', token: r.body.token, claim: { slot: 'p2', name: 'Mia' } });
    const w = await x.c.next(answer);
    const old = await helloOn(s.port, f.id, { cid: 'miaph8', token: f.mia });
    old.c.close();
    secrets.push(f.id, f.rowan, f.mia, r.body.token, w.token, sha256(r.body.token), sha256(f.mia), sha256(w.token));
    for (const c of [f.k, x.c]) c.close();
    await sleep(50);
  } finally {
    await s.close();
  }
  const text = JSON.stringify(rec.lines);
  assert.ok(/new key/.test(text), 'the event itself is logged');
  for (const x of secrets) assert.ok(!text.includes(x), `the log holds ${x.slice(0, 6)}...`);
});

test('the per-farm home-screen manifest: keyless, the farm\'s own start, served for any well-formed id', async () => {
  const s = await multiServer();
  try {
    const { id } = (await post(s.base, '/api/farms')).body;
    for (const fid of [id, 'zzzzzzzzzzzz']) {
      const res = await fetch(`${s.base}/f/${fid}/manifest.webmanifest`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /application\/manifest\+json/);
      const m = await res.json();
      assert.equal(m.start_url, `/f/${fid}`);
      assert.equal(m.id, `/f/${fid}`);
      assert.equal(m.scope, '/');
      assert.ok(m.name && m.icons.length);
      assert.ok(!JSON.stringify(m).includes('#k='), 'never a key');
    }
    assert.equal((await fetch(`${s.base}/f/BAD/manifest.webmanifest`)).status, 404);
    // the device's language (merge of the Bulgarian translation): ?lang=bg says the description in Bulgarian, same start
    const bg = await (await fetch(`${s.base}/f/${id}/manifest.webmanifest?lang=bg`)).json();
    assert.equal(bg.lang, 'bg');
    assert.equal(bg.start_url, `/f/${id}`);
    assert.match(bg.description, /[а-я]/);
  } finally {
    await s.close();
  }
});

test('single mode is untouched: no re-key route; the passphrase reclaim still works', async () => {
  const s = await testServer();
  try {
    const base = `http://127.0.0.1:${s.port}`;
    assert.equal((await post(base, '/api/f/abcdefghijkl/rekey', { body: { pid: 'p2' } })).status, 404);
    assert.equal((await fetch(`${base}/f/abcdefghijkl/manifest.webmanifest`)).status, 404);
  } finally {
    await s.close();
  }
});

test('rules: `_key` is server-only; a new key writes one feed line; coming back may rename, never to an empty name', () => {
  const now = Date.UTC(2026, 9, 5, 12);
  const st = createFarm({ seed: 7, now });
  const sys = (type, args) => runAction(st, { type, args }, makeCtx(st, { now, pid: 'sys', cid: 'sys', seq: 1 }));
  assert.ok(sys('_join', { pid: 'p1', name: 'Rowan' }).ok);
  assert.ok(sys('_join', { pid: 'p2', name: 'Mia' }).ok);
  const asPlayer = runAction(st, { type: '_key', args: { pid: 'p2', what: 'new', by: 'p1' } }, makeCtx(st, { now, pid: 'p1', cid: 'abcdef', seq: 1 }));
  assert.equal(asPlayer.ok, false, 'players cannot run it');
  assert.ok(sys('_key', { pid: 'p2', what: 'new', by: 'p1' }).ok);
  assert.equal(sys('_key', { pid: 'p3', what: 'new', by: 'p1' }).ok, false, 'no such farmer');
  assert.ok(sys('_key', { pid: 'p2', what: 'back', name: 'Mila' }).ok);
  assert.equal(st.players.p2.name, 'Mila');
  assert.equal(sys('_key', { pid: 'p2', what: 'back', name: '   ' }).ok, false);
  const rows = feedRows(st).map(([, row]) => row).filter((row) => row.k === 'key');
  assert.deepEqual(rows.map((row) => [row.what, row.pid, row.by]), [['back', 'p2', 'p2'], ['new', 'p2', 'p1']]);
});
