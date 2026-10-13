// The mods lane's API (contract §7 "Interfaces between lanes"): createMods(ctx) -> { active, files, catalog, validate,
// preview, stage, apply, undo, history, bootInstall, overlayFor, changes, routes, assetRoutes, onFarmDeleted, stop }.
// ctx = HarnessCtx (server/harness/index.js): { cfg, log, mode, dirOf(fk), host(fk), push(fk, msg, { pid }),
// toWorker?(fk, { before, hx }) (multi: a farm's first mod moves it into its own worker) }.
//
// Versions live in the farm's harness dir (store.js). Apply and undo run where the farm's engine runs (hot.js through
// host.call('applyOverlay')), so a modded multi-mode farm's worker is the only writer of its mod store while loaded.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ModStore } from './store.js';
import { validateCandidate, bootPool, base } from './validate.js';
import { buildCatalog } from './catalog.js';
import { compileMod } from '../../shared/mod/compile.js';
import { checkFiles, parseFiles } from '../../shared/mod/schema.js';
import { diffOverlays } from '../../shared/mod/diff.js';
import { applyMod } from '../../shared/mod/apply.js';
import { modHash } from '../../shared/mod/hash.js';
import { validateContent, CONTENT_HASH } from '../../shared/content/index.js';
import { loadActive } from './hot.js';

const NAME_LANGS = ['en', 'bg'];
let bgCache = null;
/** The base game's Bulgarian names table (NAME_TAKEN and the catalog). */
export async function bgNamesTable(root) {
  if (!bgCache) {
    try {
      const m = await import(path.join(root, 'public', 'js', 'i18n', 'bg', 'names.js'));
      bgCache = m.names ?? m.default?.names ?? m.default ?? {};
    } catch { bgCache = {}; }
  }
  return bgCache;
}

let tracksCache = null;
export function musicTracks(root) {
  if (!tracksCache) {
    try { tracksCache = JSON.parse(fs.readFileSync(path.join(root, 'public', 'assets', 'audio', 'music', 'tracks.json'), 'utf8')).tracks ?? []; } catch { tracksCache = []; }
  }
  return tracksCache;
}

/** Recompile a version's files for this build (boot after a game update): compile + the game's content check. */
export function recompileFor(root) {
  return (files, prevOverlay, n) => {
    const tracks = musicTracks(root).map((t) => t.id);
    const c = compileMod(base(), files, { n, prevOverlay, tracks });
    if (!c.ok) return { ok: false };
    try {
      if (validateContent(applyMod(base().tables, c.overlay)).length) return { ok: false };
    } catch { return { ok: false }; }
    return { ok: true, overlay: c.overlay };
  };
}

/** The icon URL of a mod thing (contract §4.6). */
export const iconUrl = (mode, farmKey, hash, id, size = 128) => `${mode === 'multi' ? `/f/${farmKey}` : ''}/mods/${hash}/icons/${size}/${id}.png`;

