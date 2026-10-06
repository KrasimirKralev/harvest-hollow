// A tree (GDD §3.2): sapling -> mature, the current cycle with its timer, what a harvest gives (Grove and Compost
// bonuses shown), watering by either of you plus the partner tend, Compost, Hurry, mastery, and undo / sell.
// Opened with args { id }.
import { GROWTH, COOP, BOOSTS, MASTERY } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, createKit, bar, empty, pill, stars, chip, who } from './kit.js';
import { treeView, levelOf, durationText, hurryQuote } from './model.js';
import { I } from './intents.js';
import { treeAgeOf, treeStageOf, ageLine, ageBonusOf } from './w4b-rules.js';
import { t, lang } from '../../i18n/index.js';
import { tParts } from './kit.js';

const lazy = (f) => ({ type: () => f().type, args: () => f().args });

/** "Apple Tree · 7 years" where the title ribbon has room for it (a phone keeps the name; the card says the age). */
const narrow = () => Boolean(globalThis.matchMedia?.('(max-width: 520px)').matches);
export function treeTitle(v) {
  if (!v) return t('farm.tree.title');
  const line = ageLine(v.name, treeAgeOf(v.obj), v.sapling);
  // Bulgarian runs longer: a long line keeps the name alone (the card says the age) on every screen
  return (narrow() && line.length > 16) || (lang() !== 'en' && line.length > 22) ? v.name : line;
}

