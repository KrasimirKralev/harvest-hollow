// The Journal (GDD §7.3, §5.3-§5.8, §6.4): the story letters (illustrated cards per chain with the giver's
// portrait), This week (Daily Gift calendar, Farm Weeks, the Almanac and its Together task, the Couple
// Challenge), Ribbons (rosettes with tiers, farm / yours / together, titles), the Mastery book, "Together we..."
// stats, the treasury ledger and the full activity feed with Thanks. J opens it; args { tab }.
import { itemOf, COUPLE_CHALLENGE, COOP } from '../../../../shared/content/index.js';
import { capUsed, dayOf } from '../../../../shared/rules/coop.js';
import { h, icon, svgIcon, fmt, createKit, bar, empty, pill, who, ago, price, stars, hintable } from './kit.js';
import {
  storyView, rewardPhrases, beatSeen, ribbonsView, ribbonWall, titlesView, masteryBook, statsView, ledgerView, feedView, feedText,
  giftView, weeksView, almanacView, challengeView,
} from './goals-model.js';
import { levelOf } from './model.js';
import { portrait, letterScene, rosette } from './art.js';
import { iconUrl } from '../../render/icons.js';
import { I } from './intents.js';
import { CHAIN_FOCUS, chainArt } from '../chains.js';
import { albumTab } from './collections.js';
import { albumUnlocked, liveSets } from '../../../../shared/rules/actions/album.js';

const lazy = (f) => ({ type: () => f().type, args: () => f().args });

export const JOURNAL_TABS = Object.freeze([
  { id: 'story', label: 'Letters', icon: 'mailbox' },
  { id: 'week', label: 'This week', icon: 'cozy_winter_gift' },
  { id: 'ribbons', label: 'Ribbons', icon: 'show_ribbon' },
  { id: 'album', label: 'Album', icon: 'recipe_cards_display' },
  { id: 'mastery', label: 'Mastery', icon: 'mastery_sign' },
  { id: 'stats', label: 'Together', icon: 'hearts' },
  { id: 'ledger', label: 'Ledger', icon: 'coins' },
  { id: 'activity', label: 'Activity', icon: 'order_board' },
]);

export const journalPanel = {
  title: 'Journal',
  icon: 'mailbox',
  size: 'full',
  hotkey: 'j',
  dock: { label: 'Journal', icon: 'journal', order: 5, hint: 'Letters, ribbons and your week (J)' },
  // the Album tab shows from the collections level when a set plays in this build (ui-collect)
  tabs: (args, state) => JOURNAL_TABS.filter((t) => t.id !== 'album' || (liveSets().length > 0 && (!state || albumUnlocked(state)))),
  topics: ['quests', 'ribbons', 'daily', 'challenge', 'mastery', 'stats', 'ledger', 'feed', 'players', 'xp', 'inventory', 'wallet', 'album'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    let tab = ctx.tab || 'story';
    let update = () => {};
    const show = () => {
      body.replaceChildren();
      const fn = TABS[tab] ?? TABS.story;
      update = fn(body, ctx, kit);
      kit.refresh();
    };
    show();
    return { tab(id) { tab = id; show(); }, update: () => { update(); kit.refresh(); } };
  },
};

const TABS = { story: storyTab, week: weekTab, ribbons: ribbonsTab, album: albumTab, mastery: masteryTab, stats: statsTab, ledger: ledgerTab, activity: activityTab };

// ---- letters ---------------------------------------------------------------------------------------------------


/**
 * A painted chain strip (art lane Hookup 2): the chain's 600 px painting at 4:1 or deeper, its focus point kept in
 * view, the title on an ink gradient (white text >= 4.5:1 over the palest sky).
 */
export function chainStrip(chain, title, { sub = null } = {}) {
  const art = chainArt(chain, 600);
  if (!art) return null;
  return h('div.pn-chain-strip', { style: art, role: 'img', 'aria-label': title },
    h('div.pn-chain-title', title, sub ? h('small', sub) : null));
}

