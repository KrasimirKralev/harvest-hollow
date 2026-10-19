// The look-and-perf harness (release 1.0, render-look lane; graphics#16, critique#7, #17). One headless Chrome on the
// HARDWARE GPU (ANGLE GL; SwiftShader numbers are never measurements), a COPY of the owners' save, fixed frames on
// desktop 1366x768 and the iPhone 13 profile, and one JSON line out:
//   per frame: GPU ms p50/p90 of the main render (EXT_disjoint_timer_query_webgl2), draw calls, triangles,
//   programs, textures, and look metrics read from the 3D canvas itself (the HUD never counts):
//     world  mean luminance (Rec. 709, 0-255) and HSV saturation of the world area (x 25-75 %, y 16-83 %)
//     lawn   unoccluded, lit lawn pixels: mean RGB, hue, value, luminance SD; lit/shadowed lawn luminance ratio
//     roof   the red roof of the barn (or the reddest building in view): mean hue
//     crown  the farm's tree crowns: mean hue (summer vs autumn)
//     water  changed-pixel share between two frames 1 s apart, glint share (HSV value >= 0.9), mean hue
//     wheat  a ripe Wheat plot (injected client-side, look only): mean hue and saturation
//     rainbow  rainbow pixels inside the owned farm's screen quad (close and far frames); the canvas alone, so a share
//              is the bare canvas with the HUD not counted (QA r2 R2-C1: with the HUD up the owners see ~0.04 %)
//     roof   a close sloped roof at noon (QA r1 R-03: shadow stripes; for the eye, in the grid)
//     edges  QA r3 R3-02 (goldenclose: the farmhouse porch at the closest zoom at golden hour; noonclose the same at noon):
//            how stepped the cast-shadow edges are. The shadow factor M = this frame / the same frame with the sun's
//            shadow intensity 0; a 3 px box of M (what the eye merges: the PCF dither) against a 15 px box; `steps` = the
//            mean |difference| x 1000 over the penumbra (0.15 < M15 < 0.85): a smooth ramp reads near 0, texel stairs high
//     plateaus  QA r4 R4-01 (goldenclose, duskclose, noonclose): flat bands inside the penumbrae (the 4-tap kernel spread
//            under a low sun drew five offset copies of an edge). Down every 2nd column of M (3 columns averaged), each
//            monotone segment (a reversal > 0.05 ends one) that changes by >= 0.35 within 160 px is cut into steps; a step
//            is flat when it moves less than a quarter of the segment's mean slope, and a flat run counts when its level
//            is inside the ramp (15 % away from both ends); `wide` = flat runs longer than 4 CSS px
//            (the fix list's line: 0 on `porch`), `widest` in CSS px, `banded` segments with one; `house` the same over
//            the farmhouse's own pixels, `porch` over the tester's porch columns (CSS x 520-700, y 360-480, desktop).
//            M here is the sun's share from three reads (frame, shadows off, sun off): 0 in full shadow, 1 in full sun
//   and per device: JS heap after GC, the load average at start and end.
// It also writes the FRAME GRID: one PNG per device, the frames side by side, HEAD | this tree when --head is given.
//
//   node tools/look-perf.mjs [--device desk|phone|both] [--head <tree dir>] [--data <save dir>] [--port 4450]
//        [--frames noon,golden,...] [--runs 2] [--out dir] [--json file] [--tag x] [--scratch dir] [--cpu 4]
//        [--scene look|auto] [--gpu-frames 60] [--settle 10000]
//   --head      a second tree (e.g. `git archive fdafb9c` extracted) served on --port + 3; every frame is measured on
//               both in one run (deltas within one run, scope §7.8); a tree without node_modules is hard-linked into
//               the scratch dir with a node_modules link
//   --scene auto  the auto-tier trace instead (G1): desktop, ?quality=auto, a 30 s noon pan and a 30 s night pan, two
//               sessions each (a reload in the same browser profile keeps the remembered tier)
//   --cpu 4     phone: a 6 s pan at CDP CPU throttling x4 (the >= 21 fps line)
//   --scene blip  QA r3 R3-01 (br#1): the model URLs (manifest, packs, GLBs) blocked from the page's start until --block
//               seconds (6) after the welcome, then let through; ok when view.stats() reads placeholders 0 and home 0 (or
//               null: no home in view) within 30 s, with no console error (network warnings are expected); a page
//               screenshot per device at the end (desk EN, phone and small BG unless --lang)
//   --ab kernel  QA r4 R4-01: the desktop shadow lookup's paired GPU cost (shipped vs r4's 4 taps spread to x2) at noon,
//               golden, night and the close frames
//   --scene stats QA r3 R3-03 (va#2): ?stats=1 per device (desk EN, phone and small BG): the readout's rect must not meet
//               a `#hud .pill` (ok), and every other visible HUD control it meets is listed; a page screenshot each
// Run it through `.scratch/release/browser-slot.sh`; lane numbers are advisory, the quiet-window run counts (§2.2).
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer, { KnownDevices } from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const MIN = 60_000;
const T = 40 * MIN;
const port = Number(args.port || 4450);
const scratch = path.resolve(ROOT, args.scratch || '.scratch/look-perf');
const data = path.resolve(ROOT, args.data || '.scratch/box-save-1013');
const outDir = path.resolve(ROOT, args.out || 'docs/qa/release/build/render-look');
const tag = args.tag ? `-${args.tag}` : '';
const scene = args.scene || 'look';
const devices = args.device === 'both' || !args.device ? ['desk', 'phone'] : args.device === 'all' ? ['desk', 'phone', 'small'] : String(args.device).split(',');
const runs = Math.max(1, Number(args.runs || 1));
const gpuFrames = Number(args['gpu-frames'] || 60);
const settleMs = Number(args.settle || 10_000);
const ALL_FRAMES = ['noon', 'golden', 'dusk', 'night', 'rain', 'close', 'roof', 'far', 'autumn', 'water', 'watergold', 'wheat', 'rainbow', 'sky', 'roofprobe', 'roofnight',
  'goldenclose', 'noonclose', 'duskclose'];
const frames = args.frames ? String(args.frames).split(',') : ALL_FRAMES;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = () => fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number);
fs.mkdirSync(scratch, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

/** A tree the server can run: its own node_modules (three is served from it), else a hard-linked copy with a link. */
function runnableTree(dir) {
  const abs = path.resolve(ROOT, dir);
  if (fs.existsSync(path.join(abs, 'node_modules', 'three', 'package.json'))) return abs;
  const copy = path.join(scratch, `tree-${path.basename(abs)}`);
  if (!fs.existsSync(path.join(copy, 'server', 'index.js'))) {
    fs.rmSync(copy, { recursive: true, force: true });
    const r = spawnSync('cp', ['-al', abs, copy]);
    if (r.status !== 0) throw new Error(`cp -al ${abs}: ${r.stderr}`);
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(copy, 'node_modules'));
  }
  return copy;
}

