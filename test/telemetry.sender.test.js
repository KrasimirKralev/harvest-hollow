// The sharing choice and the sender (server/telemetry: consent.js, sender.js, index.js): nothing leaves without the
// farmer's own "yes" (off by default), turning it off deletes what waits, a payload never carries a credential, a
// farm id, a pid or a path, and delivery is ordered, capped at 20 an hour, retried with backoff and dropped after 7 days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { mockReceiver, telemetryFor, sampleJob, SAMPLE_FILES, appServer } from './helpers/telemetry.js';
import { PAYLOAD_KEYS } from '../server/telemetry/payload.js';
import { OUTBOX_FILE, backoff } from '../server/telemetry/sender.js';
import { SEND_PER_HOUR, DEFAULT_TELEMETRY_URL, telemetryConfig } from '../server/telemetry/config.js';

const HOUR = 3_600_000;
const mode = (f) => fs.statSync(f).mode & 0o777;
const ev = (over = {}) => ({ event: 'job.ready', job: sampleJob(), files: SAMPLE_FILES, ...over });

test('telemetry: off by default: no choice, or "no", or HH_TELEMETRY=off -> nothing is queued, stored or sent', async () => {
  const rx = await mockReceiver();
  try {
    await offByDefault(rx);
  } finally { await rx.close(); }
});

async function offByDefault(rx) {
  const { t, dir, cleanup } = telemetryFor('tm-default', { env: { HH_TELEMETRY_URL: rx.url } });
  try {
    assert.deepEqual(t.consent('local', 'p1'), { telemetry: null, at: null, sending: true, install: null }, 'never asked = null (the server can share: ask)');
    for (const e of ['job.ready', 'job.applied', 'job.discarded', 'job.failed', 'mod.undone']) {
      assert.deepEqual(await t.record('local', 'p1', ev({ event: e })), { queued: false, reason: 'NO_CONSENT' });
    }
    await t.setConsent('local', 'p1', false);
    assert.equal(t.consent('local', 'p1').telemetry, false);
    assert.deepEqual(await t.record('local', 'p1', ev()), { queued: false, reason: 'NO_CONSENT' });
    // the partner's "yes" is not this farmer's
    await t.setConsent('local', 'p2', true);
    assert.deepEqual(await t.record('local', 'p1', ev()), { queued: false, reason: 'NO_CONSENT' });
    assert.equal(await t.flush(), 0);
    assert.equal(rx.requests.length, 0, 'nothing reached the receiver');
    assert.equal(fs.existsSync(path.join(dir, 'harness-host', OUTBOX_FILE)), false, 'nothing waits on disk');
  } finally { await cleanup(); }

  // the operator's switch beats a farmer's yes; so does HH_TELEMETRY_URL=off (nowhere to send)
  for (const [env, reason] of [[{ HH_TELEMETRY: 'off', HH_TELEMETRY_URL: rx.url }, 'OFF'], [{ HH_TELEMETRY_URL: 'off' }, 'NOWHERE']]) {
    const x = telemetryFor('tm-off', { env });
    try {
      const c = await x.t.setConsent('local', 'p1', true);
      assert.equal(c.telemetry, true);
      assert.equal(c.sending, false, 'the page can say the choice is stored but nothing is sent');
      assert.deepEqual(await x.t.record('local', 'p1', ev()), { queued: false, reason });
      await x.t.flush();
      assert.equal(fs.existsSync(path.join(x.dir, 'harness-host', OUTBOX_FILE)), false);
    } finally { await x.cleanup(); }
  }
  assert.equal(rx.requests.length, 0);
}

test('telemetry: an unreadable or hand-edited consent file is never read as a yes', async () => {
  const rx = await mockReceiver();
  const { t, ctx, cleanup } = telemetryFor('tm-bad-file', { env: { HH_TELEMETRY_URL: rx.url } });
  try {
    const file = path.join(ctx.dirOf('local'), 'consent.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const body of ['{not json', '[]', JSON.stringify({ p1: { telemetry: 'yes' } }), JSON.stringify({ p1: { telemetry: 1 } }),
      JSON.stringify({ p1: true }), JSON.stringify({ P1: { telemetry: true } })]) {
      fs.writeFileSync(file, body);
      assert.equal(t.consent('local', 'p1').telemetry, null, body);
      assert.equal((await t.record('local', 'p1', ev())).queued, false, body);
    }
    await t.flush();
    assert.equal(rx.requests.length, 0);
  } finally { await cleanup(); await rx.close(); }
});

