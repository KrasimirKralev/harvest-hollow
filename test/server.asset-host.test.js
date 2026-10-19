// Option 2's guard on the public host (option2#D11 test 1, the curl matrix of option2#9; release 1.0 O1): only this
// build's static files under /b/<build>/, in the repo's own layout, with CORS, CORP, Timing-Allow-Origin and a year
// of immutability; 404 no-store for anything else under /b/; CORS on static files ONLY (never the page, the API, a farm
// page or an unversioned file); versioned packs keep their content version at the root with the same headers; Range
// works; HH_ASSET_HOST=off (the kill switch) answers 404 for all of /b/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { testServer, tmpDataDir, ROOT } from './helpers/server.js';
import { loadConfig, multiConfig } from '../server/config.js';

function req(port, p, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { origin: 'https://farm.example.net', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, h: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
const firstOgg = () => fs.readdirSync(path.join(ROOT, 'public/assets/audio')).find((n) => n.endsWith('.ogg'));
const firstFont = () => fs.readdirSync(path.join(ROOT, 'public/assets/fonts')).find((n) => n.endsWith('.woff2'));

async function matrix(port, build, packs) {
  const B = `/b/${build}`;
  for (const p of [`${B}/public/js/main.js`, `${B}/shared/content/index.js`, `${B}/vendor/three/build/three.module.js`,
    `${B}/public/assets/fonts/${firstFont()}`, `${B}/public/css/style.css`, `${B}/public/assets/models/manifest.json`]) {
    for (const method of ['GET', 'HEAD']) {
      const r = await req(port, p, { method, headers: { 'accept-encoding': 'gzip' } });
      assert.equal(r.status, 200, `${method} ${p}`);
      assert.equal(r.h['access-control-allow-origin'], '*', p);
      assert.equal(r.h['cross-origin-resource-policy'], 'cross-origin', p);
      assert.equal(r.h['timing-allow-origin'], '*', p);
      assert.equal(r.h['cache-control'], IMMUTABLE, p);
    }
  }
  const js = await req(port, `${B}/public/js/main.js`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(js.h['content-encoding'], 'gzip', 'the gzip path keeps the guard headers');
  assert.match(js.h['content-type'], /javascript/);
  const same = await req(port, '/js/main.js', { headers: { 'accept-encoding': 'identity' } });
  const plain = await req(port, `${B}/public/js/main.js`, { headers: { 'accept-encoding': 'identity' } });
  assert.deepEqual(plain.body, same.body, 'the same bytes as the root file');
  for (const p of [`/b/fedcba9876543210/public/js/main.js`, `${B}/public/index.html`, `${B}/public/landing.html`, `${B}/api/status`,
    `${B}/server/app.js`, `${B}/public/../server/app.js`, `${B}/public/js/../../server/app.js`, `${B}/public/js/%2e%2e/%2e%2e/server/app.js`,
    `${B}/public/js/nope.js`, `${B}/package.json`, `${B}/js/main.js`, `/b/${build.slice(0, 8)}/public/js/main.js`, `${B}/node_modules/three/package.json`,
    `${B}/public/assets/../../data/farm.json`, '/b/']) {
    const r = await req(port, p);
    assert.equal(r.status, 404, p);
    assert.equal(r.h['cache-control'], 'no-store', p);
  }
  const post = await req(port, `${B}/public/js/main.js`, { method: 'POST' });
  assert.equal(post.status, 404, 'only GET and HEAD');
  const pre = await req(port, `${B}/public/js/main.js`, { method: 'OPTIONS', headers: { 'access-control-request-method': 'GET' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.h['access-control-allow-origin'], '*');
  assert.match(pre.h['access-control-allow-methods'], /GET, HEAD/);
  // CORS on static files only
  for (const p of ['/api/status', '/', '/js/main.js', '/assets/models/manifest.json', '/sri-probe']) {
    const r = await req(port, p);
    assert.notEqual(r.status, 404, p);
    assert.equal(r.h['access-control-allow-origin'], undefined, `no CORS on ${p}`);
  }
  // packs: their own content version at the root (cached across deploys), the same three headers; unversioned: none
  const [id, entry] = Object.entries(packs)[0];
  const pk = await req(port, `/assets/packs/${id}.bin?v=${entry.v}`);
  assert.equal(pk.status, 200);
  assert.equal(pk.h['access-control-allow-origin'], '*');
  assert.equal(pk.h['cache-control'], IMMUTABLE);
  const old = await req(port, `/assets/packs/${id}.bin?v=000000000000`);
  assert.equal(old.status, 404, 'another content version');
  assert.equal(old.h['access-control-allow-origin'], '*', 'readable as a 404 by the page (the loader falls back)');
  const bare = await req(port, `/assets/packs/${id}.bin`);
  assert.equal(bare.h['access-control-allow-origin'], undefined, 'an unversioned pack is this server\'s own business');
  // media: Range answers 206 with CORS (the music decks stream)
  const ogg = firstOgg();
  const range = await req(port, `${B}/public/assets/audio/${ogg}`, { headers: { range: 'bytes=0-99' } });
  assert.equal(range.status, 206);
  assert.equal(range.body.length, 100);
  assert.equal(range.h['access-control-allow-origin'], '*');
  assert.match(range.h['content-range'], /^bytes 0-99\//);
}

const packsOf = async (port) => {
  const html = (await req(port, '/', { headers: { 'accept-encoding': 'identity' } })).body.toString();
  return JSON.parse(/<script type="application\/json" id="hh-packs">([\s\S]*?)<\/script>/.exec(html)[1]);
};

test('the /b/ guard on a single-mode server (the Farmbox serves the same files, for tests and the kill switch)', async () => {
  const s = await testServer();
  try {
    await matrix(s.port, s.hh.static.build, await packsOf(s.port));
  } finally {
    await s.close();
  }
});

test('the /b/ guard on the multi-farm host: farm pages, the landing page and /privacy carry no CORS', async () => {
  const { startServer } = await import('../server/index.js');
  const dataDir = tmpDataDir('bhost');
  const s = await startServer({ ...loadConfig({}), mode: 'multi', multi: { ...multiConfig({}), starsUrl: null }, port: 0, host: '127.0.0.1',
    dataDir, quiet: true, dev: true });
  try {
    const build = s.hh.static.build;
    const r = await req(s.port, `/b/${build}/public/js/main.js`, { method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.equal(r.h['access-control-allow-origin'], '*');
    for (const p of ['/', '/privacy', '/f/abcdefghjk', '/api/status', '/api/stars']) {
      const x = await req(s.port, p);
      assert.equal(x.h['access-control-allow-origin'], undefined, `no CORS on ${p}`);
    }
    const page = (await req(s.port, '/f/abcdefghjk', { headers: { 'accept-encoding': 'identity' } })).body.toString();
    assert.doesNotMatch(page, /hh-assets|integrity=/, 'the host serves its own farms from itself');
  } finally {
    await s.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('HH_ASSET_HOST=off: every /b/ answer is 404 no-store, so every Farmbox\'s handshake says mismatch', async () => {
  const s = await testServer({ assets: { ...loadConfig({}).assets, host: false } });
  try {
    const r = await req(s.port, `/b/${s.hh.static.build}/public/js/main.js`, { method: 'HEAD' });
    assert.equal(r.status, 404);
    assert.equal(r.h['cache-control'], 'no-store');
    assert.equal((await req(s.port, '/js/main.js')).status, 200, 'the server itself is unchanged');
  } finally {
    await s.close();
  }
});