/** Task verbs whose ref is an item the farm must come by: the line opens its where-to-get-it bubble. */
const ITEM_VERBS = new Set(['harvest', 'sell', 'make', 'collect', 'deliver', 'plant']);
/** A letter's task line; "Deliver 4 Bread" / "Make 3 Planks" name an item: hovering or holding it says where to get it. */
function taskLine(t) {
  const el = h('span.pn-task-line', t.line);
  if (!t.done && ITEM_VERBS.has(t.verb) && typeof t.ref === 'string') {
    hintable(el, t.ref, t.verb === 'deliver' ? { need: t.need } : {});
  }
  return el;
}

function letterCard(ctx, kit, q, { compact = false } = {}) {
  const giver = q.giver;
  const L = q.letter;
  // the chain's painted header (public/assets/art/quests, art lane); the drawn scene stays for a chain without one
  const chain = String(q.chain || '').toLowerCase();
  const focus = CHAIN_FOCUS[chain];
  const scene = focus
    ? h('div.pn-letter-scene.pn-has-art', { style: `--art: url(/assets/art/quests/${chain}.webp); --fx: ${focus[0] * 100}%; --fy: ${focus[1] * 100}%` },
      giver ? h('div.pn-letter-face', portrait(giver, 64)) : null,
      h('span.pn-letter-chain', `${q.chain}${q.id.slice(1)}`))
    : h('div.pn-letter-scene', letterScene(L?.art ?? 'farmhouse', iconUrl),
      giver ? h('div.pn-letter-face', portrait(giver, 64)) : null,
      h('span.pn-letter-chain', `${q.chain}${q.id.slice(1)}`));
  const tasks = h('ul.pn-tasks', ...q.tasks.map((t) => h(`li.pn-task${t.done ? '.done' : ''}`,
    h('span.pn-task-box', { 'aria-hidden': 'true' }, t.done ? '✓' : ''),
    taskLine(t),
    h('span.pn-task-n', `${fmt(t.have)}/${fmt(t.need)}`),
    t.done ? null : bar(t.have / Math.max(1, t.need), null, 'pn-thin pn-go'))));
  const extras = rewardPhrases(q.rewards);
  const foot = h('footer.pn-letter-foot',
    h('div.pn-letter-pay', price({ coins: q.coins }), h('span.pn-xp', `+${fmt(q.xp)} XP`), ...extras.map((e) => pill(e))),
    q.deliver && !q.finished ? kit.button({ label: 'Hand it in', glyph: 'check', cls: 'btn--sun pn-sm', ...lazy(() => I.deliverQuest(q.id)),
      data: { deliver: q.id }, hint: () => ({ missing: q.tasks.filter((t) => t.verb === 'deliver' && !t.done).map((t) => ({ item: t.ref, n: t.need - t.have })) }) }) : null);
  const paper = h('div.pn-letter-paper',
    h('h4.pn-letter-title', q.title),
    L ? h('p.pn-letter-greet', L.greeting) : null,
    ...(compact ? [] : (L?.body ?? []).map((p) => h('p.pn-letter-body', p))),
    L ? h('p.pn-letter-sign', `— ${L.signoff}`) : null,
    q.finished ? h('p.pn-letter-done', svgIcon('check', 18), q.doneText) : tasks,
    q.finished ? null : foot);
  return h(`article.pn-letter${q.ready ? '.ready' : ''}${q.finished ? '.finished' : ''}`, { dataset: { quest: q.id } }, scene, paper);
}

