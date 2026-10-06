// A tiny QR code encoder (ISO/IEC 18004), written for Harvest Hollow. MIT licence, like the game. No dependency and
// no network: the personal farm link is turned into a picture on the device, and nothing about it leaves the page.
//
// Byte mode (UTF-8), versions 1 to 10 (up to 213 bytes at level M: a farm link is about 130), error correction
// L / M / Q / H, and the mask with the lowest penalty score.
//
//   qrCode(text, { ecl = 'M' }) -> { version, size, ecl, mask, modules, get(x, y) -> boolean (dark) }
//   qrSvg(text, { ecl, quiet = 4, label }) -> <svg role="img" aria-label> one path, viewBox in modules
//   rsRemainder(data, n), formatBits(ecl, mask), versionBits(version)   the standard's pieces (tests)
//   BLOCKS, functionMask(version), maskBit(mask, x, y)                    shared with the reader (ui/qr-read.js)

/** Error correction level -> its two format bits. */
const ECL_BITS = Object.freeze({ L: 1, M: 0, Q: 3, H: 2 });
export const MAX_VERSION = 10;

/**
 * ISO/IEC 18004 table 9, versions 1-10: [error words per block, blocks in group 1, data words each, blocks in
 * group 2, data words each].
 */
export const BLOCKS = Object.freeze({
  L: [[7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0], [18, 2, 68, 0, 0],
    [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69]],
  M: [[10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]],
  Q: [[13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0], [18, 2, 15, 2, 16], [24, 4, 19, 0, 0],
    [18, 2, 14, 4, 15], [22, 4, 18, 2, 19], [20, 4, 16, 4, 17], [24, 6, 19, 2, 20]],
  H: [[17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0], [22, 2, 11, 2, 12], [28, 4, 15, 0, 0],
    [26, 4, 13, 1, 14], [26, 4, 14, 2, 15], [24, 4, 12, 4, 13], [28, 6, 15, 2, 16]],
});

/** Alignment pattern centres per version (table E.1), versions 1-10. */
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// ---- GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1 -------------------------------------------------------
export const EXP = new Uint8Array(512);
export const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
export const gfMul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** The generator polynomial of degree n (roots a^0 .. a^(n-1)), highest power first, leading 1. */
function generator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

/** The n Reed-Solomon error correction words of `data` (the remainder of data(x) * x^n divided by the generator). */
export function rsRemainder(data, n) {
  const g = generator(n);
  const r = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ r[0];
    r.shift();
    r.push(0);
    for (let j = 0; j < n; j++) r[j] ^= gfMul(g[j + 1], f);
  }
  return r;
}

/** The 15 format bits (level + mask, BCH(15,5), masked with 101010000010010). */
export function formatBits(ecl, mask) {
  const data = (ECL_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

/** The 18 version bits of versions 7 and up (BCH(18,6)). */
export function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | (rem & 0xfff);
}

/** True where mask `m` flips the module in column x, row y. */
export function maskBit(m, x, y) {
  switch (m) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** The places of the 15 format bits: [x, y] of bit i in the first copy (around the top-left finder) and the second. */
export function formatPlaces(size) {
  const a = [];
  const b = [];
  for (let i = 0; i <= 5; i++) a.push([8, i]);
  a.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) a.push([14 - i, 8]);
  for (let i = 0; i < 8; i++) b.push([size - 1 - i, 8]);
  for (let i = 8; i < 15; i++) b.push([8, size - 15 + i]);
  return [a, b];
}

/** The places of the 18 version bits, both copies: [[x, y] first, [x, y] second] for bit i. */
export function versionPlaces(size) {
  const out = [];
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    out.push([[a, b], [b, a]]);
  }
  return out;
}

/**
 * The function patterns of a version (finders with separators, timing, alignment, the dark module, the format and
 * version areas): { size, dark: Uint8Array (their colour), func: Uint8Array (1 = not a data module) }.
 */
export function functionMask(version) {
  const size = 17 + 4 * version;
  const dark = new Uint8Array(size * size);
  const func = new Uint8Array(size * size);
  const set = (x, y, d) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    dark[y * size + x] = d ? 1 : 0;
    func[y * size + x] = 1;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  }
  const al = ALIGN[version - 1];
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  const [fa, fb] = formatPlaces(size);
  for (const [x, y] of [...fa, ...fb]) set(x, y, false);
  set(8, size - 8, true);                       // the dark module
  if (version >= 7) {
    const bits = versionBits(version);
    versionPlaces(size).forEach(([[x1, y1], [x2, y2]], i) => {
      const d = ((bits >>> i) & 1) === 1;
      set(x1, y1, d);
      set(x2, y2, d);
    });
  }
  return { size, dark, func };
}

