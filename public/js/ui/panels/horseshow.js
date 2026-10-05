// The horse show at the County Fair (GDD §3.4 Horse, §5.6; M2 feature horse_show, L25), ui-league lane (wave 3).
//
// A horse earns its blue ribbon after 20 collections; from then on every collection has a 10 % chance of a Show
// Ribbon, and a Show Ribbon entered at the Fair counts double once the horse show exists. The panel shows the ring
// (Show Ribbons in the barn, points each, the 10-a-week cap, Enter), every horse's way to its blue ribbon, and how the
// show works. Entry numbers come from the Fair's own rules (entryPoints10, entryLimit), so the preview is the entry.
import { animalOf } from '../../../../shared/content/index.js';
import { h, icon, fmt, createKit, fill, hintable } from './kit.js';
import { banner, speech, clockChip, lockedBody, fmtPts, need, toTop } from './fair.js';
import { horseShowOpen, horsesOf, showOf, levelOf, actFor, ARGS, featureLevel, SHOW_ITEM } from './league-rules.js';
import { hubNav, hubSig, ring } from './league-kit.js';
import * as FR from '../../../../shared/rules/actions/fair.js';

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
  const line = !show.isOpen ? 'The ring is raked and the judges are resting. The next show opens on Monday.'
    : !horses.length ? 'No horses yet? A Stable and a foal, and in a few weeks you\'ll have a show horse.'
      : !prized ? 'Twenty good collections and a horse earns its blue ribbon. Then the Show Ribbons start to come.'
        : show.have > 0 && show.left > 0 ? 'A Show Ribbon! Bring it to the ring: it counts double here.'
          : 'Your ribbon horses are looking splendid. Every collection may bring a Show Ribbon.';
  return { open, level, unlock, show, horses, stables, prized, line, chanceBp: def?.premiumBp ?? show.chanceBp,
    total10: show.entered * show.each, closesAt: FR.fairCloseAt(state, state.farm.fair?.cur?.w ?? 0) };
}

