// Legacy levels (GDD §4.6, §5.9; M2 feature legacy, from level 40), ui-league lane (wave 3).
//
// After level 40 every further level costs the same XP (the L39 -> 40 step, about ten hours of play) and pays one
// reward from a rotating pool: 10 Acorns, a Golden Seed Packet, an outfit piece, a decor variant, a statue variant.
// No empty levels, ever. The panel: the Legacy medallion and the XP to the next one, the next five rewards, and the
// rewards the farm already took. Before level 40: what waits, and how far it is.
import { h, fmt, fmtShort, createKit, fill } from './kit.js';
import { banner, toTop } from './fair.js';
import { legacyOf, MAX_LEVEL } from './league-rules.js';
import { hubNav, hubSig, rewardChips, rewardText } from './league-kit.js';
import { s as sv } from './art.js';
import { t } from '../../i18n/index.js';

/** Everything the panel draws (pure): legacyOf + { level, pct }. */
export function legacyView(state) {
  const v = legacyOf(state);
  return { ...v, pct: v.step ? v.into / v.step : 0 };
}

/** The Legacy medallion: a laurel wreath around the Legacy number. */
export function legacyMedal(n, size = 120) {
  const svg = sv('svg', { viewBox: '0 0 120 120', width: size, height: size, class: 'lg-legacy-medal', role: 'img',
    'aria-label': n ? t('league.legacy.level', { n }) : t('league.legacy.levels'), focusable: 'false' });
  const leaves = [];
  for (let i = 0; i < 9; i++) {
    for (const side of [-1, 1]) {
      const a = (Math.PI * (200 + i * 15)) / 180;
      const x = 60 + side * Math.cos(a) * -44;
      const y = 62 + Math.sin(a) * -44;
      leaves.push(sv('ellipse', { cx: x.toFixed(1), cy: y.toFixed(1), rx: 8, ry: 4, fill: i % 2 ? '#5DBB3F' : '#3F8F2A', stroke: '#3E2612', 'stroke-width': 1.2,
        transform: `rotate(${(side * (i * 15 - 20)).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})` }));
    }
  }
  svg.append(
    ...leaves,
    sv('circle', { cx: 60, cy: 60, r: 34, fill: '#B8860B', stroke: '#3E2612', 'stroke-width': 2.6 }),
    sv('circle', { cx: 60, cy: 60, r: 28, fill: '#F5C542', stroke: '#E39A1E', 'stroke-width': 2 }),
    sv('path', { d: 'M40 50 q8 -14 24 -16', fill: 'none', stroke: '#FFF2B8', 'stroke-width': 3.5, 'stroke-linecap': 'round', opacity: 0.85 }),
    sv('text', { x: 60, y: n >= 100 ? 70 : 72, 'text-anchor': 'middle', class: 'lg-legacy-n', fill: '#3E2612' }, n ? String(n) : '40'),
    sv('path', { d: 'M38 96 h44 l-5 8 5 8 h-44 l5 -8 z', fill: '#C8473A', stroke: '#3E2612', 'stroke-width': 2, 'stroke-linejoin': 'round' }),
  );
  return svg;
}

/** Who took a Legacy reward (the farmer whose deed crossed the level). */
const who = (st, pid) => (st.players?.[pid] ? h('small.lg-legacy-who', st.players[pid].name) : null);

export const legacyPanel = {
  get title() { return t('league.legacy.title'); },
  icon: 'golden_gate',
  size: 'wide',
  topics: ['xp', 'legacy', 'wallet', 'players', 'meta', 'track', 'fair', 'duel'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const sig = () => {
      const v = legacyView(ctx.store.state);
      return [v.open, v.n, Math.floor(v.pct * 200), v.rows.length, hubSig(ctx.store.state, ctx.store.pid, ctx.now())];
    };
    const update = kit.memo(body, sig, render);

    function render() {
      const st = ctx.store.state;
      const v = legacyView(st);
      const lead = v.open
        ? (v.n ? t('league.legacy.lead', { n: v.n, xp: v.toNext, next: v.n + 1 }) : t('league.legacy.leadFirst', { xp: v.toNext }))
        : t('league.legacy.leadBefore', { n: MAX_LEVEL, xp: fmtShort(v.toLegacy) });
      fill(body,
        hubNav(ctx, 'legacy'),
        banner('h', t('league.legacy.levelsCap'), v.open ? t('league.legacy.sub') : t('league.legacy.subBefore', { n: MAX_LEVEL }),
          { cls: 'lg-banner', focus: [0.62, 0.5] }),
        h(`section.lg-legacy-hero${v.open ? '' : '.locked'}`,
          legacyMedal(v.open ? v.n : 0, 120),
          h('div.lg-legacy-text',
            h('small', v.open ? t('league.legacy.farmLevel', { n: v.level }) : t('league.legacy.farmLevelOf', { n: v.level, of: MAX_LEVEL })),
            h('b', lead),
            h('span.pn-bar.lg-legacy-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(v.step), 'aria-valuenow': String(v.into),
              'aria-label': v.open ? t('league.legacy.xpOf', { n: v.into, of: v.step }) : t('league.legacy.ahead'), style: { '--p': String(v.open ? v.pct : 0) } },
            h('span.pn-bar-fill'), h('span.pn-bar-label', v.open ? t('league.legacy.bar', { n: fmtShort(v.into), of: fmtShort(v.step) }) : t('league.legacy.opensAt40'))),
            h('small', t('league.legacy.cost', { xp: fmtShort(v.step) })))),
        h('section.lg-legacy-next', h('h3.pn-h', h('span', v.open ? t('league.legacy.next') : t('league.legacy.pays'))),
          h('ol.lg-legacy-list', ...v.next.map((r, i) => h(`li.lg-legacy-row${i === 0 && v.open ? '.now' : ''}`,
            h('span.lg-legacy-badge', t('league.hub.lvl', { n: r.L })),
            rewardChips(r.reward, { size: 34, level: v.level }) ?? h('span', rewardText(r.reward)))))),
        v.rows.length ? h('section.wk-card.lg-legacy-hist', h('h3.pn-h', h('span', t('league.legacy.taken'))),
          h('ul.lg-hist-list', ...v.rows.map((r) => h('li.lg-hist-row', h('span.lg-legacy-badge', t('league.hub.lvl', { n: r.L ?? MAX_LEVEL + (r.n ?? 0) })),
            rewardChips(r.reward ?? {}, { size: 26, level: v.level }), who(st, r.by))))) : null);
      kit.refresh();
    }

    update(true);
    requestAnimationFrame(() => toTop(ctx));
    return { update: () => update() };
  },
};

