// The receiver's store: <data dir>/telemetry/events.jsonl (one shared event per line, append-only, fsync'ed; 0600 in a
// 0700 folder), mirrored in memory. Stored like the ideas box (server/ideas.js): a torn last line is skipped at boot,
// a deletion rewrites the file atomically (tmp + fsync + rename), and the hourly sweep deletes what is older than
// TELEMETRY_KEEP_MS. An event's `id` is the sender's (128 random bits), so a retried delivery is stored once.
import fs from 'node:fs';
import path from 'node:path';
import { EVENTS } from './payload.js';

const HEX128 = /^[0-9a-f]{32}$/;
const DAY = 86_400_000;

function readLines(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* torn */ }
  }
  return out;
}

async function rewriteLines(file, rows) {
  const tmp = `${file}.tmp`;
  const fh = await fs.promises.open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
    await fh.sync();
  } finally { await fh.close(); }
  await fs.promises.rename(tmp, file);
  try {
    const d = await fs.promises.open(path.dirname(file), 'r');
    try { await d.sync(); } finally { await d.close(); }
  } catch { /* a filesystem that refuses a directory fsync: the rename is still atomic */ }
}

export class TelemetryStore {
  constructor(dir, { wall = Date.now } = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'events.jsonl');
    this.wall = wall;
    /** id -> stored row */
    this.rows = new Map();
    this.queue = Promise.resolve();
  }

  load() {
    for (const r of readLines(this.file)) {
      if (r && typeof r.id === 'string' && HEX128.test(r.id) && Number.isSafeInteger(r.at)) this.rows.set(r.id, r);
    }
    return this;
  }

  serial(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /** Events received in the last `ms` (all, or one install's). */
  recent(ms = DAY, install = null) {
    const since = this.wall() - ms;
    let n = 0;
    for (const r of this.rows.values()) if (r.at > since && (!install || r.install === install)) n++;
    return n;
  }

  /** Store a checked payload (checkPayload's). Resolves { row, fresh } (fresh false: this id was already stored). */
  add(payload) {
    return this.serial(async () => {
      const had = this.rows.get(payload.id);
      if (had) return { row: had, fresh: false };
      const { at: sentAt, ...rest } = payload;
      const row = { ...rest, at: this.wall(), sentAt };
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      let lead = '';
      try {
        const st = fs.statSync(this.file);
        if (st.size > 0) {
          const fd = fs.openSync(this.file, 'r');
          try {
            const b = Buffer.alloc(1);
            fs.readSync(fd, b, 0, 1, st.size - 1);
            if (b[0] !== 0x0a) lead = '\n';
          } finally { fs.closeSync(fd); }
        }
      } catch { /* a new file */ }
      const fh = await fs.promises.open(this.file, 'a', 0o600);
      try {
        await fh.appendFile(`${lead}${JSON.stringify(row)}\n`);
        await fh.datasync();
      } finally { await fh.close(); }
      this.rows.set(row.id, row);
      return { row, fresh: true };
    });
  }

  /** Delete every row `gone(row)` picks, for good. Resolves the deleted ids. */
  drop(gone) {
    return this.serial(async () => {
      const ids = new Set([...this.rows.values()].filter(gone).map((r) => r.id));
      if (!ids.size) return [];
      if (fs.existsSync(this.file)) await rewriteLines(this.file, readLines(this.file).filter((r) => !(r && ids.has(r.id))));
      for (const id of ids) this.rows.delete(id);
      return [...ids];
    });
  }

  async remove(id) { return (await this.drop((r) => r.id === id)).length > 0; }

  /** A privacy request: every event of one install. Resolves how many. */
  async removeInstall(install) { return (await this.drop((r) => r.install === install)).length; }

  /** The retention: every event received before `cutoff`. Resolves how many. */
  async expire(cutoff) { return (await this.drop((r) => !(r.at >= cutoff))).length; }

  /** Newest first, filtered; `counts` per event over everything stored. */
  list({ limit = 50, event = null, since = null, install = null } = {}) {
    const all = [...this.rows.values()].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
    const counts = Object.fromEntries(EVENTS.map((e) => [e, 0]));
    for (const r of all) if (counts[r.event] !== undefined) counts[r.event]++;
    const pick = all.filter((r) => (!event || r.event === event) && (!(since > 0) || r.at >= since) && (!install || r.install === install));
    return { total: all.length, counts, matched: pick.length, events: pick.slice(0, limit) };
  }
}
