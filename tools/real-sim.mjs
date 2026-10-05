#!/usr/bin/env node
// The REAL-rules pacing gate (wave-2 QA RC-03, promoted from docs/qa/qa2/economy/audit-sim.mjs): the reference
// couple plays the real rules (in-process Engine, fake clock) on the casual schedule (Mon / Wed / Sat, 60 minutes
// from 19:00), L1 -> L25, using every M1b system the way a couple would, with a ledger tap per level. tools/econ-sim.mjs
// models M1b with its own simplified numbers and passed 23/23 while these rules missed L22-L25, the Fair, the barge
// and the Town Projects (TRIAGE D1): this is the gate for L1-25; econ-sim stays the model for L26-40.
//
//   node tools/real-sim.mjs --checks                 seeds 7, 11 and 23 (in parallel), 32 evenings each; prints the
//                                                    checks, exit 1 on a FAIL (about 2 minutes on the dev PC)
//   node tools/real-sim.mjs --checks --keep <dir> also keeps each seed's JSON there (real-sim-s<seed>.json)
//   node tools/real-sim.mjs --seed 7 [--evenings 32] [--model real|bot] [--json out.json] [--quiet] [--verbose]
//
// Models:
//   bot   tools/qa-bot.mjs as the wave-2 gates ran it (follows the NOW card's decor every 2-4 minutes)
//   real  the same player without decorating for the gate (no NOW-card decor in the loop); decor and Masterwork
//         are bought once per evening after play with at most decorBp/10000 of the treasury (taste, not a chore)
// Both models pursue the weekly goals (barge crates, townsfolk requests, Town Project goods, Restoration slots:
// planned production through qa-bot's own `need`) and use the M1b systems (Fair entries, barge, Ledger, Town
// Projects, album trades). A minute is IDLE for a player who spent <= 2 of 12 attention points (the wave-2
// definition) and DEAD when the player did nothing at all. qa-bot is loaded from a copy with four measurement hooks
// (the economy lane's make-tree.sh patches), written to TMPDIR and imported by absolute URL.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const ROOT = path.resolve(args.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const MODEL = args.model ?? 'real';
const EVENINGS = Number(args.evenings ?? 32);
const MINUTES = Number(args.minutes ?? 60);
const SEED = Number(args.seed ?? 7);
const MODEL_ARG = args.model ?? 'real';
const DECOR_BP = Number(args.decorBp ?? (MODEL === 'real' ? 500 : 0));
const STOP_AT = Number(args.stopAt ?? 99);
const imp = (p) => import(path.join(ROOT, p));

/** tools/qa-bot.mjs with the measurement hooks, imported from a temp copy (its imports rewritten to absolute URLs). */
async function loadBot() {
  let s = fs.readFileSync(path.join(ROOT, 'tools', 'qa-bot.mjs'), 'utf8');
  const rep = (a, b) => {
    if (!s.includes(a)) throw new Error(`real-sim: qa-bot changed, hook anchor missing: ${a.slice(0, 70)}`);
    s = s.replace(a, b);
  };
  rep("if (n && n.kind === 'decor' && defOf(n.id) && coins >= dCost * 10",
    "if (!globalThis.__HH_NO_DECOR_FOLLOW && n && n.kind === 'decor' && defOf(n.id) && coins >= dCost * 10");
  rep('if (left >= 8 && minsLeft >= 20 && quick.length', 'if (!globalThis.__HH_NO_QUICK && left >= 8 && minsLeft >= 20 && quick.length');
  rep("  for (const { o } of open.slice(0, 2)) for (const [i, q] of Object.entries(o.items)) need(i, q, 'order');",
    "  for (const { o } of open.slice(0, 2)) for (const [i, q] of Object.entries(o.items)) need(i, q, 'order');\n"
    + '  if (globalThis.__HH_EXTRA_NEEDS) globalThis.__HH_EXTRA_NEEDS(S, v, need, now);');
  rep('  const grainKeep = 24;', '  if (globalThis.__HH_EXTRA_KEEP) globalThis.__HH_EXTRA_KEEP(S, keepFor, now);\n  const grainKeep = 24;');
  s = s.replaceAll("from '../", `from '${pathToFileURL(ROOT).href}/`);
  const f = path.join(os.tmpdir(), `hh-real-sim-bot-${process.pid}.mjs`);
  fs.writeFileSync(f, s);
  try { return await import(pathToFileURL(f).href); } finally { fs.rmSync(f, { force: true }); }
}

// ---- the gate ------------------------------------------------------------------------------------------------------
/** Calendar day (from the first Monday) of evening e (1-based): Mon / Wed / Sat. */
const dayOfEvening = (e) => 7 * Math.floor((e - 1) / 3) + [0, 2, 5][(e - 1) % 3];

