// Persistence: atomic JSON snapshot + append-only action journal + rotating backups
// (tech-architecture §5, a "memory image"). The whole farm lives in memory; disk is only for durability.
//
// Files in the data dir:
//   farm.json                    { schema, savedAt, version, state, server }  (server = private sidecar)
//   farm.journal.jsonl           one line per accepted action with v > snapshot.version
//   farm.journal.upto-<V>.jsonl  the journal cut at snapshot V while (or if) its snapshot write is in flight
//   farm.journal.archive.jsonl   every journal line since the NEWEST BACKUP (cuts move here once their snapshot is
//                                durable; emptied by each backup). So the newest backup + the archive + the
//                                journal always rebuild the farm exactly, even when farm.json is lost or corrupt.
//   backups/farm-<iso>.json.gz   written at boot and then at most hourly; kept: the newest of each of the last 24
//                                hours and the newest of each of the last 14 days (BACKUP_HOURS, BACKUP_DAYS)
//   backups/farm.pre-migrate-v<N>.json   the save exactly as loaded, before migrating it from schema N (kept)
//   incidents/                   corrupt saves, failed replays, stuck system actions, kept for a human; a failed
//                                replay copies the snapshot and EVERY journal file into incidents/<ts>-replay/
//
// Crash safety: the journal line is written (sync, page cache) BEFORE the delta is broadcast and is
// fdatasync'ed within 1 s (a cut journal file too: its fd is synced and closed beside the event loop); the snapshot
// cut is synchronous (stringify + journal rotation in one go), the write is tmp + fsync + rename + dir fsync; a cut is
// archived (appended + fsync) before it is deleted; a backup is tmp + fsync + rename + dir fsync before the archive is
// emptied. Load replays every journal file, deduped by v (the live journal wins, then newer cuts, then the archive).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';

const gzip = promisify(zlib.gzip);
const SNAP = 'farm.json';
const JOURNAL = 'farm.journal.jsonl';
const ARCHIVE = 'farm.journal.archive.jsonl';
const JOURNAL_RE = /^farm\.journal(?:\.upto-(\d+)|\.archive)?\.jsonl$/;
const BACKUP_RE = /^farm-(\d{4}-\d{2}-\d{2})T(\d{2})-\d{2}\.json\.gz$/;
export const BACKUP_EVERY_MS = 60 * 60 * 1000;
export const BACKUP_HOURS = 24;
export const BACKUP_DAYS = 14;

/**
 * Backup retention (pure): the newest backup of each of the `hours` most recent clock hours, plus the newest of
 * each of the `days` most recent days. Names sort chronologically (UTC ISO stamps).
 * @param {string[]} names @returns {Set<string>} the names to keep
 */
export function backupsToKeep(names, hours = BACKUP_HOURS, days = BACKUP_DAYS) {
  const newest = names.filter((n) => BACKUP_RE.test(n)).sort().reverse();
  const keep = new Set();
  const pick = (keyOf, limit) => {
    const seen = new Set();
    for (const n of newest) {
      const k = keyOf(BACKUP_RE.exec(n));
      if (seen.has(k)) continue;
      if (seen.size >= limit) break;
      seen.add(k);
      keep.add(n);
    }
  };
  pick((m) => `${m[1]}T${m[2]}`, hours);
  pick((m) => m[1], days);
  return keep;
}

/** Journal files in replay priority: the live journal, then cuts newest first, then the archive. */
function journalOrder(names) {
  const rank = (n) => {
    if (n === JOURNAL) return [0, 0];
    const m = JOURNAL_RE.exec(n);
    return m && m[1] ? [1, -Number(m[1])] : [2, 0];
  };
  return names.filter((n) => JOURNAL_RE.test(n)).sort((a, b) => {
    const [ra, sa] = rank(a);
    const [rb, sb] = rank(b);
    return ra - rb || sa - sb;
  });
}

async function fsyncPath(p, flags = 'r') {
  const h = await fsp.open(p, flags);
  try { await h.sync(); } finally { await h.close(); }
}

/** tmp + fsync + rename + dir fsync: the file is either the old one or the complete new one, durably. */
async function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, file);
  await fsyncPath(path.dirname(file));
}

