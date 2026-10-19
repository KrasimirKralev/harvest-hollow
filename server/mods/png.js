// A minimal PNG codec for the mod icons (contract §1.4: no dependency): decode 8-bit RGBA non-interlaced PNGs (every
// icon tools/make-icons.mjs writes), recolour, encode RGBA with filter 0 and node:zlib.
//   decodePng(buf) -> { width, height, data: Uint8Array RGBA }
//   encodePng({ width, height, data }) -> Buffer
//   recolorPng(buf, from | null, to, kind?) -> { png, alpha, changed }   'recolor': saturated pixels near `from`'s hue
//                                                (the icon's dominant hue when null) rotated to `to`; 'tint': pale,
//                                                unsaturated parts (a coat) tinted toward `to`
import zlib from 'node:zlib';
import { makeShifter, makeTinter, dominantHue, hueGap, rgbHex } from '../../shared/mod/colour.js';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('only 8-bit RGBA non-interlaced PNGs');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!width || !height || width > 4096 || height > 4096) throw new Error('bad PNG size');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[o + x - 4] : 0;
      const b = y > 0 ? out[o - stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[o - stride + x - 4] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (f !== 0) throw new Error(`bad PNG filter ${f}`);
      out[o + x] = v & 255;
    }
  }
  return { width, height, data: out };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

export function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Recolour an icon: { png: Buffer, alpha: count of visible pixels, changed: count of shifted pixels, mean: '#RRGGBB'
 * of the shifted pixels (or null) }. Release 1.0 (harvey#12): when the def's colour is far (> 25 degrees) from the
 * icon's own dominant hue, the icon's hue is what moves (a watermelon icon is darker green than its def's colour).
 */
export function recolorPng(buf, from, to, kind = 'recolor') {
  const img = decodePng(buf);
  const d = img.data;
  let src = from;
  const triples = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) triples.push([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]);
  if (!src || kind === 'tint') src = dominantHue(triples, kind === 'tint' ? 0.1 : 0.25);
  else {
    const own = dominantHue(triples, 0.25);
    if (own && hueGap(own, src) > 25) src = own;
  }
  const shift = kind === 'tint' ? makeTinter(to, src) : src ? makeShifter(src, to) : null;
  let alpha = 0;
  let changed = 0;
  const acc = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    alpha++;
    if (!shift) continue;
    const [r, g, b] = shift(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    const nr = Math.round(r * 255);
    const ng = Math.round(g * 255);
    const nb = Math.round(b * 255);
    if (nr !== d[i] || ng !== d[i + 1] || nb !== d[i + 2]) { changed++; acc[0] += nr; acc[1] += ng; acc[2] += nb; }
    d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
  }
  return { png: encodePng(img), alpha, changed, mean: changed ? rgbHex(acc.map((v) => v / changed)) : null };
}
