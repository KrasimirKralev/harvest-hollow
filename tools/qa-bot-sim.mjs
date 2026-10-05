// Dev tool: runs the QA player (tools/qa-bot.mjs) against an in-process Engine with a fake clock, no browser, to
// tune and check its policy fast. The real playtest is tools/qa-playtest.mjs.
//   node tools/qa-bot-sim.mjs [--minutes 180] [--seed 7] [--verbose] [--solo]
import { createFarm } from '../shared/rules/state.js';
import { Engine } from '../server/engine.js';
import { Together } from '../server/together.js';
import { levelFromXp } from '../shared/content/index.js';
import { turn, trackerProblems, trackerOf } from './qa-bot.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const EVENINGS = Number(args.evenings || 0);
const MINUTES = EVENINGS ? 60 : Number(args.minutes || 180);
const GAPS_H = [46, 46, 70, 72, 46];
const T0 = Date.UTC(2026, 9, 5, 16, 0, 0);            // Monday 19:00 in Sofia
const clock = { t: T0, now() { return this.t; }, advance(ms) { this.t += ms; }, observe() {} };
const state = createFarm(Number(args.seed || 7), T0, 'Europe/Sofia');
const engine = new Engine({ state, server: { clock: { lastNow: 0 }, clients: {}, auth: {} }, clock,
  log: { error: (...a) => console.error('ENGINE', ...a), warn() {}, info() {}, log() {} } });
for (const [pid, name] of [['p1', 'Rowan'], ['p2', 'Mia']]) engine.system('_join', { pid, name });
// what the live server tells the rules: who is online (GDD §5.8 C3: while both are online an Almanac action by either
// counts for both; Together minutes). No avatar poses, so no Together Combo XP is assumed. --solo: only Rowan.
engine.facts = new Together({ online: () => (args.solo ? ['p1'] : ['p1', 'p2']) });

const mk = (pid) => {
  const cid = `${pid}cid00`;
  engine.client(cid, pid, clock.now());
  let seq = 0;
  return {
    pid,
    async snap() { return { s: engine.state, now: clock.now() }; },
    async act(type, a) {
      const r = engine.act({ pid, cid }, { seq: ++seq, type, args: a });
      return r && r.t === 'rej' ? { ok: false, code: r.code } : { ok: true };
    },
  };
};
const players = [mk('p1'), mk('p2')];
if (args.solo) players.pop();
const dom = { p1: { fields: 1, market: 1 }, p2: { barnyard: 1, workshop: 1, orchard: 1, farm: 1 } };
const seenBefore = { p1: new Set(), p2: new Set() };
const marks = {};
let lastLevel = 1;
let clockMin = 0;
const idleNow = {};
const lastNotes = {};
for (let ev = 0; ev < Math.max(1, EVENINGS); ev++) {
for (let m = 0; m < MINUTES; m++) {
  for (const p of players) {
    const saw = new Set();
    const r = await turn(p, { minsLeft: MINUTES - m, wrap: MINUTES - m <= 5, dom: dom[p.pid], solo: Boolean(args.solo),
      waited: (k) => seenBefore[p.pid].has(k), sawKeys: saw, style: args.grind ? 'grind' : 'patient' });
    seenBefore[p.pid] = saw;
    (idleNow[ev] ??= {})[m] = ((idleNow[ev] ??= {})[m] ?? true) && r.idle && r.left >= 10;
    if (r.notes.length) lastNotes[p.pid] = r.notes;
    if (args.verbose) {
      console.log(`m${String(m).padStart(3)} ${p.pid} ${r.ops.map((o) => `${o.ok ? '' : '!' + o.code + ' '}${o.type}(${o.why})`).join(' | ')}${r.idle ? ` [IDLE left ${r.left}]` : ''}`);
      if (r.idle && r.notes.length) console.log(`       notes: ${r.notes.join('; ')}`);
    }
  }
  const L = levelFromXp(state.farm.xp);
  if (L > lastLevel) { marks[L] = clockMin; lastLevel = L; console.log(`== play-minute ${clockMin} (evening ${ev + 1} m${m}): level ${L}  coins ${state.farm.wallet.coins}  xp ${state.farm.xp}`); }
  if (args.trk && m % 5 === 0) {
    const t = trackerOf(state, 'p1', clock.now());
    console.log(`   m${m} L${L} c${state.farm.wallet.coins} NOW:${t.now.text} | SOON:${t.soon.text} | BIG:${t.big?.text}`);
    for (const pr of trackerProblems(state, 'p1', clock.now())) console.log('   TRACKER PROBLEM', pr);
  }
  clock.advance(60_000);
  engine.runDue();
  clockMin++;
}
if (EVENINGS) {
  console.log(`-- evening ${ev + 1}: ${Object.values(idleNow[ev] ?? {}).filter(Boolean).length} both-idle minutes; notes: ${(lastNotes.p1 ?? []).slice(0, 3).join('; ')}`);
  console.log(`-- end of evening ${ev + 1}: level ${levelFromXp(state.farm.xp)} coins ${state.farm.wallet.coins} xp ${state.farm.xp}`);
  clock.advance((GAPS_H[ev] ?? 46) * 3_600_000);
  engine.runDue();
}
}
console.log('levels at minute', JSON.stringify(marks));
console.log('final', { level: levelFromXp(state.farm.xp), coins: state.farm.wallet.coins, xp: state.farm.xp, quests: Object.keys(state.farm.quests.done) });
if (args.stats) {
  const st = state.farm.stats;
  console.log('stats', JSON.stringify(Object.fromEntries(Object.entries(st).filter(([k]) => /^coins\./.test(k) || /^xp\./.test(k)))));
  const led = state.farm.ledger; const by = {};
  for (let n = Math.max(0, led.n - 500); n < led.n; n++) { const r = led.rows[String(n % 500)]; if (r) by[String(r.reason).split(':')[0]] = (by[String(r.reason).split(':')[0]] ?? 0) + r.n; }
  console.log('ledger (last 500 rows)', JSON.stringify(by));
  console.log('hearts', JSON.stringify(Object.fromEntries(Object.entries(state.players).map(([k, p]) => [k, p.hearts]))), 'acorns', state.farm.wallet.acorns);
}