test('telemetry: with a yes, the event is sent as the contract\'s payload: 0600 files, a random install id, no cookie', async () => {
  const rx = await mockReceiver();
  const { t, dir, ctx, cleanup } = telemetryFor('tm-yes', { env: { HH_TELEMETRY_URL: rx.url } });
  try {
    const c = await t.setConsent('local', 'p1', true);
    assert.equal(c.telemetry, true);
    assert.equal(c.sending, true);
    assert.match(c.install, /^[0-9a-f]{32}$/);
    const consentFile = path.join(ctx.dirOf('local'), 'consent.json');
    assert.equal(mode(consentFile), 0o600);
    assert.equal(mode(path.dirname(consentFile)), 0o700);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(consentFile, 'utf8')).p1).sort(), ['at', 'telemetry', 'v']);
    const installFile = path.join(dir, 'harness-host', 'install.json');
    assert.equal(mode(installFile), 0o600);
    const r = await t.record('local', 'p1', ev({ event: 'job.applied', job: sampleJob({ state: 'applied' }) }));
    assert.equal(r.queued, true);
    assert.equal(mode(path.join(dir, 'harness-host', OUTBOX_FILE)), 0o600);
    assert.equal(await t.flush(), 1);
    assert.equal(rx.requests.length, 1);
    const q = rx.requests[0];
    assert.equal(q.method, 'POST');
    assert.equal(q.url, '/api/telemetry');
    assert.match(q.headers['content-type'], /application\/json/);
    assert.equal(q.headers.cookie, undefined);
    assert.equal(q.headers.authorization, undefined);
    const p = JSON.parse(q.body);
    assert.deepEqual(Object.keys(p), [...PAYLOAD_KEYS]);
    assert.equal(p.id, r.id);
    assert.equal(p.install, c.install);
    assert.equal(p.event, 'job.applied');
    assert.deepEqual(p.prompts, ['Add a moon melon that glows at night', 'Make it a bit faster to grow']);
    assert.deepEqual(p.diff, { added: ['x_moon_melon'], changed: [], retired: [], revived: [] });
    assert.deepEqual(p.validation, { ok: true, stage: 'done', codes: [], rounds: 2, ms: 8421 });
    assert.deepEqual(p.outcome, { state: 'applied', afterMs: 93_000 });
    assert.deepEqual(Object.keys(p.mod.files).sort(), Object.keys(SAMPLE_FILES).sort());
    assert.equal(p.lang, 'bg');
    assert.equal(p.provider, 'chatgpt');
    assert.equal(p.game.mode, 'single');
    // sent once: the outbox is empty (no file at all)
    assert.equal(fs.existsSync(path.join(dir, 'harness-host', OUTBOX_FILE)), false);
    assert.equal(await t.flush(), 0);
    assert.equal(rx.requests.length, 1);
  } finally { await cleanup(); await rx.close(); }
});

