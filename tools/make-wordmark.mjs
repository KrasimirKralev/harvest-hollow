// Renders the "Harness Hollow" wordmark SVGs (tools/make-wordmark.py: public/assets/art/wordmark.svg and
// wordmark-wide.svg) into the logo files the pages show, under their old names and sizes, so no page changes layout:
//   public/assets/art/logo.png + logo.webp            1200 x 538, the stacked one (the loading screen)
//   public/assets/art/logo-wide.png + logo-wide.webp  1400 x 336, the wide one (the slot picker, the gates, privacy)
// and updates their byte counts in public/assets/art/manifest.json. One headless Chrome; encoding is Chrome's own
// (canvas.toDataURL('image/webp')): no image dependency. Then, for the sizes made from these files:
//   node tools/landing-assets.mjs --only logo                 the landing page's logo-wide_{560,880,1120}.webp
//   python3 docs/qa/mobile/input/make-pwa-icons.py           the home-screen icons (public/assets/pwa, Pillow)
//
//   node tools/make-wordmark.mjs [--out <dir>]   (--out: write the PNGs there for a look, leave the real files alone)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'public', 'assets', 'art');
const outArg = process.argv.indexOf('--out');
const PREVIEW = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : null;
const JOBS = [
  { svg: 'wordmark.svg', name: 'logo', w: 1200, h: 538, q: 0.88 },
  { svg: 'wordmark-wide.svg', name: 'logo-wide', w: 1400, h: 336, q: 0.88 },
];

/** The SVG drawn at its own size on a transparent page: PNG bytes. */
async function render(page, file, w, h) {
  const svg = fs.readFileSync(path.join(ART, file), 'utf8');
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
  return Buffer.from(await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } }));
}

async function toWebp(page, png, q) {
  const b64 = await page.evaluate(async (src, quality) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', quality).split(',')[1];
  }, `data:image/png;base64,${png.toString('base64')}`, q);
  return Buffer.from(b64, 'base64');
}

const written = [];
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new', args: ['--no-sandbox', '--mute-audio'] });
  const page = await browser.newPage();
  const manifestFile = path.join(ART, 'manifest.json');
  // edited as text: a JSON round trip would move the integer-like keys ("512", "128") and rewrite the whole file
  let manifest = fs.readFileSync(manifestFile, 'utf8');
  const setBytes = (file, bytes) => {
    const re = new RegExp(`("file": "${file.replace('.', '\\.')}",[^}]*?"bytes": )(\\d+)`);
    const old = Number(manifest.match(re)?.[2]);
    if (!Number.isFinite(old)) throw new Error(`manifest.json has no entry for ${file}`);
    manifest = manifest.replace(re, `$1${bytes}`).replace(/("totalBytes": )(\d+)/, (_, k, n) => `${k}${Number(n) - old + bytes}`);
  };
  for (const job of JOBS) {
    const png = await render(page, job.svg, job.w, job.h);
    if (PREVIEW) {
      fs.mkdirSync(PREVIEW, { recursive: true });
      fs.writeFileSync(path.join(PREVIEW, `${job.name}.png`), png);
      written.push(path.join(PREVIEW, `${job.name}.png`));
      continue;
    }
    const webp = await toWebp(page, png, job.q);
    for (const [ext, buf] of [['png', png], ['webp', webp]]) {
      fs.writeFileSync(path.join(ART, `${job.name}.${ext}`), buf);
      setBytes(`${job.name}.${ext}`, buf.length);
      written.push({ file: `public/assets/art/${job.name}.${ext}`, kb: +(buf.length / 1024).toFixed(1) });
    }
  }
  if (!PREVIEW) fs.writeFileSync(manifestFile, manifest);
  console.log(JSON.stringify({ ok: true, written }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err?.stack || err), written }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
}