/** A fresh copy of the save with test tokens (the owners' sign-ins never leave their file: only hashes are swapped). */
function prepareSave(name) {
  const dir = path.join(scratch, `save-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(data, dir, { recursive: true });
  const f = path.join(dir, 'farm.json');
  const save = JSON.parse(fs.readFileSync(f, 'utf8'));
  const tokens = {};
  for (const slot of Object.keys(save.server?.auth || {})) {
    tokens[slot] = crypto.randomBytes(16).toString('hex');
    save.server.auth[slot] = { ...save.server.auth[slot], tokenHash: crypto.createHash('sha256').update(tokens[slot]).digest('hex'), extra: [] };
  }
  fs.writeFileSync(f, JSON.stringify(save));
  return { dir, tokens };
}

function startServer(root, p, dataDir) {
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(p), HH_DATA_DIR: dataDir, HH_DEV: '1', HH_HELPER: 'off', HH_TELEMETRY: 'off', HH_ASSET_HOST: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  return { proc, log: () => log, async ready() {
    for (let i = 0; i < 400 && !/running at/.test(log); i++) await sleep(100);
    if (!/running at/.test(log)) throw new Error(`server ${p}: ${log.slice(-1200)}`);
  } };
}

// --------------------------------------------------------------------------------------------------------------
// In-page helpers (installed once per page). Pixel reads render the main scene and copy the drawing buffer in the
// same task (no preserveDrawingBuffer needed).
function installHelpers() {
  const v = window.__hh.view;
  const R = v._internals;
  const L = window.__lp = {};
  const cv = document.createElement('canvas');
  const cx = cv.getContext('2d', { willReadFrequently: true });
  L.read = () => {
    R.renderer.render(R.scene, R.cam.camera);
    cv.width = R.canvas.width; cv.height = R.canvas.height;
    cx.drawImage(R.canvas, 0, 0);
    return cx.getImageData(0, 0, cv.width, cv.height).data;
  };
  L.png = (scale = 1) => {
    R.renderer.render(R.scene, R.cam.camera);
    const c = document.createElement('canvas');
    c.width = Math.round(R.canvas.width * scale); c.height = Math.round(R.canvas.height * scale);
    c.getContext('2d').drawImage(R.canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  };
  L.frames = (n = 3) => new Promise((resolve) => { let k = 0; const f = () => { v.interact(); if (++k >= n) resolve(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
  L.hsv = (r, g, b) => {
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
    let h = 0;
    if (d > 0) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return [h, mx > 0 ? d / mx : 0, mx / 255];
  };
  L.lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const W = () => R.canvas.width; const H = () => R.canvas.height;
  L.area = () => { const w = W(); const h = H(); return [Math.round(w * 0.25), Math.round(h * 0.16), Math.round(w * 0.75), Math.round(h * 0.83)]; };
  L.inArea = (i) => { const w = W(); const x = i % w; const y = (i / w) | 0; const a = L.area(); return x >= a[0] && x < a[2] && y >= a[1] && y < a[3]; };
  /** Mean of a pixel list: rgb, hue (circular), sat, value, lum and its SD. */
  L.stats = (px, idx) => {
    let n = 0; let r = 0; let g = 0; let b = 0; let s = 0; let vv = 0; let l = 0; let l2 = 0; let hx = 0; let hy = 0;
    for (const i of idx) {
      const R0 = px[i * 4]; const G0 = px[i * 4 + 1]; const B0 = px[i * 4 + 2];
      const [h, sa, va] = L.hsv(R0, G0, B0);
      const lu = L.lum(R0, G0, B0);
      r += R0; g += G0; b += B0; s += sa; vv += va; l += lu; l2 += lu * lu; n++;
      hx += Math.cos(h * Math.PI / 180) * sa; hy += Math.sin(h * Math.PI / 180) * sa;
    }
    if (!n) return null;
    let hue = Math.atan2(hy, hx) * 180 / Math.PI; if (hue < 0) hue += 360;
    const m = l / n;
    return { n, rgb: [Math.round(r / n), Math.round(g / n), Math.round(b / n)], hue: +hue.toFixed(1), sat: +(s / n).toFixed(3), value: +(vv / n).toFixed(3),
      lum: +m.toFixed(1), lumSd: +Math.sqrt(Math.max(0, l2 / n - m * m)).toFixed(2) };
  };
  L.world = (px) => {
    const a = L.area(); const w = W(); const idx = [];
    for (let y = a[1]; y < a[3]; y += 2) for (let x = a[0]; x < a[2]; x += 2) idx.push(y * w + x);
    const st = L.stats(px, idx);
    return { lum: st.lum, sat: st.sat, hue: st.hue };
  };
  /** Pixels whose colour differs between two reads (max channel delta > th). */
  L.diff = (a, b, th = 6) => { const out = []; for (let i = 0, n = a.length / 4; i < n; i++) { const d = Math.max(Math.abs(a[i * 4] - b[i * 4]), Math.abs(a[i * 4 + 1] - b[i * 4 + 1]), Math.abs(a[i * 4 + 2] - b[i * 4 + 2])); if (d > th) out.push(i); } return out; };
  /** The lawn masks at the current framing: unoccluded terrain (the frame with every object layer hidden matches),
   *  green in the sun-off frame (ambient only: shadows cannot change the class); lit / shadowed by the sun's share. */
  L.lawnMasks = () => {
    const keep = new Set(['sky', 'terrain']);
    const A = L.read();
    const hidden = Object.entries(R.layers).filter(([k, g]) => !keep.has(k) && g.visible).map(([, g]) => g);
    for (const g of hidden) g.visible = false;
    const sc = R.scenery.mesh.visible; const sm = R.layers.terrain.children.filter((c) => /scenery/.test(c.name) && c.visible);
    for (const c of sm) c.visible = false;
    const C = L.read();
    for (const g of hidden) g.visible = true;
    for (const c of sm) c.visible = true;
    void sc;
    const si = R.sun.intensity; R.sun.intensity = 0;
    const B = L.read();
    R.sun.intensity = si;
    const lawn = []; const contrib = [];
    const a = L.area(); const w = W();
    for (let y = a[1]; y < a[3]; y++) {
      for (let x = a[0]; x < a[2]; x++) {
        const i = y * w + x; const j = i * 4;
        if (Math.max(Math.abs(A[j] - C[j]), Math.abs(A[j + 1] - C[j + 1]), Math.abs(A[j + 2] - C[j + 2])) > 3) continue;
        const [h, s] = L.hsv(B[j], B[j + 1], B[j + 2]);
        if (h < 55 || h > 165 || s < 0.15) continue;
        // the sun's share at this pixel, albedo-free: lum(sun + sky) / lum(sky alone)
        lawn.push(i); contrib.push(L.lum(A[j], A[j + 1], A[j + 2]) / Math.max(1, L.lum(B[j], B[j + 1], B[j + 2])));
      }
    }
    const sorted = [...contrib].sort((p, q) => p - q);
    const hi = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 1;
    const lit = []; const shade = [];
    // s = 1 in full sun, about 1 - shadow.intensity in a cast shadow
    lawn.forEach((i, k) => { const s = (contrib[k] - 1) / Math.max(1e-3, hi - 1); if (s >= 0.8) lit.push(i); else if (s <= 0.55) shade.push(i); });
    return { lawn, lit, shade, A, B };
  };
  /** Pixels of one object (rendered with it hidden vs shown). */
  L.objectMask = async (id) => {
    const A = L.read();
    v.objects.hidden(id, true); await L.frames(4);
    const B = L.read();
    v.objects.hidden(id, false); await L.frames(4);
    return L.diff(A, B, 10);
  };
  /** The shadow factor per pixel: this frame / the same frame with the sun's shadow intensity 0, where the sun lights
   *  the surface enough to tell (unlit faces and the sky say nothing): 0 full shadow, 1 lit. */
  L.shadowFactor = () => {
    const A = L.read();
    const sh = R.sun.shadow; const si = sh.intensity; sh.intensity = 0;
    const B = L.read();
    sh.intensity = si;
    const w = W(); const h = H(); const n = w * h;
    const val = new Float32Array(n); const ok = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const lb = L.lum(B[i * 4], B[i * 4 + 1], B[i * 4 + 2]);
      if (lb < 30) continue;
      const m = L.lum(A[i * 4], A[i * 4 + 1], A[i * 4 + 2]) / lb;
      val[i] = Math.max(0, Math.min(1, (m - (1 - si)) / Math.max(1e-3, si)));
      ok[i] = 1;
    }
    return { val, ok, w, h, si, A };
  };
  /** QA r4 R4-01: the sun's share per pixel from three reads (this frame, shadows off, sun off): (A - C) / (B - C) of
   *  the luminance, then 0 in full shadow (1 - shadow intensity) and 1 in full sun; valid where the sun adds >= 12. */
  L.sunShare = () => {
    const A = L.read();
    const sh = R.sun.shadow; const si = sh.intensity; sh.intensity = 0;
    const B = L.read();
    sh.intensity = si;
    const sI = R.sun.intensity; R.sun.intensity = 0;
    const C = L.read();
    R.sun.intensity = sI;
    const w = W(); const h = H(); const n = w * h;
    const val = new Float32Array(n); const ok = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const la = L.lum(A[i * 4], A[i * 4 + 1], A[i * 4 + 2]); const lb = L.lum(B[i * 4], B[i * 4 + 1], B[i * 4 + 2]);
      const lc = L.lum(C[i * 4], C[i * 4 + 1], C[i * 4 + 2]);
      if (lb - lc < 12) continue;
      val[i] = Math.max(0, Math.min(1, ((la - lc) / (lb - lc) - (1 - si)) / Math.max(1e-3, si)));
      ok[i] = 1;
    }
    return { val, ok, w, h, si, A };
  };
  /** QA r4 R4-01: flat bands inside the penumbrae (see the header, `plateaus`); `mask` (pixel indices) limits the
   *  columns to one object's pixels (the farmhouse), `mark` returns a PNG with the wide runs drawn red. */
  L.plateaus = ({ minCss = 4, mask = null, box = null, mark = false, F = null } = {}) => {
    const { val, ok, w, h, A } = F || L.sunShare();
    const dpr = R.canvas.width / Math.max(1, R.canvas.clientWidth);
    const minPx = minCss * dpr;
    let inMask = null;
    if (mask) { inMask = new Uint8Array(w * h); for (const i of mask) inMask[i] = 1; }
    if (box) {
      // a CSS-px box: only its pixels (and the mask's) count
      const [bx0, by0, bx1, by1] = box.map((v) => Math.round(v * dpr));
      const inBox = new Uint8Array(w * h);
      for (let y = Math.max(0, by0); y < Math.min(h, by1); y++) for (let x = Math.max(0, bx0); x < Math.min(w, bx1); x++) inBox[y * w + x] = !inMask || inMask[y * w + x] ? 1 : 0;
      inMask = inBox;
    }
    const col = new Float32Array(h); const cok = new Uint8Array(h);
    let crossings = 0; let wide = 0; let widest = 0; const runs = []; const where = []; const levels = [];
    for (let x = 2; x < w - 2; x += 2) {
      for (let y = 0; y < h; y++) {
        let sm = 0; let c = 0;
        for (let dx = -1; dx <= 1; dx++) { const i = y * w + x + dx; if (ok[i] && (!inMask || inMask[i])) { sm += val[i]; c++; } }
        cok[y] = c === 3 ? 1 : 0; col[y] = c ? sm / c : 0;
      }
      // monotone segments (a reversal by more than 0.05 ends one) that change by >= 0.35 within 160 px: a shadow edge
      const seg = (y0, y1) => {
        const d = col[y1] - col[y0]; const len = y1 - y0;
        if (Math.abs(d) < 0.35 || len < 4 || len > 160) return;
        crossings++;
        const sg = Math.sign(d); const m = Math.abs(d) / len;
        const lo = Math.min(col[y0], col[y1]) + 0.15 * Math.abs(d); const hi = Math.max(col[y0], col[y1]) - 0.15 * Math.abs(d);
        let run = 0; let sum = 0; let nLev = 0;
        for (let k = y0; k <= y1; k++) {
          const flat = k < y1 && sg * (col[k + 1] - col[k]) < 0.25 * m;
          if (flat) { run++; sum += col[k]; continue; }
          // a flat run inside the ramp (its level away from both ends): a band
          if (run) {
            const lev = sum / run;
            if (lev > lo && lev < hi) {
              runs.push(run / dpr);
              if (run > minPx) { wide++; nLev++; if (where.length < 600) where.push([x, k - run, run]); }
              widest = Math.max(widest, run / dpr);
            }
          }
          run = 0; sum = 0;
        }
        levels.push(nLev);
      };
      let start = -1; let ex = -1; let dir = 0;
      for (let y = 0; y <= h; y++) {
        if (y === h || !cok[y]) { if (start >= 0 && ex > start) seg(start, ex); start = -1; dir = 0; continue; }
        if (start < 0) { start = y; ex = y; dir = 0; continue; }
        const v = col[y];
        if (!dir) { if (Math.abs(v - col[start]) > 0.05) { dir = Math.sign(v - col[start]); ex = y; } else if (Math.abs(v - col[start]) < 0.02) { start = y; ex = y; } continue; }
        if (dir * (v - col[ex]) >= 0) { ex = y; continue; }
        if (dir * (col[ex] - v) > 0.05) { seg(start, ex); start = ex; dir = -dir; ex = y; }
      }
    }
    runs.sort((p, q) => p - q);
    const out = { crossings, wide, widest: +widest.toFixed(1), p95: runs.length ? +runs[Math.floor(runs.length * 0.95)].toFixed(1) : 0,
      banded: levels.filter((n) => n > 0).length, minCss };
    if (mark) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); const img = x.createImageData(w, h); img.data.set(A); x.putImageData(img, 0, 0);
      x.fillStyle = '#ff0040'; for (const [px, py, len] of where) x.fillRect(px - 1, py, 3, len);
      out.png = c.toDataURL('image/png');
    }
    return out;
  };
  /** QA r3 R3-02: the cast-shadow edges' steps (see the header, `edges`); r4: the plateaus from the same reads. */
  L.edgeSteps = (objMask = null, mark = false) => {
    const F = L.shadowFactor();
    const { val, ok, w, h, si } = F;
    const sh = R.sun.shadow;
    // integral images of the value and the valid count: a box mean over valid pixels only
    const W1 = w + 1;
    const S = new Float64Array(W1 * (h + 1)); const C = new Uint32Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let rs = 0; let rc = 0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x; rs += val[i]; rc += ok[i];
        S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + rs; C[(y + 1) * W1 + x + 1] = C[y * W1 + x + 1] + rc;
      }
    }
    const box = (x, y, r) => {
      const x0 = Math.max(0, x - r); const y0 = Math.max(0, y - r); const x1 = Math.min(w, x + r + 1); const y1 = Math.min(h, y + r + 1);
      const c = C[y1 * W1 + x1] - C[y0 * W1 + x1] - C[y1 * W1 + x0] + C[y0 * W1 + x0];
      const sm = S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0];
      return [c ? sm / c : 0, c, (x1 - x0) * (y1 - y0)];
    };
    let sum = 0; let cnt = 0;
    for (let y = 8; y < h - 8; y += 2) {
      for (let x = 8; x < w - 8; x += 2) {
        if (!ok[y * w + x]) continue;
        const [m15, c15, a15] = box(x, y, 7);
        if (c15 < a15 * 0.9 || m15 <= 0.15 || m15 >= 0.85) continue;
        const [m3] = box(x, y, 1);
        sum += Math.abs(m3 - m15); cnt++;
      }
    }
    const S3 = L.sunShare();
    const all = L.plateaus({ F: S3 });
    const house = objMask ? L.plateaus({ F: S3, mask: objMask, mark }) : null;
    // the tester's porch columns (va#2: x 560 / 620 / 660, y 380-440 at 1366 x 768): the porch roof under the main
    // roof's eave in the goldenclose framing on the owners' save; desktop only
    const porch = objMask && R.profile.kind === 'desktop' ? L.plateaus({ F: S3, mask: objMask, box: [520, 360, 700, 480] }) : null;
    const png = (house || all).png; delete all.png; if (house) delete house.png;
    return { steps: cnt ? +((sum / cnt) * 1000).toFixed(1) : null, penumbra: cnt, half: +sh.camera.right.toFixed(1), radius: +sh.radius.toFixed(2),
      intensity: +si.toFixed(3), map: sh.mapSize.x, sunEl: +(Math.asin(R.sun.position.clone().sub(R.sun.target.position).normalize().y) * 180 / Math.PI).toFixed(1),
      plateaus: all, house, porch, png };
  };
  L.redOf = (px, idx) => idx.filter((i) => { const [h, s, va] = L.hsv(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); return (h <= 28 || h >= 335) && s >= 0.3 && va >= 0.2; });
  /** The water's visible pixels: the water drawn flat magenta for one read. */
  L.waterMask = () => {
    const m = R.ground.water.mesh; const mat = m.material;
    const T3 = window.__lpThree;
    m.material = L.magenta || (L.magenta = new T3.MeshBasicMaterial({ color: 0xff00ff, toneMapped: false, fog: false }));
    const P = L.read();
    m.material = mat;
    const out = [];
    for (let i = 0, n = P.length / 4; i < n; i++) if (P[i * 4] > 245 && P[i * 4 + 1] < 10 && P[i * 4 + 2] > 245) out.push(i);
    return out;
  };
  /** Is buffer pixel i drawn over the owned farm? The ray through it meets the ground (y = 0) on owned land. */
  L.overFarm = () => {
    const T3 = window.__lpThree; const cam = R.cam.camera; const w = W(); const h = H();
    const o = cam.position; const d = new T3.Vector3(); const TILE = 2;
    return (i) => {
      const x = i % w; const y = (i / w) | 0;
      d.set(((x + 0.5) / w) * 2 - 1, -(((y + 0.5) / h) * 2 - 1), 0.5).unproject(cam).sub(o);
      if (d.y >= -1e-6) return false;
      const t = -o.y / d.y;
      return R.ground.ownedAt(Math.floor((o.x + d.x * t) / TILE), Math.floor((o.z + d.z * t) / TILE));
    };
  };
  /** GPU ms of n interactive frames of the main scene (timer queries; disjoint results dropped). */
  L.gpu = (n) => new Promise((resolve) => {
    const r = R.renderer; const gl = r.getContext(); const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) { resolve(null); return; }
    if (!L.gq) {
      const orig = r.render.bind(r);
      L.gq = { on: false, p: [], res: [] };
      r.render = (s, c) => { const G = L.gq; if (!G.on || s !== R.scene) return orig(s, c); const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); orig(s, c); gl.endQuery(ext.TIME_ELAPSED_EXT); G.p.push(q); return undefined; };
    }
    const G = L.gq; G.res = []; G.p = []; G.on = true; let k = 0;
    const poll = () => { while (G.p.length && gl.getQueryParameter(G.p[0], gl.QUERY_RESULT_AVAILABLE)) { const q = G.p.shift(); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) G.res.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); } };
    const step = () => { v.interact(); poll(); if (++k < n) requestAnimationFrame(step); else setTimeout(() => { poll(); G.on = false; const s = [...G.res].sort((a, b) => a - b); resolve(s.length ? { p50: +s[Math.floor(s.length * 0.5)].toFixed(2), p90: +s[Math.floor(s.length * 0.9)].toFixed(2), n: s.length } : null); }, 400); };
    requestAnimationFrame(step);
  });
  /** Look-dev switches for --ab: an item off and on again in the same page (GPU cost = on - off). */
  L.toggle = async (name, on) => {
    const T3 = window.__lpThree;
    const M = await import('/js/render/models.js');
    const all = () => R.scene.traverse((o) => { const m = o.material; if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true; });
    if (name === 'grade') R.renderer.toneMapping = on ? T3.CustomToneMapping : T3.NeutralToneMapping;
    else if (name === 'water') R.ground.water.uniforms.uWaterFx.value = on ? 1 : 0;
    else if (name === 'contact') { M.LOOK_DEV.contact = on; all(); }
    else if (name === 'halos') {
      const h = R.objects.halos;
      if (!h) return false;
      if (!on) { L.halosUpdate = L.halosUpdate || h.update; h.update = () => {}; h.mesh.visible = false; } else if (L.halosUpdate) { h.update = L.halosUpdate; }
    } else if (name === 'shadows') {
      R.sun.castShadow = on;
      if (on) { R.sun.shadow.mapSize.set(1024, 1024); R.sun.shadow.radius = 2; if (R.sun.shadow.map) { R.sun.shadow.map.dispose(); R.sun.shadow.map = null; } }
      R.ground.setBlobShadows(on ? null : R.sky0.sunDir);
      R.shadowDirty = true; all();
    } else return false;
    v.invalidate();
    await L.frames(20);                         // programs rebuilt and warm before anything is timed
    return true;
  };
  /** Paired A/B (--ab): the item flips every frame and each of OUR renders is GPU-timed, so the iGPU's slow clock drift
   *  under load cancels out; programs of both states are warmed first (toneMapping / contact switches hit the cache). */
  L.abPaired = async (item, n = 120) => {
    const T3 = window.__lpThree; const M = await import('/js/render/models.js');
    const r = R.renderer; const gl = r.getContext(); const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return null;
    const mats = []; R.scene.traverse((o) => { const m = o.material; if (m) for (const mm of Array.isArray(m) ? m : [m]) mats.push(mm); });
    const h = R.objects.halos;
    // QA r4 R4-01: `kernel` = the shipped desktop shadow lookup (8 taps past 3 texels, radius capped at 4) against r4's
    // (4 taps spread to x2); the sun where it is (noon: both 4 taps at radius 3, a control)
    const K = item === 'kernel' ? { G: await import('/js/render/ground.js'), I: await import('/js/render/index.js'), Q: await import('/js/render/renderer.js') } : null;
    if (K && (!K.G.SHADOW_WIDE || R.profile.kind !== 'desktop')) return null;
    const k0 = K ? { ...K.G.SHADOW_KERNEL } : null; const rad0 = R.sun.shadow.radius;
    const el = K ? Math.asin(R.sun.position.clone().sub(R.sun.target.position).normalize().y) * 180 / Math.PI : 0;
    const set = (on) => {
      if (K) {
        const want = on ? K.G.SHADOW_WIDE : { wideAbove: 0, maxRadius: Infinity };
        if (K.G.SHADOW_KERNEL.wideAbove !== want.wideAbove) { Object.assign(K.G.SHADOW_KERNEL, want); for (const mm of mats) mm.needsUpdate = true; }
        R.sun.shadow.radius = K.I.shadowRadiusFor(K.Q.qualityOf(R.tier, R.profile.kind).shadowRadius, el, K.G.SHADOW_KERNEL);
        return;
      }
      if (item === 'grade') r.toneMapping = on ? T3.CustomToneMapping : T3.NeutralToneMapping;
      else if (item === 'water') R.ground.water.uniforms.uWaterFx.value = on ? 1 : 0;
      else if (item === 'halos') { if (h) h.mesh.visible = on; }
      else if (item === 'contact') { if (M.LOOK_DEV.contact !== on) { M.LOOK_DEV.contact = on; for (const mm of mats) mm.needsUpdate = true; } }
      else if (item === 'shadows') { if (R.sun.castShadow !== on) { R.sun.castShadow = on; for (const mm of mats) mm.needsUpdate = true; } }
    };
    if (item === 'halos' && !h) return null;
    const restore = { tm: r.toneMapping, fx: R.ground.water.uniforms.uWaterFx.value, cs: R.sun.castShadow, ct: M.LOOK_DEV.contact };
    // warm both program sets
    for (const on of [false, true, false, true]) { set(on); r.render(R.scene, R.cam.camera); }
    const pend = []; const res = { on: [], off: [] };
    const poll = () => { while (pend.length && gl.getQueryParameter(pend[0][0], gl.QUERY_RESULT_AVAILABLE)) { const [q, lab] = pend.shift(); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) res[lab].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); } };
    await new Promise((resolve) => {
      let k = 0;
      const step = () => {
        const on = k % 2 === 0; set(on);
        if (item === 'halos' && h) h.mesh.visible = on;
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); r.render(R.scene, R.cam.camera); gl.endQuery(ext.TIME_ELAPSED_EXT);
        pend.push([q, on ? 'on' : 'off']); poll();
        if (++k < n * 2) requestAnimationFrame(step); else setTimeout(() => { poll(); resolve(); }, 400);
      };
      requestAnimationFrame(step);
    });
    if (K) { Object.assign(K.G.SHADOW_KERNEL, k0); for (const mm of mats) mm.needsUpdate = true; R.sun.shadow.radius = rad0; r.render(R.scene, R.cam.camera); }
    r.toneMapping = restore.tm; R.ground.water.uniforms.uWaterFx.value = restore.fx;
    if (R.sun.castShadow !== restore.cs || M.LOOK_DEV.contact !== restore.ct) { R.sun.castShadow = restore.cs; M.LOOK_DEV.contact = restore.ct; for (const mm of mats) mm.needsUpdate = true; }
    const med = (l) => { const x = [...l].sort((a, b) => a - b); return x.length ? x[Math.floor(x.length / 2)] : NaN; };
    // the paired difference: on-frame minus the next off-frame, median (robust to slow drift)
    const pairs = []; for (let i = 0; i < Math.min(res.on.length, res.off.length); i++) pairs.push(res.on[i] - res.off[i]);
    return { on: +med(res.on).toFixed(2), off: +med(res.off).toFixed(2), cost: +med(pairs).toFixed(3), n: pairs.length };
  };
  L.counters = () => {
    R.renderer.render(R.scene, R.cam.camera);
    const s = v.stats(); const info = R.renderer.info;
    return { calls: info.render.calls, tris: info.render.triangles, programs: info.programs.length, textures: info.memory.textures, geometries: info.memory.geometries,
      tier: s.tier, profile: s.profile, dpr: s.pixelRatio, buffer: s.buffer, shadowMap: R.sun.castShadow };
  };
}

async function setSky(page, minute, weather = 'sunny', season = 'summer') {
  await page.evaluate((m, w, s, TT) => {
    const v = window.__hh.view; v.setDayCycle('cycle'); v.setClock(Math.floor(window.__hh.serverNow() / TT) * TT + m); v.setWeather(w); v.setSeason(s);
  }, minute, weather, season, T);
}
async function frame(page, x, z, zoomK, dist0) {
  await page.evaluate((fx, fz, k, d0) => {
    const v = window.__hh.view; v.camera.resetOrbit?.(); v.focus(fx, fz);
    const want = d0 * (k || 1); v.camera.zoom(want / v.camera.get().dist);
  }, x, z, zoomK, dist0);
}

/** Measure every frame on one page (one tree, one device). */
async function measurePage(page, cdp, phone, tree, shared = null) {
  await page.evaluate(installHelpers);
  await page.evaluate((sh) => { window.__lpShared = sh; }, shared);
  await page.evaluate(async () => { window.__lpThree = await import('three'); });
  // --pre <file.mjs>: look-dev only, an async function (default export, its source run in the page) applied to the
  // current tree before measuring (e.g. tuning keyframe values without a rebuild)
  if (args.pre && tree === 'cur') {
    const src = fs.readFileSync(path.resolve(ROOT, args.pre), 'utf8').replace(/^export default\s*/m, '');
    await page.evaluate(`(${src.trim().replace(/;\s*$/, '')})()`);
  }
  const lay = await page.evaluate(() => {
    const o = window.__hh.state.farm.objects; const all = Object.values(o);
    const f = all.find((x) => x.def === 'farmhouse');
    const barn = Object.entries(o).find(([, x]) => x.def === 'barn');
    // the default distance, read once per page (a later variant must not start from the last frame's zoom)
    if (!window.__lpDist0) { window.__hh.view.camera.resetOrbit?.(); window.__lpDist0 = window.__hh.view.camera.get().dist; }
    const house = Object.entries(o).find(([, x]) => x.def === 'farmhouse');
    // QA r1 R-03: a thatched or sloped roof seen close (the chandlery's thatch, else the coop's eave, else the farmhouse)
    const roof = ['chandlery', 'coop', 'farmhouse'].map((d) => all.find((x) => x.def === d)).find(Boolean);
    return { fh: f ? [f.x, f.z] : [32, 32], barn: barn ? barn[0] : null, house: house ? house[0] : null, dist0: window.__lpDist0, n: all.length,
      roof: roof ? [roof.x + 0.5, roof.z + 0.5] : null };
  });
  const [hx, hz] = lay.fh;
  const FR = {
    noon: { m: 13, f: [hx + 2, hz + 4] },
    golden: { m: 30, f: [hx + 2, hz + 4] },
    dusk: { m: 32.4, f: [hx + 2, hz + 4] },
    night: { m: 37, f: [hx + 2, hz + 4] },
    rain: { m: 13, f: [hx + 2, hz + 4], w: 'rain', wait: 4500 },
    close: { m: 13, f: [hx + 1, hz + 1], z: phone ? 0.45 : 0.35 },
    // QA r1 R-03: shadow stripes on a roof (an eye check in the grid: whole-frame pixel metrics did not separate them)
    roof: { m: 13, f: lay.roof || [hx + 1, hz + 1], z: 0.2 },
    far: { m: 13, f: [32, 32], z: 6 },
    autumn: { m: 13, f: [hx + 2, hz + 4], season: 'autumn' },
    water: { m: 13, f: [23, 66], z: phone ? 0.7 : 0.6 },
    watergold: { m: 30, f: [23, 66], z: phone ? 0.7 : 0.6 },
    wheat: { m: 13 },
    rainbow: { m: 13, w: 'rainbow' },
    sky: { m: 13, f: [32, 32], z: 6 },
    roofprobe: { m: 13, f: [hx + 2, hz + 4] },
    roofnight: { m: 37, f: [hx + 2, hz + 4] },
    // QA r3 R3-02 (va#1): the porch roof (desktop) and the lawn beside the house (phone) at the closest zoom, the tester's framing
    goldenclose: { m: 30, f: [hx + 1.5, hz + 1], z: 0.3, wait: 3500 },
    noonclose: { m: 13, f: [hx + 1.5, hz + 1], z: 0.3, wait: 3500 },
    // QA r4 R4-01 (va#2): the same porch framing at dusk (minute 32.4: the sun lowest, the spread widest)
    duskclose: { m: 32.4, f: [hx + 1.5, hz + 1], z: 0.3, wait: 3500 },
  };
  const out = { layout: { objects: lay.n, dist0: +lay.dist0.toFixed(1) }, frames: {}, images: {} };
  const go = async (name) => {
    const F = FR[name];
    await setSky(page, F.m * MIN, F.w || 'sunny', F.season || 'summer');
    if (F.f) await frame(page, F.f[0], F.f[1], F.z, lay.dist0);
    await sleep(F.wait || 3200);
    await page.evaluate(() => window.__lp.frames(4));
  };
  // the masks that every frame of the default framing reuses (camera and geometry fixed): from noon
  let masks = null;
  for (const name of frames) {
    if (!FR[name]) continue;
    const res = {};
    if (name === 'wheat') {
      // a ripe Wheat plot near the farmhouse, injected client-side (look only); its pixels = crop vs bare soil
      Object.assign(res, await page.evaluate(async (MINm) => {
        const h = window.__hh; const v = h.view; const L = window.__lp;
        const o = h.state.farm.objects; const fh = Object.values(o).find((x) => x.def === 'farmhouse') || { x: 32, z: 32 };
        // a plot in the middle of the fields (the plots' centroid), away from buildings' shadows
        const all = Object.entries(o).filter(([, x]) => x.def === 'plot');
        const cx0 = all.reduce((a, [, x]) => a + x.x, 0) / Math.max(1, all.length); const cz0 = all.reduce((a, [, x]) => a + x.z, 0) / Math.max(1, all.length);
        void fh;
        const plots = all.sort((a, b) => Math.hypot(a[1].x - cx0, a[1].z - cz0) - Math.hypot(b[1].x - cx0, b[1].z - cz0));
        if (!plots.length) return { error: 'no plot' };
        // the nine plots nearest the fields' middle: a ripe Wheat block (more pixels than one sparse plot)
        const block = plots.slice(0, 9);
        const [id, p] = block[0];
        const was = block.map(([, q]) => q.crop);
        v.setDayCycle('cycle'); v.setClock(Math.floor(h.serverNow() / (40 * MINm)) * 40 * MINm + 13 * MINm); v.setWeather('sunny'); v.setSeason('summer');
        v.camera.resetOrbit?.(); v.focus(p.x + 0.5, p.z + 0.5); v.camera.zoom((window.__lpDist0 * 0.3) / v.camera.get().dist);
        await new Promise((r) => setTimeout(r, 2500));
        // the reads hold still: no wind sway, no ripe pulse (time frozen for the read), no sparkles over the field
        const W = (await import('/js/render/world-uniforms.js')).WORLD; const R0 = v._internals;
        // nothing that moves or pops over the block either (QA r1: an animal or a farmer crossing the field, or a ready
        // badge popping, entered the diff between the bare and the ripe reads in one run of four)
        const busy = ['fx', 'animals', 'avatars', 'badges'].map((k) => R0.layers[k]).filter(Boolean);
        const still = () => { W.uTime.value = 0; W.uWind.value = 0; for (const g of busy) g.visible = false; };
        // the wheat's own colour: no neighbouring building's shadow on the block (QA r1: with full-detail shadow casters,
        // R-03, a thin shadow fell on the sampled plots and its penumbra moved the reading by up to 1 degree)
        const tw = R0.objects.batches.shadowTwins?.mesh;
        if (tw) { tw.visible = false; R0.renderShadows(); }
        const readStill = () => { still(); const P = L.read(); for (const g of busy) g.visible = true; return P; };
        for (const [, q] of block) q.crop = null;
        v.sync(block.map(([k]) => k), new Set(['objects'])); await new Promise((r) => setTimeout(r, 900)); await L.frames(4);
        const A = readStill();
        const now = h.serverNow();
        for (const [, q] of block) q.crop = { def: 'wheat', plantedAt: now - 3_600_000, readyAt: now - 60_000, by: 'p1', cycle: q.cycle || 0 };
        v.sync(block.map(([k]) => k), new Set(['objects'])); await new Promise((r) => setTimeout(r, 1500)); await L.frames(4);
        // the ripe pulse breathes 4 %: three reads 330 ms apart, the crop = pixels that differ from bare soil in all
        const reads = [];
        for (let k = 0; k < 3; k++) { if (k) await new Promise((r) => setTimeout(r, 330)); reads.push(readStill()); }
        const sets = reads.map((B) => new Set(L.diff(A, B, 12)));
        // sunlit crop only (the sun's share at the pixel, as for the lawn): a shadowed stalk is lit by the cool sky
        const R = v._internals; const si = R.sun.intensity; R.sun.intensity = 0; const S0 = readStill(); R.sun.intensity = si;
        const S1 = reads[0]; const S1raw = reads[0];
        const share = (i) => L.lum(S1[i * 4], S1[i * 4 + 1], S1[i * 4 + 2]) / Math.max(1, L.lum(S0[i * 4], S0[i * 4 + 1], S0[i * 4 + 2]));
        // the stalks themselves: clearly brighter than the bare soil there (a ripe field also warms its soil a little)
        const val = (P, i) => Math.max(P[i * 4], P[i * 4 + 1], P[i * 4 + 2]) / 255;
        const cand = [...sets[0]].filter((i) => sets[1].has(i) && sets[2].has(i) && val(S1raw, i) - val(A, i) > 0.12);
        const shares = cand.map(share).sort((a, b) => a - b);
        const hi = shares.length ? shares[Math.floor(shares.length * 0.95)] : 1;
        const idx = cand.filter((i) => (share(i) - 1) / Math.max(1e-3, hi - 1) >= 0.7);
        const per = reads.map((B) => L.stats(B, idx));
        const avg = (k) => +(per.reduce((a, x) => a + x[k], 0) / per.length).toFixed(3);
        const st = { n: idx.length, hue: avg('hue'), sat: avg('sat'), value: avg('value'), rgb: per[0].rgb };
        if (tw) { tw.visible = true; R0.shadowDirty = true; }
        block.forEach(([, q], k) => { q.crop = was[k]; });
        v.sync(block.map(([k]) => k), new Set(['objects']));
        void id;
        return { wheat: st, png: L.png(0.5) };
      }, MIN));
      out.images[name] = res.png; delete res.png;
      out.frames[name] = res;
      continue;
    }
    await go(name);
    if (name === 'goldenclose' || name === 'noonclose' || name === 'duskclose') {
      // R4-01: the plateaus over the farmhouse's screen box too (the porch roof under the main roof's eave), marked
      res.edges = await page.evaluate(async (house) => window.__lp.edgeSteps(house ? await window.__lp.objectMask(house) : null, true), lay.house);
      if (res.edges.png) { out.images[`${name}-plateaus`] = res.edges.png; delete res.edges.png; }
      if (args.ab && String(args.ab).split(',').includes('kernel') && tree === 'cur' && !phone) {
        res.ab = { kernel: await page.evaluate((n) => window.__lp.abPaired('kernel', n), Math.max(60, gpuFrames)) };
      }
      res.gpu = await page.evaluate((n) => window.__lp.gpu(n), gpuFrames);
      Object.assign(res, await page.evaluate(() => window.__lp.counters()));
      out.images[name] = await page.evaluate(() => window.__lp.png(1));
      out.frames[name] = res;
      continue;
    }
    if (name === 'roofprobe' || name === 'roofnight') {
      // look-dev: one fixed set of barn pixels read under the grade on / off and the shadow map on / off
      Object.assign(res, await page.evaluate(async (barn, house) => {
        const L = window.__lp; const v = window.__hh.view; const R = v._internals; const T3 = window.__lpThree;
        if (!barn) return { probe: null };
        // the barn's red pixels classified in daylight (noon), then read at this frame's sky
        const D = (await import('/js/render/daynight.js'));
        const clk = R.clockOverride; v.setClock(Math.floor(window.__hh.serverNow() / 2400000) * 2400000 + 13 * 60000); await L.frames(3); await new Promise((r) => setTimeout(r, 400)); await L.frames(3);
        // the red paint of the barn and the farmhouse (the farmhouse is in the middle of every framing: a stable sample)
        const lm = L.lawnMasks(); const bm = await L.objectMask(barn); const hm = house ? await L.objectMask(house) : [];
        const red = [...new Set([...L.redOf(lm.A, bm), ...L.redOf(lm.A, hm)])];
        v.setClock(clk); await L.frames(3); await new Promise((r) => setTimeout(r, 400)); await L.frames(3);
        void D;
        const extra = {};
        const lamps0 = (await import('/js/render/models.js')).LOOK; const lk = lamps0.uLampK.value; const gl0 = lamps0.uGlow.value;
        const mats = []; R.scene.traverse((o) => { const m = o.material; if (m) for (const mm of Array.isArray(m) ? m : [m]) mats.push(mm); });
        const tm0 = R.renderer.toneMapping; const cs0 = R.sun.castShadow;
        const state = (grade, shadow) => { R.renderer.toneMapping = grade ? T3.CustomToneMapping : T3.NeutralToneMapping; if (R.sun.castShadow !== shadow) { R.sun.castShadow = shadow; for (const mm of mats) mm.needsUpdate = true; } };
        const out = { n: red.length };
        for (const [k, g, sh] of [['as', true, cs0], ['neutral', false, cs0], ['noShadow', true, false], ['noShadowNeutral', false, false]]) {
          state(g, sh); L.read(); const P = L.read(); const st = L.stats(P, red); out[k] = st ? { hue: st.hue, rgb: st.rgb } : null;
        }
        state(true, cs0);
        // the night lights off (lamps' light, window glow, halos) for one read
        lamps0.uLampK.value = 0; lamps0.uGlow.value = 0; const hv = R.objects.halos ? R.objects.halos.mesh.visible : false; if (R.objects.halos) R.objects.halos.mesh.visible = false;
        { const P = L.read(); const st = L.stats(P, red); extra.noLights = st ? { hue: st.hue, rgb: st.rgb } : null; }
        lamps0.uLampK.value = lk; lamps0.uGlow.value = gl0; if (R.objects.halos) R.objects.halos.mesh.visible = hv;
        Object.assign(out, extra);
        state(tm0 === T3.CustomToneMapping, cs0);
        return { probe: out };
      }, lay.barn, lay.house));
      out.frames[name] = res;
      continue;
    }
    if (name === 'sky') {
      // G13: a mod's sky preset seen from the farm camera: the far frame's mean colour with and without it
      Object.assign(res, await page.evaluate(async () => {
        const L = window.__lp; const v = window.__hh.view; const R = v._internals;
        const look = await import('/js/mod/look.js');
        const mean = () => { const P = L.read(); const a = L.area(); const w = R.canvas.width; let r = 0; let g = 0; let b = 0; let n = 0;
          for (let y = a[1]; y < a[3]; y += 2) for (let x = a[0]; x < a[2]; x += 2) { const i = (y * w + x) * 4; r += P[i]; g += P[i + 1]; b += P[i + 2]; n++; }
          return [r / n, g / n, b / n]; };
        const base = mean();
        const out = { base: base.map((x) => +x.toFixed(1)) };
        for (const preset of ['golden', 'stormy', 'cool', 'pastel']) {
          look.applyLook({ sky: preset }); R.skyAt = 0; await L.frames(3); await new Promise((r) => setTimeout(r, 400)); await L.frames(3);
          const m = mean();
          out[preset] = +Math.hypot(m[0] - base[0], m[1] - base[1], m[2] - base[2]).toFixed(1);
        }
        look.applyLook(null); R.skyAt = 0; await L.frames(3);
        return { sky: out };
      }));
      out.frames[name] = res;
      continue;
    }
    if (name === 'rainbow') {
      Object.assign(res, await page.evaluate(async (fh, d0, phoneP) => {
        const v = window.__hh.view; const L = window.__lp; const R = v._internals;
        const out = {};
        // QA r1 R-04: the default framing too (the owners' after-shower moment: the arc over the woods beyond the farm)
        for (const [k, f, z] of [['close', [fh[0] + 1, fh[1] + 1], phoneP ? 0.45 : 0.35], ['far', [32, 32], 6], ['home', [fh[0] + 2, fh[1] + 4], 1]]) {
          v.camera.resetOrbit?.(); v.focus(f[0], f[1]); v.camera.zoom((d0 * z) / v.camera.get().dist);
          await new Promise((r) => setTimeout(r, 3000)); await L.frames(4);
          const A = L.read();
          const vis = R.rainbow ? R.rainbow.visible : false;
          if (R.rainbow) R.rainbow.visible = false;
          const B = L.read();
          if (R.rainbow) R.rainbow.visible = vis;
          const over = L.overFarm();
          const idx = L.diff(A, B, 2);
          out[k] = { rainbowPx: idx.length, share: +(idx.length / (A.length / 4)).toFixed(4), inFarm: idx.filter(over).length, shown: vis, k: +(R.rainbow?.material?.uniforms?.uK?.value ?? 0).toFixed(2) };
          if (k === 'far') out.png = L.png(0.5);
        }
        return out;
      }, lay.fh, lay.dist0, phone));
      out.images[name] = res.png; delete res.png;
      out.frames[name] = res;
      continue;
    }
    // GPU, counters, the world (counted before any --ab switch: a switch compiles a second set of programs)
    res.gpu = await page.evaluate((n) => window.__lp.gpu(n), gpuFrames);
    Object.assign(res, await page.evaluate(() => window.__lp.counters()));
    if (name === 'noon' || name === 'night') {
      await cdp.send('HeapProfiler.collectGarbage'); await sleep(300);
      res.heapMB = +((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576).toFixed(1);
    }
    // --ab grade,water,halos,contact,shadows: each item's GPU cost in this frame, off/on alternated twice (cur only)
    if (args.ab && tree === 'cur' && ['noon', 'golden', 'night', 'water'].includes(name)) {
      res.ab = {};
      for (const item of String(args.ab).split(',')) {
        if (item === 'shadows' && !phone) continue;
        res.ab[item] = await page.evaluate((it, n) => window.__lp.abPaired(it, n), item, Math.max(60, gpuFrames));
      }
    }
    if (name === 'noon' || name === 'far' || name === 'water') {
      const m = await page.evaluate(async (barn, nm) => {
        const L = window.__lp; const v = window.__hh.view; const R = v._internals;
        R.ground.setCloud(0);              // drifting cloud shadows off for the read (the tick sets them again)
        const lm = L.lawnMasks();
        const out = { lawn: lm.lawn, lit: lm.lit, shade: lm.shade };
        if (barn) {
          const bm = await L.objectMask(barn);
          // the sunlit red of the barn (a shaded slope is lit by the sky and shifts with the fill, not the paint)
          const red0 = L.redOf(lm.A, bm);
          const sh = (i) => L.lum(lm.A[i * 4], lm.A[i * 4 + 1], lm.A[i * 4 + 2]) / Math.max(1, L.lum(lm.B[i * 4], lm.B[i * 4 + 1], lm.B[i * 4 + 2]));
          const ss = red0.map(sh).sort((a, b) => a - b); const hi = ss.length ? ss[Math.floor(ss.length * 0.95)] : 1;
          const red = red0.filter((i) => (sh(i) - 1) / Math.max(1e-3, hi - 1) >= 0.6);
          out.roof = red.length >= 30 ? red : (red0.length >= 30 ? red0 : null); out.barnPx = bm.length; out.redPx = red.length;
          out.roofAll = red0.length >= 30 ? red0 : null;
        }
        // one pixel set for both trees (geometry and camera are the same): HEAD's roof masks, when given
        // the noon roof: sunlit in BOTH trees (this tree may shade a slope HEAD did not, e.g. a phone's new shadow map)
        const sh0 = window.__lpShared;
        if (sh0 && nm === 'noon') {
          if (sh0.roof && out.roof) { const mine = new Set(out.roof); const both = sh0.roof.filter((i) => mine.has(i)); out.roof = both.length >= 30 ? both : sh0.roof; }
          if (sh0.roofAll) out.roofAll = sh0.roofAll;
        }
        // the farm's tree crowns: the trees batch hidden vs shown
        const A = L.read(); const tb = R.objects.batches.trees.mesh; tb.visible = false; const B = L.read(); tb.visible = true;
        out.crown = L.diff(A, B, 10).filter((i) => L.inArea(i));
        window.__lpMask = out;
        if (nm === 'noon') window.__lpMaskNoon = out;
        if (nm === 'water') window.__lpMaskWater = out;
        return { lawn: out.lawn.length, lit: out.lit.length, shade: out.shade.length, roof: out.roof ? out.roof.length : 0, barnPx: out.barnPx || 0, redPx: out.redPx || 0, crown: out.crown.length };
      }, lay.barn, name);
      if (name === 'noon') masks = m;
      res.masks = m;
    }
    const framing = ['noon', 'golden', 'dusk', 'night', 'rain', 'autumn'].includes(name) ? 'home' : name === 'watergold' ? 'water' : name;
    Object.assign(res, await page.evaluate(async (nm, wantWater, fr) => {
      const L = window.__lp; const v = window.__hh.view; const R = v._internals;
      const M = (fr === 'home' ? window.__lpMaskNoon : fr === 'water' ? window.__lpMaskWater : fr === 'far' ? window.__lpMask : null) || {};
      R.ground.setCloud(0);
      const P = L.read();
      const r = { world: L.world(P) };
      // the lawn lit and shaded at THIS frame (a low sun's long shadows are not lit lawn); the region is the frame's own
      const LM = M.lit ? L.lawnMasks() : null;
      if (LM) {
        const lit = L.stats(P, LM.lit); const shade = L.stats(P, LM.shade);
        r.lawn = lit ? { rgb: lit.rgb, hue: lit.hue, sat: lit.sat, value: lit.value, lum: lit.lum, lumSd: lit.lumSd, n: lit.n } : null;
        r.litShadow = lit && shade && shade.n >= 200 && lit.n >= 200 ? +(lit.lum / Math.max(1, shade.lum)).toFixed(3) : null;
      }
      if (M.roof) { const s = L.stats(P, M.roof); r.roof = s ? { hue: s.hue, sat: s.sat, rgb: s.rgb } : null; }
      if (M.roofAll) { const s = L.stats(P, M.roofAll); r.roofAll = s ? { hue: s.hue, sat: s.sat } : null; }
      if (wantWater) {
        const wm = L.waterMask();
        if (wm.length > 500) {
          const s = L.stats(P, wm);
          // the water's own motion: everything but the terrain (the water's layer) hidden for the two reads, so frogs, the
          // barge and particles crossing the river do not count
          const keep = new Set(['sky', 'terrain']);
          const hid = Object.entries(R.layers).filter(([k, g]) => !keep.has(k) && g.visible).map(([, g]) => g);
          for (const g of hid) g.visible = false;
          const Q = L.read();
          let glint = 0; for (const i of wm) if (Math.max(Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2]) >= 230) glint++;
          await new Promise((res) => setTimeout(res, 1000));
          const P2 = L.read();
          for (const g of hid) g.visible = true;
          let changed = 0; for (const i of wm) if (Math.max(Math.abs(Q[i * 4] - P2[i * 4]), Math.abs(Q[i * 4 + 1] - P2[i * 4 + 1]), Math.abs(Q[i * 4 + 2] - P2[i * 4 + 2])) > 8) changed++;
          r.water = { px: wm.length, share: +(wm.length / (P.length / 4)).toFixed(3), hue: s.hue, rgb: s.rgb, glint: +(glint / wm.length).toFixed(4), changed: +(changed / wm.length).toFixed(4) };
        } else r.water = { px: wm.length };
      }
      r.png = L.png(1);
      return r;
    }, name, name === 'water' || name === 'watergold', framing));
    out.images[name] = res.png; delete res.png;
    out.frames[name] = res;
  }
  void masks;
  if (args.cpu && phone) {
    await setSky(page, 13 * MIN);
    await frame(page, hx + 2, hz + 4, 0, lay.dist0); await sleep(2000);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(args.cpu) });
    out.panCpu = await page.evaluate((S) => new Promise((resolve) => {
      const v = window.__hh.view; const fr = []; const t0 = performance.now(); let dir = 1; let flip = t0 + 1500;
      const off = v.onFrame(() => fr.push(performance.now()));
      const step = (t) => { if (t > flip) { dir = -dir; flip = t + 3000; } v.camera.pan(0.07 * dir, 0.03 * dir); v.interact(); if (t - t0 < S * 1000) requestAnimationFrame(step); else { off(); resolve({ fps: +((fr.length - 1) / ((fr.at(-1) - fr[0]) / 1000)).toFixed(1), n: fr.length }); } };
      requestAnimationFrame(step);
    }), 6);
    out.panCpu.rate = Number(args.cpu);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  return out;
}

/** --scene shots: per device and language, the real default (quality auto, ?stats=1): the reveal (view.ready), then
 *  page screenshots (HUD and all) at noon, golden and night; placeholders in view at the reveal; console at load. */
async function shotsScene(browser, base, tokens, tree, dev) {
  const out = {};
  for (const lang of ['en', 'bg']) {
    const ctx = await browser.createBrowserContext();
    const t0 = Date.now();
    const { page, errors } = await openFarm(browser, ctx, base, tokens, { device: dev, quality: null, lang, query: 'stats=1', settle: 0 });
    const reveal = await page.evaluate(async () => {
      const v = window.__hh.view;
      if (typeof v.ready !== 'function') return { api: false };
      const r = await v.ready({ timeoutMs: 6000 });
      const s = v.stats();
      return { api: true, reason: r.reason, ms: r.ms, placeholders: s.placeholders, stats: Boolean(document.querySelector('[data-hh="stats"]')) };
    });
    reveal.wallMs = Date.now() - t0;
    const f0 = path.join(outDir, 'shots', `${tree}-${dev}-${lang}-reveal${tag}.png`);
    fs.mkdirSync(path.dirname(f0), { recursive: true });
    await page.screenshot({ path: f0 });
    const files = [path.relative(ROOT, f0)];
    await sleep(Math.max(0, settleMs - 2000));
    await page.evaluate(() => { try { window.__hh.ui.panels.closeAll(); } catch { /* none */ } });
    for (const [name, m] of [['noon', 13], ['golden', 30], ['dusk', 32.4], ['night', 37]]) {
      await setSky(page, m * MIN);
      await sleep(2500);
      const f = path.join(outDir, 'shots', `${tree}-${dev}-${lang}-${name}${tag}.png`);
      await page.screenshot({ path: f });
      files.push(path.relative(ROOT, f));
    }
    out[lang] = { reveal, errors, files };
    await page.close();
    await ctx.close();
  }
  return out;
}

/** --scene blip (QA r3 R3-01): a lost link while the farm loads must not leave boxes for the session (see the header). */
const BLIP_URLS = ['*/assets/models/*', '*/packs/*', '*.glb*'];
async function blipScene(browser, base, tokens, tree, dev) {
  const lang = args.lang || (dev === 'desk' ? 'en' : 'bg');
  const blockS = Number(args.block || 6);
  const ctx = await browser.createBrowserContext();
  const before = async (page, cdp) => {
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (blockS > 0) await cdp.send('Network.setBlockedURLs', { urls: BLIP_URLS });    // --block 0: the control
  };
  const { page, cdp, errors } = await openFarm(browser, ctx, base, tokens, { device: dev, quality: null, lang, settle: 0, before });
  const read = () => page.evaluate(() => { const s = window.__hh.view.stats(); return { placeholders: s.placeholders, home: s.home, ready: s.ready }; });
  await sleep(blockS * 1000);
  const blocked = await read();
  await cdp.send('Network.setBlockedURLs', { urls: [] });
  const t0 = Date.now();
  const series = [];
  let doneAt = null;
  while (Date.now() - t0 < 30_000) {
    await sleep(1000);
    const s = await read();
    series.push([Math.round((Date.now() - t0) / 1000), s.placeholders, s.home]);
    if (s.placeholders === 0 && (s.home === 0 || s.home === null)) { doneAt = Math.round((Date.now() - t0) / 1000); break; }
  }
  // the welcome-back sheet (phones) covers the farm: go to the farm, as a player would
  await page.evaluate(() => {
    const go = [...document.querySelectorAll('.recap-foot .btn')].pop();
    if (go) go.click();
    try { window.__hh.ui.panels.closeAll(); } catch { /* none */ }
  });
  await sleep(2500);                                   // the settle and the HUD's portraits
  const end = await read();
  const avatars = await page.evaluate(() => {
    // the farmers drawn as their rigs (life-feel's avatars-view: the capsule is the placeholder)
    const R = window.__hh.view._internals; const out = [];
    R.layers.avatars?.traverse((o) => { if (o.isSkinnedMesh) out.push(o.name || 'rig'); });
    // the animals as drawn: rigged ones, and instances of the far / rigid batches (life-feel's animals-view)
    let rigged = 0; let instanced = 0;
    R.layers.animals?.traverse((o) => { if (!o.visible) return; if (o.isSkinnedMesh) rigged++; else if (o.isInstancedMesh) instanced += o.count; else if (o.isBatchedMesh) instanced += o.instanceCount ?? 0; });
    return { rigs: out.length, portraits: document.querySelectorAll('#hud .has-portrait').length, animals: { rigged, instanced } };
  });
  // every object still drawn as a box (in view or not), by the batch's own word: what `placeholders` may not see
  const boxes = await page.evaluate(() => {
    const v = window.__hh.view; const R = v._internals; const out = [];
    for (const [id, o] of Object.entries(window.__hh.state.farm.objects)) {
      const r = R.objects.inspect(id);
      if (r && r.box) out.push(`${o.def}@${o.x},${o.z}:${r.key}${r.cropKey ? `/${r.cropKey}` : ''}`);
    }
    return out;
  });
  const f = path.join(outDir, 'qa-r3', `blip${blockS > 0 ? '' : '-control'}-${tree}-${dev}-${lang}${tag}.png`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  await page.screenshot({ path: f });
  const consoleErrors = errors.filter((e) => /^console\.error|^pageerror/.test(e));
  await page.close();
  await ctx.close();
  return { lang, blockS, blocked, series, doneAt, end, avatars, boxes: boxes.slice(0, 20), boxCount: boxes.length,
    ok: doneAt !== null && consoleErrors.length === 0 && boxes.length === 0,
    errors: consoleErrors.length, warnings: errors.length - consoleErrors.length,
    sample: [...new Set(errors.map((e) => e.replace(/model \S+/, 'model X').slice(0, 140)))].slice(0, 8), files: [path.relative(ROOT, f)] };
}

/** --scene stats (QA r3 R3-03): where the ?stats=1 readout lands against the HUD (see the header). */
async function statsScene(browser, base, tokens, tree, dev) {
  const lang = args.lang || (dev === 'desk' ? 'en' : 'bg');
  const ctx = await browser.createBrowserContext();
  const { page, errors } = await openFarm(browser, ctx, base, tokens, { device: dev, quality: null, lang, query: 'stats=1', settle: 4000 });
  await page.evaluate(() => {
    const go = [...document.querySelectorAll('.recap-foot .btn')].pop();
    if (go) go.click();
    try { window.__hh.ui.panels.closeAll(); } catch { /* none */ }
  });
  await page.waitForSelector('[data-hh="stats"]', { timeout: 20_000 }).catch(() => null);
  await sleep(1500);
  const geo = await page.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
    const seen = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
    const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const el = document.querySelector('[data-hh="stats"]');
    if (!el) return { readout: null };
    const r = box(el);
    const name = (e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${[...e.classList].slice(0, 2).map((c) => `.${c}`).join('')}`;
    const pills = [...document.querySelectorAll('#hud .pill')].filter(seen).map((e) => ({ el: name(e), r: box(e) }));
    const ctl = [...document.querySelectorAll('#hud button, #hud .pill, #hud [role="button"], #hud .tracker, #hud .card, .phone-bar, #toolbar, #dock')]
      .filter(seen).map((e) => ({ el: name(e), r: box(e) }));
    return { readout: r, text: el.textContent, view: [innerWidth, innerHeight], pills, pillHits: pills.filter((p) => hit(r, p.r)), otherHits: ctl.filter((c) => hit(r, c.r)) };
  });
  const f = path.join(outDir, 'qa-r3', `stats-${tree}-${dev}-${lang}${tag}.png`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  await page.screenshot({ path: f });
  await page.close();
  await ctx.close();
  return { lang, ...geo, ok: Boolean(geo.readout) && geo.pillHits.length === 0, errors, files: [path.relative(ROOT, f)] };
}

