// Stage 4 of the mod validation (contract §3 "render", main thread, < 5 s): every new def resolves to existing model
// keys of the right family in public/assets/models/manifest.json, its icons are made (server-side recolour of the
// anchor's PNG, 1.4) for 128 and 64 px and decode back with visible pixels, the recolour parameters are colours, and
// the names fit (EN and BG <= 24 characters).
//   renderCheck(overlay, { root, newIds? }) -> { ok, errors, icons: { '128/<id>.png': Buffer, '64/<id>.png': Buffer }, checks }
import fs from 'node:fs';
import path from 'node:path';
import { recolorPng, decodePng } from './png.js';
import { hueOf, hueGap } from '../../shared/mod/colour.js';
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

/**
 * Did a recoloured icon miss the colour asked for? Its recoloured pixels' mean has another hue (> 40 degrees, for a
 * colour that has one), lost the colour (greyish for a vivid colour), or another lightness (> 0.35: shading keeps a
 * white cow's mean near 0.7, a teal melon for "pale blue" is 0.4 darker).
 */
export function colourMissed(mean, to) {
  const a = hueOf(mean ?? '');
  const b = hueOf(to);
  if (!a || !b) return false;
  if (b.s > 0.25 && b.l > 0.08 && b.l < 0.92 && (a.s < 0.08 || hueGap(mean, to) > 40)) return true;
  return Math.abs(a.l - b.l) > 0.35;
}

export function renderCheck(overlay, { root }) {
  const errors = [];
  const warnings = [];
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
        const { png, alpha, changed, mean } = recolorPng(fs.readFileSync(src), ic.from, ic.to, ic.kind ?? 'recolor');
        const back = decodePng(png);
        if (!alpha || back.width < 8) throw new Error('empty icon');
        icons[`${size}/${id}.png`] = png;
        // harvey#12: what the player sees is the icon; a colour the anchor cannot carry (it barely took the colour, or
        // came out far from it) is said to the agent, never left silently teal
        const far = colourMissed(mean, ic.to);
        if (size === '128' && live.has(id) && (changed < alpha * 0.05 || far)) {
          warnings.push({ stage: 'render', code: 'COLOUR_FAR', file: '', path: id,
            message: far ? `the icon of ${id} comes out ${mean}, far from ${ic.to}` : `the icon of ${id} barely takes ${ic.to} (its anchor has little of a colour to move)`,
            hint: 'a colour far from the anchor\'s own (very pale or very dark) shows less: pick one closer to it, or an anchor nearer that colour' });
        }
      } catch (e) {
        if (live.has(id)) err('ICON_FAILED', '', '', `the icon of ${id} could not be made (${e.message})`, 'pick another anchor');
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, icons, checks: { ok: errors.length === 0, models, icons: Object.keys(icons).length } };
}