test('telemetry: turning sharing off deletes that farmer\'s waiting events (and only theirs)', async () => {
  const rx = await mockReceiver({ answer: 503 });
  const { t, dir, clock, cleanup } = telemetryFor('tm-off-drops', { env: { HH_TELEMETRY_URL: rx.url } });
  try {
    await t.setConsent('local', 'p1', true);
    await t.setConsent('local', 'p2', true);
    await t.record('local', 'p1', ev({ prompts: ['p1 first idea'] }));
    await t.record('local', 'p1', ev({ prompts: ['p1 second idea'] }));
    await t.record('local', 'p2', ev({ prompts: ['p2 idea'] }));
    assert.equal(await t.flush(), 0, 'the receiver is down: everything waits');
    assert.equal(rx.requests.length, 1);
    const off = await t.setConsent('local', 'p1', false);
    assert.equal(off.telemetry, false);
    assert.equal(off.sending, true, 'the server still shares (other farmers\' yes); this farmer\'s answer is `telemetry`');
    const disk = fs.readFileSync(path.join(dir, 'harness-host', OUTBOX_FILE), 'utf8');
    assert.ok(!disk.includes('p1 first idea') && !disk.includes('p1 second idea'), 'p1\'s waiting events are gone from the disk');
    assert.ok(disk.includes('p2 idea'));
    rx.answer = 202;
    clock.advance(HOUR);
    assert.equal(await t.flush(), 1);
    assert.deepEqual(rx.bodies().slice(1).map((b) => b.prompts[0]), ['p2 idea']);
    // and a "no" after that sends nothing new
    assert.equal((await t.record('local', 'p1', ev())).queued, false);
  } finally { await cleanup(); await rx.close(); }
});

test('telemetry: a payload never carries a credential, an account, a farm id, a pid, a name field or a path', async () => {
  const rx = await mockReceiver();
  const { t, dir, ctx, cleanup } = telemetryFor('tm-secrets', { mode: 'multi', env: { HH_TELEMETRY_URL: rx.url } });
  const farm = 'abcdefgh2345';
  const SECRETS = {
    farmKey: 'f'.repeat(64), invite: '0123456789abcdef0123456789abcdef', access: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.c2lnbmF0dXJl',
    refresh: 'rt_9Kq2LmZx81PqRvTb5NnWcYe4UuJhGfDs0aXk3iOp', apiKey: 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWx1234', claude: 'sk-ant-oat01-ZyXwVuTsRqPoNmLk9876',
    client: 'oaiapp_7f3e9a1b2c', email: 'rowan.farmer@example.com', jobToken: 'a1'.repeat(32),
  };
  // the sign-ins on disk exactly where the agent lane keeps them: telemetry must never open them
  const users = path.join(ctx.dirOf(farm), 'users', 'p1');
  fs.mkdirSync(path.join(users, 'openai', SECRETS.client), { recursive: true });
  fs.writeFileSync(path.join(users, 'openai', SECRETS.client, 'sub.json'), JSON.stringify({ access: SECRETS.access, refresh: SECRETS.refresh }));
  fs.mkdirSync(path.join(users, 'claude', 'config'), { recursive: true });
  fs.writeFileSync(path.join(users, 'claude', 'config', '.credentials.json'), JSON.stringify({ token: SECRETS.claude }));
  const opened = [];
  const real = { readFileSync: fs.readFileSync, openSync: fs.openSync, promisesOpen: fs.promises.open };
  fs.readFileSync = (f, ...a) => { opened.push(String(f)); return real.readFileSync(f, ...a); };
  fs.openSync = (f, ...a) => { opened.push(String(f)); return real.openSync(f, ...a); };
  fs.promises.open = (f, ...a) => { opened.push(String(f)); return real.promisesOpen(f, ...a); };
  try {
    await t.setConsent(farm, 'p1', true);
    const job = sampleJob({
      prompts: [{ at: 1, text: `Add a crop. My key is ${SECRETS.apiKey}, token ${SECRETS.access}, mail ${SECRETS.email}` },
        { at: 2, text: `my farm https://harvest-hollow.up.railway.app/f/${farm}#k=${SECRETS.farmKey} and invite ?join=${SECRETS.invite}` },
        { at: 3, text: `see ${dir}/harness and C:\\Users\\rowan\\secret.txt from 192.168.1.23, also ${SECRETS.claude} ${SECRETS.refresh}` }],
      // private fields a careless caller might pass along with the job
      access: SECRETS.access, refresh: SECRETS.refresh, token: SECRETS.jobToken, session: 'sess-123', account: { label: SECRETS.email },
      farmKey: farm, pid: 'p1', dir: dir, private: { mcp: { env: { HH_JOB_TOKEN: SECRETS.jobToken } } }, by: 'p1',
    });
    const files = {
      ...SAMPLE_FILES,
      'mod.json': { format: 1, title: { en: `Hi ${SECRETS.email}`, bg: 'Лунна жътва' }, token: SECRETS.jobToken, apiKey: SECRETS.apiKey },
      'content/crops/x_moon_melon.json': { ...SAMPLE_FILES['content/crops/x_moon_melon.json'], note: `${SECRETS.refresh}` },
      '../../etc/passwd': { x: 1 },
      'private/mcp.json': { token: SECRETS.jobToken },
    };
    const r = await t.record(farm, 'p1', { event: 'job.failed', job, files, account: SECRETS.email, credentials: SECRETS,
      validation: { ok: false, stage: 'schema', errors: [{ code: 'BAD_TEXT', file: `${dir}/x`, message: SECRETS.apiKey, hint: SECRETS.access }] } });
    assert.equal(r.queued, true);
    await t.flush();
  } finally {
    fs.readFileSync = real.readFileSync;
    fs.openSync = real.openSync;
    fs.promises.open = real.promisesOpen;
  }
  try {
    assert.equal(rx.requests.length, 1);
    const body = rx.requests[0].body;
    for (const [k, v] of Object.entries(SECRETS)) assert.ok(!body.includes(v), `the ${k} left the server: ${body}`);
    assert.ok(!body.includes(farm), 'no farm id');
    assert.ok(!body.includes(dir) && !body.includes('/home/') && !body.includes('C:\\\\'), 'no path');
    assert.ok(!body.includes('192.168.1.23'), 'no address');
    const p = JSON.parse(body);
    assert.deepEqual(Object.keys(p), [...PAYLOAD_KEYS]);
    const keys = new Set();
    const walk = (o) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); } };
    walk(p);
    for (const k of ['pid', 'farmKey', 'farm', 'by', 'token', 'access', 'refresh', 'account', 'session', 'apiKey', 'credentials', 'email',
      'dir', 'private', 'message', 'hint', 'file', 'path']) assert.ok(!keys.has(k), `no "${k}" field anywhere`);
    assert.deepEqual(Object.keys(p.mod.files).sort(), ['content/crops/x_moon_melon.json', 'mod.json'], 'only a mod\'s own files');
    assert.deepEqual(p.validation.codes, ['BAD_TEXT']);
    assert.match(p.prompts[0], /^Add a crop\. My key is \[redacted\], token \[redacted\], mail \[email\]$/);
    assert.match(p.prompts[1], /\/f\/\[farm\]#k=\[redacted\]/);
    // multi mode: the install id is the farm's own, not the host's
    assert.equal(p.install, t.installOf(farm));
    assert.notEqual(p.install, t.installOf('local'));
    // telemetry opened nothing under the farmers' sign-in folders
    const signins = opened.filter((f) => f.includes(`${path.sep}users${path.sep}`));
    assert.deepEqual(signins, [], 'telemetry never opens a sign-in file');
  } finally { await cleanup(); await rx.close(); }
});

