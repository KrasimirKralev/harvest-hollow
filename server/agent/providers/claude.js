// Claude provider: the UNMODIFIED Claude Code binary, one process per job, signed in by each farmer through Claude
// Code's own login (harness contract §5.2; PROVIDER RULES in docs/agent-briefs/harness-overview.md):
//   - the binary is the operator's install (HH_CLAUDE_BIN or `claude` on PATH): never a dependency, never patched;
//   - each farmer has a private HOME and CLAUDE_CONFIG_DIR under users/<pid>/claude/. Our code creates and deletes
//     those folders and NEVER opens, reads, copies, logs or sends anything inside them (test/agent.claude.test.js spies
//     on fs to prove it). Sign-in state comes from the binary itself (`claude auth status`);
//   - sign-in is the binary's own `claude auth login` (any method it offers: --claudeai, --console, --sso), run
//     under a pseudo-terminal from util-linux `script` when present. The relay forwards ONLY the sign-in URL the binary
//     prints (step open_url) and types in ONLY the code the farmer pastes; its output is parsed in memory and never
//     logged or stored. `setup-token` (which prints a token to the caller) is never used;
//   - the job run: `-p --output-format stream-json` with our system prompt appended, our MCP bridge (validate,
//     preview) as the only MCP server, built-in tools limited to Read/Glob/Grep/Write/Edit, Bash/web/agents removed,
//     `dontAsk` permissions with allow rules scoped to the job folder (writes: ./mod/** and ./summary.json), always
//     `--restricted`, and jobSettings() (reads outside the working folder blocked, private/ and users/ denied);
//   - flags are detected from `--help` every hour (and every 30 s while unusable: the operator may install or update
//     it while the server runs); a binary missing a restriction flag is UNSAFE_VERSION and never runs.
// Multi mode (a public host) needs HH_CLAUDE_HOSTING=accepted: hosting it is allowed only after the operator accepted
// Anthropic's Commercial Terms (an owner action).
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, writeJson } from '../fsutil.js';
import { cleanEnv, killTree, stripAnsi } from '../sandbox.js';
import { SYSTEM_PROMPT, FIRST_MESSAGE } from '../workspace.js';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp-bridge.mjs');
const PROBE_OK_MS = 3_600_000;
const PROBE_FAIL_MS = 30_000;
const LOGIN_MS = 10 * 60_000;
const STATUS_MS = 60_000;
const MAX_TURNS = 40;
const LINE_MAX = 1024 * 1024;
const TOTAL_MAX = 20 * 1024 * 1024;

/**
 * Flags the run needs; a binary whose --help lacks one of them is refused (UNSAFE_VERSION, listed as unavailable with
 * that reason). `--restricted` is one of them: it is what confines the file tools to the job's working folder. Without
 * it the real binary (2.1.296, verifier 2026-10-13) read and wrote anywhere the server's user can, so an older binary
 * is never run "with whatever isolation it has".
 */
export const REQUIRED_FLAGS = ['--print', '--output-format', '--verbose', '--append-system-prompt', '--mcp-config',
  '--strict-mcp-config', '--settings', '--tools', '--allowedTools', '--disallowedTools', '--permission-mode', '--restricted'];
/** Used when listed (the CLI documents that --help does not list every flag; --max-turns also by version). */
export const OPTIONAL_FLAGS = ['--permission-prompts', '--no-session-persistence', '--disable-slash-commands', '--max-turns'];
/** The built-in tools the session has (availability; what each may touch is the rules below). */
export const BUILTIN_TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit'];
/**
 * What is pre-approved, scoped to the job's working folder: reading under it, and writing (Claude Code checks Write and
 * Edit against Edit(...) rules) only mod/** and summary.json. A bare tool name would approve every path on the machine.
 */