/** Run the three seeds in parallel child processes, then the checks; returns the exit code. */
async function checks() {
  const seeds = [7, 11, 23];
  const self = fileURLToPath(import.meta.url);
  const t0 = Date.now();
  const runs = await Promise.all(seeds.map((seed) => new Promise((resolve, reject) => {
    const out = path.join(os.tmpdir(), `hh-real-sim-${process.pid}-${seed}.json`);
    const child = spawn(process.execPath, [self, '--seed', String(seed), '--evenings', String(args.evenings ?? 32),
      '--model', MODEL_ARG, '--json', out, '--quiet', ...(args.root ? ['--root', args.root] : [])],
    { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('exit', (code) => {
      if (code !== 0) { reject(new Error(`real-sim seed ${seed} exited ${code}`)); return; }
      const j = JSON.parse(fs.readFileSync(out, 'utf8'));
      if (args.keep) fs.renameSync(out, path.join(String(args.keep), `real-sim-s${seed}.json`));
      else fs.rmSync(out, { force: true });
      resolve(j);
    });
  })));
  const C2 = await import(path.join(ROOT, 'shared/content/index.js'));
  const rows = [];
  const check = (name, ok, detail, gate = true) => rows.push({ name, ok, detail, gate });
  const dayAt = (r, L) => (r.levelAt[L] ? dayOfEvening(r.levelAt[L].evening) : null);
  const by = (f) => runs.map((r) => `s${r.seed} ${f(r)}`).join(', ');
  const within = (L, max, min = 0) => runs.every((r) => dayAt(r, L) !== null && dayAt(r, L) <= max && dayAt(r, L) >= min);
  check('L20 on day 24-38', within(20, 38, 24), by((r) => dayAt(r, 20) ?? '-'));
  check('L22 by day 42', within(22, 42), by((r) => dayAt(r, 22) ?? '-'));
  check('L24 by day 58', within(24, 58), by((r) => dayAt(r, 24) ?? '-'));
  check('L25 by day 72', within(25, 72), by((r) => dayAt(r, 25) ?? '-'));
  const silver = (m) => Boolean(m) && C2.MEDAL_RANKS.indexOf(m) >= C2.MEDAL_RANKS.indexOf('silver1');
  check('Fair Silver+ in >= 70 % of weeks', runs.every((r) => r.fair.length > 0
    && r.fair.filter((x) => silver(x.medal)).length >= 0.7 * r.fair.length),
  by((r) => `${r.fair.filter((x) => silver(x.medal)).length}/${r.fair.length}`));
  const bargeWeeks = (r) => r.barge.filter((x) => x.e === 'bargeDocked').length;
  check('barge: >= 1 full row per 2 weeks', runs.every((r) => (r.evCount.bargeRow ?? 0) >= Math.floor(bargeWeeks(r) / 2)),
    by((r) => `${r.evCount.bargeRow ?? 0} rows in ${bargeWeeks(r)} weeks`));
  check('>= 1 Town Project built by L23', runs.every((r) => r.town.some((x) => x.e === 'townBuilt' && x.L <= 23)),
    by((r) => r.town.filter((x) => x.e === 'townBuilt').map((x) => `${x.project}@L${x.L}`).join('+') || 'none'));
  const stuck = [];
  const src = fs.readdirSync(path.join(ROOT, 'shared/rules/actions')).map((f) => fs.readFileSync(path.join(ROOT,
    'shared/rules/actions', f), 'utf8')).join('\n');
  for (const e of C2.CONTENT.expansions.values()) {
    if (!C2.isLive(e)) continue;
    for (const t of e.proof) if (t.verb !== 'own' && !src.includes(`proofDeed(tx, '${t.verb}'`)) stuck.push(`${e.id}:${t.verb}`);
  }
  check('every live expansion proof is counted by a rule', stuck.length === 0, stuck.join(', ') || 'all');
  check('land keeps opening past Fairground Lane (k = 6)', runs.every((r) => r.expansions.length > 7 || r.level < 17),
    by((r) => `${r.expansions.length - 1} bought`));
  check('treasury above 15 E-h in < 10 % of play', runs.every((r) => r.over15 < 0.1 * r.playMinutes),
    by((r) => `${(100 * r.over15 / r.playMinutes).toFixed(1)} %`));
  // the "always something meaningful" targets of RC-11 / RC-12: reported, gate only with --strict
  const band = (r, a, b) => r.perEvening.filter((x) => x.levelStart >= a && x.levelStart <= b);
  const mean = (a, k) => (a.length ? a.reduce((n, x) => n + k(x), 0) / a.length : 0);
  const strict = Boolean(args.strict);
  check('L20-25 both-idle mean <= 20 min', runs.every((r) => mean(band(r, 20, 25), (x) => x.idle) <= 20),
    by((r) => mean(band(r, 20, 25), (x) => x.idle).toFixed(1)), strict);
  const gapOk = (r) => band(r, 20, 25).filter((x) => x.lqGap.worst <= 40).length >= (2 / 3) * band(r, 20, 25).length;
  check('L20-25 longest level/quest gap <= 40 min in >= 2 of 3 evenings', runs.every(gapOk),
    by((r) => `${band(r, 20, 25).filter((x) => x.lqGap.worst <= 40).length}/${band(r, 20, 25).length}`), strict);
  check('E1 both-idle <= 18 and longest gap <= 10', runs.every((r) => r.perEvening[0].idle <= 18
    && r.perEvening[0].lqGap.worst <= 10), by((r) => `${r.perEvening[0].idle}/${r.perEvening[0].lqGap.worst}`), strict);
  check('E1-E4 both-idle <= 75, no evening > 25', runs.every((r) => r.perEvening.slice(0, 4).reduce((n, x) => n + x.idle, 0)
    <= 75 && r.perEvening.slice(0, 4).every((x) => x.idle <= 25)),
  by((r) => r.perEvening.slice(0, 4).map((x) => x.idle).join('+')), strict);
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`real-sim --checks: seeds ${seeds.join(', ')}, ${args.evenings ?? 32} casual evenings each (${sec} s)`);
  for (const x of rows) console.log(`${x.ok ? 'PASS' : x.gate ? 'FAIL' : 'WARN'}  ${x.name.padEnd(62)} ${x.detail}`);
  for (const r of runs) {
    console.log(`  s${r.seed}: end L${r.level}, Fair ${r.fair.map((x) => x.medal ?? '-').join(' ')}; levels at day `
      + Object.entries(r.levelAt).filter(([L]) => Number(L) >= 15).map(([L, v]) => `L${L}@${dayOfEvening(v.evening)}`).join(' '));
  }
  const fails = rows.filter((x) => !x.ok && x.gate).length;
  console.log(fails ? `${fails} check(s) FAILED` : 'all gating checks pass');
  return fails ? 1 : 0;
}

if (args.checks) process.exit(await checks());

if (MODEL === 'real') globalThis.__HH_NO_DECOR_FOLLOW = true;
if (args.noQuick) globalThis.__HH_NO_QUICK = true;

const { createFarm } = await imp('shared/rules/state.js');
const { Engine } = await imp('server/engine.js');
const { Together } = await imp('server/together.js');
const C = await imp('shared/content/index.js');
const { ACTIONS, makeCtx } = await imp('shared/rules/index.js');
const { parseArgs } = await imp('shared/rules/schema.js');
const ECO = await imp('shared/rules/economy.js');
const FAIR = await imp('shared/rules/actions/fair.js');
const BARGE = await imp('shared/rules/actions/barge.js');
const REST = await imp('shared/rules/actions/restoration.js');
const ALBUM = await imp('shared/rules/actions/album.js');
const BEAUTY = await imp('shared/rules/actions/beauty.js');
const { goals } = await imp('shared/rules/goals.js');
const DEC = await imp('shared/rules/actions/decor.js');
const EXP = await imp('shared/rules/actions/expansions.js');
const BOT = await loadBot();
const { levelFromXp, levelRow, defOf, itemOf, CONTENT } = C;

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 5, 16, 0, 0);            // Monday 19:00 in Sofia
const GAPS_H = [48, 72, 48];                          // Mon -> Wed -> Sat -> Mon, start to start
const clock = { t: T0, now() { return this.t; }, advance(ms) { this.t += ms; }, observe() {} };
const state = createFarm(SEED, T0, 'Europe/Sofia');