/** The auto-tier trace (G1): 30 s pans at noon and at night, the tier each second, two sessions. */
async function autoTrace(page) {
  const out = {};
  for (const [label, m] of [['noon', 13], ['night', 37]]) {
    await setSky(page, m * MIN);
    await page.evaluate(() => { const o = window.__hh.state.farm.objects; const f = Object.values(o).find((x) => x.def === 'farmhouse'); window.__hh.view.focus(f.x + 2, f.z + 4); });
    await sleep(2000);
    out[label] = await page.evaluate(() => new Promise((resolve) => {
      const v = window.__hh.view; const R = v._internals; const tr = []; const t0 = performance.now(); let dir = 1; let flip = t0 + 1500; let last = 0;
      const step = (t) => {
        if (t > flip) { dir = -dir; flip = t + 3000; }
        v.camera.pan(0.07 * dir, 0.03 * dir); v.interact();
        if (t - last > 1000) { last = t; tr.push([Math.round((t - t0) / 1000), R.tier, +(R.auto.p90 || 0).toFixed(1), R.fps]); }
        if (t - t0 < 30000) requestAnimationFrame(step); else resolve({ end: R.tier, trace: tr });
      };
      requestAnimationFrame(step);
    }));
  }
  out.stored = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/quality/.test(k)) o[k] = localStorage.getItem(k); } return o; });
  return out;
}