test('telemetry: one farm\'s choice is not another\'s; a deleted farm\'s waiting events go with it', async () => {
  const rx = await mockReceiver({ answer: 503 });
  const { t, ctx, cleanup } = telemetryFor('tm-farms', { mode: 'multi', env: { HH_TELEMETRY_URL: rx.url } });
  try {
    const a = 'aaaaaaaaaaaa';
    const b = 'bbbbbbbbbbbb';
    await t.setConsent(a, 'p1', true);
    assert.equal(t.consent(b, 'p1').telemetry, null);
    assert.equal((await t.record(b, 'p1', ev())).queued, false);
    assert.equal((await t.record(a, 'p1', ev())).queued, true);
    assert.ok(fs.existsSync(path.join(ctx.dirOf(a), 'telemetry-install.json')), 'the farm\'s install id lives in its folder');
    assert.notEqual(t.installOf(a), null);
    assert.equal(t.installOf(b), null, 'no id for a farm that never said yes');
    assert.equal(await t.onFarmDeleted(a), 1);
    rx.answer = 202;
    await t.flush();
    assert.equal(rx.requests.length, 0, 'the deleted farm\'s event never left');
    // nonsense farm keys and pids are refused outright
    assert.equal((await t.record('../../etc', 'p1', ev())).reason, 'BAD_ARGS');
    assert.equal((await t.record(a, '__proto__', ev())).reason, 'BAD_ARGS');
    await assert.rejects(t.setConsent(a, 'admin', true));
  } finally { await cleanup(); await rx.close(); }
});

