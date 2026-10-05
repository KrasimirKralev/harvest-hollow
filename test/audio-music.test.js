// The music director (owner request 2026-10-04: composed tracks instead of only the generative engine): the scene for
// each situation, the pool per scene, no track twice in a row, failed tracks and the generative fallback, the format
// choice, and the shipped files: tracks.json, both encodings of every track, CREDITS.md naming every track, the 20 MB
// budget, and the music staying out of the one-request sound pack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { musicContext, musicPool, pickTrack, musicFormats, MUSIC_CONTEXTS, MUSIC_FALLBACK } from '../public/js/audio.js';
import { MOOD_LABELS, moodText } from '../public/js/ui/settings.js';
import { StaticFiles } from '../server/static.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'public', 'assets', 'audio', 'music');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(DIR, 'tracks.json'), 'utf8'));
const TRACKS = MANIFEST.tracks;
const MAX_BYTES = 20 * 1000 * 1000;
const ids = (list) => list.map((t) => t.id);

/** A small seeded generator (mulberry32): the same seed, the same picks. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('musicContext: title > fair > Golden Hour > rain > night > dusk > day', () => {
  assert.equal(musicContext({ title: true, fair: true, golden: true, rain: true, light: 0 }), 'title');
  assert.equal(musicContext({ fair: true, golden: true, rain: true, light: 0 }), 'fair');
  assert.equal(musicContext({ golden: true, rain: true, light: 0.2 }), 'evening');
  assert.equal(musicContext({ rain: true, light: 0 }), 'rain');
  assert.equal(musicContext({ rain: true, light: 1, phase: 'day' }), 'rain');
  assert.equal(musicContext({ light: 0, phase: 'night' }), 'night');
  assert.equal(musicContext({ light: 0.3, phase: 'dawn' }), 'night', 'the dark half of dawn is still night');
  assert.equal(musicContext({ light: 0.4, phase: 'dusk' }), 'night', 'the dark end of dusk is night');
  assert.equal(musicContext({ light: 0.9, phase: 'dusk' }), 'evening');
  assert.equal(musicContext({ light: 0.8, phase: 'dawn' }), 'day');
  assert.equal(musicContext({ light: 1, phase: 'day' }), 'day');
  assert.equal(musicContext(), 'day');
  for (const c of Object.keys(MUSIC_FALLBACK)) assert.ok(MUSIC_CONTEXTS.includes(c), c);
});

test('the pool per scene: every scene has music, the everyday scenes at least two tracks', () => {
  assert.deepEqual(ids(musicPool(TRACKS, 'title')), ['title-menu']);
  assert.deepEqual(ids(musicPool(TRACKS, 'day')), ['day-sunflowers', 'day-river', 'day-fishing']);
  assert.deepEqual(ids(musicPool(TRACKS, 'evening')), ['day-sunflowers', 'evening-lake']);
  assert.deepEqual(ids(musicPool(TRACKS, 'night')), ['night-meadow', 'rain-inn']);
  assert.deepEqual(ids(musicPool(TRACKS, 'rain')), ['night-meadow', 'rain-inn']);
  assert.deepEqual(ids(musicPool(TRACKS, 'fair')), ['fair-minstrel']);
  // day, evening, night and rain follow each other all session: two or more each, so "never twice in a row" never
  // has to borrow another scene's music
  for (const c of ['day', 'evening', 'night', 'rain']) assert.ok(musicPool(TRACKS, c).length >= 2, c);
  for (const c of MUSIC_CONTEXTS) assert.ok(musicPool(TRACKS, c).length >= 1, `${c} has a track`);
});

test('pickTrack: never the same track twice in a row, over a long session of changing scenes', () => {
  const rnd = seeded(7);
  let last = null;
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = MUSIC_CONTEXTS[Math.floor(rnd() * MUSIC_CONTEXTS.length)];
    const t = pickTrack(TRACKS, c, { last, random: rnd });
    assert.ok(t, `a track for ${c}`);
    assert.notEqual(t.id, last, `pick ${i} (${c}) repeated ${last}`);
    assert.ok(t.moods.includes(c) || MUSIC_FALLBACK[c].some((f) => t.moods.includes(f)), `${t.id} fits ${c} or its fallback`);
    seen.add(t.id);
    last = t.id;
  }
  assert.deepEqual([...seen].sort(), ids(TRACKS).sort(), 'every track gets played');
});

test('pickTrack: deterministic for an injected random, and stays in its own pool when it can', () => {
  const run = (seed) => {
    const rnd = seeded(seed);
    let last = null;
    const out = [];
    for (let i = 0; i < 40; i++) { last = pickTrack(TRACKS, 'day', { last, random: rnd }).id; out.push(last); }
    return out;
  };
  assert.deepEqual(run(42), run(42));
  assert.notDeepEqual(run(42), run(43));
  assert.ok(run(42).every((id) => id.startsWith('day-')));
  // the random value picks by position in the pool, the last one excluded
  assert.equal(pickTrack(TRACKS, 'day', { last: 'day-river', random: () => 0 }).id, 'day-sunflowers');
  assert.equal(pickTrack(TRACKS, 'day', { last: 'day-river', random: () => 0.999 }).id, 'day-fishing');
  assert.equal(pickTrack(TRACKS, 'night', { last: 'night-meadow', random: () => 0 }).id, 'rain-inn');
});

test('pickTrack: a scene with one track borrows from its fallback rather than repeat it', () => {
  // two Fair ceremonies in a row (the Fair, then a Festival Pavilion tier): the evening music, never the dance twice
  const t = pickTrack(TRACKS, 'fair', { last: 'fair-minstrel', random: () => 0 });
  assert.ok(t.moods.includes('evening'), t.id);
  // a farmer who idles on the title screen past the title tune gets a day track next
  assert.ok(pickTrack(TRACKS, 'title', { last: 'title-menu', random: () => 0.5 }).moods.includes('day'));
});

test('pickTrack: failed tracks are skipped, and with nothing left the generative engine plays (null)', () => {
  const rnd = seeded(3);
  for (let i = 0; i < 200; i++) {
    const t = pickTrack(TRACKS, 'day', { failed: ['day-river', 'day-fishing'], random: rnd });
    assert.equal(t.id, 'day-sunflowers');
  }
  // every day track failed: the day borrows from the evening
  assert.equal(pickTrack(TRACKS, 'day', { failed: ['day-sunflowers', 'day-river', 'day-fishing'], random: () => 0 }).id, 'evening-lake');
  // the only fitting track just played and the other failed: nothing left -> null -> a generative piece
  assert.equal(pickTrack(TRACKS, 'day', { last: 'evening-lake', failed: ['day-sunflowers', 'day-river', 'day-fishing'] }), null);
  assert.equal(pickTrack(TRACKS, 'fair', { failed: ids(TRACKS) }), null);
  assert.equal(pickTrack([], 'day'), null, 'no track list at all');
  // failed accepts any iterable (the director passes an array; a Set works too)
  assert.equal(pickTrack(TRACKS, 'title', { failed: new Set(['title-menu']), random: () => 0 }).moods.includes('day'), true);
});

test('musicFormats: Ogg Vorbis first, AAC for Safari, nothing when neither plays', () => {
  const chrome = (type) => (/ogg|mp4/.test(type) ? 'probably' : '');
  const safari = (type) => (/mp4/.test(type) ? 'maybe' : '');
  assert.deepEqual(musicFormats(chrome), ['ogg', 'm4a']);
  assert.deepEqual(musicFormats(safari), ['m4a']);
  assert.deepEqual(musicFormats(() => ''), []);
  assert.deepEqual(musicFormats(() => { throw new Error('no media'); }), []);
});

test('tracks.json: every entry is complete, unique and credited to a CC0 source page', () => {
  assert.ok(TRACKS.length >= 6 && TRACKS.length <= 10, `${TRACKS.length} tracks`);
  assert.equal(new Set(ids(TRACKS)).size, TRACKS.length, 'unique ids');
  assert.equal(new Set(TRACKS.map((t) => t.file)).size, TRACKS.length, 'unique files');
  for (const t of TRACKS) {
    assert.match(t.id, /^[a-z0-9-]+$/, t.id);
    assert.match(t.file, /^[a-z0-9-]+$/, t.id);
    for (const k of ['title', 'artist', 'by']) assert.ok(typeof t[k] === 'string' && t[k].trim(), `${t.id}.${k}`);
    assert.match(t.url, /^https:\/\/opengameart\.org\/content\/[a-z0-9-]+$/, `${t.id}.url`);
    assert.equal(t.licence, 'CC0', `${t.id}.licence`);
    assert.equal(t.licenceUrl, 'https://creativecommons.org/publicdomain/zero/1.0/');
    assert.match(t.verified, /^\d{4}-\d{2}-\d{2}$/, `${t.id}.verified`);
    assert.ok(t.moods.length && t.moods.every((m) => MUSIC_CONTEXTS.includes(m)), `${t.id}.moods`);
    assert.ok(Number.isFinite(t.gain) && t.gain > 0 && t.gain <= 2, `${t.id}.gain`);
    assert.ok(Number.isInteger(t.key) && t.key >= 0 && t.key < 12, `${t.id}.key`);
    assert.ok(t.seconds >= 45 && t.seconds <= 240, `${t.id}.seconds`);
  }
});

/** The length of an Ogg Vorbis file: the last page's granule position over the identification header's rate. */
function oggSeconds(buf) {
  const id = buf.indexOf('\x01vorbis', 0, 'latin1');
  const rate = buf.readUInt32LE(id + 12);
  const last = buf.lastIndexOf('OggS', buf.length, 'latin1');
  return Number(buf.readBigInt64LE(last + 6)) / rate;
}

