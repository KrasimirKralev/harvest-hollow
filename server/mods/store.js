// The mod store of one farm (contract §4.5): every version of the farm's mod, the active one, the graveyard, history.
//
//   H/mods/active.json               { n, hash, appliedAt, by }        (absent = no mod)
//   H/mods/versions/<n>/files/...    the mod folder of that version (one JSON file per path)
//   H/mods/versions/<n>/overlay.json the compiled overlay
//   H/mods/versions/<n>/meta.json    { n, parent, kind: 'candidate' | 'apply' | 'undo' | 'revive' | 'rebuild' | 'suspend', at, by, jobId, prompt,
//                                      summary, title, modHash, hash, changes }
//   H/mods/versions/<n>/report.json  the ValidationResult it passed with
//   H/mods/versions/<n>/icons/{128,64}/<id>.png
//   H/mods/by-hash/<hash>.json       { n }                              (mh-aware journal replay)
//   H/mods/graveyard.json            { <id>: { family, n } }            ids ever applied (the overlay carries the defs)
//   H/mods/history.jsonl             { at, kind, n, by }
// Dirs 0700, files 0600. Synchronous: small files, and the hot apply needs active.json durable before it answers.
import fs from 'node:fs';
import path from 'node:path';
import { mkdirp, writeJson, readJson, appendLine, writeFileAtomic } from './fsutil.js';
import { LIMITS } from '../../shared/mod/format.js';

const FAMS = ['crops', 'trees', 'recipes', 'animals', 'decor', 'items'];
/** Versions the game made, not a farmer (a rebuild for a new game version, a pause): undo looks through them. */
const SEE_THROUGH = new Set(['rebuild', 'suspend']);
const N_RE = /^[1-9][0-9]{0,8}$/;
const PATH_RE = /^(mod\.json|tuning\.json|look\.json|text\/(letters|tips)\.json|content\/(crops|trees|recipes|animals|decor)\/x_[a-z0-9_]{1,30}\.json)$/;

export class ModStore {
  /** @param {string} dir  the farm's harness dir H(farmKey) */
  constructor(dir) {
    this.dir = dir;
    this.root = path.join(dir, 'mods');
  }

  vdir(n) { return path.join(this.root, 'versions', String(n)); }

  active() { return readJson(path.join(this.root, 'active.json')); }

  /** The versions on disk, ascending. */
  versions() {
    try {
      return fs.readdirSync(path.join(this.root, 'versions')).filter((x) => N_RE.test(x)).map(Number).sort((a, b) => a - b);
    } catch { return []; }
  }

  nextN() {
    const v = this.versions();
    return v.length ? v.at(-1) + 1 : 1;
  }

  meta(n) { return readJson(path.join(this.vdir(n), 'meta.json')); }
  overlay(n) { return n ? readJson(path.join(this.vdir(n), 'overlay.json')) : null; }
  report(n) { return readJson(path.join(this.vdir(n), 'report.json')); }

  /** The active overlay (or null). */
  activeOverlay() {
    const a = this.active();
    return a ? this.overlay(a.n) : null;
  }