const STRICT = new Set(['questDone', 'achievement', 'fairCeremony', 'albumFind', 'townBuilt', 'projectDone']);
const BROAD = new Set(['orderFilled', 'almanacDone', 'meterChest', 'almanacChest', 'gift', 'together', 'mastery',
  'folkFilled', 'bargeRow', 'bundleDone', 'beautyStar', 'decorSet', 'albumSet', 'friendship', 'challengeStarted']);
let evening = 0;
let minute = -1;                                       // -1: between evenings (system actions)
const rewards = [];
const evCount = {};
const onDelta = (d) => {
  for (const ev of d.ev ?? []) {
    evCount[ev.e] = (evCount[ev.e] ?? 0) + 1;
    if (Number.isSafeInteger(ev.xp) && ev.xp > 0) {
      const band = levelFromXp(state.farm.xp) >= 20 ? 'L20+' : levelFromXp(state.farm.xp) >= 15 ? 'L15-19' : 'L1-14';
      const t = (xpBy[band] ??= {});
      t[ev.e] = (t[ev.e] ?? 0) + ev.xp;
    }
    if (ev.e === 'almanacDone' && !ev.paid) continue;              // an unpaid task pays nothing: not a reward
    const strict = STRICT.has(ev.e) || (ev.e === 'levelUp' && ev.scope === 'farm');
    if (strict || BROAD.has(ev.e)) rewards.push({ evening, minute, e: ev.e, strict, id: ev.id ?? ev.level ?? ev.medal ?? ev.project ?? '' });
    if (ev.e === 'fairCeremony') fairLog.push({ evening, w: ev.w, medal: ev.medal ?? null, p: ev.p, W: ev.W, coins: ev.coins });
    if (ev.e === 'bargeCastOff' || ev.e === 'bargeDocked') bargeLog.push({ evening, e: ev.e, ...pick(ev, ['w', 'rows', 'loaded', 'full', 'tier']) });
    if (ev.e === 'townBuilt' || ev.e === 'townPosted') townLog.push({ evening, minute, e: ev.e, project: ev.project, coins: ev.coins ?? null, goods: ev.goods ?? null, L: levelFromXp(state.farm.xp) });
    if (ev.e === 'orderFilled') ordersFilled.push({ evening, minute, value: ev.value, coins: ev.coins, simple: ev.simple, golden: ev.golden, L: levelFromXp(state.farm.xp) });
    if (ev.e === 'projectDone' || ev.e === 'bundleDone') restLog.push({ evening, minute, e: ev.e, p: ev.project ?? ev.p, b: ev.bundle ?? null, L: levelFromXp(state.farm.xp) });
    if (ev.e === 'folkPosted') folk.posted += ev.n ?? 0;
    if (ev.e === 'folkFilled') folk.filled++;
  }
};
const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const fairLog = [];
const ordersFilled = [];
const bargeLog = [];
const townLog = [];
const restLog = [];
const folk = { posted: 0, filled: 0 };
const xpBy = {};                                       // XP by the event that paid it, per level band

const engine = new Engine({ state, server: { clock: { lastNow: 0 }, clients: {}, auth: {} }, clock, onDelta,
  log: { error: (...a) => console.error('ENGINE', ...a), warn() {}, info() {}, log() {} } });
for (const [pid, name] of [['p1', 'Rowan'], ['p2', 'Mia']]) engine.system('_join', { pid, name });
engine.facts = new Together({ online: () => ['p1', 'p2'] });
const mk = (pid) => {
  const cid = `${pid}cid00`;
  engine.client(cid, pid, clock.now());
  let seq = 0;
  return {
    pid,
    nextSeq: () => ++seq,
    async snap() { return { s: engine.state, now: clock.now() }; },
    async act(type, a) {
      const r = engine.act({ pid, cid }, { seq: ++seq, type, args: a });
      return r && r.t === 'rej' ? { ok: false, code: r.code } : { ok: true };
    },
  };
};
const players = [mk('p1'), mk('p2')];
const dom = { p1: { fields: 1, market: 1 }, p2: { barnyard: 1, workshop: 1, orchard: 1, farm: 1 } };
const seenBefore = { p1: new Set(), p2: new Set() };

