// HTTP status and caching, the boot banner, structured logs, the systemd unit (lane brief items 6, 7, 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { bigText, lanAddresses, banner } from '../server/banner.js';
import { createLogger, parseArgs } from '../server/log.js';
import { loadConfig } from '../server/config.js';
import { PROTOCOL_VERSION } from '../shared/net/protocol.js';
import { CONTENT_HASH } from '../shared/content/index.js';
import { ROOT, testServer, join, sleep } from './helpers/server.js';

test('/api/status reports version, uptime, players online, content hash and the last save', async () => {
  const s = await testServer();
  try {
    const { c } = await join(s.port, 'p1', 'Rowan');
    await sleep(20);
    const st = await (await fetch(`http://127.0.0.1:${s.port}/api/status`)).json();
    assert.equal(st.ok, true);
    assert.equal(st.proto, PROTOCOL_VERSION);
    assert.equal(st.contentHash, CONTENT_HASH);
    assert.match(st.version, /^\d+\.\d+\.\d+/);
    assert.deepEqual(st.online, ['p1']);
    assert.ok(st.uptimeS >= 0 && Number.isSafeInteger(st.serverNow));
    assert.equal(st.save.lastV, 0, 'the boot snapshot');
    assert.ok(st.save.lastAt > 0 && st.save.lastBackupAt > 0);
    assert.ok(Number.isFinite(st.nextSystemDueAt));
    assert.equal(JSON.stringify(st).includes('tokenHash'), false, 'no secrets');
    c.close();
  } finally {
    await s.close();
  }
});

test('game files revalidate on every load (a server update shows on reload); only three.js is cached long', async () => {
  const s = await testServer();
  try {
    // node:http, not fetch: fetch adds `Cache-Control: no-cache` to conditional requests, as browsers' fetch does
    const get = (p, headers = {}) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: s.port, path: p, headers }, (res) => { res.resume(); resolve(res); }).on('error', reject);
    });
    for (const p of ['/', '/js/main.js', '/shared/net/protocol.js']) {
      const r = await get(p);
      assert.equal(r.statusCode, 200, p);
      assert.equal(r.headers['cache-control'], 'no-cache', p);
      const etag = r.headers.etag;
      assert.ok(etag, p);
      assert.equal((await get(p, { 'if-none-match': etag })).statusCode, 304, `${p}: an unchanged file is a 304`);
    }
    const three = await get('/vendor/three/build/three.module.js');
    assert.equal(three.statusCode, 200);
    assert.match(three.headers['cache-control'], /max-age=604800/);
    assert.equal(three.headers['x-content-type-options'], 'nosniff');
    assert.equal((await get('/api/nope')).statusCode, 404);
  } finally {
    await s.close();
  }
});

test('the banner prints every URL plainly (tools parse it) and the LAN address in block letters', () => {
  const addresses = lanAddresses({
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    tailscale0: [{ family: 'IPv4', address: '100.101.102.103', internal: false, mac: '00:00:00:00:00:00' }],
    docker0: [{ family: 'IPv4', address: '172.17.0.1', internal: false, mac: '02:42:ac:11:00:01' }],
    wlo1: [{ family: 'IPv4', address: '192.168.0.9', internal: false, mac: '02:00:00:00:00:01' },
      { family: 'IPv6', address: 'fe80::1', internal: false, mac: '02:00:00:00:00:01' }],
    wg0: [{ family: 'IPv4', address: '10.8.0.18', internal: false, mac: '00:00:00:00:00:00' }],
    eth0: [{ family: 'IPv4', address: '10.0.0.7', internal: false, mac: '00:11:22:33:44:55' }],
  });
  assert.deepEqual(addresses.map((a) => [a.address, a.kind]),
    [['192.168.0.9', 'lan'], ['10.0.0.7', 'lan'], ['10.8.0.18', 'vpn'], ['100.101.102.103', 'tailscale']]);
  const text = banner({ port: 3300, addresses, hostname: 'farmhouse-pc' });
  assert.match(text, /running at:\n\n {4}http:\/\/localhost:3300\n/);
  assert.match(text, /http:\/\/192\.168\.0\.9:3300 +wlo1 +<- your partner opens this/);
  assert.match(text, /http:\/\/farmhouse-pc\.local:3300 +mDNS name/);
  assert.match(text, /tailscale0 \(Tailscale\)/);
  assert.match(text, /wg0 \(VPN\)/);
  assert.equal(text.includes(bigText('10.8.0.18:3300')[0]), false, 'a tunnel the partner is not on is not drawn big');
  const big = bigText('192.168.0.9:3300');
  assert.equal(big.length, 3);
  assert.ok(big.every((l) => /^[ ▀▄█]+$/.test(l)), 'half-block glyphs only');
  assert.ok(Math.max(...big.map((l) => l.length)) <= 16 * 4, 'four columns per character');
  assert.ok(text.includes(big[0]), 'the LAN address is drawn big');
  assert.deepEqual(bigText('8'), ['█▀█', '█▀█', '▀▀▀']);
});