export class Persist {
  /** @param {string} dir  @param {{ log?: Console, now?: () => number }} [opts] */
  constructor(dir, { log = console, now = Date.now } = {}) {
    this.dir = dir;
    this.log = log;
    this.wall = now;
    this.fd = null;
    this.unsynced = false;
    this.saving = null;
    this.again = null;
    this.lastBackupAt = 0;
    this.syncing = false;
    /** journal cut files this process created (only those may be deleted as redundant; review-m0 H2) */
    this.cuts = new Set();
    /** cut files found at load(); deletable only after adoptInherited() (a complete replay) */
    this.inherited = new Set();
    this.adopted = false;
    /** for /api/status */
    this.stats = { lastSaveAt: null, lastSaveV: null, lastBackupAt: null, lastError: null, journaled: 0,
      // ms (qa2 SV-02): the synchronous cut blocks the event loop; the write runs beside it
      timing: { n: 0, lastCutMs: null, maxCutMs: 0, lastWriteMs: null, maxWriteMs: 0, bytes: 0 } };
    this.seq = 0;
  }

  p(name) { return path.join(this.dir, name); }

  /**
   * Read the snapshot (falling back to the newest readable backup when it is corrupt OR missing while backups
   * exist) and every journal line newer than it. Never writes game state; may move a corrupt file into
   * incidents/.
   * @returns {{ snapshot: null | { schema, savedAt, version, state, server }, lines: object[], warnings: string[],
   *   source: 'snapshot' | 'backup' | 'none' }}
   */
  load() {
    fs.mkdirSync(this.p('backups'), { recursive: true });
    fs.mkdirSync(this.p('incidents'), { recursive: true });
    const warnings = [];
    let snapshot = null;
    let source = 'none';
    if (fs.existsSync(this.p(SNAP))) {
      try {
        snapshot = JSON.parse(fs.readFileSync(this.p(SNAP), 'utf8'));
        if (!snapshot || typeof snapshot !== 'object' || !snapshot.state) throw new Error('not a snapshot');
        source = 'snapshot';
      } catch (err) {
        const dest = this.p(`incidents/farm.corrupt-${this.stamp()}.json`);
        fs.renameSync(this.p(SNAP), dest);
        warnings.push(`farm.json was corrupt (${err.message}); moved to ${dest}`);
        snapshot = this.newestBackup(warnings);
        if (snapshot) source = 'backup';
      }
    } else if (this.backupNames().length) {
      warnings.push('farm.json is missing but backups exist');
      snapshot = this.newestBackup(warnings);
      if (snapshot) source = 'backup';
    }
    const since = snapshot ? snapshot.version : 0;
    const byV = new Map();
    for (const f of journalOrder(fs.readdirSync(this.dir))) {
      if (f !== JOURNAL && f !== ARCHIVE) this.inherited.add(f);
      const text = fs.readFileSync(this.p(f), 'utf8');
      const rows = text.split('\n');
      rows.forEach((row, i) => {
        if (!row.trim()) return;
        try {
          const line = JSON.parse(row);
          if (Number.isSafeInteger(line.v) && line.v > since && !byV.has(line.v)) byV.set(line.v, line);
        } catch {
          // A torn last line is the expected result of a crash mid-write; anything else is worth a warning.
          if (i < rows.length - 2) warnings.push(`${f}: unreadable line ${i + 1} skipped`);
        }
      });
    }
    const lines = [...byV.values()].sort((a, b) => a.v - b.v);
    return { snapshot, lines, warnings, source };
  }

  backupNames() {
    try {
      return fs.readdirSync(this.p('backups')).filter((n) => BACKUP_RE.test(n)).sort();
    } catch {
      return [];
    }
  }

  newestBackup(warnings) {
    for (const f of this.backupNames().reverse()) {
      try {
        const snap = JSON.parse(zlib.gunzipSync(fs.readFileSync(this.p(`backups/${f}`))).toString('utf8'));
        if (!snap || !snap.state) throw new Error('not a snapshot');
        warnings.push(`recovered from backup ${f} (v${snap.version})`);
        return snap;
      } catch {
        warnings.push(`backup ${f} unreadable`);
      }
    }
    return null;
  }

