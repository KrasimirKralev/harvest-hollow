// The horse show at the County Fair (GDD §3.4 Horse, §5.6; M2 feature horse_show, L25), ui-league lane (wave 3).
//
// A horse earns its blue ribbon after 20 collections; from then on every collection has a 10 % chance of a Show
// Ribbon, and a Show Ribbon entered at the Fair counts double once the horse show exists. The panel shows the ring
// (Show Ribbons in the barn, points each, the 10-a-week cap, Enter), every horse's way to its blue ribbon, and how the
// show works. Entry numbers come from the Fair's own rules (entryPoints10, entryLimit), so the preview is the entry.
import { animalOf } from '../../../../shared/content/index.js';
import { h, icon, fmt, createKit, fill, hintable } from './kit.js';
import { banner, speech, clockChip, lockedBody, fmtPts, need, toTop, tParts } from './fair.js';
import { horseShowOpen, horsesOf, showOf, levelOf, actFor, ARGS, featureLevel, SHOW_ITEM } from './league-rules.js';
import { hubNav, hubSig, ring } from './league-kit.js';
import * as FR from '../../../../shared/rules/actions/fair.js';
import { t, fmtDec } from '../../i18n/index.js';

/** Everything the show draws (pure): { open, level, unlock, show, horses, stables, prized, total10, line }. */
export function horseShowView(state, pid, now) {
  const level = levelOf(state);
  const open = horseShowOpen(state);
  const unlock = featureLevel('horse_show', 25);
  const show = showOf(state, now);
  const horses = horsesOf(state, now);
  const stables = Object.keys(state.farm.objects).sort().filter((id) => state.farm.objects[id].def === 'stable');
  const prized = horses.filter((x) => x.prized).length;
  const def = animalOf('horse');
  const line = !show.isOpen ? t('league.show.fern.closed')
    : !horses.length ? t('league.show.fern.none')
      : !prized ? t('league.show.fern.unprized')
        : show.have > 0 && show.left > 0 ? t('league.show.fern.have')
          : t('league.show.fern.splendid');
  return { open, level, unlock, show, horses, stables, prized, line, chanceBp: def?.premiumBp ?? show.chanceBp,
    total10: show.entered * show.each, closesAt: FR.fairCloseAt(state, state.farm.fair?.cur?.w ?? 0) };
}

