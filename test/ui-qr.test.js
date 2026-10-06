// The QR code of the personal farm link (public/js/ui/qr.js, an MIT encoder written for the game) and its reader
// (public/js/ui/qr-read.js, the in-app scanner's): the encoder against the standard's worked example and tables, and a
// full round trip through the reader, oddly scaled, noisy and damaged pictures included.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const ID = 'abcdefghij23';
const SECRET = 'a'.repeat(64);
const ORIGIN = 'https://hh.test';
const REJOIN = '0123456789abcdef0123456789abcdef';
installDom();

let Q;
let R;
// before this change the modules do not exist: each test then fails on its own assertion, not on the import
const load = (p) => import(p).catch(() => ({}));
before(async () => {
  Q = await load('../public/js/ui/qr.js');
  R = await load('../public/js/ui/qr-read.js');
});

/** A QR code drawn as an RGBA picture: `scale` px per module (may be fractional), a quiet zone, a little grey noise. */
function picture(code, { scale = 6, quiet = 4, noise = 0, flip = [] } = {}) {
  const n = code.size;
  const w = Math.round((n + 2 * quiet) * scale);
  const data = new Uint8ClampedArray(w * w * 4);
  const bad = new Set(flip.map(([x, y]) => `${x},${y}`));
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let py = 0; py < w; py++) {
    for (let px = 0; px < w; px++) {
      const mx = Math.floor(px / scale) - quiet;
      const my = Math.floor(py / scale) - quiet;
      let dark = mx >= 0 && my >= 0 && mx < n && my < n && code.get(mx, my);
      if (bad.has(`${mx},${my}`)) dark = !dark;
      const v = Math.max(0, Math.min(255, (dark ? 30 : 235) + Math.round((rnd() - 0.5) * noise)));
      const i = (py * w + px) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: w };
}

test('QR: the Reed-Solomon error words match the standard\'s worked example ("HELLO WORLD", version 1-Q)', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236];
  assert.deepEqual(Q.rsRemainder(data, 13), [168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16]);
});

test('QR: format and version information match the standard\'s tables; sizes and capacities are right', () => {
  assert.equal(Q.formatBits('L', 0), 0b111011111000100);
  assert.equal(Q.formatBits('M', 0), 0b101010000010010);
  assert.equal(Q.formatBits('Q', 0), 0b011010101011111);
  assert.equal(Q.formatBits('H', 0), 0b001011010001001);
  assert.equal(Q.versionBits(7), 0b000111110010010100);
  // byte-mode capacity at level M (ISO 18004 table 7): 14 bytes in version 1, 122 in 7, 213 in 10
  assert.equal(Q.qrCode('x'.repeat(14)).version, 1);
  assert.equal(Q.qrCode('x'.repeat(15)).version, 2);
  assert.equal(Q.qrCode('x'.repeat(122)).version, 7);
  assert.equal(Q.qrCode('x'.repeat(123)).version, 8);
  assert.equal(Q.qrCode('x'.repeat(213)).version, 10);
  assert.throws(() => Q.qrCode('x'.repeat(400)), /too long/i);
  const c = Q.qrCode(`${ORIGIN}/f/${ID}#k=${SECRET}`);
  assert.equal(c.size, 17 + 4 * c.version);
  // the three finder patterns: dark 7x7 rings with a dark 3x3 centre, light separators
  for (const [ox, oy] of [[0, 0], [c.size - 7, 0], [0, c.size - 7]]) {
    assert.ok(c.get(ox, oy) && c.get(ox + 6, oy + 6) && !c.get(ox + 1, oy + 1) && c.get(ox + 3, oy + 3));
  }
  // the timing pattern alternates
  for (let i = 8; i < c.size - 8; i++) assert.equal(c.get(i, 6), i % 2 === 0);
});

test('QR: a personal link and a rejoin link round-trip through the reader, also scaled oddly, noisy and damaged', () => {
  const links = [
    `${ORIGIN}/f/${ID}#k=${SECRET}`,
    `https://harvest-hollow.up.railway.app/f/${ID}?rejoin=${REJOIN}`,
    'HELLO WORLD',
    'ünïcødé 🌻 farm',
  ];
  for (const text of links) {
    const code = Q.qrCode(text);
    assert.equal(R.readQr(picture(code)), text, `scale 6: ${text.slice(0, 30)}`);
    assert.equal(R.readQr(picture(code, { scale: 4.6, noise: 60 })), text, `scale 4.6 with noise: ${text.slice(0, 30)}`);
    // a few wrong modules in the data area: the error correction repairs them
    const flip = [[code.size - 1, code.size - 1], [code.size - 3, code.size - 9], [10, code.size - 2], [12, 12]];
    assert.equal(R.readQr(picture(code, { scale: 5, flip })), text, `damaged: ${text.slice(0, 30)}`);
  }
  // no code in the picture: null, never a throw
  const blank = { data: new Uint8ClampedArray(200 * 200 * 4).fill(255), width: 200, height: 200 };
  assert.equal(R.readQr(blank), null);
});

test('QR: drawn as one accessible SVG path with a quiet zone', () => {
  const svg = Q.qrSvg(`${ORIGIN}/f/${ID}#k=${SECRET}`, { label: 'QR code of your personal farm link' });
  assert.equal(svg.tagName, 'SVG');
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(svg.getAttribute('aria-label'), 'QR code of your personal farm link');
  const code = Q.qrCode(`${ORIGIN}/f/${ID}#k=${SECRET}`);
  assert.equal(svg.getAttribute('viewBox'), `0 0 ${code.size + 8} ${code.size + 8}`);
  assert.ok(svg.innerHTML.includes('<path') || svg.querySelector('path'));
});

