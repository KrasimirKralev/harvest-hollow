// O5 (release 1.0, option2#11): both servers compress big WebSocket frames (the welcome, resyncs), so a boot over the
// Funnel moves ~29 KB instead of ~153 KB for the owners' farm; the welcome still round-trips exactly, and small frames
// keep working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PROTOCOL_VERSION, MSG } from '../shared/net/protocol.js';
import { testServer, tmpDataDir } from './helpers/server.js';
import { loadConfig, multiConfig } from '../server/config.js';
import { WS_DEFLATE } from '../server/http.js';

/** A ws client that counts the bytes it read off the wire (compressed frames + framing). */
async function client(url) {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(url);
  const msgs = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    for (const x of m.t === 'b' ? m.list : [m]) msgs.push({ m: x, len: Buffer.byteLength(JSON.stringify(x)) });
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const next = async (pred, ms = 5000) => {
    const t0 = Date.now();
    for (;;) {
      const hit = msgs.find((x) => pred(x.m));
      if (hit) return hit;
      if (Date.now() - t0 > ms) throw new Error(`timeout; got ${msgs.map((x) => x.m.t).join(',')}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  return { ws, next, send: (m) => ws.send(JSON.stringify(m)), wire: () => ws._socket.bytesRead };
}

test('O5: the setting: frames of 8 KB and more, a small window, two at once', () => {
  assert.equal(WS_DEFLATE.threshold, 8192);
  assert.equal(WS_DEFLATE.concurrencyLimit, 2);
  assert.equal(WS_DEFLATE.serverMaxWindowBits, 13);
  assert.deepEqual({ ...WS_DEFLATE.zlibDeflateOptions }, { level: 6, memLevel: 7 });
});

test('O5: single mode: the welcome is compressed on the wire and round-trips exactly; a pong still answers', async () => {
  const s = await testServer();
  try {
    const c = await client(`ws://127.0.0.1:${s.port}/ws`);
    assert.match(c.ws.extensions, /permessage-deflate/, 'deflate negotiated');
    c.send({ t: MSG.HELLO, proto: PROTOCOL_VERSION, cid: 'dfl001', claim: { slot: 'p1', name: 'Rowan' } });
    const w = await c.next((m) => m.t === MSG.WELCOME);
    assert.ok(w.len > 8192, `a big welcome (${w.len} B)`);
    assert.equal(w.m.pid, 'p1');
    assert.deepEqual(w.m.state.farm.objects, s.hh.engine.state.farm.objects, 'the farm arrives exactly');
    assert.ok(c.wire() < w.len * 0.5, `compressed on the wire: ${c.wire()} B read for a ${w.len} B welcome`);
    c.send({ t: MSG.PING, c: 1 });
    const p = await c.next((m) => m.t === MSG.PONG);
    assert.equal(p.m.c, 1);
    c.ws.close();
  } finally {
    await s.close();
  }
});

test('O5: multi mode: a farm\'s welcome is compressed too', async () => {
  const { startServer } = await import('../server/index.js');
  const dataDir = tmpDataDir('dfl');
  const s = await startServer({ ...loadConfig({}), mode: 'multi', multi: { ...multiConfig({}), starsUrl: null }, port: 0, host: '127.0.0.1',
    dataDir, quiet: true, dev: true, awayGraceMs: 0 });
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/farms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const { id, secret } = await r.json();
    const c = await client(`ws://127.0.0.1:${s.port}/ws?farm=${id}`);
    assert.match(c.ws.extensions, /permessage-deflate/);
    c.send({ t: MSG.HELLO, proto: PROTOCOL_VERSION, cid: 'dfl002', token: secret, claim: { slot: 'p1', name: 'Rowan' } });
    const w = await c.next((m) => m.t === MSG.WELCOME);
    assert.ok(w.len > 8192);
    assert.ok(c.wire() < w.len * 0.5, `compressed: ${c.wire()} B for ${w.len} B`);
    c.ws.close();
  } finally {
    await s.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
