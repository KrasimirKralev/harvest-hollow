// Boot banner (tech §12, lane brief item 7): every URL the partner could open, the LAN one in big block letters
// so it can be read off the screen from the sofa. The plain "running at" line and http://localhost:<port> stay
// first: tools/shot.mjs, tools/e2e-coop.mjs and the persistence test parse them.
import os from 'node:os';

// 3 x 5 pixel glyphs ('#' = on), drawn two pixel rows per text line with half blocks.
const FONT = {
  0: '###|#.#|#.#|#.#|###', 1: '.#.|##.|.#.|.#.|###', 2: '###|..#|###|#..|###', 3: '###|..#|###|..#|###',
  4: '#.#|#.#|###|..#|..#', 5: '###|#..|###|..#|###', 6: '###|#..|###|#.#|###', 7: '###|..#|..#|..#|..#',
  8: '###|#.#|###|#.#|###', 9: '###|#.#|###|..#|###', ':': '...|.#.|...|.#.|...', '.': '...|...|...|...|.#.',
  '/': '..#|..#|.#.|#..|#..', '-': '...|...|###|...|...', a: '.#.|#.#|###|#.#|#.#', b: '##.|#.#|##.|#.#|##.',
  c: '.##|#..|#..|#..|.##', d: '##.|#.#|#.#|#.#|##.', e: '###|#..|##.|#..|###', f: '###|#..|##.|#..|#..',
  g: '.##|#..|#.#|#.#|.##', h: '#.#|#.#|###|#.#|#.#', i: '###|.#.|.#.|.#.|###', j: '..#|..#|..#|#.#|.#.',
  k: '#.#|#.#|##.|#.#|#.#', l: '#..|#..|#..|#..|###', m: '#.#|###|###|#.#|#.#', n: '##.|#.#|#.#|#.#|#.#',
  o: '.#.|#.#|#.#|#.#|.#.', p: '##.|#.#|##.|#..|#..', q: '.#.|#.#|#.#|##.|.##', r: '##.|#.#|##.|#.#|#.#',
  s: '.##|#..|.#.|..#|##.', t: '###|.#.|.#.|.#.|.#.', u: '#.#|#.#|#.#|#.#|###', v: '#.#|#.#|#.#|#.#|.#.',
  w: '#.#|#.#|###|###|#.#', x: '#.#|#.#|.#.|#.#|#.#', y: '#.#|#.#|.#.|.#.|.#.', z: '###|..#|.#.|#..|###',
  ' ': '...|...|...|...|...',
};
const HALF = { '00': ' ', 10: '▀', '01': '▄', 11: '█' };

/** Render text in 3 x 5 block letters: three lines, four columns per character. Unknown characters are blank. */
export function bigText(text) {
  const rows = ['', '', '', '', '', ''];
  for (const ch of String(text).toLowerCase()) {
    const g = (FONT[ch] || FONT[' ']).split('|');
    for (let r = 0; r < 5; r++) rows[r] += `${g[r]}.`;
    rows[5] += '....';
  }
  const lines = [];
  for (let r = 0; r < 6; r += 2) {
    let s = '';
    for (let c = 0; c < rows[r].length; c++) s += HALF[`${rows[r][c] === '#' ? 1 : 0}${rows[r + 1][c] === '#' ? 1 : 0}`];
    lines.push(s.trimEnd());
  }
  return lines;
}

const SKIP_IFACE = /^(docker|br-|veth|virbr|lxc|cni|flannel|podman)/;
const NO_MAC = '00:00:00:00:00:00';

/**
 * Non-loopback IPv4 addresses the partner might open, best first: the home LAN (an interface with a hardware
 * address; 192.168/16 first), then other addresses, then point-to-point tunnels (no hardware address: a VPN the
 * partner is not on), then Tailscale (100.64/10). Container bridges are skipped.
 * @returns {{ address: string, iface: string, kind: 'lan' | 'other' | 'vpn' | 'tailscale' }[]}
 */
export function lanAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [iface, list] of Object.entries(ifaces)) {
    if (SKIP_IFACE.test(iface)) continue;
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      const [p, q] = a.address.split('.').map(Number);
      const priv = (p === 192 && q === 168) || p === 10 || (p === 172 && q >= 16 && q < 32);
      const kind = p === 100 && q >= 64 && q < 128 ? 'tailscale' : a.mac === NO_MAC ? 'vpn' : priv ? 'lan' : 'other';
      const rank = { lan: p === 192 ? 0 : 1, other: 2, vpn: 3, tailscale: 4 }[kind];
      out.push({ address: a.address, iface, kind, rank });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map(({ rank, ...a }) => a);   // eslint-disable-line no-unused-vars
}

/**
 * The whole banner as one string.
 * @param {{ port: number, dev?: boolean, color?: boolean, addresses?: ReturnType<typeof lanAddresses>,
 *   hostname?: string, dataDir?: string, tz?: string, version?: string }} o
 */
export function banner({ port, dev = false, color = false, addresses = lanAddresses(), hostname = os.hostname(),
  dataDir = '', tz = '', version = '' }) {
  const green = (s) => (color ? `\x1b[1;32m${s}\x1b[0m` : s);
  const dim = (s) => (color ? `\x1b[2m${s}\x1b[0m` : s);
  const bar = '='.repeat(72);
  const lines = [bar, `  Harvest Hollow${version ? ` ${version}` : ''} is running at:`, ''];
  const urls = [[`http://localhost:${port}`, '', ''],
    ...addresses.map((a, i) => [`http://${a.address}:${port}`,
      a.kind === 'tailscale' ? `${a.iface} (Tailscale)` : a.kind === 'vpn' ? `${a.iface} (VPN)` : a.iface,
      i === 0 && a.kind === 'lan' ? '   <- your partner opens this' : '']),
    [`http://${hostname}.local:${port}`, 'mDNS name', '']];
  const width = Math.max(...urls.map(([u]) => u.length)) + 3;
  urls.forEach(([u, label, hint], i) => {
    const pad = label ? u.padEnd(width) : u;
    lines.push(`    ${i === 1 && hint ? green(pad) : pad}${dim(label)}${hint}`);
  });
  lines.push('');
  // Big letters for the addresses the partner can type: the LAN ones (or the first address when there is none).
  const big = addresses.filter((a) => a.kind === 'lan');
  for (const a of big.length ? big : addresses.slice(0, 1)) {
    for (const l of bigText(`${a.address}:${port}`)) lines.push(`    ${green(l)}`);
    lines.push('');
  }
  for (const l of bigText(`localhost:${port}`)) lines.push(`    ${l}`);
  lines.push('');
  if (dataDir || tz) lines.push(dim(`  data ${dataDir}   farm time zone ${tz}`));
  if (dev) lines.push('  DEV MODE: /api/dev/* (time warp, drop, save) on loopback');
  lines.push(bar);
  return lines.join('\n');
}
