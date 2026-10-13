// The in-game helper's client bus (Harness Hollow, docs/agent-notes/harness-contract.md §2.6, §4.1). main.js routes
// every `hx` frame here and fills the farmer's key after each welcome; the ui lane subscribes and reads the key.
//
//   emitHarness(msg)              one server push ({ t: 'hx', e: 'job' | 'applied' | 'undone' | 'suspended' | 'signin',
//                                 ... }) or a local event ({ e: 'content', n, changed }: a mod overlay was installed)
//   onHarness(fn(msg)) -> off()   subscribe
//   setHarnessAuth({ pid, token }) / harnessAuth() -> { pid, token } | null    the REST Bearer key (single: the slot
//                                 token; multi: the farmer's member secret) and the farmer it belongs to
//   lastHarness(e) -> msg | null  the newest message of a kind (a panel opened after the push still finds it)
const listeners = new Set();
const last = new Map();
let auth = null;

export function emitHarness(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.e !== 'string') return;
  last.set(msg.e, msg);
  for (const fn of [...listeners]) {
    try { fn(msg); } catch (err) { console.error('a helper listener failed', err); }
  }
}

export function onHarness(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const lastHarness = (e) => last.get(e) ?? null;

export function setHarnessAuth(a) {
  auth = a && typeof a.token === 'string' && a.token ? { pid: a.pid ?? null, token: a.token } : null;
  emitHarness({ e: 'auth', pid: auth ? auth.pid : null });
}

export const harnessAuth = () => auth;
