// The farm atlas (GDD §2.2, §3.9, §3.10; w3 ui-home lane): the whole farm on one painted map, every one of the 15
// expansions with its own terrain (the creek, the old orchard, the willow pond, the riding ring, the red maples, the
// hilltop gazebo ...), the Hollow Meadow of the Stone Bridge, what each parcel brings, and the next parcel's
// requirements with its "Buy the land" button. The Market's Land tab stays the quick list; this is the map you open
// to plan the farm's growth to L40.
//
//   atlasView(state, { now, pid }) -> plain data (tested in node): parcels, the plot-cap breakdown, the next parcel
//   featureText(feature) -> words for a parcel's permanent effect (or null)
//   landmapPanel                  the 'landmap' panel spec (args { id? })
//
// Rules: shared/rules/actions/expansions.js (openExpansion / expand / expandCode / proofProgress), decor.js ownCap
// (the plot cap the rules enforce, the Hollow Meadow's +6 included). Every button probes the rules before the click.
import { CONTENT, isLive, levelRow, defOf } from '../../../../shared/content/index.js';
import * as decorA from '../../../../shared/rules/actions/decor.js';
import { projectDone, projectPlotCap } from '../../../../shared/rules/economy.js';
import { landCards, levelOf, placedOf } from './model.js';
import { proofLine, openProof } from './market.js';
import { I } from './intents.js';
import { h, fmt, fmtShort, createKit, price, pill, chip, svgIcon, icon, hintable, fill, bar } from './kit.js';
import { atlasSvg } from './home-art.js';

const PLOTS_PER_PARCEL = 6;

/** Words for a parcel's permanent effect (content `feature`), or null. */
export function featureText(feature) {
  if (!feature || typeof feature !== 'object') return null;
  const out = [];
  if (feature.bargeRowBonusBp) out.push(`River Barge rows pay +${Math.round(feature.bargeRowBonusBp / 100)} %`);
  if (feature.truffleSpeedBp) out.push(`pigs here dig ${Math.round(feature.truffleSpeedBp / 100)} % faster`);
  if (feature.fishingSpot) out.push('a fishing spot on the pond dock');
  if (feature.goldenHourBonusMs) out.push(`Golden Hour lasts ${Math.round(feature.goldenHourBonusMs / 60_000)} min longer up here`);
  return out.length ? out.join(', ') : null;
}

/** The Restoration project whose reward is extra land (the Stone Bridge's Hollow Meadow), or null. */
function meadowProject() {
  for (const p of CONTENT.restoration.values()) if (p.reward && p.reward.land) return p;
  return null;
}

/**
 * Everything the atlas draws. Pure.
 * parcels: [{ id, k, name, unlock, rects, status, live, owned, card, reveals, feature, label, aria }]
 *   status: 'home' | 'ours' | 'sale' (next, level reached) | 'soon' (next in order, level not yet) | 'later' |
 *           'meadow-ours' | 'meadow-later'
 */
