// Option 2's guard (option2#D11 test 5, release-scope §7.4): every static URL the client builds at runtime goes through
// net/asset-base.js assetUrl(), so with <meta name="hh-assets"> the page takes its files from the public host and
// without it nothing changes. A site that is missed silently keeps its bytes on the Farmbox link (or, for a CSS url(),
// gets a font blocked by CORS: option2#4). The rules:
//   R1  a client string literal that starts with /assets/, /css/ or /js/ and is not handed to a function that routes
//       it (assetUrl, ensureStylesheet, fromPack: it fetches the pack, inImportMap: map keys stay root paths)
//   R2  a CSS url(/…) written inside a client string (an inline style)
//   R3  url('/…') in public/css/*.css: relative instead (url('../assets/…')), right for /css/x.css and
//       <host>/b/<build>/public/css/x.css alike
//   R4  an absolute-path import: a module from the host would resolve it on the host's root, outside the map's keys
//   R5  a new Image() in public/js/render/ (drawn into a canvas texture) without crossOrigin before src: a tainted
//       canvas fails texSubImage2D (option2#5)
//   R6  a new Audio() without crossOrigin before src: Web Audio outputs silence for a cross-origin element (option2#5)
// A line may carry `// asset-ok: <why>` for a URL that is a key or a comparison, never fetched.
// Other lanes' sites are reported (each lane fixes its own files, option2#6); a reported file may only shrink, and it
// leaves PENDING (strict from then on) as soon as it is clean. infra's own files are strict from day one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { ASSET_PENDING as PENDING } from './rel-infra.pending.js';