/** The top-level boxes of an MP4 file, in order. */
function mp4Boxes(buf) {
  const out = [];
  for (let i = 0; i + 8 <= buf.length;) {
    let size = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    if (size === 1) size = Number(buf.readBigUInt64BE(i + 8));
    out.push(type);
    if (size < 8) break;
    i += size;
  }
  return out;
}

test('every track ships as Ogg Vorbis and as AAC in MP4 (index first, for streaming), at its listed length', () => {
  for (const t of TRACKS) {
    const ogg = fs.readFileSync(path.join(DIR, `${t.file}.ogg`));
    const m4a = fs.readFileSync(path.join(DIR, `${t.file}.m4a`));
    assert.equal(ogg.toString('latin1', 0, 4), 'OggS', `${t.file}.ogg is Ogg`);
    assert.ok(ogg.indexOf('\x01vorbis', 0, 'latin1') > 0, `${t.file}.ogg is Vorbis`);
    assert.ok(Math.abs(oggSeconds(ogg) - t.seconds) < 0.5, `${t.file}.ogg lasts ${oggSeconds(ogg)} s, the list says ${t.seconds}`);
    const boxes = mp4Boxes(m4a);
    assert.equal(boxes[0], 'ftyp', `${t.file}.m4a is MP4`);
    assert.ok(boxes.includes('moov') && boxes.includes('mdat'), `${t.file}.m4a boxes ${boxes}`);
    assert.ok(boxes.indexOf('moov') < boxes.indexOf('mdat'), `${t.file}.m4a: moov before mdat (+faststart), so Safari streams it`);
    assert.ok(m4a.indexOf('mp4a', 0, 'latin1') > 0, `${t.file}.m4a is AAC`);
  }
  // nothing else in the folder: no stray encode, no file the list forgot
  const expected = new Set(['tracks.json', 'CREDITS.md', ...TRACKS.flatMap((t) => [`${t.file}.ogg`, `${t.file}.m4a`])]);
  assert.deepEqual(fs.readdirSync(DIR).filter((n) => !n.startsWith('.')).sort(), [...expected].sort());
});