const L = () => levelFromXp(state.farm.xp);
const now = () => clock.now();
const check = (pid, type, a) => {
  const def = ACTIONS[type];
  if (!def) return 'UNKNOWN_ACTION';
  const parsed = parseArgs(def.schema, a);
  if (!parsed) return 'BAD_ARGS';
  return def.check(state, parsed, makeCtx(state, { now: now(), pid, cid: `${pid}cid00`, seq: 1e9, ext: {}, grace: 0 })) || null;
};
const avail = (item) => ECO.unkept(state, item);

// ---- the weekly goals a couple plans production for (qa-bot `need` hook + keep hook) --------------------------------
function goalNeeds(S, t) {
  const out = [];
  for (const q of Object.keys(S.farm.quests.active)) {
    if (CONTENT.quests.get(q)?.tasks.some((tk) => tk.verb === 'together' && tk.ref === 'duet')) out.push(['sweetheart_cake', 1, 'duet']);
  }
  // the Almanac's open 'make' tasks (qa-bot plans only harvest / plant / clear ones)
  for (const p of Object.values(S.players)) {
    const a = p.almanac;
    if (!a || !(a.paid < (C.ALMANAC?.paidPerDay ?? 4))) continue;
    for (const t of Object.values(a.tasks ?? {})) if (t.verb === 'make' && t.ref !== '*' && t.n < t.qty && itemOf(t.ref)) out.push([t.ref, t.qty - t.n, 'almanac']);
  }
  const b = BARGE.dockedBarge?.(S, t);
  if (b && b.rows) {
    for (const [i, c] of Object.entries(b.crates ?? {})) if (!c.by && Number(i) < b.rows * 3) out.push([c.item, c.qty, 'barge']);
  }
  const f = S.farm.folk;
  if (f && f.posts) for (const p of Object.values(f.posts)) if (!p.done) for (const [i, q] of Object.entries(p.items)) out.push([i, q, 'folk']);
  const cur = S.farm.town?.cur;
  if (cur && cur.buildAt === undefined) for (const g of cur.goods) if (g.got < g.qty) out.push([g.item, g.qty - g.got, 'town']);
  // the next land's Planks and Crates, kept back from the Ledger once the land is the goal (the tracker's land card)
  const nx = EXP.nextExpansion(S);
  if (nx && levelFromXp(S.farm.xp) >= nx.unlock) {
    if (nx.planks > 0) out.push(['planks', nx.planks, 'land']);
    if (nx.crates > 0) out.push(['wooden_crate', nx.crates, 'land']);
  }
  const p = REST.openProject(S);
  if (p) {
    for (const bundle of p.bundles) {
      if (REST.bundleDone(S, p.id, bundle.id)) continue;
      const slots = bundle.slots.map((slot, i) => ({ i, n: REST.slotNeed(p, slot), have: REST.slotHave(S, p.id, bundle.id, i) }));
      const full = slots.filter((x) => x.have >= x.n.need).length;
      const open = slots.filter((x) => x.have < x.n.need && x.n.kind === 'item')
        .map((x) => ({ ...x, cost: (x.n.need - x.have) * (itemOf(x.n.item)?.sell ?? 1) }))
        .sort((a2, b2) => a2.cost - b2.cost);
      for (const x of open.slice(0, Math.max(0, bundle.need - full))) out.push([x.n.item, x.n.need - x.have, 'restore']);
    }
  }
  return out;
}
globalThis.__HH_EXTRA_NEEDS = (S, v, need, t) => { for (const [i, q, why] of goalNeeds(S, t)) need(i, q, why); };
globalThis.__HH_EXTRA_KEEP = (S, keepFor, t) => { for (const [i, q] of goalNeeds(S, t)) keepFor.set(i, (keepFor.get(i) ?? 0) + q); };

