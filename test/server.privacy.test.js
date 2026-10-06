// Privacy on the multi-farm host (public/privacy.html says all of this to players; docs/agent-notes/mf-server.md
// "Privacy"): no full client address in any log line (info lines carry none, abuse warnings only the /24 or /48
// network), the address helper itself, and that single mode keeps its own logs as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpDataDir, recorder } from './helpers/server.js';
import { loadConfig, multiConfig } from '../server/config.js';
import { maskIp } from '../server/ip-limits.js';
import { PROTOCOL_VERSION, MSG } from '../shared/net/protocol.js';

async function multiServer(extra = {}, mc = {}) {
  const { startServer } = await import('../server/index.js');
  const dataDir = extra.dataDir || tmpDataDir('mfp');
  const cfg = { ...loadConfig({}), mode: 'multi', multi: { ...multiConfig({}), ...mc }, port: 0, host: '127.0.0.1', dataDir,
    quiet: true, dev: true, awayGraceMs: 0, ...extra };
  const s = await startServer(cfg);
  const close = async () => {
    await s.close();
    if (!extra.keep) fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { ...s, close, dataDir, reg: s.hh.reg, base: `http://127.0.0.1:${s.port}` };
}

/** A socket to /ws?farm=<id> (extra handshake headers, e.g. X-Forwarded-For); resolves { ws, next, send, closed }. */
async function farmSocket(port, id, headers = {}) {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?farm=${id}`, { headers });
  const msgs = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    for (const x of m.t === 'b' ? m.list : [m]) {
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
    send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
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

async function post(base, url, { body, headers = {} } = {}) {
  const r = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const xff = (ip) => ({ 'x-forwarded-for': ip });
const answer = (m) => m.t === MSG.WELCOME || m.t === MSG.DENY || m.t === MSG.SLOTS;

/** hello + claim with a key from address `ip`: resolves { c, welcome }. */
async function sitDown(s, id, key, slot, name, ip, cid) {
  const c = await farmSocket(s.port, id, xff(ip));
  c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid, token: key });
  const first = await c.next(answer);
  assert.equal(first.t, MSG.SLOTS, JSON.stringify(first));
  c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid, token: key, claim: { slot, name } });
  const welcome = await c.next((m) => m.t === MSG.WELCOME || m.t === MSG.DENY);
  assert.equal(welcome.t, MSG.WELCOME, JSON.stringify(welcome));
  return { c, welcome };
}

test('privacy: maskIp keeps the network only (IPv4 /24 as x.y.z.0, IPv6 /48), never the full address', () => {
  assert.equal(maskIp('203.0.113.77'), '203.0.113.0');
  assert.equal(maskIp('::ffff:203.0.113.77'), '203.0.113.0');
  assert.equal(maskIp('2001:db8:abcd:12::5'), '2001:db8:abcd::/48');
  assert.equal(maskIp('2001:0db8:00ab:ffff:1:2:3:4'), '2001:db8:ab::/48');
  assert.equal(maskIp('2001:db8::'), '2001:db8:0::/48');
  assert.equal(maskIp('::1'), '0:0:0::/48');
  assert.equal(maskIp('fe80::1%eth0'), 'fe80:0:0::/48');
  assert.equal(maskIp('64:ff9b::192.0.2.33'), '64:ff9b:0::/48');
  for (const junk of ['', null, undefined, 'not an address', '999.1.1.1']) assert.equal(maskIp(junk), 'unknown', String(junk));
});

test('privacy: a multi run logs no full client address: info lines carry none, an abuse warning only the network', async () => {
  const rec = recorder();
  const s = await multiServer({ log: rec.log, quiet: false });
  const A = '203.0.113.77';
  const B = '2001:db8:abcd:12::5';
  const C = '198.51.100.23';
  const D = '192.0.2.200';
  try {
    const made = await post(s.base, '/api/farms', { headers: xff(A) });
    assert.equal(made.status, 201);
    const { id, secret } = made.body;
    const rowan = await sitDown(s, id, secret, 'p1', 'Rowan', A, 'pk0001');
    const inv = await post(s.base, `/api/f/${id}/invite`, { headers: { authorization: `Bearer ${secret}`, ...xff(A) } });
    assert.equal(inv.status, 201);
    const mia = await sitDown(s, id, inv.body.token, 'p2', 'Mia', B, 'pm0001');
    // a new key for Mia, used from a third address
    const rk = await post(s.base, `/api/f/${id}/rekey`, { body: { pid: 'p2' }, headers: { authorization: `Bearer ${secret}`, ...xff(A) } });
    assert.equal(rk.status, 201);
    await mia.c.closed;
    const back = await farmSocket(s.port, id, xff(C));
    back.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'pm0002', token: rk.body.token });
    assert.equal((await back.next(answer)).t, MSG.SLOTS);
    back.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'pm0002', token: rk.body.token, claim: { slot: 'p2', name: 'Mia' } });
    assert.equal((await back.next((m) => m.t === MSG.WELCOME || m.t === MSG.DENY)).t, MSG.WELCOME);
    // two abusive sockets (garbage frames until the router closes them): IPv4 and IPv6
    for (const ip of [D, B]) {
      const bad = await farmSocket(s.port, id, xff(ip));
      for (let i = 0; i < 320; i++) bad.send('{not json');
      await bad.closed;
    }
    const text = JSON.stringify(rec.lines);
    for (const ip of [A, B, C, D]) assert.ok(!text.includes(ip), `the full address ${ip} is in the log: ${text.slice(0, 600)}`);
    const sat = rec.lines.filter((l) => /creator sat down|invited farmer joined|came back with a new key/.test(String(l[1])));
    assert.equal(sat.length, 3, JSON.stringify(rec.lines.map((l) => l[1])));
    for (const l of sat) assert.ok(!JSON.stringify(l).includes('"ip"'), `an info line with an address field: ${JSON.stringify(l)}`);
    const abuse = rec.lines.filter((l) => /abusive/.test(String(l[1])));
    assert.equal(abuse.length, 2, JSON.stringify(rec.lines.map((l) => l[1])));
    assert.deepEqual(abuse.map((l) => l.find((x) => x && typeof x === 'object' && 'ip' in x)?.ip).sort(), ['192.0.2.0', '2001:db8:abcd::/48']);
    rowan.c.close();
    back.close();
  } finally { await s.close(); }
});

test('privacy: single mode keeps its own log lines as they were (the owner\'s box, the owner\'s logs)', async () => {
  const rec = recorder();
  const { startServer } = await import('../server/index.js');
  const dataDir = tmpDataDir('sgp');
  const s = await startServer({ ...loadConfig({}), port: 0, host: '127.0.0.1', dataDir, quiet: false, log: rec.log, awayGraceMs: 0 });
  try {
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    await new Promise((r) => ws.once('open', r));
    const got = new Promise((r) => ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.t === MSG.WELCOME || (m.t === 'b' && m.list.some((x) => x.t === MSG.WELCOME))) r(); }));
    ws.send(JSON.stringify({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'sg0001', claim: { slot: 'p1', name: 'Rowan' } }));
    await got;
    const claimed = rec.lines.find((l) => /slot claimed/.test(String(l[1])));
    assert.ok(claimed, JSON.stringify(rec.lines.map((l) => l[1])));
    assert.equal(claimed.find((x) => x && typeof x === 'object' && 'ip' in x)?.ip, '127.0.0.1');
    ws.close();
  } finally {
    await s.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('privacy: the star count is asked by the server, at most once an hour, keeps its last number, and is null without one', async () => {
  const { StarCount, STARS_URL } = await import('../server/stars.js');
  assert.equal(STARS_URL, 'https://api.github.com/repos/KrasimirKralev/harvest-hollow');
  let now = 1_800_000_000_000;
  const asked = [];
  let answer = { status: 200, body: { stargazers_count: 321 } };
  const fetcher = async (url, opts) => {
    asked.push({ url, opts });
    await new Promise((r) => setTimeout(r, 20));
    if (answer instanceof Error) throw answer;
    return { ok: answer.status === 200, status: answer.status, json: async () => answer.body };
  };
  const warns = [];
  const sc = new StarCount({ url: STARS_URL, fetcher, wall: () => now, log: { warn: (...a) => warns.push(a) } });
  // many visitors at once: one request to GitHub
  assert.deepEqual(await Promise.all([sc.get(), sc.get(), sc.get()]), [321, 321, 321]);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, STARS_URL);
  // nothing of a visitor rides along: only the server's own two headers
  assert.deepEqual(Object.keys(asked[0].opts.headers).sort(), ['accept', 'user-agent']);
  now += 59 * 60_000;
  answer = { status: 200, body: { stargazers_count: 400 } };
  assert.equal(await sc.get(), 321, 'within the hour: the cached number, GitHub not asked');
  assert.equal(asked.length, 1);
  now += 2 * 60_000;
  assert.equal(await sc.get(), 400, 'an hour on: asked again');
  assert.equal(asked.length, 2);
  // a failed refresh keeps the last good number, and is not retried within the hour
  now += 61 * 60_000;
  answer = { status: 403, body: { message: 'API rate limit exceeded' } };
  assert.equal(await sc.get(), 400);
  assert.equal(await sc.get(), 400);
  assert.equal(asked.length, 3);
  assert.equal(warns.length, 1);
  // never had a number: null (the page shows none); a thrown fetch too
  const fresh = new StarCount({ url: STARS_URL, fetcher, wall: () => now, log: null });
  assert.equal(await fresh.get(), null);
  answer = new Error('offline');
  now += 61 * 60_000;
  assert.equal(await fresh.get(), null);
  answer = { status: 200, body: { stargazers_count: -1 } };
  now += 61 * 60_000;
  assert.equal(await fresh.get(), null, 'a nonsense count is no count');
  // switched off: never asks
  const off = new StarCount({ url: null, fetcher: async () => { throw new Error('must not be called'); } });
  assert.equal(await off.get(), null);
});

test('privacy: GET /api/stars answers from the server\'s cache (multi mode only); HH_STARS_URL picks the source', async () => {
  assert.equal(multiConfig({}).starsUrl, 'https://api.github.com/repos/KrasimirKralev/harvest-hollow');
  assert.equal(multiConfig({ HH_STARS_URL: 'off' }).starsUrl, null);
  assert.equal(multiConfig({ HH_STARS_URL: 'http://127.0.0.1:4123/repo' }).starsUrl, 'http://127.0.0.1:4123/repo');
  assert.throws(() => multiConfig({ HH_STARS_URL: 'file:///etc/passwd' }), /HH_STARS_URL/);
  let calls = 0;
  const s = await multiServer({ stars: { fetcher: async () => { calls++; return { ok: true, status: 200, json: async () => ({ stargazers_count: 12 }) }; } } });
  try {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${s.base}/api/stars`, { headers: { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'Visitor/1.0' } });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { stars: 12 });
      assert.match(r.headers.get('cache-control'), /max-age=\d+/);
    }
    assert.equal(calls, 1);
  } finally { await s.close(); }
  const { testServer } = await import('./helpers/server.js');
  const single = await testServer();
  try {
    assert.equal((await fetch(`http://127.0.0.1:${single.port}/api/stars`)).status, 404, 'single mode has no star route');
  } finally { await single.close(); }
});

