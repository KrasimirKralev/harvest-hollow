// Recursively list (and optionally download) a public Google Drive folder via embeddedfolderview.
// usage: node tools/gdrive-folder.mjs <folderId> [outDir|-] [--skip=Blends,Blend,OBJ]   ("-" = list only)
import fs from 'node:fs';
import path from 'node:path';
const [, , rootId, outDir, ...flags] = process.argv;
const skip = new Set((flags.find((f) => f.startsWith('--skip=')) || '--skip=').slice(7).split(',').filter(Boolean));
const dryRun = !outDir || outDir === '-';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function list(id) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`);
    if (res.ok) {
      const html = await res.text();
      const out = [];
      const re = /href="https:\/\/drive\.google\.com\/(drive\/folders|file\/d)\/([^/"?]+)[^"]*"[\s\S]*?flip-entry-title">([^<]+)/g;
      let m;
      while ((m = re.exec(html))) out.push({ kind: m[1] === 'file/d' ? 'file' : 'folder', id: m[2], name: m[3].replace(/&amp;/g, '&').replace(/&#39;/g, "'") });
      return out;
    }
    await sleep(1000 * (i + 1));
  }
  throw new Error(`list failed ${id}`);
}
async function download(id, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return 'cached';
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
    const ct = res.headers.get('content-type') || '';
    if (res.ok && !ct.includes('text/html')) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return buf.length;
    }
    await sleep(1500 * (i + 1));
  }
  throw new Error(`download failed ${id} -> ${dest}`);
}
let total = 0;
async function walk(id, rel) {
  const items = await list(id);
  for (const it of items) {
    const r = path.join(rel, it.name);
    if (it.kind === 'folder') {
      if (skip.has(it.name)) { console.log(`skip  ${r}/`); continue; }
      await walk(it.id, r);
    } else if (dryRun) {
      console.log(`file  ${r}  ${it.id}`);
    } else {
      jobs.push(async () => {
        const n = await download(it.id, path.join(outDir, r));
        if (typeof n === 'number') total += n;
        console.log(`got   ${r}  ${n}`);
      });
    }
  }
}
const jobs = [];
await walk(rootId, '');
// Download with a small worker pool; Drive serves single files slowly but tolerates parallelism.
const CONCURRENCY = 6;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (jobs.length) await jobs.shift()(); }));
if (!dryRun) console.log(`TOTAL ${(total / 1e6).toFixed(1)} MB`);