test('telemetry: delivery is in order, at most 20 an hour, retried with backoff, dropped on 400 and after 7 days', async () => {
  const rx = await mockReceiver();
  const { t, dir, clock, cleanup } = telemetryFor('tm-pace', { env: { HH_TELEMETRY_URL: rx.url } });
  try {
    await t.setConsent('local', 'p1', true);
    for (let i = 0; i < SEND_PER_HOUR + 5; i++) await t.record('local', 'p1', ev({ prompts: [`idea ${i}`] }));
    assert.equal(await t.flush(), SEND_PER_HOUR);
    clock.advance(HOUR / 2);
    assert.equal(await t.flush(), 0, 'still the same hour');
    clock.advance(HOUR / 2 + 1);
    assert.equal(await t.flush(), 5);
    assert.deepEqual(rx.bodies().map((b) => b.prompts[0]), Array.from({ length: SEND_PER_HOUR + 5 }, (_, i) => `idea ${i}`), 'in order');

    // a server error: the event waits 1, 2, 4 … minutes
    rx.requests.length = 0;
    clock.advance(2 * HOUR);
    rx.answer = 500;
    await t.record('local', 'p1', ev({ prompts: ['retry me'] }));
    assert.equal(await t.flush(), 0);
    assert.equal(await t.flush(), 0);
    assert.equal(rx.requests.length, 1, 'no hammering before the pause is over');
    clock.advance(backoff(1));
    await t.flush();
    assert.equal(rx.requests.length, 2);
    rx.answer = 202;
    clock.advance(backoff(2));
    assert.equal(await t.flush(), 1);
    assert.equal(rx.bodies()[2].prompts[0], 'retry me');
    // the same event id each time: the receiver stores a retry once
    assert.equal(new Set(rx.bodies().map((b) => b.id)).size, 1);

    // 429 with Retry-After: waits at least that long
    rx.requests.length = 0;
    rx.answer = 429;
    rx.headers = { 'retry-after': '7200' };
    await t.record('local', 'p1', ev({ prompts: ['slow down'] }));
    await t.flush();
    clock.advance(HOUR);
    rx.answer = 202;
    rx.headers = {};
    assert.equal(await t.flush(), 0, 'Retry-After 2 h is honoured');
    clock.advance(HOUR + 1);
    assert.equal(await t.flush(), 1);

    // a refusal that cannot get better (400, 413) is dropped at once
    rx.requests.length = 0;
    rx.answer = 400;
    await t.record('local', 'p1', ev({ prompts: ['bad'] }));
    assert.equal(await t.flush(), 0);
    assert.equal(fs.existsSync(path.join(dir, 'harness-host', OUTBOX_FILE)), false, 'dropped, not retried');

    // undelivered for 7 days: dropped by the sweep (and by a flush)
    rx.answer = 503;
    await t.record('local', 'p1', ev({ prompts: ['too late'] }));
    await t.flush();
    clock.advance(7 * 24 * HOUR);
    const s = await t.sweep();
    assert.equal(s.outbox, 1);
    rx.answer = 202;
    rx.requests.length = 0;
    await t.flush();
    assert.equal(rx.requests.length, 0);
  } finally { await cleanup(); await rx.close(); }
});

test('telemetry: a redirect is never followed (the event cannot be handed to a host nobody chose)', async () => {
  const other = await mockReceiver();
  const rx = await mockReceiver({ answer: 307 });
  rx.headers = { location: other.url };
  const { t, dir, cleanup } = telemetryFor('tm-redirect', { env: { HH_TELEMETRY_URL: rx.url } });
  try {
    await t.setConsent('local', 'p1', true);
    await t.record('local', 'p1', ev());
    assert.equal(await t.flush(), 0);
    assert.equal(rx.requests.length, 1);
    assert.equal(other.requests.length, 0);
    assert.ok(fs.existsSync(path.join(dir, 'harness-host', OUTBOX_FILE)), 'it waits for a proper answer');
  } finally { await cleanup(); await rx.close(); await other.close(); }
});