test('the music stays within 20 MB', () => {
  const total = TRACKS.reduce((a, t) => a + fs.statSync(path.join(DIR, `${t.file}.ogg`)).size + fs.statSync(path.join(DIR, `${t.file}.m4a`)).size, 0);
  assert.ok(total <= MAX_BYTES, `${(total / 1e6).toFixed(2)} MB`);
});

test('CREDITS.md names every track: title, artist, source page, file, licence', () => {
  const md = fs.readFileSync(path.join(DIR, 'CREDITS.md'), 'utf8');
  for (const t of TRACKS) {
    for (const s of [t.title, t.artist, t.url, `\`${t.file}\``]) assert.ok(md.includes(s), `CREDITS.md lacks ${s} (${t.id})`);
    assert.ok(md.includes(`(\`${t.id}\`)`), `CREDITS.md has a section for ${t.id}`);
  }
  assert.match(md, /## How these files were made/);
  assert.ok((md.match(/libvorbis/g) || []).length >= TRACKS.length && (md.match(/-c:a aac/g) || []).length >= TRACKS.length,
    'the exact encode command of every file');
});

test('the Credits view has a label for every scene', () => {
  for (const c of MUSIC_CONTEXTS) assert.ok(MOOD_LABELS[c], c);
  assert.equal(moodText(['day', 'evening']), 'Day · Evening and Golden Hour');
  assert.equal(moodText(['nonsense']), '');
  assert.equal(moodText(undefined), '');
});

test('the music is not in the one-request sound pack (it streams on demand)', () => {
  const files = new StaticFiles({ root: ROOT, log: { warn() {}, error() {}, info() {} } });
  const ix = files.packIndex().index;
  assert.ok(ix.audio, 'the sound pack exists');
  const members = Object.keys(ix.audio.files);
  for (const t of TRACKS) assert.ok(!members.includes(`${t.file}.ogg`), `${t.file}.ogg is not packed`);
  assert.ok(members.every((n) => !n.includes('/')), 'only the top-level sounds');
});