// ---- the M1b layer: one player's minute of weekly / long-term systems (attention: up to 3 ops) ------------------
const lastFair = {};
function m1bTurn(pid, budget = 3) {
  let left = budget;
  const done = [];
  const act = (type, a, why) => {
    if (left <= 0) return false;
    if (check(pid, type, a) !== null) return false;
    const p = players.find((x) => x.pid === pid);
    const r = engine.act({ pid, cid: `${pid}cid00` }, { seq: p.nextSeq(), type, args: a });
    const ok = !(r && r.t === 'rej');
    if (ok) { left--; done.push(`${type}(${why})`); }
    return ok;
  };
  const t = now();
  // Fair: enter the best eligible good at most every 5 minutes per player, never what a goal needs
  if (FAIR.fairUnlocked(state) && (lastFair[pid] ?? -1e15) + 5 * MIN <= t) {
    const keep = new Map();
    for (const [i, q] of goalNeeds(state, t)) keep.set(i, (keep.get(i) ?? 0) + q);
    for (const o of Object.values(state.farm.orders.slots)) if (o.order) for (const [i, q] of Object.entries(o.order.items)) keep.set(i, (keep.get(i) ?? 0) + q);
    const list = FAIR.enterable(state, t).filter((x) => avail(x.item) - (keep.get(x.item) ?? 0) > 0);
    if (list.length) {
      const x = list[pid === 'p1' ? 0 : Math.min(1, list.length - 1)];
      const qty = Math.max(1, Math.min(3, x.left, avail(x.item) - (keep.get(x.item) ?? 0)));
      if (act('fairEnter', { item: x.item, qty }, `fair ${qty} ${x.item}`)) lastFair[pid] = t;
    }
  }
  // the weekly goods a couple sets out to make from the panels ("9 Omelettes: 2 in the Barn"): queue one craft a minute
  // for an open barge crate, a townsfolk request or a Town Project good when its building has a free slot and the
  // inputs are in the Barn (the panels' need hints; qa-bot alone keeps its workshops on the best-paying recipe)
  {
    const queued = (item) => Object.values(state.farm.objects).reduce((n, o) => n + (o.queue ?? [])
      .filter((q) => q.r === item).length, 0);
    for (const [item, qty] of goalNeeds(state, t).filter(([, , why]) => ['barge', 'folk', 'town'].includes(why))) {
      const r = CONTENT.recipes.get(item);
      if (!r || !C.isLive(r) || (r.unlock ?? 1) > L() || r.duet) continue;
      if (avail(item) + queued(item) * (r.out ?? 1) >= qty) continue;
      if (!Object.entries(r.inputs ?? {}).every(([i, q]) => avail(i) >= q)) continue;
      const bld = Object.entries(state.farm.objects).find(([, o]) => o.def === r.building && (o.queue ?? []).length < o.slots);
      if (bld && act('craft', { id: bld[0], recipe: item }, `weekly ${item}`)) break;
    }
  }
  // Barge
  const b = BARGE.dockedBarge(state, t);
  if (b && b.rows) {
    for (const [i, c] of Object.entries(b.crates ?? {})) {
      if (c.by || Number(i) >= b.rows * 3 || avail(c.item) < c.qty) continue;
      act('bargeLoad', { i: Number(i) }, `barge ${c.qty} ${c.item}`);
    }
  }
  // Restoration (one donation per minute per player; coin slots when the treasury holds 3x the slot)
  const p = REST.openProject(state);
  if (p) {
    let gave = false;
    for (const bundle of p.bundles) {
      if (gave || REST.bundleDone(state, p.id, bundle.id)) continue;
      for (const [i, slot] of bundle.slots.entries()) {
        const n = REST.slotNeed(p, slot);
        const want = n.need - REST.slotHave(state, p.id, bundle.id, i);
        if (want <= 0) continue;
        let qty = 0;
        if (n.kind === 'item') qty = Math.min(want, avail(n.item));
        else if (n.kind === 'coins') qty = state.farm.wallet.coins >= want * 3 ? want : 0;
        if (qty > 0 && act('donate', { project: p.id, bundle: bundle.id, slot: i, qty, confirm: ['BIG_SPEND'] }, `restore ${p.id}/${bundle.id}`)) { gave = true; break; }
      }
    }
  }
  // a fruit the open Ledger bundle needs from a tree the farm does not own: buy two of that tree (when affordable)
  if (p && !args.noTreeBuy) {
    for (const bundle of p.bundles) {
      if (REST.bundleDone(state, p.id, bundle.id)) continue;
      for (const slot of bundle.slots) {
        const it = slot.item && itemOf(slot.item);
        if (!it || it.kind !== 'fruit') continue;
        const tree = CONTENT.trees.get(it.source);
        if (!tree || !C.isLive(tree) || (tree.unlock ?? 1) > L()) continue;
        const have = Object.values(state.farm.objects).filter((o) => o.def === tree.id).length;
        if (have >= 2) continue;
        const price = DEC.buyPrice(state, tree.id);
        if (price.code || state.farm.wallet.coins < price.coins * 3) continue;
        const spot = BOT.findSpot(state, tree.id, 14, 30);
        if (spot) act('place', { def: tree.id, ...spot, confirm: ['BIG_SPEND'] }, `tree ${tree.id} for the Ledger`);
      }
    }
  }
  // Town Project goods (coins are funded after the evening, see wrapUp)
  const cur = state.farm.town?.cur;
  if (cur && cur.buildAt === undefined) {
    for (const g of cur.goods) {
      const q = Math.min(avail(g.item), g.qty - g.got);
      if (q > 0) act('townGive', { item: g.item, qty: q }, `town ${q} ${g.item}`);
    }
  }
  // townsfolk requests
  const f = state.farm.folk;
  if (f && f.posts) {
    for (const [i, post] of Object.entries(f.posts)) if (!post.done) act('folkFill', { i: Number(i), n: post.n }, `folk ${post.npc}`);
  }
  // album trades
  if (ALBUM.albumUnlocked(state)) {
    for (const set of ALBUM.liveSets()) {
      if (ALBUM.dupesOf(state, set) < (C.COLLECTION_RULES?.tradeIn ?? 3)) continue;
      const want = ALBUM.missingOf(state, set)[0];
      if (want) act('albumTrade', { set: set.id, want }, `album ${want}`);
    }
  }
  return { used: budget - left, done };
}

// ---- duets (both online, both press Cook within 3 s): what an order or a card asks for -----------------------------
function duetTurn() {
  if (args.noDuet) return 0;
  const want = new Set();
  for (const o of Object.values(state.farm.orders.slots)) if (o.order) for (const i of Object.keys(o.order.items)) if (CONTENT.recipes.get(i)?.duet) want.add(i);
  for (const [i] of goalNeeds(state, now())) if (CONTENT.recipes.get(i)?.duet) want.add(i);
  let n = 0;
  for (const rid of want) {
    const r = CONTENT.recipes.get(rid);
    if (!C.isLive(r) || (r.unlock ?? 1) > L()) continue;
    const queued = Object.values(state.farm.objects).some((o) => o.def === r.building && (o.queue ?? []).some((q) => q.r === rid));
    if (queued || avail(rid) > 0) continue;
    if (!Object.entries(r.inputs ?? {}).every(([i, q]) => avail(i) >= q)) continue;
    const b = Object.entries(state.farm.objects).find(([, o]) => o.def === r.building && (o.queue ?? []).length < o.slots);
    if (!b) continue;
    for (const p of players) {
      const res = engine.act({ pid: p.pid, cid: `${p.pid}cid00` }, { seq: p.nextSeq(), type: 'duet', args: { id: b[0], recipe: rid } });
      if (!(res && res.t === 'rej')) n++;
    }
  }
  return n;
}