export const ALLOWED_RULES = ['Read(./**)', 'Glob(./**)', 'Grep(./**)', 'Edit(./mod/**)', 'Edit(./summary.json)'];
export const MCP_TOOLS = ['mcp__hh__validate', 'mcp__hh__preview'];
export const DENIED_TOOLS = ['Bash', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit'];
/** A path we can put into a permission rule as is (no glob or rule syntax in it); others rely on the other layers. */
const RULE_SAFE_PATH = /^\/[A-Za-z0-9._@+=,~\/-]+$/;

/**
 * The job's settings.json (`--settings`; with `--restricted` the user, project and local settings files are ignored):
 * the defence in depth beside `--restricted`, so that no single flag decides what the agent can touch.
 *   - reads outside the working folders are blocked (`blockReadsOutsideWorkingDirectories`);
 *   - pre-approved: ALLOWED_RULES and our two MCP tools; with `dontAsk` everything else is refused;
 *   - denied by absolute path: the job's private folder (mcp.json holds the bridge token; settings.json is this file)
 *     and the farm's users/ folder (every farmer's sign-ins, this farmer's own Claude Code login included);
 *   - denied: anything above the working folder or in HOME, any `.credentials.json`, Bash and the web.
 * @param {{ privateDir: string, usersDir: string }} o
 */
export function jobSettings({ privateDir, usersDir }) {
  const abs = [privateDir, usersDir].filter((p) => RULE_SAFE_PATH.test(p)).flatMap((p) => [`Read(/${p}/**)`, `Edit(/${p}/**)`]);
  return {
    permissions: {
      allow: [...ALLOWED_RULES, ...MCP_TOOLS],
      deny: ['Read(../**)', 'Edit(../**)', 'Read(~/**)', 'Edit(~/**)', 'Read(//**/.credentials.json)', 'Edit(//**/.credentials.json)', ...abs,
        'Bash', 'WebFetch', 'WebSearch'],
      blockReadsOutsideWorkingDirectories: true,
    },
    disableAllHooks: true,
  };
}
/** Tools the session may list that act on nothing outside the conversation; anything else listed fails the run. */
export const HARMLESS_TOOLS = ['EndConversation', 'TodoWrite', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ExitPlanMode'];
/** Hosts a relayed sign-in URL may point at (Anthropic's own sign-in pages). */
const SIGNIN_HOSTS = /(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/i;

const userKey = (u) => `${u.farmKey}/${u.pid}`;
const hasFlag = (help, f) => new RegExp(`(^|[\\s,])${f.replace(/[-]/g, '\\-')}(?![\\w-])`, 'm').test(help);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Find an executable `claude` on the server's PATH (resolved through links). */
async function findOnPath(name, envPath = process.env.PATH || '') {
  for (const dir of envPath.split(path.delimiter).filter(Boolean)) {
    const p = path.join(dir, name);
    try {
      await fsp.access(p, fs.constants.X_OK);
      return await fsp.realpath(p);
    } catch { /* next */ }
  }
  return null;
}

function run(file, args, { env, cwd, timeoutMs = 20_000, input = null } = {}) {
  return new Promise((resolve) => {
    const child = execFile(file, args, { env, cwd, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout), stderr: String(stderr) }));
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** The account label for the UI from `claude auth status` JSON: a masked e-mail when it has one. Never a token. */
export function labelOf(st) {
  const email = st && (st.email || (st.account && st.account.email));
  const m = /^([^@\s]{1,64})@([^@\s]{1,255})$/.exec(typeof email === 'string' ? email : '');
  if (m) return `${m[1][0]}***@${m[2]}`;
  if (st && st.authMethod === 'claude.ai') return 'Claude plan';
  if (st && st.authMethod === 'api_key') return 'Console';
  return 'Claude Code';
}

/**
 * @param {{ cfg: object, log: object, hostDir: string, mode?: 'single'|'multi', now?: () => number,
 *   scriptBin?: string|null, notify?: (user: object, state: object) => void }} o
 */
export function createProvider({ cfg, log, hostDir, mode = 'single', now = Date.now, scriptBin = '/usr/bin/script', notify = () => {} }) {
  let probed = null;                 // { at, result }
  const logins = new Map();          // userKey -> login entry
  const statusCache = new Map();     // userKey -> { at, state }
  const runs = new Map();            // jobId -> child
  const hasScript = Boolean(scriptBin) && fs.existsSync(scriptBin);

  const dirsOf = (user) => {
    const base = path.join(user.dir, 'claude');
    return { base, home: path.join(base, 'home'), config: path.join(base, 'config') };
  };

  async function resolveBin() {
    if (cfg.claudeBin) {
      try {
        const p = await fsp.realpath(cfg.claudeBin);
        await fsp.access(p, fs.constants.X_OK);
        return p;
      } catch { return null; }
    }
    return findOnPath('claude');
  }

  /** { ok, version, bin, flags: Set, auth: bool } | { ok: false, reason } — re-checked hourly (30 s while unusable). */
  async function probe() {
    if (probed && now() - probed.at < (probed.result.ok ? PROBE_OK_MS : PROBE_FAIL_MS)) return probed.result;
    const result = await (async () => {
      const bin = await resolveBin();
      if (!bin) return { ok: false, reason: 'NO_BINARY' };
      const pd = path.join(hostDir, 'claude-probe');
      await ensureDir(path.join(pd, 'home'));
      await ensureDir(path.join(pd, 'config'));
      const env = cleanEnv({ home: path.join(pd, 'home'), tmp: path.join(pd, 'home'), binDir: path.dirname(bin),
        extra: { CLAUDE_CONFIG_DIR: path.join(pd, 'config'), DISABLE_AUTOUPDATER: '1' } });
      const v = await run(bin, ['--version'], { env, cwd: pd });
      const h = await run(bin, ['--help'], { env, cwd: pd });
      if (v.code !== 0 || h.code !== 0) return { ok: false, reason: 'NO_BINARY' };
      const vm = /(\d+)\.(\d+)\.(\d+)/.exec(v.stdout);
      const version = vm ? vm[0] : null;
      const help = h.stdout + h.stderr;
      const flags = new Set();
      for (const f of [...REQUIRED_FLAGS, ...OPTIONAL_FLAGS]) if (hasFlag(help, f)) flags.add(f);
      if (!flags.has('--max-turns') && vm && Number(vm[1]) >= 1) flags.add('--max-turns');
      const missing = REQUIRED_FLAGS.filter((f) => !flags.has(f));
      if (missing.length) {
        log.warn('claude code refused: a restriction flag is missing from --help', { version, missing: missing.join(',') });
        return { ok: false, reason: 'UNSAFE_VERSION', version };
      }
      return { ok: true, version, bin, flags, dontAsk: /dontAsk/.test(help), auth: /^\s+auth\b/m.test(help) };
    })();
    probed = { at: now(), result };
    return result;
  }

  async function available() {
    if (cfg.claudeOn === false) return { ok: false, reason: 'OFF' };   // HH_HELPER_CLAUDE=off (the operator's choice)
    if (mode === 'multi' && !cfg.claudeHosting) return { ok: false, reason: 'HOST_NOT_ALLOWED' };
    const p = await probe();
    return p.ok ? { ok: true, version: p.version } : { ok: false, reason: p.reason };
  }

  const envFor = (user, p, extra = {}) => {
    const d = dirsOf(user);
    return cleanEnv({ home: d.home, tmp: d.home, binDir: path.dirname(p.bin), proxy: cfg.proxy || {},
      extra: { CLAUDE_CONFIG_DIR: d.config, DISABLE_AUTOUPDATER: '1', ...extra } });
  };

  /** Ask the binary whether this farmer is signed in (cached a minute). */
  async function authStatus(user, p, { fresh = false } = {}) {
    const key = userKey(user);
    const hit = statusCache.get(key);
    if (!fresh && hit && now() - hit.at < STATUS_MS) return hit.state;
    const d = dirsOf(user);
    let state = { provider: 'claude', state: 'signed_out' };
    // the private folders exist only after a sign-in started; without them there is nothing to ask
    if (fs.existsSync(d.config)) {
      if (p.auth) {
        const r = await run(p.bin, ['auth', 'status'], { env: envFor(user, p), cwd: d.home });
        let st = null;
        try { st = JSON.parse(r.stdout); } catch { st = null; }
        if (r.code === 0 && st && st.loggedIn !== false) state = { provider: 'claude', state: 'signed_in', account: { label: labelOf(st) } };
      } else {
        // no `auth` subcommand: our own marker beside (not inside) the private folders says a login finished
        const mark = path.join(user.dir, 'claude-signed-in.json');
        if (fs.existsSync(mark)) state = { provider: 'claude', state: 'signed_in', account: { label: 'Claude Code' } };
      }
    }
    statusCache.set(key, { at: now(), state });
    return state;
  }

  const loginState = (e) => ({ provider: 'claude', state: 'pending',
    step: { kind: 'open_url', url: e.url, expiresAt: e.expiresAt, paste: { field: 'code' } } });

  function endLogin(user, e, state) {
    if (e.ended) return;
    e.ended = true;
    clearTimeout(e.timer);
    killTree(e.child, 1000);
    if (logins.get(userKey(user)) === e) logins.delete(userKey(user));
    e.final = state;
    for (const w of e.waiters.splice(0)) w(state);
    notify(user, state);
  }

  async function start(user, { method } = {}) {
    const av = await available();
    if (!av.ok) return { provider: 'claude', state: 'error', error: { code: 'UNAVAILABLE' } };
    const p = await probe();
    const d = dirsOf(user);
    await ensureDir(d.home);
    await ensureDir(d.config);
    // from the check to logins.set() nothing waits: two starts for one farmer (a double tap, two tabs) share one login
    // process instead of the second killing the first or running beside it
    const cur = logins.get(userKey(user));
    if (cur && !cur.ended) return urlOf(user, cur);
    statusCache.delete(userKey(user));
    const how = method === 'console' ? ['--console'] : method === 'sso' ? ['--sso'] : method === 'claudeai' ? ['--claudeai'] : [];
    const argv = p.auth ? [p.bin, 'auth', 'login', ...how] : [p.bin];
    const env = envFor(user, p, { TERM: hasScript ? 'xterm' : 'dumb', COLUMNS: '2000' });
    // a wide pseudo-terminal, so the binary never wraps the sign-in URL across lines
    const child = hasScript
      ? spawn(scriptBin, ['-qfec', `stty cols 2000 rows 50 2>/dev/null; exec ${argv.map(shq).join(' ')}`, '/dev/null'],
        { cwd: d.home, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(argv[0], argv.slice(1), { cwd: d.home, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const e = { child, url: null, buf: '', ended: false, waiters: [], urlWaiters: [], pasted: false, success: false,
      expiresAt: now() + LOGIN_MS, timer: null };
    logins.set(userKey(user), e);
    e.timer = setTimeout(() => endLogin(user, e, { provider: 'claude', state: 'error', error: { code: 'EXPIRED' } }), LOGIN_MS);
    e.timer.unref();
    child.stdin.on('error', () => {});
    const onData = (chunk) => {
      // held in memory only, cut to the last 16 KB; never logged or written anywhere
      e.buf = (e.buf + stripAnsi(chunk.toString('utf8'))).slice(-16_384);
      if (!e.url) {
        for (const m of e.buf.matchAll(/https:\/\/[^\s'"<>`]+/g)) {
          let u = null;
          try { u = new URL(m[0]); } catch { u = null; }
          if (u && SIGNIN_HOSTS.test(u.hostname)) { e.url = u.href; break; }
        }
        if (e.url) for (const w of e.urlWaiters.splice(0)) w();
      }
      if (!p.auth && !e.sentLogin && /[>❯]\s*$/.test(e.buf)) { e.sentLogin = true; child.stdin.write('/login\r'); }
      if (!e.success && /login successful|logged in as|signed in/i.test(e.buf)) {
        e.success = true;
        child.stdin.write('\r');          // "press Enter to continue"
        if (!p.auth) setTimeout(() => killTree(child, 500), 1500).unref();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', async (code) => {
      for (const w of e.urlWaiters.splice(0)) w();
      if (e.ended) return;
      let state;
      if (code === 0 || e.success) {
        if (!p.auth) await writeJson(path.join(user.dir, 'claude-signed-in.json'), { at: now() }).catch(() => {});
        state = await authStatus(user, p, { fresh: true });
        if (state.state !== 'signed_in') state = { provider: 'claude', state: 'error', error: { code: e.pasted ? 'BAD_CODE' : 'INTERNAL' } };
      } else {
        state = { provider: 'claude', state: 'error', error: { code: e.pasted ? 'BAD_CODE' : 'INTERNAL' } };
      }
      endLogin(user, e, state);
    });
    child.on('error', () => endLogin(user, e, { provider: 'claude', state: 'error', error: { code: 'INTERNAL' } }));
    return urlOf(user, e);
  }

  /** Answer as soon as the login printed its sign-in URL (or gave up, or 20 s passed without one). */
  async function urlOf(user, e) {
    await new Promise((resolve) => {
      if (e.url || e.ended) return resolve();
      e.urlWaiters.push(resolve);
      setTimeout(resolve, 20_000).unref();
    });
    if (e.ended) return e.final;
    if (!e.url) {
      endLogin(user, e, { provider: 'claude', state: 'error', error: { code: 'INTERNAL' } });
      return e.final;
    }
    return loginState(e);
  }

  async function cont(user, { code } = {}) {
    const e = logins.get(userKey(user));
    if (!e || e.ended) return status(user);
    // a sign-in code: one line of printable characters, nothing else is typed into the binary
    if (typeof code !== 'string' || !/^[\x21-\x7e]{4,2048}$/.test(code.trim())) {
      return { provider: 'claude', state: 'error', error: { code: 'BAD_CODE' }, step: loginState(e).step };
    }
    e.pasted = true;
    e.child.stdin.write(`${code.trim()}\r`);
    return new Promise((resolve) => {
      e.waiters.push(resolve);
      setTimeout(() => resolve(e.ended ? e.final : loginState(e)), 30_000).unref();
    });
  }

  async function status(user) {
    const e = logins.get(userKey(user));
    if (e && !e.ended && e.url) return loginState(e);
    const p = await probe();
    if (!p.ok) return { provider: 'claude', state: 'signed_out' };
    return authStatus(user, p);
  }

  async function signOut(user) {
    const e = logins.get(userKey(user));
    if (e) endLogin(user, e, { provider: 'claude', state: 'signed_out' });
    const p = await probe();
    const d = dirsOf(user);
    if (p.ok && p.auth && fs.existsSync(d.config)) await run(p.bin, ['auth', 'logout'], { env: envFor(user, p), cwd: d.home });
    await fsp.rm(d.base, { recursive: true, force: true });
    await fsp.rm(path.join(user.dir, 'claude-signed-in.json'), { force: true });
    statusCache.delete(userKey(user));
    return { provider: 'claude', state: 'signed_out' };
  }

  async function models() {
    return [{ id: 'default', label: 'Default' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'opus', label: 'Opus' }];
  }

  /** The command line of a job run (exported for the tests through the provider). */
  function argsFor(p, { model, mcpPath, settingsPath }) {
    const a = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (p.flags.has('--max-turns')) a.push('--max-turns', String(MAX_TURNS));
    if (model && model !== 'default') a.push('--model', model);
    a.push('--append-system-prompt', SYSTEM_PROMPT, '--mcp-config', mcpPath, '--strict-mcp-config', '--settings', settingsPath,
      '--tools', BUILTIN_TOOLS.join(','), '--allowedTools', [...ALLOWED_RULES, ...MCP_TOOLS].join(','),
      '--disallowedTools', DENIED_TOOLS.join(','), '--permission-mode', p.dontAsk ? 'dontAsk' : 'default',
      '--restricted');                                   // required: probe() refuses a binary without it
    if (p.flags.has('--permission-prompts')) a.push('--permission-prompts', 'none');
    if (p.flags.has('--no-session-persistence')) a.push('--no-session-persistence');
    if (p.flags.has('--disable-slash-commands')) a.push('--disable-slash-commands');
    return a;
  }

  async function runJob(job, io) {
    const p = await probe();
    if (!p.ok) return { ok: false, code: 'PROVIDER', turns: 0, detail: p.reason };
    const user = io.user;
    const d = dirsOf(user);
    if (!fs.existsSync(d.config)) return { ok: false, code: 'SIGN_IN', turns: 0 };
    const tmp = path.join(io.privateDir, 'tmp');
    await ensureDir(tmp);
    const mcpPath = path.join(io.privateDir, 'mcp.json');
    const settingsPath = path.join(io.privateDir, 'settings.json');
    await writeJson(mcpPath, { mcpServers: { hh: { type: 'stdio', command: process.execPath, args: [BRIDGE],
      env: { HH_AGENT_URL: io.bridge.url, HH_AGENT_TOKEN: io.bridge.token } } } });
    await writeJson(settingsPath, jobSettings({ privateDir: io.privateDir, usersDir: path.dirname(user.dir) }));
    const args = argsFor(p, { model: job.model, mcpPath, settingsPath });
    job.priv.isolation = 'restricted';
    job.priv.claudeVersion = p.version;
    const child = spawn(p.bin, args, { cwd: io.cwd, env: { ...envFor(user, p), TMPDIR: tmp }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    runs.set(job.id, child);
    child.stdin.on('error', () => {});
    child.stdin.end(`${FIRST_MESSAGE}\n`);
    let stderrTail = '';
    child.stderr.on('data', (c) => { stderrTail = (stderrTail + c.toString('utf8')).slice(-4096); });
    let total = 0;
    let buf = '';
    let turns = 0;
    let end = null;
    const finish = (r) => {
      if (!end) { end = r; killTree(child, 2000); }
    };
    const onAbort = () => finish({ ok: false, code: 'CANCELLED', turns });
    io.signal?.addEventListener('abort', onAbort, { once: true });
    const TOOL_NAMES = { Read: 'read_file', Glob: 'list_files', Grep: 'list_files', Write: 'write_file', Edit: 'edit_file',
      mcp__hh__validate: 'validate', mcp__hh__preview: 'preview' };
    const allowed = new Set([...BUILTIN_TOOLS, ...MCP_TOOLS, ...HARMLESS_TOOLS]);
    const handle = (msg) => {
      if (!msg || typeof msg !== 'object' || end) return;
      if (msg.type === 'system' && msg.subtype === 'init') {
        const tools = Array.isArray(msg.tools) ? msg.tools.map(String) : [];
        const extra = tools.filter((t) => !allowed.has(t));
        if (extra.length) {
          log.warn('claude code run stopped: the session offered tools outside the sandbox', { job: job.id, tools: extra.slice(0, 8).join(',') });
          finish({ ok: false, code: 'SANDBOX', turns, detail: 'tools' });
        }
        return;
      }
      if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
        turns++;
        for (const b of msg.message.content) {
          if (b && b.type === 'text' && typeof b.text === 'string') io.emit({ type: 'text', text: b.text });
          if (b && b.type === 'tool_use') {
            const name = TOOL_NAMES[b.name];
            if (!name && !allowed.has(b.name)) { finish({ ok: false, code: 'SANDBOX', turns, detail: 'tool_use' }); return; }
            if (name) io.emit({ type: 'tool', name });
          }
        }
        if (turns > MAX_TURNS + 5) finish({ ok: false, code: 'MAX_TURNS', turns });
        return;
      }
      if (msg.type === 'result') {
        const text = typeof msg.result === 'string' ? msg.result : '';
        if (msg.subtype === 'success' && !msg.is_error) return finish({ ok: true, turns: msg.num_turns || turns });
        if (msg.subtype === 'error_max_turns') return finish({ ok: false, code: 'MAX_TURNS', turns });
        if (/usage limit|limit reached|rate limit/i.test(text)) return finish({ ok: false, code: 'USAGE_LIMIT', turns });
        if (/log ?in|logged|auth|credential|api key|401|403/i.test(text)) return finish({ ok: false, code: 'SIGN_IN', turns });
        return finish({ ok: false, code: 'PROVIDER', turns, detail: msg.subtype || 'error' });
      }
    };
    child.stdout.on('data', (c) => {
      total += c.length;
      if (total > TOTAL_MAX) return finish({ ok: false, code: 'PROVIDER', turns, detail: 'output too big' });
      buf += c.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try { handle(JSON.parse(line)); } catch { /* not a JSON line: ignored */ }
      }
      if (buf.length > LINE_MAX) finish({ ok: false, code: 'PROVIDER', turns, detail: 'line too long' });
    });
    const code = await new Promise((resolve) => {
      child.on('exit', (c) => resolve(c));
      child.on('error', () => resolve(-1));
    });
    io.signal?.removeEventListener('abort', onAbort);
    runs.delete(job.id);
    await fsp.writeFile(path.join(io.privateDir, 'stderr.txt'), stderrTail, { mode: 0o600 }).catch(() => {});
    statusCache.delete(userKey(user));
    if (end) return end;
    if (/log ?in|auth|credential/i.test(stderrTail)) return { ok: false, code: 'SIGN_IN', turns };
    return { ok: false, code: 'PROVIDER', turns, detail: `exit ${code}` };
  }

  return {
    id: 'claude',
    available,
    models,
    signIn: { start, continue: cont, status, signOut },
    run: runJob,
    cancel(jobId) { const c = runs.get(jobId); if (c) killTree(c, 2000); },
    forget(farmKey) {
      for (const [k, e] of logins) if (k.startsWith(`${farmKey}/`)) { e.ended = true; clearTimeout(e.timer); killTree(e.child, 500); logins.delete(k); }
      for (const k of [...statusCache.keys()]) if (k.startsWith(`${farmKey}/`)) statusCache.delete(k);
    },
    stop() {
      for (const c of runs.values()) killTree(c, 500);
      for (const e of logins.values()) { e.ended = true; clearTimeout(e.timer); killTree(e.child, 500); }
      logins.clear();
    },
    /** tests: the flags and the probe */
    _probe: probe,
    _argsFor: argsFor,
  };
}
