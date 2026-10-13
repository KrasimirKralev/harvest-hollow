// Small synchronous file helpers of the mod store: private dirs (0700) and files (0600), atomic JSON writes.
import fs from 'node:fs';
import path from 'node:path';

export function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** tmp + fsync + rename (+ dir fsync), mode 0600. */
export function writeFileAtomic(file, data) {
  mkdirp(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  try {
    const d = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
  } catch { /* a filesystem without directory fsync: the rename is still atomic */ }
}

export const writeJson = (file, obj) => writeFileAtomic(file, JSON.stringify(obj));

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function appendLine(file, obj) {
  mkdirp(path.dirname(file));
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(obj)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
