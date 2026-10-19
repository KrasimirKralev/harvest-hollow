// The receiving end (server/telemetry/receiver.js, store.js) and the owners' CLI (tools/ideas.mjs telemetry): a strict
// shape, every string scrubbed again, stored once per event id in a 0600 file, rate limits per address / install /
// day, 413 above 64 KB, the admin list and deletions behind HH_ADMIN_TOKEN, 365-day retention; and the whole path
// sender -> HTTP -> receiver -> CLI, plus the official host's local delivery (no HTTP to itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { appServer, quiet, tmpDataDir, fakeClock, T0, telemetryFor, sampleJob, SAMPLE_FILES } from './helpers/telemetry.js';
import { mountTelemetryReceiver } from '../server/telemetry/receiver.js';
import { buildPayload, checkPayload, scrub, newEventId } from '../server/telemetry/payload.js';
import { TELEMETRY_KEEP_MS, RECEIVE_LIMITS, MAX_PAYLOAD_BYTES } from '../server/telemetry/config.js';
import { main, formatEvent, parseArgs } from '../tools/ideas.mjs';

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

test('telemetry end to end: a player\'s server -> the public receiver -> the owners\' CLI (list, delete, delete-install)', async () => {
  const hostDir = tmpDataDir('te2e-host');
  const clock = fakeClock(T0);
  let host;
  const s = await appServer(async (app) => {
    const { createTelemetry } = await import('../server/telemetry/index.js');
    const { harnessCtx } = await import('./helpers/telemetry.js');
    host = createTelemetry(harnessCtx(hostDir, { mode: 'multi', clock, extra: { cfg: { ideas: { adminToken: TOKEN } } } }));
    host.receiverRoutes(app, { reg: { sweepers: [] } });
  });
  const player = telemetryFor('te2e-player', { clock, env: { HH_TELEMETRY_URL: `${s.base}/api/telemetry` } });
  const tokenFile = path.join(hostDir, 'admin-token');
  fs.writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
  const env = { HH_ADMIN_TOKEN_FILE: tokenFile, NO_COLOR: '1' };
  const sink = () => { const o = { text: '', isTTY: false, write(x) { o.text += x; return true; } }; return o; };
  try {
    await player.t.setConsent('local', 'p1', true);
    await player.t.record('local', 'p1', { event: 'job.applied', job: sampleJob({ state: 'applied' }), files: SAMPLE_FILES });
    await player.t.record('local', 'p1', { event: 'job.failed', job: sampleJob({ state: 'failed', prompts: [{ at: 1, text: 'Make gold \u001b[2J rain' }] }),
      validation: { ok: false, stage: 'semantic', errors: [{ code: 'ECON_BOUND' }] } });
    assert.equal(await player.t.flush(), 2);
    assert.equal(host.receiver.store.rows.size, 2);
    const install = player.t.installOf('local');
    const out = sink();
    const err = sink();
    assert.equal(await main(['--url', s.base, 'telemetry'], { env, out, err }), 0, err.text);
    assert.match(out.text, /^Harness Hollow shared helper events · 2 shown · 2 in all: 0 job.ready, 1 job.applied/);
    assert.match(out.text, /> Add a moon melon that glows at night/);
    assert.match(out.text, /did not pass \(semantic\) in 2 round\(s\) · ECON_BOUND/);
    assert.match(out.text, new RegExp(`install ${install.slice(0, 8)}`));
    assert.ok(!out.text.includes('\u001b'), 'a typed escape never reaches the terminal');
    const only = sink();
    await main(['--url', s.base, 'telemetry', '--event', 'job.failed', '--json'], { env, out: only, err: sink() });
    const failed = JSON.parse(only.text).events;
    assert.equal(failed.length, 1);
    const del = sink();
    assert.equal(await main(['--url', s.base, 'telemetry', 'delete', failed[0].id.slice(0, 6)], { env, out: del, err: sink() }), 0);
    assert.match(del.text, new RegExp(`Deleted shared event ${failed[0].id} for good`));
    assert.equal(host.receiver.store.rows.size, 1);
    const di = sink();
    assert.equal(await main(['--url', s.base, 'telemetry', 'delete-install', install], { env, out: di, err: sink() }), 0);
    assert.match(di.text, /Deleted 1 shared event\(s\) of install/);
    assert.equal(host.receiver.store.rows.size, 0);
    assert.equal(await main(['--url', s.base, 'telemetry', 'delete-install', 'nope'], { env, out: sink(), err: sink() }), 1);
    assert.throws(() => parseArgs(['telemetry', '--event', 'job.secret'], {}), /--event/);
  } finally {
    await s.close();
    await host.stop();
    await player.cleanup();
    fs.rmSync(hostDir, { recursive: true, force: true });
  }
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

test('telemetry cli: an event prints as terminal-safe plain text', () => {
  const e = { id: 'a'.repeat(32), at: T0, install: 'b'.repeat(32), event: 'job.ready', provider: 'claude', model: 'sonnet', lang: 'en',
    game: { mode: 'single', version: '0.1.0' }, prompts: ['Clear \u001b[2J the \u0007 screen\r\n<script>x</script>‮exe'],
    mod: { format: 1, files: { 'mod.json': {} } }, diff: { added: ['x_a'], changed: [], retired: [], revived: [] },
    validation: { ok: true, stage: 'done', codes: [], rounds: 1, ms: 5 }, outcome: { state: 'ready', afterMs: 120_000 } };
  for (const color of [false, true]) {
    const s = formatEvent(e, { color });
    assert.ok(!s.includes('\u001b[2J') && !s.includes('\u0007') && !s.includes('\r') && !s.includes('‮'), JSON.stringify(s));
    assert.ok(s.includes('<script>x</script>'));
    if (!color) assert.ok(!s.includes('\u001b'));
  }
  assert.match(formatEvent(e), /ready after 2 min · passed \(done\) in 1 round\(s\)/);
  assert.match(formatEvent(e), /added x_a · 1 mod file\(s\)/);
});