/** A story beat (GDD §5.3): a keepsake letter with a painted scene; "Read" marks it seen for this player only. */
function beatCard(ctx, kit, b) {
  const st = ctx.store.state;
  const seen = beatSeen(st, ctx.store.pid, b.id);
  return h(`article.pn-letter.pn-beat${seen ? '' : '.unread'}`, { dataset: { beat: b.id } },
    h('div.pn-letter-scene', letterScene(b.art, iconUrl), b.from ? h('div.pn-letter-face', portrait(b.from, 64)) : null,
      seen ? null : h('span.pn-letter-chain.pn-new-beat', 'New story')),
    h('div.pn-letter-paper', h('h4.pn-letter-title', b.title), h('p.pn-letter-body.pn-beat-text', b.text),
      seen ? h('p.pn-letter-done', svgIcon('heart', 18), 'Read · kept in the Journal')
        : kit.button({ label: 'Read it together', glyph: 'heart', cls: 'pn-sm btn--stop', ...lazy(() => I.markSeen('beat', b.id)), data: { beat: b.id } })));
}

function storyTab(body, ctx, kit) {
  const wrap = h('div');
  body.append(wrap);
  let open = null;
  const sig = () => {
    const v = storyView(ctx.store.state, ctx.now());
    return [v.active.map((q) => [q.id, q.tasks.map((t) => [t.have, t.done])]), v.done.map((q) => q.id), open,
      v.beats.map((b) => [b.id, beatSeen(ctx.store.state, ctx.store.pid, b.id)])];
  };
  const up = kit.memo(wrap, sig, () => {
    const v = storyView(ctx.store.state, ctx.now());
    wrap.replaceChildren();
    if (!v.active.length) wrap.append(empty(v.nextUp ? `No letters right now. ${v.nextUp.giver?.name ?? 'Someone'} writes again at level ${v.nextUp.level}.` : 'Every letter is answered. More come with the next levels.', 'note'));
    wrap.append(h('div.pn-letters', ...v.active.map((q) => letterCard(ctx, kit, q))));
    if (v.nextUp && v.active.length) {
      wrap.append(h('p.pn-next-letter', svgIcon('note', 22), `Next: “${v.nextUp.title}” from ${v.nextUp.giver?.name ?? 'a friend'} at level ${v.nextUp.level}.`));
    }
    if (v.beats.length) {
      wrap.append(h('h3.pn-h', h('span', 'Stories to keep')), h('div.pn-letters', ...v.beats.map((b) => beatCard(ctx, kit, b))));
    }
    if (v.done.length) {
      wrap.append(h('h3.pn-h', h('span', 'Answered letters')), h('div.pn-envelopes', ...v.done.map((q) => h('button.pn-envelope', {
        type: 'button', 'aria-expanded': String(open === q.id), dataset: { key: `env-${q.id}` },
        on: { click: () => { open = open === q.id ? null : q.id; up(); } },
      }, q.giver ? portrait(q.giver, 34) : null, h('span', q.title)))));
      const sel = v.done.find((q) => q.id === open);
      if (sel) wrap.append(h('div.pn-letters.pn-reread', letterCard(ctx, kit, sel)));
    }
    kit.refresh();
  });
  up(true);
  return () => up();
}

// ---- this week ---------------------------------------------------------------------------------------------------

function weekTab(body, ctx, kit) {
  const wrap = h('div.pn-week');
  body.append(wrap);
  const sig = () => { const st = ctx.store.state; const now = ctx.now(); return [giftView(st, now), weeksView(st), almanacView(st, ctx.store.pid), challengeView(st), sideSig(st, now, 'week')]; };
  const up = kit.memo(wrap, sig, () => {
    const st = ctx.store.state;
    const now = ctx.now();
    wrap.replaceChildren(chainStrip('f', 'This week on the farm', { sub: 'A gift a day, the weekly streak, the Almanac and your challenge' }),
      sideLetters(ctx, kit, 'week', 'Letters about the Barge and the Fair'),
      giftBox(ctx, kit, giftView(st, now)), weeksBox(weeksView(st), levelOf(st)), almanacBox(ctx, kit, almanacView(st, ctx.store.pid)), challengeBox(ctx, challengeView(st)));
    kit.refresh();
  });
  up(true);
  return () => up();
}