const ROUTERS = /(?:\bassetUrl|\bensureStylesheet|\bfromPack|\binImportMap)\(\s*$|\bCSS_HREF\s*=\s*$/;
const STATIC = /^\/(assets|css|js)\//;

/** The lane that owns a file (release-scope §6), for the report. */
export function ownerOf(file) {
  const f = file.replace(/^public\//, '');
  if (/^js\/(main\.js|net\/|render\/(assets|icons)\.js$|landing\.js$|privacy\.js$|front\/)|^css\/(landing|privacy)\.css$/.test(f)) return 'infra';
  if (/^js\/render\/(fx|tweens|animals-view|avatars-view|avatar-looks|crates-view|ambient-life|frogs-view|birdbath-view|grandma-view|gift-view|name-tags)\.js$/.test(f)
    || /^js\/(game\/(feedback|haptics)|audio|ui\/(toasts|levelup|recap|feed|naming))\.js$|^css\/feel\.css$/.test(f)) return 'life-feel';
  if (/^js\/render\//.test(f)) return 'render-look';
  if (/^js\/ui\/(tracker|goal-text|panels\/gift)\.js$|^css\/panels-rel\.css$/.test(f)) return 'features';
  if (/^js\/ui\/panels\/|^js\/ui\/(chains|item-hint|item-sources)\.js$|^css\/(panels[\w-]*|mobile-panels)\.css$|^js\/i18n\//.test(f)) return 'ui-panels';
  if (/^js\/(ui\/harness|harness|mod)\/|^css\/harness\.css$/.test(f)) return 'harvey';
  if (/^js\/(ui|game)\/|^css\/(style|shell|mobile|farm|ideas)\.css$|^index\.html$/.test(f)) return 'ui-shell';
  return 'lead';
}


function* walk(dir, ext) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, ext);
    else if (e.isFile() && p.endsWith(ext)) yield p;
  }
}

const COMMENT = /^\s*(\/\/|\/\*|\*)/;
const IMPORT_ABS = /^\s*(?:import|export)\b[^'"]*\bfrom\s*['"]\/|^\s*import\s*['"]\/|\bimport\(\s*['"`]\//;
/** Every string literal on a line: [start index, quote, content up to the closing quote or the line's end]. */
function literals(line) {
  const out = [];
  for (let i = 0; i < line.length; i++) {
    const q = line[i];
    if (q !== "'" && q !== '"' && q !== '`') continue;
    if (line[i - 1] === '/' && line[i - 2] === '/') break;          // a trailing comment
    let j = i + 1;
    while (j < line.length && line[j] !== q) j += line[j] === '\\' ? 2 : 1;
    out.push([i, q, line.slice(i + 1, j)]);
    i = j;
  }
  return out;
}

/** [{ rule, file, line, text }] for one JS source. */
export function scanJs(file, src) {
  const hits = [];
  const lines = src.split('\n');
  const add = (rule, i) => hits.push({ rule, file, line: i + 1, text: lines[i].trim().slice(0, 120) });
  lines.forEach((line, i) => {
    if (COMMENT.test(line) || /\/\/\s*asset-ok\b/.test(line)) return;
    if (IMPORT_ABS.test(line)) { add('R4', i); return; }
    for (const [at, , body] of literals(line)) {
      if (STATIC.test(body) && !ROUTERS.test(line.slice(0, at))) add('R1', i);
      if (/url\(\s*['"]?\/(?!\/)/.test(body)) add('R2', i);
    }
  });
  const ctor = file.includes('/js/render/') ? /\bnew\s+(Image|Audio)\s*\(/ : /\bnew\s+Audio\s*\(/;
  lines.forEach((line, i) => {
    if (COMMENT.test(line) || !ctor.test(line) || /asset-ok\b/.test(line)) return;
    // crossOrigin must come before the first src within the next lines (it is read when src is set)
    const after = lines.slice(i, i + 12).join('\n').slice(line.search(ctor));
    const cors = after.search(/crossOrigin\s*=/);
    const src = after.search(/\bsrc\s*=|\.src\b|\bsrc:/);
    if (cors < 0 || (src >= 0 && src < cors)) add(/Audio/.test(line.match(ctor)[0]) ? 'R6' : 'R5', i);
  });
  return hits;
}

/** [{ rule, file, line, text }] for one stylesheet. */
export function scanCss(file, src) {
  const hits = [];
  src.split('\n').forEach((line, i) => {
    if (/url\(\s*['"]?\/(?!\/)/.test(line)) hits.push({ rule: 'R3', file, line: i + 1, text: line.trim().slice(0, 120) });
  });
  return hits;
}

export function scanTree(root = ROOT) {
  const hits = [];
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  for (const abs of walk(path.join(root, 'public/js'), '.js')) {
    const file = rel(abs);
    if (file.startsWith('public/js/mod/')) continue;            // a farm's mod files come from /mods/ on the Farmbox
    hits.push(...scanJs(file, fs.readFileSync(abs, 'utf8')));
  }
  for (const abs of walk(path.join(root, 'public/css'), '.css')) hits.push(...scanCss(rel(abs), fs.readFileSync(abs, 'utf8')));
  return hits;
}

test('option 2 scan: every static URL routes through assetUrl (others report and may only shrink, infra strict)', (t) => {
  const hits = scanTree();
  const byFile = new Map();
  for (const h of hits) byFile.set(h.file, [...(byFile.get(h.file) || []), h]);
  const bad = [];
  for (const [file, list] of byFile) {
    const pend = PENDING.get(file);
    if (pend && list.length <= pend[1]) continue;
    bad.push(...list.map((h) => `${h.rule} ${h.file}:${h.line} (${ownerOf(h.file)})  ${h.text}`));
  }
  const byOwner = new Map();
  for (const [file, [owner, n]] of PENDING) {
    const left = (byFile.get(file) || []).length;
    byOwner.set(owner, [...(byOwner.get(owner) || []), left ? `${file} ${left}/${n}` : `${file} clean (leaves PENDING)`]);
  }
  for (const [owner, list] of byOwner) t.diagnostic(`asset-url report, ${owner}: ${list.join('; ')}`);
  assert.deepEqual(bad, [], `static URLs not routed through assetUrl() (release-scope §7.4):\n${bad.join('\n')}`);
});

test('option 2 scan: each rule catches its case and lets the routed forms through', () => {
  const js = (src, file = 'public/js/ui/x.js') => scanJs(file, src).map((h) => `${h.rule}:${h.line}`);
  assert.deepEqual(js("const a = '/assets/x.png';\nconst b = assetUrl('/assets/x.png');\nensureStylesheet('/css/a.css');"), ['R1:1']);
  assert.deepEqual(js("img.src = `/assets/art/${f}.webp`;\nimg.src = assetUrl(`/assets/art/${f}.webp`);"), ['R1:1']);
  assert.deepEqual(js("const s = `--art: url(/assets/a.webp)`;\nconst t = `--art: url(${assetUrl('/assets/a.webp')})`;"), ['R2:1']);
  assert.deepEqual(js("// '/assets/x.png' in a comment\nconst k = '/js/harness/bus.js'; // asset-ok: an import-map key"), []);
  assert.deepEqual(js("import { x } from '/js/a.js';\nconst m = await import('/js/b.js');\nimport './c.js';"), ['R4:1', 'R4:2']);
  assert.deepEqual(js('const img = new Image();\nimg.src = u;', 'public/js/render/x.js'), ['R5:1']);
  assert.deepEqual(js("const img = new Image();\nimg.crossOrigin = 'anonymous';\nimg.src = u;", 'public/js/render/x.js'), []);
  assert.deepEqual(js('const img = new Image();\nimg.src = u;', 'public/js/ui/x.js'), [], 'R5 is about canvas textures in render/');
  assert.deepEqual(js("const el = new Audio();\nel.preload = 'none';\nel.src = u;"), ['R6:1']);
  assert.deepEqual(js("const el = new Audio();\nel.crossOrigin = 'anonymous';"), []);
  assert.deepEqual(scanCss('public/css/x.css', "a { background: url('/assets/a.webp'); }\nb { background: url('../assets/a.webp'); }\nc{src:url(data:x)}")
    .map((h) => `${h.rule}:${h.line}`), ['R3:1']);
  assert.equal(ownerOf('public/js/render/badges.js'), 'render-look');
  assert.equal(ownerOf('public/js/render/assets.js'), 'infra');
  assert.equal(ownerOf('public/js/ui/panels/fair.js'), 'ui-panels');
  assert.equal(ownerOf('public/css/shell.css'), 'ui-shell');
});
