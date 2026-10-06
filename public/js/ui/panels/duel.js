// The Friendly Duel (GDD §6.2 "Also", M2, L29), ui-league lane (wave 3).
//
// Opt-in and off by default: one farmer invites, the other accepts, and until the Fair week's close (Sunday 20:00)
// each farmer's own score counts: Pumpkins from the plots you planted, pies from the Pie Oven queues you started, or
// orders you filled. Nothing about the farm changes: every Pumpkin still goes to the shared barn, every order still pays
// the farm, and helping still helps (harvesting your partner's pumpkins scores for them). The winner wears a crown on
// the name card for a week (a tie crowns both); both get Hearts, and the farm's first duel a pennant decor.
// Panels: 'duel' (invite / answer / the live score / the last result) and 'duelResult' (the friendly result card, on
// both screens; a farmer who was away sees it on return). The live score and an invitation also show in the HUD as a
// small chip on both screens (startDuel). Numbers and rules: duel.js (rules-goals) through league-rules.js.
import { DUEL } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, createKit, fill, playerMark } from './kit.js';
import { kv } from '../dom.js';
import { banner, lockedBody, toTop, tParts } from './fair.js';
import { probe, passes } from './core.js';
import { duelOf, duelOpen, duelKinds, kindOpen, duelScoreText, levelOf, actFor, canAct, ARGS, duelLiveBuild, crownsOf } from './league-rules.js';
import { hubNav, hubSig, crownArt, rewardChips } from './league-kit.js';
import { t, lang, ctext, onLang } from '../../i18n/index.js';

const DAY = 86_400_000;

/** A content line with its {name} and {duel} filled in. */
const line = (key, vars) => String(ctext('DUEL', 'lines', key, DUEL?.lines?.[key] ?? '')).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

/** Everything the duel panel draws (pure): duelOf + { unlock, level, names, kinds (with `open`), scores as text }. */
export function duelView(state, pid, now) {
  const d = duelOf(state, pid, now);
  const name = (p) => state.players?.[p]?.name ?? t('league.duel.partner');
  const others = Object.keys(state.players ?? {}).filter((p) => p !== pid).sort();
  const them = d.them ?? others[0] ?? null;
  const scale = d.kind?.scale ?? 1;
  return { ...d, them, unlock: DUEL?.unlock ?? 29, level: levelOf(state), live: duelLiveBuild(),
    kinds: duelKinds().map((k) => ({ ...k, open: kindOpen(state, k) })),
    myName: name(pid), theirName: them ? name(them) : null, hasPartner: Boolean(them),
    mineText: duelScoreText(d.mine, scale), theirsText: duelScoreText(d.theirs, scale),
    crownNames: d.crown.map((p) => (p === pid ? t('league.duel.you') : name(p))), left: Math.max(0, (d.end || 0) - now) };
}

/** "3 days left" / "5 hours left" / "42 min left" (the chip drops " left": a bare "minutes" said nothing). */
export function leftWords(ms, { short = false } = {}) {
  const k = short ? 'league.duel.leftShort' : 'league.duel.left';
  if (ms >= DAY) return t(`${k}.days`, { n: Math.floor(ms / DAY) });
  const hr = Math.floor(ms / 3_600_000);
  return hr >= 1 ? t(`${k}.hours`, { n: hr }) : t(`${k}.min`, { n: Math.max(1, Math.ceil(ms / 60_000)) });
}

/** The result in words, from one farmer's side ("Mia wins the Pie Bake-off, 14 to 11"). */
export function resultLine(v) {
  const l = v.last;
  if (!l) return '';
  const sc = l.kind.scale ?? 1;
  const a = duelScoreText(l.mine, sc);
  const b = duelScoreText(l.theirs, sc);
  if (!l.scored) return t('league.duel.res.none', { duel: l.kind.name });
  if (l.tie) return t('league.duel.res.tie', { duel: l.kind.name, a });
  return l.win === v.me ? t('league.duel.res.won', { duel: l.kind.name, a, b }) : t('league.duel.res.lost', { name: v.theirName, duel: l.kind.name, a: b, b: a });
}