/** The side-chain letters of a tab (F and G on "This week", H on "Together", GDD §5.3), or null when none is open. */
function sideLetters(ctx, kit, tab, title) {
  const v = storyView(ctx.store.state, ctx.now(), { tab });
  if (!v.active.length) return null;
  return h('section.pn-box', h('h3.pn-h', h('span', title)), h('div.pn-letters', ...v.active.map((q) => letterCard(ctx, kit, q))));
}
const sideSig = (st, now, tab) => storyView(st, now, { tab }).active.map((q) => [q.id, q.tasks.map((t) => [t.have, t.done])]);

function box(title, ...children) { return h('section.pn-box', h('h3.pn-h', h('span', title)), ...children); }

function giftBox(ctx, kit, g) {
  if (!g) return null;
  if (!g.open) return box('Daily Gift', h('p.pn-locked-note', svgIcon('lock', 20), `A gift a day from level ${g.unlock}. Missing a day only pauses the calendar.`));
  const grid = h('div.pn-cal', ...g.days.map((d) => h(`div.pn-cal-day${d.done ? '.done' : ''}${d.today ? '.today' : ''}${d.acorns ? '.big' : ''}`,
    { title: `Day ${d.day}` }, h('small', d.day),
    d.acorns ? icon('acorns', { size: 26 }) : d.decor ? icon('picnic_table', { size: 26 }) : d.compost ? icon('compost', { size: 26 }) : icon('coins', { size: 24 }),
    d.done ? h('span.pn-stamp', { 'aria-label': 'claimed' }, '✓') : null)));
  const r = g.reward;
  const parts = [];
  if (r) {
    if (r.coins) parts.push(`${fmt(r.coins)} coins`);
    if (r.acorns) parts.push(`${r.acorns} Acorns`);
    for (const [it, n] of Object.entries(r.items ?? {})) parts.push(`${n} ${itemOf(it)?.name ?? it}`);
    if (r.decor) parts.push('a decor gift');
  }
  return box('Daily Gift', grid, h('div.pn-gift-foot',
    h('p', g.claimed ? 'Today\'s gift is open. See you tomorrow!' : `Day ${g.next}: ${parts.join(' + ') || 'a gift'}.`),
    g.claimed ? pill('Claimed', 'pn-owned') : kit.button({ label: 'Open today\'s gift', glyph: 'star', cls: 'btn--sun', ...lazy(() => I.claimGift()), data: { gift: 'claim' } })));
}

function weeksBox(w, level) {
  if (!w) return null;
  if (level < w.unlock) return box('Farm Weeks', h('p.pn-locked-note', svgIcon('lock', 20), `The weekly streak starts at level ${w.unlock}.`));
  const dots = h('div.pn-weekdays', ...Array.from({ length: w.minDays }, (_, i) => h(`span.pn-weekday${i < w.days ? '.on' : ''}`)));
  return box('Farm Weeks',
    h('div.pn-streak', h('b.pn-streak-n', fmt(w.streak)), h('div', h('b', w.streak === 1 ? 'week in a row' : 'weeks in a row'),
      h('span', `Best ${fmt(w.best)} · ${w.skips ? `${w.skips} skip week${w.skips > 1 ? 's' : ''} saved` : 'no skip weeks saved yet'}`))),
    h('div.pn-week-now', h('span', 'This week:'), dots, h('small', w.days >= w.minDays ? 'counted!' : `play on ${w.minDays} days to count it`)),
    w.next ? h('p.pn-hint', `At ${w.next} weeks the farm-gate signpost gets an upgrade.`) : null);
}

