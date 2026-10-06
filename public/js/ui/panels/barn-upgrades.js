// The Barn's upgrade ladder (GDD §3.6; w3 ui-home lane, barn upgrades 4-10): one shared Barn that grows from 200 to
// 1,400 items in ten upgrades, each a little coins and a few Planks and Wooden Crates. The painted barn grows a part
// per upgrade (loft door, weathervane, lean-to, silos ... gilded trim), so the ladder reads as one barn getting
// bigger. The next rung carries the Upgrade button (the rules' `upgradeBarn`, probed before the click); the rest say
// when they open and what they will ask for. A materials outlook tells how many Planks and Crates the rungs still to
// come need in all, against what the Barn holds.
//
//   barnLadderView(state) -> plain data (tested in node)     barnUpgradesPanel: the 'barnUpgrades' panel (args {})
import { CONTENT, isLive, barnCapacity } from '../../../../shared/content/index.js';
import { barnUpgrades, barnView, nextBarnUpgrade, levelOf, available } from './model.js';
import { I } from './intents.js';
import { h, fmt, createKit, chip, svgIcon, icon, pill, bar, fill, hintable, counted, phoneTitle } from './kit.js';
import { barnArt } from './home-art.js';
import { t } from '../../i18n/index.js';

const PLANKS = 'planks';
const CRATES = 'wooden_crate';

/**
 * The ladder: every rung (0 = the starting barn) with its status, the next upgrade with what is missing, the Barn's
 * fill, and the materials the remaining live rungs need. Pure.
 *   rung.status: 'start' | 'done' | 'next' (open now) | 'wait' (the next one, level not reached) | 'later' | 'soon'
 *   ('soon' = a rung of a chapter not in this build yet)
 */
export function barnLadderView(state) {
  const n = barnUpgrades(state);
  const level = levelOf(state);
  const rows = [...CONTENT.barn].sort((a, b) => a.n - b.n);
  const fillV = barnView(state);
  const rungs = [{ n: 0, capacity: barnCapacity(0), unlock: 1, cost: 0, planks: 0, crates: 0, live: true,
    status: n === 0 ? 'start' : 'done', add: 0 }];
  let prev = rungs[0].capacity;
  for (const r of rows) {
    const live = isLive(r);
    let status;
    if (r.n <= n) status = 'done';
    else if (!live) status = 'soon';
    else if (r.n === n + 1) status = level >= r.unlock ? 'next' : 'wait';
    else status = 'later';
    rungs.push({ n: r.n, capacity: r.capacity, add: r.capacity - prev, unlock: r.unlock, cost: r.cost, planks: r.planks,
      crates: r.crates, live, status });
    prev = r.capacity;
  }
  const ahead = rungs.filter((r) => r.n > n && r.live);
  const need = { planks: ahead.reduce((t, r) => t + r.planks, 0), crates: ahead.reduce((t, r) => t + r.crates, 0),
    coins: ahead.reduce((t, r) => t + r.cost, 0) };
  const have = { planks: available(state, PLANKS), crates: available(state, CRATES), coins: state.farm.wallet.coins };
  return {
    n, level, cap: fillV.cap, used: fillV.used, over: fillV.over, status: fillV.status, rungs,
    next: nextBarnUpgrade(state), top: rows.length ? rows[rows.length - 1].capacity : fillV.cap,
    max: rows.length, ahead: ahead.length, need, have,
    sawmill: Object.values(state.farm.objects).some((o) => o.def === 'sawmill'),
  };
}

const STATUS_CLS = { start: '', done: 'pn-owned', next: 'pn-warn', wait: '', later: '', soon: '' };

function nextCard(ctx, kit, v) {
  const nx = v.next;
  if (!nx) {
    const soon = v.rungs.find((r) => r.status === 'soon');
    return h('section.hb-next.hb-top',
      h('h3', v.n >= v.max ? t('market.barn.biggest') : t('market.barn.maxNow')),
      h('p', soon ? t('market.ladder.soon', { n: soon.n, cap: soon.capacity }) : t('market.ladder.allDone')));
  }
  return h('section.hb-next', { dataset: { upgrade: String(nx.n) } },
    h('header', h('span.hb-n', String(nx.n)), h('div', h('h3', t('market.ladder.next', { n: nx.n, cap: nx.capacity })),
      h('small', nx.locked ? t('market.ladder.ollie', { n: nx.unlock }) : t('market.ladder.add', { n: nx.add })))),
    h('div.hb-cost',
      h('span.pn-cost.hb-coins', svgIcon('coin', 24), h('b', fmt(nx.coins))),
      ...nx.need.map((x) => chip(x.item, { have: x.have, need: x.n, size: 34, label: true }))),
    nx.missing.length && !v.sawmill && nx.missing.some((m) => m.item === PLANKS || m.item === CRATES)
      ? hintable(h('p.hb-tip', svgIcon('hammer', 18), t('market.ladder.sawmill')), PLANKS)
      : null,
    kit.button({ label: t('market.ladder.btn'), glyph: 'hammer', cls: 'btn--sun', type: () => I.barnUpgrade().type, args: () => I.barnUpgrade().args,
      data: { upgrade: 'barn' },
      gate: () => {
        const x = nextBarnUpgrade(ctx.store.state);
        if (!x) return { code: 'ALREADY_DONE', hint: { done: t('market.barn.maxNow') } };
        if (x.locked) return { code: 'LOCKED', hint: { unlock: x.unlock } };
        if (x.missing.length) return { code: 'NO_ITEMS', hint: { missing: x.missing } };
        if (x.short) return { code: 'NO_COINS', hint: { coins: x.short } };
        return null;
      } }));
}

