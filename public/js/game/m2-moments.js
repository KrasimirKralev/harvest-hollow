// The M2 moments the client surfaces between the panels (wave 3): the things that happen to a farmer rather than
// things they click, said once, at the right time, with a one-click way to answer (ui.notice with an action):
//   - Friendly Duel: the partner's invitation ("Mia challenges you to a Pumpkin Patch Duel!") with "Let's duel" (or
//     "See the duel" when ui-league's duel panel is there); "Game on!" when my invitation is accepted; a kind word when
//     it is declined or lapses; the result (the crown) at the week's close. Shown again after a reconnect or a reload
//     while it still waits (duelOf phase 'invited'), never twice for one invitation in one tab.
//   - Breeding Barn: "Daisy and Clover's baby is ready!" -> "Bring it home" (the breeding panel names it; else the
//     baby comes home unnamed), once per breeding; a newborn with a golden coat gets its own line.
//   - Nursery: a full care card -> "Pick a personality" (the nursery panel), once per baby, for whoever gave the step.
//   - Perks: a personal level-up that leaves a point to spend -> "Choose a perk" (the perks panel).
//   - Fishing together: "Two lines in the water…" once a day; the partner's record catch.
//   - Rested XP: "Welcome back! You are rested" when the returning farmer's pool fills (once a day).
// Everything reads the rules' own pure helpers over the predicted state; nothing here changes state except through
// the controller (the same predicted path as a click). Owned by the client lane.
//
//   createM2Moments({ store, ui, controller, audio?, now? }) -> { check(), dispose() }
//   inviteLine(state, cur, me) -> string     the invitation in words (content DUEL.lines.invite); pure, tested
import { DUEL, FISHING, animalOf } from '../../../shared/content/index.js';
import { duelOf } from '../../../shared/rules/actions/duel.js';
import { breedingOf } from '../../../shared/rules/actions/breeding.js';
import { perkPoints, perkSpent, perksLive } from '../../../shared/rules/actions/perks.js';
import { animalName, pairWords } from './pairing.js';

const nameOf = (state, pid) => (state && Object.hasOwn(state.players, pid) ? state.players[pid].name : 'Your partner');
const kindName = (kind) => DUEL?.kinds?.find((k) => k.id === kind)?.name ?? 'Friendly Duel';
const fill = (t, o) => t.replace(/\{(\w+)\}/g, (_, k) => (o[k] ?? ''));

/** The partner's invitation in words (DUEL.lines.invite: "{name} challenges you to a {duel}! ..."). */
export function inviteLine(state, cur) {
  const duel = kindName(cur.kind);
  // "a Order Rush" -> "an Order Rush": the article goes with the duel's own name
  const t = (DUEL?.lines?.invite ?? '{name} challenges you to a {duel}! Until Sunday evening. Just for fun.')
    .replace(/\b([Aa]) \{duel\}/, (m, a) => `${/^[aeiou]/i.test(duel) ? `${a}n` : a} {duel}`);
  return fill(t, { name: nameOf(state, cur.by), duel });
}

