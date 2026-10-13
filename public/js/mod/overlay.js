// The client side of a farm's mod (docs/agent-notes/harness-contract.md §2.6): install the overlay the welcome carries
// into this page's content without a reload, point the models, icons and Bulgarian names at the mod's things, apply its
// look, and tell the helper's UI (bus `content`). main.js calls syncOverlay(welcome.mod) BEFORE store.reset(welcome):
// the reset then replays pending predictions under the new content and every panel and view re-reads everything
// (topic '*'); the camera, the open panels, the avatar and the tool stay where they are.
//
//   syncOverlay(mod | null | undefined, { assetBase? }) -> { changed, n }
//   installedMod() -> { n, hash } | null
//   iconUrls(overlay, assetBase) -> [{ id: url128 }, { id: url64 }]   the server-made icons (immutable, by hash)
import { installOverlay, installedOverlay } from '../../../shared/mod/install.js';
import { models } from '../render/models.js';
import { setIconOverlay } from '../render/icons.js';
import { setNameOverlay } from '../i18n/names.js';
import { applyLook } from './look.js';
import { emitHarness } from '../harness/bus.js';

/** '' in single mode, '/f/<id>' on a hosted farm (the icon routes live under the farm's path). */
export function assetBaseOf(loc = typeof location !== 'undefined' ? location : null) {
  const m = loc && /^\/f\/([a-z2-7]{12})(?:\/|$)/.exec(loc.pathname);
  return m ? `/f/${m[1]}` : '';
}

export function iconUrls(overlay, assetBase = '') {
  const big = {};
  const small = {};
  for (const id of Object.keys(overlay?.look?.icons ?? {})) {
    big[id] = `${assetBase}/mods/${overlay.hash}/icons/128/${id}.png`;
    small[id] = `${assetBase}/mods/${overlay.hash}/icons/64/${id}.png`;
  }
  return [big, small];
}

export function syncOverlay(mod, { assetBase = assetBaseOf() } = {}) {
  const overlay = mod && mod.overlay && typeof mod.overlay === 'object' ? mod.overlay : null;
  const { changed } = installOverlay(overlay);
  if (changed) {
    models.setOverlay?.(overlay ? overlay.look?.models ?? {} : {});
    const [big, small] = overlay ? iconUrls(overlay, assetBase) : [{}, {}];
    setIconOverlay(big, small);
    setNameOverlay(overlay ? overlay.names ?? {} : {});
    applyLook(overlay ? overlay.look ?? null : null);
    emitHarness({ e: 'content', n: overlay ? overlay.n : 0, hash: overlay ? overlay.hash : null, changed: true,
      suspended: Boolean(overlay && overlay.suspended), text: overlay ? overlay.text ?? null : null });
  }
  return { changed, n: overlay ? overlay.n : 0 };
}

export function installedMod() {
  const o = installedOverlay();
  return o ? { n: o.n, hash: o.hash } : null;
}
