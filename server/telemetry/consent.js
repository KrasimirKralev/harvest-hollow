// Each farmer's choice about sharing their helper requests (docs/agent-notes/harness-contract.md §6): stored on the
// farm's own server in H(farmKey)/consent.json = { <pid>: { telemetry: bool, at, v: 1 } } (0600; its folder 0700). A
// farmer with no row was never asked: that reads as `null` and counts as OFF. Only `true`, written by the farmer
// themself through POST .../consent, ever lets an event leave. In multi mode the file sits in the farm's folder, so
// deleting the farm deletes it too.
import fs from 'node:fs';
import path from 'node:path';

export const CONSENT_FILE = 'consent.json';
export const CONSENT_VERSION = 1;
const PID = /^p[1-9]$/;

/** The parsed file, or {} when it is missing or unreadable (an unreadable choice is never read as a yes). */
function readAll(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

/** tmp (0600) + fsync + rename: the file holds the old or the new choices, never half of them. */
function writeAll(file, all) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(all)}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

/** A farmer's choice: { telemetry: true | false | null, at: ms | null }. Only a stored boolean true is a yes. */
export function readConsent(dir, pid) {
  if (!PID.test(String(pid))) return { telemetry: null, at: null };
  const row = readAll(path.join(dir, CONSENT_FILE))[pid];
  if (!row || typeof row !== 'object' || typeof row.telemetry !== 'boolean') return { telemetry: null, at: null };
  return { telemetry: row.telemetry, at: Number.isSafeInteger(row.at) ? row.at : null };
}

/** Store a farmer's choice (a boolean, nothing else); resolves what is now stored. */
export function writeConsent(dir, pid, telemetry, now) {
  if (!PID.test(String(pid))) throw new Error('telemetry: a consent needs a farmer');
  if (typeof telemetry !== 'boolean') throw new Error('telemetry: a consent is true or false');
  const file = path.join(dir, CONSENT_FILE);
  const all = readAll(file);
  // only rows of the documented shape survive a rewrite
  const keep = Object.fromEntries(Object.entries(all).filter(([k, r]) => PID.test(k) && r && typeof r.telemetry === 'boolean'));
  keep[pid] = { telemetry, at: now, v: CONSENT_VERSION };
  writeAll(file, keep);
  return { telemetry, at: now };
}