  /** Keep the save exactly as loaded before a migration changes it (tech §5.2). Synchronous, at boot. */
  preMigrate(snapshot) {
    const f = this.p(`backups/farm.pre-migrate-v${snapshot.state.schema}.json`);
    if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(snapshot));
    return f;
  }

  /** Open (append) the live journal. */
  openJournal() {
    if (this.fd === null) this.fd = fs.openSync(this.p(JOURNAL), 'a');
  }

  /**
   * Append one accepted action. Synchronous, so lines are ordered; call BEFORE broadcasting. On a failed or
   * short write the journal is truncated back to its previous size and the error is rethrown, so it never
   * keeps a torn line in the middle (the engine then rolls the action back; review-m0 M6).
   */
  append(line) {
    if (this.fd === null) this.openJournal();
    const buf = Buffer.from(`${JSON.stringify(line)}\n`);
    const size = fs.fstatSync(this.fd).size;
    try {
      const n = fs.writeSync(this.fd, buf);
      if (n !== buf.length) throw Object.assign(new Error(`short journal write (${n} of ${buf.length} bytes)`), { code: 'ESHORT' });
    } catch (err) {
      try { fs.ftruncateSync(this.fd, size); } catch { /* the disk is in trouble; the error below says so */ }
      throw err;
    }
    this.unsynced = true;
    this.stats.journaled++;
  }

  /** The replay used every journal line found at load(): inherited cut files may now be deleted. */
  adoptInherited() { this.adopted = true; }

  /** A unique, sortable time stamp for incident names (two incidents in one millisecond never collide). */
  stamp() { return `${this.wall()}-${process.pid}-${++this.seq}`; }

  /**
   * Copy the snapshot and every journal file into incidents/<stamp>-<tag>/ with an info.json, BEFORE anything
   * can snapshot over them (review-m0 H2). Returns the folder path.
   * @param {string} tag @param {object} info
   */
  quarantine(tag, info) {
    const dest = this.p(`incidents/${this.stamp()}-${tag}`);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) {
      if (f === SNAP || JOURNAL_RE.test(f)) fs.copyFileSync(this.p(f), path.join(dest, f));
    }
    fs.writeFileSync(path.join(dest, 'info.json'), JSON.stringify(info, null, 1));
    return dest;
  }

  /**
   * Remove every journal file (after quarantine() copied them): the boot continues from the loaded state
   * without the lines that did not replay, so they can never be replayed on top of newer actions later.
   */
  discardJournals() {
    if (this.fd !== null) { fs.closeSync(this.fd); this.fd = null; }
    for (const f of fs.readdirSync(this.dir)) if (JOURNAL_RE.test(f)) fs.rmSync(this.p(f), { force: true });
    this.inherited.clear();
    this.cuts.clear();
  }

  /** Called every second: make appended lines durable without blocking the event loop. */
  syncTick() {
    if (!this.unsynced || this.fd === null || this.syncing) return;
    this.unsynced = false;
    this.syncing = true;
    const fd = this.fd;
    fs.fdatasync(fd, (err) => {
      this.syncing = false;
      if (err && fd === this.fd) this.log.error('journal fdatasync failed', err);
    });
  }

  /**
   * Write a snapshot. `getCut()` returns { state, server, version } and is called synchronously, so the
   * cut is consistent. Concurrent calls coalesce: a call during a save schedules one more save.
   * @returns {Promise<void>}
   */
  snapshot(getCut) {
    if (this.saving) {
      this.again = getCut;
      return this.saving;
    }
    this.saving = (async () => {
      try {
        let cut = getCut;
        while (cut) {
          this.again = null;
          await this.snapshotOnce(cut());
          cut = this.again;
        }
      } catch (err) {
        this.stats.lastError = `${err.code || ''} ${err.message}`.trim();
        throw err;
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  async snapshotOnce({ state, server, version }) {
    // 1) synchronous cut: serialize, then rotate the journal so lines with v > version land in a new file
    const t0 = performance.now();
    const savedAt = this.wall();
    const json = JSON.stringify({ schema: state.schema, savedAt, version, state, server });
    if (this.fd !== null) {
      // The cut's lines become durable beside the event loop (qa2 SV-02: an fdatasync on a busy disk can block for
      // hundreds of ms, and this cut runs every 30 s while anyone plays). The fd stays open until its sync is done; a
      // rename keeps the inode, so the cut file gets exactly the guarantee the live journal has (durable within
      // about a second), and the snapshot written below covers the same lines anyway.
      const old = this.fd;
      fs.fdatasync(old, (err) => {
        if (err) this.log.error('journal cut fdatasync failed', err);
        fs.close(old, () => {});
      });
      this.fd = null;
      this.unsynced = false;
      if (fs.statSync(this.p(JOURNAL)).size > 0) {
        const upto = this.p(`farm.journal.upto-${version}.jsonl`);
        this.cuts.add(path.basename(upto));
        if (fs.existsSync(upto)) fs.appendFileSync(upto, fs.readFileSync(this.p(JOURNAL)));
        else fs.renameSync(this.p(JOURNAL), upto);
        if (fs.existsSync(this.p(JOURNAL))) fs.truncateSync(this.p(JOURNAL), 0);
      }
      this.openJournal();
    }
    const tm = this.stats.timing;
    const t1 = performance.now();
    tm.lastCutMs = Math.round((t1 - t0) * 10) / 10;
    tm.maxCutMs = Math.max(tm.maxCutMs, tm.lastCutMs);
    tm.bytes = json.length;
    // 2) asynchronous durable write
    await writeAtomic(this.p(SNAP), json);
    tm.n++;
    tm.lastWriteMs = Math.round((performance.now() - t1) * 10) / 10;
    tm.maxWriteMs = Math.max(tm.maxWriteMs, tm.lastWriteMs);
    this.stats.lastSaveAt = savedAt;
    this.stats.lastSaveV = version;
    this.stats.lastError = null;
    // 3) the snapshot holds everything up to `version`: older journal cuts move to the archive (the chain from the
    // newest backup). Only cuts this process made, or inherited ones after a complete replay (adoptInherited): a
    // cut found at boot that did not replay fully holds acknowledged actions nothing else has.
    const done = [];
    for (const f of await fsp.readdir(this.dir)) {
      const m = JOURNAL_RE.exec(f);
      if (!m || !m[1] || Number(m[1]) > version) continue;
      if (!this.cuts.has(f) && !(this.adopted && this.inherited.has(f))) continue;
      done.push(f);
    }
    if (done.length) {
      for (const f of done) await fsp.appendFile(this.p(ARCHIVE), await fsp.readFile(this.p(f)));
      await fsyncPath(this.p(ARCHIVE), 'r+');
      for (const f of done) {
        await fsp.unlink(this.p(f)).catch(() => {});
        this.cuts.delete(f);
        this.inherited.delete(f);
      }
    }
    if (savedAt - this.lastBackupAt >= BACKUP_EVERY_MS) await this.backup(json, savedAt);
  }

  /** gzip the snapshot into backups/ (atomic), empty the archive it now covers, prune by backupsToKeep(). */
  async backup(json, at = this.wall()) {
    this.lastBackupAt = at;
    try {
      const stamp = new Date(at).toISOString().slice(0, 16).replace(':', '-');
      await writeAtomic(this.p(`backups/farm-${stamp}.json.gz`), await gzip(json));
      if (fs.existsSync(this.p(ARCHIVE))) await fsp.truncate(this.p(ARCHIVE), 0);
      this.stats.lastBackupAt = at;
      const all = this.backupNames();
      const keep = backupsToKeep(all);
      for (const f of all) if (!keep.has(f)) await fsp.unlink(this.p(`backups/${f}`)).catch(() => {});
    } catch (err) {
      this.lastBackupAt = at - BACKUP_EVERY_MS + 5 * 60_000;     // try again in 5 minutes, not in an hour
      this.log.error('backup failed', err);
    }
  }

  /** Keep a copy of something a human must look at. */
  incident(name, data) {
    try {
      fs.writeFileSync(this.p(`incidents/${this.stamp()}-${name}`), typeof data === 'string' ? data : JSON.stringify(data, null, 1));
    } catch (err) {
      this.log.error('incident write failed', err);
    }
  }

  /** Flush and close the journal (after the final snapshot). */
  close() {
    if (this.fd !== null) {
      try { fs.fdatasyncSync(this.fd); } catch { /* closing anyway */ }
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}