function almanacBox(ctx, kit, a) {
  if (!a.open) return box('Daily Almanac', h('p.pn-locked-note', svgIcon('lock', 20), `Four little tasks each day, plus one together, from level ${a.unlock}.`));
  const st = ctx.store.state;
  // one task at a time (QA2 RC-12): the live one is highlighted, the others say they come next
  const list = h('ul.pn-almanac', ...a.tasks.map((t) => h(`li.pn-alm${t.n >= t.qty ? '.done' : t.live ? '.live' : '.waiting'}`,
    h('span.pn-task-box', t.n >= t.qty ? '✓' : ''),
    taskLine({ line: t.line, verb: t.verb, ref: t.ref, done: t.n >= t.qty }), h('span.pn-task-n', t.n >= t.qty || t.live ? `${fmt(Math.min(t.n, t.qty))}/${fmt(t.qty)}` : 'next'),
    t.n >= t.qty ? null : kit.button({ label: '↻', cls: 'pn-xs pn-ghost', title: 'Swap for another task (one free a day)', ...lazy(() => I.rerollTask(t.slot)),
      data: { reroll: String(t.slot) }, hint: { done: 'Already swapped today' } }))));
  const tg = a.together;
  const tgBox = tg ? h('div.pn-together', h('b', svgIcon('heart', 20), 'Together: ', tg.text),
    splitBar(st, tg.by, tg.qty, tg.n), h('small', tg.done ? 'Done! Hearts for both of you.' : `${fmt(tg.n)}/${fmt(tg.qty)} · ${tg.hearts} Hearts each and Compost when done`)) : null;
  return box('Daily Almanac', h('p.pn-hint', `One task at a time: finish the highlighted one and the next opens. The first ${a.paidMax} each day pay coins and XP (${fmt(a.paid)}/${a.paidMax} today).`), list, tgBox);
}

/** A shared progress bar with each player's part in their colour (never colour alone: names in the title). */
function splitBar(st, by, total, n) {
  const el = h('div.pn-split', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(n),
    title: Object.entries(by || {}).map(([p, v]) => `${st.players[p]?.name ?? p}: ${fmt(v)}`).join(' · ') });
  let used = 0;
  for (const pid of Object.keys(by || {}).sort()) {
    const v = Math.min(by[pid], Math.max(0, total - used));
    if (v <= 0) continue;
    el.append(h('span.pn-split-part', { style: { width: `${(v / Math.max(1, total)) * 100}%`, '--who': st.players[pid]?.color ?? '#9aa' } }));
    used += v;
  }
  return el;
}

function challengeBox(ctx, c) {
  if (!c.open) return box('Couple Challenge', chainStrip('g', 'Once a week, together'), h('p.pn-locked-note', svgIcon('lock', 20), `A goal for the two of you each week, starting the first Monday after level ${c.unlock}.`));
  if (!c.cur) return box('Couple Challenge', h('p.pn-hint', 'The first challenge starts on Monday.'));
  const st = ctx.store.state;
  const legend = h('div.pn-legend', ...Object.keys(st.players).sort().map((p) => h('span', who(st, p, { me: ctx.store.pid }), ` ${fmt(c.cur.by[p] ?? 0)}`)));
  return box('Couple Challenge', chainStrip('g', c.cur.text),
    splitBar(st, c.cur.by, c.cur.target, c.cur.n), legend,
    h('p.pn-hint', c.cur.finished ? 'Done this week! Well played, you two.' : `Reward: ${COUPLE_CHALLENGE.reward.acorns} Acorns, a decor piece and ${COUPLE_CHALLENGE.reward.hearts} Hearts each.`));
}

// ---- ribbons -----------------------------------------------------------------------------------------------------

