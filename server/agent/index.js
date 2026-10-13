// The agent lane's factory (harness contract §7): `createAgent(ctx)` -> { routes(router), state(fk, pid),
// loopbackRoutes(app), listening(port), stop(), onFarmDeleted(fk) }.
//
// ctx is the HarnessCtx server/harness/index.js builds: { cfg, log, mode, auth(req), dirOf(fk), hostDir, push(fk, msg,
// { pid? }), mods, telemetry }. The agent's knobs come from cfg.harness.agent (server/config.js folds agentConfig() in)
// or, until that lands, from the environment.
//
// Providers, in the order the helper lists them: claude (the unmodified Claude Code binary), chatgpt (Sign in with
// ChatGPT), and mock (HH_HARNESS_MOCK=1 only). A provider that cannot be reached compliantly is listed unavailable
// with its reason (NO_BINARY, UNSAFE_VERSION, HOST_NOT_ALLOWED, OFF), never faked.
import { agentConfig } from './config.js';
import { Runtime } from './runtime.js';
import { createRoutes } from './routes.js';
import { createProvider as createClaude } from './providers/claude.js';
import { createProvider as createChatGPT } from './providers/chatgpt.js';
import { createProvider as createMock } from './providers/mock.js';

/**
 * @param {object} ctx HarnessCtx
 * @param {{ providers?: Record<string, object>, now?: () => number, pushMs?: number, fetch?: typeof fetch,
 *   retryMs?: number[], scriptBin?: string|null }} [opts]  tests only
 */
export function createAgent(ctx, opts = {}) {
  const cfg = (ctx.cfg && ctx.cfg.harness && ctx.cfg.harness.agent) || agentConfig(process.env);
  const log = ctx.log || console;
  const mode = ctx.mode === 'multi' ? 'multi' : 'single';
  let port = ctx.cfg && Number.isInteger(ctx.cfg.port) ? ctx.cfg.port : 3300;
  const now = opts.now || Date.now;

  let runtime = null;
  const pushSignIn = (fk, pid, provider, state) => {
    try { ctx.push(fk, { t: 'hx', e: 'signin', provider, state: state.state, signIn: state }, { pid }); } catch { /* best effort */ }
  };
  const notify = (user, state) => pushSignIn(user.farmKey, user.pid, state.provider, state);

  const providers = opts.providers || {};
  if (!opts.providers) {
    const common = { cfg, log, hostDir: ctx.hostDir, mode, now, notify };
    providers.claude = createClaude({ ...common, ...(opts.scriptBin !== undefined ? { scriptBin: opts.scriptBin } : {}) });
    providers.chatgpt = createChatGPT({ ...common, redirectPort: () => port, ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.retryMs ? { retryMs: opts.retryMs } : {}) });
    if (cfg.mock) providers.mock = createMock(common);
  }

  runtime = new Runtime({ ctx, cfg, providers, log, now, pushMs: opts.pushMs ?? 250, port: () => port });
  const { routes, loopbackRoutes } = createRoutes({ ctx, runtime, providers, log, pushSignIn });

  return {
    routes,
    loopbackRoutes,
    state: (fk, pid) => runtime.state(fk, pid),
    /** The server's real port once it listens (port 0 in tests): the MCP bridge and the ChatGPT redirect use it. */
    listening(p) { if (Number.isInteger(p) && p > 0) port = p; },
    stop: () => runtime.stop(),
    onFarmDeleted: (fk) => runtime.onFarmDeleted(fk),
    // tests and tools
    runtime,
    providers,
    cfg,
  };
}
