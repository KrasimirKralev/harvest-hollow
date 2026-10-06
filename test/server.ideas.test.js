// Ideas from players (owner request 2026-10-05: "people can give ideas for implementations, so we can gather them,
// review later and maybe merge them"), multi mode only: POST /api/ideas (validation, honeypot, plain text, per-address
// and global limits, nothing IP-derived on disk), the admin list and the append-only status log (Bearer HH_ADMIN_TOKEN,
// 404 when it is unset), and that the file survives a restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDataDir } from './helpers/server.js';
import { loadConfig, multiConfig } from '../server/config.js';
import { cleanText, uaFamily, CATEGORIES, STATUSES, IDEA_LIMITS } from '../server/ideas.js';

const TOKEN = 'test-admin-token-0123456789abcdef0123456789';
const HOUR = 3_600_000;

async function host({ ideas = {}, mc = {}, dataDir, mode = 'multi' } = {}) {
  const { startServer } = await import('../server/index.js');
  const dir = dataDir || tmpDataDir('ideas');
  const cfg = { ...loadConfig({}), mode, multi: mode === 'multi' ? { ...multiConfig({}), ...mc } : null, port: 0, host: '127.0.0.1',
    dataDir: dir, quiet: true, dev: false, awayGraceMs: 0, ideas: { adminToken: null, ...ideas } };
  const s = await startServer(cfg);
  const base = `http://127.0.0.1:${s.port}`;
  // a caller that passed its own dataDir removes it itself (it restarts the host on the same volume)
  const close = async () => { await s.close(); if (!dataDir) fs.rmSync(dir, { recursive: true, force: true }); };
  return { ...s, base, dataDir: dir, close };
}

