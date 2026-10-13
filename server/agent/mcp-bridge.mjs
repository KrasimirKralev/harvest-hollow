#!/usr/bin/env node
// A minimal stdio MCP server (newline-delimited JSON-RPC 2.0; no SDK dependency) that gives Claude Code the two tools
// it cannot have as files: `validate` and `preview` (harness contract §5.2, §5.4). Each call is forwarded to the game
// server's loopback route POST /internal/agent/<jobId>/<tool> with the job's token, which only this process (through
// its env from private/mcp.json) knows; the model never sees it. Nothing is logged: stdout carries the protocol only.
//
//   env HH_AGENT_URL    http://127.0.0.1:<port>/internal/agent/<jobId>
//   env HH_AGENT_TOKEN  64 hex
import readline from 'node:readline';

const URL_BASE = process.env.HH_AGENT_URL || '';
const TOKEN = process.env.HH_AGENT_TOKEN || '';
const PROTOCOL = '2025-06-18';

export const TOOLS = [
  { name: 'validate', description: 'Check the mod in mod/: schema, meaning and a quick play test on a copy of the farm. '
      + 'Returns ok, errors (each with file, path, code, message, hint), warnings and the computed numbers. Fix every error and call it again.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'preview', description: 'What the player will see: the things added, changed or retired, with their names and numbers.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function callTool(name) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/internal\/agent\/[0-9a-f]{16}$/.test(URL_BASE) || !/^[0-9a-f]{64}$/.test(TOKEN)) {
    return { content: [{ type: 'text', text: '{"error":{"code":"UNAVAILABLE","message":"the game server is not reachable"}}' }], isError: true };
  }
  try {
    const res = await fetch(`${URL_BASE}/${name}`, { method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: '{}' });
    const text = await res.text();
    return { content: [{ type: 'text', text }], isError: !res.ok };
  } catch {
    return { content: [{ type: 'text', text: '{"error":{"code":"UNAVAILABLE","message":"the game server did not answer"}}' }], isError: true };
  }
}

async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    if (msg && msg.id !== undefined) error(msg.id ?? null, -32600, 'invalid request');
    return;
  }
  const { id, method, params } = msg;
  const isNote = id === undefined;
  switch (method) {
    case 'initialize':
      return reply(id, { protocolVersion: params && typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'hh', version: '1.0.0' } });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return undefined;
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params && params.name;
      if (!TOOLS.some((t) => t.name === name)) return error(id, -32602, 'unknown tool');
      return reply(id, await callTool(name));
    }
    default:
      if (!isNote) error(id, -32601, 'method not found');
      return undefined;
  }
}

const inflight = new Set();
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg = null;
  try { msg = JSON.parse(line); } catch { return error(null, -32700, 'parse error'); }
  const p = handle(msg).catch(() => { if (msg && msg.id !== undefined) error(msg.id, -32603, 'internal error'); });
  inflight.add(p);
  p.finally(() => inflight.delete(p));
  return undefined;
});
// stdin closed: answer what is in flight, then leave
rl.on('close', () => { Promise.allSettled([...inflight]).then(() => process.exit(0)); });
