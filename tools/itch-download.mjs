// Download free / name-your-own-price files from an itch.io page (no account).
// usage: node tools/itch-download.mjs <pageUrl> <outDir|-> [filenameRegex]   ("-" = list only)
import fs from 'node:fs';
import path from 'node:path';
const [, , pageUrl, outDir, pattern] = process.argv;
const re = pattern ? new RegExp(pattern, 'i') : null;
const jar = new Map();
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
function saveCookies(res) {
  for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); }
}
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function req(url, opts = {}) {
  const res = await fetch(url, { ...opts, redirect: 'manual', headers: { 'User-Agent': UA, Cookie: cookie(), ...(opts.headers || {}) } });
  saveCookies(res);
  if (res.status >= 300 && res.status < 400) return req(new URL(res.headers.get('location'), url).toString());
  return res;
}
const page = await (await req(pageUrl)).text();
const csrf = page.match(/name="csrf_token" value="([^"]+)"/)?.[1];
if (!csrf) throw new Error('no csrf token');
const base = pageUrl.replace(/\/$/, '');
const form = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body: new URLSearchParams(o).toString() });
const du = await (await req(`${base}/download_url`, form({ csrf_token: csrf }))).json();
if (!du.url) throw new Error('no download url ' + JSON.stringify(du));
const dl = await (await req(du.url)).text();
const keyParam = (() => { const m = dl.match(/init_GameDownload\([^,]+, (\{.*?\})\);/); try { const o = JSON.parse(m[1]); return o.key ? `&key=${encodeURIComponent(o.key)}` : ''; } catch { return ''; } })();
const csrf2 = dl.match(/name="csrf_token" value="([^"]+)"/)?.[1] || csrf;
const uploads = [...dl.matchAll(/data-upload_id="(\d+)"[\s\S]*?<strong[^>]*title="([^"]+)"[\s\S]*?class="file_size"><span>([^<]+)/g)].map((m) => ({ id: m[1], name: m[2], size: m[3] }));
const uniq = [...new Map(uploads.map((u) => [u.id, u])).values()];
for (const u of uniq) console.log(`upload ${u.id}  ${u.name}  ${u.size}`);
if (outDir === '-') process.exit(0);
fs.mkdirSync(outDir, { recursive: true });
for (const u of uniq) {
  if (re && !re.test(u.name)) continue;
  const dest = path.join(outDir, u.name);
  if (fs.existsSync(dest)) { console.log('cached', dest); continue; }
  const j = await (await req(`${base}/file/${u.id}?source=game_download${keyParam}`, form({ csrf_token: csrf2 }))).json();
  if (!j.url) throw new Error('no file url ' + JSON.stringify(j));
  const res = await fetch(j.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${u.name}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`got ${dest} ${(buf.length / 1e6).toFixed(1)} MB`);
}