async function call(base, url, { method = 'GET', body, headers = {}, raw } = {}) {
  const r = await fetch(base + url, { method, headers: { ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, headers: r.headers, body: json, text };
}
const send = (base, body, headers = {}) => call(base, '/api/ideas', { method: 'POST', body, headers });
const admin = (base, url, opts = {}) => call(base, url, { ...opts, headers: { authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) } });
const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const ideasFile = (dir) => path.join(dir, 'ideas', 'ideas.jsonl');
const statusFile = (dir) => path.join(dir, 'ideas', 'status.jsonl');
const GOOD = { category: 'content', text: 'A duck pond with little ducklings, please!' };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

test('ideas: a valid idea is appended with id, time, category, text, name, contact, language and the browser family only', async () => {
  const s = await host();
  try {
    const r = await send(s.base, { ...GOOD, name: '  Ana  ', contact: 'ana@example.com', lang: 'bg' }, { 'user-agent': IPHONE });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.ok, true);
    assert.match(r.body.id, /^[0-9a-f]{16}$/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const rows = lines(ideasFile(s.dataDir));
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.deepEqual(Object.keys(row).sort(), ['at', 'category', 'contact', 'farm', 'id', 'lang', 'name', 'text', 'ua'].sort());
    assert.equal(row.id, r.body.id);
    assert.equal(row.category, 'content');
    assert.equal(row.text, GOOD.text);
    assert.equal(row.name, 'Ana');
    assert.equal(row.contact, 'ana@example.com');
    assert.equal(row.lang, 'bg');
    assert.equal(row.farm, null);
    assert.equal(row.ua, 'Safari on iOS');
    assert.ok(Number.isSafeInteger(row.at) && Math.abs(row.at - Date.now()) < 60_000);
    // nothing that identifies the sender's address or device
    const disk = fs.readFileSync(ideasFile(s.dataDir), 'utf8');
    assert.ok(!disk.includes('127.0.0.1') && !disk.includes('::1') && !disk.includes('17_5') && !disk.includes('AppleWebKit'), disk);
    // the ideas live under the data dir (the volume), private to the server's user
    assert.equal(fs.statSync(ideasFile(s.dataDir)).mode & 0o077, 0);
  } finally { await s.close(); }
});

test('ideas: validation refuses wrong types, lengths, categories, unknown fields and bodies that are not objects', async () => {
  const s = await host();
  try {
    const bad = [
      [{ text: GOOD.text }, 'category'],
      [{ ...GOOD, category: 'cheese' }, 'category'],
      [{ ...GOOD, category: ['content'] }, 'category'],
      [{ category: 'feature' }, 'text'],
      [{ ...GOOD, text: 'too short' }, 'text'],                     // 9 characters
      [{ ...GOOD, text: '     abc       \n\n\n  ' }, 'text'],         // spaces do not count
      [{ ...GOOD, text: 'x'.repeat(IDEA_LIMITS.textMax + 1) }, 'text'],
      [{ ...GOOD, text: 1234567890123 }, 'text'],
      [{ ...GOOD, name: { first: 'Ana' } }, 'name'],
      [{ ...GOOD, name: 'n'.repeat(IDEA_LIMITS.nameMax + 1) }, 'name'],
      [{ ...GOOD, contact: 'c'.repeat(IDEA_LIMITS.contactMax + 1) }, 'contact'],
      [{ ...GOOD, contact: 42 }, 'contact'],
      [{ ...GOOD, farm: 12 }, 'farm'],
      [{ ...GOOD, farm: '../../etc/passwd' }, 'farm'],
      [{ ...GOOD, lang: 7 }, 'lang'],
      [{ ...GOOD, website: 5 }, 'website'],
      [{ ...GOOD, admin: true }, 'admin'],
    ];
    for (const [body, field] of bad) {
      const r = await send(s.base, body);
      assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 80)} -> ${r.status}`);
      assert.equal(r.body.error, 'BAD_ARGS');
      assert.equal(r.body.field, field, JSON.stringify(body).slice(0, 80));
    }
    for (const raw of ['[1,2]', '"text"', 'null', '{"category":"content",', '']) {
      const r = await call(s.base, '/api/ideas', { method: 'POST', raw });
      assert.equal(r.status, 400, `${raw} -> ${r.status}`);
    }
    // exactly at the limits is fine
    assert.equal((await send(s.base, { ...GOOD, text: '0123456789' })).status, 201);
    assert.equal((await send(s.base, { category: 'other', text: 'y'.repeat(IDEA_LIMITS.textMax), name: 'n'.repeat(IDEA_LIMITS.nameMax),
      contact: 'c'.repeat(IDEA_LIMITS.contactMax) })).status, 201);
    assert.equal(lines(ideasFile(s.dataDir)).length, 2);
    // a body over 4 KB is refused before it is parsed
    assert.equal((await send(s.base, { ...GOOD, text: 'z'.repeat(5000) })).status >= 400, true);
    // another site's page cannot post here
    assert.equal((await send(s.base, GOOD, { origin: 'https://evil.example' })).status, 403);
  } finally { await s.close(); }
});

test('ideas: plain text only: control characters, direction overrides and terminal escapes are dropped, markup is kept as text', () => {
  assert.equal(cleanText('Hello\u0000 \u001b[31mred\u001b[0m world', { multiline: true }), 'Hello [31mred[0m world');
  assert.equal(cleanText('a\r\nb\rc\u2028d', { multiline: true }), 'a\nb\nc\nd');
  assert.equal(cleanText('one\n\n\n\n\ntwo', { multiline: true }), 'one\n\ntwo');
  assert.equal(cleanText('evil\u202Egnp.exe', { multiline: false }), 'evilgnp.exe');
  assert.equal(cleanText('  two\nlines\tand tab  ', { multiline: false }), 'two lines and tab');
  assert.equal(cleanText('<img src=x onerror=alert(1)> & "q"', { multiline: true }), '<img src=x onerror=alert(1)> & "q"');
  assert.equal(cleanText('family 👩\u200D👩\u200D👧 emoji', { multiline: false }), 'family 👩\u200D👩\u200D👧 emoji');   // the joiner stays
  assert.deepEqual(CATEGORIES, ['content', 'feature', 'bug', 'other']);
  assert.deepEqual(STATUSES, ['new', 'liked', 'planned', 'done', 'declined']);
  assert.equal(uaFamily(IPHONE), 'Safari on iOS');
  assert.equal(uaFamily('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'), 'Chrome on Android');
  assert.equal(uaFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'), 'Firefox on Windows');
  assert.equal(uaFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0'), 'Edge on macOS');
  assert.equal(uaFamily('curl/8.5.0'), 'Other');
  assert.equal(uaFamily(''), null);
});

test('ideas: the honeypot field answers like a success and stores nothing', async () => {
  const s = await host();
  try {
    const r = await send(s.base, { ...GOOD, website: 'http://spam.example' });
    assert.equal(r.status, 201);
    assert.match(r.body.id, /^[0-9a-f]{16}$/);
    assert.equal(lines(ideasFile(s.dataDir)).length, 0);
    // an empty honeypot is a person
    assert.equal((await send(s.base, { ...GOOD, website: '' })).status, 201);
    assert.equal(lines(ideasFile(s.dataDir)).length, 1);
  } finally { await s.close(); }
});

test('ideas: 5 an hour and 20 a day per address (salted, in memory), other addresses unaffected', async () => {
  let now = Date.now();
  const s = await host({ ideas: { wall: () => now }, mc: { trustProxy: 1 } });
  try {
    const from = (ip) => ({ 'x-forwarded-for': ip });
    for (let i = 0; i < 5; i++) assert.equal((await send(s.base, GOOD, from('203.0.113.7'))).status, 201, `idea ${i + 1}`);
    const sixth = await send(s.base, GOOD, from('203.0.113.7'));
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body.error, 'RATE');
    assert.ok(Number(sixth.headers.get('retry-after')) > 0 && sixth.body.retryAfter > 0);
    assert.equal((await send(s.base, GOOD, from('198.51.100.20'))).status, 201, 'another address');
    // the honeypot counts too: a bot cannot hammer the endpoint for free
    assert.equal((await send(s.base, { ...GOOD, website: 'x' }, from('203.0.113.7'))).status, 429);
    // 20 a day: three more hours of five
    for (let h = 1; h <= 3; h++) {
      now += HOUR + 1000;
      for (let i = 0; i < 5; i++) assert.equal((await send(s.base, GOOD, from('203.0.113.7'))).status, 201, `hour ${h} idea ${i + 1}`);
    }
    now += HOUR + 1000;
    const day = await send(s.base, GOOD, from('203.0.113.7'));
    assert.equal(day.status, 429, 'the 21st idea of the day');
    assert.ok(day.body.retryAfter > HOUR / 1000, `retry after ${day.body.retryAfter}s`);
    now += 24 * HOUR;
    assert.equal((await send(s.base, GOOD, from('203.0.113.7'))).status, 201, 'a day later');
    const disk = fs.readFileSync(ideasFile(s.dataDir), 'utf8');
    assert.ok(!disk.includes('203.0.113.7') && !disk.includes('198.51.100.20'), 'no address on disk');
  } finally { await s.close(); }
});

test('ideas: a global daily cap, rebuilt from the file after a restart', async () => {
  const dataDir = tmpDataDir('ideas-cap');
  const s = await host({ dataDir, ideas: { perDay: 3 }, mc: { trustProxy: 1 } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await send(s.base, GOOD, { 'x-forwarded-for': `192.0.2.${i + 1}` })).status, 201);
    const full = await send(s.base, GOOD, { 'x-forwarded-for': '192.0.2.99' });
    assert.equal(full.status, 503);
    assert.equal(full.body.error, 'FULL');
  } finally { await s.close(); }
  const s2 = await host({ dataDir, ideas: { perDay: 3 }, mc: { trustProxy: 1 } });
  try {
    assert.equal((await send(s2.base, GOOD, { 'x-forwarded-for': '192.0.2.100' })).status, 503, 'the cap survives a restart');
    assert.equal(lines(ideasFile(dataDir)).length, 3);
  } finally { await s2.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('ideas: the farm id is kept when it names a farm here, dropped when it does not', async () => {
  const s = await host();
  try {
    const farm = await call(s.base, '/api/farms', { method: 'POST', body: {} });
    assert.equal(farm.status, 201);
    assert.equal((await send(s.base, { ...GOOD, farm: farm.body.id })).status, 201);
    assert.equal((await send(s.base, { ...GOOD, farm: 'zzzzzzzzzzzz' })).status, 201);
    const rows = lines(ideasFile(s.dataDir));
    assert.equal(rows[0].farm, farm.body.id);
    assert.equal(rows[1].farm, null);
  } finally { await s.close(); }
});

test('ideas: admin routes 404 without HH_ADMIN_TOKEN (and with a token too short to trust)', async () => {
  for (const adminToken of [null, '', 'short-token']) {
    const s = await host({ ideas: { adminToken } });
    try {
      assert.equal((await call(s.base, '/api/admin/ideas')).status, 404, `token ${adminToken}`);
      assert.equal((await call(s.base, '/api/admin/ideas', { headers: { authorization: `Bearer ${adminToken}` } })).status, 404);
      assert.equal((await call(s.base, '/api/admin/ideas/0123456789abcdef', { method: 'POST', body: { status: 'liked' } })).status, 404);
    } finally { await s.close(); }
  }
});

test('ideas: admin auth: 401 without a bearer, 403 with a wrong one, failures rate-limited', async () => {
  const s = await host({ ideas: { adminToken: TOKEN } });
  try {
    const none = await call(s.base, '/api/admin/ideas');
    assert.equal(none.status, 401);
    assert.match(none.headers.get('www-authenticate') || '', /^Bearer/);
    assert.equal((await call(s.base, '/api/admin/ideas', { headers: { authorization: TOKEN } })).status, 401, 'no Bearer scheme');
    assert.equal((await call(s.base, '/api/admin/ideas', { headers: { authorization: `Bearer ${TOKEN}x` } })).status, 403);
    assert.equal((await call(s.base, '/api/admin/ideas', { headers: { authorization: `Bearer ${TOKEN.slice(0, -1)}` } })).status, 403);
    assert.equal((await call(s.base, '/api/admin/ideas/0123456789abcdef', { method: 'POST', body: { status: 'liked' },
      headers: { authorization: 'Bearer nope-nope-nope-nope-nope' } })).status, 403);
    assert.equal((await admin(s.base, '/api/admin/ideas')).status, 200);
    // ten wrong tokens from one address: the eleventh try waits, even with the right token
    for (let i = 0; i < 6; i++) await call(s.base, '/api/admin/ideas', { headers: { authorization: `Bearer wrong-${i}-xxxxxxxxxxxxxxxxxxxx` } });
    const limited = await admin(s.base, '/api/admin/ideas');
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  } finally { await s.close(); }
});

test('ideas: the admin list (new | all), JSON only, never interpreted, and the status log', async () => {
  const dataDir = tmpDataDir('ideas-admin');
  const s = await host({ dataDir, ideas: { adminToken: TOKEN } });
  const evil = '<img src=x onerror=alert(1)><script>alert("hi")</script> a sneaky idea';
  let ids;
  try {
    ids = [];
    for (const body of [GOOD, { category: 'bug', text: evil, name: '<b>Bob</b>' }, { category: 'feature', text: 'Fishing contests on Sundays' }]) {
      ids.push((await send(s.base, body)).body.id);
    }
    const list = await admin(s.base, '/api/admin/ideas');
    assert.equal(list.status, 200);
    assert.match(list.headers.get('content-type'), /^application\/json/);
    assert.equal(list.headers.get('x-content-type-options'), 'nosniff');
    assert.match(list.headers.get('content-security-policy') || '', /default-src 'none'/);
    assert.equal(list.headers.get('cache-control'), 'no-store');
    assert.deepEqual(list.body.ideas.map((i) => i.id), [...ids].reverse(), 'newest first');
    const bad = list.body.ideas.find((i) => i.id === ids[1]);
    assert.equal(bad.text, evil, 'the text comes back exactly as plain text');
    assert.equal(bad.name, '<b>Bob</b>');
    assert.equal(bad.status, 'new');
    assert.ok(!list.text.includes('<script>'), 'the raw JSON escapes < (no HTML even if someone opens it in a browser)');
    assert.deepEqual(list.body.counts, { new: 3, liked: 0, planned: 0, done: 0, declined: 0 });

    const set = await admin(s.base, `/api/admin/ideas/${ids[0]}`, { method: 'POST', body: { status: 'liked', note: 'Ducks! Yes.' } });
    assert.equal(set.status, 200, set.text);
    assert.equal(set.body.idea.status, 'liked');
    assert.equal(set.body.idea.note, 'Ducks! Yes.');
    assert.equal((await admin(s.base, `/api/admin/ideas/${ids[0]}`, { method: 'POST', body: { status: 'planned' } })).status, 200);
    const fresh = await admin(s.base, '/api/admin/ideas?status=new');
    assert.deepEqual(fresh.body.ideas.map((i) => i.id), [ids[2], ids[1]]);
    const all = await admin(s.base, '/api/admin/ideas?status=all');
    const duck = all.body.ideas.find((i) => i.id === ids[0]);
    assert.equal(duck.status, 'planned');
    assert.equal(duck.note, null, 'the latest status row wins, its note with it');
    assert.equal(all.body.counts.planned, 1);
    assert.equal((await admin(s.base, '/api/admin/ideas?status=planned')).body.ideas.length, 1);

    // refusals
    assert.equal((await admin(s.base, '/api/admin/ideas?status=maybe')).status, 400);
    assert.equal((await admin(s.base, `/api/admin/ideas/${ids[0]}`, { method: 'POST', body: { status: 'maybe' } })).status, 400);
    assert.equal((await admin(s.base, `/api/admin/ideas/${ids[0]}`, { method: 'POST', body: { status: 'done', note: 7 } })).status, 400);
    assert.equal((await admin(s.base, `/api/admin/ideas/${ids[0]}`, { method: 'POST', body: { status: 'done', extra: 1 } })).status, 400);
    assert.equal((await admin(s.base, '/api/admin/ideas/0123456789abcdef', { method: 'POST', body: { status: 'done' } })).status, 404);
    assert.equal((await admin(s.base, '/api/admin/ideas/..%2F..%2Fx', { method: 'POST', body: { status: 'done' } })).status, 404);

    // append-only: the ideas file never changes, the status log has both rows
    assert.equal(lines(ideasFile(dataDir)).length, 3);
    const log = lines(statusFile(dataDir));
    assert.deepEqual(log.map((r) => [r.id, r.status, r.note]), [[ids[0], 'liked', 'Ducks! Yes.'], [ids[0], 'planned', null]]);
    assert.ok(log.every((r) => Number.isSafeInteger(r.at)));
  } finally { await s.close(); }
  // after a restart: the same list
  const s2 = await host({ dataDir, ideas: { adminToken: TOKEN } });
  try {
    const all = await admin(s2.base, '/api/admin/ideas?status=all');
    assert.equal(all.body.ideas.length, 3);
    assert.equal(all.body.ideas.find((i) => i.id === ids[0]).status, 'planned');
    // a torn last line (a crash mid-append) is skipped, not fatal
    fs.appendFileSync(ideasFile(dataDir), '{"id":"deadbeefdeadbeef","at":1,"cat');
  } finally { await s2.close(); }
  const s3 = await host({ dataDir, ideas: { adminToken: TOKEN } });
  try {
    assert.equal((await admin(s3.base, '/api/admin/ideas?status=all')).body.ideas.length, 3);
    assert.equal((await send(s3.base, GOOD)).status, 201, 'appending after a torn line still works');
    assert.equal((await admin(s3.base, '/api/admin/ideas?status=all')).body.ideas.length, 4);
  } finally { await s3.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('ideas: single mode has no ideas routes (the in-game entry opens GitHub instead)', async () => {
  const s = await host({ mode: 'single', ideas: { adminToken: TOKEN } });
  try {
    assert.equal((await send(s.base, GOOD)).status, 404);
    assert.equal((await admin(s.base, '/api/admin/ideas')).status, 404);
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'ideas')));
  } finally { await s.close(); }
});