// ---- after the evening: taste spending (real model), Town Project funding ------------------------------------------
const spendLog = [];
function wrapUp() {
  const t = now();
  const pid = 'p1';
  const coins0 = state.farm.wallet.coins;
  // Town Project coins: a couple saving for the village puts in what the till holds above an evening's reserve
  const cur = state.farm.town?.cur;
  const E = levelRow(L()).E;
  if (cur && cur.buildAt === undefined && cur.paid < cur.coins) {
    const reserve = Math.floor(E * 0.5);
    const give = Math.min(cur.coins - cur.paid, state.farm.wallet.coins - reserve);
    if (give > 0) {
      const r = engine.act({ pid, cid: 'p1cid00' }, { seq: players[0].nextSeq(), type: 'townFund', args: { coins: give, confirm: ['BIG_SPEND'] } });
      if (!(r && r.t === 'rej')) spendLog.push({ evening, what: 'townFund', coins: give });
    }
  }
  if (FAIR.fairUnlocked(state) && !args.noFairWrap) {
    const keep = new Map();
    for (const [i, q] of goalNeeds(state, t)) keep.set(i, (keep.get(i) ?? 0) + q);
    for (const o of Object.values(state.farm.orders.slots)) if (o.order) for (const [i, q] of Object.entries(o.order.items)) keep.set(i, (keep.get(i) ?? 0) + q);
    for (const x of FAIR.enterable(state, t)) {
      const qty = Math.min(x.left, avail(x.item) - (keep.get(x.item) ?? 0));
      if (qty <= 0) continue;
      const r = engine.act({ pid, cid: 'p1cid00' }, { seq: players[0].nextSeq(), type: 'fairEnter', args: { item: x.item, qty } });
      if (!(r && r.t === 'rej')) spendLog.push({ evening, what: `fair:${x.item}`, coins: 0, qty });
    }
  }
  if (DECOR_BP <= 0) return;
  let budget = Math.floor((coins0 * DECOR_BP) / 10_000);
  const a0 = { x: 20, z: 20 };
  for (let k = 0; k < 6 && budget > 0; k++) {
    const g = goals(state, pid, t)?.now;
    if (!g || g.kind !== 'decor') break;
    const cost = defOf(g.id)?.cost ?? 0;
    if (cost > budget) break;
    const spot = BOT.findSpot(state, g.id, a0.x - 4, a0.z - 4);
    if (!spot) break;
    const r = engine.act({ pid, cid: 'p1cid00' }, { seq: players[0].nextSeq(), type: 'place', args: { def: g.id, ...spot, confirm: ['BIG_SPEND'] } });
    if (r && r.t === 'rej') break;
    budget -= cost;
    spendLog.push({ evening, what: `decor:${g.id}`, coins: cost });
  }
  if (BEAUTY.masterworkPrice && L() >= 18) {
    for (const [id, o] of Object.entries(state.farm.objects)) {
      const pr = BEAUTY.masterworkPrice(state, o);
      if (pr.code || pr.coins > budget) continue;
      const r = engine.act({ pid, cid: 'p1cid00' }, { seq: players[0].nextSeq(), type: 'masterwork', args: { id, confirm: ['BIG_SPEND'] } });
      if (r && r.t === 'rej') continue;
      budget -= pr.coins;
      spendLog.push({ evening, what: `masterwork:${o.def}`, coins: pr.coins });
    }
  }
}

// ---- the ledger tap ----------------------------------------------------------------------------------------------
const flows = {};                                      // level -> { in: {reason: n}, out: {reason: n} }
let ledgerN = state.farm.ledger.n;
const kindOf = (reason) => {
  const [head, id] = String(reason).split(':');
  if (head === 'buy') {
    if (CONTENT.animals.has(id)) return 'buy:animal';
    const d = defOf(id);
    if (id === 'plot') return 'buy:plot';
    return `buy:${d?.kind ?? 'other'}`;
  }
  if (head === 'sell') return 'sell';
  return head;
};
function tapLedger() {
  const led = state.farm.ledger;
  if (led.n - ledgerN > 500) console.error(`ledger overrun: ${led.n - ledgerN} rows`);
  const lv = L();
  const row = (flows[lv] ??= { in: {}, out: {} });
  for (let n = Math.max(ledgerN, led.n - 500); n < led.n; n++) {
    const r = led.rows[String(n % 500)];
    if (!r || String(r.reason).startsWith('wish')) continue;
    const k = kindOf(r.reason);
    if (r.n >= 0) row.in[k] = (row.in[k] ?? 0) + r.n; else row.out[k] = (row.out[k] ?? 0) - r.n;
  }
  ledgerN = led.n;
}

