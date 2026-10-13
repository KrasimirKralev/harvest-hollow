// Stage 4 of the mod validation (contract §3 "render", main thread, < 5 s): every new def resolves to existing model
// keys of the right family in public/assets/models/manifest.json, its icons are made (server-side recolour of the
// anchor's PNG, 1.4) for 128 and 64 px and decode back with visible pixels, the recolour parameters are colours, and
// the names fit (EN and BG <= 24 characters).
//   renderCheck(overlay, { root, newIds? }) -> { ok, errors, icons: { '128/<id>.png': Buffer, '64/<id>.png': Buffer }, checks }
import fs from 'node:fs';
import path from 'node:path';
import { recolorPng, decodePng } from './png.js';
import { LIMITS } from '../../shared/mod/format.js';
import { contentPath } from '../../shared/mod/format.js';

const manifests = new Map();
function manifestOf(root) {
  if (!manifests.has(root)) {
    let m = null;
    try { m = JSON.parse(fs.readFileSync(path.join(root, 'public', 'assets', 'models', 'manifest.json'), 'utf8')); } catch { m = null; }
    manifests.set(root, m);
  }
  return manifests.get(root);
}

/** The model keys a def of `family` with anchor key root `root` needs. */
export function neededKeys(family, keyRoot) {
  if (family === 'crops') return [0, 1, 2, 3].map((s) => `${keyRoot}:${s}`);
  if (family === 'trees') return ['sapling', 'young', 'mature', 'ready'].map((s) => `${keyRoot}:${s}`);
  if (family === 'animals') return [keyRoot];
  return [keyRoot];
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function renderCheck(overlay, { root }) {
  const errors = [];
  const icons = {};
  const m = manifestOf(root);
  let models = 0;
  const err = (code, file, p, message, hint) => errors.push({ stage: 'render', code, file, path: p, message, ...(hint ? { hint } : {}) });
  const names = overlay.names?.bg ?? {};
  for (const family of ['crops', 'trees', 'animals', 'decor', 'recipes']) {
    for (const d of overlay.defs?.[family] ?? []) {
      const file = contentPath(family, d.id);
      if (d.name.length > LIMITS.nameMax) err('NAME_TOO_LONG', file, 'text.en.name', `"${d.name}" is longer than ${LIMITS.nameMax}`);
      if ((names[d.id]?.name ?? '').length > LIMITS.nameMax) err('NAME_TOO_LONG', file, 'text.bg.name', `"${names[d.id].name}" is longer than ${LIMITS.nameMax}`);
      if (family === 'recipes') continue;
      const look = overlay.look?.models?.[d.id];
      if (!look || !HEX.test(look.to) || (look.from !== null && !HEX.test(look.from))) { err('NO_MODEL', file, 'hue', 'no recolour for this thing'); continue; }
      for (const k of neededKeys(family, look.key)) {
        if (!m || !m.keys[k]) err('NO_MODEL', file, 'like', `the model ${k} is missing`, 'pick another anchor');
        else models++;
      }
    }
  }
  const live = new Set(Object.values(overlay.defs ?? {}).flat().map((d) => d.id));
  for (const [id, ic] of Object.entries(overlay.look?.icons ?? {})) {
    for (const [size, dir] of [['128', ''], ['64', '64']]) {
      const src = path.join(root, 'public', 'assets', 'icons', dir, `${ic.like}.png`);
      try {
        const { png, alpha } = recolorPng(fs.readFileSync(src), ic.from, ic.to, ic.kind ?? 'recolor');
        const back = decodePng(png);
        if (!alpha || back.width < 8) throw new Error('empty icon');
        icons[`${size}/${id}.png`] = png;
      } catch (e) {
        if (live.has(id)) err('ICON_FAILED', '', '', `the icon of ${id} could not be made (${e.message})`, 'pick another anchor');
      }
    }
  }
  return { ok: errors.length === 0, errors, icons, checks: { ok: errors.length === 0, models, icons: Object.keys(icons).length } };
}
