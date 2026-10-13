// The rename to "Harness Hollow" (2026-10-13): one name in the rules and on every screen a player or visitor sees,
// old saves untouched (a farm nobody named still carries "Harvest Hollow" and shows the new name), the new wordmark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, T0, makeFarm, must } from './helpers.js';
import { BRAND, DEFAULT_FARM_NAMES, farmName, ownFarmName } from '../shared/brand.js';
import { createFarm, validateState } from '../shared/rules/state.js';

const OLD = 'Harvest Hollow';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the brand is Harness Hollow; a new farm carries it until its farmers name it', () => {
  assert.equal(BRAND, 'Harness Hollow');
  assert.deepEqual([...DEFAULT_FARM_NAMES], ['Harness Hollow', OLD, 'Harvest Harness']);
  const s = createFarm(7, T0);
  assert.equal(s.farm.name, BRAND);
  assert.deepEqual(validateState(s), []);
  assert.equal(ownFarmName(s), null);
  assert.equal(farmName(s), BRAND);
});

test('a farm made before the rename keeps its save and shows the new name; a named farm keeps its own', () => {
  const s = makeFarm();
  s.farm.name = OLD;                                   // what every save from before the rename carries
  assert.deepEqual(validateState(s), [], 'an old save stays valid as it is');
  assert.equal(ownFarmName(s), null);
  assert.equal(farmName(s), BRAND);
  must(s, 'nameFarm', { name: 'Sunny Acres' });
  assert.equal(farmName(s), 'Sunny Acres');
  assert.equal(ownFarmName(s), 'Sunny Acres');
  must(s, 'nameFarm', { name: OLD });                   // carved by the farmers themselves: theirs to keep
  assert.equal(farmName(s), OLD);
  assert.equal(farmName(null), null);
  assert.equal(farmName({ farm: { name: '  ' } }), BRAND);
});

test('no page, manifest or catalog a player or visitor sees says the old name', () => {
  const files = ['public/index.html', 'public/landing.html', 'public/privacy.html', 'public/manifest.webmanifest',
    'public/manifest.bg.webmanifest', 'server/banner.js', 'server/multi.js', 'README.md', 'PRIVACY.md', 'deploy/cloud.md'];
  for (const dir of ['public/js/i18n/en', 'public/js/i18n/bg']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.js')) files.push(`${dir}/${f}`);
  }
  for (const f of files) assert.doesNotMatch(read(f), /Harvest Hollow/, f);
  for (const f of ['public/manifest.webmanifest', 'public/manifest.bg.webmanifest']) {
    const m = JSON.parse(read(f));
    assert.equal(m.name, BRAND, f);
    assert.equal(m.short_name, BRAND, f);
  }
  const index = read('public/index.html');
  assert.match(index, /<title>Harness Hollow<\/title>/);
  assert.match(index, /<meta name="apple-mobile-web-app-title" content="Harness Hollow">/);
  // the loading screen and the slot picker show the wordmark, named for screen readers
  assert.match(index, /<img class="boot-logo" src="\/assets\/art\/logo\.png" alt="Harness Hollow" width="1200" height="538">/);
  assert.match(index, /<img class="slot-logo" src="\/assets\/art\/logo-wide\.png" alt="Harness Hollow" width="1400" height="336">/);
  assert.match(read('public/landing.html'), /<title>Harness Hollow · a cozy farm for two<\/title>/);
  assert.match(read('public/landing.html'), /alt="Harness Hollow"/);
});

/** Width and height from a PNG's IHDR. */
function pngSize(rel) {
  const b = fs.readFileSync(path.join(ROOT, rel));
  assert.equal(b.toString('latin1', 1, 4), 'PNG', rel);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('the wordmark: outline SVGs (no font, no outside image) rendered into the logo files at their old sizes', () => {
  for (const f of ['public/assets/art/wordmark.svg', 'public/assets/art/wordmark-wide.svg']) {
    const svg = read(f);
    assert.match(svg, /aria-label="Harness Hollow"/, f);
    assert.match(svg, /<title>Harness Hollow<\/title>/, f);
    assert.doesNotMatch(svg, /<text|font-family|@font-face|https?:\/\/(?!www\.w3\.org\/2000\/svg)/, `${f}: letters are outlines, nothing is fetched`);
  }
  assert.deepEqual(pngSize('public/assets/art/logo.png'), [1200, 538]);
  assert.deepEqual(pngSize('public/assets/art/logo-wide.png'), [1400, 336]);
  const manifest = JSON.parse(read('public/assets/art/manifest.json'));
  for (const [key, name] of [['stacked', 'logo'], ['wide', 'logo-wide']]) {
    for (const ext of ['png', 'webp']) {
      const e = manifest.logo[key][ext];
      assert.equal(e.file, `${name}.${ext}`);
      assert.equal(fs.statSync(path.join(ROOT, 'public/assets/art', e.file)).size, e.bytes, `${e.file}: the manifest's bytes`);
    }
  }
});
