// A small QR code reader (ISO/IEC 18004), written for Harvest Hollow. MIT licence, like the game. It reads a farm
// link back from a picture: a camera frame of another screen (ui/qr-scan.js) or a photo / screenshot of the QR code
// the "Keep your farm safe" card shows. Loaded only when somebody scans.
//
//   readQr({ data, width, height }) -> string | null      RGBA pixels (ImageData); never throws
//   decodeGrid(get, size) -> string | null                 a sampled module grid (get(x, y) -> dark)
//
// Steps: local-mean threshold (Bradley), the three finder patterns (1:1:3:1:1 runs, checked across), the grid size
// from their distance, the bottom-right alignment pattern (version 2 and up), a perspective transform from four
// points, one sample per module; then format bits (nearest valid word), unmask, codewords, Reed-Solomon correction
// (Berlekamp-Massey, Chien, Forney), byte / alphanumeric / numeric segments. A mirrored picture is tried too.
import { BLOCKS, MAX_VERSION, EXP, LOG, gfMul, formatBits, versionBits, formatPlaces, versionPlaces, functionMask, maskBit } from './qr.js';

// ---- the picture -> dark / light ------------------------------------------------------------------------------------
function luminance({ data, width: w, height: h }) {
  const lum = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  return lum;
}

/** One threshold for the whole picture (Otsu): the second try, for an evenly lit screenshot. */
function binarizeGlobal(lum) {
  const hist = new Array(256).fill(0);
  for (const v of lum) hist[v]++;
  const total = lum.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB || wB === total) continue;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / (total - wB);
    const between = wB * (total - wB) * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  const out = new Uint8Array(lum.length);
  for (let i = 0; i < lum.length; i++) out[i] = lum[i] <= t ? 1 : 0;
  return out;
}

/** A threshold per pixel: darker than most of its neighbourhood (Bradley), for camera pictures with uneven light. */
function binarize(lum, w, h) {
  // integral image for the local mean (window about an eighth of the picture: wider than a finder's centre)
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += lum[y * w + x];
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
    }
  }
  const r = Math.max(6, Math.floor(Math.min(w, h) / 16));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
      const n = (y1 - y0) * (x1 - x0);
      out[y * w + x] = lum[y * w + x] * n * 100 < s * 85 - n * 400 ? 1 : 0;
    }
  }
  return out;
}

// ---- finder patterns --------------------------------------------------------------------------------------------------
/** Five runs in the ratio 1:1:3:1:1 (some slack for blur and odd scales). */
function ratioOk(c) {
  const total = c[0] + c[1] + c[2] + c[3] + c[4];
  if (total < 7) return false;
  const m = total / 7;
  const tol = m * 0.7;
  return Math.abs(c[0] - m) < tol && Math.abs(c[1] - m) < tol && Math.abs(c[2] - 3 * m) < 3 * tol
    && Math.abs(c[3] - m) < tol && Math.abs(c[4] - m) < tol;
}

/**
 * Runs through (cx, cy) along (dx, dy): [outer dark, light, centre dark, light, outer dark] and the centre's position
 * along the line, or null.
 */
function crossRuns(bits, w, h, cx, cy, dx, dy, maxRun) {
  const at = (k) => {
    const x = Math.round(cx + dx * k);
    const y = Math.round(cy + dy * k);
    return x < 0 || y < 0 || x >= w || y >= h ? -1 : bits[y * w + x];
  };
  if (at(0) !== 1) return null;
  const c = [0, 0, 0, 0, 0];
  let k = 0;
  while (at(k) === 1 && c[2] <= maxRun) { c[2]++; k--; }
  while (at(k) === 0 && c[1] <= maxRun) { c[1]++; k--; }
  while (at(k) === 1 && c[0] <= maxRun) { c[0]++; k--; }
  const back = c[2];
  k = 1;
  while (at(k) === 1 && c[2] <= maxRun * 3) { c[2]++; k++; }
  const fwd = c[2] - back;
  while (at(k) === 0 && c[3] <= maxRun) { c[3]++; k++; }
  while (at(k) === 1 && c[4] <= maxRun) { c[4]++; k++; }
  if (!ratioOk(c)) return null;
  // centre of the middle run, measured from (cx, cy)
  return { c, total: c.reduce((a, b) => a + b, 0), off: (fwd - back + 1) / 2 };
}

