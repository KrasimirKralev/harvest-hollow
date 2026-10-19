// Release 1.0, M24 (critique#1): the owners' Harvey mod survives 1.0, so no base content id or display name may equal a
// thing's id or name in their stored mod versions (a name clash makes "Caramel Apples" mean two things; an id clash
// refuses the recompile and suspends the mod). The Farmbox farm has no mods/ directory (the lead, 2026-10-13), so the
// versions checked are: any real ones under .scratch/box-save-1013m/mods/ (absent today) or harvey's synthetic stored
// version under .scratch/rb-harvey/owners-mod/ when it exists, and always the synthetic version the scope names
// (a thing named "Caramel Apples" that uses look.palette and text.tips). Base names compared in English (content) and
// Bulgarian (the names table), case- and space-insensitive.
// RED on the cut plan's behaviour: the Harvest Festival (D6, cut) would have added `caramel_apples` "Caramel Apples".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT } from '../shared/content/index.js';
import BG from '../public/js/i18n/bg/names.js';
import { ROOT } from './helpers.js';

/** The synthetic stored version (release-scope §3 step 6): files as a stored version keeps them. */
export const SYNTHETIC_VERSION = Object.freeze({
  'mod.json': { format: 1, title: { en: 'Sweet Autumn', bg: 'Сладка есен' } },
  'content/recipes/x_caramel_apples.json': { id: 'x_caramel_apples', building: 'kitchen', ms: 2_700_000,
    inputs: { apple: 2, sugar: 1 },
    text: { en: { name: 'Caramel Apples', desc: 'Apples dipped in warm caramel' },
      bg: { name: 'Карамелени ябълки', g: 'pl', pl: 'карамелени ябълки', def: 'карамелените ябълки', plDef: 'карамелените ябълки' } } },
  'look.json': { palette: { grass: '#7FB84A' } },
  'text/tips.json': { tips: [{ en: 'Caramel Apples love an autumn evening', bg: 'Карамелените ябълки обичат есенна вечер' }] },
});

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('bg');

/** Every { id, en, bg } thing in a stored version's files (content/<family>/<id>.json). */
function thingsOf(files) {
  const out = [];
  for (const [p, f] of Object.entries(files)) {
    const m = /^content\/[a-z]+\/([a-z0-9_]+)\.json$/.exec(p);
    if (!m || !f || typeof f !== 'object') continue;
    out.push({ id: f.id ?? m[1], en: f.text?.en?.name ?? null, bg: f.text?.bg?.name ?? null });
  }
  return out;
}

/** Stored versions on disk under a mods/ root (H/mods/versions/<n>/files/...): [{ where, files }]. */
function versionsOn(root) {
  const out = [];
  const vdir = path.join(root, 'versions');
  if (!fs.existsSync(vdir)) return out;
  for (const n of fs.readdirSync(vdir)) {
    const fdir = path.join(vdir, n, 'files');
    if (!fs.existsSync(fdir)) continue;
    const files = {};
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), r);
        else if (e.name.endsWith('.json')) {
          try { files[r.replace(/^mod\//, '')] = JSON.parse(fs.readFileSync(path.join(d, e.name), 'utf8')); } catch { /* not ours */ }
        }
      }
    };
    walk(fdir, '');
    out.push({ where: path.relative(ROOT, path.join(vdir, n)), files });
  }
  return out;
}

/** The clashes between base content and the given mod things (pure over CONTENT and the BG names table). */
function clashes(things) {
  const ids = new Map();
  const names = new Map();
  for (const [fam, map] of Object.entries(CONTENT)) {
    if (!(map instanceof Map)) continue;
    for (const [id, d] of map) {
      ids.set(id, fam);
      if (d && d.name) names.set(norm(d.name), `${fam}.${id}`);
    }
  }
  for (const [id, e] of Object.entries(BG.names ?? {})) if (e && e.name) names.set(norm(e.name), `bg:${id}`);
  const out = [];
  for (const t of things) {
    if (ids.has(t.id)) out.push(`${t.where}: id ${t.id} is base ${ids.get(t.id)}`);
    if (t.en && names.has(norm(t.en))) out.push(`${t.where}: "${t.en}" is base ${names.get(norm(t.en))}`);
    if (t.bg && names.has(norm(t.bg))) out.push(`${t.where}: "${t.bg}" is base ${names.get(norm(t.bg))}`);
  }
  return out;
}

test('M24: the check fires: a base recipe named "Caramel Apples" (the cut D6 festival recipe) is a clash', () => {
  const def = { id: 'caramel_apples', name: 'Caramel Apples' };
  Map.prototype.set.call(CONTENT.recipes, def.id, def);
  try {
    assert.deepEqual(clashes(thingsOf(SYNTHETIC_VERSION).map((t) => ({ ...t, where: 'synthetic' }))),
      ['synthetic: "Caramel Apples" is base recipes.caramel_apples']);
  } finally {
    Map.prototype.delete.call(CONTENT.recipes, def.id);
  }
});

test('M24: no base content id or name (English or Bulgarian) equals a thing in the owners\' stored mod versions', () => {
  const versions = [{ where: 'synthetic (scope §3 step 6)', files: SYNTHETIC_VERSION },
    ...versionsOn(path.join(ROOT, '.scratch/box-save-1013m/mods')),
    ...versionsOn(path.join(ROOT, '.scratch/rb-harvey/owners-mod/mods'))];
  const things = versions.flatMap((v) => thingsOf(v.files).map((t) => ({ ...t, where: v.where })));
  assert.ok(things.some((t) => t.en === 'Caramel Apples'), 'the synthetic version is read');
  assert.deepEqual(clashes(things), []);
});