export const duelPanel = {
  get title() { return t('league.duel.friendly'); },
  icon: 'ribbon_trophy',
  size: 'wide',
  topics: ['duel', 'players', 'xp', 'meta', 'track', 'fair'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    let pickKind = ctx.args?.kind ?? null;
    const sig = () => {
      const v = duelView(ctx.store.state, ctx.store.pid, ctx.now());
      return [v.open, v.phase, v.kind?.id, v.mine, v.theirs, v.end, v.last && [v.last.end, v.unseen], v.crown.join(), pickKind,
        hubSig(ctx.store.state, ctx.store.pid, ctx.now())];
    };
    const update = kit.memo(body, sig, render);
    ctx.every(30_000, () => update());

    function render() {
      const st = ctx.store.state;
      const now = ctx.now();
      const v = duelView(st, ctx.store.pid, now);
      if (!v.open) {
        const lines = [t('league.duel.locked.1'), t('league.duel.locked.2'), t('league.duel.locked.3')];
        if (v.live && v.level >= v.unlock && !v.hasPartner) {
          // the level is there, the partner is not: say that, not "opens at level N" or "coming soon"
          fill(body, hubNav(ctx, 'duel'), h('div.wk-locked', banner('h', t('league.duel.friendly'), t('league.duel.needTwo'), { focus: [0.72, 0.5], cls: 'lg-banner' }),
            h('div.wk-locked-card', svgIcon('heart', 36), h('ul', ...[...lines, t('league.duel.partnerJoins')].map((l) => h('li', l))))));
          return;
        }
        fill(body, hubNav(ctx, 'duel'), lockedBody('h', t('league.duel.friendly'), lines, v.unlock, v.level, v.live));
        return;
      }
      const sub = v.phase === 'live' ? `${v.kind.name} · ${leftWords(v.left)}` : t('league.duel.forFun');
      fill(body,
        hubNav(ctx, 'duel'),
        banner('h', t('league.duel.friendly'), sub, { cls: 'lg-banner', focus: [0.72, 0.5] }),
        v.phase === 'live' || v.phase === 'over' ? scoreboard(st, v)
          : v.phase === 'invited' ? invitedCard(st, v)
            : v.phase === 'asked' ? askedCard(st, v)
              : chooser(st, v),
        v.last ? lastCard(st, v) : null,
        rulesCard(v));
      kit.refresh();
      kit.tick();
    }

    function chooser(st, v) {
      const first = v.kinds.find((k) => k.open);
      const chosen = pickKind && v.kinds.some((k) => k.id === pickKind && k.open) ? pickKind : null;
      const kinds = v.kinds.map((k) => h(`button.lg-kind${chosen === k.id ? '.on' : ''}${k.open ? '' : '.locked'}`, {
        type: 'button', role: 'radio', 'aria-checked': String(chosen === k.id), 'aria-disabled': k.open ? null : 'true', dataset: { kind: k.id },
        on: { click: () => { if (k.open) { pickKind = k.id; update(true); } } },
      }, h('span.lg-kind-ic', icon(k.icon, { size: 52, alt: '' })), h('span.lg-kind-text', h('b', k.name), h('small', k.open ? k.text : t('league.duel.opensAt', { n: k.unlock })))));
      const invite = kit.button({ label: t('league.duel.invite', { name: v.theirName }), cls: 'btn--sun', key: 'duel:invite',
        type: actFor('duelInvite'), args: () => ARGS.duelInvite(chosen ?? first?.id ?? ''),
        gate: () => (chosen ? null : { code: 'BAD_ARGS', hint: { text: t('league.duel.pickFirst') } }),
        hint: { texts: { OCCUPIED: t('league.duel.occupied'), NOT_READY: t('league.duel.closing'), LOCKED: t('league.duel.notOpen') } } });
      return h('section.lg-duel-pick',
        h('h3.pn-h', h('span', t('league.duel.challenge', { name: v.theirName }))),
        h('div.lg-kinds', { role: 'radiogroup', 'aria-label': t('league.duel.which') }, ...kinds),
        h('div.lg-duel-acts', invite, h('small', t('league.duel.inviteNote', { name: v.theirName }))));
    }

    function askedCard(st, v) {
      return h('section.lg-duel-wait', h('span.lg-duel-ic', icon(v.kind.icon, { size: 60, alt: '' })),
        h('div', h('b', t('league.duel.asked', { name: v.theirName, duel: v.kind.name })),
          h('small', v.lapseAt ? t('league.duel.lapses', { when: whenText(v.lapseAt, st) }) : t('league.duel.lapsesSunday'))),
        kit.button({ label: t('league.duel.takeBack'), cls: 'btn--small btn--paper', key: 'duel:cancel', type: actFor('duelCancel'), args: ARGS.duelCancel() }));
    }

    function invitedCard(st, v) {
      return h('section.lg-duel-invite', h('span.lg-duel-ic', icon(v.kind.icon, { size: 60, alt: '' })),
        h('div', h('b', line('invite', { name: v.theirName, duel: v.kind.name }) || t('league.duel.challenges', { name: v.theirName, duel: v.kind.name })),
          h('small', t('league.duel.invitedNote', { text: v.kind.text }))),
        h('div.lg-duel-acts',
          kit.button({ label: t('league.duel.accept'), cls: 'btn--sun', key: 'duel:yes', type: actFor('duelAccept'), args: ARGS.duelAccept() }),
          kit.button({ label: t('league.duel.notThisWeek'), cls: 'btn--small btn--paper', key: 'duel:no', type: actFor('duelDecline'), args: ARGS.duelDecline() })));
    }

    function scoreboard(st, v) {
      const sum = Math.max(1, v.mine + v.theirs);
      const me = st.players[v.me];
      const them = v.them ? st.players[v.them] : null;
      const side = (pid, p, text, lead) => h(`div.lg-duel-side${lead ? '.lead' : ''}`, { style: { '--who': p?.color ?? '#C9A36A' } },
        lead ? h('span.lg-duel-crown', crownArt(34)) : null,
        p ? playerMark(pid, p, { size: 34 }) : null,
        h('b.lg-duel-n', text), h('small', pid === v.me ? t('league.duel.you') : p?.name ?? ''));
      const timer = h('b');
      if (v.phase === 'live') kit.timer(timer, { end: v.end, doneText: t('league.duel.time') });
      return h('section.lg-duel-board', { 'aria-label': t('league.duel.boardLabel', { duel: v.kind.name, mine: v.mineText, name: v.theirName, theirs: v.theirsText }) },
        h('div.lg-duel-kind', icon(v.kind.icon, { size: 40, alt: '' }), h('div', h('b', v.kind.name), h('small', v.kind.text))),
        h('div.lg-duel-score', side(v.me, me, v.mineText, v.lead === 'me'), h('span.lg-duel-vs', t('league.duel.vs')), side(v.them, them, v.theirsText, v.lead === 'them')),
        // (custom names: --a is a registered <angle> elsewhere, panels.css @property)
        h('div.lg-duel-tug', { 'aria-hidden': 'true', style: { '--lg-tug-a': me?.color ?? '#2BB3A3', '--lg-tug-b': them?.color ?? '#FF7A6B', '--p': String(v.mine / sum) } },
          h('i.a'), h('i.b'), h('span.lg-duel-knot')),
        h('p.lg-duel-clock', svgIcon('sun', 18), v.phase === 'live' ? h('span', tParts('league.duel.endsIn', { timer })) : h('span', t('league.duel.timeUp'))),
        h('p.wk-muted', t('league.duel.onlyCounts')));
    }

    function lastCard(st, v) {
      const crownKey = v.crownNames.length > 1 ? 'league.duel.crownBoth' : v.crown[0] === v.me ? 'league.duel.crownYou' : 'league.duel.crownThem';
      return h('section.wk-card.lg-duel-last', h('h3.pn-h', h('span', t('league.duel.last'))),
        h('p', h('b', resultLine(v)), '.'),
        v.crown.length ? h('p.lg-duel-crownline', crownArt(26),
          ...tParts(crownKey, { names: v.crownNames.join(t('league.duel.and')), when: h('b', whenText(v.last.end + (DUEL?.crown?.ms ?? 7 * DAY), st)) })) : null);
    }

    function rulesCard() {
      return h('section.wk-card.wk-rules', h('h3.pn-h', h('span', t('league.duel.rules.head'))),
        h('ul.wk-bullets',
          h('li', t('league.duel.rules.1')),
          h('li', t('league.duel.rules.2')),
          h('li', t('league.duel.rules.3')),
          h('li', t('league.duel.rules.4', { n: DUEL?.rewards?.hearts ?? 2 }))));
    }

    update(true);
    requestAnimationFrame(() => toTop(ctx));
    return { update: () => update() };
  },
};