function findFinders(bits, w, h) {
  const found = [];
  const step = Math.max(1, Math.floor(h / 600));
  for (let y = 0; y < h; y += step) {
    // runs of this row
    const runs = [];
    let start = 0;
    for (let x = 1; x <= w; x++) {
      if (x === w || bits[y * w + x] !== bits[y * w + start]) {
        runs.push([bits[y * w + start], start, x - start]);
        start = x;
      }
    }
    for (let k = 0; k + 4 < runs.length; k++) {
      if (runs[k][0] !== 1) continue;
      const c = [runs[k][2], runs[k + 1][2], runs[k + 2][2], runs[k + 3][2], runs[k + 4][2]];
      if (!ratioOk(c)) continue;
      const total = c.reduce((a, b) => a + b, 0);
      const cx = runs[k + 2][1] + runs[k + 2][2] / 2 - 0.5;
      const v = crossRuns(bits, w, h, cx, y, 0, 1, total);
      if (!v || Math.abs(v.total - total) * 5 > 2 * total) continue;
      const cy = y + v.off;
      const hz = crossRuns(bits, w, h, cx, cy, 1, 0, total);
      if (!hz) continue;
      const fx = cx + hz.off;
      // a diagonal check throws out corners of text and dither
      const dg = crossRuns(bits, w, h, fx, cy, 1, 1, total);
      if (!dg) continue;
      const ms = (hz.total + v.total) / 14;
      const same = found.find((f) => Math.abs(f.x - fx) <= f.ms * 2 && Math.abs(f.y - cy) <= f.ms * 2 && Math.abs(f.ms - ms) <= Math.max(1, f.ms * 0.4));
      if (same) {
        same.x = (same.x * same.n + fx) / (same.n + 1);
        same.y = (same.y * same.n + cy) / (same.n + 1);
        same.ms = (same.ms * same.n + ms) / (same.n + 1);
        same.n++;
      } else found.push({ x: fx, y: cy, ms, n: 1 });
    }
  }
  return found;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** The three finders that look most like the corners of one code: ordered [topLeft, topRight, bottomLeft]. */
function pickThree(found) {
  let list = found.filter((f) => f.n >= 2);
  if (list.length < 3) list = found;
  list = list.sort((a, b) => b.n - a.n).slice(0, 12);
  let best = null;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      for (let k = j + 1; k < list.length; k++) {
        const t = [list[i], list[j], list[k]];
        const ms = (t[0].ms + t[1].ms + t[2].ms) / 3;
        if (t.some((f) => Math.abs(f.ms - ms) > ms * 0.5)) continue;
        // the right angle is at the corner opposite the longest side
        const sides = [[dist(t[1], t[2]), 0], [dist(t[0], t[2]), 1], [dist(t[0], t[1]), 2]].sort((a, b) => b[0] - a[0]);
        const tl = t[sides[0][1]];
        const [p, q] = t.filter((f) => f !== tl);
        const a = dist(tl, p);
        const b = dist(tl, q);
        if (a < ms * 10 || b < ms * 10) continue;
        const square = Math.abs(a - b) / Math.max(a, b);
        const hyp = Math.abs(Math.hypot(a, b) - sides[0][0]) / sides[0][0];
        const score = square + hyp * 2 + Math.abs(t[0].ms - t[1].ms) / ms + Math.abs(t[1].ms - t[2].ms) / ms;
        if (score > 0.6) continue;
        if (!best || score < best.score) {
          // top right and bottom left: turning from top right to bottom left is clockwise on screen (y down)
          const cross = (p.x - tl.x) * (q.y - tl.y) - (p.y - tl.y) * (q.x - tl.x);
          best = { score, three: cross > 0 ? [tl, p, q] : [tl, q, p], ms };
        }
      }
    }
  }
  return best;
}

// ---- geometry -------------------------------------------------------------------------------------------------------
/** The homography taking four module-space points to four picture points (8x8 linear system, partial pivoting). */
function homography(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i];
    const [x, y] = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const hh = A.map((row, i) => row[8] / row[i]);
  return (u, v) => {
    const d = hh[6] * u + hh[7] * v + 1;
    return [(hh[0] * u + hh[1] * v + hh[2]) / d, (hh[3] * u + hh[4] * v + hh[5]) / d];
  };
}

