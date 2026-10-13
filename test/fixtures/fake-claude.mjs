// A fake Claude Code binary for the agent lane's tests (harness contract §5.5): it prints --version / --help like the
// real CLI, keeps a fake login in $CLAUDE_CONFIG_DIR, relays a sign-in like `claude auth login` (prints a sign-in URL,
// waits for the pasted code), and for `-p --output-format stream-json` plays an agent: it starts the MCP servers of
// --mcp-config, writes a mod into ./mod, calls the bridge's `validate`, writes summary.json and prints stream-json.
// Tests reach it through a small shell wrapper that sets FAKE_CLAUDE_CONF (the server gives the binary a clean env).
//
// FAKE_CLAUDE_CONF JSON: { version?, help?: 'full' | 'unsafe' | 'norestricted' | 'noauth', tools?: [extra init tools], log?: dir }
// (every `auth login` appends its pid to <log>/logins.log, so a test can count the login processes)
// The request decides the scenario: "escape" writes outside mod/, "hang" never answers, "noresult" exits silently.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const conf = (() => {
  try { return JSON.parse(fs.readFileSync(process.env.FAKE_CLAUDE_CONF || '', 'utf8')); } catch { return {}; }
})();
const argv = process.argv.slice(2);
const out = (s) => process.stdout.write(s);
const cfgDir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '/tmp', '.claude');
const creds = path.join(cfgDir, '.credentials.json');

const HELP_FULL = `Usage: claude [options] [command] [prompt]

Claude Code - starts an interactive session by default, use -p/--print for
non-interactive output

Options:
  --allowedTools, --allowed-tools <tools...>  Tools to allow
  --append-system-prompt <prompt>       Append a system prompt
  --disable-slash-commands              Disable all skills
  --disallowedTools, --disallowed-tools <tools...>  Deny rules
  --mcp-config <configs...>             Load MCP servers
  --model <model>                       Model for the current session
  --no-session-persistence              Disable session persistence
  --output-format <format>              Output format (choices: "text", "json", "stream-json")
  --permission-mode <mode>              Permission mode (choices: "acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan")
  --permission-prompts <target>         Who answers permission prompts
  -p, --print                           Print response and exit
  --restricted                          Restricted mode
  --settings <file-or-json>             Path to a settings JSON file
  --strict-mcp-config                   Only use MCP servers from --mcp-config
  --tools <tools...>                    Specify the list of available tools
  --verbose                             Override verbose mode setting

Commands:
  auth                                  Manage authentication
  mcp                                   Configure and manage MCP servers
`;

function help() {
  let h = HELP_FULL;
  if (conf.help === 'unsafe') h = h.split('\n').filter((l) => !/--tools|--disallowedTools/.test(l)).join('\n');
  if (conf.help === 'norestricted') h = h.split('\n').filter((l) => !/--restricted/.test(l)).join('\n');
  if (conf.help === 'noauth') h = h.split('\n').filter((l) => !/^\s+auth\b/.test(l)).join('\n');
  return h;
}

function record(name, value) {
  if (!conf.log) return;
  try { fs.mkdirSync(conf.log, { recursive: true }); fs.writeFileSync(path.join(conf.log, name), JSON.stringify(value, null, 2)); } catch { /* test only */ }
}

const emit = (msg) => out(`${JSON.stringify(msg)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  record('login-env.json', Object.keys(process.env).sort());
  if (conf.log) { try { fs.mkdirSync(conf.log, { recursive: true }); fs.appendFileSync(path.join(conf.log, 'logins.log'), `${process.pid}\n`); } catch { /* test only */ } }
  out('Opening browser to sign in…\r\n');
  out('If the browser didn\'t open, visit: \x1b[4mhttps://claude.ai/oauth/authorize?code=true&client_id=fake-client&state=fake-state\x1b[0m\r\n');
  out('Paste code here if prompted > ');
  const rl = readline.createInterface({ input: process.stdin });
  const it = rl[Symbol.asyncIterator]();
  const first = await it.next();
  const code = String(first.value || '').trim();
  if (code !== 'good-code-123') { out('\r\nOAuth error: Invalid code\r\n'); process.exit(1); }
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(creds, JSON.stringify({ claudeAiOauth: { accessToken: 'FAKE-SECRET-DO-NOT-READ' } }), { mode: 0o600 });
  out('\r\nLogin successful. Press Enter to continue…\r\n');
  await Promise.race([it.next(), sleep(2000)]);
  process.exit(0);
}

function mcpClient(spec) {
  const child = spawn(spec.command, spec.args || [], { env: { ...process.env, ...(spec.env || {}) }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  let id = 0;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let m = null;
    try { m = JSON.parse(line); } catch { return; }
    const w = waiting.get(m.id);
    if (w) { waiting.delete(m.id); w(m); }
  });
  const call = (method, params) => new Promise((resolve) => {
    const n = ++id;
    waiting.set(n, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
  });
  return { call, note: (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`), close: () => child.stdin.end() };
}