/** "Sun 12 Oct, 20:00" in the farm's zone. */
function whenText(ms, state) {
  try {
    return new Intl.DateTimeFormat(lang() === 'bg' ? 'bg-BG' : 'en-GB', { timeZone: state?.meta?.tz || 'UTC', weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
  } catch { return ''; }
}

// ---- the result card ------------------------------------------------------------------------------------------

export const duelResultPanel = {
  get title() { return t('league.duel.over'); },
  icon: 'ribbon_trophy',
  size: 'card',
  mount(body, ctx) {
    const st = ctx.store.state;
    const v = duelView(st, ctx.store.pid, ctx.now());
    const l = v.last;
    if (!l) { fill(body, h('p.wk-muted', t('league.duel.noneYet'))); return {}; }
    const iWon = l.win === v.me;
    const winner = l.tie ? null : l.win;
    const wp = winner ? st.players[winner] : null;
    const sc = l.kind.scale ?? 1;
    const a = duelScoreText(l.mine, sc);
    const b = duelScoreText(l.theirs, sc);
    const title = l.tie ? t('league.duel.card.tie') : iWon ? t('league.duel.card.won') : t('league.duel.card.lost', { name: v.theirName });
    const lead = l.tie ? t('league.duel.card.tieLead', { a, duel: l.kind.name })
      : iWon ? t('league.duel.card.wonLead', { a, b, duel: l.kind.name })
        : t('league.duel.card.lostLead', { a: b, b: a, duel: l.kind.name });
    const rematch = canAct('duelInvite') && passes(probe(ctx.store, actFor('duelInvite'), ARGS.duelInvite(l.kind.id)));
    const first = l.scored && v.n === 1 && DUEL?.rewards?.firstDecor;
    fill(body, h(`div.lg-dres${l.tie ? '.tie' : iWon ? '.won' : '.lost'}`, { style: wp ? { '--who': wp.color } : null },
      h('div.lg-dres-art', crownArt(112), l.tie
        ? h('span.lg-dres-who.both', ...[v.me, v.them].filter((p) => st.players?.[p]).map((p) => playerMark(p, st.players[p], { size: 40 })))
        : wp ? h('span.lg-dres-who', playerMark(winner, wp, { size: 44 })) : null),
      ctx.args?.catchUp ? h('p.wk-cere-away', t('league.duel.away')) : null,
      h('h2.lg-dres-title', title),
      h('p.lg-dres-lead', lead),
      h('div.lg-dres-pay', h('span', t('league.duel.bothGet')), rewardChips({ hearts: DUEL?.rewards?.hearts ?? 2 }),
        first ? rewardChips({ decor: first }) : null),
      h('div.wk-cere-acts',
        h('button.btn.btn--sun', { type: 'button', on: { click: () => ctx.close() } }, l.tie ? t('league.duel.card.wellPlayed') : iWon ? t('weekly.cere.hooray') : t('league.duel.card.congrats')),
        rematch ? h('button.btn.btn--paper.btn--small', { type: 'button', on: { click: () => { ctx.close(); ctx.ui.panels.open('duel', { kind: l.kind.id }); } } }, t('league.duel.card.rematch')) : null)));
    return {};
  },
};

// ---- the HUD chip and the result card hook -------------------------------------------------------------------------

/** The chip's view (pure): null when there is nothing to show. */
export function duelChipView(state, pid, now) {
  if (!duelOpen(state)) return null;
  const v = duelView(state, pid, now);
  if (v.phase === 'live' || v.phase === 'over') {
    return { mode: 'live', kind: v.kind, mine: v.mineText, theirs: v.theirsText, lead: v.lead, left: v.left, me: pid, them: v.them };
  }
  if (v.phase === 'invited') return { mode: 'invite', kind: v.kind, from: v.theirName };
  return null;
}

/**
 * The live score on both screens: a small chip in the HUD (an invitation too), the result card once per finished,
 * scored duel (a farmer who was away sees it on return), and markSeen { kind: 'duel' } so it never shows twice.
 */
export function startDuel(ui, store) {
  const hud = typeof document !== 'undefined' ? document.getElementById('hud') : null;
  const chip = hud ? h('button.lg-duel-chip', { type: 'button', hidden: true, on: { click: () => ui.panels.open('duel') } }) : null;
  if (chip) hud.append(chip);
  // under the farmers' cards on a wide screen (clear of the coins pill and the goal tracker); on a phone the CSS
  // centres it under the top row. Measured, never per frame: on draw, resize and a layout change.
  const place = () => {
    if (!chip || chip.hidden) return;
    const pl = document.getElementById('hud-players');
    const tl = pl?.closest('.hud-tl') ?? pl;
    if (!pl || !tl) return;
    const a = pl.getBoundingClientRect();
    const b = tl.getBoundingClientRect();
    chip.style.setProperty('--lg-chip-x', `${Math.round(a.left)}px`);
    chip.style.setProperty('--lg-chip-y', `${Math.round(Math.max(a.bottom, b.bottom) + 8)}px`);
  };
  const onResize = () => place();
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize);
  const offLayout = ui.layout?.on?.(() => setTimeout(place, 50));
  let sig = '';
  let tmr = 0;
  let live = false;
  const draw = () => {
    tmr = 0;
    const st = store.state;
    if (!st || !store.pid || !chip) return;
    const v = duelChipView(st, store.pid, store.now());
    const key = JSON.stringify(v && { ...v, kind: v.kind?.id, left: Math.floor((v.left ?? 0) / 60_000) });
    if (key === sig) return;
    sig = key;
    chip.hidden = !v;
    if (!v) return;
    place();
    chip.classList.toggle('invite', v.mode === 'invite');
    if (v.mode === 'invite') {
      chip.setAttribute('aria-label', t('league.duel.chip.inviteLabel', { name: v.from, duel: v.kind.name }));
      chip.replaceChildren(icon(v.kind.icon, { size: 26, alt: '' }), h('span', ...tParts('league.duel.chip.invite', { name: h('b', v.from) })));
      return;
    }
    const me = st.players[v.me];
    const them = v.them ? st.players[v.them] : null;
    chip.setAttribute('aria-label', t('league.duel.chip.label', { duel: v.kind.name, mine: v.mine, name: them?.name ?? t('weekly.partner'), theirs: v.theirs, left: leftWords(v.left) }));
    chip.replaceChildren(icon(v.kind.icon, { size: 26, alt: '' }),
      h(`span.lg-chip-side${v.lead === 'me' ? '.lead' : ''}`, me ? playerMark(v.me, me, { size: 18 }) : null, h('b', v.mine)),
      h('span.lg-chip-dash', '–'),
      h(`span.lg-chip-side${v.lead === 'them' ? '.lead' : ''}`, h('b', v.theirs), them ? playerMark(v.them, them, { size: 18 }) : null),
      h('small', v.left > 0 ? leftWords(v.left, { short: true }) : t('league.duel.time')));
  };
  // the crown on the winner's name card for a week (GDD §6.2): a small crown over the farmer's face in the HUD. The
  // HUD patches its cards in place and owns their classes, so the crown is the card's own child with a data flag.
  let crownSig = '';
  const drawCrowns = () => {
    const list = typeof document !== 'undefined' ? document.getElementById('hud-players') : null;
    const st = store.state;
    if (!list || !st) return;
    const crowned = new Set(crownsOf(st, store.now()));
    const key = `${[...crowned].sort().join()}|${list.children.length}`;
    if (key === crownSig) return;
    crownSig = key;
    for (const li of list.children) {
      const pid = li.dataset?.pid;
      const on = Boolean(pid) && crowned.has(pid);
      let c = li.querySelector('.lg-name-crown');
      if (on && !c) {
        c = h('span.lg-name-crown', { title: t('league.duel.crownTip', { title: ctext('DUEL', 'crown', 'title', DUEL?.crown?.title ?? t('league.duel.champion')) }), 'aria-hidden': 'true' }, crownArt(26));
        li.append(c);
      } else if (!on && c) c.remove();
      if (on) li.dataset.lgCrown = '1'; else delete li.dataset.lgCrown;
    }
  };
  const kick = () => { if (!tmr) tmr = setTimeout(() => { draw(); drawCrowns(); }, 250); };
  // a language switch re-words the chip and the crowns' tips at once
  const offLang = onLang(() => { sig = ''; crownSig = ''; for (const c of document.querySelectorAll?.('.lg-name-crown') ?? []) c.remove(); kick(); });

  // the result card: once per finished duel and page; markSeen tells the rules, a local note covers a lost one
  const shown = new Set();
  const check = () => {
    const st = store.state;
    if (!st || !store.pid || !ui.panels.has('duelResult') || ui.panels.isOpen('duelResult')) return;
    const d = duelOf(st, store.pid, store.now());
    if (!d.last || !d.unseen) return;
    const id = String(d.last.end ?? 0);
    const key = `hh.duelSeen.${store.pid}`;
    const seenArgs = ARGS.duelSeen(d.last.end);
    const tell = () => { if (canAct('markSeen') && passes(probe(store, 'markSeen', seenArgs))) store.act('markSeen', seenArgs); };
    if (shown.has(id) || kv.get(key) === id) { tell(); return; }
    shown.add(id);
    kv.set(key, id);
    // a duel nobody scored in ends quietly (no crown, no Hearts): no card, only the panel's line
    if (d.last.scored) ui.panels.open('duelResult', { catchUp: !live }, { stack: true });
    live = false;
    tell();
  };
  const offs = [
    store.on('change', (ch) => { kick(); if (ch.source !== 'local' && (ch.topics.has('duel') || ch.topics.has('*'))) setTimeout(check, 0); }),
    store.on('welcome', () => { kick(); setTimeout(check, 0); }),
    store.on('celebrate', ({ ev } = {}) => { if (ev && ev.e === 'duelEnded') { live = !ev.catchUp; setTimeout(check, 0); } }),
  ].filter((f) => typeof f === 'function');
  const iv = setInterval(kick, 30_000);
  kick();
  setTimeout(check, 0);
  return () => {
    clearTimeout(tmr); clearInterval(iv); for (const f of offs) f(); chip?.remove(); offLang();
    if (typeof document !== 'undefined') for (const c of document.querySelectorAll?.('.lg-name-crown') ?? []) c.remove();
    if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
    if (typeof offLayout === 'function') offLayout();
  };
}
