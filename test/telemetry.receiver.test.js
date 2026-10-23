// The receiving end (server/telemetry/receiver.js, store.js): a strict shape, every string scrubbed again, stored once
// per event id in a 0600 file, rate limits per address / install / day, 413 above 64 KB, the admin list and deletions
// behind HH_ADMIN_TOKEN, 365-day retention, and the official host's local delivery (no HTTP to itself). The owners'
// CLI end (sender -> HTTP -> receiver -> tools/ideas.mjs) is in telemetry.cli.test.js: the CLI is private, and an
// import of it here would fail this whole file in the public export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { appServer, quiet, tmpDataDir, fakeClock, T0, telemetryFor, sampleJob, SAMPLE_FILES } from './helpers/telemetry.js';
import { mountTelemetryReceiver } from '../server/telemetry/receiver.js';
import { buildPayload, checkPayload, scrub, newEventId } from '../server/telemetry/payload.js';
import { TELEMETRY_KEEP_MS, RECEIVE_LIMITS, MAX_PAYLOAD_BYTES } from '../server/telemetry/config.js';

const TOKEN = 'telemetry-admin-token-abcdefghijklmnop';
const DAY = 86_400_000;
const mode = (f) => fs.statSync(f).mode & 0o777;
const GAME = { version: '0.1.0', contentHash: 'a1b2c3d4', rules: 13, mode: 'single' };
const payload = (over = {}, input = {}) => ({ ...buildPayload({ event: 'job.applied', job: sampleJob({ state: 'applied' }), files: SAMPLE_FILES, ...input },
  { install: 'c'.repeat(32), game: GAME, now: T0 }), ...over });