/** The bottom-right alignment pattern near its expected place: the best match of its 5x5 picture, or null. */
function findAlignment(bits, w, h, tl, tr, bl, size) {
  const n = size - 7;                          // modules between finder centres
  const ux = (tr.x - tl.x) / n;
  const uy = (tr.y - tl.y) / n;
  const vx = (bl.x - tl.x) / n;
  const vy = (bl.y - tl.y) / n;
  const k = n - 3;                             // the alignment centre is 3 modules in from the corner finders' line
  const ex = tl.x + (ux + vx) * k;
  const ey = tl.y + (uy + vy) * k;
  const ms = Math.hypot(ux, uy);
  // a phone held at a slant moves it well away from where a flat picture puts it
  const reach = Math.max(6, ms * 9);
  const at = (x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi < 0 || yi < 0 || xi >= w || yi >= h ? 0 : bits[yi * w + xi];
  };
  let best = null;
  const stepPx = Math.max(1, ms / 4);
  for (let dy = -reach; dy <= reach; dy += stepPx) {
    for (let dx = -reach; dx <= reach; dx += stepPx) {
      const cx = ex + dx;
      const cy = ey + dy;
      let score = 0;
      for (let j = -2; j <= 2; j++) {
        for (let i = -2; i <= 2; i++) {
          const want = Math.max(Math.abs(i), Math.abs(j)) !== 1 ? 1 : 0;
          if (at(cx + i * ux + j * vx, cy + i * uy + j * vy) === want) score++;
        }
      }
      // a near-perfect match close to the estimate beats a perfect one far away (data can look like it by chance)
      const rank = score - Math.hypot(dx, dy) / (ms * 3);
      if (!best || rank > best.rank) best = { x: cx, y: cy, score, rank };
    }
  }
  return best && best.score >= 22 ? best : null;
}

/** Sample a size x size grid through the homography (one picture point per module centre). */
function sampleGrid(bits, w, h, map, size) {
  const g = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [px, py] = map(x + 0.5, y + 0.5);
      const xi = Math.round(px - 0.5);
      const yi = Math.round(py - 0.5);
      g[y * size + x] = xi < 0 || yi < 0 || xi >= w || yi >= h ? 0 : bits[yi * w + xi];
    }
  }
  return g;
}

// ---- Reed-Solomon correction ------------------------------------------------------------------------------------------
const gfInv = (a) => EXP[255 - LOG[a]];
/** Evaluate a polynomial (coefficients lowest power first) at x. */
function evalLow(p, x) {
  let r = 0;
  for (let i = p.length - 1; i >= 0; i--) r = gfMul(r, x) ^ p[i];
  return r;
}

/** Correct one block in place (data words then error words); false when it has more errors than it can fix. */
export function rsCorrect(block, ecN) {
  const N = block.length;
  const synd = new Array(ecN);
  let bad = false;
  for (let j = 0; j < ecN; j++) {
    let s = 0;
    for (let i = 0; i < N; i++) s = gfMul(s, EXP[j]) ^ block[i];
    synd[j] = s;
    if (s) bad = true;
  }
  if (!bad) return true;
  // Berlekamp-Massey: the error locator (lowest power first)
  let C = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let n = 0; n < ecN; n++) {
    let d = synd[n];
    for (let i = 1; i <= L; i++) d ^= gfMul(C[i] ?? 0, synd[n - i]);
    if (d === 0) { m++; continue; }
    const coef = gfMul(d, gfInv(b));
    const T = C.slice();
    const need = B.length + m;
    while (C.length < need) C.push(0);
    for (let i = 0; i < B.length; i++) C[i + m] ^= gfMul(coef, B[i]);
    if (2 * L <= n) {
      L = n + 1 - L;
      B = T;
      b = d;
      m = 1;
    } else m++;
  }
  if (L === 0 || 2 * L > ecN) return false;
  // Chien search: an error at degree p when C(a^-p) = 0
  const where = [];
  for (let p = 0; p < N; p++) if (evalLow(C, gfInv(EXP[p])) === 0) where.push(p);
  if (where.length !== L) return false;
  // Forney (first root a^0): e = X * Omega(X^-1) / C'(X^-1), Omega = S(x) C(x) mod x^ecN
  const omega = new Array(ecN).fill(0);
  for (let i = 0; i < ecN; i++) for (let j = 0; j <= i && j < C.length; j++) omega[i] ^= gfMul(C[j], synd[i - j]);
  const deriv = [];
  for (let i = 1; i < C.length; i++) deriv.push(i % 2 ? C[i] : 0);
  for (const p of where) {
    const X = EXP[p];
    const Xi = gfInv(X);
    const den = evalLow(deriv, Xi);
    if (!den) return false;
    const e = gfMul(gfMul(X, evalLow(omega, Xi)), gfInv(den));
    block[N - 1 - p] ^= e;
  }
  for (let j = 0; j < ecN; j++) {
    let s = 0;
    for (let i = 0; i < N; i++) s = gfMul(s, EXP[j]) ^ block[i];
    if (s) return false;
  }
  return true;
}

