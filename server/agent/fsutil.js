// Small file helpers for the agent lane: private dirs (0700), atomic private files (0600), JSON reads.
// Everything goes through the default `fsp` object (not named imports) so a test can spy on what the lane reads.
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');

/** mkdir -p with 0700 on every directory it creates (the harness dirs hold sign-ins). */
export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Write tmp + fsync + rename, mode 0600: a crash leaves the old file or the new one, never half of one. */
export async function writeFileAtomic(file, data, mode = 0o600) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${randomHex(4)}.tmp`;
  const fh = await fsp.open(tmp, 'wx', mode);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

export const writeJson = (file, value) => writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);

/** The parsed JSON of a file, or `dflt` when it is missing or unreadable as JSON. */
export async function readJson(file, dflt = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return dflt;
  }
}

export async function exists(p) {
  try {
    await fsp.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** Constant-time string compare (both sides hashed first, so lengths do not leak either). */
export function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const h = (s) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}