async function receiver(name, opts = {}) {
  const dir = tmpDataDir(name);
  const clock = opts.clock ?? fakeClock(T0);
  let rx;
  const s = await appServer((app) => {
    rx = mountTelemetryReceiver(app, { dataDir: dir, log: quiet, wall: () => clock.now(), adminToken: TOKEN, trustProxy: 1, sweepers: [], ...opts });
  });
  const post = (body, headers = {}) => fetch(`${s.base}/api/telemetry`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const admin = (url, init = {}) => fetch(`${s.base}/api/admin/telemetry${url}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) } });
  return { dir, clock, rx, s, post, admin, async close() { await s.close(); await rx.stop(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('telemetry payload: the builder\'s output is exactly what the receiver accepts; anything else is refused by name', () => {
  const p = payload();
  const c = checkPayload(JSON.parse(JSON.stringify(p)));
  assert.equal(c.ok, true);
  assert.deepEqual(c.payload, JSON.parse(JSON.stringify(p)));
  const cases = [
    [{ ...p, farm: 'abcdefgh2345' }, 'farm'], [{ ...p, pid: 'p1' }, 'pid'], [{ ...p, token: 'x' }, 'token'], [{ ...p, v: 2 }, 'v'],
    [{ ...p, id: 'short' }, 'id'], [{ ...p, install: 'X'.repeat(32) }, 'install'], [{ ...p, event: 'job.secret' }, 'event'],
    [{ ...p, at: -1 }, 'at'], [{ ...p, game: { ...p.game, host: 'x' } }, 'game'], [{ ...p, lang: 'de' }, 'lang'],
    [{ ...p, provider: 'gemini' }, 'provider'], [{ ...p, model: 'a b' }, 'model'], [{ ...p, prompts: ['x'.repeat(1001)] }, 'prompts'],
    [{ ...p, prompts: Array(21).fill('x') }, 'prompts'], [{ ...p, mod: { ...p.mod, files: { '../x.json': {} } } }, 'mod'],
    [{ ...p, mod: { ...p.mod, files: { 'private/mcp.json': {} } } }, 'mod'], [{ ...p, mod: { ...p.mod, account: 'k' } }, 'mod'],
    [{ ...p, diff: { ...p.diff, added: ['../etc'] } }, 'diff'], [{ ...p, validation: { ...p.validation, message: 'x' } }, 'validation'],
    [{ ...p, validation: { ...p.validation, codes: ['lower'] } }, 'validation'], [{ ...p, outcome: { state: 'stolen', afterMs: 1 } }, 'outcome'],
    [[p], 'body'], [null, 'body'],
  ];
  for (const [body, field] of cases) assert.deepEqual(checkPayload(body), { ok: false, field }, JSON.stringify(body).slice(0, 80));
  // strings are scrubbed again at the door (an older or foreign sender), credential-looking keys in mod files dropped
  const dirty = { ...p, prompts: ['my key sk-proj-AbCdEfGhIjKlMnOpQrSt and k@x.org'],
    mod: { format: 1, files: { 'mod.json': { format: 1, title: { en: 'Bearer abcdefghijkl', bg: 'Луна' }, secret: 'x', refresh: 'y' } } } };
  const cleaned = checkPayload(dirty);
  assert.equal(cleaned.ok, true);
  assert.deepEqual(cleaned.payload.prompts, ['my key [redacted] and [email]']);
  assert.deepEqual(cleaned.payload.mod.files['mod.json'], { format: 1, title: { bg: 'Луна', en: 'Bearer [redacted]' } });
  // the scrub leaves a game's own words, ids and colours alone
  for (const fine of ['Add a moon melon that glows at 10:30', 'x_moon_melon_2026_super_long_id', '#BFE3FF', 'Лунен пъпеш „Луна“ – сладък',
    'Make wheat grow 20% faster', 'version 1.2.3']) assert.equal(scrub(fine), fine);
});

test('telemetry payload: it fits in 64 KB (the mod\'s files go first, then the oldest prompts)', () => {
  const big = {};
  for (let i = 0; i < 40; i++) big[`content/decor/x_lamp_${i}.json`] = { id: `x_lamp_${i}`, like: 'lantern', cost: 600, hue: '#9FD3E8', text: { en: { name: 'Lamp', desc: 'y'.repeat(80) }, bg: { name: 'Лампа', desc: 'я'.repeat(2000) } } };
  const p = buildPayload({ event: 'job.ready', job: sampleJob(), files: big, prompts: Array.from({ length: 20 }, (_, i) => `${i} ${'z'.repeat(990)}`) },
    { install: 'c'.repeat(32), game: GAME, now: T0 });
  assert.ok(Buffer.byteLength(JSON.stringify(p)) <= MAX_PAYLOAD_BYTES);
  assert.equal(p.mod.trimmed, true);
  assert.deepEqual(p.mod.files, {});
  assert.equal(p.prompts.length, 20, '20 prompts of 1000 characters fit without the files');
  assert.equal(checkPayload(JSON.parse(JSON.stringify(p))).ok, true);
});

test('telemetry receiver: stores a checked event once (0600 in a 0700 folder), no Origin needed, no cookie read or set', async () => {
  const r = await receiver('tr-store');
  try {
    const p = payload();
    const res = await r.post(p, { cookie: 'session=abc', origin: 'https://some-other-farm.example' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { ok: true, id: p.id });
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const again = await r.post(p);
    assert.equal(again.status, 202, 'a retried delivery is acknowledged');
    const file = path.join(r.dir, 'telemetry', 'events.jsonl');
    assert.equal(mode(file), 0o600);
    assert.equal(mode(path.dirname(file)), 0o700);
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(rows.length, 1, 'stored once');
    assert.equal(rows[0].id, p.id);
    assert.equal(rows[0].at, T0, 'the time it arrived');
    assert.equal(rows[0].sentAt, p.at);
    assert.ok(!JSON.stringify(rows[0]).includes('session=abc') && !JSON.stringify(rows[0]).includes('127.0.0.1'), 'nothing about the sender');
    // bad bodies: named, never an HTML error page
    for (const [body, status, json] of [['{not json', 400, { error: 'BAD_ARGS', field: 'body' }], [{ ...p, id: newEventId(), extra: 1 }, 400, { error: 'BAD_ARGS', field: 'extra' }]]) {
      const b = await r.post(body);
      assert.equal(b.status, status);
      assert.deepEqual(await b.json(), json);
    }
    const huge = await r.post({ ...p, id: newEventId(), prompts: ['x'.repeat(MAX_PAYLOAD_BYTES)] });
    assert.equal(huge.status, 413);
    assert.deepEqual(await huge.json(), { error: 'TOO_BIG' });
    // a torn last line (a crash mid-append) neither hides the next event nor survives a reload
    fs.appendFileSync(file, '{"id":"torn');
    const p2 = payload({ id: newEventId() });
    assert.equal((await r.post(p2)).status, 202);
    const { TelemetryStore } = await import('../server/telemetry/store.js');
    const back = new TelemetryStore(path.dirname(file)).load();
    assert.deepEqual([...back.rows.keys()].sort(), [p.id, p2.id].sort());
  } finally { await r.close(); }
});

test('telemetry receiver: 60 an hour per address, 200 a day per install, a global daily cap (503 FULL)', async () => {
  const r = await receiver('tr-limits', { perDay: 250 });
  try {
    const from = (ip) => ({ 'x-forwarded-for': ip });
    for (let i = 0; i < RECEIVE_LIMITS.perAddressHour; i++) assert.equal((await r.post(payload({ id: newEventId() }), from('203.0.113.7'))).status, 202);
    const over = await r.post(payload({ id: newEventId() }), from('203.0.113.7'));
    assert.equal(over.status, 429);
    assert.equal((await over.json()).error, 'RATE');
    assert.ok(Number(over.headers.get('retry-after')) > 0);
    assert.equal((await r.post(payload({ id: newEventId() }), from('198.51.100.9'))).status, 202, 'another address is not limited');
    r.clock.advance(60 * 60_000);
    assert.equal((await r.post(payload({ id: newEventId() }), from('203.0.113.7'))).status, 202, 'a new hour');
    // one install: 200 a day, from any number of addresses
    const n = r.rx.store.recent(DAY, 'c'.repeat(32));
    for (let i = n; i < RECEIVE_LIMITS.perInstallDay; i++) assert.equal((await r.post(payload({ id: newEventId() }), from(`10.0.${i >> 6}.${i & 63}`))).status, 202);
    const inst = await r.post(payload({ id: newEventId() }), from('192.0.2.1'));
    assert.equal(inst.status, 429);
    assert.equal(r.rx.store.recent(DAY, 'c'.repeat(32)), RECEIVE_LIMITS.perInstallDay);
    // everybody together: 250 a day here
    for (let i = r.rx.store.recent(DAY); i < 250; i++) assert.equal((await r.post(payload({ id: newEventId(), install: 'd'.repeat(32) }), from(`10.9.${i >> 6}.${i & 63}`))).status, 202);
    const full = await r.post(payload({ id: newEventId(), install: 'e'.repeat(32) }), from('192.0.2.2'));
    assert.equal(full.status, 503);
    assert.deepEqual(await full.json(), { error: 'FULL' });
  } finally { await r.close(); }
});

test('telemetry receiver: admin list / delete one / delete an install, behind the admin token; none without one', async () => {
  const r = await receiver('tr-admin');
  try {
    const a = payload({ id: newEventId() });
    const b = payload({ id: newEventId(), install: 'f'.repeat(32), event: 'job.failed', outcome: { state: 'failed', afterMs: 1000 } });
    const c = payload({ id: newEventId(), install: 'f'.repeat(32), event: 'mod.undone', outcome: { state: 'undone', afterMs: null } });
    for (const p of [a, b, c]) { assert.equal((await r.post(p)).status, 202); r.clock.advance(1000); }
    assert.equal((await fetch(`${r.s.base}/api/admin/telemetry`)).status, 401);
    assert.equal((await fetch(`${r.s.base}/api/admin/telemetry`, { headers: { authorization: 'Bearer wrong-token-wrong-token-wrong' } })).status, 403);
    const list = await r.admin('');
    assert.equal(list.status, 200);
    assert.match(list.headers.get('content-security-policy'), /default-src 'none'/);
    const body = await list.json();
    assert.equal(body.total, 3);
    assert.deepEqual(body.events.map((e) => e.id), [c.id, b.id, a.id], 'newest first');
    assert.deepEqual(body.counts, { 'job.ready': 0, 'job.applied': 1, 'job.discarded': 0, 'job.failed': 1, 'job.answered': 0, 'mod.undone': 1 });
    assert.deepEqual((await (await r.admin('?event=job.failed')).json()).events.map((e) => e.id), [b.id]);
    assert.deepEqual((await (await r.admin(`?install=${'f'.repeat(32)}&limit=1`)).json()).events.map((e) => e.id), [c.id]);
    assert.deepEqual((await (await r.admin(`?since=${T0 + 1500}`)).json()).events.map((e) => e.id), [c.id]);
    assert.equal((await r.admin('?event=nope')).status, 400);
    assert.equal((await r.admin('/0123')).status, 404);
    assert.equal((await r.admin(`/${a.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await r.admin(`/${a.id}`, { method: 'DELETE' })).status, 404, 'gone');
    const del = await (await r.admin(`?install=${'f'.repeat(32)}`, { method: 'DELETE' })).json();
    assert.deepEqual(del, { ok: true, install: 'f'.repeat(32), deleted: 2 });
    assert.equal(fs.readFileSync(path.join(r.dir, 'telemetry', 'events.jsonl'), 'utf8'), '', 'deleted from the disk too');
    assert.equal((await r.admin('?install=xyz', { method: 'DELETE' })).status, 400);
  } finally { await r.close(); }
  const none = await receiver('tr-noadmin', { adminToken: null });
  try {
    assert.equal((await fetch(`${none.s.base}/api/admin/telemetry`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 404);
  } finally { await none.close(); }
});

test('telemetry receiver: the sweep deletes events older than 365 days (through the registry\'s sweepers)', async () => {
  const sweepers = [];
  const r = await receiver('tr-keep', { sweepers });
  try {
    const old = payload({ id: newEventId() });
    assert.equal((await r.post(old)).status, 202);
    r.clock.advance(TELEMETRY_KEEP_MS - DAY);
    const recent = payload({ id: newEventId() });
    assert.equal((await r.post(recent)).status, 202);
    assert.equal(sweepers.length, 1);
    assert.deepEqual(await sweepers[0](r.clock.now()), { telemetry: 0 });
    r.clock.advance(DAY + 1);
    assert.deepEqual(await sweepers[0](r.clock.now()), { telemetry: 1 });
    assert.deepEqual([...r.rx.store.rows.keys()], [recent.id]);
    assert.ok(!fs.readFileSync(path.join(r.dir, 'telemetry', 'events.jsonl'), 'utf8').includes(old.id));
  } finally { await r.close(); }
});

test('telemetry: the official multi host stores its own farms\' events directly (no HTTP to itself), still only with a yes', async () => {
  const fetches = [];
  const { t, dir, cleanup } = telemetryFor('te-local', { mode: 'multi', fetcher: async (...a) => { fetches.push(a); throw new Error('no network in this test'); } });
  const s = await appServer((app) => { t.receiverRoutes(app, { reg: { sweepers: [] } }); });
  try {
    const farm = 'abcdefgh2345';
    assert.equal((await t.record(farm, 'p1', { event: 'job.ready', job: sampleJob() })).queued, false, 'no yes, nothing');
    await t.setConsent(farm, 'p1', true);
    assert.equal((await t.record(farm, 'p1', { event: 'job.ready', job: sampleJob(), files: SAMPLE_FILES })).queued, true);
    assert.equal(await t.flush(), 1);
    assert.equal(fetches.length, 0);
    const rows = [...t.receiver.store.rows.values()];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].install, t.installOf(farm));
    assert.ok(!JSON.stringify(rows[0]).includes(farm));
    assert.ok(fs.existsSync(path.join(dir, 'telemetry', 'events.jsonl')));
  } finally { await s.close(); await cleanup(); }
});