function ribbonsTab(body, ctx, kit) {
  let filter = 'all';
  const wrap = h('div');
  body.append(wrap);
  const sig = () => [filter, ribbonsView(ctx.store.state, ctx.store.pid).map((r) => [r.id, r.tier, r.value]), titlesView(ctx.store.state, ctx.store.pid)];
  const up = kit.memo(wrap, sig, () => {
    const st = ctx.store.state;
    const rows = ribbonsView(st, ctx.store.pid);
    const wall = ribbonWall(st);
    const titles = titlesView(st, ctx.store.pid);
    const earned = rows.filter((r) => !r.hidden && r.tier > 0).length;
    wrap.replaceChildren(
      h('div.pn-ribhead',
        h('div.pn-ribstat', h('b', fmt(earned)), h('span', 'ribbons earned')),
        h('div.pn-ribstat', h('b', fmt(wall.points)), h('span', 'Ribbon Points')),
        h('div.pn-ribwall', ...wall.tiers.map((t) => h(`span.pn-wall${t.open ? '.open' : ''}`, { title: `${t.points} points: ${t.name}` }, t.open ? '✓ ' : '', t.name)),
          ctx.ui.panels.has('ribbonwall') ? h('button.pn-chipbtn', { type: 'button', on: { click: () => ctx.open('ribbonwall') } }, 'See the Ribbon Wall') : null),
        titles.options.length ? h('label.pn-titlepick', 'Your title: ', h('select.pn-input', {
          on: { change: (e) => { const it = I.titlePick(e.target.value || undefined); ctx.act(it.type, it.args); } } },
        h('option', { value: '', selected: titles.worn === null }, titles.levelTitle),
        ...titles.options.map((o) => h('option', { value: o.id, selected: titles.worn === o.id }, o.title)))) : h('span.pn-hint', `Your title: ${titles.levelTitle}`)),
      h('div.pn-filters', ...[['all', 'All'], ['F', 'Farm'], ['P', 'Yours'], ['T', 'Together']].map(([id, label]) => h('button.pn-chipbtn', {
        type: 'button', 'aria-pressed': String(filter === id), dataset: { key: `rf-${id}` }, on: { click: () => { filter = id; up(); } } }, label))),
      h('div.pn-ribbons', ...rows.filter((r) => filter === 'all' || r.scope === filter).map((r) => ribbonCard(st, r, ctx))));
  });
  up(true);
  return () => up();
}

const TIER_NAMES = ['Not yet', 'Bronze', 'Silver', 'Gold'];

function ribbonCard(st, r, ctx) {
  if (r.hidden) return h('article.pn-rib.secret', rosette(0, 56, '?'), h('h4', 'A secret ribbon'), h('p', 'Revealed when you earn it.'));
  const reward = r.reward ? [r.reward.acorns ? `${r.reward.acorns} Acorn${r.reward.acorns > 1 ? 's' : ''}` : null, r.reward.hearts ? `${r.reward.hearts} Hearts` : null, r.reward.decor ? 'a decor piece' : null, r.reward.title ? 'a title' : null].filter(Boolean).join(', ') : '';
  return h(`article.pn-rib.t${r.tier}`, { dataset: { ribbon: r.id } },
    rosette(r.tier, 60, r.tier ? ['', 'B', 'S', 'G'][r.tier] : ''),
    h('div.pn-rib-main',
      h('div.pn-rib-top', h('h4', r.name), pill(r.scopeLabel, r.scope === 'T' ? 'pn-warn' : r.scope === 'P' ? 'pn-owned' : '')),
      h('p', r.text),
      r.next !== null ? [bar(r.pct, `${fmt(r.value)} / ${fmt(r.next)}`, r.tier >= 2 ? '' : 'pn-go'),
        h('small', `${TIER_NAMES[r.tier + 1] ?? ''} next${reward ? ` · ${reward}` : ''}`)]
        : h('small.pn-rib-done', 'Every tier earned!'),
      r.together ? h('div.pn-legend', ...r.together.map((x) => h('span', who(st, x.pid, { me: ctx.store.pid }), ` ${fmt(x.n)}`))) : null));
}

// ---- mastery ------------------------------------------------------------------------------------------------------