// ---- play ----------------------------------------------------------------------------------------------------------
const perEvening = [];
const levelAt = { 1: { evening: 1, minute: 0, play: 0 } };
const treasury = {};                                   // level -> { n, sum, max, minutes }
let playMin = 0;
let over15 = 0;                                         // play minutes with more than 15 E-h in the till
let lastL = 1;
for (evening = 0; evening < EVENINGS; evening++) {
  const e0 = { level: L(), coins: state.farm.wallet.coins };
  const bg0 = BARGE.dockedBarge(state, now());
  e0.barge = bg0 ? `${bg0.rows} rows: ` + Object.entries(bg0.crates ?? {}).filter(([i]) => Number(i) < bg0.rows * 3).map(([, c]) => `${c.by ? '*' : ''}${c.qty} ${c.item}`).join(', ') : '';
  e0.folk = Object.values(state.farm.folk?.posts ?? {}).map((p) => `${p.done ? '*' : ''}${Object.entries(p.items).map(([i, q]) => `${q} ${i}`).join('+')}`).join(' | ');
  const xpAt = [];
  const ec0 = { ...evCount };
  const board0 = Object.values(state.farm.orders.slots).filter((x) => x.order).map((x) => `${x.order.simple ? 's:' : ''}${Object.entries(x.order.items).map(([i, q]) => `${q} ${i}`).join('+')}`).join(' | ');
  let idle = 0; let dead = 0; let streak = 0; let worstStreak = 0; let m1bOps = 0;
  const idleMinutes = [];
  for (minute = 0; minute < MINUTES; minute++) {
    let bothIdle = true; let bothDead = true;
    for (const p of players) {
      const saw = new Set();
      const r = await BOT.turn(p, { minsLeft: MINUTES - minute, wrap: MINUTES - minute <= 5, dom: dom[p.pid],
        waited: (k) => seenBefore[p.pid].has(k), sawKeys: saw, style: 'patient' });
      seenBefore[p.pid] = saw;
      const m = m1bTurn(p.pid);
      m1bOps += m.used;
      const spent = 12 - r.left + m.used;
      bothIdle = bothIdle && spent <= 2;
      bothDead = bothDead && spent === 0;
      if (args.verbose) console.log(`e${evening + 1} m${String(minute).padStart(2)} L${L()} ${p.pid} ${r.ops.map((o) => `${o.ok ? '' : `!${o.code} `}${o.type}`).join(' ')} ${m.done.join(' ')}${spent <= 2 ? ' [IDLE]' : ''}`);
    }
    const duets = duetTurn();
    if (duets) { bothIdle = false; bothDead = false; m1bOps += duets; }
    if (bothIdle) { idle++; streak++; worstStreak = Math.max(worstStreak, streak); idleMinutes.push(minute); } else streak = 0;
    if (bothDead) dead++;
    if (minute % 5 === 0) xpAt.push(state.farm.xp);
    tapLedger();
    const lv = L();
    const tr = (treasury[lv] ??= { n: 0, sum: 0, max: 0 });
    tr.n++; tr.sum += state.farm.wallet.coins; tr.max = Math.max(tr.max, state.farm.wallet.coins);
    if (state.farm.wallet.coins > 15 * levelRow(lv).E) over15++;
    if (lv > lastL) { for (let k = lastL + 1; k <= lv; k++) levelAt[k] = { evening: evening + 1, minute, play: playMin }; lastL = lv; }
    clock.advance(MIN);
    engine.runDue();
    playMin++;
  }
  minute = 60;
  wrapUp();
  tapLedger();
  const mine = rewards.filter((x) => x.evening === evening && x.minute >= 0 && x.minute < MINUTES);
  const gap = (rows) => {
    const at = [0, ...rows.map((x) => x.minute), MINUTES].sort((a, b) => a - b);
    let worst = 0; let from = 0;
    for (let i = 1; i < at.length; i++) if (at[i] - at[i - 1] > worst) { worst = at[i] - at[i - 1]; from = at[i - 1]; }
    return { worst, from };
  };
  const s = gap(mine.filter((x) => x.strict));
  const lq = gap(mine.filter((x) => x.e === 'levelUp' || x.e === 'questDone'));
  const lqa = gap(mine.filter((x) => ['levelUp', 'questDone', 'almanacDone', 'almanacChest'].includes(x.e)));
  const almanacAt = mine.filter((x) => x.e === 'almanacDone').map((x) => x.minute).join(',');
  const bg = gap(mine);
  const ev = { evening: evening + 1, day: ['Mon', 'Wed', 'Sat'][evening % 3], levelStart: e0.level, level: L(),
    coinsStart: e0.coins, coins: state.farm.wallet.coins, E: levelRow(L()).E, idle, dead, worstStreak,
    strictGap: s, broadGap: bg, lqGap: lq, lqaGap: lqa, almanacAt, strictN: mine.filter((x) => x.strict).length, broadN: mine.length, m1bOps,
    idleMinutes: idleMinutes.join(','), xpAt,
    evDelta: Object.fromEntries(['bargeRow', 'bargeLoaded', 'townGiven', 'townFunded', 'folkFilled', 'bundleDone', 'fairEntered', 'donated', 'questDone', 'achievement', 'mastery', 'orderFilled', 'duet', 'albumFind', 'beautyStar'].map((k) => [k, (evCount[k] ?? 0) - (ec0[k] ?? 0)])), board0, ordersFilled: ordersFilled.filter((o) => o.evening === evening).length, bargeAtStart: e0.barge, folkAtStart: e0.folk,
    bargeAtEnd: (() => { const b = state.farm.barge; return b && b.docked ? Object.entries(b.crates ?? {}).filter(([i]) => Number(i) < b.rows * 3).map(([, c]) => `${c.by ? '*' : ''}${c.qty} ${c.item}`).join(', ') : ''; })(),
    strict: mine.filter((x) => x.strict).map((x) => `${x.minute}:${x.e}${x.id === '' ? '' : `(${x.id})`}`).join(' ') };
  perEvening.push(ev);
  if (!args.quiet) {
    console.log(`E${String(ev.evening).padStart(2)} ${ev.day} L${ev.levelStart}->${ev.level} idle ${String(idle).padStart(2)} dead ${String(dead).padStart(2)} streak ${String(worstStreak).padStart(2)} | gap lvl/quest ${String(lq.worst).padStart(2)} (m${lq.from}) strict ${String(s.worst).padStart(2)} (m${s.from}) broad ${String(bg.worst).padStart(2)} | coins ${ev.coins.toLocaleString('en-US')} (${(ev.coins / ev.E).toFixed(2)} E-h) m1b ${m1bOps}`);
  }
  minute = -1;
  clock.advance((GAPS_H[evening % 3] * 60 - MINUTES) * MIN);
  engine.runDue();
  tapLedger();
  if (L() >= STOP_AT) { evening++; break; }
}

