// The sound assets (SV-05 asset half, wave 2): every sample ships as Ogg Opus with its WAV as the per-file fallback,
// the Ogg files are well-formed (pages, CRCs, granules that trim the encoder's padding), loops are framed so the
// decoder's end trim fits inside the last packet, and the runtime picks Ogg only where the browser decodes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oggCrc, oggPage, muxOggOpus, opusHead, loopPads } from '../tools/make-sfx.mjs';
import { sampleFile } from '../public/js/audio.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'audio');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

/** Parse an Ogg file into pages: { flags, granule, serial, seq, crcOk, packets } (packets split by lacing). */
function parseOgg(buf) {
  const pages = [];
  let i = 0;
  let carry = [];
  while (i < buf.length) {
    assert.equal(buf.toString('latin1', i, i + 4), 'OggS', `page magic at ${i}`);
    const nseg = buf[i + 26];
    const lacing = [...buf.subarray(i + 27, i + 27 + nseg)];
    const body = lacing.reduce((a, b) => a + b, 0);
    const len = 27 + nseg + body;
    const page = Buffer.from(buf.subarray(i, i + len));
    const stored = page.readUInt32LE(22);
    page.writeUInt32LE(0, 22);
    const packets = [];
    let off = i + 27 + nseg;
    for (const l of lacing) {
      carry.push(buf.subarray(off, off + l));
      off += l;
      if (l < 255) { packets.push(Buffer.concat(carry)); carry = []; }
    }
    pages.push({ flags: buf[i + 5], granule: Number(buf.readBigInt64LE(i + 6)), serial: buf.readUInt32LE(i + 14), seq: buf.readUInt32LE(i + 18),
      crcOk: oggCrc(page) === stored, packets });
    i += len;
  }
  return pages;
}

test('the Ogg CRC is the spec CRC-32 (poly 0x04c11db7, no reflection, init 0)', () => {
  assert.equal(oggCrc(Buffer.from('123456789')), 0x89a1897f);
  assert.equal(oggCrc(Buffer.alloc(0)), 0);
});

test('muxOggOpus: OpusHead + OpusTags pages, audio pages with monotonic granules, the last one trims to the length', () => {
  const sizes = Array(40).fill(960);
  const packets = sizes.map((_, k) => Buffer.alloc(k === 3 ? 600 : 120 + (k % 7) * 3, k));   // one packet needs 3 lacing values
  const samples = 40 * 960 - 312 - 500;
  const ogg = muxOggOpus({ preSkip: 312, packets, sizes, samples, serial: 0xabc });
  const pages = parseOgg(ogg);
  assert.ok(pages.every((p) => p.crcOk), 'every CRC checks');
  assert.ok(pages.every((p) => p.serial === 0xabc));
  assert.deepEqual(pages.map((p) => p.seq), pages.map((_, k) => k), 'page sequence numbers');
  assert.equal(pages[0].flags, 2, 'BOS on the first page');
  assert.equal(pages.at(-1).flags, 4, 'EOS on the last page');
  assert.equal(pages[0].packets[0].toString('latin1', 0, 8), 'OpusHead');
  assert.equal(pages[0].packets[0].readUInt16LE(10), 312, 'pre-skip');
  assert.equal(pages[1].packets[0].toString('latin1', 0, 8), 'OpusTags');
  const audio = pages.slice(2).flatMap((p) => p.packets);
  assert.deepEqual(audio.map((p) => p.length), packets.map((p) => p.length), 'every packet survives the lacing');
  const gr = pages.slice(2).map((p) => p.granule);
  for (let k = 1; k < gr.length; k++) assert.ok(gr[k] > gr[k - 1], 'granules grow');
  assert.equal(gr.at(-1), 312 + samples, 'the last granule = pre-skip + the wanted length (end trim)');
  assert.throws(() => muxOggOpus({ preSkip: 312, packets: packets.slice(0, 2), sizes: sizes.slice(0, 2), samples: 5000, serial: 1 }), /hold/);
});

test('an OpusHead is 19 bytes: version 1, mono, pre-skip, input rate, gain 0, family 0', () => {
  const h = opusHead(1234, 32000);
  assert.equal(h.length, 19);
  assert.deepEqual([h[8], h[9], h.readUInt16LE(10), h.readUInt32LE(12), h.readInt16LE(16), h[18]], [1, 1, 1234, 32000, 0, 0]);
});

test('loop framing: the loop ends ~240 samples into a 20 ms packet, so the end trim stays inside the last packet', () => {
  for (const n of [42_240, 160_000, 192_000, 224_000, 256_000, 12_345, 99_999, 200_001]) {
    const { warm, post } = loopPads(n);
    const end = 312 + Math.round(warm * 1.5) + Math.round(n * 1.5);
    assert.ok(Math.abs((end % 960) - 240) <= 1, `n ${n}: the loop ends at ${end % 960} of a packet`);
    assert.ok(Math.round(post * 1.5) >= 312 + 120, 'the post-roll covers the codec look-ahead and overlap');
    assert.ok(Math.round(post * 1.5) + 240 < 960, 'trim < one packet');
  }
});

test('every sound ships as Ogg Opus with its WAV fallback; the files on disk match the manifest', () => {
  const names = Object.keys(MANIFEST.sounds);
  assert.ok(names.length >= 85, `${names.length} sounds`);
  let ogg = 0;
  let wav = 0;
  for (const [name, s] of Object.entries(MANIFEST.sounds)) {
    assert.equal(s.file, `${name}.wav`);
    assert.equal(s.ogg, `${name}.ogg`, `${name}: an Ogg`);
    const o = fs.readFileSync(path.join(DIR, s.ogg));
    const pages = parseOgg(o);
    assert.ok(pages.every((p) => p.crcOk), `${name}: CRCs`);
    assert.equal(pages[0].packets[0].toString('latin1', 0, 8), 'OpusHead', `${name}: OpusHead`);
    assert.equal(pages.at(-1).flags & 4, 4, `${name}: EOS`);
    // the decoded length (granule - pre-skip) at 48 kHz is the WAV's length at 32 kHz x 1.5
    const preSkip = pages[0].packets[0].readUInt16LE(10);
    const wavBytes = fs.statSync(path.join(DIR, s.file)).size;
    const n32 = (wavBytes - 44) / 2;
    assert.ok(Math.abs(pages.at(-1).granule - preSkip - Math.round(n32 * 1.5)) <= 1, `${name}: length`);
    ogg += o.length;
    wav += wavBytes;
  }
  // the cold-load win (integration-qa1 "What remains" #3): Opus is a fraction of the PCM
  assert.ok(ogg < 1_100_000, `Ogg total ${Math.round(ogg / 1024)} KB`);
  assert.ok(ogg * 5 < wav, `Ogg ${Math.round(ogg / 1024)} KB vs WAV ${Math.round(wav / 1024)} KB`);
});

test('sampleFile: Ogg where the browser decodes Opus, the WAV otherwise (and for an entry without an Ogg)', () => {
  assert.equal(sampleFile({ file: 'a.wav', ogg: 'a.ogg' }, true), 'a.ogg');
  assert.equal(sampleFile({ file: 'a.wav', ogg: 'a.ogg' }, false), 'a.wav');
  assert.equal(sampleFile({ file: 'a.wav' }, true), 'a.wav');
});