// ---- the grid -> text -----------------------------------------------------------------------------------------------
const ECLS = ['L', 'M', 'Q', 'H'];
const popcount = (v) => { let n = 0; for (; v; v &= v - 1) n++; return n; };

function readFormat(get, size) {
  const [a, b] = formatPlaces(size);
  const word = (places) => places.reduce((acc, [x, y], i) => acc | ((get(x, y) ? 1 : 0) << i), 0);
  const got = [word(a), word(b)];
  let best = null;
  for (const ecl of ECLS) {
    for (let mask = 0; mask < 8; mask++) {
      const want = formatBits(ecl, mask);
      const d = Math.min(popcount(want ^ got[0]), popcount(want ^ got[1]));
      if (!best || d < best.d) best = { ecl, mask, d };
    }
  }
  return best && best.d <= 3 ? best : null;
}

function readVersion(get, size) {
  const v = (size - 17) / 4;
  if (v < 7) return v;
  const places = versionPlaces(size);
  let best = null;
  for (const which of [0, 1]) {
    const got = places.reduce((acc, pair, i) => acc | ((get(pair[which][0], pair[which][1]) ? 1 : 0) << i), 0);
    for (let cand = 7; cand <= MAX_VERSION; cand++) {
      const d = popcount(versionBits(cand) ^ got);
      if (!best || d < best.d) best = { v: cand, d };
    }
  }
  return best && best.d <= 3 ? best.v : null;
}

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** The segments of the data words: byte (UTF-8), alphanumeric, numeric; ECI designators are skipped. */
function parseSegments(words, version) {
  let pos = 0;
  const total = words.length * 8;
  const take = (n) => {
    if (pos + n > total) throw new Error('short');
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | ((words[(pos + i) >>> 3] >>> (7 - ((pos + i) & 7))) & 1);
    }
    pos += n;
    return v >>> 0;
  };
  const bytes = [];
  let text = '';
  const flush = () => { if (bytes.length) { text += new TextDecoder('utf-8').decode(Uint8Array.from(bytes)); bytes.length = 0; } };
  const small = version < 10;
  while (pos + 4 <= total) {
    const mode = take(4);
    if (mode === 0) break;
    if (mode === 0b0100) {
      const n = take(small ? 8 : 16);
      for (let i = 0; i < n; i++) bytes.push(take(8));
    } else if (mode === 0b0010) {
      flush();
      let n = take(small ? 9 : 11);
      while (n >= 2) { const v = take(11); text += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; n -= 2; }
      if (n === 1) text += ALNUM[take(6)];
    } else if (mode === 0b0001) {
      flush();
      let n = take(small ? 10 : 12);
      while (n >= 3) { text += String(take(10)).padStart(3, '0'); n -= 3; }
      if (n === 2) text += String(take(7)).padStart(2, '0');
      else if (n === 1) text += String(take(4));
    } else if (mode === 0b0111) {
      const first = take(8);
      if ((first & 0x80) === 0x80) take((first & 0xc0) === 0x80 ? 8 : 16);
    } else {
      return null;                              // a mode a farm link never uses (Kanji, structured append...)
    }
  }
  flush();
  return text;
}