function outlook(v) {
  if (!v.ahead) return null;
  const line = (id, want, got) => {
    const ok = got >= want;
    return hintable(h(`li${ok ? '.ok' : ''}`, icon(id, { size: 28, alt: '' }),
      h('span', t('market.ladder.inAll', { all: counted(want, id), n: got })),
      ok ? h('b.hb-ok', t('market.ladder.enough')) : h('b.hb-short', t('market.ladder.toGo', { n: want - got }))), id, { need: want, tab: true });
  };
  return h('section.hb-outlook',
    h('h4', v.ahead === 1 ? t('market.ladder.lastNeeds') : t('market.ladder.restNeed', { n: v.ahead })),
    h('ul', line(PLANKS, v.need.planks, v.have.planks), v.need.crates ? line(CRATES, v.need.crates, v.have.crates) : null,
      h('li', svgIcon('coin', 28), h('span', t('market.ladder.coinsAll', { n: v.need.coins })))));
}

function ladder(v) {
  return h('ol.hb-ladder', { 'aria-label': t('market.ladder.aria') },
    ...v.rungs.slice().reverse().map((r) => {
      const word = t(`market.ladder.status.${r.status}`);
      const cls = STATUS_CLS[r.status];
      return h(`li.hb-rung.hb-${r.status}`, { dataset: { rung: String(r.n) } },
        h('span.hb-rung-n', r.status === 'done' || (r.status === 'start' && v.n === 0) ? '✓' : String(r.n)),
        h('div.hb-rung-main', h('b', r.n === 0 ? t('market.ladder.first', { n: r.capacity }) : t('market.ladder.room', { n: r.capacity })),
          h('small', r.n === 0 ? t('market.ladder.grandma') : r.crates
            ? t('market.ladder.rungCrates', { add: r.add, lv: r.unlock, cost: r.cost, planks: r.planks, n: r.crates })
            : t('market.ladder.rung', { add: r.add, lv: r.unlock, cost: r.cost, planks: r.planks }))),
        h('div.hb-rung-cap', bar(Math.min(1, r.capacity / Math.max(1, v.top)), null, `pn-thin${r.status === 'done' || r.status === 'start' ? ' pn-go' : ''}`)),
        pill(word, cls));
    }));
}

export const barnUpgradesPanel = {
  title: () => phoneTitle('market.ladder.title', 'market.ladder.titleShort'),
  icon: 'barn',
  size: 'wide',
  topics: ['barn', 'inventory', 'overflow', 'wallet', 'xp', 'objects'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    let seen = barnLadderView(ctx.store.state).n;
    let fresh = 0;
    const sig = () => {
      const v = barnLadderView(ctx.store.state);
      return [v.n, v.used, v.over, v.level, v.have, v.next && [v.next.short, v.next.missing], v.sawmill];
    };
    const update = kit.memo(body, sig, render);
    function render() {
      const v = barnLadderView(ctx.store.state);
      // an upgrade while the panel is open: the new part pops in
      if (v.n > seen) fresh = v.n;
      seen = v.n;
      const pct = v.cap ? v.used / v.cap : 0;
      fill(body,
        h('div.hb-wrap',
          h('div.hb-left',
            h('div.hb-art', barnArt(v.n, { capacity: v.cap, fresh, label: t('market.ladder.artLabel', { n: v.n, cap: v.cap }) })),
            h('div.hb-fill', h('div.hb-fill-line', h('b', `${fmt(v.used)} / ${fmt(v.cap)}`), h('span', t('market.barn.stored')),
              v.over > 0 ? pill(t('market.barn.inOverflow', { n: v.over }), 'pn-warn') : null),
            bar(Math.min(1, pct), null, v.status === 'ok' ? 'pn-go' : v.status === 'near' ? '' : 'pn-over'),
            h('small', t('market.ladder.of', { n: v.n, max: v.max, top: v.top })))),
          h('div.hb-right', nextCard(ctx, kit, v), outlook(v))),
        h('h3.pn-h.hb-h', h('span', t('market.barn.every'))),
        ladder(v));
      kit.refresh();
    }
    update(true);
    return { update: () => { update(); kit.refresh(); } };
  },
};
