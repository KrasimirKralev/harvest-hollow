// Option 2's handshake and per-request decision (option2#D11 test 2, release 1.0 O1): server/asset-origin.js with a stub
// fetcher, and the HH_ASSET_* settings in server/config.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetOrigin, isLocalHost, cookieOf, RECHECK_MS } from '../server/asset-origin.js';
import { assetConfig, loadConfig, ConfigError } from '../server/config.js';

const BUILD = '0123456789abcdef';
const ORIGIN = 'https://hh.example.app';
const quiet = { info() {}, warn() {}, error() {}, log() {} };
const answer = (status, acao = '*') => ({ status, headers: { get: (h) => (h.toLowerCase() === 'access-control-allow-origin' ? acao : null) } });
const req = ({ host = 'farm.example.net', cookie = 'hh_sri=1', assets } = {}) => ({ headers: { host, cookie }, query: assets ? { assets } : {} });

function origin(replies, extra = {}) {
  const asked = [];
  let clock = 1000;
  const o = new AssetOrigin({ origin: ORIGIN, build: BUILD, log: quiet, now: () => clock, ...extra,
    fetcher: async (url, init) => {
      asked.push([url, init.method]);
      const r = typeof replies === 'function' ? replies(asked.length) : replies;
      if (r instanceof Error) throw r;
      return r;
    } });
  return { o, asked, tick: (ms) => { clock += ms; } };
}

test('handshake: HEAD <host>/b/<build>/public/js/main.js; 200 + ACAO = match, 404 = mismatch, the rest = down', async () => {
  for (const [reply, want] of [[answer(200), 'match'], [answer(404), 'mismatch'], [answer(200, null), 'down'], [answer(500), 'down'],
    [new Error('ECONNREFUSED'), 'down'], [answer(301), 'down']]) {
    const { o, asked } = origin(reply);
    assert.equal(o.state, 'unknown');
    assert.equal(await o.check(), want);
    assert.deepEqual(asked, [[`${ORIGIN}/b/${BUILD}/public/js/main.js`, 'HEAD']]);
    assert.ok(o.status.checkedAt > 0);
  }
});