export function atlasView(state, env = {}) {
  const level = levelOf(state);
  const cards = landCards(state, env);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const ownedSet = new Set(state.farm.expansions);
  const all = [...CONTENT.expansions.values()].sort((a, b) => a.k - b.k);
  const parcels = all.map((e) => {
    const card = byId.get(e.id) ?? null;
    const live = isLive(e);
    const owned = ownedSet.has(e.id);
    let status;
    if (e.k === 0) status = 'home';
    else if (owned) status = 'ours';
    else if (card && card.isNext && level >= e.unlock) status = 'sale';
    else if (card && card.isNext) status = 'soon';
    else status = 'later';
    const label = status === 'home' ? 'Homestead' : status === 'sale' ? fmtShort(e.cost)
      : status === 'ours' ? e.name : `Lv ${e.unlock}`;
    const word = { home: 'our homestead', ours: 'ours', sale: `for sale, ${fmt(e.cost)} coins`, soon: `next, from level ${e.unlock}`,
      later: live ? `from level ${e.unlock}` : `from level ${e.unlock}, coming soon` }[status];
    return { id: e.id, k: e.k, name: e.name, unlock: e.unlock, rects: e.rects, status, live, owned: owned || e.k === 0, card,
      cost: e.cost, planks: e.planks, crates: e.crates, reveals: e.reveals, proofText: e.proofText ?? null,
      feature: featureText(e.feature), label, aria: `${e.k ? `${e.k}. ` : ''}${e.name}: ${word}` };
  });
  const mp = meadowProject();
  if (mp) {
    const done = projectDone(state, mp.id);
    parcels.push({ id: mp.reward.land.id ?? 'hollow_meadow', k: null, name: 'Hollow Meadow', unlock: mp.unlock,
      rects: mp.reward.land.rects, status: done ? 'meadow-ours' : 'meadow-later', live: isLive(mp), owned: done, card: null,
      cost: 0, planks: 0, crates: 0, project: mp.id, projectName: mp.name,
      reveals: 'Wildflowers taller than Grandma: bee forage x3 for the hives in reach',
      feature: `+${fmt(mp.reward.land.plotCap ?? 0)} plot cap`, label: done ? 'Meadow' : 'Meadow',
      aria: `Hollow Meadow: ${done ? 'ours' : `a gift of the ${mp.name} restoration`}` });
  }
  const bought = parcels.filter((p) => p.status === 'ours').length;
  const total = all.filter((e) => e.k > 0).length;
  const liveTotal = all.filter((e) => e.k > 0 && isLive(e)).length;
  const next = parcels.find((p) => p.status === 'sale' || p.status === 'soon') ?? null;
  // the first parcel still to buy (also when its chapter is not in this build yet: "coming soon", never "all ours")
  const upcoming = next ?? parcels.find((p) => p.k && !p.owned) ?? null;
  const plot = defOf('plot');
  const capRules = plot ? decorA.ownCap(state, plot) : null;
  const base = levelRow(1).plotCap;
  const fromLevels = levelRow(level).plotCap - base;
  const fromLand = PLOTS_PER_PARCEL * bought;
  const fromMeadow = projectPlotCap(state);
  const cap = Number.isFinite(capRules) ? capRules : base + fromLevels + fromLand + fromMeadow;
  return {
    level, parcels, bought, total, liveTotal, next, upcoming,
    plots: { placed: placedOf(state, 'plot').filter((id) => state.farm.objects[id].gh === undefined).length, cap, base,
      fromLevels, fromLand, fromMeadow },
    nextFree: next && next.status === 'soon' ? next.unlock : null,
  };
}

// ---- the panel --------------------------------------------------------------------------------------------------

const STATUS_PILL = {
  home: ['Home', 'pn-owned'], ours: ['Ours', 'pn-owned'], sale: ['For sale', 'pn-warn'], soon: ['Next', ''],
  later: ['Later', ''], 'meadow-ours': ['Ours', 'pn-owned'], 'meadow-later': ['A restoration gift', ''],
};

function statStrip(v) {
  const p = v.plots;
  const parts = [`${fmt(p.base)} to start`, p.fromLevels ? `+${fmt(p.fromLevels)} from levels` : null,
    p.fromLand ? `+${fmt(p.fromLand)} from land` : null, p.fromMeadow ? `+${fmt(p.fromMeadow)} Hollow Meadow` : null].filter(Boolean);
  const up = v.upcoming;
  const next = !up ? 'Every parcel to the hilltop is ours' : up.status === 'sale' ? `Next: ${up.name}, for sale now`
    : up.live ? `Next: ${up.name}, from level ${up.unlock}` : `Next: ${up.name}, level ${up.unlock} (coming soon)`;
  return h('div.hm-stats',
    h('div.hm-stat', svgIcon('hammer', 30), h('div', h('b', `${fmt(v.bought)} of ${fmt(v.total)}`), h('small', 'parcels bought')),
      bar(v.total ? v.bought / v.total : 0, null, 'pn-thin pn-go'), h('small.hm-stat-why', next)),
    h('div.hm-stat', { title: parts.join(' · ') }, icon('plot', { size: 34, alt: '' }),
      h('div', h('b', `${fmt(p.placed)} / ${fmt(p.cap)}`), h('small', 'plots placed / plot cap')),
      h('small.hm-stat-why', parts.join(' · '))));
}

