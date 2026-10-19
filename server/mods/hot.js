// Hot apply (contract §2.5) and the boot-time install of a farm's mod (§1.9, §2.4): the same functions run in a
// single-farm server and inside a modded farm's worker thread (server/farm-worker.js), wherever the farm's engine is.
//
//   applyToFarm(hh, overlay, { store, n, by, kind, at, push }) -> Promise<active>
//       1. snapshot (the journal starts empty); 2. synchronously: version n becomes active (active.json last),
//       installOverlay(), engine.modHash (every journal line from now on carries `mh`), a server-initiated welcome to
//       every joined connection (it carries `mod`), then the `hx` push; 3. snapshot.
//   loadActive(store, { log, base, recompile }) -> { overlay, active, suspended }   at boot: the active version's overlay;
//       one compiled for other game files is recompiled from its files (and stored as a new version), else suspended
//   replayHooks(store) -> { before(line), after() }   installs, before each journal line, the overlay its `mh` names
//       (lines without `mh` replay on the base), and the active one after the replay
import { installOverlay, installedOverlay } from '../../shared/mod/install.js';
import { suspended } from '../../shared/mod/apply.js';
import { overlayHash } from '../../shared/mod/hash.js';
import { CONTENT_HASH } from '../../shared/content/index.js';
import { MSG } from '../../shared/net/protocol.js';
import { REMOVED } from '../../shared/mod/format.js';

/** The removed knobs (format.js REMOVED: 'palette', 'tips') a recompile left out, from its IGNORED warnings. */
const leftOutOf = (ignored) => Object.keys(REMOVED).filter((knob) => (ignored ?? []).some((w) => w.file === REMOVED[knob].file
  && (!REMOVED[knob].path || String(w.path ?? '').split('.')[0] === REMOVED[knob].path)));

/** The welcome's `mod` field for an installed overlay (contract §2.6). */
export const welcomeMod = (overlay) => (overlay ? { n: overlay.n, hash: overlay.hash, overlay } : null);

export async function applyToFarm(hh, overlay, { store, n, by = null, kind = 'apply', at = Date.now(), push = null }) {
  await hh.scheduler.save();
  const active = store.commit(n, { by, kind, at });
  installOverlay(overlay);
  hh.engine.modHash = overlay.hash;
  hh.mod = welcomeMod(overlay);
  for (const c of [...hh.sessions.conns]) if (c.pid && !c.closed) hh.sessions.welcome(c, undefined, true);
  if (push) hh.sessions.broadcast({ t: MSG.HX, ...push });
  await hh.scheduler.save();
  return active;
}

/**
 * The farm's active overlay at boot. `recompile(files, prevOverlay, n)` -> { ok, overlay } (server/mods/index.js:
 * compile + the game's own content check); a failed recompile stores the suspended overlay as a new version.
 */
export function loadActive(store, { log = console, recompile = null, now = Date.now() } = {}) {
  const active = store.active();
  if (!active) return { overlay: null, active: null, suspended: false };
  let overlay = store.overlay(active.n);
  if (!overlay) {
    log.error('the active mod version is missing; the farm runs the base game', { n: active.n });
    return { overlay: null, active: null, suspended: false };
  }
  if (overlay.base === CONTENT_HASH) return { overlay, active, suspended: Boolean(overlay.suspended) };
  // a game update since: rebuild the overlay from the version's files on this build's content. A stored file that does
  // not read, or a compile that throws, suspends the mod: it never stops the farm from starting (QA r1 H-01).
  const n = store.nextN();
  const { files, problems } = store.readFiles(active.n);
  let r = { ok: false, problems };
  if (recompile && !problems.length) {
    try { r = recompile(files, overlay, n) ?? { ok: false }; } catch (err) {
      r = { ok: false, problems: [{ code: 'INTERNAL', message: String(err && err.message).slice(0, 200) }] };
    }
  }
  // the things' icons of the version the game makes now (QA r2: a rebuilt or paused version had none on disk, so every
  // mod icon answered 404 after a game update); a render that fails leaves the icons out, never the farm unstarted
  const iconsOf = (ov) => {
    try { return (recompile && typeof recompile.render === 'function' ? recompile.render(ov) : null) ?? {}; } catch { return {}; }
  };
  if (r.ok) {
    // QA r1 H-14: the game rebuilt it, nobody asked for anything today: kind 'rebuild' (History: "Updated for the new
    // game"), no farmer, and what it left out (`leftOut`: the removed knobs), never a fresh "Applied" by the old farmer
    store.stage({ files, overlay: r.overlay, report: store.report(active.n), icons: r.icons ?? iconsOf(r.overlay),
      meta: { ...store.meta(active.n), parent: active.n, at: now, by: null, leftOut: leftOutOf(r.ignored) } });
    const a = store.commit(n, { by: null, kind: 'rebuild', at: now });
    log.info('the farm\'s mod was rebuilt for this game version', { from: active.n, to: n });
    // release 1.0 (M24): a part the format no longer has (the palette, the tips) is left out, never a reason to pause it
    for (const w of r.ignored ?? []) log.warn('the farm\'s mod used a part this game version no longer has: left out', { n: active.n, file: w.file, path: w.path });
    return { overlay: r.overlay, active: a, suspended: false };
  }
  const s = { ...suspended(overlay), n, base: CONTENT_HASH, hash: '' };
  s.hash = overlayHash(s);
  // QA r2 H2-02 (the sibling of H-14 above): the game paused it, nobody asked for anything: no farmer, no wish, and why
  // ('BAD_JSON': a file of the change does not read; anything else: the change no longer fits this game version)
  const why = (r.problems ?? problems)[0];
  const reason = typeof why === 'string' ? 'CONTENT_CHECK' : String(why?.code ?? 'INTERNAL');
  store.stage({ files, overlay: s, icons: iconsOf(s), report: null,
    meta: { parent: active.n, at: now, by: null, jobId: null, prompt: null, prompts: null, summary: null, title: overlay.title,
      changes: [], reason } });
  // an unreadable file stays as it was in the suspended version: an undo to it is refused (BAD_JSON), never a silent loss
  store.copyFiles(active.n, n, problems.map((p) => p.file));
  const a = store.commit(n, { by: null, kind: 'suspend', at: now });
  log.warn('the farm\'s mod does not fit this game version; its things are paused (retired) until a new job or an undo',
    { n: active.n, problems: (r.problems ?? []).slice(0, 5).map((p) => `${p.code} ${p.file ?? ''} ${p.path ?? ''}`.trim()) });
  return { overlay: s, active: a, suspended: true };
}

export function replayHooks(store) {
  const cache = new Map();
  const of = (mh) => {
    if (!cache.has(mh)) cache.set(mh, store.byHash(mh));
    return cache.get(mh);
  };
  return {
    before(line) {
      const want = typeof line.mh === 'string' ? of(line.mh) : null;
      const cur = installedOverlay();
      if ((cur ? cur.hash : null) !== (want ? want.hash : null)) installOverlay(want);
    },
    after(overlay) { installOverlay(overlay ?? null); },
  };
}