export const horseShowPanel = {
  get title() { return t('league.show.title'); },
  icon: 'show_ribbon',
  size: 'full',
  topics: ['fair', 'objects', 'inventory', 'names', 'xp', 'players', 'meta', 'track', 'duel'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const sig = () => {
      const v = horseShowView(ctx.store.state, ctx.store.pid, ctx.now());
      return [v.open, v.show.isOpen, v.show.have, v.show.entered, v.show.each, v.horses.map((x) => [x.id, x.cycle, x.name, x.adult, x.ready]),
        hubSig(ctx.store.state, ctx.store.pid, ctx.now())];
    };
    const update = kit.memo(body, sig, render);
    ctx.every(60_000, () => update());

    function render() {
      const st = ctx.store.state;
      const now = ctx.now();
      const v = horseShowView(st, ctx.store.pid, now);
      if (!v.open) {
        fill(body, hubNav(ctx, 'horseShow'), lockedBody('c', t('league.show.lockedTitle'), [
          t('league.show.locked.1'),
          t('league.show.locked.2'),
          t('league.show.locked.3'),
        ], v.unlock, v.level));
        return;
      }
      const cur = st.farm.fair?.cur;
      const closes = cur ? FR.fairCloseAt(st, cur.w) : now;
      const chip = v.show.isOpen ? clockChip(kit, { label: t('weekly.fair.clock.judging'), at: closes, doneText: t('weekly.fair.clock.judgingNow') }) : null;
      fill(body,
        hubNav(ctx, 'horseShow'),
        banner('c', t('league.show.lockedTitle'), t('league.show.bannerSub'), { chip, focus: [0.92, 0.4], cls: 'lg-banner' }),
        h('div.lg-top', speech('fern', v.line), ringCard(st, v)),
        h('section.lg-horses', h('h3.pn-h', h('span', v.horses.length ? t('league.show.horsesN', { n: v.prized, of: v.horses.length }) : t('league.show.horses'))),
          v.horses.length ? h('div.lg-horse-grid', ...v.horses.map((x, i) => horseCard(st, v, x, i))) : noHorses(v)),
        rulesCard(v));
      kit.refresh();
      kit.tick();
    }

    function ringCard(st, v) {
      const s = v.show;
      const tp = actFor('showEnter');
      const most = Math.max(1, Math.min(s.left, s.have));
      const pips = h('span.wk-pips', { role: 'img', 'aria-label': t('weekly.fair.entered', { n: s.entered, cap: s.cap }) },
        ...Array.from({ length: s.cap }, (_, i) => h(`i${i < s.entered ? '.on' : ''}`)));
      const hint = (n) => () => (s.left <= 0 ? { texts: { CAP: t('weekly.fair.allEntered', { n: s.cap }) } } : need(SHOW_ITEM, n - s.have));
      return h('section.lg-ring-card', { 'aria-label': t('league.show.ring') },
        h('div.lg-ring-art', hintable(h('span.lg-ribbon-big', icon(SHOW_ITEM, { size: 72, alt: t('league.show.ribbon') })), SHOW_ITEM),
          s.mul > 1 ? h('span.wk-x2.prized', { title: t('league.show.doubles') }, t('league.show.mul', { n: s.mul })) : null),
        h('div.lg-ring-text',
          h('b', t('league.show.ribbons')),
          h('span.wk-each', t('weekly.ptsEach', { pts: fmtPts(s.each), n: s.each / 10 })),
          h('small', v.total10 ? t('league.show.haveFrom', { n: s.have, pts: fmtPts(v.total10) }) : t('league.show.haveNone', { n: s.have })),
          h('div.wk-entry-cap', pips, h('small', s.left > 0 ? t('weekly.left', { n: s.left }) : t('weekly.allIn', { n: s.cap })))),
        s.isOpen ? h('div.lg-ring-acts',
          kit.button({ label: t('weekly.fair.enterN', { n: 1 }), cls: 'btn--small btn--paper', key: 'show:1', type: tp, args: ARGS.showEnter(SHOW_ITEM, 1), hint: hint(1) }),
          most > 1 ? kit.button({ label: t('weekly.fair.enterN', { n: most }), cls: 'btn--small btn--sun', key: 'show:n', type: tp, args: ARGS.showEnter(SHOW_ITEM, most), hint: hint(most) }) : null)
          : h('p.wk-muted', t('league.show.closed')));
    }

    function horseCard(st, v, x, i) {
      const p = Math.min(1, x.cycle / Math.max(1, x.prizedAt));
      const left = Math.max(0, x.prizedAt - x.cycle);
      const name = x.name || t('league.show.horseN', { n: i + 1 });
      const status = !x.adult ? t('league.show.foal')
        : x.prized ? t('league.show.prizedChance', { pct: fmtDec(v.chanceBp / 100, 2) })
          : t('league.show.toRibbon', { n: left });
      return h(`article.lg-horse${x.prized ? '.prized' : ''}`, { dataset: { id: x.id } },
        h('div.lg-horse-art', ring(p, 76, '', { color: x.prized ? '#4A7FE8' : '#E39A1E' }), h('span.lg-horse-ic', icon('horse', { size: 48, alt: '' })),
          x.prized ? h('span.lg-horse-rosette', icon('blue_rosette', { size: 30, alt: t('league.show.blue') })) : null),
        h('div.lg-horse-text', h('b', name), h('small', status),
          !x.prized && x.adult ? h('span.lg-horse-n', t('league.show.collections', { n: x.cycle, of: x.prizedAt })) : null,
          x.ready ? h('span.pn-pill.pn-owned', t('league.show.ready')) : null),
        x.home ? kit.button({ label: t('league.show.visit'), cls: 'btn--small btn--paper', key: `horse:${x.id}`, gate: () => null,
          onClick: () => ctx.ui.panels.open('animals', { id: x.home }) }) : null);
    }

    function noHorses(v) {
      return h('div.wk-empty', icon('stable', { size: 56, alt: '' }), h('p', v.stables.length ? t('league.show.stableEmpty') : t('league.show.noStable')),
        h('small', v.stables.length ? t('league.show.stableEmptyNote') : t('league.show.noStableNote')),
        kit.button({ label: t('league.show.market'), cls: 'btn--small btn--sun', key: 'show:market', gate: () => null,
          onClick: () => ctx.ui.panels.open('market', { tab: 'animals' }) }));
    }

    function rulesCard(v) {
      return h('section.wk-card.wk-rules.lg-rules', h('h3.pn-h', h('span', t('league.show.rules.head'))),
        h('ul.wk-bullets',
          h('li', t('league.show.rules.1', { n: animalOf('horse')?.prizedAt ?? 20 })),
          h('li', t('league.show.rules.2', { pct: fmtDec(v.chanceBp / 100, 2) })),
          h('li', ...tParts('league.show.rules.3', { b: h('b', t('league.show.rules.3b')), pts: fmtPts(v.show.each) })),
          h('li', t('league.show.rules.4', { n: v.show.cap }))));
    }

    update(true);
    requestAnimationFrame(() => toTop(ctx));
    return { update: () => update() };
  },
};