/** One requirement line of the next parcel (a tick when met). */
const req = (ok, text, extra = null) => h(`li.pn-req${ok ? '.ok' : ''}`,
  h('span.pn-req-mark', { 'aria-hidden': 'true' }, ok ? '✓' : '·'), h('span', text), extra);

function parcelCard(ctx, kit, p, v) {
  const st = ctx.store.state;
  const [pillText, pillCls] = STATUS_PILL[p.status] ?? ['', ''];
  const head = h('header.hm-card-head',
    p.k ? h('span.hm-k', String(p.k)) : h('span.hm-k.hm-k-home', svgIcon(p.status === 'home' ? 'barn' : 'flower', 22)),
    h('div', h('h3', p.name), h('small', p.status === 'home' ? 'Where it all began'
      : p.k ? `Expansion ${p.k} of ${v.total} · from level ${p.unlock}` : `The ${p.projectName} restoration`)),
    pill(pillText, pillCls));
  const facts = h('ul.hm-facts',
    p.reveals ? h('li', svgIcon('sprout', 20), h('span', h('b', 'What is there: '), p.reveals)) : null,
    p.feature ? h('li', svgIcon('star', 20), h('span', h('b', 'For good: '), p.feature)) : null,
    p.k ? h('li', icon('plot', { size: 20, alt: '' }), h('span', h('b', 'Plot cap: '), `+${PLOTS_PER_PARCEL} plots`)) : null);
  let body = null;
  if (p.status === 'home') {
    body = h('p.hm-note', `The farmhouse, the barn and Grandma's old field. ${fmt(v.plots.placed)} plots are placed of the ${fmt(v.plots.cap)} the farm may have now.`);
  } else if (p.status === 'meadow-ours' || p.status === 'meadow-later') {
    body = h('div.hm-meadow',
      h('p.hm-note', p.status === 'meadow-ours' ? 'The Stone Bridge carries you over the brook: this meadow is ours for good.'
        : `It comes with the ${p.projectName} in the Restoration Ledger (from level ${p.unlock}): no coins, just bundles given together.`),
      p.status === 'meadow-later' ? h('button.btn.btn--sky.pn-sm', { type: 'button', dataset: { open: 'restoration' },
        on: { click: () => ctx.open('restoration', { id: p.project }) } }, svgIcon('book', 22), 'Open the Ledger') : null);
  } else if (p.status === 'ours') {
    body = h('p.hm-note', 'Ours. Its debris pays a little XP and Wood when you clear it.');
  } else if (!p.live) {
    body = h('p.hm-note.hm-note-later', svgIcon('lock', 18), `${p.name} opens with a later chapter of the valley (level ${p.unlock}).`);
  } else if (p.card) {
    const c = p.card;
    const level = v.level;
    const rows = [
      req(level >= c.unlock, `Farm level ${c.unlock}`),
      req(st.farm.wallet.coins >= c.price.coins, `${fmt(c.price.coins)} coins`),
      ...c.needs.map((n) => req(n.have >= n.n, `${fmt(n.n)} ${n.item === 'planks' ? 'Planks' : 'Wooden Crates'}`, chip(n.item, { have: n.have, need: n.n, size: 24 }))),
      ...c.proof.map((t) => {
        const li = req(t.have >= t.qty, proofLine(t), h('span.pn-req-n', `${fmt(t.have)}/${fmt(t.qty)}`));
        return t.have < t.qty && typeof t.ref === 'string' ? hintable(li, t.ref) : li;
      }),
    ];
    const order = p.status === 'later' ? h('p.hm-note', `Land is bought in order: ${v.next ? v.next.name : 'the parcel before it'} comes first.`) : null;
    body = h('div.hm-buy',
      order,
      h('ul.pn-reqs', rows),
      c.proof.length && p.status !== 'later' ? h('p.pn-land-note', c.opened
        ? 'The task counts everything you did since this card was first opened.'
        : 'The task starts counting the moment one of you opens this card.') : null,
      p.status === 'later' ? null : h('div.pn-card-foot', price(c.price, { big: c.big && c.code === null }),
        kit.button({ label: 'Buy the land', glyph: 'hammer', cls: 'btn--sun', type: () => I.expand(c.id).type, args: () => I.expand(c.id).args,
          data: { expand: c.id },
          gate: () => {
            const f = atlasView(ctx.store.state, { now: ctx.now(), pid: ctx.store.pid }).parcels.find((x) => x.id === c.id)?.card;
            if (!f || !f.code) return null;
            const left = f.code === 'NOT_READY' ? f.proof.find((t) => t.have < t.qty) : null;
            return { code: f.code, hint: left ? { text: `First: ${proofLine({ ...left, qty: left.qty - left.have })}` } : f.hint };
          } })));
  }
  return h(`article.hm-card.hm-st-${p.status}`, { dataset: { exp: p.id } }, head, facts, body);
}