/** Decode a sampled grid (see the header). */
export function decodeGrid(get, size) {
  try {
    if (size < 21 || (size - 17) % 4) return null;
    const version = readVersion(get, size);
    if (!version || version > MAX_VERSION || 17 + 4 * version !== size) return null;
    const fmt = readFormat(get, size);
    if (!fmt) return null;
    const { func } = functionMask(version);
    const words = [];
    let cur = 0;
    let nbits = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
          if (func[y * size + x]) continue;
          const bit = (get(x, y) ? 1 : 0) ^ (maskBit(fmt.mask, x, y) ? 1 : 0);
          cur = (cur << 1) | bit;
          if (++nbits === 8) { words.push(cur); cur = 0; nbits = 0; }
        }
      }
    }
    const [ec, b1, d1, b2, d2] = BLOCKS[fmt.ecl][version - 1];
    const nb = b1 + b2;
    const lens = Array.from({ length: nb }, (_, i) => (i < b1 ? d1 : d2));
    const blocks = lens.map((len) => new Array(len + ec));
    let k = 0;
    for (let i = 0; i < Math.max(d1, d2); i++) for (let b = 0; b < nb; b++) if (i < lens[b]) blocks[b][i] = words[k++];
    for (let i = 0; i < ec; i++) for (let b = 0; b < nb; b++) blocks[b][lens[b] + i] = words[k++];
    const data = [];
    for (let b = 0; b < nb; b++) {
      if (blocks[b].some((x) => x === undefined)) return null;
      if (!rsCorrect(blocks[b], ec)) return null;
      data.push(...blocks[b].slice(0, lens[b]));
    }
    return parseSegments(data, version);
  } catch {
    return null;
  }
}

/** Read a QR code in an RGBA picture (see the header). */
export function readQr(img) {
  try {
    const { width: w, height: h } = img;
    if (!(w > 20 && h > 20)) return null;
    const lum = luminance(img);
    for (const bits of [binarize(lum, w, h), binarizeGlobal(lum)]) {
      const text = readBits(bits, w, h);
      if (text !== null) return text;
    }
    return null;
  } catch {
    return null;
  }
}

function readBits(bits, w, h) {
  const pick = pickThree(findFinders(bits, w, h));
  if (!pick) return null;
  const [tl, tr, bl] = pick.three;
  // the module size along the code's own axes (rows and columns cut a turned code's finders on the slant)
  const along = (f, to) => {
    const d = dist(f, to);
    const r = crossRuns(bits, w, h, f.x, f.y, (to.x - f.x) / d, (to.y - f.y) / d, pick.ms * 7);
    return r ? r.total / 7 : null;
  };
  const avg = (list) => { const ok = list.filter((x) => x); return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : pick.ms; };
  const msU = avg([along(tl, tr), along(tr, tl)]);
  const msV = avg([along(tl, bl), along(bl, tl)]);
  const est = (dist(tl, tr) / msU + dist(tl, bl) / msV) / 2 + 7;
  const v0 = Math.round((est - 17) / 4);
  for (const v of [v0, v0 - 1, v0 + 1, v0 - 2, v0 + 2]) {
    if (v < 1 || v > MAX_VERSION) continue;
    const size = 17 + 4 * v;
    const corners = [];
    if (v >= 2) {
      const al = findAlignment(bits, w, h, tl, tr, bl, size);
      if (al) corners.push([[size - 6.5, size - 6.5], [al.x + 0.5, al.y + 0.5]]);
    }
    corners.push([[size - 3.5, size - 3.5], [tr.x + bl.x - tl.x + 0.5, tr.y + bl.y - tl.y + 0.5]]);
    for (const [src4, dst4] of corners) {
      const map = homography([[3.5, 3.5], [size - 3.5, 3.5], [3.5, size - 3.5], src4],
        [[tl.x + 0.5, tl.y + 0.5], [tr.x + 0.5, tr.y + 0.5], [bl.x + 0.5, bl.y + 0.5], dst4]);
      if (!map) continue;
      const g = sampleGrid(bits, w, h, map, size);
      const text = decodeGrid((x, y) => g[y * size + x] === 1, size)
        ?? decodeGrid((x, y) => g[x * size + y] === 1, size);         // a mirrored picture
      if (text !== null) return text;
    }
  }
  return null;
}
