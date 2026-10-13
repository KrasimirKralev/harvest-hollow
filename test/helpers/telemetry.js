// Telemetry-lane test helpers: a stand-in receiver (records every request; answers a scripted status), a HarnessCtx
// like server/harness/index.js builds, and an express app on port 0. No test ever talks to a real host.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { tmpDataDir, fakeClock, T0 } from '../helpers.js';
import { telemetryConfig } from '../../server/telemetry/config.js';
import { createTelemetry } from '../../server/telemetry/index.js';

export { tmpDataDir, fakeClock, T0 };
export const quiet = { log() {}, info() {}, warn() {}, error() {} };

/**
 * A stand-in for the receiving host: `requests` holds { method, url, headers, body } of every request; `answer` is a
 * status (or a function of the request) and `headers` extra answer headers.
 */
export async function mockReceiver({ answer = 202, headers = {} } = {}) {
  const m = { requests: [], answer, headers };
  m.server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const r = { method: req.method, url: req.url, headers: req.headers, body };
      m.requests.push(r);
      const st = typeof m.answer === 'function' ? m.answer(r) : m.answer;
      res.writeHead(st, { 'content-type': 'application/json', ...m.headers });
      res.end(JSON.stringify(st < 300 ? { ok: true } : { error: 'X' }));
    });
  });
  await new Promise((r) => m.server.listen(0, '127.0.0.1', r));
  m.url = `http://127.0.0.1:${m.server.address().port}/api/telemetry`;
  m.close = () => new Promise((r) => { m.server.closeAllConnections?.(); m.server.close(() => r()); });
  m.bodies = () => m.requests.map((r) => JSON.parse(r.body));
  return m;
}

/** An express app listening on port 0: { app, base, close }. `mount(app)` adds the routes before it listens. */
export async function appServer(mount) {
  const app = express();
  await mount(app);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { app, server, base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}

/**
 * A HarnessCtx for createTelemetry: H(fk) and HD under `dir` as the contract lays them out; auth reads the test-only
 * headers x-test-farm / x-test-pid (a real request is authenticated by server/harness/index.js).
 */
export function harnessCtx(dir, { mode = 'single', env = {}, clock = fakeClock(T0), fetcher, extra = {} } = {}) {
  const dirOf = (fk) => (fk === 'local' ? path.join(dir, 'harness') : path.join(dir, 'farms', fk, 'harness'));
  return {
    cfg: { version: '0.1.0', dataDir: dir, telemetry: telemetryConfig(env), ...(extra.cfg || {}) },
    log: quiet,
    mode,
    wall: () => clock.now(),
    fetcher,
    hostDir: path.join(dir, 'harness-host'),
    dirOf,
    async auth(req) {
      const pid = req.headers['x-test-pid'];
      if (!pid) throw { status: 401, error: 'AUTH' };
      return { farmKey: req.headers['x-test-farm'] || 'local', pid };
    },
    push() {},
    ...extra.ctx,
  };
}

/** createTelemetry over a fresh data dir: { t, dir, clock, ctx, cleanup }. */
export function telemetryFor(name, opts = {}) {
  const dir = tmpDataDir(name);
  const clock = opts.clock ?? fakeClock(T0);
  const ctx = harnessCtx(dir, { ...opts, clock });
  const t = createTelemetry(ctx);
  return { t, dir, clock, ctx, async cleanup() { await t.stop(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

/** A job as the agent runtime holds it (public fields AND private ones a careless caller might pass along). */
export function sampleJob(over = {}) {
  return {
    id: '9f2c0123456789ab', by: 'p1', provider: 'chatgpt', model: 'gpt-5.1', state: 'ready', step: 'ready', round: 2,
    startedAt: T0, updatedAt: T0 + 93_000, lang: 'bg',
    prompts: [{ at: T0, text: 'Add a moon melon that glows at night' }, { at: T0 + 60_000, text: 'Make it a bit faster to grow' }],
    progress: [{ at: T0, step: 'reading', note: 'reading the guide' }],
    result: {
      candidate: 8, parent: 7, summary: { en: 'Added Moon Melon.', bg: 'Добавих лунен пъпеш.' },
      changes: [{ op: 'add', family: 'crops', id: 'x_moon_melon', name: { en: 'Moon Melon', bg: 'Лунен пъпеш' }, icon: '/mods/abc/icons/64/x_moon_melon.png' }],
      validation: { ok: true, stage: 'done', full: true, ms: 8421, modHash: 'deadbeef', overlayHash: 'cafe1234',
        errors: [], warnings: [{ stage: 'semantic', code: 'BG_FORMS', file: 'content/crops/x_moon_melon.json', path: 'text.bg.def', message: 'x' }],
        checks: { boot: { ok: true } } },
    },
    error: null,
    ...over,
  };
}

export const SAMPLE_FILES = {
  'mod.json': { format: 1, title: { en: 'Moonlight Harvest', bg: 'Лунна жътва' } },
  'content/crops/x_moon_melon.json': { id: 'x_moon_melon', like: 'watermelon', growMin: 90, yield: 3, unlock: 14, value: 'normal',
    season: 'summer', classes: ['fruit'], hue: '#BFE3FF', text: { en: { name: 'Moon Melon' }, bg: { name: 'Лунен пъпеш', g: 'm' } } },
};