function ladder(v, sel, pick) {
  return h('ol.hm-ladder', { 'aria-label': 'Every parcel in buying order' },
    ...v.parcels.filter((p) => p.k).map((p) => h(`li.hm-rung.hm-${p.status}${p.id === sel ? '.sel' : ''}`,
      h('button', { type: 'button', 'aria-pressed': String(p.id === sel), dataset: { key: `rung-${p.id}`, exp: p.id },
        title: p.aria, on: { click: () => pick(p.id) } },
      h('span.hm-rung-k', p.status === 'ours' ? '✓' : String(p.k)), h('span.hm-rung-name', p.name),
      h('small', p.status === 'ours' ? 'Ours' : p.status === 'sale' ? fmtShort(p.cost) : `Lv ${p.unlock}`)))));
}

export const landmapPanel = {
  title: 'The farm map',
  icon: 'plot',
  size: 'full',
  topics: ['expansions', 'proofs', 'wallet', 'inventory', 'overflow', 'xp', 'objects', 'restore'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const env = () => ({ now: ctx.now(), pid: ctx.store.pid });
    const v0 = atlasView(ctx.store.state, env());
    let sel = ctx.args?.id ?? v0.next?.id ?? 'home';
    const pick = (id) => {
      sel = id;
      update(true);
      body.querySelector(`.hm-card`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    };
    const sig = () => {
      const v = atlasView(ctx.store.state, env());
      return [sel, v.bought, v.plots, v.parcels.map((p) => [p.id, p.status, p.card && [p.card.code, p.card.needs.map((n) => n.have), p.card.proof.map((t) => t.have), p.card.opened]]),
        ctx.store.state.farm.wallet.coins];
    };
    const update = kit.memo(body, sig, render);
    function render() {
      const v = atlasView(ctx.store.state, env());
      const p = v.parcels.find((x) => x.id === sel) ?? v.parcels[0];
      // showing the next parcel's card starts its proof task (GDD §3.9), as the Market's Land tab does
      if (p.card && p.card.isNext && !p.card.owned && p.status === 'sale') openProof(ctx, p.card);
      fill(body,
        h('div.hm-atlas',
          h('div.hm-mapwrap', atlasSvg(v.parcels, { selected: p.id, onPick: pick, label: 'The farm and its land. Pick a parcel to read about it.' }),
            h('div.hm-legend', h('span.k.ours', 'Ours'), h('span.k.sale', 'For sale'), h('span.k.later', 'Later'))),
          h('div.hm-side', statStrip(v), parcelCard(ctx, kit, p, v), ladder(v, p.id, pick))));
      kit.refresh();
    }
    update(true);
    return { update: () => { update(); kit.refresh(); } };
  },
};