test('handshake: a probe that hangs times out as down', async () => {
  const o = new AssetOrigin({ origin: ORIGIN, build: BUILD, log: quiet, timeoutMs: 50,
    fetcher: (_u, init) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  assert.equal(await o.check(), 'down');
});

test('handshake: asked again every everyMs, never once for the process lifetime; concurrent checks share one request', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { o, asked } = origin((n) => answer(n === 1 ? 200 : 404), { everyMs: 60_000 });
  await o.start();
  assert.equal(o.state, 'match');
  await Promise.all([o.check(), o.check()]);
  assert.equal(asked.length, 2, 'two concurrent checks, one request');
  t.mock.timers.tick(60_000);
  await new Promise((r) => setImmediate(r));
  assert.equal(asked.length, 3);
  assert.equal(o.state, 'mismatch', 'the host moved to another build: the next page is self');
  o.stop();
});

test('baseFor: the host only for a public name, a matching build, the support cookie and no fallback marker', async () => {
  const { o } = origin(answer(200));
  assert.equal(o.baseFor(req()), null, 'unknown state: self');
  await o.check();
  assert.equal(o.baseFor(req()), `${ORIGIN}/b/${BUILD}`);
  assert.equal(o.baseFor(req({ cookie: '' })), null, 'no proof of import-map integrity: self (the support rule)');
  assert.equal(o.baseFor(req({ cookie: 'hh_sri=0' })), null);
  for (const host of ['localhost:3300', '127.0.0.1:3300', '192.168.1.20:3300', '10.0.0.4', '172.20.1.1', '100.101.102.103:3300',
    '169.254.1.1', 'farm.local:3300', 'farmbox', '[::1]:3300', '[fd7a:115c::1]:3300', '[fe80::1]']) {
    assert.equal(o.baseFor(req({ host })), null, `${host} stays self`);
  }
  assert.equal(o.baseFor(req({ host: '192.168.1.20:3300', assets: 'cloud' })), `${ORIGIN}/b/${BUILD}`, '?assets=cloud on a LAN name');
  assert.equal(o.baseFor(req({ host: '100.99.1.1' })), null, 'inside 100.64/10: Tailscale-direct');
});

test('baseFor: ?assets=self or the hh_assets=self cookie is self and re-checks at once (at most every RECHECK_MS)', async () => {
  const { o, asked, tick } = origin(answer(200));
  await o.check();
  assert.equal(asked.length, 1);
  assert.equal(o.baseFor(req({ assets: 'self' })), null);
  await new Promise((r) => setImmediate(r));
  assert.equal(asked.length, 2, 'a browser that just fell back is a fresh sign of a stale handshake');
  assert.equal(o.baseFor(req({ cookie: 'hh_sri=1; hh_assets=self' })), null);
  await new Promise((r) => setImmediate(r));
  assert.equal(asked.length, 2, 'not again within RECHECK_MS');
  tick(RECHECK_MS);
  o.baseFor(req({ cookie: 'hh_assets=self' }));
  await new Promise((r) => setImmediate(r));
  assert.equal(asked.length, 3);
});

test('isLocalHost and cookieOf', () => {
  assert.equal(isLocalHost('hh-farm.tail1234.ts.net'), false, 'the Funnel name is public');
  assert.equal(isLocalHost('farm.example.net:443'), false);
  assert.equal(isLocalHost('100.63.0.1'), false, '100.63 is not Tailscale');
  assert.equal(isLocalHost('100.128.0.1'), false);
  assert.equal(isLocalHost('100.64.0.1'), true);
  assert.equal(isLocalHost(''), true, 'no Host header: never a browser on the internet');
  assert.equal(cookieOf({ headers: { cookie: 'a=1; hh_sri=1;hh_assets=self' } }, 'hh_assets'), 'self');
  assert.equal(cookieOf({ headers: {} }, 'hh_sri'), null);
});

test('config: HH_ASSET_ORIGIN is an https origin only; probe for tests only; the kill switch; the check interval', () => {
  assert.deepEqual(assetConfig({}), { origin: null, probe: null, checkMs: 60_000, timeoutMs: 4000, host: true });
  assert.equal(loadConfig({}).assets.origin, null, 'unset: exactly today (every file from this server)');
  assert.equal(assetConfig({ HH_ASSET_ORIGIN: 'https://hh.example.app/' }).origin, 'https://hh.example.app');
  assert.equal(assetConfig({ HH_ASSET_ORIGIN: 'https://hh.example.app:8443' }).origin, 'https://hh.example.app:8443');
  for (const bad of ['https://hh.example.app/b', 'https://hh.example.app/?x=1', 'https://hh.example.app/#a', 'https://u:p@hh.example.app',
    'http://hh.example.app', 'ftp://hh.example.app', 'hh.example.app', 'http://127.0.0.1:4510']) {
    assert.throws(() => assetConfig({ HH_ASSET_ORIGIN: bad }), ConfigError, bad);
  }
  assert.equal(assetConfig({ HH_ASSET_ORIGIN: 'http://cloud.test:4511', HH_DEV: '1' }).origin, 'http://cloud.test:4511', 'the e2e lab');
  assert.equal(assetConfig({ HH_ASSET_ORIGIN: 'http://127.0.0.1:4510', HH_DEV: '1' }).origin, 'http://127.0.0.1:4510');
  const lab = assetConfig({ HH_ASSET_ORIGIN: 'http://cloud.test:4511', HH_ASSET_PROBE: 'http://127.0.0.1:4510', HH_DEV: '1' });
  assert.equal(lab.probe, 'http://127.0.0.1:4510');
  assert.throws(() => assetConfig({ HH_ASSET_ORIGIN: 'https://h.app', HH_ASSET_PROBE: 'http://127.0.0.1:1', NODE_ENV: 'production' }), /tests only/);
  assert.throws(() => assetConfig({ HH_ASSET_PROBE: 'http://127.0.0.1:1' }), /needs HH_ASSET_ORIGIN/);
  assert.equal(assetConfig({ HH_ASSET_HOST: 'off' }).host, false);
  assert.throws(() => assetConfig({ HH_ASSET_HOST: 'no' }), ConfigError);
  assert.equal(assetConfig({ HH_ASSET_CHECK_MS: '5000' }).checkMs, 5000);
  assert.throws(() => assetConfig({ HH_ASSET_CHECK_MS: '4999' }), ConfigError);
});