export function createMods(ctx) {
  const { cfg, log } = ctx;
  const root = cfg.root;
  const pool = bootPool({ size: cfg.harness?.modWorkers ?? 2, timeoutMs: cfg.harness?.bootTimeoutMs ?? 20_000 });
  const stores = new Map();
  const storeOf = (fk) => {
    const dir = ctx.dirOf(fk);
    let s = stores.get(fk);
    if (!s || s.dir !== dir) stores.set(fk, (s = new ModStore(dir)));
    return s;
  };
  /** Validated candidates by modHash (stage() reuses the full validation the job just ran). */
  const passed = new Map();
  const busy = new Map();               // fk -> what is applying (one apply / undo per farm at a time)
  const lockedRun = async (fk, what, fn) => {
    if (busy.has(fk)) { const e = new Error('BUSY'); e.status = 409; e.code = 'BUSY'; throw e; }
    busy.set(fk, what);
    try { return await fn(); } finally { busy.delete(fk); }
  };

  const titleOf = (ov) => (ov ? ov.title : null);
  const api = {
    store: storeOf,
    busy: (fk) => busy.has(fk),

    active(fk) {
      const s = storeOf(fk);
      const a = s.active();
      if (!a) return null;
      const ov = s.overlay(a.n);
      const m = s.meta(a.n);
      return { n: a.n, hash: a.hash, appliedAt: a.appliedAt, by: a.by ?? null, title: titleOf(ov), kind: m?.kind ?? 'apply',
        suspended: Boolean(ov && ov.suspended) };
    },

    /** The mod files of version n (default: the active one; {} when none). */
    files(fk, n) {
      const s = storeOf(fk);
      return s.files(n ?? s.active()?.n);
    },

    overlayFor(fk) { return storeOf(fk).activeOverlay(); },

    async catalog(fk) {
      const s = storeOf(fk);
      return buildCatalog({ overlay: s.activeOverlay(), graveyard: s.graveyard(), bgNames: await bgNamesTable(root), tracks: musicTracks(root) });
    },

    /**
     * Validate a candidate on a copy of the farm. { full } (default true; false = the agent's quick `validate` tool).
     * Resolves the ValidationResult (contract §3).
     */
    async validate(fk, files, { full = true } = {}) {
      const s = storeOf(fk);
      const host = await ctx.host(fk);
      const state = await host.call('snapshot');
      const names = await bgNamesTable(root);
      const bgNames = new Set(Object.values(names).map((e) => (e && typeof e.name === 'string' ? e.name.toLowerCase() : null)).filter(Boolean));
      const { result, overlay, icons } = await validateCandidate({ files, prevOverlay: s.activeOverlay(), graveyard: s.graveyard(),
        state, now: Date.now(), full, n: s.nextN(), root, tracks: musicTracks(root).map((t) => t.id), bgNames, pool });
      if (result.ok && full) {
        passed.set(`${fk}:${result.modHash}`, { overlay, icons, result, parent: s.active()?.n ?? 0 });
        if (passed.size > 16) passed.delete(passed.keys().next().value);
      }
      return result;
    },

    /** What the player will see for these files: { changes, numbers } (compile only, no play test). */
    async preview(fk, files) {
      const s = storeOf(fk);
      const parsed = parseFiles(files).files;
      // the candidate staged from exactly these files: its list (with its icons) is what the player will see
      const last = s.versions().at(-1);
      const lm = last ? s.meta(last) : null;
      if (lm && lm.kind === 'candidate' && lm.modHash === modHash(parsed) && lm.parent === (s.active()?.n ?? 0)) {
        return { ok: true, changes: lm.changes ?? [], numbers: s.report(last)?.checks?.semantic?.numbers ?? {} };
      }
      const problems = checkFiles(files, { graveyard: s.graveyard() });
      if (problems.length) return { ok: false, changes: [], numbers: {}, errors: problems.slice(0, 30) };
      const c = compileMod(base(), parsed, { n: s.nextN(), prevOverlay: s.activeOverlay(), tracks: musicTracks(root).map((t) => t.id) });
      if (!c.ok) return { ok: false, changes: [], numbers: c.numbers, errors: c.problems.slice(0, 30) };
      return { ok: true, changes: api.changes(fk, s.activeOverlay(), c.overlay, { icons: false }), numbers: c.numbers };
    },

    /** The pop-up's change list between two overlays (contract §4.2 Change). */
    changes(fk, prev, next, { icons = true } = {}) {
      const d = diffOverlays(prev, next);
      const byId = new Map();
      for (const part of ['defs', 'graveyard', 'patch']) {
        for (const [fam, list] of Object.entries(next?.[part] ?? {})) {
          if (fam === 'items' || fam === 'homes') continue;      // a crop's item shares its id: the crop speaks for it
          for (const x of list) byId.set(x.id, x);
        }
      }
      const bg = next?.names?.bg ?? {};
      const out = [];
      const num = (id, x) => {
        if (!x) return undefined;
        const r = { sell: x.sell ?? x.cost, xp: x.xp, unlock: x.unlock };
        if (x.seed) r.seed = x.seed;
        const ms = x.growMs ?? x.ms ?? x.cycleMs;
        if (ms) r.minutes = Math.round(ms / 60_000);
        return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
      };
      for (const [op, list] of [['add', d.added], ['change', d.changed], ['retire', d.retired], ['revive', d.revived]]) {
        for (const { family, id } of list) {
          const x = byId.get(id);
          const modThing = /^x_/.test(id);
          out.push({ op, family, id, name: { en: x?.name ?? id, bg: bg[id]?.name ?? null },
            icon: icons && modThing && next?.look?.icons?.[id] ? iconUrl(ctx.mode, fk, next.hash, id) : null, numbers: num(id, x) });
        }
      }
      return out;
    },

    /**
     * Store a fully validated candidate as version n (kind 'candidate'). meta: { by, jobId, prompt, summary }.
     * Re-validates when this exact mod was not validated in full here. Returns { candidate, hash, validation, changes }.
     */
    async stage(fk, files, meta = {}) {
      const s = storeOf(fk);
      const parsed = parseFiles(files).files;
      const key = `${fk}:${modHash(parsed)}`;
      let p = passed.get(key);
      if (!p || p.parent !== (s.active()?.n ?? 0)) {
        const result = await api.validate(fk, files, { full: true });
        if (!result.ok) { const e = new Error('INVALID'); e.code = 'INVALID'; e.validation = result; throw e; }
        p = passed.get(key);
      }
      const n = Math.max(s.nextN(), p.overlay.n);
      const overlay = p.overlay.n === n ? p.overlay : null;
      if (!overlay) {
        // a number was taken meanwhile (another candidate): validate again for the new number
        passed.delete(key);
        return api.stage(fk, files, meta);
      }
      const prev = s.activeOverlay();
      const changes = api.changes(fk, prev, overlay);
      s.stage({ files: parsed, overlay, icons: p.icons, report: p.result,
        meta: { parent: p.parent, at: Date.now(), by: meta.by ?? null, jobId: meta.jobId ?? null, prompt: meta.prompt ?? null,
          summary: meta.summary ?? null, title: overlay.title, changes } });
      passed.delete(key);
      return { candidate: n, hash: overlay.hash, validation: p.result, changes };
    },

    /** Apply a staged candidate. 409 STALE when the farm's version moved since it was built. */
    async apply(fk, candidate, { by = null, summary = null } = {}) {
      return lockedRun(fk, 'apply', async () => {
        const s = storeOf(fk);
        const meta = s.meta(candidate);
        const overlay = s.overlay(candidate);
        if (!meta || !overlay || meta.kind !== 'candidate') { const e = new Error('NOT_READY'); e.status = 409; e.code = 'NOT_READY'; throw e; }
        if ((s.active()?.n ?? 0) !== (meta.parent ?? 0) || overlay.base !== CONTENT_HASH) {
          const e = new Error('STALE'); e.status = 409; e.code = 'STALE'; throw e;
        }
        const names = Object.entries(overlay.names?.bg ?? {}).filter(([id]) => (meta.changes ?? []).some((c) => c.id === id && (c.op === 'add' || c.op === 'revive')))
          .map(([id, e]) => ({ id, en: [...Object.values(overlay.defs)].flat().find((d) => d.id === id)?.name ?? id, bg: e.name }));
        const push = { e: 'applied', by, n: candidate, title: overlay.title, names, summary: summary ?? meta.summary ?? null };
        await api.install(fk, candidate, overlay, { by, kind: 'apply', push });
        return api.active(fk);
      });
    },

    /** Undo to version `to` (default: the version before the active one; 0 = the game as it was). */
    async undo(fk, { by = null, to } = {}) {
      return lockedRun(fk, 'undo', async () => {
        const s = storeOf(fk);
        const a = s.active();
        if (!a) { const e = new Error('NOT_FOUND'); e.status = 404; e.code = 'NOT_FOUND'; throw e; }
        let target = to;
        if (target === undefined || target === null) {
          const parent = s.meta(a.n)?.parent;
          target = Number.isSafeInteger(parent) ? parent : 0;
        }
        if (!Number.isSafeInteger(target) || target < 0 || target === a.n || (target > 0 && !s.overlay(target))) {
          const e = new Error('NOT_FOUND'); e.status = 404; e.code = 'NOT_FOUND'; throw e;
        }
        const files = target > 0 ? s.files(target)
          : { 'mod.json': { format: 1, title: { en: 'The Farm As It Was', bg: 'Фермата както беше' } } };
        const n = s.nextN();
        const c = compileMod(base(), files, { n, prevOverlay: s.activeOverlay(), tracks: musicTracks(root).map((t) => t.id) });
        if (!c.ok) { const e = new Error('INVALID'); e.status = 409; e.code = 'INVALID'; e.problems = c.problems; throw e; }
        const content = validateContent(applyMod(base().tables, c.overlay));
        if (content.length) { const e = new Error('INVALID'); e.status = 409; e.code = 'INVALID'; e.problems = content; throw e; }
        const { icons } = (await import('./render.js')).renderCheck(c.overlay, { root });
        const prev = s.activeOverlay();
        const changes = api.changes(fk, prev, c.overlay);
        s.stage({ files, overlay: c.overlay, icons, report: null,
          meta: { parent: a.n, at: Date.now(), by, jobId: null, prompt: null, summary: null, title: c.overlay.title, changes, undoTo: target } });
        await api.install(fk, n, c.overlay, { by, kind: 'undo', push: { e: 'undone', by, n, to: target } });
        return api.active(fk);
      });
    },

    /** Make a stored version live on the farm (hot apply where the engine runs; multi: the first mod moves the farm). */
    async install(fk, n, overlay, { by, kind, push }) {
      const host = await ctx.host(fk);
      if (ctx.mode === 'multi' && host.kind === 'local' && ctx.toWorker) {
        await ctx.toWorker(fk, { before: () => storeOf(fk).commit(n, { by, kind, at: Date.now() }), hx: push });
        return;
      }
      await host.call('applyOverlay', overlay, { n, by, kind, at: Date.now(), push });
    },

    history(fk) { return storeOf(fk).history(50); },

    /** Single mode boot: the active overlay (recompiled or suspended after a game update), installed by the caller. */
    bootInstall(fk = 'local') {
      return loadActive(storeOf(fk), { log, recompile: recompileFor(root) });
    },

    /** Mount GET /history and POST /undo on the harness router (auth already checked: req.harness). */
    routes(router) {
      router.get('/history', (req, res) => res.json(api.history(req.harness.farmKey)));
      router.post('/undo', async (req, res) => {
        const to = req.body && req.body.to !== undefined ? Number(req.body.to) : undefined;
        if (to !== undefined && !Number.isSafeInteger(to)) return res.status(400).json({ error: 'BAD_ARGS' });
        const { farmKey: fk, pid } = req.harness;
        if (busy.has(fk)) return res.status(409).json({ error: 'BUSY' });
        try {
          const s = storeOf(fk);
          const was = s.active();
          const prev = was ? s.overlay(was.n) : null;
          const active = await api.undo(fk, { by: pid, to });
          // shared only with this farmer's consent (the telemetry lane decides; it never throws)
          void ctx.telemetry?.record?.(fk, pid, { event: 'mod.undone', files: was ? s.files(was.n) : {},
            diff: diffOverlays(prev, s.overlay(active.n)), outcome: { state: 'undone', afterMs: null } });
          return res.json({ active });
        } catch (err) {
          if (err.status) return res.status(err.status).json({ error: err.code });
          log.error('undo failed', err);
          return res.status(500).json({ error: 'INTERNAL' });
        }
      });
    },

    /** The mod icons: GET [/f/:id]/mods/:hash/icons/:size/:file (immutable; only hashes of that farm's versions). */
    assetRoutes(app, { farmKeyOf }) {
      const r = express.Router({ mergeParams: true });
      r.get('/mods/:hash/icons/:size/:file', (req, res) => {
        const fk = farmKeyOf(req);
        const m = /^(x_[a-z0-9_]{1,30})\.png$/.exec(req.params.file);
        if (!fk || !m || !/^[0-9a-f]{8}$/.test(req.params.hash)) return res.status(404).type('text').send('Not found');
        const s = storeOf(fk);
        const n = s.nOfHash(req.params.hash);
        const f = n ? s.iconFile(n, req.params.size, m[1]) : null;
        if (!f) return res.status(404).type('text').send('Not found');
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        return res.type('png').send(fs.readFileSync(f));
      });
      app.use(r);
    },

    onFarmDeleted(fk) { stores.delete(fk); for (const k of [...passed.keys()]) if (k.startsWith(`${fk}:`)) passed.delete(k); },
    stop() {},
    langs: NAME_LANGS,
  };
  return api;
}
