// The in-game helper's agent knobs (harness contract §4, §5). The mods lane owns server/config.js and folds this block
// into `cfg.harness.agent` (docs/agent-notes/hh-agent.md); until it does, createAgent() reads it from process.env.
//
//   HH_HELPER=on|off               the whole helper (default: on in single mode, OFF in multi mode until the owner
//                                  turns it on for the public host); off: GET .../state answers { enabled: false }.
//                                  HH_HARNESS=on|off is the older name of the same switch (HH_HELPER wins)
//   HH_HELPER_CLAUDE=on|off        offer Claude Code (default on; multi mode also needs HH_CLAUDE_HOSTING=accepted)
//   HH_HELPER_CHATGPT=on|off       offer ChatGPT (default on; multi mode also needs HH_CHATGPT_HOSTING=approved)
//   HH_HARNESS_MOCK=1              the scripted mock provider (tests, dev); refused with NODE_ENV=production
//   HH_MOCK_STEP_MS                the mock's delay between steps (default 400)
//   HH_CLAUDE_BIN                  the unmodified Claude Code binary (default: `claude` on PATH)
//   HH_CLAUDE_HOSTING=accepted     multi mode only: the operator accepted Anthropic's Commercial Terms for hosting it
//   HH_CHATGPT_HOSTING=approved    multi mode only: OpenAI approved this remotely hosted app for plan sign-ins (the
//                                  open-source token-sharing flow covers open-source and locally hosted apps)
//   HH_OPENAI_AUTH_BASE / HH_OPENAI_API_BASE   test stand-ins for auth.openai.com / api.openai.com/v1
//   HH_AGENT_TIMEOUT_MS            wall time of one agent round (default 10 min)
//   HH_AGENT_IDLE_MS               a round with no event this long is TIMEOUT (default 120 s)
//   HH_AGENT_MAX_RUNS              agent rounds running at once on this server (default 4; more wait their turn)
//   HH_HARNESS_JOBS_PER_HOUR       jobs a farmer may start in an hour (default 10)
//   HH_HARNESS_JOBS_PER_DAY        jobs a farm may start in a day (default 30)

/** A configuration problem (server/config.js's ConfigError has the same meaning: exit 78). */
export class AgentConfigError extends Error {}

function posInt(env, key, dflt) {
  const raw = env[key];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new AgentConfigError(`${key}=${raw} must be a positive integer`);
  return n;
}

function baseUrl(env, key, dflt) {
  const raw = env[key];
  if (raw === undefined || raw === '') return dflt;
  let u = null;
  try { u = new URL(raw); } catch { u = null; }
  if (!u || !/^https?:$/.test(u.protocol)) throw new AgentConfigError(`${key}=${raw} must be an http(s) URL`);
  return u.href.replace(/\/+$/, '');
}

/** An on/off knob: on|1 / off|0, unset or '' = `dflt`; anything else refuses the boot. */
function onOff(env, key, dflt) {
  const raw = env[key];
  if (raw === undefined || raw === '') return dflt;
  if (raw === 'on' || raw === '1') return true;
  if (raw === 'off' || raw === '0') return false;
  throw new AgentConfigError(`${key}=${raw} must be on or off`);
}

/**
 * Is the in-game helper on? HH_HELPER (or its older name HH_HARNESS); unset: on in single mode (the players' own
 * server), off in multi mode (the public host waits for the owner: provider terms, docs/harness-owner-test.md).
 */
export function helperOn(env = process.env) {
  const key = env.HH_HELPER !== undefined && env.HH_HELPER !== '' ? 'HH_HELPER' : 'HH_HARNESS';
  return onOff(env, key, (env.HH_MODE || 'single') !== 'multi');
}

/** @param {NodeJS.ProcessEnv} [env] */
export function agentConfig(env = process.env) {
  const mock = env.HH_HARNESS_MOCK === '1';
  if (mock && env.NODE_ENV === 'production') {
    throw new AgentConfigError('HH_HARNESS_MOCK=1 is refused with NODE_ENV=production (a fake helper on a real host)');
  }
  return {
    enabled: helperOn(env),
    mock,
    claudeOn: onOff(env, 'HH_HELPER_CLAUDE', true),      // off: listed as unavailable (OFF)
    chatgptOn: onOff(env, 'HH_HELPER_CHATGPT', true),
    mockStepMs: env.HH_MOCK_STEP_MS !== undefined && env.HH_MOCK_STEP_MS !== '' && Number.isSafeInteger(Number(env.HH_MOCK_STEP_MS))
      && Number(env.HH_MOCK_STEP_MS) >= 0 ? Number(env.HH_MOCK_STEP_MS) : 400,
    claudeBin: env.HH_CLAUDE_BIN || null,
    claudeHosting: env.HH_CLAUDE_HOSTING === 'accepted',
    chatgptHosting: env.HH_CHATGPT_HOSTING === 'approved',
    openaiAuthBase: baseUrl(env, 'HH_OPENAI_AUTH_BASE', 'https://auth.openai.com'),
    openaiApiBase: baseUrl(env, 'HH_OPENAI_API_BASE', 'https://api.openai.com/v1'),
    timeoutMs: posInt(env, 'HH_AGENT_TIMEOUT_MS', 10 * 60_000),
    idleMs: posInt(env, 'HH_AGENT_IDLE_MS', 120_000),
    maxRuns: posInt(env, 'HH_AGENT_MAX_RUNS', 4),
    jobsPerHour: posInt(env, 'HH_HARNESS_JOBS_PER_HOUR', 10),
    jobsPerDay: posInt(env, 'HH_HARNESS_JOBS_PER_DAY', 30),
    // proxies the operator set for outbound traffic are passed to the agent process (nothing else of the server's env)
    proxy: Object.fromEntries(['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy']
      .filter((k) => env[k]).map((k) => [k, env[k]])),
  };
}
