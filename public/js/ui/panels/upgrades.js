// Farm upgrades (owner wish E, 2026-10-04), ui lane: the farmhouse, the Market Stand, the Well and every bench, each a
// few tiers with a new look and a small bonus (the rules' table: shared/rules/upgrades.js; the action upgradeObject).
// Loaded on first open (panels/w4.js lazyPanel).
//
//   upgradesPanel.mount(body, ctx)   args { id? } (an object), { target? } ('farmhouse' | 'well' | 'market_stand' |
//                                    'bench'); without either the farmhouse first
//   upgradesView(state, args) -> { list, cur }   pure (tests)
import { h, icon, svgIcon, fmt, createKit, fill, price, chip } from './kit.js';
import { actFor } from './w4-rules.js';
import { upgradeList, upgradeInfo, bonusLines } from './w4-model.js';

const GLYPH_FALLBACK = 'star';

/** The list of upgradable things and the one shown (args.id, else the first of args.target, else the first). Pure. */
export function upgradesView(state, args = {}, picked = null) {
  const list = upgradeList(state);
  const want = picked ?? args.id ?? null;
  let cur = want ? list.find((v) => v.id === want) ?? upgradeInfo(state, want) : null;
  if (!cur && args.target) cur = list.find((v) => v.target === args.target) ?? null;
  if (!cur) cur = list[0] ?? null;
  return { list, cur };
}

/** ★★☆ pips for a tier of max (owned tiers gold). */
function pips(n, max) {
  const el = h('span.up-pips', { role: 'img', 'aria-label': `${n} of ${max} upgrades` });
  for (let i = 0; i < max; i++) el.append(h(`span.up-pip${i < n ? '.on' : ''}`, { 'aria-hidden': 'true' }, '★'));
  return el;
}

const bonusList = (lines, cls = '') => (lines.length
  ? h(`ul.up-bonus${cls}`, ...lines.map((l) => h('li', svgIcon(l.glyph || GLYPH_FALLBACK, 18), l.text)))
  : null);

export const upgradesPanel = {
  mount(body, ctx) {
    const kit = createKit(ctx);
    let picked = ctx.args?.id ?? null;
    let fresh = null;              // the tier just bought here: its card pops once
    const sig = () => {
      const st = ctx.store.state;
      const v = upgradesView(st, ctx.args, picked);
      return [v.cur?.id ?? null, v.list.map((x) => [x.id, x.tier]), v.cur?.level, fresh];
    };
    const update = kit.memo(body, sig, render);

    function render() {
      const st = ctx.store.state;
      const v = upgradesView(st, ctx.args, picked);
      if (!v.cur) {
        fill(body, h('div.pn-empty', svgIcon('hammer', 44), h('p', 'Nothing on the farm takes an upgrade yet.')));
        return;
      }
      picked = v.cur.id;
      fill(body,
        v.list.length > 1 ? strip(v) : null,
        hero(v.cur),
        h('ol.up-ladder', { 'aria-label': `${v.cur.name} upgrades` }, ...v.cur.tiers.map((t) => tierCard(v.cur, t))),
        h('p.up-foot', v.cur.perObject
          ? 'Every bench has its own upgrades: a Golden Hour started on it lasts longer.'
          : `The bonus is the farm's: one ${v.cur.defName} counts, for both of you.`));
      kit.refresh();
      fresh = null;
    }

    function strip(v) {
      return h('div.up-strip', { role: 'tablist', 'aria-label': 'What to upgrade' }, ...v.list.map((x) => h('button.up-tab', {
        type: 'button', role: 'tab', 'aria-selected': String(x.id === v.cur.id), dataset: { key: `up:${x.id}` },
        on: { click: () => { picked = x.id; update(true); } },
      }, icon(x.def, { size: 36, alt: '' }), h('span.up-tab-name', x.defName), pips(x.tier, x.max))));
    }

    function hero(c) {
      const now = c.now;
      return h('section.up-hero', { 'aria-label': `${c.defName}, ${c.tier} of ${c.max} upgrades` },
        h('div.up-stage', icon(c.def, { size: 112, alt: '' }), c.tier ? h('span.up-stage-tier', `★${c.tier}`) : null),
        h('div.up-hero-text',
          h('h3', c.defName),
          h('div.up-hero-line', pips(c.tier, c.max), h('b', now ? now.name : 'Not upgraded yet')),
          now ? bonusList(bonusLines(now.bonus), '.now') : h('p.up-hint', 'Each upgrade gives it a new look and the farm a small, lasting bonus.'),
          c.next ? null : h('p.up-done', svgIcon('check', 18), 'Every upgrade is done. Beautiful!')));
    }

    function tierCard(c, t) {
      const state = t.owned ? 'owned' : t.next ? (t.open ? 'next' : 'locked') : 'later';
      const coins = ctx.store.state.farm.wallet.coins;
      const acorns = ctx.store.state.farm.wallet.acorns;
      const missing = t.items.filter((x) => x.have < x.n).map((x) => ({ item: x.item, n: x.n - x.have }));
      const btn = t.next ? kit.button({
        label: `Upgrade · ${fmt(t.coins)}`, glyph: 'hammer', cls: 'btn--sun up-buy', key: `up:buy:${c.id}:${t.n}`,
        type: actFor('upgrade'), args: { id: c.id },
        hint: { coins: Math.max(0, t.coins - coins), acorns: Math.max(0, t.acorns - acorns), missing, unlock: t.unlock,
          texts: { ALREADY_DONE: 'Every upgrade is done', NOT_FOUND: 'It is not on the farm any more' } },
        after: (r) => { if (r?.ok) fresh = `${c.id}:${t.n}`; },
      }) : null;
      return h(`li.up-tier.${state}${fresh === `${c.id}:${t.n}` ? '.pop' : ''}`, { dataset: { tier: String(t.n) } },
        h('span.up-badge', { 'aria-hidden': 'true' }, t.owned ? svgIcon('check', 20) : String(t.n)),
        h('div.up-tier-main',
          h('div.up-tier-head', h('b', t.name), state === 'owned' ? h('span.up-tag.ok', 'Done')
            : !t.open ? h('span.up-tag.lock', svgIcon('lock', 14), `Level ${t.unlock}`) : null),
          t.text ? h('p.up-text', t.text) : null,
          bonusList(t.lines)),
        t.owned ? null : h('div.up-cost',
          h('div.up-cost-row', price({ coins: t.coins, acorns: t.acorns }),
            ...t.items.map((x) => chip(x.item, { have: x.have, need: x.n, size: 32 }))),
          btn));
    }

    update(true);
    return { update: () => { if (!update()) kit.refresh(); } };
  },
};