// --------------------------------------------------------------------------------------------------------------
// The release-scope §4.2 lines (G2-G13) and §8 budgets, judged on one run: HEAD and this tree measured in it.
const hdist = (a, b) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };     // circular hue gap
const warmth = (h) => hdist(h, 30);                                                         // degrees from orange
function checks(r, phone) {
  const H = r.head?.frames || {}; const C = r.cur?.frames || {};
  const out = [];
  const add = (id, line, ok, value) => out.push({ id, line, ok: ok === null ? null : Boolean(ok), value });
  const has = (...xs) => xs.every((x) => x !== undefined && x !== null && !Number.isNaN(x));
  const n = C.noon || {}; const hn = H.noon || {};
  if (has(n.litShadow)) add('G2', 'noon lit / shadowed lawn >= 1.35', n.litShadow >= 1.35, n.litShadow);
  if (has(C.golden?.lawn?.hue, C.golden?.lawn?.value)) add('G3', 'golden lawn hue >= 75 and value >= 0.40', C.golden.lawn.hue >= 75 && C.golden.lawn.value >= 0.4, [C.golden.lawn.hue, C.golden.lawn.value]);
  if (has(C.dusk?.world?.lum, n.world?.lum)) add('G3', 'dusk mean luminance >= 85 % of noon', C.dusk.world.lum >= 0.85 * n.world.lum, +(C.dusk.world.lum / n.world.lum).toFixed(3));
  if (has(C.night?.world?.lum, n.world?.lum)) add('G3', 'night mean luminance >= 60 % of noon', C.night.world.lum >= 0.6 * n.world.lum, +(C.night.world.lum / n.world.lum).toFixed(3));
  // QA r1 R-05: golden is no brighter than noon, dusk is its own warmer evening (not a second afternoon)
  if (has(C.golden?.world?.lum, n.world?.lum)) add('G3', 'golden mean luminance <= noon (R-05)', C.golden.world.lum <= n.world.lum, +(C.golden.world.lum / n.world.lum).toFixed(3));
  if (has(C.dusk?.world?.hue, n.world?.hue)) add('G3', 'dusk world hue >= 8 degrees warmer than noon (R-05)', warmth(n.world.hue) - warmth(C.dusk.world.hue) >= 8, +(warmth(n.world.hue) - warmth(C.dusk.world.hue)).toFixed(1));
  if (has(C.dusk?.world?.hue, C.golden?.world?.hue)) add('G3', 'dusk world hue >= 3 degrees warmer than golden (R-05: not the same light)', warmth(C.golden.world.hue) - warmth(C.dusk.world.hue) >= 3, +(warmth(C.golden.world.hue) - warmth(C.dusk.world.hue)).toFixed(1));
  // the barn's red pixels (each tree's own, classified at noon) read at night; HEAD's real look is its Neutral entry
  const rn = C.roofnight?.probe?.as; const hrn = H.roofnight?.probe?.neutral;
  if (has(rn?.hue)) add('G3', 'night red paint hue (barn + farmhouse) within 20 degrees of red', hdist(rn.hue, 0) <= 20, [rn.hue, hrn?.hue]);
  else { const nr = C.night?.roofAll || C.night?.roof; if (has(nr?.hue)) add('G3', 'night red roof hue within 20 degrees of red (whole roof)', hdist(nr.hue, 0) <= 20, nr.hue); }
  if (has(n.world?.sat, hn.world?.sat)) { const k = n.world.sat / hn.world.sat; add('G5', 'noon world saturation +8 to +15 % vs HEAD', k >= 1.08 && k <= 1.15, +k.toFixed(3)); }
  // the whole red roof of the barn, on HEAD's own pixel set (geometry and camera are the same in both trees; a fixed-set
  // probe showed the grade moves it < 1 degree and a phone's new shadow map 0, so what is left is the light, G2/G3)
  const rp = C.roofprobe?.probe?.as; const hrp = H.roofprobe?.probe?.neutral;
  if (has(rp?.hue, hrp?.hue)) add('G5', 'noon red paint hue (barn + farmhouse) within 5 degrees of HEAD', hdist(rp.hue, hrp.hue) <= 5, [rp.hue, hrp.hue, C.roofprobe.probe.neutral?.hue]);
  else { const nr0 = n.roofAll; const hr0 = hn.roofAll; if (has(nr0?.hue, hr0?.hue)) add('G5', 'noon red roof hue within 5 degrees of HEAD (whole roof)', hdist(nr0.hue, hr0.hue) <= 5, [nr0.hue, hr0.hue]); }
  if (has(n.lawn?.hue, hn.lawn?.hue)) add('G5', 'noon lawn hue within 5 degrees of HEAD', hdist(n.lawn.hue, hn.lawn.hue) <= 5, [n.lawn.hue, hn.lawn.hue]);
  // QA r1 R-02: scope G6's ">= 1.5x HEAD" is what drew the camouflage; the look decides (bar 2). Bounded both ways: never
  // flatter than HEAD, never past 1.5x (far and the default frame); the triage's proposed 1.2x floor is advisory until
  // the integrator rules (rel-render-look.md)
  if (has(C.far?.lawn?.lumSd, H.far?.lawn?.lumSd)) {
    const k = C.far.lawn.lumSd / H.far.lawn.lumSd;
    add('G6', 'far lawn luminance SD 1.0x-1.5x HEAD (R-02: grass, not camouflage)', k >= 1.0 && k <= 1.5, +k.toFixed(3));
    add('G6', 'far lawn luminance SD >= 1.2x HEAD (R-02 triage proposal, advisory)', null, +k.toFixed(3));
  }
  if (has(n.lawn?.lumSd, hn.lawn?.lumSd)) add('G6', 'default-frame lawn luminance SD <= 1.5x HEAD (R-02: no camouflage)', n.lawn.lumSd <= 1.5 * hn.lawn.lumSd, +(n.lawn.lumSd / hn.lawn.lumSd).toFixed(3));
  if (has(C.autumn?.lawn?.hue, H.autumn?.lawn?.hue)) add('G6', 'autumn lawn hue >= 15 degrees greener than HEAD autumn', C.autumn.lawn.hue - H.autumn.lawn.hue >= 15, +(C.autumn.lawn.hue - H.autumn.lawn.hue).toFixed(1));
  if (has(n.crown?.hue, C.autumn?.crown?.hue)) add('G6', 'tree crowns shift >= 20 degrees summer -> autumn', hdist(n.crown.hue, C.autumn.crown.hue) >= 20, +hdist(n.crown.hue, C.autumn.crown.hue).toFixed(1));
  const w = C.water?.water; const wg = C.watergold?.water;
  if (has(w?.changed)) add('G7', 'water changed-pixel share 1 s apart 2-15 %', w.changed >= 0.02 && w.changed <= 0.15, w.changed);
  if (has(w?.glint)) add('G7', 'water glint pixels <= 3 %', w.glint <= 0.03, w.glint);
  if (has(w?.hue, wg?.hue)) add('G7', 'golden water >= 10 degrees warmer than noon', warmth(w.hue) - warmth(wg.hue) >= 10, +(warmth(w.hue) - warmth(wg.hue)).toFixed(1));
  if (has(C.rainbow?.close?.inFarm)) add('G10', 'rainbow pixels over the owned farm = 0 (close, far, default)', C.rainbow.close.inFarm === 0 && C.rainbow.far.inFarm === 0 && (C.rainbow.home?.inFarm ?? 0) === 0, [C.rainbow.close.inFarm, C.rainbow.far.inFarm, C.rainbow.home?.inFarm]);
  // QA r1 R-04: the arc is there at all on the default frame (QA r1: 0.0-0.01 %, the owners' moment gone); the triage's
  // proposed 2 % is advisory: on a farm whose land fills the default view G10 leaves ~6 % of the frame to stand over.
  // QA r2 R2-C1: these shares read the bare canvas; the HUD covers the arc's only free land on the owners' default
  // framing (the lead's decision in rel-integration.md: G10 stands, a known gap for 1.0), so the label says so
  if (has(C.rainbow?.home?.share)) {
    add('G10', 'rainbow on the default frame >= 0.5 % (bare canvas, HUD not counted; R-04)', C.rainbow.home.share >= 0.005, C.rainbow.home.share);
    add('G10', 'rainbow >= 2 % of the default frame (bare canvas, HUD not counted; R-04 triage proposal, advisory)', null, C.rainbow.home.share);
  }
  const cw = C.wheat?.wheat; const hw = H.wheat?.wheat;
  if (has(cw?.sat, hw?.sat)) add('G11a', 'ripe wheat saturation >= +10 % vs HEAD', cw.sat >= 1.1 * hw.sat, +(cw.sat / hw.sat).toFixed(3));
  if (has(cw?.hue, hw?.hue)) add('G11a', 'ripe wheat hue >= 5 degrees warmer than HEAD', warmth(hw.hue) - warmth(cw.hue) >= 5, +(warmth(hw.hue) - warmth(cw.hue)).toFixed(1));
  if (has(C.sky?.sky?.golden)) {
    const sk = C.sky.sky; const all = ['golden', 'stormy', 'cool', 'pastel'];
    add('G13', 'every sky preset moves the far field >= 12 RGB units', all.every((k) => sk[k] >= 12), sk);
  }
  // QA r4 R4-01 (va#2): no flat band over 4 px inside the porch roof's penumbra at golden and dusk (desktop; HEAD beside)
  for (const f of ['goldenclose', 'duskclose']) {
    const p = C[f]?.edges?.porch;
    if (has(p?.wide)) add('R4-01', `${f}: porch flat runs over 4 px = 0`, p.wide === 0, [p.wide, H[f]?.edges?.porch?.wide ?? null]);
  }
  if (has(n.calls)) add('§8', `draw calls at noon <= ${phone ? 46 : 55}`, n.calls <= (phone ? 46 : 55), n.calls);
  if (has(n.heapMB)) add('§8', 'JS heap after GC <= 27 MB (advisory: other lanes add to it)', n.heapMB <= 27, n.heapMB);
  for (const f of ['noon', 'golden', 'night']) {
    if (has(C[f]?.gpu?.p50, H[f]?.gpu?.p50)) {
      const cap = phone ? 3.5 : f === 'night' ? 1.5 : 2.0;
      add('§8', `${f} GPU p50 delta vs HEAD <= +${cap} ms (advisory, load-sensitive)`, C[f].gpu.p50 - H[f].gpu.p50 <= cap, +(C[f].gpu.p50 - H[f].gpu.p50).toFixed(2));
    }
  }
  return out;
}

