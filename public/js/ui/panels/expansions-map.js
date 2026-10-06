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
import { t, N, Q, ctext, name as cname } from '../../i18n/index.js';

const PLOTS_PER_PARCEL = 6;

/** Words for a parcel's permanent effect (content `feature`), or null. */
export function featureText(feature) {
  if (!feature || typeof feature !== 'object') return null;
  const out = [];
  if (feature.bargeRowBonusBp) out.push(t('farm.map.feat.barge', { n: Math.round(feature.bargeRowBonusBp / 100) }));
  if (feature.truffleSpeedBp) out.push(t('farm.map.feat.truffle', { n: Math.round(feature.truffleSpeedBp / 100) }));
  if (feature.fishingSpot) out.push(t('farm.map.feat.fishing'));
  if (feature.goldenHourBonusMs) out.push(t('farm.map.feat.golden', { n: Math.round(feature.goldenHourBonusMs / 60_000) }));
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
    const name = cname(e.id, { family: 'expansions' });
    const label = status === 'home' ? t('farm.map.homestead') : status === 'sale' ? fmtShort(e.cost)
      : status === 'ours' ? name : t('common.levelShort', { n: e.unlock });
    const word = status === 'home' ? t('farm.map.word.home') : status === 'ours' ? t('farm.map.word.ours')
      : status === 'sale' ? t('farm.map.word.sale', { n: e.cost }) : status === 'soon' ? t('farm.map.word.soon', { n: e.unlock })
        : live ? t('farm.map.word.later', { n: e.unlock }) : t('farm.map.word.laterSoon', { n: e.unlock });
    return { id: e.id, k: e.k, name, unlock: e.unlock, rects: e.rects, status, live, owned: owned || e.k === 0, card,
      cost: e.cost, planks: e.planks, crates: e.crates, reveals: ctext('expansions', e.id, 'reveals', e.reveals), proofText: e.proofText ? ctext('expansions', e.id, 'proofText', e.proofText) : null,
      feature: featureText(e.feature), label, aria: `${e.k ? `${e.k}. ` : ''}${name}: ${word}` };
  });
  const mp = meadowProject();
  if (mp) {
    const done = projectDone(state, mp.id);
    parcels.push({ id: mp.reward.land.id ?? 'hollow_meadow', k: null, name: t('farm.map.meadow'), unlock: mp.unlock,
      rects: mp.reward.land.rects, status: done ? 'meadow-ours' : 'meadow-later', live: isLive(mp), owned: done, card: null,
      cost: 0, planks: 0, crates: 0, project: mp.id, projectName: cname(mp.id, { family: 'restoration' }),
      reveals: t('farm.map.meadowReveals'),
      feature: t('farm.map.meadowCap', { n: mp.reward.land.plotCap ?? 0 }), label: t('farm.map.meadowLabel'),
      aria: done ? t('farm.map.meadowOurs') : t('farm.map.meadowGift', { name: mp.name, proj: N(mp.id, 'restoration') }) });
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
  home: ['farm.map.pill.home', 'pn-owned'], ours: ['farm.map.pill.ours', 'pn-owned'], sale: ['farm.map.pill.sale', 'pn-warn'], soon: ['farm.map.pill.soon', ''],
  later: ['farm.map.pill.later', ''], 'meadow-ours': ['farm.map.pill.ours', 'pn-owned'], 'meadow-later': ['farm.map.pill.gift', ''],
};

function statStrip(v) {
  const p = v.plots;
  const parts = [t('farm.map.capStart', { n: p.base }), p.fromLevels ? t('farm.map.capLevels', { n: p.fromLevels }) : null,
    p.fromLand ? t('farm.map.capLand', { n: p.fromLand }) : null, p.fromMeadow ? t('farm.map.capMeadow', { n: p.fromMeadow }) : null].filter(Boolean);
  const up = v.upcoming;
  const next = !up ? t('farm.map.allOurs') : up.status === 'sale' ? t('farm.map.nextSale', { name: up.name })
    : up.live ? t('farm.map.nextFrom', { name: up.name, n: up.unlock }) : t('farm.map.nextSoon', { name: up.name, n: up.unlock });
  return h('div.hm-stats',
    h('div.hm-stat', svgIcon('hammer', 30), h('div', h('b', t('market.facts.of', { n: v.bought, cap: v.total })), h('small', t('farm.map.bought'))),
      bar(v.total ? v.bought / v.total : 0, null, 'pn-thin pn-go'), h('small.hm-stat-why', next)),
    h('div.hm-stat', { title: parts.join(' · ') }, icon('plot', { size: 34, alt: '' }),
      h('div', h('b', `${fmt(p.placed)} / ${fmt(p.cap)}`), h('small', t('farm.map.plotsCap'))),
      h('small.hm-stat-why', parts.join(' · '))));
}

/** One requirement line of the next parcel (a tick when met). */
const req = (ok, text, extra = null) => h(`li.pn-req${ok ? '.ok' : ''}`,
  h('span.pn-req-mark', { 'aria-hidden': 'true' }, ok ? '✓' : '·'), h('span', text), extra);

