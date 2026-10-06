// The townsfolk board (GDD §5.3 v2 G1, §5.8; L21, M1b; ui-weekly lane, wave 2): every Monday three townsfolk pin a
// request by the Market, 2-3 goods worth about E × 0.5 h; each pays like an order (1.5 × V, 80 % coins / 20 % XP)
// plus one Friendship with that neighbour; unfinished requests simply leave with the week. Below the board: each
// neighbour's Friendship (10 hearts; every 2 a gift: a decor or a recipe card), the goods they like and the
// once-a-day liked-item gift (+1). The state and the actions are the goals lane's (shared/rules/actions/folk.js:
// `farm.folk`, folkFill { i, n }, folkGift { npc, item }); a "Need help" flag shows once the rules have one.
// Pure readers (`townsfolkView`, `townsfolkBadge`) for node tests.
import { TOWNSFOLK, itemOf, npcOf, defOf } from '../../../../shared/content/index.js';
import * as FK from '../../../../shared/rules/actions/folk.js';
import { systemLive, weekOf, dayOf, weekStartDay, localAt } from '../../../../shared/rules/coop.js';
import { sortedKeys } from '../../../../shared/rules/order.js';
import { h, svgIcon, createKit, fill, chip, price } from './kit.js';
import { has, levelOf, available } from './core.js';
import { portrait } from './art.js';
import { focusOn, actionOf, banner, clockChip, flagButton, lockedBody, need, toTop } from './fair.js';
import { t, Q, ctext, lang, name as cname } from '../../i18n/index.js';

/** A neighbour's name, job and lines in the language in effect (names table; npcs roles: text-b, lines: text-c). */
const npcName = (id) => (npcOf(id) ? cname(id) : t('weekly.folk.neighbour'));
// a role is a label here: its first letter up (the CSS capitalises every word only for English)
const npcRole = (id) => { const r = String(ctext('npcs', id, 'role', npcOf(id)?.role ?? '')); return r && lang() === 'bg' ? r[0].toLocaleUpperCase('bg') + r.slice(1) : r; };
const npcLines = (id) => ctext('npcs', id, 'lines', npcOf(id)?.lines ?? []);

const FR = TOWNSFOLK.friendship;

/** What step `k` (1-based) of a neighbour's Friendship gives: { decor } or { card }, with a name to show. */
export function giftOf(npc, k) {
  const g = FR.rewards?.[npc]?.[k - 1];
  if (!g) return null;
  if (g.decor) return { kind: 'decor', id: g.decor, name: defOf(g.decor) ? cname(g.decor) : g.decor };
  if (g.card) return { kind: 'card', id: g.card, name: t('weekly.folk.card', { npc: npcOf(npc) ? cname(npc, { form: lang() === 'bg' ? 'lc' : 'label' }) : t('weekly.folk.their'), item: itemOf(g.card) ? cname(g.card) : g.card }) };
  return null;
}

/**
 * Everything the board draws, DOM-free.
 * @returns {{ live, open, unlock, level, has, posts, leavesAt, friends, ready, done, flagType }}
 */
export function townsfolkView(state, pid, now) {
  const level = levelOf(state);
  const live = systemLive(TOWNSFOLK);
  const open = live && level >= TOWNSFOLK.unlock;
  const f = state.farm.folk ?? null;
  const w = weekOf(state, now);
  const thisWeek = Boolean(f && f.w === w);
  const posts = thisWeek ? sortedKeys(f.posts).map((k) => {
    const p = f.posts[k];
    const items = sortedKeys(p.items).map((item) => ({ item, qty: p.items[item], have: available(state, item) }));
    return { i: Number(k), n: p.n, npc: p.npc, items, coins: p.coins, xp: p.xp, done: Boolean(p.done), by: p.done ? p.done.by : null,
      flag: p.flag ?? null, ready: !p.done && items.every((x) => x.have >= x.qty), friendship: FR.request };
  }).sort((a, b) => a.i - b.i) : [];
  const today = dayOf(state, now);
  const friends = FK.townsfolk(level).map((npc) => {
    const d = npcOf(npc);
    const v = f?.f?.[npc]?.v ?? 0;
    const step = Math.floor(v / FR.rewardEvery) + 1;
    return { npc, name: cname(npc), role: npcRole(npc), n: v, max: FR.max, nextAt: v >= FR.max ? null : step * FR.rewardEvery,
      next: v >= FR.max ? null : giftOf(npc, step), likes: (d.likes ?? []).filter((i) => itemOf(i) && systemLive(itemOf(i))),
      gifted: (f?.f?.[npc]?.d ?? -1) >= today, cards: f?.cards?.[npc] ?? [] };
  }).sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1));
  // requests leave with the week: the next Monday 00:00 in the farm's zone
  const leavesAt = localAt(state.meta.tz, weekStartDay(w + 1), 0);
  return {
    live, open, unlock: TOWNSFOLK.unlock, level, has: thisWeek, posts, leavesAt, friends,
    ready: posts.filter((p) => p.ready).length, done: posts.filter((p) => p.done).length,
  };
}