// ---- summary -------------------------------------------------------------------------------------------------------
const bands = [[1, 4], [5, 9], [10, 14], [15, 19], [20, 25]];
const bandOf = (lv) => bands.find(([a, b]) => lv >= a && lv <= b) ?? [26, 99];
const sumFlows = {};
for (const [lv, f] of Object.entries(flows)) {
  const [a, b] = bandOf(Number(lv));
  const k = `L${a}-${b}`;
  const t = (sumFlows[k] ??= { in: {}, out: {} });
  for (const [r, n] of Object.entries(f.in)) t.in[r] = (t.in[r] ?? 0) + n;
  for (const [r, n] of Object.entries(f.out)) t.out[r] = (t.out[r] ?? 0) + n;
}
const crafted = Object.fromEntries(Object.entries(state.farm.stats).filter(([k]) => k.startsWith('craft.')).map(([k, v]) => [k.slice(6), v]));
const owned = {};
for (const o of Object.values(state.farm.objects)) owned[o.def] = (owned[o.def] ?? 0) + 1;
const summary = {
  root: ROOT, model: MODEL, seed: SEED, evenings: evening, level: L(), coins: state.farm.wallet.coins,
  over15, playMinutes: playMin, xpBy,
  acorns: state.farm.wallet.acorns, levelAt, perEvening,
  treasury: Object.fromEntries(Object.entries(treasury).map(([lv, t]) => [lv, { minutes: t.n, mean: Math.round(t.sum / t.n), max: t.max, maxEh: +(t.max / levelRow(Number(lv)).E).toFixed(2), meanEh: +(t.sum / t.n / levelRow(Number(lv)).E).toFixed(2) }])),
  flows: sumFlows, flowsByLevel: flows, fair: fairLog, barge: bargeLog, town: townLog, restore: restLog, folk,
  spendLog, crafted, owned, ordersFilled, evCount, quests: Object.keys(state.farm.quests.done),
  restoreDone: Object.keys(state.farm.restore ?? {}).filter((k) => state.farm.restore[k]?.done !== undefined || ECO.projectDone?.(state, k)),
  townBuilt: state.farm.town?.n ?? 0, expansions: state.farm.expansions, barn: state.farm.barn,
};
{
  const QU = await imp('shared/rules/actions/quests.js');
  const t = now();
  const nx = EXP.nextExpansion(state);
  const d = {};
  d.nextExpansion = nx ? { id: nx.id, unlock: nx.unlock, cost: nx.cost, code: EXP.expandCode(state, nx.id, t),
    proof: nx.proof.map((x, i) => ({ ...x, ...EXP.proofProgress(state, nx.id, i, t) })) } : null;
  d.town = state.farm.town?.cur ? { id: state.farm.town.cur.id, coins: state.farm.town.cur.coins, paid: state.farm.town.cur.paid,
    goods: state.farm.town.cur.goods.map((g) => `${g.got}/${g.qty} ${g.item}`) } : null;
  d.folk = Object.values(state.farm.folk?.posts ?? {}).map((p) => `${p.done ? 'DONE ' : ''}${p.npc}: ${Object.entries(p.items).map(([i, q]) => `${q} ${i} (have ${avail(i)})`).join(', ')}`);
  const bg = state.farm.barge;
  d.barge = bg ? { rows: bg.rows, docked: bg.docked, t: bg.t, crates: Object.entries(bg.crates ?? {}).map(([i, c]) => `${i}:${c.by ? 'LOADED ' : ''}${c.qty} ${c.item}`) } : null;
  d.quests = Object.keys(state.farm.quests.active).map((q) => `${q}: ${CONTENT.quests.get(q).tasks.map((tk, i) => { const pr = QU.taskProgress(state, q, i, t); return `${tk.verb} ${tk.qty} ${tk.ref} (${pr.have})`; }).join('; ')}`);
  const rp = REST.openProject(state);
  d.restore = rp ? { id: rp.id, bundles: rp.bundles.map((b) => `${b.id}${REST.bundleDone(state, rp.id, b.id) ? ' DONE' : ` need ${b.need}: ` + b.slots.map((sl, i) => { const n = REST.slotNeed(rp, sl); return `${REST.slotHave(state, rp.id, b.id, i)}/${n.need} ${n.item ?? n.special ?? 'coins'}`; }).join(', ')}`) } : null;
  d.trees = Object.fromEntries(Object.entries(owned).filter(([k]) => CONTENT.trees.has(k)));
  d.animals = Object.fromEntries(Object.entries(owned).filter(([k]) => CONTENT.animals.has(k)));
  d.buildings = Object.fromEntries(Object.entries(owned).filter(([k]) => CONTENT.buildings.has(k)));
  d.homes = Object.fromEntries(Object.entries(owned).filter(([k]) => CONTENT.homes.has(k)));
  d.plots = owned.plot ?? 0;
  summary.diag = d;
  if (!args.quiet) console.log('diag', JSON.stringify(d, null, 1));
}
if (args.json) fs.writeFileSync(args.json, JSON.stringify(summary, null, 1));
if (!args.quiet || args.summary) {
  console.log('levels at play-minute', Object.entries(levelAt).map(([k, v]) => `L${k}@E${v.evening}m${v.minute}`).join(' '));
  for (const [k, f] of Object.entries(sumFlows)) {
    const tin = Object.values(f.in).reduce((a, b) => a + b, 0);
    const tout = Object.values(f.out).reduce((a, b) => a + b, 0);
    const top = (o, tot) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${Math.round((100 * n) / tot)}%`).join(', ');
    console.log(`${k}: in ${tin.toLocaleString('en-US')} [${top(f.in, tin)}]`);
    console.log(`${' '.repeat(k.length)}  out ${tout.toLocaleString('en-US')} [${top(f.out, tout)}]`);
  }
  console.log('final', { level: L(), coins: state.farm.wallet.coins, town: state.farm.town?.n, folk, fairWeeks: fairLog.length, medals: fairLog.map((x) => x.medal).join(' ') });
}
