// The stdio MCP bridge Claude Code runs (server/agent/mcp-bridge.mjs) and the agent config knobs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { agentConfig, AgentConfigError } from '../server/agent/config.js';
import { ROOT } from './helpers.js';

const BRIDGE = path.join(ROOT, 'server', 'agent', 'mcp-bridge.mjs');

function startBridge(env) {
  const child = spawn(process.execPath, [BRIDGE], { env: { PATH: '/usr/bin:/bin', ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  const lines = [];
  readline.createInterface({ input: child.stdout }).on('line', (l) => {
    lines.push(l);
    const m = JSON.parse(l);
    const w = waiting.get(m.id);
    if (w) { waiting.delete(m.id); w(m); }
  });
  let id = 0;
  const call = (method, params) => new Promise((resolve) => {
    const n = ++id;
    waiting.set(n, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
  });
  return { child, call, lines, end: () => new Promise((r) => { child.on('exit', r); child.stdin.end(); }) };
}

test('bridge: initialize, tools/list, tools/call forwards with the token; errors are JSON-RPC errors', async (t) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, errors: [] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const token = 'ab'.repeat(32);
  const b = startBridge({ HH_AGENT_URL: `http://127.0.0.1:${server.address().port}/internal/agent/0123456789abcdef`, HH_AGENT_TOKEN: token });
  const init = await b.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  const list = await b.call('tools/list', {});
  assert.deepEqual(list.result.tools.map((x) => x.name), ['validate', 'preview']);
  const v = await b.call('tools/call', { name: 'validate', arguments: {} });
  assert.deepEqual(JSON.parse(v.result.content[0].text), { ok: true, errors: [] });
  assert.equal(v.result.isError, false);
  assert.deepEqual(seen[0], { url: '/internal/agent/0123456789abcdef/validate', auth: `Bearer ${token}`, body: '{}' });
  assert.equal((await b.call('tools/call', { name: 'write_file', arguments: {} })).error.code, -32602);
  assert.equal((await b.call('resources/list', {})).error.code, -32601);
  assert.deepEqual((await b.call('ping', {})).result, {});
  await b.end();
});

test('bridge: a bad URL or token is refused locally (no request leaves)', async () => {
  const b = startBridge({ HH_AGENT_URL: 'http://evil.example/internal/agent/0123456789abcdef', HH_AGENT_TOKEN: 'x' });
  await b.call('initialize', {});
  const v = await b.call('tools/call', { name: 'preview', arguments: {} });
  assert.equal(v.result.isError, true);
  assert.match(v.result.content[0].text, /UNAVAILABLE/);
  await b.end();
});

test('config: defaults, the mock is refused in production, bad numbers refuse the boot', () => {
  const c = agentConfig({});
  assert.equal(c.enabled, true);
  assert.equal(c.mock, false);
  assert.equal(c.timeoutMs, 600_000);
  assert.equal(c.idleMs, 120_000);
  assert.equal(c.jobsPerHour, 10);
  assert.equal(c.jobsPerDay, 30);
  assert.equal(c.openaiAuthBase, 'https://auth.openai.com');
  assert.equal(c.openaiApiBase, 'https://api.openai.com/v1');
  assert.equal(c.claudeHosting, false);
  assert.equal(agentConfig({ HH_HARNESS: 'off' }).enabled, false);
  assert.throws(() => agentConfig({ HH_HARNESS_MOCK: '1', NODE_ENV: 'production' }), AgentConfigError);
  assert.throws(() => agentConfig({ HH_AGENT_TIMEOUT_MS: 'soon' }), AgentConfigError);
  assert.throws(() => agentConfig({ HH_OPENAI_AUTH_BASE: 'ftp://x' }), AgentConfigError);
  assert.deepEqual(agentConfig({ HTTPS_PROXY: 'http://p:1', SECRET: 'x' }).proxy, { HTTPS_PROXY: 'http://p:1' });
});