// the 360 x 640 phone (scope §4: "360" = 360x640 DPR 3 touch)
const SMALL = { viewport: { width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false },
  userAgent: KnownDevices['Galaxy S5'].userAgent };

async function openFarm(browser, ctx, base, tokens, { phone, quality, device = null, lang = 'en', query = '', settle = settleMs, before = null }) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // Puppeteer names console.warn 'warn' ('warning' was the old name: the filter never matched, QA r1 R-01)
  page.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type())) errors.push(`console.${m.type()}: ${m.text().slice(0, 240)}`); });
  const dv = device || (phone ? 'phone' : 'desk');
  if (dv === 'phone') await page.emulate(KnownDevices['iPhone 13']);
  else if (dv === 'small') await page.emulate(SMALL);
  else await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((tk, lg) => {
    try {
      localStorage.setItem('hh.tokens', JSON.stringify(tk)); sessionStorage.setItem('hh.slot', JSON.stringify('p1'));
      localStorage.setItem('hh.lang', lg);
      for (const p of ['p1', 'p2']) localStorage.setItem(`hh.coach.hidden.${p}`, 'true');
    } catch { /* storage blocked */ }
  }, tokens, lang);
  const cdp = await page.createCDPSession();
  if (before) await before(page, cdp);
  const qs = [quality ? `quality=${quality}` : '', query].filter(Boolean).join('&');
  await page.goto(`${base}/${qs ? `?${qs}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__hh && window.__hh.state && window.__hh.view?._internals, { timeout: 180_000 });
  await sleep(settle);
  await page.evaluate(() => { try { window.__hh.ui.panels.closeAll(); } catch { /* none */ } });
  return { page, cdp, errors };
}