export const horseShowPanel = {
  title: 'Horse Show',
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
        fill(body, hubNav(ctx, 'horseShow'), lockedBody('c', 'The Horse Show', [
          'Horses with a blue ribbon go to the Fair\'s horse show.',
          'A ribboned horse brings a Show Ribbon now and then: entered at the Fair it scores double points.',
          'Each adult horse also makes Captain Reed\'s barge crates pay a little more.',
        ], v.unlock, v.level));
        return;
      }
      const cur = st.farm.fair?.cur;
      const closes = cur ? FR.fairCloseAt(st, cur.w) : now;
      const chip = v.show.isOpen ? clockChip(kit, { label: 'Judging Sunday 20:00 ·', at: closes, doneText: 'judging now' }) : null;
      fill(body,
        hubNav(ctx, 'horseShow'),
        banner('c', 'The Horse Show', 'At the County Fair · a Show Ribbon counts double', { chip, focus: [0.92, 0.4], cls: 'lg-banner' }),
        h('div.lg-top', speech('fern', v.line), ringCard(st, v)),
        h('section.lg-horses', h('h3.pn-h', h('span', `Your horses${v.horses.length ? ` · ${v.prized} of ${v.horses.length} with a blue ribbon` : ''}`)),
          v.horses.length ? h('div.lg-horse-grid', ...v.horses.map((x, i) => horseCard(st, v, x, i))) : noHorses(v)),
        rulesCard(v));
      kit.refresh();
      kit.tick();
    }

    function ringCard(st, v) {
      const s = v.show;
      const t = actFor('showEnter');
      const most = Math.max(1, Math.min(s.left, s.have));
      const pips = h('span.wk-pips', { role: 'img', 'aria-label': `${s.entered} of ${s.cap} entered this week` },
        ...Array.from({ length: s.cap }, (_, i) => h(`i${i < s.entered ? '.on' : ''}`)));
      const hint = (n) => () => (s.left <= 0 ? { texts: { CAP: `All ${s.cap} entered this week` } } : need(SHOW_ITEM, n - s.have));
      return h('section.lg-ring-card', { 'aria-label': 'The show ring' },
        h('div.lg-ring-art', hintable(h('span.lg-ribbon-big', icon(SHOW_ITEM, { size: 72, alt: 'Show Ribbon' })), SHOW_ITEM),
          s.mul > 1 ? h('span.wk-x2.prized', { title: 'The horse show doubles a Show Ribbon' }, `Show ×${s.mul}`) : null),
        h('div.lg-ring-text',
          h('b', 'Show Ribbons'),
          h('span.wk-each', `${fmtPts(s.each)} points each`),
          h('small', `${fmt(s.have)} in the barn · ${v.total10 ? `${fmtPts(v.total10)} points from the ring this week` : 'none entered yet this week'}`),
          h('div.wk-entry-cap', pips, h('small', s.left > 0 ? `${s.left} left` : `All ${s.cap} in`))),
        s.isOpen ? h('div.lg-ring-acts',
          kit.button({ label: 'Enter 1', cls: 'btn--small btn--paper', key: 'show:1', type: t, args: ARGS.showEnter(SHOW_ITEM, 1), hint: hint(1) }),
          most > 1 ? kit.button({ label: `Enter ${most}`, cls: 'btn--small btn--sun', key: 'show:n', type: t, args: ARGS.showEnter(SHOW_ITEM, most), hint: hint(most) }) : null)
          : h('p.wk-muted', 'The show is closed until Monday.'));
    }

    function horseCard(st, v, x, i) {
      const p = Math.min(1, x.cycle / Math.max(1, x.prizedAt));
      const left = Math.max(0, x.prizedAt - x.cycle);
      const name = x.name || `Horse ${i + 1}`;
      const status = !x.adult ? 'A foal: grows into a show horse'
        : x.prized ? `Blue ribbon · ${v.chanceBp / 100} % chance of a Show Ribbon each collection`
          : `${left} more collection${left === 1 ? '' : 's'} to its blue ribbon`;
      return h(`article.lg-horse${x.prized ? '.prized' : ''}`, { dataset: { id: x.id } },
        h('div.lg-horse-art', ring(p, 76, '', { color: x.prized ? '#4A7FE8' : '#E39A1E' }), h('span.lg-horse-ic', icon('horse', { size: 48, alt: '' })),
          x.prized ? h('span.lg-horse-rosette', icon('blue_rosette', { size: 30, alt: 'Blue ribbon' })) : null),
        h('div.lg-horse-text', h('b', name), h('small', status),
          !x.prized && x.adult ? h('span.lg-horse-n', `${fmt(x.cycle)} / ${fmt(x.prizedAt)} collections`) : null,
          x.ready ? h('span.pn-pill.pn-owned', 'Ready to collect') : null),
        x.home ? kit.button({ label: 'Visit', cls: 'btn--small btn--paper', key: `horse:${x.id}`, gate: () => null,
          onClick: () => ctx.ui.panels.open('animals', { id: x.home }) }) : null);
    }

    function noHorses(v) {
      return h('div.wk-empty', icon('stable', { size: 56, alt: '' }), h('p', v.stables.length ? 'Your Stable is empty.' : 'No Stable yet.'),
        h('small', v.stables.length ? 'Buy a foal or a horse for it at the Market: after 20 collections it wears a blue ribbon.'
          : 'Build a Stable from the Market, then bring home a horse.'),
        kit.button({ label: 'Open the Market', cls: 'btn--small btn--sun', key: 'show:market', gate: () => null,
          onClick: () => ctx.ui.panels.open('market', { tab: 'animals' }) }));
    }

    function rulesCard(v) {
      return h('section.wk-card.wk-rules.lg-rules', h('h3.pn-h', h('span', 'How the horse show works')),
        h('ul.wk-bullets',
          h('li', `A horse wears a blue ribbon after ${animalOf('horse')?.prizedAt ?? 20} collections.`),
          h('li', `Then each collection has a ${v.chanceBp / 100} % chance of a Show Ribbon, besides its Manure.`),
          h('li', h('b', 'A Show Ribbon entered at the Fair counts double'), `: ${fmtPts(v.show.each)} points.`),
          h('li', `At most ${v.show.cap} a week, like every Fair entry. The points count for the league too.`)));
    }

    update(true);
    requestAnimationFrame(() => toTop(ctx));
    return { update: () => update() };
  },
};