function parcelCard(ctx, kit, p, v) {
  const st = ctx.store.state;
  const [pillKey, pillCls] = STATUS_PILL[p.status] ?? [null, ''];
  const head = h('header.hm-card-head',
    p.k ? h('span.hm-k', String(p.k)) : h('span.hm-k.hm-k-home', svgIcon(p.status === 'home' ? 'barn' : 'flower', 22)),
    h('div', h('h3', p.name), h('small', p.status === 'home' ? t('farm.map.began')
      : p.k ? t('farm.map.expansionOf', { k: p.k, total: v.total, n: p.unlock }) : t('farm.map.projectOf', { name: p.projectName, proj: N(p.project, 'restoration') }))),
    pill(pillKey ? t(pillKey) : '', pillCls));
  const facts = h('ul.hm-facts',
    p.reveals ? h('li', svgIcon('sprout', 20), h('span', h('b', t('farm.map.whatThere')), p.reveals)) : null,
    p.feature ? h('li', svgIcon('star', 20), h('span', h('b', t('farm.map.forGood')), p.feature)) : null,
    p.k ? h('li', icon('plot', { size: 20, alt: '' }), h('span', h('b', t('farm.map.plotCap')), t('farm.map.plusPlots', { n: PLOTS_PER_PARCEL }))) : null);
  let body = null;
  if (p.status === 'home') {
    body = h('p.hm-note', t('farm.map.homeNote', { placed: v.plots.placed, cap: v.plots.cap }));
  } else if (p.status === 'meadow-ours' || p.status === 'meadow-later') {
    body = h('div.hm-meadow',
      h('p.hm-note', p.status === 'meadow-ours' ? t('farm.map.meadowOursNote')
        : t('farm.map.meadowLaterNote', { name: p.projectName, proj: N(p.project, 'restoration'), n: p.unlock })),
      p.status === 'meadow-later' ? h('button.btn.btn--sky.pn-sm', { type: 'button', dataset: { open: 'restoration' },
        on: { click: () => ctx.open('restoration', { id: p.project }) } }, svgIcon('book', 22), t('farm.unlock.restoration.label')) : null);
  } else if (p.status === 'ours') {
    body = h('p.hm-note', t('farm.map.oursNote'));
  } else if (!p.live) {
    body = h('p.hm-note.hm-note-later', svgIcon('lock', 18), t('farm.map.laterChapter', { name: p.name, n: p.unlock }));
  } else if (p.card) {
    const c = p.card;
    const level = v.level;
    const rows = [
      req(level >= c.unlock, t('market.land.farmLevel', { n: c.unlock })),
      req(st.farm.wallet.coins >= c.price.coins, t('market.land.coins', { n: c.price.coins })),
      ...c.needs.map((n) => req(n.have >= n.n, t(n.item === 'planks' ? 'farm.map.needPlanks' : 'farm.map.needCrates', { n: n.n, q: Q(n.item, n.n) }), chip(n.item, { have: n.have, need: n.n, size: 24 }))),
      ...c.proof.map((t) => {
        const li = req(t.have >= t.qty, proofLine(t), h('span.pn-req-n', `${fmt(t.have)}/${fmt(t.qty)}`));
        return t.have < t.qty && typeof t.ref === 'string' ? hintable(li, t.ref) : li;
      }),
    ];
    const order = p.status === 'later' ? h('p.hm-note', t('farm.map.inOrder', { name: v.next ? v.next.name : t('farm.map.before') })) : null;
    body = h('div.hm-buy',
      order,
      h('ul.pn-reqs', rows),
      c.proof.length && p.status !== 'later' ? h('p.pn-land-note', c.opened ? t('market.land.counting') : t('market.land.startsCounting')) : null,
      p.status === 'later' ? null : h('div.pn-card-foot', price(c.price, { big: c.big && c.code === null }),
        kit.button({ label: t('market.land.buy'), glyph: 'hammer', cls: 'btn--sun', type: () => I.expand(c.id).type, args: () => I.expand(c.id).args,
          data: { expand: c.id },
          gate: () => {
            const f = atlasView(ctx.store.state, { now: ctx.now(), pid: ctx.store.pid }).parcels.find((x) => x.id === c.id)?.card;
            if (!f || !f.code) return null;
            const left = f.code === 'NOT_READY' ? f.proof.find((t) => t.have < t.qty) : null;
            return { code: f.code, hint: left ? { text: t('farm.map.first', { task: proofLine({ ...left, qty: left.qty - left.have }) }) } : f.hint };
          } })));
  }
  return h(`article.hm-card.hm-st-${p.status}`, { dataset: { exp: p.id } }, head, facts, body);
}

function ladder(v, sel, pick) {
  return h('ol.hm-ladder', { 'aria-label': t('farm.map.ladder') },
    ...v.parcels.filter((p) => p.k).map((p) => h(`li.hm-rung.hm-${p.status}${p.id === sel ? '.sel' : ''}`,
      h('button', { type: 'button', 'aria-pressed': String(p.id === sel), dataset: { key: `rung-${p.id}`, exp: p.id },
        title: p.aria, on: { click: () => pick(p.id) } },
      h('span.hm-rung-k', p.status === 'ours' ? '✓' : String(p.k)), h('span.hm-rung-name', p.name),
      h('small', p.status === 'ours' ? t('farm.map.pill.ours') : p.status === 'sale' ? fmtShort(p.cost) : t('common.levelShort', { n: p.unlock }))))));
}

export const landmapPanel = {
  title: () => t('farm.map.title'),
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
          h('div.hm-mapwrap', atlasSvg(v.parcels, { selected: p.id, onPick: pick, label: t('farm.map.svgLabel') }),
            h('div.hm-legend', h('span.k.ours', t('farm.map.pill.ours')), h('span.k.sale', t('farm.map.pill.sale')), h('span.k.later', t('farm.map.pill.later')))),
          h('div.hm-side', statStrip(v), parcelCard(ctx, kit, p, v), ladder(v, p.id, pick))));
      kit.refresh();
    }
    update(true);
    return { update: () => { update(); kit.refresh(); } };
  },
};
