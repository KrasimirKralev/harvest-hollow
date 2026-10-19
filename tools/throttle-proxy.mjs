#!/usr/bin/env node
// A TCP relay that models one slow shared link (release 1.0, infra; from the option-2 audit's prototype): the Farmbox
// over Tailscale Funnel (85 KB/s, 100 ms RTT) or the public host (550 KB/s, 60 ms RTT). Every connection's downstream
// bytes share ONE budget, served round-robin between the connections with data waiting (several TCP flows through one
// bottleneck, about what an HTTP/2 scheduler does), and every chunk waits half the RTT each way. Upstream is delayed
// and limited the same way. It counts bytes and connections (the "bytes over the Farmbox link" of the budget), can be
// held silent (no FIN, no RST: a phone that changed networks) and reset.
//
//   node tools/throttle-proxy.mjs <listenPort> <targetPort> <KB/s> <rttMs> [--stats <file>]
//   import { startThrottle } from './throttle-proxy.mjs'
//     startThrottle({ listen, target, kbps = 85, rttMs = 100, host = '127.0.0.1' })
//       -> Promise<{ counters: { conns, down, up }, reset(), hold(on), stop() }>
// KB = 1024 bytes. A rate of 0 means unthrottled (the RTT still applies).
import net from 'node:net';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const TICK_MS = 10;

/** One direction of the link: queues per connection, a shared byte budget per tick, round-robin. */
function makeLink(bytesPerSec, halfRtt, isHeld) {
  const queues = new Set();
  let carry = 0;
  const per = bytesPerSec > 0 ? (bytesPerSec * TICK_MS) / 1000 : Infinity;
  const timer = setInterval(() => {
    if (isHeld()) return;                       // a silent link: nothing moves, nothing closes
    let budget = per + carry;
    carry = 0;
    while (budget >= 1 && queues.size) {
      const share = Number.isFinite(budget) ? Math.max(1, Math.floor(budget / queues.size)) : Infinity;
      for (const q of [...queues]) {
        let take = Math.min(share, q.len, Number.isFinite(budget) ? Math.floor(budget) : Infinity);
        if (take <= 0) continue;
        budget -= take;
        const parts = [];
        while (take > 0) {
          const b = q.bufs[0];
          if (b.length <= take) { parts.push(b); q.bufs.shift(); take -= b.length; q.len -= b.length; }
          else { parts.push(b.subarray(0, take)); q.bufs[0] = b.subarray(take); q.len -= take; take = 0; }
        }
        const chunk = Buffer.concat(parts);
        setTimeout(() => q.out(chunk), halfRtt);
        if (q.len === 0) queues.delete(q);
        if (budget < 1) break;
      }
      if (!Number.isFinite(budget)) break;
    }
    carry = Number.isFinite(per) ? Math.min(budget, per) : 0;
  }, TICK_MS);
  timer.unref?.();
  return {
    queue(out) { return { bufs: [], len: 0, out }; },
    push(q, buf) { q.bufs.push(buf); q.len += buf.length; queues.add(q); },
    forget(q) { queues.delete(q); },
    stop() { clearInterval(timer); },
  };
}

/**
 * Start a relay on `listen` that forwards to `target` (both on `host`) through one shared link.
 * @returns {Promise<{ port: number, counters: { conns: number, down: number, up: number }, reset: () => void,
 *   hold: (on: boolean) => void, stop: () => Promise<void> }>}
 */
export function startThrottle({ listen, target, kbps = 85, rttMs = 100, host = '127.0.0.1' }) {
  const counters = { conns: 0, down: 0, up: 0 };
  let held = false;
  const half = Number(rttMs) / 2;
  const down = makeLink(Number(kbps) * 1024, half, () => held);
  const up = makeLink(Number(kbps) * 1024, half, () => held);
  const sockets = new Set();
  const server = net.createServer((client) => {
    counters.conns++;
    const server2 = net.connect(Number(target), host);
    sockets.add(client); sockets.add(server2);
    let closed = false;
    const qd = down.queue((b) => { counters.down += b.length; if (!client.destroyed) client.write(b); });
    const qu = up.queue((b) => { counters.up += b.length; if (!server2.destroyed) server2.write(b); });
    server2.on('data', (b) => down.push(qd, b));
    client.on('data', (b) => up.push(qu, b));
    const end = () => {
      if (closed) return;
      closed = true;
      // the bytes already on the link still arrive before the close (a FIN follows the data)
      const wait = () => (held || qd.len || qu.len ? setTimeout(wait, 20)
        : setTimeout(() => { client.destroy(); server2.destroy(); sockets.delete(client); sockets.delete(server2); }, half + 20));
      wait();
    };
    server2.on('end', end); client.on('end', end);
    server2.on('error', end); client.on('error', end);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(listen), host, () => resolve({
      port: server.address().port,
      counters,
      reset() { counters.conns = 0; counters.down = 0; counters.up = 0; },
      hold(on) { held = Boolean(on); },
      /** Cut every open connection at once (a host that went away), the listener stays. */
      cut() { for (const s of sockets) s.destroy(); sockets.clear(); },
      stop() {
        down.stop(); up.stop();
        for (const s of sockets) s.destroy();
        return new Promise((r) => server.close(() => r()));
      },
    }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [listen, target, kbps, rtt] = process.argv.slice(2);
  const si = process.argv.indexOf('--stats');
  const statsFile = si > 0 ? process.argv[si + 1] : null;
  if (!listen || !target) {
    console.error('usage: node tools/throttle-proxy.mjs <listenPort> <targetPort> <KB/s> <rttMs> [--stats <file>]');
    process.exit(2);
  }
  const t = await startThrottle({ listen, target, kbps: Number(kbps ?? 85), rttMs: Number(rtt ?? 100) });
  console.log(`throttle :${t.port} -> :${target} at ${kbps ?? 85} KB/s, rtt ${rtt ?? 100} ms (SIGUSR2 resets the counters)`);
  process.on('SIGUSR2', () => t.reset());
  if (statsFile) setInterval(() => fs.writeFileSync(statsFile, JSON.stringify(t.counters)), 1000).unref();
  const bye = async () => { await t.stop(); process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
