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
import { diffOverlays, changeRows, sameEffect } from '../../shared/mod/diff.js';
import { applyMod } from '../../shared/mod/apply.js';
import { modHash } from '../../shared/mod/hash.js';
import { validateContent, CONTENT_HASH } from '../../shared/content/index.js';
import { loadActive } from './hot.js';
import { renderCheck } from './render.js';

const NAME_LANGS = ['en', 'bg'];
/** "Undo" all the way: the farm with no change of Harvey's (version 0). */
const AS_IT_WAS = Object.freeze({ format: 1, title: Object.freeze({ en: 'The Farm As It Was', bg: 'Фермата както беше' }) });
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

/**
 * Recompile a version's files for this build (boot after a game update): compile + the game's content check. A knob a
 * later format removed is left out, never a reason to suspend the farm's mod (M24): `ignored` lists what was left out.
 */
export function recompileFor(root) {
  // the icons of a version the game makes (a rebuild, a pause), as an apply renders them (QA r2: they were never made, so
  // every mod icon answered 404 after a game update); a failed render is no icons, never a failed boot
  const render = (overlay) => {
    try { return renderCheck(overlay, { root }).icons ?? {}; } catch { return {}; }
  };
  const fn = (files, prevOverlay, n) => {
    const tracks = musicTracks(root).map((t) => t.id);
    // inside the try (QA r1 H-01): a file the compiler chokes on is a failed recompile (the mod is suspended), never a
    // throw that reaches server start
    try {
      const c = compileMod(base(), files, { n, prevOverlay, tracks });
      if (!c.ok) return { ok: false, problems: c.problems };
      const content = validateContent(applyMod(base().tables, c.overlay));
      if (content.length) return { ok: false, problems: content };
      return { ok: true, overlay: c.overlay, ignored: c.warnings.filter((w) => w.code === 'IGNORED'), icons: render(c.overlay) };
    } catch (err) {
      return { ok: false, problems: [{ code: 'INTERNAL', message: String(err && err.message).slice(0, 200) }] };
    }
  };
  fn.render = render;
  return fn;
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

  /** The files of version `target` (0: the game as it was) and what does not read in them. */
  const readTarget = (s, target) => (target > 0 ? s.readFiles(target) : { files: { 'mod.json': structuredClone(AS_IT_WAS) }, problems: [] });
  /**
   * Version `target` compiled as the farm's next version on this game: { ok, overlay } or { ok: false, code, problems }
   * (code DAMAGED: a stored file does not read; INVALID: it no longer compiles or fails the game's content check).
   */
  const compileTarget = (s, target, n) => {
    const read = readTarget(s, target);
    if (read.problems.length) return { ok: false, code: 'DAMAGED', problems: read.problems };
    try {
      const c = compileMod(base(), read.files, { n, prevOverlay: s.activeOverlay(), tracks: musicTracks(root).map((t) => t.id) });
      if (!c.ok) return { ok: false, code: 'INVALID', problems: c.problems };
      const content = validateContent(applyMod(base().tables, c.overlay));
      if (content.length) return { ok: false, code: 'INVALID', problems: content };
      return { ok: true, overlay: c.overlay, files: read.files };
    } catch (err) {
      return { ok: false, code: 'INVALID', problems: [{ code: 'INTERNAL', message: String(err && err.message).slice(0, 200) }] };
    }
  };
  // a thing an undo or a go-back takes out of the shop or brings back, as the toasts and confirms name it; bgDef: the
  // Bulgarian definite form, for a sentence about one thing ("Ламата вече не се продава", H-12); g: its gender or 'pl'
  // (a plural noun takes the plural verb: "карамелените ябълки отново се продават", QA r3 H3-05)
  const named = (x, ov) => ({ id: x.id, en: x.name?.en ?? x.id, bg: x.name?.bg ?? null, bgDef: ov?.names?.bg?.[x.id]?.def ?? null,
    g: ov?.names?.bg?.[x.id]?.g ?? null });
  const isThing = (x) => x.kind !== 'text' && ['crops', 'trees', 'recipes', 'animals', 'decor'].includes(x.family);
  /** What leaves the shop and what comes back between two overlays (the change rows of `changes`). */
  const effectOf = (changes, prev, next) => ({
    left: changes.filter((x) => x.op === 'retire' && isThing(x)).map((x) => named(x, prev)),
    back: changes.filter((x) => (x.op === 'revive' || x.op === 'add') && isThing(x)).map((x) => named(x, next)),
  });
  // What making version `target` live now would do: { ok: true, left, back } or { ok: false, code } (DAMAGED, INVALID, or
  // NO_CHANGE: it has the active version's effect). Stored versions never change and the key carries the active version,
  // as the compile reads it: History asks on every open (each row's "Go back to this": QA r4 H4-07), so the answer is kept
  const plans = new Map();
  const planOf = (fk, s, target) => {
    const a = s.active();
    const k = `${fk}:${target}:${a?.n ?? 0}:${a?.hash ?? ''}`;
    if (plans.has(k)) return plans.get(k);
    const c = compileTarget(s, target, s.nextN());
    const prev = s.activeOverlay();
    let p;
    if (!c.ok) p = { ok: false, code: c.code };
    else if (sameEffect(prev, c.overlay)) p = { ok: false, code: 'NO_CHANGE' };
    else p = { ok: true, ...effectOf(api.changes(fk, prev, c.overlay, { icons: false }), prev, c.overlay) };
    if (plans.size > 400) plans.clear();
    plans.set(k, p);
    return p;
  };
  // whether a version can be made live again now
  const canComeBack = (fk, s, target) => planOf(fk, s, target).ok;
  /**
   * Where "Undo the last change" goes now: { to, last, revive } (store.undoTarget), checked (QA r3 H3-05). A bring-back
   * whose version cannot come back (a damaged file, or it no longer fits this game) is never offered: when the undo it
   * would reverse replaced a pause, undoing it goes back to the game's own content (what the pause had); otherwise there
   * is nothing to undo (`to: null`).
   */
  const undoPlanOf = (fk, s, a) => {
    const u = s.undoTarget(a.n);
    if (!u.revive || canComeBack(fk, s, u.to)) return u;
    const um = s.meta(u.last);
    const replaced = Number.isSafeInteger(um?.parent) ? s.meta(um.parent) : null;
    if (replaced?.kind === 'suspend' && canComeBack(fk, s, 0)) return { to: 0, last: u.last, revive: false };
    return { to: null, last: u.last, revive: false };
  };

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

    /** The agent's catalog; `level` (the farm's) marks the anchors this farm can use now and each crop's fastest time. */
    async catalog(fk, { level = null } = {}) {
      const s = storeOf(fk);
      return buildCatalog({ overlay: s.activeOverlay(), graveyard: s.graveyard(), bgNames: await bgNamesTable(root), tracks: musicTracks(root), level });
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

    /**
     * The pop-up's change list between two overlays (contract §4.2 Change; release 1.0 H3, shared/mod/diff.js
     * changeRows): things with their facts, one row per speed knob, a crop tuned on its own, the sky, the music, a
     * letter. A mod thing's icon is its own (when rendered), a base thing's the game's (/assets/icons/<id>.png).
     */
    changes(fk, prev, next, { icons = true } = {}) {
      const bg = bgCache ?? {};
      const titles = new Map(musicTracks(root).map((t) => [t.id, t.title ?? t.id]));
      return changeRows(prev, next, {
        base: base().tables,
        bgName: (id) => bg[id]?.name ?? null,
        musicTitle: (id) => titles.get(id) ?? null,
        iconOf: (id, mod) => (mod ? (icons && next?.look?.icons?.[id] ? iconUrl(ctx.mode, fk, next.hash, id) : null) : `/assets/icons/${id}.png`),
      });
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
          prompts: Array.isArray(meta.prompts) ? meta.prompts.slice(0, 6).map((x) => String(x).slice(0, 1000)) : null,
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
        // the things it adds, with where each lives (the client's "Show me": a Market tab or the recipe's workshop)
        const names = (meta.changes ?? []).filter((c) => (c.op === 'add' || c.op === 'revive') && ['crops', 'trees', 'recipes', 'animals', 'decor'].includes(c.family))
          .map((c) => ({ id: c.id, en: c.name?.en ?? c.id, bg: c.name?.bg ?? overlay.names?.bg?.[c.id]?.name ?? null, family: c.family,
            ...(c.info?.building?.id ? { building: c.info.building.id } : {}),
            // its level (QA r2 H2-03): a thing above the farm's level gets no "Show me" (the Market keeps it in "Next:")
            ...(Number.isInteger(c.numbers?.unlock) ? { unlock: c.numbers.unlock } : {}) }));
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
        // "the last change" looks through the versions the game made (a rebuild for a new game version, a pause): its
        // target is the parent of the farmer's own last change (QA r2 H2-01: a rebuild's parent holds the same files); a
        // bring-back that cannot come back is never the default (QA r3 H3-05: History's plan, the same function)
        const last = s.undoTarget(a.n);
        let target = to;
        if (target === undefined || target === null) target = undoPlanOf(fk, s, a).to;
        if (!Number.isSafeInteger(target) || target < 0 || target === a.n || (target > 0 && !s.overlay(target))) {
          const e = new Error('NOT_FOUND'); e.status = 404; e.code = 'NOT_FOUND'; throw e;
        }
        const refuse = (code, problems = []) => { const e = new Error(code); e.status = 409; e.code = code; e.problems = problems; return e; };
        // a stored file that does not read refuses the undo (QA r1 H-01): leaving it out would retire its thing silently.
        // Its own code (QA r2 H2-02): the farmer reads "version N has a damaged file", not the job's "did not pass the tests"
        const n = s.nextN();
        const c = compileTarget(s, target, n);
        if (!c.ok) throw refuse(c.code, c.problems);
        const { files } = c;
        const prev = s.activeOverlay();
        // an undo that changes nothing on the farm commits no version and never says it undid something (QA r2 H2-01)
        if (sameEffect(prev, c.overlay)) throw refuse('NO_CHANGE');
        const { icons } = renderCheck(c.overlay, { root });
        const changes = api.changes(fk, prev, c.overlay);
        // "Bring back {title}" (QA r1 H-04): undoing an undo brings the undone change back; it is announced as such,
        // never as another undo (kind 'revive', its own badge, confirm and toast). The undo is the farmer's last change
        // seen through a rebuild or a pause (H2-01), and the change it brings back is the farmer's own below a pause (H3-05)
        const reviving = target > 0 && last.revive && last.to === target;
        s.stage({ files, overlay: c.overlay, icons, report: null,
          meta: { parent: a.n, at: Date.now(), by, jobId: null, prompt: null, summary: null, title: c.overlay.title, changes, undoTo: target } });
        // the toast names what left the shop (harvey#17: "Moon Melon and Melon Pie left the shop") and what came back; a
        // bring-back names both (QA r4 H4-04: it can take a thing out of the shop too)
        const { left, back } = effectOf(changes, prev, c.overlay);
        await api.install(fk, n, c.overlay, { by, kind: reviving ? 'revive' : 'undo',
          push: { e: 'undone', by, n, to: target, names: left, back, ...(reviving ? { revive: true, title: c.overlay.title ?? null } : {}) } });
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

    history(fk) {
      const s = storeOf(fk);
      const out = s.history(50);
      // where "Undo the last change" goes, checked: never a bring-back that can only fail (QA r3 H3-05)
      const a = s.active();
      if (a && out.undo) {
        const plan = undoPlanOf(fk, s, a);
        const no = s.ordinals();
        // what it takes out of the shop and brings back (QA r4 H4-04: the bring-back confirm said neither)
        const eff = Number.isSafeInteger(plan.to) ? planOf(fk, s, plan.to) : null;
        out.undo = { ...plan, toNo: Number.isSafeInteger(plan.to) ? (plan.to > 0 ? no.get(plan.to) ?? null : 0) : null, lastNo: no.get(plan.last) ?? null,
          ...(eff?.ok ? { left: eff.left, back: eff.back } : {}) };
      }
      // each version says whether "Go back to this" can work now (QA r4 H4-07: a version with the active one's effect, or
      // a damaged one, offered it and was refused) and what it would do (its own confirm words: H4-04)
      if (a) {
        for (const v of out.versions) {
          if (v.n === a.n || v.kind === 'suspend') continue;
          const p = planOf(fk, s, v.n);
          v.go = p.ok ? { ok: true, left: p.left, back: p.back } : { ok: false, code: p.code };
        }
      }
      return out;
    },

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

    onFarmDeleted(fk) {
      stores.delete(fk);
      for (const m of [passed, plans]) for (const k of [...m.keys()]) if (k.startsWith(`${fk}:`)) m.delete(k);
    },
    stop() {},
    langs: NAME_LANGS,
  };
  return api;
}