test('telemetry: the outbox survives a restart; a new process sends what the old one could not', async () => {
  const rx = await mockReceiver({ answer: 503 });
  const first = telemetryFor('tm-restart', { env: { HH_TELEMETRY_URL: rx.url } });
  await first.t.setConsent('local', 'p1', true);
  await first.t.record('local', 'p1', ev({ prompts: ['before the restart'] }));
  await first.t.flush();
  await first.t.stop();
  const { createTelemetry } = await import('../server/telemetry/index.js');
  const second = createTelemetry(first.ctx);
  try {
    rx.answer = 202;
    first.clock.advance(HOUR);
    assert.equal(await second.flush(), 1);
    assert.equal(rx.bodies().at(-1).prompts[0], 'before the restart');
  } finally {
    await second.stop();
    fs.rmSync(first.dir, { recursive: true, force: true });
    await rx.close();
  }
});

test('telemetry: GET/POST /consent: the farmer\'s own choice only, a boolean only', async () => {
  const rx = await mockReceiver();
  const { t, cleanup } = telemetryFor('tm-routes', { env: { HH_TELEMETRY_URL: rx.url } });
  const s = await appServer((app) => { const r = express.Router(); t.routes(r); app.use('/api/harness', r); });
  const call = (method, body, pid = 'p1') => fetch(`${s.base}/api/harness/consent`, { method,
    headers: { 'content-type': 'application/json', ...(pid ? { 'x-test-pid': pid } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await call('GET', undefined, null)).status, 401);
    assert.equal((await call('POST', { telemetry: true }, null)).status, 401);
    const first = await call('GET');
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await first.json(), { telemetry: null, at: null, sending: true, install: null });
    for (const [body, field] of [[{ telemetry: 'yes' }, 'telemetry'], [{}, 'telemetry'], [{ telemetry: true, pid: 'p2' }, 'pid'], [[true], 'body']]) {
      const r = await call('POST', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.deepEqual(await r.json(), { error: 'BAD_ARGS', field });
    }
    const on = await (await call('POST', { telemetry: true })).json();
    assert.equal(on.telemetry, true);
    assert.equal(on.sending, true);
    assert.match(on.install, /^[0-9a-f]{32}$/);
    assert.equal((await (await call('GET', undefined, 'p2')).json()).telemetry, null, 'p2 is untouched');
    const off = await (await call('POST', { telemetry: false })).json();
    assert.equal(off.telemetry, false);
    assert.equal(off.install, on.install, 'the id stays readable for a deletion request');
    assert.equal(rx.requests.length, 0);
  } finally { await s.close(); await cleanup(); await rx.close(); }
});

test('telemetry config: defaults, off switches, and refused values', () => {
  const d = telemetryConfig({});
  assert.deepEqual(d, { enabled: true, url: DEFAULT_TELEMETRY_URL, urlExplicit: false, receive: false, perDay: 5000 });
  assert.equal(telemetryConfig({ HH_TELEMETRY: 'off' }).enabled, false);
  assert.equal(telemetryConfig({ HH_TELEMETRY_URL: 'off' }).url, null);
  assert.equal(telemetryConfig({ HH_TELEMETRY_URL: 'http://127.0.0.1:4340/api/telemetry' }).urlExplicit, true);
  assert.equal(telemetryConfig({ HH_TELEMETRY_RECEIVE: '1' }).receive, true);
  for (const env of [{ HH_TELEMETRY_URL: 'ftp://x/y' }, { HH_TELEMETRY_URL: 'not a url' }, { HH_TELEMETRY_URL: 'https://user:pw@host/x' },
    { HH_TELEMETRY_PER_DAY: '0' }, { HH_TELEMETRY_PER_DAY: 'many' }]) {
    assert.throws(() => telemetryConfig(env), /HH_TELEMETRY/, JSON.stringify(env));
  }
});
