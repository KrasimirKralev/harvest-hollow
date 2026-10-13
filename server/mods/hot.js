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
  // a game update since: rebuild the overlay from the version's files on this build's content
  const n = store.nextN();
  const r = recompile ? recompile(store.files(active.n), overlay, n) : { ok: false };
  if (r.ok) {
    store.stage({ files: store.files(active.n), overlay: r.overlay, meta: { ...store.meta(active.n), parent: active.n, at: now }, report: store.report(active.n) });
    const a = store.commit(n, { by: active.by, kind: 'apply', at: now });
    log.info('the farm\'s mod was rebuilt for this game version', { from: active.n, to: n });
    return { overlay: r.overlay, active: a, suspended: false };
  }
  const s = { ...suspended(overlay), n, base: CONTENT_HASH, hash: '' };
  s.hash = overlayHash(s);
  store.stage({ files: store.files(active.n), overlay: s, meta: { ...store.meta(active.n), parent: active.n, at: now, title: overlay.title }, report: null });
  const a = store.commit(n, { by: null, kind: 'suspend', at: now });
  log.warn('the farm\'s mod does not fit this game version; its things are paused (retired) until a new job or an undo', { n: active.n });
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