export const treePanel = {
  title: (args, state) => (state ? treeTitle(treeView(state, args.id, 0)) : t('farm.tree.title')),
  size: 'card',
  modal: false,
  topics: ['objects', 'inventory', 'wallet', 'xp', 'mastery'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const view = () => treeView(ctx.store.state, ctx.args.id, ctx.now());
    const sig = () => {
      const v = view();
      return v && [v.status, v.end, v.harvests, v.watered, v.tended, v.composted, v.grove, v.stars, v.refundable, levelOf(ctx.store.state)];
    };
    const update = kit.memo(body, sig, render);

    function render() {
      body.replaceChildren();
      const v = view();
      if (!v) { body.append(empty(t('farm.tree.gone'), 'sprout')); return; }
      ctx.setTitle(treeTitle(v));
      const st = ctx.store.state;
      const level = levelOf(st);
      // its age (wave 4b, wish 4): a "year" per harvest; older trees grow bigger and give more fruit (capped steps)
      const years = treeAgeOf(v.obj);
      const age = treeStageOf(years);
      const ageBonus = v.sapling ? 0 : ageBonusOf(v.obj);
      const fill = bar(0, null, v.sapling ? 'pn-go' : 'pn-sky');
      const when = h('span.pn-tree-when');
      if (v.status !== 'ripe' && v.end) {
        kit.timer(when, { end: v.end, start: v.start, bar: fill, prefix: v.sapling ? t('farm.tree.matureIn') : t('farm.tree.ripeIn'), done: () => update(true) });
      } else when.textContent = v.chop ? t('farm.tree.readyChop') : t('farm.tree.ripeShake');
      const give = v.yield + v.bonus + ageBonus;
      const why = [];
      if (ageBonus) why.push(t('farm.tree.whyAge', { n: ageBonus, stage: age.stage.name.toLowerCase() }));
      if (v.grove) why.push(t('farm.tree.whyGrove', { n: GROWTH.grove.bonusUnits }));
      if (v.composted) why.push(t('farm.tree.whyCompost', { n: GROWTH.compost.treeBonusUnits }));
      const ageRow = v.sapling ? null : h('div.pn-tree-age', { dataset: { stage: age.stage.id } },
        h('span.pn-tree-age-n', t('farm.tree.yearsOld', { n: years })),
        h('span.pn-tree-age-stage', age.stage.name),
        age.next ? bar(Math.max(0, Math.min(1, (years - age.stage.from) / Math.max(1, age.next.from - age.stage.from))), null, 'pn-thin pn-go') : null,
        h('small', age.next
          ? (age.next.bonus > (age.stage.bonus || 0)
            ? t('farm.tree.ageNextBonus', { stage: age.next.name, years: age.next.from, bonus: t('farm.tree.bonusFruit', { n: age.next.bonus }) })
            : t('farm.tree.ageNext', { stage: age.next.name, years: age.next.from }))
          : t('farm.tree.fullyGrown')));
      const water = v.watered
        ? h('span.pn-tree-water', svgIcon('check', 16), tParts(v.tended ? 'farm.tree.wateredTended' : 'farm.tree.wateredBy', {
          who: who(st, v.watered === 'sys' ? 'sys' : v.watered, { me: ctx.store.pid }),
          tender: v.tended ? who(st, v.tended, { me: ctx.store.pid }) : '' }))
        : h('span.pn-tree-water.off', t('farm.tree.notWatered', { a: GROWTH.water.treeBp / 100, b: COOP.partnerTend.bp / 100 }));
      body.append(
        h('div.pn-tree',
          h('div.pn-tree-art', icon(v.def.id, { size: 112 }), v.grove ? pill(t('farm.tree.grove'), 'pn-owned') : null),
          h('div.pn-tree-main',
            h('div.pn-tree-stage', h('b', v.sapling ? t('farm.tree.sapling') : v.status === 'ripe' ? t('farm.tree.ripe') : t('farm.tree.growing')), when),
            v.status !== 'ripe' ? fill : null,
            ageRow,
            h('div.pn-tree-give', tParts('farm.tree.each', { chip: chip(v.product, { n: give, size: 32 }) }), why.length ? h('small', ` (${v.yield} ${why.join(' ')})`) : null),
            h('div.pn-tree-facts',
              h('span', t('farm.tree.cycle', { d: durationText(v.cycleMs) })),
              v.sapling ? h('span', t('farm.tree.harvests', { n: v.harvests })) : null,
              level >= MASTERY.unlock ? h('span', { title: v.mastery.next ? t('farm.tree.masteryNext', { s: v.stars + 1, n: v.mastery.next }) : t('farm.tree.topMastery') }, stars(v.stars)) : null),
            water)),
        h('div.pn-tree-acts',
          v.status === 'ripe'
            ? kit.button({ label: v.chop ? t('farm.tree.chop') : t('farm.tree.harvest'), icon: v.chop ? 'axe' : 'basket', cls: 'btn--sun', ...lazy(() => (v.chop ? I.chop(v.id) : I.harvestTree(v.id))), data: { harvest: v.id } })
            : null,
          kit.button({ label: t('farm.tree.water'), icon: 'watering_can', cls: 'pn-sm btn--sky', ...lazy(() => I.water(v.id)), data: { water: v.id },
            hint: { done: v.tended ? t('farm.tree.wateredTendedCycle') : t('farm.tree.wateredCycle'), what: 'It' } }), // i18n-ok: `what` shows as "Not ready yet"
          level >= GROWTH.compost.unlock ? kit.button({ label: t('farm.tree.compost'), icon: 'compost', cls: 'pn-sm', ...lazy(() => I.compost(v.id)), data: { compost: v.id },
            hint: { missing: [{ item: 'compost', n: 1 }], done: t('farm.tree.composted') } }) : null,
          level >= BOOSTS.hurry.unlock && v.status !== 'ripe' && hurryQuote(st, v.id, ctx.now())
            ? kit.button({ label: t('farm.tree.hurry', { n: hurryQuote(st, v.id, ctx.now()).acorns }), glyph: 'acorn', cls: 'pn-sm btn--sun', ...lazy(() => I.hurry(v.id)), data: { hurry: v.id },
              title: v.sapling ? t('farm.tree.hurrySapling') : t('farm.tree.hurryRipe'),
              hint: () => ({ acorns: Math.max(0, (hurryQuote(ctx.store.state, v.id, ctx.now())?.acorns ?? 0) - ctx.store.state.farm.wallet.acorns) }) })
            : null),
        h('div.pn-tree-foot',
          v.refundable
            ? kit.confirmButton({ label: t('farm.tree.undoBuy'), cls: 'pn-xs pn-ghost', confirm: t('farm.tree.refund'), ...lazy(() => I.refund(v.id)) })
            : null,
          h('small', t('farm.tree.foot'))));
      kit.refresh();
      kit.tick();
    }
    update(true);
    return { update: () => update() };
  },
};