async function grid(browser, cells, cols, file) {
  // cells: rows of [label, dataUrl|null]; composed in a blank page (no file of the game involved)
  const page = await browser.newPage();
  const png = await page.evaluate(async (rows, nc) => {
    const imgs = await Promise.all(rows.flat().map(([, u]) => (u ? new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = u; }) : null)));
    const first = imgs.find(Boolean);
    if (!first) return null;
    const cw = first.width; const ch = first.height; const pad = 22;
    const c = document.createElement('canvas'); c.width = cw * nc; c.height = (ch + pad) * rows.length;
    const x = c.getContext('2d'); x.fillStyle = '#111'; x.fillRect(0, 0, c.width, c.height); x.font = '15px sans-serif'; x.fillStyle = '#fff';
    rows.forEach((row, r) => row.forEach(([label], k) => {
      const img = imgs[r * nc + k];
      x.fillText(label, k * cw + 6, r * (ch + pad) + 16);
      if (img) x.drawImage(img, k * cw, r * (ch + pad) + pad, cw, ch);
    }));
    return c.toDataURL('image/png');
  }, cells, cols);
  await page.close();
  if (png) fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
  return png ? path.relative(ROOT, file) : null;
}

// --------------------------------------------------------------------------------------------------------------
const trees = [['cur', ROOT, port]];
if (args.head) trees.unshift(['head', runnableTree(args.head), port + 3]);
const servers = [];
const result = { tool: 'look-perf', scene, load0: load(), devices: {}, errors: [], files: [] };
let browser;
try {
  const toks = {};
  for (const [name, root, p] of trees) {
    const save = prepareSave(`${name}-${p}`);
    toks[name] = save.tokens;
    const s = startServer(root, p, save.dir);
    servers.push(s);
    await s.ready();
  }
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--enable-precise-memory-info',
      '--js-flags=--expose-gc', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  for (const dev of devices) {
    const phone = dev === 'phone' || dev === 'small';
    result.devices[dev] = { runs: [] };
    for (let run = 0; run < runs; run++) {
      const r = {};
      for (const [name, , p] of trees) {
        const ctx = await browser.createBrowserContext();
        const base = `http://localhost:${p}`;
        if (scene === 'stats') {
          r[name] = await statsScene(browser, base, toks[name], name, dev);
          result.files.push(...r[name].files);
          await ctx.close();
          continue;
        }
        if (scene === 'blip') {
          r[name] = await blipScene(browser, base, toks[name], name, dev);
          result.files.push(...r[name].files);
          await ctx.close();
          continue;
        }
        if (scene === 'shots') {
          r[name] = await shotsScene(browser, base, toks[name], name, dev);
          for (const l of Object.values(r[name])) { result.files.push(...l.files); result.errors.push(...l.errors.map((e) => `${name}/${dev}: ${e}`)); }
          await ctx.close();
          continue;
        }
        if (scene === 'auto') {
          const sessions = [];
          for (let sIdx = 0; sIdx < 2; sIdx++) {
            const { page, errors } = await openFarm(browser, ctx, base, toks[name], { phone, device: dev, quality: null });
            sessions.push({ start: await page.evaluate(() => window.__hh.view._internals.tier), ...(await autoTrace(page)) });
            result.errors.push(...errors.map((e) => `${name}/${dev}: ${e}`));
            await page.close();
          }
          r[name] = { sessions };
        } else {
          const { page, cdp, errors } = await openFarm(browser, ctx, base, toks[name], { phone, device: dev, quality: 'high' });
          r[name] = await measurePage(page, cdp, phone, name, name === 'cur' ? r.headShared || null : null);
          if (name === 'head') r.headShared = await page.evaluate(() => { const m = window.__lpMaskNoon || {}; return { roof: m.roof || null, roofAll: m.roofAll || null }; });
          // --variants <file.mjs> (look-dev): an array of [name, async () => { ... }] whose function source runs in the
          // page; each variant is applied to this tree and every frame measured again (r.cur.variants[name])
          if (args.variants && name === 'cur') {
            const list = (await import(pathToFileURL(path.resolve(ROOT, args.variants)).href)).default;
            r[name].variants = {};
            for (const [vn, fn] of list) {
              await page.evaluate(`(${fn.toString()})()`);
              const m = await measurePage(page, cdp, phone, 'variant');
              for (const [f, img] of Object.entries(m.images)) r[name].images[`${f}~${vn}`] = img;
              delete m.images;
              r[name].variants[vn] = m;
            }
          }
          r[name].gpuName = await page.evaluate(() => { const gl = window.__hh.view._internals.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
          result.errors.push(...errors.filter((e) => !/favicon/.test(e)).map((e) => `${name}/${dev}: ${e}`));
          await page.close();
        }
        await ctx.close();
      }
      if (scene === 'look') {
        // the frame grid: one PNG per device and run, HEAD | this tree per row (desktop) or per column (phone)
        const names = frames.filter((f) => r.cur.images[f]);
        const cols = [...trees.map(([n]) => [n, n, '']), ...Object.keys(r.cur.variants || {}).map((vn) => ['cur', `cur~${vn}`, `~${vn}`])];
        const cells = phone
          ? cols.map(([n, label, suf]) => names.map((f) => [`${label} ${f}`, r[n].images[`${f}${suf}`]]))
          : names.map((f) => cols.map(([n, label, suf]) => [`${label} ${f}`, r[n].images[`${f}${suf}`]]));
        const file = path.join(outDir, `grid-${dev}${tag}-run${run + 1}.png`);
        const g = await grid(browser, cells, phone ? names.length : cols.length, file);
        if (g) result.files.push(g);
        if (args.frames_out !== 'none') {
          const keep = new Set(['noon', 'golden', 'dusk', 'night', 'goldenclose', 'noonclose', 'duskclose', 'goldenclose-plateaus', 'duskclose-plateaus']);
          for (const [n] of trees) for (const f of Object.keys(r[n].images)) {
            if (!keep.has(f.split('~')[0]) || !r[n].images[f]) continue;
            const ff = path.join(outDir, 'frames', `${n}-${dev}-${f}${tag}-run${run + 1}.png`);
            fs.mkdirSync(path.dirname(ff), { recursive: true });
            fs.writeFileSync(ff, Buffer.from(r[n].images[f].split(',')[1], 'base64'));
            result.files.push(path.relative(ROOT, ff));
          }
        }
        for (const [n] of trees) delete r[n].images;
      }
      delete r.headShared;
      if (scene === 'look' && r.head && r.cur) r.checks = checks(r, phone);
      result.devices[dev].runs.push(r);
    }
  }
} catch (e) {
  result.errors.push(`fatal: ${e.stack || e.message}`);
} finally {
  if (browser) await browser.close();
  for (const s of servers) s.proc.kill('SIGTERM');
  await sleep(500);
}
result.load1 = load();
// F6a: zero console errors and warnings on load (this tree's pages; HEAD's own warnings are its baseline): the run fails
result.console = result.errors.filter((e) => /^cur\//.test(e) && /console\.|pageerror/.test(e));
result.ok = !result.errors.some((e) => e.startsWith('fatal')) && result.console.length === 0
  && (!['blip', 'stats'].includes(scene) || Object.values(result.devices).every((d) => d.runs.every((r) => r.cur?.ok)));
result.host = os.hostname() ? 'local' : '';
const line = JSON.stringify(result);
if (args.json) fs.writeFileSync(path.resolve(ROOT, args.json), `${line}\n`);
console.log(line);
if (!result.ok) process.exitCode = 1;