function masteryTab(body, ctx, kit) {
  const wrap = h('div');
  body.append(wrap);
  const up = kit.memo(wrap, () => masteryBook(ctx.store.state), () => {
    const b = masteryBook(ctx.store.state);
    wrap.replaceChildren(h('p.pn-intro', b.open
      ? 'Make the same thing often and it earns stars: ★1 sells for 5 % more, ★2 is 10 % faster, ★3 brings bonus units. Both of you count.'
      : `Mastery stars start at level ${b.unlock}. Everything you grow, raise and craft already counts toward them.`));
    for (const f of b.families) {
      if (!f.rows.length) continue;
      wrap.append(h('section.pn-section', h('h3.pn-h', h('span', f.label)), h('div.pn-mastery', ...f.rows.map((r) => h(`div.pn-mast-tile${r.stars >= 3 ? '.top' : ''}`,
        { title: r.next ? `${fmt(r.count)} ${r.unit} · ★${r.stars + 1} at ${fmt(r.next)}` : `${fmt(r.count)} ${r.unit} · all stars` },
        icon(r.id, { size: 44 }), h('b', r.name), stars(r.stars), bar(r.pct, null, 'pn-thin'), h('small', r.next ? `${fmt(r.count)}/${fmt(r.next)}` : `${fmt(r.count)} ★`))))));
    }
  });
  up(true);
  return () => up();
}

// ---- together we... --------------------------------------------------------------------------------------------------

function statsTab(body, ctx, kit) {
  const wrap = h('div');
  body.append(wrap);
  const up = kit.memo(wrap, () => [statsView(ctx.store.state), sideSig(ctx.store.state, ctx.now(), 'together')], () => {
    const st = ctx.store.state;
    const v = statsView(st);
    wrap.replaceChildren(
      chainStrip('h', v.players.map((p) => p.name).join(' & ') || 'The two of you', { sub: 'Everything the two of you did on this farm' }),
      sideLetters(ctx, kit, 'together', 'Letters for the two of you'),
      h('div.pn-cards2', ...v.players.map((p) => h('div.pn-person', { style: { '--who': p.color }, dataset: { slot: p.pid ?? '' } },
        h('span.pn-person-dot', p.name.slice(0, 1).toUpperCase()),
        h('div', h('b', p.name), h('span', p.title), h('small', `Personal level ${p.level} · ${fmt(p.hearts)} Hearts`))))),
      h('h3.pn-h', h('span', 'Together we…')),
      h('div.pn-statrows', ...v.rows.map((r) => h('div.pn-statrow', icon(r.icon, { size: 36 }),
        h('b.pn-stat-n', fmt(r.n)), h('span', r.label),
        r.by && r.by.some((x) => x.n > 0) ? splitBar(st, Object.fromEntries(r.by.map((x) => [x.pid, x.n])), Math.max(1, r.by.reduce((s, x) => s + x.n, 0)), 0) : null))),
      h('p.pn-hint', 'Farm level, coins and the Barn are shared; personal levels are just for fun and never shown on the portraits.'));
    kit.refresh();
  });
  up(true);
  return () => up();
}

// ---- ledger --------------------------------------------------------------------------------------------------------

function ledgerTab(body, ctx, kit) {
  const wrap = h('div');
  body.append(wrap);
  const up = kit.memo(wrap, () => [ctx.store.state.farm.ledger.n], () => {
    const st = ctx.store.state;
    const rows = ledgerView(st, 150);
    const weekAgo = ctx.now() - 7 * 86_400_000;
    const week = rows.filter((r) => r.at >= weekAgo);
    const inn = week.filter((r) => r.coins > 0).reduce((s, r) => s + r.coins, 0);
    const out = week.filter((r) => r.coins < 0).reduce((s, r) => s - r.coins, 0);
    wrap.replaceChildren(
      h('div.pn-ledger-sum', h('div', h('span', 'Together this week we earned'), h('b.pn-in', `+${fmt(inn)}`)),
        h('div', h('span', 'and put to work'), h('b.pn-out', `−${fmt(out)}`)), h('div', h('span', 'Treasury now'), h('b', fmt(st.farm.wallet.coins)))),
      rows.length ? h('table.pn-ledger', h('thead', h('tr', h('th', 'When'), h('th', 'Who'), h('th', 'What'), h('th.num', 'Coins'))),
        h('tbody', ...rows.map((r) => h('tr', h('td', ago(ctx.now() - r.at)), h('td', who(st, r.by, { me: ctx.store.pid })), h('td', r.text, r.count > 1 ? h('span.pn-times', ` ×${fmt(r.count)}`) : null),
          h(`td.num${r.coins >= 0 ? '.pn-in' : '.pn-out'}`, `${r.coins >= 0 ? '+' : '−'}${fmt(Math.abs(r.coins))}`)))))
        : empty('No coins have moved yet.', 'coin'));
  });
  up(true);
  return () => up();
}

