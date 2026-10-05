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
import { h, svgIcon, fmt, createKit, fill, chip, price } from './kit.js';
import { has, levelOf, available } from './core.js';
import { portrait } from './art.js';
import { focusOn, actionOf, banner, clockChip, flagButton, lockedBody, need, toTop } from './fair.js';

const FR = TOWNSFOLK.friendship;

/** What step `k` (1-based) of a neighbour's Friendship gives: { decor } or { card }, with a name to show. */
export function giftOf(npc, k) {
  const g = FR.rewards?.[npc]?.[k - 1];
  if (!g) return null;
  if (g.decor) return { kind: 'decor', id: g.decor, name: defOf(g.decor)?.name ?? g.decor };
  if (g.card) return { kind: 'card', id: g.card, name: `${npcOf(npc)?.name ?? 'Their'}'s ${itemOf(g.card)?.name ?? g.card} card` };
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
    return { npc, name: d.name, role: d.role, n: v, max: FR.max, nextAt: v >= FR.max ? null : step * FR.rewardEvery,
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
  title: 'The Townsfolk Board',
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
        fill(body, lockedBody('b', 'The Townsfolk Board', [
          'Every Monday three neighbours pin a request on the board by the Market.',
          'Each pays like an order and makes you a friend. Requests leave with the week, nothing lost.',
          'Friends send gifts: a decor piece or a recipe card for every two hearts.',
        ], v.unlock, v.level, v.live));
        return;
      }
      const village = ctx.ui.panels.has('town')
        ? h('button.btn.btn--paper.btn--small.wk-board-link', { type: 'button', on: { click: () => ctx.ui.panels.open('town') } },
          svgIcon('hammer', 20), 'Village projects')
        : null;
      const clock = clockChip(kit, { label: 'New requests Monday ·', at: v.leavesAt, doneText: 'any moment now', glyph: 'letter' });
      const empty = h('div.wk-empty', svgIcon('letter', 44), h('p', 'The board is bare this week.'),
        h('small', 'New requests go up on Monday morning.'));
      fill(body,
        banner('b', 'Requests this week', v.posts.length ? `${v.done} of ${v.posts.length} requests filled this week` : 'New requests every Monday',
          { chip: h('div.wk-banner-chips', clock, village) }),
        h('div.wk-board', { role: 'list', 'aria-label': 'Requests' }, ...(v.posts.length ? v.posts.map((p, k) => postCard(st, p, k)) : [empty])),
        friendsEl(st, v));
      kit.refresh();
      if (Number.isInteger(ctx.args.i) && !ctx.wkRang) focusOn(ctx.wkRang = body.querySelector(`[data-post="${ctx.args.i}"]`));
    }

    function postCard(st, p, k) {
      const npc = npcOf(p.npc);
      const args = { i: p.i, n: p.n };
      const who = p.by && st.players?.[p.by] ? st.players[p.by] : null;
      const line = npc?.lines?.[p.n % Math.max(1, npc?.lines?.length ?? 1)] ?? '';
      const ft = flagType();
      const missing = () => ({ missing: p.items.filter((x) => x.have < x.qty).flatMap((x) => need(x.item, x.qty - x.have).missing) });
      return h(`article.pn-order.wk-post${p.ready ? '.ready' : ''}${p.done ? '.done' : ''}`, {
        role: 'listitem', dataset: { post: String(p.i) }, style: { '--tilt': `${[-1.1, 0.9, -0.5][k % 3]}deg` } },
      h('span.pn-pin', { 'aria-hidden': 'true' }),
      h('header.wk-post-head', npc ? portrait(npc, 56) : null,
        h('div', h('b', npc ? npc.name : 'A neighbour'), h('small', npc ? npc.role : ''), line ? h('q', line) : null)),
      h('div.pn-order-items', ...p.items.map((x) => chip(x.item, p.done ? { n: x.qty, size: 44 } : { have: x.have, need: x.qty, size: 44 }))),
      h('div.pn-order-pay', price({ coins: p.coins }), h('span.pn-xp', `+${fmt(p.xp)} XP`),
        h('span.wk-friend-gain', { title: `+${p.friendship} Friendship with ${npc ? npc.name : 'them'}` },
          svgIcon('heart', 16), `+${p.friendship} friend`)),
      p.done
        ? h('div.wk-done', svgIcon('check', 22), who ? `Delivered by ${who.name}` : 'Delivered. Thank you!')
        : h('div.wk-post-acts',
          kit.button({ label: 'Deliver', glyph: 'check', cls: `${p.ready ? 'btn--sun ' : ''}pn-deliver`, key: `tf:${p.i}:${p.n}`,
            type: fillType(), args, data: { fill: String(p.i) }, hint: missing }),
          ft ? flagButton(ctx, st, p.flag, { type: ft, args }) : null));
    }

    function giftButton(f, item, t) {
      const name = itemOf(item).name;
      const g = kit.button({ label: null, icon: item, cls: 'pn-xs btn--paper wk-gift', key: `gift:${f.npc}:${item}`, type: t,
        args: { npc: f.npc, item }, title: `Give 1 ${name} to ${f.name}: +1 Friendship (one gift a day)`, data: { gift: item },
        hint: { texts: { ALREADY_DONE: f.n >= f.max ? `${f.name} is your best friend already` : `${f.name} had a gift today` },
          ...need(item, 1) } });
      g.button.setAttribute('aria-label', `Give ${name} to ${f.name}`);
      return g;
    }

    function friendsEl(st, v) {
      if (!v.friends.length) return null;
      const t = giftType();
      const every = FR.rewardEvery;
      return h('section.wk-friends', h('h3.pn-h', h('span', 'Friends in the village')),
        h('p.pn-intro', 'Filled requests and golden orders make friends. Each neighbour also loves one of their favourite goods as a gift, '
          + `once a day. Every ${every} hearts they send something back.`),
        h('div.wk-friend-grid', ...v.friends.map((f) => {
          const npc = npcOf(f.npc);
          const hearts = h('span.wk-hearts', { role: 'img', 'aria-label': `${f.n} of ${f.max} Friendship` },
            ...Array.from({ length: f.max }, (_, i) => h(`i${i < f.n ? '.on' : ''}${(i + 1) % every === 0 ? '.gift' : ''}`)));
          const nextLine = f.next ? `${f.nextAt - f.n} more ♥ for ${f.next.kind === 'decor' ? `a ${f.next.name}` : f.next.name}`
            : f.nextAt ? `${f.nextAt - f.n} more ♥ for a gift` : 'Best friends!';
          return h(`article.wk-friend${f.gifted ? '.gifted' : ''}`, { dataset: { npc: f.npc } },
            npc ? portrait(npc, 48) : null,
            h('div.wk-friend-text', h('b', f.name), h('small', f.role), hearts, h('small.wk-friend-next', nextLine)),
            h('div.wk-likes', { role: 'group', 'aria-label': `Gifts ${f.name} likes` }, ...f.likes.map((item) => giftButton(f, item, t))),
            f.gifted ? h('span.wk-gifted', svgIcon('heart', 14), 'gift given today') : null);
        })));
    }

    update(true);
    if (!ctx.args.item && !Number.isInteger(ctx.args.i)) requestAnimationFrame(() => toTop(ctx));
    return { update: () => update() };
  },
};
