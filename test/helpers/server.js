// Server-lane test helpers (common.md: lane helpers live in test/helpers/<lane>.js and import test/helpers.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, testServer, wsClient, join, tmpDataDir, plain, fakeClock, T0 } from '../helpers.js';
import { PROTOCOL_VERSION } from '../../shared/net/protocol.js';
import { createFarm } from '../../shared/rules/state.js';
import { runAction, makeCtx, SERVER_GRACE_MS } from '../../shared/rules/index.js';
import { levelRow } from '../../shared/content/index.js';
import { canPlace } from '../../shared/rules/grid.js';
import { resetGrid } from '../../shared/rules/grid-cache.js';

export { ROOT, testServer, wsClient, join, tmpDataDir, plain, fakeClock, T0 };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const quiet = { log() {}, info() {}, warn() {}, error() {} };

/** A logger that records lines: { lines, log } */
export function recorder() {
  const lines = [];
  const rec = (level) => (...a) => lines.push([level, ...a.map((x) => (x instanceof Error ? x.message : x))]);
  return { lines, log: { log: rec('info'), info: rec('info'), warn: rec('warn'), error: rec('error') } };
}

/**
 * A fake ws for Outbox/Sessions unit tests: records sent frames, settable bufferedAmount, cork/uncork counts.
 */
export function fakeWs() {
  const ws = {
    readyState: 1, bufferedAmount: 0, sent: [], closed: null, terminated: false, corks: 0,
    _socket: { cork() { ws.corks++; }, uncork() {} },
    send(s) { ws.sent.push(s); },
    close(code, reason) { ws.closed = { code, reason }; ws.readyState = 2; },
    terminate() { ws.terminated = true; ws.readyState = 3; },
    ping() {},
    frames() { return ws.sent.map((s) => JSON.parse(s)); },
  };
  return ws;
}

/** Every journal line on disk (all journal files), sorted by v. */
export function readJournal(dir) {
  const out = new Map();
  for (const f of fs.readdirSync(dir).filter((n) => /^farm\.journal.*\.jsonl$/.test(n))) {
    for (const row of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!row.trim()) continue;
      try { const l = JSON.parse(row); if (!out.has(l.v)) out.set(l.v, l); } catch { /* torn */ }
    }
  }
  return [...out.values()].sort((a, b) => a.v - b.v);
}

/** Spawn `node server/index.js` on a free port with a data dir; resolves { child, port, log, exit }. */
export function spawnServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    env: { ...process.env, PORT: '0', HH_HOST: '127.0.0.1', HH_DATA_DIR: dataDir, HH_DEV: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const exit = new Promise((r) => child.once('exit', (code) => r(code)));
  const port = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      out += d;
      const m = /http:\/\/localhost:(\d+)/.exec(out);
      if (m) resolve(Number(m[1]));
    });
    child.stderr.on('data', (d) => { out += d; });
    exit.then((code) => reject(new Error(`server exited ${code}: ${out}`)));
  });
  port.catch(() => {});
  return { child, port, exit, log: () => out };
}

/** hello with an existing token on a new socket; resolves { c, w }. */
export async function resume(port, token, cid) {
  const c = await wsClient(port);
  c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid, token });
  const w = await c.next((m) => m.t === 'welcome' || m.t === 'deny');
  return { c, w };
}

/** A raw hello with any claim; resolves the first welcome/deny/slots. */
export async function hello(port, fields) {
  const c = await wsClient(port);
  c.send({ t: 'hello', proto: PROTOCOL_VERSION, ...fields });
  const w = await c.next((m) => m.t === 'welcome' || m.t === 'deny' || m.t === 'slots');
  return { c, w };
}

/**
 * Write a save as a running server would have left it (farm.json only, no journal): `players` joined with known
 * tokens, the farm at `level`, `place` defs placed by p1, then `edit(state, server, ids)` for anything else (bench
 * seats, dedupe records). Returns { dir, tokens, ids }. The server clock starts at `now` (game time = wall time).
 */
export function writeSave({ dir = tmpDataDir('save'), now = Date.now(), level = 12, coins = 100_000, place = [],
  players = { p1: 'Rowan', p2: 'Mia' }, tz = 'Europe/Sofia', edit = null } = {}) {
  const state = createFarm(4242, now, tz);
  let seq = 0;
  const run = (pid, type, args) => {
    const ctx = makeCtx(state, { now, pid, cid: pid === 'sys' ? 'sys' : 'fixtur', seq: pid === 'sys' ? state.meta.version + 1 : ++seq,
      grace: SERVER_GRACE_MS });
    const r = runAction(state, { type, args }, ctx);
    if (!r.ok) throw new Error(`${type}: ${r.code} ${r.err ? r.err.stack : ''}`);
    state.meta.version += 1;
  };
  for (const [pid, name] of Object.entries(players)) run('sys', '_join', { pid, name });
  state.farm.xp = levelRow(level).xp;
  state.farm.wallet.coins = coins;
  const ids = {};
  for (const def of place) {
    resetGrid(state);
    let spot = null;
    for (let z = 4; z < 60 && !spot; z++) for (let x = 4; x < 60 && !spot; x++) if (canPlace(state, def, x, z, 0) === null) spot = [x, z];
    run('p1', 'place', { def, x: spot[0], z: spot[1], rot: 0, confirm: ['BIG_SPEND'] });
    ids[def] = Object.keys(state.farm.objects).find((id) => state.farm.objects[id].def === def
      && state.farm.objects[id].x === spot[0] && state.farm.objects[id].z === spot[1]);
  }
  const tokens = {};
  const auth = {};
  for (const pid of Object.keys(players)) {
    tokens[pid] = crypto.randomBytes(32).toString('hex');
    auth[pid] = { tokenHash: crypto.createHash('sha256').update(tokens[pid]).digest('hex') };
  }
  const server = { clock: { lastNow: now, devOffset: 0 }, clients: {}, auth };
  if (edit) edit(state, server, ids);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'farm.json'), JSON.stringify({ schema: state.schema, savedAt: now, version: state.meta.version, state, server }));
  return { dir, tokens, ids };
}
