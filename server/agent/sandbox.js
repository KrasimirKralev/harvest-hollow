// What keeps an agent process inside its job folder, beyond the provider's own restrictions:
//   - cleanEnv(): the process gets only PATH (system dirs + the binary's own dir), HOME, its private config dir, LANG,
//     TERM, TMPDIR and the operator's proxy variables: never the server's HH_* settings or any secret;
//   - treeHashes()/changedOutside(): every file under work/ is hashed before and after a round; anything changed
//     outside mod/** and summary.json fails the round (`SANDBOX`);
//   - killTree(): agent processes are spawned `detached` (their own process group) and stopped by group, by PID.
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const SYSTEM_PATH = ['/usr/local/bin', '/usr/bin', '/bin'];

/**
 * @param {{ home: string, tmp: string, binDir?: string|null, extra?: Record<string,string>, proxy?: Record<string,string> }} o
 */
export function cleanEnv({ home, tmp, binDir = null, extra = {}, proxy = {} }) {
  const dirs = binDir ? [binDir, ...SYSTEM_PATH.filter((d) => d !== binDir)] : SYSTEM_PATH;
  return {
    PATH: dirs.join(':'),
    HOME: home,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TERM: 'dumb',
    TMPDIR: tmp,
    ...proxy,
    ...extra,
  };
}

/** sha256 of every file under `dir` (links recorded by target, never followed), keyed by the path relative to it. */
export async function treeHashes(dir) {
  const out = new Map();
  let entries = [];
  try { entries = await fsp.readdir(dir, { recursive: true, withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(e.parentPath ?? e.path, e.name);
    const rel = path.relative(dir, full).split(path.sep).join('/');
    if (e.isSymbolicLink()) out.set(rel, `link:${await fsp.readlink(full).catch(() => '?')}`);
    else if (e.isFile()) out.set(rel, crypto.createHash('sha256').update(await fsp.readFile(full)).digest('hex'));
  }
  return out;
}

/** Paths the agent may change in a round. */
export const mayChange = (rel) => rel === 'summary.json' || rel.startsWith('mod/');

/** The paths outside mod/** and summary.json that were added, removed or changed between two treeHashes(). */
export function changedOutside(before, after) {
  const bad = [];
  for (const [rel, h] of after) if (!mayChange(rel) && before.get(rel) !== h) bad.push(rel);
  for (const rel of before.keys()) if (!mayChange(rel) && !after.has(rel)) bad.push(rel);
  // a link anywhere (also under mod/) is never something the tools make
  for (const [rel, h] of after) if (h.startsWith('link:') && !bad.includes(rel)) bad.push(rel);
  return bad.sort();
}

/** Stop a detached child and its whole process group: SIGTERM, then SIGKILL after `graceMs`. */
export function killTree(child, graceMs = 3000) {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const sig = (s) => {
    try { process.kill(-child.pid, s); } catch {
      try { child.kill(s); } catch { /* already gone */ }
    }
  };
  sig('SIGTERM');
  const t = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) sig('SIGKILL'); }, graceMs);
  t.unref();
  child.once('exit', () => clearTimeout(t));
}

/** Strip terminal escape sequences and carriage returns from a relayed line (login output under a PTY). */
// eslint-disable-next-line no-control-regex
export const stripAnsi = (s) => String(s).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  // eslint-disable-next-line no-control-regex
  .replace(/\x1b[@-Z\\-_]/g, '').replace(/\r/g, '');
