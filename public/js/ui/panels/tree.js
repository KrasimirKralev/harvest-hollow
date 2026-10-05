// A tree (GDD §3.2): sapling -> mature, the current cycle with its timer, what a harvest gives (Grove and Compost
// bonuses shown), watering by either of you plus the partner tend, Compost, Hurry, mastery, and undo / sell.
// Opened with args { id }.
import { GROWTH, COOP, BOOSTS, MASTERY } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, createKit, bar, empty, pill, stars, chip, who } from './kit.js';
import { treeView, levelOf, durationText, hurryQuote } from './model.js';
import { I } from './intents.js';
import { treeAgeOf, treeStageOf, ageLine, ageBonusOf } from './w4b-rules.js';

const lazy = (f) => ({ type: () => f().type, args: () => f().args });

/** "Apple Tree · 7 years" where the title ribbon has room for it (a phone keeps the name; the card says the age). */
const narrow = () => Boolean(globalThis.matchMedia?.('(max-width: 520px)').matches);
export function treeTitle(v) {
  if (!v) return 'Tree';
  const line = ageLine(v.name, treeAgeOf(v.obj), v.sapling);
  return narrow() && line.length > 16 ? v.name : line;
}

export const treePanel = {
  title: (args, state) => (state ? treeTitle(treeView(state, args.id, 0)) : 'Tree'),
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
      if (!v) { body.append(empty("This tree isn't on the farm any more.", 'sprout')); return; }
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
        kit.timer(when, { end: v.end, start: v.start, bar: fill, prefix: v.sapling ? 'mature in ' : 'ripe in ', done: () => update(true) });
      } else when.textContent = v.chop ? 'Ready to chop!' : 'Ripe: shake it!';
      const give = v.yield + v.bonus + ageBonus;
      const why = [];
      if (ageBonus) why.push(`+${ageBonus} ${age.stage.name.toLowerCase()} age`);
      if (v.grove) why.push(`+${GROWTH.grove.bonusUnits} Grove`);
      if (v.composted) why.push(`+${GROWTH.compost.treeBonusUnits} Compost`);
      const ageRow = v.sapling ? null : h('div.pn-tree-age', { dataset: { stage: age.stage.id } },
        h('span.pn-tree-age-n', `${fmt(years)} year${years === 1 ? '' : 's'} old`),
        h('span.pn-tree-age-stage', age.stage.name),
        age.next ? bar(Math.max(0, Math.min(1, (years - age.stage.from) / Math.max(1, age.next.from - age.stage.from))), null, 'pn-thin pn-go') : null,
        h('small', age.next
          ? `${age.next.name} at ${fmt(age.next.from)} years${age.next.bonus > (age.stage.bonus || 0) ? `: +${age.next.bonus} fruit a harvest` : ''} · every harvest is a year`
          : 'Fully grown: the grandest it gets'));
      const water = v.watered
        ? h('span.pn-tree-water', svgIcon('check', 16), 'Watered by ', who(st, v.watered === 'sys' ? 'sys' : v.watered, { me: ctx.store.pid }),
          v.tended ? [' + a partner tend by ', who(st, v.tended, { me: ctx.store.pid })] : null)
        : h('span.pn-tree-water.off', `Not watered this cycle: water takes ${GROWTH.water.treeBp / 100} % off, the other farmer's tend ${COOP.partnerTend.bp / 100} % more.`);
      body.append(
        h('div.pn-tree',
          h('div.pn-tree-art', icon(v.def.id, { size: 112 }), v.grove ? pill('Grove', 'pn-owned') : null),
          h('div.pn-tree-main',
            h('div.pn-tree-stage', h('b', v.sapling ? 'Sapling' : v.status === 'ripe' ? 'Ripe' : 'Growing'), when),
            v.status !== 'ripe' ? fill : null,
            ageRow,
            h('div.pn-tree-give', 'Each harvest: ', chip(v.product, { n: give, size: 32 }), why.length ? h('small', ` (${v.yield} ${why.join(' ')})`) : null),
            h('div.pn-tree-facts',
              h('span', `A new crop every ${durationText(v.cycleMs)}`),
              v.sapling ? h('span', `${fmt(v.harvests)} harvests so far`) : null,
              level >= MASTERY.unlock ? h('span', { title: v.mastery.next ? `★${v.stars + 1} at ${fmt(v.mastery.next)} harvests of this kind` : 'Top mastery' }, stars(v.stars)) : null),
            water)),
        h('div.pn-tree-acts',
          v.status === 'ripe'
            ? kit.button({ label: v.chop ? 'Chop' : 'Harvest', icon: v.chop ? 'axe' : 'basket', cls: 'btn--sun', ...lazy(() => (v.chop ? I.chop(v.id) : I.harvestTree(v.id))), data: { harvest: v.id } })
            : null,
          kit.button({ label: 'Water', icon: 'watering_can', cls: 'pn-sm btn--sky', ...lazy(() => I.water(v.id)), data: { water: v.id },
            hint: { done: v.tended ? 'Watered and tended this cycle' : 'Watered this cycle', what: 'It' } }),
          level >= GROWTH.compost.unlock ? kit.button({ label: 'Compost', icon: 'compost', cls: 'pn-sm', ...lazy(() => I.compost(v.id)), data: { compost: v.id },
            hint: { missing: [{ item: 'compost', n: 1 }], done: 'Composted this cycle' } }) : null,
          level >= BOOSTS.hurry.unlock && v.status !== 'ripe' && hurryQuote(st, v.id, ctx.now())
            ? kit.button({ label: `Hurry · ${hurryQuote(st, v.id, ctx.now()).acorns}`, glyph: 'acorn', cls: 'pn-sm btn--sun', ...lazy(() => I.hurry(v.id)), data: { hurry: v.id },
              title: v.sapling ? 'Hurry finishes the sapling and its first fruit' : 'Ripe right now',
              hint: () => ({ acorns: Math.max(0, (hurryQuote(ctx.store.state, v.id, ctx.now())?.acorns ?? 0) - ctx.store.state.farm.wallet.acorns) }) })
            : null),
        h('div.pn-tree-foot',
          v.refundable
            ? kit.confirmButton({ label: 'Undo the purchase', cls: 'pn-xs pn-ghost', confirm: 'Refund it in full?', ...lazy(() => I.refund(v.id)) })
            : null,
          h('small', 'Trees never wither and never need replanting. Move one with the Hammer; four of a kind in a square form a Grove.')));
      kit.refresh();
      kit.tick();
    }
    update(true);
    return { update: () => update() };
  },
};