/** Data words that fit a version and level. */
const dataWords = (version, ecl) => {
  const [, b1, d1, b2, d2] = BLOCKS[ecl][version - 1];
  return b1 * d1 + b2 * d2;
};

/** The data words of `bytes` in byte mode, terminated and padded (null when they do not fit). */
function encodeData(bytes, version, ecl) {
  const cap = dataWords(version, ecl) * 8;
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  if (bits.length > cap) return null;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out.push(v);
  }
  for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Split into blocks, add each block's error words, interleave (data words column by column, then error words). */
function interleave(data, version, ecl) {
  const [ec, b1, d1, b2, d2] = BLOCKS[ecl][version - 1];
  const blocks = [];
  let k = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const d = data.slice(k, k + (i < b1 ? d1 : d2));
    k += d.length;
    blocks.push({ d, e: rsRemainder(d, ec) });
  }
  const out = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

/** The penalty score of a finished matrix (ISO 18004 7.8.3): runs, 2x2 blocks, finder look-alikes, dark balance. */
function penalty(m, size) {
  let p = 0;
  const at = (x, y) => m[y * size + x];
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      let window = 0;
      for (let b = 0; b < size; b++) {
        const v = pass ? at(a, b) : at(b, a);
        if (b > 0) {
          const prev = pass ? at(a, b - 1) : at(b - 1, a);
          if (v === prev) {
            run++;
            if (run === 5) p += 3;
            else if (run > 5) p += 1;
          } else run = 1;
        }
        window = ((window << 1) | v) & 0x7ff;
        if (b >= 10 && (window === 0b10111010000 || window === 0b00001011101)) p += 40;
      }
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = at(x, y);
      if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) p += 3;
    }
  }
  let darkN = 0;
  for (const v of m) darkN += v;
  const total = size * size;
  p += Math.floor(Math.abs(darkN * 20 - total * 10) / total) * 10;
  return p;
}

const utf8 = (s) => new TextEncoder().encode(String(s));

/** Encode `text` (see the header). Throws when it is longer than version 10 holds at that level. */
export function qrCode(text, { ecl = 'M' } = {}) {
  if (!Object.hasOwn(ECL_BITS, ecl)) throw new Error(`unknown error correction level ${ecl}`);
  const bytes = utf8(text);
  let version = 0;
  let data = null;
  for (let v = 1; v <= MAX_VERSION && !data; v++) {
    data = encodeData(bytes, v, ecl);
    if (data) version = v;
  }
  if (!data) throw new Error('QR code: the text is too long');
  const words = interleave(data, version, ecl);
  const { size, dark, func } = functionMask(version);
  const base = Uint8Array.from(dark);
  // the data bits, two columns at a time, bottom right first, up and down in turn, skipping the timing column
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (func[y * size + x]) continue;
        if (i < words.length * 8) base[y * size + x] = (words[i >>> 3] >>> (7 - (i & 7))) & 1;
        i++;
      }
    }
  }
  const [fa, fb] = formatPlaces(size);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = Uint8Array.from(base);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!func[y * size + x] && maskBit(mask, x, y)) m[y * size + x] ^= 1;
    }
    const fbits = formatBits(ecl, mask);
    for (let k = 0; k < 15; k++) {
      const d = (fbits >>> k) & 1;
      m[fa[k][1] * size + fa[k][0]] = d;
      m[fb[k][1] * size + fb[k][0]] = d;
    }
    const score = penalty(m, size);
    if (!best || score < best.score) best = { m, mask, score };
  }
  const modules = best.m;
  return { version, size, ecl, mask: best.mask, modules, get: (x, y) => modules[y * size + x] === 1 };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The code as one SVG path (runs of dark modules merged per row) on a light square with a quiet zone. */
export function qrSvg(text, { ecl = 'M', quiet = 4, label = 'QR', doc = globalThis.document } = {}) {
  const code = qrCode(text, { ecl });
  const n = code.size + 2 * quiet;
  let d = '';
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (!code.get(x, y)) continue;
      let len = 1;
      while (x + len < code.size && code.get(x + len, y)) len++;
      d += `M${x + quiet} ${y + quiet}h${len}v1h-${len}z`;
      x += len - 1;
    }
  }
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.classList?.add('qr');
  const bg = doc.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(n));
  bg.setAttribute('height', String(n));
  bg.setAttribute('fill', '#fff');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000');
  svg.append(bg, path);
  return svg;
}
