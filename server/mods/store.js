// The mod store of one farm (contract §4.5): every version of the farm's mod, the active one, the graveyard, history.
//
//   H/mods/active.json               { n, hash, appliedAt, by }        (absent = no mod)
//   H/mods/versions/<n>/files/...    the mod folder of that version (one JSON file per path)
//   H/mods/versions/<n>/overlay.json the compiled overlay
//   H/mods/versions/<n>/meta.json    { n, parent, kind: 'candidate' | 'apply' | 'undo' | 'suspend', at, by, jobId, prompt,
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

  /** The files map of version n ({} when none). */
  files(n) {
    const out = {};
    if (!n) return out;
    const root = path.join(this.vdir(n), 'files');
    const walk = (d, rel) => {
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), p);
        else if (e.isFile() && PATH_RE.test(p)) out[p] = readJson(path.join(d, e.name));
      }
    };
    walk(root, '');
    return out;
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

  /** The history list (newest first, at most `limit`): every applied, undone or suspended version. */
  history(limit = 50) {
    const a = this.active();
    const out = [];
    for (const n of this.versions().reverse()) {
      const m = this.meta(n);
      if (!m || m.kind === 'candidate') continue;
      out.push({ n, at: m.at, by: m.by ?? null, kind: m.kind, title: m.title ?? null, prompt: m.prompt ?? null,
        summary: m.summary ?? null, changes: m.changes ?? [], state: a && a.n === n ? 'active' : 'past' });
      if (out.length >= limit) break;
    }
    return { active: a ? a.n : null, versions: out };
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