test('structured logs: one line per event with key=value fields, or JSON; errors keep their stack', () => {
  const out = [];
  const err = [];
  const sink = (arr) => ({ write: (s) => arr.push(s) });
  const now = () => new Date(Date.UTC(2026, 9, 2, 21, 0, 0));
  const log = createLogger({ out: sink(out), err: sink(err), color: false, now });
  log.info('slot claimed', { pid: 'p1', name: 'Rowan Ashby' });
  log.error('rule threw', { type: 'plant' }, new TypeError('boom'));
  assert.equal(out[0], '2026-10-02T21:00:00.000Z INFO  slot claimed pid=p1 name="Rowan Ashby"\n');
  assert.match(err[0], /^2026-10-02T21:00:00\.000Z ERROR rule threw type=plant err=boom\n {2}at /);
  const json = [];
  createLogger({ json: true, out: sink(json), err: sink(json), now }).warn('clock went back', { ms: 7000 });
  assert.deepEqual(JSON.parse(json[0]), { ts: '2026-10-02T21:00:00.000Z', level: 'WARN', msg: 'clock went back', ms: 7000 });
  const quietOut = [];
  createLogger({ quiet: true, out: sink(quietOut), err: sink(quietOut) }).info('hidden');
  assert.deepEqual(quietOut, []);
  assert.deepEqual(parseArgs(['a', 3, '\x1b[31mred\x1b[0m']).msg, 'a 3 red');
});

test('config: HH_TZ defaults to the machine zone; HH_SLOTS is clamped; a bad zone is a config error', () => {
  const machine = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(loadConfig({}).tz, machine);
  assert.equal(loadConfig({ HH_TZ: 'America/New_York' }).tz, 'America/New_York');
  assert.throws(() => loadConfig({ HH_TZ: 'Mars/Olympus' }), /not an IANA time zone/);
  assert.equal(loadConfig({}).slots, 2);
  assert.equal(loadConfig({ HH_SLOTS: '1' }).slots, 1);
  assert.ok(loadConfig({ HH_SLOTS: '99' }).slots <= 4);
});

test('the systemd unit runs the production server: port 3300, the data dir, restart on failure, never HH_DEV', () => {
  const unit = fs.readFileSync(path.join(ROOT, 'deploy/harvest-hollow.service'), 'utf8');
  const lines = unit.split('\n').filter((l) => !l.startsWith('#'));
  const has = (l) => assert.ok(lines.includes(l), l);
  has('WorkingDirectory=%h/harvest-hollow');
  has('ExecStart=/usr/bin/node %h/harvest-hollow/server/index.js');
  assert.equal(lines.some((l) => /^(WorkingDirectory|ExecStart|Environment)=\/home\//.test(l)), false, 'no machine-specific home path');
  has('Environment=PORT=3300');
  has('Environment=HH_DATA_DIR=%h/harvest-hollow/data');
  has('Restart=on-failure');
  has('RestartPreventExitStatus=78');
  has('WantedBy=default.target');
  assert.equal(lines.some((l) => /HH_DEV|HH_PASSPHRASE/.test(l)), false, 'no dev routes, no secret in a tracked file');
});
