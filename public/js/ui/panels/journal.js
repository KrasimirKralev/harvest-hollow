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
import { m1bFeedText, thankable, farmLine } from '../feed.js';
import { albumTab } from './collections.js';
import { albumUnlocked, liveSets } from '../../../../shared/rules/actions/album.js';
import { t, tn, ctext, N, Q, nameEntry } from '../../i18n/index.js';

/** A townsfolk name (a letter's giver) in the language in effect. */
const npcName = (g) => (g ? (nameEntry(g.id, 'npcs') ? t('goals.tr.name', { x: N(g.id, 'npcs') }) : g.name) : null);

const lazy = (f) => ({ type: () => f().type, args: () => f().args });

/** The Journal's tabs; each label reads the language at access time (a getter: never spread these). */
export const JOURNAL_TABS = Object.freeze([
  ['story', 'mailbox'], ['week', 'cozy_winter_gift'], ['ribbons', 'show_ribbon'], ['album', 'recipe_cards_display'],
  ['mastery', 'mastery_sign'], ['stats', 'hearts'], ['ledger', 'coins'], ['activity', 'order_board'],
].map(([id, ic]) => Object.freeze({ id, get label() { return t(`goals.j.tab.${id}`); }, icon: ic })));

export const journalPanel = {
  get title() { return t('goals.j.title'); },
  icon: 'mailbox',
  size: 'full',
  hotkey: 'j',
  dock: { get label() { return t('goals.j.title'); }, icon: 'journal', order: 5, get hint() { return t('goals.j.dockHint'); } },
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
    h('div.pn-letter-pay', price({ coins: q.coins }), h('span.pn-xp', t('goals.j.xp', { n: q.xp })), ...extras.map((e) => pill(e))),
    q.deliver && !q.finished ? kit.button({ label: t('goals.j.handIn'), glyph: 'check', cls: 'btn--sun pn-sm', ...lazy(() => I.deliverQuest(q.id)),
      data: { deliver: q.id }, hint: () => ({ missing: q.tasks.filter((t) => t.verb === 'deliver' && !t.done).map((t) => ({ item: t.ref, n: t.need - t.have })) }) }) : null);
  const paper = h('div.pn-letter-paper',
    h('h4.pn-letter-title', q.title),
    L ? h('p.pn-letter-greet', L.greeting) : null,
    ...(compact ? [] : (L?.body ?? []).map((p) => h('p.pn-letter-body', p))),
    L ? h('p.pn-letter-sign', t('goals.j.signoff', { s: L.signoff })) : null,
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
      seen ? null : h('span.pn-letter-chain.pn-new-beat', t('goals.j.newStory'))),
    h('div.pn-letter-paper', h('h4.pn-letter-title', b.title), h('p.pn-letter-body.pn-beat-text', b.text),
      seen ? h('p.pn-letter-done', svgIcon('heart', 18), t('goals.j.beatRead'))
        : kit.button({ label: t('goals.j.beatReadIt'), glyph: 'heart', cls: 'pn-sm btn--stop', ...lazy(() => I.markSeen('beat', b.id)), data: { beat: b.id } })));
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
    if (!v.active.length) {
      const who = npcName(v.nextUp?.giver);
      wrap.append(empty(!v.nextUp ? t('goals.j.allAnswered') : who ? t('goals.j.noLetters', { who, n: v.nextUp.level })
        : t('goals.j.noLetters.someone', { n: v.nextUp.level }), 'note'));
    }
    wrap.append(h('div.pn-letters', ...v.active.map((q) => letterCard(ctx, kit, q))));
    if (v.nextUp && v.active.length) {
      const who = npcName(v.nextUp.giver);
      wrap.append(h('p.pn-next-letter', svgIcon('note', 22), who ? t('goals.j.next', { title: v.nextUp.title, who, n: v.nextUp.level })
        : t('goals.j.next.friend', { title: v.nextUp.title, n: v.nextUp.level })));
    }
    if (v.beats.length) {
      wrap.append(h('h3.pn-h', h('span', t('goals.j.beats'))), h('div.pn-letters', ...v.beats.map((b) => beatCard(ctx, kit, b))));
    }
    if (v.done.length) {
      wrap.append(h('h3.pn-h', h('span', t('goals.j.answered'))), h('div.pn-envelopes', ...v.done.map((q) => h('button.pn-envelope', {
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
    // replaceChildren() prints a null as the text "null": the boxes that have nothing to show return null
    wrap.replaceChildren(...[chainStrip('f', t('goals.j.week.title'), { sub: t('goals.j.week.sub') }),
      sideLetters(ctx, kit, 'week', t('goals.j.week.letters')),
      giftBox(ctx, kit, giftView(st, now)), weeksBox(weeksView(st), levelOf(st)), almanacBox(ctx, kit, almanacView(st, ctx.store.pid)), challengeBox(ctx, challengeView(st))].filter(Boolean));
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
  if (!g.open) return box(t('goals.j.gift.title'), h('p.pn-locked-note', svgIcon('lock', 20), t('goals.j.gift.locked', { n: g.unlock })));
  const grid = h('div.pn-cal', ...g.days.map((d) => h(`div.pn-cal-day${d.done ? '.done' : ''}${d.today ? '.today' : ''}${d.acorns ? '.big' : ''}`,
    { title: t('goals.j.gift.day', { n: d.day }) }, h('small', d.day),
    d.acorns ? icon('acorns', { size: 26 }) : d.decor ? icon('picnic_table', { size: 26 }) : d.compost ? icon('compost', { size: 26 }) : icon('coins', { size: 24 }),
    d.done ? h('span.pn-stamp', { 'aria-label': t('goals.j.gift.claimedAria') }, '✓') : null)));
  const r = g.reward;
  const parts = [];
  if (r) {
    if (r.coins) parts.push(t('goals.j.gift.coins', { n: r.coins }));
    if (r.acorns) parts.push(t('goals.j.gift.acorns', { n: r.acorns }));
    for (const [it, n] of Object.entries(r.items ?? {})) parts.push(t('goals.j.gift.item', { n, _name: itemOf(it)?.name ?? it, q: itemOf(it) ? Q(it, n, 'items') : `${n} ${it}` }));
    if (r.decor) parts.push(t('goals.j.gift.decor'));
  }
  return box(t('goals.j.gift.title'), grid, h('div.pn-gift-foot',
    h('p', g.claimed ? t('goals.j.gift.open') : t('goals.j.gift.next', { n: g.next, what: parts.join(' + ') || t('goals.j.gift.aGift') })),
    g.claimed ? pill(t('goals.j.gift.claimed'), 'pn-owned') : kit.button({ label: t('goals.j.gift.claim'), glyph: 'star', cls: 'btn--sun', ...lazy(() => I.claimGift()), data: { gift: 'claim' } })));
}

function weeksBox(w, level) {
  if (!w) return null;
  if (level < w.unlock) return box(t('goals.j.weeks.title'), h('p.pn-locked-note', svgIcon('lock', 20), t('goals.j.weeks.locked', { n: w.unlock })));
  const dots = h('div.pn-weekdays', ...Array.from({ length: w.minDays }, (_, i) => h(`span.pn-weekday${i < w.days ? '.on' : ''}`)));
  return box(t('goals.j.weeks.title'),
    h('div.pn-streak', h('b.pn-streak-n', fmt(w.streak)), h('div', h('b', tn('goals.j.weeks.inRow', w.streak)),
      h('span', w.skips ? tn('goals.j.weeks.best.skips', w.skips, { best: w.best }) : t('goals.j.weeks.best', { best: w.best })))),
    h('div.pn-week-now', h('span', t('goals.j.weeks.now')), dots, h('small', w.days >= w.minDays ? t('goals.j.weeks.counted') : t('goals.j.weeks.playOn', { n: w.minDays }))),
    w.next ? h('p.pn-hint', t('goals.j.weeks.next', { n: w.next })) : null);
}

function almanacBox(ctx, kit, a) {
  if (!a.open) return box(t('goals.j.alm.title'), h('p.pn-locked-note', svgIcon('lock', 20), t('goals.j.alm.locked', { n: a.unlock })));
  const st = ctx.store.state;
  // one task at a time (QA2 RC-12): the live one is highlighted, the others say they come next
  const list = h('ul.pn-almanac', ...a.tasks.map((t) => h(`li.pn-alm${t.n >= t.qty ? '.done' : t.live ? '.live' : '.waiting'}`,
    h('span.pn-task-box', t.n >= t.qty ? '✓' : ''),
    taskLine({ line: t.line, verb: t.verb, ref: t.ref, done: t.n >= t.qty }), h('span.pn-task-n', t.n >= t.qty || t.live ? `${fmt(Math.min(t.n, t.qty))}/${fmt(t.qty)}` : tr('goals.j.alm.next')),
    t.n >= t.qty ? null : kit.button({ label: '↻', cls: 'pn-xs pn-ghost', title: tr('goals.j.alm.swap'), ...lazy(() => I.rerollTask(t.slot)),
      data: { reroll: String(t.slot) }, hint: { done: tr('goals.j.alm.swapped') } }))));
  const tg = a.together;
  const tgBox = tg ? h('div.pn-together', h('b', svgIcon('heart', 20), t('goals.j.alm.together', { text: tg.text })),
    splitBar(st, tg.by, tg.qty, tg.n), h('small', tg.done ? t('goals.j.alm.togetherDone') : t('goals.j.alm.togetherLeft', { have: tg.n, need: tg.qty, n: tg.hearts }))) : null;
  return box(t('goals.j.alm.title'), h('p.pn-hint', t('goals.j.alm.hint', { max: a.paidMax, paid: a.paid })), list, tgBox);
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
  if (!c.open) return box(t('goals.j.ch.title'), chainStrip('g', t('goals.j.ch.strip')), h('p.pn-locked-note', svgIcon('lock', 20), t('goals.j.ch.locked', { n: c.unlock })));
  if (!c.cur) return box(t('goals.j.ch.title'), h('p.pn-hint', t('goals.j.ch.monday')));
  const st = ctx.store.state;
  const legend = h('div.pn-legend', ...Object.keys(st.players).sort().map((p) => h('span', who(st, p, { me: ctx.store.pid }), ` ${fmt(c.cur.by[p] ?? 0)}`)));
  return box(t('goals.j.ch.title'), chainStrip('g', c.cur.text),
    splitBar(st, c.cur.by, c.cur.target, c.cur.n), legend,
    h('p.pn-hint', c.cur.finished ? t('goals.j.ch.done') : t('goals.j.ch.reward', { a: COUPLE_CHALLENGE.reward.acorns, n: COUPLE_CHALLENGE.reward.hearts })));
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
        h('div.pn-ribstat', h('b', fmt(earned)), h('span', tr('goals.j.rib.earned'))),
        h('div.pn-ribstat', h('b', fmt(wall.points)), h('span', tr('goals.j.rib.points'))),
        h('div.pn-ribwall', ...wall.tiers.map((w) => {
          const name = ctext('RIBBON_WALL', w.unlock, 'name', w.name);
          return h(`span.pn-wall${w.open ? '.open' : ''}`, { title: tr('goals.j.rib.wallTier', { n: w.points, name }) }, w.open ? '✓ ' : '', name);
        }),
        ctx.ui.panels.has('ribbonwall') ? h('button.pn-chipbtn', { type: 'button', on: { click: () => ctx.open('ribbonwall') } }, tr('goals.j.rib.seeWall')) : null),
        titles.options.length ? h('label.pn-titlepick', tr('goals.j.rib.titleLabel'), h('select.pn-input', {
          on: { change: (e) => { const it = I.titlePick(e.target.value || undefined); ctx.act(it.type, it.args); } } },
        h('option', { value: '', selected: titles.worn === null }, titles.levelTitle),
        ...titles.options.map((o) => h('option', { value: o.id, selected: titles.worn === o.id }, o.title)))) : h('span.pn-hint', tr('goals.j.rib.title', { title: titles.levelTitle }))),
      h('div.pn-filters', ...['all', 'F', 'P', 'T'].map((id) => h('button.pn-chipbtn', {
        type: 'button', 'aria-pressed': String(filter === id), dataset: { key: `rf-${id}` }, on: { click: () => { filter = id; up(); } } },
      tr(id === 'all' ? 'goals.j.rib.all' : `goals.j.scope.${id}`)))),
      h('div.pn-ribbons', ...rows.filter((r) => filter === 'all' || r.scope === filter).map((r) => ribbonCard(st, r, ctx))));
  });
  up(true);
  return () => up();
}

/** A ribbon tier's name: 0 Not yet, 1 Bronze, 2 Silver, 3 Gold. */
const tierName = (k) => (k >= 0 && k <= 3 ? t(`goals.j.rib.tier.${k}`) : '');
/** t() under a name that a local `t` (a tier, a task) never shadows. */
const tr = (key, params) => t(key, params);

function ribbonCard(st, r, ctx) {
  if (r.hidden) return h('article.pn-rib.secret', rosette(0, 56, '?'), h('h4', t('goals.j.rib.secret')), h('p', t('goals.j.rib.secretSub')));
  const reward = r.reward ? [r.reward.acorns ? tn('goals.j.reward.acorns', r.reward.acorns) : null, r.reward.hearts ? t('goals.j.rib.hearts', { n: r.reward.hearts }) : null,
    r.reward.decor ? t('goals.j.rib.decor') : null, r.reward.title ? t('goals.j.rib.aTitle') : null].filter(Boolean).join(', ') : '';
  return h(`article.pn-rib.t${r.tier}`, { dataset: { ribbon: r.id } },
    rosette(r.tier, 60, r.tier ? t(`collect.wall.letter.${r.tier}`) : ''),
    h('div.pn-rib-main',
      h('div.pn-rib-top', h('h4', r.name), pill(r.scopeLabel, r.scope === 'T' ? 'pn-warn' : r.scope === 'P' ? 'pn-owned' : '')),
      h('p', r.text),
      r.next !== null ? [bar(r.pct, `${fmt(r.value)} / ${fmt(r.next)}`, r.tier >= 2 ? '' : 'pn-go'),
        h('small', reward ? t('goals.j.rib.nextReward', { tier: tierName(r.tier + 1), reward }) : t('goals.j.rib.next', { tier: tierName(r.tier + 1) }))]
        : h('small.pn-rib-done', t('goals.j.rib.allTiers')),
      r.together ? h('div.pn-legend', ...r.together.map((x) => h('span', who(st, x.pid, { me: ctx.store.pid }), ` ${fmt(x.n)}`))) : null));
}

// ---- mastery ------------------------------------------------------------------------------------------------------

function masteryTab(body, ctx, kit) {
  const wrap = h('div');
  body.append(wrap);
  const up = kit.memo(wrap, () => masteryBook(ctx.store.state), () => {
    const b = masteryBook(ctx.store.state);
    wrap.replaceChildren(h('p.pn-intro', b.open ? t('goals.j.mastery.intro') : t('goals.j.mastery.locked', { n: b.unlock })));
    for (const f of b.families) {
      if (!f.rows.length) continue;
      wrap.append(h('section.pn-section', h('h3.pn-h', h('span', f.label)), h('div.pn-mastery', ...f.rows.map((r) => h(`div.pn-mast-tile${r.stars >= 3 ? '.top' : ''}`,
        { title: r.next ? t(`goals.j.mastery.${r.unit}.next`, { n: r.count, star: r.stars + 1, at: r.next }) : t(`goals.j.mastery.${r.unit}.all`, { n: r.count }) },
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
      chainStrip('h', (v.players.length === 2 ? t('goals.j.stats.pair', { a: v.players[0].name, b: v.players[1].name }) : v.players.map((p) => p.name).join(' & ')) || t('goals.j.stats.twoOfYou'), { sub: t('goals.j.stats.sub') }),
      sideLetters(ctx, kit, 'together', t('goals.j.stats.letters')) ?? '', // a null child would print "null"
      h('div.pn-cards2', ...v.players.map((p) => h('div.pn-person', { style: { '--who': p.color }, dataset: { slot: p.pid ?? '' } },
        h('span.pn-person-dot', p.name.slice(0, 1).toUpperCase()),
        h('div', h('b', p.name), h('span', p.title), h('small', t('goals.j.stats.person', { level: p.level, n: p.hearts })))))),
      h('h3.pn-h', h('span', t('goals.j.stats.we'))),
      h('div.pn-statrows', ...v.rows.map((r) => h('div.pn-statrow', icon(r.icon, { size: 36 }),
        h('b.pn-stat-n', fmt(r.n)), h('span', r.label),
        r.by && r.by.some((x) => x.n > 0) ? splitBar(st, Object.fromEntries(r.by.map((x) => [x.pid, x.n])), Math.max(1, r.by.reduce((s, x) => s + x.n, 0)), 0) : null))),
      h('p.pn-hint', t('goals.j.stats.hint')));
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
      h('div.pn-ledger-sum', h('div', h('span', t('goals.j.ledger.earned')), h('b.pn-in', `+${fmt(inn)}`)),
        h('div', h('span', t('goals.j.ledger.spent')), h('b.pn-out', `−${fmt(out)}`)), h('div', h('span', t('goals.j.ledger.now')), h('b', fmt(st.farm.wallet.coins)))),
      rows.length ? h('table.pn-ledger', h('thead', h('tr', h('th', t('goals.j.ledger.when')), h('th', t('goals.j.ledger.who')), h('th', t('goals.j.ledger.what')),
        h('th.num', t('goals.j.ledger.coins')))),
        h('tbody', ...rows.map((r) => h('tr', h('td', ago(ctx.now() - r.at)), h('td', who(st, r.by, { me: ctx.store.pid })), h('td', r.text, r.count > 1 ? h('span.pn-times', ` ×${fmt(r.count)}`) : null),
          h(`td.num${r.coins >= 0 ? '.pn-in' : '.pn-out'}`, `${r.coins >= 0 ? '+' : '−'}${fmt(Math.abs(r.coins))}`)))))
        : empty(t('goals.j.ledger.empty'), 'coin'));
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
    const unthanked = rows.filter(({ row }) => thankable(row, st, ctx.store.pid));
    // every line is thanked, but only the daily cap of them pays Hearts: say how many are still to give (PT-05)
    const day = dayOf(st, ctx.now());
    const max = COOP.thanks?.maxReceivedPerDay ?? Infinity;
    const heartsLeft = [...new Set(unthanked.map(({ row }) => row.by))]
      .reduce((n, q) => n + Math.max(0, Math.min(unthanked.filter(({ row }) => row.by === q).length * (COOP.thanks?.hearts ?? 1),
        max - capUsed(st, q, 'thanksIn', day))), 0);
    const thankAll = unthanked.length ? h('div.pn-thankall', { style: { display: 'flex', justifyContent: 'flex-end', margin: '0 0 10px' } },
      h('button.pn-thanks', { type: 'button', title: heartsLeft ? tn('goals.j.act.allTitle', heartsLeft, { all: unthanked.length })
        : t('goals.j.act.allTitleNone', { all: unthanked.length }),
      on: { click: () => { for (const { i } of unthanked) { const it = I.thank(i); ctx.act(it.type, it.args); } } } },
      Number.isFinite(max) ? t('goals.j.act.allHearts', { all: unthanked.length, n: heartsLeft }) : t('goals.j.act.all', { all: unthanked.length }))) : null;
    wrap.replaceChildren(...(thankAll ? [thankAll] : []), rows.length ? h('ul.pn-activity', ...rows.map(({ i, row }) => {
      const mine = row.by === ctx.store.pid;
      const thanked = Boolean(row.ty);
      return h('li.pn-feedrow', { style: { '--who': st.players[row.by]?.color ?? '#B9A27A' } },
        // a farm-level line ("Големият панаир: …") is its own subject: no "The farm" in front of it
        h('span.pn-feed-bar'), h('div', h('span', ...(m1bFeedText(row)?.sys ? [] : [who(st, row.by, { me: ctx.store.pid }), ' ']), feedText(row)), h('small', ago(ctx.now() - row.at))),
        // a farm-level line names nobody: no thanks for it (the HUD feed agrees: feed.js thankable)
        mine || row.by === 'sys' || !st.players[row.by] || farmLine(row) ? null
          : h('button.pn-thanks', { type: 'button', disabled: thanked, 'aria-pressed': String(thanked),
            title: thanked ? t('goals.j.act.thanked') : t('goals.j.act.thankOne', { name: st.players[row.by].name }),
            on: { click: () => { const it = I.thank(i); ctx.act(it.type, it.args); } } }, thanked ? t('goals.j.act.thankedBtn') : t('feed.thank.btn')));
    })) : empty(t('goals.j.act.empty'), 'heart'));
  });
  up(true);
  return () => up();
}