export function createM2Moments({ store, ui, controller, audio = null }) {
  const shown = new Set();              // keys of moments already said in this tab
  const offs = [];
  const me = () => store.pid;
  const has = (name) => Boolean(ui?.panels?.has?.(name));
  const open = (names, args) => {
    const n = names.find(has);
    if (n) ui.panels.open(n, args);
    return Boolean(n);
  };
  const notice = (text, action, ms = 20_000) => (typeof ui?.notice === 'function' ? ui.notice(text, action ? { action, ms } : { ms }) : null);
  const once = (key) => { if (shown.has(key)) return false; shown.add(key); return true; };

  /** The duel invitation addressed to me, if it still waits. */
  function duelInvite() {
    const s = store.state;
    if (!s || !s.farm.duel) return;
    let d;
    try { d = duelOf(s, me(), store.now()); } catch { return; }
    if (!d || d.phase !== 'invited' || !d.cur) return;
    if (!once(`duel:${d.cur.by}:${d.cur.at}`)) return;
    const line = inviteLine(s, d.cur);
    audio?.play('duel_start', { gain: 0.5 });
    if (has('duel')) notice(line, { label: 'See the duel', fn: () => open(['duel'], {}) });
    else notice(line, { label: "Let's duel!", fn: () => controller.do('duelAccept', {}) });
  }

  /** The bred baby is ready to come home. */
  function breedReady() {
    const s = store.state;
    const cur = s ? breedingOf(s) : null;
    if (!cur || !(cur.readyAt <= store.now())) return;
    if (!once(`breed:${cur.at}`)) return;
    const pair = pairWords(s, cur.a, cur.b);
    const sp = (animalOf(cur.sp)?.name ?? 'animal').toLowerCase();
    const who = pair.startsWith('Two ') ? `A baby ${sp}` : `${pair}'s baby ${sp}`;
    notice(`${who} is ready in the Breeding Barn!`, {
      label: 'Bring it home',
      fn: () => { if (!open(['breeding'], { collect: true })) controller.do('breedCollect', {}); },
    });
  }

  /** A personal level-up left a perk point to spend. */
  function perkPoint() {
    const s = store.state;
    if (!s || !perksLive(s)) return;
    const free = perkPoints(s, me()) - perkSpent(s, me());
    if (free <= 0) return;
    if (!once(`perk:${perkPoints(s, me())}`)) return;
    notice(free === 1 ? 'You have a perk point to spend.' : `You have ${free} perk points to spend.`,
      has('perks') ? { label: 'Choose a perk', fn: () => open(['perks'], {}) } : null, 15_000);
  }

  /** Called on state changes and every few seconds (readiness is a matter of time). */
  function check() {
    if (!store.ready) return;
    try {
      duelInvite();
      breedReady();
    } catch (err) {
      console.warn('m2 moments check failed', err);
    }
  }

  offs.push(store.on('change', () => check()));
  offs.push(store.on('welcome', () => check()));
  const timer = setInterval(check, 4000);
  timer?.unref?.();

  // events: my own predicted ones for the moments that follow my click; the partner's confirmed ones
  offs.push(store.on('fx', ({ ev, by, local }) => {
    if (!ev || !store.state) return;
    const s = store.state;
    const mine = by === me();
    switch (ev.e) {
      case 'duelAccepted':
        // the inviter hears it from the partner's confirmed acceptance; the one who accepted from their own click
        if (local || !mine) {
          const t = DUEL?.lines?.accept ?? 'Game on!';
          ui?.toast?.(mine ? t : `${nameOf(s, by)} accepted! ${t}`, { kind: 'ok', ms: 5000 });
        }
        break;
      case 'duelDeclined':
        if (!local && !mine) ui?.toast?.(`${nameOf(s, by)} would rather not duel this week. Maybe another time!`, { kind: 'info', ms: 5000 });
        break;
      case 'duelLapsed':
        if (!local && ev.to === me()) ui?.toast?.('Your duel invitation lapsed. Ask again any day before Sunday evening.', { kind: 'info', ms: 5000 });
        break;
      case 'nursed':
        if (local && mine && Number.isSafeInteger(ev.n) && ev.n >= (ev.of ?? 3) && once(`nurse:${ev.id}`)) {
          const named = typeof s.farm.names?.[ev.id]?.name === 'string';
          const n = named ? animalName(s, ev.id) : `The young ${(animalOf(ev.animal)?.name ?? 'animal').toLowerCase()}`;
          notice(`${n}'s care card is full! Pick a personality and a specialty.`,
            { label: 'Choose', fn: () => open(['nursery', 'animals'], { id: ev.id, pick: true }) }, 15_000);
        }
        break;
      case 'bred':
        if (!local && ev.golden) ui?.toast?.(`A golden ${animalOf(ev.species)?.name?.toLowerCase() ?? 'baby'}! The rarest coat of all.`, { kind: 'ok', ms: 6000 });
        break;
      case 'fishTogether':
        if (!local && once(`fishTogether:${Math.floor(store.now() / 86_400_000)}`)) {
          ui?.toast?.(FISHING?.lines?.together ?? 'Two lines in the water. Nobody is in a hurry.', { kind: 'love', ms: 5000 });
        }
        break;
      case 'rested':
        // rested XP (GDD §4.7, M2): the returning farmer's own pool; said once a day, on the server's word
        if (!local && ev.pid === me() && once(`rested:${Math.floor(store.now() / 86_400_000)}`)) {
          ui?.toast?.('Welcome back! You are rested: your own XP counts double for a while.', { kind: 'ok', ms: 6000 });
        }
        break;
      case 'fishCaught':
        if (!local && !mine && ev.record) {
          const f = FISHING?.fish?.find((x) => x.id === ev.fish);
          ui?.toast?.(`${nameOf(s, by)} landed a ${ev.cm} cm ${f ? f.name : 'fish'}: a new record for the dock!`, { kind: 'ok', ms: 6000 });
        }
        break;
      default:
    }
  }));
  offs.push(store.on('celebrate', ({ ev }) => {
    if (!ev || !store.state) return;
    if (ev.e === 'levelUp' && ev.scope === 'player' && ev.pid === me()) perkPoint();
    if (ev.e === 'duelEnded' && ev.scored) {
      const s = store.state;
      const lines = DUEL?.lines ?? {};
      const text = ev.tie ? (lines.tie ?? 'A dead heat! Two crowns this week.')
        : fill(lines.win ?? '{name} wins the {duel}!', { name: nameOf(s, ev.win), duel: kindName(ev.kind) });
      ui?.toast?.(text, { kind: 'ok', ms: 7000 });
    }
  }));

  check();
  return {
    check,
    dispose() { clearInterval(timer); for (const off of offs) off?.(); },
  };
}
