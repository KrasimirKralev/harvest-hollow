// Builds MNKISWAN Tree Village as a static site for GitHub Pages (or any static host), into dist/ by default.
//
//   PAGES_BASE=https://<user>.github.io/<repo> node tools/build-pages.mjs [--out dist]
//
// No farm server is needed: pages/local-server.js (bundled here with esbuild) runs the same server code inside the
// page and keeps the village in the browser's storage. The page is rendered by the server's own StaticFiles in its
// "host" variant (option 2): every game file is named under PAGES_BASE with the repo's layout
//   <base>/public/...      the client (public/), plus the asset packs under public/assets/packs/
//   <base>/shared/...      the shared rules and content
//   <base>/vendor/three/   three.js (build/ and examples/jsm/)
// with integrity hashes from these very files. PAGES_BASE must be the absolute URL the site is served at (no trailing
// slash). Without it the build reads GITHUB_REPOSITORY (owner/repo, set in GitHub Actions).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { StaticFiles } from '../server/static.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, 'dist'));

function pagesBase() {
  if (process.env.PAGES_BASE) return process.env.PAGES_BASE.replace(/\/+$/, '');
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('set PAGES_BASE (e.g. https://you.github.io/your-repo) or GITHUB_REPOSITORY');
  const [owner, name] = repo.split('/');
  const host = `${owner.toLowerCase()}.github.io`;
  return name.toLowerCase() === host ? `https://${host}` : `https://${host}/${name}`;
}

const BASE = pagesBase();
const PATH = new URL(BASE).pathname.replace(/\/+$/, '');      // '/mnkiswan_' ('' at a domain's root)
const quiet = { info() {}, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a), debug() {} };

function copyDir(from, to, filter = () => true) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (!filter(a, e)) continue;
    if (e.isDirectory()) copyDir(a, b, filter);
    else if (e.isFile()) fs.copyFileSync(a, b);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 1. the game files in the repo's layout
const notHtml = (a) => !/\.(html)$/.test(a) || /privacy\.html$/.test(a);
copyDir(path.join(ROOT, 'public'), path.join(OUT, 'public'), notHtml);
copyDir(path.join(ROOT, 'shared'), path.join(OUT, 'shared'));
const three = path.join(ROOT, 'node_modules', 'three');
copyDir(path.join(three, 'build'), path.join(OUT, 'vendor', 'three', 'build'));
copyDir(path.join(three, 'examples', 'jsm'), path.join(OUT, 'vendor', 'three', 'examples', 'jsm'));
fs.copyFileSync(path.join(three, 'package.json'), path.join(OUT, 'vendor', 'three', 'package.json'));

// 2. the page, rendered by the server's own StaticFiles (host variant)
const sf = new StaticFiles({ root: ROOT, log: quiet });
const page = sf.indexHtml('index.html', BASE);
if (!page) throw new Error('public/index.html is missing');
let html = page.body.toString('utf8');
// the host variant's watchdog falls back to "this server": a static site has none
html = html.replace(/<script>\(function\(\)\{var B=[\s\S]*?<\/script>\n?/, '');
// one origin serves the page and every file: the host variant's integrity pins (against a foreign host) only cost a
// second download of every module preload, so they go
html = html.replace(/(<script type="importmap">\s*)([\s\S]*?)(\s*<\/script>)/, (all, a, json, b) => {
  const map = JSON.parse(json);
  delete map.integrity;
  return `${a}${JSON.stringify(map)}${b}`;
});
html = html.replace(/ integrity="[^"]*"/g, '');
// what the host variant leaves on "this server" (manifest, icons, the boot script's fallbacks) lives under the base too
html = html.replace(/\b(href|src|content)="\/(?!\/)/g, `$1="${BASE}/public/`);
html = html.replace(/: '\/assets\/art\/logo\.webp'/, `: '${BASE}/public/assets/art/logo.webp'`);
html = html.replace(/'\/manifest\./g, `'${BASE}/public/manifest.`);
// the asset packs are files next to the rest
html = html.replace(/<meta name="hh-packs" [^>]*>/, (m) => `${m}\n  <meta name="hh-packs-base" content="${BASE}/public">`);
// the farm server, in the page: before the game's module entry
const entry = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=[^>]*><\/script>/i;
if (!entry.test(html)) throw new Error('index.html: no module entry script found');
html = html.replace(entry, (m) => `<script src="${BASE}/local-server.js?v=${sf.build}"></script>\n${m}`);
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, '404.html'), html.replace('<head>', '<head>\n  <meta name="robots" content="noindex">'));

// 3. the asset packs, as files
const packDir = path.join(OUT, 'public', 'assets', 'packs');
fs.mkdirSync(packDir, { recursive: true });
const { index } = sf.packIndex();
fs.writeFileSync(path.join(packDir, 'index.json'), JSON.stringify(index));
let packBytes = 0;
for (const [id, p] of Object.entries(index)) {
  const e = sf.packBody(id, p.v);
  if (!e) throw new Error(`pack ${id} could not be built`);
  fs.writeFileSync(path.join(packDir, `${id}.bin`), e.body);
  packBytes += e.body.length;
}

// 4. the web app manifest under the base
for (const name of ['manifest.webmanifest', 'manifest.bg.webmanifest']) {
  const f = path.join(OUT, 'public', name);
  if (!fs.existsSync(f)) continue;
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  m.id = `${PATH}/`;
  m.start_url = `${PATH}/`;
  m.scope = `${PATH}/`;
  m.description = 'A cozy 3D tree village farm, right in your browser.';
  m.icons = (m.icons || []).map((i) => ({ ...i, src: i.src.startsWith('/') ? `${PATH}/public${i.src}` : i.src }));
  fs.writeFileSync(f, `${JSON.stringify(m, null, 2)}\n`);
}

// 5. the in-page farm server
await esbuild({
  entryPoints: [path.join(ROOT, 'pages', 'local-server.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  alias: {
    'node:crypto': path.join(ROOT, 'pages', 'shims', 'node-crypto.js'),
    'node:perf_hooks': path.join(ROOT, 'pages', 'shims', 'node-perf-hooks.js'),
  },
  inject: [path.join(ROOT, 'pages', 'shims', 'globals.js')],
  define: { __HH_BUILD__: JSON.stringify(sf.build) },
  outfile: path.join(OUT, 'local-server.js'),
  logLevel: 'warning',
});

// 6. GitHub Pages: serve files as they are (no Jekyll)
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

let files = 0;
let bytes = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const a = path.join(d, e.name);
    if (e.isDirectory()) walk(a); else { files++; bytes += fs.statSync(a).size; }
  }
})(OUT);
console.log(JSON.stringify({ ok: true, base: BASE, out: path.relative(ROOT, OUT) || '.', build: sf.build, files,
  mb: Math.round(bytes / 1e5) / 10, packs: Object.keys(index).length, packMb: Math.round(packBytes / 1e5) / 10 }));
