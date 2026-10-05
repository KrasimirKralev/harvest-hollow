// Digest of a qa-playtest run (docs/qa/wave1/playtest-log.jsonl + playtest-summary.json) for the report author.
//   node tools/qa-analyze.mjs [dir]                      default dir: docs/qa/wave1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.argv[2] || path.join(ROOT, 'docs/qa/wave1'));
const rows = fs.readFileSync(path.join(dir, 'playtest-log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const R = JSON.parse(fs.readFileSync(path.join(dir, 'playtest-summary.json'), 'utf8'));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const out = [];
const P = (...a) => out.push(a.join(' '));

P('# DIGEST', dir);
P('minutes logged:', rows.length, ' evenings:', [...new Set(rows.map((r) => r.evening))].join(','));
P('\n## level ladder (play minute = minutes of play so far, both players)');
for (const [l, v] of Object.entries(R.levels)) P(`L${l}: play-minute ${v.playMinute}  (evening ${v.evening} m${v.minute}, ${v.clock})  coins ${v.coins}  xp ${v.xp}`);

P('\n## evenings');
for (const e of R.evenings) P(`${e.label}: L${e.levelStart} -> L${e.levelEnd}, coins ${e.coinsStart} -> ${e.coinsEnd}, xpEnd ${e.xpEnd}, idleBoth ${e.idleBoth}, rejects ${e.rejects} (server ${e.serverRejects}), quests done ${e.questsDone.length}`);

P('\n## rejects by code (server / local)');
const byCode = {};
for (const r of R.rejects) { const k = `${r.type} ${r.code} ${r.local ? 'local' : 'server'}`; byCode[k] = (byCode[k] ?? 0) + 1; }
for (const [k, n] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) P(String(n).padStart(4), k);

P('\n## toasts the players saw (count)');
const tc = {};
for (const t of R.toasts) { const k = t.text.replace(/\d+/g, 'N'); tc[k] = (tc[k] ?? 0) + 1; }
for (const [k, n] of Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 40)) P(String(n).padStart(4), k);

P('\n## tracker: NOW card kinds (as the DOM showed p1) and longest streaks');
const kind = (t) => (!t ? 'none' : /^Everything is growing/.test(t) ? 'tip' : /^Collect/.test(t) ? 'collect' : /^Plant/.test(t) ? 'plant' : /^Clear a weed/.test(t) ? 'debris' : /order/i.test(t) ? 'order' : /Barn is full/.test(t) ? 'barn' : 'other');
const kinds = {};
let streak = { t: null, n: 0 }; const streaks = [];
for (const r of rows) {
  const t = r.tracker?.p1?.now ?? '';
  const k = kind(t);
  kinds[k] = (kinds[k] ?? 0) + 1;
  const base = t.replace(/\d+:\d+/g, 'T').replace(/\d+/g, 'N');
  if (streak.t === base) streak.n++; else { if (streak.n >= 8) streaks.push({ ...streak }); streak = { t: base, n: 1 }; }
}
if (streak.n >= 8) streaks.push(streak);
P(JSON.stringify(kinds));
for (const s of streaks) P(`  NOW unchanged for ${s.n} minutes: ${s.t}`);
P('SOON cards that stayed the same for 25+ minutes:');
let ss = { t: null, n: 0, from: 0 };
const soonStreaks = [];
for (const r of rows) {
  const t = (r.tracker?.p1?.soon ?? '').replace(/\d+\/\d+/g, 'N/N').replace(/\d+/g, 'N');
  if (ss.t === t) ss.n++; else { if (ss.n >= 25) soonStreaks.push({ ...ss }); ss = { t, n: 1, from: r.play }; }
}
if (ss.n >= 25) soonStreaks.push(ss);
for (const s of soonStreaks) P(`  ${s.n} min from play-minute ${s.from}: ${s.t}`);

P('\n## waiting with nothing to do (both players, attention left)');
P('minutes:', R.idleBoth.length, 'of', rows.length);
const runs = [];
let run = [];
for (const r of rows) { if (r.bothIdle) run.push(r); else { if (run.length >= 4) runs.push(run); run = []; } }
if (run.length >= 4) runs.push(run);
for (const rr of runs) P(`  ${rr.length} minutes from E${rr[0].evening} m${rr[0].minute} (L${rr[0].level}, ${rr[0].coins} coins): NOW "${rr[0].tracker?.p1?.now}"; notes ${JSON.stringify(rr[0].notes?.p1 ?? rr[0].notes ?? '')}`);

P('\n## tracker problems (rules cross-check)');
const tp = {};
for (const t of R.trackerProblems) { const k = t.text.replace(/\d+/g, 'N'); (tp[k] ??= []).push(t.at); }
for (const [k, v] of Object.entries(tp)) P(`  x${v.length} (first ${v[0]}, last ${v.at(-1)}): ${k}`);

P('\n## ack latency of action bursts (ms)');
P('n', R.latency.length, 'p50', pct(R.latency, 0.5), 'p90', pct(R.latency, 0.9), 'p99', pct(R.latency, 0.99), 'max', Math.max(...R.latency), 'timeouts(-1)', R.latency.filter((x) => x < 0).length);
const rtts = rows.map((r) => r.rtt).filter(Number.isFinite);
P('rtt p50', pct(rtts, 0.5), 'max', Math.max(...rtts));

P('\n## console / page errors');
const ec = {};
for (const e of R.errors) { const k = `${e.kind}: ${e.text.slice(0, 140)}`; ec[k] = (ec[k] ?? 0) + 1; }
for (const [k, n] of Object.entries(ec)) P(String(n).padStart(4), k);

P('\n## UI probes');
for (const p of R.uiProbes) P(`${p.ok ? 'ok  ' : 'FAIL'} [${p.at}] ${p.name} ${p.detail ? `-- ${p.detail}`.slice(0, 220) : ''}`);

P('\n## coin sources (ledger rows read each minute; coins in / out over the run)');
// the first minute after a page was re-opened (the return evening) read the 500 rows already counted: left out here
const reopened = R.evenings.find((e) => /return/.test(e.label))?.n;
const src = {};
for (const r of rows) {
  if (r.evening === reopened && r.minute === 0) continue;
  for (const [k, v] of Object.entries(r.ledger ?? {})) { const e = (src[k] ??= { in: 0, out: 0 }); if (v >= 0) e.in += v; else e.out += -v; }
}
const totalIn = Object.values(src).reduce((a, v) => a + v.in, 0);
for (const [k, v] of Object.entries(src).sort((a, b) => b[1].in - a[1].in)) P(`  ${k.padEnd(14)} in ${String(v.in).padStart(9)} (${((100 * v.in) / totalIn).toFixed(1)} %)  out ${String(v.out).padStart(9)}`);
P('  total in', totalIn);

P('\n## acts by type');
P(JSON.stringify(R.actsByType));
P('soft cards raised', JSON.stringify(R.softCards));
P('\n## co-op probes');
for (const c of R.coop) P(JSON.stringify(c).slice(0, 400));
P('blips', JSON.stringify(R.blips));
P('desync', JSON.stringify(R.desync).slice(0, 600));
P('\n## notes');
for (const n of R.notes) P(JSON.stringify(n).slice(0, 700));
P('\nshots:', R.shots.length);

console.log(out.join('\n'));