  /**
   * The files of version n: { files, problems }. A file that does not read as JSON (a torn write, a bad disk) is left
   * out of `files` and reported as a BAD_JSON problem (QA r1 H-01: a null spec once reached compileMod and the throw
   * stopped the server from starting). Whoever compiles stored files treats a problem as a failed compile.
   */
  readFiles(n) {
    const files = {};
    const problems = [];
    if (!n) return { files, problems };
    const root = path.join(this.vdir(n), 'files');
    const walk = (d, rel) => {
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), p);
        else if (e.isFile() && PATH_RE.test(p)) {
          const v = readJson(path.join(d, e.name), undefined);
          if (v === undefined || v === null) {
            problems.push({ stage: 'schema', code: 'BAD_JSON', file: p, path: '', message: `stored file of version ${n} does not read as JSON` });
          } else files[p] = v;
        }
      }
    };
    walk(root, '');
    return { files, problems };
  }

  /** The readable files map of version n ({} when none; see readFiles for the ones that do not read). */
  files(n) { return this.readFiles(n).files; }

  /** Copy stored files byte for byte from version `from` to version `to` (a suspended version keeps an unreadable file). */
  copyFiles(from, to, paths) {
    for (const p of paths) {
      if (!PATH_RE.test(p)) continue;
      const src = path.join(this.vdir(from), 'files', ...p.split('/'));
      try { writeFileAtomic(path.join(this.vdir(to), 'files', ...p.split('/')), fs.readFileSync(src)); } catch { /* gone: nothing to keep */ }
    }
  }

  /** The farm's graveyard ids: { id: { family, n } }. */
  graveyard() { return readJson(path.join(this.root, 'graveyard.json'), {}) ?? {}; }

  /** The overlay of an mh hash (journal replay), or null. */
  byHash(hash) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{8}$/.test(hash)) return null;
    const r = readJson(path.join(this.root, 'by-hash', `${hash}.json`));
    return r && N_RE.test(String(r.n)) ? this.overlay(r.n) : null;
  }

  /**
   * Stage a candidate: version n's files, overlay, meta (kind 'candidate'), report and icons ({ '128/<id>.png': Buffer }).
   * Returns n.
   */
  stage({ files, overlay, meta, report, icons = {} }) {
    const n = overlay.n;
    const d = this.vdir(n);
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });   // a stale candidate of the same number
    mkdirp(d);
    for (const [p, v] of Object.entries(files)) {
      if (!PATH_RE.test(p)) throw new Error(`not a mod path: ${p}`);
      writeJson(path.join(d, 'files', ...p.split('/')), v);
    }
    writeJson(path.join(d, 'overlay.json'), overlay);
    writeJson(path.join(d, 'report.json'), report ?? null);
    for (const [p, buf] of Object.entries(icons)) {
      if (!/^(128|64)\/x_[a-z0-9_]{1,30}\.png$/.test(p)) continue;
      writeFileAtomic(path.join(d, 'icons', ...p.split('/')), buf);
    }
    writeJson(path.join(d, 'meta.json'), { ...meta, n, kind: 'candidate', hash: overlay.hash, modHash: overlay.modHash });
    return n;
  }

  /** The icon file of version n, or null. */
  iconFile(n, size, id) {
    if (!N_RE.test(String(n)) || !['128', '64'].includes(String(size)) || !/^x_[a-z0-9_]{1,30}$/.test(id)) return null;
    const f = path.join(this.vdir(n), 'icons', String(size), `${id}.png`);
    return fs.existsSync(f) ? f : null;
  }

  /** The version holding an overlay hash (any kind), or null. */
  nOfHash(hash) {
    const r = readJson(path.join(this.root, 'by-hash', `${hash}.json`));
    if (r && N_RE.test(String(r.n))) return r.n;
    for (const n of this.versions().reverse()) if (this.meta(n)?.hash === hash) return n;
    return null;
  }

  /**
   * Make version n the active one: meta.kind (apply | undo | suspend), by-hash, graveyard, history, then active.json
   * (written last: it is the switch). Returns the active record.
   */
  commit(n, { by = null, kind = 'apply', at }) {
    const meta = this.meta(n);
    const overlay = this.overlay(n);
    if (!meta || !overlay) throw new Error(`version ${n} is missing`);
    writeJson(path.join(this.vdir(n), 'meta.json'), { ...meta, kind, at, by: by ?? meta.by ?? null });
    writeJson(path.join(this.root, 'by-hash', `${overlay.hash}.json`), { n });
    const g = this.graveyard();
    for (const part of ['defs', 'graveyard']) {
      for (const f of FAMS) for (const d of overlay[part]?.[f] ?? []) if (!g[d.id]) g[d.id] = { family: f, n };
    }
    writeJson(path.join(this.root, 'graveyard.json'), g);
    appendLine(path.join(this.root, 'history.jsonl'), { at, kind, n, by });
    const active = { n, hash: overlay.hash, appliedAt: at, by };
    writeJson(path.join(this.root, 'active.json'), active);
    this.prune(n);
    return active;
  }

  /** Back to the base game (no active mod). */
  clearActive() {
    try { fs.rmSync(path.join(this.root, 'active.json'), { force: true }); } catch { /* gone */ }
  }

  /**
   * Where "Undo the last change" goes from version n: { to, last, revive }. A version the game made (a rebuild for a
   * new game version, a pause) is see-through: the last change is the farmer's own below it (QA r2 H2-01: undoing a
   * rebuild went back to the version it rebuilt, the same files, and told the farmer a change was undone). `last` is
   * that version, `to` its parent (0: the game as it was), `revive` true when `last` is an undo (the target brings the
   * undone change back: "Bring back {title}").
   */
  undoTarget(n) {
    let last = n;
    let m = this.meta(last);
    for (let i = 0; i < 64 && m && SEE_THROUGH.has(m.kind) && Number.isSafeInteger(m.parent) && m.parent > 0; i++) {
      const pm = this.meta(m.parent);
      if (!pm) break;                                   // pruned: the old rule (its parent) below
      last = m.parent;
      m = pm;
    }
    let to = m && Number.isSafeInteger(m.parent) && m.parent >= 0 ? m.parent : 0;
    // QA r3 H3-05: undoing an undo brings back what it took away; when that was a pause, the change to bring back is the
    // farmer's own below the pause (the pause holds that change's files and never works on its own)
    if (m && m.kind === 'undo') {
      for (let i = 0; i < 64 && to > 0; i++) {
        const pm = this.meta(to);
        if (!pm || pm.kind !== 'suspend' || !Number.isSafeInteger(pm.parent) || pm.parent <= 0 || !this.meta(pm.parent)) break;
        to = pm.parent;
      }
    }
    return { to, last, revive: Boolean(m && m.kind === 'undo' && to > 0) };
  }

  /**
   * The number History shows for each version (QA r2 H2-07): the versions the farm committed, counted in order from 1
   * (history.jsonl, one line per commit); a discarded candidate takes none. The stored `n` stays internal.
   */
  ordinals() {
    const out = new Map();
    let lines = [];
    try { lines = fs.readFileSync(path.join(this.root, 'history.jsonl'), 'utf8').split('\n'); } catch { /* none yet */ }
    for (const line of lines) {
      if (!line.trim()) continue;
      let r = null;
      try { r = JSON.parse(line); } catch { continue; }
      if (r && Number.isSafeInteger(r.n) && r.n > 0 && !out.has(r.n)) out.set(r.n, out.size + 1);
    }
    // a store older than its history file (or one that lost it): the committed versions on disk, in order, after those
    for (const n of this.versions()) {
      if (out.has(n)) continue;
      const m = this.meta(n);
      if (m && m.kind !== 'candidate') out.set(n, out.size + 1);
    }
    return out;
  }

  /** The history list (newest first, at most `limit`): every applied, undone or suspended version. */
  history(limit = 50) {
    const a = this.active();
    const out = [];
    const no = this.ordinals();
    for (const n of this.versions().reverse()) {
      const m = this.meta(n);
      if (!m || m.kind === 'candidate') continue;
      // release 1.0 (harvey#17): every prompt of the job (History shows the first and "+1 change"), the version it was
      // built on and, for an undo, the version it went back to ("Bring back {title}")
      out.push({ n, no: no.get(n) ?? null, at: m.at, by: m.by ?? null, kind: m.kind, title: m.title ?? null, prompt: m.prompt ?? null,
        prompts: Array.isArray(m.prompts) ? m.prompts : null, parent: Number.isInteger(m.parent) ? m.parent : null,
        undoTo: Number.isInteger(m.undoTo) ? m.undoTo : null,
        // a rebuild for a new game version: the parts it left out ('palette', 'tips': QA r1 H-14)
        ...(Array.isArray(m.leftOut) && m.leftOut.length ? { leftOut: m.leftOut } : {}),
        // a pause: why (QA r2 H2-02: 'BAD_JSON' a file that does not read, else the change no longer fits the game)
        ...(typeof m.reason === 'string' && m.reason ? { reason: m.reason } : {}),
        summary: m.summary ?? null, changes: m.changes ?? [], state: a && a.n === n ? 'active' : 'past' });
      if (out.length >= limit) break;
    }
    // where "Undo the last change" goes from the active version (H2-01), and the number shown for it
    const u = a ? this.undoTarget(a.n) : null;
    const undo = u ? { ...u, toNo: u.to > 0 ? no.get(u.to) ?? null : 0, lastNo: no.get(u.last) ?? null } : null;
    return { active: a ? a.n : null, undo, versions: out };
  }

  /** Versions beyond LIMITS.versions (oldest non-active first) are removed; the graveyard keeps their ids. */
  prune(keep) {
    const v = this.versions();
    let extra = v.length - LIMITS.versions;
    for (const n of v) {
      if (extra <= 0) break;
      if (n === keep) continue;
      fs.rmSync(this.vdir(n), { recursive: true, force: true });
      extra--;
    }
  }

  /** A candidate that was never applied, removed (discard / expired). */
  dropCandidate(n) {
    const m = this.meta(n);
    if (m && m.kind === 'candidate') fs.rmSync(this.vdir(n), { recursive: true, force: true });
  }
}