// ---- activity ---------------------------------------------------------------------------------------------------------

function activityTab(body, ctx, kit) {
  const wrap = h('div');
  body.append(wrap);
  const up = kit.memo(wrap, () => feedView(ctx.store.state).map((x) => [x.i, x.row.at, x.row.q, x.row.ty]), () => {
    const st = ctx.store.state;
    const rows = feedView(st, 60);
    // Owner request 2026-10-04: one button thanks every partner line not thanked yet (same per-line action, so the
    // rules' daily Heart cap still applies).
    const unthanked = rows.filter(({ row }) => row.by !== ctx.store.pid && row.by !== 'sys' && st.players[row.by] && !row.ty);
    // every line is thanked, but only the daily cap of them pays Hearts: say how many are still to give (PT-05)
    const day = dayOf(st, ctx.now());
    const max = COOP.thanks?.maxReceivedPerDay ?? Infinity;
    const heartsLeft = [...new Set(unthanked.map(({ row }) => row.by))]
      .reduce((n, q) => n + Math.max(0, Math.min(unthanked.filter(({ row }) => row.by === q).length * (COOP.thanks?.hearts ?? 1),
        max - capUsed(st, q, 'thanksIn', day))), 0);
    const thankAll = unthanked.length ? h('div.pn-thankall', { style: { display: 'flex', justifyContent: 'flex-end', margin: '0 0 10px' } },
      h('button.pn-thanks', { type: 'button', title: `Thank every one of these (${unthanked.length}); ${heartsLeft ? `${heartsLeft} Heart${heartsLeft === 1 ? '' : 's'} still to give today` : 'no Hearts left to give today'}`,
        on: { click: () => { for (const { i } of unthanked) { const it = I.thank(i); ctx.act(it.type, it.args); } } } },
      `♥ Thank all (${unthanked.length})${Number.isFinite(max) ? ` · +${heartsLeft} ♥` : ''}`)) : null;
    wrap.replaceChildren(...(thankAll ? [thankAll] : []), rows.length ? h('ul.pn-activity', ...rows.map(({ i, row }) => {
      const mine = row.by === ctx.store.pid;
      const thanked = Boolean(row.ty);
      return h('li.pn-feedrow', { style: { '--who': st.players[row.by]?.color ?? '#B9A27A' } },
        h('span.pn-feed-bar'), h('div', h('span', who(st, row.by, { me: ctx.store.pid }), ' ', feedText(row)), h('small', ago(ctx.now() - row.at))),
        mine || row.by === 'sys' || !st.players[row.by] ? null
          : h('button.pn-thanks', { type: 'button', disabled: thanked, 'aria-pressed': String(thanked), title: thanked ? 'Thanked' : `Thank ${st.players[row.by].name} (+1 Heart for them)`,
            on: { click: () => { const it = I.thank(i); ctx.act(it.type, it.args); } } }, thanked ? '♥ Thanked' : '♥ Thanks'));
    })) : empty('Nothing has happened yet. Go make some memories!', 'heart'));
  });
  up(true);
  return () => up();
}