const CROP = { id: 'x_moon_melon', like: 'watermelon', growMin: 90, yield: 3, unlock: 14, value: 'normal', season: 'summer',
  classes: ['fruit'], hue: '#BFE3FF', waterable: true,
  text: { en: { name: 'Moon Melon', desc: 'A pale melon that glows at dusk' },
    bg: { name: 'Лунен пъпеш', g: 'm', pl: 'лунни пъпеши', count: 'лунни пъпеша', def: 'лунният пъпеш', defObj: 'лунния пъпеш',
      plDef: 'лунните пъпеши' } } };

async function agent() {
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  record('argv.json', argv);
  record('env.json', Object.keys(process.env).sort());
  let stdin = '';
  for await (const c of process.stdin) stdin += c;
  record('stdin.txt', stdin);
  if (!fs.existsSync(creds)) {
    emit({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', num_turns: 0 });
    process.exit(1);
  }
  const tools = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'mcp__hh__validate', 'mcp__hh__preview', ...(conf.tools || [])];
  emit({ type: 'system', subtype: 'init', tools, mcp_servers: [{ name: 'hh', status: 'connected' }], model: 'fake' });
  const request = fs.readFileSync('request.md', 'utf8');
  if (/\bhang\b/.test(request)) { await sleep(600_000); return; }
  if (/\bnoresult\b/.test(request)) process.exit(3);
  emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'docs/mod-guide.md' } }] } });
  if (/\bescape\b/.test(request)) fs.writeFileSync('docs/catalog/crops.json', '{"hacked":true}');
  fs.mkdirSync('mod/content/crops', { recursive: true });
  fs.writeFileSync('mod/mod.json', JSON.stringify({ format: 1, title: { en: 'Moonlight Harvest', bg: 'Лунна жътва' } }));
  fs.writeFileSync('mod/content/crops/x_moon_melon.json', JSON.stringify(CROP));
  emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Write', input: { file_path: 'mod/content/crops/x_moon_melon.json' } }] } });
  const mcp = JSON.parse(fs.readFileSync(val('--mcp-config'), 'utf8'));
  const client = mcpClient(mcp.mcpServers.hh);
  await client.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '0' } });
  client.note('notifications/initialized');
  const list = await client.call('tools/list', {});
  record('mcp-tools.json', list.result);
  emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'mcp__hh__validate', input: {} }] } });
  const v = await client.call('tools/call', { name: 'validate', arguments: {} });
  record('validate.json', v.result);
  client.close();
  fs.writeFileSync('summary.json', JSON.stringify({ en: 'Moon Melons now grow on your farm.', bg: 'Вече можеш да садиш лунни пъпеши.' }));
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } });
  emit({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', num_turns: 4 });
}

(async () => {
  if (argv[0] === '--version' || argv[0] === '-v') return out(`${conf.version || '2.1.296'} (Claude Code)\n`);
  if (argv[0] === '--help' || argv[0] === '-h') return out(help());
  if (argv[0] === 'auth' && argv[1] === 'status') {
    const ok = fs.existsSync(creds);
    out(`${JSON.stringify({ loggedIn: ok, authMethod: ok ? 'claude.ai' : 'none', ...(ok ? { email: 'farmer@example.com' } : {}) }, null, 2)}\n`);
    return process.exit(ok ? 0 : 1);
  }
  if (argv[0] === 'auth' && argv[1] === 'login') return login();
  if (argv[0] === 'auth' && argv[1] === 'logout') { fs.rmSync(creds, { force: true }); return out('Logged out\n'); }
  if (argv.includes('-p') || argv.includes('--print')) return agent();
  out('interactive mode is not faked\n');
  return process.exit(2);
})();