/** The board badge's tone: red on the last day before this week's requests leave, calm before (QA2 UI-03). Pure. */
export function townsfolkTone(state, pid, now) {
  const v = townsfolkView(state, pid, now);
  return v.leavesAt - now <= 86_400_000 ? null : 'calm';
}

/** The board's badge: requests the barn can fill right now. Pure. */
export function townsfolkBadge(state, pid, now) {
  const v = townsfolkView(state, pid, now);
  return v.open && v.ready ? v.ready : null;
}

export const townsfolkPanel = {
  get title() { return t('weekly.folk.title'); },
  icon: 'order_board',
  size: 'full',
  topics: ['folk', 'inventory', 'overflow', 'xp', 'players', 'meta'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const fillType = () => actionOf('folkFill');
    const giftType = () => actionOf('folkGift');
    const flagType = () => (has('folkFlag') ? 'folkFlag' : null);
    const sig = () => {
      const st = ctx.store.state;
      const v = townsfolkView(st, ctx.store.pid, ctx.now());
      return [v.open, v.has, v.posts.map((p) => [p.n, p.done, p.by, p.flag, p.items.map((x) => x.have)]),
        v.friends.map((f) => [f.n, f.gifted, f.likes.map((i) => available(st, i) > 0)])];
    };
    const update = kit.memo(body, sig, render);
    ctx.every(60_000, () => update());

    function render() {
      const st = ctx.store.state;
      const now = ctx.now();
      const v = townsfolkView(st, ctx.store.pid, now);
      if (!v.open) {
        fill(body, lockedBody('b', t('weekly.folk.title'), [
          t('weekly.folk.locked.1'),
          t('weekly.folk.locked.2'),
          t('weekly.folk.locked.3'),
        ], v.unlock, v.level, v.live));
        return;
      }
      const village = ctx.ui.panels.has('town')
        ? h('button.btn.btn--paper.btn--small.wk-board-link', { type: 'button', on: { click: () => ctx.ui.panels.open('town') } },
          svgIcon('hammer', 20), t('weekly.folk.projects'))
        : null;
      const clock = clockChip(kit, { label: t('weekly.folk.clock'), at: v.leavesAt, doneText: t('weekly.clock.anyMoment'), glyph: 'letter' });
      const empty = h('div.wk-empty', svgIcon('letter', 44), h('p', t('weekly.folk.bare')),
        h('small', t('weekly.folk.bareNote')));
      fill(body,
        banner('b', t('weekly.folk.banner'), v.posts.length ? t('weekly.folk.bannerSub', { n: v.done, of: v.posts.length }) : t('weekly.folk.bannerNone'),
          { chip: h('div.wk-banner-chips', clock, village) }),
        h('div.wk-board', { role: 'list', 'aria-label': t('weekly.folk.requests') }, ...(v.posts.length ? v.posts.map((p, k) => postCard(st, p, k)) : [empty])),
        friendsEl(st, v));
      kit.refresh();
      if (Number.isInteger(ctx.args.i) && !ctx.wkRang) focusOn(ctx.wkRang = body.querySelector(`[data-post="${ctx.args.i}"]`));
    }

    function postCard(st, p, k) {
      const npc = npcOf(p.npc);
      const args = { i: p.i, n: p.n };
      const who = p.by && st.players?.[p.by] ? st.players[p.by] : null;
      const lines = npc ? npcLines(p.npc) : [];
      const line = (Array.isArray(lines) ? lines[p.n % Math.max(1, lines.length)] : null) ?? '';
      const ft = flagType();
      const missing = () => ({ missing: p.items.filter((x) => x.have < x.qty).flatMap((x) => need(x.item, x.qty - x.have).missing) });
      return h(`article.pn-order.wk-post${p.ready ? '.ready' : ''}${p.done ? '.done' : ''}`, {
        role: 'listitem', dataset: { post: String(p.i) }, style: { '--tilt': `${[-1.1, 0.9, -0.5][k % 3]}deg` } },
      h('span.pn-pin', { 'aria-hidden': 'true' }),
      h('header.wk-post-head', npc ? portrait(npc, 56) : null,
        h('div', h('b', npcName(p.npc)), h('small', npc ? npcRole(p.npc) : ''), line ? h('q', line) : null)),
      h('div.pn-order-items', ...p.items.map((x) => chip(x.item, p.done ? { n: x.qty, size: 44 } : { have: x.have, need: x.qty, size: 44 }))),
      h('div.pn-order-pay', price({ coins: p.coins }), h('span.pn-xp', t('weekly.xp', { n: p.xp })),
        h('span.wk-friend-gain', { title: npc ? t('weekly.folk.friendTip', { n: p.friendship, npc: cname(p.npc) }) : t('weekly.folk.friendTipThem', { n: p.friendship }) },
          svgIcon('heart', 16), t('weekly.folk.friend', { n: p.friendship }))),
      p.done
        ? h('div.wk-done', svgIcon('check', 22), who ? t('weekly.folk.deliveredBy', { name: who.name }) : t('weekly.folk.delivered'))
        : h('div.wk-post-acts',
          kit.button({ label: t('weekly.folk.deliver'), glyph: 'check', cls: `${p.ready ? 'btn--sun ' : ''}pn-deliver`, key: `tf:${p.i}:${p.n}`,
            type: fillType(), args, data: { fill: String(p.i) }, hint: missing }),
          ft ? flagButton(ctx, st, p.flag, { type: ft, args }) : null));
    }

    function giftButton(f, item, tp) {
      const g = kit.button({ label: null, icon: item, cls: 'pn-xs btn--paper wk-gift', key: `gift:${f.npc}:${item}`, type: tp,
        args: { npc: f.npc, item }, title: t('weekly.folk.giftTip', { q: Q(item, 1), npc: f.name }), data: { gift: item },
        hint: { texts: { ALREADY_DONE: f.n >= f.max ? t('weekly.folk.bestAlready', { npc: f.name }) : t('weekly.folk.hadGift', { npc: f.name }) },
          ...need(item, 1) } });
      g.button.setAttribute('aria-label', t('weekly.folk.giveLabel', { item: cname(item), npc: f.name }));
      return g;
    }

    function friendsEl(st, v) {
      if (!v.friends.length) return null;
      const tp = giftType();
      const every = FR.rewardEvery;
      return h('section.wk-friends', h('h3.pn-h', h('span', t('weekly.folk.friends'))),
        h('p.pn-intro', t('weekly.folk.friendsIntro', { n: every })),
        h('div.wk-friend-grid', ...v.friends.map((f) => {
          const npc = npcOf(f.npc);
          const hearts = h('span.wk-hearts', { role: 'img', 'aria-label': t('weekly.folk.heartsLabel', { n: f.n, of: f.max }) },
            ...Array.from({ length: f.max }, (_, i) => h(`i${i < f.n ? '.on' : ''}${(i + 1) % every === 0 ? '.gift' : ''}`)));
          const nextLine = f.next ? t('weekly.folk.nextFor', { n: f.nextAt - f.n, gift: f.next.name, _a: f.next.kind === 'decor' ? 'a ' : '' })
            : f.nextAt ? t('weekly.folk.nextGift', { n: f.nextAt - f.n }) : t('weekly.folk.best');
          return h(`article.wk-friend${f.gifted ? '.gifted' : ''}`, { dataset: { npc: f.npc } },
            npc ? portrait(npc, 48) : null,
            h('div.wk-friend-text', h('b', f.name), h('small', f.role), hearts, h('small.wk-friend-next', nextLine)),
            h('div.wk-likes', { role: 'group', 'aria-label': t('weekly.folk.likesLabel', { npc: f.name }) }, ...f.likes.map((item) => giftButton(f, item, tp))),
            f.gifted ? h('span.wk-gifted', svgIcon('heart', 14), t('weekly.folk.gifted')) : null);
        })));
    }

    update(true);
    if (!ctx.args.item && !Number.isInteger(ctx.args.i)) requestAnimationFrame(() => toTop(ctx));
    return { update: () => update() };
  },
};