// ---- the ideas box and privacy requests: a year at most, delete on request ----------------------------------------
const ADMIN = 'privacy-admin-token-0123456789abcdefghij';
const DAY = 86_400_000;
const IDEA = { category: 'content', text: 'A duck pond with little ducklings, please!' };
const rows = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const adminCall = async (base, url, { method = 'GET', body, token = ADMIN, headers = {} } = {}) => {
  const r = await fetch(base + url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const pathOf = (dir, ...p) => [dir, ...p].join('/');

test('retention: the hourly sweep deletes ideas older than 365 days (and their status rows); younger ones stay, also after a restart', async () => {
  const t0 = Date.UTC(2026, 9, 5, 12);
  let now = t0;
  const dataDir = tmpDataDir('ideas-ttl');
  const opts = { ideas: { adminToken: ADMIN, wall: () => now }, dataDir, keep: true };
  let s = await multiServer(opts);
  try {
    const old = await post(s.base, '/api/ideas', { body: { ...IDEA, text: 'An old idea about a windmill.', contact: 'old@example.com' } });
    assert.equal(old.status, 201);
    assert.equal((await adminCall(s.base, `/api/admin/ideas/${old.body.id}`, { method: 'POST', body: { status: 'liked' } })).status, 200);
    now = t0 + 200 * DAY;
    const young = await post(s.base, '/api/ideas', { body: { ...IDEA, text: 'A younger idea about a duck pond.' } });
    assert.equal(young.status, 201);
    await s.reg.sweep(t0 + 365 * DAY - 3_600_000);
    assert.equal(rows(pathOf(dataDir, 'ideas', 'ideas.jsonl')).length, 2, 'not a day before its year is up');
    await s.reg.sweep(t0 + 366 * DAY);
    const left = rows(pathOf(dataDir, 'ideas', 'ideas.jsonl'));
    assert.deepEqual(left.map((r) => r.id), [young.body.id]);
    const disk = fs.readFileSync(pathOf(dataDir, 'ideas', 'ideas.jsonl'), 'utf8') + fs.readFileSync(pathOf(dataDir, 'ideas', 'status.jsonl'), 'utf8');
    assert.ok(!disk.includes(old.body.id) && !disk.includes('old@example.com') && !disk.includes('windmill'), 'gone for good, status rows too');
    assert.equal(fs.statSync(pathOf(dataDir, 'ideas', 'ideas.jsonl')).mode & 0o077, 0, 'still private to the server');
    now = t0 + 366 * DAY;
    const list = await adminCall(s.base, '/api/admin/ideas?status=all');
    assert.deepEqual(list.body.ideas.map((i) => i.id), [young.body.id]);
    await s.close();
    s = await multiServer(opts);
    assert.deepEqual((await adminCall(s.base, '/api/admin/ideas?status=all')).body.ideas.map((i) => i.id), [young.body.id], 'after a restart');
  } finally {
    await s.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('ideas: the admin deletes one idea for good (both files rewritten atomically, nothing else touched)', async () => {
  const s = await multiServer({ ideas: { adminToken: ADMIN } });
  try {
    const ids = [];
    for (const text of ['First idea: a duck pond.', 'Second idea: please forget me.', 'Third idea: an orchard.']) {
      ids.push((await post(s.base, '/api/ideas', { body: { ...IDEA, text, name: 'Ana', contact: text.startsWith('Second') ? 'forget@example.com' : null } })).body.id);
    }
    await adminCall(s.base, `/api/admin/ideas/${ids[1]}`, { method: 'POST', body: { status: 'planned', note: 'nice' } });
    await adminCall(s.base, `/api/admin/ideas/${ids[2]}`, { method: 'POST', body: { status: 'liked' } });
    assert.equal((await adminCall(s.base, `/api/admin/ideas/${ids[1]}`, { method: 'DELETE', token: null })).status, 401);
    assert.equal((await adminCall(s.base, `/api/admin/ideas/${ids[1]}`, { method: 'DELETE', token: 'wrong-token-wrong-token-wrong' })).status, 403);
    const del = await adminCall(s.base, `/api/admin/ideas/${ids[1]}`, { method: 'DELETE' });
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.deepEqual(del.body, { ok: true, id: ids[1] });
    const dir = pathOf(s.dataDir, 'ideas');
    assert.deepEqual(rows(pathOf(dir, 'ideas.jsonl')).map((r) => r.id), [ids[0], ids[2]]);
    assert.deepEqual(rows(pathOf(dir, 'status.jsonl')).map((r) => r.id), [ids[2]]);
    const disk = fs.readdirSync(dir).map((f) => fs.readFileSync(pathOf(dir, f), 'utf8')).join('\n');
    assert.ok(!disk.includes('forget me') && !disk.includes('forget@example.com') && !disk.includes(ids[1]));
    assert.deepEqual(fs.readdirSync(dir).sort(), ['ideas.jsonl', 'status.jsonl'], 'no temporary file left behind');
    assert.equal(fs.statSync(pathOf(dir, 'ideas.jsonl')).mode & 0o077, 0);
    assert.equal((await adminCall(s.base, `/api/admin/ideas/${ids[1]}`, { method: 'DELETE' })).status, 404);
    assert.equal((await adminCall(s.base, '/api/admin/ideas/zzzz', { method: 'DELETE' })).status, 404);
    const list = await adminCall(s.base, '/api/admin/ideas?status=all');
    assert.deepEqual(list.body.ideas.map((i) => i.id).sort(), [ids[0], ids[2]].sort());
    assert.equal(list.body.total, 2);
    // a new idea after the rewrite appends cleanly
    assert.equal((await post(s.base, '/api/ideas', { body: IDEA })).status, 201);
    assert.equal(rows(pathOf(dir, 'ideas.jsonl')).length, 3);
  } finally { await s.close(); }
});

test('privacy requests: their own 0600 file, plain fields only (no address, no browser), checked, limited, listed to the admin, kept a year', async () => {
  const t0 = Date.UTC(2026, 9, 5, 12);
  let now = t0;
  const s = await multiServer({ ideas: { adminToken: ADMIN, wall: () => now } }, { trustProxy: 1 });
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  try {
    const good = { kind: 'farm', text: 'I lost my phone. Please delete the farm at /f/abcdefghijkl.', contact: 'me@example.com', lang: 'bg' };
    const r = await post(s.base, '/api/privacy', { body: good, headers: { 'user-agent': UA, ...xff('203.0.113.50') } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.id, /^[0-9a-f]{16}$/);
    const file = pathOf(s.dataDir, 'privacy', 'requests.jsonl');
    const [row] = rows(file);
    assert.deepEqual(Object.keys(row).sort(), ['at', 'contact', 'id', 'kind', 'lang', 'text']);
    assert.equal(row.kind, 'farm');
    assert.equal(row.contact, 'me@example.com');
    assert.equal(fs.statSync(file).mode & 0o077, 0);
    assert.equal(fs.statSync(pathOf(s.dataDir, 'privacy')).mode & 0o077, 0);
    const disk = fs.readFileSync(file, 'utf8');
    assert.ok(!disk.includes('203.0.113') && !disk.includes('AppleWebKit') && !disk.includes('Safari'), disk);
    // checked like ideas
    for (const [body, field] of [[{ ...good, kind: 'everything' }, 'kind'], [{ ...good, text: 'short' }, 'text'],
      [{ ...good, text: 'x'.repeat(2001) }, 'text'], [{ ...good, contact: 'c'.repeat(121) }, 'contact'], [{ ...good, farm: 'abc' }, 'farm']]) {
      const bad = await post(s.base, '/api/privacy', { body, headers: xff('203.0.113.51') });
      assert.equal(bad.status, 400, JSON.stringify(body));
      assert.equal(bad.body.field, field);
    }
    assert.equal((await post(s.base, '/api/privacy', { body: good, headers: { origin: 'https://evil.example', ...xff('203.0.113.52') } })).status, 403);
    // the honeypot: thanked, never stored
    assert.equal((await post(s.base, '/api/privacy', { body: { ...good, website: 'spam' }, headers: xff('203.0.113.53') })).status, 201);
    assert.equal(rows(file).length, 1);
    // 5 an hour per address, like ideas; another address is not affected
    for (let i = 0; i < 4; i++) assert.equal((await post(s.base, '/api/privacy', { body: { kind: 'other', text: `Question number ${i}, please.` }, headers: xff('203.0.113.50') })).status, 201);
    const limited = await post(s.base, '/api/privacy', { body: { kind: 'copy', text: 'One more question here.' }, headers: xff('203.0.113.50') });
    assert.equal(limited.status, 429);
    assert.equal((await post(s.base, '/api/privacy', { body: { kind: 'idea', text: 'Please delete my duck idea.' }, headers: xff('198.51.100.7') })).status, 201);
    // the admin list: token only, newest first, open ones by default; done takes one out
    assert.equal((await adminCall(s.base, '/api/admin/privacy', { token: null })).status, 401);
    const list = await adminCall(s.base, '/api/admin/privacy');
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 6);
    assert.deepEqual(list.body.counts, { new: 6, done: 0 });
    const first = list.body.requests.find((x) => x.id === r.body.id);
    assert.deepEqual({ kind: first.kind, contact: first.contact, status: first.status }, { kind: 'farm', contact: 'me@example.com', status: 'new' });
    const done = await adminCall(s.base, `/api/admin/privacy/${r.body.id}`, { method: 'POST', body: { status: 'done', note: 'farm deleted' } });
    assert.equal(done.status, 200);
    assert.equal(done.body.request.status, 'done');
    assert.ok(!(await adminCall(s.base, '/api/admin/privacy')).body.requests.some((x) => x.id === r.body.id));
    assert.equal((await adminCall(s.base, '/api/admin/privacy?status=all')).body.requests.length, 6);
    // kept 12 months for the record, then deleted by the sweep
    await s.reg.sweep(t0 + 364 * DAY);
    assert.equal(rows(file).length, 6);
    await s.reg.sweep(t0 + 366 * DAY);
    assert.equal(rows(file).length, 0);
    assert.ok(!fs.readFileSync(pathOf(s.dataDir, 'privacy', 'status.jsonl'), 'utf8').includes(r.body.id));
  } finally { await s.close(); }
});

// ---- "Delete this farm now" (Settings > Farm): any farmer of the farm, at once, both farmers' screens told ---------
test('delete a farm: any member deletes it at once (folder and backups), every open screen hears DELETED, nothing secret logged', async () => {
  const rec = recorder();
  const s = await multiServer({ log: rec.log, quiet: false });
  const pathJoin = (...p) => p.join('/');
  try {
    const made = (await post(s.base, '/api/farms')).body;
    const rowan = await sitDown(s, made.id, made.secret, 'p1', 'Rowan', '203.0.113.1', 'dk0001');
    const inv = (await post(s.base, `/api/f/${made.id}/invite`, { headers: { authorization: `Bearer ${made.secret}` } })).body;
    const mia = await sitDown(s, made.id, inv.token, 'p2', 'Mia', '203.0.113.2', 'dm0001');
    const miaSecret = mia.welcome.token;
    const other = (await post(s.base, '/api/farms')).body;
    const dir = pathJoin(s.dataDir, 'farms', made.id);
    await post(s.base, `/api/f/${made.id}/dev/save`);
    assert.ok(fs.existsSync(pathJoin(dir, 'farm.json')) && fs.existsSync(pathJoin(dir, 'backups')));
    // only a member's key deletes: none 401, a stranger's or a used invite 403, an unknown farm 404
    const del = (id, key) => post(s.base, `/api/f/${id}/delete`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
    assert.equal((await del(made.id, null)).status, 401);
    assert.equal((await del(made.id, other.secret)).status, 403);
    assert.equal((await del(made.id, inv.token)).status, 403);
    assert.equal((await del('zzzzzzzzzzzz', miaSecret)).status, 404);
    assert.equal((await post(s.base, `/api/f/${made.id}/delete`, { headers: { authorization: `Bearer ${miaSecret}`, origin: 'https://evil.example' } })).status, 403);
    assert.ok(fs.existsSync(dir), 'nothing deleted by a refused request');
    // Mia (the invited farmer, not the creator) deletes it
    const r = await del(made.id, miaSecret);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { ok: true });
    for (const c of [rowan.c, mia.c]) {
      const deny = await c.next((m) => m.t === MSG.DENY);
      assert.equal(deny.code, 'DELETED');
      assert.equal(await c.closed, 4403, 'the socket stops: no reconnect loop');
    }
    assert.equal(fs.existsSync(dir), false, 'the folder with its snapshot, journal and backups is gone');
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(fs.existsSync(dir), false, 'and stays gone (no late write recreates it)');
    assert.equal(s.reg.has(made.id), false);
    assert.equal((await fetch(`${s.base}/api/f/${made.id}/status`)).status, 404);
    await assert.rejects(farmSocket(s.port, made.id), (e) => e.status === 404);
    assert.equal((await del(made.id, miaSecret)).status, 404, 'deleted once');
    assert.ok(s.reg.has(other.id) && fs.existsSync(pathJoin(s.dataDir, 'farms', other.id)), 'another farm is untouched');
    const line = rec.lines.find((l) => /deleted by one of its farmers/.test(String(l[1])));
    assert.ok(line, JSON.stringify(rec.lines.map((l) => l[1])));
    assert.equal(line.find((x) => x && typeof x === 'object' && 'pid' in x)?.pid, 'p2');
    const text = JSON.stringify(rec.lines);
    for (const secret of [made.id, made.secret, miaSecret, inv.token, other.id]) assert.ok(!text.includes(secret), 'no id or key in the log');
  } finally { await s.close(); }
});

test('delete a farm: rate-limited per address; a farm whose farmers are all away is deleted too', async () => {
  const s = await multiServer({}, { deletePerHour: 1 });
  try {
    const a = (await post(s.base, '/api/farms')).body;
    const b = (await post(s.base, '/api/farms')).body;
    const ka = await sitDown(s, a.id, a.secret, 'p1', 'Ana', '203.0.113.3', 'da0001');
    const kb = await sitDown(s, b.id, b.secret, 'p1', 'Ben', '203.0.113.4', 'db0001');
    ka.c.close();
    await ka.c.closed;
    await post(s.base, `/api/f/${a.id}/dev/unload`);
    const first = await post(s.base, `/api/f/${a.id}/delete`, { headers: { authorization: `Bearer ${a.secret}` } });
    assert.equal(first.status, 200, 'a sleeping farm (nobody connected, unloaded) is deleted too');
    assert.equal(fs.existsSync([s.dataDir, 'farms', a.id].join('/')), false);
    const second = await post(s.base, `/api/f/${b.id}/delete`, { headers: { authorization: `Bearer ${b.secret}` } });
    assert.equal(second.status, 429);
    assert.equal(second.body.error, 'RATE');
    assert.ok(s.reg.has(b.id), 'a refused delete deletes nothing');
    kb.c.close();
  } finally { await s.close(); }
});

test('delete a farm on a privacy request: the admin (Bearer HH_ADMIN_TOKEN) deletes it whole; its open screens hear DELETED', async () => {
  const rec = recorder();
  const s = await multiServer({ log: rec.log, quiet: false, ideas: { adminToken: ADMIN } });
  try {
    const made = (await post(s.base, '/api/farms')).body;
    const rowan = await sitDown(s, made.id, made.secret, 'p1', 'Rowan', '203.0.113.5', 'dr0001');
    assert.equal((await adminCall(s.base, `/api/admin/farms/${made.id}`, { method: 'DELETE', token: null })).status, 401);
    assert.equal((await adminCall(s.base, `/api/admin/farms/${made.id}`, { method: 'DELETE', token: made.secret })).status, 403, 'a farmer key is no admin token');
    assert.equal((await adminCall(s.base, '/api/admin/farms/zzzzzzzzzzzz', { method: 'DELETE' })).status, 404);
    assert.equal((await adminCall(s.base, '/api/admin/farms/..%2F..', { method: 'DELETE' })).status, 404);
    const r = await adminCall(s.base, `/api/admin/farms/${made.id}`, { method: 'DELETE' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await rowan.c.next((m) => m.t === MSG.DENY)).code, 'DELETED');
    assert.equal(fs.existsSync([s.dataDir, 'farms', made.id].join('/')), false);
    assert.equal((await adminCall(s.base, `/api/admin/farms/${made.id}`, { method: 'DELETE' })).status, 404);
    assert.ok(rec.lines.some((l) => /deleted on a privacy request/.test(String(l[1]))));
    assert.ok(!JSON.stringify(rec.lines).includes(made.id));
  } finally { await s.close(); }
});
